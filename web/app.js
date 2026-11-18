import { createIdentity, unlockIdentity, signPayload, recoveryText } from './identity.js';

const $ = id => document.getElementById(id);
const areaNames = { past: 'Geçmiş', present: 'Şimdi', future: 'Gelecek' };
const kindNames = { position: 'Görüş / ideal', prediction: 'Tahmin', question: 'Açık soru' };
const categoryNames = { fact: 'Olgusal bilgi', prediction: 'Tahmin', value: 'Değer', goal: 'Hedef', method: 'Yöntem', scope: 'Kapsam / bağlam' };
const scopeNames = { author: 'Kişi', topic: 'Konu', post: 'Yayın', discussion: 'Tartışma' };
const state = { identity: null, snapshot: null, busy: false, downloaded: false, section: 'feed', selectedPost: null, selectedVersion: null, transfer: null, feed: { feed: 'all', targetId: null, topic: null, subtopic: null, area: null } };
let lifecycleCandidate=null;
const postDrafts=new Map();let activeDraftKey=null,postInitial='',postProvenance=null;
const currentMember=()=>state.snapshot?.me.id||state.identity?.id;
let bootstrapInvite='';try{bootstrapInvite=sessionStorage.getItem('tore-bootstrap-invite')||'';}catch(_){}
const invite = new URLSearchParams(location.hash.slice(1)).get('davet') || bootstrapInvite;
$('register-invite').value = invite;
if (invite) history.replaceState(null, '', location.pathname + location.search);
function node(tag, text, cls) { const el = document.createElement(tag); if (text !== undefined) el.textContent = text; if (cls) el.className = cls; return el; }
function button(text, fn, cls) { const b = node('button', text, cls); b.type = 'button'; b.addEventListener('click', fn); return b; }
function date(value) { return new Date(value).toLocaleString('tr-TR', { dateStyle: 'medium', timeStyle: 'short' }); }
function person(id) { return state.snapshot?.people.find(p => p.id === id)?.name || id.slice(0, 12) + '…'; }
function post(id) { return state.snapshot?.posts.find(p => p.id === id); }
function version(p, n = p.currentVersion) { return p.versions.find(v => v.version === Number(n)); }
function selected() { const p = post(state.selectedPost); return p ? { p, v: version(p, state.selectedVersion) || version(p) } : null; }
function status(text, error = false) { $('status').textContent = text; $('status').className = error ? 'status error' : 'status'; }
function dialog(id) { $(id).showModal(); }
function close(id) { $(id).close(); }
function empty(host, text) { host.replaceChildren(node('p', text, 'empty')); }
function sync() {
  const ready = !!state.snapshot, identity = !!state.identity;
  $('locked-welcome').hidden = ready; $('member-content').hidden = !ready;
  $('identity-state').textContent = ready ? state.snapshot.me.name : identity ? 'Kimlik açık · kayıt bekliyor' : 'Kimlik kapalı';
  $('identity-open').hidden = identity; $('identity-lock').hidden = !identity;
  for (const id of ['post-new', 'profile-edit', 'key-manage', 'data-export', 'data-import']) $(id).disabled = !ready || state.busy;
  $('key-redownload').disabled = !identity || state.busy;
  $('invite-new').hidden = !ready || !state.snapshot.me.admin;$('network-export').hidden=!ready||!state.snapshot.me.admin;$('network-import-label').hidden=!ready||!state.snapshot.me.admin;
  $('feed-previous').disabled=state.busy||!ready||(state.snapshot.pagination?.page||1)<=1;$('feed-next').disabled=state.busy||!ready||!state.snapshot.pagination?.hasMore;
  $('register-submit').disabled = !identity || !state.downloaded || !$('key-saved-confirm').checked || state.busy;
  for (const form of document.querySelectorAll('dialog form')) for (const b of form.querySelectorAll('button[type=submit]')) if (b.id !== 'register-submit') b.disabled = state.busy;
  for (const id of ['identity-tab-create', 'identity-tab-unlock', 'identity-lock', 'download-key', 'refresh', 'comparison-new', 'follow-new', 'notifications-read', 'invite-new', 'transfer-confirm']) $(id).disabled = state.busy;
  for (const b of document.querySelectorAll('#reader-content button,#comparison-list button,#follow-list button,#notification-list button')) b.disabled = state.busy;
  for(const b of document.querySelectorAll('#lifecycle-dialog button'))b.disabled=state.busy;
  $('unread-count').textContent = String(state.snapshot?.notifications.filter(n => !n.read).length || 0);
}
async function run(fn) {
  if (state.busy) return;
  state.busy = true; sync();
  try { await fn(); } catch (error) { status(error.message || 'İşlem tamamlanamadı.', true); }
  finally { state.busy = false; sync(); }
}
async function api(action, payload, options={}) {
  const signer=options.identity||state.identity;
  if (!signer) throw new Error('Önce kimliğinizi açın.');
  const event = JSON.stringify({ version: 1, id: options.eventId||crypto.randomUUID(), author: signer.id, issuedAt: new Date().toISOString(), action, payload });
  const signature = await signPayload(signer, event);
  let response;
  try { response = await fetch('/api/event', { method: 'POST', credentials: 'omit', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ event, signature }), cache: 'no-store' }); }
  catch { throw new Error('Töre’ye ulaşılamadı. Yerel uygulamanın açık olduğunu kontrol edip yeniden deneyin.'); }
  let value;
  try { value = await response.json(); } catch { throw new Error('Töre’den geçerli bir yanıt alınamadı.'); }
  if (!response.ok || value.ok === false) throw new Error(value.error || 'İşlem kabul edilmedi.');
  return value;
}
async function refresh() {
  state.snapshot = await api('snapshot', { page:1,pageSize:50,...state.feed });
  const pagination=state.snapshot.pagination||{page:1,total:state.snapshot.feedIds.length,hasMore:false};state.feed.page=pagination.page;$('feed-page').textContent=`Sayfa ${pagination.page} · Toplam ${pagination.total} yayın`;
  renderFeedTargets(); renderFeed(); renderReader(); renderComparisons(); renderFollows(); renderNotifications(); sync();
}
function showSection(name) {
  state.section = name;
  for (const key of ['feed', 'comparisons', 'follows', 'notifications']) $('section-' + key).hidden = key !== name;
  for (const b of document.querySelectorAll('[data-section]')) if (b.dataset.section === name) b.setAttribute('aria-current', 'page'); else b.removeAttribute('aria-current');
}
function download(text, name, type = 'application/json') {
  const url = URL.createObjectURL(new Blob([text], { type }));
  const a = node('a'); a.href = url; a.download = name; document.body.append(a); a.click(); a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}
