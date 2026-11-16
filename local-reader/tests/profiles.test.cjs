'use strict';
const {test,after}=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs/promises');
const path=require('node:path');
const os=require('node:os');
const {File}=require('node:buffer');
const {DiskDir}=require('./profile-fs-adapter.cjs');
require('../src/profiles.js');require('../src/storage.js');
const {ProfileStore,validateDocument}=globalThis.ToreProfiles;
const {Archive,sha256}=globalThis.ToruStore;
const folders=[];
async function setup(){const p=await fs.mkdtemp(path.join(os.tmpdir(),'tore-profile-test-'));folders.push(p);const dir=new DiskDir(p);const archive=await Archive.open(dir);const {record}=await archive.importFile(new File(['# SENTETİK TEST\r\nÖzgün rapor.\r\n'],'Özgün.md'));return {dir,archive,record,store:await ProfileStore.open(dir,archive.manifest.reports)};}
const self=(extra={})=>({kind:'self',name:'SENTETİK Kullanıcı',bio:'',editor:'',sources:[],...extra});
const position=(extra={})=>({topic:'Katılım',area:'present',text:'Gönüllü katılımı savunuyorum.',kind:'position',bridge:'',sourceIds:[],reportIds:[],...extra});
after(async()=>{for(const p of folders)await fs.rm(p,{recursive:true,force:true});});

test('eski arşivi ve profilsiz açılışı hiçbir manifest/MD baytını değiştirmez',async()=>{
  const {dir,archive,record}=await setup();
  const manifest=await fs.readFile(path.join(dir.p,'arsiv.json'));
  const md=await fs.readFile(path.join(dir.p,record.path));
  const before=await fs.readdir(dir.p);
  const opened=await ProfileStore.open(dir,archive.manifest.reports);
  assert.deepEqual(opened.document,{schemaVersion:1,revision:0,profiles:[]});
  assert.deepEqual(await fs.readdir(dir.p),before);
  assert.deepEqual(await fs.readFile(path.join(dir.p,'arsiv.json')),manifest);
  assert.deepEqual(await fs.readFile(path.join(dir.p,record.path)),md);
  assert.equal((await archive.backup()).version,1);
});

test('tek kendi profili kalıcıdır; profil yazması özgün raporu ve manifestini değiştirmez',async()=>{
  const {dir,archive,record,store}=await setup();const before=archive.manifest,bytes=await archive.readBytes(record.id);
  const profile=await store.saveProfile(self());
  await assert.rejects(store.saveProfile(self({name:'İkinci kendim'})),e=>e.code==='PROFILE_SELF');
  assert.equal(store.document.profiles.length,1);
  assert.deepEqual((await ProfileStore.open(dir)).document,store.document);
  assert.deepEqual((await Archive.open(dir)).manifest,before);
  assert.equal(await sha256(await archive.readBytes(record.id)),await sha256(bytes));
  assert.equal(profile.kind,'self');
});

test('görüş değişimi, metin düzeltmesi ve açık sorular farklı immutable geçmiş kayıtlarıdır',async()=>{
  const {store,record}=await setup();const profile=await store.saveProfile(self());
  const initial=await store.saveView(profile.id,position({reportIds:[record.id]}));
  const initialSnapshot=structuredClone(initial.revisions[0]);
  const changed=await store.saveView(profile.id,position({id:initial.id,text:'İki haftada bir buluşmayı savunuyorum.',reportIds:[record.id],reason:'Katılım süresini azalttım.',changeType:'opinion'}));
  assert.deepEqual(changed.revisions[0],initialSnapshot);
  const corrected=await store.saveView(profile.id,position({id:initial.id,text:'İki haftada bir buluşmayı savunuyorum.',reportIds:[record.id],reason:'Yalnızca yazım düzeltildi.',changeType:'correction'}));
  assert.deepEqual(corrected.revisions.map(r=>r.changeType),['initial','opinion','correction']);
  assert.deepEqual(corrected.revisions[1],changed.revisions[1]);
  const prediction=await store.saveView(profile.id,position({area:'future',kind:'prediction',text:'Katılım artabilir.'}));
  const question=await store.saveView(profile.id,position({area:'past',kind:'question',text:'Önceki süre neden uzundu?'}));
  assert.equal(prediction.kind,'prediction');assert.equal(question.kind,'question');
  await assert.rejects(store.saveView(profile.id,position({id:initial.id,changeType:'opinion'})),e=>e.code==='VIEW_REASON');
  assert.equal(store.document.profiles[0].views[0].revisions.length,3);
});

