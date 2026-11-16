use super::*;
use std::cell::RefCell;

fn context(id: &str) -> SharedContext {
    SharedContext {
        id: id.into(),
        topic_title: "SENTETİK konu".into(),
        created_at: "2026-11-16T09:00:00Z".into(),
        target: "claude".into(),
        model: None,
        record_count: 2,
        question: "SENTETİK soru?".into(),
        text: format!(
            "Töre — konuya geri dönüş\nSENTETİK metin {id}\nKullanıcının devam sorusu: SENTETİK soru?\n"
        ),
    }
}
fn ask(line: &str, load: &dyn Fn() -> Result<Vec<SharedContext>, String>) -> Value {
    let out = handle_line(line, load).expect("response expected");
    assert!(!out.contains('\n'), "one message per line");
    serde_json::from_str(&out).unwrap()
}
fn none() -> Result<Vec<SharedContext>, String> {
    Ok(vec![])
}

#[test]
fn initialize_negotiates_version_and_declares_only_tools() {
    let r = ask(
        r#"{"jsonrpc":"2.0","id":1,"method":"initialize","params":{"protocolVersion":"2025-03-26","capabilities":{},"clientInfo":{"name":"t","version":"1"}}}"#,
        &none,
    );
    assert_eq!(r["id"], 1);
    assert_eq!(r["result"]["protocolVersion"], "2025-03-26");
    assert_eq!(r["result"]["capabilities"], json!({"tools":{}}));
    assert_eq!(r["result"]["serverInfo"]["name"], "tore");
    assert_eq!(
        r["result"]["serverInfo"]["version"],
        env!("CARGO_PKG_VERSION")
    );
    let r = ask(
        r#"{"jsonrpc":"2.0","id":"a","method":"initialize","params":{"protocolVersion":"1999-01-01"}}"#,
        &none,
    );
    assert_eq!(r["result"]["protocolVersion"], "2025-06-18");
    assert_eq!(
        handle_line(
            r#"{"jsonrpc":"2.0","method":"notifications/initialized"}"#,
            &none
        ),
        None
    );
    assert_eq!(
        handle_line(
            r#"{"jsonrpc":"2.0","method":"notifications/whatever","params":{}}"#,
            &none
        ),
        None
    );
    assert_eq!(
        ask(r#"{"jsonrpc":"2.0","id":2,"method":"ping"}"#, &none)["result"],
        json!({})
    );
}

#[test]
fn tools_are_read_only_with_schemas() {
    let r = ask(r#"{"jsonrpc":"2.0","id":3,"method":"tools/list"}"#, &none);
    let tools = r["result"]["tools"].as_array().unwrap();
    assert_eq!(tools.len(), 2);
    for t in tools {
        assert_eq!(t["inputSchema"]["type"], "object");
        assert_eq!(t["annotations"]["readOnlyHint"], true);
        assert_eq!(t["annotations"]["destructiveHint"], false);
        assert_eq!(t["annotations"]["openWorldHint"], false);
    }
    assert_eq!(tools[0]["name"], LIST_TOOL);
    assert_eq!(tools[1]["name"], GET_TOOL);
    assert_eq!(tools[1]["inputSchema"]["required"], json!(["id"]));
}

#[test]
fn list_and_get_only_shared_and_revocation_applies_on_next_call() {
    let shared = RefCell::new(vec![context("p1"), context("p2")]);
    let load = || Ok(shared.borrow().clone());
    let call = |id: u32, name: &str, args: Value| {
        ask(
            &json!({"jsonrpc":"2.0","id":id,"method":"tools/call","params":{"name":name,"arguments":args}}).to_string(),
            &load,
        )
    };
    let list = call(1, LIST_TOOL, json!({}));
    assert_eq!(list["result"]["isError"], Value::Null);
    let contexts = list["result"]["structuredContent"]["contexts"]
        .as_array()
        .unwrap()
        .clone();
    assert_eq!(contexts.len(), 2);
    assert_eq!(contexts[0]["topic"], "SENTETİK konu");
    assert_eq!(contexts[0]["recordCount"], 2);
    assert_eq!(contexts[0]["question"], "SENTETİK soru?");
    assert_eq!(contexts[0]["declaredDestination"], "claude");
    assert!(
        contexts[0].get("text").is_none(),
        "list never carries the full text"
    );
    let text_list: Value =
        serde_json::from_str(list["result"]["content"][0]["text"].as_str().unwrap()).unwrap();
    assert_eq!(text_list, list["result"]["structuredContent"]);

    let get = call(2, GET_TOOL, json!({"id":"p1"}));
    let text = get["result"]["content"][0]["text"].as_str().unwrap();
    let (first, rest) = text.split_once('\n').unwrap();
    assert!(first.contains("töre") && first.contains("explicitly shared"));
    assert!(first.contains("BENİMSENMEMİŞ AI ÖNERİSİ") && first.contains("AÇIK SORU"));
    assert_eq!(rest, context("p1").text);

    let unknown = call(3, GET_TOOL, json!({"id":"never"}));
    assert_eq!(unknown["result"]["isError"], true);
    shared.borrow_mut().retain(|c| c.id != "p1");
    let revoked = call(4, GET_TOOL, json!({"id":"p1"}));
    assert_eq!(revoked["result"]["isError"], true);
    assert_eq!(
        revoked["result"]["content"], unknown["result"]["content"],
        "revoked and unknown look the same"
    );
    assert_eq!(
        call(5, LIST_TOOL, json!({}))["result"]["structuredContent"]["contexts"]
            .as_array()
            .unwrap()
            .len(),
        1
    );
    shared.borrow_mut().clear();
    let empty = call(6, LIST_TOOL, Value::Null);
    assert_eq!(empty["result"]["structuredContent"]["contexts"], json!([]));
    assert!(
        empty["result"]["structuredContent"]["message"]
            .as_str()
            .unwrap()
            .contains("Nothing is shared")
    );
}

#[test]
fn load_failure_is_a_tool_error_without_details() {
    let broken = || Err("Konu deposu bozuk; okunmadı".to_string());
    let r = ask(
        r#"{"jsonrpc":"2.0","id":1,"method":"tools/call","params":{"name":"tore_list_shared_contexts"}}"#,
        &broken,
    );
    assert_eq!(r["result"]["isError"], true);
    assert!(!r.to_string().contains("bozuk"));
}

#[test]
fn protocol_errors() {
    assert_eq!(ask("{not json", &none)["error"]["code"], -32700);
    assert_eq!(ask("{not json", &none)["id"], Value::Null);
    assert_eq!(ask("[1,2]", &none)["error"]["code"], -32600);
    assert_eq!(
        ask(r#"{"jsonrpc":"1.0","id":1,"method":"ping"}"#, &none)["error"]["code"],
        -32600
    );
    assert_eq!(
        ask(r#"{"jsonrpc":"2.0","id":{},"method":"ping"}"#, &none)["error"]["code"],
        -32600
    );
    assert_eq!(
        ask(
            r#"{"jsonrpc":"2.0","id":7,"method":"resources/list"}"#,
            &none
        )["error"]["code"],
        -32601
    );
    assert_eq!(
        ask(
            r#"{"jsonrpc":"2.0","id":7,"method":"tools/call","params":[1]}"#,
            &none
        )["error"]["code"],
        -32602
    );
    assert_eq!(
        ask(
            r#"{"jsonrpc":"2.0","id":7,"method":"tools/call","params":{}}"#,
            &none
        )["error"]["code"],
        -32602
    );
    assert_eq!(
        ask(
            r#"{"jsonrpc":"2.0","id":7,"method":"tools/call","params":{"name":"write_everything"}}"#,
            &none
        )["error"]["code"],
        -32602
    );
    assert_eq!(
        ask(
            r#"{"jsonrpc":"2.0","id":7,"method":"tools/call","params":{"name":"tore_get_shared_context","arguments":{}}}"#,
            &none
        )["error"]["code"],
        -32602
    );
    assert_eq!(
        ask(
            r#"{"jsonrpc":"2.0","id":7,"method":"tools/call","params":{"name":"tore_get_shared_context","arguments":{"id":5}}}"#,
            &none
        )["error"]["code"],
        -32602
    );
    assert_eq!(
        ask(
            r#"{"jsonrpc":"2.0","id":7,"method":"tools/call","params":{"name":"tore_get_shared_context","arguments":"x"}}"#,
            &none
        )["error"]["code"],
        -32602
    );
    assert_eq!(
        handle_line(r#"{"jsonrpc":"2.0","id":9,"result":{}}"#, &none),
        None
    );
}
