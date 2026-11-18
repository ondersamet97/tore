use axum::{
    Json, Router,
    extract::{DefaultBodyLimit, State},
    http::{HeaderMap, StatusCode},
    response::{IntoResponse, Response},
    routing::post,
};
use serde_json::json;
use sha2::{Digest, Sha256};
#[derive(Clone)]
struct Shutdown {
    token: [u8; 32],
    origin: String,
    host: String,
    signal: tokio::sync::watch::Sender<bool>,
}
pub fn router(token: String, origin: String, signal: tokio::sync::watch::Sender<bool>) -> Router {
    let host = origin.strip_prefix("http://").unwrap_or("").to_owned();
    Router::new()
        .route("/api/private/shutdown", post(shutdown))
        .layer(DefaultBodyLimit::max(1024))
        .with_state(Shutdown {
            token: Sha256::digest(token.as_bytes()).into(),
            host,
            origin,
            signal,
        })
}
async fn shutdown(State(s): State<Shutdown>, h: HeaderMap) -> Response {
    let bearer = h
        .get("authorization")
        .and_then(|v| v.to_str().ok())
        .and_then(|v| v.strip_prefix("Bearer "))
        .unwrap_or("");
    let hash: [u8; 32] = Sha256::digest(bearer.as_bytes()).into();
    if hash.iter().zip(s.token).fold(0u8, |a, (x, y)| a | (x ^ y)) != 0
        || h.get("host").and_then(|v| v.to_str().ok()) != Some(s.host.as_str())
        || h.get("origin").and_then(|v| v.to_str().ok()) != Some(s.origin.as_str())
        || h.get("sec-fetch-site")
            .and_then(|v| v.to_str().ok())
            .is_some_and(|s| s != "same-origin" && s != "none")
    {
        return (
            StatusCode::FORBIDDEN,
            Json(json!({"error":"Kapatma isteğinin yerel erişimi veya kökeni geçersiz."})),
        )
            .into_response();
    }
    let _ = s.signal.send(true);
    Json(json!({"closing":true,"message":"Yerel hizmet, devam eden istekler tamamlanınca kapanacak. Yeniden açmak için kullandığınız Töre başlatıcısını açın."})).into_response()
}
