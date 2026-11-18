//! Reports and surpassed thoughts, with synthetic (SENTETİK) data only.
use super::super::types::Message;
use super::reports::{ProviderOutput, REPORT_TOPIC_ID, run_report_provider};
use super::*;

fn disk() -> Disk {
    let root = std::env::temp_dir()
        .canonicalize()
        .unwrap()
        .join(format!("tore-reports-{}", id()));
    Disk::open(root).unwrap()
}

/// SENTETİK: a short conversation in which the person changes their mind.
fn conversation() -> Conversation {
    let mut c = Conversation {
        schema_version: 1,
        id: "conv-synthetic".into(),
        provider: "generic".into(),
        source_app: "Claude Code".into(),
        source_conversation_id: "claude-code-00000000-0000-4000-8000-000000000001".into(),
        title: "SENTETİK konuşma".into(),
        created_at: Some("2026-01-01T10:00:00Z".into()),
        updated_at: Some("2026-01-01T10:30:00Z".into()),
        selected_leaf_id: None,
        messages: vec![],
        warnings: vec![],
    };
    let turns = [
        (
            "m1",
            "user",
            "Bence bahçe herkese açık olmalı.",
            "2026-01-01T10:00:00Z",
        ),
        (
            "m2",
            "assistant",
            "Neden açık olmalı?",
            "2026-01-01T10:01:00Z",
        ),
        (
            "m3",
            "user",
            "Artık bahçenin yalnız gündüz açık olması gerektiğini düşünüyorum. Parolam: abc12345",
            "2026-01-01T10:10:00Z",
        ),
        (
            "m4",
            "user",
            "Karar verdim: kütüphane haftada bir gün açılacak.",
            "2026-01-01T10:20:00Z",
        ),
        (
            "m5",
            "user",
            "Belki komşulara da sorarız, karar vermedim.",
            "2026-01-01T10:30:00Z",
        ),
    ];
    for (id, role, text, time) in turns {
        c.messages.push(Message {
            id: id.into(),
            source_id: id.into(),
            parent_id: None,
            role: role.into(),
            phase: None,
            text: text.into(),
            attachments: vec![],
            timestamp: Some(time.into()),
            source_locator: "synthetic".into(),
            authorship_status: "unreviewed".into(),
            model: None,
        });
    }
    c
}

fn conversations() -> BTreeMap<String, Conversation> {
    let c = conversation();
    BTreeMap::from([(c.id.clone(), c)])
}

fn output(items: Value) -> ProviderOutput {
    ProviderOutput {
        text: format!("```json\n{}\n```", json!({ "items": items })),
        provider: "custom".into(),
        version: "test".into(),
    }
}

/// A report with five proposals: two pass, three are thrown away.
fn report(d: &mut Disk) -> Value {
    let draft = d
        .report_draft(conversation(), "-synthetic-garden".into())
        .unwrap();
    assert!(draft.prompt.contains("[1|P|2026-01-01T10:00] Bence bahçe"));
    assert!(draft.prompt.contains("ONLY one JSON object"));
    let items = json!([
        {"kind":"decision","text":"Kütüphane haftada bir gün açılır.","reason":"Açık karar.","turn":4,
         "excerpt":"kütüphane haftada bir gün açılacak","section":"toplum","supersedes":null,"fromPasted":true},
        {"kind":"opinion","text":"Bahçe yalnız gündüz açık olmalı.","reason":"Görüş değişti.","turn":3,
         "excerpt":"Artık bahçenin yalnız gündüz açık olması gerektiğini düşünüyorum.","section":"bogus",
         "supersedes":{"earlierTurn":1,"earlierExcerpt":"Bence bahçe herkese açık olmalı."}},
        {"kind":"opinion","text":"Uydurma","reason":"","turn":1,"excerpt":"bu cümle konuşmada yok"},
        {"kind":"opinion","text":"Parola","reason":"","turn":3,"excerpt":"Parolam: abc12345"},
        {"kind":"decision","text":"Asistan sözü","reason":"","turn":2,"excerpt":"Neden açık olmalı?"}
    ]);
    d.report_save(draft, output(items)).unwrap()["report"].clone()
}

