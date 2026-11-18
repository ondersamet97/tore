import { api } from '/private-client.js';
// Aşılmış düşünceler (/asilmis): thoughts the person went beyond, and report
// items they chose not to add. Read only; nothing here changes the notebook.
// All text is rendered as text, never as HTML.
const call = (op, body = {}) => api('/api/private/tore/' + op, body);
const $ = id => document.getElementById(id);
const node = (tag, value, cls) => { const el = document.createElement(tag); if (value != null) el.textContent = String(value); if (cls) el.className = cls; return el; };
const I18N = globalThis.toreI18n;
const tx = (k, v) => I18N.t(k, v);
const tn = (k, c, v) => I18N.n(k, c, v);
const KINDS = ['opinion', 'decision', 'question', 'task'];
const kindName = kind => (KINDS.includes(kind) ? tx('surpassed.kind.' + kind) : kind);
function when(iso, withTime = false) {
  if (!iso) return '';
  const d = new Date(iso); if (Number.isNaN(d.getTime())) return String(iso);
  try { return new Intl.DateTimeFormat(I18N.locale(), withTime ? { dateStyle: 'medium', timeStyle: 'short' } : { dateStyle: 'medium' }).format(d); } catch { return String(iso).slice(0, 10); }
}
const state = { data: null, tab: 'surpassed', status: 'surpassed.loading' };

function row(entry) {
  const r = entry.record, box = node('article', null, 'surpassed-row');
  box.append(node('p', kindName(r.kind), 'report-kind'));
  box.append(node('p', r.text, 'surpassed-text'));
  const date = r.supersededAt || r.updatedAt;
  box.append(node('p', tx(state.tab === 'surpassed' ? 'surpassed.goneOn' : 'surpassed.notAddedOn', { date: when(date) }), 'small surpassed-meta'));
  if (r.supersessionReason) box.append(node('p', tx('surpassed.reason', { reason: r.supersessionReason }), 'small'));
  if (entry.by) {
    const by = node('div', null, 'surpassed-by');
    by.append(node('p', tx('surpassed.by'), 'small source-label'), node('p', entry.by.text, 'voice-own'));
    box.append(by);
  }
  const src = r.source;
  if (src && src.excerpt) {
    const s = node('div', null, 'report-source');
    const where = [src.title, src.timestamp ? when(src.timestamp, true) : ''].filter(Boolean).join(' · ');
    s.append(node('p', where ? tx('surpassed.sourceFrom', { where }) : tx('surpassed.source'), 'small source-label'), node('blockquote', src.excerpt, 'voice-source report-quote'));
    box.append(s);
  }
  return box;
}
function render() {
  const d = state.data; if (!d) return;
  $('surpassed-count').textContent = d.surpassed.length; $('declined-count').textContent = d.declined.length;
  $('surpassed-count-label').textContent = tn('surpassed.countSurpassed', d.surpassed.length);
  $('declined-count-label').textContent = tn('surpassed.countDeclined', d.declined.length);
  for (const [id, tab] of [['tab-surpassed', 'surpassed'], ['tab-declined', 'declined']]) { const on = state.tab === tab; $(id).setAttribute('aria-selected', String(on)); $(id).tabIndex = on ? 0 : -1; }
  $('panel').setAttribute('aria-labelledby', state.tab === 'surpassed' ? 'tab-surpassed' : 'tab-declined');
  $('panel-intro').textContent = tx(state.tab === 'surpassed' ? 'surpassed.intro.surpassed' : 'surpassed.intro.declined');
  const rows = d[state.tab], list = $('surpassed-list');
  list.replaceChildren(...rows.map(row));
  if (!rows.length) list.append(node('p', tx(state.tab === 'surpassed' ? 'surpassed.empty.surpassed' : 'surpassed.empty.declined'), 'report-closing'));
}
function choose(tab) { state.tab = tab; render(); }
$('tab-surpassed').onclick = () => choose('surpassed');
$('tab-declined').onclick = () => choose('declined');
// Arrow keys move between the two tabs.
document.querySelector('.surpassed-tabs').addEventListener('keydown', e => {
  if (e.key !== 'ArrowLeft' && e.key !== 'ArrowRight') return;
  e.preventDefault(); choose(state.tab === 'surpassed' ? 'declined' : 'surpassed'); $(state.tab === 'surpassed' ? 'tab-surpassed' : 'tab-declined').focus();
});
if (/^#?eklenmedi$|^#?declined$/.test(location.hash)) state.tab = 'declined';

I18N.onChange(() => { render(); if (state.status) $('page-status').textContent = tx(state.status); });
I18N.init(call).then(() => call('records-superseded'))
  .then(out => { state.data = { surpassed: out.surpassed || [], declined: out.declined || [] }; render(); state.status = 'surpassed.ready'; $('page-status').textContent = tx('surpassed.ready'); })
  .catch(e => { state.status = null; $('page-status').textContent = ''; $('page-error').textContent = e.message; $('page-error').hidden = false; });
