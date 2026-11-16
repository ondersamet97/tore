'use strict';
const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { JSDOM } = require('jsdom');
const web = path.resolve(__dirname, '../../web'), token = 'c'.repeat(64);
const clone = value => JSON.parse(JSON.stringify(value));
const sources = [{id:'opinion:o1',kind:'confirmed_card',title:'SENTETİK onaylı görüş',text:'SENTETİK <img src=x onerror=alert(1)> eşit imkânlar.'},{id:'report:r1',kind:'report_context',title:'SENTETİK rapor bölümü',text:'SENTETİK rapor: haklar ile güvence birlikte düşünülebilir.'}];
function result(overrides={}) {
  return {id:'result-old',inputHash:'old-hash',createdAt:'2026-11-15T08:00:00Z',engine:{name:'Sentetik yerel motor',localOnly:true},coverage:{confirmedCount:1,reportsCount:1},sources:clone(sources),analysis:{title:'SENTETİK önceki yorum <img src=x>',summary:'SENTETİK düşüncelerin birlikte yorumu.',pillars:[{title:'SENTETİK ortak güvence',text:'SENTETİK <script>window.bad=true</script> metin.',evidence:[{sourceId:'opinion:o1',quote:sources[0].text}]}],affinities:[{name:'SENTETİK haklar yaklaşımı',why:'SENTETİK bireysel tercih önemseniyor.',limits:'SENTETİK bütün program benimsendiği çıkarılamaz.',evidence:[{sourceId:'report:r1',quote:sources[1].text}]}],tensions:[],questions:[{question:'SENTETİK sınır nerede?',why:'SENTETİK kapsamı netleştirmek için.',sourceIds:['opinion:o1']}]},...overrides};
}
async function flush() {for(let i=0;i<12;i++)await new Promise(resolve=>setImmediate(resolve));}
async function setup(t,options={}) {
  const dom=new JSDOM(fs.readFileSync(path.join(web,'opinions.html'),'utf8'),{runScripts:'outside-only',url:'http://127.0.0.1:18740/gorusler#local='+token});t.after(()=>dom.window.close());
  const w=dom.window,requests=[],timers=new Map(),clipboard=[];let timerId=0,job=options.initialJob||null,latest=result(),draft=null,statusFailure=!!options.statusFailure;
  const connections={chatgpt:{connected:!!options.connected,pending:!!options.authPending,sharing:options.sharing??!!options.connected,error:options.authError||null},openrouter:{configured:!!options.keyConfigured},localEnabled:false};
  w.HTMLElement.prototype.scrollIntoView=function(){};Object.defineProperty(w.navigator,'clipboard',{value:{writeText:async text=>{clipboard.push(text);}}});
  const realTimeout=w.setTimeout.bind(w),realClear=w.clearTimeout.bind(w);
  w.setTimeout=(fn,delay,...args)=>{if(delay===1500){timers.set(++timerId,fn);return 'poll-'+timerId;}return realTimeout(fn,delay,...args);};
  w.clearTimeout=id=>{if(String(id).startsWith('poll-'))timers.delete(Number(String(id).slice(5)));else realClear(id);};
  w.fetch=async(url,request)=>{
    assert.equal(request.method,'POST');assert.equal(request.credentials,'omit');assert.equal(request.headers.Authorization,'Bearer '+token);assert.equal(request.cache,'no-store');assert.ok(url.startsWith('/api/private/tore/'));
    const op=url.split('/').at(-1),body=JSON.parse(request.body);requests.push({op,body});let data;
    if(op==='ideology-preview') {const selected=body.reportIds===undefined||body.reportIds.includes('r1');data={inputHash:'hash-current',confirmedCount:1,excludedCount:2,reports:[{id:'r1',title:'SENTETİK rapor',selected,totalCharacters:80,includedCharacters:selected?80:0}],sources:selected?clone(sources):[clone(sources[0])],engine:{ready:false,localOnly:false,name:'Bulut veya elle aktarım'},latest,stale:false,job};}
    else if(op==='connections')data=connections;
    else if(op==='chatgpt-login'){connections.chatgpt.pending=true;data={pending:true};}
    else if(op==='chatgpt-disconnect'){connections.chatgpt={connected:false,pending:false,sharing:false};data={disconnected:true};}
    else if(op==='key'){connections.openrouter.configured=!!body.key;data={configured:!!body.key};}
    else if(op==='ideology-models')data={models:body.connection==='chatgpt'?[{id:'synthetic-model',name:'Sentetik ChatGPT modeli',developer:'openai'}]:[{id:'nvidia/synthetic:free',name:'Sentetik NVIDIA modeli',developer:'nvidia',free:true},{id:'openai/synthetic:free',name:'Sentetik OpenAI modeli',developer:'openai',free:true}],warnings:[]};
    else if(op==='ideology-prepare') {const selected=sources.filter(source=>body.sourceIds.includes(source.id)).map(source=>({...source,text:body.edits.find(edit=>edit.id===source.id)?.text??source.text}));draft={id:'draft-'+requests.filter(r=>r.op==='ideology-prepare').length,hash:'draft-hash',target:body.target,sources:selected,sourceIds:body.sourceIds,reportIds:body.reportIds??['r1'],prompt:'SENTETİK yanıt talimatı\n'+selected.map(s=>s.text).join('\n'),canSend:!options.blocked,findings:options.blocked?[{sourceId:'opinion:o1',kind:'E-posta',field:'text'}]:[],cost:{caption:'SENTETİK maliyet açıklaması'},privacy:{caption:'SENTETİK veri gönderim açıklaması'}};data={draft};}
    else if(op==='ideology-send') {assert.equal(body.confirmed,true);assert.match(body.requestId,/^[0-9a-f-]{36}$/);assert.equal(body.draftId,draft.id);assert.equal(body.draftHash,draft.hash);if(options.sendFailure)throw Error('SENTETİK gönderim sonrası bağlantı koptu.');job={id:'job-synthetic',status:'running',phase:'generating'};data={job};}
    else if(op==='ideology-manual') {assert.equal(body.confirmed,true);assert.match(body.requestId,/^[0-9a-f-]{36}$/);assert.equal(body.draftId,draft.id);assert.equal(body.draftHash,draft.hash);assert.equal(typeof body.text,'string');latest=result({id:'manual-result',engine:{connection:'manual',provenance:'user_attested',localOnly:false}});data={job:{id:'manual-job',status:'completed'},latest,stale:false};}
    else if(op==='ideology-status') {if(statusFailure)throw Error('SENTETİK durum bağlantısı koptu.');if(job&&options.failJob)job={...job,status:'failed',error:'SENTETİK hizmet yanıtı başarısız.'};else if(job&&!options.keepRunning){job={...job,status:'completed'};latest=result({id:'result-new',engine:{connection:'chatgpt',localOnly:false},inputHash:'new-hash'});latest.analysis.title='SENTETİK güncel bütünlüklü yorum';}data={job,latest,stale:false};}
    else throw Error('Bu ekranda izin verilmeyen istek: '+op);
    return{ok:true,status:200,json:async()=>clone(data)};
  };
  w.eval(fs.readFileSync(path.join(web,'private-client.js'),'utf8').replace(/^export /gm,''));w.eval(fs.readFileSync(path.join(web,'ideology.js'),'utf8').replace(/^import .*;\n/,''));await flush();
  const $=id=>w.document.getElementById(id),click=async target=>{(typeof target==='string'?$(target):target).click();await flush();};
  const change=async(id,value,type='change')=>{$(id).value=value;$(id).dispatchEvent(new w.Event(type,{bubbles:true}));await flush();};
  const poll=async()=>{const entry=timers.entries().next().value;assert.ok(entry,'bekleyen poll olmalı');timers.delete(entry[0]);entry[1]();await flush();};
  const prepare=async()=>{if(!$('ideology-reviewed').checked)await click('ideology-reviewed');await click('ideology-prepare');};
  const connectChatGPT=async()=>{await change('ideology-connection','chatgpt');await click('ideology-model-refresh');await change('ideology-model','synthetic-model');};
  return{w,$,requests,click,change,poll,prepare,connectChatGPT,timers,clipboard,connections,setStatusFailure:value=>{statusFailure=value;}};
}

