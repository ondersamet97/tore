//! Official public-client SIWC protocol; no Codex credentials, agent SDK or local inference.
//! Account tokens live in RAM. Only the host/client registration survives restart.
use axum::{
    Router,
    extract::{RawQuery, State},
    http::{HeaderMap, StatusCode},
    response::Html,
    routing::get,
};
use base64::{Engine, engine::general_purpose::URL_SAFE_NO_PAD};
use jsonwebtoken::{Algorithm, DecodingKey, Validation, decode, decode_header, jwk::JwkSet};
use serde::{Deserialize, Serialize};
use serde_json::{Value, json};
use sha2::{Digest, Sha256};
use std::{
    collections::BTreeMap,
    fs,
    io::Write,
    path::PathBuf,
    sync::{Arc, Mutex},
    time::Duration,
};
use tokio::sync::{oneshot, watch};

const AUTH: &str = "https://auth.openai.com";
const RESOURCE: &str = "https://api.openai.com/v1";
const DYNAMIC: &str = "dynamic_agent_client";
const SCOPE: &str = "openid profile email offline_access resource.invoke chatgpt.tokens.use.direct";

#[derive(Clone, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
struct Registration {
    schema_version: u32,
    host: String,
    client_id: Option<String>,
    subject: Option<String>,
}
#[derive(Clone)]
struct Credentials {
    access: String,
    refresh: Option<String>,
    scopes: Vec<String>,
    expires: i64,
}
struct Account {
    registration: Registration,
    credentials: Option<Credentials>,
    pending: bool,
    error: Option<String>,
    epoch: u64,
    needs_consent: bool,
}
pub struct Service {
    path: PathBuf,
    state: Mutex<Account>,
    refresh_gate: tokio::sync::Mutex<()>,
    changed: watch::Sender<u64>,
}
#[derive(Clone)]
struct Attempt {
    registration: Registration,
    state: String,
    nonce: String,
    verifier: String,
    redirect: String,
    epoch: u64,
    reconsent: bool,
}
struct Callback {
    host: String,
    attempt: Attempt,
    tx: Mutex<Option<oneshot::Sender<Result<(String, String), String>>>>,
}
#[derive(Deserialize)]
struct Claims {
    sub: String,
    nonce: Option<String>,
}

fn random() -> String {
    format!(
        "{}{}",
        uuid::Uuid::new_v4().simple(),
        uuid::Uuid::new_v4().simple()
    )
}
fn lock<T>(m: &Mutex<T>) -> Result<std::sync::MutexGuard<'_, T>, String> {
    m.lock()
        .map_err(|_| "ChatGPT bağlantı durumu okunamadı".into())
}
fn same(a: &str, b: &str) -> bool {
    let a = Sha256::digest(a.as_bytes());
    let b = Sha256::digest(b.as_bytes());
    a.iter().zip(b).fold(0u8, |d, (a, b)| d | (a ^ b)) == 0
}
fn private_registration(path: &std::path::Path, registration: &Registration) -> Result<(), String> {
    let parent = path.parent().ok_or("Bağlantı yolu geçersiz")?;
    for p in path.ancestors() {
        if fs::symlink_metadata(p).is_ok_and(|m| m.file_type().is_symlink()) {
            return Err("Bağlantı kaydı sembolik bağ içeremez".into());
        }
    }
    fs::create_dir_all(parent).map_err(|_| "Bağlantı klasörü oluşturulamadı")?;
    let tmp = parent.join(format!(".chatgpt-{}.tmp", uuid::Uuid::new_v4()));
    let result = (|| {
        let mut opts = fs::OpenOptions::new();
        opts.write(true).create_new(true);
        #[cfg(unix)]
        {
            use std::os::unix::fs::OpenOptionsExt;
            opts.mode(0o600).custom_flags(libc::O_NOFOLLOW);
        }
        let mut file = opts.open(&tmp).map_err(|_| "Bağlantı kaydı açılamadı")?;
        file.write_all(&serde_json::to_vec(registration).map_err(|_| "Bağlantı kodlanamadı")?)
            .map_err(|_| "Bağlantı yazılamadı")?;
        file.sync_all().map_err(|_| "Bağlantı kaydı eşitlenemedi")?;
        fs::rename(&tmp, path).map_err(|_| "Bağlantı kaydı yenilenemedi")?;
        fs::File::open(parent)
            .and_then(|f| f.sync_all())
            .map_err(|_| "Bağlantı klasörü eşitlenemedi")?;
        Ok(())
    })();
    let _ = fs::remove_file(tmp);
    result
}
fn client() -> Result<reqwest::Client, String> {
    reqwest::Client::builder()
        .no_proxy()
        .redirect(reqwest::redirect::Policy::none())
        .retry(reqwest::retry::never())
        .connect_timeout(Duration::from_secs(15))
        .timeout(Duration::from_secs(240))
        .build()
        .map_err(|_| "ChatGPT bağlantısı hazırlanamadı".into())
}
async fn bounded_json(response: reqwest::Response, limit: usize) -> Result<Value, String> {
    let (status, value) = json_response(response, limit).await?;
    if !(200..300).contains(&status) {
        return Err(remote_error(response_error_code(&value), status));
    }
    Ok(value)
}

