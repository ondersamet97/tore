//! Private, reviewed opinions. Reading a source never adopts a political view.
use super::{policy::digest, types::Conversation};
use fs2::FileExt;
use serde::{Deserialize, Serialize};
use serde_json::{Value, json};
use std::{
    collections::{BTreeMap, BTreeSet},
    fs::{self, File, OpenOptions},
    io::Write,
    path::{Path, PathBuf},
};

const MAX_BYTES: u64 = 32 * 1024 * 1024;

/// These are deliberately narrow editorial comparisons, not a validated scale.
pub fn catalog() -> Value {
    json!({
        "version":1,
        "method":"Katalogda yalnız bir SENTETİK örnek var: konu, ilke ve gelenek kartlarının nasıl göründüğünü gösterir; kimsenin görüşü değildir. Yalnız onayladığın kartlarda seçtiğin ilkeler karşılaştırılır.",
        "topics":[
            {"id":"life","label":"SENTETİK örnek konu: mahalle kütüphanesi","question":"SENTETİK örnek: Mahalle kütüphanesi hafta sonları açık olmalı mı?"}
        ],
        "positions":[
            {"id":"life_basic","topic":"life","label":"SENTETİK örnek ilke: kütüphane hafta sonu açık olmalı","description":"SENTETİK örnek: Bu ilke, kartların nasıl çalıştığını göstermek için yazıldı; kimsenin görüşü değildir.","traditionIds":["capability"]}
        ],
        "traditions":[
            {"id":"capability","label":"SENTETİK örnek gelenek","description":"SENTETİK örnek: Bir ilkenin bir düşünce geleneğiyle nasıl karşılaştırıldığını gösterir.","limits":"Bu örnek gerçek bir düşünce geleneğini temsil etmez."}
        ]
    })
}

#[derive(Clone, Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct Source {
    pub conversation_id: String,
    pub message_id: String,
    pub excerpt: String,
    pub conversation_title: String,
    pub provider: String,
    pub role: String,
    pub timestamp: Option<String>,
}

#[derive(Clone, Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct Revision {
    pub revision: u32,
    pub statement: String,
    pub reason: String,
    pub position_ids: Vec<String>,
    pub status: String,
    pub changed_at: String,
    pub change_type: String,
    pub change_reason: String,
}

#[derive(Clone, Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct Card {
    pub id: String,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub creation_request_hash: Option<String>,
    pub topic: String,
    pub statement: String,
    pub reason: String,
    pub source: Option<Source>,
    pub attribution: String,
    pub position_ids: Vec<String>,
    pub status: String,
    pub revision: u32,
    pub created_at: String,
    pub updated_at: String,
    pub history: Vec<Revision>,
}

#[derive(Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
struct Store {
    schema_version: u32,
    cards: BTreeMap<String, Card>,
}
impl Default for Store {
    fn default() -> Self {
        Self {
            schema_version: 1,
            cards: BTreeMap::new(),
        }
    }
}

#[derive(Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
struct SourceInput {
    conversation_id: String,
    message_id: String,
    excerpt: String,
}
#[derive(Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
struct Create {
    #[serde(default, skip_serializing)]
    request_id: Option<String>,
    topic: String,
    statement: String,
    reason: String,
    source: Option<SourceInput>,
    attribution: String,
    position_ids: Vec<String>,
}
#[derive(Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
struct Review {
    id: String,
    expected_revision: u32,
    statement: String,
    reason: String,
    position_ids: Vec<String>,
    status: String,
    change_type: String,
    change_reason: String,
    #[serde(default)]
    confirmed_by_user: bool,
}

