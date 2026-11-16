#!/usr/bin/env node
'use strict';

// Real-process, real-HTTP smoke test. No user archive, production directory,
// real API key, model request, catalog refresh or external service is used.
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const path = require('node:path');
const os = require('node:os');
const http = require('node:http');
const { spawn } = require('node:child_process');
const { createHash, randomUUID } = require('node:crypto');
const { setTimeout: delay } = require('node:timers/promises');

const root = path.resolve(__dirname, '..');
const binary = path.join(root, 'server/target/debug/tore-server');
const reportPath = path.join(root, 'docs/http-e2e-report.json');
const report = {
  schemaVersion: 1,
  startedAt: new Date().toISOString(),
  nodeVersion: process.version,
  transport: 'real loopback HTTP to spawned Rust binary',
  syntheticDataOnly: true,
  externalModelCalls: 0,
  catalogRefreshes: 0,
  paidCalls: 0,
  steps: [],
  passed: false,
  temporaryDataRemoved: false,
};
let temporaryRoot;
let active;
let requestCount = 0;

const sha256 = value => createHash('sha256').update(value).digest('hex');
const safeError = error => String(error?.message || error).split('\n')[0].slice(0, 400);

async function step(name, fn) {
  const start = Date.now();
  try {
    const detail = await fn();
    report.steps.push({ name, passed: true, durationMs: Date.now() - start, ...(detail ? { detail } : {}) });
    process.stdout.write(`PASS ${name}\n`);
    return detail;
  } catch (error) {
    report.steps.push({ name, passed: false, durationMs: Date.now() - start, error: safeError(error) });
    throw error;
  }
}

function post(server, route, body, override = {}) {
  const url = new URL(route, server.url);
  assert.equal(url.protocol, 'http:');
  assert.equal(url.hostname, '127.0.0.1');
  const content = Buffer.from(JSON.stringify(body));
  requestCount += 1;
  return new Promise((resolve, reject) => {
    const req = http.request(url, {
      method: 'POST',
      agent: false,
      headers: {
        host: url.host,
        origin: server.url,
        authorization: `Bearer ${server.token}`,
        'sec-fetch-site': 'same-origin',
        'content-type': 'application/json',
        'content-length': String(content.length),
        ...override,
      },
    }, res => {
      const chunks = [];
      let size = 0;
      res.on('data', chunk => {
        size += chunk.length;
        if (size > 4 * 1024 * 1024) res.destroy(new Error('HTTP response exceeds test limit'));
        else chunks.push(chunk);
      });
      res.on('error', reject);
      res.on('end', () => {
        try {
          resolve({ status: res.statusCode, headers: res.headers, body: JSON.parse(Buffer.concat(chunks).toString('utf8')) });
        } catch { reject(new Error('Server did not return JSON')); }
      });
    });
    req.setTimeout(10_000, () => req.destroy(new Error('Loopback request timed out')));
    req.on('error', reject);
    req.end(content);
  });
}

async function api(op, body = {}, expected = 200, override = {}) {
  const response = await post(active, `/api/private/tore/${op}`, body, override);
  assert.equal(response.status, expected, `${op}: expected HTTP ${expected}, got ${response.status}`);
  if (expected === 200) assert.equal(response.headers['cache-control'], 'no-store');
  else assert.equal(typeof response.body.error, 'string');
  return response.body;
}

