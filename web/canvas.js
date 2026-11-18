import { api } from '/private-client.js';
// The opening thought map: the person's map drawn as one branching tree, from
// "My map" through the catalog sections to positions and what grew from them.
// It only reads (`map`, `thinkers`); it never writes and never infers a view.
// Everything the person wrote is rendered as text, never as HTML. Surpassed
// thoughts are not nodes; they appear only, folded, under the thought that went
// beyond them. No streaks, badges, counters that ask for attention or timers.
const call = (op, body = {}) => api('/api/private/tore/' + op, body);
const I18N = globalThis.toreI18n;
const tx = (k, v) => I18N.t(k, v);
const tn = (k, c, v) => I18N.n(k, c, v);
const $ = id => document.getElementById(id);
const node = (tag, value, cls) => { const el = document.createElement(tag); if (value != null) el.textContent = String(value); if (cls) el.className = cls; return el; };
const SVG = 'http://www.w3.org/2000/svg';

const KIND = { opinion: 'canvas.kind.opinion', decision: 'canvas.kind.decision', question: 'canvas.kind.question', task: 'canvas.kind.task' };
const ADOPTION = { unknown: 'canvas.adoption.unknown', adopted: 'canvas.adoption.adopted', hypothesis: 'canvas.adoption.hypothesis', uncertain: 'canvas.adoption.uncertain', not_adopted: 'canvas.adoption.notAdopted' };
const VOICE = { user_statement: 'canvas.voice.userStatement', user_authored: 'canvas.voice.userAuthored', user_interpretation: 'canvas.voice.userInterpretation', assistant_proposal: 'canvas.voice.assistantProposal' };
const word = (table, id) => (table[id] ? tx(table[id]) : String(id || ''));
const pick = (item, key) => (item ? (I18N.lang() === 'en' ? item[key + 'En'] || item[key] : item[key] || item[key + 'En']) : '');
const short = (s, n) => { s = String(s || '').replace(/\s+/g, ' ').trim(); return s.length > n ? s.slice(0, n - 1) + '…' : s; };
const day = iso => { const d = new Date(iso); if (!iso || Number.isNaN(d.getTime())) return String(iso || '').slice(0, 10); try { return new Intl.DateTimeFormat(I18N.locale(), { dateStyle: 'medium' }).format(d); } catch { return String(iso).slice(0, 10); } };
const calm = () => typeof matchMedia === 'function' && matchMedia('(prefers-reduced-motion: reduce)').matches;
const narrow = () => typeof matchMedia === 'function' && matchMedia('(max-width: 720px)').matches;
const focusOn = el => { if (!el) return; try { el.focus({ preventScroll: true }); } catch { el.focus(); } };
const clamp = (v, lo, hi) => Math.min(hi, Math.max(lo, v));
// Same address Topics writes when it opens one record from the overview.
const recordHref = r => '/konular?view=overview&topicId=' + encodeURIComponent(r.topicId) + '&recordId=' + encodeURIComponent(r.id);
const thinkerHref = id => '/dusunurler#thinker-' + encodeURIComponent(id);

// Layout: a left-to-right tidy tree with fixed node sizes, so it is deterministic
// and independent of fonts and language.
const SIZE = { root: [190, 64], section: [230, 76], thought: [270, 132] };
const GAP_X = 70, GAP_Y = 18, SECTION_GAP = 36, MIN_K = 0.12, MAX_K = 2.4;

const state = { catalog: null, entries: [], lastId: null, thinkers: new Map(), root: null, byId: new Map(), cam: { x: 0, y: 0, k: 1 }, selected: null, anim: 0, userMoved: false, status: null };
const stage = $('stage'), world = $('world'), edges = $('edges'), nodesEl = $('nodes'), panel = $('panel'), panelBody = $('panel-body'), controls = $('controls');

function say(key, vars) { state.status = [key, vars]; $('page-status').textContent = key ? (vars && typeof vars.n === 'number' ? tn(key, vars.n, vars) : tx(key, vars)) : ''; }

