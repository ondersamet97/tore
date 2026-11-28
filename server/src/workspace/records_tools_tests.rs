use super::*;
use std::{fs, path::PathBuf};

fn base() -> PathBuf {
    std::env::temp_dir()
        .canonicalize()
        .unwrap()
        .join(format!("tore-tools-{}", id()))
}
fn setup() -> (PathBuf, Disk, String) {
    let base = base();
    let mut d = Disk::open(base.join("conversations")).unwrap();
    let t = d
        .topic_create(json!({"title":"Yapay proje","goal":"Yapay amaç"}))
        .unwrap()["topic"]["id"]
        .as_str()
        .unwrap()
        .to_owned();
    (base, d, t)
}
fn record(d: &mut Disk, topic: &str, kind: &str, text: &str) -> String {
    d.record_create(
        json!({"topicId":topic,"kind":kind,"text":text,"reason":""}),
        &BTreeMap::new(),
    )
    .unwrap()["record"]["id"]
        .as_str()
        .unwrap()
        .to_owned()
}
fn adopt(d: &mut Disk, id: &str, text: &str) {
    d.review(json!({"id":id,"expectedRevision":1,"text":text,"reason":"","review":"reviewed","adoption":"adopted",
        "currency":"current","priority":"active","questionState":"not_applicable","changeReason":"Yapay inceleme.","confirmedByUser":true}))
        .unwrap();
}
fn basis() -> ProposalBasis {
    ProposalBasis {
        quote: "SENTETİK dayanak alıntısı".into(),
        source: "SENTETİK kaynak tanımı".into(),
    }
}
fn open(d: &mut Disk, topic: &str, read: bool, write: bool) -> Result<Value, String> {
    d.tool_access_set(json!({"topicId":topic,"read":read,"write":write,"confirmedByUser":true}))
}

#[test]
fn a_task_is_open_or_closed_and_never_an_adopted_belief() {
    let (base, mut d, t) = setup();
    let task = record(&mut d, &t, "task", "Yapay iş");
    let view = d.topic_view(json!({"topicId":t})).unwrap();
    assert_eq!(view["openTasks"][0]["id"], task.as_str());
    assert_eq!(view["openTasks"][0]["adoption"], "not_applicable");
    assert_eq!(view["openTasks"][0]["questionState"], "open");
    assert!(view["openQuestions"].as_array().unwrap().is_empty());
    let close = |adoption: &str, state: &str| {
        json!({"id":task,"expectedRevision":1,"text":"Yapay iş","reason":"","review":"reviewed","adoption":adoption,
        "currency":"current","priority":"unspecified","questionState":state,"changeReason":"Yapay kapanış.","confirmedByUser":true})
    };
    assert!(d.review(close("adopted", "closed")).is_err());
    d.review(close("not_applicable", "closed")).unwrap();
    let view = d.topic_view(json!({"topicId":t})).unwrap();
    assert!(view["openTasks"].as_array().unwrap().is_empty());
    assert!(
        d.map_add(json!({"recordId":task,"section":"insan","role":"position","confirmedByUser":true}))
            .is_err(),
        "iş haritaya konmaz"
    );
    fs::remove_dir_all(base).ok();
}

#[test]
fn a_tool_sees_only_topics_the_person_opened_and_only_settled_or_open_work() {
    let (base, mut d, t) = setup();
    let other = d
        .topic_create(json!({"title":"Kapalı konu","goal":""}))
        .unwrap()["topic"]["id"]
        .as_str()
        .unwrap()
        .to_owned();
    let decision = record(&mut d, &t, "decision", "Yapay karar");
    adopt(&mut d, &decision, "Yapay karar");
    record(&mut d, &t, "opinion", "Bekleyen görüş");
    record(&mut d, &t, "task", "Yapay iş");
    record(&mut d, &other, "task", "Gizli iş");
    assert!(tool_topics(&base).unwrap().is_empty());
    assert_eq!(tool_topic_text(&base, &t).unwrap(), None);
    assert!(
        d.tool_access_set(json!({"topicId":t,"read":true,"write":false,"confirmedByUser":false}))
            .is_err()
    );
    assert!(open(&mut d, &t, false, true).is_err(), "yazma tek başına açılamaz");
    assert!(open(&mut d, "missing", true, false).is_err());
    open(&mut d, &t, true, false).unwrap();
    let topics = tool_topics(&base).unwrap();
    assert_eq!(topics.len(), 1);
    assert_eq!((topics[0].open_tasks, topics[0].can_write), (1, false));
    let text = tool_topic_text(&base, &t).unwrap().unwrap();
    assert!(text.contains("[KULLANICININ BENİMSEDİĞİ KARAR]") && text.contains("Yapay karar"));
    assert!(text.contains("[AÇIK İŞ — KARAR DEĞİL]") && text.contains("Yapay iş"));
    assert!(!text.contains("Bekleyen görüş") && !text.contains("Gizli iş"));
    assert_eq!(tool_topic_text(&base, &other).unwrap(), None);
    assert!(
        tool_propose(&base, "Test", &t, "note", "Yapay not", None, None).is_err(),
        "okuma izni yazma izni değildir"
    );
    open(&mut d, &t, false, false).unwrap();
    assert!(tool_topics(&base).unwrap().is_empty());
    fs::remove_dir_all(base).ok();
}

