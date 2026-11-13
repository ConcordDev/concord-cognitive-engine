'use client';

// concord-frontend/components/wallet/WalletCapturesPanel.tsx
//
// FIX-wallet-009: Quick capture (⌘N / the lens toolbar's Quick capture
// tool) files a 'capture' artifact into the wallet lens and toasts
// "Captured successfully" — but no wallet view ever listed that type,
// so a saved note could not be viewed, edited or deleted anywhere
// (only a 'create: <title>' line on the activity timeline). This panel
// is their home in the lens: list + body + edit + delete, all real
// lens API calls (GET/PUT/DELETE /api/lens/wallet) — the same shape
// the productivity lens adopted for the same defect
// (ProductivityCapturesPanel), with edit added.

import { useCallback, useEffect, useState } from 'react';
import { Inbox, Loader2, Pencil, Trash2 } from 'lucide-react';
import { apiHelpers } from '@/lib/api/client';

interface CaptureRow {
  id: string;
  title?: string;
  createdAt?: string;
  data?: { content?: string; capturedAt?: string; source?: string; tags?: string[] };
}

function rowsFrom(data: unknown): CaptureRow[] {
  if (!data || typeof data !== 'object') return [];
  const d = data as { artifacts?: unknown; items?: unknown };
  const rows = Array.isArray(d.artifacts) ? d.artifacts : Array.isArray(d.items) ? d.items : [];
  return (rows as CaptureRow[]).filter((r) => r && typeof r.id === 'string');
}

export function WalletCapturesPanel() {
  const [captures, setCaptures] = useState<CaptureRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [confirming, setConfirming] = useState<string | null>(null);
  const [note, setNote] = useState<string | null>(null);
  const [editing, setEditing] = useState<string | null>(null);
  const [editTitle, setEditTitle] = useState('');
  const [editContent, setEditContent] = useState('');
  const [saving, setSaving] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const r = await apiHelpers.lens.list('wallet', { type: 'capture', limit: 100 });
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
      await apiHelpers.lens.delete('wallet', id);
      setCaptures((prev) => prev.filter((c) => c.id !== id));
      setNote('Capture deleted.');
    } catch {
      setNote('That capture could not be deleted — try again.');
    } finally {
      setConfirming(null);
    }
  };

  const startEdit = (c: CaptureRow) => {
    setEditing(c.id);
    setEditTitle(c.title || '');
    setEditContent(c.data?.content || '');
    setNote(null);
  };

  const saveEdit = async (c: CaptureRow) => {
    setSaving(true);
    try {
      await apiHelpers.lens.update('wallet', c.id, {
        title: editTitle.trim() || editContent.slice(0, 80),
        data: { ...(c.data || {}), content: editContent },
      });
      setCaptures((prev) => prev.map((x) => (x.id === c.id
        ? { ...x, title: editTitle.trim() || editContent.slice(0, 80), data: { ...(x.data || {}), content: editContent } }
        : x)));
      setEditing(null);
      setNote('Capture updated.');
    } catch {
      setNote('That capture could not be updated — try again.');
    } finally {
      setSaving(false);
    }
  };

  if (loading) {
    return <div className="flex items-center justify-center py-6 text-zinc-400"><Loader2 className="w-4 h-4 animate-spin" /></div>;
  }
  return (
    <div className="space-y-3">
      <h3 className="text-sm font-semibold text-gray-100">Quick captures</h3>
      <p className="text-xs text-zinc-400">
        Everything filed from <span className="text-zinc-200">Quick capture</span> (⌘N) in this lens lands here — view, edit or delete it.
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
            {editing === c.id ? (
              <div className="space-y-2">
                <input
                  value={editTitle}
                  onChange={(e) => setEditTitle(e.target.value)}
                  maxLength={200}
                  placeholder="Title"
                  aria-label="Capture title"
                  className="w-full rounded border border-lattice-border bg-lattice-surface px-2 py-1.5 text-sm text-white focus:outline-none"
                />
                <textarea
                  value={editContent}
                  onChange={(e) => setEditContent(e.target.value)}
                  rows={4}
                  aria-label="Capture note"
                  className="w-full rounded border border-lattice-border bg-lattice-surface px-2 py-1.5 text-sm text-white focus:outline-none"
                />
                <div className="flex gap-2">
                  <button type="button" disabled={saving} onClick={() => void saveEdit(c)} className="rounded bg-cyan-500/20 px-2 py-1 text-[11px] text-cyan-200 hover:bg-cyan-500/30 disabled:opacity-50">Save</button>
                  <button type="button" onClick={() => setEditing(null)} className="rounded bg-zinc-700/40 px-2 py-1 text-[11px] text-zinc-300">Cancel</button>
                </div>
              </div>
            ) : (
              <div className="flex items-start justify-between gap-2">
                <div className="min-w-0 flex-1">
                  <p className="text-sm text-zinc-100">{c.title || 'Untitled capture'}</p>
                  {c.data?.content && <p className="mt-0.5 whitespace-pre-wrap text-xs text-zinc-400">{c.data.content}</p>}
                  <p className="mt-1 text-[10px] text-zinc-400">
                    {new Date(c.data?.capturedAt || c.createdAt || '').toLocaleString()}
                  </p>
                </div>
                <span className="flex shrink-0 gap-1">
                  <button type="button" aria-label={`Edit capture ${c.title || ''}`} onClick={() => startEdit(c)}
                    className="p-1 text-zinc-400 opacity-0 hover:text-cyan-300 group-hover:opacity-100">
                    <Pencil className="h-3.5 w-3.5" aria-hidden />
                  </button>
                  {confirming === c.id ? (
                    <>
                      <button type="button" onClick={() => void del(c.id)} className="rounded bg-rose-600/30 px-1.5 py-0.5 text-[10px] text-rose-200 hover:bg-rose-600/50">Delete?</button>
                      <button type="button" onClick={() => setConfirming(null)} className="rounded bg-zinc-700/40 px-1.5 py-0.5 text-[10px] text-zinc-300">Keep</button>
                    </>
                  ) : (
                    <button type="button" aria-label={`Delete capture ${c.title || ''}`} onClick={() => setConfirming(c.id)}
                      className="p-1 text-zinc-400 opacity-0 hover:text-rose-300 group-hover:opacity-100">
                      <Trash2 className="h-3.5 w-3.5" aria-hidden />
                    </button>
                  )}
                </span>
              </div>
            )}
          </li>
        ))}
      </ul>
    </div>
  );
}
