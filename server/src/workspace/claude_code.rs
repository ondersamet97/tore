//! Claude Code sessions kept on this computer, read only when the person asks.
//! A session is converted to the generic conversation format and goes through
//! the ordinary import preview; nothing is watched, indexed or read in the
//! background, and the session files are never changed.
use serde_json::{Value, json};
use std::{
    fs,
    io::{BufRead, BufReader},
    path::{Path, PathBuf},
};

const MAX_BYTES: u64 = 64 * 1024 * 1024;
const MAX_SESSIONS: usize = 2000;

pub fn projects_dir() -> Option<PathBuf> {
    std::env::var_os("HOME").map(|h| PathBuf::from(h).join(".claude/projects"))
}

fn session_files(projects: &Path) -> Vec<(String, String, PathBuf, fs::Metadata)> {
    let mut out = vec![];
    let Ok(dirs) = fs::read_dir(projects) else {
        return out;
    };
    for dir in dirs.flatten() {
        let Ok(meta) = fs::symlink_metadata(dir.path()) else {
            continue;
        };
        if !meta.is_dir() {
            continue;
        }
        let project = dir.file_name().to_string_lossy().into_owned();
        let Ok(files) = fs::read_dir(dir.path()) else {
            continue;
        };
        for file in files.flatten() {
            let path = file.path();
            let Some(id) = path
                .file_name()
                .and_then(|n| n.to_str())
                .and_then(|n| n.strip_suffix(".jsonl"))
                .filter(|n| uuid::Uuid::parse_str(n).is_ok())
                .map(str::to_owned)
            else {
                continue;
            };
            let Ok(meta) = fs::symlink_metadata(&path) else {
                continue;
            };
            if meta.is_file() && meta.len() <= MAX_BYTES && out.len() < MAX_SESSIONS {
                out.push((id, project.clone(), path, meta));
            }
        }
    }
    out
}

fn stamp(meta: &fs::Metadata) -> Option<String> {
    meta.modified()
        .ok()
        .map(|t| chrono::DateTime::<chrono::Utc>::from(t).to_rfc3339())
}

/// File facts only: no session text is read for the listing.
pub fn sessions(projects: &Path) -> Vec<Value> {
    let mut out: Vec<Value> = session_files(projects)
        .into_iter()
        .map(|(id, project, _, meta)| {
            json!({"id":id,"project":project,"modifiedAt":stamp(&meta),"bytes":meta.len(),
                "sourceConversationId":format!("claude-code-{id}")})
        })
        .collect();
    out.sort_by(|a, b| b["modifiedAt"].as_str().cmp(&a["modifiedAt"].as_str()));
    out
}

fn visible_text(content: &Value) -> Option<String> {
    let text = match content {
        Value::String(s) => s.clone(),
        Value::Array(parts) => parts
            .iter()
            .filter(|p| p["type"] == "text")
            .filter_map(|p| p["text"].as_str())
            .collect::<Vec<_>>()
            .join(""),
        _ => return None,
    };
    (!text.trim().is_empty()).then_some(text)
}

