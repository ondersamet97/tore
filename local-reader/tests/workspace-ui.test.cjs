'use strict';
const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { Blob } = require('node:buffer');
const { JSDOM } = require('jsdom');
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
  const w=dom.window, requests=[], blobs=[], downloads=[], drafts=[], receipts=[];
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
    const op=url.split('/').at(-1), body=JSON.parse(request.body); requests.push({op,body});
    if(options.failOp===op)return {ok:false,status:400,json:async()=>({error:'SENTETİK işlem hatası'})};
    let result;
    switch(op){
      case 'status':result={version:'0.12.0',conversationCount:conversations.length,draftCount:drafts.length,keyConfigured:configured,budgetUsd:0,developers};break;
      case 'list':result={conversations};break;
      case 'conversation':result=conversations.find(c=>c.id===body.id);break;
      case 'catalog':result={models,source:body.refresh?'remote-test':'local-test',updatedAt:'2026-11-14T10:00:00Z',warnings:[]};break;
      case 'key':configured=!!body.key;result={configured};break;
      case 'drafts':result={drafts,receipts};break;
      case 'import-preview':{
        const c=conversation({id:'imported-'+body.provider,provider:body.developer||body.provider,title:body.title||'SENTETİK '+body.provider,messages:body.provider==='generic' && body.text?[message('generic-1','unknown',body.text)]:[message('native-1','user','SENTETİK yerel dışa aktarım')]}), previewId='preview-'+(++sequence);
        previews.set(previewId,[c]);result={previewId,conversations:[c]};break;
      }
      case 'import-commit':{const imported=previews.get(body.previewId).filter(c=>body.selectedIds.includes(c.id));conversations.push(...imported);result={imported:imported.length,skipped:0,conversations:imported};break;}
      case 'prepare':{
        const source=conversations.find(c=>c.id===body.conversationId), d={...body,id:'draft-'+(++sequence),hash:String(sequence).padStart(64,'b'),createdAt:'2026-11-14T10:00:00Z',status:'ready',messages:body.items.map(item=>({...item,id:item.messageId,role:item.role||source.messages.find(m=>m.id===item.messageId).role})),contextText:body.items.map(item=>item.text+(item.feedback?'\nNot: '+item.feedback:'')).join('\n\n')+'\nSoru: '+body.question,warnings:[]};
        drafts.push(d);result={draft:d,findings:options.serverFindings||[]};break;
      }
      case 'send':{
        const d=drafts.find(d=>d.id===body.draftId); assert.equal(body.hash,d.hash); assert.equal(body.confirmed,true); d.status='sent';
        const c=d.mode==='manual'?null:conversation({id:'new-branch-'+sequence,title:'SENTETİK simülasyon dalı',selectedLeafId:'new-answer',messages:[message('new-answer','assistant','SİMÜLASYON — sentetik yanıt')],sourceApp:'tore'});
        if(c)conversations.push(c);const receipt={draftId:d.id,status:d.mode,mode:d.mode,developer:d.developer};receipts.push(receipt);result={conversation:c,receipt,contextText:d.contextText};break;
      }
      case 'export':{
        const d=drafts.find(d=>d.id===body.draftId);assert.equal(d.intent,'dataset');assert.equal(body.hash,d.hash);assert.equal(body.confirmed,true);receipts.push({draftId:d.id,status:'packaged'});
        result={packageId:'synthetic-package',datasetJsonl:d.items.map(item=>JSON.stringify({text:item.text,role:'user'})).join('\n')+'\n',manifest:{draftHash:d.hash,purpose:d.purpose,licenseStatus:'no_license_granted_demo_only'},readme:'# SENTETİK demo\nHak doğrulaması değildir.'};break;
      }
      case 'revoke':drafts.find(d=>d.id===body.draftId).status='revoked';result={revoked:true};break;
      default:throw Error('Beklenmeyen test isteği: '+op);
    }
    return {ok:true,status:200,json:async()=>copy(result)};
  };
  w.eval(fs.readFileSync(path.join(web,'private-client.js'),'utf8').replace(/^export /gm,''));
  w.eval(fs.readFileSync(path.join(web,'workspace.js'),'utf8').replace(/^import .*;\n/,''));
  await flush();
  const $=id=>w.document.getElementById(id);
  const click=async target=>{(typeof target==='string'?$(target):target).click();await flush();};
  const change=(target,value)=>{const e=typeof target==='string'?$(target):target;e.value=value;e.dispatchEvent(new w.Event(e.tagName==='TEXTAREA'||e.tagName==='INPUT'?'input':'change',{bubbles:true}));};
  const check=async (target,value=true)=>{const e=typeof target==='string'?$(target):target;if(e.checked!==value)e.click();await flush();};
  const open=async()=>{await click(w.document.querySelector('[data-conversation-id]'));};
  const card=id=>w.document.querySelector('[data-message-id="'+id+'"]');
  const field=(id,name)=>card(id).querySelector('[data-field="'+name+'"]');
  return {w,$,click,change,check,open,card,field,requests,blobs,downloads,drafts,receipts};
}

