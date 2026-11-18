# Töre 0.11 yerel konu sözleşmesi

Bütün işlemler mevcut token/Host/Origin korumalı `POST /api/private/tore/<işlem>` yolunda JSON alır. Ağ çağrısı ve yerel model çalıştırma yoktur. Veriler `records-v1.json`, kilit `records.lock`, geri alma görüntüleri `records-backups/<UUID>.json` içinde tutulur. Eski `opinions-v1.json` değişmez.

| İşlem | İstek | Yanıt |
|---|---|---|
| `records-list` | `{}` | `{schemaVersion,topics,records,packets,replies,backups,stateHash}` |
| `records-topic-create` | `{requestId?,title,goal?}` | `{topic}` |
| `records-topic` | `{topicId}` | `{topic,records,currentDecisions,openQuestions,changes,packets,replies}` |
| `records-create` | `{requestId?,topicId,kind,text,reason?,source?,answersQuestionId?}` | `{record}` |
| `records-review` | aşağıdaki örnek | `{record}` |
| `records-prepare` | aşağıdaki örnek | `{packet,findings}` |
| `records-share` | `{packetId,shared:true veya false,confirmedByUser:true}` | `{packet,shared,changed}`; bağlı AI aracına (MCP) yalnız bu paketin metnini açar veya kapatır. Aynı istek tekrarında yazmaz. Bayrak `false` iken saklanmaz; yedekten geri alma paylaşımı her zaman kapatır. Bkz. `docs/MCP.md`. |
| `records-reply` | `{requestId?,packetId,rawText,format:"text" veya "json",confirmedByUser:true}` | `{reply}`; geçersiz yanıt da kalıcıdır |
| `records-backup` | `{}` | `{backupId,stateHash,createdAt}` |
| `records-restore` | `{backupId,expectedStateHash,confirmedByUser:true}` | `{restored,restoredBackupId,backupId,stateHash}`; `backupId` geri almadan önceki durumun yeni yedeğidir |
| `records-migration-preview` | `{}` | `{previewHash,count,candidates,alreadyImported,notice}` |
| `records-migration-apply` | `{previewHash,confirmedByUser:true}` | `{imported,skipped,backupId,stateHash}` |

Yeni kayıtlar `pending` inceleme, `unknown` güncellik, `unspecified` öncelikle başlar. Görüş ve kararlar `unknown` benimseme durumunda; sorular `not_applicable` benimseme ve `open` soru durumundadır. Kaynak hiçbir zaman otomatik benimseme oluşturmaz.

`source` ya `{conversationId,messageId,excerpt}` ya `{replyId,excerpt}` olur. Alıntı görünür kaynak metninin birebir kesiti olmalıdır. Kaynak belirtilmediğinde yazılan metin yeni kullanıcı notudur. Kullanıcı mesajından farklı yazılan ifade `user_interpretation`, birebir aynı ifade `user_statement`; asistan kaynağı her zaman `assistant_proposal` olarak kalır. `answersQuestionId` aynı konudaki bir soruya bağlantı kurar; soruyu kapatmaz.

```json
{
  "id":"kayıt-kimliği", "expectedRevision":1,
  "text":"Kaynak veya düzeltilmiş ifade", "reason":"Kararın gerekçesi",
  "review":"reviewed", "adoption":"adopted", "currency":"current",
  "priority":"active", "questionState":"not_applicable",
  "changeReason":"Bu kararı inceleyip benimsedim.", "confirmedByUser":true
}
```

Durum sözlüğü:

- `kind`: `opinion`, `decision`, `question`.
- `review`: `pending`, `reviewed`, `rejected`.
- `adoption`: `unknown`, `adopted`, `hypothesis`, `uncertain`, `not_adopted`; yalnız soru için `not_applicable`.
- `currency`: `unknown`, `current`, `superseded`.
- `priority`: `unspecified`, `active`, `paused`, `not_priority`.
- `questionState`: soruda `open` / `closed`; diğer kayıtta `not_applicable`.

Her inceleme eski metin, gerekçe, bütün durumlar, kaynak atfı ve revizyon numarasını `history` içine ekler; `changedAt`, `changeReason`, `nextRevision` bağlantısı kaydedilir. Kaynak alıntısı ve konuşmacısı değişmez. Soru kapatmak açık kullanıcı onayı ve açıklamasıyla `questionState:"closed"` göndermeyi gerektirir.

Konu görünümündeki `changes` her değişiklik için `previous` ve ona doğrudan bağlı yeni revizyonun `currentRevision` / `currentText` değerlerini verir. Daha sonraki metin geçmiş değişikliğin yeni sonucuymuş gibi sunulmaz. `latestRecordRevision` kaydın bugün ulaştığı revizyondur.

