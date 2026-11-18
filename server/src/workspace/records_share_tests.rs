use super::*;
use std::{fs, path::PathBuf};

fn data_dir() -> PathBuf {
    let p = std::env::temp_dir()
        .canonicalize()
        .unwrap()
        .join(format!("tore-share-{}", id()));
    fs::create_dir_all(&p).unwrap();
    p
}
fn store_file(data: &Path) -> Vec<u8> {
    fs::read(data.join("conversations").join("records-v1.json")).unwrap()
}
fn listing(dir: &Path) -> Vec<String> {
    let mut out = vec![];
    for entry in fs::read_dir(dir).unwrap() {
        let entry = entry.unwrap();
        let meta = entry.metadata().unwrap();
        out.push(format!(
            "{} {} {:?}",
            entry.path().display(),
            meta.len(),
            meta.modified().unwrap()
        ));
        if meta.is_dir() {
            out.extend(listing(&entry.path()));
        }
    }
    out.sort();
    out
}
/// Topic, two adopted decisions, one hidden unselected record and one packet.
fn prepared(d: &mut Disk, question: &str) -> (String, Value) {
    let topic = d
        .topic_create(json!({"title":"SENTETİK konu","goal":"SENTETİK amaç"}))
        .unwrap()["topic"]["id"]
        .as_str()
        .unwrap()
        .to_owned();
    let mut ids = vec![];
    for text in ["SENTETİK seçilen karar", "SENTETİK GİZLİ SEÇİLMEMİŞ KAYIT"] {
        let r = d
            .record_create(
                json!({"topicId":topic,"kind":"decision","text":text,"reason":"SENTETİK gerekçe"}),
                &BTreeMap::new(),
            )
            .unwrap()["record"]
            .clone();
        let r = d.review(json!({"id":r["id"],"expectedRevision":1,"text":text,"reason":"SENTETİK gerekçe","review":"reviewed","adoption":"adopted","currency":"current","priority":"active","questionState":"not_applicable","changeReason":"SENTETİK onay","confirmedByUser":true})).unwrap()["record"].clone();
        ids.push(r["id"].clone());
    }
    let packet = d.prepare(json!({"topicId":topic,"recordIds":[ids[0]],"proposalIds":[],"target":"claude","question":question,"confirmedByUser":true})).unwrap()["packet"].clone();
    (topic, packet)
}
fn share(d: &mut Disk, packet: &Value, shared: bool) -> Result<Value, String> {
    d.share(json!({"packetId":packet["id"],"shared":shared,"confirmedByUser":true}))
}

#[test]
fn share_requires_consent_and_an_existing_packet_and_is_idempotent() {
    let data = data_dir();
    let mut d = Disk::open(data.join("conversations")).unwrap();
    let (_, packet) = prepared(&mut d, "SENTETİK soru");
    let before = store_file(&data);
    assert!(!String::from_utf8_lossy(&before).contains("sharedWithTools"));
    assert!(
        d.share(json!({"packetId":packet["id"],"shared":true,"confirmedByUser":false}))
            .is_err()
    );
    assert!(
        d.share(json!({"packetId":packet["id"],"shared":true}))
            .is_err()
    );
    assert!(
        d.share(json!({"packetId":packet["id"],"shared":"yes","confirmedByUser":true}))
            .is_err()
    );
    assert!(
        d.share(json!({"packetId":packet["id"],"shared":true,"confirmedByUser":true,"extra":1}))
            .is_err()
    );
    assert!(
        d.share(json!({"packetId":"missing","shared":true,"confirmedByUser":true}))
            .is_err()
    );
    assert_eq!(store_file(&data), before, "refused requests write nothing");

    let first = share(&mut d, &packet, true).unwrap();
    assert_eq!(first["changed"], true);
    assert_eq!(first["packet"]["sharedWithTools"], true);
    let opened = store_file(&data);
    assert!(String::from_utf8_lossy(&opened).contains("\"sharedWithTools\":true"));
    let again = share(&mut d, &packet, true).unwrap();
    assert_eq!(again["changed"], false);
    assert_eq!(store_file(&data), opened);
    assert_eq!(share(&mut d, &packet, false).unwrap()["changed"], true);
    assert_eq!(
        store_file(&data),
        before,
        "closing restores the exact bytes"
    );
    assert_eq!(share(&mut d, &packet, false).unwrap()["changed"], false);
    assert_eq!(d.list().unwrap()["packets"][0].get("sharedWithTools"), None);
    drop(d);
    fs::remove_dir_all(data).unwrap();
}