test('kaynak metin HTML olarak çalışmaz; yerel yetki URL’den temizlenir, ilk açılış ağ kataloğunu yenilemez',async t=>{
  const h=await setup(t);await h.open();
  assert.equal(h.w.location.hash,'');assert.equal(h.w.sessionStorage.getItem('tore-local-session'),token);
  assert.equal(h.w.localStorage.length,0);assert.equal(h.$('target-developer').options.length,10);
  assert.equal(h.w.document.querySelector('img,[onerror]'),null);assert.equal(h.w.compromised,undefined);
  assert.ok(h.$('conversation-title').textContent.includes('<img'));assert.ok(h.card('m2').textContent.includes('<script>'));
  assert.deepEqual(h.requests.filter(r=>r.op==='catalog').map(r=>r.body),[{refresh:false}]);
  assert.equal(h.$('run-mode').value,'live');assert.equal(h.$('prepare-draft').disabled,true);
});

test('seçim ve maskeleme yalnız incelenen kopyayı etkiler; elle aktarım açık taslak onayını bekler',async t=>{
  const h=await setup(t);await h.open();await h.check(h.card('m1').querySelector('[data-action="select-message"]'));
  h.change('literal-masks','Özel Ad');await h.click('scan-pii');assert.match(h.$('pii-before-count').textContent,/5 aday/);
  await h.click('apply-masks');const edited=h.field('m1','text').value;
  for(const token of ['[E-POSTA]','[TELEFON]','[ANAHTAR]','[DOSYA YOLU]','[ÖZEL İFADE]'])assert.ok(edited.includes(token),token);
  assert.match(h.card('m1').querySelector('details pre').textContent,/demo@example.test/);assert.match(h.$('pii-after-count').textContent,/0 aday/);
  h.change('run-mode','manual');h.change('target-question','Bu düşünceyi nasıl geliştirebilirim?');assert.equal(h.$('prepare-draft').disabled,false);
  await h.click('prepare-draft');const prepared=h.requests.find(r=>r.op==='prepare').body;
  assert.deepEqual(prepared.items.map(item=>item.messageId),['m1']);assert.equal(prepared.items[0].text,edited);assert.equal(prepared.modelId,'');assert.equal(prepared.mode,'manual');
  assert.equal(h.$('draft-panel').hidden,false);assert.equal(h.$('draft-hash').textContent.length,64);assert.equal(h.$('execute-draft').disabled,true);
  assert.equal(h.requests.some(r=>r.op==='send'),false);
  await h.check('send-consent');await h.click('execute-draft');assert.equal(h.requests.filter(r=>r.op==='send').length,1);
  assert.match(h.$('result-heading').textContent,/elle aktarmaya hazır/);await h.click(h.$('result-actions').querySelector('button'));assert.equal(h.w.copiedText,h.$('result-text').textContent);
});

test('amaç veya metin değişikliği eski onayı iptal eder; veri paketi ayrı hak ve paket onayı gerektirir',async t=>{
  const h=await setup(t,{conversation:{messages:[message('m1','user','SENTETİK temiz katkım')]}});await h.open();await h.check(h.card('m1').querySelector('input[type=checkbox]'));
  h.change('run-mode','manual');h.change('target-question','Bu fikri aç.');await h.click('prepare-draft');await h.check('send-consent');assert.equal(h.$('execute-draft').disabled,false);
  h.change(h.field('m1','text'),'SENTETİK düzeltilmiş katkım');assert.equal(h.$('draft-panel').hidden,true);assert.equal(h.$('send-consent').checked,false);
  await h.click('intent-dataset');assert.equal(h.$('prepare-draft').disabled,true);
  h.change(h.field('m1','authorship'),'human_original');h.change(h.field('m1','rights'),'user_attested');h.change('dataset-purpose','training');await h.click('prepare-draft');
  const prepared=h.requests.filter(r=>r.op==='prepare').at(-1).body;assert.equal(prepared.intent,'dataset');assert.equal(prepared.purpose,'training');assert.equal(prepared.mode,'manual');
  assert.equal(h.$('send-consent-label').hidden,true);assert.equal(h.$('export-consent-label').hidden,false);assert.equal(h.$('export-consent').checked,false);assert.equal(h.$('execute-draft').disabled,true);
  await h.check('export-consent');await h.click('execute-draft');assert.equal(h.requests.filter(r=>r.op==='export').length,1);assert.equal(h.requests.filter(r=>r.op==='send').length,0);
  const downloads=[...h.$('result-actions').querySelectorAll('button')];assert.equal(downloads.length,3);for(const b of downloads)await h.click(b);
  assert.deepEqual(h.downloads.map(d=>d.name),['dataset.jsonl','manifest.json','README.md']);assert.match(await h.blobs[0].text(),/düzeltilmiş/);assert.match(await h.blobs[1].text(),/no_license_granted_demo_only/);
  const draftId=h.drafts.at(-1).id;await h.click('revoke-'+draftId);assert.equal(h.requests.at(-2).op,'revoke');assert.equal(h.$('result-actions').children.length,0);assert.match(h.$('result-status').textContent,/geri çağrılamaz/);
});

