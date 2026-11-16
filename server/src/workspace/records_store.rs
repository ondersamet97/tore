//! Bounded, locked, atomic sidecar storage and local rollback snapshots.
use super::*;
use fs2::FileExt;
use std::{
    fs::{self, File, OpenOptions},
    io::{Read, Write},
    path::{Path, PathBuf},
};
const MAX_BYTES: u64 = 32 * 1024 * 1024;

fn no_symlinks(path: &Path) -> Result<(), String> {
    for p in path.ancestors() {
        match fs::symlink_metadata(p) {
            Ok(m) if m.file_type().is_symlink() => {
                return Err("Konu deposunda sembolik bağlantı kullanılamaz".into());
            }
            Err(e) if e.kind() != std::io::ErrorKind::NotFound => {
                return Err("Konu deposu yolu okunamadı".into());
            }
            _ => {}
        }
    }
    Ok(())
}
fn options() -> OpenOptions {
    let mut o = OpenOptions::new();
    o.read(true).write(true);
    #[cfg(unix)]
    {
        use std::os::unix::fs::OpenOptionsExt;
        o.mode(0o600).custom_flags(libc::O_NOFOLLOW);
    }
    o
}
fn directory(path: &Path) -> Result<(), String> {
    no_symlinks(path)?;
    fs::create_dir_all(path).map_err(|_| "Konu deposu dizini açılamadı")?;
    #[cfg(unix)]
    {
        use std::os::unix::fs::PermissionsExt;
        fs::set_permissions(path, fs::Permissions::from_mode(0o700))
            .map_err(|_| "Konu deposu izinleri ayarlanamadı")?;
    }
    Ok(())
}
fn read(path: &Path) -> Result<Option<Vec<u8>>, String> {
    no_symlinks(path)?;
    let mut opts = OpenOptions::new();
    opts.read(true);
    #[cfg(unix)]
    {
        use std::os::unix::fs::OpenOptionsExt;
        opts.custom_flags(libc::O_NOFOLLOW);
    }
    let f = match opts.open(path) {
        Ok(f) => f,
        Err(e) if e.kind() == std::io::ErrorKind::NotFound => return Ok(None),
        Err(_) => return Err("Konu dosyası okunamadı".into()),
    };
    let meta = f.metadata().map_err(|_| "Konu dosyası bilgisi alınamadı")?;
    if !meta.is_file() || meta.len() > MAX_BYTES {
        return Err("Konu dosyası boyutu veya türü geçersiz".into());
    }
    let mut bytes = Vec::new();
    f.take(MAX_BYTES + 1)
        .read_to_end(&mut bytes)
        .map_err(|_| "Konu dosyası okunamadı")?;
    if bytes.len() as u64 > MAX_BYTES {
        return Err("Konu dosyası sınırı aşıldı".into());
    }
    Ok(Some(bytes))
}

