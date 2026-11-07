'use client';

import { useState, useCallback, useEffect, useImperativeHandle, forwardRef } from 'react';
import { motion } from 'framer-motion';
import { Notebook, RotateCcw, Trash2, Share2, Loader2, Pencil, Check, X } from 'lucide-react';
import { lensRun } from '@/lib/api/client';

export interface SavedComputation {
  id: string;
  kind: 'operation' | 'expression' | 'bitwise';
  a?: number | string;
  b?: number | string | null;
  op?: string;
  expression?: string;
  label: string;
  resultGlyph: string | null;
  resultDecimal: number | null;
  createdAt: string;
}

/* The kind of payload the playground accepts on a re-load. */
export interface ReloadPayload {
  kind: 'operation' | 'expression' | 'bitwise';
  a?: string;
  b?: string;
  op?: string;
  expression?: string;
}

export interface NotebookHandle { refresh: () => void; }

interface Props {
  onReload?: (payload: ReloadPayload) => void;
}

/* Saved computation notebook with history re-load + per-entry share/delete.
   Talks to root.history / root.reload / root.deleteComputation / root.share. */
export const ComputationNotebook = forwardRef<NotebookHandle, Props>(function ComputationNotebook(
  { onReload }, ref,
) {
  const [items, setItems] = useState<SavedComputation[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const [confirmId, setConfirmId] = useState<string | null>(null);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [draftLabel, setDraftLabel] = useState('');

  const load = useCallback(async () => {
    setLoading(true); setError('');
    const r = await lensRun<{ computations: SavedComputation[]; total: number }>(
      'root', 'history', { limit: 30 },
    );
    setLoading(false);
    if (r.data?.ok && r.data.result) setItems(r.data.result.computations);
    else setError(r.data?.error || 'Could not load history');
  }, []);

  useEffect(() => { void load(); }, [load]);
  useImperativeHandle(ref, () => ({ refresh: () => { void load(); } }), [load]);

  const reload = useCallback(async (id: string) => {
    setNotice('');
    const r = await lensRun<{ computation: SavedComputation }>('root', 'reload', { id });
    if (r.data?.ok && r.data.result) {
      const c = r.data.result.computation;
      if (c.kind === 'expression') {
        onReload?.({ kind: 'expression', expression: c.expression || '' });
      } else {
        onReload?.({
          kind: c.kind,
          a: c.a != null ? String(c.a) : '',
          b: c.b != null ? String(c.b) : '',
          op: c.op || '+',
        });
      }
      setNotice('Loaded into playground');
    } else setNotice(r.data?.error || 'Reload failed');
  }, [onReload]);

  // Two-step delete (F10, the fleet pattern): the first click arms the
  // button with the entry's name; only the armed click deletes.
  const remove = useCallback(async (c: SavedComputation) => {
    if (confirmId !== c.id) { setConfirmId(c.id); setNotice(''); return; }
    setConfirmId(null); setNotice('');
    const r = await lensRun('root', 'deleteComputation', { id: c.id });
    if (r.data?.ok) { setItems((prev) => prev.filter((x) => x.id !== c.id)); }
    else setNotice(r.data?.error || 'Delete failed');
  }, [confirmId]);

  const rename = useCallback(async (c: SavedComputation) => {
    const label = draftLabel.trim();
    if (!label) { setNotice('A label cannot be empty'); return; }
    setNotice('');
    const r = await lensRun('root', 'renameComputation', { id: c.id, label });
    if (r.data?.ok) {
      setItems((prev) => prev.map((x) => (x.id === c.id ? { ...x, label } : x)));
      setEditingId(null);
      setNotice('Renamed');
    } else setNotice(r.data?.error || 'Rename failed');
  }, [draftLabel]);

  const share = useCallback(async (c: SavedComputation) => {
    setNotice('');
    const r = await lensRun<{ link: string }>('root', 'share', {
      kind: c.kind,
      a: c.a, b: c.b, op: c.op,
      expression: c.expression,
      resultGlyph: c.resultGlyph,
      resultDecimal: c.resultDecimal,
      label: c.label,
    });
    if (r.data?.ok && r.data.result?.link) {
      const url = `${window.location.origin}${r.data.result.link}`;
      try { await navigator.clipboard.writeText(url); setNotice('Share link copied'); }
      catch { setNotice(`Share link: ${url}`); }
    } else setNotice(r.data?.error || 'Share failed');
  }, []);

  return (
    <section className="bg-gray-900 rounded-xl border border-gray-800 p-5">
      <div className="flex items-center justify-between mb-3">
        <div className="flex items-center gap-2">
          <Notebook className="w-4 h-4 text-gray-400" />
          <h2 className="text-sm font-semibold text-gray-300 uppercase tracking-wide">Notebook</h2>
        </div>
        <button onClick={() => void load()}
          className="text-[11px] px-2 py-1 bg-gray-800 hover:bg-gray-700 border border-gray-700 rounded text-gray-400">
          Refresh
        </button>
      </div>
      {loading && (
        <div
          data-testid="notebook-loading"
          role="status"
          aria-live="polite"
          aria-busy="true"
          className="flex items-center gap-2 text-xs text-gray-400"
        >
          <Loader2 className="w-4 h-4 animate-spin" /> Loading…
        </div>
      )}
      {!loading && error && (
        <div
          data-testid="notebook-error"
          role="alert"
          className="flex items-center justify-between gap-3 text-xs text-red-400"
        >
          <span>{error}</span>
          <button
            onClick={() => void load()}
            className="px-2 py-1 bg-red-900/30 hover:bg-red-900/50 border border-red-800 rounded text-red-300 shrink-0"
          >
            Retry
          </button>
        </div>
      )}
      {!loading && !error && items.length === 0 && (
        <div data-testid="notebook-empty" className="text-xs text-gray-400">
          No saved computations yet. Evaluate something and press Save.
        </div>
      )}
      {!loading && !error && items.length > 0 && (
        <ul data-testid="notebook-list" className="space-y-1.5">
          {items.map((c) => (
            <motion.li key={c.id} initial={{ opacity: 0 }} animate={{ opacity: 1 }}
              className="flex items-center gap-2 bg-gray-800/60 rounded-lg px-3 py-2 border border-gray-800">
              <span className="text-[10px] uppercase tracking-wide text-violet-400 w-16 shrink-0">{c.kind}</span>
              {editingId === c.id ? (
                <span className="flex flex-1 items-center gap-1.5">
                  <input
                    className="min-w-0 flex-1 rounded bg-gray-900 border border-gray-700 px-2 py-1 text-xs text-gray-100 focus:outline-none focus:border-violet-500"
                    value={draftLabel}
                    onChange={(e) => setDraftLabel(e.target.value)}
                    onKeyDown={(e) => { if (e.key === 'Enter') void rename(c); if (e.key === 'Escape') setEditingId(null); }}
                    aria-label="Entry label"
                  />
                  <button onClick={() => void rename(c)} className="p-1 text-emerald-400 hover:text-emerald-300" aria-label="Save label">
                    <Check className="w-3.5 h-3.5" />
                  </button>
                  <button onClick={() => setEditingId(null)} className="p-1 text-gray-400 hover:text-gray-200" aria-label="Cancel rename">
                    <X className="w-3.5 h-3.5" />
                  </button>
                </span>
              ) : (
                <span className="flex-1 min-w-0">
                  <span className="block text-xs text-gray-300 font-mono truncate">{c.label}</span>
                  <span className="block text-[10px] text-gray-500">{new Date(c.createdAt).toLocaleString()}</span>
                </span>
              )}
              {c.resultGlyph && <span className="text-sm text-violet-300 shrink-0">{c.resultGlyph}</span>}
              <button onClick={() => { setEditingId(c.id); setDraftLabel(c.label); setConfirmId(null); }} title="Rename entry"
                className="p-1 text-gray-400 hover:text-violet-400" aria-label="Rename computation">
                <Pencil className="w-3.5 h-3.5" />
              </button>
              <button onClick={() => void reload(c.id)} title="Reload into playground"
                className="p-1 text-gray-400 hover:text-violet-400" aria-label="Reload computation">
                <RotateCcw className="w-3.5 h-3.5" />
              </button>
              <button onClick={() => void share(c)} title="Copy share link"
                className="p-1 text-gray-400 hover:text-emerald-400" aria-label="Share computation">
                <Share2 className="w-3.5 h-3.5" />
              </button>
              {confirmId === c.id ? (
                <button onClick={() => void remove(c)}
                  className="px-2 py-1 text-[11px] rounded bg-red-900/40 border border-red-800 text-red-200 shrink-0"
                  aria-label="Delete computation">
                  Delete “{c.label}”?
                </button>
              ) : (
                <button onClick={() => void remove(c)} title="Delete"
                  className="p-1 text-gray-400 hover:text-red-400" aria-label="Delete computation">
                  <Trash2 className="w-3.5 h-3.5" />
                </button>
              )}
            </motion.li>
          ))}
        </ul>
      )}
      {notice && <div className="mt-2 text-[11px] text-emerald-400">{notice}</div>}
    </section>
  );
});