```json
{
  "topicId":"konu-kimliği", "recordIds":["benimsenmiş-kayıt","açık-soru"],
  "proposalIds":[], "target":"chatgpt", "model":null,
  "question":"Buradan nasıl devam edelim?", "confirmedByUser":true
}
```

`target`: `chatgpt`, `claude`, `gemini`, `meta`, `deepseek`, `kimi`, `glm`, `qwen`, `mistral`, `nvidia`, `openrouter`, `other`. Model kullanıcı tarafından biliniyorsa isteğe bağlı metindir. Bilinmeyen model uydurulmaz. Ana bağlam yalnız açıkça seçilmiş `reviewed` + `current` benimsenmiş görüş/kararları ve açık soruları kapsar. Benimsenmemiş AI önerileri aynı durum koşuluyla yalnız `proposalIds` üzerinden, ayrı büyük etiketle eklenir. Öncelik bilgisi metinde korunur; duraklatılmış bir kayıt aktif çalışma diye sunulmaz. Tüm arşiv, başka konular, eski revizyonlar ve legacy içerikleri metne kendiliğinden eklenmez.

Paket `{id,topicId,target,model,text,createdAt,recordIds,proposalIds,sourceIds,sources,hash}` içerir. `sources` yalnız seçilen kaydın özgün kaynak alıntısını ve `{sourceId,recordId,revision,quote,role}` kanıtını tutar. `findings` yerel özel bilgi taramasının olası eşleşmeleridir, anonimlik garantisi değildir. Kopyalama ağ gönderimi yapmaz; kişi seçtiği hizmete elle gönderir.

Manuel JSON biçimi:

```json
{"commentary":"AI yorumu", "citations":[{"sourceId":"paketteki tam kaynak kimliği", "quote":"paketteki alıntının birebir kesiti"}]}
```

Bozuk JSON, yinelenen/bilinmeyen alanlar, bilinmeyen kaynak veya eşleşmeyen alıntı `validationStatus:"invalid"` olarak kaydedilir. `rawText` korunur ve `validationError` gösterilir. Bu kaynaktan aday çıkarılamaz. Düz metin `unverified`, şeması ve alıntıları doğrulanan JSON `valid` olur; `valid` yorumun doğru veya kişi tarafından benimsenmiş olduğu anlamına gelmez. Yorum ancak ayrı `records-create` çağrısında birebir kesit seçilerek yeni `pending` AI önerisi adayı oluşturur.

Yedekler yalnız kasanın kendi yerel dizininden UUID ile alınır. Geri alma güncel `stateHash`, açık onay, şema/boyut/checksum ve mevcut konuşma kasasına karşı özgün alıntı/rol doğrulaması gerektirir. Eksik kaynakta geri alma yazmadan durur. Geri almadan önce mevcut durum ayrıca yedeklenir. Yedekleri indirme/yükleme API'si yoktur.

`backups` listesi büyük yedeklerin tümünü okumadan yalnız dosya bilgilerini listeler: `valid:null,validationStatus:"not_checked"`. Bu, doğrulanmış geri alma sözü değildir; içerik geri alma sırasında doğrulanır. `valid:false` güvenli olmayan dosya türü/boyutunu belirtir. Liste `createdAt` bilgisi dosyanın değiştirilme zamanıdır; yedeğin içindeki özgün oluşturulma zamanı geri alırken ayrıca okunur.

Eski kart aktarımı önizleme karması değişmediyse bütün yeni adayları kopyalar; aynı eski kart kimliği ikinci kez eklenmez. `confirmed` inceleme ve benimseme olarak korunur. `uncertain`, `draft`, `rejected` anlamlarını kaybetmez. Güncellik ve öncelik çıkarılmaz. Özgün kart ve geçmişi `legacy` alanında korunur; eski dosyaya yazılmaz. Yeni incelemeler ayrı revizyon dizisinde başlar.

Kaynağı kullanıcı sözü olan eski bir AI yorumu `source.role:"user"` ve `attribution:"assistant_proposal"` olarak korunur; konuşmacı ile yorumun yazarı birbirine karıştırılmaz. Yeni aktarılacak kart yoksa dosyaya yazılmaz, yeni yedek üretilmez ve `backupId:null` döner.

Sınırlar: 200 konu, 3000 kayıt, kayıt başına 999 değişiklik, 1000 devam paketi, 2000 manuel yanıt, 100 yerel yedek, kasa/yedek başına 32 MiB. Sınırda veriler sessizce silinmez. `requestId` isteyen oluşturma işlemlerinde UUID aynı içerikle tekrar gönderildiğinde mevcut sonuç döner; farklı içerikte reddedilir.

## 0.11.0-rc.2 — mevcut konuşmaları yerel konu defterine toplu bağlama

İki ek işlem aynı yerel erişim korumasını kullanır:

