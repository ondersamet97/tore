//! Explicit, stored and revocable consent to let a connected AI tool (MCP)
//! read one prepared continuation packet. Only the packet text the person saw
//! in the preview is ever exposed; records, conversations and every other part
//! of the notebook stay inside töre.
use super::*;
use std::path::Path;

#[derive(Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
struct ShareInput {
    packet_id: String,
    shared: bool,
    confirmed_by_user: bool,
}

/// What a connected tool may see of one shared packet. Built only from packets
/// whose `shared_with_tools` flag the person set.
#[derive(Clone, Debug, PartialEq)]
pub struct SharedContext {
    pub id: String,
    pub topic_title: String,
    pub created_at: String,
    pub target: String,
    pub model: Option<String>,
    pub record_count: usize,
    pub question: String,
    pub text: String,
}

const QUESTION_HEAD: &str = "Kullanıcının devam sorusu: ";
const QUESTION_TAIL: &str = "\n\nYanıtı düz metin olarak verebilirsin.";

/// The person's question is the last section of the packet text.
fn question(text: &str) -> String {
    let Some(end) = text.rfind(QUESTION_TAIL) else {
        return String::new();
    };
    let Some(start) = text[..end].rfind(QUESTION_HEAD) else {
        return String::new();
    };
    let q = text[start + QUESTION_HEAD.len()..end].trim();
    if q.chars().count() > 500 {
        format!("{}…", q.chars().take(500).collect::<String>())
    } else {
        q.to_owned()
    }
}

impl Disk {
    pub fn share(&mut self, input: Value) -> Result<Value, String> {
        self.check()?;
        let r: ShareInput = decode(input)?;
        if !r.confirmed_by_user {
            return Err(
                "Bağlı AI aracına açma veya kapatma açık kullanıcı onayı gerektirir".into(),
            );
        }
        let current = self
            .data
            .packets
            .get(&r.packet_id)
            .ok_or("Devam paketi bulunamadı")?;
        if current.shared_with_tools == r.shared {
            return Ok(json!({"packet":current,"shared":r.shared,"changed":false}));
        }
        let mut next = self.data.clone();
        if let Some(packet) = next.packets.get_mut(&r.packet_id) {
            packet.shared_with_tools = r.shared;
        }
        self.commit(next)?;
        Ok(json!({"packet":self.data.packets[&r.packet_id],"shared":r.shared,"changed":true}))
    }
}

/// Read the notebook under the normal `--data` directory without locking or
/// writing, and return only the packets the person opened to a connected tool.
pub fn shared_contexts(data_dir: &Path) -> Result<Vec<SharedContext>, String> {
    let store = persistence::read_snapshot(&data_dir.join("conversations"))?;
    let mut out: Vec<SharedContext> = store
        .packets
        .values()
        .filter(|p| p.shared_with_tools)
        .map(|p| SharedContext {
            id: p.id.clone(),
            topic_title: store
                .topics
                .get(&p.topic_id)
                .map(|t| t.title.clone())
                .unwrap_or_default(),
            created_at: p.created_at.clone(),
            target: p.target.clone(),
            model: p.model.clone(),
            record_count: p.sources.len(),
            question: question(&p.text),
            text: p.text.clone(),
        })
        .collect();
    out.sort_by(|a, b| b.created_at.cmp(&a.created_at).then(a.id.cmp(&b.id)));
    Ok(out)
}

#[cfg(test)]
#[path = "records_share_tests.rs"]
mod tests;
