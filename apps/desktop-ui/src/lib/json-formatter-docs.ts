/**
 * Timestamp helpers for saved JSON formatter documents.
 *
 * The local Rust router stores `createdAt`/`updatedAt` as epoch milliseconds,
 * but rows written by older builds carry ISO strings — both shapes reach the UI.
 */

/** Epoch ms for a timestamp in either shape; 0 when missing or unparseable. */
export function docTime(value: string | number | undefined | null): number {
  if (value === undefined || value === null || value === '') return 0
  const parsed =
    typeof value === 'string' && !/^\d+$/.test(value) ? new Date(value) : new Date(Number(value))
  const ms = parsed.getTime()
  return Number.isNaN(ms) ? 0 : ms
}

/** Localized date for the load dialog; empty string when there is nothing to show. */
export function formatDocDate(value: string | number | undefined | null): string {
  const ms = docTime(value)
  return ms === 0 ? '' : new Date(ms).toLocaleString()
}
