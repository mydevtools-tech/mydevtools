'use client';

import { ReactNode } from 'react';
import { Card, CardContent } from '@/components/ui/card';
import { cn } from '@/lib/utils';

interface ToolWrapperProps {
  children: ReactNode;
  className?: string;
  maxWidth?: 'sm' | 'md' | 'lg' | 'xl' | '2xl' | '4xl' | '5xl' | 'full';
  /** Fill the app main column with minimal padding (full-height tools). */
  fillMain?: boolean;
}

const maxWidthClasses = {
  sm: 'max-w-sm',
  md: 'max-w-md',
  lg: 'max-w-lg',
  xl: 'max-w-xl',
  '2xl': 'max-w-2xl',
  '4xl': 'max-w-4xl',
  '5xl': 'max-w-5xl',
  full: 'max-w-full',
};

/**
 * Base wrapper component for all tools — consistent layout only.
 *
 * Usage history is recorded centrally in the app shell (`ToolUsageTracker` in
 * components/sidebar/client-layout.tsx) so that every tool is counted, not just
 * the handful that happen to render this wrapper.
 */
export function ToolWrapper({
  children,
  className = '',
  maxWidth = '4xl',
  fillMain = false,
}: ToolWrapperProps) {
  return (
    <div
      className={cn(
        'bg-background text-foreground',
        fillMain
          ? 'flex h-full min-h-0 flex-col p-1 md:p-2'
          : 'min-h-screen p-2 md:p-4',
        className
      )}
    >
      <Card
        className={cn(
          maxWidthClasses[maxWidth],
          'mx-auto w-full',
          fillMain &&
            'flex min-h-0 flex-1 flex-col rounded-none border-0 bg-transparent shadow-none'
        )}
      >
        <CardContent
          className={cn(
            fillMain
              ? 'flex min-h-0 flex-1 flex-col p-1 pt-1 sm:p-2 sm:pt-2'
              : 'pt-6'
          )}
        >
          {children}
        </CardContent>
      </Card>
    </div>
  );
}
