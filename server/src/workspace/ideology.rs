//! Reviewed synthesis. Reports are context, never an implicit approval of a belief.
//! No model or network operation is performed here; local inference is disabled.
#[path = "ideology_prompt.rs"]
mod prompt;
use super::policy::digest;
use fs2::FileExt;
use serde::{Deserialize, Serialize};
use serde_json::{Value, json};
use std::{
    collections::{BTreeMap, BTreeSet},
    fs::{self, File, OpenOptions},
    io::{Read, Write},
    path::{Path, PathBuf},
    sync::{Arc, Mutex},
};

const MAX_STORE: usize = 32 * 1024 * 1024;
const MAX_REPORT: usize = 2 * 1024 * 1024;
const MAX_CONTEXT: usize = 12_000;
const REPORT_CONTEXT: usize = 900;
const MAX_DRAFTS: usize = 100;

#[derive(Clone, Debug, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
struct Source {
    id: String,
    kind: String,
    title: String,
    text: String,
}
#[derive(Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
struct Stored {
    schema_version: u32,
    latest: Option<Value>,
    history: Vec<Value>,
    job: Option<Value>,
    #[serde(default)]
    drafts: Vec<Draft>,
}
impl Default for Stored {
    fn default() -> Self {
        Self {
            schema_version: 1,
            latest: None,
            history: vec![],
            job: None,
            drafts: vec![],
        }
    }
}
#[derive(Clone, Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct Target {
    pub connection: String,
    pub developer: String,
    pub model_id: String,
}
#[derive(Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
struct Draft {
    schema_version: u32,
    id: String,
    hash: String,
    input_hash: String,
    prompt_version: String,
    created_at: String,
    target: Target,
    report_ids: Vec<String>,
    sources: Vec<Source>,
    findings: Vec<Value>,
    status: String,
    job: Option<Value>,
}
/// The caller may dispatch this reviewed work once through the named connector.
pub struct WorkItem {
    pub id: String,
    pub connection: String,
    pub developer: String,
    pub model_id: String,
    pub prompt: String,
    pub output_schema: Value,
}
/// Adapters return only bounded text and verified provider metadata, never credentials.
pub struct Completion {
    pub text: String,
    pub model_id: String,
    pub developer: String,
    pub provider: Option<String>,
    pub usage: Value,
}
#[derive(Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
struct StartRequest {
    draft_id: String,
    draft_hash: String,
    confirmed: bool,
    request_id: String,
}
struct Snapshot {
    hash: String,
    sources: Vec<Source>,
    reports: Vec<Value>,
    scope_message: Option<String>,
    confirmed: usize,
    excluded: usize,
}
struct Disk {
    data: Stored,
    hash: Option<String>,
    healthy: bool,
    _lock: File,
}
pub struct Service {
    root: PathBuf,
    archive: PathBuf,
    disk: Mutex<Disk>,
}

fn now() -> String {
    chrono::Utc::now().to_rfc3339()
}
fn uuid(value: &str) -> bool {
    uuid::Uuid::parse_str(value).is_ok_and(|v| v.to_string() == value)
}
fn text<'a>(value: &'a Value, key: &str) -> Result<&'a str, String> {
    value[key]
        .as_str()
        .ok_or_else(|| format!("Eksik veya geçersiz alan: {key}"))
}
fn bounded(value: &str, max: usize) -> bool {
    !value.trim().is_empty() && !value.contains('\0') && value.chars().count() <= max
}
fn no_links(path: &Path) -> Result<(), String> {
    if !path.is_absolute() {
        return Err("Yerel yol mutlak olmalı".into());
    }
    if path
        .components()
        .any(|c| matches!(c, std::path::Component::ParentDir))
    {
        return Err("Üst klasör geçişi yasak".into());
    }
    for p in path.ancestors() {
        if fs::symlink_metadata(p).is_ok_and(|m| m.file_type().is_symlink()) {
            return Err("Sembolik bağlantı izlenmedi".into());
        }
    }
    Ok(())
}
fn options() -> OpenOptions {
    let mut o = OpenOptions::new();
    #[cfg(unix)]
    {
        use std::os::unix::fs::OpenOptionsExt;
        o.mode(0o600).custom_flags(libc::O_NOFOLLOW);
    }
    o
}
fn private_dir(path: &Path) -> Result<(), String> {
    no_links(path)?;
    fs::create_dir_all(path).map_err(|_| "Özel çalışma klasörü açılamadı")?;
    #[cfg(unix)]
    {
        use std::os::unix::fs::PermissionsExt;
        fs::set_permissions(path, fs::Permissions::from_mode(0o700))
            .map_err(|_| "Özel klasör izinleri ayarlanamadı")?;
    }
    Ok(())
}
fn read(path: &Path, max: usize) -> Result<Vec<u8>, String> {
    no_links(path)?;
    let f = options()
        .read(true)
        .open(path)
        .map_err(|_| "Yerel kaynak okunamadı")?;
    let m = f.metadata().map_err(|_| "Yerel kaynak ölçülemedi")?;
    if !m.is_file() || m.len() > max as u64 {
        return Err("Yerel kaynak normal dosya değil veya boyut sınırını aşıyor".into());
    }
    let mut b = Vec::new();
    f.take(max as u64 + 1)
        .read_to_end(&mut b)
        .map_err(|_| "Yerel kaynak okunamadı")?;
    if b.len() > max {
        return Err("Yerel kaynak okuma sınırını aştı".into());
    }
    Ok(b)
}
fn write_new(path: &Path, bytes: &[u8]) -> Result<(), String> {
    no_links(path)?;
    let mut f = options()
        .write(true)
        .create_new(true)
        .open(path)
        .map_err(|_| "Özel dosya oluşturulamadı")?;
    f.write_all(bytes)
        .and_then(|_| f.sync_all())
        .map_err(|_| "Özel dosya kalıcı yazılamadı".into())
}

