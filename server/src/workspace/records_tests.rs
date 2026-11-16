use super::super::types::Message;
use super::*;
use std::{fs, path::PathBuf};

fn root() -> PathBuf {
    std::env::temp_dir()
        .canonicalize()
        .unwrap()
        .join(format!("tore-records-{}", id()))
}
fn conversations() -> BTreeMap<String, Conversation> {
    let mut c = Conversation {
        schema_version: 1,
        id: "conversation".into(),
        provider: "synthetic".into(),
        source_app: "test".into(),
        source_conversation_id: "source".into(),
        title: "Yapay konu".into(),
        created_at: None,
        updated_at: None,
        selected_leaf_id: Some("assistant".into()),
        messages: vec![],
        warnings: vec![],
    };
    for (id, role, text) in [
        (
            "user",
            "user",
            "Varsayalım herkese özgürlük sağlandı. Gerçekte henüz karar vermedim.",
        ),
        (
            "assistant",
            "assistant",
            "Bir öneri: açık kaynakla başlayabilirsiniz.",
        ),
        ("hidden", "assistant", "Gizli düşünme"),
        ("tool", "tool", "Araç çıktısı"),
    ] {
        c.messages.push(Message {
            id: id.into(),
            source_id: id.into(),
            parent_id: None,
            role: role.into(),
            phase: if id == "hidden" {
                Some("analysis".into())
            } else {
                None
            },
            text: text.into(),
            attachments: vec![],
            timestamp: None,
            source_locator: "/private/synthetic/path".into(),
            authorship_status: "unreviewed".into(),
            model: None,
        });
    }
    BTreeMap::from([(c.id.clone(), c)])
}
fn topic(d: &mut Disk) -> String {
    d.topic_create(json!({"title":"Konuya dönüş","goal":"Yapay hedef"}))
        .unwrap()["topic"]["id"]
        .as_str()
        .unwrap()
        .into()
}
fn create(d: &mut Disk, t: &str, kind: &str) -> Value {
    d.record_create(
        json!({"topicId":t,"kind":kind,"text":"Yapay karar","reason":"İlk gerekçe"}),
        &BTreeMap::new(),
    )
    .unwrap()["record"]
        .clone()
}
fn review_input(r: &Value) -> Value {
    json!({"id":r["id"],"expectedRevision":r["revision"],"text":r["text"],"reason":r["reason"],"review":"reviewed","adoption":if r["kind"]=="question"{"not_applicable"}else{"adopted"},"currency":"current","priority":"active","questionState":r["questionState"],"changeReason":"Yapay test: açıkça onayladım","confirmedByUser":true})
}
fn reviewed(d: &mut Disk, r: &Value) -> Value {
    d.review(review_input(r)).unwrap()["record"].clone()
}
fn packet(d: &mut Disk, t: &str, ids: Vec<Value>) -> Value {
    d.prepare(json!({"topicId":t,"recordIds":ids,"proposalIds":[],"target":"chatgpt","question":"Devam edelim","confirmedByUser":true})).unwrap()["packet"].clone()
}

