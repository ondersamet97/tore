//! Töre 0.3.0 saf alan çekirdeği: JSON yapısı ve insan tarafından yazılan kayıtları doğrular.
//! Kimlik, imza, davet, hedefin varlığı ve erişim denetimi sunucunun sorumluluğudur.
use serde::{Deserialize, Deserializer, Serialize};
use serde_json::{Value, json};
use wasm_bindgen::prelude::*;

const MAX_JSON_BYTES: usize = 2_000_000;
const MAX_TEXT_CHARS: usize = 100_000;

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "lowercase")]
pub enum Area {
    Past,
    Present,
    Future,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "lowercase")]
pub enum ViewKind {
    Position,
    Prediction,
    Question,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct Post {
    pub title: String,
    pub text: String,
    pub topic: String,
    pub subtopic: String,
    pub area: Area,
    pub view_type: ViewKind,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(deny_unknown_fields)]
pub struct Source {
    pub label: String,
    pub url: String,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(deny_unknown_fields)]
pub struct ComparisonSide {
    pub id: String,
    pub question: String,
    pub text: String,
    pub area: Area,
    pub kind: ViewKind,
    pub bridge: String,
    pub sources: Vec<Source>,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "lowercase")]
pub enum DifferenceCategory {
    Fact,
    Prediction,
    Value,
    Goal,
    Method,
    Scope,
    Unclear,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct Assessment {
    pub common_question: String,
    pub category: DifferenceCategory,
    pub shared_ground: String,
    pub difference: String,
    pub left_evidence: Vec<String>,
    pub right_evidence: Vec<String>,
    pub open_questions: Vec<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(deny_unknown_fields)]
pub struct Comparison {
    pub left: ComparisonSide,
    pub right: ComparisonSide,
    pub assessment: Assessment,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "lowercase")]
