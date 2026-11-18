//! Local, non-executing import adapters. Imported authorship is always unreviewed.
use super::types::{Conversation, Message};
use chrono::{DateTime, SecondsFormat, Utc};
use serde_json::Value;
use sha2::{Digest, Sha256};
use std::collections::{HashMap, HashSet, VecDeque};
use std::io::{Cursor, Read};

#[derive(Clone, Copy)]
struct Limits {
    input: usize,
    expanded: usize,
    entries: usize,
}
const LIMITS: Limits = Limits {
    input: 128 * 1024 * 1024,
    expanded: 512 * 1024 * 1024,
    entries: 4096,
};
const MAX_MESSAGES: usize = 100_000;
const MAX_CONVERSATIONS: usize = 10_000;
const CLAUDE_ROOT: &str = "00000000-0000-4000-8000-000000000000";

pub fn parse(provider: &str, file_name: &str, bytes: &[u8]) -> Result<Vec<Conversation>, String> {
    parse_limited(provider, file_name, bytes, LIMITS)
}

pub fn parse_text(developer: &str, title: &str, text: &str) -> Result<Vec<Conversation>, String> {
    if text.len() > LIMITS.input {
        return Err("Metin 128 MiB sınırını aşıyor.".into());
    }
    if text.trim().is_empty() {
        return Err("İçe aktarılacak metin boş.".into());
    }
    let raw = serde_json::json!({"developer":developer,"title":title,"text":text});
    let source_id = hash(&[text.as_bytes()]);
    let id = conversation_id("generic", &source_id, &raw);
    let mid = message_id(&id, "text-1");
    Ok(vec![Conversation {
        schema_version: 1,
        id,
        provider: "generic".into(),
        source_app: clean_label(developer, "Genel metin", 120),
        source_conversation_id: source_id,
        title: clean_label(title, "İçe aktarılan metin", 240),
        created_at: None,
        updated_at: None,
        selected_leaf_id: Some(mid.clone()),
        messages: vec![Message {
            id: mid,
            source_id: "text-1".into(),
            parent_id: None,
            role: "unknown".into(),
            phase: None,
            text: text.to_owned(),
            attachments: vec![],
            timestamp: None,
            source_locator: "pasted-text#$.text".into(),
            authorship_status: "unreviewed".into(),
            model: None,
        }],
        warnings: vec![
            "Yapıştırılan metnin konuşmacısı ve yazarlığı çıkarılmadı; önizlemede inceleyin."
                .into(),
        ],
    }])
}

fn parse_limited(
    provider: &str,
    file_name: &str,
    bytes: &[u8],
    limits: Limits,
) -> Result<Vec<Conversation>, String> {
    if !matches!(provider, "chatgpt" | "claude" | "codex" | "generic") {
        return Err("Desteklenmeyen konuşma kaynağı.".into());
    }
    if bytes.len() > limits.input {
        return Err("Dosya izin verilen giriş boyutu sınırını aşıyor.".into());
    }
    if bytes.is_empty() {
        return Err("Dosya boş.".into());
    }
    let name = basename(file_name);
    if bytes.starts_with(b"PK\x03\x04")
        || bytes.starts_with(b"PK\x05\x06")
        || name.to_lowercase().ends_with(".zip")
    {
        return parse_zip(provider, bytes, limits);
    }
    let mut remaining = limits.expanded;
    let results = parse_member(provider, &name, bytes, &mut remaining)?;
    unique_conversations(results)
}

fn parse_zip(provider: &str, bytes: &[u8], limits: Limits) -> Result<Vec<Conversation>, String> {
    let mut archive = zip::ZipArchive::new(Cursor::new(bytes))
        .map_err(|_| "ZIP dosyası açılamadı.".to_string())?;
    if archive.len() > limits.entries {
        return Err("ZIP çok fazla dosya içeriyor.".into());
    }
    let mut expanded = 0usize;
    let mut names = HashSet::new();
    let mut selected = Vec::new();
    for index in 0..archive.len() {
        let member = archive
            .by_index(index)
            .map_err(|_| "ZIP üyesi okunamadı.".to_string())?;
        let name = member.name();
        if !safe_archive_path(name) || member.enclosed_name().is_none() {
            return Err("ZIP güvenli olmayan bir dosya yolu içeriyor.".into());
        }
        if member
            .unix_mode()
            .is_some_and(|mode| mode & 0o170000 == 0o120000)
        {
            return Err("ZIP sembolik bağlantı içeriyor; desteklenmiyor.".into());
        }
        if !names.insert(name.to_owned()) {
            return Err("ZIP yinelenen dosya yolları içeriyor.".into());
        }
        let size = usize::try_from(member.size())
            .map_err(|_| "ZIP açılmış boyutu çok büyük.".to_string())?;
        expanded = expanded
            .checked_add(size)
            .filter(|n| *n <= limits.expanded)
            .ok_or_else(|| "ZIP açılmış boyut sınırını aşıyor.".to_string())?;
        if !member.is_dir() && matching_member(provider, name) {
            selected.push((index, name.to_owned(), size));
        }
    }
    if selected.is_empty() {
        return Err("ZIP içinde bu kaynağa uygun konuşma dosyası bulunamadı.".into());
    }
    // Sum declared sizes for *all* entries, including ignored assets. Nested zstd
    // expansion consumes the remaining budget as well. Nothing is extracted to disk.
    let mut remaining = limits.expanded - expanded;
    let mut results = Vec::new();
    for (index, name, declared) in selected {
        let mut member = archive
            .by_index(index)
            .map_err(|_| "ZIP üyesi açılamadı.".to_string())?;
        let data = read_bounded(&mut member, declared)?;
        if data.len() != declared {
            return Err("ZIP dosya boyutu kayıtla uyuşmuyor.".into());
        }
        results.extend(parse_member(
            provider,
            &basename(&name),
            &data,
            &mut remaining,
        )?);
        if results.len() > MAX_CONVERSATIONS {
            return Err("Çok fazla konuşma var.".into());
        }
    }
    unique_conversations(results)
}

fn safe_archive_path(name: &str) -> bool {
    !name.is_empty()
        && name.len() <= 4096
        && !name.starts_with('/')
        && !name.starts_with('\\')
        && !name.contains('\\')
        && !name.contains('\0')
        && !name.chars().any(char::is_control)
        && !name.split('/').any(|p| p == ".." || p.contains(':'))
}

fn matching_member(provider: &str, path: &str) -> bool {
    let name = basename(path).to_lowercase();
    let conversation_json = name == "conversations.json"
        || name
            .strip_prefix("conversations-")
            .and_then(|s| s.strip_suffix(".json"))
            .is_some_and(|s| !s.is_empty() && s.bytes().all(|c| c.is_ascii_digit()));
    match provider {
        "chatgpt" | "claude" => conversation_json,
        "codex" => name.ends_with(".jsonl") || name.ends_with(".jsonl.zst"),
        "generic" => {
            conversation_json || matches!(name.as_str(), "tore.json" | "conversation.json")
        }
        _ => false,
    }
}

fn read_bounded(reader: &mut impl Read, limit: usize) -> Result<Vec<u8>, String> {
    let mut bytes = Vec::new();
    reader
        .take(limit as u64 + 1)
        .read_to_end(&mut bytes)
        .map_err(|_| "Sıkıştırılmış veri okunamadı.".to_string())?;
    if bytes.len() > limit {
        return Err("Açılmış veri boyutu sınırı aşıldı.".into());
    }
    Ok(bytes)
}

fn parse_member(
    provider: &str,
    name: &str,
    bytes: &[u8],
    remaining: &mut usize,
) -> Result<Vec<Conversation>, String> {
    if name.to_lowercase().ends_with(".zst") || bytes.starts_with(&[0x28, 0xb5, 0x2f, 0xfd]) {
        if provider != "codex" {
            return Err("Zstandard yalnız Codex JSONL içe aktarımında destekleniyor.".into());
        }
        let mut decoder = zstd::stream::read::Decoder::new(Cursor::new(bytes))
            .map_err(|_| "Zstandard dosyası açılamadı.".to_string())?;
        decoder
            .window_log_max(27)
            .map_err(|_| "Zstandard pencere sınırı uygulanamadı.".to_string())?;
        let decoded = read_bounded(&mut decoder, *remaining)?;
        *remaining -= decoded.len();
        return parse_codex(name, &decoded);
    }
    if provider == "codex" {
        return parse_codex(name, bytes);
    }
    let value: Value = serde_json::from_slice(bytes)
        .map_err(|_| "Geçerli bir JSON dışa aktarımı gerekli.".to_string())?;
    let items: Vec<&Value> = if let Some(items) = value.as_array() {
        items.iter().collect()
    } else if let Some(items) = value.get("conversations").and_then(Value::as_array) {
        items.iter().collect()
    } else if value.is_object() {
        vec![&value]
    } else {
        return Err("Konuşma dizisi veya nesnesi bekleniyor.".into());
    };
    if items.len() > MAX_CONVERSATIONS {
        return Err("Çok fazla konuşma var.".into());
    }
    let array_root = value.is_array() || value.get("conversations").is_some();
    let mut out = Vec::new();
    for (index, item) in items.iter().enumerate() {
        let path = if value.is_array() {
            format!("$[{index}]")
        } else if array_root {
            format!("$.conversations[{index}]")
        } else {
            "$".into()
        };
        out.push(match provider {
            "chatgpt" => parse_chatgpt(item, name, &path)?,
            "claude" => parse_claude(item, name, &path)?,
            "generic" => parse_generic(item, name, &path)?,
            _ => unreachable!(),
        });
    }
    if out.is_empty() {
        return Err("Dosyada konuşma bulunamadı.".into());
    }
    Ok(out)
}

fn unique_conversations(items: Vec<Conversation>) -> Result<Vec<Conversation>, String> {
    let mut seen = HashSet::new();
    let out: Vec<_> = items
        .into_iter()
        .filter(|c| seen.insert(c.id.clone()))
        .collect();
    if out.is_empty() {
        Err("Dosyada konuşma bulunamadı.".into())
    } else {
        Ok(out)
    }
}

