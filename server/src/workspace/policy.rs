use super::types::*;
use serde::Deserialize;
use serde_json::{Value, json};
use sha2::{Digest, Sha256};
use std::collections::{BTreeMap, BTreeSet};
pub fn digest(s: &[u8]) -> String {
    format!("{:x}", Sha256::digest(s))
}
pub fn now() -> String {
    chrono::Utc::now().to_rfc3339()
}
pub fn id() -> String {
    uuid::Uuid::new_v4().to_string()
}
#[derive(Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct Item {
    pub message_id: String,
    #[serde(default)]
    pub role: Option<String>,
    pub text: String,
    pub authorship: String,
    pub rights: String,
    #[serde(default)]
    pub feedback: String,
}
#[derive(Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct Prepare {
    pub conversation_id: String,
    pub leaf_id: String,
    pub items: Vec<Item>,
    pub intent: String,
    pub purpose: String,
    pub developer: String,
    pub model_id: String,
    pub mode: String,
    #[serde(default)]
    pub question: String,
}
pub fn findings(message_id: &str, text: &str) -> Vec<Value> {
    static PATTERNS: std::sync::OnceLock<Vec<(&str, regex::Regex)>> = std::sync::OnceLock::new();
    let patterns=PATTERNS.get_or_init(||vec![
  ("E-posta",regex::Regex::new(r"(?i)[a-z0-9._%+\-]+@[a-z0-9.\-]+\.[a-z]{2,}").unwrap()),
  ("Telefon",regex::Regex::new(r"(?:\+\d[\d ()\-]{7,}\d|\b\d{10,15}\b)").unwrap()),
  ("API anahtarı",regex::Regex::new(r"(?i)(?:sk-[a-z0-9_\-]{8,}|bearer\s+[a-z0-9_\-]{8,}|(?:api[_ -]?key|token|password)\s*[:=]\s*[^\s,;]{6,})").unwrap()),
  ("Yerel dosya yolu",regex::Regex::new(r#"(?:/(?:Users|home|private|tmp|var|Volumes|etc|opt)/[^\s"<>]+|[A-Za-z]:\\[^\s"<>]+|file://[^\s]+)"#).unwrap()),
 ]);
    patterns
        .iter()
        .flat_map(|(kind, re)| {
            re.find_iter(text)
                .map(move |m| json!({"messageId":message_id,"kind":kind,"value":m.as_str()}))
        })
        .take(100)
        .collect()
}
pub fn prepare(c: &Conversation, r: Prepare) -> Result<(TransferDraft, Vec<Value>), String> {
    if r.conversation_id != c.id
        || !matches!(r.intent.as_str(), "continue" | "dataset")
        || !matches!(r.purpose.as_str(), "research" | "training")
        || !matches!(r.mode.as_str(), "simulation" | "live" | "manual")
    {
        return Err("Taslak seçimi geçersiz".into());
    }
    if !super::transport::developers()
        .as_array()
        .is_some_and(|a| a.iter().any(|d| d["id"] == r.developer))
    {
        return Err("Hedef geliştiriciyi seçin".into());
    }
    if r.intent == "dataset" && r.mode != "manual" {
        return Err("Veri paketi bir model çağrısı değildir".into());
    }
    if r.model_id.len() > 200
        || (r.mode == "live" && r.model_id.trim().is_empty())
        || r.model_id.chars().any(char::is_control)
    {
        return Err("Model kimliği geçersiz".into());
    }
    if r.items.is_empty() || r.items.len() > 64 || r.question.len() > 8000 {
        return Err("1–64 mesaj seçin; soru en fazla 8000 bayt olabilir".into());
    }
    let all: BTreeMap<_, _> = c.messages.iter().map(|m| (m.id.as_str(), m)).collect();
    if !all.contains_key(r.leaf_id.as_str())
        || c.messages
            .iter()
            .any(|m| m.parent_id.as_deref() == Some(&r.leaf_id))
    {
        return Err("Geçerli bir dalın son mesajını seçin".into());
    }
    let mut path = BTreeSet::new();
    let mut current = Some(r.leaf_id.as_str());
    while let Some(x) = current {
        if !path.insert(x) {
            return Err("Kaynak dal döngü içeriyor".into());
        }
        current = all.get(x).and_then(|m| m.parent_id.as_deref());
    }
    let mut seen = BTreeSet::new();
    let mut size = 0;
    let mut messages = vec![];
    let mut found = vec![];
    for item in r.items {
        if !seen.insert(item.message_id.clone()) || !path.contains(item.message_id.as_str()) {
            return Err("Seçimler yalnız seçili dalın benzersiz mesajları olmalı".into());
        }
        let m = all[item.message_id.as_str()];
        let role = if m.role == "unknown" {
            item.role
                .as_deref()
                .filter(|r| matches!(*r, "user" | "assistant"))
                .ok_or("Genel metnin konuşmacısını açıkça seçin")?
        } else {
            if item.role.as_ref().is_some_and(|r| r != &m.role) {
                return Err("Bilinen kaynak konuşmacısı değiştirilemez".into());
            }
            m.role.as_str()
        };
        if !matches!(role, "user" | "assistant")
            || item.text.trim().is_empty()
            || !matches!(
                item.authorship.as_str(),
                "unreviewed" | "human_original" | "ai_output" | "third_party"
            )
            || !matches!(item.rights.as_str(), "unreviewed" | "user_attested")
        {
            return Err("Mesaj, konuşmacı veya inceleme bilgisi geçersiz".into());
        }
        // An AI answer cannot be relabeled as human testimony merely by checking a box.
        if role == "assistant" && item.authorship == "human_original" {
            return Err("AI yanıtı insanın özgün beyanı olarak işaretlenemez; katkınızı yeni kullanıcı mesajı olarak ekleyin".into());
        }
        size += item.text.len() + item.feedback.len();
        if size > 128 * 1024 || item.feedback.len() > 8000 {
            return Err("Seçili içerik sınırı aşıldı".into());
        }
        found.extend(findings(&m.id, &item.text));
        found.extend(findings(&m.id, &item.feedback));
        messages.push(ReviewedMessage {
            model: m.model.clone(),
            timestamp: m.timestamp.clone(),
            id: m.id.clone(),
            role: role.to_owned(),
            text: item.text,
            authorship: item.authorship,
            rights: item.rights,
            feedback: item.feedback,
        });
    }
    // Preserve the chronological ancestry even if a caller sends checkboxes in another order.
    let mut chain = vec![];
    let mut cursor = Some(r.leaf_id.as_str());
    while let Some(x) = cursor {
        chain.push(x);
        cursor = all.get(x).and_then(|m| m.parent_id.as_deref());
    }
    chain.reverse();
    messages.sort_by_key(|m| {
        chain
            .iter()
            .position(|id| *id == m.id.as_str())
            .unwrap_or(usize::MAX)
    });
    found.extend(findings("question", &r.question));
    let context_text = messages
        .iter()
        .map(|m| {
            format!(
                "{}: {}{}",
                if m.role == "user" {
                    "Kullanıcı"
                } else {
                    "Asistan"
                },
                m.text,
                if m.feedback.is_empty() {
                    String::new()
                } else {
                    format!("\nKullanıcı inceleme notu: {}", m.feedback)
                }
            )
        })
        .chain((!r.question.is_empty()).then(|| format!("Yeni kullanıcı sorusu: {}", r.question)))
        .collect::<Vec<_>>()
        .join("\n\n");
    let mut warnings = vec![
        "Tarama tüm özel bilgileri bulamaz; anonimlik veya hak sahipliği doğrulaması değildir."
            .into(),
    ];
    if !found.is_empty() {
        warnings.push("Bulunan özel bilgileri maskeleyip yeniden önizleyin; bu taslak gönderilemez veya paketlenemez.".into());
    }
    let mut draft = TransferDraft {
        schema_version: 1,
        id: id(),
        hash: String::new(),
        conversation_id: c.id.clone(),
        leaf_id: r.leaf_id,
        intent: r.intent,
        purpose: r.purpose,
        developer: r.developer,
        model_id: r.model_id,
        mode: r.mode,
        question: r.question,
        context_text,
        messages,
        warnings,
        status: "ready".into(),
        created_at: now(),
    };
    if draft.mode == "live"
        && (payload(&draft).len() > 64
            || payload(&draft)
                .iter()
                .filter_map(|m| m["content"].as_str())
                .map(str::len)
                .sum::<usize>()
                > 32 * 1024)
    {
        return Err(
            "Canlı aktarım soru ve inceleme notlarıyla toplam 64 mesaj / 32 KiB sınırını aşıyor"
                .into(),
        );
    }
    if draft.intent == "continue" {
        draft.context_text = payload(&draft)
            .iter()
            .map(|m| {
                format!(
                    "{}:\n{}",
                    m["role"].as_str().unwrap(),
                    m["content"].as_str().unwrap()
                )
            })
            .collect::<Vec<_>>()
            .join("\n\n");
    }
    draft.hash = digest(&serde_json::to_vec(&draft).map_err(|_| "Taslak kodlanamadı")?);
    Ok((draft, found))
}
pub fn safe(d: &TransferDraft) -> Result<(), String> {
    if d.messages
        .iter()
        .any(|m| !findings(&m.id, &m.text).is_empty() || !findings(&m.id, &m.feedback).is_empty())
        || !findings("question", &d.question).is_empty()
    {
        return Err("Özel bilgi taraması bulgu içeriyor; maskeleyip yeni taslak hazırlayın".into());
    }
    Ok(())
}
pub fn payload(d: &TransferDraft) -> Vec<Value> {
    let mut out = vec![];
    for m in &d.messages {
        out.push(json!({"role":m.role,"content":m.text}));
        if !m.feedback.is_empty() {
            out.push(json!({"role":"user","content":format!("İnceleme notum: {}",m.feedback)}));
        }
    }
    if !d.question.is_empty() {
        out.push(json!({"role":"user","content":d.question}));
    }
    out
}
pub fn package(d: &TransferDraft) -> Result<DatasetPackage, String> {
    if d.intent != "dataset" {
        return Err("Konuşmaya devam izni veri paketi izni değildir".into());
    }
    safe(d)?;
    if d.messages
        .iter()
        .any(|m| m.rights != "user_attested" || m.authorship == "unreviewed")
    {
        return Err("Her mesajın yazarlığını inceleyin ve hak durumunu ayrı beyan edin".into());
    }
    if d.purpose == "training" && d.messages.iter().any(|m| m.authorship != "human_original") {
        return Err("Eğitim amaçlı bu demo paketi yalnız kullanıcıya ait olduğu beyan edilmiş özgün insan katkılarını alır".into());
    }
    let rows:Vec<Value>=d.messages.iter().map(|m|json!({"schemaVersion":1,"id":digest(m.id.as_bytes()),"sourceConversationId":digest(d.conversation_id.as_bytes()),"role":m.role,"text":m.text,"authorshipStatus":m.authorship,"rightsStatus":m.rights,"feedback":m.feedback,"reviewStatus":"user_reviewed","purpose":d.purpose})).collect();
    let dataset = rows
        .iter()
        .map(|r| serde_json::to_string(r).unwrap())
        .collect::<Vec<_>>()
        .join("\n")
        + "\n";
    let package_id = id();
    let manifest = json!({"schemaVersion":1,"packageId":package_id,"createdAt":now(),"datasetSha256":digest(dataset.as_bytes()),"recordCount":rows.len(),"sourceConversationIds":[digest(d.conversation_id.as_bytes())],"sourceMessageIds":d.messages.iter().map(|m|digest(m.id.as_bytes())).collect::<Vec<_>>(),"draftHash":d.hash,"purpose":d.purpose,"intendedDeveloper":d.developer,"note":d.question,"consent":{"type":"package_preparation_only","attestedBy":"local_user","legalRightsVerified":false,"trainingPermissionGranted":false,"saleOrDelivery":false},"licenseStatus":"no_license_granted_demo_only","masking":{"userReviewed":true,"automaticScan":"no_remaining_known_patterns","anonymityGuaranteed":false},"revocation":"Future transfers can be stopped in Töre; delivered copies and trained models cannot be recalled by this demo."});
    let readme="# Töre teknik demo veri paketi\n\nBu paket satış, teslimat veya eğitim izni değildir. Kullanıcı beyanı hukuki doğrulama değildir.\n\n- dataset.jsonl: her satır seçilmiş, kullanıcı tarafından incelenmiş bir mesajdır. id ve sourceConversationId kaynak kimliğinin SHA-256 özetidir; role kaynak konuşmacıyı, text incelenmiş metni belirtir.\n- authorshipStatus: human_original / ai_output / third_party. rightsStatus=user_attested yalnız kullanıcının beyanıdır. feedback kullanıcının inceleme notudur; AI önerisi insan beyanına çevrilmez.\n- manifest.json: şema, amaç (research/training), kaynak özetleri, içerik özeti, maskeleme ve ayrı paket hazırlama izni.\n- Ekler, ham kaynak dosyaları, kaynak yolları, API anahtarı ve maskelenen özgün değerler bu paketin parçası değildir.\n\nSınırlamalar: otomatik tarama anonimlik sağlamaz; kişi ve kurum isimlerini kaçırabilir. AI/üçüncü kişi içeriği eğitim için otomatik uygun sayılmaz. İzin geri çekme yalnız gelecekteki işlemleri durdurur; teslim edilmiş kopya veya eğitilmiş modelin unutmasını sağlamaz.\n".to_string();
    Ok(DatasetPackage {
        schema_version: 1,
        package_id,
        dataset_jsonl: dataset,
        manifest,
        readme,
    })
}
pub fn branch(d: &TransferDraft, text: String) -> Conversation {
    let conversation_id = id();
    let mut messages = vec![];
    let mut parent = None;
    for m in &d.messages {
        let mid = id();
        messages.push(Message {
            id: mid.clone(),
            source_id: digest(m.id.as_bytes()),
            parent_id: parent,
            role: m.role.clone(),
            model: m.model.clone(),
            phase: None,
            text: m.text.clone(),
            attachments: vec![],
            timestamp: m.timestamp.clone(),
            source_locator: "selected-reviewed-context".into(),
            authorship_status: m.authorship.clone(),
        });
        parent = Some(mid);
        if !m.feedback.is_empty() {
            let note = id();
            messages.push(Message {
                id: note.clone(),
                source_id: note.clone(),
                parent_id: parent,
                role: "user".into(),
                model: None,
                phase: None,
                text: format!("İnceleme notum: {}", m.feedback),
                attachments: vec![],
                timestamp: Some(now()),
                source_locator: "user-review".into(),
                authorship_status: "human_original".into(),
            });
            parent = Some(note);
        }
    }
    if !d.question.is_empty() {
        let mid = id();
        messages.push(Message {
            id: mid.clone(),
            source_id: mid.clone(),
            parent_id: parent,
            role: "user".into(),
            model: None,
            phase: None,
            text: d.question.clone(),
            attachments: vec![],
            timestamp: Some(now()),
            source_locator: "user-question".into(),
            authorship_status: "human_original".into(),
        });
        parent = Some(mid);
    }
    let mid = id();
    messages.push(Message {
        id: mid.clone(),
        source_id: mid.clone(),
        parent_id: parent,
        role: "assistant".into(),
        model: if d.mode == "live" {
            Some(d.model_id.clone())
        } else {
            None
        },
        phase: Some(d.mode.clone()),
        text,
        attachments: vec![],
        timestamp: Some(now()),
        source_locator: "transfer-receipt".into(),
        authorship_status: "ai_output".into(),
    });
    Conversation {
        schema_version: 1,
        id: conversation_id,
        provider: d.developer.clone(),
        source_app: "tore".into(),
        source_conversation_id: d.conversation_id.clone(),
        title: format!(
            "{} — {} dalı",
            d.developer,
            if d.mode == "simulation" {
                "simülasyon"
            } else {
                "API"
            }
        ),
        created_at: Some(now()),
        updated_at: Some(now()),
        selected_leaf_id: Some(mid),
        messages,
        warnings: if d.mode == "simulation" {
            vec!["Bu dal sentetik bağlantı denemesidir; gerçek modele gönderilmedi.".into()]
        } else {
            vec![]
        },
    }
}