| İşlem | İstek | Yanıt |
|---|---|---|
| `records-bulk-preview` | `{}` | `{previewHash,stateHash,sourceHash,ruleVersion,conversationCount,linkedCount,candidateCount,alreadyLinked,topics,warnings}` |
| `records-bulk-apply` | `{previewHash,confirmedByUser:true}` | `{linked,candidatesCreated,topicsCreated,backupId,stateHash,alreadyApplied}` |

`linkedCount` yeni bağlanacak konuşma sayısıdır. `conversationCount` bütün mevcut konuşmaları, `alreadyLinked` daha önce bağlananları sayar. Her `topics` satırı `{id,title,conversationCount,newLinkCount,candidateCount}` taşır. Önizleme diske yazmaz. Önizleme karması, kural sürümü, konu defterinin durumu ve bütün konuşmaların kaynak karmasına bağlıdır; arada değişiklik olursa uygulama reddedilir.

Toplu uygulama bir kez yedek alır ve bütün planı tek atomik kayıt olarak yazar. Kaynak konuşma veya eski görüş dosyası değişmez. İstek yanıtı kaybolursa aynı `previewHash` tekrar gönderildiğinde önceki işlem makbuzu döner; kaydın sonraki kullanıcı incelemesi sıfırlanmaz. Yeni bağlantı kalmadığında yeni yedek veya yazma yapılmaz. Eski görüşlerin aktarımı ayrı mevcut `records-migration-*` işlemlerini kullanır; eski onaylar korunur.

`records-list` ve `records-topic`, ek olarak `conversationLinks` döndürür. Bağlantının alanları: `{id,topicId,conversationId,title,provider,sourceCreatedAt,sourceUpdatedAt,lastUserSource,classificationReason,warning,candidateIds,linkedAt}`. `lastUserSource` varsa mevcut `Source` biçiminde ve özgün görünür kullanıcı mesajının en fazla 1500 karakterlik **birebir** kesitidir. Asıl mesajın kimliği ve zamanı korunur. `sourceCreatedAt` / `sourceUpdatedAt` kaynakta bulunmuyorsa `null` kalır; `linkedAt` bunların yerine geçmez. Kaynak tam konuşma olarak özgün kasada kalır.

Gruplama model çıkarımı değildir: önce başlıktaki proje/konu sözcükleri, başlık belirsiz veya yalnız araç adıysa görünür kullanıcı mesajlarının ilk üçü ve son sekizinden sınırlı kesitler kullanılır. Asistan metni sınıflandırmaya katılmaz. Birden çok belirgin proje veya belirsiz eşleme `Diğer konuşmalar` altında tutulur. Başlığa/metne göre sınıflandırma yanılabilir; gerekçesi her bağlantıda gösterilir. Töre gibi kısa adlarda kelime sınırı gözetilir; `store` veya `restore`, Töre sayılmaz.

Seçili kaynak dalı varsa yalnız o dal izlenir. Dal seçilmemiş tek yapraklı konuşmada tek yol kullanılabilir. Birden çok yaprak varsa son dal tahmin edilmez: bağlantı korunur, aday ve son kullanıcı alıntısı çıkarılmaz, `warning` alanı açıklama taşır. Ortam/AGENTS talimatları ve gizli düşünme evreleri kullanıcı ifadesi olarak alınmaz. Yapılandırılmış kullanıcı soru yanıtlarında yalnız özgün kaynağın birebir alt dizgesi olan cevap kullanılabilir; kaçış dizilerini çözerek yeni bir alıntı üretilmez.

Her konuşmadan en fazla bir görüş, bir karar, bir soru adayı çıkarılır. Büyük yapıştırılmış metinlerden otomatik kişisel beyan çıkarılmaz. Adaylar yalnız görünür kullanıcı sözünün birebir cümlesidir ve daima `review:pending`, `currency:unknown`, `priority:unspecified` durumunda başlar; görüş/kararda `adoption:unknown`, soruda `adoption:not_applicable` olur. Soru işareti görmek, o sorunun hâlâ açık olduğuna karar vermek değildir. Aday gerekçesi bu sınırı açıkça belirtir; kullanıcı incelemesi gerekir. Yeni konular veya bağlantılar onaylı güncel bir görüş oluşturmaz.

Depoya `conversationLinks` ve `bulkReceipts` eklenmiştir. Boş ek alanlar serileştirilmez ve okurken varsayılan boş değer alır; böylece rc.1 yedeklerinin kanonik karması korunur. Eski alanı içermeyen yedeğe dönme ve tekrar toplu aktarma sınanmıştır. Geri yükleme bağlantıdaki konuşma kimliği, başlık, sağlayıcı, kaynak zamanları, kullanıcı mesajı ve birebir alıntıyı mevcut konuşma kasasıyla doğrular. Bağlantının adayları aynı konu ve kaynak konuşmaya ait olmalıdır. Toplu işlemin sınırı 5000 konuşmadır; mevcut 200 konu / 3000 kayıt / 32 MiB kasa sınırları aşılırsa kısmi aktarım yapılmaz.


