/* Töre 0.3.0 — özel, kullanıcı yazımı ve sabit görüş sürümlerine bağlı karşılaştırmalar. */
(function(root){
'use strict';
const MAIN='karsilastirmalar.json',PREVIOUS='karsilastirmalar.onceki.json';
const copy=x=>JSON.parse(JSON.stringify(x)),enc=new TextEncoder(),UUID=/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;
const empty=()=>({schemaVersion:1,revision:0,comparisons:[]});
class ComparisonError extends Error{constructor(code,message,recoverable=false){super(message);this.name='ComparisonError';this.code=code;this.recoverable=recoverable;}}
const fail=(code,message)=>new ComparisonError(code,message);
const keys=(x,list)=>x&&typeof x==='object'&&!Array.isArray(x)&&Object.keys(x).length===list.length&&list.every(k=>Object.hasOwn(x,k));
const text=(x,min=0,max=100000)=>typeof x==='string'&&!x.includes('\0')&&[...x].length<=max&&[...x.trim()].length>=min;
const date=x=>typeof x==='string'&&Number.isFinite(Date.parse(x))&&new Date(x).toISOString()===x;
const same=(a,b)=>JSON.stringify(a)===JSON.stringify(b);
function profilesArray(profiles){return Array.isArray(profiles)?profiles:profiles?.profiles||[];}
function resolveReference(ref,profiles){
 if(!ref||typeof ref!=='object')throw fail('COMPARISON_REFERENCE','Her iki tarafta bir görüş sürümü seçin.');
 const profile=profilesArray(profiles).find(p=>p.id===ref.profileId),view=profile?.views.find(v=>v.id===ref.viewId),revision=view?.revisions.find(r=>r.id===ref.revisionId);
 if(!profile||!view||!revision)throw fail('COMPARISON_REFERENCE','Karşılaştırmanın bağlı olduğu profil, görüş veya sürüm bulunamadı. Kayıt değiştirilmedi.');
 return {profileId:profile.id,viewId:view.id,revisionId:revision.id,profileName:profile.name,profileKind:profile.kind,editor:profile.editor,topic:revision.topic,area:revision.area,text:revision.text,kind:revision.kind,bridge:revision.bridge,sources:revision.sourceIds.map(id=>{const s=profile.sources.find(s=>s.id===id);if(!s)throw fail('COMPARISON_SOURCE','Görüş kaynağı bulunamadı.');return copy(s);}),reportIds:copy(revision.reportIds),at:revision.at};
}
function validateReference(ref,profiles){
 if(!keys(ref,['profileId','viewId','revisionId','profileName','profileKind','editor','topic','area','text','kind','bridge','sources','reportIds','at'])||!text(ref.profileName,1)||!text(ref.editor)||!['self','thinker'].includes(ref.profileKind))throw fail('COMPARISON_REFERENCE','Görüş sürümü anlık görüntüsü geçersiz.');
 const expected=resolveReference(ref,profiles);
 for(const key of ['profileId','viewId','revisionId','topic','area','text','kind','bridge','sources','reportIds','at'])if(!same(ref[key],expected[key]))throw fail('COMPARISON_REFERENCE','Karşılaştırma metni seçilen sabit görüş sürümüyle eşleşmiyor.');
}
function validateAssessment(a,left,right){
 if(!keys(a,['commonQuestion','category','sharedGround','difference','leftEvidence','rightEvidence','openQuestions'])||!text(a.commonQuestion,1,1000)||!['fact','prediction','value','goal','method','scope','unclear'].includes(a.category)||!text(a.sharedGround,0,10000)||!text(a.difference,0,10000)||!Array.isArray(a.openQuestions)||a.openQuestions.length>32||!a.openQuestions.every(s=>text(s,1,2000)))throw fail('COMPARISON_ASSESSMENT','Ortak soru, ayrışma türü veya karşılaştırma metni geçersiz.');
 for(const [name,source]of [['leftEvidence',left.text],['rightEvidence',right.text]]){
  const list=a[name];if(!Array.isArray(list)||list.length<1||list.length>32||new Set(list).size!==list.length||!list.every(s=>text(s,1,10000)&&source.includes(s)))throw fail('COMPARISON_EVIDENCE','Her iki görüşten en az bir birebir alıntı seçin. Alıntı metni seçilen sürümde aynen bulunmalı; sistem alıntı üretmez.');
 }
 return copy(a);
}
function validateDocument(input,profiles,reports){
 if(!keys(input,['schemaVersion','revision','comparisons'])||input.schemaVersion!==1||!Number.isSafeInteger(input.revision)||input.revision<0||!Array.isArray(input.comparisons))throw fail('COMPARISONS_SCHEMA','Karşılaştırma dosyasının yapısı veya şema sürümü geçersiz; kayıt sıfırlanmadı.');
 root.ToreProfiles.validateDocument(Array.isArray(profiles)?{schemaVersion:1,revision:0,profiles}:profiles,reports);
 const ids=new Set();const unique=id=>{if(typeof id!=='string'||!UUID.test(id)||ids.has(id))throw fail('COMPARISON_ID','Geçersiz veya tekrarlanan karşılaştırma kimliği.');ids.add(id);};
 for(const c of input.comparisons){
  if(!keys(c,['id','left','right','assessment','createdAt','updatedAt','revisions'])||!date(c.createdAt)||!date(c.updatedAt)||c.updatedAt<c.createdAt||!Array.isArray(c.revisions)||!c.revisions.length)throw fail('COMPARISON_SCHEMA','Karşılaştırma veya düzenleme geçmişi geçersiz.');unique(c.id);validateReference(c.left,profiles);validateReference(c.right,profiles);
  if(c.left.revisionId===c.right.revisionId)throw fail('COMPARISON_SAME','İki farklı görüş sürümü seçin.');validateAssessment(c.assessment,c.left,c.right);
  let at=c.createdAt;
  c.revisions.forEach((r,i)=>{if(!keys(r,['id','assessment','at','reason'])||!date(r.at)||r.at<at||!text(r.reason,i?1:0,4000)||i===0&&r.at!==c.createdAt)throw fail('COMPARISON_HISTORY','Düzenleme tarihi veya gerekçesi geçersiz.');unique(r.id);validateAssessment(r.assessment,c.left,c.right);at=r.at;});
  const last=c.revisions.at(-1);if(last.at!==c.updatedAt||!same(last.assessment,c.assessment))throw fail('COMPARISON_HISTORY','Güncel değerlendirme geçmişin son kaydıyla eşleşmiyor.');
 }return copy(input);
}
async function optional(dir,name){try{return await dir.getFileHandle(name);}catch(e){if(e.name==='NotFoundError')return null;throw e;}}
async function raw(file){return root.ToruStore.decodeUTF8(new Uint8Array(await(await file.getFile()).arrayBuffer()));}
async function load(dir,name,profiles,reports){const file=await optional(dir,name);if(!file)return null;const data=await raw(file);let doc;try{doc=JSON.parse(data);}catch(_){throw fail('COMPARISONS_JSON',name+' geçerli JSON değil. Karşılaştırmalar sıfırlanmadı.');}return {raw:data,document:validateDocument(doc,profiles,reports)};}
async function prior(dir,profiles,reports){try{return !!await load(dir,PREVIOUS,profiles,reports);}catch(_){return false;}}
async function readDocument(dir,profiles,reports){const doc=await load(dir,MAIN,profiles,reports);if(doc)return doc;if(await optional(dir,PREVIOUS))throw new ComparisonError('COMPARISONS_MISSING','Ana karşılaştırma kaydı eksik. Önceki kaydı açık kurtarma ile geri alın.',await prior(dir,profiles,reports));return null;}
async function lock(fn){return root.navigator?.locks?.request?root.navigator.locks.request('toru-0.1.1-archive-write',{mode:'exclusive'},fn):fn();}
async function write(dir,name,data,newOnly=false){const old=await optional(dir,name);if(old&&newOnly)throw fail('COMPARISON_COLLISION','Mevcut dosyanın üzerine yazılmadı.');const f=old||await dir.getFileHandle(name,{create:true});let w;try{w=await f.createWritable();await w.write(enc.encode(data));await w.close();w=null;if(await raw(f)!==data)throw fail('COMPARISON_WRITE','Karşılaştırma disk doğrulaması eşleşmedi.');}catch(e){if(w?.abort){try{await w.abort();}catch(_){}}throw e;}}
async function context(dir){if(!await optional(dir,'arsiv.json'))throw fail('COMPARISON_ARCHIVE','Arşiv kaydı eksik; klasörü yeniden seçin.');const reports=await root.ToreProfiles.currentReports(dir);const profiles=await root.ToreProfiles.readDocument(dir,reports);return {reports,profiles:profiles?profiles.document:{schemaVersion:1,revision:0,profiles:[]}};}
class ComparisonStore{
 constructor(dir,document,data){this.dir=dir;this._document=document;this._raw=data;this._queue=Promise.resolve();this._valid=true;}
 get document(){return copy(this._document);}
 static async open(dir){return lock(async()=>{const ctx=await context(dir);try{const doc=await readDocument(dir,ctx.profiles,ctx.reports);return new ComparisonStore(dir,doc?doc.document:empty(),doc?doc.raw:null);}catch(e){throw new ComparisonError(e.code||'COMPARISONS_OPEN',e.message,await prior(dir,ctx.profiles,ctx.reports));}});}
 static async recover(dir){return lock(async()=>{const ctx=await context(dir);try{if(await load(dir,MAIN,ctx.profiles,ctx.reports))throw fail('COMPARISONS_HEALTHY','Ana karşılaştırma kaydı sağlam; önceki kayda dönülmedi.');}catch(e){if(e.code==='COMPARISONS_HEALTHY')throw e;}const saved=await load(dir,PREVIOUS,ctx.profiles,ctx.reports);if(!saved)throw fail('COMPARISONS_RECOVERY','Sağlam önceki karşılaştırma kaydı yok.');const damaged=await optional(dir,MAIN);try{if(damaged)await write(dir,'karsilastirmalar.bozuk-'+root.crypto.randomUUID()+'.json',await raw(damaged),true);await write(dir,MAIN,saved.raw);}catch(e){throw fail('COMPARISON_WRITE','Kurtarma tamamlanmadı; başarı bildirilmedi. '+e.message);}return new ComparisonStore(dir,saved.document,saved.raw);});}
 _enqueue(fn){const result=this._queue.then(()=>lock(async()=>{if(!this._valid)throw fail('COMPARISONS_REOPEN','Önceki yazma tamamlanmadı; klasörü yeniden seçin.');return fn();}));this._queue=result.catch(()=>{});return result;}
 async _assert(){const f=await optional(this.dir,MAIN);if((f?await raw(f):null)!==this._raw)throw fail('COMPARISONS_STALE','Karşılaştırmalar başka oturumda değişti; üzerine yazılmadı. Klasörü yeniden seçin.');}
 async save(input){return this._enqueue(async()=>{await this._assert();const ctx=await context(this.dir),next=copy(this._document),at=new Date().toISOString();let c=input.id?next.comparisons.find(c=>c.id===input.id):null;if(input.id&&!c)throw fail('COMPARISON_ID','Karşılaştırma bulunamadı.');
  if(c){if(!text(input.reason,1,4000))throw fail('COMPARISON_REASON','Düzenleme gerekçesi gerekli.');if(input.left&&!same(input.left,{profileId:c.left.profileId,viewId:c.left.viewId,revisionId:c.left.revisionId})||input.right&&!same(input.right,{profileId:c.right.profileId,viewId:c.right.viewId,revisionId:c.right.revisionId}))throw fail('COMPARISON_REFERENCE','Düzenlemede bağlı görüş sürümleri değiştirilemez; yeni karşılaştırma oluşturun.');}
  else{c={id:root.crypto.randomUUID(),left:resolveReference(input.left,ctx.profiles),right:resolveReference(input.right,ctx.profiles),assessment:null,createdAt:at,updatedAt:at,revisions:[]};next.comparisons.push(c);}
  c.assessment=validateAssessment(input.assessment,c.left,c.right);c.updatedAt=at;c.revisions.push({id:root.crypto.randomUUID(),assessment:copy(c.assessment),at,reason:input.reason||''});next.revision++;validateDocument(next,ctx.profiles,ctx.reports);
  const previous=await optional(this.dir,PREVIOUS);if(previous)await load(this.dir,PREVIOUS,ctx.profiles,ctx.reports);const data=JSON.stringify(next,null,2)+'\n';
  try{await write(this.dir,PREVIOUS,this._raw||JSON.stringify(this._document,null,2)+'\n');await this._assert();await write(this.dir,MAIN,data,this._raw===null);}catch(e){this._valid=false;throw fail('COMPARISON_WRITE','Karşılaştırma kaydedilemedi; başarı bildirilmedi. Klasörü yeniden seçin. '+e.message);}this._document=next;this._raw=data;return copy(c);
 });}
}
root.ToreComparisons=Object.freeze({ComparisonStore,ComparisonError,resolveReference,validateDocument,validateAssessment,readDocument});
})(globalThis);
