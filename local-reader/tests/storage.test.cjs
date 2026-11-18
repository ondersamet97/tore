'use strict';
// Gerçek geçici disk dosyaları kullanır; FSA adaptörüdür, tarayıcı seçicisi testi değildir.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const path = require('node:path');
const os = require('node:os');
const { File } = require('node:buffer');
require('../src/profiles.js');
require('../src/storage.js');
const { Archive, sha256, decodeUTF8, fold, validateBackup } = globalThis.ToruStore;
const encode = text => new TextEncoder().encode(text);
const rootDirs = [];

function namedError(name, message) { const error = new Error(message); error.name = name; return error; }
class DiskFile {
  constructor(p, state) { this.p = p; this.state = state; this.name = path.basename(p); this.kind = 'file'; }
  async getFile() {
    try { return new File([await fs.readFile(this.p)], this.name); }
    catch (error) { if (error.code === 'ENOENT') throw namedError('NotFoundError', 'Dosya bulunamadı'); throw error; }
  }
  async createWritable() {
    if (this.state.deny) throw namedError('NotAllowedError', 'Yazma izni reddedildi');
    const self = this;
    let bytes;
    return {
      async write(value) {
        if (self.state.failName === self.name) throw namedError('QuotaExceededError', 'Sentetik disk yazma hatası');
        bytes = Buffer.from(value);
      },
      async close() { const staged = self.p + '.test-writing'; await fs.writeFile(staged, bytes); await fs.rename(staged, self.p); },
      async abort() {}
    };
  }
}
class DiskDir {
  constructor(p, state = {}) { this.p = p; this.state = state; this.name = path.basename(p); this.kind = 'directory'; }
  async getFileHandle(name, options = {}) {
    assert.ok(name && !/[\/\\]/.test(name), 'Adaptöre güvenli tek bileşen iletilmeli');
    const p = path.join(this.p, name);
    try { if (!(await fs.stat(p)).isFile()) throw namedError('TypeMismatchError', 'Dosya değil'); }
    catch (error) { if (error.code !== 'ENOENT') throw error; if (!options.create) throw namedError('NotFoundError', 'Dosya bulunamadı'); await fs.writeFile(p, '', { flag: 'wx' }); }
    return new DiskFile(p, this.state);
  }
  async getDirectoryHandle(name, options = {}) {
    assert.ok(name && !/[\/\\]/.test(name));
    const p = path.join(this.p, name);
    try { if (!(await fs.stat(p)).isDirectory()) throw namedError('TypeMismatchError', 'Klasör değil'); }
    catch (error) { if (error.code !== 'ENOENT') throw error; if (!options.create) throw namedError('NotFoundError', 'Klasör bulunamadı'); await fs.mkdir(p); }
    return new DiskDir(p, this.state);
  }
  async *entries() { for (const item of await fs.readdir(this.p, { withFileTypes: true })) yield [item.name, item.isDirectory() ? new DiskDir(path.join(this.p, item.name), this.state) : new DiskFile(path.join(this.p, item.name), this.state)]; }
}
async function folder() { const p = await fs.mkdtemp(path.join(os.tmpdir(), 'toru-storage-test-')); rootDirs.push(p); return new DiskDir(p); }
async function populated() { const dir = await folder(); const archive = await Archive.open(dir); const file = new File([encode('# Türkçe\n\nIŞIK, İZMİR, özgürlük.\n')], 'İlk Rapor.MD'); const { record } = await archive.importFile(file); return { dir, archive, record, file }; }

test.after(async () => { for (const p of rootDirs) await fs.rm(p, { recursive: true, force: true }); });

test('UTF-8, büyük .MD, özgün bayt, başlık kaynağı ve gerçek diskte kimlikli yol', async () => {
  const dir = await folder(); const archive = await Archive.open(dir);
  const bytes = Buffer.from('\ufeff# İçerikteki başka başlık\r\n\r\nTürkçe: ıİşğüöç.\r\n');
  const file = new File([bytes], 'Özgün Ad.MD');
  const { record, duplicate } = await archive.importFile(file);
  assert.equal(duplicate, false); assert.equal(record.title, 'Özgün Ad');
  assert.equal(record.originalName, 'Özgün Ad.MD');
  assert.deepEqual(Buffer.from(await archive.readBytes(record.id)), bytes);
  assert.deepEqual(await fs.readFile(path.join(dir.p, record.path)), bytes);
  assert.equal(await sha256(bytes), record.sha256);
  assert.match(await archive.readText(record.id), /Türkçe: ıİşğüöç/);
});

