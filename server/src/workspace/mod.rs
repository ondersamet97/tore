//! Isolated conversation workspace; synthesis reads only the explicitly supplied report archive.
mod chatgpt;
mod ideology;
mod importers;
mod opinions;
mod policy;
mod records;
mod store;
pub mod transport;
pub mod types;
use axum::{
    Json, Router,
    extract::{DefaultBodyLimit, Path, State},
    http::{HeaderMap, StatusCode},
    response::{IntoResponse, Response},
    routing::post,
};
use base64::Engine;
pub use records::{SharedContext, shared_contexts};
use serde_json::{Value, json};
use sha2::{Digest, Sha256};
use std::{
    collections::{BTreeMap, BTreeSet},
    path::PathBuf,
    sync::{Arc, Mutex},
};
use types::*;
struct Workspace {
    token: [u8; 32],
    origin: String,
    host: String,
    disk: Mutex<store::Disk>,
    opinions: Mutex<opinions::Disk>,
    records: Mutex<records::Disk>,
    ideology: Arc<ideology::Service>,
    chatgpt: Arc<chatgpt::Service>,
    previews: Mutex<BTreeMap<String, Vec<Conversation>>>,
    key: Mutex<String>,
    catalog: Mutex<Value>,
    gate: Arc<tokio::sync::Semaphore>,
}
impl Workspace {
    fn allowed(&self, h: &HeaderMap) -> bool {
        let bearer = h
            .get("authorization")
            .and_then(|v| v.to_str().ok())
            .and_then(|s| s.strip_prefix("Bearer "))
            .unwrap_or("");
        let hash: [u8; 32] = Sha256::digest(bearer.as_bytes()).into();
        hash.iter()
            .zip(self.token)
            .fold(0u8, |a, (x, y)| a | (x ^ y))
            == 0
            && h.get("host").and_then(|v| v.to_str().ok()) == Some(self.host.as_str())
            && h.get("origin").and_then(|v| v.to_str().ok()) == Some(self.origin.as_str())
            && h.get("sec-fetch-site")
                .and_then(|v| v.to_str().ok())
                .is_none_or(|s| s == "same-origin" || s == "none")
    }
}
#[cfg(test)]
pub fn router(root: PathBuf, token: String, origin: String) -> Result<Router, String> {
    let archive = root.join("empty-report-archive");
    router_with_archive(root, token, origin, archive)
}
pub fn router_with_archive(
    root: PathBuf,
    token: String,
    origin: String,
    archive: PathBuf,
) -> Result<Router, String> {
    let ideology = ideology::Service::open(root.clone(), archive)?;
    let chatgpt = chatgpt::Service::open(root.clone())?;
    let s = Arc::new(Workspace {
        token: Sha256::digest(token.as_bytes()).into(),
        host: origin
            .trim_start_matches("http://")
            .trim_start_matches("https://")
            .into(),
        origin,
        disk: Mutex::new(store::Disk::open(root.clone())?),
        opinions: Mutex::new(opinions::Disk::open(root.clone())?),
        records: Mutex::new(records::Disk::open(root)?),
        ideology,
        chatgpt,
        previews: Mutex::new(BTreeMap::new()),
        key: Mutex::new(String::new()),
        catalog: Mutex::new(transport::initial_catalog()),
        gate: Arc::new(tokio::sync::Semaphore::new(1)),
    });
    Ok(Router::new()
        .route("/api/private/tore/{op}", post(handle))
        .layer(DefaultBodyLimit::max(180 * 1024 * 1024))
        .with_state(s))
}
fn field<'a>(r: &'a Value, k: &str) -> Result<&'a str, String> {
    r[k].as_str().ok_or_else(|| format!("Eksik alan: {k}"))
}
fn lock<T>(m: &Mutex<T>) -> Result<std::sync::MutexGuard<'_, T>, String> {
    m.lock()
        .map_err(|_| "Yerel durum kilidi kullanılamıyor; yeniden başlatın".into())
}
fn same_import_except_location(old: &Conversation, incoming: &Conversation) -> bool {
    fn content(conversation: &Conversation) -> Result<Value, serde_json::Error> {
        let mut value = serde_json::to_value(conversation)?;
        if let Some(messages) = value.get_mut("messages").and_then(Value::as_array_mut) {
            for message in messages {
                if let Some(fields) = message.as_object_mut() {
                    // The same export can have a different file name or array
                    // position. Keep every content/provenance field otherwise.
                    fields.remove("sourceLocator");
                }
            }
        }
        Ok(value)
    }
    matches!((content(old), content(incoming)), (Ok(a), Ok(b)) if a == b)
}
async fn handle(
    State(s): State<Arc<Workspace>>,
    Path(op): Path<String>,
    h: HeaderMap,
    Json(r): Json<Value>,
) -> Response {
    if !s.allowed(&h) {
        return (
            StatusCode::FORBIDDEN,
            Json(json!({"error":"Yerel erişim anahtarı, Host veya Origin geçersiz"})),
        )
            .into_response();
    }
    match dispatch(s, &op, r).await {
        Ok(v) => {
            let mut response = Json(v).into_response();
            response
                .headers_mut()
                .insert("cache-control", "no-store".parse().unwrap());
            response
        }
        Err(e) => (StatusCode::BAD_REQUEST, Json(json!({"error":e}))).into_response(),
    }
}
async fn dispatch(s: Arc<Workspace>, op: &str, r: Value) -> Result<Value, String> {
    match op {
        "records-list" => lock(&s.records)?.list(),
        "records-topic-create" => lock(&s.records)?.topic_create(r),
        "records-topic" => lock(&s.records)?.topic_view(r),
        "records-create" => {
            let disk = lock(&s.disk)?;
            lock(&s.records)?.record_create(r, &disk.data.conversations)
        }
        "records-review" => lock(&s.records)?.review(r),
        "records-prepare" => lock(&s.records)?.prepare(r),
        "records-share" => lock(&s.records)?.share(r),
        "records-reply" => lock(&s.records)?.reply_save(r),
        "records-backup" => lock(&s.records)?.backup(),
        "records-restore" => {
            let disk = lock(&s.disk)?;
            lock(&s.records)?.restore(r, &disk.data.conversations)
        }
        "records-migration-preview" => {
            let legacy = lock(&s.opinions)?.list()?;
            lock(&s.records)?.legacy_preview(legacy)
        }
        "records-migration-apply" => {
            let legacy = lock(&s.opinions)?.list()?;
            lock(&s.records)?.legacy_apply(legacy, r)
        }
        "records-bulk-preview" => {
            let disk = lock(&s.disk)?;
            lock(&s.records)?.bulk_preview(&disk.data.conversations)
        }
        "records-bulk-apply" => {
            let disk = lock(&s.disk)?;
            lock(&s.records)?.bulk_apply(r, &disk.data.conversations)
        }
        "thinkers" => lock(&s.records)?.thinkers_view(),
        "thinkers-link" => lock(&s.records)?.thinker_link(r),
        "thinkers-unlink" => lock(&s.records)?.thinker_unlink(r),
        "map" => lock(&s.records)?.map_view(),
        "map-add" => lock(&s.records)?.map_add(r),
        "map-update" => lock(&s.records)?.map_update(r),
        "map-remove" => lock(&s.records)?.map_remove(r),
        "map-export" => lock(&s.records)?.map_export(r),
        "records-organize-preview" => {
            let disk = lock(&s.disk)?;
            lock(&s.records)?.organize_preview(&disk.data.conversations)
        }
        "records-organize-apply" => {
            let disk = lock(&s.disk)?;
            lock(&s.records)?.organize_apply(r, &disk.data.conversations)
        }
        "connections" => Ok(
            json!({"chatgpt":s.chatgpt.status()?,"openrouter":{"configured":!lock(&s.key)?.is_empty()},"localEnabled":false}),
        ),
        "chatgpt-login" => s.chatgpt.login().await,
        "chatgpt-disconnect" => s.chatgpt.disconnect().await,
        "ideology-models" => match field(&r, "connection")? {
            "chatgpt" => s.chatgpt.models().await,
            "openrouter" => {
                if r["refresh"] == true {
                    *lock(&s.catalog)? = transport::fetch_catalog().await?;
                }
                let mut catalog = lock(&s.catalog)?.clone();
                if let Some(models) = catalog["models"].as_array_mut() {
                    models.retain(|m| m["free"] == true);
                }
                Ok(catalog)
            }
            "manual" => Ok(
                json!({"models":[],"warnings":["Model ve hizmet bilgisi kullanıcı beyanıdır; Töre bu hesaba bağlanmaz."]}),
            ),
            _ => Err("Desteklenmeyen bağlantı".into()),
        },
        "ideology-prepare" => {
            let opinions = lock(&s.opinions)?.list()?;
            s.ideology.prepare(opinions, r)
        }
        "ideology-manual" => {
            let opinions = lock(&s.opinions)?.list()?;
            s.ideology.complete_manual(opinions, r)
        }
        "ideology-send" => {
            let opinions = lock(&s.opinions)?.list()?;
            let (started, work) = s.ideology.start_send(opinions, r)?;
            if let Some(work) = work {
                let key = lock(&s.key)?.clone();
                tokio::spawn(async move {
                    let outcome=tokio::time::timeout(std::time::Duration::from_secs(300),async {
                        match work.connection.as_str() {
                            "chatgpt" => {
                                let result=s.chatgpt.synthesize(&work.model_id,&work.prompt).await?;
                                Ok(ideology::Completion{text:field(&result,"text")?.to_owned(),model_id:field(&result,"modelId")?.to_owned(),developer:"openai".into(),provider:Some("OpenAI".into()),usage:result["usage"].clone()})
                            },
                            "openrouter" => {
                                if key.is_empty(){return Err("Önce OpenRouter anahtarını bu oturum için girin".into());}
                                let result=transport::synthesize(&key,&work.developer,&work.model_id,&work.prompt,&work.output_schema).await?;
                                let engine=&result["engine"];
                                Ok(ideology::Completion{text:serde_json::to_string(&result["analysis"]).map_err(|_|"Model yanıtı kodlanamadı")?,model_id:field(engine,"modelId")?.to_owned(),developer:field(engine,"modelDeveloper")?.to_owned(),provider:Some(field(engine,"inferenceProvider")?.to_owned()),usage:result["usage"].clone()})
                            },
                            _ => Err("Bu bağlantı API gönderimini desteklemiyor".into()),
                        }
                    }).await.unwrap_or_else(|_|Err("İstek zaman aşımına uğradı. Gönderim sonucu belirsiz olabilir; otomatik tekrar yapılmadı.".into()));
                    // The durable job remains interrupted after a restart if saving fails.
                    let _ = s.ideology.complete_work(&work.id, outcome);
                });
            }
            Ok(started)
        }
        "ideology-preview" | "ideology-status" => {
            let opinions = lock(&s.opinions)?.list()?;
            let report_ids = if r.get("reportIds").is_some() {
                Some(
                    serde_json::from_value::<Vec<String>>(r["reportIds"].clone())
                        .map_err(|_| "Rapor seçimi geçersiz")?,
                )
            } else {
                None
            };
            if op == "ideology-preview" {
                s.ideology.preview(opinions, report_ids)
            } else {
                s.ideology.status(opinions, report_ids)
            }
        }
        "ideology-generate" => {
            let opinions = lock(&s.opinions)?.list()?;
            s.ideology.generate(opinions, r)
        }
        "opinions" => lock(&s.opinions)?.list(),
        "opinion-create" => {
            let disk = lock(&s.disk)?;
            lock(&s.opinions)?.create(r, &disk.data.conversations)
        }
        "opinion-review" => lock(&s.opinions)?.review(r),
        "status" => {
            let disk = lock(&s.disk)?;
            Ok(
                json!({"version":env!("CARGO_PKG_VERSION"),"schemaVersion":1,"conversationCount":disk.data.conversations.len(),"draftCount":disk.data.drafts.len(),"keyConfigured":!lock(&s.key)?.is_empty(),"budgetUsd":0,"developers":transport::developers(),"support":{"native":["chatgpt","claude","codex"],"generic":"Töre JSON ve metin","live":"Ücretsiz ve gizlilik koşuluna uygun uç doğrulanırsa","simulation":"11 geliştirici ailesi; gerçek model yanıtı değil"}}),
            )
        }
        "list" => Ok(
            json!({"conversations":lock(&s.disk)?.data.conversations.values().collect::<Vec<_>>()}),
        ),
        "conversation" => {
            let d = lock(&s.disk)?;
            serde_json::to_value(
                d.data
                    .conversations
                    .get(field(&r, "id")?)
                    .ok_or("Konuşma bulunamadı")?,
            )
            .map_err(|_| "Konuşma kodlanamadı".into())
        }
        "import-preview" => {
            let _permit = s
                .gate
                .clone()
                .try_acquire_owned()
                .map_err(|_| "Başka bir dosya inceleniyor; bitmesini bekleyin")?;
            let provider = field(&r, "provider")?.to_owned();
            let name = r["fileName"].as_str().unwrap_or("input.json").to_owned();
            let developer = r["developer"].as_str().unwrap_or("unknown").to_owned();
            let title = r["title"].as_str().unwrap_or("Genel aktarım").to_owned();
            let text = r["text"].as_str().map(str::to_owned);
            let bytes = if let Some(b) = r["contentBase64"].as_str() {
                if b.len() > 180 * 1024 * 1024 {
                    return Err("Dosya boyutu sınırı aşıldı".into());
                }
                base64::engine::general_purpose::STANDARD
                    .decode(b)
                    .map_err(|_| "Dosya kodlaması geçersiz")?
            } else {
                vec![]
            };
            if bytes.len() > 128 * 1024 * 1024
                || text.as_ref().is_some_and(|x| x.len() > 8 * 1024 * 1024)
            {
                return Err("Dosya/metin sınırı aşıldı".into());
            }
            let conversations = tokio::task::spawn_blocking(move || {
                if provider == "generic" && text.is_some() {
                    importers::parse_text(&developer, &title, &text.unwrap())
                } else {
                    importers::parse(&provider, &name, &bytes)
                }
            })
            .await
            .map_err(|_| "Dosya inceleme işlemi tamamlanamadı")??;
            if conversations.is_empty() {
                return Err("Görünür konuşma mesajı bulunamadı".into());
            }
            let size = serde_json::to_vec(&conversations)
                .map_err(|_| "Önizleme kodlanamadı")?
                .len();
            let preview_id = policy::id();
            let mut previews = lock(&s.previews)?;
            let existing: usize = previews
                .values()
                .map(|v| serde_json::to_vec(v).map(|b| b.len()).unwrap_or(usize::MAX))
                .sum();
            if previews.len() >= 8 || size.saturating_add(existing) > 256 * 1024 * 1024 {
                return Err("Önizleme belleği dolu; mevcut önizlemeyi kaydedin veya uygulamayı yeniden açın".into());
            }
            previews.insert(preview_id.clone(), conversations.clone());
            Ok(json!({"previewId":preview_id,"conversations":conversations}))
        }
        "import-commit" => {
            let pid = field(&r, "previewId")?;
            let selected = r["selectedIds"].as_array().ok_or("Konuşma seçin")?;
            if selected.is_empty() {
                return Err("En az bir konuşma seçin".into());
            }
            let selected: BTreeSet<&str> = selected
                .iter()
                .map(|v| v.as_str().ok_or("Seçim kimliği geçersiz"))
                .collect::<Result<_, _>>()?;
            let mut previews = lock(&s.previews)?;
            let preview = previews
                .get(pid)
                .ok_or("Önizleme bulunamadı; yeniden içe aktarın")?;
            if selected
                .iter()
                .any(|id| !preview.iter().any(|c| c.id == *id))
            {
                return Err("Önizleme dışı konuşma seçilemez".into());
            }
            let mut disk = lock(&s.disk)?;
            let mut next = disk.data.clone();
            let mut imported = 0;
            let mut skipped = 0;
            let mut conversations = vec![];
            for c in preview.iter().filter(|c| selected.contains(c.id.as_str())) {
                if let Some(old) = next.conversations.get(&c.id) {
                    if !same_import_except_location(old, c) {
                        return Err("Aynı kaynak kimliğinin farklı sürümü bulundu; mevcut konuşmanın üzerine yazılmadı".into());
                    }
                    skipped += 1;
                    conversations.push(old.clone());
                } else {
                    next.conversations.insert(c.id.clone(), c.clone());
                    imported += 1;
                    conversations.push(c.clone());
                }
            }
            disk.commit(next)?;
            previews.remove(pid);
            Ok(json!({"imported":imported,"skipped":skipped,"conversations":conversations}))
        }
        "prepare" => {
            let req: policy::Prepare =
                serde_json::from_value(r).map_err(|_| "Taslak alanları eksik veya geçersiz")?;
            let mut disk = lock(&s.disk)?;
            let c = disk
                .data
                .conversations
                .get(&req.conversation_id)
                .ok_or("Konuşma bulunamadı")?;
            let (draft, findings) = policy::prepare(c, req)?;
            if disk.data.drafts.len() >= 2000 {
                return Err("Demo taslak sınırına ulaşıldı".into());
            }
            let mut next = disk.data.clone();
            next.drafts.insert(draft.id.clone(), draft.clone());
            disk.commit(next)?;
            Ok(json!({"draft":draft,"findings":findings}))
        }
        "drafts" => {
            let disk = lock(&s.disk)?;
            Ok(
                json!({"drafts":disk.data.drafts.values().collect::<Vec<_>>(),"receipts":disk.data.receipts}),
            )
        }
        "revoke" => {
            let mut disk = lock(&s.disk)?;
            let mut next = disk.data.clone();
            let d = next
                .drafts
                .get_mut(field(&r, "draftId")?)
                .ok_or("Taslak bulunamadı")?;
            d.status = "revoked".into();
            disk.commit(next)?;
            Ok(
                json!({"revoked":true,"note":"Yeni işlemler durduruldu. Başlatılmış bir istek hâlâ tamamlanabilir; önceden gönderilen veya indirilmiş içerik geri alınamaz."}),
            )
        }
        "send" => send(s, r).await,
        "catalog" => {
            if r["refresh"] == true {
                let fresh = transport::fetch_catalog().await?;
                *lock(&s.catalog)? = fresh;
            }
            Ok(lock(&s.catalog)?.clone())
        }
        "key" => {
            let key = field(&r, "key")?;
            if key.len() > 4096 || key.chars().any(char::is_whitespace) {
                return Err("API anahtarı biçimi geçersiz".into());
            }
            let mut memory = lock(&s.key)?;
            memory.clear();
            memory.push_str(key);
            Ok(json!({"configured":!memory.is_empty()}))
        }
        _ => Err("Bilinmeyen Töre işlemi".into()),
    }
}
fn confirmed(disk: &store::Disk, r: &Value) -> Result<TransferDraft, String> {
    if r["confirmed"] != true {
        return Err("Bu tam önizleme için açık onay gerekli".into());
    }
    let d = disk
        .data
        .drafts
        .get(field(r, "draftId")?)
        .ok_or("Taslak bulunamadı")?;
    // Drafts stored by older versions may carry a removed intent; they load but never run.
    if d.hash != field(r, "hash")? || d.intent != "continue" || d.status != "ready" {
        return Err("Taslak değişmiş, izin geri çekilmiş veya işlem zaten başlatılmış; yeni önizleme hazırlayın".into());
    }
    policy::safe(d)?;
    Ok(d.clone())
}
fn receipt(
    d: &TransferDraft,
    status: &str,
    provider: Option<String>,
    usage: Value,
    cid: Option<String>,
) -> TransferReceipt {
    TransferReceipt {
        schema_version: 1,
        id: policy::id(),
        draft_id: d.id.clone(),
        draft_hash: d.hash.clone(),
        status: status.into(),
        mode: d.mode.clone(),
        developer: d.developer.clone(),
        model_id: d.model_id.clone(),
        provider,
        usage,
        created_at: policy::now(),
        conversation_id: cid,
    }
}
async fn send(s: Arc<Workspace>, r: Value) -> Result<Value, String> {
    let (draft, key) = {
        let mut disk = lock(&s.disk)?;
        let d = confirmed(&disk, &r)?;
        let key = if d.mode == "live" {
            let k = lock(&s.key)?.clone();
            if k.is_empty() {
                return Err(
                    "OpenRouter anahtarını bu oturuma girin; anahtar diske kaydedilmez".into(),
                );
            }
            k
        } else {
            String::new()
        };
        let mut next = disk.data.clone();
        next.drafts.get_mut(&d.id).unwrap().status = "sending".into();
        disk.commit(next)?;
        (d, key)
    };
    let result = match draft.mode.as_str() {
        "simulation" => Ok(
            json!({"text":format!("SİMÜLASYON — {} bağlantı sözleşmesi denendi. Gerçek modele istek yapılmadı; bu sentetik yanıt içerik değerlendirmesi değildir.",draft.developer),"status":"simulation","provider":Value::Null,"usage":Value::Null}),
        ),
        "manual" => Ok(json!({"status":"manual","usage":Value::Null})),
        "live" => {
            transport::generate(
                &key,
                &draft.model_id,
                &draft.developer,
                &policy::payload(&draft),
            )
            .await
        }
        _ => Err("Geçersiz aktarım modu".into()),
    };
    let mut disk = lock(&s.disk)?;
    let mut next = disk.data.clone();
    let revoked = next
        .drafts
        .get(&draft.id)
        .is_some_and(|d| d.status == "revoked");
    match result {
        Ok(out) => {
            // Validate even the local adapter boundary before accepting a model answer.
            if draft.mode == "live"
                && (out["developer"] != draft.developer || out["modelId"] != draft.model_id)
            {
                next.drafts.get_mut(&draft.id).unwrap().status =
                    if revoked { "revoked" } else { "unknown" }.into();
                next.receipts
                    .push(receipt(&draft, "unknown", None, Value::Null, None));
                disk.commit(next)?;
                return Err("Model yanıtı hedefle uyuşmadı; gönderim tekrarlanmadı".into());
            }
            let conversation = if draft.mode == "manual" {
                None
            } else {
                Some(policy::branch(
                    &draft,
                    out["text"]
                        .as_str()
                        .ok_or("Model yanıtı metin içermiyor")?
                        .to_owned(),
                ))
            };
            let rec = receipt(
                &draft,
                out["status"].as_str().unwrap_or("unknown"),
                out["provider"].as_str().map(str::to_owned),
                out["usage"].clone(),
                conversation.as_ref().map(|c| c.id.clone()),
            );
            if let Some(c) = &conversation {
                next.conversations.insert(c.id.clone(), c.clone());
            }
            next.drafts.get_mut(&draft.id).unwrap().status =
                if revoked { "revoked" } else { "sent" }.into();
            next.receipts.push(rec.clone());
            disk.commit(next)?;
            Ok(json!({"receipt":rec,"conversation":conversation,"contextText":draft.context_text}))
        }
        Err(e) => {
            next.drafts.get_mut(&draft.id).unwrap().status =
                if revoked { "revoked" } else { "unknown" }.into();
            next.receipts.push(receipt(
                &draft,
                "failed_or_unknown",
                None,
                Value::Null,
                None,
            ));
            disk.commit(next)?;
            Err(e)
        }
    }
}
#[cfg(test)]
mod tests;
