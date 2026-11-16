# Sentetik parser örnekleri

Hem dosya seçicisinde kullanılabilir örnekler hem `server/src/workspace/importers.rs` içindeki `#[cfg(test)]` kontrolleri vardır. Gerçek konuşma, özel dosya adı, hesap bilgisi, API anahtarı veya gerçek kişi metni bu fixture’lara kopyalanmadı. `synthetic-model-alpha` gibi model adları yapay test etiketleridir. `demo@example.invalid` gerçek kişiye ait olmayan test adresidir.

| Dosya | Kaynak seçimi | Beklenen önizleme |
| --- | --- | --- |
| [chatgpt-branched.json](chatgpt-branched.json) | ChatGPT | 1 konuşma, 3 görünür mesaj, 2 dal; seçili dal korunur |
| [claude.json](claude.json) | Claude | 1 konuşma, 3 görünür mesaj, 2 dal; kullanıcı dal seçer |
| [codex.jsonl](codex.jsonl) | Codex | 1 konuşma, 3 görünür mesaj; aynı gerçek metnin iki ayrı kaydı korunur |
| [codex.jsonl.zst](codex.jsonl.zst) | Codex | JSONL ile aynı içerik/kimlik; sıkıştırılmış giriş |
| [tore.json](tore.json) | Genel/Töre JSON | 1 konuşma, 2 mesaj; eski yazarlık etiketleri yeniden inceleme bekler |

Dosyaları ayrı ayrı içe aktararak kontrol edebilirsiniz. `codex.jsonl.zst`, buradaki yapay `codex.jsonl` dosyasının Zstandard sıkıştırılmış kopyasıdır. `MUST_NOT_APPEAR` işaretli yapay gizli/araç/otomasyon metinleri önizlemede görünmemelidir. Hiçbir dosyada gerçek ek dosya baytı bulunmaz.

14 kontrolün kapsamı:

1. ChatGPT seçili dal, iki yanıt dalı ve düşünme düğümünün atlanması.
2. İki JSON parçası taşıyan ZIP; ilgisiz JSON’un okunmaması; doğrudan JSON ile aynı kimlik.
3. ZIP yol/giriş/açılmış boyut/üye sayısı sınırları ve bounded reader.
4. Claude birleşik `.text` alanının kullanılmaması; thinking/tool/extracted_content dışlama; dallar.
5. Codex event/response çift kaydı; ayrı kimliklerle tekrarlanan gerçek metnin korunması; otomasyon ve araç dışlama.
6. Codex response fallback’inde harness/ortam parçalarının ayıklanması.
7. Kesilmiş son JSONL kaydı uyarısı; bozuk orta satır reddi; bounded zstd.
8. Genel JSON’da hak/yazarlık onayının taşınmaması; düz metinde rol çıkarılmaması.
9. Döngü reddi ve eksik atanın yanlış dala bağlanmaması.
10. Gizli/analiz kanalı dışlama ve görünür çocukların yeniden bağlanması.
11. Yalnız ek içeren/boş mesaj ve hatalı tarih; Claude content yoksa `.text`e düşülmemesi.
12. Aynı Codex mesaj kimliği için çelişkili aşamanın reddi.
13. Gerçek kaynak metaverisi varsa model kimliği; yoksa None ve JSON’da atlanan alan.
14. Yukarıdaki beş fiziksel fixture’ın ayrıştırılması, beklenen mesaj adetleri ve JSONL/zstd kimlik eşitliği.

Çalıştırma:

```sh
cargo test --manifest-path server/Cargo.toml workspace::importers::tests
```

14 Kasım 2026’da yukarıdaki `cargo test` komutu **14/14** geçti; sunucunun test hedefi derlendi, diğer 36 test bu odaklı çalıştırmada filtrelendi. Bu sonuç bütün sunucunun tüm testlerinin veya tarayıcı akışlarının geçtiği anlamına gelmez. Güncel kapsam [kanıt notunda](../docs/funding/evidence-status.md).

Özel dışa aktarımlarla ek kontrol yalnız bellekte, sayısal sonuç üreterek yapıldı. Özel örnekler test deposuna alınmadı ve bu klasörde tutulmuyor.
