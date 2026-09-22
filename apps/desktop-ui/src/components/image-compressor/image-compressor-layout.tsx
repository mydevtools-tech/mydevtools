'use client';

import React, { useCallback, useEffect, useRef, useState } from 'react';
import { useIsMobile } from '@/components/hooks/use-mobile';
import { useTranslations } from 'next-intl';
import {
  Upload,
  Trash2,
  Download,
  Image as ImageIcon,
  AlertCircle,
  Loader2,
} from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Label } from '@/components/ui/label';
import { Slider } from '@/components/ui/slider';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { IconArrowsDiagonalMinimize2 } from '@tabler/icons-react';
import { cn } from '@/lib/utils';
import { useDebouncedCallback } from 'use-debounce';
import { ToolShell } from '@/components/tools/tool-shell';
import { ToolPanels, IOPanel } from '@/components/tools/io-panel';
import { downloadFile } from '@/lib/desktop/save-file';

const MAX_FILE_BYTES = 20 * 1024 * 1024;
const MAX_CANVAS_EDGE = 8192;

type OutputMime = 'image/jpeg' | 'image/png' | 'image/webp';

const ACCEPTED_INPUT = new Set([
  'image/jpeg',
  'image/png',
  'image/webp',
  'image/gif',
  'image/avif',
  'image/bmp',
]);

