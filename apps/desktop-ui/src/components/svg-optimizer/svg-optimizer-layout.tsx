'use client'

import { useCallback, useEffect, useMemo, useState } from 'react'
import { useTranslations } from 'next-intl'
import { useDebouncedCallback } from 'use-debounce'
import { useCopyToClipboard } from '@/hooks/use-copy-to-clipboard'
import { Label } from '@/components/ui/label'
import { Button } from '@/components/ui/button'
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert'
import { Check, Copy, Download, Trash2, Sparkles } from 'lucide-react'
import { IconFileTypeSvg } from '@tabler/icons-react'
import { cn } from '@/lib/utils'
import { ToolShell } from '@/components/tools/tool-shell'
import { ToolPanels, IOPanel, ToolTextArea } from '@/components/tools/io-panel'
import { utf8ByteLength } from '@/lib/svg-optimize'
import { useSvgOptimizeWorker } from '@/hooks/use-svg-optimize-worker'
import { downloadFile } from '@/lib/desktop/save-file'

const SAMPLE_SVG = `<svg xmlns="http://www.w3.org/2000/svg" width="120" height="120" viewBox="0 0 120 120">
  <!-- demo: metadata + whitespace -->
  <title> Demo icon </title>
  <desc> Extra noise for the optimizer </desc>
  <metadata> <rdf:RDF xmlns:rdf="http://www.w3.org/1999/02/22-rdf-syntax-ns#"> </rdf:RDF> </metadata>
  <g fill="none" stroke="#6366f1" stroke-width="4" stroke-linecap="round">
    <circle cx="60" cy="60" r="28" />
    <path d="M 60 32  L 60 60  L 78 78" />
  </g>
</svg>`