async function start() {
  const data = path.join(temporaryRoot, 'data');
  const archive = path.join(temporaryRoot, 'archive');
  await fs.mkdir(data, { recursive: true });
  await fs.mkdir(archive, { recursive: true });
  const runtime = path.join(data, '.tore-runtime/runtime.json');
  await fs.rm(runtime, { force: true });
  const child = spawn(binary, ['--archive', archive, '--data', data, '--listen', '127.0.0.1:0'], {
    cwd: root,
    stdio: ['ignore', 'pipe', 'pipe'],
    // Do not pass real model credentials from the invoking environment.
    env: { PATH: process.env.PATH || '/usr/bin:/bin', LANG: 'en_US.UTF-8' },
  });
  const state = { child, output: '', error: '', exited: false };
  state.exit = new Promise(resolve => {
    child.once('error', () => { state.exited = true; resolve({ code: null, signal: 'spawn-error' }); });
    child.once('exit', (code, signal) => { state.exited = true; resolve({ code, signal }); });
  });
  // Logs stay in RAM, since TORE_READY contains the temporary local token.
  child.stdout.on('data', chunk => { state.output = (state.output + chunk).slice(-64 * 1024); });
  child.stderr.on('data', chunk => { state.error = (state.error + chunk).slice(-64 * 1024); });
  active = state;
  const deadline = Date.now() + 15_000;
  while (Date.now() < deadline) {
    assert.equal(state.exited, false, 'Rust process exited before readiness');
    try {
      const ready = JSON.parse(await fs.readFile(runtime, 'utf8'));
      if (ready.pid === child.pid && typeof ready.localToken === 'string') {
        const url = new URL(ready.url);
        assert.equal(url.hostname, '127.0.0.1');
        assert.equal(url.protocol, 'http:');
        state.url = url.origin;
        state.token = ready.localToken;
        const status = await api('status');
        assert.equal(status.version, '0.12.2');
        return status;
      }
    } catch (error) {
      if (error?.code !== 'ENOENT' && !(error instanceof SyntaxError)) throw error;
    }
    await delay(50);
  }
  throw new Error('Rust process readiness timed out');
}

async function shutdown() {
  const response = await post(active, '/api/private/shutdown', {});
  assert.equal(response.status, 200);
  assert.equal(response.body.closing, true);
  const result = await Promise.race([active.exit, delay(10_000).then(() => { throw new Error('Graceful shutdown timed out'); })]);
  assert.equal(result.code, 0, 'Graceful shutdown must exit successfully');
  assert.equal(result.signal, null);
  active = undefined;
}

async function allFiles(directory) {
  const files = [];
  for (const entry of await fs.readdir(directory, { withFileTypes: true })) {
    const full = path.join(directory, entry.name);
    if (entry.isDirectory()) files.push(...await allFiles(full));
    else if (entry.isFile()) files.push(full);
  }
  return files;
}

