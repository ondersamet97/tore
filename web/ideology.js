import { api } from './private-client.js';

// Source edits and provider credentials never go into browser storage.
const ide = id => document.getElementById(id);
// Interface text comes from i18n-opinions.js. Text set from a key remembers it so a
// language switch redraws it; service messages and the person's words stay as they are.
const tx = (key, vars) => toreI18n.t(key, vars), tn = (key, n, vars) => toreI18n.n(key, n, vars);
function keyed(target, key, vars) { target.textContent = tx(key, vars); delete target.dataset.i18n; target.dataset.i18nKey = key; target.dataset.i18nVars = vars ? JSON.stringify(vars) : ''; }
function unkeyed(target, text) { target.textContent = text; delete target.dataset.i18n; delete target.dataset.i18nKey; delete target.dataset.i18nVars; }
function redrawKeyed() { for (const target of document.querySelectorAll('[data-i18n-key]')) target.textContent = tx(target.dataset.i18nKey, target.dataset.i18nVars ? JSON.parse(target.dataset.i18nVars) : undefined); }
const formatCount = value => Number(value).toLocaleString(toreI18n.locale());
const ideology = { preview: null, latest: null, job: null, reportIds: null, pending: false, changed: false, stale: false, timer: null, authTimer: null, previewRequest: 0, revision: 0, draft: null, attempted: false, models: [], connections: {}, rows: new Map(), connectionBusy: false, modelRequest: 0 };
const ideologyCall = (op, body = {}) => api('/api/private/tore/' + op, body);
const el = (tag, text, className) => { const item = document.createElement(tag); if (text !== undefined) item.textContent = text; if (className) item.className = className; return item; };
const developers = [
  ['openai', 'OpenAI / ChatGPT', 'https://chatgpt.com/'], ['anthropic', 'Anthropic / Claude', 'https://claude.ai/'],
  ['google', 'Google / Gemini', 'https://gemini.google.com/'], ['meta', 'Meta', 'https://www.meta.ai/'],
  ['x-ai', 'xAI / Grok', 'https://grok.com/'], ['deepseek', 'DeepSeek', 'https://chat.deepseek.com/'],
  ['moonshotai', 'Moonshot / Kimi', 'https://www.kimi.com/'], ['z-ai', 'Z.ai / GLM', 'https://chat.z.ai/'],
  ['qwen', 'Alibaba / Qwen', 'https://chat.qwen.ai/'], ['mistralai', 'Mistral', 'https://chat.mistral.ai/'],
  ['nvidia', 'NVIDIA', 'https://build.nvidia.com/']
];
const developerName = id => developers.find(row => row[0] === id)?.[1] || id;
const reportScope = () => ideology.reportIds === null ? {} : { reportIds: [...ideology.reportIds] };
const readableDate = value => { const time = new Date(value); return Number.isNaN(time.valueOf()) ? tx('opinions.noDate') : time.toLocaleString(toreI18n.locale(), { day: 'numeric', month: 'long', year: 'numeric', hour: '2-digit', minute: '2-digit' }); };
const running = () => ideology.pending || ideology.job?.status === 'running';
const target = () => ({ connection: ide('ideology-connection').value, developer: ide('ideology-developer').value, modelId: ide(ide('ideology-connection').value === 'manual' ? 'ideology-manual-model' : 'ideology-model').value.trim() });
function showIdeology() { ide('ideology-panel').hidden = false; ide('ideology-nav').setAttribute('aria-expanded', 'true'); ide('ideology-panel').scrollIntoView({ behavior: 'smooth', block: 'start' }); }
function setIdeologyError(message) { ide('ideology-error').textContent = message; ide('ideology-error').hidden = !message; }
function statusText(key) { keyed(ide('ideology-status'), key); keyed(ide('ideology-hero-status'), key); }
// Returns the key of the current phase, for statusText.
function phaseText(job) {
  const phases = { queued: 'ideology.phase.queued', preparing: 'ideology.phase.preparing', generating: 'ideology.phase.generating', validating: 'ideology.phase.validating', saving: 'ideology.phase.saving' };
  return phases[job?.phase] || 'ideology.phase.unknown';
}
function invalidate(message = 'ideology.selectionChanged') {
  ideology.revision++; ideology.draft = null; ideology.attempted = false;
  ide('ideology-reviewed').checked = false; ide('ideology-send-consent').checked = false; ide('ideology-manual-consent').checked = false;
  ide('ideology-manual-response').value = ''; unkeyed(ide('ideology-copy-status'), ''); ide('ideology-outbound').hidden = true;
  ide('ideology-selection-note').hidden = false; keyed(ide('ideology-selection-note'), message);
  refreshControls();
}
function targetReady() {
  const selected = target();
  if (selected.connection === 'manual') return true;
  const connected = selected.connection === 'chatgpt' ? chatgptReady() : ideology.connections.openrouter?.configured;
  return !!connected && ideology.models.some(model => model.id === selected.modelId && model.developer === selected.developer);
}
function chatgptReady() {
  const chat = ideology.connections.chatgpt;
  return !!chat?.connected && chat.sharing === true && !chat.pending && !chat.error;
}
function refreshControls() {
  const busy = running(); ide('ideology-panel').setAttribute('aria-busy', String(busy));
  for (const id of ['ideology-update', 'ideology-refresh', 'ideology-connection', 'ideology-developer', 'ideology-model', 'ideology-manual-model', 'ideology-select-sources', 'ideology-clear-sources', 'ideology-reviewed']) ide(id).disabled = busy;
  ide('ideology-developer').disabled = busy || target().connection === 'chatgpt';
  ide('ideology-model').disabled = busy || (target().connection === 'chatgpt' && !chatgptReady());
  for (const input of ide('ideology-reports').querySelectorAll('input')) input.disabled = busy;
  for (const input of ide('ideology-input-sources').querySelectorAll('input,textarea')) input.disabled = busy;
  ide('ideology-prepare').disabled = busy || !ideology.preview || !targetReady() || !ide('ideology-reviewed').checked || ![...ideology.rows.values()].some(row => row.selected && row.text.trim());
  const canUse = !busy && targetReady() && !!ideology.draft?.canSend && !ideology.attempted;
  ide('ideology-send-consent').disabled = !canUse;
  ide('ideology-send').disabled = !canUse || !ide('ideology-send-consent').checked;
  ide('ideology-copy').disabled = !canUse || !ide('ideology-send-consent').checked;
  ide('ideology-manual-save').disabled = !canUse || !ide('ideology-manual-consent').checked || !ide('ideology-manual-response').value.trim();
  ide('ideology-model-refresh').disabled = busy || ideology.connectionBusy || (target().connection === 'chatgpt' && !chatgptReady());
  ide('ideology-chatgpt-login').disabled = busy || ideology.connectionBusy || !!ideology.connections.chatgpt?.pending;
  ide('ideology-chatgpt-disconnect').disabled = busy || ideology.connectionBusy;
  for (const id of ['ideology-save-key', 'ideology-clear-key']) ide(id).disabled = busy || ideology.connectionBusy;
  ide('ideology-show-latest').hidden = !ideology.latest;
  if (ideology.latest) {
    const previous = busy || ideology.stale || ideology.changed || ['failed', 'interrupted', 'uncertain'].includes(ideology.job?.status);
    const latest = ideology.latest;
    const provenance = latest.engine?.provenance === 'user_attested' || latest.engine?.connection === 'manual' ? 'ideology.result.manual' : (latest.engine?.localOnly === true || typeof latest.engine === 'string' && /yerel|local/i.test(latest.engine)) ? 'ideology.result.previousLocal' : 'ideology.result.ai';
    keyed(ide('ideology-result-label'), previous ? 'ideology.result.previous' : provenance);
    ide('ideology-result-label').className = 'status-pill ' + (previous ? 'uncertain' : 'confirmed');
  }
}
function sourceLabel(source) { return ['confirmed_card', 'opinion', 'confirmed_opinion'].includes(source.kind) ? tx('ideology.source.opinion') : tx('ideology.source.report'); }
function sourceDetails(source, id) {
  const details = el('details', undefined, 'ideology-source'); if (id) details.id = id;
  details.append(el('summary', source.title || source.id), el('p', sourceLabel(source), 'small'), el('pre', source.text || ''));
  return details;
}
function renderSourceEditors() {
  ide('ideology-input-sources').replaceChildren(...[...ideology.rows.values()].map(row => {
    const item = el('details', undefined, 'ideology-source ideology-editable-source');
    const summary = el('summary', row.source.title || row.source.id);
    const choice = el('label', undefined, 'ideology-check'), selected = el('input'); selected.type = 'checkbox'; selected.checked = row.selected; selected.dataset.sourceId = row.source.id;
    selected.onchange = () => { row.selected = selected.checked; invalidate(); };
    choice.append(selected, el('span', tx('ideology.source.include', { label: sourceLabel(row.source) })));
    const label = el('label', tx('ideology.source.text')), text = el('textarea'); text.value = row.text; text.rows = 5; text.maxLength = 50000; text.dataset.sourceText = row.source.id;
    text.oninput = () => { row.text = text.value; invalidate('ideology.sourceEdited'); };
    label.append(text); item.append(summary, choice, label); return item;
  }));
}
function renderPreview(preview) {
  ideology.preview = preview; ideology.stale = !!preview.stale;
  const reports = Array.isArray(preview.reports) ? preview.reports : [], selected = reports.filter(report => report.selected);
  ide('ideology-coverage').textContent = [tn('ideology.coverage.confirmed', preview.confirmedCount || 0), tn('ideology.coverage.reports', selected.length), tn('ideology.coverage.excluded', preview.excludedCount || 0)].join(' · ');
  if (preview.scopeMessage) ide('ideology-coverage').textContent += ` · ${preview.scopeMessage}`;
  ide('ideology-engine').textContent = tx('ideology.localOff');
  ide('ideology-reports').replaceChildren(...reports.map(report => {
    const label = el('label', undefined, 'ideology-report-choice'), input = el('input'); input.type = 'checkbox'; input.value = report.id; input.checked = !!report.selected; input.dataset.reportId = report.id;
    const text = el('span'); text.append(el('strong', report.title || report.id));
    const total = Number(report.totalCharacters) || 0, included = Number(report.includedCharacters) || 0;
    text.append(el('small', included < total ? tx('ideology.charsPartial', { included: formatCount(included), total: formatCount(total) }) : tn('ideology.chars', total, { count: formatCount(total) })));
    input.onchange = () => {
      ideology.reportIds = [...ide('ideology-reports').querySelectorAll('input:checked')].map(item => item.value); ideology.changed = true; invalidate(); loadPreview();
    };
    label.append(input, text); return label;
  }));
  if (!reports.length) ide('ideology-reports').append(el('p', tx('ideology.reportsNone'), 'small'));
  const rows = new Map();
  for (const source of preview.sources || []) { const old = ideology.rows.get(source.id); rows.set(source.id, old && old.source.text === source.text ? { ...old, source } : { source, text: source.text || '', selected: true }); }
  ideology.rows = rows; renderSourceEditors();
  if (preview.latest) renderResult(preview.latest);
  ideology.job = preview.job || null; refreshControls();
}
function renderResult(result, force = false) {
  // Polling an ongoing update must not close the previous result's open citations.
  if (!force && ideology.latest?.id === result.id && ideology.latest?.inputHash === result.inputHash) { refreshControls(); return; }
  ideology.latest = result;
  const analysis = result.analysis || {}, sources = Array.isArray(result.sources) ? result.sources : [];
  const lookup = new Map(sources.map((source, index) => [source.id, { source, index }]));
  ide('ideology-result').hidden = false;
  if (analysis.title) unkeyed(ide('ideology-result-title'), analysis.title); else keyed(ide('ideology-result-title'), 'ideology.result.defaultTitle'); ide('ideology-summary').textContent = analysis.summary || '';
  ide('ideology-result-date').textContent = readableDate(result.createdAt) + ' · ' + tn('ideology.coverage.opinions', result.coverage?.confirmedCount || 0) + ', ' + tn('ideology.coverage.reports', result.coverage?.reportsCount || 0);
  ide('ideology-result-sources').replaceChildren(...sources.map((source, index) => sourceDetails(source, 'ideology-source-' + index)));
  function sourceLink(id) {
    const found = lookup.get(id);
    if (!found) return el('span', tx('ideology.result.missingSource'), 'small');
    const link = el('a', found.source.title || id); link.href = '#ideology-source-' + found.index;
    link.onclick = event => { event.preventDefault(); ide('ideology-citations').open = true; const detail = ide('ideology-source-' + found.index); detail.open = true; detail.scrollIntoView({ behavior: 'smooth', block: 'start' }); };
    return link;
  }
  function evidenceDetails(evidence) {
    if (!Array.isArray(evidence) || !evidence.length) return null;
    const details = el('details', undefined, 'ideology-evidence'); details.append(el('summary', tx('ideology.result.evidence', { n: evidence.length })));
    for (const item of evidence) { const row = el('div'); if (item.quote) row.append(el('blockquote', item.quote)); row.append(sourceLink(item.sourceId)); details.append(row); }
    return details;
  }
  for (const [kind, titleKey, textKey] of [['pillars', 'title', 'text'], ['affinities', 'name', 'why'], ['tensions', 'title', 'text']]) {
    const values = Array.isArray(analysis[kind]) ? analysis[kind] : []; ide('ideology-' + kind + '-section').hidden = !values.length;
    ide('ideology-' + kind).replaceChildren(...values.map(value => {
      const item = el('article', undefined, 'ideology-insight'); item.append(el('h5', value[titleKey] || ''), el('p', value[textKey] || ''));
      if (value.limits) item.append(el('p', value.limits, 'ideology-limits'));
      const evidence = evidenceDetails(value.evidence); if (evidence) item.append(evidence); return item;
    }));
  }
  const questions = Array.isArray(analysis.questions) ? analysis.questions : []; ide('ideology-questions-section').hidden = !questions.length;
  ide('ideology-questions').replaceChildren(...questions.map(question => {
    const item = el('article', undefined, 'ideology-question'); item.append(el('h5', question.question || ''), el('p', question.why || ''));
    const links = el('div', undefined, 'ideology-question-links'); for (const id of question.sourceIds || []) links.append(sourceLink(id)); item.append(links); return item;
  }));
  refreshControls();
}
function schedulePoll() { clearTimeout(ideology.timer); ideology.timer = setTimeout(() => pollStatus(), 1500); }
async function pollStatus() {
  clearTimeout(ideology.timer); ide('ideology-check-status').hidden = true;
  try {
    const status = await ideologyCall('ideology-status', reportScope());
    ideology.job = status.job || null; ideology.stale = !!status.stale;
    if (status.latest) renderResult(status.latest);
    if (ideology.job?.status === 'running') { statusText(phaseText(ideology.job)); schedulePoll(); }
    else if (['failed', 'interrupted', 'uncertain'].includes(ideology.job?.status)) { setIdeologyError(ideology.job.error || tx('ideology.status.jobFailed')); statusText('ideology.status.runFailed'); }
    else if (status.latest) { setIdeologyError(''); statusText(ideology.stale || ideology.changed ? 'ideology.status.savedStale' : 'ideology.status.updated'); }
    else statusText('ideology.status.none');
  } catch (err) {
    setIdeologyError(err.message + ' ' + tx('ideology.status.unverified')); ide('ideology-check-status').hidden = false;
    statusText('ideology.status.unreachable');
  } finally { refreshControls(); }
}
async function loadPreview() {
  const request = ++ideology.previewRequest; ideology.pending = true; refreshControls();
  try {
    const preview = await ideologyCall('ideology-preview', reportScope()); if (request !== ideology.previewRequest) return;
    renderPreview(preview);
    if (preview.job?.status === 'running') { statusText(phaseText(preview.job)); schedulePoll(); }
    else if (['failed', 'interrupted', 'uncertain'].includes(preview.job?.status)) { setIdeologyError(preview.job.error || tx('ideology.status.previousFailed')); statusText('ideology.status.previousKept'); }
    else statusText(preview.latest ? 'ideology.status.latestKept' : 'ideology.status.choose');
  } catch (err) { statusText('ideology.status.scopeFailed'); setIdeologyError(err.message); }
  finally { if (request === ideology.previewRequest) { ideology.pending = false; refreshControls(); } }
}
function renderModels() {
  const selected = target(), previous = ide('ideology-model').value;
  const models = ideology.models.filter(model => model.developer === selected.developer);
  const option = (value, name) => { const item = el('option', name); item.value = value; return item; };
  ide('ideology-model').replaceChildren(option('', models.length ? tx('ideology.modelChoose') : tx('ideology.modelNone')), ...models.map(model => option(model.id, model.name || model.id)));
  if (models.some(model => model.id === previous)) ide('ideology-model').value = previous;
  refreshControls();
}
function renderConnection() {
  const connection = target().connection, chat = ideology.connections.chatgpt || {};
  ide('ideology-chatgpt').hidden = connection !== 'chatgpt'; ide('ideology-openrouter').hidden = connection !== 'openrouter';
  ide('ideology-model-field').hidden = connection === 'manual'; ide('ideology-manual-model-field').hidden = connection !== 'manual'; ide('ideology-model-refresh').hidden = connection === 'manual';
  const connectionStatus = chat.pending ? tx('ideology.chatgpt.pending') : chat.connected && chat.sharing !== true ? tx('ideology.chatgpt.noSharing') : chat.connected ? tx('ideology.chatgpt.connected') + (chat.accountLabel ? ' · ' + chat.accountLabel : '') : tx('ideology.chatgpt.notConnected');
  ide('ideology-chatgpt-status').textContent = connectionStatus + (chat.error ? ' ' + toreI18n.server(chat.error) : '');
  ide('ideology-chatgpt-login').hidden = chatgptReady(); ide('ideology-chatgpt-disconnect').hidden = !chat.connected && !chat.pending;
  ide('ideology-key-status').textContent = ideology.connections.openrouter?.configured ? tx('ideology.key.set') : tx('ideology.key.unset');
  ide('ideology-connection-note').textContent = connection === 'chatgpt' ? tx('ideology.note.chatgpt') : connection === 'openrouter' ? tx('ideology.note.openrouter') : tx('ideology.note.manual');
  if (connection === 'chatgpt') ide('ideology-developer').value = 'openai';
  renderModels();
}
async function refreshConnections() {
  clearTimeout(ideology.authTimer);
  try {
    ideology.connections = await ideologyCall('connections'); renderConnection();
    if (ideology.connections.chatgpt?.pending) ideology.authTimer = setTimeout(refreshConnections, 1500);
  } catch (err) { setIdeologyError(err.message); }
}
async function connectionAction(op, body = {}) {
  if (ideology.connectionBusy || running()) return; invalidate(); ideology.connectionBusy = true; setIdeologyError(''); refreshControls();
  try { await ideologyCall(op, body); await refreshConnections(); }
  catch (err) { setIdeologyError(err.message); }
  finally { ideology.connectionBusy = false; refreshControls(); }
}
async function loadModels() {
  if (running()) return; invalidate(); const request = ++ideology.modelRequest, connection = target().connection;
  if (connection === 'manual') return;
  keyed(ide('ideology-model-note'), 'ideology.modelsChecking'); ideology.connectionBusy = true; refreshControls();
  try {
    const catalog = await ideologyCall('ideology-models', { connection, refresh: true });
    if (request !== ideology.modelRequest || target().connection !== connection) return;
    ideology.models = Array.isArray(catalog.models) ? catalog.models : []; renderModels();
    const warnings = (catalog.warnings || []).map(warning => toreI18n.server(warning)).join(' ');
    if (warnings) unkeyed(ide('ideology-model-note'), warnings); else keyed(ide('ideology-model-note'), ideology.models.length ? 'ideology.modelsReady' : 'ideology.modelsEmpty');
  } catch (err) { if (request === ideology.modelRequest) { ideology.models = []; renderModels(); unkeyed(ide('ideology-model-note'), err.message); } }
  finally { ideology.connectionBusy = false; refreshControls(); }
}
// The interface text around a prepared draft; the draft text itself never changes.
function draftLabels(draft) {
  const manual = draft.target.connection === 'manual';
  ide('ideology-draft-target').textContent = `${developerName(draft.target.developer)}${draft.target.modelId ? ' · ' + draft.target.modelId : ''} · ${manual ? tx('ideology.target.manual') : draft.target.connection === 'chatgpt' ? tx('ideology.target.chatgpt') : tx('ideology.target.openrouter')}`;
  ide('ideology-draft-cost').textContent = draft.cost?.caption || tx('ideology.costUnknown');
  ide('ideology-draft-privacy').textContent = draft.privacy?.caption || tx('ideology.privacyDefault');
  const findings = Array.isArray(draft.findings) ? draft.findings : [];
  ide('ideology-findings').replaceChildren(...findings.map(finding => el('p', tx('ideology.finding', { kind: finding.kind || tx('ideology.findingKind'), source: ideology.rows.get(finding.sourceId)?.source.title || tx('ideology.findingSource') }), 'small')));
  if (!findings.length) ide('ideology-findings').append(el('p', tx('ideology.findingsNone'), 'small'));
  keyed(ide('ideology-send-consent-label'), manual ? 'ideology.consentManual' : 'ideology.consentSend');
}
function renderDraft(draft) {
  ideology.draft = draft; ideology.attempted = false; ide('ideology-outbound').hidden = false;
  const manual = draft.target.connection === 'manual';
  ide('ideology-prompt').textContent = draft.prompt || '';
  draftLabels(draft);
  ide('ideology-send').hidden = manual; ide('ideology-manual').hidden = !manual;
  ide('ideology-send-consent').checked = false; ide('ideology-manual-consent').checked = false;
  ide('ideology-service-link').href = developers.find(row => row[0] === draft.target.developer)?.[2] || 'https://chatgpt.com/';
  ide('ideology-selection-note').hidden = true; refreshControls();
}
async function prepareDraft() {
  if (ide('ideology-prepare').disabled) return; const revision = ideology.revision;
  ideology.pending = true; setIdeologyError(''); refreshControls();
  const selected = [...ideology.rows.values()].filter(row => row.selected);
  try {
    const prepared = await ideologyCall('ideology-prepare', { ...reportScope(), target: target(), sourceIds: selected.map(row => row.source.id), edits: selected.map(row => ({ id: row.source.id, text: row.text })) });
    if (revision !== ideology.revision) return;
    if (!prepared.draft?.id || !prepared.draft?.hash) throw Error(tx('ideology.status.previewInvalid'));
    renderDraft(prepared.draft); statusText(prepared.draft.canSend ? 'ideology.status.previewReady' : 'ideology.status.previewBlocked');
    ide('ideology-outbound').scrollIntoView({ behavior: 'smooth', block: 'start' });
  } catch (err) { setIdeologyError(err.message); }
  finally { ideology.pending = false; refreshControls(); }
}
async function sendDraft(manual = false) {
  if (ide(manual ? 'ideology-manual-save' : 'ideology-send').disabled || !ideology.draft) return;
  const draft = ideology.draft; ideology.pending = true; ideology.attempted = true; setIdeologyError(''); refreshControls();
  const request = { draftId: draft.id, draftHash: draft.hash, confirmed: true, requestId: crypto.randomUUID() };
  if (manual) request.text = ide('ideology-manual-response').value;
  try {
    const response = await ideologyCall(manual ? 'ideology-manual' : 'ideology-send', request);
    ideology.job = response.job || null; ideology.changed = false; ideology.stale = !!response.stale;
    if (response.latest) renderResult(response.latest);
    if (ideology.job?.status === 'running') { statusText(phaseText(ideology.job)); schedulePoll(); }
    else if (response.latest) statusText('ideology.status.manualSaved');
    else await pollStatus();
  } catch (err) {
    setIdeologyError(err.message + ' ' + tx('ideology.status.sendKept')); statusText('ideology.status.sendFailed'); ide('ideology-check-status').hidden = false;
  } finally { ideology.pending = false; refreshControls(); }
}
async function copyDraft() {
  if (ide('ideology-copy').disabled || !ideology.draft) return;
  try { await navigator.clipboard.writeText(ideology.draft.prompt); keyed(ide('ideology-copy-status'), 'ideology.copied'); }
  catch { keyed(ide('ideology-copy-status'), 'ideology.copyDenied'); }
}
for (const [id, name] of developers) { const option = el('option', name); option.value = id; ide('ideology-developer').append(option); }
for (const id of ['ideology-nav', 'ideology-update']) ide(id).onclick = () => { showIdeology(); if (!running()) { invalidate(); loadPreview(); } };
ide('ideology-refresh').onclick = () => { if (!running()) { invalidate(); loadPreview(); } };
ide('ideology-show-latest').onclick = showIdeology;
ide('ideology-close').onclick = () => { ide('ideology-panel').hidden = true; ide('ideology-nav').setAttribute('aria-expanded', 'false'); };
ide('ideology-check-status').onclick = pollStatus;
ide('ideology-connection').onchange = () => { ideology.modelRequest++; ideology.models = []; ide('ideology-model-note').textContent = ''; invalidate(); renderConnection(); };
ide('ideology-developer').onchange = () => { invalidate(); renderModels(); };
ide('ideology-model').onchange = () => invalidate(); ide('ideology-manual-model').oninput = () => invalidate();
ide('ideology-model-refresh').onclick = loadModels;
ide('ideology-chatgpt-login').onclick = () => connectionAction('chatgpt-login');
ide('ideology-chatgpt-disconnect').onclick = () => connectionAction('chatgpt-disconnect');
ide('ideology-save-key').onclick = () => { const key = ide('ideology-key').value.trim(); ide('ideology-key').value = ''; if (!key) { setIdeologyError(tx('ideology.keyMissing')); return; } connectionAction('key', { key }); };
ide('ideology-clear-key').onclick = () => { ide('ideology-key').value = ''; connectionAction('key', { key: '' }); };
for (const [id, selected] of [['ideology-select-sources', true], ['ideology-clear-sources', false]]) ide(id).onclick = () => { for (const row of ideology.rows.values()) row.selected = selected; invalidate(); renderSourceEditors(); refreshControls(); };
ide('ideology-reviewed').onchange = refreshControls; ide('ideology-send-consent').onchange = refreshControls; ide('ideology-manual-consent').onchange = refreshControls; ide('ideology-manual-response').oninput = refreshControls;
ide('ideology-prepare').onclick = prepareDraft; ide('ideology-send').onclick = () => sendDraft(); ide('ideology-copy').onclick = copyDraft; ide('ideology-manual-save').onclick = () => sendDraft(true);
window.addEventListener('tore-opinions-updated', () => { ideology.changed = true; ideology.stale = true; ideology.preview = null; invalidate('ideology.opinionsChanged'); if (!running()) statusText('ideology.opinionsChangedStatus'); refreshControls(); });
window.addEventListener('pagehide', () => { clearTimeout(ideology.timer); clearTimeout(ideology.authTimer); });
// A language switch redraws the panel in place: selections, edited source texts,
// a prepared draft and its consent ticks all stay as they are.
function relabelIdeology() {
  redrawKeyed();
  renderConnection();
  if (ideology.preview) {
    const reports = Array.isArray(ideology.preview.reports) ? ideology.preview.reports : [], selected = reports.filter(report => report.selected);
    ide('ideology-coverage').textContent = [tn('ideology.coverage.confirmed', ideology.preview.confirmedCount || 0), tn('ideology.coverage.reports', selected.length), tn('ideology.coverage.excluded', ideology.preview.excludedCount || 0)].join(' · ') + (ideology.preview.scopeMessage ? ` · ${ideology.preview.scopeMessage}` : '');
    ide('ideology-engine').textContent = tx('ideology.localOff');
    for (const [index, report] of reports.entries()) {
      const small = ide('ideology-reports').querySelectorAll('.ideology-report-choice small')[index]; if (!small) continue;
      const total = Number(report.totalCharacters) || 0, included = Number(report.includedCharacters) || 0;
      small.textContent = included < total ? tx('ideology.charsPartial', { included: formatCount(included), total: formatCount(total) }) : tn('ideology.chars', total, { count: formatCount(total) });
    }
    const none = ide('ideology-reports').querySelector('p.small'); if (none && !reports.length) none.textContent = tx('ideology.reportsNone');
  }
  const open = new Set([...ide('ideology-input-sources').querySelectorAll('details[open] [data-source-id]')].map(input => input.dataset.sourceId));
  renderSourceEditors();
  for (const input of ide('ideology-input-sources').querySelectorAll('[data-source-id]')) if (open.has(input.dataset.sourceId)) input.closest('details').open = true;
  if (ideology.latest) { const citations = ide('ideology-citations').open; renderResult(ideology.latest, true); ide('ideology-citations').open = citations; }
  if (ideology.draft && !ide('ideology-outbound').hidden) draftLabels(ideology.draft);
  refreshControls();
}
toreI18n.onChange(relabelIdeology);
toreI18n.init(ideologyCall).then(() => { renderConnection(); loadPreview(); refreshConnections(); });
