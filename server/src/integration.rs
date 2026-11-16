//! Fixed local helper, authenticated loopback routes; credentials never reach the browser.
use axum::{
    Json, Router,
    extract::{DefaultBodyLimit, State, rejection::JsonRejection},
    http::{HeaderMap, StatusCode},
    response::{IntoResponse, Response},
    routing::{get, post},
};
use serde_json::{Value, json};
use sha2::{Digest, Sha256};
use std::{path::PathBuf, process::Stdio, sync::Arc, time::Duration};
use tokio::{io::AsyncWriteExt, sync::Semaphore};
#[derive(Clone)]
struct Integration {
    token_hash: [u8; 32],
    host: String,
    origin: String,
    archive: PathBuf,
    gate: Arc<Semaphore>,
}
struct Error(StatusCode, String);
impl IntoResponse for Error {
    fn into_response(self) -> Response {
        (
            self.0,
            Json(json!({"code":"IntegrationError","error":self.1})),
        )
            .into_response()
    }
}
type Result<T> = std::result::Result<T, Error>;
fn failed(message: &str) -> Error {
    Error(StatusCode::BAD_REQUEST, message.into())
}
pub fn router(token: String, origin: String, archive: PathBuf) -> Router {
    let host = origin
        .parse::<axum::http::Uri>()
        .ok()
        .and_then(|u| u.authority().map(|s| s.as_str().to_owned()))
        .unwrap_or_default();
    Router::new()
        .route("/api/private/integration/status", get(status))
        .route("/api/private/integration/refresh", post(refresh))
        .route("/api/private/integration/read", post(read))
        .route("/api/private/integration/context", post(context))
        .route("/api/private/integration/backup", post(backup))
        .route("/api/private/integration/restore-test", post(restore_test))
        .layer(DefaultBodyLimit::max(16384))
        .with_state(Integration {
            token_hash: Sha256::digest(token.as_bytes()).into(),
            host,
            origin,
            archive,
            gate: Arc::new(Semaphore::new(1)),
        })
}
impl Integration {
    fn authorize(&self, h: &HeaderMap, write: bool) -> Result<()> {
        let given = h
            .get("authorization")
            .and_then(|s| s.to_str().ok())
            .and_then(|s| s.strip_prefix("Bearer "))
            .unwrap_or("");
        let digest: [u8; 32] = Sha256::digest(given.as_bytes()).into();
        if digest
            .iter()
            .zip(self.token_hash.iter())
            .fold(0u8, |a, (x, y)| a | (x ^ y))
            != 0
        {
            return Err(Error(
                StatusCode::UNAUTHORIZED,
                "Yerel oturum anahtarı geçersiz.".into(),
            ));
        }
        let origin = h.get("origin").and_then(|v| v.to_str().ok());
        if self.host.is_empty()
            || h.get("host").and_then(|s| s.to_str().ok()) != Some(self.host.as_str())
            || origin.is_some_and(|s| s != self.origin)
            || write && origin.is_none()
            || h.get("sec-fetch-site")
                .and_then(|s| s.to_str().ok())
                .is_some_and(|s| s != "same-origin" && s != "none")
        {
            return Err(Error(
                StatusCode::FORBIDDEN,
                "Bağlantı isteğinin kökeni bu yerel oturumla uyuşmuyor.".into(),
            ));
        }
        Ok(())
    }
    async fn execute(&self, action: &str, payload: Value) -> Result<Json<Value>> {
        let _permit = self.gate.clone().try_acquire_owned().map_err(|_| {
            Error(
                StatusCode::TOO_MANY_REQUESTS,
                "Bir bağlantı veya yedek işlemi sürüyor; tamamlanmasını bekleyin.".into(),
            )
        })?;
        let exe = std::env::current_exe().map_err(|_| failed("Uygulama yolu bulunamadı."))?;
        let script = if exe
            .parent()
            .is_some_and(|d| d.file_name().is_some_and(|n| n == "MacOS"))
        {
            exe.parent()
                .unwrap()
                .parent()
                .unwrap()
                .join("Resources/integration/service.py")
        } else {
            PathBuf::from(env!("CARGO_MANIFEST_DIR"))
                .parent()
                .unwrap()
                .join("integration/service.py")
        };
        let base = self
            .archive
            .parent()
            .ok_or_else(|| failed("Arşiv konumu geçersiz."))?;
        let input = json!({"root":base.join("Töre Bağlantıları"),"archive":self.archive,"backupRoot":base.join("Töre Ortak Yedekler"),"action":action,"payload":payload});
        let mut child=tokio::process::Command::new("/usr/bin/python3").arg("-B").arg(&script).env_clear().env("PATH","/usr/bin:/bin").env("LANG","en_US.UTF-8").stdin(Stdio::piped()).stdout(Stdio::piped()).stderr(Stdio::null()).kill_on_drop(true).spawn().map_err(|_|failed("Yerel bağlantı yardımcısı açılamadı. Python 3 ve kurulum dosyaları kontrol edilmeli; arşiv korunur."))?;
        child
            .stdin
            .take()
            .unwrap()
            .write_all(&serde_json::to_vec(&input).unwrap())
            .await
            .map_err(|_| failed("Bağlantı yardımcısına istek iletilemedi."))?;
        let output = tokio::time::timeout(Duration::from_secs(150), child.wait_with_output())
            .await
            .map_err(|_| failed("Bağlantı zaman aşımına uğradı; son sağlam veriler korundu."))?
            .map_err(|_| failed("Bağlantı işlemi tamamlanamadı."))?;
        if output.stdout.len() > 16 * 1024 * 1024 {
            return Err(failed("Bağlantı yanıtı boyut sınırını aştı."));
        }
        let value: Value = serde_json::from_slice(&output.stdout)
            .map_err(|_| failed("Yerel bağlantı yanıtı doğrulanamadı; başarı bildirilmedi."))?;
        if !output.status.success() || value["ok"] != true {
            return Err(failed(value["error"].as_str().unwrap_or(
                "Bağlantı işlemi doğrulanamadı; son sağlam kayıt korunur.",
            )));
        }
        Ok(Json(value["result"].clone()))
    }
}
async fn status(State(s): State<Integration>, h: HeaderMap) -> Result<Json<Value>> {
    s.authorize(&h, false)?;
    s.execute("status", json!({})).await
}
macro_rules! operation {
    ($name:ident,$action:literal) => {
        async fn $name(
            State(s): State<Integration>,
            h: HeaderMap,
            b: std::result::Result<Json<Value>, JsonRejection>,
        ) -> Result<Json<Value>> {
            s.authorize(&h, true)?;
            let Json(p) = b.map_err(|_| failed("İstek geçerli JSON olmalı."))?;
            if !p.is_object() {
                return Err(failed("İstek alanları geçersiz."));
            }
            s.execute($action, p).await
        }
    };
}
operation!(refresh, "refresh");
operation!(read, "read");
operation!(context, "context");
operation!(backup, "backup");
operation!(restore_test, "restore-test");

