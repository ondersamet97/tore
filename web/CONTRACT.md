# Töre 0.3.0 frontend sözleşmesi

`index.html`, `style.css`, `app.js`, `identity.js` ve `reader.js` aynı yerel origin'den sunulur. Vendor dosyaları `/vendor/marked-18.2.0.js` ve `/vendor/dompurify-3.4.17.js` adreslerindedir. Başka origin'den script, stil, yazı tipi veya görsel alınmaz. Markdown okuyucusu 0.2.0'ın ayrıştırıcı ve temizleme kurallarını korur; özgün arşiv dosyalarını açmaz/değiştirmez.

## Kimlik modülü

`identity.js` ES modülüdür:

- `createIdentity(passphrase)` yeni Ed25519 kimliği ve şifreli kurtarma paketi üretir.
- `unlockIdentity(keyFileText, passphrase)` paketi açar ve açık/özel anahtar eşleşmesini imza doğrulamasıyla denetler.
- `signPayload(identity, exactJSON)` UTF-8 JSON metninin tam baytlarını imzalar; standart Base64 imza döndürür.
- `recoveryText(identity)` indirilebilir şifreli JSON döndürür.

Kimlik nesnesi `{id, publicKey, privateKey, recoveryFile}` içerir. `id`, 32 bayt açık anahtarın dolgusuz Base64URL gösterimidir. `privateKey`, çıkarılamayan bir `CryptoKey` nesnesidir. Anahtar dosyası biçimi `{format:'tore-key', version:1, publicKey, salt, iv, iterations:310000, ciphertext}`; Base64 alanları standart dolguludur. PKCS8 özel anahtarı PBKDF2-SHA256 ve AES-256-GCM ile şifrelenir; salt 16, IV 12 rastgele bayttır. Özel anahtar ve parola istek gövdesine eklenmez. Tarayıcı depolaması kullanılmaz.

İndirme düğmesi dosyanın tarayıcı indirmesini başlatır. Arayüz dosyanın diske gerçekten kaydedildiğini gözlemleyemez; kayıt, kullanıcının dosyayı indirdiğini/sakladığını ayrıca işaretlemesini gerektirir. Kilitleme ve sayfanın kapanması bellekteki kimliği bırakır. Dosyayı ve parolayı kurtarma servisi yoktur.

## İstekler

İmzasız tek başlangıç isteği `GET /api/info` olur. Kullanıcı işlemleri `POST /api/event` ile `{event,signature}` gönderir. `event`, sıralaması değiştirilmeden imzalanan `JSON.stringify({version:1,id,author,issuedAt,action,payload})` metnidir. İsteklerde cookie/ambient oturum kullanılmaz. Otomatik yoklama veya arka plan eşitlemesi yoktur.

Akış filtreleri `snapshot` payload'ında `feed,targetId,topic,subtopic,area` alanlarıyla sunucuya iletilir. Başlık/metin araması yalnız alınmış güncel yayınların metninde Türkçe harf kurallarıyla yapılır.

Yayın, yanıt ve karşılaştırma formları kullanıcının yazdıklarını aktarır. Bir .md dosyası seçmek yalnız taslak alanını doldurur; yayımlama ayrı onay gerektirir. Yanıt `postId+version+quote` taşır. `answered` ve `resolved` ayrı işaretlerdir. Karşılaştırma kaynak sürümleri düzenleme sırasında sabit kalır. Takipte mevcut kaydın bildirim tercihleri aynı filtreyle güncellenir; yeni kapsam yeni takip olarak eklenir. Bildirimler varsayılan kapalıdır.

Yayın dışa/içe aktarımı önce dosya içeriğinin yayın/sürüm özetini gösterir. Aktarım kendi imzalı profil/yayın kayıtlarıyla sınırlıdır; başka kişilerin yayınları, yanıtlar, karşılaştırmalar ve takip kayıtları bu paketin yedeği değildir.

## Doğrulama sınırı

`tests/identity.test.mjs` Node WebCrypto doğrulamasıdır. `tests/network-ui.test.cjs`, gerçek native HTTP sunucusundan gelen güncel HTML/JS dosyalarını ve public DOM formlarını jsdom ile çalıştırır. jsdom ES modüllerini doğrudan çalıştırmadığından kaynak aynı modül kapsamını koruyan test adaptörüyle değerlendirilir. Dosya indirmeleri bu testte yakalanan anchor/blob çağrılarıdır; gerçek Chrome seçicisi veya gerçek tarayıcı indirmesi olarak raporlanmamalıdır.

## 0.17 sayfaları: Güncelle ve Aşılmış düşünceler

Yeni bir sayfa ve onun betik, stil ve dil dosyaları `server/src/assets.rs` içinde aynı kalıpla kaydedilir; aynı CSP ve başlıklarla, yalnız aynı origin'den sunulur. Her sayfa `i18n.js` ve kendi `i18n-*.js` sözlüğünü yükler; EN | TR seçimi sayfayı yeniden yüklemeden yerinde çizer. Kişinin kayıtları, alıntıları ve servis hata metinleri çevrilmez.

- `/guncelle` (`reports.html`, `reports.js`, `i18n-reports.js`, `reports.css`): Claude Code projeleri kapalı başlar; açma/kapama tek tıktır ve `report-projects-set` çağırır. Sayfa açılışta yalnız dosya bilgisini (`report-sources`) ve saklı raporları (`reports`) okur. Rapor yalnız “Seçilenleri raporla” tıklamasıyla, birer birer (`report-generate`) hazırlanır; arka planda ya da açılışta model çalışmaz. `report-generate` hataları servisin yazdığı gibi gösterilir. Her madde ayrı bir tıklamayla `report-decide` ile karara bağlanır; `supersedes` yalnız kişi “Evet, onu aşıyor” kutusunu işaretlediyse gönderilir.
- `/asilmis` (`superseded.html`, `superseded.js`, `i18n-superseded.js`, `reports.css`): `records-superseded` yanıtını iki sekmede (aşıldı / eklenmedi) yalnız okur.
- `/harita`: her girdide “son konuşulduğu tarih” ve kapalı başlayan “düşüncenin soyu” ayrıntısı; `lastDiscussedEntryId` girdisi küçük bir etiketle işaretlenir.

