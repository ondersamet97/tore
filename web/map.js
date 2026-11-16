import { api, download } from '/private-client.js';
// Reader-facing map of the person's own thinking. It only arranges notebook
// records; it never infers a view. Adopting or rejecting a view and exporting
// need an explicit tick; arranging the map is a single click (the click is the
// consent). All text is rendered as text, never as HTML.
const call = (op, body = {}) => api('/api/private/tore/' + op, body);
const $ = id => document.getElementById(id);
const node = (tag, value, cls) => { const el = document.createElement(tag); if (value != null) el.textContent = String(value); if (cls) el.className = cls; return el; };
const state = { catalog: null, entries: [], records: [], topics: new Map(), lang: 'tr', edit: false, addRecordId: '', exportFile: null };
const PICK_LIMIT = 20;
const KIND = { opinion: 'Görüş', decision: 'Karar', question: 'Soru', task: 'İş' };
const TEXT = {
  tr: {
    title: 'Haritam', eyebrow: 'Nereden başladım, neyi savunuyorum, nerede ayrılıyorum', count: 'kayıt haritada', pending: 'inceleme bekliyor',
    showPending: 'İnceleme bekleyenleri göster', showAdopted: 'Yalnız benimsediklerimi göster', showSuggested: 'Yeri AI önerisi olanları göster', counterpart: 'Karşısındaki görüş', note: 'Not', source: 'Kaynak',
    suggested: 'Haritadaki yeri AI önerisi; henüz onaylamadın.', aiTranslation: 'AI çevirisi; sahibi incelemedi. Özgün metin:', ownTranslation: 'Sahibinin çevirisi. Özgün metin:', untranslated: 'Çevrilmedi. Özgün metin:',
    test: (o, a, t) => `Sınama: ${o} itiraz · ${a} cevaplandı · yanlışlama ölçütü ${t ? 'var' : 'yok'}`,
    empty: 'Haritada henüz kayıt yok.', emptyFiltered: 'Bu süzgeçle gösterilecek kayıt yok.', hypothesis: 'Hipotez / düşünce deneyi', openRecord: 'Konularım\'da aç',
    attribution: { user_statement: 'Senin sözün (birebir)', user_interpretation: 'Senin sözünden (düzenlenmiş)', user_authored: 'Kendi notun', assistant_proposal: 'AI önerisi' },
    review: { pending: 'İnceleme bekliyor', reviewed: 'İncelendi', rejected: 'Reddedildi' },
    adoption: { unknown: 'Benimseme: Belirtilmedi', adopted: 'Benimsedim', hypothesis: 'Hipotez', uncertain: 'Emin değilim', not_adopted: 'Benimsemedim' }, open: 'Açık', closed: 'Kapandı',
  },
  en: {
    title: 'Map of my thinking', eyebrow: 'Where I start, what I hold, where I part ways', count: 'records on the map', pending: 'awaiting review',
    showPending: 'Show records awaiting review', showAdopted: 'Show only what I hold', showSuggested: 'Show AI-suggested placements', counterpart: 'In relation to', note: 'Note', source: 'Source',
    suggested: 'Placement suggested by an AI; not yet confirmed by the author.', aiTranslation: 'AI translation, not reviewed by the author. Original:', ownTranslation: "Author's translation. Original:", untranslated: 'Not translated. Original:',
    test: (o, a, t) => `Tested: ${o} objection${o === 1 ? '' : 's'} · ${a} answered · refutation criterion ${t ? 'stated' : 'not stated'}`,
    empty: 'Nothing on the map yet.', emptyFiltered: 'No records match this filter.', hypothesis: 'Hypothesis / thought experiment', openRecord: 'Open this record in the notebook',
    attribution: { user_statement: 'Own words, verbatim', user_interpretation: 'From own words, edited', user_authored: 'Own note', assistant_proposal: 'AI proposal' },
    review: { pending: 'awaiting review', reviewed: 'reviewed', rejected: 'rejected' },
    adoption: { unknown: 'adoption not stated', adopted: 'adopted', hypothesis: 'hypothesis', uncertain: 'uncertain', not_adopted: 'not adopted' }, open: 'open', closed: 'closed',
  },
};
const t = () => TEXT[state.lang];
const en = () => state.lang === 'en';
const pick = (item, key) => item[en() ? key + 'En' : key];
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

