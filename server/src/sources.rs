//! Explicit, manual, read-only public RSS/Atom retrieval. This module never writes files.
//! Primary registry documentation: https://info.arxiv.org/help/rss.html and
//! https://github.com/arXiv/arxiv-docs/blob/develop/source/help/rss.md .
//! BBC's registry URL is its own live feed; credit BBC News beside displayed items.
//! arXiv items are preprints, not a claim of peer review or verified scientific truth.
//! Build pins: reqwest 0.12.24 (MIT OR Apache-2.0), quick-xml 0.38.3 (MIT),
//! url 2.5.7 (MIT OR Apache-2.0). Upstream package metadata remains authoritative.
use axum::{
    Json, Router,
    extract::{DefaultBodyLimit, State, rejection::JsonRejection},
    http::{HeaderMap, StatusCode},
    response::{IntoResponse, Response},
    routing::{get, post},
};
use quick_xml::{Reader, events::Event};
use serde::{Deserialize, Serialize};
use serde_json::{Value, json};
use sha2::{Digest, Sha256};
use std::{
    collections::{BTreeMap, BTreeSet},
    sync::Arc,
    time::{Duration, Instant},
};
use tokio::sync::Mutex;

const MAX_BODY: usize = 1024 * 1024;
const MAX_ITEMS: usize = 20;
const CACHE_SECONDS: u64 = 30;

#[derive(Clone, Copy, Serialize)]
struct Feed {
    id: &'static str,
    label: &'static str,
    kind: &'static str,
    url: &'static str,
}
const FEEDS: [Feed; 3] = [
    Feed {
        id: "arxiv-ai",
        label: "arXiv — Yapay Zekâ (ön baskı)",
        kind: "paper",
        url: "https://rss.arxiv.org/rss/cs.AI",
    },
    Feed {
        id: "arxiv-social",
        label: "arXiv — Fizik ve Toplum (ön baskı)",
        kind: "paper",
        url: "https://rss.arxiv.org/rss/physics.soc-ph",
    },
    Feed {
        id: "bbc-science",
        label: "BBC News — Bilim ve Çevre",
        kind: "news",
        url: "https://feeds.bbci.co.uk/news/science_and_environment/rss.xml",
    },
];
#[derive(Debug)]
struct SourceError {
    status: StatusCode,
    code: &'static str,
    message: String,
}
type Result<T> = std::result::Result<T, SourceError>;
impl IntoResponse for SourceError {
    fn into_response(self) -> Response {
        (
            self.status,
            Json(json!({"code":self.code,"error":self.message})),
        )
            .into_response()
    }
}
fn fail(status: StatusCode, code: &'static str, message: &str) -> SourceError {
    SourceError {
        status,
        code,
        message: message.into(),
    }
}
fn malformed() -> SourceError {
    fail(
        StatusCode::UNPROCESSABLE_ENTITY,
        "DataError",
        "Akış geçerli ve güvenli UTF-8 RSS/Atom içeriği değil; kaynak eklenmedi.",
    )
}
fn remote() -> SourceError {
    fail(
        StatusCode::BAD_GATEWAY,
        "NetworkError",
        "Kaynak akışı alınamadı. İnternet bağlantısını veya sağlayıcının durumunu kontrol edin; arşiv verisi değişmedi.",
    )
}
fn now() -> String {
    chrono::Utc::now().to_rfc3339_opts(chrono::SecondsFormat::Millis, true)
}
fn hash(s: &str) -> String {
    format!("{:x}", Sha256::digest(s.as_bytes()))
}

