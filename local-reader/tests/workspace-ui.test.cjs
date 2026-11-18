'use strict';
const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { Blob } = require('node:buffer');
const { JSDOM } = require('jsdom');
const { loadI18n, languageStore, languageOp, UI_OPS } = require('./i18n-helpers.cjs');
const web = path.resolve(__dirname, '../../web');
const token = 'a'.repeat(64);
const developers = [['openai','OpenAI'],['anthropic','Anthropic'],['google','Google'],['meta','Meta'],['x-ai','xAI'],['deepseek','DeepSeek'],['moonshotai','Moonshot / Kimi'],['z-ai','Z.ai / GLM'],['qwen','Alibaba / Qwen'],['mistralai','Mistral']].map(([id,name])=>({id,name}));
const message = (id, role, text, parentId = null) => ({ id, role, text, parentId, sourceId:id, sourceLocator:'synthetic-fixture:'+id, phase:null, attachments:[], timestamp:null, authorshipStatus:'unreviewed' });
function conversation(overrides = {}) {
  return { schemaVersion:1, id:'c1', provider:'openai', sourceApp:'ChatGPT', sourceConversationId:'source-c1', title:'SENTETİK <img src=x onerror=alert(1)> konuşma', createdAt:'2026-11-14T10:00:00Z', updatedAt:null, selectedLeafId:null, warnings:[], messages:[
    message('m1','user','SENTETİK iletişim demo@example.test, +90 532 123 45 67. Anahtar sk-demo1234567890 ve /Users/demo/ozel.txt. Özel Ad.'),
    message('m2','assistant','<script>window.compromised=true</script> AI önerisi; benim görüşüm sayılmaz.','m1')
  ], ...overrides };
}
const copy = value => JSON.parse(JSON.stringify(value));
async function flush() { for(let i=0;i<12;i++) await new Promise(resolve=>setImmediate(resolve)); }
async function until(predicate, description='UI yanıtı') {
  for(let i=0;i<100;i++){ if(predicate())return; await new Promise(resolve=>setTimeout(resolve,5)); }
  assert.fail(description+' beklenen sürede oluşmadı');
}
async function setup(t, options={}) {
  const dom = new JSDOM(fs.readFileSync(path.join(web,'workspace.html'),'utf8'), { runScripts:'outside-only', url:'http://127.0.0.1:18740/calisma#local='+token });
  t.after(()=>dom.window.close());
  const w=dom.window, requests=[], uiRequests=[], blobs=[], downloads=[], drafts=[], receipts=[], langStore=languageStore(options.uiLanguage??null);
  let conversations=options.empty?[]:[conversation(options.conversation)], configured=false;
  w.Blob=Blob; w.HTMLElement.prototype.scrollIntoView=function(){};
  w.URL.createObjectURL=blob=>{blobs.push(blob);return 'blob:synthetic-'+blobs.length;}; w.URL.revokeObjectURL=()=>{};
  w.HTMLAnchorElement.prototype.click=function(){ downloads.push({name:this.download,href:this.href}); };
  Object.defineProperty(w.navigator,'clipboard',{value:{writeText:async text=>{w.copiedText=text;}}});
  const models=options.models || [
    {id:'openai/free-demo',name:'Ücretsiz sentetik model',developer:'openai',free:true,pricing:{prompt:'0',completion:'0.000'}},
    {id:'openai/paid-demo',name:'Ücretli sentetik model',developer:'openai',free:false,pricing:{prompt:'0.0001',completion:'0.001'}}
  ];
  const previews=new Map(); let sequence=0;
  w.fetch=async (url,request)=>{
    assert.equal(request.method,'POST');assert.equal(request.headers.Authorization,'Bearer '+token);assert.equal(request.credentials,'omit');assert.equal(request.cache,'no-store');
    const op=url.split('/').at(-1), body=JSON.parse(request.body);
    // The interface language is kept apart so the existing request checks stay as they were.
    if(UI_OPS.has(op)){uiRequests.push({op,body});return {ok:true,status:200,json:async()=>copy(languageOp(langStore,op,body))};}
    requests.push({op,body});
    if(options.failOp===op)return {ok:false,status:400,json:async()=>({error:'SENTETİK işlem hatası'})};
    let result;
    switch(op){
      case 'status':result={version:'0.16.0',conversationCount:conversations.length,draftCount:drafts.length,keyConfigured:configured,budgetUsd:0,developers};break;
      case 'list':result={conversations};break;
      case 'conversation':result=conversations.find(c=>c.id===body.id);break;
      case 'catalog':result={models,source:body.refresh?'remote-test':'local-test',updatedAt:'2026-11-14T10:00:00Z',warnings:[]};break;
      case 'key':configured=!!body.key;result={configured};break;
      case 'drafts':result={drafts,receipts};break;
      case 'import-preview':{
        const c=conversation({id:'imported-'+body.provider,provider:body.developer||body.provider,title:body.title||'SENTETİK '+body.provider,messages:body.provider==='generic' && body.text?[message('generic-1','unknown',body.text)]:[message('native-1','user','SENTETİK yerel dışa aktarım')]}), previewId='preview-'+(++sequence);
        previews.set(previewId,[c]);result={previewId,conversations:[c]};break;
      }
      case 'import-commit':{const imported=previews.get(body.previewId).filter(c=>body.selectedIds.includes(c.id));conversations.push(...imported);result=options.commitResult?options.commitResult(imported):{imported:imported.length,skipped:0,conversations:imported};break;}
      case 'records-list':if(!options.recordsList)throw Error('Beklenmeyen test isteği: records-list');result=options.recordsList;break;
      case 'prepare':{
        const source=conversations.find(c=>c.id===body.conversationId), d={...body,id:'draft-'+(++sequence),hash:String(sequence).padStart(64,'b'),createdAt:'2026-11-14T10:00:00Z',status:'ready',messages:body.items.map(item=>({...item,id:item.messageId,role:item.role||source.messages.find(m=>m.id===item.messageId).role})),contextText:body.items.map(item=>item.text+(item.feedback?'\nNot: '+item.feedback:'')).join('\n\n')+'\nSoru: '+body.question,warnings:[]};
        drafts.push(d);result={draft:d,findings:options.serverFindings||[]};break;
      }
      case 'send':{
        const d=drafts.find(d=>d.id===body.draftId); assert.equal(body.hash,d.hash); assert.equal(body.confirmed,true); d.status='sent';
        const c=d.mode==='manual'?null:conversation({id:'new-branch-'+sequence,title:'SENTETİK simülasyon dalı',selectedLeafId:'new-answer',messages:[message('new-answer','assistant','SİMÜLASYON — sentetik yanıt')],sourceApp:'tore'});
        if(c)conversations.push(c);const receipt={draftId:d.id,status:d.mode,mode:d.mode,developer:d.developer};receipts.push(receipt);result={conversation:c,receipt,contextText:d.contextText};break;
      }
      case 'claude-code-sessions':result={sessions:copy(options.sessions||[])};break;
      case 'claude-code-preview':{
        const made=body.sessionIds.map(id=>conversation({id:'cc-'+id,provider:'anthropic',sourceApp:'Claude Code',sourceConversationId:'claude-code-'+id,title:'SENTETİK oturum '+id,messages:[message('cc-m-'+id,'user','SENTETİK Claude Code sözüm')]})), previewId='preview-'+(++sequence);
        previews.set(previewId,made);result={previewId,conversations:made};break;
      }
      case 'revoke':drafts.find(d=>d.id===body.draftId).status='revoked';result={revoked:true};break;
      default:throw Error('Beklenmeyen test isteği: '+op);
    }
    return {ok:true,status:200,json:async()=>copy(result)};
  };
  loadI18n(w,['workspace'],{navigatorLanguage:options.navigatorLanguage||'tr-TR'});
  w.eval(fs.readFileSync(path.join(web,'private-client.js'),'utf8').replace(/^export /gm,''));
  w.eval(fs.readFileSync(path.join(web,'workspace.js'),'utf8').replace(/^import .*;\n/,''));
  await flush();
  const $=id=>w.document.getElementById(id);
  const click=async target=>{(typeof target==='string'?$(target):target).click();await flush();};
  const change=(target,value)=>{const e=typeof target==='string'?$(target):target;e.value=value;e.dispatchEvent(new w.Event(e.tagName==='TEXTAREA'||e.tagName==='INPUT'?'input':'change',{bubbles:true}));};
  const check=async (target,value=true)=>{const e=typeof target==='string'?$(target):target;if(e.checked!==value)e.click();await flush();};
  const open=async()=>{await click(w.document.querySelector('[data-conversation-id]'));};
  const transfer=async()=>{await click('continue-toggle');};
  const card=id=>w.document.querySelector('[data-message-id="'+id+'"]');
  const field=(id,name)=>card(id).querySelector('[data-field="'+name+'"]');
  return {w,$,click,change,check,open,transfer,card,field,requests,uiRequests,langStore,blobs,downloads,drafts,receipts};
}