impl Service {
    pub fn open(root: PathBuf, archive: PathBuf) -> Result<Arc<Self>, String> {
        no_links(&archive)?;
        private_dir(&root)?;
        let lock = options()
            .read(true)
            .write(true)
            .create(true)
            .truncate(false)
            .open(root.join("ideology.lock"))
            .map_err(|_| "İdeoloji kaydı kilitlenemedi")?;
        lock.try_lock_exclusive()
            .map_err(|_| "İdeoloji kaydı başka bir Töre sürecinde açık")?;
        let path = root.join("ideology-v1.json");
        let bytes = if path
            .try_exists()
            .map_err(|_| "İdeoloji kaydı denetlenemedi")?
        {
            Some(read(&path, MAX_STORE)?)
        } else {
            None
        };
        let data: Stored = match &bytes {
            Some(b) => {
                serde_json::from_slice(b).map_err(|_| "İdeoloji kaydı bozuk; sıfırlanmadı")?
            }
            None => Stored::default(),
        };
        if data.schema_version != 1 || data.history.len() > 10 || data.drafts.len() > MAX_DRAFTS {
            return Err("İdeoloji kayıt sürümü veya geçmişi geçersiz".into());
        }
        for result in data.latest.iter().chain(data.history.iter()) {
            validate_result(result)?;
        }
        let mut draft_ids = BTreeSet::new();
        for draft in &data.drafts {
            if !draft_ids.insert(&draft.id) {
                return Err("Yinelenmiş sentez taslağı".into());
            }
            validate_draft(draft)?;
        }
        if let Some(job) = &data.job {
            if !["running", "completed", "failed", "interrupted"].contains(&text(job, "status")?)
                || !uuid(text(job, "id")?)
                || !uuid(text(job, "requestId")?)
            {
                return Err("İdeoloji iş kaydı geçersiz".into());
            }
            if job.get("draftId").is_some()
                && !data
                    .drafts
                    .iter()
                    .any(|draft| job["draftId"] == draft.id && draft.job.as_ref() == Some(job))
            {
                return Err("İdeoloji işi saklı taslağıyla eşleşmiyor".into());
            }
        }
        let service = Arc::new(Self {
            root,
            archive,
            disk: Mutex::new(Disk {
                data,
                hash: bytes.map(|b| digest(&b)),
                healthy: true,
                _lock: lock,
            }),
        });
        {
            let mut disk = service
                .disk
                .lock()
                .map_err(|_| "İdeoloji kilidi kullanılamıyor")?;
            if disk
                .data
                .job
                .as_ref()
                .is_some_and(|j| j["status"] == "running")
            {
                let mut next = disk.data.clone();
                let job = next.job.as_mut().unwrap();
                job["status"] = json!("interrupted");
                job["error"] = json!(
                    "Önceki üretim kesildi. İstek ulaşmış olabilir; kendiliğinden yeniden başlatılmadı."
                );
                job["finishedAt"] = json!(now());
                let interrupted = job.clone();
                if let Some(draft) = next
                    .drafts
                    .iter_mut()
                    .find(|d| d.job.as_ref().is_some_and(|j| j["id"] == interrupted["id"]))
                {
                    draft.status = "interrupted".into();
                    draft.job = Some(interrupted);
                }
                service.commit(&mut disk, next)?;
            }
        }
        Ok(service)
    }
    fn commit(&self, disk: &mut Disk, next: Stored) -> Result<(), String> {
        if !disk.healthy {
            return Err("İdeoloji deposu yazma hatasından sonra kilitlendi; yeniden açın".into());
        }
        let bytes = serde_json::to_vec(&next).map_err(|_| "İdeoloji kaydı kodlanamadı")?;
        if bytes.len() > MAX_STORE {
            return Err("İdeoloji kayıt boyutu sınırı aşıldı".into());
        }
        let path = self.root.join("ideology-v1.json");
        let temp = self
            .root
            .join(format!(".ideology-{}.tmp", uuid::Uuid::new_v4()));
        let result = (|| {
            no_links(&path)?;
            let current = if path
                .try_exists()
                .map_err(|_| "İdeoloji kaydı denetlenemedi")?
            {
                Some(digest(&read(&path, MAX_STORE)?))
            } else {
                None
            };
            if current != disk.hash {
                return Err("İdeoloji kaydı dışarıdan değişti; üzerine yazılmadı".into());
            }
            write_new(&temp, &bytes)?;
            fs::rename(&temp, &path).map_err(|_| "İdeoloji kaydı tamamlanamadı")?;
            File::open(&self.root)
                .and_then(|f| f.sync_all())
                .map_err(|_| "İdeoloji kaydı kalıcılığı doğrulanamadı")?;
            Ok::<(), String>(())
        })();
        if result.is_err() {
            disk.healthy = false;
            let _ = fs::remove_file(&temp);
        }
        result?;
        disk.hash = Some(digest(&bytes));
        disk.data = next;
        Ok(())
    }
    fn snapshot(
        &self,
        opinions: &Value,
        report_ids: Option<Vec<String>>,
    ) -> Result<Snapshot, String> {
        let cards = opinions["cards"]
            .as_array()
            .ok_or("Görüş kayıtları geçersiz")?;
        let positions = opinions["catalog"]["positions"]
            .as_array()
            .ok_or("Görüş ilke kataloğu geçersiz")?;
        let mut card_values: Vec<_> = cards.iter().collect();
        card_values.sort_by_key(|c| c["id"].as_str().unwrap_or(""));
        let mut sources = vec![];
        let mut seen = BTreeSet::new();
        let mut confirmed = 0;
        for c in &card_values {
            let id = text(c, "id")?;
            if !uuid(id) || !seen.insert(id) {
                return Err("Görüş kimliği geçersiz veya yinelenmiş".into());
            }
            if c["status"] != "confirmed" {
                continue;
            }
            confirmed += 1;
            let statement = text(c, "statement")?;
            let reason = text(c, "reason")?;
            let ids = c["positionIds"]
                .as_array()
                .ok_or("Görüş ilkeleri geçersiz")?;
            let mut labels = vec![];
            for id in ids {
                let p = positions
                    .iter()
                    .find(|p| p["id"] == *id && p["topic"] == c["topic"])
                    .ok_or("Görüş ilkesi katalogda yok")?;
                labels.push(text(p, "label")?);
            }
            let content = format!(
                "Kullanıcının açıkça onayladığı güncel görüş:\n{statement}\n\nKullanıcının onayladığı gerekçe:\n{reason}\n\nKullanıcının seçtiği sınırlı karşılaştırma ilkeleri:\n{}",
                labels.join("\n")
            );
            sources.push(Source {
                id: format!("c-{id}"),
                kind: "confirmed_card".into(),
                title: format!("Onaylı görüş · {}", text(c, "topic")?),
                text: content,
            });
        }
        let card_chars: usize = sources.iter().map(|s| s.text.chars().count()).sum();
        if card_chars > MAX_CONTEXT {
            return Err("Onaylı görüşlerin tamamı sentez bağlamı sınırını aşıyor; hiçbir kart sessizce çıkarılmadı".into());
        }
        let manifest_path = self.archive.join("arsiv.json");
        no_links(&manifest_path)?;
        let manifest: Value = if manifest_path
            .try_exists()
            .map_err(|_| "Rapor arşivi denetlenemedi")?
        {
            serde_json::from_slice(&read(&manifest_path, MAX_STORE)?)
                .map_err(|_| "Rapor arşivi geçerli JSON değil")?
        } else {
            json!({"schemaVersion":1,"reports":[]})
        };
        if manifest["schemaVersion"] != 1 {
            return Err("Rapor arşivi sürümü desteklenmiyor".into());
        }
        let records = manifest["reports"]
            .as_array()
            .ok_or("Rapor arşivi listesi geçersiz")?;
        if records.len() > 2000 {
            return Err("Rapor kataloğu sınırı aşıldı".into());
        }
        let mut active = BTreeMap::new();
        let mut all_ids = BTreeSet::new();
        for r in records {
            let id = text(r, "id")?;
            let path = text(r, "path")?;
            let hash = text(r, "sha256")?;
            if !uuid(id)
                || !all_ids.insert(id)
                || path != format!("raporlar/{id}.md")
                || hash.len() != 64
                || !hash.bytes().all(|b| b.is_ascii_hexdigit())
                || !r["trashed"].is_boolean()
                || !bounded(text(r, "title")?, 1000)
            {
                return Err("Rapor kimliği, yolu veya içerik özeti geçersiz".into());
            }
            if r["trashed"] == false {
                active.insert(id.to_owned(), r);
            }
        }
        // Keep the catalog reachable when the archive outgrows one model run.
        // Never choose an arbitrary first eight reports on the user's behalf.
        let needs_report_selection = report_ids.is_none() && active.len() > 8;
        let selected: BTreeSet<String> = match report_ids {
            Some(ids) => {
                let mut set = BTreeSet::new();
                for id in ids {
                    if !active.contains_key(&id) || !set.insert(id) {
                        return Err("Seçilen rapor yok, kaldırılmış veya yinelenmiş".into());
                    }
                }
                set
            }
            None if needs_report_selection => BTreeSet::new(),
            None => active.keys().cloned().collect(),
        };
        if selected.len() > 8 {
            return Err("En fazla 8 rapor seçin; tüm arşiv modele gönderilmedi".into());
        }
        let mut reports = vec![];
        let mut report_hashes = vec![];
        let per_report = if selected.is_empty() {
            0
        } else {
            REPORT_CONTEXT.min((MAX_CONTEXT - card_chars) / selected.len())
        };
        if !selected.is_empty() && per_report < 400 {
            return Err(
                "Onaylı görüşler ve seçilen raporlar bağlama sığmıyor; daha az rapor seçin".into(),
            );
        }
        for (id, r) in active {
            let is_selected = selected.contains(&id);
            let mut total = 0;
            let mut included = 0;
            if is_selected {
                let bytes = read(&self.archive.join(text(r, "path")?), MAX_REPORT)?;
                if digest(&bytes) != text(r, "sha256")? {
                    return Err(
                        "Rapor içeriği katalog özetiyle eşleşmiyor; üretim durduruldu".into(),
                    );
                }
                let body = String::from_utf8(bytes).map_err(|_| "Rapor UTF-8 değil")?;
                total = body.chars().count();
                let excerpt = select_context(&body, per_report);
                included = excerpt.chars().count();
                if !excerpt.trim().is_empty() {
                    sources.push(Source {
                        id: format!("r-{id}"),
                        kind: "report_context".into(),
                        title: text(r, "title")?.to_owned(),
                        text: excerpt,
                    });
                }
                report_hashes.push(json!({"id":id,"sha256":r["sha256"],"title":r["title"]}));
            }
            reports.push(json!({"id":id,"title":r["title"],"selected":is_selected,"totalCharacters":total,"includedCharacters":included}));
        }
        if sources.len() > 80 {
            return Err(
                "Sentez en fazla 80 kaynak kabul eder; hiçbir onaylı görüş sessizce çıkarılmadı"
                    .into(),
            );
        }
        let material = json!({"version":1,"cards":card_values,"positions":positions,"reports":report_hashes,"sources":sources});
        let hash =
            digest(&serde_json::to_vec(&material).map_err(|_| "Bağlam özeti oluşturulamadı")?);
        Ok(Snapshot {
            hash,
            sources,
            reports,
            scope_message: needs_report_selection.then(|| {
                "Arşivinde 8'den fazla rapor var. Şimdilik yalnız onaylı görüşlerin kapsamda; raporları da kullanmak için listeden en fazla 8 rapor seç.".into()
            }),
            confirmed,
            excluded: cards.len() - confirmed,
        })
    }
    fn view(&self, snapshot: &Snapshot, full: bool) -> Result<Value, String> {
        let disk = self
            .disk
            .lock()
            .map_err(|_| "İdeoloji kilidi kullanılamıyor")?;
        if !disk.healthy {
            return Err("İdeoloji kaydı güvenli durumda değil; yeniden açın".into());
        }
        let mut v = json!({"inputHash":snapshot.hash,"job":disk.data.job,"latest":disk.data.latest,"stale":disk.data.latest.as_ref().is_some_and(|l|l["inputHash"]!=snapshot.hash)});
        if full {
            let engine = json!({"ready":false,"name":"Bulut veya elle aktarım","localOnly":false,"localInferenceDisabled":true,"message":"Yerel model kapalı. Bir bağlantı seçip gönderilecek metni ayrı olarak onaylayın."});
            v["confirmedCount"] = json!(snapshot.confirmed);
            v["excludedCount"] = json!(snapshot.excluded);
            v["reports"] = json!(snapshot.reports);
            v["scopeMessage"] = json!(snapshot.scope_message);
            v["sources"] = json!(snapshot.sources);
            v["engine"] = engine;
            v["findings"] = json!(source_findings(&snapshot.sources));
        }
        Ok(v)
    }
    pub fn preview(
        &self,
        opinions: Value,
        report_ids: Option<Vec<String>>,
    ) -> Result<Value, String> {
        let snapshot = self.snapshot(&opinions, report_ids)?;
        self.view(&snapshot, true)
    }
    pub fn status(
        &self,
        opinions: Value,
        report_ids: Option<Vec<String>>,
    ) -> Result<Value, String> {
        let snapshot = self.snapshot(&opinions, report_ids)?;
        self.view(&snapshot, false)
    }
    /// Old tabs and old clients cannot start the local model, even with valid configuration.
    pub fn generate(self: &Arc<Self>, _opinions: Value, _request: Value) -> Result<Value, String> {
        Err("Yerel model çalıştırma kapalı. Bulut veya elle aktarım önizlemesini kullanın.".into())
    }

