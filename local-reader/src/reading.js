/* Töre — okuma notları ve yer işaretleri; özgün Markdown değişmez. */
(function(root){
 'use strict';
 const MAIN='okuma.json',PREVIOUS='okuma.onceki.json',LOCK='toru-0.1.1-archive-write';
 const UUID=/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;
 const SHA=/^[0-9a-f]{64}$/,encoder=new TextEncoder(),clone=v=>JSON.parse(JSON.stringify(v));
 const empty=()=>({format:'tore-reading',version:1,revision:0,items:[]});
 class ReadingError extends Error{constructor(code,message,options={}){super(message);this.name='ReadingError';this.code=code;this.recoverable=!!options.recoverable;if(options.cause)this.cause=options.cause;}}
 const fail=(code,message,cause)=>new ReadingError(code,message,{cause});
 const object=v=>v!==null&&typeof v==='object'&&!Array.isArray(v);
 const keys=(v,list)=>object(v)&&Object.keys(v).length===list.length&&list.every(k=>Object.hasOwn(v,k));
 const text=(v,max,required=false)=>typeof v==='string'&&[...v].length<=max&&!/[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/u.test(v)&&(!required||!!v.trim());
 const date=v=>typeof v==='string'&&Number.isFinite(Date.parse(v))&&new Date(v).toISOString()===v;
 const heading=v=>text(v,180)&&!/[\r\n\t]/u.test(v);
 function reportMap(reports){
  if(!Array.isArray(reports))throw fail('READING_REPORTS','Okuma kaydı için rapor listesi doğrulanamadı.');
  const out=new Map();for(const r of reports){if(!object(r)||!UUID.test(r.id)||!SHA.test(r.sha256)||out.has(r.id))throw fail('READING_REPORTS','Arşivde geçersiz rapor kimliği veya içerik özeti var.');out.set(r.id,r);}return out;
 }
 function validateDocument(doc,reports=[]){
  if(!keys(doc,['format','version','revision','items'])||doc.format!=='tore-reading'||doc.version!==1||!Number.isSafeInteger(doc.revision)||doc.revision<0||!Array.isArray(doc.items))throw fail('READING_SCHEMA','okuma.json yapısı veya sürümü desteklenmiyor. Kayıt sıfırlanmadı.');
  const known=reportMap(reports),seenReports=new Set(),ids=new Set();
  const unique=id=>{if(typeof id!=='string'||!UUID.test(id)||ids.has(id))throw fail('READING_ID','Okuma kaydında geçersiz veya tekrarlanan kimlik var.');ids.add(id);};
  for(const item of doc.items){
   if(!keys(item,['reportId','sha256','notes','bookmarks','position'])||!UUID.test(item.reportId)||!SHA.test(item.sha256)||seenReports.has(item.reportId)||!Array.isArray(item.notes)||!Array.isArray(item.bookmarks))throw fail('READING_ITEM','Okuma kaydı eksik veya geçersiz.');
   const report=known.get(item.reportId);if(!report||report.sha256!==item.sha256)throw fail('READING_REFERENCE','Notun veya işaretin raporu/içerik özeti arşivle eşleşmiyor. Okuma kaydı değiştirilmedi.');seenReports.add(item.reportId);
   for(const n of item.notes){if(!keys(n,['id','text','quote','createdAt','updatedAt'])||!text(n.text,10000,true)||!text(n.quote,4000)||!date(n.createdAt)||!date(n.updatedAt)||n.updatedAt<n.createdAt)throw fail('READING_NOTE','Okuma notu geçersiz: metin, alıntı veya tarih denetlenemedi.');unique(n.id);}
   for(const b of item.bookmarks){if(!keys(b,['id','label','quote','headingId','createdAt'])||!text(b.label,180,true)||!text(b.quote,4000)||!heading(b.headingId)||!b.quote.trim()&&!b.headingId||!date(b.createdAt))throw fail('READING_BOOKMARK','Okuma işareti geçersiz: bir alıntı veya bölüm başlığı gerekli.');unique(b.id);}
   const p=item.position;if(p!==null&&(!keys(p,['headingId','progress','updatedAt'])||!heading(p.headingId)||typeof p.progress!=='number'||!Number.isFinite(p.progress)||p.progress<0||p.progress>1||!date(p.updatedAt)))throw fail('READING_POSITION','Okuma yeri geçersiz; ilerleme 0 ile 1 arasında olmalı.');
  }
  return clone(doc);
 }
 function decode(bytes){try{return new TextDecoder('utf-8',{fatal:true}).decode(bytes);}catch(cause){throw fail('READING_ENCODING','Okuma kaydı geçerli UTF-8 değil; dosya değiştirilmedi.',cause);}}
 async function optional(dir,name){try{return await dir.getFileHandle(name);}catch(e){if(e.name==='NotFoundError')return null;throw e;}}
 const bytes=async f=>new Uint8Array(await(await f.getFile()).arrayBuffer());
 const same=(a,b)=>a===null?b===null:b!==null&&a.length===b.length&&a.every((v,i)=>v===b[i]);
 async function write(dir,name,data,newOnly=false){const old=await optional(dir,name);if(old&&newOnly)throw fail('READING_COLLISION','Mevcut okuma dosyasının üzerine yazılmadı.');const f=old||await dir.getFileHandle(name,{create:true});let writer;try{writer=await f.createWritable();await writer.write(data);await writer.close();writer=null;if(!same(await bytes(f),data))throw fail('READING_VERIFY','Okuma dosyasının disk doğrulaması eşleşmedi.');}catch(e){if(writer?.abort){try{await writer.abort();}catch(_){}}throw e;}}
 let fallbackQueue=Promise.resolve();
 const lock=action=>{if(root.navigator?.locks?.request)return root.navigator.locks.request(LOCK,{mode:'exclusive'},action);const result=fallbackQueue.then(action);fallbackQueue=result.catch(()=>{});return result;};
 async function currentReports(dir,fallback=[]){const f=await optional(dir,'arsiv.json');if(!f)return fallback;let doc;try{doc=JSON.parse(decode(await bytes(f)));if(root.ToruStore)doc=root.ToruStore.validateManifest(doc);else if(!object(doc)||doc.schemaVersion!==1||!Array.isArray(doc.reports))throw Error();reportMap(doc.reports);}catch(cause){throw fail('READING_REPORTS','Rapor arşivi doğrulanamadığı için okuma kaydı yazılmadı.',cause);}return doc.reports;}
 async function load(dir,name,reports){const f=await optional(dir,name);if(!f)return null;const data=await bytes(f);let doc;try{doc=JSON.parse(decode(data));}catch(cause){throw fail('READING_JSON',name+' okunamıyor; kayıt sıfırlanmadı.',cause);}return {document:validateDocument(doc,reports),bytes:data};}
 async function priorAvailable(dir,reports){try{return !!await load(dir,PREVIOUS,reports);}catch(_){return false;}}
 async function readDocument(dir,reports){const main=await load(dir,MAIN,reports);if(main)return main;if(await optional(dir,PREVIOUS))throw new ReadingError('READING_MISSING','okuma.json eksik; önceki kayıt bulundu. Otomatik sıfırlama yapılmadı.',{recoverable:await priorAvailable(dir,reports)});return null;}
 class Store{
  constructor(dir,doc,data,reports){this.dir=dir;this._document=doc;this._bytes=data;this._reports=reports;this._queue=Promise.resolve();this._valid=true;this._lastError=null;}
  get document(){return clone(this._document);}
  static async open(dir,reports=[]){return lock(async()=>{if(!dir||dir.kind!=='directory')throw fail('READING_FOLDER','Okuma kaydı için bir arşiv klasörü gerekli.');const known=await currentReports(dir,reports);try{const loaded=await readDocument(dir,known);return new Store(dir,loaded?.document||empty(),loaded?.bytes??null,known);}catch(cause){throw new ReadingError(cause.code||'READING_OPEN',cause.message,{cause,recoverable:await priorAvailable(dir,known)});}});}
  static async recover(dir,reports=[]){return lock(async()=>{const known=await currentReports(dir,reports);try{if(await load(dir,MAIN,known))throw fail('READING_HEALTHY','Ana okuma kaydı sağlam; önceki kayda dönülmedi.');}catch(e){if(e.code==='READING_HEALTHY')throw e;}const prior=await load(dir,PREVIOUS,known);if(!prior)throw fail('READING_RECOVERY','Doğrulanmış önceki okuma kaydı bulunamadı.');try{const broken=await optional(dir,MAIN);if(broken)await write(dir,'okuma.bozuk-'+root.crypto.randomUUID()+'.json',await bytes(broken),true);await write(dir,MAIN,prior.bytes);}catch(cause){throw fail('READING_WRITE','Okuma kaydı kurtarılamadı; başarı bildirilmedi.',cause);}return new Store(dir,prior.document,prior.bytes,known);});}
  _enqueue(action){const result=this._queue.then(()=>lock(async()=>{if(!this._valid)throw fail('READING_REOPEN','Önceki okuma yazması tamamlanmadı. Arşivi yeniden açın.');try{const value=await action();this._lastError=null;return value;}catch(e){this._lastError=e;throw e;}}));this._queue=result.catch(()=>{});return result;}
  async flush(){await this._queue;if(this._lastError)throw this._lastError;}
  async _assertCurrent(){const f=await optional(this.dir,MAIN);if(!same(f?await bytes(f):null,this._bytes))throw fail('READING_STALE','Okuma kaydı başka bir oturumda değişti. Üzerine yazılmadı; arşivi yeniden açın.');}
  async _commit(next){await this._assertCurrent();if(!await optional(this.dir,'arsiv.json'))throw fail('READING_REPORTS','Arşiv manifesti eksik; okuma kaydı yazılmadı.');const known=await currentReports(this.dir,this._reports);validateDocument(next,known);if(await optional(this.dir,PREVIOUS))await load(this.dir,PREVIOUS,known);const previous=this._bytes??encoder.encode(JSON.stringify(this._document,null,2)+'\n'),data=encoder.encode(JSON.stringify(next,null,2)+'\n');try{await write(this.dir,PREVIOUS,previous);await this._assertCurrent();await write(this.dir,MAIN,data,this._bytes===null);}catch(cause){this._valid=false;throw fail('READING_WRITE','Okuma değişikliği kaydedilemedi. Başarı bildirilmedi; arşivi yeniden açın. '+cause.message,cause);}this._document=next;this._bytes=data;this._reports=known;}
  _item(next,reportId,create=true){const report=reportMap(this._reports).get(reportId);if(!report)throw fail('READING_REFERENCE','Bu rapor arşivde bulunamadı.');let item=next.items.find(i=>i.reportId===reportId);if(!item&&create){item={reportId,sha256:report.sha256,notes:[],bookmarks:[],position:null};next.items.push(item);}return item;}
  _change(reportId,action){return this._enqueue(async()=>{const known=await currentReports(this.dir,this._reports);validateDocument(this._document,known);this._reports=known;const next=clone(this._document),item=this._item(next,reportId),value=action(item);next.revision++;await this._commit(next);return clone(value);});}
  addNote(reportId,note,quote=''){return this._change(reportId,item=>{const now=new Date().toISOString(),value={id:root.crypto.randomUUID(),text:note,quote,createdAt:now,updatedAt:now};item.notes.push(value);return value;});}
  updateNote(reportId,id,note,quote){return this._change(reportId,item=>{const value=item.notes.find(n=>n.id===id);if(!value)throw fail('READING_NOTE','Düzenlenecek not bulunamadı.');value.text=note;if(quote!==undefined)value.quote=quote;value.updatedAt=new Date().toISOString();return value;});}
  removeNote(reportId,id){return this._change(reportId,item=>{const index=item.notes.findIndex(n=>n.id===id);if(index<0)throw fail('READING_NOTE','Kaldırılacak not bulunamadı.');return item.notes.splice(index,1)[0];});}
  addBookmark(reportId,quote='',headingId='',label=''){return this._change(reportId,item=>{const value={id:root.crypto.randomUUID(),label:label||[...quote].slice(0,100).join('')||'Bölüm işareti',quote,headingId,createdAt:new Date().toISOString()};item.bookmarks.push(value);return value;});}
  removeBookmark(reportId,id){return this._change(reportId,item=>{const index=item.bookmarks.findIndex(b=>b.id===id);if(index<0)throw fail('READING_BOOKMARK','Kaldırılacak işaret bulunamadı.');return item.bookmarks.splice(index,1)[0];});}
  savePosition(reportId,value){return this._change(reportId,item=>{if(!object(value))throw fail('READING_POSITION','Okuma yeri gerekli.');item.position={headingId:value.headingId??'',progress:value.progress,updatedAt:new Date().toISOString()};return item.position;});}
  clearPosition(reportId){return this._change(reportId,item=>{item.position=null;return null;});}
 }
 root.ToreReading=Object.freeze({Store,ReadingError,validateDocument,validator:validateDocument,readDocument,currentReports,MAIN,PREVIOUS});
})(globalThis);