fn hash(parts: &[&[u8]]) -> String {
    let mut h = Sha256::new();
    for part in parts {
        h.update((part.len() as u64).to_be_bytes());
        h.update(part);
    }
    format!("{:x}", h.finalize())
}
fn conversation_id(provider: &str, source: &str, value: &Value) -> String {
    format!(
        "imp-{}",
        hash(&[
            provider.as_bytes(),
            source.as_bytes(),
            value.to_string().as_bytes()
        ])
    )
}
fn message_id(conversation: &str, source: &str) -> String {
    format!(
        "msg-{}",
        hash(&[conversation.as_bytes(), source.as_bytes()])
    )
}
fn string(value: &Value, key: &str) -> Option<String> {
    value
        .get(key)
        .and_then(Value::as_str)
        .filter(|s| !s.is_empty())
        .map(str::to_owned)
}
fn source_id(value: &Value, keys: &[&str]) -> String {
    keys.iter()
        .find_map(|k| string(value, k))
        .unwrap_or_else(|| hash(&[value.to_string().as_bytes()]))
}
fn clean_label(value: &str, fallback: &str, limit: usize) -> String {
    let cleaned: String = value
        .chars()
        .filter(|c| !c.is_control())
        .take(limit)
        .collect();
    if cleaned.trim().is_empty() {
        fallback.into()
    } else {
        cleaned.trim().into()
    }
}
fn basename(value: &str) -> String {
    let last = value
        .rsplit(['/', '\\'])
        .find(|s| !s.is_empty())
        .unwrap_or("import");
    if matches!(last, "." | "..") {
        return "import".into();
    }
    clean_label(last, "import", 240)
}
fn warning(warnings: &mut Vec<String>, text: &str) {
    if !warnings.iter().any(|w| w == text) {
        warnings.push(text.into());
    }
}
fn date(value: Option<&Value>, warnings: &mut Vec<String>) -> Option<String> {
    let v = value.filter(|v| !v.is_null())?;
    let dt = if let Some(s) = v.as_str() {
        DateTime::parse_from_rfc3339(s)
            .ok()
            .map(|d| d.with_timezone(&Utc))
    } else if let Some(seconds) = v.as_f64() {
        let floor = seconds.floor();
        if floor >= i64::MIN as f64 && floor <= i64::MAX as f64 {
            DateTime::from_timestamp(
                floor as i64,
                ((seconds - floor) * 1e9).round().clamp(0.0, 999_999_999.0) as u32,
            )
        } else {
            None
        }
    } else {
        None
    };
    if dt.is_none() {
        warning(warnings, "Geçersiz tarih alanı boş bırakıldı.");
    }
    dt.map(|d| d.to_rfc3339_opts(SecondsFormat::Millis, true))
}
fn new_conversation(
    provider: &str,
    app: &str,
    source: String,
    raw: &Value,
    title: &str,
) -> Conversation {
    Conversation {
        schema_version: 1,
        id: conversation_id(provider, &source, raw),
        provider: provider.into(),
        source_app: app.into(),
        source_conversation_id: source,
        title: clean_label(title, "Başlıksız konuşma", 240),
        created_at: None,
        updated_at: None,
        selected_leaf_id: None,
        messages: vec![],
        warnings: vec![],
    }
}
fn message(
    c: &Conversation,
    key: &str,
    source: String,
    role: &str,
    text: String,
    locator: String,
) -> Message {
    Message {
        id: message_id(&c.id, key),
        source_id: source,
        parent_id: None,
        role: role.into(),
        phase: None,
        text,
        attachments: vec![],
        timestamp: None,
        source_locator: locator,
        authorship_status: "unreviewed".into(),
        model: None,
    }
}

// Each adapter records original edges, including excluded nodes. This reconnects
// visible descendants to the nearest visible ancestor without joining branches.
fn connect_graph(
    c: &mut Conversation,
    parents: &HashMap<String, Option<String>>,
    retained: &HashMap<String, String>,
    selected: Option<&str>,
) -> Result<(), String> {
    let mut checked = HashSet::new();
    for start in parents.keys() {
        if checked.contains(start) {
            continue;
        }
        let mut trail = HashSet::new();
        let mut node = Some(start.as_str());
        while let Some(key) = node {
            if checked.contains(key) {
                break;
            }
            if !trail.insert(key.to_owned()) {
                return Err("Konuşma dallarında döngü bulundu.".into());
            }
            node = parents.get(key).and_then(|p| p.as_deref());
        }
        checked.extend(trail);
    }
    let mut ancestors: HashMap<String, Option<String>> = HashMap::new();
    // Cache excluded chains: large runs of tool/reasoning nodes must stay linear.
    fn visible(
        key: &str,
        parents: &HashMap<String, Option<String>>,
        retained: &HashMap<String, String>,
        cache: &mut HashMap<String, Option<String>>,
    ) -> (Option<String>, bool) {
        let mut current = Some(key.to_owned());
        let mut trail = Vec::new();
        let mut missing = false;
        let found = loop {
            let Some(k) = current else { break None };
            if let Some(id) = retained.get(&k) {
                break Some(id.clone());
            }
            if let Some(cached) = cache.get(&k) {
                break cached.clone();
            }
            trail.push(k.clone());
            match parents.get(&k) {
                Some(p) => current = p.clone(),
                None => {
                    missing = true;
                    break None;
                }
            }
        };
        for k in trail {
            cache.insert(k, found.clone());
        }
        (found, missing)
    }
    let reverse: HashMap<_, _> = retained
        .iter()
        .map(|(k, id)| (id.as_str(), k.as_str()))
        .collect();
    for m in &mut c.messages {
        if let Some(parent) = reverse
            .get(m.id.as_str())
            .and_then(|key| parents.get(*key))
            .and_then(|p| p.as_deref())
        {
            let (id, missing) = visible(parent, parents, retained, &mut ancestors);
            m.parent_id = id;
            if missing {
                warning(
                    &mut c.warnings,
                    "Eksik üst mesaj başvurusu kök olarak korundu; geçmiş eksik olabilir.",
                );
            }
        }
    }
    if let Some(key) = selected {
        let (id, missing) = visible(key, parents, retained, &mut ancestors);
        c.selected_leaf_id = id;
        if missing {
            warning(&mut c.warnings, "Kaynakta seçili dal bulunamadı.");
        }
    }
    let parents_used: HashSet<_> = c
        .messages
        .iter()
        .filter_map(|m| m.parent_id.as_deref())
        .collect();
    let leaves: Vec<_> = c
        .messages
        .iter()
        .filter(|m| !parents_used.contains(m.id.as_str()))
        .map(|m| m.id.clone())
        .collect();
    if c.selected_leaf_id
        .as_ref()
        .is_some_and(|id| !leaves.contains(id))
    {
        c.selected_leaf_id = None;
        warning(
            &mut c.warnings,
            "Seçili kaynak düğümü görünür bir dal sonu değil; dalı önizlemede seçin.",
        );
    }
    if c.selected_leaf_id.is_none() && leaves.len() == 1 {
        c.selected_leaf_id = leaves.first().cloned();
    }
    if leaves.len() > 1 {
        warning(
            &mut c.warnings,
            "Birden fazla konuşma dalı korundu; gönderim için tek dal seçilmelidir.",
        );
    }
    if c.messages.is_empty() {
        warning(
            &mut c.warnings,
            "Bu konuşmada desteklenen görünür mesaj yok; boş gövde tam sohbet sayılmaz.",
        );
    }
    // JSON object key order is not conversation order. Place ancestors before
    // descendants while leaving sibling branches separate and deterministically ordered.
    let mut children: HashMap<String, Vec<usize>> = HashMap::new();
    let mut queue = VecDeque::new();
    for (index, msg) in c.messages.iter().enumerate() {
        if let Some(parent) = &msg.parent_id {
            children.entry(parent.clone()).or_default().push(index);
        } else {
            queue.push_back(index);
        }
    }
    let mut slots: Vec<_> = std::mem::take(&mut c.messages)
        .into_iter()
        .map(Some)
        .collect();
    while let Some(index) = queue.pop_front() {
        if let Some(msg) = slots[index].take() {
            if let Some(next) = children.remove(&msg.id) {
                queue.extend(next);
            }
            c.messages.push(msg);
        }
    }
    Ok(())
}

fn attachment_label(v: &Value, fields: &[&str]) -> String {
    fields
        .iter()
        .find_map(|k| string(v, k))
        .map(|s| basename(s.split(['?', '#']).next().unwrap_or(&s)))
        .unwrap_or_else(|| "Ek dosya (içerik içe aktarılmadı)".into())
}
fn collect_attachment_metadata(value: &Value, fields: &[&str]) -> Vec<String> {
    value
        .as_array()
        .map(|a| a.iter().map(|v| attachment_label(v, fields)).collect())
        .unwrap_or_default()
}
fn parts_text(
    parts: Option<&Value>,
    warnings: &mut Vec<String>,
    attachments: &mut Vec<String>,
) -> String {
    let mut text = Vec::new();
    if let Some(parts) = parts.and_then(Value::as_array) {
        for p in parts {
            if let Some(s) = p.as_str() {
                text.push(s.to_owned());
                continue;
            }
            let kind = p
                .get("content_type")
                .or_else(|| p.get("type"))
                .and_then(Value::as_str)
                .unwrap_or("");
            match kind {
                "text" | "Text" | "input_text" | "output_text" => {
                    if let Some(s) = p.get("text").and_then(Value::as_str) {
                        text.push(s.to_owned());
                    }
                }
                "audio_transcription" => {
                    if let Some(s) = p.get("text").and_then(Value::as_str) {
                        text.push(s.to_owned());
                    }
                    warning(
                        warnings,
                        "Ses dökümleri metin olarak alındı; özgün yazarlık doğrulanmadı.",
                    );
                }
                "image_asset_pointer"
                | "audio_asset_pointer"
                | "real_time_user_audio_video_asset_pointer"
                | "input_image"
                | "image"
                | "Image" => {
                    attachments.push(format!("{kind} (yalnız ek başvurusu)"));
                }
                _ => warning(
                    warnings,
                    "Desteklenmeyen veya metin dışı içerik blokları alınmadı.",
                ),
            }
        }
    }
    text.join("\n")
}

fn parse_chatgpt(raw: &Value, name: &str, path: &str) -> Result<Conversation, String> {
    let mapping = raw
        .get("mapping")
        .and_then(Value::as_object)
        .ok_or("ChatGPT mapping alanı bulunamadı.")?;
    if mapping.len() > MAX_MESSAGES {
        return Err("Konuşmada çok fazla düğüm var.".into());
    }
    let mut c = new_conversation(
        "chatgpt",
        "ChatGPT",
        source_id(raw, &["conversation_id", "id"]),
        raw,
        raw.get("title")
            .and_then(Value::as_str)
            .unwrap_or("ChatGPT konuşması"),
    );
    c.created_at = date(raw.get("create_time"), &mut c.warnings);
    c.updated_at = date(raw.get("update_time"), &mut c.warnings);
    let mut parents = HashMap::new();
    let mut retained = HashMap::new();
    for (key, node) in mapping {
        parents.insert(key.clone(), string(node, "parent"));
        let Some(m) = node.get("message").filter(|v| v.is_object()) else {
            continue;
        };
        let role = m
            .pointer("/author/role")
            .and_then(Value::as_str)
            .unwrap_or("");
        if !matches!(role, "user" | "assistant") {
            warning(&mut c.warnings, "Sistem ve araç mesajları alınmadı.");
            continue;
        }
        if m.pointer("/metadata/is_visually_hidden_from_conversation")
            .and_then(Value::as_bool)
            == Some(true)
            || m.get("channel")
                .and_then(Value::as_str)
                .is_some_and(hidden_phase)
            || m.get("recipient")
                .and_then(Value::as_str)
                .is_some_and(|r| !matches!(r, "all" | ""))
        {
            warning(
                &mut c.warnings,
                "Gizli, düşünme veya araca yöneltilmiş mesajlar alınmadı.",
            );
            continue;
        }
        let content = m.get("content").unwrap_or(&Value::Null);
        let kind = content
            .get("content_type")
            .and_then(Value::as_str)
            .unwrap_or("");
        if !matches!(kind, "text" | "multimodal_text") {
            warning(
                &mut c.warnings,
                "Düşünme, düşünme özeti ve desteklenmeyen bloklar alınmadı.",
            );
            continue;
        }
        let mut attachments = collect_attachment_metadata(
            m.pointer("/metadata/attachments").unwrap_or(&Value::Null),
            &["name", "id"],
        );
        let text = parts_text(content.get("parts"), &mut c.warnings, &mut attachments);
        if role == "user" && injected_text(&text) {
            warning(
                &mut c.warnings,
                "Otomasyon veya ortam talimatları insan mesajı olarak alınmadı.",
            );
            continue;
        }
        if text.is_empty() && attachments.is_empty() {
            continue;
        }
        let key_path = if key.len() <= 200
            && key
                .chars()
                .all(|x| x.is_ascii_alphanumeric() || x == '-' || x == '_')
        {
            format!(
                "{path}.mapping[{}].message",
                serde_json::to_string(key).unwrap_or_default()
            )
        } else {
            format!("{path}.mapping")
        };
        let mut msg = message(
            &c,
            key,
            string(m, "id").unwrap_or_else(|| key.clone()),
            role,
            text,
            format!("{name}#{key_path}"),
        );
        msg.timestamp = date(m.get("create_time"), &mut c.warnings);
        msg.model = m
            .pointer("/metadata/model_slug")
            .and_then(Value::as_str)
            .filter(|s| !s.is_empty())
            .map(str::to_owned);
        msg.attachments = attachments;
        retained.insert(key.clone(), msg.id.clone());
        c.messages.push(msg);
    }
    if c.messages.iter().any(|m| !m.attachments.is_empty()) {
        warning(
            &mut c.warnings,
            "Ekler yalnız başvuru olarak gösterilir; ZIP içindeki medya okunmadı veya eşleştirilmedi.",
        );
    }
    connect_graph(
        &mut c,
        &parents,
        &retained,
        raw.get("current_node").and_then(Value::as_str),
    )?;
    Ok(c)
}