function stateLine(r) {
  const adoption = r.kind === 'question' ? (r.questionState === 'closed' ? t().closed : t().open) : (t().adoption[r.adoption] || r.adoption);
  const stamp = (r.source && r.source.timestamp) || r.updatedAt || '';
  return [t().attribution[r.attribution] || r.attribution, t().review[r.review] || r.review, adoption, stamp.slice(0, 10)].filter(Boolean).join(' · ');
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
  const text = target.entryId && !own && !target.removed ? message + ' Bu süzgeçle artık görünmüyor.' : message;
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
  const body = adoption => ({ id: r.id, expectedRevision: r.revision, expectedTopicId: r.topicId, text: r.text, reason: r.reason, review: 'reviewed', adoption, currency: 'current', priority: r.priority, questionState: r.questionState, changeReason: 'Haritamda inceledim.', confirmedByUser: true });
  if (r.kind === 'question') {
    const keep = node('button', 'İnceledim, bu benim sorum', 'secondary'); keep.type = 'button'; keep.dataset.review = 'question';
    keep.onclick = () => act(keep, 'records-review', body('not_applicable'), 'Soru incelendi.', target);
    wrap.append(consentRow('Bu soruyu kendim inceledim.', keep));
    return wrap;
  }
  const adopt = node('button', 'Bu benim görüşüm', 'secondary'); adopt.type = 'button'; adopt.dataset.review = 'adopted';
  adopt.onclick = () => act(adopt, 'records-review', body('adopted'), 'Kayıt incelendi: Benimsedim.', target);
  const reject = node('button', 'Benim görüşüm değil', 'quiet'); reject.type = 'button'; reject.dataset.review = 'not_adopted';
  reject.onclick = () => act(reject, 'records-review', body('not_adopted'), 'Kayıt incelendi: Benimsemedim.', target);
  wrap.append(consentRow('Bu kaydı kendim okudum ve kararı ben veriyorum.', adopt, reject));
  return wrap;
}

// Writing your own objection, answer or criterion needs no tick: typing it is the decision.
function childForm(item) {
  const form = node('form', null, 'map-form'); form.dataset.childOf = item.entry.id;
  const role = node('select');
  const allowed = item.entry.role === 'objection' ? ['answer'] : ['objection', 'answer', 'test', 'divergence', 'change'];
  for (const id of allowed) role.append(new Option(roleTitle(id), id));
  const roleLabel = node('label', 'Ne ekliyorsun'); roleLabel.append(role);
  const text = node('textarea'); text.rows = 3; text.maxLength = 12000;
  const textLabel = node('label', 'Kendi sözlerinle'); textLabel.append(text);
  const save = node('button', 'Yaz ve bağla', 'secondary'); save.type = 'submit'; save.disabled = true;
  text.oninput = () => { save.disabled = !text.value.trim(); };
  form.onsubmit = async e => {
    e.preventDefault(); if (!text.value.trim()) return;
    clearNotes(); save.disabled = true; let created = null;
    try {
      created = await call('records-create', { requestId: crypto.randomUUID(), topicId: item.record.topicId, kind: 'opinion', text: text.value.trim(), reason: '' });
      const added = await call('map-add', { requestId: crypto.randomUUID(), recordId: created.record.id, section: item.entry.section, role: role.value, parentId: item.entry.id, confirmedByUser: true });
      await load(); announce({ entryId: added.entry.id, parentId: item.entry.id, section: item.entry.section }, 'Yeni kayıt yazıldı ve bağlandı.');
    } catch (err) {
      localError(save, created ? 'Kayıt defterine yazıldı ama haritaya bağlanamadı: ' + err.message + ' Düzenle bölümündeki “Haritaya kayıt ekle” ile yerleştirebilirsin.' : err.message);
      save.disabled = false; focusOn(save);
    }
  };
  form.append(roleLabel, textLabel, actionRow(save)); return form;
}

// Arranging the map (section, heading, note, translation) is a single click.
function placeForm(item) {
  const e = item.entry, form = node('form', null, 'map-form'); form.dataset.place = e.id;
  const section = node('select'); for (const s of state.catalog.sections) section.append(new Option(s.title, s.id)); section.value = e.section;
  const label = node('input'); label.maxLength = 200; label.value = e.label;
  const counterpart = node('input'); counterpart.maxLength = 200; counterpart.value = e.counterpart;
  const note = node('textarea'); note.rows = 2; note.maxLength = 2000; note.value = e.note;
  const translation = node('textarea'); translation.rows = 3; translation.maxLength = 12000; translation.value = e.translationEn ? e.translationEn.text : '';
  const wrap = (title, el) => { const l = node('label', title); l.append(el); return l; };
  const save = node('button', e.placement === 'suggested' ? 'Yeri onayla ve kaydet' : 'Yerleşimi kaydet', 'secondary'); save.type = 'submit';
  form.onsubmit = ev => {
    ev.preventDefault();
    const text = translation.value.trim(), old = e.translationEn;
    const translationEn = !text ? null : (old && old.text === text ? old : { text, by: 'user', label: old ? old.label || '' : '' });
    act(save, 'map-update', { ...fields(e), section: section.value, label: label.value.trim(), counterpart: counterpart.value.trim(), note: note.value.trim(), translationEn }, 'Yerleşim kaydedildi.', { entryId: e.id, parentId: e.parentId, section: section.value });
  };
  form.append(wrap('Bölüm', section), wrap('Kısa başlık', label), wrap('Karşısındaki görüş ya da düşünür', counterpart), wrap('Not', note), wrap('İngilizce çeviri (değiştirirsen senin çevirin sayılır)', translation), actionRow(save));
  return form;
}

