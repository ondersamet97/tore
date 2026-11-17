//! Model Context Protocol adapter over stdio.
//!
//! One JSON-RPC 2.0 message per line on stdin and stdout. stdout carries only
//! protocol messages; short diagnostics without personal content go to stderr.
//! The adapter exposes nothing but packets the person explicitly opened to a
//! connected AI tool and topics they opened, reads the notebook fresh for every
//! tool call and never takes the notebook lock. It never writes to the notebook:
//! with separate consent per topic a tool may append a proposal to an inbox
//! file, which becomes a record only when the person accepts it in töre.
use crate::workspace::{
    SharedContext, ToolTopic, shared_contexts, tool_propose, tool_topic_text, tool_topics,
};
use serde_json::{Map, Value, json};
use std::{
    io::{BufRead, Write},
    path::PathBuf,
};

pub const SUPPORTED_VERSIONS: [&str; 3] = ["2025-06-18", "2025-03-26", "2024-11-05"];
const LIST_TOOL: &str = "tore_list_shared_contexts";
const GET_TOOL: &str = "tore_get_shared_context";
const PREAMBLE: &str = "This context comes from töre, a local notebook, and the person explicitly shared exactly this text with you. Respect its labels: an adopted decision or opinion (KULLANICININ BENİMSEDİĞİ KARAR / GÖRÜŞ), an open question (AÇIK SORU — GÖRÜŞ DEĞİL) and an unadopted AI suggestion (BENİMSENMEMİŞ AI ÖNERİSİ) are different things; never treat one as another, and keep quotes attributed to their original speaker.";
const TOPICS_TOOL: &str = "tore_list_topics";
const TOPIC_TOOL: &str = "tore_get_topic";
const PROPOSE_TOOL: &str = "tore_propose";
const NOT_OPEN: &str = "No töre topic with this id is open to you. It may not exist, or the person has closed it. Call tore_list_topics to see what is open now.";

/// Topic-level access. Every call reads the notebook afresh, so opening or
/// closing a topic in töre takes effect on the next call.
pub trait Topics {
    fn list(&self) -> Result<Vec<ToolTopic>, String>;
    fn text(&self, id: &str) -> Result<Option<String>, String>;
    fn propose(
        &self,
        topic: &str,
        kind: &str,
        text: &str,
        relates_to: Option<&str>,
    ) -> Result<String, String>;
    /// True when the töre program on disk changed after this connector
    /// started, i.e. an older connector may be reading a newer notebook.
    fn stale(&self) -> bool {
        false
    }
}

struct DiskTopics {
    data: PathBuf,
    client: std::cell::RefCell<String>,
    program: Option<(std::time::SystemTime, u64)>,
}

/// Modification time and size of the running program file, if readable.
fn program_stamp() -> Option<(std::time::SystemTime, u64)> {
    let meta = std::fs::metadata(std::env::current_exe().ok()?).ok()?;
    Some((meta.modified().ok()?, meta.len()))
}
impl Topics for DiskTopics {
    fn list(&self) -> Result<Vec<ToolTopic>, String> {
        tool_topics(&self.data)
    }
    fn text(&self, id: &str) -> Result<Option<String>, String> {
        tool_topic_text(&self.data, id)
    }
    fn propose(
        &self,
        topic: &str,
        kind: &str,
        text: &str,
        relates_to: Option<&str>,
    ) -> Result<String, String> {
        tool_propose(&self.data, &self.client.borrow(), topic, kind, text, relates_to)
    }
    fn stale(&self) -> bool {
        self.program.is_some() && program_stamp() != self.program
    }
}

const NOT_SHARED: &str = "No shared töre context has this id. It may never have been shared, or the person has closed it. Call tore_list_shared_contexts to see what is shared now.";

