//! Loopback-only archive bridge. Its caller controls enabling and serving this router.
//! No archive schema is parsed or rewritten here; bytes stay bytes.
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
    ffi::{CStr, CString},
    fs::{File, OpenOptions},
    io::{self, Read, Write},
    os::{
        fd::{AsRawFd, FromRawFd, IntoRawFd, RawFd},
        unix::fs::OpenOptionsExt,
    },
    path::PathBuf,
    sync::{Arc, Mutex},
};
use uuid::Uuid;

const MAX_FILE: usize = 16 * 1024 * 1024;
const MAX_REQUEST: usize = 24 * 1024 * 1024;
const JSON_STEMS: &[&str] = &[
    "arsiv",
    "profiller",
    "karsilastirmalar",
    "kaynaklar",
    "taslaklar",
    "temsilciler",
    "okuma",
    "degisimler",
];

#[derive(Debug)]
struct FsError {
    status: StatusCode,
    code: &'static str,
    message: String,
    disk_failure: bool,
}
type Result<T> = std::result::Result<T, FsError>;
impl IntoResponse for FsError {
    fn into_response(self) -> Response {
        (
            self.status,
            Json(json!({"code":self.code,"error":self.message})),
        )
            .into_response()
    }
}
fn error(status: StatusCode, code: &'static str, message: impl Into<String>) -> FsError {
    FsError {
        status,
        code,
        message: message.into(),
        disk_failure: false,
    }
}
fn invalid(message: &str) -> FsError {
    error(StatusCode::BAD_REQUEST, "ValidationError", message)
}
fn denied(message: &str) -> FsError {
    error(StatusCode::FORBIDDEN, "NotAllowedError", message)
}
fn stale() -> FsError {
    error(
        StatusCode::CONFLICT,
        "InvalidModificationError",
        "Dosya başka bir işlemle değişti veya beklenen içerik özeti verilmedi. Üzerine yazılmadı; arşivi yeniden açın.",
    )
}
fn unavailable() -> FsError {
    error(
        StatusCode::SERVICE_UNAVAILABLE,
        "InvalidStateError",
        "Yerel arşiv köprüsü güvenli yazma durumunda değil. Başarı bildirilmedi; sorunu giderip Töre'yi yeniden başlatın.",
    )
}
fn io_error(e: io::Error) -> FsError {
    let mut out = match e.raw_os_error() {
        Some(libc::ENOENT) => error(
            StatusCode::NOT_FOUND,
            "NotFoundError",
            "İstenen arşiv dosyası veya klasörü bulunamadı.",
        ),
        Some(libc::ELOOP) => {
            denied("Sembolik bağlantı izlenmedi. Arşivde normal dosya ve klasör kullanın.")
        }
        Some(libc::ENOTDIR) => error(
            StatusCode::BAD_REQUEST,
            "TypeMismatchError",
            "İstenen yol bir klasör değil veya sembolik bağlantı içeriyor.",
        ),
        Some(libc::EACCES | libc::EPERM) => {
            denied("Arşiv klasörüne erişim izni yok. İşlem başarılı sayılmadı.")
        }
        Some(libc::EEXIST) => stale(),
        _ => error(
            StatusCode::INTERNAL_SERVER_ERROR,
            "UnknownError",
            format!(
                "Disk işlemi tamamlanamadı; başarı bildirilmedi ({}).",
                e.kind()
            ),
        ),
    };
    // Missing paths and a create-only collision are normal control flow, not uncertain disk writes.
    out.disk_failure = !matches!(e.raw_os_error(), Some(libc::ENOENT | libc::EEXIST));
    out
}
fn hash(bytes: &[u8]) -> String {
    format!("{:x}", Sha256::digest(bytes))
}

#[derive(Clone)]
struct PrivateFs {
    disk: Arc<Mutex<Disk>>,
    token_hash: [u8; 32],
    enabled: bool,
    origin: String,
    host: String,
}
struct Disk {
    root: Option<File>,
    healthy: bool,
    #[cfg(test)]
    fault: Option<&'static str>,
}

