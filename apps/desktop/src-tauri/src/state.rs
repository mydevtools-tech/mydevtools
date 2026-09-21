use std::path::{Path, PathBuf};
use std::sync::{Arc, Mutex};

use zeroize::Zeroizing;

use crate::db;
use crate::error::Result;

pub struct AppState {
    pub db: Mutex<rusqlite::Connection>,
    /// App data directory holding the DB files. None for in-memory test state,
    /// which keeps destructive file operations (factory reset) inert in tests.
    pub data_dir: Option<PathBuf>,
    /// Secure Files KEK (Argon2id of the master password). `None` = locked.
    /// Dropping the `Zeroizing` wipes the bytes.
    pub kek: Mutex<Option<Zeroizing<[u8; 32]>>>,
    /// Secure Files decrypted-metadata cache (id → meta + on-disk size),
    /// populated by the first listing after unlock and kept fresh by
    /// write-through + an id-set diff against the storage dir. `None` = cold
    /// (locked or never listed). Plaintext names live here only while the
    /// vault is unlocked.
    pub sf_meta: Mutex<Option<crate::router::secure_files::MetaCache>>,
    /// One active secure-file mutation, including its progress and cancellation
    /// token. The router owns its lifecycle; UI polling only observes it.
    pub secure_file_operations: Arc<crate::router::secure_files::OperationRegistry>,
}

impl AppState {
    pub fn init(db_path: PathBuf) -> Result<Self> {
        let conn = db::open(&db_path)?;
        Ok(Self {
            db: Mutex::new(conn),
            data_dir: db_path.parent().map(Path::to_path_buf),
            kek: Mutex::new(None),
            sf_meta: Mutex::new(None),
            secure_file_operations: Arc::new(crate::router::secure_files::OperationRegistry::default()),
        })
    }

    /// In-memory state for tests (no Keychain, no SQLCipher key).
    #[cfg(test)]
    pub fn in_memory() -> Self {
        let conn = rusqlite::Connection::open_in_memory().unwrap();
        db::migrations::run(&conn).unwrap();
        Self {
            db: Mutex::new(conn),
            data_dir: None,
            kek: Mutex::new(None),
            sf_meta: Mutex::new(None),
            secure_file_operations: Arc::new(crate::router::secure_files::OperationRegistry::default()),
        }
    }
}