pub fn run(args: &[String]) -> Result<(), String> {
    if args == ["--help"] {
        println!("{}", help());
        return Ok(());
    }
    let data = match args {
        [flag, dir] if flag == "--data" => PathBuf::from(dir),
        _ => return Err("MCP kipi yalnız --data MUTLAK_KLASÖR kabul eder".into()),
    };
    crate::safe_directory(&data)?;
    if !std::fs::symlink_metadata(&data).is_ok_and(|m| m.is_dir()) {
        return Err("--data klasörü bulunamadı; Töre'yi bu klasörle en az bir kez açın".into());
    }
    eprintln!("tore mcp: ready (only what the person opened is visible; proposals wait in the töre inbox)");
    let topics = DiskTopics {
        data: data.clone(),
        client: std::cell::RefCell::new(String::new()),
        program: program_stamp(),
    };
    let stdin = std::io::stdin();
    let mut input = stdin.lock();
    let stdout = std::io::stdout();
    let mut line = Vec::new();
    loop {
        line.clear();
        match input.read_until(b'\n', &mut line) {
            Ok(0) => return Ok(()),
            Ok(_) => {}
            Err(_) => return Err("MCP girdisi okunamadı".into()),
        }
        let text = String::from_utf8_lossy(&line);
        if text.trim().is_empty() {
            continue;
        }
        // The tool names itself once; the name labels its proposals in töre.
        if let Ok(v) = serde_json::from_str::<Value>(&text) {
            if v["method"] == "initialize" {
                if let Some(name) = v["params"]["clientInfo"]["name"].as_str() {
                    *topics.client.borrow_mut() = name.to_owned();
                }
            }
        }
        let load = || shared_contexts(&data);
        if let Some(reply) = handle(&text, &load, Some(&topics)) {
            let mut out = stdout.lock();
            if writeln!(out, "{reply}").and_then(|_| out.flush()).is_err() {
                return Ok(());
            }
        }
    }
}

pub fn help() -> &'static str {
    "tore-server mcp --data MUTLAK_KLASÖR\nBağlı AI aracı için MCP sunucusu (stdio). Yalnız Konularım'da açıkça açtığın devam metinlerini ve konuları okutur. Deftere yazmaz; izin verdiğin konularda aracın önerileri ayrı bir gelen kutusunda senin kabulünü bekler."
}

fn reply(id: &Value, result: Value) -> String {
    json!({"jsonrpc":"2.0","id":id,"result":result}).to_string()
}
fn error(id: &Value, code: i64, message: &str) -> String {
    json!({"jsonrpc":"2.0","id":id,"error":{"code":code,"message":message}}).to_string()
}
fn tool_text(text: String, is_error: bool) -> Value {
    let mut v = json!({"content":[{"type":"text","text":text}]});
    if is_error {
        v["isError"] = json!(true);
    }
    v
}

/// The notebook could not be read. The real reason goes to stderr (kind and
/// field name only, never notebook content); the tool gets a fixed message
/// that tells the person how to recover.
fn unreadable(reason: &str, stale: bool) -> Value {
    let version = env!("CARGO_PKG_VERSION");
    eprintln!("tore mcp {version}: notebook read failed: {reason}");
    let cause = if stale {
        " töre was updated after this connector started, so this connector is out of date."
    } else {
        " If töre was updated after this connector started, this connector may be out of date."
    };
    tool_text(
        format!("The töre notebook could not be read by this connector (töre {version}).{cause} Ask the person to reconnect it: in Claude Code run /mcp, choose tore, then Reconnect. If it still fails, restart töre once and reconnect again."),
        true,
    )
}

fn topic_tools() -> Value {
    let read = |title: &str| json!({"title":title,"readOnlyHint":true,"destructiveHint":false,"idempotentHint":true,"openWorldHint":false});
    json!([
        {
            "name": TOPICS_TOOL,
            "title": "List topics opened from töre",
            "description": "Lists the töre topics the person opened to this tool: id, title, goal, number of open tasks and open questions, and whether proposals are allowed. Nothing else from töre is visible.",
            "inputSchema": {"type":"object","properties":{},"additionalProperties":false},
            "annotations": read("List topics opened from töre")
        },
        {
            "name": TOPIC_TOOL,
            "title": "Read one opened töre topic",
            "description": "Returns the working context of one opened topic: the person's adopted decisions and opinions, open tasks and open questions, each with its record id. Respect the labels; an open task or question is not a decision.",
            "inputSchema": {"type":"object","properties":{"topicId":{"type":"string","description":"Topic id from tore_list_topics"}},"required":["topicId"],"additionalProperties":false},
            "annotations": read("Read one opened töre topic")
        },
        {
            "name": PROPOSE_TOOL,
            "title": "Leave a proposal in the töre inbox",
            "description": "Leaves one proposal for the person in töre's inbox for a topic that allows proposals. Use it to report the result of a task, or to suggest a decision, a question, a new task, a note or an objection to one of the person's positions. It does not change the notebook: the person decides whether to accept it, and an accepted proposal stays an unreviewed AI proposal. Write in the person's language, one self-contained proposal per call. Never claim that a task is closed; only the person closes a task.",
            "inputSchema": {"type":"object","properties":{
                "topicId":{"type":"string","description":"Topic id from tore_list_topics"},
                "kind":{"type":"string","enum":["note","decision","question","task","objection"]},
                "text":{"type":"string","description":"The proposal, at most 8000 bytes"},
                "relatesTo":{"type":"string","description":"Optional record id from tore_get_topic, e.g. the task this result belongs to. Required for an objection."}
            },"required":["topicId","kind","text"],"additionalProperties":false},
            "annotations": {"title":"Leave a proposal in the töre inbox","readOnlyHint":false,"destructiveHint":false,"idempotentHint":false,"openWorldHint":false}
        }
    ])
}

