'use client';

import { useEffect, useState } from 'react';
import { Brain, Layers } from 'lucide-react';

interface ReasoningSession {
  id: string;
  status: 'active' | 'synthesizing' | 'complete' | 'interrupted' | 'failed';
  shadowCount: number;
  originalIntent?: string;
  startedAt: string;
}

interface ReasoningIndicatorProps {
  sessionId: string | null | undefined;
}

export function ReasoningIndicator({ sessionId }: ReasoningIndicatorProps) {
  const [session, setSession] = useState<ReasoningSession | null>(null);

  useEffect(() => {
    if (!sessionId) {
      setSession(null);
      return;
    }

    let active = true;
    let intervalId: ReturnType<typeof setInterval> | null = null;

    async function poll() {
      try {
        const res = await fetch(`/api/reasoning/session/${sessionId}`);
        if (!res.ok) return;
        const data = await res.json();
        if (!active) return;
        setSession(data.session);
        // Stop polling when complete
        if (data.session?.status === 'complete' || data.session?.status === 'failed') {
          if (intervalId) clearInterval(intervalId);
          // Hide after a short delay
          setTimeout(() => {
            if (active) setSession(null);
          }, 2000);
        }
      } catch (_e) {
        /* non-fatal */
      }
    }

    poll();
    intervalId = setInterval(poll, 1000);

    return () => {
      active = false;
      if (intervalId) clearInterval(intervalId);
    };
  }, [sessionId]);

  if (!session || session.status === 'complete' || session.status === 'failed') return null;

  return (
    <div className="flex items-center gap-2 px-3 py-1.5 rounded-lg bg-neon-cyan/5 border border-neon-cyan/20 text-xs">
      <div className="relative flex-shrink-0">
        <Brain className="w-3.5 h-3.5 text-neon-cyan animate-pulse" />
      </div>
      <span className="text-neon-cyan/80 font-medium">
        {session.status === 'synthesizing' ? 'Synthesizing response…' : 'Reasoning in depth'}
      </span>
      {session.shadowCount > 0 && (
        <span className="flex items-center gap-1 text-gray-500">
          <Layers className="w-3 h-3" />
          {session.shadowCount} {session.shadowCount === 1 ? 'shadow' : 'shadows'}
        </span>
      )}
    </div>
  );
}
