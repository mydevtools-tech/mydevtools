//! `mydt` — create, inspect and open `.mydt` files from the shell.
//!
//! Password comes from `$MYDT_PASSWORD` or an interactive prompt. Files
//! written with `--params-from <existing.mydt>` share that file's salt and so
//! open inside the same MyDevTools storage folder.

use std::collections::HashMap;
use std::fs;
use std::io::Read;
use std::path::{Path, PathBuf};
use std::process;

use mydt::{CryptoError, FileMeta, KdfParams, HEADER_LEN, MAX_FILE_BYTES, MAX_OBJECT_BYTES, SALT_LEN};
use zeroize::Zeroizing;

const USAGE: &str = "\
mydt — MyDevTools encrypted file format (.mydt)

USAGE
  mydt encrypt <file> [-o <out.mydt>] [--dir <logical/folder>] [--params-from <other.mydt>]
  mydt decrypt <file.mydt> [-o <out> | -o -] [--force]
  mydt info    <file.mydt> [--unlock]
  mydt ls      <folder>

Password: $MYDT_PASSWORD, otherwise prompted.
`encrypt` names the output <32 random hex>.mydt like the desktop app does.
`--params-from` reuses another file's salt/KDF params so the result opens in the
same Secure Files storage folder.";

fn main() {
    if let Err(e) = run() {
        eprintln!("error: {e}");
        process::exit(1);
    }
}

struct Args {
    positional: Vec<String>,
    opts: HashMap<String, String>,
    flags: Vec<String>,
}

fn parse_args(raw: &[String], with_value: &[&str]) -> Args {
    let mut a = Args { positional: Vec::new(), opts: HashMap::new(), flags: Vec::new() };
    let mut it = raw.iter();
    while let Some(arg) = it.next() {
        if let Some(name) = arg.strip_prefix('-') {
            let name = name.trim_start_matches('-');
            if with_value.contains(&name) {
                if let Some(v) = it.next() {
                    a.opts.insert(name.to_string(), v.clone());
                }
            } else {
                a.flags.push(name.to_string());
            }
        } else {
            a.positional.push(arg.clone());
        }
    }
    a
}

fn run() -> Result<(), String> {
    let raw: Vec<String> = std::env::args().skip(1).collect();
    match raw.first().map(String::as_str) {
        Some("encrypt") => encrypt(parse_args(&raw[1..], &["o", "dir", "params-from"])),
        Some("decrypt") => decrypt(parse_args(&raw[1..], &["o"])),
        Some("info") => info(parse_args(&raw[1..], &[])),
        Some("ls") => ls(parse_args(&raw[1..], &[])),
        _ => {
            eprintln!("{USAGE}");
            process::exit(2)
        }
    }
}

fn password() -> Result<Zeroizing<String>, String> {
    if let Ok(p) = std::env::var("MYDT_PASSWORD") {
        return Ok(Zeroizing::new(p));
    }
    rpassword::prompt_password("Password: ").map(Zeroizing::new).map_err(|e| e.to_string())
}

/// Header + sealed metadata only. Everything but `decrypt` works off this, so
/// inspecting a folder of multi-GB objects stays a few KB of reads.
fn read_head(path: &Path) -> Result<Vec<u8>, String> {
    let fail = |e: std::io::Error| format!("{}: {e}", path.display());
    let md = fs::metadata(path).map_err(fail)?;
    if md.len() > MAX_OBJECT_BYTES {
        return Err(format!("{}: larger than any valid .mydt object", path.display()));
    }
    let mut f = fs::File::open(path).map_err(fail)?;
    let mut head = vec![0u8; HEADER_LEN];
    f.read_exact(&mut head).map_err(|_| format!("{}: not a .mydt file", path.display()))?;
    let n = mydt::meta_len(&head).map_err(|e| format!("{}: {e}", path.display()))?;
    Read::by_ref(&mut f).take(n as u64).read_to_end(&mut head).map_err(fail)?;
    Ok(head)
}

fn hex(bytes: &[u8]) -> String {
    bytes.iter().map(|b| format!("{b:02x}")).collect()
}

fn positional<'a>(a: &'a Args, what: &str) -> Result<&'a Path, String> {
    a.positional.first().map(Path::new).ok_or_else(|| format!("missing <{what}>\n\n{USAGE}"))
}

fn mtime_ms(md: &fs::Metadata) -> i64 {
    md.modified()
        .ok()
        .and_then(|t| t.duration_since(std::time::UNIX_EPOCH).ok())
        .map(|d| d.as_millis() as i64)
        .unwrap_or(0)
}

fn now_ms() -> i64 {
    std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .map(|d| d.as_millis() as i64)
        .unwrap_or(0)
}

fn encrypt(a: Args) -> Result<(), String> {
    let src = positional(&a, "file")?;
    let md = fs::metadata(src).map_err(|e| format!("{}: {e}", src.display()))?;
    if md.len() > MAX_FILE_BYTES {
        return Err(format!("file exceeds the {} MB limit", MAX_FILE_BYTES / 1024 / 1024));
    }
    let name = src
        .file_name()
        .and_then(|n| n.to_str())
        .ok_or("source has no usable file name")?
        .to_string();
    let params = match a.opts.get("params-from") {
        Some(p) => mydt::kdf_params(&read_head(Path::new(p))?).map_err(|e| e.to_string())?,
        None => KdfParams::generate(),
    };
    let meta = FileMeta {
        name,
        dir: a.opts.get("dir").cloned().unwrap_or_default().trim_matches('/').to_string(),
        size: md.len(),
        mtime: mtime_ms(&md),
        imported_at: now_ms(),
    };
    let kek = mydt::derive_kek(password()?.as_bytes(), &params).map_err(|e| e.to_string())?;
    let out = match a.opts.get("o") {
        Some(o) => PathBuf::from(o),
        None => PathBuf::from(format!("{}.mydt", hex(&mydt::random::<16>()))),
    };
    let reader = fs::File::open(src).map_err(|e| format!("{}: {e}", src.display()))?;
    let writer = fs::File::create(&out).map_err(|e| format!("{}: {e}", out.display()))?;
    mydt::encrypt_stream(
        &kek,
        &params,
        &meta,
        MAX_FILE_BYTES,
        std::io::BufReader::new(reader),
        std::io::BufWriter::new(writer),
    )
    .map_err(|e| {
        let _ = fs::remove_file(&out);
        e.to_string()
    })?;
    println!("{}", out.display());
    Ok(())
}

