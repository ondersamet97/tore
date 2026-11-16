import { api } from './private-client.js';

// Source edits and provider credentials never go into browser storage.
const ide = id => document.getElementById(id);
const ideology = { preview: null, latest: null, job: null, reportIds: null, pending: false, changed: false, stale: false, timer: null, authTimer: null, previewRequest: 0, revision: 0, draft: null, attempted: false, models: [], connections: {}, rows: new Map(), connectionBusy: false, modelRequest: 0 };
const ideologyCall = (op, body = {}) => api('/api/private/tore/' + op, body);
const el = (tag, text, className) => { const item = document.createElement(tag); if (text !== undefined) item.textContent = text; if (className) item.className = className; return item; };
const developers = [
  ['openai', 'OpenAI / ChatGPT', 'https://chatgpt.com/'], ['anthropic', 'Anthropic / Claude', 'https://claude.ai/'],
  ['google', 'Google / Gemini', 'https://gemini.google.com/'], ['meta', 'Meta', 'https://www.meta.ai/'],
  ['x-ai', 'xAI / Grok', 'https://grok.com/'], ['deepseek', 'DeepSeek', 'https://chat.deepseek.com/'],
  ['moonshotai', 'Moonshot / Kimi', 'https://www.kimi.com/'], ['z-ai', 'Z.ai / GLM', 'https://chat.z.ai/'],
  ['qwen', 'Alibaba / Qwen', 'https://chat.qwen.ai/'], ['mistralai', 'Mistral', 'https://chat.mistral.ai/'],
  ['nvidia', 'NVIDIA', 'https://build.nvidia.com/']
];
const developerName = id => developers.find(row => row[0] === id)?.[1] || id;
const reportScope = () => ideology.reportIds === null ? {} : { reportIds: [...ideology.reportIds] };
const readableDate = value => { const time = new Date(value); return Number.isNaN(time.valueOf()) ? 'Tarih belirtilmemiş' : time.toLocaleString('tr-TR', { day: 'numeric', month: 'long', year: 'numeric', hour: '2-digit', minute: '2-digit' }); };
const running = () => ideology.pending || ideology.job?.status === 'running';
const target = () => ({ connection: ide('ideology-connection').value, developer: ide('ideology-developer').value, modelId: ide(ide('ideology-connection').value === 'manual' ? 'ideology-manual-model' : 'ideology-model').value.trim() });
function showIdeology() { ide('ideology-panel').hidden = false; ide('ideology-nav').setAttribute('aria-expanded', 'true'); ide('ideology-panel').scrollIntoView({ behavior: 'smooth', block: 'start' }); }
function setIdeologyError(message) { ide('ideology-error').textContent = message; ide('ideology-error').hidden = !message; }
function statusText(message) { ide('ideology-status').textContent = message; ide('ideology-hero-status').textContent = message; }
function phaseText(job) {
  const phases = { queued: 'İstek sıraya alındı.', preparing: 'Onayladığın metin hazırlanıyor.', generating: 'Seçtiğin AI hizmetinden yorum bekleniyor…', validating: 'Yorum ve kaynak atıfları kontrol ediliyor.', saving: 'Yorum bu bilgisayara kaydediliyor.' };
  return phases[job?.phase] || 'İsteğin durumu kontrol ediliyor.';
}
function invalidate(message = 'Seçim değişti. Göndermeden önce yeniden önizleme hazırla.') {
  ideology.revision++; ideology.draft = null; ideology.attempted = false;
  ide('ideology-reviewed').checked = false; ide('ideology-send-consent').checked = false; ide('ideology-manual-consent').checked = false;
  ide('ideology-manual-response').value = ''; ide('ideology-copy-status').textContent = ''; ide('ideology-outbound').hidden = true;
  ide('ideology-selection-note').hidden = false; ide('ideology-selection-note').textContent = message;
  refreshControls();
}
function targetReady() {
  const selected = target();
  if (selected.connection === 'manual') return true;
  const connected = selected.connection === 'chatgpt' ? chatgptReady() : ideology.connections.openrouter?.configured;
  return !!connected && ideology.models.some(model => model.id === selected.modelId && model.developer === selected.developer);
}
function chatgptReady() {
  const chat = ideology.connections.chatgpt;
  return !!chat?.connected && chat.sharing === true && !chat.pending && !chat.error;
}
function refreshControls() {
  const busy = running(); ide('ideology-panel').setAttribute('aria-busy', String(busy));
  for (const id of ['ideology-update', 'ideology-refresh', 'ideology-connection', 'ideology-developer', 'ideology-model', 'ideology-manual-model', 'ideology-select-sources', 'ideology-clear-sources', 'ideology-reviewed']) ide(id).disabled = busy;
  ide('ideology-developer').disabled = busy || target().connection === 'chatgpt';
  ide('ideology-model').disabled = busy || (target().connection === 'chatgpt' && !chatgptReady());
  for (const input of ide('ideology-reports').querySelectorAll('input')) input.disabled = busy;
  for (const input of ide('ideology-input-sources').querySelectorAll('input,textarea')) input.disabled = busy;
  ide('ideology-prepare').disabled = busy || !ideology.preview || !targetReady() || !ide('ideology-reviewed').checked || ![...ideology.rows.values()].some(row => row.selected && row.text.trim());
  const canUse = !busy && targetReady() && !!ideology.draft?.canSend && !ideology.attempted;
  ide('ideology-send-consent').disabled = !canUse;
  ide('ideology-send').disabled = !canUse || !ide('ideology-send-consent').checked;
  ide('ideology-copy').disabled = !canUse || !ide('ideology-send-consent').checked;
  ide('ideology-manual-save').disabled = !canUse || !ide('ideology-manual-consent').checked || !ide('ideology-manual-response').value.trim();
  ide('ideology-model-refresh').disabled = busy || ideology.connectionBusy || (target().connection === 'chatgpt' && !chatgptReady());
  ide('ideology-chatgpt-login').disabled = busy || ideology.connectionBusy || !!ideology.connections.chatgpt?.pending;
  ide('ideology-chatgpt-disconnect').disabled = busy || ideology.connectionBusy;
  for (const id of ['ideology-save-key', 'ideology-clear-key']) ide(id).disabled = busy || ideology.connectionBusy;
  ide('ideology-show-latest').hidden = !ideology.latest;
  if (ideology.latest) {
    const previous = busy || ideology.stale || ideology.changed || ['failed', 'interrupted', 'uncertain'].includes(ideology.job?.status);
    const latest = ideology.latest;
    const provenance = latest.engine?.provenance === 'user_attested' || latest.engine?.connection === 'manual' ? 'Elle getirildi · kullanıcı beyanı' : (latest.engine?.localOnly === true || typeof latest.engine === 'string' && /yerel|local/i.test(latest.engine)) ? 'Önceki yerel model yorumu' : 'AI yorumu';
    ide('ideology-result-label').textContent = previous ? 'Önceki yorum · güncelleme bekliyor' : provenance;
    ide('ideology-result-label').className = 'status-pill ' + (previous ? 'uncertain' : 'confirmed');
  }
}
function sourceLabel(source) { return ['confirmed_card', 'opinion', 'confirmed_opinion'].includes(source.kind) ? 'Onaylı görüş' : 'Rapor bölümü'; }
function sourceDetails(source, id) {
  const details = el('details', undefined, 'ideology-source'); if (id) details.id = id;
  details.append(el('summary', source.title || source.id), el('p', sourceLabel(source), 'small'), el('pre', source.text || ''));
  return details;
}
function renderSourceEditors() {
  ide('ideology-input-sources').replaceChildren(...[...ideology.rows.values()].map(row => {
    const item = el('details', undefined, 'ideology-source ideology-editable-source');
    const summary = el('summary', row.source.title || row.source.id);
    const choice = el('label', undefined, 'ideology-check'), selected = el('input'); selected.type = 'checkbox'; selected.checked = row.selected; selected.dataset.sourceId = row.source.id;
    selected.onchange = () => { row.selected = selected.checked; invalidate(); };
    choice.append(selected, el('span', 'Bu kaynağı dahil et · ' + sourceLabel(row.source)));
    const label = el('label', 'Paylaşılacak kaynak metni'), text = el('textarea'); text.value = row.text; text.rows = 5; text.maxLength = 50000; text.dataset.sourceText = row.source.id;
    text.oninput = () => { row.text = text.value; invalidate('Kaynak metni düzenlendi. Yeniden gözden geçir ve önizleme hazırla.'); };
    label.append(text); item.append(summary, choice, label); return item;
  }));
}
function renderPreview(preview) {
  ideology.preview = preview; ideology.stale = !!preview.stale;
  const reports = Array.isArray(preview.reports) ? preview.reports : [], selected = reports.filter(report => report.selected);
  ide('ideology-coverage').textContent = `${preview.confirmedCount || 0} onaylı görüş · ${selected.length} rapor bölümü · ${preview.excludedCount || 0} onaylanmamış görüş kapsam dışında`;
  if (preview.scopeMessage) ide('ideology-coverage').textContent += ` · ${preview.scopeMessage}`;
  ide('ideology-engine').textContent = 'Yerel model kapalı';
  ide('ideology-reports').replaceChildren(...reports.map(report => {
    const label = el('label', undefined, 'ideology-report-choice'), input = el('input'); input.type = 'checkbox'; input.value = report.id; input.checked = !!report.selected; input.dataset.reportId = report.id;
    const text = el('span'); text.append(el('strong', report.title || report.id));
    const total = Number(report.totalCharacters) || 0, included = Number(report.includedCharacters) || 0;
    text.append(el('small', included < total ? `${included.toLocaleString('tr-TR')} / ${total.toLocaleString('tr-TR')} karakter bu önizlemeye dahil` : `${total.toLocaleString('tr-TR')} karakter`));
    input.onchange = () => {
      ideology.reportIds = [...ide('ideology-reports').querySelectorAll('input:checked')].map(item => item.value); ideology.changed = true; invalidate(); loadPreview();
    };
    label.append(input, text); return label;
  }));
  if (!reports.length) ide('ideology-reports').append(el('p', 'Seçilebilecek rapor bölümü bulunamadı. Onaylı görüşlerin kullanılabilir.', 'small'));
  const rows = new Map();
  for (const source of preview.sources || []) { const old = ideology.rows.get(source.id); rows.set(source.id, old && old.source.text === source.text ? { ...old, source } : { source, text: source.text || '', selected: true }); }
  ideology.rows = rows; renderSourceEditors();
  if (preview.latest) renderResult(preview.latest);
  ideology.job = preview.job || null; refreshControls();
}
function renderResult(result) {
  // Polling an ongoing update must not close the previous result's open citations.
  if (ideology.latest?.id === result.id && ideology.latest?.inputHash === result.inputHash) { refreshControls(); return; }
  ideology.latest = result;
  const analysis = result.analysis || {}, sources = Array.isArray(result.sources) ? result.sources : [];
  const lookup = new Map(sources.map((source, index) => [source.id, { source, index }]));
  ide('ideology-result').hidden = false;
  ide('ideology-result-title').textContent = analysis.title || 'Düşüncelerinin bütünlüklü yorumu'; ide('ideology-summary').textContent = analysis.summary || '';
  ide('ideology-result-date').textContent = `${readableDate(result.createdAt)} · ${result.coverage?.confirmedCount || 0} görüş, ${result.coverage?.reportsCount || 0} rapor bölümü`;
  ide('ideology-result-sources').replaceChildren(...sources.map((source, index) => sourceDetails(source, 'ideology-source-' + index)));
  function sourceLink(id) {
    const found = lookup.get(id);
    if (!found) return el('span', 'Kaynak bağlantısı bulunamadı', 'small');
    const link = el('a', found.source.title || id); link.href = '#ideology-source-' + found.index;
    link.onclick = event => { event.preventDefault(); ide('ideology-citations').open = true; const detail = ide('ideology-source-' + found.index); detail.open = true; detail.scrollIntoView({ behavior: 'smooth', block: 'start' }); };
    return link;
  }
  function evidenceDetails(evidence) {
    if (!Array.isArray(evidence) || !evidence.length) return null;
    const details = el('details', undefined, 'ideology-evidence'); details.append(el('summary', 'Dayanakları gör · ' + evidence.length));
    for (const item of evidence) { const row = el('div'); if (item.quote) row.append(el('blockquote', item.quote)); row.append(sourceLink(item.sourceId)); details.append(row); }
    return details;
  }
  for (const [kind, titleKey, textKey] of [['pillars', 'title', 'text'], ['affinities', 'name', 'why'], ['tensions', 'title', 'text']]) {
    const values = Array.isArray(analysis[kind]) ? analysis[kind] : []; ide('ideology-' + kind + '-section').hidden = !values.length;
    ide('ideology-' + kind).replaceChildren(...values.map(value => {
      const item = el('article', undefined, 'ideology-insight'); item.append(el('h5', value[titleKey] || ''), el('p', value[textKey] || ''));
      if (value.limits) item.append(el('p', value.limits, 'ideology-limits'));
      const evidence = evidenceDetails(value.evidence); if (evidence) item.append(evidence); return item;
    }));
  }
  const questions = Array.isArray(analysis.questions) ? analysis.questions : []; ide('ideology-questions-section').hidden = !questions.length;
  ide('ideology-questions').replaceChildren(...questions.map(question => {
    const item = el('article', undefined, 'ideology-question'); item.append(el('h5', question.question || ''), el('p', question.why || ''));
    const links = el('div', undefined, 'ideology-question-links'); for (const id of question.sourceIds || []) links.append(sourceLink(id)); item.append(links); return item;
  }));
  refreshControls();
}
function schedulePoll() { clearTimeout(ideology.timer); ideology.timer = setTimeout(() => pollStatus(), 1500); }
async function pollStatus() {
  clearTimeout(ideology.timer); ide('ideology-check-status').hidden = true;
  try {
    const status = await ideologyCall('ideology-status', reportScope());
    ideology.job = status.job || null; ideology.stale = !!status.stale;
    if (status.latest) renderResult(status.latest);
    if (ideology.job?.status === 'running') { statusText(phaseText(ideology.job)); schedulePoll(); }
    else if (['failed', 'interrupted', 'uncertain'].includes(ideology.job?.status)) { setIdeologyError(ideology.job.error || 'Yorum tamamlanamadı. Önceki yorum korunuyor.'); statusText('Çalışma tamamlanamadı. Kendiliğinden yeniden gönderim yapılmaz.'); }
    else if (status.latest) { setIdeologyError(''); statusText(ideology.stale || ideology.changed ? 'Yorum kaydedildi; kaynakların daha sonra değişti. Yeni bir önizleme hazırlayabilirsin.' : 'İdeoloji yorumun güncellendi. Kaynaklarını ve açık sorularını inceleyebilirsin.'); }
    else statusText('Henüz tamamlanmış bir yorum yok.');
  } catch (err) {
    setIdeologyError(err.message + ' Sonuç doğrulanamadı. Durumunu kontrol edebilirsin; kendiliğinden yeni istek yapılmaz.'); ide('ideology-check-status').hidden = false;
    statusText('İsteğin durum bilgisine ulaşılamadı.');
  } finally { refreshControls(); }
}
async function loadPreview() {
  const request = ++ideology.previewRequest; ideology.pending = true; refreshControls();
  try {
    const preview = await ideologyCall('ideology-preview', reportScope()); if (request !== ideology.previewRequest) return;
    renderPreview(preview);
    if (preview.job?.status === 'running') { statusText(phaseText(preview.job)); schedulePoll(); }
    else if (['failed', 'interrupted', 'uncertain'].includes(preview.job?.status)) { setIdeologyError(preview.job.error || 'Önceki çalışma tamamlanamadı.'); statusText('Önceki yorum korunuyor. Yeni bir önizleme hazırlayabilirsin.'); }
    else statusText(preview.latest ? 'Son yorumun korunuyor. Yeni yorum için kaynakları ve hizmeti seç.' : 'Kaynaklarını seç ve gözden geçir. Gönderim ayrıca onayını bekler.');
  } catch (err) { statusText('Kaynak kapsamı açılamadı. Kaynakları yenile düğmesiyle tekrar deneyebilirsin.'); setIdeologyError(err.message); }
  finally { if (request === ideology.previewRequest) { ideology.pending = false; refreshControls(); } }
}
function renderModels() {
  const selected = target(), previous = ide('ideology-model').value;
  const models = ideology.models.filter(model => model.developer === selected.developer);
  const option = (value, name) => { const item = el('option', name); item.value = value; return item; };
  ide('ideology-model').replaceChildren(option('', models.length ? 'Bir model seç' : 'Uygun model bulunmadı'), ...models.map(model => option(model.id, model.name || model.id)));
  if (models.some(model => model.id === previous)) ide('ideology-model').value = previous;
  refreshControls();
}
function renderConnection() {
  const connection = target().connection, chat = ideology.connections.chatgpt || {};
  ide('ideology-chatgpt').hidden = connection !== 'chatgpt'; ide('ideology-openrouter').hidden = connection !== 'openrouter';
  ide('ideology-model-field').hidden = connection === 'manual'; ide('ideology-manual-model-field').hidden = connection !== 'manual'; ide('ideology-model-refresh').hidden = connection === 'manual';
  const connectionStatus = chat.pending ? 'Tarayıcıdaki resmî ChatGPT girişini tamamla. Henüz içerik gönderilmedi.' : chat.connected && chat.sharing !== true ? 'ChatGPT kimliğin bağlı; plan kullanımını paylaşım izni verilmemiş. Continue with ChatGPT ile yeniden izin ver. Model seçimi bu izin gelene kadar kullanılamaz.' : chat.connected ? 'ChatGPT bağlantısı açık' + (chat.accountLabel ? ' · ' + chat.accountLabel : '') : 'ChatGPT hesabın henüz bağlı değil.';
  ide('ideology-chatgpt-status').textContent = connectionStatus + (chat.error ? ' ' + chat.error : '');
  ide('ideology-chatgpt-login').hidden = chatgptReady(); ide('ideology-chatgpt-disconnect').hidden = !chat.connected && !chat.pending;
  ide('ideology-key-status').textContent = ideology.connections.openrouter?.configured ? 'Anahtar yalnız yerel sunucunun belleğinde. Sıfır fiyat ve gizlilik koşulları gönderimden önce kontrol edilir.' : 'Oturum anahtarı tanımlı değil. Ücretsiz erişim, hesabın kotasına ve uygun uca bağlıdır.';
  ide('ideology-connection-note').textContent = connection === 'chatgpt' ? 'Resmî ChatGPT bağlantısı kendi planındaki uygun erişimi kullanır. Paket ve kota hesabına bağlıdır; otomatik satın alma yapılmaz.' : connection === 'openrouter' ? 'Yalnız fiyatı sıfır ve gizlilik koşuluna uygun erişim kullanılabilir. Uygun uç yoksa gönderim durur; ücretli modele geçilmez.' : 'Kendi ücretsiz veya ücretli sohbet hesabını kullan. Töre o hesaba bağlanmaz; metni sen götürür, yanıtı sen getirirsin.';
  if (connection === 'chatgpt') ide('ideology-developer').value = 'openai';
  renderModels();
}
async function refreshConnections() {
  clearTimeout(ideology.authTimer);
  try {
    ideology.connections = await ideologyCall('connections'); renderConnection();
    if (ideology.connections.chatgpt?.pending) ideology.authTimer = setTimeout(refreshConnections, 1500);
  } catch (err) { setIdeologyError(err.message); }
}
async function connectionAction(op, body = {}) {
  if (ideology.connectionBusy || running()) return; invalidate(); ideology.connectionBusy = true; setIdeologyError(''); refreshControls();
  try { await ideologyCall(op, body); await refreshConnections(); }
  catch (err) { setIdeologyError(err.message); }
  finally { ideology.connectionBusy = false; refreshControls(); }
}
async function loadModels() {
  if (running()) return; invalidate(); const request = ++ideology.modelRequest, connection = target().connection;
  if (connection === 'manual') return;
  ide('ideology-model-note').textContent = 'Uygun modeller kontrol ediliyor…'; ideology.connectionBusy = true; refreshControls();
  try {
    const catalog = await ideologyCall('ideology-models', { connection, refresh: true });
    if (request !== ideology.modelRequest || target().connection !== connection) return;
    ideology.models = Array.isArray(catalog.models) ? catalog.models : []; renderModels();
    ide('ideology-model-note').textContent = (catalog.warnings || []).join(' ') || (ideology.models.length ? 'Katalog hazır. Bir model seç; henüz kaynak metni gönderilmedi.' : 'Uygun model bulunamadı. Kendi sohbet hesabınla kopyala ve geri getir yolunu kullanabilirsin.');
  } catch (err) { if (request === ideology.modelRequest) { ideology.models = []; renderModels(); ide('ideology-model-note').textContent = err.message; } }
  finally { ideology.connectionBusy = false; refreshControls(); }
}
function renderDraft(draft) {
  ideology.draft = draft; ideology.attempted = false; ide('ideology-outbound').hidden = false;
  const manual = draft.target.connection === 'manual';
  ide('ideology-draft-target').textContent = `${developerName(draft.target.developer)}${draft.target.modelId ? ' · ' + draft.target.modelId : ''} · ${manual ? 'Elle aktarım' : draft.target.connection === 'chatgpt' ? 'ChatGPT bağlantısı' : 'OpenRouter bağlantısı'}`;
  ide('ideology-draft-cost').textContent = draft.cost?.caption || 'Maliyet bilgisi doğrulanamadı.';
  ide('ideology-draft-privacy').textContent = draft.privacy?.caption || 'Bu metin seçilen dış hizmet tarafından işlenir. Göndermeden önce kapsamı kontrol et.';
  ide('ideology-prompt').textContent = draft.prompt || '';
  const findings = Array.isArray(draft.findings) ? draft.findings : [];
  ide('ideology-findings').replaceChildren(...findings.map(finding => el('p', `${finding.kind || 'Özel bilgi'} bulundu · ${ideology.rows.get(finding.sourceId)?.source.title || 'Seçili kaynak'}. Kaynak metnini düzenle veya kaynağı çıkarıp yeniden önizleme hazırla.`, 'small')));
  if (!findings.length) ide('ideology-findings').append(el('p', 'Yerel taramada engelleyici örüntü bulunmadı. Bu kontrol anonimlik garantisi vermez.', 'small'));
  ide('ideology-send').hidden = manual; ide('ideology-manual').hidden = !manual;
  ide('ideology-send-consent').checked = false; ide('ideology-manual-consent').checked = false;
  ide('ideology-send-consent-label').textContent = manual ? 'Bu metni panoya kopyalayıp seçtiğim hizmete kendim götürmek istiyorum. Bu onay veri satışı veya eğitim lisansı değildir.' : 'Bu metnin seçtiğim AI hizmetine gönderilmesini onaylıyorum. Bu onay veri satışı veya eğitim lisansı değildir.';
  ide('ideology-service-link').href = developers.find(row => row[0] === draft.target.developer)?.[2] || 'https://chatgpt.com/';
  ide('ideology-selection-note').hidden = true; refreshControls();
}
async function prepareDraft() {
  if (ide('ideology-prepare').disabled) return; const revision = ideology.revision;
  ideology.pending = true; setIdeologyError(''); refreshControls();
  const selected = [...ideology.rows.values()].filter(row => row.selected);
  try {
    const prepared = await ideologyCall('ideology-prepare', { ...reportScope(), target: target(), sourceIds: selected.map(row => row.source.id), edits: selected.map(row => ({ id: row.source.id, text: row.text })) });
    if (revision !== ideology.revision) return;
    if (!prepared.draft?.id || !prepared.draft?.hash) throw Error('Gönderim önizlemesi doğrulanamadı.');
    renderDraft(prepared.draft); statusText(prepared.draft.canSend ? 'Önizleme hazır. Henüz içerik gönderilmedi; son kontrol ve onayın bekleniyor.' : 'Önizlemede özel bilgi bulundu. Kaynakları düzenleyip yeniden hazırla.');
    ide('ideology-outbound').scrollIntoView({ behavior: 'smooth', block: 'start' });
  } catch (err) { setIdeologyError(err.message); }
  finally { ideology.pending = false; refreshControls(); }
}
async function sendDraft(manual = false) {
  if (ide(manual ? 'ideology-manual-save' : 'ideology-send').disabled || !ideology.draft) return;
  const draft = ideology.draft; ideology.pending = true; ideology.attempted = true; setIdeologyError(''); refreshControls();
  const request = { draftId: draft.id, draftHash: draft.hash, confirmed: true, requestId: crypto.randomUUID() };
  if (manual) request.text = ide('ideology-manual-response').value;
  try {
    const response = await ideologyCall(manual ? 'ideology-manual' : 'ideology-send', request);
    ideology.job = response.job || null; ideology.changed = false; ideology.stale = !!response.stale;
    if (response.latest) renderResult(response.latest);
    if (ideology.job?.status === 'running') { statusText(phaseText(ideology.job)); schedulePoll(); }
    else if (response.latest) statusText('Getirdiğin yorum kaydedildi. Kaynaklarını ve açık sorularını inceleyebilirsin.');
    else await pollStatus();
  } catch (err) {
    setIdeologyError(err.message + ' Önceki yorumun korunuyor. Kendiliğinden tekrar gönderilmez.'); statusText('İstek tamamlanamadı veya sonucu doğrulanamadı.'); ide('ideology-check-status').hidden = false;
  } finally { ideology.pending = false; refreshControls(); }
}
async function copyDraft() {
  if (ide('ideology-copy').disabled || !ideology.draft) return;
  try { await navigator.clipboard.writeText(ideology.draft.prompt); ide('ideology-copy-status').textContent = 'Metin kopyalandı. Hizmetin sohbetine kendin yapıştırabilirsin; Töre içerik göndermedi.'; }
  catch { ide('ideology-copy-status').textContent = 'Pano izni verilmedi. Yukarıdaki tam metni seçip kendin kopyalayabilirsin.'; }
}
for (const [id, name] of developers) { const option = el('option', name); option.value = id; ide('ideology-developer').append(option); }
for (const id of ['ideology-nav', 'ideology-update']) ide(id).onclick = () => { showIdeology(); if (!running()) { invalidate(); loadPreview(); } };
ide('ideology-refresh').onclick = () => { if (!running()) { invalidate(); loadPreview(); } };
ide('ideology-show-latest').onclick = showIdeology;
ide('ideology-close').onclick = () => { ide('ideology-panel').hidden = true; ide('ideology-nav').setAttribute('aria-expanded', 'false'); };
ide('ideology-check-status').onclick = pollStatus;
ide('ideology-connection').onchange = () => { ideology.modelRequest++; ideology.models = []; ide('ideology-model-note').textContent = ''; invalidate(); renderConnection(); };
ide('ideology-developer').onchange = () => { invalidate(); renderModels(); };
ide('ideology-model').onchange = () => invalidate(); ide('ideology-manual-model').oninput = () => invalidate();
ide('ideology-model-refresh').onclick = loadModels;
ide('ideology-chatgpt-login').onclick = () => connectionAction('chatgpt-login');
ide('ideology-chatgpt-disconnect').onclick = () => connectionAction('chatgpt-disconnect');
ide('ideology-save-key').onclick = () => { const key = ide('ideology-key').value.trim(); ide('ideology-key').value = ''; if (!key) { setIdeologyError('Bu oturumda kullanmak için bir anahtar gir.'); return; } connectionAction('key', { key }); };
ide('ideology-clear-key').onclick = () => { ide('ideology-key').value = ''; connectionAction('key', { key: '' }); };
for (const [id, selected] of [['ideology-select-sources', true], ['ideology-clear-sources', false]]) ide(id).onclick = () => { for (const row of ideology.rows.values()) row.selected = selected; invalidate(); renderSourceEditors(); refreshControls(); };
ide('ideology-reviewed').onchange = refreshControls; ide('ideology-send-consent').onchange = refreshControls; ide('ideology-manual-consent').onchange = refreshControls; ide('ideology-manual-response').oninput = refreshControls;
ide('ideology-prepare').onclick = prepareDraft; ide('ideology-send').onclick = () => sendDraft(); ide('ideology-copy').onclick = copyDraft; ide('ideology-manual-save').onclick = () => sendDraft(true);
window.addEventListener('tore-opinions-updated', () => { ideology.changed = true; ideology.stale = true; ideology.preview = null; invalidate('Görüşlerin değişti. Kaynakları yenile ve yeniden önizleme hazırla.'); if (!running()) statusText('Görüşlerin değişti. Kaynakları yenileyerek bütünlüklü yorumunu güncelleyebilirsin.'); refreshControls(); });
window.addEventListener('pagehide', () => { clearTimeout(ideology.timer); clearTimeout(ideology.authTimer); });
renderConnection(); loadPreview(); refreshConnections();