Yerel gruplama kural sürümü `local-topics-v2` oldu. Sağlık/yaşam, öğrenme/okuma, tarih/kültür ve günlük planlama gibi geniş başlıkların ek sözcükleri yalnız açık konuşma başlıklarında kullanılır; kullanıcı mesajındaki geçici bir değinme bu geniş gruplara atama yapmaz. Tek başına “strateji”, “tarih” veya “history” gibi belirsiz sözcükler eklenmemiştir; örneğin başvuru tarihi tarih/kültür sayılmaz. Birden çok belirgin konuya eşleşen başlık kullanıcı metniyle zorla tek konuya indirilmez. Sözlük değişikliği kural sürümünü ve dolayısıyla önizleme karmasını değiştirdiği için önceki sözlükle hazırlanmış önizleme yeni planı onaylayamaz.

## 0.11.0-rc.3 — Diğer konuşmaları tema ve altbaşlıklarla düzenleme

| İşlem | İstek | Yanıt |
|---|---|---|
| `records-organize-preview` | `{}` | `{previewHash,stateHash,sourceHash,ruleVersion,conversationCount,moveCount,subtopicCount,recordMoveCount,retainedDependencyCount,topics,changes,warnings}` |
| `records-organize-apply` | `{previewHash,confirmedByUser:true}` | `{moved,subtopicsUpdated,recordsMoved,topicsCreated,retainedDependencyCount,backupId,stateHash,alreadyApplied}` |

Kapsam, `topicId:bulk-topic-other` ve henüz `subtopicTitle` alanı bulunmayan bağlantılardır. `conversationCount` yalnız bu kapsamı sayar. `topics` her hedef konu için `{id,title,conversationCount}` içerir. `changes` satırları `{conversationId,fromTopicId,toTopicId,subtopicTitle,reason,recordIds,retainedReason}` biçimindedir. `recordIds`, aynı kaynak konuşmaya bağlı ve aynı eski konuda bulunan bütün kayıtları içerir; yalnız ilk toplu aktarımın adaylarıyla sınırlı değildir. Önizleme yazma yapmaz.

`local-organization-v2` yerel gezinme kuralları başlığı güçlü, seçili daldaki görünür kullanıcı sözlerinin ilk dört ve son sekizinden sınırlı kesitleri düşük ağırlıkla kullanır. Asistan sözleri veya gizli düşünme kullanılmaz. Türkçe/İngilizce sözcüklerle tanımlı 15 genel sabit tema vardır: AI araçları ve geliştirme (`ai_tools`), ürünler (`products`), görüşler ve toplum (`ideology`), bilim (`science`), tasarım ve yaratıcı üretim (`creative`), oyunlar (`games`), sağlık (`health`), kişisel deneyimler (`personal`), iletişim (`communication`), öğrenme ve okuma (`learning`), tarih ve kültür (`history`), seyahat (`travel`), günlük planlama (`planning`), notlar ve arşiv (`archives`), günlük yaşam (`everyday`). `tarih` gibi tek başına belirsiz sözcükler tarih teması oluşturmaz. Tek kullanıcı sözcük işaretiyle yapılan atama gerekçede **zayıf öneri** olarak belirtilir; kişinin görüşü veya ilgisinin kesin tespiti değildir.

Sohbet başlığı/başlık önerisi gibi genel başlıklar içerik konusu sayılmaz. İçeriği hiç gelmemiş kaynaklar `İçeriği eksik kaynaklar`, seçili görünür bağlamı bulunmayan ve başlığı yeterli olmayanlar `Bağlamı sınırlı kaynaklar` durum grubunda görünür. Yakın güçte farklı temalar `Birden çok alan` altında açık gerekçeyle kalır. Başlığı ve görünür kullanıcı sözleri sabit temalara uymayan kaynaklarda, en az iki farklı kaynakta geçen ayırt edici sözcük/ikili öbek için en fazla16 yerel küme önerilir. Talimat ve genel sohbet sözcükleri filtrelenir; kümeler anlam veya görüş eşitliği iddia etmez. Gruplanamayanlar kaynak başlıklarıyla ayrı altbaşlık olarak izlenebilir.

Her hedef bağlantı `subtopicTitle` alır: açıklayıcı özgün başlık, başlık genelse görünür kullanıcı sözünün en fazla240 karakterlik birebir kesiti; yeterli kaynak yoksa özgün kısa başlık veya açık eksiklik etiketi. Özgün `title`, kaynak zamanları, son kullanıcı sözü ve uyarılar korunur. **Küme başlıkları ile önizleme `changes` alanı özel kaynak sözcüklerini içerebilir.** Kamuya açık test raporlarına veya işlem günlüklerine yazılmaz; genel tanı çıktısında yalnız sabit konu kimlikleri, sayılar ve küme adedi kullanılmalıdır.

