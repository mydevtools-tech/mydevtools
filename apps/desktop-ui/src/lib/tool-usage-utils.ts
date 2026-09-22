export interface ToolUsage {
  toolId: string
  timestamp: number
  url: string
}

export const MAX_EVENTS = 500
export const MAX_AGE_DAYS = 90

const MAX_AGE_MS = MAX_AGE_DAYS * 24 * 60 * 60 * 1000

/** Repeat opens of the same tool inside this window count once. */
export const DEDUPE_WINDOW_MS = 1000

/**
 * Prepend `event`, then prune by age (relative to `now`) and total count.
 *
 * A repeat of the newest event's tool within `DEDUPE_WINDOW_MS` is dropped:
 * React StrictMode mounts effects twice in development, and that would
 * otherwise double every launch count.
 */
export function appendEvent(
  log: ToolUsage[],
  event: ToolUsage,
  now: number = Date.now(),
): ToolUsage[] {
  const newest = log[0]
  if (
    newest &&
    newest.toolId === event.toolId &&
    event.timestamp - newest.timestamp < DEDUPE_WINDOW_MS
  ) {
    return log
  }

  const cutoff = now - MAX_AGE_MS
  return [event, ...log].filter((e) => e.timestamp >= cutoff).slice(0, MAX_EVENTS)
}

/** Newest-first, deduped by toolId (keep newest), sliced to `limit`. */
export function deriveRecents(log: ToolUsage[], limit: number): ToolUsage[] {
  const sorted = [...log].sort((a, b) => b.timestamp - a.timestamp)
  const seen = new Set<string>()
  const out: ToolUsage[] = []
  for (const e of sorted) {
    if (seen.has(e.toolId)) continue
    seen.add(e.toolId)
    out.push(e)
    if (out.length >= limit) break
  }
  return out
}

/** Per-tool launch count, latest url, and max timestamp. */
export function deriveCounts(
  log: ToolUsage[],
): Record<string, { count: number; url?: string; lastUsed: number }> {
  const out: Record<string, { count: number; url?: string; lastUsed: number }> = {}
  for (const e of log) {
    const cur = out[e.toolId]
    if (!cur) {
      out[e.toolId] = { count: 1, url: e.url, lastUsed: e.timestamp }
    } else {
      cur.count += 1
      if (e.timestamp > cur.lastUsed) {
        cur.lastUsed = e.timestamp
        cur.url = e.url
      }
    }
  }
  return out
}
