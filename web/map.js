import { api, download } from '/private-client.js';
// Reader-facing map of the person's own thinking. It only arranges notebook
// records; it never infers a view. Adopting or rejecting a view and exporting
// need an explicit tick; arranging the map is a single click (the click is the
// consent). All text is rendered as text, never as HTML.
const call = (op, body = {}) => api('/api/private/tore/' + op, body);
const $ = id => document.getElementById(id);
const node = (tag, value, cls) => { const el = document.createElement(tag); if (value != null) el.textContent = String(value); if (cls) el.className = cls; return el; };
const state = { catalog: null, entries: [], lastDiscussedEntryId: null, records: [], topics: new Map(), lang: 'tr', edit: false, addRecordId: '', exportFile: null, exportInfo: null, status: 'map.loading', said: {} };
const PICK_LIMIT = 20;
// Interface text follows the EN | TR switch in the top bar (i18n.js). The map's
// own content toggle (state.lang) only chooses originals or English translations
// and the language of the map's structure; it never changes the interface.
const I18N = globalThis.toreI18n;
const tx = (k, v) => I18N.t(k, v);
const tn = (k, c, v) => I18N.n(k, c, v);
const KIND = { opinion: () => tx('map.kind.opinion'), decision: () => tx('map.kind.decision'), question: () => tx('map.kind.question'), task: () => tx('map.kind.task') };
const ATTRIBUTION = { user_statement: () => tx('map.attr.userStatement'), user_interpretation: () => tx('map.attr.userInterpretation'), user_authored: () => tx('map.attr.userAuthored'), assistant_proposal: () => tx('map.attr.assistantProposal') };
const REVIEW = { pending: () => tx('map.review.pending'), reviewed: () => tx('map.review.reviewed'), rejected: () => tx('map.review.rejected') };
const ADOPTION = { unknown: () => tx('map.adoption.unknown'), adopted: () => tx('map.adoption.adopted'), hypothesis: () => tx('map.adoption.hypothesis'), uncertain: () => tx('map.adoption.uncertain'), not_adopted: () => tx('map.adoption.notAdopted') };
const word = (table, id) => (table[id] ? table[id]() : id);
const en = () => state.lang === 'en';
// Structure (sections, questions, roles, method): the content language while
// reading; the interface language while editing, where the forms live.
const structLang = () => (state.edit ? I18N.lang() : state.lang);
const pick = (item, key) => item[structLang() === 'en' ? key + 'En' : key] || item[key];
const markLang = el => { if (structLang() !== I18N.lang()) el.lang = structLang(); return el; };
const roleRank = role => state.catalog.roles.findIndex(r => r.id === role);
const roleTitle = role => { const r = state.catalog.roles.find(x => x.id === role); return r ? pick(r, 'title') : role; };
const short = (s, n = 110) => (s.length > n ? s.slice(0, n - 1) + '…' : s);
const fold = s => String(s).toLocaleLowerCase('tr-TR');
const calm = () => typeof matchMedia === 'function' && matchMedia('(prefers-reduced-motion: reduce)').matches;
const focusOn = el => { if (!el) return; try { el.focus({ preventScroll: true }); } catch { el.focus(); } };
const visible = e => e.record.review !== 'rejected' && ($('show-pending').checked || e.record.review === 'reviewed') && ($('show-suggested').checked || e.entry.placement !== 'suggested') && (!$('show-adopted').checked || e.record.adoption === 'adopted');
const sorted = list => list.slice().sort((a, b) => roleRank(a.entry.role) - roleRank(b.entry.role) || a.entry.order - b.entry.order || a.entry.createdAt.localeCompare(b.entry.createdAt));
const fields = e => ({ entryId: e.id, section: e.section, role: e.role, parentId: e.parentId || null, counterpart: e.counterpart, label: e.label, note: e.note, order: e.order, translationEn: e.translationEn || null, confirmedByUser: true });
// Same address Konularım writes when it opens one record from the overview.
const recordHref = r => '/konular?view=overview&topicId=' + encodeURIComponent(r.topicId) + '&recordId=' + encodeURIComponent(r.id);
const placeable = r => r.kind !== 'task';
// Status lines that outlive a redraw are kept as functions, so a language switch rewrites them.
function say(id, text) { state.said[id] = text; $(id).textContent = text ? text() : ''; }