#[test]
fn backup_keeps_the_flag_but_restore_never_reopens_sharing() {
    let data = data_dir();
    let mut d = Disk::open(data.join("conversations")).unwrap();
    let (_, packet) = prepared(&mut d, "SENTETİK soru");
    share(&mut d, &packet, true).unwrap();
    let shared_hash = hash(&d.data).unwrap();
    let backup = d.backup().unwrap();
    assert_eq!(backup["stateHash"], shared_hash);
    let file = data
        .join("conversations/records-backups")
        .join(format!("{}.json", backup["backupId"].as_str().unwrap()));
    assert!(
        fs::read_to_string(&file)
            .unwrap()
            .contains("\"sharedWithTools\":true")
    );
    share(&mut d, &packet, false).unwrap();
    let restored = d
        .restore(
            json!({"backupId":backup["backupId"],"expectedStateHash":hash(&d.data).unwrap(),"confirmedByUser":true}),
            &BTreeMap::new(),
        )
        .unwrap();
    assert_eq!(restored["toolSharingClosed"], 1);
    assert!(!d.data.packets[packet["id"].as_str().unwrap()].shared_with_tools);
    assert!(shared_contexts(&data).unwrap().is_empty());

    // Malformed flag values in a backup are rejected by the typed schema.
    let mut bad: Value = serde_json::from_slice(&fs::read(&file).unwrap()).unwrap();
    let pid = packet["id"].as_str().unwrap();
    bad["data"]["packets"][pid]["sharedWithTools"] = json!("yes");
    let bad_id = id();
    fs::write(
        data.join("conversations/records-backups")
            .join(format!("{bad_id}.json")),
        serde_json::to_vec(&bad).unwrap(),
    )
    .unwrap();
    let before = store_file(&data);
    assert!(
        d.restore(
            json!({"backupId":bad_id,"expectedStateHash":hash(&d.data).unwrap(),"confirmedByUser":true}),
            &BTreeMap::new(),
        )
        .is_err()
    );
    assert_eq!(store_file(&data), before);
    drop(d);
    fs::remove_dir_all(data).unwrap();
}

#[test]
fn shared_contexts_reads_without_lock_or_writes_and_follows_revocation() {
    let data = data_dir();
    // Missing notebook: empty, nothing created.
    assert!(shared_contexts(&data).unwrap().is_empty());
    assert!(listing(&data).is_empty());
    let mut d = Disk::open(data.join("conversations")).unwrap();
    let (_, packet) = prepared(&mut d, "SENTETİK ilk soru\nikinci satır");
    let (_, other) = prepared(&mut d, "SENTETİK paylaşılmayan soru");
    assert!(
        shared_contexts(&data).unwrap().is_empty(),
        "nothing is shared by default"
    );
    share(&mut d, &packet, true).unwrap();
    let before = listing(&data);
    // The running töre still holds its exclusive lock; reading does not need it.
    let contexts = shared_contexts(&data).unwrap();
    assert_eq!(listing(&data), before, "reading writes nothing");
    assert_eq!(contexts.len(), 1);
    let c = &contexts[0];
    assert_eq!(c.id, packet["id"]);
    assert_eq!(c.text, packet["text"]);
    assert_eq!(c.topic_title, "SENTETİK konu");
    assert_eq!(c.target, "claude");
    assert_eq!(c.record_count, 1);
    assert_eq!(c.question, "SENTETİK ilk soru\nikinci satır");
    assert!(!c.text.contains("GİZLİ SEÇİLMEMİŞ"));

    // The MCP handler over the real store: only the shared packet is reachable.
    let load = || shared_contexts(&data);
    let call = |id: &Value| {
        crate::mcp::handle_line(
            &json!({"jsonrpc":"2.0","id":1,"method":"tools/call","params":{"name":"tore_get_shared_context","arguments":{"id":id}}}).to_string(),
            &load,
        )
        .unwrap()
    };
    let got: Value = serde_json::from_str(&call(&packet["id"])).unwrap();
    assert!(
        got["result"]["content"][0]["text"]
            .as_str()
            .unwrap()
            .ends_with(packet["text"].as_str().unwrap())
    );
    let hidden: Value = serde_json::from_str(&call(&other["id"])).unwrap();
    assert_eq!(hidden["result"]["isError"], true);
    let list = crate::mcp::handle_line(
        r#"{"jsonrpc":"2.0","id":2,"method":"tools/call","params":{"name":"tore_list_shared_contexts"}}"#,
        &load,
    )
    .unwrap();
    assert!(!list.contains(other["id"].as_str().unwrap()));
    assert!(!list.contains("GİZLİ SEÇİLMEMİŞ") && !list.contains("paylaşılmayan"));
    share(&mut d, &packet, false).unwrap();
    let revoked: Value = serde_json::from_str(&call(&packet["id"])).unwrap();
    assert_eq!(revoked["result"]["isError"], true);
    drop(d);
    fs::remove_dir_all(data).unwrap();
}

#[test]
fn a_shared_packet_whose_record_a_newer_toere_changed_is_hidden_others_stay() {
    let data = data_dir();
    let mut d = Disk::open(data.join("conversations")).unwrap();
    let (_, kept) = prepared(&mut d, "SENTETİK soru bir");
    let (_, hidden) = prepared(&mut d, "SENTETİK soru iki");
    share(&mut d, &kept, true).unwrap();
    share(&mut d, &hidden, true).unwrap();
    drop(d);
    let file = data.join("conversations/records-v1.json");
    let mut v: Value = serde_json::from_slice(&fs::read(&file).unwrap()).unwrap();
    let record = hidden["recordIds"][0].as_str().unwrap().to_owned();
    v["records"][&record]["futureField"] = json!(true);
    v["futureSection"] = json!([]);
    fs::write(&file, serde_json::to_vec(&v).unwrap()).unwrap();
    let contexts = shared_contexts(&data).unwrap();
    assert_eq!(contexts.len(), 1);
    assert_eq!(contexts[0].id, kept["id"].as_str().unwrap());
    fs::remove_dir_all(data).unwrap();
}
