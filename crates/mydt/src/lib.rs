//! MyDevTools `.mydt` container — pure crypto/format, no I/O, no DB.
//! Spec: `docs/MYDT_FORMAT.md` in the MyDevTools repository.
//!
//! Byte layout (ints u32 LE):
//! ```text
//! off    len  field
//! 0      4    magic "MYDT"
//! 4      1    version — 1 = one-shot payload, 2 = chunked payload
//! 5      16   argon2 salt
//! 21     4    m_cost (KiB)
//! 25     4    t_cost
//! 29     4    p_cost
//! 33     24   dek_nonce
//! 57     48   wrapped DEK = XChaCha(KEK, dek_nonce, DEK[32], aad = bytes[0..33])
//! 105    24   meta_nonce
//! 129    4    meta_len (ciphertext incl. 16-byte tag)
//! 133    N    meta ct    = XChaCha(DEK, meta_nonce, metaJSON, aad = bytes[0..133])
//! ```
//! Everything above is identical in both versions; only the payload differs.
//!
//! v1 — the whole payload in one seal, so writing or reading it needs the whole
//! plaintext in memory. Still read, never written:
//! ```text
//! 133+N  24   payload_nonce
//! 157+N  ...  payload ct = XChaCha(DEK, payload_nonce, plaintext, aad = bytes[0..133])
//! ```
//!
//! v2 — the payload in `CHUNK_BYTES` chunks, each its own AEAD message, so a
//! multi-GB file streams through a fixed-size buffer:
//! ```text
//! 133+N  19   stream nonce prefix
//! 152+N  ...  chunk ct = XChaCha(DEK, prefix||counter_be32||last, chunk, aad = bytes[0..133])
//! ```
//! That nonce layout is the STREAM construction (Hoang-Reyhanitabar-Rogaway-
//! Vizár), byte-compatible with `aead::stream::EncryptorBE32`: the counter
//! pins each chunk's position and the trailing flag marks the final one, so a
//! dropped, duplicated or reordered chunk — or a truncated file — fails to
//! authenticate instead of yielding short plaintext.
//!
//! Every file carries its own salt + KDF params, so a lone `.mydt` is openable
//! with just the password. All files of one vault share the salt, so the KEK
//! is derived once per unlock and listing never runs Argon2.

use std::io::{Read, Write};

use argon2::{Algorithm, Argon2, Params, Version};
use chacha20poly1305::aead::{Aead, KeyInit, Payload};
use chacha20poly1305::{XChaCha20Poly1305, XNonce};
use serde::{Deserialize, Serialize};
use zeroize::Zeroizing;

pub const MAGIC: &[u8; 4] = b"MYDT";
/// One-shot payload. Read for files written before streaming; never written.
pub const VERSION_ONESHOT: u8 = 1;
/// Chunked payload — what every write produces.
pub const VERSION: u8 = 2;
pub const SALT_LEN: usize = 16;
pub const NONCE_LEN: usize = 24;
const TAG_LEN: usize = 16;
const KEY_LEN: usize = 32;
/// End of the KDF block (magic + version + salt + 3 params) — AAD for the DEK wrap.
const KDF_END: usize = 4 + 1 + SALT_LEN + 12;
const DEK_NONCE_AT: usize = KDF_END;
const DEK_AT: usize = DEK_NONCE_AT + NONCE_LEN;
const META_NONCE_AT: usize = DEK_AT + KEY_LEN + TAG_LEN;
const META_LEN_AT: usize = META_NONCE_AT + NONCE_LEN;
/// Fixed header size; metadata ciphertext starts here.
pub const HEADER_LEN: usize = META_LEN_AT + 4;
/// Payload cap. Streaming keeps memory flat, so this is a product decision
/// rather than a memory budget.
pub const MAX_FILE_BYTES: u64 = 5 * 1024 * 1024 * 1024;
/// Cap for a v1 payload, which can only be decrypted whole. No v1 file can
/// exceed it — it was the write cap for as long as v1 was written.
pub const MAX_ONESHOT_FILE_BYTES: u64 = 512 * 1024 * 1024;
/// Plaintext per chunk. Changing it needs a version bump: readers frame the
/// payload by this size, and a mismatch reads as a failed authentication.
pub const CHUNK_BYTES: usize = 1024 * 1024;
/// Random per file; the remaining 5 nonce bytes are the chunk counter + last flag.
const STREAM_PREFIX_LEN: usize = NONCE_LEN - 5;
/// Metadata JSON is a few hundred bytes; anything bigger is not ours.
pub const MAX_META_BYTES: usize = 64 * 1024;
/// Largest `.mydt` object that can exist: payload cap + header + metadata cap
/// + nonces + one tag per chunk. Guards against a hostile oversized file.
pub const MAX_OBJECT_BYTES: u64 = MAX_FILE_BYTES
    + (HEADER_LEN + MAX_META_BYTES + NONCE_LEN) as u64
    + (MAX_FILE_BYTES / CHUNK_BYTES as u64 + 1) * TAG_LEN as u64;

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub struct KdfParams {
    pub salt: [u8; SALT_LEN],
    pub m_cost: u32,
    pub t_cost: u32,
    pub p_cost: u32,
}

