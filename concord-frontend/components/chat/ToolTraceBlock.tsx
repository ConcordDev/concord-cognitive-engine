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
      <div className="w-10 h-10 rounded-lg bg-[var(--nb-blue-soft,rgba(6,182,212,0.1))] border border-[color:var(--nb-blue,rgba(6,182,212,0.3))] flex items-center justify-center flex-shrink-0">
        <Hammer className="w-4 h-4 text-[color:var(--nb-blue,#67e8f9)]" aria-hidden="true" />
      </div>
      <div className="flex-1 max-w-2xl">
        <button
          type="button"
          onClick={() => setOpen((v) => !v)}
          className={cn(
            'inline-flex items-center gap-2 rounded-md border px-3 py-1.5 text-xs font-mono',
            failed
              ? 'border-[color:var(--nb-red,rgba(244,63,94,0.4))] bg-[var(--nb-red-soft,rgba(244,63,94,0.1))] text-[color:var(--nb-red,#fecdd3)]'
              : 'border-[color:var(--nb-blue,rgba(6,182,212,0.3))] bg-[var(--nb-blue-soft,rgba(6,182,212,0.1))] text-[color:var(--nb-blue,#a5f3fc)]',
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
          <pre className="mt-2 max-h-64 overflow-auto rounded-md border border-[color:var(--nb-rule,rgb(var(--lattice-border-rgb)))] bg-[var(--nb-paper,rgba(0,0,0,0.6))] p-3 text-[11px] font-mono text-[color:var(--nb-ink-2,#d1d5db)]">
            {trace.error
              ? trace.error
              : JSON.stringify(trace.result, null, 2)}
          </pre>
        )}
      </div>
    </div>
  );
}