async function main() {
  assert.ok(Number(process.versions.node.split('.')[0]) >= 26, 'Node.js 26+ required; do not use the old PATH runtime');
  const executable = await fs.readFile(binary);
  report.binarySha256 = sha256(executable);
  report.binaryModifiedAt = (await fs.stat(binary)).mtime.toISOString();
  temporaryRoot = await fs.realpath(await fs.mkdtemp(path.join(os.tmpdir(), 'tore-http-e2e-')));
  const initial = await step('start_real_rust_process', start);
  assert.equal(initial.conversationCount, 0);
  assert.equal(initial.keyConfigured, false);
  assert.equal(initial.budgetUsd, 0);
  // Status carries no private values, but avoid storing runtime URLs and tokens in the report.
  delete report.steps.at(-1).detail;

  await step('host_origin_and_bearer_enforced', async () => {
    await api('status', {}, 403, { host: 'wrong.invalid' });
    await api('status', {}, 403, { origin: 'https://wrong.invalid' });
    await api('status', {}, 403, { authorization: 'Bearer synthetic-wrong-token' });
  });

  const sourceEmail = 'e2e.person@example.invalid';
  const otherBranch = 'OTHER_BRANCH_SHOULD_STAY_OUT';
  const hiddenThought = 'HIDDEN_REASONING_SHOULD_STAY_OUT';
  const attachment = 'sediment://synthetic-attachment';
  const source = [{
    conversation_id: 'synthetic-e2e-chat', title: 'Synthetic branched import',
    create_time: 1_700_000_000, current_node: 'answer-a',
    mapping: {
      root: { parent: null, children: ['question'], message: null },
      question: { parent: 'root', children: ['thought', 'answer-b'], message: {
        id: 'source-user', author: { role: 'user' },
        content: { content_type: 'text', parts: [`Bu teknik demoyu açıkla. ${sourceEmail}`] },
      } },
      thought: { parent: 'question', children: ['answer-a'], message: {
        id: 'source-thought', author: { role: 'assistant' },
        content: { content_type: 'thoughts', thoughts: [{ text: hiddenThought }] },
      } },
      'answer-a': { parent: 'thought', children: [], message: {
        id: 'source-answer-a', author: { role: 'assistant' },
        content: { content_type: 'multimodal_text', parts: ['Seçilen dalın sentetik yanıtı.', { content_type: 'image_asset_pointer', asset_pointer: attachment }] },
      } },
      'answer-b': { parent: 'question', children: [], message: {
        id: 'source-answer-b', author: { role: 'assistant' },
        content: { content_type: 'text', parts: [otherBranch] },
      } },
    },
  }];
  let original, userMessage, selectedAnswer, alternateAnswer;
  await step('chatgpt_import_preserves_branches_and_omits_reasoning', async () => {
    const preview = await api('import-preview', {
      provider: 'chatgpt', fileName: 'conversations.json',
      contentBase64: Buffer.from(JSON.stringify(source)).toString('base64'),
    });
    assert.equal(preview.conversations.length, 1);
    assert.equal((await api('list')).conversations.length, 0, 'Preview must not import');
    const imported = await api('import-commit', { previewId: preview.previewId, selectedIds: [preview.conversations[0].id] });
    assert.equal(imported.imported, 1);
    original = imported.conversations[0];
    assert.equal(original.messages.length, 3);
    assert.ok(!JSON.stringify(original).includes(hiddenThought));
    userMessage = original.messages.find(m => m.sourceId === 'source-user');
    selectedAnswer = original.messages.find(m => m.sourceId === 'source-answer-a');
    alternateAnswer = original.messages.find(m => m.sourceId === 'source-answer-b');
    assert.ok(userMessage && selectedAnswer && alternateAnswer);
    assert.equal(selectedAnswer.parentId, userMessage.id);
    assert.equal(alternateAnswer.parentId, userMessage.id);
    assert.ok(selectedAnswer.attachments.length > 0);
    assert.ok(original.messages.every(m => m.authorshipStatus === 'unreviewed'));
  });

  function prepareRequest(developer, edits = {}) {
    return {
      conversationId: original.id, leafId: selectedAnswer.id,
      items: [
        { messageId: userMessage.id, text: 'Bu teknik demoyu açıkla. [E-POSTA]', authorship: 'human_original', rights: 'user_attested', feedback: 'Sentetik kullanıcı notu' },
        { messageId: selectedAnswer.id, text: selectedAnswer.text, authorship: 'ai_output', rights: 'user_attested', feedback: '' },
      ],
      intent: 'continue', developer, modelId: '', mode: 'simulation',
      question: 'Seçilen bağlamı devam ettir.',
      ...edits,
    };
  }
  const confirm = draft => ({ draftId: draft.id, hash: draft.hash, confirmed: true });

  await step('pii_and_off_branch_selection_blocked', async () => {
    const unsafe = prepareRequest('openai');
    unsafe.items[0].text = userMessage.text;
    const preview = await api('prepare', unsafe);
    assert.ok(preview.findings.some(f => f.kind === 'E-posta'));
    await api('send', confirm(preview.draft), 400);
    await api('revoke', { draftId: preview.draft.id });
    const offBranch = prepareRequest('openai');
    offBranch.items.push({ messageId: alternateAnswer.id, text: alternateAnswer.text, authorship: 'ai_output', rights: 'user_attested', feedback: '' });
    await api('prepare', offBranch, 400);
  });

  let simulationCount = 0;
  await step('ten_developer_simulations_need_exact_approval', async () => {
    const status = await api('status');
    assert.equal(status.developers.length, 11);
    for (const developer of status.developers) {
      const preview = await api('prepare', prepareRequest(developer.id));
      assert.equal(preview.findings.length, 0);
      assert.ok(!preview.draft.contextText.includes(sourceEmail));
      assert.ok(!preview.draft.contextText.includes(otherBranch));
      assert.ok(!preview.draft.contextText.includes(attachment));
      if (simulationCount === 0) {
        await api('send', { ...confirm(preview.draft), confirmed: false }, 400);
        await api('send', { draftId: preview.draft.id, hash: preview.draft.hash }, 400);
        await api('send', { ...confirm(preview.draft), hash: 'changed-hash' }, 400);
      }
      const sent = await api('send', confirm(preview.draft));
      assert.equal(sent.receipt.status, 'simulation');
      assert.equal(sent.receipt.developer, developer.id);
      assert.equal(sent.receipt.provider, null);
      assert.notEqual(sent.conversation.id, original.id);
      assert.ok(sent.conversation.messages.at(-1).text.startsWith('SİMÜLASYON'));
      assert.ok(!JSON.stringify(sent.conversation).includes(sourceEmail));
      assert.ok(!JSON.stringify(sent.conversation).includes(otherBranch));
      await api('send', confirm(preview.draft), 400);
      simulationCount += 1;
    }
    return { simulations: simulationCount, realGenerations: 0 };
  });

  await step('source_unchanged_after_edit_and_continuation', async () => {
    assert.deepEqual(await api('conversation', { id: original.id }), original);
    assert.equal((await api('list')).conversations.length, 1 + simulationCount);
    const catalog = await api('catalog', { refresh: false });
    assert.equal(catalog.source, 'bundled-snapshot');
    assert.ok(catalog.models.length >= 10);
  });

  let revokedDraft;
  await step('dataset_intent_and_export_removed_and_revocation_blocks_send', async () => {
    await api('prepare', prepareRequest('openai', { intent: 'dataset', mode: 'manual' }), 400);
    await api('prepare', prepareRequest('openai', { purpose: 'research' }), 400);
    const preview = await api('prepare', prepareRequest('openai'));
    revokedDraft = preview.draft;
    await api('export', confirm(revokedDraft), 400);
    assert.equal((await api('revoke', { draftId: revokedDraft.id })).revoked, true);
    await api('send', confirm(revokedDraft), 400);
  });

  const fakeKey = `synthetic-e2e-never-persist-${randomUUID()}`;
  await step('api_key_stays_in_memory', async () => {
    assert.equal((await api('key', { key: fakeKey })).configured, true);
    assert.equal((await api('status')).keyConfigured, true);
    for (const file of await allFiles(path.join(temporaryRoot, 'data'))) {
      assert.ok(!(await fs.readFile(file)).includes(Buffer.from(fakeKey)), 'API key persisted to disk');
    }
    assert.ok(!active.output.includes(fakeKey));
    assert.ok(!active.error.includes(fakeKey));
  });
  const previousToken = active.token;
  await step('graceful_http_shutdown', shutdown);
  await step('restart_retains_data_rotates_local_token_and_clears_key', async () => {
    const status = await start();
    assert.equal(status.keyConfigured, false);
    assert.equal(status.conversationCount, 1 + simulationCount);
    assert.notEqual(active.token, previousToken);
    await api('status', {}, 403, { authorization: `Bearer ${previousToken}` });
    const saved = await api('list');
    assert.equal(saved.conversations.length, 1 + simulationCount);
    assert.deepEqual(saved.conversations.find(c => c.id === original.id), original);
    const history = await api('drafts');
    assert.equal(history.receipts.filter(r => r.status === 'simulation').length, simulationCount);
    assert.equal(history.drafts.find(d => d.id === revokedDraft.id).status, 'revoked');
    await api('send', confirm(revokedDraft), 400);
    return { restoredConversations: saved.conversations.length, restoredSimulationReceipts: simulationCount };
  });
  await step('final_graceful_shutdown', shutdown);
  report.passed = true;
}

(async () => {
  try { await main(); }
  catch (error) {
    report.error = safeError(error);
    process.stderr.write(`FAIL ${report.error}\n`);
    process.exitCode = 1;
  } finally {
    if (active && !active.exited) {
      active.child.kill('SIGTERM');
      await Promise.race([active.exit, delay(2000)]);
      if (!active.exited) { active.child.kill('SIGKILL'); await active.exit; }
    }
    if (temporaryRoot) {
      await fs.rm(temporaryRoot, { recursive: true, force: true });
      report.temporaryDataRemoved = true;
    }
    report.finishedAt = new Date().toISOString();
    report.httpRequestCount = requestCount;
    report.testScriptSha256 = sha256(await fs.readFile(__filename));
    await fs.writeFile(reportPath, JSON.stringify(report, null, 2) + '\n');
    process.stdout.write(`Report: ${reportPath}\n`);
  }
})();
