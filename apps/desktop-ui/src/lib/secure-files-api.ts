/**
 * Secure Files — Rust-backed API (`/api/v1/secure-files/*`) plus native
 * pickers. Files are encrypted/decrypted in Rust; the webview only ever sees
 * plaintext bytes for the file being previewed.
 */
import { apiRequest } from "@/lib/backend-api"
import type { SecureFileEntry } from "@/lib/secure-files"

const BASE = "/api/v1/secure-files"

/** `exists` is false when `dir` is set but missing (restored backup, unplugged drive). */
export type SecureFilesSettings = { dir: string | null; exists: boolean; unlocked: boolean }
/** `size` is plaintext bytes; `physical` is what the folder occupies on disk
 *  (container overhead included), counting readable objects only. */
export type StorageTotals = { count: number; size: number; physical: number }
export type ListResult = { totals: StorageTotals; files: SecureFileEntry[]; errors: { id: string; error: string }[] }
/** `dirs` lists every walked directory (logical path) — including empty ones. */
export type ImportResult = { imported: SecureFileEntry[]; errors: { path: string; error: string }[]; dirs: string[] }
export type SecureFilesOperation = {
  id: string | null
  kind?: "import" | "export" | "rename" | "replace" | "folder_rename"
  status: "idle" | "running" | "completed" | "cancelled" | "failed"
  done: number
  total: number
  filesCompleted: number | null
  filesTotal: number | null
  error?: string | null
}

export const getSecureFilesSettings = () => apiRequest<SecureFilesSettings>("GET", `${BASE}/settings`)
export const setSecureFilesDir = (dir: string) =>
  apiRequest<{ dir: string; moved: number }>("PUT", `${BASE}/settings`, { dir })
export const listSecureFiles = () => apiRequest<ListResult>("GET", `${BASE}/files`)
export const importSecureFiles = (paths: string[], dir: string) =>
  apiRequest<ImportResult>("POST", `${BASE}/files/import`, { paths, dir })
export const patchSecureFile = (id: string, patch: { name?: string; dir?: string }) =>
  apiRequest<SecureFileEntry>("PATCH", `${BASE}/files/${id}`, patch)
export const replaceSecureFile = (id: string, path: string) =>
  apiRequest<SecureFileEntry>("POST", `${BASE}/files/${id}/replace`, { path })
export const exportSecureFile = (id: string, path: string) =>
  apiRequest<void>("POST", `${BASE}/files/${id}/export`, { path })
export const deleteSecureFile = (id: string) => apiRequest<void>("DELETE", `${BASE}/files/${id}`)
/** Plaintext bytes moved by the stream in flight; `total` 0 = nothing running. */
export const getSecureFilesProgress = () => apiRequest<SecureFilesOperation>("GET", `${BASE}/progress`)
/** Asks the stream in flight to stop; it unwinds and leaves the store untouched. */
export const cancelSecureFilesOp = (operationId?: string | null) =>
  apiRequest<void>("POST", `${BASE}/progress/cancel`, operationId ? { operationId } : undefined)
export const renameSecureFolder = (from: string, to: string) =>
  apiRequest<{ updated: number }>("POST", `${BASE}/folders/rename`, { from, to })
export const deleteSecureFolder = (dir: string) =>
  apiRequest<{ deleted: number }>("POST", `${BASE}/folders/delete`, { dir })

/** Decrypted bytes via the raw-binary Tauri command (no base64 round-trip). */
export async function readSecureFile(id: string): Promise<ArrayBuffer> {
  const { invoke } = await import("@tauri-apps/api/core")
  return invoke<ArrayBuffer>("secure_file_read", { id })
}

// Native dialogs — dynamic imports so the web bundle never pulls the plugin.

export async function pickFiles(): Promise<string[]> {
  const { open } = await import("@tauri-apps/plugin-dialog")
  const res = await open({ multiple: true })
  return res ?? []
}

export async function pickFolder(): Promise<string | null> {
  const { open } = await import("@tauri-apps/plugin-dialog")
  return open({ directory: true })
}

export async function pickSavePath(defaultName: string): Promise<string | null> {
  const { save } = await import("@tauri-apps/plugin-dialog")
  return save({ defaultPath: defaultName })
}
