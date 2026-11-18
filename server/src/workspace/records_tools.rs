//! Two-way work with a connected AI tool (MCP), by explicit and revocable
//! consent per topic. Reading shows only a topic the person opened. Writing
//! never touches the notebook: the tool appends a proposal to a separate inbox
//! file, and it becomes a record only when the person accepts it, as an
//! unreviewed AI proposal that still needs their review.
use super::*;
use std::{
    fs::OpenOptions,
    io::{BufRead, BufReader, Write},
    path::Path,
};

#[derive(Clone, Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct ToolAccess {
    pub read: bool,
    pub write: bool,
    pub updated_at: String,
}

#[derive(Clone, Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct InboxHandled {
    pub decision: String,
    pub at: String,
    pub record_id: Option<String>,
}

#[derive(Clone, Debug, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct InboxItem {
    pub id: String,
    pub received_at: String,
    pub tool: String,
    pub topic_id: String,
    pub kind: String,
    pub text: String,
    pub relates_to: Option<String>,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
struct AccessInput {
    topic_id: String,
    read: bool,
    write: bool,
    confirmed_by_user: bool,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
struct AllAccessInput {
    read: bool,
    write: bool,
    confirmed_by_user: bool,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
struct InboxInput {
    item_id: String,
    confirmed_by_user: bool,
}

/// What a connected tool sees of one opened topic in a listing.
#[derive(Clone, Debug, PartialEq)]
pub struct ToolTopic {
    pub id: String,
    pub title: String,
    pub goal: String,
    pub can_write: bool,
    pub open_tasks: usize,
    pub open_questions: usize,
}

const INBOX_FILE: &str = "tool-inbox.jsonl";
const INBOX_BYTES: u64 = 2 * 1024 * 1024;
const INBOX_PENDING: usize = 200;
const PROPOSAL_BYTES: usize = 8000;
pub const PROPOSAL_KINDS: [&str; 5] = ["note", "decision", "question", "task", "objection"];

pub(super) fn validate_tools(s: &Store) -> Result<(), String> {
    if s.inbox_handled.len() > 5000 {
        return Err("Gelen kutusu kaydı sınırı aşıldı".into());
    }
    for (topic, access) in &s.tool_access {
        if !s.topics.contains_key(topic) || (access.write && !access.read) {
            return Err("Bağlı araç izni geçersiz".into());
        }
    }
    for h in s.inbox_handled.values() {
        if !["accepted", "dismissed"].contains(&h.decision.as_str())
            || h.record_id
                .as_ref()
                .is_some_and(|id| !s.records.contains_key(id))
        {
            return Err("Gelen kutusu kaydı geçersiz".into());
        }
    }
    Ok(())
}

fn inbox_path(root: &Path) -> std::path::PathBuf {
    root.join(INBOX_FILE)
}

/// Lenient on purpose: a damaged or foreign line is skipped, never trusted.
fn read_inbox(root: &Path) -> Vec<InboxItem> {
    let Ok(meta) = std::fs::symlink_metadata(inbox_path(root)) else {
        return vec![];
    };
    if !meta.is_file() || meta.len() > INBOX_BYTES * 2 {
        return vec![];
    }
    let Ok(file) = std::fs::File::open(inbox_path(root)) else {
        return vec![];
    };
    let mut seen = BTreeSet::new();
    BufReader::new(file)
        .lines()
        .map_while(Result::ok)
        .filter_map(|line| serde_json::from_str::<InboxItem>(&line).ok())
        .filter(|i| {
            uuid::Uuid::parse_str(&i.id).is_ok()
                && PROPOSAL_KINDS.contains(&i.kind.as_str())
                && bounded(&i.text, PROPOSAL_BYTES, true)
                && bounded(&i.tool, 100, true)
                && seen.insert(i.id.clone())
        })
        .collect()
}

fn open_of<'a>(s: &'a Store, topic: &str, kind: &str) -> Vec<&'a Record> {
    let mut out: Vec<&Record> = s
        .records
        .values()
        .filter(|r| {
            r.topic_id == topic
                && r.trashed_at.is_none()
                && r.kind == kind
                && r.question_state == "open"
                && r.review != "rejected"
                && r.currency != "superseded"
                && (r.attribution != "assistant_proposal" || r.review == "reviewed")
        })
        .collect();
    out.sort_by(|a, b| a.created_at.cmp(&b.created_at).then(a.id.cmp(&b.id)));
    out
}