function stateLine(r) {
  const adoption = r.kind === 'question' ? (r.questionState === 'closed' ? tx('map.closed') : tx('map.open')) : word(ADOPTION, r.adoption);
  const stamp = (r.source && r.source.timestamp) || r.updatedAt || '';
  return [word(ATTRIBUTION, r.attribution), word(REVIEW, r.review), adoption, stamp.slice(0, 10)].filter(Boolean).join(' · ');
}

// Results are reported where the person is working, not at the top of the page.
function clearNotes() { for (const old of document.querySelectorAll('[data-note]')) old.remove(); }
function localError(button, message) {
  const p = node('p', message, 'error'); p.setAttribute('role', 'alert'); p.dataset.note = 'error';
  (button.closest('.actions') || button).after(p);
}
function announce(target, message) {
  const own = target.entryId ? $('entry-' + target.entryId) : null;
  const host = own || (target.parentId && $('entry-' + target.parentId)) || (target.section && $('section-' + target.section)) || $('map-body');
  const text = target.entryId && !own && !target.removed ? message + ' ' + tx('map.hiddenByFilter') : message;
  const p = node('p', text, 'map-note'); p.setAttribute('role', 'status'); p.dataset.note = 'status';
  const tools = own ? own.querySelector(':scope > details.map-edit') : null;
  if (tools && tools.open) { tools.querySelector('summary').after(p); focusOn(tools.querySelector('summary')); return; }
  const anchor = host.querySelector(':scope > .map-role, :scope > h2');
  if (anchor) anchor.after(p); else host.prepend(p);
  host.tabIndex = -1; focusOn(host);
}

function consentRow(text, ...buttons) {
  const box = node('input'); box.type = 'checkbox';
  const label = node('label', null, 'check'); label.append(box, node('span', text));
  for (const b of buttons) b.disabled = true;
  box.onchange = () => { for (const b of buttons) b.disabled = !box.checked; };
  const row = node('div', null, 'actions'); row.append(label, ...buttons); return row;
}
function actionRow(...buttons) { const row = node('div', null, 'actions'); row.append(...buttons); return row; }

function reviewTools(item) {
  const r = item.record, wrap = node('div'), target = { entryId: item.entry.id, parentId: item.entry.parentId, section: item.entry.section };
  if (r.review !== 'pending') return wrap;
  const body = adoption => ({ id: r.id, expectedRevision: r.revision, expectedTopicId: r.topicId, text: r.text, reason: r.reason, review: 'reviewed', adoption, currency: 'current', priority: r.priority, questionState: r.questionState, changeReason: tx('map.review.changeReason'), confirmedByUser: true });
  if (r.kind === 'question') {
    const keep = node('button', tx('map.review.keepQuestion'), 'secondary'); keep.type = 'button'; keep.dataset.review = 'question';
    keep.onclick = () => act(keep, 'records-review', body('not_applicable'), () => tx('map.review.questionDone'), target);
    wrap.append(consentRow(tx('map.review.questionConsent'), keep));
    return wrap;
  }
  const adopt = node('button', tx('map.review.adopt'), 'secondary'); adopt.type = 'button'; adopt.dataset.review = 'adopted';
  adopt.onclick = () => act(adopt, 'records-review', body('adopted'), () => tx('map.review.adoptedDone'), target);
  const reject = node('button', tx('map.review.reject'), 'quiet'); reject.type = 'button'; reject.dataset.review = 'not_adopted';
  reject.onclick = () => act(reject, 'records-review', body('not_adopted'), () => tx('map.review.rejectedDone'), target);
  wrap.append(consentRow(tx('map.review.recordConsent'), adopt, reject));
  return wrap;
}

