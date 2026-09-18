# mydt

Reference implementation of the MyDevTools `.mydt` encrypted file format
(Argon2id + XChaCha20-Poly1305, self-contained per file) and a small CLI.
Format spec: [`docs/MYDT_FORMAT.md`](../../docs/MYDT_FORMAT.md).

The desktop app's Secure Files tool uses this crate unchanged, so anything the
CLI writes opens in the app and vice versa.

## Library

```rust
let params = mydt::KdfParams::generate();               // random salt, default costs
let kek = mydt::derive_kek(b"password", &params)?;      // Argon2id, once per salt
let meta = mydt::FileMeta { name: "a.env".into(), dir: "".into(), size: 3, mtime: 0, imported_at: 0 };

// Reader in, writer out: a multi-GB file moves through a fixed-size buffer.
let mut object = Vec::new();
mydt::encrypt_stream(&kek, &params, &meta, mydt::MAX_FILE_BYTES, &b"x=1"[..], &mut object)?;

let params = mydt::kdf_params(&object)?;                // read salt/costs back
let mut plaintext = Vec::new();
let meta = mydt::decrypt_stream(&kek, &params.salt, &object[..], &mut plaintext)?;
```

`decrypt_stream` reads both format versions; `encrypt_stream` always writes the
current one.

## CLI

```sh
cargo install --path . --features cli        # or: cargo build --release --features cli

export MYDT_PASSWORD=...                      # otherwise prompted
mydt encrypt secrets.env --dir proj/config    # prints <32 hex>.mydt
mydt encrypt a.pem --params-from ~/SecureFiles/<any>.mydt -o ~/SecureFiles/new.mydt
mydt info   <file>.mydt [--unlock]
mydt ls     ~/SecureFiles
mydt decrypt <file>.mydt [-o out | -o -]
```

`--params-from` copies another object's salt and KDF parameters, which is what
makes a CLI-written file a member of an existing Secure Files storage folder.
Without it a fresh random salt is used and the desktop app will report the file
as belonging to another vault.

## Tests

`cargo test` — round trips across chunk boundaries, reordered/dropped/duplicated
chunks, tamper/truncation/garbage sweep, wrong key, foreign salt, version-1
compatibility, nonce freshness. A cap-sized (5 GiB) round trip is behind
`--ignored`: `cargo test max_size_payload_roundtrips -- --ignored`.
