'use client'

import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { useTranslations } from 'next-intl'
import exifr from 'exifr'
import { toast } from 'sonner'
import { useCopyToClipboard } from '@/hooks/use-copy-to-clipboard'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Checkbox } from '@/components/ui/checkbox'
import { ScrollArea } from '@/components/ui/scroll-area'
import {
  Collapsible,
  CollapsibleContent,
  CollapsibleTrigger,
} from '@/components/ui/collapsible'
import {
  Aperture,
  Camera,
  Check,
  ChevronDown,
  Clock,
  Copy,
  Download,
  ExternalLink,
  Info,
  MapPin,
  ShieldAlert,
  Trash2,
  Upload,
  Wrench,
} from 'lucide-react'
import { IconPhotoSearch } from '@tabler/icons-react'
import { ToolShell } from '@/components/tools/tool-shell'
import { IOPanel } from '@/components/tools/io-panel'
import { downloadFile } from '@/lib/desktop/save-file'
import {
  decimalToDms,
  formatBytes,
  groupMetadata,
  isJpeg,
  osmLink,
  stripJpegMetadata,
  tagsToJson,
  type ExifValue,
  type MetadataEntry,
} from '@/lib/exif-viewer'

const ACCEPT = '.jpg,.jpeg,.png,.webp,.heic,.heif,.tif,.tiff,image/jpeg,image/png,image/webp,image/heic,image/heif,image/tiff'

interface LoadedImage {
  file: File
  url: string
  kind: 'jpeg' | 'png' | 'webp' | 'other'
}

interface GpsInfo {
  latitude: number
  longitude: number
}

function detectKind(file: File, buffer: ArrayBuffer): LoadedImage['kind'] {
  if (isJpeg(buffer)) return 'jpeg'
  const bytes = new Uint8Array(buffer)
  if (bytes[0] === 0x89 && bytes[1] === 0x50 && bytes[2] === 0x4e && bytes[3] === 0x47) return 'png'
  if (
    bytes[0] === 0x52 && bytes[1] === 0x49 && bytes[2] === 0x46 && bytes[3] === 0x46 &&
    bytes[8] === 0x57 && bytes[9] === 0x45 && bytes[10] === 0x42 && bytes[11] === 0x50
  ) {
    return 'webp'
  }
  return 'other'
}

function cleanedName(name: string): string {
  const dot = name.lastIndexOf('.')
  if (dot <= 0) return `${name}-clean`
  return `${name.slice(0, dot)}-clean${name.slice(dot)}`
}

function MetadataCard({
  title,
  icon,
  entries,
}: {
  title: string
  icon: React.ReactNode
  entries: MetadataEntry[]
}) {
  if (entries.length === 0) return null
  return (
    <div className="rounded-lg border border-border bg-card p-4">
      <div className="mb-2.5 flex items-center gap-2">
        {icon}
        <h3 className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">{title}</h3>
      </div>
      <dl className="space-y-1.5">
        {entries.map((entry) => (
          <div key={entry.key} className="flex items-baseline justify-between gap-3 text-sm">
            <dt className="shrink-0 text-muted-foreground">{entry.key}</dt>
            <dd className="break-all text-right font-mono text-xs">{entry.value}</dd>
          </div>
        ))}
      </dl>
    </div>
  )
}

