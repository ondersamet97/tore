'use strict';
// Kişilik testi (/kisilik) page in jsdom: the real HTML, dictionaries and scripts. The three
// ES modules are evaluated together with their import lines removed (jsdom does not run
// modules). Downloads are the captured blob calls, not a real browser download.
const {test}=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const {JSDOM}=require('jsdom');
const {loadI18n,languageStore,languageOp}=require('./i18n-helpers.cjs');
const web=path.resolve(__dirname,'../../web'),token='e'.repeat(64);
const read=file=>fs.readFileSync(path.join(web,file),'utf8');
const moduleText=file=>read(file).replace(/^import .*;\n/gm,'').replace(/^export /gm,'');
async function flush(){for(let i=0;i<12;i++)await new Promise(r=>setImmediate(r));}
function setup(t,opts={}){
 const requests=[],downloads=[],lang=languageStore(opts.uiLanguage??null);
 const dom=new JSDOM(read('personality.html'),{runScripts:'outside-only',url:'http://127.0.0.1:18740/kisilik'+(opts.noSession?'':'#local='+token)});t.after(()=>dom.window.close());
 const w=dom.window;
 if(opts.saved!==undefined)w.sessionStorage.setItem('tore-personality-v1',typeof opts.saved==='string'?opts.saved:JSON.stringify(opts.saved));
 w.fetch=async(url,request)=>{
  const op=url.split('/').at(-1),body=JSON.parse(request.body);requests.push({op,body});
  const ui=languageOp(lang,op,body);if(ui!==undefined)return{ok:true,status:200,json:async()=>ui};
  throw Error('beklenmeyen işlem '+op);
 };
 w.URL.createObjectURL=blob=>{downloads.push({blob});return 'blob:test-'+downloads.length;};w.URL.revokeObjectURL=()=>{};
 w.HTMLAnchorElement.prototype.click=function(){if(this.download)downloads.at(-1).name=this.download;};
 loadI18n(w,['personality'],{navigatorLanguage:opts.navigatorLanguage||'tr-TR'});
 w.eval(read('private-client.js').replace(/^export /gm,''));
 w.eval(moduleText('personality-data.js')+'\n'+moduleText('personality-scoring.js')+'\n'+moduleText('personality.js'));
 const d=w.document;
 const click=action=>{const b=d.querySelector('#personality [data-action="'+action+'"]');assert.ok(b,'düğme yok: '+action);b.click();};
 const pick=(id,value)=>{const input=d.querySelector('[data-item="'+id+'"] input[value="'+value+'"]');assert.ok(input,'madde bu sayfada değil: '+id);input.checked=true;input.dispatchEvent(new w.Event('change'));};
 const shown=()=>[...d.querySelectorAll('.pq-item')].map(el=>el.dataset.item);
 const stored=()=>JSON.parse(w.sessionStorage.getItem('tore-personality-v1'));
 const text=index=>new Promise((resolve,reject)=>{const reader=new w.FileReader();reader.onload=()=>resolve(reader.result);reader.onerror=()=>reject(reader.error);reader.readAsText(downloads[index].blob);});
 return{w,d,requests,downloads,lang,click,pick,shown,stored,text};
}
const allAnswers=value=>{const ids=[];for(const dom of 'NEOAC')for(let f=1;f<=6;f++)for(let i=1;i<=4;i++)ids.push(dom+f+'-'+i);return Object.fromEntries(ids.map(id=>[id,value]));};