async fn json_response(
    mut response: reqwest::Response,
    limit: usize,
) -> Result<(u16, Value), String> {
    let status = response.status().as_u16();
    let mut bytes = Vec::new();
    while let Some(chunk) = response
        .chunk()
        .await
        .map_err(|_| "ChatGPT bağlantısı kesildi; işlem otomatik tekrarlanmadı")?
    {
        if bytes.len() + chunk.len() > limit {
            return Err("ChatGPT yanıt boyutu sınırı aşıldı".into());
        }
        bytes.extend_from_slice(&chunk);
    }
    let value: Value =
        serde_json::from_slice(&bytes).map_err(|_| "ChatGPT geçerli JSON döndürmedi")?;
    Ok((status, value))
}
fn response_error_code(value: &Value) -> &str {
    value["error"]["code"]
        .as_str()
        .or_else(|| value["error"].as_str())
        .unwrap_or("")
}
fn terminal_refresh_error(code: &str) -> bool {
    matches!(
        code,
        "invalid_grant"
            | "invalid_refresh_token"
            | "token_expired"
            | "refresh_token_expired"
            | "refresh_token_invalidated"
            | "refresh_token_reused"
    )
}
fn remote_error(code: &str, status: u16) -> String {
    match code {
        "subscription_sharing_usage_limit_exceeded" => "ChatGPT paylaşım kotası doldu. ChatGPT kullanım ayarlarını kontrol edin; Töre kredi satın almaz veya yeniden denemez.".into(),
        "subscription_sharing_usage_unavailable" => "Bu ChatGPT hesabında plan paylaşımı şu anda kullanılamıyor. Kullanım ayarlarını kontrol edin.".into(),
        code if terminal_refresh_error(code) => "ChatGPT oturumu artık kullanılamıyor. Yeniden giriş yapın; aynı istek tekrarlanmadı.".into(),
        "context_length_exceeded" => "Seçilen metin modelin bağlam sınırını aşıyor. Kaynakları azaltıp yeniden önizleyin.".into(),
        _ if status == 401 || status == 403 => "ChatGPT erişimi reddedildi. Hesabı ve verilen plan kullanım iznini kontrol edin.".into(),
        _ if status == 429 => "ChatGPT kullanım veya istek sınırına ulaşıldı; otomatik tekrar yapılmadı.".into(),
        _ => "ChatGPT isteği tamamlanamadı; sağlayıcı ayrıntıları ve özel içerik kaydedilmedi. Otomatik tekrar yapılmadı.".into(),
    }
}
fn authorization_url(a: &Attempt) -> String {
    let mut url = url::Url::parse(&format!("{AUTH}/api/accounts/authorize")).unwrap();
    let mut q = url.query_pairs_mut();
    q.append_pair(
        "client_id",
        a.registration.client_id.as_deref().unwrap_or(DYNAMIC),
    );
    if a.registration.client_id.is_none() {
        q.append_pair("agent_name_hint", "Töre");
    }
    if a.reconsent {
        // Only an explicit login action after a known missing grant/incomplete
        // registration asks again. Ordinary reauthorization does not force consent.
        q.append_pair("prompt", "consent");
    }
    q.append_pair("ext_agent_host_id", &a.registration.host)
        .append_pair("response_type", "code")
        .append_pair("redirect_uri", &a.redirect)
        .append_pair("scope", SCOPE)
        .append_pair("resource", RESOURCE)
        .append_pair("state", &a.state)
        .append_pair("nonce", &a.nonce)
        .append_pair("code_challenge_method", "S256")
        .append_pair(
            "code_challenge",
            &URL_SAFE_NO_PAD.encode(Sha256::digest(a.verifier.as_bytes())),
        );
    drop(q);
    url.into()
}
fn parse_callback(query: &str, attempt: &Attempt) -> Result<(String, String), String> {
    if query.len() > 16_384 {
        return Err("Giriş yanıtı çok büyük".into());
    }
    let mut fields = BTreeMap::new();
    for (k, v) in url::form_urlencoded::parse(query.as_bytes()) {
        if fields.insert(k.into_owned(), v.into_owned()).is_some() {
            return Err("Yinelenen giriş alanı".into());
        }
    }
    if !fields.get("state").is_some_and(|v| same(v, &attempt.state)) {
        return Err("Giriş durumu eşleşmedi".into());
    }
    if fields.contains_key("error") {
        return Err("ChatGPT giriş izni verilmedi veya giriş tamamlanamadı".into());
    }
    let code = fields
        .get("code")
        .filter(|s| !s.is_empty() && s.len() <= 8192)
        .ok_or("Giriş kodu eksik")?
        .clone();
    let issued = fields
        .get("client_id")
        .or(attempt.registration.client_id.as_ref())
        .filter(|s| !s.is_empty() && s.as_str() != DYNAMIC && s.len() < 512)
        .ok_or("ChatGPT uygulama kimliği eksik")?
        .clone();
    if attempt
        .registration
        .client_id
        .as_ref()
        .is_some_and(|old| old != &issued)
    {
        return Err("ChatGPT hesap kaydı eşleşmedi".into());
    }
    Ok((code, issued))
}
async fn callback(
    State(c): State<Arc<Callback>>,
    headers: HeaderMap,
    RawQuery(query): RawQuery,
) -> (StatusCode, Html<&'static str>) {
    let rejected = (
        StatusCode::BAD_REQUEST,
        Html("Geçersiz giriş yanıtı. Töre penceresine dönün."),
    );
    if headers.get("host").and_then(|v| v.to_str().ok()) != Some(c.host.as_str()) {
        return rejected;
    }
    let query = query.unwrap_or_default();
    // Invalid state must not consume the pending request or deny a legitimate callback.
    let states: Vec<_> = url::form_urlencoded::parse(query.as_bytes())
        .filter(|(k, _)| k == "state")
        .map(|(_, v)| v.into_owned())
        .collect();
    if query.len() > 16_384 || states.len() != 1 || !same(&states[0], &c.attempt.state) {
        return rejected;
    }
    let result = parse_callback(&query, &c.attempt);
    let Ok(mut tx) = c.tx.lock() else {
        return rejected;
    };
    let Some(tx) = tx.take() else {
        return rejected;
    };
    let _ = tx.send(result);
    (
        StatusCode::OK,
        Html(
            "<!doctype html><meta charset=utf-8><meta name=referrer content=no-referrer><title>Töre</title><script>history.replaceState(null,'','/auth/callback')</script><h1>Töre</h1><p>Giriş yanıtı alındı. Bağlantı sonucunu görmek için Töre penceresine dönün. Bu sekmeyi kapatabilirsiniz.</p>",
        ),
    )
}
fn credentials(value: &Value, previous: Option<&Credentials>) -> Result<Credentials, String> {
    if !value["token_type"]
        .as_str()
        .is_some_and(|v| v.eq_ignore_ascii_case("Bearer"))
    {
        return Err("ChatGPT token türü desteklenmiyor".into());
    }
    let access = value["access_token"]
        .as_str()
        .filter(|v| !v.is_empty() && v.len() < 32_768 && !v.chars().any(char::is_control))
        .ok_or("ChatGPT erişim kaydı eksik")?
        .to_owned();
    let scopes = if let Some(s) = value["scope"].as_str() {
        s.split_whitespace().map(str::to_owned).collect()
    } else {
        previous
            .map(|v| v.scopes.clone())
            .ok_or("ChatGPT verilen izinleri bildirmedi")?
    };
    let expires_in = value["expires_in"]
        .as_i64()
        .filter(|n| *n > 0 && *n <= 31_536_000)
        .ok_or("ChatGPT oturum süresi geçersiz")?;
    let refresh = value["refresh_token"]
        .as_str()
        .map(str::to_owned)
        .or_else(|| previous.and_then(|v| v.refresh.clone()));
    Ok(Credentials {
        access,
        refresh,
        scopes,
        expires: chrono::Utc::now().timestamp() + expires_in,
    })
}
fn verify_token(
    token: &str,
    jwks: &Value,
    client_id: &str,
    nonce: Option<&str>,
    subject: Option<&str>,
) -> Result<String, String> {
    let header = decode_header(token).map_err(|_| "ChatGPT kimlik kaydı çözülemedi")?;
    if header.alg != Algorithm::RS256 {
        return Err("ChatGPT kimlik imzası desteklenmiyor".into());
    }
    let keys: JwkSet = serde_json::from_value(jwks.clone())
        .map_err(|_| "ChatGPT doğrulama anahtarları geçersiz")?;
    let key = keys
        .find(header.kid.as_deref().ok_or("ChatGPT imza anahtarı eksik")?)
        .ok_or("ChatGPT imza anahtarı bulunamadı")?;
    let mut validation = Validation::new(Algorithm::RS256);
    validation.set_required_spec_claims(&["exp", "iss", "aud", "sub"]);
    validation.set_issuer(&[AUTH]);
    validation.set_audience(&[client_id]);
    validation.validate_nbf = true;
    let claims = decode::<Claims>(
        token,
        &DecodingKey::from_jwk(key).map_err(|_| "ChatGPT imza anahtarı geçersiz")?,
        &validation,
    )
    .map_err(|_| "ChatGPT kimlik imzası, süre veya hedef doğrulaması başarısız")?
    .claims;
    if claims.sub.is_empty()
        || nonce.is_some_and(|n| !claims.nonce.as_deref().is_some_and(|v| same(v, n)))
        || subject.is_some_and(|s| !same(s, &claims.sub))
    {
        return Err("ChatGPT kimlik veya giriş doğrulaması eşleşmedi".into());
    }
    Ok(claims.sub)
}
async fn identity(
    token: &str,
    client_id: &str,
    nonce: Option<&str>,
    subject: Option<&str>,
) -> Result<String, String> {
    let jwks = bounded_json(
        client()?
            .get(format!("{AUTH}/.well-known/jwks.json"))
            .send()
            .await
            .map_err(|_| "ChatGPT kimlik anahtarları alınamadı")?,
        256 * 1024,
    )
    .await?;
    verify_token(token, &jwks, client_id, nonce, subject)
}
fn sharing(c: &Credentials) -> bool {
    ["resource.invoke", "chatgpt.tokens.use.direct"]
        .iter()
        .all(|s| c.scopes.iter().any(|v| v == s))
}

