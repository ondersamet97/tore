# töre 0.12.0 — kaynak ve lisans bildirimi

Bu yerel, kaynak kodu incelenebilir çekirdek, Önder Samet'in Töre 0.6 Rust sunucusu, Markdown arşivi, kaynak/sürüm geçmişi ve paylaşım önizlemesi temel alınarak geliştirilmiştir. 0.11.0-rc.4 sürümünden itibaren bu depodaki özgün kod **PolyForm Noncommercial License 1.0.0** ile sunulur; tam metin LICENSE dosyasındadır ve değiştirilmemiştir. Lisansın izin vermediği kullanımlar, özellikle ticari kullanım, sahibin ayrı yazılı iznine bağlıdır. Bu lisans kodu açık kaynak yapmaz. Kaynak kod henüz kamuya yayımlanmamıştır. Konuşma içeriği ve kullanıcı verisi bu yazılım lisansına otomatik olarak girmez.

Required Notice: Copyright 2026 Önder Samet

0.11.0-rc.3 ve önceki sürümler **AGPL-3.0-only** kapsamında hazırlanmıştı. Lisans değişikliği o sürümler için daha önce verilmiş hakları geriye dönük kaldırmaz.

Beyin'in kullanıcı sözü/AI çıkarımı ayrımı, İzge'nin inceleme/onay yaklaşımı ve Rapor'un paket doğrulama yaklaşımı yeni konuşma katmanına kavramsal olarak uyarlanmıştır. 0.8 görüş kartları İzge'nin inceleme durumlarından ve Töre'nin önceki kaynak/sürüm ayrımından yararlanır. Bu projelerin üretim veritabanı veya servisleri kopyalanmamıştır. Felsefem Ne ayrı bir ürün referansıdır; kaynak kodu bu dağıtıma alınmamıştır.

Üçüncü taraf lisansları korunmuştur: `licenses/`, `vendor/` ve `local-reader/vendor/` içindeki atıflar; Rust bağımlılıkları `server/Cargo.lock`, `core/Cargo.lock`; tarayıcı/test bağımlılıkları `local-reader/package-lock.json`. Marked ve DOMPurify kendi lisansları altında kalır. Eski WASM çekirdek paketleri mevcut uyumluluk varlıklarıdır; 0.7 konuşma özellikleri Rust sunucusundadır.

Bu bir lisans uygunluk sertifikası ya da hukuki görüş değildir. Kamuya dağıtımdan önce dağıtım paketinin tam bağımlılık lisans envanteri tamamlanmalı ve ticari izin için başvuru yolu belirlenmelidir; bu sürüm kamuya yayın içermez.

0.10 kimlik doğrulamasında `jsonwebtoken` 9.3.1 (MIT) kullanılır; lisansı `licenses/rust/jsonwebtoken-9.3.1/` altındadır. OpenAI DevKit kodu veya abonelik/CLI oturum kayıtları bu uygulamaya alınmamıştır. Resmî SIWC protokolü bağımsız uygulanmıştır.
