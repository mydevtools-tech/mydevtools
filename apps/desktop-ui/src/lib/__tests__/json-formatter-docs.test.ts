import { docTime, formatDocDate } from '@/lib/json-formatter-docs'

describe('docTime', () => {
  it('reads epoch ms from a number and from a numeric string', () => {
    expect(docTime(1756800000000)).toBe(1756800000000)
    expect(docTime('1756800000000')).toBe(1756800000000)
  })

  it('reads ISO strings', () => {
    expect(docTime('2026-09-02T00:00:00.000Z')).toBe(Date.parse('2026-09-02T00:00:00.000Z'))
  })

  it('returns 0 for missing or unparseable values', () => {
    expect(docTime(undefined)).toBe(0)
    expect(docTime('')).toBe(0)
    expect(docTime('not a date')).toBe(0)
  })

  it('sorts newest first', () => {
    const docs = [{ updatedAt: 1 }, { updatedAt: '2026-09-02T00:00:00.000Z' }, { updatedAt: 2 }]
    const sorted = [...docs].sort((a, b) => docTime(b.updatedAt) - docTime(a.updatedAt))
    expect(sorted.map((d) => d.updatedAt)).toEqual(['2026-09-02T00:00:00.000Z', 2, 1])
  })
})

describe('formatDocDate', () => {
  it('renders a real date instead of raw epoch ms', () => {
    expect(formatDocDate(1756800000000)).toBe(new Date(1756800000000).toLocaleString())
  })

  it('renders nothing when there is no usable timestamp', () => {
    expect(formatDocDate(undefined)).toBe('')
    expect(formatDocDate('nope')).toBe('')
  })
})
