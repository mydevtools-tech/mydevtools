//! Secure Files — `/api/v1/secure-files/*`.
//!
//! Encrypts user files into opaque `<32 hex>.mydt` objects inside one
//! user-chosen storage directory. There is no index: every `.mydt` carries its
//! own encrypted metadata, so listing = scan the dir + decrypt headers.
//! The KEK lives in `AppState.kek` (set by `/auth/master-vault/unlock`).
//!
//! kv row `secure_files`: `{"dir": "/path" | null, "salt": "<b64>", "m", "t", "p"}`.

// Format + crypto live in the standalone `mydt` crate (crates/mydt), shared
// with the `mydt` CLI so both sides read/write identical objects.
use mydt as crypto;

use std::collections::HashSet;
use std::fs;
use std::io::Read;
use std::path::{Path, PathBuf};
use std::sync::atomic::{AtomicBool, Ordering::Relaxed};
use std::sync::{Arc, Mutex};

use base64::Engine;
use rusqlite::{Connection, OptionalExtension};
use serde::{Deserialize, Serialize};
use serde_json::{json, Value};
use zeroize::Zeroizing;

use crate::db::now_ms;
use crate::error::{AppError, Result};
use crate::router::ApiResponse;
use crate::state::AppState;
use mydt::{CryptoError, FileMeta, KdfParams, HEADER_LEN, MAX_FILE_BYTES, MAX_OBJECT_BYTES, SALT_LEN};

pub const KV_KEY: &str = "secure_files";

/// Cached decrypted metadata plus the object's size on disk (plaintext bytes
/// plus container overhead), so storage totals need no extra stat calls.
pub struct CachedEntry {
    pub meta: FileMeta,
    pub physical: u64,
}

pub type MetaCache = std::collections::HashMap<String, CachedEntry>;

const EXT: &str = "mydt";
const TMP_EXT: &str = "mydt.tmp";

/// Largest plaintext handed to the webview for a preview. Everything else
/// streams file-to-file; a preview cannot, so it keeps its own, far smaller
/// cap. Mirrors `MAX_PREVIEW_BYTES` in `secure-files-tool.tsx`.
const MAX_PREVIEW_BYTES: u64 = 64 * 1024 * 1024;

// ── Config (kv) ───────────────────────────────────────────────────────────

#[derive(Serialize, Deserialize, Clone)]
struct Cfg {
    dir: Option<String>,
    salt: String,
    m: u32,
    t: u32,
    p: u32,
}

impl Cfg {
    fn kdf(&self) -> Fallible<KdfParams> {
        let raw = base64::engine::general_purpose::STANDARD
            .decode(&self.salt)
            .map_err(|_| Fail(500, "corrupt secure_files salt".into()))?;
        let salt: [u8; SALT_LEN] = raw.as_slice().try_into().map_err(|_| Fail(500, "corrupt secure_files salt".into()))?;
        Ok(KdfParams { salt, m_cost: self.m, t_cost: self.t, p_cost: self.p })
    }
}

fn load_cfg(db: &Connection) -> Result<Option<Cfg>> {
    let raw: Option<String> = db
        .query_row("SELECT v FROM kv WHERE k = ?1", [KV_KEY], |r| r.get(0))
        .optional()?;
    Ok(match raw {
        Some(s) => Some(serde_json::from_str(&s)?),
        None => None,
    })
}

fn save_cfg(db: &Connection, cfg: &Cfg) -> Result<()> {
    db.execute(
        "INSERT INTO kv (k, v) VALUES (?1, ?2) ON CONFLICT(k) DO UPDATE SET v = excluded.v",
        [KV_KEY, &serde_json::to_string(cfg)?],
    )?;
    Ok(())
}

fn load_or_create_cfg(db: &Connection) -> Result<Cfg> {
    if let Some(cfg) = load_cfg(db)? {
        return Ok(cfg);
    }
    let p = KdfParams::generate();
    let cfg = Cfg {
        dir: None,
        salt: base64::engine::general_purpose::STANDARD.encode(p.salt),
        m: p.m_cost,
        t: p.t_cost,
        p: p.p_cost,
    };
    save_cfg(db, &cfg)?;
    Ok(cfg)
}

// ── Unlock / lock (called from master_vault.rs) ───────────────────────────

/// Derive the KEK from the master password and hold it in `AppState`.
/// Creates the salt on first call. Argon2 runs with the DB guard released.
// ponytail: sync Argon2 inside route(); spawn_blocking if unlock latency is felt.
pub fn unlock(state: &AppState, password: &[u8]) -> Result<()> {
    let cfg = load_or_create_cfg(&state.db.lock().unwrap())?;
    let params = cfg.kdf().map_err(|f| AppError::Io(std::io::Error::other(f.1)))?;
    let kek = crypto::derive_kek(password, &params).map_err(|e| AppError::Io(std::io::Error::other(e.to_string())))?;
    *state.kek.lock().unwrap() = Some(kek);
    Ok(())
}

pub fn lock(state: &AppState) {
    *state.kek.lock().unwrap() = None;
    *state.sf_meta.lock().unwrap() = None;
}

/// Write-through helpers — no-ops while the cache is cold (next listing scans).
fn cache_put(state: &AppState, e: &Entry) {
    if let Some(m) = state.sf_meta.lock().unwrap().as_mut() {
        m.insert(e.id.clone(), CachedEntry { meta: e.meta.clone(), physical: e.physical });
    }
}

fn cache_remove(state: &AppState, id: &str) {
    if let Some(m) = state.sf_meta.lock().unwrap().as_mut() {
        m.remove(id);
    }
}

// ── Errors → HTTP-ish status ──────────────────────────────────────────────

#[derive(Debug)]
struct Fail(u16, String);
type Fallible<T> = std::result::Result<T, Fail>;

impl From<CryptoError> for Fail {
    fn from(e: CryptoError) -> Self {
        Fail(422, e.to_string())
    }
}
impl From<std::io::Error> for Fail {
    fn from(e: std::io::Error) -> Self {
        Fail(500, format!("io error: {e}"))
    }
}
impl From<AppError> for Fail {
    fn from(e: AppError) -> Self {
        Fail(500, e.to_string())
    }
}
impl From<crypto::StreamError> for Fail {
    fn from(e: crypto::StreamError) -> Self {
        match e {
            crypto::StreamError::Crypto(e) => e.into(),
            crypto::StreamError::Io(e) => e.into(),
        }
    }
}

fn bad(msg: &str) -> Fail {
    Fail(400, msg.into())
}

fn too_big() -> Fail {
    Fail(413, format!("file exceeds the {} GB limit", MAX_FILE_BYTES / 1024 / 1024 / 1024))
}

// ── Progress (polled by the UI while a stream runs) ───────────────────────

#[derive(Clone, Copy, Serialize)]
#[serde(rename_all = "snake_case")]
pub enum OperationKind { Import, Export, Rename, Replace, FolderRename }

#[derive(Clone, Copy, PartialEq, Serialize)]
#[serde(rename_all = "snake_case")]
pub enum OperationStatus { Running, Completed, Cancelled, Failed }