// ---- tree ---------------------------------------------------------------
const tentative = item => item.entry.placement === 'suggested' || (item.record.kind !== 'question' && item.record.adoption === 'hypothesis');
const ordered = list => list.slice().sort((a, b) => (a.entry.order || 0) - (b.entry.order || 0) || String(a.entry.createdAt || '').localeCompare(String(b.entry.createdAt || '')));

function build() {
  const shown = state.entries.filter(e => e && e.entry && e.record && e.record.review !== 'rejected' && e.record.currency !== 'superseded');
  const known = new Map(shown.map(e => [e.entry.id, e]));
  const kids = new Map(), tops = new Map();
  const push = (map, key, value) => { if (!map.has(key)) map.set(key, []); map.get(key).push(value); };
  for (const e of shown) {
    const p = e.entry.parentId;
    if (p && p !== e.entry.id && known.has(p)) push(kids, p, e); else push(tops, e.entry.section, e);
  }
  const byId = new Map(), root = { id: 'root', kind: 'root', children: [], parent: null };
  byId.set(root.id, root);
  const placed = new Set();
  const grow = (item, parent) => {
    placed.add(item.entry.id);
    const n = { id: item.entry.id, kind: 'thought', item, parent, children: [] };
    byId.set(n.id, n);
    for (const child of ordered(kids.get(item.entry.id) || [])) if (!placed.has(child.entry.id)) n.children.push(grow(child, n));
    return n;
  };
  const sectionIds = (state.catalog.sections || []).map(s => s.id);
  for (const id of [...sectionIds, ...[...tops.keys()].filter(id => !sectionIds.includes(id))]) {
    const list = tops.get(id); if (!list) continue;
    const section = (state.catalog.sections || []).find(s => s.id === id) || null;
    const s = { id: 'section:' + id, kind: 'section', section, sectionId: id, children: [], parent: root };
    byId.set(s.id, s);
    for (const item of ordered(list)) if (!placed.has(item.entry.id)) s.children.push(grow(item, s));
    root.children.push(s);
  }
  // Anything caught in a parent cycle still gets a place under its own section.
  for (const e of shown) if (!placed.has(e.entry.id)) { const s = root.children.find(x => x.sectionId === e.entry.section) || root.children[0]; if (s) s.children.push(grow(e, s)); }
  state.root = root; state.byId = byId; state.count = shown.length;
}

function layout() {
  let cursor = 0;
  const colX = [0];
  const place = (n, depth) => {
    [n.w, n.h] = SIZE[n.kind]; n.depth = depth;
    if (colX[depth] == null) colX[depth] = colX[depth - 1] + (depth === 1 ? SIZE.root[0] : depth === 2 ? SIZE.section[0] : SIZE.thought[0]) + GAP_X;
    n.x = colX[depth];
    if (!n.children.length) { n.y = cursor; cursor += n.h + GAP_Y; return; }
    n.children.forEach((c, i) => { place(c, depth + 1); if (n.kind === 'root' && i < n.children.length - 1) cursor += SECTION_GAP; });
    const first = n.children[0], last = n.children[n.children.length - 1];
    n.y = (first.y + first.h / 2 + last.y + last.h / 2) / 2 - n.h / 2;
  };
  place(state.root, 0);
  let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
  for (const n of state.byId.values()) { minX = Math.min(minX, n.x); minY = Math.min(minY, n.y); maxX = Math.max(maxX, n.x + n.w); maxY = Math.max(maxY, n.y + n.h); }
  state.bounds = { x: minX, y: minY, w: maxX - minX, h: maxY - minY };
}

// ---- drawing --------------------------------------------------------------
function thoughtLabel(n) {
  const r = n.item.record, flags = [];
  if (n.item.entry.placement === 'suggested') flags.push(tx('canvas.flag.suggested'));
  if (r.kind !== 'question' && r.adoption === 'hypothesis') flags.push(tx('canvas.flag.hypothesis'));
  if (r.review === 'pending') flags.push(tx('canvas.flag.pending'));
  if (r.attribution === 'assistant_proposal') flags.push(tx('canvas.flag.ai'));
  return flags;
}
const roleTitle = role => { const r = (state.catalog.roles || []).find(x => x.id === role); return r ? pick(r, 'title') : role; };
const sectionTitle = n => (n.section ? pick(n.section, 'title') : tx('canvas.otherSection'));
const subtreeCount = n => n.children.reduce((sum, c) => sum + 1 + subtreeCount(c), 0);