test('kaynak metin HTML olarak çalışmaz; yerel yetki URL’den temizlenir, ilk açılış ağ kataloğunu yenilemez',async t=>{
  const h=await setup(t);await h.open();
  assert.equal(h.w.location.hash,'');assert.equal(h.w.sessionStorage.getItem('tore-local-session'),token);
  assert.equal(h.w.localStorage.length,0);assert.equal(h.$('target-developer').options.length,10);
  assert.equal(h.w.document.querySelector('img,[onerror]'),null);assert.equal(h.w.compromised,undefined);
  assert.ok(h.$('conversation-title').textContent.includes('<img'));assert.ok(h.card('m2').textContent.includes('<script>'));
  assert.deepEqual(h.requests.filter(r=>r.op==='catalog').map(r=>r.body),[{refresh:false}]);
  assert.equal(h.$('run-mode').value,'manual');assert.equal(h.$('prepare-draft').disabled,true);
  assert.equal(h.requests.some(r=>r.op.startsWith('claude-code')),false);
});

test('seçim ve maskeleme yalnız incelenen kopyayı etkiler; elle aktarım açık taslak onayını bekler',async t=>{
  const h=await setup(t);await h.open();await h.transfer();await h.check(h.card('m1').querySelector('[data-action="select-message"]'));
  h.change('literal-masks','Özel Ad');await h.click('scan-pii');assert.match(h.$('pii-before-count').textContent,/5 bulgu/);
  await h.click('apply-masks');const edited=h.field('m1','text').value;
  for(const token of ['[E-POSTA]','[TELEFON]','[ANAHTAR]','[DOSYA YOLU]','[ÖZEL İFADE]'])assert.ok(edited.includes(token),token);
  assert.match(h.card('m1').querySelector('details pre').textContent,/demo@example.test/);assert.match(h.$('pii-after-count').textContent,/0 bulgu/);
  h.change('run-mode','manual');h.change('target-question','Bu düşünceyi nasıl geliştirebilirim?');assert.equal(h.$('prepare-draft').disabled,false);
  await h.click('prepare-draft');const prepared=h.requests.find(r=>r.op==='prepare').body;
  assert.deepEqual(prepared.items.map(item=>item.messageId),['m1']);assert.equal(prepared.items[0].text,edited);assert.equal(prepared.modelId,'');assert.equal(prepared.mode,'manual');
  assert.equal(h.$('draft-panel').hidden,false);assert.equal(h.$('draft-hash').textContent.length,64);assert.equal(h.$('execute-draft').disabled,true);
  assert.equal(h.requests.some(r=>r.op==='send'),false);
  await h.check('send-consent');await h.click('execute-draft');assert.equal(h.requests.filter(r=>r.op==='send').length,1);
  assert.match(h.$('result-heading').textContent,/Devam metnin hazır/);await h.click(h.$('result-actions').querySelector('button'));assert.equal(h.w.copiedText,h.$('result-text').textContent);
});

