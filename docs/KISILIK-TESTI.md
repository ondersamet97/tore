# Kişilik testi (`/kisilik`)

töre içinde, tarayıcı sekmesinde yanıtlanıp puanlanan IPIP-NEO-120 kişilik envanteri. Bu belge kaynağı, puanlama kuralını, sınırları ve Türkçe çevirinin durumunu kaydeder.

Durum: töre 0.18.0 içinde. Menüde bağlantısı yok; yalnız adresiyle açılır.

## Nasıl açılır

töre açıkken aynı sekmede adresin sonunu `/kisilik` yap (örnek: `http://127.0.0.1:PORT/kisilik`). Sayfa yerel oturum olmadan da çalışır; o durumda yalnız dil seçimi kaydedilmez.

## Kaynak

| Ne | Nereden | Okunma tarihi |
| --- | --- | --- |
| 120 madde, alt boyutlar, artı/eksi anahtar, İngilizce alt boyut alfaları | https://ipip.ori.org/30FacetNEO-PI-RItems.htm | 2026-11-20 |
| Madde kodları | https://ipip.ori.org/AlphabeticalItemList.htm | 2026-11-20 |
| Puanlama kuralı | https://ipip.ori.org/newScoringInstructions.htm | 2026-11-20 |
| Yönerge ve yanıt seçenekleri | https://ipip.ori.org/New_IPIP-50-item-scale.htm | 2026-11-20 |
| Kullanım izni | https://ipip.ori.org/newPermission.htm | 2026-11-20 |

Kaynak gösterimi: Johnson, J. A. (2014). Measuring thirty facets of the Five Factor Model with a 120-item public domain inventory: Development of the IPIP-NEO-120. *Journal of Research in Personality, 51*, 78-89.

IPIP maddeleri ve ölçekleri kamu malıdır; ticari kullanım dahil izin ya da ücret gerekmez. Başka hiçbir kişilik testinin maddesi, puanlaması, grafiği ya da adı kullanılmadı.

## Yapı ve puanlama

- 5 boyut, 30 alt boyut, 120 madde. Her alt boyutta 4, her boyutta 24 madde.
- 65 madde artı, 55 madde eksi anahtarlıdır.
- Yanıt 1 ile 5 arasıdır: Çok yanlış, Kısmen yanlış, Ne doğru ne yanlış, Kısmen doğru, Çok doğru.
- Artı anahtarlı madde yanıtın kendisiyle, eksi anahtarlı madde tersiyle (6 − yanıt) puanlanır.
- Alt boyut puanı 4 maddenin toplamıdır (4–20). Boyut puanı 6 alt boyutun toplamıdır (24–120).
- Eksik yanıt tahmin edilmez; 120 maddenin hepsi yanıtlanmadan sonuç gösterilmez.

Kod: `web/personality-data.js` (veri), `web/personality-scoring.js` (saf işlevler), `web/personality.js` (sayfa).

## Maddelerin sırası

IPIP bir madde sırası şart koşmaz. Sayfa her turda her alt boyuttan bir madde gösterir (N1, E1, O1, A1, C1, N2, …), dört tur. Bu sıra töre'nindir; Johnson'ın özgün madde numaralaması değildir.

## Sınırlar

- **Norm yok.** IPIP sitesi norm yayımlamaz ve kendi örneklemden norm çıkarmayı önerir. Sonuç ham puandır; sayfa hiçbir puana "yüksek" ya da "düşük" demez. Çubuk yalnız puanın olası aralıktaki yerini gösterir.
- **Türkçe maddeler taslaktır.** töre'nin kendi çevirisidir; hiçbiri incelenmedi, geri çevrilmedi ya da bir örneklemde sınanmadı. Türkçe sonuç İngilizce özgün metinle alınacak sonuçla karşılaştırılamaz.
- **Alfa değerleri İngilizce ölçek içindir** (Johnson, internet örneklemi, N = 619.150). Türkçe taslak hakkında bir şey söylemez.
- **Tanı değildir.** Sayfa bunu açılışta söyler.
- **O6 alt boyutunda iki madde oy verme eğilimini sorar.** Bu, envanterin özgün içeriğidir.

