'use client';

import { useCallback, useMemo, useState } from 'react';
import { useCopyToClipboard } from '@/hooks/use-copy-to-clipboard';
import { useIsMobile } from '@/components/hooks/use-mobile';
import { useTranslations } from 'next-intl';
import { AlertCircle, Check, Copy, Trash2 } from 'lucide-react';
import { IconBraces } from '@tabler/icons-react';
import { ToolShell } from '@/components/tools/tool-shell';
import { IOPanel } from '@/components/tools/io-panel';
import { ToolMobileTabs } from '@/components/tools/tool-mobile-tabs';
import { Button } from '@/components/ui/button';
import { Label } from '@/components/ui/label';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { ScrollArea } from '@/components/ui/scroll-area';
import { cn } from '@/lib/utils';
import { highlightSchemaOutput } from '@/lib/hljs-json-schema-output';
import {
  collectFormats,
  generateFromSchema,
  inferSchema,
  OUTPUT_LANGUAGE_ORDER,
  type OutputLanguage,
  type StringFormat,
} from '@/lib/json-schema-generator';
import { Badge } from '@/components/ui/badge';
import '@/components/tools/hljs-theme.css';
import { JsonSchemaInputEditor } from './json-schema-input-editor';

const defaultSample = `{
  "id": 42,
  "name": "demo",
  "tags": ["alpha", "beta"],
  "meta": {
    "version": 1,
    "flags": { "beta": true }
  },
  "scores": [9.5, 8.0]
}`;

export function JsonSchemaGeneratorLayout() {
  const t = useTranslations('JsonSchemaGenerator');
  const isMobile = useIsMobile();
  const [mobileTab, setMobileTab] = useState<'input' | 'output'>('input');
  const [input, setInput] = useState(defaultSample);
  const [language, setLanguage] = useState<OutputLanguage>('python');
  const { isCopied: copied, copyToClipboard } = useCopyToClipboard();

  const { output, error, formats } = useMemo(() => {
    const trimmed = input.trim();
    if (!trimmed) {
      return { output: '', error: null as string | null, formats: [] as [StringFormat, number][] };
    }
    try {
      const parsed: unknown = JSON.parse(trimmed);
      const schema = inferSchema(parsed);
      return {
        output: generateFromSchema(schema, language),
        error: null as string | null,
        formats: [...collectFormats(schema).entries()],
      };
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      return { output: '', error: msg, formats: [] as [StringFormat, number][] };
    }
  }, [input, language]);

  const highlightedOutput = useMemo(
    () => (error || !output ? '' : highlightSchemaOutput(output, language)),
    [output, language, error]
  );

  const handleCopy = useCallback(() => {
    if (!output) return;
    void copyToClipboard(output, {
      successMessage: t('copied'),
      errorMessage: t('copyFailed'),
    });
  }, [output, t, copyToClipboard]);

  const handleClear = () => {
    setInput('');
  };

  const toolbar = (
    <div className="flex flex-col gap-3 rounded-lg border border-border bg-card px-4 py-3 sm:flex-row sm:items-end sm:justify-between">
      <div className="flex flex-col gap-1.5 sm:min-w-[240px]">
        <Label htmlFor="json-schema-lang" className="text-xs text-muted-foreground">
          {t('languageLabel')}
        </Label>
        <Select value={language} onValueChange={(v) => setLanguage(v as OutputLanguage)}>
          <SelectTrigger id="json-schema-lang" className="w-full sm:w-[280px]">
            <SelectValue placeholder={t('languageLabel')} />
          </SelectTrigger>
          <SelectContent>
            {OUTPUT_LANGUAGE_ORDER.map((id) => (
              <SelectItem key={id} value={id}>
                {t(`languages.${id}` as never)}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>
      <div className="flex flex-wrap gap-2">
        <Button variant="outline" size="sm" onClick={handleClear}>
          <Trash2 className="mr-1.5 h-3.5 w-3.5" />
          {t('clear')}
        </Button>
        <Button size="sm" onClick={handleCopy} disabled={!output || !!error}>
          {copied ? (
            <Check className="mr-1.5 h-3.5 w-3.5 text-green-500" />
          ) : (
            <Copy className="mr-1.5 h-3.5 w-3.5" />
          )}
          {t('copy')}
        </Button>
      </div>
    </div>
  );

  return (
    <ToolShell
      icon={IconBraces}
      title={t('title')}
      description={t('subtitle')}
      toolbar={toolbar}
    >
      {isMobile && (
        <ToolMobileTabs
          value={mobileTab}
          onValueChange={setMobileTab}
          tabs={[
            { value: 'input', label: t('inputLabel') },
            { value: 'output', label: t('outputLabel') },
          ]}
        />
      )}

      <div
        className={cn(
          'min-h-0 flex-1',
          isMobile ? 'mt-4 flex flex-col' : 'grid grid-cols-2 gap-4',
        )}
      >
        {(!isMobile || mobileTab === 'input') && (
          <IOPanel label={t('inputLabel')} className="min-h-[300px]">
            <JsonSchemaInputEditor
              value={input}
              onChange={setInput}
              ariaLabel={`${t('inputLabel')}. ${t('inputPlaceholder')}`}
            />
          </IOPanel>
        )}

        {(!isMobile || mobileTab === 'output') && (
          <IOPanel
            label={t('outputLabel')}
            className={cn('min-h-[300px]', error && 'border-destructive/40')}
            actions={
              !error && formats.length > 0 ? (
                <div className="flex flex-wrap items-center gap-1">
                  <span className="text-[10px] uppercase tracking-wider text-muted-foreground">
                    {t('detectedFormats')}
                  </span>
                  {formats.map(([fmt, count]) => (
                    <Badge key={fmt} variant="secondary" className="font-mono text-[10px]">
                      {fmt}
                      {count > 1 ? ` ×${count}` : ''}
                    </Badge>
                  ))}
                </div>
              ) : undefined
            }
          >
            {error ? (
              <div className="absolute inset-0 flex flex-col items-center justify-center gap-2 p-4 text-center">
                <AlertCircle className="h-8 w-8 text-destructive" aria-hidden />
                <p className="text-sm text-destructive">{t('parseError')}</p>
                <p className="max-w-sm font-mono text-xs text-muted-foreground">{error}</p>
              </div>
            ) : (
              <ScrollArea className="absolute inset-0 h-full">
                <div className="hljs-theme min-h-full" role="region" aria-label={t('outputLabel')}>
                  {output ? (
                    <pre className="m-0 font-mono">
                      <code
                        className="hljs"
                        // highlight.js escapes the JSON it is handed.
                        // threatcrush-disable-next-line js-unescaped-html-sink
                        dangerouslySetInnerHTML={{ __html: highlightedOutput }}
                      />
                    </pre>
                  ) : (
                    <p className="p-4 text-sm text-muted-foreground">{t('outputPlaceholder')}</p>
                  )}
                </div>
              </ScrollArea>
            )}
          </IOPanel>
        )}
      </div>
    </ToolShell>
  );
}