pub struct Disk {
    root: PathBuf,
    _lock: File,
    pub(super) data: Store,
    hash: Option<String>,
    healthy: bool,
}
#[derive(Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
struct Backup {
    schema_version: u32,
    id: String,
    created_at: String,
    state_hash: String,
    data: Store,
}
impl Disk {
    pub fn open(root: PathBuf) -> Result<Self, String> {
        directory(&root)?;
        let lock = options()
            .create(true)
            .truncate(false)
            .open(root.join("records.lock"))
            .map_err(|_| "Konu deposu kilidi açılamadı")?;
        lock.try_lock_exclusive()
            .map_err(|_| "Konu deposu başka bir Töre sürecinde açık")?;
        let bytes = read(&root.join("records-v1.json"))?;
        let data = match &bytes {
            Some(bytes) => {
                serde_json::from_slice(bytes).map_err(|_| "Konu deposu bozuk; sıfırlanmadı")?
            }
            None => Store::default(),
        };
        validate_store(&data)?;
        Ok(Self {
            root,
            _lock: lock,
            data,
            hash: bytes.map(|b| digest(&b)),
            healthy: true,
        })
    }
    pub(super) fn check(&self) -> Result<(), String> {
        if !self.healthy {
            return Err("Konu deposu yazma hatasından sonra kilitlendi; yeniden açın".into());
        }
        if read(&self.root.join("records-v1.json"))?.map(|b| digest(&b)) != self.hash {
            return Err("Konu deposu dışarıdan değişmiş; üzerine yazılmadı".into());
        }
        Ok(())
    }
    pub(super) fn commit(&mut self, next: Store) -> Result<(), String> {
        self.check()?;
        validate_store(&next)?;
        let bytes = serde_json::to_vec(&next).map_err(|_| "Konu deposu kodlanamadı")?;
        if bytes.len() as u64 > MAX_BYTES {
            return Err("Konu deposu boyut sınırı aşıldı".into());
        }
        let path = self.root.join("records-v1.json");
        let temp = self.root.join(format!(".records-{}.tmp", id()));
        let result = (|| {
            let mut f = options()
                .create_new(true)
                .open(&temp)
                .map_err(|_| "Geçici konu dosyası açılamadı")?;
            f.write_all(&bytes)
                .and_then(|_| f.sync_all())
                .map_err(|_| "Konu kaydı yazılamadı")?;
            self.check()?;
            fs::rename(&temp, &path).map_err(|_| "Konu kaydı atomik tamamlanamadı")?;
            File::open(&self.root)
                .and_then(|f| f.sync_all())
                .map_err(|_| "Konu kaydının kalıcılığı doğrulanamadı")?;
            Ok::<(), String>(())
        })();
        if result.is_err() {
            self.healthy = false;
            let _ = fs::remove_file(temp);
        }
        result?;
        self.hash = Some(digest(&bytes));
        self.data = next;
        Ok(())
    }
    pub fn backup(&self) -> Result<Value, String> {
        self.check()?;
        let dir = self.root.join("records-backups");
        directory(&dir)?;
        if self.backups()?.len() >= 100 {
            return Err("100 yerel yedek sınırına ulaşıldı; mevcut yedekler korunuyor".into());
        }
        let backup = Backup {
            schema_version: 1,
            id: id(),
            created_at: now(),
            state_hash: hash(&self.data)?,
            data: self.data.clone(),
        };
        let bytes = serde_json::to_vec(&backup).map_err(|_| "Yedek kodlanamadı")?;
        if bytes.len() as u64 > MAX_BYTES {
            return Err("Yedek boyutu sınırı aşıldı".into());
        }
        let final_path = dir.join(format!("{}.json", backup.id));
        let temp = dir.join(format!(".{}.tmp", backup.id));
        let result = (|| {
            let mut file = options()
                .create_new(true)
                .open(&temp)
                .map_err(|_| "Yedek açılamadı")?;
            file.write_all(&bytes)
                .and_then(|_| file.sync_all())
                .map_err(|_| "Yedek yazılamadı")?;
            fs::rename(&temp, &final_path).map_err(|_| "Yedek tamamlanamadı")?;
            File::open(&dir)
                .and_then(|f| f.sync_all())
                .map_err(|_| "Yedek kalıcılığı doğrulanamadı")?;
            Ok::<(), String>(())
        })();
        if result.is_err() {
            let _ = fs::remove_file(temp);
        }
        result?;
        // Read back the committed file before advertising a recoverable snapshot.
        self.read_backup(&backup.id)?;
        Ok(
            json!({"backupId":backup.id,"stateHash":backup.state_hash,"createdAt":backup.created_at}),
        )
    }
    fn read_backup(&self, backup_id: &str) -> Result<Backup, String> {
        let canonical = uuid::Uuid::parse_str(backup_id)
            .map_err(|_| "Yedek kimliği geçersiz")?
            .to_string();
        if canonical != backup_id {
            return Err("Yedek kimliği geçersiz".into());
        }
        let bytes = read(
            &self
                .root
                .join("records-backups")
                .join(format!("{}.json", canonical)),
        )?
        .ok_or("Yedek bulunamadı")?;
        let backup: Backup = serde_json::from_slice(&bytes)
            .map_err(|_| "Yedek bozuk; mevcut veriler değiştirilmedi")?;
        if backup.schema_version != 1
            || backup.id != canonical
            || backup.state_hash != hash(&backup.data)?
        {
            return Err("Yedek bütünlüğü doğrulanamadı; mevcut veriler değiştirilmedi".into());
        }
        validate_store(&backup.data)?;
        Ok(backup)
    }
    pub(super) fn backups(&self) -> Result<Vec<Value>, String> {
        let dir = self.root.join("records-backups");
        no_symlinks(&dir)?;
        let entries = match fs::read_dir(&dir) {
            Ok(x) => x,
            Err(e) if e.kind() == std::io::ErrorKind::NotFound => return Ok(vec![]),
            Err(_) => return Err("Yedek listesi okunamadı".into()),
        };
        let mut list = vec![];
        for entry in entries.take(201) {
            let entry = entry.map_err(|_| "Yedek listesi okunamadı")?;
            let name = entry.file_name().to_string_lossy().to_string();
            if let Some(id) = name.strip_suffix(".json") {
                if uuid::Uuid::parse_str(id).is_err() {
                    continue;
                }
                // Listing must not deserialize up to 100 full snapshots on an
                // M1 merely to render a menu. Restore always validates content.
                let metadata =
                    fs::symlink_metadata(entry.path()).map_err(|_| "Yedek bilgisi okunamadı")?;
                let safe_file = metadata.is_file()
                    && !metadata.file_type().is_symlink()
                    && metadata.len() <= MAX_BYTES;
                let timestamp = metadata
                    .modified()
                    .ok()
                    .map(|time| chrono::DateTime::<chrono::Utc>::from(time).to_rfc3339());
                list.push(json!({"id":id,"backupId":id,"createdAt":timestamp,"valid":if safe_file {Value::Null}else{json!(false)},"validationStatus":if safe_file {"not_checked"}else{"invalid"}}));
            }
        }
        list.sort_by(|a, b| b["createdAt"].as_str().cmp(&a["createdAt"].as_str()));
        Ok(list)
    }
    pub fn restore(
        &mut self,
        input: Value,
        conversations: &BTreeMap<String, Conversation>,
    ) -> Result<Value, String> {
        #[derive(Deserialize)]
        #[serde(rename_all = "camelCase", deny_unknown_fields)]
        struct Restore {
            backup_id: String,
            expected_state_hash: String,
            confirmed_by_user: bool,
        }
        self.check()?;
        let r: Restore = decode(input)?;
        if !r.confirmed_by_user {
            return Err("Geri alma açık kullanıcı onayı gerektirir".into());
        }
        if r.expected_state_hash != hash(&self.data)? {
            return Err("Konu deposu değişti; geri alma önizlemesini yenileyin".into());
        }
        let backup = self.read_backup(&r.backup_id)?;
        validate_sources(&backup.data, conversations)?;
        let previous = self.backup()?;
        self.commit(backup.data)?;
        Ok(
            json!({"restored":true,"restoredBackupId":r.backup_id,"backupId":previous["backupId"],"stateHash":hash(&self.data)?}),
        )
    }
}

