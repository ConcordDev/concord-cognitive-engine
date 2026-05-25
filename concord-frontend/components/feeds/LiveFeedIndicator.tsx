'use client';

import { useState, useEffect } from 'react';
import { cn } from '@/lib/utils';
import { onEvent } from '@/lib/realtime/event-bus';

interface LiveFeedIndicatorProps {
  domain: string;
  className?: string;
  showCount?: boolean;
}

/**
 * LiveFeedIndicator — Shows a pulsing "Live" badge when new feed DTUs arrive
 * for a specific lens domain. Listens to event bus feed:new-dtu events.
 */
export function LiveFeedIndicator({ domain, className, showCount = false }: LiveFeedIndicatorProps) {
  const [newCount, setNewCount] = useState(0);
  const [isLive, setIsLive] = useState(false);

  useEffect(() => {
    const unsub = onEvent('feed:new-dtu', (data: unknown) => {
      const detail = data as { domain?: string };
      if (detail?.domain === domain) {
        setNewCount(prev => prev + 1);
        setIsLive(true);
      }
    });

    return unsub;
  }, [domain]);

  // Auto-fade after 10s of no new events
  useEffect(() => {
    if (!isLive) return;
    const timer = setTimeout(() => setIsLive(false), 10000);
    return () => clearTimeout(timer);
  }, [isLive, newCount]);

  if (!isLive && newCount === 0) return null;

  return (
    <div className={cn('inline-flex items-center gap-1', className)}>
      <span className="relative flex h-2 w-2">
        {isLive && (
          <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-green-400 opacity-75" />
        )}
        <span className={cn(
          'relative inline-flex rounded-full h-2 w-2',
          isLive ? 'bg-green-400' : 'bg-gray-500'
        )} />
      </span>
      <span className={cn(
        'text-[10px] font-medium',
        isLive ? 'text-green-400' : 'text-gray-400'
      )}>
        Live
      </span>
      {showCount && newCount > 0 && (
        <span className="text-[10px] text-gray-400">({newCount})</span>
      )}
    </div>
  );
}
