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
  supporting: 'text-sky-400', minor: 'text-zinc-400',
};

export function CwCharactersPanel({ projectId, onChange }: { projectId: string; onChange: () => void }) {
  const [characters, setCharacters] = useState<Character[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [form, setForm] = useState({ name: '', role: 'supporting', description: '', arc: '' });
  const [relationships, setRelationships] = useState<{ id: string; kind: string; fromName: string; toName: string }[]>([]);
  const [relForm, setRelForm] = useState({ fromId: '', toId: '', kind: 'friend' });
  const [expanded, setExpanded] = useState<string | null>(null);

  const refresh = useCallback(async () => {
    setLoading(true);
    const [r, rels] = await Promise.all([
      lensRun('creative-writing', 'character-list', { projectId }),
      lensRun('creative-writing', 'character-relationships', { projectId }),
    ]);
    setCharacters(r.data?.result?.characters || []);
    setRelationships(rels.data?.result?.relationships || []);
    setLoading(false);
    onChange();
  }, [projectId, onChange]);

  const addRelation = async () => {
    if (!relForm.fromId || !relForm.toId || relForm.fromId === relForm.toId) return;
    await lensRun('creative-writing', 'character-relate', {
      fromId: relForm.fromId, toId: relForm.toId, kind: relForm.kind,
    });
    setRelForm({ fromId: '', toId: '', kind: 'friend' });
    await refresh();
  };

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
    return <div className="flex items-center justify-center py-10 text-zinc-400"><Loader2 className="w-5 h-5 animate-spin" /></div>;
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
        <p className="text-[11px] text-zinc-400 italic py-6 text-center">No characters yet.</p>
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
                <button aria-label="Delete" type="button" onClick={() => delCharacter(c.id)} className="text-zinc-600 hover:text-rose-400">
                  <Trash2 className="w-3.5 h-3.5" />
                </button>
              </div>
              {c.description && <p className="text-[11px] text-zinc-400 mt-1">{c.description}</p>}
              {expanded === c.id && c.arc && (
                <div className="mt-2 pt-2 border-t border-zinc-800">
                  <p className="text-[10px] font-semibold text-zinc-400 uppercase mb-0.5">Arc</p>
                  <p className="text-[11px] text-zinc-300">{c.arc}</p>
                </div>
              )}
            </li>
          ))}
        </ul>
      )}

      {/* Relationships */}
      {characters.length >= 2 && (
        <section>
          <h3 className="text-xs font-semibold text-zinc-300 mb-2">Relationships</h3>
          <div className="flex flex-wrap items-center gap-2 mb-2">
            <select value={relForm.fromId} onChange={(e) => setRelForm({ ...relForm, fromId: e.target.value })}
              className="bg-zinc-950 border border-zinc-700 rounded-lg px-2 py-1.5 text-xs text-zinc-100">
              <option value="">Character…</option>
              {characters.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
            </select>
            <select value={relForm.kind} onChange={(e) => setRelForm({ ...relForm, kind: e.target.value })}
              className="bg-zinc-950 border border-zinc-700 rounded-lg px-2 py-1.5 text-xs text-zinc-100">
              {['family', 'romance', 'friend', 'rival', 'mentor', 'ally', 'enemy', 'other'].map((k) => <option key={k} value={k}>{k}</option>)}
            </select>
            <select value={relForm.toId} onChange={(e) => setRelForm({ ...relForm, toId: e.target.value })}
              className="bg-zinc-950 border border-zinc-700 rounded-lg px-2 py-1.5 text-xs text-zinc-100">
              <option value="">Character…</option>
              {characters.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
            </select>
            <button type="button" onClick={addRelation}
              className="px-3 py-1.5 text-xs font-medium bg-amber-600 hover:bg-amber-500 text-white rounded-lg">Relate</button>
          </div>
          {relationships.length > 0 && (
            <ul className="space-y-1">
              {relationships.map((r) => (
                <li key={r.id} className="flex items-center gap-2 bg-zinc-900/70 border border-zinc-800 rounded-lg px-3 py-1.5 text-xs">
                  <span className="text-zinc-200">{r.fromName}</span>
                  <span className="text-amber-400">— {r.kind} →</span>
                  <span className="text-zinc-200 flex-1">{r.toName}</span>
                  <button aria-label="Delete" type="button"
                    onClick={() => lensRun('creative-writing', 'character-unrelate', { id: r.id }).then(refresh)}
                    className="text-zinc-600 hover:text-rose-400"><Trash2 className="w-3.5 h-3.5" /></button>
                </li>
              ))}
            </ul>
          )}
        </section>
      )}
    </div>
  );
}
