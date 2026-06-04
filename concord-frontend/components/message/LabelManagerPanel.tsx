'use client';

/**
 * LabelManagerPanel — surfaces the message lens's Gmail-style labels (the
 * message.labels-* macros existed backend-side but had no UI). Create labels,
 * pick a colour, see the list as chips. Per-message apply/remove is wired
 * separately via labels-apply / labels-for-message.
 */

import { useCallback, useEffect, useState } from 'react';
import { Tag, Plus, Loader2, AlertTriangle } from 'lucide-react';
import { lensRun } from '@/lib/api/client';
import { cn } from '@/lib/utils';

interface Label {
  id: string;
  number?: string;
  name: string;
  color?: string;
  createdAt?: string;
}

const COLORS = ['#ef4444', '#f59e0b', '#22c55e', '#3b82f6', '#a855f7', '#ec4899', '#14b8a6', '#64748b'];

export function LabelManagerPanel({ className }: { className?: string }) {
  const [labels, setLabels] = useState<Label[]>([]);
  const [loading, setLoading] = useState(false);
  const [creating, setCreating] = useState(false);
  const [name, setName] = useState('');
  const [color, setColor] = useState(COLORS[3]);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const r = await lensRun('message', 'labels-list', {});
      const list = (r?.data?.result?.labels || []) as Label[];
      setLabels(Array.isArray(list) ? list : []);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to load labels');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { void load(); }, [load]);

  const create = useCallback(async () => {
    const trimmed = name.trim();
    if (!trimmed) return;
    setCreating(true);
    setError(null);
    try {
      const r = await lensRun('message', 'labels-create', { name: trimmed, color });
      const created = (r?.data?.result?.label) as Label | undefined;
      if (r?.data?.error) { setError(String(r.data.error)); }
      else {
        setName('');
        if (created) setLabels((prev) => [...prev, created]);
        else void load();
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to create label');
    } finally {
      setCreating(false);
    }
  }, [name, color, load]);

  return (
    <div className={cn('rounded-xl border border-zinc-800 bg-zinc-950/40 p-4', className)}>
      <div className="flex items-center gap-2 mb-3">
        <Tag className="w-4 h-4 text-sky-400" />
        <h3 className="text-sm font-semibold text-zinc-100">Labels</h3>
        {loading && <Loader2 className="w-3.5 h-3.5 animate-spin text-zinc-500" />}
      </div>

      {error && (
        <div className="mb-3 flex items-center gap-2 text-xs text-rose-300">
          <AlertTriangle className="w-3.5 h-3.5" /> {error}
        </div>
      )}

      {/* Existing labels */}
      <div className="flex flex-wrap gap-1.5 mb-3 min-h-[1.5rem]">
        {labels.length === 0 && !loading && (
          <span className="text-xs text-zinc-500">No labels yet — create one below.</span>
        )}
        {labels.map((l) => (
          <span
            key={l.id}
            className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-xs font-medium"
            style={{ backgroundColor: `${l.color || '#64748b'}22`, color: l.color || '#94a3b8', border: `1px solid ${l.color || '#64748b'}55` }}
          >
            <span className="w-2 h-2 rounded-full" style={{ backgroundColor: l.color || '#64748b' }} />
            {l.name}
          </span>
        ))}
      </div>

      {/* Create form */}
      <form
        onSubmit={(e) => { e.preventDefault(); void create(); }}
        className="flex items-center gap-2"
      >
        <input
          value={name}
          onChange={(e) => setName(e.target.value)}
          placeholder="New label name…"
          maxLength={40}
          className="flex-1 bg-zinc-900 border border-zinc-700 rounded px-2 py-1.5 text-xs text-zinc-100 focus:border-sky-500 focus:outline-none"
        />
        <div className="flex items-center gap-1">
          {COLORS.map((c) => (
            <button
              key={c}
              type="button"
              aria-label={`Colour ${c}`}
              onClick={() => setColor(c)}
              className={cn('w-4 h-4 rounded-full border', color === c ? 'border-white' : 'border-transparent')}
              style={{ backgroundColor: c }}
            />
          ))}
        </div>
        <button
          type="submit"
          disabled={creating || !name.trim()}
          className="inline-flex items-center gap-1 px-2.5 py-1.5 rounded bg-sky-500 hover:bg-sky-400 disabled:opacity-50 text-sky-50 text-xs font-medium focus:outline-none focus-visible:ring-2 focus-visible:ring-sky-300"
        >
          {creating ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Plus className="w-3.5 h-3.5" />} Add
        </button>
      </form>
    </div>
  );
}

export default LabelManagerPanel;
