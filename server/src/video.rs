//! Local, explicit MP4 export. Same user-previewed PNG frames power MP4 and HyperFrames HTML.
//! Current Homebrew FFmpeg 8.1.1 has no drawtext: browser Canvas renders UTF-8 text;
//! FFmpeg only encodes the bounded 1280x720 images. No shell, report path, or remote renderer.
//! FFmpeg build/license details are exposed by status; this machine's build enables GPL/libx264.
use axum::{
    Json, Router,
    extract::{DefaultBodyLimit, State, rejection::JsonRejection},
    http::{HeaderMap, StatusCode},
    response::{IntoResponse, Response},
    routing::post,
};
use base64::{Engine, engine::general_purpose::STANDARD};
use serde::Deserialize;
use serde_json::{Value, json};
use sha2::{Digest, Sha256};
use std::{
    fs::{self, DirBuilder, OpenOptions},
    io::Write,
    os::unix::fs::{DirBuilderExt, OpenOptionsExt},
    path::{Path, PathBuf},
    process::{Command, Stdio},
    sync::Arc,
    time::{Duration, Instant},
};
use tokio::sync::Semaphore;
use uuid::Uuid;
const WIDTH: u32 = 1280;
const HEIGHT: u32 = 720;
const MAX_PNG: usize = 1024 * 1024;
const MAX_MP4: u64 = 8 * 1024 * 1024;
#[derive(Debug)]
struct VideoError(StatusCode, &'static str, String);
type Result<T> = std::result::Result<T, VideoError>;
impl IntoResponse for VideoError {
    fn into_response(self) -> Response {
        (self.0, Json(json!({"code":self.1,"error":self.2}))).into_response()
    }
}
fn err(status: StatusCode, code: &'static str, message: &str) -> VideoError {
    VideoError(status, code, message.into())
}
fn invalid() -> VideoError {
    err(
        StatusCode::BAD_REQUEST,
        "ValidationError",
        "Başlık, 1–4 kısa bölüm, aynı sayıda önizleme karesi, 4–8 saniye ve açık onay gerekli.",
    )
}
fn failed() -> VideoError {
    err(
        StatusCode::INTERNAL_SERVER_ERROR,
        "EncodingError",
        "Video oluşturulamadı; başarı bildirilmedi. Özgün rapor değiştirilmedi.",
    )
}
fn hash(b: &[u8]) -> String {
    format!("{:x}", Sha256::digest(b))
}
#[derive(Clone)]
struct Video {
    token_hash: [u8; 32],
    origin: String,
    host: String,
    enabled: bool,
    gate: Arc<Semaphore>,
}
pub fn router(token: String, origin: String) -> Router {
    Router::new()
        .route("/api/private/video-status", post(status))
        .route("/api/private/video", post(export))
        .layer(DefaultBodyLimit::max(6 * 1024 * 1024))
        .with_state(Video::new(token, origin))
}
impl Video {
    fn new(token: String, origin: String) -> Self {
        let uri = origin.parse::<axum::http::Uri>().ok();
        let host = uri
            .as_ref()
            .and_then(|u| u.authority())
            .map(|v| v.as_str().to_owned())
            .unwrap_or_default();
        let enabled = token.len() >= 32
            && uri.as_ref().is_some_and(|u| {
                matches!(u.scheme_str(), Some("http" | "https"))
                    && u.path() == "/"
                    && u.query().is_none()
            })
            && !host.is_empty()
            && !host.contains('@')
            && !origin.ends_with('/');
        Self {
            token_hash: Sha256::digest(token.as_bytes()).into(),
            origin,
            host,
            enabled,
            gate: Arc::new(Semaphore::new(1)),
        }
    }
    fn authorize(&self, h: &HeaderMap) -> Result<()> {
        if !self.enabled {
            return Err(err(
                StatusCode::SERVICE_UNAVAILABLE,
                "InvalidStateError",
                "Video modülü başlatılamadı.",
            ));
        }
        let given = h
            .get("authorization")
            .and_then(|h| h.to_str().ok())
            .and_then(|s| s.strip_prefix("Bearer "))
            .unwrap_or("");
        let digest: [u8; 32] = Sha256::digest(given.as_bytes()).into();
        if digest
            .iter()
            .zip(self.token_hash.iter())
            .fold(0u8, |acc, (a, b)| acc | (a ^ b))
            != 0
        {
            return Err(err(
                StatusCode::UNAUTHORIZED,
                "SecurityError",
                "Yerel erişim anahtarı geçersiz.",
            ));
        }
        if h.get("host").and_then(|v| v.to_str().ok()) != Some(self.host.as_str())
            || h.get("origin").and_then(|v| v.to_str().ok()) != Some(self.origin.as_str())
            || h.get("sec-fetch-site")
                .and_then(|v| v.to_str().ok())
                .is_some_and(|v| v != "same-origin" && v != "none")
        {
            return Err(err(
                StatusCode::FORBIDDEN,
                "NotAllowedError",
                "Video isteğinin kökeni bu Töre oturumuyla uyuşmuyor.",
            ));
        }
        Ok(())
    }
}
#[derive(Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
struct Source {
    report_id: String,
    sha256: String,
    original_name: String,
}
#[derive(Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
struct Export {
    title: String,
    slides: Vec<String>,
    frames: Vec<String>,
    duration_per_slide: u32,
    confirmed: bool,
    source: Option<Source>,
}
impl Export {
    fn validate(&self) -> Result<()> {
        if !self.confirmed
            || self.title.trim().is_empty()
            || self.title.chars().count() > 160
            || self.slides.is_empty()
            || self.slides.len() > 4
            || self.frames.len() != self.slides.len()
            || !(4..=8).contains(&self.duration_per_slide)
            || self
                .slides
                .iter()
                .any(|s| s.trim().is_empty() || s.chars().count() > 500)
            || self
                .title
                .chars()
                .chain(self.slides.iter().flat_map(|s| s.chars()))
                .any(|c| c.is_control() && !['\n', '\r', '\t'].contains(&c))
        {
            return Err(invalid());
        }
        if let Some(s) = &self.source {
            if Uuid::parse_str(&s.report_id).is_err()
                || s.sha256.len() != 64
                || !s.sha256.bytes().all(|b| b.is_ascii_hexdigit())
                || s.original_name.chars().count() > 255
                || s.original_name.chars().any(char::is_control)
            {
                return Err(invalid());
            }
        }
        Ok(())
    }
}
async fn status(State(s): State<Video>, h: HeaderMap) -> Result<Json<Value>> {
    s.authorize(&h)?;
    let permit = s.gate.clone().try_acquire_owned().map_err(|_| {
        err(
            StatusCode::TOO_MANY_REQUESTS,
            "BusyError",
            "Bir video işlemi sürüyor; bitmesini bekleyin.",
        )
    })?;
    let value=tokio::task::spawn_blocking(move||{let _permit=permit;tools().map(|t|t.description()).unwrap_or_else(|reason|json!({"available":false,"reason":reason,"frameRenderer":"browser-canvas","width":WIDTH,"height":HEIGHT}))}).await.map_err(|_|failed())?;
    Ok(Json(value))
}
async fn export(
    State(s): State<Video>,
    h: HeaderMap,
    body: std::result::Result<Json<Export>, JsonRejection>,
) -> Result<Json<Value>> {
    s.authorize(&h)?;
    let Json(body) = body.map_err(|_| invalid())?;
    body.validate()?;
    let permit = s.gate.clone().try_acquire_owned().map_err(|_| {
        err(
            StatusCode::TOO_MANY_REQUESTS,
            "BusyError",
            "Bir video oluşturuluyor; ikinci işlem başlatılmadı.",
        )
    })?;
    let value = tokio::task::spawn_blocking(move || {
        let _permit = permit;
        render(body)
    })
    .await
    .map_err(|_| failed())??;
    Ok(Json(value))
}
struct Tools {
    ffmpeg: PathBuf,
    ffprobe: PathBuf,
    version: String,
    drawtext: bool,
}
impl Tools {
    fn description(&self) -> Value {
        json!({"available":true,"encoder":"libx264","version":self.version,"drawtextAvailable":self.drawtext,"frameRenderer":"browser-canvas","width":WIDTH,"height":HEIGHT,"maxSlides":4,"maxVideoBytes":MAX_MP4,"audio":false,"licenseNote":"FFmpeg ve libx264 lisansı kullanılan derlemeye bağlıdır; bu Mac derlemesi GPL seçenekleri içerir."})
    }
}
fn program(name: &str) -> Option<PathBuf> {
    let primary = PathBuf::from(format!("/opt/homebrew/bin/{name}"));
    if primary.is_file() {
        return Some(primary);
    }
    std::env::var_os("PATH").and_then(|p| {
        std::env::split_paths(&p)
            .map(|d| d.join(name))
            .find(|p| p.is_file())
    })
}
fn tools() -> std::result::Result<Tools, String> {
    let ffmpeg = program("ffmpeg")
        .ok_or("Bu bilgisayarda FFmpeg bulunamadı; video dışa aktarımı kullanılamıyor.")?;
    let ffprobe = ffmpeg
        .parent()
        .map(|p| p.join("ffprobe"))
        .filter(|p| p.is_file())
        .or_else(|| program("ffprobe"))
        .ok_or("FFprobe bulunamadı; doğrulanmış video üretilemez.")?;
    let dir = Temporary::new().map_err(|_| "Video çalışma klasörü açılamadı.")?;
    let deadline = Instant::now() + Duration::from_secs(10);
    let version = capture(&ffmpeg, &["-version"], &dir.0, "version", deadline)
        .map_err(|_| "FFmpeg çalıştırılamadı.")?;
    let encoders = capture(
        &ffmpeg,
        &["-hide_banner", "-encoders"],
        &dir.0,
        "encoders",
        deadline,
    )
    .map_err(|_| "FFmpeg kodlayıcıları doğrulanamadı.")?;
    if !encoders.contains("libx264") {
        return Err("Bu FFmpeg derlemesinde libx264 yok; video oluşturulmadı.".into());
    }
    let filters = capture(
        &ffmpeg,
        &["-hide_banner", "-filters"],
        &dir.0,
        "filters",
        deadline,
    )
    .map_err(|_| "FFmpeg filtreleri doğrulanamadı.")?;
    capture(&ffprobe, &["-version"], &dir.0, "probe-version", deadline)
        .map_err(|_| "FFprobe çalıştırılamadı.")?;
    Ok(Tools {
        ffmpeg,
        ffprobe,
        version: version
            .lines()
            .next()
            .unwrap_or("FFmpeg")
            .chars()
            .take(200)
            .collect(),
        drawtext: filters.contains("drawtext"),
    })
}
struct Temporary(PathBuf);
impl Temporary {
    fn new() -> std::io::Result<Self> {
        let p = std::env::temp_dir().join(format!("tore-video-{}", Uuid::new_v4()));
        DirBuilder::new().mode(0o700).create(&p)?;
        Ok(Self(p))
    }
}
impl Drop for Temporary {
    fn drop(&mut self) {
        let _ = fs::remove_dir_all(&self.0);
    }
}
fn file(path: &Path, bytes: &[u8]) -> Result<()> {
    let mut f = OpenOptions::new()
        .write(true)
        .create_new(true)
        .mode(0o600)
        .open(path)
        .map_err(|_| failed())?;
    f.write_all(bytes).map_err(|_| failed())?;
    f.sync_all().map_err(|_| failed())
}
fn run(
    command: &Path,
    args: &[&str],
    dir: &Path,
    stdout: &Path,
    stderr: &Path,
    deadline: Instant,
    video: Option<&Path>,
) -> Result<()> {
    let out = OpenOptions::new()
        .write(true)
        .create_new(true)
        .mode(0o600)
        .open(stdout)
        .map_err(|_| failed())?;
    let errors = OpenOptions::new()
        .write(true)
        .create_new(true)
        .mode(0o600)
        .open(stderr)
        .map_err(|_| failed())?;
    let mut child = Command::new(command)
        .args(args)
        .current_dir(dir)
        .stdin(Stdio::null())
        .stdout(out)
        .stderr(errors)
        .spawn()
        .map_err(|_| failed())?;
    loop {
        if Instant::now() > deadline
            || video.is_some_and(|p| fs::metadata(p).is_ok_and(|m| m.len() > MAX_MP4))
            || fs::metadata(stderr).is_ok_and(|m| m.len() > 1024 * 1024)
        {
            let _ = child.kill();
            let _ = child.wait();
            return Err(err(
                StatusCode::REQUEST_TIMEOUT,
                "TimeoutError",
                "Video süresi veya boyut sınırı aşıldı; çıktı teslim edilmedi.",
            ));
        }
        match child.try_wait() {
            Ok(Some(status)) => {
                return if status.success() {
                    Ok(())
                } else {
                    Err(failed())
                };
            }
            Ok(None) => std::thread::sleep(Duration::from_millis(30)),
            Err(_) => {
                let _ = child.kill();
                let _ = child.wait();
                return Err(failed());
            }
        }
    }
}
fn capture(
    command: &Path,
    args: &[&str],
    dir: &Path,
    name: &str,
    deadline: Instant,
) -> Result<String> {
    let out = dir.join(format!("{name}.out"));
    run(
        command,
        args,
        dir,
        &out,
        &dir.join(format!("{name}.err")),
        deadline,
        None,
    )?;
    let b = fs::read(out).map_err(|_| failed())?;
    if b.len() > 256 * 1024 {
        return Err(failed());
    }
    String::from_utf8(b).map_err(|_| failed())
}
fn png(b: &[u8]) -> bool {
    if b.len() < 45
        || b.len() > MAX_PNG
        || &b[..8] != b"\x89PNG\r\n\x1a\n"
        || &b[12..16] != b"IHDR"
        || u32::from_be_bytes(b[8..12].try_into().unwrap()) != 13
        || u32::from_be_bytes(b[16..20].try_into().unwrap()) != WIDTH
        || u32::from_be_bytes(b[20..24].try_into().unwrap()) != HEIGHT
        || b[24] != 8
        || ![2, 6].contains(&b[25])
    {
        return false;
    }
    let mut pos = 8;
    let mut count = 0;
    while pos + 12 <= b.len() {
        let len = u32::from_be_bytes(b[pos..pos + 4].try_into().unwrap()) as usize;
        let Some(end) = pos.checked_add(len).and_then(|v| v.checked_add(12)) else {
            return false;
        };
        if end > b.len() {
            return false;
        }
        let kind = &b[pos + 4..pos + 8];
        if kind == b"acTL" {
            return false;
        }
        if kind == b"IEND" {
            return len == 0 && end == b.len();
        }
        pos = end;
        count += 1;
        if count > 10_000 {
            return false;
        }
    }
    false
}
fn html_escape(s: &str) -> String {
    s.replace('&', "&amp;")
        .replace('<', "&lt;")
        .replace('>', "&gt;")
        .replace('"', "&quot;")
        .replace('\'', "&#39;")
}
fn composition(title: &str, frames: &[String], duration: u32) -> String {
    let total = frames.len() as u32 * duration;
    let clips=frames.iter().enumerate().map(|(i,b)|format!("<section class=\"clip\" data-start=\"{}\" data-duration=\"{duration}\" data-track-index=\"0\"><img id=\"frame-{i}\" src=\"data:image/png;base64,{b}\" width=\"1280\" height=\"720\" alt=\"Kare {}\"></section>",i as u32*duration,i+1)).collect::<String>();
    format!(
        r#"<!doctype html><html lang="tr"><head><meta charset="utf-8"><meta name="viewport" content="width=1280,height=720"><meta name="referrer" content="no-referrer"><meta http-equiv="Content-Security-Policy" content="default-src 'none'; img-src data:; script-src 'unsafe-inline'; style-src 'unsafe-inline'; connect-src 'none'; object-src 'none'; base-uri 'none'"><title>{}</title><style>html,body{{margin:0;width:100%;height:100%;background:#172226}}#root{{position:relative;width:100%;height:100%;overflow:hidden}}.clip{{position:absolute;inset:0}}img{{display:block;width:100%;height:100%;object-fit:contain}}</style></head><body><div id="root" data-composition-id="tore-report" data-start="0" data-width="1280" data-height="720" data-duration="{total}">{clips}</div><script>const total={total},seconds={duration};const animations=[...document.querySelectorAll('.clip img')].map((img,i)=>{{const start=i*seconds/total,end=(i+1)*seconds/total;const a=img.animate([{{opacity:0,offset:0}},{{opacity:0,offset:start}},{{opacity:1,offset:start}},{{opacity:1,offset:end}},{{opacity:0,offset:end}},{{opacity:0,offset:1}}],{{duration:total*1000,iterations:1,fill:'both'}});a.pause();a.currentTime=0;return a;}});</script></body></html>"#,
        html_escape(title)
    )
}
fn filename(title: &str) -> String {
    let s: String = title
        .chars()
        .filter(|c| !c.is_control())
        .map(|c| if "/\\:*?\"<>|".contains(c) { '_' } else { c })
        .take(80)
        .collect();
    let s = s.trim().trim_matches('.');
    format!("{}.mp4", if s.is_empty() { "Töre raporu" } else { s })
}
fn render(body: Export) -> Result<Value> {
    body.validate()?;
    let deadline = Instant::now() + Duration::from_secs(60);
    let tools =
        tools().map_err(|s| err(StatusCode::SERVICE_UNAVAILABLE, "NotSupportedError", &s))?;
    let dir = Temporary::new().map_err(|_| failed())?;
    let mut manifest = Vec::new();
    for (i, data) in body.frames.iter().enumerate() {
        if data.len() > MAX_PNG.div_ceil(3) * 4 {
            return Err(invalid());
        }
        let bytes = STANDARD.decode(data).map_err(|_| invalid())?;
        if !png(&bytes) {
            return Err(err(
                StatusCode::BAD_REQUEST,
                "DataError",
                "Önizleme kareleri geçerli, tek kareli 1280×720 PNG olmalı.",
            ));
        }
        file(&dir.0.join(format!("frame-{i:02}.png")), &bytes)?;
        manifest.push(json!({"index":i,"sha256":hash(&bytes),"width":WIDTH,"height":HEIGHT}));
    }
    let fps = format!("1/{}", body.duration_per_slide);
    let total = body.duration_per_slide * body.slides.len() as u32;
    let duration = total.to_string();
    let output = dir.0.join("report.mp4");
    file(&output, &[])?;
    run(
        &tools.ffmpeg,
        &[
            "-hide_banner",
            "-loglevel",
            "error",
            "-nostdin",
            "-y",
            "-framerate",
            &fps,
            "-start_number",
            "0",
            "-i",
            "frame-%02d.png",
            "-t",
            &duration,
            "-r",
            "24",
            "-c:v",
            "libx264",
            "-preset",
            "ultrafast",
            "-crf",
            "23",
            "-pix_fmt",
            "yuv420p",
            "-movflags",
            "+faststart",
            "-an",
            "report.mp4",
        ],
        &dir.0,
        &dir.0.join("encode.out"),
        &dir.0.join("encode.err"),
        deadline,
        Some(&output),
    )?;
    let info = capture(
        &tools.ffprobe,
        &[
            "-v",
            "error",
            "-select_streams",
            "v:0",
            "-show_entries",
            "stream=codec_name,width,height,nb_frames",
            "-show_entries",
            "format=duration,format_name",
            "-of",
            "json",
            "report.mp4",
        ],
        &dir.0,
        "probe",
        deadline,
    )?;
    let info: Value = serde_json::from_str(&info).map_err(|_| failed())?;
    let stream = &info["streams"][0];
    let measured = info["format"]["duration"]
        .as_str()
        .and_then(|s| s.parse::<f64>().ok())
        .unwrap_or(0.0);
    if stream["codec_name"] != "h264"
        || stream["width"] != WIDTH
        || stream["height"] != HEIGHT
        || (measured - total as f64).abs() > 0.3
    {
        return Err(failed());
    }
    let bytes = fs::read(&output).map_err(|_| failed())?;
    if bytes.is_empty() || bytes.len() as u64 > MAX_MP4 {
        return Err(failed());
    }
    let source=body.source.as_ref().map(|s|json!({"reportId":s.report_id,"sha256":s.sha256,"originalName":s.original_name,"providedBy":"local-client"}));
    let source_manifest = json!({"format":"tore-report-video","version":1,"title":body.title,"slides":body.slides,"source":source,"frames":manifest,"durationPerSlide":body.duration_per_slide,"duration":total,"renderer":"browser-canvas+ffmpeg","selection":"user-selected exact excerpts; source reference supplied by local client","audio":false});
    Ok(
        json!({"filename":filename(&body.title),"mimeType":"video/mp4","videoBase64":STANDARD.encode(&bytes),"sha256":hash(&bytes),"compositionHTML":composition(&body.title,&body.frames,body.duration_per_slide),"sourceManifest":source_manifest,"verification":info}),
    )
}

#[cfg(test)]
mod tests {
    use super::*;
    const TOKEN: &str = "synthetic-video-token-only-for-tests-0001";
    const ORIGIN: &str = "http://127.0.0.1:4321";
    #[test]
    fn validation_paths_and_confirm_are_not_executable_inputs() {
        let mut b = Export {
            title: "Türkçe / test".into(),
            slides: vec!["Özgürlük, düşünce ve ölçülü kesinlik.".into()],
            frames: vec!["invalid".into()],
            duration_per_slide: 4,
            confirmed: false,
            source: None,
        };
        assert!(b.validate().is_err());
        b.confirmed = true;
        assert!(b.validate().is_ok());
        assert_eq!(filename("Türkçe / test"), "Türkçe _ test.mp4");
        assert!(!png(b"not PNG"));
        let html = composition(
            "</title><script>bad()</script>",
            &[STANDARD.encode(b"placeholder")],
            4,
        );
        assert!(!html.contains("<script>bad()"));
        assert!(html.contains("data-composition-id=\"tore-report\""));
        assert!(!html.contains("requestAnimationFrame"));
        assert!(html.contains("a.pause()"));
    }
    #[tokio::test]
    async fn http_requires_token_origin_and_explicit_confirmation() {
        use axum::{body::Body, http::Request};
        use tower::ServiceExt;
        let app = router(TOKEN.into(), ORIGIN.into());
        let r = app
            .clone()
            .oneshot(
                Request::post("/api/private/video-status")
                    .body(Body::empty())
                    .unwrap(),
            )
            .await
            .unwrap();
        assert_eq!(r.status(), StatusCode::UNAUTHORIZED);
        let r=app.oneshot(Request::post("/api/private/video").header("authorization",format!("Bearer {TOKEN}")).header("origin",ORIGIN).header("host","127.0.0.1:4321").header("content-type","application/json").body(Body::from(r#"{"title":"x","slides":["x"],"frames":["x"],"durationPerSlide":4,"confirmed":false}"#)).unwrap()).await.unwrap();
        assert_eq!(r.status(), StatusCode::BAD_REQUEST);
    }
    #[test]
    fn temporary_permissions_and_cleanup() {
        use std::os::unix::fs::PermissionsExt;
        let p;
        {
            let t = Temporary::new().unwrap();
            p = t.0.clone();
            file(&p.join("synthetic.txt"), "Türkçe sentetik test".as_bytes()).unwrap();
            assert_eq!(
                fs::metadata(&p).unwrap().permissions().mode() & 0o777,
                0o700
            );
            assert_eq!(
                fs::metadata(p.join("synthetic.txt"))
                    .unwrap()
                    .permissions()
                    .mode()
                    & 0o777,
                0o600
            );
        }
        assert!(!p.exists());
    }
    #[test]
    #[ignore = "Explicit installed FFmpeg + synthetic PNG native integration; no archive access"]
    fn native_mp4_synthetic() {
        let tools = tools().unwrap();
        let t = Temporary::new().unwrap();
        run(
            &tools.ffmpeg,
            &[
                "-v",
                "error",
                "-f",
                "lavfi",
                "-i",
                "color=c=0x172226:s=1280x720",
                "-frames:v",
                "1",
                "frame.png",
            ],
            &t.0,
            &t.0.join("o"),
            &t.0.join("e"),
            Instant::now() + Duration::from_secs(10),
            None,
        )
        .unwrap();
        let frame = fs::read(t.0.join("frame.png")).unwrap();
        assert!(png(&frame));
        let output = render(Export {
            title: "Türkçe sentetik test".into(),
            slides: vec!["Özgürlük, düşünce, ölçüm.".into()],
            frames: vec![STANDARD.encode(frame)],
            duration_per_slide: 4,
            confirmed: true,
            source: None,
        })
        .unwrap();
        assert!(!output["videoBase64"].as_str().unwrap().is_empty());
        assert_eq!(output["verification"]["streams"][0]["codec_name"], "h264");
        println!(
            "Synthetic MP4 verified: 1280x720, {} seconds; color frame only, Turkish text is manifest data in this native fixture",
            output["verification"]["format"]["duration"]
        );
    }
}
