'use client';

/**
 * GdGddPanel — the game design document: editable sections.
 */

import { useCallback, useEffect, useState } from 'react';
import { Loader2, Plus, Trash2, FileText, Save, ChevronUp, ChevronDown } from 'lucide-react';
import { lensRun } from '@/lib/api/client';

interface Section { id: string; title: string; content: string }

const SUGGESTED = ['Pitch', 'Core loop', 'Mechanics', 'Story & setting', 'Art direction', 'Audio', 'Progression', 'Monetization'];

export function GdGddPanel({ gameId, onChange }: { gameId: string; onChange: () => void }) {
  const [sections, setSections] = useState<Section[]>([]);
  const [loading, setLoading] = useState(true);
  const [newTitle, setNewTitle] = useState('');
  const [drafts, setDrafts] = useState<Record<string, string>>({});

  const refresh = useCallback(async () => {
    setLoading(true);
    const r = await lensRun('game-design', 'game-get', { id: gameId });
    const secs: Section[] = r.data?.result?.gdd || [];
    setSections(secs);
    setDrafts(Object.fromEntries(secs.map((s) => [s.id, s.content])));
    setLoading(false);
    onChange();
  }, [gameId, onChange]);

  useEffect(() => { void refresh(); }, [refresh]);

  const addSection = async (title: string) => {
    if (!title.trim()) return;
    await lensRun('game-design', 'gdd-add', { gameId, title: title.trim() });
    setNewTitle('');
    await refresh();
  };

  const saveSection = async (id: string) => {
    await lensRun('game-design', 'gdd-update', { id, content: drafts[id] || '' });
    await refresh();
  };

  const delSection = async (id: string) => {
    await lensRun('game-design', 'gdd-delete', { id });
    await refresh();
  };

  const moveSection = async (id: string, dir: -1 | 1) => {
    const idx = sections.findIndex((s) => s.id === id);
    const swap = idx + dir;
    if (swap < 0 || swap >= sections.length) return;
    const order = sections.map((s) => s.id);
    [order[idx], order[swap]] = [order[swap], order[idx]];
    setSections(order.map((sid) => sections.find((s) => s.id === sid)!));
    await lensRun('game-design', 'gdd-reorder', { gameId, order });
    await refresh();
  };

  if (loading) {
    return <div className="flex items-center justify-center py-10 text-zinc-400"><Loader2 className="w-5 h-5 animate-spin" /></div>;
  }

  return (
    <div className="space-y-4">
      <section className="bg-zinc-900/70 border border-zinc-800 rounded-xl p-3 space-y-2">
        <div className="flex items-center gap-2">
          <input placeholder="New section title" value={newTitle} onChange={(e) => setNewTitle(e.target.value)}
            className="flex-1 bg-zinc-950 border border-zinc-700 rounded-lg px-2 py-1.5 text-xs text-zinc-100" />
          <button type="button" onClick={() => addSection(newTitle)}
            className="flex items-center gap-1 px-3 py-1.5 text-xs font-medium bg-lime-600 hover:bg-lime-500 text-white rounded-lg">
            <Plus className="w-3.5 h-3.5" /> Section
          </button>
        </div>
        <div className="flex flex-wrap gap-1">
          {SUGGESTED.filter((s) => !sections.some((x) => x.title.toLowerCase() === s.toLowerCase())).map((s) => (
            <button key={s} type="button" onClick={() => addSection(s)}
              className="text-[10px] px-2 py-0.5 bg-zinc-800 hover:bg-zinc-700 text-zinc-400 rounded">+ {s}</button>
          ))}
        </div>
      </section>

      {sections.length === 0 ? (
        <p className="text-[11px] text-zinc-400 italic py-6 text-center">No design-doc sections yet. Add one above.</p>
      ) : (
        <ul className="space-y-3">
          {sections.map((s, i) => (
            <li key={s.id} className="bg-zinc-900/70 border border-zinc-800 rounded-xl p-3">
              <div className="flex items-center justify-between mb-1.5">
                <h3 className="flex items-center gap-1 text-xs font-semibold text-zinc-200">
                  <FileText className="w-3.5 h-3.5 text-lime-400" /> {s.title}
                </h3>
                <div className="flex items-center gap-1">
                  <button aria-label="Collapse" type="button" onClick={() => moveSection(s.id, -1)} disabled={i === 0}
                    className="text-zinc-600 hover:text-zinc-300 disabled:opacity-30">
                    <ChevronUp className="w-3.5 h-3.5" />
                  </button>
                  <button aria-label="Expand" type="button" onClick={() => moveSection(s.id, 1)} disabled={i === sections.length - 1}
                    className="text-zinc-600 hover:text-zinc-300 disabled:opacity-30">
                    <ChevronDown className="w-3.5 h-3.5" />
                  </button>
                  <button aria-label="Delete" type="button" onClick={() => delSection(s.id)} className="text-zinc-600 hover:text-rose-400">
                    <Trash2 className="w-3.5 h-3.5" />
                  </button>
                </div>
              </div>
              <textarea value={drafts[s.id] ?? ''} rows={4}
                onChange={(e) => setDrafts((p) => ({ ...p, [s.id]: e.target.value }))}
                placeholder="Write this section…"
                className="w-full bg-zinc-950 border border-zinc-700 rounded-lg px-2 py-1.5 text-xs text-zinc-100 resize-y" />
              <button type="button" onClick={() => saveSection(s.id)} disabled={drafts[s.id] === s.content}
                className="mt-1.5 flex items-center gap-1 px-2.5 py-1 text-[11px] bg-zinc-800 hover:bg-zinc-700 disabled:opacity-40 text-zinc-200 rounded-lg">
                <Save className="w-3 h-3" /> {drafts[s.id] === s.content ? 'Saved' : 'Save'}
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