#[test]
fn selected_sources_are_exact_and_never_adopted_automatically() {
    let p = root();
    let mut d = Disk::open(p.clone()).unwrap();
    let t = topic(&mut d);
    let cs = conversations();
    let mut input = json!({"topicId":t,"kind":"opinion","text":"Varsayalım herkese özgürlük sağlandı.","source":{"conversationId":"conversation","messageId":"user","excerpt":"Varsayalım herkese özgürlük sağlandı."}});
    let r = d.record_create(input.clone(), &cs).unwrap()["record"].clone();
    assert_eq!(r["review"], "pending");
    assert_eq!(r["adoption"], "unknown");
    assert_eq!(r["source"]["timestamp"], Value::Null);
    assert_eq!(r["attribution"], "user_statement");
    assert!(!r.to_string().contains("/private/synthetic/path"));
    input["text"] = json!("Benim yeni yorumum");
    let interpreted = d.record_create(input.clone(), &cs).unwrap();
    assert_eq!(interpreted["record"]["attribution"], "user_interpretation");
    input["source"]["excerpt"] = json!("Uydurma alıntı");
    assert!(d.record_create(input.clone(), &cs).is_err());
    input["source"] =
        json!({"conversationId":"conversation","messageId":"hidden","excerpt":"Gizli düşünme"});
    assert!(d.record_create(input.clone(), &cs).is_err());
    input["source"] =
        json!({"conversationId":"conversation","messageId":"tool","excerpt":"Araç çıktısı"});
    assert!(d.record_create(input.clone(), &cs).is_err());
    input["source"] = json!({"conversationId":"conversation","messageId":"assistant","excerpt":"Bir öneri: açık kaynakla başlayabilirsiniz."});
    let ai = d.record_create(input, &cs).unwrap()["record"].clone();
    let adopted = reviewed(&mut d, &ai);
    assert_eq!(adopted["attribution"], "assistant_proposal");
    assert_eq!(adopted["source"]["role"], "assistant");
    drop(d);
    fs::remove_dir_all(p).unwrap();
}

#[test]
fn independent_states_history_stale_edits_and_explicit_question_close() {
    let p = root();
    let mut d = Disk::open(p.clone()).unwrap();
    let t = topic(&mut d);
    let r = create(&mut d, &t, "decision");
    let mut input = review_input(&r);
    input["confirmedByUser"] = json!(false);
    assert!(d.review(input).is_err());
    let r = reviewed(&mut d, &r);
    let mut input = review_input(&r);
    input["text"] = json!("Düzeltilmiş karar");
    input["reason"] = json!("Yeni gerekçe");
    input["priority"] = json!("paused");
    input["changeReason"] = json!("İlk iddiayı yeni kanıtla daralttım");
    let changed = d.review(input.clone()).unwrap()["record"].clone();
    assert!(d.review(input).is_err());
    assert_eq!(changed["history"][1]["text"], r["text"]);
    assert_eq!(changed["history"][1]["nextRevision"], 3);
    assert_eq!(changed["priority"], "paused");
    assert_eq!(changed["adoption"], "adopted");
    let q = create(&mut d, &t, "question");
    let mut qi = review_input(&q);
    qi["adoption"] = json!("adopted");
    assert!(d.review(qi).is_err());
    let q = reviewed(&mut d, &q);
    let answer = d
        .record_create(
            json!({"topicId":t,"kind":"decision","text":"Olası yanıt","answersQuestionId":q["id"]}),
            &BTreeMap::new(),
        )
        .unwrap();
    assert_eq!(answer["record"]["review"], "pending");
    assert_eq!(
        d.topic_view(json!({"topicId":t})).unwrap()["openQuestions"]
            .as_array()
            .unwrap()
            .len(),
        1
    );
    let mut qi = review_input(&q);
    qi["questionState"] = json!("closed");
    qi["changeReason"] = json!("");
    assert!(d.review(qi.clone()).is_err());
    qi["changeReason"] = json!("Bu soruyu kendim kapattım");
    d.review(qi).unwrap();
    assert!(
        d.topic_view(json!({"topicId":t})).unwrap()["openQuestions"]
            .as_array()
            .unwrap()
            .is_empty()
    );
    drop(d);
    let d = Disk::open(p.clone()).unwrap();
    let v = d.topic_view(json!({"topicId":t})).unwrap();
    assert_eq!(v["currentDecisions"][0]["text"], "Düzeltilmiş karar");
    assert_eq!(v["currentDecisions"][0]["priority"], "paused");
    drop(d);
    fs::remove_dir_all(p).unwrap();
}

