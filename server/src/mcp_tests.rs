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
        records: vec![],
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

struct FailingTopics {
    stale: bool,
}
impl Topics for FailingTopics {
    fn list(&self) -> Result<Vec<crate::workspace::ToolTopic>, String> {
        Err("Konu deposu bozuk; okunmadı (Data error) SENTETİK-AYRINTI".into())
    }
    fn context(&self, _: &str) -> Result<Option<ToolTopicContext>, String> {
        self.list().map(|_| None)
    }
    fn propose(
        &self,
        _: &str,
        _: &str,
        _: &str,
        _: Option<&str>,
        _: Option<&ProposalBasis>,
    ) -> Result<String, ProposeError> {
        self.list()
            .map(|_| String::new())
            .map_err(ProposeError::Notebook)
    }
    fn stale(&self) -> bool {
        self.stale
    }
}

#[test]
fn an_unreadable_notebook_tells_the_person_how_to_reconnect_without_the_reason() {
    let broken = || Err("Konu deposu bozuk; okunmadı SENTETİK-AYRINTI".to_string());
    for stale in [false, true] {
        let topics = FailingTopics { stale };
        for call in [
            r#"{"name":"tore_list_shared_contexts"}"#,
            r#"{"name":"tore_get_shared_context","arguments":{"id":"x"}}"#,
            r#"{"name":"tore_list_topics"}"#,
            r#"{"name":"tore_get_topic","arguments":{"topicId":"x"}}"#,
            r#"{"name":"tore_propose","arguments":{"topicId":"x","kind":"note","text":"SENTETİK"}}"#,
        ] {
            let line =
                format!(r#"{{"jsonrpc":"2.0","id":1,"method":"tools/call","params":{call}}}"#);
            let out = handle(&line, &broken, Some(&topics)).unwrap();
            let r: Value = serde_json::from_str(&out).unwrap();
            assert_eq!(r["result"]["isError"], true, "{call}");
            let text = r["result"]["content"][0]["text"].as_str().unwrap();
            assert!(
                text.contains("could not be read by this connector"),
                "{call}"
            );
            assert!(
                text.contains("reconnect this connector in their AI tool"),
                "{call}"
            );
            assert!(!text.contains("Claude") && !text.contains("/mcp"), "{call}");
            assert!(text.contains(env!("CARGO_PKG_VERSION")));
            assert_eq!(
                text.contains("töre was updated after this connector started, so"),
                stale
            );
            assert!(!out.contains("SENTETİK-AYRINTI") && !out.contains("bozuk"));
        }
    }
}

// ---- Structured output (tore.context/1) and the basis of a proposal ----
// Everything below runs against a real notebook on disk that holds only
// synthetic data ("SENTETİK").

use crate::workspace::TestNotebook;
use std::{collections::BTreeMap, fs, path::PathBuf};

struct Bench {
    base: PathBuf,
    disk: TestNotebook,
    topic: String,
}
impl Bench {
    fn new() -> Self {
        let base = std::env::temp_dir()
            .canonicalize()
            .unwrap()
            .join(format!("tore-mcp-synthetic-{}", uuid::Uuid::new_v4()));
        let mut disk = TestNotebook::open(base.join("conversations")).unwrap();
        let topic = disk
            .topic_create(json!({"title":"SENTETİK konu","goal":"SENTETİK amaç"}))
            .unwrap()["topic"]["id"]
            .as_str()
            .unwrap()
            .to_owned();
        Bench { base, disk, topic }
    }
    fn record(&mut self, kind: &str, text: &str, reason: &str) -> String {
        self.record_in(&self.topic.clone(), kind, text, reason)
    }
    fn record_in(&mut self, topic: &str, kind: &str, text: &str, reason: &str) -> String {
        self.disk
            .record_create(
                json!({"topicId":topic,"kind":kind,"text":text,"reason":reason}),
                &BTreeMap::new(),
            )
            .unwrap()["record"]["id"]
            .as_str()
            .unwrap()
            .to_owned()
    }
    fn review(&mut self, id: &str, revision: u32, text: &str, reason: &str, states: [&str; 4]) {
        let [review, adoption, currency, question] = states;
        self.disk
            .review(json!({"id":id,"expectedRevision":revision,"text":text,"reason":reason,
                "review":review,"adoption":adoption,"currency":currency,"priority":"active",
                "questionState":question,"changeReason":"SENTETİK inceleme.","confirmedByUser":true}))
            .unwrap();
    }
    fn adopted(&mut self, kind: &str, text: &str, reason: &str) -> String {
        let id = self.record(kind, text, reason);
        self.review(
            &id,
            1,
            text,
            reason,
            ["reviewed", "adopted", "current", "not_applicable"],
        );
        id
    }
    fn access(&mut self, read: bool, write: bool) {
        self.disk
            .tool_access_set(
                json!({"topicId":self.topic,"read":read,"write":write,"confirmedByUser":true}),
            )
            .unwrap();
    }
    fn topics(&self) -> DiskTopics {
        DiskTopics {
            data: self.base.clone(),
            client: RefCell::new("SENTETİK araç".into()),
            program: None,
        }
    }
    fn rpc(&self, message: Value) -> Value {
        let load = || shared_contexts(&self.base);
        let out = handle(&message.to_string(), &load, Some(&self.topics())).unwrap();
        assert!(!out.contains('\n'), "one message per line");
        serde_json::from_str(&out).unwrap()
    }
    fn call(&self, name: &str, args: Value) -> Value {
        self.rpc(json!({"jsonrpc":"2.0","id":1,"method":"tools/call","params":{"name":name,"arguments":args}}))
    }
    fn inbox_file(&self) -> PathBuf {
        self.base.join("conversations/tool-inbox.jsonl")
    }
    fn inbox_bytes(&self) -> Option<Vec<u8>> {
        fs::read(self.inbox_file()).ok()
    }
    fn notebook_bytes(&self) -> Vec<u8> {
        fs::read(self.base.join("conversations/records-v1.json")).unwrap()
    }
    /// A pending AI suggestion in the notebook: left by the tool, taken into
    /// the notebook by the person, not reviewed.
    fn ai_suggestion(&mut self, text: &str) -> String {
        let item = tool_propose(
            &self.base,
            "SENTETİK araç",
            &self.topic,
            "note",
            text,
            None,
            None,
        )
        .unwrap();
        self.disk
            .inbox_accept(json!({"itemId":item,"confirmedByUser":true}))
            .unwrap()["record"]["id"]
            .as_str()
            .unwrap()
            .to_owned()
    }
}
impl Drop for Bench {
    fn drop(&mut self) {
        fs::remove_dir_all(&self.base).ok();
    }
}
fn text_of(r: &Value) -> &str {
    r["result"]["content"][0]["text"].as_str().unwrap()
}
/// Every string anywhere inside `v`.
fn strings(v: &Value, out: &mut Vec<String>) {
    match v {
        Value::String(s) => out.push(s.clone()),
        Value::Array(a) => a.iter().for_each(|x| strings(x, out)),
        Value::Object(m) => m.values().for_each(|x| strings(x, out)),
        _ => {}
    }
}
/// The record ids a tool text names, in order.
fn ids_in_text(text: &str) -> Vec<String> {
    text.lines()
        .filter_map(|l| l.strip_prefix("Kayıt: "))
        .map(|l| l.split(" / ").next().unwrap().to_owned())
        .collect()
}

#[test]
fn tools_list_declares_output_schemas_and_the_basis_of_a_proposal() {
    let b = Bench::new();
    let r = b.rpc(json!({"jsonrpc":"2.0","id":1,"method":"tools/list"}));
    let tools = r["result"]["tools"].as_array().unwrap();
    let tool = |name: &str| tools.iter().find(|t| t["name"] == name).unwrap();
    for name in [LIST_TOOL, GET_TOOL, TOPICS_TOOL, TOPIC_TOOL] {
        assert_eq!(tool(name)["outputSchema"]["type"], "object", "{name}");
    }
    for (name, kind) in [(GET_TOOL, "shared_context"), (TOPIC_TOOL, "topic")] {
        let schema = &tool(name)["outputSchema"];
        assert_eq!(schema["properties"]["schema"]["const"], "tore.context/1");
        assert_eq!(schema["properties"]["type"]["const"], kind);
        let record = &schema["properties"]["records"]["items"];
        assert_eq!(
            record["properties"]["voice"]["enum"],
            json!(["person", "ai_suggestion"])
        );
        assert_eq!(
            record["properties"]["source"]["properties"]["voice"]["const"],
            "source"
        );
        assert_eq!(
            record["required"],
            json!(["id", "voice", "status", "priority", "origin", "text"])
        );
    }
    let propose = tool(PROPOSE_TOOL);
    assert!(propose.get("outputSchema").is_none());
    let input = &propose["inputSchema"];
    assert_eq!(input["required"], json!(["topicId", "kind", "text"]));
    assert_eq!(
        input["properties"]["basis"]["required"],
        json!(["quote", "source"])
    );
    assert_eq!(
        input["properties"]["basis"]["additionalProperties"],
        json!(false)
    );
    assert!(
        propose["description"]
            .as_str()
            .unwrap()
            .contains("A decision or an objection must come with basis")
    );
    // The context-only handler lists the same schemas for its two tools.
    let r = ask(r#"{"jsonrpc":"2.0","id":3,"method":"tools/list"}"#, &none);
    assert_eq!(r["result"]["tools"][1]["outputSchema"]["type"], "object");
}

#[test]
fn a_topic_as_structured_data_holds_the_records_of_its_text_and_nothing_more() {
    let mut b = Bench::new();
    let decision = b.adopted("decision", "SENTETİK karar", "SENTETİK karar gerekçesi");
    let opinion = b.adopted("opinion", "SENTETİK görüş", "");
    let task = b.record("task", "SENTETİK açık iş", "");
    let question = b.record("question", "SENTETİK açık soru", "");
    // An AI suggestion the person took in, reviewed and adopted: it is theirs
    // now, and its origin says where the wording came from.
    b.access(true, true);
    let kept = b.ai_suggestion("SENTETİK benimsenen yapay zekâ önerisi");
    b.review(
        &kept,
        1,
        "SENTETİK benimsenen yapay zekâ önerisi",
        "",
        ["reviewed", "adopted", "current", "not_applicable"],
    );
    // What must stay invisible, each with a text that is easy to search for.
    b.record("opinion", "GİZLİ-İNCELENMEMİŞ görüş", "");
    let old = b.adopted("decision", "GİZLİ-AŞILMIŞ karar", "");
    b.disk
        .supersede(json!({"olderId":old,"newerId":decision,"reason":"GİZLİ-AŞILMA nedeni","confirmedByUser":true}))
        .unwrap();
    let rejected = b.record("opinion", "GİZLİ-REDDEDİLMİŞ görüş", "");
    b.review(
        &rejected,
        1,
        "GİZLİ-REDDEDİLMİŞ görüş",
        "",
        ["rejected", "not_adopted", "unknown", "not_applicable"],
    );
    let trashed = b.adopted("opinion", "GİZLİ-ÇÖPTEKİ görüş", "");
    b.disk
        .trash(json!({"id":trashed,"confirmedByUser":true}))
        .unwrap();
    let other = b
        .disk
        .topic_create(json!({"title":"GİZLİ-BAŞKA konu","goal":""}))
        .unwrap()["topic"]["id"]
        .as_str()
        .unwrap()
        .to_owned();
    let elsewhere = b.record_in(&other, "task", "GİZLİ-BAŞKA konunun işi", "");
    b.access(true, true);
    let suggestion = b.ai_suggestion("GİZLİ-ONAYSIZ yapay zekâ önerisi");

    let r = b.call(TOPIC_TOOL, json!({"topicId":b.topic}));
    assert_eq!(r["result"]["isError"], Value::Null);
    let text = text_of(&r);
    let s = &r["result"]["structuredContent"];
    assert_eq!(s["schema"], "tore.context/1");
    assert_eq!(s["type"], "topic");
    assert_eq!(
        s["topic"],
        json!({"id":b.topic,"title":"SENTETİK konu","goal":"SENTETİK amaç"})
    );
    assert_eq!(s["proposalsAllowed"], true);
    assert_eq!(s["hiddenRecords"], 0);
    assert_eq!(
        s["records"],
        json!([
            {"id":decision,"kind":"decision","voice":"person","status":"adopted","priority":"active",
             "origin":"user_authored","text":"SENTETİK karar","reason":"SENTETİK karar gerekçesi"},
            {"id":opinion,"kind":"opinion","voice":"person","status":"adopted","priority":"active",
             "origin":"user_authored","text":"SENTETİK görüş"},
            {"id":kept,"kind":"opinion","voice":"person","status":"adopted","priority":"active",
             "origin":"assistant_proposal","text":"SENTETİK benimsenen yapay zekâ önerisi"},
            {"id":task,"kind":"task","voice":"person","status":"open","priority":"unspecified",
             "origin":"user_authored","text":"SENTETİK açık iş"},
            {"id":question,"kind":"question","voice":"person","status":"open","priority":"unspecified",
             "origin":"user_authored","text":"SENTETİK açık soru"},
        ])
    );
    // The origin is a line of the text first; the structure only repeats it.
    assert_eq!(text.matches("\nAtıf: user_authored\n").count(), 4);
    assert_eq!(text.matches("\nAtıf: assistant_proposal\n").count(), 1);
    assert_eq!(text.matches("\nAtıf: ").count(), 5);
    // Same records as the text, in the same order.
    let ids: Vec<String> = s["records"]
        .as_array()
        .unwrap()
        .iter()
        .map(|x| x["id"].as_str().unwrap().to_owned())
        .collect();
    assert_eq!(ids, ids_in_text(text));
    // Nothing the text does not already say: every string in the structure
    // is in the text, apart from the fixed vocabulary of the schema and the
    // topic id, which the tool itself sent as the argument of this call.
    let vocabulary = [
        "tore.context/1",
        "topic",
        "person",
        "adopted",
        "open",
        "decision",
        "opinion",
        "task",
        "question",
    ];
    let mut all = Vec::new();
    strings(s, &mut all);
    for value in all {
        assert!(
            text.contains(&value) || vocabulary.contains(&value.as_str()) || value == b.topic,
            "not in the text: {value}"
        );
    }
    // Visibility did not grow: no unreviewed AI suggestion, no superseded,
    // rejected or trashed record, no other topic, in either form.
    let whole = r.to_string();
    assert!(!whole.contains("GİZLİ"), "{whole}");
    for hidden in [&suggestion, &old, &rejected, &trashed, &elsewhere, &other] {
        assert!(!whole.contains(hidden.as_str()));
    }
    for key in [
        "source",
        "revision",
        "createdAt",
        "updatedAt",
        "relatesTo",
        "answersQuestionId",
    ] {
        assert!(
            s["records"]
                .as_array()
                .unwrap()
                .iter()
                .all(|x| x.get(key).is_none()),
            "{key} is not in the topic text, so it is not in the structure"
        );
    }
    // The origin brought nothing else with it: no source quote or speaker,
    // no tool name, no date.
    for absent in ["Kaynak", "Özgün konuşmacı", "Birebir alıntı", "SENTETİK araç", "tool:"] {
        assert!(!whole.contains(absent), "{absent}");
    }
    // A closed or unknown topic has no structured content either.
    b.access(false, false);
    let closed = b.call(TOPIC_TOOL, json!({"topicId":b.topic}));
    assert_eq!(closed["result"]["isError"], true);
    assert!(closed["result"].get("structuredContent").is_none());
}

#[test]
fn the_text_is_the_same_for_every_protocol_version() {
    let mut b = Bench::new();
    let decision = b.adopted("decision", "SENTETİK karar", "SENTETİK gerekçe");
    let task = b.record("task", "SENTETİK iş", "");
    b.access(true, false);
    // The whole text, fixed here so that any change to it is a deliberate one.
    // Since 0.19.0 each record has an "Atıf" (origin) line.
    let expected = format!(
        "{PREAMBLE}\nKONU: SENTETİK konu\nAMAÇ: SENTETİK amaç\n\n[KULLANICININ BENİMSEDİĞİ KARAR]\nKayıt: {decision}\nÖncelik: active\nAtıf: user_authored\nİfade: SENTETİK karar\nGerekçe: SENTETİK gerekçe\n\n[AÇIK İŞ — KARAR DEĞİL]\nKayıt: {task}\nÖncelik: unspecified\nAtıf: user_authored\nİfade: SENTETİK iş\n\nBu konu yalnız okumaya açık; öneri bırakamazsın.\n"
    );
    for version in SUPPORTED_VERSIONS {
        let init = b.rpc(json!({"jsonrpc":"2.0","id":1,"method":"initialize","params":{"protocolVersion":version,"capabilities":{},"clientInfo":{"name":"SENTETİK araç","version":"0"}}}));
        assert_eq!(init["result"]["protocolVersion"], version);
        let r = b.call(TOPIC_TOOL, json!({"topicId":b.topic}));
        let content = r["result"]["content"].as_array().unwrap();
        assert_eq!(content.len(), 1, "{version}");
        assert_eq!(content[0]["type"], "text");
        assert_eq!(text_of(&r), expected, "{version}");
    }
}

#[test]
fn a_shared_context_as_structured_data_keeps_the_three_voices_apart() {
    let mut b = Bench::new();
    let decision = b.adopted("decision", "SENTETİK karar", "SENTETİK gerekçe");
    let question = b.record("question", "SENTETİK açık soru", "");
    b.review(
        &question,
        1,
        "SENTETİK açık soru",
        "",
        ["reviewed", "not_applicable", "current", "open"],
    );
    let unselected = b.adopted("opinion", "GİZLİ-SEÇİLMEMİŞ görüş", "");
    b.access(true, true);
    let suggestion = b.ai_suggestion("SENTETİK yapay zekâ önerisi");
    b.review(
        &suggestion,
        1,
        "SENTETİK yapay zekâ önerisi",
        "",
        ["reviewed", "uncertain", "current", "not_applicable"],
    );
    b.access(false, false);
    let packet = b
        .disk
        .prepare(json!({"topicId":b.topic,"recordIds":[decision,question],"proposalIds":[suggestion],
            "target":"other","model":null,"question":"SENTETİK devam sorusu?","confirmedByUser":true}))
        .unwrap()["packet"]
        .clone();
    let hidden = b
        .disk
        .prepare(json!({"topicId":b.topic,"recordIds":[unselected],"proposalIds":[],
            "target":"other","model":null,"question":"GİZLİ-PAYLAŞILMAMIŞ soru","confirmedByUser":true}))
        .unwrap()["packet"]["id"]
        .clone();
    b.disk
        .share(json!({"packetId":packet["id"],"shared":true,"confirmedByUser":true}))
        .unwrap();

    let r = b.call(GET_TOOL, json!({"id":packet["id"]}));
    let text = text_of(&r);
    assert_eq!(
        text,
        format!("{PREAMBLE}\n{}", packet["text"].as_str().unwrap())
    );
    let s = &r["result"]["structuredContent"];
    assert_eq!(s["schema"], "tore.context/1");
    assert_eq!(s["type"], "shared_context");
    assert_eq!(s["id"], packet["id"]);
    assert_eq!(s["topic"], json!({"title":"SENTETİK konu"}));
    assert_eq!(s["declaredDestination"], "other");
    assert_eq!(s["recordCount"], 3);
    assert_eq!(s["question"], "SENTETİK devam sorusu?");
    let tool_source = format!("tool:{}", {
        let v: Value = serde_json::from_slice(&b.notebook_bytes()).unwrap();
        v["records"][&suggestion]["source"]["id"]
            .as_str()
            .unwrap()
            .trim_start_matches("tool:")
            .to_owned()
    });
    assert_eq!(
        s["records"],
        json!([
            {"id":decision,"revision":2,"kind":"decision","voice":"person","status":"adopted","priority":"active",
             "origin":"user_authored","text":"SENTETİK karar","reason":"SENTETİK gerekçe",
             "source":{"voice":"source","id":format!("record:{decision}:v2"),"speaker":"user","quote":"SENTETİK karar"}},
            {"id":question,"revision":2,"kind":"question","voice":"person","status":"open","priority":"active",
             "origin":"user_authored","text":"SENTETİK açık soru",
             "source":{"voice":"source","id":format!("record:{question}:v2"),"speaker":"user","quote":"SENTETİK açık soru"}},
            {"id":suggestion,"revision":2,"voice":"ai_suggestion","status":"unadopted","priority":"active",
             "origin":"assistant_proposal","text":"SENTETİK yapay zekâ önerisi",
             "source":{"voice":"source","id":tool_source,"speaker":"assistant","quote":"SENTETİK yapay zekâ önerisi"}},
        ])
    );
    let ids: Vec<String> = s["records"]
        .as_array()
        .unwrap()
        .iter()
        .map(|x| x["id"].as_str().unwrap().to_owned())
        .collect();
    assert_eq!(ids, ids_in_text(text));
    // Nothing beyond the shared text, apart from what the listing already
    // gives (id, creation time, destination) and the fixed vocabulary.
    let vocabulary = [
        "tore.context/1",
        "shared_context",
        "person",
        "ai_suggestion",
        "source",
        "adopted",
        "open",
        "unadopted",
        "decision",
        "question",
        "other",
    ];
    let listed = [
        packet["id"].as_str().unwrap(),
        packet["createdAt"].as_str().unwrap(),
    ];
    let mut all = Vec::new();
    strings(s, &mut all);
    for value in all {
        assert!(
            text.contains(&value)
                || vocabulary.contains(&value.as_str())
                || listed.contains(&value.as_str()),
            "not in the text: {value}"
        );
    }
    let whole = r.to_string();
    assert!(!whole.contains("GİZLİ") && !whole.contains(unselected.as_str()));
    // The unshared context stays unreachable in both forms.
    let other = b.call(GET_TOOL, json!({"id":hidden}));
    assert_eq!(other["result"]["isError"], true);
    assert!(other["result"].get("structuredContent").is_none());

    // The structure follows the shared text, not the notebook: a later
    // revision of a record does not leak into it.
    b.review(
        &decision,
        2,
        "GİZLİ-SONRADAN değişen karar",
        "GİZLİ-SONRADAN gerekçe",
        ["reviewed", "adopted", "current", "not_applicable"],
    );
    let later = b.call(GET_TOOL, json!({"id":packet["id"]}));
    assert_eq!(text_of(&later), text);
    assert_eq!(
        later["result"]["structuredContent"],
        r["result"]["structuredContent"]
    );
    assert!(!later.to_string().contains("GİZLİ"));

    // Closing the context removes both forms.
    b.disk
        .share(json!({"packetId":packet["id"],"shared":false,"confirmedByUser":true}))
        .unwrap();
    let closed = b.call(GET_TOOL, json!({"id":packet["id"]}));
    assert_eq!(closed["result"]["isError"], true);
    assert!(closed["result"].get("structuredContent").is_none());
}

#[test]
fn a_decision_or_an_objection_without_a_basis_is_refused_and_nothing_is_stored() {
    let mut b = Bench::new();
    let decision = b.adopted("decision", "SENTETİK karar", "");
    b.access(true, true);
    let notebook = b.notebook_bytes();
    let propose = |b: &Bench, extra: Value| {
        let mut args = json!({"topicId":b.topic,"text":"SENTETİK öneri"});
        for (k, v) in extra.as_object().unwrap() {
            args[k] = v.clone();
        }
        b.call(PROPOSE_TOOL, args)
    };
    let long_quote = "a".repeat(2001);
    let long_source = "a".repeat(501);
    // Refused as a tool error the model can read and correct.
    for (case, extra, expected) in [
        ("decision, no basis", json!({"kind":"decision"}), "needs basis"),
        ("decision, null basis", json!({"kind":"decision","basis":null}), "needs basis"),
        (
            "objection, no basis",
            json!({"kind":"objection","relatesTo":decision}),
            "needs basis",
        ),
        (
            "empty quote",
            json!({"kind":"decision","basis":{"quote":"","source":"SENTETİK kaynak"}}),
            "basis.quote is required",
        ),
        (
            "blank quote",
            json!({"kind":"decision","basis":{"quote":" \n\t","source":"SENTETİK kaynak"}}),
            "basis.quote is required",
        ),
        (
            "empty source",
            json!({"kind":"objection","relatesTo":decision,"basis":{"quote":"SENTETİK alıntı","source":" "}}),
            "basis.source is required",
        ),
        (
            "quote over the limit",
            json!({"kind":"decision","basis":{"quote":long_quote,"source":"SENTETİK kaynak"}}),
            "limited to 2000 bytes",
        ),
        (
            "source over the limit",
            json!({"kind":"decision","basis":{"quote":"SENTETİK alıntı","source":long_source}}),
            "limited to 500 bytes",
        ),
        (
            "a note with a bad basis",
            json!({"kind":"note","basis":{"quote":"","source":"SENTETİK kaynak"}}),
            "basis.quote is required",
        ),
    ] {
        let r = propose(&b, extra);
        assert_eq!(r["result"]["isError"], true, "{case}: {r}");
        let message = text_of(&r);
        assert!(message.contains(expected), "{case}: {message}");
        assert_eq!(b.inbox_bytes(), None, "{case}: nothing reaches the inbox");
    }
    // A basis of the wrong shape is a protocol error.
    for (case, basis) in [
        ("a string", json!("SENTETİK alıntı")),
        ("an array", json!(["SENTETİK alıntı", "SENTETİK kaynak"])),
        ("quote missing", json!({"source":"SENTETİK kaynak"})),
        ("source missing", json!({"quote":"SENTETİK alıntı"})),
        ("quote not a string", json!({"quote":5,"source":"SENTETİK kaynak"})),
        (
            "an extra member",
            json!({"quote":"SENTETİK alıntı","source":"SENTETİK kaynak","verified":true}),
        ),
    ] {
        let r = propose(&b, json!({"kind":"decision","basis":basis}));
        assert_eq!(r["error"]["code"], -32602, "{case}: {r}");
        assert!(
            r["error"]["message"]
                .as_str()
                .unwrap()
                .contains("basis must be an object")
        );
        assert_eq!(b.inbox_bytes(), None, "{case}");
    }
    assert_eq!(b.notebook_bytes(), notebook, "the notebook is untouched");
    assert!(
        b.disk.inbox_view().unwrap()["items"]
            .as_array()
            .unwrap()
            .is_empty()
    );
}

#[test]
fn a_valid_basis_is_stored_shown_and_kept_when_the_proposal_becomes_a_record() {
    let mut b = Bench::new();
    let decision = b.adopted(
        "decision",
        "SENTETİK karar: önce küçük bir deneme yapılır",
        "",
    );
    b.access(true, true);
    let notebook = b.notebook_bytes();
    // The limits are inclusive, and they count bytes.
    let quote_at_limit = "ş".repeat(1000);
    let source_at_limit = "a".repeat(500);
    let calls = [
        json!({"kind":"objection","text":"SENTETİK itiraz","relatesTo":decision,
            "basis":{"quote":"önce küçük bir deneme yapılır","source":decision}}),
        json!({"kind":"decision","text":"SENTETİK karar önerisi",
            "basis":{"quote":"SENTETİK <b>alıntı</b>","source":"https://example.invalid/sentetik"}}),
        json!({"kind":"decision","text":"SENTETİK sınırdaki öneri",
            "basis":{"quote":quote_at_limit,"source":source_at_limit}}),
        json!({"kind":"note","text":"SENTETİK dayanaksız not"}),
        json!({"kind":"question","text":"SENTETİK dayanaklı soru",
            "basis":{"quote":"SENTETİK alıntı","source":"SENTETİK kaynak tanımı"}}),
        json!({"kind":"task","text":"SENTETİK dayanaksız iş"}),
    ];
    for extra in &calls {
        let mut args = json!({"topicId":b.topic});
        for (k, v) in extra.as_object().unwrap() {
            args[k] = v.clone();
        }
        let r = b.call(PROPOSE_TOOL, args);
        assert_eq!(r["result"]["isError"], Value::Null, "{r}");
        assert!(text_of(&r).contains("Left in the töre inbox"));
    }
    // The tool still does not write the notebook, and töre holds its lock
    // the whole time (`b.disk` is open).
    assert_eq!(b.notebook_bytes(), notebook);
    let lines: Vec<Value> = String::from_utf8(b.inbox_bytes().unwrap())
        .unwrap()
        .lines()
        .map(|l| serde_json::from_str(l).unwrap())
        .collect();
    assert_eq!(lines.len(), 6);
    assert_eq!(
        lines[0]["basis"],
        json!({"quote":"önce küçük bir deneme yapılır","source":decision})
    );
    assert_eq!(lines[1]["basis"]["source"], "https://example.invalid/sentetik");
    assert_eq!(lines[2]["basis"]["quote"].as_str().unwrap().len(), 2000);
    assert!(lines[3].get("basis").is_none(), "absent, not null");
    assert_eq!(lines[4]["basis"]["quote"], "SENTETİK alıntı");
    assert!(lines[5].get("basis").is_none());
    assert!(lines.iter().all(|l| l["tool"] == "SENTETİK araç"));

    let view = b.disk.inbox_view().unwrap();
    let items = view["items"].as_array().unwrap();
    assert_eq!(items.len(), 6);
    assert_eq!(items[0]["item"]["basis"], lines[0]["basis"]);
    // A basis that names a record of the topic is resolved and checked.
    assert_eq!(
        items[0]["basisRecord"],
        json!({"id":decision,"kind":"decision","text":"SENTETİK karar: önce küçük bir deneme yapılır","quoteFound":true})
    );
    assert_eq!(items[1]["basisRecord"], Value::Null, "free text stays a claim");
    assert_eq!(items[3]["basisRecord"], Value::Null);
    assert!(items[3]["item"].get("basis").is_none());

    // Taking a proposal into the notebook keeps its basis, as the tool's
    // claim inside the reason of a pending AI proposal.
    let accepted = b
        .disk
        .inbox_accept(json!({"itemId":lines[0]["id"],"confirmedByUser":true}))
        .unwrap()["record"]
        .clone();
    assert_eq!(accepted["attribution"], "assistant_proposal");
    assert_eq!(accepted["review"], "pending");
    assert_eq!(accepted["adoption"], "unknown");
    assert_eq!(accepted["source"]["role"], "assistant");
    assert_eq!(accepted["source"]["excerpt"], "SENTETİK itiraz");
    assert_eq!(
        accepted["reason"],
        format!(
            "Şu kayda itiraz: SENTETİK karar: önce küçük bir deneme yapılır\nAracın gösterdiği dayanak (doğrulanmadı): \"önce küçük bir deneme yapılır\"\nDayanağın kaynağı (aracın beyanı): {decision}"
        )
    );
    let free = b
        .disk
        .inbox_accept(json!({"itemId":lines[1]["id"],"confirmedByUser":true}))
        .unwrap()["record"]
        .clone();
    assert_eq!(
        free["reason"],
        "Aracın gösterdiği dayanak (doğrulanmadı): \"SENTETİK <b>alıntı</b>\"\nDayanağın kaynağı (aracın beyanı): https://example.invalid/sentetik"
    );
    let limit = b
        .disk
        .inbox_accept(json!({"itemId":lines[2]["id"],"confirmedByUser":true}))
        .unwrap()["record"]
        .clone();
    assert!(limit["reason"].as_str().unwrap().len() <= 12000);
    assert!(limit["reason"].as_str().unwrap().contains(&quote_at_limit));
    let plain = b
        .disk
        .inbox_accept(json!({"itemId":lines[3]["id"],"confirmedByUser":true}))
        .unwrap()["record"]
        .clone();
    assert_eq!(plain["reason"], "");
    // A pending AI proposal stays out of what the tool reads, basis included.
    let topic = b.call(TOPIC_TOOL, json!({"topicId":b.topic})).to_string();
    assert!(!topic.contains("SENTETİK itiraz") && !topic.contains("dayanak"));
}

#[test]
fn inbox_lines_written_before_the_basis_existed_are_still_read() {
    let mut b = Bench::new();
    let decision = b.adopted("decision", "SENTETİK karar", "");
    b.access(true, true);
    // Lines exactly as töre wrote them before `basis`: a decision and an
    // objection without one. They stay readable and acceptable.
    let old = |id: &str, kind: &str, relates: Value| {
        json!({"id":id,"receivedAt":"2026-11-16T09:00:00Z","tool":"SENTETİK eski araç",
            "topicId":b.topic,"kind":kind,"text":format!("SENTETİK eski {kind}"),"relatesTo":relates})
        .to_string()
    };
    let first = "0f8fad5b-d9cb-469f-a165-70867728950e";
    let second = "7c9e6679-7425-40de-944b-e07fc1f90ae7";
    let damaged = "3f2504e0-4f89-41d3-9a0c-0305e82c3301";
    let file = [
        old(first, "decision", Value::Null),
        old(second, "objection", json!(decision)),
        // A line whose basis breaks the limits is skipped, never trusted.
        json!({"id":damaged,"receivedAt":"2026-11-16T09:00:00Z","tool":"SENTETİK araç","topicId":b.topic,
            "kind":"decision","text":"SENTETİK bozuk","relatesTo":null,"basis":{"quote":"","source":"x"}})
        .to_string(),
    ]
    .join("\n")
        + "\n";
    fs::write(b.inbox_file(), &file).unwrap();
    let new = b.call(
        PROPOSE_TOOL,
        json!({"topicId":b.topic,"kind":"decision","text":"SENTETİK yeni karar önerisi",
            "basis":{"quote":"SENTETİK alıntı","source":"SENTETİK kaynak"}}),
    );
    assert_eq!(new["result"]["isError"], Value::Null, "{new}");
    let after = String::from_utf8(b.inbox_bytes().unwrap()).unwrap();
    assert!(after.starts_with(&file), "older lines are not rewritten");

    let view = b.disk.inbox_view().unwrap();
    let items = view["items"].as_array().unwrap();
    let ids: Vec<&str> = items
        .iter()
        .map(|i| i["item"]["id"].as_str().unwrap())
        .collect();
    assert_eq!(ids.len(), 3);
    assert_eq!(&ids[..2], [first, second]);
    assert!(!ids.contains(&damaged));
    assert!(items[0]["item"].get("basis").is_none());
    assert_eq!(items[0]["basisRecord"], Value::Null);
    assert_eq!(items[2]["item"]["basis"]["quote"], "SENTETİK alıntı");
    let accepted = b
        .disk
        .inbox_accept(json!({"itemId":second,"confirmedByUser":true}))
        .unwrap()["record"]
        .clone();
    assert_eq!(accepted["reason"], "Şu kayda itiraz: SENTETİK karar");
    assert_eq!(accepted["review"], "pending");
}

#[test]
fn a_refused_proposal_reaches_the_tool_in_its_own_words_whatever_letters_it_has() {
    let mut b = Bench::new();
    let task = b.record("task", "SENTETİK iş", "");
    // Closed for proposals: the answer names the page, with its Turkish letter.
    b.access(true, false);
    let propose = |b: &Bench, kind: &str, text: &str, relates: Value| {
        b.call(
            PROPOSE_TOOL,
            json!({"topicId":b.topic,"kind":kind,"text":text,"relatesTo":relates}),
        )
    };
    let closed = propose(&b, "note", "SENTETİK not", Value::Null);
    assert_eq!(closed["result"]["isError"], true);
    assert_eq!(
        text_of(&closed),
        "This topic is not open for proposals. The person can allow it on the Konularım page."
    );
    b.access(true, true);
    for (kind, text, relates, expected) in [
        ("plan", "SENTETİK", Value::Null, "kind must be one of"),
        ("note", "", Value::Null, "text is required"),
        ("note", "SENTETİK", json!("yok"), "relatesTo must be a record id"),
        ("objection", "SENTETİK", json!(task), "An objection needs relatesTo"),
    ] {
        let r = propose(&b, kind, text, relates);
        assert_eq!(r["result"]["isError"], true);
        assert!(text_of(&r).contains(expected), "{}", text_of(&r));
        assert!(!text_of(&r).contains("could not be read"));
    }
    // A full inbox: 200 waiting proposals. The tool is told exactly that,
    // although the message is not ASCII ("töre").
    let line = |i: usize| {
        json!({"id":uuid::Uuid::new_v4().to_string(),"receivedAt":"2026-11-16T09:00:00Z","tool":"SENTETİK araç",
            "topicId":b.topic,"kind":"note","text":format!("SENTETİK bekleyen öneri {i}"),"relatesTo":null})
        .to_string()
    };
    let file = (0..200).map(line).collect::<Vec<_>>().join("\n") + "\n";
    fs::write(b.inbox_file(), &file).unwrap();
    let full = propose(&b, "note", "SENTETİK fazla öneri", Value::Null);
    assert_eq!(full["result"]["isError"], true);
    assert_eq!(
        text_of(&full),
        "The töre inbox is full. Wait until the person has reviewed it."
    );
    assert!(!text_of(&full).is_ascii());
    assert_eq!(fs::read_to_string(b.inbox_file()).unwrap(), file);
    // An unreadable notebook is still the other answer, without its reason.
    drop(b);
    let broken = FailingTopics { stale: false };
    let out = handle(
        r#"{"jsonrpc":"2.0","id":1,"method":"tools/call","params":{"name":"tore_propose","arguments":{"topicId":"x","kind":"note","text":"SENTETİK"}}}"#,
        &none,
        Some(&broken),
    )
    .unwrap();
    assert!(out.contains("could not be read by this connector") && !out.contains("bozuk"));
}

#[test]
fn a_folder_without_a_notebook_says_so_instead_of_asking_to_reconnect() {
    let base = std::env::temp_dir()
        .canonicalize()
        .unwrap()
        .join(format!("tore-mcp-synthetic-empty-{}", uuid::Uuid::new_v4()));
    fs::create_dir_all(&base).unwrap();
    let topics = DiskTopics {
        data: base.clone(),
        client: RefCell::new("SENTETİK araç".into()),
        program: None,
    };
    let load = || shared_contexts(&base);
    let call = |params: &str| -> Value {
        let line = format!(r#"{{"jsonrpc":"2.0","id":1,"method":"tools/call","params":{params}}}"#);
        serde_json::from_str(&handle(&line, &load, Some(&topics)).unwrap()).unwrap()
    };
    for params in [
        r#"{"name":"tore_list_shared_contexts"}"#,
        r#"{"name":"tore_get_shared_context","arguments":{"id":"x"}}"#,
        r#"{"name":"tore_list_topics"}"#,
        r#"{"name":"tore_get_topic","arguments":{"topicId":"x"}}"#,
        r#"{"name":"tore_propose","arguments":{"topicId":"x","kind":"note","text":"SENTETİK"}}"#,
    ] {
        let r = call(params);
        assert_eq!(r["result"]["isError"], true, "{params}");
        let text = text_of(&r);
        assert!(text.starts_with("No töre notebook was found in this folder yet."), "{text}");
        assert!(text.contains("start töre once with this folder"));
        assert!(!text.contains("could not be read") && !text.contains("econnect"));
        assert!(r["result"].get("structuredContent").is_none());
    }
    // An unknown tool is still a protocol error, and nothing was created.
    assert_eq!(call(r#"{"name":"write_everything"}"#)["error"]["code"], -32602);
    assert_eq!(fs::read_dir(&base).unwrap().count(), 0);
    // Once töre has started with the folder, an empty notebook is an empty
    // answer, not an error.
    drop(TestNotebook::open(base.join("conversations")).unwrap());
    let r = call(r#"{"name":"tore_list_topics"}"#);
    assert_eq!(r["result"]["isError"], Value::Null);
    assert_eq!(r["result"]["structuredContent"]["topics"], json!([]));
    fs::remove_dir_all(&base).unwrap();
}

#[test]
fn no_message_for_the_tool_names_an_ai_product_or_its_commands() {
    // Every fixed sentence this adapter can send: tool list, instructions,
    // preamble and the error texts.
    let mut b = Bench::new();
    b.adopted("decision", "SENTETİK karar", "");
    b.access(true, true);
    let mut sent = vec![
        b.rpc(json!({"jsonrpc":"2.0","id":1,"method":"initialize","params":{}})).to_string(),
        b.rpc(json!({"jsonrpc":"2.0","id":1,"method":"tools/list"})).to_string(),
        b.call(TOPICS_TOOL, json!({})).to_string(),
        b.call(TOPIC_TOOL, json!({"topicId":b.topic})).to_string(),
        b.call(TOPIC_TOOL, json!({"topicId":"yok"})).to_string(),
        b.call(LIST_TOOL, json!({})).to_string(),
        b.call(GET_TOOL, json!({"id":"yok"})).to_string(),
        b.call(PROPOSE_TOOL, json!({"topicId":b.topic,"kind":"decision","text":"SENTETİK"})).to_string(),
        b.call(PROPOSE_TOOL, json!({"topicId":b.topic,"kind":"note","text":"SENTETİK"})).to_string(),
        NO_NOTEBOOK.to_owned(),
        NOT_OPEN.to_owned(),
        NOT_SHARED.to_owned(),
        PREAMBLE.to_owned(),
    ];
    for stale in [false, true] {
        sent.push(unreadable("SENTETİK neden", stale).to_string());
    }
    for text in sent {
        for word in ["Claude", "ChatGPT", "Codex", "Cursor", "Gemini", "/mcp", "Anthropic", "OpenAI"] {
            assert!(!text.contains(word), "{word} in: {text}");
        }
    }
}
