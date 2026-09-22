'use client'

import { useCallback, useEffect, useMemo, useState } from 'react'
import { useTranslations } from 'next-intl'
import Link from 'next/link'
import {
  Activity,
  BarChart3,
  Bookmark,
  Boxes,
  Braces,
  Briefcase,
  Clock,
  Code2,
  Database,
  Eye,
  EyeOff,
  FolderLock,
  FolderOpen,
  HardDrive,
  History,
  KeyRound,
  ListTodo,
  RefreshCw,
  Server,
  StickyNote,
  Zap,
} from 'lucide-react'
import { Button } from '@/components/ui/button'
import {
  fetchDashboardAnalyticsSummary,
  type DashboardAnalyticsSummary,
} from '@/lib/dashboard-analytics-api'
import { cn } from '@/lib/utils'
import { formatBytes } from '@/lib/format-bytes'
import { useToolUsage } from '@/hooks/use-tool-usage'
import { type ToolUsage } from '@/lib/tool-usage-utils'
import { DonutChart } from './charts/donut-chart'
import { ActivityBarChart } from './charts/activity-bar-chart'
import { TopToolsBars, type TopTool } from './charts/top-tools-bars'
import { type DonutSegment } from './charts/chart-utils'
import { sumTrackedItems, timeAgo, findToolById } from './analytics-helpers'
import { AnalyticsSkeleton, SectionHeader, MetricChip, KpiCard, EmptyGroupHint, type GroupColor } from './analytics-cells'
import { TaskCard } from './task-card'


// ─── Panel ────────────────────────────────────────────────────────────────────

/** Background refresh cadence while the window is on screen. */
const REFRESH_INTERVAL_MS = 30_000

type UsageSnapshot = {
  events: ToolUsage[]
  counts: ReturnType<ReturnType<typeof useToolUsage>['getToolUsageCounts']>
}

const EMPTY_USAGE: UsageSnapshot = { events: [], counts: {} }