// Writing your own objection, answer or criterion needs no tick: typing it is the decision.
function childForm(item) {
  const form = node('form', null, 'map-form'); form.dataset.childOf = item.entry.id;
  const role = node('select');
  const allowed = item.entry.role === 'objection' ? ['answer'] : ['objection', 'answer', 'test', 'divergence', 'change'];
  for (const id of allowed) role.append(new Option(roleTitle(id), id));
  const roleLabel = node('label', tx('map.child.what')); roleLabel.append(role);
  const text = node('textarea'); text.rows = 3; text.maxLength = 12000;
  const textLabel = node('label', tx('map.child.words')); textLabel.append(text);
  const save = node('button', tx('map.child.save'), 'secondary'); save.type = 'submit'; save.disabled = true;
  text.oninput = () => { save.disabled = !text.value.trim(); };
  form.onsubmit = async e => {
    e.preventDefault(); if (!text.value.trim()) return;
    clearNotes(); save.disabled = true; let created = null;
    try {
      created = await call('records-create', { requestId: crypto.randomUUID(), topicId: item.record.topicId, kind: 'opinion', text: text.value.trim(), reason: '' });
      const added = await call('map-add', { requestId: crypto.randomUUID(), recordId: created.record.id, section: item.entry.section, role: role.value, parentId: item.entry.id, confirmedByUser: true });
      await load(); announce({ entryId: added.entry.id, parentId: item.entry.id, section: item.entry.section }, tx('map.child.done'));
    } catch (err) {
      localError(save, created ? tx('map.child.linkFailed', { error: err.message }) : err.message);
      save.disabled = false; focusOn(save);
    }
  };
  form.append(roleLabel, textLabel, actionRow(save)); return form;
}

// Arranging the map (section, heading, note, translation) is a single click.
function placeForm(item) {
  const e = item.entry, form = node('form', null, 'map-form'); form.dataset.place = e.id;
  const section = node('select'); for (const s of state.catalog.sections) section.append(new Option(pick(s, 'title'), s.id)); section.value = e.section;
  const label = node('input'); label.maxLength = 200; label.value = e.label;
  const counterpart = node('input'); counterpart.maxLength = 200; counterpart.value = e.counterpart;
  const note = node('textarea'); note.rows = 2; note.maxLength = 2000; note.value = e.note;
  const translation = node('textarea'); translation.rows = 3; translation.maxLength = 12000; translation.value = e.translationEn ? e.translationEn.text : '';
  const wrap = (title, el) => { const l = node('label', title); l.append(el); return l; };
  const save = node('button', e.placement === 'suggested' ? tx('map.place.confirm') : tx('map.place.save'), 'secondary'); save.type = 'submit';
  form.onsubmit = ev => {
    ev.preventDefault();
    const text = translation.value.trim(), old = e.translationEn;
    const translationEn = !text ? null : (old && old.text === text ? old : { text, by: 'user', label: old ? old.label || '' : '' });
    act(save, 'map-update', { ...fields(e), section: section.value, label: label.value.trim(), counterpart: counterpart.value.trim(), note: note.value.trim(), translationEn }, () => tx('map.place.done'), { entryId: e.id, parentId: e.parentId, section: section.value });
  };
  form.append(wrap(tx('map.add.section'), section), wrap(tx('map.place.heading'), label), wrap(tx('map.place.counterpart'), counterpart), wrap(tx('map.note'), note), wrap(tx('map.place.translation'), translation), actionRow(save));
  return form;
}

function editTools(item) {
  const box = node('details', null, 'map-edit'); box.dataset.tools = item.entry.id;
  box.append(node('summary', tx('map.tools.summary')));
  box.append(reviewTools(item));
  if (item.record.kind !== 'question' && item.entry.role !== 'answer' && item.entry.role !== 'test') { box.append(node('p', tx('map.tools.test'), 'map-tool-title')); box.append(childForm(item)); }
  box.append(node('p', tx('map.tools.placement'), 'map-tool-title')); box.append(placeForm(item));
  const remove = node('button', tx('map.tools.remove'), 'quiet'); remove.type = 'button'; remove.dataset.remove = item.entry.id;
  remove.onclick = () => act(remove, 'map-remove', { entryId: item.entry.id, confirmedByUser: true }, () => tx('map.tools.removed'), { entryId: item.entry.id, parentId: item.entry.parentId, section: item.entry.section, removed: true });
  box.append(actionRow(remove, node('span', tx('map.tools.removeNote'), 'small')));
  return box;
}

