'use client'

import React, { useCallback, useMemo, useRef, useState } from 'react'
import { useCopyToClipboard } from '@/hooks/use-copy-to-clipboard'
import { Button } from '@/components/ui/button'
import { cn } from '@/lib/utils'
import { Check, Copy, Download, Trash2, Upload } from 'lucide-react'
import { useTranslations } from 'next-intl'
import { IconLink } from '@tabler/icons-react'
import { ToolShell } from '@/components/tools/tool-shell'
import { ToolPanels, IOPanel, ToolTextArea } from '@/components/tools/io-panel'
import { downloadFile } from '@/lib/desktop/save-file'

type ParsedParam = {
  key: string
  value: string
}

type ParsedUrl = {
  href: string
  protocol: string
  host: string
  hostname: string
  port: string
  path: string
  query: string
  hash: string
  queryParams: ParsedParam[]
}

function normalizeMaybeUrl(input: string): string {
  const raw = input.trim()
  if (!raw) return raw

  // If the user pastes example.com/path, URL() will reject it without a base.
  // Prefer a predictable upgrade to https:// rather than using window.location as base.
  const hasScheme = /^[a-zA-Z][a-zA-Z0-9+.-]*:/.test(raw)
  if (hasScheme) return raw

  // Handle scheme-relative URLs like //example.com/path
  if (raw.startsWith('//')) return `https:${raw}`

  return `https://${raw}`
}