#[derive(Clone)]
struct Sources {
    token_hash: [u8; 32],
    origin: String,
    host: String,
    enabled: bool,
    client: Option<reqwest::Client>,
    session: Arc<Mutex<Session>>,
}
#[derive(Default)]
struct Session {
    cache: BTreeMap<&'static str, Cached>,
    arxiv_last: Option<Instant>,
}
struct Cached {
    attempted_at: Instant,
    value: Option<Value>,
}
/// Merge only into the private loopback desktop router. Construction makes no HTTP requests.
pub fn router(token: String, origin: String) -> Router {
    Router::new()
        .route("/api/private/source-feeds", get(registry))
        .route("/api/private/source-refresh", post(refresh))
        .layer(DefaultBodyLimit::max(4096))
        .with_state(Sources::new(token, origin))
}
impl Sources {
    fn new(token: String, origin: String) -> Self {
        let uri = origin.parse::<axum::http::Uri>().ok();
        let host = uri
            .as_ref()
            .and_then(|u| u.authority())
            .map(|a| a.as_str().to_owned())
            .unwrap_or_default();
        let enabled = token.len() >= 32
            && uri.as_ref().is_some_and(|u| {
                matches!(u.scheme_str(), Some("http" | "https"))
                    && u.path() == "/"
                    && u.query().is_none()
                    && u.authority().is_some()
            })
            && !host.contains('@')
            && !origin.ends_with('/');
        let client = reqwest::Client::builder()
            .https_only(true)
            .redirect(reqwest::redirect::Policy::none())
            .no_proxy()
            .timeout(Duration::from_secs(15))
            .connect_timeout(Duration::from_secs(5))
            .user_agent("Tore/0.5.0 manual RSS reader")
            .build()
            .ok();
        Self {
            token_hash: Sha256::digest(token.as_bytes()).into(),
            origin,
            host,
            enabled,
            client,
            session: Arc::new(Mutex::new(Session::default())),
        }
    }
    fn authorize(&self, h: &HeaderMap, read_only: bool) -> Result<()> {
        if !self.enabled {
            return Err(fail(
                StatusCode::SERVICE_UNAVAILABLE,
                "InvalidStateError",
                "Yerel kaynak modülü başlatılamadı.",
            ));
        }
        let bearer = h
            .get("authorization")
            .and_then(|v| v.to_str().ok())
            .and_then(|v| v.strip_prefix("Bearer "))
            .unwrap_or("");
        let digest: [u8; 32] = Sha256::digest(bearer.as_bytes()).into();
        if digest
            .iter()
            .zip(self.token_hash.iter())
            .fold(0u8, |acc, (a, b)| acc | (a ^ b))
            != 0
        {
            return Err(fail(
                StatusCode::UNAUTHORIZED,
                "SecurityError",
                "Yerel erişim anahtarı geçersiz.",
            ));
        }
        if h.get("host").and_then(|v| v.to_str().ok()) != Some(self.host.as_str()) {
            return Err(fail(
                StatusCode::FORBIDDEN,
                "NotAllowedError",
                "Sunucu adresi uyuşmuyor.",
            ));
        }
        let site = h.get("sec-fetch-site").and_then(|v| v.to_str().ok());
        let origin = h.get("origin").and_then(|v| v.to_str().ok());
        // Same-origin browser GET may omit Origin; only the authenticated read-only registry
        // can use Fetch Metadata as a fallback. POST always requires exact Origin.
        if !(origin == Some(self.origin.as_str())
            || (read_only && origin.is_none() && site == Some("same-origin")))
            || site.is_some_and(|s| s != "same-origin" && s != "none")
        {
            return Err(fail(
                StatusCode::FORBIDDEN,
                "NotAllowedError",
                "Kaynak isteğinin kökeni bu Töre oturumuyla uyuşmuyor.",
            ));
        }
        Ok(())
    }
    async fn retrieve(&self, id: &str) -> Result<Value> {
        let feed = FEEDS.iter().find(|f| f.id == id).copied().ok_or_else(|| {
            fail(
                StatusCode::BAD_REQUEST,
                "ValidationError",
                "Yalnız listelenen kaynak kimlikleri yenilenebilir; özel URL kabul edilmez.",
            )
        })?;
        // Serializes provider requests; errors also consume the cooldown, avoiding retry bursts.
        let mut session = self.session.lock().await;
        if let Some(c) = session.cache.get(feed.id) {
            if c.attempted_at.elapsed() < Duration::from_secs(CACHE_SECONDS) {
                return c.value.clone().ok_or_else(|| {
                    fail(
                        StatusCode::TOO_MANY_REQUESTS,
                        "RateLimitError",
                        "Bu kaynak az önce denendi. Yeniden denemeden önce 30 saniye bekleyin.",
                    )
                });
            }
        }
        if feed.id.starts_with("arxiv-") {
            if session
                .arxiv_last
                .is_some_and(|at| at.elapsed() < Duration::from_secs(3))
            {
                return Err(fail(
                    StatusCode::TOO_MANY_REQUESTS,
                    "RateLimitError",
                    "arXiv istekleri arasında en az 3 saniye bekleyin.",
                ));
            }
            session.arxiv_last = Some(Instant::now());
        }
        session.cache.insert(
            feed.id,
            Cached {
                attempted_at: Instant::now(),
                value: None,
            },
        );
        let client = self.client.as_ref().ok_or_else(remote)?;
        let mut response = client
            .get(feed.url)
            .header(
                "accept",
                "application/rss+xml, application/atom+xml, application/xml, text/xml",
            )
            .header("accept-encoding", "identity")
            .send()
            .await
            .map_err(|_| remote())?;
        if !response.status().is_success() {
            return Err(remote());
        }
        if response
            .content_length()
            .is_some_and(|n| n > MAX_BODY as u64)
        {
            return Err(fail(
                StatusCode::PAYLOAD_TOO_LARGE,
                "QuotaExceededError",
                "Kaynak akışı 1 MiB sınırını aşıyor.",
            ));
        }
        let mut bytes = Vec::new();
        while let Some(chunk) = response.chunk().await.map_err(|_| remote())? {
            if bytes.len() + chunk.len() > MAX_BODY {
                return Err(fail(
                    StatusCode::PAYLOAD_TOO_LARGE,
                    "QuotaExceededError",
                    "Kaynak akışı 1 MiB sınırını aşıyor.",
                ));
            }
            bytes.extend_from_slice(&chunk);
        }
        let retrieved_at = now();
        let items = parse(&bytes, feed, &retrieved_at)?;
        let value = json!({"feed":feed,"items":items,"retrievedAt":retrieved_at});
        if let Some(c) = session.cache.get_mut(feed.id) {
            c.value = Some(value.clone());
        }
        Ok(value)
    }
}
async fn registry(State(s): State<Sources>, h: HeaderMap) -> Result<Json<Value>> {
    s.authorize(&h, true)?;
    Ok(Json(json!({"feeds":FEEDS})))
}
#[derive(Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
struct Refresh {
    feed_id: String,
}
async fn refresh(
    State(s): State<Sources>,
    h: HeaderMap,
    body: std::result::Result<Json<Refresh>, JsonRejection>,
) -> Result<Json<Value>> {
    s.authorize(&h, false)?;
    let Json(body) = body.map_err(|_| {
        fail(
            StatusCode::BAD_REQUEST,
            "ValidationError",
            "Yenileme isteği yalnız feedId içeren küçük bir JSON nesnesi olmalı.",
        )
    })?;
    Ok(Json(s.retrieve(&body.feed_id).await?))
}