function drawNode(n) {
  const el = node('div', null, 'cnode cnode-' + n.kind);
  el.id = 'node-' + n.id; el.dataset.id = n.id; el.tabIndex = 0;
  el.style.left = n.x + 'px'; el.style.top = n.y + 'px'; el.style.width = n.w + 'px'; el.style.height = n.h + 'px'; el.style.setProperty('--h', n.h + 'px');
  el.setAttribute('role', 'group'); el.setAttribute('aria-describedby', 'canvas-help');
  if (n.kind === 'root') {
    el.append(node('p', tx('canvas.root'), 'cnode-root-title'));
    el.setAttribute('aria-label', tx('canvas.root') + ' · ' + tn('canvas.sectionCount', state.count));
  } else if (n.kind === 'section') {
    el.setAttribute('aria-roledescription', tx('canvas.sectionRole'));
    el.dataset.section = n.sectionId;
    el.append(node('p', sectionTitle(n), 'cnode-section-title'), node('p', tn('canvas.sectionCount', subtreeCount(n)), 'cnode-meta'));
    el.setAttribute('aria-label', sectionTitle(n) + ' · ' + tn('canvas.sectionCount', subtreeCount(n)));
  } else {
    const { entry: e, record: r } = n.item;
    el.setAttribute('aria-roledescription', tx('canvas.thoughtRole'));
    el.dataset.role = e.role; el.dataset.adoption = r.adoption;
    if (tentative(n.item)) el.classList.add('is-tentative');
    if (r.attribution === 'assistant_proposal') el.classList.add('is-ai');
    if (n.id === state.lastId) el.classList.add('is-last');
    const flags = thoughtLabel(n);
    const head = node('p', roleTitle(e.role), 'cnode-role');
    if (flags.length) head.append(node('span', ' · ' + flags.join(' · '), 'cnode-flag'));
    el.append(head);
    const text = node('p', r.text, 'cnode-text');
    el.append(text);
    const foot = node('div', null, 'cnode-foot');
    if (n.item.predecessors && n.item.predecessors.length) { const ring = node('span', null, 'ring'); ring.title = tx('canvas.hasLineage'); ring.setAttribute('aria-hidden', 'true'); foot.append(ring); }
    if (n.id === state.lastId) foot.append(node('span', tx('canvas.lastMark'), 'last-mark'));
    for (const id of n.item.thinkerIds || []) {
      const name = state.thinkers.get(id) || id, a = node('a', name, 'chip');
      a.href = thinkerHref(id); a.tabIndex = -1; a.setAttribute('aria-label', tx('canvas.thinkerOpen', { name })); a.lang = 'tr';
      foot.append(a);
    }
    if (foot.childNodes.length) el.append(foot);
    const parts = [roleTitle(e.role), ...flags, r.text];
    if (n.item.predecessors && n.item.predecessors.length) parts.push(tx('canvas.hasLineage'));
    if (n.id === state.lastId) parts.push(tx('canvas.lastMark'));
    el.setAttribute('aria-label', parts.join(' · '));
  }
  el.addEventListener('click', ev => { if (pointer.suppress || ev.target.closest('a')) return; openPanel(n, { focus: false }); });
  el.addEventListener('keydown', ev => onNodeKey(ev, n));
  el.addEventListener('focus', () => { if (!pointer.down) ensureVisible(n); });
  return el;
}

function drawEdge(parent, child) {
  const p = document.createElementNS(SVG, 'path');
  const x1 = parent.x + parent.w, y1 = parent.y + parent.h / 2, x2 = child.x, y2 = child.y + child.h / 2, mx = (x1 + x2) / 2;
  p.setAttribute('d', `M${x1} ${y1} C${mx} ${y1} ${mx} ${y2} ${x2} ${y2}`);
  const cls = [];
  if (child.kind === 'thought' && tentative(child.item)) cls.push('tentative');
  if (child.kind === 'thought' && child.item.entry.role === 'objection') cls.push('objection');
  if (cls.length) p.setAttribute('class', cls.join(' '));
  return p;
}

