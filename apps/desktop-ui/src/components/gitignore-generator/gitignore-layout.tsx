'use client';

import * as React from 'react';
import { useTranslations } from 'next-intl';
import { useCopyToClipboard } from '@/hooks/use-copy-to-clipboard';
import { isDesktop } from '@/lib/desktop/is-desktop';
import { Label } from '@/components/ui/label';
import { Button } from '@/components/ui/button';
import { Check, Download, X, Search, Loader2 } from 'lucide-react';
import { Command, CommandEmpty, CommandGroup, CommandInput, CommandItem, CommandList } from '@/components/ui/command';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';
import { Badge } from '@/components/ui/badge';
import { ScrollArea } from '@/components/ui/scroll-area';
import { cn } from '@/lib/utils';
import { IconFileMinus } from '@tabler/icons-react';
import { CopyTextButton } from '@/components/tools/copy-text-button';
import { ToolErrorBanner } from '@/components/tools/tool-error-banner';
import { ToolShell } from '@/components/tools/tool-shell';
import { ToolPanels, IOPanel, ToolTextArea } from '@/components/tools/io-panel';
import { downloadFile } from '@/lib/desktop/save-file';

export function GitignoreLayout() {
  const t = useTranslations('GitignoreGenerator');

  const [open, setOpen] = React.useState(false);
  const [list, setList] = React.useState<string[]>([]);
  const [selected, setSelected] = React.useState<string[]>([]);
  
  const [output, setOutput] = React.useState<string>('');
  const { isCopied: copied, copyToClipboard } = useCopyToClipboard();
  
  const [loadingList, setLoadingList] = React.useState(true);
  const [loadingOutput, setLoadingOutput] = React.useState(false);
  const [errorMsg, setErrorMsg] = React.useState<string | null>(null);

  // Fetch complete tag list on mount. Desktop reads the bundled template
  // pack (public/gitignore-templates.json) so the tool works fully offline.
  React.useEffect(() => {
    const url = isDesktop() ? '/gitignore-templates.json' : '/api/gitignore?list=true';
    fetch(url)
      .then(r => r.json())
      .then(data => {
        const arr = isDesktop() ? (data as { list?: string[] }).list : data;
        if (Array.isArray(arr)) setList(arr);
        else setErrorMsg(t('errorFetching'));
      })
      .catch(() => setErrorMsg(t('errorFetching')))
      .finally(() => setLoadingList(false));
  }, [t]);

  // Fetch aggregated output whenever selected changes
  React.useEffect(() => {
    if (selected.length === 0) {
      setOutput('');
      return;
    }

    const abort = new AbortController();
    setLoadingOutput(true);
    setErrorMsg(null);

    const load = isDesktop()
      ? fetch('/gitignore-templates.json', { signal: abort.signal })
          .then(r => r.json())
          .then((data: { templates?: Record<string, string> }) =>
            selected
              .map(tag => (data.templates?.[tag] ?? '').trim())
              .filter(Boolean)
              .join('\n\n')
          )
      : fetch(`/api/gitignore?tags=${encodeURIComponent(selected.join(','))}`, { signal: abort.signal })
          .then(async r => {
            if (!r.ok) throw new Error('Fetch failed');
            return r.text();
          });

    load
      .then(text => setOutput(text))
      .catch(err => {
        if (err.name !== 'AbortError') {
          setErrorMsg(t('errorGenerating'));
          setOutput('');
        }
      })
      .finally(() => setLoadingOutput(false));

    return () => abort.abort();
  }, [selected, t]);

  const handleCopy = () => {
    void copyToClipboard(output, { silent: true });
  };

  const handleDownload = () => {
    if (!output) return;
    const blob = new Blob([output], { type: 'text/plain;charset=utf-8' });
    downloadFile(blob, '.gitignore');
  };

  const toggleStack = (tag: string) => {
    setSelected(prev => 
      prev.includes(tag) ? prev.filter(t => t !== tag) : [...prev, tag]
    );
  };

  return (
    <ToolShell
      icon={IconFileMinus}
      title={t('title')}
      description={t('subtitle')}
    >
      <ToolPanels className="md:grid-cols-1 lg:grid-cols-2 overflow-auto pb-4">

        {/* Left Column: Stack Selection */}
        <div className="flex flex-col gap-4">
          <div className="rounded-lg border border-border bg-card p-4 flex flex-col items-start justify-start flex-1 min-h-[300px]">
            <Label className="text-xs text-muted-foreground uppercase tracking-wider mb-4">
              {t('searchPlaceholder')}
            </Label>
            
            <div className="w-full relative">
              <Popover open={open} onOpenChange={setOpen}>
                <PopoverTrigger asChild>
                  <Button
                    variant="outline"
                    role="combobox"
                    aria-expanded={open}
                    className="w-full justify-between h-auto min-h-11 px-3 py-2 text-left font-normal"
                    disabled={loadingList}
                  >
                    {loadingList ? (
                      <span className="flex items-center text-muted-foreground">
                        <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                        Loading stacks...
                      </span>
                    ) : selected.length === 0 ? (
                      <span className="text-muted-foreground">Select one or more stacks...</span>
                    ) : (
                      <div className="flex flex-wrap gap-1">
                        {selected.map(item => (
                          <Badge 
                            variant="secondary" 
                            key={item} 
                            className="mr-1 mb-1 px-1.5 py-0.5 rounded-sm hover:bg-destructive/10 hover:text-destructive group transition-colors"
                            onClick={(e) => {
                              e.stopPropagation();
                              toggleStack(item);
                            }}
                          >
                            {item}
                            <X className="ml-1 h-3 w-3 opacity-50 group-hover:opacity-100" />
                          </Badge>
                        ))}
                      </div>
                    )}
                    <Search className="ml-2 h-4 w-4 shrink-0 opacity-50" />
                  </Button>
                </PopoverTrigger>
                <PopoverContent className="w-[300px] sm:w-[400px] p-0" align="start">
                  <Command>
                    <CommandInput placeholder={t('searchPlaceholder')} />
                    <CommandList>
                      <CommandEmpty>{t('noResults')}</CommandEmpty>
                      <CommandGroup className="max-h-[300px] overflow-auto">
                        {list.map((stack) => {
                          const isSelected = selected.includes(stack);
                          return (
                            <CommandItem
                              key={stack}
                              value={stack}
                              onSelect={() => {
                                toggleStack(stack);
                              }}
                            >
                              <div className={cn(
                                "mr-2 flex h-4 w-4 items-center justify-center rounded-sm border border-primary",
                                isSelected ? "bg-primary text-primary-foreground" : "opacity-50 [&_svg]:invisible"
                              )}>
                                <Check className={cn("h-4 w-4")} />
                              </div>
                              <span>{stack}</span>
                            </CommandItem>
                          );
                        })}
                      </CommandGroup>
                    </CommandList>
                  </Command>
                </PopoverContent>
              </Popover>
            </div>
            
            {errorMsg && (
              <ToolErrorBanner message={errorMsg} />
            )}

            <div className="mt-8 flex flex-col flex-1 w-full gap-2 text-sm text-muted-foreground">
               <span className="text-xs uppercase tracking-wider">{t('selectedStacks')}</span>
               {selected.length === 0 ? (
                 <div className="flex-1 flex items-center justify-center border-2 border-dashed border-border rounded-lg p-6 bg-card/30">
                    <p className="text-center">{t('emptyState')}</p>
                 </div>
               ) : (
                 <ScrollArea className="flex-1 border rounded-md bg-card/30 p-2">
                   <div className="flex flex-col gap-1">
                     {selected.map((item, idx) => (
                       <div key={item} className="flex justify-between items-center rounded-md px-3 py-2 text-sm border bg-background shadow-sm hover:bg-accent hover:text-accent-foreground transition-colors group">
                          <code className="font-mono">{idx + 1}. {item}</code>
                          <Button variant="ghost" size="icon" className="h-6 w-6 opacity-0 group-hover:opacity-100 text-destructive hover:bg-destructive/10 hover:text-destructive" onClick={() => toggleStack(item)}>
                            <X className="h-4 w-4" />
                          </Button>
                       </div>
                     ))}
                   </div>
                 </ScrollArea>
               )}
            </div>
          </div>
        </div>

        {/* Right Column: Output */}
        <IOPanel
          label={
            <>
              {t('output')}
              {loadingOutput && <Loader2 className="h-3 w-3 animate-spin text-primary" />}
            </>
          }
          actions={
            <>
              <Button type="button" variant="ghost" size="sm" onClick={handleDownload} disabled={!output || loadingOutput} className="h-7 text-xs gap-1.5 px-2">
                <Download className="h-3.5 w-3.5" />
                <span className="hidden sm:inline">{t('download')}</span>
              </Button>
              <CopyTextButton
                onCopy={handleCopy}
                copied={copied}
                disabled={!output || loadingOutput}
                label={t('copy')}
                copiedLabel={t('copied')}
                className="h-7 px-2 text-xs"
              />
            </>
          }
        >
          {loadingOutput ? (
            <div className="absolute inset-0 flex flex-col items-center justify-center gap-3 backdrop-blur-sm bg-background/50 z-10">
              <Loader2 className="h-6 w-6 animate-spin text-primary" />
              <p className="text-sm font-medium animate-pulse">{t('generating')}</p>
            </div>
          ) : null}

          <ToolTextArea
            readOnly
            value={output}
            placeholder={t('emptyState')}
            className="overflow-auto"
          />
        </IOPanel>
      </ToolPanels>
    </ToolShell>
  );
}
