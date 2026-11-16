'use strict';
// Hazır Töre.html public DOM formları; gerçek geçici disk + FSA adaptörü.
// jsdom, Chrome seçicisi veya görsel tarayıcı testi değildir.
const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const path = require('node:path');
const os = require('node:os');
const crypto = require('node:crypto');
const { File } = require('node:buffer');
const { JSDOM, ResourceLoader, VirtualConsole } = require('jsdom');
const { DiskDir } = require('./profile-fs-adapter.cjs');
const root = path.join(__dirname, '..');
const hash = value => crypto.createHash('sha256').update(value).digest('hex');
async function waitFor(fn, message) {
  const until = Date.now() + 6000;
  while (Date.now() < until) { if (await fn()) return; await new Promise(resolve => setTimeout(resolve, 10)); }
  throw new Error(message);
}
async function createLegacyFixture() {
  const dirPath = await fs.mkdtemp(path.join(os.tmpdir(), 'tore-profile-ui-'));
  const bytes = Buffer.from('\ufeff# SENTETİK TEST — Özgün Eski Rapor\r\n\r\nIŞIK ve İZMİR.\r\n');
  const id = crypto.randomUUID();
  const report = { id, originalName: 'SENTETİK Eski Rapor.MD', title: 'SENTETİK Eski Rapor', addedAt: '2026-11-13T10:00:00.000Z', path: `raporlar/${id}.md`, sha256: hash(bytes), trashed: false };
  const manifest = { schemaVersion: 1, appVersion: '0.1.1', revision: 1, reports: [report] };
  await fs.mkdir(path.join(dirPath, 'raporlar'));
  await fs.writeFile(path.join(dirPath, report.path), bytes);
  const rawManifest = Buffer.from(JSON.stringify(manifest, null, 2) + '\n');
  await fs.writeFile(path.join(dirPath, 'arsiv.json'), rawManifest);
  return { dirPath, bytes, report, manifest, rawManifest, dir: new DiskDir(dirPath) };
}
async function launch(fixture) {
  const requests = [], errors = [];
  class BlockNetwork extends ResourceLoader { fetch(url) { requests.push(url); return null; } }
  const console = new VirtualConsole();
  console.on('jsdomError', error => errors.push(error.message));
  const html = await fs.readFile(path.join(root, 'Töre.html'), 'utf8');
  const dom = new JSDOM(html, {
    url: 'file:///Töre.html', runScripts: 'dangerously', resources: new BlockNetwork(), virtualConsole: console,
    beforeParse(w) {
      Object.defineProperty(w, 'isSecureContext', { value: true });
      Object.defineProperty(w, 'crypto', { value: crypto.webcrypto });
      w.TextEncoder = TextEncoder; w.TextDecoder = TextDecoder; w.File = File;
      w.showDirectoryPicker = async () => fixture.dir;
      w.confirm = () => true;
      w.HTMLElement.prototype.scrollIntoView = function () {};
      w.HTMLDialogElement.prototype.showModal = function () { this.setAttribute('open', ''); };
      w.HTMLDialogElement.prototype.close = function () { this.removeAttribute('open'); this.dispatchEvent(new w.Event('close')); };
      w.URL.createObjectURL = () => 'blob:sentetik-test'; w.URL.revokeObjectURL = () => {};
    }
  });
  const w = dom.window, $ = id => w.document.getElementById(id);
  const click = id => { assert.ok($(id), `Kontrol yok: ${id}`); assert.equal($(id).disabled, false, `Kontrol devre dışı: ${id}`); $(id).click(); };
  const fill = (id, value) => { assert.ok($(id), `Alan yok: ${id}`); $(id).value = value; $(id).dispatchEvent(new w.Event('input', { bubbles: true })); $(id).dispatchEvent(new w.Event('change', { bubbles: true })); };
  const submit = async (formId, buttonId, dialogId) => { const form = $(formId); assert.ok(form.checkValidity(), `Form geçersiz: ${formId}`); form.requestSubmit($(buttonId)); await waitFor(() => !$(dialogId).open, `Form kapanmadı: ${formId}; ${$('status')?.textContent}`); await waitFor(() => !$(buttonId).disabled, 'Kaydetme işlemi bitmedi.'); };
  return { dom, w, $, click, fill, submit, requests, errors };
}
async function readProfiles(fixture) { return JSON.parse(await fs.readFile(path.join(fixture.dirPath, 'profiller.json'), 'utf8')); }

