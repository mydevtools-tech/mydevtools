import { apiFetch } from '@/lib/desktop/api-fetch'

export type DashboardTaskStats = {
  total: number
  completed: number
  ongoing: number
  notStarted: number
}

/**
 * Secure Files storage, measured from the object folder itself — so the count
 * and the bytes on disk are real even while the vault is locked. `unlocked`
 * says whether the file names behind those bytes are readable right now.
 */
export type DashboardFileStats = {
  count: number
  physicalBytes: number
  lastModifiedAt: number
  configured: boolean
  unlocked: boolean
}

export type DashboardAnalyticsSummary = {
  passwordEntries: number
  bookmarks: number
  bookmarkFolders: number
  tasks: DashboardTaskStats
  projects: number
  nosqlConnections: number
  notes: number
  apiClientCollections: number
  apiClientEnvironments: number
  apiClientHistoryEntries: number
  jsonFormatterDocuments: number
  codeSnippets: number
  files: DashboardFileStats
}

function num(v: unknown): number {
  return typeof v === 'number' && Number.isFinite(v) ? v : 0
}

function bool(v: unknown): boolean {
  return v === true
}

function normalizeFiles(f: unknown): DashboardFileStats {
  const obj = (f && typeof f === 'object' ? f : {}) as Record<string, unknown>
  return {
    count: num(obj.count),
    physicalBytes: num(obj.physicalBytes),
    lastModifiedAt: num(obj.lastModifiedAt),
    configured: bool(obj.configured),
    unlocked: bool(obj.unlocked),
  }
}

function normalizeTasks(t: unknown): DashboardTaskStats {
  const obj = (t && typeof t === 'object' ? t : {}) as Record<string, unknown>
  return {
    total: num(obj.total),
    completed: num(obj.completed),
    ongoing: num(obj.ongoing),
    notStarted: num(obj.notStarted),
  }
}

export const EMPTY_ANALYTICS_SUMMARY: DashboardAnalyticsSummary = {
  passwordEntries: 0,
  bookmarks: 0,
  bookmarkFolders: 0,
  tasks: normalizeTasks(null),
  projects: 0,
  nosqlConnections: 0,
  notes: 0,
  apiClientCollections: 0,
  apiClientEnvironments: 0,
  apiClientHistoryEntries: 0,
  jsonFormatterDocuments: 0,
  codeSnippets: 0,
  files: normalizeFiles(null),
}

/** Shape the local router returns; every field is validated before use. */
export function normalizeAnalyticsSummary(raw: unknown): DashboardAnalyticsSummary {
  const o = (raw && typeof raw === 'object' ? raw : {}) as Record<string, unknown>
  return {
    passwordEntries: num(o.passwordEntries),
    bookmarks: num(o.bookmarks),
    bookmarkFolders: num(o.bookmarkFolders),
    tasks: normalizeTasks(o.tasks),
    projects: num(o.projects),
    nosqlConnections: num(o.nosqlConnections),
    notes: num(o.notes),
    apiClientCollections: num(o.apiClientCollections),
    apiClientEnvironments: num(o.apiClientEnvironments),
    apiClientHistoryEntries: num(o.apiClientHistoryEntries),
    jsonFormatterDocuments: num(o.jsonFormatterDocuments),
    codeSnippets: num(o.codeSnippets),
    files: normalizeFiles(o.files),
  }
}

/**
 * Live counts from the local store (SQLCipher via the Rust router), computed
 * there with one grouped query — the UI never downloads rows just to count
 * them, so this stays cheap enough to re-run on every dashboard visit.
 *
 * Outside the desktop app there is no local router, so the request 404s and the
 * panel renders zeros rather than an error.
 */
export async function fetchDashboardAnalyticsSummary(): Promise<DashboardAnalyticsSummary> {
  const res = await apiFetch('/api/backend/dashboard/analytics')
  if (!res.ok) return EMPTY_ANALYTICS_SUMMARY
  return normalizeAnalyticsSummary(await res.json())
}