Taşınan kayıtlarda yalnız `topicId` değişir. Metin, gerekçe, kaynak, atıf, onay/benimseme/güncellik/öncelik/soru durumu, eski kart bilgisi, tarihler, `revision` ve `history` aynen kalır. Bir kayıt önceki devam paketinde kullanılıyorsa, mevcut yanıta bağlıysa veya başka kayıt grubuyla soru–yanıt ilişkisi taşıyorsa grup eski üst konuda kalır; altbaşlık yine eklenir ve `retainedReason` nedenini gösterir. Eski konu, paket veya yanıt silinmez/değiştirilmez. `retainedDependencyCount` bu şekilde korunan bağlantıları sayar.

Yer değişiminin denetim kaydı ayrı `organizationReceipts` alanındadır; `records-list` bunu okunabilir dizi olarak döndürür. Her makbuz `previewHash,ruleVersion,createdAt,sourceHash,backupId,moved,subtopicsUpdated,recordsMoved,topicsCreated,retainedDependencyCount,changes` taşır. `changes` eski/yeni konu ve kayıt kimliklerini saklar; içerik inceleme geçmişiyle karıştırılmaz. Yeni alanlar `default` ve boşken serileştirmeme kuralını kullanır; rc.1/rc.2 yedek karmaları korunur.

Uygulama önizlemeyi bütün kaynak karması ve mevcut konu defteri karmasına bağlar; değişiklikte yeniden önizleme gerekir. Bütün plan için **tek yedek ve tek atomik kayıt** kullanılır. Aynı onay isteğinin tekrarı önceki makbuzu döndürür ve daha sonraki kullanıcı incelemesini geri almaz. Yeni hedef kalmamışsa yeni yedek veya yazma yapılmaz. 200 konu/3000 kayıt/32 MiB sınırları korunur; kısmi ilk-N aktarımı yapılmaz.

`records-review`, geriye uyumlu isteğe bağlı `expectedTopicId` alanını kabul eder. Ekranın açıldığı konu ile kaydın güncel konusu farklıysa inceleme reddedilir: `Kaydın konusu değişmiş; incelemeden önce yeniden yükleyin`. Böylece konu düzenleme içerik revizyonunu değiştirmese de yeni arayüz eski konu bağlamıyla inceleme yapmaz. Önceki istemcilerin yalnız `expectedRevision` göndermesi desteklenir.

## İşler, bağlı araç izinleri ve gelen kutusu (0.14.0)

`kind` artık dört değer alır: `opinion`, `decision`, `question`, `task`. İş (`task`) soru gibi durumludur: `adoption` her zaman `not_applicable`, `questionState` `open` ya da `closed`. İşi yalnız kişi, açık onay ve gerekçeyle kapatır. `records-topic` yanıtına `openTasks` ve `toolAccess` eklenmiştir. İşler haritaya konmaz.

| İşlem | İstek | Yanıt |
|---|---|---|
| `records-tool-access` | `{topicId,read,write,confirmedByUser:true}` | `{topicId,read,write}` |
| `records-tool-access-all` | `{read,write,confirmedByUser:true}` | `{topics,read,write,toolAccess}`; şu an var olan bütün konuları tek kayıtta açar ya da (`read:false`) bütün izinleri kaldırır. Sonradan açılan konular kapalı başlar. |
| `inbox` | `{}` | `{items:[{item,topicTitle,related}],toolAccess}` |
| `inbox-accept` | `{itemId,confirmedByUser:true}` | `{record,mapEntryId}` |
| `inbox-dismiss` | `{itemId,confirmedByUser:true}` | `{dismissed}` |
| `claude-code-sessions` | `{}` | `{sessions:[{id,project,modifiedAt,bytes,sourceConversationId,imported}]}` |
| `claude-code-preview` | `{sessionIds:[…]}` (1–50) | `{previewId,conversations}`; ardından `import-commit` |

`write` izni `read` olmadan verilemez; `read:false` izni kaldırır. İzinler konu deposunda `toolAccess`, işlenen öneriler `inboxHandled` alanındadır; boşken serileştirilmez. Araç önerileri deftere değil `tool-inbox.jsonl` dosyasına eklenir; bozuk ya da tanınmayan satırlar yok sayılır. Kabul edilen öneri `attribution:"assistant_proposal"`, `review:"pending"` ve `source:{kind:"tool",id:"tool:<öneri kimliği>",provider:"mcp",role:"assistant",title:<aracın adı>}` taşıyan yeni bir kayıt olur. `objection` türü yalnız aynı konudaki bir görüş ya da karara bağlanır; o kayıt haritadaysa itiraz altına `placement:"suggested"` olarak yerleşir. Geri yükleme bütün `toolAccess` izinlerini kapatır. Sınırlar: öneri başına 8000 bayt, 200 bekleyen öneri, 2 MiB dosya.