pub enum FollowScope {
    Author,
    Topic,
    Post,
    Discussion,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct Follow {
    pub scope: FollowScope,
    pub target_id: String,
    #[serde(deserialize_with = "required_nullable")]
    pub topic: Option<String>,
    #[serde(deserialize_with = "required_nullable")]
    pub subtopic: Option<String>,
    #[serde(deserialize_with = "required_nullable")]
    pub area: Option<Area>,
    pub notify_posts: bool,
    pub notify_changes: bool,
    pub notify_replies: bool,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(
    tag = "type",
    content = "payload",
    rename_all = "lowercase",
    deny_unknown_fields
)]
enum Event {
    Post(Post),
    Comparison(Comparison),
    Follow(Follow),
}

fn field(value: &str, label: &str, min: usize, max: usize, multiline: bool) -> Result<(), String> {
    let len = value.chars().count();
    if len > max || value.trim().chars().count() < min {
        return Err(format!(
            "{label}: {min}–{max} karakter aralığında bir metin girin."
        ));
    }
    if value
        .chars()
        .any(|c| c.is_control() && !(multiline && ['\n', '\r', '\t'].contains(&c)))
    {
        return Err(format!(
            "{label}: desteklenmeyen kontrol karakteri içeriyor."
        ));
    }
    Ok(())
}

fn optional_field(value: &Option<String>, label: &str, max: usize) -> Result<(), String> {
    if let Some(text) = value {
        field(text, label, 1, max, false)?;
    }
    Ok(())
}

fn required_nullable<'de, D, T>(deserializer: D) -> Result<Option<T>, D::Error>
where
    D: Deserializer<'de>,
    T: Deserialize<'de>,
{
    Option::<T>::deserialize(deserializer)
}

fn http_url(value: &str) -> Result<(), String> {
    if value.is_empty() {
        return Ok(());
    }
    field(value, "Kaynak bağlantısı", 1, 2048, false)?;
    if value.to_ascii_lowercase().starts_with("https:///")
        || value.to_ascii_lowercase().starts_with("http:///")
        || value.chars().any(char::is_whitespace)
        || value.contains('\\')
        || !value.to_ascii_lowercase().starts_with("http://")
            && !value.to_ascii_lowercase().starts_with("https://")
    {
        return Err(
            "Kaynak bağlantısında yalnız geçerli HTTP/HTTPS adresleri kullanılabilir.".into(),
        );
    }
    let parsed = url::Url::parse(value)
        .map_err(|_| "Kaynak bağlantısı geçerli HTTP/HTTPS adresi olmalı.".to_string())?;
    if !["http", "https"].contains(&parsed.scheme())
        || parsed.host_str().is_none()
        || !parsed.username().is_empty()
        || parsed.password().is_some()
    {
        return Err(
            "Kaynak bağlantısı geçerli, kimlik bilgisi içermeyen HTTP/HTTPS adresi olmalı.".into(),
        );
    }
    Ok(())
}

impl Post {
    pub fn validate(&self) -> Result<(), String> {
        field(&self.title, "Başlık", 1, 200, false)?;
        field(&self.text, "Yayın metni", 1, MAX_TEXT_CHARS, true)?;
        field(&self.topic, "Konu", 1, 120, false)?;
        field(&self.subtopic, "Alt konu", 0, 120, false)?;
        Ok(())
    }
}
impl ComparisonSide {
    fn validate(&self, label: &str) -> Result<(), String> {
        field(&self.id, &format!("{label} kimliği"), 1, 200, false)?;
        field(&self.question, &format!("{label} sorusu"), 1, 1000, true)?;
        field(
            &self.text,
            &format!("{label} metni"),
            1,
            MAX_TEXT_CHARS,
            true,
        )?;
        field(
            &self.bridge,
            &format!("{label} zamanlar arası gerekçesi"),
            0,
            10_000,
            true,
        )?;
        if self.sources.len() > 32 {
            return Err("Bir karşılaştırma tarafı en fazla 32 kaynak içerebilir.".into());
        }
        for source in &self.sources {
            field(&source.label, "Kaynak başlığı", 1, 500, false)?;
            http_url(&source.url)?;
        }
        Ok(())
    }
}
fn evidence(values: &[String], original: &str, label: &str) -> Result<(), String> {
    if values.is_empty() || values.len() > 32 {
        return Err(format!("{label}: metinden seçilmiş 1–32 alıntı gerekli."));
    }
    for (i, quote) in values.iter().enumerate() {
        field(quote, label, 1, 10_000, true)?;
        if !original.contains(quote) {
            return Err(format!(
                "{label}: seçilen alıntı kaynak metinde birebir bulunamadı."
            ));
        }
        if values[..i].contains(quote) {
            return Err(format!("{label}: aynı alıntı birden fazla kez seçildi."));
        }
    }
    Ok(())
}
impl Comparison {
    pub fn validate(&self) -> Result<(), String> {
        self.left.validate("Sol taraf")?;
        self.right.validate("Sağ taraf")?;
        if self.left.id == self.right.id {
            return Err("Karşılaştırmak için iki farklı kayıt seçin.".into());
        }
        field(
            &self.assessment.common_question,
            "Kullanıcının belirttiği ortak soru",
            1,
            1000,
            true,
        )?;
        field(
            &self.assessment.shared_ground,
            "Kullanıcının belirttiği ortak zemin",
            0,
            10_000,
            true,
        )?;
        field(
            &self.assessment.difference,
            "Kullanıcının belirttiği ayrışma",
            0,
            10_000,
            true,
        )?;
        evidence(
            &self.assessment.left_evidence,
            &self.left.text,
            "Sol metin alıntısı",
        )?;
        evidence(
            &self.assessment.right_evidence,
            &self.right.text,
            "Sağ metin alıntısı",
        )?;
        if self.assessment.open_questions.len() > 32 {
            return Err("En fazla 32 açık soru kaydedilebilir.".into());
        }
        for question in &self.assessment.open_questions {
            field(question, "Açık soru", 1, 2000, true)?;
        }
        Ok(())
    }
}
impl Follow {
    pub fn validate(&self) -> Result<(), String> {
        field(&self.target_id, "Takip hedefi", 1, 200, false)?;
        optional_field(&self.topic, "Takip konusu", 120)?;
        optional_field(&self.subtopic, "Takip alt konusu", 120)?;
        if self.subtopic.is_some() && self.topic.is_none() {
            return Err("Alt konu takibinde ana konuyu da belirtin.".into());
        }
        Ok(())
    }
}

fn parse<T: for<'de> Deserialize<'de>>(input: &str) -> Result<T, String> {
    if input.len() > MAX_JSON_BYTES {
        return Err("JSON kaydı 2 MB sınırını aşıyor.".into());
    }
    serde_json::from_str(input).map_err(|error| format!("JSON yapısı geçersiz: {error}"))
}
fn response(result: Result<Value, String>) -> String {
    let value = match result {
        Ok(value) => json!({"ok":true,"value":value}),
        Err(error) => json!({"ok":false,"error":error}),
    };
    serde_json::to_string(&value)
        .unwrap_or_else(|_| "{\"ok\":false,\"error\":\"JSON sonucu oluşturulamadı.\"}".into())
}
fn validated<T: Serialize>(
    value: T,
    check: impl FnOnce(&T) -> Result<(), String>,
) -> Result<Value, String> {
    check(&value)?;
    serde_json::to_value(value).map_err(|_| "JSON sonucu oluşturulamadı.".into())
}

/// JSON'u alan kaydına çevirir; aynı şema native sunucuda ve WASM'da kullanılır.
pub fn validate_post_json(input: &str) -> Result<Post, String> {
    let value = parse::<Post>(input)?;
    value.validate()?;
    Ok(value)
}
pub fn validate_comparison_json(input: &str) -> Result<Comparison, String> {
    let value = parse::<Comparison>(input)?;
    value.validate()?;
    Ok(value)
}
pub fn validate_follow_json(input: &str) -> Result<Follow, String> {
    let value = parse::<Follow>(input)?;
    value.validate()?;
    Ok(value)
}

#[wasm_bindgen]
pub fn validate_post(input: &str) -> String {
    response(parse::<Post>(input).and_then(|value| validated(value, Post::validate)))
}
#[wasm_bindgen]
pub fn validate_comparison(input: &str) -> String {
    response(parse::<Comparison>(input).and_then(|value| validated(value, Comparison::validate)))
}
#[wasm_bindgen]
pub fn validate_follow(input: &str) -> String {
    response(parse::<Follow>(input).and_then(|value| validated(value, Follow::validate)))
}
#[wasm_bindgen]
pub fn validate_event(input: &str) -> String {
    response(parse::<Event>(input).and_then(|event| match event {
        Event::Post(value) => validated(value, Post::validate),
        Event::Comparison(value) => validated(value, Comparison::validate),
        Event::Follow(value) => validated(value, Follow::validate),
    }))
}
#[wasm_bindgen]
pub fn compare(input: &str) -> String {
    validate_comparison(input)
}

#[cfg(test)]
mod tests {
    use super::*;
    fn result(raw: String) -> Value {
        serde_json::from_str(&raw).unwrap()
    }
    fn post() -> Value {
        json!({"title":"Türkçe deneme","text":"İnsanların görüşü ıİşğüöç ile korunur.","topic":"etik","subtopic":"katılım","area":"present","viewType":"position"})
    }
    fn side(id: &str, text: &str) -> Value {
        json!({"id":id,"question":"Katılım nasıl olmalı?","text":text,"area":"present","kind":"position","bridge":"","sources":[{"label":"Katılımcının kaynağı","url":"https://example.org/source"}]})
    }
    fn comparison() -> Value {
        json!({"left":side("a","Ben gönüllü katılımı savunuyorum; gerekçem özgürlüktür."),"right":side("b","Ben düzenli katılımı savunuyorum; gerekçem sürekliliktir."),"assessment":{"commonQuestion":"Katılım nasıl olmalı?","category":"value","sharedGround":"","difference":"Kullanıcının yazdığı öncelik farkı.","leftEvidence":["gönüllü katılımı"],"rightEvidence":["düzenli katılımı"],"openQuestions":["Süre kesinleşti mi?"]}})
    }
    fn follow() -> Value {
        json!({"scope":"author","targetId":"ed25519:synthetic","topic":null,"subtopic":null,"area":null,"notifyPosts":true,"notifyChanges":false,"notifyReplies":false})
    }
    #[test]
    fn post_preserves_unicode_text_and_explicit_kind() {
        let value = post();
        let output = result(validate_post(&value.to_string()));
        assert_eq!(output["ok"], true);
        assert_eq!(output["value"], value);
    }
    #[test]
    fn post_rejects_unknown_fields_blank_text_and_wrong_enums() {
        for (key, value) in [
            ("text", json!("  ")),
            ("area", json!("all")),
            ("viewType", json!("fact")),
            ("authorId", json!("forged")),
        ] {
            let mut data = post();
            data[key] = value;
            assert_eq!(result(validate_post(&data.to_string()))["ok"], false);
        }
    }
    #[test]
    fn unicode_limit_counts_characters_instead_of_utf8_bytes() {
        let mut data = post();
        data["title"] = json!("ö".repeat(200));
        assert_eq!(result(validate_post(&data.to_string()))["ok"], true);
        data["title"] = json!("ö".repeat(201));
        assert_eq!(result(validate_post(&data.to_string()))["ok"], false);
    }
    #[test]
    fn html_stays_untrusted_text_and_nul_rejected() {
        let mut data = post();
        data["text"] = json!("<script>evil()</script> kullanıcı metnidir");
        assert_eq!(
            result(validate_post(&data.to_string()))["value"]["text"],
            data["text"]
        );
        data["text"] = json!("bozuk\0metin");
        assert_eq!(result(validate_post(&data.to_string()))["ok"], false);
    }
    #[test]
    fn comparison_preserves_user_assessment_without_generating_conclusions() {
        let data = comparison();
        let output = result(validate_comparison(&data.to_string()));
        assert_eq!(output["ok"], true);
        assert_eq!(output["value"], data);
        assert_eq!(output["value"]["assessment"]["sharedGround"], "");
    }
    #[test]
    fn comparison_requires_literal_unicode_evidence() {
        let mut data = comparison();
        data["assessment"]["leftEvidence"] = json!(["özgürlüktür"]);
        assert_eq!(result(compare(&data.to_string()))["ok"], true);
        data["assessment"]["leftEvidence"] = json!(["özgürlük kesin olarak en iyidir"]);
        assert_eq!(result(compare(&data.to_string()))["ok"], false);
    }
    #[test]
    fn comparison_rejects_missing_evidence_and_same_record() {
        let mut data = comparison();
        data["assessment"]["rightEvidence"] = json!([]);
        assert_eq!(result(compare(&data.to_string()))["ok"], false);
        data = comparison();
        data["right"]["id"] = json!("a");
        assert_eq!(result(compare(&data.to_string()))["ok"], false);
    }
    #[test]
    fn comparison_blocks_active_and_local_source_protocols() {
        for url in [
            "javascript:alert(1)",
            "data:text/html,evil",
            "file:///etc/passwd",
            "//example.org/x",
            "https:///missing",
            "https://user:pass@example.org/",
            "https://example.org\\@evil.invalid",
        ] {
            let mut data = comparison();
            data["left"]["sources"][0]["url"] = json!(url);
            assert_eq!(result(compare(&data.to_string()))["ok"], false, "{url}");
        }
    }
    #[test]
    fn follow_allows_topic_without_author_and_retains_flags() {
        let mut data = follow();
        data["scope"] = json!("topic");
        data["targetId"] = json!("etik");
        data["topic"] = json!("etik");
        let output = result(validate_follow(&data.to_string()));
        assert_eq!(output["ok"], true);
        assert_eq!(output["value"], data);
    }
    #[test]
    fn follow_rejects_subtopic_without_topic_or_invalid_area() {
        let mut data = follow();
        data["subtopic"] = json!("katılım");
        assert_eq!(result(validate_follow(&data.to_string()))["ok"], false);
        data = follow();
        data["area"] = json!("everything");
        assert_eq!(result(validate_follow(&data.to_string()))["ok"], false);
    }
    #[test]
    fn follow_accepts_silent_subscription_and_post_discussion_scopes() {
        for scope in ["author", "topic", "post", "discussion"] {
            let mut data = follow();
            data["scope"] = json!(scope);
            data["notifyPosts"] = json!(false);
            assert_eq!(result(validate_follow(&data.to_string()))["ok"], true);
        }
    }
    #[test]
    fn dispatcher_uses_same_rules_and_rejects_invalid_or_extra_envelope() {
        let data = json!({"type":"post","payload":post()});
        assert_eq!(
            result(validate_event(&data.to_string())),
            result(validate_post(&post().to_string()))
        );
        assert_eq!(result(validate_event("{bozuk"))["ok"], false);
        assert_eq!(
            result(validate_event("{\"type\":\"delete\",\"payload\":{}}"))["ok"],
            false
        );
        let mut extra = data;
        extra["authorId"] = json!("forged");
        assert_eq!(result(validate_event(&extra.to_string()))["ok"], false);
    }
    #[test]
    fn native_json_api_matches_wrappers() {
        let data = post();
        let native = validate_post_json(&data.to_string()).unwrap();
        assert_eq!(serde_json::to_value(native).unwrap(), data);
        assert!(validate_post_json("{}").is_err());
        assert!(validate_comparison_json(&comparison().to_string()).is_ok());
        assert!(validate_follow_json(&follow().to_string()).is_ok());
    }
    #[test]
    fn follow_nullable_fields_are_required_but_null_is_allowed() {
        let mut data = follow();
        data.as_object_mut().unwrap().remove("topic");
        assert_eq!(result(validate_follow(&data.to_string()))["ok"], false);
        assert_eq!(result(validate_follow(&follow().to_string()))["ok"], true);
    }
    #[test]
    fn bibliographic_source_without_url_is_preserved_without_fetching() {
        let mut data = comparison();
        data["left"]["sources"][0]["url"] = json!("");
        assert_eq!(result(compare(&data.to_string()))["value"], data);
    }
    #[test]
    fn duplicate_json_fields_are_not_silently_accepted() {
        let raw = "{\"scope\":\"author\",\"scope\":\"topic\",\"targetId\":\"a\",\"topic\":null,\"subtopic\":null,\"area\":null,\"notifyPosts\":true,\"notifyChanges\":false,\"notifyReplies\":false}";
        assert_eq!(result(validate_follow(raw))["ok"], false);
    }
}
