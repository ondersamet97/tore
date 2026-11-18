import { api } from '/private-client.js';
// Güncelle (/guncelle): reports from the person's own Claude Code conversations.
// Every project starts closed; a report is prepared only after an explicit
// click, one conversation at a time, and adds nothing to the notebook. Each
// proposal waits for its own decision. Nothing runs in the background: the
// page only lists file facts and the reports already kept. All text is
// rendered as text, never as HTML.
const call = (op, body = {}) => api('/api/private/tore/' + op, body);
const $ = id => document.getElementById(id);
const node = (tag, value, cls) => { const el = document.createElement(tag); if (value != null) el.textContent = String(value); if (cls) el.className = cls; return el; };
const I18N = globalThis.toreI18n;
const tx = (k, v) => I18N.t(k, v);
const tn = (k, c, v) => I18N.n(k, c, v);
const KINDS = ['opinion', 'decision', 'question', 'task', 'objection'];
const kindName = kind => (KINDS.includes(kind) ? tx('reports.kind.' + kind) : kind);
const short = (s, n = 140) => (String(s).length > n ? String(s).slice(0, n - 1) + '…' : String(s));
const focusOn = el => { if (!el) return; try { el.focus({ preventScroll: false }); } catch { el.focus(); } };
const keyOf = (report, item) => report.id + ':' + item.id;
// Same short label the server gives a project folder (its last path part).
const fallbackLabel = project => String(project || '').replace(/^-+/, '').split('-').pop().slice(0, 40);
function when(iso, withTime = true) {
  if (!iso) return '';
  const d = new Date(iso); if (Number.isNaN(d.getTime())) return String(iso);
  try { return new Intl.DateTimeFormat(I18N.locale(), withTime ? { dateStyle: 'medium', timeStyle: 'short' } : { dateStyle: 'medium' }).format(d); } catch { return String(iso).slice(0, 16).replace('T', ' '); }
}
const size = bytes => (bytes >= 1048576 ? (bytes / 1048576).toFixed(1) + ' MB' : Math.max(1, Math.round(bytes / 1024)) + ' KB');

const state = {
  projects: null, sourcesError: null, reports: [], thoughts: [], waiting: 0, sections: [],
  unchecked: new Set(), busyProjects: new Set(),
  run: { active: false, stop: false, rows: new Map() },
  showDecided: false, later: new Set(), recent: new Set(),
  forms: new Map(), notes: new Map(), busyItems: new Set(), status: 'reports.loading'
};
// Per-item choices survive a redraw (a language switch, a reload after a decision).
const form = key => { if (!state.forms.has(key)) state.forms.set(key, { section: null, beyond: false, beyondReason: '', declining: false, by: '', declineReason: '' }); return state.forms.get(key); };

// ---------- 1 · Projects ----------
function renderProjects() {
  const list = $('project-list'); list.replaceChildren();
  const note = $('projects-note');
  if (state.sourcesError) { note.textContent = state.sourcesError; note.className = 'error'; return; }
  note.className = 'small'; note.textContent = '';
  if (!state.projects) return;
  if (!state.projects.length) { note.textContent = tx('reports.projects.none'); return; }
  for (const p of state.projects) {
    const row = node('div', null, 'project-row'); row.dataset.project = p.project;
    const name = node('div', null, 'project-name');
    name.append(node('strong', p.label || fallbackLabel(p.project)), node('span', p.project, 'project-path'));
    const counts = node('p', [tn('reports.projects.sessions', p.sessionCount), tn('reports.projects.waiting', p.waitingCount), p.modifiedAt ? tx('reports.projects.lastChange', { date: when(p.modifiedAt, false) }) : ''].filter(Boolean).join(' · '), 'small project-counts');
    const toggle = node('button', null, 'project-switch'); toggle.type = 'button'; toggle.setAttribute('role', 'switch');
    toggle.setAttribute('aria-checked', String(Boolean(p.enabled)));
    toggle.setAttribute('aria-label', tx('reports.projects.switchLabel', { name: p.label || fallbackLabel(p.project) }));
    toggle.append(node('span', null, 'switch-track'), node('span', p.enabled ? tx('reports.projects.open') : tx('reports.projects.closed'), 'switch-text'));
    toggle.disabled = state.busyProjects.has(p.project);
    toggle.onclick = () => setProject(p, !p.enabled, toggle);
    row.append(name, counts, toggle);
    list.append(row);
  }
}
async function setProject(p, enabled, button) {
  state.busyProjects.add(p.project); button.disabled = true;
  const note = $('projects-note'); note.className = 'small'; note.textContent = '';
  try {
    await call('report-projects-set', { project: p.project, enabled, confirmedByUser: true });
    await loadSources();
  } catch (e) { note.className = 'error'; note.textContent = e.message; }
  state.busyProjects.delete(p.project);
  renderProjects(); renderSessions();
  focusOn(document.querySelector('.project-row[data-project="' + CSS.escape(p.project) + '"] .project-switch'));
}

