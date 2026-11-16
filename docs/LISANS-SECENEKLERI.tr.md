# Töre için lisans seçenekleri — karar notu

**15 Kasım 2026 · Karar verildi: A yolu, PolyForm Noncommercial 1.0.0.**

> **Karar (15 Kasım 2026, 0.11.0-rc.4).** A yolunu seçtin. 0.11.0-rc.4 sürümünden itibaren özgün kod, resmî metni değiştirilmeden PolyForm Noncommercial 1.0.0 ile sunulur; `LICENSE`, `NOTICE.md`, paket üstverisi ve README buna göre eşitlendi. Standart metnin verdiği izinler olduğu gibi geçerlidir; aşağıda A için anlatılan kurum izinleri ve ayrı dağıtım izni buna dahildir. Lisansın izin vermediği kullanımlar, özellikle ticari kullanım, ayrı yazılı iznine bağlıdır; başvuru yolu henüz belirlenmedi. 0.11.0-rc.3 ve önceki sürümler AGPL-3.0-only olarak hazırlanmıştı; o sürümler için verilmiş haklar geriye dönük kaldırılmaz. Kamuya yayın yapılmadı; yayın ayrı karardır.
>
> Aşağıdaki metin karardan önce yazılmış seçenek notudur ve o günkü durumu anlatır.

İstediğin sınır şu: kaynak kod incelenebilsin; belirleyeceğin ticari kullanımlar için ayrıca yazılı iznin gereksin. Bu hedefe uygun yeni lisans henüz uygulanmadı. Depodaki **AGPL-3.0-only** lisansı aynen duruyor ve ticari kullanımı yasaklamıyor. Public yayın yapılmadı; lisans kararı verilene kadar hazırlanan paket yerelde kalmalı.

Sen, **özgün Töre kodunun sana ait olduğunu ve dış katkı bulunmadığını** belirttin. Bu beyan özgün kod için seçenek hazırlamamıza dayanak oluşturuyor. Git kaydı tek başına işveren haklarını veya önceki bütün kod geçmişini kanıtlamaz. Üçüncü taraf kütüphanelerin kendi lisansları korunur; yeni ticari kullanım kısıtlaman onların bağımsız haklarını değiştirmez.

## İki uygulanabilir yol