    pub fn prepare(&self, opinions: Value, request: Value) -> Result<Value, String> {
        #[derive(Deserialize)]
        #[serde(rename_all = "camelCase", deny_unknown_fields)]
        struct Edit {
            id: String,
            text: String,
        }
        #[derive(Deserialize)]
        #[serde(rename_all = "camelCase", deny_unknown_fields)]
        struct Request {
            report_ids: Option<Vec<String>>,
            source_ids: Option<Vec<String>>,
            target: Target,
            #[serde(default)]
            edits: Vec<Edit>,
        }
        let r: Request =
            serde_json::from_value(request).map_err(|_| "Sentez taslağı alanları geçersiz")?;
        validate_target(&r.target)?;
        let snapshot = self.snapshot(&opinions, r.report_ids)?;
        let mut sources = snapshot.sources.clone();
        if let Some(ids) = r.source_ids {
            let wanted: BTreeSet<_> = ids.iter().collect();
            if wanted.len() != ids.len()
                || ids.is_empty()
                || ids.iter().any(|id| !sources.iter().any(|s| s.id == *id))
            {
                return Err("Kaynak seçimi boş, yinelenmiş veya önizlemede bulunmuyor".into());
            }
            sources.retain(|s| wanted.contains(&s.id));
        }
        let mut edited = BTreeSet::new();
        for edit in r.edits {
            if !edited.insert(edit.id.clone()) || !bounded(&edit.text, MAX_CONTEXT) {
                return Err("Kaynak düzeltmesi boş, yinelenmiş veya çok uzun".into());
            }
            let source = sources
                .iter_mut()
                .find(|s| s.id == edit.id)
                .ok_or("Yalnız seçili kaynak metinleri düzeltilebilir")?;
            source.text = edit.text;
        }
        validate_sources(&sources)?;
        let findings = source_findings(&sources);
        let mut draft = Draft {
            schema_version: 1,
            id: uuid::Uuid::new_v4().to_string(),
            hash: String::new(),
            input_hash: snapshot.hash.clone(),
            prompt_version: prompt::VERSION.into(),
            created_at: now(),
            target: r.target,
            report_ids: snapshot
                .reports
                .iter()
                .filter(|r| r["selected"] == true)
                .map(|r| r["id"].as_str().unwrap().to_owned())
                .collect(),
            sources,
            status: if findings.is_empty() {
                "ready"
            } else {
                "blocked"
            }
            .into(),
            findings,
            job: None,
        };
        draft.hash = draft_hash(&draft)?;
        validate_draft(&draft)?;
        {
            let mut disk = self
                .disk
                .lock()
                .map_err(|_| "İdeoloji kilidi kullanılamıyor")?;
            if let Some(existing) =
                disk.data.drafts.iter().find(|d| {
                    d.hash == draft.hash && matches!(d.status.as_str(), "ready" | "blocked")
                })
            {
                draft = existing.clone();
            } else {
                let mut next = disk.data.clone();
                if next.drafts.len() >= MAX_DRAFTS {
                    if let Some(index) = next.drafts.iter().position(|d| {
                        d.status != "sending"
                            && !d.job.as_ref().is_some_and(|job| {
                                next.job
                                    .as_ref()
                                    .is_some_and(|latest| latest["id"] == job["id"])
                            })
                    }) {
                        next.drafts.remove(index);
                    } else {
                        return Err(
                            "Sentez taslağı sınırına ulaşıldı; yeni taslak kaydedilmedi".into()
                        );
                    }
                }
                next.drafts.push(draft.clone());
                self.commit(&mut disk, next)?;
            }
        }
        let mut view = self.view(&snapshot, false)?;
        view["draft"] = draft_view(&draft);
        Ok(view)
    }

    /// Persist the intent before returning work to the network adapter. A retry returns no work.
    pub fn start_send(
        &self,
        opinions: Value,
        request: Value,
    ) -> Result<(Value, Option<WorkItem>), String> {
        let request: StartRequest =
            serde_json::from_value(request).map_err(|_| "Gönderim isteği geçersiz")?;
        self.start_work(&opinions, request, false, None)
    }

    fn start_work(
        &self,
        opinions: &Value,
        request: StartRequest,
        manual: bool,
        response_hash: Option<String>,
    ) -> Result<(Value, Option<WorkItem>), String> {
        if !request.confirmed || !uuid(&request.request_id) {
            return Err("Bu önizleme için ayrı açık onay ve geçerli istek kimliği gerekli".into());
        }
        let mut disk = self
            .disk
            .lock()
            .map_err(|_| "İdeoloji kilidi kullanılamıyor")?;
        let draft = disk
            .data
            .drafts
            .iter()
            .find(|d| d.id == request.draft_id)
            .ok_or("Sentez taslağı bulunamadı; yeniden önizleyin")?
            .clone();
        validate_draft(&draft)?;
        if draft.prompt_version != prompt::VERSION {
            return Err("Sentez yönergesi güncellendi; yeni önizleme hazırlayın".into());
        }
        if draft.hash != request.draft_hash || (draft.target.connection == "manual") != manual {
            return Err("Taslak özeti veya işlem türü önizlemeyle eşleşmiyor".into());
        }
        let fresh = self.snapshot(opinions, Some(draft.report_ids.clone()))?;
        if fresh.hash != draft.input_hash {
            return Err("Kaynaklar önizlemeden sonra değişti; yeniden önizleyin".into());
        }
        if !source_findings(&draft.sources).is_empty() {
            return Err("Özel bilgi bulguları var; maskeleyip yeniden önizleyin".into());
        }
        if let Some(previous) = &draft.job {
            if previous["requestId"] == request.request_id {
                if previous["responseHash"] != json!(response_hash) {
                    return Err("Aynı istek kimliği farklı yanıt için kullanılamaz".into());
                }
                return Ok((json!({"job":previous,"latest":disk.data.latest}), None));
            }
            return Err("Bu taslak daha önce işleme alındı. Otomatik tekrar yapılmaz; yeni önizleme hazırlayın".into());
        }
        if draft.status != "ready" {
            return Err("Bu taslak gönderime hazır değil".into());
        }
        if disk
            .data
            .job
            .as_ref()
            .is_some_and(|j| j["status"] == "running")
        {
            return Err("Bir sentez işlemi zaten sürüyor; sonuç beklenmeli".into());
        }
        if disk.data.drafts.iter().any(|d| {
            d.job
                .as_ref()
                .is_some_and(|j| j["requestId"] == request.request_id)
        }) {
            return Err("İstek kimliği başka bir taslakta kullanılmış".into());
        }
        let id = uuid::Uuid::new_v4().to_string();
        let job = json!({"id":id,"requestId":request.request_id,"draftId":draft.id,"draftHash":draft.hash,"inputHash":draft.input_hash,
            "responseHash":response_hash,"status":"running","phase":if manual { "validating" } else { "sending" },"createdAt":now(),"error":null});
        let work = WorkItem {
            id,
            connection: draft.target.connection.clone(),
            developer: draft.target.developer.clone(),
            model_id: draft.target.model_id.clone(),
            prompt: prompt::build(&draft.sources),
            output_schema: prompt::schema(&draft.sources),
        };
        let mut next = disk.data.clone();
        let saved = next.drafts.iter_mut().find(|d| d.id == draft.id).unwrap();
        saved.status = "sending".into();
        saved.job = Some(job.clone());
        next.job = Some(job.clone());
        self.commit(&mut disk, next)?;
        Ok((json!({"job":job}), Some(work)))
    }

    pub fn complete_manual(&self, opinions: Value, request: Value) -> Result<Value, String> {
        #[derive(Deserialize)]
        #[serde(rename_all = "camelCase", deny_unknown_fields)]
        struct Request {
            draft_id: String,
            draft_hash: String,
            confirmed: bool,
            request_id: String,
            text: String,
        }
        let r: Request =
            serde_json::from_value(request).map_err(|_| "Elle yanıt alanları geçersiz")?;
        let analysis = parse_analysis(&r.text)?;
        let report_ids = {
            let disk = self
                .disk
                .lock()
                .map_err(|_| "İdeoloji kilidi kullanılamıyor")?;
            let draft = disk
                .data
                .drafts
                .iter()
                .find(|d| d.id == r.draft_id)
                .ok_or("Sentez taslağı bulunamadı")?;
            validate_analysis(&analysis, &draft.sources)?;
            draft.report_ids.clone()
        };
        let response_hash = digest(r.text.as_bytes());
        let (view, work) = self.start_work(
            &opinions,
            StartRequest {
                draft_id: r.draft_id,
                draft_hash: r.draft_hash,
                confirmed: r.confirmed,
                request_id: r.request_id,
            },
            true,
            Some(response_hash),
        )?;
        if let Some(work) = work {
            self.complete_work(
                &work.id,
                Ok(Completion {
                    text: r.text,
                    model_id: work.model_id,
                    developer: work.developer,
                    provider: None,
                    usage: Value::Null,
                }),
            )?;
            let mut result = self.status(opinions, Some(report_ids))?;
            result["manual"] = json!(true);
            Ok(result)
        } else {
            Ok(view)
        }
    }

