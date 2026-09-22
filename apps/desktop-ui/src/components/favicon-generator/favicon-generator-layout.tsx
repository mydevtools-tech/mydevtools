'use client'

import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { useTranslations } from 'next-intl'
import JSZip from 'jszip'
import { toast } from 'sonner'
import { useCopyToClipboard } from '@/hooks/use-copy-to-clipboard'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Slider } from '@/components/ui/slider'
import { ScrollArea } from '@/components/ui/scroll-area'
import { ToggleGroup, ToggleGroupItem } from '@/components/ui/toggle-group'
import { Check, Copy, Download, Package, Trash2, Upload } from 'lucide-react'
import { IconFavicon } from '@tabler/icons-react'
import { ToolShell } from '@/components/tools/tool-shell'
import { saveFile } from '@/lib/desktop/save-file'
import {
  ICON_SIZES,
  ICO_SIZES,
  buildHeadSnippet,
  buildIco,
  buildManifestSnippet,
  pngFileName,
} from '@/lib/favicon-generator'

const ACCEPT = '.png,.jpg,.jpeg,.svg,image/png,image/jpeg,image/svg+xml'
type Radius = 'none' | 'rounded' | 'circle'

interface RenderedIcon {
  size: number
  maskable: boolean
  dataUrl: string
  bytes: Uint8Array
}

function dataUrlToBytes(dataUrl: string): Uint8Array {
  const base64 = dataUrl.split(',')[1] ?? ''
  const binary = atob(base64)
  const bytes = new Uint8Array(binary.length)
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i)
  return bytes
}

function drawRoundedPath(ctx: CanvasRenderingContext2D, size: number, radius: Radius) {
  const r = radius === 'circle' ? size / 2 : radius === 'rounded' ? size * 0.22 : 0
  ctx.beginPath()
  if (r <= 0) {
    ctx.rect(0, 0, size, size)
  } else {
    ctx.moveTo(r, 0)
    ctx.arcTo(size, 0, size, size, r)
    ctx.arcTo(size, size, 0, size, r)
    ctx.arcTo(0, size, 0, 0, r)
    ctx.arcTo(0, 0, size, 0, r)
  }
  ctx.closePath()
}