test('açılış: menüde yeni bağlantı yok; açıklama dört maddeyi, taslak çeviri notunu ve kaynağı gösterir; hiçbir veri isteği yapılmaz',async t=>{
 const {d,requests}=setup(t);await flush();
 assert.equal(d.title,'töre — Kişilik testi');assert.equal(d.querySelectorAll('h1').length,1);assert.equal(d.querySelector('h1').textContent,'Kişilik testi');
 assert.deepEqual([...d.querySelectorAll('.topbar nav a')].map(a=>[a.textContent,a.getAttribute('href')]),[['Konular','/konular'],['Seni bekleyenler','/konular?gorunum=bekleyenler'],['Haritam','/harita'],['Konuşmalar','/calisma']]);
 assert.equal(d.querySelector('.topbar nav [aria-current]'),null,'bu sayfa menüde hiçbir bölümü işaretlemez');assert.equal(d.querySelector('a[href="/kisilik"]'),null);
 assert.equal(d.getElementById('page-status').textContent,'Kişilik testi hazır.');assert.equal(d.getElementById('page-error').hidden,true);
 const intro=d.getElementById('pq-intro');assert.equal(intro.querySelectorAll('li').length,4);
 assert.deepEqual([...intro.querySelectorAll('li b')].map(b=>b.textContent),['Ne sorar:','Nasıl yanıtlanır:','Ne değildir:','Yanıtların nerede durur:']);
 assert.match(intro.textContent,/Tanı ya da uzman değerlendirmesi değildir/);assert.match(intro.textContent,/Defterine yazılmaz, hiçbir yere gönderilmez; sekmeyi kapatınca silinir/);
 assert.match(intro.querySelector('.notice').textContent,/^Türkçe ifadeler taslak çeviridir: 120 maddenin hepsini töre İngilizce özgün metinden çevirdi\. Hiçbiri bağımsız olarak doğrulanmadı/);
 assert.match(intro.textContent,/Maddeler: International Personality Item Pool \(ipip\.ori\.org\), IPIP-NEO-120 \(Johnson, 2014\)\. Kamu malı\./);
 assert.deepEqual([...intro.querySelectorAll('button')].map(b=>b.textContent),['Teste başla'],'yanıt yokken silme ve sonuç düğmesi yok');
 assert.deepEqual(requests.map(r=>r.op),['ui-language-get'],'yalnız arayüz dili sorulur; deftere dokunulmaz');
 assert.equal(d.querySelector('#personality img,#personality script,#personality iframe'),null);
});

test('ifadeler onar onar gelir; yanıt sekmede saklanır, ilerleme sayılır; geri ve ileri yanıtları korur',async t=>{
 const {d,w,click,pick,shown,stored}=setup(t);await flush();
 click('start');
 assert.equal(d.querySelector('#pq-quiz h2').textContent,'İfadeler 1–10 / 120');assert.equal(d.activeElement,d.getElementById('pq-heading'),'odak yeni sayfanın başlığında');
 assert.deepEqual(shown(),['N1-1','E1-1','O1-1','A1-1','C1-1','N2-1','E2-1','O2-1','A2-1','C2-1']);
 const first=d.querySelector('[data-item="N1-1"]');assert.equal(first.tagName,'FIELDSET');assert.equal(first.querySelector('legend').textContent,'1. Çeşitli şeyler için kaygılanırım.');
 assert.deepEqual([...first.querySelectorAll('label')].map(l=>l.textContent),['Çok yanlış','Kısmen yanlış','Ne doğru ne yanlış','Kısmen doğru','Çok doğru']);
 assert.deepEqual([...first.querySelectorAll('input')].map(i=>[i.type,i.name,i.value]),[1,2,3,4,5].map(v=>['radio','q-N1-1',String(v)]));
 assert.equal(d.querySelector('[data-item="O1-1"] legend').textContent,'3. Hayal gücüm canlıdır.');
 assert.equal(d.getElementById('pq-progress-text').textContent,'0 / 120 yanıtlandı');assert.equal(d.getElementById('pq-progress-bar').getAttribute('aria-label'),'Yanıtlanan ifadeler');
 assert.equal(w.sessionStorage.getItem('tore-personality-v1'),null,'yanıt verilmeden hiçbir şey saklanmaz');
 pick('N1-1',4);pick('E1-1',2);
 assert.equal(d.getElementById('pq-progress-text').textContent,'2 / 120 yanıtlandı');assert.equal(d.getElementById('pq-progress-bar').value,2);
 assert.deepEqual(stored(),{v:1,answers:{'N1-1':4,'E1-1':2},page:0});
 pick('N1-1',5);assert.deepEqual(stored().answers,{'N1-1':5,'E1-1':2},'yanıt değiştirilebilir');
 assert.deepEqual([...d.querySelectorAll('#pq-quiz .pq-nav>button')].map(b=>b.textContent),['Açıklamaya dön','İleri']);
 click('next');assert.equal(d.querySelector('#pq-quiz h2').textContent,'İfadeler 11–20 / 120');assert.equal(shown()[0],'N3-1');assert.equal(stored().page,1);
 assert.equal(d.querySelector('#pq-missing'),null,'yanıtsız ifade varken ileri gitmek serbest; uyarı yok');
 click('back');assert.equal(d.querySelector('[data-item="N1-1"] input[value="5"]').checked,true);assert.equal(d.querySelector('[data-item="E1-1"] input[value="2"]').checked,true);assert.equal(d.querySelector('[data-item="O1-1"] input:checked'),null);
 click('back');assert.ok(d.getElementById('pq-intro'));assert.equal(d.querySelector('[data-action="start"]').textContent,'Kaldığın yerden devam et (2 / 120)');
 click('start');assert.equal(d.querySelector('#pq-quiz h2').textContent,'İfadeler 1–10 / 120','ilk yanıtsız ifadenin sayfası açılır');
});

