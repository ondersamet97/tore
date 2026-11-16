/* Töre — kullanıcı tarafından yazılan profil ve görüş kayıtları. */
(function (root) {
  'use strict';
  const MAIN='profiller.json', PREVIOUS='profiller.onceki.json';
  const UUID=/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;
  const encoder=new TextEncoder();
  const copy=value=>JSON.parse(JSON.stringify(value));
  const empty=()=>({schemaVersion:1,revision:0,profiles:[]});
  class ProfileError extends Error {
    constructor(code,message,options={}) {super(message);this.name='ProfileError';this.code=code;this.recoverable=!!options.recoverable;if(options.cause)this.cause=options.cause;}
  }
  const fail=(code,message,cause)=>new ProfileError(code,message,{cause});
  function object(v){return v!==null&&typeof v==='object'&&!Array.isArray(v);}
  function keys(v,list){return object(v)&&Object.keys(v).length===list.length&&list.every(k=>Object.prototype.hasOwnProperty.call(v,k));}
  function text(v,required=false){return typeof v==='string'&&!v.includes('\u0000')&&(!required||!!v.trim());}
  function date(v){return typeof v==='string'&&Number.isFinite(Date.parse(v))&&new Date(v).toISOString()===v;}
  function decode(bytes){try {const value=new TextDecoder('utf-8',{fatal:true}).decode(bytes);if(value.includes('\u0000'))throw Error();return value;}catch(cause){throw fail('PROFILES_ENCODING','Profil kaydı geçerli UTF-8 metni değil; dosya değiştirilmedi.',cause);}}
  function references(values,allowed){return Array.isArray(values)&&values.every(v=>typeof v==='string'&&UUID.test(v)&&allowed.has(v))&&new Set(values).size===values.length;}
  function snapshotFields(view){return {text:view.text,topic:view.topic,area:view.area,kind:view.kind,bridge:view.bridge,sourceIds:view.sourceIds,reportIds:view.reportIds};}
  function sameView(view,snapshot){return JSON.stringify(snapshotFields(view))===JSON.stringify(snapshotFields(snapshot));}
  function reportSet(reports){if(!Array.isArray(reports))throw fail('PROFILE_REPORTS','Profil rapor başvuruları doğrulanamadı.');return new Set(reports.map(report=>report.id));}
  function validateDocument(input,reports=[]) {
    if(!keys(input,['schemaVersion','revision','profiles'])||input.schemaVersion!==1||!Number.isSafeInteger(input.revision)||input.revision<0||!Array.isArray(input.profiles))throw fail('PROFILES_SCHEMA','profiller.json yapısı veya şema sürümü desteklenmiyor. Kayıt sıfırlanmadı.');
    const allIds=new Set(), reportIds=reportSet(reports);let selfCount=0;
    function unique(id){if(typeof id!=='string'||!UUID.test(id)||allIds.has(id))throw fail('PROFILES_ID','Profil kaydında geçersiz veya tekrarlanan kimlik var.');allIds.add(id);}
    for(const profile of input.profiles) {
      if(!keys(profile,['id','kind','name','bio','editor','sources','views','createdAt','updatedAt'])||!['self','thinker'].includes(profile.kind)||!text(profile.name,true)||!text(profile.bio)||!text(profile.editor)||!Array.isArray(profile.sources)||!Array.isArray(profile.views)||!date(profile.createdAt)||!date(profile.updatedAt)||profile.updatedAt<profile.createdAt)throw fail('PROFILE_SCHEMA','Profil bilgileri geçersiz veya eksik.');
      unique(profile.id);if(profile.kind==='self'&&++selfCount>1)throw fail('PROFILE_SELF','Yalnızca bir kendi profiliniz olabilir.');
      const sourceIds=new Set();
      for(const source of profile.sources) {
        if(!keys(source,['id','label','url','reportId'])||!text(source.label,true)||!text(source.url)||!text(source.reportId))throw fail('PROFILE_SOURCE','Kaynağın başlığı, bağlantısı veya rapor bilgisi geçersiz.');
        unique(source.id);sourceIds.add(source.id);
        if(source.reportId&&!reportIds.has(source.reportId))throw fail('PROFILE_REFERENCE','Kaynağın bağlı olduğu rapor arşivde bulunamadı.');
        if(source.url){let url;try{url=new URL(source.url);}catch(_){throw fail('PROFILE_URL','Kaynak bağlantısı geçerli HTTP/HTTPS adresi olmalı.');}if(!/^https?:\/\//i.test(source.url)||!['http:','https:'].includes(url.protocol))throw fail('PROFILE_URL','Kaynak bağlantısında yalnızca HTTP/HTTPS kullanılabilir.');}
        if(!source.url&&!source.reportId)throw fail('PROFILE_SOURCE','Her kaynakta bir HTTP/HTTPS bağlantısı veya arşiv raporu seçin.');
      }
      if(profile.kind==='thinker'&&(!profile.editor.trim()||!profile.sources.length))throw fail('THINKER_SOURCE','Düşünür profili için düzenleyeni ve en az bir kaynağı belirtin.');
      for(const view of profile.views) {
        if(!keys(view,['id','topic','area','text','kind','bridge','sourceIds','reportIds','createdAt','updatedAt','revisions'])||!date(view.createdAt)||!date(view.updatedAt)||view.updatedAt<view.createdAt||!Array.isArray(view.revisions)||!view.revisions.length)throw fail('VIEW_SCHEMA','Görüş kaydının yapısı veya geçmişi geçersiz.');
        unique(view.id);
        const validateFields=value=>{
          if(!text(value.topic,true)||!text(value.text,true)||!text(value.bridge)||!['past','present','future'].includes(value.area)||!['position','prediction','question'].includes(value.kind)||!references(value.sourceIds,sourceIds)||!references(value.reportIds,reportIds))throw fail('VIEW_REFERENCE','Görüşün konusu, türü, zaman alanı veya kaynak/rapor başvuruları geçersiz.');
          if(profile.kind==='thinker'&&!value.sourceIds.length)throw fail('THINKER_VIEW_SOURCE','Her düşünür görüşü için en az bir kaynak seçin.');
        };
        validateFields(view);
        let priorAt=view.createdAt;
        view.revisions.forEach((revision,index)=>{
          if(!keys(revision,['id','text','topic','area','kind','bridge','sourceIds','reportIds','at','reason','changeType'])||!date(revision.at)||revision.at<priorAt||!text(revision.reason)||!['initial','opinion','correction'].includes(revision.changeType)||index===0&&(revision.changeType!=='initial'||revision.at!==view.createdAt)||index>0&&(revision.changeType==='initial'||!revision.reason.trim()))throw fail('VIEW_HISTORY','Görüş geçmişi geçersiz; değişim ile metin düzeltmesi ve gerekçesi korunmalı.');
          unique(revision.id);validateFields(revision);priorAt=revision.at;
        });
        const last=view.revisions[view.revisions.length-1];
        if(last.at!==view.updatedAt||!sameView(view,last))throw fail('VIEW_HISTORY','Güncel görüş son geçmiş kaydıyla eşleşmiyor.');
      }
    }
    return copy(input);
  }
  async function optional(dir,name){try{return await dir.getFileHandle(name);}catch(error){if(error.name==='NotFoundError')return null;throw error;}}
  async function bytes(file){return new Uint8Array(await(await file.getFile()).arrayBuffer());}
  async function write(dir,name,data,mustBeNew=false){
    const old=await optional(dir,name);if(old&&mustBeNew)throw fail('PROFILE_COLLISION',`Mevcut dosyanın üzerine yazılmadı: ${name}`);
    const file=old||await dir.getFileHandle(name,{create:true});let writer;
    try{writer=await file.createWritable();await writer.write(data);await writer.close();writer=null;const saved=await bytes(file);if(saved.length!==data.length||!saved.every((v,i)=>v===data[i]))throw fail('PROFILE_WRITE','Profil dosyasının disk doğrulaması eşleşmedi.');}
    catch(error){if(writer&&writer.abort){try{await writer.abort();}catch(_){}}throw error;}
  }
  async function lock(action){if(root.navigator?.locks?.request)return await root.navigator.locks.request('toru-0.1.1-archive-write',{mode:'exclusive'},action);return await action();}
  async function currentReports(dir,fallback=[]){
    const file=await optional(dir,'arsiv.json');if(!file)return fallback;
    let manifest;try{manifest=JSON.parse(decode(await bytes(file)));}catch(cause){throw fail('PROFILE_REPORTS','Rapor arşivi okunamadığı için profil başvuruları doğrulanamadı.',cause);}
    if(root.ToruStore)manifest=root.ToruStore.validateManifest(manifest);
    else if(!object(manifest)||manifest.schemaVersion!==1||!Array.isArray(manifest.reports)||manifest.reports.some(r=>!r||typeof r.id!=='string'||!UUID.test(r.id)))throw fail('PROFILE_REPORTS','Rapor arşivi doğrulanamadı.');
    return manifest.reports;
  }
  async function load(dir,name,reports){const file=await optional(dir,name);if(!file)return null;const raw=decode(await bytes(file));let value;try{value=JSON.parse(raw);}catch(cause){throw fail('PROFILES_JSON',`${name} geçerli JSON değil. Profil kaydı sıfırlanmadı.`,cause);}return {raw,document:validateDocument(value,reports)};}
  async function priorAvailable(dir,reports){try{return !!await load(dir,PREVIOUS,reports);}catch(_){return false;}}
  async function readDocument(dir,reports){
    const value=await load(dir,MAIN,reports);if(value)return value;
    if(await optional(dir,PREVIOUS))throw new ProfileError('PROFILES_MISSING','profiller.json eksik; önceki kayıt var. Profiller otomatik sıfırlanmadı.',{recoverable:await priorAvailable(dir,reports)});
    return null;
  }
  class ProfileStore {
    constructor(dir,document,raw,reports){this.dir=dir;this._document=document;this._raw=raw;this._reports=reports;this._queue=Promise.resolve();this._valid=true;}
    get document(){return copy(this._document);}
    static async open(dir,reports=[]){return await lock(async()=>{
      if(!dir||dir.kind!=='directory')throw fail('PROFILE_FOLDER','Profil için veri klasörünü seçin.');
      const current=await currentReports(dir,reports);
      try{const loaded=await readDocument(dir,current);return new ProfileStore(dir,loaded?loaded.document:empty(),loaded?loaded.raw:null,current);}
      catch(cause){throw new ProfileError(cause.code||'PROFILES_OPEN',cause.message,{cause,recoverable:await priorAvailable(dir,current)});}
    });}
    static async recover(dir,reports=[]){return await lock(async()=>{
      const current=await currentReports(dir,reports);
      try{const healthy=await load(dir,MAIN,current);if(healthy)throw fail('PROFILES_HEALTHY','Ana profil kaydı sağlam; önceki kayda dönülmedi.');}catch(error){if(error.code==='PROFILES_HEALTHY')throw error;}
      const prior=await load(dir,PREVIOUS,current);if(!prior)throw fail('PROFILES_RECOVERY','Doğrulanmış önceki profil kaydı bulunamadı.');
      try{const broken=await optional(dir,MAIN);if(broken)await write(dir,`profiller.bozuk-${root.crypto.randomUUID()}.json`,await bytes(broken),true);await write(dir,MAIN,encoder.encode(prior.raw));}
      catch(cause){throw fail('PROFILE_WRITE','Profil kaydı kurtarılamadı. Önceki kayıt korundu; başarı bildirilmedi.',cause);}
      return new ProfileStore(dir,prior.document,prior.raw,current);
    });}
    _enqueue(action){const result=this._queue.then(()=>lock(async()=>{if(!this._valid)throw fail('PROFILES_REOPEN','Önceki profil yazması tamamlanmadı. Veri klasörünü yeniden seçin.');return await action();}));this._queue=result.catch(()=>{});return result;}
    async _assertCurrent(){const file=await optional(this.dir,MAIN);const raw=file?decode(await bytes(file)):null;if(raw!==this._raw)throw fail('PROFILES_STALE','Profiller başka bir oturumda değişti. Üzerine yazılmadı; veri klasörünü yeniden seçin.');}
    async _commit(next){
      await this._assertCurrent();if(!await optional(this.dir,'arsiv.json'))throw fail('PROFILE_REPORTS','Rapor arşivi kaydı eksik; profil yazılmadı. Veri klasörünü yeniden seçin.');const reports=await currentReports(this.dir,this._reports);validateDocument(next,reports);
      const oldPrior=await optional(this.dir,PREVIOUS);if(oldPrior)await load(this.dir,PREVIOUS,reports);
      const previous=this._raw===null?JSON.stringify(this._document,null,2)+'\n':this._raw;
      const raw=JSON.stringify(next,null,2)+'\n';
      try{await write(this.dir,PREVIOUS,encoder.encode(previous));await this._assertCurrent();await write(this.dir,MAIN,encoder.encode(raw),this._raw===null);}
      catch(cause){this._valid=false;throw fail('PROFILE_WRITE',`Profil değişikliği kaydedilemedi: ${cause.message} Başarı bildirilmedi; klasörü yeniden seçin.`,cause);}
      this._document=next;this._raw=raw;this._reports=reports;
    }
    async saveProfile(input){return await this._enqueue(async()=>{
      if(!object(input))throw fail('PROFILE_INPUT','Profil bilgilerini girin.');
      const next=copy(this._document),now=new Date().toISOString();
      let profile=input.id?next.profiles.find(p=>p.id===input.id):null;
      if(input.id&&!profile)throw fail('PROFILE_ID','Düzenlenecek profil bulunamadı.');
      const sources=Array.isArray(input.sources)?input.sources.map(s=>({id:s.id||root.crypto.randomUUID(),label:s.label,url:s.url||'',reportId:s.reportId||''})):[];
      if(profile){
        const referenced=new Set();
        for(const view of profile.views){
          for(const id of view.sourceIds)referenced.add(id);
          for(const revision of view.revisions)for(const id of revision.sourceIds)referenced.add(id);
        }
        const contextFile=await optional(this.dir,'degisimler.json');
        if(contextFile){
          if(!root.ToreThoughtTools)throw fail('PROFILE_CONTEXT','Ek değişim bağlamı doğrulanamadığı için profil kaynağı değiştirilemedi.');
          let context;try{context=JSON.parse(decode(await bytes(contextFile)));root.ToreThoughtTools.validateContext(context,await currentReports(this.dir,this._reports),this._document);}catch(cause){throw fail('PROFILE_CONTEXT','Değişim bağlamı doğrulanamadı; profil kaynağına yazılmadı.',cause);}
          for(const item of context.items)for(const id of item.sourceIds)referenced.add(id);
        }
        for(const oldSource of profile.sources){
          if(!referenced.has(oldSource.id))continue;
          const replacement=sources.find(source=>source.id===oldSource.id);
          if(!replacement||['label','url','reportId'].some(key=>replacement[key]!==oldSource[key]))throw fail('PROFILE_SOURCE_HISTORY','Görüşte, geçmişte veya değişim bağlamında kullanılan kaynak değiştirilemez ya da kaldırılamaz. Eski kaynağı koruyup yeni bir kaynak ekleyin; görüşü gerekçesiyle güncelleyerek yeni kaynağı seçin.');
        }
      }
      if(profile)Object.assign(profile,{kind:input.kind,name:input.name,bio:input.bio||'',editor:input.editor||'',sources,updatedAt:now});
      else{profile={id:root.crypto.randomUUID(),kind:input.kind,name:input.name,bio:input.bio||'',editor:input.editor||'',sources,views:[],createdAt:now,updatedAt:now};next.profiles.push(profile);}
      next.revision++;await this._commit(next);return copy(profile);
    });}
    async saveView(profileId,input){return await this._enqueue(async()=>{
      if(!object(input))throw fail('VIEW_INPUT','Görüş bilgilerini girin.');
      const next=copy(this._document),profile=next.profiles.find(p=>p.id===profileId);if(!profile)throw fail('PROFILE_ID','Profil bulunamadı.');
      let view=input.id?profile.views.find(v=>v.id===input.id):null;if(input.id&&!view)throw fail('VIEW_ID','Düzenlenecek görüş bulunamadı.');
      const now=new Date().toISOString(),fields={text:input.text,topic:input.topic,area:input.area,kind:input.kind,bridge:input.bridge||'',sourceIds:input.sourceIds||[],reportIds:input.reportIds||[]};
      const changeType=view?input.changeType:'initial';
      if(view&&(!['opinion','correction'].includes(changeType)||!text(input.reason,true)))throw fail('VIEW_REASON','Güncellemede görüş değişimi veya metin düzeltmesi türünü ve gerekçesini belirtin.');
      const revision={id:root.crypto.randomUUID(),...copy(fields),at:now,reason:input.reason||'',changeType};
      if(view){Object.assign(view,fields,{updatedAt:now});view.revisions.push(revision);}
      else{view={id:root.crypto.randomUUID(),topic:fields.topic,area:fields.area,text:fields.text,kind:fields.kind,bridge:fields.bridge,sourceIds:fields.sourceIds,reportIds:fields.reportIds,createdAt:now,updatedAt:now,revisions:[revision]};profile.views.push(view);}
      profile.updatedAt=now;next.revision++;await this._commit(next);return copy(view);
    });}
  }
  root.ToreProfiles=Object.freeze({ProfileStore,ProfileError,validateDocument,readDocument,currentReports});
})(globalThis);
