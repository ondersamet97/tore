use super::super::super::types::Message;
use super::*;
use std::{fs, path::PathBuf};
fn temp() -> PathBuf {
    std::env::temp_dir()
        .canonicalize()
        .unwrap()
        .join(format!("tore-organize-{}", id()))
}
fn message(mid: &str, parent: Option<&str>, role: &str, text: &str) -> Message {
    Message {
        id: mid.into(),
        source_id: mid.into(),
        parent_id: parent.map(str::to_owned),
        role: role.into(),
        phase: None,
        text: text.into(),
        attachments: vec![],
        timestamp: Some("2026-01-01T00:00:00Z".into()),
        source_locator: "/synthetic/not-exported".into(),
        authorship_status: "unreviewed".into(),
        model: None,
    }
}
fn conversation(cid: &str, title: &str) -> Conversation {
    Conversation {
        schema_version: 1,
        id: cid.into(),
        provider: "synthetic".into(),
        source_app: "synthetic".into(),
        source_conversation_id: cid.into(),
        title: title.into(),
        created_at: None,
        updated_at: None,
        selected_leaf_id: Some("u".into()),
        messages: vec![message(
            "u",
            None,
            "user",
            "SENTETİK: açmaya karar verdim. Ne zaman bitireceğiz?",
        )],
        warnings: vec![],
    }
}
fn setup(d: &mut Disk, cs: &BTreeMap<String, Conversation>) {
    let p = d.bulk_preview(cs).unwrap();
    d.bulk_apply(
        json!({"previewHash":p["previewHash"],"confirmedByUser":true}),
        cs,
    )
    .unwrap();
    let mut next = d.data.clone();
    next.topics.entry(OTHER.into()).or_insert(Topic {
        id: OTHER.into(),
        title: "Diğer konuşmalar".into(),
        goal: String::new(),
        created_at: now(),
        creation_request_hash: "synthetic".into(),
    });
    for l in next.conversation_links.values_mut() {
        l.topic_id = OTHER.into();
    }
    for r in next.records.values_mut() {
        r.topic_id = OTHER.into();
    }
    d.commit(next).unwrap();
}
fn apply(d: &mut Disk, cs: &BTreeMap<String, Conversation>) -> Value {
    let p = d.organize_preview(cs).unwrap();
    d.organize_apply(
        json!({"previewHash":p["previewHash"],"confirmedByUser":true}),
        cs,
    )
    .unwrap()
}
fn review_input(r: &Record, topic: Option<&str>) -> Value {
    json!({"id":r.id,"expectedRevision":r.revision,"expectedTopicId":topic,"text":r.text,"reason":r.reason,"review":"reviewed","adoption":if r.kind=="question"{"not_applicable"}else{"adopted"},"currency":"current","priority":"active","questionState":r.question_state,"changeReason":"SENTETİK açık inceleme","confirmedByUser":true})
}
fn without_topic(r: &Record) -> Value {
    let mut v = serde_json::to_value(r).unwrap();
    v.as_object_mut().unwrap().remove("topicId");
    v
}
#[test]
fn broad_topics_are_explainable_and_titles_remain_exact() {
    for (title, expected) in [
        ("Rust compile error", "ai_tools"),
        ("Arkadaşlık ve yalnızlık", "personal"),
        ("E-posta yanıt taslağı", "communication"),
        ("Haftalık yemek tarifi", "everyday"),
        ("Otobüs biletleri", "travel"),
        ("Kitaplık ve okuma", "learning"),
        ("İnsanlığın geleceği ve demokrasi", "ideology"),
        ("Kuantum ve entropi", "science"),
        ("Uyku ve egzersiz", "health"),
        ("Orta çağ imparatorlukları", "history"),
        ("MVP yol haritası", "products"),
        ("Takvim hatırlatıcı", "planning"),
        ("Logo renk paleti", "creative"),
        ("Steam oyun önerileri", "games"),
        ("Notion arşiv düzeni", "archives"),
    ] {
        let c = conversation("c", title);
        let v = visible(&c);
        let result = classify(&c, &v);
        assert_eq!(result.0, expected, "synthetic title: {title}; {}", result.2);
        assert_eq!(subtopic(&c, &v), title);
    }
    assert_ne!(
        classify(&conversation("c", "Başvuru tarihi"), &[]).0,
        "history"
    );
    assert_eq!(
        classify(&conversation("c", "Restore archive store"), &[]).0,
        "cross_domain"
    );
    assert_eq!(
        classify(&conversation("c", "Python ve otel"), &[]).0,
        "cross_domain"
    );
}
#[test]
fn only_visible_selected_user_context_can_supply_a_theme_or_subtitle() {
    let mut c = conversation("c", "New chat");
    c.messages[0].text = "Bana otel ve uçak bileti seçeneklerini anlat.".into();
    c.messages.push(message(
        "a",
        Some("u"),
        "assistant",
        "Steam oyun playstation nintendo xbox",
    ));
    c.messages.push(message(
        "other",
        Some("u"),
        "user",
        "Kuantum fizik matematik bilim araştırması",
    ));
    c.selected_leaf_id = Some("a".into());
    assert_eq!(classify(&c, &visible(&c)).0, "travel");
    assert_eq!(subtopic(&c, &visible(&c)), c.messages[0].text);
    c.selected_leaf_id = None;
    assert!(visible(&c).is_empty());
    assert_eq!(classify(&c, &visible(&c)).0, "limited_context");
    c.selected_leaf_id = Some("other".into());
    c.messages[2].phase = Some("analysis".into());
    c.messages[0].text = "# AGENTS.md instructions\nPython Rust compile software".into();
    assert!(visible(&c).is_empty());
}
#[test]
fn organization_preserves_every_record_field_and_moves_manual_sourced_records_together() {
    let p = temp();
    let mut d = Disk::open(p.clone()).unwrap();
    let cs = BTreeMap::from([("c".into(), conversation("c", "Hotel and flight"))]);
    setup(&mut d, &cs);
    let r = d
        .data
        .records
        .values()
        .find(|r| r.kind == "decision")
        .unwrap()
        .clone();
    d.review(review_input(&r, Some(OTHER))).unwrap();
    d.record_create(json!({"topicId":OTHER,"kind":"opinion","text":"SENTETİK elle eklenen yorum","source":{"conversationId":"c","messageId":"u","excerpt":"açmaya karar verdim."}}),&cs).unwrap();
    let before = d.data.clone();
    let source_hash = hash(&cs).unwrap();
    let backup_count = d.backups().unwrap().len();
    let preview = d.organize_preview(&cs).unwrap();
    assert_eq!(preview["conversationCount"], 1);
    assert_eq!(preview["recordMoveCount"], before.records.len());
    let result = apply(&mut d, &cs);
    assert_eq!(result["moved"], 1);
    assert_eq!(result["subtopicsUpdated"], 1);
    assert_eq!(d.data.records.len(), before.records.len());
    assert_eq!(d.data.topics[OTHER].title, before.topics[OTHER].title);
    for (id, r) in &d.data.records {
        assert_eq!(r.topic_id, "bulk-topic-travel");
        assert_eq!(without_topic(r), without_topic(&before.records[id]));
    }
    let after_link = &d.data.conversation_links["c"];
    assert_eq!(
        after_link.subtopic_title.as_deref(),
        Some("Hotel and flight")
    );
    let mut before_link = serde_json::to_value(&before.conversation_links["c"]).unwrap();
    let mut after_link = serde_json::to_value(after_link).unwrap();
    for field in ["topicId", "subtopicTitle", "classificationReason"] {
        before_link.as_object_mut().unwrap().remove(field);
        after_link.as_object_mut().unwrap().remove(field);
    }
    assert_eq!(before_link, after_link);
    assert_eq!(hash(&cs).unwrap(), source_hash);
    assert_eq!(d.backups().unwrap().len(), backup_count + 1);
    let state = d.list().unwrap();
    assert_eq!(
        state["organizationReceipts"][0]["changes"][0]["recordIds"]
            .as_array()
            .unwrap()
            .len(),
        before.records.len()
    );
    assert!(!state.to_string().contains("/synthetic/not-exported"));
    assert!(
        d.review(review_input(&d.data.records[&r.id], Some(OTHER)))
            .unwrap_err()
            .contains("konusu değişmiş")
    );
    drop(d);
    let reopened = Disk::open(p.clone()).unwrap();
    assert_eq!(reopened.list().unwrap()["stateHash"], state["stateHash"]);
    drop(reopened);
    fs::remove_dir_all(p).unwrap();
}
#[test]
fn packets_and_cross_group_questions_keep_their_topic_but_receive_subtopics() {
    let p = temp();
    let mut d = Disk::open(p.clone()).unwrap();
    let cs = BTreeMap::from([
        ("c".into(), conversation("c", "Hotel and flight")),
        ("other".into(), conversation("other", "Coffee recipe")),
    ]);
    setup(&mut d, &cs);
    let r = d
        .data
        .records
        .values()
        .find(|r| {
            r.source.as_ref().unwrap().conversation_id.as_deref() == Some("c")
                && r.kind == "decision"
        })
        .unwrap()
        .clone();
    d.review(review_input(&r, Some(OTHER))).unwrap();
    d.prepare(
        json!({"topicId":OTHER,"recordIds":[r.id],"target":"chatgpt","confirmedByUser":true}),
    )
    .unwrap();
    let before = d.data.clone();
    let preview = d.organize_preview(&cs).unwrap();
    assert_eq!(preview["retainedDependencyCount"], 1);
    let result = apply(&mut d, &cs);
    assert_eq!(result["moved"], 1);
    assert_eq!(result["subtopicsUpdated"], 2);
    assert_eq!(
        hash(&before.packets).unwrap(),
        hash(&d.data.packets).unwrap()
    );
    assert_eq!(d.data.conversation_links["c"].topic_id, OTHER);
    assert!(d.data.conversation_links["c"].subtopic_title.is_some());
    assert_eq!(
        hash(&before.records[&r.id]).unwrap(),
        hash(&d.data.records[&r.id]).unwrap()
    );
    drop(d);
    fs::remove_dir_all(p).unwrap();
    let p = temp();
    let mut d = Disk::open(p.clone()).unwrap();
    setup(&mut d, &cs);
    let mut next = d.data.clone();
    let q = next
        .records
        .values()
        .find(|r| {
            r.kind == "question"
                && r.source.as_ref().unwrap().conversation_id.as_deref() == Some("other")
        })
        .unwrap()
        .id
        .clone();
    let response = next
        .records
        .values_mut()
        .find(|r| {
            r.kind == "decision"
                && r.source.as_ref().unwrap().conversation_id.as_deref() == Some("c")
        })
        .unwrap();
    response.answers_question_id = Some(q);
    d.commit(next).unwrap();
    let before = hash(&d.data.records).unwrap();
    let preview = d.organize_preview(&cs).unwrap();
    assert_eq!(preview["retainedDependencyCount"], 2);
    let result = apply(&mut d, &cs);
    assert_eq!(result["moved"], 0);
    assert_eq!(result["subtopicsUpdated"], 2);
    assert_eq!(hash(&d.data.records).unwrap(), before);
    drop(d);
    fs::remove_dir_all(p).unwrap();
}
#[test]
fn consent_staleness_no_op_and_retry_do_not_duplicate_or_overwrite_review() {
    let p = temp();
    let mut d = Disk::open(p.clone()).unwrap();
    let cs = BTreeMap::from([("c".into(), conversation("c", "Hotel and flight"))]);
    setup(&mut d, &cs);
    let preview = d.organize_preview(&cs).unwrap();
    let original = hash(&d.data).unwrap();
    assert!(
        d.organize_apply(
            json!({"previewHash":preview["previewHash"],"confirmedByUser":false}),
            &cs
        )
        .is_err()
    );
    assert_eq!(hash(&d.data).unwrap(), original);
    let stale = preview["previewHash"].clone();
    d.topic_create(json!({"title":"SENTETİK başka konu"}))
        .unwrap();
    assert!(
        d.organize_apply(json!({"previewHash":stale,"confirmedByUser":true}), &cs)
            .is_err()
    );
    let preview = d.organize_preview(&cs).unwrap();
    let mut changed = cs.clone();
    changed.get_mut("c").unwrap().title.push_str(" changed");
    assert!(
        d.organize_apply(
            json!({"previewHash":preview["previewHash"],"confirmedByUser":true}),
            &changed
        )
        .is_err()
    );
    let result = d
        .organize_apply(
            json!({"previewHash":preview["previewHash"],"confirmedByUser":true}),
            &cs,
        )
        .unwrap();
    let r = d.data.records.values().next().unwrap().clone();
    d.review(review_input(&r, Some(&r.topic_id))).unwrap();
    let edited = hash(&d.data).unwrap();
    let backups = d.backups().unwrap().len();
    let retry = d
        .organize_apply(
            json!({"previewHash":preview["previewHash"],"confirmedByUser":true}),
            &cs,
        )
        .unwrap();
    assert_eq!(retry["alreadyApplied"], true);
    assert_eq!(retry["backupId"], result["backupId"]);
    assert_eq!(hash(&d.data).unwrap(), edited);
    assert_eq!(d.organize_preview(&cs).unwrap()["conversationCount"], 0);
    let no_op = apply(&mut d, &cs);
    assert_eq!(no_op["subtopicsUpdated"], 0);
    assert_eq!(d.backups().unwrap().len(), backups);
    drop(d);
    fs::remove_dir_all(p).unwrap();
}
#[test]
fn old_backup_without_optional_fields_restores_exactly_and_new_imports_remain_eligible() {
    let p = temp();
    let mut d = Disk::open(p.clone()).unwrap();
    let mut cs = BTreeMap::from([("c".into(), conversation("c", "Hotel and flight"))]);
    setup(&mut d, &cs);
    let original = hash(&d.data).unwrap();
    let backup = d.backup().unwrap();
    let bytes = fs::read_to_string(
        p.join("records-backups")
            .join(format!("{}.json", backup["backupId"].as_str().unwrap())),
    )
    .unwrap();
    assert!(!bytes.contains("organizationReceipts"));
    assert!(!bytes.contains("subtopicTitle"));
    apply(&mut d, &cs);
    let current = hash(&d.data).unwrap();
    d.restore(
        json!({"backupId":backup["backupId"],"expectedStateHash":current,"confirmedByUser":true}),
        &cs,
    )
    .unwrap();
    assert_eq!(hash(&d.data).unwrap(), original);
    apply(&mut d, &cs);
    cs.insert("new".into(), conversation("new", "Work permit checklist"));
    let bulk = d.bulk_preview(&cs).unwrap();
    d.bulk_apply(
        json!({"previewHash":bulk["previewHash"],"confirmedByUser":true}),
        &cs,
    )
    .unwrap();
    assert_eq!(d.organize_preview(&cs).unwrap()["conversationCount"], 1);
    apply(&mut d, &cs);
    assert_eq!(d.data.organization_receipts.len(), 2);
    drop(d);
    fs::remove_dir_all(p).unwrap();
}
#[test]
fn scope_capacity_and_duplicate_titles_are_safe() {
    let p = temp();
    let mut d = Disk::open(p.clone()).unwrap();
    let cs = BTreeMap::from([
        ("a".into(), conversation("a", "Hotel and flight")),
        ("b".into(), conversation("b", "Hotel and flight")),
        ("keep".into(), conversation("keep", "Töre demo")),
    ]);
    setup(&mut d, &cs);
    let mut next = d.data.clone();
    next.conversation_links.get_mut("keep").unwrap().topic_id = "bulk-topic-tore".into();
    for r in next
        .records
        .values_mut()
        .filter(|r| r.source.as_ref().unwrap().conversation_id.as_deref() == Some("keep"))
    {
        r.topic_id = "bulk-topic-tore".into();
    }
    d.commit(next).unwrap();
    let keep = hash(&d.data.conversation_links["keep"]).unwrap();
    let preview = d.organize_preview(&cs).unwrap();
    assert_eq!(preview["conversationCount"], 2);
    apply(&mut d, &cs);
    assert_eq!(hash(&d.data.conversation_links["keep"]).unwrap(), keep);
    assert_eq!(
        d.data.conversation_links["a"].subtopic_title,
        d.data.conversation_links["b"].subtopic_title
    );
    assert_eq!(d.data.conversation_links.len(), 3);
    drop(d);
    fs::remove_dir_all(p).unwrap();
    let p = temp();
    let mut d = Disk::open(p.clone()).unwrap();
    setup(
        &mut d,
        &BTreeMap::from([("a".into(), conversation("a", "Hotel and flight"))]),
    );
    let mut next = d.data.clone();
    for n in next.topics.len()..200 {
        let id = format!("synthetic-{n}");
        next.topics.insert(
            id.clone(),
            Topic {
                id,
                title: "SENTETİK".into(),
                goal: String::new(),
                created_at: now(),
                creation_request_hash: "synthetic".into(),
            },
        );
    }
    d.commit(next).unwrap();
    let state = hash(&d.data).unwrap();
    assert!(d.organize_preview(&cs).unwrap_err().contains("200"));
    assert_eq!(hash(&d.data).unwrap(), state);
    drop(d);
    fs::remove_dir_all(p).unwrap();
}