function downloadKey() {
  if (!state.identity) throw new Error('Önce kimliğinizi açın.');
  download(recoveryText(state.identity), `Töre-anahtar-${state.identity.id.slice(0, 12)}.json`);
  state.downloaded = true; $('key-saved-confirm').disabled = false;
  status('Şifreli anahtar indirmesi başlatıldı. Dosyayı tarayıcının indirmeler bölümünden kontrol edin.'); sync();
}
function identityTab(tab) {
  $('identity-start').hidden = false; $('identity-recovery').hidden = true;
  $('identity-create-form').hidden = tab !== 'create'; $('identity-unlock-form').hidden = tab !== 'unlock';
  $('identity-tab-create').setAttribute('aria-pressed', String(tab === 'create')); $('identity-tab-unlock').setAttribute('aria-pressed', String(tab === 'unlock'));
}
function openIdentity(tab) { identityTab(tab); dialog('identity-dialog'); }
function recoveryPhase(imported = false) {
  $('identity-start').hidden = true; $('identity-recovery').hidden = false;
  $('key-saved-confirm').checked = false; $('key-saved-confirm').disabled = !imported;
  $('recovery-message').textContent = imported ? 'Anahtar dosyanız açıldı. Bu Töre alanına henüz kayıtlı değilseniz davetle katılabilirsiniz. Elinizdeki anahtar dosyasını sakladığınızı doğrulayın.' : 'Kimliğiniz hazır. Şifreli anahtar dosyasını indirin ve tarayıcının indirmeler bölümünden kontrol edin.';
  state.downloaded = imported; sync();
}
function lock() {
  savePostDraft();$('post-form').reset();activeDraftKey=null;postProvenance=null;lifecycleCandidate=null;
  state.identity = null; state.snapshot = null; state.downloaded = false; state.selectedPost = null; state.selectedVersion = null; state.transfer = null;
  for (const input of document.querySelectorAll('input[type=password],input[type=file]')) input.value = '';
  $('key-saved-confirm').checked = false; $('reader-article').replaceChildren(); $('reader-raw').textContent = '';
  for (const id of ['feed-list', 'reply-list', 'comparison-list', 'follow-list', 'notification-list', 'transfer-posts']) $(id).replaceChildren();
  for (const el of document.querySelectorAll('dialog[open]')) el.close();
  sync(); status('Kimliğiniz kilitlendi. Tekrar açmak için şifreli anahtar dosyanızı kullanın.');
}
function renderFeedTargets() {
  const type = $('feed-kind').value, needed = ['author', 'post', 'discussion'].includes(type), old = state.feed.targetId || $('feed-target').value;
  $('feed-target-label').hidden = !needed;
  const options = type === 'author' ? (state.snapshot?.people || []).map(p => [p.id, p.name]) : (state.snapshot?.posts || []).map(p => [p.id, version(p).title]);
  $('feed-target').replaceChildren(...options.map(([id, text]) => new Option(text, id)));
  if (options.some(([id]) => id === old)) $('feed-target').value = old;
  $('feed-topic-label').firstChild.textContent = type === 'topic' ? 'Takip edilen konu' : 'Konu';
}
function renderFeed() {
  const host = $('feed-list'); host.replaceChildren();
  const words = ToruReader.fold($('feed-search').value.trim()).split(/\s+/).filter(Boolean);
  const ids = new Set(state.snapshot.feedIds), rows = state.snapshot.posts.filter(p => ids.has(p.id) && words.every(word => { const v = version(p); return ToruReader.fold(v.title + '\n' + v.text).includes(word); }));
  if (!rows.length) return empty(host, state.feed.feed === 'following' ? 'Takip tercihlerinize uyan bir yayın yok. Takiplerim bölümünden başlayabilirsiniz.' : 'Bu görünümde henüz yayın yok. Filtreleri değiştirebilir veya yeni bir yayın yazabilirsiniz.');
  for (const p of rows) {
    const v = version(p), b = button('', () => { state.selectedPost = p.id; state.selectedVersion = p.currentVersion; renderFeed(); renderReader(); }, 'post-card' + (p.id === state.selectedPost ? ' selected' : ''));
    b.append(node('p', `${areaNames[v.area]} · ${kindNames[v.viewType]}`, 'eyebrow'), node('h3', v.title), node('p', v.text.slice(0, 160) + (v.text.length > 160 ? '…' : '')), node('span', `${person(p.author)} · Sürüm ${p.currentVersion} · ${date(v.createdAt)}`, 'small muted'));
    b.dataset.postId = p.id; host.append(b);
  }
}
function renderReader() {
  const item = selected(); $('reader-empty').hidden = !!item; $('reader-content').hidden = !item;
  if (!item) return;
  const { p, v } = item; state.selectedVersion = v.version;
  $('reader-context').textContent = [areaNames[v.area], v.topic, v.subtopic, kindNames[v.viewType]].filter(Boolean).join(' · ');
  $('reader-title').textContent = v.title; $('reader-author').textContent = person(p.author); $('reader-date').textContent = date(v.createdAt);
  $('reader-version').replaceChildren(...[...p.versions].reverse().map(v => new Option(`Sürüm ${v.version}${v.version === p.currentVersion ? ' · güncel' : ''}`, String(v.version)))); $('reader-version').value = String(v.version);
  $('reader-reason').hidden = !v.reason; $('reader-reason').textContent = v.reason ? 'Değişiklik gerekçesi: ' + v.reason : '';
  $('reader-revise').hidden = p.author !== currentMember();
  ToruReader.render(v.text, $('reader-article'), $('reader-toc'));const provenance=$('reader-provenance');provenance.hidden=!v.provenance;if(v.provenance){const p=v.provenance;provenance.replaceChildren(node('p',p.representation==='thinker'?'Düşünür derlemesi: '+p.profileName+' · Hazırlayan: '+p.editor+'. Tarihsel kişinin kendi hesabı veya yayınlayanın onayı değildir.':p.representation==='analysis'?'Kullanıcının karşılaştırma analizi; kaynak kişilerin kendi yayını veya onayı değildir.':'Kaydedilmiş kişisel görüş sürümünden aktarım.'));for(const source of p.sources){const line=node('p',source.label);if(source.url){const a=node('a','Kaynağı aç');a.href=source.url;a.target='_blank';a.rel='noopener noreferrer';line.append(' · ',a);}provenance.append(line);}} $('reader-raw').textContent = v.text;
  const host = $('reply-list'); host.replaceChildren();
  const rows = state.snapshot.replies.filter(r => r.postId === p.id && Number(r.version) === v.version);
  $('reply-count').textContent = String(rows.length);
  if (!rows.length) empty(host, 'Bu sürüme henüz yanıt verilmedi.');
  for (const r of rows) {
    const card = node('section', undefined, 'reply-card'); card.dataset.replyId = r.id;
    card.append(node('p', person(r.author) + ' · ' + date(r.createdAt), 'small muted'), node('blockquote', r.quote), node('p', r.text));
    const badges = node('p'); badges.append(node('span', r.answered ? 'Yanıtlandı' : 'Yanıt bekliyor', 'badge'), node('span', r.resolved ? 'Çözüldü' : 'Açık', 'badge' + (r.resolved ? ' resolved' : ''))); card.append(badges);
    const actions = node('div', undefined, 'reply-actions');
    if (p.author === currentMember() && !r.answered) actions.append(button('Yanıtlandı işaretle', () => run(async () => { await api('reply_status', { replyId: r.id, status: 'answered' }); await refresh(); status('Yanıtlandı işaretlendi. Çözüm durumu değişmedi.'); })));
    if (r.author === currentMember()) actions.append(button(r.resolved ? 'Yeniden açık olarak işaretle' : 'Çözüldü işaretle', () => run(async () => { await api('reply_status', { replyId: r.id, status: r.resolved ? 'open' : 'resolved' }); await refresh(); status(r.resolved ? 'Yanıt yeniden açık olarak işaretlendi.' : 'Yanıtı çözüldü olarak işaretlediniz.'); })));
    card.append(actions); host.append(card);
  }
}
function postFields() { return { title: $('post-title').value, text: $('post-text').value, topic: $('post-topic').value, subtopic: $('post-subtopic').value, area: $('post-area').value, viewType: $('post-type').value }; }
function draftValue(){return {...postFields(),reason:$('post-reason').value,provenance:postProvenance};}
function draftChanged(){return activeDraftKey && JSON.stringify(draftValue())!==postInitial;}
function savePostDraft(){if(!activeDraftKey)return;const data=draftValue();if(draftChanged())postDrafts.set(activeDraftKey,{...data,id:$('post-edit-id').value,expectedVersion:$('post-edit-id').dataset.expectedVersion,initial:postInitial});}
function closePostDraft(){savePostDraft();if(draftChanged()&&!confirm('Taslağınız bu sekme açık kaldığı sürece korunacak. Sekmeyi kapatmak taslağı siler; isterseniz önce taslak dosyasını indirin. Düzenleyici kapatılsın mı?'))return;close('post-dialog');}
function openPostEditor(edit = false) {
  savePostDraft();const p=edit?selected().p:null;
  activeDraftKey=currentMember()+'/'+(p?.id||'new');
  $('post-form').reset(); $('post-edit-id').value = '';postProvenance=null;
  $('post-reason-label').hidden = !edit; $('post-reason').required = edit;
  $('post-dialog-title').textContent = edit ? 'Yeni sürüm yaz' : 'Yeni yayın'; $('post-submit').textContent = edit ? 'Yeni sürümü yayımla' : 'Yayımla';
  if (edit) {
    const v=version(p); $('post-edit-id').value = p.id; $('post-edit-id').dataset.expectedVersion = p.currentVersion;postProvenance=v.provenance||null;
    for (const [id, value] of [['post-title', v.title], ['post-text', v.text], ['post-topic', v.topic], ['post-subtopic', v.subtopic], ['post-area', v.area], ['post-type', v.viewType]]) $(id).value = value;
  }
  postInitial=JSON.stringify(draftValue());
  const saved=postDrafts.get(activeDraftKey);
  if(saved){for(const [field,id]of Object.entries({title:'post-title',text:'post-text',topic:'post-topic',subtopic:'post-subtopic',area:'post-area',viewType:'post-type',reason:'post-reason'}))$(id).value=saved[field]||'';postProvenance=saved.provenance;postInitial=saved.initial;$('post-edit-id').dataset.expectedVersion=saved.expectedVersion||'';status('Yayımlanmamış taslağınız bu sekmenin belleğinden geri açıldı.');}
  renderPostProvenance();dialog('post-dialog');
}
function renderPostProvenance(){const box=$('post-provenance');box.hidden=!postProvenance;if(!postProvenance){box.textContent='';return;}box.textContent=postProvenance.representation==='thinker'?'Kaynaklı düşünür derlemesi: '+postProvenance.profileName+' · Hazırlayan: '+postProvenance.editor+'. Bu, düşünürün kendi hesabı veya sizin bu görüşü benimsediğiniz anlamına gelmez.':postProvenance.representation==='analysis'?'Kullanıcı tarafından hazırlanmış karşılaştırma analizi; kaynak tarafların onayı değildir.':'Kişisel görüşün seçili kaynak sürümü. Yayımlamadan önce metni ve kaynak bilgisini inceleyin.';}
function validateSharePacket(data){
  if(data?.format!=='tore-share-draft'||data.version!==1||!['view','comparison'].includes(data.kind)||typeof data.title!=='string'||typeof data.text!=='string'||typeof data.topic!=='string'||!['past','present','future'].includes(data.area)||!['position','prediction','question'].includes(data.viewType))throw Error('Geçerli bir Töre paylaşma taslağı seçin.');
  const p=data.provenance;if(!p||!['self','thinker','analysis'].includes(p.representation)||typeof p.profileName!=='string'||typeof p.editor!=='string'||!Array.isArray(p.revisionIds)||!p.revisionIds.length||p.revisionIds.some(id=>typeof id!=='string'||!/^[0-9a-f-]{36}$/i.test(id))||!Array.isArray(p.sources)||p.sources.length>100||typeof p.createdAt!=='string'||!Number.isFinite(Date.parse(p.createdAt)))throw Error('Paylaşma taslağının kaynak/temsil bilgileri eksik.');
  const allowed=['representation','profileName','editor','revisionIds','sources','createdAt'];if(Object.keys(p).some(key=>!allowed.includes(key)))throw Error('Paylaşma taslağında beklenmeyen özel metadata var.');
  for(const source of p.sources){if(!source||Object.keys(source).some(key=>!['label','url'].includes(key))||typeof source.label!=='string'||typeof source.url!=='string')throw Error('Geçersiz kaynak kaydı.');if(source.url){let url;try{url=new URL(source.url);}catch{throw Error('Geçersiz kaynak bağlantısı.');}if(!['http:','https:'].includes(url.protocol))throw Error('Kaynak bağlantısı HTTP/HTTPS olmalı.');}}
  return data;
}