function entryNode(item, shown) {
  const e = item.entry, r = item.record, box = node('article', null, 'map-entry');
  box.id = 'entry-' + e.id; box.dataset.role = e.role; box.dataset.entry = e.id; box.dataset.adoption = r.adoption;
  box.append(markLang(node('p', roleTitle(e.role), 'map-role')));
  if (r.kind !== 'question' && r.adoption === 'hypothesis') box.append(node('p', tx('map.hypothesis'), 'map-hypothesis'));
  const heading = en() && e.translationEn && e.translationEn.label ? e.translationEn.label : e.label;
  if (heading) { const h = node('h3', heading); if (en() && e.translationEn && e.translationEn.label) h.lang = 'en'; box.append(h); }
  if (en() && e.translationEn) {
    const translated = node('p', e.translationEn.text, 'map-text'); translated.lang = 'en'; box.append(translated);
    box.append(node('p', e.translationEn.by === 'ai' ? tx('map.aiTranslation') : tx('map.ownTranslation'), 'map-meta'));
    const orig = node('p', r.text, 'map-original'); orig.lang = 'tr'; box.append(orig);
  } else {
    if (en()) box.append(node('p', tx('map.untranslated'), 'map-meta'));
    const text = node('p', r.text, 'map-text'); if (en()) text.lang = 'tr'; box.append(text);
  }
  if (e.counterpart) box.append(node('p', tx('map.counterpart') + ': ' + e.counterpart, 'map-meta'));
  if (e.note) box.append(node('p', tx('map.note') + ': ' + e.note, 'map-meta'));
  box.append(node('p', stateLine(r), 'map-meta'));
  if (e.id === state.lastDiscussedEntryId) box.append(node('p', tx('map.lastDiscussedMark'), 'map-last'));
  if (item.lastDiscussedAt) box.append(node('p', tx('map.lastDiscussed', { date: day(item.lastDiscussedAt) }), 'map-meta'));
  if (item.predecessors && item.predecessors.length) box.append(lineage(item.predecessors));
  // The conversation title helps while editing; it never goes to paper or to the exported file.
  if (state.edit && r.source && r.source.title) box.append(node('p', tx('map.source') + ': ' + r.source.title, 'map-meta map-source'));
  if (e.placement === 'suggested') box.append(node('p', tx('map.suggested'), 'map-meta map-suggested'));
  const back = node('p', null, 'map-meta map-record-link'), link = node('a', tx('map.openRecord')); link.href = recordHref(r); back.append(link); box.append(back);
  const children = sorted(shown.filter(c => c.entry.parentId === e.id));
  if (['premise', 'position', 'divergence', 'change'].includes(e.role)) {
    const objections = children.filter(c => c.entry.role === 'objection');
    const answered = objections.filter(o => shown.some(a => a.entry.parentId === o.entry.id && a.entry.role === 'answer')).length;
    const tested = children.some(c => c.entry.role === 'test');
    if (objections.length || tested || state.edit) box.append(node('p', tx('map.test.line', { objections: tn('map.test.objections', objections.length), answered, criterion: tested ? tx('map.test.stated') : tx('map.test.notStated') }), 'map-test-line'));
  }
  if (state.edit) box.append(editTools(item));
  for (const c of children) box.append(entryNode(c, shown));
  return box;
}

// Thoughts gone beyond on the way to this one, nearest first; closed until asked for.
const day = iso => { const d = new Date(iso); if (Number.isNaN(d.getTime())) return String(iso).slice(0, 10); try { return new Intl.DateTimeFormat(I18N.locale(), { dateStyle: 'medium' }).format(d); } catch { return String(iso).slice(0, 10); } };
function lineage(list) {
  const box = node('details', null, 'map-lineage');
  box.append(node('summary', tn('map.lineage.summary', list.length)));
  const ol = node('ol', null, 'map-lineage-list');
  for (const p of list) {
    const li = node('li'); li.dataset.depth = String(Math.min(Math.max(Number(p.depth) || 1, 1), 6));
    li.append(node('p', p.text, 'map-lineage-text'));
    const meta = [word(KIND, p.kind), p.supersededAt ? tx('map.lineage.date', { date: day(p.supersededAt) }) : ''].filter(Boolean).join(' · ');
    li.append(node('p', meta, 'map-meta'));
    if (p.supersessionReason) li.append(node('p', tx('map.lineage.reason', { reason: p.supersessionReason }), 'map-meta'));
    ol.append(li);
  }
  box.append(ol); return box;
}