#[test]
fn packet_contains_only_selected_current_reviewed_items_and_labeled_proposals() {
    let p = root();
    let mut d = Disk::open(p.clone()).unwrap();
    let t = topic(&mut d);
    let r = create(&mut d, &t, "decision");
    let request =
        json!({"topicId":t,"recordIds":[r["id"]],"target":"claude","confirmedByUser":true});
    assert!(d.prepare(request.clone()).is_err());
    let r = reviewed(&mut d, &r);
    let hidden = d
        .record_create(
            json!({"topicId":t,"kind":"opinion","text":"DO-NOT-INCLUDE-SECRET"}),
            &BTreeMap::new(),
        )
        .unwrap();
    let ai=d.record_create(json!({"topicId":t,"kind":"opinion","text":"AI önerisi","source":{"conversationId":"conversation","messageId":"assistant","excerpt":"Bir öneri: açık kaynakla başlayabilirsiniz."}}),&conversations()).unwrap()["record"].clone();
    let mut ai_review = review_input(&ai);
    ai_review["adoption"] = json!("hypothesis");
    let ai = d.review(ai_review).unwrap()["record"].clone();
    let mut req = request;
    req["recordIds"] = json!([r["id"], ai["id"]]);
    assert!(d.prepare(req.clone()).is_err());
    req["recordIds"] = json!([r["id"]]);
    req["proposalIds"] = json!([ai["id"]]);
    let packet = d.prepare(req).unwrap()["packet"].clone();
    let text = packet["text"].as_str().unwrap();
    assert!(text.contains("BENİMSENMEMİŞ AI ÖNERİSİ"));
    assert!(!text.contains("DO-NOT-INCLUDE-SECRET"));
    assert!(!text.contains(hidden["record"]["id"].as_str().unwrap()));
    assert!(!text.contains("/private/synthetic/path"));
    assert_eq!(packet["sources"].as_array().unwrap().len(), 2);
    drop(d);
    fs::remove_dir_all(p).unwrap();
}

#[test]
fn manual_reply_errors_are_durable_and_cannot_become_candidates() {
    let p = root();
    let mut d = Disk::open(p.clone()).unwrap();
    let t = topic(&mut d);
    let r = create(&mut d, &t, "decision");
    let r = reviewed(&mut d, &r);
    let pk = packet(&mut d, &t, vec![r["id"].clone()]);
    let reply=d.reply_save(json!({"packetId":pk["id"],"rawText":"{\"commentary\":broken","format":"json","confirmedByUser":true})).unwrap()["reply"].clone();
    assert_eq!(reply["validationStatus"], "invalid");
    assert_eq!(reply["rawText"], "{\"commentary\":broken");
    assert!(d.record_create(json!({"topicId":t,"kind":"opinion","text":"broken","source":{"replyId":reply["id"],"excerpt":"broken"}}),&BTreeMap::new()).is_err());
    for raw in [
        r#"{"commentary":"a","commentary":"b","citations":[]}"#.to_string(),
        json!({"commentary":"a","citations":[{"sourceId":"unknown","quote":"Yapay"}]}).to_string(),
        json!({"commentary":"a","citations":[{"sourceId":pk["sourceIds"][0],"quote":"uydurma"}]})
            .to_string(),
    ] {
        let r = d
            .reply_save(
                json!({"packetId":pk["id"],"rawText":raw,"format":"json","confirmedByUser":true}),
            )
            .unwrap();
        assert_eq!(r["reply"]["validationStatus"], "invalid");
    }
    let raw=json!({"commentary":"Yeni bir AI önerisi","citations":[{"sourceId":pk["sourceIds"][0],"quote":"Yapay karar"}]}).to_string();
    let good = d
        .reply_save(
            json!({"packetId":pk["id"],"rawText":raw,"format":"json","confirmedByUser":true}),
        )
        .unwrap()["reply"]
        .clone();
    assert_eq!(good["validationStatus"], "valid");
    let candidate=d.record_create(json!({"topicId":t,"kind":"opinion","text":"Yeni bir AI önerisi","source":{"replyId":good["id"],"excerpt":"Yeni bir AI önerisi"}}),&BTreeMap::new()).unwrap();
    assert_eq!(candidate["record"]["attribution"], "assistant_proposal");
    assert_eq!(candidate["record"]["review"], "pending");
    assert_eq!(candidate["record"]["adoption"], "unknown");
    drop(d);
    let d = Disk::open(p.clone()).unwrap();
    assert!(
        d.list().unwrap()["replies"]
            .as_array()
            .unwrap()
            .iter()
            .any(|r| r["id"] == reply["id"] && r["rawText"] == reply["rawText"])
    );
    drop(d);
    fs::remove_dir_all(p).unwrap();
}