test('açılış ve üst İdeolojim düğmesi yalnız yerel kapsam okur; önceki yorum korunur',async t=>{
  const h=await setup(t);assert.deepEqual(h.requests.map(r=>r.op).sort(),['connections','ideology-preview']);assert.equal(h.$('ideology-panel').hidden,true);assert.equal(h.$('ideology-show-latest').hidden,false);assert.equal(h.w.location.hash,'');
  await h.click('ideology-nav');assert.equal(h.$('ideology-panel').hidden,false);assert.match(h.$('ideology-result-title').textContent,/önceki yorum/);assert.equal(h.requests.some(r=>/send|generate|models|prepare/.test(r.op)),false);assert.equal(h.$('ideology-prepare').disabled,true);
});
test('ChatGPT için kaynak inceleme, tam önizleme ve ayrı onay olmadan gönderim yapılmaz',async t=>{
  const h=await setup(t,{connected:true});await h.connectChatGPT();assert.equal(h.$('ideology-developer').value,'openai');assert.equal(h.$('ideology-developer').disabled,true);assert.equal(h.$('ideology-prepare').disabled,true);
  await h.prepare();assert.equal(h.$('ideology-outbound').hidden,false);assert.match(h.$('ideology-prompt').textContent,/SENTETİK yanıt talimatı/);assert.equal(h.$('ideology-send').disabled,true);assert.equal(h.requests.some(r=>r.op==='ideology-send'),false);
  await h.click('ideology-send-consent');await h.click('ideology-send');assert.equal(h.requests.filter(r=>r.op==='ideology-send').length,1);assert.equal(h.$('ideology-send').disabled,true);await h.poll();assert.match(h.$('ideology-result-title').textContent,/güncel bütünlüklü/);
});
test('hedef, kaynak ve görüş değişikliği hazırlanmış onayı iptal eder',async t=>{
  const h=await setup(t,{connected:true});await h.connectChatGPT();await h.prepare();await h.click('ideology-send-consent');await h.change('ideology-connection','manual');assert.equal(h.$('ideology-outbound').hidden,true);assert.equal(h.$('ideology-send-consent').checked,false);
  await h.prepare();const text=h.w.document.querySelector('[data-source-text="opinion:o1"]');text.value='SENTETİK düzenlenen görüş';text.dispatchEvent(new h.w.Event('input'));await flush();assert.equal(h.$('ideology-outbound').hidden,true);assert.equal(h.$('ideology-reviewed').checked,false);
  await h.prepare();h.w.dispatchEvent(new h.w.CustomEvent('tore-opinions-updated'));assert.equal(h.$('ideology-outbound').hidden,true);await h.click('ideology-reviewed');assert.equal(h.$('ideology-prepare').disabled,true);assert.match(h.$('ideology-result-label').textContent,/Önceki yorum/);assert.equal(h.requests.some(r=>r.op==='ideology-send'),false);
});
test('seçilmeyen kaynak paylaşılmaz; düzenleme yalnız kopyaya gider',async t=>{
  const h=await setup(t);await h.click(h.w.document.querySelector('[data-source-id="report:r1"]'));const text=h.w.document.querySelector('[data-source-text="opinion:o1"]');text.value='[MASKELENDİ] SENTETİK görüş';text.dispatchEvent(new h.w.Event('input'));await flush();await h.prepare();
  const prepared=h.requests.find(r=>r.op==='ideology-prepare').body;assert.deepEqual(prepared.sourceIds,['opinion:o1']);assert.deepEqual(prepared.edits,[{id:'opinion:o1',text:'[MASKELENDİ] SENTETİK görüş'}]);assert.equal(h.$('ideology-prompt').textContent.includes('haklar ile güvence'),false);
  await h.click(h.w.document.querySelector('[data-report-id="r1"]'));assert.deepEqual(h.requests.filter(r=>r.op==='ideology-preview').at(-1).body.reportIds,[]);assert.equal(h.$('ideology-outbound').hidden,true);
});
test('elle aktarım yalnız onay ve kopyalama tıklamasında panoya yazar; dönüş kullanıcı beyanıdır',async t=>{
  const h=await setup(t);await h.change('ideology-developer','anthropic');await h.prepare();assert.equal(h.clipboard.length,0);assert.equal(h.$('ideology-copy').disabled,true);assert.equal(h.$('ideology-service-link').href,'https://claude.ai/');await h.click('ideology-send-consent');assert.equal(h.clipboard.length,0);await h.click('ideology-copy');assert.equal(h.clipboard.length,1);assert.equal(h.clipboard[0],h.$('ideology-prompt').textContent);
  await h.change('ideology-manual-response','{"synthetic":"response"}','input');assert.equal(h.$('ideology-manual-save').disabled,true);await h.click('ideology-manual-consent');await h.click('ideology-manual-save');assert.equal(h.requests.filter(r=>r.op==='ideology-manual').length,1);assert.match(h.$('ideology-result-label').textContent,/kullanıcı beyanı/);assert.equal(h.requests.some(r=>r.op==='ideology-send'),false);assert.equal(h.w.localStorage.length,0);assert.equal(h.w.sessionStorage.length,1);
});
test('bulunan özel bilgi gönderimi ve manuel kopyayı engeller',async t=>{
  const h=await setup(t,{blocked:true});await h.prepare();assert.match(h.$('ideology-findings').textContent,/E-posta/);assert.equal(h.$('ideology-send-consent').disabled,true);assert.equal(h.$('ideology-copy').disabled,true);assert.equal(h.$('ideology-manual-save').disabled,true);assert.equal(h.clipboard.length,0);
});
test('OpenRouter anahtarı yalnız yerel oturum uç noktasına gider; NVIDIA katalogdan seçilir',async t=>{
  const h=await setup(t);await h.change('ideology-connection','openrouter');h.$('ideology-key').value='SENTETIK-KEY';await h.click('ideology-save-key');assert.equal(h.$('ideology-key').value,'');assert.equal(h.requests.find(r=>r.op==='key').body.key,'SENTETIK-KEY');assert.equal(h.w.localStorage.length,0);assert.equal(h.w.sessionStorage.length,1);
  await h.click('ideology-model-refresh');await h.change('ideology-developer','nvidia');await h.change('ideology-model','nvidia/synthetic:free');await h.prepare();assert.equal(h.requests.find(r=>r.op==='ideology-prepare').body.target.developer,'nvidia');assert.equal(h.$('ideology-developer').options.length,11);await h.click('ideology-clear-key');assert.equal(h.requests.filter(r=>r.op==='key').at(-1).body.key,'');assert.equal(h.$('ideology-outbound').hidden,true);
});
test('ChatGPT giriş yalnız kendi düğmesinde başlar; oturum kontrolü içerik göndermez',async t=>{
  const h=await setup(t);await h.change('ideology-connection','chatgpt');assert.equal(h.requests.some(r=>r.op==='chatgpt-login'),false);await h.click('ideology-chatgpt-login');assert.equal(h.requests.filter(r=>r.op==='chatgpt-login').length,1);assert.match(h.$('ideology-chatgpt-status').textContent,/resmî ChatGPT/);assert.equal(h.timers.size,1);h.connections.chatgpt={connected:true,pending:false,sharing:true};await h.poll();assert.equal(h.$('ideology-chatgpt-disconnect').hidden,false);assert.equal(h.requests.some(r=>r.op==='ideology-send'),false);await h.click('ideology-chatgpt-disconnect');assert.equal(h.connections.chatgpt.connected,false);
});
test('hizmet hatası önceki yorumu korur ve otomatik tekrar üretmez',async t=>{
  const h=await setup(t,{connected:true,failJob:true});await h.connectChatGPT();await h.prepare();await h.click('ideology-send-consent');await h.click('ideology-send');await h.poll();assert.match(h.$('ideology-error').textContent,/hizmet yanıtı başarısız/);assert.match(h.$('ideology-result-title').textContent,/önceki yorum/);assert.equal(h.timers.size,0);assert.equal(h.requests.filter(r=>r.op==='ideology-send').length,1);
});
test('gönderim sonrası bağlantı kaybı çift gönderime yol açmaz',async t=>{
  const h=await setup(t,{connected:true,sendFailure:true});await h.connectChatGPT();await h.prepare();await h.click('ideology-send-consent');await h.click('ideology-send');await h.click('ideology-send');assert.equal(h.requests.filter(r=>r.op==='ideology-send').length,1);assert.equal(h.$('ideology-check-status').hidden,false);assert.equal(h.$('ideology-send').disabled,true);assert.match(h.$('ideology-result-title').textContent,/önceki yorum/);
});
test('durum sorgusu açık dayanakları korur; bağlantı hatasında yalnız durum yeniden denenir',async t=>{
  const h=await setup(t,{connected:true,keepRunning:true});await h.connectChatGPT();await h.prepare();await h.click('ideology-send-consent');await h.click('ideology-send');const evidence=h.$('ideology-pillars').querySelector('details');evidence.open=true;await h.poll();assert.equal(h.$('ideology-pillars').querySelector('details'),evidence);assert.equal(evidence.open,true);await h.click(evidence.querySelector('a'));assert.equal(h.$('ideology-citations').open,true);h.setStatusFailure(true);await h.poll();assert.equal(h.$('ideology-check-status').hidden,false);h.setStatusFailure(false);await h.click('ideology-check-status');assert.equal(h.requests.filter(r=>r.op==='ideology-send').length,1);
});
test('kesilmiş iş görünür; kaynak ve yanıt HTML olarak çalışmaz',async t=>{
  const h=await setup(t,{initialJob:{id:'interrupted-job',status:'interrupted',error:'SENTETİK önceki çalışma kesildi.'}});assert.match(h.$('ideology-error').textContent,/çalışma kesildi/);assert.equal(h.requests.some(r=>r.op==='ideology-send'),false);assert.equal(h.timers.size,0);assert.equal(h.w.document.querySelector('img,script:not([src])'),null);assert.equal(h.w.bad,undefined);assert.match(h.w.document.querySelector('[data-source-text="opinion:o1"]').value,/<img/);assert.match(h.$('ideology-pillars').textContent,/<script>/);await h.click(h.$('ideology-pillars').querySelector('a'));assert.equal(h.$('ideology-source-0').querySelector('pre').textContent,sources[0].text);const ids=[...h.w.document.querySelectorAll('[id]')].map(e=>e.id);assert.equal(new Set(ids).size,ids.length);
});


