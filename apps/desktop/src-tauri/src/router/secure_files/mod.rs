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

fn bad(msg: &str) -> Fail {
    Fail(400, msg.into())
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

/// Write to `<id>.mydt.tmp`, then rename over the final name. `durable` adds
/// a per-file fsync — right for single-file ops that replace the only copy;
/// bulk import skips it (one directory fsync per batch) since a crash there
/// only yields an unreadable object flagged by the next listing, while the
/// source files still exist.
fn write_atomic(dir: &Path, id: &str, bytes: &[u8], durable: bool) -> std::io::Result<()> {
    let tmp = dir.join(format!("{id}.{TMP_EXT}"));
    let mut f = fs::File::create(&tmp)?;
    std::io::Write::write_all(&mut f, bytes)?;
    if durable {
        f.sync_all()?;
    }
    drop(f);
    fs::rename(&tmp, object_path(dir, id))
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

fn read_entry_full(c: &Ctx, id: &str) -> Fallible<(FileMeta, Zeroizing<Vec<u8>>)> {
    let path = object_path(&c.dir, id);
    // Size gate before reading: a hostile multi-GB object must not be slurped.
    if fs::metadata(&path)?.len() > MAX_OBJECT_BYTES {
        return Err(CryptoError::Format.into());
    }
    let bytes = fs::read(path)?;
    Ok(crypto::decrypt_file(&c.kek, &c.params.salt, &bytes)?)
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

fn encrypt_and_store(c: &Ctx, meta: &FileMeta, plaintext: &[u8], durable: bool) -> Fallible<Entry> {
    let id = new_id();
    let bytes = crypto::encrypt_file(&c.kek, &c.params, meta, plaintext)?;
    write_atomic(&c.dir, &id, &bytes, durable)?;
    Ok(Entry { id, meta: meta.clone(), physical: bytes.len() as u64 })
}

/// Storage figures for the dashboard, derived from the folder listing alone.
///
/// Nothing is decrypted, so these are available with the vault locked — the
/// object count and the bytes the folder occupies are properties of the
/// container files, not of their contents. Plaintext sizes and names stay
/// behind the KEK; `unlocked` tells the dashboard which of the two it is
/// showing.
pub fn storage_stats(state: &AppState) -> Value {
    let unlocked = state.kek.lock().unwrap().is_some();
    let dir = load_cfg(&state.db.lock().unwrap())
        .ok()
        .flatten()
        .and_then(|c| c.dir);

    let (mut count, mut physical, mut last_modified) = (0u64, 0u64, 0i64);
    if let Some(entries) = dir.as_deref().map(Path::new).and_then(|d| fs::read_dir(d).ok()) {
        for ent in entries.flatten() {
            let path = ent.path();
            let is_object = path
                .file_name()
                .and_then(|n| n.to_str())
                .and_then(|n| n.strip_suffix(&format!(".{EXT}")))
                .is_some_and(|id| valid_id(id).is_ok());
            if !is_object {
                continue; // stray file, or a `.mydt.tmp` left by an interrupted write
            }
            let Ok(md) = ent.metadata() else { continue };
            count += 1;
            physical += md.len();
            last_modified = last_modified.max(mtime_ms(&md));
        }
    }

    json!({
        "count": count,
        "physicalBytes": physical,
        "lastModifiedAt": last_modified,
        "configured": dir.is_some(),
        "unlocked": unlocked,
    })
}

fn mtime_ms(md: &fs::Metadata) -> i64 {
    md.modified()
        .ok()
        .and_then(|t| t.duration_since(std::time::UNIX_EPOCH).ok())
        .map(|d| d.as_millis() as i64)
        .unwrap_or_else(now_ms)
}

fn import_file(c: &Ctx, src: &Path, logical_dir: &str, durable: bool) -> Fallible<Entry> {
    let md = fs::metadata(src)?;
    if md.len() > MAX_FILE_BYTES {
        return Err(Fail(413, format!("file exceeds the {} MB limit", MAX_FILE_BYTES / 1024 / 1024)));
    }
    let name = src
        .file_name()
        .and_then(|n| n.to_str())
        .ok_or_else(|| bad("invalid source file name"))?
        .to_string();
    valid_name(&name)?;
    let plaintext = Zeroizing::new(fs::read(src)?);
    if plaintext.len() as u64 > MAX_FILE_BYTES {
        // File grew between the metadata check and the read.
        return Err(Fail(413, format!("file exceeds the {} MB limit", MAX_FILE_BYTES / 1024 / 1024)));
    }
    let meta = FileMeta {
        name,
        dir: logical_dir.to_string(),
        size: plaintext.len() as u64,
        mtime: mtime_ms(&md),
        imported_at: now_ms(),
    };
    encrypt_and_store(c, &meta, &plaintext, durable)
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
fn import_batch(c: &Ctx, targets: &[(PathBuf, String)], imported: &mut Vec<Entry>, errors: &mut Vec<Value>) {
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
                        match import_file(c, src, logical, false) {
                            Ok(e) => ok.push(e),
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

/// Decrypt, mutate metadata, re-encrypt (fresh DEK/nonces), atomic replace.
fn rewrite(c: &Ctx, id: &str, f: impl FnOnce(&mut FileMeta)) -> Fallible<Entry> {
    let (mut meta, plaintext) = read_entry_full(c, id)?;
    f(&mut meta);
    let bytes = crypto::encrypt_file(&c.kek, &c.params, &meta, &plaintext)?;
    write_atomic(&c.dir, id, &bytes, true)?;
    Ok(Entry { id: id.to_string(), meta, physical: bytes.len() as u64 })
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
            let mut imported = Vec::new();
            import_batch(&c, &targets, &mut imported, &mut errors);
            for e in &imported {
                cache_put(state, e);
            }
            ok(&json!({ "imported": imported, "errors": errors, "dirs": dirs }))
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
            let mut updated = 0;
            for e in files.iter().filter(|e| under(&e.meta.dir, &from)) {
                let suffix = e.meta.dir[from.len()..].to_string(); // "" or "/sub"
                let renamed = rewrite(&c, &e.id, |m| m.dir = format!("{to}{suffix}"))?;
                cache_put(state, &renamed);
                updated += 1;
            }
            ok(&json!({ "updated": updated }))
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
                    let e = rewrite(&c, id, |m| {
                        if let Some(n) = name {
                            m.name = n;
                        }
                        if let Some(d) = dir {
                            m.dir = d;
                        }
                    })?;
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
                        return Err(Fail(413, format!("file exceeds the {} MB limit", MAX_FILE_BYTES / 1024 / 1024)));
                    }
                    let c = ctx(state)?;
                    let (mut meta, _) = read_entry_full(&c, id)?;
                    let plaintext = Zeroizing::new(fs::read(src)?);
                    if plaintext.len() as u64 > MAX_FILE_BYTES {
                        return Err(Fail(413, format!("file exceeds the {} MB limit", MAX_FILE_BYTES / 1024 / 1024)));
                    }
                    meta.size = plaintext.len() as u64;
                    meta.mtime = mtime_ms(&md);
                    let bytes = crypto::encrypt_file(&c.kek, &c.params, &meta, &plaintext)?;
                    write_atomic(&c.dir, id, &bytes, true)?;
                    let e = Entry { id: id.to_string(), meta, physical: bytes.len() as u64 };
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
                    let (_, plaintext) = read_entry_full(&c, id)?;
                    fs::write(dest, &*plaintext)?;
                    Ok(ApiResponse::empty(204))
                }
                _ => Err(Fail(404, "Not found".into())),
            }
        }
    }
}

/// Plaintext bytes for the raw-binary `secure_file_read` command (preview).
pub fn read_plaintext(state: &AppState, id: &str) -> std::result::Result<Vec<u8>, String> {
    let run = || -> Fallible<Vec<u8>> {
        valid_id(id)?;
        let c = ctx(state)?;
        let (_, mut plaintext) = read_entry_full(&c, id)?;
        // Handed to the IPC layer, which owns (and does not zeroize) the buffer.
        Ok(std::mem::take(&mut *plaintext))
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

    fn store_names(tmp: &Tmp) -> Vec<String> {
        let mut v: Vec<String> = fs::read_dir(tmp.path("store"))
            .unwrap()
            .map(|e| e.unwrap().file_name().to_string_lossy().into_owned())
            .collect();
        v.sort();
        v
    }

    #[test]
    fn storage_stats_reads_the_folder_without_the_kek() {
        let unset = storage_stats(&AppState::in_memory());
        assert_eq!(unset["count"], 0);
        assert_eq!(unset["configured"], false);
        assert_eq!(unset["unlocked"], false);

        let tmp = Tmp::new("stats");
        let state = unlocked(&tmp);
        fs::write(tmp.path("a.txt"), b"hello").unwrap();
        fs::write(tmp.path("b.txt"), vec![0u8; 4096]).unwrap();
        import(&state, &[tmp.s("a.txt"), tmp.s("b.txt")], "");
        // Junk in the storage folder must not be counted as an object.
        fs::write(tmp.path("store/notes.txt"), b"stray").unwrap();
        fs::write(tmp.path("store/deadbeef.mydt.tmp"), b"interrupted write").unwrap();

        let s = storage_stats(&state);
        assert_eq!(s["count"], 2);
        assert_eq!(s["configured"], true);
        assert_eq!(s["unlocked"], true);
        assert!(s["lastModifiedAt"].as_i64().unwrap() > 0);
        // Containers hold the plaintext plus per-object overhead.
        let physical = s["physicalBytes"].as_u64().unwrap();
        assert!(physical > 5 + 4096, "physical {physical} should exceed the plaintext bytes");
        assert_eq!(physical, list(&state)["totals"]["physical"].as_u64().unwrap());

        // Same numbers with the vault locked — nothing here is decrypted.
        *state.kek.lock().unwrap() = None;
        let locked = storage_stats(&state);
        assert_eq!(locked["count"], 2);
        assert_eq!(locked["physicalBytes"], physical);
        assert_eq!(locked["unlocked"], false);
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
    fn import_list_preview_rename_replace_export_delete() {
        let tmp = Tmp::new("crud");
        let state = unlocked(&tmp);
        fs::write(tmp.path("config.json"), b"{\"a\":1}").unwrap();
        fs::write(tmp.path("big.bin"), vec![0u8; (MAX_FILE_BYTES + 1) as usize]).unwrap();

        let res = import(&state, &[tmp.s("config.json"), tmp.s("big.bin"), tmp.s("missing.txt")], "proj");
        assert_eq!(res["imported"].as_array().unwrap().len(), 1);
        assert_eq!(res["errors"].as_array().unwrap().len(), 2);
        assert!(res["errors"][0]["error"].as_str().unwrap().contains("20 MB"));
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
        let foreign = crypto::encrypt_file(&[7u8; 32], &other, &meta, b"x").unwrap();
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
    fn exact_limit_accepted_and_missing_storage_dir_is_409() {
        let tmp = Tmp::new("limit");
        let state = unlocked(&tmp);
        fs::write(tmp.path("max.bin"), vec![1u8; MAX_FILE_BYTES as usize]).unwrap();
        let res = import(&state, &[tmp.s("max.bin")], "");
        assert_eq!(res["imported"].as_array().unwrap().len(), 1, "{}", res);
        assert_eq!(res["imported"][0]["size"], MAX_FILE_BYTES);

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
        let obj = crypto::encrypt_file(&[7u8; 32], &params, &meta, b"x").unwrap();
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