#[test]
fn a_proposal_waits_in_the_inbox_and_becomes_a_pending_ai_record_only_when_accepted() {
    let (base, mut d, t) = setup();
    let task = record(&mut d, &t, "task", "Yapay iş");
    open(&mut d, &t, true, true).unwrap();
    let before = fs::read(base.join("conversations/records-v1.json")).unwrap();
    assert!(tool_propose(&base, "Test", &t, "plan", "x", None, None).is_err());
    assert!(tool_propose(&base, "Test", &t, "note", "", None, None).is_err());
    assert!(tool_propose(&base, "Test", &t, "note", "x", Some("missing"), None).is_err());
    assert!(tool_propose(&base, "Test", &t, "objection", "x", Some(&task), Some(&basis())).is_err());
    let first = tool_propose(&base, "Claude Code", &t, "note", "Yapay sonuç", Some(&task), None).unwrap();
    let second = tool_propose(&base, "Claude Code", &t, "task", "Önerilen iş", None, None).unwrap();
    assert_eq!(
        fs::read(base.join("conversations/records-v1.json")).unwrap(),
        before,
        "öneri defteri değiştirmez"
    );
    let view = d.inbox_view().unwrap();
    assert_eq!(view["items"].as_array().unwrap().len(), 2);
    assert_eq!(view["items"][0]["related"]["text"], "Yapay iş");
    assert!(
        d.inbox_accept(json!({"itemId":first,"confirmedByUser":false}))
            .is_err()
    );
    let accepted = d
        .inbox_accept(json!({"itemId":first,"confirmedByUser":true}))
        .unwrap();
    let r = &accepted["record"];
    assert_eq!(
        (r["attribution"].as_str(), r["review"].as_str(), r["adoption"].as_str()),
        (Some("assistant_proposal"), Some("pending"), Some("unknown"))
    );
    assert_eq!(r["source"]["kind"], "tool");
    assert_eq!(r["source"]["title"], "Claude Code");
    assert!(
        d.inbox_accept(json!({"itemId":first,"confirmedByUser":true}))
            .is_err(),
        "aynı öneri iki kez alınmaz"
    );
    d.inbox_dismiss(json!({"itemId":second,"confirmedByUser":true}))
        .unwrap();
    assert!(d.inbox_view().unwrap()["items"].as_array().unwrap().is_empty());
    let text = tool_topic_text(&base, &t).unwrap().unwrap();
    assert!(!text.contains("Yapay sonuç"), "incelenmemiş AI önerisi araca geri okutulmaz");
    drop(d);
    let d = Disk::open(base.join("conversations")).unwrap();
    assert!(d.inbox_view().unwrap()["items"].as_array().unwrap().is_empty());
    fs::remove_dir_all(base).ok();
}

#[test]
fn an_accepted_objection_hangs_under_the_position_as_a_suggested_placement() {
    let (base, mut d, t) = setup();
    let position = record(&mut d, &t, "opinion", "Yapay pozisyon");
    let entry = d
        .map_add(json!({"recordId":position,"section":"toplum","role":"position","confirmedByUser":true}))
        .unwrap()["entry"]["id"]
        .as_str()
        .unwrap()
        .to_owned();
    open(&mut d, &t, true, true).unwrap();
    let item = tool_propose(&base, "Test", &t, "objection", "Yapay itiraz", Some(&position), Some(&basis())).unwrap();
    let accepted = d
        .inbox_accept(json!({"itemId":item,"confirmedByUser":true}))
        .unwrap();
    let map = d.map_view().unwrap();
    let placed = map["entries"]
        .as_array()
        .unwrap()
        .iter()
        .find(|e| e["entry"]["id"] == accepted["mapEntryId"])
        .unwrap();
    assert_eq!(placed["entry"]["role"], "objection");
    assert_eq!(placed["entry"]["parentId"], entry.as_str());
    assert_eq!(placed["entry"]["placement"], "suggested");
    assert_eq!(placed["record"]["attribution"], "assistant_proposal");
    fs::remove_dir_all(base).ok();
}

