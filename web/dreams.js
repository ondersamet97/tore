import { api, download } from './private-client.js';
import { suggest, nameCandidates, replaceName, maskPatterns, LABELS, GROUPS } from './dream-rules.js';

const $ = id => document.getElementById(id);
const node = (tag, text, cls) => { const el = document.createElement(tag); if (text !== undefined) el.textContent = text; if (cls) el.className = cls; return el; };
const OP = op => '/api/private/tore/' + op;
let vocabulary = null, consentVersion = '', dreams = [], editing = null, suggested = [], started = null, busy = false;

function status(text, error = false) { $('dream-status').textContent = text; $('dream-status').className = 'status' + (error ? ' error' : ''); }
function today() { const d = new Date(); return new Date(d.getTime() - d.getTimezoneOffset() * 60000).toISOString().slice(0, 10); }
function seconds() { return started ? Math.round((Date.now() - started) / 1000) : null; }
function tick() { const s = seconds() ?? 0; $('dream-timer').textContent = Math.floor(s / 60) + ':' + String(s % 60).padStart(2, '0'); $('dream-timer').classList.toggle('over', s > 180); }
setInterval(() => { if (started && !editing) tick(); }, 1000);

async function task(fn) { if (busy) return; busy = true; for (const b of document.querySelectorAll('button')) b.disabled = true; try { await fn(); } catch (e) { const msg = e.message || 'İşlem tamamlanamadı; başarı bildirilmedi.'; if (!$('dream-review').hidden) { $('dream-error').textContent = msg; $('dream-error').hidden = false; } status(msg, true); } finally { busy = false; for (const b of document.querySelectorAll('button')) b.disabled = false; } }

async function load() {
  const r = await api(OP('dreams-list'), {});
  vocabulary = r.vocabulary; consentVersion = r.consentVersion; dreams = r.dreams;
  render();
}

