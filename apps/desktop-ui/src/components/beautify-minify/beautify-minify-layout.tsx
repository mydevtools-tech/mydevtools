'use client'

import React, { useMemo, useState } from 'react'
import { useCopyToClipboard } from '@/hooks/use-copy-to-clipboard'
import { useTranslations } from 'next-intl'
import { Button } from '@/components/ui/button'
import { Label } from '@/components/ui/label'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
import { ToggleGroup, ToggleGroupItem } from '@/components/ui/toggle-group'
import { Check, Copy, Trash2 } from 'lucide-react'
import { IconWand } from '@tabler/icons-react'
import { ToolShell } from '@/components/tools/tool-shell'
import { ToolPanels, IOPanel, ToolTextArea } from '@/components/tools/io-panel'
import { BEAUTIFY_LANGS, beautify, minify, type BeautifyLang } from '@/lib/beautify-minify'
import { highlightCode } from '@/lib/code-screenshot'
import '@/components/tools/hljs-theme.css'

type Action = 'beautify' | 'minify'

/** Map a beautifier language onto the highlight.js grammar that renders it. */
const HLJS_LANG: Record<BeautifyLang, string> = {
  html: 'xml',
  xml: 'xml',
  css: 'css',
  js: 'javascript',
  json: 'json',
}

export function BeautifyMinifyLayout() {
  const t = useTranslations('BeautifyMinify')
  const [input, setInput] = useState('')
  const [lang, setLang] = useState<BeautifyLang>('json')
  const [action, setAction] = useState<Action>('beautify')
  const { isCopied: copied, copyToClipboard } = useCopyToClipboard()

  const result = useMemo(
    () => (action === 'beautify' ? beautify(input, lang, 2) : minify(input, lang)),
    [input, lang, action],
  )

  const outBytes = useMemo(
    () => (result.output ? new TextEncoder().encode(result.output).length : 0),
    [result.output],
  )
  const inBytes = useMemo(() => (input ? new TextEncoder().encode(input).length : 0), [input])

  const highlighted = useMemo(
    () => (result.error || !result.output ? '' : highlightCode(result.output, HLJS_LANG[lang]).html),
    [result.error, result.output, lang],
  )

  const toolbar = (
    <div className="flex flex-wrap items-end gap-4 rounded-lg border border-border bg-card px-4 py-3">
      <div className="space-y-1.5">
        <Label className="text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">
          {t('langLabel')}
        </Label>
        <Select value={lang} onValueChange={(v) => setLang(v as BeautifyLang)}>
          <SelectTrigger className="w-[160px]">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            {BEAUTIFY_LANGS.map((l) => (
              <SelectItem key={l.value} value={l.value}>
                {l.label}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>
      <div className="space-y-1.5">
        <Label className="text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">
          {t('actionLabel')}
        </Label>
        <ToggleGroup
          type="single"
          value={action}
          onValueChange={(v) => v && setAction(v as Action)}
          className="justify-start"
        >
          <ToggleGroupItem value="beautify" className="px-4 text-xs">
            {t('beautify')}
          </ToggleGroupItem>
          <ToggleGroupItem value="minify" className="px-4 text-xs">
            {t('minify')}
          </ToggleGroupItem>
        </ToggleGroup>
      </div>
    </div>
  )

  return (
    <ToolShell
      icon={IconWand}
      title={t('title')}
      description={t('subtitle')}
      toolbar={toolbar}
    >
      <ToolPanels className="lg:grid-cols-2">
        <IOPanel
          label={t('panels.input')}
          actions={
            <>
              <span className="text-[10px] tabular-nums text-muted-foreground">
                {t('bytes', { count: inBytes.toLocaleString() })}
              </span>
              <Button
                variant="ghost"
                size="icon"
                className="h-6 w-6"
                onClick={() => setInput('')}
                disabled={!input}
                title={t('clear')}
              >
                <Trash2 className="h-3.5 w-3.5" />
              </Button>
            </>
          }
        >
          <ToolTextArea
            value={input}
            onChange={(e) => setInput(e.target.value)}
            placeholder={t('placeholder')}
            autoComplete="off"
          />
        </IOPanel>

        <IOPanel
          label={t('panels.output')}
          bodyClassName="overflow-auto"
          actions={
            <>
              <span className="text-[10px] tabular-nums text-muted-foreground">
                {t('bytes', { count: outBytes.toLocaleString() })}
              </span>
              <Button
                size="sm"
                variant="secondary"
                className="h-7"
                disabled={!result.output}
                onClick={() => void copyToClipboard(result.output, { silent: true })}
              >
                {copied ? (
                  <Check className="mr-1.5 h-4 w-4 text-emerald-600" />
                ) : (
                  <Copy className="mr-1.5 h-4 w-4" />
                )}
                {copied ? t('copied') : t('copy')}
              </Button>
            </>
          }
        >
          {result.error ? (
            <div className="p-3 text-sm text-destructive">{result.error}</div>
          ) : result.output ? (
            <div className="hljs-theme">
              <pre className="m-0 font-mono">
                <code
                  className="hljs whitespace-pre-wrap break-words !p-3"
                  // highlight.js escapes the code it is handed.
                  // threatcrush-disable-next-line js-unescaped-html-sink
                  dangerouslySetInnerHTML={{ __html: highlighted }}
                />
              </pre>
            </div>
          ) : (
            <div className="p-3 text-sm text-muted-foreground">{t('outputPlaceholder')}</div>
          )}
        </IOPanel>
      </ToolPanels>
    </ToolShell>
  )
}