    /// Validate the provider result before accepting it. Failure preserves the prior interpretation.
    pub fn complete_work(
        &self,
        work_id: &str,
        outcome: Result<Completion, String>,
    ) -> Result<Value, String> {
        let mut disk = self
            .disk
            .lock()
            .map_err(|_| "İdeoloji kilidi kullanılamıyor")?;
        let index = disk
            .data
            .drafts
            .iter()
            .position(|d| d.job.as_ref().is_some_and(|j| j["id"] == work_id))
            .ok_or("Sentez işlemi bulunamadı")?;
        let draft = disk.data.drafts[index].clone();
        let previous = draft.job.as_ref().unwrap();
        if previous["status"] != "running" {
            return Ok(json!({"job":previous,"latest":disk.data.latest}));
        }
        if disk.data.job.as_ref().is_none_or(|j| j["id"] != work_id) {
            return Err("Sentez işlem kaydı eşleşmiyor; önceki sonuç korunuyor".into());
        }
        let validated = outcome.and_then(|reply| {
            if reply.developer != draft.target.developer || reply.model_id != draft.target.model_id {
                return Err("Yanıtın modeli veya geliştiricisi onaylanan hedefle eşleşmedi".into());
            }
            if draft.target.connection != "manual" && reply.provider.as_deref().is_none_or(|p| !bounded(p, 200)) {
                return Err("Yanıtın çalıştıran sağlayıcısı doğrulanamadı".into());
            }
            let analysis = parse_analysis(&reply.text)?;
            validate_analysis(&analysis, &draft.sources)?;
            let manual = draft.target.connection == "manual";
            let engine = json!({"name":format!("{} · {}", draft.target.developer, if draft.target.model_id.is_empty() { "Model belirtilmedi" } else { &draft.target.model_id }),
                "localOnly":false,"connection":draft.target.connection,"developer":reply.developer,"modelId":reply.model_id,
                "provider":if manual { None } else { reply.provider },"provenance":if manual { "user_attested" } else { "connector_verified" },
                "costMode":cost_mode(&draft.target)});
            let usage = clean_usage(&reply.usage);
            Ok(json!({"id":work_id,"inputHash":draft.input_hash,"draftHash":draft.hash,"createdAt":now(),"engine":engine,
                "coverage":{"confirmedCount":draft.sources.iter().filter(|s|s.kind=="confirmed_card").count(),"reportsCount":draft.sources.iter().filter(|s|s.kind=="report_context").count()},
                "analysis":analysis,"sources":draft.sources,"usage":usage}))
        });
        let mut next = disk.data.clone();
        let mut job = previous.clone();
        job["finishedAt"] = json!(now());
        match validated {
            Ok(result) => {
                job["status"] = json!("completed");
                job["phase"] = json!("complete");
                if let Some(old) = next.latest.replace(result) {
                    next.history.push(old);
                    if next.history.len() > 10 {
                        next.history.remove(0);
                    }
                }
            }
            Err(message) => {
                job["status"] = json!("failed");
                job["phase"] = json!("failed");
                job["error"] = json!(safe_error(message));
            }
        }
        next.drafts[index].status = job["status"].as_str().unwrap().to_owned();
        next.drafts[index].job = Some(job.clone());
        next.job = Some(job.clone());
        self.commit(&mut disk, next)?;
        Ok(json!({"job":job,"latest":disk.data.latest}))
    }
}

fn validate_target(target: &Target) -> Result<(), String> {
    const DEVELOPERS: &[&str] = &[
        "openai",
        "anthropic",
        "google",
        "meta",
        "x-ai",
        "deepseek",
        "moonshotai",
        "z-ai",
        "qwen",
        "mistralai",
        "nvidia",
    ];
    if !["chatgpt", "openrouter", "manual"].contains(&target.connection.as_str())
        || !DEVELOPERS.contains(&target.developer.as_str())
        || target.model_id.chars().count() > 200
        || target.model_id.chars().any(char::is_control)
        || (target.connection != "manual" && target.model_id.trim().is_empty())
        || (target.connection == "chatgpt" && target.developer != "openai")
    {
        return Err("Bağlantı, geliştirici veya model seçimi geçersiz".into());
    }
    if target.connection != "manual"
        && !target
            .model_id
            .bytes()
            .all(|b| b.is_ascii_alphanumeric() || b"/-_.:".contains(&b))
    {
        return Err("API model kimliği geçersiz".into());
    }
    if target.connection == "openrouter" {
        let Some((prefix, _)) = target.model_id.split_once('/') else {
            return Err("OpenRouter model kimliği geliştirici/model biçiminde olmalı".into());
        };
        let developer = if prefix == "meta-llama" {
            "meta"
        } else {
            prefix
        };
        if developer != target.developer
            || target.model_id.contains("..")
            || target.model_id.matches('/').count() != 1
        {
            return Err("Model kimliği onaylanan geliştiriciyle eşleşmiyor".into());
        }
    }
    Ok(())
}
fn validate_sources(sources: &[Source]) -> Result<(), String> {
    let mut ids = BTreeSet::new();
    if sources.is_empty()
        || sources.len() > 80
        || !sources.iter().any(|s| s.kind == "confirmed_card")
        || sources
            .iter()
            .map(|s| s.text.chars().count())
            .sum::<usize>()
            > MAX_CONTEXT
    {
        return Err("En az bir onaylı görüş ve en fazla 12.000 karakterlik kaynak seçin".into());
    }
    for source in sources {
        let prefix = if source.kind == "confirmed_card" {
            "c-"
        } else if source.kind == "report_context" {
            "r-"
        } else {
            return Err("Kaynak türü geçersiz".into());
        };
        if !source.id.strip_prefix(prefix).is_some_and(uuid)
            || !ids.insert(&source.id)
            || !bounded(&source.text, MAX_CONTEXT)
            || !bounded(&source.title, 1000)
        {
            return Err("Kaynak kimliği, başlığı veya metni geçersiz".into());
        }
    }
    if prompt::build(sources).len() > 64 * 1024 {
        return Err(
            "Hazırlanan tam gönderim metni 64 KiB sınırını aşıyor; daha az kaynak seçin".into(),
        );
    }
    Ok(())
}
fn source_findings(sources: &[Source]) -> Vec<Value> {
    let mut out = Vec::new();
    for source in sources {
        for (field, content) in [("title", &source.title), ("text", &source.text)] {
            for mut finding in super::policy::findings(&source.id, content) {
                finding["sourceId"] = json!(source.id);
                finding["field"] = json!(field);
                out.push(finding);
            }
        }
    }
    out
}
fn cost_mode(target: &Target) -> &'static str {
    match target.connection.as_str() {
        "chatgpt" => "subscription",
        "openrouter" => "free_api",
        _ => "manual",
    }
}
fn draft_hash(draft: &Draft) -> Result<String, String> {
    let material = json!({"schemaVersion":1,"promptVersion":draft.prompt_version,"inputHash":draft.input_hash,"target":draft.target,
        "sources":draft.sources,"reportIds":draft.report_ids,"costMode":cost_mode(&draft.target),"paidFallback":false,"automaticRetry":false});
    Ok(digest(
        &serde_json::to_vec(&material).map_err(|_| "Taslak özeti oluşturulamadı")?,
    ))
}
fn validate_draft(draft: &Draft) -> Result<(), String> {
    validate_target(&draft.target)?;
    validate_sources(&draft.sources)?;
    if draft.schema_version != 1
        || !uuid(&draft.id)
        || draft.hash != draft_hash(draft)?
        || !bounded(&draft.prompt_version, 100)
        || draft.input_hash.len() != 64
        || !draft.input_hash.bytes().all(|b| b.is_ascii_hexdigit())
        || draft.report_ids.len() > 8
        || draft.report_ids.iter().any(|id| !uuid(id))
        || draft.report_ids.iter().collect::<BTreeSet<_>>().len() != draft.report_ids.len()
        || ![
            "ready",
            "blocked",
            "sending",
            "completed",
            "failed",
            "interrupted",
        ]
        .contains(&draft.status.as_str())
    {
        return Err("Saklı sentez taslağı geçersiz".into());
    }
    if let Some(job) = &draft.job {
        if !uuid(text(job, "id")?)
            || !uuid(text(job, "requestId")?)
            || job["draftId"] != draft.id
            || job["draftHash"] != draft.hash
            || job["inputHash"] != draft.input_hash
            || !["running", "completed", "failed", "interrupted"].contains(&text(job, "status")?)
        {
            return Err("Saklı sentez taslağının iş kaydı geçersiz".into());
        }
        let expected = if job["status"] == "running" {
            "sending"
        } else {
            text(job, "status")?
        };
        if draft.status != expected {
            return Err("Saklı sentez taslağı ve iş durumu eşleşmiyor".into());
        }
    } else if !["ready", "blocked"].contains(&draft.status.as_str()) {
        return Err("Saklı sentez taslağının iş kaydı eksik".into());
    }
    Ok(())
}
fn draft_view(draft: &Draft) -> Value {
    let cost_caption = match draft.target.connection.as_str() {
        "chatgpt" => {
            "Kendi ChatGPT hesabının kullanım sınırları geçerlidir. Ücretli API'ye otomatik geçiş yapılmaz."
        }
        "openrouter" => {
            "Yalnız gönderim anında ücretsizliği ve gizlilik koşulları doğrulanan uç kullanılabilir. Ücretli geçiş ve otomatik tekrar yoktur."
        }
        _ => {
            "Töre model çağrısı veya satın alma yapmaz; seçtiğin sohbet hizmetinin aboneliği ve kotası geçerlidir."
        }
    };
    let privacy_caption = match draft.target.connection.as_str() {
        "openrouter" => {
            "Onayladığın metin OpenRouter üzerinden seçili sağlayıcıya gider. Uç için ZDR aranır; hesabındaki isteğe bağlı kayıt/Broadcast ayarları Töre tarafından denetlenmez."
        }
        "chatgpt" => {
            "Onayladığın metin kendi ChatGPT hesabın üzerinden OpenAI'ye gönderilir. Hesabının veri kullanım koşulları geçerlidir; Töre bu ayarları değiştirmez."
        }
        _ => {
            "Kopyaladığın metni başka bir sohbete yapıştırdığında o hizmetle paylaşmış olursun. Yanıtın hangi modelden geldiğini Töre doğrulayamaz."
        }
    };
    json!({"id":draft.id,"hash":draft.hash,"inputHash":draft.input_hash,"createdAt":draft.created_at,"target":draft.target,
        "sources":draft.sources,"reportIds":draft.report_ids,"confirmedCount":draft.sources.iter().filter(|s|s.kind=="confirmed_card").count(),
        "reportsCount":draft.sources.iter().filter(|s|s.kind=="report_context").count(),"prompt":prompt::build(&draft.sources),
        "outputSchema":prompt::schema(&draft.sources),"findings":draft.findings,"canSend":draft.status=="ready" && source_findings(&draft.sources).is_empty(),
        "status":draft.status,"cost":{"mode":cost_mode(&draft.target),"caption":cost_caption,"paidFallback":false,"automaticRetry":false},
        "privacy":{"external":true,"caption":format!("{privacy_caption} Otomatik tarama adları ve tüm özel bilgileri bulamaz; göndermeden önce metnin tamamını gözden geçir.")}})
}
fn clean_usage(value: &Value) -> Value {
    let mut usage = serde_json::Map::new();
    for name in [
        "input_tokens",
        "output_tokens",
        "prompt_tokens",
        "completion_tokens",
        "total_tokens",
    ] {
        if let Some(number) = value[name].as_u64() {
            usage.insert(name.into(), json!(number));
        }
    }
    if value["cost"].as_u64() == Some(0) {
        usage.insert("cost".into(), json!(0));
    }
    if usage.is_empty() {
        Value::Null
    } else {
        Value::Object(usage)
    }
}
fn safe_error(message: String) -> String {
    if bounded(&message, 600) && super::policy::findings("error", &message).is_empty() {
        message
    } else {
        "Bağlantı geçerli bir sonuç üretmedi. Önceki yorum korundu; otomatik tekrar yapılmadı."
            .into()
    }
}
fn parse_analysis(raw: &str) -> Result<Value, String> {
    if raw.len() > 512 * 1024 {
        return Err("Model yanıtı boyut sınırını aşıyor".into());
    }
    let raw = raw.trim();
    let raw = if let Some(inner) = raw
        .strip_prefix("```json")
        .or_else(|| raw.strip_prefix("```"))
    {
        inner
            .strip_suffix("```")
            .ok_or("Yanıt JSON kod bloğu tamamlanmamış")?
            .trim()
    } else {
        raw
    };
    let mut de = serde_json::Deserializer::from_str(raw);
    let StrictJson(value) = StrictJson::deserialize(&mut de)
        .map_err(|_| "Yanıt geçerli, benzersiz alanlı JSON değil")?;
    de.end().map_err(|_| "JSON dışında ek yanıt metni var")?;
    Ok(value)
}
struct StrictJson(Value);
impl<'de> Deserialize<'de> for StrictJson {
    fn deserialize<D: serde::Deserializer<'de>>(deserializer: D) -> Result<Self, D::Error> {
        struct Visitor;
        impl<'de> serde::de::Visitor<'de> for Visitor {
            type Value = Value;
            fn expecting(&self, f: &mut std::fmt::Formatter) -> std::fmt::Result {
                f.write_str("JSON with unique keys")
            }
            fn visit_bool<E: serde::de::Error>(self, v: bool) -> Result<Value, E> {
                Ok(json!(v))
            }
            fn visit_i64<E: serde::de::Error>(self, v: i64) -> Result<Value, E> {
                Ok(json!(v))
            }
            fn visit_u64<E: serde::de::Error>(self, v: u64) -> Result<Value, E> {
                Ok(json!(v))
            }
            fn visit_f64<E: serde::de::Error>(self, v: f64) -> Result<Value, E> {
                serde_json::Number::from_f64(v)
                    .map(Value::Number)
                    .ok_or_else(|| E::custom("Invalid number"))
            }
            fn visit_str<E: serde::de::Error>(self, v: &str) -> Result<Value, E> {
                Ok(json!(v))
            }
            fn visit_string<E: serde::de::Error>(self, v: String) -> Result<Value, E> {
                Ok(json!(v))
            }
            fn visit_unit<E: serde::de::Error>(self) -> Result<Value, E> {
                Ok(Value::Null)
            }
            fn visit_none<E: serde::de::Error>(self) -> Result<Value, E> {
                Ok(Value::Null)
            }
            fn visit_seq<A: serde::de::SeqAccess<'de>>(
                self,
                mut seq: A,
            ) -> Result<Value, A::Error> {
                let mut values = Vec::new();
                while let Some(StrictJson(value)) = seq.next_element()? {
                    values.push(value);
                }
                Ok(Value::Array(values))
            }
            fn visit_map<A: serde::de::MapAccess<'de>>(
                self,
                mut map: A,
            ) -> Result<Value, A::Error> {
                let mut values = serde_json::Map::new();
                while let Some(key) = map.next_key::<String>()? {
                    let StrictJson(value) = map.next_value()?;
                    if values.insert(key, value).is_some() {
                        return Err(serde::de::Error::custom("Duplicate key"));
                    }
                }
                Ok(Value::Object(values))
            }
        }
        deserializer.deserialize_any(Visitor).map(Self)
    }
}