#[test]
fn retry_after_lost_response_does_not_duplicate_or_reset_review() {
    let p = root();
    let mut d = Disk::open(p.clone()).unwrap();
    let t = topic(&mut d);
    let input = json!({"requestId":id(),"topicId":t,"kind":"decision","text":"İlk karar"});
    let first = d.record_create(input.clone(), &BTreeMap::new()).unwrap()["record"].clone();
    let reviewed = reviewed(&mut d, &first);
    assert_eq!(
        d.record_create(input.clone(), &BTreeMap::new()).unwrap()["record"],
        reviewed
    );
    drop(d);
    let mut d = Disk::open(p.clone()).unwrap();
    assert_eq!(
        d.record_create(input.clone(), &BTreeMap::new()).unwrap()["record"],
        reviewed
    );
    let mut changed = input;
    changed["text"] = json!("Farklı karar");
    assert!(d.record_create(changed, &BTreeMap::new()).is_err());
    assert_eq!(d.list().unwrap()["records"].as_array().unwrap().len(), 1);
    drop(d);
    fs::remove_dir_all(p).unwrap();
}

fn legacy() -> Value {
    json!({"cards":[{"id":"legacy-card","topic":"ai","statement":"Açık kaynak yaklaşımı","reason":"Yapay gerekçe","source":null,"attribution":"user_authored","positionIds":["ai_human"],"status":"confirmed","revision":1,"createdAt":"2026-01-01T00:00:00Z","updatedAt":"2026-01-01T00:00:00Z","history":[]}]})
}

#[test]
fn migration_preserves_ai_interpretation_of_user_source_and_every_old_state() {
    let p = root();
    let mut d = Disk::open(p.clone()).unwrap();
    let mut old = legacy();
    let mut cards = vec![];
    for status in ["draft", "confirmed", "uncertain", "rejected"] {
        let mut card = old["cards"][0].clone();
        card["id"] = json!(format!("legacy-{}", status));
        card["status"] = json!(status);
        card["attribution"] = json!("assistant_proposal");
        card["statement"] = json!("AI'nin kullanıcı sözünden yaptığı yorum");
        card["source"] = json!({"conversationId":"conversation","messageId":"user","excerpt":"Varsayalım herkese özgürlük sağlandı.","conversationTitle":"Yapay konu","provider":"synthetic","role":"user","timestamp":null});
        cards.push(card);
    }
    old["cards"] = json!(cards);
    let preview = d.legacy_preview(old.clone()).unwrap();
    assert_eq!(preview["count"], 4);
    d.legacy_apply(
        old.clone(),
        json!({"previewHash":preview["previewHash"],"confirmedByUser":true}),
    )
    .unwrap();
    let values = d.list().unwrap();
    for record in values["records"].as_array().unwrap() {
        assert_eq!(record["source"]["role"], "user");
        assert_eq!(record["attribution"], "assistant_proposal");
        assert_eq!(record["currency"], "unknown");
        assert_eq!(record["priority"], "unspecified");
        match record["legacy"]["status"].as_str().unwrap() {
            "confirmed" => {
                assert_eq!(record["review"], "reviewed");
                assert_eq!(record["adoption"], "adopted");
            }
            "draft" => {
                assert_eq!(record["review"], "pending");
                assert_eq!(record["adoption"], "unknown");
            }
            "uncertain" => {
                assert_eq!(record["review"], "reviewed");
                assert_eq!(record["adoption"], "uncertain");
            }
            "rejected" => {
                assert_eq!(record["review"], "rejected");
                assert_eq!(record["adoption"], "not_adopted");
            }
            _ => panic!("unexpected legacy status"),
        }
    }
    let backup = d.backup().unwrap();
    d.restore(json!({"backupId":backup["backupId"],"expectedStateHash":values["stateHash"],"confirmedByUser":true}), &conversations()).unwrap();
    drop(d);
    fs::remove_dir_all(p).unwrap();
}

