'use client';

import React, { useState, useCallback, useRef } from 'react';
import { useCopyToClipboard } from '@/hooks/use-copy-to-clipboard';
import { Button } from '@/components/ui/button';
import {
  ArrowRightLeft,
  Copy,
  Check,
  Trash2,
  Upload,
  Download,
  AlertCircle,
} from 'lucide-react';
import { cn } from '@/lib/utils';
import { useTranslations } from 'next-intl';
import { useSearchParams } from 'next/navigation';
import { SendToMenu } from '@/components/ui/send-to-menu';
import { IconLink } from '@tabler/icons-react';
import { ToolShell } from '@/components/tools/tool-shell';
import { ToolPanels, IOPanel, ToolTextArea } from '@/components/tools/io-panel';
import { downloadFile } from '@/lib/desktop/save-file';

type Mode = 'encode' | 'decode';

export function UrlEncodeLayout() {
  const t = useTranslations('UrlEncode');
  const searchParams = useSearchParams();
  const initialInput = searchParams.get('input') || '';
  const [input, setInput] = useState(initialInput);
  const [output, setOutput] = useState('');
  const [mode, setMode] = useState<Mode>('encode');
  const [error, setError] = useState('');
  const { isCopied: copied, copyToClipboard } = useCopyToClipboard();
  const [isDragging, setIsDragging] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const processInput = useCallback((text: string, currentMode: Mode) => {
    setInput(text);
    setError('');

    if (!text) {
      setOutput('');
      return;
    }

    try {
      if (currentMode === 'encode') {
        setOutput(encodeURIComponent(text));
      } else {
        setOutput(decodeURIComponent(text.trim()));
      }
    } catch {
      setError(
        currentMode === 'decode'
          ? t('errors.invalidEncoding')
          : t('errors.encodeFailed')
      );
      setOutput('');
      }
    },
    [t]
  );

  React.useEffect(() => {
    if (initialInput) {
      processInput(initialInput, 'encode');
    }
  }, [initialInput, processInput]);

  const handleInputChange = (value: string) => {
    processInput(value, mode);
  };

  const toggleMode = () => {
    const newMode = mode === 'encode' ? 'decode' : 'encode';
    setMode(newMode);
    if (output) {
      processInput(output, newMode);
    } else {
      processInput(input, newMode);
    }
  };

  const handleCopy = () => {
    if (!output) return;
    void copyToClipboard(output, { silent: true });
  };

  const handleClear = () => {
    setInput('');
    setOutput('');
    setError('');
  };

  const handleFileUpload = (file: File) => {
    const reader = new FileReader();
    reader.onload = (e) => {
      const text = e.target?.result as string;
      processInput(text, mode);
    };
    reader.readAsText(file);
  };

  const handleDownload = () => {
    if (!output) return;
    const blob = new Blob([output], { type: 'text/plain' });
    downloadFile(blob, mode === 'encode' ? t('download.encodedFilename') : t('download.decodedFilename'));
  };

  const handleDrop = (e: React.DragEvent) => {
    e.preventDefault();
    setIsDragging(false);
    const file = e.dataTransfer.files[0];
    if (file) handleFileUpload(file);
  };

  const handleDragOver = (e: React.DragEvent) => {
    e.preventDefault();
    setIsDragging(true);
  };

  const handleDragLeave = () => {
    setIsDragging(false);
  };

  const charCount = input.length;
  const outputCharCount = output.length;

  const toolbar = (
    <div className="flex shrink-0 flex-col gap-3">
      {/* Mobile upload/clear actions */}
      <div className="flex items-center gap-2 md:hidden">
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
          accept=".txt,.json,.xml,.html,.css,.js,.ts,.md"
          className="hidden"
          onChange={(e) => {
            const file = e.target.files?.[0];
            if (file) handleFileUpload(file);
            e.target.value = '';
          }}
        />
        <Button variant="outline" size="sm" className="gap-1.5 text-xs" onClick={handleClear}>
          <Trash2 className="h-3.5 w-3.5" />
          {t('clear')}
        </Button>
      </div>

      {/* Mode toggle */}
      <div className="flex items-center justify-center">
        <div className="inline-flex items-center gap-1 rounded-xl border border-border/60 bg-[hsl(var(--surface-2))] p-1">
          <button
            type="button"
            onClick={() => {
              if (mode !== 'encode') {
                setMode('encode');
                processInput(input, 'encode');
              }
            }}
            className={cn(
              'rounded-lg px-4 py-1.5 text-sm font-medium transition-all duration-200',
              mode === 'encode'
                ? 'border border-border bg-card text-foreground shadow-sm'
                : 'text-muted-foreground hover:text-foreground'
            )}
          >
            {t('modes.encode')}
          </button>
          <button
            type="button"
            onClick={toggleMode}
            className="rounded-lg p-2 text-muted-foreground transition-colors hover:bg-card/50 hover:text-foreground"
            title={t('swapTitle')}
          >
            <ArrowRightLeft className="h-4 w-4" />
          </button>
          <button
            type="button"
            onClick={() => {
              if (mode !== 'decode') {
                setMode('decode');
                processInput(input, 'decode');
              }
            }}
            className={cn(
              'rounded-lg px-4 py-1.5 text-sm font-medium transition-all duration-200',
              mode === 'decode'
                ? 'border border-border bg-card text-foreground shadow-sm'
                : 'text-muted-foreground hover:text-foreground'
            )}
          >
            {t('modes.decode')}
          </button>
        </div>
      </div>
    </div>
  );

  return (
    <ToolShell
      icon={IconLink}
      title={t('title')}
      description={t('subtitle')}
      toolbar={toolbar}
    >
      <ToolPanels>
        {/* Input */}
        <IOPanel
          onDrop={handleDrop}
          onDragOver={handleDragOver}
          onDragLeave={handleDragLeave}
          className={cn('transition-colors', isDragging && 'border-primary/50 bg-primary/5')}
          label={mode === 'encode' ? t('panels.plainText') : t('panels.encodedInput')}
          actions={
            <span className="text-[10px] tabular-nums text-muted-foreground">
              {t('charCount', { count: charCount.toLocaleString() })}
            </span>
          }
        >
          <ToolTextArea
            value={input}
            onChange={(e) => handleInputChange(e.target.value)}
            placeholder={mode === 'encode' ? t('placeholders.encode') : t('placeholders.decode')}
          />
          {isDragging && (
            <div className="absolute inset-0 flex items-center justify-center bg-primary/5 backdrop-blur-sm">
              <div className="flex flex-col items-center gap-2 text-primary">
                <Upload className="h-8 w-8" />
                <span className="text-sm font-medium">{t('dropHere')}</span>
              </div>
            </div>
          )}
        </IOPanel>

        {/* Output */}
        <IOPanel
          label={mode === 'encode' ? t('panels.encodedOutput') : t('panels.decodedText')}
          actions={
            <>
              <span className="text-[10px] tabular-nums text-muted-foreground">
                {t('charCount', { count: outputCharCount.toLocaleString() })}
              </span>
              <Button
                variant="ghost"
                size="icon"
                className="h-6 w-6"
                onClick={handleDownload}
                disabled={!output}
                title={t('download.title')}
              >
                <Download className="h-3 w-3" />
              </Button>
              <Button
                variant="ghost"
                size="icon"
                className="h-6 w-6"
                onClick={handleCopy}
                disabled={!output}
                title={t('copyTitle')}
              >
                {copied ? <Check className="h-3 w-3 text-green-500" /> : <Copy className="h-3 w-3" />}
              </Button>
              <div className="ml-1 border-l border-border/50 pl-1">
                <SendToMenu content={output} disabled={!output} />
              </div>
            </>
          }
        >
          {error ? (
            <div className="absolute inset-0 flex items-center justify-center p-4">
              <div className="flex flex-col items-center gap-2 text-destructive">
                <AlertCircle className="h-6 w-6" />
                <p className="text-center text-sm">{error}</p>
              </div>
            </div>
          ) : (
            <ToolTextArea value={output} readOnly placeholder={t('outputPlaceholder')} />
          )}
        </IOPanel>
      </ToolPanels>
    </ToolShell>
  );
}