#[derive(Default)]
struct Raw {
    title: String,
    url: String,
    summary: String,
    published: String,
    updated: String,
    authors: Vec<String>,
    author: String,
    doi: String,
}
fn valid_url(s: &str) -> Option<String> {
    if s.len() > 4096 || s.chars().any(char::is_control) {
        return None;
    }
    let u = url::Url::parse(s.trim()).ok()?;
    (matches!(u.scheme(), "http" | "https")
        && u.host_str().is_some()
        && u.username().is_empty()
        && u.password().is_none())
    .then(|| u.to_string())
}
fn entities(s: &str) -> String {
    let mut out = String::with_capacity(s.len());
    let mut remaining = s;
    while let Some(start) = remaining.find('&') {
        out.push_str(&remaining[..start]);
        remaining = &remaining[start..];
        // Search only a short entity token; repeated bare '&' must not become quadratic.
        if let Some(end) = remaining
            .char_indices()
            .take_while(|(n, _)| *n <= 12)
            .find_map(|(n, c)| (c == ';').then_some(n))
        {
            let entity = &remaining[..=end];
            let decoded = match entity {
                "&nbsp;" => Some(" "),
                "&ndash;" => Some("–"),
                "&mdash;" => Some("—"),
                "&hellip;" => Some("…"),
                "&rsquo;" => Some("’"),
                "&lsquo;" => Some("‘"),
                "&rdquo;" => Some("”"),
                "&ldquo;" => Some("“"),
                _ => None,
            };
            if let Some(v) = decoded {
                out.push_str(v);
            } else {
                out.push_str(
                    &quick_xml::escape::unescape(entity)
                        .map(|v| v.into_owned())
                        .unwrap_or_else(|_| entity.into()),
                );
            }
            remaining = &remaining[end + 1..];
        } else {
            out.push('&');
            remaining = &remaining[1..];
        }
    }
    out.push_str(remaining);
    out
}
fn plain(s: &str, max: usize) -> String {
    let decoded = entities(s);
    let lower = decoded.to_ascii_lowercase();
    let mut out = String::new();
    let mut pos = 0;
    while pos < decoded.len() {
        if decoded.as_bytes()[pos] == b'<' {
            let Some(end) = decoded[pos..].find('>') else {
                out.push_str(&decoded[pos..]);
                break;
            };
            let after = pos + end + 1;
            let name = lower[pos + 1..pos + end]
                .trim_start()
                .split([' ', '\t', '\n', '/'])
                .next()
                .unwrap_or("");
            if ["script", "style", "iframe"].contains(&name) {
                if let Some(close) = lower[after..].find(&format!("</{name}")) {
                    pos = after + close;
                    continue;
                }
                break;
            }
            out.push(' ');
            pos = after;
        } else {
            let c = decoded[pos..].chars().next().unwrap();
            if !c.is_control() || c.is_whitespace() {
                out.push(c);
            }
            pos += c.len_utf8();
        }
    }
    out.split_whitespace()
        .collect::<Vec<_>>()
        .join(" ")
        .chars()
        .take(max)
        .collect()
}
fn date(s: &str) -> Option<String> {
    chrono::DateTime::parse_from_rfc3339(s.trim())
        .or_else(|_| chrono::DateTime::parse_from_rfc2822(s.trim()))
        .ok()
        .map(|d| {
            d.with_timezone(&chrono::Utc)
                .to_rfc3339_opts(chrono::SecondsFormat::Millis, true)
        })
}
fn doi(s: &str) -> Option<String> {
    let s = s.trim();
    let (prefix, suffix) = s.strip_prefix("10.")?.split_once('/')?;
    (s.len() <= 256
        && (4..=9).contains(&prefix.len())
        && prefix.bytes().all(|b| b.is_ascii_digit())
        && !suffix.is_empty()
        && !s.chars().any(|c| c.is_whitespace() || c.is_control()))
    .then(|| s.to_owned())
}
impl Raw {
    fn finish(self, feed: Feed, retrieved_at: &str) -> Option<Value> {
        let title = plain(&self.title, 300);
        if title.is_empty() {
            return None;
        }
        let url = valid_url(&self.url)?;
        let mut seen = BTreeSet::new();
        let authors: Vec<_> = self
            .authors
            .iter()
            .map(|v| plain(v, 200))
            .filter(|v| !v.is_empty() && seen.insert(v.clone()))
            .take(20)
            .collect();
        Some(
            json!({"id":hash(&url),"title":title,"authors":authors,"url":url,"published":date(&self.published),"retrievedAt":retrieved_at,"kind":feed.kind,"summary":plain(&self.summary,1000),"source":feed.label,"doi":doi(&self.doi)}),
        )
    }
}
fn field(stack: &[String]) -> Option<&str> {
    if stack
        .iter()
        .any(|s| ["summary", "description", "content", "encoded"].contains(&s.as_str()))
    {
        return Some("summary");
    }
    if stack.iter().any(|s| s == "author")
        && stack.last().is_some_and(|s| s == "email" || s == "uri")
    {
        return None;
    }
    stack.iter().rev().find_map(|s| match s.as_str() {
        "title" => Some("title"),
        "link" => Some("url"),
        "pubDate" | "published" => Some("published"),
        "updated" => Some("updated"),
        "creator" | "author" => Some("author"),
        "doi" => Some("doi"),
        _ => None,
    })
}
fn append(raw: &mut Raw, stack: &[String], s: &str) {
    let target = match field(stack) {
        Some("summary") => &mut raw.summary,
        Some("title") => &mut raw.title,
        Some("url") => &mut raw.url,
        Some("published") => &mut raw.published,
        Some("updated") => &mut raw.updated,
        Some("author") => &mut raw.author,
        Some("doi") => &mut raw.doi,
        _ => return,
    };
    target.push_str(s);
}
fn atom_link(
    e: &quick_xml::events::BytesStart<'_>,
    reader: &Reader<&[u8]>,
    raw: &mut Raw,
) -> Result<()> {
    let mut href = None;
    let mut rel = None;
    for a in e.attributes() {
        let a = a.map_err(|_| malformed())?;
        let value = a
            .decode_and_unescape_value(reader.decoder())
            .map_err(|_| malformed())?
            .into_owned();
        match a.key.as_ref() {
            b"href" => href = Some(value),
            b"rel" => rel = Some(value),
            _ => {}
        }
    }
    if rel.as_deref().is_none_or(|v| v == "alternate") {
        if let Some(href) = href {
            if raw.url.is_empty() {
                raw.url = href;
            }
        }
    }
    Ok(())
}
fn parse(bytes: &[u8], feed: Feed, retrieved_at: &str) -> Result<Vec<Value>> {
    if bytes.len() > MAX_BODY {
        return Err(malformed());
    }
    let xml = std::str::from_utf8(bytes).map_err(|_| malformed())?;
    let mut reader = Reader::from_str(xml);
    reader.config_mut().check_end_names = true;
    let mut stack: Vec<String> = Vec::new();
    let mut raw = None;
    let mut item_depth = 0;
    let mut items = Vec::new();
    let mut seen = BTreeSet::new();
    let mut root_seen = false;
    loop {
        match reader.read_event().map_err(|_| malformed())? {
            Event::DocType(_) | Event::PI(_) => return Err(malformed()),
            Event::Start(e) => {
                let name =
                    String::from_utf8(e.local_name().as_ref().to_vec()).map_err(|_| malformed())?;
                if stack.is_empty() {
                    if root_seen || !["rss", "feed", "RDF"].contains(&name.as_str()) {
                        return Err(malformed());
                    }
                    root_seen = true;
                }
                if stack.len() >= 64 {
                    return Err(malformed());
                }
                stack.push(name.clone());
                if ["item", "entry"].contains(&name.as_str()) {
                    if raw.is_some() {
                        return Err(malformed());
                    }
                    raw = Some(Raw::default());
                    item_depth = stack.len();
                }
                if name == "link" {
                    if let Some(r) = raw.as_mut() {
                        atom_link(&e, &reader, r)?;
                    }
                }
            }
            Event::Empty(e) => {
                if e.local_name().as_ref() == b"link" {
                    if let Some(r) = raw.as_mut() {
                        atom_link(&e, &reader, r)?;
                    }
                }
            }
            Event::End(e) => {
                let name =
                    String::from_utf8(e.local_name().as_ref().to_vec()).map_err(|_| malformed())?;
                if let Some(r) = raw.as_mut() {
                    if ["author", "creator"].contains(&name.as_str()) && !r.author.trim().is_empty()
                    {
                        r.authors.push(std::mem::take(&mut r.author));
                    }
                }
                if stack.len() == item_depth && ["item", "entry"].contains(&name.as_str()) {
                    if let Some(value) = raw.take().and_then(|r| r.finish(feed, retrieved_at)) {
                        if items.len() < MAX_ITEMS
                            && seen.insert(value["id"].as_str().unwrap_or("").to_owned())
                        {
                            items.push(value);
                        }
                    }
                }
                if stack.pop().as_deref() != Some(name.as_str()) {
                    return Err(malformed());
                }
            }
            Event::Text(e) => {
                let text = e.decode().map_err(|_| malformed())?;
                if let Some(r) = raw.as_mut() {
                    append(r, &stack[item_depth..], &text);
                } else if !text.trim().is_empty() && stack.is_empty() {
                    return Err(malformed());
                }
            }
            Event::CData(e) => {
                if let Some(r) = raw.as_mut() {
                    append(
                        r,
                        &stack[item_depth..],
                        &e.decode().map_err(|_| malformed())?,
                    );
                }
            }
            Event::GeneralRef(e) => {
                let value = e.decode().map_err(|_| malformed())?;
                let entity = format!("&{value};");
                let value = quick_xml::escape::unescape(&entity).map_err(|_| malformed())?;
                if let Some(r) = raw.as_mut() {
                    append(r, &stack[item_depth..], &value);
                }
            }
            Event::Eof => break,
            _ => {}
        }
    }
    if !root_seen || !stack.is_empty() || raw.is_some() {
        return Err(malformed());
    }
    Ok(items)
}