test('metin değişikliği eski onayı iptal eder; çalışma alanı yalnız konuşmaya devam taslağı hazırlar',async t=>{
  const h=await setup(t,{conversation:{messages:[message('m1','user','SENTETİK temiz katkım')]}});await h.open();await h.transfer();await h.check(h.card('m1').querySelector('input[type=checkbox]'));
  for(const id of ['intent-continue','intent-dataset','dataset-fields','dataset-purpose','export-consent','export-consent-label'])assert.equal(h.$(id),null,id);
  assert.doesNotMatch(h.w.document.body.textContent,/[Vv]eri paketi|paketle|[Mm]odel eğitimi/);
  h.change('run-mode','manual');h.change('target-question','Bu fikri aç.');await h.click('prepare-draft');await h.check('send-consent');assert.equal(h.$('execute-draft').disabled,false);
  h.change(h.field('m1','text'),'SENTETİK düzeltilmiş katkım');assert.equal(h.$('draft-panel').hidden,true);assert.equal(h.$('send-consent').checked,false);assert.equal(h.$('prepare-draft').disabled,false);
  await h.click('prepare-draft');const prepared=h.requests.filter(r=>r.op==='prepare').at(-1).body;
  assert.equal(prepared.intent,'continue');assert.equal('purpose' in prepared,false);assert.equal(prepared.mode,'manual');assert.equal(prepared.items[0].text,'SENTETİK düzeltilmiş katkım');
  assert.equal(h.$('draft-purpose').textContent,'Konuşmaya devam');assert.equal(h.$('execute-draft').disabled,true);
  await h.check('send-consent');await h.click('execute-draft');assert.equal(h.requests.filter(r=>r.op==='send').length,1);assert.equal(h.requests.some(r=>r.op==='export'),false);
  const actions=[...h.$('result-actions').querySelectorAll('button')];assert.equal(actions.length,2);await h.click(actions[1]);
  assert.deepEqual(h.downloads.map(d=>d.name),['tore-devam-metni.txt']);assert.match(await h.blobs[0].text(),/düzeltilmiş/);
  const draftId=h.drafts.at(-1).id;await h.click('revoke-'+draftId);assert.equal(h.requests.at(-2).op,'revoke');assert.equal(h.$('result-actions').children.length,0);assert.match(h.$('result-status').textContent,/geri çağrılamaz/);
});

test('dallanmış kaynak boş açılmaz, en son sürüm görünür; diğer sürüme ait mesaj hazırlığa sızmaz',async t=>{
  const h=await setup(t,{conversation:{messages:[message('root','user','SENTETİK ortak başlangıç'),message('left','assistant','SENTETİK A dalı','root'),message('right','assistant','SENTETİK B dalı','root')]}});await h.open();
  const shown=()=>[...h.w.document.querySelectorAll('[data-message-id]')].map(e=>e.dataset.messageId);
  assert.equal(h.$('branch-bar').hidden,false);assert.equal(h.$('branch-leaf').value,'right');assert.deepEqual(shown(),['root','right']);
  h.change('branch-leaf','left');assert.deepEqual(shown(),['root','left']);
  await h.transfer();await h.click('select-human');h.change('run-mode','simulation');h.change('target-question','Sonraki adım?');await h.click('prepare-draft');
  const prepared=h.requests.find(r=>r.op==='prepare').body;assert.equal(prepared.leafId,'left');assert.deepEqual(prepared.items.map(i=>i.messageId),['root']);
  await h.check('send-consent');await h.click('execute-draft');assert.match(h.$('result-heading').textContent,/Örnek yanıt/);assert.match(h.$('result-text').textContent,/SİMÜLASYON/);assert.equal(h.$('conversation-title').textContent,'SENTETİK simülasyon dalı');
});

test('üç yerel dışa aktarım türü dosya önizlemesi ve açık seçimle içe alınır',async t=>{
  for(const provider of ['chatgpt','claude','codex']){
    await t.test(provider,async t=>{
      const h=await setup(t,{empty:true});await h.click('welcome-import');h.change('import-provider',provider);
      const file=new h.w.File(['SENTETİK export'],provider+(provider==='codex'?'.jsonl':'.json'),{type:'application/json'});Object.defineProperty(h.$('import-file'),'files',{configurable:true,value:[file]});
      await h.click('preview-import');await until(()=>!h.$('import-preview').hidden,'Dosya önizlemesi');
      const body=h.requests.find(r=>r.op==='import-preview').body;assert.equal(body.provider,provider);assert.equal(Buffer.from(body.contentBase64,'base64').toString(),'SENTETİK export');
      assert.equal(h.$('commit-import').disabled,true);await h.check(h.$('import-preview-list').querySelector('input'));await h.click('commit-import');
      assert.equal(h.requests.filter(r=>r.op==='import-commit').length,1);assert.match(h.$('conversation-title').textContent,new RegExp(provider));
    });
  }
});

test('genel metnin konuşmacısı uydurulmaz; kullanıcı seçimi yalnız hazırlanan kopyaya girer',async t=>{
  const h=await setup(t,{empty:true});await h.click('welcome-import');h.change('import-provider','generic');h.change('import-developer','google');h.change('import-title','SENTETİK yapıştırma');h.change('import-text','SENTETİK kaynağı belirsiz metin');
  await h.click('preview-import');await h.check(h.$('import-preview-list').querySelector('input'));await h.click('commit-import');
  await h.transfer();await h.check(h.card('generic-1').querySelector('input[type=checkbox]'));h.change('target-question','Bunu tartış.');assert.equal(h.$('prepare-draft').disabled,true);
  assert.equal(h.field('generic-1','role').value,'');h.change(h.field('generic-1','role'),'user');await h.click('prepare-draft');assert.equal(h.requests.find(r=>r.op==='prepare').body.items[0].role,'user');
  assert.equal(h.card('generic-1').querySelector('.message-role').textContent,'Konuşmacı belirsiz');
});

