import { api, download } from '/private-client.js';

// All conversation content is rendered as text. The only browser-stored capability
// belongs to private-client; provider keys are sent once to the local RAM service.
(() => {
  'use strict';
  const $ = id => document.getElementById(id);
  const CC_LIMIT = 50, CC_PAGE = 100;
  const state = {
    conversations: [], conversation: null, leafId: '', rows: new Map(), developers: [],
    catalog: { models: [] }, catalogRefreshed: false, keyConfigured: false,
    draft: null, revision: 0, preview: null, previewRevision: 0,
    loadSequence: 0, busy: new Set(), scanned: false, drafts: [], draftBlocked: false, resultDraftId: null,
    transfer: false, stale: false, cc: { sessions: [], selected: new Set(), shown: CC_PAGE }
  };
  // One vocabulary for the whole notebook: "sen", "konuşma", "kayıt", "devam metni".
  const roles = { user: 'Sen', human: 'Sen', assistant: 'AI yanıtı', system: 'Sistem kaydı', developer: 'Geliştirici kaydı', tool: 'Araç kaydı', unknown: 'Konuşmacı belirsiz' };
  const authorships = [['unreviewed', 'Belirtilmedi'], ['human_original', 'Ben yazdım'], ['ai_output', 'AI üretti'], ['third_party', 'Başka birine ait']];
  const maskNames = { email: 'E-posta', phone: 'Telefon', key: 'Anahtar', path: 'Dosya yolu', literal: 'Özel ifade' };
  const maskTokens = { email: '[E-POSTA]', phone: '[TELEFON]', key: '[ANAHTAR]', path: '[DOSYA YOLU]', literal: '[ÖZEL İFADE]' };
  const modeNames = { manual: 'Kopyala ya da indir', live: 'Canlı · ücretsiz model', simulation: 'Deneme · örnek yanıt' };
  const importHelp = {
    chatgpt: ['ChatGPT’de Ayarlar > Veri denetimleri > Verileri dışa aktar’a bas.', 'E-postana gelen bağlantıdan ZIP dosyasını indir.', 'ZIP’i açmadan aşağıdan seç.'],
    claude: ['Claude’da Ayarlar > Gizlilik > Verileri dışa aktar’a bas.', 'E-postana gelen bağlantıdan dosyayı indir.', 'İndirdiğin ZIP’i ya da içindeki conversations.json dosyasını aşağıdan seç.'],
    codex: ['Codex oturumların bu bilgisayarda, ev klasöründeki .codex/sessions altında durur.', 'Almak istediğin oturumun .jsonl dosyasını aşağıdan seç.'],
    text: ['Konuşmayı öbür uygulamada seçip kopyala.', 'Aşağıdaki kutuya yapıştır ve bir başlık ver.'],
    file: ['Bu, töre’nin kendi konuşma biçiminde kaydedilmiş bir .json dosyasıdır.', 'Elinde böyle bir dosya yoksa “Kopyaladığım metin”i seç.']
  };
  const fileHints = { chatgpt: 'ZIP ya da conversations.json', claude: 'ZIP ya da conversations.json', codex: '.jsonl ya da .jsonl.zst', generic: '.json' };
  // Known service messages, rewritten to say what happened and what to do next.
  const knownErrors = [
    [/Yerel oturum açık değil|geçerli yanıt vermedi/, 'töre’nin bağlantısı kopmuş. Başlat.command dosyasına yeniden çift tıkla; konuşmaların yerinde duruyor.'],
    [/şeması bulunamadı|dizisi veya nesnesi bekleniyor/, 'Bu dosya seçtiğin kaynağın dışa aktarımına benzemiyor. “Nereden alıyorsun?” seçimini kontrol et; ZIP dosyasının kendisini ya da içindeki conversations.json dosyasını seç.'],
    [/güvenli olmayan bir dosya yolu/, 'Bu ZIP dosyası güvenle açılamadı; hiçbir şey içe alınmadı. Dışa aktarımı yeniden indirip tekrar dene.'],
    [/çok fazla düğüm/, 'Bu dosyadaki bir konuşma töre için fazla uzun; hiçbir şey içe alınmadı.'],
    [/1 ile 50 arasında oturum|Oturum seçin/, 'Bir seferde 1 ile 50 arasında oturum önizlenir. Seçimini buna göre düzelt.'],
    [/Claude Code oturumu (?:bulunamadı|okunamadı)|Oturum kimliği geçersiz/, 'Seçtiğin oturumlardan biri artık okunamıyor. Oturumları yeniden göster ve tekrar seç.'],
    [/Ev klasörü bulunamadı/, 'Bu bilgisayarda Claude Code oturumlarının durduğu klasör bulunamadı.'],
    [/İşlem tamamlanamadı; başarı bildirilmedi/, 'İşlem tamamlanamadı; hiçbir şey değişmedi. Yeniden deneyebilirsin.']
  ];
  const friendly = message => knownErrors.find(([pattern]) => pattern.test(message))?.[1] || message;
  const call = (op, payload = {}) => api('/api/private/tore/' + op, payload);
  const text = (id, value) => { $(id).textContent = value ?? ''; };
  const show = (id, visible) => { $(id).hidden = !visible; };
  function node(tag, content, className) {
    const n = document.createElement(tag);
    if (content !== undefined && content !== null) n.textContent = String(content);
    if (className) n.className = className;
    return n;
  }
  function option(value, label, disabled = false) {
    const n = node('option', label); n.value = value; n.disabled = disabled; return n;
  }
  function labeled(labelText, control, className) {
    const n = node('label', labelText, className); n.append(control); return n;
  }
  function status(message, error = false) {
    text('global-status', message); $('global-status').classList.toggle('error', error);
  }
  function dateLabel(value) {
    if (!value) return 'Tarih belirtilmemiş';
    const date = new Date(value);
    return Number.isNaN(date.getTime()) ? 'Tarih belirtilmemiş' : date.toLocaleDateString('tr-TR', { day: 'numeric', month: 'short', year: 'numeric' });
  }
  function sizeLabel(bytes) {
    const n = Number(bytes) || 0;
    if (n < 1024) return n + ' B';
    if (n < 1024 * 1024) return Math.round(n / 1024) + ' KB';
    return (n / (1024 * 1024)).toLocaleString('tr-TR', { maximumFractionDigits: 1 }) + ' MB';
  }
  // Claude Code names a project folder after its path ("-Users-ad-Desktop-proje"); the home prefix is noise.
  function projectName(raw) {
    return String(raw || '').replace(/^-(?:Users|home)-[^-]+-?/, '').replace(/^-+/, '') || 'Ev klasörü';
  }
  function reveal(element) {
    const calm = window.matchMedia?.('(prefers-reduced-motion: reduce)')?.matches;
    element.scrollIntoView?.({ behavior: calm ? 'auto' : 'smooth', block: 'start' });
  }
  const SOURCE_NAMES = { chatgpt: 'ChatGPT', claude: 'Claude', codex: 'Codex', generic: 'Diğer kaynak' };
  const developerName = id => SOURCE_NAMES[id] || state.developers.find(d => d.id === id)?.name || id || 'Belirtilmemiş';
  const selectedRows = () => [...state.rows.values()].filter(row => row.checked);
  const effectiveMode = () => $('run-mode').value;
  const selectedModel = () => state.catalog.models.find(model => model.id === $('target-model').value && model.developer === $('target-developer').value);
  const zeroPrice = value => value === 0 || (typeof value === 'string' && /^(?:0+(?:\.0*)?|\.0+)$/.test(value));
  const freeModel = model => model?.free === true && zeroPrice(model.pricing?.prompt) && zeroPrice(model.pricing?.completion);
  const recordable = message => ['user', 'assistant'].includes(message.role) && !['analysis', 'reasoning', 'tool'].includes(message.phase);
  const recordHref = message => '/konular?conversationId=' + encodeURIComponent(state.conversation.id) + '&messageId=' + encodeURIComponent(message.id);

  // An error appears next to the button that caused it, never only at the top of the page.
  const errorSlots = new WeakMap();
  function errorSlot(button) {
    if (button.id === 'prepare-draft') return $('action-error');
    let slot = errorSlots.get(button);
    if (slot?.isConnected) return slot;
    if (!button.isConnected) return null;
    slot = node('p', null, 'error'); slot.setAttribute('role', 'alert'); slot.hidden = true;
    (button.closest('.actions') || button).after(slot); errorSlots.set(button, slot);
    return slot;
  }
  function showError(button, message) {
    const slot = errorSlot(button);
    if (slot) { slot.textContent = message; slot.hidden = !message; }
    else if (message) status(message, true);
  }
  async function run(button, action, statusId) {
    if (state.busy.has(button.id)) return;
    state.busy.add(button.id); button.disabled = true; showError(button, '');
    try { await action(); }
    catch (error) {
      if (statusId) text(statusId, '');
      showError(button, friendly(error?.message || 'İşlem tamamlanamadı. Yeniden deneyebilirsin.'));
    } finally { state.busy.delete(button.id); button.disabled = false; updateReady(); }
  }
  function invalidate() {
    state.revision += 1;
    if (state.draft) state.stale = true;
    state.draft = null; state.draftBlocked = false; show('draft-panel', false);
    $('send-consent').checked = false;
    showError($('prepare-draft'), ''); updateReady();
  }
  function renderWelcome() {
    const any = state.conversations.length > 0;
    text('welcome-heading', any ? 'Bir konuşma aç.' : 'Burada AI konuşmaların durur.');
    text('welcome-text', any ? 'Listeden bir konuşma seç; önemli sözlerini kayda geçir. İstersen yeni bir konuşma da içe alabilirsin.' : 'Önce bir konuşma içe al. Sonra önemli sözlerini kayda geçirir, Konularım’da kaldığın yerden devam edersin.');
    $('welcome-import').className = any ? 'secondary' : 'primary';
  }
  function renderList() {
    const list = $('conversation-list'); list.replaceChildren();
    text('conversation-count', state.conversations.length);
    const query = $('conversation-search').value.toLocaleLowerCase('tr').trim();
    const matches = state.conversations.filter(c => [c.title, c.provider, c.sourceApp, developerName(c.provider)].join(' ').toLocaleLowerCase('tr').includes(query));
    if (!matches.length) list.append(node('p', query ? 'Bu aramayla eşleşen konuşma yok.' : 'Henüz konuşma yok. “+ İçe al” ile ilkini ekle.', 'small empty'));
    for (const c of matches) {
      const button = node('button', null, 'conversation-card'); button.type = 'button'; button.dataset.conversationId = c.id;
      button.setAttribute('aria-current', String(state.conversation?.id === c.id));
      button.append(node('span', developerName(c.provider), 'card-provider'), node('span', c.title || 'Başlıksız konuşma', 'card-title'), node('span', (c.messages?.length ?? 0) + ' mesaj · ' + dateLabel(c.updatedAt || c.createdAt), 'card-meta'));
      button.addEventListener('click', () => run(button, () => openConversation(c.id)));
      list.append(button);
    }
    renderWelcome();
  }
  function leaves(conversation) {
    const parents = new Set(conversation.messages.map(m => m.parentId).filter(Boolean));
    return conversation.messages.filter(message => !parents.has(message.id));
  }
  // With several endings, open the most recent one instead of an empty page.
  function latestLeaf(ends) {
    let best = ends[ends.length - 1], bestTime = -Infinity;
    for (const end of ends) { const time = Date.parse(end.timestamp || ''); if (!Number.isNaN(time) && time >= bestTime) { bestTime = time; best = end; } }
    return best;
  }
  function branchMessages() {
    if (!state.conversation || !state.leafId) return [];
    const byId = new Map(state.conversation.messages.map(message => [message.id, message]));
    const path = [], visited = new Set(); let current = byId.get(state.leafId);
    while (current && !visited.has(current.id)) {
      path.unshift(current); visited.add(current.id); current = current.parentId ? byId.get(current.parentId) : null;
    }
    return path;
  }
  async function openConversation(id) {
    const sequence = ++state.loadSequence;
    const conversation = await call('conversation', { id });
    if (sequence !== state.loadSequence) return;
    setConversation(conversation);
  }
  function setConversation(conversation) {
    invalidate(); state.conversation = conversation;
    const index = state.conversations.findIndex(c => c.id === conversation.id);
    if (index >= 0) state.conversations[index] = conversation; else state.conversations.unshift(conversation);
    text('conversation-title', conversation.title || 'Başlıksız konuşma');
    text('conversation-source', developerName(conversation.provider) + ' · ' + (conversation.sourceApp || 'içe alınmış konuşma'));
    text('conversation-meta', conversation.messages.length + ' mesaj · ' + dateLabel(conversation.createdAt));
    text('conversation-warnings', (conversation.warnings || []).join('\n')); show('conversation-warnings', Boolean(conversation.warnings?.length));
    const ends = leaves(conversation), selector = $('branch-leaf');
    selector.replaceChildren();
    for (const [index, leaf] of ends.entries()) selector.append(option(leaf.id, 'Sürüm ' + (index + 1) + ' · son söz: ' + leaf.text.slice(0, 65).replace(/\s+/g, ' ')));
    state.leafId = ends.some(end => end.id === conversation.selectedLeafId) ? conversation.selectedLeafId : ends.length ? latestLeaf(ends).id : '';
    selector.value = state.leafId;
    show('branch-bar', ends.length > 1);
    text('branch-hint', ends.length > 1 ? 'Bu konuşmanın ' + ends.length + ' sürümü var; bir yanıtı yeniden yazdırdığında ayrı bir sürüm oluşur. En son sürüm açık, öbürlerini buradan seçebilirsin.' : '');
    text('import-done', ''); show('import-done', false);
    show('welcome', false); show('conversation-workspace', true);
    initializeRows(); renderList();
  }
  function initializeRows() {
    state.rows = new Map(branchMessages().map(message => [message.id, { message, checked: false, role: message.role === 'unknown' ? '' : message.role, text: message.text, authorship: 'unreviewed', rights: 'unreviewed', feedback: '' }]));
    state.scanned = false; show('pii-review', false);
    const own = [...state.rows.values()].map(row => row.message).filter(message => message.role === 'user' && recordable(message)).at(-1);
    show('primary-record', Boolean(own)); if (own) $('primary-record').href = recordHref(own);
    renderMessages(); updateReady();
  }
  function renderMessages() {
    const list = $('message-list'); list.replaceChildren();
    if (!state.rows.size) { list.append(node('p', state.conversation?.messages.length ? 'Bu sürümde gösterilecek mesaj yok. Yukarıdan başka bir sürüm seç.' : 'Bu konuşmada okunabilir metin yok.', 'small empty')); return; }
    for (const row of state.rows.values()) {
      const message = row.message, card = node('article', null, 'message-card' + (row.checked ? ' is-selected' : ''));
      card.dataset.messageId = message.id;
      const selectable = ['user', 'assistant', 'unknown'].includes(message.role);
      const check = document.createElement('input'); check.type = 'checkbox'; check.checked = row.checked; check.dataset.action = 'select-message';
      check.disabled = !selectable; check.hidden = !state.transfer;
      const heading = node('div', null, 'message-card-heading');
      const selectLabel = node('label', null, 'check'); selectLabel.append(check, node('span', roles[message.role] || message.role || 'Konuşmacı belirsiz', 'message-role'));
      heading.append(selectLabel);
      if (recordable(message)) {
        const recordLink = node('a', 'Kayda geçir', 'link-button record-link');
        recordLink.dataset.sourceRecord = message.id; recordLink.href = recordHref(message);
        heading.append(recordLink);
      }
      card.append(heading);
      const original = node('p', message.text, 'message-body'); original.hidden = row.checked; original.tabIndex = 0; card.append(original);
      const editor = node('div', null, 'message-editor'); editor.hidden = !row.checked;
      let roleSelect;
      if (message.role === 'unknown') {
        roleSelect = document.createElement('select'); roleSelect.dataset.field = 'role';
        roleSelect.append(option('', 'Kimin söylediğini seç'), option('user', 'Ben'), option('assistant', 'AI')); roleSelect.value = row.role;
        editor.append(labeled('Bunu kim söyledi?', roleSelect));
      }
      const area = document.createElement('textarea'); area.value = row.text; area.rows = Math.min(12, Math.max(4, row.text.split('\n').length + 1)); area.dataset.field = 'text'; area.spellcheck = false;
      editor.append(labeled('Götüreceğin metin (yalnız bu kopya değişir)', area));
      const source = document.createElement('details'); source.append(node('summary', 'Değişmemiş özgün metin'), node('pre', message.text)); editor.append(source);
      const extra = document.createElement('details'), fields = node('div', null, 'field-grid'); extra.append(node('summary', 'Ayrıntı'));
      const authorship = document.createElement('select'); authorship.dataset.field = 'authorship'; authorship.append(...authorships.map(([v, label]) => option(v, label, v === 'human_original' && row.role === 'assistant'))); authorship.value = row.authorship;
      if (roleSelect) roleSelect.addEventListener('change', () => {
        row.role = roleSelect.value; authorship.querySelector('[value="human_original"]').disabled = row.role === 'assistant';
        if (row.role === 'assistant' && row.authorship === 'human_original') { row.authorship = 'unreviewed'; authorship.value = row.authorship; }
        invalidate();
      });
      const rights = document.createElement('select'); rights.dataset.field = 'rights'; rights.append(option('unreviewed', 'Belirtilmedi'), option('user_attested', 'Bu metni kullanma hakkım var')); rights.value = row.rights;
      fields.append(labeled('Bu metni kim yazdı?', authorship), labeled('Kullanma hakkın', rights));
      const feedback = document.createElement('input'); feedback.type = 'text'; feedback.value = row.feedback; feedback.placeholder = 'Örn. bu öneriyi reddettim'; feedback.dataset.field = 'feedback';
      extra.append(node('p', 'Bunlar isteğe bağlıdır; devam metnine not olarak eklenir.', 'small'), fields, labeled('Bu mesaja notun', feedback, 'feedback-label')); editor.append(extra); card.append(editor);
      if (message.attachments?.length) card.append(node('p', 'Ekler (içe alınmaz): ' + message.attachments.join(' · '), 'small attachments'));
      if (!selectable) card.append(node('p', 'Bu bir sistem ya da araç kaydı; kayda geçirilemez ve başka modele götürülemez.', 'small'));
      if (message.model) card.append(node('p', 'Model: ' + message.model, 'small source-info'));
      const place = message.sourceLocator || message.sourceId;
      if (place) { const detail = document.createElement('details'); detail.className = 'detail'; detail.append(node('summary', 'Ayrıntı'), node('p', 'Kaynak dosyadaki yeri: ' + place + (message.phase ? ' · ' + message.phase : ''), 'small')); card.append(detail); }
      check.addEventListener('change', () => { row.checked = check.checked; editor.hidden = !row.checked; original.hidden = row.checked; card.classList.toggle('is-selected', row.checked); invalidate(); if (state.scanned) renderScan(); });
      for (const [control, field, event] of [[area, 'text', 'input'], [authorship, 'authorship', 'change'], [rights, 'rights', 'change'], [feedback, 'feedback', 'input']]) {
        control.addEventListener(event, () => { row[field] = control.value; invalidate(); if (state.scanned && (field === 'text' || field === 'feedback')) renderScan(); });
      }
      list.append(card);
    }
  }
  function setTransfer(open) {
    state.transfer = open;
    if (!open) for (const row of state.rows.values()) row.checked = false;
    show('continue-panel', open); show('transfer-tools', open); show('selection-count', open);
    $('continue-toggle').setAttribute('aria-expanded', String(open)); $('work-grid').classList.toggle('with-continue', open);
    invalidate(); renderMessages();
    if (open) { $('destination-heading').focus(); reveal($('work-grid')); }
  }
  function populateDevelopers() {
    for (const id of ['target-developer', 'import-developer']) {
      const selector = $(id), previous = selector.value;
      selector.replaceChildren(...state.developers.map(d => option(d.id, d.name)));
      if (state.developers.some(d => d.id === previous)) selector.value = previous;
    }
    renderModels(); renderList();
  }
  function renderModels() {
    const selector = $('target-model'), previous = selector.value, models = state.catalog.models.filter(model => model.developer === $('target-developer').value);
    selector.replaceChildren(option('', models.length ? 'Ücretsiz bir model seç' : 'Bu AI için model yok'));
    for (const model of models) selector.append(option(model.id, model.name + (freeModel(model) ? ' · ücretsiz' : ' · kapalı'), !freeModel(model) || !state.catalogRefreshed));
    if (models.some(model => model.id === previous && freeModel(model)) && state.catalogRefreshed) selector.value = previous;
    text('model-hint', !state.catalogRefreshed ? 'Canlı kullanım için “Bağlantı ayarları”ndan model listesini yenile.' : models.some(freeModel) ? 'Yalnız ücreti sıfır olan modeller seçilebilir; gönderirken yeniden denetlenir.' : 'Bu AI için ücretsiz model bulunamadı. Başka bir AI seç ya da “Kopyala ya da indir”e dön.');
    updateReady();
  }
  function updateReady() {
    const selected = selectedRows(), mode = effectiveMode(), live = mode === 'live';
    text('selection-count', selected.length + ' seçili');
    show('model-field', live); show('model-hint', live); show('settings-toggle', live);
    if (!live && !$('settings-panel').hidden) { show('settings-panel', false); $('settings-toggle').setAttribute('aria-expanded', 'false'); }
    text('mode-status', live ? 'Onayından sonra seçtiğin metin ve sorun internetteki modele gönderilir. Ücretli modeller kapalıdır.' : mode === 'simulation' ? 'İnternete çıkmaz. Gelen yanıt gerçek bir modelden değil, akışı denemek için üretilmiş bir örnektir.' : 'töre hiçbir yere göndermez. Hazırlanan devam metnini kendin kopyalar ya da indirirsin.');
    $('mode-status').classList.toggle('simulation', mode === 'simulation');
    let reason = '';
    if (!state.conversation || !state.leafId) reason = 'Önce bir konuşma aç.';
    else if (!selected.length) reason = 'Götürmek istediğin en az bir mesajı işaretle.';
    else if (selected.length > 64) reason = 'Bir devam metnine en fazla 64 mesaj girer. Seçimini azalt.';
    else if (selected.some(row => !row.text.trim())) reason = 'Seçili mesajlardan biri boş. Metnini yaz ya da seçimini kaldır.';
    else if (selected.some(row => !['user', 'assistant'].includes(row.role))) reason = 'Konuşmacısı belirsiz mesajda bunu kimin söylediğini seç.';
    else if (selected.some(row => row.role === 'assistant' && row.authorship === 'human_original')) reason = 'AI yanıtını “Ben yazdım” diye işaretleyemezsin.';
    else if (!$('target-developer').value) reason = 'Hangi AI için hazırlayacağını seç.';
    else if (!$('target-question').value.trim()) reason = 'Yeni sorunu yaz.';
    else if (live && !state.catalogRefreshed) reason = 'Canlı kullanım için “Bağlantı ayarları”ndan model listesini yenile.';
    else if (live && !state.keyConfigured) reason = 'Canlı kullanım için “Bağlantı ayarları”na anahtarını ekle.';
    else if (live && !freeModel(selectedModel())) reason = 'Ücretsiz bir model seç.';
    $('prepare-draft').disabled = Boolean(reason) || state.busy.has('prepare-draft'); text('prepare-hint', reason || (state.stale ? 'Seçimin değişti. Devam metnini yeniden önizle.' : 'Hazır. Önce metnin tamamını görürsün.'));
    $('execute-draft').disabled = !state.draft || state.draftBlocked || !$('send-consent').checked || state.busy.has('execute-draft');
    const previewChecks = [...$('import-preview-list').querySelectorAll('input[type=checkbox]')], previewChosen = previewChecks.filter(check => check.checked).length;
    $('commit-import').disabled = !state.preview || !previewChosen || state.busy.has('commit-import');
    text('preview-count', previewChecks.length ? previewChosen + ' / ' + previewChecks.length + ' seçili' : '');
    $('scan-pii').disabled = !selected.length; $('apply-masks').disabled = !selected.length;
    const chosen = state.cc.selected.size;
    $('cc-preview').disabled = !chosen || chosen > CC_LIMIT || state.busy.has('cc-preview');
    text('cc-count', state.cc.sessions.length ? chosen + ' seçili · en fazla ' + CC_LIMIT : '');
  }

  function findings(value) {
    const result = [];
    const addMatches = (kind, expression) => { for (const match of value.matchAll(expression)) result.push({ kind, value: match[0], start: match.index, end: match.index + match[0].length }); };
    addMatches('email', /[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/gi);
    addMatches('key', /\b(?:sk-[A-Za-z0-9_-]{8,}|bearer\s+[A-Za-z0-9_-]{8,}|gh[pousr]_[A-Za-z0-9]{15,}|github_pat_[A-Za-z0-9_]{15,}|AIza[A-Za-z0-9_-]{20,})\b/gi);
    addMatches('key', /\b(?:api[_ -]?key|token|secret|password)\s*[:=]\s*[^\s,;]{6,}/gi);
    addMatches('path', /(?:\/(?:Users|home|private|tmp|var|Volumes|etc|opt)\/[^\s<>"']+|[A-Za-z]:\\[^\s<>"']+|file:\/\/[^\s]+)/g);
    for (const match of value.matchAll(/(?:\+\d{1,3}[\s.-]?)?(?:\(?\d{2,4}\)?[\s.-]){2,4}\d{2,4}|\+\d{9,15}|\b\d{10,15}\b/g)) {
      const digits = match[0].replace(/\D/g, '');
      if (digits.length >= 9 && digits.length <= 15 && !/^\d{4}-\d{2}-\d{2}$/.test(match[0])) result.push({ kind: 'phone', value: match[0], start: match.index, end: match.index + match[0].length });
    }
    for (const literal of [...new Set($('literal-masks').value.split('\n').map(s => s.trim()).filter(Boolean))]) {
      let start = value.indexOf(literal);
      while (start >= 0) { result.push({ kind: 'literal', value: literal, start, end: start + literal.length }); start = value.indexOf(literal, start + literal.length); }
    }
    return result;
  }
  function masked(value) {
    const applicable = findings(value).filter(finding => finding.kind === 'literal' || $('mask-' + finding.kind).checked).sort((a, b) => a.start - b.start || b.end - a.end);
    let result = '', cursor = 0;
    for (const finding of applicable) {
      if (finding.start < cursor) continue;
      result += value.slice(cursor, finding.start) + maskTokens[finding.kind]; cursor = finding.end;
    }
    return result + value.slice(cursor);
  }
  function renderScan() {
    state.scanned = true; show('pii-review', true);
    const before = selectedRows().flatMap(row => findings(row.message.text)), after = selectedRows().flatMap(row => [...findings(row.text), ...findings(row.feedback)]);
    text('pii-before-count', before.length + ' bulgu'); text('pii-after-count', after.length + ' bulgu');
    const list = $('pii-findings'); list.replaceChildren();
    if (!after.length) list.append(node('p', 'Götüreceğin kopyada bu örüntülerle eşleşen bilgi kalmadı. Metnin tamamını yine de oku.', 'small'));
    const unique = [...new Map(after.map(finding => [finding.kind + '\0' + finding.value, finding])).values()];
    for (const finding of unique.slice(0, 30)) { const row = node('div', null, 'pii-row'); row.append(node('span', maskNames[finding.kind]), node('code', finding.value)); list.append(row); }
    if (unique.length > 30) list.append(node('p', 'İlk 30 farklı bulgu gösteriliyor; gizleme seçili metnin tamamına uygulanır.', 'small'));
    const questionFindings = findings($('target-question').value);
    text('question-pii', questionFindings.length ? 'Sorunda da ' + questionFindings.length + ' olası özel bilgi var. Gizleme yalnız mesajları değiştirir; sorunu kendin düzelt.' : 'Sorun da aynı örüntülerle tarandı.');
  }

  function toggleImport(visible) {
    show('import-panel', visible); $('import-toggle').setAttribute('aria-expanded', String(visible));
    if (visible) { $('import-provider').focus(); reveal($('import-panel')); }
  }
  function clearImportPreview() { state.previewRevision += 1; state.preview = null; $('import-preview-list').replaceChildren(); show('import-preview', false); updateReady(); }
  function resetSessions() { state.cc = { sessions: [], selected: new Set(), shown: CC_PAGE }; $('cc-sessions').replaceChildren(); show('cc-chooser', false); text('cc-status', ''); }
  function updateImportFormat() {
    const provider = $('import-provider').value, sessions = provider === 'claude-code', generic = provider === 'generic', pasted = generic && $('import-generic-format').value === 'text';
    show('file-import', !sessions); show('cc-panel', sessions);
    show('import-file-field', !pasted); show('import-text-fields', pasted); show('import-developer-field', generic); show('import-generic-format-field', generic);
    $('import-file').accept = generic ? '.json,application/json' : '.json,.jsonl,.jsonl.zst,.zst,.zip,application/json,application/zip';
    text('import-file-hint', fileHints[provider] || '');
    const steps = importHelp[generic ? (pasted ? 'text' : 'file') : provider] || [];
    text('import-help-title', generic ? 'Nasıl yapılır?' : 'Dosyayı nereden alırım?');
    $('import-help-steps').replaceChildren(...steps.map(step => node('li', step))); show('import-help', steps.length > 0);
    text('preview-import', pasted ? 'Önizle' : 'İçindekileri göster');
    clearImportPreview(); text('import-status', '');
  }
  function fileBase64(file) {
    return new Promise((resolve, reject) => {
      const reader = new FileReader(); reader.onload = () => resolve(String(reader.result).split(',')[1]); reader.onerror = () => reject(Error('Dosya okunamadı. Dosyayı yeniden seç.')); reader.readAsDataURL(file);
    });
  }
  // One preview list for every source: files, pasted text and Claude Code sessions all end in import-commit.
  function showPreview(preview, preselect = false) {
    state.preview = preview; const list = $('import-preview-list'); list.replaceChildren();
    for (const conversation of preview.conversations) {
      const row = node('div', null, 'import-choice'), check = document.createElement('input'); check.type = 'checkbox'; check.value = conversation.id; check.checked = preselect; check.addEventListener('change', updateReady);
      const label = node('label', null, 'check'), when = conversation.updatedAt || conversation.createdAt;
      label.append(check, node('span', (conversation.title || 'Başlıksız konuşma') + ' · ' + conversation.messages.length + ' mesaj' + (when ? ' · ' + dateLabel(when) : ''))); row.append(label);
      const details = document.createElement('details'); details.append(node('summary', 'İçine bak'));
      if (conversation.warnings?.length) details.append(node('p', conversation.warnings.join('\n'), 'notice warning-note'));
      for (const message of conversation.messages.slice(0, 12)) details.append(node('pre', (roles[message.role] || message.role) + '\n' + message.text));
      if (conversation.messages.length > 12) details.append(node('p', 'İlk 12 mesaj gösteriliyor. İçe aldıktan sonra tamamını okuyabilirsin.', 'small'));
      row.append(details); list.append(row);
    }
    show('import-preview', true);
    text('import-status', preview.conversations.length ? preview.conversations.length + ' konuşma bulundu. Almak istediklerini işaretle, sonra “Seçilenleri içe al”a bas.' : 'Bu kaynakta içe alınabilecek konuşma bulunamadı. “Nereden alıyorsun?” seçimini ve dosyayı kontrol et.');
    updateReady();
  }
  async function previewImport() {
    clearImportPreview(); const revision = state.previewRevision, provider = $('import-provider').value;
    if (provider === 'claude-code') return;
    const payload = { provider };
    if (provider === 'generic' && $('import-generic-format').value === 'text') {
      if (!$('import-text').value.trim()) throw Error('Önce konuşma metnini kutuya yapıştır.');
      Object.assign(payload, { text: $('import-text').value, title: $('import-title').value.trim(), developer: $('import-developer').value });
    } else {
      const file = $('import-file').files[0]; if (!file) throw Error('Önce içe alacağın dosyayı seç.');
      if (file.size > 128 * 1024 * 1024) throw Error('Dosya 128 MB sınırını aşıyor. Daha küçük bir dışa aktarım seç.');
      Object.assign(payload, { fileName: file.name, contentBase64: await fileBase64(file) });
    }
    text('import-status', 'Dosya bu bilgisayarda okunuyor…'); const preview = await call('import-preview', payload);
    if (revision !== state.previewRevision) return;
    showPreview(preview);
  }
  function setPreviewChecks(value) { for (const check of $('import-preview-list').querySelectorAll('input[type=checkbox]')) check.checked = value; updateReady(); }
  async function commitImport() {
    if (!state.preview) return;
    const selectedIds = [...$('import-preview-list').querySelectorAll('input:checked')].map(check => check.value);
    if (!selectedIds.length) throw Error('İçe almak için en az bir konuşmayı işaretle.');
    const result = await call('import-commit', { previewId: state.preview.previewId, selectedIds });
    state.conversations = (await call('list')).conversations; renderList();
    clearImportPreview(); resetSessions(); $('import-file').value = ''; $('import-text').value = ''; $('import-title').value = ''; text('import-status', ''); toggleImport(false);
    const summary = result.imported + ' konuşma içe alındı' + (result.skipped ? ' · ' + result.skipped + ' konuşma zaten vardı, atlandı.' : '.');
    status(summary);
    const chosen = result.conversations?.find(c => selectedIds.includes(c.id)) || result.conversations?.[0] || state.conversations.find(c => selectedIds.includes(c.id)) || state.conversations[0];
    if (!chosen) return;
    await openConversation(chosen.id);
    text('import-done', summary + (result.imported > 1 ? ' İlki aşağıda açık.' : ' Aşağıda açık.')); show('import-done', true);
    $('primary-record').hidden ? $('to-topics').focus() : $('primary-record').focus(); reveal($('conversation-workspace'));
  }

  // Claude Code sessions: listed only after the button is pressed; the list itself comes from the local service.
  function renderSessions() {
    const list = $('cc-sessions'); list.replaceChildren();
    for (const session of state.cc.sessions.slice(0, state.cc.shown)) {
      const row = node('div', null, 'import-choice' + (session.imported ? ' is-imported' : '')), check = document.createElement('input');
      check.type = 'checkbox'; check.value = session.id; check.disabled = Boolean(session.imported); check.checked = !session.imported && state.cc.selected.has(session.id);
      const label = node('label', null, 'check'), body = node('span');
      body.append(node('span', projectName(session.project), 'session-project'), node('span', dateLabel(session.modifiedAt) + ' · ' + sizeLabel(session.bytes), 'small'));
      if (session.imported) body.append(node('span', 'içe alındı', 'badge'));
      label.append(check, body); row.append(label); list.append(row);
      check.addEventListener('change', () => {
        if (check.checked && state.cc.selected.size >= CC_LIMIT) { check.checked = false; text('cc-status', 'Bir seferde en fazla ' + CC_LIMIT + ' oturum seçebilirsin. Önce bunları içe al, sonra kalanlara dön.'); return; }
        if (check.checked) state.cc.selected.add(session.id); else state.cc.selected.delete(session.id);
        text('cc-status', ''); clearImportPreview();
      });
    }
    show('cc-more', state.cc.sessions.length > state.cc.shown); show('cc-chooser', state.cc.sessions.length > 0); updateReady();
  }
  async function listSessions() {
    clearImportPreview(); resetSessions(); text('cc-status', 'Oturumlar listeleniyor…');
    const result = await call('claude-code-sessions', {});
    state.cc.sessions = result.sessions || [];
    const done = state.cc.sessions.filter(session => session.imported).length;
    text('cc-status', !state.cc.sessions.length ? 'Bu bilgisayarda Claude Code oturumu bulunamadı.' : state.cc.sessions.length + ' oturum bulundu' + (done ? '; ' + done + ' tanesi daha önce içe alınmış.' : '.') + ' Almak istediklerini işaretle.');
    renderSessions();
  }
  function selectAllSessions() {
    const open = state.cc.sessions.filter(session => !session.imported), picked = open.slice(0, CC_LIMIT);
    state.cc.selected = new Set(picked.map(session => session.id));
    if (picked.length) state.cc.shown = Math.max(state.cc.shown, state.cc.sessions.indexOf(picked.at(-1)) + 1);
    text('cc-status', !open.length ? 'İçe alınmamış oturum kalmadı.' : open.length > CC_LIMIT ? 'En yeni ' + CC_LIMIT + ' oturum seçildi; bir seferde en fazla ' + CC_LIMIT + ' alınır. Kalan ' + (open.length - CC_LIMIT) + ' oturum için sonra yeniden gel.' : picked.length + ' oturum seçildi.');
    clearImportPreview(); renderSessions();
  }
  async function previewSessions() {
    const sessionIds = state.cc.sessions.filter(session => !session.imported && state.cc.selected.has(session.id)).map(session => session.id);
    if (!sessionIds.length) throw Error('Önce en az bir oturumu işaretle.');
    if (sessionIds.length > CC_LIMIT) throw Error('Bir seferde en fazla ' + CC_LIMIT + ' oturum önizlenir. Seçimini azalt.');
    clearImportPreview(); const revision = state.previewRevision;
    text('import-status', 'Seçtiğin oturumlar bu bilgisayarda okunuyor…');
    const preview = await call('claude-code-preview', { sessionIds });
    if (revision !== state.previewRevision) return;
    showPreview(preview, true); reveal($('import-preview'));
  }

  async function prepareDraft() {
    if ($('prepare-draft').disabled && !state.busy.has('prepare-draft')) return;
    const revision = state.revision;
    const payload = {
      conversationId: state.conversation.id, leafId: state.leafId,
      items: selectedRows().map(row => ({ messageId: row.message.id, ...(row.message.role === 'unknown' ? { role: row.role } : {}), text: row.text, authorship: row.authorship, rights: row.rights, feedback: row.feedback })),
      intent: 'continue',
      developer: $('target-developer').value, modelId: effectiveMode() === 'live' ? $('target-model').value : '',
      mode: effectiveMode(), question: $('target-question').value.trim()
    };
    const result = await call('prepare', payload);
    if (revision !== state.revision) { state.stale = true; return; }
    state.draft = result.draft; state.stale = false; state.draftBlocked = Boolean(result.findings?.length); renderDraft(result.findings || []); await refreshHistory();
  }
  function renderDraft(serverFindings) {
    const draft = state.draft;
    text('draft-mode', modeNames[draft.mode] || modeNames.live);
    text('draft-target', developerName(draft.developer) + (draft.modelId ? ' / ' + draft.modelId : ''));
    text('draft-hash', draft.hash); text('draft-question', draft.question || 'Soru yazılmadı.'); text('draft-context', draft.contextText);
    const warnings = [...(draft.warnings || [])]; if (serverFindings.length) warnings.push('Bu metinde ' + serverFindings.length + ' olası özel bilgi bulundu; bu devam metninin çıkışı kapalıdır. Mesajda, soruda ya da notta bu bilgileri gizle, sonra yeniden önizle.');
    text('draft-warnings', warnings.join('\n')); show('draft-warnings', warnings.length > 0);
    $('send-consent').checked = false;
    text('send-consent-text', draft.mode === 'live' ? 'Bu metni ve sorumu, yukarıda yazan modele OpenRouter üzerinden bir kez göndermeyi onaylıyorum.' : draft.mode === 'simulation' ? 'Bu metin için gerçek olmayan, örnek bir yanıt üretilmesini onaylıyorum. İnternete çıkılmaz.' : 'Bu metni okudum; kopyalamam ya da indirmem için hazırlansın. töre hiçbir yere göndermez.');
    text('execute-draft', draft.mode === 'live' ? 'Onayla ve gönder' : draft.mode === 'simulation' ? 'Onayla, denemeyi çalıştır' : 'Onayla, metni göster');
    text('draft-status', 'Mesaj, soru ya da hedef değişirse bu onay kalkar.');
    show('draft-panel', true); updateReady(); reveal($('draft-panel'));
  }
  function resultAction(label, action) {
    const button = node('button', label); button.type = 'button'; button.addEventListener('click', () => run(button, action, 'result-status')); $('result-actions').append(button); return button;
  }
  async function executeDraft() {
    const draft = state.draft;
    if (!draft || state.draftBlocked || !$('send-consent').checked) throw Error('Önce onay kutusunu işaretle.');
    let result;
    try { result = await call('send', { draftId: draft.id, hash: draft.hash, confirmed: true }); }
    catch (error) { invalidate(); refreshHistory().catch(() => {}); showError($('prepare-draft'), friendly(error.message) + ' Yeniden denemeden önce devam metnini yeniden önizle.'); return; }
    state.resultDraftId = draft.id;
    $('result-actions').replaceChildren(); text('result-status', ''); show('result-text', false); show('result-panel', true);
    if (draft.mode === 'manual') {
      const context = result.contextText || draft.contextText;
      text('result-heading', 'Devam metnin hazır.'); text('result-description', 'töre hiçbir yere göndermedi. Metni kopyala, kullanmak istediğin AI’ya yapıştır.'); text('result-text', context); show('result-text', true);
      resultAction('Metni kopyala', async () => { if (!navigator.clipboard?.writeText) throw Error('Tarayıcı panoya erişemiyor. Metni yukarıdan seçip kopyala ya da indir.'); await navigator.clipboard.writeText(context); text('result-status', 'Devam metnin panoya kopyalandı.'); });
      resultAction('Dosya olarak indir', () => download(context, 'tore-devam-metni.txt', 'text/plain;charset=utf-8'));
    } else {
      text('result-heading', draft.mode === 'simulation' ? 'Örnek yanıt, yeni bir sürümde.' : 'Model yanıtı, yeni bir sürümde.');
      text('result-description', draft.mode === 'simulation' ? 'Bu yanıt akışı denemek için üretildi; gerçek bir AI modelinin yanıtı değildir.' : 'Yanıt, konuşmanın yeni bir sürümü olarak saklandı. Önceki sürümler yerinde duruyor.');
      if (result.conversation) {
        const response = result.conversation.messages.find(message => message.id === result.conversation.selectedLeafId) || [...result.conversation.messages].reverse().find(message => message.role === 'assistant');
        if (response) { text('result-text', response.text); show('result-text', true); }
        setConversation(result.conversation);
      }
    }
    state.draft = null; $('send-consent').checked = false; show('draft-panel', false);
    await refreshHistory(); updateReady(); $('result-heading').focus({ preventScroll: true }); reveal($('result-panel'));
  }
  async function revoke(id) {
    await call('revoke', { draftId: id });
    if (state.resultDraftId === id) { $('result-actions').replaceChildren(); text('result-status', 'Bu devam metni için kopyalama ve indirme kapatıldı. Daha önce aldığın kopyalar geri çağrılamaz.'); }
    if (state.draft?.id === id) { state.draft = null; show('draft-panel', false); $('send-consent').checked = false; }
    await refreshHistory(); updateReady();
  }
  async function refreshHistory() {
    const result = await call('drafts'); state.drafts = result.drafts || [];
    text('history-count', state.drafts.length); const list = $('draft-history'); list.replaceChildren();
    if (!state.drafts.length) list.append(node('p', 'Henüz devam metni hazırlamadın.', 'small empty'));
    const names = { ready: 'Onayını bekliyor', revoked: 'İzni geri çekildi', sent: 'Tamamlandı', sending: 'Başlatıldı', unknown: 'Sonucu belirsiz; yeniden onay gerekir', completed: 'Tamamlandı', used: 'Kullanıldı' };
    for (const draft of [...state.drafts].sort((a, b) => String(b.createdAt || '').localeCompare(String(a.createdAt || ''))).slice(0, 50)) {
      const row = node('div', null, 'history-row'), content = node('div');
      content.append(node('p', (draft.intent !== 'continue' ? 'Eski tür · artık kullanılmıyor' : modeNames[draft.mode] || modeNames.live) + ' · ' + developerName(draft.developer)), node('p', (names[draft.status] || 'Kayıtlı') + ' · ' + dateLabel(draft.createdAt), 'small'));
      row.append(content);
      if (draft.status !== 'revoked') { const button = node('button', 'İzni geri çek', 'quiet'); button.id = 'revoke-' + draft.id; button.addEventListener('click', () => run(button, () => revoke(draft.id))); row.append(button); }
      list.append(row);
    }
  }

  $('import-toggle').addEventListener('click', () => toggleImport($('import-panel').hidden));
  $('welcome-import').addEventListener('click', () => toggleImport(true));
  $('import-close').addEventListener('click', () => toggleImport(false));
  $('import-provider').addEventListener('change', updateImportFormat);
  $('import-generic-format').addEventListener('change', updateImportFormat);
  for (const id of ['import-file', 'import-title', 'import-text', 'import-developer']) $(id).addEventListener(id === 'import-text' || id === 'import-title' ? 'input' : 'change', clearImportPreview);
  $('preview-import').addEventListener('click', () => run($('preview-import'), previewImport, 'import-status'));
  $('commit-import').addEventListener('click', () => run($('commit-import'), commitImport, 'import-status'));
  $('preview-select-all').addEventListener('click', () => setPreviewChecks(true));
  $('preview-clear').addEventListener('click', () => setPreviewChecks(false));
  $('cc-list').addEventListener('click', () => run($('cc-list'), listSessions, 'cc-status'));
  $('cc-select-all').addEventListener('click', selectAllSessions);
  $('cc-clear').addEventListener('click', () => { state.cc.selected.clear(); text('cc-status', ''); clearImportPreview(); renderSessions(); });
  $('cc-more').addEventListener('click', () => { state.cc.shown += CC_PAGE; renderSessions(); });
  $('cc-preview').addEventListener('click', () => run($('cc-preview'), previewSessions, 'import-status'));
  $('conversation-search').addEventListener('input', renderList);
  $('branch-leaf').addEventListener('change', () => { state.leafId = $('branch-leaf').value; invalidate(); initializeRows(); });
  $('continue-toggle').addEventListener('click', () => setTransfer(!state.transfer));
  $('select-human').addEventListener('click', () => { for (const row of state.rows.values()) row.checked = row.message.role === 'user' || row.message.role === 'human'; invalidate(); renderMessages(); if (state.scanned) renderScan(); });
  $('clear-selection').addEventListener('click', () => { for (const row of state.rows.values()) row.checked = false; invalidate(); renderMessages(); if (state.scanned) renderScan(); });
  $('scan-pii').addEventListener('click', renderScan);
  $('apply-masks').addEventListener('click', () => { for (const row of selectedRows()) { row.text = masked(row.text); row.feedback = masked(row.feedback); } invalidate(); renderMessages(); renderScan(); text('mask-status', 'Bulunanlar yalnız götüreceğin kopyada gizlendi. Konuşmanın aslı değişmedi.'); });
  $('literal-masks').addEventListener('input', () => { if (state.scanned) renderScan(); });
  for (const id of ['run-mode', 'target-model']) $(id).addEventListener('change', invalidate);
  $('target-developer').addEventListener('change', () => { invalidate(); renderModels(); });
  $('target-question').addEventListener('input', () => { invalidate(); if (state.scanned) renderScan(); });
  $('prepare-draft').addEventListener('click', () => run($('prepare-draft'), prepareDraft));
  $('send-consent').addEventListener('change', updateReady);
  $('execute-draft').addEventListener('click', () => run($('execute-draft'), executeDraft, 'draft-status'));
  $('revoke-draft').addEventListener('click', () => run($('revoke-draft'), async () => { if (state.draft) await revoke(state.draft.id); }, 'draft-status'));
  $('settings-toggle').addEventListener('click', () => { const visible = $('settings-panel').hidden; show('settings-panel', visible); $('settings-toggle').setAttribute('aria-expanded', String(visible)); if (visible) { $('api-key').focus(); reveal($('settings-panel')); } });
  $('save-key').addEventListener('click', () => run($('save-key'), async () => {
    const key = $('api-key').value.trim(); $('api-key').value = '';
    if (!key) throw Error('Önce anahtarını kutuya yapıştır. Kaldırmak için “Anahtarı sil”i kullan.');
    const result = await call('key', { key }); state.keyConfigured = Boolean(result.configured); invalidate(); text('key-state', state.keyConfigured ? 'Anahtar töre açıkken bellekte duruyor. Tarayıcıya yazılmadı.' : 'Anahtar tanınmadı. Yeniden yapıştırıp dene.');
  }, 'key-state'));
  $('clear-key').addEventListener('click', () => run($('clear-key'), async () => { $('api-key').value = ''; const result = await call('key', { key: '' }); state.keyConfigured = Boolean(result.configured); invalidate(); text('key-state', state.keyConfigured ? 'Anahtar silinemedi. Yeniden dene.' : 'Anahtar silindi.'); }, 'key-state'));
  $('refresh-catalog').addEventListener('click', () => run($('refresh-catalog'), async () => {
    state.catalogRefreshed = false; updateReady(); const catalog = await call('catalog', { refresh: true });
    state.catalog = { ...catalog, models: catalog.models || [] }; state.catalogRefreshed = true; invalidate(); renderModels();
    text('catalog-state', state.catalog.models.filter(freeModel).length + ' ücretsiz model · ' + dateLabel(catalog.updatedAt) + (catalog.warnings?.length ? '\n' + catalog.warnings.join('\n') : ''));
  }, 'catalog-state'));

  async function initialize() {
    updateImportFormat();
    const results = await Promise.allSettled([call('status'), call('list'), call('catalog', { refresh: false }), refreshHistory()]);
    const [statusResult, listResult, catalogResult] = results;
    if (statusResult.status === 'fulfilled') { const info = statusResult.value; state.developers = info.developers || []; state.keyConfigured = Boolean(info.keyConfigured); populateDevelopers(); text('key-state', state.keyConfigured ? 'Bu açılışta bir anahtar tanımlı.' : 'Tanımlı anahtar yok.'); }
    if (listResult.status === 'fulfilled') { state.conversations = listResult.value.conversations || []; renderList(); }
    if (catalogResult.status === 'fulfilled') { state.catalog = { ...catalogResult.value, models: catalogResult.value.models || [] }; renderModels(); text('catalog-state', 'Kayıtlı model listesi yüklendi. Güncellemek için düğmeye bas.'); }
    const failed = results.find(result => result.status === 'rejected');
    status(failed ? friendly(failed.reason?.message || 'töre’ye bağlanılamadı. Sayfayı yenile.') : state.conversations.length ? 'Konuşmaların hazır.' : 'Henüz konuşma yok. İlk konuşmanı içe al.', Boolean(failed));
    const params = new URLSearchParams(location.search), sourceConversationId = params.get('conversationId'), sourceMessageId = params.get('messageId');
    if (sourceConversationId && !failed) {
      try {
        await openConversation(sourceConversationId);
        if (sourceMessageId) {
          if (!state.conversation.messages.some(message => message.id === sourceMessageId)) throw Error('Kaydın bağlı olduğu mesaj bu konuşmada bulunamadı. Konuşma yeniden içe alınmış olabilir.');
          if (!state.rows.has(sourceMessageId)) {
            state.leafId = sourceMessageId;
            if (![...$('branch-leaf').options].some(item => item.value === sourceMessageId)) $('branch-leaf').append(option(sourceMessageId, 'Kaydın bağlı olduğu mesaja kadar'));
            $('branch-leaf').value = sourceMessageId; show('branch-bar', true);
            initializeRows(); text('branch-hint', 'Kaydın bağlı olduğu mesaja kadar olan bölüm açık. Devamını görmek için başka bir sürüm seç.');
          }
          const sourceCard = [...$('message-list').querySelectorAll('[data-message-id]')].find(card => card.dataset.messageId === sourceMessageId);
          if (sourceCard) { sourceCard.tabIndex = -1; sourceCard.focus(); sourceCard.scrollIntoView?.({ block: 'center' }); }
        }
      } catch (error) { status(friendly(error.message), true); }
    }
    updateReady();
  }
  initialize();
})();