test('kaynak dosya silindikten sonra arşiv kopyası ve indirme baytları korunur', async () => {
  const dir = await folder(); const source = path.join(dir.p, 'kaynak.MD');
  const bytes = Buffer.from('# TEST VERİSİ\r\nTürkçe özgün kaynak.\r\n');
  await fs.writeFile(source, bytes);
  const separate = await folder(); const archive = await Archive.open(separate);
  const { record } = await archive.importFile(new File([await fs.readFile(source)], 'kaynak.MD'));
  await fs.unlink(source);
  assert.deepEqual(Buffer.from(await archive.readBytes(record.id)), bytes);
  assert.equal(await sha256(await archive.readBytes(record.id)), await sha256(bytes));
});

test('farklı ad aynı SHA yakalanır; aynı ad farklı içerik ayrı kalır', async () => {
  const { archive, record, file } = await populated();
  const duplicate = await archive.importFile(new File([await file.arrayBuffer()], 'Farklı.md'));
  assert.equal(duplicate.duplicate, true); assert.equal(duplicate.record.id, record.id);
  const other = await archive.importFile(new File(['# Farklı içerik'], file.name));
  assert.equal(other.duplicate, false); assert.notEqual(other.record.id, record.id);
  assert.equal(archive.manifest.reports.length, 2);
});

test('başlık, kaldırma, geri alma ve Türkçe arama özünü değiştirmez', async () => {
  const { archive, record } = await populated();
  const before = await archive.readBytes(record.id);
  const renamed = await archive.rename(record.id, '<img onerror=evil> Yeni başlık');
  assert.equal(renamed.originalName, record.originalName); assert.equal(renamed.addedAt, record.addedAt);
  assert.deepEqual(await archive.readBytes(record.id), before);
  await archive.setTrashed(record.id, true);
  const duplicate = await archive.importFile(new File([before], 'Yeni.md'));
  assert.equal(duplicate.duplicate, true); assert.equal(duplicate.record.trashed, true);
  const restored = await archive.setTrashed(record.id, false);
  assert.deepEqual({ ...restored, title: record.title }, record);
  assert.equal(fold('IŞIK İZMİR ÇÖĞÜŞ'), 'ışık izmir çöğüş');
});

test('yeni Archive oturumunda sadece diskten kayıtlar geri okunur', async () => {
  const { dir, archive, record } = await populated();
  const reopened = await Archive.open(new DiskDir(dir.p));
  assert.deepEqual(reopened.manifest, archive.manifest);
  assert.deepEqual(await reopened.readBytes(record.id), await archive.readBytes(record.id));
});

test('yedek yeni boş klasöre metadata ve özgün SHA ile geri yüklenir', async () => {
  const { archive, record } = await populated();
  await archive.rename(record.id, 'Güncel görünen ad');
  await archive.setTrashed(record.id, true);
  await archive.importFile(new File(['# İkinci\n\nTEST VERİSİ'], 'İkinci.md'));
  const backup = await archive.backup();
  const restored = await Archive.open(await folder());
  await restored.restore(JSON.parse(JSON.stringify(backup)));
  assert.deepEqual(restored.manifest, archive.manifest);
  for (const report of archive.manifest.reports) {
    assert.deepEqual(await restored.readBytes(report.id), await archive.readBytes(report.id));
    assert.equal(await sha256(await restored.readBytes(report.id)), report.sha256);
  }
  assert.deepEqual(await restored.backup(), backup);
});

test('bozuk, eksik, tekrarlanan ve yol kaçışlı yedek yazmadan reddedilir', async () => {
  const { archive } = await populated(); const backup = await archive.backup();
  const dir = await folder(); const empty = await Archive.open(dir); const original = await fs.readFile(path.join(dir.p, 'arsiv.json'));
  const cases = [
    value => { value.files[0].data = Buffer.from('bozuk').toString('base64'); },
    value => { value.files = []; },
    value => { value.manifest.reports[0].path = '../kacis.md'; },
    value => { value.manifest.reports[0].id = '../../kacis'; },
    value => { value.manifest.reports[0].id = [value.manifest.reports[0].id]; },
    value => { value.manifest.reports[0].sha256 = [value.manifest.reports[0].sha256]; },
    value => { value.files[0].id = 'bilinmeyen'; },
    value => { value.manifest.reports.push(value.manifest.reports[0]); value.files.push(value.files[0]); },
    value => { value.files[0].data = '!!!!'; },
    value => { value.files[0].path = '../ekstra'; }
  ];
  for (const change of cases) {
    const bad = structuredClone(backup); change(bad);
    await assert.rejects(empty.restore(bad));
    assert.deepEqual(await fs.readFile(path.join(dir.p, 'arsiv.json')), original);
    assert.deepEqual(await fs.readdir(path.join(dir.p, 'raporlar')), []);
  }
  await validateBackup(backup);
});