/// Prefer attribution and uncertainty paragraphs, then relevant content; preserve exact text.
fn select_context(body: &str, budget: usize) -> String {
    let paragraphs: Vec<&str> = body
        .split("\n\n")
        .filter(|p| !p.trim().is_empty())
        .collect();
    let mut ranked: Vec<(usize, usize)> = paragraphs
        .iter()
        .enumerate()
        .map(|(i, p)| {
            let p = p.to_lowercase();
            let priority = if [
                "asistan",
                "kullanıcı",
                "kullanici",
                "beyan",
                "kabul edil",
                "açık soru",
                "belirsiz",
                "kaynak",
                "kanıt",
            ]
            .iter()
            .any(|w| p.contains(w))
            {
                0
            } else if [
                "yaşam",
                "özgür",
                "güven",
                "yapay zek",
                "ai ",
                "kaynak paylaş",
                "mülkiyet",
                "gelecek",
            ]
            .iter()
            .any(|w| p.contains(w))
            {
                1
            } else {
                2
            };
            (priority, i)
        })
        .collect();
    ranked.sort();
    let mut chosen = BTreeMap::new();
    let mut remaining = budget;
    for (_, i) in ranked {
        if remaining < 40 {
            break;
        }
        let p = paragraphs[i];
        let take = p
            .chars()
            .count()
            .min(remaining.saturating_sub(if chosen.is_empty() { 0 } else { 2 }));
        if take == 0 {
            continue;
        }
        let excerpt: String = p.chars().take(take).collect();
        remaining = remaining
            .saturating_sub(excerpt.chars().count() + if chosen.is_empty() { 0 } else { 2 });
        chosen.insert(i, excerpt);
    }
    chosen.into_values().collect::<Vec<_>>().join("\n\n")
}
fn keys(v: &Value, expected: &[&str]) -> Result<(), String> {
    let object = v.as_object().ok_or("Model alanı nesne olmalı")?;
    if object.len() != expected.len() || expected.iter().any(|k| !object.contains_key(*k)) {
        return Err("Model çıktı şeması geçersiz".into());
    }
    Ok(())
}
fn field(v: &Value, key: &str, max: usize) -> Result<(), String> {
    if !bounded(text(v, key)?, max) {
        return Err(format!("Model alanı boş veya çok uzun: {key}"));
    }
    Ok(())
}
fn evidence(v: &Value, sources: &[Source], confirmed: bool) -> Result<(), String> {
    let items = v.as_array().ok_or("Model kanıt listesi geçersiz")?;
    if items.is_empty() || items.len() > 12 {
        return Err("Model kanıt sayısı geçersiz".into());
    }
    let mut has_confirmed = false;
    for e in items {
        keys(e, &["sourceId", "quote"])?;
        let id = text(e, "sourceId")?;
        let quote = text(e, "quote")?;
        let source = sources
            .iter()
            .find(|s| s.id == id)
            .ok_or("Model bilinmeyen kaynak gösterdi")?;
        if !bounded(quote, 2000) || !source.text.contains(quote) {
            return Err("Model alıntısı gönderilen kaynakta birebir yok".into());
        }
        has_confirmed |= source.kind == "confirmed_card";
    }
    if confirmed && !has_confirmed {
        return Err("Rapor yorumu onaylı kullanıcı görüşünün yerine geçirilemez".into());
    }
    Ok(())
}
fn validate_legacy_analysis(a: &Value, sources: &[Source]) -> Result<(), String> {
    keys(
        a,
        &[
            "title",
            "summary",
            "pillars",
            "affinities",
            "tensions",
            "questions",
        ],
    )?;
    field(a, "title", 200)?;
    field(a, "summary", 5000)?;
    for name in ["pillars", "affinities", "tensions", "questions"] {
        let items = a[name].as_array().ok_or("Model listesi geçersiz")?;
        if items.len() > 12 || (name == "pillars" && items.is_empty()) {
            return Err("Model listesi boş veya çok uzun".into());
        }
        for item in items {
            match name {
                "pillars" | "tensions" => {
                    keys(item, &["title", "text", "evidence"])?;
                    field(item, "title", 200)?;
                    field(item, "text", 3000)?;
                    evidence(&item["evidence"], sources, name == "pillars")?;
                }
                "affinities" => {
                    keys(item, &["name", "why", "limits", "evidence"])?;
                    field(item, "name", 200)?;
                    field(item, "why", 3000)?;
                    field(item, "limits", 2000)?;
                    evidence(&item["evidence"], sources, true)?;
                }
                _ => {
                    keys(item, &["question", "why", "sourceIds"])?;
                    field(item, "question", 1000)?;
                    field(item, "why", 2000)?;
                    let ids = item["sourceIds"]
                        .as_array()
                        .ok_or("Soru kaynakları geçersiz")?;
                    if ids.is_empty()
                        || ids.len() > 12
                        || ids
                            .iter()
                            .any(|id| !sources.iter().any(|s| Some(s.id.as_str()) == id.as_str()))
                    {
                        return Err("Soru bilinmeyen veya eksik kaynak gösterdi".into());
                    }
                }
            }
        }
    }
    Ok(())
}
/// Every newly accepted result follows the former worker's strict source rules.
fn validate_analysis(a: &Value, sources: &[Source]) -> Result<(), String> {
    validate_legacy_analysis(a, sources)?;
    field(a, "summary", 4500)?;
    for (name, minimum, maximum) in [("pillars", 2, 4), ("affinities", 1, 3), ("tensions", 0, 2)] {
        let items = a[name].as_array().unwrap();
        if items.len() < minimum || items.len() > maximum {
            return Err("Sentezin bölüm sayısı şemayla eşleşmiyor".into());
        }
        for item in items {
            if name == "affinities" {
                field(item, "why", 2400)?;
                field(item, "limits", 2000)?;
            } else {
                field(item, "text", 2400)?;
            }
            let evidence = item["evidence"].as_array().unwrap();
            if evidence.len() > 3 {
                return Err("Bir bölümde en fazla üç alıntı olabilir".into());
            }
            for e in evidence {
                let quote = text(e, "quote")?;
                if quote.trim().chars().count() < 12 || quote.chars().count() > 800 {
                    return Err("Alıntı 12–800 karakter olmalı".into());
                }
                let source = sources
                    .iter()
                    .find(|s| Some(s.id.as_str()) == e["sourceId"].as_str())
                    .unwrap();
                if name != "tensions" && source.kind != "confirmed_card" {
                    return Err(
                        "Her temel görüş ve yakınlık alıntısı onaylı görüşten gelmeli".into(),
                    );
                }
            }
        }
    }
    let questions = a["questions"].as_array().unwrap();
    if questions.len() != 2 {
        return Err("Sentez tam iki açık soru içermeli".into());
    }
    for question in questions {
        if !text(question, "question")?.trim_end().ends_with('?')
            || question["sourceIds"].as_array().unwrap().len() > 3
        {
            return Err("Açık soru biçimi veya kaynak sayısı geçersiz".into());
        }
        field(question, "why", 1500)?;
    }
    Ok(())
}
fn validate_result(value: &Value) -> Result<(), String> {
    if !uuid(text(value, "id")?)
        || text(value, "inputHash")?.len() != 64
        || !value["engine"]["localOnly"].is_boolean()
    {
        return Err("Saklı ideoloji sonucu geçersiz".into());
    }
    let sources: Vec<Source> =
        serde_json::from_value(value["sources"].clone()).map_err(|_| "Saklı kaynaklar geçersiz")?;
    let mut ids = BTreeSet::new();
    for s in &sources {
        if !ids.insert(&s.id) || !["confirmed_card", "report_context"].contains(&s.kind.as_str()) {
            return Err("Saklı kaynak kimliği veya türü geçersiz".into());
        }
    }
    if value["engine"]["localOnly"] == true {
        // Historical 0.9 results remain readable; this does not authorize any local run.
        return validate_legacy_analysis(&value["analysis"], &sources);
    }
    let engine = &value["engine"];
    let target = Target {
        connection: text(engine, "connection")?.into(),
        developer: text(engine, "developer")?.into(),
        model_id: text(engine, "modelId")?.into(),
    };
    validate_target(&target)?;
    let manual = target.connection == "manual";
    if engine["costMode"] != cost_mode(&target)
        || engine["provenance"]
            != if manual {
                "user_attested"
            } else {
                "connector_verified"
            }
        || (manual && !engine["provider"].is_null())
        || (!manual && !engine["provider"].as_str().is_some_and(|p| bounded(p, 200)))
    {
        return Err("Saklı sentezin sağlayıcı bilgisi geçersiz".into());
    }
    validate_sources(&sources)?;
    validate_analysis(&value["analysis"], &sources)
}