function editTools(item) {
  const box = node('details', null, 'map-edit'); box.dataset.tools = item.entry.id;
  box.append(node('summary', 'Bu kayıt için araçlar'));
  box.append(reviewTools(item));
  if (item.record.kind !== 'question' && item.entry.role !== 'answer' && item.entry.role !== 'test') { box.append(node('p', 'Görüşü sına: itiraz, cevap ya da yanlışlama ölçütü yaz', 'map-tool-title')); box.append(childForm(item)); }
  box.append(node('p', 'Yerleşim', 'map-tool-title')); box.append(placeForm(item));
  const remove = node('button', 'Haritadan çıkar', 'quiet'); remove.type = 'button'; remove.dataset.remove = item.entry.id;
  remove.onclick = () => act(remove, 'map-remove', { entryId: item.entry.id, confirmedByUser: true }, 'Kayıt haritadan çıkarıldı; defterinde duruyor.', { entryId: item.entry.id, parentId: item.entry.parentId, section: item.entry.section, removed: true });
  box.append(actionRow(remove, node('span', 'Kayıt silinmez; yalnız haritadaki yeri kalkar.', 'small')));
  return box;
}

function entryNode(item, shown) {
  const e = item.entry, r = item.record, box = node('article', null, 'map-entry');
  box.id = 'entry-' + e.id; box.dataset.role = e.role; box.dataset.entry = e.id; box.dataset.adoption = r.adoption;
  box.append(node('p', roleTitle(e.role), 'map-role'));
  if (r.kind !== 'question' && r.adoption === 'hypothesis') box.append(node('p', t().hypothesis, 'map-hypothesis'));
  const heading = en() && e.translationEn && e.translationEn.label ? e.translationEn.label : e.label;
  if (heading) box.append(node('h3', heading));
  if (en() && e.translationEn) {
    box.append(node('p', e.translationEn.text, 'map-text'));
    box.append(node('p', e.translationEn.by === 'ai' ? t().aiTranslation : t().ownTranslation, 'map-meta'));
    const orig = node('p', r.text, 'map-original'); orig.lang = 'tr'; box.append(orig);
  } else {
    if (en()) box.append(node('p', t().untranslated, 'map-meta'));
    const text = node('p', r.text, 'map-text'); if (en()) text.lang = 'tr'; box.append(text);
  }
  if (e.counterpart) box.append(node('p', t().counterpart + ': ' + e.counterpart, 'map-meta'));
  if (e.note) box.append(node('p', t().note + ': ' + e.note, 'map-meta'));
  box.append(node('p', stateLine(r), 'map-meta'));
  // The conversation title helps while editing; it never goes to paper or to the exported file.
  if (state.edit && r.source && r.source.title) box.append(node('p', t().source + ': ' + r.source.title, 'map-meta map-source'));
  if (e.placement === 'suggested') box.append(node('p', t().suggested, 'map-meta map-suggested'));
  const back = node('p', null, 'map-meta map-record-link'), link = node('a', t().openRecord); link.href = recordHref(r); back.append(link); box.append(back);
  const children = sorted(shown.filter(c => c.entry.parentId === e.id));
  if (['premise', 'position', 'divergence', 'change'].includes(e.role)) {
    const objections = children.filter(c => c.entry.role === 'objection');
    const answered = objections.filter(o => shown.some(a => a.entry.parentId === o.entry.id && a.entry.role === 'answer')).length;
    const tested = children.some(c => c.entry.role === 'test');
    if (objections.length || tested || state.edit) box.append(node('p', t().test(objections.length, answered, tested), 'map-test-line'));
  }
  if (state.edit) box.append(editTools(item));
  for (const c of children) box.append(entryNode(c, shown));
  return box;
}

