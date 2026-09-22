'use client';

import { useState, useMemo, useCallback } from 'react';
import { useCopyToClipboard } from '@/hooks/use-copy-to-clipboard';
import { useTranslations } from 'next-intl';
import { Label } from '@/components/ui/label';
import { Input } from '@/components/ui/input';
import { Button } from '@/components/ui/button';
import { Slider } from '@/components/ui/slider';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { Check, Copy, Plus, Trash, Dices, ArrowLeftRight, Download, Wand2 } from 'lucide-react';
import { IconColorSwatch } from '@tabler/icons-react';
import { cn } from '@/lib/utils';
import { ScrollArea, ScrollBar } from '@/components/ui/scroll-area';
import { ToolShell } from '@/components/tools/tool-shell';
import { downloadFile } from '@/lib/desktop/save-file';

type GradientType = 'linear' | 'radial' | 'conic';

interface ColorStop {
  id: string;
  color: string;
  position: number;
}

const generateId = () => Math.random().toString(36).substr(2, 9);

const PRESETS = [
  { name: 'Sunset', type: 'linear', angle: 45, stops: [{c: '#ff7e5f', p: 0}, {c: '#feb47b', p: 100}] },
  { name: 'Ocean', type: 'linear', angle: 135, stops: [{c: '#2b5876', p: 0}, {c: '#4e4376', p: 100}] },
  { name: 'Cyberpunk', type: 'linear', angle: 90, stops: [{c: '#f8049c', p: 0}, {c: '#fdd54f', p: 100}] },
  { name: 'Forest', type: 'linear', angle: 180, stops: [{c: '#134e5e', p: 0}, {c: '#71b280', p: 100}] },
  { name: 'Purple Dream', type: 'linear', angle: 90, stops: [{c: '#b224ef', p: 0}, {c: '#7579ff', p: 100}] },
  { name: 'Citrus', type: 'linear', angle: 45, stops: [{c: '#fdc830', p: 0}, {c: '#f37335', p: 100}] },
  { name: 'Cosmic', type: 'radial', angle: 0, stops: [{c: '#ff00cc', p: 0}, {c: '#333399', p: 100}] },
  { name: 'Conic Glow', type: 'conic', angle: 0, stops: [{c: '#ff4b1f', p: 0}, {c: '#ff9068', p: 100}] },
  { name: 'Sublime', type: 'linear', angle: 90, stops: [{c: '#fc5c7d', p: 0}, {c: '#6a82fb', p: 100}] },
] as const;

