'use client';

/**
 * GdMechanicsPanel — the game's mechanics list, grouped by category.
 */

import { useCallback, useEffect, useState } from 'react';
import { Loader2, Plus, Trash2, Cog, Pencil, Check, X } from 'lucide-react';
import { lensRun } from '@/lib/api/client';
import { cn } from '@/lib/utils';
import { ErrorState } from '@/components/ui';

interface Mechanic { id: string; name: string; category: string; description: string | null }

const CATS = ['core', 'progression', 'combat', 'economy', 'social', 'exploration'];
const CAT_COLOR: Record<string, string> = {
  core: 'text-lime-400', progression: 'text-sky-400', combat: 'text-rose-400',
  economy: 'text-amber-400', social: 'text-violet-400', exploration: 'text-emerald-400',
};

export function GdMechanicsPanel({ gameId, onChange }: { gameId: string; onChange: () => void }) {
  const [mechanics, setMechanics] = useState<Mechanic[]>([]);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [form, setForm] = useState({ name: '', category: 'core', description: '' });
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editForm, setEditForm] = useState({ name: '', category: 'core', description: '' });

  const refresh = useCallback(async () => {
    setLoading(true);
    const r = await lensRun('game-design', 'game-get', { id: gameId });
    if (r.data?.ok === false) {
      setLoadError(r.data?.error || 'Could not load mechanics.');
      setLoading(false);
      return;
    }
    setLoadError(null);
    setMechanics(r.data?.result?.mechanics || []);
    setLoading(false);
    onChange();
  }, [gameId, onChange]);

  useEffect(() => { void refresh(); }, [refresh]);

  const addMechanic = async () => {
    if (!form.name.trim()) { setError('Mechanic name is required.'); return; }
    const r = await lensRun('game-design', 'mechanic-add', {
      gameId, name: form.name.trim(), category: form.category, description: form.description.trim(),
    });
    if (r.data?.ok === false) { setError(r.data?.error || 'Failed'); return; }
    setForm({ name: '', category: 'core', description: '' });
    setError(null);
    await refresh();
  };

  const delMechanic = async (id: string) => {
    await lensRun('game-design', 'mechanic-delete', { id });
    await refresh();
  };

  const startEdit = (m: Mechanic) => {
    setEditingId(m.id);
    setEditForm({ name: m.name, category: m.category, description: m.description || '' });
  };

  const saveEdit = async (id: string) => {
    if (!editForm.name.trim()) return;
    const r = await lensRun('game-design', 'mechanic-update', {
      id, name: editForm.name.trim(), category: editForm.category, description: editForm.description.trim(),
    });
    if (r.data?.ok === false) { setError(r.data?.error || 'Failed'); return; }
    setEditingId(null);
    setError(null);
    await refresh();
  };

  if (loading) {
    return <div className="flex items-center justify-center py-10 text-zinc-400"><Loader2 className="w-5 h-5 animate-spin" /></div>;
  }

  if (loadError) {
    return <div className="p-4"><ErrorState message={loadError} onRetry={refresh} /></div>;
  }

  return (
    <div className="space-y-4">
      {error && <div className="text-xs text-rose-400 bg-rose-950/40 border border-rose-900/50 rounded-lg px-3 py-2">{error}</div>}

      <section className="bg-zinc-900/70 border border-zinc-800 rounded-xl p-3 space-y-2">
        <div className="grid grid-cols-2 sm:grid-cols-3 gap-2">
          <input placeholder="Mechanic name" value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })}
            className="bg-zinc-950 border border-zinc-700 rounded-lg px-2 py-1.5 text-xs text-zinc-100" />
          <select value={form.category} onChange={(e) => setForm({ ...form, category: e.target.value })}
            className="bg-zinc-950 border border-zinc-700 rounded-lg px-2 py-1.5 text-xs text-zinc-100 capitalize">
            {CATS.map((c) => <option key={c} value={c}>{c}</option>)}
          </select>
          <button type="button" onClick={addMechanic}
            className="flex items-center justify-center gap-1 bg-lime-600 hover:bg-lime-500 text-white text-xs font-medium rounded-lg">
            <Plus className="w-3.5 h-3.5" /> Add
          </button>
        </div>
        <input placeholder="Description (optional)" value={form.description}
          onChange={(e) => setForm({ ...form, description: e.target.value })}
          className="w-full bg-zinc-950 border border-zinc-700 rounded-lg px-2 py-1.5 text-xs text-zinc-100" />
      </section>

      {mechanics.length === 0 ? (
        <p className="text-[11px] text-zinc-400 italic py-6 text-center">No mechanics defined yet.</p>
      ) : (
        CATS.filter((c) => mechanics.some((m) => m.category === c)).map((cat) => (
          <section key={cat}>
            <h3 className={cn('text-xs font-semibold mb-1.5 capitalize', CAT_COLOR[cat])}>{cat}</h3>
            <ul className="space-y-1.5">
              {mechanics.filter((m) => m.category === cat).map((m) => (
                <li key={m.id} className="bg-zinc-900/70 border border-zinc-800 rounded-lg px-3 py-2">
                  {editingId === m.id ? (
                    <div className="space-y-1.5">
                      <div className="grid grid-cols-2 gap-1.5">
                        <input value={editForm.name} onChange={(e) => setEditForm({ ...editForm, name: e.target.value })}
                          className="bg-zinc-950 border border-zinc-700 rounded-lg px-2 py-1 text-[11px] text-zinc-100" />
                        <select value={editForm.category} onChange={(e) => setEditForm({ ...editForm, category: e.target.value })}
                          className="bg-zinc-950 border border-zinc-700 rounded-lg px-2 py-1 text-[11px] text-zinc-100 capitalize">
                          {CATS.map((c) => <option key={c} value={c}>{c}</option>)}
                        </select>
                      </div>
                      <input value={editForm.description} onChange={(e) => setEditForm({ ...editForm, description: e.target.value })}
                        placeholder="Description" className="w-full bg-zinc-950 border border-zinc-700 rounded-lg px-2 py-1 text-[11px] text-zinc-100" />
                      <div className="flex items-center gap-1.5">
                        <button type="button" onClick={() => saveEdit(m.id)} disabled={!editForm.name.trim()}
                          className="flex items-center gap-1 px-2 py-1 text-[11px] bg-lime-600 hover:bg-lime-500 disabled:opacity-50 text-white rounded-lg">
                          <Check className="w-3 h-3" /> Save
                        </button>
                        <button type="button" onClick={() => setEditingId(null)}
                          className="flex items-center gap-1 px-2 py-1 text-[11px] bg-zinc-800 hover:bg-zinc-700 text-zinc-200 rounded-lg">
                          <X className="w-3 h-3" /> Cancel
                        </button>
                      </div>
                    </div>
                  ) : (
                    <div className="flex items-start gap-2">
                      <Cog className="w-3.5 h-3.5 text-zinc-400 mt-0.5 shrink-0" />
                      <div className="flex-1 min-w-0">
                        <p className="text-xs font-medium text-zinc-100">{m.name}</p>
                        {m.description && <p className="text-[11px] text-zinc-400">{m.description}</p>}
                      </div>
                      <button aria-label="Edit" type="button" onClick={() => startEdit(m)} className="text-zinc-600 hover:text-lime-400 shrink-0">
                        <Pencil className="w-3.5 h-3.5" />
                      </button>
                      <button aria-label="Delete" type="button" onClick={() => delMechanic(m.id)} className="text-zinc-600 hover:text-rose-400 shrink-0">
                        <Trash2 className="w-3.5 h-3.5" />
                      </button>
                    </div>
                  )}
                </li>
              ))}
            </ul>
          </section>
        ))
      )}
    </div>
  );
}
