import { api, download } from '/private-client.js';
import { DOMAINS, FACETS, ITEMS, PERSONALITY_INSTRUMENT } from '/personality-data.js';
import { RESPONSES, administrationOrder, score, position } from '/personality-scoring.js';
// Kişilik testi (/kisilik): the public-domain IPIP-NEO-120 inventory, answered and scored in
// this tab. Nothing is written to the notebook and nothing is sent anywhere: answers live in
// sessionStorage (gone when the tab closes) and a result leaves the page only as a file the
// person downloads. Scores are raw sums; there are no norms, so nothing here calls a score
// high or low. All text is rendered as text, never as HTML.
const call = (op, body = {}) => api('/api/private/tore/' + op, body);
const $ = id => document.getElementById(id);
const node = (tag, value, cls) => { const el = document.createElement(tag); if (value != null) el.textContent = String(value); if (cls) el.className = cls; return el; };
const button = (text, cls, action) => { const el = node('button', text, cls); el.type = 'button'; el.dataset.action = action; return el; };
const I18N = globalThis.toreI18n;
const tx = (k, v) => I18N.t(k, v);
const tn = (k, c, v) => I18N.n(k, c, v);
// Dimension, facet and response-option names are looked up by id.
const named = (group, id) => I18N.t('personality.' + group + '.' + id);
const STORE = 'tore-personality-v1', PAGE_SIZE = 10;
const BY_ID = new Map(ITEMS.map(item => [item.id, item]));
const ORDER = administrationOrder(ITEMS, DOMAINS);
const PAGE_COUNT = Math.ceil(ORDER.length / PAGE_SIZE);
const DRAFT = { tore: ITEMS.filter(item => item.trSource === 'tore').length };
const state = { view: 'intro', page: 0, answers: {}, stored: true, armed: false, showMissing: false, status: { key: 'personality.loading' } };
const answeredCount = () => Object.keys(state.answers).length;
const turkish = () => I18N.lang() === 'tr';
const statement = item => (turkish() ? item.tr : item.en);
const firstMissing = () => ORDER.findIndex(id => !(id in state.answers));

// Answers stay in this tab only. Anything unreadable or unknown in the saved copy is dropped.
function restore() {
  try {
    const saved = JSON.parse(sessionStorage.getItem(STORE) || 'null');
    if (!saved || saved.v !== 1 || !saved.answers || typeof saved.answers !== 'object') return;
    for (const [id, value] of Object.entries(saved.answers)) if (BY_ID.has(id) && RESPONSES.includes(value)) state.answers[id] = value;
    if (Number.isInteger(saved.page) && saved.page >= 0 && saved.page < PAGE_COUNT) state.page = saved.page;
  } catch { /* a damaged copy is ignored; the person starts again */ }
}
function persist() {
  try { sessionStorage.setItem(STORE, JSON.stringify({ v: 1, answers: state.answers, page: state.page })); state.stored = true; }
  catch { state.stored = false; }
}
function forget() {
  state.answers = {}; state.page = 0;
  try { sessionStorage.removeItem(STORE); } catch { /* nothing was stored */ }
}
function drawStatus() { $('page-status').textContent = state.status ? tx(state.status.key, state.status.vars) : ''; }
function say(key, vars) { state.status = { key, vars }; drawStatus(); }
function focusOn(el) { if (!el) return; try { el.focus({ preventScroll: true }); } catch { el.focus(); } }
function focusHeading() { const heading = $('pq-heading'); focusOn(heading); if (heading && typeof heading.scrollIntoView === 'function') heading.scrollIntoView({ block: 'start' }); }