test('dolu arşivin ve boş manifestli kayıtsız dosyaların üzerine geri yüklenmez', async () => {
  const { archive } = await populated(); const backup = await archive.backup(); const before = archive.manifest;
  await assert.rejects(archive.restore(backup), error => error.code === 'NOT_EMPTY');
  assert.deepEqual(archive.manifest, before);
  const dir = await folder(); const empty = await Archive.open(dir);
  await fs.writeFile(path.join(dir.p, 'raporlar', 'korunacak.md'), 'koru');
  await assert.rejects(empty.restore(backup), error => error.code === 'NOT_EMPTY');
  assert.equal(await fs.readFile(path.join(dir.p, 'raporlar', 'korunacak.md'), 'utf8'), 'koru');
});

test('bozuk manifest sıfırlanmaz; önceki doğrulanmış kayıt yalnızca açık recover ile döner', async () => {
  const { dir, archive, record } = await populated();
  await archive.rename(record.id, 'Yeni');
  const previous = JSON.parse(await fs.readFile(path.join(dir.p, 'arsiv.onceki.json'), 'utf8'));
  await fs.writeFile(path.join(dir.p, 'arsiv.json'), '{BOZUK');
  await assert.rejects(Archive.open(dir), error => error.recoverable === true);
  assert.equal(await fs.readFile(path.join(dir.p, 'arsiv.json'), 'utf8'), '{BOZUK');
  const recovered = await Archive.recover(dir);
  assert.deepEqual(recovered.manifest, previous);
  const preserved = (await fs.readdir(dir.p)).filter(name => name.startsWith('arsiv.bozuk-'));
  assert.equal(preserved.length, 1);
  assert.equal(await fs.readFile(path.join(dir.p, preserved[0]), 'utf8'), '{BOZUK');
  assert.equal(await sha256(await recovered.readBytes(record.id)), record.sha256);
  await assert.rejects(Archive.recover(dir), error => error.code === 'HEALTHY');
});

test('eksik manifest dolu klasörü sıfırlamaz; ilgisiz klasörde arşiv oluşturulmaz', async () => {
  const { dir } = await populated(); await fs.unlink(path.join(dir.p, 'arsiv.json'));
  await assert.rejects(Archive.open(dir), error => error.code === 'MANIFEST_MISSING');
  await assert.rejects(fs.stat(path.join(dir.p, 'arsiv.json')));
  const unrelated = await folder(); await fs.writeFile(path.join(unrelated.p, 'önemli.txt'), 'koru');
  await assert.rejects(Archive.open(unrelated));
  assert.deepEqual(await fs.readdir(unrelated.p), ['önemli.txt']);
});

test('eksik/değişmiş rapor ve bozuk UTF-8 anlaşılır hata verir', async () => {
  const { dir, archive, record } = await populated();
  await fs.unlink(path.join(dir.p, record.path));
  await assert.rejects(archive.readBytes(record.id), error => error.code === 'MISSING_FILE');
  await assert.rejects(Archive.open(dir), error => error.code === 'MISSING_FILE');
  await fs.writeFile(path.join(dir.p, record.path), 'dışarıdan değişmiş');
  await assert.rejects(Archive.open(dir), error => error.code === 'HASH');
  const empty = await Archive.open(await folder());
  await assert.rejects(empty.importFile(new File([new Uint8Array([0xc3, 0x28])], 'bozuk.md')), error => error.code === 'ENCODING');
  assert.throws(() => decodeUTF8(new Uint8Array([0xff, 0xfe, 0x41, 0x00])), /UTF-8/);
  await assert.rejects(empty.importFile(new File(['Türkçe'], 'yanlis.txt')), error => error.code === 'EXTENSION');
  assert.equal(empty.manifest.reports.length, 0);
});

