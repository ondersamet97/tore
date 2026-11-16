//! Dream notebook: morning reports kept locally, coded by the user, exported only with
//! per-dream consent. The raw report is the user's own words; rule suggestions only
//! become dataset labels after the user confirms them.
use super::policy::{digest, findings, id, now};
use super::store::{no_symlinks, private_options};
use super::types::DatasetPackage;
use fs2::FileExt;
use serde::{Deserialize, Serialize};
use serde_json::{Value, json};
use std::{
    collections::{BTreeMap, BTreeSet},
    fs::{self, File},
    io::Write,
    path::PathBuf,
};

pub const CHARACTERS: &[&str] = &[
    "family",
    "partner",
    "friend",
    "known_person",
    "stranger",
    "child",
    "animal",
    "creature",
];
pub const EMOTIONS: &[&str] = &[
    "fear",
    "joy",
    "sadness",
    "anger",
    "confusion",
    "shame",
    "surprise",
    "calm",
];
pub const SETTINGS: &[&str] = &[
    "home",
    "school_work",
    "city",
    "nature",
    "water",
    "vehicle",
    "unfamiliar_place",
];
pub const THEMES: &[&str] = &[
    "lucid",
    "nightmare",
    "recurring",
    "flying",
    "falling",
    "chased",
    "lost",
    "late",
];
const WAKE_TYPES: &[&str] = &["natural", "alarm", "unknown"];
const CONSENT_VERSION: &str = "tore-dream-consent-2026-11";
const LIMIT: usize = 64 * 1024 * 1024;

#[derive(Clone, Serialize, Deserialize, PartialEq, Debug)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct Capture {
    pub minutes_after_wake: Option<u32>,
    pub wake_type: String,
    pub recall_clarity: u8,
    pub entry_seconds: Option<u32>,
}
#[derive(Clone, Serialize, Deserialize, PartialEq, Debug)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct Coding {
    pub characters: Vec<String>,
    pub emotions: Vec<String>,
    pub settings: Vec<String>,
    pub themes: Vec<String>,
    /// Labels the local rules proposed; kept so suggestion accuracy can be measured.
    pub suggested: Vec<String>,
    pub confirmed_by_user: bool,
}
#[derive(Clone, Serialize, Deserialize, PartialEq, Debug)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct Consent {
    pub training_use: bool,
    pub granted_at: Option<String>,
    pub version: String,
}
#[derive(Clone, Serialize, Deserialize, PartialEq, Debug)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct Dream {
    pub id: String,
    pub created_at: String,
    pub updated_at: String,
    /// Morning the dream was recorded, YYYY-MM-DD.
    pub night: String,
    /// The user's own words, never rewritten by Töre.
    pub report: String,
    /// The text that may leave this computer; the user edits it.
    pub report_anonymized: String,
    pub capture: Capture,
    pub coding: Coding,
    pub mood_on_wake: i8,
    pub consent: Consent,
}

#[derive(Clone, Serialize, Deserialize, Default)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct Store {
    pub schema_version: u32,
    pub dreams: BTreeMap<String, Dream>,
}

pub struct Disk {
    root: PathBuf,
    _lock: File,
    data: Store,
    disk_hash: Option<String>,
    healthy: bool,
}

