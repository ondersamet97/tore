//! Töre's small invited network. No remote service, telemetry or archive discovery.
use axum::{
    Json, Router,
    extract::{DefaultBodyLimit, State},
    http::{HeaderMap, StatusCode},
    response::{IntoResponse, Response},
    routing::{get, post},
};
use base64::{
    Engine,
    engine::general_purpose::{STANDARD, URL_SAFE_NO_PAD},
};
use chrono::Utc;
use ed25519_dalek::{Signature, VerifyingKey};
use fs2::FileExt;
use serde::{Deserialize, Serialize};
use serde_json::{Value, json};
use sha2::{Digest, Sha256};
use std::{
    collections::{BTreeMap, BTreeSet},
    fs::{self, File, OpenOptions},
    io::Write,
    net::SocketAddr,
    path::{Path, PathBuf},
    sync::{
        Arc,
        atomic::{AtomicBool, Ordering},
    },
};
use tokio::sync::Mutex;
use uuid::Uuid;

const STORE_LIMIT: usize = 64_000_000;
const EVENT_LIMIT: usize = 24_000_000;
const HTTP_LIMIT: usize = 32_000_000;
const OWN_EXPORT_LIMIT: usize = 16_000_000;
const READ_NONCE_LIMIT: usize = 131_072;
const KEY_NONCE_LIMIT: usize = 4_096;
const RATE_KEY_LIMIT: usize = 1_024;
const RATE_PER_MINUTE: usize = 600;

#[derive(Default)]
struct Traffic {
    reads: BTreeMap<String, (String, i64)>,
    rates: BTreeMap<String, (i64, usize)>,
}
impl Traffic {
    fn check(&mut self, e: &Event) -> Result<()> {
        let current = Utc::now().timestamp();
        self.reads.retain(|_, (_, expires)| *expires >= current);
        self.rates.retain(|_, (start, _)| current - *start < 60);
        if self.reads.contains_key(&e.id) {
            return Err(conflict("Bu imzalı okuma daha önce işlendi; yinelenmedi."));
        }
        if !self.rates.contains_key(&e.author) && self.rates.len() >= RATE_KEY_LIMIT {
            return Err(Error(
                StatusCode::TOO_MANY_REQUESTS,
                "İstek sınırı dolu; biraz sonra yeniden deneyin.".into(),
            ));
        }
        let rate = self.rates.entry(e.author.clone()).or_insert((current, 0));
        if rate.1 >= RATE_PER_MINUTE {
            return Err(Error(
                StatusCode::TOO_MANY_REQUESTS,
                "Bu anahtar için dakikalık 600 istek sınırı aşıldı.".into(),
            ));
        }
        rate.1 += 1;
        Ok(())
    }
    fn read(&mut self, e: &Event) -> Result<()> {
        if self.reads.len() >= READ_NONCE_LIMIT
            || self
                .reads
                .values()
                .filter(|(key, _)| key == &e.author)
                .count()
                >= KEY_NONCE_LIMIT
        {
            return Err(Error(
                StatusCode::TOO_MANY_REQUESTS,
                "Geçici okuma sınırı dolu; olay süresi geçince yeniden deneyin.".into(),
            ));
        }
        // Expire only when the signed event can no longer pass freshness validation.
        let expires = chrono::DateTime::parse_from_rfc3339(&e.issued_at)
            .map_err(|_| bad("Olay tarihi geçersiz."))?
            .timestamp()
            + 300;
        self.reads.insert(e.id.clone(), (e.author.clone(), expires));
        Ok(())
    }
}