test('dallanmış kaynakta açık dal seçilir; diğer dala ait mesaj hazırlığa sızmaz',async t=>{
  const h=await setup(t,{conversation:{messages:[message('root','user','SENTETİK ortak başlangıç'),message('left','assistant','SENTETİK A dalı','root'),message('right','assistant','SENTETİK B dalı','root')]}});await h.open();
  assert.equal(h.$('branch-leaf').value,'');assert.equal(h.w.document.querySelectorAll('[data-message-id]').length,0);
  h.change('branch-leaf','left');assert.deepEqual([...h.w.document.querySelectorAll('[data-message-id]')].map(e=>e.dataset.messageId),['root','left']);
  await h.click('select-human');h.change('run-mode','simulation');h.change('target-question','Sonraki adım?');await h.click('prepare-draft');
  const prepared=h.requests.find(r=>r.op==='prepare').body;assert.equal(prepared.leafId,'left');assert.deepEqual(prepared.items.map(i=>i.messageId),['root']);
  await h.check('send-consent');await h.click('execute-draft');assert.match(h.$('result-heading').textContent,/Sentetik/);assert.match(h.$('result-text').textContent,/SİMÜLASYON/);assert.equal(h.$('conversation-title').textContent,'SENTETİK simülasyon dalı');
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
  await h.check(h.card('generic-1').querySelector('input[type=checkbox]'));h.change('run-mode','manual');h.change('target-question','Bunu tartış.');assert.equal(h.$('prepare-draft').disabled,true);
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
  ]});await h.open();await h.click('select-human');h.change('target-question','Fikrimi incele.');
  h.change('api-key','sk-SYNTHETIC-KEY-ONLY');await h.click('save-key');assert.equal(h.$('api-key').value,'');
  assert.equal(h.w.localStorage.length,0);assert.equal(h.w.sessionStorage.length,1);assert.equal(h.w.sessionStorage.getItem('tore-local-session'),token);
  assert.deepEqual(h.requests.find(r=>r.op==='key').body,{key:'sk-SYNTHETIC-KEY-ONLY'});assert.equal(h.$('prepare-draft').disabled,true);
  await h.click('refresh-catalog');for(const id of ['paid','underflow','missing'])assert.equal(h.$('target-model').querySelector('[value="openai/'+id+'"]').disabled,true);
  assert.equal(h.$('target-model').querySelector('[value="openai/zero"]').disabled,false);h.change('target-model','openai/zero');assert.equal(h.$('prepare-draft').disabled,false);
  await h.click('prepare-draft');assert.equal(h.requests.find(r=>r.op==='prepare').body.mode,'live');assert.equal(h.requests.some(r=>r.op==='send'),false);
  await h.click('clear-key');assert.deepEqual(h.requests.filter(r=>r.op==='key').at(-1).body,{key:''});assert.equal(h.$('api-key').value,'');assert.equal(h.$('prepare-draft').disabled,true);
});

test('sunucu özel bilgi bulduğunda onay işaretlense bile gönderim kapalıdır',async t=>{
  const h=await setup(t,{serverFindings:[{messageId:'m1',kind:'Telefon',value:'SENTETİK'}]});await h.open();await h.click('select-human');h.change('run-mode','manual');h.change('target-question','Kontrol et.');await h.click('prepare-draft');await h.check('send-consent');
  assert.equal(h.$('execute-draft').disabled,true);assert.match(h.$('draft-warnings').textContent,/çıkışı kapalıdır/);assert.equal(h.requests.some(r=>r.op==='send'),false);
});

test('sistem ve araç kayıtları aktarılmaz; AI yanıtının insan beyanı seçeneği kapalıdır',async t=>{
  const h=await setup(t,{conversation:{messages:[message('sys','system','SENTETİK talimat'),message('m1','user','SENTETİK kullanıcı','sys'),message('m2','assistant','SENTETİK AI','m1')]}});await h.open();
  assert.equal(h.card('sys').querySelector('input[type=checkbox]').disabled,true);await h.check(h.card('m2').querySelector('input[type=checkbox]'));
  assert.equal(h.field('m2','authorship').querySelector('[value=human_original]').disabled,true);
  h.change(h.field('m2','authorship'),'ai_output');h.change(h.field('m2','rights'),'user_attested');await h.click('intent-dataset');h.change('dataset-purpose','training');assert.equal(h.$('prepare-draft').disabled,true);assert.match(h.$('prepare-hint').textContent,/yalnız insan/);
});

test('hizmet hataları inline görünür; başarısız işlem başarı ekranı üretmez',async t=>{
  const h=await setup(t,{failOp:'prepare'});await h.open();await h.click('select-human');h.change('run-mode','manual');h.change('target-question','İncele.');await h.click('prepare-draft');
  assert.equal(h.$('action-error').hidden,false);assert.match(h.$('action-error').textContent,/SENTETİK işlem hatası/);assert.equal(h.$('draft-panel').hidden,true);assert.equal(h.$('result-panel').hidden,true);
});
