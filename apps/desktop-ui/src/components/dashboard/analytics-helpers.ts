import type React from 'react'
import { sidebarData } from '@/components/sidebar/data/sidebar-data'
import { findItemByUrl } from '@/components/dashboard/types'
import { type DashboardAnalyticsSummary } from '@/lib/dashboard-analytics-api'

export function sumTrackedItems(d: DashboardAnalyticsSummary): number {
  return (
    d.passwordEntries +
    d.bookmarks +
    d.bookmarkFolders +
    d.tasks.total +
    d.projects +
    d.nosqlConnections +
    d.notes +
    d.apiClientCollections +
    d.apiClientEnvironments +
    d.apiClientHistoryEntries +
    d.jsonFormatterDocuments +
    (d.codeSnippets ?? 0)
  )
}

export function timeAgo(date: Date): string {
  const secs = Math.floor((Date.now() - date.getTime()) / 1000)
  if (secs < 10) return 'just now'
  if (secs < 60) return `${secs}s ago`
  const mins = Math.floor(secs / 60)
  if (mins < 60) return `${mins}m ago`
  return `${Math.floor(mins / 60)}h ago`
}

/**
 * Resolve a usage-history key to a ToolItem.
 *
 * Usage is keyed by route path (`/app/json-formatter`). The positional
 * "groupIndex-itemIndex[-subIndex]" lookup below is kept for history written
 * before that, and is intentionally the fallback: positions shift whenever
 * sidebar-data is reordered.
 */
export function findToolById(id: string): { title: string; icon?: React.ElementType } | undefined {
  const byUrl = findItemByUrl(id)
  if (byUrl) return { title: byUrl.title, icon: byUrl.icon as React.ElementType | undefined }

  const parts = id.split('-').map(Number)
  if (parts.some(isNaN) || parts.length < 2) return undefined
  const [gi, ii, si] = parts
  const group = sidebarData.navGroups[gi]
  if (!group) return undefined
  const item = group.items[ii]
  if (!item) return undefined
  if (si !== undefined) {
    const sub = item.items?.[si]
    return sub ? { title: sub.title, icon: (sub.icon ?? item.icon) as React.ElementType | undefined } : undefined
  }
  return { title: item.title, icon: item.icon as React.ElementType | undefined }
}