## Gizlilik

- Yanıtlar yalnız tarayıcı sekmesinde, `sessionStorage` içinde `tore-personality-v1` anahtarıyla durur; sekme kapanınca silinir.
- Sayfanın kendi betiği yalnız arayüz dilini okur ve yazar (`ui-language-get`, `ui-language-set`); deftere yazmaz, başka istek yapmaz. Ortak alt bilgi, her sayfadaki gibi, görünür olunca sürüm satırı için `status` sorar.
- Sonuç yalnız kişi düğmeye basarsa Markdown ya da JSON dosyası olarak indirilir.
- Yanıtları silmek ikinci bir onay ister.

## Türkçe çevirinin durumu

120 maddenin hepsi töre'nin İngilizce özgün metinden yaptığı çeviridir (`trSource: 'tore'`). Başka bir çeviri listesinden madde alınmadı; bu yüzden Türkçe metin depodaki diğer metinlerle aynı lisansla dağıtılabilir.

Çeviri kuralları: birinci tekil kişi, geniş zaman; özgün maddenin anlamı ve şiddeti korunur, ek bir koşul ya da nicelik eklenmez; artı ve eksi anahtarlı maddeler özgün yönü korur.

Yayından önce açık kalan konu: **çevirinin doğruluğu.** Hiçbir madde ikinci bir çevirmence incelenmedi, geri çevrilmedi ya da bir örneklemde sınanmadı.

### İnceleme tablosu

Bütün satırlar inceleme bekliyor.

