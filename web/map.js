import { api, download } from '/private-client.js';
// Reader-facing map of the person's own thinking. It only arranges notebook
// records; it never infers a view. Every write needs explicit consent and all
// text is rendered as text, never as HTML.
const call = (op, body = {}) => api('/api/private/tore/' + op, body);
const $ = id => document.getElementById(id);
const node = (tag, value, cls) => { const el = document.createElement(tag); if (value != null) el.textContent = String(value); if (cls) el.className = cls; return el; };
const state = { catalog: null, entries: [], records: [], topics: new Map(), lang: 'tr', edit: false };
const TEXT = {
  tr: {
    title: 'Düşünce haritam', eyebrow: 'Nereden başladım, neyi savunuyorum, nerede ayrılıyorum', count: 'kayıt haritada', pending: 'inceleme bekliyor',
    showPending: 'İnceleme bekleyenleri göster', showSuggested: 'Yeri AI önerisi olanları göster', counterpart: 'Karşısındaki görüş', note: 'Not', source: 'Kaynak',
    suggested: 'Haritadaki yeri AI önerisi; henüz onaylamadın.', aiTranslation: 'AI çevirisi; sahibi incelemedi. Özgün metin:', ownTranslation: 'Sahibinin çevirisi. Özgün metin:', untranslated: 'Çevrilmedi. Özgün metin:',
    test: (o, a, t) => `Sınama: ${o} itiraz · ${a} cevaplandı · yanlışlama ölçütü ${t ? 'var' : 'yok'}`,
    empty: 'Haritada henüz kayıt yok. Düzenle kipinde defterindeki bir kaydı yerleştirebilirsin.', emptyFiltered: 'Bu süzgeçle gösterilecek kayıt yok.',
    attribution: { user_statement: 'Kendi sözün, birebir', user_interpretation: 'Kendi sözünden, düzenlenmiş', user_authored: 'Kendi notun', assistant_proposal: 'AI önerisi' },
    review: { pending: 'inceleme bekliyor', reviewed: 'incelendi', rejected: 'reddedildi' },
    adoption: { unknown: 'benimseme belirtilmedi', adopted: 'benimsendi', hypothesis: 'hipotez', uncertain: 'emin değil', not_adopted: 'benimsenmedi' }, open: 'açık', closed: 'kapandı',
  },
  en: {
    title: 'Map of my thinking', eyebrow: 'Where I start, what I hold, where I part ways', count: 'records on the map', pending: 'awaiting review',
    showPending: 'Show records awaiting review', showSuggested: 'Show AI-suggested placements', counterpart: 'In relation to', note: 'Note', source: 'Source',
    suggested: 'Placement suggested by an AI; not yet confirmed by the author.', aiTranslation: 'AI translation, not reviewed by the author. Original:', ownTranslation: "Author's translation. Original:", untranslated: 'Not translated. Original:',
    test: (o, a, t) => `Tested: ${o} objection${o === 1 ? '' : 's'} · ${a} answered · refutation criterion ${t ? 'stated' : 'not stated'}`,
    empty: 'Nothing on the map yet.', emptyFiltered: 'No records match this filter.',
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
const visible = e => e.record.review !== 'rejected' && ($('show-pending').checked || e.record.review === 'reviewed') && ($('show-suggested').checked || e.entry.placement !== 'suggested');
const sorted = list => list.slice().sort((a, b) => roleRank(a.entry.role) - roleRank(b.entry.role) || a.entry.order - b.entry.order || a.entry.createdAt.localeCompare(b.entry.createdAt));
const fields = e => ({ entryId: e.id, section: e.section, role: e.role, parentId: e.parentId || null, counterpart: e.counterpart, label: e.label, note: e.note, order: e.order, translationEn: e.translationEn || null, confirmedByUser: true });

function stateLine(r) {
  const adoption = r.kind === 'question' ? (r.questionState === 'closed' ? t().closed : t().open) : (t().adoption[r.adoption] || r.adoption);
  const stamp = (r.source && r.source.timestamp) || r.updatedAt || '';
  return [t().attribution[r.attribution] || r.attribution, t().review[r.review] || r.review, adoption, stamp.slice(0, 10)].filter(Boolean).join(' · ');
}

function consentRow(text, button) {
  const box = node('input'); box.type = 'checkbox';
  const label = node('label', null, 'check'); label.append(box, node('span', text));
  button.disabled = true; box.onchange = () => { button.disabled = !box.checked; };
  const row = node('div', null, 'actions'); row.append(label, button); return row;
}

function reviewTools(item) {
  const r = item.record, wrap = node('div');
  if (r.review !== 'pending') return wrap;
  const body = adoption => ({ id: r.id, expectedRevision: r.revision, expectedTopicId: r.topicId, text: r.text, reason: r.reason, review: 'reviewed', adoption, currency: 'current', priority: r.priority, questionState: r.questionState, changeReason: 'Düşünce haritasında inceledim.', confirmedByUser: true });
  if (r.kind === 'question') {
    const keep = node('button', 'İnceledim, bu benim sorum', 'secondary'); keep.type = 'button'; keep.dataset.review = 'question';
    keep.onclick = () => act(keep, 'records-review', body('not_applicable'), 'Soru incelendi.');
    wrap.append(consentRow('Bu soruyu kendim inceledim.', keep));
    return wrap;
  }
  const adopt = node('button', 'Bu benim görüşüm', 'secondary'); adopt.type = 'button'; adopt.dataset.review = 'adopted';
  adopt.onclick = () => act(adopt, 'records-review', body('adopted'), 'Kayıt incelendi ve benimsendi.');
  const reject = node('button', 'Benim görüşüm değil', 'quiet'); reject.type = 'button'; reject.dataset.review = 'not_adopted';
  reject.onclick = () => act(reject, 'records-review', body('not_adopted'), 'Kayıt incelendi; benimsenmedi.');
  const box = node('input'); box.type = 'checkbox';
  const label = node('label', null, 'check'); label.append(box, node('span', 'Bu kaydı kendim okudum ve kararı ben veriyorum.'));
  adopt.disabled = reject.disabled = true; box.onchange = () => { adopt.disabled = reject.disabled = !box.checked; };
  const row = node('div', null, 'actions'); row.append(label, adopt, reject); wrap.append(row);
  return wrap;
}

function childForm(item) {
  const form = node('form', null, 'map-form'); form.dataset.childOf = item.entry.id;
  const role = node('select');
  const allowed = item.entry.role === 'objection' ? ['answer'] : ['objection', 'answer', 'test', 'divergence', 'change'];
  for (const id of allowed) role.append(new Option(roleTitle(id), id));
  const roleLabel = node('label', 'Ne ekliyorsun'); roleLabel.append(role);
  const text = node('textarea'); text.rows = 3; text.maxLength = 12000;
  const textLabel = node('label', 'Kendi sözlerinle'); textLabel.append(text);
  const save = node('button', 'Yaz ve bağla', 'secondary'); save.type = 'submit';
  const row = consentRow('Bu metni ben yazdım; defterime yeni kayıt olarak eklensin.', save);
  const box = row.querySelector('input');
  const sync = () => { save.disabled = !(box.checked && text.value.trim()); }; box.onchange = sync; text.oninput = sync;
  form.onsubmit = async e => {
    e.preventDefault(); save.disabled = true; $('page-error').hidden = true;
    try {
      const created = await call('records-create', { requestId: crypto.randomUUID(), topicId: item.record.topicId, kind: 'opinion', text: text.value.trim(), reason: '' });
      await call('map-add', { requestId: crypto.randomUUID(), recordId: created.record.id, section: item.entry.section, role: role.value, parentId: item.entry.id, confirmedByUser: true });
      await load(); $('page-status').textContent = 'Yeni kayıt yazıldı ve bağlandı.';
    } catch (err) { fail(err); save.disabled = false; }
  };
  form.append(roleLabel, textLabel, row); return form;
}

function placeForm(item) {
  const e = item.entry, form = node('form', null, 'map-form'); form.dataset.place = e.id;
  const section = node('select'); for (const s of state.catalog.sections) section.append(new Option(s.title, s.id)); section.value = e.section;
  const label = node('input'); label.maxLength = 200; label.value = e.label;
  const counterpart = node('input'); counterpart.maxLength = 200; counterpart.value = e.counterpart;
  const note = node('textarea'); note.rows = 2; note.maxLength = 2000; note.value = e.note;
  const translation = node('textarea'); translation.rows = 3; translation.maxLength = 12000; translation.value = e.translationEn ? e.translationEn.text : '';
  const wrap = (title, el) => { const l = node('label', title); l.append(el); return l; };
  const save = node('button', e.placement === 'suggested' ? 'Yeri onayla ve kaydet' : 'Kaydet', 'secondary'); save.type = 'submit';
  form.onsubmit = ev => {
    ev.preventDefault();
    const text = translation.value.trim(), old = e.translationEn;
    const translationEn = !text ? null : (old && old.text === text ? old : { text, by: 'user', label: old ? old.label || '' : '' });
    act(save, 'map-update', { ...fields(e), section: section.value, label: label.value.trim(), counterpart: counterpart.value.trim(), note: note.value.trim(), translationEn }, 'Harita girdisi güncellendi.');
  };
  form.append(wrap('Bölüm', section), wrap('Kısa başlık', label), wrap('Karşısındaki görüş ya da düşünür', counterpart), wrap('Not', note), wrap('İngilizce çeviri (değiştirirsen senin çevirin sayılır)', translation),
    consentRow('Bu yerleşimi kendi kararımla kaydediyorum.', save));
  return form;
}

function editTools(item) {
  const box = node('details', null, 'map-edit'); box.dataset.tools = item.entry.id;
  box.append(node('summary', 'Bu kayıt için araçlar'));
  box.append(reviewTools(item));
  if (item.record.kind !== 'question' && item.entry.role !== 'answer' && item.entry.role !== 'test') { box.append(node('h4', 'Görüşü sına: itiraz, cevap ya da yanlışlama ölçütü yaz')); box.append(childForm(item)); }
  box.append(node('h4', 'Yerleşim')); box.append(placeForm(item));
  const remove = node('button', 'Haritadan çıkar', 'quiet'); remove.type = 'button'; remove.dataset.remove = item.entry.id;
  remove.onclick = () => act(remove, 'map-remove', { entryId: item.entry.id, confirmedByUser: true }, 'Kayıt haritadan çıkarıldı; defterde duruyor.');
  box.append(consentRow('Bu kaydı haritadan çıkarmak istiyorum. Kayıt silinmez.', remove));
  return box;
}

function entryNode(item, shown) {
  const e = item.entry, r = item.record, box = node('article', null, 'map-entry');
  box.id = 'entry-' + e.id; box.dataset.role = e.role; box.dataset.entry = e.id;
  box.append(node('p', roleTitle(e.role), 'map-role'));
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
  if (state.edit && r.source && r.source.title) box.append(node('p', t().source + ': ' + r.source.title, 'map-meta'));
  if (e.placement === 'suggested') box.append(node('p', t().suggested, 'map-meta map-suggested'));
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

function render() {
  const cat = state.catalog, words = t();
  document.documentElement.lang = state.lang;
  $('map-title').textContent = words.title; $('map-eyebrow').textContent = words.eyebrow; $('map-method').textContent = pick(cat, 'method');
  $('entry-count-label').textContent = words.count; $('pending-count-label').textContent = words.pending;
  $('show-pending-label').textContent = words.showPending; $('show-suggested-label').textContent = words.showSuggested;
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
  if (!body.children.length) body.append(node('p', state.entries.length ? words.emptyFiltered : words.empty, 'map-empty'));
  if (state.edit) renderAddForm();
}

function renderAddForm() {
  const placed = new Set(state.entries.map(e => e.record.id)), record = $('add-record'), section = $('add-section'), role = $('add-role');
  const keep = [record.value, section.value, role.value];
  record.replaceChildren(new Option('Kayıt seç', ''));
  for (const r of state.records.filter(r => !placed.has(r.id))) record.append(new Option([state.topics.get(r.topicId) || 'Konu', short(r.text)].join(' · '), r.id));
  section.replaceChildren(...state.catalog.sections.map(s => new Option(s.title, s.id)));
  role.replaceChildren(...state.catalog.roles.filter(r => r.id !== 'objection').map(r => new Option(r.title, r.id)));
  if (keep[0]) record.value = keep[0]; if (keep[1]) section.value = keep[1]; if (keep[2]) role.value = keep[2];
}

function fail(e) { $('page-error').textContent = e.message; $('page-error').hidden = false; }
async function act(button, op, body, done) {
  button.disabled = true; $('page-error').hidden = true;
  try { await call(op, body); await load(); $('page-status').textContent = done; }
  catch (e) { fail(e); button.disabled = false; }
}

async function load() {
  const open = new Set([...document.querySelectorAll('#map-body details[open]')].map(d => d.dataset.tools));
  const [view, records] = await Promise.all([call('map'), call('records-list')]);
  state.catalog = view.catalog; state.entries = view.entries || [];
  state.records = (records.records || []).filter(r => r.review !== 'rejected');
  state.topics = new Map((records.topics || []).map(x => [x.id, x.title]));
  render();
  for (const d of document.querySelectorAll('#map-body details')) if (open.has(d.dataset.tools)) d.open = true;
}

$('lang-tr').onclick = () => { state.lang = 'tr'; render(); };
$('lang-en').onclick = () => { state.lang = 'en'; render(); };
$('mode-read').onclick = () => { state.edit = false; render(); };
$('mode-edit').onclick = () => { state.edit = true; state.lang = 'tr'; render(); };
$('show-pending').onchange = render; $('show-suggested').onchange = render;
const addSync = () => { $('add-save').disabled = !($('add-consent').checked && $('add-record').value); };
$('add-consent').onchange = addSync; $('add-record').onchange = addSync;
$('add-form').onsubmit = e => {
  e.preventDefault();
  const record = state.records.find(r => r.id === $('add-record').value);
  const role = record && record.kind === 'question' ? 'open_question' : $('add-role').value;
  act($('add-save'), 'map-add', { requestId: crypto.randomUUID(), recordId: $('add-record').value, section: $('add-section').value, role, label: $('add-label').value.trim(), confirmedByUser: true }, 'Kayıt haritaya eklendi.')
    .then(() => { $('add-consent').checked = false; $('add-label').value = ''; addSync(); });
};
$('export-consent').onchange = () => { $('export-save').disabled = !$('export-consent').checked; };
$('export-form').onsubmit = async e => {
  e.preventDefault(); const button = $('export-save'); button.disabled = true; $('page-error').hidden = true;
  try {
    const language = $('export-language').value;
    const out = await call('map-export', { language, includePending: $('export-pending').checked, includeSuggested: $('export-suggested').checked, confirmedByUser: true });
    download(out.html, language === 'en' ? 'map-of-my-thinking.html' : 'dusunce-haritam.html', 'text/html;charset=utf-8');
    $('export-result').textContent = out.entryCount + ' kayıt dosyaya yazıldı. Yerel taramada ' + out.findings.length + ' olası özel bilgi eşleşmesi bulundu; dosyayı paylaşmadan önce kendin oku.';
  } catch (err) { fail(err); }
  $('export-consent').checked = false;
};

load().then(() => { $('page-status').textContent = 'Harita hazır.'; })
  .catch(e => { $('page-status').textContent = ''; fail(e); });