// ---------- 2 · New conversations ----------
const candidates = () => {
  if (!state.projects) return [];
  const out = [];
  for (const p of state.projects.filter(x => x.enabled)) for (const s of p.sessions) if (s.status !== 'reported' || state.run.rows.has(s.id)) out.push(s);
  return out;
};
const chosen = () => candidates().filter(s => !state.unchecked.has(s.id) && !(state.run.rows.get(s.id) || {}).done);
function runState(s) {
  const row = state.run.rows.get(s.id); if (!row) return null;
  const box = node('p', null, 'run-state'); box.dataset.state = row.status;
  box.append(node('span', tx('reports.run.state.' + row.status), 'run-state-word'));
  if (row.status === 'preparing') box.append(node('span', ' ' + tx('reports.run.preparingNote'), 'small'));
  if (row.status === 'ready') {
    box.append(' ' + tn('reports.run.readyCount', row.count) + ' ');
    const a = node('a', tx('reports.run.see')); a.href = '#report-' + row.reportId; box.append(a);
  }
  if (row.status === 'error') { const m = node('span', row.message, 'run-error'); m.lang = 'tr'; box.append(' ', m); }
  return box;
}
function renderSessions() {
  const list = $('session-list'); list.replaceChildren();
  const enabled = (state.projects || []).filter(p => p.enabled);
  if (!state.projects) { $('run-area').hidden = true; return; }
  if (!enabled.length) { list.append(node('p', tx('reports.sessions.noneOpen'), 'small')); $('run-area').hidden = true; return; }
  let any = false;
  for (const p of enabled) {
    const sessions = p.sessions.filter(s => s.status !== 'reported' || state.run.rows.has(s.id));
    const reported = p.sessions.filter(s => s.status === 'reported' && !state.run.rows.has(s.id)).length;
    const group = node('div', null, 'session-group');
    group.append(node('h3', p.label || fallbackLabel(p.project)));
    if (!sessions.length) group.append(node('p', tx('reports.sessions.noneNew'), 'small'));
    for (const s of sessions) {
      any = true;
      const row = node('div', null, 'session-row'); row.dataset.session = s.id;
      const finished = Boolean((state.run.rows.get(s.id) || {}).done);
      const box = node('input'); box.type = 'checkbox'; box.checked = !finished && !state.unchecked.has(s.id); box.disabled = state.run.active || finished;
      box.onchange = () => { if (box.checked) state.unchecked.delete(s.id); else state.unchecked.add(s.id); syncRun(); };
      const label = node('label', null, 'check');
      label.append(box, node('span', [when(s.modifiedAt), s.status === 'updated' ? tx('reports.sessions.updated') : s.status === 'new' ? tx('reports.sessions.new') : tx('reports.sessions.reported'), size(s.bytes || 0)].join(' · ')));
      row.append(label);
      const st = runState(s); if (st) row.append(st);
      group.append(row);
    }
    if (reported) group.append(node('p', tn('reports.sessions.alreadyReported', reported), 'small'));
    list.append(group);
  }
  $('run-area').hidden = !any;
  syncRun();
}
function syncRun() {
  const n = chosen().length;
  $('run-start').textContent = tn('reports.run.start', n);
  $('run-start').disabled = state.run.active || n === 0;
  $('run-stop').hidden = !state.run.active;
  $('run-stop').disabled = state.run.stop;
  $('run-stop').textContent = state.run.stop ? tx('reports.run.stopping') : tx('reports.run.stop');
}
// Errors that would repeat for every conversation stop the queue.
const STOPS = /claude auth login|komutu bulunamadı|Claude Code başlatılamadı|Başka bir rapor|giriş durumunu bildirmedi/;
async function runQueue() {
  const queue = chosen().map(s => s.id); if (!queue.length || state.run.active) return;
  state.run.active = true; state.run.stop = false;
  for (const id of queue) state.run.rows.set(id, { status: 'queued' });
  setRunStatus(() => tn('reports.run.started', queue.length));
  renderSessions();
  let done = 0, failed = 0;
  for (let i = 0; i < queue.length; i++) {
    const id = queue[i];
    if (state.run.stop) { for (const rest of queue.slice(i)) state.run.rows.set(rest, { status: 'skipped' }); break; }
    state.run.rows.set(id, { status: 'preparing' }); renderSessions();
    try {
      const out = await call('report-generate', { sessionId: id, confirmedByUser: true });
      state.run.rows.set(id, { status: 'ready', done: true, reportId: out.report.id, count: (out.report.items || []).length });
      done++;
      try { await loadReports(); renderReports(); } catch { /* the report is kept; it shows after a reload */ }
    } catch (e) {
      const message = e.serverMessage || e.message; failed++;
      state.run.rows.set(id, { status: 'error', message });
      if (STOPS.test(message)) { for (const rest of queue.slice(i + 1)) state.run.rows.set(rest, { status: 'skipped' }); break; }
    }
    renderSessions();
  }
  state.run.active = false; state.run.stop = false;
  setRunStatus(() => tx('reports.run.finished', { ready: tn('reports.run.readyN', done), failed: failed ? ' · ' + tn('reports.run.failedN', failed) : '' }));
  try { await loadSources(); } catch { /* the list stays as it was */ }
  renderProjects(); renderSessions(); renderReports();
}
let runText = null;
function setRunStatus(make) { runText = make; $('run-status').textContent = make ? make() : ''; }

