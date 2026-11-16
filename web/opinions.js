import { api } from './private-client.js';

const $ = id => document.getElementById(id);
const statusLabels = { draft: 'Taslak', confirmed: 'Onaylandı', uncertain: 'Kararsızım', rejected: 'Bana ait değil' };
const attributionLabels = { assistant_proposal: 'AI yorum önerisi', user_statement: 'Kaynakta kullanıcı sözü', user_authored: 'Kendi yazdığın görüş' };
const state = { cards: [], catalog: { topics: [], positions: [], traditions: [] }, currentId: null, creating: false, creationRequestId: null, dirty: false, busy: false, topic: 'all', filter: 'all', view: 'cards', contextRequest: 0 };
const call = (op, body = {}) => api('/api/private/tore/' + op, body);
const currentCard = () => state.cards.find(card => card.id === state.currentId);
const topicFor = id => state.catalog.topics.find(topic => topic.id === id);
const date = value => { if (!value) return 'Tarih belirtilmemiş'; const d = new Date(value); return Number.isNaN(d.valueOf()) ? 'Tarih belirtilmemiş' : d.toLocaleDateString('tr-TR', { day: 'numeric', month: 'long', year: 'numeric' }); };
function node(tag, text, className) { const el = document.createElement(tag); if (text !== undefined) el.textContent = text; if (className) el.className = className; return el; }
function option(value, label) { const el = node('option', label); el.value = value; return el; }
function announce(message) { $('page-status').textContent = message; }
function error(message) { $('editor-error').textContent = message; $('editor-error').hidden = false; }
function setDirty() { state.dirty = true; $('edit-state').textContent = 'Kaydedilmemiş değişikliklerin var.'; }
function canLeave() { return !state.dirty || window.confirm('Kaydedilmemiş değişiklikler bıraktın. Değişiklikleri bırakıp devam etmek istiyor musun?'); }
function markClean() { state.dirty = false; $('edit-state').textContent = ''; $('editor-error').hidden = true; if ($('reconcile-card')) $('reconcile-card').hidden = true; }
function setBusy(value) {
  state.busy = value;
  for (const control of document.querySelectorAll('#opinion-form button, #opinion-form input, #opinion-form textarea, #opinion-form select, #new-card, #topic-filter, #status-filter, .opinion-card, .topic-card')) control.disabled = value;
  $('editor').setAttribute('aria-busy', String(value));
}
function showView(view) {
  state.view = view;
  $('cards-view').hidden = view !== 'cards'; $('map-view').hidden = view !== 'map';
  $('view-cards').setAttribute('aria-pressed', String(view === 'cards')); $('view-map').setAttribute('aria-pressed', String(view === 'map'));
  if (view === 'map') renderMap();
}
const calm = () => typeof matchMedia === 'function' && matchMedia('(prefers-reduced-motion: reduce)').matches;
function scrollToNotebook() { $('notebook').scrollIntoView({ behavior: calm() ? 'auto' : 'smooth', block: 'start' }); }
function selectTopic(id) {
  if (state.busy || !canLeave()) return;
  state.topic = id; $('topic-filter').value = id; state.currentId = null; state.creating = false; markClean();
  renderTopics(); renderList(); selectFirst(); showView('cards'); scrollToNotebook();
}
function renderOverview() {
  const confirmed = state.cards.filter(card => card.status === 'confirmed');
  $('confirmed-count').textContent = confirmed.length; $('draft-count').textContent = state.cards.filter(card => card.status === 'draft').length;
  $('topic-count').textContent = new Set(confirmed.map(card => card.topic)).size + ' / ' + state.catalog.topics.length;
  $('cards-count').textContent = state.cards.length;
}
function renderTopics() {
  $('topics').replaceChildren(...state.catalog.topics.map((topic, index) => {
    const el = node('button', undefined, 'topic-card'); el.type = 'button'; el.dataset.topic = topic.id; el.setAttribute('aria-pressed', String(state.topic === topic.id));
    const top = node('div', undefined, 'topic-card-top'); top.append(node('span', String(index + 1).padStart(2, '0'), 'topic-index'), node('span', '↗', 'topic-arrow'));
    const cards = state.cards.filter(card => card.topic === topic.id), confirmed = cards.filter(card => card.status === 'confirmed').length;
    el.append(top, node('h3', topic.label), node('p', topic.question), node('span', cards.length + ' görüş · ' + confirmed + ' onaylı', 'topic-meta'));
    el.onclick = () => selectTopic(topic.id); return el;
  }));
}
function filteredCards() { return state.cards.filter(card => (state.topic === 'all' || card.topic === state.topic) && (state.filter === 'all' || card.status === state.filter)); }
function renderList() {
  const cards = filteredCards(); $('filter-summary').textContent = cards.length + ' görüş gösteriliyor';
  $('card-list').replaceChildren(...cards.map(card => {
    const el = node('button', undefined, 'opinion-card'); el.type = 'button'; el.dataset.cardId = card.id; el.setAttribute('aria-pressed', String(card.id === state.currentId));
    const top = node('div', undefined, 'opinion-card-top'); top.append(node('span', topicFor(card.topic)?.label || card.topic, 'card-topic'), node('span', statusLabels[card.status] || card.status, 'status-pill ' + card.status));
    el.append(top, node('p', card.statement, 'statement-preview'), node('span', attributionLabels[card.attribution] || 'Kaynak incelemesi', 'card-origin'));
    el.onclick = () => selectCard(card.id); return el;
  }));
  if (!cards.length) $('card-list').append(node('p', state.cards.length ? 'Bu filtreye uygun görüş yok. Başka bir durum seçebilir veya kendi görüşünü ekleyebilirsin.' : 'Görüş defterin henüz boş. İlk görüşünü ekleyerek başlayabilirsin.', 'empty-list'));
}
function selectFirst() { const card = filteredCards()[0]; if (card) selectCard(card.id, true); else { $('editor').hidden = true; $('editor-empty').hidden = false; } }
function selectCard(id, force = false) {
  if (state.busy || (!force && !canLeave())) return;
  const card = state.cards.find(card => card.id === id); if (!card) return;
  state.currentId = card.id; state.creating = false; markClean(); renderList(); renderEditor(card);
}
function renderPositions(topic, selected = []) {
  $('position-options').replaceChildren(...state.catalog.positions.filter(position => position.topic === topic).map(position => {
    const label = node('label', undefined, 'position-choice'), input = node('input'); input.type = 'checkbox'; input.value = position.id; input.checked = selected.includes(position.id); input.dataset.positionId = position.id;
    const copy = node('span'); copy.append(node('strong', position.label), node('small', position.description));
    const traditions = position.traditionIds.map(id => state.catalog.traditions.find(item => item.id === id)?.label).filter(Boolean);
    if (traditions.length) copy.append(node('small', 'Olası kesişim: ' + traditions.join(' · '), 'tradition-note'));
    input.addEventListener('change', setDirty); label.append(input, copy); return label;
  }));
}
function renderEditor(card) {
  state.contextRequest++; $('editor').hidden = false; $('editor-empty').hidden = true;
  $('editor-topic').textContent = topicFor(card.topic)?.label || card.topic; $('editor-status').textContent = statusLabels[card.status] || card.status; $('editor-status').className = 'status-pill ' + card.status;
  $('editor-heading').textContent = 'Bu görüş seni anlatıyor mu?';
  const attribution = card.attribution === 'assistant_proposal'
    ? 'Bu cümle, kaynaktan hazırlanmış bir AI yorum önerisi. Söylediğini doğru yansıtıp yansıtmadığına sen karar verirsin.'
    : card.attribution === 'user_statement'
      ? 'Kaynakta kullanıcı mesajı olarak kayıtlı. Bir soru, alıntı veya düşünce deneyi de olabilir; benimsenmiş bir görüş olduğu varsayılmaz.'
      : 'Bu görüşü töre’de kendin yazdın. Onayladığında seçtiğin bağlantılarla kişisel haritana eklenir.';
  $('attribution-note').textContent = attribution + (card.status === 'confirmed' ? ' Bu sürümü sen onayladın; kaynak atfı korunuyor.' : '');
  $('source-panel').hidden = !card.source;
  $('source-context').hidden = true; $('source-context').replaceChildren(); $('load-context').disabled = false; $('load-context').textContent = 'Kaynak mesajı ve bağlamını gör';
  if (card.source) {
    $('source-role').textContent = card.source.role === 'user' ? 'Kaynak · kullanıcı mesajı' : card.source.role === 'assistant' ? 'Kaynak · AI yanıtı' : 'Kaynak · konuşmacı belirsiz';
    $('source-provider').textContent = card.source.provider || '';
    $('source-excerpt').textContent = card.source.excerpt; $('source-title').textContent = card.source.conversationTitle || 'Kaynak konuşma'; $('source-date').textContent = date(card.source.timestamp);
  }
  $('statement').value = card.statement; $('reason').value = card.reason || ''; $('change-type').value = 'review'; $('change-reason').value = '';
  $('new-topic-field').hidden = true; $('revision-fields').hidden = false; $('review-actions').hidden = false; $('create-actions').hidden = true;
  $('save-draft').textContent = card.status === 'confirmed' ? 'Onayı kaldır ve taslak kaydet' : 'Taslak olarak kaydet';
  renderPositions(card.topic, card.positionIds); renderHistory(card); $('history-panel').hidden = false;
}
function renderHistory(card) {
  const items = [...(card.history || [])].reverse(); $('history-count').textContent = items.length; $('card-history').replaceChildren(); $('history-panel').open = false;
  if (!items.length) { $('card-history').append(node('p', 'İlk kayıt · ' + date(card.createdAt) + '. Henüz bir inceleme veya değişiklik yok.', 'small')); return; }
  for (const item of items) {
    const el = node('article', undefined, 'history-item');
    const kind = { review: 'İnceleme', correction: 'İfade / yorum düzeltmesi', opinion_change: 'Görüş değişimi' }[item.changeType] || 'İnceleme';
    el.append(node('h3', 'Sürüm ' + item.revision + ' · ' + (statusLabels[item.status] || item.status)), node('p', item.statement), node('p', item.reason || 'Gerekçe eklenmemiş.', 'small'));
    if (item.positionIds?.length) el.append(node('p', 'Önceki bağlantılar: ' + item.positionIds.map(id => state.catalog.positions.find(p => p.id === id)?.label || id).join(' · '), 'small'));
    el.append(node('p', kind + ' · ' + date(item.changedAt) + (item.changeReason ? '\n' + item.changeReason : ''), 'small')); $('card-history').append(el);
  }
}
function beginNew() {
  if (state.busy || !canLeave()) return;
  state.currentId = null; state.creating = true; state.creationRequestId = crypto.randomUUID(); state.contextRequest++; markClean(); renderList(); showView('cards');
  $('editor').hidden = false; $('editor-empty').hidden = true; $('editor-topic').textContent = 'Kendi cümlenle'; $('editor-heading').textContent = 'Neyi savunuyorsun, neden?'; $('editor-status').textContent = 'Yeni görüş'; $('editor-status').className = 'status-pill';
  $('attribution-note').textContent = 'Burada yazdığın görüş, kendi beyanın olarak kaydedilir. İlk kayıt taslaktır; haritaya eklemek için ayrıca onaylarsın.';
  $('source-panel').hidden = true; $('history-panel').hidden = true; $('new-topic-field').hidden = false; $('revision-fields').hidden = true; $('review-actions').hidden = true; $('create-actions').hidden = false;
  $('statement').value = ''; $('reason').value = ''; $('change-reason').value = ''; $('new-topic').value = state.topic === 'all' ? state.catalog.topics[0]?.id || '' : state.topic;
  renderPositions($('new-topic').value); $('statement').focus(); scrollToNotebook();
}
function selectedPositions() { return [...$('position-options').querySelectorAll('input:checked')].map(input => input.value); }
async function save(status) {
  if (state.busy) return;
  $('editor-error').hidden = true;
  const statement = $('statement').value.trim(), reason = $('reason').value.trim();
  if (!statement) { error('Görüşünü yazmadan kaydedemezsin.'); $('statement').focus(); return; }
  const creating = state.creating, card = currentCard();
  let body = { statement, reason, positionIds: selectedPositions() }, op = 'opinion-create';
  if (creating) Object.assign(body, { topic: $('new-topic').value, attribution: 'user_authored', requestId: state.creationRequestId });
  else {
    if (!card) return;
    const changeType = $('change-type').value, changeReason = $('change-reason').value.trim();
    const changed = statement !== card.statement || reason !== (card.reason || '') || JSON.stringify([...body.positionIds].sort()) !== JSON.stringify([...card.positionIds].sort());
    if (changed && changeType === 'review') { error('Görüşünü, gerekçeni veya bağlantılarını değiştirdin. Bunun bir düzeltme mi yoksa görüş değişimi mi olduğunu seç ve nedenini yaz.'); $('change-type').focus(); return; }
    if (changeType !== 'review' && !changeReason) { error('Düzeltmenin veya görüş değişiminin nedenini kısaca yaz.'); $('change-reason').focus(); return; }
    Object.assign(body, { id: card.id, expectedRevision: card.revision, status, changeType, changeReason }); if (status === 'confirmed') body.confirmedByUser = true; op = 'opinion-review';
  }
  setBusy(true); $('edit-state').textContent = 'Kaydediliyor…';
  try {
    const result = await call(op, body); if (!result.card?.id) throw Error('Kayıt yanıtı doğrulanamadı; yeniden açıp durumu kontrol et.');
    const index = state.cards.findIndex(item => item.id === result.card.id); if (index >= 0) state.cards[index] = result.card; else state.cards.push(result.card);
    state.currentId = result.card.id; state.creating = false; if (creating) state.creationRequestId = null; markClean(); renderOverview(); renderTopics(); renderList(); renderEditor(result.card); renderMap();
    const message = result.card.status === 'confirmed' ? 'Görüşün ve seçtiğin bağlantılar onaylandı. Haritan güncellendi.' : result.card.status === 'uncertain' ? 'Kararsız olarak kaydedildi. Bu görüş haritaya katılmaz.' : result.card.status === 'rejected' ? 'Bana ait değil olarak kaydedildi. Bu görüş haritaya katılmaz.' : 'Taslak kaydedildi. Henüz haritaya katılmaz.';
    $('edit-state').textContent = message; announce(message);
    window.dispatchEvent(new CustomEvent('tore-opinions-updated'));
  } catch (err) {
    error(err.message + ' Sonuç doğrulanamadı; kayıt oluşmuş olabilir. Formdaki metnin korunuyor. ' + (creating ? 'Aynı içerikle yeniden denemek ikinci kayıt oluşturmaz. İçeriği değiştirmeden önce kaydın durumunu yeniden yükleyerek kontrol et.' : 'Yeni bir işlemden önce kaydın durumunu yeniden yükleyerek kontrol et.'));
    $('edit-state').textContent = 'Kayıt sonucu doğrulanamadı.'; $('reconcile-card').hidden = false;
  }
  finally { setBusy(false); }
}
function cardLink(card, className) {
  const button = node('button', card.statement, className); button.type = 'button'; button.dataset.mapCardId = card.id;
  button.onclick = () => { if (state.busy || !canLeave()) return; state.topic = 'all'; state.filter = 'all'; $('topic-filter').value = 'all'; $('status-filter').value = 'all'; markClean(); showView('cards'); selectCard(card.id, true); renderTopics(); scrollToNotebook(); };
  return button;
}
function renderMap() {
  const confirmed = state.cards.filter(card => card.status === 'confirmed');
  $('map-confirmed-count').textContent = confirmed.length + ' onaylı görüş'; $('map-empty').hidden = confirmed.length > 0;
  $('map-topics').replaceChildren(); $('map-traditions').replaceChildren();
  if (!confirmed.length) return;
  for (const topic of state.catalog.topics) {
    const el = node('article', undefined, 'map-topic'), cards = confirmed.filter(card => card.topic === topic.id); el.append(node('h3', topic.label));
    if (!cards.length) el.append(node('p', 'Bu konuda henüz onayladığın bir görüş yok.'));
    else for (const card of cards) el.append(cardLink(card));
    $('map-topics').append(el);
  }
  let matching = 0;
  for (const tradition of state.catalog.traditions) {
    const supporting = confirmed.map(card => ({ card, positions: state.catalog.positions.filter(position => position.topic === card.topic && card.positionIds.includes(position.id) && position.traditionIds.includes(tradition.id)) })).filter(item => item.positions.length);
    if (!supporting.length) continue;
    matching++; const el = node('article', undefined, 'tradition-card'); el.dataset.traditionId = tradition.id;
    el.append(node('p', 'Olası yakınlık', 'eyebrow'), node('h3', tradition.label), node('p', tradition.description));
    const support = node('div', undefined, 'tradition-support'); support.append(node('strong', 'Neden burada görünüyor?'));
    for (const { card, positions } of supporting) { support.append(cardLink(card), node('p', 'Seçtiğin bağlantı: ' + positions.map(position => position.label).join(' · '), 'small')); }
    el.append(support, node('div', tradition.limits, 'tradition-limits')); $('map-traditions').append(el);
  }
  if (!matching) $('map-traditions').append(node('p', 'Onaylı görüşlerin yukarıda. Henüz bir harita bağlantısı seçmedin; görüş kartından sana uygun bağlantıları inceleyebilirsin.', 'small'));
}
async function loadContext() {
  const card = currentCard(); if (!card?.source) return;
  const requestId = ++state.contextRequest; $('load-context').disabled = true; $('load-context').textContent = 'Kaynak açılıyor…';
  try {
    const conversation = await call('conversation', { id: card.source.conversationId });
    if (requestId !== state.contextRequest) return;
    const messages = conversation.messages || [], selected = messages.find(message => message.id === card.source.messageId);
    if (!selected) throw Error('Kaynak mesaj bulunamadı.');
    const byId = new Map(messages.map(message => [message.id, message]));
    const context = []; if (selected.parentId && byId.has(selected.parentId)) context.push(byId.get(selected.parentId)); context.push(selected);
    const children = messages.filter(message => message.parentId === selected.id); context.push(...children);
    $('source-context').replaceChildren(node('p', 'Önceki mesaj, kaynak mesaj ve varsa hemen sonraki dallar. Kaynak metin değişmez.', 'small'));
    for (const message of context) {
      const el = node('article', undefined, 'context-message' + (message.id === selected.id ? ' source-selected' : ''));
      const role = message.role === 'user' ? 'Kullanıcı' : message.role === 'assistant' ? 'AI yanıtı' : 'Belirsiz konuşmacı';
      el.append(node('strong', role + (message.id === selected.id ? ' · Kaynak mesaj' : '')), node('p', message.text)); $('source-context').append(el);
    }
    $('source-context').hidden = false; $('load-context').textContent = 'Kaynağı yeniden yükle';
  } catch (err) { if (requestId === state.contextRequest) { $('source-context').replaceChildren(node('p', err.message, 'inline-error')); $('source-context').hidden = false; $('load-context').textContent = 'Kaynağı yeniden dene'; } }
  finally { if (requestId === state.contextRequest) $('load-context').disabled = false; }
}
async function load() {
  $('load-error').hidden = true; $('reload-data').disabled = true;
  try {
    const data = await call('opinions');
    if (!Array.isArray(data.cards) || !Array.isArray(data.catalog?.topics) || !Array.isArray(data.catalog?.positions) || !Array.isArray(data.catalog?.traditions)) throw Error('Görüş defteri yanıtı geçersiz.');
    state.cards = data.cards; state.catalog = data.catalog;
    $('topic-filter').replaceChildren(option('all', 'Tüm konular'), ...state.catalog.topics.map(topic => option(topic.id, topic.label))); $('new-topic').replaceChildren(...state.catalog.topics.map(topic => option(topic.id, topic.label)));
    state.topic = 'all'; state.filter = 'all'; $('status-filter').value = 'all'; state.currentId = null; state.creating = false; markClean(); renderOverview(); renderTopics(); renderList(); selectFirst(); renderMap();
    announce(state.cards.length ? 'Görüş defterin hazır. Kaynakları incele; yalnız onayladıkların haritana eklenir.' : 'Görüş defterin hazır. İlk görüşünü kendi cümlenle ekleyebilirsin.');
  } catch (err) { $('load-error-text').textContent = err.message; $('load-error').hidden = false; announce('Görüş defteri açılamadı. Mevcut kayıtlar değiştirilmedi.'); }
  finally { $('reload-data').disabled = false; }
}
const reconcileButton = node('button', 'Kayıtları yeniden yükle', 'text-button'); reconcileButton.id = 'reconcile-card'; reconcileButton.type = 'button'; reconcileButton.hidden = true; reconcileButton.onclick = () => { if (!state.busy && canLeave()) load(); }; $('editor-error').after(reconcileButton);
$('view-cards').onclick = () => showView('cards'); $('view-map').onclick = () => showView('map');
$('new-card').onclick = beginNew;
$('start-review').onclick = $('map-start-review').onclick = () => { showView('cards'); scrollToNotebook(); };
$('topic-filter').onchange = () => { if (!canLeave()) { $('topic-filter').value = state.topic; return; } state.topic = $('topic-filter').value; state.currentId = null; markClean(); renderTopics(); renderList(); selectFirst(); };
$('status-filter').onchange = () => { if (!canLeave()) { $('status-filter').value = state.filter; return; } state.filter = $('status-filter').value; state.currentId = null; markClean(); renderList(); selectFirst(); };
$('new-topic').onchange = () => { renderPositions($('new-topic').value); setDirty(); };
for (const id of ['statement', 'reason', 'change-reason']) $(id).addEventListener('input', setDirty);
$('change-type').addEventListener('change', setDirty);
$('confirm-card').onclick = () => save('confirmed'); $('uncertain-card').onclick = () => save('uncertain'); $('reject-card').onclick = () => save('rejected'); $('save-draft').onclick = () => save('draft');
$('opinion-form').onsubmit = event => { event.preventDefault(); if (state.creating) save('draft'); };
$('load-context').onclick = loadContext; $('reload-data').onclick = () => { if (canLeave()) load(); };
window.addEventListener('beforeunload', event => { if (state.dirty || state.busy) { event.preventDefault(); event.returnValue = ''; } });
load();