#[derive(Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct OperationSnapshot {
    id: String,
    kind: OperationKind,
    status: OperationStatus,
    done: u64,
    total: u64,
    files_completed: Option<u64>,
    files_total: Option<u64>,
    error: Option<String>,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct IdleOperationSnapshot { id: Option<String>, status: &'static str, done: u64, total: u64, files_completed: Option<u64>, files_total: Option<u64> }

struct Operation {
    snapshot: Mutex<OperationSnapshot>,
    cancelled: AtomicBool,
}

#[derive(Default)]
struct OperationRegistryState { next_id: u64, active: Option<Arc<Operation>> }

/// Owns exactly one secure-files mutation. The UI already serializes these
/// mutations; refusing overlap prevents one cancel request targeting another.
#[derive(Default)]
pub struct OperationRegistry { state: Mutex<OperationRegistryState> }

pub struct OperationGuard { registry: Arc<OperationRegistry>, operation: Arc<Operation> }

impl OperationRegistry {
    fn start(self: &Arc<Self>, kind: OperationKind, total: u64, files_total: Option<u64>) -> Fallible<OperationGuard> {
        let mut state = self.state.lock().unwrap();
        if state.active.is_some() { return Err(Fail(409, "another secure-files operation is already running".into())); }
        state.next_id += 1;
        let operation = Arc::new(Operation {
            snapshot: Mutex::new(OperationSnapshot { id: format!("op_{:x}", state.next_id), kind, status: OperationStatus::Running, done: 0, total, files_completed: files_total.map(|_| 0), files_total, error: None }),
            cancelled: AtomicBool::new(false),
        });
        state.active = Some(operation.clone());
        Ok(OperationGuard { registry: self.clone(), operation })
    }

    fn current_snapshot(&self) -> Value {
        self.state.lock().unwrap().active.as_ref().map(|op| serde_json::to_value(op.snapshot.lock().unwrap().clone()).unwrap()).unwrap_or_else(|| json!(IdleOperationSnapshot { id: None, status: "idle", done: 0, total: 0, files_completed: None, files_total: None }))
    }

    fn cancel(&self, id: Option<&str>) -> bool {
        let state = self.state.lock().unwrap();
        let Some(operation) = state.active.as_ref() else { return false };
        if id.is_some_and(|id| id != operation.snapshot.lock().unwrap().id) { return false; }
        operation.cancelled.store(true, Relaxed);
        true
    }

    fn clear(&self, operation: &Arc<Operation>) {
        let mut state = self.state.lock().unwrap();
        if state.active.as_ref().is_some_and(|active| Arc::ptr_eq(active, operation)) { state.active = None; }
    }
}

impl OperationGuard {
    fn check_cancelled(&self) -> std::io::Result<()> {
        if self.operation.cancelled.load(Relaxed) { Err(std::io::Error::other("cancelled")) } else { Ok(()) }
    }
    fn tick(&self, n: usize) -> std::io::Result<usize> {
        self.check_cancelled()?;
        self.operation.snapshot.lock().unwrap().done += n as u64;
        Ok(n)
    }
    fn is_cancelled(&self) -> bool { self.operation.cancelled.load(Relaxed) }
    fn file_completed(&self) { if let Some(n) = self.operation.snapshot.lock().unwrap().files_completed.as_mut() { *n += 1; } }
    fn snapshot(&self) -> OperationSnapshot { self.operation.snapshot.lock().unwrap().clone() }
    fn complete(&self) { self.operation.snapshot.lock().unwrap().status = OperationStatus::Completed; }
    fn fail(&self, error: &str) { let mut snapshot = self.operation.snapshot.lock().unwrap(); snapshot.status = if self.operation.cancelled.load(Relaxed) { OperationStatus::Cancelled } else { OperationStatus::Failed }; snapshot.error = Some(error.into()); }
}

impl Drop for OperationGuard {
    fn drop(&mut self) {
        if self.operation.snapshot.lock().unwrap().status == OperationStatus::Running { self.fail("operation ended unexpectedly"); }
        self.registry.clear(&self.operation);
    }
}

/// Counts plaintext bytes as they pass, and turns a cancel request into an I/O
/// error so the operation unwinds through the same cleanup as any failure —
/// the temp file goes, the stored object is untouched.
struct Meter<'a, T>(T, &'a OperationGuard);

impl<R: Read> Read for Meter<'_, R> {
    fn read(&mut self, buf: &mut [u8]) -> std::io::Result<usize> {
        let n = self.0.read(buf)?;
        self.1.tick(n)
    }
}

impl<W: std::io::Write> std::io::Write for Meter<'_, W> {
    fn write(&mut self, buf: &[u8]) -> std::io::Result<usize> {
        let n = self.0.write(buf)?;
        self.1.tick(n)
    }
    fn flush(&mut self) -> std::io::Result<()> {
        self.0.flush()
    }
}

// ── Validation (trust boundary) ───────────────────────────────────────────

fn valid_id(id: &str) -> Fallible<()> {
    if id.len() == 32 && id.bytes().all(|b| matches!(b, b'0'..=b'9' | b'a'..=b'f')) {
        Ok(())
    } else {
        Err(bad("invalid file id"))
    }
}

fn valid_name(name: &str) -> Fallible<()> {
    if name.is_empty() || name.len() > 255 || name.contains('/') || name.contains('\\') || name.contains('\0') {
        return Err(bad("invalid file name"));
    }
    if name == "." || name == ".." {
        return Err(bad("invalid file name"));
    }
    Ok(())
}

fn valid_dir(dir: &str) -> Fallible<()> {
    if dir.is_empty() {
        return Ok(());
    }
    if dir.starts_with('/') || dir.ends_with('/') || dir.contains('\0') || dir.contains('\\') {
        return Err(bad("invalid folder path"));
    }
    if dir.split('/').any(|seg| seg.is_empty() || seg == "." || seg == "..") {
        return Err(bad("invalid folder path"));
    }
    Ok(())
}

fn join_dir(base: &str, name: &str) -> String {
    if base.is_empty() {
        name.to_string()
    } else {
        format!("{base}/{name}")
    }
}

fn under(dir: &str, prefix: &str) -> bool {
    dir == prefix || dir.starts_with(&format!("{prefix}/"))
}

// ── State access ──────────────────────────────────────────────────────────

struct Ctx {
    kek: Zeroizing<[u8; 32]>,
    params: KdfParams,
    dir: PathBuf,
}

fn require_kek(state: &AppState) -> Fallible<Zeroizing<[u8; 32]>> {
    match state.kek.lock().unwrap().as_ref() {
        Some(k) => Ok(Zeroizing::new(**k)),
        None => Err(Fail(401, "Vault locked".into())),
    }
}

fn ctx(state: &AppState) -> Fallible<Ctx> {
    let kek = require_kek(state)?;
    let cfg = load_cfg(&state.db.lock().unwrap())?.ok_or_else(|| Fail(409, "Storage folder not set".into()))?;
    let dir = cfg.dir.clone().ok_or_else(|| Fail(409, "Storage folder not set".into()))?;
    let dir = PathBuf::from(dir);
    if !dir.is_dir() {
        // Restored backup from another machine, unplugged external drive, …
        return Err(Fail(409, "Storage folder not found".into()));
    }
    let params = cfg.kdf()?;
    Ok(Ctx { kek, params, dir })
}

// ── Disk I/O ──────────────────────────────────────────────────────────────

#[derive(Serialize)]
struct Entry {
    id: String,
    #[serde(flatten)]
    meta: FileMeta,
    /// Bytes this object occupies in the storage folder. Aggregated into the
    /// listing totals rather than sent per entry.
    #[serde(skip)]
    physical: u64,
}

fn object_path(dir: &Path, id: &str) -> PathBuf {
    dir.join(format!("{id}.{EXT}"))
}

fn new_id() -> String {
    crypto::random::<16>().iter().map(|b| format!("{b:02x}")).collect()
}

/// Fill `<id>.mydt.tmp` via `write`, then rename it over the final name, and
/// answer with the object's size on disk. Anything that fails part-way removes
/// the temp file, so a half-written object never reaches the store. `durable`
/// adds a per-file fsync — right for single-file ops that replace the only
/// copy; bulk import skips it (one directory fsync per batch) since a crash
/// there only yields an unreadable object flagged by the next listing, while
/// the source files still exist.
fn write_atomic(dir: &Path, id: &str, durable: bool, write: impl FnOnce(&mut fs::File) -> Fallible<()>) -> Fallible<u64> {
    let tmp = dir.join(format!("{id}.{TMP_EXT}"));
    let run = || -> Fallible<u64> {
        let mut f = fs::File::create(&tmp)?;
        write(&mut f)?;
        if durable {
            f.sync_all()?;
        }
        let physical = f.metadata()?.len();
        drop(f);
        fs::rename(&tmp, object_path(dir, id))?;
        Ok(physical)
    };
    run().inspect_err(|_| {
        let _ = fs::remove_file(&tmp);
    })
}

/// Read only header + metadata (not the payload) and decrypt the metadata.
/// The on-disk size comes from the already-open handle, so it costs no extra
/// syscall.
fn read_entry_meta(c: &Ctx, id: &str) -> Fallible<(FileMeta, u64)> {
    let mut f = fs::File::open(object_path(&c.dir, id))?;
    let physical = f.metadata()?.len();
    let mut buf = vec![0u8; HEADER_LEN];
    f.read_exact(&mut buf).map_err(|_| CryptoError::Format)?;
    let n = crypto::meta_len(&buf)?;
    f.by_ref().take(n as u64).read_to_end(&mut buf)?;
    Ok((crypto::read_meta(&c.kek, &c.params.salt, &buf)?, physical))
}

