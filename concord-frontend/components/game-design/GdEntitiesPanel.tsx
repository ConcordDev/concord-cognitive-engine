'use client';

/**
 * GdEntitiesPanel — the game's entity roster with combat stats.
 */

import { useCallback, useEffect, useState } from 'react';
import { Loader2, Plus, Trash2, Heart, Swords, Wind } from 'lucide-react';
import { lensRun } from '@/lib/api/client';
import { cn } from '@/lib/utils';

interface Entity {
  id: string; name: string; kind: string; health: number; damage: number;
  speed: number; description: string | null;
}

const KINDS = ['player', 'enemy', 'boss', 'npc', 'item', 'prop'];
const KIND_COLOR: Record<string, string> = {
  player: 'text-lime-400', enemy: 'text-rose-400', boss: 'text-red-500',
  npc: 'text-sky-400', item: 'text-amber-400', prop: 'text-zinc-500',
};

export function GdEntitiesPanel({ gameId, onChange }: { gameId: string; onChange: () => void }) {
  const [entities, setEntities] = useState<Entity[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [form, setForm] = useState({ name: '', kind: 'enemy', health: '', damage: '', speed: '', description: '' });

  const refresh = useCallback(async () => {
    setLoading(true);
    const r = await lensRun('game-design', 'game-get', { id: gameId });
    setEntities(r.data?.result?.entities || []);
    setLoading(false);
    onChange();
  }, [gameId, onChange]);

  useEffect(() => { void refresh(); }, [refresh]);

  const addEntity = async () => {
    if (!form.name.trim()) { setError('Entity name is required.'); return; }
    const r = await lensRun('game-design', 'entity-add', {
      gameId, name: form.name.trim(), kind: form.kind,
      health: Number(form.health) || 0, damage: Number(form.damage) || 0, speed: Number(form.speed) || 0,
      description: form.description.trim(),
    });
    if (r.data?.ok === false) { setError(r.data?.error || 'Failed'); return; }
    setForm({ name: '', kind: 'enemy', health: '', damage: '', speed: '', description: '' });
    setError(null);
    await refresh();
  };

  const delEntity = async (id: string) => {
    await lensRun('game-design', 'entity-delete', { id });
    await refresh();
  };

  if (loading) {
    return <div className="flex items-center justify-center py-10 text-zinc-500"><Loader2 className="w-5 h-5 animate-spin" /></div>;
  }

  return (
    <div className="space-y-4">
      {error && <div className="text-xs text-rose-400 bg-rose-950/40 border border-rose-900/50 rounded-lg px-3 py-2">{error}</div>}

      <section className="bg-zinc-900/70 border border-zinc-800 rounded-xl p-3 space-y-2">
        <div className="grid grid-cols-2 sm:grid-cols-5 gap-2">
          <input placeholder="Name" value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })}
            className="bg-zinc-950 border border-zinc-700 rounded-lg px-2 py-1.5 text-xs text-zinc-100" />
          <select value={form.kind} onChange={(e) => setForm({ ...form, kind: e.target.value })}
            className="bg-zinc-950 border border-zinc-700 rounded-lg px-2 py-1.5 text-xs text-zinc-100 capitalize">
            {KINDS.map((k) => <option key={k} value={k}>{k}</option>)}
          </select>
          <input placeholder="HP" inputMode="numeric" value={form.health}
            onChange={(e) => setForm({ ...form, health: e.target.value })}
            className="bg-zinc-950 border border-zinc-700 rounded-lg px-2 py-1.5 text-xs text-zinc-100" />
          <input placeholder="DMG" inputMode="numeric" value={form.damage}
            onChange={(e) => setForm({ ...form, damage: e.target.value })}
            className="bg-zinc-950 border border-zinc-700 rounded-lg px-2 py-1.5 text-xs text-zinc-100" />
          <input placeholder="SPD" inputMode="numeric" value={form.speed}
            onChange={(e) => setForm({ ...form, speed: e.target.value })}
            className="bg-zinc-950 border border-zinc-700 rounded-lg px-2 py-1.5 text-xs text-zinc-100" />
        </div>
        <div className="flex items-center gap-2">
          <input placeholder="Description" value={form.description}
            onChange={(e) => setForm({ ...form, description: e.target.value })}
            className="flex-1 bg-zinc-950 border border-zinc-700 rounded-lg px-2 py-1.5 text-xs text-zinc-100" />
          <button type="button" onClick={addEntity}
            className="flex items-center gap-1 px-3 py-1.5 text-xs font-medium bg-lime-600 hover:bg-lime-500 text-white rounded-lg">
            <Plus className="w-3.5 h-3.5" /> Entity
          </button>
        </div>
      </section>

      {entities.length === 0 ? (
        <p className="text-[11px] text-zinc-500 italic py-6 text-center">No entities yet.</p>
      ) : (
        <ul className="space-y-1.5">
          {entities.map((e) => (
            <li key={e.id} className="bg-zinc-900/70 border border-zinc-800 rounded-xl p-3">
              <div className="flex items-center gap-2">
                <span className="text-sm font-semibold text-zinc-100">{e.name}</span>
                <span className={cn('text-[10px] uppercase', KIND_COLOR[e.kind])}>{e.kind}</span>
                <div className="flex-1" />
                <span className="flex items-center gap-1 text-[11px] text-zinc-400"><Heart className="w-3 h-3 text-rose-400" />{e.health}</span>
                <span className="flex items-center gap-1 text-[11px] text-zinc-400"><Swords className="w-3 h-3 text-amber-400" />{e.damage}</span>
                <span className="flex items-center gap-1 text-[11px] text-zinc-400"><Wind className="w-3 h-3 text-sky-400" />{e.speed}</span>
                <button type="button" onClick={() => delEntity(e.id)} className="text-zinc-600 hover:text-rose-400">
                  <Trash2 className="w-3.5 h-3.5" />
                </button>
              </div>
              {e.description && <p className="text-[11px] text-zinc-400 mt-1">{e.description}</p>}
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
