'use strict';
const {test}=require('node:test'),assert=require('node:assert/strict'),path=require('node:path'),{pathToFileURL}=require('node:url');
const load=()=>import(pathToFileURL(path.join(__dirname,'../../web/dream-rules.js')).href);

test('Türkçe ekli kelimelerden karakter, duygu, mekân ve tema önerir',async()=>{
 const {suggest}=await load();
 const s=suggest('Annemle eski evimizdeydik. Birden su bastı, denizde yüzüyordum ve çok korktum. Bir köpek peşimden koşuyordu.');
 assert.ok(s.characters.includes('family'));assert.ok(s.characters.includes('animal'));
 assert.ok(s.emotions.includes('fear'));assert.ok(s.emotions.includes('surprise'));
 assert.ok(s.settings.includes('home'));assert.ok(s.settings.includes('water'));
 assert.ok(s.themes.includes('chased'));
});
test('kısa kelimeler yalnız tam eşleşir: "evet", "atladım", "uçak" yanlış öneri üretmez',async()=>{
 const {suggest}=await load();
 const s=suggest('Evet dedim ve atladım, uçak kalkıyordu.');
 assert.ok(!s.settings.includes('home'));assert.ok(!s.characters.includes('animal'));
 assert.ok(!s.themes.includes('flying'));assert.ok(s.settings.includes('vehicle'));
});
test('cümle ortasındaki büyük harfli kelimeler ad adayıdır ve eklerle birlikte değiştirilir',async()=>{
 const {nameCandidates,replaceName,suggest}=await load();
 const text='Sonra Ayşe geldi. Ayşe’yi Kadıköy sahilinde gördüm.';
 assert.deepEqual(nameCandidates(text).sort(),['Ayşe','Kadıköy']);
 assert.equal(replaceName(text,'Ayşe','[KİŞİ]'),'Sonra [KİŞİ] geldi. [KİŞİ]’yi Kadıköy sahilinde gördüm.');
 assert.ok(suggest(text).characters.includes('known_person'));
});
test('e-posta ve telefon kendiliğinden maskelenir',async()=>{
 const {maskPatterns}=await load();
 assert.equal(maskPatterns('ali@example.com yazdı, 05321234567 aradı'),'[E-POSTA] yazdı, [TELEFON] aradı');
});