fn bounded(text: &str, max: usize, required: bool) -> bool {
    text.len() <= max && (!required || !text.trim().is_empty()) && !text.contains('\0')
}
fn validate_content(
    topic: &str,
    statement: &str,
    reason: &str,
    positions: &[String],
) -> Result<(), String> {
    if topic != "life" {
        return Err("Konu geçersiz".into());
    }
    if !bounded(statement, 6000, true) || !bounded(reason, 6000, false) {
        return Err("Görüş boş olamaz; görüş ve gerekçe en fazla 6000 bayt olmalı".into());
    }
    let known = catalog();
    let mut seen = BTreeSet::new();
    for id in positions {
        if !seen.insert(id)
            || !known["positions"]
                .as_array()
                .unwrap()
                .iter()
                .any(|p| p["id"] == *id && p["topic"] == topic)
        {
            return Err("İlke bu konuyla eşleşmiyor veya yinelenmiş".into());
        }
    }
    Ok(())
}
fn no_symlinks(path: &Path) -> Result<(), String> {
    for p in path.ancestors() {
        if fs::symlink_metadata(p).is_ok_and(|m| m.file_type().is_symlink()) {
            return Err("Görüş deposu yolu sembolik bağ içeremez".into());
        }
    }
    Ok(())
}
fn private_options() -> OpenOptions {
    let mut o = OpenOptions::new();
    o.read(true).write(true);
    #[cfg(unix)]
    {
        use std::os::unix::fs::OpenOptionsExt;
        o.mode(0o600).custom_flags(libc::O_NOFOLLOW);
    }
    o
}

pub struct Disk {
    root: PathBuf,
    _lock: File,
    data: Store,
    hash: Option<String>,
    healthy: bool,
}
impl Disk {
    pub fn open(root: PathBuf) -> Result<Self, String> {
        no_symlinks(&root)?;
        fs::create_dir_all(&root).map_err(|_| "Görüş deposu açılamadı")?;
        #[cfg(unix)]
        {
            use std::os::unix::fs::PermissionsExt;
            fs::set_permissions(&root, fs::Permissions::from_mode(0o700))
                .map_err(|_| "Görüş deposu izinleri ayarlanamadı")?;
        }
        let lock = private_options()
            .create(true)
            .truncate(false)
            .open(root.join("opinions.lock"))
            .map_err(|_| "Görüş kilidi açılamadı")?;
        lock.try_lock_exclusive()
            .map_err(|_| "Görüş deposu başka bir Töre sürecinde açık")?;
        let path = root.join("opinions-v1.json");
        no_symlinks(&path)?;
        let bytes = match fs::metadata(&path) {
            Ok(m) if m.len() <= MAX_BYTES => {
                Some(fs::read(&path).map_err(|_| "Görüş deposu okunamadı")?)
            }
            Ok(_) => return Err("Görüş deposu boyut sınırı aşıldı".into()),
            Err(e) if e.kind() == std::io::ErrorKind::NotFound => None,
            Err(_) => return Err("Görüş deposu okunamadı".into()),
        };
        let data: Store = match &bytes {
            Some(b) => serde_json::from_slice(b).map_err(|_| "Görüş deposu bozuk; sıfırlanmadı")?,
            None => Store::default(),
        };
        if data.schema_version != 1 || data.cards.len() > 1000 {
            return Err("Görüş deposu sürümü veya boyutu desteklenmiyor; sıfırlanmadı".into());
        }
        for (id, card) in &data.cards {
            validate_content(
                &card.topic,
                &card.statement,
                &card.reason,
                &card.position_ids,
            )?;
            if id != &card.id
                || card.revision == 0
                || !["draft", "confirmed", "uncertain", "rejected"].contains(&card.status.as_str())
                || !["assistant_proposal", "user_statement", "user_authored"]
                    .contains(&card.attribution.as_str())
                || card.history.len() + 1 != card.revision as usize
            {
                return Err("Görüş kaydı geçersiz; sıfırlanmadı".into());
            }
        }
        Ok(Self {
            root,
            _lock: lock,
            data,
            hash: bytes.map(|b| digest(&b)),
            healthy: true,
        })
    }