#[cfg(test)]
mod tests {
    use super::*;
    const TOKEN: &str = "synthetic-source-token-for-tests-only-001";
    const ORIGIN: &str = "http://127.0.0.1:4321";
    fn parsed(s: &str) -> Result<Vec<Value>> {
        parse(s.as_bytes(), FEEDS[0], "2026-11-14T00:00:00.000Z")
    }
    fn h() -> HeaderMap {
        let mut h = HeaderMap::new();
        h.insert("authorization", format!("Bearer {TOKEN}").parse().unwrap());
        h.insert("host", "127.0.0.1:4321".parse().unwrap());
        h.insert("origin", ORIGIN.parse().unwrap());
        h
    }
    #[test]
    fn rss_plaintext_dates_authors_ids_and_no_external_content_loading() {
        let items=parsed(r#"<?xml version="1.0" encoding="UTF-8"?><rss xmlns:dc="urn:dc"><channel><item><title><![CDATA[Özgürlük &amp; <b>bilim</b>]]></title><link>https://arxiv.org/abs/2611.12345</link><dc:creator>Ada Örnek</dc:creator><pubDate>Fri, 14 Nov 2025 12:00:00 GMT</pubDate><description><![CDATA[<script>evil()</script>Gerçek <b>metin</b><img src="https://tracker.invalid/pixel">]]></description><doi>10.1234/abc</doi></item></channel></rss>"#).unwrap();
        assert_eq!(items.len(), 1);
        let i = &items[0];
        assert_eq!(i["title"], "Özgürlük & bilim");
        assert_eq!(i["summary"], "Gerçek metin");
        assert_eq!(i["authors"][0], "Ada Örnek");
        assert_eq!(i["published"], "2025-11-14T12:00:00.000Z");
        assert_eq!(i["doi"], "10.1234/abc");
        assert_eq!(i["id"], hash(i["url"].as_str().unwrap()));
    }
    #[test]
    fn atom_alternate_href_author_nested_name_and_unknown_date() {
        let items=parsed(r#"<feed xmlns="http://www.w3.org/2005/Atom"><entry><title>A &amp; B</title><link rel="related" href="https://wrong.invalid"/><link rel="alternate" href="https://arxiv.org/abs/1"/><author><name>Kişi</name></author><published>not-a-date</published><summary>Türkçe içerik</summary></entry></feed>"#).unwrap();
        assert_eq!(items[0]["url"], "https://arxiv.org/abs/1");
        assert_eq!(items[0]["authors"][0], "Kişi");
        assert!(items[0]["published"].is_null());
        assert_eq!(items[0]["title"], "A & B");
    }
    #[test]
    fn malicious_dtd_entities_processing_instructions_and_unsafe_links_reject() {
        for s in [
            r#"<!DOCTYPE rss [<!ENTITY leak SYSTEM "file:///etc/passwd">]><rss/>"#,
            r#"<?xml-stylesheet href="https://tracker.invalid"?><rss/>"#,
            r#"<rss><channel><item><title>&custom;</title><link>https://example.org/</link></item></channel></rss>"#,
            "<rss><item></rss>",
            "<html><body>x</body></html>",
        ] {
            assert!(parsed(s).is_err(), "{s}");
        }
        for url in [
            "javascript:alert(1)",
            "file:///etc/passwd",
            "data:text/html,hi",
            "https://name:pass@example.org/",
            "//example.org/a",
            "../relative",
        ] {
            let xml = format!(
                "<rss><channel><item><title>x</title><link>{url}</link></item></channel></rss>"
            );
            assert!(parsed(&xml).unwrap().is_empty(), "{url}");
        }
    }
    #[test]
    fn bounds_duplicates_and_full_document_validation_after_twenty_items() {
        let mut xml = String::from("<rss><channel>");
        for n in 0..25 {
            xml.push_str(&format!("<item><title>{}</title><link>https://example.org/{n}</link><description>{}</description></item>","İ".repeat(500),"ş".repeat(1500)));
        }
        xml.push_str("</channel></rss>");
        let items = parsed(&xml).unwrap();
        assert_eq!(items.len(), 20);
        assert_eq!(items[0]["title"].as_str().unwrap().chars().count(), 300);
        assert_eq!(items[0]["summary"].as_str().unwrap().chars().count(), 1000);
        assert!(parsed(&(xml + "<!DOCTYPE bad>")).is_err());
        let duplicates = "<rss><channel><item><title>a</title><link>https://example.org/1</link></item><item><title>b</title><link>https://example.org/1</link></item></channel></rss>";
        assert_eq!(parsed(duplicates).unwrap().len(), 1);
        assert!(parse(&[0xff], FEEDS[0], "now").is_err());
        assert!(parsed(&("<rss>".to_owned() + &"<a>".repeat(70))).is_err());
        assert_eq!(plain(&"&".repeat(100_000), 1000), "&".repeat(1000));
        assert!(parsed("<feed><entry><title>x</title><link href=\"https://example.org/\"/><updated>2026-11-14T00:00:00Z</updated></entry></feed>")
            .unwrap()[0]["published"].is_null());
    }
    #[test]
    fn auth_origin_host_and_read_only_get_fallback() {
        let state = Sources::new(TOKEN.into(), ORIGIN.into());
        assert!(state.authorize(&h(), false).is_ok());
        let mut headers = h();
        headers.remove("origin");
        assert!(state.authorize(&headers, true).is_err());
        headers.insert("sec-fetch-site", "same-origin".parse().unwrap());
        assert!(state.authorize(&headers, true).is_ok());
        assert!(state.authorize(&headers, false).is_err());
        headers.insert("origin", "https://evil.invalid".parse().unwrap());
        assert!(state.authorize(&headers, true).is_err());
        for key in ["authorization", "host"] {
            let mut headers = h();
            headers.remove(key);
            assert!(state.authorize(&headers, false).is_err());
        }
    }
    #[tokio::test]
    async fn public_registry_and_invalid_feed_do_not_fetch_and_have_no_cors() {
        use axum::{body::Body, http::Request};
        use http_body_util::BodyExt;
        use tower::ServiceExt;
        let app = router(TOKEN.into(), ORIGIN.into());
        let mut request = Request::builder()
            .uri("/api/private/source-feeds")
            .body(Body::empty())
            .unwrap();
        *request.headers_mut() = h();
        let r = app.clone().oneshot(request).await.unwrap();
        assert_eq!(r.status(), StatusCode::OK);
        assert!(r.headers().get("access-control-allow-origin").is_none());
        let data: Value =
            serde_json::from_slice(&r.into_body().collect().await.unwrap().to_bytes()).unwrap();
        assert_eq!(data["feeds"].as_array().unwrap().len(), 3);
        let mut request = Request::post("/api/private/source-refresh")
            .body(Body::from(r#"{"feedId":"https://127.0.0.1/private"}"#))
            .unwrap();
        *request.headers_mut() = h();
        request
            .headers_mut()
            .insert("content-type", "application/json".parse().unwrap());
        let r = app.oneshot(request).await.unwrap();
        assert_eq!(r.status(), StatusCode::BAD_REQUEST);
    }
    #[tokio::test]
    async fn cached_success_and_failure_cooldowns_do_not_make_network_requests() {
        let s = Sources::new(TOKEN.into(), ORIGIN.into());
        {
            let mut state = s.session.lock().await;
            state.cache.insert(
                "bbc-science",
                Cached {
                    attempted_at: Instant::now(),
                    value: Some(json!({"synthetic":true})),
                },
            );
            state.cache.insert(
                "arxiv-ai",
                Cached {
                    attempted_at: Instant::now(),
                    value: None,
                },
            );
            state.arxiv_last = Some(Instant::now());
        }
        assert_eq!(s.retrieve("bbc-science").await.unwrap()["synthetic"], true);
        assert_eq!(
            s.retrieve("arxiv-ai").await.unwrap_err().status,
            StatusCode::TOO_MANY_REQUESTS
        );
        assert_eq!(
            s.retrieve("arxiv-social").await.unwrap_err().status,
            StatusCode::TOO_MANY_REQUESTS
        );
    }
    #[tokio::test]
    #[ignore = "Explicit opt-in public BBC HTTPS GET; never runs in the default test suite"]
    async fn live_bbc_manual_refresh() {
        let s = Sources::new(TOKEN.into(), ORIGIN.into());
        let value = s.retrieve("bbc-science").await.unwrap();
        assert_eq!(value["feed"]["id"], "bbc-science");
        assert!(!value["items"].as_array().unwrap().is_empty());
        println!(
            "BBC native HTTPS refresh: {} items, retrievedAt={}",
            value["items"].as_array().unwrap().len(),
            value["retrievedAt"]
        );
    }
}