fn tools() -> Value {
    let annotations = |title: &str| json!({"title":title,"readOnlyHint":true,"destructiveHint":false,"idempotentHint":true,"openWorldHint":false});
    json!([
        {
            "name": LIST_TOOL,
            "title": "List contexts shared from töre",
            "description": "Lists the continuation contexts the person explicitly opened to this tool in töre (id, topic, creation time, declared destination, number of records and the person's question). Nothing else from töre is visible.",
            "inputSchema": {"type":"object","properties":{},"additionalProperties":false},
            "annotations": annotations("List contexts shared from töre")
        },
        {
            "name": GET_TOOL,
            "title": "Read one shared töre context",
            "description": "Returns the full text of one context the person shared, exactly as they saw it in töre. Respect its labels: adopted decision, open question and unadopted AI suggestion are different.",
            "inputSchema": {
                "type":"object",
                "properties":{"id":{"type":"string","description":"Context id from tore_list_shared_contexts"}},
                "required":["id"],
                "additionalProperties":false
            },
            "annotations": annotations("Read one shared töre context")
        }
    ])
}

fn summary(c: &SharedContext) -> Value {
    json!({
        "id": c.id,
        "topic": c.topic_title,
        "createdAt": c.created_at,
        "declaredDestination": c.target,
        "model": c.model,
        "recordCount": c.record_count,
        "question": c.question,
    })
}

fn call_tool(
    params: &Map<String, Value>,
    load: &dyn Fn() -> Result<Vec<SharedContext>, String>,
    topics: Option<&dyn Topics>,
) -> Result<Value, (i64, &'static str)> {
    let name = params
        .get("name")
        .and_then(Value::as_str)
        .ok_or((-32602, "tools/call needs a tool name"))?;
    let args = match params.get("arguments") {
        None | Some(Value::Null) => Map::new(),
        Some(Value::Object(m)) => m.clone(),
        Some(_) => return Err((-32602, "Tool arguments must be an object")),
    };
    let stale = || topics.is_some_and(|t| t.stale());
    match name {
        LIST_TOOL => {
            let contexts = match load() {
                Ok(c) => c,
                Err(e) => return Ok(unreadable(&e, stale())),
            };
            let message = if contexts.is_empty() {
                "Nothing is shared from töre right now. The person can open a prepared context to the connected AI tool on the Konularım page."
            } else {
                "These contexts were explicitly shared by the person. Read one with tore_get_shared_context."
            };
            let body = json!({"message":message,"contexts":contexts.iter().map(summary).collect::<Vec<_>>()});
            let mut result = tool_text(body.to_string(), false);
            result["structuredContent"] = body;
            Ok(result)
        }
        GET_TOOL => {
            let id = args
                .get("id")
                .and_then(Value::as_str)
                .ok_or((-32602, "Argument id (string) is required"))?;
            let contexts = match load() {
                Ok(c) => c,
                Err(e) => return Ok(unreadable(&e, stale())),
            };
            Ok(match contexts.into_iter().find(|c| c.id == id) {
                Some(c) => tool_text(format!("{PREAMBLE}\n{}", c.text), false),
                None => tool_text(NOT_SHARED.into(), true),
            })
        }
        TOPICS_TOOL | TOPIC_TOOL | PROPOSE_TOOL if topics.is_some() => {
            let topics = topics.ok_or((-32602, "Unknown tool"))?;
            let text_arg = |key: &'static str| args.get(key).and_then(Value::as_str);
            Ok(match name {
                TOPICS_TOOL => match topics.list() {
                    Err(e) => unreadable(&e, stale()),
                    Ok(list) => {
                        let message = if list.is_empty() {
                            "No töre topic is open to you right now. The person can open one on the Konularım page."
                        } else {
                            "These topics were explicitly opened by the person. Read one with tore_get_topic."
                        };
                        let body = json!({"message":message,"topics":list.iter().map(|t| json!({
                            "id":t.id,"title":t.title,"goal":t.goal,"proposalsAllowed":t.can_write,
                            "openTasks":t.open_tasks,"openQuestions":t.open_questions})).collect::<Vec<_>>()});
                        let mut result = tool_text(body.to_string(), false);
                        result["structuredContent"] = body;
                        result
                    }
                },
                TOPIC_TOOL => {
                    let id = text_arg("topicId").ok_or((-32602, "Argument topicId (string) is required"))?;
                    match topics.text(id) {
                        Err(e) => unreadable(&e, stale()),
                        Ok(Some(text)) => tool_text(format!("{PREAMBLE}\n{text}"), false),
                        Ok(None) => tool_text(NOT_OPEN.into(), true),
                    }
                }
                _ => {
                    let topic = text_arg("topicId").ok_or((-32602, "Argument topicId (string) is required"))?;
                    let kind = text_arg("kind").ok_or((-32602, "Argument kind (string) is required"))?;
                    let text = text_arg("text").ok_or((-32602, "Argument text (string) is required"))?;
                    match topics.propose(topic, kind, text, text_arg("relatesTo")) {
                        Ok(id) => tool_text(format!("Left in the töre inbox as {id}. It is not part of the notebook until the person accepts it."), false),
                        Err(e) if e.is_ascii() => tool_text(e, true),
                        Err(e) => unreadable(&e, stale()),
                    }
                }
            })
        }
        _ => Err((-32602, "Unknown tool")),
    }
}