impl KdfParams {
    // ~0.3–0.8 s on a 2020+ laptop; runs once per unlock. Stored per file, so
    // changing these only affects new writes.
    pub const DEFAULT_M_COST: u32 = 65536;
    pub const DEFAULT_T_COST: u32 = 3;
    pub const DEFAULT_P_COST: u32 = 1;

    pub fn generate() -> Self {
        Self {
            salt: random(),
            m_cost: Self::DEFAULT_M_COST,
            t_cost: Self::DEFAULT_T_COST,
            p_cost: Self::DEFAULT_P_COST,
        }
    }
}

#[derive(Serialize, Deserialize, Clone, Debug, PartialEq, Eq)]
pub struct FileMeta {
    pub name: String,
    /// Logical folder, `"a/b"` or `""` for root.
    pub dir: String,
    pub size: u64,
    /// Source file mtime, epoch ms.
    pub mtime: i64,
    #[serde(rename = "importedAt")]
    pub imported_at: i64,
}

#[derive(Debug, thiserror::Error)]
pub enum CryptoError {
    #[error("not a .mydt file")]
    Format,
    #[error("unsupported .mydt version {0}")]
    Version(u8),
    #[error("file belongs to another vault")]
    ForeignVault,
    // Wrong password and tampering are indistinguishable by design (the DEK
    // unwrap simply fails), so say both.
    #[error("authentication failed: wrong password, or file is tampered or corrupt")]
    Auth,
    #[error("key derivation failed: {0}")]
    Kdf(String),
    #[error("payload exceeds the size limit")]
    TooLarge,
}

type Result<T> = std::result::Result<T, CryptoError>;

