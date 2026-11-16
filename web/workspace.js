import { api, download } from '/private-client.js';

// All conversation content is rendered as text. The only browser-stored capability
// belongs to private-client; provider keys are sent once to the local RAM service.
(() => {
  'use strict';
  const $ = id => document.getElementById(id);
  const state = {
    conversations: [], conversation: null, leafId: '', rows: new Map(), developers: [],
    catalog: { models: [] }, catalogRefreshed: false, keyConfigured: false,
    draft: null, revision: 0, preview: null, previewRevision: 0,
    loadSequence: 0, busy: new Set(), scanned: false, drafts: [], draftBlocked: false, resultDraftId: null
  };
  const roles = { user: 'Kullanıcı', human: 'Kullanıcı', assistant: 'AI yanıtı', system: 'Sistem kaydı', developer: 'Geliştirici kaydı', tool: 'Araç kaydı', unknown: 'Konuşmacı belirsiz' };
  const authorships = [['unreviewed', 'Henüz incelenmedi'], ['human_original', 'İnsan tarafından yazılmış'], ['ai_output', 'AI tarafından üretilmiş'], ['third_party', 'Üçüncü kişiye ait']];
  const maskNames = { email: 'E-posta', phone: 'Telefon', key: 'Anahtar', path: 'Dosya yolu', literal: 'Özel ifade' };
  const maskTokens = { email: '[E-POSTA]', phone: '[TELEFON]', key: '[ANAHTAR]', path: '[DOSYA YOLU]', literal: '[ÖZEL İFADE]' };
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
  function inlineError(message = '') { text('action-error', message); show('action-error', Boolean(message)); }
  function dateLabel(value) {
    if (!value) return 'Tarih belirtilmemiş';
    const date = new Date(value);
    return Number.isNaN(date.getTime()) ? 'Tarih belirtilmemiş' : date.toLocaleDateString('tr-TR', { day: 'numeric', month: 'short', year: 'numeric' });
  }
  const developerName = id => state.developers.find(d => d.id === id)?.name || id || 'Belirtilmemiş';
  const selectedRows = () => [...state.rows.values()].filter(row => row.checked);
  const effectiveMode = () => $('run-mode').value;
  const selectedModel = () => state.catalog.models.find(model => model.id === $('target-model').value && model.developer === $('target-developer').value);
  const zeroPrice = value => value === 0 || (typeof value === 'string' && /^(?:0+(?:\.0*)?|\.0+)$/.test(value));
  const freeModel = model => model?.free === true && zeroPrice(model.pricing?.prompt) && zeroPrice(model.pricing?.completion);

  async function run(button, action, statusId) {
    if (state.busy.has(button.id)) return;
    state.busy.add(button.id); button.disabled = true; inlineError();
    try { await action(); }
    catch (error) {
      const message = error?.message || 'İşlem tamamlanamadı. Yeniden deneyebilirsin.';
      inlineError(message); status(message, true);
      if (statusId) text(statusId, message);
    } finally { state.busy.delete(button.id); button.disabled = false; updateReady(); }
  }
  function invalidate() {
    state.revision += 1;
    if (state.draft) status('Seçim değişti. Gönderimden önce güncel önizlemeyi yeniden hazırla.');
    state.draft = null; state.draftBlocked = false; show('draft-panel', false);
    $('send-consent').checked = false;
    inlineError(); updateReady();
  }
  function renderList() {
    const list = $('conversation-list'); list.replaceChildren();
    text('conversation-count', state.conversations.length);
    const query = $('conversation-search').value.toLocaleLowerCase('tr').trim();
    const matches = state.conversations.filter(c => [c.title, c.provider, c.sourceApp, developerName(c.provider)].join(' ').toLocaleLowerCase('tr').includes(query));
    if (!matches.length) list.append(node('p', query ? 'Bu aramayla eşleşen konuşma yok.' : 'Henüz konuşma eklemedin. + düğmesiyle başlayabilirsin.', 'empty'));
    for (const c of matches) {
      const button = node('button', null, 'conversation-card'); button.type = 'button'; button.dataset.conversationId = c.id;
      button.setAttribute('aria-current', String(state.conversation?.id === c.id));
      button.append(node('p', developerName(c.provider), 'card-provider'), node('h3', c.title || 'Başlıksız konuşma'), node('p', (c.messages?.length ?? 0) + ' mesaj · ' + dateLabel(c.updatedAt || c.createdAt)));
      button.addEventListener('click', () => run(button, () => openConversation(c.id)));
      list.append(button);
    }
  }
  function leaves(conversation) {
    const parents = new Set(conversation.messages.map(m => m.parentId).filter(Boolean));
    return conversation.messages.filter(message => !parents.has(message.id));
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
    text('conversation-source', developerName(conversation.provider) + ' / ' + (conversation.sourceApp || 'İçe aktarılmış kaynak'));
    text('conversation-meta', conversation.messages.length + ' kaynak mesajı · ' + dateLabel(conversation.createdAt));
    text('conversation-warnings', (conversation.warnings || []).join('\n')); show('conversation-warnings', Boolean(conversation.warnings?.length));
    const ends = leaves(conversation), selector = $('branch-leaf');
    selector.replaceChildren(option('', ends.length > 1 ? 'İncelemek istediğin dalı seç' : 'Konuşma dalı seç'));
    for (const [index, leaf] of ends.entries()) selector.append(option(leaf.id, 'Dal ' + (index + 1) + ' · ' + (roles[leaf.role] || leaf.role) + ' · ' + leaf.text.slice(0, 65).replace(/\s+/g, ' ')));
    state.leafId = ends.some(end => end.id === conversation.selectedLeafId) ? conversation.selectedLeafId : ends.length === 1 ? ends[0].id : '';
    selector.value = state.leafId;
    text('branch-hint', ends.length > 1 ? ends.length + ' ayrı bitiş var. Yalnız seçtiğin dala giden mesajlar gösterilir.' : 'Bu dalın kaynak sırası korunur. Eklere yalnız atıf gösterilir; dosyalar aktarılmaz.');
    show('welcome', false); show('conversation-workspace', true);
    initializeRows(); renderList();
  }
  function initializeRows() {
    state.rows = new Map(branchMessages().map(message => [message.id, { message, checked: false, role: message.role === 'unknown' ? '' : message.role, text: message.text, authorship: 'unreviewed', rights: 'unreviewed', feedback: '' }]));
    state.scanned = false; show('pii-review', false); renderMessages(); updateReady();
  }
  function renderMessages() {
    const list = $('message-list'); list.replaceChildren();
    if (!state.rows.size) { list.append(node('p', state.conversation?.messages.length ? 'Mesajları incelemek için yukarıdan bir konuşma dalı seç.' : 'Bu konuşmada aktarılabilir metin yok.', 'empty')); return; }
    for (const [index, row] of [...state.rows.values()].entries()) {
      const message = row.message, card = node('article', null, 'message-card' + (row.checked ? ' is-selected' : ''));
      card.dataset.messageId = message.id;
      const check = document.createElement('input'); check.type = 'checkbox'; check.checked = row.checked; check.dataset.action = 'select-message';
      check.disabled = !['user', 'assistant', 'unknown'].includes(message.role);
      const heading = node('div', null, 'message-card-heading');
      const selectLabel = node('label', null, 'check'); selectLabel.append(check, node('span', roles[message.role] || message.role || 'Konuşmacı belirsiz', 'message-role'));
      heading.append(selectLabel, node('span', String(index + 1).padStart(2, '0'), 'message-order')); card.append(heading);
      const original = node('p', message.text, 'message-body'); original.hidden = row.checked; card.append(original);
      const editor = node('div', null, 'message-editor'); editor.hidden = !row.checked;
      let roleSelect;
      if (message.role === 'unknown') {
        roleSelect = document.createElement('select'); roleSelect.dataset.field = 'role';
        roleSelect.append(option('', 'Konuşmacıyı açıkça seç'), option('user', 'Kullanıcı'), option('assistant', 'AI yanıtı')); roleSelect.value = row.role;
        editor.append(labeled('Bu metnin konuşmacısı', roleSelect));
      }
      const area = document.createElement('textarea'); area.value = row.text; area.rows = Math.min(12, Math.max(4, row.text.split('\n').length + 1)); area.dataset.field = 'text'; area.spellcheck = false;
      editor.append(labeled('Gönderilecek metin', area));
      const fields = node('div', null, 'field-grid');
      const authorship = document.createElement('select'); authorship.dataset.field = 'authorship'; authorship.append(...authorships.map(([v, label]) => option(v, label, v === 'human_original' && row.role === 'assistant'))); authorship.value = row.authorship;
      if (roleSelect) roleSelect.addEventListener('change', () => {
        row.role = roleSelect.value; authorship.querySelector('[value="human_original"]').disabled = row.role === 'assistant';
        if (row.role === 'assistant' && row.authorship === 'human_original') { row.authorship = 'unreviewed'; authorship.value = row.authorship; }
        invalidate();
      });
      const rights = document.createElement('select'); rights.dataset.field = 'rights'; rights.append(option('unreviewed', 'Henüz beyan vermedim'), option('user_attested', 'Bu kullanım için hakkım olduğunu beyan ediyorum')); rights.value = row.rights;
      fields.append(labeled('Yazarlık incelemen', authorship), labeled('Kullanım hakkı beyanın', rights)); editor.append(fields);
      const feedback = document.createElement('input'); feedback.type = 'text'; feedback.value = row.feedback; feedback.placeholder = 'Örn. bu öneriyi reddettim; görüşümü sonra düzelttim'; feedback.dataset.field = 'feedback';
      editor.append(labeled('Görüş / düzeltme notun — isteğe bağlı', feedback, 'feedback-label'));
      const details = document.createElement('details'); details.append(node('summary', 'Değişmemiş kaynak metni'), node('pre', message.text)); editor.append(details); card.append(editor);
      if (message.attachments?.length) card.append(node('p', 'Ek atıfları (aktarılmaz): ' + message.attachments.join(' · '), 'attachments'));
      if (check.disabled) card.append(node('p', 'Bu kayıt kaynakta gösterilir; talimat veya aktarılacak mesaj olarak seçilemez.', 'hint'));
      card.append(node('p', 'Kaynak: ' + (message.sourceLocator || message.sourceId || message.id) + (message.model ? ' · Model: ' + message.model : '') + (message.phase ? ' · ' + message.phase : ''), 'source-info'));
      if (['user', 'assistant'].includes(message.role) && !['analysis', 'reasoning', 'tool'].includes(message.phase)) {
        const recordLink = node('a', 'Alıntıdan görüş, karar veya soru oluştur ↗', 'quiet');
        recordLink.dataset.sourceRecord = message.id;
        recordLink.href = '/konular?conversationId=' + encodeURIComponent(state.conversation.id) + '&messageId=' + encodeURIComponent(message.id);
        card.append(recordLink);
      }
      check.addEventListener('change', () => { row.checked = check.checked; editor.hidden = !row.checked; original.hidden = row.checked; card.classList.toggle('is-selected', row.checked); invalidate(); if (state.scanned) renderScan(); });
      for (const [control, field, event] of [[area, 'text', 'input'], [authorship, 'authorship', 'change'], [rights, 'rights', 'change'], [feedback, 'feedback', 'input']]) {
        control.addEventListener(event, () => { row[field] = control.value; invalidate(); if (state.scanned && (field === 'text' || field === 'feedback')) renderScan(); });
      }
      list.append(card);
    }
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
    selector.replaceChildren(option('', models.length ? 'Ücretsiz bir model seç' : 'Bu geliştirici için model yok'));
    for (const model of models) selector.append(option(model.id, model.name + (freeModel(model) ? ' · ücretsiz' : ' · kullanıma kapalı'), !freeModel(model) || !state.catalogRefreshed));
    if (models.some(model => model.id === previous && freeModel(model)) && state.catalogRefreshed) selector.value = previous;
    text('model-hint', !state.catalogRefreshed ? 'Canlı kullanım için bağlantı ayarlarından güncel kataloğu açıkça yenile.' : models.some(freeModel) ? 'Yalnız fiyatı sıfır modeller seçilebilir. Uç nokta uygunluğu gönderimde yeniden doğrulanır.' : 'Bu geliştiricinin uygun ücretsiz modeli bulunamadı. Başka bir geliştirici, elle aktarım veya simülasyon seçebilirsin.');
    updateReady();
  }
  function updateReady() {
    const selected = selectedRows(), mode = effectiveMode();
    text('selection-count', selected.length + ' seçili');
    show('model-field', mode === 'live'); show('model-hint', mode === 'live');
    text('mode-status', mode === 'live' ? 'Canlı kullanım · Onaydan sonra seçili metin ve soru harici modele gönderilir. Ücretli uçlar kapalıdır.' : mode === 'simulation' ? 'SİMÜLASYON · İnternete çıkmaz. Üretilen yanıt sentetiktir; model yeteneği kanıtı değildir.' : 'Elle aktarım · Model çağrısı yapılmaz. Onayladığın bağlamı kopyalar veya indirirsin.');
    $('mode-status').classList.toggle('simulation', mode === 'simulation');
    let reason = '';
    if (!state.conversation || !state.leafId) reason = 'Önce bir konuşma ve dal seç.';
    else if (!selected.length) reason = 'En az bir mesajı açıkça seç.';
    else if (selected.length > 64) reason = 'Bir taslakta en fazla 64 mesaj seçebilirsin. Seçimini daralt.';
    else if (selected.some(row => !row.text.trim())) reason = 'Seçili boş metni doldur veya seçimini kaldır.';
    else if (selected.some(row => !['user', 'assistant'].includes(row.role))) reason = 'Genel metinlerin konuşmacısını açıkça seç.';
    else if (selected.some(row => row.role === 'assistant' && row.authorship === 'human_original')) reason = 'AI yanıtını insanın özgün katkısı olarak işaretleyemezsin.';
    else if (!$('target-developer').value) reason = 'Bir hedef geliştirici seç.';
    else if (!$('target-question').value.trim()) reason = 'Devam etmek için yeni sorunu yaz.';
    else if (mode === 'live' && !state.catalogRefreshed) reason = 'Canlı kullanım için bağlantı ayarlarından model kataloğunu yenile.';
    else if (mode === 'live' && !state.keyConfigured) reason = 'Canlı kullanım için bağlantı ayarlarına bir oturum anahtarı ekle.';
    else if (mode === 'live' && !freeModel(selectedModel())) reason = 'Bu geliştirici için uygun ücretsiz model seç.';
    $('prepare-draft').disabled = Boolean(reason) || state.busy.has('prepare-draft'); text('prepare-hint', reason || 'Önce tam metin, hedef ve soru gösterilir.');
    $('execute-draft').disabled = !state.draft || state.draftBlocked || !$('send-consent').checked || state.busy.has('execute-draft');
    $('commit-import').disabled = !state.preview || !$('import-preview-list').querySelector('input:checked') || state.busy.has('commit-import');
    $('scan-pii').disabled = !selected.length; $('apply-masks').disabled = !selected.length;
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
    text('pii-before-count', before.length + ' aday'); text('pii-after-count', after.length + ' aday');
    const list = $('pii-findings'); list.replaceChildren();
    if (!after.length) list.append(node('p', 'İncelenen kopyada bu örüntülerle eşleşen bilgi kalmadı. Metnin tamamını yine de gözden geçir.', 'hint'));
    const unique = [...new Map(after.map(finding => [finding.kind + '\0' + finding.value, finding])).values()];
    for (const finding of unique.slice(0, 30)) { const row = node('div', null, 'pii-row'); row.append(node('span', maskNames[finding.kind]), node('code', finding.value)); list.append(row); }
    if (unique.length > 30) list.append(node('p', 'İlk 30 farklı aday gösteriliyor; maskeleme tüm seçili metne uygulanır.', 'hint'));
    const questionFindings = findings($('target-question').value);
    text('question-pii', questionFindings.length ? 'Sorunda da ' + questionFindings.length + ' aday bilgi bulundu. Yukarıdaki maskeleme yalnız mesajları değiştirir; soru alanını ayrıca düzenle.' : 'Soru da aynı örüntülerle tarandı.');
  }

  function toggleImport(visible) {
    show('import-panel', visible); $('import-toggle').setAttribute('aria-expanded', String(visible));
    if (visible) { $('import-provider').focus(); $('import-panel').scrollIntoView?.({ behavior: 'smooth', block: 'start' }); }
  }
  function clearImportPreview() { state.previewRevision += 1; state.preview = null; show('import-preview', false); updateReady(); }
  function updateImportFormat() {
    const generic = $('import-provider').value === 'generic', pasted = generic && $('import-generic-format').value === 'text';
    show('import-file-field', !pasted); show('import-text-fields', pasted); show('import-developer-field', generic); show('import-generic-format-field', generic);
    $('import-file').accept = generic ? '.json,application/json' : '.json,.jsonl,.jsonl.zst,.zst,.zip,application/json,application/zip';
    text('import-file-hint', generic ? 'Töre ortak konuşma biçiminde dışa aktarılmış JSON dosyası. İçeriği kaydetmeden önce önizlersin.' : 'ChatGPT / Claude: JSON veya ZIP · Codex: JSONL veya JSONL.ZST');
    clearImportPreview(); text('import-status', '');
  }
  function fileBase64(file) {
    return new Promise((resolve, reject) => {
      const reader = new FileReader(); reader.onload = () => resolve(String(reader.result).split(',')[1]); reader.onerror = () => reject(Error('Dosya okunamadı. Dosyayı yeniden seçebilirsin.')); reader.readAsDataURL(file);
    });
  }
  async function previewImport() {
    clearImportPreview(); const revision = state.previewRevision, provider = $('import-provider').value;
    const payload = { provider };
    if (provider === 'generic' && $('import-generic-format').value === 'text') {
      if (!$('import-text').value.trim()) throw Error('Önizlemek için konuşma metnini yapıştır.');
      Object.assign(payload, { text: $('import-text').value, title: $('import-title').value.trim(), developer: $('import-developer').value });
    } else {
      const file = $('import-file').files[0]; if (!file) throw Error('Önce içe aktarılacak dosyayı seç.');
      if (file.size > 128 * 1024 * 1024) throw Error('Dosya 128 MB sınırını aşıyor. Daha küçük bir dışa aktarım seç.');
      Object.assign(payload, { fileName: file.name, contentBase64: await fileBase64(file) });
    }
    text('import-status', 'Dosya yerelde inceleniyor…'); const preview = await call('import-preview', payload);
    if (revision !== state.previewRevision) return;
    state.preview = preview; const list = $('import-preview-list'); list.replaceChildren();
    for (const conversation of preview.conversations) {
      const row = node('div', null, 'import-choice'), check = document.createElement('input'); check.type = 'checkbox'; check.value = conversation.id; check.addEventListener('change', updateReady);
      const label = node('label', null, 'check'); label.append(check, node('span', conversation.title + ' · ' + conversation.messages.length + ' mesaj')); row.append(label);
      const details = document.createElement('details'); details.append(node('summary', 'Mesajları ve kaynak uyarılarını gör'));
      if (conversation.warnings?.length) details.append(node('p', conversation.warnings.join('\n'), 'notice'));
      for (const message of conversation.messages.slice(0, 12)) details.append(node('pre', (roles[message.role] || message.role) + '\n' + message.text));
      if (conversation.messages.length > 12) details.append(node('p', 'İlk 12 mesaj gösteriliyor. İçe aktardıktan sonra seçtiğin dalın tüm mesajlarını inceleyebilirsin.', 'hint'));
      row.append(details); list.append(row);
    }
    show('import-preview', true); text('import-status', preview.conversations.length ? preview.conversations.length + ' konuşma bulundu. Eklemek istediklerini seç.' : 'Bu dosyada desteklenen bir konuşma bulunamadı.'); updateReady();
  }
  async function commitImport() {
    if (!state.preview) return;
    const selectedIds = [...$('import-preview-list').querySelectorAll('input:checked')].map(check => check.value);
    if (!selectedIds.length) throw Error('Eklemek için en az bir konuşmayı seç.');
    const result = await call('import-commit', { previewId: state.preview.previewId, selectedIds });
    state.conversations = (await call('list')).conversations; renderList();
    clearImportPreview(); $('import-file').value = ''; $('import-text').value = ''; $('import-title').value = ''; toggleImport(false);
    status(result.imported + ' konuşma eklendi' + (result.skipped ? ' · ' + result.skipped + ' mevcut konuşma atlandı.' : '.'));
    const chosen = result.conversations?.find(c => selectedIds.includes(c.id)) || result.conversations?.[0] || state.conversations.find(c => selectedIds.includes(c.id)) || state.conversations[0];
    if (chosen) await openConversation(chosen.id);
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
    if (revision !== state.revision) { status('Hazırlık sırasında seçim değişti. Güncel metin için yeniden önizleme hazırla.'); return; }
    state.draft = result.draft; state.draftBlocked = Boolean(result.findings?.length); renderDraft(result.findings || []); await refreshHistory();
  }
  function renderDraft(serverFindings) {
    const draft = state.draft;
    text('draft-mode', draft.mode === 'simulation' ? 'SİMÜLASYON' : draft.mode === 'manual' ? 'Elle aktarım' : 'CANLI · Ücretsiz model');
    text('draft-target', developerName(draft.developer) + (draft.modelId ? ' / ' + draft.modelId : ''));
    text('draft-hash', draft.hash); text('draft-question', draft.question || 'Not eklenmedi.'); text('draft-context', draft.contextText);
    const warnings = [...(draft.warnings || [])]; if (serverFindings.length) warnings.push('Yerel sunucu ' + serverFindings.length + ' olası özel bilgi buldu. Bulunan bilgileri metin, soru veya inceleme notunda maskeleyip yeni önizleme hazırla. Bu taslağın çıkışı kapalıdır.');
    text('draft-warnings', warnings.join('\n')); show('draft-warnings', warnings.length > 0);
    $('send-consent').checked = false;
    text('send-consent-text', draft.mode === 'live' ? 'Yukarıdaki taslağı ve soruyu, gösterilen model ve geliştiriciye OpenRouter üzerinden bir kez göndermeyi onaylıyorum.' : draft.mode === 'simulation' ? 'Yukarıdaki taslak ve soru için açıkça sentetik bir simülasyon yanıtı oluşturulmasını onaylıyorum. Bu bir gerçek model yanıtı değildir.' : 'Yukarıdaki bağlamı ve soruyu belirtilen hedef için kopyalamaya veya indirmeye hazırlamayı onaylıyorum. Töre model çağrısı yapmayacak.');
    text('execute-draft', draft.mode === 'live' ? 'Onayla ve ücretsiz modele gönder' : draft.mode === 'simulation' ? 'Onayla ve simülasyonu çalıştır' : 'Onayla ve aktarım metnini hazırla');
    text('draft-status', 'Metin, hedef veya soru değişirse bu önizlemenin onayı kaldırılır.');
    show('draft-panel', true); updateReady(); $('draft-panel').scrollIntoView?.({ behavior: 'smooth', block: 'start' });
  }
  function resultAction(label, action) {
    const button = node('button', label); button.type = 'button'; button.addEventListener('click', () => run(button, action, 'result-status')); $('result-actions').append(button); return button;
  }
  async function executeDraft() {
    const draft = state.draft;
    if (!draft || state.draftBlocked || !$('send-consent').checked) throw Error('Önce güvenli önizlemeye ait onayı işaretle.');
    let result;
    try { result = await call('send', { draftId: draft.id, hash: draft.hash, confirmed: true }); }
    catch (error) { invalidate(); refreshHistory().catch(() => {}); throw Error(error.message + ' Yeniden denemeden önce yeni önizleme hazırla.'); }
    state.resultDraftId = draft.id;
    $('result-actions').replaceChildren(); text('result-status', ''); show('result-text', false); show('result-panel', true);
    if (draft.mode === 'manual') {
      const context = result.contextText || draft.contextText;
      text('result-heading', 'Bağlamın elle aktarmaya hazır.'); text('result-description', 'Töre harici modele çağrı yapmadı. Kopyaladığın metni nerede kullanacağına sen karar verirsin.'); text('result-text', context); show('result-text', true);
      resultAction('Bağlamı kopyala', async () => { if (!navigator.clipboard?.writeText) throw Error('Tarayıcı panoya erişemiyor. Metni seçerek kopyalayabilir veya indirebilirsin.'); await navigator.clipboard.writeText(context); text('result-status', 'Onayladığın metin panoya kopyalandı.'); });
      resultAction('Metin olarak indir', () => download(context, 'tore-devam-baglami.txt', 'text/plain;charset=utf-8'));
    } else {
      text('result-heading', draft.mode === 'simulation' ? 'Sentetik yanıt, yeni bir dalda.' : 'Model yanıtı, yeni bir dalda.');
      text('result-description', draft.mode === 'simulation' ? 'Bu yanıt teknik akışı göstermek için üretildi; bir AI modelinin gerçek yanıtı değildir.' : 'Yanıt seçili bağlama bağlı yeni bir dal olarak saklandı. Kaynak konuşmadaki önceki dallar korundu.');
      if (result.conversation) {
        const response = result.conversation.messages.find(message => message.id === result.conversation.selectedLeafId) || [...result.conversation.messages].reverse().find(message => message.role === 'assistant');
        if (response) { text('result-text', response.text); show('result-text', true); }
        setConversation(result.conversation);
      }
    }
    state.draft = null; $('send-consent').checked = false; show('draft-panel', false);
    status(draft.mode === 'simulation' ? 'Simülasyon tamamlandı. Harici model çağrısı yapılmadı.' : draft.mode === 'manual' ? 'Elle aktarım metni hazır. Harici model çağrısı yapılmadı.' : 'Canlı işlem tamamlandı. Yanıtın kaynağı ve işlem kaydı saklandı.');
    await refreshHistory(); updateReady(); $('result-panel').scrollIntoView?.({ behavior: 'smooth', block: 'start' });
  }
  async function revoke(id) {
    await call('revoke', { draftId: id });
    if (state.resultDraftId === id) { $('result-actions').replaceChildren(); text('result-status', 'Bu taslağın yeni kopyalama ve indirme işlemleri kapatıldı. Önceden alınmış kopyalar geri çağrılamaz.'); }
    if (state.draft?.id === id) { state.draft = null; show('draft-panel', false); $('send-consent').checked = false; }
    status('Taslağın izni geri çekildi. Önceden gönderilmiş veya indirilmiş kopyalar geri alınmadı.');
    await refreshHistory(); updateReady();
  }
  async function refreshHistory() {
    const result = await call('drafts'); state.drafts = result.drafts || [];
    text('history-count', state.drafts.length); const list = $('draft-history'); list.replaceChildren();
    if (!state.drafts.length) list.append(node('p', 'Henüz hazırlanmış veya onaylanmış taslak yok.', 'empty'));
    const names = { ready: 'Onay bekliyor', revoked: 'İzni geri çekildi', sent: 'İşlem tamamlandı', sending: 'İşlem başlatıldı', unknown: 'Sonuç belirsiz; tekrar onay gerekli', completed: 'Tamamlandı', used: 'İşlendi' };
    for (const draft of [...state.drafts].sort((a, b) => String(b.createdAt || '').localeCompare(String(a.createdAt || ''))).slice(0, 50)) {
      const row = node('div', null, 'history-row'), content = node('div');
      content.append(node('p', (draft.intent !== 'continue' ? 'Eski taslak · artık desteklenmiyor' : draft.mode === 'simulation' ? 'Simülasyon' : draft.mode === 'manual' ? 'Elle aktarım' : 'Canlı devam') + ' · ' + developerName(draft.developer)), node('small', (names[draft.status] || draft.status || 'Kayıtlı') + ' · ' + String(draft.hash || draft.id).slice(0, 16)));
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
  $('conversation-search').addEventListener('input', renderList);
  $('branch-leaf').addEventListener('change', () => { state.leafId = $('branch-leaf').value; invalidate(); initializeRows(); });
  $('select-human').addEventListener('click', () => { for (const row of state.rows.values()) row.checked = row.message.role === 'user' || row.message.role === 'human'; invalidate(); renderMessages(); if (state.scanned) renderScan(); });
  $('clear-selection').addEventListener('click', () => { for (const row of state.rows.values()) row.checked = false; invalidate(); renderMessages(); if (state.scanned) renderScan(); });
  $('scan-pii').addEventListener('click', renderScan);
  $('apply-masks').addEventListener('click', () => { for (const row of selectedRows()) { row.text = masked(row.text); row.feedback = masked(row.feedback); } invalidate(); renderMessages(); renderScan(); status('Seçili örüntüler yalnız seçtiğin mesajların kopyasında ve inceleme notlarında maskelendi. Kaynak metin korunuyor.'); });
  $('literal-masks').addEventListener('input', () => { if (state.scanned) renderScan(); });
  for (const id of ['run-mode', 'target-model']) $(id).addEventListener('change', invalidate);
  $('target-developer').addEventListener('change', () => { invalidate(); renderModels(); });
  $('target-question').addEventListener('input', () => { invalidate(); if (state.scanned) renderScan(); });
  $('prepare-draft').addEventListener('click', () => run($('prepare-draft'), prepareDraft));
  $('send-consent').addEventListener('change', updateReady);
  $('execute-draft').addEventListener('click', () => run($('execute-draft'), executeDraft, 'draft-status'));
  $('revoke-draft').addEventListener('click', () => run($('revoke-draft'), async () => { if (state.draft) await revoke(state.draft.id); }, 'draft-status'));
  $('settings-toggle').addEventListener('click', () => { const visible = $('settings-panel').hidden; show('settings-panel', visible); $('settings-toggle').setAttribute('aria-expanded', String(visible)); if (visible) $('api-key').focus(); });
  $('save-key').addEventListener('click', () => run($('save-key'), async () => {
    const key = $('api-key').value.trim(); $('api-key').value = '';
    if (!key) throw Error('Oturumda kullanmak için bir anahtar gir; kaldırmak için temizle düğmesini kullan.');
    const result = await call('key', { key }); state.keyConfigured = Boolean(result.configured); invalidate(); text('key-state', state.keyConfigured ? 'Anahtar yerel hizmetin belleğinde. Tarayıcıda saklanmıyor.' : 'Anahtar tanımlanamadı.');
  }, 'key-state'));
  $('clear-key').addEventListener('click', () => run($('clear-key'), async () => { $('api-key').value = ''; const result = await call('key', { key: '' }); state.keyConfigured = Boolean(result.configured); invalidate(); text('key-state', state.keyConfigured ? 'Anahtar temizlenemedi.' : 'Oturum anahtarı temizlendi.'); }, 'key-state'));
  $('refresh-catalog').addEventListener('click', () => run($('refresh-catalog'), async () => {
    state.catalogRefreshed = false; updateReady(); const catalog = await call('catalog', { refresh: true });
    state.catalog = { ...catalog, models: catalog.models || [] }; state.catalogRefreshed = true; invalidate(); renderModels();
    text('catalog-state', state.catalog.models.filter(freeModel).length + ' fiyatı sıfır model · ' + dateLabel(catalog.updatedAt) + (catalog.warnings?.length ? '\n' + catalog.warnings.join('\n') : ''));
  }, 'catalog-state'));

  async function initialize() {
    const results = await Promise.allSettled([call('status'), call('list'), call('catalog', { refresh: false }), refreshHistory()]);
    const [statusResult, listResult, catalogResult] = results;
    if (statusResult.status === 'fulfilled') { const info = statusResult.value; state.developers = info.developers || []; state.keyConfigured = Boolean(info.keyConfigured); populateDevelopers(); text('key-state', state.keyConfigured ? 'Bu yerel oturumda bir anahtar tanımlı.' : 'Oturum anahtarı tanımlı değil.'); }
    if (listResult.status === 'fulfilled') { state.conversations = listResult.value.conversations || []; renderList(); }
    if (catalogResult.status === 'fulfilled') { state.catalog = { ...catalogResult.value, models: catalogResult.value.models || [] }; renderModels(); text('catalog-state', 'Kayıtlı katalog yüklendi. İnternetten yenilemek için düğmeyi kullan.'); }
    const failed = results.find(result => result.status === 'rejected');
    status(failed ? failed.reason?.message || 'Yerel hizmete bağlanılamadı.' : 'Yerel alan hazır. Konuşmaların, açık gönderim onayına kadar bu cihazda kalır.', Boolean(failed));
    const params = new URLSearchParams(location.search), sourceConversationId = params.get('conversationId'), sourceMessageId = params.get('messageId');
    if (sourceConversationId && !failed) {
      try {
        await openConversation(sourceConversationId);
        if (sourceMessageId) {
          if (!state.conversation.messages.some(message => message.id === sourceMessageId)) throw Error('Kaynak mesajı bu konuşmada bulunamadı.');
          if (!state.rows.has(sourceMessageId)) {
            state.leafId = sourceMessageId;
            if (![...$('branch-leaf').options].some(item => item.value === sourceMessageId)) $('branch-leaf').append(option(sourceMessageId, 'Kaynak kayda bağlı mesaj bölümü'));
            $('branch-leaf').value = sourceMessageId;
            initializeRows(); text('branch-hint', 'Kaynak kayda bağlı mesaja kadar olan dal gösteriliyor. Devamı için yukarıdan bir dal seçebilirsin.');
          }
          const sourceCard = [...$('message-list').querySelectorAll('[data-message-id]')].find(card => card.dataset.messageId === sourceMessageId);
          if (sourceCard) { sourceCard.tabIndex = -1; sourceCard.focus(); sourceCard.scrollIntoView({ block: 'center' }); }
        }
      } catch (error) { status(error.message, true); }
    }
    updateReady();
  }
  initialize();
})();
