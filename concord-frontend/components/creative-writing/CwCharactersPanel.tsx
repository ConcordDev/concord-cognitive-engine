'use client';

/**
 * CwCharactersPanel — character profiles with role, description and arc.
 */

import { useCallback, useEffect, useState } from 'react';
import { Loader2, Plus, Trash2, User } from 'lucide-react';
import { lensRun } from '@/lib/api/client';
import { cn } from '@/lib/utils';

interface Character {
  id: string; name: string; role: string; description: string | null; arc: string | null;
}

const ROLES = ['protagonist', 'antagonist', 'supporting', 'minor'];
const ROLE_COLOR: Record<string, string> = {
  protagonist: 'text-emerald-400', antagonist: 'text-rose-400',
  supporting: 'text-sky-400', minor: 'text-zinc-500',
};

export function CwCharactersPanel({ projectId, onChange }: { projectId: string; onChange: () => void }) {
  const [characters, setCharacters] = useState<Character[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [form, setForm] = useState({ name: '', role: 'supporting', description: '', arc: '' });
  const [expanded, setExpanded] = useState<string | null>(null);

  const refresh = useCallback(async () => {
    setLoading(true);
    const r = await lensRun('creative-writing', 'character-list', { projectId });
    setCharacters(r.data?.result?.characters || []);
    setLoading(false);
    onChange();
  }, [projectId, onChange]);

  useEffect(() => { void refresh(); }, [refresh]);

  const addCharacter = async () => {
    if (!form.name.trim()) { setError('Character name is required.'); return; }
    const r = await lensRun('creative-writing', 'character-add', {
      projectId, name: form.name.trim(), role: form.role,
      description: form.description.trim(), arc: form.arc.trim(),
    });
    if (r.data?.ok === false) { setError(r.data?.error || 'Failed'); return; }
    setForm({ name: '', role: 'supporting', description: '', arc: '' });
    setError(null);
    await refresh();
  };

  const delCharacter = async (id: string) => {
    await lensRun('creative-writing', 'character-delete', { characterId: id });
    await refresh();
  };

  if (loading) {
    return <div className="flex items-center justify-center py-10 text-zinc-500"><Loader2 className="w-5 h-5 animate-spin" /></div>;
  }

  return (
    <div className="space-y-4">
      {error && <div className="text-xs text-rose-400 bg-rose-950/40 border border-rose-900/50 rounded-lg px-3 py-2">{error}</div>}

      <section className="bg-zinc-900/70 border border-zinc-800 rounded-xl p-3 space-y-2">
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-2">
          <input placeholder="Name" value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })}
            className="bg-zinc-950 border border-zinc-700 rounded-lg px-2 py-1.5 text-xs text-zinc-100" />
          <select value={form.role} onChange={(e) => setForm({ ...form, role: e.target.value })}
            className="bg-zinc-950 border border-zinc-700 rounded-lg px-2 py-1.5 text-xs text-zinc-100 capitalize">
            {ROLES.map((r) => <option key={r} value={r}>{r}</option>)}
          </select>
          <input placeholder="Short description" value={form.description}
            onChange={(e) => setForm({ ...form, description: e.target.value })}
            className="col-span-2 bg-zinc-950 border border-zinc-700 rounded-lg px-2 py-1.5 text-xs text-zinc-100" />
        </div>
        <div className="flex items-center gap-2">
          <input placeholder="Character arc" value={form.arc} onChange={(e) => setForm({ ...form, arc: e.target.value })}
            className="flex-1 bg-zinc-950 border border-zinc-700 rounded-lg px-2 py-1.5 text-xs text-zinc-100" />
          <button type="button" onClick={addCharacter}
            className="flex items-center gap-1 px-3 py-1.5 text-xs font-medium bg-amber-600 hover:bg-amber-500 text-white rounded-lg">
            <Plus className="w-3.5 h-3.5" /> Character
          </button>
        </div>
      </section>

      {characters.length === 0 ? (
        <p className="text-[11px] text-zinc-500 italic py-6 text-center">No characters yet.</p>
      ) : (
        <ul className="space-y-2">
          {characters.map((c) => (
            <li key={c.id} className="bg-zinc-900/70 border border-zinc-800 rounded-xl p-3">
              <div className="flex items-center gap-2">
                <User className="w-4 h-4 text-amber-400 shrink-0" />
                <button type="button" onClick={() => setExpanded(expanded === c.id ? null : c.id)}
                  className="flex-1 text-left">
                  <span className="text-sm font-semibold text-zinc-100">{c.name}</span>
                  <span className={cn('ml-2 text-[10px] uppercase', ROLE_COLOR[c.role])}>{c.role}</span>
                </button>
                <button type="button" onClick={() => delCharacter(c.id)} className="text-zinc-600 hover:text-rose-400">
                  <Trash2 className="w-3.5 h-3.5" />
                </button>
              </div>
              {c.description && <p className="text-[11px] text-zinc-400 mt-1">{c.description}</p>}
              {expanded === c.id && c.arc && (
                <div className="mt-2 pt-2 border-t border-zinc-800">
                  <p className="text-[10px] font-semibold text-zinc-500 uppercase mb-0.5">Arc</p>
                  <p className="text-[11px] text-zinc-300">{c.arc}</p>
                </div>
              )}
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
