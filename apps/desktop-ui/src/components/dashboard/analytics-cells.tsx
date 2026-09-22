'use client'

import type React from 'react'
import Link from 'next/link'
import { Zap } from 'lucide-react'
import { cn } from '@/lib/utils'
import { useCountUp } from '@/hooks/use-count-up'

export function AnalyticsSkeleton() {
  return (
    <div className="flex flex-col gap-3 animate-pulse" aria-hidden>
      <div className="h-20 rounded-xl bg-muted/60" />
      <div className="h-px bg-muted/40" />
      <div className="grid grid-cols-2 gap-2 sm:grid-cols-3">
        {Array.from({ length: 12 }).map((_, i) => (
          <div key={i} className="h-16 rounded-lg bg-muted/50" />
        ))}
      </div>
    </div>
  )
}

export type GroupColor = 'rose' | 'amber' | 'cyan' | 'default'

const groupColorMap: Record<GroupColor, string> = {
  rose:    'text-rose-500  bg-rose-500/10  border-rose-500/20',
  amber:   'text-amber-500 bg-amber-500/10 border-amber-500/20',
  cyan:    'text-cyan-500  bg-cyan-500/10  border-cyan-500/20',
  default: 'text-primary   bg-primary/10   border-primary/20',
}

export function SectionHeader({
  label,
  activeCount,
  color = 'default',
}: {
  label: string
  activeCount: number
  color?: GroupColor
}) {
  const cls = groupColorMap[color]
  return (
    <div className="flex items-center gap-2 py-1">
      <span className={cn('text-[10px] font-bold uppercase tracking-widest', cls.split(' ')[0])}>
        {label}
      </span>
      <div className="h-px flex-1 bg-border/40" />
      {activeCount > 0 && (
        <span className={cn('rounded-full border px-1.5 py-0.5 text-[9px] font-bold tabular-nums', cls)}>
          {activeCount}
        </span>
      )}
    </div>
  )
}

export function MetricChip({
  label,
  value,
  display: displayOverride,
  icon: Icon,
  accent,
  href,
}: {
  label: string
  value: number
  /** Pre-formatted value (byte sizes, durations) — skips the count-up. */
  display?: string
  icon: React.ElementType
  accent: string
  href: string
}) {
  const counted = useCountUp(value)
  const display = displayOverride ?? counted
  const isEmpty = value === 0
  return (
    <Link
      href={href}
      className={cn(
        'group relative flex min-h-[4rem] items-center gap-2.5 overflow-hidden rounded-lg border bg-card/50 px-3 py-2 shadow-sm transition-all duration-200',
        isEmpty
          ? 'border-border/25 opacity-45 hover:opacity-70 hover:border-border/50'
          : 'border-border/50 hover:border-primary/25 hover:bg-card/80 hover:shadow-md hover:-translate-y-px active:translate-y-0'
      )}
    >
      {!isEmpty && (
        <div
          className={cn(
            'pointer-events-none absolute -right-4 -top-4 h-14 w-14 rounded-full opacity-[0.08] blur-xl transition-opacity group-hover:opacity-[0.18]',
            accent
          )}
        />
      )}
      <div
        className={cn(
          'relative flex h-8 w-8 shrink-0 items-center justify-center rounded-md bg-gradient-to-br text-white shadow-sm ring-1 ring-white/10',
          isEmpty ? 'from-muted-foreground/30 to-muted-foreground/20' : accent
        )}
      >
        <Icon className="h-3.5 w-3.5" strokeWidth={2} aria-hidden />
      </div>
      <div className="min-w-0 flex-1">
        <p className="truncate text-[11px] font-semibold uppercase leading-tight tracking-wide text-muted-foreground">
          {label}
        </p>
        <p
          className={cn(
            'text-lg font-bold tabular-nums leading-tight tracking-tight',
            isEmpty && 'text-muted-foreground/50'
          )}
        >
          {display}
        </p>
      </div>
    </Link>
  )
}

export function KpiCard({
  label,
  value,
  suffix = '',
  icon: Icon,
  accent,
  sub,
}: {
  label: string
  value: number
  suffix?: string
  icon: React.ElementType
  accent: string
  sub?: string
}) {
  const display = useCountUp(value)
  return (
    <div className={cn('relative flex flex-col gap-1 overflow-hidden rounded-xl border bg-card/50 px-4 py-3 shadow-sm', accent)}>
      <div className="flex items-center justify-between">
        <p className="text-[10px] font-bold uppercase tracking-widest text-muted-foreground">{label}</p>
        <Icon className="h-3.5 w-3.5 text-muted-foreground/50" strokeWidth={1.5} aria-hidden />
      </div>
      <p className="text-2xl font-bold tabular-nums leading-none tracking-tight">
        {display}{suffix}
      </p>
      {sub && <p className="text-[10px] text-muted-foreground/70 leading-tight">{sub}</p>}
    </div>
  )
}

export function EmptyGroupHint({ message, href, cta }: { message: string; href: string; cta: string }) {
  return (
    <Link
      href={href}
      className="flex items-center gap-2 rounded-lg border border-dashed border-border/40 bg-muted/10 px-3 py-2.5 text-xs text-muted-foreground transition-colors hover:border-primary/30 hover:text-foreground"
    >
      <Zap className="h-3.5 w-3.5 shrink-0 text-muted-foreground/40" strokeWidth={1.5} />
      <span>{message}</span>
      <span className="ml-auto shrink-0 font-medium text-primary/70">{cta} →</span>
    </Link>
  )
}
