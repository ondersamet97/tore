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
