//! MyDevTools `.mydt` v1 container — pure crypto/format, no I/O, no DB.
//! Spec: `docs/MYDT_FORMAT.md` in the MyDevTools repository.
//!
//! Byte layout (ints u32 LE):
//! ```text
//! off    len  field
//! 0      4    magic "MYDT"
//! 4      1    version = 1
//! 5      16   argon2 salt
//! 21     4    m_cost (KiB)
//! 25     4    t_cost
//! 29     4    p_cost
//! 33     24   dek_nonce
//! 57     48   wrapped DEK = XChaCha(KEK, dek_nonce, DEK[32], aad = bytes[0..33])
//! 105    24   meta_nonce
//! 129    4    meta_len (ciphertext incl. 16-byte tag)
//! 133    N    meta ct    = XChaCha(DEK, meta_nonce, metaJSON, aad = bytes[0..133])
//! 133+N  24   payload_nonce
//! 157+N  ...  payload ct = XChaCha(DEK, payload_nonce, plaintext, aad = bytes[0..133])
//! ```
//! Every file carries its own salt + KDF params, so a lone `.mydt` is openable
//! with just the password. All files of one vault share the salt, so the KEK
//! is derived once per unlock and listing never runs Argon2.

use argon2::{Algorithm, Argon2, Params, Version};
use chacha20poly1305::aead::{Aead, KeyInit, Payload};
use chacha20poly1305::{XChaCha20Poly1305, XNonce};
use serde::{Deserialize, Serialize};
use zeroize::Zeroizing;

pub const MAGIC: &[u8; 4] = b"MYDT";
pub const VERSION: u8 = 1;
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
/// Payload cap. The v1 container is sealed in one shot, so encrypting a file
/// holds its plaintext *and* its ciphertext in memory at once — the cap is a
/// memory budget, not a format limit.
// ponytail: raise past this only with a chunked (streaming) v2 container.
pub const MAX_FILE_BYTES: u64 = 512 * 1024 * 1024;
/// Metadata JSON is a few hundred bytes; anything bigger is not ours.
pub const MAX_META_BYTES: usize = 64 * 1024;
/// Largest `.mydt` object we will read into memory: payload cap + header +
/// metadata cap + nonces/tags. Guards against a hostile multi-GB file.
pub const MAX_OBJECT_BYTES: u64 = MAX_FILE_BYTES + (HEADER_LEN + MAX_META_BYTES + NONCE_LEN + TAG_LEN) as u64;

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
}

type Result<T> = std::result::Result<T, CryptoError>;

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