// Empty page: what this is for, the one thing to do now, and what comes after.
function emptyGuide() {
  const box = node('div', null, 'map-empty');
  if (en()) { box.append(node('p', t().empty)); return box; }
  box.append(node('p', 'Haritam, defterindeki kayıtları bölümlere yerleştirip birbirine bağladığın yerdir.'));
  if (!state.records.some(placeable)) {
    box.append(node('p', 'Defterinde henüz yerleştirilecek kayıt yok. Önce Konularım\'da bir kayıt oluştur.'));
    const go = node('a', 'Konularım\'a git', 'link-button'); go.href = '/konular'; go.id = 'empty-go'; box.append(go);
    box.append(node('p', 'Sonra buraya dönüp kaydı haritaya yerleştirirsin.', 'small'));
    return box;
  }
  box.append(node('p', 'Haritan boş. Şimdi ilk kaydını yerleştir.'));
  const start = node('button', 'İlk kaydı yerleştir'); start.type = 'button'; start.id = 'empty-start';
  start.onclick = () => { state.edit = true; state.lang = 'tr'; rerender(); $('map-tools').scrollIntoView?.({ block: 'start', behavior: calm() ? 'auto' : 'smooth' }); focusOn($('add-search')); };
  box.append(start, node('p', 'Sonra ona itiraz, cevap ya da yanlışlama ölçütü ekleyebilirsin.', 'small'));
  return box;
}

function render() {
  const cat = state.catalog, words = t();
  document.documentElement.lang = state.lang;
  $('map-title').textContent = words.title; $('map-eyebrow').textContent = words.eyebrow; $('map-method').textContent = pick(cat, 'method');
  $('entry-count-label').textContent = words.count; $('pending-count-label').textContent = words.pending;
  $('show-pending-label').textContent = words.showPending; $('show-adopted-label').textContent = words.showAdopted; $('show-suggested-label').textContent = words.showSuggested;
  $('entry-count').textContent = state.entries.length;
  $('pending-count').textContent = state.entries.filter(e => e.record.review === 'pending').length;
  for (const [id, on] of [['lang-tr', !en()], ['lang-en', en()], ['mode-read', !state.edit], ['mode-edit', state.edit]]) $(id).setAttribute('aria-pressed', String(on));
  $('map-tools').hidden = !state.edit;
  const shown = state.entries.filter(visible), ids = new Set(shown.map(e => e.entry.id));
  const body = $('map-body'), contents = $('map-contents'); body.replaceChildren(); contents.replaceChildren();
  for (const s of cat.sections) {
    const top = sorted(shown.filter(e => e.entry.section === s.id && (!e.entry.parentId || !ids.has(e.entry.parentId))));
    if (!top.length) continue;
    const section = node('section', null, 'map-section'); section.id = 'section-' + s.id;
    section.append(node('h2', pick(s, 'title')), node('p', pick(s, 'question'), 'map-question'));
    for (const item of top) section.append(entryNode(item, shown));
    body.append(section);
    const link = node('a', pick(s, 'title') + ' (' + shown.filter(e => e.entry.section === s.id).length + ')'); link.href = '#section-' + s.id; contents.append(link);
  }
  if (!body.children.length) body.append(state.entries.length ? node('p', words.emptyFiltered, 'map-empty') : emptyGuide());
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
  const topic = r => state.topics.get(r.topicId) || 'Konu', query = fold($('add-search').value.trim());
  const matches = all.filter(r => !query || fold(topic(r) + ' ' + r.text).includes(query)), shown = matches.slice(0, PICK_LIMIT);
  const chosen = all.find(r => r.id === state.addRecordId); if (chosen && !shown.includes(chosen)) shown.unshift(chosen);
  $('add-record').replaceChildren(...shown.map(r => {
    const input = node('input'); input.type = 'radio'; input.name = 'add-record'; input.value = r.id; input.checked = r.id === state.addRecordId;
    input.onchange = () => { state.addRecordId = r.id; addSync(); };
    const label = node('label', null, 'record-option'); label.append(input, node('span', [topic(r), KIND[r.kind] || r.kind, short(r.text)].join(' · '))); return label;
  }));
  const count = $('add-search-count');
  if (!all.length && !state.records.some(placeable)) { const go = node('a', 'Konularım\'a git'); go.href = '/konular'; count.replaceChildren('Defterinde henüz yerleştirilecek kayıt yok. Önce bir kayıt oluştur: ', go); }
  else if (!all.length) count.textContent = 'Defterindeki bütün kayıtlar haritada.';
  else if (!matches.length) count.textContent = 'Aramana uyan kayıt yok. Başka bir sözcük dene.';
  else count.textContent = all.length + ' kayıttan ' + matches.length + ' tanesi uyuyor' + (matches.length > PICK_LIMIT ? '; ilk ' + PICK_LIMIT + ' tanesi gösteriliyor. Daraltmak için yaz.' : '.');
  addSync();
}
function renderAddForm() {
  const section = $('add-section'), role = $('add-role'), keep = [section.value, role.value];
  section.replaceChildren(...state.catalog.sections.map(s => new Option(s.title, s.id)));
  role.replaceChildren(...state.catalog.roles.filter(r => r.id !== 'objection').map(r => new Option(r.title, r.id)));
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
  try { const out = await call(op, body); await load(); announce(target, done); return out; }
  catch (e) { button.disabled = false; button.removeAttribute('aria-busy'); localError(button, e.message); focusOn(button); return null; }
}