// Erasing asks once more in place, because it cannot be undone.
function clearControls() {
  const wrap = node('span', null, 'pq-clear');
  const erase = button(tx(state.armed ? 'personality.clearConfirm' : 'personality.clear'), state.armed ? 'pq-danger' : 'quiet', 'clear');
  erase.onclick = () => {
    if (!state.armed) { state.armed = true; render(); focusOn(document.querySelector('[data-action="clear"]')); return; }
    forget(); state.armed = false; state.showMissing = false; state.view = 'intro'; render(); say('personality.cleared'); focusHeading();
  };
  wrap.append(erase);
  if (state.armed) {
    const cancel = button(tx('personality.cancel'), 'quiet', 'clear-cancel');
    cancel.onclick = () => { state.armed = false; render(); focusOn(document.querySelector('[data-action="clear"]')); };
    const ask = node('span', tx('personality.clearAsk'), 'small'); ask.setAttribute('role', 'status');
    wrap.append(cancel, ask);
  }
  return wrap;
}

function intro() {
  const box = node('section', null, 'panel pq-intro'); box.id = 'pq-intro';
  const heading = node('h2', tx('personality.intro.heading')); heading.id = 'pq-heading'; heading.tabIndex = -1;
  const points = node('ul');
  for (const key of ['what', 'how', 'not', 'private']) { const li = node('li'); li.dataset.i18nRich = 'personality.intro.' + key; points.append(li); }
  box.append(heading, points);
  if (turkish()) box.append(node('p', tx('personality.draft', DRAFT), 'notice'));
  const count = answeredCount(), row = node('div', null, 'actions');
  const start = button(count ? tx('personality.resume', { answered: count, total: ORDER.length }) : tx('personality.start'), 'primary', 'start');
  start.onclick = () => { const index = firstMissing(); if (index >= 0) state.page = Math.floor(index / PAGE_SIZE); go('quiz'); };
  row.append(start);
  if (count === ORDER.length) { const see = button(tx('personality.seeResult'), 'secondary', 'result'); see.onclick = () => go('result'); row.append(see); }
  if (count) row.append(clearControls());
  box.append(row, node('p', tx('personality.intro.source'), 'small'));
  I18N.applyI18n(box);
  return box;
}

function answer(id, value, set) {
  state.answers[id] = value; persist();
  const count = answeredCount(), left = ORDER.length - count;
  $('pq-progress-bar').value = count;
  $('pq-progress-text').textContent = tx('personality.quiz.progress', { answered: count, total: ORDER.length });
  const mark = set.querySelector('[data-unanswered]'); if (mark) mark.remove();
  const note = $('pq-missing');
  if (note) { if (left) note.firstChild.textContent = tn('personality.missing', left) + ' '; else note.remove(); }
}
function question(item, number) {
  const set = node('fieldset', null, 'pq-item'); set.dataset.item = item.id;
  const options = node('div', null, 'pq-options');
  for (const value of RESPONSES) {
    const input = node('input'); input.type = 'radio'; input.name = 'q-' + item.id; input.value = String(value); input.checked = state.answers[item.id] === value;
    input.onchange = () => answer(item.id, value, set);
    const option = node('label', null, 'pq-option'); option.append(input, node('span', named('scale', value)));
    options.append(option);
  }
  set.append(node('legend', number + '. ' + statement(item)), options);
  if (state.showMissing && !(item.id in state.answers)) { const mark = node('p', tx('personality.unanswered'), 'pq-unanswered'); mark.dataset.unanswered = item.id; set.append(mark); }
  return set;
}
function turn(page) { state.page = Math.min(PAGE_COUNT - 1, Math.max(0, page)); state.armed = false; persist(); render(); focusHeading(); }
function finish() {
  if (answeredCount() === ORDER.length) { go('result'); return; }
  state.showMissing = true; state.armed = false; render(); focusOn(document.querySelector('[data-action="first-missing"]'));
}
function toFirstMissing() {
  const index = firstMissing(); if (index < 0) return;
  state.page = Math.floor(index / PAGE_SIZE); state.showMissing = true; state.armed = false; persist(); render();
  focusOn(document.querySelector('[data-item="' + ORDER[index] + '"] input'));
}
function quiz() {
  const box = node('section', null, 'panel'); box.id = 'pq-quiz';
  const from = state.page * PAGE_SIZE, ids = ORDER.slice(from, from + PAGE_SIZE), count = answeredCount();
  const heading = node('h2', tx('personality.quiz.heading', { from: from + 1, to: from + ids.length, total: ORDER.length })); heading.id = 'pq-heading'; heading.tabIndex = -1;
  const progress = node('div', null, 'pq-progress');
  const bar = node('progress'); bar.id = 'pq-progress-bar'; bar.max = ORDER.length; bar.value = count; bar.setAttribute('aria-label', tx('personality.quiz.progressLabel'));
  const text = node('span', tx('personality.quiz.progress', { answered: count, total: ORDER.length })); text.id = 'pq-progress-text';
  progress.append(bar, text);
  box.append(heading, progress, node('p', tx('personality.quiz.remind'), 'small'));
  if (!state.stored) box.append(node('p', tx('personality.notStored'), 'small warning'));
  ids.forEach((id, i) => box.append(question(BY_ID.get(id), from + i + 1)));
  const last = state.page === PAGE_COUNT - 1, nav = node('div', null, 'actions pq-nav');
  const back = button(tx(state.page ? 'personality.back' : 'personality.toIntro'), 'secondary', 'back');
  back.onclick = () => { if (state.page) turn(state.page - 1); else go('intro'); };
  const next = button(tx(last ? 'personality.seeResult' : 'personality.next'), 'primary', last ? 'finish' : 'next');
  next.onclick = () => { if (last) finish(); else turn(state.page + 1); };
  nav.append(back, next, clearControls());
  box.append(nav);
  const left = ORDER.length - count;
  if (state.showMissing && left) {
    const note = node('p', tn('personality.missing', left) + ' ', 'notice'); note.id = 'pq-missing'; note.setAttribute('role', 'status');
    const jump = button(tx('personality.firstMissing'), 'secondary', 'first-missing'); jump.onclick = toFirstMissing;
    note.append(jump); box.append(note);
  }
  return box;
}

