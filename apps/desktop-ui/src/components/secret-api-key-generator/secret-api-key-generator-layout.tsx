'use client';

import Link from 'next/link';
import { useCallback, useMemo, useState } from 'react';
import { useCopyToClipboard } from '@/hooks/use-copy-to-clipboard';
import { useTranslations } from 'next-intl';
import { Download, RefreshCw } from 'lucide-react';
import { IconCircleKeyFilled } from '@tabler/icons-react';
import { CopyIconButton } from '@/components/tools/copy-icon-button';
import { ToolErrorBanner } from '@/components/tools/tool-error-banner';
import { ToolShell } from '@/components/tools/tool-shell';
import { IOPanel, ToolTextArea } from '@/components/tools/io-panel';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { Switch } from '@/components/ui/switch';
import { cn } from '@/lib/utils';
import {
  AMBIGUOUS_CHARACTERS,
  applyKeyPrefix,
  dedupeAlphabet,
  generateSecretStrings,
  MAX_ALPHABET_UNIQUE,
  MAX_KEY_PREFIX_LENGTH,
  MAX_SECRET_BULK,
  MAX_SECRET_LENGTH,
  stripAmbiguous,
  type GenerateSecretStringsErrorKey,
} from '@/lib/generate-secret-strings';
import { entropyBits, strengthBucket, type SecretStrength } from '@/lib/secret-entropy';
import { downloadFile } from '@/lib/desktop/save-file';

const PRESET_BASE64URL =
  'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-_';
const PRESET_ALPHANUMERIC =
  'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789';
const PRESET_HEX = '0123456789abcdef';
const PRESET_ASCII_PRINTABLE = Array.from({ length: 94 }, (_, i) =>
  String.fromCharCode(33 + i)
).join('');

type PresetId = 'base64url' | 'alphanumeric' | 'hex' | 'asciiPrintable';

const PRESETS: { id: PresetId; value: string }[] = [
  { id: 'base64url', value: PRESET_BASE64URL },
  { id: 'alphanumeric', value: PRESET_ALPHANUMERIC },
  { id: 'hex', value: PRESET_HEX },
  { id: 'asciiPrintable', value: PRESET_ASCII_PRINTABLE },
];

const STRENGTH_CLASS: Record<SecretStrength, string> = {
  weak: 'text-destructive',
  fair: 'text-amber-600 dark:text-amber-500',
  strong: 'text-emerald-600 dark:text-emerald-400',
};

function formatGenerateError(
  t: ReturnType<typeof useTranslations<'SecretApiKeyGenerator'>>,
  key: GenerateSecretStringsErrorKey
): string {
  const maxAlpha = MAX_ALPHABET_UNIQUE.toLocaleString();
  const maxLen = MAX_SECRET_LENGTH.toLocaleString();
  const maxBulk = MAX_SECRET_BULK.toLocaleString();
  switch (key) {
    case 'emptyAlphabet':
      return t('errors.emptyAlphabet');
    case 'alphabetTooLong':
      return t('errors.alphabetTooLong', { maxAlpha });
    case 'lengthOutOfRange':
      return t('errors.lengthOutOfRange', { maxLen });
    case 'countOutOfRange':
      return t('errors.countOutOfRange', { maxBulk });
    default:
      return t('errors.unknown');
  }
}