function parseUrl(input: string): ParsedUrl {
  const normalized = normalizeMaybeUrl(input)
  const url = new URL(normalized)
  const queryParams: ParsedParam[] = []
  url.searchParams.forEach((value, key) => {
    queryParams.push({ key, value })
  })

  return {
    href: url.href,
    protocol: url.protocol.replace(/:$/, ''),
    host: url.host,
    hostname: url.hostname,
    port: url.port,
    path: url.pathname,
    query: url.search.replace(/^\?/, ''),
    hash: url.hash.replace(/^#/, ''),
    queryParams,
  }
}

function DownloadJsonButton({ data, filename, title }: { data: unknown; filename: string; title: string }) {
  return (
    <Button
      variant="ghost"
      size="icon"
      className="h-6 w-6"
      onClick={() => {
        const blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' })
        downloadFile(blob, filename)
      }}
      title={title}
    >
      <Download className="h-3 w-3" />
    </Button>
  )
}

function CopyIconButton({ value, title }: { value: string; title: string }) {
  const { isCopied: copied, copyToClipboard } = useCopyToClipboard()

  const handleCopy = useCallback(() => {
    void copyToClipboard(value, { silent: true, resetMs: 1200 })
  }, [value, copyToClipboard])

  return (
    <Button
      variant="ghost"
      size="icon"
      className="h-7 w-7"
      onClick={handleCopy}
      disabled={!value}
      title={title}
    >
      {copied ? <Check className="h-3.5 w-3.5 text-green-500" /> : <Copy className="h-3.5 w-3.5" />}
    </Button>
  )
}

export function UrlParserLayout() {
  const t = useTranslations('UrlParser')
  const [input, setInput] = useState('')
  const [error, setError] = useState('')
  const [isDragging, setIsDragging] = useState(false)
  const fileInputRef = useRef<HTMLInputElement>(null)

  const parsed = useMemo(() => {
    setError('')
    const trimmed = input.trim()
    if (!trimmed) return null
    try {
      return parseUrl(trimmed)
    } catch {
      setError(t('errors.invalidUrl'))
      return null
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [input, t])

  const handleClear = () => {
    setInput('')
    setError('')
  }

  const handleFileUpload = (file: File) => {
    const reader = new FileReader()
    reader.onload = (e) => {
      const text = (e.target?.result as string) ?? ''
      setInput(text)
    }
    reader.readAsText(file)
  }

  const handleDrop = (e: React.DragEvent) => {
    e.preventDefault()
    setIsDragging(false)
    const file = e.dataTransfer.files[0]
    if (file) handleFileUpload(file)
  }

  const handleDragOver = (e: React.DragEvent) => {
    e.preventDefault()
    setIsDragging(true)
  }

  const handleDragLeave = () => setIsDragging(false)

  const outputJson = useMemo(() => {
    if (!parsed) return null
    return {
      href: parsed.href,
      protocol: parsed.protocol,
      host: parsed.host,
      hostname: parsed.hostname,
      port: parsed.port,
      path: parsed.path,
      query: parsed.query,
      hash: parsed.hash,
      queryParams: parsed.queryParams,
    }
  }, [parsed])

  const toolbar = (
    <div className="flex items-center gap-2 shrink-0 md:hidden">
      <Button
        variant="outline"
        size="sm"
        className="gap-1.5 text-xs"
        onClick={() => fileInputRef.current?.click()}
      >
        <Upload className="h-3.5 w-3.5" />
        {t('upload')}
      </Button>
      <input
        ref={fileInputRef}
        type="file"
        accept=".txt,.json,.xml,.html,.md"
        className="hidden"
        onChange={(e) => {
          const file = e.target.files?.[0]
          if (file) handleFileUpload(file)
          e.target.value = ''
        }}
      />
      <Button variant="outline" size="sm" className="gap-1.5 text-xs" onClick={handleClear}>
        <Trash2 className="h-3.5 w-3.5" />
        {t('clear')}
      </Button>
    </div>
  )

  return (
    <ToolShell
      icon={IconLink}
      title={t('title')}
      description={t('subtitle')}
      toolbar={toolbar}
    >
      <ToolPanels className="lg:grid-cols-2">
        <IOPanel
          className={cn('transition-colors', isDragging && 'border-primary/50 bg-primary/5')}
          onDrop={handleDrop}
          onDragOver={handleDragOver}
          onDragLeave={handleDragLeave}
          label={t('panels.input')}
          actions={
            <span className="text-[10px] text-muted-foreground tabular-nums">
              {t('charCount', { count: input.length.toLocaleString() })}
            </span>
          }
        >
          <ToolTextArea
            value={input}
            onChange={(e) => setInput(e.target.value)}
            placeholder={t('placeholders.input')}
          />
          {isDragging && (
            <div className="absolute inset-0 flex items-center justify-center bg-primary/5 backdrop-blur-sm">
              <div className="flex flex-col items-center gap-2 text-primary">
                <Upload className="h-8 w-8" />
                <span className="text-sm font-medium">{t('dropHere')}</span>
              </div>
            </div>
          )}
        </IOPanel>

        <IOPanel
          label={t('panels.output')}
          bodyClassName="overflow-auto p-4"
          actions={
            outputJson && (
              <DownloadJsonButton
                data={outputJson}
                filename={t('download.filename')}
                title={t('download.title')}
              />
            )
          }
        >
          <>
            {error ? (
              <div className="text-sm text-destructive">{error}</div>
            ) : !parsed ? (
              <div className="text-sm text-muted-foreground">{t('outputPlaceholder')}</div>
            ) : (
              <div className="space-y-4">
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                  <div className="rounded-lg border border-border/50 bg-muted/20 p-3">
                    <div className="flex items-center justify-between gap-2">
                      <div className="text-xs font-medium text-muted-foreground">{t('fields.protocol')}</div>
                      <CopyIconButton value={parsed.protocol} title={t('copyTitle')} />
                    </div>
                    <div className="mt-1 font-mono text-sm break-all">{parsed.protocol || '—'}</div>
                  </div>

                  <div className="rounded-lg border border-border/50 bg-muted/20 p-3">
                    <div className="flex items-center justify-between gap-2">
                      <div className="text-xs font-medium text-muted-foreground">{t('fields.host')}</div>
                      <CopyIconButton value={parsed.host} title={t('copyTitle')} />
                    </div>
                    <div className="mt-1 font-mono text-sm break-all">{parsed.host || '—'}</div>
                  </div>

                  <div className="rounded-lg border border-border/50 bg-muted/20 p-3">
                    <div className="flex items-center justify-between gap-2">
                      <div className="text-xs font-medium text-muted-foreground">{t('fields.path')}</div>
                      <CopyIconButton value={parsed.path} title={t('copyTitle')} />
                    </div>
                    <div className="mt-1 font-mono text-sm break-all">{parsed.path || '—'}</div>
                  </div>

                  <div className="rounded-lg border border-border/50 bg-muted/20 p-3">
                    <div className="flex items-center justify-between gap-2">
                      <div className="text-xs font-medium text-muted-foreground">{t('fields.hash')}</div>
                      <CopyIconButton value={parsed.hash} title={t('copyTitle')} />
                    </div>
                    <div className="mt-1 font-mono text-sm break-all">{parsed.hash || '—'}</div>
                  </div>
                </div>

                <div className="rounded-lg border border-border/50 overflow-hidden">
                  <div className="flex items-center justify-between px-3 py-2 bg-muted/30 border-b border-border/50">
                    <div className="text-xs font-medium text-muted-foreground uppercase tracking-wider">
                      {t('fields.queryParams')}
                    </div>
                    <span className="text-[10px] text-muted-foreground tabular-nums">
                      {t('paramCount', { count: parsed.queryParams.length })}
                    </span>
                  </div>
                  {parsed.queryParams.length === 0 ? (
                    <div className="p-3 text-sm text-muted-foreground">{t('noParams')}</div>
                  ) : (
                    <div className="divide-y divide-border/50">
                      {parsed.queryParams.map((p, idx) => (
                        <div key={`${p.key}:${idx}`} className="grid grid-cols-12 gap-2 p-3 items-start">
                          <div className="col-span-5 sm:col-span-4">
                            <div className="text-[10px] text-muted-foreground">{t('paramKey')}</div>
                            <div className="font-mono text-sm break-all">{p.key}</div>
                          </div>
                          <div className="col-span-6 sm:col-span-7">
                            <div className="text-[10px] text-muted-foreground">{t('paramValue')}</div>
                            <div className="font-mono text-sm break-all">{p.value}</div>
                          </div>
                          <div className="col-span-1 flex justify-end">
                            <CopyIconButton value={`${p.key}=${p.value}`} title={t('copyParamTitle')} />
                          </div>
                        </div>
                      ))}
                    </div>
                  )}
                </div>
              </div>
            )}
          </>
        </IOPanel>
      </ToolPanels>
    </ToolShell>
  )
}

