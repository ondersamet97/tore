import { api } from '/private-client.js';
// Person-made links from notebook records to an example thinker catalog.
// Nothing here scores or infers identity. Linking needs an explicit tick;
// removing a link is a single click, because the record itself stays.
const call = (op, body = {}) => api('/api/private/tore/' + op, body);
const $ = id => document.getElementById(id);
const node = (tag, value, cls) => { const el = document.createElement(tag); if (value != null) el.textContent = String(value); if (cls) el.className = cls; return el; };
// Interface text follows the EN | TR switch (i18n.js). The thinker catalog itself
// comes from the local service in Turkish and is marked as such.
const I18N = globalThis.toreI18n;
const tx = (k, v) => I18N.t(k, v);
const tn = (k, c, v) => I18N.n(k, c, v);
const KIND = { opinion: () => tx('thinkers.kind.opinion'), decision: () => tx('thinkers.kind.decision'), question: () => tx('thinkers.kind.question'), task: () => tx('thinkers.kind.task') };
const ATTRIBUTION = { user_statement: () => tx('thinkers.attr.userStatement'), user_interpretation: () => tx('thinkers.attr.userInterpretation'), user_authored: () => tx('thinkers.attr.userAuthored'), assistant_proposal: () => tx('thinkers.attr.assistantProposal') };
const REVIEW = { pending: () => tx('thinkers.review.pending'), reviewed: () => tx('thinkers.review.reviewed'), rejected: () => tx('thinkers.review.rejected') };
const word = (table, id) => (table[id] ? table[id]() : id);
const catalogText = el => { if (I18N.lang() !== 'tr') el.lang = 'tr'; return el; };
const PICK_LIMIT = 20;
const state = { catalog: null, links: [], records: [], topics: new Map(), status: 'thinkers.loading' };
const short = (s, n = 140) => (s.length > n ? s.slice(0, n - 1) + '…' : s);
const fold = s => String(s).toLocaleLowerCase('tr-TR');
const topicOf = r => state.topics.get(r.topicId) || tx('thinkers.topicFallback');
const recordLabel = r => [topicOf(r), word(KIND, r.kind), word(ATTRIBUTION, r.attribution), short(r.text, 90)].join(' · ');
// Same address Konularım writes when it opens one record from the overview.
const recordHref = r => '/konular?view=overview&topicId=' + encodeURIComponent(r.topicId) + '&recordId=' + encodeURIComponent(r.id);
const focusOn = el => { if (!el) return; try { el.focus({ preventScroll: true }); } catch { el.focus(); } };
const actionRow = (...items) => { const row = node('div', null, 'actions'); row.append(...items); return row; };

function list(title, items) {
  const wrap = node('div'); wrap.append(node('h3', title)); const ul = catalogText(node('ul'));
  for (const item of items) ul.append(node('li', item));
  wrap.append(ul); return wrap;
}

// Each idea comes with its context: when it was put forward and in answer to which events.
// The label follows the interface language; the catalog text stays marked Turkish.
function ideaList(title, items) {
  const wrap = node('div'); wrap.append(node('h3', title)); const ul = node('ul', null, 'idea-list');
  for (const item of items) {
    const idea = typeof item === 'string' ? { text: item, context: '' } : (item || {}), li = node('li');
    li.append(catalogText(node('span', idea.text || '')));
    if (idea.context) { const when = node('p', tx('thinkers.context') + ' ', 'small'); when.append(catalogText(node('span', idea.context))); li.append(when); }
    ul.append(li);
  }
  wrap.append(ul); return wrap;
}

