'use strict';
const {test}=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path'),crypto=require('node:crypto');
const {JSDOM,ResourceLoader,VirtualConsole}=require('jsdom');
const {loadI18n}=require('./i18n-helpers.cjs');
// Turkish unless a test asks for the browser to say English.
function setup({navigatorLanguage='tr-TR'}={}){const requests=[],saved=[],pending=[];class Network extends ResourceLoader{fetch(url){requests.push(url);return null;}}
 const dom=new JSDOM(fs.readFileSync(path.join(__dirname,'../src/shell.html'),'utf8'),{url:'file:///Töre.html',runScripts:'outside-only',resources:new Network(),virtualConsole:new VirtualConsole()});const w=dom.window;w.HTMLElement.prototype.scrollIntoView=function(){};
 loadI18n(w,[],{navigatorLanguage});w.eval(fs.readFileSync(path.join(__dirname,'../src/i18n-archive-tools.js'),'utf8'));
 for(const file of ['comparisons.js','comparison-ui.js'])w.eval(fs.readFileSync(path.join(__dirname,'../src',file),'utf8'));
 const id=()=>crypto.randomUUID(),at='2026-11-14T08:00:00.000Z';const revision=(text,area='present',kind='position',sourceIds=[])=>({id:id(),text,topic:'Katılım',area,kind,bridge:'',sourceIds,reportIds:[],at,reason:'',changeType:'initial'});
 const leftOld=revision('Gönüllü katılımı savunuyorum.');const leftCurrent=revision('Katılım artabilir.','future','prediction');const source={id:id(),label:'<img src=x onerror=evil()> kaynak',url:'https://example.invalid/source',reportId:''};const right=revision('Düzenli katılımı savunuyorum.','present','position',[source.id]);
 const profiles={schemaVersion:1,revision:0,profiles:[{id:id(),kind:'self',name:'SENTETİK Kullanıcı',editor:'',sources:[],views:[{id:id(),revisions:[leftOld,leftCurrent]}]},{id:id(),kind:'thinker',name:'<script>evil()</script> Düşünür',editor:'Test hazırlayan',sources:[source],views:[{id:id(),revisions:[right]}]}]};
 const store={document:{schemaVersion:1,revision:0,comparisons:[]},async save(input){saved.push(input);return input;}};
 const ui=w.createToreComparisonUI({getStore:()=>store,getProfiles:()=>({document:profiles}),getArchive:()=>({manifest:{reports:[]}}),task:fn=>{const p=Promise.resolve().then(fn);pending.push(p);return p;},message(){},async onOpenReport(){}});
 return {w,ui,profiles,saved,pending,requests,leftOld,right,store};}