## Düşünce haritası — kayıtların okur için yerleşimi (0.13.0)

| İşlem | İstek | Yanıt |
|---|---|---|
| `map` | `{}` | `{catalog,entries:[{entry,record,thinkerIds}],stateHash}` |
| `map-add` | `{requestId?,recordId,section,role,parentId?,counterpart?,label?,note?,order?,placement?,translationEn?,confirmedByUser:true}` | `{entry}` |
| `map-update` | `{entryId,section,role,parentId?,counterpart?,label?,note?,order?,translationEn?,confirmedByUser:true}` | `{entry}` |
| `map-remove` | `{entryId,confirmedByUser:true}` | `{removed}` |
| `map-export` | `{language:"tr" veya "en",includePending?,includeSuggested?,title?,confirmedByUser:true}` | `{html,entryCount,hash,findings}` |

Katalog sürümlü ve editoryaldir: dokuz bölüm (`baslangic`, `insan`, `toplum`, `bilgi`, `tarih`, `teknoloji`, `inanc`, `ekonomi`, `sanat`) ve sekiz rol (`premise`, `position`, `divergence`, `change`, `objection`, `answer`, `test`, `open_question`). Bir girdi yalnız var olan bir kaydı yerleştirir; kaydın metni, kaynağı, atfı, inceleme ve benimseme durumu haritadan değişmez. Bir kayıt haritada en fazla bir yerde durur. Haritaya koymak benimseme değildir.

Bağ kuralları: `objection` bir üst girdi ister; `objection`, `test`, `divergence`, `change` ve `open_question` yalnız `premise`, `position`, `divergence` ya da `change` altına; `answer` bunlara ya da bir `objection` altına bağlanır. `open_question` rolü yalnız soru kaydıyla, diğer roller yalnız görüş ya da karar kaydıyla kullanılır. Kendine bağlanma ve döngü reddedilir. Altında girdi bulunan girdi çıkarılamaz. Çıkarmak kaydı silmez.

`placement` ya `user` ya `suggested` olur. `suggested`, yerin bir asistan tarafından önerildiğini ve kişinin henüz onaylamadığını belirtir; `map-update` her zaman `user` yazar. `translationEn` `{text,by,label?}` biçimindedir (`label` kısa başlığın çevirisidir); `by` ya `ai` ya `user` olur ve arayüz ile dışa aktarım AI çevirisini her zaman öyle etiketler.

`map-export` yazma yapmaz ve ağ kullanmaz; betik içermeyen tek bir HTML metni döndürür, dosyayı tarayıcı bu bilgisayara kaydeder. Varsayılan kapsam: `reviewed`, `rejected` olmayan, `superseded` olmayan kayıtlar; `not_adopted` kayıtlar yalnız `objection` ve `change` rolünde girer. `includePending` ve `includeSuggested` açıkça istenirse bekleyen ve yeri önerilmiş girdiler de girer ve öyle işaretlenir. Konuşma ve konu başlıkları, kimlikler ve kaynak dosya adları dışa aktarılmaz; tarih gün düzeyindedir. `findings` yerel özel bilgi taramasının olası eşleşmeleridir, anonimlik garantisi değildir.

Girdiler konu deposunda `mapEntries` alanında tutulur; kilit, atomik yazma, yedek ve geri alma doğrulamasını paylaşır. Boş alan serileştirilmez; önceki depo ve yedek karmaları değişmez. Sınır 3000 girdidir.

## Düşünürler — kayıt ile düşünür bağlantıları

| İşlem | İstek | Yanıt |
|---|---|---|
| `thinkers` | `{}` | `{catalog,links:[{link,record}],stateHash}` |
| `thinkers-link` | `{requestId?,thinkerId,recordId,note?,confirmedByUser:true}` | `{link}` |
| `thinkers-unlink` | `{linkId,confirmedByUser:true}` | `{removed}` |

Katalog sürümlü ve editoryaldir; sekiz düşünür için yalnız kamuya açık genel bilgi (eserler, ana fikirler, eleştiriler, sınırlar) taşır. Bağlantıyı yalnız kişi kurar; onaysız istek reddedilir. Aynı kayıt aynı düşünüre ikinci kez bağlanamaz. `requestId` aynı içerikle tekrarlanırsa mevcut bağlantı döner, farklı içerikte reddedilir. Not en fazla 2000 bayttır. Bağlantı kaldırmak kaydı silmez.

Bağlantılar konu deposunda `thinkerLinks` alanında tutulur ve deponun kilit, atomik yazma, yedek ve geri alma doğrulamasını paylaşır. Boş alan serileştirilmez; önceki depo ve yedek karmaları değişmez. Doğrulama, bilinmeyen düşünürü, eksik kaydı ve yinelenen çifti reddeder. Sınır 3000 bağlantıdır. Yakınlık puanı, sıralama veya siyasi kimlik çıkarımı yoktur; bir bağlantı düşünürün bütün görüşlerinin benimsendiği anlamına gelmez.