// ---------- 3 · Reports ----------
const sectionTitle = id => { const s = state.sections.find(x => x.id === id); return s ? (I18N.lang() === 'en' ? s.titleEn || s.title : s.title) : id; };
const projectLabel = project => { const p = (state.projects || []).find(x => x.project === project); return p ? p.label : fallbackLabel(project); };
const thoughtById = id => state.thoughts.find(t => t.id === id);
function visibleItems(report) {
  const pending = report.items.filter(i => i.decision === 'pending');
  const ordered = [...pending.filter(i => !state.later.has(keyOf(report, i))), ...pending.filter(i => state.later.has(keyOf(report, i)))];
  const decided = report.items.filter(i => i.decision !== 'pending' && (state.showDecided || state.recent.has(keyOf(report, i))));
  return [...ordered, ...decided];
}
function quote(text, cls = 'voice-source report-quote') { const q = node('blockquote', text, cls); return q; }
function itemNote(key) {
  const note = state.notes.get(key); if (!note) return null;
  const p = node('p', note.text(), note.error ? 'error' : 'map-note'); p.setAttribute('role', note.error ? 'alert' : 'status'); return p;
}
function outcome(report, item) {
  const box = node('p', null, 'report-outcome');
  const at = item.decidedAt ? ' · ' + when(item.decidedAt) : '';
  if (item.decision === 'declined') {
    box.append(tx('reports.outcome.declined') + at + ' ');
    const a = node('a', tx('nav.surpassed')); a.href = '/asilmis'; box.append(a);
  } else {
    const text = item.decision === 'hypothesis' ? tx('reports.outcome.hypothesis') : item.kind === 'task' ? tx('reports.outcome.task') : tx('reports.outcome.added');
    box.append(text + at + ' ');
    if (item.kind !== 'task') { const a = node('a', tx('nav.map')); a.href = '/harita'; box.append(a); }
  }
  return box;
}
function actButton(label, act, cls) { const b = node('button', label, cls); b.type = 'button'; b.dataset.act = act; return b; }
function itemNode(report, item) {
  const key = keyOf(report, item), f = form(key), pending = item.decision === 'pending';
  const box = node('article', null, 'report-item'); box.dataset.key = key; box.dataset.kind = item.kind; box.dataset.decision = item.decision;
  if (pending) { box.tabIndex = 0; box.setAttribute('aria-label', kindName(item.kind) + ': ' + short(item.text, 80)); }
  box.append(node('p', kindName(item.kind), 'report-kind'));
  const ai = node('div', null, 'voice-ai report-ai');
  ai.append(node('span', tx('reports.item.aiLabel'), 'voice-ai-label'), node('p', item.text, 'report-text'));
  if (item.reason) ai.append(node('p', tx('reports.item.reason', { reason: item.reason }), 'report-reason'));
  box.append(ai);
  if (!pending) { box.append(outcome(report, item)); const n = itemNote(key); if (n) box.append(n); return box; }
  const source = node('div', null, 'report-source');
  source.append(node('p', item.timestamp ? tx('reports.item.yourWordsAt', { time: when(item.timestamp) }) : tx('reports.item.yourWords'), 'small source-label'), quote(item.excerpt));
  if (item.fromPasted) source.append(node('p', tx('reports.item.fromPasted'), 'small report-pasted'));
  box.append(source);
  const sup = item.supersedes || null;
  if (sup && sup.earlierExcerpt) {
    const earlier = node('div', null, 'report-source report-earlier');
    earlier.append(node('p', tx('reports.item.earlier'), 'small source-label'), quote(sup.earlierExcerpt));
    box.append(earlier);
  }
  if (sup && sup.recordId) {
    const thought = thoughtById(sup.recordId);
    if (thought) {
      const beyond = node('div', null, 'report-beyond');
      beyond.append(node('p', tx('reports.item.beyond'), 'small'), node('p', thought.text, 'voice-own'));
      const tick = node('input'); tick.type = 'checkbox'; tick.checked = f.beyond;
      const label = node('label', null, 'check'); label.append(tick, node('span', tx('reports.item.beyondYes')));
      beyond.append(label);
      const why = node('textarea'); why.rows = 2; why.maxLength = 5000; why.value = f.beyondReason; why.oninput = () => { f.beyondReason = why.value; };
      const whyLabel = node('label', tx('reports.item.beyondWhy'), 'report-field'); whyLabel.append(why); whyLabel.hidden = !f.beyond;
      tick.onchange = () => { f.beyond = tick.checked; whyLabel.hidden = !tick.checked; const pick = box.querySelector('.report-section-pick'), place = box.querySelector('.report-takes-place'); if (pick) pick.hidden = tick.checked; if (place) place.hidden = !tick.checked; };
      beyond.append(whyLabel);
      box.append(beyond);
    } else box.append(node('p', tx('reports.item.beyondGone'), 'small'));
  }
  if (item.kind !== 'task' && state.sections.length) {
    const select = node('select');
    for (const s of state.sections) select.append(new Option(sectionTitle(s.id), s.id));
    select.value = f.section || item.section; select.onchange = () => { f.section = select.value; };
    const label = node('label', tx('reports.item.section'), 'report-field report-section-pick'); label.append(select); box.append(label);
    // A thought that goes beyond another takes that thought's place on the map.
    const beyondChosen = Boolean(sup && sup.recordId && thoughtById(sup.recordId) && f.beyond);
    const place = node('p', tx('reports.item.takesPlace'), 'small report-takes-place'); label.hidden = beyondChosen; place.hidden = !beyondChosen; box.append(place);
  }
  const busy = state.busyItems.has(key);
  const add = actButton(item.kind === 'task' ? tx('reports.act.addTask') : tx('reports.act.add'), 'added', 'primary');
  const buttons = [add];
  if (item.kind !== 'task' && item.kind !== 'question') buttons.push(actButton(tx('reports.act.hypothesis'), 'hypothesis', 'secondary'));
  const no = actButton(tx('reports.act.decline'), 'decline-open', ''); no.setAttribute('aria-expanded', String(f.declining));
  buttons.push(no, actButton(tx('reports.act.later'), 'later', 'quiet'));
  for (const b of buttons) { b.disabled = busy; b.onclick = () => onAct(report, item, b.dataset.act); }
  const row = node('div', null, 'actions report-actions'); row.append(...buttons); box.append(row);
  if (f.declining) {
    const panel = node('div', null, 'report-decline');
    const by = node('select'); by.append(new Option(tx('reports.decline.none'), ''));
    for (const t of state.thoughts) by.append(new Option(kindName(t.kind) + ' · ' + short(t.text, 110), t.id));
    by.value = state.thoughts.some(t => t.id === f.by) ? f.by : '';
    const byLabel = node('label', tx('reports.decline.by'), 'report-field'); byLabel.append(by);
    const why = node('textarea'); why.rows = 2; why.maxLength = 5000; why.value = f.declineReason; why.oninput = () => { f.declineReason = why.value; };
    const whyLabel = node('label', tx('reports.decline.why'), 'report-field'); whyLabel.append(why); whyLabel.hidden = !by.value;
    by.onchange = () => { f.by = by.value; whyLabel.hidden = !by.value; };
    const confirm = actButton(tx('reports.decline.confirm'), 'declined', 'secondary'); confirm.disabled = busy; confirm.onclick = () => onAct(report, item, 'declined');
    const cancel = actButton(tx('reports.decline.cancel'), 'decline-cancel', 'quiet'); cancel.onclick = () => onAct(report, item, 'decline-cancel');
    const actions = node('div', null, 'actions'); actions.append(confirm, cancel);
    panel.append(node('p', tx('reports.decline.intro'), 'small'), byLabel, whyLabel, actions);
    box.append(panel);
  }
  const n = itemNote(key); if (n) box.append(n);
  return box;
}
function reportNode(report) {
  const items = visibleItems(report); if (!items.length && report.items.length) return null;
  const card = node('article', null, 'panel report-card'); card.id = 'report-' + report.id;
  const pending = report.items.filter(i => i.decision === 'pending').length;
  card.append(node('p', [report.provider === 'claude-code' ? 'Claude Code' : report.provider, report.providerVersion].filter(Boolean).join(' · '), 'eyebrow'));
  const h = node('h3', report.title, 'report-title'); card.append(h);
  card.append(node('p', [when(report.generatedAt), projectLabel(report.project), pending ? tn('reports.card.pending', pending) : tx('reports.card.allDecided')].filter(Boolean).join(' · '), 'small'));
  if (report.dropped) card.append(node('p', tn('reports.card.dropped', report.dropped), 'small report-dropped'));
  if (!report.items.length) card.append(node('p', tx('reports.card.empty'), 'small'));
  for (const item of items) card.append(itemNode(report, item));
  return card;
}
function renderReports() {
  const list = $('report-list'); list.replaceChildren();
  $('waiting-count').textContent = state.waiting; $('waiting-count-label').textContent = tn('reports.waitingLabel', state.waiting);
  $('show-decided').checked = state.showDecided;
  const reports = state.reports.slice().sort((a, b) => Number(b.items.some(i => i.decision === 'pending')) - Number(a.items.some(i => i.decision === 'pending')) || String(b.generatedAt).localeCompare(String(a.generatedAt)));
  for (const r of reports) { const card = reportNode(r); if (card) list.append(card); }
  const pending = state.reports.some(r => r.items.some(i => i.decision === 'pending'));
  if (!pending) {
    const p = node('p', state.reports.length ? tx('reports.closing') : tx('reports.noneYet'), 'report-closing'); p.id = 'report-closing'; p.tabIndex = -1;
    if (state.reports.length) list.prepend(p); else list.append(p);
  }
}
function focusAfter(key) {
  const all = [...document.querySelectorAll('.report-item[data-decision="pending"]')];
  const keys = all.map(el => el.dataset.key);
  const at = keys.indexOf(key);
  const next = all.find((el, i) => i > at && el.dataset.key !== key) || all.find(el => el.dataset.key !== key);
  focusOn(next || $('report-closing'));
}
async function onAct(report, item, act) {
  const key = keyOf(report, item), f = form(key);
  if (act === 'decline-open') { f.declining = !f.declining; state.notes.delete(key); renderReports(); focusOn(document.querySelector('.report-item[data-key="' + CSS.escape(key) + '"] ' + (f.declining ? '.report-decline select' : '[data-act="decline-open"]'))); return; }
  if (act === 'decline-cancel') { f.declining = false; renderReports(); focusOn(document.querySelector('.report-item[data-key="' + CSS.escape(key) + '"] [data-act="decline-open"]')); return; }
  const body = { reportId: report.id, itemId: item.id, decision: act, confirmedByUser: true };
  if (act === 'added' || act === 'hypothesis') {
    if (item.kind !== 'task') body.section = f.section || item.section;
    const thought = item.supersedes && item.supersedes.recordId ? thoughtById(item.supersedes.recordId) : null;
    if (thought && f.beyond) { body.supersedes = thought.id; if (f.beyondReason.trim()) body.reason = f.beyondReason.trim(); }
  }
  if (act === 'declined' && f.by && thoughtById(f.by)) { body.supersededBy = f.by; if (f.declineReason.trim()) body.reason = f.declineReason.trim(); }
  state.notes.delete(key); state.busyItems.add(key); renderReports();
  try {
    await call('report-decide', body);
    state.busyItems.delete(key);
    if (act === 'later') { state.later.add(key); renderReports(); focusAfter(key); return; }
    state.recent.add(key); state.forms.delete(key);
    await loadReports(); renderReports(); focusAfter(key);
  } catch (e) {
    state.busyItems.delete(key);
    const raw = e.serverMessage || e.message; state.notes.set(key, { error: true, text: () => I18N.server(raw) });
    renderReports(); focusOn(document.querySelector('.report-item[data-key="' + CSS.escape(key) + '"]'));
  }
}
// 1, 2, 3, 4 on a focused item: add, hypothesis, don't add, later.
$('report-list').addEventListener('keydown', e => {
  const item = e.target; if (!item.classList || !item.classList.contains('report-item') || e.altKey || e.ctrlKey || e.metaKey || e.shiftKey) return;
  const act = { 1: 'added', 2: 'hypothesis', 3: 'decline-open', 4: 'later' }[e.key]; if (!act) return;
  const button = item.querySelector(':scope > .report-actions [data-act="' + act + '"]'); if (!button || button.disabled) return;
  e.preventDefault(); button.click();
});
$('show-decided').onchange = () => { state.showDecided = $('show-decided').checked; renderReports(); };
$('run-start').onclick = () => { runQueue(); };
$('run-stop').onclick = () => { state.run.stop = true; syncRun(); setRunStatus(() => tx('reports.run.stopNote')); };
$('projects-refresh').onclick = async () => {
  if (state.run.active) return;
  const b = $('projects-refresh'); b.disabled = true;
  try { await loadSources(); } catch { /* shown in the projects note */ }
  renderProjects(); renderSessions(); b.disabled = false;
};

