//! Read-only Model Context Protocol adapter over stdio.
//!
//! One JSON-RPC 2.0 message per line on stdin and stdout. stdout carries only
//! protocol messages; short diagnostics without personal content go to stderr.
//! The adapter exposes nothing but packets the person explicitly opened to a
//! connected AI tool, reads the notebook fresh for every tool call, never takes
//! the notebook lock and never writes to disk.
use crate::workspace::{SharedContext, shared_contexts};
use serde_json::{Map, Value, json};
use std::{
    io::{BufRead, Write},
    path::PathBuf,
};

pub const SUPPORTED_VERSIONS: [&str; 3] = ["2025-06-18", "2025-03-26", "2024-11-05"];
const LIST_TOOL: &str = "tore_list_shared_contexts";
const GET_TOOL: &str = "tore_get_shared_context";
const PREAMBLE: &str = "This context comes from töre, a local notebook, and the person explicitly shared exactly this text with you. Respect its labels: an adopted decision or opinion (KULLANICININ BENİMSEDİĞİ KARAR / GÖRÜŞ), an open question (AÇIK SORU — GÖRÜŞ DEĞİL) and an unadopted AI suggestion (BENİMSENMEMİŞ AI ÖNERİSİ) are different things; never treat one as another, and keep quotes attributed to their original speaker.";
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
    eprintln!("tore mcp: ready (read-only; only contexts the person shared are visible)");
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
        let load = || shared_contexts(&data);
        if let Some(reply) = handle_line(&text, &load) {
            let mut out = stdout.lock();
            if writeln!(out, "{reply}").and_then(|_| out.flush()).is_err() {
                return Ok(());
            }
        }
    }
}

pub fn help() -> &'static str {
    "tore-server mcp --data MUTLAK_KLASÖR\nBağlı AI aracı için salt okunur MCP sunucusu (stdio). Yalnız Konularım'da açıkça \"Bağlı AI aracına aç\" dediğin devam metinlerini okutur; hiçbir şey yazmaz."
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
    match name {
        LIST_TOOL => {
            let contexts = match load() {
                Ok(c) => c,
                Err(_) => {
                    return Ok(tool_text(
                        "The töre notebook could not be read right now.".into(),
                        true,
                    ));
                }
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
                Err(_) => {
                    return Ok(tool_text(
                        "The töre notebook could not be read right now.".into(),
                        true,
                    ));
                }
            };
            Ok(match contexts.into_iter().find(|c| c.id == id) {
                Some(c) => tool_text(format!("{PREAMBLE}\n{}", c.text), false),
                None => tool_text(NOT_SHARED.into(), true),
            })
        }
        _ => Err((-32602, "Unknown tool")),
    }
}

/// Pure request handler: one input line in, at most one output line out.
/// `load` returns only shared contexts and is called afresh for every tool call.
pub fn handle_line(
    line: &str,
    load: &dyn Fn() -> Result<Vec<SharedContext>, String>,
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
                    "instructions": "Read-only. Only contexts the person explicitly shared from töre are visible. Respect the labels in each context. Your reply does not flow back into töre; the person brings it back themselves."
                }),
            )
        }
        "ping" => reply(&id, json!({})),
        "tools/list" => reply(&id, json!({"tools": tools()})),
        "tools/call" => match call_tool(&params, load) {
            Ok(result) => reply(&id, result),
            Err((code, message)) => error(&id, code, message),
        },
        _ => error(&id, -32601, "Method not found"),
    })
}

#[cfg(test)]
#[path = "mcp_tests.rs"]
mod tests;
