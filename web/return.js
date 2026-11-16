import { api } from '/private-client.js';

// All records and replies stay behind the existing loopback capability. This
// screen never invokes a model or sends a conversation to a remote service.
(() => {
  'use strict';
  const $ = id => document.getElementById(id);
  const call = (op, body = {}) => api('/api/private/tore/' + op, body);
  // One vocabulary for every list, form and badge on this page (KARARLAR §2).
  const labels = {
    kind: { opinion: 'Görüş', decision: 'Karar', question: 'Soru', task: 'İş' },
    review: { pending: 'İnceleme bekliyor', reviewed: 'İncelendi', rejected: 'Reddedildi' },
    adoption: { unknown: 'Belirtilmedi', adopted: 'Benimsedim', hypothesis: 'Hipotez', uncertain: 'Emin değilim', not_adopted: 'Benimsemedim', not_applicable: 'Uygulanmaz (soru ya da iş)' },
    currency: { unknown: 'Belirtilmedi', current: 'Güncel', superseded: 'Eskidi' },
    priority: { unspecified: 'Belirtilmedi', active: 'Yapılıyor', paused: 'Beklemede', not_priority: 'Öncelikli değil' },
    inbox: { note: 'Not', decision: 'Karar', question: 'Soru', task: 'İş', objection: 'İtiraz' }
  };
  const targets = {
    chatgpt: ['ChatGPT', 'https://chatgpt.com/'], gemini: ['Google Gemini', 'https://gemini.google.com/'],
    claude: ['Claude', 'https://claude.ai/'], meta: ['Meta AI', 'https://www.meta.ai/'], xai: ['xAI / Grok', 'https://grok.com/'],
    deepseek: ['DeepSeek', 'https://chat.deepseek.com/'], kimi: ['Kimi', 'https://www.kimi.com/'],
    glm: ['GLM', 'https://chat.z.ai/'], qwen: ['Alibaba / Qwen', 'https://chat.qwen.ai/'], mistral: ['Mistral', 'https://chat.mistral.ai/'],
    nvidia: ['NVIDIA', 'https://build.nvidia.com/'], openrouter: ['OpenRouter', null], other: ['Diğer hizmet', null]
  };
  const state = { data: { topics: [], records: [], packets: [], replies: [], backups: [], conversationLinks: [] }, topicId: '', screen: 'overview', view: 'current', queuePage: 0, sourceCheckLimit: 6, dashboardLimits: { decisions: 6, opinions: 6, resume: 6 }, editing: null, source: null, packet: null, selected: new Set(), migration: null, bulk: null, conversationLimit: 20, overviewLimits: { approved: 8, candidates: 8 }, recordLimit: 30, busy: false, requestKeys: new Map(), replyDrafts: new Map(), inbox: [], inboxFailed: false, extra: null, editorClean: '', afterDiscard: null };
  const node = (tag, value, cls) => { const el = document.createElement(tag); if (value != null) el.textContent = String(value); if (cls) el.className = cls; return el; };
  const button = (title, cls) => { const el = node('button', title, cls); el.type = 'button'; return el; };
  const text = (id, value) => { $(id).textContent = value ?? ''; };
  const show = (id, yes) => { $(id).hidden = !yes; };
  const date = value => { if (!value || Number.isNaN(new Date(value).getTime())) return 'Tarih belirtilmedi'; return new Date(value).toLocaleString('tr-TR', { dateStyle: 'medium', timeStyle: 'short' }); };
  const option = (value, title) => { const el = node('option', title); el.value = value; return el; };
  const calm = () => { try { return matchMedia('(prefers-reduced-motion: reduce)').matches; } catch { return true; } };
  const reveal = (el, focus) => { el.scrollIntoView({ block: 'start', behavior: calm() ? 'auto' : 'smooth' }); if (focus) focus.focus({ preventScroll: true }); };
  const stateful = kind => kind === 'question' || kind === 'task';
  const pendingRecords = () => state.data.records.filter(record => record.review === 'pending');
  const topicName = id => state.data.topics.find(topic => topic.id === id)?.title || 'Konusu bulunamayan kayıt';
  const visibleTopics = () => state.data.topics.filter(topic => topic.id !== 'bulk-topic-other' || state.data.records.some(record => record.topicId === topic.id) || state.data.conversationLinks.some(link => link.topicId === topic.id));
  const currentTopic = () => state.data.topics.find(t => t.id === state.topicId);
  const topicRecords = () => state.data.records.filter(r => r.topicId === state.topicId);
  const requestId = (op, body) => { const key = op + JSON.stringify(body); if (!state.requestKeys.has(key)) state.requestKeys.set(key, crypto.randomUUID()); return state.requestKeys.get(key); };
  const mutation = (op, body) => call(op, { ...body, requestId: requestId(op, body) });
  const roleName = role => role === 'assistant' ? 'AI yanıtı' : role === 'user' || role === 'human' ? 'Senin sözün' : 'Konuşmacı belirtilmedi';
  const isProposal = record => record.attribution === 'assistant_proposal' || record.provenance === 'assistant_proposal' || record.source?.role === 'assistant' || record.source?.speaker === 'assistant';
  const ownNote = record => !record.source && !isProposal(record);
  const origin = record => isProposal(record) ? 'AI önerisi' : !record.source ? 'Kendi notun' : record.source.excerpt && record.text === record.source.excerpt ? 'Senin sözün (birebir)' : 'Senin sözünden (düzenlenmiş)';
  const isCurrent = record => record.review === 'reviewed' && record.currency === 'current' && (stateful(record.kind) ? record.questionState === 'open' : record.adoption === 'adopted');
  const isSelectableProposal = record => isProposal(record) && record.review === 'reviewed' && record.currency === 'current' && !stateful(record.kind) && record.adoption !== 'adopted';
  const isOpenTask = record => record.kind === 'task' && record.questionState === 'open' && record.review !== 'rejected' && record.currency !== 'superseded';
  const openState = record => record.questionState === 'closed' ? 'Kapandı' : record.review === 'reviewed' && record.currency === 'current' ? 'Açık' : 'Açık mı, incelenecek';
  // Only what differs from the settled default is shown as a warning badge.
  function badges(record) {
    const out = [[labels.kind[record.kind] || record.kind, false]];
    if (record.review !== 'reviewed') out.push([labels.review[record.review], true]);
    if (stateful(record.kind)) out.push([openState(record), openState(record) === 'Açık mı, incelenecek']);
    else out.push(record.adoption === 'unknown' ? ['Benimseme belirtilmedi', true] : [labels.adoption[record.adoption], false]);
    out.push(record.currency === 'unknown' ? ['Güncellik belirtilmedi', true] : [labels.currency[record.currency], record.currency !== 'current']);
    if (record.priority && record.priority !== 'unspecified') out.push([labels.priority[record.priority], false]);
    return out;
  }
  function badgeRow(record) { const meta = node('div', null, 'record-meta'); for (const [value, warning] of badges(record)) meta.append(node('span', value, 'badge' + (warning ? ' warning' : ''))); return meta; }

  // Known local-service messages, rewritten to say what happened and what to do.
  const translations = [
    [/Yerel oturum açık değil/, 'töre\'nin bağlantısı kopmuş. Başlat.command dosyasına yeniden çift tıkla; kayıtların yerinde duruyor.'],
    [/Yerel hizmet geçerli yanıt vermedi/, 'töre yanıt vermiyor. Başlat.command dosyasına yeniden çift tıkla; kayıtların yerinde duruyor.'],
    [/Konu deposu dışarıdan değişmiş/, 'Defter başka bir pencerede değişti. Sayfayı yenile; yazdıkların kaybolmadı.'],
    [/Kayıt değişmiş; yeniden yükleyin/, 'Bu kayıt başka bir pencerede değişmiş. Yazdığın metin burada duruyor; kopyalayıp sayfayı yenile, sonra kaydı yeniden aç.'],
    [/Konu deposu sürümü veya kapasitesi/, 'Defter dosyası açılamadı. Hiçbir şey silinmedi. Sayfayı yenile; sürerse aşağıdaki “Yedek ve geri yükleme” bölümünden son yedeğine dön.'],
    [/revizyon zinciri geçersiz|Kayıt konu bağlantısı geçersiz/, 'Bu kayıt kaydedilemedi çünkü defterdeki geçmişiyle uyuşmuyor. Hiçbir şey silinmedi. Sayfayı yenileyip yeniden dene.'],
    [/Kayıt içeriği veya durumları geçersiz/, 'Kayıt kaydedilemedi: ifade boş ya da çok uzun olabilir, ya da seçtiğin durumlar bu kayıt türüyle uyuşmuyor. Metnin burada duruyor.'],
    [/1–40 kayıt seçin/, 'Devam metni için en az 1, en çok 40 kayıt seç.'],
    [/Devam bağlamı çok büyük/, 'Devam metni çok uzun oldu. Daha az kayıt seçip yeniden hazırla.'],
    [/Eski görüşler değişti; önizlemeyi yeniden açın/, 'Eski görüş defterin bu arada değişmiş. “Eski görüşleri önizle”ye yeniden bas.'],
    [/Öneri bulunamadı veya daha önce işlendi/, 'Bu öneri artık gelen kutusunda değil; daha önce alınmış ya da kaldırılmış olabilir.'],
    [/Öneri bırakma izni için önce okuma izni gerekir/, 'Öneri izni için önce okuma iznini aç.'],
    [/100 yerel yedek sınırı/, 'En çok 100 yedek tutulabiliyor ve sınır doldu; var olan yedeklerin duruyor. Yeni yedek alınamadı.'],
    [/Konu adı veya amacı geçersiz/, 'Konu adı boş olamaz; ad ya da amaç çok uzun da olabilir. Kısaltıp yeniden dene.'],
    [/İşlem tamamlanamadı; başarı bildirilmedi/, 'İşlem tamamlanamadı; hiçbir şey kaydedilmedi. Yeniden dene.']
  ];
  const friendly = message => { const raw = String(message || ''); for (const [pattern, better] of translations) if (pattern.test(raw)) return better; return raw || 'İşlem tamamlanamadı. Yazdığın metin burada duruyor.'; };
  const errorNode = target => typeof target === 'string' ? $(target) : target;
  const error = (target, message = '') => { const el = errorNode(target); if (!el) return; el.textContent = message; el.hidden = !message; };
  // The message appears next to the control that caused it; only that control
  // is disabled while the request runs, so focus and scroll position stay put.
  async function run(trigger, errorTarget, action) {
    if (state.busy) return;
    const control = typeof trigger === 'string' ? $(trigger) : trigger, wasDisabled = control?.disabled;
    state.busy = true; $('main').setAttribute('aria-busy', 'true'); if (control) control.disabled = true;
    error(errorTarget); let after;
    try { after = await action(); }
    catch (e) { error(errorTarget, friendly(e?.message)); }
    finally { state.busy = false; $('main').removeAttribute('aria-busy'); if (control?.isConnected) control.disabled = wasDisabled; readiness(); }
    if (typeof after === 'function') after();
  }
  function readiness() {
    $('context-copy').disabled = state.busy || !state.packet || !$('context-consent').checked;
    show('context-copy-hint', Boolean(state.packet) && !$('context-consent').checked);
    $('tool-share-open').disabled = state.busy || !state.packet || state.packet.sharedWithTools === true || !$('tool-share-consent').checked;
    $('tool-share-close').disabled = state.busy || !state.packet || state.packet.sharedWithTools !== true;
    $('reply-save').disabled = state.busy || !state.packet || !$('reply-text').value.trim();
    $('migration-apply').disabled = state.busy || !state.migration || !$('migration-consent').checked || !state.migration.candidates?.length;
    $('bulk-apply').disabled = state.busy || !state.bulk || !$('bulk-consent').checked || !(state.bulk.topics?.some(t => t.newLinkCount > 0) || state.bulk.candidateCount > 0);
    show('bulk-hint', Boolean(state.bulk) && !$('bulk-consent').checked);
    $('restore-apply').disabled = state.busy || !$('restore-consent').checked || !$('restore-backup').value;
    show('restore-hint', $('restore-apply').disabled);
    show('context-service-link', Boolean(state.packet && $('context-consent').checked && targets[state.packet.target]?.[1]));
    const queued = filteredQueue();
    $('review-open-first').disabled = state.busy || !queued.length; $('review-prev').disabled = state.busy || state.queuePage === 0; $('review-next').disabled = state.busy || (state.queuePage + 1) * 20 >= queued.length;
    toolAccessReadiness(); quickReadiness();
  }
  async function refresh() {
    state.data = await call('records-list');
    for (const field of ['topics', 'records', 'packets', 'replies', 'backups']) if (!Array.isArray(state.data[field])) throw Error('Defter eksik okundu. Hiçbir şey silinmedi; sayfayı yenile.');
    if (state.data.conversationLinks === undefined) state.data.conversationLinks = [];
    if (!Array.isArray(state.data.conversationLinks)) throw Error('Konuşma bağlantıları okunamadı. Hiçbir şey silinmedi; sayfayı yenile.');
    if (!state.data.topics.some(t => t.id === state.topicId)) state.topicId = state.data.topics[0]?.id || '';
    renderTopics(); renderTopic(); renderGlobal(); renderBackups();
    await loadExtras();
  }
  function renderTopics() {
    text('topic-count', visibleTopics().length); text('pending-count', pendingRecords().length);
    text('review-nav-count', pendingRecords().length);
    $('nav-overview').setAttribute('aria-current', state.screen === 'overview' ? 'page' : 'false'); $('nav-review').setAttribute('aria-current', state.screen === 'review' ? 'page' : 'false');
    const list = $('topic-list'); list.replaceChildren();
    if (!state.data.topics.length) list.append(node('p', 'Henüz konu yok. + Yeni ile ilk konunu aç.', 'small'));
    const search = $('topic-search').value.trim().toLocaleLowerCase('tr-TR'), topics = visibleTopics().filter(topic => !search || topic.title.toLocaleLowerCase('tr-TR').includes(search));
    if (state.data.topics.length && !topics.length) list.append(node('p', 'Bu aramada konu bulunamadı.', 'small'));
    for (const topic of topics) {
      const records = state.data.records.filter(r => r.topicId === topic.id), item = button(null, 'topic-item'); item.dataset.topicId = topic.id; item.setAttribute('aria-current', String(state.screen === 'topic' && topic.id === state.topicId));
      item.append(node('strong', topic.title), node('span', records.filter(isCurrent).length + ' güncel · ' + records.filter(r => r.review === 'pending').length + ' bekleyen · ' + state.data.conversationLinks.filter(link => link.topicId === topic.id).length + ' konuşma'));
      item.onclick = () => guard(() => selectTopic(topic.id)); list.append(item);
    }
    const previous = $('record-topic').value; $('record-topic').replaceChildren(...state.data.topics.map(t => option(t.id, t.title))); $('record-topic').value = state.data.topics.some(t => t.id === previous) ? previous : state.topicId;
  }
  function selectTopic(id) {
    if (state.busy || (state.screen === 'topic' && state.topicId === id)) return;
    state.topicId = id; state.screen = 'topic'; state.view = 'current'; state.conversationLimit = 20; state.recordLimit = 30; state.overviewLimits = { approved: 8, candidates: 8 }; $('topic-conversation-search').value = ''; closeEditor(); show('context-panel', false); show('reply-panel', false); invalidatePacket(); text('record-result', '');
    history.replaceState(null, '', '/konular?topicId=' + encodeURIComponent(id)); renderTopics(); renderTopic(); renderGlobal(); loadExtras();
  }
  function recordFoot(record, edit) {
    const foot = node('div', null, 'record-foot');
    foot.append(node('p', origin(record) + ' · ' + date(record.updatedAt || record.createdAt), 'small'), edit); return foot;
  }
  function renderTopic() {
    const topic = currentTopic(); show('empty-topic', state.screen === 'topic' && !topic); show('topic-view', state.screen === 'topic' && Boolean(topic));
    if (!topic) { show('commentaries-panel', false); return; }
    text('topic-title', topic.title); text('topic-description', topic.goal || 'Bu konu için henüz amaç yazılmadı.');
    const records = topicRecords(), current = records.filter(isCurrent), decisions = current.filter(r => r.kind === 'decision'), questions = records.filter(r => r.kind === 'question' && r.questionState === 'open' && r.review === 'reviewed' && r.currency === 'current');
    text('topic-summary', decisions.length + ' güncel karar · ' + current.filter(r => r.kind === 'opinion').length + ' güncel görüş · ' + questions.length + ' açık soru · ' + openTasks().length + ' açık iş · ' + records.filter(r => r.review === 'pending').length + ' inceleme bekleyen kayıt');
    for (const view of ['current', 'pending', 'all']) $('view-' + view).setAttribute('aria-pressed', String(state.view === view));
    const selected = records.filter(r => state.view === 'all' || (state.view === 'pending' ? r.review === 'pending' : isCurrent(r))).sort((a, b) => String(b.updatedAt || b.createdAt).localeCompare(String(a.updatedAt || a.createdAt)));
    const list = $('record-list'); list.replaceChildren();
    if (!selected.length) list.append(node('p', state.view === 'current' ? (records.length ? 'Henüz güncel bir kaydın yok. “İnceleme bekleyenler”i açıp kayıtlarını incele.' : state.data.conversationLinks.some(link => link.topicId === topic.id) ? 'Henüz kayıt yok. Aşağıdaki konuşmalardan bir sözünü kayda geçir ya da “+ Yeni kayıt” ile kendi notunu yaz.' : 'Henüz kayıt yok. “+ Yeni kayıt” ile kendi notunu yaz ya da Konuşmalarım\'daki bir sözünü kayda geçir.') : state.view === 'pending' ? 'İncelenecek kayıt kalmadı.' : 'Bu konuda henüz kayıt yok.', 'small global-overview-empty'));
    for (const record of selected.slice(0, state.recordLimit)) {
      const article = node('article', null, 'record-card'); article.dataset.recordId = record.id;
      article.append(badgeRow(record), node('p', record.text, 'record-text')); if (record.reason) article.append(node('p', record.reason, 'reason'));
      if (record.answersQuestionId) { const question = state.data.records.find(r => r.id === record.answersQuestionId); if (question) { const link = button('Yanıt olduğu soru: ' + question.text, 'quiet'); link.onclick = () => guard(() => editRecord(question), question); article.append(link); } }
      const edit = button('İncele', 'quiet'); edit.dataset.editRecord = record.id; edit.setAttribute('aria-label', 'İncele: ' + record.text.slice(0, 80)); edit.onclick = () => guard(() => editRecord(record), record);
      article.append(recordFoot(record, edit));
      const latest = record.history?.at(-1); if (latest?.changeReason) article.append(node('p', 'Son değişiklik: ' + latest.changeReason, 'small'));
      list.append(article);
    }
    if (selected.length > state.recordLimit) { const more = button('Daha fazla kayıt göster · ' + (selected.length - state.recordLimit) + ' kayıt daha', 'quiet overview-more'); more.id = 'records-more'; more.onclick = () => { state.recordLimit += 30; renderTopic(); }; list.append(more); }
    const packets = state.data.packets.filter(p => p.topicId === topic.id).sort((a, b) => String(b.createdAt).localeCompare(String(a.createdAt)) || a.id.localeCompare(b.id));
    if (packets.length) {
      const saved = node('details'), choices = node('div', null, 'packet-list'); saved.append(node('summary', 'Kayıtlı devam metinleri · ' + packets.length));
      for (const packet of packets) {
        const open = button((targets[packet.target]?.[0] || packet.target) + ' · ' + date(packet.createdAt) + ' · ' + packet.recordIds.length + ' kayıt', 'quiet');
        open.dataset.savedPacket = packet.id; open.onclick = () => { openContext(); displayPacket(packet); };
        const row = node('div', null, 'packet-row'); row.append(open);
        if (packet.sharedWithTools === true) {
          const close = button('Kapat', 'quiet'), problem = node('p', null, 'error'); close.dataset.unsharePacket = packet.id; close.setAttribute('aria-label', 'Bu devam metnini bağlı AI aracına kapat'); problem.setAttribute('role', 'alert'); problem.hidden = true;
          close.onclick = () => run(close, problem, () => setToolShare(packet.id, false));
          row.append(node('span', 'Bağlı AI aracına açık', 'badge shared'), close, problem);
        }
        choices.append(row);
      }
      saved.append(choices); list.append(saved);
    }
    const questionsList = $('open-questions-list'); questionsList.replaceChildren(); show('open-questions-panel', state.view === 'current' && questions.length > 0);
    for (const question of questions) {
      const row = node('article', null, 'record-card'), actions = node('div', null, 'actions'), open = button('İncele', 'quiet'), answer = button('Yanıt yaz', 'secondary');
      row.append(node('p', question.text, 'record-text'), node('p', origin(question) + ' · ' + date(question.updatedAt || question.createdAt), 'small'));
      open.onclick = () => guard(() => editRecord(question), question); answer.onclick = () => guard(() => { newRecord(); $('record-answer-question').value = question.id; markClean(); });
      actions.append(answer, open); row.append(actions); questionsList.append(row);
    }
    renderTasks(); renderOverview(records); renderConversationLinks(); renderReplies(); renderToolAccess();
  }
  // Open tasks come from the topic view of the local service; the same rule is
  // applied locally only while that answer is not there yet.
  function openTasks() {
    const ids = state.extra?.topicId === state.topicId ? state.extra.openTasks : null, records = topicRecords();
    const tasks = ids ? ids.map(id => records.find(r => r.id === id)).filter(Boolean) : records.filter(isOpenTask);
    return tasks.sort((a, b) => Number(b.priority === 'active') - Number(a.priority === 'active') || String(b.updatedAt || b.createdAt).localeCompare(String(a.updatedAt || a.createdAt)) || a.id.localeCompare(b.id));
  }
  function renderTasks() {
    const tasks = openTasks(), list = $('open-tasks-list'); list.replaceChildren(); show('open-tasks-panel', state.view === 'current' && tasks.length > 0);
    for (const task of tasks) {
      const row = node('article', null, 'record-card'), meta = node('div', null, 'record-meta'), actions = node('div', null, 'actions'), open = button('İncele', 'quiet'), close = button('İşi kapat', 'secondary');
      row.dataset.openTask = task.id;
      if (task.priority === 'active') meta.append(node('span', 'Yapılıyor', 'badge shared'));
      if (task.review === 'pending') meta.append(node('span', labels.review.pending, 'badge warning'));
      if (task.priority === 'paused' || task.priority === 'not_priority') meta.append(node('span', labels.priority[task.priority], 'badge'));
      if (meta.childElementCount) row.append(meta);
      row.append(node('p', task.text, 'record-text'), node('p', origin(task) + ' · ' + date(task.updatedAt || task.createdAt), 'small'));
      open.dataset.taskEdit = task.id; open.onclick = () => guard(() => editRecord(task), task);
      close.dataset.taskClose = task.id; close.onclick = () => guard(() => { editRecord(task); reveal($('question-close-panel'), $('question-close-consent')); }, task);
      actions.append(close, open); row.append(actions); list.append(row);
    }
  }
  const sourceTime = record => record.source?.timestamp || record.legacy?.source?.timestamp || null;
  const descendingSource = (a, b) => String(sourceTime(b) || '').localeCompare(String(sourceTime(a) || '')) || String(b.updatedAt || b.createdAt || '').localeCompare(String(a.updatedAt || a.createdAt || '')) || a.id.localeCompare(b.id);
  function sourceLink(conversationId, messageId, title) {
    const link = node('a', title, 'quiet'); link.href = '/calisma?conversationId=' + encodeURIComponent(conversationId) + (messageId ? '&messageId=' + encodeURIComponent(messageId) : ''); return link;
  }
  function overviewRecord(record) {
    const article = node('article', null, 'record-card record-summary'); article.dataset.overviewRecord = record.id;
    article.append(badgeRow(record), node('p', record.text, 'record-text'));
    const source = record.source;
    article.append(node('p', origin(record) + (source ? ' · Kaynak: ' + roleName(source.role || source.speaker) + ' · ' + date(sourceTime(record)) : ' · ' + date(record.createdAt)), 'small source-time'));
    if (record.reason) article.append(node('p', record.reason, 'small'));
    const actions = node('div', null, 'actions'), edit = button('İncele', 'quiet'); edit.dataset.overviewEdit = record.id; edit.onclick = () => guard(() => editRecord(record), record); actions.append(edit);
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
      for (const record of sorted.slice(0, state.overviewLimits[group])) list.append(overviewRecord(record));
      if (sorted.length > state.overviewLimits[group]) {
        const more = button('Daha fazla göster · ' + (sorted.length - state.overviewLimits[group]) + ' kayıt daha', 'quiet overview-more'); more.dataset.overviewMore = group; more.onclick = () => { state.overviewLimits[group] += 8; renderOverview(records); }; list.append(more);
      }
    }
  }
  function leaveWorkingPanels() {
    invalidatePacket(); state.selected.clear(); closeEditor();
    show('context-panel', false); show('reply-panel', false);
  }
  function selectGlobal(screen) {
    if (state.busy) return;
    leaveWorkingPanels(); state.screen = screen; text('record-result', '');
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
    article.append(node('p', topicName(record.topicId), 'topic-name'), badgeRow(record), node('p', record.text, 'record-text'));
    if (record.reason) article.append(node('p', record.reason, 'small'));
    const source = record.source;
    article.append(node('p', origin(record) + (source ? ' · Kaynak: ' + roleName(source.role || source.speaker) + ' · ' + date(sourceTime(record)) : ' · ' + date(record.createdAt)), 'small'));
    if (source?.excerpt) {
      const details = node('details'), summary = node('summary', 'Kaynak alıntısı'), quote = node('blockquote', source.excerpt, 'source-excerpt'); quote.tabIndex = 0;
      details.append(summary, quote); article.append(details);
    }
    const actions = node('div', null, 'actions'), edit = button('İncele', 'secondary'), topic = button('Konuyu aç', 'quiet');
    edit.dataset.globalEdit = record.id; edit.setAttribute('aria-label', 'İncele: ' + record.text.slice(0, 80)); edit.onclick = () => guard(() => openGlobalRecord(record), record); topic.dataset.globalTopic = record.topicId; topic.onclick = () => guard(() => selectTopic(record.topicId)); actions.append(edit, topic);
    if (source?.conversationId) actions.append(sourceLink(source.conversationId, source.messageId, 'Kaynak mesaja dön ↗'));
    article.append(actions); return article;
  }
  const knownTime = value => value && Number.isFinite(Date.parse(value)) ? Date.parse(value) : 0;
  const linkTime = link => knownTime(link.sourceUpdatedAt) || knownTime(link.lastUserSource?.timestamp) || knownTime(link.sourceCreatedAt);
  function resumeCard(link) {
    const article = node('article', null, 'conversation-link-card global-resume-card'); article.dataset.globalResume = link.id;
    article.append(node('p', topicName(link.topicId), 'topic-name'));
    if (link.subtopicTitle) article.append(node('p', link.subtopicTitle, 'badge subtopic-badge'));
    article.append(node('h4', link.title || 'Başlıksız konuşma'), node('p', (link.provider || 'Kaynak belirtilmedi') + ' · ' + date(linkTime(link) || null), 'small'));
    const source = link.lastUserSource;
    if (source) article.append(node('p', 'Son sözün · ' + date(source.timestamp), 'small'), node('blockquote', source.excerpt));
    else article.append(node('p', 'Bu konuşmadaki son sözün belirlenemedi. Konuşmayı açıp bakabilirsin.', 'small'));
    if (link.warning) article.append(node('p', link.warning, 'small warning'));
    const actions = node('div', null, 'actions'), open = button('Konuyu aç', 'secondary'); open.dataset.resumeTopic = link.topicId; open.onclick = () => guard(() => selectTopic(link.topicId));
    actions.append(open, sourceLink(link.conversationId, source?.messageId, 'Kaldığım mesajı aç ↗')); article.append(actions); return article;
  }
  function dashboardGroup(key, values, makeCard, empty) {
    const list = $('global-' + key); list.replaceChildren();
    for (const value of values.slice(0, state.dashboardLimits[key])) list.append(makeCard(value));
    if (!values.length) list.append(node('p', empty, 'small global-overview-empty'));
    if (values.length > state.dashboardLimits[key]) {
      const more = button('Daha fazla göster · ' + (values.length - state.dashboardLimits[key]) + ' kayıt daha', 'quiet overview-more'); more.dataset.globalMore = key;
      more.onclick = () => { if (state.busy) return; state.dashboardLimits[key] += 6; renderGlobal(); }; list.append(more);
    }
  }
  function renderGlobal() {
    // A notebook with nothing in it gets one starting card instead of four empty lists.
    const firstRun = state.screen === 'overview' && !state.data.topics.length && !state.data.conversationLinks.length && !state.data.records.length;
    show('first-run', firstRun); show('global-overview', state.screen === 'overview' && !firstRun); show('global-review', state.screen === 'review');
    const pending = pendingRecords(); text('review-nav-count', pending.length);
    if (state.screen === 'overview' && !firstRun) {
      const decisions = state.data.records.filter(record => record.kind === 'decision' && isCurrent(record)).sort(descendingSource);
      const opinions = state.data.records.filter(record => record.kind === 'opinion' && record.review === 'reviewed' && record.adoption === 'adopted').sort((a, b) => ({current: 0, unknown: 1, superseded: 2}[a.currency] - {current: 0, unknown: 1, superseded: 2}[b.currency]) || descendingSource(a, b));
      const latestByTopic = new Map();
      for (const link of [...state.data.conversationLinks].sort((a, b) => linkTime(b) - linkTime(a) || a.id.localeCompare(b.id))) if (!latestByTopic.has(link.topicId)) latestByTopic.set(link.topicId, link);
      text('global-summary', visibleTopics().length + ' konu · ' + state.data.conversationLinks.length + ' bağlı konuşma · ' + opinions.length + ' benimsenmiş görüş · ' + decisions.length + ' güncel karar');
      text('global-pending-summary', pending.length ? pending.length + ' kayıt inceleme bekliyor. Her birini açıp sana ait olup olmadığını söyle.' : 'İncelenecek kayıt kalmadı.');
      $('overview-open-review').disabled = false;
      dashboardGroup('decisions', decisions, globalRecord, 'Henüz güncel bir kararın yok.');
      const waiting = pending.filter(record => record.kind === 'decision').length; show('global-decision-candidates', waiting > 0); text('global-decision-candidates', waiting + ' bekleyen kararı incele');
      dashboardGroup('opinions', opinions, globalRecord, 'Henüz benimsediğin bir görüş yok.');
      dashboardGroup('resume', [...latestByTopic.values()], resumeCard, 'Henüz bir konuya bağlı konuşma yok. Yukarıdaki “Konuşmalarımı konulara yerleştir” bölümünü kullanabilirsin.');
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
      article.append(node('p', topicName(link.topicId), 'topic-name'), node('h3', link.title || 'Başlıksız konuşma', 'card-title'), node('p', (link.provider || 'Kaynak belirtilmedi') + ' · ' + date(linkTime(link) || null), 'small'));
      if (link.subtopicTitle) article.append(node('p', link.subtopicTitle, 'badge subtopic-badge'));
      article.append(node('p', link.warning || 'Son sözün belirlenemedi. Konuşmayı açıp hangi sürümünün geçerli olduğuna bak.', 'small warning'));
      const actions = node('div', null, 'actions'), open = button('Konuyu aç', 'quiet'); open.onclick = () => guard(() => selectTopic(link.topicId));
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
    if (!queued.length) list.append(node('p', pendingRecords().length ? 'Bu filtrelerde inceleme bekleyen kayıt yok. Konu, tür veya arama filtresini değiştir.' : 'İncelenecek kayıt kalmadı.', 'small global-overview-empty'));
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
    const visible = filtered.slice(0, state.conversationLimit), groups = new Map(), grouped = filtered.some(link => link.subtopicTitle);
    for (const link of visible) { const key = link.subtopicTitle || 'Diğer konuşmalar'; if (!groups.has(key)) groups.set(key, []); groups.get(key).push(link); }
    for (const [subtopic, links] of groups) {
      if (grouped) list.append(node('h4', subtopic + ' · ' + filtered.filter(link => (link.subtopicTitle || 'Diğer konuşmalar') === subtopic).length + ' konuşma', 'subtopic-heading'));
      for (const link of links) {
        const article = node('article', null, 'conversation-link-card'); article.dataset.conversationLink = link.id;
        const source = link.lastUserSource;
        if (link.subtopicTitle) article.append(node('p', link.subtopicTitle, 'badge subtopic-badge'));
        article.append(node(grouped ? 'h5' : 'h4', link.title || 'Başlıksız konuşma', 'card-title'), node('p', (link.provider || 'Kaynak belirtilmedi') + ' · ' + date(link.sourceUpdatedAt || link.sourceCreatedAt), 'small'));
        if (source) article.append(node('p', 'Son sözün · ' + date(source.timestamp), 'small'), node('blockquote', source.excerpt));
        else article.append(node('p', 'Bu konuşmadaki son sözün belirlenemedi. Konuşmayı açıp bakabilirsin.', 'small'));
        if (link.warning) article.append(node('p', link.warning, 'small warning'));
        if (link.classificationReason) article.append(node('p', 'Bu konuya yerleştirilme nedeni: ' + link.classificationReason, 'small'));
        const actions = node('div', null, 'actions'); actions.append(sourceLink(link.conversationId, source?.messageId, 'Kaldığım mesajı aç ↗'));
        if (source) { const create = button('Bu sözü kayda geçir', 'quiet'); create.dataset.linkCandidate = link.id; create.onclick = () => guard(() => newRecord({ conversationId: link.conversationId, messageId: source.messageId, excerpt: source.excerpt }, source.excerpt, link.title, source.role)); actions.append(create); }
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
      const row = node('article', null, 'bulk-topic-row'); row.append(node('h3', topic.title), node('p', topic.conversationCount + ' konuşma · ' + topic.newLinkCount + ' yeni bağlantı', 'small'), node('p', topic.candidateCount + ' inceleme bekleyen kayıt', 'small')); list.append(row);
    }
    text('bulk-summary', preview.conversationCount + ' konuşma incelendi · ' + preview.linkedCount + ' yeni bağlantı · ' + preview.candidateCount + ' yeni kayıt · ' + preview.alreadyLinked + ' önceden bağlı konuşma');
    const warnings = $('bulk-warnings'); warnings.replaceChildren(...(preview.warnings || []).map(w => node('li', w)));
    const nothing = !((preview.topics || []).some(t => t.newLinkCount > 0) || preview.candidateCount > 0);
    text('bulk-status', nothing ? (preview.conversationCount ? 'Eklenecek yeni bir şey yok; konuşmaların zaten konularında.' : 'Henüz içe alınmış konuşma yok. Önce Konuşmalarım\'da bir konuşma içe al.') : 'Önizleme hazır. Konuşmaların değişmez; onayından sonra konulara bağlanır ve inceleme bekleyen kayıtlar eklenir.'); show('bulk-preview-panel', true); readiness();
  }

  // --- Kayıt düzenleyici ---------------------------------------------------
  const editorFields = ['record-topic', 'record-kind', 'record-excerpt', 'record-text', 'record-answer-question', 'record-reason', 'record-review', 'record-adoption', 'record-currency', 'record-priority', 'record-change-reason', 'question-close-reason'];
  const editorSnapshot = () => JSON.stringify(editorFields.map(id => $(id).value));
  const markClean = () => { state.editorClean = editorSnapshot(); };
  const editorDirty = () => !$('record-editor').hidden && editorSnapshot() !== state.editorClean;
  function closeEditor() { show('record-editor', false); show('record-discard', false); state.editing = null; state.source = null; state.afterDiscard = null; }
  // Unsaved text is never dropped silently: leaving a changed editor asks first.
  function guard(proceed, target) {
    if (state.busy) return;
    if (!editorDirty() || (target && state.editing && target.id === state.editing.id)) { proceed(); return; }
    state.afterDiscard = proceed; show('record-discard', true); reveal($('record-editor'), $('record-discard-no'));
  }
  function setSource(source, original, title, role) {
    state.source = source ? { ...source, original, title, role } : null;
    show('record-source', Boolean(source)); show('excerpt-field', Boolean(source)); show('excerpt-help', Boolean(source));
    text('source-original', original || ''); text('source-title', title || ''); text('source-role', roleName(role));
    show('source-backlink', Boolean(source?.conversationId));
    if (source?.conversationId) $('source-backlink').href = '/calisma?conversationId=' + encodeURIComponent(source.conversationId) + '&messageId=' + encodeURIComponent(source.messageId);
    $('record-excerpt').value = source?.excerpt || original || '';
    text('record-attribution', source ? role === 'assistant' ? 'Bu kaynak bir AI yanıtı. Oluşturduğun kayıt bir AI önerisi olarak eklenir; sen inceleyip benimsemeden görüşün veya kararın sayılmaz.' : 'Kaynaktaki sözün olduğu gibi korunur. Aşağıdaki ifadeyi istediğin gibi düzeltebilirsin; kaynak değişmez.' : 'Bu senin kendi notun. İstersen tek adımda kaydedip benimseyebilirsin.');
  }
  function newRecord(source = null, original = '', title = '', role = '') {
    if (state.busy) return;
    if (!state.data.topics.length) { show('new-topic-form', true); $('new-topic-toggle').setAttribute('aria-expanded', 'true'); $('topic-name').focus(); text('page-status', 'Önce bu kayıt için bir konu oluştur.'); return; }
    state.editing = null; $('record-form').reset(); error('record-error'); show('record-discard', false); state.afterDiscard = null; setSource(source, original, title, role);
    $('record-topic').value = state.topicId; $('record-topic').disabled = false; $('record-kind').disabled = false;
    renderAnswerQuestions();
    $('record-text').value = source?.excerpt || original || ''; text('record-eyebrow', 'Yeni kayıt'); text('record-heading', source ? 'Bu sözü kayda geçir' : 'Yeni kayıt'); text('record-save', 'İncelemeye bırak');
    show('quick-review', false); show('record-detail', false); $('record-detail').open = false; show('record-history', false); show('question-close-panel', false); show('record-save-next', false); show('record-editor', true); updateKind(); markClean(); reveal($('record-editor'), $('record-heading'));
  }
  function updateKind() {
    const kind = state.editing ? state.editing.kind : $('record-kind').value, held = stateful(kind);
    show('adoption-field', !held); show('question-note', held);
    text('question-note', kind === 'task' ? 'İş, sen kapatana kadar açık kalır. Kapatmak için açık onayın ve bir gerekçe gerekir.' : 'Soru sormak bir görüşü benimsemek değildir. Yanıt yazmak soruyu kendiliğinden kapatmaz; kapatmak için açık onayın ve bir gerekçe gerekir.');
    show('answer-question-field', !held && !state.editing && $('record-answer-question').options.length > 1);
    $('record-adoption').querySelector('[value="not_applicable"]').disabled = !held;
    if (held) $('record-adoption').value = 'not_applicable'; else if ($('record-adoption').value === 'not_applicable') $('record-adoption').value = 'unknown';
    // Only a note you write yourself can be saved and adopted in one step.
    show('record-save-adopt', !state.editing && !state.source);
    text('record-save-adopt', kind === 'task' ? 'İşi açık olarak kaydet' : kind === 'question' ? 'Soruyu açık olarak kaydet' : 'Kaydet ve benimse');
  }
  function renderAnswerQuestions() {
    const prior = $('record-answer-question').value; $('record-answer-question').replaceChildren(option('', 'Bir soruya bağlı değil'));
    for (const r of state.data.records.filter(r => r.topicId === $('record-topic').value && r.kind === 'question' && r.questionState === 'open' && r.review === 'reviewed' && r.currency === 'current')) $('record-answer-question').append(option(r.id, r.text));
    $('record-answer-question').value = prior; if ($('record-answer-question').selectedIndex < 0) $('record-answer-question').value = '';
  }
  function editRecord(record) {
    if (state.busy) return;
    newRecord(); state.editing = record; $('record-topic').value = record.topicId; $('record-topic').disabled = true; $('record-kind').value = record.kind; $('record-kind').disabled = true;
    $('record-text').value = record.text; $('record-reason').value = record.reason || ''; $('record-change-reason').value = '';
    for (const key of ['review', 'adoption', 'currency', 'priority']) $('record-' + key).value = record[key];
    const held = stateful(record.kind), closed = record.questionState === 'closed', name = record.kind === 'task' ? 'iş' : 'soru';
    text('record-eyebrow', 'İnceleme'); text('record-heading', labels.kind[record.kind] + ' · incele'); text('record-save', 'Kaydet');
    const source = record.source;
    setSource(source, source?.originalText || source?.excerpt || '', source?.title || source?.conversationTitle || (source ? 'Kaynak' : ''), source?.role || source?.speaker || (isProposal(record) ? 'assistant' : 'user'));
    show('excerpt-field', false); show('excerpt-help', false);
    text('record-attribution', isProposal(record) ? 'Bu ifade bir AI önerisi. Sen benimsemeden görüşün veya kararın sayılmaz; kaynaktaki söz yukarıda ayrıca korunur.' : record.source ? 'Kaynaktaki sözün korunur. Aşağıdaki ifade ve incelemen ondan ayrıdır.' : 'Bu senin kendi notun. Her değişiklik geçmişe kaydedilir.');
    show('quick-review', true); show('record-detail', true); show('record-save-next', record.review === 'pending');
    for (const id of ['quick-adopt', 'quick-hypothesis', 'quick-reject']) show(id, !held); show('quick-keep-open', held && !closed);
    $('quick-consent').checked = false; show('quick-consent-field', !held && !ownNote(record));
    show('question-close-panel', held); text('question-close-label', 'Bu ' + (record.kind === 'task' ? 'işi' : 'soruyu') + ' kendi kararımla kapatıyorum.'); text('question-close-apply', record.kind === 'task' ? 'İşi kapat' : 'Soruyu kapat');
    text('question-state', closed ? 'Bu ' + (record.kind === 'task' ? 'işi' : 'soruyu') + ' sen kapattın.' : record.review === 'reviewed' && record.currency === 'current' ? 'Bu ' + name + ' açık.' + (record.kind === 'question' ? ' Yanıt yazmak soruyu kendiliğinden kapatmaz.' : '') : 'Bu ' + name + ' inceleme bekliyor. Hâlâ açıksa “Açık kalsın”a bas; bittiyse aşağıdan kapat.');
    $('question-close-consent').checked = false; $('question-close-consent').disabled = closed; $('question-close-reason').value = ''; $('question-close-reason').disabled = closed; show('question-close-apply', !closed);
    updateKind(); renderHistory(record); markClean(); quickReadiness();
  }
  function quickReadiness() {
    const record = state.editing; if (!record) return;
    const needs = !stateful(record.kind) && !ownNote(record), blocked = state.busy || (needs && !$('quick-consent').checked);
    $('quick-adopt').disabled = blocked; $('quick-reject').disabled = blocked; $('quick-hypothesis').disabled = state.busy; $('quick-keep-open').disabled = state.busy;
    text('quick-hint', needs && !$('quick-consent').checked ? '“Benimsedim” ve “Benimsemedim” için önce yukarıdaki kutuyu işaretle.' : '');
    $('question-close-apply').disabled = state.busy || record.questionState === 'closed' || !$('question-close-consent').checked;
  }
  function renderHistory(record) {
    const list = $('history-list'); list.replaceChildren(); show('record-history', Boolean(record.history?.length || record.legacy));
    for (const item of [...(record.history || [])].reverse()) {
      const previous = item.previous || item.snapshot || item, article = node('article', null, 'history-entry');
      article.append(node('p', 'Önceki hâl · ' + date(item.changedAt || item.createdAt), 'small'), node('pre', previous.text || ''), node('p', 'Değişiklik gerekçesi: ' + (item.changeReason || 'Belirtilmedi')));
      article.append(node('p', [labels.review[previous.review], previous.adoption === 'not_applicable' ? null : 'Benimseme: ' + labels.adoption[previous.adoption], 'Güncellik: ' + labels.currency[previous.currency], 'Öncelik: ' + labels.priority[previous.priority]].filter(Boolean).join(' · '), 'small')); list.append(article);
    }
    if (record.legacy) {
      const legacy = record.legacy, oldStatuses = { confirmed: 'Benimsenmişti', uncertain: 'Emin değildin', rejected: 'Reddedilmişti', draft: 'Taslaktı' };
      list.append(node('h3', 'Eski görüş defterinden gelen kayıt'), node('p', oldStatuses[legacy.status] || legacy.status, 'small'), node('pre', legacy.statement));
      for (const item of [...(legacy.history || [])].reverse()) { const row = node('article', null, 'history-entry'); row.append(node('p', (oldStatuses[item.status] || item.status) + ' · ' + date(item.changedAt), 'small'), node('pre', item.statement), node('p', item.changeReason || 'Değişiklik gerekçesi belirtilmedi.')); list.append(row); }
    }
  }
  const quickChoices = {
    adopt: { review: 'reviewed', adoption: 'adopted', currency: 'current' },
    hypothesis: { review: 'reviewed', adoption: 'hypothesis' },
    reject: { review: 'reviewed', adoption: 'not_adopted' },
    keepOpen: { review: 'reviewed', currency: 'current' }
  };
  // Where the reviewer is working: the cross-topic queue or this topic's own list.
  const pendingList = () => state.screen === 'review' ? filteredQueue() : topicRecords().filter(r => r.review === 'pending').sort((a, b) => String(b.updatedAt || b.createdAt).localeCompare(String(a.updatedAt || a.createdAt)));
  function focusRecord(id) {
    const card = [...document.querySelectorAll('[data-global-edit],[data-edit-record],[data-overview-edit],[data-task-edit]')].find(el => [el.dataset.globalEdit, el.dataset.editRecord, el.dataset.overviewEdit, el.dataset.taskEdit].includes(id) && !el.closest('[hidden]'));
    if (card) card.focus({ preventScroll: true });
    return Boolean(card);
  }
  // When the saved record has left every visible list (a closed task, a reviewed
  // queue item), focus lands on the heading of the screen the person is on.
  function focusScreen() {
    const heading = $(state.screen === 'review' ? 'global-review-heading' : state.screen === 'topic' && currentTopic() ? 'topic-title' : 'global-overview-heading');
    if (heading && !heading.closest('[hidden]')) heading.focus({ preventScroll: true });
  }
  async function saveRecord(options = {}) {
    const recordText = $('record-text').value.trim(); if (!recordText) throw Error('Kayda geçecek ifadeyi yaz.');
    const before = pendingList().map(r => r.id); let result, message = 'Kaydedildi.', created = false;
    if (state.editing) {
      const record = state.editing, held = stateful(record.kind), quick = quickChoices[options.quick] || {};
      if (options.close && !$('question-close-consent').checked) throw Error('Kapatmak için önce kutuyu işaretle.');
      const closing = held && record.questionState !== 'closed' && $('question-close-consent').checked && !options.quick;
      let changeReason = $('record-change-reason').value.trim();
      if (closing) { const reason = $('question-close-reason').value.trim(); if (!reason) throw Error((record.kind === 'task' ? 'İşi' : 'Soruyu') + ' kapatma gerekçeni yaz.'); changeReason = (changeReason ? changeReason + '\n' : '') + 'Kapatma gerekçem: ' + reason; }
      const body = { id: record.id, expectedRevision: record.revision, expectedTopicId: record.topicId, text: recordText, reason: $('record-reason').value.trim(), review: quick.review || $('record-review').value, adoption: held ? 'not_applicable' : quick.adoption || $('record-adoption').value, currency: quick.currency || $('record-currency').value, priority: $('record-priority').value, questionState: held ? closing ? 'closed' : record.questionState : 'not_applicable', changeReason: changeReason || 'İnceledim.', confirmedByUser: true };
      // Adopting or rejecting something you did not write yourself is a declaration; it needs the box.
      const declares = !held && !ownNote(record) && ((['adopted', 'not_adopted'].includes(body.adoption) && body.adoption !== record.adoption) || (body.review === 'rejected' && record.review !== 'rejected'));
      if (declares && !$('quick-consent').checked) { $('record-detail').open = true; throw Error('Benimsemek, benimsememek ya da reddetmek için önce “Bu kaydı okudum…” kutusunu işaretle.'); }
      try { result = await call('records-review', body); }
      catch (e) {
        if (e.message?.includes('Kaydın konusu değişmiş')) { await refresh(); throw Error('Kaydın konusu değişmiş. Girdiğin metin korunuyor; yeni konusunu ve kaynağını görmek için kaydı yeniden aç.'); }
        throw e;
      }
      if (closing) message = record.kind === 'task' ? 'İş kapatıldı.' : 'Soru kapatıldı.';
    } else {
      const body = { topicId: $('record-topic').value, kind: $('record-kind').value, text: recordText, reason: $('record-reason').value.trim() };
      if (!stateful(body.kind) && $('record-answer-question').value) body.answersQuestionId = $('record-answer-question').value;
      if (!body.topicId) throw Error('Bir konu seç.');
      if (options.adopt && state.source) throw Error('Kaynaklı bir kayıt önce incelemeye bırakılır.');
      if (state.source) {
        const excerpt = $('record-excerpt').value; if (!excerpt.trim() || !state.source.original.includes(excerpt)) throw Error('Alıntı kaynakta birebir, kelimesi kelimesine geçmeli. Yukarıdaki metinden seçip kopyala; kendi cümleni “Kayda geçecek ifaden” kutusuna yaz.');
        body.source = state.source.replyId ? { replyId: state.source.replyId, excerpt } : { conversationId: state.source.conversationId, messageId: state.source.messageId, excerpt };
      }
      result = await mutation('records-create', body); state.topicId = body.topicId; created = true;
      message = 'Kayıt inceleme bekleyenlere eklendi. Güncel saymak için aç ve durumunu seç.';
      if (options.adopt) {
        const record = result.record, held = stateful(record.kind);
        try {
          result = await call('records-review', { id: record.id, expectedRevision: record.revision, expectedTopicId: record.topicId, text: record.text, reason: record.reason || '', review: 'reviewed', adoption: held ? 'not_applicable' : 'adopted', currency: 'current', priority: record.priority || 'unspecified', questionState: held ? 'open' : 'not_applicable', changeReason: held ? 'Kendi notum; yazarken açık olarak kaydettim.' : 'Kendi notum; yazarken benimsedim.', confirmedByUser: true });
          message = held ? 'Kaydedildi; açık olarak duruyor.' : 'Kaydedildi ve benimsendi.';
        } catch { message = 'Kayıt eklendi ama benimseme kaydedilemedi; inceleme bekleyenlerde duruyor. Açıp yeniden dene.'; }
      }
    }
    const savedId = result.record?.id; invalidatePacket(); await refresh(); closeEditor();
    if (created) state.view = result.record?.review === 'pending' ? 'pending' : 'current';
    renderTopic(); renderGlobal(); if (state.screen !== 'topic') history.replaceState(null, '', '/konular' + (state.screen === 'review' ? '?view=review' : ''));
    text('page-status', message); text('record-result', message);
    const advance = options.next || (options.quick && state.screen === 'review');
    return () => {
      if (advance) {
        const list = pendingList(), at = list.findIndex(r => r.id === savedId), was = before.indexOf(savedId);
        const next = at >= 0 ? list[at + 1] : list[Math.max(0, Math.min(was, list.length - 1))];
        if (next) { if (state.screen === 'review') openGlobalRecord(next); else editRecord(next); text('record-result', message + ' Sıradaki kayıt açıldı.'); return; }
        text('record-result', message + ' İncelenecek kayıt kalmadı.'); text('page-status', message + ' İncelenecek kayıt kalmadı.');
      }
      if (!savedId || !focusRecord(savedId)) focusScreen();
    };
  }

  // --- Devam metni ve AI yanıtı ---------------------------------------------
  function invalidatePacket() {
    rememberReplyDraft();
    const had = Boolean(state.packet);
    state.packet = null; $('context-consent').checked = false; $('tool-share-consent').checked = false; text('tool-share-status', '');
    show('context-preview', false); show('reply-panel', false); text('context-copy-status', had && !$('context-panel').hidden ? 'Seçim değişti. “Metni hazırla”ya yeniden bas.' : ''); readiness();
  }
  function rememberReplyDraft() {
    if (state.packet) state.replyDrafts.set(state.packet.id, { text: $('reply-text').value, format: $('reply-format').value });
  }
  function openContext() {
    if (!currentTopic()) return;
    state.selected = new Set(topicRecords().filter(r => isCurrent(r) && !['not_priority', 'paused'].includes(r.priority)).map(r => r.id)); $('context-include-ai').checked = false; invalidatePacket(); text('context-copy-status', ''); renderContextChoices(); show('context-panel', true); error('context-error'); reveal($('context-panel'), $('context-heading'));
  }
  function renderContextChoices() {
    const list = $('context-records'); list.replaceChildren();
    const records = topicRecords().filter(r => isCurrent(r) || ($('context-include-ai').checked && isSelectableProposal(r)));
    if (!records.length) {
      const empty = node('div', null, 'notice'), go = button('İnceleme bekleyenleri aç', 'secondary');
      go.onclick = () => { show('context-panel', false); state.view = 'pending'; renderTopic(); reveal($('topic-view'), $('view-pending')); };
      empty.append(node('p', 'Bu konuda henüz güncel bir kaydın yok. Önce bir kaydı incele: görüş ve kararı benimse, soru ve işi açık bırak.'), go); list.append(empty);
    }
    for (const record of records) {
      const row = node('div', null, 'context-choice'), checkbox = document.createElement('input'), label = node('label'); checkbox.type = 'checkbox'; checkbox.id = 'context-record-' + record.id; checkbox.dataset.contextRecord = record.id; checkbox.checked = state.selected.has(record.id); label.htmlFor = checkbox.id;
      label.append(node('span', record.text), node('span', (isSelectableProposal(record) ? 'BENİMSENMEMİŞ AI ÖNERİSİ · ' : '') + labels.kind[record.kind] + (record.priority !== 'unspecified' ? ' · ' + labels.priority[record.priority] : ''), 'small')); row.append(checkbox, label); list.append(row);
      checkbox.onchange = () => { if (checkbox.checked) state.selected.add(record.id); else state.selected.delete(record.id); invalidatePacket(); };
    }
  }
  async function prepareContext() {
    const selected = topicRecords().filter(r => state.selected.has(r.id));
    const recordIds = selected.filter(isCurrent).map(r => r.id), proposalIds = $('context-include-ai').checked ? selected.filter(isSelectableProposal).map(r => r.id) : [];
    if (!recordIds.length && !proposalIds.length) throw Error('En az bir kayıt seç.');
    const { packet, findings } = await call('records-prepare', { topicId: state.topicId, recordIds, proposalIds, target: $('context-target').value, model: $('context-model').value.trim() || null, question: $('context-question').value.trim(), confirmedByUser: true });
    await refresh(); displayPacket(packet);
    if (findings?.length) text('context-copy-status', 'Metinde özel bilgi olabilir. Kopyalamadan önce tam metni kontrol et: ' + findings.map(f => typeof f === 'string' ? f : f.kind || f.type || 'özel bilgi').join(', '));
  }
  function displayPacket(packet) {
    rememberReplyDraft();
    const draft = state.replyDrafts.get(packet.id); $('reply-text').value = draft?.text || ''; $('reply-format').value = draft?.format || 'text'; error('reply-error');
    state.packet = packet; $('context-consent').checked = false; $('tool-share-consent').checked = false; text('tool-share-status', ''); renderToolShare();
    const target = targets[packet.target] || [packet.target, null]; text('context-target-label', target[0] + ' hesabına götüreceğin metin' + (packet.model ? ' · ' + packet.model : '')); text('context-prompt', packet.text);
    if (target[1]) $('context-service-link').href = target[1]; show('context-preview', true); show('reply-panel', true); text('reply-status', 'Bu yanıt ' + date(packet.createdAt) + ' tarihli devam metnine bağlanacak.');
    const stale = (packet.sources || []).some(source => state.data.records.find(r => r.id === source.recordId)?.revision !== source.revision);
    text('context-copy-status', stale ? 'Bu devam metni eski: içindeki kayıtlar sonradan değişmiş. Güncel hâli için “Metni hazırla”ya yeniden bas.' : 'Devam metni ' + date(packet.createdAt) + ' tarihinde hazırlandı. Önce kopyala, sonra sohbet hizmetini açıp yapıştır.');
    text('reply-schema', JSON.stringify({ commentary: 'AI yanıtının metni', citations: [{ sourceId: packet.sourceIds?.[0] || 'devam-metnindeki-kaynak-kimliği', quote: 'O kaynaktaki birebir alıntı' }] }, null, 2)); readiness();
  }
  function renderToolShare() {
    const shared = state.packet?.sharedWithTools === true;
    text('tool-share-state', shared ? 'Bağlı AI aracına açık · bağlı araç bu metni okuyabilir' : 'Bağlı AI aracına kapalı');
    $('tool-share-state').classList.toggle('shared', shared);
    show('tool-share-open', !shared); show('tool-share-close', shared); $('tool-share-consent').closest('label').hidden = shared;
  }
  async function setToolShare(packetId, shared) {
    if (shared && (state.packet?.id !== packetId || !$('tool-share-consent').checked)) throw Error('Önce tam metni oku ve bağlı AI aracına açma kutusunu işaretle.');
    const result = await call('records-share', { packetId, shared, confirmedByUser: true });
    await refresh();
    if (state.packet?.id === packetId) { state.packet = state.data.packets.find(p => p.id === packetId) || result.packet; $('tool-share-consent').checked = false; renderToolShare(); }
    const message = shared ? 'Bu metin bağlı AI aracına açıldı. Araç yalnız bu metni okuyabilir; istediğin an kapatabilirsin.' : 'Bu metin bağlı AI aracına kapatıldı. Araç bir sonraki istekte okuyamaz; önceden okuduğu geri alınamaz.';
    if (state.packet?.id === packetId) text('tool-share-status', message); text('page-status', message);
  }
  async function saveReply() {
    if (!state.packet) throw Error('Önce devam metnini hazırla ya da kayıtlı bir devam metnini aç.');
    const rawText = $('reply-text').value; if (!rawText.trim()) throw Error('AI yanıtını yapıştır.');
    // Pressing the button is the declaration; the reply stays a comment either way.
    const { reply } = await mutation('records-reply', { packetId: state.packet.id, rawText, format: $('reply-format').value, confirmedByUser: true });
    await refresh();
    if (reply.validationStatus === 'invalid') { error('reply-error', reply.validationError || 'Yanıtın biçimi ya da gösterdiği kaynaklar uyuşmuyor. Metnin burada duruyor; düzeltip yeniden kaydedebilirsin.'); text('reply-status', 'Hatalı yanıt da saklandı; içinden kayıt oluşturulamaz.'); return; }
    text('reply-status', 'AI yanıtı saklandı. Görüşlerin ve kararların değişmedi. İçinden bir bölümü kayda geçirmek için aşağıdaki “AI yanıtları”na bak.');
  }
  function renderReplies() {
    const replies = state.data.replies.filter(r => r.topicId === state.topicId), list = $('commentary-list'); list.replaceChildren(); show('commentaries-panel', state.screen === 'topic' && Boolean(replies.length));
    for (const reply of [...replies].sort((a, b) => String(b.createdAt).localeCompare(String(a.createdAt)) || a.id.localeCompare(b.id))) {
      const article = node('article', null, 'commentary'); article.dataset.replyId = reply.id;
      const packet = state.data.packets.find(p => p.id === reply.packetId), label = reply.validationStatus === 'valid' ? 'Gösterdiği kaynaklar doğrulandı · yorumun doğruluğu onaylanmadı' : reply.validationStatus === 'invalid' ? 'Hatalı yanıt · kayıt oluşturulamaz' : 'Düz metin · doğrulanmamış AI yanıtı';
      const body = node('div', reply.commentary || reply.rawText, 'body'); body.tabIndex = 0;
      article.append(node('p', (targets[packet?.target]?.[0] || packet?.target || 'Hizmet belirtilmedi') + ' · ' + date(reply.createdAt), 'small'), node('p', label, 'badge warning'), body);
      if (reply.validationStatus === 'invalid') {
        article.append(node('p', reply.validationError || 'Yanıtın biçimi ya da gösterdiği kaynaklar uyuşmuyor.', 'error'));
        const fix = button('Metni düzeltmek için aç', 'quiet'); fix.onclick = () => { if (!packet) return; openContext(); displayPacket(packet); $('reply-text').value = reply.rawText; $('reply-format').value = 'json'; readiness(); reveal($('reply-panel'), $('reply-text')); }; article.append(fix);
      } else {
        const convert = button('İçinden kayda geçir', 'secondary'); convert.dataset.replyCandidate = reply.id; convert.onclick = () => guard(() => newRecord({ replyId: reply.id }, reply.commentary || reply.rawText, 'Geri getirdiğin AI yanıtı · ' + date(reply.createdAt), 'assistant')); article.append(convert);
      }
      list.append(article);
    }
  }

  // --- Bağlı AI aracı: konu izni ve gelen kutusu ------------------------------
  async function loadExtras() {
    const id = state.topicId;
    if (state.screen !== 'topic' || !currentTopic()) return;
    let extra;
    try { const view = await call('records-topic', { topicId: id }); extra = { topicId: id, openTasks: Array.isArray(view.openTasks) ? view.openTasks.map(r => r.id) : null, toolAccess: view.toolAccess?.read ? view.toolAccess : null }; }
    catch { extra = { topicId: id, openTasks: null, toolAccess: null, failed: true }; }
    if (state.topicId !== id) return;
    state.extra = extra; syncToolAccess(); if (state.screen === 'topic') renderTopic();
  }
  const topicAccess = () => state.extra?.topicId === state.topicId && !state.extra.failed ? state.extra.toolAccess || { read: false, write: false } : null;
  function syncToolAccess() {
    const access = topicAccess(); $('tool-access-read').checked = Boolean(access?.read); $('tool-access-write').checked = Boolean(access?.read && access?.write); error('tool-access-error'); toolAccessReadiness();
  }
  function renderToolAccess() {
    const access = topicAccess(), open = Boolean(access?.read);
    text('tool-access-state', !access ? (state.extra?.topicId === state.topicId ? 'İzin durumu okunamadı. Sayfayı yenile.' : 'İzin durumu okunuyor…') : open ? 'Bağlı AI aracına açık: ' + (access.write ? 'okuma ve öneri' : 'okuma') : 'Bağlı AI aracına kapalı');
    $('tool-access-state').classList.toggle('shared', open); show('tool-access-close', open);
    toolAccessReadiness();
  }
  function toolAccessReadiness() {
    const access = topicAccess(), read = $('tool-access-read').checked;
    if (!read) $('tool-access-write').checked = false;
    $('tool-access-read').disabled = !access; $('tool-access-write').disabled = !access || !read;
    $('tool-access-save').disabled = state.busy || !access || (read === Boolean(access.read) && $('tool-access-write').checked === Boolean(access.write));
    $('tool-access-close').disabled = state.busy;
  }
  async function setToolAccess(read, write) {
    const topicId = state.topicId; if (write && !read) throw Error('Öneri izni için önce okuma iznini aç.');
    await call('records-tool-access', { topicId, read, write, confirmedByUser: true });
    await refresh();
    text('tool-access-status', !read ? 'Bu konu bağlı AI aracına kapatıldı. Araç bir sonraki istekte okuyamaz; önceden okuduğu geri alınamaz.' : 'Bu konu bağlı AI aracına açıldı: ' + (write ? 'okuma ve öneri. Aracın önerileri gelen kutusunda seni bekler.' : 'yalnız okuma.'));
  }
  async function loadInbox() {
    try { const result = await call('inbox'); state.inbox = Array.isArray(result.items) ? result.items : []; state.inboxFailed = false; }
    catch { state.inbox = []; state.inboxFailed = true; }
    renderInbox();
  }
  function renderInbox() {
    const list = $('inbox-list'); list.replaceChildren();
    show('inbox-panel', state.inbox.length > 0 || state.inboxFailed || Boolean($('inbox-status').textContent));
    text('inbox-heading', state.inbox.length ? 'Gelen kutusu · ' + state.inbox.length + ' öneri' : 'Gelen kutusu');
    error('inbox-error', state.inboxFailed ? 'Gelen kutusu okunamadı. Sayfayı yenile; öneriler silinmedi.' : '');
    for (const entry of state.inbox) {
      const item = entry.item || {}, article = node('article', null, 'record-card inbox-item'), meta = node('div', null, 'record-meta'); article.dataset.inboxItem = item.id;
      meta.append(node('span', labels.inbox[item.kind] || 'Öneri', 'badge'), node('span', 'AI önerisi', 'badge warning'));
      article.append(meta, node('p', (item.tool || 'Bağlı AI aracı') + ' · ' + date(item.receivedAt) + ' · Konu: ' + (entry.topicTitle || topicName(item.topicId)), 'small'), node('p', item.text, 'record-text'));
      if (entry.related?.text) article.append(node('p', 'İlgili kayıt: ' + entry.related.text, 'small related'));
      const consent = node('label', null, 'check'), box = document.createElement('input'), accept = button('Deftere al', 'primary'), dismiss = button('Kaldır', 'quiet'), actions = node('div', null, 'actions'), problem = node('p', null, 'error');
      box.type = 'checkbox'; box.dataset.inboxConsent = item.id; consent.append(box, node('span', 'Bu öneriyi okudum; inceleme bekleyen bir AI önerisi olarak defterime eklensin.'));
      accept.dataset.inboxAccept = item.id; accept.disabled = true; dismiss.dataset.inboxDismiss = item.id; problem.setAttribute('role', 'alert'); problem.hidden = true;
      box.onchange = () => { accept.disabled = !box.checked; };
      const at = state.inbox.indexOf(entry);
      accept.onclick = () => run(accept, problem, async () => {
        if (!box.checked) throw Error('Deftere almak için önce kutuyu işaretle.');
        await call('inbox-accept', { itemId: item.id, confirmedByUser: true });
        text('inbox-status', 'Öneri, inceleme bekleyen AI önerisi olarak eklendi (konu: ' + (entry.topicTitle || topicName(item.topicId)) + '). Sen incelemeden görüşün ya da kararın sayılmaz.');
        await refresh(); await loadInbox(); return () => focusInbox(at);
      });
      dismiss.onclick = () => run(dismiss, problem, async () => {
        await call('inbox-dismiss', { itemId: item.id, confirmedByUser: true });
        text('inbox-status', 'Öneri gelen kutusundan kaldırıldı. Defterine hiçbir şey eklenmedi.');
        await loadInbox(); return () => focusInbox(at);
      });
      actions.append(accept, dismiss); article.append(consent, actions, problem); list.append(article);
    }
  }

  // After an item leaves the inbox, focus moves to the one that took its place.
  function focusInbox(index) {
    const items = [...$('inbox-list').querySelectorAll('[data-inbox-item]')], next = items[Math.min(index, items.length - 1)];
    (next?.querySelector('input') || $('inbox-heading')).focus({ preventScroll: true });
  }

  // --- Bakım -------------------------------------------------------------------
  function renderBackups() {
    const previous = $('restore-backup').value; $('restore-backup').replaceChildren(option('', state.data.backups.length ? 'Geri dönülecek yedeği seç' : 'Henüz yedek yok'));
    state.data.backups.forEach((backup, index) => { const id = typeof backup === 'string' ? backup : backup.id || backup.backupId; const item = option(id, (typeof backup === 'string' ? 'Yedek ' + (index + 1) : date(backup.createdAt)) + (backup.valid === false ? ' · bozuk, kullanılamaz' : '')); item.disabled = backup.valid === false; $('restore-backup').append(item); });
    $('restore-backup').value = previous; if ($('restore-backup').selectedIndex < 0) $('restore-backup').value = ''; readiness();
  }
  async function previewMigration() {
    state.migration = await call('records-migration-preview'); $('migration-consent').checked = false;
    const list = $('migration-list'); list.replaceChildren();
    for (const candidate of state.migration.candidates || []) {
      const row = node('article', null, 'record-card'), record = candidate.record || candidate;
      row.append(node('p', record.text || record.statement || record.title || 'Metni okunamayan kayıt', 'record-text'), node('p', 'İnceleme: ' + (labels.review[record.review] || 'önceki durumu korunacak') + ' · Benimseme: ' + (labels.adoption[record.adoption] || 'önceki durumu korunacak') + ' · Güncellik: ' + (labels.currency[record.currency] || 'Belirtilmedi'), 'small'));
      if (record.source?.excerpt) row.append(node('pre', record.source.excerpt)); list.append(row);
    }
    show('migration-panel', true); text('legacy-status', (state.migration.candidates?.length || 0) + ' eski kayıt aktarılabilir. Daha önce eklenenler yeniden çoğaltılmaz.'); readiness();
  }
  async function loadSourceFromUrl() {
    const params = new URLSearchParams(location.search), conversationId = params.get('conversationId'), messageId = params.get('messageId');
    if (!conversationId || !messageId) return;
    const conversation = await call('conversation', { id: conversationId }), message = conversation.messages?.find(m => m.id === messageId);
    if (!message || !['user', 'assistant', 'human'].includes(message.role)) throw Error('Bu söz konuşmada bulunamadı. Konuşmalarım\'a dönüp sözü yeniden seç.');
    if (!state.data.topics.length) { state.pendingSource = { conversation, message }; newRecord(); return; }
    newRecord({ conversationId, messageId }, message.text, conversation.title || 'Başlıksız konuşma', message.role);
  }

  // --- Olaylar -----------------------------------------------------------------
  for (const key of ['review', 'adoption', 'currency', 'priority']) $('record-' + key).replaceChildren(...Object.entries(labels[key]).map(([value, title]) => option(value, title)));
  const toggleTopicForm = open => { show('new-topic-form', open); $('new-topic-toggle').setAttribute('aria-expanded', String(open)); if (open) $('topic-name').focus(); };
  $('new-topic-toggle').onclick = () => toggleTopicForm($('new-topic-form').hidden);
  $('first-run-topic').onclick = () => toggleTopicForm(true);
  $('new-topic-form').onsubmit = event => { event.preventDefault(); run('topic-save', 'topic-error', async () => {
    const title = $('topic-name').value.trim(); if (!title) throw Error('Konu adını yaz.');
    const { topic } = await mutation('records-topic-create', { title, goal: $('topic-purpose').value.trim() }); state.topicId = topic.id; state.screen = 'topic'; await refresh(); history.replaceState(null, '', '/konular?topicId=' + encodeURIComponent(topic.id)); $('new-topic-form').reset(); toggleTopicForm(false);
    text('page-status', 'Konu oluşturuldu. “+ Yeni kayıt” ile kendi notunu yazabilir ya da Konuşmalarım\'daki bir sözünü kayda geçirebilirsin.');
    if (state.pendingSource) { const { conversation, message } = state.pendingSource; state.pendingSource = null; return () => newRecord({ conversationId: conversation.id, messageId: message.id }, message.text, conversation.title, message.role); }
    return () => $('new-record').focus({ preventScroll: true });
  }); };
  $('nav-overview').onclick = () => guard(() => selectGlobal('overview')); $('nav-review').onclick = () => guard(() => selectGlobal('review')); $('overview-open-review').onclick = () => guard(() => selectGlobal('review'));
  $('global-decision-candidates').onclick = () => guard(() => { $('review-topic-filter').value = ''; $('review-kind-filter').value = 'decision'; $('review-search').value = ''; state.queuePage = 0; selectGlobal('review'); history.replaceState(null, '', '/konular?view=review&kind=decision'); });
  $('topic-search').oninput = renderTopics;
  for (const id of ['review-topic-filter', 'review-kind-filter', 'review-search']) $(id).addEventListener(id === 'review-search' ? 'input' : 'change', () => { state.queuePage = 0; renderReviewQueue(); });
  const turnPage = step => { state.queuePage += step; renderReviewQueue(); reveal($('global-review'), $('global-review-heading')); };
  $('global-review-heading').tabIndex = -1;
  $('review-prev').onclick = () => { if (state.busy || state.queuePage === 0) return; turnPage(-1); };
  $('review-next').onclick = () => { if (state.busy || (state.queuePage + 1) * 20 >= filteredQueue().length) return; turnPage(1); };
  $('review-source-more').onclick = () => { if (state.busy) return; state.sourceCheckLimit += 6; renderSourceChecks(); };
  $('review-open-first').onclick = () => { const record = filteredQueue()[state.queuePage * 20]; if (record) guard(() => openGlobalRecord(record), record); };
  $('new-record').onclick = () => guard(() => newRecord());
  $('record-close').onclick = () => guard(() => { closeEditor(); $('new-record').focus?.({ preventScroll: true }); });
  $('record-discard-yes').onclick = () => { const proceed = state.afterDiscard; markClean(); show('record-discard', false); state.afterDiscard = null; if (proceed) proceed(); };
  $('record-discard-no').onclick = () => { show('record-discard', false); state.afterDiscard = null; $('record-text').focus({ preventScroll: true }); };
  $('record-kind').onchange = updateKind;
  $('record-topic').onchange = () => { renderAnswerQuestions(); updateKind(); };
  $('record-form').onsubmit = event => { event.preventDefault(); run('record-save', 'record-error', () => saveRecord()); };
  $('record-save-adopt').onclick = () => run('record-save-adopt', 'record-error', () => saveRecord({ adopt: true }));
  $('record-save-next').onclick = () => run('record-save-next', 'record-error', () => saveRecord({ next: true }));
  for (const [id, quick] of [['quick-adopt', 'adopt'], ['quick-hypothesis', 'hypothesis'], ['quick-reject', 'reject'], ['quick-keep-open', 'keepOpen']]) $(id).onclick = () => run(id, 'record-error', () => saveRecord({ quick }));
  $('quick-consent').onchange = quickReadiness; $('question-close-consent').onchange = quickReadiness;
  $('question-close-apply').onclick = () => run('question-close-apply', 'record-error', () => saveRecord({ close: true }));
  for (const view of ['current', 'pending', 'all']) $('view-' + view).onclick = () => { state.view = view; state.recordLimit = 30; renderTopic(); };
  $('context-open').onclick = openContext; $('context-close').onclick = () => { show('context-panel', false); $('context-open').focus({ preventScroll: true }); };
  $('context-include-ai').onchange = () => { invalidatePacket(); if (!$('context-include-ai').checked) for (const record of topicRecords().filter(isSelectableProposal)) state.selected.delete(record.id); renderContextChoices(); };
  for (const id of ['context-question', 'context-target', 'context-model']) $(id).addEventListener(id === 'context-target' ? 'change' : 'input', invalidatePacket);
  $('context-prepare').onclick = () => run('context-prepare', 'context-error', prepareContext);
  $('context-consent').onchange = readiness; $('tool-share-consent').onchange = readiness;
  $('tool-share-open').onclick = () => run('tool-share-open', 'context-error', () => setToolShare(state.packet?.id, true));
  $('tool-share-close').onclick = () => run('tool-share-close', 'context-error', () => setToolShare(state.packet?.id, false));
  const replyChanged = () => { error('reply-error'); readiness(); };
  $('reply-text').oninput = replyChanged; $('reply-format').onchange = replyChanged;
  $('context-copy').onclick = () => run('context-copy', 'context-error', async () => { if (!state.packet || !$('context-consent').checked) throw Error('Önce metni oku ve kutuyu işaretle.'); if (!navigator.clipboard?.writeText) throw Error('Pano erişilemiyor. Tam metni yukarıdaki önizlemeden seçip kopyalayabilirsin.'); await navigator.clipboard.writeText(state.packet.text); text('context-copy-status', 'Metin panoya kopyalandı. Kendi sohbet hesabına yapıştır; gelen yanıtı aşağıya getir.'); });
  $('reply-save').onclick = () => run('reply-save', 'reply-error', saveReply);
  $('tool-access-read').onchange = toolAccessReadiness; $('tool-access-write').onchange = toolAccessReadiness;
  $('tool-access-save').onclick = () => run('tool-access-save', 'tool-access-error', () => setToolAccess($('tool-access-read').checked, $('tool-access-read').checked && $('tool-access-write').checked));
  $('tool-access-close').onclick = () => run('tool-access-close', 'tool-access-error', async () => { await setToolAccess(false, false); return () => $('tool-access-details').querySelector('summary').focus({ preventScroll: true }); });
  for (const id of ['topic-title', 'global-overview-heading', 'inbox-heading']) $(id).tabIndex = -1;
  $('backup-create').onclick = () => run('backup-create', 'maintenance-error', async () => { const backup = await call('records-backup'); await refresh(); $('restore-backup').value = backup.backupId; readiness(); const saved = state.data.backups.find(b => (b.id || b.backupId) === backup.backupId); text('maintenance-status', 'Yedek alındı (' + date(saved?.createdAt || new Date().toISOString()) + '). Yalnız konularını ve kayıtlarını içerir; konuşmaların ve Arşiv ayrı durur. Bu bilgisayarda, töre\'nin veri klasöründe saklanıyor.'); });
  $('topic-conversation-search').oninput = () => { state.conversationLimit = 20; renderConversationLinks(); };
  $('topic-conversations-more').onclick = () => { state.conversationLimit += 20; renderConversationLinks(); };
  $('bulk-preview').onclick = () => run('bulk-preview', 'bulk-error', previewBulk);
  $('bulk-consent').onchange = readiness;
  $('bulk-apply').onclick = () => run('bulk-apply', 'bulk-error', async () => {
    if (!state.bulk || !$('bulk-consent').checked) throw Error('Eklemek için önce kutuyu işaretle.');
    const result = await call('records-bulk-apply', { previewHash: state.bulk.previewHash, confirmedByUser: true });
    state.bulk = null; $('bulk-consent').checked = false; show('bulk-preview-panel', false); await refresh(); invalidatePacket();
    text('bulk-status', result.alreadyApplied ? 'Bu konuşmalar zaten konularında; yeniden eklenmedi.' : result.linked + ' konuşma bağlantısı ve ' + result.candidatesCreated + ' inceleme bekleyen kayıt eklendi. Önce bir yedek alındı.');
    text('page-status', 'Konuşmaların konulara yerleşti. Şimdi “İnceleme bekleyenler”i açıp kayıtları incele.');
  });
  $('migration-preview').onclick = () => run('migration-preview', 'legacy-error', previewMigration);
  $('migration-consent').onchange = readiness;
  $('migration-apply').onclick = () => run('migration-apply', 'legacy-error', async () => { if (!state.migration || !$('migration-consent').checked) throw Error('Aktarmak için önce kutuyu işaretle.'); const result = await call('records-migration-apply', { previewHash: state.migration.previewHash, confirmedByUser: true }); await refresh(); state.migration = null; show('migration-panel', false); invalidatePacket(); text('legacy-status', result.imported + ' kayıt eklendi. Aktarımdan önce bir yedek alındı.'); });
  $('restore-consent').onchange = readiness; $('restore-backup').onchange = () => { $('restore-consent').checked = false; readiness(); };
  $('restore-apply').onclick = () => run('restore-apply', 'maintenance-error', async () => { if (!$('restore-consent').checked || !$('restore-backup').value) throw Error('Geri dönülecek yedeği seç ve kutuyu işaretle.'); await call('records-restore', { backupId: $('restore-backup').value, expectedStateHash: state.data.stateHash, confirmedByUser: true }); closeEditor(); await refresh(); invalidatePacket(); $('restore-consent').checked = false; readiness(); await loadInbox(); text('maintenance-status', 'Konuların ve kayıtların seçtiğin yedeğe döndü. Konuşmaların ve eski görüş defterin değişmedi; bağlı AI aracı izinleri kapandı.'); });
  async function initialize() { error('page-error'); show('reload', false); try {
    const params = new URLSearchParams(location.search); state.topicId = params.get('topicId') || '';
    if (params.has('kind') && ['opinion', 'decision', 'question', 'task'].includes(params.get('kind'))) $('review-kind-filter').value = params.get('kind');
    state.screen = params.get('view') === 'review' ? 'review' : params.get('view') === 'overview' ? 'overview' : params.has('topicId') || params.has('conversationId') ? 'topic' : 'overview';
    await refresh(); await loadSourceFromUrl();
    const record = state.data.records.find(r => r.id === params.get('recordId')); if (record && state.screen !== 'topic') openGlobalRecord(record);
    text('page-status', 'Konuların hazır.');
    await loadInbox();
  } catch (e) { error('page-error', friendly(e.message)); show('reload', true); } }
  $('reload').onclick = initialize; initialize();
})();
