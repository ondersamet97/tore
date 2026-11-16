import { api } from '/private-client.js';
// Person-made links from notebook records to an editorial thinker catalog.
// Nothing here scores or infers identity; every write needs explicit consent.
const call = (op, body = {}) => api('/api/private/tore/' + op, body);
const $ = id => document.getElementById(id);
const node = (tag, value, cls) => { const el = document.createElement(tag); if (value != null) el.textContent = String(value); if (cls) el.className = cls; return el; };
const KIND = { opinion: 'Görüş', decision: 'Karar', question: 'Soru' };
const ATTRIBUTION = { user_statement: 'Senin sözün', user_interpretation: 'Senin yorumun', user_authored: 'Kendi notun', assistant_proposal: 'AI önerisi' };
const REVIEW = { pending: 'İnceleme bekliyor', reviewed: 'İncelendi', rejected: 'Reddedildi' };
const state = { catalog: null, links: [], records: [], topics: new Map() };
const short = (s, n = 140) => (s.length > n ? s.slice(0, n - 1) + '…' : s);
const recordLabel = r => [state.topics.get(r.topicId) || 'Konu', KIND[r.kind] || r.kind, ATTRIBUTION[r.attribution] || r.attribution, short(r.text, 90)].join(' · ');

function list(title, items) {
  const wrap = node('div'); wrap.append(node('h4', title)); const ul = node('ul');
  for (const item of items) ul.append(node('li', item));
  wrap.append(ul); return wrap;
}

function linkedRecord(entry) {
  const box = node('article', null, 'record-card'); box.dataset.linkId = entry.link.id;
  const r = entry.record;
  box.append(node('p', [KIND[r.kind] || r.kind, ATTRIBUTION[r.attribution] || r.attribution, REVIEW[r.review] || r.review].join(' · '), 'eyebrow'));
  box.append(node('p', r.text));
  if (entry.link.note) box.append(node('p', 'Notun: ' + entry.link.note, 'small'));
  const consent = node('input'); consent.type = 'checkbox';
  const label = node('label', null, 'check'); label.append(consent, node('span', 'Bu bağlantıyı kaldırmak istiyorum. Kayıt silinmez.'));
  const remove = node('button', 'Bağlantıyı kaldır', 'quiet'); remove.type = 'button'; remove.disabled = true; remove.dataset.unlink = entry.link.id;
  consent.onchange = () => { remove.disabled = !consent.checked; };
  remove.onclick = () => act(remove, 'thinkers-unlink', { linkId: entry.link.id, confirmedByUser: true }, 'Bağlantı kaldırıldı.');
  box.append(label, remove); return box;
}

function linkForm(thinker, linkedIds) {
  const form = node('form', null, 'panel'); form.dataset.thinker = thinker.id;
  const candidates = state.records.filter(r => !linkedIds.has(r.id));
  form.append(node('h4', 'Bir kaydını bağla'));
  if (!candidates.length) { form.append(node('p', state.records.length ? 'Bütün kayıtların bu düşünüre bağlı.' : 'Henüz kaydın yok. Önce Konularım\'da bir kayıt oluştur.', 'small')); return form; }
  const select = node('select'); select.append(new Option('Kayıt seç', ''));
  for (const r of candidates) select.append(new Option(recordLabel(r), r.id));
  const selectLabel = node('label', 'Kayıt'); selectLabel.append(select);
  const note = node('textarea'); note.rows = 2; note.maxLength = 2000;
  const noteLabel = node('label', 'Notun (isteğe bağlı)'); noteLabel.append(note);
  const consent = node('input'); consent.type = 'checkbox';
  const consentLabel = node('label', null, 'check'); consentLabel.append(consent, node('span', 'Bu kaydı bu düşünüre kendi kararımla bağlıyorum. Bu, düşünürün bütün görüşlerini benimsediğim anlamına gelmez.'));
  const save = node('button', 'Bağla', 'secondary'); save.type = 'submit'; save.disabled = true;
  const sync = () => { save.disabled = !(consent.checked && select.value); };
  consent.onchange = sync; select.onchange = sync;
  form.onsubmit = e => { e.preventDefault(); act(save, 'thinkers-link', { requestId: crypto.randomUUID(), thinkerId: thinker.id, recordId: select.value, note: note.value.trim(), confirmedByUser: true }, 'Bağlantı kaydedildi.'); };
  form.append(selectLabel, noteLabel, consentLabel, save); return form;
}

function render() {
  const thinkers = state.catalog.thinkers, list_ = $('thinker-list');
  $('thinker-count').textContent = thinkers.length; $('link-count').textContent = state.links.length;
  list_.replaceChildren();
  for (const t of thinkers) {
    const mine = state.links.filter(l => l.link.thinkerId === t.id);
    const card = node('details', null, 'panel'); card.id = 'thinker-' + t.id;
    const summary = node('summary'); summary.append(node('strong', t.name), node('span', ' ' + t.years + ' · ' + mine.length + ' bağlantı', 'small'));
    card.append(summary, list('Eserleri', t.works), list('Ana fikirleri', t.ideas), list('Eleştiriler', t.criticisms));
    card.append(node('p', 'Sınır: ' + t.limits, 'notice'));
    const linked = node('section'); linked.append(node('h4', 'Bağladığın kayıtlar'));
    if (!mine.length) linked.append(node('p', 'Henüz bağlantı yok.', 'small'));
    for (const entry of mine) linked.append(linkedRecord(entry));
    card.append(linked, linkForm(t, new Set(mine.map(l => l.record.id))));
    list_.append(card);
  }
}

async function act(button, op, body, done) {
  button.disabled = true; $('page-error').hidden = true;
  try { await call(op, body); await load(); $('page-status').textContent = done; }
  catch (e) { $('page-error').textContent = e.message; $('page-error').hidden = false; button.disabled = false; }
}

async function load() {
  const open = new Set([...document.querySelectorAll('#thinker-list details[open]')].map(d => d.id));
  const [view, records] = await Promise.all([call('thinkers'), call('records-list')]);
  state.catalog = view.catalog; state.links = view.links || [];
  state.records = (records.records || []).filter(r => r.review !== 'rejected');
  state.topics = new Map((records.topics || []).map(t => [t.id, t.title]));
  render();
  for (const id of open) { const d = $(id); if (d) d.open = true; }
}

load().then(() => { $('page-status').textContent = 'Düşünürler hazır.'; })
  .catch(e => { $('page-status').textContent = ''; $('page-error').textContent = e.message; $('page-error').hidden = false; });