function formatBytes(n: number): string {
  if (n < 1024) return `${n} B`;
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(1)} KB`;
  return `${(n / (1024 * 1024)).toFixed(2)} MB`;
}

function extForMime(m: OutputMime): string {
  if (m === 'image/jpeg') return 'jpg';
  if (m === 'image/png') return 'png';
  return 'webp';
}

function scaleToMaxEdge(w: number, h: number, max: number): { width: number; height: number } {
  const longest = Math.max(w, h);
  if (longest <= max) return { width: w, height: h };
  const scale = max / longest;
  return {
    width: Math.max(1, Math.round(w * scale)),
    height: Math.max(1, Math.round(h * scale)),
  };
}

function defaultOutputMime(inputMime: string): OutputMime {
  if (inputMime === 'image/png') return 'image/png';
  if (inputMime === 'image/webp') return 'image/webp';
  return 'image/jpeg';
}

export function ImageCompressorLayout() {
  const t = useTranslations('ImageCompressor');
  const isMobile = useIsMobile();
  const [mobileTab, setMobileTab] = useState<'original' | 'compressed'>('original');
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [sourceFile, setSourceFile] = useState<File | null>(null);
  const [sourceUrl, setSourceUrl] = useState<string | null>(null);
  const [compressedUrl, setCompressedUrl] = useState<string | null>(null);
  const [compressedBlob, setCompressedBlob] = useState<Blob | null>(null);
  const [originalBytes, setOriginalBytes] = useState(0);
  const [compressedBytes, setCompressedBytes] = useState(0);
  const [outputMime, setOutputMime] = useState<OutputMime>('image/jpeg');
  const [qualityPercent, setQualityPercent] = useState(82);
  const [error, setError] = useState('');
  const [isDragging, setIsDragging] = useState(false);
  const [processing, setProcessing] = useState(false);
  const bitmapRef = useRef<ImageBitmap | null>(null);
  const [bitmapReady, setBitmapReady] = useState(0);
  const encodeSeqRef = useRef(0);

  const closeBitmap = useCallback(() => {
    if (bitmapRef.current) {
      bitmapRef.current.close();
      bitmapRef.current = null;
    }
  }, []);

  const revokeUrls = useCallback(() => {
    if (sourceUrl) URL.revokeObjectURL(sourceUrl);
    if (compressedUrl) URL.revokeObjectURL(compressedUrl);
  }, [sourceUrl, compressedUrl]);

  const resetOutputs = useCallback(() => {
    encodeSeqRef.current++; // invalidate any in-flight encode
    setProcessing(false);
    setCompressedUrl((prev) => {
      if (prev) URL.revokeObjectURL(prev);
      return null;
    });
    setCompressedBlob(null);
    setCompressedBytes(0);
  }, []);

  const handleClear = useCallback(() => {
    revokeUrls();
    closeBitmap();
    setSourceFile(null);
    setSourceUrl(null);
    setOriginalBytes(0);
    resetOutputs();
    setError('');
  }, [closeBitmap, resetOutputs, revokeUrls]);

  const encode = useCallback(
    async (mime: OutputMime, quality: number | undefined) => {
      const bitmap = bitmapRef.current;
      if (!bitmap) return;
      const seq = ++encodeSeqRef.current;
      setProcessing(true);
      setError('');
      try {
        const { width, height } = scaleToMaxEdge(bitmap.width, bitmap.height, MAX_CANVAS_EDGE);
        const canvas = document.createElement('canvas');
        canvas.width = width;
        canvas.height = height;
        const ctx = canvas.getContext('2d');
        if (!ctx) throw new Error('no context');
        if (mime === 'image/jpeg') {
          ctx.fillStyle = '#ffffff';
          ctx.fillRect(0, 0, width, height);
        }
        ctx.drawImage(bitmap, 0, 0, width, height);

        const q = mime === 'image/png' ? undefined : quality;
        const blob: Blob | null = await new Promise((resolve) => {
          canvas.toBlob((b) => resolve(b), mime, q);
        });
        if (!blob) throw new Error('toBlob');
        if (seq !== encodeSeqRef.current) return; // stale — a newer encode superseded this one

        const url = URL.createObjectURL(blob);
        setCompressedBlob(blob);
        setCompressedUrl((prev) => {
          if (prev) URL.revokeObjectURL(prev);
          return url;
        });
        setCompressedBytes(blob.size);
        if (isMobile) setMobileTab('compressed');
      } catch {
        if (seq === encodeSeqRef.current) setError(t('compressFailed'));
      } finally {
        if (seq === encodeSeqRef.current) setProcessing(false);
      }
    },
    [isMobile, t]
  );

  // maxWait keeps encodes flowing mid-drag so the preview tracks in real time.
  const debouncedEncode = useDebouncedCallback(
    (mime: OutputMime, quality: number | undefined) => void encode(mime, quality),
    150,
    { maxWait: 300 }
  );

  const loadFile = useCallback(
    (file: File) => {
      if (file.size > MAX_FILE_BYTES) {
        setError(t('fileTooLarge', { maxMb: MAX_FILE_BYTES / (1024 * 1024) }));
        return;
      }
      if (!ACCEPTED_INPUT.has(file.type)) {
        setError(t('unsupportedFormat'));
        return;
      }
      setError('');
      if (sourceUrl) URL.revokeObjectURL(sourceUrl);
      resetOutputs();
      const nextSource = URL.createObjectURL(file);
      setSourceFile(file);
      setSourceUrl(nextSource);
      setOriginalBytes(file.size);
      setOutputMime(defaultOutputMime(file.type));
    },
    [resetOutputs, sourceUrl, t]
  );

  // Decode the source once per file; re-encoding reuses this bitmap.
  useEffect(() => {
    if (!sourceFile) return;
    closeBitmap(); // invalidate any prior bitmap so the encode effect no-ops until decode finishes
    let cancelled = false;
    createImageBitmap(sourceFile)
      .then((bmp) => {
        if (cancelled) {
          bmp.close();
          return;
        }
        bitmapRef.current = bmp;
        setBitmapReady((n) => n + 1);
      })
      .catch(() => {
        if (!cancelled) setError(t('compressFailed'));
      });
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [sourceFile]);

  // Re-encode from the cached bitmap when settings change. Debounced so dragging
  // the quality slider coalesces to a single encode instead of one per tick.
  useEffect(() => {
    if (!bitmapRef.current) return;
    const q = outputMime === 'image/png' ? 0.92 : qualityPercent / 100;
    debouncedEncode(outputMime, q);
  }, [bitmapReady, outputMime, qualityPercent, debouncedEncode]);

  // Release the cached bitmap on unmount.
  useEffect(() => closeBitmap, [closeBitmap]);

  const handleDrop = (e: React.DragEvent) => {
    e.preventDefault();
    setIsDragging(false);
    const file = e.dataTransfer.files[0];
    if (file) loadFile(file);
  };

  const handleDownload = () => {
    if (!compressedBlob) return;
    downloadFile(compressedBlob, `${t('downloadFilename')}.${extForMime(outputMime)}`);
  };

  const savings =
    originalBytes > 0 && compressedBytes > 0
      ? Math.round((1 - compressedBytes / originalBytes) * 1000) / 10
      : null;

  const toolbar = (
    <div className="flex shrink-0 items-center justify-end gap-2">
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
        accept="image/jpeg,image/png,image/webp,image/gif,image/avif,image/bmp"
        className="hidden"
        onChange={(e) => {
          const file = e.target.files?.[0];
          if (file) loadFile(file);
          e.target.value = '';
        }}
      />
      <Button variant="outline" size="sm" className="gap-1.5 text-xs" onClick={handleClear}>
        <Trash2 className="h-3.5 w-3.5" />
        {t('clear')}
      </Button>
    </div>
  );

  return (
    <ToolShell
      icon={IconArrowsDiagonalMinimize2}
      title={t('title')}
      description={t('subtitle')}
      toolbar={toolbar}
    >
      <div className="shrink-0 rounded-lg border border-border bg-card p-4">
        <div className="grid gap-4 sm:grid-cols-2">
          <div className="space-y-2">
            <Label className="text-xs font-medium text-muted-foreground">{t('outputFormat')}</Label>
            <Select
              value={outputMime}
              onValueChange={(v) => setOutputMime(v as OutputMime)}
              disabled={!sourceFile}
            >
              <SelectTrigger className="h-9">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="image/jpeg">{t('format.jpeg')}</SelectItem>
                <SelectItem value="image/png">{t('format.png')}</SelectItem>
                <SelectItem value="image/webp">{t('format.webp')}</SelectItem>
              </SelectContent>
            </Select>
          </div>
          <div className="space-y-3">
            <div className="flex items-center justify-between gap-2">
              <Label className="text-xs font-medium text-muted-foreground">{t('quality')}</Label>
              <span className="text-xs tabular-nums text-muted-foreground">
                {outputMime === 'image/png' ? '—' : t('qualityPercent', { value: qualityPercent })}
              </span>
            </div>
            <Slider
              value={[qualityPercent]}
              min={5}
              max={100}
              step={1}
              disabled={outputMime === 'image/png'}
              onValueChange={(v) => setQualityPercent(v[0] ?? 82)}
              className={cn(outputMime === 'image/png' && 'opacity-50')}
            />
            <p className="text-[11px] leading-snug text-muted-foreground">{t('qualityPngHint')}</p>
          </div>
        </div>
        {sourceFile && (
          <div className="mt-3 flex flex-wrap gap-x-4 gap-y-1 border-t border-border/50 pt-3 text-xs text-muted-foreground">
            <span>{t('sizes.original', { size: formatBytes(originalBytes) })}</span>
            {compressedBytes > 0 && (
              <span>{t('sizes.compressed', { size: formatBytes(compressedBytes) })}</span>
            )}
            {savings != null && compressedBytes > 0 && savings > 0 && (
              <span className="text-emerald-600 dark:text-emerald-400">
                {t('sizes.saved', { percent: String(savings) })}
              </span>
            )}
            {savings != null && compressedBytes > originalBytes && (
              <span className="text-amber-600 dark:text-amber-400">{t('largerWarning')}</span>
            )}
          </div>
        )}
      </div>

      {isMobile && (
        <div className="flex shrink-0 rounded-lg border bg-muted/40 p-1 gap-1">
          {(['original', 'compressed'] as const).map((tab) => (
            <button
              key={tab}
              type="button"
              onClick={() => setMobileTab(tab)}
              className={`flex-1 rounded-md px-3 py-2 text-sm font-medium capitalize transition-all ${
                mobileTab === tab
                  ? 'bg-background text-foreground shadow-sm'
                  : 'text-muted-foreground hover:text-foreground'
              }`}
            >
              {tab === 'original' ? t('panels.original') : t('panels.compressed')}
            </button>
          ))}
        </div>
      )}

      <ToolPanels>
        {(!isMobile || mobileTab === 'original') && (
          <IOPanel
            onDrop={handleDrop}
            onDragOver={(e) => {
              e.preventDefault();
              setIsDragging(true);
            }}
            onDragLeave={() => setIsDragging(false)}
            className={cn(
              'min-h-[220px] flex-1 transition-colors',
              isDragging && 'border-primary/50 bg-primary/5',
              !sourceUrl && 'border-dashed'
            )}
            label={
              <>
                <ImageIcon className="h-3.5 w-3.5" aria-hidden />
                {t('panels.original')}
              </>
            }
            actions={
              sourceUrl ? (
                <Button variant="ghost" size="icon" className="h-6 w-6" onClick={handleClear}>
                  <Trash2 className="h-3.5 w-3.5" />
                </Button>
              ) : null
            }
            bodyClassName="flex flex-col"
          >
            <div
              className="relative flex flex-1 cursor-pointer items-center justify-center p-4"
              onClick={() => !sourceUrl && fileInputRef.current?.click()}
            >
              {sourceUrl ? (
                // eslint-disable-next-line @next/next/no-img-element
                <img src={sourceUrl} alt="" decoding="async" className="max-h-[min(55vh,420px)] max-w-full object-contain" />
              ) : (
                <div className="flex flex-col items-center gap-3 text-center">
                  <div className="rounded-full bg-muted/50 p-4">
                    <Upload className="h-8 w-8 text-muted-foreground" />
                  </div>
                  <div className="flex flex-col gap-1">
                    <p className="text-sm font-medium">{t('dropHere')}</p>
                    <p className="text-xs text-muted-foreground">{t('placeholders.uploadImage')}</p>
                  </div>
                </div>
              )}
              {isDragging && (
                <div className="absolute inset-0 z-10 flex items-center justify-center bg-background/80 backdrop-blur-sm">
                  <div className="flex flex-col items-center gap-2 text-primary">
                    <Upload className="h-8 w-8 animate-bounce" />
                    <span className="text-sm font-medium">{t('dropHere')}</span>
                  </div>
                </div>
              )}
            </div>
            {error && (
              <div className="flex items-center gap-2 border-t border-destructive/20 bg-destructive/5 px-4 py-2 text-xs text-destructive">
                <AlertCircle className="h-3.5 w-3.5 shrink-0" />
                <span>{error}</span>
              </div>
            )}
          </IOPanel>
        )}

        {(!isMobile || mobileTab === 'compressed') && (
          <IOPanel
            className="min-h-[220px] flex-1"
            label={t('panels.compressed')}
            actions={
              <Button
                variant="outline"
                size="sm"
                className="h-7 gap-1 text-xs"
                disabled={!compressedBlob || processing}
                onClick={handleDownload}
              >
                {processing ? <Loader2 className="h-3 w-3 animate-spin" /> : <Download className="h-3 w-3" />}
                {t('download')}
              </Button>
            }
            bodyClassName="flex items-center justify-center p-4"
          >
            {processing && !compressedUrl && (
              <div className="absolute inset-0 z-10 flex flex-col items-center justify-center gap-2 bg-background/70">
                <Loader2 className="h-8 w-8 animate-spin text-primary" />
                <span className="text-xs text-muted-foreground">{t('processing')}</span>
              </div>
            )}
            {compressedUrl ? (
              // eslint-disable-next-line @next/next/no-img-element
              <img src={compressedUrl} alt="" decoding="async" className="max-h-[min(55vh,420px)] max-w-full object-contain" />
            ) : !sourceUrl ? (
              <p className="text-center text-sm text-muted-foreground">{t('emptyCompressed')}</p>
            ) : null}
          </IOPanel>
        )}
      </ToolPanels>
    </ToolShell>
  );
}
