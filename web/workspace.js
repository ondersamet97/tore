import { api, download } from '/private-client.js';

// All conversation content is rendered as text. The only browser-stored capability
// belongs to private-client; provider keys are sent once to the local RAM service.
(() => {
  'use strict';
  const $ = id => document.getElementById(id);
  // Interface text comes from i18n.js and i18n-workspace.js; tables are read at
  // call time because the language can change while the page is open.
  const I18N = globalThis.toreI18n;
  const tx = (k, v) => I18N.t(k, v);
  const tn = (k, c, v) => I18N.n(k, c, v);
  const locale = () => I18N.locale();
  const CC_LIMIT = 50, CC_PAGE = 100;
  const state = {
    conversations: [], conversation: null, leafId: '', rows: new Map(), developers: [],
    catalog: { models: [] }, catalogRefreshed: false, keyConfigured: false,
    draft: null, revision: 0, preview: null, previewRevision: 0,
    loadSequence: 0, busy: new Set(), scanned: false, drafts: [], draftBlocked: false, resultDraftId: null,
    transfer: false, stale: false, cc: { sessions: [], selected: new Set(), shown: CC_PAGE }
  };
  // One vocabulary for the whole notebook: "sen", "konuşma", "kayıt", "devam metni".
  const roleNames = () => ({ user: tx('workspace.role.user'), human: tx('workspace.role.user'), assistant: tx('workspace.role.assistant'), system: tx('workspace.role.system'), developer: tx('workspace.role.developer'), tool: tx('workspace.role.tool'), unknown: tx('workspace.role.unknown') });
  const roleName = role => roleNames()[role] || role;
  const authorships = () => [['unreviewed', tx('workspace.authorship.unreviewed')], ['human_original', tx('workspace.authorship.human')], ['ai_output', tx('workspace.authorship.ai')], ['third_party', tx('workspace.authorship.thirdParty')]];
  const maskNames = () => ({ email: tx('workspace.mask.email'), phone: tx('workspace.mask.phone'), key: tx('workspace.mask.key'), path: tx('workspace.mask.path'), literal: tx('workspace.mask.literal') });
  const maskTokens = () => ({ email: tx('workspace.token.email'), phone: tx('workspace.token.phone'), key: tx('workspace.token.key'), path: tx('workspace.token.path'), literal: tx('workspace.token.literal') });
  const modeNames = () => ({ manual: tx('workspace.mode.manual'), live: tx('workspace.mode.live'), simulation: tx('workspace.mode.simulation') });
  const importHelp = () => ({
    chatgpt: [tx('workspace.help.chatgpt1'), tx('workspace.help.chatgpt2'), tx('workspace.help.chatgpt3')],
    claude: [tx('workspace.help.claude1'), tx('workspace.help.claude2'), tx('workspace.help.claude3')],
    codex: [tx('workspace.help.codex1'), tx('workspace.help.codex2')],
    text: [tx('workspace.help.text1'), tx('workspace.help.text2')],
    file: [tx('workspace.help.file1'), tx('workspace.help.file2')]
  });
  const fileHints = () => ({ chatgpt: tx('workspace.hint.zip'), claude: tx('workspace.hint.zip'), codex: tx('workspace.hint.jsonl'), generic: '.json' });
  // Known service messages, rewritten to say what happened and what to do next.
  // The patterns read the service's own (Turkish) message, whatever the interface language.
  const knownErrors = () => [
    [/Yerel oturum açık değil|geçerli yanıt vermedi/, tx('workspace.error.disconnected')],
    [/şeması bulunamadı|dizisi veya nesnesi bekleniyor/, tx('workspace.error.wrongExport')],
    [/güvenli olmayan bir dosya yolu/, tx('workspace.error.unsafeZip')],
    [/çok fazla düğüm/, tx('workspace.error.tooLong')],
    [/1 ile 50 arasında oturum|Oturum seçin/, tx('workspace.error.sessionCount')],
    [/Claude Code oturumu (?:bulunamadı|okunamadı)|Oturum kimliği geçersiz/, tx('workspace.error.sessionGone')],
    [/Ev klasörü bulunamadı/, tx('workspace.error.noHome')],
    [/İşlem tamamlanamadı; başarı bildirilmedi/, tx('workspace.error.notFinished')]
  ];
  const friendly = error => {
    const shown = typeof error === 'string' ? error : error?.message || '';
    const raw = typeof error === 'string' ? error : error?.serverMessage || shown;
    return knownErrors().find(([pattern]) => pattern.test(raw) || pattern.test(shown))?.[1] || shown;
  };
  const call = (op, payload = {}) => api('/api/private/tore/' + op, payload);
  // Lines that can be said again in another language remember how they were made.
  const spoken = new Map();
  const text = (id, value) => { spoken.delete(id); $(id).textContent = value ?? ''; };
  const say = (id, make) => { $(id).textContent = make() ?? ''; spoken.set(id, make); };
  const show = (id, visible) => { $(id).hidden = !visible; };
  function node(tag, content, className) {
    const n = document.createElement(tag);
    if (content !== undefined && content !== null) n.textContent = String(content);
    if (className) n.className = className;
    return n;
  }
  function option(value, label, disabled = false) {
    const n = node('option', label); n.value = value; n.disabled = disabled; return n;
  }
  function labeled(labelText, control, className) {
    const n = node('label', labelText, className); n.append(control); return n;
  }
  function status(message, error = false) {
    if (typeof message === 'function') say('global-status', message); else text('global-status', message);
    $('global-status').classList.toggle('error', error);
  }
  function dateLabel(value) {
    if (!value) return tx('workspace.date.none');
    const date = new Date(value);
    return Number.isNaN(date.getTime()) ? tx('workspace.date.none') : date.toLocaleDateString(locale(), { day: 'numeric', month: 'short', year: 'numeric' });
  }
  function sizeLabel(bytes) {
    const n = Number(bytes) || 0;
    if (n < 1024) return n + ' B';
    if (n < 1024 * 1024) return Math.round(n / 1024) + ' KB';
    return (n / (1024 * 1024)).toLocaleString(locale(), { maximumFractionDigits: 1 }) + ' MB';
  }
  // Claude Code names a project folder after its path ("-Users-ad-Desktop-proje"); the home prefix is noise.
  function projectName(raw) {
    return String(raw || '').replace(/^-(?:Users|home)-[^-]+-?/, '').replace(/^-+/, '') || tx('workspace.cc.homeFolder');
  }
  function reveal(element) {
    const calm = window.matchMedia?.('(prefers-reduced-motion: reduce)')?.matches;
    element.scrollIntoView?.({ behavior: calm ? 'auto' : 'smooth', block: 'start' });
  }
  const sourceNames = () => ({ chatgpt: 'ChatGPT', claude: 'Claude', codex: 'Codex', generic: tx('workspace.source.other') });
  const developerName = id => sourceNames()[id] || state.developers.find(d => d.id === id)?.name || id || tx('workspace.source.unstated');
  const selectedRows = () => [...state.rows.values()].filter(row => row.checked);
  const effectiveMode = () => $('run-mode').value;
  const selectedModel = () => state.catalog.models.find(model => model.id === $('target-model').value && model.developer === $('target-developer').value);
  const zeroPrice = value => value === 0 || (typeof value === 'string' && /^(?:0+(?:\.0*)?|\.0+)$/.test(value));
  const freeModel = model => model?.free === true && zeroPrice(model.pricing?.prompt) && zeroPrice(model.pricing?.completion);
  const recordable = message => ['user', 'assistant'].includes(message.role) && !['analysis', 'reasoning', 'tool'].includes(message.phase);
  const recordHref = message => '/konular?conversationId=' + encodeURIComponent(state.conversation.id) + '&messageId=' + encodeURIComponent(message.id);

  // An error appears next to the button that caused it, never only at the top of the page.
  const errorSlots = new WeakMap();
  function errorSlot(button) {
    if (button.id === 'prepare-draft') return $('action-error');
    let slot = errorSlots.get(button);
    if (slot?.isConnected) return slot;
    if (!button.isConnected) return null;
    slot = node('p', null, 'error'); slot.setAttribute('role', 'alert'); slot.hidden = true;
    (button.closest('.actions') || button).after(slot); errorSlots.set(button, slot);
    return slot;
  }
  function showError(button, message) {
    const slot = errorSlot(button);
    if (slot) { slot.textContent = message; slot.hidden = !message; }
    else if (message) status(message, true);
  }
  async function run(button, action, statusId) {
    if (state.busy.has(button.id)) return;
    state.busy.add(button.id); button.disabled = true; showError(button, '');
    try { await action(); }
    catch (error) {
      if (statusId) text(statusId, '');
      showError(button, error?.message ? friendly(error) : tx('workspace.error.generic'));
    } finally { state.busy.delete(button.id); button.disabled = false; updateReady(); }
  }
  function invalidate() {
    state.revision += 1;
    if (state.draft) state.stale = true;
    state.draft = null; state.draftBlocked = false; show('draft-panel', false);
    $('send-consent').checked = false;
    showError($('prepare-draft'), ''); updateReady();
  }
  function renderWelcome() {
    const any = state.conversations.length > 0;
    text('welcome-heading', any ? tx('workspace.welcome.openHeading') : tx('workspace.welcome.emptyHeading'));
    text('welcome-text', any ? tx('workspace.welcome.openText') : tx('workspace.welcome.emptyText'));
    $('welcome-import').className = any ? 'secondary' : 'primary';
  }
  function renderList() {
    const list = $('conversation-list'); list.replaceChildren();
    text('conversation-count', state.conversations.length);
    text('conversation-count-label', tn('workspace.head.countLabel', state.conversations.length));
    const query = $('conversation-search').value.toLocaleLowerCase('tr').trim();
    const matches = state.conversations.filter(c => [c.title, c.provider, c.sourceApp, developerName(c.provider)].join(' ').toLocaleLowerCase('tr').includes(query));
    if (!matches.length) list.append(node('p', query ? tx('workspace.list.noMatch') : tx('workspace.list.empty'), 'small empty'));
    for (const c of matches) {
      const button = node('button', null, 'conversation-card'); button.type = 'button'; button.dataset.conversationId = c.id;
      button.setAttribute('aria-current', String(state.conversation?.id === c.id));
      button.append(node('span', developerName(c.provider), 'card-provider'), node('span', c.title || tx('workspace.untitled'), 'card-title'), node('span', tn('workspace.messages', c.messages?.length ?? 0) + ' · ' + dateLabel(c.updatedAt || c.createdAt), 'card-meta'));
      button.addEventListener('click', () => run(button, () => openConversation(c.id)));
      list.append(button);
    }
    renderWelcome();
  }
  function leaves(conversation) {
    const parents = new Set(conversation.messages.map(m => m.parentId).filter(Boolean));
    return conversation.messages.filter(message => !parents.has(message.id));
  }
  // With several endings, open the most recent one instead of an empty page.
  function latestLeaf(ends) {
    let best = ends[ends.length - 1], bestTime = -Infinity;
    for (const end of ends) { const time = Date.parse(end.timestamp || ''); if (!Number.isNaN(time) && time >= bestTime) { bestTime = time; best = end; } }
    return best;
  }
  function branchMessages() {
    if (!state.conversation || !state.leafId) return [];
    const byId = new Map(state.conversation.messages.map(message => [message.id, message]));
    const path = [], visited = new Set(); let current = byId.get(state.leafId);
    while (current && !visited.has(current.id)) {
      path.unshift(current); visited.add(current.id); current = current.parentId ? byId.get(current.parentId) : null;
    }
    return path;
  }
  async function openConversation(id) {
    const sequence = ++state.loadSequence;
    const conversation = await call('conversation', { id });
    if (sequence !== state.loadSequence) return;
    setConversation(conversation);
  }
  function setConversation(conversation) {
    invalidate(); state.conversation = conversation;
    const index = state.conversations.findIndex(c => c.id === conversation.id);
    if (index >= 0) state.conversations[index] = conversation; else state.conversations.unshift(conversation);
    paintConversationHead();
    text('conversation-warnings', (conversation.warnings || []).join('\n')); show('conversation-warnings', Boolean(conversation.warnings?.length));
    const ends = leaves(conversation), selector = $('branch-leaf');
    selector.replaceChildren();
    for (const [index, leaf] of ends.entries()) { const item = option(leaf.id, ''); item.dataset.version = String(index + 1); selector.append(item); }
    paintBranches();
    state.leafId = ends.some(end => end.id === conversation.selectedLeafId) ? conversation.selectedLeafId : ends.length ? latestLeaf(ends).id : '';
    selector.value = state.leafId;
    show('branch-bar', ends.length > 1);
    if (ends.length > 1) say('branch-hint', () => tn('workspace.branch.hint', ends.length)); else text('branch-hint', '');
    text('import-done', ''); show('import-done', false);
    show('welcome', false); show('conversation-workspace', true);
    initializeRows(); renderList();
  }
  function paintConversationHead() {
    const conversation = state.conversation; if (!conversation) return;
    text('conversation-title', conversation.title || tx('workspace.untitled'));
    text('conversation-source', developerName(conversation.provider) + ' · ' + (conversation.sourceApp || tx('workspace.conversation.imported')));
    text('conversation-meta', tn('workspace.messages', conversation.messages.length) + ' · ' + dateLabel(conversation.createdAt));
  }
  function paintBranches() {
    const byId = new Map((state.conversation?.messages || []).map(message => [message.id, message]));
    for (const item of $('branch-leaf').options) {
      if (item.dataset.version) item.textContent = tx('workspace.branch.version', { n: item.dataset.version, words: (byId.get(item.value)?.text || '').slice(0, 65).replace(/\s+/g, ' ') });
      else if (item.dataset.upToRecord) item.textContent = tx('workspace.branch.upToRecord');
    }
  }
  function initializeRows() {
    state.rows = new Map(branchMessages().map(message => [message.id, { message, checked: false, role: message.role === 'unknown' ? '' : message.role, text: message.text, authorship: 'unreviewed', rights: 'unreviewed', feedback: '' }]));
    state.scanned = false; show('pii-review', false);
    const own = [...state.rows.values()].map(row => row.message).filter(message => message.role === 'user' && recordable(message)).at(-1);
    show('primary-record', Boolean(own)); if (own) $('primary-record').href = recordHref(own);
    renderMessages(); updateReady();
  }
  function renderMessages() {
    const list = $('message-list'); list.replaceChildren();
    if (!state.rows.size) { list.append(node('p', state.conversation?.messages.length ? tx('workspace.message.noneInVersion') : tx('workspace.message.noText'), 'small empty')); return; }
    for (const row of state.rows.values()) {
      const message = row.message, card = node('article', null, 'message-card' + (row.checked ? ' is-selected' : ''));
      card.dataset.messageId = message.id;
      const selectable = ['user', 'assistant', 'unknown'].includes(message.role);
      const check = document.createElement('input'); check.type = 'checkbox'; check.checked = row.checked; check.dataset.action = 'select-message';
      check.disabled = !selectable; check.hidden = !state.transfer;
      const heading = node('div', null, 'message-card-heading');
      const selectLabel = node('label', null, 'check'); selectLabel.append(check, node('span', roleName(message.role) || tx('workspace.role.unknown'), 'message-role'));
      heading.append(selectLabel);
      if (recordable(message)) {
        const recordLink = node('a', tx('workspace.message.record'), 'link-button record-link');
        recordLink.dataset.sourceRecord = message.id; recordLink.href = recordHref(message);
        heading.append(recordLink);
      }
      card.append(heading);
      const original = node('p', message.text, 'message-body'); original.hidden = row.checked; original.tabIndex = 0; card.append(original);
      const editor = node('div', null, 'message-editor'); editor.hidden = !row.checked;
      let roleSelect;
      if (message.role === 'unknown') {
        roleSelect = document.createElement('select'); roleSelect.dataset.field = 'role';
        roleSelect.append(option('', tx('workspace.message.pickSpeaker')), option('user', tx('workspace.message.me')), option('assistant', 'AI')); roleSelect.value = row.role;
        editor.append(labeled(tx('workspace.message.whoSaid'), roleSelect));
      }
      const area = document.createElement('textarea'); area.value = row.text; area.rows = Math.min(12, Math.max(4, row.text.split('\n').length + 1)); area.dataset.field = 'text'; area.spellcheck = false;
      editor.append(labeled(tx('workspace.message.copyText'), area));
      const source = document.createElement('details'); source.append(node('summary', tx('workspace.message.original')), node('pre', message.text)); editor.append(source);
      const extra = document.createElement('details'), fields = node('div', null, 'field-grid'); extra.append(node('summary', tx('workspace.details')));
      const authorship = document.createElement('select'); authorship.dataset.field = 'authorship'; authorship.append(...authorships().map(([v, label]) => option(v, label, v === 'human_original' && row.role === 'assistant'))); authorship.value = row.authorship;
      if (roleSelect) roleSelect.addEventListener('change', () => {
        row.role = roleSelect.value; authorship.querySelector('[value="human_original"]').disabled = row.role === 'assistant';
        if (row.role === 'assistant' && row.authorship === 'human_original') { row.authorship = 'unreviewed'; authorship.value = row.authorship; }
        invalidate();
      });
      const rights = document.createElement('select'); rights.dataset.field = 'rights'; rights.append(option('unreviewed', tx('workspace.authorship.unreviewed')), option('user_attested', tx('workspace.rights.attested'))); rights.value = row.rights;
      fields.append(labeled(tx('workspace.message.whoWrote'), authorship), labeled(tx('workspace.rights.label'), rights));
      const feedback = document.createElement('input'); feedback.type = 'text'; feedback.value = row.feedback; feedback.placeholder = tx('workspace.message.notePlaceholder'); feedback.dataset.field = 'feedback';
      extra.append(node('p', tx('workspace.message.optional'), 'small'), fields, labeled(tx('workspace.message.note'), feedback, 'feedback-label')); editor.append(extra); card.append(editor);
      if (message.attachments?.length) card.append(node('p', tx('workspace.message.attachments', { list: message.attachments.join(' · ') }), 'small attachments'));
      if (!selectable) card.append(node('p', tx('workspace.message.systemOnly'), 'small'));
      if (message.model) card.append(node('p', 'Model: ' + message.model, 'small source-info'));
      const place = message.sourceLocator || message.sourceId;
      if (place) { const detail = document.createElement('details'); detail.className = 'detail'; detail.append(node('summary', tx('workspace.details')), node('p', tx('workspace.message.place', { place: place + (message.phase ? ' · ' + message.phase : '') }), 'small')); card.append(detail); }
      check.addEventListener('change', () => { row.checked = check.checked; editor.hidden = !row.checked; original.hidden = row.checked; card.classList.toggle('is-selected', row.checked); invalidate(); if (state.scanned) renderScan(); });
      for (const [control, field, event] of [[area, 'text', 'input'], [authorship, 'authorship', 'change'], [rights, 'rights', 'change'], [feedback, 'feedback', 'input']]) {
        control.addEventListener(event, () => { row[field] = control.value; invalidate(); if (state.scanned && (field === 'text' || field === 'feedback')) renderScan(); });
      }
      list.append(card);
    }
  }
  function setTransfer(open) {
    state.transfer = open;
    if (!open) for (const row of state.rows.values()) row.checked = false;
    show('continue-panel', open); show('transfer-tools', open); show('selection-count', open);
    $('continue-toggle').setAttribute('aria-expanded', String(open)); $('work-grid').classList.toggle('with-continue', open);
    invalidate(); renderMessages();
    if (open) { $('destination-heading').focus(); reveal($('work-grid')); }
  }
  function populateDevelopers() {
    for (const id of ['target-developer', 'import-developer']) {
      const selector = $(id), previous = selector.value;
      selector.replaceChildren(...state.developers.map(d => option(d.id, d.name)));
      if (state.developers.some(d => d.id === previous)) selector.value = previous;
    }
    renderModels(); renderList();
  }
  function renderModels() {
    const selector = $('target-model'), previous = selector.value, models = state.catalog.models.filter(model => model.developer === $('target-developer').value);
    selector.replaceChildren(option('', models.length ? tx('workspace.model.pickFree') : tx('workspace.model.none')));
    for (const model of models) selector.append(option(model.id, model.name + ' · ' + (freeModel(model) ? tx('workspace.model.free') : tx('workspace.model.closed')), !freeModel(model) || !state.catalogRefreshed));
    if (models.some(model => model.id === previous && freeModel(model)) && state.catalogRefreshed) selector.value = previous;
    text('model-hint', !state.catalogRefreshed ? tx('workspace.model.refreshFirst') : models.some(freeModel) ? tx('workspace.model.onlyFree') : tx('workspace.model.noFree'));
    updateReady();
  }
  function updateReady() {
    const selected = selectedRows(), mode = effectiveMode(), live = mode === 'live';
    text('selection-count', tn('workspace.selected', selected.length));
    show('model-field', live); show('model-hint', live); show('settings-toggle', live);
    if (!live && !$('settings-panel').hidden) { show('settings-panel', false); $('settings-toggle').setAttribute('aria-expanded', 'false'); }
    text('mode-status', live ? tx('workspace.mode.liveNote') : mode === 'simulation' ? tx('workspace.mode.simulationNote') : tx('workspace.mode.manualNote'));
    $('mode-status').classList.toggle('simulation', mode === 'simulation');
    let reason = '';
    if (!state.conversation || !state.leafId) reason = tx('workspace.ready.openFirst');
    else if (!selected.length) reason = tx('workspace.ready.pickMessage');
    else if (selected.length > 64) reason = tx('workspace.ready.tooMany');
    else if (selected.some(row => !row.text.trim())) reason = tx('workspace.ready.empty');
    else if (selected.some(row => !['user', 'assistant'].includes(row.role))) reason = tx('workspace.ready.speaker');
    else if (selected.some(row => row.role === 'assistant' && row.authorship === 'human_original')) reason = tx('workspace.ready.aiNotMine');
    else if (!$('target-developer').value) reason = tx('workspace.ready.target');
    else if (!$('target-question').value.trim()) reason = tx('workspace.ready.question');
    else if (live && !state.catalogRefreshed) reason = tx('workspace.model.refreshFirst');
    else if (live && !state.keyConfigured) reason = tx('workspace.ready.key');
    else if (live && !freeModel(selectedModel())) reason = tx('workspace.model.pickFree');
    $('prepare-draft').disabled = Boolean(reason) || state.busy.has('prepare-draft'); text('prepare-hint', reason || (state.stale ? tx('workspace.ready.stale') : tx('workspace.ready.ok')));
    $('execute-draft').disabled = !state.draft || state.draftBlocked || !$('send-consent').checked || state.busy.has('execute-draft');
    const previewChecks = [...$('import-preview-list').querySelectorAll('input[type=checkbox]')], previewChosen = previewChecks.filter(check => check.checked).length;
    $('commit-import').disabled = !state.preview || !previewChosen || state.busy.has('commit-import');
    text('preview-count', previewChecks.length ? tx('workspace.preview.count', { chosen: previewChosen, total: previewChecks.length }) : '');
    $('scan-pii').disabled = !selected.length; $('apply-masks').disabled = !selected.length;
    const chosen = state.cc.selected.size;
    $('cc-preview').disabled = !chosen || chosen > CC_LIMIT || state.busy.has('cc-preview');
    text('cc-count', state.cc.sessions.length ? tx('workspace.cc.count', { chosen, limit: CC_LIMIT }) : '');
  }

  function findings(value) {
    const result = [];
    const addMatches = (kind, expression) => { for (const match of value.matchAll(expression)) result.push({ kind, value: match[0], start: match.index, end: match.index + match[0].length }); };
    addMatches('email', /[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/gi);
    addMatches('key', /\b(?:sk-[A-Za-z0-9_-]{8,}|bearer\s+[A-Za-z0-9_-]{8,}|gh[pousr]_[A-Za-z0-9]{15,}|github_pat_[A-Za-z0-9_]{15,}|AIza[A-Za-z0-9_-]{20,})\b/gi);
    addMatches('key', /\b(?:api[_ -]?key|token|secret|password)\s*[:=]\s*[^\s,;]{6,}/gi);
    addMatches('path', /(?:\/(?:Users|home|private|tmp|var|Volumes|etc|opt)\/[^\s<>"']+|[A-Za-z]:\\[^\s<>"']+|file:\/\/[^\s]+)/g);
    for (const match of value.matchAll(/(?:\+\d{1,3}[\s.-]?)?(?:\(?\d{2,4}\)?[\s.-]){2,4}\d{2,4}|\+\d{9,15}|\b\d{10,15}\b/g)) {
      const digits = match[0].replace(/\D/g, '');
      if (digits.length >= 9 && digits.length <= 15 && !/^\d{4}-\d{2}-\d{2}$/.test(match[0])) result.push({ kind: 'phone', value: match[0], start: match.index, end: match.index + match[0].length });
    }
    for (const literal of [...new Set($('literal-masks').value.split('\n').map(s => s.trim()).filter(Boolean))]) {
      let start = value.indexOf(literal);
      while (start >= 0) { result.push({ kind: 'literal', value: literal, start, end: start + literal.length }); start = value.indexOf(literal, start + literal.length); }
    }
    return result;
  }
  function masked(value) {
    const tokens = maskTokens();
    const applicable = findings(value).filter(finding => finding.kind === 'literal' || $('mask-' + finding.kind).checked).sort((a, b) => a.start - b.start || b.end - a.end);
    let result = '', cursor = 0;
    for (const finding of applicable) {
      if (finding.start < cursor) continue;
      result += value.slice(cursor, finding.start) + tokens[finding.kind]; cursor = finding.end;
    }
    return result + value.slice(cursor);
  }
  function renderScan() {
    state.scanned = true; show('pii-review', true);
    const before = selectedRows().flatMap(row => findings(row.message.text)), after = selectedRows().flatMap(row => [...findings(row.text), ...findings(row.feedback)]);
    text('pii-before-count', tn('workspace.scan.findings', before.length)); text('pii-after-count', tn('workspace.scan.findings', after.length));
    const list = $('pii-findings'); list.replaceChildren();
    if (!after.length) list.append(node('p', tx('workspace.scan.clean'), 'small'));
    const names = maskNames();
    const unique = [...new Map(after.map(finding => [finding.kind + '\0' + finding.value, finding])).values()];
    for (const finding of unique.slice(0, 30)) { const row = node('div', null, 'pii-row'); row.append(node('span', names[finding.kind]), node('code', finding.value)); list.append(row); }
    if (unique.length > 30) list.append(node('p', tx('workspace.scan.first30'), 'small'));
    const questionFindings = findings($('target-question').value);
    text('question-pii', questionFindings.length ? tn('workspace.scan.question', questionFindings.length) : tx('workspace.scan.questionClean'));
  }

  function toggleImport(visible) {
    show('import-panel', visible); $('import-toggle').setAttribute('aria-expanded', String(visible));
    if (visible) { $('import-provider').focus(); reveal($('import-panel')); }
  }
  function clearImportPreview() { state.previewRevision += 1; state.preview = null; $('import-preview-list').replaceChildren(); show('import-preview', false); updateReady(); }
  function resetSessions() { state.cc = { sessions: [], selected: new Set(), shown: CC_PAGE }; $('cc-sessions').replaceChildren(); show('cc-chooser', false); text('cc-status', ''); }
  function updateImportFormat() {
    const provider = $('import-provider').value, sessions = provider === 'claude-code', generic = provider === 'generic', pasted = generic && $('import-generic-format').value === 'text';
    show('file-import', !sessions); show('cc-panel', sessions);
    show('import-file-field', !pasted); show('import-text-fields', pasted); show('import-developer-field', generic); show('import-generic-format-field', generic);
    $('import-file').accept = generic ? '.json,application/json' : '.json,.jsonl,.jsonl.zst,.zst,.zip,application/json,application/zip';
    paintImportFormat();
    clearImportPreview(); text('import-status', '');
  }
  // The words of the import form only; nothing chosen or previewed is touched.
  function paintImportFormat() {
    const provider = $('import-provider').value, generic = provider === 'generic', pasted = generic && $('import-generic-format').value === 'text';
    text('import-file-hint', fileHints()[provider] || '');
    const steps = importHelp()[generic ? (pasted ? 'text' : 'file') : provider] || [];
    text('import-help-title', generic ? tx('workspace.help.howTitle') : tx('workspace.help.whereTitle'));
    $('import-help-steps').replaceChildren(...steps.map(step => node('li', step))); show('import-help', steps.length > 0);
    text('preview-import', pasted ? tx('workspace.import.previewText') : tx('workspace.import.previewFile'));
  }
  function fileBase64(file) {
    return new Promise((resolve, reject) => {
      const reader = new FileReader(); reader.onload = () => resolve(String(reader.result).split(',')[1]); reader.onerror = () => reject(Error(tx('workspace.import.fileUnreadable'))); reader.readAsDataURL(file);
    });
  }
  // One preview list for every source: files, pasted text and Claude Code sessions all end in import-commit.
  function showPreview(preview, preselect = false) {
    state.preview = preview;
    paintPreview(new Set(preselect ? preview.conversations.map(c => c.id) : []));
    show('import-preview', true);
    const found = preview.conversations.length;
    say('import-status', () => found ? tn('workspace.preview.found', found) : tx('workspace.preview.none'));
    updateReady();
  }
  function paintPreview(checked) {
    const list = $('import-preview-list'), open = new Set([...list.querySelectorAll('details[open]')].map(d => d.dataset.conversationId)); list.replaceChildren();
    for (const conversation of state.preview?.conversations || []) {
      const row = node('div', null, 'import-choice'), check = document.createElement('input'); check.type = 'checkbox'; check.value = conversation.id; check.checked = checked.has(conversation.id); check.addEventListener('change', updateReady);
      const label = node('label', null, 'check'), when = conversation.updatedAt || conversation.createdAt;
      label.append(check, node('span', (conversation.title || tx('workspace.untitled')) + ' · ' + tn('workspace.messages', conversation.messages.length) + (when ? ' · ' + dateLabel(when) : ''))); row.append(label);
      const details = document.createElement('details'); details.dataset.conversationId = conversation.id; details.open = open.has(conversation.id); details.append(node('summary', tx('workspace.preview.look')));
      if (conversation.warnings?.length) details.append(node('p', conversation.warnings.join('\n'), 'notice warning-note'));
      for (const message of conversation.messages.slice(0, 12)) details.append(node('pre', roleName(message.role) + '\n' + message.text));
      if (conversation.messages.length > 12) details.append(node('p', tx('workspace.preview.first12'), 'small'));
      row.append(details); list.append(row);
    }
  }
  async function previewImport() {
    clearImportPreview(); const revision = state.previewRevision, provider = $('import-provider').value;
    if (provider === 'claude-code') return;
    const payload = { provider };
    if (provider === 'generic' && $('import-generic-format').value === 'text') {
      if (!$('import-text').value.trim()) throw Error(tx('workspace.import.pasteFirst'));
      Object.assign(payload, { text: $('import-text').value, title: $('import-title').value.trim(), developer: $('import-developer').value });
    } else {
      const file = $('import-file').files[0]; if (!file) throw Error(tx('workspace.import.pickFile'));
      if (file.size > 128 * 1024 * 1024) throw Error(tx('workspace.import.tooBig'));
      Object.assign(payload, { fileName: file.name, contentBase64: await fileBase64(file) });
    }
    say('import-status', () => tx('workspace.import.reading')); const preview = await call('import-preview', payload);
    if (revision !== state.previewRevision) return;
    showPreview(preview);
  }
  function setPreviewChecks(value) { for (const check of $('import-preview-list').querySelectorAll('input[type=checkbox]')) check.checked = value; updateReady(); }
  async function commitImport() {
    if (!state.preview) return;
    const selectedIds = [...$('import-preview-list').querySelectorAll('input:checked')].map(check => check.value);
    if (!selectedIds.length) throw Error(tx('workspace.import.pickOne'));
    const preview = state.preview, source = importSource(preview);
    const result = await call('import-commit', { previewId: state.preview.previewId, selectedIds });
    await renderReceipt(preview, selectedIds, result, source);
    state.conversations = (await call('list')).conversations; renderList();
    clearImportPreview(); resetSessions(); $('import-file').value = ''; $('import-text').value = ''; $('import-title').value = ''; text('import-status', ''); toggleImport(false);
    const summary = () => (count(result.imported) ? tn('workspace.import.imported', result.imported) : tx('workspace.import.done')) + (count(result.skipped) && result.skipped ? tn('workspace.import.skipped', result.skipped) : '.');
    status(summary);
    const chosen = result.conversations?.find(c => selectedIds.includes(c.id)) || result.conversations?.[0] || state.conversations.find(c => selectedIds.includes(c.id)) || state.conversations[0];
    if (!chosen) return;
    await openConversation(chosen.id);
    say('import-done', () => summary() + (result.imported > 1 ? tx('workspace.import.firstOpen') : tx('workspace.import.open'))); show('import-done', true);
    $('primary-record').hidden ? $('to-topics').focus() : $('primary-record').focus(); reveal($('conversation-workspace'));
  }

  // Import receipt: what was read, what was skipped and why, and what now waits.
  // Every number comes from a service answer; a number it did not give is left out.
  // Rows keep the dictionary key of their words, so a language switch redraws them.
  function importSource(preview) {
    const provider = $('import-provider').value, file = $('import-file').files?.[0];
    if (provider === 'claude-code') return { kind: 'sessions' };
    if (provider === 'generic' && $('import-generic-format').value === 'text') return { kind: 'pasted' };
    return file ? { kind: 'file', file: file.name } : { kind: '' };
  }
  const sourceLabel = source => source.kind === 'sessions' ? tx('workspace.receipt.sourceSessions') : source.kind === 'pasted' ? tx('workspace.receipt.sourcePasted') : source.kind === 'file' ? tx('workspace.receipt.sourceFile', { name: source.file }) : '';
  const count = value => Number.isInteger(value) && value >= 0;
  async function renderReceipt(preview, selectedIds, result, source) {
    const rows = [], found = Array.isArray(preview?.conversations) ? preview.conversations : null;
    // A note is either a dictionary key or, marked raw, text from the file or the service.
    const add = (what, value, note, raw = false) => { if (count(value)) rows.push({ what, value, note, raw }); };
    if (source.file) add('workspace.receipt.file', 1, source.file, true);
    if (found) {
      add('workspace.receipt.found', found.length, 'workspace.receipt.read');
      if (found.every(c => Array.isArray(c.messages))) add('workspace.receipt.messages', found.reduce((n, c) => n + c.messages.length, 0), 'workspace.receipt.messagesNote');
    }
    add('workspace.receipt.imported', result?.imported, 'workspace.receipt.importedNote');
    if (count(result?.skipped) && result.skipped > 0) add('workspace.receipt.skippedKnown', result.skipped, 'workspace.receipt.skippedKnownNote');
    if (found && found.length > selectedIds.length) add('workspace.receipt.skippedUnchosen', found.length - selectedIds.length, 'workspace.receipt.skippedUnchosenNote');
    const warned = found ? found.filter(c => Array.isArray(c.warnings) && c.warnings.length) : [];
    if (warned.length) add('workspace.receipt.warned', warned.length, [...new Set(warned.flatMap(c => c.warnings))].slice(0, 3).join(' · '), true);
    let waiting = null;
    try { const data = await call('records-list'); if (Array.isArray(data?.records)) waiting = data.records.filter(record => record.review === 'pending').length; } catch { waiting = null; }
    state.receipt = { rows, source, waiting };
    paintReceipt();
    show('import-receipt', true);
  }
  function paintReceipt() {
    if (!state.receipt) return;
    const { rows, source, waiting } = state.receipt, body = $('receipt-rows'); body.replaceChildren();
    for (const { what, value, note, raw } of rows) { const tr = node('tr'); tr.append(node('td', tx(what)), node('td', value.toLocaleString(locale()), 'num'), node('td', raw ? note : tx(note), 'small')); body.append(tr); }
    const label = sourceLabel(source); text('receipt-source', label); show('receipt-source', Boolean(label));
    text('receipt-waiting', waiting === null ? '' : waiting ? tn('workspace.receipt.waiting', waiting, { count: waiting.toLocaleString(locale()) }) : tx('workspace.receipt.noneWaiting')); show('receipt-waiting', waiting !== null);
  }
  $('receipt-close').addEventListener('click', () => { show('import-receipt', false); $('import-toggle').focus(); });

  // Claude Code sessions: listed only after the button is pressed; the list itself comes from the local service.
  function renderSessions() {
    const list = $('cc-sessions'); list.replaceChildren();
    for (const session of state.cc.sessions.slice(0, state.cc.shown)) {
      const row = node('div', null, 'import-choice' + (session.imported ? ' is-imported' : '')), check = document.createElement('input');
      check.type = 'checkbox'; check.value = session.id; check.disabled = Boolean(session.imported); check.checked = !session.imported && state.cc.selected.has(session.id);
      const label = node('label', null, 'check'), body = node('span');
      body.append(node('span', projectName(session.project), 'session-project'), node('span', dateLabel(session.modifiedAt) + ' · ' + sizeLabel(session.bytes), 'small'));
      if (session.imported) body.append(node('span', tx('workspace.cc.imported'), 'badge'));
      label.append(check, body); row.append(label); list.append(row);
      check.addEventListener('change', () => {
        if (check.checked && state.cc.selected.size >= CC_LIMIT) { check.checked = false; say('cc-status', () => tx('workspace.cc.limit', { limit: CC_LIMIT })); return; }
        if (check.checked) state.cc.selected.add(session.id); else state.cc.selected.delete(session.id);
        text('cc-status', ''); clearImportPreview();
      });
    }
    show('cc-more', state.cc.sessions.length > state.cc.shown); show('cc-chooser', state.cc.sessions.length > 0); updateReady();
  }
  async function listSessions() {
    clearImportPreview(); resetSessions(); say('cc-status', () => tx('workspace.cc.listing'));
    const result = await call('claude-code-sessions', {});
    state.cc.sessions = result.sessions || [];
    const done = state.cc.sessions.filter(session => session.imported).length;
    const total = state.cc.sessions.length;
    say('cc-status', () => !total ? tx('workspace.cc.none') : tn('workspace.cc.found', total) + (done ? tn('workspace.cc.alreadyImported', done) : '.') + tx('workspace.cc.pick'));
    renderSessions();
  }
  function selectAllSessions() {
    const open = state.cc.sessions.filter(session => !session.imported), picked = open.slice(0, CC_LIMIT);
    state.cc.selected = new Set(picked.map(session => session.id));
    if (picked.length) state.cc.shown = Math.max(state.cc.shown, state.cc.sessions.indexOf(picked.at(-1)) + 1);
    say('cc-status', () => !open.length ? tx('workspace.cc.noneLeft') : open.length > CC_LIMIT ? tn('workspace.cc.newestPicked', open.length - CC_LIMIT, { limit: CC_LIMIT }) : tn('workspace.cc.picked', picked.length));
    clearImportPreview(); renderSessions();
  }
  async function previewSessions() {
    const sessionIds = state.cc.sessions.filter(session => !session.imported && state.cc.selected.has(session.id)).map(session => session.id);
    if (!sessionIds.length) throw Error(tx('workspace.cc.pickOne'));
    if (sessionIds.length > CC_LIMIT) throw Error(tx('workspace.cc.tooMany', { limit: CC_LIMIT }));
    clearImportPreview(); const revision = state.previewRevision;
    say('import-status', () => tx('workspace.cc.reading'));
    const preview = await call('claude-code-preview', { sessionIds });
    if (revision !== state.previewRevision) return;
    showPreview(preview, true); reveal($('import-preview'));
  }

  async function prepareDraft() {
    if ($('prepare-draft').disabled && !state.busy.has('prepare-draft')) return;
    const revision = state.revision;
    const payload = {
      conversationId: state.conversation.id, leafId: state.leafId,
      items: selectedRows().map(row => ({ messageId: row.message.id, ...(row.message.role === 'unknown' ? { role: row.role } : {}), text: row.text, authorship: row.authorship, rights: row.rights, feedback: row.feedback })),
      intent: 'continue',
      developer: $('target-developer').value, modelId: effectiveMode() === 'live' ? $('target-model').value : '',
      mode: effectiveMode(), question: $('target-question').value.trim()
    };
    const result = await call('prepare', payload);
    if (revision !== state.revision) { state.stale = true; return; }
    state.draft = result.draft; state.stale = false; state.draftBlocked = Boolean(result.findings?.length); state.draftFindings = result.findings || []; renderDraft(); await refreshHistory();
  }
  function renderDraft() {
    $('send-consent').checked = false;
    paintDraft();
    say('draft-status', () => tx('workspace.draft.consentResets'));
    show('draft-panel', true); updateReady(); reveal($('draft-panel'));
  }
  // The draft's own text is never translated; only the words around it.
  function paintDraft() {
    const draft = state.draft; if (!draft) return;
    const modes = modeNames(), serverFindings = state.draftFindings || [];
    text('draft-mode', modes[draft.mode] || modes.live);
    text('draft-target', developerName(draft.developer) + (draft.modelId ? ' / ' + draft.modelId : ''));
    text('draft-hash', draft.hash); text('draft-question', draft.question || tx('workspace.draft.noQuestion')); text('draft-context', draft.contextText);
    const warnings = [...(draft.warnings || [])]; if (serverFindings.length) warnings.push(tn('workspace.draft.findings', serverFindings.length));
    text('draft-warnings', warnings.join('\n')); show('draft-warnings', warnings.length > 0);
    text('send-consent-text', draft.mode === 'live' ? tx('workspace.draft.consentLive') : draft.mode === 'simulation' ? tx('workspace.draft.consentSimulation') : tx('workspace.draft.consentManual'));
    text('execute-draft', draft.mode === 'live' ? tx('workspace.draft.executeLive') : draft.mode === 'simulation' ? tx('workspace.draft.executeSimulation') : tx('workspace.draft.executeManual'));
  }
  function resultAction(label, action) {
    const button = node('button', label); button.type = 'button'; button.addEventListener('click', () => run(button, action, 'result-status')); $('result-actions').append(button); return button;
  }
  async function executeDraft() {
    const draft = state.draft;
    if (!draft || state.draftBlocked || !$('send-consent').checked) throw Error(tx('workspace.draft.tickFirst'));
    let result;
    try { result = await call('send', { draftId: draft.id, hash: draft.hash, confirmed: true }); }
    catch (error) { invalidate(); refreshHistory().catch(() => {}); showError($('prepare-draft'), friendly(error) + tx('workspace.draft.previewAgain')); return; }
    state.resultDraftId = draft.id;
    $('result-actions').replaceChildren(); text('result-status', ''); show('result-text', false); show('result-panel', true);
    state.result = { mode: draft.mode, context: result.contextText || draft.contextText, revoked: false };
    paintResult();
    if (draft.mode !== 'manual') {
      if (result.conversation) {
        const response = result.conversation.messages.find(message => message.id === result.conversation.selectedLeafId) || [...result.conversation.messages].reverse().find(message => message.role === 'assistant');
        if (response) { text('result-text', response.text); show('result-text', true); }
        setConversation(result.conversation);
      }
    }
    state.draft = null; $('send-consent').checked = false; show('draft-panel', false);
    await refreshHistory(); updateReady(); $('result-heading').focus({ preventScroll: true }); reveal($('result-panel'));
  }
  // Result words and buttons; the answer or the continuation text itself stays as it is.
  function paintResult() {
    const result = state.result; if (!result) return;
    if (result.mode === 'manual') {
      text('result-heading', tx('workspace.result.manualHeading')); text('result-description', tx('workspace.result.manualText')); text('result-text', result.context); show('result-text', true);
      $('result-actions').replaceChildren();
      if (result.revoked) return;
      resultAction(tx('workspace.result.copy'), async () => { if (!navigator.clipboard?.writeText) throw Error(tx('workspace.result.noClipboard')); await navigator.clipboard.writeText(result.context); say('result-status', () => tx('workspace.result.copied')); });
      resultAction(tx('workspace.result.download'), () => download(result.context, tx('workspace.result.fileName'), 'text/plain;charset=utf-8'));
    } else {
      text('result-heading', result.mode === 'simulation' ? tx('workspace.result.simulationHeading') : tx('workspace.result.liveHeading'));
      text('result-description', result.mode === 'simulation' ? tx('workspace.result.simulationText') : tx('workspace.result.liveText'));
    }
  }
  async function revoke(id) {
    await call('revoke', { draftId: id });
    if (state.resultDraftId === id) { if (state.result) state.result.revoked = true; $('result-actions').replaceChildren(); say('result-status', () => tx('workspace.result.revoked')); }
    if (state.draft?.id === id) { state.draft = null; show('draft-panel', false); $('send-consent').checked = false; }
    await refreshHistory(); updateReady();
  }
  async function refreshHistory() {
    const result = await call('drafts'); state.drafts = result.drafts || [];
    renderHistory();
  }
  function renderHistory() {
    text('history-count', state.drafts.length); const list = $('draft-history'); list.replaceChildren();
    if (!state.drafts.length) list.append(node('p', tx('workspace.history.empty'), 'small empty'));
    const names = { ready: tx('workspace.history.ready'), revoked: tx('workspace.history.revoked'), sent: tx('workspace.history.done'), sending: tx('workspace.history.started'), unknown: tx('workspace.history.unknown'), completed: tx('workspace.history.done'), used: tx('workspace.history.used') }, modes = modeNames();
    for (const draft of [...state.drafts].sort((a, b) => String(b.createdAt || '').localeCompare(String(a.createdAt || ''))).slice(0, 50)) {
      const row = node('div', null, 'history-row'), content = node('div');
      content.append(node('p', (draft.intent !== 'continue' ? tx('workspace.history.oldKind') : modes[draft.mode] || modes.live) + ' · ' + developerName(draft.developer)), node('p', (names[draft.status] || tx('workspace.history.saved')) + ' · ' + dateLabel(draft.createdAt), 'small'));
      row.append(content);
      if (draft.status !== 'revoked') { const button = node('button', tx('workspace.history.revoke'), 'quiet'); button.id = 'revoke-' + draft.id; button.addEventListener('click', () => run(button, () => revoke(draft.id))); row.append(button); }
      list.append(row);
    }
  }

  $('import-toggle').addEventListener('click', () => toggleImport($('import-panel').hidden));
  $('welcome-import').addEventListener('click', () => toggleImport(true));
  $('import-close').addEventListener('click', () => toggleImport(false));
  $('import-provider').addEventListener('change', updateImportFormat);
  $('import-generic-format').addEventListener('change', updateImportFormat);
  for (const id of ['import-file', 'import-title', 'import-text', 'import-developer']) $(id).addEventListener(id === 'import-text' || id === 'import-title' ? 'input' : 'change', clearImportPreview);
  $('preview-import').addEventListener('click', () => run($('preview-import'), previewImport, 'import-status'));
  $('commit-import').addEventListener('click', () => run($('commit-import'), commitImport, 'import-status'));
  $('preview-select-all').addEventListener('click', () => setPreviewChecks(true));
  $('preview-clear').addEventListener('click', () => setPreviewChecks(false));
  $('cc-list').addEventListener('click', () => run($('cc-list'), listSessions, 'cc-status'));
  $('cc-select-all').addEventListener('click', selectAllSessions);
  $('cc-clear').addEventListener('click', () => { state.cc.selected.clear(); text('cc-status', ''); clearImportPreview(); renderSessions(); });
  $('cc-more').addEventListener('click', () => { state.cc.shown += CC_PAGE; renderSessions(); });
  $('cc-preview').addEventListener('click', () => run($('cc-preview'), previewSessions, 'import-status'));
  $('conversation-search').addEventListener('input', renderList);
  $('branch-leaf').addEventListener('change', () => { state.leafId = $('branch-leaf').value; invalidate(); initializeRows(); });
  $('continue-toggle').addEventListener('click', () => setTransfer(!state.transfer));
  $('select-human').addEventListener('click', () => { for (const row of state.rows.values()) row.checked = row.message.role === 'user' || row.message.role === 'human'; invalidate(); renderMessages(); if (state.scanned) renderScan(); });
  $('clear-selection').addEventListener('click', () => { for (const row of state.rows.values()) row.checked = false; invalidate(); renderMessages(); if (state.scanned) renderScan(); });
  $('scan-pii').addEventListener('click', renderScan);
  $('apply-masks').addEventListener('click', () => { for (const row of selectedRows()) { row.text = masked(row.text); row.feedback = masked(row.feedback); } invalidate(); renderMessages(); renderScan(); say('mask-status', () => tx('workspace.scan.masked')); });
  $('literal-masks').addEventListener('input', () => { if (state.scanned) renderScan(); });
  for (const id of ['run-mode', 'target-model']) $(id).addEventListener('change', invalidate);
  $('target-developer').addEventListener('change', () => { invalidate(); renderModels(); });
  $('target-question').addEventListener('input', () => { invalidate(); if (state.scanned) renderScan(); });
  $('prepare-draft').addEventListener('click', () => run($('prepare-draft'), prepareDraft));
  $('send-consent').addEventListener('change', updateReady);
  $('execute-draft').addEventListener('click', () => run($('execute-draft'), executeDraft, 'draft-status'));
  $('revoke-draft').addEventListener('click', () => run($('revoke-draft'), async () => { if (state.draft) await revoke(state.draft.id); }, 'draft-status'));
  $('settings-toggle').addEventListener('click', () => { const visible = $('settings-panel').hidden; show('settings-panel', visible); $('settings-toggle').setAttribute('aria-expanded', String(visible)); if (visible) { $('api-key').focus(); reveal($('settings-panel')); } });
  $('save-key').addEventListener('click', () => run($('save-key'), async () => {
    const key = $('api-key').value.trim(); $('api-key').value = '';
    if (!key) throw Error(tx('workspace.key.pasteFirst'));
    const result = await call('key', { key }); state.keyConfigured = Boolean(result.configured); invalidate(); const kept = state.keyConfigured; say('key-state', () => kept ? tx('workspace.key.kept') : tx('workspace.key.unknown'));
  }, 'key-state'));
  $('clear-key').addEventListener('click', () => run($('clear-key'), async () => { $('api-key').value = ''; const result = await call('key', { key: '' }); state.keyConfigured = Boolean(result.configured); invalidate(); const still = state.keyConfigured; say('key-state', () => still ? tx('workspace.key.notCleared') : tx('workspace.key.cleared')); }, 'key-state'));
  $('refresh-catalog').addEventListener('click', () => run($('refresh-catalog'), async () => {
    state.catalogRefreshed = false; updateReady(); const catalog = await call('catalog', { refresh: true });
    state.catalog = { ...catalog, models: catalog.models || [] }; state.catalogRefreshed = true; invalidate(); renderModels();
    const free = state.catalog.models.filter(freeModel).length;
    say('catalog-state', () => tn('workspace.catalog.free', free) + ' · ' + dateLabel(catalog.updatedAt) + (catalog.warnings?.length ? '\n' + catalog.warnings.join('\n') : ''));
  }, 'catalog-state'));

  // A language switch redraws everything in place: lists, the open conversation
  // (with its selections and edits), the import form and its preview, the
  // receipt, the draft and the result. Nothing is reloaded or sent again.
  function repaint() {
    for (const [id, make] of spoken) $(id).textContent = make() ?? '';
    paintImportFormat();
    if (state.preview) paintPreview(new Set([...$('import-preview-list').querySelectorAll('input:checked')].map(check => check.value)));
    if (state.cc.sessions.length) renderSessions();
    paintReceipt(); paintConversationHead(); paintBranches();
    if (state.conversation) renderMessages();
    if (state.scanned) renderScan();
    paintDraft(); paintResult(); renderHistory();
    renderModels(); renderList(); updateReady();
  }
  async function initialize() {
    await I18N.init(call);
    I18N.onChange(repaint);
    status(() => tx('workspace.status.opening'));
    updateImportFormat();
    const results = await Promise.allSettled([call('status'), call('list'), call('catalog', { refresh: false }), refreshHistory()]);
    const [statusResult, listResult, catalogResult] = results;
    if (statusResult.status === 'fulfilled') { const info = statusResult.value; state.developers = info.developers || []; state.keyConfigured = Boolean(info.keyConfigured); populateDevelopers(); const known = state.keyConfigured; say('key-state', () => known ? tx('workspace.key.present') : tx('workspace.key.none')); }
    if (listResult.status === 'fulfilled') { state.conversations = listResult.value.conversations || []; renderList(); }
    if (catalogResult.status === 'fulfilled') { state.catalog = { ...catalogResult.value, models: catalogResult.value.models || [] }; renderModels(); say('catalog-state', () => tx('workspace.catalog.loaded')); }
    const failed = results.find(result => result.status === 'rejected');
    if (failed) status(failed.reason?.message ? friendly(failed.reason) : tx('workspace.status.unreachable'), true);
    else { const any = state.conversations.length > 0; status(() => any ? tx('workspace.status.ready') : tx('workspace.status.empty')); }
    const params = new URLSearchParams(location.search), sourceConversationId = params.get('conversationId'), sourceMessageId = params.get('messageId');
    if (sourceConversationId && !failed) {
      try {
        await openConversation(sourceConversationId);
        if (sourceMessageId) {
          if (!state.conversation.messages.some(message => message.id === sourceMessageId)) throw Error(tx('workspace.record.messageMissing'));
          if (!state.rows.has(sourceMessageId)) {
            state.leafId = sourceMessageId;
            if (![...$('branch-leaf').options].some(item => item.value === sourceMessageId)) { const item = option(sourceMessageId, tx('workspace.branch.upToRecord')); item.dataset.upToRecord = '1'; $('branch-leaf').append(item); }
            $('branch-leaf').value = sourceMessageId; show('branch-bar', true);
            initializeRows(); say('branch-hint', () => tx('workspace.branch.upToRecordHint'));
          }
          const sourceCard = [...$('message-list').querySelectorAll('[data-message-id]')].find(card => card.dataset.messageId === sourceMessageId);
          if (sourceCard) { sourceCard.tabIndex = -1; sourceCard.focus(); sourceCard.scrollIntoView?.({ block: 'center' }); }
        }
      } catch (error) { status(friendly(error), true); }
    }
    updateReady();
  }
  initialize();
})();