/// POST /api/private/fs; no CORS, cookies, arbitrary paths, delete, or archive discovery.
/// Configure only on a loopback listener; `origin` must be its exact scheme://host:port.
/// Existing writes require expectedSha256; omitted/null means create-only for absent files.
/// JSON errors carry a DOMException-compatible `code` and Turkish `error` text.
pub fn router(root: PathBuf, token: String, origin: String) -> Router {
    Router::new()
        .route("/api/private/fs", post(endpoint))
        .layer(DefaultBodyLimit::max(MAX_REQUEST))
        .with_state(PrivateFs::new(root, token, origin))
}
impl PrivateFs {
    fn new(root: PathBuf, token: String, origin: String) -> Self {
        let parsed = origin.parse::<axum::http::Uri>().ok();
        let host = parsed
            .as_ref()
            .and_then(|u| u.authority())
            .map(|a| a.as_str().to_owned())
            .unwrap_or_default();
        let valid_origin = parsed.as_ref().is_some_and(|u| {
            matches!(u.scheme_str(), Some("http" | "https"))
                && u.authority().is_some()
                && u.path() == "/"
                && u.query().is_none()
                && !host.contains('@')
                && !origin.ends_with('/')
        });
        let root = OpenOptions::new()
            .read(true)
            .custom_flags(libc::O_DIRECTORY | libc::O_NOFOLLOW | libc::O_CLOEXEC)
            .open(root)
            .ok();
        let healthy = root.is_some();
        Self {
            disk: Arc::new(Mutex::new(Disk {
                root,
                healthy,
                #[cfg(test)]
                fault: None,
            })),
            token_hash: Sha256::digest(token.as_bytes()).into(),
            enabled: valid_origin && token.len() >= 32,
            origin,
            host,
        }
    }
    fn authorize(&self, headers: &HeaderMap) -> Result<()> {
        if !self.enabled {
            return Err(unavailable());
        }
        let given = headers
            .get("authorization")
            .and_then(|h| h.to_str().ok())
            .and_then(|s| s.strip_prefix("Bearer "))
            .unwrap_or("");
        let actual: [u8; 32] = Sha256::digest(given.as_bytes()).into();
        let mismatch = actual
            .iter()
            .zip(self.token_hash.iter())
            .fold(0u8, |v, (a, b)| v | (a ^ b));
        if mismatch != 0 {
            return Err(error(
                StatusCode::UNAUTHORIZED,
                "SecurityError",
                "Yerel arşiv erişim anahtarı geçersiz.",
            ));
        }
        if headers.get("host").and_then(|h| h.to_str().ok()) != Some(self.host.as_str())
            || headers.get("origin").and_then(|h| h.to_str().ok()) != Some(self.origin.as_str())
        {
            return Err(denied(
                "Arşiv isteğinin Host veya Origin adresi bu Töre oturumuyla uyuşmuyor.",
            ));
        }
        if headers
            .get("sec-fetch-site")
            .and_then(|h| h.to_str().ok())
            .is_some_and(|v| v != "same-origin" && v != "none")
        {
            return Err(denied(
                "Başka bir siteden yerel arşiv erişimi kabul edilmiyor.",
            ));
        }
        Ok(())
    }
    fn execute(&self, request: Request) -> Result<Value> {
        let path = AllowedPath::parse(&request.path)?;
        request.validate()?;
        let mut disk = self.disk.lock().map_err(|_| unavailable())?;
        if !disk.healthy {
            return Err(unavailable());
        }
        #[cfg(test)]
        let fault = disk.fault.take();
        #[cfg(not(test))]
        let fault = None;
        let root = disk.root.as_ref().ok_or_else(unavailable)?;
        let result = perform(root, path, &request, fault);
        if matches!(
            request.op,
            Operation::Write | Operation::Touch | Operation::Mkdir
        ) && result.as_ref().is_err_and(|e| e.disk_failure)
        {
            disk.healthy = false;
        }
        result
    }
}
async fn endpoint(
    State(state): State<PrivateFs>,
    headers: HeaderMap,
    request: std::result::Result<Json<Request>, JsonRejection>,
) -> Result<Json<Value>> {
    state.authorize(&headers)?;
    let Json(request) = request.map_err(|e| {
        if e.status() == StatusCode::PAYLOAD_TOO_LARGE {
            error(
                StatusCode::PAYLOAD_TOO_LARGE,
                "QuotaExceededError",
                "İstek 24 MiB sınırını aşıyor.",
            )
        } else {
            invalid("Dosya isteği geçerli JSON ve desteklenen alanlardan oluşmalı.")
        }
    })?;
    let value = tokio::task::spawn_blocking(move || state.execute(request))
        .await
        .map_err(|_| unavailable())??;
    Ok(Json(value))
}