function render() {
  build();
  const empty = !state.count;
  $('empty').hidden = !empty; world.hidden = empty; controls.hidden = empty; stage.querySelector('.zoom-controls').hidden = empty;
  if (empty) { closePanel(false); nodesEl.replaceChildren(); edges.replaceChildren(); say('canvas.emptyStatus'); return; }
  layout();
  const b = state.bounds;
  edges.setAttribute('width', String(Math.ceil(b.x + b.w + 40))); edges.setAttribute('height', String(Math.ceil(b.y + b.h + 40)));
  const frag = document.createDocumentFragment(), paths = document.createDocumentFragment();
  const walk = n => { frag.append(drawNode(n)); for (const c of n.children) { paths.append(drawEdge(n, c)); walk(c); } };
  walk(state.root);
  nodesEl.replaceChildren(frag); edges.replaceChildren(paths);
  const last = state.lastId && state.byId.get(state.lastId);
  $('last-thought').disabled = !last; $('last-why').hidden = !!last;
  if (state.selected) { const again = state.byId.get(state.selected.id); if (again) { state.selected = again; markSelected(); fillPanel(again); } else closePanel(false); }
  say('canvas.ready', { n: state.count });
}

// ---- camera ---------------------------------------------------------------
function apply() {
  const { x, y, k } = state.cam;
  world.style.transform = `translate(${x}px, ${y}px) scale(${k})`;
  stage.style.backgroundPosition = `${x}px ${y}px`; stage.style.backgroundSize = `${22 * k}px ${22 * k}px`;
}
// The part of the stage not covered by the panel or the bottom buttons.
function viewBox() {
  const s = stage.getBoundingClientRect(), w = s.width || 800, h = s.height || 600;
  let right = w, bottom = h - (controls.hidden ? 0 : (controls.offsetHeight || 0) + 24);
  if (!panel.hidden) { const p = panel.getBoundingClientRect(); if (narrow()) bottom = Math.min(bottom, p.top - s.top - 8); else if (p.width) right = p.left - s.left - 8; }
  if (right < 160) right = w; if (bottom < 160) bottom = h;
  return { left: 0, top: 0, w: right, h: bottom };
}
function moveTo(target, animate = true) {
  if (typeof cancelAnimationFrame === 'function') cancelAnimationFrame(state.anim);
  const cam = state.cam;
  if (!animate || calm() || typeof requestAnimationFrame !== 'function') { Object.assign(cam, target); apply(); return; }
  const from = { ...cam }, start = performance.now(), duration = 420;
  const step = now => {
    const p = Math.min(1, (now - start) / duration), e = p < 0.5 ? 4 * p * p * p : 1 - Math.pow(-2 * p + 2, 3) / 2;
    cam.x = from.x + (target.x - from.x) * e; cam.y = from.y + (target.y - from.y) * e; cam.k = from.k + (target.k - from.k) * e; apply();
    if (p < 1) state.anim = requestAnimationFrame(step);
  };
  state.anim = requestAnimationFrame(step);
}
function fitTarget() {
  const b = state.bounds, v = viewBox(), pad = 32;
  const k = clamp(Math.min((v.w - pad * 2) / b.w, (v.h - pad * 2) / b.h), MIN_K, 1);
  return { k, x: v.left + (v.w - b.w * k) / 2 - b.x * k, y: v.top + (v.h - b.h * k) / 2 - b.y * k };
}
function centreTarget(n, k) {
  const v = viewBox();
  return { k, x: v.left + v.w / 2 - (n.x + n.w / 2) * k, y: v.top + v.h / 2 - (n.y + n.h / 2) * k };
}
function fitAll(animate = true) { if (!state.count) return; state.userMoved = false; moveTo(fitTarget(), animate); }
function ensureVisible(n, animate = true) {
  const { x, y, k } = state.cam, v = viewBox(), m = 20;
  const sx = x + n.x * k, sy = y + n.y * k, sw = n.w * k, sh = n.h * k;
  const inside = sx >= v.left + m && sy >= v.top + m && sx + sw <= v.left + v.w - m && sy + sh <= v.top + v.h - m;
  if (inside && k >= 0.45) return;
  moveTo(centreTarget(n, k < 0.45 ? 0.85 : k), animate);
}
function zoomAt(px, py, factor, animate = false) {
  const { x, y, k } = state.cam, nk = clamp(k * factor, MIN_K, MAX_K);
  state.userMoved = true;
  moveTo({ k: nk, x: px - (px - x) * (nk / k), y: py - (py - y) * (nk / k) }, animate);
}
function zoomCentre(factor) { const v = viewBox(); zoomAt(v.left + v.w / 2, v.top + v.h / 2, factor, true); }