fn only(values: &[String], allowed: &[&str], name: &str) -> Result<(), String> {
    let mut seen = BTreeSet::new();
    for v in values {
        if !allowed.contains(&v.as_str()) || !seen.insert(v) {
            return Err(format!("Geçersiz veya tekrarlanan {name} etiketi: {v}"));
        }
    }
    Ok(())
}
fn valid_night(s: &str) -> bool {
    chrono::NaiveDate::parse_from_str(s, "%Y-%m-%d")
        .is_ok_and(|d| d.format("%Y-%m-%d").to_string() == s)
}
pub fn validate(d: &Dream) -> Result<(), String> {
    if uuid::Uuid::parse_str(&d.id).is_err() {
        return Err("Rüya kimliği geçersiz".into());
    }
    if !valid_night(&d.night) {
        return Err("Tarih YYYY-AA-GG biçiminde olmalı".into());
    }
    if d.report.trim().is_empty() || d.report.chars().count() > 20_000 {
        return Err("Rüya anlatısı boş olamaz ve 20.000 karakteri aşamaz".into());
    }
    if d.report_anonymized.chars().count() > 20_000 {
        return Err("Anonim metin 20.000 karakteri aşamaz".into());
    }
    if !WAKE_TYPES.contains(&d.capture.wake_type.as_str()) {
        return Err("Uyanış türü geçersiz".into());
    }
    if !(1..=5).contains(&d.capture.recall_clarity) {
        return Err("Hatırlama netliği 1–5 arasında olmalı".into());
    }
    if d.capture.minutes_after_wake.is_some_and(|m| m > 24 * 60) {
        return Err("Uyanıştan sonra geçen süre en fazla 1440 dakika olabilir".into());
    }
    if !(-2..=2).contains(&d.mood_on_wake) {
        return Err("Uyanış duygusu -2 ile 2 arasında olmalı".into());
    }
    only(&d.coding.characters, CHARACTERS, "karakter")?;
    only(&d.coding.emotions, EMOTIONS, "duygu")?;
    only(&d.coding.settings, SETTINGS, "mekân")?;
    only(&d.coding.themes, THEMES, "tema")?;
    let all: Vec<&str> = [CHARACTERS, EMOTIONS, SETTINGS, THEMES].concat();
    only(&d.coding.suggested, &all, "öneri")?;
    if d.consent.version != CONSENT_VERSION {
        return Err("Onay metni sürümü desteklenmiyor".into());
    }
    if d.consent.training_use != d.consent.granted_at.is_some() {
        return Err("Eğitim izni ve izin zamanı birlikte verilmeli".into());
    }
    if d.consent.training_use && !d.coding.confirmed_by_user {
        return Err("Eğitim izni için önce kodlamayı onaylayın".into());
    }
    if d.consent.training_use && d.report_anonymized.trim().is_empty() {
        return Err("Eğitim izni için anonim metin boş olamaz".into());
    }
    Ok(())
}