test('genel Töre dosyası metin seçeneğinden ayrı yüklenir; Codex sıkıştırılmış uzantısı kabul edilir',async t=>{
  const h=await setup(t,{empty:true});await h.click('welcome-import');assert.match(h.$('import-file').accept,/\.jsonl\.zst/);
  h.change('import-provider','generic');assert.equal(h.$('import-file-field').hidden,true);h.change('import-generic-format','file');assert.equal(h.$('import-file-field').hidden,false);assert.equal(h.$('import-text-fields').hidden,true);
  const file=new h.w.File(['{"synthetic":true}'],'tore-conversation.json',{type:'application/json'});Object.defineProperty(h.$('import-file'),'files',{configurable:true,value:[file]});
  await h.click('preview-import');await until(()=>!h.$('import-preview').hidden);const body=h.requests.find(r=>r.op==='import-preview').body;assert.equal(body.provider,'generic');assert.equal(body.text,undefined);assert.equal(body.fileName,'tore-conversation.json');
  await h.check(h.$('import-preview-list').querySelector('input'));await h.click('commit-import');assert.match(h.$('conversation-title').textContent,/generic/);
});

test('mesajın model kaynağı metin olarak görünür',async t=>{
  const h=await setup(t,{conversation:{messages:[{...message('m1','assistant','SENTETİK model yanıtı'),model:'sentetik/<img src=x>'}]}});await h.open();
  assert.match(h.card('m1').querySelector('.source-info').textContent,/Model: sentetik\/<img/);assert.equal(h.w.document.querySelector('img'),null);
});

test('anahtar yalnız oturum hizmetine gider; canlı modelde yenileme ve sıfır fiyat koşulları birlikte aranır',async t=>{
  const h=await setup(t,{conversation:{messages:[message('m1','user','SENTETİK katkı')]},models:[
    {id:'openai/zero',name:'Sıfır fiyat',developer:'openai',free:true,pricing:{prompt:'0',completion:'0.00'}},
    {id:'openai/paid',name:'Ücretli',developer:'openai',free:false,pricing:{prompt:'1',completion:'1'}},
    {id:'openai/underflow',name:'Sıfıra yuvarlanabilecek ücret',developer:'openai',free:true,pricing:{prompt:'1e-999',completion:'0'}},
    {id:'openai/missing',name:'Eksik fiyat',developer:'openai',free:true,pricing:{completion:'0'}}
  ]});await h.open();await h.transfer();await h.click('select-human');h.change('target-question','Fikrimi incele.');
  assert.equal(h.$('settings-toggle').hidden,true);h.change('run-mode','live');assert.equal(h.$('settings-toggle').hidden,false);assert.equal(h.$('prepare-draft').disabled,true);
  h.change('api-key','sk-SYNTHETIC-KEY-ONLY');await h.click('save-key');assert.equal(h.$('api-key').value,'');
  assert.equal(h.w.localStorage.length,0);assert.equal(h.w.sessionStorage.length,1);assert.equal(h.w.sessionStorage.getItem('tore-local-session'),token);
  assert.deepEqual(h.requests.find(r=>r.op==='key').body,{key:'sk-SYNTHETIC-KEY-ONLY'});assert.equal(h.$('prepare-draft').disabled,true);
  await h.click('refresh-catalog');for(const id of ['paid','underflow','missing'])assert.equal(h.$('target-model').querySelector('[value="openai/'+id+'"]').disabled,true);
  assert.equal(h.$('target-model').querySelector('[value="openai/zero"]').disabled,false);h.change('target-model','openai/zero');assert.equal(h.$('prepare-draft').disabled,false);
  await h.click('prepare-draft');assert.equal(h.requests.find(r=>r.op==='prepare').body.mode,'live');assert.equal(h.requests.some(r=>r.op==='send'),false);
  await h.click('clear-key');assert.deepEqual(h.requests.filter(r=>r.op==='key').at(-1).body,{key:''});assert.equal(h.$('api-key').value,'');assert.equal(h.$('prepare-draft').disabled,true);
});

test('sunucu özel bilgi bulduğunda onay işaretlense bile gönderim kapalıdır',async t=>{
  const h=await setup(t,{serverFindings:[{messageId:'m1',kind:'Telefon',value:'SENTETİK'}]});await h.open();await h.transfer();await h.click('select-human');h.change('target-question','Kontrol et.');await h.click('prepare-draft');await h.check('send-consent');
  assert.equal(h.$('execute-draft').disabled,true);assert.match(h.$('draft-warnings').textContent,/çıkışı kapalıdır/);assert.equal(h.requests.some(r=>r.op==='send'),false);
});

test('sistem ve araç kayıtları aktarılmaz; AI yanıtının insan beyanı seçeneği kapalıdır',async t=>{
  const h=await setup(t,{conversation:{messages:[message('sys','system','SENTETİK talimat'),message('m1','user','SENTETİK kullanıcı','sys'),message('m2','assistant','SENTETİK AI','m1')]}});await h.open();await h.transfer();
  assert.equal(h.card('sys').querySelector('input[type=checkbox]').disabled,true);await h.check(h.card('m2').querySelector('input[type=checkbox]'));
  assert.equal(h.field('m2','authorship').querySelector('[value=human_original]').disabled,true);
});

test('hizmet hataları inline görünür; başarısız işlem başarı ekranı üretmez',async t=>{
  const h=await setup(t,{failOp:'prepare'});await h.open();await h.transfer();await h.click('select-human');h.change('target-question','İncele.');await h.click('prepare-draft');
  assert.equal(h.$('action-error').hidden,false);assert.match(h.$('action-error').textContent,/SENTETİK işlem hatası/);assert.equal(h.$('draft-panel').hidden,true);assert.equal(h.$('result-panel').hidden,true);
  assert.equal(h.$('action-error').getAttribute('role'),'alert');assert.equal(h.$('global-status').classList.contains('error'),false);
});