fn parse_claude(raw: &Value, name: &str, path: &str) -> Result<Conversation, String> {
    let messages = raw
        .get("chat_messages")
        .and_then(Value::as_array)
        .ok_or("Claude chat_messages alanı bulunamadı.")?;
    if messages.len() > MAX_MESSAGES {
        return Err("Konuşmada çok fazla mesaj var.".into());
    }
    let mut c = new_conversation(
        "claude",
        "Claude",
        source_id(raw, &["uuid"]),
        raw,
        raw.get("name")
            .and_then(Value::as_str)
            .unwrap_or("Claude konuşması"),
    );
    c.created_at = date(raw.get("created_at"), &mut c.warnings);
    c.updated_at = date(raw.get("updated_at"), &mut c.warnings);
    let mut parents = HashMap::new();
    let mut retained = HashMap::new();
    for (index, m) in messages.iter().enumerate() {
        let key = string(m, "uuid").ok_or("Claude mesaj kimliği eksik.")?;
        if parents.contains_key(&key) {
            return Err("Claude dışa aktarımında yinelenen mesaj kimliği var.".into());
        }
        let parent = string(m, "parent_message_uuid")
            .filter(|p| p != CLAUDE_ROOT && p != "00000000-0000-0000-0000-000000000000");
        parents.insert(key.clone(), parent);
        let role = match m.get("sender").and_then(Value::as_str) {
            Some("human") => "user",
            Some("assistant") => "assistant",
            _ => {
                warning(&mut c.warnings, "Bilinmeyen Claude konuşmacısı alınmadı.");
                continue;
            }
        };
        let blocks = m
            .get("content")
            .and_then(Value::as_array)
            .ok_or("Claude content blokları eksik; birleşik text güvenli yedek kaynak değildir.")?;
        let mut text = Vec::new();
        for block in blocks {
            if block.get("type").and_then(Value::as_str) == Some("text") {
                if let Some(s) = block.get("text").and_then(Value::as_str) {
                    text.push(s.to_owned());
                }
            } else {
                warning(
                    &mut c.warnings,
                    "Claude düşünme ve araç blokları alınmadı; birleşik text alanı kullanılmadı.",
                );
            }
        }
        let text = text.join("\n");
        if role == "user" && injected_text(&text) {
            warning(
                &mut c.warnings,
                "Otomasyon veya ortam talimatları insan mesajı olarak alınmadı.",
            );
            continue;
        }
        let mut attachments = collect_attachment_metadata(
            m.get("attachments").unwrap_or(&Value::Null),
            &["file_name"],
        );
        attachments.extend(collect_attachment_metadata(
            m.get("files").unwrap_or(&Value::Null),
            &["file_name", "file_uuid"],
        ));
        if text.is_empty() && attachments.is_empty() {
            continue;
        }
        let mut msg = message(
            &c,
            &key,
            key.clone(),
            role,
            text,
            format!("{name}#{path}.chat_messages[{index}].content"),
        );
        msg.timestamp = date(m.get("created_at"), &mut c.warnings);
        msg.model = string(m, "model").or_else(|| {
            m.pointer("/metadata/model")
                .and_then(Value::as_str)
                .map(str::to_owned)
        });
        msg.attachments = attachments;
        retained.insert(key, msg.id.clone());
        c.messages.push(msg);
    }
    if c.messages.iter().any(|m| !m.attachments.is_empty()) {
        warning(
            &mut c.warnings,
            "Claude eklerinin dosya baytları ve extracted_content alanı alınmadı; yalnız başvurular korundu.",
        );
    }
    connect_graph(&mut c, &parents, &retained, None)?;
    Ok(c)
}

fn injected_text(text: &str) -> bool {
    let s = text.trim_start();
    [
        "# AGENTS.md instructions",
        "<environment_context>",
        "<codex_automation_message>",
        "<codex_delegation>",
        "<permissions instructions>",
    ]
    .iter()
    .any(|prefix| s.starts_with(prefix))
}

fn hidden_phase(phase: &str) -> bool {
    matches!(
        phase,
        "analysis" | "reasoning" | "thoughts" | "summary" | "justify" | "confidence"
    )
}

#[derive(Clone)]
struct CodexItem {
    key: String,
    native_id: bool,
    turn: Option<String>,
    enclosing_turn: Option<String>,
    role: String,
    phase: Option<String>,
    text: String,
    attachments: Vec<String>,
    time: Option<Value>,
    line: usize,
    order_line: usize,
    model: Option<String>,
    removed_memory_footer: bool,
}

fn complete_codex_tag<'a>(value: &'a str, tag: &str) -> Option<&'a str> {
    let opening = format!("<{tag}>");
    let closing = format!("</{tag}>");
    let body = value
        .trim()
        .strip_prefix(&opening)?
        .strip_suffix(&closing)?;
    // Do not treat nested, partial or multiple blocks as one known suffix.
    if body.contains(&opening) || body.contains(&closing) {
        return None;
    }
    Some(body)
}

fn without_codex_memory_footer(value: &str) -> Option<&str> {
    let value = value.trim_end();
    let start = value.rfind("<oai-mem-citation>")?;
    let prefix = &value[..start];
    if !prefix.is_empty() && !prefix.ends_with('\n') {
        return None;
    }
    complete_codex_tag(&value[start..], "oai-mem-citation")?;
    Some(prefix.trim_end())
}

fn codex_plan_representation(event: &CodexItem, response: &CodexItem) -> bool {
    if event.role != "assistant" || event.text.is_empty() {
        return false;
    }
    response
        .text
        .strip_prefix(&event.text)
        .and_then(|suffix| complete_codex_tag(suffix, "proposed_plan"))
        .is_some_and(|body| !body.trim().is_empty())
}

fn codex_signature(item: &CodexItem) -> String {
    hash(&[
        serde_json::json!({"role":item.role,"text":item.text,"phase":item.phase,
        "attachments":item.attachments,"model":item.model})
        .to_string()
        .as_bytes(),
    ])
}

fn visible_codex_items(
    items: Vec<CodexItem>,
    automation_turns: &HashSet<String>,
    agent_session: bool,
    turn_models: &HashMap<String, String>,
    warnings: &mut Vec<String>,
) -> Result<Vec<CodexItem>, String> {
    let mut out = Vec::new();
    let mut identities = HashMap::new();
    for mut item in items {
        if item.phase.as_deref().is_some_and(hidden_phase) {
            warning(warnings, "Düşünme/analiz kanalındaki mesajlar alınmadı.");
            continue;
        }
        if item
            .turn
            .as_ref()
            .is_some_and(|t| automation_turns.contains(t))
            || (item.role == "user" && (agent_session || injected_text(&item.text)))
        {
            warning(
                warnings,
                "Otomasyon, alt ajan veya ortam talimatları insan mesajı olarak alınmadı.",
            );
            continue;
        }
        if item.role == "assistant" {
            if let Some(visible) = without_codex_memory_footer(&item.text) {
                item.text = visible.to_owned();
                item.removed_memory_footer = true;
                warning(
                    warnings,
                    "Tam ve sonda bulunan Codex hafıza atıf metadatası görünür asistan metninden ayrıldı.",
                );
            }
        }
        if item.text.is_empty() && item.attachments.is_empty() {
            continue;
        }
        item.model = item.model.or_else(|| {
            item.turn
                .as_ref()
                .and_then(|turn| turn_models.get(turn).cloned())
        });
        // A native ID is scoped by its turn. Reused IDs or repeated text in
        // different turns must not collapse distinct conversation messages.
        let identity = (item.turn.clone(), item.key.clone(), item.native_id);
        let signature = codex_signature(&item);
        if let Some(previous) = identities.get(&identity) {
            if previous != &signature {
                return Err(
                    "Codex aynı tur ve mesaj kimliği için çelişkili içerik içeriyor.".into(),
                );
            }
            continue;
        }
        identities.insert(identity, signature);
        out.push(item);
    }
    Ok(out)
}

fn codex_turns_compatible(a: &CodexItem, b: &CodexItem) -> bool {
    a.turn.is_none() || b.turn.is_none() || a.turn == b.turn
}

fn codex_phases_compatible(a: &CodexItem, b: &CodexItem) -> bool {
    a.phase.is_none() || b.phase.is_none() || a.phase == b.phase
}

fn prefer_codex_event(event: &mut CodexItem, response: &CodexItem) {
    // Keep canonical content, ID and source locator. Supplement only missing
    // metadata, and order by the first appearance of this message in the file.
    event.order_line = event.order_line.min(response.order_line);
    if event.turn.is_none() {
        event.turn = response.turn.clone();
    }
    if event.model.is_none() {
        event.model = response.model.clone();
    }
    if event.time.is_none() {
        event.time = response.time.clone();
    }
    if event.phase.is_none() {
        event.phase = response.phase.clone();
    }
    if event.attachments.is_empty() {
        event.attachments = response.attachments.clone();
    }
}

type CodexCopyKey = (String, String, Option<String>, String, usize);
fn codex_copy_key(item: &CodexItem) -> Option<CodexCopyKey> {
    // Content alone is never an identity. This secondary match is limited to
    // the same explicit turn, speaker, visible phase and attachment count.
    // Empty attachment-only messages cannot be distinguished by their labels.
    if item.text.is_empty() {
        return None;
    }
    Some((
        item.turn.clone()?,
        item.role.clone(),
        if item.role == "user" {
            None
        } else {
            item.phase.clone()
        },
        hash(&[item.text.as_bytes()]),
        item.attachments.len(),
    ))
}