#[test]
fn missing_sources_weak_hints_and_shared_local_phrases_remain_honest() {
    let mut c = conversation("empty", "Haftalık plan");
    c.messages.clear();
    c.selected_leaf_id = None;
    assert_eq!(classify(&c, &visible(&c)).0, "incomplete_sources");
    let mut c = conversation("weak", "Konuşma başlığı önerisi");
    c.messages[0].text = "Otel hakkında ne gerekiyor?".into();
    let selected = visible(&c);
    let result = classify(&c, &selected);
    assert_eq!(result.0, "travel");
    assert!(result.2.contains("Zayıf"));
    assert_eq!(subtopic(&c, &selected), c.messages[0].text);
    let p = temp();
    let mut d = Disk::open(p.clone()).unwrap();
    let cs = BTreeMap::from([
        ("a".into(), conversation("a", "Crystal garden alpha")),
        ("b".into(), conversation("b", "Crystal garden beta")),
        ("solo".into(), conversation("solo", "Velmora zefiran")),
    ]);
    setup(&mut d, &cs);
    let before = d.organize_preview(&cs).unwrap();
    let changes = before["changes"].as_array().unwrap();
    let a = changes.iter().find(|c| c["conversationId"] == "a").unwrap();
    let b = changes.iter().find(|c| c["conversationId"] == "b").unwrap();
    let solo = changes
        .iter()
        .find(|c| c["conversationId"] == "solo")
        .unwrap();
    assert!(
        a["toTopicId"]
            .as_str()
            .unwrap()
            .starts_with("bulk-topic-cluster-")
    );
    assert_eq!(a["toTopicId"], b["toTopicId"]);
    assert_eq!(solo["toTopicId"], "bulk-topic-source_topics");
    assert_eq!(a["subtopicTitle"], "Crystal garden alpha");
    assert_eq!(b["subtopicTitle"], "Crystal garden beta");
    apply(&mut d, &cs);
    assert!(
        d.data
            .topics
            .values()
            .any(|t| t.title == "“Crystal garden” çevresindeki konuşmalar")
    );
    assert_eq!(d.data.records.len(), 6);
    drop(d);
    fs::remove_dir_all(p).unwrap();
}