const session=(n,imported=false)=>({id:'00000000-0000-4000-8000-'+String(n).padStart(12,'0'),project:'-Users-demo-Desktop-sentetik-proje',modifiedAt:'2026-11-'+String(10+(n%10)).padStart(2,'0')+'T10:00:00+00:00',bytes:2048*n,sourceConversationId:'claude-code-'+n,imported});

test('üst menü ortak sıradadır; sürüm, eski marka hedefi ve teknik ibareler ekranda yoktur',async t=>{
  const h=await setup(t,{empty:true}),d=h.w.document;
  assert.equal(d.title,'töre — Konuşmalarım');assert.equal(d.querySelector('.version'),null);
  assert.equal(d.querySelector('header.topbar a.brand').getAttribute('href'),'/');
  assert.deepEqual([...d.querySelectorAll('nav[aria-label="Ana gezinme"] a')].map(a=>[a.textContent,a.getAttribute('href')]),[['Konular','/konular'],['Seni bekleyenler','/konular?gorunum=bekleyenler'],['Haritam','/harita'],['Konuşmalar','/calisma']]);
  assert.equal(d.querySelector('nav[aria-label="Ana gezinme"] [aria-current="page"]').textContent,'Konuşmalar');assert.deepEqual([...d.querySelectorAll('.subnav a')].map(a=>[a.textContent,a.getAttribute('href')]),[['Konuşmalar','/calisma'],['Güncelle','/guncelle'],['Arşiv','/arsiv']],'Güncelle ve Arşiv Konuşmalar altından açılır');assert.match(d.querySelector('.private-mark').textContent,/Bu bilgisayarda/);
  assert.deepEqual([...d.querySelectorAll('h1')].map(e=>e.textContent),['Konuşmalar']);assert.ok(d.querySelector('.page-head h1'),'0.16: tek satırlık sayfa başı');assert.equal(d.querySelector('.hero'),null,'büyük başlık bloğu yok');assert.equal(d.querySelector('h1,h2,h3').tagName,'H1');
  assert.doesNotMatch(d.body.textContent,/0\.1\d\.\d|[Tt]eknik demo|Töre|kullanıcı|Kullanıcı/);
  assert.equal(h.$('welcome').hidden,false);assert.match(h.$('welcome-text').textContent,/Önce bir konuşma içe al/);assert.equal(h.$('welcome').querySelectorAll('button.primary').length,1);
  await h.click('welcome-import');assert.equal(h.$('import-panel').hidden,false);assert.match(h.$('import-help-steps').textContent,/Verileri dışa aktar/);
  h.change('import-provider','claude');assert.match(h.$('import-help-steps').textContent,/Claude/);
});

test('Claude Code oturumları yalnız düğmeyle listelenir; içe alınmışlar seçilemez, en fazla 50 seçilir',async t=>{
  const sessions=[session(1,true),...Array.from({length:53},(_,i)=>session(i+2))];
  const h=await setup(t,{empty:true,sessions});const asked=()=>h.requests.filter(r=>r.op==='claude-code-sessions');
  await h.click('welcome-import');h.change('import-provider','claude-code');await flush();
  assert.equal(asked().length,0);assert.equal(h.$('cc-panel').hidden,false);assert.equal(h.$('file-import').hidden,true);assert.equal(h.$('cc-chooser').hidden,true);
  assert.match(h.$('cc-panel').textContent,/Araç çağrıları, araç çıktıları ve düşünme alınmaz/);assert.match(h.$('cc-panel').textContent,/arka planda hiçbir şey izlemez/);
  await h.click('cc-list');assert.deepEqual(asked().map(r=>r.body),[{}]);assert.equal(h.$('cc-chooser').hidden,false);
  const rows=[...h.$('cc-sessions').querySelectorAll('.import-choice')];assert.equal(rows.length,54);
  assert.match(rows[0].textContent,/Desktop-sentetik-proje/);assert.doesNotMatch(rows[0].textContent,/Users-demo|00000000-/);assert.match(rows[0].textContent,/2 KB/);assert.match(rows[0].textContent,/içe alındı/);
  const first=rows[0].querySelector('input');assert.equal(first.disabled,true);first.click();await flush();assert.equal(first.checked,false);assert.equal(h.$('cc-preview').disabled,true);
  await h.click('cc-select-all');const checked=()=>[...h.$('cc-sessions').querySelectorAll('input:checked')];
  assert.equal(checked().length,50);assert.equal(checked().some(c=>c.value===sessions[0].id),false);assert.match(h.$('cc-status').textContent,/en fazla 50/);
  const extra=[...h.$('cc-sessions').querySelectorAll('input:not(:checked):not(:disabled)')][0];extra.click();await flush();assert.equal(extra.checked,false);assert.equal(checked().length,50);
  assert.equal(h.$('cc-preview').disabled,false);assert.equal(h.requests.some(r=>r.op==='claude-code-preview'),false);
  await h.click('cc-clear');assert.equal(checked().length,0);assert.equal(h.$('cc-preview').disabled,true);
});

test('Claude Code önizlemesi mevcut içe alma onayına bağlanır; seçim değişince eski önizleme düşer',async t=>{
  const sessions=[session(1,true),session(2),session(3)],h=await setup(t,{empty:true,sessions});
  await h.click('welcome-import');h.change('import-provider','claude-code');await h.click('cc-list');
  const boxes=[...h.$('cc-sessions').querySelectorAll('input')];await h.check(boxes[1]);await h.check(boxes[2]);await h.click('cc-preview');
  assert.deepEqual(h.requests.find(r=>r.op==='claude-code-preview').body,{sessionIds:[sessions[1].id,sessions[2].id]});
  assert.equal(h.requests.some(r=>r.op==='import-preview'),false);assert.equal(h.$('import-preview').hidden,false);assert.equal(h.$('import-preview-list').querySelectorAll('input').length,2);
  assert.equal(h.requests.some(r=>r.op==='import-commit'),false);
  await h.check(boxes[2],false);assert.equal(h.$('import-preview').hidden,true);assert.equal(h.$('commit-import').disabled,true);
  await h.click('cc-preview');await h.click('preview-clear');assert.equal(h.$('commit-import').disabled,true);await h.click('preview-select-all');assert.equal(h.$('commit-import').disabled,false);
  await h.click('commit-import');const commit=h.requests.filter(r=>r.op==='import-commit');assert.equal(commit.length,1);
  assert.equal(commit[0].body.previewId,'preview-2');assert.deepEqual(commit[0].body.selectedIds,['cc-'+sessions[1].id]);
  assert.match(h.$('conversation-title').textContent,/SENTETİK oturum/);assert.equal(h.$('cc-chooser').hidden,true);
  assert.equal(h.requests.filter(r=>r.op==='claude-code-sessions').length,1);
});

