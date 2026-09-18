# `.mydt` — MyDevTools encrypted file format, versions 1 and 2

`.mydt` is the on-disk representation used by the **Secure Files** tool. Each
source file becomes one `.mydt` object with a random physical name; the
original name, folder, size, timestamps and contents are encrypted inside it.
The format is deliberately small so that a CLI or SDK can implement it in a few
dozen lines. Reference implementation and CLI: the `mydt` crate in
[`crates/mydt`](../crates/mydt/README.md) (the desktop app uses it unchanged).

## Goals and non-goals

- Stored representation is opaque to filesystem indexers, thumbnailers, OCR and
  any reader that only sees the bytes on disk.
- A single `.mydt` file is **self-contained**: it can be decrypted with just the
  password, without any database, index or sidecar.
- Authenticated: any modification of any byte is detected.
- Streamable: version 2 splits the payload into independently sealed chunks, so
  a multi-gigabyte file is written and read through a fixed-size buffer.
- Not a container for many files, not deniable, not a defense against a
  compromised machine while the vault is unlocked.

## Physical naming

Objects are named `<id>.mydt` where `id` is 16 cryptographically random bytes
rendered as 32 lowercase hex characters (e.g. `83a91c2f….mydt`). The name
carries no information about the content. Writers create `<id>.mydt.tmp`,
fsync, then rename it over the final name; readers delete stale `.mydt.tmp`
files. Nothing else in the storage folder is touched.

## Byte layout

All integers are unsigned 32-bit little-endian.

| Offset   | Length | Field                                                              |
|----------|--------|--------------------------------------------------------------------|
| 0        | 4      | Magic `MYDT` (ASCII)                                               |
| 4        | 1      | Version, `0x01` (one-shot payload) or `0x02` (chunked payload)      |
| 5        | 16     | Argon2 salt                                                        |
| 21       | 4      | Argon2 `m_cost` (KiB)                                              |
| 25       | 4      | Argon2 `t_cost`                                                    |
| 29       | 4      | Argon2 `p_cost`                                                    |
| 33       | 24     | `dek_nonce`                                                        |
| 57       | 48     | Wrapped DEK: 32-byte key + 16-byte tag                             |
| 105      | 24     | `meta_nonce`                                                       |
| 129      | 4      | `meta_len` — metadata ciphertext length **including** its 16-byte tag |
| 133      | N      | Metadata ciphertext (`N = meta_len`)                               |

Everything above is identical in both versions; the payload that follows is
what the version byte selects.

**Version 1** — one AEAD message, so writing or reading it needs the whole
plaintext in memory. Still read, no longer written:

| Offset   | Length | Field                                                              |
|----------|--------|--------------------------------------------------------------------|
| 133 + N  | 24     | `payload_nonce`                                                    |
| 157 + N  | rest   | Payload ciphertext + 16-byte tag, to end of file                   |

**Version 2** — the payload in 1 MiB chunks, each its own AEAD message:

| Offset   | Length | Field                                                              |
|----------|--------|--------------------------------------------------------------------|
| 133 + N  | 19     | `stream_prefix` — random per file                                  |
| 152 + N  | rest   | Chunks, each 1 MiB of plaintext + 16-byte tag; the last is shorter |

The fixed header is 133 bytes. `meta_len` must be in `[16, 65536]`.

## Cryptography

- **KDF**: Argon2id, version 0x13, parameters from the header, 32-byte output.
  The desktop app writes `m_cost = 65536` (64 MiB), `t_cost = 3`, `p_cost = 1`.
  Input is the UTF-8 master password; the result is the **KEK**.
- **AEAD**: XChaCha20-Poly1305 (24-byte nonces, 16-byte tags). Nonces are
  random per write; the 192-bit nonce space makes random nonces safe.
- **Keys**: each file has its own random 32-byte **DEK**. The KEK only ever
  encrypts DEKs, so rotating the password requires rewrapping one 48-byte
  block per file, not re-encrypting payloads.