#[test]
fn report_keeps_only_exact_quotes_of_the_person_and_drops_secrets() {
    let mut d = disk();
    let r = report(&mut d);
    assert_eq!(r["items"].as_array().unwrap().len(), 2);
    assert_eq!(r["dropped"], 3);
    assert_eq!(r["items"][0]["messageId"], "m4");
    assert_eq!(r["items"][0]["timestamp"], "2026-01-01T10:20:00Z");
    assert_eq!(
        r["items"][1]["section"], "baslangic",
        "unknown section falls back"
    );
    assert_eq!(r["items"][1]["supersedes"]["earlierMessageId"], "m1");
    assert!(
        d.list().unwrap()["records"].as_array().unwrap().is_empty(),
        "nothing is added yet"
    );
    assert_eq!(d.reports_view().unwrap()["waitingCount"], 2);
}

#[test]
fn deciding_adds_adopts_and_places_or_archives_one_item_at_a_time() {
    let mut d = disk();
    let r = report(&mut d);
    let rid = r["id"].as_str().unwrap();
    let decide = |decision: &str, item: &str| json!({"reportId":rid,"itemId":item,"decision":decision,"confirmedByUser":true});
    let mut unconfirmed = decide("added", "item-1");
    unconfirmed["confirmedByUser"] = json!(false);
    assert!(d.report_decide(unconfirmed, &conversations()).is_err());
    assert_eq!(
        d.report_decide(decide("later", "item-1"), &conversations())
            .unwrap()["changed"],
        false
    );
    let added = d
        .report_decide(decide("added", "item-1"), &conversations())
        .unwrap();
    let rec = &added["record"];
    assert_eq!(rec["topicId"], REPORT_TOPIC_ID);
    assert_eq!(
        (
            rec["review"].as_str(),
            rec["adoption"].as_str(),
            rec["currency"].as_str()
        ),
        (Some("reviewed"), Some("adopted"), Some("current"))
    );
    assert_eq!(rec["source"]["messageId"], "m4");
    assert_eq!(rec["attribution"], "user_interpretation");
    let map = d.map_view().unwrap();
    assert_eq!(map["entries"][0]["entry"]["section"], "toplum");
    assert_eq!(map["entries"][0]["entry"]["role"], "position");
    assert_eq!(
        map["lastDiscussedEntryId"],
        map["entries"][0]["entry"]["id"]
    );
    assert!(
        d.report_decide(decide("declined", "item-1"), &conversations())
            .is_err(),
        "decided once"
    );
    let declined = d
        .report_decide(decide("declined", "item-2"), &conversations())
        .unwrap();
    assert_eq!(declined["record"]["review"], "rejected");
    assert_eq!(declined["record"]["adoption"], "not_adopted");
    let view = d.superseded_view().unwrap();
    assert_eq!(view["declined"].as_array().unwrap().len(), 1);
    assert!(view["surpassed"].as_array().unwrap().is_empty());
    assert_eq!(
        d.map_view().unwrap()["entries"].as_array().unwrap().len(),
        1,
        "declined is not on the map"
    );
    assert_eq!(d.reports_view().unwrap()["waitingCount"], 0);
}

#[test]
fn hypothesis_and_declined_with_the_thought_that_went_beyond_it() {
    let mut d = disk();
    let r = report(&mut d);
    let rid = r["id"].as_str().unwrap();
    let hyp = d
        .report_decide(json!({"reportId":rid,"itemId":"item-1","decision":"hypothesis","confirmedByUser":true}), &conversations())
        .unwrap();
    assert_eq!(hyp["record"]["adoption"], "hypothesis");
    let by = hyp["record"]["id"].as_str().unwrap();
    let declined = d
        .report_decide(
            json!({"reportId":rid,"itemId":"item-2","decision":"declined","supersededBy":by,
            "reason":"SENTETİK gerekçe","confirmedByUser":true}),
            &conversations(),
        )
        .unwrap();
    assert_eq!(declined["record"]["supersededBy"], by);
    assert_eq!(declined["record"]["currency"], "superseded");
    let entry = &d.map_view().unwrap()["entries"][0];
    assert_eq!(entry["predecessors"][0]["id"], declined["record"]["id"]);
    assert_eq!(
        entry["predecessors"][0]["supersessionReason"],
        "SENTETİK gerekçe"
    );
    assert_eq!(d.superseded_view().unwrap()["declined"][0]["by"]["id"], by);
}

