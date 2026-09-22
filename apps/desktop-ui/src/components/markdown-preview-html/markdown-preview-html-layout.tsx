'use client';

import { useState, useMemo, useCallback } from 'react';
import { useCopyToClipboard } from '@/hooks/use-copy-to-clipboard';
import { useTranslations } from 'next-intl';
import { marked } from 'marked';
import TurndownService from 'turndown';
import { toast } from 'sonner';
import { safeFileName } from '@/lib/markdown-preview-html';
import { Input } from '@/components/ui/input';
import { Button } from '@/components/ui/button';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { Copy, Check, Download, Eye, Code } from 'lucide-react';
import { IconMarkdown } from '@tabler/icons-react';
import { ToolShell } from '@/components/tools/tool-shell';
import { IOPanel, ToolTextArea } from '@/components/tools/io-panel';
import { downloadFile } from '@/lib/desktop/save-file';

// Configure marked for safe, synchronous rendering
marked.setOptions({ async: false });

const turndown = new TurndownService({
  headingStyle: 'atx',
  codeBlockStyle: 'fenced',
  bulletListMarker: '-',
});

function renderMarkdown(md: string): string {
  try {
    return String(marked.parse(md, { async: false }));
  } catch {
    return '';
  }
}

function htmlToMarkdown(html: string): string {
  try {
    return turndown.turndown(html);
  } catch {
    return '';
  }
}