impl Disk {
    pub fn open(root: PathBuf) -> Result<Self, String> {
        no_symlinks(&root)?;
        fs::create_dir_all(&root).map_err(|_| "Rüya deposu açılamadı")?;
        let lock = private_options()
            .create(true)
            .truncate(false)
            .open(root.join("dreams.lock"))
            .map_err(|_| "Rüya deposu kilidi açılamadı")?;
        lock.try_lock_exclusive()
            .map_err(|_| "Rüya deposu başka bir Töre sürecinde açık")?;
        let path = root.join("dreams-v1.json");
        no_symlinks(&path)?;
        let (data, disk_hash) = match fs::read(&path) {
            Ok(bytes) => {
                if bytes.len() > LIMIT {
                    return Err("Rüya deposu boyut sınırını aşıyor".into());
                }
                let data: Store = serde_json::from_slice(&bytes)
                    .map_err(|_| "Rüya deposu bozuk; sıfırlanmadı")?;
                if data.schema_version != 1 {
                    return Err("Desteklenmeyen rüya deposu sürümü; sıfırlanmadı".into());
                }
                for d in data.dreams.values() {
                    validate(d).map_err(|e| {
                        format!("Rüya deposu geçersiz kayıt içeriyor ({e}); sıfırlanmadı")
                    })?;
                }
                (data, Some(digest(&bytes)))
            }
            Err(e) if e.kind() == std::io::ErrorKind::NotFound => (
                Store {
                    schema_version: 1,
                    dreams: BTreeMap::new(),
                },
                None,
            ),
            Err(_) => return Err("Rüya deposu okunamadı".into()),
        };
        Ok(Self {
            root,
            _lock: lock,
            data,
            disk_hash,
            healthy: true,
        })
    }
    fn commit(&mut self, next: Store) -> Result<(), String> {
        if !self.healthy {
            return Err(
                "Rüya deposu bir yazma hatasından sonra kilitlendi; uygulamayı yeniden açın".into(),
            );
        }
        let bytes = serde_json::to_vec_pretty(&next).map_err(|_| "Rüya deposu kodlanamadı")?;
        if bytes.len() > LIMIT {
            return Err("Rüya deposu boyut sınırını aşıyor".into());
        }
        let path = self.root.join("dreams-v1.json");
        no_symlinks(&path)?;
        let temp = self.root.join(format!(".dreams-{}.tmp", id()));
        let result = (|| {
            let current = match fs::read(&path) {
                Ok(b) => Some(digest(&b)),
                Err(e) if e.kind() == std::io::ErrorKind::NotFound => None,
                Err(_) => return Err("Rüya deposu okunamadı".to_string()),
            };
            if current != self.disk_hash {
                return Err("Rüya deposu dışarıdan değiştirilmiş; üzerine yazılmadı".into());
            }
            let mut f = private_options()
                .create_new(true)
                .open(&temp)
                .map_err(|_| "Geçici kayıt açılamadı")?;
            f.write_all(&bytes)
                .and_then(|_| f.sync_all())
                .map_err(|_| "Rüya kaydı yazılamadı")?;
            fs::rename(&temp, &path).map_err(|_| "Atomik kayıt tamamlanamadı")?;
            File::open(&self.root)
                .and_then(|f| f.sync_all())
                .map_err(|_| "Rüya deposu kalıcılığı doğrulanamadı")?;
            Ok(())
        })();
        if result.is_err() {
            self.healthy = false;
            let _ = fs::remove_file(&temp);
        }
        result?;
        self.disk_hash = Some(digest(&bytes));
        self.data = next;
        Ok(())
    }
    pub fn list(&self) -> Result<Value, String> {
        let mut dreams: Vec<&Dream> = self.data.dreams.values().collect();
        dreams.sort_by(|a, b| (&b.night, &b.created_at).cmp(&(&a.night, &a.created_at)));
        Ok(json!({
            "schemaVersion": 1,
            "dreams": dreams,
            "vocabulary": {"characters":CHARACTERS,"emotions":EMOTIONS,"settings":SETTINGS,"themes":THEMES},
            "consentVersion": CONSENT_VERSION,
        }))
    }
    pub fn save(&mut self, r: Value) -> Result<Value, String> {
        let mut dream: Dream = serde_json::from_value(r["dream"].clone())
            .map_err(|e| format!("Rüya kaydı biçimi geçersiz: {e}"))?;
        let stamp = now();
        match self.data.dreams.get(&dream.id) {
            Some(old) => {
                dream.created_at = old.created_at.clone();
                if old.report != dream.report {
                    return Err("Kaydedilmiş rüya anlatısı değiştirilemez; senin sözün olduğu gibi korunur. Yeni bir kayıt açın veya bunu silin.".into());
                }
                if dream.consent.training_use && old.consent.training_use {
                    dream.consent.granted_at = old.consent.granted_at.clone();
                }
            }
            None => {
                if !dream.id.is_empty() {
                    return Err("Bu rüya kaydı bulunamadı".into());
                }
                dream.id = id();
                dream.created_at = stamp.clone();
            }
        }
        if dream.consent.training_use && dream.consent.granted_at.is_none() {
            dream.consent.granted_at = Some(stamp.clone());
        }
        if !dream.consent.training_use {
            dream.consent.granted_at = None;
        }
        dream.updated_at = stamp;
        validate(&dream)?;
        let mut next = self.data.clone();
        next.dreams.insert(dream.id.clone(), dream.clone());
        self.commit(next)?;
        Ok(json!({"dream": dream}))
    }
    pub fn delete(&mut self, r: Value) -> Result<Value, String> {
        let target = r["id"].as_str().ok_or("Eksik alan: id")?;
        let mut next = self.data.clone();
        next.dreams
            .remove(target)
            .ok_or("Bu rüya kaydı bulunamadı")?;
        self.commit(next)?;
        Ok(json!({"deleted": true}))
    }
    pub fn export(&self) -> Result<Value, String> {
        let mut rows = vec![];
        let mut skipped = BTreeMap::<&str, usize>::new();
        let mut dreams: Vec<&Dream> = self.data.dreams.values().collect();
        dreams.sort_by(|a, b| (&a.night, &a.created_at).cmp(&(&b.night, &b.created_at)));
        for d in dreams {
            let reason = if !d.consent.training_use {
                Some("no_consent")
            } else if !d.coding.confirmed_by_user {
                Some("coding_not_confirmed")
            } else if !findings(&d.id, &d.report_anonymized).is_empty() {
                Some("personal_data_pattern_found")
            } else {
                None
            };
            if let Some(reason) = reason {
                *skipped.entry(reason).or_default() += 1;
                continue;
            }
            let mut labels: Vec<&String> = d
                .coding
                .characters
                .iter()
                .chain(&d.coding.emotions)
                .chain(&d.coding.settings)
                .chain(&d.coding.themes)
                .collect();
            labels.sort();
            let accepted = d
                .coding
                .suggested
                .iter()
                .filter(|s| labels.contains(s))
                .count();
            rows.push(json!({
                "schema": "tore-dream-v1",
                "id": digest(d.id.as_bytes()),
                "month": &d.night[..7],
                "language": "tr",
                "report": d.report_anonymized.trim(),
                "wordCount": d.report_anonymized.split_whitespace().count(),
                "capture": {
                    "minutesAfterWake": d.capture.minutes_after_wake,
                    "wakeType": d.capture.wake_type,
                    "recallClarity": d.capture.recall_clarity,
                },
                "selfReport": {"moodOnWake": d.mood_on_wake},
                "coding": {
                    "scheme": "tore-dream-codes-v1",
                    "characters": d.coding.characters,
                    "emotions": d.coding.emotions,
                    "settings": d.coding.settings,
                    "themes": d.coding.themes,
                },
                "provenance": {
                    "report": "user_statement_anonymized_by_user",
                    "coding": "rule_suggestion_confirmed_by_user",
                    "ruleSuggestions": d.coding.suggested.len(),
                    "ruleSuggestionsKept": accepted,
                },
                "consent": {"trainingUse": true, "version": d.consent.version},
            }));
        }
        let dataset = rows
            .iter()
            .map(|r| serde_json::to_string(r).unwrap())
            .collect::<Vec<_>>()
            .join("\n")
            + if rows.is_empty() { "" } else { "\n" };
        let package_id = id();
        let manifest = json!({
            "schemaVersion": 1,
            "kind": "tore-dream-dataset",
            "packageId": package_id,
            "createdAt": now(),
            "datasetSha256": digest(dataset.as_bytes()),
            "recordCount": rows.len(),
            "skipped": skipped,
            "vocabulary": {"characters":CHARACTERS,"emotions":EMOTIONS,"settings":SETTINGS,"themes":THEMES},
            "consent": {"type": "per_dream_training_use", "version": CONSENT_VERSION, "attestedBy": "local_user", "legalRightsVerified": false, "saleOrDelivery": false},
            "licenseStatus": "no_license_granted_prototype_only",
            "masking": {"userReviewed": true, "automaticScan": "no_remaining_known_patterns", "anonymityGuaranteed": false},
            "revocation": "Withdrawing consent in Töre stops future packages only; files already shared cannot be recalled.",
        });
        let readme = "# töre rüya veri seti (prototip)\n\nBu paket satış, teslimat veya lisans değildir; yalnız bu bilgisayarda hazırlanmış bir prototip çıktısıdır.\n\n- dataset.jsonl: her satır, kullanıcının eğitim kullanımına ayrıca izin verdiği ve kodlamasını onayladığı bir rüyadır. `report` kullanıcının kendi elle anonimleştirdiği metindir; özgün anlatı pakete girmez.\n- `id` yerel kimliğin SHA-256 özetidir; tarih yalnız ay düzeyindedir.\n- `coding`: tore-dream-codes-v1 sözlüğü. Etiketler yerel kurallarca önerilir, kullanıcı onaylamadan pakete girmez. `provenance.ruleSuggestionsKept` önerilerden kaçının korunduğunu gösterir.\n- manifest.json: sayılar, atlanan kayıtlar ve nedenleri, sözlük, onay ve maskeleme durumu.\n\nSınırlamalar: otomatik tarama yalnız e-posta, telefon, anahtar ve dosya yolu kalıplarını arar; kişi ve yer adlarını kaçırabilir. Anonimlik garanti edilmez. İzni geri çekmek yalnız gelecekteki paketleri etkiler.\n".to_string();
        serde_json::to_value(DatasetPackage {
            schema_version: 1,
            package_id,
            dataset_jsonl: dataset,
            manifest,
            readme,
        })
        .map_err(|_| "Paket kodlanamadı".into())
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    fn root() -> PathBuf {
        std::env::temp_dir()
            .canonicalize()
            .unwrap()
            .join(format!("tore-dreams-{}", id()))
    }
    fn draft(consent: bool, confirmed: bool, anonymized: &str) -> Value {
        json!({"dream":{
            "id":"","createdAt":"","updatedAt":"","night":"2026-11-16",
            "report":"Annemle denizde yüzüyordum, sonra Ayşe geldi ve korktum.",
            "reportAnonymized":anonymized,
            "capture":{"minutesAfterWake":3,"wakeType":"alarm","recallClarity":4,"entrySeconds":150},
            "coding":{"characters":["family","known_person"],"emotions":["fear"],"settings":["water"],"themes":[],"suggested":["family","fear","water","joy"],"confirmedByUser":confirmed},
            "moodOnWake":-1,
            "consent":{"trainingUse":consent,"grantedAt":null,"version":CONSENT_VERSION}
        }})
    }
    #[test]
    fn save_reopen_and_export_only_consented() {
        let p = root();
        let mut d = Disk::open(p.clone()).unwrap();
        let a = d
            .save(draft(
                true,
                true,
                "[AİLE] ile denizde yüzüyordum, sonra [KİŞİ] geldi ve korktum.",
            ))
            .unwrap();
        d.save(draft(false, true, "")).unwrap();
        assert!(a["dream"]["consent"]["grantedAt"].is_string());
        drop(d);
        let d = Disk::open(p.clone()).unwrap();
        assert_eq!(d.data.dreams.len(), 2);
        let pkg = d.export().unwrap();
        let lines: Vec<&str> = pkg["datasetJsonl"].as_str().unwrap().lines().collect();
        assert_eq!(lines.len(), 1);
        let row: Value = serde_json::from_str(lines[0]).unwrap();
        assert_eq!(row["month"], "2026-11");
        assert!(!lines[0].contains("Ayşe"));
        assert_eq!(row["provenance"]["ruleSuggestionsKept"], 3);
        assert_eq!(pkg["manifest"]["skipped"]["no_consent"], 1);
        fs::remove_dir_all(p).unwrap();
    }
    #[test]
    fn consent_requires_confirmation_and_report_is_immutable() {
        let p = root();
        let mut d = Disk::open(p.clone()).unwrap();
        assert!(d.save(draft(true, false, "metin")).is_err());
        let saved = d.save(draft(false, false, "")).unwrap();
        let mut edited = draft(false, true, "");
        edited["dream"]["id"] = saved["dream"]["id"].clone();
        edited["dream"]["report"] = json!("Başka bir anlatı");
        assert!(d.save(edited).is_err());
        let mut bad = draft(false, false, "");
        bad["dream"]["coding"]["emotions"] = json!(["happy"]);
        assert!(d.save(bad).is_err());
        fs::remove_dir_all(p).unwrap();
    }
    #[test]
    fn export_skips_leftover_personal_patterns() {
        let p = root();
        let mut d = Disk::open(p.clone()).unwrap();
        d.save(draft(true, true, "Rüyada ali@example.com adresine yazdım"))
            .unwrap();
        let pkg = d.export().unwrap();
        assert_eq!(pkg["manifest"]["recordCount"], 0);
        assert_eq!(pkg["manifest"]["skipped"]["personal_data_pattern_found"], 1);
        fs::remove_dir_all(p).unwrap();
    }
    #[test]
    fn corrupt_store_is_not_reset() {
        let p = root();
        fs::create_dir_all(&p).unwrap();
        fs::write(p.join("dreams-v1.json"), "broken").unwrap();
        assert!(Disk::open(p.clone()).is_err());
        assert_eq!(
            fs::read_to_string(p.join("dreams-v1.json")).unwrap(),
            "broken"
        );
        fs::remove_dir_all(p).unwrap();
    }
}