#[test]
fn a_new_thought_takes_the_place_of_the_one_it_goes_beyond() {
    let mut d = disk();
    let r = report(&mut d);
    let rid = r["id"].as_str().unwrap();
    let old = d
        .report_decide(
            json!({"reportId":rid,"itemId":"item-1","decision":"added","confirmedByUser":true}),
            &conversations(),
        )
        .unwrap()["record"]
        .clone();
    let old_id = old["id"].as_str().unwrap();
    let entry_id = d.map_view().unwrap()["entries"][0]["entry"]["id"].clone();
    let new = d
        .report_decide(
            json!({"reportId":rid,"itemId":"item-2","decision":"added","supersedes":old_id,
            "reason":"Fikrim değişti","confirmedByUser":true}),
            &conversations(),
        )
        .unwrap()["record"]
        .clone();
    let list = d.list().unwrap();
    let stored_old = list["records"]
        .as_array()
        .unwrap()
        .iter()
        .find(|x| x["id"] == old["id"])
        .unwrap()
        .clone();
    assert_eq!(stored_old["currency"], "superseded");
    assert_eq!(stored_old["supersededBy"], new["id"]);
    assert_eq!(
        stored_old["revision"], 2,
        "history keeps the previous state"
    );
    let map = d.map_view().unwrap();
    let entries = map["entries"].as_array().unwrap();
    assert_eq!(entries.len(), 1, "the place passes to the newer thought");
    assert_eq!(entries[0]["entry"]["id"], entry_id);
    assert_eq!(entries[0]["record"]["id"], new["id"]);
    assert_eq!(entries[0]["predecessors"][0]["id"], old["id"]);
    assert_eq!(
        d.superseded_view().unwrap()["surpassed"][0]["by"]["id"],
        new["id"]
    );
    // History is kept: neither side can be purged.
    d.trash(json!({"id":old_id,"confirmedByUser":true}))
        .unwrap();
    assert!(
        d.purge(json!({"id":old_id,"confirmedByUser":true}))
            .is_err()
    );
    // Reviewing it back to current clears the link.
    d.untrash(json!({"id":old_id,"confirmedByUser":true}))
        .unwrap();
    let mut back = d.list().unwrap()["records"]
        .as_array()
        .unwrap()
        .iter()
        .find(|x| x["id"] == old["id"])
        .unwrap()
        .clone();
    let input = json!({"id":old_id,"expectedRevision":back["revision"],"text":back["text"],"reason":back["reason"],
        "review":"reviewed","adoption":"adopted","currency":"current","priority":"unspecified",
        "questionState":"not_applicable","changeReason":"SENTETİK: geri aldım","confirmedByUser":true});
    back = d.review(input).unwrap()["record"].clone();
    assert!(back.get("supersededBy").is_none());
}

#[test]
fn supersede_needs_consent_and_an_active_newer_thought() {
    let mut d = disk();
    let t = d.topic_create(json!({"title":"SENTETİK"})).unwrap()["topic"]["id"]
        .as_str()
        .unwrap()
        .to_owned();
    let mut make = |text: &str| {
        let r = d
            .record_create(
                json!({"topicId":t,"kind":"opinion","text":text}),
                &BTreeMap::new(),
            )
            .unwrap()["record"]
            .clone();
        d.review(json!({"id":r["id"],"expectedRevision":1,"text":text,"reason":"","review":"reviewed","adoption":"adopted",
            "currency":"current","priority":"unspecified","questionState":"not_applicable","changeReason":"SENTETİK","confirmedByUser":true}))
            .unwrap()["record"]["id"].as_str().unwrap().to_owned()
    };
    let a = make("SENTETİK eski görüş");
    let b = make("SENTETİK yeni görüş");
    assert!(
        d.supersede(json!({"olderId":a,"newerId":b,"confirmedByUser":false}))
            .is_err()
    );
    assert!(
        d.supersede(json!({"olderId":a,"newerId":a,"confirmedByUser":true}))
            .is_err()
    );
    d.supersede(json!({"olderId":a,"newerId":b,"reason":"SENTETİK","confirmedByUser":true}))
        .unwrap();
    assert!(
        d.supersede(json!({"olderId":b,"newerId":a,"confirmedByUser":true}))
            .is_err(),
        "a surpassed thought cannot go beyond"
    );
}

