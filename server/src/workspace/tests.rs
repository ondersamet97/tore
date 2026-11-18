use super::*;
use axum::{body::Body, http::Request};
use http_body_util::BodyExt;
use tower::ServiceExt;
fn dir() -> PathBuf {
    std::env::temp_dir()
        .canonicalize()
        .unwrap()
        .join(format!("tore-http-{}", policy::id()))
}
async fn call(app: &Router, op: &str, v: Value) -> (StatusCode, Value) {
    let r = app
        .clone()
        .oneshot(
            Request::builder()
                .method("POST")
                .uri(format!("/api/private/tore/{op}"))
                .header("host", "127.0.0.1:12345")
                .header("origin", "http://127.0.0.1:12345")
                .header("authorization", "Bearer test-token")
                .header("content-type", "application/json")
                .body(Body::from(v.to_string()))
                .unwrap(),
        )
        .await
        .unwrap();
    let status = r.status();
    let bytes = r.into_body().collect().await.unwrap().to_bytes();
    (status, serde_json::from_slice(&bytes).unwrap())
}
async fn import(app: &Router) -> Conversation {
    let (status,p)=call(app,"import-preview",json!({"provider":"generic","developer":"openai","title":"Yapay test","text":"Seçilen insan mesajı"})).await;
    assert_eq!(status, StatusCode::OK, "{p}");
    let ids = p["conversations"]
        .as_array()
        .unwrap()
        .iter()
        .map(|c| c["id"].clone())
        .collect::<Vec<_>>();
    let (status, r) = call(
        app,
        "import-commit",
        json!({"previewId":p["previewId"],"selectedIds":ids}),
    )
    .await;
    assert_eq!(status, StatusCode::OK, "{r}");
    serde_json::from_value(r["conversations"][0].clone()).unwrap()
}
fn request(c: &Conversation, intent: &str, developer: &str) -> Value {
    let m = &c.messages[0];
    json!({"conversationId":c.id,"leafId":c.selected_leaf_id.as_ref().unwrap_or(&m.id),"items":[{"messageId":m.id,"role":if m.role=="unknown"{"user"}else{m.role.as_str()},"text":"Gözden geçirilmiş [E-POSTA] metni","authorship":"human_original","rights":"user_attested","feedback":"Kullanıcı tercihi"}],"intent":intent,"developer":developer,"modelId":"","mode":"simulation","question":""})
}
#[tokio::test]
async fn public_flow_isolates_consent_reopens_and_revokes() {
    let p = dir();
    let app = router(
        p.clone(),
        "test-token".into(),
        "http://127.0.0.1:12345".into(),
    )
    .unwrap();
    let c = import(&app).await;
    let (_, x) = call(&app, "prepare", request(&c, "continue", "openai")).await;
    let d = &x["draft"];
    assert_eq!(
        call(
            &app,
            "send",
            json!({"draftId":d["id"],"hash":d["hash"],"confirmed":false})
        )
        .await
        .0,
        StatusCode::BAD_REQUEST
    );
    let (status, out) = call(
        &app,
        "send",
        json!({"draftId":d["id"],"hash":d["hash"],"confirmed":true}),
    )
    .await;
    assert_eq!(status, StatusCode::OK, "{out}");
    assert_eq!(out["receipt"]["status"], "simulation");
    assert!(
        out["conversation"]["messages"]
            .as_array()
            .unwrap()
            .last()
            .unwrap()["text"]
            .as_str()
            .unwrap()
            .starts_with("SİMÜLASYON")
    );
    assert_eq!(
        call(
            &app,
            "send",
            json!({"draftId":d["id"],"hash":d["hash"],"confirmed":true})
        )
        .await
        .0,
        StatusCode::BAD_REQUEST
    );
    let (_, unchanged) = call(&app, "conversation", json!({"id":c.id})).await;
    assert_eq!(unchanged, serde_json::to_value(&c).unwrap());
    let (_, x) = call(&app, "prepare", request(&c, "continue", "openai")).await;
    let d = &x["draft"];
    assert_eq!(
        call(&app, "revoke", json!({"draftId":d["id"]})).await.0,
        StatusCode::OK
    );
    assert_eq!(
        call(
            &app,
            "send",
            json!({"draftId":d["id"],"hash":d["hash"],"confirmed":true})
        )
        .await
        .0,
        StatusCode::BAD_REQUEST
    );
    assert_eq!(
        call(
            &app,
            "key",
            json!({"key":"sk-or-v1-never-persist-this-secret"})
        )
        .await
        .0,
        StatusCode::OK
    );
    assert!(
        !std::fs::read_to_string(p.join("workspace-v1.json"))
            .unwrap()
            .contains("never-persist")
    );
    drop(app);
    let app = router(
        p.clone(),
        "test-token".into(),
        "http://127.0.0.1:12345".into(),
    )
    .unwrap();
    let (_, status) = call(&app, "status", json!({})).await;
    assert_eq!(status["conversationCount"], 2);
    assert_eq!(status["keyConfigured"], false);
    drop(app);
    std::fs::remove_dir_all(p).unwrap();
}
#[tokio::test]
async fn host_origin_token_and_missing_confirmation_block_access() {
    let p = dir();
    let app = router(
        p.clone(),
        "test-token".into(),
        "http://127.0.0.1:12345".into(),
    )
    .unwrap();
    for (host, origin, token) in [
        ("evil.test", "http://127.0.0.1:12345", "test-token"),
        ("127.0.0.1:12345", "https://evil.test", "test-token"),
        ("127.0.0.1:12345", "http://127.0.0.1:12345", "wrong"),
    ] {
        let resp = app
            .clone()
            .oneshot(
                Request::builder()
                    .method("POST")
                    .uri("/api/private/tore/status")
                    .header("host", host)
                    .header("origin", origin)
                    .header("authorization", format!("Bearer {token}"))
                    .header("content-type", "application/json")
                    .body(Body::from("{}"))
                    .unwrap(),
            )
            .await
            .unwrap();
        assert_eq!(resp.status(), StatusCode::FORBIDDEN);
    }
    drop(app);
    std::fs::remove_dir_all(p).unwrap();
}
#[tokio::test]
async fn ten_families_simulation_and_redaction_guard() {
    let p = dir();
    let app = router(
        p.clone(),
        "test-token".into(),
        "http://127.0.0.1:12345".into(),
    )
    .unwrap();
    let c = import(&app).await;
    for dev in transport::developers().as_array().unwrap() {
        let developer = dev["id"].as_str().unwrap();
        let (status, x) = call(&app, "prepare", request(&c, "continue", developer)).await;
        assert_eq!(status, StatusCode::OK, "{x}");
        let d = &x["draft"];
        let (status, out) = call(
            &app,
            "send",
            json!({"draftId":d["id"],"hash":d["hash"],"confirmed":true}),
        )
        .await;
        assert_eq!(status, StatusCode::OK, "{out}");
        assert_eq!(out["receipt"]["developer"], developer);
    }
    for secret in [
        "test.person@example.test",
        "sk-or-v1-secret123456",
        "/Users/test/secret.txt",
        "C:\\Users\\test\\secret.txt",
    ] {
        let mut r = request(&c, "continue", "openai");
        r["items"][0]["text"] = json!(secret);
        let (_, x) = call(&app, "prepare", r).await;
        assert!(!x["findings"].as_array().unwrap().is_empty(), "{secret}");
        let d = &x["draft"];
        assert_eq!(
            call(
                &app,
                "send",
                json!({"draftId":d["id"],"hash":d["hash"],"confirmed":true})
            )
            .await
            .0,
            StatusCode::BAD_REQUEST
        );
    }
    drop(app);
    std::fs::remove_dir_all(p).unwrap();
}
#[test]
fn ai_authorship_cannot_be_promoted() {
    let c = Conversation {
        schema_version: 1,
        id: "c".into(),
        provider: "openai".into(),
        source_app: "test".into(),
        source_conversation_id: "s".into(),
        title: "test".into(),
        created_at: None,
        updated_at: None,
        selected_leaf_id: Some("m".into()),
        messages: vec![Message {
            id: "m".into(),
            source_id: "m".into(),
            parent_id: None,
            role: "assistant".into(),
            model: None,
            phase: None,
            text: "AI inference".into(),
            attachments: vec![],
            timestamp: None,
            source_locator: "".into(),
            authorship_status: "ai_output".into(),
        }],
        warnings: vec![],
    };
    let mut r = request(&c, "continue", "openai");
    assert!(policy::prepare(&c, serde_json::from_value(r.clone()).unwrap()).is_err());
    r["items"][0]["authorship"] = json!("ai_output");
    assert!(policy::prepare(&c, serde_json::from_value(r).unwrap()).is_ok());
}
#[tokio::test]
async fn dataset_intent_and_export_operation_are_removed() {
    let p = dir();
    let app = router(
        p.clone(),
        "test-token".into(),
        "http://127.0.0.1:12345".into(),
    )
    .unwrap();
    let c = import(&app).await;
    let mut r = request(&c, "dataset", "openai");
    r["mode"] = json!("manual");
    let (status, out) = call(&app, "prepare", r).await;
    assert_eq!(status, StatusCode::BAD_REQUEST);
    assert_eq!(out["error"], "Taslak seçimi geçersiz");
    let mut r = request(&c, "continue", "openai");
    r["purpose"] = json!("training");
    assert_eq!(call(&app, "prepare", r).await.0, StatusCode::BAD_REQUEST);
    let (_, x) = call(&app, "prepare", request(&c, "continue", "openai")).await;
    let d = x["draft"].clone();
    assert!(d.get("purpose").is_none());
    let (status, out) = call(
        &app,
        "export",
        json!({"draftId":d["id"],"hash":d["hash"],"confirmed":true}),
    )
    .await;
    assert_eq!(status, StatusCode::BAD_REQUEST);
    assert_eq!(out["error"], "Bilinmeyen Töre işlemi");
    drop(app);
    // A draft stored by an older version with the removed intent still loads but cannot run.
    let file = p.join("workspace-v1.json");
    let mut stored: Value = serde_json::from_slice(&std::fs::read(&file).unwrap()).unwrap();
    let old = &mut stored["drafts"][d["id"].as_str().unwrap()];
    old["intent"] = json!("dataset");
    old["purpose"] = json!("training");
    std::fs::write(&file, serde_json::to_vec(&stored).unwrap()).unwrap();
    let app = router(
        p.clone(),
        "test-token".into(),
        "http://127.0.0.1:12345".into(),
    )
    .unwrap();
    let (status, list) = call(&app, "drafts", json!({})).await;
    assert_eq!(status, StatusCode::OK, "{list}");
    assert_eq!(list["drafts"][0]["intent"], "dataset");
    assert_eq!(
        call(
            &app,
            "send",
            json!({"draftId":d["id"],"hash":d["hash"],"confirmed":true})
        )
        .await
        .0,
        StatusCode::BAD_REQUEST
    );
    drop(app);
    std::fs::remove_dir_all(p).unwrap();
}