test('ChatGPT kimliği bağlı olsa da paylaşım izni yoksa yeniden giriş görünür ve modeller kapalı kalır',async t=>{
  const h=await setup(t,{connected:true,sharing:false});await h.change('ideology-connection','chatgpt');
  assert.equal(h.$('ideology-chatgpt-login').hidden,false);assert.equal(h.$('ideology-chatgpt-login').disabled,false);assert.match(h.$('ideology-chatgpt-status').textContent,/paylaşım izni/);
  assert.equal(h.$('ideology-model').disabled,true);assert.equal(h.$('ideology-model-refresh').disabled,true);
  await h.click('ideology-model-refresh');assert.equal(h.requests.some(r=>r.op==='ideology-models'),false);await h.click('ideology-reviewed');assert.equal(h.$('ideology-prepare').disabled,true);
  await h.click('ideology-chatgpt-login');assert.equal(h.requests.filter(r=>r.op==='chatgpt-login').length,1);assert.equal(h.$('ideology-chatgpt-login').disabled,true);assert.match(h.$('ideology-chatgpt-status').textContent,/resmî ChatGPT girişini/);
  h.connections.chatgpt={connected:true,pending:false,sharing:true,error:null};await h.poll();assert.equal(h.$('ideology-chatgpt-login').hidden,true);assert.equal(h.$('ideology-model-refresh').disabled,false);
  await h.click('ideology-model-refresh');await h.change('ideology-model','synthetic-model');await h.prepare();assert.equal(h.$('ideology-outbound').hidden,false);assert.equal(h.requests.some(r=>r.op==='ideology-send'),false);
});

test('ChatGPT paylaşım değeri boolean true olmalı; bağlantı hatası gizlenmez',async t=>{
  const h=await setup(t,{connected:true,sharing:'enabled',authError:'SENTETİK paylaşım izni yeniden gerekli.'});await h.change('ideology-connection','chatgpt');
  assert.equal(h.$('ideology-chatgpt-login').hidden,false);assert.match(h.$('ideology-chatgpt-status').textContent,/SENTETİK paylaşım izni yeniden gerekli/);assert.equal(h.$('ideology-model-refresh').disabled,true);await h.click('ideology-reviewed');assert.equal(h.$('ideology-prepare').disabled,true);
});