#[cfg(test)]
mod tests {
    use super::*;
    use axum::{
        body::{Body, to_bytes},
        http::Request,
    };
    use tower::ServiceExt;
    #[tokio::test]
    async fn auth_and_origin_fail_closed_before_helper() {
        let app = router(
            "a".repeat(64),
            "http://127.0.0.1:4321".into(),
            "/tmp/test/archive".into(),
        );
        let r = app
            .clone()
            .oneshot(
                Request::builder()
                    .uri("/api/private/integration/status")
                    .header("host", "127.0.0.1:4321")
                    .body(Body::empty())
                    .unwrap(),
            )
            .await
            .unwrap();
        assert_eq!(r.status(), StatusCode::UNAUTHORIZED);
        let r = app
            .oneshot(
                Request::builder()
                    .method("POST")
                    .uri("/api/private/integration/refresh")
                    .header("host", "127.0.0.1:4321")
                    .header("authorization", format!("Bearer {}", "a".repeat(64)))
                    .header("origin", "https://attacker.invalid")
                    .header("content-type", "application/json")
                    .body(Body::from("{}"))
                    .unwrap(),
            )
            .await
            .unwrap();
        assert_eq!(r.status(), StatusCode::FORBIDDEN);
        let b = to_bytes(r.into_body(), 4096).await.unwrap();
        assert!(!b.is_empty());
    }
}
