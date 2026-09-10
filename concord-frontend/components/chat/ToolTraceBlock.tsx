'use client';

import { useState } from 'react';
import { Hammer, ChevronDown, ChevronRight } from 'lucide-react';
import { cn } from '@/lib/utils';

export interface ToolTrace {
  id: string;
  domain: string;
  action: string;
  result: unknown;
  error?: string;
  createdAt: string;
}

interface ToolTraceBlockProps {
  trace: {
    id: string;
    domain: string;
    action: string;
    result: unknown;
    error?: string;
    createdAt: string;
  };
}

export function ToolTraceBlock({ trace }: ToolTraceBlockProps) {
  const [open, setOpen] = useState(false);
  const failed = !!trace.error || (typeof trace.result === 'object' && trace.result && 'ok' in trace.result && (trace.result as { ok?: boolean }).ok === false);
  return (
    <div
      className={cn(
        'flex gap-4',
        // Match the Concord-side message shape; trace is "Concord did a thing"
      )}
    >
      <div className="w-10 h-10 rounded-lg bg-cyan-500/10 border border-cyan-500/30 flex items-center justify-center flex-shrink-0">
        <Hammer className="w-4 h-4 text-cyan-300" aria-hidden="true" />
      </div>
      <div className="flex-1 max-w-2xl">
        <button
          type="button"
          onClick={() => setOpen((v) => !v)}
          className={cn(
            'inline-flex items-center gap-2 rounded-md border px-3 py-1.5 text-xs font-mono',
            failed
              ? 'border-rose-500/40 bg-rose-500/10 text-rose-200'
              : 'border-cyan-500/30 bg-cyan-500/10 text-cyan-200',
            'hover:brightness-110'
          )}
          aria-expanded={open}
        >
          {open ? <ChevronDown className="w-3 h-3" /> : <ChevronRight className="w-3 h-3" />}
          {trace.domain}.{trace.action}
          <span className="ml-1 text-[10px] opacity-70">
            {failed ? 'failed' : 'ok'}
          </span>
        </button>
        {open && (
          <pre className="mt-2 max-h-64 overflow-auto rounded-md border border-lattice-border bg-black/60 p-3 text-[11px] font-mono text-gray-300">
            {trace.error
              ? trace.error
              : JSON.stringify(trace.result, null, 2)}
          </pre>
        )}
      </div>
    </div>
  );
}

