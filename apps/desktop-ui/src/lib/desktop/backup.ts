/**
 * Desktop encrypted backup — a portable, device-independent vault export.
 *
 * The local Rust store hands us the raw logical dump (all entries + portable kv
 * singletons). We encrypt it here in the webview under a user backup passphrase
 * (PBKDF2-600k → AES-GCM-256) so the file written to disk is opaque, and hand
 * the same JSON back on restore. This is the only recovery path that survives
 * losing this Mac's keychain device key: the raw SQLCipher DB can't be moved
 * because its key never leaves the keychain.
 *
 * The backup passphrase is independent of the master password (the user may
 * reuse it) and is NOT recoverable — losing it means losing the backup.
 */
import { localApi } from "./bridge";
import { downloadFile } from "./save-file";

const MAGIC = "MDTBACKUP";
const FORMAT_VERSION = 1;
const PBKDF2_ITERS = 600_000;

type BackupEnvelope = {
  magic: string;
  format: number;
  salt: string; // base64
  iv: string; // base64
  cipher: string; // base64
  createdAt: number;
};

function toBase64(bytes: Uint8Array): string {
  let bin = "";
  for (let i = 0; i < bytes.length; i += 0x8000) {
    bin += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  }
  return btoa(bin);
}

function fromBase64(s: string): Uint8Array {
  const bin = atob(s);
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
}

async function deriveKey(passphrase: string, salt: Uint8Array): Promise<CryptoKey> {
  const base = await crypto.subtle.importKey(
    "raw",
    new TextEncoder().encode(passphrase),
    "PBKDF2",
    false,
    ["deriveKey"]
  );
  return crypto.subtle.deriveKey(
    { name: "PBKDF2", salt: salt as BufferSource, iterations: PBKDF2_ITERS, hash: "SHA-256" },
    base,
    { name: "AES-GCM", length: 256 },
    false,
    ["encrypt", "decrypt"]
  );
}

/** Encrypt the full local store into a downloadable backup blob. */
export async function exportBackup(passphrase: string): Promise<Blob> {
  if (!passphrase || passphrase.length < 8) {
    throw new Error("Choose a backup passphrase of at least 8 characters");
  }
  const res = await localApi("GET", "/desktop/backup/export");
  if (res.status !== 200) throw new Error(`Backup export failed (${res.status})`);

  const salt = crypto.getRandomValues(new Uint8Array(16));
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const key = await deriveKey(passphrase, salt);
  const cipher = new Uint8Array(
    await crypto.subtle.encrypt(
      { name: "AES-GCM", iv: iv as BufferSource },
      key,
      new TextEncoder().encode(res.body)
    )
  );

  const envelope: BackupEnvelope = {
    magic: MAGIC,
    format: FORMAT_VERSION,
    salt: toBase64(salt),
    iv: toBase64(iv),
    cipher: toBase64(cipher),
    createdAt: Date.now(),
  };
  return new Blob([JSON.stringify(envelope)], { type: "application/json" });
}

/** Export and hand the encrypted backup to the browser as a file download. */
export async function downloadBackup(passphrase: string): Promise<void> {
  const blob = await exportBackup(passphrase);
  downloadFile(blob, `mydevtools-backup-${new Date().toISOString().split("T")[0]}.json`);
}

/** True if the local vault already has a configured master password. */
export async function hasConfiguredVault(): Promise<boolean> {
  const res = await localApi("GET", "/api/v1/auth/master-vault");
  return res.status === 200;
}

export type ImportResult = { imported: number; kv_imported: number };

/**
 * Decrypt a backup file and merge it into the local store. Entries land as
 * dirty rows; the master-vault salt only lands if none is configured yet.
 */
export async function importBackup(
  passphrase: string,
  fileText: string
): Promise<ImportResult> {
  let env: Partial<BackupEnvelope>;
  try {
    env = JSON.parse(fileText) as Partial<BackupEnvelope>;
  } catch {
    throw new Error("That file isn't a valid MyDevTools backup");
  }
  if (env.magic !== MAGIC || !env.salt || !env.iv || !env.cipher) {
    throw new Error("That file isn't a valid MyDevTools backup");
  }

  const key = await deriveKey(passphrase, fromBase64(env.salt));
  let dumpText: string;
  try {
    const plain = await crypto.subtle.decrypt(
      { name: "AES-GCM", iv: fromBase64(env.iv) as BufferSource },
      key,
      fromBase64(env.cipher) as BufferSource
    );
    dumpText = new TextDecoder().decode(plain);
  } catch {
    throw new Error("Wrong passphrase, or the backup file is corrupted");
  }

  const res = await localApi("POST", "/desktop/backup/import", dumpText);
  if (res.status !== 200) throw new Error(`Restore failed (${res.status})`);
  window.dispatchEvent(new CustomEvent("mydevtools:desktop-data-mutated"));
  return JSON.parse(res.body || "{}") as ImportResult;
}