impl Service {
    pub fn open(root: PathBuf) -> Result<Arc<Self>, String> {
        let path = root.join("chatgpt-registration-v1.json");
        for p in path.ancestors() {
            if fs::symlink_metadata(p).is_ok_and(|m| m.file_type().is_symlink()) {
                return Err("Bağlantı yolunda sembolik bağ".into());
            }
        }
        let registration = if path.exists() {
            if fs::metadata(&path)
                .map_err(|_| "Bağlantı kaydı okunamadı")?
                .len()
                > 16_384
            {
                return Err("Bağlantı kaydı çok büyük".into());
            }
            let r: Registration =
                serde_json::from_slice(&fs::read(&path).map_err(|_| "Bağlantı kaydı okunamadı")?)
                    .map_err(|_| "Bağlantı kaydı bozuk; sıfırlanmadı")?;
            if r.schema_version != 1
                || !r
                    .host
                    .strip_prefix("urn:uuid:")
                    .is_some_and(|v| uuid::Uuid::parse_str(v).is_ok())
                || r.client_id.as_deref() == Some(DYNAMIC)
            {
                return Err("Bağlantı kaydı geçersiz".into());
            }
            r
        } else {
            let r = Registration {
                schema_version: 1,
                host: format!("urn:uuid:{}", uuid::Uuid::new_v4()),
                client_id: None,
                subject: None,
            };
            private_registration(&path, &r)?;
            r
        };
        let (changed, _) = watch::channel(0);
        let needs_consent = registration.client_id.is_some() && registration.subject.is_none();
        Ok(Arc::new(Self {
            path,
            state: Mutex::new(Account {
                registration,
                credentials: None,
                pending: false,
                error: None,
                epoch: 0,
                needs_consent,
            }),
            refresh_gate: tokio::sync::Mutex::new(()),
            changed,
        }))
    }
    pub fn status(&self) -> Result<Value, String> {
        let s = lock(&self.state)?;
        Ok(
            json!({"connected":s.credentials.is_some(),"sharing":s.credentials.as_ref().is_some_and(sharing),"pending":s.pending,"error":s.error,"accountLabel":if s.credentials.is_some(){"ChatGPT hesabı"}else{"Bağlı değil"},"credentialStorage":"memory_only","usageUrl":"https://chatgpt.com/settings/usage"}),
        )
    }
    pub async fn login(self: &Arc<Self>) -> Result<Value, String> {
        let listener = tokio::net::TcpListener::bind("127.0.0.1:0")
            .await
            .map_err(|_| "Yerel giriş dinleyicisi başlatılamadı")?;
        let host = listener
            .local_addr()
            .map_err(|_| "Giriş adresi alınamadı")?
            .to_string();
        let (attempt, mut changed) = {
            let mut s = lock(&self.state)?;
            if s.pending {
                return Err("ChatGPT giriş penceresi zaten açık".into());
            }
            s.epoch += 1;
            s.pending = true;
            s.error = None;
            self.changed.send_replace(s.epoch);
            let attempt = Attempt {
                registration: s.registration.clone(),
                state: random(),
                nonce: random(),
                verifier: random(),
                redirect: format!("http://{host}/auth/callback"),
                epoch: s.epoch,
                reconsent: s.needs_consent || s.credentials.as_ref().is_some_and(|c| !sharing(c)),
            };
            // Subscribe while the same state lock protects the epoch. A logout
            // between starting this attempt and subscribing cannot be missed.
            (attempt, self.changed.subscribe())
        };
        let url = authorization_url(&attempt);
        let (tx, rx) = oneshot::channel();
        let (stop_tx, stop_rx) = oneshot::channel();
        let router = Router::new()
            .route("/auth/callback", get(callback))
            .with_state(Arc::new(Callback {
                host,
                attempt: attempt.clone(),
                tx: Mutex::new(Some(tx)),
            }));
        tokio::spawn(async move {
            let _ = axum::serve(listener, router)
                .with_graceful_shutdown(async {
                    let _ = stop_rx.await;
                })
                .await;
        });
        let this = self.clone();
        tokio::spawn(async move {
            let result = tokio::select! {
                biased;
                _=changed.changed()=>Err("ChatGPT giriş işlemi iptal edildi".into()),
                result=tokio::time::timeout(Duration::from_secs(600),async {
                    let (code,issued)=rx.await.map_err(|_|"ChatGPT giriş yanıtı alınamadı")??;
                    this.exchange(&attempt,&code,&issued).await
                })=>result.unwrap_or_else(|_|Err("ChatGPT giriş süresi doldu; yeniden giriş yapın".into()))
            };
            let _ = stop_tx.send(());
            if let Ok(mut s) = this.state.lock() {
                if s.epoch == attempt.epoch {
                    s.pending = false;
                    if let Err(e) = result {
                        s.error = Some(e);
                    }
                }
            }
        });
        // Opening a browser is only reachable from the user's explicit sign-in action.
        let opened = tokio::process::Command::new(if cfg!(target_os = "macos") {
            "open"
        } else {
            "xdg-open"
        })
        .arg(url)
        .stdin(std::process::Stdio::null())
        .stdout(std::process::Stdio::null())
        .stderr(std::process::Stdio::null())
        .status()
        .await;
        if !opened.is_ok_and(|s| s.success()) {
            let mut s = lock(&self.state)?;
            s.epoch += 1;
            s.pending = false;
            s.error = Some("Giriş tarayıcısı açılamadı".into());
            self.changed.send_replace(s.epoch);
            return Err("ChatGPT giriş tarayıcısı açılamadı".into());
        }
        Ok(json!({"pending":true}))
    }
    fn retain_issued_registration(&self, a: &Attempt, issued: &str) -> Result<(), String> {
        let mut s = lock(&self.state)?;
        if s.epoch != a.epoch || !s.pending {
            return Err("ChatGPT giriş işlemi iptal edildi".into());
        }
        if issued.is_empty()
            || issued == DYNAMIC
            || issued.len() >= 512
            || a.registration
                .client_id
                .as_deref()
                .is_some_and(|id| id != issued)
        {
            return Err("ChatGPT uygulama kaydı eşleşmedi".into());
        }
        let mut registration = a.registration.clone();
        registration.client_id = Some(issued.to_owned());
        // This callback has valid state but has not established a new identity.
        // Keep a previously verified subject; a new registration remains None.
        private_registration(&self.path, &registration)?;
        s.registration = registration;
        if s.registration.subject.is_none() {
            s.needs_consent = true;
        }
        Ok(())
    }
    async fn exchange(&self, a: &Attempt, code: &str, issued: &str) -> Result<(), String> {
        // A single-use authorization code can expire or its response can be
        // lost. Retain its issued client before exchange, not after success.
        self.retain_issued_registration(a, issued)?;
        let value = bounded_json(
            client()?
                .post(format!("{AUTH}/api/accounts/oauth/token"))
                .form(&[
                    ("grant_type", "authorization_code"),
                    ("client_id", issued),
                    ("code", code),
                    ("code_verifier", &a.verifier),
                    ("redirect_uri", &a.redirect),
                    ("resource", RESOURCE),
                ])
                .send()
                .await
                .map_err(|_| "ChatGPT giriş bağlantısı tamamlanamadı")?,
            128 * 1024,
        )
        .await?;
        let subject = identity(
            value["id_token"]
                .as_str()
                .ok_or("ChatGPT kimlik kaydı eksik")?,
            issued,
            Some(&a.nonce),
            a.registration.subject.as_deref(),
        )
        .await?;
        let credentials = credentials(&value, None)?;
        let mut s = lock(&self.state)?;
        if s.epoch != a.epoch {
            return Err("ChatGPT giriş işlemi iptal edildi".into());
        }
        let registration = Registration {
            schema_version: 1,
            host: a.registration.host.clone(),
            client_id: Some(issued.to_owned()),
            subject: Some(subject),
        };
        private_registration(&self.path, &registration)?;
        s.registration = registration;
        s.needs_consent = !sharing(&credentials);
        s.credentials = Some(credentials);
        s.error = None;
        Ok(())
    }
    fn refresh_response(&self, epoch: u64, status: u16, value: Value) -> Result<Value, String> {
        if (200..300).contains(&status) {
            return Ok(value);
        }
        let code = response_error_code(&value);
        let message = remote_error(code, status);
        if terminal_refresh_error(code) {
            let mut s = lock(&self.state)?;
            // A stale response must not erase credentials from a newer login.
            if s.epoch == epoch {
                s.credentials = None;
                s.error = Some(message.clone());
                s.epoch += 1;
                self.changed.send_replace(s.epoch);
            }
        }
        Err(message)
    }
    async fn access(&self) -> Result<(String, u64), String> {
        let _gate = self.refresh_gate.lock().await;
        let (registration, old, epoch) = {
            let s = lock(&self.state)?;
            if s.pending {
                return Err("Önce ChatGPT girişini tamamlayın".into());
            }
            (
                s.registration.clone(),
                s.credentials
                    .clone()
                    .ok_or("Önce Continue with ChatGPT ile giriş yapın")?,
                s.epoch,
            )
        };
        if !sharing(&old) {
            return Err("ChatGPT planını Töre ile kullanma izni verilmemiş".into());
        }
        if old.expires > chrono::Utc::now().timestamp() + 60 {
            return Ok((old.access, epoch));
        }
        let refresh = old
            .refresh
            .as_deref()
            .ok_or("ChatGPT oturum süresi doldu; tekrar giriş yapın")?;
        let issued = registration
            .client_id
            .as_deref()
            .ok_or("ChatGPT hesap kaydı eksik")?;
        let (status, value) = json_response(
            client()?
                .post(format!("{AUTH}/api/accounts/oauth/token"))
                .form(&[
                    ("grant_type", "refresh_token"),
                    ("client_id", issued),
                    ("refresh_token", refresh),
                    ("resource", RESOURCE),
                ])
                .send()
                .await
                .map_err(|_| "ChatGPT oturumu yenilenemedi")?,
            128 * 1024,
        )
        .await?;
        let value = self.refresh_response(epoch, status, value)?;
        if let Some(token) = value["id_token"].as_str() {
            identity(token, issued, None, registration.subject.as_deref()).await?;
        }
        let next = credentials(&value, Some(&old))?;
        let mut s = lock(&self.state)?;
        if s.epoch != epoch {
            return Err("ChatGPT hesabı değişti; yeniden önizleyin".into());
        }
        let access = next.access.clone();
        s.needs_consent = !sharing(&next);
        s.credentials = Some(next);
        if s.needs_consent {
            return Err(
                "ChatGPT plan paylaşım izni artık bulunmuyor; yeniden girişle izin verin".into(),
            );
        }
        Ok((access, epoch))
    }
    pub async fn disconnect(&self) -> Result<Value, String> {
        let old = {
            let mut s = lock(&self.state)?;
            s.epoch += 1;
            s.pending = false;
            s.error = None;
            self.changed.send_replace(s.epoch);
            (s.registration.clone(), s.credentials.take())
        };
        // Clear RAM immediately, then best-effort revocation through the issuer's documented endpoint.
        let revoked = async {
            let token = old.1.and_then(|c| c.refresh).ok_or(())?;
            let discovery = bounded_json(
                client()
                    .map_err(|_| ())?
                    .get(format!("{AUTH}/.well-known/openid-configuration"))
                    .send()
                    .await
                    .map_err(|_| ())?,
                128 * 1024,
            )
            .await
            .map_err(|_| ())?;
            let endpoint = url::Url::parse(discovery["revocation_endpoint"].as_str().ok_or(())?)
                .map_err(|_| ())?;
            if endpoint.scheme() != "https"
                || endpoint.host_str() != Some("auth.openai.com")
                || endpoint.port_or_known_default() != Some(443)
                || !endpoint.username().is_empty()
                || endpoint.password().is_some()
            {
                return Err(());
            }
            let response = client()
                .map_err(|_| ())?
                .post(endpoint)
                .form(&[
                    ("token", token.as_str()),
                    ("token_type_hint", "refresh_token"),
                    ("client_id", old.0.client_id.as_deref().ok_or(())?),
                ])
                .send()
                .await
                .map_err(|_| ())?;
            if response.status().is_success() {
                Ok(())
            } else {
                Err(())
            }
        };
        let confirmed = tokio::time::timeout(Duration::from_secs(12), revoked)
            .await
            .is_ok_and(|v| v.is_ok());
        Ok(
            json!({"connected":false,"revocationConfirmed":confirmed,"message":if confirmed{"ChatGPT bağlantısı kapatıldı."}else{"Bu bilgisayardaki bağlantı kapatıldı. Uzaktaki izni ChatGPT kullanım ayarlarından da kaldırabilirsiniz."}}),
        )
    }
    async fn guarded<T>(
        &self,
        epoch: u64,
        work: impl std::future::Future<Output = Result<T, String>>,
    ) -> Result<T, String> {
        let mut changed = self.changed.subscribe();
        if lock(&self.state)?.epoch != epoch {
            return Err("ChatGPT bağlantısı değişti".into());
        }
        tokio::select! {
            biased;
            _=changed.changed()=>Err("ChatGPT bağlantısı değişti; istek otomatik tekrarlanmadı".into()),
            result=work=>result
        }
    }
    pub async fn models(&self) -> Result<Value, String> {
        let (access, epoch) = self.access().await?;
        self.guarded(epoch,async {
            let value=bounded_json(client()?.get(format!("{RESOURCE}/models")).bearer_auth(access).send().await.map_err(|_|"ChatGPT model kataloğu alınamadı")?,2*1024*1024).await?;
            Ok(json!({"models":catalog(&value)?,"warnings":["ChatGPT plan kotası ve hesabınızda izin verdiğiniz krediler geçerlidir. Töre ödeme veya otomatik yükleme yapmaz."]}))
        }).await
    }
    pub async fn synthesize(&self, model: &str, prompt: &str) -> Result<Value, String> {
        if prompt.len() > 128 * 1024 {
            return Err("Gönderilecek metin çok büyük".into());
        }
        let (access, epoch) = self.access().await?;
        self.guarded(epoch,async {
            let http=client()?;
            let models=bounded_json(http.get(format!("{RESOURCE}/models")).bearer_auth(&access).send().await.map_err(|_|"ChatGPT kataloğu doğrulanamadı")?,2*1024*1024).await?;
            if !catalog(&models)?.iter().any(|v|v["id"]==model){return Err("Seçilen model bu ChatGPT hesabında sunulmuyor; kataloğu yenileyin".into());}
            let body=json!({"model":model,"input":[{"role":"user","content":prompt}],"store":false,"stream":true});
            let mut response=http.post(format!("{RESOURCE}/responses")).bearer_auth(access).header("content-type","application/json").body(serde_json::to_vec(&body).map_err(|_|"İstek hazırlanamadı")?).send().await.map_err(|_|"ChatGPT bağlantısı kurulamadı veya zaman aşımına uğradı; istek otomatik tekrarlanmadı")?;
            if !response.status().is_success(){bounded_json(response,128*1024).await?;return Err("ChatGPT yanıtı geçersiz".into());}
            let mut decoder=Stream::default();
            while let Some(chunk)=response.chunk().await.map_err(|_|"Gönderimden sonra ChatGPT bağlantısı kesildi; sonuç belirsiz, otomatik tekrar yok")? {
                if let Some(result)=decoder.feed(&chunk,model)?{return Ok(result);}
            }
            Err("ChatGPT akışı tamamlanma kaydı gelmeden kesildi; otomatik tekrar yapılmadı".into())
        }).await
    }
}
fn catalog(value: &Value) -> Result<Vec<Value>, String> {
    let models = value["models"]
        .as_array()
        .ok_or("ChatGPT plan model kataloğu geçersiz")?;
    let mut seen = std::collections::BTreeSet::new();
    Ok(models
        .iter()
        .filter(|m| m["visibility"] == "list")
        .filter_map(|m| {
            let id = m["slug"].as_str()?;
            let name = m["display_name"].as_str()?;
            if id.is_empty()
                || id.len() > 200
                || id.chars().any(char::is_control)
                || !seen.insert(id)
            {
                return None;
            }
            Some(json!({"id":id,"name":name,"developer":"openai","costMode":"subscription"}))
        })
        .collect())
}
#[derive(Default)]
struct Stream {
    pending: Vec<u8>,
    data: Vec<String>,
    total: usize,
}
impl Stream {
    fn feed(&mut self, bytes: &[u8], model: &str) -> Result<Option<Value>, String> {
        self.total += bytes.len();
        if self.total > 4 * 1024 * 1024 {
            return Err("ChatGPT akış boyutu sınırı aşıldı".into());
        }
        self.pending.extend_from_slice(bytes);
        while let Some(end) = self.pending.iter().position(|c| *c == b'\n') {
            let line: Vec<_> = self.pending.drain(..=end).collect();
            let line = std::str::from_utf8(&line)
                .map_err(|_| "ChatGPT akış kodlaması geçersiz")?
                .trim_end_matches(['\n', '\r']);
            if line.is_empty() {
                if self.data.is_empty() {
                    continue;
                }
                let data = self.data.join("\n");
                self.data.clear();
                if data == "[DONE]" {
                    return Err("ChatGPT tamamlanma kaydı eksik".into());
                }
                let event: Value =
                    serde_json::from_str(&data).map_err(|_| "ChatGPT akış olayı geçersiz")?;
                match event["type"].as_str() {
                    Some("response.completed") => {
                        return completed(&event["response"], model).map(Some);
                    }
                    Some(
                        "response.failed" | "response.incomplete" | "error" | "response.error",
                    ) => {
                        return Err(remote_error(
                            event["response"]["error"]["code"]
                                .as_str()
                                .or_else(|| event["code"].as_str())
                                .unwrap_or(""),
                            0,
                        ));
                    }
                    _ => {}
                }
            } else if let Some(data) = line.strip_prefix("data:") {
                self.data
                    .push(data.strip_prefix(' ').unwrap_or(data).to_owned());
            }
        }
        Ok(None)
    }
}
fn completed(response: &Value, model: &str) -> Result<Value, String> {
    if response["status"] != "completed" || response["model"] != model {
        return Err("ChatGPT yanıt modeli veya tamamlanma durumu eşleşmedi".into());
    }
    let mut text = String::new();
    for item in response["output"]
        .as_array()
        .ok_or("ChatGPT yanıtı eksik")?
    {
        if item["type"] != "message" || item["role"] != "assistant" {
            continue;
        }
        for part in item["content"].as_array().ok_or("ChatGPT metni eksik")? {
            if part["type"] == "refusal" {
                return Err("ChatGPT bu değerlendirmeyi üretmeyi reddetti".into());
            }
            if part["type"] == "output_text" {
                text.push_str(
                    part["text"]
                        .as_str()
                        .ok_or("ChatGPT metin biçimi geçersiz")?,
                );
            }
        }
    }
    if text.trim().is_empty() || text.len() > 512 * 1024 {
        return Err("ChatGPT metni boş veya çok büyük".into());
    }
    // Never persist arbitrary provider metadata or hidden reasoning.
    let usage = json!({"inputTokens":response["usage"]["input_tokens"].as_u64(),"outputTokens":response["usage"]["output_tokens"].as_u64()});
    Ok(json!({"text":text,"modelId":model,"usage":usage}))
}

