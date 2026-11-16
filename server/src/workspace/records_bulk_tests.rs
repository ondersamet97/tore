use super::*;
use std::{fs, path::PathBuf};
fn temp() -> PathBuf {
    std::env::temp_dir()
        .canonicalize()
        .unwrap()
        .join(format!("tore-bulk-{}", id()))
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
        source_locator: "/synthetic/ignored/source".into(),
        authorship_status: "unreviewed".into(),
        model: None,
    }
}
fn conversation(id: &str, title: &str) -> Conversation {
    Conversation {
        schema_version: 1,
        id: id.into(),
        provider: "synthetic".into(),
        source_app: "synthetic".into(),
        source_conversation_id: id.into(),
        title: title.into(),
        created_at: None,
        updated_at: None,
        selected_leaf_id: Some("q".into()),
        messages: vec![
            message(
                "u",
                None,
                "user",
                "SENTETİK: cumartesi açmaya karar verdim.",
            ),
            message(
                "a",
                Some("u"),
                "assistant",
                "Her gün açmayı benimsiyorum; bu AI cümlesidir.",
            ),
            message(
                "q",
                Some("a"),
                "user",
                "SENTETİK: gönüllü sayısı azalırsa ne yapacağız?",
            ),
        ],
        warnings: vec![],
    }
}
fn map(c: Conversation) -> BTreeMap<String, Conversation> {
    BTreeMap::from([(c.id.clone(), c)])
}
fn apply(d: &mut Disk, cs: &BTreeMap<String, Conversation>) -> Value {
    let p = d.bulk_preview(cs).unwrap();
    d.bulk_apply(
        json!({"previewHash":p["previewHash"],"confirmedByUser":true}),
        cs,
    )
    .unwrap()
}
#[test]
fn bulk_links_sources_and_candidates_without_endorsement_or_network() {
    let p = temp();
    let mut d = Disk::open(p.clone()).unwrap();
    let cs = map(conversation("c", "Töre teknik demo"));
    let original = hash(&cs).unwrap();
    let preview = d.bulk_preview(&cs).unwrap();
    assert_eq!(preview["linkedCount"], 1);
    assert_eq!(preview["candidateCount"], 2);
    assert_eq!(preview["topics"][0]["title"], "Töre");
    assert!(!p.join("records-v1.json").exists());
    let result = apply(&mut d, &cs);
    assert_eq!(result["linked"], 1);
    assert_eq!(result["candidatesCreated"], 2);
    assert_eq!(hash(&cs).unwrap(), original);
    let state = d.list().unwrap();
    let link = &state["conversationLinks"][0];
    assert_eq!(link["lastUserSource"]["messageId"], "q");
    assert_eq!(link["lastUserSource"]["excerpt"], cs["c"].messages[2].text);
    assert_eq!(link["sourceUpdatedAt"], Value::Null);
    for r in state["records"].as_array().unwrap() {
        assert_eq!(r["review"], "pending");
        assert_eq!(r["currency"], "unknown");
        assert_ne!(r["adoption"], "adopted");
        assert_eq!(r["source"]["role"], "user");
        assert_ne!(r["source"]["messageId"], "a");
    }
    assert!(!state.to_string().contains("/synthetic/ignored/source"));
    drop(d);
    let reopened = Disk::open(p.clone()).unwrap();
    assert_eq!(
        reopened.list().unwrap()["conversationLinks"],
        state["conversationLinks"]
    );
    drop(reopened);
    fs::remove_dir_all(p).unwrap();
}
#[test]
fn selected_branch_is_used_and_unselected_multiple_branches_are_only_linked() {
    let p = temp();
    let mut d = Disk::open(p.clone()).unwrap();
    let mut c = conversation("c", "Bilinmeyen konu");
    c.messages.push(message(
        "other",
        Some("u"),
        "user",
        "SENTETİK: başka dalda vazgeçtim.",
    ));
    c.selected_leaf_id = Some("q".into());
    let mut cs = map(c.clone());
    apply(&mut d, &cs);
    assert_eq!(
        d.list().unwrap()["conversationLinks"][0]["lastUserSource"]["messageId"],
        "q"
    );
    c.id = "unselected".into();
    c.selected_leaf_id = None;
    cs.insert(c.id.clone(), c);
    let result = apply(&mut d, &cs);
    assert_eq!(result["linked"], 1);
    assert_eq!(result["candidatesCreated"], 0);
    let state = d.list().unwrap();
    let l = state["conversationLinks"]
        .as_array()
        .unwrap()
        .iter()
        .find(|l| l["conversationId"] == "unselected")
        .unwrap();
    assert_eq!(l["lastUserSource"], Value::Null);
    assert!(l["warning"].as_str().unwrap().contains("dalı seçilmemiş"));
    drop(d);
    fs::remove_dir_all(p).unwrap();
}
#[test]
fn infrastructure_and_hidden_phases_never_become_last_words_or_candidates() {
    let p = temp();
    let mut d = Disk::open(p.clone()).unwrap();
    let mut c = conversation("c", "SENTETİK kayıt");
    c.messages.push(message(
        "infra",
        Some("q"),
        "user",
        "# AGENTS.md instructions\nTöre için karar verdim.",
    ));
    let mut hidden = message(
        "hidden",
        Some("infra"),
        "user",
        "Töre için gizli karar verdim.",
    );
    hidden.phase = Some("confidence".into());
    c.messages.push(hidden);
    c.selected_leaf_id = Some("hidden".into());
    apply(&mut d, &map(c));
    let state = d.list().unwrap();
    assert_eq!(
        state["conversationLinks"][0]["lastUserSource"]["messageId"],
        "q"
    );
    assert_eq!(state["conversationLinks"][0]["topicId"], "bulk-topic-other");
    assert!(
        state["records"]
            .as_array()
            .unwrap()
            .iter()
            .all(|r| r["source"]["messageId"] != "infra" && r["source"]["messageId"] != "hidden")
    );
    drop(d);
    fs::remove_dir_all(p).unwrap();
}
#[test]
fn stale_preview_consent_and_idempotent_retries_preserve_user_edits() {
    let p = temp();
    let mut d = Disk::open(p.clone()).unwrap();
    let cs = map(conversation("c", "Töre"));
    let preview = d.bulk_preview(&cs).unwrap();
    assert!(
        d.bulk_apply(
            json!({"previewHash":preview["previewHash"],"confirmedByUser":false}),
            &cs
        )
        .is_err()
    );
    let mut changed = cs.clone();
    changed.get_mut("c").unwrap().title = "İzge".into();
    assert!(
        d.bulk_apply(
            json!({"previewHash":preview["previewHash"],"confirmedByUser":true}),
            &changed
        )
        .is_err()
    );
    assert!(!p.join("records-v1.json").exists());
    let input = json!({"previewHash":preview["previewHash"],"confirmedByUser":true});
    let result = d.bulk_apply(input.clone(), &cs).unwrap();
    let data = fs::read(p.join("records-v1.json")).unwrap();
    let backups = d.backups().unwrap().len();
    assert_eq!(d.bulk_apply(input, &cs).unwrap()["alreadyApplied"], true);
    assert_eq!(fs::read(p.join("records-v1.json")).unwrap(), data);
    assert_eq!(d.backups().unwrap().len(), backups);
    assert_eq!(result["linked"], 1);
    let again = apply(&mut d, &cs);
    assert_eq!(again["linked"], 0);
    assert_eq!(again["backupId"], Value::Null);
    assert_eq!(fs::read(p.join("records-v1.json")).unwrap(), data);
    drop(d);
    fs::remove_dir_all(p).unwrap();
}
#[test]
fn pre_bulk_backup_without_new_fields_restores_and_reapply_is_safe() {
    let p = temp();
    let mut d = Disk::open(p.clone()).unwrap();
    let old = d.backup().unwrap();
    let file = p
        .join("records-backups")
        .join(format!("{}.json", old["backupId"].as_str().unwrap()));
    let raw: Value = serde_json::from_slice(&fs::read(file).unwrap()).unwrap();
    assert!(raw["data"].get("conversationLinks").is_none());
    assert!(raw["data"].get("bulkReceipts").is_none());
    let cs = map(conversation("c", "Töre"));
    apply(&mut d, &cs);
    let state = d.list().unwrap();
    d.restore(json!({"backupId":old["backupId"],"expectedStateHash":state["stateHash"],"confirmedByUser":true}),&cs).unwrap();
    assert_eq!(d.list().unwrap()["conversationLinks"], json!([]));
    assert_eq!(d.list().unwrap()["stateHash"], old["stateHash"]);
    assert_eq!(apply(&mut d, &cs)["linked"], 1);
    drop(d);
    fs::remove_dir_all(p).unwrap();
}
#[test]
fn classification_uses_visible_user_words_but_not_ai_and_keeps_mixed_topics_unclassified() {
    let p = temp();
    let mut d = Disk::open(p.clone()).unwrap();
    let mut a = conversation("a", "Codex sohbeti");
    a.messages[0].text = "Töre projesi için yerel akışı geliştirmeye karar verdim.".into();
    let mut b = conversation("b", "Genel kayıt");
    b.messages[1].text = "Töre hakkında çok konuşuyorum.".into();
    let c = conversation("c", "Töre ile İzge karşılaştırması");
    let cs = BTreeMap::from([(a.id.clone(), a), (b.id.clone(), b), (c.id.clone(), c)]);
    apply(&mut d, &cs);
    let links = d.list().unwrap()["conversationLinks"]
        .as_array()
        .unwrap()
        .clone();
    assert_eq!(
        links.iter().find(|l| l["conversationId"] == "a").unwrap()["topicId"],
        "bulk-topic-tore"
    );
    for id in ["b", "c"] {
        assert_eq!(
            links.iter().find(|l| l["conversationId"] == id).unwrap()["topicId"],
            "bulk-topic-other"
        );
    }
    drop(d);
    fs::remove_dir_all(p).unwrap();
}
#[test]
fn structured_user_answers_keep_exact_source_and_skip_escaped_inventions() {
    let mut m = message(
        "answer",
        None,
        "user",
        "<send_user_message_question_reply>\n[{\"question\":\"Ne?\",\"answer\":\"Yerel uygulamayı tercih ediyorum.\"}]\n</send_user_message_question_reply>",
    );
    assert_eq!(
        visible_text(&m).unwrap(),
        "Yerel uygulamayı tercih ediyorum."
    );
    m.text="<send_user_message_question_reply>[{\"answer\":\"Birinci\\nikinci\"}]</send_user_message_question_reply>".into();
    assert!(visible_text(&m).is_none());
}