#[test]
fn continuation_retains_prior_model_and_timestamp() {
    let c = Conversation {
        schema_version: 1,
        id: "c".into(),
        provider: "openai".into(),
        source_app: "test".into(),
        source_conversation_id: "s".into(),
        title: "test".into(),
        created_at: None,
        updated_at: None,
        selected_leaf_id: Some("m".into()),
        messages: vec![Message {
            id: "m".into(),
            source_id: "m".into(),
            parent_id: None,
            role: "assistant".into(),
            model: Some("original-source-model".into()),
            phase: None,
            text: "AI inference".into(),
            attachments: vec![],
            timestamp: Some("2026-01-01T00:00:00Z".into()),
            source_locator: "".into(),
            authorship_status: "ai_output".into(),
        }],
        warnings: vec![],
    };
    let mut r = request(&c, "continue", "anthropic");
    r["items"][0]["authorship"] = json!("ai_output");
    let (d, _) = policy::prepare(&c, serde_json::from_value(r).unwrap()).unwrap();
    let b = policy::branch(&d, "SİMÜLASYON".into());
    assert_eq!(b.messages[0].model, c.messages[0].model);
    assert_eq!(b.messages[0].timestamp, c.messages[0].timestamp);
    assert_eq!(b.messages.last().unwrap().model, None);
}