    fn commit(&mut self, next: Store) -> Result<(), String> {
        if !self.healthy {
            return Err("Görüş deposu yazma hatasından sonra kilitlendi; yeniden açın".into());
        }
        let bytes = serde_json::to_vec(&next).map_err(|_| "Görüş kaydı kodlanamadı")?;
        if bytes.len() as u64 > MAX_BYTES {
            return Err("Görüş deposu boyut sınırı aşıldı".into());
        }
        let path = self.root.join("opinions-v1.json");
        let temp = self
            .root
            .join(format!(".opinions-{}.tmp", uuid::Uuid::new_v4()));
        let result = (|| {
            no_symlinks(&path)?;
            if fs::metadata(&path).is_ok_and(|m| m.len() > MAX_BYTES) {
                return Err("Görüş deposu boyut sınırı aşıldı; üzerine yazılmadı".into());
            }
            let current = match fs::read(&path) {
                Ok(b) => Some(digest(&b)),
                Err(e) if e.kind() == std::io::ErrorKind::NotFound => None,
                Err(_) => return Err("Görüş deposu okunamadı".into()),
            };
            if current != self.hash {
                return Err("Görüş deposu dışarıdan değişmiş; üzerine yazılmadı".into());
            }
            let mut f = private_options()
                .create_new(true)
                .open(&temp)
                .map_err(|_| "Geçici görüş kaydı açılamadı")?;
            f.write_all(&bytes)
                .and_then(|_| f.sync_all())
                .map_err(|_| "Görüş kaydı yazılamadı")?;
            fs::rename(&temp, &path).map_err(|_| "Atomik görüş kaydı tamamlanamadı")?;
            File::open(&self.root)
                .and_then(|f| f.sync_all())
                .map_err(|_| "Görüş kaydı kalıcılığı doğrulanamadı")?;
            Ok::<(), String>(())
        })();
        if result.is_err() {
            self.healthy = false;
            let _ = fs::remove_file(&temp);
        }
        result?;
        self.hash = Some(digest(&bytes));
        self.data = next;
        Ok(())
    }

    pub fn list(&self) -> Result<Value, String> {
        if !self.healthy {
            return Err("Görüş deposu yazma hatasından sonra kilitlendi; yeniden açın".into());
        }
        let catalog = catalog();
        let confirmed: Vec<&Card> = self
            .data
            .cards
            .values()
            .filter(|c| c.status == "confirmed")
            .collect();
        let topics: Vec<Value> = catalog["topics"]
            .as_array()
            .unwrap()
            .iter()
            .map(|t| {
                let ids: Vec<&str> = confirmed
                    .iter()
                    .filter(|c| t["id"] == c.topic)
                    .map(|c| c.id.as_str())
                    .collect();
                json!({"id":t["id"],"confirmedCount":ids.len(),"cardIds":ids})
            })
            .collect();
        let traditions: Vec<Value> = catalog["traditions"].as_array().unwrap().iter().map(|t| {
            let positions: BTreeSet<&str> = catalog["positions"].as_array().unwrap().iter()
                .filter(|p| p["traditionIds"].as_array().unwrap().contains(&t["id"]))
                .map(|p| p["id"].as_str().unwrap()).collect();
            let cards: Vec<&Card> = confirmed.iter().copied().filter(|c| c.position_ids.iter().any(|p| positions.contains(p.as_str()))).collect();
            let used: BTreeSet<&str> = cards.iter().flat_map(|c| c.position_ids.iter().map(String::as_str)).filter(|p| positions.contains(p)).collect();
            json!({"id":t["id"],"cardIds":cards.iter().map(|c|c.id.as_str()).collect::<Vec<_>>(),"positionIds":used})
        }).collect();
        Ok(
            json!({"schemaVersion":1,"cards":self.data.cards.values().collect::<Vec<_>>(),"catalog":catalog,
            "map":{"confirmedCount":confirmed.len(),"topics":topics,"traditions":traditions}}),
        )
    }