#[test]
fn restore_and_store_words_are_not_tore_project_names() {
    assert_eq!(classification("Restore archive").0, "other");
    assert_eq!(
        classification("Storage: Please restore the store").0,
        "other"
    );
    assert_eq!(classification("Töre'yi geliştirelim").0, "tore");
    assert_eq!(classification("Töreyi geliştirelim").0, "tore");
    assert_eq!(classification("CV hazırlama").0, "career");
    assert_eq!(classification("Bu koşullar altında devam").0, "other");
    assert_eq!(classification("Altın fiyatı araştırması").0, "markets");
}
#[test]
fn forged_link_timestamp_and_cross_conversation_candidate_fail_restore() {
    let p = temp();
    let mut d = Disk::open(p.clone()).unwrap();
    let cs = map(conversation("c", "Töre"));
    apply(&mut d, &cs);
    let backup = d.backup().unwrap();
    let path = p
        .join("records-backups")
        .join(format!("{}.json", backup["backupId"].as_str().unwrap()));
    let mut raw: Value = serde_json::from_slice(&fs::read(&path).unwrap()).unwrap();
    raw["data"]["conversationLinks"]["c"]["sourceUpdatedAt"] = json!("2027-01-01T00:00:00Z");
    let forged: Store = serde_json::from_value(raw["data"].clone()).unwrap();
    raw["stateHash"] = json!(hash(&forged).unwrap());
    fs::write(&path, serde_json::to_vec(&raw).unwrap()).unwrap();
    let before = fs::read(p.join("records-v1.json")).unwrap();
    assert!(d.restore(json!({"backupId":backup["backupId"],"expectedStateHash":d.list().unwrap()["stateHash"],"confirmedByUser":true}),&cs).is_err());
    assert_eq!(fs::read(p.join("records-v1.json")).unwrap(), before);
    drop(d);
    fs::remove_dir_all(p).unwrap();
}