fn reimport_sample(source_id: &str) -> Value {
    json!({"conversation_id":source_id,"title":"Synthetic reimport","current_node":"m",
        "mapping":{"m":{"parent":null,"message":{"id":"source-message","author":{"role":"assistant"},
        "create_time":1700000000,"metadata":{"model_slug":"original-model"},
        "content":{"content_type":"text","parts":["Unchanged synthetic content"]}}}}})
}

#[tokio::test]
async fn reimport_changed_file_and_array_position_skips_and_preserves_original() {
    let p = dir();
    let app = router(
        p.clone(),
        "test-token".into(),
        "http://127.0.0.1:12345".into(),
    )
    .unwrap();
    let a = reimport_sample("source-a");
    let content = base64::engine::general_purpose::STANDARD
        .encode(serde_json::to_vec(&json!([a.clone()])).unwrap());
    let (status, first) = call(
        &app,
        "import-preview",
        json!({"provider":"chatgpt","fileName":"conversations.json","contentBase64":content}),
    )
    .await;
    assert_eq!(status, StatusCode::OK, "{first}");
    let original = first["conversations"][0].clone();
    let (status, _) = call(
        &app,
        "import-commit",
        json!({"previewId":first["previewId"],"selectedIds":[original["id"]]}),
    )
    .await;
    assert_eq!(status, StatusCode::OK);

    let content = base64::engine::general_purpose::STANDARD
        .encode(serde_json::to_vec(&json!([reimport_sample("source-b"), a])).unwrap());
    let (status, incoming) = call(
        &app,
        "import-preview",
        json!({"provider":"chatgpt","fileName":"conversations-1.json","contentBase64":content}),
    )
    .await;
    assert_eq!(status, StatusCode::OK, "{incoming}");
    assert_eq!(incoming["conversations"][1]["id"], original["id"]);
    assert_ne!(
        incoming["conversations"][1]["messages"][0]["sourceLocator"],
        original["messages"][0]["sourceLocator"]
    );
    let ids: Vec<Value> = incoming["conversations"]
        .as_array()
        .unwrap()
        .iter()
        .map(|c| c["id"].clone())
        .collect();
    let (status, committed) = call(
        &app,
        "import-commit",
        json!({"previewId":incoming["previewId"],"selectedIds":ids}),
    )
    .await;
    assert_eq!(status, StatusCode::OK, "{committed}");
    assert_eq!(committed["imported"], 1);
    assert_eq!(committed["skipped"], 1);
    assert_eq!(
        committed["conversations"]
            .as_array()
            .unwrap()
            .iter()
            .find(|c| c["id"] == original["id"])
            .unwrap(),
        &original
    );
    assert_eq!(
        call(&app, "conversation", json!({"id":original["id"]}))
            .await
            .1,
        original
    );
    drop(app);
    std::fs::remove_dir_all(p).unwrap();
}

