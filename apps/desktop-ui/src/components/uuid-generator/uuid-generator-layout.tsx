'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import { useCopyToClipboard } from '@/hooks/use-copy-to-clipboard';
import { IdRow } from './id-row';
import { errorKeyFromGenerateIdsErrorKey } from './error-mapping';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { Download, RefreshCw, Minus, Plus, Braces, Check } from 'lucide-react';
import { cn } from '@/lib/utils';
import {
  generateIds,
  MAX_BULK,
  type IdKind,
  type NamespacePreset,
} from '@/lib/generate-ids';
import { Toggle } from '@/components/ui/toggle';
import { formatUuid, idsAsJsonArray } from '@/lib/format-ids';
import { decodeIdTimestamp, idHasTimestamp } from '@/lib/id-timestamp';
import { useTranslations } from 'next-intl';
import { useAutoCopyStore } from '@/store/auto-copy-store';
import { IconFingerprint } from '@tabler/icons-react';
import { ToolShell } from '@/components/tools/tool-shell';
import { IOPanel } from '@/components/tools/io-panel';
import { CopyIconButton } from '@/components/tools/copy-icon-button';
import { ToolErrorBanner } from '@/components/tools/tool-error-banner';
import { downloadFile } from '@/lib/desktop/save-file';

const KIND_OPTIONS: { value: IdKind; label: string }[] = [
  { value: 'ulid', label: 'ULID' },
  { value: 'uuid4', label: 'UUID v4' },
  { value: 'uuid7', label: 'UUID v7' },
  { value: 'uuid1', label: 'UUID v1' },
  { value: 'uuid6', label: 'UUID v6' },
  { value: 'uuid3', label: 'UUID v3' },
  { value: 'uuid5', label: 'UUID v5' },
  { value: 'nil', label: 'Nil UUID' },
];

const QUICK_COUNTS = [1, 5, 10, 25, 50];