test('MD yazma hatasında başarı dönmez; manifest sağlam ve tekrar açılabilir kalır', async () => {
  const { dir, archive } = await populated(); const before = archive.manifest;
  const originalGetFileHandle = DiskDir.prototype.getFileHandle;
  let injected = false;
  DiskDir.prototype.getFileHandle = async function (name, options) {
    const handle = await originalGetFileHandle.call(this, name, options);
    if (this.name === 'raporlar' && options?.create && !injected) { injected = true; const original = handle.createWritable; handle.createWritable = async function () { throw namedError('NotAllowedError', 'Sentetik izin hatası'); }; }
    return handle;
  };
  try { await assert.rejects(archive.importFile(new File(['# Yeni test'], 'Yeni.md')), /Başarı bildirilmedi/); }
  finally { DiskDir.prototype.getFileHandle = originalGetFileHandle; }
  assert.deepEqual(archive.manifest, before);
  await assert.rejects(archive.rename(before.reports[0].id, 'Olmaz'), error => error.code === 'REOPEN');
  assert.deepEqual((await Archive.open(dir)).manifest, before);
});

test('ana manifest yazma hatasında önceki sağlam kayıt kurtarılabilir', async () => {
  const { dir, archive, record } = await populated(); const before = archive.manifest;
  dir.state.failName = 'arsiv.json';
  await assert.rejects(archive.rename(record.id, 'Kaydedilemeyen'), /Başlık kaydedilemedi/);
  assert.deepEqual(archive.manifest, before);
  assert.deepEqual(JSON.parse(await fs.readFile(path.join(dir.p, 'arsiv.onceki.json'), 'utf8')), before);
  delete dir.state.failName;
  assert.deepEqual((await Archive.open(dir)).manifest, before);
});

test('sıralı eşzamanlı yazmalar kaybolmaz; eski oturum güncel manifesti ezmez', async () => {
  const { dir, archive, record } = await populated();
  const stale = await Archive.open(new DiskDir(dir.p));
  await Promise.all([archive.rename(record.id, 'Sıralı başlık'), archive.setTrashed(record.id, true)]);
  assert.equal(archive.manifest.reports[0].title, 'Sıralı başlık'); assert.equal(archive.manifest.reports[0].trashed, true);
  await assert.rejects(stale.rename(record.id, 'Eski sekme'), error => error.code === 'STALE');
  assert.deepEqual((await Archive.open(dir)).manifest, archive.manifest);
});

test('bozuk önceki kayıt ve mevcut kimlikli dosya kontrolsüz ezilmez', async () => {
  const { dir, archive, record } = await populated();
  await fs.writeFile(path.join(dir.p, 'arsiv.onceki.json'), 'korunacak bozuk kayıt');
  const main = await fs.readFile(path.join(dir.p, 'arsiv.json'));
  await assert.rejects(archive.rename(record.id, 'Yeni ad'), error => error.code === 'PREVIOUS');
  assert.equal(await fs.readFile(path.join(dir.p, 'arsiv.onceki.json'), 'utf8'), 'korunacak bozuk kayıt');
  assert.deepEqual(await fs.readFile(path.join(dir.p, 'arsiv.json')), main);
});


test('eşzamanlı importlar sırayla kaydedilir; .md dosyasının başlangıç başlığı tam çıkarılır', async () => {
  const dir = await folder(); const archive = await Archive.open(dir);
  const results = await Promise.all([archive.importFile(new File(['# İlk'], '.md')), archive.importFile(new File(['# İkinci'], 'İkinci.md')), archive.importFile(new File(['# Üçüncü'], 'Üçüncü.md'))]);
  assert.equal(results[0].record.title, '');
  assert.equal(archive.manifest.reports.length, 3);
  assert.equal(new Set(archive.manifest.reports.map(record => record.id)).size, 3);
  assert.deepEqual((await Archive.open(dir)).manifest, archive.manifest);
});

test('ilk kurulumda disk izni reddi sahte boş arşiv başarısı üretmez', async () => {
  const dir = await folder(); dir.state.deny = true;
  await assert.rejects(Archive.open(dir), error => error.code === 'WRITE');
  assert.equal((await fs.readFile(path.join(dir.p, 'arsiv.json'))).length, 0);
});


test('eski v1 yedeği ve arşiv açma eski manifest ile MD baytlarını korur', async () => {
  const {dir,archive,record}=await populated();
  const raw=await fs.readFile(path.join(dir.p,'arsiv.json'));const md=await archive.readBytes(record.id);
  const loaded=await Archive.open(dir);assert.deepEqual(await fs.readFile(path.join(dir.p,'arsiv.json')),raw);
  const backup=await loaded.backup();assert.equal(backup.version,1);assert.equal('profiles' in backup,false);
  const restored=await Archive.open(await folder());await restored.restore(backup);
  assert.deepEqual(restored.manifest,archive.manifest);assert.deepEqual(await restored.readBytes(record.id),md);
});