test('hazır Töre HTML: eski rapor → kendi profilim → üç alan/geçmiş → kaynaklı düşünür', async t => {
  const fixture = await createLegacyFixture();
  const ui = await launch(fixture), { dom, w, $, click, fill, submit } = ui;
  t.after(async () => { dom.window.close(); await fs.rm(fixture.dirPath, { recursive: true, force: true }); });
  let self, view, thinker;
  await t.test('gerçek eski manifest DOM üzerinden açılır, profil için rapor tekrar yüklenmez', async () => {
    // Gezinme klasörsüz de boş durumu gösterebilir; yazma denetimleri kapalı kalır.
    click('nav-self');
    assert.equal($('profile-create-self').disabled, true);
    click('choose');
    await waitFor(() => !$('choose').disabled && $('list').textContent.includes(fixture.report.title), 'Eski arşiv açılmadı.');
    assert.match(w.document.title, /Töre/);
    assert.equal(w.document.querySelector('.version').textContent, '0.12.0');
    assert.deepEqual(await fs.readFile(path.join(fixture.dirPath, 'arsiv.json')), fixture.rawManifest);
    assert.deepEqual(await fs.readFile(path.join(fixture.dirPath, fixture.report.path)), fixture.bytes);
  });
  await t.test('public profil formu; yalnız geçmiş görüşü boş diğer alanlarla saklanabilir', async () => {
    click('nav-self'); click('profile-create-self');
    assert.ok($('profile-dialog').open);
    fill('profile-name', 'Önder — SENTETİK TEST'); fill('profile-bio', 'Yalnızca test verisi.');
    await submit('profile-form', 'profile-save', 'profile-dialog');
    self = (await readProfiles(fixture)).profiles.find(p => p.kind === 'self');
    assert.ok(self); assert.equal(self.sources.length, 0); assert.equal(self.views.length, 0);
    click('view-add'); fill('view-topic', 'Eğitim'); fill('view-area', 'past'); fill('view-kind', 'position'); fill('view-text', 'A — ilk sentetik görüş.');
    const reportBox = $('view-reports').querySelector(`input[value="${fixture.report.id}"]`); assert.ok(reportBox); reportBox.checked = true;
    await submit('view-form', 'view-save', 'view-dialog');
    self = (await readProfiles(fixture)).profiles.find(p => p.id === self.id); view = self.views[0];
    assert.equal(self.views.length, 1); assert.equal(view.area, 'past'); assert.deepEqual(view.reportIds, [fixture.report.id]);
    assert.ok($('profile-columns').querySelector('[data-area="past"]'));
    assert.ok($('profile-columns').querySelector('[data-area="present"]'));
    assert.ok($('profile-columns').querySelector('[data-area="future"]'));
  });
  await t.test('görüş değişimi ve metin düzeltmesi ayrı; geçmiş eski A ve gerekçeyi gösterir', async () => {
    for (const [changeType, text, reason] of [['opinion', 'B — güncel sentetik görüş.', 'Gerekçeyi yeniden değerlendirdim.'], ['correction', 'B — güncel sentetik görüş; yazım düzeltildi.', 'Yalnızca yazım düzeltmesi.']]) {
      w.document.querySelector(`[data-edit-view="${view.id}"]`).click();
      fill('view-text', text); fill('view-change-type', changeType); fill('view-reason', reason);
      await submit('view-form', 'view-save', 'view-dialog');
    }
    self = (await readProfiles(fixture)).profiles.find(p => p.id === self.id); view = self.views[0];
    assert.deepEqual(view.revisions.map(r => r.changeType), ['initial', 'opinion', 'correction']);
    assert.match(view.revisions[0].text, /^A/); assert.match(view.text, /^B/);
    w.document.querySelector(`[data-history-view="${view.id}"]`).click();
    assert.ok($('history-dialog').open); assert.match($('history-content').textContent, /A — ilk sentetik görüş/); assert.match($('history-content').textContent, /Gerekçeyi yeniden değerlendirdim/); assert.match($('history-content').textContent, /Yalnızca yazım düzeltmesi/);
    click('history-close');
  });
  await t.test('şimdi/geçiş sorusu ve gelecek öngörüsü kesin görüşe dönüştürülmez', async () => {
    for (const [area, kind, text, bridge] of [['present', 'question', 'Bu geçiş nasıl kurulabilir?', 'Geçmiş ile hedef arasındaki açık bağ.'], ['future', 'prediction', 'Gelecekte B olabilir.', '']]) {
      click('view-add'); fill('view-topic', 'Eğitim'); fill('view-area', area); fill('view-kind', kind); fill('view-text', text); fill('view-bridge', bridge);
      await submit('view-form', 'view-save', 'view-dialog');
    }
    self = (await readProfiles(fixture)).profiles.find(p => p.id === self.id);
    assert.ok(self.views.some(v => v.area === 'present' && v.kind === 'question' && v.bridge));
    assert.ok(self.views.some(v => v.area === 'future' && v.kind === 'prediction'));
    assert.match($('profile-columns').textContent, /Bu geçiş nasıl kurulabilir/); assert.match($('profile-columns').textContent, /Gelecekte B olabilir/);
  });
  await t.test('kaynaklı düşünür ve rapora dayanan görüş public formlardan oluşturulur', async () => {
    click('nav-thinkers'); click('profile-create-thinker');
    fill('profile-name', 'SENTETİK Düşünür <img src=x onerror=alert(1)>'); fill('profile-bio', 'Gerçek kişi değildir.'); fill('profile-editor', 'SENTETİK Editör');
    if (!$('profile-source-rows').querySelector('.source-row')) click('source-add');
    const row = $('profile-source-rows').querySelector('.source-row');
    row.querySelector('[data-field="label"]').value = 'Kaynak <img src=x onerror=alert(1)>';
    row.querySelector('[data-field="url"]').value = 'https://example.invalid/source';
    row.querySelector('[data-field="reportId"]').value = fixture.report.id;
    await submit('profile-form', 'profile-save', 'profile-dialog');
    thinker = (await readProfiles(fixture)).profiles.find(p => p.kind === 'thinker');
    assert.ok(thinker); assert.equal(thinker.editor, 'SENTETİK Editör'); assert.equal(thinker.sources[0].reportId, fixture.report.id);
    click('view-add'); fill('view-topic', 'Bilgi'); fill('view-area', 'past'); fill('view-kind', 'position'); fill('view-text', 'Kaynaklı sentetik düşünür görüşü.');
    const sourceBox = $('view-sources').querySelector(`input[value="${thinker.sources[0].id}"]`); assert.ok(sourceBox); sourceBox.checked = true;
    await submit('view-form', 'view-save', 'view-dialog');
    thinker = (await readProfiles(fixture)).profiles.find(p => p.id === thinker.id);
    assert.equal(thinker.views.length, 1); assert.deepEqual(thinker.views[0].sourceIds, [thinker.sources[0].id]);
    assert.match($('profile-current').textContent, /SENTETİK Düşünür <img/);
    assert.equal($('profiles-pane').querySelector('img,script,iframe'), null);
    for (const a of $('profiles-pane').querySelectorAll('a[href^="http"]')) { assert.equal(a.target, '_blank'); assert.match(a.rel, /noopener/); assert.match(a.rel, /noreferrer/); }
  });
  await t.test('yanlış protokol formla reddedilir, var olan profil dosyası değişmez', async () => {
    const before = await fs.readFile(path.join(fixture.dirPath, 'profiller.json'));
    click('profile-create-thinker'); fill('profile-name', 'Kaydedilmemeli'); fill('profile-editor', 'Test');
    if (!$('profile-source-rows').querySelector('.source-row')) click('source-add');
    const row = $('profile-source-rows').querySelector('.source-row');
    row.querySelector('[data-field="label"]').value = 'Tehlikeli kaynak'; row.querySelector('[data-field="url"]').value = 'javascript:alert(1)';
    // Native URL validity veya storage doğrulaması reddedebilir; iki durumda da dosya değişmemeli.
    const form = $('profile-form');
    if (form.checkValidity()) { form.requestSubmit($('profile-save')); await waitFor(() => /HTTP|bağlantı|Kaynak|geçerli/i.test($('status').textContent) && !$('profile-save').disabled, 'Geçersiz kaynak hata olarak görünmedi.'); }
    assert.ok($('profile-dialog').open);
    assert.deepEqual(await fs.readFile(path.join(fixture.dirPath, 'profiller.json')), before);
    click('profile-dialog-close');
  });
  await t.test('özel karşılaştırma hazır HTML formundan diske yazılır ve gerekçeli düzenlenir',async()=>{
    click('nav-comparisons');assert.equal($('comparisons-pane').hidden,false);
    fill('cmp-left',[self.id,view.id,view.revisions[0].id].join('/'));
    fill('cmp-right',[thinker.id,thinker.views[0].id,thinker.views[0].revisions[0].id].join('/'));
    fill('cmp-question','Sentetik ortak soru ne?');fill('cmp-category','unclear');fill('cmp-shared','');fill('cmp-difference','Kullanıcı henüz karar vermedi.');fill('cmp-left-evidence','A — ilk sentetik görüş.');fill('cmp-right-evidence','Kaynaklı sentetik düşünür görüşü.');fill('cmp-open','Gerekçeler yeterli mi?');
    $('comparison-form').requestSubmit($('cmp-save'));
    await waitFor(()=>!$('cmp-save').disabled&&$('comparison-list').textContent.includes('Sentetik ortak soru ne?'),'Karşılaştırma formu diske ulaşmadı: '+$('status').textContent);
    const name=path.join(fixture.dirPath,'karsilastirmalar.json');let doc=JSON.parse(await fs.readFile(name,'utf8'));
    assert.equal(doc.comparisons.length,1);assert.match(doc.comparisons[0].left.text,/^A/);assert.equal(doc.comparisons[0].assessment.sharedGround,'');
    assert.equal($('comparisons-pane').querySelector('img,script,iframe'),null);
    $('comparison-list').querySelector('.view-card > button').click();assert.equal($('cmp-left').disabled,true);
    fill('cmp-category','scope');fill('cmp-reason','Kapsam farkı olarak yeniden sınıflandırdım.');$('comparison-form').requestSubmit($('cmp-save'));
    await waitFor(async()=>JSON.parse(await fs.readFile(name,'utf8')).comparisons[0].revisions.length===2&&!$('cmp-save').disabled,'Düzenleme geçmişi diske yazılmadı.');
    doc=JSON.parse(await fs.readFile(name,'utf8'));assert.equal(doc.comparisons[0].revisions[0].assessment.category,'unclear');assert.equal(doc.comparisons[0].assessment.category,'scope');
    const archive=await w.ToruStore.Archive.open(fixture.dir);assert.equal((await archive.backup()).version,3);
  });
  await t.test('profil sonrası rapor okuyucu ve özgün dosya/manifest aynı; otomatik ağ yok', async () => {
    click('nav-reports'); w.document.querySelector('#list button.report').click();
    await waitFor(() => $('article').textContent.includes('IŞIK ve İZMİR'), 'Özgün rapor okuyucuya dönmedi.');
    assert.deepEqual(await fs.readFile(path.join(fixture.dirPath, fixture.report.path)), fixture.bytes);
    assert.deepEqual(await fs.readFile(path.join(fixture.dirPath, 'arsiv.json')), fixture.rawManifest);
    assert.deepEqual(ui.requests, []);
    assert.deepEqual(ui.errors, []);
  });
});