function buildFullHtml(bodyHtml: string): string {
  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1.0" />
  <title>Exported Markdown</title>
  <style>
    body { font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif; max-width: 800px; margin: 40px auto; padding: 0 24px; color: #1a1a1a; line-height: 1.6; }
    h1,h2,h3,h4,h5,h6 { margin-top: 1.5em; margin-bottom: 0.5em; font-weight: 600; }
    h1 { font-size: 2em; border-bottom: 1px solid #e5e7eb; padding-bottom: 0.3em; }
    h2 { font-size: 1.5em; border-bottom: 1px solid #e5e7eb; padding-bottom: 0.25em; }
    a { color: #2563eb; text-decoration: underline; }
    code { background: #f3f4f6; padding: 0.2em 0.4em; border-radius: 4px; font-family: 'SFMono-Regular', Consolas, monospace; font-size: 0.875em; }
    pre { background: #f3f4f6; padding: 1em; border-radius: 6px; overflow-x: auto; }
    pre code { background: none; padding: 0; }
    blockquote { border-left: 4px solid #d1d5db; margin: 0; padding-left: 1em; color: #6b7280; }
    img { max-width: 100%; }
    table { border-collapse: collapse; width: 100%; }
    th,td { border: 1px solid #d1d5db; padding: 0.5em 0.75em; }
    th { background: #f9fafb; font-weight: 600; }
    hr { border: none; border-top: 1px solid #e5e7eb; }
  </style>
</head>
<body>
${bodyHtml}
</body>
</html>`;
}

const footerNote = (text: string) => (
  <p className="shrink-0 border-t border-border/50 px-3 py-1.5 text-[11px] text-muted-foreground">
    {text}
  </p>
);

export function MarkdownPreviewLayout() {
  const t = useTranslations('MarkdownPreview');

  // Markdown → HTML tab
  const [markdown, setMarkdown] = useState('');
  const [outputTab, setOutputTab] = useState<'preview' | 'html'>('preview');
  const [fileName, setFileName] = useState('export');
  const { isCopied: copiedHtml, copyToClipboard: copyHtml } = useCopyToClipboard();

  // HTML → Markdown tab
  const [htmlInput, setHtmlInput] = useState('');
  const { isCopied: copiedMd, copyToClipboard: copyMd } = useCopyToClipboard();

  const renderedHtml = useMemo(() => renderMarkdown(markdown), [markdown]);
  const convertedMarkdown = useMemo(() => (htmlInput ? htmlToMarkdown(htmlInput) : ''), [htmlInput]);

  const handleCopyHtml = useCallback(() => {
    if (!renderedHtml) return;
    void copyHtml(renderedHtml, { silent: true });
  }, [renderedHtml, copyHtml]);

  const handleExportHtml = useCallback(() => {
    if (!renderedHtml) return;
    const name = `${safeFileName(fileName)}.html`;
    const blob = new Blob([buildFullHtml(renderedHtml)], { type: 'text/html' });
    downloadFile(blob, name);
    toast.success(t('exportSuccess', { name }));
  }, [renderedHtml, fileName, t]);

  const handleCopyMd = useCallback(() => {
    if (!convertedMarkdown) return;
    void copyMd(convertedMarkdown, { silent: true });
  }, [convertedMarkdown, copyMd]);

  return (
    <ToolShell icon={IconMarkdown} title={t('title')} description={t('subtitle')}>
      <Tabs defaultValue="md-to-html" className="flex h-full min-h-0 flex-col gap-4">
        <TabsList className="w-fit shrink-0">
          <TabsTrigger value="md-to-html">{t('tabMarkdownToHtml')}</TabsTrigger>
          <TabsTrigger value="html-to-md">{t('tabHtmlToMd')}</TabsTrigger>
        </TabsList>

        {/* ── Markdown → HTML ── */}
        <TabsContent value="md-to-html" className="m-0 min-h-0 flex-1 data-[state=inactive]:hidden">
          <div className="grid h-full min-h-0 grid-cols-1 gap-4 lg:grid-cols-2">
            {/* Input */}
            <IOPanel
              label={t('inputLabel')}
              actions={
                <span className="text-[10px] tabular-nums text-muted-foreground">
                  {t('charCount', { count: markdown.length })}
                </span>
              }
            >
              <ToolTextArea
                value={markdown}
                onChange={(e) => setMarkdown(e.target.value)}
                placeholder={t('inputPlaceholder')}
              />
            </IOPanel>

            {/* Output */}
            <IOPanel
              bodyClassName="flex flex-col"
              label={
                <Tabs value={outputTab} onValueChange={(v) => setOutputTab(v as 'preview' | 'html')}>
                  <TabsList className="h-7">
                    <TabsTrigger value="preview" className="h-6 gap-1 px-2 text-xs">
                      <Eye className="h-3 w-3" />
                      {t('previewLabel')}
                    </TabsTrigger>
                    <TabsTrigger value="html" className="h-6 gap-1 px-2 text-xs">
                      <Code className="h-3 w-3" />
                      {t('htmlOutputLabel')}
                    </TabsTrigger>
                  </TabsList>
                </Tabs>
              }
              actions={
                <>
                  <div className="flex items-center rounded-md border bg-background pr-2 focus-within:ring-1 focus-within:ring-ring">
                    <Input
                      value={fileName}
                      onChange={(e) => setFileName(e.target.value)}
                      aria-label={t('fileNameLabel')}
                      placeholder={t('fileNamePlaceholder')}
                      className="h-8 w-24 border-0 bg-transparent px-2 text-xs shadow-none focus-visible:ring-0"
                    />
                    <span className="text-xs text-muted-foreground">.html</span>
                  </div>
                  <Button size="sm" className="h-8" variant="secondary" disabled={!renderedHtml} onClick={handleCopyHtml}>
                    {copiedHtml ? <Check className="mr-1.5 h-4 w-4 text-emerald-600" /> : <Copy className="mr-1.5 h-4 w-4" />}
                    {copiedHtml ? t('copied') : t('copyHtml')}
                  </Button>
                  <Button size="sm" className="h-8" variant="secondary" disabled={!renderedHtml} onClick={handleExportHtml}>
                    <Download className="mr-1.5 h-4 w-4" />
                    {t('exportHtml')}
                  </Button>
                </>
              }
            >
              <div className="min-h-0 flex-1 overflow-hidden">
                {outputTab === 'preview' ? (
                  renderedHtml ? (
                    <iframe
                      className="h-full w-full"
                      sandbox="allow-same-origin"
                      srcDoc={buildFullHtml(renderedHtml)}
                      title="Markdown preview"
                    />
                  ) : (
                    <p className="p-4 text-sm text-muted-foreground">{t('emptyHint')}</p>
                  )
                ) : renderedHtml ? (
                  <pre className="h-full overflow-auto whitespace-pre-wrap break-all bg-muted/20 p-4 font-mono text-xs">
                    {renderedHtml}
                  </pre>
                ) : (
                  <p className="p-4 text-sm text-muted-foreground">{t('emptyHint')}</p>
                )}
              </div>
              {footerNote(t('securityNote'))}
            </IOPanel>
          </div>
        </TabsContent>

        {/* ── HTML → Markdown ── */}
        <TabsContent value="html-to-md" className="m-0 min-h-0 flex-1 data-[state=inactive]:hidden">
          <div className="grid h-full min-h-0 grid-cols-1 gap-4 lg:grid-cols-2">
            {/* HTML Input */}
            <IOPanel
              label={t('htmlInputLabel')}
              actions={
                <span className="text-[10px] tabular-nums text-muted-foreground">
                  {t('charCount', { count: htmlInput.length })}
                </span>
              }
            >
              <ToolTextArea
                value={htmlInput}
                onChange={(e) => setHtmlInput(e.target.value)}
                placeholder={t('htmlInputPlaceholder')}
              />
            </IOPanel>

            {/* Markdown Output */}
            <IOPanel
              bodyClassName="flex flex-col"
              label={t('mdOutputLabel')}
              actions={
                <Button size="sm" className="h-8" variant="secondary" disabled={!convertedMarkdown} onClick={handleCopyMd}>
                  {copiedMd ? <Check className="mr-1.5 h-4 w-4 text-emerald-600" /> : <Copy className="mr-1.5 h-4 w-4" />}
                  {copiedMd ? t('copied') : t('copyMarkdown')}
                </Button>
              }
            >
              <div className="min-h-0 flex-1 overflow-auto">
                {convertedMarkdown ? (
                  <pre className="h-full overflow-auto whitespace-pre-wrap break-words bg-muted/20 p-4 font-mono text-sm">
                    {convertedMarkdown}
                  </pre>
                ) : (
                  <p className="p-4 text-sm text-muted-foreground">{t('emptyHintHtmlToMd')}</p>
                )}
              </div>
              {footerNote(t('securityNote'))}
            </IOPanel>
          </div>
        </TabsContent>
      </Tabs>
    </ToolShell>
  );
}