function linkedRecord(entry, thinker) {
  const box = node('article', null, 'record-card'); box.dataset.linkId = entry.link.id;
  const r = entry.record;
  box.append(node('p', [word(KIND, r.kind), word(ATTRIBUTION, r.attribution), word(REVIEW, r.review)].join(' · '), 'eyebrow'));
  box.append(node('p', r.text));
  if (entry.link.note) box.append(node('p', tx('thinkers.yourNote', { note: entry.link.note }), 'small'));
  const open = node('a', tx('thinkers.openRecord'), 'quiet'); if (r.topicId) open.href = recordHref(r); else open.href = '/konular';
  const remove = node('button', tx('thinkers.unlink'), 'quiet'); remove.type = 'button'; remove.dataset.unlink = entry.link.id;
  remove.onclick = () => act(remove, 'thinkers-unlink', { linkId: entry.link.id, confirmedByUser: true }, () => tx('thinkers.unlinked'), thinker.id);
  box.append(actionRow(open, remove)); return box;
}

// Built only when a thinker is opened, so a long notebook is not listed once per thinker.
function linkForm(thinker, linkedIds) {
  const form = node('form', null, 'map-form'); form.dataset.thinker = thinker.id;
  const candidates = state.records.filter(r => !linkedIds.has(r.id));
  if (!candidates.length) {
    const p = node('p', null, 'small');
    if (state.records.length) p.textContent = tx('thinkers.allLinked');
    else { const go = node('a', tx('thinkers.goTopics')); go.href = '/konular'; p.append(tx('thinkers.noRecords') + ' ', go); }
    form.append(p); return form;
  }
  let chosen = '';
  const search = node('input'); search.type = 'search'; search.autocomplete = 'off'; search.spellcheck = false;
  const searchLabel = node('label', tx('thinkers.search')); searchLabel.append(search);
  const count = node('p', null, 'small'); count.setAttribute('role', 'status');
  const options = node('div', null, 'record-options'); options.setAttribute('role', 'radiogroup'); options.setAttribute('aria-label', tx('thinkers.recordFor', { name: thinker.name }));
  const note = node('textarea'); note.rows = 2; note.maxLength = 2000;
  const noteLabel = node('label', tx('thinkers.noteField')); noteLabel.append(note);
  const consent = node('input'); consent.type = 'checkbox';
  const consentLabel = node('label', null, 'check'); consentLabel.append(consent, node('span', tx('thinkers.consent')));
  const save = node('button', tx('thinkers.link'), 'secondary'); save.type = 'submit'; save.disabled = true;
  const sync = () => { save.disabled = !(consent.checked && chosen); };
  const fill = () => {
    const query = fold(search.value.trim()), matches = candidates.filter(r => !query || fold(topicOf(r) + ' ' + r.text).includes(query)), shown = matches.slice(0, PICK_LIMIT);
    const kept = candidates.find(r => r.id === chosen); if (kept && !shown.includes(kept)) shown.unshift(kept);
    options.replaceChildren(...shown.map(r => {
      const input = node('input'); input.type = 'radio'; input.name = 'record-' + thinker.id; input.value = r.id; input.checked = r.id === chosen;
      input.onchange = () => { chosen = r.id; sync(); };
      const label = node('label', null, 'record-option'); label.append(input, node('span', recordLabel(r))); return label;
    }));
    count.textContent = !matches.length ? tx('thinkers.noMatch') : matches.length > PICK_LIMIT ? tn('thinkers.matchesLimited', matches.length, { total: candidates.length, limit: PICK_LIMIT }) : tn('thinkers.matches', matches.length, { total: candidates.length });
  };
  search.oninput = fill; consent.onchange = sync;
  form.onsubmit = e => { e.preventDefault(); if (save.disabled) return; act(save, 'thinkers-link', { requestId: crypto.randomUUID(), thinkerId: thinker.id, recordId: chosen, note: note.value.trim(), confirmedByUser: true }, () => tx('thinkers.linked'), thinker.id); };
  form.append(searchLabel, count, options, noteLabel, consentLabel, actionRow(save)); fill(); return form;
}