#[test]
fn reimport_comparison_rejects_non_location_changes() {
    let parsed = importers::parse(
        "chatgpt",
        "conversations.json",
        &serde_json::to_vec(&json!([reimport_sample("source-a")])).unwrap(),
    )
    .unwrap();
    let old = &parsed[0];
    let mut location_only = old.clone();
    location_only.messages[0].source_locator = "another-file.json#$[99]".into();
    assert!(same_import_except_location(old, &location_only));
    for (field, value) in [
        ("model", json!("different-model")),
        ("timestamp", json!("2026-01-01T00:00:00Z")),
        ("parentId", json!("different-parent")),
        ("text", json!("Different content")),
        ("role", json!("user")),
        ("sourceId", json!("different-original-message")),
        ("authorshipStatus", json!("human_original")),
        ("attachments", json!(["different-attachment"])),
    ] {
        let mut changed = serde_json::to_value(&location_only).unwrap();
        changed["messages"][0][field] = value;
        let changed: Conversation = serde_json::from_value(changed).unwrap();
        assert!(
            !same_import_except_location(old, &changed),
            "must preserve {field}"
        );
    }
    let mut changed = location_only;
    changed.updated_at = Some("2026-01-01T00:00:00Z".into());
    assert!(!same_import_except_location(old, &changed));
}
#[tokio::test]
async fn interface_language_is_saved_beside_the_notebook_and_backups_ignore_it() {
    let p = dir();
    let app = router(p.clone(), "test-token".into(), "http://127.0.0.1:12345".into()).unwrap();
    assert_eq!(call(&app, "ui-language-get", json!({})).await, (StatusCode::OK, json!({"language": null})));
    let (status, saved) = call(&app, "ui-language-set", json!({"language": "en"})).await;
    assert_eq!((status, saved), (StatusCode::OK, json!({"language": "en"})));
    let (status, bad) = call(&app, "ui-language-set", json!({"language": "de"})).await;
    assert_eq!(status, StatusCode::BAD_REQUEST);
    assert_eq!(bad["error"], "Desteklenmeyen arayüz dili");
    // A record backup taken now and restored after another switch leaves the
    // language alone, and restoring does not fail because of it.
    let (status, backup) = call(&app, "records-backup", json!({})).await;
    assert_eq!(status, StatusCode::OK, "{backup}");
    call(&app, "ui-language-set", json!({"language": "tr"})).await;
    let (status, restored) = call(
        &app,
        "records-restore",
        json!({"backupId": backup["backupId"], "expectedStateHash": backup["stateHash"], "confirmedByUser": true}),
    )
    .await;
    assert_eq!(status, StatusCode::OK, "{restored}");
    assert_eq!(call(&app, "ui-language-get", json!({})).await.1, json!({"language": "tr"}));
    let backups = std::fs::read_dir(p.join("records-backups")).unwrap();
    for entry in backups {
        let text = std::fs::read_to_string(entry.unwrap().path()).unwrap();
        assert!(!text.contains("ui-language"));
    }
    drop(app);
    // The choice survives a new launch with a new port and token.
    let app = router(p.clone(), "other-token".into(), "http://127.0.0.1:23456".into()).unwrap();
    let resp = app
        .clone()
        .oneshot(
            Request::builder()
                .method("POST")
                .uri("/api/private/tore/ui-language-get")
                .header("host", "127.0.0.1:23456")
                .header("origin", "http://127.0.0.1:23456")
                .header("authorization", "Bearer other-token")
                .header("content-type", "application/json")
                .body(Body::from("{}"))
                .unwrap(),
        )
        .await
        .unwrap();
    assert_eq!(resp.status(), StatusCode::OK);
    let bytes = resp.into_body().collect().await.unwrap().to_bytes();
    assert_eq!(serde_json::from_slice::<Value>(&bytes).unwrap(), json!({"language": "tr"}));
    // Without the session token the preference can be neither read nor written.
    let resp = app
        .clone()
        .oneshot(
            Request::builder()
                .method("POST")
                .uri("/api/private/tore/ui-language-set")
                .header("host", "127.0.0.1:23456")
                .header("origin", "http://127.0.0.1:23456")
                .header("authorization", "Bearer test-token")
                .header("content-type", "application/json")
                .body(Body::from("{\"language\":\"en\"}"))
                .unwrap(),
        )
        .await
        .unwrap();
    assert_eq!(resp.status(), StatusCode::FORBIDDEN);
    drop(app);
    std::fs::remove_dir_all(p).unwrap();
}