test('sekme yenilenince yanıtlar geri gelir; bozuk ya da tanınmayan saklı veri atılır',async t=>{
 const kept=setup(t,{saved:{v:1,answers:{'N1-1':3,'C6-4':1,'ZZ-9':2,'E1-1':7,'O1-1':'4'},page:5}});await flush();
 assert.equal(kept.d.querySelector('[data-action="start"]').textContent,'Kaldığın yerden devam et (2 / 120)','yalnız bilinen madde ve 1–5 arası tam sayı yanıt alınır');
 assert.ok(kept.d.querySelector('[data-action="clear"]'));
 kept.click('start');assert.equal(kept.d.querySelector('#pq-quiz h2').textContent,'İfadeler 1–10 / 120');assert.equal(kept.d.querySelector('[data-item="N1-1"] input[value="3"]').checked,true);
 for(const saved of ['{bozuk',JSON.stringify({v:2,answers:{'N1-1':3}}),JSON.stringify({v:1,answers:null}),'null']){
  const broken=setup(t,{saved});await flush();
  assert.equal(broken.d.querySelector('[data-action="start"]').textContent,'Teste başla',saved);assert.equal(broken.d.getElementById('page-error').hidden,true);
 }
});

test('eksik yanıtla sonuç gösterilmez; kaç ifade kaldığı söylenir ve ilk yanıtsız ifadeye gidilir',async t=>{
 const answers=allAnswers(3);delete answers['A1-1'];delete answers['C6-4'];
 const {d,click,pick,shown}=setup(t,{saved:{v:1,answers,page:11}});await flush();
 assert.equal(d.querySelector('[data-action="result"]'),null,'eksik varken açılışta sonuç düğmesi yok');
 click('start');assert.equal(d.querySelector('#pq-quiz h2').textContent,'İfadeler 1–10 / 120');assert.equal(d.querySelector('.pq-unanswered'),null,'sonuç istenmeden yanıtsız ifade işaretlenmez');
 for(let i=0;i<11;i++)click('next');
 assert.equal(d.querySelector('#pq-quiz h2').textContent,'İfadeler 111–120 / 120');assert.equal(d.querySelector('[data-action="next"]'),null);
 click('finish');
 assert.equal(d.getElementById('pq-result'),null);const note=d.getElementById('pq-missing');assert.equal(note.getAttribute('role'),'status');assert.match(note.textContent,/^Sonuç için 2 ifade daha yanıtlanmalı\. /);
 assert.equal(d.activeElement,d.querySelector('[data-action="first-missing"]'));assert.deepEqual([...d.querySelectorAll('.pq-unanswered')].map(p=>[p.dataset.unanswered,p.textContent]),[['C6-4','Yanıtlanmadı']]);
 click('first-missing');assert.ok(shown().includes('A1-1'));assert.equal(d.querySelector('#pq-quiz h2').textContent,'İfadeler 1–10 / 120');assert.equal(d.activeElement,d.querySelector('[data-item="A1-1"] input'));
 pick('A1-1',5);assert.match(d.getElementById('pq-missing').textContent,/^Sonuç için 1 ifade daha yanıtlanmalı\. /);assert.equal(d.querySelector('[data-unanswered="A1-1"]'),null);
 click('first-missing');assert.equal(d.querySelector('#pq-quiz h2').textContent,'İfadeler 111–120 / 120');
 pick('C6-4',2);assert.equal(d.getElementById('pq-missing'),null,'hepsi yanıtlanınca uyarı kalkar');
 click('finish');assert.ok(d.getElementById('pq-result'));
});