## Çöp kutusu

| İşlem | İstek | Yanıt |
|---|---|---|
| `records-trash` | `{id,expectedRevision?,confirmedByUser:true}` | `{record,changed}`; kayda `trashedAt` konur. |
| `records-untrash` | `{id,confirmedByUser:true}` | `{record,changed}`; `trashedAt` kalkar. |
| `records-purge` | `{id,confirmedByUser:true}` | `{purged,backupId}`; yalnız çöp kutusundaki kayıt, önce otomatik yedekle. |

Çöpteki kayıt `records-list` yanıtında `records` yerine `trash` dizisinde döner. `records-topic`, harita, düşünür bağları, gelen kutusu ve bağlı AI aracı (MCP) onu görmez. Çöpteki kayıt incelenemez, devam metnine, haritaya ya da düşünüre eklenemez ve yanıtlanamaz. `trashedAt` yalnız doluyken serileştirilir; eski depolar bayt bayt aynı kalır. Kalıcı silme şu kayıtlarda reddedilir: bir devam metninde kullanılmış, bir konu düzenleme makbuzunda geçen, eski görüş defterinden aktarılmış, kendisine bağlı yanıtı olan soru ya da haritada altında başka girdi bulunan kayıt. Kalıcı silmede kaydın harita girdisi ve düşünür bağları kaldırılır; konuşma bağlantılarındaki aday listesinden çıkarılır; gelen kutusu kayıtlarındaki bağlantısı boşaltılır.

## Sürümler arası uyum: bağlı araç okuyucusu

Masaüstü uygulaması (`Disk::open`) katıdır: tanımadığı alan ya da durum içeren depoyu açmaz ve üzerine yazmaz. Böylece eski bir töre, yeni bir alanı (örneğin `trashedAt`) atıp deftere geri yazamaz.

Bağlı AI aracının (MCP) okuyucusu ise ileriye uyumludur. Uzun süre açık kalan eski bir bağlayıcı, yeni bir töre'nin yazdığı defteri okurken:

- konuları, kayıtları, devam paketlerini, araç izinlerini ve gelen kutusu kararlarını tek tek okur; okuyamadığı ya da doğrulayamadığı öğeyi atlar. Atlanan kayıt gizlenir, atlanan izin kapalı sayılır, okunamayan kayda dayanan paket ve okunamayan soruya bağlı yanıt da gizlenir;
- kullanmadığı bölümleri (harita, düşünür bağları, konuşma bağlantıları, makbuzlar, yanıtlar) hiç okumaz; tanımadığı üst düzey alanları yok sayar;
- `schemaVersion` 1'den büyükse defterin tamamını okumaz;
- atlama ve okuma hatalarının nedenini stderr'e yalnız hata türü, alan adı ve kimlik olarak yazar; kayıt içeriği yazılmaz. Araç cevabı kişiye bağlayıcıyı yeniden bağlamasını söyler (`/mcp` → tore → Reconnect). Konu metninde gizlenen kayıt sayısı ayrıca belirtilir.

Kural: bağlı araca neyin görüneceğini kısıtlayan yeni bir bilgi ya kaydın (ya da izin, paket öğesinin) içinde tutulur, böylece eski okuyucu o öğeyi atlar; ya da `schemaVersion` artırılır. Böyle bir bilgi yeni bir üst düzey alan olarak eklenmez, çünkü eski okuyucu onu yok sayar. Bilinen bir alana yeni bir değer eklemek (yeni `kind` gibi) eski okuyucuda yalnız o kaydı gizler.

## Raporlar ve aşılmış düşünceler (0.17.0)

| İşlem | İstek | Yanıt |
|---|---|---|
| `report-sources` | `{}` | `{projects:[{project,label,enabled,sessionCount,waitingCount,modifiedAt,sessions:[{id,project,modifiedAt,bytes,sourceConversationId,status,reportId}]}]}`; `status`: `new`, `updated`, `reported`. Oturum metni okunmaz, yalnız dosya bilgisi. |
| `report-projects-set` | `{project,enabled,confirmedByUser:true}` | `{project,enabled}` |
| `report-generate` | `{sessionId,confirmedByUser:true}` | `{report}` |
| `reports` | `{}` | `{reports,waitingCount,activeThoughts:[{id,kind,text}]}` |
| `report-decide` | `{reportId,itemId,decision,section?,supersedes?,supersededBy?,reason?,confirmedByUser:true}` | `{item,record,changed}`; `decision`: `added`, `hypothesis`, `declined`, `later`. |
| `records-supersede` | `{olderId,newerId,reason?,confirmedByUser:true}` | `{record}` |
| `records-superseded` | `{}` | `{surpassed:[{record,by}],declined:[{record,by}]}` |