export function ExifViewerLayout() {
  const t = useTranslations('ExifViewer')
  const { isCopied: jsonCopied, copyToClipboard } = useCopyToClipboard()
  const [image, setImage] = useState<LoadedImage | null>(null)
  const [buffer, setBuffer] = useState<ArrayBuffer | null>(null)
  const [tags, setTags] = useState<Record<string, ExifValue> | null>(null)
  const [gps, setGps] = useState<GpsInfo | null>(null)
  const [dimensions, setDimensions] = useState<{ w: number; h: number } | null>(null)
  const [parsing, setParsing] = useState(false)
  const [dragOver, setDragOver] = useState(false)
  const [keepIcc, setKeepIcc] = useState(true)
  const [cleaned, setCleaned] = useState<{ blob: Blob; name: string } | null>(null)
  const [rawOpen, setRawOpen] = useState(false)
  const inputRef = useRef<HTMLInputElement>(null)

  useEffect(() => {
    return () => {
      if (image) URL.revokeObjectURL(image.url)
    }
  }, [image])

  const loadFile = useCallback(
    async (file: File) => {
      setParsing(true)
      setTags(null)
      setGps(null)
      setCleaned(null)
      setDimensions(null)
      setRawOpen(false)
      try {
        const buf = await file.arrayBuffer()
        const kind = detectKind(file, buf)
        setBuffer(buf)
        setImage((prev) => {
          if (prev) URL.revokeObjectURL(prev.url)
          return { file, url: URL.createObjectURL(file), kind }
        })
        const [parsed, gpsData] = await Promise.all([
          exifr
            .parse(file, { xmp: true, icc: true, iptc: true, jfif: true, ihdr: true })
            .catch(() => null),
          exifr.gps(file).catch(() => null),
        ])
        setTags(parsed && typeof parsed === 'object' ? (parsed as Record<string, ExifValue>) : null)
        if (gpsData && Number.isFinite(gpsData.latitude) && Number.isFinite(gpsData.longitude)) {
          setGps({ latitude: gpsData.latitude, longitude: gpsData.longitude })
        }
      } catch {
        toast.error(t('parseFailed'))
      } finally {
        setParsing(false)
      }
    },
    [t],
  )

  const onDrop = useCallback(
    (e: React.DragEvent) => {
      e.preventDefault()
      setDragOver(false)
      const file = e.dataTransfer.files?.[0]
      if (file) void loadFile(file)
    },
    [loadFile],
  )

  const reset = useCallback(() => {
    setImage((prev) => {
      if (prev) URL.revokeObjectURL(prev.url)
      return null
    })
    setBuffer(null)
    setTags(null)
    setGps(null)
    setCleaned(null)
    setDimensions(null)
  }, [])

  const groups = useMemo(() => (tags ? groupMetadata(tags) : null), [tags])
  const hasMetadata = useMemo(
    () => !!groups && Object.values(groups).some((g) => g.length > 0),
    [groups],
  )
  const altitude = tags && typeof tags.GPSAltitude === 'number' ? tags.GPSAltitude : null

  const removeMetadata = useCallback(async () => {
    if (!image || !buffer) return
    try {
      if (image.kind === 'jpeg') {
        const stripped = stripJpegMetadata(buffer, { keepIcc })
        setCleaned({ blob: new Blob([stripped], { type: 'image/jpeg' }), name: cleanedName(image.file.name) })
        return
      }
      // PNG / WebP: re-encode through a canvas (drops all ancillary metadata chunks).
      const bitmap = await createImageBitmap(image.file)
      const canvas = document.createElement('canvas')
      canvas.width = bitmap.width
      canvas.height = bitmap.height
      const ctx = canvas.getContext('2d')
      if (!ctx) throw new Error('canvas')
      ctx.drawImage(bitmap, 0, 0)
      bitmap.close()
      const mime = image.kind === 'webp' ? 'image/webp' : 'image/png'
      const blob = await new Promise<Blob | null>((resolve) => canvas.toBlob(resolve, mime))
      if (!blob) throw new Error('encode')
      setCleaned({ blob, name: cleanedName(image.file.name) })
    } catch {
      toast.error(t('remove.failed'))
    }
  }, [image, buffer, keepIcc, t])

  if (!image) {
    return (
      <ToolShell icon={IconPhotoSearch} title={t('title')} description={t('subtitle')}>
        <IOPanel
          label={t('dropTitle')}
          onDragOver={(e) => {
            e.preventDefault()
            setDragOver(true)
          }}
          onDragLeave={() => setDragOver(false)}
          onDrop={onDrop}
          className={`flex-1 transition-colors ${dragOver ? 'border-primary bg-primary/5' : ''}`}
        >
          <div
            className="absolute inset-0 flex cursor-pointer flex-col items-center justify-center gap-3 p-8 text-center"
            onClick={() => inputRef.current?.click()}
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
            <p className="text-[11px] text-muted-foreground/70">{t('formats')}</p>
            <input
              ref={inputRef}
              type="file"
              accept={ACCEPT}
              className="hidden"
              onChange={(e) => {
                const file = e.target.files?.[0]
                if (file) void loadFile(file)
                e.target.value = ''
              }}
            />
          </div>
        </IOPanel>
      </ToolShell>
    )
  }

  return (
    <ToolShell icon={IconPhotoSearch} title={t('title')} description={t('subtitle')}>
      <ScrollArea className="min-h-0 flex-1">
        <div className="flex flex-col gap-4 pr-3">
          <IOPanel
            label={image.file.name}
            actions={
              <>
                {gps && (
                  <Badge className="gap-1 border-amber-500/40 bg-amber-500/15 text-amber-700 dark:text-amber-400" variant="outline">
                    <ShieldAlert className="h-3.5 w-3.5" />
                    {t('gpsWarning')}
                  </Badge>
                )}
                <Button variant="ghost" size="icon" className="h-8 w-8" onClick={reset} title={t('clear')}>
                  <Trash2 className="h-4 w-4" />
                </Button>
              </>
            }
          >
            <div className="flex flex-wrap items-center gap-4 p-4">
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img
                src={image.url}
                alt={image.file.name}
                className="h-20 w-20 rounded-lg border border-border/60 object-cover"
                onLoad={(e) => {
                  const el = e.currentTarget
                  if (el.naturalWidth) setDimensions({ w: el.naturalWidth, h: el.naturalHeight })
                }}
                onError={(e) => {
                  e.currentTarget.style.visibility = 'hidden'
                }}
              />
              <dl className="grid flex-1 grid-cols-2 gap-x-6 gap-y-1.5 text-sm sm:grid-cols-4">
                <div>
                  <dt className="text-xs text-muted-foreground">{t('facts.name')}</dt>
                  <dd className="break-all font-medium">{image.file.name}</dd>
                </div>
                <div>
                  <dt className="text-xs text-muted-foreground">{t('facts.type')}</dt>
                  <dd className="font-mono text-xs">{image.file.type || '—'}</dd>
                </div>
                <div>
                  <dt className="text-xs text-muted-foreground">{t('facts.dimensions')}</dt>
                  <dd className="font-mono text-xs">{dimensions ? `${dimensions.w} × ${dimensions.h}` : '—'}</dd>
                </div>
                <div>
                  <dt className="text-xs text-muted-foreground">{t('facts.size')}</dt>
                  <dd className="font-mono text-xs">{formatBytes(image.file.size)}</dd>
                </div>
              </dl>
            </div>
          </IOPanel>

          {parsing ? (
            <div className="rounded-lg border border-border bg-card p-6 text-center text-sm text-muted-foreground">
              {t('parsing')}
            </div>
          ) : hasMetadata && groups ? (
            <div className="grid grid-cols-1 gap-4 md:grid-cols-2 xl:grid-cols-3">
              <MetadataCard
                title={t('groups.camera')}
                icon={<Camera className="h-3.5 w-3.5 text-muted-foreground" />}
                entries={groups.camera}
              />
              <MetadataCard
                title={t('groups.exposure')}
                icon={<Aperture className="h-3.5 w-3.5 text-muted-foreground" />}
                entries={groups.exposure}
              />
              <MetadataCard
                title={t('groups.timestamps')}
                icon={<Clock className="h-3.5 w-3.5 text-muted-foreground" />}
                entries={groups.timestamps}
              />
              {gps && (
                <div className="rounded-lg border border-amber-500/30 bg-card p-4">
                  <div className="mb-2.5 flex items-center gap-2">
                    <MapPin className="h-3.5 w-3.5 text-amber-600 dark:text-amber-400" />
                    <h3 className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">
                      {t('groups.gps')}
                    </h3>
                  </div>
                  <dl className="space-y-1.5 text-sm">
                    <div className="flex items-baseline justify-between gap-3">
                      <dt className="text-muted-foreground">{t('gpsCard.latitude')}</dt>
                      <dd className="text-right font-mono text-xs">
                        {decimalToDms(gps.latitude, 'lat')} ({gps.latitude.toFixed(6)})
                      </dd>
                    </div>
                    <div className="flex items-baseline justify-between gap-3">
                      <dt className="text-muted-foreground">{t('gpsCard.longitude')}</dt>
                      <dd className="text-right font-mono text-xs">
                        {decimalToDms(gps.longitude, 'lon')} ({gps.longitude.toFixed(6)})
                      </dd>
                    </div>
                    {altitude !== null && (
                      <div className="flex items-baseline justify-between gap-3">
                        <dt className="text-muted-foreground">{t('gpsCard.altitude')}</dt>
                        <dd className="text-right font-mono text-xs">{altitude.toFixed(1)} m</dd>
                      </div>
                    )}
                  </dl>
                  <a
                    href={osmLink(gps.latitude, gps.longitude)}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="mt-3 inline-flex items-center gap-1.5 text-xs font-medium text-primary hover:underline"
                  >
                    <ExternalLink className="h-3.5 w-3.5" />
                    {t('openMap')}
                  </a>
                </div>
              )}
              <MetadataCard
                title={t('groups.software')}
                icon={<Wrench className="h-3.5 w-3.5 text-muted-foreground" />}
                entries={groups.software}
              />
            </div>
          ) : (
            <div className="flex items-center gap-3 rounded-lg border border-border bg-card p-6 text-sm text-muted-foreground">
              <Info className="h-4 w-4 shrink-0" />
              {t('noMetadata')}
            </div>
          )}

          {tags && hasMetadata && (
            <Collapsible open={rawOpen} onOpenChange={setRawOpen}>
              <div className="overflow-hidden rounded-lg border border-border bg-card">
                <div className="flex items-center justify-between px-4 py-2.5">
                  <CollapsibleTrigger asChild>
                    <button
                      type="button"
                      className="flex items-center gap-2 text-xs font-semibold uppercase tracking-wider text-muted-foreground"
                    >
                      <ChevronDown className={`h-3.5 w-3.5 transition-transform ${rawOpen ? '' : '-rotate-90'}`} />
                      {t('raw.title')} ({Object.keys(tags).length})
                    </button>
                  </CollapsibleTrigger>
                  <Button
                    size="sm"
                    variant="secondary"
                    onClick={() => void copyToClipboard(tagsToJson(tags), { silent: true })}
                  >
                    {jsonCopied ? <Check className="mr-1.5 h-4 w-4 text-emerald-600" /> : <Copy className="mr-1.5 h-4 w-4" />}
                    {jsonCopied ? t('raw.copied') : t('raw.copyJson')}
                  </Button>
                </div>
                <CollapsibleContent>
                  <div className="max-h-80 overflow-auto border-t border-border/50">
                    <table className="w-full text-xs">
                      <tbody>
                        {Object.entries(tags).map(([key, value]) => (
                          <tr key={key} className="border-b border-border/30 last:border-0">
                            <td className="whitespace-nowrap px-4 py-1.5 font-medium text-muted-foreground">{key}</td>
                            <td className="break-all px-4 py-1.5 font-mono">
                              {value instanceof Date
                                ? value.toISOString()
                                : typeof value === 'object' && value !== null
                                  ? value instanceof Uint8Array
                                    ? `[${value.length} bytes]`
                                    : JSON.stringify(value)
                                  : String(value)}
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                </CollapsibleContent>
              </div>
            </Collapsible>
          )}

          <div className="rounded-lg border border-border bg-card p-4">
            <h3 className="mb-1 text-xs font-semibold uppercase tracking-wider text-muted-foreground">
              {t('remove.title')}
            </h3>
            {image.kind === 'jpeg' ? (
              <>
                <p className="mb-3 text-sm text-muted-foreground">{t('remove.jpegDescription')}</p>
                <div className="flex flex-wrap items-center gap-4">
                  <label className="flex items-center gap-2 text-sm">
                    <Checkbox checked={keepIcc} onCheckedChange={(v) => setKeepIcc(v === true)} />
                    {t('remove.keepIcc')}
                  </label>
                  <Button size="sm" onClick={() => void removeMetadata()}>
                    <Trash2 className="mr-1.5 h-4 w-4" />
                    {t('remove.stripButton')}
                  </Button>
                </div>
              </>
            ) : image.kind === 'png' || image.kind === 'webp' ? (
              <>
                <p className="mb-3 text-sm text-muted-foreground">{t('remove.reencodeDescription')}</p>
                <Button size="sm" onClick={() => void removeMetadata()}>
                  <Trash2 className="mr-1.5 h-4 w-4" />
                  {t('remove.reencodeButton')}
                </Button>
              </>
            ) : (
              <p className="text-sm text-muted-foreground">{t('remove.unsupported')}</p>
            )}

            {cleaned && (
              <div className="mt-4 flex flex-wrap items-center gap-4 rounded-lg border border-border/60 bg-muted/30 p-3">
                <div className="text-sm">
                  <span className="text-muted-foreground">{t('remove.before')}:</span>{' '}
                  <span className="font-mono text-xs">{formatBytes(image.file.size)}</span>
                  <span className="mx-2 text-muted-foreground">→</span>
                  <span className="text-muted-foreground">{t('remove.after')}:</span>{' '}
                  <span className="font-mono text-xs">{formatBytes(cleaned.blob.size)}</span>
                </div>
                <Button size="sm" variant="secondary" onClick={() => downloadFile(cleaned.blob, cleaned.name)}>
                  <Download className="mr-1.5 h-4 w-4" />
                  {t('remove.download')}
                </Button>
              </div>
            )}
          </div>
        </div>
      </ScrollArea>
    </ToolShell>
  )
}