// Empty page: what this is for, the one thing to do now, and what comes after.
function emptyGuide() {
  const box = node('div', null, 'map-empty');
  box.append(node('p', tx('map.empty.intro')));
  if (!state.records.some(placeable)) {
    box.append(node('p', tx('map.empty.noRecords')));
    const go = node('a', tx('map.goTopics'), 'link-button'); go.href = '/konular'; go.id = 'empty-go'; box.append(go);
    box.append(node('p', tx('map.empty.comeBack'), 'small'));
    return box;
  }
  box.append(node('p', tx('map.empty.now')));
  const start = node('button', tx('map.empty.start')); start.type = 'button'; start.id = 'empty-start';
  start.onclick = () => { state.edit = true; state.lang = 'tr'; rerender(); $('map-tools').scrollIntoView?.({ block: 'start', behavior: calm() ? 'auto' : 'smooth' }); focusOn($('add-search')); };
  box.append(start, node('p', tx('map.empty.after'), 'small'));
  return box;
}

function render() {
  const cat = state.catalog, pending = state.entries.filter(e => e.record.review === 'pending').length;
  const method = $('map-method'); method.textContent = pick(cat, 'method'); method.removeAttribute('lang'); markLang(method);
  $('entry-count-label').textContent = tn('map.countLabel', state.entries.length); $('pending-count-label').textContent = tn('map.pendingLabel', pending);
  $('entry-count').textContent = state.entries.length;
  $('pending-count').textContent = pending;
  for (const [id, on] of [['lang-tr', !en()], ['lang-en', en()], ['mode-read', !state.edit], ['mode-edit', state.edit]]) $(id).setAttribute('aria-pressed', String(on));
  $('map-tools').hidden = !state.edit;
  const shown = state.entries.filter(visible), ids = new Set(shown.map(e => e.entry.id));
  const body = $('map-body'), contents = $('map-contents'); body.replaceChildren(); contents.replaceChildren();
  for (const s of cat.sections) {
    const top = sorted(shown.filter(e => e.entry.section === s.id && (!e.entry.parentId || !ids.has(e.entry.parentId))));
    if (!top.length) continue;
    const section = node('section', null, 'map-section'); section.id = 'section-' + s.id;
    section.append(markLang(node('h2', pick(s, 'title'))), markLang(node('p', pick(s, 'question'), 'map-question')));
    for (const item of top) section.append(entryNode(item, shown));
    body.append(section);
    const link = markLang(node('a', pick(s, 'title') + ' (' + shown.filter(e => e.entry.section === s.id).length + ')')); link.href = '#section-' + s.id; contents.append(link);
  }
  if (!body.children.length) body.append(state.entries.length ? node('p', tx('map.emptyFiltered'), 'map-empty') : emptyGuide());
  if (state.edit) renderAddForm();
}
// Redraw without losing the open tool boxes or the reading position.
function rerender() {
  const open = new Set([...document.querySelectorAll('#map-body details[open]')].map(d => d.dataset.tools)), y = window.scrollY;
  render();
  for (const d of document.querySelectorAll('#map-body details')) if (open.has(d.dataset.tools)) d.open = true;
  if (window.scrollY !== y) window.scrollTo(0, y);
}