/// One session as a generic conversation: only what the person typed and what
/// the assistant visibly answered. Tool calls, tool output, thinking, subagent
/// turns and injected command or reminder blocks are left out.
pub fn document(projects: &Path, id: &str) -> Result<Value, String> {
    if uuid::Uuid::parse_str(id).is_err() {
        return Err("Oturum kimliği geçersiz".into());
    }
    let (_, project, path, _) = session_files(projects)
        .into_iter()
        .find(|(sid, ..)| sid == id)
        .ok_or("Claude Code oturumu bulunamadı")?;
    let file = fs::File::open(&path).map_err(|_| "Claude Code oturumu okunamadı")?;
    let mut messages = vec![];
    let mut previous: Option<String> = None;
    for line in BufReader::new(file).lines().map_while(Result::ok) {
        let Ok(o) = serde_json::from_str::<Value>(&line) else {
            continue;
        };
        let role = match o["type"].as_str() {
            Some(r @ ("user" | "assistant")) => r,
            _ => continue,
        };
        if o["isMeta"] == true || o["isSidechain"] == true {
            continue;
        }
        let (Some(uuid), Some(text)) = (o["uuid"].as_str(), visible_text(&o["message"]["content"]))
        else {
            continue;
        };
        if role == "user" && text.trim_start().starts_with('<') {
            continue;
        }
        messages.push(json!({"id":uuid,"parentId":previous,"role":role,"text":text,"timestamp":o["timestamp"]}));
        previous = Some(uuid.to_owned());
    }
    if messages.is_empty() {
        return Err("Bu oturumda görünür mesaj yok".into());
    }
    let first = messages[0]["timestamp"].clone();
    let last = messages[messages.len() - 1]["timestamp"].clone();
    let day = first.as_str().and_then(|t| t.get(..10)).unwrap_or("");
    let short: String = project
        .trim_start_matches('-')
        .rsplit('-')
        .next()
        .unwrap_or("")
        .chars()
        .take(40)
        .collect();
    Ok(
        json!({"id":format!("claude-code-{id}"),"sourceApp":"Claude Code",
        "title":format!("Claude Code · {short} · {day}"),"createdAt":first,"updatedAt":last,"messages":messages}),
    )
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn listing_reads_no_text_and_document_keeps_only_visible_turns() {
        let root = std::env::temp_dir().join(format!("tore-cc-{}", uuid::Uuid::new_v4()));
        let dir = root.join("-Users-test-proje");
        fs::create_dir_all(&dir).unwrap();
        let id = uuid::Uuid::new_v4().to_string();
        let lines = [
            json!({"type":"user","uuid":"u1","timestamp":"2026-01-02T03:04:05Z","message":{"content":"Yapay istek"}}),
            json!({"type":"user","uuid":"u2","timestamp":"2026-01-02T03:04:06Z","message":{"content":"<system-reminder>gizli</system-reminder>"}}),
            json!({"type":"assistant","uuid":"a1","timestamp":"2026-01-02T03:04:07Z","message":{"content":[{"type":"thinking","thinking":"gizli düşünme"},{"type":"text","text":"Yapay yanıt"},{"type":"tool_use","name":"Bash","input":{}}]}}),
            json!({"type":"user","uuid":"u3","timestamp":"2026-01-02T03:04:08Z","message":{"content":[{"type":"tool_result","content":"araç çıktısı"}]}}),
            json!({"type":"assistant","uuid":"a2","isSidechain":true,"timestamp":"2026-01-02T03:04:09Z","message":{"content":"alt ajan"}}),
            json!({"type":"summary","summary":"özet"}),
        ];
        let body: String = lines.iter().map(|l| l.to_string() + "\n").collect();
        fs::write(dir.join(format!("{id}.jsonl")), body + "bozuk satır\n").unwrap();
        fs::write(dir.join("not-a-session.jsonl"), "{}").unwrap();
        let list = sessions(&root);
        assert_eq!(list.len(), 1);
        assert_eq!(list[0]["id"], id.as_str());
        assert!(!list[0].to_string().contains("Yapay"));
        let doc = document(&root, &id).unwrap();
        let messages = doc["messages"].as_array().unwrap();
        assert_eq!(messages.len(), 2);
        assert_eq!(messages[1]["parentId"], "u1");
        let text = doc.to_string();
        assert!(text.contains("Yapay istek") && text.contains("Yapay yanıt"));
        for hidden in ["gizli", "araç çıktısı", "alt ajan", "özet"] {
            assert!(!text.contains(hidden), "{hidden}");
        }
        assert_eq!(doc["title"], "Claude Code · proje · 2026-01-02");
        assert!(document(&root, "../../etc/passwd").is_err());
        assert!(document(&root, &uuid::Uuid::new_v4().to_string()).is_err());
        fs::remove_dir_all(root).ok();
    }
}