#[cfg(test)]
mod tests {
    use super::*;
    fn temp_root() -> PathBuf {
        fs::canonicalize(std::env::temp_dir())
            .unwrap()
            .join(format!("tore-auth-{}", uuid::Uuid::new_v4()))
    }
    fn synthetic_credentials() -> Credentials {
        Credentials {
            access: "synthetic-secret".into(),
            refresh: Some("synthetic-refresh".into()),
            scopes: SCOPE.split_whitespace().map(str::to_owned).collect(),
            expires: chrono::Utc::now().timestamp() + 3600,
        }
    }
    fn attempt() -> Attempt {
        Attempt {
            registration: Registration {
                schema_version: 1,
                host: "urn:uuid:synthetic".into(),
                client_id: None,
                subject: None,
            },
            state: "synthetic-state".into(),
            nonce: "synthetic-nonce".into(),
            verifier: "synthetic-verifier".into(),
            redirect: "http://127.0.0.1:12345/auth/callback".into(),
            epoch: 1,
            reconsent: false,
        }
    }
    #[test]
    fn oauth_pkce_callback_binding() {
        let a = attempt();
        let url = url::Url::parse(&authorization_url(&a)).unwrap();
        let q: BTreeMap<_, _> = url.query_pairs().collect();
        assert_eq!(q["client_id"], DYNAMIC);
        assert_eq!(q["agent_name_hint"], "Töre");
        assert_eq!(
            q["code_challenge"],
            URL_SAFE_NO_PAD.encode(Sha256::digest(a.verifier.as_bytes()))
        );
        assert!(parse_callback("state=wrong&code=x&client_id=issued", &a).is_err());
        assert!(
            parse_callback(
                "state=synthetic-state&code=x&client_id=dynamic_agent_client",
                &a
            )
            .is_err()
        );
        assert!(
            parse_callback(
                "state=synthetic-state&state=synthetic-state&code=x&client_id=issued",
                &a
            )
            .is_err()
        );
        assert!(parse_callback("state=synthetic-state&error=access_denied", &a).is_err());
        assert_eq!(
            parse_callback("state=synthetic-state&code=x&client_id=issued", &a)
                .unwrap()
                .1,
            "issued"
        );
        let mut a = a;
        a.registration.client_id = Some("issued".into());
        assert!(parse_callback("state=synthetic-state&code=x&client_id=another", &a).is_err());
        assert_eq!(
            parse_callback("state=synthetic-state&code=x", &a)
                .unwrap()
                .1,
            "issued"
        );
    }
    #[test]
    fn consent_is_requested_only_for_explicit_recovery() {
        let mut a = attempt();
        a.registration.client_id = Some("issued".into());
        let ordinary = url::Url::parse(&authorization_url(&a)).unwrap();
        assert!(
            !ordinary
                .query_pairs()
                .any(|(k, _)| k == "prompt" || k == "agent_name_hint")
        );
        a.reconsent = true;
        let recovery = url::Url::parse(&authorization_url(&a)).unwrap();
        let fields: BTreeMap<_, _> = recovery.query_pairs().collect();
        assert_eq!(fields["prompt"], "consent");
        assert_eq!(fields["scope"], SCOPE);
        assert_eq!(fields["client_id"], "issued");
        assert!(!fields.contains_key("force_reconsent"));
    }
    #[test]
    fn callback_registration_survives_failed_exchange_without_inventing_identity() {
        let root = temp_root();
        let service = Service::open(root.clone()).unwrap();
        let mut a = attempt();
        {
            let mut s = service.state.lock().unwrap();
            s.epoch = a.epoch;
            s.pending = true;
            a.registration = s.registration.clone();
        }
        let (_, issued) =
            parse_callback("state=synthetic-state&code=unused&client_id=issued", &a).unwrap();
        service.retain_issued_registration(&a, &issued).unwrap();
        // No exchange, provider or model call: emulate a lost token response by reopening.
        drop(service);
        let reopened = Service::open(root.clone()).unwrap();
        {
            let mut s = reopened.state.lock().unwrap();
            assert_eq!(s.registration.client_id.as_deref(), Some("issued"));
            assert!(s.registration.subject.is_none());
            assert!(s.credentials.is_none());
            assert!(s.needs_consent);
            s.registration.subject = Some("verified-subject".into());
            s.credentials = Some(synthetic_credentials());
            s.epoch = 2;
            s.pending = true;
            a.epoch = 2;
            a.registration = s.registration.clone();
        }
        reopened.retain_issued_registration(&a, "issued").unwrap();
        {
            let s = reopened.state.lock().unwrap();
            assert_eq!(s.registration.subject.as_deref(), Some("verified-subject"));
            assert_eq!(s.credentials.as_ref().unwrap().access, "synthetic-secret");
        }
        assert!(
            reopened
                .retain_issued_registration(&a, "different")
                .is_err()
        );
        reopened.state.lock().unwrap().epoch += 1;
        assert!(reopened.retain_issued_registration(&a, "issued").is_err());
        let persisted = fs::read_to_string(&reopened.path).unwrap();
        assert!(!persisted.contains("synthetic-secret"));
        assert!(!persisted.contains("unused"));
        fs::remove_dir_all(root).unwrap();
    }
    #[test]
    fn only_terminal_refresh_errors_clear_current_credentials() {
        let root = temp_root();
        let service = Service::open(root.clone()).unwrap();
        for code in [
            "invalid_grant",
            "invalid_refresh_token",
            "token_expired",
            "refresh_token_expired",
            "refresh_token_invalidated",
            "refresh_token_reused",
        ] {
            let epoch = {
                let mut s = service.state.lock().unwrap();
                s.credentials = Some(synthetic_credentials());
                s.registration.client_id = Some("issued".into());
                s.registration.subject = Some("verified-subject".into());
                s.epoch
            };
            let error = service
                .refresh_response(
                    epoch,
                    400,
                    json!({"error":code,"error_description":"private synthetic text"}),
                )
                .unwrap_err();
            assert!(!error.contains("private"));
            let s = service.state.lock().unwrap();
            assert!(s.credentials.is_none());
            assert_eq!(s.registration.client_id.as_deref(), Some("issued"));
            assert_eq!(s.registration.subject.as_deref(), Some("verified-subject"));
        }
        let epoch = {
            let mut s = service.state.lock().unwrap();
            s.credentials = Some(synthetic_credentials());
            s.epoch
        };
        for (status, code) in [
            (503, "service_unavailable"),
            (429, "rate_limit"),
            (400, "invalid_client"),
            (401, "private synthetic unknown"),
        ] {
            let error = service
                .refresh_response(epoch, status, json!({"error":{"code":code}}))
                .unwrap_err();
            assert!(!error.contains("private"));
            assert!(service.state.lock().unwrap().credentials.is_some());
        }
        service.state.lock().unwrap().epoch += 1;
        assert!(
            service
                .refresh_response(epoch, 400, json!({"error":{"code":"invalid_grant"}}))
                .is_err()
        );
        assert!(service.state.lock().unwrap().credentials.is_some());
        fs::remove_dir_all(root).unwrap();
    }
    #[tokio::test]
    async fn connection_epoch_cancels_guarded_work_without_retry() {
        let root = temp_root();
        let service = Service::open(root.clone()).unwrap();
        let (started_tx, started_rx) = oneshot::channel();
        let running = service.clone();
        let task = tokio::spawn(async move {
            running
                .guarded(0, async {
                    started_tx.send(()).unwrap();
                    std::future::pending::<Result<(), String>>().await
                })
                .await
        });
        started_rx.await.unwrap();
        {
            let mut s = service.state.lock().unwrap();
            s.epoch += 1;
            service.changed.send_replace(s.epoch);
        }
        assert!(
            tokio::time::timeout(Duration::from_secs(1), task)
                .await
                .unwrap()
                .unwrap()
                .is_err()
        );
        fs::remove_dir_all(root).unwrap();
    }
    #[test]
    fn scopes_are_not_inferred_from_identity() {
        let mut v = json!({"access_token":"synthetic","token_type":"Bearer","expires_in":1000,"scope":"openid email"});
        assert!(!sharing(&credentials(&v, None).unwrap()));
        v["scope"] = json!(SCOPE);
        assert!(sharing(&credentials(&v, None).unwrap()));
        v.as_object_mut().unwrap().remove("scope");
        assert!(credentials(&v, None).is_err());
    }