// Searchable record choice: a text box narrows a short list instead of one long drop-down.
function renderPicker() {
  const placed = new Set(state.entries.map(e => e.record.id)), all = state.records.filter(r => !placed.has(r.id) && placeable(r));
  if (!all.some(r => r.id === state.addRecordId)) state.addRecordId = '';
  const topic = r => state.topics.get(r.topicId) || tx('map.topicFallback'), query = fold($('add-search').value.trim());
  const matches = all.filter(r => !query || fold(topic(r) + ' ' + r.text).includes(query)), shown = matches.slice(0, PICK_LIMIT);
  const chosen = all.find(r => r.id === state.addRecordId); if (chosen && !shown.includes(chosen)) shown.unshift(chosen);
  $('add-record').replaceChildren(...shown.map(r => {
    const input = node('input'); input.type = 'radio'; input.name = 'add-record'; input.value = r.id; input.checked = r.id === state.addRecordId;
    input.onchange = () => { state.addRecordId = r.id; addSync(); };
    const label = node('label', null, 'record-option'); label.append(input, node('span', [topic(r), word(KIND, r.kind), short(r.text)].join(' · '))); return label;
  }));
  const count = $('add-search-count');
  if (!all.length && !state.records.some(placeable)) { const go = node('a', tx('map.goTopics')); go.href = '/konular'; count.replaceChildren(tx('map.picker.noneYet') + ' ', go); }
  else if (!all.length) count.textContent = tx('map.picker.allPlaced');
  else if (!matches.length) count.textContent = tx('map.picker.noMatch');
  else count.textContent = matches.length > PICK_LIMIT ? tn('map.picker.matchesLimited', matches.length, { total: all.length, limit: PICK_LIMIT }) : tn('map.picker.matches', matches.length, { total: all.length });
  addSync();
}
function renderAddForm() {
  const section = $('add-section'), role = $('add-role'), keep = [section.value, role.value];
  section.replaceChildren(...state.catalog.sections.map(s => new Option(pick(s, 'title'), s.id)));
  role.replaceChildren(...state.catalog.roles.filter(r => r.id !== 'objection').map(r => new Option(pick(r, 'title'), r.id)));
  if (keep[0]) section.value = keep[0]; if (keep[1]) role.value = keep[1];
  renderPicker();
}
function addSync() {
  const record = state.records.find(r => r.id === state.addRecordId), question = Boolean(record && record.kind === 'question');
  $('add-save').disabled = !($('add-consent').checked && record);
  $('add-role').disabled = question; $('add-role-hint').hidden = !question;
}

async function act(button, op, body, done, target = {}) {
  clearNotes(); button.disabled = true; button.setAttribute('aria-busy', 'true');
  try { const out = await call(op, body); await load(); announce(target, typeof done === 'function' ? done() : done); return out; }
  catch (e) { button.disabled = false; button.removeAttribute('aria-busy'); localError(button, e.message); focusOn(button); return null; }
}

async function load() {
  const [view, records] = await Promise.all([call('map'), call('records-list')]);
  state.catalog = view.catalog; state.entries = view.entries || []; state.lastDiscussedEntryId = view.lastDiscussedEntryId || null;
  state.records = (records.records || []).filter(r => r.review !== 'rejected');
  state.topics = new Map((records.topics || []).map(x => [x.id, x.title]));
  if (state.exportFile) { invalidateExport(); say('export-result', () => tx('map.export.mapChanged')); }
  rerender();
}

$('lang-tr').onclick = () => { state.lang = 'tr'; rerender(); };
$('lang-en').onclick = () => { state.lang = 'en'; rerender(); };
$('mode-read').onclick = () => { state.edit = false; rerender(); };
$('mode-edit').onclick = () => { state.edit = true; state.lang = 'tr'; rerender(); };
for (const id of ['show-pending', 'show-adopted', 'show-suggested']) $(id).onchange = rerender;
$('add-search').oninput = renderPicker;
$('add-consent').onchange = addSync;
$('add-form').onsubmit = async e => {
  e.preventDefault(); const button = $('add-save'); if (button.disabled) return;
  const record = state.records.find(r => r.id === state.addRecordId);
  const role = record.kind === 'question' ? 'open_question' : $('add-role').value;
  clearNotes(); $('add-error').hidden = true; $('add-result').replaceChildren(); state.said['add-result'] = null; button.disabled = true;
  try {
    const out = await call('map-add', { requestId: crypto.randomUUID(), recordId: record.id, section: $('add-section').value, role, label: $('add-label').value.trim(), confirmedByUser: true });
    state.addRecordId = ''; $('add-consent').checked = false; $('add-label').value = ''; $('add-search').value = '';
    await load();
    const show = node('a', tx('map.add.show')); show.href = '#entry-' + out.entry.id;
    $('add-result').replaceChildren(tx('map.add.done') + ' ', show); focusOn($('add-search'));
  } catch (err) { $('add-error').textContent = err.message; $('add-error').hidden = false; addSync(); focusOn(button); }
};

