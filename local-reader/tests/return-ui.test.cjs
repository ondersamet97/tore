'use strict';
const {test}=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const {JSDOM}=require('jsdom');
const {loadI18n,languageStore,languageOp,UI_OPS}=require('./i18n-helpers.cjs');
const web=path.resolve(__dirname,'../../web'),token='d'.repeat(64),clone=value=>JSON.parse(JSON.stringify(value));
const stamp='2026-11-15T09:00:00Z';
// 0.16: four items in every top bar; Düşünürler sits under Haritam, Arşiv under Konuşmalar.
const MENU=[['Konular','/konular'],['Seni bekleyenler','/konular?gorunum=bekleyenler'],['Haritam','/harita'],['Konuşmalar','/calisma']];
const topic={id:'topic-1',title:'SENTETİK film <img src=x onerror=alert(1)>',goal:'SENTETİK kapsamı koru',createdAt:stamp};
const conversation={id:'conversation-1',title:'SENTETİK kaynak',messages:[{id:'message-1',role:'user',text:'SENTETİK özgün söz. Karakter yalnız mevcut çatışmayı çözsün.'},{id:'message-2',role:'assistant',text:'SENTETİK AI önerisi: karakter yeni bir dünya tasarlasın.'}]};
const record=(id='r1',extra={})=>({id,topicId:topic.id,kind:'decision',text:'SENTETİK kullanıcı kararı',reason:'SENTETİK kapsam gerekçesi',source:null,attribution:'user_authored',review:'reviewed',adoption:'adopted',currency:'current',priority:'active',questionState:'not_applicable',revision:1,history:[],createdAt:stamp,updatedAt:stamp,...extra});
const newStore=records=>({schemaVersion:1,topics:[clone(topic)],records:clone(records||[]),packets:[],replies:[],backups:[],conversationLinks:[],stateHash:'state-0'});
async function flush(){for(let i=0;i<12;i++)await new Promise(resolve=>setImmediate(resolve));}
async function setup(t,options={}){
 const store=options.store||newStore(options.records),requests=[],clipboard=[],backups=new Map(),toolAccess=clone(options.toolAccess||{}),inbox=clone(options.inbox||[]),held=kind=>kind==='question'||kind==='task';let seq=100;
 const dom=new JSDOM(fs.readFileSync(path.join(web,'return.html'),'utf8'),{runScripts:'outside-only',url:'http://127.0.0.1:18740/konular'+(options.query===undefined?'?topicId=topic-1':options.query)+'#local='+token});t.after(()=>dom.window.close());const w=dom.window;
 const scrolls=[];w.HTMLElement.prototype.scrollIntoView=function(o){scrolls.push(o?.behavior);};if(options.reduceMotion!==undefined)w.matchMedia=query=>({matches:/reduce/.test(query)&&options.reduceMotion});Object.defineProperty(w.navigator,'clipboard',{value:{writeText:async value=>clipboard.push(value)}});
 const update=()=>{store.stateHash='state-'+(++seq);};
 // The page asks for the saved interface language first; harnesses default to Turkish.
 const lang=options.lang||languageStore(options.uiLanguage??null);loadI18n(w,['return'],{navigatorLanguage:options.navigatorLanguage||'tr-TR'});
 w.fetch=async(url,request)=>{
  assert.ok(url.startsWith('/api/private/tore/'),'UI yalnız yerel API kullanmalı');assert.equal(request.method,'POST');assert.equal(request.credentials,'omit');assert.equal(request.cache,'no-store');assert.equal(request.headers.Authorization,'Bearer '+token);
  const op=url.split('/').at(-1),body=JSON.parse(request.body);requests.push({op,body});let data;
  const language=languageOp(lang,op,body);if(language!==undefined)return{ok:true,status:200,json:async()=>clone(language)};
  if(options.hold?.op===op)await options.hold.promise;
  if(options.failOp===op)return{ok:false,status:400,json:async()=>({error:'SENTETİK kaynak hatası; metin korunmalı'})};
  switch(op){
   case 'records-list':data=store;break;
   case 'status':if(options.status===undefined)throw Error('Beklenmeyen API: status');data=options.status;break;
   case 'conversation':assert.equal(body.id,conversation.id);data=conversation;break;
   case 'records-topic':{assert.deepEqual(Object.keys(body),['topicId']);const t=store.topics.find(t=>t.id===body.topicId);assert.ok(t);const rs=store.records.filter(r=>r.topicId===t.id);data={topic:t,records:rs,openTasks:rs.filter(r=>r.kind==='task'&&r.questionState==='open'&&r.review!=='rejected'&&r.currency!=='superseded'),toolAccess:toolAccess[t.id]||null};break;}
   case 'records-tool-access':{assert.deepEqual(Object.keys(body).sort(),['confirmedByUser','read','topicId','write']);assert.equal(body.confirmedByUser,true);assert.equal(typeof body.read,'boolean');assert.equal(typeof body.write,'boolean');assert.ok(!(body.write&&!body.read),'öneri izni okuma izni olmadan gönderilemez');assert.ok(store.topics.some(t=>t.id===body.topicId));if(body.read)toolAccess[body.topicId]={read:true,write:body.write,updatedAt:stamp};else delete toolAccess[body.topicId];update();data={topicId:body.topicId,read:body.read,write:body.write};break;}
   case 'records-tool-access-all':{assert.deepEqual(Object.keys(body).sort(),['confirmedByUser','read','write']);assert.equal(body.confirmedByUser,true);assert.ok(!(body.write&&!body.read),'öneri izni okuma izni olmadan gönderilemez');for(const k of Object.keys(toolAccess))delete toolAccess[k];if(body.read)for(const t of store.topics)toolAccess[t.id]={read:true,write:body.write,updatedAt:stamp};update();data={topics:store.topics.length,read:body.read,write:body.write,toolAccess};break;}
   case 'records-trash':case 'records-untrash':case 'records-purge':{assert.equal(body.confirmedByUser,true);if(!store.trash)store.trash=[];if(op==='records-trash'){const i=store.records.findIndex(r=>r.id===body.id);assert.ok(i>=0);assert.equal(body.expectedRevision,store.records[i].revision);const [r]=store.records.splice(i,1);r.trashedAt=stamp;store.trash.push(r);data={record:r,changed:true};}else{const i=store.trash.findIndex(r=>r.id===body.id);assert.ok(i>=0);const [r]=store.trash.splice(i,1);if(op==='records-untrash'){delete r.trashedAt;store.records.push(r);data={record:r,changed:true};}else data={purged:r.id,backupId:'backup-purge'};}update();break;}
   case 'inbox':assert.deepEqual(body,{});data={items:inbox.map(item=>{const r=item.relatesTo&&store.records.find(r=>r.id===item.relatesTo);return{item,topicTitle:store.topics.find(t=>t.id===item.topicId).title,related:r?{id:r.id,kind:r.kind,text:r.text}:null,basisRecord:(b=>b?{id:b.id,kind:b.kind,text:b.text,quoteFound:b.text.includes(item.basis.quote)}:null)(item.basis&&store.records.find(r=>r.id===item.basis.source&&r.topicId===item.topicId))};}),toolAccess};break;
   case 'inbox-accept':{assert.deepEqual(Object.keys(body).sort(),['confirmedByUser','itemId']);assert.equal(body.confirmedByUser,true);const i=inbox.findIndex(x=>x.id===body.itemId);assert.ok(i>=0,'öneri bekliyor olmalı');const [item]=inbox.splice(i,1),kind=item.kind==='note'||item.kind==='objection'?'opinion':item.kind;const r=record('record-'+(++seq),{topicId:item.topicId,kind,text:item.text,reason:'',attribution:'assistant_proposal',review:'pending',adoption:held(kind)?'not_applicable':'unknown',currency:'unknown',priority:'unspecified',questionState:held(kind)?'open':'not_applicable',source:{kind:'tool',id:'tool:'+item.id,provider:'mcp',role:'assistant',title:item.tool}});store.records.push(r);update();data={record:r,mapEntryId:null};break;}
   case 'inbox-dismiss':{assert.deepEqual(Object.keys(body).sort(),['confirmedByUser','itemId']);assert.equal(body.confirmedByUser,true);const i=inbox.findIndex(x=>x.id===body.itemId);assert.ok(i>=0);inbox.splice(i,1);data={dismissed:true};break;}
   case 'records-topic-create':{const t={id:'topic-'+(++seq),title:body.title,goal:body.goal,createdAt:stamp};store.topics.push(t);update();data={topic:t};break;}
   case 'records-create':{
    assert.match(body.requestId,/^[0-9a-f-]{36}$/);let source=null;
    if(body.source?.conversationId){const m=conversation.messages.find(m=>m.id===body.source.messageId);assert.ok(m.text.includes(body.source.excerpt));source={...body.source,id:'source:'+m.id,kind:'conversation',title:conversation.title,role:m.role,provider:'synthetic'};}
    if(body.source?.replyId){const reply=store.replies.find(r=>r.id===body.source.replyId);assert.notEqual(reply.validationStatus,'invalid');assert.ok(reply.commentary.includes(body.source.excerpt));source={...body.source,id:'reply:'+reply.id,kind:'reply',title:'SENTETİK AI yorumu',role:'assistant',provider:'synthetic'};}
    const r=record('record-'+(++seq),{topicId:body.topicId,kind:body.kind,text:body.text,reason:body.reason,source,attribution:source?.role==='assistant'?'assistant_proposal':source?'user_statement':'user_authored',review:'pending',adoption:held(body.kind)?'not_applicable':'unknown',currency:'unknown',priority:'unspecified',questionState:held(body.kind)?'open':'not_applicable',answersQuestionId:body.answersQuestionId||null});store.records.push(r);update();data={record:r};break;
   }
   case 'records-review':{
    if(options.moveDuringReview){store.records.find(r=>r.id===body.id).topicId='topic-2';return{ok:false,status:409,json:async()=>({error:'Kaydın konusu değişmiş; incelemeden önce yeniden yükleyin'})};}
    assert.equal(body.requestId,undefined,'Review API strict sözleşmesi');assert.equal(body.confirmedByUser,true);const r=store.records.find(r=>r.id===body.id);assert.equal(body.expectedRevision,r.revision);assert.equal(body.expectedTopicId,r.topicId);assert.ok(body.changeReason.trim());r.history.push({...clone(r),changeReason:body.changeReason,changedAt:stamp});for(const k of ['text','reason','review','adoption','currency','priority','questionState'])r[k]=body[k];r.revision++;update();data={record:r};break;
   }
   case 'records-prepare':{
    assert.equal(body.confirmedByUser,true);const selected=[...body.recordIds,...body.proposalIds].map(id=>store.records.find(r=>r.id===id));const packet={id:'packet-'+(++seq),topicId:body.topicId,target:body.target,model:body.model,text:'SENTETİK devam metni\n'+selected.map(r=>r.text+'\nKaynak: '+(r.source?.id||r.id)).join('\n'),sourceIds:selected.map(r=>r.source?.id||r.id),sources:selected.map(r=>({sourceId:r.source?.id||r.id,recordId:r.id,revision:r.revision,quote:r.source?.excerpt||r.text})),recordIds:body.recordIds,proposalIds:body.proposalIds,createdAt:stamp,hash:'packet-hash'};store.packets.push(packet);update();data={packet,findings:[]};break;
   }
   case 'records-share':{assert.deepEqual(Object.keys(body).sort(),['confirmedByUser','packetId','shared']);assert.equal(body.confirmedByUser,true);assert.equal(typeof body.shared,'boolean');const p=store.packets.find(p=>p.id===body.packetId);assert.ok(p);const changed=(p.sharedWithTools===true)!==body.shared;if(body.shared)p.sharedWithTools=true;else delete p.sharedWithTools;if(changed)update();data={packet:clone(p),shared:body.shared,changed};break;}
   case 'records-reply':{
    assert.equal(body.confirmedByUser,true);const packet=store.packets.find(p=>p.id===body.packetId);let commentary=body.rawText,validationStatus='unverified',validationError=null;
    if(body.format==='json'){try{const parsed=JSON.parse(body.rawText);assert.equal(typeof parsed.commentary,'string');assert.ok(Array.isArray(parsed.citations));for(const c of parsed.citations)assert.ok(packet.sources.some(s=>s.sourceId===c.sourceId&&s.quote.includes(c.quote)));commentary=parsed.commentary;validationStatus='valid';}catch{commentary='';validationStatus='invalid';validationError='SENTETİK JSON veya kaynak atfı geçersiz.';}}
    const reply={id:'reply-'+(++seq),packetId:packet.id,topicId:packet.topicId,rawText:body.rawText,commentary,format:body.format,validationStatus,validationError,createdAt:stamp};store.replies.push(reply);update();data={reply};break;
   }
   case 'records-backup':{const id='backup-'+(++seq);backups.set(id,clone(store));store.backups.push({id,backupId:id,createdAt:stamp,valid:true});data={backupId:id,stateHash:store.stateHash};break;}
   case 'records-restore':{assert.equal(body.confirmedByUser,true);assert.equal(body.expectedStateHash,store.stateHash);const snapshot=backups.get(body.backupId);assert.ok(snapshot);for(const k of ['topics','records','packets','replies'])store[k]=clone(snapshot[k]);for(const k of Object.keys(toolAccess))delete toolAccess[k];update();data={restored:true,backupId:body.backupId,stateHash:store.stateHash};break;}
   case 'records-bulk-preview':data=options.bulkPreview||{previewHash:'bulk-preview-hash',stateHash:store.stateHash,sourceHash:'synthetic-source-hash',ruleVersion:1,conversationCount:2,linkedCount:2,candidateCount:1,alreadyLinked:0,topics:[{id:topic.id,title:'SENTETİK film',conversationCount:2,newLinkCount:2,candidateCount:1}],warnings:['Yerel kuralla önerildi.']};break;
   case 'records-bulk-apply':assert.deepEqual(body,{previewHash:'bulk-preview-hash',confirmedByUser:true});store.conversationLinks.push({id:'new-link',topicId:topic.id,conversationId:conversation.id,title:'SENTETİK toplu bağlantı',provider:'chatgpt',sourceCreatedAt:stamp,sourceUpdatedAt:stamp,lastUserSource:{conversationId:conversation.id,messageId:'message-1',excerpt:conversation.messages[0].text,role:'user',timestamp:stamp},classificationReason:'Başlıkta sentetik konu'});store.records.push(record('bulk-question',{kind:'question',source:{role:'user',conversationId:conversation.id,messageId:'message-1',excerpt:'SENTETİK soru?',timestamp:stamp},text:'SENTETİK soru?',review:'pending',adoption:'not_applicable',currency:'unknown',priority:'unspecified',questionState:'open'}));update();data={linked:2,candidatesCreated:1,topicsCreated:0,backupId:'bulk-backup',stateHash:store.stateHash,alreadyApplied:false};break;
   case 'records-migration-preview':data={previewHash:'legacy-hash',candidates:[record('legacy-1',{currency:'unknown',priority:'unspecified',text:'SENTETİK eski onaylı görüş'})],alreadyImported:[],count:1};break;
   case 'records-migration-apply':assert.deepEqual(body,{previewHash:'legacy-hash',confirmedByUser:true});store.records.push(record('legacy-1',{currency:'unknown',priority:'unspecified'}));update();data={imported:1,skipped:0,backupId:'migration-backup'};break;
   default:throw Error('Beklenmeyen API: '+op);
  }
  return{ok:true,status:200,json:async()=>clone(data)};
 };
 w.eval(fs.readFileSync(path.join(web,'private-client.js'),'utf8').replace(/^export /gm,''));w.eval(fs.readFileSync(path.join(web,'return.js'),'utf8').replace(/^import .*;\n/,''));await flush();
 const $=id=>w.document.getElementById(id),click=async target=>{(typeof target==='string'?$(target):target).click();await flush();};
 const change=async(id,value)=>{const el=typeof id==='string'?$(id):id;el.value=value;el.dispatchEvent(new w.Event(el.tagName==='SELECT'?'change':'input',{bubbles:true}));await flush();};
 const check=async(id,yes=true)=>{const el=typeof id==='string'?$(id):id;if(el.checked!==yes)await click(el);};
 const edit=async id=>{await click('view-all');await click(w.document.querySelector('[data-edit-record="'+id+'"]'));};
 const prepare=async()=>{await click('context-open');await click('context-prepare');};
 const ops=()=>requests.map(r=>r.op).filter(op=>op!=='records-topic'&&op!=='inbox'&&!UI_OPS.has(op)),sent=op=>requests.filter(r=>r.op===op).map(r=>r.body),badges=root=>[...root.querySelectorAll('[data-status]')].map(e=>e.textContent);
 return{w,$,click,change,check,edit,prepare,requests,clipboard,store,toolAccess,inbox,ops,sent,badges,scrolls,lang};
}

