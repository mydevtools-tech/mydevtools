'use client'

import React, { useState, useEffect, useMemo } from 'react'
import dynamic from 'next/dynamic'
import { ArrowLeft, ArrowRight, BarChart3, LayoutGrid } from 'lucide-react'
import { useTranslations } from 'next-intl'
import { sidebarData } from '@/components/sidebar/data/sidebar-data'
import { usePinnedToolsStore, usePinnedToolsForActiveWorkspace } from '@/store/pinned-tools-store'
import { useWorkspaceStore } from '@/store/workspace-store'
import { useToolUsage } from '@/hooks/use-tool-usage'
import useAuth from '@/utils/useAuth'
import { Skeleton } from '@/components/ui/skeleton'
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs'
import { TooltipProvider } from '@/components/ui/tooltip'
import {
  type FavoriteItem,
  type RenderToolItem,
  type RenderGroup,
  createItemId,
  findItemByUrl,
  getTotalToolCount,
  POPULAR_TOOL_URLS,
} from '@/components/dashboard/types'
import { DashboardHero } from '@/components/dashboard/dashboard-hero'
import { DashboardSearchBar } from '@/components/dashboard/dashboard-search-bar'
import { DashboardPinnedSection } from '@/components/dashboard/dashboard-pinned-section'
import { DashboardWhatsNew } from '@/components/dashboard/dashboard-whats-new'
import { DashboardRecentTools } from '@/components/dashboard/dashboard-recent-tools'
import { ActivityLogDrawer } from '@/components/dashboard/activity/activity-log-drawer'
import { DashboardToolGrid } from '@/components/dashboard/dashboard-tool-grid'
import { DashboardFeatured } from '@/components/dashboard/dashboard-featured'
import { RevealItem } from '@/components/dashboard/dashboard-reveal'
import { AppLoadingScreen } from '@/components/app-loading-screen'


// Lazy-load the analytics panel — it's behind a tab click, not in the critical path
const DashboardAnalyticsPanel = dynamic(
  () =>
    import('@/components/dashboard/dashboard-analytics-panel').then(
      (m) => m.DashboardAnalyticsPanel,
    ),
  {
    loading: () => (
      <div className="flex flex-col gap-2">
        <Skeleton className="h-24 w-full rounded-xl" />
        <div className="grid grid-cols-2 gap-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-6">
          {[...Array(10)].map((_, i) => (
            <Skeleton key={i} className="h-14 rounded-lg" />
          ))}
        </div>
      </div>
    ),
  },
)

// ─── Dashboard Page ─────────────────────────────────────────────────────────