// ---------- Loading ----------
async function loadSources() {
  try { const out = await call('report-sources'); state.projects = out.projects || []; state.sourcesError = null; }
  catch (e) { state.sourcesError = e.serverMessage || e.message; }
}
async function loadReports() {
  const out = await call('reports');
  state.reports = out.reports || []; state.thoughts = out.activeThoughts || []; state.waiting = out.waitingCount || 0;
}
async function loadSections() {
  try { const out = await call('map'); state.sections = (out.catalog && out.catalog.sections) || []; } catch { state.sections = []; }
}
function renderAll() { renderProjects(); renderSessions(); renderReports(); }

I18N.onChange(() => {
  const active = document.activeElement && document.activeElement.closest && document.activeElement.closest('.report-item');
  const key = active ? active.dataset.key : null;
  renderAll();
  if (runText) $('run-status').textContent = runText();
  if (state.status) $('page-status').textContent = tx(state.status);
  if (key) focusOn(document.querySelector('.report-item[data-key="' + CSS.escape(key) + '"]'));
});

I18N.init(call).then(() => Promise.all([loadSources(), loadReports(), loadSections()]))
  .then(() => { renderAll(); state.status = 'reports.ready'; $('page-status').textContent = tx('reports.ready'); })
  .catch(e => { state.status = null; $('page-status').textContent = ''; $('page-error').textContent = e.message; $('page-error').hidden = false; renderAll(); });