#[derive(Deserialize, Copy, Clone)]
#[serde(rename_all = "lowercase")]
enum Operation {
    Read,
    Write,
    List,
    Mkdir,
    Touch,
}
#[derive(Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
struct Request {
    op: Operation,
    path: String,
    data: Option<String>,
    expected_sha256: Option<String>,
}
impl Request {
    fn validate(&self) -> Result<()> {
        if !matches!(self.op, Operation::Write) && self.data.is_some() {
            return Err(invalid("data yalnız write işleminde kullanılabilir."));
        }
        if !matches!(self.op, Operation::Write | Operation::Touch) && self.expected_sha256.is_some()
        {
            return Err(invalid("İçerik özeti bu işlemde kullanılmaz."));
        }
        if let Some(s) = &self.expected_sha256 {
            if s.len() != 64
                || !s
                    .bytes()
                    .all(|b| b.is_ascii_digit() || (b'a'..=b'f').contains(&b))
            {
                return Err(invalid(
                    "expectedSha256 küçük harfli 64 haneli SHA-256 olmalı.",
                ));
            }
        }
        if matches!(self.op, Operation::Write) && self.data.is_none() {
            return Err(invalid("write için Base64 data gerekli."));
        }
        Ok(())
    }
}
#[derive(Debug, PartialEq)]
enum AllowedPath<'a> {
    Root,
    Reports,
    RootFile(&'a str),
    Report(&'a str),
}
fn strict_uuid(s: &str) -> bool {
    Uuid::parse_str(s).is_ok_and(|u| u.hyphenated().to_string() == s)
}
fn timestamp(s: &str) -> bool {
    let b = s.as_bytes();
    if b.len() != 24 {
        return false;
    }
    let separators = [
        (4, b'-'),
        (7, b'-'),
        (10, b'T'),
        (13, b'-'),
        (16, b'-'),
        (19, b'-'),
        (23, b'Z'),
    ];
    if !b.iter().enumerate().all(|(i, c)| {
        separators
            .iter()
            .find(|(p, _)| *p == i)
            .map_or(c.is_ascii_digit(), |(_, v)| c == v)
    }) {
        return false;
    }
    let num = |a, b| s[a..b].parse::<u32>().ok();
    chrono::NaiveDate::from_ymd_opt(
        num(0, 4).unwrap_or(0) as i32,
        num(5, 7).unwrap_or(0),
        num(8, 10).unwrap_or(0),
    )
    .is_some()
        && chrono::NaiveTime::from_hms_milli_opt(
            num(11, 13).unwrap_or(99),
            num(14, 16).unwrap_or(99),
            num(17, 19).unwrap_or(99),
            num(20, 23).unwrap_or(1000),
        )
        .is_some()
}
fn root_filename(s: &str) -> bool {
    JSON_STEMS.iter().any(|stem| {
        s == format!("{stem}.json")
            || s == format!("{stem}.onceki.json")
            || s.strip_prefix(&format!("{stem}.bozuk-"))
                .and_then(|v| v.strip_suffix(".json"))
                .is_some_and(|v| {
                    v.is_ascii()
                        && (strict_uuid(v)
                            || timestamp(v)
                            || (v.len() == 61
                                && timestamp(&v[..24])
                                && &v[24..25] == "-"
                                && strict_uuid(&v[25..])))
                })
    })
}
impl<'a> AllowedPath<'a> {
    fn parse(path: &'a str) -> Result<Self> {
        if path.len() > 180 {
            return Err(denied("Arşiv yolu izin verilen uzunluğu aşıyor."));
        }
        if path.is_empty() {
            return Ok(Self::Root);
        }
        if path == "raporlar" {
            return Ok(Self::Reports);
        }
        if path.bytes().any(|c| c == 0 || c == b'\\') {
            return Err(denied("Arşiv yolu izinli değil."));
        }
        if let Some(s) = path.strip_prefix("raporlar/") {
            if s.strip_suffix(".md").is_some_and(strict_uuid) {
                return Ok(Self::Report(s));
            }
        } else if root_filename(path) {
            return Ok(Self::RootFile(path));
        }
        Err(denied(
            "Yalnız Töre'nin belirlenmiş arşiv dosya adlarına erişilebilir.",
        ))
    }
}
fn cstring(s: &str) -> Result<CString> {
    CString::new(s).map_err(|_| invalid("Dosya adı geçersiz."))
}
fn open_at(dir: RawFd, name: &str, flags: i32, mode: libc::mode_t) -> Result<File> {
    let name = cstring(name)?;
    // Every request pathname is a single allowlisted component, relative to an open directory.
    let fd = unsafe {
        libc::openat(
            dir,
            name.as_ptr(),
            flags | libc::O_NOFOLLOW | libc::O_CLOEXEC,
            mode as libc::c_uint,
        )
    };
    if fd < 0 {
        Err(io_error(io::Error::last_os_error()))
    } else {
        Ok(unsafe { File::from_raw_fd(fd) })
    }
}
fn report_dir(root: &File) -> Result<File> {
    open_at(
        root.as_raw_fd(),
        "raporlar",
        libc::O_RDONLY | libc::O_DIRECTORY,
        0,
    )
}
fn read_file(dir: &File, name: &str) -> Result<Option<Vec<u8>>> {
    let f = match open_at(dir.as_raw_fd(), name, libc::O_RDONLY | libc::O_NONBLOCK, 0) {
        Ok(f) => f,
        Err(e) if e.code == "NotFoundError" => return Ok(None),
        Err(e) => return Err(e),
    };
    let metadata = f.metadata().map_err(io_error)?;
    if !metadata.is_file() {
        return Err(error(
            StatusCode::BAD_REQUEST,
            "TypeMismatchError",
            "İstenen kayıt normal bir dosya değil.",
        ));
    }
    if metadata.len() > MAX_FILE as u64 {
        return Err(error(
            StatusCode::PAYLOAD_TOO_LARGE,
            "QuotaExceededError",
            "Dosya 16 MiB sınırını aşıyor.",
        ));
    }
    let mut out = Vec::with_capacity(metadata.len() as usize);
    f.take(MAX_FILE as u64 + 1)
        .read_to_end(&mut out)
        .map_err(io_error)?;
    if out.len() > MAX_FILE {
        return Err(error(
            StatusCode::PAYLOAD_TOO_LARGE,
            "QuotaExceededError",
            "Dosya 16 MiB sınırını aşıyor.",
        ));
    }
    Ok(Some(out))
}
fn metadata(bytes: &[u8], created: bool) -> Value {
    json!({"sha256":hash(bytes),"size":bytes.len(),"created":created})
}
fn baseline(bytes: Option<&[u8]>, expected: Option<&str>) -> Result<()> {
    match (bytes, expected) {
        (None, None) => Ok(()),
        (Some(b), Some(h)) if hash(b) == h => Ok(()),
        _ => Err(stale()),
    }
}
fn unlink(dir: &File, name: &str) {
    if let Ok(name) = CString::new(name) {
        unsafe {
            libc::unlinkat(dir.as_raw_fd(), name.as_ptr(), 0);
        }
    }
}
fn unlink_checked(dir: &File, name: &str) -> Result<()> {
    let name = cstring(name)?;
    if unsafe { libc::unlinkat(dir.as_raw_fd(), name.as_ptr(), 0) } != 0 {
        return Err(io_error(io::Error::last_os_error()));
    }
    Ok(())
}
fn injected_failure() -> FsError {
    io_error(io::Error::other("sentetik disk hatası"))
}
fn atomic_write(
    dir: &File,
    name: &str,
    bytes: &[u8],
    expected: Option<&str>,
    fault: Option<&str>,
) -> Result<bool> {
    let old = read_file(dir, name)?;
    baseline(old.as_deref(), expected)?;
    let created = old.is_none();
    let temporary = format!(".tore-private-write-{}.tmp", Uuid::new_v4());
    let result = (|| {
        let mut f = open_at(
            dir.as_raw_fd(),
            &temporary,
            libc::O_WRONLY | libc::O_CREAT | libc::O_EXCL,
            0o600,
        )?;
        f.write_all(bytes).map_err(io_error)?;
        f.sync_all().map_err(io_error)?;
        if fault == Some("before-commit") {
            return Err(injected_failure());
        }
        // Recheck after the temporary file is durable, immediately before commit.
        baseline(read_file(dir, name)?.as_deref(), expected)?;
        let a = cstring(&temporary)?;
        let b = cstring(name)?;
        let rc = if created {
            // linkat is atomic create-only, including races with another local writer.
            unsafe { libc::linkat(dir.as_raw_fd(), a.as_ptr(), dir.as_raw_fd(), b.as_ptr(), 0) }
        } else {
            unsafe { libc::renameat(dir.as_raw_fd(), a.as_ptr(), dir.as_raw_fd(), b.as_ptr()) }
        };
        if rc != 0 {
            return Err(io_error(io::Error::last_os_error()));
        }
        if fault == Some("after-commit") {
            return Err(injected_failure());
        }
        if created {
            unlink_checked(dir, &temporary)?;
        }
        dir.sync_all().map_err(io_error)?;
        if read_file(dir, name)?.as_deref() != Some(bytes) {
            return Err(injected_failure());
        }
        Ok(created)
    })();
    unlink(dir, &temporary);
    result
}
fn list(dir: &File) -> Result<Value> {
    // dup would share the persistent directory seek position and make later lists empty.
    let fd = open_at(dir.as_raw_fd(), ".", libc::O_RDONLY | libc::O_DIRECTORY, 0)?.into_raw_fd();
    let stream = unsafe { libc::fdopendir(fd) };
    if stream.is_null() {
        unsafe {
            libc::close(fd);
        }
        return Err(io_error(io::Error::last_os_error()));
    }
    struct Dir(*mut libc::DIR);
    impl Drop for Dir {
        fn drop(&mut self) {
            unsafe {
                libc::closedir(self.0);
            }
        }
    }
    let stream = Dir(stream);
    let mut entries = Vec::new();
    loop {
        set_errno_zero();
        let entry = unsafe { libc::readdir(stream.0) };
        if entry.is_null() {
            let e = io::Error::last_os_error();
            if e.raw_os_error() != Some(0) {
                return Err(io_error(e));
            }
            break;
        }
        let name = unsafe { CStr::from_ptr((*entry).d_name.as_ptr()) }
            .to_str()
            .map_err(|_| {
                denied("Arşivde UTF-8 olmayan bir dosya adı var; otomatik işlem yapılmadı.")
            })?;
        if name == "." || name == ".." {
            continue;
        }
        let c = cstring(name)?;
        let mut stat = unsafe { std::mem::zeroed::<libc::stat>() };
        if unsafe {
            libc::fstatat(
                dir.as_raw_fd(),
                c.as_ptr(),
                &mut stat,
                libc::AT_SYMLINK_NOFOLLOW,
            )
        } != 0
        {
            return Err(io_error(io::Error::last_os_error()));
        }
        let kind = match stat.st_mode & libc::S_IFMT {
            libc::S_IFREG => "file",
            libc::S_IFDIR => "directory",
            _ => {
                return Err(denied(
                    "Arşivde sembolik bağlantı veya desteklenmeyen özel dosya var; izlenmedi.",
                ));
            }
        };
        // Unknown names remain visible so the legacy archive can refuse a nonempty foreign folder.
        entries.push(json!({"name":name,"kind":kind}));
    }
    entries.sort_by(|a, b| a["name"].as_str().cmp(&b["name"].as_str()));
    Ok(json!({"entries":entries}))
}
#[cfg(any(target_os = "macos", target_os = "ios"))]
fn set_errno_zero() {
    unsafe {
        *libc::__error() = 0;
    }
}
#[cfg(any(target_os = "linux", target_os = "android"))]
fn set_errno_zero() {
    unsafe {
        *libc::__errno_location() = 0;
    }
}

fn perform(
    root: &File,
    path: AllowedPath<'_>,
    request: &Request,
    fault: Option<&str>,
) -> Result<Value> {
    if matches!(request.op, Operation::Mkdir) {
        if path != AllowedPath::Reports {
            return Err(denied("Yalnız raporlar klasörü oluşturulabilir."));
        }
        let name = cstring("raporlar")?;
        let rc = unsafe { libc::mkdirat(root.as_raw_fd(), name.as_ptr(), 0o700) };
        let created = rc == 0;
        if !created && io::Error::last_os_error().raw_os_error() != Some(libc::EEXIST) {
            return Err(io_error(io::Error::last_os_error()));
        }
        let _verified = report_dir(root)?;
        if created {
            root.sync_all().map_err(io_error)?;
        }
        return Ok(json!({"created":created}));
    }
    if matches!(request.op, Operation::List) {
        return match path {
            AllowedPath::Root => list(root),
            AllowedPath::Reports => list(&report_dir(root)?),
            _ => Err(error(
                StatusCode::BAD_REQUEST,
                "TypeMismatchError",
                "Listeleme için klasör yolu gerekli.",
            )),
        };
    }
    let reports;
    let (dir, name) = match path {
        AllowedPath::RootFile(n) => (root, n),
        AllowedPath::Report(n) => {
            reports = report_dir(root)?;
            (&reports, n)
        }
        _ => {
            return Err(error(
                StatusCode::BAD_REQUEST,
                "TypeMismatchError",
                "Bu işlem için dosya yolu gerekli.",
            ));
        }
    };
    match request.op {
        Operation::Read => {
            let bytes = read_file(dir, name)?.ok_or_else(|| {
                error(
                    StatusCode::NOT_FOUND,
                    "NotFoundError",
                    "İstenen arşiv dosyası bulunamadı.",
                )
            })?;
            Ok(json!({"bytes":STANDARD.encode(&bytes),"sha256":hash(&bytes),"size":bytes.len()}))
        }
        Operation::Touch => {
            if let Some(bytes) = read_file(dir, name)? {
                if request
                    .expected_sha256
                    .as_ref()
                    .is_some_and(|expected| hash(&bytes) != *expected)
                {
                    return Err(stale());
                }
                return Ok(metadata(&bytes, false));
            }
            let created = atomic_write(dir, name, &[], request.expected_sha256.as_deref(), fault)?;
            Ok(metadata(&[], created))
        }
        Operation::Write => {
            let data = request
                .data
                .as_deref()
                .ok_or_else(|| invalid("write için data gerekli."))?;
            if data.len() > MAX_FILE.div_ceil(3) * 4 {
                return Err(error(
                    StatusCode::PAYLOAD_TOO_LARGE,
                    "QuotaExceededError",
                    "Dosya 16 MiB sınırını aşıyor.",
                ));
            }
            let bytes = STANDARD
                .decode(data)
                .map_err(|_| invalid("data standart ve geçerli Base64 olmalı."))?;
            if bytes.len() > MAX_FILE {
                return Err(error(
                    StatusCode::PAYLOAD_TOO_LARGE,
                    "QuotaExceededError",
                    "Dosya 16 MiB sınırını aşıyor.",
                ));
            }
            let created =
                atomic_write(dir, name, &bytes, request.expected_sha256.as_deref(), fault)?;
            Ok(metadata(&bytes, created))
        }
        _ => Err(invalid("Desteklenmeyen işlem.")),
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::{
        fs,
        os::unix::fs::{PermissionsExt, symlink},
    };
    const TOKEN: &str = "synthetic-private-token-only-for-tests-0001";
    const ORIGIN: &str = "http://127.0.0.1:4317";
    struct Fixture {
        dir: PathBuf,
        state: PrivateFs,
    }
    impl Fixture {
        fn new() -> Self {
            let dir = std::env::temp_dir().join(format!("tore-private-fs-test-{}", Uuid::new_v4()));
            fs::create_dir(&dir).unwrap();
            let state = PrivateFs::new(dir.clone(), TOKEN.into(), ORIGIN.into());
            Self { dir, state }
        }
        fn run(&self, value: Value) -> Result<Value> {
            self.state.execute(serde_json::from_value(value).unwrap())
        }
        fn write(&self, path: &str, bytes: &[u8], expected: Option<&str>) -> Result<Value> {
            self.run(json!({"op":"write","path":path,"data":STANDARD.encode(bytes),"expectedSha256":expected}))
        }
    }
    impl Drop for Fixture {
        fn drop(&mut self) {
            let _ = fs::remove_dir_all(&self.dir);
        }
    }
    fn headers() -> HeaderMap {
        let mut h = HeaderMap::new();
        h.insert("authorization", format!("Bearer {TOKEN}").parse().unwrap());
        h.insert("host", "127.0.0.1:4317".parse().unwrap());
        h.insert("origin", ORIGIN.parse().unwrap());
        h
    }
    #[test]
    fn path_allowlist_rejects_traversal_unicode_panics_and_nonarchive_names() {
        for s in [
            "../arsiv.json",
            "/arsiv.json",
            "raporlar/../arsiv.json",
            "raporlar/a.md",
            "arsiv.json/child",
            "a\\b",
            ".tore-private-write-x.tmp",
            "network.json",
            "arsiv.bozuk-💣💣💣💣💣💣💣💣💣💣💣💣💣💣💣.json",
        ] {
            assert!(AllowedPath::parse(s).is_err(), "{s}");
        }
        for stem in JSON_STEMS {
            assert!(AllowedPath::parse(&format!("{stem}.onceki.json")).is_ok());
        }
        assert!(
            AllowedPath::parse(
                "arsiv.bozuk-2026-11-14T12-05-01-000Z-00000000-0000-4000-8000-000000000000.json"
            )
            .is_ok()
        );
        assert!(
            AllowedPath::parse("profiller.bozuk-00000000-0000-4000-8000-000000000000.json").is_ok()
        );
        assert!(AllowedPath::parse("arsiv.bozuk-2026-99-14T12-05-01-000Z.json").is_err());
    }
    #[test]
    fn authorization_requires_bearer_and_exact_host_and_origin() {
        let f = Fixture::new();
        assert!(f.state.authorize(&headers()).is_ok());
        for key in ["authorization", "host", "origin"] {
            let mut h = headers();
            h.remove(key);
            assert!(f.state.authorize(&h).is_err());
        }
        for (key, value) in [
            ("authorization", "Bearer wrong"),
            ("host", "evil.invalid"),
            ("origin", "http://evil.invalid"),
            ("sec-fetch-site", "cross-site"),
        ] {
            let mut h = headers();
            h.insert(key, value.parse().unwrap());
            assert!(f.state.authorize(&h).is_err());
        }
        assert!(fs::read_dir(&f.dir).unwrap().next().is_none());
    }
    #[test]
    fn bytes_touch_cas_reopen_and_directory_listing_preserve_data() {
        let f = Fixture::new();
        let bytes = b"\xef\xbb\xbf# T\xc3\xbcrk\xc3\xa7e\r\n\x00\xff";
        assert!(
            f.run(json!({"op":"mkdir","path":"raporlar"})).unwrap()["created"]
                .as_bool()
                .unwrap()
        );
        assert!(
            !f.run(json!({"op":"mkdir","path":"raporlar"})).unwrap()["created"]
                .as_bool()
                .unwrap()
        );
        let path = "raporlar/00000000-0000-4000-8000-000000000000.md";
        f.write(path, bytes, None).unwrap();
        let touched = f.run(json!({"op":"touch","path":path})).unwrap();
        assert_eq!(touched["sha256"], hash(bytes));
        assert_eq!(touched["created"], false);
        let reopened = PrivateFs::new(f.dir.clone(), TOKEN.into(), ORIGIN.into());
        let got = reopened
            .execute(serde_json::from_value(json!({"op":"read","path":path})).unwrap())
            .unwrap();
        assert_eq!(
            STANDARD.decode(got["bytes"].as_str().unwrap()).unwrap(),
            bytes
        );
        assert_eq!(
            f.run(json!({"op":"list","path":"raporlar"})).unwrap()["entries"][0]["kind"],
            "file"
        );
        assert_eq!(
            f.run(json!({"op":"list","path":"raporlar"})).unwrap()["entries"][0]["kind"],
            "file"
        );
        assert_eq!(
            fs::metadata(f.dir.join(path)).unwrap().permissions().mode() & 0o777,
            0o600
        );
        assert_eq!(
            f.write(path, b"wrong", None).unwrap_err().status,
            StatusCode::CONFLICT
        );
        assert_eq!(
            f.write(path, b"wrong", Some(&hash(b"stale")))
                .unwrap_err()
                .status,
            StatusCode::CONFLICT
        );
        f.write(path, b"updated", Some(&hash(bytes))).unwrap();
        assert_eq!(fs::read(f.dir.join(path)).unwrap(), b"updated");
    }
    #[test]
    fn missing_read_is_404_and_open_does_not_create_initial_data() {
        let f = Fixture::new();
        let e = f.run(json!({"op":"read","path":"arsiv.json"})).unwrap_err();
        assert_eq!(e.code, "NotFoundError");
        assert_eq!(e.status, StatusCode::NOT_FOUND);
        assert!(fs::read_dir(&f.dir).unwrap().next().is_none());
        fs::write(f.dir.join("unknown.md"), b"foreign").unwrap();
        assert_eq!(
            f.run(json!({"op":"list","path":""})).unwrap()["entries"][0]["name"],
            "unknown.md"
        );
        assert!(f.run(json!({"op":"read","path":"unknown.md"})).is_err());
    }
    #[test]
    fn symlink_leaf_parent_root_and_special_files_never_follow_outside() {
        let outside = Fixture::new();
        fs::write(outside.dir.join("victim"), b"private").unwrap();
        let f = Fixture::new();
        symlink(outside.dir.join("victim"), f.dir.join("arsiv.json")).unwrap();
        assert_eq!(
            f.run(json!({"op":"read","path":"arsiv.json"}))
                .unwrap_err()
                .code,
            "NotAllowedError"
        );
        assert!(f.write("arsiv.json", b"overwrite", None).is_err());
        assert_eq!(fs::read(outside.dir.join("victim")).unwrap(), b"private");
        let g = Fixture::new();
        symlink(&outside.dir, g.dir.join("raporlar")).unwrap();
        assert!(g.run(json!({"op":"list","path":"raporlar"})).is_err());
        assert!(g.run(json!({"op":"mkdir","path":"raporlar"})).is_err());
        let alias = g.dir.join("root-link");
        symlink(&outside.dir, &alias).unwrap();
        let linked = PrivateFs::new(alias, TOKEN.into(), ORIGIN.into());
        assert_eq!(
            linked
                .execute(serde_json::from_value(json!({"op":"list","path":""})).unwrap())
                .unwrap_err()
                .code,
            "InvalidStateError"
        );
    }
    #[test]
    fn queued_writers_with_one_baseline_cannot_both_commit() {
        let f = Fixture::new();
        f.write("arsiv.json", b"initial", None).unwrap();
        let expected = hash(b"initial");
        let handles:Vec<_>=(0..2).map(|i| { let state=f.state.clone();let expected=expected.clone();std::thread::spawn(move||state.execute(serde_json::from_value(json!({"op":"write","path":"arsiv.json","data":STANDARD.encode(format!("writer {i}")),"expectedSha256":expected})).unwrap())) }).collect();
        let results: Vec<_> = handles.into_iter().map(|h| h.join().unwrap()).collect();
        assert_eq!(results.iter().filter(|r| r.is_ok()).count(), 1);
        assert_eq!(
            results
                .iter()
                .filter(|r| r
                    .as_ref()
                    .is_err_and(|e| e.code == "InvalidModificationError"))
                .count(),
            1
        );
    }
    #[test]
    fn failed_write_before_or_after_commit_never_reports_success_and_poison_closes() {
        for stage in ["before-commit", "after-commit"] {
            let f = Fixture::new();
            f.write("arsiv.json", b"original", None).unwrap();
            f.state.disk.lock().unwrap().fault = Some(stage);
            assert_eq!(
                f.write("arsiv.json", b"new", Some(&hash(b"original")))
                    .unwrap_err()
                    .status,
                StatusCode::INTERNAL_SERVER_ERROR
            );
            assert_eq!(
                f.write("profiller.json", b"later", None).unwrap_err().code,
                "InvalidStateError"
            );
            assert_eq!(
                fs::read(f.dir.join("arsiv.json")).unwrap(),
                if stage == "before-commit" {
                    b"original".as_slice()
                } else {
                    b"new".as_slice()
                }
            );
            assert_eq!(fs::read_dir(&f.dir).unwrap().count(), 1);
        }
    }
    #[test]
    fn oversized_bytes_invalid_base64_and_bad_hash_reject_without_mutation() {
        let f = Fixture::new();
        assert_eq!(
            f.write("arsiv.json", &vec![0; MAX_FILE + 1], None)
                .unwrap_err()
                .status,
            StatusCode::PAYLOAD_TOO_LARGE
        );
        assert!(
            f.run(json!({"op":"write","path":"arsiv.json","data":"%not-base64"}))
                .is_err()
        );
        assert!(f.write("arsiv.json", b"x", Some("a")).is_err());
        assert!(fs::read_dir(&f.dir).unwrap().next().is_none());
    }
    #[test]
    fn real_permission_denial_never_reports_success_or_allows_later_writes() {
        if unsafe { libc::geteuid() } == 0 {
            eprintln!(
                "chmod izin reddi testi root kullanıcısında uygulanamaz; sentetik disk hata testleri ayrıdır."
            );
            return;
        }
        let f = Fixture::new();
        fs::set_permissions(&f.dir, fs::Permissions::from_mode(0o500)).unwrap();
        let result = f.write("arsiv.json", b"must not be saved", None);
        fs::set_permissions(&f.dir, fs::Permissions::from_mode(0o700)).unwrap();
        let failure = result.unwrap_err();
        assert_eq!(failure.code, "NotAllowedError");
        assert_eq!(failure.status, StatusCode::FORBIDDEN);
        assert!(!f.dir.join("arsiv.json").exists());
        assert_eq!(
            f.write("arsiv.json", b"later", None).unwrap_err().code,
            "InvalidStateError"
        );
    }
    #[tokio::test]
    async fn public_http_entrypoint_checks_auth_cas_and_no_cors() {
        use axum::{body::Body, http::Request as HttpRequest};
        use http_body_util::BodyExt;
        use tower::ServiceExt;
        let f = Fixture::new();
        let app = router(f.dir.clone(), TOKEN.into(), ORIGIN.into());
        let request = |body: Value, authorized: bool| {
            let mut r = HttpRequest::post("/api/private/fs")
                .header("content-type", "application/json")
                .header("host", "127.0.0.1:4317")
                .header("origin", ORIGIN);
            if authorized {
                r = r.header("authorization", format!("Bearer {TOKEN}"));
            }
            r.body(Body::from(body.to_string())).unwrap()
        };
        let denied = app
            .clone()
            .oneshot(request(json!({"op":"list","path":""}), false))
            .await
            .unwrap();
        assert_eq!(denied.status(), StatusCode::UNAUTHORIZED);
        assert!(
            denied
                .headers()
                .get("access-control-allow-origin")
                .is_none()
        );
        let saved = app
            .clone()
            .oneshot(request(
                json!({"op":"write","path":"arsiv.json","data":STANDARD.encode(b"{}")}),
                true,
            ))
            .await
            .unwrap();
        assert_eq!(saved.status(), StatusCode::OK);
        let stale = app
            .clone()
            .oneshot(request(
                json!({"op":"write","path":"arsiv.json","data":STANDARD.encode(b"new")}),
                true,
            ))
            .await
            .unwrap();
        assert_eq!(stale.status(), StatusCode::CONFLICT);
        let read = app
            .oneshot(request(json!({"op":"read","path":"arsiv.json"}), true))
            .await
            .unwrap();
        let value: Value =
            serde_json::from_slice(&read.into_body().collect().await.unwrap().to_bytes()).unwrap();
        assert_eq!(value["bytes"], STANDARD.encode(b"{}"));
    }
}