test('konuya dönüş yalnız yerel depoyu okur; eski karar ve AI önerisi güncel kullanıcı kararı olmaz',async t=>{
 const h=await setup(t,{records:[record(),record('old',{text:'SENTETİK ESKİ KARAR',currency:'superseded'}),record('ai',{text:'SENTETİK BENİMSENMEMİŞ AI',attribution:'assistant_proposal',adoption:'hypothesis'}),record('pending',{text:'SENTETİK İNCELENMEMİŞ',review:'pending'})]});
 assert.deepEqual(h.ops(),['records-list']);assert.equal(h.$('record-list').textContent.includes('ESKİ KARAR'),false);assert.equal(h.$('record-list').textContent.includes('BENİMSENMEMİŞ AI'),false);assert.equal(h.$('pending-count').textContent,'1');assert.equal(h.w.document.querySelector('img,[onerror]'),null);assert.match(h.$('topic-title').textContent,/<img/);assert.equal(h.w.localStorage.length,0);assert.equal(h.w.location.hash,'');
 await h.click('view-all');assert.match(h.$('record-list').textContent,/ESKİ KARAR/);assert.ok(h.badges(h.$('record-list')).includes('eskidi'));
});

test('mesaj alıntısı kaynak kimlikleriyle aday olur; kaynak dışı ifade reddedilir ve metin kaybolmaz',async t=>{
 const h=await setup(t,{query:'?conversationId=conversation-1&messageId=message-1'});assert.equal(h.$('record-editor').hidden,false);assert.equal(h.$('source-original').textContent,conversation.messages[0].text);assert.match(h.$('source-backlink').href,/conversationId=conversation-1&messageId=message-1/);
 await h.change('record-excerpt','SENTETİK kaynakta yok');await h.click('record-save');assert.match(h.$('record-error').textContent,/birebir/);assert.equal(h.$('record-excerpt').value,'SENTETİK kaynakta yok');assert.equal(h.requests.some(r=>r.op==='records-create'),false);
 await h.change('record-excerpt','Karakter yalnız mevcut çatışmayı çözsün.');await h.change('record-text','SENTETİK film kapsamı');await h.change('record-kind','decision');await h.click('record-save');const payload=h.requests.find(r=>r.op==='records-create').body;assert.deepEqual(payload.source,{conversationId:'conversation-1',messageId:'message-1',excerpt:'Karakter yalnız mevcut çatışmayı çözsün.'});assert.equal(payload.adoption,undefined);assert.equal(h.store.records[0].review,'pending');assert.equal(h.store.records[0].currency,'unknown');
});

test('ayrıntılı inceleme dört durumu bağımsız gönderir; gerekçe isteğe bağlıdır ve önceki hâl görünür',async t=>{
 const h=await setup(t,{records:[record('draft',{review:'pending',adoption:'unknown',currency:'unknown',priority:'unspecified'})]});await h.edit('draft');await h.change('record-review','reviewed');await h.change('record-adoption','hypothesis');await h.change('record-currency','current');await h.change('record-priority','not_priority');await h.change('record-text','SENTETİK düzeltilen ihtimal');await h.click('record-save');
 const first=h.sent('records-review')[0];assert.equal(first.changeReason,'İnceledim.','boş gerekçe varsayılanla gider');assert.equal(first.adoption,'hypothesis');assert.equal(first.currency,'current');assert.equal(first.priority,'not_priority');assert.equal(first.review,'reviewed');assert.equal(first.confirmedByUser,true);assert.equal(h.$('record-editor').hidden,true);assert.match(h.$('record-result').textContent,/Kaydedildi/);
 await h.edit('draft');assert.equal(h.$('record-text').value,'SENTETİK düzeltilen ihtimal');await h.change('record-currency','superseded');await h.change('record-change-reason','SENTETİK yalnız ihtimal olarak tartışıldı.');await h.click('record-save');assert.equal(h.sent('records-review')[1].changeReason,'SENTETİK yalnız ihtimal olarak tartışıldı.');
 await h.edit('draft');assert.match(h.$('history-list').textContent,/SENTETİK kullanıcı kararı/);assert.match(h.$('history-list').textContent,/yalnız ihtimal/);assert.doesNotMatch(h.$('history-list').textContent,/v\d/);
});

test('devam seçimi eski ve incelenmemiş kayıtları dışlar; AI önerileri açık ek seçim ister',async t=>{
 const h=await setup(t,{records:[record(),record('old',{currency:'superseded'}),record('pending',{review:'pending'}),record('ai',{attribution:'assistant_proposal',adoption:'uncertain',text:'SENTETİK AI ÖNERİSİ'}),record('paused',{priority:'paused'})]});await h.click('context-open');assert.equal(h.w.document.querySelector('[data-context-record="old"]'),null);assert.equal(h.w.document.querySelector('[data-context-record="pending"]'),null);assert.equal(h.w.document.querySelector('[data-context-record="ai"]'),null);assert.equal(h.w.document.querySelector('[data-context-record="paused"]').checked,false);
 await h.check('context-include-ai');const ai=h.w.document.querySelector('[data-context-record="ai"]');assert.equal(ai.checked,false);assert.match(h.$('context-records').textContent,/BENİMSENMEMİŞ AI ÖNERİSİ/);await h.check(ai);await h.change('context-target','gemini');await h.click('context-prepare');const req=h.requests.find(r=>r.op==='records-prepare').body;assert.deepEqual(req.recordIds,['r1']);assert.deepEqual(req.proposalIds,['ai']);assert.equal(req.target,'gemini');assert.equal(h.clipboard.length,0);assert.equal(h.$('context-copy').disabled,true);assert.equal(h.$('context-service-link').hidden,true);
 await h.check('context-consent');await h.click('context-copy');assert.equal(h.clipboard.length,1);assert.equal(h.clipboard[0],h.$('context-prompt').textContent);assert.equal(h.$('context-service-link').href,'https://gemini.google.com/');await h.change('context-target','claude');assert.equal(h.$('context-preview').hidden,true);assert.equal(h.$('context-consent').checked,false);assert.equal(h.$('context-copy').disabled,true);
});

test('düz AI yanıtı önce yorumdur; ayrıca seçilen alıntı inceleme bekleyen AI önerisi olur',async t=>{
 const h=await setup(t,{records:[record()]});await h.prepare();assert.equal(h.$('reply-save').disabled,true,'boş yanıt kaydedilemez');await h.change('reply-text','SENTETİK <script>window.bad=true</script> yeni AI yorumu.');assert.equal(h.$('reply-consent'),null);assert.equal(h.$('reply-save').disabled,false);await h.click('reply-save');assert.equal(h.sent('records-reply')[0].confirmedByUser,true);assert.equal(h.store.records.length,1);assert.equal(h.store.replies[0].validationStatus,'unverified');assert.equal(h.w.bad,undefined);assert.equal(h.w.document.querySelector('script:not([src])'),null);await h.click(h.w.document.querySelector('[data-reply-candidate]'));await h.change('record-excerpt','yeni AI yorumu.');await h.change('record-text','SENTETİK incelemek istediğim öneri');await h.click('record-save');const r=h.store.records.at(-1);assert.equal(r.attribution,'assistant_proposal');assert.equal(r.review,'pending');assert.equal(r.adoption,'unknown');assert.equal(r.currency,'unknown');assert.equal(r.source.excerpt,'yeni AI yorumu.');
});

test('bozuk JSON kalıcı AI yorumunda ve girişte tutulur; kaynak kontrolü gevşetilmez',async t=>{
 const h=await setup(t,{records:[record()]});await h.prepare();await h.change('reply-format','json');const raw='{"commentary":"SENTETİK kesilmiş yanıt",';await h.change('reply-text',raw);await h.click('reply-save');assert.equal(h.$('reply-text').value,raw);assert.equal(h.store.replies[0].rawText,raw);assert.equal(h.store.replies[0].validationStatus,'invalid');assert.match(h.$('reply-error').textContent,/kaynak atfı geçersiz/);assert.equal(h.w.document.querySelector('[data-reply-candidate]'),null);
 const reopened=await setup(t,{store:h.store});assert.match(reopened.$('commentary-list').textContent,/kesilmiş yanıt/);assert.equal(reopened.w.document.querySelector('[data-reply-candidate]'),null);assert.deepEqual(reopened.ops(),['records-list']);await reopened.click(reopened.$('commentary-list').querySelector('button'));assert.equal(reopened.$('reply-text').value,raw);
 await reopened.change('reply-text',JSON.stringify({commentary:'SENTETİK uydurma alıntı',citations:[{sourceId:'r1',quote:'kaynakta yok'}]}));await reopened.click('reply-save');assert.equal(reopened.store.replies.at(-1).validationStatus,'invalid');assert.equal(reopened.w.document.querySelector('[data-reply-candidate]'),null);
});

test('kaynaklı JSON yorumu aday olabilir; kullanıcı mevcut görüşü otomatik değişmez',async t=>{
 const h=await setup(t,{records:[record()]});await h.prepare();await h.change('reply-format','json');await h.change('reply-text',JSON.stringify({commentary:'SENTETİK yeni yorum',citations:[{sourceId:'r1',quote:'SENTETİK kullanıcı kararı'}]}));await h.click('reply-save');assert.equal(h.store.replies[0].validationStatus,'valid');assert.equal(h.store.records[0].text,'SENTETİK kullanıcı kararı');assert.ok(h.w.document.querySelector('[data-reply-candidate]'));assert.match(h.$('commentary-list').textContent,/yorumun doğruluğu onaylanmadı/);
});

test('yanıt adayı soruyu açık tutar; soru ancak gerekçeli kapatma seçimiyle kapanır',async t=>{
 const h=await setup(t,{records:[record('question',{kind:'question',adoption:'not_applicable',questionState:'open',text:'SENTETİK sınır nerede?'})]});await h.click(h.$('open-questions-list').querySelector('.secondary'));await h.change('record-text','SENTETİK yanıt adayı');await h.click('record-save');assert.equal(h.store.records.at(-1).answersQuestionId,'question');assert.equal(h.store.records[0].questionState,'open');
 await h.edit('question');assert.equal(h.$('adoption-field').hidden,true);assert.equal(h.$('question-close-consent').checked,false);await h.change('record-change-reason','SENTETİK soru incelendi');await h.click('record-save');assert.equal(h.store.records[0].questionState,'open');await h.edit('question');assert.equal(h.$('question-close-apply').textContent,'Soruyu kapat');assert.equal(h.$('question-close-apply').disabled,true,'kapatma açık onay ister');await h.check('question-close-consent');assert.equal(h.$('question-close-apply').disabled,false);await h.change('record-change-reason','SENTETİK yanıt yeterli');await h.click('question-close-apply');assert.match(h.$('record-error').textContent,/kapatma gerekçeni/);assert.equal(h.store.records[0].questionState,'open');await h.change('question-close-reason','SENTETİK kararımı verdim');await h.click('question-close-apply');assert.equal(h.store.records[0].questionState,'closed');assert.equal(h.store.records[0].adoption,'not_applicable');assert.match(h.store.records[0].history.at(-1).changeReason,/kararımı verdim/);
});

test('eski görüş geçişi önizleme ve ayrı onay ister; onay güncellik sayılmaz',async t=>{
 const h=await setup(t);assert.equal(h.requests.some(r=>r.op.includes('migration')),false);await h.click('migration-preview');assert.match(h.$('migration-list').textContent,/Benimseme: Benimsedim/);assert.match(h.$('migration-list').textContent,/Güncellik: Belirtilmedi/);assert.equal(h.$('migration-apply').disabled,true);await h.check('migration-consent');await h.click('migration-apply');assert.equal(h.requests.filter(r=>r.op==='records-migration-apply').length,1);assert.equal(h.store.records[0].currency,'unknown');assert.equal(h.$('record-list').querySelector('[data-record-id="legacy-1"]'),null);
});

test('yedek geri yükleme açık onay ve güncel durum hash gerektirir',async t=>{
 const h=await setup(t,{records:[record()]});await h.click('backup-create');const backup=h.$('restore-backup').value;assert.match(backup,/backup-/);await h.edit('r1');await h.change('record-text','SENTETİK sonradan değiştirdim');await h.change('record-change-reason','SENTETİK yeni bilgi');await h.click('record-save');assert.equal(h.$('restore-apply').disabled,true);await h.check('restore-consent');await h.click('restore-apply');assert.equal(h.store.records[0].text,'SENTETİK kullanıcı kararı');assert.equal(h.requests.filter(r=>r.op==='records-restore').length,1);assert.equal(h.$('restore-consent').checked,false);
});

test('farklı devam paketi önceki yanıt metnini sessizce kendine bağlamaz',async t=>{
 const h=await setup(t,{records:[record()]});await h.prepare();const packet=h.store.packets[0];await h.change('reply-text','SENTETİK birinci pakete ait taslak');await h.change('context-question','SENTETİK yeni devam sorusu');await h.click('context-prepare');assert.equal(h.$('reply-text').value,'');await h.click('context-open');const old=h.store.packets.find(p=>p.id===packet.id);assert.ok(old);h.store.packets=[old];await h.click('reload');await h.click(h.w.document.querySelector('[data-saved-packet]'));assert.equal(h.$('reply-text').value,'SENTETİK birinci pakete ait taslak');
});

test('sunucu hatasında aday ifadesi ve kaynak alıntısı saklı kalır',async t=>{
 const h=await setup(t,{query:'?conversationId=conversation-1&messageId=message-2',failOp:'records-create'});await h.change('record-excerpt','karakter yeni bir dünya tasarlasın.');await h.change('record-text','SENTETİK ayrı yorum');await h.click('record-save');assert.match(h.$('record-error').textContent,/kaynak hatası/);assert.equal(h.$('record-text').value,'SENTETİK ayrı yorum');assert.equal(h.$('record-excerpt').value,'karakter yeni bir dünya tasarlasın.');assert.match(h.$('record-attribution').textContent,/AI yanıtı/);assert.equal(h.$('record-save').disabled,false);
});

test('paket ve yorum listesi UUID yerine zamana göre sıralanır; her paket ayrı seçilebilir',async t=>{
 const store=newStore([record()]);const old={id:'zzz-old',topicId:topic.id,target:'chatgpt',recordIds:['r1'],proposalIds:[],sources:[{recordId:'r1',revision:1}],sourceIds:['r1'],text:'SENTETİK eski bağlam',createdAt:'2026-11-14T08:00:00Z'};const recent={...old,id:'aaa-recent',text:'SENTETİK yeni bağlam',createdAt:'2026-11-15T10:00:00Z'};const sameTime={...recent,id:'bbb-same-time',text:'SENTETİK aynı zaman ayrı bağlam'};store.packets=[recent,sameTime,old];store.replies=[{id:'new-reply',topicId:topic.id,packetId:recent.id,commentary:'SENTETİK yeni yorum',validationStatus:'unverified',createdAt:recent.createdAt},{id:'old-reply',topicId:topic.id,packetId:old.id,commentary:'SENTETİK eski yorum',validationStatus:'unverified',createdAt:old.createdAt}];
 const h=await setup(t,{store});assert.deepEqual([...h.w.document.querySelectorAll('[data-saved-packet]')].map(e=>e.dataset.savedPacket),['aaa-recent','bbb-same-time','zzz-old']);assert.deepEqual([...h.w.document.querySelectorAll('[data-reply-id]')].map(e=>e.dataset.replyId),['new-reply','old-reply']);await h.click(h.w.document.querySelector('[data-saved-packet="zzz-old"]'));assert.equal(h.$('context-prompt').textContent,'SENTETİK eski bağlam');assert.equal(h.$('context-consent').checked,false);
});