| Madde | Anahtar | IPIP kodu | İngilizce | Türkçe | Not |
| --- | --- | --- | --- | --- | --- |
| N1-1 | + | H1157, X5 | Worry about things. | Çeşitli şeyler için kaygılanırım. |  |
| N1-2 | + | H999 | Fear for the worst. | En kötüsünün olacağından korkarım. |  |
| N1-3 | + | H968 | Am afraid of many things. | Birçok şeyden korkarım. |  |
| N1-4 | + | X107 | Get stressed out easily. | Kolayca strese girerim. |  |
| N2-1 | + | H754, X18 | Get angry easily. | Kolayca öfkelenirim. |  |
| N2-2 | + | H761 | Get irritated easily. | Kolayca sinirim bozulur. |  |
| N2-3 | + | H755 | Lose my temper. | Öfkeme hâkim olamadığım olur. |  |
| N2-4 | - | X23 | Am not easily annoyed. | Kolay kolay sinirlenmem. |  |
| N3-1 | + | X74 | Often feel blue. | Çoğu zaman kendimi hüzünlü hissederim. |  |
| N3-2 | + | X15 | Dislike myself. | Kendimden hoşlanmam. |  |
| N3-3 | + | H640 | Am often down in the dumps. | Sık sık moralim bozuk olur. |  |
| N3-4 | - | X129 | Feel comfortable with myself. | Kendimle huzurluyum. |  |
| N4-1 | + | H592 | Find it difficult to approach others. | Başkalarına yaklaşmakta güçlük çekerim. |  |
| N4-2 | + | H655 | Am afraid to draw attention to myself. | Üzerime dikkat çekmekten çekinirim. |  |
| N4-3 | + | H656 | Only feel comfortable with friends. | Yalnızca arkadaşlarımla birlikteyken rahat ederim. |  |
| N4-4 | - | X209 | Am not bothered by difficult social situations. | Zor sosyal durumlar beni rahatsız etmez. |  |
| N5-1 | + | X133 | Go on binges. | Kendimi tutamayıp aşırıya kaçtığım olur. | Madde ölçüyü kaçırmayı (aşırı yeme, içme, harcama) soruyor. |
| N5-2 | - | X181 | Rarely overindulge. | Nadiren ölçüyü kaçırırım. |  |
| N5-3 | - | X274 | Easily resist temptations. | Ayartıcı şeylere kolayca direnirim. |  |
| N5-4 | - | X251 | Am able to control my cravings. | Güçlü isteklerimi denetleyebilirim. |  |
| N6-1 | + | H948, X64 | Panic easily. | Kolayca paniğe kapılırım. |  |
| N6-2 | + | H959 | Become overwhelmed by events. | Olaylar karşısında bunalırım. |  |
| N6-3 | + | H954 | Feel that I'm unable to deal with things. | Bir şeylerle baş edemeyeceğimi hissederim. |  |
| N6-4 | - | X79 | Remain calm under pressure. | Baskı altında sakin kalırım. |  |
| E1-1 | + | H29 | Make friends easily. | Kolayca arkadaşlık kurarım. |  |
| E1-2 | + | X112 | Feel comfortable around people. | İnsanların arasında rahat hissederim. |  |
| E1-3 | - | H648 | Avoid contacts with others. | Başkalarıyla temas kurmaktan kaçınırım. |  |
| E1-4 | - | H704 | Keep others at a distance. | İnsanları kendimden uzak tutarım. |  |
| E2-1 | + | H78, X17 | Love large parties. | Kalabalık partileri çok severim. | «Toplantı» iş toplantısı diye okunabileceği için «parti» kullanıldı. |
| E2-2 | + | X83 | Talk to a lot of different people at parties. | Partilerde birçok farklı insanla konuşurum. |  |
| E2-3 | - | H587 | Prefer to be alone. | Tek başıma olmayı yeğlerim. |  |
| E2-4 | - | H650, X22 | Avoid crowds. | Kalabalık yerlerden uzak dururum. |  |
| E3-1 | + | H334, X27 | Take charge. | Yönetimi üstlenirim. |  |
| E3-2 | + | H524 | Try to lead others. | Başkalarına önderlik etmeye çalışırım. |  |
| E3-3 | + | H325 | Take control of things. | İşlerin denetimini elime alırım. |  |
| E3-4 | - | H976 | Wait for others to lead the way. | Yolu başkalarının göstermesini beklerim. |  |
| E4-1 | + | H58 | Am always busy. | Her zaman meşgulümdür. |  |
| E4-2 | + | H54, X40 | Am always on the go. | Hep hareket hâlindeyim. |  |
| E4-3 | + | H79 | Do a lot in my spare time. | Boş vakitlerimde pek çok şey yaparım. |  |
| E4-4 | - | E113 | Like to take it easy. | Kendimi yormadan, ağırdan almayı severim. |  |
| E5-1 | + | H438, X50 | Love excitement. | Heyecanı çok severim. |  |
| E5-2 | + | H446 | Seek adventure. | Macera peşinde koşarım. |  |
| E5-3 | + | E35 | Enjoy being reckless. | Pervasız davranmaktan zevk alırım. |  |
| E5-4 | + | H871 | Act wild and crazy. | Deli dolu davranırım. |  |
| E6-1 | + | H32, X63 | Radiate joy. | Etrafıma neşe yayarım. |  |
| E6-2 | + | H1094 | Have a lot of fun. | Bolca eğlenirim. |  |
| E6-3 | + | H33 | Love life. | Yaşamı severim. |  |
| E6-4 | + | H42 | Look at the bright side of life. | Hayata olumlu tarafından bakarım. |  |
| O1-1 | + | X14 | Have a vivid imagination. | Hayal gücüm canlıdır. |  |
| O1-2 | + | X238 | Enjoy wild flights of fantasy. | Sınırsız hayallere kapılmaktan hoşlanırım. |  |
| O1-3 | + | X71 | Love to daydream. | Gündüz düşleri kurmayı severim. |  |
| O1-4 | + | E163 | Like to get lost in thought. | Düşüncelere dalıp gitmeyi severim. |  |
| O2-1 | + | X123 | Believe in the importance of art. | Sanatın önemli olduğuna inanırım. |  |
| O2-2 | + | E105 | See beauty in things that others might not notice. | Başkalarının fark etmeyebileceği şeylerde güzellik görürüm. |  |
| O2-3 | - | X45 | Do not like poetry. | Şiirden hoşlanmam. |  |
| O2-4 | - | X235 | Do not enjoy going to art museums. | Sanat müzelerini gezmekten keyif almam. |  |
| O3-1 | + | X92 | Experience my emotions intensely. | Duygularımı derinden yaşarım. |  |
| O3-2 | + | E136 | Feel others' emotions. | Başkalarının duygularını içimde hissederim. |  |
| O3-3 | - | X10 | Rarely notice my emotional reactions. | Duygusal tepkilerimi nadiren fark ederim. |  |
| O3-4 | - | E156 | Don't understand people who get emotional. | Duygusallaşan insanları anlamam. |  |
| O4-1 | + | X204 | Prefer variety to routine. | Rutin yerine çeşitliliği yeğlerim. |  |
| O4-2 | - | X30 | Prefer to stick with things that I know. | Bildiğim şeylerden ayrılmamayı yeğlerim. |  |
| O4-3 | - | H1063, X43 | Dislike changes. | Değişiklik sevmem. |  |
| O4-4 | - | H312 | Am attached to conventional ways. | Alışılagelmiş yöntemlere bağlıyımdır. |  |
| O5-1 | + | X211 | Love to read challenging material. | Zorlayıcı metinler okumaya bayılırım. |  |
| O5-2 | - | X248 | Avoid philosophical discussions. | Felsefi tartışmalara girmekten kaçınırım. |  |
| O5-3 | - | X176 | Have difficulty understanding abstract ideas. | Soyut fikirleri anlamakta güçlük çekerim. |  |
| O5-4 | - | X239 | Am not interested in theoretical discussions. | Kuramsal tartışmalarla ilgilenmem. |  |
| O6-1 | + | X218 | Tend to vote for liberal political candidates. | Liberal, ilerici siyasi adaylara oy verme eğilimindeyim. | ABD'deki anlamıyla «liberal» (ilerici, sol eğilimli) kastediliyor; Türkçede «liberal» ekonomik liberalizm diye de okunabildiği için «ilerici» eklendi. |
| O6-2 | + | X184 | Believe that there is no absolute right and wrong. | Mutlak doğru ve yanlış diye bir şey olmadığına inanırım. |  |
| O6-3 | - | X126 | Tend to vote for conservative political candidates. | Muhafazakâr siyasi adaylara oy verme eğilimindeyim. | Özgün madde «eğilim» der; çeviri de eğilim olarak kurdu. |
| O6-4 | - | X157 | Believe that we should be tough on crime. | Suça karşı sert olunması gerektiğine inanırım. |  |
| A1-1 | + | H113, X6 | Trust others. | Diğer insanlara güvenirim. |  |
| A1-2 | + | H549 | Believe that others have good intentions. | Başkalarının iyi niyetli olduğuna inanırım. |  |
| A1-3 | + | E157 | Trust what people say. | İnsanların söylediklerine güvenirim. |  |
| A1-4 | - | H1195, X12 | Distrust people. | İnsanlardan şüphelenirim. |  |
| A2-1 | - | H416, X24 | Use others for my own ends. | Başkalarını kendi amaçlarım için kullanırım. |  |
| A2-2 | - | X198 | Cheat to get ahead. | Öne geçmek için hile yaparım. |  |
| A2-3 | - | H427, V109 | Take advantage of others. | Başkalarından çıkar sağlarım. |  |
| A2-4 | - | H494 | Obstruct others' plans. | Başkalarının planlarını engellerim. |  |
| A3-1 | + | H1100, X31 | Am concerned about others. | Başkalarının iyiliğini önemserim. |  |
| A3-2 | + | H1108 | Love to help others. | Başkalarına yardım etmeye bayılırım. |  |
| A3-3 | - | X203 | Am indifferent to the feelings of others. | Başkalarının duygularını umursamam. |  |
| A3-4 | - | H918, X170 | Take no time for others. | Başkalarına vakit ayırmam. |  |
| A4-1 | - | H453 | Love a good fight. | Hararetli bir kavgadan keyif alırım. |  |
| A4-2 | - | H809 | Yell at people. | İnsanlara bağırıp çağırırım. |  |
| A4-3 | - | H1103 | Insult people. | İnsanları aşağılarım. |  |
| A4-4 | - | H699 | Get back at others. | Başkalarından hıncımı alırım. |  |
| A5-1 | - | H736, X61 | Believe that I am better than others. | Başkalarından üstün olduğuma inanırım. |  |
| A5-2 | - | H2043 | Think highly of myself. | Kendimi çok değerli bulurum. |  |
| A5-3 | - | H738 | Have a high opinion of myself. | Kendim hakkında yüksek bir fikrim vardır. |  |
| A5-4 | - | H746 | Boast about my virtues. | Erdemlerimle övünürüm. | Özgün madde «virtues» der: yetenek değil, erdem. |
| A6-1 | + | X259 | Sympathize with the homeless. | Evsizlerin durumuna üzülürüm. |  |
| A6-2 | + | E115 | Feel sympathy for those who are worse off than myself. | Benden daha kötü durumda olanlara yakınlık duyarım. |  |
| A6-3 | - | X227 | Am not interested in other people's problems. | Başka insanların sorunları ilgimi çekmez. |  |
| A6-4 | - | E166 | Try not to think about the needy. | İhtiyaç sahiplerini düşünmemeye çalışırım. |  |
| C1-1 | + | H1285 | Complete tasks successfully. | Üstlendiğim işleri başarıyla bitiririm. |  |
| C1-2 | + | H1174, X8 | Excel in what I do. | Yaptığım işte çok iyiyimdir. |  |
| C1-3 | + | H1354 | Handle tasks smoothly. | İşleri sorunsuzca hallederim. |  |
| C1-4 | + | H1333 | Know how to get things done. | Bir işi nasıl bitireceğimi bilirim. |  |
| C2-1 | + | H244, X21 | Like to tidy up. | Ortalığı toplamayı severim. |  |
| C2-2 | - | X82 | Often forget to put things back in their proper place. | Eşyaları yerine koymayı sık sık unuturum. |  |
| C2-3 | - | H822, X16 | Leave a mess in my room. | Odamı darmadağın bırakırım. |  |
| C2-4 | - | H823 | Leave my belongings around. | Eşyalarımı ortalıkta bırakırım. |  |
| C3-1 | + | H149, X33, V14 | Keep my promises. | Verdiğim sözleri tutarım. |  |
| C3-2 | + | H145 | Tell the truth. | Gerçeği söylerim. |  |
| C3-3 | - | H1346 | Break rules. | Kuralları çiğnerim. |  |
| C3-4 | - | H1018, X51 | Break my promises. | Verdiğim sözlerden dönerim. |  |
| C4-1 | + | H2014 | Do more than what's expected of me. | Benden beklenenden fazlasını yaparım. |  |
| C4-2 | + | H1206, X44 | Work hard. | Çok çalışırım. |  |
| C4-3 | - | X167 | Put little time and effort into my work. | İşime pek zaman ve emek ayırmam. |  |
| C4-4 | - | X115 | Do just enough work to get by. | Ancak durumu kurtaracak kadar çalışırım. |  |
| C5-1 | + | X87 | Am always prepared. | Her zaman hazırlıklı olurum. |  |
| C5-2 | + | H258 | Carry out my plans. | Planlarımı hayata geçiririm. |  |
| C5-3 | - | H1186, X49 | Waste my time. | Vaktimi boşa geçiririm. |  |
| C5-4 | - | H621 | Have difficulty starting tasks. | İşlere başlamakta güçlük çekerim. |  |
| C6-1 | - | E46 | Jump into things without thinking. | Düşünmeden bir şeylere dalarım. |  |
| C6-2 | - | H853 | Make rash decisions. | Aceleci kararlar alırım. |  |
| C6-3 | - | H862, X101 | Rush into things. | Bir şeylere aceleyle girişirim. |  |
| C6-4 | - | H846 | Act without thinking. | Düşünmeden davranırım. |  |