const scoreText = entry => tx('personality.result.score', { raw: entry.raw, min: entry.min, max: entry.max });
// The bar repeats the score line next to it, so assistive technology skips it.
function scoreBar(entry) {
  const track = node('div', null, 'pq-bar'); track.setAttribute('aria-hidden', 'true');
  const fill = node('span'); fill.style.width = Math.round(position(entry.raw, entry) * 100) + '%';
  track.append(fill); return track;
}
function domainCard(domain, out) {
  const card = node('article', null, 'panel pq-domain'); card.dataset.domain = domain.id;
  const entry = out.domains[domain.id];
  card.append(node('h3', named('domain', domain.id)), node('p', named('about', domain.id), 'small'), node('p', scoreText(entry), 'pq-score'), scoreBar(entry));
  const more = node('details'), list = node('ul', null, 'pq-facets');
  more.append(node('summary', tx('personality.result.facets')));
  for (const id of domain.facets) {
    const li = node('li'), line = node('p', null, 'pq-score'); li.dataset.facet = id;
    line.append(node('span', named('facet', id), 'pq-facet-name'), ' · ' + scoreText(out.facets[id]));
    li.append(line, scoreBar(out.facets[id])); list.append(li);
  }
  more.append(list); card.append(more); return card;
}
const today = () => new Date().toISOString().slice(0, 10);
function resultFile(out, date) {
  const pick = entry => ({ raw: entry.raw, min: entry.min, max: entry.max });
  return {
    format: 'tore-personality-result', version: 1,
    instrument: PERSONALITY_INSTRUMENT.id, source: PERSONALITY_INSTRUMENT.sourceUrl,
    date, statementLanguage: I18N.lang(), turkishDraft: turkish(),
    scoring: 'Raw sums of responses scored 1-5, minus-keyed items reversed. No norms: scores are not compared with other people.',
    domains: Object.fromEntries(DOMAINS.map(domain => [domain.id, pick(out.domains[domain.id])])),
    facets: Object.fromEntries(FACETS.map(facet => [facet.id, pick(out.facets[facet.id])])),
    answers: Object.fromEntries(ORDER.map(id => [id, state.answers[id]]))
  };
}
function markdown(out, date) {
  const cell = text => String(text).replace(/\|/g, '\\|');
  const range = entry => entry.min + '–' + entry.max;
  const lines = ['# ' + tx('personality.file.title'), '', tx('personality.file.date', { date }), '', tx('personality.file.instrument'), '', tx('personality.file.language', { language: tx('personality.file.languageName') }), ''];
  if (turkish()) lines.push(tx('personality.draft', DRAFT), '');
  lines.push(tx('personality.result.raw'), '', '## ' + tx('personality.file.dimensions'), '', '| ' + [tx('personality.file.colDimension'), tx('personality.file.colRaw'), tx('personality.file.colRange')].join(' | ') + ' |', '| --- | --- | --- |');
  for (const domain of DOMAINS) {
    lines.push('| **' + cell(named('domain', domain.id)) + '** | **' + out.domains[domain.id].raw + '** | ' + range(out.domains[domain.id]) + ' |');
    for (const id of domain.facets) lines.push('| ' + cell(named('facet', id)) + ' | ' + out.facets[id].raw + ' | ' + range(out.facets[id]) + ' |');
  }
  lines.push('', '## ' + tx('personality.file.answers'), '', tx('personality.file.scale'), '', '| # | ' + tx('personality.file.colStatement') + ' | ' + tx('personality.file.colAnswer') + ' |', '| --- | --- | --- |');
  ORDER.forEach((id, i) => lines.push('| ' + (i + 1) + ' | ' + cell(statement(BY_ID.get(id))) + ' | ' + state.answers[id] + ' |'));
  return lines.join('\n') + '\n';
}
function save(kind, out) {
  const date = today(), name = tx('personality.file.name', { date }) + (kind === 'md' ? '.md' : '.json');
  if (kind === 'md') download(markdown(out, date), name, 'text/markdown;charset=utf-8');
  else download(JSON.stringify(resultFile(out, date), null, 2) + '\n', name, 'application/json');
  say('personality.result.downloaded', { name });
}
function result() {
  const out = score(ITEMS, FACETS, DOMAINS, state.answers);
  if (!out.complete) { state.view = 'quiz'; state.showMissing = true; return quiz(); }
  const box = node('section', null, 'pq-result'); box.id = 'pq-result';
  const heading = node('h2', tx('personality.result.heading')); heading.id = 'pq-heading'; heading.tabIndex = -1;
  box.append(heading, node('p', tx('personality.result.raw'), 'notice'));
  if (turkish()) box.append(node('p', tx('personality.draft', DRAFT), 'notice'));
  for (const domain of DOMAINS) box.append(domainCard(domain, out));
  const row = node('div', null, 'actions');
  const md = button(tx('personality.result.downloadMd'), 'primary', 'download-md'); md.onclick = () => save('md', out);
  const json = button(tx('personality.result.downloadJson'), 'secondary', 'download-json'); json.onclick = () => save('json', out);
  const back = button(tx('personality.result.backToAnswers'), 'secondary', 'back'); back.onclick = () => go('quiz');
  row.append(md, json, back, clearControls());
  box.append(row, node('p', tx('personality.result.notWritten'), 'small'), node('p', tx('personality.intro.source'), 'small'));
  return box;
}

// A redraw (language switch, armed erase) keeps the opened facet lists open.
function render() {
  const root = $('personality');
  const open = new Set([...root.querySelectorAll('.pq-domain details[open]')].map(el => el.closest('.pq-domain').dataset.domain));
  root.replaceChildren(state.view === 'result' ? result() : state.view === 'quiz' ? quiz() : intro());
  for (const card of root.querySelectorAll('.pq-domain')) if (open.has(card.dataset.domain)) card.querySelector('details').open = true;
}
function go(view) {
  state.view = view; state.armed = false; if (view !== 'quiz') state.showMissing = false;
  render(); focusHeading();
}

I18N.onChange(() => { render(); drawStatus(); });
restore();
I18N.init(call).then(() => { render(); say('personality.ready'); })
  .catch(error => { state.status = null; $('page-status').textContent = ''; $('page-error').textContent = error.message; $('page-error').hidden = false; });