**A — PolyForm Noncommercial 1.0.0 ve ayrı ticari izin.** Hazır bir metin kullanmak, yeni bir lisans yazma işini azaltır. Ancak standart metin bazı kurumlara geniş izinler verir ve dağıtım için ayrıca bir izin içerir. “Her şirket kullanımı ve her ücretli dağıtım kesinlikle yasak” diye sunamayız. Metnin verdiği izinleri kabul ediyorsan pratik bir başlangıç olabilir. [Resmî lisans metni](https://polyformproject.org/licenses/noncommercial/1.0.0).

**B — Töre’ye özel ticari olmayan kullanım lisansı ve ayrı ticari izin.** Hangi faaliyetlerin izne bağlı olduğunu açıkça tanımlayabiliriz: şirket içinde kullanım, müşteriye ücretli hizmet, barındırma, yazılım satışı gibi. İstediğin sınırı daha doğrudan tarif eder; buna karşılık hazırlanması, yorumlanması ve hukuki incelemesi daha fazla iş gerektirir. Şu anda böyle bir lisans yazılmış veya yürürlüğe konmuş değil.

Aşağıdaki tablo B için bir **başlangıç önerisini** gösterir; senin verilmiş kararın veya mevcut lisans koşulu değildir.

| Kullanım | Mevcut AGPL | A: standart PolyForm seçilirse | B: özel metin için önerilen başlangıç |
| --- | --- | --- | --- |
| Kişisel kullanım, öğrenme ve hobi | Lisans koşullarıyla izinli. | Standart kişisel kullanım koşulları esas alınır. | Ticari amaç taşımayan kişisel kullanım serbest olsun. |
| Eğitim ve ticari olmayan araştırma | Lisans koşullarıyla izinli. | Kurum istisnaları ve kullanım amacı birlikte değerlendirilmeli. | Belirlenen eğitim/araştırma kapsamı serbest olsun; şirket destekli araştırma ayrıca netleşsin. |
| Şirket içinde kullanım ve ürün araştırması | Ticari olması tek başına yasak değildir. | “Şirket” veya “ücretsiz” etiketi tek başına yeterli sınıflandırma değildir. | Yazılı izin gereksin; kısa değerlendirme denemesi için istisna isteyip istemediğini seç. |
| SaaS, barındırma ve ücretli hizmet | Kaynak sağlama dahil uygulanabilir yükümlülüklerle mümkündür. | Kullanımın standart izinlere girip girmediği değerlendirilir. | Yazılı izin gereksin; reklamlı veya bağışla finanse edilen ücretsiz hizmetler de tanımlansın. |
| Yazılım satışı, paketleme ve dağıtım | Satış mümkündür; lisans/atıf yükümlülükleri sürer. | Ayrı dağıtım izni nedeniyle genel bir satış yasağı varsayılmasın. | Ticari satış ve paketleme yazılı izne bağlı olsun; ücretsiz aynalar ve masraf karşılığı kopyalar ayrıca tanımlansın. |
| Kod değişikliği ve çatallanma | AGPL koşulları geçerlidir. | Standart değişiklik ve dağıtım hükümleri geçerlidir. | Ticari olmayan değişikliklere izin verilsin; yeniden dağıtım koşulları açık yazılsın. |
| Daha önce AGPL altında edinilmiş sürümler | Edinilmiş haklar, koşullara uyulduğu sürece devam eder. | Yeni tercih eski hakları geriye dönük kaldırmaz. | Yeni tercih eski hakları geriye dönük kaldırmaz. |

AGPL hakkındaki karşılaştırma, [resmî AGPL metnine](https://www.gnu.org/licenses/agpl-3.0.html) dayanır. Kendi kodunu farklı lisanslarla sunabilmek ile başkasına daha önce verilmiş hakları kaldırmak farklı konulardır; [GNU’nun açıklaması](https://www.gnu.org/licenses/gpl-faq.en.html#ReleaseUnderGPLAndNF) bu ayrımı destekler.

## Diğer seçenek neden daha az uygun?

**Business Source License 1.1**, belirli bir süre sonra sürümü açık lisansa geçirir. Süresiz ticari izin kontrolü istiyorsan hedefinle uyuşmaz. İleride “önce sınırlı kullanım, sonra açık kaynak” stratejisi seçersen yeniden değerlendirilebilir. [Resmî BSL 1.1 metni](https://mariadb.com/bsl11/).

Ticari kullanım kısıtlaması getiren gelecek sürümü **source-available / kaynak kodu incelenebilir** diye tanımlamalıyız. Bu kısıtlamayı “açık kaynak” adı altında sunmamalıyız. [Open Source Initiative tanımı](https://opensource.org/osd).

## Pratik önerim ve senden beklenen karar

Standart metnin izinleri sana uygunsa **A**, hazırlama yükünü azaltır. “Şirket içinde kullanım, ücretli hizmet ve ticari satışın her biri ayrıca iznimi gerektirsin” diyorsan **B**, istediğin politikayı daha açık kurmamıza imkân verir. **Bu not senin yerine seçim yapmıyor.**

Seçimden önce üç sınırı birlikte belirlemek yeterli:

1. Şirketlerin yalnız değerlendirme veya araştırma amaçlı ücretsiz denemelerine izin verelim mi?
2. Eğitim, kamu ve yardım kuruluşları için geniş bir istisna mı, faaliyet türüne bağlı bir istisna mı olsun?
3. Ücretsiz yeniden dağıtım, masraf karşılığı kopya ve ücretli satış birbirinden nasıl ayrılsın?

Kullanıcı konuşmaları, görüşler ve veri paketleri yazılım lisansından ayrıdır. Töre’yi kullanma izni, o içerikleri satma veya model eğitiminde kullanma izni sayılmaz. Ticari yazılım izni vermek için bugün ödeme sistemi kurmamız gerekmiyor; yazılı izin sürecini ayrıca tasarlayabiliriz.

Bu çalışma hukuki kesinlik veya uygulanabilirlik garantisi değildir. Seçilen politikanın kapsamı ve lisans metni yayın öncesinde incelenmeli. Teknik lisans envanteri, geçmiş incelemesi ve yayın koşulları [ayrıntılı İngilizce denetimde](PREVIEW-LICENSE-REVIEW.md); bağımlılık kayıtları [üçüncü taraf bildirimlerinde](THIRD-PARTY-NOTICES.md).