fn merge_codex_records(
    mut events: Vec<CodexItem>,
    responses: Vec<CodexItem>,
    warnings: &mut Vec<String>,
) -> Result<Vec<CodexItem>, String> {
    let mut by_identity: HashMap<(String, String), Vec<usize>> = HashMap::new();
    for (index, event) in events
        .iter()
        .enumerate()
        .filter(|(_, event)| event.native_id)
    {
        by_identity
            .entry((event.role.clone(), event.key.clone()))
            .or_default()
            .push(index);
    }
    let mut used = vec![false; events.len()];
    let mut duplicate = vec![false; responses.len()];
    // Match explicit identities first, so a same-text fallback cannot consume
    // an event that belongs to a later response with an exact identity match.
    for (response_index, response) in responses.iter().enumerate().filter(|(_, r)| r.native_id) {
        let Some(candidates) = by_identity.get(&(response.role.clone(), response.key.clone()))
        else {
            continue;
        };
        let candidates: Vec<_> = candidates
            .iter()
            .copied()
            .filter(|i| !used[*i] && codex_turns_compatible(&events[*i], response))
            .collect();
        if candidates.len() != 1 {
            continue;
        }
        let index = candidates[0];
        let event = &events[index];
        let same_text = event.text == response.text
            || ((event.removed_memory_footer || response.removed_memory_footer)
                && event.text.trim_end() == response.text.trim_end());
        let plan_representation = !same_text && codex_plan_representation(event, response);
        if (!same_text && !plan_representation) || !codex_phases_compatible(event, response) {
            return Err(
                "Codex aynı mesajın olay ve response kaydında çelişkili görünür içerik içeriyor."
                    .into(),
            );
        }
        prefer_codex_event(&mut events[index], response);
        if plan_representation {
            // The wire representation includes a user-visible plan omitted
            // from the event's text. This is one answer, not a new turn. Keep
            // canonical identity/model/time, but point at the full-text row.
            events[index].text = response.text.clone();
            events[index].line = response.line;
            warning(
                warnings,
                "Aynı Codex yanıtının tam proposed_plan bloğu içeren response gösterimi tek mesaj olarak korundu; kaynak satırı bu gösterimi belirtir.",
            );
        }
        used[index] = true;
        duplicate[response_index] = true;
    }
    let mut by_copy: HashMap<CodexCopyKey, VecDeque<usize>> = HashMap::new();
    for (index, event) in events.iter().enumerate().filter(|(i, _)| !used[*i]) {
        if let Some(key) = codex_copy_key(event) {
            by_copy.entry(key).or_default().push_back(index);
        }
    }
    for (response_index, response) in responses.iter().enumerate() {
        if duplicate[response_index] {
            continue;
        }
        let Some(key) = codex_copy_key(response) else {
            continue;
        };
        let Some(candidates) = by_copy.get_mut(&key) else {
            continue;
        };
        if let Some(index) = candidates.pop_front() {
            prefer_codex_event(&mut events[index], response);
            used[index] = true;
            duplicate[response_index] = true;
        }
    }
    // Older response_item records have neither a native ID nor a turn ID.
    // Do not assign them a guessed turn or globally match their text. Only a
    // unique adjacent event can establish an alternate representation, with
    // an explicit surrounding task/turn context corroborating that event.
    let by_line: HashMap<usize, usize> = events
        .iter()
        .enumerate()
        .filter(|(i, event)| !used[*i] && event.native_id)
        .map(|(i, event)| (event.line, i))
        .collect();
    let mut adjacent_copies = 0;
    for (response_index, response) in responses.iter().enumerate() {
        if duplicate[response_index]
            || response.native_id
            || response.turn.is_some()
            || response.enclosing_turn.is_none()
        {
            continue;
        }
        let candidates: Vec<_> = [response.line.checked_sub(1), response.line.checked_add(1)]
            .into_iter()
            .flatten()
            .filter_map(|line| by_line.get(&line).copied())
            .filter(|i| {
                let event = &events[*i];
                !used[*i]
                    && event.turn == response.enclosing_turn
                    && event.role == response.role
                    && codex_phases_compatible(event, response)
                    && event.text == response.text
                    && event.attachments.len() == response.attachments.len()
            })
            .collect();
        if candidates.len() == 1 {
            let index = candidates[0];
            prefer_codex_event(&mut events[index], response);
            used[index] = true;
            duplicate[response_index] = true;
            adjacent_copies += 1;
        } else if candidates.len() > 1 {
            warning(
                warnings,
                "Tur/mesaj kimliği olmayan response kaydı birden fazla bitişik adayla eşleşti; belirsiz kayıt ayrı korundu.",
            );
        }
    }
    if adjacent_copies > 0 {
        warning(
            warnings,
            "Eski response kopyaları yalnız bitişik kaynak satırı, açık tur bağlamı ve aynı görünür içerik kanıtıyla bire bir tekilleştirildi.",
        );
    }
    if duplicate.iter().any(|matched| *matched) {
        warning(
            warnings,
            "Aynı tur ve mesaja ait alternatif response kopyaları bire bir eşleştirildi; görünür olay kaydı tercih edildi.",
        );
    }
    if duplicate.iter().any(|matched| !*matched) {
        warning(
            warnings,
            "Görünür olay kopyası olmayan response mesajları kaynak sırasında korundu.",
        );
    }
    events.extend(
        responses
            .into_iter()
            .enumerate()
            .filter_map(|(i, item)| (!duplicate[i]).then_some(item)),
    );
    events.sort_by_key(|item| (item.order_line, item.line));
    if events.len() > MAX_MESSAGES {
        return Err("Codex dosyasında çok fazla görünür mesaj var.".into());
    }
    Ok(events)
}

fn parse_codex(name: &str, bytes: &[u8]) -> Result<Vec<Conversation>, String> {
    let text = std::str::from_utf8(bytes).map_err(|_| "Codex JSONL UTF-8 değil.".to_string())?;
    let lines: Vec<_> = text.lines().collect();
    if lines.len() > 1_000_000 {
        return Err("Codex dosyasında çok fazla kayıt var.".into());
    }
    let last_nonempty = lines.iter().rposition(|line| !line.trim().is_empty());
    let mut events = Vec::new();
    let mut responses = Vec::new();
    let mut warnings = Vec::new();
    let mut session: Option<Value> = None;
    let mut turn_models = HashMap::new();
    let mut enclosing_turn = None;
    let mut automation_turns = HashSet::new();
    let mut saw_record = false;
    for (index, line) in lines.iter().enumerate() {
        if line.trim().is_empty() {
            continue;
        }
        let row: Value = match serde_json::from_str(line) {
            Ok(v) => v,
            Err(error)
                if Some(index) == last_nonempty && !text.ends_with('\n') && error.is_eof() =>
            {
                warning(
                    &mut warnings,
                    "Son JSONL kaydı kesilmiş; tamamlanmış önceki kayıtlar alındı.",
                );
                break;
            }
            Err(_) => {
                return Err(format!(
                    "Codex JSONL satır {} bozuk; dosya içe aktarılmadı.",
                    index + 1
                ));
            }
        };
        let Some(payload) = row.get("payload").filter(|p| p.is_object()) else {
            continue;
        };
        match row.get("type").and_then(Value::as_str).unwrap_or("") {
            "turn_context" => {
                if let Some(turn) = string(payload, "turn_id") {
                    enclosing_turn = Some(turn);
                }
                if let (Some(turn), Some(model)) =
                    (string(payload, "turn_id"), string(payload, "model"))
                {
                    turn_models.insert(turn, model);
                }
            }
            "session_meta" => {
                if let Some(old) = &session {
                    if source_id(old, &["id", "session_id"])
                        != source_id(payload, &["id", "session_id"])
                    {
                        return Err("Tek JSONL içinde farklı Codex oturumları var.".into());
                    }
                } else {
                    session = Some(payload.clone());
                }
                saw_record = true;
            }
            "compacted" => warning(
                &mut warnings,
                "Sıkıştırılmış geçmiş özeti ve replacement_history alınmadı; yalnız özgün görünür mesaj kayıtları kullanıldı.",
            ),
            "event_msg" => {
                saw_record = true;
                let kind = payload.get("type").and_then(Value::as_str).unwrap_or("");
                if kind == "task_started" {
                    enclosing_turn = string(payload, "turn_id");
                } else if matches!(kind, "task_complete" | "turn_aborted")
                    && (string(payload, "turn_id").is_none()
                        || string(payload, "turn_id") == enclosing_turn)
                {
                    enclosing_turn = None;
                }
                if kind == "task_started"
                    && payload
                        .pointer("/turn_attribution/turn_trigger")
                        .and_then(Value::as_str)
                        .is_some_and(|v| v.starts_with("automation") || v.contains("heartbeat"))
                {
                    if let Some(turn) = string(payload, "turn_id") {
                        automation_turns.insert(turn);
                    }
                }
                let item = payload.get("item").unwrap_or(&Value::Null);
                if kind == "item_completed" {
                    let role = match item.get("type").and_then(Value::as_str) {
                        Some("UserMessage" | "userMessage") => "user",
                        Some("AgentMessage" | "agentMessage") => "assistant",
                        _ => continue,
                    };
                    let mut attachments = Vec::new();
                    let content = parts_text(item.get("content"), &mut warnings, &mut attachments);
                    let content = if content.is_empty() {
                        string(item, "text").unwrap_or_default()
                    } else {
                        content
                    };
                    events.push(CodexItem {
                        key: string(item, "id").unwrap_or_else(|| format!("line-{}", index + 1)),
                        native_id: string(item, "id").is_some(),
                        turn: string(payload, "turn_id"),
                        enclosing_turn: enclosing_turn.clone(),
                        role: role.into(),
                        phase: string(item, "phase"),
                        text: content,
                        attachments,
                        time: row.get("timestamp").cloned(),
                        line: index + 1,
                        order_line: index + 1,
                        model: string(item, "model"),
                        removed_memory_footer: false,
                    });
                } else if matches!(kind, "user_message" | "agent_message") {
                    let role = if kind == "user_message" {
                        "user"
                    } else {
                        "assistant"
                    };
                    let mut attachments = Vec::new();
                    for field in ["images", "local_images"] {
                        if let Some(values) = payload.get(field).and_then(Value::as_array) {
                            attachments.extend(
                                values.iter().map(|_| "Görsel ek (içerik alınmadı)".into()),
                            );
                        }
                    }
                    events.push(CodexItem {
                        key: string(payload, "id").unwrap_or_else(|| format!("line-{}", index + 1)),
                        native_id: string(payload, "id").is_some(),
                        turn: string(payload, "turn_id"),
                        enclosing_turn: enclosing_turn.clone(),
                        role: role.into(),
                        phase: string(payload, "phase"),
                        text: string(payload, "message").unwrap_or_default(),
                        attachments,
                        time: row.get("timestamp").cloned(),
                        line: index + 1,
                        order_line: index + 1,
                        model: string(payload, "model"),
                        removed_memory_footer: false,
                    });
                }
            }
            "response_item" if payload.get("type").and_then(Value::as_str) == Some("message") => {
                saw_record = true;
                let role = payload.get("role").and_then(Value::as_str).unwrap_or("");
                if !matches!(role, "user" | "assistant") {
                    continue;
                }
                let metadata = payload
                    .get("internal_chat_message_metadata_passthrough")
                    .unwrap_or(&Value::Null);
                let mut blocks = Vec::new();
                if let Some(content) = payload.get("content").and_then(Value::as_array) {
                    for (block_index, block) in content.iter().enumerate() {
                        if role == "user" {
                            let kind = metadata
                                .get("content_item_kinds")
                                .and_then(Value::as_array)
                                .and_then(|a| a.get(block_index))
                                .and_then(Value::as_str);
                            let provenance = metadata
                                .get("content_item_metadata")
                                .and_then(Value::as_array)
                                .and_then(|a| a.get(block_index))
                                .and_then(|v| v.pointer("/provenance/type"))
                                .and_then(Value::as_str);
                            if kind.is_some_and(|k| {
                                !matches!(k, "user.text" | "user.image" | "unknown")
                            }) || provenance.is_some_and(|p| p != "user")
                            {
                                warning(
                                    &mut warnings,
                                    "Codex ortam, araç ve otomasyon bağlamı insan mesajı olarak alınmadı.",
                                );
                                continue;
                            }
                        }
                        blocks.push(block.clone());
                    }
                }
                let mut attachments = Vec::new();
                let content =
                    parts_text(Some(&Value::Array(blocks)), &mut warnings, &mut attachments);
                responses.push(CodexItem {
                    key: string(payload, "id").unwrap_or_else(|| format!("line-{}", index + 1)),
                    native_id: string(payload, "id").is_some(),
                    turn: string(metadata, "turn_id").or_else(|| string(payload, "turn_id")),
                    enclosing_turn: enclosing_turn.clone(),
                    role: role.into(),
                    phase: string(payload, "phase"),
                    text: content,
                    attachments,
                    time: metadata
                        .get("create_time")
                        .or_else(|| row.get("timestamp"))
                        .cloned(),
                    line: index + 1,
                    order_line: index + 1,
                    model: string(metadata, "model_slug").or_else(|| string(payload, "model")),
                    removed_memory_footer: false,
                });
            }
            _ => {}
        }
        if events.len() > MAX_MESSAGES || responses.len() > MAX_MESSAGES {
            return Err("Codex dosyasında çok fazla mesaj var.".into());
        }
    }
    if !saw_record {
        return Err("Codex oturum veya mesaj şeması bulunamadı.".into());
    }
    let source = session
        .as_ref()
        .map(|s| source_id(s, &["id", "session_id"]))
        .unwrap_or_else(|| hash(&[bytes]));
    let raw_fingerprint = Value::String(hash(&[bytes]));
    let mut c = new_conversation("codex", "Codex", source, &raw_fingerprint, &basename(name));
    c.warnings = warnings;
    c.created_at = date(
        session.as_ref().and_then(|s| s.get("timestamp")),
        &mut c.warnings,
    );
    if session
        .as_ref()
        .and_then(|s| s.get("history_mode"))
        .and_then(Value::as_str)
        == Some("paginated")
    {
        warning(
            &mut c.warnings,
            "Codex kaydı sayfalı geçmiş biçiminde; dosya bütün hesap geçmişinin eksiksizliğini kanıtlamaz.",
        );
    }
    let agent_session = session
        .as_ref()
        .and_then(|s| s.get("thread_source"))
        .and_then(Value::as_str)
        .is_some_and(|v| matches!(v, "subagent" | "guardian_review"));
    let events = visible_codex_items(
        events,
        &automation_turns,
        agent_session,
        &turn_models,
        &mut c.warnings,
    )?;
    let responses = visible_codex_items(
        responses,
        &automation_turns,
        agent_session,
        &turn_models,
        &mut c.warnings,
    )?;
    let items = merge_codex_records(events, responses, &mut c.warnings)?;
    let mut key_counts: HashMap<String, usize> = HashMap::new();
    for item in &items {
        *key_counts.entry(item.key.clone()).or_default() += 1;
    }
    let mut ids = HashMap::new();
    let mut previous = None;
    for item in items {
        let identity = (item.turn.clone(), item.key.clone(), item.native_id);
        let signature = codex_signature(&item);
        if let Some(previous_signature) = ids.get(&identity) {
            if previous_signature != &signature {
                return Err(
                    "Codex aynı tur ve mesaj kimliği için çelişkili içerik içeriyor.".into(),
                );
            }
            continue;
        }
        ids.insert(identity, signature);
        let internal_key = if key_counts[&item.key] > 1 {
            serde_json::json!([item.turn, item.key, item.native_id]).to_string()
        } else {
            item.key.clone()
        };
        let mut msg = message(
            &c,
            &internal_key,
            item.key.clone(),
            &item.role,
            item.text,
            format!("{name}#line:{}", item.line),
        );
        msg.parent_id = previous;
        msg.phase = item.phase;
        msg.attachments = item.attachments;
        msg.timestamp = date(item.time.as_ref(), &mut c.warnings);
        msg.model = item.model;
        previous = Some(msg.id.clone());
        c.messages.push(msg);
    }
    c.selected_leaf_id = previous;
    c.updated_at = c.messages.iter().rev().find_map(|m| m.timestamp.clone());
    if c.messages.is_empty() {
        warning(
            &mut c.warnings,
            "Bu kayıtta desteklenen görünür konuşma mesajı yok.",
        );
    }
    warning(
        &mut c.warnings,
        "Codex araç, düşünme, sistem talimatı ve ajanlar arası iletişim kayıtları alınmadı.",
    );
    Ok(vec![c])
}