test('düşünür kaydında düzenleyen, kaynak ve kaynaklı görüş zorunludur',async()=>{
  const {store,record}=await setup();
  await assert.rejects(store.saveProfile({kind:'thinker',name:'SENTETİK Düşünür',bio:'',editor:'',sources:[]}),e=>e.code==='THINKER_SOURCE');
  const thinker=await store.saveProfile({kind:'thinker',name:'SENTETİK Düşünür',bio:'',editor:'Kullanıcı',sources:[{label:'Arşiv raporu',url:'',reportId:record.id}]});
  await assert.rejects(store.saveView(thinker.id,position({reportIds:[record.id]})),e=>e.code==='THINKER_VIEW_SOURCE');
  const view=await store.saveView(thinker.id,position({sourceIds:[thinker.sources[0].id]}));assert.equal(view.sourceIds[0],thinker.sources[0].id);
  await assert.rejects(store.saveProfile({...thinker,sources:[]}),e=>['THINKER_SOURCE','VIEW_REFERENCE','PROFILE_SOURCE_HISTORY'].includes(e.code));
});

test('tehlikeli protokoller ve bilinmeyen rapor/kaynak kimlikleri yazılmadan reddedilir',async()=>{
  const {dir,store}=await setup();const profile=await store.saveProfile(self());const raw=await fs.readFile(path.join(dir.p,'profiller.json'));
  for(const url of ['javascript:alert(1)','data:text/html,evil','file:///etc/passwd','//example.invalid','../rapor.md'])await assert.rejects(store.saveProfile({...profile,sources:[{label:'Tehlikeli',url,reportId:''}]}));
  await assert.rejects(store.saveProfile({...profile,sources:[{label:'Yok',url:'',reportId:crypto.randomUUID()}]}),e=>e.code==='PROFILE_REFERENCE');
  await assert.rejects(store.saveView(profile.id,position({sourceIds:[crypto.randomUUID()]})),e=>e.code==='VIEW_REFERENCE');
  await assert.rejects(store.saveView(profile.id,position({reportIds:[crypto.randomUUID()]})),e=>e.code==='VIEW_REFERENCE');
  assert.deepEqual(await fs.readFile(path.join(dir.p,'profiller.json')),raw);
});

test('güvenilmeyen düz metin alanları kayıtta değiştirilmez; çöp raporuna başvuru korunur',async()=>{
  const {archive,store,record}=await setup();await archive.setTrashed(record.id,true);
  const unsafe='<img src=x onerror=alert(1)>';
  const profile=await store.saveProfile(self({name:unsafe,bio:'<script>evil()</script>',sources:[{label:unsafe,url:'https://example.invalid/source',reportId:record.id}]}));
  const view=await store.saveView(profile.id,position({text:unsafe,reportIds:[record.id]}));
  assert.equal(profile.name,unsafe);assert.equal(view.text,unsafe);assert.equal(view.reportIds[0],record.id);
  assert.deepEqual(validateDocument(store.document,archive.manifest.reports),store.document);
});

test('profil yazma hatasında sahte başarı olmaz; önceki sağlam kayıt ve açık kurtarma vardır',async()=>{
  const {dir,store}=await setup();const profile=await store.saveProfile(self());const before=store.document;
  dir.state.failName='profiller.json';
  await assert.rejects(store.saveProfile({...profile,bio:'Kaydedilemeyecek'}),e=>e.code==='PROFILE_WRITE');
  assert.deepEqual(store.document,before);
  assert.deepEqual(JSON.parse(await fs.readFile(path.join(dir.p,'profiller.onceki.json'),'utf8')),before);
  await assert.rejects(store.saveProfile({...profile,bio:'Yeniden'}),e=>e.code==='PROFILES_REOPEN');
  delete dir.state.failName;
  await fs.writeFile(path.join(dir.p,'profiller.json'),'{BOZUK');
  await assert.rejects(ProfileStore.open(dir),e=>e.recoverable===true);
  assert.equal(await fs.readFile(path.join(dir.p,'profiller.json'),'utf8'),'{BOZUK');
  const recovered=await ProfileStore.recover(dir);assert.deepEqual(recovered.document,before);
  const corrupt=(await fs.readdir(dir.p)).find(n=>n.startsWith('profiller.bozuk-'));assert.ok(corrupt);assert.equal(await fs.readFile(path.join(dir.p,corrupt),'utf8'),'{BOZUK');
});

