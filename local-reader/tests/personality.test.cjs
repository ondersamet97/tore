'use strict';
// Kişilik testi (/kisilik): the IPIP-NEO-120 data and its scoring, without a page.
// The data file is checked for its own shape; the scoring is checked against sums worked out
// by hand from the IPIP rule (1-5, minus-keyed items reversed, a scale is the sum of its items).
const {test}=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const web=path.resolve(__dirname,'../../web');
const load=(file,names)=>new Function(fs.readFileSync(path.join(web,file),'utf8').replace(/^export /gm,'')+'\nreturn {'+names.join(',')+'};')();
const {DOMAINS,FACETS,ITEMS,PERSONALITY_INSTRUMENT}=load('personality-data.js',['DOMAINS','FACETS','ITEMS','PERSONALITY_INSTRUMENT']);
const {RESPONSES,validResponse,itemScore,administrationOrder,score,position}=load('personality-scoring.js',['RESPONSES','validResponse','itemScore','administrationOrder','score','position']);
const all=value=>Object.fromEntries(ITEMS.map(item=>[item.id,value]));

test('veri: 5 boyut, 30 alt boyut, 120 madde; her alt boyutta dört madde ve her maddenin anahtarı var',()=>{
 assert.equal(PERSONALITY_INSTRUMENT.id,'IPIP-NEO-120');assert.match(PERSONALITY_INSTRUMENT.sourceUrl,/^https:\/\/ipip\.ori\.org\//);
 assert.deepEqual(DOMAINS.map(d=>d.id),['N','E','O','A','C']);
 assert.equal(FACETS.length,30);assert.equal(ITEMS.length,120);
 for(const d of DOMAINS){assert.deepEqual(d.facets,[1,2,3,4,5,6].map(n=>d.id+n));for(const id of d.facets)assert.equal(FACETS.find(f=>f.id===id).domain,d.id);}
 for(const f of FACETS){assert.equal(ITEMS.filter(i=>i.facet===f.id).length,4,f.id);assert.ok(f.alpha>0&&f.alpha<1,f.id+' alfa');assert.ok(f.name.trim());}
 assert.equal(new Set(ITEMS.map(i=>i.id)).size,120,'madde kimlikleri tekil');
 for(const i of ITEMS){assert.match(i.id,/^[NEOAC][1-6]-[1-4]$/);assert.ok(i.id.startsWith(i.facet+'-'));assert.ok(['+','-'].includes(i.key),i.id);assert.ok(i.codes.length>=1&&i.codes.every(c=>/^[A-Z]\d+$/.test(c)),i.id+' IPIP kodu');}
 assert.equal(ITEMS.filter(i=>i.key==='+').length,65);assert.equal(ITEMS.filter(i=>i.key==='-').length,55);
});

test('veri: her madde iki dilde dolu ve tekil; Türkçe kaynağı işaretli; bilinen maddeler yerinde',()=>{
 for(const lang of ['en','tr']){assert.equal(new Set(ITEMS.map(i=>i[lang])).size,120,lang+' metinleri tekil');for(const i of ITEMS){assert.ok(i[lang].trim().length>3,i.id+' '+lang);assert.match(i[lang],/\.$/,i.id+' '+lang+' nokta ile biter');assert.equal(i[lang],i[lang].trim());}}
 for(const i of ITEMS){assert.notEqual(i.en,i.tr,i.id);assert.equal(i.trSource,'tore',i.id);}
 assert.equal(ITEMS.filter(i=>i.trSource==='tore').length,120);
 const by=id=>ITEMS.find(i=>i.id===id);
 assert.deepEqual([by('N1-1').en,by('N1-1').key,by('N1-1').codes],['Worry about things.','+',['H1157','X5']]);
 assert.deepEqual([by('N2-4').en,by('N2-4').key],['Am not easily annoyed.','-']);
 assert.deepEqual([by('C6-4').en,by('C6-4').key],['Act without thinking.','-']);
 // A plus-keyed item must read in the plus direction (a listed translation once said the opposite).
 assert.deepEqual([by('O1-1').en,by('O1-1').key,by('O1-1').tr,by('O1-1').trSource],['Have a vivid imagination.','+','Hayal gücüm canlıdır.','tore']);
});

test('madde puanı: artı anahtar olduğu gibi, eksi anahtar ters; geçersiz yanıt puan almaz',()=>{
 assert.deepEqual(RESPONSES,[1,2,3,4,5]);
 assert.deepEqual(RESPONSES.map(r=>itemScore('+',r)),[1,2,3,4,5]);
 assert.deepEqual(RESPONSES.map(r=>itemScore('-',r)),[5,4,3,2,1]);
 for(const bad of [0,6,2.5,'3',null,undefined,NaN]){assert.equal(validResponse(bad),false);assert.equal(itemScore('+',bad),null);assert.equal(itemScore('-',bad),null);}
 assert.equal(itemScore('?',3),null);
});

test('ölçek puanı: bütün yanıtlar 3 ise her alt boyut 12, her boyut 72',()=>{
 const out=score(ITEMS,FACETS,DOMAINS,all(3));
 assert.equal(out.complete,true);assert.equal(out.answered,120);assert.equal(out.total,120);assert.deepEqual(out.missing,[]);
 for(const f of FACETS)assert.deepEqual(out.facets[f.id],{raw:12,answered:4,items:4,min:4,max:20,complete:true});
 for(const d of DOMAINS)assert.deepEqual(out.domains[d.id],{raw:72,answered:24,items:24,min:24,max:120,complete:true});
});

test('ölçek puanı: bütün yanıtlar 5 ise puan, alt boyuttaki artı ve eksi madde sayısından elle hesaplanan toplamdır',()=>{
 const five=score(ITEMS,FACETS,DOMAINS,all(5)),one=score(ITEMS,FACETS,DOMAINS,all(1));
 for(const f of FACETS){const plus=ITEMS.filter(i=>i.facet===f.id&&i.key==='+').length,minus=4-plus;assert.equal(five.facets[f.id].raw,plus*5+minus*1,f.id);assert.equal(one.facets[f.id].raw,plus*1+minus*5,f.id);}
 // Worked by hand from the IPIP key page: N1 has four plus-keyed items, C6 four minus-keyed, N5 one plus and three minus.
 assert.equal(five.facets.N1.raw,20);assert.equal(five.facets.C6.raw,4);assert.equal(five.facets.N5.raw,8);
 assert.equal(one.facets.N1.raw,4);assert.equal(one.facets.C6.raw,20);assert.equal(one.facets.N5.raw,16);
 // Plus-keyed items per dimension, counted on the key page: N 17, E 18, O 12, A 7, C 11 (65 in all).
 assert.deepEqual(DOMAINS.map(d=>five.domains[d.id].raw),[17*5+7,18*5+6,12*5+12,7*5+17,11*5+13]);
 assert.deepEqual(DOMAINS.map(d=>five.domains[d.id].raw),[92,96,72,52,68]);
 assert.deepEqual(DOMAINS.map(d=>five.domains[d.id].raw+one.domains[d.id].raw),[144,144,144,144,144],'5 ve 1 yanıtları birbirinin aynası');
});

test('ölçek puanı: tek bir alt boyutun yanıtları elle toplanır; öbür boyutlara dokunmaz',()=>{
 // N2 Anger: Get angry easily (+) 5, Get irritated easily (+) 4, Lose my temper (+) 2, Am not easily annoyed (−) 2 → 5+4+2+(6−2)=15.
 const answers={...all(3),'N2-1':5,'N2-2':4,'N2-3':2,'N2-4':2};
 const out=score(ITEMS,FACETS,DOMAINS,answers);
 assert.equal(out.facets.N2.raw,15);assert.equal(out.domains.N.raw,72-12+15);
 for(const d of ['E','O','A','C'])assert.equal(out.domains[d].raw,72);
});

test('eksik yanıt: puan uydurulmaz; eksik maddeler sayılır ve o alt boyut ile boyut boş kalır',()=>{
 const answers=all(4);delete answers['A3-2'];answers['C1-1']=9;
 const out=score(ITEMS,FACETS,DOMAINS,answers);
 assert.equal(out.complete,false);assert.equal(out.answered,118);assert.deepEqual(out.missing,['A3-2','C1-1']);
 assert.equal(out.facets.A3.raw,null);assert.equal(out.facets.A3.answered,3);assert.equal(out.domains.A.raw,null);assert.equal(out.domains.A.complete,false);
 assert.equal(out.facets.C1.raw,null);assert.equal(out.domains.C.raw,null);
 assert.notEqual(out.domains.N.raw,null);assert.equal(out.domains.N.complete,true);
 const empty=score(ITEMS,FACETS,DOMAINS,{});assert.equal(empty.answered,0);assert.equal(empty.missing.length,120);
 // Inherited keys are not answers.
 assert.equal(score(ITEMS,FACETS,DOMAINS,Object.create(all(3))).answered,0);
});

test('sıra: 120 maddenin her biri bir kez; alt boyutlar sırayla döner; aynı alt boyut art arda gelmez',()=>{
 const order=administrationOrder(ITEMS,DOMAINS);
 assert.equal(order.length,120);assert.deepEqual([...order].sort(),ITEMS.map(i=>i.id).sort());
 assert.deepEqual(order.slice(0,10),['N1-1','E1-1','O1-1','A1-1','C1-1','N2-1','E2-1','O2-1','A2-1','C2-1']);
 assert.deepEqual(order.slice(30,32),['N1-2','E1-2']);assert.equal(order[119],'C6-4');
 const facetOf=id=>id.split('-')[0];
 for(let i=1;i<order.length;i++)assert.notEqual(facetOf(order[i]),facetOf(order[i-1]));
 for(let i=0;i<120;i+=30)assert.equal(new Set(order.slice(i,i+30).map(facetOf)).size,30,'her 30 maddede her alt boyuttan bir tane');
});

test('çubuk konumu: olası aralığın içinde 0 ile 1 arası; aralık dışına taşmaz',()=>{
 assert.equal(position(4,{min:4,max:20}),0);assert.equal(position(20,{min:4,max:20}),1);assert.equal(position(12,{min:4,max:20}),0.5);
 assert.equal(position(72,{min:24,max:120}),0.5);assert.equal(position(999,{min:4,max:20}),1);assert.equal(position(-5,{min:4,max:20}),0);
 assert.equal(position(null,{min:4,max:20}),0);assert.equal(position(5,{min:5,max:5}),0);
});