test('sonuç ham puandır: beş boyut, olası aralık, alt boyutlar; yüksek ya da düşük denmez; deftere yazılmaz',async t=>{
 // Every answer 3 except N2 (5, 4, 2 and the minus-keyed item 2) → N2 = 5+4+2+(6−2) = 15, N = 72−12+15 = 75.
 const answers={...allAnswers(3),'N2-1':5,'N2-2':4,'N2-3':2,'N2-4':2};
 const {d,click,requests}=setup(t,{saved:{v:1,answers,page:0}});await flush();
 assert.deepEqual([...d.querySelectorAll('#pq-intro .actions>button')].map(b=>b.textContent),['Kaldığın yerden devam et (120 / 120)','Sonucu göster']);
 click('result');
 const result=d.getElementById('pq-result');assert.equal(result.querySelector('h2').textContent,'Sonucun');assert.equal(d.activeElement,d.getElementById('pq-heading'));
 assert.match(result.querySelector('.notice').textContent,/^Bunlar ham puanlardır: her boyut için verdiğin yanıtların toplamı\./);assert.match(result.querySelector('.notice').textContent,/başka insanlara göre yüksek ya da düşük olduğunu söylemez/);
 assert.match(result.querySelectorAll('.notice')[1].textContent,/^Türkçe ifadeler taslak çeviridir: 120 maddenin hepsini töre/);
 const cards=[...result.querySelectorAll('.pq-domain')];
 assert.deepEqual(cards.map(c=>[c.dataset.domain,c.querySelector('h3').textContent,c.querySelector(':scope>.pq-score').textContent]),[
  ['N','Duygusal dengesizlik','Ham puan 75 (olası aralık 24–120)'],['E','Dışadönüklük','Ham puan 72 (olası aralık 24–120)'],['O','Deneyime açıklık','Ham puan 72 (olası aralık 24–120)'],['A','Uyumluluk','Ham puan 72 (olası aralık 24–120)'],['C','Sorumluluk','Ham puan 72 (olası aralık 24–120)']]);
 const n=cards[0];assert.equal(n.querySelector('details').open,false,'alt boyutlar kapalı başlar');assert.equal(n.querySelector('summary').textContent,'Alt boyutlar');
 assert.deepEqual([...n.querySelectorAll('.pq-facets li')].map(li=>[li.dataset.facet,li.querySelector('.pq-score').textContent]),[
  ['N1','Kaygı · Ham puan 12 (olası aralık 4–20)'],['N2','Öfke · Ham puan 15 (olası aralık 4–20)'],['N3','Çökkünlük · Ham puan 12 (olası aralık 4–20)'],['N4','Çekingenlik · Ham puan 12 (olası aralık 4–20)'],['N5','Ölçüsüzlük · Ham puan 12 (olası aralık 4–20)'],['N6','Kırılganlık · Ham puan 12 (olası aralık 4–20)']]);
 assert.equal(result.querySelectorAll('.pq-facets li').length,30);
 const fill=sel=>result.querySelector(sel).style.width;
 assert.equal(fill('[data-domain="E"]>.pq-bar span'),'50%');assert.equal(fill('[data-domain="N"]>.pq-bar span'),'53%','(75−24)/(120−24)');assert.equal(fill('[data-facet="N2"] .pq-bar span'),'69%','(15−4)/(20−4)');
 for(const bar of result.querySelectorAll('.pq-bar'))assert.equal(bar.getAttribute('aria-hidden'),'true','çubuk yanındaki puan satırını yineler');
 for(const card of cards)assert.doesNotMatch(card.textContent,/yüksek|düşük|ortalama|normal|kabul edilemez|yüzdelik|iyi|kötü/i,'puanlara değer etiketi konmaz: '+card.dataset.domain);
 assert.match(result.textContent,/Bu sonuç defterine yazılmadı\. Sekmeyi kapatınca silinir\./);
 assert.deepEqual(requests.map(r=>r.op),['ui-language-get'],'sonuç için hiçbir istek yapılmaz');
 click('back');assert.ok(d.getElementById('pq-quiz'),'yanıtlara dönülebilir');
});