fn decrypt(a: Args) -> Result<(), String> {
    let src = positional(&a, "file.mydt")?;
    let head = read_head(src)?;
    let params = mydt::kdf_params(&head).map_err(|e| e.to_string())?;
    let kek = mydt::derive_kek(password()?.as_bytes(), &params).map_err(|e| e.to_string())?;
    // The destination name can come from the sealed metadata, so read that
    // before streaming — it costs one extra pass over the header.
    let meta = mydt::read_meta(&kek, &params.salt, &head).map_err(|e| e.to_string())?;
    let object = fs::File::open(src).map(std::io::BufReader::new).map_err(|e| format!("{}: {e}", src.display()))?;

    match a.opts.get("o").map(String::as_str) {
        Some("-") => {
            mydt::decrypt_stream(&kek, &params.salt, object, std::io::stdout().lock()).map_err(|e| e.to_string())?;
            Ok(())
        }
        other => {
            let out = other.map(PathBuf::from).unwrap_or_else(|| PathBuf::from(&meta.name));
            if out.exists() && !a.flags.iter().any(|f| f == "force") {
                return Err(format!("{} exists (use --force to overwrite)", out.display()));
            }
            let dst = fs::File::create(&out).map_err(|e| format!("{}: {e}", out.display()))?;
            // A failed decrypt leaves a partial file behind, and it is
            // plaintext — remove it rather than hand back half a secret.
            mydt::decrypt_stream(&kek, &params.salt, object, std::io::BufWriter::new(dst)).map_err(|e| {
                let _ = fs::remove_file(&out);
                e.to_string()
            })?;
            eprintln!("{} -> {}", src.display(), out.display());
            Ok(())
        }
    }
}

fn info(a: Args) -> Result<(), String> {
    let src = positional(&a, "file.mydt")?;
    let head = read_head(src)?;
    let params = mydt::kdf_params(&head).map_err(|e| e.to_string())?;
    let meta_len = mydt::meta_len(&head).map_err(|e| e.to_string())?;
    println!("file:      {}", src.display());
    println!("format:    MYDT v{}", head[4]);
    println!("size:      {} bytes", fs::metadata(src).map(|m| m.len()).unwrap_or(0));
    println!("salt:      {}", hex(&params.salt));
    println!("argon2id:  m={} KiB t={} p={}", params.m_cost, params.t_cost, params.p_cost);
    println!("meta_len:  {meta_len}");
    if a.flags.iter().any(|f| f == "unlock") || std::env::var_os("MYDT_PASSWORD").is_some() {
        let kek = mydt::derive_kek(password()?.as_bytes(), &params).map_err(|e| e.to_string())?;
        let m = mydt::read_meta(&kek, &params.salt, &head).map_err(|e| e.to_string())?;
        println!("name:      {}", m.name);
        println!("dir:       {}", if m.dir.is_empty() { "/" } else { &m.dir });
        println!("plaintext: {} bytes", m.size);
        println!("mtime:     {}", m.mtime);
        println!("imported:  {}", m.imported_at);
    }
    Ok(())
}

fn ls(a: Args) -> Result<(), String> {
    let dir = positional(&a, "folder")?;
    let pw = password()?;
    // One Argon2 per distinct salt, not per file.
    let mut keks: HashMap<[u8; SALT_LEN], Zeroizing<[u8; 32]>> = HashMap::new();
    let mut entries: Vec<PathBuf> = fs::read_dir(dir)
        .map_err(|e| format!("{}: {e}", dir.display()))?
        .filter_map(|e| e.ok().map(|e| e.path()))
        .filter(|p| p.extension().is_some_and(|x| x == "mydt"))
        .collect();
    entries.sort();
    let mut rows = Vec::new();
    for path in entries {
        let id = path.file_stem().and_then(|s| s.to_str()).unwrap_or("?").to_string();
        let res = read_head(&path).and_then(|bytes| {
            let params = mydt::kdf_params(&bytes).map_err(|e| e.to_string())?;
            let kek = match keks.get(&params.salt) {
                Some(k) => k.clone(),
                None => {
                    let k = mydt::derive_kek(pw.as_bytes(), &params).map_err(|e| e.to_string())?;
                    keks.insert(params.salt, k.clone());
                    k
                }
            };
            mydt::read_meta(&kek, &params.salt, &bytes).map_err(|e: CryptoError| e.to_string())
        });
        match res {
            Ok(m) => rows.push((m.dir, m.name, m.size, id)),
            Err(e) => eprintln!("{id}: {e}"),
        }
    }
    rows.sort();
    for (dir, name, size, id) in rows {
        let logical = if dir.is_empty() { name } else { format!("{dir}/{name}") };
        println!("{size:>10}  {id}  {logical}");
    }
    Ok(())
}
