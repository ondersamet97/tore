use super::types::*;
use fs2::FileExt;
use serde::{Deserialize, Serialize};
use std::{
    collections::BTreeMap,
    fs::{self, File, OpenOptions},
    io::Write,
    path::{Path, PathBuf},
};

#[derive(Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Store {
    pub schema_version: u32,
    pub conversations: BTreeMap<String, Conversation>,
    pub drafts: BTreeMap<String, TransferDraft>,
    pub receipts: Vec<TransferReceipt>,
}
impl Default for Store {
    fn default() -> Self {
        Self {
            schema_version: 1,
            conversations: BTreeMap::new(),
            drafts: BTreeMap::new(),
            receipts: vec![],
        }
    }
}
pub struct Disk {
    root: PathBuf,
    _lock: File,
    pub data: Store,
    healthy: bool,
    disk_hash: Option<String>,
    #[cfg(test)]
    fail_after_rename: bool,
}
pub(super) fn no_symlinks(path: &Path) -> Result<(), String> {
    for p in path.ancestors() {
        if fs::symlink_metadata(p).is_ok_and(|m| m.file_type().is_symlink()) {
            return Err("Depo yolu sembolik bağ içeremez".into());
        }
    }
    Ok(())
}
pub(super) fn private_options() -> OpenOptions {
    let mut o = OpenOptions::new();
    o.write(true).read(true);
    #[cfg(unix)]
    {
        use std::os::unix::fs::OpenOptionsExt;
        o.mode(0o600).custom_flags(libc::O_NOFOLLOW);
    }
    o
}
impl Disk {
    pub fn open(root: PathBuf) -> Result<Self, String> {
        no_symlinks(&root)?;
        fs::create_dir_all(&root).map_err(|_| "Konuşma deposu açılamadı")?;
        #[cfg(unix)]
        {
            use std::os::unix::fs::PermissionsExt;
            fs::set_permissions(&root, fs::Permissions::from_mode(0o700))
                .map_err(|_| "Depo izinleri ayarlanamadı")?;
        }
        let lock = private_options()
            .create(true)
            .truncate(false)
            .open(root.join("workspace.lock"))
            .map_err(|_| "Depo kilidi açılamadı")?;
        lock.try_lock_exclusive()
            .map_err(|_| "Bu konuşma deposu başka bir Töre sürecinde açık")?;
        let path = root.join("workspace-v1.json");
        no_symlinks(&path)?;
        let data = if path.exists() {
            if fs::metadata(&path).map_err(|_| "Depo okunamadı")?.len() > 512 * 1024 * 1024 {
                return Err("Depo boyutu sınırı aşıldı".into());
            }
            let data: Store =
                serde_json::from_slice(&fs::read(&path).map_err(|_| "Depo okunamadı")?)
                    .map_err(|_| "Depo bozuk; sıfırlanmadı")?;
            if data.schema_version != 1 {
                return Err("Desteklenmeyen depo sürümü; sıfırlanmadı".into());
            }
            data
        } else {
            Store::default()
        };
        let disk_hash = if path.exists() {
            Some(super::policy::digest(
                &fs::read(&path).map_err(|_| "Depo okunamadı")?,
            ))
        } else {
            None
        };
        let mut disk = Self {
            root,
            _lock: lock,
            data,
            healthy: true,
            disk_hash,
            #[cfg(test)]
            fail_after_rename: false,
        };
        // A crash after dispatch is ambiguous. Never repeat automatically on restart.
        let mut repaired = disk.data.clone();
        let mut changed = false;
        for d in repaired.drafts.values_mut() {
            if d.status == "sending" {
                d.status = "unknown".into();
                changed = true;
            }
        }
        if changed {
            disk.commit(repaired)?;
        }
        Ok(disk)
    }
    pub fn commit(&mut self, next: Store) -> Result<(), String> {
        if !self.healthy {
            return Err("Depo doğrulama/yazma hatasından sonra kilitlendi; dosyaları koruyup uygulamayı yeniden açın".into());
        }
        let bytes = serde_json::to_vec(&next).map_err(|_| "Depo kodlanamadı")?;
        if bytes.len() > 512 * 1024 * 1024 {
            return Err("Depo boyutu sınırı aşıldı".into());
        }
        let path = self.root.join("workspace-v1.json");
        no_symlinks(&path)?;
        let temp = self.root.join(format!(".{}.tmp", uuid::Uuid::new_v4()));
        let result = (|| {
            let current = match fs::read(&path) {
                Ok(b) => Some(super::policy::digest(&b)),
                Err(e) if e.kind() == std::io::ErrorKind::NotFound => None,
                Err(_) => return Err("Depo okunamadı".into()),
            };
            if current != self.disk_hash {
                return Err("Depo dışarıdan değiştirilmiş; üzerine yazılmadı".into());
            }
            let mut f = private_options()
                .create_new(true)
                .open(&temp)
                .map_err(|_| "Geçici kayıt açılamadı")?;
            f.write_all(&bytes)
                .and_then(|_| f.sync_all())
                .map_err(|_| "Kayıt yazılamadı")?;
            fs::rename(&temp, &path).map_err(|_| "Atomik kayıt tamamlanamadı")?;
            #[cfg(test)]
            if self.fail_after_rename {
                return Err("Sentetik kalıcılık hatası".into());
            }
            File::open(&self.root)
                .and_then(|f| f.sync_all())
                .map_err(|_| "Depo kalıcılığı doğrulanamadı")?;
            Ok::<(), String>(())
        })();
        if result.is_err() {
            self.healthy = false;
            let _ = fs::remove_file(temp);
        }
        result?;
        self.disk_hash = Some(super::policy::digest(&bytes));
        self.data = next;
        Ok(())
    }
}
#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn locked_atomic_reopen() {
        let p = std::env::temp_dir()
            .canonicalize()
            .unwrap()
            .join(format!("tore-store-{}", uuid::Uuid::new_v4()));
        let mut d = Disk::open(p.clone()).unwrap();
        assert!(Disk::open(p.clone()).is_err());
        d.commit(Store::default()).unwrap();
        drop(d);
        assert_eq!(Disk::open(p.clone()).unwrap().data.schema_version, 1);
        fs::remove_dir_all(p).unwrap();
    }
    #[test]
    fn corrupt_is_not_reset() {
        let p = std::env::temp_dir()
            .canonicalize()
            .unwrap()
            .join(format!("tore-store-{}", uuid::Uuid::new_v4()));
        fs::create_dir_all(&p).unwrap();
        fs::write(p.join("workspace-v1.json"), "broken").unwrap();
        assert!(Disk::open(p.clone()).is_err());
        assert_eq!(
            fs::read_to_string(p.join("workspace-v1.json")).unwrap(),
            "broken"
        );
        fs::remove_dir_all(p).unwrap();
    }
}

#[cfg(test)]
mod failure_tests {
    use super::*;
    #[test]
    fn external_change_and_ambiguous_commit_fail_closed() {
        for ambiguous in [false, true] {
            let p = std::env::temp_dir()
                .canonicalize()
                .unwrap()
                .join(format!("tore-fail-{}", uuid::Uuid::new_v4()));
            let mut d = Disk::open(p.clone()).unwrap();
            d.commit(Store::default()).unwrap();
            if ambiguous {
                d.fail_after_rename = true;
            } else {
                fs::write(p.join("workspace-v1.json"), b"external edit").unwrap();
            }
            assert!(d.commit(Store::default()).is_err());
            assert!(!d.healthy);
            assert!(d.commit(Store::default()).is_err());
            if !ambiguous {
                assert_eq!(
                    fs::read(p.join("workspace-v1.json")).unwrap(),
                    b"external edit"
                );
            }
            drop(d);
            fs::remove_dir_all(p).unwrap();
        }
    }
}