function openReply() {
  const { p, v } = selected(); $('reply-form').reset(); $('reply-target').textContent = `${v.title} · Sürüm ${v.version}`;
  $('reply-form').dataset.postId = p.id; $('reply-form').dataset.version = v.version;
  const selection = window.getSelection();
  if (selection && $('reader-article').contains(selection.anchorNode) && $('reader-article').contains(selection.focusNode)) { const quote = selection.toString(); if (v.text.includes(quote)) $('reply-quote').value = quote; }
  dialog('reply-dialog');
}
function referenceOptions() { return state.snapshot.posts.flatMap(p => p.versions.map(v => ({ value: `${p.id}:${v.version}`, label: `${v.title} · ${person(p.author)} · Sürüm ${v.version}` }))); }
function parseReference(value) { const [postId, n] = value.split(':'); return { postId, version: Number(n) }; }
function referenceVersion(value) { const r = parseReference(value), p = post(r.postId); return p ? version(p, r.version) : null; }
function updateComparisonPreviews() { for (const side of ['left', 'right']) $('comparison-' + side + '-text').textContent = referenceVersion($('comparison-' + side).value)?.text || 'Kaynak metin bulunamadı.'; }
function fillAssessment(a = {}) {
  $('comparison-question').value = a.commonQuestion || ''; $('comparison-category').value = a.category || 'fact'; $('comparison-shared').value = a.sharedGround || ''; $('comparison-difference').value = a.difference || '';
  $('comparison-left-evidence').value = (a.leftEvidence || []).join('\n'); $('comparison-right-evidence').value = (a.rightEvidence || []).join('\n'); $('comparison-open').value = (a.openQuestions || []).join('\n');
}
function openComparison(c = null) {
  $('comparison-form').reset(); $('comparison-edit-id').value = c?.id || ''; $('comparison-dialog-title').textContent = c ? 'Karşılaştırmayı düzenle' : 'Karşılaştırma yaz';
  const options = referenceOptions();
  if (options.length < 2) throw new Error('Karşılaştırma için en az iki farklı kaynak metin/sürüm gerekir. Önce yayın ekleyin.');
  for (const side of ['left', 'right']) { const select = $('comparison-' + side); select.replaceChildren(...options.map(o => new Option(o.label, o.value))); select.disabled = !!c; }
  $('comparison-right').selectedIndex = 1;
  if (c) { $('comparison-left').value = `${c.left.postId}:${c.left.version}`; $('comparison-right').value = `${c.right.postId}:${c.right.version}`; }
  fillAssessment(c?.assessment); updateComparisonPreviews(); dialog('comparison-dialog');
}
function assessment() { return { commonQuestion: $('comparison-question').value, category: $('comparison-category').value, sharedGround: $('comparison-shared').value, difference: $('comparison-difference').value, leftEvidence: [$('comparison-left-evidence').value], rightEvidence: [$('comparison-right-evidence').value], openQuestions: $('comparison-open').value.split('\n').map(x => x.trim()).filter(Boolean) }; }
function renderComparisons() {
  const host = $('comparison-list'); host.replaceChildren();
  if (!state.snapshot.comparisons.length) return empty(host, 'Henüz karşılaştırma yok. İki kaynak metni seçip kendi değerlendirmenizi yazabilirsiniz.');
  for (const c of [...state.snapshot.comparisons].reverse()) {
    const a = c.assessment, card = node('section', undefined, 'info-card'); card.dataset.comparisonId = c.id;
    card.append(node('p', person(c.author) + ' · ' + categoryNames[a.category], 'meta'), node('h3', a.commonQuestion));
    const sides = node('div', undefined, 'comparison-summary');
    for (const side of ['left', 'right']) {
      const box = node('section'), r = c[side], p = post(r.postId), v = p && version(p, r.version);
      box.append(button((v?.title || 'Kaynak') + ` · Sürüm ${r.version}`, () => { state.selectedPost = r.postId; state.selectedVersion = r.version; showSection('feed'); renderReader(); renderFeed(); }));
      for (const quote of a[side + 'Evidence']) box.append(node('blockquote', quote)); sides.append(box);
    }
    card.append(sides);
    if (a.sharedGround) card.append(node('h4', 'Ortak zemin'), node('p', a.sharedGround));
    if (a.difference) card.append(node('h4', 'Ayrışma'), node('p', a.difference));
    if (a.openQuestions.length) { const list = node('ul'); for (const q of a.openQuestions) list.append(node('li', q)); card.append(node('h4', 'Açık sorular'), list); }
    const history = node('details'); history.append(node('summary', `Değerlendirme geçmişi (${c.history.length})`));
    for (const h of [...c.history].reverse()) { const entry = node('section'); entry.append(node('p', date(h.createdAt), 'small muted'), node('p', h.assessment.commonQuestion), node('p', h.assessment.difference || 'Ayrışma notu eklenmemiş.')); history.append(entry); }
    card.append(history);
    if (c.author === currentMember()) card.append(button('Değerlendirmeyi düzenle', () => run(async () => openComparison(c)))); host.append(card);
  }
}
function followTargetOptions(scope) { return scope === 'author' ? state.snapshot.people.map(p => [p.id, p.name]) : state.snapshot.posts.map(p => [p.id, version(p).title]); }
function updateFollowTargets(preferred) {
  const scope = $('follow-scope').value; $('follow-target-label').hidden = scope === 'topic'; $('follow-topic-target-label').hidden = scope !== 'topic'; $('follow-topic-target').required = scope === 'topic';
  const options = followTargetOptions(scope); $('follow-target').replaceChildren(...options.map(([id, text]) => new Option(text, id))); if (preferred && options.some(([id]) => id === preferred)) $('follow-target').value = preferred;
}
function openFollow(scope = 'author', targetId = '') {
  $('follow-form').reset();
  for (const id of ['follow-scope', 'follow-target', 'follow-topic-target', 'follow-topic', 'follow-subtopic', 'follow-area']) $(id).disabled = false;
  $('follow-dialog').querySelector('h2').textContent = 'Takip tercihleri'; $('follow-form').querySelector('button[type=submit]').textContent = 'Takibi kaydet';
  $('follow-scope').value = scope; updateFollowTargets(targetId); if (scope === 'topic') $('follow-topic-target').value = targetId; dialog('follow-dialog');
}
function followTitle(f) { return f.scope === 'author' ? person(f.targetId) : f.scope === 'topic' ? f.targetId : post(f.targetId) ? version(post(f.targetId)).title : 'Yayın bulunamadı'; }
function renderFollows() {
  const host = $('follow-list'); host.replaceChildren();
  if (!state.snapshot.follows.length) return empty(host, 'Henüz takip tercihi yok. Bir yayın içinden yazarı, yayını veya tartışmayı takip edebilirsiniz.');
  for (const f of state.snapshot.follows) {
    const card = node('section', undefined, 'info-card'); card.dataset.followId = f.id;
    card.append(node('p', scopeNames[f.scope], 'eyebrow'), node('h3', followTitle(f)), node('p', [f.topic && 'Konu: ' + f.topic, f.subtopic && 'Alt konu: ' + f.subtopic, f.area && areaNames[f.area]].filter(Boolean).join(' · ') || 'Tüm alanlar', 'small muted'));
    card.append(node('p', 'Bildirimler: ' + ([f.notifyPosts && 'yeni yayınlar', f.notifyChanges && 'değişimler', f.notifyReplies && 'yanıtlar'].filter(Boolean).join(', ') || 'kapalı'), 'small'));
    card.append(button('Bildirim tercihlerini düzenle', () => { openFollow(f.scope, f.targetId); $('follow-dialog').querySelector('h2').textContent = 'Bildirim tercihleri'; $('follow-form').querySelector('button[type=submit]').textContent = 'Bildirimleri kaydet'; for (const id of ['follow-scope', 'follow-target', 'follow-topic-target', 'follow-topic', 'follow-subtopic', 'follow-area']) $(id).disabled = true; $('follow-topic').value = f.topic || ''; $('follow-subtopic').value = f.subtopic || ''; $('follow-area').value = f.area || ''; $('follow-notify-posts').checked = f.notifyPosts; $('follow-notify-changes').checked = f.notifyChanges; $('follow-notify-replies').checked = f.notifyReplies; }), button('Takibi bırak', () => run(async () => { await api('unfollow', { id: f.id }); await refresh(); status('Takip kaldırıldı.'); })));
    host.append(card);
  }
}
function renderNotifications() {
  const host = $('notification-list'); host.replaceChildren();
  if (!state.snapshot.notifications.length) return empty(host, 'Henüz bildirim yok. Bildirimler yalnız seçtiğiniz takip tercihlerine göre oluşur.');
  const names = { post: 'Yeni yayın', change: 'Yeni sürüm', reply: 'Yeni yanıt' };
  for (const n of state.snapshot.notifications) {
    const p = post(n.postId), card = node('section', undefined, 'info-card' + (n.read ? '' : ' notification-unread'));
    card.append(node('p', (names[n.kind] || 'Gelişme') + ' · ' + date(n.createdAt) + (n.read ? '' : ' · okunmadı'), 'meta'), button(p ? version(p).title : 'Yayına git', () => run(async()=>{state.feed={feed:'post',targetId:n.postId,topic:null,subtopic:null,area:null,page:1};$('feed-kind').value='post';await refresh();state.selectedPost=n.postId;const reply=n.replyId&&state.snapshot.replies.find(r=>r.id===n.replyId);state.selectedVersion=reply?.version||post(n.postId)?.currentVersion;showSection('feed');renderReader();renderFeed();}))); host.append(card);
  }
}
function transferPreview(mode, bundle) {
  state.transfer = { mode, bundle }; const posts = Array.isArray(bundle.posts)?bundle.posts:[];
  $('transfer-title').textContent = mode === 'export' ? 'Kendi yayınlarınızı dışa aktarın' : 'Kendi yayın yedeğinizi inceleyin';
  $('transfer-summary').textContent = `${posts.length} yayın · ${posts.reduce((sum, p) => sum + (p.versions?.length || 0), 0)} sürüm`;
  $('transfer-posts').replaceChildren(...posts.slice(0, 100).map(p => node('li', p.versions?.at(-1)?.title || 'Başlıksız kayıt')));
  $('transfer-note').textContent = mode === 'export' ? 'Bu dosya profilinizi ve size ait imzalı yayın sürümlerini içerir. Anahtar dosyanız ayrıdır; yanıtlar ve takip tercihleri bu aktarımda yer almaz.' : 'Yalnız açık kimliğinize ait imzalı yayınlar kabul edilir. Mevcut aynı kimlikli yayınların üzerine yazılmaz. Profiliniz yedekteki imzalı profil bilgileriyle güncellenir.';
  $('transfer-confirm').textContent = mode === 'export' ? 'Yedek dosyasını indir' : 'Bu yedeği içe aktar';
  if(mode.startsWith('network-')){let data;try{data=JSON.parse(bundle.store.payload);}catch{throw Error('Tam ağ yedeği okunamadı.');}$('transfer-title').textContent=mode==='network-export'?'Tüm ağın yönetici yedeği':'Tüm ağı boş düğüme geri yükle';$('transfer-summary').textContent=`${Object.keys(data.people||{}).length} üye · ${Object.keys(data.posts||{}).length} yayın · ${Object.keys(data.replies||{}).length} yanıt · ${Object.keys(data.comparisons||{}).length} karşılaştırma`;$('transfer-posts').replaceChildren();$('transfer-note').textContent=mode==='network-export'?'Bu dosya tüm üyelerin yayınlarını, yanıtlarını, karşılaştırmalarını, takiplerini ve yönetim kayıtlarını içerir. Özel arşiviniz ve anahtar dosyalarınız dahil değildir. Yalnız güvendiğiniz yerde saklayın. Onayda güncel içerik özeti tekrar kontrol edilir.':'Yalnız yeni ve boş, tek yöneticili ağ alanında çalışır. Kaynak yöneticinin aynı etkin anahtarıyla kayıt olmanız gerekir. Bu işlem birleştirme değildir; tam yapı ve imzalar sunucuda doğrulanır.';$('transfer-confirm').textContent=mode==='network-export'?'Bu tam ağ yedeğini indir':'Doğrula ve boş ağa geri yükle';}
  dialog('transfer-dialog');
}
for (const b of document.querySelectorAll('[data-section]')) b.addEventListener('click', () => { if (!state.busy) showSection(b.dataset.section); });
for (const b of document.querySelectorAll('[data-close]')) b.addEventListener('click', () => { if (!state.busy) {if(b.dataset.close==='post-dialog')closePostDraft();else close(b.dataset.close);} });
$('identity-open').onclick = () => openIdentity('unlock'); $('identity-unlock').onclick = () => openIdentity('unlock'); $('identity-create').onclick = () => openIdentity('create');
$('identity-tab-create').onclick = () => identityTab('create'); $('identity-tab-unlock').onclick = () => identityTab('unlock'); $('identity-lock').onclick = lock;
$('identity-create-form').onsubmit = event => { event.preventDefault(); run(async () => {
  const passphrase = $('create-passphrase').value, confirmation = $('create-passphrase-confirm').value;
  if (passphrase !== confirmation) throw new Error('İki parola birbiriyle eşleşmiyor.');
  state.identity = await createIdentity(passphrase); state.snapshot = null; $('create-passphrase').value = ''; $('create-passphrase-confirm').value = ''; recoveryPhase(); status('Kimliğiniz hazır. Kaydolmadan önce şifreli anahtar dosyanızı indirin.');
}); };
$('download-key').onclick = () => run(async () => downloadKey()); $('key-redownload').onclick = () => run(async () => downloadKey()); $('key-saved-confirm').onchange = sync;
$('register-form').onsubmit = event => { event.preventDefault(); run(async () => {
  if (!state.downloaded || !$('key-saved-confirm').checked) throw new Error('Önce şifreli anahtar dosyanızı indirip sakladığınızı doğrulayın.');
  await api('register', { name: $('register-name').value, bio: $('register-bio').value, invite: $('register-invite').value.trim() });
  await refresh(); close('identity-dialog'); $('register-invite').value = '';try{sessionStorage.removeItem('tore-bootstrap-invite');}catch(_){} status('Kimliğinizle kaydoldunuz. Yayınlarınızı okumaya veya yazmaya başlayabilirsiniz.');
}); };
$('identity-unlock-form').onsubmit = event => { event.preventDefault(); run(async () => {
  const file = $('identity-file').files[0]; if (!file || file.size > 8192) throw new Error('Geçerli bir şifreli Töre anahtar dosyası seçin.');
  const passphrase = $('unlock-passphrase').value;
  try { state.identity = await unlockIdentity(await file.text(), passphrase); } finally { $('unlock-passphrase').value = ''; $('identity-file').value = ''; }
  state.downloaded = true;
  try { await refresh(); close('identity-dialog'); status('Kimliğiniz açıldı.'); }
  catch (e) { state.snapshot = null; recoveryPhase(true); status(e.message, true); }
}); };
$('profile-edit').onclick = () => { $('profile-name').value = state.snapshot.me.name; $('profile-bio').value = state.snapshot.me.bio; $('profile-key-id').textContent = 'Sabit üye kimliği: '+state.snapshot.me.id+'\nEtkin imza anahtarı: '+state.identity.id; dialog('profile-dialog'); };
$('profile-form').onsubmit = event => { event.preventDefault(); run(async () => { await api('profile', { name: $('profile-name').value, bio: $('profile-bio').value }); await refresh(); close('profile-dialog'); status('Profiliniz kaydedildi.'); }); };
$('refresh').onclick = () => run(async () => { await refresh(); status('Yayınlar ve bildirimler yenilendi.'); });
$('feed-previous').onclick=()=>run(async()=>{state.feed.page=Math.max(1,(state.feed.page||1)-1);await refresh();});$('feed-next').onclick=()=>run(async()=>{state.feed.page=(state.feed.page||1)+1;await refresh();});
$('feed-kind').onchange = renderFeedTargets; $('feed-search').oninput = () => { if (state.snapshot) renderFeed(); };
$('feed-form').onsubmit = event => { event.preventDefault(); run(async () => {
  const feed = $('feed-kind').value, topic = $('feed-topic').value.trim();
  if (feed === 'topic' && !topic) throw new Error('Görmek istediğiniz konuyu yazın.');
  state.feed = { feed, targetId: feed === 'topic' ? topic : ['author', 'post', 'discussion'].includes(feed) ? $('feed-target').value : null, topic: topic || null, subtopic: $('feed-subtopic').value.trim() || null, area: $('feed-area').value || null };
  await refresh(); status('Seçtiğiniz görünüm açıldı.');
}); };
$('reader-author').onclick = () => run(async () => { const { p } = selected(); state.feed = { feed: 'author', targetId: p.author, topic: null, subtopic: null, area: null }; $('feed-kind').value = 'author'; $('feed-topic').value = ''; $('feed-subtopic').value = ''; $('feed-area').value = ''; await refresh(); });
$('reader-version').onchange = () => { state.selectedVersion = Number($('reader-version').value); renderReader(); };
$('post-new').onclick = () => openPostEditor(); $('reader-revise').onclick = () => openPostEditor(true); $('reader-reply').onclick = openReply;
$('post-dialog').addEventListener('cancel',event=>{event.preventDefault();if(!state.busy)closePostDraft();});
$('post-form').addEventListener('input',event=>{if(event.target.id!=='post-publish-confirm'){$('post-publish-confirm').checked=false;savePostDraft();}});
window.addEventListener('beforeunload',event=>{savePostDraft();if(postDrafts.size){event.preventDefault();event.returnValue='';}});
$('post-draft-download').onclick=()=>{savePostDraft();download(JSON.stringify({format:'tore-share-draft',version:1,kind:'view',...postFields(),provenance:postProvenance||{representation:'self',profileName:state.snapshot.me.name,editor:'',revisionIds:[crypto.randomUUID()],sources:[],createdAt:new Date().toISOString()}},null,2)+'\n','Töre-yayımlanmamış-taslak.json');status('Taslak dosyası indirmesi başlatıldı; bu işlem yayımlamaz.');};
$('post-packet').onchange=()=>run(async()=>{const file=$('post-packet').files[0];$('post-packet').value='';if(!file)return;if(file.size>1000000)throw Error('Paylaşma taslağı en fazla 1 MB olmalı.');let packet;try{packet=validateSharePacket(JSON.parse(await file.text()));}catch(e){throw Error(e.message||'Paylaşma taslağı okunamadı.');}if(draftChanged()&&!confirm('Seçtiğiniz paylaşma taslağı mevcut alanların yerini alacak. Devam edilsin mi?'))return;for(const [field,id]of Object.entries({title:'post-title',text:'post-text',topic:'post-topic',area:'post-area',viewType:'post-type'}))$(id).value=packet[field];$('post-subtopic').value='';postProvenance=packet.provenance;renderPostProvenance();$('post-publish-confirm').checked=false;savePostDraft();status('Paylaşma taslağı önizleme için alındı. Metni düzenleyebilir, kaynak/temsil bilgisini inceleyip ayrıca yayımlayabilirsiniz.');});
$('post-md').onchange = () => run(async () => {
  const file = $('post-md').files[0]; $('post-md').value = '';
  if (!file) return; if (!/\.md$/i.test(file.name) || file.size > 400000) throw new Error('En fazla 400 KB büyüklüğünde bir .md dosyası seçin.');
  let text; try { text = new TextDecoder('utf-8', { fatal: true }).decode(await file.arrayBuffer()); } catch { throw new Error('Dosya UTF-8 Markdown olarak okunamadı.'); }
  if (text.includes('\0')) throw new Error('Dosyada desteklenmeyen karakterler var.');
  if(draftChanged()&&!confirm('Seçtiğiniz MD mevcut taslak metninin yerini alacak. Devam edilsin mi?'))return;
  postProvenance=null;renderPostProvenance();$('post-text').value = text; if (!$('post-title').value) $('post-title').value = file.name.replace(/\.md$/i, '');
  $('post-publish-confirm').checked = false; status('Dosya taslağa alındı. Metni inceleyip yayımlamayı ayrıca onaylayın.');
});
$('post-form').onsubmit = event => { event.preventDefault(); run(async () => {
  if (!$('post-publish-confirm').checked) throw new Error('Yayımlanacak metni onaylayın.');
  const id = $('post-edit-id').value, fields = postFields();if(postProvenance)fields.provenance=postProvenance;
  const response = id ? await api('revise_post', { postId: id, expectedVersion: Number($('post-edit-id').dataset.expectedVersion), reason: $('post-reason').value, ...fields }) : await api('create_post', fields);
  postDrafts.delete(activeDraftKey);activeDraftKey=null;postProvenance=null;close('post-dialog'); state.selectedPost = id || response.id; state.selectedVersion = null; state.feed = { feed: 'all', targetId: null, topic: null, subtopic: null, area: null }; $('feed-kind').value = 'all'; $('feed-topic').value = ''; $('feed-subtopic').value = ''; $('feed-area').value = ''; showSection('feed'); await refresh(); status(id ? 'Yeni sürüm gerekçesiyle yayımlandı. Önceki sürümler korunuyor.' : 'Yayın eklendi.');
}); };
$('reply-form').onsubmit = event => { event.preventDefault(); run(async () => {
  const form = $('reply-form'), target = { postId: form.dataset.postId, version: Number(form.dataset.version) }, quote = $('reply-quote').value;
  const v = version(post(target.postId), target.version); if (!v.text.includes(quote) || !quote.trim()) throw new Error('Alıntı, seçilen sürümün özgün metninde birebir bulunmalı.');
  await api('reply', { ...target, quote, text: $('reply-text').value }); close('reply-dialog'); await refresh(); status('Yanıtınız seçtiğiniz sürüme ve alıntıya bağlandı.');
}); };
$('comparison-new').onclick = () => run(async () => openComparison()); for (const side of ['left', 'right']) $('comparison-' + side).onchange = updateComparisonPreviews;
$('comparison-form').onsubmit = event => { event.preventDefault(); run(async () => {
  const left = parseReference($('comparison-left').value), right = parseReference($('comparison-right').value), a = assessment();
  if (left.postId === right.postId && left.version === right.version) throw new Error('İki farklı kaynak metin/sürüm seçin.');
  if (!referenceVersion($('comparison-left').value).text.includes(a.leftEvidence[0]) || !referenceVersion($('comparison-right').value).text.includes(a.rightEvidence[0])) throw new Error('Kanıt alıntıları ilgili kaynak metinde birebir bulunmalı.');
  const id = $('comparison-edit-id').value; await api(id ? 'edit_comparison' : 'compare', id ? { comparisonId: id, assessment: a } : { left, right, assessment: a }); close('comparison-dialog'); await refresh(); showSection('comparisons'); status('Yazdığınız karşılaştırma kaynak sürümleriyle kaydedildi.');
}); };
$('reader-follow-post').onclick = () => openFollow('post', selected().p.id); $('reader-follow-discussion').onclick = () => openFollow('discussion', selected().p.id); $('reader-follow-author').onclick = () => openFollow('author', selected().p.author); $('follow-new').onclick = () => openFollow(); $('follow-scope').onchange = () => updateFollowTargets();
$('follow-form').onsubmit = event => { event.preventDefault(); run(async () => {
  const scope = $('follow-scope').value, topic = $('follow-topic').value.trim() || null, subtopic = $('follow-subtopic').value.trim() || null;
  if (subtopic && !topic) throw new Error('Alt konu seçerken ana konuyu da yazın.');
  const targetId = scope === 'topic' ? $('follow-topic-target').value.trim() : $('follow-target').value; if (!targetId) throw new Error('Bir takip hedefi seçin.');
  await api('follow', { scope, targetId, topic, subtopic, area: $('follow-area').value || null, notifyPosts: $('follow-notify-posts').checked, notifyChanges: $('follow-notify-changes').checked, notifyReplies: $('follow-notify-replies').checked }); close('follow-dialog'); await refresh(); showSection('follows'); status('Takip ve bildirim tercihleriniz kaydedildi.');
}); };
$('notifications-read').onclick = () => run(async () => { await api('notifications_read', {}); await refresh(); status('Bildirimler okundu olarak işaretlendi.'); });
$('invite-new').onclick = () => { $('invite-form').reset(); $('invite-result').hidden = true; dialog('invite-dialog'); };
$('invite-form').onsubmit = event => { event.preventDefault(); run(async () => { const result = await api('create_invite', { label: $('invite-label').value }); $('invite-code').textContent = result.code; $('invite-result').hidden = false; status('Yeni davet oluşturuldu.'); }); };
$('network-export').onclick=()=>run(async()=>transferPreview('network-export',await api('prepare_network_export',{})));
$('network-import').onchange=()=>run(async()=>{const file=$('network-import').files[0];$('network-import').value='';if(!file)return;if(file.size>24000000)throw Error('Aktarım dosyası en fazla 24 MB olabilir.');let bundle;try{bundle=JSON.parse(await file.text());}catch{throw Error('Geçerli bir JSON yedek dosyası seçin.');}if(bundle.format!=='tore-node-export'||bundle.version!==1||typeof bundle.store?.payload!=='string'||!bundle.exportEnvelope)throw Error('İmzalı tam ağ yedeği seçin.');transferPreview('network-import',bundle);});
$('data-export').onclick = () => run(async () => transferPreview('export', await api('export', {})));
$('data-import').onchange = () => run(async () => {
  const file = $('data-import').files[0]; $('data-import').value = ''; if (!file) return; if (file.size > 24000000) throw new Error('Bu prototipte aktarım dosyası en fazla 24 MB olabilir.');
  let bundle; try { bundle = JSON.parse(await file.text()); } catch { throw new Error('Seçilen dosya geçerli JSON değil.'); }
  if (bundle.format !== 'tore-network-export' || ![1,2].includes(bundle.version) || bundle.author !== currentMember() || !Array.isArray(bundle.posts)) throw new Error('Bu dosya, açık kimliğinize ait bir Töre yayın yedeği değil.');
  transferPreview('import', bundle);
});
$('transfer-confirm').onclick = () => run(async () => {
  const { mode, bundle } = state.transfer;
  if(mode==='network-export'){const signed=await api('export_network',{sha256:bundle.sha256});download(JSON.stringify(signed,null,2)+'\n',`Töre-tam-ağ-${new Date().toISOString().slice(0,10)}.json`);status('İmzalı tam ağ yedeği indirmesi başlatıldı. Özel arşiv ve anahtar dosyaları ayrı saklanır.');}
  else if(mode==='network-import'){await api('import_network',{bundle});await refresh();status('Tam ağ yedeği doğrulanarak boş düğüme geri yüklendi.');}
  else if (mode === 'export') { download(JSON.stringify(bundle, null, 2) + '\n', `Töre-yayınlar-${new Date().toISOString().slice(0, 10)}.json`); status('Yayın yedeği indirmesi başlatıldı. İndirilen dosyayı kontrol edin.'); }
  else { await api('import', { bundle }); await refresh(); status('İmzalı yayın yedeğiniz doğrulanarak alındı.'); }
  close('transfer-dialog'); state.transfer = null;
});
function lifecycleUpdate(){
  const action=$('lifecycle-action').value,keyAction=['rotate_key','set_recovery_key','recover_key'].includes(action),recover=action==='recover_key';
  lifecycleCandidate=null;$('lifecycle-key-ready').hidden=true;$('lifecycle-saved').checked=false;$('lifecycle-saved').disabled=true;$('lifecycle-confirm').checked=false;
  $('lifecycle-key-fields').hidden=!keyAction;$('lifecycle-recovery-input').hidden=!recover;$('lifecycle-member-fields').hidden=keyAction;$('lifecycle-suspend-label').hidden=action!=='suspend_member';
  for(const id of ['lifecycle-passphrase','lifecycle-passphrase-confirm','recovery-passphrase','recovery-file'])$(id).value='';
  const descriptions={rotate_key:'Sabit profiliniz ve yayın geçmişiniz korunur. Başarılı değişiklikten sonra eski imza anahtarı kullanılamaz; yeni dosyanızla açarsınız.',set_recovery_key:'Etkin imza anahtarınızdan ayrı bir kurtarma anahtarı oluşturun. Dosyayı ayrı bir güvenli yerde tutun. Bu anahtar yalnız hesabı geri almak içindir; yayın okuyamaz veya yazamaz. Yeni kayıt önceki kurtarma anahtarını değiştirir.',recover_key:'Önceden kaydettiğiniz ayrı kurtarma anahtarıyla yeni bir imza anahtarı tanımlayın. Başarılı işlem eski imza anahtarını kapatır. Önceden kurtarma anahtarı kaydetmediyseniz dosya/parola kaybı bu yolla çözülemez.',transfer_admin:'Yönetim seçtiğiniz üyeye geçer; sizin yönetici yetkiniz sona erer. Yeni yöneticinin kimliğini dikkatle kontrol edin.',suspend_member:'Üyenin bu ağ alanına erişimi kapatılır veya yeniden açılır. Geçmiş yayınlar sessizce silinmez.'};$('lifecycle-description').textContent=descriptions[action];
  $('lifecycle-target').replaceChildren(...(state.snapshot?.people||[]).filter(p=>p.id!==currentMember()).map(p=>new Option(p.name+' · '+p.id.slice(0,12)+'…',p.id)));
}
function openLifecycle(action){for(const option of $('lifecycle-action').options)option.disabled=option.value!=='recover_key'&&(!state.snapshot||(['transfer_admin','suspend_member'].includes(option.value)&&!state.snapshot.me.admin));$('lifecycle-action').value=action;lifecycleUpdate();dialog('lifecycle-dialog');}
$('key-manage').onclick=()=>openLifecycle('rotate_key');$('identity-recover').onclick=()=>openLifecycle('recover_key');$('lifecycle-action').onchange=lifecycleUpdate;
$('lifecycle-prepare').onclick=()=>run(async()=>{const pass=$('lifecycle-passphrase').value;if(pass!==$('lifecycle-passphrase-confirm').value)throw Error('Yeni dosya parolaları eşleşmiyor.');lifecycleCandidate=await createIdentity(pass);$('lifecycle-passphrase').value='';$('lifecycle-passphrase-confirm').value='';$('lifecycle-key-ready').hidden=false;$('lifecycle-saved').checked=false;$('lifecycle-saved').disabled=true;status('Yeni dosya hazır. Sunucuda henüz hiçbir anahtar değişmedi; önce dosyayı indirip saklayın.');});
$('lifecycle-download').onclick=()=>{if(!lifecycleCandidate)return;const recovery=$('lifecycle-action').value==='set_recovery_key';download(recoveryText(lifecycleCandidate),(recovery?'Töre-kurtarma-':'Töre-yeni-anahtar-')+lifecycleCandidate.id.slice(0,12)+'.json');$('lifecycle-saved').disabled=false;status('Şifreli dosya indirmesi başlatıldı. İndirmeler bölümünden kontrol edip sakladığınızı doğrulayın.');};
$('lifecycle-submit').onclick=()=>run(async()=>{
 const action=$('lifecycle-action').value,eventId=crypto.randomUUID();if(!$('lifecycle-confirm').checked)throw Error('İşlemi uygulamak için sonuçlarını onaylayın.');
 if(['rotate_key','set_recovery_key','recover_key'].includes(action)){
  if(!lifecycleCandidate||$('lifecycle-saved').disabled||!$('lifecycle-saved').checked)throw Error('Önce yeni şifreli dosyayı indirip sakladığınızı doğrulayın.');
  const candidate=lifecycleCandidate;
  if(action==='set_recovery_key'){
   const recoverySignature=await signPayload(candidate,`tore:recovery-register:v1\n${state.snapshot.me.id}\n${eventId}`);await api(action,{recoveryPublicKey:candidate.id,recoverySignature},{eventId});status('Ayrı kurtarma anahtarı kaydedildi. Etkin imza anahtarınız değişmedi.');
  }else{
   let targetId=state.snapshot?.me.id,signer=state.identity;
   if(action==='recover_key'){targetId=$('recovery-target').value.trim();if(!targetId)throw Error('Hesabın sabit kimliğini girin.');const file=$('recovery-file').files[0];if(!file||file.size>8192)throw Error('Ayrı kurtarma anahtar dosyasını seçin.');try{signer=await unlockIdentity(await file.text(),$('recovery-passphrase').value);}finally{$('recovery-passphrase').value='';}}
   const proof=action==='rotate_key'?'tore:key-rotate:v1':'tore:key-recover:v1',newKeySignature=await signPayload(candidate,`${proof}\n${targetId}\n${candidate.id}\n${eventId}`);
   await api(action,{...(action==='recover_key'?{targetId}:{}),newPublicKey:candidate.id,newKeySignature},{eventId,identity:signer});
   savePostDraft();state.identity=candidate;state.downloaded=true;await refresh();status('Yeni imza anahtarı etkin. Sabit profil ve yayınlarınız korunuyor; eski imza anahtarı kapandı.');
  }
 }else{if(!state.snapshot?.me.admin)throw Error('Bu işlem yönetici yetkisi gerektirir.');const targetId=$('lifecycle-target').value;if(!targetId)throw Error('Bir üye seçin.');await api(action,action==='transfer_admin'?{targetId}:{targetId,suspended:$('lifecycle-suspended').checked});await refresh();status(action==='transfer_admin'?'Yönetim seçtiğiniz üyeye devredildi.':'Üyenin erişim durumu kaydedildi.');}
 lifecycleCandidate=null;for(const id of ['lifecycle-passphrase','lifecycle-passphrase-confirm','recovery-passphrase','recovery-file'])$(id).value='';close('lifecycle-dialog');
});
(async () => {
  sync();
  try { const response = await fetch('/api/info', { credentials: 'omit', cache: 'no-store' }); if (!response.ok) throw new Error(); const info = await response.json(); $('server-info').textContent = `${info.name} ${info.version} · ${info.memberCount} üye`; status('Töre hazır. Anahtar dosyanızla kimliğinizi açın veya yeni kimlik oluşturun.'); }
  catch { status('Töre sunucusuna ulaşılamadı. Yerel uygulamanın açık olduğunu kontrol edin.', true); }
})();
