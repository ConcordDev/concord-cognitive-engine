'use client';

/**
 * CwBiblePanel — the world / setting bible. Structured location, lore,
 * worldbuilding and item entries (reusing the note substrate), each
 * linkable to the scenes where it appears. `setting-bible` returns the
 * entries with their linked-scene lists; `note-link-scene` toggles a
 * link.
 */

import { useCallback, useEffect, useState } from 'react';
import { Loader2, Globe, Plus, Trash2, Link2, MapPin, Save } from 'lucide-react';
import { lensRun } from '@/lib/api/client';
import { cn } from '@/lib/utils';

interface LinkedScene { sceneId: string; title: string }
interface Entry {
  id: string; title: string; kind: string; body: string;
  linkedScenes: LinkedScene[]; linkedCount: number; updatedAt: string;
}
interface Scene { id: string; title: string }

const KINDS = ['location', 'lore', 'worldbuilding', 'item'];
const KIND_COLOR: Record<string, string> = {
  location: 'text-emerald-400', lore: 'text-rose-400',
  worldbuilding: 'text-violet-400', item: 'text-amber-400',
};

export function CwBiblePanel({ projectId }: { projectId: string }) {
  const [entries, setEntries] = useState<Entry[]>([]);
  const [scenes, setScenes] = useState<Scene[]>([]);
  const [byKind, setByKind] = useState<{ kind: string; count: number }[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [filter, setFilter] = useState('');
  const [form, setForm] = useState({ title: '', kind: 'location' });
  const [open, setOpen] = useState<string | null>(null);
  const [draft, setDraft] = useState('');

  const refresh = useCallback(async () => {
    setLoading(true);
    const [b, p] = await Promise.all([
      lensRun('creative-writing', 'setting-bible', { projectId }),
      lensRun('creative-writing', 'project-get', { id: projectId }),
    ]);
    setEntries((b.data?.result?.entries as Entry[]) || []);
    setByKind((b.data?.result?.byKind as { kind: string; count: number }[]) || []);
    setScenes((p.data?.result?.scenes as Scene[]) || []);
    setLoading(false);
  }, [projectId]);

  useEffect(() => { void refresh(); }, [refresh]);

  const addEntry = async () => {
    if (!form.title.trim()) { setError('Entry title is required.'); return; }
    const r = await lensRun('creative-writing', 'note-create', {
      projectId, title: form.title.trim(), kind: form.kind,
    });
    if (r.data?.ok === false) { setError(r.data?.error || 'Failed'); return; }
    setForm({ title: '', kind: 'location' });
    setError(null);
    await refresh();
  };

  const saveBody = async (id: string) => {
    await lensRun('creative-writing', 'note-update', { id, body: draft });
    await refresh();
  };

  const del = async (id: string) => {
    await lensRun('creative-writing', 'note-delete', { id });
    if (open === id) setOpen(null);
    await refresh();
  };

  const toggleLink = async (entry: Entry, sceneId: string) => {
    const linked = entry.linkedScenes.some((s) => s.sceneId === sceneId);
    await lensRun('creative-writing', 'note-link-scene', {
      noteId: entry.id, sceneId, linked: !linked,
    });
    await refresh();
  };

  if (loading) {
    return <div className="flex items-center justify-center py-10 text-zinc-400"><Loader2 className="w-5 h-5 animate-spin" /></div>;
  }

  const shown = filter ? entries.filter((e) => e.kind === filter) : entries;

  return (
    <div className="space-y-4">
      {error && <div className="text-xs text-rose-400 bg-rose-950/40 border border-rose-900/50 rounded-lg px-3 py-2">{error}</div>}

      <section className="bg-zinc-900/70 border border-zinc-800 rounded-xl p-3 flex flex-wrap items-center gap-2">
        <Globe className="w-4 h-4 text-amber-400 shrink-0" />
        <input placeholder="New setting entry (e.g. The Citadel)" value={form.title}
          onChange={(e) => setForm({ ...form, title: e.target.value })}
          className="flex-1 min-w-[140px] bg-zinc-950 border border-zinc-700 rounded-lg px-2 py-1.5 text-xs text-zinc-100" />
        <select value={form.kind} onChange={(e) => setForm({ ...form, kind: e.target.value })}
          className="bg-zinc-950 border border-zinc-700 rounded-lg px-2 py-1.5 text-xs text-zinc-100 capitalize">
          {KINDS.map((k) => <option key={k} value={k}>{k}</option>)}
        </select>
        <button type="button" onClick={addEntry}
          className="flex items-center gap-1 px-3 py-1.5 text-xs font-medium bg-amber-600 hover:bg-amber-500 text-white rounded-lg">
          <Plus className="w-3.5 h-3.5" /> Entry
        </button>
      </section>

      <div className="flex flex-wrap gap-1.5">
        <button type="button" onClick={() => setFilter('')}
          className={cn('text-[11px] px-2.5 py-1 rounded-lg', filter === '' ? 'bg-amber-600 text-white' : 'bg-zinc-800 text-zinc-300')}>
          All ({entries.length})
        </button>
        {byKind.map((k) => (
          <button key={k.kind} type="button" onClick={() => setFilter(k.kind)}
            className={cn('text-[11px] px-2.5 py-1 rounded-lg capitalize',
              filter === k.kind ? 'bg-amber-600 text-white' : 'bg-zinc-800 text-zinc-300')}>
            {k.kind} ({k.count})
          </button>
        ))}
      </div>

      {shown.length === 0 ? (
        <p className="text-[11px] text-zinc-400 italic py-6 text-center">
          No setting entries. Build your world bible — locations, lore and items linked into scenes.
        </p>
      ) : (
        <ul className="space-y-2">
          {shown.map((e) => (
            <li key={e.id} className="bg-zinc-900/70 border border-zinc-800 rounded-xl">
              <div className="flex items-center gap-2 p-3">
                <MapPin className={cn('w-3.5 h-3.5 shrink-0', KIND_COLOR[e.kind] || 'text-zinc-400')} />
                <button type="button" onClick={() => { setOpen(open === e.id ? null : e.id); setDraft(e.body); }}
                  className="flex-1 text-left text-xs font-medium text-zinc-100">
                  {e.title}
                  <span className={cn('ml-2 text-[9px] uppercase', KIND_COLOR[e.kind])}>{e.kind}</span>
                  {e.linkedCount > 0 && (
                    <span className="ml-2 text-[9px] text-zinc-400">
                      <Link2 className="w-2.5 h-2.5 inline mr-0.5" />{e.linkedCount} scene{e.linkedCount === 1 ? '' : 's'}
                    </span>
                  )}
                </button>
                <button aria-label="Delete" type="button" onClick={() => del(e.id)} className="text-zinc-600 hover:text-rose-400">
                  <Trash2 className="w-3.5 h-3.5" />
                </button>
              </div>
              {open === e.id && (
                <div className="px-3 pb-3 space-y-2">
                  <textarea value={draft} onChange={(ev) => setDraft(ev.target.value)} rows={4}
                    placeholder="Describe this location / lore / item…"
                    className="w-full bg-zinc-950 border border-zinc-700 rounded-lg px-2 py-1.5 text-xs text-zinc-100 resize-y" />
                  <button type="button" onClick={() => saveBody(e.id)} disabled={draft === e.body}
                    className="flex items-center gap-1 px-2.5 py-1 text-[11px] bg-zinc-800 hover:bg-zinc-700 disabled:opacity-40 text-zinc-200 rounded-lg">
                    <Save className="w-3 h-3" /> {draft === e.body ? 'Saved' : 'Save'}
                  </button>
                  <div>
                    <p className="text-[10px] font-semibold text-zinc-400 uppercase mb-1">Appears in scenes</p>
                    {scenes.length === 0 ? (
                      <p className="text-[10px] text-zinc-400 italic">No scenes to link yet.</p>
                    ) : (
                      <div className="flex flex-wrap gap-1.5">
                        {scenes.map((sc) => {
                          const linked = e.linkedScenes.some((l) => l.sceneId === sc.id);
                          return (
                            <button key={sc.id} type="button" onClick={() => toggleLink(e, sc.id)}
                              className={cn('text-[10px] px-2 py-0.5 rounded-lg border',
                                linked
                                  ? 'bg-amber-600/30 border-amber-600/50 text-amber-200'
                                  : 'bg-zinc-950 border-zinc-700 text-zinc-400 hover:border-zinc-600')}>
                              {linked && <Link2 className="w-2.5 h-2.5 inline mr-0.5" />}{sc.title}
                            </button>
                          );
                        })}
                      </div>
                    )}
                  </div>
                </div>
              )}
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