export function SvgOptimizerLayout() {
  const t = useTranslations('SvgOptimizer')
  const [input, setInput] = useState('')
  const [output, setOutput] = useState('')
  const [error, setError] = useState<string | null>(null)
  const { isCopied: copied, copyToClipboard } = useCopyToClipboard()
  const { optimize } = useSvgOptimizeWorker()

  const runOptimize = useCallback(async (raw: string) => {
    try {
      const result = await optimize(raw)
      if (result.ok) {
        setOutput(result.data)
        setError(null)
      } else {
        setOutput('')
        setError(result.error)
      }
    } catch {
      // worker unmounted or failed mid-flight — component is going away, ignore
    }
  }, [optimize])

  const debouncedOptimize = useDebouncedCallback(runOptimize, 280)

  useEffect(() => {
    debouncedOptimize(input)
  }, [input, debouncedOptimize])

  const beforeBytes = useMemo(() => utf8ByteLength(input), [input])
  const afterBytes = useMemo(() => utf8ByteLength(output), [output])
  const savedBytes = Math.max(0, beforeBytes - afterBytes)
  const savedPercent =
    beforeBytes > 0 ? Math.round((savedBytes / beforeBytes) * 1000) / 10 : 0

  const previewUrl =
    output.trim().length > 0
      ? `data:image/svg+xml;charset=utf-8,${encodeURIComponent(output)}`
      : null

  const handleCopy = () => {
    if (!output) return
    void copyToClipboard(output, { silent: true, resetMs: 1600 })
  }

  const handleDownload = () => {
    if (!output.trim()) return
    const blob = new Blob([output], { type: 'image/svg+xml;charset=utf-8' })
    downloadFile(blob, 'optimized.svg')
  }

  return (
    <ToolShell icon={IconFileTypeSvg} title={t('title')} description={t('subtitle')}>
      <ToolPanels className="xl:grid-cols-2">
        <IOPanel
          label={t('inputLabel')}
          bodyClassName="flex flex-col"
          actions={
            <span className="text-[10px] tabular-nums text-muted-foreground">
              {t('chars', { count: input.length, bytes: beforeBytes })}
            </span>
          }
        >
          <div className="relative min-h-0 flex-1">
            <ToolTextArea
              id="svg-input"
              value={input}
              onChange={(e) => setInput(e.target.value)}
              placeholder={t('placeholder')}
              autoComplete="off"
            />
          </div>
          <div className="flex flex-wrap gap-2 border-t border-border/50 p-2">
            <Button type="button" variant="secondary" size="sm" onClick={() => setInput('')}>
              <Trash2 className="mr-1.5 h-4 w-4" />
              {t('actions.clear')}
            </Button>
            <Button type="button" variant="outline" size="sm" onClick={() => setInput(SAMPLE_SVG)}>
              <Sparkles className="mr-1.5 h-4 w-4" />
              {t('actions.sample')}
            </Button>
          </div>
        </IOPanel>

        <div className="flex min-h-0 flex-col gap-4">
          <div className="space-y-3 rounded-lg border border-border bg-card p-4">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <Label className="text-xs font-medium uppercase tracking-wider text-muted-foreground">
                {t('stats.title')}
              </Label>
              {input.trim().length > 0 && !error && (
                <span className="text-xs tabular-nums text-muted-foreground">
                  {savedBytes === 0 ? t('stats.noChange') : t('stats.savedBytes', { count: savedBytes, percent: savedPercent })}
                </span>
              )}
            </div>
            <div className="grid grid-cols-2 gap-3 text-sm">
              <div className="rounded-lg border bg-muted/30 px-3 py-2">
                <p className="text-[10px] font-medium uppercase tracking-wide text-muted-foreground">{t('stats.before')}</p>
                <p className="text-lg font-semibold tabular-nums">{beforeBytes}</p>
              </div>
              <div className="rounded-lg border bg-muted/30 px-3 py-2">
                <p className="text-[10px] font-medium uppercase tracking-wide text-muted-foreground">{t('stats.after')}</p>
                <p className="text-lg font-semibold tabular-nums">{afterBytes}</p>
              </div>
            </div>
            {error ? (
              <Alert variant="destructive">
                <AlertTitle>{t('errors.optimizeFailed')}</AlertTitle>
                <AlertDescription className="break-all font-mono text-xs">{error}</AlertDescription>
              </Alert>
            ) : null}
          </div>

          <IOPanel
            label={t('outputLabel')}
            className="min-h-[180px] flex-1"
            bodyClassName="flex flex-col"
            actions={
              <>
                <Button type="button" size="sm" variant="secondary" className="h-7" disabled={!output} onClick={handleCopy}>
                  {copied ? (
                    <Check className="mr-1.5 h-4 w-4 text-emerald-600" />
                  ) : (
                    <Copy className="mr-1.5 h-4 w-4" />
                  )}
                  {copied ? t('actions.copied') : t('actions.copy')}
                </Button>
                <Button type="button" size="sm" variant="outline" className="h-7" disabled={!output.trim()} onClick={handleDownload}>
                  <Download className="mr-1.5 h-4 w-4" />
                  {t('actions.download')}
                </Button>
              </>
            }
          >
            <div className="relative min-h-0 flex-1">
              <ToolTextArea id="svg-output" readOnly value={output} placeholder={t('outputPlaceholder')} />
            </div>
            {previewUrl ? (
              <div className="space-y-2 border-t border-border/50 p-3">
                <p className="text-[10px] font-medium uppercase tracking-wide text-muted-foreground">{t('preview')}</p>
                <div className={cn('flex max-h-40 items-center justify-center overflow-hidden rounded-lg border bg-muted/20 p-4')}>
                  {/* Dynamic data: URL cannot use next/image */}
                  {/* eslint-disable-next-line @next/next/no-img-element */}
                  <img src={previewUrl} alt="" loading="lazy" decoding="async" className="max-h-32 max-w-full object-contain" />
                </div>
              </div>
            ) : null}
          </IOPanel>
        </div>
      </ToolPanels>

      <p className="shrink-0 text-center text-xs text-muted-foreground">{t('localNote')}</p>
    </ToolShell>
  )
}