    pub fn create(
        &mut self,
        input: Value,
        conversations: &BTreeMap<String, Conversation>,
    ) -> Result<Value, String> {
        let r: Create =
            serde_json::from_value(input).map_err(|_| "Görüş alanları eksik veya geçersiz")?;
        if !self.healthy {
            return Err("Görüş deposu yazma hatasından sonra kilitlendi; yeniden açın".into());
        }
        validate_content(&r.topic, &r.statement, &r.reason, &r.position_ids)?;
        let id = match &r.request_id {
            Some(id) => uuid::Uuid::parse_str(id)
                .map_err(|_| "İstek kimliği geçerli bir UUID olmalı")?
                .to_string(),
            None => uuid::Uuid::new_v4().to_string(),
        };
        // Hash the original request, not the mutable card: a retry after review
        // must recover the current card without replacing the user's decisions.
        let request_hash = digest(&serde_json::to_vec(&r).map_err(|_| "Görüş isteği kodlanamadı")?);
        if let Some(existing) = self.data.cards.get(&id) {
            if existing.creation_request_hash.as_deref() == Some(request_hash.as_str()) {
                return Ok(json!({"card":existing}));
            }
            return Err(
                "Bu istek kimliği başka bir içerikle kullanılmış; önce mevcut görüşü kontrol edin"
                    .into(),
            );
        }
        if self.data.cards.len() >= 1000 {
            return Err("İlk sürümde en fazla 1000 görüş kaydedilebilir".into());
        }
        if !["assistant_proposal", "user_statement", "user_authored"]
            .contains(&r.attribution.as_str())
        {
            return Err("Görüşün kaynağı geçersiz".into());
        }
        let source = if let Some(s) = r.source {
            if r.attribution == "user_authored" {
                return Err(
                    "Yeni yazılan görüş, geçmiş bir mesajın özgün sözü olarak işaretlenemez".into(),
                );
            }
            let c = conversations
                .get(&s.conversation_id)
                .ok_or("Kaynak konuşma bulunamadı")?;
            let m = c
                .messages
                .iter()
                .find(|m| m.id == s.message_id)
                .ok_or("Kaynak mesaj bu konuşmada bulunamadı")?;
            if !["user", "assistant"].contains(&m.role.as_str())
                || !bounded(&s.excerpt, 6000, true)
                || !m.text.contains(&s.excerpt)
            {
                return Err("Alıntı, görünür kaynak mesajıyla birebir eşleşmeli".into());
            }
            if r.attribution == "user_statement" && (m.role != "user" || r.statement != s.excerpt) {
                return Err(
                    "Doğrudan kullanıcı sözü için kullanıcı mesajındaki alıntı aynen korunmalı"
                        .into(),
                );
            }
            Some(Source {
                conversation_id: s.conversation_id,
                message_id: s.message_id,
                excerpt: s.excerpt,
                conversation_title: c.title.clone(),
                provider: c.provider.clone(),
                role: m.role.clone(),
                timestamp: m.timestamp.clone(),
            })
        } else {
            if r.attribution != "user_authored" {
                return Err("Bu görüş türü kaynak mesajı gerektirir".into());
            }
            None
        };
        let now = chrono::Utc::now().to_rfc3339();
        let card = Card {
            id,
            creation_request_hash: Some(request_hash),
            topic: r.topic,
            statement: r.statement,
            reason: r.reason,
            source,
            attribution: r.attribution,
            position_ids: r.position_ids,
            status: "draft".into(),
            revision: 1,
            created_at: now.clone(),
            updated_at: now,
            history: vec![],
        };
        let mut next = self.data.clone();
        next.cards.insert(card.id.clone(), card.clone());
        self.commit(next)?;
        Ok(json!({"card":card}))
    }

    pub fn review(&mut self, input: Value) -> Result<Value, String> {
        let r: Review =
            serde_json::from_value(input).map_err(|_| "İnceleme alanları eksik veya geçersiz")?;
        let old = self.data.cards.get(&r.id).ok_or("Görüş bulunamadı")?;
        if old.revision != r.expected_revision {
            return Err("Görüş başka bir işlemde değişmiş; yeniden yükleyin".into());
        }
        if old.history.len() >= 999 {
            return Err("Görüş sürüm sınırına ulaşıldı".into());
        }
        validate_content(&old.topic, &r.statement, &r.reason, &r.position_ids)?;
        if !["draft", "confirmed", "uncertain", "rejected"].contains(&r.status.as_str()) {
            return Err("İnceleme durumu geçersiz".into());
        }
        if r.status == "confirmed" && !r.confirmed_by_user {
            return Err("Görüş yalnız açık kullanıcı onayıyla haritaya eklenebilir".into());
        }
        if !["review", "correction", "opinion_change"].contains(&r.change_type.as_str())
            || !bounded(&r.change_reason, 3000, r.change_type != "review")
        {
            return Err("Düzeltme veya görüş değişimi için bir açıklama girin".into());
        }
        if (old.statement != r.statement
            || old.reason != r.reason
            || old.position_ids.iter().collect::<BTreeSet<_>>()
                != r.position_ids.iter().collect::<BTreeSet<_>>())
            && r.change_type == "review"
        {
            return Err(
                "Görüş, gerekçe veya ilkeler değişti: ifade düzeltmesi veya görüş değişimini seçin"
                    .into(),
            );
        }
        let now = chrono::Utc::now().to_rfc3339();
        let mut card = old.clone();
        card.history.push(Revision {
            revision: old.revision,
            statement: old.statement.clone(),
            reason: old.reason.clone(),
            position_ids: old.position_ids.clone(),
            status: old.status.clone(),
            changed_at: now.clone(),
            change_type: r.change_type,
            change_reason: r.change_reason,
        });
        card.statement = r.statement;
        card.reason = r.reason;
        card.position_ids = r.position_ids;
        card.status = r.status;
        card.revision += 1;
        card.updated_at = now;
        let mut next = self.data.clone();
        next.cards.insert(card.id.clone(), card.clone());
        self.commit(next)?;
        Ok(json!({"card":card}))
    }
}