export function UuidGeneratorLayout() {
  const t = useTranslations('UuidGenerator');

  const [kind, setKind] = useState<IdKind>('uuid4');
  const [count, setCount] = useState(10);
  const [name, setName] = useState('mydevtools');
  const [namespacePreset, setNamespacePreset] = useState<NamespacePreset>('DNS');
  const [customNamespace, setCustomNamespace] = useState('');
  const [outputLines, setOutputLines] = useState<string[]>([]);
  const [error, setError] = useState('');
  const { isCopied: copied, copyToClipboard: copyAllFn, reset: resetCopied } = useCopyToClipboard();
  const [uppercase, setUppercase] = useState(false);
  const [hyphens, setHyphens] = useState(true);
  const { isCopied: copiedJson, copyToClipboard: copyJsonFn } = useCopyToClipboard();
  const autoCopy = useAutoCopyStore((state) => state.autoCopy);

  const needsName = kind === 'uuid3' || kind === 'uuid5';
  const kindMeta = useMemo(() => KIND_OPTIONS.find((o) => o.value === kind), [kind]);

  const runGenerate = useCallback(() => {
    setError('');
    resetCopied();
    try {
      const n = Number(count);
      const result = generateIds({
        kind,
        count: Number.isFinite(n) ? n : 1,
        name,
        namespacePreset,
        customNamespace,
      });
      if (!result.ok) {
        setOutputLines([]);
        setError(t(errorKeyFromGenerateIdsErrorKey(result.errorKey)));
        return;
      }
      setOutputLines(result.lines);
    } catch {
      setOutputLines([]);
      setError(t('errors.unknown'));
    }
  }, [kind, count, name, namespacePreset, customNamespace, t, resetCopied]);

  const displayLines = useMemo(
    () => outputLines.map((id) => formatUuid(id, { uppercase, hyphens })),
    [outputLines, uppercase, hyphens]
  );
  const timestamps = useMemo(
    () => (idHasTimestamp(kind) ? outputLines.map((id) => decodeIdTimestamp(id, kind)) : []),
    [outputLines, kind]
  );
  const output = displayLines.join('\n');

  const handleCopyAll = useCallback(() => {
    if (!output) return;
    void copyAllFn(output, { silent: true });
  }, [output, copyAllFn]);

  const handleCopyJson = useCallback(() => {
    if (displayLines.length === 0) return;
    void copyJsonFn(idsAsJsonArray(displayLines), { silent: true });
  }, [displayLines, copyJsonFn]);

  useEffect(() => {
    if (autoCopy && output) {
      void handleCopyAll();
    }
  }, [output, autoCopy, handleCopyAll]);

  const handleDownload = () => {
    if (!output) return;
    const blob = new Blob([output], { type: 'text/plain' });
    downloadFile(blob, t('download.filename', { kind }));
  };

  return (
    <ToolShell
      icon={IconFingerprint}
      title={t('title')}
      description={t('subtitle', { max: MAX_BULK.toLocaleString() })}
    >
      <div className="grid flex-1 min-h-0 grid-cols-1 gap-4 overflow-y-auto lg:grid-cols-2 lg:grid-rows-[minmax(0,1fr)] lg:overflow-hidden">
        {/* Config panel */}
        <div className="flex flex-col gap-4 rounded-lg border border-border bg-card p-4 lg:overflow-y-auto">
          {/* Format: chip row on small screens, Select on md+ — same `kind` state */}
          <div className="space-y-2">
            <Label htmlFor="id-kind" className="text-xs font-medium text-muted-foreground uppercase tracking-wider">
              {t('format')}
            </Label>
            <div className="flex gap-2 overflow-x-auto pb-1 -mx-1 px-1 scrollbar-none md:hidden">
              {KIND_OPTIONS.map((opt) => (
                <button
                  key={opt.value}
                  type="button"
                  onClick={() => setKind(opt.value)}
                  className={cn(
                    'shrink-0 h-8 rounded-full px-4 text-xs font-medium transition-all border',
                    kind === opt.value
                      ? 'bg-foreground text-background border-foreground'
                      : 'bg-muted/50 text-muted-foreground border-transparent hover:border-border'
                  )}
                >
                  {opt.label}
                </button>
              ))}
            </div>
            <Select value={kind} onValueChange={(v) => setKind(v as IdKind)}>
              <SelectTrigger id="id-kind" className="hidden font-mono text-sm md:flex">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {KIND_OPTIONS.map((opt) => (
                  <SelectItem key={opt.value} value={opt.value} className="font-mono text-sm">
                    {opt.label}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            {kindMeta && (
              <p className="text-[11px] text-muted-foreground leading-snug">
                {t(`kindHints.${kindMeta.value}`)}
              </p>
            )}
          </div>

          {/* Count: stepper + typed input + quick pills, all breakpoints */}
          <div className="space-y-2">
            <Label htmlFor="id-count" className="text-xs font-medium text-muted-foreground uppercase tracking-wider">
              {t('countLabel', { max: MAX_BULK.toLocaleString() })}
            </Label>
            <div className="flex items-center gap-2">
              <Button
                type="button"
                variant="outline"
                size="icon"
                className="h-9 w-9 shrink-0"
                aria-label="Decrease count"
                onClick={() => setCount((c) => Math.max(1, c - 1))}
              >
                <Minus className="h-4 w-4" aria-hidden />
              </Button>
              <Input
                id="id-count"
                type="number"
                min={1}
                max={MAX_BULK}
                value={count}
                onChange={(e) => setCount(Number(e.target.value))}
                className="font-mono text-sm text-center tabular-nums"
              />
              <Button
                type="button"
                variant="outline"
                size="icon"
                className="h-9 w-9 shrink-0"
                aria-label="Increase count"
                onClick={() => setCount((c) => Math.min(MAX_BULK, c + 1))}
              >
                <Plus className="h-4 w-4" aria-hidden />
              </Button>
            </div>
            <div className="flex flex-wrap gap-2">
              {QUICK_COUNTS.map((n) => (
                <button
                  key={n}
                  type="button"
                  onClick={() => setCount(n)}
                  className={cn(
                    'h-7 rounded-full px-3 text-xs font-medium border transition-all',
                    count === n
                      ? 'bg-foreground text-background border-foreground'
                      : 'bg-muted/50 text-muted-foreground border-transparent hover:border-border'
                  )}
                >
                  {n}
                </button>
              ))}
            </div>
          </div>

          {/* v3/v5 name + namespace fields */}
          {needsName && (
            <>
              <div className="space-y-2">
                <Label htmlFor="id-name" className="text-xs font-medium text-muted-foreground uppercase tracking-wider">
                  {t('nameLabel')}
                </Label>
                <Input
                  id="id-name"
                  value={name}
                  onChange={(e) => setName(e.target.value)}
                  placeholder={t('namePlaceholder')}
                  className="font-mono text-sm"
                />
                <p className="text-[11px] text-muted-foreground">
                  {t.rich('bulkHint', {
                    code: (chunks) => <code className="text-foreground">{chunks}</code>,
                  })}
                </p>
              </div>

              <div className="space-y-2">
                <Label className="text-xs font-medium text-muted-foreground uppercase tracking-wider">
                  {t('namespace')}
                </Label>
                <Select value={namespacePreset} onValueChange={(v) => setNamespacePreset(v as NamespacePreset)}>
                  <SelectTrigger className="font-mono text-sm">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="DNS">{t('namespaceOptions.dns')}</SelectItem>
                    <SelectItem value="URL">{t('namespaceOptions.url')}</SelectItem>
                    <SelectItem value="custom">{t('namespaceOptions.custom')}</SelectItem>
                  </SelectContent>
                </Select>
              </div>

              {namespacePreset === 'custom' && (
                <div className="space-y-2">
                  <Label htmlFor="id-ns-custom" className="text-xs font-medium text-muted-foreground uppercase tracking-wider">
                    {t('customNamespaceLabel')}
                  </Label>
                  <Input
                    id="id-ns-custom"
                    value={customNamespace}
                    onChange={(e) => setCustomNamespace(e.target.value)}
                    placeholder={t('customNamespacePlaceholder')}
                    className="font-mono text-sm"
                  />
                </div>
              )}
            </>
          )}

          <div className="sticky bottom-0 z-10 -mx-4 -mb-4 mt-auto flex flex-wrap gap-2 border-t border-border/50 bg-card px-4 py-3 lg:static lg:z-auto lg:m-0 lg:mt-0 lg:border-0 lg:bg-transparent lg:p-0 lg:pt-1">
            <Button
              type="button"
              onClick={runGenerate}
              className="gap-1.5 w-full sm:w-auto"
            >
              <RefreshCw className="h-3.5 w-3.5" />
              {t('generate')}
            </Button>
          </div>
        </div>

        {/* Output panel */}
        <IOPanel
          className="min-h-[280px]"
          bodyClassName="overflow-y-auto"
          label={t('output')}
          actions={
            <>
              <span className="text-[10px] text-muted-foreground tabular-nums mr-1">
                {t('lines', { count: outputLines.length > 0 ? outputLines.length.toLocaleString() : '0' })}
              </span>
              <Toggle
                size="sm"
                pressed={uppercase}
                onPressedChange={setUppercase}
                aria-label={t('uppercaseToggle')}
                title={t('uppercaseToggle')}
                className="h-7 px-2 font-mono text-[11px]"
              >
                AA
              </Toggle>
              <Toggle
                size="sm"
                pressed={hyphens}
                onPressedChange={setHyphens}
                aria-label={t('hyphensToggle')}
                title={t('hyphensToggle')}
                className="h-7 px-2 font-mono text-[11px]"
                disabled={kind === 'ulid'}
              >
                -
              </Toggle>
              <Button
                type="button"
                variant="ghost"
                size="icon"
                className="h-7 w-7"
                onClick={handleDownload}
                disabled={!output}
                title={t('download.title')}
                aria-label={t('download.title')}
              >
                <Download className="h-3.5 w-3.5" />
              </Button>
              <CopyIconButton
                onCopy={handleCopyAll}
                copied={copied}
                disabled={!output}
                label={t('copyTitle')}
              />
              <Button
                type="button"
                variant="ghost"
                size="icon"
                className="h-7 w-7"
                onClick={handleCopyJson}
                disabled={displayLines.length === 0}
                title={t('copyJsonTitle')}
                aria-label={t('copyJsonTitle')}
              >
                {copiedJson ? <Check className="h-3.5 w-3.5 text-green-500" /> : <Braces className="h-3.5 w-3.5" />}
              </Button>
            </>
          }
        >
          {error ? (
            <ToolErrorBanner message={error} className="m-4" />
          ) : displayLines.length > 0 ? (
            <div>
              {displayLines.map((id, i) => (
                <IdRow key={i} id={id} index={i} timestamp={timestamps[i]} />
              ))}
            </div>
          ) : (
            <div className="flex h-full flex-col items-center justify-center gap-3 p-8 text-center">
              <IconFingerprint className="h-8 w-8 text-muted-foreground/30" aria-hidden />
              <p className="font-mono text-sm text-muted-foreground/50">
                {t('outputPlaceholder')}
              </p>
            </div>
          )}
        </IOPanel>
      </div>
    </ToolShell>
  );
}
