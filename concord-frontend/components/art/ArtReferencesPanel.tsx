'use client';

/**
 * ArtReferencesPanel — reference image boards for studies and mood.
 */

import { useCallback, useEffect, useState } from 'react';
import { Loader2, Plus, Trash2, Image as ImageIcon } from 'lucide-react';
import { lensRun } from '@/lib/api/client';

interface Ref { id: string; imageUrl: string; note: string | null }
interface Board { id: string; name: string; refs: Ref[] }

export function ArtReferencesPanel() {
  const [boards, setBoards] = useState<Board[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [boardName, setBoardName] = useState('');
  const [refForm, setRefForm] = useState<Record<string, { url: string; note: string }>>({});

  const refresh = useCallback(async () => {
    const r = await lensRun('art', 'reference-board-list', {});
    if (r.data?.ok === false) {
      setError(r.data?.error || 'Could not load reference boards.');
      setLoading(false);
      return;
    }
    setError(null);
    setBoards(r.data?.result?.boards || []);
    setLoading(false);
  }, []);

  useEffect(() => { void refresh(); }, [refresh]);

  const addBoard = async () => {
    if (!boardName.trim()) { setError('Board name is required.'); return; }
    const r = await lensRun('art', 'reference-board-create', { name: boardName.trim() });
    if (r.data?.ok === false) { setError(r.data?.error || 'Failed'); return; }
    setBoardName('');
    setError(null);
    await refresh();
  };

  const delBoard = async (id: string) => {
    await lensRun('art', 'reference-board-delete', { id });
    await refresh();
  };

  const addRef = async (boardId: string) => {
    const f = refForm[boardId] || { url: '', note: '' };
    if (!f.url.trim()) return;
    const r = await lensRun('art', 'reference-add', { boardId, imageUrl: f.url.trim(), note: f.note.trim() });
    if (r.data?.ok === false) { setError(r.data?.error || 'Failed'); return; }
    setRefForm((p) => ({ ...p, [boardId]: { url: '', note: '' } }));
    setError(null);
    await refresh();
  };

  const removeRef = async (boardId: string, refId: string) => {
    await lensRun('art', 'reference-remove', { boardId, refId });
    await refresh();
  };

  if (loading) {
    return <div className="flex items-center justify-center py-10 text-[color:var(--at-muted)]"><Loader2 className="w-5 h-5 animate-spin" /></div>;
  }

  return (
    <div className="space-y-4">
      {error && <div className="text-xs text-[color:var(--at-bad)] bg-[var(--at-bad-soft)] border border-[color:var(--at-bad)] rounded-lg px-3 py-2">{error}</div>}

      <div className="flex items-center gap-2">
        <input placeholder="New reference board" value={boardName} onChange={(e) => setBoardName(e.target.value)}
          className="flex-1 bg-[var(--at-sunk)] border border-[color:var(--at-rule-2)] rounded-lg px-2 py-1.5 text-xs text-[color:var(--at-ink)]" />
        <button type="button" onClick={addBoard}
          className="flex items-center gap-1 px-3 py-1.5 text-xs font-medium bg-[var(--at-accent)] hover:bg-[var(--at-accent)] text-[color:var(--at-accent-ink)] rounded-lg">
          <Plus className="w-3.5 h-3.5" /> Board
        </button>
      </div>

      {boards.length === 0 ? (
        <p className="text-[11px] text-[color:var(--at-muted)] italic py-6 text-center">No reference boards yet.</p>
      ) : (
        boards.map((b) => {
          const f = refForm[b.id] || { url: '', note: '' };
          return (
            <section key={b.id} className="bg-[var(--at-gesso)] border border-[color:var(--at-rule)] rounded-xl p-3">
              <div className="flex items-center justify-between mb-2">
                <h3 className="flex items-center gap-1 text-xs font-semibold text-[color:var(--at-ink-2)]">
                  <ImageIcon className="w-3.5 h-3.5 text-[color:var(--at-accent-text)]" /> {b.name}
                </h3>
                <button aria-label="Delete" type="button" onClick={() => delBoard(b.id)} className="text-[color:var(--at-faint)] hover:text-[color:var(--at-bad)]">
                  <Trash2 className="w-3.5 h-3.5" />
                </button>
              </div>
              <div className="flex items-center gap-2 mb-2">
                <input placeholder="Image URL (https://…)" value={f.url}
                  onChange={(e) => setRefForm((p) => ({ ...p, [b.id]: { ...f, url: e.target.value } }))}
                  className="flex-1 bg-[var(--at-sunk)] border border-[color:var(--at-rule-2)] rounded-lg px-2 py-1.5 text-xs text-[color:var(--at-ink)]" />
                <input placeholder="Note" value={f.note}
                  onChange={(e) => setRefForm((p) => ({ ...p, [b.id]: { ...f, note: e.target.value } }))}
                  className="w-28 bg-[var(--at-sunk)] border border-[color:var(--at-rule-2)] rounded-lg px-2 py-1.5 text-xs text-[color:var(--at-ink)]" />
                <button type="button" onClick={() => addRef(b.id)}
                  className="px-2.5 py-1.5 text-xs bg-[var(--at-raised)] hover:bg-[var(--at-press)] text-[color:var(--at-ink)] rounded-lg">Add</button>
              </div>
              {b.refs.length === 0 ? (
                <p className="text-[10px] text-[color:var(--at-muted)] italic">No references on this board.</p>
              ) : (
                <div className="grid grid-cols-3 gap-2">
                  {b.refs.map((r) => (
                    <div key={r.id} className="group relative">
                      {/* eslint-disable-next-line @next/next/no-img-element */}
                      <img src={r.imageUrl} alt={r.note || 'reference'}
                        className="w-full aspect-square object-cover rounded-lg border border-[color:var(--at-rule-2)]" />
                      <button aria-label="Delete" type="button" onClick={() => removeRef(b.id, r.id)}
                        className="absolute top-1 right-1 bg-[var(--at-ink)] text-[color:var(--at-accent-ink)] hover:text-[color:var(--at-bad)] rounded p-0.5 opacity-0 group-hover:opacity-100">
                        <Trash2 className="w-3 h-3" />
                      </button>
                      {r.note && <p className="text-[9px] text-[color:var(--at-muted)] mt-0.5 truncate">{r.note}</p>}
                    </div>
                  ))}
                </div>
              )}
            </section>
          );
        })
      )}
    </div>
  );
}