const choose=(x,side,revisionId)=>{const select=x.w.document.getElementById('cmp-'+side);select.value=[...select.options].find(o=>o.value.endsWith('/'+revisionId)).value;select.dispatchEvent(new x.w.Event('change'));};
test('güncel/geçmiş sürüm seçimi ve zaman/tür etiketleri görünür, kaynak HTML düz metindir',()=>{const x=setup();x.ui.show();assert.equal(x.w.document.getElementById('comparisons-pane').hidden,false);assert.match(x.w.document.getElementById('cmp-left').textContent,/Güncel/);assert.match(x.w.document.getElementById('cmp-left').textContent,/Geçmiş/);choose(x,'left',x.leftOld.id);choose(x,'right',x.right.id);assert.equal(x.w.document.getElementById('cmp-left-source').textContent,x.leftOld.text);assert.match(x.w.document.getElementById('cmp-left-preview').textContent,/Şimdi.*Görüş/);assert.equal(x.w.document.querySelector('#comparisons-pane img,#comparisons-pane script'),null);assert.deepEqual(x.requests,[]);});
test('form kaydı sadece kullanıcı değerlendirmesini ve literal alıntıyı taşır; yayınlama yoktur',async()=>{const x=setup();choose(x,'left',x.leftOld.id);choose(x,'right',x.right.id);for(const [id,value]of Object.entries({'cmp-question':'Katılım nasıl olmalı?','cmp-category':'unclear','cmp-shared':'','cmp-difference':'Henüz kararlaştırmadım.','cmp-left-evidence':'Gönüllü katılımı','cmp-right-evidence':'Düzenli katılımı','cmp-open':'Süre ne olmalı?'}))x.w.document.getElementById(id).value=value;x.w.document.getElementById('comparison-form').dispatchEvent(new x.w.Event('submit',{bubbles:true,cancelable:true}));await Promise.all(x.pending);assert.equal(x.saved.length,1);assert.equal(x.saved[0].assessment.sharedGround,'');assert.equal(x.saved[0].assessment.category,'unclear');assert.deepEqual([...x.saved[0].assessment.leftEvidence],['Gönüllü katılımı']);assert.deepEqual(x.requests,[]);});
test('hazır HTML tek dosya, ağ ve depolama fallback olmadan tüm karşılaştırma kodunu içerir',()=>{const html=fs.readFileSync(path.join(__dirname,'../Töre.html'),'utf8');assert.match(html,/Töre 0\.3\.0/);assert.match(html,/connect-src 'none'/);assert.ok(html.includes('createToreComparisonUI'));assert.ok(html.includes('karsilastirmalar.json'));assert.equal(/<script[^>]+src=/.test(html),false);for(const name of ['comparisons.js','comparison-ui.js'])assert.equal(/\b(?:fetch|XMLHttpRequest|WebSocket|localStorage|indexedDB|serviceWorker)\b/.test(fs.readFileSync(path.join(__dirname,'../src',name),'utf8')),false);});
test('English: karşılaştırma ekranı İngilizce açılır; dil anahtarı seçimi bozmadan Türkçeye yerinde döner',async()=>{
 const x=setup({navigatorLanguage:'en-US'}),d=x.w.document,$=id=>d.getElementById(id),sets=[];
 await x.w.toreI18n.init(async(op,body)=>{if(op==='ui-language-set'){sets.push(body.language);return body;}return {language:null};});
 x.ui.show();assert.equal(d.documentElement.lang,'en');
 assert.match($('cmp-left').textContent,/Current/);assert.match($('cmp-left').textContent,/Earlier/);assert.doesNotMatch($('cmp-left').textContent,/Güncel|Geçmiş/);
 choose(x,'left',x.leftOld.id);choose(x,'right',x.right.id);
 assert.match($('cmp-left-preview').textContent,/Present · Opinion \/ ideal/);assert.match($('cmp-right-preview').textContent,/Sourced collection · Edited by Test hazırlayan/);
 assert.equal($('cmp-save').textContent,'Save private comparison');assert.equal($('cmp-category').querySelector('[value="unclear"]').textContent,'Not yet clear');
 assert.equal(d.querySelector('[data-i18n="tools.cmp.leftVersion"]').textContent,'Fixed version of the left opinion');assert.equal(d.querySelector('[data-i18n="tools.cmp.title"]').textContent,'Private comparisons');
 assert.match($('comparison-list').textContent,/No private comparisons yet/);
 $('cmp-category').value='value';$('cmp-question').value='SENTETİK soru';
 await x.w.toreI18n.choose('tr');
 assert.deepEqual(sets,['tr']);assert.equal(d.documentElement.lang,'tr');
 assert.match($('cmp-left-preview').textContent,/Şimdi · Görüş \/ ideal/);assert.equal($('cmp-save').textContent,'Özel karşılaştırmayı kaydet');assert.equal($('cmp-category').querySelector('[value="unclear"]').textContent,'Henüz belirlenemedi');
 assert.equal($('cmp-category').value,'value','seçilen tür korunur');assert.equal($('cmp-question').value,'SENTETİK soru','yazılan metin korunur');assert.ok($('cmp-left').value.endsWith('/'+x.leftOld.id),'seçilen sürüm korunur');
 assert.equal(d.querySelector('[data-i18n="tools.cmp.leftVersion"]').textContent,'Sol görüşün sabit sürümü');assert.deepEqual(x.requests,[]);
});