    #[test]
    fn signed_rs256_identity_checks_signature_and_claims() {
        // Public synthetic fixture generated solely for this test. Never use as a real key.
        const SYNTHETIC_DER: &str = "MIIEpQIBAAKCAQEAyB6dd7Z7IhmZhKI4kXpWLEXKXfrqffR541DSmCb2FejqLEHrzlbHZ-oDKWJ9RJ9KC8P6KSegVDlHky1XjwLci58wIWZXvczyA6bRaTdc5AhcecEC1Bvv-9Rw1yURangEv6lDjYxCQuGW92tnjm8X_p_0kqCRRJ7e5zbrMfKbIIKW8u17_lhfeM2U7tykvzhKa80zPHZF-v1luilhS9hzS9sGmuFBkz7z8_8tZkLcGccM1dMTx72GlgMryRFxcnG66Y4N1blan3THJLAQ4utANBSdBNIOt8ndZ9kRyYeLSm30z5hS0va-cRa46zX9IUldzlyBhB5oEpdek9pAFvBBRQIDAQABAoIBABG0U64RoNcleKV5TJPiRNlp2ztxRWmbRWVM8zSuzbqmfoEn29rHZqDU3S6-HeMCTKS509nsPYz1_FUS_9oRIL3heXqa-Uw7Y3XbPk-WrEsoSjYjU0K8rgCTjOAb0Wyf7ZufN_C_5eTQ3HBLOkApp-_I6vRF7FQr0gCWpTwoAH1hqDGJrYzAZKrsh9_axzmCRtJsRCmRQ2WVMvKBrU2DT3OW2b9IravUVcFcXoVLBQb3ADM8uUbCNLR5nnc5b-K9Z7UJ2LfP-XkId9iLct2kySqlE4Qzb7TSURTLgRyv2REfaT7sk1KNVbCW04e3oP_glk6mAVieNa2rpTjCeBlhMkECgYEA6tpj_nHvg-jxnnetlWV-T8r6UejagSP2LshwS06iIxRJoKJZeZlKBUQweTOl0VIAZxyN3y0R7n1MlhBzQxVNo2SCRWfe0KYTGbrBKg2WVTgqtLBWVuCEzOi2eYb24hzRclX6lMLiD1FPdojAVYer2PYKtE8pnXEWHkC4xSEMb30CgYEA2iOUvuBNmL6FNfDXUvr-7n_WYve0-2A62bSs_xCzZptt1xXUTPF6pX6G6oVgcyi8LP-cE4MdiG-uPhWFOs6lWkJ7lueCWj6HKzSgmZr6A9LAkrRuH4BJe-qT-_MMCR_QgX0oBOxJqD1Wkz_K1rBqpXa6Lg0mUXrbSMjEuIRFU2kCgYEAogog6BRwr9DvtOjaKbQnXKKt6AoDiQro9wpxAGS21gFPc7fQiGfNfKi50UZjaHNtt7cp5AxSzPxC9V9QR77RHKVihMTQJaIQl7YVRRCu4wmn3Ze1Wqf6uO7vyBXpDcXYdU0BYda85tixPRXJrrm3RjEs3Y-pJOo72o_JbKoKzHkCgYEAvLEej-YS-VeEf15vxBXdw4zNdBp1cSSSg5NoOdLGfLFiWDVHya7wuosyRVdOUQ8hh4MsDSzTtRt2C7ot3uq12de8dJKaDVodLmB9s6F9NyVs8vokcBdWeVw22jApbxMYF4qdvXRvWpqEcycxXHiKJ8sFzaQOS1kMqm8Qy9OO7FECgYEA1YJVFo82BQ5eff2tBKAT9B0f0FzZXvd9bDB4zihTtJ9lqLzMLB_8-V5woipKJFbqQAY6ybogDv9U7cx3ofqcWVwc6_3hf88kOJDKxRXH6MiyrH0ibzmad8qcRsqBW2qYa7lun-XD-Vw41lNFiDCwKDBl1hSr6zzIeJ2nS_bEoms";
        let key = jsonwebtoken::EncodingKey::from_rsa_der(
            &URL_SAFE_NO_PAD.decode(SYNTHETIC_DER).unwrap(),
        );
        let jwks = json!({"keys":[{"kty":"RSA","kid":"synthetic-jwt-fixture","use":"sig","alg":"RS256","n":"yB6dd7Z7IhmZhKI4kXpWLEXKXfrqffR541DSmCb2FejqLEHrzlbHZ-oDKWJ9RJ9KC8P6KSegVDlHky1XjwLci58wIWZXvczyA6bRaTdc5AhcecEC1Bvv-9Rw1yURangEv6lDjYxCQuGW92tnjm8X_p_0kqCRRJ7e5zbrMfKbIIKW8u17_lhfeM2U7tykvzhKa80zPHZF-v1luilhS9hzS9sGmuFBkz7z8_8tZkLcGccM1dMTx72GlgMryRFxcnG66Y4N1blan3THJLAQ4utANBSdBNIOt8ndZ9kRyYeLSm30z5hS0va-cRa46zX9IUldzlyBhB5oEpdek9pAFvBBRQ","e":"AQAB"}]});
        let mut header = jsonwebtoken::Header::new(Algorithm::RS256);
        header.kid = Some("synthetic-jwt-fixture".into());
        let claims = json!({"iss":AUTH,"aud":"issued","sub":"synthetic-subject","nonce":"synthetic-nonce","exp":chrono::Utc::now().timestamp()+3600});
        let sign = |v: &Value| jsonwebtoken::encode(&header, v, &key).unwrap();
        let token = sign(&claims);
        assert_eq!(
            verify_token(
                &token,
                &jwks,
                "issued",
                Some("synthetic-nonce"),
                Some("synthetic-subject")
            )
            .unwrap(),
            "synthetic-subject"
        );
        for (field, bad) in [
            ("iss", json!("https://invalid.example")),
            ("aud", json!("different-client")),
            ("sub", json!("different-subject")),
            ("nonce", json!("different-nonce")),
            ("exp", json!(chrono::Utc::now().timestamp() - 120)),
            ("nbf", json!(chrono::Utc::now().timestamp() + 3600)),
        ] {
            let mut changed = claims.clone();
            changed[field] = bad;
            assert!(
                verify_token(
                    &sign(&changed),
                    &jwks,
                    "issued",
                    Some("synthetic-nonce"),
                    Some("synthetic-subject")
                )
                .is_err(),
                "accepted wrong {field}"
            );
        }
        let mut no_nonce = claims.clone();
        no_nonce.as_object_mut().unwrap().remove("nonce");
        assert!(
            verify_token(
                &sign(&no_nonce),
                &jwks,
                "issued",
                Some("synthetic-nonce"),
                None
            )
            .is_err()
        );
        let mut parts: Vec<String> = token.split('.').map(str::to_owned).collect();
        let mut signature = URL_SAFE_NO_PAD.decode(&parts[2]).unwrap();
        signature[0] ^= 1;
        parts[2] = URL_SAFE_NO_PAD.encode(signature);
        assert!(
            verify_token(
                &parts.join("."),
                &jwks,
                "issued",
                Some("synthetic-nonce"),
                None
            )
            .is_err()
        );
    }