function lookAtLast() {
  const n = state.lastId && state.byId.get(state.lastId); if (!n) return;
  for (const old of nodesEl.querySelectorAll('.is-highlight')) old.classList.remove('is-highlight');
  const el = $('node-' + n.id); if (el) el.classList.add('is-highlight');
  openPanel(n, { focus: false, move: false });
  focusOn(el);
  const v = viewBox();
  moveTo(centreTarget(n, clamp(Math.min(1.1, (v.w - 60) / n.w), MIN_K, MAX_K)));
  state.userMoved = true; say('canvas.lastDone');
}

// ---- pointer, wheel and keys ---------------------------------------------------
const pointer = { down: false, suppress: false, list: new Map(), drag: null, pinch: null };
const ignore = target => target.closest('.side-panel, .canvas-controls, .zoom-controls, .canvas-empty');
stage.addEventListener('pointerdown', ev => {
  if ((ev.pointerType === 'mouse' && ev.button !== 0) || ignore(ev.target)) return;
  pointer.list.set(ev.pointerId, { x: ev.clientX, y: ev.clientY }); pointer.down = true;
  if (pointer.list.size === 1) pointer.drag = { x: ev.clientX, y: ev.clientY, cx: state.cam.x, cy: state.cam.y, moved: false };
  else { pointer.drag = null; pointer.pinch = null; }
});
stage.addEventListener('pointermove', ev => {
  if (!pointer.list.has(ev.pointerId)) return;
  pointer.list.set(ev.pointerId, { x: ev.clientX, y: ev.clientY });
  if (pointer.list.size === 2) {
    const [a, b] = [...pointer.list.values()], d = Math.hypot(a.x - b.x, a.y - b.y), mx = (a.x + b.x) / 2, my = (a.y + b.y) / 2;
    if (!pointer.pinch) { pointer.pinch = { d: d || 1, mx, my, ...state.cam }; return; }
    const s = stage.getBoundingClientRect(), p = pointer.pinch, nk = clamp(p.k * d / p.d, MIN_K, MAX_K), px = p.mx - s.left, py = p.my - s.top;
    state.cam.k = nk; state.cam.x = px - (px - p.x) * (nk / p.k) + (mx - p.mx); state.cam.y = py - (py - p.y) * (nk / p.k) + (my - p.my);
    state.userMoved = true; pointer.suppress = true; apply(); return;
  }
  const g = pointer.drag; if (!g) return;
  const dx = ev.clientX - g.x, dy = ev.clientY - g.y;
  if (!g.moved && Math.hypot(dx, dy) < 5) return;
  if (!g.moved) { g.moved = true; pointer.suppress = true; stage.classList.add('is-dragging'); if (typeof cancelAnimationFrame === 'function') cancelAnimationFrame(state.anim); try { stage.setPointerCapture(ev.pointerId); } catch { /* not capturable */ } }
  state.cam.x = g.cx + dx; state.cam.y = g.cy + dy; state.userMoved = true; apply();
});
const release = ev => {
  if (!pointer.list.has(ev.pointerId)) return;
  pointer.list.delete(ev.pointerId);
  if (pointer.list.size < 2) pointer.pinch = null;
  if (!pointer.list.size) {
    pointer.drag = null; pointer.down = false; stage.classList.remove('is-dragging');
    if (pointer.suppress) setTimeout(() => { pointer.suppress = false; }, 0);
  }
};
stage.addEventListener('pointerup', release); stage.addEventListener('pointercancel', release);
stage.addEventListener('wheel', ev => {
  if (ev.target.closest('.side-panel') || !state.count) return;
  ev.preventDefault();
  const unit = ev.deltaMode === 1 ? 16 : ev.deltaMode === 2 ? 400 : 1, s = stage.getBoundingClientRect();
  zoomAt(ev.clientX - s.left, ev.clientY - s.top, Math.exp(-ev.deltaY * unit * (ev.ctrlKey ? 0.01 : 0.0015)));
}, { passive: false });
// Focus inside an overflow-hidden box would scroll it; the camera does that job.
stage.addEventListener('scroll', () => { stage.scrollTop = 0; stage.scrollLeft = 0; });
stage.addEventListener('keydown', ev => {
  if (ev.target.closest('.side-panel') && ev.key !== 'Escape') return;
  if (ev.key === 'Escape' && !panel.hidden) { ev.preventDefault(); closePanel(true); return; }
  if (ev.target.matches('input, textarea, select') || ev.metaKey || ev.ctrlKey || ev.altKey) return;
  if (ev.key === '+' || ev.key === '=') { ev.preventDefault(); zoomCentre(1.25); }
  else if (ev.key === '-' || ev.key === '_') { ev.preventDefault(); zoomCentre(0.8); }
});