/// Decrypt an object onto `dst`, a chunk at a time. Objects are opaque to the
/// caller, so the size gate catches one that is larger than the format allows
/// before any of it is read.
fn decrypt_object(c: &Ctx, id: &str, dst: impl std::io::Write) -> Fallible<FileMeta> {
    let path = object_path(&c.dir, id);
    if fs::metadata(&path)?.len() > MAX_OBJECT_BYTES {
        return Err(CryptoError::Format.into());
    }
    Ok(crypto::decrypt_stream(&c.kek, &c.params.salt, fs::File::open(path)?, dst)?)
}

/// Encrypt `src` into the object `id`, expecting exactly `meta.size` bytes.
fn encrypt_object(c: &Ctx, id: &str, meta: &FileMeta, src: impl Read, durable: bool) -> Fallible<u64> {
    write_atomic(&c.dir, id, durable, |out| {
        let n = crypto::encrypt_stream(&c.kek, &c.params, meta, MAX_FILE_BYTES, src, out)?;
        if n != meta.size {
            // The source grew or shrank mid-read, so the sealed metadata would
            // describe a file that never existed.
            return Err(Fail(409, "the source file changed while it was being read".into()));
        }
        Ok(())
    })
}

/// List via the in-memory metadata cache, reconciled against the id set on
/// disk: removed ids are dropped, new ids are the only files opened and
/// decrypted. First call after unlock scans everything; later calls cost one
/// `read_dir`. Stale tmp files from interrupted writes are removed; unreadable
/// or foreign files go to `errors` (never cached, so they retry every list).
/// In-app mutations write through; a file rewritten in place by an external
/// tool keeps its cached meta until the next unlock.
// ponytail: id-set diff only; add a per-file mtime check if external same-id
// rewrites ever need to be picked up live.
fn list_entries(state: &AppState, c: &Ctx) -> Fallible<(Vec<Entry>, Vec<Value>)> {
    let mut on_disk = HashSet::new();
    for ent in fs::read_dir(&c.dir)? {
        let path = ent?.path();
        let Some(name) = path.file_name().and_then(|n| n.to_str()) else { continue };
        if let Some(stem) = name.strip_suffix(&format!(".{TMP_EXT}")) {
            if valid_id(stem).is_ok() {
                let _ = fs::remove_file(&path);
            }
            continue;
        }
        let Some(id) = name.strip_suffix(&format!(".{EXT}")) else { continue };
        if valid_id(id).is_ok() {
            on_disk.insert(id.to_string());
        }
    }

    let mut errors = Vec::new();
    let mut guard = state.sf_meta.lock().unwrap();
    let map = guard.get_or_insert_default();
    map.retain(|id, _| on_disk.contains(id));
    for id in &on_disk {
        if map.contains_key(id) {
            continue;
        }
        match read_entry_meta(c, id) {
            Ok((meta, physical)) => {
                map.insert(id.clone(), CachedEntry { meta, physical });
            }
            Err(Fail(_, msg)) => errors.push(json!({ "id": id, "error": msg })),
        }
    }
    let mut files: Vec<Entry> = map
        .iter()
        .map(|(id, e)| Entry { id: id.clone(), meta: e.meta.clone(), physical: e.physical })
        .collect();
    drop(guard);
    files.sort_by(|a, b| (&a.meta.dir, &a.meta.name).cmp(&(&b.meta.dir, &b.meta.name)));
    Ok((files, errors))
}

/// Aggregate storage figures for the overview. `physical` is what the folder
/// actually occupies for readable objects (plaintext plus per-file container
/// overhead); unreadable objects are excluded and reported separately.
fn totals(files: &[Entry]) -> Value {
    json!({
        "count": files.len(),
        "size": files.iter().map(|e| e.meta.size).sum::<u64>(),
        "physical": files.iter().map(|e| e.physical).sum::<u64>(),
    })
}

fn mtime_ms(md: &fs::Metadata) -> i64 {
    md.modified()
        .ok()
        .and_then(|t| t.duration_since(std::time::UNIX_EPOCH).ok())
        .map(|d| d.as_millis() as i64)
        .unwrap_or_else(now_ms)
}

fn import_file(c: &Ctx, src: &Path, logical_dir: &str, durable: bool, operation: &OperationGuard) -> Fallible<Entry> {
    let md = fs::metadata(src)?;
    if md.len() > MAX_FILE_BYTES {
        return Err(too_big());
    }
    let name = src
        .file_name()
        .and_then(|n| n.to_str())
        .ok_or_else(|| bad("invalid source file name"))?
        .to_string();
    valid_name(&name)?;
    let meta = FileMeta {
        name,
        dir: logical_dir.to_string(),
        size: md.len(),
        mtime: mtime_ms(&md),
        imported_at: now_ms(),
    };
    let id = new_id();
    let physical = encrypt_object(c, &id, &meta, Meter(fs::File::open(src)?, operation), durable)?;
    Ok(Entry { id, meta, physical })
}

/// Walk `src` (file or directory) collecting `(source path, logical dir)`
/// import targets. Directory contents land under `logical_dir/<dirname>/...`.
/// Dot-files inside walked directories are skipped (`.DS_Store` & co);
/// explicitly picked files are always included. Every walked directory's
/// logical path is reported in `dirs` so empty folders still show in the tree.
fn collect_import(src: &Path, logical_dir: &str, out: &mut Vec<(PathBuf, String)>, errors: &mut Vec<Value>, dirs: &mut Vec<String>) {
    let push_err = |errors: &mut Vec<Value>, p: &Path, msg: String| {
        errors.push(json!({ "path": p.to_string_lossy(), "error": msg }))
    };
    if src.is_dir() {
        let Some(dirname) = src.file_name().and_then(|n| n.to_str()) else {
            return push_err(errors, src, "invalid folder name".into());
        };
        let logical = join_dir(logical_dir, dirname);
        let rd = match fs::read_dir(src) {
            Ok(rd) => rd,
            Err(e) => return push_err(errors, src, e.to_string()),
        };
        dirs.push(logical.clone());
        let mut children: Vec<PathBuf> = rd.filter_map(|e| e.ok().map(|e| e.path())).collect();
        children.sort();
        for child in children {
            if child.file_name().and_then(|n| n.to_str()).is_some_and(|n| n.starts_with('.')) {
                continue;
            }
            collect_import(&child, &logical, out, errors, dirs);
        }
    } else {
        out.push((src.to_path_buf(), logical_dir.to_string()));
    }
}

/// Encrypt+write the collected targets across threads. Per-file fsync is
/// skipped; the caller fsyncs the storage directory once per batch.
fn import_batch(c: &Ctx, targets: &[(PathBuf, String)], imported: &mut Vec<Entry>, errors: &mut Vec<Value>, operation: &OperationGuard) {
    if targets.is_empty() {
        return;
    }
    let workers = std::thread::available_parallelism().map(|n| n.get()).unwrap_or(4).min(8);
    let chunk = targets.len().div_ceil(workers).max(1);
    std::thread::scope(|s| {
        let handles: Vec<_> = targets
            .chunks(chunk)
            .map(|slice| {
                s.spawn(move || {
                    let mut ok = Vec::new();
                    let mut errs = Vec::new();
                    for (src, logical) in slice {
                        match import_file(c, src, logical, false, operation) {
                            Ok(e) => { operation.file_completed(); ok.push(e) },
                            Err(Fail(_, msg)) => errs.push(json!({ "path": src.to_string_lossy(), "error": msg })),
                        }
                    }
                    (ok, errs)
                })
            })
            .collect();
        for h in handles {
            let (ok, errs) = h.join().expect("import worker panicked");
            imported.extend(ok);
            errors.extend(errs);
        }
    });
    let _ = fs::File::open(&c.dir).and_then(|d| d.sync_all());
    imported.sort_by(|a, b| (&a.meta.dir, &a.meta.name).cmp(&(&b.meta.dir, &b.meta.name)));
}

