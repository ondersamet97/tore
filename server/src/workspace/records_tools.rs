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
    /// What the tool says the proposal rests on. Absent in lines written
    /// before the field existed, and absent from their bytes.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub basis: Option<ProposalBasis>,
}

/// The text a proposal rests on and where the tool says it comes from. Both
/// are the tool's claim: töre stores them and shows them as such.
#[derive(Clone, Debug, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct ProposalBasis {
    pub quote: String,
    /// A record id from the topic, or a free description or URL.
    pub source: String,
}

/// One opened topic for a connected tool: the text, and the same records as
/// structured data. The structure is built from the very records and labels
/// the text is built from, in the same pass.
#[derive(Clone, Debug, PartialEq)]
pub struct ToolTopicContext {
    pub text: String,
    pub structured: Value,
}

/// Version of the structured output. See `docs/MCP-STRUCTURED-OUTPUT.md`.
pub const CONTEXT_SCHEMA: &str = "tore.context/1";

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
const BASIS_QUOTE_BYTES: usize = 2000;
const BASIS_SOURCE_BYTES: usize = 500;
/// Proposal kinds that claim something about what the person holds or should
/// hold; these must say what they rest on.
const BASIS_REQUIRED: [&str; 2] = ["decision", "objection"];
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
                && i.basis.as_ref().is_none_or(valid_basis)
                && seen.insert(i.id.clone())
        })
        .collect()
}

