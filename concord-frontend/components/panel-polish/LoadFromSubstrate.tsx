'use client';

/**
 * LoadFromSubstrate — small picker that fetches a real list from the
 * backend and lets the user select one entry to load into a panel input.
 *
 * No mock/seed data: every entry rendered here comes from a real endpoint
 * call (so dropdowns are empty if the backend has nothing).
 *
 * Usage:
 *
 *   <LoadFromSubstrate<Workspace>
 *     label="Load workspace"
 *     fetcher={async () => (await api.get('/api/collab/workspaces')).data.workspaces ?? []}
 *     describe={(w) => ({ id: w.id, primary: w.name ?? w.id, secondary: `${w.members?.length ?? 0} members` })}
 *     onSelect={(w) => { setMembers(w.members.map(...)); }}
 *   />
 */

import { useState } from 'react';
import { Database, Loader2, ChevronDown, AlertTriangle } from 'lucide-react';
import { cn } from '@/lib/utils';

interface Descriptor { id: string; primary: string; secondary?: string }

interface Props<T> {
  label: string;
  fetcher: () => Promise<T[]>;
  describe: (item: T, i: number) => Descriptor;
  onSelect: (item: T) => void;
  /** Optional short hint for empty result state. */
  emptyHint?: string;
  /** Optional helper rendered below the menu while open. */
  footer?: React.ReactNode;
  compact?: boolean;
}

export function LoadFromSubstrate<T>({ label, fetcher, describe, onSelect, emptyHint, footer, compact }: Props<T>) {
  const [open, setOpen] = useState(false);
  const [items, setItems] = useState<T[] | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function toggle() {
    if (open) { setOpen(false); return; }
    setOpen(true);
    if (items !== null) return;
    setLoading(true); setError(null);
    try {
      const list = await fetcher();
      setItems(Array.isArray(list) ? list : []);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'fetch failed');
      setItems([]);
    } finally { setLoading(false); }
  }

  async function refresh() {
    setLoading(true); setError(null); setItems(null);
    try {
      const list = await fetcher();
      setItems(Array.isArray(list) ? list : []);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'fetch failed');
      setItems([]);
    } finally { setLoading(false); }
  }

  return (
    <div className="relative inline-block">
      <button
        type="button"
        onClick={toggle}
        className={cn(
          'flex items-center gap-1 rounded border border-zinc-700 bg-zinc-900/60 text-zinc-300 hover:text-white hover:border-zinc-500',
          compact ? 'text-[9px] px-1 py-0.5' : 'text-[10px] px-1.5 py-0.5',
        )}
        title="Load real data from server"
      >
        <Database className={cn(compact ? 'w-2.5 h-2.5' : 'w-3 h-3')} />
        {label}
        <ChevronDown className={cn(compact ? 'w-2.5 h-2.5' : 'w-3 h-3', 'opacity-60')} />
      </button>
      {open && (
        <div className="absolute z-30 mt-1 right-0 min-w-[16rem] max-h-72 overflow-auto rounded border border-zinc-700 bg-zinc-950 shadow-xl shadow-black/50 p-1">
          <div className="flex items-center justify-between px-2 py-1 text-[10px] text-zinc-500 border-b border-zinc-800">
            <span>{label}</span>
            <button type="button" onClick={refresh} className="text-zinc-400 hover:text-white" disabled={loading}>refresh</button>
          </div>
          {loading && (
            <div className="flex items-center gap-2 px-2 py-2 text-[10px] text-zinc-400"><Loader2 className="w-3 h-3 animate-spin" /> Loading…</div>
          )}
          {error && (
            <div className="flex items-start gap-1 px-2 py-2 text-[10px] text-red-300"><AlertTriangle className="w-3 h-3 mt-0.5" /> {error}</div>
          )}
          {!loading && items && items.length === 0 && (
            <div className="px-2 py-2 text-[10px] text-zinc-500 italic">{emptyHint ?? 'No entries yet.'}</div>
          )}
          {items && items.length > 0 && items.map((item, i) => {
            const d = describe(item, i);
            return (
              <button
                key={d.id}
                type="button"
                onClick={() => { onSelect(item); setOpen(false); }}
                className="block w-full text-left px-2 py-1 text-[10px] text-zinc-200 hover:bg-zinc-800 rounded"
              >
                <div className="font-mono text-zinc-100 truncate">{d.primary}</div>
                {d.secondary && <div className="text-[9px] text-zinc-500 truncate">{d.secondary}</div>}
              </button>
            );
          })}
          {footer && <div className="px-2 py-1 border-t border-zinc-800 text-[9px] text-zinc-500">{footer}</div>}
        </div>
      )}
    </div>
  );
}