#[test]
fn restore_closes_tool_access_and_unused_features_leave_store_bytes_unchanged() {
    let (base, mut d, t) = setup();
    record(&mut d, &t, "opinion", "Yapay görüş");
    let file = base.join("conversations/records-v1.json");
    let before = fs::read(&file).unwrap();
    open(&mut d, &t, true, true).unwrap();
    assert!(String::from_utf8_lossy(&fs::read(&file).unwrap()).contains("toolAccess"));
    let backup = d.backup().unwrap()["backupId"].as_str().unwrap().to_owned();
    let state = d.list().unwrap()["stateHash"].as_str().unwrap().to_owned();
    let restored = d
        .restore(
            json!({"backupId":backup,"expectedStateHash":state,"confirmedByUser":true}),
            &BTreeMap::new(),
        )
        .unwrap();
    assert_eq!(restored["toolSharingClosed"], 1);
    assert!(tool_topics(&base).unwrap().is_empty());
    assert_eq!(fs::read(&file).unwrap(), before);
    fs::remove_dir_all(base).ok();
}

#[test]
fn opening_all_topics_covers_existing_ones_only_and_closing_all_removes_every_permission() {
    let (base, mut d, t) = setup();
    let other = d
        .topic_create(json!({"title":"İkinci konu","goal":""}))
        .unwrap()["topic"]["id"]
        .as_str()
        .unwrap()
        .to_owned();
    assert!(d
        .tool_access_set_all(json!({"read":true,"write":false,"confirmedByUser":false}))
        .is_err());
    assert!(
        d.tool_access_set_all(json!({"read":false,"write":true,"confirmedByUser":true}))
            .is_err(),
        "yazma tek başına açılamaz"
    );
    let result = d
        .tool_access_set_all(json!({"read":true,"write":true,"confirmedByUser":true}))
        .unwrap();
    assert_eq!(result["topics"], 2);
    let topics = tool_topics(&base).unwrap();
    assert_eq!(topics.len(), 2);
    assert!(topics.iter().all(|x| x.can_write));
    let later = d
        .topic_create(json!({"title":"Sonra açılan","goal":""}))
        .unwrap()["topic"]["id"]
        .as_str()
        .unwrap()
        .to_owned();
    assert_eq!(tool_topic_text(&base, &later).unwrap(), None, "yeni konu kapalı başlar");
    d.tool_access_set_all(json!({"read":true,"write":false,"confirmedByUser":true}))
        .unwrap();
    let topics = tool_topics(&base).unwrap();
    assert_eq!(topics.len(), 3);
    assert!(topics.iter().all(|x| !x.can_write));
    assert!(tool_propose(&base, "Test", &other, "note", "Yapay not", None, None).is_err());
    d.tool_access_set_all(json!({"read":false,"write":false,"confirmedByUser":true}))
        .unwrap();
    assert!(tool_topics(&base).unwrap().is_empty());
    assert_eq!(tool_topic_text(&base, &t).unwrap(), None);
    fs::remove_dir_all(base).ok();
}

#[test]
fn a_connected_tool_never_sees_a_record_in_the_trash() {
    let (base, mut d, t) = setup();
    let decision = record(&mut d, &t, "decision", "Silinecek karar");
    adopt(&mut d, &decision, "Silinecek karar");
    let task = record(&mut d, &t, "task", "Silinecek iş");
    open(&mut d, &t, true, true).unwrap();
    assert!(tool_topic_text(&base, &t).unwrap().unwrap().contains("Silinecek karar"));
    d.trash(json!({"id":decision,"confirmedByUser":true})).unwrap();
    d.trash(json!({"id":task,"confirmedByUser":true})).unwrap();
    let text = tool_topic_text(&base, &t).unwrap().unwrap();
    assert!(!text.contains("Silinecek karar") && !text.contains("Silinecek iş"));
    assert_eq!(tool_topics(&base).unwrap()[0].open_tasks, 0);
    assert!(tool_propose(&base, "Test", &t, "objection", "Yapay itiraz", Some(&decision), Some(&basis())).is_err());
    fs::remove_dir_all(base).ok();
}