function onNodeKey(ev, n) {
  if (ev.target !== ev.currentTarget) return;
  let next = null;
  if (ev.key === 'Enter' || ev.key === ' ') { ev.preventDefault(); openPanel(n, { focus: true }); return; }
  if (ev.key === 'ArrowLeft') next = n.parent;
  else if (ev.key === 'ArrowRight') next = n.children[0];
  else if (ev.key === 'ArrowUp' || ev.key === 'ArrowDown') {
    const siblings = n.parent ? n.parent.children : [], i = siblings.indexOf(n);
    next = siblings[i + (ev.key === 'ArrowUp' ? -1 : 1)];
  } else if (ev.key === 'Home') next = state.root;
  else return;
  ev.preventDefault();
  if (next) focusOn($('node-' + next.id));
}

// ---- panel --------------------------------------------------------------------
function markSelected() {
  for (const old of nodesEl.querySelectorAll('.is-selected')) { old.classList.remove('is-selected'); old.removeAttribute('aria-current'); }
  const el = state.selected && $('node-' + state.selected.id);
  if (el) { el.classList.add('is-selected'); el.setAttribute('aria-current', 'true'); }
}
function openPanel(n, { focus = true, move = true } = {}) {
  state.selected = n; markSelected(); fillPanel(n);
  panel.hidden = false; stage.classList.add('has-panel');
  if (move) ensureVisible(n);
  if (focus) focusOn($('panel-title'));
}
function closePanel(returnFocus) {
  const was = state.selected; state.selected = null; markSelected();
  panel.hidden = true; stage.classList.remove('has-panel');
  if (returnFocus && was) focusOn($('node-' + was.id));
}
$('panel-close').onclick = () => closePanel(true);

const jumpButton = (n, text) => {
  const b = node('button', text, 'p-jump'); b.type = 'button';
  b.onclick = () => { openPanel(n, { focus: false, move: false }); focusOn($('node-' + n.id)); moveTo(centreTarget(n, Math.max(state.cam.k, 0.85))); state.userMoved = true; };
  return b;
};
const nodeName = n => (n.kind === 'root' ? tx('canvas.root') : n.kind === 'section' ? sectionTitle(n) : roleTitle(n.item.entry.role) + ': ' + short(n.item.record.text, 90));
const heading = (text, id) => { const h = node('h2', text, 'p-title'); h.id = id || ''; h.tabIndex = -1; return h; };
const section = (title, ...children) => { const s = node('section', null, 'p-section'); s.append(node('h3', title), ...children); return s; };

function chips(ids) {
  const wrap = node('p', null, 'p-chips');
  for (const id of ids) { const name = state.thinkers.get(id) || id, a = node('a', name, 'chip'); a.href = thinkerHref(id); a.lang = 'tr'; a.setAttribute('aria-label', tx('canvas.thinkerOpen', { name })); wrap.append(a); }
  return wrap;
}