**Projeler kapalı başlar.** Her Claude Code proje klasörü raporlara kapalıdır; kişi `report-projects-set` ile tek tek açar. Seçim konu deposunda `reportProjects` alanında yalnız açık projeler olarak durur.

**Rapor üretimi.** `report-generate` tek bir oturumu okur. Oturum kapalı bir projedeyse istek reddedilir. Oturum sıradan bir içe aktarım gibi konuşma kasasına alınır: aynı kopya varsa o kullanılır; yalnız büyümüş bir oturum (eski mesajların hepsi aynen duruyorsa) eski kopyanın yerine geçer; başka türlü değişmiş bir kopyanın üzerine yazılmaz. Model hiçbir kilit tutulmadan çalışır. Bugünkü sağlayıcı kişinin kendi Claude Code'udur: önce `claude auth status` ile giriş denetlenir (girişsizse saniyeler içinde `claude auth login` önerilir), sonra `claude -p --tools "" --no-session-persistence --setting-sources "" --output-format json` istemle çalışır; araç kullanamaz, oturum kaydetmez, 10 dakikada biter ya da durdurulur. İstem ve yanıt biçimi sağlayıcıdan bağımsızdır; `TORE_REPORT_COMMAND` yalnız testlerde programı değiştirir.

**Doğrulama.** Her öneri kişinin tek bir görünür turundan **birebir** alıntı taşımalıdır; asistan sözü, bulunamayan alıntı, tanınmayan tür, kırık aşma bağı ya da hassas bilgi (parola, anahtar, belirteç, cüzdan adresi kalıpları) içeren öneri atılır ve `dropped` sayısına eklenir. Rapor en fazla 12 madde taşır. Bölüm tanınmazsa `baslangic` olur. İstem modelden ayrıca belirsiz sözleri karar saymamasını, yazılım projelerinin işletim işlerini, sağlık ve kişisel para ayrıntılarını ve başkalarının özel bilgilerini almamasını ister; bu bir istektir, sunucu yalnız yukarıdaki kalıpları denetler.

**Karar.** Rapor hiçbir kaydı kendiliğinden oluşturmaz. Kişi her maddeye ayrı karar verir; bir maddenin kararı değişmez.

- `added`: madde kişinin sözüne dayanan, `review:reviewed`, `adoption:adopted`, `currency:current` bir kayıt olur (soru ve işte `adoption:not_applicable`, açık). Konu verilmezse `topic-reports` (“Raporlar · Reports”) kullanılır ve gerekirse oluşturulur. Haritaya `placement:user` ile konur (görüş ve karar `position`, soru `open_question`; işler haritaya konmaz).
- `hypothesis`: aynı, `adoption:hypothesis`.
- `declined`: `review:rejected`, `adoption:not_adopted` bir kayıt olur; haritaya konmaz, “Aşılmış düşünceler”de **eklenmedi** olarak durur. `supersededBy` ile kişi onu hangi etkin düşüncesinin aştığını seçebilir.
- `later`: hiçbir şey değişmez.
- `itiraz` (objection) türü kayıtta `opinion` olur.

**Aşılma.** `supersedes` (eklenen maddede) ya da `records-supersede` yalnız kişi söyleyince eski kaydı aşılmış yapar: kaydın geçmişine bir revizyon eklenir, `currency:superseded`, `supersededBy`, `supersededAt` ve isteğe bağlı `supersessionReason` yazılır. Aşan kayıt etkin (incelenmiş, güncel, benimsenmiş ya da hipotez) bir görüş ya da karar olmalıdır. Eski kaydın haritadaki yeri yeni kayda geçer; alt girdiler yerinde kalır. Yeni kayıt haritada zaten başka yerdeyse ve eski kaydın alt girdileri varsa işlem reddedilir. Bir kayıt `currency`'si `superseded` dışına çıkarılarak incelenirse aşılma bilgisi silinir. Aşılan ya da aşan kayıt ve rapordan gelen kayıt kalıcı silinemez; çöp kutusunda gizli kalabilir.

**Harita.** `map` yanıtı her girdiye `lastDiscussedAt` (kaydın alıntısının ya da kaynaksız, elle yazılmış kayıtta yazılış zamanının, ve onu oluşturan ya da aşmayı öneren rapor maddelerinin en yeni zamanı) ve `predecessors` (bu düşünceye gelirken aşılanlar, en yakını önce, `depth` ile) ekler; üst düzeyde `lastDiscussedEntryId` en son tartışılan girdidir (“Son düşünceme bak”).

**Uyum.** Yeni alanlar (`supersededBy`, `supersededAt`, `supersessionReason`, `reports`, `reportProjects`) boşken serileştirilmez; önceki depo ve yedek karmaları değişmez. Aşılmış kayıtlar `currency:superseded` taşıdığı için bağlı AI aracına zaten görünmez; eski bir bağlayıcı tanımadığı alanlı kaydı atlar.
