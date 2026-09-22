'use client'

import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { useTranslations } from 'next-intl'
import { toBlob } from 'html-to-image'
import { toast } from 'sonner'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Slider } from '@/components/ui/slider'
import { Switch } from '@/components/ui/switch'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
import { ToggleGroup, ToggleGroupItem } from '@/components/ui/toggle-group'
import { Check, Copy, FileCode, ImageDown, Trash2, Wand2 } from 'lucide-react'
import { IconPhotoCode } from '@tabler/icons-react'
import { ToolShell } from '@/components/tools/tool-shell'
import { IOPanel, ToolTextArea } from '@/components/tools/io-panel'
import { BACKGROUNDS, LANGUAGES, canFormat, formatCode, highlightCode } from '@/lib/code-screenshot'
import { downloadFile } from '@/lib/desktop/save-file'

/**
 * highlight.js theme scoped under .cshot-code so it can never bleed into the
 * rest of the app. Dark palette based on Atom One Dark, light on Atom One
 * Light (MIT-licensed hljs themes, adapted).
 */
const SCOPED_HLJS_CSS = `
.cshot-code { color: #abb2bf; }
.cshot-code .hljs-comment, .cshot-code .hljs-quote { color: #7f848e; font-style: italic; }
.cshot-code .hljs-doctag, .cshot-code .hljs-keyword, .cshot-code .hljs-formula { color: #c678dd; }
.cshot-code .hljs-section, .cshot-code .hljs-name, .cshot-code .hljs-selector-tag,
.cshot-code .hljs-deletion, .cshot-code .hljs-subst { color: #e06c75; }
.cshot-code .hljs-literal { color: #56b6c2; }
.cshot-code .hljs-string, .cshot-code .hljs-regexp, .cshot-code .hljs-addition,
.cshot-code .hljs-attribute, .cshot-code .hljs-meta .hljs-string { color: #98c379; }
.cshot-code .hljs-attr, .cshot-code .hljs-variable, .cshot-code .hljs-template-variable,
.cshot-code .hljs-type, .cshot-code .hljs-selector-class, .cshot-code .hljs-selector-attr,
.cshot-code .hljs-selector-pseudo, .cshot-code .hljs-number { color: #d19a66; }
.cshot-code .hljs-symbol, .cshot-code .hljs-bullet, .cshot-code .hljs-link,
.cshot-code .hljs-meta, .cshot-code .hljs-selector-id, .cshot-code .hljs-title { color: #61aeee; }
.cshot-code .hljs-built_in, .cshot-code .hljs-title.class_, .cshot-code .hljs-class .hljs-title { color: #e6c07b; }
.cshot-code .hljs-emphasis { font-style: italic; }
.cshot-code .hljs-strong { font-weight: bold; }

.cshot-code--light { color: #383a42; }
.cshot-code--light .hljs-comment, .cshot-code--light .hljs-quote { color: #a0a1a7; font-style: italic; }
.cshot-code--light .hljs-doctag, .cshot-code--light .hljs-keyword, .cshot-code--light .hljs-formula { color: #a626a4; }
.cshot-code--light .hljs-section, .cshot-code--light .hljs-name, .cshot-code--light .hljs-selector-tag,
.cshot-code--light .hljs-deletion, .cshot-code--light .hljs-subst { color: #e45649; }
.cshot-code--light .hljs-literal { color: #0184bb; }
.cshot-code--light .hljs-string, .cshot-code--light .hljs-regexp, .cshot-code--light .hljs-addition,
.cshot-code--light .hljs-attribute, .cshot-code--light .hljs-meta .hljs-string { color: #50a14f; }
.cshot-code--light .hljs-attr, .cshot-code--light .hljs-variable, .cshot-code--light .hljs-template-variable,
.cshot-code--light .hljs-type, .cshot-code--light .hljs-selector-class, .cshot-code--light .hljs-selector-attr,
.cshot-code--light .hljs-selector-pseudo, .cshot-code--light .hljs-number { color: #986801; }
.cshot-code--light .hljs-symbol, .cshot-code--light .hljs-bullet, .cshot-code--light .hljs-link,
.cshot-code--light .hljs-meta, .cshot-code--light .hljs-selector-id, .cshot-code--light .hljs-title { color: #4078f2; }
.cshot-code--light .hljs-built_in, .cshot-code--light .hljs-title.class_, .cshot-code--light .hljs-class .hljs-title { color: #c18401; }
.cshot-code--light .hljs-emphasis { font-style: italic; }
.cshot-code--light .hljs-strong { font-weight: bold; }
`