function fillPanel(n) {
  const out = [];
  if (n.kind === 'root') {
    out.push(heading(tx('canvas.root'), 'panel-title'), node('p', pick(state.catalog, 'method'), 'p-method'));
    const ol = node('ul', null, 'p-list');
    for (const s of n.children) { const li = node('li'); li.append(jumpButton(s, sectionTitle(s) + ' · ' + tn('canvas.sectionCount', subtreeCount(s)))); ol.append(li); }
    out.push(section(tx('canvas.rootSections'), ol));
  } else if (n.kind === 'section') {
    out.push(node('p', tx('canvas.section'), 'eyebrow'), heading(sectionTitle(n), 'panel-title'));
    if (n.section) out.push(node('p', pick(n.section, 'question'), 'p-method'));
    const ol = node('ul', null, 'p-list');
    for (const c of n.children) { const li = node('li'); li.append(jumpButton(c, nodeName(c))); ol.append(li); }
    out.push(section(tx('canvas.sectionTop'), ol));
  } else out.push(...thoughtPanel(n));
  panelBody.replaceChildren(...out);
}

function thoughtPanel(n) {
  const { entry: e, record: r } = n.item, out = [];
  const state_ = r.kind === 'question' ? tx(r.questionState === 'closed' ? 'canvas.closed' : 'canvas.open') : word(ADOPTION, r.adoption);
  out.push(node('p', [roleTitle(e.role), word(KIND, r.kind), state_, r.review === 'pending' ? tx('canvas.review.pending') : ''].filter(Boolean).join(' · '), 'eyebrow' + (e.role === 'objection' ? ' is-objection' : '')));
  // The thought itself is the heading, in the voice it was written in; a short
  // heading the person gave it on the map comes first when there is one.
  if (e.label) out.push(heading(e.label, 'panel-title'));
  if (e.placement === 'suggested') out.push(node('p', tx('canvas.tentativePlace'), 'p-tentative'));
  if (r.kind !== 'question' && r.adoption === 'hypothesis') out.push(node('p', tx('canvas.tentativeHypothesis'), 'p-tentative'));
  const ai = r.attribution === 'user_interpretation' || r.attribution === 'assistant_proposal';
  const voice = node('div', null, 'p-voice ' + (ai ? 'is-ai' : 'is-own'));
  const text = e.label ? node('p', r.text, 'p-text') : heading(r.text, 'panel-title');
  if (!e.label) text.classList.add('p-text');
  voice.append(node('p', word(VOICE, r.attribution), 'p-voice-label'), text);
  if (I18N.lang() === 'en' && e.translationEn && e.translationEn.text) {
    const t = node('p', e.translationEn.text, 'p-translation'); t.lang = 'en';
    voice.append(node('p', tx(e.translationEn.by === 'user' ? 'canvas.translation.user' : 'canvas.translation.ai'), 'p-voice-label'), t);
  }
  out.push(voice);
  // Why: the reason, then the exact source quote.
  const why = [];
  why.push(r.reason && r.reason.trim() ? node('p', r.reason, 'p-reason') : node('p', tx('canvas.noReason'), 'small'));
  const src = r.source;
  if (src && src.excerpt) {
    const fig = node('figure', null, 'p-source');
    fig.append(node('p', tx(src.role === 'assistant' ? 'canvas.source.assistant' : 'canvas.source.user'), 'p-voice-label' + (src.role === 'assistant' ? ' is-ai' : '')));
    fig.append(node('blockquote', src.excerpt, 'voice-source'));
    fig.append(node('figcaption', [src.title || tx('canvas.source.untitled'), src.timestamp ? day(src.timestamp) : ''].filter(Boolean).join(' · '), 'small'));
    why.push(fig);
  } else why.push(node('p', tx('canvas.source.none'), 'small'));
  out.push(section(tx(r.adoption === 'adopted' ? 'canvas.why' : 'canvas.whyHeld'), ...why));
  // Where I came from: the path from My map down to this thought.
  const path = []; for (let p = n.parent; p; p = p.parent) path.unshift(p);
  const ol = node('ol', null, 'p-path');
  for (const p of path) { const li = node('li'); li.append(jumpButton(p, nodeName(p))); ol.append(li); }
  const here = node('li', null, 'p-here'); here.append(node('span', short(r.text, 90)), node('span', ' ' + tx('canvas.here'), 'small')); ol.append(here);
  out.push(section(tx('canvas.from'), ol));
  if (n.children.length) {
    const ul = node('ul', null, 'p-list');
    for (const c of n.children) { const li = node('li'); li.append(jumpButton(c, nodeName(c))); ul.append(li); }
    out.push(section(tx('canvas.children'), ul));
  }
  // Thought inheritance: folded; nearest first, indented by depth.
  const preds = (n.item.predecessors || []).map((p, i) => [p, i]).sort((a, b) => (Number(a[0].depth) || 1) - (Number(b[0].depth) || 1) || a[1] - b[1]).map(x => x[0]);
  if (preds.length) {
    const details = node('details', null, 'p-lineage');
    details.append(node('summary', tn('canvas.inheritance.summary', preds.length)));
    const list = node('ol', null, 'p-lineage-list');
    for (const p of preds) {
      const li = node('li'); li.dataset.depth = String(clamp(Number(p.depth) || 1, 1, 6));
      li.append(node('p', p.text, 'p-lineage-text'));
      li.append(node('p', [word(KIND, p.kind), p.supersededAt ? tx('canvas.inheritance.date', { date: day(p.supersededAt) }) : ''].filter(Boolean).join(' · '), 'small'));
      if (p.supersessionReason) li.append(node('p', tx('canvas.inheritance.reason', { reason: p.supersessionReason }), 'small'));
      list.append(li);
    }
    details.append(list);
    out.push(section(tx('canvas.inheritance'), details));
  } else out.push(section(tx('canvas.inheritance'), node('p', tx('canvas.inheritance.none'), 'small')));
  if ((n.item.thinkerIds || []).length) out.push(section(tx('canvas.thinkers'), chips(n.item.thinkerIds)));
  if (n.item.lastDiscussedAt) out.push(node('p', tx('canvas.lastDiscussed', { date: day(n.item.lastDiscussedAt) }), 'small p-last'));
  const links = node('p', null, 'p-links');
  const list_ = node('a', tx('canvas.links.list')); list_.href = '/harita/liste#entry-' + encodeURIComponent(e.id);
  const surpassed = node('a', tx('nav.surpassed')); surpassed.href = '/asilmis';
  links.append(list_, surpassed);
  if (r.topicId) { const rec = node('a', tx('canvas.links.record')); rec.href = recordHref(r); links.append(rec); }
  out.push(links);
  return out;
}