    #[test]
    fn rejects_unsigned_and_wrong_algorithm_identity() {
        let payload=URL_SAFE_NO_PAD.encode(br#"{"sub":"test","iss":"https://auth.openai.com","aud":"issued","exp":9999999999,"nonce":"n"}"#);
        for header in [r#"{"alg":"none"}"#, r#"{"alg":"HS256","kid":"test"}"#] {
            let token = format!("{}.{}.", URL_SAFE_NO_PAD.encode(header), payload);
            assert!(verify_token(&token, &json!({"keys":[]}), "issued", Some("n"), None).is_err());
        }
    }
    #[test]
    fn catalog_uses_only_visible_plan_models() {
        assert_eq!(catalog(&json!({"models":[{"slug":"a","display_name":"A","visibility":"list"},{"slug":"b","display_name":"B","visibility":"hidden"},{"slug":"a","display_name":"A","visibility":"list"}]})).unwrap().len(),1);
        assert!(catalog(&json!({"data":[]})).is_err());
    }
    #[test]
    fn stream_requires_terminal_and_ignores_reasoning() {
        let response = json!({"type":"response.completed","response":{"status":"completed","model":"synthetic","output":[{"type":"reasoning","text":"hidden"},{"type":"message","role":"assistant","content":[{"type":"output_text","text":"{\"test\":\"Türkçe\"}"}]}],"usage":{"input_tokens":4,"output_tokens":2,"secret":"ignored"}}});
        let frame = format!("data: {}\r\n\r\n", response);
        let mut stream = Stream::default();
        let mut result = None;
        for byte in frame.as_bytes() {
            if let Some(v) = stream.feed(&[*byte], "synthetic").unwrap() {
                result = Some(v);
            }
        }
        let result = result.unwrap();
        assert_eq!(result["text"], "{\"test\":\"Türkçe\"}");
        assert!(result["usage"].get("secret").is_none());
        assert!(
            Stream::default()
                .feed(frame.as_bytes(), "different")
                .is_err()
        );
        assert!(
            Stream::default()
                .feed(
                    b"data: {\"type\":\"response.output_text.delta\",\"delta\":\"partial\"}\n\n",
                    "synthetic"
                )
                .unwrap()
                .is_none()
        );
        assert!(
            Stream::default()
                .feed(b"data: [DONE]\n\n", "synthetic")
                .is_err()
        );
    }
    #[test]
    fn stream_failures_are_sanitized() {
        let frame=b"data: {\"type\":\"response.failed\",\"response\":{\"error\":{\"code\":\"subscription_sharing_usage_limit_exceeded\",\"message\":\"private synthetic text\"}}}\n\n";
        let error = Stream::default().feed(frame, "synthetic").unwrap_err();
        assert!(error.contains("kota"));
        assert!(!error.contains("private"));
    }
    #[test]
    fn registration_never_stores_tokens() {
        let root = temp_root();
        let s = Service::open(root.clone()).unwrap();
        {
            let mut state = s.state.lock().unwrap();
            state.credentials = Some(Credentials {
                access: "synthetic-secret".into(),
                refresh: Some("synthetic-refresh".into()),
                scopes: vec![],
                expires: 9999999999,
            });
        }
        assert!(
            !fs::read_to_string(&s.path)
                .unwrap()
                .contains("synthetic-secret")
        );
        let host = s.state.lock().unwrap().registration.host.clone();
        drop(s);
        let reopened = Service::open(root.clone()).unwrap();
        assert_eq!(host, reopened.state.lock().unwrap().registration.host);
        assert_eq!(reopened.status().unwrap()["connected"], false);
        fs::remove_dir_all(root).unwrap();
    }
}