const DEFAULT_CODE = `function fibonacci(n) {
  if (n <= 1) return n
  return fibonacci(n - 1) + fibonacci(n - 2)
}

console.log(fibonacci(10)) // 55
`

const CHECKERBOARD: React.CSSProperties = {
  backgroundImage:
    'linear-gradient(45deg, rgba(128,128,128,0.25) 25%, transparent 25%, transparent 75%, rgba(128,128,128,0.25) 75%), linear-gradient(45deg, rgba(128,128,128,0.25) 25%, transparent 25%, transparent 75%, rgba(128,128,128,0.25) 75%)',
  backgroundSize: '16px 16px',
  backgroundPosition: '0 0, 8px 8px',
}

export function CodeScreenshotLayout() {
  const t = useTranslations('CodeScreenshot')
  const [code, setCode] = useState(DEFAULT_CODE)
  const [lang, setLang] = useState('auto')
  const [backgroundId, setBackgroundId] = useState('ocean')
  const [padding, setPadding] = useState(48)
  const [windowControls, setWindowControls] = useState(true)
  const [filename, setFilename] = useState('')
  const [windowTheme, setWindowTheme] = useState<'dark' | 'light'>('dark')
  const [scale, setScale] = useState(2)
  const [exporting, setExporting] = useState(false)
  const [imageCopied, setImageCopied] = useState(false)
  const [canCopyImage, setCanCopyImage] = useState(false)
  const previewRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    setCanCopyImage(
      typeof window !== 'undefined' &&
        'ClipboardItem' in window &&
        typeof navigator.clipboard?.write === 'function',
    )
  }, [])

  const highlighted = useMemo(() => highlightCode(code, lang), [code, lang])
  const effectiveLang = lang === 'auto' ? highlighted.language : lang
  const formatSupported = canFormat(effectiveLang)

  const formatSource = useCallback(async () => {
    const res = await formatCode(code, effectiveLang)
    if (res.error) {
      toast.error(t('formatFailed'))
      return
    }
    setCode(res.output)
  }, [code, effectiveLang, t])

  const background = BACKGROUNDS.find((b) => b.id === backgroundId) ?? BACKGROUNDS[0]
  const isDarkWindow = windowTheme === 'dark'

  const exportPng = useCallback(async () => {
    const node = previewRef.current
    if (!node) return
    setExporting(true)
    try {
      const blob = await toBlob(node, { pixelRatio: scale, cacheBust: true })
      if (!blob) throw new Error('no blob')
      downloadFile(blob, 'code-screenshot.png')
    } catch {
      toast.error(t('exportFailed'))
    } finally {
      setExporting(false)
    }
  }, [scale, t])

  const copyImage = useCallback(async () => {
    const node = previewRef.current
    if (!node) return
    if (!('ClipboardItem' in window) || typeof navigator.clipboard?.write !== 'function') {
      toast.error(t('copyUnsupported'))
      return
    }
    setExporting(true)
    try {
      const blob = await toBlob(node, { pixelRatio: scale, cacheBust: true })
      if (!blob) throw new Error('no blob')
      await navigator.clipboard.write([new ClipboardItem({ 'image/png': blob })])
      setImageCopied(true)
      setTimeout(() => setImageCopied(false), 2000)
    } catch {
      toast.error(t('copyFailed'))
    } finally {
      setExporting(false)
    }
  }, [scale, t])

  const toolbar = (
    <div className="flex flex-wrap items-end gap-x-5 gap-y-4 rounded-lg border border-border bg-card p-4">
      <div className="space-y-1.5">
        <Label className="text-xs font-medium uppercase tracking-wider text-muted-foreground">
          {t('languageLabel')}
        </Label>
        <Select value={lang} onValueChange={setLang}>
          <SelectTrigger className="w-[180px]">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="auto">{t('autoDetect')}</SelectItem>
            {LANGUAGES.map((l) => (
              <SelectItem key={l.value} value={l.value}>
                {l.label}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>

      <div className="space-y-1.5">
        <Label className="text-xs font-medium uppercase tracking-wider text-muted-foreground">
          {t('backgroundLabel')}
        </Label>
        <Select value={backgroundId} onValueChange={setBackgroundId}>
          <SelectTrigger className="w-[170px]">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            {BACKGROUNDS.map((b) => (
              <SelectItem key={b.id} value={b.id}>
                <span className="flex items-center gap-2">
                  <span
                    className="h-3.5 w-3.5 shrink-0 rounded-full ring-1 ring-inset ring-border"
                    style={b.css ? { background: b.css } : CHECKERBOARD}
                    aria-hidden
                  />
                  {t(`backgrounds.${b.id}`)}
                </span>
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>

      <div className="w-[150px] space-y-1.5">
        <Label className="text-xs font-medium uppercase tracking-wider text-muted-foreground">
          {t('paddingLabel')} · {padding}px
        </Label>
        <Slider
          value={[padding]}
          min={16}
          max={128}
          step={4}
          onValueChange={(v) => setPadding(v[0] ?? 48)}
          className="py-2"
        />
      </div>

      <div className="space-y-1.5">
        <Label className="text-xs font-medium uppercase tracking-wider text-muted-foreground">
          {t('filenameLabel')}
        </Label>
        <Input
          value={filename}
          onChange={(e) => setFilename(e.target.value)}
          placeholder={t('filenamePlaceholder')}
          className="w-[170px]"
        />
      </div>

      <div className="space-y-1.5">
        <Label className="text-xs font-medium uppercase tracking-wider text-muted-foreground">
          {t('windowLabel')}
        </Label>
        <div className="flex h-9 items-center">
          <Switch checked={windowControls} onCheckedChange={setWindowControls} />
        </div>
      </div>

      <div className="space-y-1.5">
        <Label className="text-xs font-medium uppercase tracking-wider text-muted-foreground">
          {t('themeLabel')}
        </Label>
        <ToggleGroup
          type="single"
          value={windowTheme}
          onValueChange={(v) => v && setWindowTheme(v as 'dark' | 'light')}
          className="justify-start"
        >
          <ToggleGroupItem value="dark" className="px-3 text-xs">
            {t('themeDark')}
          </ToggleGroupItem>
          <ToggleGroupItem value="light" className="px-3 text-xs">
            {t('themeLight')}
          </ToggleGroupItem>
        </ToggleGroup>
      </div>

      <div className="space-y-1.5">
        <Label className="text-xs font-medium uppercase tracking-wider text-muted-foreground">
          {t('scaleLabel')}
        </Label>
        <ToggleGroup
          type="single"
          value={String(scale)}
          onValueChange={(v) => v && setScale(Number(v))}
          className="justify-start"
        >
          {[1, 2, 3].map((s) => (
            <ToggleGroupItem key={s} value={String(s)} className="px-3 text-xs">
              {s}x
            </ToggleGroupItem>
          ))}
        </ToggleGroup>
      </div>

      <div className="ml-auto flex items-end gap-2">
        <Button size="sm" variant="secondary" onClick={copyImage} disabled={exporting || !code || !canCopyImage}>
          {imageCopied ? <Check className="mr-1.5 h-4 w-4 text-emerald-600" /> : <Copy className="mr-1.5 h-4 w-4" />}
          {imageCopied ? t('copied') : t('copyImage')}
        </Button>
        <Button size="sm" onClick={exportPng} disabled={exporting || !code}>
          <ImageDown className="mr-1.5 h-4 w-4" />
          {t('exportPng')}
        </Button>
      </div>
    </div>
  )

  return (
    <ToolShell
      icon={IconPhotoCode}
      title={t('title')}
      description={t('subtitle')}
      toolbar={toolbar}
    >
      {/* Static stylesheet constant in this file. */}
      {/* threatcrush-disable-next-line js-unescaped-html-sink */}
      <style dangerouslySetInnerHTML={{ __html: SCOPED_HLJS_CSS }} />

      <div className="grid min-h-0 flex-1 grid-cols-1 gap-4 lg:grid-cols-2">
        <IOPanel
          bodyClassName="min-h-[160px]"
          label={
            <>
              <FileCode className="h-3.5 w-3.5" aria-hidden />
              {t('inputLabel')}
              {lang === 'auto' && code ? (
                <span className="text-[11px] text-muted-foreground/70">
                  {t('detected', { language: highlighted.language })}
                </span>
              ) : null}
            </>
          }
          actions={
            <>
              <Button
                variant="ghost"
                size="sm"
                className="h-7 gap-1.5 px-2 text-xs"
                onClick={formatSource}
                disabled={!code || !formatSupported}
                title={formatSupported ? t('format') : t('formatUnsupported')}
              >
                <Wand2 className="h-3.5 w-3.5" />
                {t('format')}
              </Button>
              <Button
                variant="ghost"
                size="icon"
                className="h-7 w-7"
                onClick={() => setCode('')}
                disabled={!code}
                title={t('clear')}
              >
                <Trash2 className="h-3.5 w-3.5" />
              </Button>
            </>
          }
        >
          <ToolTextArea
            value={code}
            onChange={(e) => setCode(e.target.value)}
            placeholder={t('placeholder')}
            autoComplete="off"
            className="p-4"
          />
        </IOPanel>

        <div className="flex min-h-0 flex-col overflow-hidden rounded-lg border border-border bg-card">
          <div className="flex items-center border-b border-border/50 bg-muted/30 px-4 py-2.5">
            <Label className="text-xs font-medium uppercase tracking-wider text-muted-foreground">
              {t('previewLabel')}
            </Label>
          </div>
          <div className="min-h-0 flex-1 overflow-auto p-4" style={background.css ? undefined : CHECKERBOARD}>
            {code ? (
              <div
                ref={previewRef}
                className="inline-block min-w-full rounded-xl sm:min-w-0"
                style={{ padding, background: background.css ?? 'transparent' }}
              >
                <div
                  className={`overflow-hidden rounded-lg shadow-2xl ${
                    isDarkWindow ? 'bg-[#282c34]' : 'bg-[#fafafa]'
                  }`}
                >
                  {(windowControls || filename) && (
                    <div className="flex items-center gap-2 px-4 pt-3.5">
                      {windowControls && (
                        <span className="flex gap-1.5" aria-hidden>
                          <span className="h-3 w-3 rounded-full bg-[#ff5f57]" />
                          <span className="h-3 w-3 rounded-full bg-[#febc2e]" />
                          <span className="h-3 w-3 rounded-full bg-[#28c840]" />
                        </span>
                      )}
                      {filename ? (
                        <span
                          className={`flex-1 truncate text-center font-mono text-xs ${
                            isDarkWindow ? 'text-white/50' : 'text-black/50'
                          } ${windowControls ? 'pr-[54px]' : ''}`}
                        >
                          {filename}
                        </span>
                      ) : null}
                    </div>
                  )}
                  <pre className="overflow-x-auto p-5 text-sm leading-relaxed">
                    <code
                      className={`cshot-code ${isDarkWindow ? '' : 'cshot-code--light'} block whitespace-pre font-mono`}
                      // highlight.js escapes the source it is handed.
                      // threatcrush-disable-next-line js-unescaped-html-sink
                      dangerouslySetInnerHTML={{ __html: highlighted.html }}
                    />
                  </pre>
                </div>
              </div>
            ) : (
              <div className="flex h-full items-center justify-center text-sm text-muted-foreground">
                {t('emptyPreview')}
              </div>
            )}
          </div>
        </div>
      </div>
    </ToolShell>
  )
}