/// Topics the person opened for reading. No lock, no write.
pub fn tool_topics(data_dir: &Path) -> Result<Vec<ToolTopic>, String> {
    let s = persistence::read_snapshot(&data_dir.join("conversations"))?.store;
    let mut out: Vec<ToolTopic> = s
        .tool_access
        .iter()
        .filter(|(_, a)| a.read)
        .filter_map(|(id, a)| {
            let t = s.topics.get(id)?;
            Some(ToolTopic {
                id: id.clone(),
                title: t.title.clone(),
                goal: t.goal.clone(),
                can_write: a.write,
                open_tasks: open_of(&s, id, "task").len(),
                open_questions: open_of(&s, id, "question").len(),
            })
        })
        .collect();
    out.sort_by(|a, b| a.title.cmp(&b.title).then(a.id.cmp(&b.id)));
    Ok(out)
}

/// The working context of one opened topic: what the person adopted, what is
/// open and what is to be done. Unreviewed AI proposals, rejected or superseded
/// records, sources and every other topic stay out.
pub fn tool_topic_text(data_dir: &Path, topic_id: &str) -> Result<Option<String>, String> {
    let snapshot = persistence::read_snapshot(&data_dir.join("conversations"))?;
    let hidden = snapshot
        .skipped
        .iter()
        .filter(|(_, t)| t == topic_id)
        .count();
    let s = snapshot.store;
    let Some(access) = s.tool_access.get(topic_id).filter(|a| a.read) else {
        return Ok(None);
    };
    let Some(topic) = s.topics.get(topic_id) else {
        return Ok(None);
    };
    let mut text = format!("KONU: {}\nAMAÇ: {}\n", topic.title, topic.goal);
    let mut adopted: Vec<&Record> = s
        .records
        .values()
        .filter(|r| {
            r.topic_id == topic_id
                && r.trashed_at.is_none()
                && !stateful(&r.kind)
                && r.review == "reviewed"
                && r.adoption == "adopted"
                && r.currency == "current"
        })
        .collect();
    adopted.sort_by(|a, b| a.created_at.cmp(&b.created_at).then(a.id.cmp(&b.id)));
    let mut section = |label: &str, items: &[&Record]| {
        for r in items {
            text.push_str(&format!(
                "\n[{}]\nKayıt: {}\nÖncelik: {}\nİfade: {}\n",
                label, r.id, r.priority, r.text
            ));
            if !r.reason.is_empty() {
                text.push_str(&format!("Gerekçe: {}\n", r.reason));
            }
        }
    };
    let decisions: Vec<&Record> = adopted
        .iter()
        .copied()
        .filter(|r| r.kind == "decision")
        .collect();
    let opinions: Vec<&Record> = adopted
        .iter()
        .copied()
        .filter(|r| r.kind == "opinion")
        .collect();
    section("KULLANICININ BENİMSEDİĞİ KARAR", &decisions);
    section("KULLANICININ BENİMSEDİĞİ GÖRÜŞ", &opinions);
    section("AÇIK İŞ — KARAR DEĞİL", &open_of(&s, topic_id, "task"));
    section(
        "AÇIK SORU — GÖRÜŞ DEĞİL",
        &open_of(&s, topic_id, "question"),
    );
    text.push_str(if access.write {
        "\nBu konuya öneri bırakabilirsin (tore_propose). Önerin töre'de ayrı bir gelen kutusunda bekler; kişi kabul etmeden deftere girmez ve kabul edilse de incelenmemiş AI önerisi olarak kalır.\n"
    } else {
        "\nBu konu yalnız okumaya açık; öneri bırakamazsın.\n"
    });
    if hidden > 0 {
        text.push_str(&format!(
            "\nNOTE: {hidden} record(s) in this topic could not be read by this connector (töre {}) and are hidden. If töre was updated after this connector started, ask the person to reconnect it: in Claude Code run /mcp, choose tore, then Reconnect.\n",
            env!("CARGO_PKG_VERSION")
        ));
    }
    Ok(Some(text))
}