#[cfg(test)]
mod tests {
    use super::super::types::Message;
    use super::*;
    fn root() -> PathBuf {
        std::env::temp_dir()
            .canonicalize()
            .unwrap()
            .join(format!("tore-opinions-{}", uuid::Uuid::new_v4()))
    }
    fn conversation() -> BTreeMap<String, Conversation> {
        let mut c = Conversation {
            schema_version: 1,
            id: "conversation".into(),
            provider: "test".into(),
            source_app: "synthetic".into(),
            source_conversation_id: "synthetic".into(),
            title: "Yapay sınama".into(),
            created_at: None,
            updated_at: None,
            selected_leaf_id: None,
            messages: vec![],
            warnings: vec![],
        };
        for (id, role, text) in [
            (
                "user",
                "user",
                "Ya böyle olsaydı? Karşı görüşü sınamak istiyorum.",
            ),
            ("assistant", "assistant", "Bunu savunuyor olabilirsiniz."),
        ] {
            c.messages.push(Message {
                id: id.into(),
                source_id: id.into(),
                parent_id: None,
                role: role.into(),
                phase: None,
                text: text.into(),
                attachments: vec![],
                timestamp: None,
                source_locator: "synthetic".into(),
                authorship_status: "unreviewed".into(),
                model: None,
            });
        }
        BTreeMap::from([(c.id.clone(), c)])
    }
    fn input() -> Value {
        json!({"topic":"life","statement":"Herkesin barınmaya erişimini önemsiyorum.","reason":"Yapay test gerekçesi","attribution":"user_authored","positionIds":["life_basic"]})
    }
    fn review(card: &Value, status: &str) -> Value {
        json!({"id":card["id"],"expectedRevision":card["revision"],"statement":card["statement"],"reason":card["reason"],"positionIds":card["positionIds"],"status":status,"changeType":"review","changeReason":"","confirmedByUser":true})
    }

    #[test]
    fn lost_create_response_retries_return_one_current_card_after_reopen() {
        let p = root();
        let mut disk = Disk::open(p.clone()).unwrap();
        let mut request = input();
        request["requestId"] = json!(uuid::Uuid::new_v4().to_string());
        let first = disk.create(request.clone(), &BTreeMap::new()).unwrap();
        assert_eq!(
            disk.create(request.clone(), &BTreeMap::new()).unwrap(),
            first
        );
        assert_eq!(disk.list().unwrap()["cards"].as_array().unwrap().len(), 1);
        let mut conflict = request.clone();
        conflict["statement"] = json!("Başka görüş.");
        assert!(disk.create(conflict.clone(), &BTreeMap::new()).is_err());
        let reviewed = disk.review(review(&first["card"], "confirmed")).unwrap();
        assert_eq!(
            disk.create(request.clone(), &BTreeMap::new()).unwrap(),
            reviewed
        );
        drop(disk);
        let mut disk = Disk::open(p.clone()).unwrap();
        assert_eq!(disk.create(request, &BTreeMap::new()).unwrap(), reviewed);
        assert!(disk.create(conflict, &BTreeMap::new()).is_err());
        assert_eq!(disk.list().unwrap()["cards"].as_array().unwrap().len(), 1);
        drop(disk);
        fs::remove_dir_all(p).unwrap();
    }

