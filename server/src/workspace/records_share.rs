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
    /// The selected records as structured data. Every entry repeats what
    /// `text` already says about that record and nothing else.
    pub records: Vec<Value>,
}

/// The records of one packet as structured data, at the revision the packet
/// was prepared from. An entry is given only when the exact lines it is built
/// from are found in the packet text, so the structure cannot say more than
/// the text the person saw and shared; anything else is left out.
fn structured_records(store: &Store, p: &Packet) -> Vec<Value> {
    let selected = p
        .record_ids
        .iter()
        .map(|id| (id, false))
        .chain(p.proposal_ids.iter().map(|id| (id, true)));
    selected
        .zip(&p.sources)
        .filter_map(|((id, proposal), source)| {
            let r = store.records.get(id)?;
            let (text, reason, priority, attribution) = if source.revision == r.revision {
                (&r.text, &r.reason, &r.priority, &r.attribution)
            } else {
                let h = r.history.get(source.revision.checked_sub(1)? as usize)?;
                (&h.text, &h.reason, &h.priority, &h.attribution)
            };
            let block = packet_block(&PacketBlock {
                kind: &r.kind,
                proposal,
                id: &r.id,
                revision: source.revision,
                priority,
                attribution,
                text,
                reason,
                source_id: &source.source_id,
                role: &source.role,
                quote: &source.quote,
            });
            if !p.text.contains(&block) {
                return None;
            }
            let mut v = json!({
                "id": r.id,
                "revision": source.revision,
                "voice": if proposal { "ai_suggestion" } else { "person" },
                "status": if proposal {
                    "unadopted"
                } else if stateful(&r.kind) {
                    "open"
                } else {
                    "adopted"
                },
                "priority": priority,
                "origin": attribution,
                "text": text,
                "source": {
                    "voice": "source",
                    "id": source.source_id,
                    "speaker": source.role,
                    "quote": source.quote,
                },
            });
            // The label of an unadopted AI suggestion does not say whether it
            // was filed as an opinion or a decision, so neither does this.
            if !proposal {
                v["kind"] = json!(r.kind);
            }
            if !reason.is_empty() {
                v["reason"] = json!(reason);
            }
            Some(v)
        })
        .collect()
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
    let store = persistence::read_snapshot(&data_dir.join("conversations"))?.store;
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
            records: structured_records(&store, p),
        })
        .collect();
    out.sort_by(|a, b| b.created_at.cmp(&a.created_at).then(a.id.cmp(&b.id)));
    Ok(out)
}

#[cfg(test)]
#[path = "records_share_tests.rs"]
mod tests;