/// Mutate metadata, re-sealing the object with a fresh DEK and nonces. The
/// metadata is sealed ahead of the payload and covers it as associated data,
/// so renaming or moving a file rewrites all of it — the payload goes straight
/// from the decryptor to the encryptor through a pipe, never through a buffer
/// and never through plaintext on disk.
// ponytail: O(size) rename; only a container with a trailing, independently
// sealed metadata block could make it O(1), and that is a format redesign.
fn rewrite(c: &Ctx, id: &str, operation: &OperationGuard, f: impl FnOnce(&mut FileMeta)) -> Fallible<Entry> {
    operation.check_cancelled()?;
    let (mut meta, _) = read_entry_meta(c, id)?;
    f(&mut meta);
    let physical = write_atomic(&c.dir, id, true, |out| {
        let (plaintext, sink) = std::io::pipe()?;
        std::thread::scope(|s| {
            let decrypt = s.spawn(|| decrypt_object(c, id, sink));
            // Encrypt first: dropping the pipe reader on failure ends the
            // decrypt side with a broken pipe instead of blocking it forever.
            let sealed = crypto::encrypt_stream(&c.kek, &c.params, &meta, MAX_FILE_BYTES, Meter(plaintext, operation), out);
            let decrypted = decrypt.join().expect("decrypt worker panicked");
            // A failed encrypt (cancel, disk full) is the cause, so it reports
            // first — the decrypt side then only dies of the broken pipe. A
            // decrypt that fails part-way looks like a clean end of input to
            // the encryptor, so a sealed object still defers to its result.
            sealed?;
            decrypted?;
            Ok(())
        })
    })?;
    Ok(Entry { id: id.to_string(), meta, physical })
}

fn is_inside(path: &Path, dir: &Path) -> bool {
    let canon = |p: &Path| fs::canonicalize(p).unwrap_or_else(|_| p.to_path_buf());
    let parent = path.parent().map(canon).unwrap_or_default();
    parent.starts_with(canon(dir))
}

/// Move every `.mydt` from `from` into `to`. Rename first, copy+remove when
/// the volumes differ. Idempotent per file, so a retry finishes the job.
fn migrate(from: &Path, to: &Path) -> std::io::Result<usize> {
    let mut moved = 0;
    for ent in fs::read_dir(from)? {
        let path = ent?.path();
        let Some(name) = path.file_name().and_then(|n| n.to_str()) else { continue };
        let Some(id) = name.strip_suffix(&format!(".{EXT}")) else { continue };
        if valid_id(id).is_err() {
            continue;
        }
        let dest = to.join(name);
        if fs::rename(&path, &dest).is_err() {
            fs::copy(&path, &dest)?;
            fs::remove_file(&path)?;
        }
        moved += 1;
    }
    Ok(moved)
}

// ── Routes ────────────────────────────────────────────────────────────────

pub fn handle(state: &AppState, method: &str, rest: &str, body: Option<&str>) -> Result<ApiResponse> {
    match dispatch(state, method, rest, body) {
        Ok(r) => Ok(r),
        Err(Fail(status, msg)) => Ok(ApiResponse::detail(status, &msg)),
    }
}

fn parse<T: for<'de> Deserialize<'de>>(body: Option<&str>) -> Fallible<T> {
    serde_json::from_str(body.unwrap_or("{}")).map_err(|e| bad(&format!("invalid body: {e}")))
}

fn ok(v: &impl Serialize) -> Fallible<ApiResponse> {
    Ok(ApiResponse::ok(v)?)
}

fn dispatch(state: &AppState, method: &str, rest: &str, body: Option<&str>) -> Fallible<ApiResponse> {
    match (method, rest) {
        ("GET", "/settings") => {
            let dir = load_cfg(&state.db.lock().unwrap())?.and_then(|c| c.dir);
            let exists = dir.as_deref().is_some_and(|d| Path::new(d).is_dir());
            let unlocked = state.kek.lock().unwrap().is_some();
            ok(&json!({ "dir": dir, "exists": exists, "unlocked": unlocked }))
        }
        ("PUT", "/settings") => {
            #[derive(Deserialize)]
            struct Body {
                dir: String,
            }
            let Body { dir } = parse(body)?;
            let new_dir = PathBuf::from(&dir);
            if !new_dir.is_absolute() {
                return Err(bad("storage folder must be an absolute path"));
            }
            fs::create_dir_all(&new_dir)?;
            let mut cfg = load_or_create_cfg(&state.db.lock().unwrap())?;
            let mut moved = 0;
            if let Some(old) = cfg.dir.as_deref().map(Path::new) {
                let same = fs::canonicalize(old).ok() == fs::canonicalize(&new_dir).ok();
                if !same && old.is_dir() {
                    moved = migrate(old, &new_dir)?;
                }
            }
            cfg.dir = Some(dir.clone());
            save_cfg(&state.db.lock().unwrap(), &cfg)?;
            ok(&json!({ "dir": dir, "moved": moved }))
        }
        ("GET", "/files") => {
            let c = ctx(state)?;
            let (files, errors) = list_entries(state, &c)?;
            ok(&json!({ "totals": totals(&files), "files": files, "errors": errors }))
        }
        // Polled while a stream runs; idle has `total` 0 and no operation ID.
        ("GET", "/progress") => ok(&state.secure_file_operations.current_snapshot()),
        ("POST", "/progress/cancel") => {
            #[derive(Deserialize, Default)]
            #[serde(rename_all = "camelCase")]
            struct Body { operation_id: Option<String> }
            let operation_id = body.map(serde_json::from_str::<Body>).transpose().map_err(|_| bad("invalid cancel request"))?.unwrap_or_default().operation_id;
            if !state.secure_file_operations.cancel(operation_id.as_deref()) && operation_id.is_some() {
                return Err(Fail(409, "secure-files operation is no longer running".into()));
            }
            Ok(ApiResponse::empty(204))
        }
        ("POST", "/files/import") => {
            #[derive(Deserialize)]
            struct Body {
                paths: Vec<String>,
                #[serde(default)]
                dir: String,
            }
            let Body { paths, dir } = parse(body)?;
            valid_dir(&dir)?;
            let c = ctx(state)?;
            let (mut targets, mut errors, mut dirs) = (Vec::new(), Vec::new(), Vec::new());
            for p in &paths {
                collect_import(Path::new(p), &dir, &mut targets, &mut errors, &mut dirs);
            }
            let total = targets.iter().filter_map(|(p, _)| fs::metadata(p).ok()).map(|m| m.len()).sum();
            let operation = state.secure_file_operations.start(OperationKind::Import, total, Some(targets.len() as u64))?;
            let mut imported = Vec::new();
            import_batch(&c, &targets, &mut imported, &mut errors, &operation);
            if operation.is_cancelled() { operation.fail("cancelled"); } else { operation.complete(); }
            for e in &imported {
                cache_put(state, e);
            }
            ok(&json!({ "imported": imported, "errors": errors, "dirs": dirs, "operation": operation.snapshot() }))
        }
        ("POST", "/folders/rename") => {
            #[derive(Deserialize)]
            struct Body {
                from: String,
                to: String,
            }
            let Body { from, to } = parse(body)?;
            valid_dir(&from)?;
            valid_dir(&to)?;
            if from.is_empty() {
                return Err(bad("cannot rename the root folder"));
            }
            let c = ctx(state)?;
            let (files, _) = list_entries(state, &c)?;
            let targets: Vec<_> = files.iter().filter(|e| under(&e.meta.dir, &from)).collect();
            let operation = state.secure_file_operations.start(OperationKind::FolderRename, targets.iter().map(|e| e.meta.size).sum(), Some(targets.len() as u64))?;
            let mut updated = 0;
            for e in targets {
                let suffix = e.meta.dir[from.len()..].to_string(); // "" or "/sub"
                let renamed = match rewrite(&c, &e.id, &operation, |m| m.dir = format!("{to}{suffix}")) { Ok(entry) => entry, Err(Fail(_, message)) => { operation.fail(&message); return Err(Fail(409, format!("{message}; {updated} files were renamed"))); } };
                cache_put(state, &renamed);
                operation.file_completed();
                updated += 1;
            }
            operation.complete();
            ok(&json!({ "updated": updated, "operation": operation.snapshot() }))
        }
        ("POST", "/folders/delete") => {
            #[derive(Deserialize)]
            struct Body {
                dir: String,
            }
            let Body { dir } = parse(body)?;
            valid_dir(&dir)?;
            if dir.is_empty() {
                return Err(bad("cannot delete the root folder"));
            }
            let c = ctx(state)?;
            let (files, _) = list_entries(state, &c)?;
            let mut deleted = 0;
            for e in files.iter().filter(|e| under(&e.meta.dir, &dir)) {
                fs::remove_file(object_path(&c.dir, &e.id))?;
                cache_remove(state, &e.id);
                deleted += 1;
            }
            ok(&json!({ "deleted": deleted }))
        }
        _ => {
            let Some(tail) = rest.strip_prefix("/files/") else {
                return Err(Fail(404, "Not found".into()));
            };
            let (id, action) = tail.split_once('/').unwrap_or((tail, ""));
            valid_id(id)?;
            match (method, action) {
                ("PATCH", "") => {
                    #[derive(Deserialize)]
                    struct Body {
                        name: Option<String>,
                        dir: Option<String>,
                    }
                    let Body { name, dir } = parse(body)?;
                    if let Some(n) = &name {
                        valid_name(n)?;
                    }
                    if let Some(d) = &dir {
                        valid_dir(d)?;
                    }
                    let c = ctx(state)?;
                    let (meta, _) = read_entry_meta(&c, id)?;
                    let operation = state.secure_file_operations.start(OperationKind::Rename, meta.size, Some(1))?;
                    let e = rewrite(&c, id, &operation, |m| {
                        if let Some(n) = name {
                            m.name = n;
                        }
                        if let Some(d) = dir {
                            m.dir = d;
                        }
                    })?;
                    operation.file_completed();
                    operation.complete();
                    cache_put(state, &e);
                    ok(&e)
                }
                ("DELETE", "") => {
                    let c = ctx(state)?;
                    fs::remove_file(object_path(&c.dir, id))?;
                    cache_remove(state, id);
                    Ok(ApiResponse::empty(204))
                }
                ("POST", "replace") => {
                    #[derive(Deserialize)]
                    struct Body {
                        path: String,
                    }
                    let Body { path } = parse(body)?;
                    let src = Path::new(&path);
                    let md = fs::metadata(src)?;
                    if md.len() > MAX_FILE_BYTES {
                        return Err(too_big());
                    }
                    let c = ctx(state)?;
                    let (mut meta, _) = read_entry_meta(&c, id)?;
                    meta.size = md.len();
                    meta.mtime = mtime_ms(&md);
                    let operation = state.secure_file_operations.start(OperationKind::Replace, md.len(), Some(1))?;
                    let physical = encrypt_object(&c, id, &meta, Meter(fs::File::open(src)?, &operation), true)?;
                    operation.file_completed();
                    operation.complete();
                    let e = Entry { id: id.to_string(), meta, physical };
                    cache_put(state, &e);
                    ok(&e)
                }
                ("POST", "export") => {
                    #[derive(Deserialize)]
                    struct Body {
                        path: String,
                    }
                    let Body { path } = parse(body)?;
                    let dest = Path::new(&path);
                    let c = ctx(state)?;
                    if is_inside(dest, &c.dir) {
                        return Err(bad("cannot export into the encrypted storage folder"));
                    }
                    let (meta, _) = read_entry_meta(&c, id)?;
                    let operation = state.secure_file_operations.start(OperationKind::Export, meta.size, Some(1))?;
                    // A failed export leaves a partial file behind, and it is
                    // plaintext — remove it rather than hand back half a secret.
                    decrypt_object(&c, id, Meter(fs::File::create(dest)?, &operation)).inspect_err(|e| {
                        let _ = fs::remove_file(dest);
                        operation.fail(&e.1);
                    })?;
                    operation.file_completed();
                    operation.complete();
                    Ok(ApiResponse::empty(204))
                }
                _ => Err(Fail(404, "Not found".into())),
            }
        }
    }
}

