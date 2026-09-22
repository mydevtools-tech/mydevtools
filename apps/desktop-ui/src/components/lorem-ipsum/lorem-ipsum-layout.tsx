'use client';

import { useCallback, useState } from 'react';
import { useCopyToClipboard } from '@/hooks/use-copy-to-clipboard';
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
import { Switch } from '@/components/ui/switch';
import { Download, RefreshCw } from 'lucide-react';
import { IconQuote } from '@tabler/icons-react';
import { ToolShell } from '@/components/tools/tool-shell';
import { IOPanel, ToolTextArea } from '@/components/tools/io-panel';
import { CopyIconButton } from '@/components/tools/copy-icon-button';
import {
  generateLorem,
  LOREM_LIMITS,
  type LoremUnit,
} from '@/lib/lorem-ipsum';
import { useTranslations } from 'next-intl';
import { downloadFile } from '@/lib/desktop/save-file';

const UNIT_VALUES: LoremUnit[] = ['paragraphs', 'sentences', 'words', 'list'];

type LoremUnitKey = 'paragraphs' | 'sentences' | 'words' | 'bulletList';
const UNIT_KEY_MAP: Record<LoremUnit, LoremUnitKey> = {
  paragraphs: 'paragraphs',
  sentences: 'sentences',
  words: 'words',
  list: 'bulletList',
};

export function LoremIpsumLayout() {
  const t = useTranslations('LoremIpsum');
  const [unit, setUnit] = useState<LoremUnit>('paragraphs');
  const [count, setCount] = useState(3);
  const [asHtml, setAsHtml] = useState(false);
  const [output, setOutput] = useState('');
  const { isCopied: copied, copyToClipboard, reset: resetCopied } = useCopyToClipboard();

  const limits = LOREM_LIMITS[unit];

  const runGenerate = useCallback(() => {
    resetCopied();
    const n = Number(count);
    setOutput(
      generateLorem({
        unit,
        count: Number.isFinite(n) ? n : limits.min,
        asHtml,
      })
    );
  }, [unit, count, asHtml, limits.min, resetCopied]);

  const handleCopy = () => {
    if (!output) return;
    void copyToClipboard(output, { silent: true });
  };

  const handleDownload = () => {
    if (!output) return;
    const blob = new Blob([output], { type: asHtml ? 'text/html' : 'text/plain' });
    downloadFile(blob, asHtml ? 'lorem-ipsum.html' : 'lorem-ipsum.txt');
  };

  return (
    <ToolShell
      icon={IconQuote}
      title={t('title')}
      description={t('subtitle')}
    >
      <div className="flex-1 grid grid-cols-1 lg:grid-cols-2 gap-4 min-h-0">
        <div className="flex flex-col gap-4 overflow-auto rounded-lg border border-border bg-card p-4">
          <div className="space-y-2">
            <Label
              htmlFor="lorem-unit"
              className="text-xs font-medium text-muted-foreground uppercase tracking-wider"
            >
              {t('outputType')}
            </Label>
            <Select value={unit} onValueChange={(v) => setUnit(v as LoremUnit)}>
              <SelectTrigger id="lorem-unit" className="text-sm">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {UNIT_VALUES.map((value) => (
                  <SelectItem key={value} value={value} className="text-sm">
                    {t(UNIT_KEY_MAP[value])}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          <div className="space-y-2">
            <Label
              htmlFor="lorem-count"
              className="text-xs font-medium text-muted-foreground uppercase tracking-wider"
            >
              {t('count')} ({limits.min}–{limits.max.toLocaleString()})
            </Label>
            <Input
              id="lorem-count"
              type="number"
              min={limits.min}
              max={limits.max}
              value={count}
              onChange={(e) => setCount(Number(e.target.value))}
              className="font-mono text-sm"
            />
          </div>

          <div className="flex items-center justify-between gap-3 rounded-lg border border-border/50 bg-muted/20 px-3 py-2.5">
            <div className="space-y-0.5">
              <Label htmlFor="lorem-html" className="text-sm font-medium cursor-pointer">
                {t('htmlMarkup')}
              </Label>
              <p className="text-[11px] text-muted-foreground">
                {t('htmlMarkupHint')}
              </p>
            </div>
            <Switch id="lorem-html" checked={asHtml} onCheckedChange={setAsHtml} />
          </div>

          <Button type="button" onClick={runGenerate} className="gap-1.5 w-full sm:w-fit">
            <RefreshCw className="h-3.5 w-3.5" />
            {t('generate')}
          </Button>
        </div>

        <IOPanel
          className="min-h-[280px]"
          label={t('output')}
          actions={
            <>
              <span className="text-[10px] text-muted-foreground tabular-nums mr-1">
                {output ? `${output.length.toLocaleString()} chars` : '—'}
              </span>
              <Button
                type="button"
                variant="ghost"
                size="icon"
                className="h-7 w-7"
                onClick={handleDownload}
                disabled={!output}
                title={t('download')}
              >
                <Download className="h-3.5 w-3.5" />
              </Button>
              <CopyIconButton
                onCopy={handleCopy}
                copied={copied}
                disabled={!output}
                label={t('copy')}
                className="h-7 w-7"
              />
            </>
          }
        >
          <ToolTextArea
            value={output}
            readOnly
            placeholder={t('outputPlaceholder')}
            className="p-4 font-sans"
          />
        </IOPanel>
      </div>
    </ToolShell>
  );
}