#[test]
fn every_project_starts_closed_and_sessions_carry_a_report_status() {
    let mut d = disk();
    assert!(!d.report_project_enabled("-synthetic-garden"));
    assert!(
        d.report_projects_set(json!({"project":"../x","enabled":true,"confirmedByUser":true}))
            .is_err()
    );
    assert!(
        d.report_projects_set(
            json!({"project":"-synthetic-garden","enabled":true,"confirmedByUser":false})
        )
        .is_err()
    );
    d.report_projects_set(
        json!({"project":"-synthetic-garden","enabled":true,"confirmedByUser":true}),
    )
    .unwrap();
    assert!(d.report_project_enabled("-synthetic-garden"));
    report(&mut d);
    let sessions = vec![
        json!({"id":"00000000-0000-4000-8000-000000000001","project":"-synthetic-garden","modifiedAt":"2000-01-01T00:00:00Z",
            "sourceConversationId":"claude-code-00000000-0000-4000-8000-000000000001"}),
        json!({"id":"00000000-0000-4000-8000-000000000002","project":"-synthetic-garden","modifiedAt":"2999-01-01T00:00:00Z",
            "sourceConversationId":"claude-code-00000000-0000-4000-8000-000000000002"}),
        json!({"id":"00000000-0000-4000-8000-000000000003","project":"-synthetic-bots","modifiedAt":"2999-01-01T00:00:00Z",
            "sourceConversationId":"claude-code-00000000-0000-4000-8000-000000000003"}),
    ];
    let v = d.report_sources(sessions).unwrap();
    let projects = v["projects"].as_array().unwrap();
    let garden = projects
        .iter()
        .find(|p| p["project"] == "-synthetic-garden")
        .unwrap();
    let bots = projects
        .iter()
        .find(|p| p["project"] == "-synthetic-bots")
        .unwrap();
    assert_eq!(garden["enabled"], true);
    assert_eq!(garden["label"], "garden");
    assert_eq!(bots["enabled"], false);
    let status = |n: usize| garden["sessions"][n]["status"].as_str().unwrap().to_owned();
    let mut statuses = vec![status(0), status(1)];
    statuses.sort();
    assert_eq!(statuses, ["new", "reported"]);
    d.report_projects_set(
        json!({"project":"-synthetic-garden","enabled":false,"confirmedByUser":true}),
    )
    .unwrap();
    assert!(!d.report_project_enabled("-synthetic-garden"));
}

#[test]
fn stores_without_the_new_fields_still_load() {
    let mut d = disk();
    let t = d.topic_create(json!({"title":"SENTETİK"})).unwrap()["topic"]["id"].clone();
    let r = d
        .record_create(
            json!({"topicId":t,"kind":"opinion","text":"SENTETİK"}),
            &BTreeMap::new(),
        )
        .unwrap()["record"]
        .clone();
    for key in ["supersededBy", "supersededAt", "supersessionReason"] {
        assert!(r.get(key).is_none(), "{key} is absent until used");
    }
    let bytes = serde_json::to_string(&d.data).unwrap();
    assert!(!bytes.contains("reports") && !bytes.contains("reportProjects"));
}

#[tokio::test]
async fn provider_answer_is_read_from_the_command_output() {
    let dir = std::env::temp_dir()
        .canonicalize()
        .unwrap()
        .join(format!("tore-provider-{}", id()));
    std::fs::create_dir_all(&dir).unwrap();
    let script = dir.join("fake-claude.sh");
    std::fs::write(
        &script,
        "#!/bin/sh\ncat > /dev/null\nprintf '%s' '{\"type\":\"result\",\"is_error\":false,\"result\":\"{\\\"items\\\":[]}\",\"modelUsage\":{\"synthetic-model\":{}}}'\n",
    )
    .unwrap();
    #[cfg(unix)]
    {
        use std::os::unix::fs::PermissionsExt;
        std::fs::set_permissions(&script, std::fs::Permissions::from_mode(0o755)).unwrap();
    }
    // SAFETY: only this test reads or writes this variable.
    unsafe { std::env::set_var("TORE_REPORT_COMMAND", &script) };
    let out = run_report_provider("SENTETİK istem".into()).await.unwrap();
    assert_eq!(out.text, "{\"items\":[]}");
    assert_eq!(out.version, "synthetic-model");
    assert_eq!(out.provider, "custom");
    std::fs::write(
        &script,
        "#!/bin/sh\ncat > /dev/null\nprintf '%s' '{\"type\":\"result\",\"is_error\":true,\"result\":\"API Error: SENTETİK\"}'\n",
    )
    .unwrap();
    let err = run_report_provider("SENTETİK".into()).await.err().unwrap();
    assert!(err.contains("API Error: SENTETİK"));
    unsafe { std::env::remove_var("TORE_REPORT_COMMAND") };
}