/// Plaintext bytes for the raw-binary `secure_file_read` command (preview).
/// This is the one path that has to materialize a whole file, so it is the one
/// path with a size cap of its own — the UI checks the same limit before
/// asking, and this refuses anything that gets through anyway.
pub fn read_plaintext(state: &AppState, id: &str) -> std::result::Result<Vec<u8>, String> {
    let run = || -> Fallible<Vec<u8>> {
        valid_id(id)?;
        let c = ctx(state)?;
        let (meta, _) = read_entry_meta(&c, id)?;
        if meta.size > MAX_PREVIEW_BYTES {
            return Err(Fail(413, format!("file is larger than the {} MB preview limit", MAX_PREVIEW_BYTES / 1024 / 1024)));
        }
        // Owned by the IPC layer afterwards, which does not zeroize it.
        let mut plaintext = Vec::with_capacity(meta.size as usize);
        decrypt_object(&c, id, &mut plaintext)?;
        Ok(plaintext)
    };
    run().map_err(|Fail(_, msg)| msg)
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::router::route;

    fn body_json(r: &ApiResponse) -> Value {
        serde_json::from_str(&r.body).unwrap()
    }

    struct Tmp(PathBuf);
    impl Tmp {
        fn new(tag: &str) -> Self {
            let dir = std::env::temp_dir().join(format!("mdt-sf-{tag}-{}", std::process::id()));
            let _ = fs::remove_dir_all(&dir);
            fs::create_dir_all(&dir).unwrap();
            Self(dir)
        }
        fn path(&self, name: &str) -> PathBuf {
            self.0.join(name)
        }
        fn s(&self, name: &str) -> String {
            self.path(name).to_string_lossy().into_owned()
        }
    }
    impl Drop for Tmp {
        fn drop(&mut self) {
            let _ = fs::remove_dir_all(&self.0);
        }
    }

    /// Unlocked state with a fixed KEK (skips Argon2) and storage dir set.
    fn unlocked(tmp: &Tmp) -> AppState {
        let state = AppState::in_memory();
        load_or_create_cfg(&state.db.lock().unwrap()).unwrap();
        *state.kek.lock().unwrap() = Some(Zeroizing::new([7u8; 32]));
        let r = route(&state, "PUT", "/api/v1/secure-files/settings", Some(&json!({ "dir": tmp.s("store") }).to_string())).unwrap();
        assert_eq!(r.status, 200, "{}", r.body);
        state
    }

    fn import(state: &AppState, paths: &[String], dir: &str) -> Value {
        let body = json!({ "paths": paths, "dir": dir }).to_string();
        let r = route(state, "POST", "/api/v1/secure-files/files/import", Some(&body)).unwrap();
        assert_eq!(r.status, 200, "{}", r.body);
        body_json(&r)
    }

    fn list(state: &AppState) -> Value {
        let r = route(state, "GET", "/api/v1/secure-files/files", None).unwrap();
        assert_eq!(r.status, 200, "{}", r.body);
        body_json(&r)
    }

    fn progress(state: &AppState) -> Value {
        body_json(&route(state, "GET", "/api/v1/secure-files/progress", None).unwrap())
    }

    /// An object built outside the router, the way the format crate builds it.
    fn sealed(kek: &[u8; 32], p: &KdfParams, meta: &FileMeta, plaintext: &[u8]) -> Vec<u8> {
        let mut out = Vec::new();
        crypto::encrypt_stream(kek, p, meta, MAX_FILE_BYTES, plaintext, &mut out).unwrap();
        out
    }

    fn store_names(tmp: &Tmp) -> Vec<String> {
        let mut v: Vec<String> = fs::read_dir(tmp.path("store"))
            .unwrap()
            .map(|e| e.unwrap().file_name().to_string_lossy().into_owned())
            .collect();
        v.sort();
        v
    }

    #[test]
    fn locked_and_unconfigured_states() {
        let state = AppState::in_memory();
        let r = route(&state, "GET", "/api/v1/secure-files/settings", None).unwrap();
        assert_eq!(body_json(&r), json!({ "dir": null, "exists": false, "unlocked": false }));
        let r = route(&state, "GET", "/api/v1/secure-files/files", None).unwrap();
        assert_eq!(r.status, 401);
        *state.kek.lock().unwrap() = Some(Zeroizing::new([7u8; 32]));
        let r = route(&state, "GET", "/api/v1/secure-files/files", None).unwrap();
        assert_eq!(r.status, 409);
        let r = route(&state, "PUT", "/api/v1/secure-files/settings", Some(r#"{"dir":"relative"}"#)).unwrap();
        assert_eq!(r.status, 400);
    }

    #[test]
    fn progress_reports_an_idle_operation_snapshot() {
        let state = AppState::in_memory();
        let progress = body_json(&route(&state, "GET", "/api/v1/secure-files/progress", None).unwrap());

        assert_eq!(progress["id"], Value::Null);
        assert_eq!(progress["status"], "idle");
        assert_eq!(progress["done"], 0);
        assert_eq!(progress["total"], 0);
        assert_eq!(progress["filesCompleted"], Value::Null);
        assert_eq!(progress["filesTotal"], Value::Null);
    }

    #[test]
    fn import_list_preview_rename_replace_export_delete() {
        let tmp = Tmp::new("crud");
        let state = unlocked(&tmp);
        fs::write(tmp.path("config.json"), b"{\"a\":1}").unwrap();
        // Sparse: the cap is checked from metadata, so no need to write the bytes.
        fs::File::create(tmp.path("big.bin")).unwrap().set_len(MAX_FILE_BYTES + 1).unwrap();

        let res = import(&state, &[tmp.s("config.json"), tmp.s("big.bin"), tmp.s("missing.txt")], "proj");
        assert_eq!(res["imported"].as_array().unwrap().len(), 1);
        assert_eq!(res["errors"].as_array().unwrap().len(), 2);
        assert_eq!(res["errors"][0]["error"].as_str().unwrap(), too_big().1);
        let id = res["imported"][0]["id"].as_str().unwrap().to_string();
        assert_eq!(res["imported"][0]["name"], "config.json");
        assert_eq!(res["imported"][0]["dir"], "proj");
        assert_eq!(res["imported"][0]["size"], 7);

        // Physical store: one opaque file, no plaintext.
        assert_eq!(store_names(&tmp), vec![format!("{id}.mydt")]);
        let raw = fs::read(tmp.path(&format!("store/{id}.mydt"))).unwrap();
        assert!(!raw.windows(11).any(|w| w == b"config.json"));

        let l = list(&state);
        assert_eq!(l["files"].as_array().unwrap().len(), 1);
        assert_eq!(l["errors"].as_array().unwrap().len(), 0);

        assert_eq!(read_plaintext(&state, &id).unwrap(), b"{\"a\":1}");
        assert!(read_plaintext(&state, "nothex").is_err());

        // Rename + move
        let r = route(&state, "PATCH", &format!("/api/v1/secure-files/files/{id}"), Some(r#"{"name":"cfg.json","dir":"proj/sub"}"#)).unwrap();
        assert_eq!(r.status, 200, "{}", r.body);
        assert_eq!(body_json(&r)["name"], "cfg.json");
        assert_eq!(list(&state)["files"][0]["dir"], "proj/sub");
        assert_eq!(store_names(&tmp), vec![format!("{id}.mydt")], "rename keeps physical name");
        let r = route(&state, "PATCH", &format!("/api/v1/secure-files/files/{id}"), Some(r#"{"name":"../x"}"#)).unwrap();
        assert_eq!(r.status, 400);
        let r = route(&state, "PATCH", &format!("/api/v1/secure-files/files/{id}"), Some(r#"{"dir":"a/../b"}"#)).unwrap();
        assert_eq!(r.status, 400);

        // Replace content, keep name
        fs::write(tmp.path("new.json"), b"{\"a\":2}").unwrap();
        let r = route(&state, "POST", &format!("/api/v1/secure-files/files/{id}/replace"), Some(&json!({ "path": tmp.s("new.json") }).to_string())).unwrap();
        assert_eq!(r.status, 200, "{}", r.body);
        assert_eq!(body_json(&r)["name"], "cfg.json");
        assert_eq!(read_plaintext(&state, &id).unwrap(), b"{\"a\":2}");

        // Export: refused inside store, ok outside
        let r = route(&state, "POST", &format!("/api/v1/secure-files/files/{id}/export"), Some(&json!({ "path": tmp.s("store/out.json") }).to_string())).unwrap();
        assert_eq!(r.status, 400);
        let r = route(&state, "POST", &format!("/api/v1/secure-files/files/{id}/export"), Some(&json!({ "path": tmp.s("out.json") }).to_string())).unwrap();
        assert_eq!(r.status, 204, "{}", r.body);
        assert_eq!(fs::read(tmp.path("out.json")).unwrap(), b"{\"a\":2}");

        let r = route(&state, "DELETE", &format!("/api/v1/secure-files/files/{id}"), None).unwrap();
        assert_eq!(r.status, 204);
        assert!(store_names(&tmp).is_empty());
    }

    /// A storage folder written by an older build keeps working: listed,
    /// previewed, exported, and re-sealed as v2 by the first rename.
    #[test]
    fn oneshot_objects_from_older_builds_still_open() {
        let tmp = Tmp::new("v1");
        let state = unlocked(&tmp);
        let cfg = load_cfg(&state.db.lock().unwrap()).unwrap().unwrap();
        let params = cfg.kdf().unwrap();
        let meta = FileMeta { name: "old.txt".into(), dir: "".into(), size: 3, mtime: 0, imported_at: 0 };
        let object = crypto::encrypt_file_oneshot(&[7u8; 32], &params, &meta, b"old").unwrap();
        assert_eq!(object[4], crypto::VERSION_ONESHOT);
        fs::write(tmp.path(&format!("store/{}.mydt", "d".repeat(32))), object).unwrap();

        let l = list(&state);
        assert_eq!(l["errors"].as_array().unwrap().len(), 0, "{l}");
        let id = l["files"][0]["id"].as_str().unwrap().to_string();
        assert_eq!(l["files"][0]["name"], "old.txt");
        assert_eq!(read_plaintext(&state, &id).unwrap(), b"old");

        let r = route(&state, "POST", &format!("/api/v1/secure-files/files/{id}/export"), Some(&json!({ "path": tmp.s("old.txt") }).to_string())).unwrap();
        assert_eq!(r.status, 204, "{}", r.body);
        assert_eq!(fs::read(tmp.path("old.txt")).unwrap(), b"old");

        // Any write upgrades the object in place.
        let r = route(&state, "PATCH", &format!("/api/v1/secure-files/files/{id}"), Some(r#"{"name":"new.txt"}"#)).unwrap();
        assert_eq!(r.status, 200, "{}", r.body);
        let raw = fs::read(tmp.path(&format!("store/{id}.mydt"))).unwrap();
        assert_eq!(raw[4], crypto::VERSION, "rename should rewrite as the current version");
        assert_eq!(read_plaintext(&state, &id).unwrap(), b"old");
    }

    /// A payload spanning several chunks, through every path that touches one:
    /// import, rename (which re-seals the whole object through the pipe),
    /// replace and export. Byte-for-byte, so a framing bug cannot hide.
    #[test]
    fn multi_chunk_payload_survives_import_rename_replace_export() {
        let tmp = Tmp::new("chunks");
        let state = unlocked(&tmp);
        let big: Vec<u8> = (0..crypto::CHUNK_BYTES * 2 + 12_345).map(|i| (i % 251) as u8).collect();
        fs::write(tmp.path("big.bin"), &big).unwrap();

        let res = import(&state, &[tmp.s("big.bin")], "");
        assert_eq!(res["errors"].as_array().unwrap().len(), 0, "{res}");
        let id = res["imported"][0]["id"].as_str().unwrap().to_string();
        assert_eq!(res["imported"][0]["size"], big.len());

        // One tag per chunk on top of the plaintext, nothing like a second copy.
        let physical = fs::metadata(tmp.path(&format!("store/{id}.mydt"))).unwrap().len();
        let chunks = big.len().div_ceil(crypto::CHUNK_BYTES) as u64;
        assert!(physical > big.len() as u64 && physical < big.len() as u64 + 1024 + chunks * 16, "{physical}");

        let export_to = |name: &str| {
            let r = route(&state, "POST", &format!("/api/v1/secure-files/files/{id}/export"), Some(&json!({ "path": tmp.s(name) }).to_string())).unwrap();
            assert_eq!(r.status, 204, "{}", r.body);
            fs::read(tmp.path(name)).unwrap()
        };
        assert_eq!(export_to("out1.bin"), big, "export after import");

        // Rename + move: metadata is sealed ahead of the payload, so this
        // rewrites the object end to end.
        let r = route(&state, "PATCH", &format!("/api/v1/secure-files/files/{id}"), Some(r#"{"name":"renamed.bin","dir":"deep/folder"}"#)).unwrap();
        assert_eq!(r.status, 200, "{}", r.body);
        assert_eq!(body_json(&r)["name"], "renamed.bin");
        assert_eq!(body_json(&r)["size"], big.len());
        assert_eq!(export_to("out2.bin"), big, "export after rename");

        // Replace with a payload that lands on an exact chunk boundary.
        let exact: Vec<u8> = (0..crypto::CHUNK_BYTES).map(|i| (i % 97) as u8).collect();
        fs::write(tmp.path("exact.bin"), &exact).unwrap();
        let r = route(&state, "POST", &format!("/api/v1/secure-files/files/{id}/replace"), Some(&json!({ "path": tmp.s("exact.bin") }).to_string())).unwrap();
        assert_eq!(r.status, 200, "{}", r.body);
        assert_eq!(export_to("out3.bin"), exact, "export after replace");
        assert_eq!(list(&state)["totals"]["size"], exact.len());

        // Nothing in flight once the calls return, so the UI stops polling.
        // (Cancelling is covered by the `cancel_stops_*` tests, which have to
        // run alone — the counters are process-global.)
        let p = body_json(&route(&state, "GET", "/api/v1/secure-files/progress", None).unwrap());
        assert_eq!(p["total"], 0, "{p}");
    }

    #[test]
    fn folder_import_hierarchy_rename_delete() {
        let tmp = Tmp::new("folders");
        let state = unlocked(&tmp);
        fs::create_dir_all(tmp.path("src/nested")).unwrap();
        fs::write(tmp.path("src/a.txt"), b"a").unwrap();
        fs::write(tmp.path("src/nested/b.txt"), b"b").unwrap();
        fs::write(tmp.path("src/.DS_Store"), b"junk").unwrap();

        fs::create_dir_all(tmp.path("src/empty")).unwrap();
        let res = import(&state, &[tmp.s("src")], "");
        let dirs: Vec<&str> = res["imported"].as_array().unwrap().iter().map(|e| e["dir"].as_str().unwrap()).collect();
        assert_eq!(dirs, vec!["src", "src/nested"]);
        // Every walked directory is reported — including the empty one.
        let walked: Vec<&str> = res["dirs"].as_array().unwrap().iter().map(|d| d.as_str().unwrap()).collect();
        assert_eq!(walked, vec!["src", "src/empty", "src/nested"]);

        let r = route(&state, "POST", "/api/v1/secure-files/folders/rename", Some(r#"{"from":"src","to":"app"}"#)).unwrap();
        assert_eq!(body_json(&r)["updated"], 2);
        let l = list(&state);
        let dirs: Vec<&str> = l["files"].as_array().unwrap().iter().map(|e| e["dir"].as_str().unwrap()).collect();
        assert_eq!(dirs, vec!["app", "app/nested"]);

        let r = route(&state, "POST", "/api/v1/secure-files/folders/delete", Some(r#"{"dir":"app/nested"}"#)).unwrap();
        assert_eq!(body_json(&r)["deleted"], 1);
        assert_eq!(list(&state)["files"].as_array().unwrap().len(), 1);
        let r = route(&state, "POST", "/api/v1/secure-files/folders/delete", Some(r#"{"dir":""}"#)).unwrap();
        assert_eq!(r.status, 400);
    }

    #[test]
    fn foreign_and_corrupt_files_reported_not_fatal_and_tmp_cleaned() {
        let tmp = Tmp::new("errors");
        let state = unlocked(&tmp);
        fs::write(tmp.path("ok.txt"), b"ok").unwrap();
        import(&state, &[tmp.s("ok.txt")], "");

        // Foreign vault: same layout, different salt.
        let other = KdfParams { salt: [1u8; SALT_LEN], m_cost: 8, t_cost: 1, p_cost: 1 };
        let meta = FileMeta { name: "x".into(), dir: "".into(), size: 1, mtime: 0, imported_at: 0 };
        let foreign = sealed(&[7u8; 32], &other, &meta, b"x");
        fs::write(tmp.path(&format!("store/{}.mydt", "a".repeat(32))), foreign).unwrap();
        // Corrupt: truncated garbage.
        fs::write(tmp.path(&format!("store/{}.mydt", "b".repeat(32))), b"MYDTgarbage").unwrap();
        // Stale temp (interrupted rewrite of the valid file + an orphan) + unrelated file.
        let ok_id = list(&state)["files"][0]["id"].as_str().unwrap().to_string();
        fs::write(tmp.path(&format!("store/{ok_id}.mydt.tmp")), b"partial").unwrap();
        fs::write(tmp.path(&format!("store/{}.mydt.tmp", "c".repeat(32))), b"partial").unwrap();
        fs::write(tmp.path("store/readme.txt"), b"ignored").unwrap();
        // Oversized object: never read into memory, reported not fatal.
        let huge = fs::File::create(tmp.path(&format!("store/{}.mydt", "d".repeat(32)))).unwrap();
        huge.set_len(MAX_OBJECT_BYTES + 1).unwrap();

        let l = list(&state);
        assert_eq!(l["files"].as_array().unwrap().len(), 1);
        // Totals cover readable objects only; unreadable ones are reported apart.
        assert_eq!(l["totals"]["count"], 1);
        assert_eq!(l["totals"]["size"], 2);
        assert!(l["totals"]["physical"].as_u64().unwrap() > l["totals"]["size"].as_u64().unwrap());
        let errs = l["errors"].as_array().unwrap();
        assert_eq!(errs.len(), 3);
        assert!(errs.iter().any(|e| e["error"].as_str().unwrap().contains("another vault")));
        assert!(!store_names(&tmp).iter().any(|n| n.ends_with(".tmp")), "stale tmp removed");
        assert_eq!(read_plaintext(&state, &ok_id).unwrap(), b"ok", "valid file untouched by tmp cleanup");
        assert!(read_plaintext(&state, &"d".repeat(32)).is_err());
    }

    #[test]
    fn missing_storage_dir_is_409() {
        let tmp = Tmp::new("limit");
        let state = unlocked(&tmp);

        fs::remove_dir_all(tmp.path("store")).unwrap();
        let r = route(&state, "GET", "/api/v1/secure-files/settings", None).unwrap();
        assert_eq!(body_json(&r)["exists"], false);
        let r = route(&state, "GET", "/api/v1/secure-files/files", None).unwrap();
        assert_eq!(r.status, 409);
        assert!(r.body.contains("not found"));
    }

    #[test]
    fn listing_cache_tracks_external_changes_and_mutations() {
        let tmp = Tmp::new("cache");
        let state = unlocked(&tmp);
        fs::write(tmp.path("a.txt"), b"a").unwrap();
        fs::write(tmp.path("b.txt"), b"b").unwrap();
        let res = import(&state, &[tmp.s("a.txt"), tmp.s("b.txt")], "");
        let id_a = res["imported"][0]["id"].as_str().unwrap().to_string();
        assert_eq!(list(&state)["files"].as_array().unwrap().len(), 2);
        assert!(state.sf_meta.lock().unwrap().is_some(), "cache warm after list");

        // External removal is picked up by the id-set diff.
        fs::remove_file(tmp.path(&format!("store/{id_a}.mydt"))).unwrap();
        assert_eq!(list(&state)["files"].as_array().unwrap().len(), 1);

        // External addition (same salt) is decrypted incrementally.
        let cfg = load_cfg(&state.db.lock().unwrap()).unwrap().unwrap();
        let params = cfg.kdf().unwrap();
        let meta = FileMeta { name: "ext.txt".into(), dir: "".into(), size: 1, mtime: 0, imported_at: 0 };
        let obj = sealed(&[7u8; 32], &params, &meta, b"x");
        fs::write(tmp.path(&format!("store/{}.mydt", "e".repeat(32))), obj).unwrap();
        let l = list(&state);
        assert_eq!(l["files"].as_array().unwrap().len(), 2);
        assert!(l["files"].as_array().unwrap().iter().any(|f| f["name"] == "ext.txt"));

        // In-app rename is visible through the cache (write-through).
        let id_b = l["files"].as_array().unwrap().iter().find(|f| f["name"] == "b.txt").unwrap()["id"]
            .as_str().unwrap().to_string();
        route(&state, "PATCH", &format!("/api/v1/secure-files/files/{id_b}"), Some(r#"{"name":"b2.txt"}"#)).unwrap();
        assert!(list(&state)["files"].as_array().unwrap().iter().any(|f| f["name"] == "b2.txt"));

        // Lock clears the plaintext-metadata cache.
        lock(&state);
        assert!(state.sf_meta.lock().unwrap().is_none());
    }

    /// A file at the cap, encrypted for real (~90 s, ~1 GB peak RSS — ignored
    /// by default): `cargo test --lib exact_limit_accepted -- --ignored`.
    #[test]
    #[ignore]
    fn exact_limit_accepted() {
        let tmp = Tmp::new("maxsize");
        let state = unlocked(&tmp);
        // Sparse source: the bytes are zeros either way, and this keeps the
        // test about streaming rather than about filling a disk twice over.
        fs::File::create(tmp.path("max.bin")).unwrap().set_len(MAX_FILE_BYTES).unwrap();
        let res = import(&state, &[tmp.s("max.bin")], "");
        assert_eq!(res["imported"].as_array().unwrap().len(), 1, "{}", res);
        assert_eq!(res["imported"][0]["size"], MAX_FILE_BYTES);
        let id = res["imported"][0]["id"].as_str().unwrap().to_string();

        // Too big to preview, fine to export.
        assert!(read_plaintext(&state, &id).unwrap_err().contains("preview limit"));
        let r = route(&state, "POST", &format!("/api/v1/secure-files/files/{id}/export"), Some(&json!({ "path": tmp.s("out.bin") }).to_string())).unwrap();
        assert_eq!(r.status, 204, "{}", r.body);
        assert_eq!(fs::metadata(tmp.path("out.bin")).unwrap().len(), MAX_FILE_BYTES);
    }

    /// Cancel mid-import: the object never lands and the temp file goes away.
    /// The progress counters are process-global, so the cancel tests run alone:
    /// `cargo test --lib cancel_stops_ -- --ignored --test-threads=1`.
    #[test]
    #[ignore]
    fn cancel_stops_an_import() {
        let tmp = Tmp::new("cancel");
        let state = unlocked(&tmp);
        fs::File::create(tmp.path("slow.bin")).unwrap().set_len(2 * 1024 * 1024 * 1024).unwrap();

        let res = std::thread::scope(|s| {
            let importing = s.spawn(|| import(&state, &[tmp.s("slow.bin")], ""));
            while progress(&state)["done"] == 0 {
                std::hint::spin_loop();
            }
            route(&state, "POST", "/api/v1/secure-files/progress/cancel", None).unwrap();
            importing.join().unwrap()
        });

        assert_eq!(res["imported"].as_array().unwrap().len(), 0, "{res}");
        assert!(res["errors"][0]["error"].as_str().unwrap().contains("cancelled"), "{res}");
        assert!(store_names(&tmp).is_empty(), "{:?}", store_names(&tmp));
        assert_eq!(progress(&state)["total"], 0, "counters left running");
    }

    /// Cancel mid-rename: the error names the cancel, not the broken pipe the
    /// decrypt side dies of once the encryptor stops reading, and the object
    /// keeps its old name. Runs alone, like the import one above.
    #[test]
    #[ignore]
    fn cancel_stops_a_rename() {
        let tmp = Tmp::new("cancel-rename");
        let state = unlocked(&tmp);
        fs::File::create(tmp.path("big.bin")).unwrap().set_len(32 * 1024 * 1024).unwrap();
        let res = import(&state, &[tmp.s("big.bin")], "");
        let id = res["imported"][0]["id"].as_str().unwrap().to_string();

        let path = format!("/api/v1/secure-files/files/{id}");
        let r = std::thread::scope(|s| {
            let renaming = s.spawn(|| route(&state, "PATCH", &path, Some(r#"{"name":"new.bin"}"#)).unwrap());
            while progress(&state)["done"] == 0 {
                std::hint::spin_loop();
            }
            route(&state, "POST", "/api/v1/secure-files/progress/cancel", None).unwrap();
            renaming.join().unwrap()
        });

        assert!(r.body.contains("cancelled"), "{}", r.body);
        assert_eq!(store_names(&tmp), [format!("{id}.mydt")]);
        assert_eq!(list(&state)["files"][0]["name"], "big.bin");
    }

    /// A folder rename keeps the files atomically committed before cancellation
    /// and leaves the current and remaining entries in their original folder.
    #[test]
    #[ignore]
    fn cancel_stops_a_folder_rename_between_files() {
        let tmp = Tmp::new("cancel-folder-rename");
        let state = unlocked(&tmp);
        let mut paths = Vec::new();
        for index in 0..3 {
            let name = format!("large-{index}.bin");
            fs::File::create(tmp.path(&name)).unwrap().set_len(32 * 1024 * 1024).unwrap();
            paths.push(tmp.s(&name));
        }
        assert_eq!(import(&state, &paths, "src")["imported"].as_array().unwrap().len(), 3);

        let response = std::thread::scope(|scope| {
            let renaming = scope.spawn(|| route(&state, "POST", "/api/v1/secure-files/folders/rename", Some(r#"{"from":"src","to":"app"}"#)).unwrap());
            loop {
                let current = progress(&state);
                if current["filesCompleted"].as_u64().unwrap_or(0) >= 1 {
                    route(&state, "POST", "/api/v1/secure-files/progress/cancel", None).unwrap();
                    break;
                }
                std::hint::spin_loop();
            }
            renaming.join().unwrap()
        });

        assert_eq!(response.status, 409, "{}", response.body);
        assert!(response.body.contains("cancelled"), "{}", response.body);
        let files = list(&state)["files"].as_array().unwrap().to_vec();
        assert!(files.iter().any(|file| file["dir"] == "app"), "{files:?}");
        assert!(files.iter().any(|file| file["dir"] == "src"), "{files:?}");
        assert!(!store_names(&tmp).iter().any(|name| name.ends_with(TMP_EXT)));
    }

    /// Manual scale check: `cargo test --lib scale_smoke_10k -- --ignored --nocapture`.
    #[test]
    #[ignore]
    fn scale_smoke_10k() {
        let tmp = Tmp::new("scale");
        let state = unlocked(&tmp);
        fs::create_dir_all(tmp.path("src")).unwrap();
        for i in 0..10_000 {
            fs::write(tmp.path(&format!("src/f{i:05}.txt")), format!("payload {i}")).unwrap();
        }
        let t0 = std::time::Instant::now();
        let res = import(&state, &[tmp.s("src")], "");
        let t_import = t0.elapsed();
        assert_eq!(res["imported"].as_array().unwrap().len(), 10_000);

        *state.sf_meta.lock().unwrap() = None; // force a cold scan
        let t0 = std::time::Instant::now();
        assert_eq!(list(&state)["files"].as_array().unwrap().len(), 10_000);
        let t_cold = t0.elapsed();
        let t0 = std::time::Instant::now();
        list(&state);
        let t_warm = t0.elapsed();
        println!("10k files: import {t_import:?}, cold list {t_cold:?}, warm list {t_warm:?}");
    }

    #[test]
    fn change_storage_dir_moves_files() {
        let tmp = Tmp::new("migrate");
        let state = unlocked(&tmp);
        fs::write(tmp.path("f.txt"), b"f").unwrap();
        let id = import(&state, &[tmp.s("f.txt")], "")["imported"][0]["id"].as_str().unwrap().to_string();

        let r = route(&state, "PUT", "/api/v1/secure-files/settings", Some(&json!({ "dir": tmp.s("store2") }).to_string())).unwrap();
        assert_eq!(body_json(&r)["moved"], 1);
        assert!(store_names(&tmp).is_empty());
        assert!(tmp.path(&format!("store2/{id}.mydt")).exists());
        assert_eq!(read_plaintext(&state, &id).unwrap(), b"f");
        let r = route(&state, "GET", "/api/v1/secure-files/settings", None).unwrap();
        assert_eq!(body_json(&r)["dir"], tmp.s("store2"));
    }

    #[test]
    fn unlock_lock_roundtrip_with_real_kdf() {
        let tmp = Tmp::new("unlock");
        let state = AppState::in_memory();
        let r = route(&state, "POST", "/api/v1/auth/master-vault/unlock", Some(r#"{"password":"hunter2"}"#)).unwrap();
        assert_eq!(r.status, 200, "{}", r.body);
        assert!(state.kek.lock().unwrap().is_some());
        let first = **state.kek.lock().unwrap().as_ref().unwrap();

        route(&state, "PUT", "/api/v1/secure-files/settings", Some(&json!({ "dir": tmp.s("store") }).to_string())).unwrap();
        fs::write(tmp.path("f.txt"), b"f").unwrap();
        let id = import(&state, &[tmp.s("f.txt")], "")["imported"][0]["id"].as_str().unwrap().to_string();

        let r = route(&state, "POST", "/api/v1/auth/master-vault/lock", None).unwrap();
        assert_eq!(r.status, 204);
        assert!(state.kek.lock().unwrap().is_none());
        assert_eq!(route(&state, "GET", "/api/v1/secure-files/files", None).unwrap().status, 401);

        // Same password → same KEK (salt persisted) → files still open.
        route(&state, "POST", "/api/v1/auth/master-vault/unlock", Some(r#"{"password":"hunter2"}"#)).unwrap();
        assert_eq!(**state.kek.lock().unwrap().as_ref().unwrap(), first);
        assert_eq!(read_plaintext(&state, &id).unwrap(), b"f");

        // Different password → files report tamper/auth failure, not a crash.
        route(&state, "POST", "/api/v1/auth/master-vault/unlock", Some(r#"{"password":"wrong"}"#)).unwrap();
        assert_eq!(list(&state)["errors"].as_array().unwrap().len(), 1);
    }
}