// Export: the file is prepared and shown here first; it only reaches the disk
// after the person has seen it and says so.
// The file is shown as-is inside a sandboxed frame: no scripts, no same-origin
// access, nothing assigned to this page as markup. The frame only displays it.
function previewFrame(html) {
  const frame = document.createElement('iframe');
  frame.setAttribute('sandbox', ''); frame.setAttribute('referrerpolicy', 'no-referrer');
  frame.title = tx('map.export.frameTitle'); frame.className = 'map-preview-frame'; frame.srcdoc = html;
  return frame;
}
function invalidateExport() {
  state.exportFile = null; state.exportInfo = null; $('export-preview-panel').hidden = true; $('export-preview-body').replaceChildren();
  $('export-consent').checked = false; $('export-save').disabled = true;
}
for (const id of ['export-language', 'export-pending', 'export-suggested']) $(id).onchange = () => { if (state.exportFile) { invalidateExport(); say('export-result', () => tx('map.export.selectionChanged')); } };
$('export-form').onsubmit = async e => {
  e.preventDefault(); const button = $('export-preview'); button.disabled = true; $('export-error').hidden = true; say('export-result', null); invalidateExport();
  try {
    const language = $('export-language').value;
    const out = await call('map-export', { language, includePending: $('export-pending').checked, includeSuggested: $('export-suggested').checked, confirmedByUser: true });
    const parsed = new DOMParser().parseFromString(out.html, 'text/html');
    const sections = [...parsed.querySelectorAll('section > h2')].map(h => h.textContent.trim()).filter(Boolean);
    state.exportInfo = { count: out.entryCount, sections, found: (out.findings || []).length }; exportText();
    $('export-preview-body').replaceChildren(previewFrame(out.html));
    state.exportFile = { html: out.html, name: language === 'en' ? 'map-of-my-thinking.html' : 'dusunce-haritam.html' };
    $('export-preview-panel').hidden = false; focusOn($('export-preview-heading'));
  } catch (err) { $('export-error').textContent = err.message; $('export-error').hidden = false; focusOn(button); }
  button.disabled = false;
};
$('export-consent').onchange = () => { $('export-save').disabled = !($('export-consent').checked && state.exportFile); };
$('export-save').onclick = () => {
  if (!state.exportFile || !$('export-consent').checked) return;
  download(state.exportFile.html, state.exportFile.name, 'text/html;charset=utf-8');
  const name = state.exportFile.name; say('export-result', () => tx('map.export.downloaded', { name }));
  $('export-consent').checked = false; $('export-save').disabled = true;
};

// The export summary is the page's own text; the prepared file keeps its own language.
function exportText() {
  const info = state.exportInfo; if (!info) return;
  $('export-summary').textContent = info.count ? tn('map.export.summary', info.count) + (info.sections.length ? ' · ' + tn('map.export.sections', info.sections.length, { list: info.sections.join(', ') }) + '.' : '.') : tx('map.export.none');
  $('export-findings').textContent = info.found ? tn('map.export.findings', info.found) : tx('map.export.noFindings');
}

// A switch of the interface language redraws in place: open tools, filters,
// edit mode and a prepared export stay. The content follows the new language
// unless the map is being edited, where originals are shown.
I18N.onChange(lang => {
  if (!state.edit) state.lang = lang;
  if (state.catalog) rerender();
  exportText();
  for (const [id, text] of Object.entries(state.said)) if (text) $(id).textContent = text();
  if (state.status) $('page-status').textContent = tx(state.status);
  const preview = document.querySelector('#export-preview-body iframe'); if (preview) preview.title = tx('map.export.frameTitle');
});

I18N.init(call).then(lang => { state.lang = lang; return load(); })
  .then(() => { state.status = 'map.ready'; $('page-status').textContent = tx('map.ready'); })
  .catch(e => { state.status = null; $('page-status').textContent = ''; $('page-error').textContent = e.message; $('page-error').hidden = false; });
