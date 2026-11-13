'use client';

// concord-frontend/components/productivity/ProductivityCapturesPanel.tsx
//
// FIX-productivity-006 (GB-1521 slice B6): Quick capture (⌘N / the
// toolbar's Quick capture tool) files a 'capture' artifact into the
// lens it was opened from and toasts "Captured successfully" — but no
// Productivity view ever listed that type, so captures were invisible
// everywhere except the export, and nothing could delete one. This
// tab is their home in the lens: list + delete, both real lens API
// calls (GET/DELETE /api/lens/productivity).

import { useCallback, useEffect, useState } from 'react';
import { Inbox, Loader2, Trash2 } from 'lucide-react';
import { apiHelpers } from '@/lib/api/client';

interface CaptureRow {
  id: string;
  title?: string;
  createdAt?: string;
  data?: { content?: string; capturedAt?: string };
}

function rowsFrom(data: unknown): CaptureRow[] {
  if (!data || typeof data !== 'object') return [];
  const d = data as { artifacts?: unknown; items?: unknown };
  const rows = Array.isArray(d.artifacts) ? d.artifacts : Array.isArray(d.items) ? d.items : [];
  return (rows as CaptureRow[]).filter((r) => r && typeof r.id === 'string');
}

export function ProductivityCapturesPanel() {
  const [captures, setCaptures] = useState<CaptureRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [confirming, setConfirming] = useState<string | null>(null);
  const [note, setNote] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const r = await apiHelpers.lens.list('productivity', { type: 'capture', limit: 100 });
      setCaptures(rowsFrom(r.data));
    } catch {
      setError('Your captures could not be loaded — try again.');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { void load(); }, [load]);

  const del = async (id: string) => {
    try {
      await apiHelpers.lens.delete('productivity', id);
      setCaptures((prev) => prev.filter((c) => c.id !== id));
      setNote('Capture deleted.');
    } catch {
      setNote('That capture could not be deleted — try again.');
    } finally {
      setConfirming(null);
    }
  };

  if (loading) {
    return <div className="flex items-center justify-center py-6 text-zinc-400"><Loader2 className="w-4 h-4 animate-spin" /></div>;
  }
  return (
    <div className="space-y-3">
      <p className="text-xs text-zinc-400">
        Everything filed from <span className="text-zinc-200">Quick capture</span> (⌘N) in this lens lands here.
      </p>
      {error && <p role="alert" className="text-xs text-rose-300">{error}</p>}
      {note && <p role="status" className="text-xs text-emerald-300">{note}</p>}
      {captures.length === 0 && !error && (
        <p className="flex items-center gap-2 py-6 text-center text-xs italic text-zinc-400">
          <Inbox className="h-4 w-4" aria-hidden /> No captures yet — press ⌘N or use Quick capture in the lens tools to file one.
        </p>
      )}
      <ul className="space-y-2">
        {captures.map((c) => (
          <li key={c.id} className="group rounded-lg border border-white/10 bg-black/20 p-3">
            <div className="flex items-start justify-between gap-2">
              <div className="min-w-0 flex-1">
                <p className="text-sm text-zinc-100">{c.title || 'Untitled capture'}</p>
                {c.data?.content && <p className="mt-0.5 whitespace-pre-wrap text-xs text-zinc-400">{c.data.content}</p>}
                <p className="mt-1 text-[10px] text-zinc-500">
                  {new Date(c.data?.capturedAt || c.createdAt || '').toLocaleString()}
                </p>
              </div>
              {confirming === c.id ? (
                <span className="flex shrink-0 gap-1">
                  <button type="button" onClick={() => void del(c.id)} className="rounded bg-rose-600/30 px-1.5 py-0.5 text-[10px] text-rose-200 hover:bg-rose-600/50">Delete?</button>
                  <button type="button" onClick={() => setConfirming(null)} className="rounded bg-zinc-700/40 px-1.5 py-0.5 text-[10px] text-zinc-300">Keep</button>
                </span>
              ) : (
                <button type="button" aria-label={`Delete capture ${c.title || ''}`} onClick={() => setConfirming(c.id)}
                  className="shrink-0 p-1 text-zinc-500 opacity-0 hover:text-rose-300 group-hover:opacity-100">
                  <Trash2 className="h-3.5 w-3.5" aria-hidden />
                </button>
              )}
            </div>
          </li>
        ))}
      </ul>
    </div>
  );
}