    #[test]
    fn explicit_confirmation_map_withdrawal_history_and_restart() {
        let p = root();
        let mut disk = Disk::open(p.clone()).unwrap();
        let card = disk.create(input(), &BTreeMap::new()).unwrap()["card"].clone();
        assert_eq!(disk.list().unwrap()["map"]["confirmedCount"], 0);
        let mut req = review(&card, "confirmed");
        req["confirmedByUser"] = json!(false);
        assert!(disk.review(req).is_err());
        let confirmed = disk.review(review(&card, "confirmed")).unwrap()["card"].clone();
        let listed = disk.list().unwrap();
        assert_eq!(listed["map"]["confirmedCount"], 1);
        assert_eq!(listed["map"]["traditions"][0]["cardIds"][0], card["id"]);
        assert!(disk.review(review(&card, "confirmed")).is_err());
        let mut correction = review(&confirmed, "confirmed");
        correction["statement"] = json!("Barınma ve sağlık güvencesi önemli.");
        assert!(disk.review(correction.clone()).is_err());
        correction["changeType"] = json!("correction");
        assert!(disk.review(correction.clone()).is_err());
        correction["changeReason"] = json!("İfadeyi açtım.");
        let corrected = disk.review(correction).unwrap()["card"].clone();
        assert_eq!(corrected["history"][1]["statement"], card["statement"]);
        let withdrawn = disk.review(review(&corrected, "uncertain")).unwrap()["card"].clone();
        assert_eq!(disk.list().unwrap()["map"]["confirmedCount"], 0);
        drop(disk);
        let reopened = Disk::open(p.clone()).unwrap();
        assert_eq!(reopened.list().unwrap()["cards"][0], withdrawn);
        drop(reopened);
        fs::remove_dir_all(p).unwrap();
    }

    #[test]
    fn attribution_quotes_and_roleplay_never_adopted_automatically() {
        let p = root();
        let mut disk = Disk::open(p.clone()).unwrap();
        let conversations = conversation();
        let mut q = input();
        q["source"] = json!({"conversationId":"conversation","messageId":"user","excerpt":"Ya böyle olsaydı?"});
        q["attribution"] = json!("user_statement");
        q["statement"] = json!("Ya böyle olsaydı?");
        let card = disk.create(q.clone(), &conversations).unwrap()["card"].clone();
        assert_eq!(card["status"], "draft");
        assert_eq!(disk.list().unwrap()["map"]["confirmedCount"], 0);
        q["source"]["excerpt"] = json!("uydurma alıntı");
        assert!(disk.create(q.clone(), &conversations).is_err());
        q["source"] = json!({"conversationId":"conversation","messageId":"assistant","excerpt":"Bunu savunuyor olabilirsiniz."});
        q["statement"] = json!("Bunu savunuyor olabilirsiniz.");
        assert!(disk.create(q.clone(), &conversations).is_err());
        q["attribution"] = json!("assistant_proposal");
        let ai = disk.create(q.clone(), &conversations).unwrap()["card"].clone();
        let confirmed = disk.review(review(&ai, "confirmed")).unwrap()["card"].clone();
        assert_eq!(confirmed["source"]["role"], "assistant");
        assert_eq!(confirmed["attribution"], "assistant_proposal");
        q["source"]["conversationId"] = json!("foreign");
        assert!(disk.create(q, &conversations).is_err());
        let mut q = input();
        q["status"] = json!("confirmed");
        assert!(disk.create(q, &conversations).is_err());
        let mut q = input();
        q["positionIds"] = json!(["ai_human"]);
        assert!(disk.create(q, &conversations).is_err());
        drop(disk);
        fs::remove_dir_all(p).unwrap();
    }