fn parse_generic(raw: &Value, name: &str, path: &str) -> Result<Conversation, String> {
    let items = raw
        .get("messages")
        .and_then(Value::as_array)
        .ok_or("Töre JSON messages dizisi bulunamadı.")?;
    if items.len() > MAX_MESSAGES {
        return Err("Konuşmada çok fazla mesaj var.".into());
    }
    let source = source_id(raw, &["sourceConversationId", "id"]);
    let app = clean_label(
        raw.get("sourceApp")
            .and_then(Value::as_str)
            .unwrap_or("Töre JSON"),
        "Töre JSON",
        120,
    );
    let mut c = new_conversation(
        "generic",
        &app,
        source,
        raw,
        raw.get("title")
            .and_then(Value::as_str)
            .unwrap_or("İçe aktarılan konuşma"),
    );
    c.created_at = date(raw.get("createdAt"), &mut c.warnings);
    c.updated_at = date(raw.get("updatedAt"), &mut c.warnings);
    let mut parents = HashMap::new();
    let mut retained = HashMap::new();
    let mut previous: Option<String> = None;
    let explicit_graph = items.iter().any(|m| m.get("parentId").is_some());
    for (index, item) in items.iter().enumerate() {
        let key = string(item, "id").unwrap_or_else(|| format!("message-{index}"));
        if parents.contains_key(&key) {
            return Err("Töre JSON yinelenen mesaj kimliği içeriyor.".into());
        }
        let parent = if explicit_graph {
            string(item, "parentId")
        } else {
            previous.clone()
        };
        parents.insert(key.clone(), parent);
        previous = Some(key.clone());
        if item
            .get("phase")
            .and_then(Value::as_str)
            .is_some_and(hidden_phase)
        {
            warning(
                &mut c.warnings,
                "Düşünme/analiz kanalındaki mesajlar alınmadı.",
            );
            continue;
        }
        let role = match item.get("role").and_then(Value::as_str) {
            Some("user" | "human") => "user",
            Some("assistant" | "model") => "assistant",
            Some("system" | "developer" | "tool") => {
                warning(
                    &mut c.warnings,
                    "Sistem, geliştirici ve araç mesajları alınmadı.",
                );
                continue;
            }
            _ => {
                warning(
                    &mut c.warnings,
                    "Konuşmacısı belirtilmeyen mesajlar bilinmeyen olarak korundu.",
                );
                "unknown"
            }
        };
        let mut attachments: Vec<String> = item
            .get("attachments")
            .and_then(Value::as_array)
            .map(|a| {
                a.iter()
                    .map(|x| {
                        x.as_str()
                            .map(basename)
                            .unwrap_or_else(|| attachment_label(x, &["name", "file_name"]))
                    })
                    .collect()
            })
            .unwrap_or_default();
        let text = if let Some(s) = item.get("text").and_then(Value::as_str) {
            s.to_owned()
        } else if let Some(s) = item.get("content").and_then(Value::as_str) {
            s.to_owned()
        } else {
            parts_text(item.get("content"), &mut c.warnings, &mut attachments)
        };
        if role == "user" && injected_text(&text) {
            warning(
                &mut c.warnings,
                "Otomasyon veya ortam talimatları insan mesajı olarak alınmadı.",
            );
            continue;
        }
        if text.is_empty() && attachments.is_empty() {
            continue;
        }
        let mut msg = message(
            &c,
            &key,
            string(item, "sourceId").unwrap_or_else(|| key.clone()),
            role,
            text,
            format!("{name}#{path}.messages[{index}]"),
        );
        msg.timestamp = date(item.get("timestamp"), &mut c.warnings);
        msg.model = string(item, "model");
        msg.phase = string(item, "phase");
        msg.attachments = attachments;
        retained.insert(key, msg.id.clone());
        c.messages.push(msg);
    }
    warning(
        &mut c.warnings,
        "İçe aktarılan yazarlık ve hak beyanları güvenilir onay sayılmadı; tüm mesajlar yeniden inceleme bekliyor.",
    );
    connect_graph(
        &mut c,
        &parents,
        &retained,
        raw.get("selectedLeafId").and_then(Value::as_str),
    )?;
    Ok(c)
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::json;
    use std::io::Write;

    fn decode(provider: &str, raw: Value) -> Vec<Conversation> {
        parse(provider, "sample.json", raw.to_string().as_bytes()).unwrap()
    }
    fn chat() -> Value {
        json!({"conversation_id":"c","title":"Synthetic","create_time":10.5,"current_node":"a2","mapping":{
            "root":{"id":"root","parent":null,"message":null},
            "u":{"parent":"root","message":{"id":"u-msg","author":{"role":"user"},"content":{"content_type":"text","parts":["same"]}}},
            "reason":{"parent":"u","message":{"id":"r-msg","author":{"role":"assistant"},"content":{"content_type":"thoughts","thoughts":[{"text":"NEVER_REASONING"}]}}},
            "a1":{"parent":"reason","message":{"id":"a1-msg","author":{"role":"assistant"},"content":{"content_type":"text","parts":["first branch"]}}},
            "a2":{"parent":"u","message":{"id":"a2-msg","author":{"role":"assistant"},"content":{"content_type":"multimodal_text","parts":["second branch",{"content_type":"image_asset_pointer","asset_pointer":"sediment://test"}]}}}
        }})
    }
    fn zip_members(members: &[(&str, &[u8])]) -> Vec<u8> {
        let mut writer = zip::ZipWriter::new(Cursor::new(Vec::new()));
        for (name, data) in members {
            writer
                .start_file(
                    *name,
                    zip::write::SimpleFileOptions::default()
                        .compression_method(zip::CompressionMethod::Deflated),
                )
                .unwrap();
            writer.write_all(data).unwrap();
        }
        writer.finish().unwrap().into_inner()
    }
    #[test]
    fn chatgpt_current_branch_and_excluded_ancestor_are_preserved() {
        let c = decode("chatgpt", json!([chat()])).remove(0);
        assert_eq!(c.messages.len(), 3);
        let user = c.messages.iter().find(|m| m.role == "user").unwrap();
        assert!(
            c.messages
                .iter()
                .filter(|m| m.role == "assistant")
                .all(|m| m.parent_id.as_ref() == Some(&user.id))
        );
        assert_eq!(
            c.selected_leaf_id,
            c.messages
                .iter()
                .find(|m| m.source_id == "a2-msg")
                .map(|m| m.id.clone())
        );
        assert!(
            !serde_json::to_string(&c)
                .unwrap()
                .contains("NEVER_REASONING")
        );
        assert!(
            c.messages
                .iter()
                .all(|m| m.authorship_status == "unreviewed")
        );
    }
    #[test]
    fn split_zip_and_direct_json_have_same_ids_and_only_matching_members_are_read() {
        let a = json!([chat()]).to_string();
        let mut second = chat();
        second["conversation_id"] = json!("c2");
        let b = json!([second]).to_string();
        let zip = zip_members(&[
            ("export/conversations-000.json", a.as_bytes()),
            ("export/conversations-001.json", b.as_bytes()),
            ("account.json", b"not json"),
        ]);
        let got = parse("chatgpt", "bundle.zip", &zip).unwrap();
        assert_eq!(got.len(), 2);
        assert_eq!(
            got[0].id,
            parse("chatgpt", "/private/example/a.json", a.as_bytes()).unwrap()[0].id
        );
        assert!(!got[0].messages[0].source_locator.contains("export/"));
        assert_eq!(
            got[0].id,
            parse("chatgpt", "bundle.zip", &zip).unwrap()[0].id
        );
    }
    #[test]
    fn archive_paths_and_size_entry_limits_fail_closed() {
        let unsafe_zip = zip_members(&[("../conversations.json", b"[]")]);
        assert!(parse("chatgpt", "bad.zip", &unsafe_zip).is_err());
        for path in ["/absolute.json", "C:/x.json", "a\\b.json", "a/../b.json"] {
            assert!(!safe_archive_path(path));
        }
        let zip = zip_members(&[
            ("conversations.json", b"[123456789]"),
            ("asset.bin", b"abcd"),
        ]);
        assert!(
            parse_limited(
                "chatgpt",
                "x.zip",
                &zip,
                Limits {
                    input: zip.len(),
                    expanded: 10,
                    entries: 10
                }
            )
            .is_err()
        );
        assert!(
            parse_limited(
                "chatgpt",
                "x.zip",
                &zip,
                Limits {
                    input: zip.len(),
                    expanded: 1000,
                    entries: 1
                }
            )
            .is_err()
        );
        assert!(
            parse_limited(
                "chatgpt",
                "x.zip",
                &zip,
                Limits {
                    input: 2,
                    expanded: 1000,
                    entries: 10
                }
            )
            .is_err()
        );
        assert!(read_bounded(&mut Cursor::new(b"1234"), 3).is_err());
    }
    #[test]
    fn claude_never_uses_combined_text_and_keeps_branches_and_attachments() {
        let c = decode("claude", json!([{"uuid":"c","name":"Example","chat_messages":[
            {"uuid":"u","parent_message_uuid":CLAUDE_ROOT,"sender":"human","text":"MIXED_PRIVATE","content":[{"type":"text","text":"question"}],"attachments":[{"file_name":"notes.txt","extracted_content":"NEVER_DOCUMENT"}]},
            {"uuid":"a","parent_message_uuid":"u","sender":"assistant","text":"NEVER_THINKING","content":[{"type":"thinking","thinking":"NEVER_THINKING"},{"type":"tool_result","content":"NEVER_TOOL"},{"type":"text","text":"visible"}]},
            {"uuid":"b","parent_message_uuid":"u","sender":"assistant","text":"","content":[{"type":"text","text":"alternate"}]}]}])).remove(0);
        assert_eq!(c.messages.len(), 3);
        assert!(c.selected_leaf_id.is_none());
        let serialized = serde_json::to_string(&c).unwrap();
        for hidden in [
            "MIXED_PRIVATE",
            "NEVER_DOCUMENT",
            "NEVER_THINKING",
            "NEVER_TOOL",
        ] {
            assert!(!serialized.contains(hidden));
        }
        assert_eq!(c.messages[0].attachments, vec!["notes.txt"]);
    }
    fn record(kind: &str, payload: Value) -> Value {
        json!({"timestamp":"2026-01-01T00:00:00Z","type":kind,"payload":payload})
    }
    fn codex_event(id: &str, role: &str, text: &str, turn: &str) -> Value {
        record(
            "event_msg",
            json!({"type":"item_completed","turn_id":turn,"item":{"id":id,"type":role,"phase":"final_answer","content":[{"type":if role=="UserMessage" {"text"} else {"Text"},"text":text}]}}),
        )
    }
    fn jsonl(rows: &[Value]) -> Vec<u8> {
        rows.iter()
            .map(Value::to_string)
            .collect::<Vec<_>>()
            .join("\n")
            .into_bytes()
    }
    fn codex_response(
        id: &str,
        role: &str,
        text: &str,
        turn: Option<&str>,
        phase: Option<&str>,
    ) -> Value {
        record(
            "response_item",
            json!({"type":"message","id":id,"role":role,"phase":phase,
            "content":[{"type":if role=="user"{"input_text"}else{"output_text"},"text":text}],
            "internal_chat_message_metadata_passthrough":{"turn_id":turn,"create_time":1700000000,
                "content_item_kinds":[if role=="user"{"user.text"}else{"unknown"}]}}),
        )
    }
    fn codex_legacy_response(role: &str, text: &str, phase: Option<&str>) -> Value {
        let mut value = codex_response("unused", role, text, None, phase);
        value["payload"].as_object_mut().unwrap().remove("id");
        value["payload"]["internal_chat_message_metadata_passthrough"]
            .as_object_mut()
            .unwrap()
            .remove("turn_id");
        value
    }

    #[test]
    fn codex_adjacent_legacy_copies_require_explicit_context_and_keep_repeated_turns() {
        let data = jsonl(&[
            record(
                "turn_context",
                json!({"turn_id":"t1","model":"source-model"}),
            ),
            codex_legacy_response("user", "repeated question", None),
            codex_event("u1", "UserMessage", "repeated question", "t1"),
            codex_event("a1", "AgentMessage", "answer", "t1"),
            codex_legacy_response(
                "assistant",
                "answer\n<oai-mem-citation>\nNEVER_LEGACY_MEMORY\n</oai-mem-citation>",
                Some("final_answer"),
            ),
            record("event_msg", json!({"type":"task_complete","turn_id":"t1"})),
            record("event_msg", json!({"type":"task_started","turn_id":"t2"})),
            codex_legacy_response("user", "repeated question", None),
            codex_event("u2", "UserMessage", "repeated question", "t2"),
        ]);
        let c = parse("codex", "legacy.jsonl", &data).unwrap().remove(0);
        assert_eq!(c.messages.len(), 3);
        assert_eq!(c.messages[0].text, c.messages[2].text);
        assert_ne!(c.messages[0].id, c.messages[2].id);
        assert_eq!(
            c.messages
                .iter()
                .map(|m| m.source_id.as_str())
                .collect::<Vec<_>>(),
            vec!["u1", "a1", "u2"]
        );
        assert!(c.messages[0].source_locator.ends_with("#line:3"));
        assert!(c.messages[1].source_locator.ends_with("#line:4"));
        assert!(
            !serde_json::to_string(&c)
                .unwrap()
                .contains("NEVER_LEGACY_MEMORY")
        );
        assert!(
            c.warnings
                .iter()
                .any(|w| w.contains("bitişik kaynak satırı"))
        );
    }

    #[test]
    fn codex_legacy_nonadjacent_ambiguous_or_unproven_pairs_remain_separate() {
        let context = || record("turn_context", json!({"turn_id":"t"}));
        let canonical = || codex_event("u", "UserMessage", "same", "t");
        let legacy = || codex_legacy_response("user", "same", None);
        let cases = [
            vec![
                context(),
                canonical(),
                record("event_msg", json!({"type":"token_count"})),
                legacy(),
            ],
            vec![
                context(),
                canonical(),
                legacy(),
                codex_event("other", "UserMessage", "same", "t"),
            ],
            vec![
                record("turn_context", json!({"turn_id":"wrong"})),
                canonical(),
                legacy(),
            ],
            vec![canonical(), legacy()],
            vec![
                context(),
                canonical(),
                codex_response("different-native", "user", "same", None, None),
            ],
            vec![
                context(),
                canonical(),
                codex_response("different-turn", "user", "same", Some("other-turn"), None),
            ],
            vec![
                context(),
                record("event_msg", json!({"type":"task_complete","turn_id":"t"})),
                canonical(),
                legacy(),
            ],
        ];
        for (index, rows) in cases.into_iter().enumerate() {
            let c = parse("codex", "keep-uncertain.jsonl", &jsonl(&rows))
                .unwrap()
                .remove(0);
            assert_eq!(
                c.messages.len(),
                if index == 1 { 3 } else { 2 },
                "case {index}"
            );
            if index == 1 {
                assert!(c.warnings.iter().any(|w| w.contains("belirsiz kayıt")));
            }
        }
    }

    #[test]
    fn codex_legacy_adjacency_is_one_to_one_and_keeps_phase_or_attachment_differences() {
        let context = || record("turn_context", json!({"turn_id":"t"}));
        let c = parse(
            "codex",
            "one-to-one.jsonl",
            &jsonl(&[
                context(),
                codex_legacy_response("user", "same", None),
                codex_event("u", "UserMessage", "same", "t"),
                codex_legacy_response("user", "same", None),
            ]),
        )
        .unwrap()
        .remove(0);
        assert_eq!(c.messages.len(), 2);
        let c = parse(
            "codex",
            "phase.jsonl",
            &jsonl(&[
                context(),
                codex_event("a", "AgentMessage", "same", "t"),
                codex_legacy_response("assistant", "same", Some("commentary")),
            ]),
        )
        .unwrap()
        .remove(0);
        assert_eq!(c.messages.len(), 2);
        let mut image = codex_event("u", "UserMessage", "same", "t");
        image["payload"]["item"]["content"]
            .as_array_mut()
            .unwrap()
            .push(json!({"type":"Image"}));
        let c = parse(
            "codex",
            "attachments.jsonl",
            &jsonl(&[
                context(),
                image,
                codex_legacy_response("user", "same", None),
            ]),
        )
        .unwrap()
        .remove(0);
        assert_eq!(c.messages.len(), 2);
    }

    #[test]
    fn codex_mixed_stream_preserves_response_only_turns_and_roles() {
        let data = jsonl(&[
            record(
                "session_meta",
                json!({"id":"synthetic-mixed","history_mode":"paginated"}),
            ),
            codex_response("wire-u1", "user", "question one", Some("t1"), None),
            codex_event("u1", "UserMessage", "question one", "t1"),
            codex_event("a1", "AgentMessage", "answer one", "t1"),
            codex_response(
                "a1",
                "assistant",
                "answer one",
                Some("t1"),
                Some("final_answer"),
            ),
            codex_response("u2", "user", "response-only question", Some("t2"), None),
            codex_response(
                "a2",
                "assistant",
                "response-only answer",
                Some("t2"),
                Some("final_answer"),
            ),
            codex_event("u3", "UserMessage", "canonical question", "t3"),
            codex_response(
                "a3",
                "assistant",
                "fallback role answer",
                Some("t3"),
                Some("final_answer"),
            ),
            codex_response("u4", "user", "fallback role question", Some("t4"), None),
            codex_event("a4", "AgentMessage", "canonical answer", "t4"),
            codex_event("u5", "UserMessage", "first user message", "t5"),
            codex_response(
                "u5-extra",
                "user",
                "additional same-role message",
                Some("t5"),
                None,
            ),
        ]);
        let c = parse("codex", "mixed.jsonl", &data).unwrap().remove(0);
        assert_eq!(
            c.messages
                .iter()
                .map(|m| m.text.as_str())
                .collect::<Vec<_>>(),
            vec![
                "question one",
                "answer one",
                "response-only question",
                "response-only answer",
                "canonical question",
                "fallback role answer",
                "fallback role question",
                "canonical answer",
                "first user message",
                "additional same-role message"
            ]
        );
        assert_eq!(c.messages[0].source_id, "u1");
        assert!(c.messages[0].source_locator.ends_with("#line:3"));
        for pair in c.messages.windows(2) {
            assert_eq!(pair[1].parent_id.as_ref(), Some(&pair[0].id));
        }
        assert!(
            c.messages
                .iter()
                .all(|m| m.authorship_status == "unreviewed")
        );
        assert!(c.warnings.iter().any(|w| w.contains("response mesajları")));
    }

    #[test]
    fn codex_copy_matching_is_one_to_one_and_never_global_text_deduplication() {
        let data = jsonl(&[
            codex_event("reused-native", "UserMessage", "same", "t1"),
            codex_event("u2", "UserMessage", "same", "t1"),
            codex_response("wire-u1", "user", "same", Some("t1"), None),
            codex_response("wire-u2", "user", "same", Some("t1"), None),
            codex_response("wire-u3-extra", "user", "same", Some("t1"), None),
            codex_event("reused-native", "UserMessage", "same", "t2"),
            codex_response("reused-native", "user", "same", Some("t2"), None),
            codex_response("t3-only", "user", "same", Some("t3"), None),
            codex_response("unscoped-1", "user", "same", None, None),
            codex_response("unscoped-2", "user", "same", None, None),
        ]);
        let c = parse("codex", "repeats.jsonl", &data).unwrap().remove(0);
        assert_eq!(c.messages.len(), 7);
        assert!(c.messages.iter().all(|m| m.text == "same"));
        assert_eq!(
            c.messages
                .iter()
                .map(|m| &m.id)
                .collect::<HashSet<_>>()
                .len(),
            7
        );
        assert_eq!(
            c.messages
                .iter()
                .filter(|m| m.source_id == "reused-native")
                .count(),
            2
        );
        for kept in ["u2", "wire-u3-extra", "t3-only", "unscoped-1", "unscoped-2"] {
            assert!(c.messages.iter().any(|m| m.source_id == kept));
        }
    }

    #[test]
    fn codex_hidden_or_automation_events_cannot_suppress_visible_responses() {
        let mut hidden = codex_event("hidden-id", "AgentMessage", "NEVER_REASONING", "t1");
        hidden["payload"]["item"]["phase"] = json!("analysis");
        let mut environment = codex_response("env", "user", "NEVER_ENV", Some("t1"), None);
        environment["payload"]["internal_chat_message_metadata_passthrough"]["content_item_kinds"] =
            json!(["environments.environment_context"]);
        let data = jsonl(&[
            hidden,
            codex_response(
                "hidden-id",
                "assistant",
                "visible final",
                Some("t1"),
                Some("final_answer"),
            ),
            codex_event(
                "environment-event",
                "UserMessage",
                "# AGENTS.md instructions\nNEVER_INSTRUCTIONS",
                "t1",
            ),
            codex_response(
                "environment-event",
                "user",
                "actual human message",
                Some("t1"),
                None,
            ),
            environment,
            record(
                "event_msg",
                json!({"type":"task_started","turn_id":"auto","turn_attribution":{"turn_trigger":"automation_scheduled"}}),
            ),
            codex_event("auto-event", "UserMessage", "NEVER_AUTO_EVENT", "auto"),
            codex_response(
                "auto-response",
                "assistant",
                "NEVER_AUTO_RESPONSE",
                Some("auto"),
                Some("final_answer"),
            ),
            codex_response(
                "analysis-response",
                "assistant",
                "NEVER_ANALYSIS",
                Some("t2"),
                Some("analysis"),
            ),
            record(
                "response_item",
                json!({"type":"function_call_output","output":"NEVER_TOOL"}),
            ),
            record(
                "response_item",
                json!({"type":"message","role":"system","content":[{"type":"input_text","text":"NEVER_SYSTEM"}]}),
            ),
        ]);
        let c = parse("codex", "filters.jsonl", &data).unwrap().remove(0);
        assert_eq!(
            c.messages
                .iter()
                .map(|m| m.text.as_str())
                .collect::<Vec<_>>(),
            vec!["visible final", "actual human message"]
        );
        assert!(!serde_json::to_string(&c).unwrap().contains("NEVER_"));
    }

    #[test]
    fn codex_exact_identity_precedes_content_matching_and_phase_is_preserved() {
        let mut commentary = codex_event("commentary", "AgentMessage", "same answer", "t");
        commentary["payload"]["item"]["phase"] = json!("commentary");
        let mut response = codex_response(
            "wire-only",
            "assistant",
            "response model",
            Some("other"),
            Some("final_answer"),
        );
        response["payload"]["internal_chat_message_metadata_passthrough"]["model_slug"] =
            json!("response-source-model");
        let c = parse(
            "codex",
            "identity.jsonl",
            &jsonl(&[
                codex_event("u1", "UserMessage", "same", "t"),
                codex_event("u2", "UserMessage", "same", "t"),
                codex_response("different-wire-id", "user", "same", Some("t"), None),
                codex_response("u1", "user", "same", Some("t"), None),
                commentary,
                codex_response(
                    "final",
                    "assistant",
                    "same answer",
                    Some("t"),
                    Some("final_answer"),
                ),
                response,
            ]),
        )
        .unwrap()
        .remove(0);
        assert_eq!(c.messages.len(), 5);
        assert_eq!(c.messages[2].phase.as_deref(), Some("commentary"));
        assert_eq!(c.messages[3].phase.as_deref(), Some("final_answer"));
        assert_eq!(
            c.messages[4].model.as_deref(),
            Some("response-source-model")
        );
        assert!(
            parse(
                "codex",
                "conflict.jsonl",
                &jsonl(&[
                    codex_event("shared", "AgentMessage", "canonical text", "t"),
                    codex_response(
                        "shared",
                        "assistant",
                        "conflicting text",
                        Some("t"),
                        Some("final_answer")
                    ),
                ])
            )
            .is_err()
        );
    }

    #[test]
    fn codex_history_base_segments_remain_distinct_linked_source_versions() {
        let first = jsonl(&[
            record(
                "session_meta",
                json!({"id":"same-root","history_mode":"paginated"}),
            ),
            codex_event("first", "UserMessage", "first segment", "t1"),
        ]);
        let second = jsonl(&[
            record(
                "session_meta",
                json!({"id":"same-root","history_mode":"paginated",
                "history_base":{"thread_id":"same-root","end_ordinal_exclusive":2,"end_byte_offset":first.len()}}),
            ),
            codex_response("later", "user", "later segment", Some("t2"), None),
        ]);
        let archive = zip_members(&[("first.jsonl", &first), ("later.jsonl", &second)]);
        let c = parse("codex", "segments.zip", &archive).unwrap();
        assert_eq!(c.len(), 2);
        assert_eq!(c[0].source_conversation_id, c[1].source_conversation_id);
        assert_ne!(c[0].id, c[1].id);
        assert_eq!(c[0].messages.len(), 1);
        assert_eq!(c[1].messages.len(), 1);
        assert!(
            c.iter()
                .all(|c| c.warnings.iter().any(|w| w.contains("sayfalı")))
        );
        assert_eq!(
            c[0].id,
            parse("codex", "first.jsonl", &first).unwrap()[0].id
        );
        assert_eq!(
            c[1].id,
            parse("codex", "later.jsonl", &second).unwrap()[0].id
        );
    }

    #[test]
    fn codex_complete_memory_footer_is_metadata_not_a_second_visible_message() {
        let footer = "\n\n<oai-mem-citation>\n<citation_entries>\nNEVER_MEMORY_METADATA\n</citation_entries>\n<rollout_ids>\nsynthetic-only\n</rollout_ids>\n</oai-mem-citation>";
        let data = jsonl(&[
            codex_event("a", "AgentMessage", "Visible answer", "t"),
            codex_response(
                "a",
                "assistant",
                &format!("Visible answer{footer}"),
                Some("t"),
                Some("final_answer"),
            ),
            codex_response(
                "fallback",
                "assistant",
                &format!("Response-only answer{footer}"),
                Some("t2"),
                Some("final_answer"),
            ),
        ]);
        let c = parse("codex", "memory.jsonl", &data).unwrap().remove(0);
        assert_eq!(c.messages.len(), 2);
        assert_eq!(c.messages[0].text, "Visible answer");
        assert!(c.messages[0].source_locator.ends_with("#line:1"));
        assert_eq!(c.messages[1].text, "Response-only answer");
        assert!(
            !serde_json::to_string(&c)
                .unwrap()
                .contains("NEVER_MEMORY_METADATA")
        );
        assert!(c.warnings.iter().any(|w| w.contains("hafıza atıf")));
        // The rule is reserved for assistant metadata. Human text is unchanged.
        let user = parse(
            "codex",
            "human.jsonl",
            &jsonl(&[codex_response(
                "u",
                "user",
                &format!("Human example{footer}"),
                Some("t"),
                None,
            )]),
        )
        .unwrap()
        .remove(0);
        assert!(user.messages[0].text.contains("<oai-mem-citation>"));
    }

    #[test]
    fn codex_complete_plan_suffix_keeps_one_full_answer_with_response_locator() {
        let full = "Here is the plan.\n\n<proposed_plan>\nSynthetic step one.\nSynthetic step two.\n</proposed_plan>";
        let mut event = codex_event("same-native", "AgentMessage", "Here is the plan.", "t");
        event["payload"]["item"]["model"] = json!("canonical-model");
        let mut response = codex_response(
            "same-native",
            "assistant",
            full,
            Some("t"),
            Some("final_answer"),
        );
        response["payload"]["internal_chat_message_metadata_passthrough"]["model_slug"] =
            json!("response-model");
        let c = parse("codex", "plan.jsonl", &jsonl(&[event, response]))
            .unwrap()
            .remove(0);
        assert_eq!(c.messages.len(), 1);
        assert_eq!(c.messages[0].text, full);
        assert_eq!(c.messages[0].source_id, "same-native");
        assert_eq!(c.messages[0].model.as_deref(), Some("canonical-model"));
        assert_eq!(
            c.messages[0].timestamp.as_deref(),
            Some("2026-01-01T00:00:00.000Z")
        );
        assert_eq!(c.messages[0].phase.as_deref(), Some("final_answer"));
        assert!(c.messages[0].source_locator.ends_with("#line:2"));
        assert!(c.warnings.iter().any(|w| w.contains("proposed_plan")));
    }

    #[test]
    fn codex_unrecognized_partial_or_nonterminal_suffix_conflicts_still_fail() {
        for suffix in [
            " ordinary extra visible text",
            "\n<proposed_plan>partial plan",
            "\n<proposed_plan>plan</proposed_plan> more text",
            "\n<unknown_tag>visible data</unknown_tag>",
            "\n<oai-mem-citation>partial metadata",
            "\n<oai-mem-citation>metadata</oai-mem-citation> visible tail",
            "\n<proposed_plan>one</proposed_plan>\n<proposed_plan>two</proposed_plan>",
        ] {
            let data = jsonl(&[
                codex_event("same", "AgentMessage", "Prefix", "t"),
                codex_response(
                    "same",
                    "assistant",
                    &format!("Prefix{suffix}"),
                    Some("t"),
                    Some("final_answer"),
                ),
            ]);
            assert!(parse("codex", "unsafe-match.jsonl", &data).is_err());
        }
        let different_id = parse(
            "codex",
            "different-id.jsonl",
            &jsonl(&[
                codex_event("first-id", "AgentMessage", "Prefix", "t"),
                codex_response(
                    "other-id",
                    "assistant",
                    "Prefix\n<proposed_plan>Plan</proposed_plan>",
                    Some("t"),
                    Some("final_answer"),
                ),
            ]),
        )
        .unwrap()
        .remove(0);
        assert_eq!(
            different_id.messages.len(),
            2,
            "A prefix alone must not establish message identity"
        );
    }
    #[test]
    fn codex_canonical_events_keep_real_repeats_and_drop_duplicate_response_tools_and_automation() {
        let data = jsonl(&[
            record("session_meta", json!({"id":"s","history_mode":"paginated"})),
            codex_event("u1", "UserMessage", "same", "t1"),
            record(
                "response_item",
                json!({"type":"message","role":"user","id":"u1","content":[{"type":"input_text","text":"same"}]}),
            ),
            codex_event("a1", "AgentMessage", "answer", "t1"),
            codex_event("u2", "UserMessage", "same", "t2"),
            record(
                "event_msg",
                json!({"type":"task_started","turn_id":"auto","turn_attribution":{"turn_trigger":"automation_heartbeat_scheduled"}}),
            ),
            codex_event("auto1", "UserMessage", "NEVER_AUTOMATION", "auto"),
            record(
                "response_item",
                json!({"type":"reasoning","summary":["NEVER_REASONING"]}),
            ),
            record(
                "response_item",
                json!({"type":"function_call_output","output":"NEVER_TOOL"}),
            ),
            record(
                "compacted",
                json!({"message":"NEVER_SUMMARY","replacement_history":[]}),
            ),
        ]);
        let c = parse("codex", "/private/path/rollout.jsonl", &data)
            .unwrap()
            .remove(0);
        assert_eq!(c.messages.len(), 3);
        assert_eq!(c.messages[0].text, c.messages[2].text);
        assert_ne!(c.messages[0].id, c.messages[2].id);
        assert_eq!(c.messages[2].parent_id.as_ref(), Some(&c.messages[1].id));
        assert!(
            c.messages
                .iter()
                .all(|m| m.source_locator.starts_with("rollout.jsonl#line:"))
        );
        assert!(!serde_json::to_string(&c).unwrap().contains("NEVER_"));
    }
    #[test]
    fn codex_response_fallback_filters_harness_and_preserves_final() {
        let data = jsonl(&[
            record(
                "response_item",
                json!({"type":"message","id":"u","role":"user","content":[
            {"type":"input_text","text":"NEVER_ENV"},{"type":"input_text","text":"human data"}],
            "internal_chat_message_metadata_passthrough":{"content_item_kinds":["environments.environment_context","user.text"]}}),
            ),
            record(
                "response_item",
                json!({"type":"message","id":"a","role":"assistant","phase":"final_answer","content":[{"type":"output_text","text":"visible"}]}),
            ),
        ]);
        let c = parse("codex", "sample.jsonl", &data).unwrap().remove(0);
        assert_eq!(c.messages.len(), 2);
        assert_eq!(c.messages[0].text, "human data");
        assert_eq!(c.messages[1].phase.as_deref(), Some("final_answer"));
    }
    #[test]
    fn truncated_tail_is_warned_but_bad_middle_rejected_and_zstd_is_bounded() {
        let mut valid = jsonl(&[codex_event("u", "UserMessage", "example", "t")]);
        valid.extend_from_slice(b"\n{\"type\":");
        let c = parse("codex", "sample.jsonl", &valid).unwrap().remove(0);
        assert_eq!(c.messages.len(), 1);
        assert!(c.warnings.iter().any(|w| w.contains("kesilmiş")));
        let mut middle = valid.clone();
        middle.extend_from_slice(b"\n{}\n");
        assert!(parse("codex", "sample.jsonl", &middle).is_err());
        let compressed = zstd::stream::encode_all(Cursor::new(&valid), 1).unwrap();
        assert_eq!(
            parse("codex", "sample.jsonl.zst", &compressed).unwrap()[0]
                .messages
                .len(),
            1
        );
        assert!(
            parse_limited(
                "codex",
                "sample.jsonl.zst",
                &compressed,
                Limits {
                    input: compressed.len(),
                    expanded: 3,
                    entries: 10
                }
            )
            .is_err()
        );
    }
    #[test]
    fn generic_and_plain_text_do_not_trust_authorship_or_infer_speakers() {
        let c = decode("generic", json!({"id":"t","messages":[{"id":"1","role":"user","text":"same","authorshipStatus":"human_original"},{"id":"2","role":"assistant","text":"same"}]})).remove(0);
        assert_eq!(c.messages.len(), 2);
        assert_eq!(c.messages[0].authorship_status, "unreviewed");
        assert_eq!(c.messages[1].parent_id.as_ref(), Some(&c.messages[0].id));
        let text = parse_text(
            "Example developer",
            "Test",
            "Assistant: a label is still data",
        )
        .unwrap();
        assert_eq!(text[0].messages[0].role, "unknown");
        assert_eq!(
            text[0].id,
            parse_text(
                "Example developer",
                "Test",
                "Assistant: a label is still data"
            )
            .unwrap()[0]
                .id
        );
    }
    #[test]
    fn cycles_rejected_and_orphans_not_silently_attached_elsewhere() {
        let mut raw = chat();
        raw["mapping"]["u"]["parent"] = json!("a2");
        assert!(parse("chatgpt", "sample.json", raw.to_string().as_bytes()).is_err());
        let c = decode("generic", json!({"messages":[{"id":"a","role":"user","text":"orphan","parentId":"missing"},{"id":"b","role":"user","text":"root","parentId":null}]})).remove(0);
        assert!(c.messages.iter().all(|m| m.parent_id.is_none()));
        assert!(c.selected_leaf_id.is_none());
        assert!(c.warnings.iter().any(|w| w.contains("Eksik üst")));
    }

    #[test]
    fn hidden_text_channels_are_excluded_and_children_reconnected() {
        let c = decode("generic", json!({"messages":[
            {"id":"u","role":"user","text":"question","parentId":null},
            {"id":"r","role":"assistant","phase":"analysis","text":"NEVER_INTERNAL","parentId":"u"},
            {"id":"a","role":"assistant","phase":"final_answer","text":"answer","parentId":"r"}
        ]})).remove(0);
        assert_eq!(c.messages.len(), 2);
        assert_eq!(c.messages[1].parent_id.as_ref(), Some(&c.messages[0].id));
        let mut raw = chat();
        raw["mapping"]["a1"]["message"]["metadata"] =
            json!({"is_visually_hidden_from_conversation":true});
        raw["mapping"]["a2"]["message"]["recipient"] = json!("python");
        assert_eq!(decode("chatgpt", raw)[0].messages.len(), 1);
    }

    #[test]
    fn attachment_only_and_empty_conversations_are_explicit_and_dates_are_checked() {
        let c=decode("claude",json!({"uuid":"empty-body","name":"Example","created_at":"not a date","chat_messages":[
            {"uuid":"u","parent_message_uuid":CLAUDE_ROOT,"sender":"human","text":"","content":[],"files":[{"file_name":"/private/document.txt"}]}
        ]})).remove(0);
        assert_eq!(c.messages.len(), 1);
        assert_eq!(c.messages[0].text, "");
        assert_eq!(c.messages[0].attachments, vec!["document.txt"]);
        assert!(c.created_at.is_none());
        let empty = decode("claude", json!({"uuid":"empty","chat_messages":[]}));
        assert!(empty[0].messages.is_empty());
        assert!(!empty[0].warnings.is_empty());
        assert!(parse("claude","file.json",br#"{"uuid":"c","chat_messages":[{"uuid":"m","sender":"assistant","text":"do not use me"}]}"#).is_err());
    }

    #[test]
    fn codex_message_id_conflicts_rejected_even_when_visible_text_matches() {
        let first = codex_event("a", "AgentMessage", "answer", "t");
        let mut changed = first.clone();
        changed["payload"]["item"]["phase"] = json!("commentary");
        assert!(parse("codex", "sample.jsonl", &jsonl(&[first, changed])).is_err());
    }

    #[test]
    fn source_model_is_kept_only_when_present_in_source_metadata() {
        let mut raw = chat();
        raw["mapping"]["a2"]["message"]["metadata"] = json!({"model_slug":"example-source-model"});
        let c = decode("chatgpt", raw).remove(0);
        assert_eq!(
            c.messages
                .iter()
                .find(|m| m.source_id == "a2-msg")
                .unwrap()
                .model
                .as_deref(),
            Some("example-source-model")
        );
        assert!(
            c.messages
                .iter()
                .find(|m| m.role == "user")
                .unwrap()
                .model
                .is_none()
        );
        let data = jsonl(&[
            record(
                "turn_context",
                json!({"turn_id":"t","model":"example-codex-model"}),
            ),
            codex_event("a", "AgentMessage", "answer", "t"),
        ]);
        assert_eq!(
            parse("codex", "sample.jsonl", &data).unwrap()[0].messages[0]
                .model
                .as_deref(),
            Some("example-codex-model")
        );
        let plain = parse_text("Developer", "Title", "Example").unwrap();
        assert!(
            serde_json::to_value(&plain[0].messages[0])
                .unwrap()
                .get("model")
                .is_none()
        );
    }

    #[test]
    fn public_fixture_files_are_usable_without_private_data() {
        assert_eq!(
            zstd::stream::decode_all(std::io::Cursor::new(include_bytes!(
                "../../../fixtures/codex.jsonl.zst"
            )))
            .unwrap(),
            include_bytes!("../../../fixtures/codex.jsonl")
        );
        let samples: &[(&str, &str, &[u8], usize)] = &[
            (
                "chatgpt",
                "chatgpt-branched.json",
                include_bytes!("../../../fixtures/chatgpt-branched.json"),
                3,
            ),
            (
                "claude",
                "claude.json",
                include_bytes!("../../../fixtures/claude.json"),
                3,
            ),
            (
                "codex",
                "codex.jsonl",
                include_bytes!("../../../fixtures/codex.jsonl"),
                3,
            ),
            (
                "codex",
                "codex.jsonl.zst",
                include_bytes!("../../../fixtures/codex.jsonl.zst"),
                3,
            ),
            (
                "generic",
                "tore.json",
                include_bytes!("../../../fixtures/tore.json"),
                2,
            ),
        ];
        for (provider, name, bytes, count) in samples {
            let conversations = parse(provider, name, bytes).unwrap();
            assert_eq!(conversations.len(), 1);
            assert_eq!(conversations[0].messages.len(), *count, "{name}");
            assert!(
                conversations[0]
                    .messages
                    .iter()
                    .all(|m| m.authorship_status == "unreviewed")
            );
            assert!(
                !serde_json::to_string(&conversations)
                    .unwrap()
                    .contains("MUST_NOT_APPEAR")
            );
        }
        assert_eq!(
            parse("codex", "codex.jsonl", samples[2].2).unwrap()[0].id,
            parse("codex", "codex.jsonl.zst", samples[3].2).unwrap()[0].id
        );
    }
}