export function SecretApiKeyGeneratorLayout() {
  const t = useTranslations('SecretApiKeyGenerator');
  const [alphabet, setAlphabet] = useState(PRESET_ALPHANUMERIC);
  const [length, setLength] = useState(32);
  const [count, setCount] = useState(5);
  const [output, setOutput] = useState('');
  const [error, setError] = useState('');
  const { isCopied: copied, copyToClipboard, reset: resetCopied } = useCopyToClipboard();
  const [excludeAmbiguous, setExcludeAmbiguous] = useState(false);
  const [prefix, setPrefix] = useState('');

  const dedupedPreview = useMemo(() => dedupeAlphabet(alphabet), [alphabet]);
  const effectiveAlphabet = useMemo(
    () => (excludeAmbiguous ? stripAmbiguous(dedupedPreview) : dedupedPreview),
    [dedupedPreview, excludeAmbiguous]
  );
  const entropy = useMemo(
    () => entropyBits(effectiveAlphabet.length, Number(length)),
    [effectiveAlphabet, length]
  );
  const strength = strengthBucket(entropy);

  const applyPreset = useCallback((value: string) => {
    setAlphabet(value);
  }, []);

  const runGenerate = useCallback(() => {
    setError('');
    resetCopied();
    try {
      const result = generateSecretStrings({
        alphabet: effectiveAlphabet,
        length: Number(length),
        count: Number(count),
      });
      if (!result.ok) {
        setOutput('');
        setError(formatGenerateError(t, result.errorKey));
        return;
      }
      setOutput(applyKeyPrefix(result.lines, prefix).join('\n'));
    } catch {
      setOutput('');
      setError(t('errors.unknown'));
    }
  }, [effectiveAlphabet, length, count, prefix, t, resetCopied]);

  const handleCopy = () => {
    if (!output) return;
    void copyToClipboard(output, { silent: true });
  };

  const handleDownload = () => {
    if (!output) return;
    const blob = new Blob([output], { type: 'text/plain' });
    downloadFile(blob, t('download.filename'));
  };

  return (
    <ToolShell
      icon={IconCircleKeyFilled}
      title={t('title')}
      description={t.rich('subtitle', {
        max: MAX_SECRET_BULK.toLocaleString(),
        uuid: (chunks) => (
          <Link
            href="/app/uuid-generator"
            className="font-medium text-primary underline underline-offset-2 hover:no-underline"
          >
            {chunks}
          </Link>
        ),
      })}
    >
      <div className="grid min-h-0 flex-1 grid-cols-1 gap-4 lg:grid-cols-2">
        <div className="flex flex-col gap-4 overflow-auto rounded-lg border border-border bg-card p-4">
          <div className="space-y-2">
            <Label className="text-xs font-medium uppercase tracking-wider text-muted-foreground">
              {t('presetsLabel')}
            </Label>
            <div className="flex flex-wrap gap-1.5">
              {PRESETS.map((p) => (
                <Button
                  key={p.id}
                  type="button"
                  variant="secondary"
                  size="sm"
                  className="h-7 text-xs"
                  onClick={() => applyPreset(p.value)}
                >
                  {t(`preset.${p.id}`)}
                </Button>
              ))}
            </div>
          </div>

          <div className="space-y-2">
            <div className="flex items-center justify-between gap-2">
              <Label
                htmlFor="secret-alphabet"
                className="text-xs font-medium uppercase tracking-wider text-muted-foreground"
              >
                {t('alphabetLabel')}
              </Label>
              <span className="text-[10px] tabular-nums text-muted-foreground">
                {t('alphabetCount', { count: effectiveAlphabet.length.toLocaleString() })}
              </span>
            </div>
            <Textarea
              id="secret-alphabet"
              value={alphabet}
              onChange={(e) => setAlphabet(e.target.value)}
              spellCheck={false}
              rows={4}
              className="min-h-[88px] resize-y font-mono text-sm"
            />
            <p className="text-[11px] leading-snug text-muted-foreground">{t('alphabetHint')}</p>
          </div>

          <div className="flex items-start justify-between gap-3">
            <div className="min-w-0 space-y-0.5">
              <Label
                htmlFor="secret-exclude-ambiguous"
                className="text-xs font-medium uppercase tracking-wider text-muted-foreground"
              >
                {t('excludeAmbiguous')}
              </Label>
              <p className="text-[11px] leading-snug text-muted-foreground">
                {t('excludeAmbiguousHint', { chars: Array.from(AMBIGUOUS_CHARACTERS).join(' ') })}
              </p>
            </div>
            <Switch
              id="secret-exclude-ambiguous"
              checked={excludeAmbiguous}
              onCheckedChange={setExcludeAmbiguous}
              className="mt-0.5"
            />
          </div>

          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
            <div className="space-y-2">
              <Label
                htmlFor="secret-length"
                className="text-xs font-medium uppercase tracking-wider text-muted-foreground"
              >
                {t('lengthLabel', { maxLen: MAX_SECRET_LENGTH.toLocaleString() })}
              </Label>
              <Input
                id="secret-length"
                type="number"
                min={1}
                max={MAX_SECRET_LENGTH}
                value={length}
                onChange={(e) => setLength(Number(e.target.value))}
                className="font-mono text-sm"
              />
            </div>
            <div className="space-y-2">
              <Label
                htmlFor="secret-count"
                className="text-xs font-medium uppercase tracking-wider text-muted-foreground"
              >
                {t('countLabel', { maxBulk: MAX_SECRET_BULK.toLocaleString() })}
              </Label>
              <Input
                id="secret-count"
                type="number"
                min={1}
                max={MAX_SECRET_BULK}
                value={count}
                onChange={(e) => setCount(Number(e.target.value))}
                className="font-mono text-sm"
              />
            </div>
            <div className="space-y-2 sm:col-span-2">
              <Label
                htmlFor="secret-prefix"
                className="text-xs font-medium uppercase tracking-wider text-muted-foreground"
              >
                {t('prefixLabel')}
              </Label>
              <Input
                id="secret-prefix"
                value={prefix}
                maxLength={MAX_KEY_PREFIX_LENGTH}
                onChange={(e) => setPrefix(e.target.value)}
                placeholder="sk_"
                spellCheck={false}
                autoCapitalize="off"
                className="font-mono text-sm"
              />
            </div>
          </div>

          <div className="flex items-center justify-between gap-2 rounded-md border border-border/50 bg-muted/30 px-3 py-2">
            <span className="text-xs tabular-nums text-muted-foreground">
              {t('entropy', { bits: Math.round(entropy) })}
            </span>
            <span className={cn('text-xs font-semibold', STRENGTH_CLASS[strength])}>
              {t(`strength.${strength}`)}
            </span>
          </div>

          <div className="flex flex-wrap gap-2 pt-1">
            <Button type="button" onClick={runGenerate} className="w-full gap-1.5 sm:w-auto">
              <RefreshCw className="h-3.5 w-3.5" />
              {t('generate')}
            </Button>
          </div>
        </div>

        <IOPanel
          className="min-h-[280px]"
          label={t('output')}
          actions={
            <>
              <span className="mr-1 text-[10px] tabular-nums text-muted-foreground">
                {t('lines', {
                  count: output ? output.split('\n').length.toLocaleString() : '0',
                })}
              </span>
              <Button
                type="button"
                variant="ghost"
                size="icon"
                className="h-7 w-7"
                onClick={handleDownload}
                disabled={!output}
                title={t('download.title')}
              >
                <Download className="h-3.5 w-3.5" />
              </Button>
              <CopyIconButton
                onCopy={handleCopy}
                copied={copied}
                disabled={!output}
                label={t('copyTitle')}
                className="h-7 w-7"
              />
            </>
          }
        >
          {error ? (
            <div className="p-4">
              <ToolErrorBanner message={error} />
            </div>
          ) : (
            <ToolTextArea
              value={output}
              readOnly
              placeholder={t('outputPlaceholder')}
              className="p-4"
            />
          )}
        </IOPanel>
      </div>
    </ToolShell>
  );
}