/// Context-only handler: the two read-only tools, nothing about topics.
#[cfg_attr(not(test), allow(dead_code))]
pub fn handle_line(
    line: &str,
    load: &dyn Fn() -> Result<Vec<SharedContext>, String>,
) -> Option<String> {
    handle(line, load, None)
}

/// Pure request handler: one input line in, at most one output line out.
/// `load` and `topics` are called afresh for every tool call.
pub fn handle(
    line: &str,
    load: &dyn Fn() -> Result<Vec<SharedContext>, String>,
    topics: Option<&dyn Topics>,
) -> Option<String> {
    let message: Value = match serde_json::from_str(line) {
        Ok(v) => v,
        Err(_) => return Some(error(&Value::Null, -32700, "Parse error")),
    };
    let Some(object) = message.as_object() else {
        return Some(error(&Value::Null, -32600, "Invalid Request"));
    };
    let id = object.get("id");
    // A message without an id is a notification and never gets a response.
    let id = match id {
        None => return None,
        Some(v @ (Value::String(_) | Value::Number(_))) => v.clone(),
        Some(_) => return Some(error(&Value::Null, -32600, "Invalid Request")),
    };
    let method = match (object.get("jsonrpc"), object.get("method")) {
        (Some(Value::String(v)), Some(Value::String(m))) if v == "2.0" => m.as_str(),
        (_, None) if object.contains_key("result") || object.contains_key("error") => {
            // A response to a request we never send; nothing to answer.
            return None;
        }
        _ => return Some(error(&id, -32600, "Invalid Request")),
    };
    let params = match object.get("params") {
        None | Some(Value::Null) => Map::new(),
        Some(Value::Object(m)) => m.clone(),
        Some(_) => return Some(error(&id, -32602, "Params must be an object")),
    };
    Some(match method {
        "initialize" => {
            let requested = params.get("protocolVersion").and_then(Value::as_str);
            let version = requested
                .filter(|v| SUPPORTED_VERSIONS.contains(v))
                .unwrap_or(SUPPORTED_VERSIONS[0]);
            reply(
                &id,
                json!({
                    "protocolVersion": version,
                    "capabilities": {"tools": {}},
                    "serverInfo": {"name": "tore", "title": "töre", "version": env!("CARGO_PKG_VERSION")},
                    "instructions": if topics.is_some() {
                        "Only contexts and topics the person explicitly opened in töre are visible. Respect the labels: adopted decision, open task, open question and unadopted AI suggestion are different things. You cannot change the notebook. Where the person allowed it, tore_propose leaves a proposal in an inbox that they review; nothing you write is adopted or closes a task by itself."
                    } else {
                        "Read-only. Only contexts the person explicitly shared from töre are visible. Respect the labels in each context. Your reply does not flow back into töre; the person brings it back themselves."
                    }
                }),
            )
        }
        "ping" => reply(&id, json!({})),
        "tools/list" => {
            let mut all = tools();
            if let (Some(_), Some(list), Value::Array(more)) = (topics, all.as_array_mut(), topic_tools()) {
                list.extend(more);
            }
            reply(&id, json!({"tools": all}))
        }
        "tools/call" => match call_tool(&params, load, topics) {
            Ok(result) => reply(&id, result),
            Err((code, message)) => error(&id, code, message),
        },
        _ => error(&id, -32601, "Method not found"),
    })
}

#[cfg(test)]
#[path = "mcp_tests.rs"]
mod tests;