test('konuşma arayüzü yalnız görünür mesaj için kimlik bağlantısı verir; kaynak dalını geri açar',async t=>{
 const c={id:'source-c',title:'SENTETİK dallı konuşma',provider:'openai',sourceApp:'synthetic',selectedLeafId:'other',warnings:[],messages:[{id:'root',role:'user',text:'SENTETİK ortak kaynak',parentId:null},{id:'target',role:'assistant',text:'SENTETİK seçilen kaynak',parentId:'root'},{id:'other',role:'assistant',text:'SENTETİK başka dal',parentId:'root'}]};const requests=[];
 const dom=new JSDOM(fs.readFileSync(path.join(web,'workspace.html'),'utf8'),{runScripts:'outside-only',url:'http://127.0.0.1:18740/calisma?conversationId=source-c&messageId=target#local='+token});t.after(()=>dom.window.close());const w=dom.window;w.HTMLElement.prototype.scrollIntoView=function(){};loadI18n(w,['workspace']);
 w.fetch=async(url,request)=>{assert.ok(url.startsWith('/api/private/tore/'));const op=url.split('/').at(-1);if(UI_OPS.has(op))return{ok:true,status:200,json:async()=>languageOp(languageStore(),op,JSON.parse(request.body))};requests.push(op);const result=op==='status'?{developers:[]}:op==='list'?{conversations:[c]}:op==='catalog'?{models:[]}:op==='drafts'?{drafts:[],receipts:[]}:op==='conversation'?c:null;assert.ok(result,op);return{ok:true,status:200,json:async()=>clone(result)};};
 w.eval(fs.readFileSync(path.join(web,'private-client.js'),'utf8').replace(/^export /gm,''));w.eval(fs.readFileSync(path.join(web,'workspace.js'),'utf8').replace(/^import .*;\n/,''));await flush();
 assert.equal(w.document.getElementById('branch-leaf').value,'target');assert.deepEqual([...w.document.querySelectorAll('[data-message-id]')].map(e=>e.dataset.messageId),['root','target']);const link=w.document.querySelector('[data-source-record="target"]');assert.equal(link.getAttribute('href'),'/konular?conversationId=source-c&messageId=target');assert.equal(link.href.includes('SENTET'),false);assert.equal(w.document.activeElement.dataset.messageId,'target');assert.equal(requests.includes('send'),false);
});