pub fn encrypt_file(kek: &[u8; KEY_LEN], p: &KdfParams, meta: &FileMeta, plaintext: &[u8]) -> Result<Vec<u8>> {
    let meta_json = Zeroizing::new(serde_json::to_vec(meta).map_err(|_| CryptoError::Format)?);
    let dek = Zeroizing::new(random::<KEY_LEN>());
    let dek_nonce = random::<NONCE_LEN>();
    let meta_nonce = random::<NONCE_LEN>();
    let payload_nonce = random::<NONCE_LEN>();

    let mut out = Vec::with_capacity(HEADER_LEN + meta_json.len() + TAG_LEN + NONCE_LEN + plaintext.len() + TAG_LEN);
    out.extend_from_slice(MAGIC);
    out.push(VERSION);
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

/// Salt and Argon2 parameters from the public header (no password needed).
pub fn kdf_params(bytes: &[u8]) -> Result<KdfParams> {
    if bytes.len() < HEADER_LEN || &bytes[..4] != MAGIC {
        return Err(CryptoError::Format);
    }
    if bytes[4] != VERSION {
        return Err(CryptoError::Version(bytes[4]));
    }
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
    if bytes[4] != VERSION {
        return Err(CryptoError::Version(bytes[4]));
    }
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

pub fn decrypt_file(
    kek: &[u8; KEY_LEN],
    expected_salt: &[u8; SALT_LEN],
    bytes: &[u8],
) -> Result<(FileMeta, Zeroizing<Vec<u8>>)> {
    let h = open_header(kek, expected_salt, bytes)?;
    let meta = open_meta(&h, bytes)?;
    let nonce_end = h.meta_end + NONCE_LEN;
    if bytes.len() < nonce_end + TAG_LEN {
        return Err(CryptoError::Format);
    }
    let payload_nonce: [u8; NONCE_LEN] = bytes[h.meta_end..nonce_end].try_into().unwrap();
    let plaintext = open(&h.dek, &payload_nonce, &bytes[nonce_end..], &bytes[..HEADER_LEN])?;
    Ok((meta, plaintext))
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

    #[test]
    fn roundtrip_and_partial_meta_read() {
        let kek = [1u8; KEY_LEN];
        let p = params();
        let bytes = encrypt_file(&kek, &p, &meta(), b"hello").unwrap();
        assert_eq!(&bytes[..4], MAGIC);
        assert!(!bytes.windows(11).any(|w| w == b"secrets.env"), "name leaked in plaintext");
        assert!(!bytes.windows(5).any(|w| w == b"hello"), "payload leaked in plaintext");

        let n = meta_len(&bytes[..HEADER_LEN]).unwrap();
        let prefix = &bytes[..HEADER_LEN + n];
        assert_eq!(read_meta(&kek, &p.salt, prefix).unwrap(), meta());

        let (m, pt) = decrypt_file(&kek, &p.salt, &bytes).unwrap();
        assert_eq!(m, meta());
        assert_eq!(pt.as_slice(), b"hello");
    }

    #[test]
    fn empty_payload() {
        let kek = [1u8; KEY_LEN];
        let p = params();
        let bytes = encrypt_file(&kek, &p, &meta(), b"").unwrap();
        let (_, pt) = decrypt_file(&kek, &p.salt, &bytes).unwrap();
        assert!(pt.is_empty());
    }

    #[test]
    fn tamper_anywhere_fails() {
        let kek = [1u8; KEY_LEN];
        let p = params();
        let bytes = encrypt_file(&kek, &p, &meta(), b"hello world").unwrap();
        // One byte in each region: kdf params, wrapped DEK, meta_len, meta ct, payload nonce, payload ct.
        for at in [21, DEK_AT + 3, META_LEN_AT, HEADER_LEN + 2, bytes.len() - 30, bytes.len() - 1] {
            let mut t = bytes.clone();
            t[at] ^= 0x01;
            assert!(decrypt_file(&kek, &p.salt, &t).is_err(), "tamper at {at} not detected");
        }
        let mut t = bytes.clone();
        t[0] = b'X';
        assert!(matches!(decrypt_file(&kek, &p.salt, &t), Err(CryptoError::Format)));
        let mut t = bytes.clone();
        t[4] = 9;
        assert!(matches!(decrypt_file(&kek, &p.salt, &t), Err(CryptoError::Version(9))));
    }

    #[test]
    fn wrong_key_and_foreign_salt() {
        let kek = [1u8; KEY_LEN];
        let p = params();
        let bytes = encrypt_file(&kek, &p, &meta(), b"x").unwrap();
        assert!(matches!(decrypt_file(&[2u8; KEY_LEN], &p.salt, &bytes), Err(CryptoError::Auth)));
        assert!(matches!(decrypt_file(&kek, &[0u8; SALT_LEN], &bytes), Err(CryptoError::ForeignVault)));
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
        let bytes = encrypt_file(&kek, &p, &meta(), b"payload bytes for the sweep").unwrap();

        for at in 0..bytes.len() {
            let mut t = bytes.clone();
            t[at] ^= 0x80;
            assert!(decrypt_file(&kek, &p.salt, &t).is_err(), "flip at {at} accepted");
            let _ = read_meta(&kek, &p.salt, &t); // must not panic; Ok only for flips past the meta block
            let _ = meta_len(&t);
        }
        for len in 0..bytes.len() {
            let t = &bytes[..len];
            assert!(decrypt_file(&kek, &p.salt, t).is_err(), "truncation to {len} accepted");
            let _ = read_meta(&kek, &p.salt, t);
            let _ = meta_len(t);
        }
        // Garbage with a valid magic/version prefix and absurd lengths.
        let mut garbage = bytes[..HEADER_LEN].to_vec();
        garbage[META_LEN_AT..META_LEN_AT + 4].copy_from_slice(&u32::MAX.to_le_bytes());
        assert!(matches!(meta_len(&garbage), Err(CryptoError::Format)));
        assert!(decrypt_file(&kek, &p.salt, &garbage).is_err());
        let mut seed = 0x9E37_79B9u32;
        for _ in 0..64 {
            let mut g = vec![0u8; (seed % 700) as usize];
            for b in g.iter_mut() {
                seed = seed.wrapping_mul(1_664_525).wrapping_add(1_013_904_223);
                *b = (seed >> 24) as u8;
            }
            assert!(decrypt_file(&kek, &p.salt, &g).is_err());
        }
    }

    /// A payload at the cap, sealed for real (~3 min, ~2 GB peak RSS — ignored
    /// by default): `cargo test max_size_payload_roundtrips -- --ignored`.
    #[test]
    #[ignore]
    fn max_size_payload_roundtrips() {
        let kek = [1u8; KEY_LEN];
        let p = params();
        let big = vec![0xA5u8; MAX_FILE_BYTES as usize];
        let bytes = encrypt_file(&kek, &p, &meta(), &big).unwrap();
        assert!((bytes.len() as u64) <= MAX_OBJECT_BYTES);
        let (_, pt) = decrypt_file(&kek, &p.salt, &bytes).unwrap();
        assert_eq!(pt.len(), big.len());
    }

    #[test]
    fn fresh_nonces_per_write() {
        let kek = [1u8; KEY_LEN];
        let a = encrypt_file(&kek, &params(), &meta(), b"x").unwrap();
        let b = encrypt_file(&kek, &params(), &meta(), b"x").unwrap();
        assert_ne!(a[DEK_NONCE_AT..DEK_AT], b[DEK_NONCE_AT..DEK_AT]);
        assert_ne!(a[HEADER_LEN..], b[HEADER_LEN..]);
    }
}