```
KEK          = Argon2id(password, salt, m_cost, t_cost, p_cost)
wrapped_dek  = XChaCha20Poly1305(KEK, dek_nonce, DEK,       aad = bytes[0..33])
meta_ct      = XChaCha20Poly1305(DEK, meta_nonce, meta_json, aad = bytes[0..133])

v1: payload_ct = XChaCha20Poly1305(DEK, payload_nonce, plaintext, aad = bytes[0..133])
v2: chunk_ct_i = XChaCha20Poly1305(DEK, nonce_i,       chunk_i,   aad = bytes[0..133])
    nonce_i    = stream_prefix (19 bytes) || counter_i (u32, big-endian) || last_i (1 byte)
```

Version 2's nonce layout is the STREAM construction (Hoang-Reyhanitabar-Rogaway-
Vizár), byte-compatible with `aead::stream::EncryptorBE32`. `counter_i` starts
at 0 and increments per chunk; `last_i` is 1 on the final chunk and 0 otherwise.
Because both are part of the nonce, a dropped, duplicated, reordered or
truncated chunk fails to authenticate — a reader can never be fed short
plaintext as if it were complete. A file whose length is an exact multiple of
the chunk size ends with a full chunk sealed as the final one.

The associated data binds the KDF parameters to the DEK wrap, and the whole
fixed header (including `meta_len`) to both the metadata and the payload.
Swapping headers, nonces or lengths between files therefore fails
authentication.

## Metadata

`meta_json` is a UTF-8 JSON object:

```json
{ "name": "secrets.env", "dir": "proj/config", "size": 1432,
  "mtime": 1755820000000, "importedAt": 1755820123456 }
```

- `name` — original file name, no path separators.
- `dir` — logical folder as `/`-separated segments, `""` for the root. Folders
  are derived from this field; there are no folder objects.
- `size` — plaintext length in bytes.
- `mtime`, `importedAt` — epoch milliseconds.

Unknown fields must be ignored by readers so the object can grow without a
version bump. MIME type is not stored; readers derive it from `name`.

## Reading

1. Check magic and version; reject anything else.
2. Read the KDF block, derive (or reuse a cached) KEK. All files in one storage
   folder share the same salt, so the KEK is derived once per unlock and a
   listing never runs Argon2.
3. Unwrap the DEK with `aad = bytes[0..33]`. Failure means wrong password,
   foreign salt, or tampering — readers should not distinguish beyond that.
4. Decrypt `meta_ct` with `aad = bytes[0..133]`. Listing stops here: only
   `133 + meta_len` bytes need to be read from disk.
5. Decrypt the payload with the same AAD.

Step 5 differs by version: v1 decrypts one message; v2 reads 1 MiB + 16 byte
frames, decrypting each with its own nonce, and treats the frame that is short —
or the one the reader finds nothing after — as the final chunk.

A reader must treat every length field as untrusted and bound what it reads
(`MAX_META_BYTES = 64 KiB`, payload cap 5 GiB in the desktop app, and 512 MiB
for a v1 payload since that was the cap while v1 was written).

## Writing

Every write — import, rename, move, replace — produces a fresh DEK and fresh
nonces and rewrites the whole object atomically, as version 2. Rewriting in
place is never done. Because the metadata is sealed ahead of the payload and
covers it as associated data, changing a name or folder rewrites the payload
too.

## What leaks

- Existence of the folder, number of objects, approximate plaintext size
  (v1 ciphertext is plaintext + 157 + `meta_len` bytes; v2 adds 152 +
  `meta_len` plus 16 bytes per 1 MiB chunk), filesystem timestamps.
- KDF parameters and salt (public by design).
- The storage folder path, stored in the app's SQLCipher database.

Nothing else: names, extensions, folder structure, MIME types and contents are
all inside the AEAD envelope.

## Versioning

The version byte is bumped only for incompatible layout changes. Readers must
reject unknown versions and must keep reading every older one; writers must
never downgrade an object. The chunk size is not stored, so changing it would
need a version bump of its own. KDF parameters
are per file, so they can be changed without a version bump.

## Threat model (summary)

Protects stored data at rest against anything that can only read the storage
folder: indexers, backups, other apps, a copied drive. Does **not** protect
against malware or a privileged process on a machine where the vault is
unlocked, against screen capture during preview, or against a keylogger. See
the PRD's security section for the full table.