test('oturum listesi hatası düğmenin yanında görünür ve ne yapılacağını söyler',async t=>{
  const h=await setup(t,{empty:true,failOp:'claude-code-sessions'});await h.click('welcome-import');h.change('import-provider','claude-code');await h.click('cc-list');
  const alert=h.$('cc-list').closest('.actions').nextElementSibling;assert.equal(alert.getAttribute('role'),'alert');assert.equal(alert.hidden,false);assert.match(alert.textContent,/SENTETİK işlem hatası/);
  assert.equal(h.$('cc-chooser').hidden,true);assert.equal(h.$('global-status').classList.contains('error'),false);
});

test('içe almadan sonra birincil yol kayda geçirmektir; başka modele taşıma ikincildir ve kapalı gelir',async t=>{
  const h=await setup(t,{empty:true});await h.click('welcome-import');h.change('import-provider','chatgpt');
  const file=new h.w.File(['SENTETİK export'],'export.json',{type:'application/json'});Object.defineProperty(h.$('import-file'),'files',{configurable:true,value:[file]});
  await h.click('preview-import');await until(()=>!h.$('import-preview').hidden);assert.equal(h.$('commit-import').disabled,true);
  await h.click('preview-select-all');assert.equal(h.$('commit-import').disabled,false);await h.click('commit-import');
  assert.equal(h.$('import-done').hidden,false);assert.match(h.$('import-done').textContent,/1 konuşma içe alındı/);
  const primary=[...h.$('next-step').querySelectorAll('.primary')];assert.deepEqual(primary.map(e=>e.id),['primary-record']);
  assert.equal(h.$('primary-record').getAttribute('href'),'/konular?conversationId=imported-chatgpt&messageId=native-1');assert.equal(h.$('to-topics').getAttribute('href'),'/konular');
  assert.equal(h.card('native-1').querySelector('[data-source-record]').getAttribute('href'),'/konular?conversationId=imported-chatgpt&messageId=native-1');
  assert.equal(h.$('continue-panel').hidden,true);assert.equal(h.$('continue-toggle').getAttribute('aria-expanded'),'false');assert.equal(h.$('continue-toggle').classList.contains('primary'),false);
  assert.equal(h.card('native-1').querySelector('[data-action="select-message"]').hidden,true);
  const detail=h.card('native-1').querySelector('details.detail');assert.equal(detail.open,false);assert.match(detail.textContent,/synthetic-fixture/);
  assert.doesNotMatch(h.card('native-1').textContent.replace(detail.textContent,''),/synthetic-fixture/);
  assert.equal(h.requests.some(r=>['prepare','send'].includes(r.op)),false);
  await h.transfer();assert.equal(h.$('continue-panel').hidden,false);assert.equal(h.card('native-1').querySelector('[data-action="select-message"]').hidden,false);
});

test('varsayılan kip anahtar ve ağ istemez; yine de açık onay olmadan metin çıkmaz',async t=>{
  const h=await setup(t,{conversation:{messages:[message('m1','user','SENTETİK katkı')]}});await h.open();await h.transfer();
  assert.equal(h.$('run-mode').value,'manual');assert.equal(h.$('run-mode').options[0].value,'manual');assert.equal(h.$('model-field').hidden,true);assert.equal(h.$('settings-toggle').hidden,true);
  await h.click('select-human');h.change('target-question','Devam edelim.');assert.equal(h.$('prepare-draft').disabled,false);
  await h.click('prepare-draft');const prepared=h.requests.find(r=>r.op==='prepare').body;assert.equal(prepared.mode,'manual');assert.equal(prepared.modelId,'');
  assert.equal(h.requests.some(r=>r.op==='key'),false);assert.equal(h.requests.some(r=>r.op==='catalog'&&r.body.refresh),false);
  assert.equal(h.$('execute-draft').disabled,true);h.$('execute-draft').click();await flush();assert.equal(h.requests.some(r=>r.op==='send'),false);
  assert.match(h.$('draft-heading').textContent,/[Dd]evam metnin/);await h.check('send-consent');await h.click('execute-draft');assert.equal(h.requests.filter(r=>r.op==='send').length,1);
});