function renderCodes(selected) {
  const host = $('dream-codes'); host.replaceChildren();
  for (const [group, codes] of Object.entries(vocabulary)) {
    const fs = node('fieldset', undefined, 'code-group'); fs.append(node('legend', GROUPS[group]));
    for (const code of codes) {
      const label = node('label', undefined, 'chip'), box = document.createElement('input');
      box.type = 'checkbox'; box.value = code; box.dataset.group = group; box.checked = selected[group].includes(code);
      label.append(box, node('span', LABELS[code] || code));
      if (suggested.includes(code)) label.append(node('span', 'öneri', 'badge suggested'));
      fs.append(label);
    }
    host.append(fs);
  }
}
function renderNames() {
  const host = $('dream-names'); host.replaceChildren();
  const names = nameCandidates($('dream-anonymized').value);
  if (!names.length) { host.append(node('p', 'Ad olabilecek büyük harfli kelime bulunmadı.', 'small')); return; }
  for (const name of names) {
    const row = node('div', undefined, 'name-row'); row.append(node('strong', name));
    for (const [label, token] of [['→ [KİŞİ]', '[KİŞİ]'], ['→ [YER]', '[YER]'], ['Ad değil', null]]) {
      const b = node('button', label, 'quiet'); b.type = 'button';
      b.onclick = () => { if (token) $('dream-anonymized').value = replaceName($('dream-anonymized').value, name, token); row.remove(); if (token) renderNames(); };
      row.append(b);
    }
    host.append(row);
  }
}
function codes() {
  const out = { characters: [], emotions: [], settings: [], themes: [] };
  for (const box of document.querySelectorAll('#dream-codes input:checked')) out[box.dataset.group].push(box.value);
  return out;
}
function openReview(dream) {
  const text = $('dream-report').value;
  if (!text.trim()) throw Error('Önce rüyanı birkaç cümleyle anlat.');
  const selected = dream ? dream.coding : suggest(text);
  suggested = dream ? dream.coding.suggested : Object.values(selected).flat();
  renderCodes(selected);
  $('dream-anonymized').value = dream ? dream.reportAnonymized : maskPatterns(text);
  renderNames();
  $('dream-confirm').checked = !!dream?.coding.confirmedByUser;
  $('dream-consent').checked = !!dream?.consent.trainingUse;
  $('dream-error').hidden = true;
  $('dream-review').hidden = false;
  $('dream-review').scrollIntoView({ behavior: 'smooth', block: 'start' });
}
function reset() {
  editing = null; started = null; suggested = [];
  $('dream-form').reset(); $('dream-report').readOnly = false; $('dream-night').value = today();
  $('dream-review').hidden = true; $('dream-save').textContent = 'Kaydet'; tick();
}
function edit(dream) {
  reset(); editing = dream;
  $('dream-report').value = dream.report; $('dream-report').readOnly = true;
  $('dream-night').value = dream.night; $('dream-minutes').value = dream.capture.minutesAfterWake ?? '';
  $('dream-wake').value = dream.capture.wakeType; $('dream-clarity').value = String(dream.capture.recallClarity);
  $('dream-mood').value = String(dream.moodOnWake); $('dream-save').textContent = 'Değişiklikleri kaydet';
  $('dream-timer').textContent = dream.capture.entrySeconds != null ? 'ilk kayıt ' + Math.floor(dream.capture.entrySeconds / 60) + ':' + String(dream.capture.entrySeconds % 60).padStart(2, '0') : '';
  openReview(dream);
  $('dream-form').scrollIntoView({ behavior: 'smooth' });
}
async function save() {
  const confirmed = $('dream-confirm').checked, consent = $('dream-consent').checked;
  if (consent && !confirmed) throw Error('Eğitim izni için önce kodlamayı ve anonim metni kontrol ettiğini işaretle.');
  const minutes = $('dream-minutes').value.trim();
  const dream = {
    id: editing?.id ?? '', createdAt: '', updatedAt: '', night: $('dream-night').value,
    report: $('dream-report').value, reportAnonymized: $('dream-anonymized').value,
    capture: { minutesAfterWake: minutes === '' ? null : Number(minutes), wakeType: $('dream-wake').value, recallClarity: Number($('dream-clarity').value), entrySeconds: editing ? editing.capture.entrySeconds : seconds() },
    coding: { ...codes(), suggested, confirmedByUser: confirmed },
    moodOnWake: Number($('dream-mood').value),
    consent: { trainingUse: consent, grantedAt: editing?.consent.grantedAt ?? null, version: consentVersion },
  };
  const r = await api(OP('dreams-save'), { dream });
  const took = r.dream.capture.entrySeconds;
  reset(); await load();
  status('Rüya kaydedildi' + (took != null && !dream.id ? ` (${Math.floor(took / 60)} dk ${took % 60} sn)` : '') + '.');
}
function card(d) {
  const el = node('article', undefined, 'record-card dream-card');
  const meta = node('div', undefined, 'record-meta');
  meta.append(node('span', new Date(d.night + 'T00:00').toLocaleDateString('tr-TR', { day: 'numeric', month: 'long', year: 'numeric' }), 'badge'));
  meta.append(node('span', d.coding.confirmedByUser ? 'Kodlama onaylı' : 'Kodlama onay bekliyor', 'badge' + (d.coding.confirmedByUser ? '' : ' warning')));
  meta.append(node('span', d.consent.trainingUse ? 'Veri setine izinli' : 'Yalnız benim', 'badge' + (d.consent.trainingUse ? ' consent' : '')));
  el.append(meta, node('p', 'Senin sözün', 'eyebrow small-gap'), node('h3', d.report));
  const labels = [...d.coding.characters, ...d.coding.emotions, ...d.coding.settings, ...d.coding.themes].map(c => LABELS[c] || c);
  if (labels.length) el.append(node('p', labels.join(' · '), 'small'));
  const foot = node('div', undefined, 'record-foot');
  foot.append(node('p', d.capture.entrySeconds != null ? `Kayıt süresi ${Math.floor(d.capture.entrySeconds / 60)} dk ${d.capture.entrySeconds % 60} sn` : '', 'small'));
  const actions = node('div', undefined, 'actions');
  const e = node('button', 'Kodlamayı / izni düzenle'); e.type = 'button'; e.onclick = () => edit(d);
  const del = node('button', 'Sil', 'quiet'); del.type = 'button';
  del.onclick = () => task(async () => { if (!confirm('Bu rüya kalıcı olarak silinsin mi? Bu işlem geri alınamaz.')) return; await api(OP('dreams-delete'), { id: d.id }); if (editing?.id === d.id) reset(); await load(); status('Rüya silindi.'); });
  actions.append(e, del); foot.append(actions); el.append(foot);
  return el;
}
function render() {
  $('dream-count').textContent = dreams.length;
  $('dataset-count').textContent = dreams.filter(d => d.consent.trainingUse && d.coding.confirmedByUser).length + ' tanesi veri setine izinli';
  const host = $('dream-list'); host.replaceChildren();
  if (!dreams.length) host.append(node('p', 'Henüz rüya yok. İlk rüyanı yukarıdan ekleyebilirsin.', 'empty-state'));
  for (const d of dreams) host.append(card(d));
}

$('dream-report').addEventListener('input', () => { if (!started && !editing) { started = Date.now(); tick(); } });
$('dream-suggest').onclick = () => task(async () => openReview(editing));
$('dream-anonymized').addEventListener('change', renderNames);
$('dream-reset').onclick = reset;
$('dream-form').addEventListener('submit', ev => { ev.preventDefault(); task(save); });
$('dream-export').onclick = () => task(async () => {
  const p = await api(OP('dreams-export'), {});
  const m = p.manifest, skipped = Object.entries(m.skipped || {});
  const reasons = { no_consent: 'izin yok', coding_not_confirmed: 'kodlama onaysız', personal_data_pattern_found: 'kişisel kalıp kaldı' };
  $('export-result').textContent = `${m.recordCount} rüya pakete girdi.` + (skipped.length ? ' Atlananlar: ' + skipped.map(([k, n]) => `${n} (${reasons[k] || k})`).join(', ') + '.' : '');
  if (!m.recordCount) return;
  const stamp = today();
  download(p.datasetJsonl, `tore-ruya-dataset-${stamp}.jsonl`, 'application/jsonl');
  download(JSON.stringify({ ...m, readme: p.readme }, null, 2) + '\n', `tore-ruya-manifest-${stamp}.json`, 'application/json');
});

reset();
task(async () => { await load(); status(dreams.length ? 'Rüya defteri hazır.' : 'Rüya defteri hazır. İlk rüyanı ekleyebilirsin.'); });