/// Append one proposal to the inbox file. The notebook itself is not opened
/// for writing and no lock is taken.
pub fn tool_propose(
    data_dir: &Path,
    tool: &str,
    topic_id: &str,
    kind: &str,
    text: &str,
    relates_to: Option<&str>,
) -> Result<String, String> {
    let root = data_dir.join("conversations");
    let s = persistence::read_snapshot(&root)?.store;
    if !s
        .tool_access
        .get(topic_id)
        .is_some_and(|a| a.read && a.write)
    {
        return Err(
            "This topic is not open for proposals. The person can allow it on the Konularım page."
                .into(),
        );
    }
    if !PROPOSAL_KINDS.contains(&kind) {
        return Err("kind must be one of: note, decision, question, task, objection".into());
    }
    if !bounded(text, PROPOSAL_BYTES, true) {
        return Err("text is required and limited to 8000 bytes".into());
    }
    let related = relates_to.map(|id| {
        s.records
            .get(id)
            .filter(|r| r.topic_id == topic_id && r.trashed_at.is_none())
    });
    if matches!(related, Some(None)) {
        return Err("relatesTo must be a record id from this topic".into());
    }
    if kind == "objection" && !related.flatten().is_some_and(|r| !stateful(&r.kind)) {
        return Err(
            "An objection needs relatesTo: the id of an opinion or decision in this topic".into(),
        );
    }
    let pending = read_inbox(&root)
        .iter()
        .filter(|i| !s.inbox_handled.contains_key(&i.id))
        .count();
    let size = std::fs::metadata(inbox_path(&root))
        .map(|m| m.len())
        .unwrap_or(0);
    if pending >= INBOX_PENDING || size > INBOX_BYTES {
        return Err("The töre inbox is full. Wait until the person has reviewed it.".into());
    }
    let tool: String = tool.chars().filter(|c| !c.is_control()).take(60).collect();
    let item = InboxItem {
        id: id(),
        received_at: now(),
        tool: if tool.trim().is_empty() {
            "Bağlı AI aracı".into()
        } else {
            tool
        },
        topic_id: topic_id.into(),
        kind: kind.into(),
        text: text.into(),
        relates_to: relates_to.map(str::to_owned),
    };
    let mut line = serde_json::to_vec(&item).map_err(|_| "Proposal could not be encoded")?;
    line.push(b'\n');
    let mut options = OpenOptions::new();
    options.append(true).create(true);
    #[cfg(unix)]
    {
        use std::os::unix::fs::OpenOptionsExt;
        options.mode(0o600).custom_flags(libc::O_NOFOLLOW);
    }
    options
        .open(inbox_path(&root))
        .and_then(|mut f| f.write_all(&line).and_then(|_| f.sync_all()))
        .map_err(|_| "The töre inbox could not be written")?;
    Ok(item.id)
}

impl Disk {
    pub(super) fn tool_access_view(&self) -> Value {
        json!(self.data.tool_access)
    }

    pub fn tool_access_set(&mut self, input: Value) -> Result<Value, String> {
        self.check()?;
        let r: AccessInput = decode(input)?;
        if !r.confirmed_by_user {
            return Err("Bağlı AI aracı izni yalnız açık onayla değişir".into());
        }
        if !self.data.topics.contains_key(&r.topic_id) {
            return Err("Konu bulunamadı".into());
        }
        if r.write && !r.read {
            return Err("Öneri bırakma izni için önce okuma izni gerekir".into());
        }
        let mut next = self.data.clone();
        if r.read {
            next.tool_access.insert(
                r.topic_id.clone(),
                ToolAccess {
                    read: true,
                    write: r.write,
                    updated_at: now(),
                },
            );
        } else {
            next.tool_access.remove(&r.topic_id);
        }
        self.commit(next)?;
        Ok(json!({"topicId":r.topic_id,"read":r.read,"write":r.write}))
    }

    /// Opens or closes every topic that exists now, in one commit. Topics
    /// created later start closed: consent covers what the person saw.
    pub fn tool_access_set_all(&mut self, input: Value) -> Result<Value, String> {
        self.check()?;
        let r: AllAccessInput = decode(input)?;
        if !r.confirmed_by_user {
            return Err("Bağlı AI aracı izni yalnız açık onayla değişir".into());
        }
        if r.write && !r.read {
            return Err("Öneri bırakma izni için önce okuma izni gerekir".into());
        }
        let mut next = self.data.clone();
        if r.read {
            let time = now();
            for id in self.data.topics.keys() {
                next.tool_access.insert(
                    id.clone(),
                    ToolAccess {
                        read: true,
                        write: r.write,
                        updated_at: time.clone(),
                    },
                );
            }
        } else {
            next.tool_access.clear();
        }
        let topics = self.data.topics.len();
        self.commit(next)?;
        Ok(
            json!({"topics":topics,"read":r.read,"write":r.write,"toolAccess":self.tool_access_view()}),
        )
    }

    fn pending_inbox(&self) -> Vec<InboxItem> {
        read_inbox(self.root())
            .into_iter()
            .filter(|i| {
                !self.data.inbox_handled.contains_key(&i.id)
                    && self.data.topics.contains_key(&i.topic_id)
            })
            .collect()
    }