export function DashboardAnalyticsPanel() {
  const t = useTranslations('Dashboard.analytics')
  const [data, setData] = useState<DashboardAnalyticsSummary | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [refreshedAt, setRefreshedAt] = useState<Date | null>(null)
  const [showEmpty, setShowEmpty] = useState(false)

  const { getUsageEvents, getToolUsageCounts } = useToolUsage()
  const [usage, setUsage] = useState<UsageSnapshot>(EMPTY_USAGE)

  /**
   * `silent` keeps the skeleton off for background refreshes — swapping the
   * whole panel for a skeleton every 30s reads as a broken page.
   */
  const load = useCallback(async (silent = false) => {
    if (!silent) setLoading(true)
    setError(null)
    try {
      const summary = await fetchDashboardAnalyticsSummary()
      setData(summary)
      // Usage history lives in localStorage; re-read it on the same tick so the
      // launch counts and activity chart never lag the stored counts.
      setUsage({ events: getUsageEvents(), counts: getToolUsageCounts() })
      setRefreshedAt(new Date())
    } catch (e) {
      setError(e instanceof Error ? e.message : t('loadError'))
      if (!silent) setData(null)
    } finally {
      if (!silent) setLoading(false)
    }
  }, [t, getUsageEvents, getToolUsageCounts])

  useEffect(() => { void load() }, [load])

  // Keep the panel live: poll while the window is on screen, and refresh the
  // moment it comes back — data changes in the tools, not in here, so mount-time
  // numbers go stale as soon as the user does anything.
  useEffect(() => {
    const isVisible = () => typeof document === 'undefined' || document.visibilityState === 'visible'
    const refresh = () => { if (isVisible()) void load(true) }

    const id = setInterval(refresh, REFRESH_INTERVAL_MS)
    window.addEventListener('focus', refresh)
    document.addEventListener('visibilitychange', refresh)
    return () => {
      clearInterval(id)
      window.removeEventListener('focus', refresh)
      document.removeEventListener('visibilitychange', refresh)
    }
  }, [load])

  const { events: usageEvents, counts: toolUsageCounts } = usage

  const topUsedTools = useMemo<TopTool[]>(() => {
    return Object.entries(toolUsageCounts)
      .sort(([, a], [, b]) => b.count - a.count)
      .slice(0, 5)
      .map(([id, info]) => {
        const found = findToolById(id)
        return {
          id,
          title: found?.title ?? id,
          icon: found?.icon,
          count: info.count,
          url: info.url,
        }
      })
  }, [toolUsageCounts])

  const totalCount = useMemo(() => (data ? sumTrackedItems(data) : 0), [data])
  const completionPct = useMemo(() => {
    if (!data || data.tasks.total === 0) return 0
    return Math.round((data.tasks.completed / data.tasks.total) * 100)
  }, [data])

  if (loading && !data) {
    return (
      <div className="flex flex-col gap-2">
        <div className="flex items-center gap-2 text-xs text-muted-foreground">
          <Activity className="h-3.5 w-3.5 animate-pulse" aria-hidden />
          <span>{t('loadingLabel')}</span>
        </div>
        <AnalyticsSkeleton />
      </div>
    )
  }

  if (error && !data) {
    return (
      <div className="relative overflow-hidden rounded-xl border border-destructive/25 bg-gradient-to-br from-destructive/5 to-background p-6 text-center">
        <div className="absolute inset-0 dashboard-grid-bg opacity-30" aria-hidden />
        <div className="relative mx-auto max-w-md space-y-3">
          <div className="mx-auto flex h-12 w-12 items-center justify-center rounded-xl bg-destructive/10 text-destructive">
            <BarChart3 className="h-6 w-6" strokeWidth={1.5} />
          </div>
          <p className="text-sm font-medium text-destructive">{error || t('loadError')}</p>
          <Button type="button" variant="outline" size="sm" className="gap-2" onClick={() => void load()}>
            <RefreshCw className="h-3.5 w-3.5" />
            {t('retry')}
          </Button>
        </div>
      </div>
    )
  }

  if (!data) return null

  const { tasks } = data

  const vaultAllEmpty   = data.passwordEntries === 0 && data.bookmarks === 0 && data.bookmarkFolders === 0
  const workspaceAllEmpty = data.tasks.total === 0 && data.notes === 0 && data.projects === 0 && (data.codeSnippets ?? 0) === 0
  const toolkitAllEmpty = data.nosqlConnections === 0 && data.apiClientCollections === 0 && data.apiClientEnvironments === 0 && data.apiClientHistoryEntries === 0 && data.jsonFormatterDocuments === 0

  const vaultActiveCount     = [data.passwordEntries, data.bookmarks, data.bookmarkFolders].filter((v) => v > 0).length
  const workspaceActiveCount = [data.tasks.total, data.notes, data.projects, data.codeSnippets ?? 0].filter((v) => v > 0).length
  const toolkitActiveCount   = [data.nosqlConnections, data.apiClientCollections, data.apiClientEnvironments, data.apiClientHistoryEntries, data.jsonFormatterDocuments].filter((v) => v > 0).length

  const vaultChips = [
    { label: t('passwordEntries'), value: data.passwordEntries, icon: KeyRound,   accent: 'from-rose-500 to-orange-500',    href: '/app/password-manager' },
    { label: t('bookmarks'),        value: data.bookmarks,       icon: Bookmark,   accent: 'from-sky-500 to-cyan-500',       href: '/app/bookmarks' },
    { label: t('bookmarkFolders'), value: data.bookmarkFolders, icon: FolderOpen, accent: 'from-violet-500 to-purple-500',  href: '/app/bookmarks' },
  ]

  const workspaceChips = [
    { label: t('notes'),        value: data.notes,            icon: StickyNote, accent: 'from-amber-500 to-yellow-500', href: '/app/notes' },
    { label: t('projects'),     value: data.projects,         icon: Briefcase,  accent: 'from-blue-500 to-indigo-600',  href: '/app/to-do' },
    { label: t('codeSnippets'), value: data.codeSnippets ?? 0, icon: Code2,     accent: 'from-lime-500 to-green-600',   href: '/app/snippet-manager' },
  ]

  const toolkitChips = [
    { label: t('nosqlConnections'),        value: data.nosqlConnections,        icon: Database, accent: 'from-emerald-500 to-teal-500',                                       href: '/app/data-explorer' },
    { label: t('apiClientCollections'),    value: data.apiClientCollections,    icon: Boxes,    accent: 'from-slate-600 to-slate-800 dark:from-slate-500 dark:to-slate-700', href: '/app/api-client' },
    { label: t('apiClientEnvironments'),   value: data.apiClientEnvironments,   icon: Server,   accent: 'from-fuchsia-500 to-pink-500',                                      href: '/app/api-client' },
    { label: t('apiClientHistory'),        value: data.apiClientHistoryEntries, icon: History,  accent: 'from-orange-500 to-red-500',                                        href: '/app/api-client' },
    { label: t('jsonFormatterDocuments'),  value: data.jsonFormatterDocuments,  icon: Braces,   accent: 'from-cyan-500 to-blue-600',                                         href: '/app/json-formatter' },
  ]

  const { files } = data
  const filesActiveCount = files.count > 0 ? 1 : 0
  const fileChips = [
    { label: t('filesCount'), value: files.count, icon: FolderLock, accent: 'from-indigo-500 to-violet-600', href: '/app/secure-files' },
    {
      label: t('filesOnDisk'),
      value: files.physicalBytes,
      display: formatBytes(files.physicalBytes),
      icon: HardDrive,
      accent: 'from-teal-500 to-emerald-600',
      href: '/app/secure-files',
    },
    {
      label: t('filesLastChange'),
      value: files.lastModifiedAt,
      display: files.lastModifiedAt > 0 ? timeAgo(new Date(files.lastModifiedAt)) : '—',
      icon: Clock,
      accent: 'from-amber-500 to-orange-600',
      href: '/app/secure-files',
    },
  ]

  const visibleVault     = showEmpty ? vaultChips     : vaultChips.filter((c) => c.value > 0)
  const visibleWorkspace = showEmpty ? workspaceChips : workspaceChips.filter((c) => c.value > 0)
  const visibleToolkit   = showEmpty ? toolkitChips   : toolkitChips.filter((c) => c.value > 0)

  return (
    <div className="flex flex-col gap-4">

      {/* ── 3-KPI summary strip ───────────────────────────────────────────── */}
      <div className="grid grid-cols-3 gap-2">
        <KpiCard
          label={t('totalLabel')}
          value={totalCount}
          icon={BarChart3}
          accent="border-primary/20"
          sub={refreshedAt ? timeAgo(refreshedAt) : undefined}
        />
        <KpiCard
          label="Task completion"
          value={completionPct}
          suffix="%"
          icon={ListTodo}
          accent="border-emerald-500/20"
          sub={tasks.total > 0 ? `${tasks.completed} of ${tasks.total}` : 'No tasks yet'}
        />
        <KpiCard
          label="Tools used locally"
          value={Object.keys(toolUsageCounts).length}
          icon={Zap}
          accent="border-violet-500/20"
          sub={
            usageEvents.length > 0
              ? `${usageEvents.length} launches`
              : 'No history yet'
          }
        />
      </div>

      {/* ── Header strip ──────────────────────────────────────────────────── */}
      <div className="flex items-center justify-between gap-2 rounded-xl border border-border/40 bg-card/40 px-3 py-2">
        <div className="flex items-center gap-2">
          <span className="inline-flex shrink-0 items-center gap-1 rounded-full border border-primary/20 bg-primary/10 px-2 py-0.5 text-[9px] font-bold uppercase tracking-wider text-primary">
            <span className="relative flex h-1 w-1">
              <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-primary opacity-40" />
              <span className="relative inline-flex h-1 w-1 rounded-full bg-primary" />
            </span>
            {t('heroBadge')}
          </span>
          <p className="text-xs text-muted-foreground">{t('subtitle')}</p>
        </div>
        <div className="flex items-center gap-1.5">
          <Button
            type="button"
            variant="ghost"
            size="sm"
            className="h-7 gap-1.5 rounded-lg px-2 text-xs text-muted-foreground"
            onClick={() => setShowEmpty((v) => !v)}
            title={showEmpty ? 'Hide empty categories' : 'Show empty categories'}
          >
            {showEmpty
              ? <><EyeOff className="h-3.5 w-3.5" /><span className="hidden sm:inline">Hide empty</span></>
              : <><Eye     className="h-3.5 w-3.5" /><span className="hidden sm:inline">Show empty</span></>
            }
          </Button>
          <Button
            type="button"
            variant="outline"
            size="sm"
            className="h-7 gap-1 rounded-lg px-2"
            onClick={() => void load()}
            disabled={loading}
            title="Refresh analytics"
          >
            <RefreshCw className={cn('h-3.5 w-3.5', loading && 'animate-spin')} />
            <span className="hidden sm:inline text-xs">Refresh</span>
          </Button>
        </div>
      </div>

      {/* ── Charts ─────────────────────────────────────────────────────────── */}
      <ActivityBarChart
        events={usageEvents}
        title={t('activityTitle')}
        emptyHint={t('activityEmpty')}
      />

      <div className="grid grid-cols-1 gap-3 md:grid-cols-2">
        <div className="rounded-xl border border-border bg-card p-3 md:p-4">
          <p className="mb-3 text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">
            {t('distributionTitle')}
          </p>
          <DonutChart
            ariaLabel={t('distributionTitle')}
            centerValue={totalCount}
            centerLabel={t('totalLabel')}
            segments={
              [
                { label: t('groupVault'), value: data.passwordEntries + data.bookmarks + data.bookmarkFolders, color: 'hsl(var(--primary))' },
                { label: t('groupWorkspace'), value: data.tasks.total + data.notes + data.projects + (data.codeSnippets ?? 0), color: '#f59e0b' },
                { label: t('groupToolkit'), value: data.nosqlConnections + data.apiClientCollections + data.apiClientEnvironments + data.apiClientHistoryEntries + data.jsonFormatterDocuments, color: '#06b6d4' },
              ] satisfies DonutSegment[]
            }
          />
        </div>

        <div className="rounded-xl border border-border bg-card p-3 md:p-4">
          <p className="mb-3 text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">
            {t('taskDonutTitle')}
          </p>
          <DonutChart
            ariaLabel={t('taskDonutTitle')}
            centerValue={`${completionPct}%`}
            centerLabel={t('tasksCompleted')}
            segments={
              [
                { label: t('tasksCompleted'), value: tasks.completed, color: '#10b981' },
                { label: t('tasksOngoing'), value: tasks.ongoing, color: '#f59e0b' },
                { label: t('tasksNotStarted'), value: tasks.notStarted, color: 'hsl(var(--muted-foreground))' },
              ] satisfies DonutSegment[]
            }
          />
        </div>
      </div>

      <TopToolsBars tools={topUsedTools} title={t('topToolsTitle')} />

      {/* ── Group 1: Vault & Bookmarks ────────────────────────────────────── */}
      <div className="flex flex-col gap-2">
        <SectionHeader label={t('groupVault')} activeCount={vaultActiveCount} color="rose" />
        {vaultAllEmpty && !showEmpty ? (
          <EmptyGroupHint
            message="No vault data yet — save passwords or bookmarks to see stats."
            href="/app/password-manager"
            cta="Open vault"
          />
        ) : (
          <div className="grid grid-cols-2 gap-2 sm:grid-cols-3">
            {(showEmpty ? vaultChips : visibleVault).map((c) => (
              <MetricChip key={c.label} {...c} />
            ))}
          </div>
        )}
      </div>

      {/* ── Group 2: Workspace ────────────────────────────────────────────── */}
      <div className="flex flex-col gap-2">
        <SectionHeader label={t('groupWorkspace')} activeCount={workspaceActiveCount} color="amber" />
        {workspaceAllEmpty && !showEmpty ? (
          <EmptyGroupHint
            message="No workspace data yet — create notes, tasks, or snippets."
            href="/app/to-do"
            cta="Open tasks"
          />
        ) : (
          <div className="grid grid-cols-2 gap-2 sm:grid-cols-3">
            <TaskCard
              tasks={tasks}
              labels={{
                title: t('tasksTotal'),
                done: t('tasksCompleted'),
                ongoing: t('tasksOngoing'),
                todo: t('tasksNotStarted'),
                empty: t('taskMixEmpty'),
              }}
            />
            {(showEmpty ? workspaceChips : visibleWorkspace).map((c) => (
              <MetricChip key={c.label} {...c} />
            ))}
          </div>
        )}
      </div>

      {/* ── Group 3: Developer Toolkit ───────────────────────────────────── */}
      <div className="flex flex-col gap-2">
        <SectionHeader label={t('groupToolkit')} activeCount={toolkitActiveCount} color="cyan" />
        {toolkitAllEmpty && !showEmpty ? (
          <EmptyGroupHint
            message="No toolkit data yet — connect a DB, create API collections, or save JSON docs."
            href="/app/api-client"
            cta="Open API client"
          />
        ) : (
          <div className="grid grid-cols-2 gap-2 sm:grid-cols-3">
            {(showEmpty ? toolkitChips : visibleToolkit).map((c) => (
              <MetricChip key={c.label} {...c} />
            ))}
          </div>
        )}
      </div>

      {/* ── Group 4: Files ───────────────────────────────────────────────────
          Measured from the .mydt objects on disk, so the count and size stay
          truthful while the vault is locked. */}
      <div className="flex flex-col gap-2">
        <SectionHeader label={t('groupFiles')} activeCount={filesActiveCount} color="default" />
        {files.count === 0 && !showEmpty ? (
          <EmptyGroupHint
            message={files.configured ? t('filesEmpty') : t('filesNoFolder')}
            href="/app/secure-files"
            cta={t('filesCta')}
          />
        ) : (
          <div className="grid grid-cols-2 gap-2 sm:grid-cols-3">
            {fileChips.map((c) => (
              <MetricChip key={c.label} {...c} />
            ))}
          </div>
        )}
      </div>

    </div>
  )
}