pub(super) fn validate_sources(
    store: &Store,
    conversations: &BTreeMap<String, Conversation>,
) -> Result<(), String> {
    for link in store.conversation_links.values() {
        let conversation = conversations
            .get(&link.conversation_id)
            .ok_or("Yedekteki konu konuşması mevcut kasada yok")?;
        if conversation.provider != link.provider
            || conversation.title != link.title
            || conversation.created_at != link.source_created_at
            || conversation.updated_at != link.source_updated_at
        {
            return Err("Konu konuşması kaynak bilgisi değişmiş".into());
        }
        if let Some(source) = &link.last_user_source {
            let message = conversation
                .messages
                .iter()
                .find(|m| Some(&m.id) == source.message_id.as_ref())
                .ok_or("Konu konuşmasının kaynak mesajı yok")?;
            if message.role != "user"
                || !message.text.contains(&source.excerpt)
                || message.timestamp != source.timestamp
                || source.provider != conversation.provider
                || source.title != conversation.title
                || message.phase.as_deref().is_some_and(|p| {
                    [
                        "analysis",
                        "reasoning",
                        "thoughts",
                        "summary",
                        "justify",
                        "confidence",
                        "tool",
                    ]
                    .contains(&p)
                })
            {
                return Err("Konu konuşmasının kullanıcı alıntısı doğrulanamadı".into());
            }
        }
    }
    for record in store.records.values() {
        if let Some(source) = &record.source {
            match source.kind.as_str() {
                "conversation" => {
                    let c = source
                        .conversation_id
                        .as_ref()
                        .and_then(|id| conversations.get(id))
                        .ok_or(
                            "Yedek kaynağı mevcut konuşma kasasında yok; geri alma durduruldu",
                        )?;
                    let m = c
                        .messages
                        .iter()
                        .find(|m| Some(&m.id) == source.message_id.as_ref())
                        .ok_or("Yedek kaynak mesajı bulunamadı")?;
                    if m.role != source.role
                        || !m.text.contains(&source.excerpt)
                        || c.provider != source.provider
                        || m.timestamp != source.timestamp
                        || m.phase
                            .as_deref()
                            .is_some_and(|p| ["analysis", "reasoning", "tool"].contains(&p))
                    {
                        return Err("Yedek alıntısı veya konuşmacısı kaynakla eşleşmiyor".into());
                    }
                }
                "reply" => {
                    let r = source
                        .reply_id
                        .as_ref()
                        .and_then(|id| store.replies.get(id))
                        .ok_or("Yedek AI yorum kaynağı bulunamadı")?;
                    if r.topic_id != record.topic_id
                        || r.validation_status == "invalid"
                        || source.role != "assistant"
                        || !r.commentary.contains(&source.excerpt)
                    {
                        return Err("Yedek AI yorum alıntısı uyuşmuyor".into());
                    }
                }
                _ => return Err("Yedek kaynak türü desteklenmiyor".into()),
            }
        }
    }
    Ok(())
}
