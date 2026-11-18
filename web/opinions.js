import { api } from './private-client.js';

const $ = id => document.getElementById(id);
// Interface text comes from i18n-opinions.js; labels are read at call time so a
// language switch can redraw them. The catalogue itself arrives in Turkish.
const tx = (key, vars) => toreI18n.t(key, vars), tn = (key, n, vars) => toreI18n.n(key, n, vars);
const statusLabel = status => ({ draft: tx('opinions.status.draft'), confirmed: tx('opinions.status.confirmed'), uncertain: tx('opinions.status.uncertain'), rejected: tx('opinions.status.rejected') })[status] || status;
const originLabel = attribution => ({ assistant_proposal: tx('opinions.origin.assistant_proposal'), user_statement: tx('opinions.origin.user_statement'), user_authored: tx('opinions.origin.user_authored') })[attribution] || tx('opinions.origin.review');
const changeLabel = type => ({ review: tx('opinions.history.review'), correction: tx('opinions.history.correction'), opinion_change: tx('opinions.history.opinion_change') })[type] || tx('opinions.history.review');
// Text set from a key remembers it, so a language switch can redraw it in place.
// Plain text (a service message, the person's own words) is left as it is.
function keyed(target, key, vars) { target.textContent = tx(key, vars); delete target.dataset.i18n; target.dataset.i18nKey = key; target.dataset.i18nVars = vars ? JSON.stringify(vars) : ''; }
function unkeyed(target, text) { target.textContent = text; delete target.dataset.i18n; delete target.dataset.i18nKey; delete target.dataset.i18nVars; }
function redrawKeyed() { for (const target of document.querySelectorAll('[data-i18n-key]')) target.textContent = tx(target.dataset.i18nKey, target.dataset.i18nVars ? JSON.parse(target.dataset.i18nVars) : undefined); }
const state = { cards: [], catalog: { topics: [], positions: [], traditions: [] }, currentId: null, creating: false, creationRequestId: null, dirty: false, busy: false, topic: 'all', filter: 'all', view: 'cards', contextRequest: 0, context: null };
const call = (op, body = {}) => api('/api/private/tore/' + op, body);
const currentCard = () => state.cards.find(card => card.id === state.currentId);
const topicFor = id => state.catalog.topics.find(topic => topic.id === id);
const date = value => { if (!value) return tx('opinions.noDate'); const d = new Date(value); return Number.isNaN(d.valueOf()) ? tx('opinions.noDate') : d.toLocaleDateString(toreI18n.locale(), { day: 'numeric', month: 'long', year: 'numeric' }); };
function node(tag, text, className) { const el = document.createElement(tag); if (text !== undefined) el.textContent = text; if (className) el.className = className; return el; }
function option(value, label) { const el = node('option', label); el.value = value; return el; }
function announce(key) { keyed($('page-status'), key); }
function error(key) { keyed($('editor-error'), key); $('editor-error').hidden = false; }
function setDirty() { state.dirty = true; keyed($('edit-state'), 'opinions.unsaved'); }
function canLeave() { return !state.dirty || window.confirm(tx('opinions.leaveUnsaved')); }
function markClean() { state.dirty = false; unkeyed($('edit-state'), ''); $('editor-error').hidden = true; if ($('reconcile-card')) $('reconcile-card').hidden = true; }
function setBusy(value) {
  state.busy = value;
  for (const control of document.querySelectorAll('#opinion-form button, #opinion-form input, #opinion-form textarea, #opinion-form select, #new-card, #topic-filter, #status-filter, .opinion-card, .topic-card')) control.disabled = value;
  $('editor').setAttribute('aria-busy', String(value));
}
function showView(view) {
  state.view = view;
  $('cards-view').hidden = view !== 'cards'; $('map-view').hidden = view !== 'map';
  $('view-cards').setAttribute('aria-pressed', String(view === 'cards')); $('view-map').setAttribute('aria-pressed', String(view === 'map'));
  if (view === 'map') renderMap();
}
const calm = () => typeof matchMedia === 'function' && matchMedia('(prefers-reduced-motion: reduce)').matches;
function scrollToNotebook() { $('notebook').scrollIntoView({ behavior: calm() ? 'auto' : 'smooth', block: 'start' }); }
function selectTopic(id) {
  if (state.busy || !canLeave()) return;
  state.topic = id; $('topic-filter').value = id; state.currentId = null; state.creating = false; markClean();
  renderTopics(); renderList(); selectFirst(); showView('cards'); scrollToNotebook();
}
function renderOverview() {
  const confirmed = state.cards.filter(card => card.status === 'confirmed');
  $('confirmed-count').textContent = confirmed.length; $('draft-count').textContent = state.cards.filter(card => card.status === 'draft').length;
  $('topic-count').textContent = new Set(confirmed.map(card => card.topic)).size + ' / ' + state.catalog.topics.length;
  $('cards-count').textContent = state.cards.length;
}
function renderTopics() {
  $('topics').replaceChildren(...state.catalog.topics.map((topic, index) => {
    const el = node('button', undefined, 'topic-card'); el.type = 'button'; el.dataset.topic = topic.id; el.setAttribute('aria-pressed', String(state.topic === topic.id));
    const top = node('div', undefined, 'topic-card-top'); top.append(node('span', String(index + 1).padStart(2, '0'), 'topic-index'), node('span', '↗', 'topic-arrow'));
    const cards = state.cards.filter(card => card.topic === topic.id), confirmed = cards.filter(card => card.status === 'confirmed').length;
    el.append(top, node('h3', topic.label), node('p', topic.question), node('span', tn('opinions.topics.meta', cards.length, { confirmed }), 'topic-meta'));
    el.onclick = () => selectTopic(topic.id); return el;
  }));
}
function filteredCards() { return state.cards.filter(card => (state.topic === 'all' || card.topic === state.topic) && (state.filter === 'all' || card.status === state.filter)); }
function renderList() {
  const cards = filteredCards(); $('filter-summary').textContent = tn('opinions.filter.summary', cards.length);
  $('card-list').replaceChildren(...cards.map(card => {
    const el = node('button', undefined, 'opinion-card'); el.type = 'button'; el.dataset.cardId = card.id; el.setAttribute('aria-pressed', String(card.id === state.currentId));
    const top = node('div', undefined, 'opinion-card-top'); top.append(node('span', topicFor(card.topic)?.label || card.topic, 'card-topic'), node('span', statusLabel(card.status), 'status-pill ' + card.status));
    el.append(top, node('p', card.statement, 'statement-preview'), node('span', originLabel(card.attribution), 'card-origin'));
    el.onclick = () => selectCard(card.id); return el;
  }));
  if (!cards.length) $('card-list').append(node('p', state.cards.length ? tx('opinions.emptyFilter') : tx('opinions.emptyNotebook'), 'empty-list'));
}
function selectFirst() { const card = filteredCards()[0]; if (card) selectCard(card.id, true); else { $('editor').hidden = true; $('editor-empty').hidden = false; } }
function selectCard(id, force = false) {
  if (state.busy || (!force && !canLeave())) return;
  const card = state.cards.find(card => card.id === id); if (!card) return;
  state.currentId = card.id; state.creating = false; markClean(); renderList(); renderEditor(card);
}
function renderPositions(topic, selected = []) {
  $('position-options').replaceChildren(...state.catalog.positions.filter(position => position.topic === topic).map(position => {
    const label = node('label', undefined, 'position-choice'), input = node('input'); input.type = 'checkbox'; input.value = position.id; input.checked = selected.includes(position.id); input.dataset.positionId = position.id;
    const copy = node('span'); copy.append(node('strong', position.label), node('small', position.description));
    const traditions = position.traditionIds.map(id => state.catalog.traditions.find(item => item.id === id)?.label).filter(Boolean);
    if (traditions.length) copy.append(node('small', tx('opinions.form.possibleOverlap', { list: traditions.join(' · ') }), 'tradition-note'));
    input.addEventListener('change', setDirty); label.append(input, copy); return label;
  }));
}
// Everything in the editor that is interface text, not the person's words.
function editorLabels(card) {
  $('editor-topic').textContent = topicFor(card.topic)?.label || card.topic; unkeyed($('editor-status'), statusLabel(card.status)); $('editor-status').className = 'status-pill ' + card.status;
  keyed($('editor-heading'), 'opinions.editor.heading');
  const attribution = card.attribution === 'assistant_proposal' ? tx('opinions.attribution.assistant') : card.attribution === 'user_statement' ? tx('opinions.attribution.user') : tx('opinions.attribution.own');
  unkeyed($('attribution-note'), attribution + (card.status === 'confirmed' ? ' ' + tx('opinions.attribution.confirmed') : ''));
  if (card.source) {
    $('source-role').textContent = card.source.role === 'user' ? tx('opinions.source.user') : card.source.role === 'assistant' ? tx('opinions.source.assistant') : tx('opinions.source.unknown');
    $('source-title').textContent = card.source.conversationTitle || tx('opinions.source.conversation'); $('source-date').textContent = date(card.source.timestamp);
  }
  $('save-draft').textContent = card.status === 'confirmed' ? tx('opinions.action.unconfirm') : tx('opinions.action.draft');
}
function renderEditor(card) {
  state.contextRequest++; state.context = null; $('editor').hidden = false; $('editor-empty').hidden = true;
  $('source-panel').hidden = !card.source;
  $('source-context').hidden = true; $('source-context').replaceChildren(); $('load-context').disabled = false; keyed($('load-context'), 'opinions.source.load');
  if (card.source) { $('source-provider').textContent = card.source.provider || ''; $('source-excerpt').textContent = card.source.excerpt; }
  editorLabels(card);
  $('statement').value = card.statement; $('reason').value = card.reason || ''; $('change-type').value = 'review'; $('change-reason').value = '';
  $('new-topic-field').hidden = true; $('revision-fields').hidden = false; $('review-actions').hidden = false; $('create-actions').hidden = true;
  renderPositions(card.topic, card.positionIds); renderHistory(card); $('history-panel').hidden = false;
}
function renderHistory(card) {
  const items = [...(card.history || [])].reverse(); $('history-count').textContent = items.length; $('card-history').replaceChildren(); $('history-panel').open = false;
  if (!items.length) { $('card-history').append(node('p', tx('opinions.history.first', { date: date(card.createdAt) }), 'small')); return; }
  for (const item of items) {
    const el = node('article', undefined, 'history-item');
    const kind = changeLabel(item.changeType);
    el.append(node('h3', tx('opinions.history.version', { revision: item.revision, status: statusLabel(item.status) })), node('p', item.statement), node('p', item.reason || tx('opinions.history.noReason'), 'small'));
    if (item.positionIds?.length) el.append(node('p', tx('opinions.history.links', { list: item.positionIds.map(id => state.catalog.positions.find(p => p.id === id)?.label || id).join(' · ') }), 'small'));
    el.append(node('p', kind + ' · ' + date(item.changedAt) + (item.changeReason ? '\n' + item.changeReason : ''), 'small')); $('card-history').append(el);
  }
}
function beginNew() {
  if (state.busy || !canLeave()) return;
  state.currentId = null; state.creating = true; state.creationRequestId = crypto.randomUUID(); state.contextRequest++; markClean(); renderList(); showView('cards');
  $('editor').hidden = false; $('editor-empty').hidden = true; keyed($('editor-topic'), 'opinions.editor.newTopic'); keyed($('editor-heading'), 'opinions.editor.newHeading'); keyed($('editor-status'), 'opinions.status.new'); $('editor-status').className = 'status-pill';
  keyed($('attribution-note'), 'opinions.editor.newNote');
  $('source-panel').hidden = true; $('history-panel').hidden = true; $('new-topic-field').hidden = false; $('revision-fields').hidden = true; $('review-actions').hidden = true; $('create-actions').hidden = false;
  $('statement').value = ''; $('reason').value = ''; $('change-reason').value = ''; $('new-topic').value = state.topic === 'all' ? state.catalog.topics[0]?.id || '' : state.topic;
  renderPositions($('new-topic').value); $('statement').focus(); scrollToNotebook();
}
function selectedPositions() { return [...$('position-options').querySelectorAll('input:checked')].map(input => input.value); }
async function save(status) {
  if (state.busy) return;
  $('editor-error').hidden = true;
  const statement = $('statement').value.trim(), reason = $('reason').value.trim();
  if (!statement) { error('opinions.error.empty'); $('statement').focus(); return; }
  const creating = state.creating, card = currentCard();
  let body = { statement, reason, positionIds: selectedPositions() }, op = 'opinion-create';
  if (creating) Object.assign(body, { topic: $('new-topic').value, attribution: 'user_authored', requestId: state.creationRequestId });
  else {
    if (!card) return;
    const changeType = $('change-type').value, changeReason = $('change-reason').value.trim();
    const changed = statement !== card.statement || reason !== (card.reason || '') || JSON.stringify([...body.positionIds].sort()) !== JSON.stringify([...card.positionIds].sort());
    if (changed && changeType === 'review') { error('opinions.error.changeType'); $('change-type').focus(); return; }
    if (changeType !== 'review' && !changeReason) { error('opinions.error.changeReason'); $('change-reason').focus(); return; }
    Object.assign(body, { id: card.id, expectedRevision: card.revision, status, changeType, changeReason }); if (status === 'confirmed') body.confirmedByUser = true; op = 'opinion-review';
  }
  setBusy(true); keyed($('edit-state'), 'opinions.saving');
  try {
    const result = await call(op, body); if (!result.card?.id) throw Error(tx('opinions.error.badReply'));
    const index = state.cards.findIndex(item => item.id === result.card.id); if (index >= 0) state.cards[index] = result.card; else state.cards.push(result.card);
    state.currentId = result.card.id; state.creating = false; if (creating) state.creationRequestId = null; markClean(); renderOverview(); renderTopics(); renderList(); renderEditor(result.card); renderMap();
    const message = result.card.status === 'confirmed' ? 'opinions.saved.confirmed' : result.card.status === 'uncertain' ? 'opinions.saved.uncertain' : result.card.status === 'rejected' ? 'opinions.saved.rejected' : 'opinions.saved.draft';
    keyed($('edit-state'), message); announce(message);
    window.dispatchEvent(new CustomEvent('tore-opinions-updated'));
  } catch (err) {
    unkeyed($('editor-error'), err.message + ' ' + tx('opinions.error.unverified') + ' ' + (creating ? tx('opinions.error.retryCreate') : tx('opinions.error.retryReview'))); $('editor-error').hidden = false;
    keyed($('edit-state'), 'opinions.error.unverifiedShort'); $('reconcile-card').hidden = false;
  }
  finally { setBusy(false); }
}
function cardLink(card, className) {
  const button = node('button', card.statement, className); button.type = 'button'; button.dataset.mapCardId = card.id;
  button.onclick = () => { if (state.busy || !canLeave()) return; state.topic = 'all'; state.filter = 'all'; $('topic-filter').value = 'all'; $('status-filter').value = 'all'; markClean(); showView('cards'); selectCard(card.id, true); renderTopics(); scrollToNotebook(); };
  return button;
}
function renderMap() {
  const confirmed = state.cards.filter(card => card.status === 'confirmed');
  $('map-confirmed-count').textContent = tn('opinions.map.count', confirmed.length); $('map-empty').hidden = confirmed.length > 0;
  $('map-topics').replaceChildren(); $('map-traditions').replaceChildren();
  if (!confirmed.length) return;
  for (const topic of state.catalog.topics) {
    const el = node('article', undefined, 'map-topic'), cards = confirmed.filter(card => card.topic === topic.id); el.append(node('h3', topic.label));
    if (!cards.length) el.append(node('p', tx('opinions.map.topicEmpty')));
    else for (const card of cards) el.append(cardLink(card));
    $('map-topics').append(el);
  }
  let matching = 0;
  for (const tradition of state.catalog.traditions) {
    const supporting = confirmed.map(card => ({ card, positions: state.catalog.positions.filter(position => position.topic === card.topic && card.positionIds.includes(position.id) && position.traditionIds.includes(tradition.id)) })).filter(item => item.positions.length);
    if (!supporting.length) continue;
    matching++; const el = node('article', undefined, 'tradition-card'); el.dataset.traditionId = tradition.id;
    el.append(node('p', tx('opinions.map.closeness'), 'eyebrow'), node('h3', tradition.label), node('p', tradition.description));
    const support = node('div', undefined, 'tradition-support'); support.append(node('strong', tx('opinions.map.why')));
    for (const { card, positions } of supporting) { support.append(cardLink(card), node('p', tx('opinions.map.chosen', { list: positions.map(position => position.label).join(' · ') }), 'small')); }
    el.append(support, node('div', tradition.limits, 'tradition-limits')); $('map-traditions').append(el);
  }
  if (!matching) $('map-traditions').append(node('p', tx('opinions.map.noLinks'), 'small'));
}
async function loadContext() {
  const card = currentCard(); if (!card?.source) return;
  const requestId = ++state.contextRequest; $('load-context').disabled = true; keyed($('load-context'), 'opinions.source.opening');
  try {
    const conversation = await call('conversation', { id: card.source.conversationId });
    if (requestId !== state.contextRequest) return;
    const messages = conversation.messages || [], selected = messages.find(message => message.id === card.source.messageId);
    if (!selected) throw Error(tx('opinions.source.missing'));
    const byId = new Map(messages.map(message => [message.id, message]));
    const context = []; if (selected.parentId && byId.has(selected.parentId)) context.push(byId.get(selected.parentId)); context.push(selected);
    const children = messages.filter(message => message.parentId === selected.id); context.push(...children);
    state.context = { context, selectedId: selected.id }; renderContext();
    $('source-context').hidden = false; keyed($('load-context'), 'opinions.source.reload');
  } catch (err) { if (requestId === state.contextRequest) { state.context = null; $('source-context').replaceChildren(node('p', err.message, 'inline-error')); $('source-context').hidden = false; keyed($('load-context'), 'opinions.source.retry'); } }
  finally { if (requestId === state.contextRequest) $('load-context').disabled = false; }
}
// The loaded context is kept, so a language switch redraws it without asking again.
function renderContext() {
  if (!state.context) return;
  const { context, selectedId } = state.context;
  $('source-context').replaceChildren(node('p', tx('opinions.source.contextNote'), 'small'));
  for (const message of context) {
    const el = node('article', undefined, 'context-message' + (message.id === selectedId ? ' source-selected' : ''));
    const role = message.role === 'user' ? tx('opinions.source.roleUser') : message.role === 'assistant' ? tx('opinions.source.roleAssistant') : tx('opinions.source.roleUnknown');
    el.append(node('strong', role + (message.id === selectedId ? ' · ' + tx('opinions.source.selected') : '')), node('p', message.text)); $('source-context').append(el);
  }
}
// The starting catalogue arrives in Turkish; known entries are shown in the
// interface language by id. Anything unknown stays as the server sent it.
function localCatalog(raw) {
  const copy = JSON.parse(JSON.stringify(raw));
  for (const [list, kind, fields] of [['topics', 'topic', ['label', 'question']], ['positions', 'position', ['label', 'description']], ['traditions', 'tradition', ['label', 'description', 'limits']]]) {
    for (const item of copy[list] || []) for (const field of fields) {
      const k = 'opinions.catalog.' + kind + '.' + item.id + '.' + field;
      if (toreI18n.has(k) && toreI18n.entries()[k][0] === item[field]) item[field] = toreI18n.t(k);
    }
  }
  return copy;
}
async function load() {
  $('load-error').hidden = true; $('reload-data').disabled = true;
  try {
    const data = await call('opinions');
    if (!Array.isArray(data.cards) || !Array.isArray(data.catalog?.topics) || !Array.isArray(data.catalog?.positions) || !Array.isArray(data.catalog?.traditions)) throw Error(tx('opinions.load.invalid'));
    state.cards = data.cards; state.catalogRaw = data.catalog; state.catalog = localCatalog(data.catalog);
    $('topic-filter').replaceChildren(option('all', tx('opinions.allTopics')), ...state.catalog.topics.map(topic => option(topic.id, topic.label))); $('new-topic').replaceChildren(...state.catalog.topics.map(topic => option(topic.id, topic.label)));
    state.topic = 'all'; state.filter = 'all'; $('status-filter').value = 'all'; state.currentId = null; state.creating = false; markClean(); renderOverview(); renderTopics(); renderList(); selectFirst(); renderMap();
    announce(state.cards.length ? 'opinions.load.ready' : 'opinions.load.readyEmpty');
  } catch (err) { $('load-error-text').textContent = err.message; $('load-error').hidden = false; announce('opinions.load.failed'); }
  finally { $('reload-data').disabled = false; }
}
const reconcileButton = node('button', undefined, 'text-button'); keyed(reconcileButton, 'opinions.action.reload'); reconcileButton.id = 'reconcile-card'; reconcileButton.type = 'button'; reconcileButton.hidden = true; reconcileButton.onclick = () => { if (!state.busy && canLeave()) load(); }; $('editor-error').after(reconcileButton);
$('view-cards').onclick = () => showView('cards'); $('view-map').onclick = () => showView('map');
$('new-card').onclick = beginNew;
$('start-review').onclick = $('map-start-review').onclick = () => { showView('cards'); scrollToNotebook(); };
$('topic-filter').onchange = () => { if (!canLeave()) { $('topic-filter').value = state.topic; return; } state.topic = $('topic-filter').value; state.currentId = null; markClean(); renderTopics(); renderList(); selectFirst(); };
$('status-filter').onchange = () => { if (!canLeave()) { $('status-filter').value = state.filter; return; } state.filter = $('status-filter').value; state.currentId = null; markClean(); renderList(); selectFirst(); };
$('new-topic').onchange = () => { renderPositions($('new-topic').value); setDirty(); };
for (const id of ['statement', 'reason', 'change-reason']) $(id).addEventListener('input', setDirty);
$('change-type').addEventListener('change', setDirty);
$('confirm-card').onclick = () => save('confirmed'); $('uncertain-card').onclick = () => save('uncertain'); $('reject-card').onclick = () => save('rejected'); $('save-draft').onclick = () => save('draft');
$('opinion-form').onsubmit = event => { event.preventDefault(); if (state.creating) save('draft'); };
$('load-context').onclick = loadContext; $('reload-data').onclick = () => { if (canLeave()) load(); };
window.addEventListener('beforeunload', event => { if (state.dirty || state.busy) { event.preventDefault(); event.returnValue = ''; } });
// A language switch redraws the interface in place. What the person typed stays
// in the form; a switch waits while a save is under way.
function relabel() {
  redrawKeyed();
  if (state.catalogRaw) {
    state.catalog = localCatalog(state.catalogRaw);
    for (const select of [$('topic-filter'), $('new-topic')]) for (const o of select.options) { const topic = state.catalog.topics.find(x => x.id === o.value); if (topic) o.textContent = topic.label; }
  }
  const all = $('topic-filter').options[0]; if (all && all.value === 'all') all.textContent = tx('opinions.allTopics');
  renderOverview(); renderTopics(); renderList(); renderMap();
  const card = currentCard(), checked = selectedPositions();
  if (state.creating) renderPositions($('new-topic').value, checked);
  else if (card && !$('editor').hidden) { editorLabels(card); renderPositions(card.topic, checked); const open = $('history-panel').open; renderHistory(card); $('history-panel').open = open; renderContext(); }
}
toreI18n.beforeChange(() => !state.busy);
toreI18n.onChange(relabel);
toreI18n.init(call).then(() => { redrawKeyed(); renderMap(); load(); });
