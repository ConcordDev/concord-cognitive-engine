'use client';

/**
 * ThreadLabelBar — surfaces the per-message label workflow (message.labels-apply /
 * labels-remove / labels-for-message macros existed backend-side but had no UI; only
 * the label catalog was surfaced via LabelManagerPanel). Renders the labels applied to
 * the active thread as removable chips, plus an "add label" picker from the catalog.
 * Completes the Gmail-labels feature.
 */

import { useCallback, useEffect, useRef, useState } from 'react';
import { Tag, Plus, X, Loader2 } from 'lucide-react';
import { lensRun } from '@/lib/api/client';
import { cn } from '@/lib/utils';

interface Label { id: string; name: string; color?: string }

export function ThreadLabelBar({ threadId, className }: { threadId: string; className?: string }) {
  const [applied, setApplied] = useState<Label[]>([]);
  const [catalog, setCatalog] = useState<Label[]>([]);
  const [busy, setBusy] = useState(false);
  const [picking, setPicking] = useState(false);
  const pickRef = useRef<HTMLDivElement | null>(null);

  const loadApplied = useCallback(async () => {
    if (!threadId) return;
    try {
      const r = await lensRun('message', 'labels-for-message', { messageId: threadId });
      const list = (r?.data?.result?.labels || []) as Label[];
      setApplied(Array.isArray(list) ? list : []);
    } catch { /* non-fatal — bar just shows no chips */ }
  }, [threadId]);

  const loadCatalog = useCallback(async () => {
    try {
      const r = await lensRun('message', 'labels-list', {});
      const list = (r?.data?.result?.labels || []) as Label[];
      setCatalog(Array.isArray(list) ? list : []);
    } catch { /* non-fatal */ }
  }, []);

  useEffect(() => { void loadApplied(); }, [loadApplied]);
  useEffect(() => { void loadCatalog(); }, [loadCatalog]);

  // close picker on outside click
  useEffect(() => {
    if (!picking) return;
    const onClick = (e: MouseEvent) => { if (pickRef.current && !pickRef.current.contains(e.target as Node)) setPicking(false); };
    document.addEventListener('mousedown', onClick);
    return () => document.removeEventListener('mousedown', onClick);
  }, [picking]);

  const apply = useCallback(async (labelId: string) => {
    setBusy(true); setPicking(false);
    try {
      await lensRun('message', 'labels-apply', { messageId: threadId, labelId });
      await loadApplied();
    } finally { setBusy(false); }
  }, [threadId, loadApplied]);

  const remove = useCallback(async (labelId: string) => {
    setApplied((prev) => prev.filter((l) => l.id !== labelId));
    try { await lensRun('message', 'labels-remove', { messageId: threadId, labelId }); }
    catch { void loadApplied(); }
  }, [threadId, loadApplied]);

  const appliedIds = new Set(applied.map((l) => l.id));
  const available = catalog.filter((l) => !appliedIds.has(l.id));

  return (
    <div className={cn('flex items-center flex-wrap gap-1.5', className)}>
      <Tag className="w-3.5 h-3.5 text-gray-400" aria-hidden="true" />
      {applied.map((l) => (
        <span key={l.id} className="inline-flex items-center gap-1 text-[11px] rounded-full px-2 py-0.5 border"
          style={{ color: l.color || '#06b6d4', borderColor: (l.color || '#06b6d4') + '66', backgroundColor: (l.color || '#06b6d4') + '1a' }}>
          {l.name}
          <button type="button" onClick={() => void remove(l.id)} aria-label={`Remove label ${l.name}`}
            className="hover:text-white focus:outline-none focus-visible:ring-1 focus-visible:ring-white/40 rounded">
            <X className="w-2.5 h-2.5" />
          </button>
        </span>
      ))}
      {applied.length === 0 && <span className="text-[11px] text-gray-500">No labels</span>}

      <div className="relative" ref={pickRef}>
        <button type="button" onClick={() => setPicking((p) => !p)} disabled={busy || available.length === 0}
          aria-label="Add label to conversation"
          className="inline-flex items-center gap-0.5 text-[11px] text-gray-400 hover:text-gray-200 disabled:opacity-40 rounded px-1 py-0.5 focus:outline-none focus-visible:ring-1 focus-visible:ring-white/40">
          {busy ? <Loader2 className="w-3 h-3 animate-spin" /> : <Plus className="w-3 h-3" />} Label
        </button>
        {picking && available.length > 0 && (
          <div className="absolute z-20 mt-1 left-0 min-w-[9rem] max-h-48 overflow-auto rounded-md border border-white/10 bg-zinc-900 shadow-xl py-1">
            {available.map((l) => (
              <button key={l.id} type="button" onClick={() => void apply(l.id)}
                className="w-full text-left px-2.5 py-1.5 text-[11px] text-gray-200 hover:bg-white/10 inline-flex items-center gap-1.5">
                <span className="w-2 h-2 rounded-full" style={{ backgroundColor: l.color || '#06b6d4' }} />
                {l.name}
              </button>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}

export default ThreadLabelBar;