test('içe almadan sonra döküm yalnız dönen sayılarla ne okunduğunu, neyin neden atlandığını ve kaç kaydın beklediğini söyler',async t=>{
  const sessions=[session(1),session(2),session(3)],pending=n=>Array.from({length:n},(_,i)=>({id:'p'+i,review:'pending'}));
  const h=await setup(t,{empty:true,sessions,recordsList:{records:[...pending(3),{id:'done',review:'reviewed'}]}});
  await h.click('welcome-import');h.change('import-provider','claude-code');await h.click('cc-list');
  const boxes=[...h.$('cc-sessions').querySelectorAll('input')];await h.check(boxes[0]);await h.check(boxes[1]);await h.click('cc-preview');
  const previewed=[...h.$('import-preview-list').querySelectorAll('input')];assert.equal(previewed.length,2);await h.check(previewed[1],false);
  assert.equal(h.$('import-receipt').hidden,true,'döküm içe almadan önce görünmez');await h.click('commit-import');
  const receipt=h.$('import-receipt'),rows=[...h.$('receipt-rows').querySelectorAll('tr')].map(tr=>[...tr.children].map(td=>td.textContent));
  assert.equal(receipt.hidden,false);assert.equal(h.$('receipt-heading').textContent,'töre neleri okudu');assert.equal(h.$('receipt-source').textContent,'Bu bilgisayardaki Claude Code oturumları');
  assert.deepEqual(rows.map(r=>r.slice(0,2)),[['Bulunan konuşma','2'],['Mesaj','2'],['İçe alınan konuşma','1'],['Atlandı: seçmediğin','1']]);
  assert.match(rows[3][2],/Sen seçmedin/);assert.equal(rows.some(r=>/Okunan dosya|zaten/.test(r[0])),false,'olmayan dosya ya da atlama yazılmaz');
  assert.equal(h.$('receipt-waiting').hidden,false);assert.equal(h.$('receipt-waiting').textContent,'Şu an 3 kayıt incelemeni bekliyor.');
  assert.equal(h.$('receipt-waiting-link').getAttribute('href'),'/konular?gorunum=bekleyenler');assert.equal(h.$('receipt-waiting-link').textContent,'Seni bekleyenler');
  assert.ok(receipt.querySelector('table caption'));assert.equal(receipt.querySelectorAll('th[scope="col"]').length,3);
  await h.click('receipt-close');assert.equal(receipt.hidden,true);assert.equal(h.w.document.activeElement,h.$('import-toggle'));
});

test('içe alma yanıtı sayı vermezse döküm o satırı uydurmaz; bekleyen sayısı okunamazsa satır gizli kalır',async t=>{
  const h=await setup(t,{empty:true,commitResult:imported=>({conversations:imported,skipped:'bilinmiyor'})});
  await h.click('welcome-import');h.change('import-provider','chatgpt');
  const file=new h.w.File(['SENTETİK export'],'sentetik-export.zip',{type:'application/zip'});Object.defineProperty(h.$('import-file'),'files',{configurable:true,value:[file]});
  await h.click('preview-import');await until(()=>!h.$('import-preview').hidden,'Dosya önizlemesi');await h.click('preview-select-all');await h.click('commit-import');
  const rows=[...h.$('receipt-rows').querySelectorAll('tr')].map(tr=>[...tr.children].map(td=>td.textContent));
  assert.deepEqual(rows,[['Okunan dosya','1','sentetik-export.zip'],['Bulunan konuşma','1','Okundu'],['Mesaj','1','Bulunan konuşmalarda, okundu']]);
  assert.equal(h.$('receipt-source').textContent,'Dosya: sentetik-export.zip');assert.equal(h.$('receipt-waiting').hidden,true,'okunamayan sayı tahmin edilmez');
  assert.doesNotMatch(h.$('import-receipt').textContent,/undefined|NaN|bilinmiyor/);assert.match(h.$('import-done').textContent,/İçe alma tamamlandı/);
});

// 0.16 step 4: /calisma in English, and the EN | TR switch.
const ccImport=async h=>{
  await h.click('welcome-import');h.change('import-provider','claude-code');await h.click('cc-list');
  const boxes=[...h.$('cc-sessions').querySelectorAll('input')];await h.check(boxes[0]);await h.check(boxes[1]);await h.click('cc-preview');
  const previewed=[...h.$('import-preview-list').querySelectorAll('input')];await h.check(previewed[1],false);await h.click('commit-import');
};
const rowsOf=h=>[...h.$('receipt-rows').querySelectorAll('tr')].map(tr=>[...tr.children].map(td=>td.textContent));

test('kayıtlı dil İngilizceyse /calisma İngilizce açılır: menü, liste, açık konuşma, içe alma formu ve döküm',async t=>{
  const pending=n=>Array.from({length:n},(_,i)=>({id:'p'+i,review:'pending'}));
  const h=await setup(t,{uiLanguage:'en',navigatorLanguage:'tr-TR',sessions:[session(1),session(2),session(3)],recordsList:{records:[...pending(3),{id:'done',review:'reviewed'}]}}),d=h.w.document;
  assert.deepEqual(h.uiRequests.map(r=>r.op),['ui-language-get']);
  assert.equal(d.documentElement.lang,'en');assert.equal(d.title,'töre — My conversations');
  assert.deepEqual([...d.querySelectorAll('header.topbar nav a')].map(a=>a.textContent),['Topics','Waiting for you','My map','Conversations']);
  assert.deepEqual([...d.querySelectorAll('.subnav a')].map(a=>a.textContent),['Conversations','Update','Archive']);
  assert.equal(d.querySelector('header nav').getAttribute('aria-label'),'Main navigation');assert.match(d.querySelector('.private-mark').textContent,/On this computer/);
  assert.equal(d.querySelector('[data-ui-lang="en"]').getAttribute('aria-pressed'),'true');assert.equal(d.querySelector('[data-ui-lang="tr"]').getAttribute('aria-pressed'),'false');
  assert.equal(d.querySelector('h1').textContent,'Conversations');assert.equal(d.querySelector('.page-meta').textContent,'1 conversation · originals never change');
  assert.equal(h.$('global-status').textContent,'Your conversations are ready.');assert.equal(h.$('welcome-heading').textContent,'Open a conversation.');
  assert.equal(h.$('conversation-search').placeholder,'Title or source');assert.equal(h.$('import-toggle').textContent,'+ Import');
  assert.match(d.querySelector('.card-meta').textContent,/^2 messages · 14 Nov 2026$/);
  await h.open();
  assert.match(h.$('conversation-meta').textContent,/^2 messages · /);assert.equal(h.card('m1').querySelector('.message-role').textContent,'You');assert.equal(h.card('m2').querySelector('.message-role').textContent,'AI reply');
  assert.equal(h.card('m1').querySelector('.record-link').textContent,'Save as record');assert.match(h.$('next-step').textContent,/Next step: save something that matters as a record/);
  assert.equal(h.$('continue-toggle').textContent,'Continue with another model');
  await h.transfer();assert.equal(h.$('prepare-hint').textContent,'Tick at least one message to take along.');assert.equal(h.$('run-mode').options[0].textContent,'Copy or download (recommended)');assert.equal(h.$('run-mode').querySelector('optgroup').label,'Advanced');
  await h.check(h.field('m1','text').closest('.message-card').querySelector('[data-action="select-message"]'));assert.equal(h.$('selection-count').textContent,'1 selected');
  await h.click('import-toggle');assert.equal(h.$('import-heading').textContent,'Import a conversation');assert.equal(h.$('import-provider').options[0].textContent,'ChatGPT · export file');
  assert.match(h.$('import-help-steps').textContent,/In ChatGPT, go to Settings > Data controls > Export data\./);assert.equal(h.$('preview-import').textContent,'Show what is inside');assert.equal(h.$('import-file-hint').textContent,'ZIP or conversations.json');
  h.change('import-provider','generic');assert.equal(h.$('preview-import').textContent,'Preview');assert.equal(h.$('import-title').placeholder,'For example: On my product idea');
  h.change('import-provider','claude-code');await h.click('cc-list');assert.equal(h.$('cc-status').textContent,'3 sessions found. Tick the ones you want.');
  await h.click('import-close');await ccImport(h);
  assert.equal(h.$('receipt-heading').textContent,'What töre read');assert.equal(h.$('receipt-source').textContent,'Claude Code sessions on this computer');
  assert.deepEqual(rowsOf(h),[['Conversations found','2','Read'],['Messages','2','In the conversations found, read'],['Conversations imported','1','Added to Conversations'],['Skipped: not selected','1','You did not select it; not imported']]);
  assert.equal(h.$('receipt-waiting').textContent,'3 records are waiting for your review.');assert.equal(h.$('receipt-waiting-link').textContent,'Waiting for you');
  assert.equal(h.$('global-status').textContent,'1 conversation imported.');assert.equal(h.$('import-done').textContent,'1 conversation imported. It is open below.');
  assert.deepEqual([...h.$('import-receipt').querySelectorAll('th')].map(th=>th.textContent),['What','Count','Note']);
});

