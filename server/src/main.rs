mod assets;
mod lifecycle;
mod network;
mod private_fs;
mod sources;
mod workspace;
use std::path::{Path, PathBuf};
#[tokio::main]
async fn main() {
    if let Err(e) = run().await {
        eprintln!("Töre demo başlatılamadı: {e}");
        std::process::exit(1);
    }
}
fn safe_directory(path: &Path) -> Result<(), String> {
    if !path.is_absolute()
        || path.parent().is_none()
        || path
            .components()
            .any(|c| matches!(c, std::path::Component::ParentDir))
    {
        return Err("Demo dizinleri açık, mutlak ve kök olmayan yollar olmalı".into());
    }
    for p in path.ancestors() {
        if std::fs::symlink_metadata(p).is_ok_and(|m| m.file_type().is_symlink()) {
            return Err("Demo veri yollarında sembolik bağ kullanılamaz".into());
        }
    }
    Ok(())
}
async fn run() -> Result<(), String> {
    let args: Vec<String> = std::env::args().skip(1).collect();
    if args == ["--help"] {
        println!(
            "Töre 0.12.1 — Konuya Geri Dön: --archive MUTLAK_KLASÖR --data MUTLAK_KLASÖR [--listen 127.0.0.1:0] [--open]"
        );
        return Ok(());
    }
    let (mut archive, mut data, mut listen, mut open) = (None, None, None, false);
    let mut i = 0;
    while i < args.len() {
        match args[i].as_str() {
            "--archive" | "--data" | "--listen" => {
                let value = args.get(i + 1).ok_or("Seçenek değeri eksik")?.clone();
                let slot = match args[i].as_str() {
                    "--archive" => &mut archive,
                    "--data" => &mut data,
                    _ => &mut listen,
                };
                if slot.replace(value).is_some() {
                    return Err("Aynı seçenek iki kez verilemez".into());
                }
                i += 2;
            }
            "--open" if !open => {
                open = true;
                i += 1;
            }
            _ => {
                return Err(
                    "Bu demo yalnız --archive, --data, --listen ve --open seçeneklerini kabul eder"
                        .into(),
                );
            }
        }
    }
    let archive = PathBuf::from(
        archive.ok_or("Demo için ayrı --archive yolu zorunlu; üretim varsayılanı yok")?,
    );
    let data = PathBuf::from(data.ok_or("Demo için ayrı --data yolu zorunlu")?);
    safe_directory(&archive)?;
    safe_directory(&data)?;
    if archive.starts_with(&data) || data.starts_with(&archive) {
        return Err("Arşiv ile uygulama deposu birbirinden ayrı dizinlerde olmalı".into());
    }
    let listen = listen.unwrap_or_else(|| "127.0.0.1:0".into());
    let addr: std::net::SocketAddr = listen.parse().map_err(|_| "Geçersiz dinleme adresi")?;
    if !addr.ip().is_loopback() {
        return Err("Teknik demo yalnız bu bilgisayarda çalışır".into());
    }
    std::fs::create_dir_all(&archive).map_err(|_| "Demo arşivi oluşturulamadı")?;
    let runtime = data.join(".tore-runtime");
    safe_directory(&runtime)?;
    std::fs::create_dir_all(&runtime).map_err(|_| "Demo çalışma alanı oluşturulamadı")?;
    #[cfg(unix)]
    {
        use std::os::unix::fs::PermissionsExt;
        for d in [&archive, &data, &runtime] {
            std::fs::set_permissions(d, std::fs::Permissions::from_mode(0o700))
                .map_err(|_| "Demo izinleri ayarlanamadı")?;
        }
    }
    let token = format!(
        "{}{}",
        uuid::Uuid::new_v4().simple(),
        uuid::Uuid::new_v4().simple()
    );
    let mut network_args = vec![
        "--data".into(),
        data.to_string_lossy().into_owned(),
        "--listen".into(),
        listen,
    ];
    if open {
        network_args.push("--open".into());
    }
    network::run(
        network_args,
        Some(network::DesktopConfig {
            archive_root: archive,
            token,
            runtime_path: Some(runtime.join("runtime.json")),
        }),
    )
    .await
}