// ---- wiring ---------------------------------------------------------------------
$('fit-all').onclick = () => { fitAll(); say('canvas.fitDone'); };
$('last-thought').onclick = lookAtLast;
$('zoom-in').onclick = () => zoomCentre(1.25);
$('zoom-out').onclick = () => zoomCentre(0.8);
let resizeTimer = 0;
addEventListener('resize', () => { clearTimeout(resizeTimer); resizeTimer = setTimeout(() => { if (state.count && !state.userMoved) fitAll(false); }, 120); });

async function load() {
  const [view, thinkers] = await Promise.all([call('map'), call('thinkers').catch(() => null)]);
  state.catalog = view.catalog || { sections: [], roles: [] };
  state.entries = view.entries || [];
  state.lastId = view.lastDiscussedEntryId || null;
  state.thinkers = new Map(((thinkers && thinkers.catalog && thinkers.catalog.thinkers) || []).map(t => [t.id, t.name]));
  render();
  if (!state.count) return;
  fitAll(false);
  // An address such as /harita#entry-ID opens that thought.
  const wanted = /^#entry-(.+)$/.exec(location.hash || '');
  const target = wanted && state.byId.get(decodeURIComponent(wanted[1]));
  if (target) { openPanel(target, { focus: false, move: false }); focusOn($('node-' + target.id)); moveTo(centreTarget(target, 1), false); state.userMoved = true; }
}

// A language switch redraws in place; the camera, the open panel and focus stay.
I18N.onChange(() => {
  if (!state.catalog) { if (state.status) say(...state.status); return; }
  const active = document.activeElement, focused = active && active.closest && active.closest('.cnode'), inPanel = active && panel.contains(active);
  render();
  if (focused) focusOn($(focused.id)); else if (inPanel && !panel.hidden) focusOn($('panel-title'));
});
I18N.init(call).then(load).catch(e => { say(null); $('page-error').textContent = e.message; $('page-error').hidden = false; });