#[test]
fn explicit_titles_cover_everyday_topics_without_broad_ambiguous_words() {
    for (title, expected) in [
        ("Uyku düzeni", "health"),
        ("Almanca çeviri", "languages"),
        ("Kitap önerisi", "learning"),
        ("Osmanlı kültürü", "history"),
        ("Haftalık plan", "planning"),
        ("Felsefe ve etik", "ideology"),
        ("Crypto trading", "markets"),
        ("İş görüşmesi hazırlığı", "career"),
    ] {
        assert_eq!(classification(title).0, expected, "{title}");
    }
    for title in [
        "Başvuru tarihi",
        "Bu işi yapalım",
        "Yeni strateji",
        "Stock image",
        "Git history",
    ] {
        assert_eq!(classification(title).0, "other", "{title}");
    }
}
#[test]
fn general_title_topics_are_not_guessed_from_message_mentions_and_mixed_titles_stay_other() {
    let m = message(
        "u",
        None,
        "user",
        "SENTETİK genel not: uyku ve çeviri konularına bir cümlede değindim.",
    );
    assert_eq!(
        classification_with_source("Genel konuşma", &[(&m, m.text.clone())]).0,
        "other"
    );
    assert_eq!(classification("Uyku ve Almanca çeviri").0, "other");
    assert_eq!(classification("İdeoloji ve etik").0, "ideology");
    assert_eq!(classification("Töre ile günlük planlama").0, "tore");
    let strong = message(
        "project",
        None,
        "user",
        "Töre projesini geliştirmeye karar verdim.",
    );
    assert_eq!(
        classification_with_source("Töre ve İzge", &[(&strong, strong.text.clone())]).0,
        "other"
    );
}
