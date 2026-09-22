import {
  appendEvent,
  deriveRecents,
  deriveCounts,
  DEDUPE_WINDOW_MS,
  MAX_EVENTS,
  type ToolUsage,
} from '@/lib/tool-usage-utils'

const ev = (toolId: string, timestamp: number, url = `/app/${toolId}`): ToolUsage => ({
  toolId,
  timestamp,
  url,
})

describe('appendEvent', () => {
  it('keeps repeat opens of the same tool once they are outside the dedupe window', () => {
    const log = [ev('a', 1000)]
    const out = appendEvent(log, ev('a', 2000), 2000)
    expect(out).toHaveLength(2)
    expect(out[0]).toEqual(ev('a', 2000))
  })

  it('drops a repeat of the newest tool inside the dedupe window', () => {
    const log = [ev('a', 1000)]
    const out = appendEvent(log, ev('a', 1000 + DEDUPE_WINDOW_MS - 1), 2000)
    expect(out).toBe(log)
  })

  it('still records a different tool inside the dedupe window', () => {
    const log = [ev('a', 1000)]
    const out = appendEvent(log, ev('b', 1001), 2000)
    expect(out.map((e) => e.toolId)).toEqual(['b', 'a'])
  })

  it('prunes events older than 90 days', () => {
    const now = 90 * 24 * 60 * 60 * 1000 + 5000
    const old = ev('old', 1000) // ~epoch, older than 90d before now
    const out = appendEvent([old], ev('new', now), now)
    expect(out.map((e) => e.toolId)).toEqual(['new'])
  })

  it('caps total events at MAX_EVENTS, keeping newest', () => {
    const now = 10_000_000
    const log: ToolUsage[] = Array.from({ length: MAX_EVENTS }, (_, i) =>
      ev(`t${i}`, now - i),
    )
    const out = appendEvent(log, ev('newest', now + 1), now + 1)
    expect(out).toHaveLength(MAX_EVENTS)
    expect(out[0].toolId).toBe('newest')
    expect(out.some((e) => e.toolId === `t${MAX_EVENTS - 1}`)).toBe(false)
  })
})

describe('deriveRecents', () => {
  it('dedupes by toolId keeping newest, newest-first, sliced', () => {
    const log = [ev('a', 300), ev('b', 200), ev('a', 100)]
    const out = deriveRecents(log, 5)
    expect(out.map((e) => e.toolId)).toEqual(['a', 'b'])
    expect(out[0].timestamp).toBe(300)
  })

  it('respects the limit', () => {
    const log = [ev('a', 3), ev('b', 2), ev('c', 1)]
    expect(deriveRecents(log, 2).map((e) => e.toolId)).toEqual(['a', 'b'])
  })
})

describe('deriveCounts', () => {
  it('counts launches per tool with latest url and lastUsed', () => {
    const log = [ev('a', 300, '/app/a?v=2'), ev('b', 250), ev('a', 100, '/app/a?v=1')]
    const counts = deriveCounts(log)
    expect(counts.a.count).toBe(2)
    expect(counts.a.lastUsed).toBe(300)
    expect(counts.a.url).toBe('/app/a?v=2')
    expect(counts.b.count).toBe(1)
  })
})
