import { api } from '/private-client.js';

// All records and replies stay behind the existing loopback capability. This
// screen never invokes a model or sends a conversation to a remote service.
(() => {
  'use strict';
  const $ = id => document.getElementById(id);
  const call = (op, body = {}) => api('/api/private/tore/' + op, body);
  const labels = {
    kind: { opinion: 'Görüş', decision: 'Karar', question: 'Soru' },
    review: { pending: 'İnceleme bekliyor', reviewed: 'İncelendi', rejected: 'Yanlış kayıt / reddedildi' },
    adoption: { unknown: 'Belirtilmedi', adopted: 'Benimsiyorum', hypothesis: 'Bir ihtimal olarak tartıştım', uncertain: 'Kararsızım', not_adopted: 'Benimsemiyorum', not_applicable: 'Soru · benimseme uygulanmaz' },
    currency: { unknown: 'Güncelliği belirsiz', current: 'Güncel', superseded: 'Artık güncel değil' },
    priority: { unspecified: 'Öncelik belirtilmedi', active: 'Aktif çalışıyorum', paused: 'Beklemede', not_priority: 'Şu an öncelikli değil' }
  };
  const targets = {
    chatgpt: ['ChatGPT', 'https://chatgpt.com/'], gemini: ['Google Gemini', 'https://gemini.google.com/'],
    claude: ['Claude', 'https://claude.ai/'], meta: ['Meta AI', 'https://www.meta.ai/'], xai: ['xAI / Grok', 'https://grok.com/'],
    deepseek: ['DeepSeek', 'https://chat.deepseek.com/'], kimi: ['Kimi', 'https://www.kimi.com/'],
    glm: ['GLM', 'https://chat.z.ai/'], qwen: ['Alibaba / Qwen', 'https://chat.qwen.ai/'], mistral: ['Mistral', 'https://chat.mistral.ai/'],
    nvidia: ['NVIDIA', 'https://build.nvidia.com/'], openrouter: ['OpenRouter', null], other: ['Diğer hizmet', null]
  };
  const state = { data: { topics: [], records: [], packets: [], replies: [], backups: [], conversationLinks: [] }, topicId: '', screen: 'overview', view: 'current', queuePage: 0, sourceCheckLimit: 6, dashboardLimits: { decisions: 6, opinions: 6, resume: 6 }, editing: null, source: null, packet: null, selected: new Set(), migration: null, bulk: null, conversationLimit: 20, overviewLimits: { approved: 8, candidates: 8 }, recordLimit: 30, busy: false, requestKeys: new Map(), replyDrafts: new Map() };
  const node = (tag, value, cls) => { const el = document.createElement(tag); if (value != null) el.textContent = String(value); if (cls) el.className = cls; return el; };
  const text = (id, value) => { $(id).textContent = value ?? ''; };
  const show = (id, yes) => { $(id).hidden = !yes; };
  const error = (id, message = '') => { text(id, message); show(id, Boolean(message)); };
  const date = value => { if (!value || Number.isNaN(new Date(value).getTime())) return 'Tarih belirtilmedi'; return new Date(value).toLocaleString('tr-TR', { dateStyle: 'medium', timeStyle: 'short' }); };
  const option = (value, title) => { const el = node('option', title); el.value = value; return el; };
  const pendingRecords = () => state.data.records.filter(record => record.review === 'pending');
  const topicName = id => state.data.topics.find(topic => topic.id === id)?.title || 'Konusu bulunamayan kayıt';
  const visibleTopics = () => state.data.topics.filter(topic => topic.id !== 'bulk-topic-other' || state.data.records.some(record => record.topicId === topic.id) || state.data.conversationLinks.some(link => link.topicId === topic.id));
  const currentTopic = () => state.data.topics.find(t => t.id === state.topicId);
  const topicRecords = () => state.data.records.filter(r => r.topicId === state.topicId);
  const requestId = (op, body) => { const key = op + JSON.stringify(body); if (!state.requestKeys.has(key)) state.requestKeys.set(key, crypto.randomUUID()); return state.requestKeys.get(key); };
  const mutation = (op, body) => call(op, { ...body, requestId: requestId(op, body) });
  const roleName = role => role === 'assistant' ? 'AI yanıtı' : role === 'user' || role === 'human' ? 'Kullanıcı sözü' : 'Konuşmacı belirtilmedi';
  const isProposal = record => record.attribution === 'assistant_proposal' || record.provenance === 'assistant_proposal' || record.source?.role === 'assistant' || record.source?.speaker === 'assistant';
  const isCurrent = record => record.review === 'reviewed' && record.currency === 'current' && (record.kind === 'question' ? record.questionState === 'open' : record.adoption === 'adopted');
  const isSelectableProposal = record => isProposal(record) && record.review === 'reviewed' && record.currency === 'current' && record.kind !== 'question' && record.adoption !== 'adopted';

  async function run(buttonId, errorId, action) {
    if (state.busy) return;
    state.busy = true; const controls = [...document.querySelectorAll('button,input,textarea,select')].map(el => [el, el.disabled]);
    for (const [el] of controls) el.disabled = true;
    error(errorId);
    try { await action(); }
    catch (e) { error(errorId, e?.message || 'İşlem tamamlanamadı. Girdiğin metin korunuyor.'); }
    finally { state.busy = false; for (const [el, disabled] of controls) if (el.isConnected) el.disabled = disabled; readiness(); }
  }
  function readiness() {
    $('context-copy').disabled = state.busy || !state.packet || !$('context-consent').checked;
    $('reply-save').disabled = state.busy || !state.packet || !$('reply-consent').checked || !$('reply-text').value.trim();
    $('migration-apply').disabled = state.busy || !state.migration || !$('migration-consent').checked || !state.migration.candidates?.length;
    $('bulk-apply').disabled = state.busy || !state.bulk || !$('bulk-consent').checked || !(state.bulk.topics?.some(t => t.newLinkCount > 0) || state.bulk.candidateCount > 0);
    $('restore-apply').disabled = state.busy || !$('restore-consent').checked || !$('restore-backup').value;
    show('context-service-link', Boolean(state.packet && $('context-consent').checked && targets[state.packet.target]?.[1]));
    const queued = filteredQueue();
    $('review-open-first').disabled = state.busy || !queued.length; $('review-prev').disabled = state.busy || state.queuePage === 0; $('review-next').disabled = state.busy || (state.queuePage + 1) * 20 >= queued.length;
  }
  async function refresh() {
    state.data = await call('records-list');
    for (const field of ['topics', 'records', 'packets', 'replies', 'backups']) if (!Array.isArray(state.data[field])) throw Error('Yerel konu defteri eksik yanıt verdi: ' + field);
    if (state.data.conversationLinks === undefined) state.data.conversationLinks = [];
    if (!Array.isArray(state.data.conversationLinks)) throw Error('Yerel konu bağlantıları geçersiz.');
    if (!state.data.topics.some(t => t.id === state.topicId)) state.topicId = state.data.topics[0]?.id || '';
    renderTopics(); renderTopic(); renderGlobal(); renderBackups();
  }
  function renderTopics() {
    text('topic-count', visibleTopics().length); text('pending-count', state.data.records.filter(r => r.review === 'pending').length);
    text('review-nav-count', state.data.records.filter(r => r.review === 'pending').length);
    $('nav-overview').setAttribute('aria-current', state.screen === 'overview' ? 'page' : 'false'); $('nav-review').setAttribute('aria-current', state.screen === 'review' ? 'page' : 'false');
    const list = $('topic-list'); list.replaceChildren();
    if (!state.data.topics.length) list.append(node('p', 'Henüz konu yok. İlk konunu yukarıdan oluştur.', 'small'));
    const search = $('topic-search').value.trim().toLocaleLowerCase('tr-TR'), topics = visibleTopics().filter(topic => !search || topic.title.toLocaleLowerCase('tr-TR').includes(search));
    if (state.data.topics.length && !topics.length) list.append(node('p', 'Bu aramada konu bulunamadı.', 'small'));
    for (const topic of topics) {
      const records = state.data.records.filter(r => r.topicId === topic.id), button = node('button', null, 'topic-item'); button.type = 'button'; button.dataset.topicId = topic.id; button.setAttribute('aria-current', String(state.screen === 'topic' && topic.id === state.topicId));
      button.append(node('strong', topic.title), node('span', records.filter(isCurrent).length + ' güncel · ' + records.filter(r => r.review === 'pending').length + ' bekleyen · ' + state.data.conversationLinks.filter(link => link.topicId === topic.id).length + ' konuşma'));
      button.onclick = () => selectTopic(topic.id); list.append(button);
    }
    const previous = $('record-topic').value; $('record-topic').replaceChildren(...state.data.topics.map(t => option(t.id, t.title))); $('record-topic').value = state.data.topics.some(t => t.id === previous) ? previous : state.topicId;
  }
  function selectTopic(id) {
    if (state.busy || (state.screen === 'topic' && state.topicId === id)) return;
    state.topicId = id; state.screen = 'topic'; state.view = 'current'; state.conversationLimit = 20; state.recordLimit = 30; state.overviewLimits = { approved: 8, candidates: 8 }; $('topic-conversation-search').value = ''; show('record-editor', false); show('context-panel', false); show('reply-panel', false); invalidatePacket();
    history.replaceState(null, '', '/konular?topicId=' + encodeURIComponent(id)); renderTopics(); renderTopic(); renderGlobal();
  }
  function renderTopic() {
    const topic = currentTopic(); show('empty-topic', state.screen === 'topic' && !topic); show('topic-view', state.screen === 'topic' && Boolean(topic));
    if (!topic) { show('commentaries-panel', false); return; }
    text('topic-title', topic.title); text('topic-description', topic.goal || 'Bu konu için henüz amaç yazılmadı.');
    const records = topicRecords(), current = records.filter(isCurrent), decisions = current.filter(r => r.kind === 'decision'), questions = records.filter(r => r.kind === 'question' && r.questionState === 'open' && r.review === 'reviewed' && r.currency === 'current');
    text('topic-summary', decisions.length + ' güncel karar · ' + current.filter(r => r.kind === 'opinion').length + ' güncel görüş · ' + questions.length + ' açık soru · ' + records.filter(r => r.review === 'pending').length + ' incelenecek kayıt');
    for (const view of ['current', 'pending', 'all']) $('view-' + view).setAttribute('aria-pressed', String(state.view === view));
    const selected = records.filter(r => state.view === 'all' || (state.view === 'pending' ? r.review === 'pending' : isCurrent(r))).sort((a, b) => String(b.updatedAt || b.createdAt).localeCompare(String(a.updatedAt || a.createdAt)));
    const list = $('record-list'); list.replaceChildren();
    if (!selected.length) list.append(node('p', state.view === 'current' ? (state.data.conversationLinks.some(link => link.topicId === topic.id) || records.length ? 'Henüz güncel olarak işaretlenmiş bir kayıt yok. Önceki onaylarını, kaynak adaylarını ve bağlı konuşmalarını aşağıda bulabilirsin.' : 'Henüz incelenmiş güncel kayıt yok. Bekleyen kayıtlarını incele veya konuşmandan bir alıntı ekle.') : 'Bu görünümde kayıt yok.', 'small'));
    for (const record of selected.slice(0, state.recordLimit)) {
      const article = node('article', null, 'record-card'); article.dataset.recordId = record.id;
      const meta = node('div', null, 'record-meta');
      for (const [value, warning] of [[labels.kind[record.kind], false], [labels.review[record.review], record.review !== 'reviewed'], [labels.adoption[record.adoption], false], [labels.currency[record.currency], record.currency !== 'current'], [labels.priority[record.priority], false]]) meta.append(node('span', value, 'badge' + (warning ? ' warning' : '')));
      if (record.kind === 'question') meta.append(node('span', record.questionState === 'closed' ? 'Soru kapalı' : record.review === 'reviewed' && record.currency === 'current' ? 'Soru açık' : 'Açıklığı incelenecek', 'badge'));
      article.append(meta, node('h3', record.text)); if (record.reason) article.append(node('p', record.reason, 'reason'));
      if (record.answersQuestionId) { const question = state.data.records.find(r => r.id === record.answersQuestionId); if (question) { const link = node('button', 'Yanıt olduğu soru: ' + question.text, 'quiet'); link.onclick = () => editRecord(question); article.append(link); } }
      const foot = node('div', null, 'record-foot'), edit = node('button', 'Kaynağıyla incele', 'quiet'); edit.dataset.editRecord = record.id; edit.onclick = () => editRecord(record);
      foot.append(node('p', (isProposal(record) ? 'İfade: AI önerisi' : record.source ? 'Kaynak bağlı' : 'Kendi yazdığın kayıt') + ' · v' + record.revision + ' · ' + date(record.updatedAt || record.createdAt), 'small'), edit); article.append(foot);
      const latest = record.history?.at(-1); if (latest?.changeReason) article.append(node('p', 'Son değişiklik: ' + latest.changeReason, 'small'));
      list.append(article);
    }
    if (selected.length > state.recordLimit) { const more = node('button', 'Daha fazla kayıt göster · ' + (selected.length - state.recordLimit) + ' kayıt daha', 'quiet overview-more'); more.id = 'records-more'; more.onclick = () => { state.recordLimit += 30; renderTopic(); }; list.append(more); }
    const packets = state.data.packets.filter(p => p.topicId === topic.id).sort((a, b) => String(b.createdAt).localeCompare(String(a.createdAt)) || a.id.localeCompare(b.id));
    if (packets.length) {
      const saved = node('details'), choices = node('div', null, 'packet-list'); saved.append(node('summary', 'Kayıtlı devam metinleri · ' + packets.length));
      for (const packet of packets) {
        const open = node('button', (targets[packet.target]?.[0] || packet.target) + ' · ' + date(packet.createdAt) + ' · ' + packet.recordIds.length + ' kayıt · ' + packet.id.slice(0, 8), 'quiet');
        open.dataset.savedPacket = packet.id; open.onclick = () => { openContext(); displayPacket(packet); }; choices.append(open);
      }
      saved.append(choices); list.append(saved);
    }
    const questionsList = $('open-questions-list'); questionsList.replaceChildren(); show('open-questions-panel', state.view === 'current' && questions.length > 0);
    for (const question of questions) { const row = node('article', null, 'record-card'), open = node('button', 'Soruyu incele', 'quiet'), answer = node('button', 'Yanıt adayı yaz', 'secondary'); row.append(node('p', question.text), node('p', labels.review[question.review] + ' · ' + labels.currency[question.currency], 'small')); open.onclick = () => editRecord(question); answer.onclick = () => { newRecord(); $('record-answer-question').value = question.id; }; row.append(open, answer); questionsList.append(row); }
    renderOverview(records); renderConversationLinks(); renderReplies();
  }
  const sourceTime = record => record.source?.timestamp || record.legacy?.source?.timestamp || null;
  const descendingSource = (a, b) => String(sourceTime(b) || '').localeCompare(String(sourceTime(a) || '')) || String(b.updatedAt || b.createdAt || '').localeCompare(String(a.updatedAt || a.createdAt || '')) || a.id.localeCompare(b.id);
  function sourceLink(conversationId, messageId, title) {
    const link = node('a', title, 'quiet'); link.href = '/calisma?conversationId=' + encodeURIComponent(conversationId) + (messageId ? '&messageId=' + encodeURIComponent(messageId) : ''); return link;
  }
  function overviewRecord(record, group) {
    const article = node('article', null, 'record-card record-summary'); article.dataset.overviewRecord = record.id;
    const kind = labels.kind[record.kind] + (record.review === 'pending' ? ' adayı' : '');
    article.append(node('span', kind, 'badge'), node('h4', record.text));
    article.append(node('p', group === 'approved' ? 'Önceki onayın korunuyor · Güncelliği henüz belirtilmedi' : 'İnceleme bekliyor · ' + (record.kind === 'question' ? 'Hâlâ açık olup olmadığı doğrulanmadı' : 'Benimseme ve güncellik doğrulanmadı'), 'small'));
    const source = record.source, provenance = isProposal(record) ? 'AI yorumu; kaynak konuşmacısından ayrı' : source ? roleName(source.role) : 'Kendi yazdığın kayıt';
    article.append(node('p', provenance + (source ? ' · Kaynak zamanı: ' + date(sourceTime(record)) : ' · Kayıt zamanı: ' + date(record.createdAt)), 'small source-time'));
    if (record.reason) article.append(node('p', record.reason, 'small'));
    const actions = node('div', null, 'actions'), edit = node('button', 'Kaynağıyla incele', 'quiet'); edit.dataset.overviewEdit = record.id; edit.onclick = () => editRecord(record); actions.append(edit);
    if (source?.conversationId) actions.append(sourceLink(source.conversationId, source.messageId, 'Konuşmaya dön ↗'));
    article.append(actions); return article;
  }
  function renderOverview(records) {
    const groups = [
      ['approved', 'prior-approved', records.filter(r => r.review === 'reviewed' && r.adoption === 'adopted' && r.currency === 'unknown')],
      ['candidates', 'source-candidates', records.filter(r => r.review === 'pending' && r.source)]
    ];
    for (const [group, prefix, values] of groups) {
      const sorted = values.sort(descendingSource), list = $(prefix + '-list'); list.replaceChildren(); show(prefix + '-panel', state.view === 'current' && sorted.length > 0);
      for (const record of sorted.slice(0, state.overviewLimits[group])) list.append(overviewRecord(record, group));
      if (sorted.length > state.overviewLimits[group]) {
        const more = node('button', 'Daha fazla göster · ' + (sorted.length - state.overviewLimits[group]) + ' kayıt daha', 'quiet overview-more'); more.dataset.overviewMore = group; more.onclick = () => { state.overviewLimits[group] += 8; renderOverview(records); }; list.append(more);
      }
    }
  }
  function leaveWorkingPanels() {
    invalidatePacket(); state.selected.clear(); state.editing = null; state.source = null;
    show('record-editor', false); show('context-panel', false); show('reply-panel', false);
  }
  function selectGlobal(screen) {
    if (state.busy) return;
    leaveWorkingPanels(); state.screen = screen;
    history.replaceState(null, '', '/konular' + (screen === 'review' ? '?view=review' : ''));
    renderTopics(); renderTopic(); renderGlobal();
  }
  function openGlobalRecord(record) {
    if (state.busy) return;
    leaveWorkingPanels(); state.topicId = record.topicId;
    renderTopics(); renderTopic(); renderGlobal(); editRecord(record);
    history.replaceState(null, '', '/konular?view=' + state.screen + '&topicId=' + encodeURIComponent(record.topicId) + '&recordId=' + encodeURIComponent(record.id));
  }
  function globalRecord(record) {
    const article = node('article', null, 'record-card global-record-card'); article.dataset.globalRecord = record.id;
    article.append(node('p', topicName(record.topicId), 'topic-name'));
    const meta = node('div', null, 'record-meta');
    for (const key of ['kind', 'review', 'adoption', 'currency', 'priority']) meta.append(node('span', labels[key][record[key]], 'badge' + ((key === 'review' && record.review === 'pending') || (key === 'currency' && record.currency !== 'current') ? ' warning' : '')));
    if (record.kind === 'question') meta.append(node('span', record.questionState === 'closed' ? 'Soru kapalı' : isCurrent(record) ? 'Soru açık' : 'Hâlâ açık olup olmadığı incelenecek', 'badge warning'));
    article.append(meta, node('h3', record.text));
    if (record.reason) article.append(node('p', record.reason, 'small'));
    const source = record.source;
    article.append(node('p', (isProposal(record) ? 'İfade: AI yorumu · ' : '') + (source ? 'Kaynak: ' + roleName(source.role || source.speaker) + ' · Kaynak zamanı: ' + date(sourceTime(record)) : 'Kendi yazdığın kayıt · ' + date(record.createdAt)), 'small'));
    if (source?.excerpt) {
      const details = node('details'), summary = node('summary', 'Kaynak alıntısı');
      details.append(summary, node('blockquote', source.excerpt, 'source-excerpt')); article.append(details);
    }
    const actions = node('div', null, 'actions'), edit = node('button', 'Kaynağıyla incele', 'secondary'), topic = node('button', 'Konuyu aç', 'quiet');
    edit.dataset.globalEdit = record.id; edit.onclick = () => openGlobalRecord(record); topic.dataset.globalTopic = record.topicId; topic.onclick = () => selectTopic(record.topicId); actions.append(edit, topic);
    if (source?.conversationId) actions.append(sourceLink(source.conversationId, source.messageId, 'Özgün mesaja dön ↗'));
    article.append(actions); return article;
  }
  const knownTime = value => value && Number.isFinite(Date.parse(value)) ? Date.parse(value) : 0;
  const linkTime = link => knownTime(link.sourceUpdatedAt) || knownTime(link.lastUserSource?.timestamp) || knownTime(link.sourceCreatedAt);
  function resumeCard(link) {
    const article = node('article', null, 'conversation-link-card global-resume-card'); article.dataset.globalResume = link.id;
    article.append(node('p', topicName(link.topicId), 'topic-name'));
    if (link.subtopicTitle) article.append(node('p', link.subtopicTitle, 'badge subtopic-badge'));
    article.append(node('h4', link.title || 'Başlıksız konuşma'), node('p', (link.provider || 'Kaynak belirtilmedi') + ' · Konuşma kaynak zamanı: ' + date(linkTime(link) || null), 'small'));
    const source = link.lastUserSource;
    if (source) article.append(node('p', 'Seçili daldaki son kullanıcı sözü · ' + date(source.timestamp), 'small'), node('blockquote', source.excerpt));
    else article.append(node('p', 'Gösterilebilecek son kullanıcı sözü belirlenemedi. Kaynak konuşmayı açabilirsin.', 'small'));
    if (link.warning) article.append(node('p', link.warning, 'small warning'));
    if (link.classificationReason) article.append(node('p', 'Konu önerisinin dayanağı: ' + link.classificationReason, 'small'));
    const actions = node('div', null, 'actions'), open = node('button', 'Bu konuda kaldığım yere dön', 'secondary'); open.dataset.resumeTopic = link.topicId; open.onclick = () => selectTopic(link.topicId);
    actions.append(open, sourceLink(link.conversationId, source?.messageId, 'Kaldığım mesajı aç ↗')); article.append(actions); return article;
  }
  function dashboardGroup(key, values, makeCard, empty) {
    const list = $('global-' + key); list.replaceChildren();
    for (const value of values.slice(0, state.dashboardLimits[key])) list.append(makeCard(value));
    if (!values.length) list.append(node('p', empty, 'small global-overview-empty'));
    if (values.length > state.dashboardLimits[key]) {
      const more = node('button', 'Daha fazla göster · ' + (values.length - state.dashboardLimits[key]) + ' kayıt daha', 'quiet overview-more'); more.dataset.globalMore = key;
      more.onclick = () => { if (state.busy) return; state.dashboardLimits[key] += 6; renderGlobal(); }; list.append(more);
    }
  }
  function renderGlobal() {
    show('global-overview', state.screen === 'overview'); show('global-review', state.screen === 'review');
    const pending = pendingRecords(); text('review-nav-count', pending.length);
    if (state.screen === 'overview') {
      const decisions = state.data.records.filter(record => record.kind === 'decision' && isCurrent(record)).sort(descendingSource);
      const opinions = state.data.records.filter(record => record.kind === 'opinion' && record.review === 'reviewed' && record.adoption === 'adopted').sort((a, b) => ({current: 0, unknown: 1, superseded: 2}[a.currency] - {current: 0, unknown: 1, superseded: 2}[b.currency]) || descendingSource(a, b));
      const latestByTopic = new Map();
      for (const link of [...state.data.conversationLinks].sort((a, b) => linkTime(b) - linkTime(a) || a.id.localeCompare(b.id))) if (!latestByTopic.has(link.topicId)) latestByTopic.set(link.topicId, link);
      text('global-summary', visibleTopics().length + ' konu · ' + state.data.conversationLinks.length + ' bağlı konuşma · ' + opinions.length + ' onaylı görüş · ' + decisions.length + ' güncel karar');
      text('global-pending-summary', pending.length ? pending.length + ' kayıt inceleme bekliyor. Kaynaklarını görüp neyi benimsediğini ve neyin hâlâ güncel olduğunu ayrı ayrı belirleyebilirsin.' : 'İnceleme bekleyen kayıt yok. Konularındaki önceki onayları ve kaynaklarını aşağıdan açabilirsin.');
      dashboardGroup('decisions', decisions, globalRecord, 'Henüz güncel, incelenmiş ve benimsenmiş bir karar yok. Önceki kaynak ifadeleri bu duruma otomatik geçirilmez.');
      const decisionCandidates = pending.filter(record => record.kind === 'decision').length; show('global-decision-candidates', decisionCandidates > 0); text('global-decision-candidates', decisionCandidates + ' karar adayını kaynağıyla incele');
      dashboardGroup('opinions', opinions, globalRecord, 'Henüz incelenip benimsenmiş bir görüş yok. İnceleme bekleyen adayları kaynağıyla açabilirsin.');
      dashboardGroup('resume', [...latestByTopic.values()], resumeCard, 'Henüz bağlı konuşma yok. Mevcut konuşmalarını yukarıdaki toplu aktarım alanından bağlayabilir veya konu oluşturabilirsin.');
    }
    if (state.screen === 'review') renderReviewQueue();
  }
  function filteredQueue() {
    const topicId = $('review-topic-filter').value, kind = $('review-kind-filter').value, search = $('review-search').value.trim().toLocaleLowerCase('tr-TR');
    return pendingRecords().filter(record => (!topicId || record.topicId === topicId) && (!kind || record.kind === kind) && (!search || [record.text, record.reason, record.source?.excerpt, record.source?.title, topicName(record.topicId)].join(' ').toLocaleLowerCase('tr-TR').includes(search))).sort(descendingSource);
  }
  function renderSourceChecks() {
    const links = state.data.conversationLinks.filter(link => link.warning || !link.lastUserSource).sort((a, b) => linkTime(b) - linkTime(a) || a.id.localeCompare(b.id));
    show('review-source-checks', links.length > 0); text('review-source-count', links.length + ' konuşma');
    const list = $('review-source-list'); list.replaceChildren();
    for (const link of links.slice(0, state.sourceCheckLimit)) {
      const article = node('article', null, 'conversation-link-card global-resume-card'); article.dataset.sourceCheck = link.id;
      article.append(node('p', topicName(link.topicId), 'topic-name'), node('h4', link.title || 'Başlıksız konuşma'), node('p', (link.provider || 'Kaynak belirtilmedi') + ' · Konuşma kaynak zamanı: ' + date(linkTime(link) || null), 'small'));
      if (link.subtopicTitle) article.append(node('p', link.subtopicTitle, 'badge subtopic-badge'));
      article.append(node('p', link.warning || 'Son kullanıcı sözü belirlenemedi. Konuşmanın kaynak içeriğini ve seçili dalını kontrol et.', 'small warning'));
      const actions = node('div', null, 'actions'), open = node('button', 'Konuyu aç', 'quiet'); open.onclick = () => selectTopic(link.topicId);
      actions.append(sourceLink(link.conversationId, link.lastUserSource?.messageId, 'Kaynak konuşmayı kontrol et ↗'), open); article.append(actions); list.append(article);
    }
    show('review-source-more', links.length > state.sourceCheckLimit); text('review-source-more', 'Daha fazla konuşma göster · ' + Math.max(0, links.length - state.sourceCheckLimit) + ' konuşma daha');
  }
  function renderReviewQueue() {
    renderSourceChecks();
    const previous = $('review-topic-filter').value;
    $('review-topic-filter').replaceChildren(option('', 'Tüm konular'), ...visibleTopics().map(topic => option(topic.id, topic.title)));
    $('review-topic-filter').value = state.data.topics.some(topic => topic.id === previous) ? previous : '';
    const queued = filteredQueue(), pageCount = Math.max(1, Math.ceil(queued.length / 20)); state.queuePage = Math.min(state.queuePage, pageCount - 1);
    const start = state.queuePage * 20, list = $('review-queue-list'); list.replaceChildren();
    for (const record of queued.slice(start, start + 20)) list.append(globalRecord(record));
    if (!queued.length) list.append(node('p', pendingRecords().length ? 'Bu filtrelerde inceleme bekleyen kayıt yok. Konu, tür veya arama filtresini değiştirebilirsin.' : 'İnceleme kuyruğun boş. İncelemelerin kayıtların durumlarını belirler; kaynak metinleri korunur.', 'small global-overview-empty'));
    text('review-result-count', (queued.length ? start + 1 + '–' + Math.min(start + 20, queued.length) : '0') + ' / ' + queued.length + ' eşleşen kayıt · ' + pendingRecords().length + ' toplam bekleyen');
    text('review-page-status', 'Sayfa ' + (state.queuePage + 1) + ' / ' + pageCount); readiness();
  }
  function renderConversationLinks() {
    const all = state.data.conversationLinks.filter(link => link.topicId === state.topicId);
    show('topic-conversations-panel', all.length > 0);
    const search = $('topic-conversation-search').value.trim().toLocaleLowerCase('tr-TR');
    const filtered = all.filter(link => !search || (link.title + ' ' + link.provider + ' ' + (link.subtopicTitle || '')).toLocaleLowerCase('tr-TR').includes(search)).sort((a, b) => String(b.sourceUpdatedAt || b.lastUserSource?.timestamp || b.sourceCreatedAt || '').localeCompare(String(a.sourceUpdatedAt || a.lastUserSource?.timestamp || a.sourceCreatedAt || '')) || a.id.localeCompare(b.id));
    text('topic-conversations-count', filtered.length + ' / ' + all.length + ' konuşma');
    const list = $('topic-conversation-list'); list.replaceChildren();
    const visible = filtered.slice(0, state.conversationLimit), groups = new Map();
    for (const link of visible) { const key = link.subtopicTitle || 'Diğer konuşmalar'; if (!groups.has(key)) groups.set(key, []); groups.get(key).push(link); }
    for (const [subtopic, links] of groups) {
      if (filtered.some(link => link.subtopicTitle)) list.append(node('h4', subtopic + ' · ' + filtered.filter(link => (link.subtopicTitle || 'Diğer konuşmalar') === subtopic).length + ' konuşma', 'subtopic-heading'));
    for (const link of links) {
      const article = node('article', null, 'conversation-link-card'); article.dataset.conversationLink = link.id;
      const source = link.lastUserSource;
      if (link.subtopicTitle) article.append(node('p', link.subtopicTitle, 'badge subtopic-badge'));
      article.append(node('h4', link.title || 'Başlıksız konuşma'), node('p', (link.provider || 'Kaynak belirtilmedi') + ' · Konuşma kaynak zamanı: ' + date(link.sourceUpdatedAt || link.sourceCreatedAt), 'small'));
      if (source) article.append(node('p', 'Seçili daldaki son kullanıcı sözü · ' + date(source.timestamp), 'small'), node('blockquote', source.excerpt));
      else article.append(node('p', 'Bu konuşmada gösterilebilecek kullanıcı sözü belirlenemedi. Özgün konuşmayı açabilirsin.', 'small'));
      if (link.warning) article.append(node('p', link.warning, 'small warning'));
      if (link.classificationReason) article.append(node('p', 'Konu önerisinin dayanağı: ' + link.classificationReason, 'small'));
      const actions = node('div', null, 'actions'); actions.append(sourceLink(link.conversationId, source?.messageId, 'Kaldığım mesajı aç ↗'));
      if (source) { const candidate = node('button', 'Bu alıntıdan aday oluştur', 'quiet'); candidate.dataset.linkCandidate = link.id; candidate.onclick = () => newRecord({ conversationId: link.conversationId, messageId: source.messageId, excerpt: source.excerpt }, source.excerpt, link.title, source.role); actions.append(candidate); }
      article.append(actions); list.append(article);
    }
    }
    if (!filtered.length) list.append(node('p', 'Bu aramada konuşma bulunamadı.', 'small'));
    show('topic-conversations-more', filtered.length > state.conversationLimit);
  }
  async function previewBulk() {
    const preview = await call('records-bulk-preview'); state.bulk = preview; $('bulk-consent').checked = false;
    const list = $('bulk-topic-list'); list.replaceChildren();
    for (const topic of preview.topics || []) {
      const row = node('article', null, 'bulk-topic-row'); row.append(node('h3', topic.title), node('p', topic.conversationCount + ' konuşma · ' + topic.newLinkCount + ' yeni bağlantı', 'small'), node('p', topic.candidateCount + ' inceleme adayı', 'small')); list.append(row);
    }
    text('bulk-summary', preview.conversationCount + ' konuşma incelendi · ' + preview.linkedCount + ' yeni bağlantı · ' + preview.candidateCount + ' yeni aday · ' + preview.alreadyLinked + ' önceden bağlı konuşma');
    const warnings = $('bulk-warnings'); warnings.replaceChildren(...(preview.warnings || []).map(w => node('li', w)));
    text('bulk-status', 'Önizleme hazır. Konuşmaların değişmez; onayından sonra konu defterine bağlantılar ve incelenmemiş adaylar eklenir.'); show('bulk-preview-panel', true); readiness();
  }
  function setSource(source, original, title, role) {
    state.source = source ? { ...source, original, title, role } : null;
    show('record-source', Boolean(source)); show('excerpt-field', Boolean(source));
    text('source-original', original || ''); text('source-title', title || ''); text('source-role', roleName(role));
    show('source-backlink', Boolean(source?.conversationId));
    if (source?.conversationId) $('source-backlink').href = '/calisma?conversationId=' + encodeURIComponent(source.conversationId) + '&messageId=' + encodeURIComponent(source.messageId);
    $('record-excerpt').value = source?.excerpt || original || '';
    text('record-attribution', source ? role === 'assistant' ? 'Bu kaynak bir AI yanıtı. Oluşturduğun aday, sen ayrıca inceleyip benimsemeden görüşün veya kararın sayılmaz.' : 'Özgün kaynak ile kayda geçecek ifaden ayrı tutulur. Alıntıyı değiştirmek kaynak mesajını değiştirmez.' : 'Bu metni kendin yazıyorsun. İlk kayıt bir adaydır; durumlarını ayrıca inceleyerek belirle.');
  }
  function newRecord(source = null, original = '', title = '', role = '') {
    if (state.busy || !state.data.topics.length) { if (!state.data.topics.length) { show('new-topic-form', true); $('topic-name').focus(); text('page-status', 'Önce bu kayıt için bir konu oluştur.'); } return; }
    state.editing = null; $('record-form').reset(); error('record-error'); setSource(source, original, title, role);
    $('record-topic').value = state.topicId; $('record-topic').disabled = false; $('record-kind').disabled = false;
    renderAnswerQuestions(); show('answer-question-field', true);
    $('record-text').value = source?.excerpt || original || ''; text('record-heading', 'Yeni kayıt adayı'); text('record-save', 'Aday olarak kaydet');
    show('record-review-fields', false); show('change-reason-field', false); show('record-history', false); show('question-close-panel', false); show('record-editor', true); updateKind(); $('record-editor').scrollIntoView({ block: 'start', behavior: 'smooth' });
  }
  function updateKind() {
    const question = $('record-kind').value === 'question'; show('adoption-field', !question); show('question-note', question);
    show('answer-question-field', !question && !state.editing);
    $('record-adoption').querySelector('[value="not_applicable"]').disabled = !question;
    if (question) $('record-adoption').value = 'not_applicable';
  }
  function renderAnswerQuestions() {
    const prior = $('record-answer-question').value; $('record-answer-question').replaceChildren(option('', 'Bir soruya bağlı değil'));
    for (const r of state.data.records.filter(r => r.topicId === $('record-topic').value && r.kind === 'question' && r.questionState === 'open' && r.review === 'reviewed' && r.currency === 'current')) $('record-answer-question').append(option(r.id, r.text));
    $('record-answer-question').value = prior;
  }
  function editRecord(record) {
    if (state.busy) return;
    newRecord(); state.editing = record; $('record-topic').value = record.topicId; $('record-topic').disabled = true; $('record-kind').value = record.kind; $('record-kind').disabled = true;
    $('record-text').value = record.text; $('record-reason').value = record.reason || ''; $('record-change-reason').value = '';
    for (const key of ['review', 'adoption', 'currency', 'priority']) $('record-' + key).value = record[key];
    text('record-heading', labels.kind[record.kind] + ' · kaynakla birlikte incele'); text('record-save', 'İncelemeyi ve değişikliği kaydet');
    show('record-review-fields', true); show('change-reason-field', true); show('excerpt-field', false);
    const source = record.source;
    setSource(source, source?.originalText || source?.excerpt || '', source?.title || source?.conversationTitle || 'Kaynak kimliği: ' + (source?.messageId || source?.replyId || record.id), source?.role || source?.speaker || (isProposal(record) ? 'assistant' : 'user'));
    show('excerpt-field', false); text('record-attribution', isProposal(record) ? 'Bu ifade bir AI yorumudur. Kaynağın konuşmacısı yukarıda ayrıca korunur; benimseme seçimin bunları değiştirmez.' : record.source ? 'Kaynak alıntısı korunur. Aşağıdaki ifade ve incelemen, özgün mesajdan ayrıdır.' : 'Kendi yazdığın kaydı inceliyorsun. Her değişiklik gerekçesiyle geçmişe kaydedilir.');
    const question = record.kind === 'question'; show('question-close-panel', question); text('question-state', record.questionState === 'closed' ? 'Bu soru kullanıcı kararıyla kapatıldı.' : record.review === 'reviewed' && record.currency === 'current' ? 'Bu soru açık. Yanıt kaydetmek soruyu kendiliğinden kapatmaz.' : 'Bu soru bir inceleme adayı. Hâlâ açık olup olmadığını kontrol et; yeni yanıt kaydetmek onu kendiliğinden kapatmaz.');
    $('question-close-consent').checked = false; $('question-close-consent').disabled = record.questionState === 'closed'; $('question-close-reason').value = ''; $('question-close-reason').disabled = record.questionState === 'closed';
    updateKind(); renderHistory(record);
  }
  function renderHistory(record) {
    const list = $('history-list'); list.replaceChildren(); show('record-history', Boolean(record.history?.length || record.legacy));
    for (const item of [...(record.history || [])].reverse()) {
      const previous = item.previous || item.snapshot || item, article = node('article', null, 'history-entry');
      article.append(node('p', 'Önceki kayıt · v' + (previous.revision ?? '?') + ' · ' + date(item.changedAt || item.createdAt), 'small'), node('pre', previous.text || ''), node('p', 'Değişiklik gerekçesi: ' + (item.changeReason || 'Belirtilmedi')));
      article.append(node('p', [labels.review[previous.review], labels.adoption[previous.adoption], labels.currency[previous.currency], labels.priority[previous.priority]].filter(Boolean).join(' · '), 'small')); list.append(article);
    }
    if (record.legacy) {
      const legacy = record.legacy, oldStatuses = { confirmed: 'Onaylanmış', uncertain: 'Kararsız', rejected: 'Reddedilmiş', draft: 'Taslak' };
      list.append(node('h3', 'Eski görüş defterinden korunan kayıt'), node('p', 'Eski kart v' + legacy.revision + ' · ' + (oldStatuses[legacy.status] || legacy.status), 'small'), node('pre', legacy.statement));
      for (const item of [...(legacy.history || [])].reverse()) { const row = node('article', null, 'history-entry'); row.append(node('p', 'Eski kart v' + item.revision + ' · ' + (oldStatuses[item.status] || item.status) + ' · ' + date(item.changedAt), 'small'), node('pre', item.statement), node('p', item.changeReason || 'Değişiklik gerekçesi belirtilmedi.')); list.append(row); }
    }
  }
  async function saveRecord() {
    const recordText = $('record-text').value.trim(); if (!recordText) throw Error('Kayda geçecek ifadeyi yaz.');
    let result;
    if (state.editing) {
      const record = state.editing, closing = record.kind === 'question' && record.questionState !== 'closed' && $('question-close-consent').checked;
      let changeReason = $('record-change-reason').value.trim(); if (!changeReason) throw Error('İnceleme veya değişiklik gerekçesini yaz.');
      if (closing) { const reason = $('question-close-reason').value.trim(); if (!reason) throw Error('Soruyu kapatma gerekçeni yaz.'); changeReason += '\nSoruyu kapatma kararım: ' + reason; }
      const body = { id: record.id, expectedRevision: record.revision, expectedTopicId: record.topicId, text: recordText, reason: $('record-reason').value.trim(), review: $('record-review').value, adoption: record.kind === 'question' ? 'not_applicable' : $('record-adoption').value, currency: $('record-currency').value, priority: $('record-priority').value, questionState: record.kind === 'question' ? closing ? 'closed' : record.questionState : 'not_applicable', changeReason, confirmedByUser: true };
      try { result = await call('records-review', body); }
      catch (e) {
        if (e.message?.includes('Kaydın konusu değişmiş')) { await refresh(); throw Error(e.message + '. Girdiğin metin korunuyor; yeni konusunu ve kaynağını görmek için kaydı yeniden aç.'); }
        throw e;
      }
    } else {
      const body = { topicId: $('record-topic').value, kind: $('record-kind').value, text: recordText, reason: $('record-reason').value.trim() };
      if (body.kind !== 'question' && $('record-answer-question').value) body.answersQuestionId = $('record-answer-question').value;
      if (!body.topicId) throw Error('Bir konu seç.');
      if (state.source) {
        const excerpt = $('record-excerpt').value; if (!excerpt.trim() || !state.source.original.includes(excerpt)) throw Error('Alıntı, yukarıdaki özgün kaynakta birebir bulunmalı. Kaynak kontrolü kaldırılmadı.');
        body.source = state.source.replyId ? { replyId: state.source.replyId, excerpt } : { conversationId: state.source.conversationId, messageId: state.source.messageId, excerpt };
      }
      result = await mutation('records-create', body); state.topicId = body.topicId;
    }
    invalidatePacket(); await refresh(); show('record-editor', false); state.editing = null; state.source = null;
    state.view = result.record?.review === 'pending' ? 'pending' : 'current'; renderTopic(); renderGlobal(); if (state.screen !== 'topic') history.replaceState(null, '', '/konular' + (state.screen === 'review' ? '?view=review' : '')); text('page-status', 'Kayıt saklandı. Kaynak ve önceki hâller korunuyor.');
  }
  function invalidatePacket() {
    rememberReplyDraft();
    state.packet = null; $('context-consent').checked = false; $('reply-consent').checked = false;
    show('context-preview', false); show('reply-panel', false); text('context-copy-status', ''); readiness();
  }
  function rememberReplyDraft() {
    if (state.packet) state.replyDrafts.set(state.packet.id, { text: $('reply-text').value, format: $('reply-format').value });
  }
  function openContext() {
    if (!currentTopic()) return;
    state.selected = new Set(topicRecords().filter(r => isCurrent(r) && !['not_priority', 'paused'].includes(r.priority)).map(r => r.id)); $('context-include-ai').checked = false; invalidatePacket(); renderContextChoices(); show('context-panel', true); error('context-error'); $('context-panel').scrollIntoView({ block: 'start', behavior: 'smooth' });
  }
  function renderContextChoices() {
    const list = $('context-records'); list.replaceChildren();
    const records = topicRecords().filter(r => isCurrent(r) || ($('context-include-ai').checked && isSelectableProposal(r)));
    if (!records.length) list.append(node('p', 'Önce bu konudan bir kaydı incele ve güncelliğini açıkça belirle. Bir görüş veya karar için benimseme de gereklidir.', 'small'));
    for (const record of records) {
      const row = node('div', null, 'context-choice'), checkbox = document.createElement('input'), label = node('label'); checkbox.type = 'checkbox'; checkbox.id = 'context-record-' + record.id; checkbox.dataset.contextRecord = record.id; checkbox.checked = state.selected.has(record.id); label.htmlFor = checkbox.id;
      label.append(node('span', record.text), node('span', (isSelectableProposal(record) ? 'BENİMSENMEMİŞ AI ÖNERİSİ · ' : '') + labels.kind[record.kind] + ' · ' + labels.priority[record.priority] + ' · ' + record.id, 'small')); row.append(checkbox, label); list.append(row);
      checkbox.onchange = () => { if (checkbox.checked) state.selected.add(record.id); else state.selected.delete(record.id); invalidatePacket(); };
    }
  }
  async function prepareContext() {
    const selected = topicRecords().filter(r => state.selected.has(r.id));
    const recordIds = selected.filter(isCurrent).map(r => r.id), proposalIds = $('context-include-ai').checked ? selected.filter(isSelectableProposal).map(r => r.id) : [];
    if (!recordIds.length && !proposalIds.length) throw Error('En az bir uygun kayıt seç.');
    const { packet, findings } = await call('records-prepare', { topicId: state.topicId, recordIds, proposalIds, target: $('context-target').value, model: $('context-model').value.trim() || null, question: $('context-question').value.trim(), confirmedByUser: true });
    await refresh(); displayPacket(packet);
    if (findings?.length) text('context-copy-status', 'Özel bilgi olabilecek alanlar bulundu. Kopyalamadan önce tam metni kontrol et: ' + findings.map(f => typeof f === 'string' ? f : f.kind || f.type || 'özel bilgi').join(', '));
  }
  function displayPacket(packet) {
    rememberReplyDraft();
    const draft = state.replyDrafts.get(packet.id); $('reply-text').value = draft?.text || ''; $('reply-format').value = draft?.format || 'text'; error('reply-error');
    state.packet = packet; $('context-consent').checked = false; $('reply-consent').checked = false;
    const target = targets[packet.target] || [packet.target, null]; text('context-target-label', target[0] + ' hesabına götüreceğin metin' + (packet.model ? ' · ' + packet.model : ' · Model belirtilmedi')); text('context-prompt', packet.text);
    if (target[1]) $('context-service-link').href = target[1]; show('context-preview', true); show('reply-panel', true); text('reply-status', 'Bu yanıt ' + date(packet.createdAt) + ' tarihli devam metnine bağlanacak.');
    const stale = (packet.sources || []).some(source => state.data.records.find(r => r.id === source.recordId)?.revision !== source.revision);
    text('context-copy-status', stale ? 'Bu kayıtlı metin eski bir anlık görüntü: kaynak kayıtları sonradan değişmiş. Güncel bağlam için yeniden önizleme hazırla.' : 'Kayıtlı anlık görüntü · ' + date(packet.createdAt) + '. Kopyalamadan önce hedefi ve tam metni yeniden incele.');
    text('reply-schema', JSON.stringify({ commentary: 'AI yorumunun metni', citations: [{ sourceId: packet.sourceIds?.[0] || 'devam-metnindeki-kaynak-kimliği', quote: 'O kaynaktaki birebir alıntı' }] }, null, 2)); readiness();
  }
  async function saveReply() {
    if (!state.packet || !$('reply-consent').checked) throw Error('Önce devam metnini hazırla ve yanıt beyanını işaretle.');
    const rawText = $('reply-text').value; if (!rawText.trim()) throw Error('AI yanıtını yapıştır.');
    const { reply } = await mutation('records-reply', { packetId: state.packet.id, rawText, format: $('reply-format').value, confirmedByUser: true });
    await refresh();
    if (reply.validationStatus === 'invalid') { error('reply-error', reply.validationError || 'Yanıt veya kaynak atıfları geçersiz. Metin korunuyor; düzeltip yeniden kaydedebilirsin.'); text('reply-status', 'Bozuk yanıt da yerelde saklandı; bu yanıttan kayıt adayı oluşturulamaz.'); return; }
    text('reply-status', 'AI yorumu saklandı. Henüz hiçbir görüşün veya kararın değişmedi.'); $('reply-consent').checked = false;
  }
  function renderReplies() {
    const replies = state.data.replies.filter(r => r.topicId === state.topicId), list = $('commentary-list'); list.replaceChildren(); show('commentaries-panel', state.screen === 'topic' && Boolean(replies.length));
    for (const reply of [...replies].sort((a, b) => String(b.createdAt).localeCompare(String(a.createdAt)) || a.id.localeCompare(b.id))) {
      const article = node('article', null, 'commentary'); article.dataset.replyId = reply.id;
      const packet = state.data.packets.find(p => p.id === reply.packetId), label = reply.validationStatus === 'valid' ? 'Kaynak atıfları doğrulandı · yorumun doğruluğu onaylanmadı' : reply.validationStatus === 'invalid' ? 'Yanıt geçersiz · aday oluşturulamaz' : 'Düz metin · doğrulanmamış AI yorumu';
      article.append(node('p', (targets[packet?.target]?.[0] || packet?.target || 'Hizmet belirtilmedi') + ' · ' + date(reply.createdAt), 'small'), node('p', label, 'badge warning'), node('div', reply.commentary || reply.rawText, 'body'));
      if (reply.validationStatus === 'invalid') {
        article.append(node('p', reply.validationError || 'Yanıt yapısı veya atıfları geçersiz.', 'error'));
        const fix = node('button', 'Metni düzeltmek için aç', 'quiet'); fix.onclick = () => { if (!packet) return; openContext(); displayPacket(packet); $('reply-text').value = reply.rawText; $('reply-format').value = 'json'; $('reply-panel').scrollIntoView({ block: 'start' }); }; article.append(fix);
      } else {
        const convert = node('button', 'İçinden kayıt adayı seç', 'secondary'); convert.dataset.replyCandidate = reply.id; convert.onclick = () => newRecord({ replyId: reply.id }, reply.commentary || reply.rawText, 'Elle getirilen AI yorumu · ' + reply.id, 'assistant'); article.append(convert);
      }
      list.append(article);
    }
  }
  function renderBackups() {
    const previous = $('restore-backup').value; $('restore-backup').replaceChildren(option('', 'Geri dönülecek yedeği seç'));
    for (const backup of state.data.backups) { const id = typeof backup === 'string' ? backup : backup.id || backup.backupId; const item = option(id, (typeof backup === 'string' ? backup : date(backup.createdAt)) + ' · ' + id + (backup.valid === false ? ' · Geçersiz yedek' : '')); item.disabled = backup.valid === false; $('restore-backup').append(item); }
    $('restore-backup').value = previous; readiness();
  }
  async function previewMigration() {
    state.migration = await call('records-migration-preview'); $('migration-consent').checked = false;
    const list = $('migration-list'); list.replaceChildren();
    for (const candidate of state.migration.candidates || []) {
      const row = node('article', null, 'record-card'), record = candidate.record || candidate;
      row.append(node('h3', record.text || record.statement || record.title || candidate.id), node('p', 'İnceleme: ' + (labels.review[record.review] || record.status || 'Önceki onayı korunacak') + ' · Benimseme: ' + (labels.adoption[record.adoption] || 'Önceki beyanı korunacak') + ' · Güncellik: ' + (labels.currency[record.currency] || 'Belirtilmedi'), 'small'));
      if (record.source?.excerpt) row.append(node('pre', record.source.excerpt)); list.append(row);
    }
    show('migration-panel', true); text('maintenance-status', (state.migration.candidates?.length || 0) + ' eski kart aktarılabilir. Önceden eklenenler yeniden çoğaltılmaz.'); readiness();
  }
  async function loadSourceFromUrl() {
    const params = new URLSearchParams(location.search), conversationId = params.get('conversationId'), messageId = params.get('messageId');
    if (!conversationId || !messageId) return;
    const conversation = await call('conversation', { id: conversationId }), message = conversation.messages?.find(m => m.id === messageId);
    if (!message || !['user', 'assistant', 'human'].includes(message.role)) throw Error('Bu kaynak mesajı bulunamadı veya kullanıcı/AI konuşması değil.');
    if (!state.data.topics.length) { state.pendingSource = { conversation, message }; newRecord(); return; }
    newRecord({ conversationId, messageId }, message.text, conversation.title || 'Başlıksız konuşma', message.role);
  }

  for (const key of ['review', 'adoption', 'currency', 'priority']) $('record-' + key).replaceChildren(...Object.entries(labels[key]).map(([value, title]) => option(value, title)));
  $('new-topic-toggle').onclick = () => { const visible = $('new-topic-form').hidden; show('new-topic-form', visible); $('new-topic-toggle').setAttribute('aria-expanded', String(visible)); if (visible) $('topic-name').focus(); };
  $('new-topic-form').onsubmit = event => { event.preventDefault(); run('topic-save', 'topic-error', async () => {
    const title = $('topic-name').value.trim(); if (!title) throw Error('Konu adını yaz.');
    const { topic } = await mutation('records-topic-create', { title, goal: $('topic-purpose').value.trim() }); state.topicId = topic.id; state.screen = 'topic'; await refresh(); history.replaceState(null, '', '/konular?topicId=' + encodeURIComponent(topic.id)); $('new-topic-form').reset(); show('new-topic-form', false); $('new-topic-toggle').setAttribute('aria-expanded', 'false');
    text('page-status', 'Konu oluşturuldu. Konuşmadan alıntı ekleyebilir veya kendi kaydını yazabilirsin.');
    if (state.pendingSource) { const { conversation, message } = state.pendingSource; state.pendingSource = null; state.busy = false; newRecord({ conversationId: conversation.id, messageId: message.id }, message.text, conversation.title, message.role); }
  }); };
  $('nav-overview').onclick = () => selectGlobal('overview'); $('nav-review').onclick = () => selectGlobal('review'); $('overview-open-review').onclick = () => selectGlobal('review');
  $('global-decision-candidates').onclick = () => { if (state.busy) return; $('review-topic-filter').value = ''; $('review-kind-filter').value = 'decision'; $('review-search').value = ''; state.queuePage = 0; selectGlobal('review'); history.replaceState(null, '', '/konular?view=review&kind=decision'); };
  $('topic-search').oninput = renderTopics;
  for (const id of ['review-topic-filter', 'review-kind-filter', 'review-search']) $(id).addEventListener(id === 'review-search' ? 'input' : 'change', () => { state.queuePage = 0; renderReviewQueue(); });
  $('review-prev').onclick = () => { if (state.busy || state.queuePage === 0) return; state.queuePage--; renderReviewQueue(); };
  $('review-next').onclick = () => { if (state.busy || (state.queuePage + 1) * 20 >= filteredQueue().length) return; state.queuePage++; renderReviewQueue(); };
  $('review-source-more').onclick = () => { if (state.busy) return; state.sourceCheckLimit += 6; renderSourceChecks(); };
  $('review-open-first').onclick = () => { const record = filteredQueue()[state.queuePage * 20]; if (record) openGlobalRecord(record); };
  $('new-record').onclick = () => newRecord(); $('record-close').onclick = () => show('record-editor', false); $('record-kind').onchange = updateKind;
  $('record-topic').onchange = renderAnswerQuestions;
  $('record-form').onsubmit = event => { event.preventDefault(); run('record-save', 'record-error', saveRecord); };
  for (const view of ['current', 'pending', 'all']) $('view-' + view).onclick = () => { state.view = view; state.recordLimit = 30; renderTopic(); };
  $('context-open').onclick = openContext; $('context-close').onclick = () => show('context-panel', false);
  $('context-include-ai').onchange = () => { invalidatePacket(); if (!$('context-include-ai').checked) for (const record of topicRecords().filter(isSelectableProposal)) state.selected.delete(record.id); renderContextChoices(); };
  for (const id of ['context-question', 'context-target', 'context-model']) $(id).addEventListener(id === 'context-target' ? 'change' : 'input', invalidatePacket);
  $('context-prepare').onclick = () => run('context-prepare', 'context-error', prepareContext);
  $('context-consent').onchange = readiness; $('reply-consent').onchange = readiness;
  const replyChanged = () => { $('reply-consent').checked = false; error('reply-error'); readiness(); };
  $('reply-text').oninput = replyChanged; $('reply-format').onchange = replyChanged;
  $('context-copy').onclick = () => run('context-copy', 'context-error', async () => { if (!state.packet || !$('context-consent').checked) throw Error('Önce hedefi ve metni onayla.'); if (!navigator.clipboard?.writeText) throw Error('Pano erişilemiyor. Tam metni yukarıdaki önizlemeden seçip kopyalayabilirsin.'); await navigator.clipboard.writeText(state.packet.text); text('context-copy-status', 'Metin panoya kopyalandı. Kendi sohbet hesabına yapıştır; gelen yanıtı aşağıya getir.'); });
  $('reply-save').onclick = () => run('reply-save', 'reply-error', saveReply);
  $('backup-create').onclick = () => run('backup-create', 'maintenance-error', async () => { const backup = await call('records-backup'); await refresh(); $('restore-backup').value = backup.backupId; text('maintenance-status', 'Yerel yedek oluşturuldu: ' + backup.backupId); });
  $('topic-conversation-search').oninput = () => { state.conversationLimit = 20; renderConversationLinks(); };
  $('topic-conversations-more').onclick = () => { state.conversationLimit += 20; renderConversationLinks(); };
  $('bulk-preview').onclick = () => run('bulk-preview', 'bulk-error', previewBulk);
  $('bulk-consent').onchange = readiness;
  $('bulk-apply').onclick = () => run('bulk-apply', 'bulk-error', async () => {
    if (!state.bulk || !$('bulk-consent').checked) throw Error('Toplu aktarım önizlemesini onayla.');
    const result = await call('records-bulk-apply', { previewHash: state.bulk.previewHash, confirmedByUser: true });
    state.bulk = null; $('bulk-consent').checked = false; show('bulk-preview-panel', false); await refresh(); invalidatePacket();
    text('bulk-status', result.alreadyApplied ? 'Bu konuşmalar zaten konu defterinde; yeniden çoğaltılmadı.' : result.linked + ' konuşma bağlantısı ve ' + result.candidatesCreated + ' inceleme adayı eklendi. Önceki onaylar korunuyor.');
    text('page-status', 'Konuşmaların konulara yerleşti. Son kullanıcı sözlerinden kaldığın yere dönebilir, adayları kaynağıyla inceleyebilirsin.');
  });
  $('migration-preview').onclick = () => run('migration-preview', 'maintenance-error', previewMigration);
  $('migration-consent').onchange = readiness;
  $('migration-apply').onclick = () => run('migration-apply', 'maintenance-error', async () => { if (!state.migration || !$('migration-consent').checked) throw Error('Geçiş önizlemesini onayla.'); const result = await call('records-migration-apply', { previewHash: state.migration.previewHash, confirmedByUser: true }); await refresh(); state.migration = null; show('migration-panel', false); invalidatePacket(); text('maintenance-status', result.imported + ' kart eklendi. Geçiş öncesi yerel yedek: ' + result.backupId); });
  $('restore-consent').onchange = readiness; $('restore-backup').onchange = () => { $('restore-consent').checked = false; readiness(); };
  $('restore-apply').onclick = () => run('restore-apply', 'maintenance-error', async () => { if (!$('restore-consent').checked || !$('restore-backup').value) throw Error('Geri dönülecek yedeği seç ve onayla.'); await call('records-restore', { backupId: $('restore-backup').value, expectedStateHash: state.data.stateHash, confirmedByUser: true }); await refresh(); invalidatePacket(); show('record-editor', false); $('restore-consent').checked = false; text('maintenance-status', 'Konu defteri seçtiğin yedeğe döndü. Eski konuşmaların ve önceki görüş defterin korunuyor.'); });
  async function initialize() { error('page-error'); show('reload', false); try {
    const params = new URLSearchParams(location.search); state.topicId = params.get('topicId') || '';
    if (params.has('kind') && ['opinion', 'decision', 'question'].includes(params.get('kind'))) $('review-kind-filter').value = params.get('kind');
    state.screen = params.get('view') === 'review' ? 'review' : params.get('view') === 'overview' ? 'overview' : params.has('topicId') || params.has('conversationId') ? 'topic' : 'overview';
    await refresh(); await loadSourceFromUrl();
    const record = state.data.records.find(r => r.id === params.get('recordId')); if (record && state.screen !== 'topic') openGlobalRecord(record);
    text('page-status', 'Yerel konu defteri hazır. Genel bakış ve inceleme kuyruğu model çalıştırmaz.');
  } catch (e) { error('page-error', e.message); show('reload', true); } }
  $('reload').onclick = initialize; initialize();
})();