/// Rewrite the store file as a newer töre might have written it.
fn edit_store(base: &Path, change: impl FnOnce(&mut Value)) {
    let file = base.join("conversations/records-v1.json");
    let mut v: Value = serde_json::from_slice(&fs::read(&file).unwrap()).unwrap();
    change(&mut v);
    fs::write(&file, serde_json::to_vec(&v).unwrap()).unwrap();
}

#[test]
fn a_record_from_a_newer_toere_is_hidden_and_the_rest_of_the_notebook_stays_readable() {
    let (base, mut d, t) = setup();
    let other = d
        .topic_create(json!({"title":"Yapay ikinci konu","goal":""}))
        .unwrap()["topic"]["id"]
        .as_str()
        .unwrap()
        .to_owned();
    let kept = record(&mut d, &t, "decision", "Yapay görünen karar");
    adopt(&mut d, &kept, "Yapay görünen karar");
    let future = record(&mut d, &t, "decision", "Yapay yeni alanlı karar");
    adopt(&mut d, &future, "Yapay yeni alanlı karar");
    let new_kind = record(&mut d, &t, "decision", "Yapay yeni türlü karar");
    adopt(&mut d, &new_kind, "Yapay yeni türlü karar");
    let question = record(&mut d, &t, "question", "Yapay okunamayan soru");
    let answer = d
        .record_create(
            json!({"topicId":t,"kind":"opinion","text":"Yapay yanıt","reason":"","answersQuestionId":question}),
            &BTreeMap::new(),
        )
        .unwrap()["record"]["id"]
        .as_str()
        .unwrap()
        .to_owned();
    let trashed = record(&mut d, &t, "task", "Yapay çöpteki iş");
    let task = record(&mut d, &t, "task", "Yapay açık iş");
    d.trash(json!({"id":trashed,"confirmedByUser":true})).unwrap();
    open(&mut d, &t, true, true).unwrap();
    open(&mut d, &other, true, false).unwrap();
    drop(d);
    edit_store(&base, |v| {
        v["records"][&future]["futureField"] = json!("yapay");
        v["records"][&new_kind]["kind"] = json!("goal");
        v["records"][&question]["futureField"] = json!(1);
        v["futureSection"] = json!({"x":1});
        v["toolAccess"][&other]["futureFlag"] = json!(true);
    });

    // The writer stays strict, so an older töre never drops what it does not know.
    assert!(Disk::open(base.join("conversations")).is_err());

    let topics = tool_topics(&base).unwrap();
    assert_eq!(topics.len(), 1, "an unreadable permission counts as closed");
    assert_eq!(topics[0].id, t);
    assert_eq!(topics[0].open_tasks, 1);
    assert_eq!(topics[0].open_questions, 0);
    assert_eq!(tool_topic_text(&base, &other).unwrap(), None);

    let text = tool_topic_text(&base, &t).unwrap().unwrap();
    assert!(text.contains("Yapay görünen karar") && text.contains("Yapay açık iş"));
    for hidden in ["yeni alanlı", "yeni türlü", "okunamayan soru", "çöpteki iş"] {
        assert!(!text.contains(hidden), "{hidden} must stay hidden");
    }
    assert!(text.contains("NOTE: 4 record(s) in this topic could not be read"));
    assert!(text.contains("reconnect this connector in their AI tool"));
    assert!(!text.contains("Claude") && !text.contains("/mcp"));
    assert!(!text.contains("futureField") && !text.contains("yapay\""));

    assert!(tool_propose(&base, "Test", &t, "note", "Yapay not", Some(&task), None).is_ok());
    for id in [&future, &new_kind, &question, &answer, &trashed] {
        assert!(tool_propose(&base, "Test", &t, "note", "Yapay not", Some(id), None).is_err());
    }
    assert!(tool_propose(&base, "Test", &other, "note", "Yapay not", None, None).is_err());
    fs::remove_dir_all(base).ok();
}

#[test]
fn a_whole_notebook_from_a_newer_schema_or_a_broken_file_is_refused_with_a_reason() {
    let (base, mut d, t) = setup();
    open(&mut d, &t, true, false).unwrap();
    drop(d);
    edit_store(&base, |v| v["schemaVersion"] = json!(2));
    let e = tool_topics(&base).unwrap_err();
    assert!(e.contains("schemaVersion 2") && e.contains("daha yeni"));
    fs::write(base.join("conversations/records-v1.json"), b"{\"schemaVersion\":1,").unwrap();
    let e = tool_topics(&base).unwrap_err();
    assert!(e.contains("line 1"), "{e}");
    fs::remove_dir_all(base).ok();
}