function render() {
  const thinkers = state.catalog.thinkers, list_ = $('thinker-list');
  $('thinker-count').textContent = thinkers.length; $('link-count').textContent = state.links.length;
  $('thinker-count-label').textContent = tn('thinkers.catalogCount', thinkers.length); $('link-count-label').textContent = tn('thinkers.linkWord', state.links.length);
  list_.replaceChildren();
  for (const t of thinkers) {
    const mine = state.links.filter(l => l.link.thinkerId === t.id);
    const card = node('details', null, 'panel thinker-card'); card.id = 'thinker-' + t.id;
    const summary = node('summary'); summary.append(node('h2', t.name), node('span', tx('thinkers.lived', { years: t.years }) + ' · ' + tn('thinkers.linkCount', mine.length), 'small'));
    card.append(summary, list(tx('thinkers.works'), t.works), ideaList(tx('thinkers.ideas'), t.ideas), list(tx('thinkers.criticisms'), t.criticisms));
    const limits = node('p', tx('thinkers.limits') + ' ', 'notice'); limits.append(catalogText(node('span', t.limits))); card.append(limits);
    const linked = node('section'); linked.append(node('h3', tx('thinkers.linkedRecords')));
    if (!mine.length) linked.append(node('p', tx('thinkers.noLinks'), 'small'));
    for (const entry of mine) linked.append(linkedRecord(entry, t));
    const adding = node('section'); adding.dataset.linkArea = t.id; adding.append(node('h3', tx('thinkers.linkOne')));
    const build = () => { if (card.open && !adding.querySelector('form')) adding.append(linkForm(t, new Set(mine.map(l => l.record.id)))); };
    card.addEventListener('toggle', build); card.buildLinkForm = build;
    card.append(linked, adding);
    list_.append(card);
  }
}

// Results are reported inside the thinker the person is working on; focus stays there.
function clearNotes() { for (const old of document.querySelectorAll('[data-note]')) old.remove(); }
async function act(button, op, body, done, thinkerId) {
  clearNotes(); button.disabled = true; button.setAttribute('aria-busy', 'true');
  try {
    await call(op, body); await load();
    const card = $('thinker-' + thinkerId); if (!card) return;
    card.open = true; card.buildLinkForm();
    const p = node('p', typeof done === 'function' ? done() : done, 'map-note'); p.setAttribute('role', 'status'); p.dataset.note = 'status';
    card.querySelector('summary').after(p); focusOn(card.querySelector('summary'));
  } catch (e) {
    button.disabled = false; button.removeAttribute('aria-busy');
    const p = node('p', e.message, 'error'); p.setAttribute('role', 'alert'); p.dataset.note = 'error';
    (button.closest('.actions') || button).after(p); focusOn(button);
  }
}

async function load() {
  const open = new Set([...document.querySelectorAll('#thinker-list details[open]')].map(d => d.id)), y = window.scrollY;
  const [view, records] = await Promise.all([call('thinkers'), call('records-list')]);
  state.catalog = view.catalog; state.links = view.links || [];
  state.records = (records.records || []).filter(r => r.review !== 'rejected');
  state.topics = new Map((records.topics || []).map(t => [t.id, t.title]));
  render();
  for (const id of open) { const d = $(id); if (d) { d.open = true; d.buildLinkForm(); } }
  if (window.scrollY !== y) window.scrollTo(0, y);
}

// A language switch redraws the cards in place; open cards stay open (load keeps them).
function redraw() {
  if (!state.catalog) return;
  const open = new Set([...document.querySelectorAll('#thinker-list details[open]')].map(d => d.id)), y = window.scrollY;
  render();
  for (const id of open) { const d = $(id); if (d) { d.open = true; d.buildLinkForm(); } }
  if (window.scrollY !== y) window.scrollTo(0, y);
}
I18N.onChange(() => { redraw(); if (state.status) $('page-status').textContent = tx(state.status); });

I18N.init(call).then(load).then(() => { state.status = 'thinkers.ready'; $('page-status').textContent = tx('thinkers.ready'); })
  .catch(e => { state.status = null; $('page-status').textContent = ''; $('page-error').textContent = e.message; $('page-error').hidden = false; });