#[test]
fn backup_restore_refuses_missing_source_stale_state_or_corrupted_json() {
    let p = root();
    let mut d = Disk::open(p.clone()).unwrap();
    let t = topic(&mut d);
    let record = d.record_create(json!({"topicId":t,"kind":"opinion","text":"Varsayalım herkese özgürlük sağlandı.","source":{"conversationId":"conversation","messageId":"user","excerpt":"Varsayalım herkese özgürlük sağlandı."}}), &conversations()).unwrap()["record"].clone();
    let backup = d.backup().unwrap();
    let mut request = json!({"backupId":backup["backupId"],"expectedStateHash":backup["stateHash"],"confirmedByUser":true});
    assert!(d.restore(request.clone(), &BTreeMap::new()).is_err());
    reviewed(&mut d, &record);
    assert!(d.restore(request.clone(), &conversations()).is_err());
    request["expectedStateHash"] = d.list().unwrap()["stateHash"].clone();
    let snapshot_path = p
        .join("records-backups")
        .join(format!("{}.json", backup["backupId"].as_str().unwrap()));
    fs::write(snapshot_path, b"truncated {").unwrap();
    let original = fs::read(p.join("records-v1.json")).unwrap();
    assert!(d.restore(request, &conversations()).is_err());
    assert_eq!(fs::read(p.join("records-v1.json")).unwrap(), original);
    drop(d);
    fs::remove_dir_all(p).unwrap();
}

#[test]
fn legacy_preview_apply_idempotence_backup_rollback_preserves_original_file() {
    let p = root();
    let mut d = Disk::open(p.clone()).unwrap();
    let old_bytes = serde_json::to_vec(&legacy()).unwrap();
    fs::write(p.join("opinions-v1.json"), &old_bytes).unwrap();
    let preview = d.legacy_preview(legacy()).unwrap();
    assert_eq!(preview["count"], 1);
    assert_eq!(d.list().unwrap()["records"].as_array().unwrap().len(), 0);
    assert!(
        d.legacy_apply(
            legacy(),
            json!({"previewHash":preview["previewHash"],"confirmedByUser":false})
        )
        .is_err()
    );
    let result = d
        .legacy_apply(
            legacy(),
            json!({"previewHash":preview["previewHash"],"confirmedByUser":true}),
        )
        .unwrap();
    let record = d.list().unwrap()["records"][0].clone();
    assert_eq!(record["review"], "reviewed");
    assert_eq!(record["adoption"], "adopted");
    assert_eq!(record["currency"], "unknown");
    assert_eq!(record["priority"], "unspecified");
    assert_eq!(record["legacy"], legacy()["cards"][0]);
    let second = d
        .legacy_apply(
            legacy(),
            json!({"previewHash":preview["previewHash"],"confirmedByUser":true}),
        )
        .unwrap();
    assert_eq!(second["imported"], 0);
    assert_eq!(second["skipped"], 1);
    let state = d.list().unwrap()["stateHash"].clone();
    let restored = d
        .restore(
            json!({"backupId":result["backupId"],"expectedStateHash":state,"confirmedByUser":true}),
            &BTreeMap::new(),
        )
        .unwrap();
    assert!(d.list().unwrap()["records"].as_array().unwrap().is_empty());
    d.restore(json!({"backupId":restored["backupId"],"expectedStateHash":restored["stateHash"],"confirmedByUser":true}),&BTreeMap::new()).unwrap();
    assert_eq!(d.list().unwrap()["records"][0], record);
    assert_eq!(fs::read(p.join("opinions-v1.json")).unwrap(), old_bytes);
    drop(d);
    fs::remove_dir_all(p).unwrap();
}