    #[test]
    fn store_locks_corruption_external_changes_and_permissions() {
        let p = root();
        let mut disk = Disk::open(p.clone()).unwrap();
        assert!(Disk::open(p.clone()).is_err());
        disk.create(input(), &BTreeMap::new()).unwrap();
        #[cfg(unix)]
        {
            use std::os::unix::fs::PermissionsExt;
            assert_eq!(
                fs::metadata(p.join("opinions-v1.json"))
                    .unwrap()
                    .permissions()
                    .mode()
                    & 0o777,
                0o600
            );
        }
        fs::write(p.join("opinions-v1.json"), b"external content").unwrap();
        assert!(disk.create(input(), &BTreeMap::new()).is_err());
        assert!(disk.list().is_err());
        assert!(disk.create(input(), &BTreeMap::new()).is_err());
        drop(disk);
        assert!(Disk::open(p.clone()).is_err());
        assert_eq!(
            fs::read(p.join("opinions-v1.json")).unwrap(),
            b"external content"
        );
        fs::remove_dir_all(p).unwrap();
    }

    #[cfg(unix)]
    #[test]
    fn symlink_target_is_never_read_or_overwritten() {
        use std::os::unix::fs::symlink;
        let p = root();
        let outside = root();
        fs::create_dir_all(&p).unwrap();
        fs::write(&outside, b"private original").unwrap();
        symlink(&outside, p.join("opinions-v1.json")).unwrap();
        assert!(Disk::open(p.clone()).is_err());
        assert_eq!(fs::read(&outside).unwrap(), b"private original");
        fs::remove_dir_all(&p).unwrap();
        fs::remove_file(outside).unwrap();
    }

    #[tokio::test]
    async fn http_auth_source_review_and_workspace_preservation() {
        use axum::{
            body::Body,
            http::{Request, StatusCode},
        };
        use http_body_util::BodyExt;
        use tower::ServiceExt;
        let p = root();
        let mut workspace = super::super::store::Disk::open(p.clone()).unwrap();
        let mut data = workspace.data.clone();
        data.conversations = conversation();
        workspace.commit(data).unwrap();
        drop(workspace);
        let original = fs::read(p.join("workspace-v1.json")).unwrap();
        let app = super::super::router(p.clone(), "token".into(), "http://127.0.0.1:4501".into())
            .unwrap();
        async fn call(
            app: axum::Router,
            op: &str,
            value: Value,
            origin: &str,
            token: &str,
        ) -> (StatusCode, Value) {
            let response = app
                .oneshot(
                    Request::builder()
                        .method("POST")
                        .uri(format!("/api/private/tore/{op}"))
                        .header("host", "127.0.0.1:4501")
                        .header("origin", origin)
                        .header("authorization", format!("Bearer {token}"))
                        .header("content-type", "application/json")
                        .body(Body::from(value.to_string()))
                        .unwrap(),
                )
                .await
                .unwrap();
            let status = response.status();
            let bytes = response.into_body().collect().await.unwrap().to_bytes();
            (status, serde_json::from_slice(&bytes).unwrap())
        }
        assert_eq!(
            call(
                app.clone(),
                "opinions",
                json!({}),
                "http://evil.invalid",
                "token"
            )
            .await
            .0,
            StatusCode::FORBIDDEN
        );
        assert_eq!(
            call(
                app.clone(),
                "opinion-create",
                input(),
                "http://127.0.0.1:4501",
                "wrong"
            )
            .await
            .0,
            StatusCode::FORBIDDEN
        );
        let (status, created) = call(
            app.clone(),
            "opinion-create",
            input(),
            "http://127.0.0.1:4501",
            "token",
        )
        .await;
        assert_eq!(status, StatusCode::OK);
        let (status, _) = call(
            app.clone(),
            "opinion-review",
            review(&created["card"], "confirmed"),
            "http://127.0.0.1:4501",
            "token",
        )
        .await;
        assert_eq!(status, StatusCode::OK);
        let (_, listed) = call(
            app.clone(),
            "opinions",
            json!({}),
            "http://127.0.0.1:4501",
            "token",
        )
        .await;
        assert_eq!(listed["map"]["confirmedCount"], 1);
        assert_eq!(fs::read(p.join("workspace-v1.json")).unwrap(), original);
        drop(app);
        fs::remove_dir_all(p).unwrap();
    }
}