test('kayıtlı seçim yoksa tarayıcı dili seçer: İngilizce tarayıcıda İngilizce, Türkçe tarayıcıda Türkçe',async t=>{
  const en=await setup(t,{navigatorLanguage:'en-US',empty:true});
  assert.equal(en.w.document.documentElement.lang,'en');assert.equal(en.$('welcome-heading').textContent,'Your AI conversations live here.');assert.equal(en.$('global-status').textContent,'No conversations yet. Import your first one.');
  assert.equal(en.w.document.querySelector('.page-meta').textContent,'0 conversations · originals never change');
  const tr=await setup(t,{empty:true});
  assert.equal(tr.w.document.documentElement.lang,'tr');assert.equal(tr.$('welcome-heading').textContent,'Burada AI konuşmaların durur.');assert.equal(tr.w.document.querySelector('.page-meta').textContent,'0 konuşma · aslı değişmez');
  assert.deepEqual(en.uiRequests.concat(tr.uiRequests).map(r=>r.op),['ui-language-get','ui-language-get'],'tarayıcı dili kaydedilmez');
});

test('EN | TR anahtarı seçimi kaydeder ve sayfayı yerinde yeniden çizer; seçim ve düzenleme kaybolmaz, TR aynı Türkçeye döner',async t=>{
  const pending=n=>Array.from({length:n},(_,i)=>({id:'p'+i,review:'pending'}));
  const h=await setup(t,{sessions:[session(1),session(2),session(3)],recordsList:{records:pending(2)}}),d=h.w.document;
  await ccImport(h);await h.open();await h.transfer();
  const box=h.card('m1').querySelector('[data-action="select-message"]');await h.check(box);h.change(h.field('m1','text'),'SENTETİK düzenlenmiş kopya');
  const before=d.body.textContent,beforeRows=rowsOf(h);assert.equal(h.$('receipt-waiting').textContent,'Şu an 2 kayıt incelemeni bekliyor.');
  const requestCount=h.requests.length;
  await h.click(d.querySelector('[data-ui-lang="en"]'));
  assert.deepEqual(h.uiRequests.map(r=>[r.op,r.body]),[['ui-language-get',{}],['ui-language-set',{language:'en'}]]);assert.equal(h.langStore.language,'en');
  assert.equal(h.requests.length,requestCount,'dil değişimi başka istek göndermez');
  assert.equal(d.documentElement.lang,'en');assert.equal(d.querySelector('[data-ui-lang="en"]').getAttribute('aria-pressed'),'true');assert.equal(d.querySelector('[data-ui-lang="tr"]').getAttribute('aria-pressed'),'false');
  assert.equal(d.title,'töre — My conversations');assert.equal(d.querySelector('h1').textContent,'Conversations');
  assert.equal(h.$('receipt-heading').textContent,'What töre read');assert.equal(rowsOf(h)[0][0],'Conversations found');assert.equal(h.$('receipt-waiting').textContent,'2 records are waiting for your review.');
  assert.equal(h.card('m1').querySelector('.message-role').textContent,'You');assert.equal(h.$('selection-count').textContent,'1 selected');
  assert.equal(h.card('m1').querySelector('[data-action="select-message"]').checked,true,'seçim yerinde');assert.equal(h.field('m1','text').value,'SENTETİK düzenlenmiş kopya','düzenleme yerinde');
  assert.equal(h.$('global-status').textContent,'1 conversation imported.');
  await h.click(d.querySelector('[data-ui-lang="tr"]'));
  assert.deepEqual(h.uiRequests.at(-1),{op:'ui-language-set',body:{language:'tr'}});assert.equal(d.documentElement.lang,'tr');assert.equal(d.title,'töre — Konuşmalarım');
  assert.equal(d.body.textContent,before,'Türkçeye dönünce metin birebir aynı');assert.deepEqual(rowsOf(h),beforeRows);
  assert.equal(h.field('m1','text').value,'SENTETİK düzenlenmiş kopya');
});