/// Streaming touches the filesystem through the caller's reader/writer, so it
/// fails for I/O reasons as well as crypto ones.
#[derive(Debug, thiserror::Error)]
pub enum StreamError {
    #[error(transparent)]
    Crypto(#[from] CryptoError),
    #[error(transparent)]
    Io(#[from] std::io::Error),
}

pub type StreamResult<T> = std::result::Result<T, StreamError>;

pub fn random<const N: usize>() -> [u8; N] {
    let mut buf = [0u8; N];
    getrandom::fill(&mut buf).expect("OS entropy source unavailable");
    buf
}

pub fn derive_kek(password: &[u8], p: &KdfParams) -> Result<Zeroizing<[u8; KEY_LEN]>> {
    let params = Params::new(p.m_cost, p.t_cost, p.p_cost, Some(KEY_LEN))
        .map_err(|e| CryptoError::Kdf(e.to_string()))?;
    let mut out = Zeroizing::new([0u8; KEY_LEN]);
    Argon2::new(Algorithm::Argon2id, Version::V0x13, params)
        .hash_password_into(password, &p.salt, out.as_mut())
        .map_err(|e| CryptoError::Kdf(e.to_string()))?;
    Ok(out)
}

fn cipher(key: &[u8; KEY_LEN]) -> XChaCha20Poly1305 {
    XChaCha20Poly1305::new_from_slice(key).expect("32-byte key")
}

fn seal(key: &[u8; KEY_LEN], nonce: &[u8; NONCE_LEN], msg: &[u8], aad: &[u8]) -> Vec<u8> {
    cipher(key)
        .encrypt(&XNonce::from(*nonce), Payload { msg, aad })
        .expect("XChaCha20-Poly1305 encrypt is infallible for in-memory buffers")
}

fn open(key: &[u8; KEY_LEN], nonce: &[u8; NONCE_LEN], ct: &[u8], aad: &[u8]) -> Result<Zeroizing<Vec<u8>>> {
    cipher(key)
        .decrypt(&XNonce::from(*nonce), Payload { msg: ct, aad })
        .map(Zeroizing::new)
        .map_err(|_| CryptoError::Auth)
}

/// Header + sealed metadata for `version`, plus the fresh DEK the payload is
/// sealed with. Identical in both versions — only what follows differs.
fn build_head(
    kek: &[u8; KEY_LEN],
    p: &KdfParams,
    meta: &FileMeta,
    version: u8,
) -> Result<(Vec<u8>, Zeroizing<[u8; KEY_LEN]>)> {
    let meta_json = Zeroizing::new(serde_json::to_vec(meta).map_err(|_| CryptoError::Format)?);
    let dek = Zeroizing::new(random::<KEY_LEN>());
    let dek_nonce = random::<NONCE_LEN>();
    let meta_nonce = random::<NONCE_LEN>();

    let mut out = Vec::with_capacity(HEADER_LEN + meta_json.len() + TAG_LEN);
    out.extend_from_slice(MAGIC);
    out.push(version);
    out.extend_from_slice(&p.salt);
    out.extend_from_slice(&p.m_cost.to_le_bytes());
    out.extend_from_slice(&p.t_cost.to_le_bytes());
    out.extend_from_slice(&p.p_cost.to_le_bytes());
    debug_assert_eq!(out.len(), KDF_END);

    let wrapped = seal(kek, &dek_nonce, dek.as_ref(), &out[..KDF_END]);
    out.extend_from_slice(&dek_nonce);
    out.extend_from_slice(&wrapped);
    out.extend_from_slice(&meta_nonce);
    out.extend_from_slice(&((meta_json.len() + TAG_LEN) as u32).to_le_bytes());
    debug_assert_eq!(out.len(), HEADER_LEN);

    let meta_ct = seal(&dek, &meta_nonce, &meta_json, &out[..HEADER_LEN]);
    out.extend_from_slice(&meta_ct);
    Ok((out, dek))
}

/// STREAM nonce: random per-file prefix, big-endian chunk counter, last flag.
fn chunk_nonce(prefix: &[u8; STREAM_PREFIX_LEN], counter: u32, last: bool) -> [u8; NONCE_LEN] {
    let mut n = [0u8; NONCE_LEN];
    n[..STREAM_PREFIX_LEN].copy_from_slice(prefix);
    n[STREAM_PREFIX_LEN..NONCE_LEN - 1].copy_from_slice(&counter.to_be_bytes());
    n[NONCE_LEN - 1] = u8::from(last);
    n
}

/// Read until `n` bytes are buffered or the reader ends. A short result means
/// end of input — that is how the chunk loops learn where the payload stops.
fn fill<R: Read>(r: &mut R, n: usize) -> std::io::Result<Zeroizing<Vec<u8>>> {
    let mut buf = Zeroizing::new(vec![0u8; n]);
    let mut got = 0;
    while got < n {
        match r.read(&mut buf[got..])? {
            0 => break,
            k => got += k,
        }
    }
    buf.truncate(got);
    Ok(buf)
}

/// Encrypt `src` into a v2 object on `dst`, one `CHUNK_BYTES` chunk at a time.
/// Returns the plaintext bytes actually consumed — compare it against
/// `meta.size` to catch a source file that changed underneath the read.
///
/// `max_bytes` (callers: `MAX_FILE_BYTES`) stops a source that keeps growing;
/// the cap is the caller's policy, the format has no opinion on length.
pub fn encrypt_stream<R: Read, W: Write>(
    kek: &[u8; KEY_LEN],
    p: &KdfParams,
    meta: &FileMeta,
    max_bytes: u64,
    mut src: R,
    mut dst: W,
) -> StreamResult<u64> {
    let (head, dek) = build_head(kek, p, meta, VERSION)?;
    let prefix = random::<STREAM_PREFIX_LEN>();
    dst.write_all(&head)?;
    dst.write_all(&prefix)?;

    let mut total = 0u64;
    let mut counter = 0u32;
    let mut cur = fill(&mut src, CHUNK_BYTES)?;
    loop {
        // A chunk is final when nothing follows it: either this read came up
        // short, or the next one finds the reader empty (exact multiple).
        let next = if cur.len() == CHUNK_BYTES { fill(&mut src, CHUNK_BYTES)? } else { Zeroizing::new(Vec::new()) };
        let last = next.is_empty();
        total += cur.len() as u64;
        if total > max_bytes {
            return Err(CryptoError::TooLarge.into());
        }
        dst.write_all(&seal(&dek, &chunk_nonce(&prefix, counter, last), &cur, &head[..HEADER_LEN]))?;
        if last {
            dst.flush()?;
            return Ok(total);
        }
        counter = counter.checked_add(1).ok_or(CryptoError::TooLarge)?;
        cur = next;
    }
}

/// Writes the superseded v1 layout. Kept only so tests — here and in the
/// desktop app — can build objects that look like the ones already in people's
/// storage folders. Nothing in production may call it.
#[doc(hidden)]
pub fn encrypt_file_oneshot(kek: &[u8; KEY_LEN], p: &KdfParams, meta: &FileMeta, plaintext: &[u8]) -> Result<Vec<u8>> {
    let (mut out, dek) = build_head(kek, p, meta, VERSION_ONESHOT)?;
    let payload_nonce = random::<NONCE_LEN>();
    let payload_ct = seal(&dek, &payload_nonce, plaintext, &out[..HEADER_LEN]);
    out.extend_from_slice(&payload_nonce);
    out.extend_from_slice(&payload_ct);
    Ok(out)
}

struct Header {
    dek: Zeroizing<[u8; KEY_LEN]>,
    meta_nonce: [u8; NONCE_LEN],
    meta_end: usize,
}

/// Metadata ciphertext length from the fixed header (unauthenticated — the
/// value is covered by AAD, so a lie is caught at `read_meta`). Lets callers
/// read `HEADER_LEN + meta_len` bytes instead of the whole file.
pub fn meta_len(header: &[u8]) -> Result<usize> {
    if header.len() < HEADER_LEN || &header[..4] != MAGIC {
        return Err(CryptoError::Format);
    }
    let n = u32_at(header, META_LEN_AT) as usize;
    if n < TAG_LEN || n > MAX_META_BYTES {
        return Err(CryptoError::Format);
    }
    Ok(n)
}

fn u32_at(b: &[u8], at: usize) -> u32 {
    u32::from_le_bytes(b[at..at + 4].try_into().unwrap())
}

fn known_version(v: u8) -> Result<u8> {
    match v {
        VERSION_ONESHOT | VERSION => Ok(v),
        other => Err(CryptoError::Version(other)),
    }
}

/// Salt and Argon2 parameters from the public header (no password needed).
pub fn kdf_params(bytes: &[u8]) -> Result<KdfParams> {
    if bytes.len() < HEADER_LEN || &bytes[..4] != MAGIC {
        return Err(CryptoError::Format);
    }
    known_version(bytes[4])?;
    Ok(KdfParams {
        salt: bytes[5..5 + SALT_LEN].try_into().unwrap(),
        m_cost: u32_at(bytes, 21),
        t_cost: u32_at(bytes, 25),
        p_cost: u32_at(bytes, 29),
    })
}

fn open_header(kek: &[u8; KEY_LEN], expected_salt: &[u8; SALT_LEN], bytes: &[u8]) -> Result<Header> {
    if bytes.len() < HEADER_LEN || &bytes[..4] != MAGIC {
        return Err(CryptoError::Format);
    }
    known_version(bytes[4])?;
    if &bytes[5..5 + SALT_LEN] != expected_salt {
        return Err(CryptoError::ForeignVault);
    }
    let dek_nonce: [u8; NONCE_LEN] = bytes[DEK_NONCE_AT..DEK_AT].try_into().unwrap();
    let dek_raw = open(kek, &dek_nonce, &bytes[DEK_AT..META_NONCE_AT], &bytes[..KDF_END])?;
    let dek = Zeroizing::new(<[u8; KEY_LEN]>::try_from(dek_raw.as_slice()).map_err(|_| CryptoError::Auth)?);
    let meta_nonce = bytes[META_NONCE_AT..META_LEN_AT].try_into().unwrap();
    let meta_end = HEADER_LEN + meta_len(bytes)?;
    if bytes.len() < meta_end {
        return Err(CryptoError::Format);
    }
    Ok(Header { dek, meta_nonce, meta_end })
}

fn open_meta(h: &Header, bytes: &[u8]) -> Result<FileMeta> {
    let json = open(&h.dek, &h.meta_nonce, &bytes[HEADER_LEN..h.meta_end], &bytes[..HEADER_LEN])?;
    serde_json::from_slice(&json).map_err(|_| CryptoError::Auth)
}

/// Needs only the first `HEADER_LEN + meta_len` bytes.
pub fn read_meta(kek: &[u8; KEY_LEN], expected_salt: &[u8; SALT_LEN], bytes: &[u8]) -> Result<FileMeta> {
    open_meta(&open_header(kek, expected_salt, bytes)?, bytes)
}

/// Header plus sealed metadata, read off a stream. Leaves the reader
/// positioned at the first payload byte.
fn read_head<R: Read>(src: &mut R) -> StreamResult<Vec<u8>> {
    let mut head = fill(src, HEADER_LEN)?.to_vec();
    if head.len() < HEADER_LEN {
        return Err(CryptoError::Format.into());
    }
    let n = meta_len(&head)?;
    let meta_ct = fill(src, n)?;
    if meta_ct.len() < n {
        return Err(CryptoError::Format.into());
    }
    head.extend_from_slice(&meta_ct);
    Ok(head)
}

/// Decrypt an object of either version from `src` onto `dst`, returning its
/// metadata. v2 streams chunk by chunk; a v1 payload can only be opened whole,
/// so it is bounded by the cap that applied while v1 was written.
pub fn decrypt_stream<R: Read, W: Write>(
    kek: &[u8; KEY_LEN],
    expected_salt: &[u8; SALT_LEN],
    mut src: R,
    mut dst: W,
) -> StreamResult<FileMeta> {
    let head = read_head(&mut src)?;
    let h = open_header(kek, expected_salt, &head)?;
    let meta = open_meta(&h, &head)?;
    let aad = &head[..HEADER_LEN];

    if head[4] == VERSION_ONESHOT {
        let nonce = fill(&mut src, NONCE_LEN)?;
        let nonce: [u8; NONCE_LEN] = nonce.as_slice().try_into().map_err(|_| CryptoError::Format)?;
        // +1 so an object claiming to be v1 but larger than v1 could ever be
        // is rejected rather than buffered. The buffer grows to fit, so a
        // small file costs a small allocation.
        let limit = MAX_ONESHOT_FILE_BYTES + (TAG_LEN + 1) as u64;
        let mut ct = Zeroizing::new(Vec::new());
        src.by_ref().take(limit).read_to_end(&mut ct)?;
        if ct.len() as u64 == limit {
            return Err(CryptoError::Format.into());
        }
        dst.write_all(&open(&h.dek, &nonce, &ct, aad)?)?;
        dst.flush()?;
        return Ok(meta);
    }

    let prefix = fill(&mut src, STREAM_PREFIX_LEN)?;
    let prefix: [u8; STREAM_PREFIX_LEN] = prefix.as_slice().try_into().map_err(|_| CryptoError::Format)?;
    const FRAME: usize = CHUNK_BYTES + TAG_LEN;

    let mut counter = 0u32;
    let mut cur = fill(&mut src, FRAME)?;
    loop {
        let next = if cur.len() == FRAME { fill(&mut src, FRAME)? } else { Zeroizing::new(Vec::new()) };
        let last = next.is_empty();
        // A truncated file lands here with `last` set on a chunk the writer
        // sealed as non-final, so the nonce differs and this fails.
        dst.write_all(&open(&h.dek, &chunk_nonce(&prefix, counter, last), &cur, aad)?)?;
        if last {
            dst.flush()?;
            return Ok(meta);
        }
        counter = counter.checked_add(1).ok_or(CryptoError::Format)?;
        cur = next;
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn params() -> KdfParams {
        KdfParams { salt: [9u8; SALT_LEN], m_cost: 8, t_cost: 1, p_cost: 1 }
    }

    fn meta() -> FileMeta {
        FileMeta { name: "secrets.env".into(), dir: "proj/config".into(), size: 5, mtime: 1, imported_at: 2 }
    }

    /// Seal into a buffer — what every production writer does, via `Vec`.
    fn seal_v2(kek: &[u8; KEY_LEN], p: &KdfParams, m: &FileMeta, plaintext: &[u8]) -> Vec<u8> {
        let mut out = Vec::new();
        let n = encrypt_stream(kek, p, m, MAX_FILE_BYTES, plaintext, &mut out).unwrap();
        assert_eq!(n, plaintext.len() as u64, "streamed byte count");
        out
    }

    fn open_any(kek: &[u8; KEY_LEN], salt: &[u8; SALT_LEN], bytes: &[u8]) -> StreamResult<(FileMeta, Vec<u8>)> {
        let mut out = Vec::new();
        let m = decrypt_stream(kek, salt, bytes, &mut out)?;
        Ok((m, out))
    }

    /// Frame boundaries in a v2 object: header+meta, stream prefix, then
    /// `CHUNK_BYTES + TAG_LEN` per full chunk.
    fn payload_at(bytes: &[u8]) -> usize {
        HEADER_LEN + meta_len(bytes).unwrap() + STREAM_PREFIX_LEN
    }

    #[test]
    fn roundtrip_and_partial_meta_read() {
        let kek = [1u8; KEY_LEN];
        let p = params();
        let bytes = seal_v2(&kek, &p, &meta(), b"hello");
        assert_eq!(&bytes[..4], MAGIC);
        assert_eq!(bytes[4], VERSION);
        assert!(!bytes.windows(11).any(|w| w == b"secrets.env"), "name leaked in plaintext");
        assert!(!bytes.windows(5).any(|w| w == b"hello"), "payload leaked in plaintext");

        let n = meta_len(&bytes[..HEADER_LEN]).unwrap();
        let prefix = &bytes[..HEADER_LEN + n];
        assert_eq!(read_meta(&kek, &p.salt, prefix).unwrap(), meta());

        let (m, pt) = open_any(&kek, &p.salt, &bytes).unwrap();
        assert_eq!(m, meta());
        assert_eq!(pt, b"hello");
    }

    /// Every size around a chunk edge, including exact multiples — the case
    /// where the writer has to seal a *full* chunk as the final one.
    #[test]
    fn chunk_boundaries_roundtrip() {
        let kek = [1u8; KEY_LEN];
        let p = params();
        for size in [0, 1, CHUNK_BYTES - 1, CHUNK_BYTES, CHUNK_BYTES + 1, 2 * CHUNK_BYTES, 2 * CHUNK_BYTES + 7] {
            let plaintext: Vec<u8> = (0..size).map(|i| (i % 251) as u8).collect();
            let bytes = seal_v2(&kek, &p, &meta(), &plaintext);
            let frames = size / CHUNK_BYTES + usize::from(size % CHUNK_BYTES != 0 || size == 0);
            assert_eq!(bytes.len() - payload_at(&bytes), size + frames * TAG_LEN, "framing for {size}");
            let (_, pt) = open_any(&kek, &p.salt, &bytes).unwrap();
            assert_eq!(pt, plaintext, "roundtrip for {size}");
        }
    }

    /// Dropping, duplicating or swapping a chunk must fail — the chunk counter
    /// and last-chunk flag live in the nonce, so none of them authenticate.
    #[test]
    fn reordered_or_truncated_chunks_fail() {
        let kek = [1u8; KEY_LEN];
        let p = params();
        const FRAME: usize = CHUNK_BYTES + TAG_LEN;
        let plaintext: Vec<u8> = (0..3 * CHUNK_BYTES).map(|i| (i % 251) as u8).collect();
        let bytes = seal_v2(&kek, &p, &meta(), &plaintext);
        let at = payload_at(&bytes);

        let dropped = &bytes[..bytes.len() - FRAME];
        assert!(open_any(&kek, &p.salt, dropped).is_err(), "dropped final chunk accepted");

        let mut swapped = bytes.clone();
        let (a, b) = (at, at + FRAME);
        let first: Vec<u8> = swapped[a..a + FRAME].to_vec();
        swapped.copy_within(b..b + FRAME, a);
        swapped[b..b + FRAME].copy_from_slice(&first);
        assert!(open_any(&kek, &p.salt, &swapped).is_err(), "swapped chunks accepted");

        let mut duplicated = bytes[..at + FRAME].to_vec();
        duplicated.extend_from_slice(&bytes[at..]);
        assert!(open_any(&kek, &p.salt, &duplicated).is_err(), "duplicated chunk accepted");
    }

    /// Objects written before streaming must keep opening.
    #[test]
    fn oneshot_objects_still_open() {
        let kek = [1u8; KEY_LEN];
        let p = params();
        let bytes = encrypt_file_oneshot(&kek, &p, &meta(), b"legacy payload").unwrap();
        assert_eq!(bytes[4], VERSION_ONESHOT);
        let (m, pt) = open_any(&kek, &p.salt, &bytes).unwrap();
        assert_eq!(m, meta());
        assert_eq!(pt, b"legacy payload");

        let mut t = bytes.clone();
        *t.last_mut().unwrap() ^= 0x01;
        assert!(open_any(&kek, &p.salt, &t).is_err(), "tampered v1 payload accepted");
    }

    #[test]
    fn tamper_anywhere_fails() {
        let kek = [1u8; KEY_LEN];
        let p = params();
        let bytes = seal_v2(&kek, &p, &meta(), b"hello world");
        // One byte in each region: kdf params, wrapped DEK, meta_len, meta ct, stream prefix, chunk ct.
        for at in [21, DEK_AT + 3, META_LEN_AT, HEADER_LEN + 2, payload_at(&bytes) - 3, bytes.len() - 1] {
            let mut t = bytes.clone();
            t[at] ^= 0x01;
            assert!(open_any(&kek, &p.salt, &t).is_err(), "tamper at {at} not detected");
        }
        let mut t = bytes.clone();
        t[0] = b'X';
        assert!(matches!(open_any(&kek, &p.salt, &t), Err(StreamError::Crypto(CryptoError::Format))));
        let mut t = bytes.clone();
        t[4] = 9;
        assert!(matches!(open_any(&kek, &p.salt, &t), Err(StreamError::Crypto(CryptoError::Version(9)))));
    }

    #[test]
    fn wrong_key_and_foreign_salt() {
        let kek = [1u8; KEY_LEN];
        let p = params();
        let bytes = seal_v2(&kek, &p, &meta(), b"x");
        let wrong = open_any(&[2u8; KEY_LEN], &p.salt, &bytes);
        assert!(matches!(wrong, Err(StreamError::Crypto(CryptoError::Auth))));
        let foreign = open_any(&kek, &[0u8; SALT_LEN], &bytes);
        assert!(matches!(foreign, Err(StreamError::Crypto(CryptoError::ForeignVault))));
    }

    #[test]
    fn kdf_is_deterministic_and_salted() {
        let p = params();
        let a = derive_kek(b"pw", &p).unwrap();
        let b = derive_kek(b"pw", &p).unwrap();
        assert_eq!(a.as_ref(), b.as_ref());
        let other = KdfParams { salt: [8u8; SALT_LEN], ..p };
        assert_ne!(a.as_ref(), derive_kek(b"pw", &other).unwrap().as_ref());
        assert_ne!(a.as_ref(), derive_kek(b"pw2", &p).unwrap().as_ref());
    }

    /// Deterministic fuzz: every single-byte flip, every truncation length and
    /// a few garbage buffers must yield `Err`, never a panic or a false `Ok`.
    #[test]
    fn mutation_sweep_never_panics_or_accepts() {
        let kek = [1u8; KEY_LEN];
        let p = params();
        let bytes = seal_v2(&kek, &p, &meta(), b"payload bytes for the sweep");

        for at in 0..bytes.len() {
            let mut t = bytes.clone();
            t[at] ^= 0x80;
            assert!(open_any(&kek, &p.salt, &t).is_err(), "flip at {at} accepted");
            let _ = read_meta(&kek, &p.salt, &t); // must not panic; Ok only for flips past the meta block
            let _ = meta_len(&t);
        }
        for len in 0..bytes.len() {
            let t = &bytes[..len];
            assert!(open_any(&kek, &p.salt, t).is_err(), "truncation to {len} accepted");
            let _ = read_meta(&kek, &p.salt, t);
            let _ = meta_len(t);
        }
        // Garbage with a valid magic/version prefix and absurd lengths.
        let mut garbage = bytes[..HEADER_LEN].to_vec();
        garbage[META_LEN_AT..META_LEN_AT + 4].copy_from_slice(&u32::MAX.to_le_bytes());
        assert!(matches!(meta_len(&garbage), Err(CryptoError::Format)));
        assert!(open_any(&kek, &p.salt, &garbage).is_err());
        let mut seed = 0x9E37_79B9u32;
        for _ in 0..64 {
            let mut g = vec![0u8; (seed % 700) as usize];
            for b in g.iter_mut() {
                seed = seed.wrapping_mul(1_664_525).wrapping_add(1_013_904_223);
                *b = (seed >> 24) as u8;
            }
            assert!(open_any(&kek, &p.salt, &g).is_err());
        }
    }

    /// Counts and checksums instead of buffering, so the cap-sized test below
    /// proves memory stays flat rather than quietly allocating gigabytes.
    struct Tally {
        len: u64,
        sum: u64,
    }

    impl Write for Tally {
        fn write(&mut self, buf: &[u8]) -> std::io::Result<usize> {
            self.len += buf.len() as u64;
            self.sum = buf.iter().fold(self.sum, |acc, b| acc.wrapping_mul(31).wrapping_add(u64::from(*b)));
            Ok(buf.len())
        }
        fn flush(&mut self) -> std::io::Result<()> {
            Ok(())
        }
    }

    /// A payload at the cap, sealed and reopened for real, through a temp file
    /// and fixed-size buffers (~10 GB of I/O, flat RSS — ignored by default):
    /// `cargo test max_size_payload_roundtrips -- --ignored`.
    #[test]
    #[ignore]
    fn max_size_payload_roundtrips() {
        let kek = [1u8; KEY_LEN];
        let p = params();
        let path = std::env::temp_dir().join("mydt-max-size.mydt");
        let object = std::fs::File::create(&path).unwrap();
        let src = std::io::repeat(0xA5).take(MAX_FILE_BYTES);
        let n = encrypt_stream(&kek, &p, &meta(), MAX_FILE_BYTES, src, std::io::BufWriter::new(object)).unwrap();
        assert_eq!(n, MAX_FILE_BYTES);
        assert!(std::fs::metadata(&path).unwrap().len() <= MAX_OBJECT_BYTES);

        let mut tally = Tally { len: 0, sum: 0 };
        let object = std::io::BufReader::new(std::fs::File::open(&path).unwrap());
        decrypt_stream(&kek, &p.salt, object, &mut tally).unwrap();
        std::fs::remove_file(&path).unwrap();
        assert_eq!(tally.len, MAX_FILE_BYTES);

        let mut expect = Tally { len: 0, sum: 0 };
        for _ in 0..MAX_FILE_BYTES / CHUNK_BYTES as u64 {
            expect.write_all(&vec![0xA5u8; CHUNK_BYTES]).unwrap();
        }
        assert_eq!(tally.sum, expect.sum, "plaintext differs after the roundtrip");
    }

    /// A source that outgrows the cap mid-stream is refused. Checked against a
    /// small cap here; production passes `MAX_FILE_BYTES`.
    #[test]
    fn oversized_payload_is_refused() {
        let kek = [1u8; KEY_LEN];
        let p = params();
        let cap = (2 * CHUNK_BYTES) as u64;
        let src = std::io::repeat(7).take(cap + 1);
        let err = encrypt_stream(&kek, &p, &meta(), cap, src, std::io::sink()).unwrap_err();
        assert!(matches!(err, StreamError::Crypto(CryptoError::TooLarge)), "{err}");

        let exact = std::io::repeat(7).take(cap);
        assert_eq!(encrypt_stream(&kek, &p, &meta(), cap, exact, std::io::sink()).unwrap(), cap);
    }

    #[test]
    fn fresh_nonces_per_write() {
        let kek = [1u8; KEY_LEN];
        let a = seal_v2(&kek, &params(), &meta(), b"x");
        let b = seal_v2(&kek, &params(), &meta(), b"x");
        assert_ne!(a[DEK_NONCE_AT..DEK_AT], b[DEK_NONCE_AT..DEK_AT]);
        assert_ne!(a[HEADER_LEN..], b[HEADER_LEN..]);
    }
}