#[test]
fn backup_restore_validates_sources_even_when_checksum_recomputed() {
    let p = root();
    let mut d = Disk::open(p.clone()).unwrap();
    let t = topic(&mut d);
    let cs = conversations();
    d.record_create(json!({"topicId":t,"kind":"opinion","text":"Varsayalım herkese özgürlük sağlandı.","source":{"conversationId":"conversation","messageId":"user","excerpt":"Varsayalım herkese özgürlük sağlandı."}}),&cs).unwrap();
    let backup = d.backup().unwrap();
    let backup_id = backup["backupId"].as_str().unwrap();
    let file = p
        .join("records-backups")
        .join(format!("{}.json", backup_id));
    let mut forged: Value = serde_json::from_slice(&fs::read(&file).unwrap()).unwrap();
    let records = forged["data"]["records"].as_object_mut().unwrap();
    let record = records.values_mut().next().unwrap();
    record["source"]["excerpt"] = json!("Uydurulmuş özgün alıntı");
    record["attribution"] = json!("user_interpretation");
    let data: Store = serde_json::from_value(forged["data"].clone()).unwrap();
    forged["stateHash"] = json!(hash(&data).unwrap());
    fs::write(&file, serde_json::to_vec(&forged).unwrap()).unwrap();
    let before = fs::read(p.join("records-v1.json")).unwrap();
    assert!(d.restore(json!({"backupId":backup_id,"expectedStateHash":d.list().unwrap()["stateHash"],"confirmedByUser":true}),&cs).is_err());
    assert_eq!(fs::read(p.join("records-v1.json")).unwrap(), before);
    drop(d);
    fs::remove_dir_all(p).unwrap();
}

#[test]
fn locks_external_changes_corruption_and_permissions_fail_closed() {
    let p = root();
    let mut d = Disk::open(p.clone()).unwrap();
    assert!(Disk::open(p.clone()).is_err());
    topic(&mut d);
    #[cfg(unix)]
    {
        use std::os::unix::fs::PermissionsExt;
        assert_eq!(
            fs::metadata(p.join("records-v1.json"))
                .unwrap()
                .permissions()
                .mode()
                & 0o777,
            0o600
        );
    }
    fs::write(p.join("records-v1.json"), b"broken").unwrap();
    assert!(d.list().is_err());
    assert!(d.topic_create(json!({"title":"overwrite"})).is_err());
    drop(d);
    assert!(Disk::open(p.clone()).is_err());
    assert_eq!(fs::read(p.join("records-v1.json")).unwrap(), b"broken");
    fs::remove_dir_all(p).unwrap();
}

#[cfg(unix)]
#[test]
fn symlink_store_backup_or_parent_is_never_followed() {
    use std::os::unix::fs::symlink;
    let p = root();
    let outside = root();
    fs::create_dir_all(&p).unwrap();
    fs::write(&outside, b"keep original").unwrap();
    symlink(&outside, p.join("records-v1.json")).unwrap();
    assert!(Disk::open(p.clone()).is_err());
    assert_eq!(fs::read(&outside).unwrap(), b"keep original");
    fs::remove_file(p.join("records-v1.json")).unwrap();
    let d = Disk::open(p.clone()).unwrap();
    symlink(&outside, p.join("records-backups")).unwrap();
    assert!(d.backup().is_err());
    drop(d);
    assert_eq!(fs::read(&outside).unwrap(), b"keep original");
    fs::remove_dir_all(p).unwrap();
    fs::remove_file(outside).unwrap();
}