test('hazır Töre HTML: bozuk profiller rapor okumayı engellemez; açık kurtarma sağlam önceki kaydı getirir', async t => {
  const fixture = await createLegacyFixture();
  const corrupt = Buffer.from('{ SENTETİK TEST: bilerek bozulmuş profil JSON kaydı');
  const previous = Buffer.from(JSON.stringify({ schemaVersion: 1, revision: 0, profiles: [] }, null, 2) + '\n');
  await fs.writeFile(path.join(fixture.dirPath, 'profiller.json'), corrupt);
  await fs.writeFile(path.join(fixture.dirPath, 'profiller.onceki.json'), previous);
  const ui = await launch(fixture), { dom, w, $, click } = ui;
  t.after(async () => { dom.window.close(); await fs.rm(fixture.dirPath, { recursive: true, force: true }); });
  click('choose');
  await waitFor(() => !$('choose').disabled && !$('recover-profiles').hidden && $('list').textContent.includes(fixture.report.title), 'Bozuk profilde arşiv veya kurtarma durumu görünmedi.');
  assert.match($('status').textContent, /Profiller açılmadı/);
  assert.deepEqual(await fs.readFile(path.join(fixture.dirPath, 'profiller.json')), corrupt, 'Açılış bozuk profili sessizce değiştirdi.');
  w.document.querySelector('#list button.report').click();
  await waitFor(() => !$('choose').disabled && $('article').textContent.includes('IŞIK ve İZMİR'), 'Profil hatası rapor okumayı engelledi.');
  click('nav-self');
  assert.equal($('profile-create-self').disabled, true, 'Profil hatasında yazma açıldı.');
  assert.match($('profile-empty').textContent, /profil|klasör|hata/i);
  click('recover-profiles');
  await waitFor(() => !$('choose').disabled && $('recover-profiles').hidden && !$('profile-create-self').disabled, 'Açık kurtarma profil işlemlerini geri açmadı.');
  assert.match($('status').textContent, /Önceki sağlam profil kaydı/);
  assert.deepEqual(await fs.readFile(path.join(fixture.dirPath, 'profiller.json')), previous);
  assert.deepEqual(await fs.readFile(path.join(fixture.dirPath, 'profiller.onceki.json')), previous);
  const preserved = (await fs.readdir(fixture.dirPath)).filter(name => /^profiller\.bozuk-[0-9a-f-]+\.json$/.test(name));
  assert.equal(preserved.length, 1, 'Bozuk dosyanın ayrı korunmuş kopyası yok.');
  assert.deepEqual(await fs.readFile(path.join(fixture.dirPath, preserved[0])), corrupt);
  assert.deepEqual(await fs.readFile(path.join(fixture.dirPath, fixture.report.path)), fixture.bytes);
  assert.deepEqual(await fs.readFile(path.join(fixture.dirPath, 'arsiv.json')), fixture.rawManifest);
  click('profile-create-self');
  assert.ok($('profile-dialog').open, 'Kurtarmadan sonra kendi profilini oluşturma formu açılmadı.');
  click('profile-dialog-close');
  assert.deepEqual(ui.requests, []);
  assert.deepEqual(ui.errors, []);
});