## 0.18 açılış: düşünce haritası tuvali

- Adresler: özel uygulamada `/` ve `/harita` artık tuvali (`canvas.html`, `canvas.js`, `canvas.css`, `i18n-canvas.js`) açar; üst menüdeki “Haritam” ve “töre” markası buraya gider. Eski liste haritası `/harita/liste` adresindedir (dışa aktarma önizlemesinin stil karması CSP'si bu yola taşındı). Konular `/konular`da kalır; ağ kipindeki `/` ve `/ag` yine `index.html` (Yayınlar) sayfasıdır. Haritam alt gezinmesi: Tuval · Liste · Düşünürler · Aşılmış düşünceler.
- Tuval yalnız `map` ve `thinkers` okur; hiçbir şey yazmaz, arka planda istek yapmaz. Reddedilen (`review:rejected`) ve aşılmış (`currency:superseded`) kayıtlar düğüm olmaz; aşılanlar yalnız düğümün panelinde kapalı başlayan “Düşünce mirası” ayrıntısında, en yakını önce ve derinliğe göre girintili durur.
- Ağaç: kök “Haritam”, altında kaydı olan katalog bölümleri, sonra `parentId` ile bağlı girdiler, `entry.order` sırasıyla. Üst girdisi görünmeyen girdi kendi bölümüne bağlanır. `placement:suggested` ve hipotez kayıtlar kesik çizgiyle, itirazlar mercan rengiyle, AI önerisi kayıtlar turkuaz zeminle çizilir. Öncülü olan düğümde küçük bir halka, `lastDiscussedEntryId` düğümünde “en son konuşulan” etiketi vardır.
- “Bütün haritama bak” bütün düğümleri sığdırır; “Son düşünceme bak” `lastDiscussedEntryId` düğümünü ortalar, vurgular ve panelini açar; yoksa düğme kapalıdır ve nedeni altında yazar. `#entry-<id>` adresi o düşünceyi açar.
- Panel: kişinin sözü ile AI'nın yeniden yazdığı (`user_interpretation`) ya da önerdiği (`assistant_proposal`) metin ayrı seslerle etiketlenir; gerekçe, birebir kaynak alıntısı (konuşma başlığı ve tarihiyle), kökten bu düşünceye yol, bundan çıkanlar, düşünürler, son konuşulduğu tarih ve liste, aşılmışlar, Konularım bağlantıları.
- Sürükleme, tekerlek/kıstırma ve +/− ile gezinme; Sekme düğümlerde dolaşır, Enter paneli açar, oklar üst/alt/kardeş düğüme gider, Esc paneli kapatır. `prefers-reduced-motion` açıkken kamera canlandırılmaz. Dar ekranda panel alt çekmecedir.

## Kişilik testi (`/kisilik`)

- Dosyalar: `personality.html`, `personality.js`, `personality-data.js`, `personality-scoring.js`, `personality.css`, `i18n-personality.js`; `server/src/assets.rs` içinde aynı kalıpla kayıtlıdır. Hiçbir menü bu sayfaya bağlanmaz; yalnız adresiyle açılır.
- İçerik: kamu malı IPIP-NEO-120 (Johnson, 2014; ipip.ori.org). 120 madde, 30 alt boyut, 5 boyut. İngilizce maddeler IPIP'in özgün metnidir; Türkçe maddeler töre'nin İngilizce özgün metinden yaptığı taslak çeviridir; her maddede `trSource: 'tore'` yazar.
- Puanlama `personality-scoring.js` içindeki saf işlevlerdir: yanıt 1–5, eksi anahtarlı madde ters, ölçek puanı maddelerin toplamı. Eksik yanıt tahmin edilmez; 120 maddenin hepsi yanıtlanmadan sonuç gösterilmez. Norm yoktur; sayfa hiçbir puanı yüksek ya da düşük diye adlandırmaz.
- Veri: sayfanın kendi betiği yalnız `ui-language-get` ve `ui-language-set` çağırır; deftere yazmaz, başka istek yapmaz. Ortak alt bilgi, her sayfadaki gibi, görünür olunca sürüm satırı için `status` sorar. Yanıtlar sekmede `sessionStorage` içinde tek anahtarla (`tore-personality-v1`) durur; saklı kopyadaki tanınmayan madde ve 1–5 dışındaki değer atılır. Sonuç yalnız kişinin tıklamasıyla Markdown ya da JSON dosyası olur. Yanıtları silmek yerinde ikinci bir onay ister.
- Arayüz: ifadeler onar onar gelir; her ifade bir `fieldset`, seçenekler beş radyo düğmesidir. Sayfa değişince odak başlığa gider. Yanıtsız ifadeler yalnız kişi sonucu istedikten sonra işaretlenir. EN | TR seçimi yanıtları, sayfayı ve açık alt boyut listelerini koruyarak yerinde yeniden çizer. Türkçe arayüzde taslak çeviri notu açılışta, sonuçta ve indirilen Markdown dosyasında yer alır.
- Kaynak, sınırlar ve çeviri inceleme tablosu: `docs/KISILIK-TESTI.md`.