type Result<T> = std::result::Result<T, Error>;
struct Error(StatusCode, String);
impl IntoResponse for Error {
    fn into_response(self) -> Response {
        (self.0, Json(json!({"ok":false,"error":self.1}))).into_response()
    }
}
fn bad(s: impl Into<String>) -> Error {
    Error(StatusCode::BAD_REQUEST, s.into())
}
fn denied(s: &str) -> Error {
    Error(StatusCode::FORBIDDEN, s.into())
}
fn conflict(s: &str) -> Error {
    Error(StatusCode::CONFLICT, s.into())
}
fn disk(e: impl std::fmt::Display) -> Error {
    Error(
        StatusCode::INTERNAL_SERVER_ERROR,
        format!("Disk kaydı tamamlanamadı; işlem başarılı sayılmadı: {e}"),
    )
}
#[derive(Clone, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
struct Envelope {
    event: String,
    signature: String,
}
#[derive(Clone, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
struct Event {
    version: u32,
    id: String,
    author: String,
    issued_at: String,
    action: String,
    payload: Value,
}
#[derive(Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
struct Data {
    schema_version: u32,
    people: BTreeMap<String, Value>,
    posts: BTreeMap<String, Value>,
    replies: BTreeMap<String, Value>,
    comparisons: BTreeMap<String, Value>,
    follows: BTreeMap<String, Value>,
    notifications: Vec<Value>,
    invites: BTreeMap<String, Value>,
    seen: BTreeSet<String>,
    #[serde(default)]
    aliases: BTreeMap<String, String>,
    #[serde(default)]
    revoked_keys: BTreeSet<String>,
    #[serde(default)]
    lifecycle_events: Vec<Envelope>,
    #[serde(default)]
    founder: Option<String>,
}
impl Default for Data {
    fn default() -> Self {
        Self {
            schema_version: 1,
            people: BTreeMap::new(),
            posts: BTreeMap::new(),
            replies: BTreeMap::new(),
            comparisons: BTreeMap::new(),
            follows: BTreeMap::new(),
            notifications: vec![],
            invites: BTreeMap::new(),
            seen: BTreeSet::new(),
            aliases: BTreeMap::new(),
            revoked_keys: BTreeSet::new(),
            lifecycle_events: vec![],
            founder: None,
        }
    }
}
#[derive(Clone)]
struct App {
    inner: Arc<Mutex<Data>>,
    dir: PathBuf,
    origin: String,
    healthy: Arc<AtomicBool>,
    disk_hash: Arc<std::sync::Mutex<String>>,
    traffic: Arc<std::sync::Mutex<Traffic>>,
}
fn now() -> String {
    Utc::now().to_rfc3339_opts(chrono::SecondsFormat::Millis, true)
}
fn hash(bytes: &[u8]) -> String {
    format!("{:x}", Sha256::digest(bytes))
}
fn obj(v: &Value) -> Result<&serde_json::Map<String, Value>> {
    v.as_object()
        .ok_or_else(|| bad("Bir JSON nesnesi bekleniyor."))
}
fn string<'a>(v: &'a Value, key: &str) -> Result<&'a str> {
    v.get(key)
        .and_then(Value::as_str)
        .ok_or_else(|| bad(format!("{key}: metin gerekli.")))
}
fn text(v: &Value, key: &str, min: usize, max: usize) -> Result<String> {
    let t = string(v, key)?;
    if t.trim().chars().count() < min
        || t.chars().count() > max
        || t.chars()
            .any(|c| c.is_control() && !['\n', '\r', '\t'].contains(&c))
    {
        return Err(bad(format!("{key}: {min}–{max} karakter gerekli.")));
    }
    Ok(t.to_owned())
}
fn fields(v: &Value, allowed: &[&str]) -> Result<()> {
    for key in obj(v)?.keys() {
        if !allowed.contains(&key.as_str()) {
            return Err(bad(format!("Bilinmeyen alan: {key}")));
        }
    }
    Ok(())
}
fn uuid(s: &str) -> Result<()> {
    Uuid::parse_str(s)
        .map(|_| ())
        .map_err(|_| bad("Geçersiz kayıt kimliği."))
}
fn verify(env: &Envelope, fresh: bool) -> Result<Event> {
    if env.event.len() > EVENT_LIMIT {
        return Err(bad("İmzalı olay 24 MB sınırını aşıyor."));
    }
    let e: Event =
        serde_json::from_str(&env.event).map_err(|_| bad("İmzalı olay yapısı geçersiz."))?;
    if e.version != 1 {
        return Err(bad("Desteklenmeyen olay sürümü."));
    }
    uuid(&e.id)?;
    let raw = URL_SAFE_NO_PAD
        .decode(&e.author)
        .map_err(|_| bad("Geçersiz açık anahtar."))?;
    let bytes: [u8; 32] = raw
        .try_into()
        .map_err(|_| bad("Açık anahtar 32 bayt olmalı."))?;
    if URL_SAFE_NO_PAD.encode(bytes) != e.author {
        return Err(bad("Açık anahtar kodlaması geçersiz."));
    }
    let key = VerifyingKey::from_bytes(&bytes).map_err(|_| bad("Geçersiz açık anahtar."))?;
    let sig = STANDARD
        .decode(&env.signature)
        .ok()
        .and_then(|b| Signature::from_slice(&b).ok())
        .ok_or_else(|| Error(StatusCode::UNAUTHORIZED, "İmza biçimi geçersiz.".into()))?;
    key.verify_strict(env.event.as_bytes(), &sig)
        .map_err(|_| Error(StatusCode::UNAUTHORIZED, "İmza doğrulanamadı.".into()))?;
    let ts = chrono::DateTime::parse_from_rfc3339(&e.issued_at)
        .map_err(|_| bad("Olay tarihi geçersiz."))?;
    if fresh && (Utc::now().timestamp() - ts.timestamp()).abs() > 300 {
        return Err(bad(
            "Olay süresi dolmuş; cihaz saatini kontrol edip yeniden deneyin.",
        ));
    }
    Ok(e)
}
fn canonical<'a>(d: &'a Data, key: &'a str) -> &'a str {
    d.aliases.get(key).map(String::as_str).unwrap_or(key)
}
fn public_key(value: &str) -> Result<VerifyingKey> {
    let bytes: [u8; 32] = URL_SAFE_NO_PAD
        .decode(value)
        .map_err(|_| bad("Açık anahtar kodlaması geçersiz."))?
        .try_into()
        .map_err(|_| bad("Açık anahtar 32 bayt olmalı."))?;
    if URL_SAFE_NO_PAD.encode(bytes) != value {
        return Err(bad("Açık anahtar kodlaması geçersiz."));
    }
    VerifyingKey::from_bytes(&bytes).map_err(|_| bad("Geçersiz açık anahtar."))
}
fn proof(key: &str, signature: &str, message: &str) -> Result<()> {
    let key = public_key(key)?;
    let signature = STANDARD
        .decode(signature)
        .ok()
        .and_then(|b| Signature::from_slice(&b).ok())
        .ok_or_else(|| bad("Anahtar kanıtı imza biçimi geçersiz."))?;
    key.verify_strict(message.as_bytes(), &signature)
        .map_err(|_| {
            Error(
                StatusCode::UNAUTHORIZED,
                "Yeni/kurtarma anahtarının imza kanıtı doğrulanamadı.".into(),
            )
        })
}
fn unused_key(d: &Data, key: &str) -> Result<()> {
    public_key(key)?;
    if d.people.contains_key(key)
        || d.aliases.contains_key(key)
        || d.revoked_keys.contains(key)
        || d.people.values().any(|p| p["recoveryPublicKey"] == key)
    {
        return Err(conflict(
            "Bu anahtar daha önce kullanılmış veya bir kimliğe bağlı.",
        ));
    }
    Ok(())
}
fn rotate(d: &mut Data, target: &str, new_key: &str) -> Result<()> {
    unused_key(d, new_key)?;
    if !d.people.contains_key(target) {
        return Err(bad("Kimlik bulunamadı."));
    }
    d.revoked_keys.insert(target.to_owned());
    for (key, owner) in &d.aliases {
        if owner == target {
            d.revoked_keys.insert(key.clone());
        }
    }
    d.aliases.insert(new_key.to_owned(), target.to_owned());
    Ok(())
}
fn lifecycle(d: &mut Data, e: &Event, env: &Envelope) -> Result<()> {
    let p = &e.payload;
    let actor = &e.author;
    if d.founder.is_none() {
        d.founder = d
            .people
            .iter()
            .find(|(_, p)| p["admin"] == true)
            .map(|(id, _)| id.clone());
    }
    match e.action.as_str() {
        "rotate_key" => {
            fields(p, &["newPublicKey", "newKeySignature"])?;
            let new_key = string(p, "newPublicKey")?;
            proof(
                new_key,
                string(p, "newKeySignature")?,
                &format!("tore:key-rotate:v1\n{actor}\n{new_key}\n{}", e.id),
            )?;
            rotate(d, actor, new_key)?;
        }
        "set_recovery_key" => {
            fields(p, &["recoveryPublicKey", "recoverySignature"])?;
            let key = string(p, "recoveryPublicKey")?;
            unused_key(d, key)?;
            proof(
                key,
                string(p, "recoverySignature")?,
                &format!("tore:recovery-register:v1\n{actor}\n{}", e.id),
            )?;
            d.people
                .get_mut(actor)
                .ok_or_else(|| denied("Üye bulunamadı."))?["recoveryPublicKey"] = json!(key);
        }
        "recover_key" => {
            fields(p, &["targetId", "newPublicKey", "newKeySignature"])?;
            let target = string(p, "targetId")?;
            let raw = verify(env, false)?;
            if d.people.get(target).is_none_or(|person| {
                person["recoveryPublicKey"] != raw.author || person["suspended"] == true
            }) {
                return Err(denied("Kurtarma anahtarı bu etkin üyeye bağlı değil."));
            }
            let new_key = string(p, "newPublicKey")?;
            proof(
                new_key,
                string(p, "newKeySignature")?,
                &format!("tore:key-recover:v1\n{target}\n{new_key}\n{}", e.id),
            )?;
            rotate(d, target, new_key)?;
        }
        "transfer_admin" => {
            fields(p, &["targetId"])?;
            if d.people
                .get(actor)
                .is_none_or(|person| person["admin"] != true)
            {
                return Err(denied("Yönetici devri yalnız mevcut yöneticide açık."));
            }
            let target = string(p, "targetId")?;
            if target == actor
                || d.people
                    .get(target)
                    .is_none_or(|person| person["suspended"] == true)
            {
                return Err(bad("Başka bir etkin üye seçin."));
            }
            d.people.get_mut(actor).unwrap()["admin"] = json!(false);
            d.people.get_mut(target).unwrap()["admin"] = json!(true);
        }
        "suspend_member" => {
            fields(p, &["targetId", "suspended"])?;
            if d.people
                .get(actor)
                .is_none_or(|person| person["admin"] != true)
            {
                return Err(denied("Üyelik yönetimi yalnız ağ yöneticisinde açık."));
            }
            let target = string(p, "targetId")?;
            let suspended = p["suspended"]
                .as_bool()
                .ok_or_else(|| bad("suspended: doğru/yanlış gerekli."))?;
            if target == actor {
                return Err(bad(
                    "Yönetici kendini askıya alamaz; önce yöneticiliği devredin.",
                ));
            }
            d.people
                .get_mut(target)
                .ok_or_else(|| bad("Üye bulunamadı."))?["suspended"] = json!(suspended);
        }
        _ => return Err(bad("Kimlik yaşam döngüsü işlemi geçersiz.")),
    }
    d.lifecycle_events.push(env.clone());
    Ok(())
}
fn protect_replay(d: &mut Data) -> std::result::Result<(), String> {
    let mut ids = BTreeSet::new();
    let mut add = |raw: &Value| -> std::result::Result<(), String> {
        let event: Event = serde_json::from_str(raw.as_str().ok_or("İmzalı olay metni eksik.")?)
            .map_err(|_| "İmzalı olay yapısı geçersiz.")?;
        ids.insert(event.id);
        Ok(())
    };
    for person in d.people.values() {
        add(&person["profileEvent"]["event"])?;
    }
    for post in d.posts.values() {
        for version in post["versions"]
            .as_array()
            .ok_or("Yayın sürümleri eksik.")?
        {
            add(&version["event"])?;
        }
    }
    for reply in d.replies.values() {
        add(&reply["event"])?;
        if let Some(history) = reply.get("statusHistory").and_then(Value::as_array) {
            for status in history {
                add(&status["event"])?;
            }
        }
    }
    for comparison in d.comparisons.values() {
        for version in comparison["history"]
            .as_array()
            .ok_or("Karşılaştırma geçmişi eksik.")?
        {
            add(&version["event"])?;
        }
    }
    for event in &d.lifecycle_events {
        add(&json!(event.event))?;
    }
    // Legacy/imported stores may omit a signed object's nonce. Rebuild conservatively;
    // never allow old signed replies/statuses to become executable after restore.
    d.seen.extend(ids);
    Ok(())
}
fn load(path: &Path) -> std::result::Result<Data, String> {
    let bytes = fs::read(path).map_err(|e| e.to_string())?;
    if bytes.len() > STORE_LIMIT {
        return Err("Ağ kaydı 64 MB sınırını aşıyor.".into());
    }
    let wrapper: Value =
        serde_json::from_slice(&bytes).map_err(|_| "Ağ kaydı bozuk JSON.".to_string())?;
    if wrapper["format"] != "tore-network-store" || wrapper["version"] != 1 {
        return Err("Ağ kayıt biçimi desteklenmiyor.".into());
    }
    let payload = wrapper["payload"]
        .as_str()
        .ok_or("Ağ kayıt içeriği eksik.")?;
    if wrapper["sha256"] != hash(payload.as_bytes()) {
        return Err("Ağ kaydı içerik özeti uyuşmuyor.".into());
    }
    let mut d: Data =
        serde_json::from_str(payload).map_err(|e| format!("Ağ kayıt şeması bozuk: {e}"))?;
    if d.schema_version != 1 {
        return Err("Ağ şema sürümü desteklenmiyor.".into());
    }
    validate_data(&d)?;
    protect_replay(&mut d)?;
    Ok(d)
}
fn validate_lifecycle(d: &Data) -> std::result::Result<(), String> {
    if d.aliases.len() > 10_000 || d.lifecycle_events.len() > 20_000 {
        return Err("Kimlik değişim geçmişi sınırı aşılıyor.".into());
    }
    for (key, owner) in &d.aliases {
        public_key(key).map_err(|e| e.1)?;
        if !d.people.contains_key(owner)
            || d.people.contains_key(key)
            || d.aliases.contains_key(owner)
        {
            return Err("Kimlik anahtar bağı tutarsız.".into());
        }
    }
    for key in &d.revoked_keys {
        if !d.people.contains_key(key) && !d.aliases.contains_key(key) {
            return Err("İptal edilmiş anahtarın üyesi yok.".into());
        }
    }
    if d.lifecycle_events.is_empty() {
        if !d.aliases.is_empty()
            || !d.revoked_keys.is_empty()
            || d.people
                .values()
                .any(|p| p["suspended"] == true || !p["recoveryPublicKey"].is_null())
        {
            return Err("İmzalı kimlik değişim geçmişi eksik.".into());
        }
        return Ok(());
    }
    let founder = d
        .founder
        .as_ref()
        .filter(|id| d.people.contains_key(*id))
        .ok_or("İlk yönetici kimliği eksik.")?;
    let mut replay = d.clone();
    replay.aliases.clear();
    replay.revoked_keys.clear();
    replay.lifecycle_events.clear();
    for (id, p) in &mut replay.people {
        p["admin"] = json!(id == founder);
        p.as_object_mut()
            .ok_or("Profil bozuk.")?
            .remove("suspended");
        p.as_object_mut().unwrap().remove("recoveryPublicKey");
    }
    let mut ids = BTreeSet::new();
    for env in &d.lifecycle_events {
        let mut e = verify(env, false).map_err(|e| e.1)?;
        if !ids.insert(e.id.clone()) || replay.revoked_keys.contains(&e.author) {
            return Err("Kimlik değişim olayı yineleniyor veya iptal anahtar kullanıyor.".into());
        }
        e.author = if e.action == "recover_key" {
            string(&e.payload, "targetId").map_err(|e| e.1)?.to_owned()
        } else {
            canonical(&replay, &e.author).to_owned()
        };
        if replay
            .people
            .get(&e.author)
            .is_none_or(|p| p["suspended"] == true)
        {
            return Err("Kimlik değişim olayı etkin üyeden gelmiyor.".into());
        }
        lifecycle(&mut replay, &e, env).map_err(|e| e.1)?;
    }
    if replay.aliases != d.aliases || replay.revoked_keys != d.revoked_keys {
        return Err("İmzalı anahtar zinciri kayıtla uyuşmuyor.".into());
    }
    for (id, p) in &d.people {
        if replay.people[id]["admin"] != p["admin"]
            || (replay.people[id]["suspended"] == true) != (p["suspended"] == true)
            || replay.people[id]["recoveryPublicKey"] != p["recoveryPublicKey"]
        {
            return Err("Üyelik yetkileri imzalı geçmişle uyuşmuyor.".into());
        }
    }
    Ok(())
}
fn validate_data(d: &Data) -> std::result::Result<(), String> {
    let invalid = |s: &str| format!("Ağ kaydı tutarsız: {s}");
    validate_lifecycle(d)?;
    if d.people.len() > 200 || d.posts.len() > 5000 {
        return Err(invalid("kayıt sınırı aşılıyor"));
    }
    if !d.people.is_empty() && d.people.values().filter(|p| p["admin"] == true).count() != 1 {
        return Err(invalid("tek kurucu gerekli"));
    }
    for (id, p) in &d.people {
        if p["id"] != *id || !p["admin"].is_boolean() {
            return Err(invalid("profil kimliği"));
        }
        profile_payload(p).map_err(|e| e.1)?;
        let env: Envelope = serde_json::from_value(p["profileEvent"].clone())
            .map_err(|_| invalid("profil imzası eksik"))?;
        let event = verify(&env, false).map_err(|e| e.1)?;
        if canonical(d, &event.author) != id
            || !["profile", "register"].contains(&event.action.as_str())
            || event.payload["name"] != p["name"]
            || event.payload["bio"] != p["bio"]
        {
            return Err(invalid("profil imzalı metinle uyuşmuyor"));
        }
    }
    for (id, p) in &d.posts {
        if p["id"] != *id || !d.people.contains_key(p["author"].as_str().unwrap_or("")) {
            return Err(invalid("yayın kimliği veya yazarı"));
        }
        let vs = p["versions"]
            .as_array()
            .ok_or_else(|| invalid("yayın sürümleri eksik"))?;
        if vs.is_empty() || p["currentVersion"] != vs.len() {
            return Err(invalid("güncel yayın sürümü"));
        }
        for (i, v) in vs.iter().enumerate() {
            if v["version"] != i + 1 {
                return Err(invalid("yayın sürüm sırası"));
            }
            let signed = Envelope {
                event: string(v, "event").map_err(|e| e.1)?.into(),
                signature: string(v, "signature").map_err(|e| e.1)?.into(),
            };
            let event = verify(&signed, false).map_err(|e| e.1)?;
            if canonical(d, &event.author) != p["author"].as_str().unwrap_or("") {
                return Err(invalid("yayın imzasının yazarı"));
            }
            let mut fields = event.payload.clone();
            let reason = if i == 0 {
                if event.action != "create_post"
                    || event.id != *id
                    || p["createdAt"] != event.issued_at
                {
                    return Err(invalid("ilk yayın olayı"));
                }
                String::new()
            } else {
                if event.action != "revise_post"
                    || fields["postId"] != *id
                    || fields["expectedVersion"] != i
                {
                    return Err(invalid("revizyon zinciri"));
                }
                let r = text(&fields, "reason", 1, 4000).map_err(|e| e.1)?;
                for k in ["postId", "expectedVersion", "reason"] {
                    fields
                        .as_object_mut()
                        .ok_or_else(|| invalid("revizyon alanları"))?
                        .remove(k);
                }
                r
            };
            validate_post(&fields).map_err(|e| e.1)?;
            if make_version(fields, (i + 1) as u64, &reason, &event, &signed) != *v {
                return Err(invalid("yayın metadata'sı imzalı metinle uyuşmuyor"));
            }
        }
    }
    for (id, r) in &d.replies {
        if r["id"] != *id
            || !d.people.contains_key(r["author"].as_str().unwrap_or(""))
            || !r["answered"].is_boolean()
            || !r["resolved"].is_boolean()
        {
            return Err(invalid("yanıt kaydı"));
        }
        let v = post_version(d, r).map_err(|e| e.1)?;
        let quote = text(r, "quote", 1, 10000).map_err(|e| e.1)?;
        if !v["text"].as_str().unwrap().contains(&quote) {
            return Err(invalid("yanıtın kaynak alıntısı"));
        }
        text(r, "text", 1, 10000).map_err(|e| e.1)?;
        let env = Envelope {
            event: string(r, "event").map_err(|e| e.1)?.into(),
            signature: string(r, "signature").map_err(|e| e.1)?.into(),
        };
        let event = verify(&env, false).map_err(|e| e.1)?;
        fields(&event.payload, &["postId", "version", "quote", "text"]).map_err(|e| e.1)?;
        if event.action != "reply"
            || event.id != *id
            || canonical(d, &event.author) != r["author"].as_str().unwrap_or("")
            || event.issued_at != r["createdAt"]
            || ["postId", "version", "quote", "text"]
                .iter()
                .any(|k| event.payload[*k] != r[*k])
        {
            return Err(invalid("yanıt imzası/metadata'sı"));
        }
        if let Some(history) = r.get("statusHistory") {
            let history = history
                .as_array()
                .ok_or_else(|| invalid("yanıt durum geçmişi"))?;
            let mut answered = false;
            let mut resolved = false;
            let mut ids = BTreeSet::new();
            for env in history {
                let env: Envelope =
                    serde_json::from_value(env.clone()).map_err(|_| invalid("durum imzası"))?;
                let status = verify(&env, false).map_err(|e| e.1)?;
                fields(&status.payload, &["replyId", "status"]).map_err(|e| e.1)?;
                if status.action != "reply_status"
                    || status.payload["replyId"] != *id
                    || !ids.insert(status.id.clone())
                {
                    return Err(invalid("durum olay bağlantısı"));
                }
                let actor = canonical(d, &status.author);
                match status.payload["status"].as_str() {
                    Some("answered")
                        if d.posts[r["postId"].as_str().unwrap()]["author"] == actor =>
                    {
                        answered = true
                    }
                    Some("resolved") if r["author"] == actor => resolved = true,
                    Some("open") if r["author"] == actor => resolved = false,
                    _ => return Err(invalid("durum olayı yetkisi")),
                }
            }
            if r["answered"] != answered || r["resolved"] != resolved {
                return Err(invalid("yanıt durumu imzalı geçmişle uyuşmuyor"));
            }
        }
    }
    for (id, c) in &d.comparisons {
        if c["id"] != *id || !d.people.contains_key(c["author"].as_str().unwrap_or("")) {
            return Err(invalid("karşılaştırma kimliği"));
        }
        comparison(d, c).map_err(|e| e.1)?;
        let history = c["history"]
            .as_array()
            .filter(|h| !h.is_empty())
            .ok_or_else(|| invalid("karşılaştırma geçmişi"))?;
        if history.last().unwrap()["assessment"] != c["assessment"] {
            return Err(invalid("karşılaştırma son sürümü"));
        }
        let mut ids = BTreeSet::new();
        for (i, h) in history.iter().enumerate() {
            let env = Envelope {
                event: string(h, "event").map_err(|e| e.1)?.into(),
                signature: string(h, "signature").map_err(|e| e.1)?.into(),
            };
            let e = verify(&env, false).map_err(|e| e.1)?;
            if !ids.insert(e.id.clone())
                || canonical(d, &e.author) != c["author"].as_str().unwrap_or("")
                || h["createdAt"] != e.issued_at
                || h["assessment"] != e.payload["assessment"]
            {
                return Err(invalid("karşılaştırma imzası/metadata'sı"));
            }
            if i == 0 {
                fields(&e.payload, &["left", "right", "assessment"]).map_err(|e| e.1)?;
                if e.action != "compare"
                    || e.id != *id
                    || e.payload["left"] != c["left"]
                    || e.payload["right"] != c["right"]
                    || c["createdAt"] != e.issued_at
                {
                    return Err(invalid("ilk karşılaştırma olayı"));
                }
            } else {
                fields(&e.payload, &["comparisonId", "assessment"]).map_err(|e| e.1)?;
                if e.action != "edit_comparison" || e.payload["comparisonId"] != *id {
                    return Err(invalid("karşılaştırma revizyon olayı"));
                }
            }
            comparison(
                d,
                &json!({"left":c["left"],"right":c["right"],"assessment":h["assessment"]}),
            )
            .map_err(|e| e.1)?;
        }
    }
    for (id, f) in &d.follows {
        if f["id"] != *id || !d.people.contains_key(f["owner"].as_str().unwrap_or("")) {
            return Err(invalid("takip kimliği"));
        }
        let mut raw = f.clone();
        raw.as_object_mut()
            .ok_or_else(|| invalid("takip kaydı"))?
            .remove("id");
        raw.as_object_mut().unwrap().remove("owner");
        tore_core::validate_follow_json(&raw.to_string()).map_err(|e| invalid(&e))?;
    }
    Ok(())
}
fn atomic(path: &Path, bytes: &[u8]) -> std::io::Result<()> {
    let tmp = path.with_extension(format!("{}.tmp", Uuid::new_v4()));
    let result = (|| {
        let mut opts = OpenOptions::new();
        opts.write(true).create_new(true);
        #[cfg(unix)]
        {
            use std::os::unix::fs::OpenOptionsExt;
            opts.mode(0o600);
        }
        let mut f = opts.open(&tmp)?;
        f.write_all(bytes)?;
        f.sync_all()?;
        fs::rename(&tmp, path)?;
        File::open(path.parent().unwrap())?.sync_all()
    })();
    if result.is_err() {
        let _ = fs::remove_file(tmp);
    }
    result
}
fn store_bytes(d: &Data) -> Result<Vec<u8>> {
    let payload = serde_json::to_string(d).map_err(disk)?;
    let wrapper=serde_json::to_vec(&json!({"format":"tore-network-store","version":1,"sha256":hash(payload.as_bytes()),"payload":payload})).map_err(disk)?;
    if wrapper.len() > STORE_LIMIT {
        return Err(bad(
            "Ağ kaydı fiziksel 64 MB sınırını aşıyor; önceki sağlam dosyalara yazılmadı.",
        ));
    }
    Ok(wrapper)
}
fn persist(dir: &Path, d: &Data) -> Result<String> {
    let wrapper = store_bytes(d)?;
    let path = dir.join("ag.json");
    if path.exists() {
        load(&path).map_err(disk)?;
        atomic(&dir.join("ag.onceki.json"), &fs::read(&path).map_err(disk)?).map_err(disk)?;
    }
    atomic(&path, &wrapper).map_err(disk)?;
    Ok(hash(&wrapper))
}
fn portable_fits(value: &Value) -> Result<()> {
    let pretty = serde_json::to_vec_pretty(value).map_err(disk)?;
    let test_event=json!({"version":1,"id":Uuid::nil().to_string(),"author":"x".repeat(43),"issuedAt":now(),"action":"import_network","payload":{"bundle":value}}).to_string();
    let wire = json!({"event":test_event,"signature":"x".repeat(88)}).to_string();
    if pretty.len() > OWN_EXPORT_LIMIT
        || test_event.len() > EVENT_LIMIT - 4096
        || wire.len() > HTTP_LIMIT - 4096
    {
        return Err(bad(
            "Taşınabilir JSON yedeği 16 MB dosya / 24 MB imzalı olay sınırını aşıyor. İşlem yapılmadı; uygulama kapalıyken ağ veri klasörünü bütünüyle kopyalayın.",
        ));
    }
    Ok(())
}
fn network_export(d: &Data, env: Option<&Envelope>) -> Result<Value> {
    let store: Value = serde_json::from_slice(&store_bytes(d)?).map_err(disk)?;
    let sha = hash(store.to_string().as_bytes());
    Ok(
        json!({"format":"tore-node-export","version":1,"store":store,"sha256":sha,"exportEnvelope":env}),
    )
}
fn import_network(d: &mut Data, bundle: &Value, env: &Envelope) -> Result<()> {
    fields(
        bundle,
        &["format", "version", "store", "sha256", "exportEnvelope"],
    )?;
    if bundle["format"] != "tore-node-export" || bundle["version"] != 1 {
        return Err(bad("Tam ağ yedek biçimi desteklenmiyor."));
    }
    let actor = verify(env, false)?;
    let owner = canonical(d, &actor.author);
    if d.people.get(owner).is_none_or(|p| p["admin"] != true) {
        return Err(denied("Tam ağ geri yükleme yalnız yöneticide açık."));
    }
    if d.people.len() != 1
        || !d.posts.is_empty()
        || !d.replies.is_empty()
        || !d.comparisons.is_empty()
        || !d.follows.is_empty()
        || !d.lifecycle_events.is_empty()
    {
        return Err(conflict(
            "Tam ağ yedeği yalnız yeni ve boş, tek yöneticili düğüme geri yüklenebilir; mevcut ağ birleştirilmedi.",
        ));
    }
    let store = &bundle["store"];
    fields(store, &["format", "version", "payload", "sha256"])?;
    if store["format"] != "tore-network-store"
        || store["version"] != 1
        || hash(store.to_string().as_bytes()) != bundle["sha256"]
    {
        return Err(bad("Tam ağ yedeği özeti veya biçimi uyuşmuyor."));
    }
    let payload = string(store, "payload")?;
    if hash(payload.as_bytes()) != store["sha256"] {
        return Err(bad("Tam ağ içeriğinin özeti uyuşmuyor."));
    }
    let mut restored: Data =
        serde_json::from_str(payload).map_err(|_| bad("Tam ağ kayıt şeması bozuk."))?;
    if restored.schema_version != 1 {
        return Err(bad("Ağ şeması desteklenmiyor."));
    }
    validate_data(&restored).map_err(bad)?;
    protect_replay(&mut restored).map_err(bad)?;
    let signed: Envelope = serde_json::from_value(bundle["exportEnvelope"].clone())
        .map_err(|_| bad("Yönetici yedek imzası eksik."))?;
    let export = verify(&signed, false)?;
    fields(&export.payload, &["sha256"])?;
    if export.action != "export_network"
        || export.payload["sha256"] != bundle["sha256"]
        || export.author != actor.author
        || restored
            .people
            .get(canonical(&restored, &export.author))
            .is_none_or(|p| p["admin"] != true || p["suspended"] == true)
        || restored.revoked_keys.contains(&export.author)
    {
        return Err(denied(
            "Yedek bu etkin yönetici anahtarının imzasına bağlı değil.",
        ));
    }
    store_bytes(&restored)?;
    *d = restored;
    Ok(())
}
fn post_version<'a>(d: &'a Data, r: &Value) -> Result<&'a Value> {
    let id = string(r, "postId")?;
    let n = r["version"]
        .as_u64()
        .ok_or_else(|| bad("Yayın sürümü gerekli."))?;
    d.posts
        .get(id)
        .and_then(|p| p["versions"].as_array())
        .and_then(|v| v.iter().find(|x| x["version"] == n))
        .ok_or_else(|| bad("Yayın veya belirtilen sürüm bulunamadı."))
}
fn latest(p: &Value) -> &Value {
    p["versions"].as_array().unwrap().last().unwrap()
}
fn lower(s: &str) -> String {
    s.replace('I', "ı").replace('İ', "i").to_lowercase()
}
fn matches(f: &Value, p: &Value) -> bool {
    let v = latest(p);
    let scope = f["scope"].as_str().unwrap_or("");
    let target = f["targetId"].as_str().unwrap_or("");
    let base = match scope {
        "author" => p["author"] == target,
        "topic" => lower(v["topic"].as_str().unwrap_or("")) == lower(target),
        "post" | "discussion" => p["id"] == target,
        _ => false,
    };
    base && ["topic", "subtopic", "area"].iter().all(|k| {
        f[*k].is_null()
            || lower(f[*k].as_str().unwrap_or("")) == lower(v[*k].as_str().unwrap_or(""))
    })
}
fn notify(d: &mut Data, pid: &str, actor: &str, kind: &str, reply_id: Option<&str>) {
    let p = &d.posts[pid];
    let flag = match kind {
        "post" => "notifyPosts",
        "change" => "notifyChanges",
        _ => "notifyReplies",
    };
    let recipients: BTreeSet<String> = d
        .follows
        .values()
        .filter(|f| f["owner"] != actor && f[flag] == true && matches(f, p))
        .filter_map(|f| f["owner"].as_str().map(str::to_owned))
        .collect();
    for owner in recipients {
        d.notifications.push(json!({"id":Uuid::new_v4().to_string(),"owner":owner,"postId":pid,"replyId":reply_id,"actor":actor,"kind":kind,"read":false,"createdAt":now()}));
    }
}
fn public_person(p: &Value) -> Value {
    json!({"id":p["id"],"name":p["name"],"bio":p["bio"],"admin":p["admin"],"suspended":p["suspended"] == true,"recoveryPublicKey":p["recoveryPublicKey"]})
}
fn snapshot(d: &Data, e: &Event) -> Result<Value> {
    let f = &e.payload;
    fields(
        f,
        &[
            "feed", "targetId", "topic", "subtopic", "area", "page", "pageSize",
        ],
    )?;
    let page = f
        .get("page")
        .map(|v| {
            v.as_u64()
                .filter(|n| *n >= 1 && *n <= 100_000)
                .ok_or_else(|| bad("Sayfa 1–100000 arasında olmalı."))
        })
        .transpose()?
        .unwrap_or(1);
    let page_size = f
        .get("pageSize")
        .map(|v| {
            v.as_u64()
                .filter(|n| *n >= 1 && *n <= 100)
                .ok_or_else(|| bad("Sayfa boyutu 1–100 arasında olmalı."))
        })
        .transpose()?
        .unwrap_or(100);
    let feed = f["feed"].as_str().unwrap_or("all");
    if !["all", "following", "author", "topic", "post", "discussion"].contains(&feed) {
        return Err(bad("Akış türü geçersiz."));
    }
    let follows: Vec<Value> = d
        .follows
        .values()
        .filter(|v| v["owner"] == e.author)
        .cloned()
        .collect();
    let mut posts: Vec<Value> = d.posts.values().cloned().collect();
    posts.sort_by(|a, b| b["createdAt"].as_str().cmp(&a["createdAt"].as_str()));
    let filter = json!({"scope":feed,"targetId":f["targetId"],"topic":f["topic"],"subtopic":f["subtopic"],"area":f["area"]});
    let ids: Vec<Value> = posts
        .iter()
        .filter(|p| match feed {
            "all" => ["topic", "subtopic", "area"].iter().all(|k| {
                f[*k].is_null()
                    || lower(f[*k].as_str().unwrap_or(""))
                        == lower(latest(p)[*k].as_str().unwrap_or(""))
            }),
            "following" => {
                follows.iter().any(|x| matches(x, p))
                    && ["topic", "subtopic", "area"].iter().all(|k| {
                        f[*k].is_null()
                            || lower(f[*k].as_str().unwrap_or(""))
                                == lower(latest(p)[*k].as_str().unwrap_or(""))
                    })
            }
            _ => matches(&filter, p),
        })
        .map(|p| p["id"].clone())
        .collect();
    let total = ids.len();
    let ids: Vec<Value> = ids
        .into_iter()
        .skip(((page - 1) * page_size) as usize)
        .take(page_size as usize)
        .collect();
    let selected: BTreeSet<&str> = ids.iter().filter_map(Value::as_str).collect();
    let comparisons: Vec<&Value> = d
        .comparisons
        .values()
        .filter(|c| {
            selected.contains(c["left"]["postId"].as_str().unwrap_or(""))
                || selected.contains(c["right"]["postId"].as_str().unwrap_or(""))
        })
        .collect();
    let mut context_ids = selected.clone();
    for c in &comparisons {
        for side in ["left", "right"] {
            if let Some(id) = c[side]["postId"].as_str() {
                context_ids.insert(id);
            }
        }
    }
    posts.retain(|p| context_ids.contains(p["id"].as_str().unwrap_or("")));
    let replies: Vec<Value> = d
        .replies
        .values()
        .filter(|r| selected.contains(r["postId"].as_str().unwrap_or("")))
        .map(|r| {
            let mut out = r.clone();
            out["statusVerified"] = json!(r.get("statusHistory").is_some());
            out
        })
        .collect();
    let notifications: Vec<&Value> = d
        .notifications
        .iter()
        .rev()
        .filter(|n| n["owner"] == e.author)
        .take(500)
        .collect();
    Ok(
        json!({"me":public_person(&d.people[&e.author]),"people":d.people.values().map(public_person).collect::<Vec<_>>(),"posts":posts,"replies":replies,"comparisons":comparisons,"follows":follows,"notifications":notifications,"feedIds":ids,"pagination":{"page":page,"pageSize":page_size,"total":total,"hasMore":page * page_size < total as u64}}),
    )
}
fn validate_post(p: &Value) -> Result<Value> {
    let mut core = p.clone();
    if let Some(provenance) = core
        .as_object_mut()
        .ok_or_else(|| bad("Yayın nesnesi gerekli."))?
        .remove("provenance")
    {
        fields(
            &provenance,
            &[
                "representation",
                "profileName",
                "editor",
                "revisionIds",
                "sources",
                "createdAt",
            ],
        )?;
        if !["self", "thinker", "analysis"].contains(&string(&provenance, "representation")?) {
            return Err(bad("Temsil türü geçersiz."));
        }
        text(&provenance, "profileName", 1, 180)?;
        text(&provenance, "editor", 0, 200)?;
        chrono::DateTime::parse_from_rfc3339(string(&provenance, "createdAt")?)
            .map_err(|_| bad("Kaynak paketi tarihi geçersiz."))?;
        let revisions = provenance["revisionIds"]
            .as_array()
            .filter(|v| v.len() <= 100)
            .ok_or_else(|| bad("En fazla 100 kaynak görüş revizyonu olabilir."))?;
        for id in revisions {
            uuid(
                id.as_str()
                    .ok_or_else(|| bad("Revizyon kimliği metin olmalı."))?,
            )?;
        }
        let sources = provenance["sources"]
            .as_array()
            .filter(|v| v.len() <= 100)
            .ok_or_else(|| bad("En fazla 100 kaynak olabilir."))?;
        for source in sources {
            fields(source, &["label", "url"])?;
            text(source, "label", 1, 300)?;
            let raw = text(source, "url", 0, 4096)?;
            if raw.is_empty() {
                continue;
            }
            let url: axum::http::Uri = raw
                .split('#')
                .next()
                .unwrap_or("")
                .parse()
                .map_err(|_| bad("Kaynak bağlantısı geçersiz."))?;
            if ![Some("http"), Some("https")].contains(&url.scheme_str())
                || url.host().is_none()
                || url.authority().is_some_and(|a| a.as_str().contains('@'))
            {
                return Err(bad(
                    "Kaynak bağlantısı yalnız HTTP/HTTPS olabilir; kimlik bilgisi içeremez.",
                ));
            }
        }
        if provenance["representation"] == "thinker"
            && (sources.is_empty() || string(&provenance, "editor")?.trim().is_empty())
        {
            return Err(bad(
                "Düşünür temsili için derleyen ve en az bir kaynak gerekli.",
            ));
        }
    }
    tore_core::validate_post_json(&core.to_string()).map_err(bad)?;
    Ok(p.clone())
}
fn make_version(fields: Value, n: u64, reason: &str, e: &Event, env: &Envelope) -> Value {
    let mut v = fields;
    v["version"] = json!(n);
    v["reason"] = json!(reason);
    v["createdAt"] = json!(e.issued_at);
    v["event"] = json!(env.event);
    v["signature"] = json!(env.signature);
    v
}
fn comparison(d: &Data, p: &Value) -> Result<()> {
    let side = |r: &Value| -> Result<Value> {
        fields(r, &["postId", "version"])?;
        let v = post_version(d, r)?;
        Ok(
            json!({"id":format!("{}:{}",r["postId"].as_str().unwrap(),r["version"]),"question":v["title"],"text":v["text"],"area":v["area"],"kind":v["viewType"],"bridge":"","sources":[]}),
        )
    };
    let c =
        json!({"left":side(&p["left"])? ,"right":side(&p["right"])? ,"assessment":p["assessment"]});
    tore_core::validate_comparison_json(&c.to_string()).map_err(bad)?;
    Ok(())
}
fn profile_payload(p: &Value) -> Result<()> {
    text(p, "name", 1, 80)?;
    text(p, "bio", 0, 4000)?;
    Ok(())
}
fn apply(d: &mut Data, e: &Event, env: &Envelope) -> Result<Value> {
    let p = &e.payload;
    let id = &e.id;
    let author = &e.author;
    match e.action.as_str() {
        "register" => {
            fields(p, &["name", "bio", "invite"])?;
            profile_payload(p)?;
            if d.people.contains_key(author)
                || d.aliases.contains_key(author)
                || d.people.values().any(|p| p["recoveryPublicKey"] == *author)
            {
                return Err(conflict(
                    "Bu kimlik zaten kayıtlı; anahtarı açıp giriş yapın.",
                ));
            }
            if d.people.len() >= 200 {
                return Err(bad("Bu küçük ağ prototipi en fazla 200 üyeyi destekliyor."));
            }
            let code = string(p, "invite")?;
            let ih = hash(code.as_bytes());
            let inv = d
                .invites
                .get(&ih)
                .ok_or_else(|| denied("Davet kodu geçersiz veya kullanılmış."))?;
            if inv["expiresAt"].as_i64().unwrap_or(0) < Utc::now().timestamp() {
                return Err(denied("Davetin süresi dolmuş."));
            }
            let admin = d.people.is_empty();
            d.invites.remove(&ih);
            if admin {
                d.founder = Some(author.clone());
            }
            d.people.insert(author.clone(),json!({"id":author,"name":p["name"],"bio":p["bio"],"admin":admin,"profileEvent":env}));
        }
        "rotate_key" | "set_recovery_key" | "recover_key" | "transfer_admin" | "suspend_member" => {
            lifecycle(d, e, env)?
        }
        "profile" => {
            fields(p, &["name", "bio"])?;
            profile_payload(p)?;
            let user = d.people.get_mut(author).unwrap();
            user["name"] = p["name"].clone();
            user["bio"] = p["bio"].clone();
            user["profileEvent"] = json!(env);
        }
        "create_invite" => {
            fields(p, &["label"])?;
            text(p, "label", 1, 100)?;
            if d.people[author]["admin"] != true {
                return Err(denied("Davet oluşturma yalnız ağ kurucusunda açık."));
            }
            if d.invites.len() >= 100 {
                return Err(bad("En fazla 100 etkin davet olabilir."));
            }
            let code = format!("{}{}", Uuid::new_v4().simple(), Uuid::new_v4().simple());
            d.invites.insert(
                hash(code.as_bytes()),
                json!({"label":p["label"],"expiresAt":Utc::now().timestamp()+604800}),
            );
            return Ok(json!({"ok":true,"code":code}));
        }
        "create_post" => {
            if d.posts.contains_key(id) {
                return Err(conflict("Bu yayın kimliği zaten var; üzerine yazılmadı."));
            }
            let fields = validate_post(p)?;
            if d.posts.len() >= 5000 {
                return Err(bad("Bu prototipte en fazla 5000 yayın saklanabilir."));
            }
            d.posts.insert(id.clone(),json!({"id":id,"author":author,"createdAt":e.issued_at,"currentVersion":1,"versions":[make_version(fields,1,"",e,env)]}));
            notify(d, id, author, "post", None);
        }
        "revise_post" => {
            fields(
                p,
                &[
                    "postId",
                    "expectedVersion",
                    "reason",
                    "title",
                    "text",
                    "topic",
                    "subtopic",
                    "area",
                    "viewType",
                    "provenance",
                ],
            )?;
            let pid = string(p, "postId")?;
            let reason = text(p, "reason", 1, 4000)?;
            let old = d.posts.get(pid).ok_or_else(|| bad("Yayın bulunamadı."))?;
            if old["author"] != *author {
                return Err(denied("Başka bir kişinin yayınını düzenleyemezsiniz."));
            }
            if old["currentVersion"] != p["expectedVersion"] {
                return Err(conflict("Yayın değişmiş; güncel sürümü açın."));
            }
            let n = old["currentVersion"].as_u64().unwrap() + 1;
            let mut data = p.clone();
            for k in ["postId", "expectedVersion", "reason"] {
                data.as_object_mut().unwrap().remove(k);
            }
            validate_post(&data)?;
            let item = d.posts.get_mut(pid).unwrap();
            item["versions"]
                .as_array_mut()
                .unwrap()
                .push(make_version(data, n, &reason, e, env));
            item["currentVersion"] = json!(n);
            notify(d, pid, author, "change", None);
        }
        "reply" => {
            fields(p, &["postId", "version", "quote", "text"])?;
            let v = post_version(d, p)?;
            let quote = text(p, "quote", 1, 10000)?;
            text(p, "text", 1, 10000)?;
            if !v["text"].as_str().unwrap().contains(&quote) {
                return Err(bad("Alıntı seçilen yayın sürümünde birebir bulunamadı."));
            }
            let pid = string(p, "postId")?;
            d.replies.insert(id.clone(),json!({"id":id,"author":author,"postId":pid,"version":p["version"],"quote":quote,"text":p["text"],"createdAt":e.issued_at,"answered":false,"resolved":false,"statusHistory":[],"event":env.event,"signature":env.signature}));
            notify(d, pid, author, "reply", Some(id));
        }
        "reply_status" => {
            fields(p, &["replyId", "status"])?;
            let rid = string(p, "replyId")?;
            let reply = d.replies.get(rid).ok_or_else(|| bad("Yanıt bulunamadı."))?;
            let status = string(p, "status")?;
            match status {
                "answered" => {
                    if d.posts[reply["postId"].as_str().unwrap()]["author"] != *author {
                        return Err(denied(
                            "Yanıtlandı işaretini yalnız yayın sahibi koyabilir.",
                        ));
                    }
                    d.replies.get_mut(rid).unwrap()["answered"] = json!(true);
                }
                "resolved" | "open" => {
                    if reply["author"] != *author {
                        return Err(denied(
                            "Çözüldü veya açık kararını yalnız itirazı yazan kişi verebilir.",
                        ));
                    }
                    d.replies.get_mut(rid).unwrap()["resolved"] = json!(status == "resolved");
                }
                _ => return Err(bad("Geçersiz yanıt durumu.")),
            }
            // Old 0.3 records retain their unverified legacy statuses; new replies have a complete chain.
            if let Some(history) = d
                .replies
                .get_mut(rid)
                .unwrap()
                .get_mut("statusHistory")
                .and_then(Value::as_array_mut)
            {
                history.push(json!(env));
            }
        }
        "compare" => {
            fields(p, &["left", "right", "assessment"])?;
            comparison(d, p)?;
            d.comparisons.insert(id.clone(),json!({"id":id,"author":author,"left":p["left"],"right":p["right"],"assessment":p["assessment"],"createdAt":e.issued_at,"history":[{"assessment":p["assessment"],"createdAt":e.issued_at,"event":env.event,"signature":env.signature}]}));
        }
        "edit_comparison" => {
            fields(p, &["comparisonId", "assessment"])?;
            let cid = string(p, "comparisonId")?;
            let c = d
                .comparisons
                .get(cid)
                .ok_or_else(|| bad("Karşılaştırma bulunamadı."))?;
            if c["author"] != *author {
                return Err(denied("Bu karşılaştırmayı yalnız yazarı düzenleyebilir."));
            }
            comparison(
                d,
                &json!({"left":c["left"],"right":c["right"],"assessment":p["assessment"]}),
            )?;
            let c = d.comparisons.get_mut(cid).unwrap();
            c["assessment"] = p["assessment"].clone();
            c["history"].as_array_mut().unwrap().push(json!({"assessment":p["assessment"],"createdAt":e.issued_at,"event":env.event,"signature":env.signature}));
        }
        "follow" => {
            tore_core::validate_follow_json(&p.to_string()).map_err(bad)?;
            match string(p, "scope")? {
                "author" => {
                    if !d.people.contains_key(string(p, "targetId")?) {
                        return Err(bad("Takip edilecek kişi bulunamadı."));
                    }
                }
                "post" | "discussion" => {
                    if !d.posts.contains_key(string(p, "targetId")?) {
                        return Err(bad("Takip edilecek yayın bulunamadı."));
                    }
                }
                _ => {}
            }
            let mut f = p.clone();
            let same = d
                .follows
                .iter()
                .find(|(_, x)| {
                    x["owner"] == *author
                        && ["scope", "targetId", "topic", "subtopic", "area"]
                            .iter()
                            .all(|k| x[*k] == p[*k])
                })
                .map(|(k, _)| k.clone());
            let fid = same.unwrap_or_else(|| id.clone());
            f["id"] = json!(fid);
            f["owner"] = json!(author);
            d.follows.insert(fid.clone(), f);
            return Ok(json!({"ok":true,"id":fid}));
        }
        "unfollow" => {
            fields(p, &["id"])?;
            let fid = string(p, "id")?;
            if d.follows.get(fid).is_none_or(|f| f["owner"] != *author) {
                return Err(denied("Takip kaydı bulunamadı veya size ait değil."));
            }
            d.follows.remove(fid);
        }
        "notifications_read" => {
            fields(p, &[])?;
            for n in &mut d.notifications {
                if n["owner"] == *author {
                    n["read"] = json!(true);
                }
            }
        }
        "import" => {
            fields(p, &["bundle"])?;
            import(d, &p["bundle"], author, &verify(env, false)?.author)?;
        }
        "import_network" => {
            fields(p, &["bundle"])?;
            import_network(d, &p["bundle"], env)?;
        }
        _ => return Err(bad("Desteklenmeyen işlem.")),
    }
    Ok(json!({"ok":true,"id":id}))
}
fn import(d: &mut Data, b: &Value, author: &str, signer_key: &str) -> Result<()> {
    fields(
        b,
        &[
            "format",
            "version",
            "author",
            "profileEvent",
            "posts",
            "exportedAt",
            "identity",
        ],
    )?;
    if b["format"] != "tore-network-export" || ![json!(1), json!(2)].contains(&b["version"]) {
        return Err(bad("Taşınabilir veri biçimi desteklenmiyor."));
    }
    let owner = string(b, "author")?;
    let mut identity_data = Data::default();
    let signer = author;
    if b["version"] == 2 {
        let identity = &b["identity"];
        fields(
            identity,
            &["aliases", "revokedKeys", "events", "recoveryPublicKey"],
        )?;
        identity_data.aliases = serde_json::from_value(identity["aliases"].clone())
            .map_err(|_| bad("Anahtar bağları bozuk."))?;
        identity_data.revoked_keys = serde_json::from_value(identity["revokedKeys"].clone())
            .map_err(|_| bad("İptal anahtarları bozuk."))?;
        identity_data.lifecycle_events = serde_json::from_value(identity["events"].clone())
            .map_err(|_| bad("Anahtar geçmişi bozuk."))?;
        identity_data.founder = Some(owner.to_owned());
        identity_data.people.insert(
            owner.to_owned(),
            json!({"id":owner,"admin":true,"recoveryPublicKey":identity["recoveryPublicKey"]}),
        );
        validate_lifecycle(&identity_data).map_err(bad)?;
        if canonical(&identity_data, signer_key) != owner
            || identity_data.revoked_keys.contains(signer_key)
        {
            return Err(denied("Yedek güncel imza anahtarınıza bağlı değil."));
        }
        if owner != author
            && (d.people.contains_key(owner)
                || d.aliases.contains_key(owner)
                || d.posts.values().any(|p| p["author"] == author)
                || d.replies.values().any(|p| p["author"] == author)
                || d.comparisons.values().any(|p| p["author"] == author)
                || d.lifecycle_events
                    .iter()
                    .any(|env| verify(env, false).is_ok_and(|e| canonical(d, &e.author) == author)))
        {
            return Err(conflict(
                "Kanonik kimlik dolu hedefe taşınamaz; boş yeni kimlik kullanın.",
            ));
        }
    } else if owner != author {
        return Err(bad("Yedek kimliği uyuşmuyor."));
    }
    let author = owner;
    let profile: Envelope = serde_json::from_value(b["profileEvent"].clone())
        .map_err(|_| bad("İmzalı profil eksik."))?;
    let pe = verify(&profile, false)?;
    if canonical(&identity_data, &pe.author) != author
        || !["register", "profile"].contains(&pe.action.as_str())
    {
        return Err(bad("Profil imzası kimlikle uyuşmuyor."));
    }
    profile_payload(&pe.payload)?;
    let posts = b["posts"]
        .as_array()
        .ok_or_else(|| bad("Yayınlar dizisi gerekli."))?;
    if posts.len() > 5000 {
        return Err(bad("Yayın sınırı aşıldı."));
    }
    let mut imported = BTreeMap::new();
    let mut imported_ids = BTreeSet::new();
    for supplied in posts {
        let pid = string(supplied, "id")?;
        uuid(pid)?;
        if d.posts.contains_key(pid) || imported.contains_key(pid) {
            return Err(conflict(
                "Aynı kimlikli yayın zaten var; üzerine yazılmadı.",
            ));
        }
        let versions = supplied["versions"]
            .as_array()
            .ok_or_else(|| bad("Yayın sürümleri eksik."))?;
        if versions.is_empty() || versions.len() > 1000 {
            return Err(bad("Yayın sürüm sayısı geçersiz."));
        }
        let mut recreated = json!(null);
        for (i, v) in versions.iter().enumerate() {
            let env = Envelope {
                event: string(v, "event")?.to_owned(),
                signature: string(v, "signature")?.to_owned(),
            };
            let event = verify(&env, false)?;
            if d.seen.contains(&event.id) || !imported_ids.insert(event.id.clone()) {
                return Err(conflict(
                    "İçe aktarılan olay kimliği zaten var veya yineleniyor.",
                ));
            }
            if canonical(&identity_data, &event.author) != author {
                return Err(bad("Başkasının yayını içe aktarılamaz."));
            }
            let mut fields = event.payload.clone();
            let reason;
            if i == 0 {
                if event.action != "create_post" || event.id != pid {
                    return Err(bad("İlk yayın olayı uyuşmuyor."));
                }
                reason = String::new();
                recreated = json!({"id":pid,"author":author,"createdAt":event.issued_at,"currentVersion":versions.len(),"versions":[]});
            } else {
                if event.action != "revise_post"
                    || fields["postId"] != pid
                    || fields["expectedVersion"] != i
                {
                    return Err(bad("Sürüm zinciri uyuşmuyor."));
                }
                reason = text(&fields, "reason", 1, 4000)?;
                for k in ["postId", "expectedVersion", "reason"] {
                    fields.as_object_mut().unwrap().remove(k);
                }
            }
            validate_post(&fields)?;
            let re = make_version(fields, (i + 1) as u64, &reason, &event, &env);
            if re != *v {
                return Err(bad("Yayın metadata'sı imzalı içerikle uyuşmuyor."));
            }
            recreated["versions"].as_array_mut().unwrap().push(re);
        }
        if recreated != *supplied {
            return Err(bad("Yayın metadata'sı imzalı zincirle uyuşmuyor."));
        }
        imported.insert(pid.to_owned(), recreated);
    }
    if d.posts.len() + imported.len() > 5000 {
        return Err(bad("Yayın sınırı aşıldı."));
    }
    if author != signer {
        let mut person = d
            .people
            .remove(signer)
            .ok_or_else(|| bad("Hedef üyelik bulunamadı."))?;
        person["id"] = json!(author);
        d.people.insert(author.to_owned(), person);
        if d.founder.as_deref() == Some(signer) {
            d.founder = Some(author.to_owned());
        }
    }
    if b["version"] == 2 {
        for (key, owner) in identity_data.aliases {
            if d.people.contains_key(&key)
                || d.aliases
                    .get(&key)
                    .is_some_and(|existing| existing != &owner)
            {
                return Err(conflict("Anahtar başka hedef kimlikte kullanılıyor."));
            }
            d.aliases.insert(key, owner);
        }
        d.revoked_keys.extend(identity_data.revoked_keys);
        for env in identity_data.lifecycle_events {
            let e = verify(&env, false)?;
            if d.seen.contains(&e.id) {
                return Err(conflict("Anahtar geçmişi olayı hedefte zaten var."));
            }
            imported_ids.insert(e.id);
            d.lifecycle_events.push(env);
        }
    }
    let user = d
        .people
        .get_mut(author)
        .ok_or_else(|| bad("Hedef üyelik bulunamadı."))?;
    if b["version"] == 2 && !b["identity"]["recoveryPublicKey"].is_null() {
        user["recoveryPublicKey"] = b["identity"]["recoveryPublicKey"].clone();
    }

    user["name"] = pe.payload["name"].clone();
    user["bio"] = pe.payload["bio"].clone();
    user["profileEvent"] = json!(profile);
    for (k, v) in imported {
        d.posts.insert(k, v);
    }
    imported_ids.insert(pe.id);
    d.seen.extend(imported_ids);
    validate_data(d).map_err(bad)?;
    Ok(())
}
async fn event(
    State(app): State<App>,
    headers: HeaderMap,
    Json(env): Json<Envelope>,
) -> Result<Json<Value>> {
    // No cookies or ambient authority. Host/Origin guards also reject DNS rebinding and cross-site requests.
    let expected =
        axum::http::Uri::try_from(&app.origin).map_err(|_| bad("Sunucu adresi bozuk."))?;
    if headers.get("host").and_then(|h| h.to_str().ok()) != expected.authority().map(|a| a.as_str())
    {
        return Err(denied("Sunucu adresi uyuşmuyor."));
    }
    if let Some(origin) = headers.get("origin") {
        if origin.to_str().ok() != Some(app.origin.as_str()) {
            return Err(denied("Bu kaynaktan istek kabul edilmiyor."));
        }
    }
    let mut e = verify(&env, true)?;
    let mut data = app.inner.lock().await;
    let signer = e.author.clone();
    if data.revoked_keys.contains(&signer) {
        return Err(denied(
            "Bu imza anahtarı iptal edilmiş; güncel anahtarı veya kurtarma anahtarını kullanın.",
        ));
    }
    if e.action == "recover_key" {
        let target = string(&e.payload, "targetId")?;
        if data
            .people
            .get(target)
            .is_none_or(|p| p["recoveryPublicKey"] != signer || p["suspended"] == true)
        {
            return Err(denied("Kurtarma yetkisi bulunamadı veya üyelik askıda."));
        }
        e.author = target.to_owned();
    } else {
        e.author = canonical(&data, &signer).to_owned();
    }
    if data
        .people
        .get(&e.author)
        .is_some_and(|p| p["suspended"] == true)
    {
        return Err(denied(
            "Bu üyelik askıya alınmış; ağ yöneticisine başvurun.",
        ));
    }
    if e.action != "register" && !data.people.contains_key(&e.author) {
        return Err(denied(
            "Bu ağa katılmak için geçerli bir davetle kayıt olun.",
        ));
    }
    app.traffic
        .lock()
        .map_err(|_| disk("İstek denetimi kilidi alınamadı."))?
        .check(&e)?;
    if data.seen.contains(&e.id) {
        return Err(conflict("Bu imzalı işlem daha önce işlendi; yinelenmedi."));
    }
    if e.action == "snapshot" {
        let out = snapshot(&data, &e)?;
        app.traffic
            .lock()
            .map_err(|_| disk("İstek denetimi kilidi alınamadı."))?
            .read(&e)?;
        return Ok(Json(out));
    }
    if ["prepare_network_export", "export_network"].contains(&e.action.as_str()) {
        if data.people[&e.author]["admin"] != true {
            return Err(denied("Tam ağ yedeği yalnız yöneticide açık."));
        }
        let out = if e.action == "prepare_network_export" {
            fields(&e.payload, &[])?;
            network_export(&data, None)?
        } else {
            fields(&e.payload, &["sha256"])?;
            let out = network_export(&data, Some(&env))?;
            if e.payload["sha256"] != out["sha256"] {
                return Err(conflict(
                    "Ağ yedek önizlemesinden sonra değişmiş; yeniden hazırlayın.",
                ));
            }
            out
        };
        portable_fits(&out)?;
        app.traffic
            .lock()
            .map_err(|_| disk("İstek denetimi kilidi alınamadı."))?
            .read(&e)?;
        return Ok(Json(out));
    }
    if e.action == "export" {
        fields(&e.payload, &[])?;
        let identity_events: Vec<&Envelope> = data
            .lifecycle_events
            .iter()
            .filter(|env| {
                verify(env, false).is_ok_and(|event| {
                    ["rotate_key", "set_recovery_key", "recover_key"]
                        .contains(&event.action.as_str())
                        && if event.action == "recover_key" {
                            event.payload["targetId"] == e.author
                        } else {
                            canonical(&data, &event.author) == e.author
                        }
                })
            })
            .collect();
        let aliases: BTreeMap<&String, &String> = data
            .aliases
            .iter()
            .filter(|(_, owner)| *owner == &e.author)
            .collect();
        let revoked: Vec<&String> = data
            .revoked_keys
            .iter()
            .filter(|key| canonical(&data, key) == e.author)
            .collect();
        let out = json!({"format":"tore-network-export","version":2,"author":e.author,"profileEvent":data.people[&e.author]["profileEvent"],"posts":data.posts.values().filter(|p|p["author"]==e.author).collect::<Vec<_>>(),"exportedAt":now(),"identity":{"aliases":aliases,"revokedKeys":revoked,"events":identity_events,"recoveryPublicKey":data.people[&e.author]["recoveryPublicKey"]}});
        portable_fits(&out)?;
        app.traffic
            .lock()
            .map_err(|_| disk("İstek denetimi kilidi alınamadı."))?
            .read(&e)?;
        return Ok(Json(out));
    }
    if data.seen.contains(&e.id) {
        return Err(conflict("Bu imzalı işlem daha önce işlendi; yinelenmedi."));
    }
    if !app.healthy.load(Ordering::SeqCst) {
        return Err(Error(StatusCode::SERVICE_UNAVAILABLE,"Önceki disk yazması başarısız oldu. Veri klasörünü denetleyip Töre’yi yeniden başlatın.".into()));
    }
    let mut next = data.clone();
    let out = apply(&mut next, &e, &env)?;
    next.seen.insert(e.id);
    validate_data(&next).map_err(bad)?;
    let mut expected = app
        .disk_hash
        .lock()
        .map_err(|_| disk("Disk denetimi kilidi alınamadı."))?;
    let actual = fs::read(app.dir.join("ag.json")).map(|bytes| hash(&bytes));
    if actual.as_ref().ok() != Some(&*expected) {
        app.healthy.store(false, Ordering::SeqCst);
        return Err(Error(StatusCode::SERVICE_UNAVAILABLE,"Ağ kaydı diskte değişmiş veya okunamıyor. Üzerine yazılmadı; klasörü denetleyip Töre’yi yeniden başlatın.".into()));
    }
    match persist(&app.dir, &next) {
        Ok(digest) => *expected = digest,
        Err(err) => {
            if err.0 != StatusCode::BAD_REQUEST {
                app.healthy.store(false, Ordering::SeqCst);
            }
            return Err(err);
        }
    }
    *data = next;
    Ok(Json(out))
}
async fn info(State(app): State<App>) -> Json<Value> {
    let d = app.inner.lock().await;
    Json(
        json!({"name":"Töre","version":env!("CARGO_PKG_VERSION"),"memberCount":d.people.len(),"origin":app.origin,"storageHealthy":app.healthy.load(Ordering::SeqCst)}),
    )
}
async fn assets(axum::extract::Path(path): axum::extract::Path<String>) -> Response {
    crate::assets::asset(&path)
}
pub struct DesktopConfig {
    pub archive_root: PathBuf,
    pub token: String,
    pub runtime_path: Option<PathBuf>,
}
pub async fn run(
    args: Vec<String>,
    desktop: Option<DesktopConfig>,
) -> std::result::Result<(), String> {
    let mut dir = PathBuf::from("Töre Ağ Verileri");
    let mut listen = "127.0.0.1:4317".to_string();
    let mut origin = None;
    let mut cert = None;
    let mut key = None;
    let mut recover = false;
    let mut open_browser = false;
    let mut i = 0;
    while i < args.len() {
        match args[i].as_str() {
            "--data" | "--listen" | "--origin" | "--tls-cert" | "--tls-key" => {
                let v = args.get(i + 1).ok_or("Seçenek değeri eksik.")?.clone();
                match args[i].as_str() {
                    "--data" => dir = PathBuf::from(v),
                    "--listen" => listen = v,
                    "--origin" => origin = Some(v),
                    "--tls-cert" => cert = Some(v),
                    _ => key = Some(v),
                }
                i += 2;
            }
            "--recover" => {
                recover = true;
                i += 1;
            }
            "--open" => {
                open_browser = true;
                i += 1;
            }
            "--help" => {
                println!(
                    "Töre 0.10.0\n--data KLASÖR --listen 127.0.0.1:4317\nLAN için: --listen IP:PORT --origin https://ADRES:PORT --tls-cert sertifika.pem --tls-key anahtar.pem\n--recover yalnız doğrulanmış önceki ağ kaydından açık kurtarma yapar."
                );
                return Ok(());
            }
            _ => return Err("Bilinmeyen seçenek; --help kullanın.".into()),
        }
    }
    let address: SocketAddr = listen
        .parse()
        .map_err(|_| "Dinleme adresi IP:PORT biçiminde olmalı.")?;
    if desktop.is_some() && !address.ip().is_loopback() {
        return Err("Özel yerel arşiv yalnız loopback adresinde açılabilir.".into());
    }
    if !address.ip().is_loopback() && (cert.is_none() || key.is_none() || origin.is_none()) {
        return Err("Ağa açmak için açık HTTPS origin ve TLS sertifika/anahtar dosyaları gerekli. Varsayılan yalnız bu bilgisayardır.".into());
    }
    if cert.is_some() != key.is_some() {
        return Err("TLS sertifikası ve anahtarı birlikte gerekli.".into());
    }
    if dir.join("arsiv.json").exists() || dir.join("raporlar").exists() {
        return Err(
            "Bu klasör yerel Markdown arşivi içeriyor. Ağ verileri için ayrı bir klasör seçin."
                .into(),
        );
    }
    fs::create_dir_all(&dir).map_err(|e| e.to_string())?;
    #[cfg(unix)]
    {
        use std::os::unix::fs::PermissionsExt;
        fs::set_permissions(&dir, fs::Permissions::from_mode(0o700)).map_err(|e| e.to_string())?;
    }
    let _lock = OpenOptions::new()
        .read(true)
        .write(true)
        .create(true)
        .truncate(false)
        .open(dir.join("ag.lock"))
        .map_err(|e| e.to_string())?;
    _lock
        .try_lock_exclusive()
        .map_err(|_| "Bu ağ veri klasörü başka bir Töre sürecinde açık.")?;
    let path = dir.join("ag.json");
    if recover {
        let backup = dir.join("ag.onceki.json");
        load(&backup)?;
        if path.exists() {
            let broken = dir.join(format!("ag.bozuk.{}.json", Utc::now().timestamp_millis()));
            fs::copy(&path, broken).map_err(|e| e.to_string())?;
        }
        atomic(&path, &fs::read(backup).map_err(|e| e.to_string())?).map_err(|e| e.to_string())?;
    }
    let mut data = if path.exists() {
        load(&path).map_err(|e|format!("{e} Sessiz sıfırlama yapılmadı. Yedeği koruyun; --recover önceki sağlam kaydı açıkça geri alır."))?
    } else {
        if dir.join("ag.onceki.json").exists() {
            return Err(
                "Ana ağ kaydı eksik; önceki kayıt var. --recover ile açık kurtarma yapın.".into(),
            );
        }
        Data::default()
    };
    let mut bootstrap = None;
    if data.people.is_empty() {
        let code = format!("{}{}", Uuid::new_v4().simple(), Uuid::new_v4().simple());
        data.invites.clear();
        data.invites.insert(
            hash(code.as_bytes()),
            json!({"label":"Ağ kurucusu","expiresAt":Utc::now().timestamp()+604800}),
        );
        persist(&dir, &data).map_err(|e| e.1)?;
        bootstrap = Some(code);
    }
    let listener = std::net::TcpListener::bind(address).map_err(|e| e.to_string())?;
    listener.set_nonblocking(true).map_err(|e| e.to_string())?;
    let actual = listener.local_addr().map_err(|e| e.to_string())?;
    let base = origin
        .map(|s| s.trim_end_matches('/').to_owned())
        .unwrap_or_else(|| {
            format!(
                "{}://{}",
                if cert.is_some() { "https" } else { "http" },
                actual
            )
        });
    let uri: axum::http::Uri = base.parse().map_err(|_| "Origin URL geçersiz.")?;
    if uri.authority().is_none()
        || uri.path() != "/"
        || uri.query().is_some()
        || ![Some("http"), Some("https")].contains(&uri.scheme_str())
        || (!address.ip().is_loopback() && uri.scheme_str() != Some("https"))
    {
        return Err(
            "Origin, yalnız şema://alan:port olmalı; ağa açık çalışmada HTTPS gerekli.".into(),
        );
    }
    let disk_hash = hash(&fs::read(&path).map_err(|e| e.to_string())?);
    let conversation_dir = dir.join("conversations");
    let app = App {
        inner: Arc::new(Mutex::new(data)),
        dir,
        origin: base.clone(),
        healthy: Arc::new(AtomicBool::new(true)),
        disk_hash: Arc::new(std::sync::Mutex::new(disk_hash)),
        traffic: Arc::new(std::sync::Mutex::new(Traffic::default())),
    };
    let private = desktop.is_some();
    let (shutdown, mut stop) = tokio::sync::watch::channel(false);
    let mut routes = Router::new()
        .route(
            "/",
            get(move || async move {
                crate::assets::asset(if private { "konular" } else { "index.html" })
            }),
        )
        .route("/arsiv", get(|| async { crate::assets::asset("private") }))
        .route("/ag", get(|| async { crate::assets::asset("index.html") }))
        .route("/api/info", get(info))
        .route("/api/event", post(event))
        .route("/{*path}", get(assets))
        .layer(DefaultBodyLimit::max(HTTP_LIMIT))
        .with_state(app);
    if let Some(config) = &desktop {
        routes = routes.merge(crate::lifecycle::router(
            config.token.clone(),
            base.clone(),
            shutdown.clone(),
        ));
        routes = routes.merge(crate::private_fs::router(
            config.archive_root.clone(),
            config.token.clone(),
            base.clone(),
        ));
        routes = routes.merge(crate::sources::router(config.token.clone(), base.clone()));
        routes = routes.merge(crate::workspace::router_with_archive(
            conversation_dir,
            config.token.clone(),
            base.clone(),
            config.archive_root.clone(),
        )?);
    }
    let tls_config = if let (Some(cert), Some(key)) = (cert, key) {
        let _ = rustls::crypto::ring::default_provider().install_default();
        Some(
            axum_server::tls_rustls::RustlsConfig::from_pem_file(cert, key)
                .await
                .map_err(|e| e.to_string())?,
        )
    } else {
        None
    };
    let local_token = desktop.as_ref().map(|config| config.token.clone());
    if let Some(runtime) = desktop
        .as_ref()
        .and_then(|config| config.runtime_path.as_ref())
    {
        atomic(
            runtime,
            &serde_json::to_vec(
                &json!({"pid":std::process::id(),"url":base,"localToken":local_token,"bootstrapInvite":bootstrap}),
            )
            .map_err(|e| e.to_string())?,
        )
        .map_err(|e| e.to_string())?;
    }
    println!(
        "TORE_READY {}",
        json!({"url":base,"invite":bootstrap,"localToken":local_token})
    );
    if open_browser {
        let mut fragments = vec![];
        if let Some(token) = &local_token {
            fragments.push(format!("local={token}"));
        }
        if let Some(code) = &bootstrap {
            fragments.push(format!("davet={code}"));
        }
        let url = if fragments.is_empty() {
            base.clone()
        } else {
            format!("{base}/#{}", fragments.join("&"))
        };
        #[cfg(target_os = "macos")]
        {
            let _ = std::process::Command::new("open").arg(url).spawn();
        }
        #[cfg(not(target_os = "macos"))]
        {
            eprintln!("Tarayıcıda açın: {url}");
        }
    }
    std::io::stdout().flush().map_err(|e| e.to_string())?;
    if let Some(config) = tls_config {
        axum_server::from_tcp_rustls(listener, config)
            .serve(routes.into_make_service())
            .await
            .map_err(|e| e.to_string())?;
    } else {
        let listener = tokio::net::TcpListener::from_std(listener).map_err(|e| e.to_string())?;
        axum::serve(listener, routes)
            .with_graceful_shutdown(async move {
                tokio::select!{_ = tokio::signal::ctrl_c()=>{},_ = async{while !*stop.borrow(){if stop.changed().await.is_err(){std::future::pending::<()>().await;}}}=>{}}
            })
            .await
            .map_err(|e| e.to_string())?;
    }
    if let Some(runtime) = desktop
        .as_ref()
        .and_then(|config| config.runtime_path.as_ref())
    {
        let _ = fs::remove_file(runtime);
    }
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn physical_wrapper_limit_rejects_before_any_backup_write() {
        let dir = std::env::temp_dir().join(format!("tore-wrapper-test-{}", Uuid::new_v4()));
        fs::create_dir(&dir).unwrap();
        let initial = Data::default();
        assert!(persist(&dir, &initial).is_ok());
        let before = fs::read(dir.join("ag.json")).unwrap();
        let mut huge = initial.clone();
        huge.invites
            .insert("test".into(), json!({"label":"\"".repeat(17_000_000)}));
        assert!(store_bytes(&huge).is_err());
        assert!(persist(&dir, &huge).is_err());
        assert_eq!(fs::read(dir.join("ag.json")).unwrap(), before);
        assert!(!dir.join("ag.onceki.json").exists());
        fs::remove_dir_all(dir).unwrap();
    }
    #[test]
    fn transient_nonce_expiry_is_bounded_by_signed_event_deadline() {
        let mut traffic = Traffic::default();
        let mut e = Event {
            version: 1,
            id: Uuid::new_v4().to_string(),
            author: "test".into(),
            issued_at: now(),
            action: "snapshot".into(),
            payload: json!({"feed":"all"}),
        };
        assert!(traffic.check(&e).is_ok());
        assert!(traffic.read(&e).is_ok());
        assert!(traffic.check(&e).is_err());
        traffic.reads.get_mut(&e.id).unwrap().1 = Utc::now().timestamp() - 1;
        assert!(traffic.check(&e).is_ok());
        assert!(traffic.reads.is_empty());
        e.id = Uuid::new_v4().to_string();
        traffic
            .rates
            .insert(e.author.clone(), (Utc::now().timestamp(), RATE_PER_MINUTE));
        assert!(matches!(
            traffic.check(&e),
            Err(Error(StatusCode::TOO_MANY_REQUESTS, _))
        ));
        traffic.rates.get_mut(&e.author).unwrap().0 -= 61;
        assert!(traffic.check(&e).is_ok());
    }
}