export function GradientLayout() {
  const t = useTranslations('CssGradientBuilder');

  const [type, setType] = useState<GradientType>('linear');
  const [angle, setAngle] = useState<number>(90);
  const [stops, setStops] = useState<ColorStop[]>([
    { id: generateId(), color: '#6366f1', position: 0 },
    { id: generateId(), color: '#ec4899', position: 100 },
  ]);

  const { isCopied: copied, copyToClipboard } = useCopyToClipboard();

  // Compute CSS
  const cssString = useMemo(() => {
    const sortedStops = [...stops].sort((a, b) => a.position - b.position);
    const stopStrings = sortedStops.map(s => `${s.color} ${s.position}%`).join(', ');
    
    if (type === 'linear') {
      return `background: linear-gradient(${angle}deg, ${stopStrings});`;
    } else if (type === 'radial') {
      return `background: radial-gradient(circle, ${stopStrings});`;
    } else {
      return `background: conic-gradient(from ${angle}deg, ${stopStrings});`;
    }
  }, [type, angle, stops]);

  const cssValue = cssString.replace('background: ', '').replace(';', '');

  const handleCopy = useCallback(() => {
    void copyToClipboard(cssString, { silent: true });
  }, [cssString, copyToClipboard]);

  const downloadImage = useCallback(async () => {
    const svg = `
    <svg xmlns="http://www.w3.org/2000/svg" width="1920" height="1080">
      <foreignObject width="100%" height="100%">
        <div xmlns="http://www.w3.org/1999/xhtml" style="width:100%;height:100%;${cssString.replace(';', '')}"></div>
      </foreignObject>
    </svg>`;
    const blob = new Blob([svg], { type: 'image/svg+xml' });
    const url = URL.createObjectURL(blob);
    
    const img = new Image();
    img.src = url;
    img.onload = () => {
      const canvas = document.createElement('canvas');
      canvas.width = 1920;
      canvas.height = 1080;
      const ctx = canvas.getContext('2d');
      if (ctx) {
        ctx.drawImage(img, 0, 0);
        try {
          canvas.toBlob((png) => {
            downloadFile(png ?? blob, png ? 'gradient-wallpaper.png' : 'gradient-wallpaper.svg');
          }, 'image/png');
        } catch {
          // If tainted canvas due to strict mode, download SVG directly as fallback
          downloadFile(blob, 'gradient-wallpaper.svg');
        }
      }
      URL.revokeObjectURL(url);
    };
  }, [cssString]);

  const addStop = () => {
    const sortedStops = [...stops].sort((a, b) => a.position - b.position);
    const lastStopPos = sortedStops.length > 0 ? sortedStops[sortedStops.length - 1].position : 0;
    
    let newPosition = Math.min(100, lastStopPos + 10);
    if (sortedStops.length >= 2) {
      newPosition = Math.round((sortedStops[sortedStops.length - 2].position + sortedStops[sortedStops.length - 1].position) / 2);
    }

    setStops([
      ...stops,
      { id: generateId(), color: '#ffffff', position: newPosition }
    ]);
  };

  const updateStop = (id: string, updates: Partial<ColorStop>) => {
    setStops(stops.map(s => s.id === id ? { ...s, ...updates } : s));
  };

  const removeStop = (id: string) => {
    if (stops.length <= 2) return;
    setStops(stops.filter(s => s.id !== id));
  };

  const reverseStops = () => {
    setStops([...stops].map((s, i) => ({ ...s, color: stops[stops.length - 1 - i].color })));
  };

  const randomize = () => {
    const randomColor = () => '#' + Math.floor(Math.random()*16777215).toString(16).padStart(6, '0');
    const types: GradientType[] = ['linear', 'radial', 'conic'];
    const newType = types[Math.floor(Math.random() * types.length)];
    const newAngle = Math.floor(Math.random() * 360);
    const count = Math.random() > 0.7 ? 3 : 2;
    const newStops = [];
    const interval = 100 / (count - 1);
    for(let i=0; i<count; i++) {
        newStops.push({ id: generateId(), color: randomColor(), position: Math.round(i * interval) });
    }
    setType(newType);
    setAngle(newAngle);
    setStops(newStops);
  };

  const loadPreset = (p: typeof PRESETS[number]) => {
    setType(p.type as GradientType);
    setAngle(p.angle);
    setStops(p.stops.map(s => ({ id: generateId(), color: s.c, position: s.p })));
  };

  return (
    <ToolShell
      icon={IconColorSwatch}
      title={t('title')}
      description={t('subtitle')}
      contentClassName="overflow-auto pb-4"
    >

      <div className="grid grid-cols-1 xl:grid-cols-2 gap-4 shrink-0">
        
        {/* Left Column: Preview + Settings */}
        <div className="flex flex-col gap-4">
          <div className="group relative flex flex-col items-center justify-center overflow-hidden rounded-lg border border-border bg-card p-4">
            <Label className="text-xs text-muted-foreground uppercase w-full text-left tracking-wider mb-3 z-10">
              {t('preview')}
            </Label>
            <div 
              className="w-full h-48 sm:h-72 rounded-xl border border-border shadow-inner transition-all duration-300 ease-out z-10"
              style={{ background: cssValue }}
            />
          </div>

          <div className="space-y-5 rounded-lg border border-border bg-card p-4">
            <div className="flex items-center justify-between">
              <Label className="text-xs text-muted-foreground uppercase tracking-wider">
                {t('settings')}
              </Label>
              <Button type="button" variant="outline" size="sm" onClick={randomize} className="h-8 gap-1.5 text-xs bg-amber-100 hover:bg-amber-200 text-amber-900 border-amber-300 dark:bg-amber-900/30 dark:border-amber-700 dark:text-amber-100 dark:hover:bg-amber-900/50">
                <Dices className="h-3.5 w-3.5" />
                {t('randomize')}
              </Button>
            </div>

            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
              <div className="space-y-2">
                <Label>{t('type')}</Label>
                <Select value={type} onValueChange={(v) => setType(v as GradientType)}>
                  <SelectTrigger aria-label={t('type')}>
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="linear">{t('linear')}</SelectItem>
                    <SelectItem value="radial">{t('radial')}</SelectItem>
                    <SelectItem value="conic">{t('conic')}</SelectItem>
                  </SelectContent>
                </Select>
              </div>

              {(type === 'linear' || type === 'conic') && (
                <div className="space-y-3">
                  <div className="flex items-center justify-between">
                    <Label>{t('angle')}</Label>
                    <span className="text-xs text-muted-foreground font-mono">{angle}°</span>
                  </div>
                  <div className="flex items-center gap-3">
                    <Slider
                      value={[angle]}
                      min={0}
                      max={360}
                      step={1}
                      onValueChange={(val: number[]) => setAngle(val[0])}
                      className="flex-1"
                    />
                    <Input
                      type="number"
                      min={0}
                      max={360}
                      value={angle}
                      onChange={(e) => {
                        const val = parseInt(e.target.value);
                        if (!isNaN(val)) {
                          setAngle(Math.min(360, Math.max(0, val)));
                        }
                      }}
                      className="w-16 h-9 font-mono text-xs"
                    />
                  </div>
                </div>
              )}
            </div>
          </div>

          <div className="space-y-3 rounded-lg border border-border bg-card p-4">
            <div className="flex items-center justify-between">
              <Label className="text-xs text-muted-foreground uppercase tracking-wider">
                {t('output')}
              </Label>
              <Button type="button" variant="ghost" size="sm" onClick={downloadImage} className="h-7 text-xs gap-1.5 px-2">
                <Download className="h-3.5 w-3.5" />
                {t('downloadImage')}
              </Button>
            </div>
            <div className="relative">
              <textarea
                readOnly
                value={cssString}
                className="flex w-full rounded-md border border-input bg-card px-3 py-2 text-sm shadow-sm font-mono min-h-[80px] resize-none focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring"
                spellCheck={false}
              />
              <div className="absolute bottom-2 right-2 flex gap-2">
                <Button 
                  size="sm" 
                  className={cn("h-8 gap-1.5 transition-all", copied ? "bg-green-500 hover:bg-green-600 text-white" : "")} 
                  onClick={handleCopy}
                >
                  {copied ? <Check className="h-3.5 w-3.5" /> : <Copy className="h-3.5 w-3.5" />}
                  {copied ? t('copied') : t('copy')}
                </Button>
              </div>
            </div>
          </div>
        </div>

        {/* Right Column: Stops & Presets */}
        <div className="flex flex-col gap-4">
          <div className="flex flex-col rounded-lg border border-border bg-card p-4">
             <div className="flex items-center justify-between mb-3">
              <Label className="text-xs text-muted-foreground uppercase tracking-wider">
                {t('presets')}
              </Label>
             </div>
             <ScrollArea className="w-full whitespace-nowrap pb-3">
               <div className="flex w-max space-x-3">
                  {PRESETS.map(p => {
                    // Quick generate preview CSS
                    const previewStr = p.type === 'linear' 
                      ? `linear-gradient(${p.angle}deg, ${p.stops.map(s => `${s.c} ${s.p}%`).join(', ')})`
                      : p.type === 'radial'
                      ? `radial-gradient(circle, ${p.stops.map(s => `${s.c} ${s.p}%`).join(', ')})`
                      : `conic-gradient(from ${p.angle}deg, ${p.stops.map(s => `${s.c} ${s.p}%`).join(', ')})`;
                    return (
                      <button
                        key={p.name}
                        onClick={() => loadPreset(p)}
                        className="group flex flex-col items-center gap-1.5 w-16"
                      >
                        <div 
                          className="h-12 w-full rounded-md border border-border/40 shadow-sm transition-transform group-hover:scale-105 group-hover:shadow-md"
                          style={{ background: previewStr }}
                          aria-hidden
                        />
                        <span className="text-[10px] text-muted-foreground w-full truncate text-center transition-colors group-hover:text-foreground">
                          {p.name}
                        </span>
                      </button>
                    )
                  })}
               </div>
               <ScrollBar orientation="horizontal" />
             </ScrollArea>
          </div>

          <div className="flex flex-1 flex-col rounded-lg border border-border bg-card p-4">
            <div className="flex items-center justify-between mb-4">
              <Label className="text-xs text-muted-foreground uppercase tracking-wider">
                {t('stops')}
              </Label>
              <div className="flex items-center gap-2">
                <Button size="sm" variant="outline" onClick={reverseStops} className="gap-1.5 h-8 text-xs px-2">
                  <ArrowLeftRight className="h-3.5 w-3.5" />
                  <span className="hidden sm:inline">{t('reverse')}</span>
                </Button>
                <Button size="sm" variant="secondary" onClick={addStop} className="gap-1.5 h-8 text-xs">
                  <Plus className="h-3.5 w-3.5" />
                  {t('addStop')}
                </Button>
              </div>
            </div>

            <div className="space-y-4">
              {stops.map((stop, index) => (
                <div key={stop.id} className="flex flex-col sm:flex-row items-stretch sm:items-center gap-3 p-3 rounded-lg border bg-card/50">
                  <div className="flex items-center gap-3 w-full sm:w-auto flex-1">
                    <input
                      type="color"
                      value={stop.color}
                      onChange={(e) => updateStop(stop.id, { color: e.target.value })}
                      className="h-10 w-12 cursor-pointer rounded-md border border-input bg-background p-1 shrink-0"
                      aria-label={t('color')}
                    />
                    <Input
                      type="text"
                      value={stop.color}
                      onChange={(e) => updateStop(stop.id, { color: e.target.value })}
                      className="font-mono text-xs h-10 w-24 shrink-0 uppercase"
                    />
                    
                    <div className="flex-1 px-2 hidden sm:block">
                      <Slider
                        value={[stop.position]}
                        min={0}
                        max={100}
                        step={1}
                        onValueChange={(val: number[]) => updateStop(stop.id, { position: val[0] })}
                      />
                    </div>
                    
                    <div className="relative flex items-center shrink-0">
                      <Input
                        type="number"
                        min={0}
                        max={100}
                        value={stop.position}
                        onChange={(e) => {
                          const val = parseInt(e.target.value);
                          if (!isNaN(val)) updateStop(stop.id, { position: Math.min(100, Math.max(0, val)) });
                        }}
                        className="w-16 h-10 font-mono text-xs pr-6"
                      />
                      <span className="absolute right-2 text-xs text-muted-foreground">%</span>
                    </div>
                  </div>

                  <div className="flex sm:hidden px-1 pt-2 w-full">
                    <Slider
                      value={[stop.position]}
                      min={0}
                      max={100}
                      step={1}
                      onValueChange={(val: number[]) => updateStop(stop.id, { position: val[0] })}
                    />
                  </div>
                  
                  <div className="flex justify-end mt-2 sm:mt-0">
                    <Button
                      variant="ghost"
                      size="icon"
                      onClick={() => removeStop(stop.id)}
                      disabled={stops.length <= 2}
                      className={cn("h-10 w-10 shrink-0", stops.length <= 2 ? "opacity-50" : "text-destructive hover:text-destructive hover:bg-destructive/10")}
                      title={t('deleteStop')}
                    >
                      <Trash className="h-4 w-4" />
                    </Button>
                  </div>
                </div>
              ))}
            </div>
            
          </div>
        </div>

      </div>
    </ToolShell>
  );
}