test('statik hizmet seçenekleri Rust API hedef sözleşmesiyle aynıdır; Gemini adı google diye gönderilmez',async t=>{
 const dom=new JSDOM(fs.readFileSync(path.join(web,'return.html'),'utf8'));t.after(()=>dom.window.close());
 const options=[...dom.window.document.querySelectorAll('#context-target option')];
 const rust=fs.readFileSync(path.resolve(web,'../server/src/workspace/records.rs'),'utf8');
 const allowed=rust.match(/\[\s*((?:"[a-z]+",?\s*)+)\]\s*\.contains\(&r\.target\.as_str\(\)\)/);assert.ok(allowed,'Rust Prepare hedef kontrolü bulunmalı');
 const contract=[...allowed[1].matchAll(/"([a-z]+)"/g)].map(m=>m[1]);assert.deepEqual(options.map(o=>o.value).sort(),contract.sort());
 assert.equal(options.find(o=>o.textContent==='Google Gemini').value,'gemini');assert.equal(options.some(o=>o.value==='google'),false);
 const h=await setup(t,{records:[record()]});await h.click('context-open');await h.change('context-target','gemini');await h.click('context-prepare');assert.equal(h.requests.find(r=>r.op==='records-prepare').body.target,'gemini');assert.match(h.$('context-target-label').textContent,/Google Gemini/);
 for(const target of ['qwen','mistral','openrouter','xai']){await h.change('context-target',target);await h.click('context-prepare');assert.equal(h.requests.filter(r=>r.op==='records-prepare').at(-1).body.target,target);await h.check('context-consent');if(target==='openrouter')assert.equal(h.$('context-service-link').hidden,true);else assert.match(h.$('context-service-link').href,/^https:\/\//);}
});


test('eski onaylılar ve kaynak adayları varsayılan konu görünümünde görünür; güncel karar veya açık soru sayılmaz',async t=>{
 const source={conversationId:conversation.id,messageId:'message-1',role:'user',excerpt:'SENTETİK önceki söz',timestamp:'2025-01-01T00:00:00Z'};
 const h=await setup(t,{records:[record('legacy-approved',{kind:'opinion',text:'SENTETİK ÖNCEKİ ONAY',currency:'unknown',priority:'unspecified',legacy:{status:'confirmed'},source}),record('question-candidate',{kind:'question',text:'SENTETİK ESKİ SORU',review:'pending',adoption:'not_applicable',currency:'unknown',questionState:'open',source}),record('unreviewed-ai',{text:'SENTETİK AI ÇIKARIMI',review:'pending',adoption:'unknown',currency:'unknown',attribution:'assistant_proposal',source:{...source,role:'assistant'}})]});
 assert.equal(h.$('prior-approved-panel').hidden,false);assert.match(h.$('prior-approved-list').textContent,/ÖNCEKİ ONAY/);assert.ok(h.badges(h.$('prior-approved-list')).includes('güncellik belirtilmedi'));
 assert.equal(h.$('source-candidates-panel').hidden,false);assert.ok(h.badges(h.$('source-candidates-list')).includes('Soru'));assert.ok(h.badges(h.$('source-candidates-list')).includes('inceleme bekliyor'));assert.ok(h.badges(h.$('source-candidates-list')).includes('açık mı, incelenecek'));assert.match(h.$('source-candidates-list').textContent,/AI önerisi/);
 assert.match(h.$('topic-summary').textContent,/0 güncel karar · 0 güncel görüş · 0 açık soru/);assert.equal(h.$('open-questions-panel').hidden,true);
 await h.click('view-pending');assert.ok(h.badges(h.$('record-list')).includes('açık mı, incelenecek'));assert.equal(h.badges(h.$('record-list')).includes('açık'),false);
 await h.click('context-open');assert.equal(h.$('context-records').querySelector('input'),null);assert.deepEqual(h.ops(),['records-list']);
 await h.click(h.w.document.querySelector('[data-overview-edit="legacy-approved"]'));assert.equal(h.$('record-currency').value,'unknown');assert.equal(h.$('record-adoption').value,'adopted');
});

test('konu bağlantıları kaynak zamanına göre sıralanır, bilinmeyen zaman uydurulmaz ve yalnız kimliklerle kaynağa döner',async t=>{
 const store=newStore([]),source={id:'source-1',kind:'conversation',conversationId:conversation.id,messageId:'message-1',excerpt:'SENTETİK <img src=x onerror=alert(1)> son söz',role:'user',timestamp:'2024-04-01T10:00:00Z'};
 store.conversationLinks=[{id:'unknown',topicId:topic.id,conversationId:'old-id',title:'SENTETİK zamanı bilinmeyen',provider:'claude',sourceCreatedAt:null,sourceUpdatedAt:null,lastUserSource:null,classificationReason:'Başlık kuralı',linkedAt:'2026-11-15T09:00:00Z',warning:'Dal seçilmemiş; aday çıkarılmadı.'},{id:'known',topicId:topic.id,conversationId:conversation.id,title:'SENTETİK kaynak başlığı',provider:'chatgpt',sourceCreatedAt:'2024-01-01T00:00:00Z',sourceUpdatedAt:source.timestamp,lastUserSource:source,classificationReason:'Başlık kuralı',linkedAt:stamp}];
 const h=await setup(t,{store});assert.equal(h.$('topic-conversations-panel').hidden,false);assert.deepEqual([...h.w.document.querySelectorAll('[data-conversation-link]')].map(e=>e.dataset.conversationLink),['known','unknown']);assert.match(h.$('topic-conversation-list').textContent,/Tarih belirtilmedi/);assert.match(h.$('topic-conversation-list').textContent,/Dal seçilmemiş/);assert.equal(h.w.document.querySelector('img,[onerror]'),null);
 const a=h.w.document.querySelector('[data-conversation-link="known"] a');assert.equal(a.getAttribute('href'),'/calisma?conversationId=conversation-1&messageId=message-1');assert.equal(a.href.includes('SENTETİK'),false);assert.match(h.$('topic-list').textContent,/2 konuşma/);
 await h.click(h.w.document.querySelector('[data-link-candidate="known"]'));assert.equal(h.$('record-excerpt').value,source.excerpt);assert.equal(h.$('record-text').value,source.excerpt);assert.equal(h.$('record-detail').hidden,true);assert.equal(h.$('quick-review').hidden,true);assert.equal(h.$('record-save-adopt').hidden,true,'kaynaklı söz tek adımda benimsenmez');
});

test('büyük konu bağlantıları yirmilik gösterilir, arama kapsamı görünür ve onaylı geçmiş adayları sekizlik açılır',async t=>{
 const store=newStore(Array.from({length:12},(_,i)=>record('legacy-'+i,{currency:'unknown',source:{role:'user',timestamp:stamp},createdAt:stamp})));store.conversationLinks=Array.from({length:43},(_,i)=>({id:'link-'+i,topicId:topic.id,conversationId:'conversation-'+i,title:'SENTETİK kaynak '+String(i).padStart(2,'0'),provider:i===42?'claude':'chatgpt',sourceUpdatedAt:stamp,lastUserSource:null}));
 const h=await setup(t,{store});assert.equal(h.w.document.querySelectorAll('[data-conversation-link]').length,20);assert.equal(h.$('topic-conversations-more').hidden,false);await h.click('topic-conversations-more');assert.equal(h.w.document.querySelectorAll('[data-conversation-link]').length,40);await h.click('topic-conversations-more');assert.equal(h.w.document.querySelectorAll('[data-conversation-link]').length,43);assert.equal(h.$('topic-conversations-more').hidden,true);
 await h.change('topic-conversation-search','claude');assert.equal(h.w.document.querySelectorAll('[data-conversation-link]').length,1);assert.equal(h.$('topic-conversations-count').textContent,'1 / 43 konuşma');assert.equal(h.$('prior-approved-list').querySelectorAll('[data-overview-record]').length,8);await h.click(h.w.document.querySelector('[data-overview-more="approved"]'));assert.equal(h.$('prior-approved-list').querySelectorAll('[data-overview-record]').length,12);
});

test('toplu aktarım kendi önizlemesini ve açık onayı ister; sonuç kaynak bağlantısı ile aday olarak görünür',async t=>{
 const h=await setup(t);assert.equal(h.requests.some(r=>r.op.startsWith('records-bulk')),false);await h.click('bulk-preview');assert.match(h.$('bulk-summary').textContent,/2 konuşma incelendi/);assert.match(h.$('bulk-topic-list').textContent,/SENTETİK film/);assert.equal(h.$('bulk-apply').disabled,true);await h.check('bulk-consent');assert.equal(h.$('bulk-apply').disabled,false);await h.click('bulk-apply');assert.equal(h.requests.filter(r=>r.op==='records-bulk-apply').length,1);assert.match(h.$('bulk-status').textContent,/2 konuşma bağlantısı ve 1 inceleme bekleyen kayıt/);assert.equal(h.$('bulk-preview-panel').hidden,true);assert.equal(h.$('bulk-consent').checked,false);assert.ok(h.badges(h.$('source-candidates-list')).includes('Soru'));assert.match(h.$('topic-summary').textContent,/0 açık soru/);assert.equal(h.$('topic-conversations-panel').hidden,false);assert.equal(h.clipboard.length,0);assert.equal(h.requests.some(r=>r.op==='records-review'),false);
 const repeated=await setup(t,{bulkPreview:{previewHash:'bulk-preview-hash',conversationCount:2,linkedCount:0,candidateCount:0,alreadyLinked:2,topics:[{id:topic.id,title:'SENTETİK film',conversationCount:2,newLinkCount:0,candidateCount:0}],warnings:[]}});await repeated.click('bulk-preview');await repeated.check('bulk-consent');assert.equal(repeated.$('bulk-apply').disabled,true);assert.match(repeated.$('bulk-summary').textContent,/2 önceden bağlı/);
});

test('toplu aktarım hatasında önizleme ve kullanıcı girdisi kalır; başarı gösterilmez',async t=>{
 const h=await setup(t,{failOp:'records-bulk-apply'});await h.click('bulk-preview');await h.check('bulk-consent');await h.click('bulk-apply');assert.match(h.$('bulk-error').textContent,/kaynak hatası/);assert.equal(h.$('bulk-preview-panel').hidden,false);assert.equal(h.$('bulk-status').textContent.includes('eklendi'),false);assert.equal(h.store.conversationLinks.length,0);assert.equal(h.$('bulk-apply').disabled,false);
});


test('inceleme listesi büyük aktarımlarda otuzluk açılır; kaynak kullanıcı sözü olsa da AI yorumu doğru etiketlenir',async t=>{
 const records=Array.from({length:65},(_,i)=>record('candidate-'+i,{review:'pending',adoption:'unknown',currency:'unknown',text:'SENTETİK aday '+i,attribution:'assistant_proposal',source:{role:'user',conversationId:conversation.id,messageId:'message-1',excerpt:conversation.messages[0].text}}));
 const h=await setup(t,{records});await h.click('view-pending');assert.equal(h.$('record-list').querySelectorAll('[data-record-id]').length,30);await h.click('records-more');assert.equal(h.$('record-list').querySelectorAll('[data-record-id]').length,60);await h.click('records-more');assert.equal(h.$('record-list').querySelectorAll('[data-record-id]').length,65);assert.equal(h.$('records-more'),null);
 await h.click(h.w.document.querySelector('[data-edit-record="candidate-0"]'));assert.equal(h.$('source-role').textContent,'Senin sözün');assert.match(h.$('record-attribution').textContent,/ifade bir AI önerisi/);assert.doesNotMatch(h.$('record-attribution').textContent,/Kaynak AI tarafından/);
});

test('topicId bağlantısı ilk konu yerine istenen konuyu açar; kaynak mesajı yolu aynı konuyu korur',async t=>{
 const store=newStore([]);store.topics=[{...topic,id:'bulk-topic-ai-tools',title:'SENTETİK AI araçları'},{...topic,id:'bulk-topic-tore',title:'SENTETİK Töre'}];
 const h=await setup(t,{store,query:'?topicId=bulk-topic-tore'});assert.equal(h.$('topic-title').textContent,'SENTETİK Töre');assert.equal(h.w.document.querySelector('[data-topic-id="bulk-topic-tore"]').getAttribute('aria-current'),'true');assert.equal(h.w.document.querySelector('[data-topic-id="bulk-topic-ai-tools"]').getAttribute('aria-current'),'false');assert.deepEqual(h.ops(),['records-list']);
 const source=await setup(t,{store:clone(store),query:'?topicId=bulk-topic-tore&conversationId=conversation-1&messageId=message-1'});assert.equal(source.$('record-topic').value,'bulk-topic-tore');assert.equal(source.$('source-original').textContent,conversation.messages[0].text);assert.equal(source.$('record-editor').hidden,false);
 const unknown=await setup(t,{store:clone(store),query:'?topicId=missing'});assert.equal(unknown.$('topic-title').textContent,'SENTETİK AI araçları');assert.equal(unknown.$('page-error').hidden,true);
});

const linkedConversation=(id,topicId,extra={})=>({id,topicId,conversationId:'conversation-'+id,title:'SENTETİK konuşma '+id,provider:'chatgpt',sourceCreatedAt:stamp,sourceUpdatedAt:stamp,lastUserSource:{conversationId:'conversation-'+id,messageId:'message-'+id,role:'user',excerpt:'SENTETİK son söz '+id,timestamp:stamp},classificationReason:'SENTETİK yerel konu kuralı',linkedAt:'2026-11-15T22:00:00Z',...extra});

test('varsayılan ortak genel bakış önceki onayları ayrı durumlarıyla ve yalnız güncel kararları gösterir',async t=>{
 const store=newStore([record('current'),record('prior-opinion',{kind:'opinion',text:'SENTETİK geçmişte onaylanan',currency:'unknown'}),record('old-opinion',{kind:'opinion',text:'SENTETİK artık güncel olmayan',currency:'superseded'}),record('ai',{kind:'opinion',text:'SENTETİK benimsenmeyen AI',attribution:'assistant_proposal',adoption:'hypothesis'}),record('pending',{kind:'question',review:'pending',adoption:'not_applicable',currency:'unknown',questionState:'open'})]);
 store.topics.unshift({id:'unrelated',title:'SENTETİK başka ilk konu',createdAt:stamp});store.conversationLinks.push(linkedConversation('one',topic.id));const h=await setup(t,{store,query:''});
 assert.equal(h.$('global-overview').hidden,false);assert.equal(h.$('topic-view').hidden,true);assert.equal(h.$('global-review').hidden,true);assert.equal(h.$('nav-overview').getAttribute('aria-current'),'page');assert.equal(h.$('review-nav-count').textContent,'1');
 assert.ok(h.$('global-decisions').querySelector('[data-global-record="current"]'));assert.equal(h.$('global-decisions').querySelector('[data-global-record="prior-opinion"]'),null);
 assert.match(h.$('global-opinions').textContent,/SENTETİK geçmişte onaylanan/);assert.ok(h.badges(h.$('global-opinions')).includes('güncellik belirtilmedi'));assert.ok(h.badges(h.$('global-opinions')).includes('eskidi'));assert.doesNotMatch(h.$('global-opinions').textContent,/benimsenmeyen AI/);
 assert.match(h.$('global-resume').textContent,/SENTETİK son söz one/);assert.match(h.$('global-resume').textContent,/SENTETİK film/);assert.equal(h.w.document.querySelector('img,[onerror]'),null);assert.deepEqual(h.ops(),['records-list']);
 await h.click('overview-open-review');assert.equal(h.$('global-review').hidden,false);assert.equal(h.w.location.search,'?gorunum=bekleyenler');await h.click('nav-overview');assert.equal(h.w.location.pathname+h.w.location.search,'/konular');
});

test('global inceleme kuyruğu konu tür metin filtreleri ve yirmişer kayıtla tüm adaylara erişir',async t=>{
 const records=Array.from({length:46},(_,i)=>record('q-'+String(i).padStart(2,'0'),{topicId:i<23?topic.id:'topic-2',kind:i%2?'question':'opinion',questionState:i%2?'open':'not_applicable',text:'SENTETİK kuyruk '+i,review:'pending',adoption:i%2?'not_applicable':'unknown',currency:'unknown',source:i===29?{role:'user',excerpt:'SENTETİK özel aranan kaynak',timestamp:stamp}:null}));
 const store=newStore(records);store.topics.push({id:'topic-2',title:'SENTETİK ikinci konu',createdAt:stamp});const h=await setup(t,{query:'?view=review',store});
 assert.equal(h.$('global-review').hidden,false);assert.equal(h.$('review-queue-list').querySelectorAll('[data-global-record]').length,20);assert.match(h.$('review-result-count').textContent,/1–20 \/ 46/);assert.equal(h.$('review-prev').disabled,true);
 await h.click('review-next');assert.match(h.$('review-result-count').textContent,/21–40/);await h.click('review-next');assert.equal(h.$('review-queue-list').querySelectorAll('[data-global-record]').length,6);assert.equal(h.$('review-next').disabled,true);
 await h.change('review-topic-filter','topic-2');assert.match(h.$('review-result-count').textContent,/1–20 \/ 23/);await h.change('review-kind-filter','question');assert.equal(h.$('review-queue-list').querySelectorAll('[data-global-record]').length,12);await h.change('review-search','ÖZEL ARANAN');assert.equal(h.$('review-queue-list').querySelectorAll('[data-global-record]').length,1);assert.ok(h.$('review-queue-list').querySelector('[data-global-record="q-29"]'));
 assert.ok(h.badges(h.$('review-queue-list')).includes('açık mı, incelenecek'));assert.equal(h.badges(h.$('review-queue-list')).includes('açık'),false);assert.equal(h.ops().filter(op=>op!=='records-list').length,0);
 await h.change('review-search','eşleşmeyen metin');assert.equal(h.$('review-open-first').disabled,true);assert.match(h.$('review-queue-list').textContent,/Bu filtrelerde/);
});

test('global aday incelemesi doğru konuyu açar, eski bağlamı kapatır ve onay sonrası kuyruğu yeniler',async t=>{
 const pending=record('pending-two',{topicId:'topic-2',review:'pending',adoption:'unknown',currency:'unknown',priority:'unspecified',source:{conversationId:conversation.id,messageId:'message-1',title:conversation.title,role:'user',excerpt:conversation.messages[0].text,timestamp:stamp}}),store=newStore([record(),pending]);store.topics.push({id:'topic-2',title:'SENTETİK ikinci konu',createdAt:stamp});const h=await setup(t,{store});
 await h.prepare();await h.check('context-consent');await h.change('reply-text','SENTETİK önceki konuya ait taslak');await h.click('nav-review');await h.click('review-open-first');
 assert.equal(h.$('record-editor').hidden,false);assert.equal(h.$('record-topic').value,'topic-2');assert.equal(h.$('record-topic').disabled,true);assert.equal(h.$('source-original').textContent,conversation.messages[0].text);assert.equal(h.$('context-panel').hidden,true);assert.equal(h.$('reply-panel').hidden,true);assert.equal(h.$('context-consent').checked,false);assert.equal(h.$('reply-save').disabled,true);assert.equal(h.$('context-copy').disabled,true);assert.match(h.w.location.search,/gorunum=bekleyenler&topicId=topic-2&recordId=pending-two/);
 await h.change('record-review','reviewed');await h.change('record-change-reason','SENTETİK kaynağı kontrol ettim; benimseme ve güncellik belirtmedim.');await h.click('record-save');
 assert.equal(h.$('record-editor').hidden,true);assert.equal(h.$('global-review').hidden,false);assert.equal(h.$('review-nav-count').textContent,'0');assert.equal(h.$('pending-count').textContent,'0');assert.match(h.$('review-queue-list').textContent,/İncelenecek kayıt kalmadı/);assert.equal(h.$('review-open-first').disabled,true);assert.equal(h.w.location.search,'?gorunum=bekleyenler');
 const body=h.requests.find(r=>r.op==='records-review').body;assert.equal(body.expectedTopicId,'topic-2');assert.equal(body.adoption,'unknown');assert.equal(body.currency,'unknown');assert.equal(h.store.records[1].source.excerpt,conversation.messages[0].text);
 await h.click('nav-overview');assert.equal(h.$('global-decisions').querySelector('[data-global-record="pending-two"]'),null);
});

test('global kaynaklı aday bağlantısı incelemeyi ve AI atfını korur; sayfa sonu kayıttan sonra geri düşer',async t=>{
 const records=Array.from({length:21},(_,i)=>record('q-'+String(i).padStart(2,'0'),{review:'pending',adoption:'unknown',currency:'unknown',attribution:'assistant_proposal',source:{role:'user',excerpt:'SENTETİK kullanıcı özgün sözü',timestamp:stamp}}));const store=newStore(records),h=await setup(t,{store,query:'?view=review&topicId=topic-1&recordId=q-20'});
 assert.equal(h.$('record-editor').hidden,false);assert.match(h.$('record-attribution').textContent,/AI önerisi/);assert.equal(h.$('source-role').textContent,'Senin sözün');assert.equal(h.$('record-review').value,'pending');
 await h.click('record-close');await h.click('review-next');assert.match(h.$('review-page-status').textContent,/2 \/ 2/);await h.click('review-open-first');await h.change('record-review','rejected');await h.change('record-change-reason','SENTETİK yanlış çıkarım.');await h.click('record-save');assert.match(h.$('record-error').textContent,/kutusunu işaretle/);assert.equal(h.requests.some(r=>r.op==='records-review'),false,'AI önerisini reddetmek açık onay ister');await h.check('quick-consent');await h.click('record-save');
 assert.equal(h.$('review-nav-count').textContent,'20');assert.match(h.$('review-page-status').textContent,/1 \/ 1/);assert.equal(h.$('review-next').disabled,true);assert.match(h.$('review-queue-list').textContent,/AI önerisi · Kaynak: Senin sözün/);
});

test('altbaşlıklar konuşma başlığını ve kaynağını korur; başlık aramasıyla bulunur',async t=>{
 const store=newStore();store.conversationLinks=[linkedConversation('a',topic.id,{subtopicTitle:'SENTETİK senaryo'}),linkedConversation('b',topic.id,{subtopicTitle:'SENTETİK görüntü'}),linkedConversation('c',topic.id)];const h=await setup(t,{store});
 assert.equal(h.$('topic-conversation-list').querySelectorAll('.subtopic-heading').length,3);assert.match(h.$('topic-conversation-list').textContent,/SENTETİK senaryo · 1 konuşma/);assert.match(h.$('topic-conversation-list').textContent,/Diğer konuşmalar · 1 konuşma/);assert.match(h.$('topic-conversation-list').textContent,/SENTETİK konuşma a/);
 await h.change('topic-conversation-search','GÖRÜNTÜ');assert.equal(h.$('topic-conversation-list').querySelectorAll('[data-conversation-link]').length,1);const link=h.$('topic-conversation-list').querySelector('a');assert.match(link.href,/conversationId=conversation-b&messageId=message-b/);assert.doesNotMatch(link.href,/SENTET/);assert.deepEqual(h.ops(),['records-list']);
});

test('genel bakış her konunun son kaynak bağlantısını seçer ve devamını erişilebilir tutar',async t=>{
 const store=newStore();store.topics=[];
 for(let i=0;i<8;i++){store.topics.push({id:'t-'+i,title:'SENTETİK konu '+i,createdAt:stamp});store.conversationLinks.push(linkedConversation('l-'+i,'t-'+i,{sourceUpdatedAt:'2026-11-'+String(10+i).padStart(2,'0')+'T08:00:00Z'}));}
 store.conversationLinks.push(linkedConversation('old','t-7',{sourceUpdatedAt:'2020-01-01T08:00:00Z',linkedAt:'2030-01-01T00:00:00Z'}));store.topics.push({id:'unknown',title:'SENTETİK tarihi bilinmeyen',createdAt:stamp});store.conversationLinks.push(linkedConversation('unknown','unknown',{sourceUpdatedAt:'bozuk-tarih',sourceCreatedAt:null,lastUserSource:{role:'user',excerpt:'SENTETİK tarihi belirsiz',timestamp:null},linkedAt:'2030-01-01T00:00:00Z'}));
 const h=await setup(t,{store,query:''});assert.equal(h.$('global-resume').querySelectorAll('[data-global-resume]').length,6);assert.equal(h.$('global-resume').querySelector('[data-global-resume]').dataset.globalResume,'l-7');assert.equal(h.$('global-resume').querySelector('[data-global-resume="old"]'),null);
 await h.click(h.$('global-resume').querySelector('[data-global-more="resume"]'));assert.equal(h.$('global-resume').querySelectorAll('[data-global-resume]').length,9);assert.match(h.$('global-resume').querySelector('[data-global-resume="unknown"]').textContent,/Tarih belirtilmedi/);assert.doesNotMatch(h.$('global-resume').textContent,/2030/);
 await h.click(h.$('global-resume').querySelector('[data-resume-topic="t-7"]'));assert.equal(h.$('topic-view').hidden,false);assert.equal(h.$('topic-title').textContent,'SENTETİK konu 7');assert.equal(h.w.location.search,'?topicId=t-7');
});

test('çok sayıda konuyu arama bulur ve boş eski Diğer ana listeden kalkar',async t=>{
 const store=newStore();store.topics.push({id:'bulk-topic-other',title:'Diğer konuşmalar',createdAt:stamp});for(let i=0;i<30;i++)store.topics.push({id:'topic-many-'+i,title:'SENTETİK konu '+i,createdAt:stamp});const h=await setup(t,{store,query:''});
 assert.equal(h.$('topic-list').querySelector('[data-topic-id="bulk-topic-other"]'),null);assert.equal(h.$('topic-count').textContent,'31');await h.change('topic-search','konu 29');assert.equal(h.$('topic-list').querySelectorAll('[data-topic-id]').length,1);await h.click(h.$('topic-list').querySelector('[data-topic-id]'));assert.equal(h.$('topic-title').textContent,'SENTETİK konu 29');assert.equal(h.$('topic-view').hidden,false);
 await h.change('topic-search','yok');assert.match(h.$('topic-list').textContent,/Bu aramada konu bulunamadı/);await h.click('nav-overview');assert.equal(h.$('global-overview').hidden,false);
});

test('güncel karar yoksa karar adayları ayrı filtreli kuyruğa götürür',async t=>{
 const h=await setup(t,{query:'',records:[record('candidate',{review:'pending',adoption:'unknown',currency:'unknown'}),record('question',{kind:'question',review:'pending',adoption:'not_applicable',currency:'unknown',questionState:'open'})]});assert.match(h.$('global-decisions').textContent,/Henüz güncel/);assert.match(h.$('global-decision-candidates').textContent,/1 bekleyen kararı/);await h.click('global-decision-candidates');assert.equal(h.$('review-kind-filter').value,'decision');assert.equal(h.$('review-queue-list').querySelectorAll('[data-global-record]').length,1);assert.equal(h.w.location.search,'?gorunum=bekleyenler&kind=decision');const reopened=await setup(t,{query:h.w.location.search,store:h.store});assert.equal(reopened.$('review-kind-filter').value,'decision');assert.equal(reopened.$('review-queue-list').querySelectorAll('[data-global-record]').length,1);
});

test('başka konuya taşınmış açık editör kayıt yazmaz; listeyi yenilerken taslağı ve kaynakları korur',async t=>{
 const store=newStore([record('moving',{review:'pending',adoption:'unknown',currency:'unknown'})]);store.topics.push({id:'topic-2',title:'SENTETİK yeni konu',createdAt:stamp});const h=await setup(t,{query:'?view=review',store,moveDuringReview:true});await h.click('review-open-first');await h.change('record-text','SENTETİK korunması gereken düzenleme');await h.change('record-change-reason','SENTETİK yeniden değerlendirme');await h.click('record-save');
 assert.match(h.$('record-error').textContent,/Kaydın konusu değişmiş/);assert.match(h.$('record-error').textContent,/Girdiğin metin korunuyor/);assert.equal(h.$('record-text').value,'SENTETİK korunması gereken düzenleme');assert.equal(h.store.records[0].text,'SENTETİK kullanıcı kararı');assert.equal(h.store.records[0].revision,1);assert.equal(h.requests.filter(r=>r.op==='records-list').length,2);assert.match(h.$('review-queue-list').textContent,/SENTETİK yeni konu/);
 await h.click('review-open-first');assert.equal(h.$('record-topic').value,'topic-2');assert.equal(h.$('record-error').hidden,true);
});

test('genel görünüm ve inceleme kuyruğunda eski konunun AI yorum paneli açılmaz',async t=>{
 const store=newStore([record()]);store.replies.push({id:'reply-old',topicId:topic.id,packetId:'packet-old',commentary:'SENTETİK eski konu yorumu',rawText:'SENTETİK eski konu yorumu',validationStatus:'unverified',createdAt:stamp});const h=await setup(t,{store});assert.equal(h.$('commentaries-panel').hidden,false);await h.click('nav-overview');assert.equal(h.$('commentaries-panel').hidden,true);await h.click('nav-review');assert.equal(h.$('commentaries-panel').hidden,true);await h.click(h.$('topic-list').querySelector('[data-topic-id]'));assert.equal(h.$('commentaries-panel').hidden,false);
});

test('eksik kaynak konuşmaları aday kuyruğundan ayrı sayılır ve altışar tümüne ulaşılır',async t=>{
 const store=newStore([record('pending',{review:'pending',adoption:'unknown',currency:'unknown'})]);
 store.conversationLinks=[linkedConversation('healthy',topic.id),...Array.from({length:8},(_,i)=>linkedConversation('missing-'+i,topic.id,{lastUserSource:i===0?{messageId:'source-message',role:'user',excerpt:'SENTETİK kayıt sayılmaz'}:null,warning:i%2===0?'SENTETİK dal seçilmemiş; aday çıkarılmadı':null}))];
 const h=await setup(t,{store,query:'?view=review'});assert.equal(h.$('review-source-checks').hidden,false);assert.equal(h.$('review-source-count').textContent,'8 konuşma');assert.equal(h.$('review-nav-count').textContent,'1');assert.equal(h.$('review-queue-list').querySelectorAll('[data-global-record]').length,1);assert.equal(h.$('review-source-list').querySelectorAll('[data-source-check]').length,6);assert.equal(h.$('review-source-list').querySelector('[data-source-check="healthy"]'),null);assert.match(h.$('review-source-list').textContent,/SENTETİK dal seçilmemiş/);assert.match(h.$('review-source-list').textContent,/Son sözün belirlenemedi/);assert.match(h.$('review-source-list').textContent,/SENTETİK film/);
 const source=h.$('review-source-list').querySelector('[data-source-check="missing-0"] a');assert.match(source.href,/conversationId=conversation-missing-0&messageId=source-message/);assert.doesNotMatch(source.href,/SENTET/);
 await h.click('review-source-more');assert.equal(h.$('review-source-list').querySelectorAll('[data-source-check]').length,8);assert.equal(h.$('review-source-more').hidden,true);assert.equal(h.$('review-nav-count').textContent,'1');await h.change('review-search','eşleşmeyen aday');assert.equal(h.$('review-source-count').textContent,'8 konuşma');assert.equal(h.$('review-source-list').querySelectorAll('[data-source-check]').length,8);assert.deepEqual(h.ops(),['records-list']);assert.equal(store.records[0].review,'pending');
});

test('kayıt adayı olmadan eksik konuşmalar inceleme ekranından erişilir; sağlıklı kaynaklarda bölüm gizlidir',async t=>{
 const store=newStore();store.conversationLinks=[linkedConversation('missing',topic.id,{lastUserSource:null})];const h=await setup(t,{store,query:'?view=review'});assert.equal(h.$('review-nav-count').textContent,'0');assert.equal(h.$('review-open-first').disabled,true);assert.equal(h.$('review-source-checks').hidden,false);assert.match(h.$('review-source-list').querySelector('a').href,/\/calisma\?conversationId=conversation-missing$/);assert.equal(h.$('review-source-list').querySelector('[data-global-edit]'),null);
 const healthy=newStore();healthy.conversationLinks=[linkedConversation('good',topic.id)];const other=await setup(t,{store:healthy,query:'?view=review'});assert.equal(other.$('review-source-checks').hidden,true);assert.equal(other.$('review-source-list').childElementCount,0);
});

test('bağlı AI aracına açma ayrı onay ister, durumu görünür ve tek tıkla kapanır; kopya onayı yetmez',async t=>{
 const h=await setup(t,{records:[record()]});await h.prepare();const packet=h.store.packets[0];
 assert.match(h.$('tool-share').textContent,/yalnız yukarıdaki metni/);assert.match(h.$('tool-share').textContent,/başka hiçbir kayıt, konuşma veya not/);assert.match(h.$('tool-share-state').textContent,/kapalı/);
 assert.equal(h.$('tool-share-open').disabled,true);await h.check('context-consent');assert.equal(h.$('tool-share-open').disabled,true,'kopya onayı paylaşım onayı değildir');
 await h.check('tool-share-consent');assert.equal(h.$('tool-share-open').disabled,false);await h.click('tool-share-open');
 assert.deepEqual(h.requests.filter(r=>r.op==='records-share').map(r=>r.body),[{packetId:packet.id,shared:true,confirmedByUser:true}]);assert.equal(h.clipboard.length,0);
 assert.equal(h.store.packets[0].sharedWithTools,true);assert.match(h.$('tool-share-state').textContent,/Bağlı AI aracına açık/);assert.equal(h.$('tool-share-open').hidden,true);assert.equal(h.$('tool-share-close').hidden,false);assert.equal(h.$('tool-share-close').disabled,false);assert.equal(h.$('tool-share-consent').checked,false);assert.match(h.$('tool-share-status').textContent,/açıldı/);
 const row=h.w.document.querySelector('[data-unshare-packet="'+packet.id+'"]');assert.ok(row,'kayıtlı listede kapatma düğmesi');assert.match(row.parentElement.textContent,/Bağlı AI aracına açık/);
 await h.click('tool-share-close');assert.deepEqual(h.requests.filter(r=>r.op==='records-share').at(-1).body,{packetId:packet.id,shared:false,confirmedByUser:true});assert.equal(h.store.packets[0].sharedWithTools,undefined);assert.match(h.$('tool-share-state').textContent,/kapalı/);assert.equal(h.$('tool-share-open').hidden,false);assert.equal(h.$('tool-share-open').disabled,true,'yeniden açmak yeni onay ister');assert.equal(h.w.document.querySelector('[data-unshare-packet]'),null);
 await h.check('tool-share-consent');await h.click('tool-share-open');await h.change('context-question','SENTETİK başka soru');assert.equal(h.$('tool-share-consent').checked,false);
 await h.click(h.w.document.querySelector('[data-unshare-packet="'+packet.id+'"]'));assert.deepEqual(h.requests.filter(r=>r.op==='records-share').at(-1).body,{packetId:packet.id,shared:false,confirmedByUser:true});assert.equal(h.store.packets[0].sharedWithTools,undefined);assert.match(h.$('page-status').textContent,/kapatıldı/);
});

const task=(id,extra={})=>record(id,{kind:'task',adoption:'not_applicable',questionState:'open',priority:'unspecified',...extra});
const pendingOpinion=(id,extra={})=>record(id,{kind:'opinion',review:'pending',adoption:'unknown',currency:'unknown',priority:'unspecified',...extra});

test('iş oluşturulur, Açık işler listesinde Yapılıyor olan üstte durur; kapatma onay ve gerekçe ister',async t=>{
 const h=await setup(t,{records:[task('t-old',{text:'SENTETİK bekleyen iş',updatedAt:'2026-11-16T09:00:00Z'}),task('t-active',{text:'SENTETİK yapılan iş',priority:'active',updatedAt:'2026-11-01T09:00:00Z'}),task('t-done',{text:'SENTETİK biten iş',questionState:'closed'})]});
 assert.equal(h.$('open-tasks-panel').hidden,false);assert.equal(h.$('open-tasks-heading').textContent,'Açık işler');
 assert.deepEqual([...h.$('open-tasks-list').querySelectorAll('[data-open-task]')].map(e=>e.dataset.openTask),['t-active','t-old']);assert.ok(h.badges(h.$('open-tasks-list').querySelector('[data-open-task="t-active"]')).includes('yapılıyor'));assert.match(h.$('topic-summary').textContent,/2 açık iş/);
 await h.click('new-record');await h.change('record-kind','task');assert.equal(h.$('adoption-field').hidden,true);assert.equal(h.$('record-save-adopt').textContent,'İşi açık olarak kaydet');await h.change('record-text','SENTETİK yeni iş');await h.click('record-save-adopt');
 assert.equal(h.sent('records-create')[0].kind,'task');const opened=h.sent('records-review')[0];assert.equal(opened.adoption,'not_applicable');assert.equal(opened.questionState,'open');assert.equal(opened.review,'reviewed');assert.equal(opened.currency,'current');assert.equal(h.$('open-tasks-list').querySelectorAll('[data-open-task]').length,3);
 await h.click(h.w.document.querySelector('[data-task-close="t-old"]'));assert.equal(h.$('record-editor').hidden,false);assert.equal(h.$('question-close-panel').hidden,false);assert.equal(h.$('question-close-apply').textContent,'İşi kapat');assert.equal(h.$('question-close-apply').disabled,true,'kapatma açık onay ister');assert.equal(h.w.document.activeElement,h.$('question-close-consent'));
 await h.click('question-close-apply');assert.equal(h.sent('records-review').some(b=>b.id==='t-old'),false,'onaysız kapatma gönderilmez');
 await h.check('question-close-consent');await h.click('question-close-apply');assert.match(h.$('record-error').textContent,/İşi kapatma gerekçeni yaz/);assert.equal(h.$('record-error').getAttribute('role'),'alert');assert.equal(h.store.records.find(r=>r.id==='t-old').questionState,'open');
 await h.change('question-close-reason','SENTETİK teslim ettim');await h.click('question-close-apply');const closed=h.store.records.find(r=>r.id==='t-old');assert.equal(closed.questionState,'closed');assert.equal(closed.adoption,'not_applicable');assert.match(closed.history.at(-1).changeReason,/teslim ettim/);
 assert.equal(h.$('open-tasks-list').querySelector('[data-open-task="t-old"]'),null);assert.match(h.$('record-result').textContent,/İş kapatıldı/);assert.equal(h.w.document.activeElement,h.$('topic-title'),'kapanan iş listeden çıkınca odak konu başlığına gelir');
});

test('kayıt çöp kutusuna taşınır, Silinenler bölümünden geri alınır ve ayrı onayla kalıcı silinir',async t=>{
 const h=await setup(t,{records:[record(),record('r2',{text:'SENTETİK silinecek karar'})]});
 await h.edit('r2');assert.equal(h.$('record-trash').hidden,false);await h.click('record-trash');
 assert.deepEqual(h.sent('records-trash'),[{id:'r2',expectedRevision:h.store.trash[0].revision,confirmedByUser:true}]);
 assert.equal(h.store.records.some(r=>r.id==='r2'),false);assert.match(h.$('record-result').textContent,/Silinenler/);assert.equal(h.$('record-editor').hidden,true);
 assert.match(h.$('trash-heading').textContent,/Silinenler · 1/);const item=h.w.document.querySelector('[data-trash-item="r2"]');assert.match(item.textContent,/silinecek karar/);
 assert.equal(item.querySelector('[data-trash-purge]').disabled,true,'kalıcı silme ayrı onay ister');
 await h.click(item.querySelector('[data-trash-restore]'));assert.deepEqual(h.sent('records-untrash'),[{id:'r2',confirmedByUser:true}]);assert.ok(h.store.records.some(r=>r.id==='r2'));assert.match(h.$('trash-heading').textContent,/^Silinenler$/);
 await h.edit('r2');await h.click('record-trash');await h.check('trash-purge-consent');const again=h.w.document.querySelector('[data-trash-purge="r2"]');assert.equal(again.disabled,false);
 await h.click(again);assert.deepEqual(h.sent('records-purge'),[{id:'r2',confirmedByUser:true}]);assert.equal(h.store.trash.length,0);assert.match(h.$('trash-status').textContent,/yedek alındı/);assert.equal(h.$('trash-purge-consent').checked,false);
 await h.edit('r1');const failing=await setup(t,{records:[record()],failOp:'records-trash'});await failing.edit('r1');await failing.click('record-trash');assert.equal(failing.$('record-error').hidden,false);assert.equal(failing.store.records.length,1);
});

test('ana sayfada tek düğmeyle bütün konular bağlı AI aracına açılır ve kapanır',async t=>{
 const h=await setup(t,{records:[record()]});
 assert.ok(h.$('inbox-panel').compareDocumentPosition(h.$('all-tool-access'))&4,'0.16: araç izinleri içerikten sonra gelir (dar ekranda ve odak sırasında)');
 assert.match(h.$('all-tool-access').textContent,/Görür:/);assert.match(h.$('all-tool-access').textContent,/kapalı başlar/);
 assert.equal(h.$('all-tool-access-state').textContent,'Bağlı AI aracına kapalı');assert.equal(h.$('all-tool-access-close').hidden,true);assert.equal(h.$('all-tool-access-write').disabled,true);assert.equal(h.$('all-tool-access-save').disabled,true);
 await h.check('all-tool-access-read');await h.check('all-tool-access-write');assert.equal(h.sent('records-tool-access-all').length,0,'kutular tek başına izin açmaz');
 await h.click('all-tool-access-save');assert.deepEqual(h.sent('records-tool-access-all'),[{read:true,write:true,confirmedByUser:true}]);
 assert.match(h.$('all-tool-access-state').textContent,/Bütün konuların .*okuma ve öneri/);assert.equal(h.$('all-tool-access-close').hidden,false);assert.match(h.$('all-tool-access-status').textContent,/kapalı başlar/);
 assert.match(h.$('tool-access-state').textContent,/okuma ve öneri/,'konu paneli de güncellenir');
 await h.click('all-tool-access-close');assert.deepEqual(h.sent('records-tool-access-all').at(-1),{read:false,write:false,confirmedByUser:true});assert.deepEqual(h.toolAccess,{});
 assert.equal(h.$('all-tool-access-state').textContent,'Bağlı AI aracına kapalı');assert.equal(h.$('all-tool-access-read').checked,false);assert.equal(h.w.document.activeElement.tagName,'SUMMARY');
 const failing=await setup(t,{records:[record()],failOp:'records-tool-access-all'});await failing.check('all-tool-access-read');await failing.click('all-tool-access-save');assert.equal(failing.$('all-tool-access-error').hidden,false);assert.equal(failing.$('page-error').hidden,true);
});

test('bağlı AI aracı izni: okuma ve öneri ayrı onaylanır, öneri okumaya bağlıdır, Kapat tek tıktır',async t=>{
 const h=await setup(t,{records:[record()]});
 assert.match(h.$('tool-access').textContent,/Görür:/);assert.match(h.$('tool-access').textContent,/Görmez:/);assert.match(h.$('tool-access').textContent,/gelen kutusunda/);
 assert.equal(h.$('tool-access-state').textContent,'Bağlı AI aracına kapalı');assert.equal(h.$('tool-access-close').hidden,true);assert.equal(h.$('tool-access-write').disabled,true,'öneri izni okuma olmadan seçilemez');assert.equal(h.$('tool-access-save').disabled,true);
 await h.check('tool-access-read');assert.equal(h.$('tool-access-write').disabled,false);await h.check('tool-access-write');await h.check('tool-access-read',false);assert.equal(h.$('tool-access-write').checked,false);assert.equal(h.$('tool-access-write').disabled,true);assert.equal(h.$('tool-access-save').disabled,true);assert.equal(h.sent('records-tool-access').length,0,'kutular tek başına izin açmaz');
 await h.check('tool-access-read');await h.click('tool-access-save');assert.deepEqual(h.sent('records-tool-access'),[{topicId:'topic-1',read:true,write:false,confirmedByUser:true}]);assert.match(h.$('tool-access-state').textContent,/açık: okuma$/);assert.equal(h.$('tool-access-close').hidden,false);assert.match(h.$('tool-access-status').textContent,/yalnız okuma/);assert.equal(h.$('tool-access-status').getAttribute('role'),'status');
 await h.check('tool-access-write');await h.click('tool-access-save');assert.deepEqual(h.sent('records-tool-access').at(-1),{topicId:'topic-1',read:true,write:true,confirmedByUser:true});assert.match(h.$('tool-access-state').textContent,/okuma ve öneri/);assert.match(h.$('tool-access-status').textContent,/gelen kutusunda/);
 await h.click('tool-access-close');assert.deepEqual(h.sent('records-tool-access').at(-1),{topicId:'topic-1',read:false,write:false,confirmedByUser:true});assert.deepEqual(h.toolAccess,{});assert.equal(h.$('tool-access-state').textContent,'Bağlı AI aracına kapalı');assert.equal(h.$('tool-access-close').hidden,true);assert.equal(h.$('tool-access-read').checked,false);assert.equal(h.w.document.activeElement.tagName,'SUMMARY');
 const open=await setup(t,{records:[record()],toolAccess:{'topic-1':{read:true,write:true,updatedAt:stamp}}});assert.match(open.$('tool-access-state').textContent,/okuma ve öneri/);assert.equal(open.$('tool-access-read').checked,true);assert.equal(open.$('tool-access-write').checked,true);assert.equal(open.$('tool-access-close').hidden,false);
 const failing=await setup(t,{records:[record()],failOp:'records-tool-access'});await failing.check('tool-access-read');await failing.click('tool-access-save');assert.equal(failing.$('tool-access-error').hidden,false);assert.match(failing.$('tool-access-error').textContent,/kaynak hatası/);assert.equal(failing.$('page-error').hidden,true,'hata sayfanın tepesinde değil düğmenin yanında');
});

test('gelen kutusu açılışta okunur; öneri onayla deftere alınır, tek tıkla kaldırılır',async t=>{
 const empty=await setup(t,{records:[record()]});assert.deepEqual(empty.sent('inbox'),[{}]);assert.equal(empty.$('inbox-panel').hidden,true);
 const inbox=[{id:'in-1',receivedAt:stamp,tool:'SENTETİK Claude Code',topicId:'topic-1',kind:'objection',text:'SENTETİK itiraz <b id="bad">x</b>',relatesTo:'r1'},{id:'in-2',receivedAt:stamp,tool:'SENTETİK Claude Desktop',topicId:'topic-1',kind:'task',text:'SENTETİK iş önerisi',relatesTo:null}];
 const h=await setup(t,{records:[record()],inbox});const panel=h.$('inbox-panel');
 assert.equal(panel.hidden,false);assert.ok(h.$('global-review').contains(panel),'gelen kutusu Seni bekleyenler içinde');assert.match(h.$('review-nav-note').textContent,/gelen kutusunda 2 öneri/);await h.click('nav-review');assert.equal(panel.closest('[hidden]'),null,'Seni bekleyenler açılınca gelen kutusu görünür');assert.equal(h.$('inbox-heading').textContent,'Gelen kutusu · 2 öneri');
 const first=h.w.document.querySelector('[data-inbox-item="in-1"]');assert.match(first.textContent,/SENTETİK Claude Code/);assert.match(first.textContent,/Konu: SENTETİK film/);assert.ok(h.badges(first).includes('İtiraz'));assert.match(first.textContent,/İlgili kayıt: SENTETİK kullanıcı kararı/);assert.match(first.textContent,/<b id="bad">/);assert.equal(h.$('bad'),null);assert.doesNotMatch(first.textContent,/Tarih belirtilmedi/);
 assert.ok(h.badges(h.w.document.querySelector('[data-inbox-item="in-2"]')).includes('İş'));
 const accept=h.w.document.querySelector('[data-inbox-accept="in-1"]');assert.equal(accept.textContent,'Deftere al');assert.equal(accept.disabled,true);await h.click(accept);assert.equal(h.sent('inbox-accept').length,0,'onaysız deftere alınmaz');
 await h.check(h.w.document.querySelector('[data-inbox-consent="in-1"]'));await h.click(accept);assert.deepEqual(h.sent('inbox-accept'),[{itemId:'in-1',confirmedByUser:true}]);
 const added=h.store.records.at(-1);assert.equal(added.attribution,'assistant_proposal');assert.equal(added.review,'pending');assert.equal(h.$('inbox-heading').textContent,'Gelen kutusu · 1 öneri');assert.equal(h.$('pending-count').textContent,'1');assert.match(h.$('inbox-status').textContent,/inceleme bekleyen AI önerisi/);assert.equal(h.w.document.activeElement.dataset.inboxConsent,'in-2','odak sıradaki öneriye geçer');
 const count=h.store.records.length,dismiss=h.w.document.querySelector('[data-inbox-dismiss="in-2"]');assert.equal(dismiss.textContent,'Kaldır');assert.equal(dismiss.disabled,false,'kaldırmak onay kutusu istemez');await h.click(dismiss);
 assert.deepEqual(h.sent('inbox-dismiss'),[{itemId:'in-2',confirmedByUser:true}]);assert.equal(h.store.records.length,count);assert.equal(h.$('inbox-heading').textContent,'Gelen kutusu');assert.match(h.$('inbox-status').textContent,/hiçbir şey eklenmedi/);assert.equal(panel.hidden,false,'sonuç iletisi görünür kalır');assert.equal(h.w.document.activeElement,h.$('inbox-heading'));
});

test('gelen kutusu önerinin dayanağını aracın beyanı olarak gösterir: alıntı, kaynak, doğrulama durumu',async t=>{
 const basisInbox=()=>[
  {id:'in-1',receivedAt:stamp,tool:'SENTETİK araç',topicId:'topic-1',kind:'objection',text:'SENTETİK itiraz',relatesTo:'r1',basis:{quote:'SENTETİK kullanıcı kararı',source:'r1'}},
  {id:'in-2',receivedAt:stamp,tool:'SENTETİK araç',topicId:'topic-1',kind:'decision',text:'SENTETİK karar önerisi',relatesTo:null,basis:{quote:'SENTETİK alıntı <img id="bad-quote" src=x onerror=alert(1)>\nikinci satır',source:'https://example.invalid/sentetik?x=<b id="bad-source">y</b>'}},
  {id:'in-3',receivedAt:stamp,tool:'SENTETİK araç',topicId:'topic-1',kind:'decision',text:'SENTETİK yanlış aktarım',relatesTo:null,basis:{quote:'SENTETİK kayıtta olmayan söz',source:'r1'}},
  {id:'in-4',receivedAt:stamp,tool:'SENTETİK eski araç',topicId:'topic-1',kind:'decision',text:'SENTETİK dayanaksız eski öneri',relatesTo:null},
  {id:'in-5',receivedAt:stamp,tool:'SENTETİK araç',topicId:'topic-1',kind:'note',text:'SENTETİK dayanaksız not',relatesTo:null}];
 const h=await setup(t,{query:'?gorunum=bekleyenler',records:[record()],inbox:basisInbox()}),d=h.w.document,basis=id=>d.querySelector('[data-inbox-item="'+id+'"] [data-inbox-basis]');
 // Konudaki bir kayda dayanan alıntı: kayıt gösterilir, alıntının kayıtta geçtiği söylenir.
 const own=basis('in-1');assert.ok(own,'dayanak görünür');assert.equal(own.querySelector('.eyebrow').textContent,'Aracın gösterdiği dayanak');assert.equal(own.querySelector('blockquote').textContent,'SENTETİK kullanıcı kararı');
 assert.equal(own.querySelector('.inbox-basis-source').textContent,'Kaynak, bu konudaki kaydın: SENTETİK kullanıcı kararı');assert.equal(own.querySelector('.inbox-basis-check').textContent,'Alıntı bu kayıtta birebir geçiyor.');
 // Serbest metin kaynak: düz metin olarak basılır, HTML'e dönüşmez; aracın beyanı olduğu yazılır.
 const free=basis('in-2');assert.equal(free.querySelector('blockquote').textContent,'SENTETİK alıntı <img id="bad-quote" src=x onerror=alert(1)>\nikinci satır');assert.equal(free.querySelector('.inbox-basis-source').textContent,'Kaynak (aracın beyanı): https://example.invalid/sentetik?x=<b id="bad-source">y</b>');
 assert.equal(h.$('bad-quote'),null);assert.equal(h.$('bad-source'),null);assert.equal(free.querySelectorAll('img,b,a').length,0,'alıntı ve kaynak bağlantıya ya da etikete dönüşmez');assert.match(free.querySelector('.inbox-basis-check').textContent,/doğrulamadı; ikisi de aracın beyanıdır/);
 assert.equal(basis('in-3').querySelector('.inbox-basis-check').textContent,'Alıntı bu kayıtta birebir geçmiyor; araç yanlış aktarmış olabilir.');
 // Dayanağı olmayan eski satır ve dayanaksız not eskisi gibi görünür.
 assert.equal(basis('in-4'),null);assert.equal(basis('in-5'),null);assert.match(d.querySelector('[data-inbox-item="in-4"]').textContent,/SENTETİK dayanaksız eski öneri/);
 // Öneri yapay zekâ önerisi olarak işaretli kalır; alıntı kişinin sözü ya da kaynak alıntısı gibi sunulmaz.
 const card=d.querySelector('[data-inbox-item="in-1"]');assert.ok(card.querySelector('.record-status .voice-ai-label'));assert.equal(card.querySelector('.voice-source'),null);assert.equal(own.closest('.inbox-item'),card);
 // Ayrıntı panelinde de AI sesinin içinde görünür.
 await h.click(card.querySelector('[data-waiting-details]'));const pane=h.$('waiting-pane-body').querySelector('.source-pane-record.voice-ai [data-inbox-basis="in-1"]');assert.ok(pane,'ayrıntı panelinde dayanak');assert.equal(pane.querySelector('blockquote').textContent,'SENTETİK kullanıcı kararı');assert.equal(pane.closest('.voice-source'),null);
 // Deftere almak aynı istekle yapılır; dayanak sunucuda kayda taşınır.
 await h.check(d.querySelector('[data-inbox-consent="in-2"]'));await h.click(d.querySelector('[data-inbox-accept="in-2"]'));assert.deepEqual(h.sent('inbox-accept'),[{itemId:'in-2',confirmedByUser:true}]);assert.equal(basis('in-2'),null);assert.ok(basis('in-1'));
 // İngilizce arayüz.
 const en=await setup(t,{query:'?gorunum=bekleyenler',uiLanguage:'en',records:[record()],inbox:basisInbox()}),e=id=>en.w.document.querySelector('[data-inbox-item="'+id+'"] [data-inbox-basis]');
 assert.equal(e('in-1').querySelector('.eyebrow').textContent,'Basis cited by the tool');assert.equal(e('in-1').querySelector('.inbox-basis-source').textContent,'Source, your record in this topic: SENTETİK kullanıcı kararı');assert.equal(e('in-1').querySelector('.inbox-basis-check').textContent,'The quote appears word for word in this record.');
 assert.match(e('in-2').querySelector('.inbox-basis-source').textContent,/^Source \(as stated by the tool\): https:\/\/example\.invalid/);assert.match(e('in-2').querySelector('.inbox-basis-check').textContent,/has not checked this quote or its source/);assert.match(e('in-3').querySelector('.inbox-basis-check').textContent,/may have misquoted it/);
});

test('tek tıkla inceleme: AI önerisini benimsemek kutu ister, hipotez istemez; kuyruk sıradakini açar',async t=>{
 const h=await setup(t,{query:'?view=review',records:[pendingOpinion('ai-1',{attribution:'assistant_proposal',text:'SENTETİK AI görüşü 1'}),pendingOpinion('ai-2',{attribution:'assistant_proposal',text:'SENTETİK AI görüşü 2'}),pendingOpinion('mine',{attribution:'user_authored',text:'SENTETİK kendi notum'})]});
 await h.click('review-open-first');assert.equal(h.$('record-text').value,'SENTETİK AI görüşü 1');assert.equal(h.$('quick-review').hidden,false);assert.equal(h.$('quick-keep-open').hidden,true);assert.equal(h.$('quick-adopt').disabled,true);assert.equal(h.$('quick-reject').disabled,true);assert.equal(h.$('quick-hypothesis').disabled,false);assert.equal(h.$('record-save-next').hidden,false);assert.equal(h.$('record-save-next').textContent,'Kaydet ve sıradaki');
 await h.click('quick-adopt');assert.equal(h.sent('records-review').length,0,'onaysız benimseme gönderilmez');
 await h.check('quick-consent');await h.click('quick-adopt');let body=h.sent('records-review')[0];assert.equal(body.id,'ai-1');assert.equal(body.review,'reviewed');assert.equal(body.adoption,'adopted');assert.equal(body.currency,'current');assert.equal(body.changeReason,'İnceledim.');
 assert.equal(h.$('record-text').value,'SENTETİK AI görüşü 2');assert.match(h.$('record-result').textContent,/Sıradaki kayıt açıldı/);assert.equal(h.$('quick-consent').checked,false,'onay bir sonraki kayda taşınmaz');
 await h.change('record-change-reason','SENTETİK emin değilim ama olası');await h.click('quick-hypothesis');body=h.sent('records-review')[1];assert.equal(body.id,'ai-2');assert.equal(body.adoption,'hypothesis');assert.equal(body.changeReason,'SENTETİK emin değilim ama olası');
 assert.equal(h.$('record-text').value,'SENTETİK kendi notum');assert.equal(h.$('quick-consent-field').hidden,true,'kendi notunda kutu yok');assert.equal(h.$('quick-adopt').disabled,false);await h.click('quick-adopt');assert.equal(h.sent('records-review')[2].adoption,'adopted');
 assert.equal(h.$('record-editor').hidden,true);assert.match(h.$('record-result').textContent,/İncelenecek kayıt kalmadı/);assert.equal(h.$('review-nav-count').textContent,'0');
});

test('konu içinde Kaydet ve sıradaki, soru için Açık kalsın, kendi notunda Kaydet ve benimse',async t=>{
 const h=await setup(t,{records:[pendingOpinion('p-1',{text:'SENTETİK bekleyen 1',updatedAt:'2026-11-16T09:00:00Z'}),pendingOpinion('p-2',{text:'SENTETİK bekleyen 2'}),record('q',{kind:'question',review:'pending',adoption:'not_applicable',currency:'unknown',questionState:'open',text:'SENTETİK açık soru?'})]});
 await h.edit('p-1');await h.change('record-review','reviewed');await h.click('record-save-next');assert.equal(h.sent('records-review')[0].id,'p-1');assert.equal(h.$('record-editor').hidden,false);assert.notEqual(h.$('record-text').value,'SENTETİK bekleyen 1');
 await h.click('record-close');await h.edit('q');assert.equal(h.$('quick-keep-open').hidden,false);assert.equal(h.$('quick-adopt').hidden,true);await h.click('quick-keep-open');const kept=h.sent('records-review').at(-1);assert.equal(kept.id,'q');assert.equal(kept.review,'reviewed');assert.equal(kept.currency,'current');assert.equal(kept.questionState,'open');assert.equal(kept.adoption,'not_applicable');assert.equal(h.w.document.activeElement.dataset.editRecord,'q','odak kaydedilen kayda döner');
 await h.click('new-record');assert.equal(h.$('record-save-adopt').hidden,false);assert.equal(h.$('record-save-adopt').textContent,'Kaydet ve benimse');await h.change('record-kind','opinion');await h.change('record-text','SENTETİK kendi görüşüm');await h.click('record-save-adopt');
 const created=h.sent('records-create').at(-1),adopted=h.sent('records-review').at(-1);assert.equal(created.text,'SENTETİK kendi görüşüm');assert.equal(adopted.adoption,'adopted');assert.equal(adopted.currency,'current');assert.equal(adopted.review,'reviewed');assert.match(h.$('record-result').textContent,/benimsendi/);assert.ok(h.$('record-list').querySelector('[data-record-id="'+h.store.records.at(-1).id+'"]'));
});

test('boş defter tek başlangıç kartı gösterir; Kendi konunu aç konu formuna götürür',async t=>{
 const store={schemaVersion:1,topics:[],records:[],packets:[],replies:[],backups:[],conversationLinks:[],stateHash:'state-0'};const h=await setup(t,{store,query:''});
 assert.equal(h.$('first-run').hidden,false);assert.equal(h.$('global-overview').hidden,true);const go=h.$('first-run').querySelector('a');assert.equal(go.getAttribute('href'),'/calisma');assert.equal(go.textContent,'Konuşma içe al');assert.match(h.$('first-run').textContent,/Burada konuların durur/);assert.match(h.$('topic-list').textContent,/Henüz konu yok/);
 await h.click('first-run-topic');assert.equal(h.$('new-topic-form').hidden,false);assert.equal(h.w.document.activeElement,h.$('topic-name'));await h.change('topic-name','SENTETİK ilk konu');await h.click('topic-save');
 assert.equal(h.$('first-run').hidden,true);assert.equal(h.$('topic-view').hidden,false);assert.equal(h.$('topic-title').textContent,'SENTETİK ilk konu');assert.match(h.$('record-list').textContent,/\+ Yeni kayıt/);
});

test('işlem yalnız tetikleyen düğmeyi kilitler; hareket azaltma tercihi kaydırmada da uygulanır',async t=>{
 let release;const hold={op:'records-review',promise:new Promise(resolve=>{release=resolve;})};
 const h=await setup(t,{hold,records:[pendingOpinion('p-1')],reduceMotion:false});await h.edit('p-1');assert.equal(h.scrolls.at(-1),'smooth');
 h.$('quick-hypothesis').click();await flush();assert.equal(h.$('quick-hypothesis').disabled,true);assert.equal(h.$('new-record').disabled,false);assert.equal(h.$('record-text').disabled,false);assert.equal(h.$('main').getAttribute('aria-busy'),'true');
 release();await flush();assert.equal(h.$('main').hasAttribute('aria-busy'),false);assert.equal(h.store.records[0].adoption,'hypothesis');
 const calm=await setup(t,{records:[pendingOpinion('p-1')],reduceMotion:true});await calm.edit('p-1');assert.equal(calm.scrolls.at(-1),'auto');
});

test('üst menü ve başlık kararlara uyar; eski görüş defteri bakımda; ekranda iç kimlik yok',async t=>{
 const h=await setup(t,{records:[record('8f14e45f-ceea-467f-a9b4-0123456789ab',{text:'SENTETİK kimlikli kayıt'})],inbox:[{id:'0f8fad5b-d9cb-469f-a165-70867728950e',receivedAt:stamp,tool:'SENTETİK araç',topicId:'topic-1',kind:'note',text:'SENTETİK not',relatesTo:null}]});const d=h.w.document;
 assert.equal(d.title,'töre — Konular');assert.deepEqual([...d.querySelectorAll('.topbar nav a')].map(a=>[a.firstChild.textContent,a.getAttribute('href')]),MENU);assert.equal(d.querySelector('.topbar nav [aria-current="page"]').textContent,'Konular');assert.equal(d.querySelectorAll('.topbar nav [aria-current]').length,1);assert.equal(d.querySelector('.brand').getAttribute('href'),'/');
 const legacy=d.querySelector('.maintenance a[href="/gorusler"]');assert.ok(legacy);assert.match(legacy.closest('details').querySelector('summary').textContent,/Eski görüş defteri/);assert.match(h.$('maintenance').textContent,/yalnız konularını ve kayıtlarını/);assert.match(h.$('maintenance').textContent,/bu bilgisayarda/);
 const levels=[...d.querySelectorAll('h1,h2,h3,h4,h5,h6')].map(e=>Number(e.tagName[1]));for(let i=1;i<levels.length;i++)assert.ok(levels[i]<=levels[i-1]+1,'başlık sırası atlamaz: h'+levels[i-1]+' → h'+levels[i]);
 assert.equal(d.querySelector('.record-card h3,.record-card h4'),null,'kayıt metni başlık değil');
 assert.doesNotMatch(d.body.textContent,/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}/);assert.doesNotMatch(d.body.textContent,/\bv3\b/);
});

test('konu masası üç bölmedir; kaynak bölmesi tıklanan kaydın alıntısını, kaynağını ve kaydı gösterir',async t=>{
 const source={id:'source:message-1',kind:'conversation',conversationId:conversation.id,messageId:'message-1',excerpt:'SENTETİK alıntılanan söz',title:'SENTETİK planlama konuşması',provider:'chatgpt',role:'user',timestamp:'2026-03-12T10:00:00Z'};
 const h=await setup(t,{records:[record('sourced',{text:'SENTETİK kaynaklı karar',source,attribution:'user_statement'}),record('own',{kind:'opinion',text:'SENTETİK kendi görüşüm',priority:'unspecified'}),record('ai',{kind:'opinion',text:'SENTETİK AI görüşü',attribution:'assistant_proposal',review:'pending',adoption:'unknown',currency:'unknown',priority:'unspecified',source:{...source,role:'assistant',excerpt:'SENTETİK AI alıntısı'}})]});
 const d=h.w.document,pane=h.$('source-pane'),after=(a,b)=>Boolean(a.compareDocumentPosition(b)&h.w.Node.DOCUMENT_POSITION_FOLLOWING);
 assert.equal(h.$('desk').dataset.screen,'topic');assert.equal(pane.hidden,false);assert.ok(after(d.querySelector('.rail'),h.$('topic-view')));assert.ok(after(h.$('topic-view'),pane),'sol ray · konu · kaynak');
 assert.equal(h.$('source-pane-empty').hidden,false);assert.match(h.$('source-pane-empty').textContent,/bir kayıt seç/);assert.equal(h.$('source-pane-body').hidden,true);
 await h.click(d.querySelector('[data-source-record="sourced"]'));
 assert.equal(h.$('source-pane-body').hidden,false);assert.equal(h.$('source-pane-excerpt').textContent,'SENTETİK alıntılanan söz');assert.ok(h.$('source-pane-excerpt').classList.contains('voice-source'));
 assert.match(h.$('source-pane-title').textContent,/SENTETİK planlama konuşması/);assert.match(h.$('source-pane-date').textContent,/2026/);assert.equal(h.$('source-pane-role').textContent,'Senin sözün');
 assert.equal(h.$('source-pane-text').textContent,'SENTETİK kaynaklı karar');assert.equal(h.$('source-pane-open').getAttribute('href'),'/calisma?conversationId=conversation-1&messageId=message-1');
 assert.ok(d.querySelector('[data-record-id="sourced"]').classList.contains('is-source'));assert.equal(d.activeElement,h.$('source-pane-heading'),'odak kaynak bölmesine geçer');assert.deepEqual(h.ops(),['records-list'],'kaynak bölmesi yeni istek göndermez');
 await h.click(d.querySelector('[data-record-id="own"] .record-text'));assert.equal(h.$('source-pane-text').textContent,'SENTETİK kendi görüşüm','kartın kendisine tıklamak da kaynağı açar');
 assert.equal(h.$('source-pane-excerpt').hidden,true);assert.match(h.$('source-pane-none').textContent,/Arkasında bir konuşma yok/);assert.equal(h.$('source-pane-open').hidden,true);assert.equal(d.querySelector('[data-record-id="sourced"]').classList.contains('is-source'),false);
 await h.click('view-pending');await h.click(d.querySelector('[data-source-record="ai"]'));assert.equal(h.$('source-pane-excerpt').textContent,'SENTETİK AI alıntısı');assert.equal(h.$('source-pane-role').textContent,'AI yanıtı');assert.equal(h.$('source-pane-voice').querySelector('.voice-ai-label').textContent,'AI önerisi');
 await h.click('source-pane-edit');assert.equal(h.$('record-editor').hidden,false);assert.equal(h.$('record-text').value,'SENTETİK AI görüşü');
 await h.click('nav-overview');assert.equal(pane.hidden,true);assert.equal(h.$('desk').dataset.screen,'overview');assert.equal(h.w.document.querySelector('img,[onerror]'),null);
});

test('Şimdi güncel kayıtları Kararlar, Görüşler, Açık sorular ve Açık işler olarak toplar; Tüm kayıtlar süzgeçleri taşır',async t=>{
 const h=await setup(t,{records:[record('d1',{text:'SENTETİK karar'}),record('o1',{kind:'opinion',text:'SENTETİK görüş',priority:'unspecified'}),record('q1',{kind:'question',adoption:'not_applicable',questionState:'open',text:'SENTETİK soru?',priority:'unspecified'}),record('t1',{kind:'task',adoption:'not_applicable',questionState:'open',text:'SENTETİK iş',priority:'unspecified'}),record('p1',{kind:'opinion',text:'SENTETİK bekleyen',review:'pending',adoption:'unknown',currency:'unknown',priority:'unspecified'})]});
 const d=h.w.document,after=(a,b)=>Boolean(a.compareDocumentPosition(b)&h.w.Node.DOCUMENT_POSITION_FOLLOWING);
 assert.equal(h.$('tab-now').getAttribute('aria-pressed'),'true');assert.equal(h.$('record-filters').hidden,true);
 assert.deepEqual([...h.$('record-list').querySelectorAll('.record-group h3')].map(e=>e.textContent),['Kararlar','Görüşler']);
 assert.ok(h.$('record-list').querySelector('[data-group="decision"] [data-record-id="d1"]'));assert.ok(h.$('record-list').querySelector('[data-group="opinion"] [data-record-id="o1"]'));assert.equal(h.$('record-list').querySelector('[data-record-id="p1"]'),null);
 assert.ok(h.$('open-questions-list').querySelector('[data-open-question="q1"]'));assert.ok(h.$('open-tasks-list').querySelector('[data-open-task="t1"]'));
 assert.ok(after(h.$('record-list'),h.$('open-questions-panel'))&&after(h.$('open-questions-panel'),h.$('open-tasks-panel')),'Karar · Görüş · Açık sorular · Açık işler sırası');
 assert.equal(d.querySelector('.resume-line').textContent,'Kaldığım yer. 1 güncel karar · 1 güncel görüş · 1 açık soru · 1 açık iş · 1 inceleme bekleyen kayıt');
 assert.equal(h.$('crumb-topic').textContent,h.$('topic-title').textContent);assert.equal(h.$('crumb-topic').getAttribute('aria-current'),'page');assert.equal(h.$('tab-map').getAttribute('href'),'/harita');
 await h.click('tab-records');assert.equal(h.$('tab-records').getAttribute('aria-pressed'),'true');assert.equal(h.$('tab-now').getAttribute('aria-pressed'),'false');assert.equal(h.$('record-filters').hidden,false);assert.equal(h.$('view-all').getAttribute('aria-pressed'),'true');
 assert.equal(h.$('record-list').querySelectorAll('[data-record-id]').length,5);assert.equal(h.$('open-questions-panel').hidden,true);assert.equal(h.$('open-tasks-panel').hidden,true);
 await h.click('view-pending');assert.deepEqual([...h.$('record-list').querySelectorAll('[data-record-id]')].map(e=>e.dataset.recordId),['p1']);
 await h.click('tab-now');assert.equal(h.$('record-filters').hidden,true);assert.ok(h.$('record-list').querySelector('[data-record-id="d1"]'));assert.equal(h.$('open-tasks-panel').hidden,false);
});

test('her kayıtta tek, sessiz bir durum satırı; yalnız AI önerisi ve inceleme bekleyen ayrı işaret taşır',async t=>{
 const h=await setup(t,{records:[record('d1'),record('ai',{kind:'opinion',attribution:'assistant_proposal',review:'pending',adoption:'unknown',currency:'unknown',priority:'unspecified',text:'SENTETİK AI önerisi'})],inbox:[{id:'in-1',receivedAt:stamp,tool:'SENTETİK araç',topicId:'topic-1',kind:'objection',text:'SENTETİK itiraz',relatesTo:null}]});
 const d=h.w.document,card=d.querySelector('[data-record-id="d1"]');
 assert.equal(card.querySelectorAll('.record-status').length,1);assert.equal(card.querySelector('.badge'),null,'durum çipi yok');
 assert.equal(card.querySelector('.record-status').textContent,'Karar · benimsendi · güncel · yapılıyor');assert.equal(card.querySelector('.voice-ai-label,.status-pending'),null);
 await h.click('view-all');const line=d.querySelector('[data-record-id="ai"] .record-status');
 assert.equal(line.querySelector('.voice-ai-label').textContent,'AI önerisi');assert.equal(line.querySelector('.status-pending').textContent,'inceleme bekliyor');
 assert.equal(line.textContent,'inceleme bekliyor AI önerisi Görüş · benimseme belirtilmedi · güncellik belirtilmedi');
 const inbox=d.querySelector('[data-inbox-item="in-1"] .record-status');assert.equal(inbox.textContent,'AI önerisi İtiraz');assert.ok(inbox.querySelector('.voice-ai-label'));
 assert.equal(d.querySelector('#main .record-meta'),null,'eski çip satırı hiçbir listede kalmadı');
});

test('Konular üst menüsü dört öğedir; Seni bekleyenler sessiz sayı taşır, yeni ve eski adresle açılır, sayfa içinde geçer',async t=>{
 const records=[record(),record('p',{review:'pending',adoption:'unknown',currency:'unknown'})];
 const h=await setup(t,{records});const d=h.w.document;
 assert.deepEqual([...d.querySelectorAll('.topbar nav a')].map(a=>[a.firstChild.textContent,a.getAttribute('href')]),MENU);
 assert.equal(h.$('topnav-waiting-count').textContent.trim(),'1');assert.equal(h.$('topnav-waiting').querySelector('.badge,.warning'),null,'sayı kırmızı rozet değil');
 assert.equal(h.$('topnav-topics').getAttribute('aria-current'),'page');assert.equal(h.$('topnav-waiting').hasAttribute('aria-current'),false);
 await h.click('new-record');await h.change('record-text','SENTETİK yarım not');await h.click('topnav-waiting');
 assert.equal(h.$('record-discard').hidden,false,'kaydedilmemiş metin sorulmadan bırakılmaz');assert.equal(h.$('global-review').hidden,true);assert.equal(h.$('record-text').value,'SENTETİK yarım not');
 await h.click('record-discard-yes');assert.equal(h.$('global-review').hidden,false);assert.equal(h.w.location.pathname+h.w.location.search,'/konular?gorunum=bekleyenler');
 assert.equal(h.$('topnav-waiting').getAttribute('aria-current'),'page');assert.equal(h.$('topnav-topics').hasAttribute('aria-current'),false);assert.equal(d.querySelectorAll('.topbar nav [aria-current]').length,1);
 await h.click('topnav-topics');assert.equal(h.$('global-overview').hidden,false);assert.equal(h.$('topnav-topics').getAttribute('aria-current'),'page');
 for(const query of ['?gorunum=bekleyenler','?view=review']){const other=await setup(t,{records,query});assert.equal(other.$('global-review').hidden,false,query);assert.equal(other.$('topnav-waiting').getAttribute('aria-current'),'page',query);}
 assert.equal(d.querySelector('.page-head h1').textContent,'Konular');assert.equal(d.querySelector('.hero'),null,'büyük başlık bloğu yok');
});

// 0.16 adım 3 ---------------------------------------------------------------
const conversationSource=(excerpt,extra={})=>({id:'source:message-1',kind:'conversation',conversationId:conversation.id,messageId:'message-1',excerpt,title:'SENTETİK planlama konuşması',provider:'chatgpt',role:'user',timestamp:'2026-03-12T10:00:00Z',...extra});
const waitingInbox=()=>[{id:'in-1',receivedAt:'2026-11-17T09:00:00Z',tool:'Claude Code',topicId:'topic-1',kind:'task',text:'SENTETİK iş önerisi: çizelgeyi yaz',relatesTo:'r1'},{id:'in-2',receivedAt:'2026-11-17T10:00:00Z',tool:'Claude Code',topicId:'topic-1',kind:'note',text:'SENTETİK not önerisi',relatesTo:null}];

test('Seni bekleyenler tek liste: konuşmalardan gelen kayıtlar kaynak sesiyle, Claude Code önerileri AI sesiyle; toplu kabul yok',async t=>{
 const records=[record(),pendingOpinion('from-chat',{text:'SENTETİK konuşmadan çıkan görüş',attribution:'assistant_proposal',source:conversationSource('SENTETİK kaynaktaki söz aynen')}),pendingOpinion('own-note',{text:'SENTETİK kendi bekleyen notum'})];
 const h=await setup(t,{query:'?gorunum=bekleyenler',records,inbox:waitingInbox()}),d=h.w.document,review=h.$('global-review');
 assert.equal(review.hidden,false);assert.equal(h.$('global-review-heading').textContent,'Seni bekleyenler · 4');assert.equal(h.$('topnav-waiting-count').textContent.trim(),'4');
 assert.match(review.querySelector('.waiting-promise').textContent,/^töre her zaman sana sorar: hiçbir şey sen onaylamadan görüşün olmaz\.$/);
 assert.match(h.$('waiting-keys').textContent,/Tab/);assert.ok(h.$('waiting-keys').querySelector('kbd'));
 const buttons=[...d.querySelectorAll('button,a')].map(b=>b.textContent);assert.equal(buttons.some(b=>/hepsini (kabul|benimse|al|ekle|onayla)|tümünü (kabul|benimse|al|onayla)|toplu (kabul|onay)|accept all/i.test(b)),false,'hiçbir yerde toplu kabul düğmesi yok');
 const groups=[...h.$('review-queue-list').querySelectorAll('.waiting-subgroup h4')].map(e=>e.textContent);assert.deepEqual(groups,['Konuşmalarından · 1','Kendi notlarından · 1']);
 const chat=d.querySelector('[data-waiting-item="record:from-chat"]'),quote=chat.querySelector('blockquote');
 assert.equal(quote.textContent,'SENTETİK kaynaktaki söz aynen');assert.ok(quote.classList.contains('voice-source'),'kaynak sesi');assert.ok(chat.querySelector('.record-text').classList.contains('voice-ai'));assert.equal(chat.querySelector('.voice-ai-label').textContent,'AI önerisi');
 assert.deepEqual([...chat.querySelectorAll('.waiting-actions button')].map(b=>b.textContent),['Benimse','Bekleyen olarak bırak','Düzenle','Kaldır','Ayrıntı']);
 const tool=h.$('inbox-list').querySelector('.tool-group');assert.equal(tool.querySelector('h4').textContent,"Claude Code'dan · 2 öneri");assert.match(tool.querySelector('.session-head').textContent,/17 Kasım 2026 · 2 öneri/);
 const proposal=d.querySelector('[data-waiting-item="proposal:in-1"]');assert.equal(proposal.querySelector('.voice-ai-label').textContent,'AI önerisi');assert.match(proposal.textContent,/İlgili kayıt: SENTETİK kullanıcı kararı/);
 assert.deepEqual([...proposal.querySelectorAll('.waiting-actions button')].map(b=>b.textContent),['Deftere al','Kaldır','Ayrıntı']);
 assert.ok(review.querySelector('#waiting-records').compareDocumentPosition(h.$('inbox-panel'))&4,'önce konuşmalardan, sonra araçtan');
 const levels=[...d.querySelectorAll('h1,h2,h3,h4,h5,h6')].map(e=>Number(e.tagName[1]));for(let i=1;i<levels.length;i++)assert.ok(levels[i]<=levels[i-1]+1,'başlık sırası atlamaz');
 // Ayrıntı: geniş ekranda sağ bölme, dar ekranda kartın içi (CSS seçer).
 assert.equal(h.$('waiting-pane').hidden,false);assert.equal(h.$('waiting-pane-body').hidden,true);
 await h.click(chat.querySelector('[data-waiting-details]'));
 assert.equal(h.$('waiting-pane-body').querySelector('blockquote.voice-source').textContent,'SENTETİK kaynaktaki söz aynen');assert.match(h.$('waiting-pane-body').querySelector('a').getAttribute('href'),/conversationId=conversation-1&messageId=message-1/);
 assert.ok(chat.classList.contains('is-selected'));assert.equal(chat.querySelector('[data-waiting-details]').getAttribute('aria-expanded'),'true');assert.ok(chat.querySelector('.waiting-inline blockquote.voice-source'),'dar ekran için kart içi ayrıntı');assert.equal(d.activeElement,h.$('waiting-pane-heading'));
 await h.click(proposal.querySelector('[data-waiting-details]'));assert.equal(chat.querySelector('.waiting-inline'),null);assert.match(h.$('waiting-pane-body').textContent,/İlgili kayıt/);assert.match(h.$('waiting-pane-body').textContent,/Senin yerine asla benimsenmez/);
 const css=fs.readFileSync(path.join(web,'return.css'),'utf8');assert.match(css,/@media\(max-width:900px\)\{\.desk\[data-screen=review\]\{display:block\}[^@]*\.waiting-pane\{display:none!important\}/);assert.match(css,/\.waiting-item\.is-selected \.waiting-inline\{display:block\}/);
 assert.deepEqual(h.ops(),['records-list'],'yalnız okuma; ayrıntı yeni istek göndermez');
 // Kısayol tuşu yok: tuşlar hiçbir işlem yapmaz.
 for(const key of ['a','d','j','k','p','e'])d.body.dispatchEvent(new h.w.KeyboardEvent('keydown',{key,bubbles:true}));await flush();assert.deepEqual(h.ops(),['records-list']);
});

test('Seni bekleyenlerde her işlem öğeyi listeden çıkarır ve sayıyı günceller; benimseme açık onay ister',async t=>{
 const records=[record(),pendingOpinion('from-chat',{text:'SENTETİK konuşmadan çıkan görüş',attribution:'assistant_proposal',source:conversationSource('SENTETİK kaynak söz')}),pendingOpinion('leave-me',{text:'SENTETİK sonra bakacağım'}),pendingOpinion('drop-me',{text:'SENTETİK yanlış çıkarım'}),record('q',{kind:'question',review:'pending',adoption:'not_applicable',currency:'unknown',questionState:'open',priority:'unspecified',text:'SENTETİK açık soru?'})];
 const h=await setup(t,{query:'?gorunum=bekleyenler',records,inbox:waitingInbox()}),d=h.w.document,item=id=>d.querySelector('[data-waiting-item="'+id+'"]'),count=()=>h.$('global-review-heading').textContent;
 assert.equal(count(),'Seni bekleyenler · 6');
 const adopt=item('record:from-chat').querySelector('[data-waiting-decide]');assert.equal(adopt.disabled,true,'onaysız benimseme kapalı');await h.click(adopt);assert.equal(h.sent('records-review').length,0);
 await h.check(item('record:from-chat').querySelector('[data-waiting-consent]'));assert.equal(adopt.disabled,false);await h.click(adopt);
 const body=h.sent('records-review')[0];assert.deepEqual({id:body.id,review:body.review,adoption:body.adoption,currency:body.currency,confirmedByUser:body.confirmedByUser},{id:'from-chat',review:'reviewed',adoption:'adopted',currency:'current',confirmedByUser:true});
 assert.equal(item('record:from-chat'),null);assert.equal(count(),'Seni bekleyenler · 5');assert.match(h.$('waiting-status').textContent,/Benimsedin/);assert.equal(d.activeElement.closest('[data-waiting-item]')?.dataset.waitingItem!==undefined,true,'odak sıradaki öğede');
 const keep=item('record:q').querySelector('[data-waiting-decide]');assert.equal(keep.textContent,'Açık soru olarak al');assert.equal(keep.disabled,false,'soru için onay kutusu yok');await h.click(keep);
 const kept=h.sent('records-review').at(-1);assert.equal(kept.id,'q');assert.equal(kept.questionState,'open');assert.equal(kept.adoption,'not_applicable');assert.equal(item('record:q'),null);assert.equal(count(),'Seni bekleyenler · 4');
 await h.click(item('record:leave-me').querySelector('[data-waiting-leave]'));assert.equal(item('record:leave-me'),null);assert.equal(h.store.records.find(r=>r.id==='leave-me').review,'pending','bırakmak hiçbir şey yazmaz');assert.equal(count(),'Seni bekleyenler · 3');
 assert.equal(h.$('waiting-skipped').hidden,false);assert.match(h.$('waiting-skipped').textContent,/1 kaydı şimdilik bıraktın/);await h.click('waiting-unskip');assert.ok(item('record:leave-me'));assert.equal(count(),'Seni bekleyenler · 4');
 await h.click(item('record:drop-me').querySelector('[data-waiting-remove]'));assert.deepEqual(h.sent('records-trash').at(-1),{id:'drop-me',expectedRevision:1,confirmedByUser:true});assert.equal(item('record:drop-me'),null);assert.match(h.$('waiting-status').textContent,/Silinenler/);assert.equal(count(),'Seni bekleyenler · 3');
 const take=item('proposal:in-1').querySelector('[data-inbox-accept]');assert.equal(take.disabled,true);await h.check(item('proposal:in-1').querySelector('[data-inbox-consent]'));await h.click(take);
 assert.equal(item('proposal:in-1'),null);const taken=h.store.records.at(-1);assert.equal(taken.review,'pending');assert.equal(taken.attribution,'assistant_proposal');assert.ok(item('record:'+taken.id),'alınan öneri inceleme bekleyen olarak listede');assert.equal(count(),'Seni bekleyenler · 3');
 assert.match(h.$('review-queue-list').textContent,/Claude Code'dan · 1/);
 await h.click(item('proposal:in-2').querySelector('[data-inbox-dismiss]'));assert.equal(item('proposal:in-2'),null);assert.equal(count(),'Seni bekleyenler · 2');assert.equal(h.$('topnav-waiting-count').textContent.trim(),'2');
 await h.click(item('record:leave-me').querySelector('[data-global-edit]'));assert.equal(h.$('record-editor').hidden,false,'Düzenle var olan inceleme düzenleyicisini açar');assert.equal(h.$('record-text').value,'SENTETİK sonra bakacağım');
 assert.equal(h.requests.some(r=>/all|bulk/.test(r.op)),false);
});

test('ilk açılış: boş defterde ortada üç adım; klasör yolu yok, araçlar ve bakım konu açılana kadar gizli',async t=>{
 const blank=()=>({schemaVersion:1,topics:[],records:[],packets:[],replies:[],backups:[],conversationLinks:[],stateHash:'state-0'});
 const h=await setup(t,{store:blank(),query:'',status:{conversationCount:0}}),d=h.w.document,start=h.$('first-run');
 assert.equal(start.hidden,false);assert.ok(h.$('desk').hasAttribute('data-first-run'));assert.equal(h.$('rail').hidden,true);assert.equal(h.$('rail-foot').hidden,true);assert.equal(h.$('rail-tools').hidden,true);assert.equal(h.$('bakim').hidden,true);
 assert.deepEqual([...start.querySelectorAll('.start-step h3')].map(e=>e.textContent),['Defterin bu bilgisayarda','Konuşmalarını içe al','İlk konunu aç']);
 assert.match(h.$('start-folder').textContent,/töre klasöründe/);assert.match(h.$('start-folder').textContent,/Bu bilgisayarda kalır\. Başka kimse göremez\./);assert.doesNotMatch(start.textContent,/\/Users|\/home|~\/|[A-Z]:\\/,'mutlak yol yok');
 assert.equal(h.$('start-import-link').getAttribute('href'),'/calisma');assert.equal(h.$('start-import').classList.contains('is-done'),false);
 await h.click('first-run-topic');assert.equal(h.$('new-topic-form').hidden,false);assert.ok(start.contains(h.$('new-topic-form')),'konu formu adımın içinde açılır');assert.equal(d.activeElement,h.$('topic-name'));
 await h.change('topic-name','SENTETİK ilk konu');await h.click('topic-save');
 assert.equal(start.hidden,true);assert.equal(h.$('rail').hidden,false);assert.equal(h.$('rail-foot').hidden,false);assert.equal(h.$('rail-tools').hidden,false);assert.equal(h.$('bakim').hidden,false);assert.ok(h.$('rail').contains(h.$('new-topic-form')),'form yeniden konu listesinin yanında');assert.equal(h.$('desk').hasAttribute('data-first-run'),false);
 const imported=await setup(t,{store:blank(),query:'',status:{conversationCount:3}});
 assert.equal(imported.$('first-run').hidden,false);assert.ok(imported.$('start-import').classList.contains('is-done'));assert.match(imported.$('start-import-note').textContent,/3 konuşma/);
 assert.equal(imported.$('rail-foot').hidden,false,'konuşmalar içerideyse konulara yerleştirme açık');assert.equal(imported.$('bulk-import').hidden,false);assert.equal(imported.$('rail-tools').hidden,true);assert.equal(imported.$('bakim').hidden,true);
 const unknown=await setup(t,{store:blank(),query:''});assert.equal(unknown.$('first-run').hidden,false);assert.equal(unknown.$('start-import').classList.contains('is-done'),false,'sayı okunamazsa adım açık kalır');
});

test('dar ekran sırası: konu içeriği ray araçlarından önce gelir; geniş ekranda araçlar konu listesinin altında durur',async t=>{
 const h=await setup(t,{records:[record()]}),d=h.w.document,desk=h.$('desk'),after=(a,b)=>Boolean(a.compareDocumentPosition(b)&h.w.Node.DOCUMENT_POSITION_FOLLOWING);
 const order=[...desk.children].map(e=>e.id||e.className);assert.deepEqual(order,['rail','sidebar-main','source-pane','waiting-pane','rail-foot'].map(id=>id==='sidebar-main'?d.querySelector('.desk>.main-column').className:id));
 for(const tool of ['tool-access','all-tool-access','bulk-import','bakim'])assert.ok(after(h.$('topic-view'),h.$(tool)),tool+' konu içeriğinden sonra');
 assert.ok(after(h.$('topic-list'),h.$('topic-view')),'konu listesi içerikten önce');assert.ok(after(h.$('source-pane'),h.$('rail-foot')),'kaynak bölmesi araçlardan önce');
 const focusable=[...d.querySelectorAll('#desk a[href],#desk button,#desk input,#desk select,#desk summary')].filter(e=>!e.closest('[hidden]')),first=focusable.findIndex(e=>e.closest('#topic-view')),tools=focusable.findIndex(e=>e.closest('#rail-foot'));
 assert.ok(first>=0&&tools>first,'odak sırası: içerik, sonra araçlar');assert.equal(d.querySelector('[tabindex]:not([tabindex="0"]):not([tabindex="-1"])'),null,'odak sırası tabindex ile bozulmaz');
 const css=fs.readFileSync(path.join(web,'return.css'),'utf8');
 assert.match(css,/\.desk\{row-gap:0;grid-template-rows:auto 1fr;grid-template-areas:"rail main" "tools main"\}/);assert.match(css,/grid-template-areas:"rail main pane" "tools main pane"/);assert.match(css,/\.desk>\.rail-foot\{grid-area:tools/);
 assert.match(css,/@media\(max-width:900px\)\{\.desk,\.desk\[data-screen=topic\]\{display:block\}/,'dar ekranda DOM sırası geçerli');
 assert.equal(h.$('rail-foot').getAttribute('aria-label'),'Araçlar ve bakım');
});

// 0.16 step 4: English and Turkish.
test('İngilizce: genel bakış, konu masası ve Seni bekleyenler İngilizce açılır; html lang ve sayfa başlığı İngilizce',async t=>{
 const records=[record(),record('waiting',{text:'SENTETİK bekleyen not',review:'pending',adoption:'unknown',currency:'unknown',priority:'unspecified'})];
 const h=await setup(t,{records,uiLanguage:'en',query:''}),d=h.w.document;
 assert.equal(d.documentElement.lang,'en');assert.equal(d.title,'töre — Topics');
 assert.deepEqual([...d.querySelectorAll('.topbar nav [data-i18n]')].map(e=>e.textContent),['Topics','Waiting for you','My map','Conversations']);
 assert.equal(d.querySelector('[data-ui-lang="en"]').getAttribute('aria-pressed'),'true');assert.equal(d.querySelector('[data-ui-lang="tr"]').getAttribute('aria-pressed'),'false');
 assert.equal(h.$('page-heading').textContent,'Topics');assert.match(d.querySelector('.page-meta').textContent,/^1 topic · 1 record waiting for your review$/);
 assert.equal(h.$('global-overview-heading').textContent,'Overview');assert.equal(h.$('global-summary').textContent,'1 topic · 0 linked conversations · 0 adopted opinions · 1 current decision');
 assert.equal(h.$('global-pending-summary').textContent,'1 record is pending review. Open it and say whether it is yours.');assert.equal(h.$('page-status').textContent,'Your topics are ready.');
 assert.equal(h.$('topic-search').placeholder,'Topic name');assert.equal(h.$('new-topic-toggle').textContent,'+ New');assert.equal(h.$('maintenance-heading').textContent,'Maintenance');
 assert.match(h.$('global-decisions').textContent,/Decision · adopted · current · in progress/);
 assert.deepEqual(h.ops(),['records-list']);assert.deepEqual(h.sent('ui-language-get'),[{}]);
 // The topic desk.
 await h.click(d.querySelector('[data-topic-id="topic-1"]'));
 assert.equal(h.$('tab-now').textContent,'Now');assert.equal(h.$('tab-records').textContent,'All records');
 assert.equal(h.$('topic-summary').textContent,'1 current decision · 0 current opinions · 0 open questions · 0 open tasks · 1 record pending review');
 assert.equal(h.$('group-decision').textContent,'Decisions');assert.ok(h.badges(h.$('record-list')).includes('adopted'));assert.ok(h.badges(h.$('record-list')).includes('current'));
 await h.edit('r1');assert.equal(h.$('record-heading').textContent,'Decision · review');assert.equal(h.$('record-save').textContent,'Save');assert.equal(h.$('record-adoption').selectedOptions[0].textContent,'I adopt it');
 // Waiting for you.
 await h.click('record-close');await h.click('nav-review');
 assert.match(h.$('global-review-heading').textContent,/^Waiting for you · 1$/);assert.equal(d.querySelector('.waiting-promise').textContent,'töre always asks you: nothing becomes your opinion until you confirm it.');
 assert.match(h.$('review-queue-list').textContent,/From your own notes · 1/);assert.equal(h.$('review-page-status').textContent,'Page 1 of 1');
 assert.deepEqual([...h.$('review-queue-list').querySelectorAll('.waiting-actions button')].map(b=>b.textContent),['Adopt','Leave it waiting','Edit','Remove','Details']);
 assert.equal(h.$('waiting-keys').querySelectorAll('kbd').length,5);assert.match(h.$('waiting-keys').textContent,/^Keyboard: Tab moves/);
});

test('kayıtlı seçim yoksa İngilizce tarayıcı İngilizce görür; ?gorunum=bekleyenler doğrudan İngilizce açılır',async t=>{
 const h=await setup(t,{records:[record('waiting',{text:'SENTETİK bekleyen',review:'pending'})],navigatorLanguage:'en-US',query:'?gorunum=bekleyenler'});
 assert.equal(h.w.document.documentElement.lang,'en');assert.equal(h.$('review-queue-heading').firstElementChild.textContent,'Pending review');assert.equal(h.$('review-search').placeholder,'Wording, source quote or topic');
 assert.deepEqual(h.lang.sets,[],'kendiliğinden hiçbir dil kaydedilmez');
});

test('EN | TR anahtarı seçimi sunucuya yazar ve sayfayı yerinde yeniden çizer; yazılan metin kaybolmaz, TR aynı Türkçeyi geri getirir',async t=>{
 const h=await setup(t,{records:[record()]}),d=h.w.document,href=h.w.location.href;
 await h.edit('r1');await h.change('record-text','SENTETİK yazıyorum, kaydetmedim');
 const before=d.body.textContent,summary=h.$('topic-summary').textContent;assert.match(summary,/güncel karar/);
 await h.click(d.querySelector('[data-ui-lang="en"]'));
 assert.deepEqual(h.sent('ui-language-set'),[{language:'en'}]);assert.equal(h.lang.language,'en');
 assert.equal(d.querySelector('[data-ui-lang="en"]').getAttribute('aria-pressed'),'true');assert.equal(d.querySelector('[data-ui-lang="tr"]').getAttribute('aria-pressed'),'false');
 assert.equal(d.documentElement.lang,'en');assert.equal(d.title,'töre — Topics');assert.equal(h.w.location.href,href,'yeniden yükleme ya da adres değişikliği yok');
 assert.equal(h.$('topic-summary').textContent,'1 current decision · 0 current opinions · 0 open questions · 0 open tasks · 0 records pending review');
 assert.equal(h.$('record-heading').textContent,'Decision · review');assert.equal(h.$('record-text').value,'SENTETİK yazıyorum, kaydetmedim');assert.equal(h.$('record-editor').hidden,false);
 assert.equal(h.$('record-review').value,'reviewed');assert.equal(h.$('record-review').selectedOptions[0].textContent,'Reviewed');
 assert.equal(d.querySelector('.app-close').textContent,'Close the app');
 await h.click(d.querySelector('[data-ui-lang="tr"]'));
 assert.deepEqual(h.sent('ui-language-set'),[{language:'en'},{language:'tr'}]);assert.equal(d.documentElement.lang,'tr');
 assert.equal(h.$('topic-summary').textContent,summary);assert.equal(d.body.textContent,before,'Türkçe metin birebir geri gelir');
 assert.equal(h.$('record-text').value,'SENTETİK yazıyorum, kaydetmedim');
});
