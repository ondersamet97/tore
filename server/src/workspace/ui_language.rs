//! The interface language chosen with the EN | TR switch.
//!
//! The loopback port, and so the browser origin, changes on every launch, which
//! makes browser storage forget the choice. It is kept next to the notebook in
//! its own small file instead. It is a display preference, not notebook data:
//! record backups and restores never read or write it.
use serde_json::{Value, json};
use std::{
    fs::{self, OpenOptions},
    io::Write,
    path::{Path, PathBuf},
};

pub const LANGUAGES: [&str; 2] = ["en", "tr"];
const FILE: &str = "ui-language.json";

pub struct Preference {
    root: PathBuf,
}

fn no_symlink(path: &Path) -> Result<(), String> {
    if fs::symlink_metadata(path).is_ok_and(|m| m.file_type().is_symlink()) {
        return Err("Arayüz dili dosyası sembolik bağ olamaz".into());
    }
    Ok(())
}

impl Preference {
    pub fn open(root: PathBuf) -> Self {
        Self { root }
    }

    /// The saved language, or None when nothing valid was saved. A missing or
    /// unreadable file never blocks the interface; the page falls back to the
    /// browser language.
    pub fn get(&self) -> Option<&'static str> {
        let path = self.root.join(FILE);
        if no_symlink(&path).is_err() || fs::metadata(&path).map(|m| m.len() > 4096).unwrap_or(true) {
            return None;
        }
        let value: Value = serde_json::from_slice(&fs::read(&path).ok()?).ok()?;
        let saved = value["language"].as_str()?;
        LANGUAGES.iter().copied().find(|l| *l == saved)
    }

    pub fn view(&self) -> Result<Value, String> {
        Ok(json!({ "language": self.get() }))
    }

    pub fn set(&self, r: &Value) -> Result<Value, String> {
        let object = r.as_object().ok_or("Desteklenmeyen arayüz dili")?;
        if object.len() != 1 {
            return Err("Desteklenmeyen arayüz dili".into());
        }
        let language = object
            .get("language")
            .and_then(Value::as_str)
            .and_then(|l| LANGUAGES.iter().copied().find(|x| *x == l))
            .ok_or("Desteklenmeyen arayüz dili")?;
        let path = self.root.join(FILE);
        no_symlink(&path)?;
        let bytes = serde_json::to_vec(&json!({ "schemaVersion": 1, "language": language }))
            .map_err(|_| "Arayüz dili kaydedilemedi")?;
        let temp = self.root.join(format!(".ui-language-{}.tmp", uuid::Uuid::new_v4()));
        let result = (|| {
            let mut options = OpenOptions::new();
            options.write(true).create_new(true);
            #[cfg(unix)]
            {
                use std::os::unix::fs::OpenOptionsExt;
                options.mode(0o600).custom_flags(libc::O_NOFOLLOW);
            }
            let mut f = options.open(&temp).map_err(|_| "Arayüz dili kaydedilemedi")?;
            f.write_all(&bytes)
                .and_then(|_| f.sync_all())
                .map_err(|_| "Arayüz dili kaydedilemedi")?;
            fs::rename(&temp, &path).map_err(|_| "Arayüz dili kaydedilemedi")?;
            Ok::<(), String>(())
        })();
        if result.is_err() {
            let _ = fs::remove_file(&temp);
        }
        result?;
        Ok(json!({ "language": language }))
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    fn dir() -> PathBuf {
        let p = std::env::temp_dir()
            .canonicalize()
            .unwrap()
            .join(format!("tore-ui-language-{}", uuid::Uuid::new_v4()));
        fs::create_dir_all(&p).unwrap();
        p
    }

    #[test]
    fn nothing_saved_reads_as_null_and_a_choice_survives_reopening() {
        let root = dir();
        let pref = Preference::open(root.clone());
        assert_eq!(pref.view().unwrap(), json!({ "language": null }));
        assert_eq!(pref.set(&json!({ "language": "tr" })).unwrap(), json!({ "language": "tr" }));
        assert_eq!(Preference::open(root.clone()).view().unwrap(), json!({ "language": "tr" }));
        pref.set(&json!({ "language": "en" })).unwrap();
        assert_eq!(Preference::open(root.clone()).get(), Some("en"));
        #[cfg(unix)]
        {
            use std::os::unix::fs::PermissionsExt;
            let mode = fs::metadata(root.join(FILE)).unwrap().permissions().mode();
            assert_eq!(mode & 0o777, 0o600);
        }
        assert!(fs::read_dir(&root).unwrap().all(|e| !e.unwrap().file_name().to_string_lossy().ends_with(".tmp")));
        fs::remove_dir_all(root).unwrap();
    }

    #[test]
    fn only_en_and_tr_are_accepted_and_a_bad_request_changes_nothing() {
        let root = dir();
        let pref = Preference::open(root.clone());
        pref.set(&json!({ "language": "en" })).unwrap();
        for bad in [
            json!({ "language": "de" }),
            json!({ "language": "EN" }),
            json!({ "language": "" }),
            json!({ "language": null }),
            json!({ "language": "tr", "extra": true }),
            json!({}),
            json!("tr"),
        ] {
            assert_eq!(pref.set(&bad).unwrap_err(), "Desteklenmeyen arayüz dili", "{bad}");
        }
        assert_eq!(pref.get(), Some("en"));
        fs::remove_dir_all(root).unwrap();
    }

    #[test]
    fn a_damaged_or_foreign_file_reads_as_no_choice() {
        let root = dir();
        let pref = Preference::open(root.clone());
        for content in ["not json", "{\"language\":\"fr\"}", "{\"language\":5}", "[]"] {
            fs::write(root.join(FILE), content).unwrap();
            assert_eq!(pref.view().unwrap(), json!({ "language": null }), "{content}");
        }
        pref.set(&json!({ "language": "tr" })).unwrap();
        assert_eq!(pref.get(), Some("tr"));
        fs::remove_dir_all(root).unwrap();
    }

    #[cfg(unix)]
    #[test]
    fn a_symlinked_file_is_neither_read_nor_replaced() {
        let root = dir();
        let outside = root.join("outside.json");
        fs::write(&outside, "{\"language\":\"tr\"}").unwrap();
        std::os::unix::fs::symlink(&outside, root.join(FILE)).unwrap();
        let pref = Preference::open(root.clone());
        assert_eq!(pref.get(), None);
        assert!(pref.set(&json!({ "language": "en" })).is_err());
        assert_eq!(fs::read_to_string(&outside).unwrap(), "{\"language\":\"tr\"}");
        fs::remove_dir_all(root).unwrap();
    }
}