async function load() {
  const [view, records] = await Promise.all([call('map'), call('records-list')]);
  state.catalog = view.catalog; state.entries = view.entries || [];
  state.records = (records.records || []).filter(r => r.review !== 'rejected');
  state.topics = new Map((records.topics || []).map(x => [x.id, x.title]));
  if (state.exportFile) { invalidateExport(); $('export-result').textContent = 'Harita değişti; önizlemeyi yeniden hazırla.'; }
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
  clearNotes(); $('add-error').hidden = true; $('add-result').replaceChildren(); button.disabled = true;
  try {
    const out = await call('map-add', { requestId: crypto.randomUUID(), recordId: record.id, section: $('add-section').value, role, label: $('add-label').value.trim(), confirmedByUser: true });
    state.addRecordId = ''; $('add-consent').checked = false; $('add-label').value = ''; $('add-search').value = '';
    await load();
    const show = node('a', 'Haritada göster'); show.href = '#entry-' + out.entry.id;
    $('add-result').replaceChildren('Kayıt haritaya eklendi. ', show); focusOn($('add-search'));
  } catch (err) { $('add-error').textContent = err.message; $('add-error').hidden = false; addSync(); focusOn(button); }
};

// Export: the file is prepared and shown here first; it only reaches the disk
// after the person has seen it and says so.
// The file is shown as-is inside a sandboxed frame: no scripts, no same-origin
// access, nothing assigned to this page as markup. The frame only displays it.
function previewFrame(html) {
  const frame = document.createElement('iframe');
  frame.setAttribute('sandbox', ''); frame.setAttribute('referrerpolicy', 'no-referrer');
  frame.title = 'Dosyanın önizlemesi'; frame.className = 'map-preview-frame'; frame.srcdoc = html;
  return frame;
}
function invalidateExport() {
  state.exportFile = null; $('export-preview-panel').hidden = true; $('export-preview-body').replaceChildren();
  $('export-consent').checked = false; $('export-save').disabled = true;
}
for (const id of ['export-language', 'export-pending', 'export-suggested']) $(id).onchange = () => { if (state.exportFile) { invalidateExport(); $('export-result').textContent = 'Seçim değişti; önizlemeyi yeniden hazırla.'; } };
$('export-form').onsubmit = async e => {
  e.preventDefault(); const button = $('export-preview'); button.disabled = true; $('export-error').hidden = true; $('export-result').textContent = ''; invalidateExport();
  try {
    const language = $('export-language').value;
    const out = await call('map-export', { language, includePending: $('export-pending').checked, includeSuggested: $('export-suggested').checked, confirmedByUser: true });
    const parsed = new DOMParser().parseFromString(out.html, 'text/html');
    const sections = [...parsed.querySelectorAll('section > h2')].map(h => h.textContent.trim()).filter(Boolean);
    $('export-summary').textContent = out.entryCount ? out.entryCount + ' kayıt dosyaya girecek' + (sections.length ? ' · ' + sections.length + ' bölüm: ' + sections.join(', ') + '.' : '.') : 'Bu seçimle dosyaya girecek kayıt yok.';
    const found = (out.findings || []).length;
    $('export-findings').textContent = found ? 'Yerel taramada ' + found + ' olası özel bilgi eşleşmesi bulundu. İndirmeden önce aşağıdaki metni oku.' : 'Yerel taramada özel bilgi eşleşmesi bulunmadı. Yine de aşağıdaki metni kendin oku.';
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
  $('export-result').textContent = 'Dosya bu bilgisayara indi: ' + state.exportFile.name + '. Kime vereceğine sen karar verirsin.';
  $('export-consent').checked = false; $('export-save').disabled = true;
};

load().then(() => { $('page-status').textContent = 'Harita hazır.'; })
  .catch(e => { $('page-status').textContent = ''; $('page-error').textContent = e.message; $('page-error').hidden = false; });