test('eksik profil ana kaydı sıfırlanmaz; kuyruk ve eski oturum ezmeyi engeller',async()=>{
  const {dir,store}=await setup();const profile=await store.saveProfile(self());const stale=await ProfileStore.open(dir);
  await Promise.all([store.saveView(profile.id,position({topic:'Bir'})),store.saveView(profile.id,position({topic:'İki'}))]);
  assert.equal(store.document.profiles[0].views.length,2);
  await assert.rejects(stale.saveProfile({...profile,bio:'Eski oturum'}),e=>e.code==='PROFILES_STALE');
  await fs.unlink(path.join(dir.p,'profiller.json'));
  await assert.rejects(ProfileStore.open(dir),e=>e.code==='PROFILES_MISSING'&&e.recoverable);
  await assert.rejects(fs.stat(path.join(dir.p,'profiller.json')));
});

test('diskte rapor kimliği kaybolursa profil başvurusu yeniden doğrulanır',async()=>{
  const {dir,store,record}=await setup();const profile=await store.saveProfile(self());
  const manifest=JSON.parse(await fs.readFile(path.join(dir.p,'arsiv.json'),'utf8'));manifest.reports=[];await fs.writeFile(path.join(dir.p,'arsiv.json'),JSON.stringify(manifest));
  await assert.rejects(store.saveView(profile.id,position({reportIds:[record.id]})),e=>e.code==='VIEW_REFERENCE');
});


test('kullanılan kaynak kimliğinin içeriği geçmişi yeniden yazamaz; kullanılmayan kaynak düzenlenebilir',async()=>{
  const {dir,store}=await setup();
  let profile=await store.saveProfile(self({sources:[{label:'İlk kaynak',url:'https://example.invalid/original',reportId:''},{label:'Kullanılmayan',url:'https://example.invalid/unused',reportId:''}]}));
  const first=profile.sources[0],unused=profile.sources[1];
  const view=await store.saveView(profile.id,position({sourceIds:[first.id]}));
  profile=store.document.profiles[0];
  profile=await store.saveProfile({...profile,sources:profile.sources.map(s=>s.id===unused.id?{...s,label:'Düzenlenen kullanılmayan',url:'https://example.invalid/edited'}:s)});
  assert.equal(profile.sources[1].label,'Düzenlenen kullanılmayan');
  // Güncel görüş artık başka kaynağa geçse de ilk kaynağın tarihsel anlamı korunmalı.
  await store.saveView(profile.id,position({id:view.id,sourceIds:[unused.id],reason:'Başka dayanak seçildi.',changeType:'opinion'}));
  profile=store.document.profiles[0];
  const before=await fs.readFile(path.join(dir.p,'profiller.json'));
  for(const field of ['label','url','reportId']){
    const changed=structuredClone(profile);changed.sources[0][field]=field==='url'?'https://example.invalid/replaced':field==='reportId'?crypto.randomUUID():'Yeni kaynak başlığı';
    await assert.rejects(store.saveProfile(changed),e=>e.code==='PROFILE_SOURCE_HISTORY');
    assert.deepEqual(await fs.readFile(path.join(dir.p,'profiller.json')),before);
  }
  await assert.rejects(store.saveProfile({...profile,sources:profile.sources.slice(1)}),e=>e.code==='PROFILE_SOURCE_HISTORY');
  assert.deepEqual(await fs.readFile(path.join(dir.p,'profiller.json')),before);
  assert.deepEqual(store.document.profiles[0].views[0].revisions[0].sourceIds,[first.id]);
});
