import { api } from '/private-client.js';

// All records and replies stay behind the existing loopback capability. This
// screen never invokes a model or sends a conversation to a remote service.
(() => {
  'use strict';
  const $ = id => document.getElementById(id);
  const call = (op, body = {}) => api('/api/private/tore/' + op, body);
  // Interface text comes from i18n.js and i18n-return.js. Everything below is
  // read at call time, so a language switch relabels the page in place.
  const I18N = globalThis.toreI18n;
  const tx = (k, v) => I18N.t(k, v);
  const tn = (k, c, v) => I18N.n(k, c, v);
  // One vocabulary for every list, form and badge on this page (KARARLAR §2).
  const labels = {
    get kind() { return { opinion: tx('return.kind.opinion'), decision: tx('return.kind.decision'), question: tx('return.kind.question'), task: tx('return.kind.task') }; },
    get review() { return { pending: tx('return.label.review.pending'), reviewed: tx('return.label.review.reviewed'), rejected: tx('return.label.review.rejected') }; },
    get adoption() { return { unknown: tx('return.label.notStated'), adopted: tx('return.label.adoption.adopted'), hypothesis: tx('return.label.adoption.hypothesis'), uncertain: tx('return.label.adoption.uncertain'), not_adopted: tx('return.label.adoption.notAdopted'), not_applicable: tx('return.label.adoption.notApplicable') }; },
    get currency() { return { unknown: tx('return.label.notStated'), current: tx('return.label.currency.current'), superseded: tx('return.label.currency.superseded') }; },
    get priority() { return { unspecified: tx('return.label.notStated'), active: tx('return.label.priority.active'), paused: tx('return.label.priority.paused'), not_priority: tx('return.label.priority.notPriority') }; },
    get inbox() { return { note: tx('return.inbox.kind.note'), decision: tx('return.kind.decision'), question: tx('return.kind.question'), task: tx('return.kind.task'), objection: tx('return.inbox.kind.objection') }; }
  };
  const WAITING_QUERY = 'gorunum=bekleyenler';
  // Turkish suffixes follow pronunciation, so only names we know get one.
  const TOOL_FROM_TR = { 'Claude Code': 'Claude Code\'dan', 'Claude Desktop': 'Claude Desktop\'tan', 'Claude': 'Claude\'dan', 'Codex': 'Codex\'ten', 'ChatGPT': 'ChatGPT\'den', 'Cursor': 'Cursor\'dan' };
  // Seni bekleyenler: pending records and connected-tool proposals in one place.
  const W = {
    get fromConversations() { return tx('return.waiting.fromConversations'); },
    get fromReplies() { return tx('return.waiting.fromReplies'); },
    get ownNotes() { return tx('return.waiting.ownNotes'); },
    fromTool: name => (I18N.lang() === 'tr' && TOOL_FROM_TR[name]) || (name ? tx('return.waiting.fromToolNamed', { name }) : tx('return.waiting.fromToolAny')),
    proposals: n => tn('return.waiting.proposals', n),
    get adopt() { return tx('return.waiting.adopt'); }, get keepQuestion() { return tx('return.waiting.keepQuestion'); }, get keepTask() { return tx('return.waiting.keepTask'); },
    get leave() { return tx('return.waiting.leave'); }, get edit() { return tx('return.waiting.edit'); }, get remove() { return tx('return.waiting.remove'); }, get details() { return tx('return.details'); },
    get consent() { return tx('return.consent.decide'); },
    get consentHint() { return tx('return.waiting.consentHint'); },
    adopted: text => tx('return.waiting.adopted', { text }),
    keptOpen: (kind, text) => tx(kind === 'task' ? 'return.waiting.keptTask' : 'return.waiting.keptQuestion', { text }),
    left: n => tn('return.waiting.left', n),
    leftNow: text => tx('return.waiting.leftNow', { text }),
    removed: text => tx('return.waiting.removed', { text }),
    skippedCount: n => tn('return.waiting.skippedCount', n),
    get paneEmpty() { return tx('return.waiting.paneEmpty'); },
    get openTopic() { return tx('return.openTopic'); }, get openSource() { return tx('return.source.openFull'); },
    get proposalFrom() { return tx('return.waiting.proposalFrom'); },
    related: kind => kind === 'task' ? tx('return.waiting.relatedTask') : kind === 'question' ? tx('return.waiting.relatedQuestion') : tx('return.waiting.relatedRecord'),
    get proposalNote() { return tx('return.waiting.proposalNote'); },
    topic: name => tx('return.waiting.topic', { name })
  };
  const T = {
    status: {
      get review() { return { pending: tx('return.status.review.pending'), rejected: tx('return.status.review.rejected') }; },
      get adoption() { return { unknown: tx('return.status.adoption.unknown'), adopted: tx('return.status.adoption.adopted'), hypothesis: tx('return.status.adoption.hypothesis'), uncertain: tx('return.status.adoption.uncertain'), not_adopted: tx('return.status.adoption.notAdopted'), not_applicable: '' }; },
      get currency() { return { unknown: tx('return.status.currency.unknown'), current: tx('return.status.currency.current'), superseded: tx('return.status.currency.superseded') }; },
      get priority() { return { active: tx('return.status.priority.active'), paused: tx('return.status.priority.paused'), not_priority: tx('return.status.priority.notPriority') }; },
      get open() { return { open: tx('return.status.open.open'), closed: tx('return.status.open.closed'), unsure: tx('return.status.open.unsure') }; }
    },
    get aiLabel() { return tx('return.aiLabel'); },
    get groups() { return { decision: tx('return.group.decisions'), opinion: tx('return.group.opinions') }; },
    count: n => tn('return.count.records', n),
    get noCurrentGroups() { return tx('return.noCurrentGroups'); },
    get showSource() { return tx('return.showSource'); },
    get ownNoteTitle() { return tx('return.ownNoteTitle'); },
    get ownNote() { return tx('return.ownNote'); },
    get noExcerpt() { return tx('return.noExcerpt'); },
    get untitledSource() { return tx('return.untitledSource'); },
    get replyTitle() { return tx('return.replyTitle'); },
    get yourRecord() { return tx('return.yourRecord'); },
    get reviewNote() { return tx('return.waiting.note'); },
    reviewNoteInbox: n => tn('return.waiting.noteInbox', n),
    waiting: W,
    start: {
      importDone: n => tn('return.start.importDone', n),
      get importMore() { return tx('return.start.importMore'); }
    }
  };
  const targets = {
    chatgpt: ['ChatGPT', 'https://chatgpt.com/'], gemini: ['Google Gemini', 'https://gemini.google.com/'],
    claude: ['Claude', 'https://claude.ai/'], meta: ['Meta AI', 'https://www.meta.ai/'], xai: ['xAI / Grok', 'https://grok.com/'],
    deepseek: ['DeepSeek', 'https://chat.deepseek.com/'], kimi: ['Kimi', 'https://www.kimi.com/'],
    glm: ['GLM', 'https://chat.z.ai/'], qwen: ['Alibaba / Qwen', 'https://chat.qwen.ai/'], mistral: ['Mistral', 'https://chat.mistral.ai/'],
    nvidia: ['NVIDIA', 'https://build.nvidia.com/'], openrouter: ['OpenRouter', null], get other() { return [tx('return.target.otherService'), null]; }
  };
  const state = { data: { topics: [], records: [], packets: [], replies: [], backups: [], conversationLinks: [] }, topicId: '', screen: 'overview', tab: 'now', view: 'current', sourceRecordId: null, queuePage: 0, sourceCheckLimit: 6, dashboardLimits: { decisions: 6, opinions: 6, resume: 6 }, editing: null, source: null, packet: null, selected: new Set(), migration: null, bulk: null, conversationLimit: 20, overviewLimits: { approved: 8, candidates: 8 }, recordLimit: 30, busy: false, requestKeys: new Map(), replyDrafts: new Map(), inbox: [], inboxFailed: false, toolAccess: null, extra: null, editorClean: '', afterDiscard: null, skipped: new Set(), waitingSelected: null, conversationCount: null };
  const node = (tag, value, cls) => { const el = document.createElement(tag); if (value != null) el.textContent = String(value); if (cls) el.className = cls; return el; };
  const button = (title, cls) => { const el = node('button', title, cls); el.type = 'button'; return el; };
  const text = (id, value) => { $(id).textContent = value ?? ''; };
  const show = (id, yes) => { $(id).hidden = !yes; };
  const date = value => { if (!value || Number.isNaN(new Date(value).getTime())) return tx('return.noDate'); return new Date(value).toLocaleString(I18N.locale(), { dateStyle: 'medium', timeStyle: 'short' }); };
  const option = (value, title) => { const el = node('option', title); el.value = value; return el; };
  const calm = () => { try { return matchMedia('(prefers-reduced-motion: reduce)').matches; } catch { return true; } };
  const reveal = (el, focus) => { el.scrollIntoView({ block: 'start', behavior: calm() ? 'auto' : 'smooth' }); if (focus) focus.focus({ preventScroll: true }); };
  const stateful = kind => kind === 'question' || kind === 'task';
  const pendingRecords = () => state.data.records.filter(record => record.review === 'pending');
  // The top menu counts everything that waits: pending records and tool proposals.
  // The page heading counts what is in the list now, without the ones left for later.
  function updateWaitingCounts() {
    const all = pendingRecords().length + state.inbox.length, listed = all - pendingRecords().filter(r => state.skipped.has(r.id)).length;
    text('topnav-waiting-count', all ? ' ' + all : ''); text('waiting-count', ' · ' + listed);
  }
  const topicName = id => state.data.topics.find(topic => topic.id === id)?.title || tx('return.topicMissing');
  const visibleTopics = () => state.data.topics.filter(topic => topic.id !== 'bulk-topic-other' || state.data.records.some(record => record.topicId === topic.id) || state.data.conversationLinks.some(link => link.topicId === topic.id));
  const currentTopic = () => state.data.topics.find(t => t.id === state.topicId);
  const topicRecords = () => state.data.records.filter(r => r.topicId === state.topicId);
  const requestId = (op, body) => { const key = op + JSON.stringify(body); if (!state.requestKeys.has(key)) state.requestKeys.set(key, crypto.randomUUID()); return state.requestKeys.get(key); };
  const mutation = (op, body) => call(op, { ...body, requestId: requestId(op, body) });
  const roleName = role => role === 'assistant' ? tx('return.role.assistant') : role === 'user' || role === 'human' ? tx('return.role.user') : tx('return.role.unknown');
  const isProposal = record => record.attribution === 'assistant_proposal' || record.provenance === 'assistant_proposal' || record.source?.role === 'assistant' || record.source?.speaker === 'assistant';
  const ownNote = record => !record.source && !isProposal(record);
  const origin = record => isProposal(record) ? tx('return.aiLabel') : !record.source ? tx('return.ownNoteTitle') : record.source.excerpt && record.text === record.source.excerpt ? tx('return.origin.verbatim') : tx('return.origin.edited');
  const isCurrent = record => record.review === 'reviewed' && record.currency === 'current' && (stateful(record.kind) ? record.questionState === 'open' : record.adoption === 'adopted');
  const isSelectableProposal = record => isProposal(record) && record.review === 'reviewed' && record.currency === 'current' && !stateful(record.kind) && record.adoption !== 'adopted';
  const isOpenTask = record => record.kind === 'task' && record.questionState === 'open' && record.review !== 'rejected' && record.currency !== 'superseded';
  const openState = record => record.questionState === 'closed' ? 'closed' : record.review === 'reviewed' && record.currency === 'current' ? 'open' : 'unsure';
  // One quiet status line per record. Only an AI suggestion and a record that
  // waits for review get their own mark; everything else is plain text.
  function statusParts(record) {
    const s = T.status, parts = [labels.kind[record.kind] || record.kind];
    if (record.review === 'rejected') parts.push(s.review.rejected);
    if (stateful(record.kind)) parts.push(s.open[openState(record)]);
    else parts.push(s.adoption[record.adoption] ?? record.adoption);
    parts.push(s.currency[record.currency] ?? record.currency);
    if (s.priority[record.priority]) parts.push(s.priority[record.priority]);
    return parts.filter(Boolean);
  }
  function statusLine(record, parts = statusParts(record), ai = isProposal(record), pending = record.review === 'pending') {
    const line = node('p', null, 'record-status'), add = (value, cls) => { const span = node('span', value, cls); span.dataset.status = ''; line.append(span); };
    if (pending) { add(T.status.review.pending, 'status-pending'); line.append(' '); }
    if (ai) { add(T.aiLabel, 'voice-ai-label'); line.append(' '); }
    parts.forEach((part, index) => { if (index) line.append(' · '); add(part); });
    return line;
  }

  // Known local-service messages, rewritten to say what happened and what to do.
  const translations = [
    [/Yerel oturum açık değil/, 'return.err.session'],
    [/Yerel hizmet geçerli yanıt vermedi/, 'return.err.noAnswer'],
    [/Konu deposu dışarıdan değişmiş/, 'return.err.notebookChanged'],
    [/Kayıt değişmiş; yeniden yükleyin/, 'return.err.recordChanged'],
    [/Konu deposu sürümü veya kapasitesi/, 'return.err.notebookOpen'],
    [/revizyon zinciri geçersiz|Kayıt konu bağlantısı geçersiz/, 'return.err.history'],
    [/Kayıt içeriği veya durumları geçersiz/, 'return.err.invalidRecord'],
    [/1–40 kayıt seçin/, 'return.err.packetCount'],
    [/Devam bağlamı çok büyük/, 'return.err.packetSize'],
    [/Eski görüşler değişti; önizlemeyi yeniden açın/, 'return.err.legacyChanged'],
    [/Öneri bulunamadı veya daha önce işlendi/, 'return.err.proposalGone'],
    [/Öneri bırakma izni için önce okuma izni gerekir/, 'return.err.writeNeedsRead'],
    [/100 yerel yedek sınırı/, 'return.err.backupLimit'],
    [/Konu adı veya amacı geçersiz/, 'return.err.topicInvalid'],
    [/İşlem tamamlanamadı; başarı bildirilmedi/, 'return.err.notDone']
  ];
  // Turkish wording is matched on the message shown; in English the original
  // service message is matched too, because it reaches here already translated.
  const friendly = failure => {
    const raw = String((failure && typeof failure === 'object' ? failure.message : failure) || ''), server = String(failure?.serverMessage || '');
    for (const [pattern, key] of translations) if (pattern.test(raw) || (I18N.lang() === 'en' && server && pattern.test(server))) return tx(key);
    return raw || tx('return.err.generic');
  };
  const errorNode = target => typeof target === 'string' ? $(target) : target;
  const error = (target, message = '') => { const el = errorNode(target); if (!el) return; el.textContent = message; el.hidden = !message; };
  // The message appears next to the control that caused it; only that control
  // is disabled while the request runs, so focus and scroll position stay put.
  async function run(trigger, errorTarget, action) {
    if (state.busy) return;
    const control = typeof trigger === 'string' ? $(trigger) : trigger, wasDisabled = control?.disabled;
    state.busy = true; $('main').setAttribute('aria-busy', 'true'); if (control) control.disabled = true;
    error(errorTarget); let after;
    try { after = await action(); }
    catch (e) { error(errorTarget, friendly(e)); }
    finally { state.busy = false; $('main').removeAttribute('aria-busy'); if (control?.isConnected) control.disabled = wasDisabled; readiness(); }
    if (typeof after === 'function') after();
  }
  function readiness() {
    $('context-copy').disabled = state.busy || !state.packet || !$('context-consent').checked;
    show('context-copy-hint', Boolean(state.packet) && !$('context-consent').checked);
    $('tool-share-open').disabled = state.busy || !state.packet || state.packet.sharedWithTools === true || !$('tool-share-consent').checked;
    $('tool-share-close').disabled = state.busy || !state.packet || state.packet.sharedWithTools !== true;
    $('reply-save').disabled = state.busy || !state.packet || !$('reply-text').value.trim();
    $('migration-apply').disabled = state.busy || !state.migration || !$('migration-consent').checked || !state.migration.candidates?.length;
    $('bulk-apply').disabled = state.busy || !state.bulk || !$('bulk-consent').checked || !(state.bulk.topics?.some(t => t.newLinkCount > 0) || state.bulk.candidateCount > 0);
    show('bulk-hint', Boolean(state.bulk) && !$('bulk-consent').checked);
    $('restore-apply').disabled = state.busy || !$('restore-consent').checked || !$('restore-backup').value;
    show('restore-hint', $('restore-apply').disabled);
    show('context-service-link', Boolean(state.packet && $('context-consent').checked && targets[state.packet.target]?.[1]));
    const queued = filteredQueue();
    $('review-open-first').disabled = state.busy || !queued.length; $('review-prev').disabled = state.busy || state.queuePage === 0; $('review-next').disabled = state.busy || (state.queuePage + 1) * 20 >= queued.length;
    toolAccessReadiness(); allToolAccessReadiness(); quickReadiness();
  }
  async function refresh() {
    state.data = await call('records-list');
    for (const field of ['topics', 'records', 'packets', 'replies', 'backups']) if (!Array.isArray(state.data[field])) throw Error(tx('return.err.partialRead'));
    if (state.data.conversationLinks === undefined) state.data.conversationLinks = [];
    if (!Array.isArray(state.data.conversationLinks)) throw Error(tx('return.err.linksRead'));
    if (!state.data.topics.some(t => t.id === state.topicId)) state.topicId = state.data.topics[0]?.id || '';
    if (!Array.isArray(state.data.trash)) state.data.trash = [];
    // An empty notebook asks once how many conversations are already imported, so the
    // first-run steps can say so. Without an answer the step simply stays open.
    if (!state.data.topics.length) { try { const info = await call('status'); state.conversationCount = Number.isInteger(info?.conversationCount) ? info.conversationCount : null; } catch { state.conversationCount = null; } }
    for (const id of [...state.skipped]) if (!state.data.records.some(record => record.id === id && record.review === 'pending')) state.skipped.delete(id);
    renderTopics(); renderTopic(); renderGlobal(); renderBackups(); renderTrash(); syncAllToolAccess();
    await loadExtras();
  }
  function renderTopics() {
    text('topic-count', visibleTopics().length); text('pending-count', pendingRecords().length);
    $('topic-count').nextElementSibling.textContent = tn('return.meta.topics', visibleTopics().length); $('pending-count').nextElementSibling.textContent = tn('return.meta.pending', pendingRecords().length);
    text('review-nav-count', pendingRecords().length); updateWaitingCounts();
    $('nav-overview').setAttribute('aria-current', state.screen === 'overview' ? 'page' : 'false'); $('nav-review').setAttribute('aria-current', state.screen === 'review' ? 'page' : 'false');
    for (const [id, yes] of [['topnav-topics', state.screen !== 'review'], ['topnav-waiting', state.screen === 'review']]) { if (yes) $(id).setAttribute('aria-current', 'page'); else $(id).removeAttribute('aria-current'); }
    const list = $('topic-list'); list.replaceChildren();
    if (!state.data.topics.length) list.append(node('p', tx('return.topics.none'), 'small'));
    const search = $('topic-search').value.trim().toLocaleLowerCase('tr-TR'), topics = visibleTopics().filter(topic => !search || topic.title.toLocaleLowerCase('tr-TR').includes(search));
    if (state.data.topics.length && !topics.length) list.append(node('p', tx('return.topics.noMatch'), 'small'));
    for (const topic of topics) {
      const records = state.data.records.filter(r => r.topicId === topic.id), item = button(null, 'topic-item'); item.dataset.topicId = topic.id; item.setAttribute('aria-current', String(state.screen === 'topic' && topic.id === state.topicId));
      item.append(node('strong', topic.title), node('span', tx('return.topics.counts', { current: records.filter(isCurrent).length, pending: records.filter(r => r.review === 'pending').length }) + ' · ' + tn('return.count.conversations', state.data.conversationLinks.filter(link => link.topicId === topic.id).length)));
      item.onclick = () => guard(() => selectTopic(topic.id)); list.append(item);
    }
    const previous = $('record-topic').value; $('record-topic').replaceChildren(...state.data.topics.map(t => option(t.id, t.title))); $('record-topic').value = state.data.topics.some(t => t.id === previous) ? previous : state.topicId;
  }
  function selectTopic(id) {
    if (state.busy || (state.screen === 'topic' && state.topicId === id)) return;
    state.topicId = id; state.screen = 'topic'; state.tab = 'now'; state.view = 'current'; state.sourceRecordId = null; state.conversationLimit = 20; state.recordLimit = 30; state.overviewLimits = { approved: 8, candidates: 8 }; $('topic-conversation-search').value = ''; closeEditor(); show('context-panel', false); show('reply-panel', false); invalidatePacket(); text('record-result', '');
    history.replaceState(null, '', '/konular?topicId=' + encodeURIComponent(id)); renderTopics(); renderTopic(); renderGlobal(); loadExtras();
  }
  function recordFoot(record, ...controls) {
    const foot = node('div', null, 'record-foot'), actions = node('div', null, 'record-actions');
    actions.append(...controls); foot.append(node('p', origin(record) + ' · ' + date(record.updatedAt || record.createdAt), 'small'), actions); return foot;
  }
  // --- Kaynak bölmesi: seçilen kaydın kaynağı ve kaydın kendisi --------------
  const narrow = () => { try { return matchMedia('(max-width: 900px)').matches; } catch { return false; } };
  function sourceButton(record) {
    const view = button(T.showSource, 'quiet'); view.dataset.sourceRecord = record.id; view.setAttribute('aria-controls', 'source-pane'); view.setAttribute('aria-label', T.showSource + ': ' + record.text.slice(0, 80));
    view.onclick = () => showSource(record.id, true); return view;
  }
  // A click on the card itself (not on one of its controls) also opens the source.
  function sourceOnClick(article, record) {
    article.addEventListener('click', event => { if (event.target.closest('button,a,summary,input,label,select,textarea,details')) return; showSource(record.id, false); });
  }
  function showSource(id, moveFocus) {
    state.sourceRecordId = id; renderSourcePane();
    if (!moveFocus) return;
    if (narrow()) reveal($('source-pane'), $('source-pane-heading')); else $('source-pane-heading').focus({ preventScroll: true });
  }
  function renderSourcePane() {
    const onTopic = state.screen === 'topic' && Boolean(currentTopic());
    $('desk').dataset.screen = onTopic ? 'topic' : state.screen; show('source-pane', onTopic); if (state.screen !== 'review') show('waiting-pane', false);
    const record = onTopic ? topicRecords().find(r => r.id === state.sourceRecordId) : null;
    for (const card of document.querySelectorAll('#topic-view [data-record-id],#topic-view [data-open-task],#topic-view [data-overview-record],#topic-view [data-open-question]')) {
      const id = card.dataset.recordId || card.dataset.openTask || card.dataset.overviewRecord || card.dataset.openQuestion; card.classList.toggle('is-source', Boolean(record) && id === record.id);
    }
    show('source-pane-empty', !record); show('source-pane-body', Boolean(record));
    if (!record) return;
    const source = record.source || record.legacy?.source || null, excerpt = source ? source.excerpt || source.originalText || '' : '';
    text('source-pane-title', source ? [source.provider, source.title || source.conversationTitle || (source.replyId ? T.replyTitle : T.untitledSource)].filter(Boolean).join(' · ') : T.ownNoteTitle);
    text('source-pane-date', date(source ? sourceTime(record) : record.createdAt));
    text('source-pane-role', source ? roleName(source.role || source.speaker) : ''); show('source-pane-role', Boolean(source));
    text('source-pane-excerpt', excerpt); show('source-pane-excerpt', Boolean(excerpt));
    text('source-pane-none', source ? T.noExcerpt : T.ownNote); show('source-pane-none', !excerpt);
    show('source-pane-open', Boolean(source?.conversationId));
    if (source?.conversationId) $('source-pane-open').href = '/calisma?conversationId=' + encodeURIComponent(source.conversationId) + (source.messageId ? '&messageId=' + encodeURIComponent(source.messageId) : '');
    const ai = isProposal(record), voice = $('source-pane-voice'); voice.replaceChildren(ai ? node('span', T.aiLabel, 'voice-ai-label') : T.yourRecord);
    $('source-pane-record').classList.toggle('voice-ai', ai);
    text('source-pane-text', record.text); $('source-pane-status').replaceChildren(statusLine(record, statusParts(record), false));
  }
  const byUpdated = (a, b) => String(b.updatedAt || b.createdAt).localeCompare(String(a.updatedAt || a.createdAt));
  function recordCard(record) {
    const article = node('article', null, 'record-card'); article.dataset.recordId = record.id;
    article.append(statusLine(record), node('p', record.text, 'record-text')); if (record.reason) article.append(node('p', record.reason, 'reason'));
    if (record.answersQuestionId) { const question = state.data.records.find(r => r.id === record.answersQuestionId); if (question) { const link = button(tx('return.answersQuestion', { text: question.text }), 'quiet'); link.onclick = () => guard(() => editRecord(question), question); article.append(link); } }
    const edit = button(tx('return.review'), 'quiet'); edit.dataset.editRecord = record.id; edit.setAttribute('aria-label', tx('return.review') + ': ' + record.text.slice(0, 80)); edit.onclick = () => guard(() => editRecord(record), record);
    article.append(recordFoot(record, sourceButton(record), edit));
    const latest = record.history?.at(-1); if (latest?.changeReason) article.append(node('p', tx('return.lastChange', { reason: latest.changeReason }), 'small'));
    sourceOnClick(article, record); return article;
  }
  function moreRecords(remaining) {
    const more = button(tn('return.moreRecords', remaining), 'quiet overview-more'); more.id = 'records-more'; more.onclick = () => { state.recordLimit += 30; renderTopic(); }; return more;
  }
  function renderTopic() {
    const topic = currentTopic(); show('empty-topic', state.screen === 'topic' && !topic); show('topic-view', state.screen === 'topic' && Boolean(topic));
    show('tool-access', state.screen === 'topic' && Boolean(topic));
    if (!topic) { show('commentaries-panel', false); renderSourcePane(); return; }
    text('topic-title', topic.title); text('crumb-topic', topic.title); text('topic-description', topic.goal || tx('return.topic.noGoal'));
    const records = topicRecords(), current = records.filter(isCurrent), decisions = current.filter(r => r.kind === 'decision'), questions = records.filter(r => r.kind === 'question' && r.questionState === 'open' && r.review === 'reviewed' && r.currency === 'current');
    text('topic-summary', [tn('return.summary.decisions', decisions.length), tn('return.summary.opinions', current.filter(r => r.kind === 'opinion').length), tn('return.summary.questions', questions.length), tn('return.summary.tasks', openTasks().length), tn('return.summary.pending', records.filter(r => r.review === 'pending').length)].join(' · '));
    const now = state.tab === 'now';
    $('tab-now').setAttribute('aria-pressed', String(now)); $('tab-records').setAttribute('aria-pressed', String(!now)); show('record-filters', !now);
    for (const view of ['current', 'pending', 'all']) $('view-' + view).setAttribute('aria-pressed', String(!now && state.view === view));
    const list = $('record-list'); list.replaceChildren();
    const emptyCurrent = records.length ? tx('return.empty.noCurrent') : state.data.conversationLinks.some(link => link.topicId === topic.id) ? tx('return.empty.withConversations') : tx('return.empty.noRecords');
    if (now) {
      // Şimdi: current decisions and opinions, then open questions and tasks below.
      const groups = ['decision', 'opinion'].map(kind => [kind, current.filter(r => r.kind === kind).sort(byUpdated)]).filter(([, values]) => values.length);
      if (!groups.length) list.append(node('p', current.length ? T.noCurrentGroups : emptyCurrent, 'small global-overview-empty'));
      let hidden = 0;
      for (const [kind, values] of groups) {
        const group = node('section', null, 'record-group'), head = node('div', null, 'group-heading'), heading = node('h3', T.groups[kind]); heading.id = 'group-' + kind; group.setAttribute('aria-labelledby', heading.id); group.dataset.group = kind;
        head.append(heading, node('span', T.count(values.length), 'small')); group.append(head);
        for (const record of values.slice(0, state.recordLimit)) group.append(recordCard(record));
        hidden += Math.max(0, values.length - state.recordLimit); list.append(group);
      }
      if (hidden) list.append(moreRecords(hidden));
    } else {
      const selected = records.filter(r => state.view === 'all' || (state.view === 'pending' ? r.review === 'pending' : isCurrent(r))).sort(byUpdated);
      if (!selected.length) list.append(node('p', state.view === 'current' ? emptyCurrent : state.view === 'pending' ? tx('return.empty.nothingToReview') : tx('return.empty.topicNoRecords'), 'small global-overview-empty'));
      for (const record of selected.slice(0, state.recordLimit)) list.append(recordCard(record));
      if (selected.length > state.recordLimit) list.append(moreRecords(selected.length - state.recordLimit));
    }
    const packets = state.data.packets.filter(p => p.topicId === topic.id).sort((a, b) => String(b.createdAt).localeCompare(String(a.createdAt)) || a.id.localeCompare(b.id));
    if (packets.length) {
      const saved = node('details'), choices = node('div', null, 'packet-list'); saved.append(node('summary', tx('return.packets.saved', { n: packets.length })));
      for (const packet of packets) {
        const open = button((targets[packet.target]?.[0] || packet.target) + ' · ' + date(packet.createdAt) + ' · ' + tn('return.count.records', packet.recordIds.length), 'quiet');
        open.dataset.savedPacket = packet.id; open.onclick = () => { openContext(); displayPacket(packet); };
        const row = node('div', null, 'packet-row'); row.append(open);
        if (packet.sharedWithTools === true) {
          const close = button(tx('return.close'), 'quiet'), problem = node('p', null, 'error'); close.dataset.unsharePacket = packet.id; close.setAttribute('aria-label', tx('return.packets.closeAria')); problem.setAttribute('role', 'alert'); problem.hidden = true;
          close.onclick = () => run(close, problem, () => setToolShare(packet.id, false));
          row.append(node('span', tx('return.share.openState'), 'badge shared'), close, problem);
        }
        choices.append(row);
      }
      saved.append(choices); list.append(saved);
    }
    const questionsList = $('open-questions-list'); questionsList.replaceChildren(); show('open-questions-panel', now && questions.length > 0);
    for (const question of questions) {
      const row = node('article', null, 'record-card'), actions = node('div', null, 'actions'), open = button(tx('return.review'), 'quiet'), answer = button(tx('return.question.answer'), 'secondary');
      row.dataset.openQuestion = question.id;
      row.append(statusLine(question), node('p', question.text, 'record-text'), node('p', origin(question) + ' · ' + date(question.updatedAt || question.createdAt), 'small'));
      open.onclick = () => guard(() => editRecord(question), question); answer.onclick = () => guard(() => { newRecord(); $('record-answer-question').value = question.id; markClean(); });
      actions.append(answer, open, sourceButton(question)); row.append(actions); sourceOnClick(row, question); questionsList.append(row);
    }
    renderTasks(); renderOverview(records); renderConversationLinks(); renderReplies(); renderToolAccess(); renderSourcePane();
  }
  // Open tasks come from the topic view of the local service; the same rule is
  // applied locally only while that answer is not there yet.
  function openTasks() {
    const ids = state.extra?.topicId === state.topicId ? state.extra.openTasks : null, records = topicRecords();
    const tasks = ids ? ids.map(id => records.find(r => r.id === id)).filter(Boolean) : records.filter(isOpenTask);
    return tasks.sort((a, b) => Number(b.priority === 'active') - Number(a.priority === 'active') || String(b.updatedAt || b.createdAt).localeCompare(String(a.updatedAt || a.createdAt)) || a.id.localeCompare(b.id));
  }
  function renderTasks() {
    const tasks = openTasks(), list = $('open-tasks-list'); list.replaceChildren(); show('open-tasks-panel', state.tab === 'now' && tasks.length > 0);
    for (const task of tasks) {
      const row = node('article', null, 'record-card'), actions = node('div', null, 'actions'), open = button(tx('return.review'), 'quiet'), close = button(tx('return.close.task'), 'secondary');
      row.dataset.openTask = task.id;
      row.append(statusLine(task), node('p', task.text, 'record-text'), node('p', origin(task) + ' · ' + date(task.updatedAt || task.createdAt), 'small'));
      open.dataset.taskEdit = task.id; open.onclick = () => guard(() => editRecord(task), task);
      close.dataset.taskClose = task.id; close.onclick = () => guard(() => { editRecord(task); reveal($('question-close-panel'), $('question-close-consent')); }, task);
      actions.append(close, open, sourceButton(task)); row.append(actions); sourceOnClick(row, task); list.append(row);
    }
  }
  const sourceTime = record => record.source?.timestamp || record.legacy?.source?.timestamp || null;
  const descendingSource = (a, b) => String(sourceTime(b) || '').localeCompare(String(sourceTime(a) || '')) || String(b.updatedAt || b.createdAt || '').localeCompare(String(a.updatedAt || a.createdAt || '')) || a.id.localeCompare(b.id);
  function sourceLink(conversationId, messageId, title) {
    const link = node('a', title, 'quiet'); link.href = '/calisma?conversationId=' + encodeURIComponent(conversationId) + (messageId ? '&messageId=' + encodeURIComponent(messageId) : ''); return link;
  }
  function overviewRecord(record) {
    const article = node('article', null, 'record-card record-summary'); article.dataset.overviewRecord = record.id;
    article.append(statusLine(record), node('p', record.text, 'record-text'));
    const source = record.source;
    article.append(node('p', origin(record) + (source ? ' · ' + tx('return.sourceLine', { role: roleName(source.role || source.speaker) }) + ' · ' + date(sourceTime(record)) : ' · ' + date(record.createdAt)), 'small source-time'));
    if (record.reason) article.append(node('p', record.reason, 'small'));
    const actions = node('div', null, 'actions'), edit = button(tx('return.review'), 'quiet'); edit.dataset.overviewEdit = record.id; edit.onclick = () => guard(() => editRecord(record), record); actions.append(edit, sourceButton(record));
    if (source?.conversationId) actions.append(sourceLink(source.conversationId, source.messageId, tx('return.backToConversation')));
    article.append(actions); sourceOnClick(article, record); return article;
  }
  function renderOverview(records) {
    const groups = [
      ['approved', 'prior-approved', records.filter(r => r.review === 'reviewed' && r.adoption === 'adopted' && r.currency === 'unknown')],
      ['candidates', 'source-candidates', records.filter(r => r.review === 'pending' && r.source)]
    ];
    for (const [group, prefix, values] of groups) {
      const sorted = values.sort(descendingSource), list = $(prefix + '-list'); list.replaceChildren(); show(prefix + '-panel', state.tab === 'now' && sorted.length > 0);
      for (const record of sorted.slice(0, state.overviewLimits[group])) list.append(overviewRecord(record));
      if (sorted.length > state.overviewLimits[group]) {
        const more = button(tn('return.showMore', sorted.length - state.overviewLimits[group]), 'quiet overview-more'); more.dataset.overviewMore = group; more.onclick = () => { state.overviewLimits[group] += 8; renderOverview(records); renderSourcePane(); }; list.append(more);
      }
    }
  }
  function leaveWorkingPanels() {
    invalidatePacket(); state.selected.clear(); closeEditor();
    show('context-panel', false); show('reply-panel', false);
  }
  function selectGlobal(screen) {
    if (state.busy) return;
    leaveWorkingPanels(); state.screen = screen; text('record-result', ''); text('waiting-status', '');
    history.replaceState(null, '', '/konular' + (screen === 'review' ? '?' + WAITING_QUERY : ''));
    renderTopics(); renderTopic(); renderGlobal();
  }
  function openGlobalRecord(record) {
    if (state.busy) return;
    leaveWorkingPanels(); state.topicId = record.topicId;
    renderTopics(); renderTopic(); renderGlobal(); editRecord(record);
    history.replaceState(null, '', '/konular?' + (state.screen === 'review' ? WAITING_QUERY : 'view=' + state.screen) + '&topicId=' + encodeURIComponent(record.topicId) + '&recordId=' + encodeURIComponent(record.id));
  }
  function globalRecord(record) {
    const article = node('article', null, 'record-card global-record-card'); article.dataset.globalRecord = record.id;
    article.append(node('p', topicName(record.topicId), 'topic-name'), statusLine(record), node('p', record.text, 'record-text'));
    if (record.reason) article.append(node('p', record.reason, 'small'));
    const source = record.source;
    article.append(node('p', origin(record) + (source ? ' · ' + tx('return.sourceLine', { role: roleName(source.role || source.speaker) }) + ' · ' + date(sourceTime(record)) : ' · ' + date(record.createdAt)), 'small'));
    if (source?.excerpt) {
      const details = node('details'), summary = node('summary', tx('return.sourceQuote')), quote = node('blockquote', source.excerpt, 'source-excerpt'); quote.tabIndex = 0;
      details.append(summary, quote); article.append(details);
    }
    const actions = node('div', null, 'actions'), edit = button(tx('return.review'), 'secondary'), topic = button(tx('return.openTopic'), 'quiet');
    edit.dataset.globalEdit = record.id; edit.setAttribute('aria-label', tx('return.review') + ': ' + record.text.slice(0, 80)); edit.onclick = () => guard(() => openGlobalRecord(record), record); topic.dataset.globalTopic = record.topicId; topic.onclick = () => guard(() => selectTopic(record.topicId)); actions.append(edit, topic);
    if (source?.conversationId) actions.append(sourceLink(source.conversationId, source.messageId, tx('return.backToMessage')));
    article.append(actions); return article;
  }
  const knownTime = value => value && Number.isFinite(Date.parse(value)) ? Date.parse(value) : 0;
  const linkTime = link => knownTime(link.sourceUpdatedAt) || knownTime(link.lastUserSource?.timestamp) || knownTime(link.sourceCreatedAt);
  function resumeCard(link) {
    const article = node('article', null, 'conversation-link-card global-resume-card'); article.dataset.globalResume = link.id;
    article.append(node('p', topicName(link.topicId), 'topic-name'));
    if (link.subtopicTitle) article.append(node('p', link.subtopicTitle, 'badge subtopic-badge'));
    article.append(node('h4', link.title || tx('return.untitledConversation')), node('p', (link.provider || tx('return.noProvider')) + ' · ' + date(linkTime(link) || null), 'small'));
    const source = link.lastUserSource;
    if (source) article.append(node('p', tx('return.lastWords', { date: date(source.timestamp) }), 'small'), node('blockquote', source.excerpt));
    else article.append(node('p', tx('return.lastWordsUnknown'), 'small'));
    if (link.warning) article.append(node('p', link.warning, 'small warning'));
    const actions = node('div', null, 'actions'), open = button(tx('return.openTopic'), 'secondary'); open.dataset.resumeTopic = link.topicId; open.onclick = () => guard(() => selectTopic(link.topicId));
    actions.append(open, sourceLink(link.conversationId, source?.messageId, tx('return.openLastMessage'))); article.append(actions); return article;
  }
  function dashboardGroup(key, values, makeCard, empty) {
    const list = $('global-' + key); list.replaceChildren();
    for (const value of values.slice(0, state.dashboardLimits[key])) list.append(makeCard(value));
    if (!values.length) list.append(node('p', empty, 'small global-overview-empty'));
    if (values.length > state.dashboardLimits[key]) {
      const more = button(tn('return.showMore', values.length - state.dashboardLimits[key]), 'quiet overview-more'); more.dataset.globalMore = key;
      more.onclick = () => { if (state.busy) return; state.dashboardLimits[key] += 6; renderGlobal(); }; list.append(more);
    }
  }
  function renderGlobal() {
    // A notebook with nothing in it gets one starting card instead of four empty lists.
    const firstRun = state.screen === 'overview' && !state.data.topics.length && !state.data.conversationLinks.length && !state.data.records.length;
    show('first-run', firstRun); show('global-overview', state.screen === 'overview' && !firstRun); show('global-review', state.screen === 'review');
    renderStart(firstRun);
    const pending = pendingRecords(); text('review-nav-count', pending.length);
    if (state.screen === 'overview' && !firstRun) {
      const decisions = state.data.records.filter(record => record.kind === 'decision' && isCurrent(record)).sort(descendingSource);
      const opinions = state.data.records.filter(record => record.kind === 'opinion' && record.review === 'reviewed' && record.adoption === 'adopted').sort((a, b) => ({current: 0, unknown: 1, superseded: 2}[a.currency] - {current: 0, unknown: 1, superseded: 2}[b.currency]) || descendingSource(a, b));
      const latestByTopic = new Map();
      for (const link of [...state.data.conversationLinks].sort((a, b) => linkTime(b) - linkTime(a) || a.id.localeCompare(b.id))) if (!latestByTopic.has(link.topicId)) latestByTopic.set(link.topicId, link);
      text('global-summary', [tn('return.global.topics', visibleTopics().length), tn('return.global.links', state.data.conversationLinks.length), tn('return.global.opinions', opinions.length), tn('return.summary.decisions', decisions.length)].join(' · '));
      text('global-pending-summary', pending.length ? tn('return.global.pending', pending.length) : tx('return.empty.nothingToReview'));
      $('overview-open-review').disabled = false;
      dashboardGroup('decisions', decisions, globalRecord, tx('return.global.noDecisions'));
      const waiting = pending.filter(record => record.kind === 'decision').length; show('global-decision-candidates', waiting > 0); text('global-decision-candidates', tn('return.global.reviewDecisions', waiting));
      dashboardGroup('opinions', opinions, globalRecord, tx('return.global.noOpinions'));
      dashboardGroup('resume', [...latestByTopic.values()], resumeCard, tx('return.global.noResume'));
    }
    if (state.screen === 'review') renderReviewQueue();
  }
  // First run: three centred steps. The rail and its tools wait until there is a topic.
  function renderStart(firstRun) {
    const noTopics = !state.data.topics.length, imported = state.conversationCount, hasImports = imported > 0;
    $('desk').toggleAttribute('data-first-run', firstRun); show('rail', !firstRun);
    show('rail-tools', !noTopics); show('bakim', !noTopics); show('bulk-import', !noTopics || hasImports); show('rail-foot', !noTopics || hasImports);
    const form = $('new-topic-form'), slot = $('first-run-form-slot');
    if (firstRun && form.parentNode !== slot) slot.append(form);
    else if (!firstRun && form.parentNode === slot) $('new-topic-toggle').closest('.section-heading').after(form);
    $('start-import').classList.toggle('is-done', hasImports); show('start-topic-bulk', hasImports);
    text('start-import-note', hasImports ? T.start.importDone(imported) : tx('return.start.importNote'));
    text('start-import-link', hasImports ? T.start.importMore : tx('return.start.importLink')); $('start-import-link').classList.toggle('primary', !hasImports);
    $('first-run-topic').className = hasImports ? 'primary' : 'secondary';
  }
  function filteredQueue() {
    const topicId = $('review-topic-filter').value, kind = $('review-kind-filter').value, search = $('review-search').value.trim().toLocaleLowerCase('tr-TR');
    return pendingRecords().filter(record => !state.skipped.has(record.id) && (!topicId || record.topicId === topicId) && (!kind || record.kind === kind) && (!search || [record.text, record.reason, record.source?.excerpt, record.source?.title, topicName(record.topicId)].join(' ').toLocaleLowerCase('tr-TR').includes(search))).sort(descendingSource);
  }
  function renderSourceChecks() {
    const links = state.data.conversationLinks.filter(link => link.warning || !link.lastUserSource).sort((a, b) => linkTime(b) - linkTime(a) || a.id.localeCompare(b.id));
    show('review-source-checks', links.length > 0); text('review-source-count', tn('return.count.conversations', links.length));
    const list = $('review-source-list'); list.replaceChildren();
    for (const link of links.slice(0, state.sourceCheckLimit)) {
      const article = node('article', null, 'conversation-link-card global-resume-card'); article.dataset.sourceCheck = link.id;
      article.append(node('p', topicName(link.topicId), 'topic-name'), node('h3', link.title || tx('return.untitledConversation'), 'card-title'), node('p', (link.provider || tx('return.noProvider')) + ' · ' + date(linkTime(link) || null), 'small'));
      if (link.subtopicTitle) article.append(node('p', link.subtopicTitle, 'badge subtopic-badge'));
      article.append(node('p', link.warning || tx('return.checks.unknown'), 'small warning'));
      const actions = node('div', null, 'actions'), open = button(tx('return.openTopic'), 'quiet'); open.onclick = () => guard(() => selectTopic(link.topicId));
      actions.append(sourceLink(link.conversationId, link.lastUserSource?.messageId, tx('return.checks.open')), open); article.append(actions); list.append(article);
    }
    show('review-source-more', links.length > state.sourceCheckLimit); text('review-source-more', tn('return.checks.more', Math.max(0, links.length - state.sourceCheckLimit)));
  }
  // --- Seni bekleyenler: one list, grouped by where each item came from ----------
  function recordOrigin(record) {
    const source = record.source;
    if (!source) return ['own', W.ownNotes];
    if (source.kind === 'tool' || String(source.id || '').startsWith('tool:')) return ['tool:' + (source.title || ''), W.fromTool(source.title)];
    if (source.replyId || source.kind === 'reply') return ['reply', W.fromReplies];
    return ['conversation', W.fromConversations];
  }
  const originRank = key => key === 'conversation' ? 0 : key === 'reply' ? 1 : key === 'own' ? 3 : 2;
  function renderReviewQueue() {
    renderSourceChecks();
    const previous = $('review-topic-filter').value;
    $('review-topic-filter').replaceChildren(option('', tx('return.filter.allTopics')), ...visibleTopics().map(topic => option(topic.id, topic.title)));
    $('review-topic-filter').value = state.data.topics.some(topic => topic.id === previous) ? previous : '';
    const queued = filteredQueue(), pageCount = Math.max(1, Math.ceil(queued.length / 20)); state.queuePage = Math.min(state.queuePage, pageCount - 1);
    const start = state.queuePage * 20, list = $('review-queue-list'); list.replaceChildren();
    // Within a page the records keep their order and are grouped by origin.
    const groups = new Map();
    for (const record of queued.slice(start, start + 20)) { const [key, title] = recordOrigin(record); if (!groups.has(key)) groups.set(key, { title, records: [] }); groups.get(key).records.push(record); }
    for (const [key, group] of [...groups].sort((a, b) => originRank(a[0]) - originRank(b[0]))) {
      const section = node('section', null, 'waiting-subgroup'), heading = node('h4', group.title + ' · ' + group.records.length, 'waiting-subheading'); heading.id = 'waiting-group-' + key.replace(/[^A-Za-z0-9_-]/g, '-');
      section.setAttribute('aria-labelledby', heading.id); section.dataset.origin = key; section.append(heading);
      for (const record of group.records) section.append(waitingRecord(record));
      list.append(section);
    }
    if (!queued.length) list.append(node('p', pendingRecords().some(record => !state.skipped.has(record.id)) ? tx('return.queue.noMatch') : tx('return.empty.nothingToReview'), 'small global-overview-empty'));
    const skipped = pendingRecords().filter(record => state.skipped.has(record.id)).length;
    text('review-result-count', (queued.length ? start + 1 + '–' + Math.min(start + 20, queued.length) : '0') + ' / ' + tn('return.queue.matching', queued.length) + ' · ' + tn('return.queue.total', pendingRecords().length) + (skipped ? W.skippedCount(skipped) : ''));
    text('review-queue-count', ' · ' + (pendingRecords().length - skipped)); show('waiting-skipped', skipped > 0); text('waiting-skipped-text', W.left(skipped));
    text('review-page-status', tx('return.queue.page', { page: state.queuePage + 1, pages: pageCount })); updateWaitingCounts(); renderWaitingPane(); readiness();
  }
  // A pending record in the list: its words in their own voice, the source excerpt
  // in the source voice, and the existing review operations as buttons.
  function waitingRecord(record) {
    const article = node('article', null, 'record-card global-record-card waiting-item'), ai = isProposal(record), held = stateful(record.kind), needs = !held && !ownNote(record);
    article.dataset.globalRecord = record.id; article.dataset.waitingItem = 'record:' + record.id;
    article.append(node('p', topicName(record.topicId), 'topic-name'), statusLine(record), node('p', record.text, 'record-text' + (ai ? ' voice-ai' : '')));
    const excerpt = record.source?.excerpt;
    if (excerpt) { const quote = node('blockquote', excerpt, 'voice-source source-excerpt'); quote.tabIndex = 0; article.append(quote); }
    const source = record.source;
    article.append(node('p', origin(record) + (source ? ' · ' + tx('return.sourceLine', { role: roleName(source.role || source.speaker) }) + ' · ' + date(sourceTime(record)) : ' · ' + date(record.createdAt)), 'small'));
    if (record.reason) article.append(node('p', record.reason, 'small'));
    const problem = node('p', null, 'error'); problem.setAttribute('role', 'alert'); problem.hidden = true;
    const actions = node('div', null, 'actions waiting-actions'), primary = button(held ? (record.kind === 'task' ? W.keepTask : W.keepQuestion) : W.adopt, 'primary');
    const leave = button(W.leave, 'secondary'), edit = button(W.edit, 'secondary'), remove = button(W.remove, 'quiet'), details = detailsButton('record', record);
    primary.dataset.waitingDecide = record.id; leave.dataset.waitingLeave = record.id; edit.dataset.globalEdit = record.id; remove.dataset.waitingRemove = record.id;
    for (const [control, label] of [[primary, primary.textContent], [leave, W.leave], [edit, W.edit], [remove, W.remove]]) control.setAttribute('aria-label', label + ': ' + record.text.slice(0, 80));
    let box = null, hint = null;
    if (needs) {
      const consent = node('label', null, 'check'); box = document.createElement('input'); box.type = 'checkbox'; box.dataset.waitingConsent = record.id;
      consent.append(box, node('span', W.consent)); article.append(consent);
      hint = node('p', W.consentHint, 'small hint'); hint.id = 'waiting-hint-' + record.id.replace(/[^A-Za-z0-9_-]/g, ''); primary.setAttribute('aria-describedby', hint.id);
      primary.disabled = true; box.onchange = () => { primary.disabled = state.busy || !box.checked; hint.hidden = box.checked; };
    }
    primary.onclick = () => run(primary, problem, async () => {
      if (box && !box.checked) throw Error(W.consentHint);
      const index = waitingIndex('record', record.id);
      await reviewDirect(record, held ? 'keepOpen' : 'adopt');
      text('waiting-status', held ? W.keptOpen(record.kind, record.text.slice(0, 80)) : W.adopted(record.text.slice(0, 80)));
      return () => focusWaiting('record', index);
    });
    leave.onclick = () => { if (state.busy) return; const index = waitingIndex('record', record.id); state.skipped.add(record.id); if (sameSelection('record', record.id)) state.waitingSelected = null; renderReviewQueue(); text('waiting-status', W.leftNow(record.text.slice(0, 80))); focusWaiting('record', index); };
    edit.onclick = () => guard(() => openGlobalRecord(record), record);
    remove.onclick = () => run(remove, problem, async () => {
      const index = waitingIndex('record', record.id);
      await call('records-trash', { id: record.id, expectedRevision: record.revision, confirmedByUser: true });
      if (state.editing?.id === record.id) closeEditor();
      await refresh(); text('waiting-status', W.removed(record.text.slice(0, 80)));
      return () => focusWaiting('record', index);
    });
    actions.append(primary, leave, edit, remove, details); if (hint) article.append(hint);
    article.append(actions, problem); selectOnClick(article, 'record', record.id); markSelected(article, 'record', record.id);
    return article;
  }
  // The same review operation the editor's quick buttons send; nothing is guessed.
  async function reviewDirect(record, quick) {
    const held = stateful(record.kind), choice = quickChoices[quick];
    await call('records-review', { id: record.id, expectedRevision: record.revision, expectedTopicId: record.topicId, text: record.text, reason: record.reason || '', review: choice.review, adoption: held ? 'not_applicable' : choice.adoption || record.adoption, currency: choice.currency || record.currency, priority: record.priority, questionState: held ? record.questionState : 'not_applicable', changeReason: tx('return.reviewed'), confirmedByUser: true });
    if (state.editing?.id === record.id) closeEditor();
    if (sameSelection('record', record.id)) state.waitingSelected = null;
    invalidatePacket(); await refresh();
  }
  const sameSelection = (type, id) => state.waitingSelected?.type === type && state.waitingSelected.id === id;
  const waitingItems = type => [...document.querySelectorAll(type === 'record' ? '#review-queue-list [data-waiting-item]' : '#inbox-list [data-waiting-item]')];
  const waitingIndex = (type, id) => waitingItems(type).findIndex(el => el.dataset.waitingItem === type + ':' + id);
  // After an item leaves the list, focus lands on the one that took its place.
  function focusWaiting(type, index) {
    const items = waitingItems(type), next = items[Math.min(Math.max(index, 0), items.length - 1)];
    const target = next?.querySelector('input:not(:disabled),button:not(:disabled)') || $(type === 'record' ? 'global-review-heading' : 'inbox-heading');
    if (target && !target.closest('[hidden]')) target.focus({ preventScroll: true });
  }
  function detailsButton(type, item) {
    const control = button(W.details, 'quiet'); control.dataset.waitingDetails = type + ':' + item.id;
    control.setAttribute('aria-controls', 'waiting-pane'); control.setAttribute('aria-expanded', String(sameSelection(type, item.id)));
    control.setAttribute('aria-label', W.details + ': ' + String(item.text || '').slice(0, 80));
    control.onclick = () => selectWaiting(type, item.id, true); return control;
  }
  function selectOnClick(article, type, id) {
    article.addEventListener('click', event => { if (event.target.closest('button,a,summary,input,label,select,textarea,details,blockquote')) return; selectWaiting(type, id, false); });
  }
  function markSelected(article, type, id) {
    const yes = sameSelection(type, id); article.classList.toggle('is-selected', yes);
    // Below 900px the details open inside the selected card; wide screens use the pane.
    if (yes) { const inline = node('div', null, 'waiting-inline'); inline.append(waitingDetail()); article.append(inline); }
  }
  function selectWaiting(type, id, moveFocus) {
    state.waitingSelected = { type, id };
    for (const el of document.querySelectorAll('#global-review [data-waiting-item]')) {
      el.querySelector(':scope > .waiting-inline')?.remove();
      const [kind, ...rest] = el.dataset.waitingItem.split(':'); markSelected(el, kind, rest.join(':'));
      el.querySelector('[data-waiting-details]')?.setAttribute('aria-expanded', String(el.classList.contains('is-selected')));
    }
    renderWaitingPane();
    if (moveFocus && !narrow()) $('waiting-pane-heading').focus({ preventScroll: true });
  }
  function selectedWaiting() {
    const chosen = state.waitingSelected; if (!chosen) return null;
    if (chosen.type === 'record') { const record = pendingRecords().find(r => r.id === chosen.id && !state.skipped.has(r.id)); return record ? { type: 'record', record } : null; }
    const entry = state.inbox.find(e => e.item?.id === chosen.id); return entry ? { type: 'proposal', entry } : null;
  }
  // Source and details of the chosen item, built without ids so it can sit in the
  // pane and inside the card at the same time.
  function waitingDetail() {
    const chosen = selectedWaiting(), box = node('div', null, 'waiting-detail');
    if (!chosen) { box.append(node('p', W.paneEmpty, 'small')); return box; }
    if (chosen.type === 'record') {
      const record = chosen.record, source = record.source || record.legacy?.source || null, excerpt = source ? source.excerpt || source.originalText || '' : '';
      const from = node('div', null, 'source-panel');
      from.append(node('p', source ? [source.provider, source.title || source.conversationTitle || (source.replyId ? T.replyTitle : T.untitledSource)].filter(Boolean).join(' · ') : T.ownNoteTitle, 'source-pane-title'), node('p', date(source ? sourceTime(record) : record.createdAt), 'small'));
      if (source) from.append(node('p', roleName(source.role || source.speaker), 'eyebrow'));
      if (excerpt) { const quote = node('blockquote', excerpt, 'voice-source'); quote.tabIndex = 0; from.append(quote); }
      else from.append(node('p', source ? T.noExcerpt : T.ownNote, 'small'));
      if (source?.conversationId) from.append(sourceLink(source.conversationId, source.messageId, W.openSource));
      const body = node('div', null, 'source-pane-record' + (isProposal(record) ? ' voice-ai' : '')), voice = node('p', null, 'eyebrow');
      voice.append(isProposal(record) ? node('span', T.aiLabel, 'voice-ai-label') : T.yourRecord);
      body.append(voice, node('p', record.text, 'record-text'), statusLine(record, statusParts(record), false));
      if (record.reason) body.append(node('p', record.reason, 'small'));
      const topic = button(W.openTopic, 'quiet'); topic.dataset.globalTopic = record.topicId; topic.onclick = () => guard(() => selectTopic(record.topicId));
      box.append(from, body, node('p', W.topic(topicName(record.topicId)), 'small'), topic);
      return box;
    }
    const entry = chosen.entry, item = entry.item || {}, related = entry.related;
    const head = node('div', null, 'source-panel'); head.append(node('p', W.proposalFrom, 'eyebrow'), node('p', (item.tool || tx('return.tools.heading')) + ' · ' + date(item.receivedAt), 'source-pane-title'), node('p', W.topic(entry.topicTitle || topicName(item.topicId)), 'small'));
    const body = node('div', null, 'source-pane-record voice-ai'), label = node('p', null, 'eyebrow'); label.append(node('span', T.aiLabel, 'voice-ai-label'), ' · ' + (labels.inbox[item.kind] || tx('return.inbox.kind.proposal')));
    body.append(label, node('p', item.text, 'record-text'));
    box.append(head, body);
    if (related?.text) {
      const full = state.data.records.find(r => r.id === related.id), rel = node('div', null, 'waiting-related');
      rel.append(node('p', W.related(related.kind).replace(/: $/, ''), 'eyebrow'), node('p', related.text, 'record-text'));
      if (full) rel.append(statusLine(full, statusParts(full), isProposal(full)));
      box.append(rel);
    }
    box.append(node('p', W.proposalNote, 'small'));
    return box;
  }
  function renderWaitingPane() {
    const on = state.screen === 'review'; show('waiting-pane', on); if (!on) return;
    if (state.waitingSelected && !selectedWaiting()) state.waitingSelected = null;
    const has = Boolean(state.waitingSelected); show('waiting-pane-empty', !has); show('waiting-pane-body', has);
    $('waiting-pane-body').replaceChildren(...(has ? [waitingDetail()] : []));
  }
  function renderConversationLinks() {
    const all = state.data.conversationLinks.filter(link => link.topicId === state.topicId);
    show('topic-conversations-panel', all.length > 0);
    const search = $('topic-conversation-search').value.trim().toLocaleLowerCase('tr-TR');
    const filtered = all.filter(link => !search || (link.title + ' ' + link.provider + ' ' + (link.subtopicTitle || '')).toLocaleLowerCase('tr-TR').includes(search)).sort((a, b) => String(b.sourceUpdatedAt || b.lastUserSource?.timestamp || b.sourceCreatedAt || '').localeCompare(String(a.sourceUpdatedAt || a.lastUserSource?.timestamp || a.sourceCreatedAt || '')) || a.id.localeCompare(b.id));
    text('topic-conversations-count', filtered.length + ' / ' + tn('return.count.conversations', all.length));
    const list = $('topic-conversation-list'); list.replaceChildren();
    const visible = filtered.slice(0, state.conversationLimit), groups = new Map(), grouped = filtered.some(link => link.subtopicTitle);
    for (const link of visible) { const key = link.subtopicTitle || tx('return.conversations.other'); if (!groups.has(key)) groups.set(key, []); groups.get(key).push(link); }
    for (const [subtopic, links] of groups) {
      if (grouped) list.append(node('h4', subtopic + ' · ' + tn('return.count.conversations', filtered.filter(link => (link.subtopicTitle || tx('return.conversations.other')) === subtopic).length), 'subtopic-heading'));
      for (const link of links) {
        const article = node('article', null, 'conversation-link-card'); article.dataset.conversationLink = link.id;
        const source = link.lastUserSource;
        if (link.subtopicTitle) article.append(node('p', link.subtopicTitle, 'badge subtopic-badge'));
        article.append(node(grouped ? 'h5' : 'h4', link.title || tx('return.untitledConversation'), 'card-title'), node('p', (link.provider || tx('return.noProvider')) + ' · ' + date(link.sourceUpdatedAt || link.sourceCreatedAt), 'small'));
        if (source) article.append(node('p', tx('return.lastWords', { date: date(source.timestamp) }), 'small'), node('blockquote', source.excerpt));
        else article.append(node('p', tx('return.lastWordsUnknown'), 'small'));
        if (link.warning) article.append(node('p', link.warning, 'small warning'));
        if (link.classificationReason) article.append(node('p', tx('return.conversations.reason', { reason: link.classificationReason }), 'small'));
        const actions = node('div', null, 'actions'); actions.append(sourceLink(link.conversationId, source?.messageId, tx('return.openLastMessage')));
        if (source) { const create = button(tx('return.record.fromWords'), 'quiet'); create.dataset.linkCandidate = link.id; create.onclick = () => guard(() => newRecord({ conversationId: link.conversationId, messageId: source.messageId, excerpt: source.excerpt }, source.excerpt, link.title, source.role)); actions.append(create); }
        article.append(actions); list.append(article);
      }
    }
    if (!filtered.length) list.append(node('p', tx('return.conversations.noMatch'), 'small'));
    show('topic-conversations-more', filtered.length > state.conversationLimit);
  }
  async function previewBulk() {
    const preview = await call('records-bulk-preview'); state.bulk = preview; $('bulk-consent').checked = false;
    renderBulk(preview); show('bulk-preview-panel', true); readiness();
  }
  function renderBulk(preview) {
    const list = $('bulk-topic-list'); list.replaceChildren();
    for (const topic of preview.topics || []) {
      const row = node('article', null, 'bulk-topic-row'); row.append(node('h3', topic.title), node('p', tn('return.count.conversations', topic.conversationCount) + ' · ' + tn('return.bulk.newLinks', topic.newLinkCount), 'small'), node('p', tn('return.summary.pending', topic.candidateCount), 'small')); list.append(row);
    }
    text('bulk-summary', [tn('return.bulk.reviewed', preview.conversationCount), tn('return.bulk.newLinks', preview.linkedCount), tn('return.bulk.newRecords', preview.candidateCount), tn('return.bulk.alreadyLinked', preview.alreadyLinked)].join(' · '));
    const warnings = $('bulk-warnings'); warnings.replaceChildren(...(preview.warnings || []).map(w => node('li', w)));
    const nothing = !((preview.topics || []).some(t => t.newLinkCount > 0) || preview.candidateCount > 0);
    text('bulk-status', nothing ? (preview.conversationCount ? tx('return.bulk.nothing') : tx('return.bulk.noConversations')) : tx('return.bulk.ready'));
  }

  // --- Kayıt düzenleyici ---------------------------------------------------
  const editorFields = ['record-topic', 'record-kind', 'record-excerpt', 'record-text', 'record-answer-question', 'record-reason', 'record-review', 'record-adoption', 'record-currency', 'record-priority', 'record-change-reason', 'question-close-reason'];
  const editorSnapshot = () => JSON.stringify(editorFields.map(id => $(id).value));
  const markClean = () => { state.editorClean = editorSnapshot(); };
  const editorDirty = () => !$('record-editor').hidden && editorSnapshot() !== state.editorClean;
  function closeEditor() { show('record-editor', false); show('record-discard', false); state.editing = null; state.source = null; state.afterDiscard = null; }
  // Unsaved text is never dropped silently: leaving a changed editor asks first.
  function guard(proceed, target) {
    if (state.busy) return;
    if (!editorDirty() || (target && state.editing && target.id === state.editing.id)) { proceed(); return; }
    state.afterDiscard = proceed; show('record-discard', true); reveal($('record-editor'), $('record-discard-no'));
  }
  function setSource(source, original, title, role) {
    state.source = source ? { ...source, original, title, role } : null;
    show('record-source', Boolean(source)); show('excerpt-field', Boolean(source)); show('excerpt-help', Boolean(source));
    text('source-original', original || ''); text('source-title', title || ''); text('source-role', roleName(role));
    show('source-backlink', Boolean(source?.conversationId));
    if (source?.conversationId) $('source-backlink').href = '/calisma?conversationId=' + encodeURIComponent(source.conversationId) + '&messageId=' + encodeURIComponent(source.messageId);
    $('record-excerpt').value = source?.excerpt || original || '';
  }
  // The editor's own labels, from its state, so a language switch can redraw
  // them without touching what the person typed.
  function editorTexts() {
    const record = state.editing, source = state.source;
    text('source-role', roleName(source?.role));
    if (!record) {
      text('record-eyebrow', tx('return.record.newHeading')); text('record-heading', source ? tx('return.record.fromWords') : tx('return.record.newHeading')); text('record-save', tx('return.save.pending'));
      text('record-attribution', source ? source.role === 'assistant' ? tx('return.attr.newAssistant') : tx('return.attr.newSource') : tx('return.attr.newOwn'));
    } else {
      const held = stateful(record.kind), closed = record.questionState === 'closed', task = record.kind === 'task';
      text('record-eyebrow', tx('return.field.review')); text('record-heading', tx('return.record.reviewHeading', { kind: labels.kind[record.kind] })); text('record-save', tx('return.save'));
      text('record-attribution', isProposal(record) ? tx('return.attr.proposal') : record.source ? tx('return.attr.source') : tx('return.attr.own'));
      if (held) {
        text('question-close-label', tx(task ? 'return.close.taskLabel' : 'return.close.questionLabel')); text('question-close-apply', tx(task ? 'return.close.task' : 'return.close.question'));
        text('question-state', closed ? tx(task ? 'return.state.taskClosed' : 'return.state.questionClosed') : record.review === 'reviewed' && record.currency === 'current' ? tx(task ? 'return.state.taskOpen' : 'return.state.questionOpen') : tx(task ? 'return.state.taskPending' : 'return.state.questionPending'));
      }
    }
    updateKind(); quickReadiness();
  }
  function newRecord(source = null, original = '', title = '', role = '') {
    if (state.busy) return;
    if (!state.data.topics.length) { show('new-topic-form', true); $('new-topic-toggle').setAttribute('aria-expanded', 'true'); $('topic-name').focus(); text('page-status', tx('return.record.needTopic')); return; }
    state.editing = null; $('record-form').reset(); error('record-error'); show('record-discard', false); state.afterDiscard = null; setSource(source, original, title, role);
    $('record-topic').value = state.topicId; $('record-topic').disabled = false; $('record-kind').disabled = false;
    renderAnswerQuestions();
    $('record-text').value = source?.excerpt || original || '';
    show('quick-review', false); show('record-detail', false); $('record-detail').open = false; show('record-history', false); show('question-close-panel', false); show('record-save-next', false); show('record-trash', false); show('record-editor', true); editorTexts(); markClean(); reveal($('record-editor'), $('record-heading'));
  }
  function updateKind() {
    const kind = state.editing ? state.editing.kind : $('record-kind').value, held = stateful(kind);
    show('adoption-field', !held); show('question-note', held);
    text('question-note', kind === 'task' ? tx('return.note.task') : tx('return.note.question'));
    show('answer-question-field', !held && !state.editing && $('record-answer-question').options.length > 1);
    $('record-adoption').querySelector('[value="not_applicable"]').disabled = !held;
    if (held) $('record-adoption').value = 'not_applicable'; else if ($('record-adoption').value === 'not_applicable') $('record-adoption').value = 'unknown';
    // Only a note you write yourself can be saved and adopted in one step.
    show('record-save-adopt', !state.editing && !state.source);
    text('record-save-adopt', kind === 'task' ? tx('return.save.taskOpen') : kind === 'question' ? tx('return.save.questionOpen') : tx('return.save.adopt'));
  }
  function renderAnswerQuestions() {
    const prior = $('record-answer-question').value; $('record-answer-question').replaceChildren(option('', tx('return.field.noQuestion')));
    for (const r of state.data.records.filter(r => r.topicId === $('record-topic').value && r.kind === 'question' && r.questionState === 'open' && r.review === 'reviewed' && r.currency === 'current')) $('record-answer-question').append(option(r.id, r.text));
    $('record-answer-question').value = prior; if ($('record-answer-question').selectedIndex < 0) $('record-answer-question').value = '';
  }
  function editRecord(record) {
    if (state.busy) return;
    newRecord(); state.editing = record; $('record-topic').value = record.topicId; $('record-topic').disabled = true; $('record-kind').value = record.kind; $('record-kind').disabled = true;
    $('record-text').value = record.text; $('record-reason').value = record.reason || ''; $('record-change-reason').value = '';
    for (const key of ['review', 'adoption', 'currency', 'priority']) $('record-' + key).value = record[key];
    const held = stateful(record.kind), closed = record.questionState === 'closed';
    const source = record.source;
    setSource(source, source?.originalText || source?.excerpt || '', source?.title || source?.conversationTitle || (source ? tx('return.source.heading') : ''), source?.role || source?.speaker || (isProposal(record) ? 'assistant' : 'user'));
    show('excerpt-field', false); show('excerpt-help', false);
    show('quick-review', true); show('record-detail', true); show('record-save-next', record.review === 'pending'); show('record-trash', true);
    for (const id of ['quick-adopt', 'quick-hypothesis', 'quick-reject']) show(id, !held); show('quick-keep-open', held && !closed);
    $('quick-consent').checked = false; show('quick-consent-field', !held && !ownNote(record));
    show('question-close-panel', held);
    $('question-close-consent').checked = false; $('question-close-consent').disabled = closed; $('question-close-reason').value = ''; $('question-close-reason').disabled = closed; show('question-close-apply', !closed);
    editorTexts(); renderHistory(record); markClean();
    // The record being reviewed is also the one whose source the right pane shows.
    if (state.screen === 'topic' && record.topicId === state.topicId) { state.sourceRecordId = record.id; renderSourcePane(); }
  }
  function quickReadiness() {
    const record = state.editing; if (!record) return;
    const needs = !stateful(record.kind) && !ownNote(record), blocked = state.busy || (needs && !$('quick-consent').checked);
    $('quick-adopt').disabled = blocked; $('quick-reject').disabled = blocked; $('quick-hypothesis').disabled = state.busy; $('quick-keep-open').disabled = state.busy;
    text('quick-hint', needs && !$('quick-consent').checked ? tx('return.quick.hint') : '');
    $('question-close-apply').disabled = state.busy || record.questionState === 'closed' || !$('question-close-consent').checked;
  }
  function renderHistory(record) {
    const list = $('history-list'); list.replaceChildren(); show('record-history', Boolean(record.history?.length || record.legacy));
    for (const item of [...(record.history || [])].reverse()) {
      const previous = item.previous || item.snapshot || item, article = node('article', null, 'history-entry');
      article.append(node('p', tx('return.history.previous', { date: date(item.changedAt || item.createdAt) }), 'small'), node('pre', previous.text || ''), node('p', tx('return.history.reason', { reason: item.changeReason || tx('return.label.notStated') })));
      article.append(node('p', [labels.review[previous.review], previous.adoption === 'not_applicable' ? null : tx('return.history.adoption', { value: labels.adoption[previous.adoption] }), tx('return.history.currency', { value: labels.currency[previous.currency] }), tx('return.history.priority', { value: labels.priority[previous.priority] })].filter(Boolean).join(' · '), 'small')); list.append(article);
    }
    if (record.legacy) {
      const legacy = record.legacy, oldStatuses = { confirmed: tx('return.legacy.status.confirmed'), uncertain: tx('return.legacy.status.uncertain'), rejected: tx('return.legacy.status.rejected'), draft: tx('return.legacy.status.draft') };
      list.append(node('h3', tx('return.legacy.fromOld')), node('p', oldStatuses[legacy.status] || legacy.status, 'small'), node('pre', legacy.statement));
      for (const item of [...(legacy.history || [])].reverse()) { const row = node('article', null, 'history-entry'); row.append(node('p', (oldStatuses[item.status] || item.status) + ' · ' + date(item.changedAt), 'small'), node('pre', item.statement), node('p', item.changeReason || tx('return.history.noReason'))); list.append(row); }
    }
  }
  const quickChoices = {
    adopt: { review: 'reviewed', adoption: 'adopted', currency: 'current' },
    hypothesis: { review: 'reviewed', adoption: 'hypothesis' },
    reject: { review: 'reviewed', adoption: 'not_adopted' },
    keepOpen: { review: 'reviewed', currency: 'current' }
  };
  // Where the reviewer is working: the cross-topic queue or this topic's own list.
  const pendingList = () => state.screen === 'review' ? filteredQueue() : topicRecords().filter(r => r.review === 'pending').sort((a, b) => String(b.updatedAt || b.createdAt).localeCompare(String(a.updatedAt || a.createdAt)));
  function focusRecord(id) {
    const card = [...document.querySelectorAll('[data-global-edit],[data-edit-record],[data-overview-edit],[data-task-edit]')].find(el => [el.dataset.globalEdit, el.dataset.editRecord, el.dataset.overviewEdit, el.dataset.taskEdit].includes(id) && !el.closest('[hidden]'));
    if (card) card.focus({ preventScroll: true });
    return Boolean(card);
  }
  // When the saved record has left every visible list (a closed task, a reviewed
  // queue item), focus lands on the heading of the screen the person is on.
  function focusScreen() {
    const heading = $(state.screen === 'review' ? 'global-review-heading' : state.screen === 'topic' && currentTopic() ? 'topic-title' : 'global-overview-heading');
    if (heading && !heading.closest('[hidden]')) heading.focus({ preventScroll: true });
  }
  async function saveRecord(options = {}) {
    const recordText = $('record-text').value.trim(); if (!recordText) throw Error(tx('return.err.noText'));
    const before = pendingList().map(r => r.id); let result, message = tx('return.saved'), created = false;
    if (state.editing) {
      const record = state.editing, held = stateful(record.kind), quick = quickChoices[options.quick] || {};
      if (options.close && !$('question-close-consent').checked) throw Error(tx('return.err.closeConsent'));
      const closing = held && record.questionState !== 'closed' && $('question-close-consent').checked && !options.quick;
      let changeReason = $('record-change-reason').value.trim();
      if (closing) { const reason = $('question-close-reason').value.trim(); if (!reason) throw Error(tx(record.kind === 'task' ? 'return.err.taskReason' : 'return.err.questionReason')); changeReason = (changeReason ? changeReason + '\n' : '') + tx('return.closeReasonPrefix', { reason }); }
      const body = { id: record.id, expectedRevision: record.revision, expectedTopicId: record.topicId, text: recordText, reason: $('record-reason').value.trim(), review: quick.review || $('record-review').value, adoption: held ? 'not_applicable' : quick.adoption || $('record-adoption').value, currency: quick.currency || $('record-currency').value, priority: $('record-priority').value, questionState: held ? closing ? 'closed' : record.questionState : 'not_applicable', changeReason: changeReason || tx('return.reviewed'), confirmedByUser: true };
      // Adopting or rejecting something you did not write yourself is a declaration; it needs the box.
      const declares = !held && !ownNote(record) && ((['adopted', 'not_adopted'].includes(body.adoption) && body.adoption !== record.adoption) || (body.review === 'rejected' && record.review !== 'rejected'));
      if (declares && !$('quick-consent').checked) { $('record-detail').open = true; throw Error(tx('return.err.declareConsent')); }
      try { result = await call('records-review', body); }
      catch (e) {
        if ((e.serverMessage || e.message)?.includes('Kaydın konusu değişmiş')) { await refresh(); throw Error(tx('return.err.topicMoved')); }
        throw e;
      }
      if (closing) message = record.kind === 'task' ? tx('return.taskClosed') : tx('return.questionClosed');
    } else {
      const body = { topicId: $('record-topic').value, kind: $('record-kind').value, text: recordText, reason: $('record-reason').value.trim() };
      if (!stateful(body.kind) && $('record-answer-question').value) body.answersQuestionId = $('record-answer-question').value;
      if (!body.topicId) throw Error(tx('return.err.chooseTopic'));
      if (options.adopt && state.source) throw Error(tx('return.err.sourcedAdopt'));
      if (state.source) {
        const excerpt = $('record-excerpt').value; if (!excerpt.trim() || !state.source.original.includes(excerpt)) throw Error(tx('return.err.excerpt'));
        body.source = state.source.replyId ? { replyId: state.source.replyId, excerpt } : { conversationId: state.source.conversationId, messageId: state.source.messageId, excerpt };
      }
      result = await mutation('records-create', body); state.topicId = body.topicId; created = true;
      message = tx('return.created');
      if (options.adopt) {
        const record = result.record, held = stateful(record.kind);
        try {
          result = await call('records-review', { id: record.id, expectedRevision: record.revision, expectedTopicId: record.topicId, text: record.text, reason: record.reason || '', review: 'reviewed', adoption: held ? 'not_applicable' : 'adopted', currency: 'current', priority: record.priority || 'unspecified', questionState: held ? 'open' : 'not_applicable', changeReason: held ? tx('return.reason.ownOpen') : tx('return.reason.ownAdopted'), confirmedByUser: true });
          message = held ? tx('return.savedOpen') : tx('return.savedAdopted');
        } catch { message = tx('return.adoptFailed'); }
      }
    }
    const savedId = result.record?.id; invalidatePacket(); await refresh(); closeEditor();
    if (created) { state.view = result.record?.review === 'pending' ? 'pending' : 'current'; state.tab = state.view === 'pending' ? 'records' : 'now'; }
    renderTopic(); renderGlobal(); if (state.screen !== 'topic') history.replaceState(null, '', '/konular' + (state.screen === 'review' ? '?' + WAITING_QUERY : ''));
    text('page-status', message); text('record-result', message);
    const advance = options.next || (options.quick && state.screen === 'review');
    return () => {
      if (advance) {
        const list = pendingList(), at = list.findIndex(r => r.id === savedId), was = before.indexOf(savedId);
        const next = at >= 0 ? list[at + 1] : list[Math.max(0, Math.min(was, list.length - 1))];
        if (next) { if (state.screen === 'review') openGlobalRecord(next); else editRecord(next); text('record-result', message + ' ' + tx('return.nextOpened')); return; }
        text('record-result', message + ' ' + tx('return.empty.nothingToReview')); text('page-status', message + ' ' + tx('return.empty.nothingToReview'));
      }
      if (!savedId || !focusRecord(savedId)) focusScreen();
    };
  }

  // --- Devam metni ve AI yanıtı ---------------------------------------------
  function invalidatePacket() {
    rememberReplyDraft();
    const had = Boolean(state.packet);
    state.packet = null; $('context-consent').checked = false; $('tool-share-consent').checked = false; text('tool-share-status', '');
    show('context-preview', false); show('reply-panel', false); text('context-copy-status', had && !$('context-panel').hidden ? tx('return.context.changed') : ''); readiness();
  }
  function rememberReplyDraft() {
    if (state.packet) state.replyDrafts.set(state.packet.id, { text: $('reply-text').value, format: $('reply-format').value });
  }
  function openContext() {
    if (!currentTopic()) return;
    state.selected = new Set(topicRecords().filter(r => isCurrent(r) && !['not_priority', 'paused'].includes(r.priority)).map(r => r.id)); $('context-include-ai').checked = false; invalidatePacket(); text('context-copy-status', ''); renderContextChoices(); show('context-panel', true); error('context-error'); reveal($('context-panel'), $('context-heading'));
  }
  function renderContextChoices() {
    const list = $('context-records'); list.replaceChildren();
    const records = topicRecords().filter(r => isCurrent(r) || ($('context-include-ai').checked && isSelectableProposal(r)));
    if (!records.length) {
      const empty = node('div', null, 'notice'), go = button(tx('return.context.openPending'), 'secondary');
      go.onclick = () => { show('context-panel', false); state.tab = 'records'; state.view = 'pending'; renderTopic(); reveal($('topic-view'), $('view-pending')); };
      empty.append(node('p', tx('return.context.none')), go); list.append(empty);
    }
    for (const record of records) {
      const row = node('div', null, 'context-choice'), checkbox = document.createElement('input'), label = node('label'); checkbox.type = 'checkbox'; checkbox.id = 'context-record-' + record.id; checkbox.dataset.contextRecord = record.id; checkbox.checked = state.selected.has(record.id); label.htmlFor = checkbox.id;
      label.append(node('span', record.text), node('span', (isSelectableProposal(record) ? tx('return.context.unadopted') + ' · ' : '') + labels.kind[record.kind] + (record.priority !== 'unspecified' ? ' · ' + labels.priority[record.priority] : ''), 'small')); row.append(checkbox, label); list.append(row);
      checkbox.onchange = () => { if (checkbox.checked) state.selected.add(record.id); else state.selected.delete(record.id); invalidatePacket(); };
    }
  }
  async function prepareContext() {
    const selected = topicRecords().filter(r => state.selected.has(r.id));
    const recordIds = selected.filter(isCurrent).map(r => r.id), proposalIds = $('context-include-ai').checked ? selected.filter(isSelectableProposal).map(r => r.id) : [];
    if (!recordIds.length && !proposalIds.length) throw Error(tx('return.err.chooseRecord'));
    const { packet, findings } = await call('records-prepare', { topicId: state.topicId, recordIds, proposalIds, target: $('context-target').value, model: $('context-model').value.trim() || null, question: $('context-question').value.trim(), confirmedByUser: true });
    await refresh(); displayPacket(packet);
    if (findings?.length) text('context-copy-status', tx('return.context.findings', { list: findings.map(f => typeof f === 'string' ? f : f.kind || f.type || tx('return.context.private')).join(', ') }));
  }
  function displayPacket(packet) {
    rememberReplyDraft();
    const draft = state.replyDrafts.get(packet.id); $('reply-text').value = draft?.text || ''; $('reply-format').value = draft?.format || 'text'; error('reply-error');
    state.packet = packet; $('context-consent').checked = false; $('tool-share-consent').checked = false; text('tool-share-status', '');
    packetTexts(packet); show('context-preview', true); show('reply-panel', true); readiness();
  }
  function packetTexts(packet) {
    renderToolShare();
    const target = targets[packet.target] || [packet.target, null]; text('context-target-label', tx('return.context.targetLabel', { target: target[0] }) + (packet.model ? ' · ' + packet.model : '')); text('context-prompt', packet.text);
    if (target[1]) $('context-service-link').href = target[1]; text('reply-status', tx('return.reply.linked', { date: date(packet.createdAt) }));
    const stale = (packet.sources || []).some(source => state.data.records.find(r => r.id === source.recordId)?.revision !== source.revision);
    text('context-copy-status', stale ? tx('return.context.stale') : tx('return.context.prepared', { date: date(packet.createdAt) }));
    text('reply-schema', JSON.stringify({ commentary: tx('return.schema.commentary'), citations: [{ sourceId: packet.sourceIds?.[0] || tx('return.schema.sourceId'), quote: tx('return.schema.quote') }] }, null, 2));
  }
  function renderToolShare() {
    const shared = state.packet?.sharedWithTools === true;
    text('tool-share-state', shared ? tx('return.share.openNote') : tx('return.share.closedState'));
    $('tool-share-state').classList.toggle('shared', shared);
    show('tool-share-open', !shared); show('tool-share-close', shared); $('tool-share-consent').closest('label').hidden = shared;
  }
  async function setToolShare(packetId, shared) {
    if (shared && (state.packet?.id !== packetId || !$('tool-share-consent').checked)) throw Error(tx('return.err.shareConsent'));
    const result = await call('records-share', { packetId, shared, confirmedByUser: true });
    await refresh();
    if (state.packet?.id === packetId) { state.packet = state.data.packets.find(p => p.id === packetId) || result.packet; $('tool-share-consent').checked = false; renderToolShare(); }
    const message = shared ? tx('return.share.opened') : tx('return.share.closed');
    if (state.packet?.id === packetId) text('tool-share-status', message); text('page-status', message);
  }
  async function saveReply() {
    if (!state.packet) throw Error(tx('return.err.noPacket'));
    const rawText = $('reply-text').value; if (!rawText.trim()) throw Error(tx('return.err.pasteReply'));
    // Pressing the button is the declaration; the reply stays a comment either way.
    const { reply } = await mutation('records-reply', { packetId: state.packet.id, rawText, format: $('reply-format').value, confirmedByUser: true });
    await refresh();
    if (reply.validationStatus === 'invalid') { error('reply-error', reply.validationError || tx('return.reply.invalidFix')); text('reply-status', tx('return.reply.invalidKept')); return; }
    text('reply-status', tx('return.reply.saved'));
  }
  function renderReplies() {
    const replies = state.data.replies.filter(r => r.topicId === state.topicId), list = $('commentary-list'); list.replaceChildren(); show('commentaries-panel', state.screen === 'topic' && Boolean(replies.length));
    for (const reply of [...replies].sort((a, b) => String(b.createdAt).localeCompare(String(a.createdAt)) || a.id.localeCompare(b.id))) {
      const article = node('article', null, 'commentary'); article.dataset.replyId = reply.id;
      const packet = state.data.packets.find(p => p.id === reply.packetId), label = reply.validationStatus === 'valid' ? tx('return.reply.valid') : reply.validationStatus === 'invalid' ? tx('return.reply.invalid') : tx('return.reply.unverified');
      const body = node('div', reply.commentary || reply.rawText, 'body'); body.tabIndex = 0;
      article.append(node('p', (targets[packet?.target]?.[0] || packet?.target || tx('return.reply.noService')) + ' · ' + date(reply.createdAt), 'small'), node('p', label, 'badge warning'), body);
      if (reply.validationStatus === 'invalid') {
        article.append(node('p', reply.validationError || tx('return.reply.mismatch'), 'error'));
        const fix = button(tx('return.reply.fix'), 'quiet'); fix.onclick = () => { if (!packet) return; openContext(); displayPacket(packet); $('reply-text').value = reply.rawText; $('reply-format').value = 'json'; readiness(); reveal($('reply-panel'), $('reply-text')); }; article.append(fix);
      } else {
        const convert = button(tx('return.reply.toRecord'), 'secondary'); convert.dataset.replyCandidate = reply.id; convert.onclick = () => guard(() => newRecord({ replyId: reply.id }, reply.commentary || reply.rawText, T.replyTitle + ' · ' + date(reply.createdAt), 'assistant')); article.append(convert);
      }
      list.append(article);
    }
  }

  // --- Bağlı AI aracı: konu izni ve gelen kutusu ------------------------------
  async function loadExtras() {
    const id = state.topicId;
    if (state.screen !== 'topic' || !currentTopic()) return;
    let extra;
    try { const view = await call('records-topic', { topicId: id }); extra = { topicId: id, openTasks: Array.isArray(view.openTasks) ? view.openTasks.map(r => r.id) : null, toolAccess: view.toolAccess?.read ? view.toolAccess : null }; }
    catch { extra = { topicId: id, openTasks: null, toolAccess: null, failed: true }; }
    if (state.topicId !== id) return;
    state.extra = extra; syncToolAccess(); if (state.screen === 'topic') renderTopic();
  }
  const topicAccess = () => state.extra?.topicId === state.topicId && !state.extra.failed ? state.extra.toolAccess || { read: false, write: false } : null;
  function syncToolAccess() {
    const access = topicAccess(); $('tool-access-read').checked = Boolean(access?.read); $('tool-access-write').checked = Boolean(access?.read && access?.write); error('tool-access-error'); toolAccessReadiness();
  }
  function renderToolAccess() {
    const access = topicAccess(), open = Boolean(access?.read);
    text('tool-access-state', !access ? (state.extra?.topicId === state.topicId ? tx('return.access.unreadable') : tx('return.access.loading')) : open ? tx(access.write ? 'return.access.openReadWrite' : 'return.access.openRead') : tx('return.share.closedState'));
    $('tool-access-state').classList.toggle('shared', open); show('tool-access-close', open);
    toolAccessReadiness();
  }
  function toolAccessReadiness() {
    const access = topicAccess(), read = $('tool-access-read').checked;
    if (!read) $('tool-access-write').checked = false;
    $('tool-access-read').disabled = !access; $('tool-access-write').disabled = !access || !read;
    $('tool-access-save').disabled = state.busy || !access || (read === Boolean(access.read) && $('tool-access-write').checked === Boolean(access.write));
    $('tool-access-close').disabled = state.busy;
  }
  async function setToolAccess(read, write) {
    const topicId = state.topicId; if (write && !read) throw Error(tx('return.err.writeNeedsRead'));
    await call('records-tool-access', { topicId, read, write, confirmedByUser: true });
    await refresh(); await loadInbox();
    text('tool-access-status', !read ? tx('return.access.topicClosed') : tx(write ? 'return.access.topicOpenedWrite' : 'return.access.topicOpenedRead'));
  }
  // One switch for every topic that exists now; each topic keeps its own panel too.
  function allAccessCounts() {
    const access = state.toolAccess; if (!access) return null;
    const topics = state.data.topics.map(t => t.id), open = topics.filter(id => access[id]?.read);
    return { total: topics.length, open: open.length, write: open.filter(id => access[id]?.write).length };
  }
  function syncAllToolAccess() {
    const c = allAccessCounts(), all = Boolean(c && c.total && c.open === c.total);
    $('all-tool-access-read').checked = all; $('all-tool-access-write').checked = all && c.write === c.total;
    text('all-tool-access-state', !c ? tx('return.access.unreadable') : !c.open ? tx('return.share.closedState') : all ? (c.write === c.total ? tx('return.access.allOpenReadWrite') : c.write ? tn('return.access.allOpenSomeWrite', c.write) : tx('return.access.allOpenRead')) : tx('return.access.someOpen', { open: c.open, total: c.total }));
    $('all-tool-access-state').classList.toggle('shared', Boolean(c?.open)); show('all-tool-access-close', Boolean(c?.open));
    allToolAccessReadiness();
  }
  function allToolAccessReadiness() {
    const c = allAccessCounts(), read = $('all-tool-access-read').checked;
    if (!read) $('all-tool-access-write').checked = false;
    $('all-tool-access-read').disabled = !c || !c.total; $('all-tool-access-write').disabled = !c || !c.total || !read;
    const same = c && read === (c.total > 0 && c.open === c.total) && $('all-tool-access-write').checked === (c.total > 0 && c.open === c.total && c.write === c.total);
    $('all-tool-access-save').disabled = state.busy || !c || !c.total || !read || same;
    $('all-tool-access-close').disabled = state.busy;
  }
  async function setAllToolAccess(read, write) {
    if (write && !read) throw Error(tx('return.err.writeNeedsRead'));
    const result = await call('records-tool-access-all', { read, write, confirmedByUser: true });
    await refresh(); await loadInbox();
    text('all-tool-access-status', !read ? tx('return.access.allClosed') : tn(write ? 'return.access.allOpenedWrite' : 'return.access.allOpenedRead', result.topics));
  }
  async function loadInbox() {
    try { const result = await call('inbox'); state.inbox = Array.isArray(result.items) ? result.items : []; state.toolAccess = result.toolAccess && typeof result.toolAccess === 'object' ? result.toolAccess : {}; state.inboxFailed = false; }
    catch { state.inbox = []; state.toolAccess = null; state.inboxFailed = true; }
    renderInbox(); syncAllToolAccess();
  }
  // Proposals from connected AI tools, grouped by tool and by the day they arrived.
  function renderInbox() {
    const list = $('inbox-list'); list.replaceChildren();
    show('inbox-panel', state.inbox.length > 0 || state.inboxFailed || Boolean($('inbox-status').textContent));
    text('inbox-heading', state.inbox.length ? tx('return.inbox.heading') + ' · ' + W.proposals(state.inbox.length) : tx('return.inbox.heading'));
    text('review-nav-note', state.inbox.length ? T.reviewNoteInbox(state.inbox.length) : T.reviewNote);
    error('inbox-error', state.inboxFailed ? tx('return.inbox.failed') : '');
    const tools = new Map();
    for (const entry of state.inbox) {
      const tool = entry.item?.tool || tx('return.tools.heading'), day = dayLabel(entry.item?.receivedAt);
      if (!tools.has(tool)) tools.set(tool, new Map()); const days = tools.get(tool);
      if (!days.has(day)) days.set(day, []); days.get(day).push(entry);
    }
    let toolIndex = 0;
    for (const [tool, days] of tools) {
      const section = node('section', null, 'waiting-subgroup tool-group'), count = [...days.values()].reduce((n, entries) => n + entries.length, 0), heading = node('h4', T.waiting.fromTool(tool) + ' · ' + T.waiting.proposals(count), 'waiting-subheading');
      heading.id = 'inbox-group-' + (++toolIndex); section.setAttribute('aria-labelledby', heading.id); section.dataset.tool = tool; section.append(heading);
      for (const [day, entries] of days) { section.append(node('p', day + ' · ' + T.waiting.proposals(entries.length), 'session-head')); for (const entry of entries) section.append(inboxItem(entry)); }
      list.append(section);
    }
    updateWaitingCounts(); renderWaitingPane();
  }
  const dayLabel = value => { if (!value || Number.isNaN(new Date(value).getTime())) return tx('return.noDate'); return new Date(value).toLocaleDateString(I18N.locale(), { dateStyle: 'long' }); };
  function inboxItem(entry) {
    const item = entry.item || {}, article = node('article', null, 'record-card inbox-item waiting-item'); article.dataset.inboxItem = item.id; article.dataset.waitingItem = 'proposal:' + item.id;
    article.append(statusLine(null, [labels.inbox[item.kind] || tx('return.inbox.kind.proposal')], true, false), node('p', (item.tool || tx('return.tools.heading')) + ' · ' + date(item.receivedAt) + ' · ' + W.topic(entry.topicTitle || topicName(item.topicId)), 'small'), node('p', item.text, 'record-text'));
    if (entry.related?.text) article.append(node('p', T.waiting.related(entry.related.kind) + entry.related.text, 'small related'));
    const consent = node('label', null, 'check'), box = document.createElement('input'), accept = button(tx('return.inbox.accept'), 'primary'), dismiss = button(W.remove, 'quiet'), actions = node('div', null, 'actions waiting-actions'), problem = node('p', null, 'error');
    box.type = 'checkbox'; box.dataset.inboxConsent = item.id; consent.append(box, node('span', tx('return.inbox.consent')));
    accept.dataset.inboxAccept = item.id; accept.disabled = true; dismiss.dataset.inboxDismiss = item.id; problem.setAttribute('role', 'alert'); problem.hidden = true;
    accept.setAttribute('aria-label', tx('return.inbox.accept') + ': ' + String(item.text || '').slice(0, 80)); dismiss.setAttribute('aria-label', W.remove + ': ' + String(item.text || '').slice(0, 80));
    box.onchange = () => { accept.disabled = state.busy || !box.checked; };
    accept.onclick = () => run(accept, problem, async () => {
      if (!box.checked) throw Error(tx('return.inbox.consentHint'));
      const at = waitingIndex('proposal', item.id);
      await call('inbox-accept', { itemId: item.id, confirmedByUser: true });
      if (sameSelection('proposal', item.id)) state.waitingSelected = null;
      text('inbox-status', tx('return.inbox.accepted', { topic: entry.topicTitle || topicName(item.topicId) }));
      await refresh(); await loadInbox(); return () => focusInbox(at);
    });
    dismiss.onclick = () => run(dismiss, problem, async () => {
      const at = waitingIndex('proposal', item.id);
      await call('inbox-dismiss', { itemId: item.id, confirmedByUser: true });
      if (sameSelection('proposal', item.id)) state.waitingSelected = null;
      text('inbox-status', tx('return.inbox.dismissed'));
      await loadInbox(); return () => focusInbox(at);
    });
    actions.append(accept, dismiss, detailsButton('proposal', item)); article.append(consent, actions, problem);
    selectOnClick(article, 'proposal', item.id); markSelected(article, 'proposal', item.id); return article;
  }

  // After an item leaves the inbox, focus moves to the one that took its place.
  function focusInbox(index) {
    const items = [...$('inbox-list').querySelectorAll('[data-inbox-item]')], next = items[Math.min(index, items.length - 1)];
    (next?.querySelector('input') || $('inbox-heading')).focus({ preventScroll: true });
  }

  // --- Bakım -------------------------------------------------------------------
  // Trash: hidden everywhere, restorable; permanent removal needs a separate consent.
  function renderTrash() {
    const items = Array.isArray(state.data.trash) ? state.data.trash : [], list = $('trash-list'); list.replaceChildren();
    text('trash-heading', items.length ? tx('return.trash.heading') + ' · ' + items.length : tx('return.trash.heading'));
    if (!items.length) list.append(node('p', tx('return.trash.empty'), 'small'));
    for (const r of [...items].sort((a, b) => String(b.trashedAt).localeCompare(String(a.trashedAt)))) {
      const article = node('article', null, 'record-card trash-item'), actions = node('div', null, 'actions'), back = button(tx('return.trash.restore'), 'secondary'), purge = button(tx('return.trash.purge'), 'quiet danger'), problem = node('p', null, 'error');
      article.dataset.trashItem = r.id; problem.setAttribute('role', 'alert'); problem.hidden = true;
      const meta = statusLine(null, [labels.kind[r.kind] || r.kind, topicName(r.topicId), tx('return.trash.deletedAt', { date: date(r.trashedAt) })], false, false);
      back.dataset.trashRestore = r.id; purge.dataset.trashPurge = r.id; purge.disabled = state.busy || !$('trash-purge-consent').checked;
      back.onclick = () => run(back, problem, async () => { await call('records-untrash', { id: r.id, confirmedByUser: true }); await refresh(); text('trash-status', tx('return.trash.restored')); return () => $('trash-heading').focus({ preventScroll: true }); });
      purge.onclick = () => run(purge, problem, async () => {
        if (!$('trash-purge-consent').checked) throw Error(tx('return.trash.purgeConsent'));
        await call('records-purge', { id: r.id, confirmedByUser: true }); await refresh(); $('trash-purge-consent').checked = false; renderTrash();
        text('trash-status', tx('return.trash.purged')); return () => $('trash-heading').focus({ preventScroll: true });
      });
      actions.append(back, purge); article.append(meta, node('p', r.text, 'record-text'), actions, problem); list.append(article);
    }
  }
  async function trashRecord() {
    const record = state.editing; if (!record) throw Error(tx('return.err.openRecord'));
    await call('records-trash', { id: record.id, expectedRevision: record.revision, confirmedByUser: true });
    closeEditor(); await refresh(); await loadInbox();
    text('record-result', tx('return.trash.moved'));
  }
  function renderBackups() {
    const previous = $('restore-backup').value; $('restore-backup').replaceChildren(option('', state.data.backups.length ? tx('return.backup.choose') : tx('return.backup.none')));
    state.data.backups.forEach((backup, index) => { const id = typeof backup === 'string' ? backup : backup.id || backup.backupId; const item = option(id, (typeof backup === 'string' ? tx('return.backup.numbered', { n: index + 1 }) : date(backup.createdAt)) + (backup.valid === false ? ' · ' + tx('return.backup.broken') : '')); item.disabled = backup.valid === false; $('restore-backup').append(item); });
    $('restore-backup').value = previous; if ($('restore-backup').selectedIndex < 0) $('restore-backup').value = ''; readiness();
  }
  async function previewMigration() {
    state.migration = await call('records-migration-preview'); $('migration-consent').checked = false;
    renderMigration(); show('migration-panel', true); readiness();
  }
  function renderMigration() {
    const list = $('migration-list'); list.replaceChildren();
    for (const candidate of state.migration.candidates || []) {
      const row = node('article', null, 'record-card'), record = candidate.record || candidate;
      row.append(node('p', record.text || record.statement || record.title || tx('return.legacy.unreadable'), 'record-text'), node('p', [tx('return.history.review', { value: labels.review[record.review] || tx('return.legacy.keep') }), tx('return.history.adoption', { value: labels.adoption[record.adoption] || tx('return.legacy.keep') }), tx('return.history.currency', { value: labels.currency[record.currency] || tx('return.label.notStated') })].join(' · '), 'small'));
      if (record.source?.excerpt) row.append(node('pre', record.source.excerpt)); list.append(row);
    }
    text('legacy-status', tn('return.legacy.count', state.migration.candidates?.length || 0));
  }
  async function loadSourceFromUrl() {
    const params = new URLSearchParams(location.search), conversationId = params.get('conversationId'), messageId = params.get('messageId');
    if (!conversationId || !messageId) return;
    const conversation = await call('conversation', { id: conversationId }), message = conversation.messages?.find(m => m.id === messageId);
    if (!message || !['user', 'assistant', 'human'].includes(message.role)) throw Error(tx('return.err.wordsMissing'));
    if (!state.data.topics.length) { state.pendingSource = { conversation, message }; newRecord(); return; }
    newRecord({ conversationId, messageId }, message.text, conversation.title || tx('return.untitledConversation'), message.role);
  }

  // --- Olaylar -----------------------------------------------------------------
  // The state selects keep their value when the language changes; only the labels move.
  function fillStateSelects() {
    for (const key of ['review', 'adoption', 'currency', 'priority']) { const select = $('record-' + key), value = select.value, disabled = [...select.options].filter(o => o.disabled).map(o => o.value); select.replaceChildren(...Object.entries(labels[key]).map(([v, title]) => { const o = option(v, title); o.disabled = disabled.includes(v); return o; })); if (value) select.value = value; }
  }
  fillStateSelects();
  const toggleTopicForm = open => { show('new-topic-form', open); $('new-topic-toggle').setAttribute('aria-expanded', String(open)); if (open) $('topic-name').focus(); };
  $('new-topic-toggle').onclick = () => toggleTopicForm($('new-topic-form').hidden);
  $('first-run-topic').onclick = () => toggleTopicForm(true);
  $('new-topic-form').onsubmit = event => { event.preventDefault(); run('topic-save', 'topic-error', async () => {
    const title = $('topic-name').value.trim(); if (!title) throw Error(tx('return.err.topicName'));
    const { topic } = await mutation('records-topic-create', { title, goal: $('topic-purpose').value.trim() }); state.topicId = topic.id; state.screen = 'topic'; await refresh(); history.replaceState(null, '', '/konular?topicId=' + encodeURIComponent(topic.id)); $('new-topic-form').reset(); toggleTopicForm(false);
    text('page-status', tx('return.topic.created'));
    if (state.pendingSource) { const { conversation, message } = state.pendingSource; state.pendingSource = null; return () => newRecord({ conversationId: conversation.id, messageId: message.id }, message.text, conversation.title, message.role); }
    return () => $('new-record').focus({ preventScroll: true });
  }); };
  $('nav-overview').onclick = () => guard(() => selectGlobal('overview')); $('nav-review').onclick = () => guard(() => selectGlobal('review')); $('overview-open-review').onclick = () => guard(() => selectGlobal('review'));
  $('global-decision-candidates').onclick = () => guard(() => { $('review-topic-filter').value = ''; $('review-kind-filter').value = 'decision'; $('review-search').value = ''; state.queuePage = 0; selectGlobal('review'); history.replaceState(null, '', '/konular?' + WAITING_QUERY + '&kind=decision'); });
  $('topic-search').oninput = renderTopics;
  for (const id of ['review-topic-filter', 'review-kind-filter', 'review-search']) $(id).addEventListener(id === 'review-search' ? 'input' : 'change', () => { state.queuePage = 0; renderReviewQueue(); });
  const turnPage = step => { state.queuePage += step; renderReviewQueue(); reveal($('global-review'), $('global-review-heading')); };
  $('global-review-heading').tabIndex = -1;
  $('review-prev').onclick = () => { if (state.busy || state.queuePage === 0) return; turnPage(-1); };
  $('review-next').onclick = () => { if (state.busy || (state.queuePage + 1) * 20 >= filteredQueue().length) return; turnPage(1); };
  $('waiting-unskip').onclick = () => { if (state.busy) return; state.skipped.clear(); renderReviewQueue(); text('waiting-status', ''); focusWaiting('record', 0); };
  $('review-source-more').onclick = () => { if (state.busy) return; state.sourceCheckLimit += 6; renderSourceChecks(); };
  $('review-open-first').onclick = () => { const record = filteredQueue()[state.queuePage * 20]; if (record) guard(() => openGlobalRecord(record), record); };
  $('new-record').onclick = () => guard(() => newRecord());
  $('record-close').onclick = () => guard(() => { closeEditor(); $('new-record').focus?.({ preventScroll: true }); });
  $('record-discard-yes').onclick = () => { const proceed = state.afterDiscard; markClean(); show('record-discard', false); state.afterDiscard = null; if (proceed) proceed(); };
  $('record-discard-no').onclick = () => { show('record-discard', false); state.afterDiscard = null; $('record-text').focus({ preventScroll: true }); };
  $('record-kind').onchange = updateKind;
  $('record-topic').onchange = () => { renderAnswerQuestions(); updateKind(); };
  $('record-trash').onclick = () => run('record-trash', 'record-error', trashRecord);
  $('trash-purge-consent').onchange = renderTrash; $('trash-heading').tabIndex = -1;
  $('record-form').onsubmit = event => { event.preventDefault(); run('record-save', 'record-error', () => saveRecord()); };
  $('record-save-adopt').onclick = () => run('record-save-adopt', 'record-error', () => saveRecord({ adopt: true }));
  $('record-save-next').onclick = () => run('record-save-next', 'record-error', () => saveRecord({ next: true }));
  for (const [id, quick] of [['quick-adopt', 'adopt'], ['quick-hypothesis', 'hypothesis'], ['quick-reject', 'reject'], ['quick-keep-open', 'keepOpen']]) $(id).onclick = () => run(id, 'record-error', () => saveRecord({ quick }));
  $('quick-consent').onchange = quickReadiness; $('question-close-consent').onchange = quickReadiness;
  $('question-close-apply').onclick = () => run('question-close-apply', 'record-error', () => saveRecord({ close: true }));
  for (const view of ['current', 'pending', 'all']) $('view-' + view).onclick = () => { state.tab = 'records'; state.view = view; state.recordLimit = 30; renderTopic(); };
  $('tab-now').onclick = () => { state.tab = 'now'; state.view = 'current'; state.recordLimit = 30; renderTopic(); };
  $('tab-records').onclick = () => { if (state.tab !== 'records') state.view = 'all'; state.tab = 'records'; state.recordLimit = 30; renderTopic(); };
  $('source-pane-edit').onclick = () => { const record = topicRecords().find(r => r.id === state.sourceRecordId); if (record) guard(() => editRecord(record), record); };
  // The top menu and the breadcrumb switch views in place, so an unsaved editor is never dropped by a reload.
  for (const [id, screen] of [['topnav-topics', 'overview'], ['topnav-waiting', 'review'], ['crumb-topics', 'overview']]) $(id).addEventListener('click', event => {
    if (event.button !== 0 || event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return;
    event.preventDefault(); guard(() => selectGlobal(screen));
  });
  $('context-open').onclick = openContext; $('context-close').onclick = () => { show('context-panel', false); $('context-open').focus({ preventScroll: true }); };
  $('context-include-ai').onchange = () => { invalidatePacket(); if (!$('context-include-ai').checked) for (const record of topicRecords().filter(isSelectableProposal)) state.selected.delete(record.id); renderContextChoices(); };
  for (const id of ['context-question', 'context-target', 'context-model']) $(id).addEventListener(id === 'context-target' ? 'change' : 'input', invalidatePacket);
  $('context-prepare').onclick = () => run('context-prepare', 'context-error', prepareContext);
  $('context-consent').onchange = readiness; $('tool-share-consent').onchange = readiness;
  $('tool-share-open').onclick = () => run('tool-share-open', 'context-error', () => setToolShare(state.packet?.id, true));
  $('tool-share-close').onclick = () => run('tool-share-close', 'context-error', () => setToolShare(state.packet?.id, false));
  const replyChanged = () => { error('reply-error'); readiness(); };
  $('reply-text').oninput = replyChanged; $('reply-format').onchange = replyChanged;
  $('context-copy').onclick = () => run('context-copy', 'context-error', async () => { if (!state.packet || !$('context-consent').checked) throw Error(tx('return.err.copyConsent')); if (!navigator.clipboard?.writeText) throw Error(tx('return.err.clipboard')); await navigator.clipboard.writeText(state.packet.text); text('context-copy-status', tx('return.context.copied')); });
  $('reply-save').onclick = () => run('reply-save', 'reply-error', saveReply);
  $('all-tool-access-read').onchange = allToolAccessReadiness; $('all-tool-access-write').onchange = allToolAccessReadiness;
  $('all-tool-access-save').onclick = () => run('all-tool-access-save', 'all-tool-access-error', () => setAllToolAccess($('all-tool-access-read').checked, $('all-tool-access-read').checked && $('all-tool-access-write').checked));
  $('all-tool-access-close').onclick = () => run('all-tool-access-close', 'all-tool-access-error', async () => { await setAllToolAccess(false, false); return () => $('all-tool-access-details').querySelector('summary').focus({ preventScroll: true }); });
  $('tool-access-read').onchange = toolAccessReadiness; $('tool-access-write').onchange = toolAccessReadiness;
  $('tool-access-save').onclick = () => run('tool-access-save', 'tool-access-error', () => setToolAccess($('tool-access-read').checked, $('tool-access-read').checked && $('tool-access-write').checked));
  $('tool-access-close').onclick = () => run('tool-access-close', 'tool-access-error', async () => { await setToolAccess(false, false); return () => $('tool-access-details').querySelector('summary').focus({ preventScroll: true }); });
  for (const id of ['topic-title', 'global-overview-heading', 'inbox-heading']) $(id).tabIndex = -1;
  $('backup-create').onclick = () => run('backup-create', 'maintenance-error', async () => { const backup = await call('records-backup'); await refresh(); $('restore-backup').value = backup.backupId; readiness(); const saved = state.data.backups.find(b => (b.id || b.backupId) === backup.backupId); text('maintenance-status', tx('return.backup.taken', { date: date(saved?.createdAt || new Date().toISOString()) })); });
  $('topic-conversation-search').oninput = () => { state.conversationLimit = 20; renderConversationLinks(); };
  $('topic-conversations-more').onclick = () => { state.conversationLimit += 20; renderConversationLinks(); };
  $('bulk-preview').onclick = () => run('bulk-preview', 'bulk-error', previewBulk);
  $('bulk-consent').onchange = readiness;
  $('bulk-apply').onclick = () => run('bulk-apply', 'bulk-error', async () => {
    if (!state.bulk || !$('bulk-consent').checked) throw Error(tx('return.err.bulkConsent'));
    const result = await call('records-bulk-apply', { previewHash: state.bulk.previewHash, confirmedByUser: true });
    state.bulk = null; $('bulk-consent').checked = false; show('bulk-preview-panel', false); await refresh(); invalidatePacket();
    text('bulk-status', result.alreadyApplied ? tx('return.bulk.already') : tx('return.bulk.done', { links: tn('return.bulk.linksAdded', result.linked), records: tn('return.summary.pending', result.candidatesCreated) }));
    text('page-status', tx('return.bulk.placed'));
  });
  $('migration-preview').onclick = () => run('migration-preview', 'legacy-error', previewMigration);
  $('migration-consent').onchange = readiness;
  $('migration-apply').onclick = () => run('migration-apply', 'legacy-error', async () => { if (!state.migration || !$('migration-consent').checked) throw Error(tx('return.err.migrationConsent')); const result = await call('records-migration-apply', { previewHash: state.migration.previewHash, confirmedByUser: true }); await refresh(); state.migration = null; show('migration-panel', false); invalidatePacket(); text('legacy-status', tn('return.legacy.imported', result.imported)); });
  $('restore-consent').onchange = readiness; $('restore-backup').onchange = () => { $('restore-consent').checked = false; readiness(); };
  $('restore-apply').onclick = () => run('restore-apply', 'maintenance-error', async () => { if (!$('restore-consent').checked || !$('restore-backup').value) throw Error(tx('return.err.restoreConsent')); await call('records-restore', { backupId: $('restore-backup').value, expectedStateHash: state.data.stateHash, confirmedByUser: true }); closeEditor(); await refresh(); invalidatePacket(); $('restore-consent').checked = false; readiness(); await loadInbox(); text('maintenance-status', tx('return.backup.restored')); });
  async function initialize() { error('page-error'); show('reload', false); try {
    // The saved interface language comes first, so the first render is already in it.
    await I18N.init(call); fillStateSelects(); text('page-status', tx('return.status.loading'));
    const params = new URLSearchParams(location.search); state.topicId = params.get('topicId') || '';
    if (params.has('kind') && ['opinion', 'decision', 'question', 'task'].includes(params.get('kind'))) $('review-kind-filter').value = params.get('kind');
    state.screen = params.get('view') === 'review' || params.get('gorunum') === 'bekleyenler' ? 'review' : params.get('view') === 'overview' ? 'overview' : params.has('topicId') || params.has('conversationId') ? 'topic' : 'overview';
    await refresh(); await loadSourceFromUrl();
    const record = state.data.records.find(r => r.id === params.get('recordId')); if (record && state.screen !== 'topic') openGlobalRecord(record);
    text('page-status', tx('return.status.ready'));
    await loadInbox();
  } catch (e) { error('page-error', friendly(e)); show('reload', true); } }
  // A language switch redraws the page in place. The screen, the selected topic and
  // record, the address and anything typed in the editor stay as they are; passing
  // notices are cleared because they described the last action in the old language.
  I18N.onChange(() => {
    fillStateSelects();
    for (const id of ['record-result', 'waiting-status', 'inbox-status', 'trash-status', 'maintenance-status', 'tool-access-status', 'all-tool-access-status', 'bulk-status', 'legacy-status', 'context-copy-status', 'tool-share-status', 'reply-status']) text(id, '');
    text('page-status', tx('return.status.ready'));
    renderTopics(); renderTopic(); renderGlobal(); renderBackups(); renderTrash(); syncAllToolAccess(); renderInbox();
    if (!$('record-editor').hidden) { editorTexts(); if (state.editing) renderHistory(state.editing); }
    if (!$('context-panel').hidden) renderContextChoices();
    if (state.packet) packetTexts(state.packet);
    if (state.bulk) renderBulk(state.bulk);
    if (state.migration) renderMigration();
    readiness();
  });
  $('reload').onclick = initialize; initialize();
})();