fn valid_basis(b: &ProposalBasis) -> bool {
    bounded(&b.quote, BASIS_QUOTE_BYTES, true) && bounded(&b.source, BASIS_SOURCE_BYTES, true)
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
/// open and what is to be done, each with where its wording came from (the
/// record's attribution). Unreviewed AI proposals, rejected or superseded
/// records, source quotes, dates and every other topic stay out.
pub fn tool_topic_context(
    data_dir: &Path,
    topic_id: &str,
) -> Result<Option<ToolTopicContext>, String> {
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
    // Each record is written to the text and to the structure together, so
    // the structure holds exactly the records and fields the text holds.
    let mut records = Vec::new();
    let mut section = |label: &str, status: &str, items: &[&Record]| {
        for r in items {
            text.push_str(&format!(
                "\n[{}]\nKayıt: {}\nÖncelik: {}\nAtıf: {}\nİfade: {}\n",
                label, r.id, r.priority, r.attribution, r.text
            ));
            let mut v = json!({
                "id": r.id,
                "kind": r.kind,
                "voice": "person",
                "status": status,
                "priority": r.priority,
                "origin": r.attribution,
                "text": r.text,
            });
            if !r.reason.is_empty() {
                text.push_str(&format!("Gerekçe: {}\n", r.reason));
                v["reason"] = json!(r.reason);
            }
            records.push(v);
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
    section("KULLANICININ BENİMSEDİĞİ KARAR", "adopted", &decisions);
    section("KULLANICININ BENİMSEDİĞİ GÖRÜŞ", "adopted", &opinions);
    section(
        "AÇIK İŞ — KARAR DEĞİL",
        "open",
        &open_of(&s, topic_id, "task"),
    );
    section(
        "AÇIK SORU — GÖRÜŞ DEĞİL",
        "open",
        &open_of(&s, topic_id, "question"),
    );
    text.push_str(if access.write {
        "\nBu konuya öneri bırakabilirsin (tore_propose). Önerin töre'de ayrı bir gelen kutusunda bekler; kişi kabul etmeden deftere girmez ve kabul edilse de incelenmemiş AI önerisi olarak kalır.\n"
    } else {
        "\nBu konu yalnız okumaya açık; öneri bırakamazsın.\n"
    });
    if hidden > 0 {
        text.push_str(&format!(
            "\nNOTE: {hidden} record(s) in this topic could not be read by this connector (töre {}) and are hidden. If töre was updated after this connector started, ask the person to reconnect this connector in their AI tool.\n",
            env!("CARGO_PKG_VERSION")
        ));
    }
    let structured = json!({
        "schema": CONTEXT_SCHEMA,
        "type": "topic",
        "topic": {"id": topic.id, "title": topic.title, "goal": topic.goal},
        "proposalsAllowed": access.write,
        "hiddenRecords": hidden,
        "records": records,
    });
    Ok(Some(ToolTopicContext { text, structured }))
}

/// The text alone, as tests written before the structured output read it.
#[cfg(test)]
fn tool_topic_text(data_dir: &Path, topic_id: &str) -> Result<Option<String>, String> {
    Ok(tool_topic_context(data_dir, topic_id)?.map(|c| c.text))
}

/// Append one proposal to the inbox file. The notebook itself is not opened
/// for writing and no lock is taken.
/// Why a proposal was not stored. The two cases must never be confused: a
/// refusal is an answer for the tool, in English, that it can act on; an
/// unreadable notebook is a fault whose reason stays out of the answer.
#[derive(Clone, Debug, PartialEq)]
pub enum ProposeError {
    /// The proposal itself is not acceptable. The message goes to the tool.
    Refused(String),
    /// The notebook could not be read. The reason goes to stderr only.
    Notebook(String),
}
fn refused(message: &str) -> ProposeError {
    ProposeError::Refused(message.into())
}
fn refuse<T>(message: &str) -> Result<T, ProposeError> {
    Err(refused(message))
}

/// True once töre has been started with this data folder: it creates the
/// notebook directory on its first start, before any topic exists.
pub fn notebook_exists(data_dir: &Path) -> bool {
    std::fs::symlink_metadata(data_dir.join("conversations")).is_ok_and(|m| m.is_dir())
}

pub fn tool_propose(
    data_dir: &Path,
    tool: &str,
    topic_id: &str,
    kind: &str,
    text: &str,
    relates_to: Option<&str>,
    basis: Option<&ProposalBasis>,
) -> Result<String, ProposeError> {
    let root = data_dir.join("conversations");
    let s = persistence::read_snapshot(&root)
        .map_err(ProposeError::Notebook)?
        .store;
    if !s
        .tool_access
        .get(topic_id)
        .is_some_and(|a| a.read && a.write)
    {
        return refuse("This topic is not open for proposals. The person can allow it on the Konularım page.");
    }
    if !PROPOSAL_KINDS.contains(&kind) {
        return refuse("kind must be one of: note, decision, question, task, objection");
    }
    if !bounded(text, PROPOSAL_BYTES, true) {
        return refuse("text is required and limited to 8000 bytes");
    }
    let related = relates_to.map(|id| {
        s.records
            .get(id)
            .filter(|r| r.topic_id == topic_id && r.trashed_at.is_none())
    });
    if matches!(related, Some(None)) {
        return refuse("relatesTo must be a record id from this topic");
    }
    if kind == "objection" && !related.flatten().is_some_and(|r| !stateful(&r.kind)) {
        return refuse("An objection needs relatesTo: the id of an opinion or decision in this topic");
    }
    match basis {
        None if BASIS_REQUIRED.contains(&kind) => {
            return refuse("A decision or an objection needs basis: {quote, source}, the exact text it rests on and where that text comes from. Nothing was left in the inbox.");
        }
        Some(b) if !bounded(&b.quote, BASIS_QUOTE_BYTES, true) => {
            return refuse("basis.quote is required and limited to 2000 bytes");
        }
        Some(b) if !bounded(&b.source, BASIS_SOURCE_BYTES, true) => {
            return refuse("basis.source is required and limited to 500 bytes");
        }
        _ => {}
    }
    let pending = read_inbox(&root)
        .iter()
        .filter(|i| !s.inbox_handled.contains_key(&i.id))
        .count();
    let size = std::fs::metadata(inbox_path(&root))
        .map(|m| m.len())
        .unwrap_or(0);
    if pending >= INBOX_PENDING || size > INBOX_BYTES {
        return refuse("The töre inbox is full. Wait until the person has reviewed it.");
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
        basis: basis.cloned(),
    };
    let mut line = serde_json::to_vec(&item).map_err(|_| refused("The proposal could not be encoded."))?;
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
        .map_err(|_| refused("The töre inbox could not be written. Nothing was stored."))?;
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
                // When the tool names a record of this topic as the source of
                // its quote, show that record and whether the quote really is
                // in it. Anything else stays the tool's unchecked claim.
                let basis_record = i
                    .basis
                    .as_ref()
                    .and_then(|b| Some((b, self.data.records.get(b.source.trim())?)))
                    .filter(|(_, r)| r.topic_id == i.topic_id && r.trashed_at.is_none())
                    .map(|(b, r)| {
                        let found = r.text.contains(b.quote.trim())
                            || r.reason.contains(b.quote.trim());
                        json!({"id":r.id,"kind":r.kind,"text":r.text,"quoteFound":found})
                    });
                json!({"item":i,"topicTitle":self.data.topics[&i.topic_id].title,"related":related,"basisRecord":basis_record})
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
        // The basis travels with the record in its reason, in words that keep
        // it the tool's claim. It is never the record's source quote.
        let basis = item.basis.as_ref().map(|b| {
            format!(
                "Aracın gösterdiği dayanak (doğrulanmadı): \"{}\"\nDayanağın kaynağı (aracın beyanı): {}",
                b.quote, b.source
            )
        });
        let room = 12000usize.saturating_sub(basis.as_ref().map_or(0, |b| b.len() + 1));
        let mut reason: String = reason.chars().take(2000).collect();
        while reason.len() > room {
            reason.pop();
        }
        if let Some(basis) = basis {
            if !reason.is_empty() {
                reason.push('\n');
            }
            reason.push_str(&basis);
        }
        let record = Record {
            id: id(),
            topic_id: item.topic_id.clone(),
            kind: kind.into(),
            text: item.text.clone(),
            reason,
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