const DashboardPage: React.FC = () => {
  const tTabs = useTranslations('Dashboard.tabs')
  const { user, loading } = useAuth(false)
  const pinnedToolUrls = usePinnedToolsForActiveWorkspace()
  const togglePinKeyed = usePinnedToolsStore((s) => s.togglePin)
  const activeWorkspaceId = useWorkspaceStore((s) => s.activeWorkspaceId)
  const togglePin = (url: string) => {
    if (activeWorkspaceId) togglePinKeyed(activeWorkspaceId, url)
  }
  const isPinned = (url: string) => pinnedToolUrls.includes(url)
  const { getRecentlyUsedTools } = useToolUsage()
  const [recentlyUsedItems, setRecentlyUsedItems] = useState<FavoriteItem[]>([])
  const [searchQuery, setSearchQuery] = useState('')
  const [filterGroup, setFilterGroup] = useState<string | null>(null)
  const [showFilters, setShowFilters] = useState(false)
  // Home-screen model: 'home' shows a curated launchpad; 'all' opens the full catalog.
  const [view, setView] = useState<'home' | 'all'>('home')

  const totalTools = useMemo(() => getTotalToolCount(), [])

  // Get recently used tools. Usage is keyed by route path; `usage.url` is the
  // fallback for entries written before that (their toolId was a bare slug).
  useEffect(() => {
    const recent = getRecentlyUsedTools(8)
    const items = recent
      .map((usage) => {
        const item = findItemByUrl(usage.toolId) ?? findItemByUrl(usage.url)
        return item ? { id: usage.toolId, timestamp: usage.timestamp, ...item } : null
      })
      .filter((item): item is FavoriteItem => !!item)
    setRecentlyUsedItems(items)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  // Tools with a badge — shown in the "What's New" section
  const whatsNewItems = useMemo<RenderToolItem[]>(() => {
    const items: RenderToolItem[] = []
    sidebarData.navGroups.forEach((group, groupIndex) => {
      group.items.forEach((item, itemIndex) => {
        if (item.badge) {
          items.push({ ...item, originalId: createItemId(groupIndex, itemIndex) })
        }
        item.items?.forEach((subItem, subIndex) => {
          if (subItem.badge) {
            items.push({
              ...subItem,
              icon: subItem.icon || item.icon,
              originalId: createItemId(groupIndex, itemIndex, subIndex),
            })
          }
        })
      })
    })
    return items
  }, [])

  // Pinned tools — derived from URL-keyed store, preserving pin order
  const pinnedItems = useMemo<RenderToolItem[]>(() => {
    if (pinnedToolUrls.length === 0) return []
    const found: RenderToolItem[] = []
    sidebarData.navGroups.forEach((group, groupIndex) => {
      group.items.forEach((item, itemIndex) => {
        const url = item.url?.toString() ?? ''
        if (pinnedToolUrls.includes(url)) {
          found.push({ ...item, originalId: createItemId(groupIndex, itemIndex) })
        }
        item.items?.forEach((subItem, subIndex) => {
          const subUrl = subItem.url?.toString() ?? ''
          if (pinnedToolUrls.includes(subUrl)) {
            found.push({
              ...subItem,
              icon: subItem.icon || item.icon,
              originalId: createItemId(groupIndex, itemIndex, subIndex),
            })
          }
        })
      })
    })
    return pinnedToolUrls
      .map((url) => found.find((i) => i.url?.toString() === url))
      .filter((i): i is RenderToolItem => !!i)
  }, [pinnedToolUrls])

  // Filter tools based on search query and active group filter
  const filteredGroups = useMemo<RenderGroup[]>(() => {
    const normalizedQuery = searchQuery.trim().toLowerCase()
    const mobileFilteredGroups = sidebarData.navGroups
      .map((group, groupIndex) => {
        if (filterGroup && group.title !== filterGroup) return null

        const visibleItems = group.items.map((item, itemIndex) => ({ item, itemIndex }))

        const searchableItems = visibleItems.flatMap<RenderToolItem>(({ item, itemIndex }) => {
          if (item.items?.length) {
            return item.items
              .map((subItem, subIndex) => ({
                ...subItem,
                icon: subItem.icon || item.icon,
                originalId: createItemId(groupIndex, itemIndex, subIndex),
              }))
              .filter((subItem) => {
                if (!normalizedQuery) return true
                const title = (subItem.title || '').toLowerCase()
                const description = (subItem.description || '').toLowerCase()
                return title.includes(normalizedQuery) || description.includes(normalizedQuery)
              })
          }

          const normalizedTitle = (item.title || '').toLowerCase()
          const normalizedDescription = (item.description || '').toLowerCase()
          if (
            normalizedQuery &&
            !normalizedTitle.includes(normalizedQuery) &&
            !normalizedDescription.includes(normalizedQuery)
          ) {
            return []
          }
          return [{ ...item, originalId: createItemId(groupIndex, itemIndex) }]
        })

        const groupMatches =
          normalizedQuery && group.title.toLowerCase().includes(normalizedQuery)
        const finalItems =
          groupMatches && searchableItems.length === 0
            ? visibleItems
                .filter(({ item }) => !item.items)
                .map(({ item, itemIndex }) => ({
                  ...item,
                  originalId: createItemId(groupIndex, itemIndex),
                }))
            : searchableItems

        const dedupedItems = Array.from(
          new Map(finalItems.map((item) => [item.originalId || item.title, item])).values(),
        )

        const itemsToRender: RenderToolItem[] = normalizedQuery
          ? dedupedItems
          : visibleItems.map(({ item, itemIndex }) => {
              if (item.items?.length) {
                return {
                  ...item,
                  items: item.items.map((subItem, subIndex) => ({
                    ...subItem,
                    icon: subItem.icon || item.icon,
                    originalId: createItemId(groupIndex, itemIndex, subIndex),
                  })),
                  originalId: createItemId(groupIndex, itemIndex),
                }
              }
              return { ...item, originalId: createItemId(groupIndex, itemIndex) }
            })
        if (itemsToRender.length === 0) return null

        return {
          ...group,
          items: itemsToRender,
          originalGroupIndex: groupIndex,
        }
      })
      .filter((group): group is RenderGroup => group !== null)

    return mobileFilteredGroups
  }, [searchQuery, filterGroup])

  // Popular tools shown in the no-results state
  const popularItems = useMemo<RenderToolItem[]>(() => {
    const found: RenderToolItem[] = []
    sidebarData.navGroups.forEach((group, gi) => {
      group.items.forEach((item, ii) => {
        const url = item.url?.toString() ?? ''
        if (POPULAR_TOOL_URLS.includes(url)) {
          found.push({ ...item, originalId: createItemId(gi, ii) })
        }
        item.items?.forEach((sub, si) => {
          const subUrl = sub.url?.toString() ?? ''
          if (POPULAR_TOOL_URLS.includes(subUrl)) {
            found.push({
              ...sub,
              icon: sub.icon || item.icon,
              originalId: createItemId(gi, ii, si),
            })
          }
        })
      })
    })
    return POPULAR_TOOL_URLS.map((url) => found.find((i) => i.url?.toString() === url)).filter(
      (i): i is RenderToolItem => !!i,
    )
  }, [])

  if (loading) {
    return <AppLoadingScreen />
  }

  const toolCardProps = { user, isPinned, togglePin }

  // Home-screen model: curated launchpad by default; the full catalog only shows
  // when the user searches, filters, or explicitly opens "Browse all".
  const showCurated = view === 'home' && !searchQuery && !filterGroup
  const isBrowsing = !!searchQuery || !!filterGroup || view === 'all'

  return (
    <TooltipProvider delayDuration={300} disableHoverableContent>
    <div className="relative min-h-screen bg-background/50 dashboard-grid-bg mobile-nav-offset">
      <div className="dash-ambient -z-10" aria-hidden />
      {/* ── Mobile Sticky Header (outside padded container for full-bleed) ── */}
      <DashboardHero
        totalTools={totalTools}
        pinnedCount={pinnedItems.length}
        recentCount={recentlyUsedItems.length}
        mobileOnly
      />

      <div className="px-3 pt-4 md:px-8 md:pt-8 pb-24 md:pb-12">
        <div className="max-w-7xl mx-auto space-y-5 md:space-y-8">
          {/* ── Desktop Hero (inside padded container for alignment) ── */}
          <RevealItem index={0}>
            <DashboardHero
              totalTools={totalTools}
              pinnedCount={pinnedItems.length}
              recentCount={recentlyUsedItems.length}
              desktopOnly
            />
          </RevealItem>
          <Tabs defaultValue="apps" className="w-full">
            <div className="mb-3 flex items-center justify-between gap-3">
              <TabsList className="grid h-auto w-full grid-cols-2 gap-1 rounded-xl border border-border/50 bg-muted/50 p-1 shadow-sm backdrop-blur-sm sm:inline-flex sm:w-auto sm:justify-start">
                <TabsTrigger value="apps" className="gap-1.5 text-xs sm:text-sm">
                  <LayoutGrid className="h-3.5 w-3.5 shrink-0" aria-hidden />
                  {tTabs('apps')}
                </TabsTrigger>
                <TabsTrigger value="analytics" className="gap-1.5 text-xs sm:text-sm">
                  <BarChart3 className="h-3.5 w-3.5 shrink-0" aria-hidden />
                  {tTabs('analytics')}
                </TabsTrigger>
              </TabsList>
              <ActivityLogDrawer />
            </div>

            <TabsContent
              value="apps"
              className="mt-0 space-y-4 md:space-y-6 focus-visible:outline-none"
            >
              {/* ── Search ── */}
              <DashboardSearchBar
                searchQuery={searchQuery}
                onSearchChange={setSearchQuery}
                filterGroup={filterGroup}
                onFilterGroupChange={setFilterGroup}
                showFilters={showFilters}
                onShowFiltersChange={setShowFilters}
                totalTools={totalTools}
              />



              {/* ── Curated home (launchpad) ── */}
              {showCurated && (
                <>
                  {/* Pinned — your go-to tools */}
                  <RevealItem index={1}>
                    <DashboardPinnedSection
                      pinnedItems={pinnedItems}
                      toolCardProps={toolCardProps}
                      searchQuery={searchQuery}
                      filterGroup={filterGroup}
                    />
                  </RevealItem>

                  {/* Recently used — jump back in */}
                  <RevealItem index={2}>
                    <DashboardRecentTools
                      recentItems={recentlyUsedItems}
                      toolCardProps={toolCardProps}
                      user={user}
                      searchQuery={searchQuery}
                    />
                  </RevealItem>

                  {/* Suggested / popular — discovery */}
                  <RevealItem index={3}>
                    <DashboardFeatured
                      items={popularItems}
                      toolCardProps={toolCardProps}
                      searchQuery={searchQuery}
                      filterGroup={filterGroup}
                    />
                  </RevealItem>

                  {/* What's new */}
                  <RevealItem index={4}>
                    <DashboardWhatsNew
                      whatsNewItems={whatsNewItems}
                      toolCardProps={toolCardProps}
                      searchQuery={searchQuery}
                      filterGroup={filterGroup}
                    />
                  </RevealItem>

                  {/* Browse-all entry — the door to the full catalog */}
                  <RevealItem index={6}>
                    <button
                      type="button"
                      onClick={() => setView('all')}
                      className="group flex w-full items-center gap-4 rounded-2xl border border-border/60 bg-gradient-to-br from-primary/[0.05] to-transparent p-5 text-left transition-all duration-200 hover:border-primary/40 hover:shadow-md motion-safe:hover:-translate-y-0.5"
                    >
                      <span className="flex h-11 w-11 shrink-0 items-center justify-center rounded-xl bg-gradient-to-br from-primary/15 to-violet-500/10 text-primary ring-1 ring-inset ring-border/50">
                        <LayoutGrid className="h-5 w-5" />
                      </span>
                      <div className="min-w-0 flex-1">
                        <p className="font-semibold text-foreground">
                          Browse all {totalTools} tools
                        </p>
                        <p className="mt-0.5 text-sm text-muted-foreground">
                          Explore the full toolkit by category
                        </p>
                      </div>
                      <ArrowRight className="h-5 w-5 shrink-0 text-muted-foreground transition-transform group-hover:translate-x-0.5 group-hover:text-foreground" />
                    </button>
                  </RevealItem>
                </>
              )}

              {/* ── Full catalog (searching, filtering, or "Browse all") ── */}
              {isBrowsing && (
                <RevealItem index={1}>
                  {view === 'all' && !searchQuery && !filterGroup && (
                    <button
                      type="button"
                      onClick={() => setView('home')}
                      className="mb-3 inline-flex items-center gap-1.5 rounded-lg px-2.5 py-1.5 text-sm font-medium text-muted-foreground transition-colors hover:bg-muted/50 hover:text-foreground"
                    >
                      <ArrowLeft className="h-4 w-4" />
                      Back to home
                    </button>
                  )}
                  <DashboardToolGrid
                    filteredGroups={filteredGroups}
                    popularItems={popularItems}
                    toolCardProps={toolCardProps}
                    searchQuery={searchQuery}
                    filterGroup={filterGroup}
                  />
                </RevealItem>
              )}
            </TabsContent>

            <TabsContent value="analytics" className="mt-0 rounded-2xl focus-visible:outline-none">
              <DashboardAnalyticsPanel />
            </TabsContent>
          </Tabs>
        </div>
      </div>
    </div>
    </TooltipProvider>
  )
}

export default DashboardPage