test('v2 yedek profil geçmişini, kaynakları, tüm metadata ve özgün MD baytlarını geri yükler', async () => {
  const {dir,archive,record}=await populated();const profiles=await ToreProfiles.ProfileStore.open(dir);
  const source=await profiles.saveProfile({kind:'thinker',name:'SENTETİK Düşünür',bio:'Test',editor:'Düzenleyen',sources:[{label:'Asıl rapor',url:'https://example.invalid/source',reportId:record.id}]});
  const view=await profiles.saveView(source.id,{topic:'Gelecek',area:'future',text:'Katılım artabilir.',kind:'prediction',bridge:'Bugünden geleceğe gerekçe',sourceIds:[source.sources[0].id],reportIds:[record.id]});
  await profiles.saveView(source.id,{id:view.id,topic:'Gelecek',area:'future',text:'Katılımın artıp artmayacağı açık.',kind:'question',bridge:'Belirsizlik korundu',sourceIds:[source.sources[0].id],reportIds:[record.id],changeType:'opinion',reason:'Kesinlik azaldı.'});
  await archive.setTrashed(record.id,true);
  const backup=await archive.backup();assert.equal(backup.version,2);assert.deepEqual(backup.profiles,profiles.document);
  const target=await folder();const restored=await Archive.open(target);await restored.restore(JSON.parse(JSON.stringify(backup)));
  assert.deepEqual(restored.manifest,archive.manifest);assert.deepEqual((await ToreProfiles.ProfileStore.open(target)).document,profiles.document);
  assert.deepEqual(await restored.readBytes(record.id),await archive.readBytes(record.id));
  assert.deepEqual(await restored.backup(),backup);
});

test('v1 ve v2 yedekler dolu profil kaydını değiştirmez; bozuk v2 başvuruları yazmadan reddedilir', async () => {
  const source=await populated();const v1=await source.archive.backup();
  const sourceProfiles=await ToreProfiles.ProfileStore.open(source.dir);await sourceProfiles.saveProfile({kind:'self',name:'Test Kullanıcısı',bio:'',editor:'',sources:[]});
  const v2=await source.archive.backup();
  const target=await folder(),archive=await Archive.open(target),profiles=await ToreProfiles.ProfileStore.open(target);
  await profiles.saveProfile({kind:'self',name:'Korunacak profil',bio:'',editor:'',sources:[]});
  const before=await fs.readFile(path.join(target.p,'profiller.json')),main=await fs.readFile(path.join(target.p,'arsiv.json'));
  await assert.rejects(archive.restore(v1),error=>error.code==='NOT_EMPTY');await assert.rejects(archive.restore(v2),error=>error.code==='NOT_EMPTY');
  assert.deepEqual(await fs.readFile(path.join(target.p,'profiller.json')),before);assert.deepEqual(await fs.readFile(path.join(target.p,'arsiv.json')),main);
  const emptyDir=await folder(),empty=await Archive.open(emptyDir);
  const bad=structuredClone(v2);bad.profiles.profiles[0].sources=[{id:crypto.randomUUID(),label:'Kötü',url:'javascript:alert(1)',reportId:''}];
  await assert.rejects(empty.restore(bad));assert.deepEqual(await fs.readdir(path.join(emptyDir.p,'raporlar')),[]);
  assert.equal((await empty.backup()).version,1);
});

test('v2 profil yazması başarısızsa başarı dönmez, kaynak yedek ve önceki profil kaydı korunur', async () => {
  const source=await populated();const profiles=await ToreProfiles.ProfileStore.open(source.dir);await profiles.saveProfile({kind:'self',name:'Sentetik',bio:'',editor:'',sources:[]});const backup=await source.archive.backup();
  const target=await folder(),archive=await Archive.open(target);target.state.failName='profiller.json';
  await assert.rejects(archive.restore(backup),/Başarı bildirilmedi/);
  assert.deepEqual(JSON.parse(await fs.readFile(path.join(target.p,'profiller.onceki.json'),'utf8')),{schemaVersion:1,revision:0,profiles:[]});
  delete target.state.failName;await assert.rejects(ToreProfiles.ProfileStore.open(target),e=>e.recoverable);
  const recovered=await ToreProfiles.ProfileStore.recover(target);assert.deepEqual(recovered.document,{schemaVersion:1,revision:0,profiles:[]});
  assert.equal(backup.profiles.profiles[0].name,'Sentetik');
});