export function FaviconGeneratorLayout() {
  const t = useTranslations('FaviconGenerator')
  const { copyToClipboard } = useCopyToClipboard()
  const [source, setSource] = useState<HTMLImageElement | null>(null)
  const [sourceName, setSourceName] = useState('')
  const [transparentBg, setTransparentBg] = useState(true)
  const [bgColor, setBgColor] = useState('#ffffff')
  const [radius, setRadius] = useState<Radius>('none')
  const [maskPadding, setMaskPadding] = useState(15)
  const [icons, setIcons] = useState<RenderedIcon[]>([])
  const [dragOver, setDragOver] = useState(false)
  const [copiedKey, setCopiedKey] = useState<string | null>(null)
  const inputRef = useRef<HTMLInputElement>(null)

  const manifestSnippet = useMemo(() => buildManifestSnippet(), [])
  const headSnippet = useMemo(() => buildHeadSnippet(), [])

  const renderIconSize = useCallback(
    (img: HTMLImageElement, size: number, maskable: boolean): RenderedIcon => {
      const canvas = document.createElement('canvas')
      canvas.width = size
      canvas.height = size
      const ctx = canvas.getContext('2d')!
      ctx.clearRect(0, 0, size, size)

      // Clip to the chosen corner shape (skip for maskable, which needs full bleed).
      if (!maskable && radius !== 'none') {
        drawRoundedPath(ctx, size, radius)
        ctx.clip()
      }

      // Fill a background when the user picked a solid color, or always for
      // maskable icons (which must be fully opaque behind the safe zone).
      if (!transparentBg || maskable) {
        ctx.fillStyle = bgColor
        ctx.fillRect(0, 0, size, size)
      }

      const pad = maskable ? (size * maskPadding) / 100 : 0
      const inner = size - pad * 2
      const scale = Math.min(inner / img.width, inner / img.height)
      const w = img.width * scale
      const h = img.height * scale
      ctx.drawImage(img, (size - w) / 2, (size - h) / 2, w, h)

      const dataUrl = canvas.toDataURL('image/png')
      return { size, maskable, dataUrl, bytes: dataUrlToBytes(dataUrl) }
    },
    [transparentBg, bgColor, radius, maskPadding],
  )

  const regenerate = useCallback(
    (img: HTMLImageElement) => {
      const rendered: RenderedIcon[] = ICON_SIZES.map((size) => renderIconSize(img, size, false))
      rendered.push(renderIconSize(img, 512, true))
      setIcons(rendered)
    },
    [renderIconSize],
  )

  useEffect(() => {
    if (source) regenerate(source)
  }, [source, regenerate])

  const loadFile = useCallback((file: File) => {
    const url = URL.createObjectURL(file)
    const img = new Image()
    img.onload = () => {
      setSource(img)
      setSourceName(file.name)
      URL.revokeObjectURL(url)
    }
    img.onerror = () => {
      toast.error(t('loadError'))
      URL.revokeObjectURL(url)
    }
    img.src = url
  }, [t])

  const onDrop = useCallback(
    (e: React.DragEvent) => {
      e.preventDefault()
      setDragOver(false)
      const file = e.dataTransfer.files?.[0]
      if (file) loadFile(file)
    },
    [loadFile],
  )

  /** ICO payload for the current icons, or null while a size is still missing. */
  const buildIcoBytes = useCallback(() => {
    const images = ICO_SIZES.map((size) => icons.find((i) => i.size === size && !i.maskable))
    if (images.some((icon) => !icon)) return null
    return buildIco(images.map((icon) => ({ size: icon!.size, png: icon!.bytes })))
  }, [icons])

  const downloadIco = useCallback(async () => {
    const ico = buildIcoBytes()
    if (!ico) return
    try {
      await saveFile(ico, 'favicon.ico', 'image/x-icon')
    } catch (err) {
      toast.error(err instanceof Error ? err.message : t('saveError'))
    }
  }, [buildIcoBytes, t])

  const downloadPng = async (icon: RenderedIcon) => {
    try {
      await saveFile(icon.bytes, pngFileName(icon.size, icon.maskable), 'image/png')
    } catch (err) {
      toast.error(err instanceof Error ? err.message : t('saveError'))
    }
  }

  const downloadZip = useCallback(async () => {
    const ico = buildIcoBytes()
    if (!ico) return
    try {
      const zip = new JSZip()
      zip.file('favicon.ico', ico)
      for (const icon of icons) {
        zip.file(pngFileName(icon.size, icon.maskable), icon.bytes)
      }
      zip.file('site.webmanifest', manifestSnippet)
      zip.file('head-snippet.html', headSnippet)
      const bytes = await zip.generateAsync({ type: 'uint8array' })
      await saveFile(bytes, 'favicons.zip', 'application/zip')
    } catch (err) {
      toast.error(err instanceof Error ? err.message : t('saveError'))
    }
  }, [buildIcoBytes, icons, manifestSnippet, headSnippet, t])

  const copySnippet = (key: string, text: string) => {
    void copyToClipboard(text, { silent: true })
    setCopiedKey(key)
    setTimeout(() => setCopiedKey((k) => (k === key ? null : k)), 2000)
  }

  const reset = () => {
    setSource(null)
    setSourceName('')
    setIcons([])
  }

  if (!source) {
    return (
      <ToolShell icon={IconFavicon} title={t('title')} description={t('subtitle')} offline={false}>
        <div
          className={`flex flex-1 cursor-pointer flex-col items-center justify-center gap-3 rounded-lg border-2 border-dashed p-8 text-center transition-colors ${
            dragOver ? 'border-primary bg-primary/5' : 'border-border/70'
          }`}
          onClick={() => inputRef.current?.click()}
          onDragOver={(e) => {
            e.preventDefault()
            setDragOver(true)
          }}
          onDragLeave={() => setDragOver(false)}
          onDrop={onDrop}
          role="button"
          tabIndex={0}
          onKeyDown={(e) => {
            if (e.key === 'Enter' || e.key === ' ') inputRef.current?.click()
          }}
        >
          <span className="flex h-12 w-12 items-center justify-center rounded-2xl bg-pink-500/10 text-pink-600 dark:text-pink-400">
            <Upload className="h-6 w-6" />
          </span>
          <div>
            <p className="text-sm font-medium">{t('dropTitle')}</p>
            <p className="mt-1 text-xs text-muted-foreground">{t('dropHint')}</p>
          </div>
          <Button size="sm" variant="secondary" type="button">
            {t('browse')}
          </Button>
          <input
            ref={inputRef}
            type="file"
            accept={ACCEPT}
            className="hidden"
            onChange={(e) => {
              const file = e.target.files?.[0]
              if (file) loadFile(file)
              e.target.value = ''
            }}
          />
        </div>
      </ToolShell>
    )
  }

  return (
    <ToolShell icon={IconFavicon} title={t('title')} description={t('subtitle')} offline={false}>
      <div className="grid min-h-0 flex-1 grid-cols-1 gap-4 lg:grid-cols-[300px_1fr]">
        <div className="flex flex-col gap-5 rounded-lg border border-border bg-card p-4">
          <div className="flex items-center justify-between">
            <span className="truncate text-sm font-medium" title={sourceName}>
              {sourceName}
            </span>
            <Button variant="ghost" size="icon" className="h-8 w-8" onClick={reset} title={t('clear')}>
              <Trash2 className="h-4 w-4" />
            </Button>
          </div>

          <div className="space-y-2">
            <Label className="text-xs font-medium uppercase tracking-wider text-muted-foreground">
              {t('backgroundLabel')}
            </Label>
            <ToggleGroup
              type="single"
              value={transparentBg ? 'transparent' : 'color'}
              onValueChange={(v) => v && setTransparentBg(v === 'transparent')}
              className="justify-start"
            >
              <ToggleGroupItem value="transparent" className="px-3 text-xs">
                {t('transparent')}
              </ToggleGroupItem>
              <ToggleGroupItem value="color" className="px-3 text-xs">
                {t('solidColor')}
              </ToggleGroupItem>
            </ToggleGroup>
            {!transparentBg && (
              <div className="flex items-center gap-2">
                <input
                  type="color"
                  value={bgColor}
                  onChange={(e) => setBgColor(e.target.value)}
                  className="h-9 w-12 cursor-pointer rounded border border-border bg-transparent"
                  aria-label={t('backgroundLabel')}
                />
                <Input value={bgColor} onChange={(e) => setBgColor(e.target.value)} className="h-9 flex-1 font-mono text-xs" />
              </div>
            )}
          </div>

          <div className="space-y-2">
            <Label className="text-xs font-medium uppercase tracking-wider text-muted-foreground">
              {t('cornerLabel')}
            </Label>
            <ToggleGroup
              type="single"
              value={radius}
              onValueChange={(v) => v && setRadius(v as Radius)}
              className="justify-start"
            >
              <ToggleGroupItem value="none" className="px-3 text-xs">
                {t('cornerNone')}
              </ToggleGroupItem>
              <ToggleGroupItem value="rounded" className="px-3 text-xs">
                {t('cornerRounded')}
              </ToggleGroupItem>
              <ToggleGroupItem value="circle" className="px-3 text-xs">
                {t('cornerCircle')}
              </ToggleGroupItem>
            </ToggleGroup>
          </div>

          <div className="space-y-2">
            <Label className="text-xs font-medium uppercase tracking-wider text-muted-foreground">
              {t('maskPaddingLabel')} · {maskPadding}%
            </Label>
            <Slider
              value={[maskPadding]}
              min={0}
              max={30}
              step={1}
              onValueChange={(v) => setMaskPadding(v[0] ?? 15)}
              className="py-2"
            />
          </div>

          <div className="mt-auto flex flex-col gap-2">
            <Button size="sm" onClick={() => void downloadIco()}>
              <Download className="mr-1.5 h-4 w-4" />
              {t('downloadIco')}
            </Button>
            <Button size="sm" variant="secondary" onClick={() => void downloadZip()}>
              <Package className="mr-1.5 h-4 w-4" />
              {t('downloadZip')}
            </Button>
          </div>
        </div>

        <ScrollArea className="min-h-0">
          <div className="flex flex-col gap-4 pr-3">
            <div className="rounded-lg border border-border bg-card p-4">
              <h3 className="mb-3 text-xs font-semibold uppercase tracking-wider text-muted-foreground">
                {t('previewLabel')}
              </h3>
              <div className="flex flex-wrap gap-5">
                {icons.map((icon) => (
                  <div key={`${icon.size}-${icon.maskable}`} className="flex flex-col items-center gap-1.5">
                    {/* eslint-disable-next-line @next/next/no-img-element */}
                    <img
                      src={icon.dataUrl}
                      alt={`${icon.size}px`}
                      width={Math.min(icon.size, 96)}
                      height={Math.min(icon.size, 96)}
                      className="rounded border border-border/60 bg-[conic-gradient(#0000_90deg,#8883_0_180deg,#0000_0_270deg,#8883_0)] [background-size:12px_12px]"
                      style={{ imageRendering: icon.size <= 48 ? 'pixelated' : 'auto' }}
                    />
                    <button
                      type="button"
                      onClick={() => downloadPng(icon)}
                      className="text-[11px] text-muted-foreground hover:text-foreground hover:underline"
                    >
                      {icon.size}
                      {icon.maskable ? ` ${t('maskable')}` : ''} · PNG
                    </button>
                  </div>
                ))}
              </div>
            </div>

            <div className="rounded-lg border border-border bg-card p-4">
              <div className="mb-2 flex items-center justify-between">
                <h3 className="font-mono text-xs font-semibold text-muted-foreground">site.webmanifest</h3>
                <Button size="sm" variant="secondary" onClick={() => copySnippet('manifest', manifestSnippet)}>
                  {copiedKey === 'manifest' ? (
                    <Check className="mr-1.5 h-4 w-4 text-emerald-600" />
                  ) : (
                    <Copy className="mr-1.5 h-4 w-4" />
                  )}
                  {t('copy')}
                </Button>
              </div>
              <pre className="overflow-x-auto rounded-lg bg-muted/50 p-3 font-mono text-xs">{manifestSnippet}</pre>
            </div>

            <div className="rounded-lg border border-border bg-card p-4">
              <div className="mb-2 flex items-center justify-between">
                <h3 className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">
                  {t('headSnippet')}
                </h3>
                <Button size="sm" variant="secondary" onClick={() => copySnippet('head', headSnippet)}>
                  {copiedKey === 'head' ? (
                    <Check className="mr-1.5 h-4 w-4 text-emerald-600" />
                  ) : (
                    <Copy className="mr-1.5 h-4 w-4" />
                  )}
                  {t('copy')}
                </Button>
              </div>
              <pre className="overflow-x-auto rounded-lg bg-muted/50 p-3 font-mono text-xs">{headSnippet}</pre>
            </div>
          </div>
        </ScrollArea>
      </div>
    </ToolShell>
  )
}
