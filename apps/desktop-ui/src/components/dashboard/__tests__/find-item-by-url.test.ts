import { findItemByUrl, findItemById, createItemId } from '@/components/dashboard/types'
import { sidebarData } from '@/components/sidebar/data/sidebar-data'

describe('findItemByUrl', () => {
  it('resolves a top-level tool route to its sidebar item', () => {
    expect(findItemByUrl('/app/json-formatter')?.url?.toString()).toBe('/app/json-formatter')
  })

  it('resolves every sidebar tool that has a url', () => {
    const urls: string[] = []
    for (const group of sidebarData.navGroups) {
      for (const item of group.items) {
        if (item.url) urls.push(item.url.toString())
        for (const sub of item.items ?? []) {
          if (sub.url) urls.push(sub.url.toString())
        }
      }
    }
    expect(urls.length).toBeGreaterThan(50)
    const unresolved = urls.filter((url) => !findItemByUrl(url))
    expect(unresolved).toEqual([])
  })

  it('inherits the parent icon for a sub-item that has none', () => {
    const parent = sidebarData.navGroups
      .flatMap((g) => g.items)
      .find((item) => item.icon && item.items?.some((sub) => sub.url && !sub.icon))
    if (!parent) return // no such shape in the current sidebar data
    const sub = parent.items!.find((s) => s.url && !s.icon)!
    expect(findItemByUrl(sub.url!.toString())?.icon).toBe(parent.icon)
  })

  it('returns undefined for unknown, empty and non-tool paths', () => {
    expect(findItemByUrl('/app/does-not-exist')).toBeUndefined()
    expect(findItemByUrl('')).toBeUndefined()
    expect(findItemByUrl(null)).toBeUndefined()
    expect(findItemByUrl('/dashboard')).toBeUndefined()
  })

  it('is not interchangeable with the positional id lookup — the bug this replaces', () => {
    // Usage history stores route paths. Feeding one to findItemById parses
    // "app"/"json" as indices, yields NaN, and silently drops the entry.
    expect(findItemById('/app/json-formatter')).toBeUndefined()
    expect(findItemById(createItemId(0, 0))).toBeDefined()
  })
})