test('sonuç yalnız istenince dosya olur: Markdown ve JSON içeriği puanları, yanıtları ve kaynağı taşır',async t=>{
 const answers={...allAnswers(3),'N2-1':5,'N2-2':4,'N2-3':2,'N2-4':2};
 const {d,click,downloads,text,requests}=setup(t,{saved:{v:1,answers,page:0}});await flush();
 click('result');assert.equal(downloads.length,0,'kendiliğinden indirme yok');
 click('download-md');
 assert.equal(downloads.length,1);assert.match(downloads[0].name,/^tore-kisilik-testi-\d{4}-\d{2}-\d{2}\.md$/);assert.equal(downloads[0].blob.type,'text/markdown;charset=utf-8');
 assert.match(d.getElementById('page-status').textContent,/^Dosya indirme başlatıldı: tore-kisilik-testi-\d{4}-\d{2}-\d{2}\.md$/);
 const md=await text(0);
 assert.match(md,/^# töre kişilik testi sonucu\n\nTarih: \d{4}-\d{2}-\d{2}\n\nEnvanter: IPIP-NEO-120 \(Johnson, 2014\)\. Maddeler kamu malı; kaynak ipip\.ori\.org\.\n\nİfadelerin dili: Türkçe \(taslak çeviri\)\n/);
 assert.match(md,/Türkçe ifadeler taslak çeviridir: 120 maddenin hepsini töre/);assert.match(md,/Bunlar ham puanlardır/);
 assert.match(md,/\| Boyut \| Ham puan \| Olası aralık \|\n\| --- \| --- \| --- \|\n\| \*\*Duygusal dengesizlik\*\* \| \*\*75\*\* \| 24–120 \|\n\| Kaygı \| 12 \| 4–20 \|\n\| Öfke \| 15 \| 4–20 \|/);
 assert.match(md,/## Yanıtlar\n\nYanıt ölçeği: 1 = Çok yanlış, 2 = Kısmen yanlış, 3 = Ne doğru ne yanlış, 4 = Kısmen doğru, 5 = Çok doğru\.\n\n\| # \| İfade \| Yanıt \|\n\| --- \| --- \| --- \|\n\| 1 \| Çeşitli şeyler için kaygılanırım\. \| 3 \|\n/);
 assert.equal(md.split('\n').filter(l=>/^\| \d+ \| /.test(l)).length,120);assert.match(md,/\| 6 \| Kolayca öfkelenirim\. \| 5 \|/);
 click('download-json');
 assert.equal(downloads.length,2);assert.match(downloads[1].name,/^tore-kisilik-testi-\d{4}-\d{2}-\d{2}\.json$/);assert.equal(downloads[1].blob.type,'application/json');
 const file=JSON.parse(await text(1));
 assert.deepEqual(Object.keys(file),['format','version','instrument','source','date','statementLanguage','turkishDraft','scoring','domains','facets','answers']);
 assert.deepEqual([file.format,file.version,file.instrument,file.statementLanguage,file.turkishDraft],['tore-personality-result',1,'IPIP-NEO-120','tr',true]);
 assert.match(file.scoring,/No norms/);assert.deepEqual(file.domains.N,{raw:75,min:24,max:120});assert.deepEqual(file.facets.N2,{raw:15,min:4,max:20});
 assert.equal(Object.keys(file.facets).length,30);assert.equal(Object.keys(file.answers).length,120);assert.deepEqual(Object.keys(file.answers).slice(0,3),['N1-1','E1-1','O1-1']);assert.equal(file.answers['N2-1'],5);
 assert.deepEqual(requests.map(r=>r.op),['ui-language-get'],'indirme sunucuya gitmez');
});

test('yanıtları silmek ikinci kez sorar; vazgeçilebilir; silince sekmedeki kopya da gider',async t=>{
 const {d,w,click}=setup(t,{saved:{v:1,answers:{'N1-1':3,'E1-1':4},page:0}});await flush();
 click('clear');
 assert.equal(d.querySelector('[data-action="clear"]').textContent,'Evet, sil');assert.equal(d.activeElement,d.querySelector('[data-action="clear"]'));
 assert.equal(d.querySelector('.pq-clear [role="status"]').textContent,'Bütün yanıtların silinsin mi? Bu geri alınamaz.');assert.ok(w.sessionStorage.getItem('tore-personality-v1'),'ilk tık silmez');
 click('clear-cancel');assert.equal(d.querySelector('[data-action="clear"]').textContent,'Yanıtları sil');assert.equal(d.querySelector('[data-action="clear-cancel"]'),null);assert.ok(w.sessionStorage.getItem('tore-personality-v1'));
 click('start');click('clear');click('next');assert.equal(d.querySelector('[data-action="clear"]').textContent,'Yanıtları sil','sayfa değişince silme onayı düşer');
 click('clear');click('clear');
 assert.equal(w.sessionStorage.getItem('tore-personality-v1'),null);assert.ok(d.getElementById('pq-intro'));assert.equal(d.querySelector('[data-action="start"]').textContent,'Teste başla');assert.equal(d.querySelector('[data-action="clear"]'),null);
 assert.equal(d.getElementById('page-status').textContent,'Yanıtlar silindi.');
});

test('İngilizce arayüz: IPIP\'in özgün ifadeleri ve adları; taslak çeviri notu yok; dosya İngilizce',async t=>{
 const answers={...allAnswers(3),'N2-1':5,'N2-2':4,'N2-3':2,'N2-4':2};
 const {d,click,downloads,text}=setup(t,{navigatorLanguage:'en-GB',saved:{v:1,answers,page:0}});await flush();
 assert.equal(d.documentElement.lang,'en');assert.equal(d.title,'töre — Personality test');assert.equal(d.querySelector('h1').textContent,'Personality test');assert.equal(d.getElementById('page-status').textContent,'The personality test is ready.');
 assert.equal(d.querySelector('#pq-intro .notice'),null,'İngilizce özgün metinde taslak notu gösterilmez');assert.deepEqual([...d.querySelectorAll('#pq-intro li b')].map(b=>b.textContent),['What it asks:','How to answer:','What it is not:','Where your answers stay:']);
 assert.match(d.getElementById('pq-intro').textContent,/Describe yourself as you generally are now, not as you wish to be in the future\./);
 click('start');assert.equal(d.querySelector('#pq-quiz h2').textContent,'Statements 1–10 of 120');assert.equal(d.querySelector('[data-item="N1-1"] legend').textContent,'1. Worry about things.');
 assert.deepEqual([...d.querySelector('[data-item="N1-1"]').querySelectorAll('label')].map(l=>l.textContent),['Very inaccurate','Moderately inaccurate','Neither accurate nor inaccurate','Moderately accurate','Very accurate']);
 assert.equal(d.getElementById('pq-progress-text').textContent,'120 of 120 answered');
 click('back');click('result');
 const result=d.getElementById('pq-result');assert.equal(result.querySelectorAll('.notice').length,1);
 assert.deepEqual([...result.querySelectorAll('.pq-domain h3')].map(h=>h.textContent),['Neuroticism','Extraversion','Openness to experience','Agreeableness','Conscientiousness']);
 assert.equal(result.querySelector('[data-domain="N"]>.pq-score').textContent,'Raw score 75 (possible range 24–120)');assert.equal(result.querySelector('[data-facet="N2"] .pq-score').textContent,'Anger · Raw score 15 (possible range 4–20)');
 click('download-md');assert.match(downloads[0].name,/^tore-personality-test-\d{4}-\d{2}-\d{2}\.md$/);const md=await text(0);
 assert.match(md,/^# töre personality test result\n/);assert.match(md,/Language of the statements: English \(IPIP original\)/);assert.doesNotMatch(md,/draft translation|taslak/);assert.match(md,/\| 1 \| Worry about things\. \| 3 \|/);
 click('download-json');const file=JSON.parse(await text(1));assert.deepEqual([file.statementLanguage,file.turkishDraft],['en',false]);
 const missing=setup(t,{navigatorLanguage:'en-GB',saved:{v:1,answers:(()=>{const a=allAnswers(3);delete a['C6-4'];return a;})(),page:11}});await flush();
 missing.click('start');missing.click('finish');assert.match(missing.d.getElementById('pq-missing').textContent,/^1 more statement needs an answer before the result\. /);
});

test('EN | TR anahtarı ifadeleri yerinde çevirir; yanıtlar, sayfa ve açık alt boyutlar korunur',async t=>{
 const {d,click,pick,lang,stored}=setup(t);await flush();
 click('start');click('next');pick('N3-1',2);
 d.querySelector('[data-ui-lang="en"]').click();await flush();
 assert.deepEqual(lang.sets,['en']);assert.equal(d.documentElement.lang,'en');assert.equal(d.querySelector('#pq-quiz h2').textContent,'Statements 11–20 of 120');
 assert.equal(d.querySelector('[data-item="N3-1"] legend').textContent,'11. Often feel blue.');assert.equal(d.querySelector('[data-item="N3-1"] input[value="2"]').checked,true);assert.deepEqual(stored().answers,{'N3-1':2});
 d.querySelector('[data-ui-lang="tr"]').click();await flush();
 assert.equal(d.querySelector('[data-item="N3-1"] legend').textContent,'11. Çoğu zaman kendimi hüzünlü hissederim.');assert.equal(d.getElementById('page-status').textContent,'Kişilik testi hazır.');
 const done=setup(t,{saved:{v:1,answers:allAnswers(3),page:0}});await flush();done.click('result');
 done.d.querySelector('[data-domain="O"] details').open=true;
 done.d.querySelector('[data-ui-lang="en"]').click();await flush();
 assert.equal(done.d.querySelector('[data-domain="O"] details').open,true);assert.equal(done.d.querySelector('[data-domain="N"] details').open,false);
 assert.equal(done.d.querySelector('[data-facet="O6"] .pq-facet-name').textContent,'Liberalism');assert.equal(done.d.querySelectorAll('#pq-result .notice').length,1);
});

test('yerel oturum olmadan da çalışır: sayfa tarayıcı diliyle açılır, hata göstermez; sekme saklayamıyorsa bunu söyler',async t=>{
 const {d,w,click,pick,requests}=setup(t,{noSession:true,navigatorLanguage:'en-US'});await flush();
 assert.equal(requests.length,0);assert.equal(d.documentElement.lang,'en');assert.equal(d.getElementById('page-error').hidden,true);assert.equal(d.querySelector('[data-action="start"]').textContent,'Start the test');
 click('start');assert.equal(d.querySelector('.small.warning'),null);
 Object.defineProperty(w.Storage.prototype,'setItem',{value(){throw new w.DOMException('quota','QuotaExceededError');},configurable:true});
 pick('N1-1',3);click('next');
 assert.equal(d.querySelector('.small.warning').textContent,'This browser cannot keep the answers in the tab; they are lost if you reload the page.');
 click('back');assert.equal(d.querySelector('[data-item="N1-1"] input[value="3"]').checked,true,'yanıt bu sayfa açıkken bellekte durur');
});

test('yalnız aynı kaynaktan yüklenir: satır içi betik ve stil yok; sayfa ve dosyaları sunucuda kayıtlı',()=>{
 const html=read('personality.html');
 assert.doesNotMatch(html,/<script(?![^>]*\bsrc=)[^>]*>|\son[a-z]+=|\sstyle=|https?:\/\//i,'satır içi betik, olay niteliği, stil ya da dış adres yok');
 for(const file of ['personality.js','personality-data.js','personality-scoring.js'])assert.doesNotMatch(read(file).replace(/^\/\/.*$/gm,'').replace(/sourceUrl: '[^']*'/,''),/fetch\(|XMLHttpRequest|WebSocket|sendBeacon|localStorage|indexedDB|document\.cookie|innerHTML|eval\(/,file);
 assert.doesNotMatch(read('personality-scoring.js'),/document|window|sessionStorage/,'puanlama saf işlevlerdir');
 assert.equal((read('personality.js').match(/sessionStorage\.(setItem|getItem|removeItem)\(STORE/g)||[]).length,3,'sekme deposunda tek anahtar');
 const assets=fs.readFileSync(path.resolve(web,'../server/src/assets.rs'),'utf8');
 assert.ok(assets.includes('"kisilik" => Some(')&&assets.includes('include_bytes!("../../web/personality.html")'));
 for(const file of ['personality.js','personality-data.js','personality-scoring.js','personality.css','i18n-personality.js'])assert.ok(assets.includes('"'+file+'" => Some(')&&assets.includes('include_bytes!("../../web/'+file+'")'),file);
 for(const page of fs.readdirSync(web).filter(f=>f.endsWith('.html')&&f!=='personality.html'))assert.doesNotMatch(read(page),/\/kisilik/,page+': menüye eklenmedi');
});