#[cfg(test)]
mod tests {
    use super::*;
    fn dir() -> PathBuf {
        std::env::temp_dir()
            .canonicalize()
            .unwrap()
            .join(format!("tore-ideology-test-{}", uuid::Uuid::new_v4()))
    }
    fn setup() -> (PathBuf, Arc<Service>) {
        let p = dir();
        private_dir(&p).unwrap();
        let archive = p.join("archive");
        private_dir(&archive).unwrap();
        fs::write(
            archive.join("arsiv.json"),
            br#"{"schemaVersion":1,"reports":[]}"#,
        )
        .unwrap();
        let s = Service::open(p.join("data"), archive).unwrap();
        (p, s)
    }
    fn opinions() -> Value {
        json!({"cards":[{"id":"00000000-0000-4000-8000-000000000001","topic":"life","statement":"SENTETİK yaşam güvencesini önemsiyorum.","reason":"SENTETİK seçim imkânı.","positionIds":["basic"],"status":"confirmed"},{"id":"00000000-0000-4000-8000-000000000002","topic":"ai","statement":"ASLA_MODELE_GIRME","reason":"","positionIds":[],"status":"rejected"}],"catalog":{"positions":[{"id":"basic","topic":"life","label":"Temel imkânlar"}]}})
    }
    fn analysis(source: &Source) -> Value {
        let evidence =
            json!([{"sourceId":source.id,"quote":"SENTETİK yaşam güvencesini önemsiyorum."}]);
        json!({"title":"SENTETİK profil","summary":"SENTETİK koşullu değerlendirme.",
            "pillars":[{"title":"Güvence","text":"SENTETİK değerlendirme","evidence":evidence},{"title":"Seçim","text":"SENTETİK ikinci değerlendirme","evidence":evidence}],
            "affinities":[{"name":"SENTETİK karşılaştırma","why":"SENTETİK benzerlik","limits":"Bir programın benimsenmesi sayılmaz.","evidence":evidence}],
            "tensions":[],"questions":[{"question":"SENTETİK sınır nerede?","why":"Tasarım koşulu belirsiz.","sourceIds":[source.id]},{"question":"SENTETİK nasıl uygulanır?","why":"Uygulama koşulu belirsiz.","sourceIds":[source.id]}]})
    }
    fn add_report(s: &Service, id: &str, body: &str) {
        private_dir(&s.archive.join("raporlar")).unwrap();
        fs::write(s.archive.join(format!("raporlar/{id}.md")), body).unwrap();
        fs::write(s.archive.join("arsiv.json"),serde_json::to_vec(&json!({"schemaVersion":1,"reports":[{"id":id,"title":"SENTETİK rapor","path":format!("raporlar/{id}.md"),"sha256":digest(body.as_bytes()),"trashed":false}]})).unwrap()).unwrap();
    }
    fn prepared(s: &Service, connection: &str) -> Value {
        s.prepare(opinions(),json!({"target":{"connection":connection,"developer":"openai","modelId":if connection=="openrouter" { "openai/synthetic:free" } else { "synthetic" }}})).unwrap()["draft"].clone()
    }
    fn send_request(draft: &Value) -> Value {
        json!({"draftId":draft["id"],"draftHash":draft["hash"],"confirmed":true,"requestId":uuid::Uuid::new_v4().to_string()})
    }
    fn completion(draft: &Value) -> Completion {
        let sources: Vec<Source> = serde_json::from_value(draft["sources"].clone()).unwrap();
        Completion {
            text: analysis(&sources[0]).to_string(),
            model_id: draft["target"]["modelId"].as_str().unwrap().into(),
            developer: "openai".into(),
            provider: Some("SENTETİK provider".into()),
            usage: json!({"input_tokens":10,"output_tokens":20,"apiKey":"NEVER_KEEP_THIS"}),
        }
    }
    #[test]
    fn local_execution_is_disabled_even_with_valid_legacy_configuration() {
        let (p, s) = setup();
        fs::write(s.root.join("ideology-config.json"),r#"{"schemaVersion":1,"workerPath":"/bin/sh","pythonPath":"/bin/sh","runtimePath":"/bin/sh","modelPath":"/bin/sh","modelName":"must never start"}"#).unwrap();
        let preview = s.preview(opinions(), None).unwrap();
        let error=s.generate(opinions(),json!({"inputHash":preview["inputHash"],"confirmed":true,"requestId":uuid::Uuid::new_v4().to_string()})).unwrap_err();
        assert!(error.contains("Yerel model çalıştırma kapalı"));
        assert!(!s.root.join("ideology-jobs").exists());
        assert!(s.disk.lock().unwrap().data.job.is_none());
        drop(s);
        fs::remove_dir_all(p).unwrap();
    }
    #[test]
    fn reviewed_selection_and_redaction_bind_exact_prompt_without_original_values() {
        let (p, s) = setup();
        let mut input = opinions();
        input["cards"][0]["reason"] = json!("SENTETİK iletişim: synthetic@example.test");
        add_report(
            &s,
            "00000000-0000-4000-8000-000000000010",
            "SENTETİK DIŞARIDA_KALSIN raporu.",
        );
        let preview = s.preview(input.clone(), None).unwrap();
        assert_eq!(preview["findings"][0]["kind"], "E-posta");
        let target = json!({"connection":"manual","developer":"openai","modelId":"synthetic"});
        let blocked = s.prepare(input.clone(), json!({"target":target})).unwrap()["draft"].clone();
        assert_eq!(blocked["canSend"], false);
        let source = &preview["sources"][0];
        let cleaned = source["text"]
            .as_str()
            .unwrap()
            .replace("synthetic@example.test", "[E-POSTA]");
        let request = json!({"target":target,"sourceIds":[source["id"]],"edits":[{"id":source["id"],"text":cleaned}]});
        let ready = s.prepare(input.clone(), request.clone()).unwrap()["draft"].clone();
        assert_eq!(ready["canSend"], true);
        assert_eq!(ready["reportsCount"], 0);
        assert!(
            !ready["prompt"]
                .as_str()
                .unwrap()
                .contains("synthetic@example.test")
        );
        assert!(
            !ready["prompt"]
                .as_str()
                .unwrap()
                .contains("DIŞARIDA_KALSIN")
        );
        assert_ne!(ready["hash"], blocked["hash"]);
        assert_eq!(
            ready["id"],
            s.prepare(input.clone(), request).unwrap()["draft"]["id"]
        );
        assert!(
            input["cards"][0]["reason"]
                .as_str()
                .unwrap()
                .contains("synthetic@example.test")
        );
        assert!(
            s.prepare(input.clone(), json!({"target":target,"sourceIds":[]}))
                .is_err()
        );
        assert!(
            s.prepare(
                input.clone(),
                json!({"target":target,"sourceIds":[source["id"],source["id"]]})
            )
            .is_err()
        );
        assert!(
            s.prepare(
                input,
                json!({"target":target,"edits":[{"id":"unknown","text":"added"}]})
            )
            .is_err()
        );
        drop(s);
        fs::remove_dir_all(p).unwrap();
    }
    #[test]
    fn report_title_findings_cannot_bypass_review_by_editing_just_text() {
        let (p, s) = setup();
        let report_id = "00000000-0000-4000-8000-000000000010";
        add_report(&s, report_id, "SENTETİK tarihî tartışma raporu.");
        let manifest_path = s.archive.join("arsiv.json");
        let mut manifest: Value =
            serde_json::from_slice(&fs::read(&manifest_path).unwrap()).unwrap();
        manifest["reports"][0]["title"] =
            json!("synthetic@example.test /Users/synthetic/private.md");
        fs::write(manifest_path, serde_json::to_vec(&manifest).unwrap()).unwrap();
        let target = json!({"connection":"chatgpt","developer":"openai","modelId":"synthetic"});
        let blocked = s.prepare(opinions(), json!({"target":target,"edits":[{"id":format!("r-{report_id}"),"text":"SENTETİK temizlenmiş rapor metni."}]})).unwrap()["draft"].clone();
        assert_eq!(blocked["canSend"], false);
        for kind in ["E-posta", "Yerel dosya yolu"] {
            assert!(
                blocked["findings"]
                    .as_array()
                    .unwrap()
                    .iter()
                    .any(|f| f["field"] == "title" && f["kind"] == kind)
            );
        }
        assert!(s.start_send(opinions(), send_request(&blocked)).is_err());
        assert!(s.disk.lock().unwrap().data.job.is_none());
        let source_id = "c-00000000-0000-4000-8000-000000000001";
        let ready = s
            .prepare(opinions(), json!({"target":target,"sourceIds":[source_id]}))
            .unwrap()["draft"]
            .clone();
        assert_eq!(ready["canSend"], true);
        let (_, work) = s.start_send(opinions(), send_request(&ready)).unwrap();
        let work = work.unwrap();
        for secret in ["synthetic@example.test", "/Users/synthetic/private.md"] {
            assert!(!work.prompt.contains(secret));
        }
        let done = s.complete_work(&work.id, Ok(completion(&ready))).unwrap();
        assert_eq!(done["job"]["status"], "completed");
        for secret in ["synthetic@example.test", "/Users/synthetic/private.md"] {
            assert!(!done["latest"].to_string().contains(secret));
        }
        drop(s);
        fs::remove_dir_all(p).unwrap();
    }
    #[test]
    fn cloud_send_requires_current_consent_and_is_idempotent_across_restart() {
        let (p, s) = setup();
        let draft = prepared(&s, "chatgpt");
        let request = send_request(&draft);
        let mut no = request.clone();
        no["confirmed"] = json!(false);
        assert!(s.start_send(opinions(), no).is_err());
        let mut wrong = request.clone();
        wrong["draftHash"] = json!("old");
        assert!(s.start_send(opinions(), wrong).is_err());
        let mut changed = opinions();
        changed["cards"][0]["reason"] = json!("Yeni seçim");
        assert!(s.start_send(changed, request.clone()).is_err());
        assert!(s.disk.lock().unwrap().data.job.is_none());
        let (job, work) = s.start_send(opinions(), request.clone()).unwrap();
        let work = work.unwrap();
        assert_eq!(work.id, job["job"]["id"]);
        assert_eq!(work.connection, "chatgpt");
        assert!(!work.prompt.contains("ASLA_MODELE_GIRME"));
        assert!(
            s.start_send(opinions(), request.clone())
                .unwrap()
                .1
                .is_none()
        );
        let done = s.complete_work(&work.id, Ok(completion(&draft))).unwrap();
        assert_eq!(done["job"]["status"], "completed");
        assert_eq!(done["latest"]["engine"]["localOnly"], false);
        assert_eq!(done["latest"]["engine"]["provenance"], "connector_verified");
        assert!(!done["latest"].to_string().contains("NEVER_KEEP_THIS"));
        assert!(s.start_send(opinions(), send_request(&draft)).is_err());
        drop(s);
        let reopened = Service::open(p.join("data"), p.join("archive")).unwrap();
        assert_eq!(
            reopened.status(opinions(), None).unwrap()["latest"],
            done["latest"]
        );
        assert!(
            reopened
                .start_send(opinions(), request)
                .unwrap()
                .1
                .is_none()
        );
        drop(reopened);
        fs::remove_dir_all(p).unwrap();
    }
    #[test]
    fn manual_results_are_attested_and_cannot_overwrite_an_active_cloud_job() {
        let (p, s) = setup();
        let draft = prepared(&s, "manual");
        let mut request = send_request(&draft);
        request["text"] = json!(format!("```json\n{}\n```", completion(&draft).text));
        assert!(s.start_send(opinions(), send_request(&draft)).is_err());
        let cloud = prepared(&s, "chatgpt");
        let (_, work) = s.start_send(opinions(), send_request(&cloud)).unwrap();
        let work = work.unwrap();
        assert!(s.complete_manual(opinions(), request.clone()).is_err());
        s.complete_work(&work.id, Err("SENTETİK ağ hatası".into()))
            .unwrap();
        let done = s.complete_manual(opinions(), request.clone()).unwrap();
        assert_eq!(done["latest"]["engine"]["provenance"], "user_attested");
        assert!(done["latest"]["engine"]["provider"].is_null());
        assert_eq!(
            s.complete_manual(opinions(), request.clone()).unwrap()["job"]["id"],
            done["job"]["id"]
        );
        request["text"] = json!(completion(&draft).text);
        assert!(s.complete_manual(opinions(), request).is_err());
        drop(s);
        let reopened = Service::open(p.join("data"), p.join("archive")).unwrap();
        assert_eq!(
            reopened.status(opinions(), None).unwrap()["latest"],
            done["latest"]
        );
        drop(reopened);
        fs::remove_dir_all(p).unwrap();
    }
    #[test]
    fn new_result_validation_rejects_short_quotes_mixed_report_evidence_and_duplicate_json() {
        let (p, s) = setup();
        let snap = s.snapshot(&opinions(), None).unwrap();
        let good = analysis(&snap.sources[0]);
        let mut bad = good.clone();
        bad["pillars"][0]["evidence"][0]["quote"] = json!("SENTETİK");
        assert!(validate_analysis(&bad, &snap.sources).is_err());
        let mut sources = snap.sources.clone();
        sources.push(Source {
            id: "r-00000000-0000-4000-8000-000000000010".into(),
            kind: "report_context".into(),
            title: "SENTETİK rapor".into(),
            text: "SENTETİK tarihî rapor cümlesi.".into(),
        });
        bad = good.clone();
        bad["pillars"][0]["evidence"]
            .as_array_mut()
            .unwrap()
            .push(json!({"sourceId":sources[1].id,"quote":sources[1].text}));
        assert!(validate_analysis(&bad, &sources).is_err());
        bad = good.clone();
        bad["questions"][0]["question"] = json!("Soru değil.");
        assert!(validate_analysis(&bad, &sources).is_err());
        bad = good.clone();
        bad["affinities"] = json!([]);
        assert!(validate_analysis(&bad, &sources).is_err());
        assert!(parse_analysis(r#"{"title":"first","title":"second"}"#).is_err());
        assert!(parse_analysis("{} trailing").is_err());
        assert!(parse_analysis(&format!("```json\n{good}\n```")).is_ok());
        drop(s);
        fs::remove_dir_all(p).unwrap();
    }
    #[test]
    fn failure_preserves_previous_result_and_changed_sources_mark_snapshot_stale() {
        let (p, s) = setup();
        let draft = prepared(&s, "chatgpt");
        let (_, work) = s.start_send(opinions(), send_request(&draft)).unwrap();
        let done = s
            .complete_work(&work.unwrap().id, Ok(completion(&draft)))
            .unwrap();
        let second = prepared(&s, "chatgpt");
        let (_, work) = s.start_send(opinions(), send_request(&second)).unwrap();
        let mut bad = completion(&second);
        bad.model_id = "wrong".into();
        let failed = s.complete_work(&work.unwrap().id, Ok(bad)).unwrap();
        assert_eq!(failed["job"]["status"], "failed");
        assert_eq!(failed["latest"], done["latest"]);
        let third = prepared(&s, "chatgpt");
        let (_, work) = s.start_send(opinions(), send_request(&third)).unwrap();
        s.complete_work(&work.unwrap().id, Ok(completion(&third)))
            .unwrap();
        let mut changed = opinions();
        changed["cards"][0]["reason"] = json!("Sonraki görüş değişikliği");
        assert_eq!(s.status(changed, None).unwrap()["stale"], true);
        drop(s);
        fs::remove_dir_all(p).unwrap();
    }
    #[test]
    fn interrupted_cloud_work_is_not_reissued_and_legacy_results_stay_readable() {
        let (p, s) = setup();
        let draft = prepared(&s, "openrouter");
        let request = send_request(&draft);
        s.start_send(opinions(), request.clone()).unwrap();
        drop(s);
        let reopened = Service::open(p.join("data"), p.join("archive")).unwrap();
        let (status, work) = reopened.start_send(opinions(), request).unwrap();
        assert!(work.is_none());
        assert_eq!(status["job"]["status"], "interrupted");
        let snap = reopened.snapshot(&opinions(), None).unwrap();
        let mut old = analysis(&snap.sources[0]);
        old["pillars"].as_array_mut().unwrap().truncate(1);
        old["affinities"] = json!([]);
        old["questions"] = json!([]);
        assert!(validate_analysis(&old, &snap.sources).is_err());
        let result = json!({"id":uuid::Uuid::new_v4().to_string(),"inputHash":snap.hash,"engine":{"name":"old local model","localOnly":true},"analysis":old,"sources":snap.sources});
        assert!(validate_result(&result).is_ok());
        drop(reopened);
        let legacy = json!({"schemaVersion":1,"latest":result,"history":[],"job":null});
        fs::write(
            p.join("data/ideology-v1.json"),
            serde_json::to_vec(&legacy).unwrap(),
        )
        .unwrap();
        let reopened = Service::open(p.join("data"), p.join("archive")).unwrap();
        assert_eq!(reopened.status(opinions(), None).unwrap()["latest"], result);
        drop(reopened);
        fs::remove_dir_all(p).unwrap();
    }
    #[tokio::test]
    async fn preview_is_local_excludes_unapproved_and_detects_stale() {
        let (p, s) = setup();
        let a = s.preview(opinions(), None).unwrap();
        assert_eq!(a["confirmedCount"], 1);
        assert_eq!(a["excludedCount"], 1);
        assert_eq!(a["engine"]["localOnly"], false);
        assert_eq!(a["engine"]["localInferenceDisabled"], true);
        assert_eq!(a["engine"]["ready"], false);
        assert!(!a["sources"].to_string().contains("ASLA_MODELE_GIRME"));
        let snap = s.snapshot(&opinions(), None).unwrap();
        let result = json!({"id":uuid::Uuid::new_v4().to_string(),"inputHash":snap.hash,"createdAt":now(),"engine":{"name":"synthetic","localOnly":true},"coverage":{"confirmedCount":1,"reportsCount":0},"analysis":analysis(&snap.sources[0]),"sources":snap.sources});
        {
            let mut d = s.disk.lock().unwrap();
            let mut next = d.data.clone();
            next.latest = Some(result.clone());
            s.commit(&mut d, next).unwrap();
        }
        assert_eq!(s.status(opinions(), None).unwrap()["stale"], false);
        let mut changed = opinions();
        changed["cards"][0]["reason"] = json!("Yeni gerekçe");
        assert_eq!(s.status(changed, None).unwrap()["stale"], true);
        drop(s);
        let reopened = Service::open(p.join("data"), p.join("archive")).unwrap();
        assert_eq!(reopened.disk.lock().unwrap().data.latest, Some(result));
        drop(reopened);
        fs::remove_dir_all(p).unwrap();
    }
    #[test]
    fn report_selection_is_bounded_context_and_hash_checked() {
        let (p, s) = setup();
        let id = "00000000-0000-4000-8000-000000000010";
        let body = format!(
            "# SENTETİK\n\nAsistan önerisi; kullanıcı kabulü değildir.\n\nAçık soru: hangi koşul?\n\n{}",
            "Yaşam ve yapay zekâ bağlamı. ".repeat(250)
        );
        add_report(&s, id, &body);
        let a = s.snapshot(&opinions(), None).unwrap();
        assert_eq!(a.sources[1].kind, "report_context");
        assert!(a.sources[1].text.chars().count() <= 1800);
        assert!(a.sources[1].text.contains("kullanıcı kabulü değildir"));
        assert!(
            a.reports[0]["totalCharacters"].as_u64().unwrap()
                > a.reports[0]["includedCharacters"].as_u64().unwrap()
        );
        let b = s.snapshot(&opinions(), Some(vec![])).unwrap();
        assert_eq!(b.sources.len(), 1);
        assert_ne!(a.hash, b.hash);
        fs::write(s.archive.join(format!("raporlar/{id}.md")), "DEĞİŞTİ").unwrap();
        assert!(s.snapshot(&opinions(), None).is_err());
        drop(s);
        fs::remove_dir_all(p).unwrap();
    }
    #[test]
    fn larger_archive_keeps_catalog_reachable_and_requires_report_selection() {
        let (p, s) = setup();
        private_dir(&s.archive.join("raporlar")).unwrap();
        let body = "SENTETİK rapor: asistan yorumu, onaylı kullanıcı görüşü değildir.";
        let mut records = vec![];
        let mut ids = vec![];
        for _ in 0..9 {
            let id = uuid::Uuid::new_v4().to_string();
            let path = format!("raporlar/{id}.md");
            fs::write(s.archive.join(&path), body).unwrap();
            records.push(json!({"id":id,"title":"SENTETİK rapor","path":path,"sha256":digest(body.as_bytes()),"trashed":false}));
            ids.push(id);
        }
        fs::write(
            s.archive.join("arsiv.json"),
            serde_json::to_vec(&json!({"schemaVersion":1,"reports":records})).unwrap(),
        )
        .unwrap();
        let preview = s.preview(opinions(), None).unwrap();
        assert_eq!(preview["reports"].as_array().unwrap().len(), 9);
        assert!(
            preview["reports"]
                .as_array()
                .unwrap()
                .iter()
                .all(|r| r["selected"] == false)
        );
        assert_eq!(preview["sources"].as_array().unwrap().len(), 1);
        assert!(
            preview["scopeMessage"]
                .as_str()
                .unwrap()
                .contains("en fazla 8 rapor seç")
        );
        let selected = s.preview(opinions(), Some(vec![ids[0].clone()])).unwrap();
        assert_eq!(selected["sources"].as_array().unwrap().len(), 2);
        assert!(selected["scopeMessage"].is_null());
        assert_ne!(preview["inputHash"], selected["inputHash"]);
        assert!(s.preview(opinions(), Some(ids)).is_err());
        drop(s);
        fs::remove_dir_all(p).unwrap();
    }
    #[test]
    fn malicious_paths_symlinks_and_oversized_cards_fail_closed() {
        let (p, s) = setup();
        let id = "00000000-0000-4000-8000-000000000010";
        add_report(&s, id, "SENTETİK");
        let path = s.archive.join("arsiv.json");
        let original = fs::read(&path).unwrap();
        let mut m: Value = serde_json::from_slice(&original).unwrap();
        m["reports"][0]["path"] = json!("../../outside.md");
        fs::write(&path, serde_json::to_vec(&m).unwrap()).unwrap();
        assert!(s.snapshot(&opinions(), None).is_err());
        fs::write(&path, original).unwrap();
        #[cfg(unix)]
        {
            let report = s.archive.join(format!("raporlar/{id}.md"));
            fs::remove_file(&report).unwrap();
            std::os::unix::fs::symlink(s.archive.join("arsiv.json"), report).unwrap();
            assert!(s.snapshot(&opinions(), None).is_err());
        }
        let mut too_big = opinions();
        too_big["cards"][0]["statement"] = json!("x".repeat(23_000));
        assert!(s.snapshot(&too_big, Some(vec![])).is_err());
        drop(s);
        fs::remove_dir_all(p).unwrap();
    }
    #[test]
    fn citations_must_be_exact_and_reports_cannot_become_beliefs() {
        let (p, s) = setup();
        let snap = s.snapshot(&opinions(), None).unwrap();
        let good = analysis(&snap.sources[0]);
        assert!(validate_analysis(&good, &snap.sources).is_ok());
        let mut bad = good.clone();
        bad["pillars"][0]["evidence"][0]["quote"] = json!("Uydurulmuş alıntı");
        assert!(validate_analysis(&bad, &snap.sources).is_err());
        bad = good.clone();
        bad["pillars"][0]["evidence"][0]["sourceId"] = json!("missing");
        assert!(validate_analysis(&bad, &snap.sources).is_err());
        let mut report = snap.sources.clone();
        report[0].kind = "report_context".into();
        assert!(validate_analysis(&good, &report).is_err());
        bad = good;
        bad["unsupportedField"] = json!(true);
        assert!(validate_analysis(&bad, &snap.sources).is_err());
        drop(s);
        fs::remove_dir_all(p).unwrap();
    }
    #[tokio::test]
    async fn no_confirmation_or_changed_input_never_starts_and_restart_interrupts() {
        let (p, s) = setup();
        let a = s.preview(opinions(), None).unwrap();
        assert!(s.generate(opinions(),json!({"inputHash":a["inputHash"],"confirmed":false,"requestId":uuid::Uuid::new_v4().to_string()})).is_err());
        assert!(s.generate(opinions(),json!({"inputHash":"old","confirmed":true,"requestId":uuid::Uuid::new_v4().to_string()})).is_err());
        {
            let mut d = s.disk.lock().unwrap();
            let mut next = d.data.clone();
            next.job = Some(
                json!({"id":uuid::Uuid::new_v4().to_string(),"requestId":uuid::Uuid::new_v4().to_string(),"status":"running","inputHash":a["inputHash"]}),
            );
            s.commit(&mut d, next).unwrap();
        }
        drop(s);
        let s = Service::open(p.join("data"), p.join("archive")).unwrap();
        assert_eq!(
            s.disk.lock().unwrap().data.job.as_ref().unwrap()["status"],
            "interrupted"
        );
        drop(s);
        fs::remove_dir_all(p).unwrap();
    }
    #[test]
    fn corrupt_store_and_external_mutation_never_overwrite() {
        let (p, s) = setup();
        {
            let mut d = s.disk.lock().unwrap();
            s.commit(&mut d, Stored::default()).unwrap();
        }
        fs::write(s.root.join("ideology-v1.json"), "corrupt").unwrap();
        {
            let mut d = s.disk.lock().unwrap();
            assert!(s.commit(&mut d, Stored::default()).is_err());
            assert!(!d.healthy);
        }
        drop(s);
        assert!(Service::open(p.join("data"), p.join("archive")).is_err());
        assert_eq!(
            fs::read_to_string(p.join("data/ideology-v1.json")).unwrap(),
            "corrupt"
        );
        fs::remove_dir_all(p).unwrap();
    }
}