    pub fn inbox_view(&self) -> Result<Value, String> {
        self.check()?;
        let items: Vec<Value> = self
            .pending_inbox()
            .into_iter()
            .map(|i| {
                let related = i
                    .relates_to
                    .as_ref()
                    .and_then(|id| self.data.records.get(id))
                    .filter(|r| r.trashed_at.is_none())
                    .map(|r| json!({"id":r.id,"kind":r.kind,"text":r.text}));
                json!({"item":i,"topicTitle":self.data.topics[&i.topic_id].title,"related":related})
            })
            .collect();
        Ok(json!({"items":items,"toolAccess":self.tool_access_view()}))
    }

    /// Accepting turns the proposal into a pending record attributed to the
    /// tool. It is not adopted and not reviewed; that stays the person's act.
    pub fn inbox_accept(&mut self, input: Value) -> Result<Value, String> {
        self.check()?;
        let r: InboxInput = decode(input)?;
        if !r.confirmed_by_user {
            return Err("Öneri yalnız açık onayla deftere alınır".into());
        }
        let item = self
            .pending_inbox()
            .into_iter()
            .find(|i| i.id == r.item_id)
            .ok_or("Öneri bulunamadı veya daha önce işlendi")?;
        let related = item
            .relates_to
            .as_ref()
            .and_then(|id| self.data.records.get(id))
            .filter(|x| x.topic_id == item.topic_id && x.trashed_at.is_none())
            .cloned();
        let kind = match item.kind.as_str() {
            "note" | "objection" => "opinion",
            other => other,
        };
        let question = stateful(kind);
        let time = now();
        let reason = match (&related, item.kind.as_str()) {
            (Some(x), "objection") => format!("Şu kayda itiraz: {}", x.text),
            (Some(x), _) => format!("İlgili kayıt: {}", x.text),
            _ => String::new(),
        };
        let record = Record {
            id: id(),
            topic_id: item.topic_id.clone(),
            kind: kind.into(),
            text: item.text.clone(),
            reason: reason.chars().take(2000).collect(),
            source: Some(Source {
                id: format!("tool:{}", item.id),
                kind: "tool".into(),
                conversation_id: None,
                message_id: None,
                reply_id: None,
                excerpt: item.text.clone(),
                title: item.tool.clone(),
                provider: "mcp".into(),
                role: "assistant".into(),
                timestamp: Some(item.received_at.clone()),
            }),
            attribution: "assistant_proposal".into(),
            review: "pending".into(),
            adoption: if question {
                "not_applicable"
            } else {
                "unknown"
            }
            .into(),
            currency: "unknown".into(),
            priority: "unspecified".into(),
            question_state: if question { "open" } else { "not_applicable" }.into(),
            answers_question_id: None,
            revision: 1,
            created_at: time.clone(),
            updated_at: time.clone(),
            history: vec![],
            legacy: None,
            creation_request_hash: hash(&item)?,
            trashed_at: None,
            superseded_by: None,
            superseded_at: None,
            supersession_reason: None,
        };
        validate_record(&record)?;
        let mut next = self.data.clone();
        next.records.insert(record.id.clone(), record.clone());
        let mut entry_id = None;
        if item.kind == "objection" {
            let parent = related.as_ref().and_then(|x| {
                next.map_entries
                    .values()
                    .find(|e| e.record_id == x.id)
                    .cloned()
            });
            if let Some(parent) = parent.filter(|p| {
                ["premise", "position", "divergence", "change"].contains(&p.role.as_str())
            }) {
                let entry = map::MapEntry::suggested_objection(&record.id, &parent, &time);
                entry_id = Some(entry.id.clone());
                next.map_entries.insert(entry.id.clone(), entry);
            }
        }
        next.inbox_handled.insert(
            item.id.clone(),
            InboxHandled {
                decision: "accepted".into(),
                at: time,
                record_id: Some(record.id.clone()),
            },
        );
        self.commit(next)?;
        Ok(json!({"record":record,"mapEntryId":entry_id}))
    }

    pub fn inbox_dismiss(&mut self, input: Value) -> Result<Value, String> {
        self.check()?;
        let r: InboxInput = decode(input)?;
        if !r.confirmed_by_user {
            return Err("Öneri yalnız açık onayla kaldırılır".into());
        }
        if !self.pending_inbox().iter().any(|i| i.id == r.item_id) {
            return Err("Öneri bulunamadı veya daha önce işlendi".into());
        }
        let mut next = self.data.clone();
        next.inbox_handled.insert(
            r.item_id.clone(),
            InboxHandled {
                decision: "dismissed".into(),
                at: now(),
                record_id: None,
            },
        );
        self.commit(next)?;
        Ok(json!({"dismissed":r.item_id}))
    }
}

#[cfg(test)]
#[path = "records_tools_tests.rs"]
mod tests;
