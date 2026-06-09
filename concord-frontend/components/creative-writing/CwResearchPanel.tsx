'use client';

/**
 * CwResearchPanel — the research / story-notes binder.
 */

import { useCallback, useEffect, useState } from 'react';
import { Loader2, Plus, Trash2, NotebookPen, Save } from 'lucide-react';
import { lensRun } from '@/lib/api/client';
import { cn } from '@/lib/utils';

interface Note { id: string; title: string; kind: string; body: string }

const KINDS = ['research', 'worldbuilding', 'location', 'item', 'lore'];
const KIND_COLOR: Record<string, string> = {
  research: 'text-sky-400', worldbuilding: 'text-violet-400', location: 'text-emerald-400',
  item: 'text-amber-400', lore: 'text-rose-400',
};

export function CwResearchPanel({ projectId }: { projectId: string }) {
  const [notes, setNotes] = useState<Note[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [filter, setFilter] = useState('');
  const [form, setForm] = useState({ title: '', kind: 'research' });
  const [open, setOpen] = useState<string | null>(null);
  const [draft, setDraft] = useState('');

  const refresh = useCallback(async () => {
    setLoading(true);
    const r = await lensRun('creative-writing', 'note-list', { projectId });
    setNotes(r.data?.result?.notes || []);
    setLoading(false);
  }, [projectId]);

  useEffect(() => { void refresh(); }, [refresh]);

  const addNote = async () => {
    if (!form.title.trim()) { setError('Note title is required.'); return; }
    const r = await lensRun('creative-writing', 'note-create', { projectId, title: form.title.trim(), kind: form.kind });
    if (r.data?.ok === false) { setError(r.data?.error || 'Failed'); return; }
    setForm({ title: '', kind: 'research' });
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

  if (loading) {
    return <div className="flex items-center justify-center py-10 text-zinc-400"><Loader2 className="w-5 h-5 animate-spin" /></div>;
  }

  const shown = filter ? notes.filter((n) => n.kind === filter) : notes;

  return (
    <div className="space-y-4">
      {error && <div className="text-xs text-rose-400 bg-rose-950/40 border border-rose-900/50 rounded-lg px-3 py-2">{error}</div>}

      <section className="bg-zinc-900/70 border border-zinc-800 rounded-xl p-3 flex flex-wrap items-center gap-2">
        <input placeholder="New note title" value={form.title} onChange={(e) => setForm({ ...form, title: e.target.value })}
          className="flex-1 bg-zinc-950 border border-zinc-700 rounded-lg px-2 py-1.5 text-xs text-zinc-100" />
        <select value={form.kind} onChange={(e) => setForm({ ...form, kind: e.target.value })}
          className="bg-zinc-950 border border-zinc-700 rounded-lg px-2 py-1.5 text-xs text-zinc-100 capitalize">
          {KINDS.map((k) => <option key={k} value={k}>{k}</option>)}
        </select>
        <button type="button" onClick={addNote}
          className="flex items-center gap-1 px-3 py-1.5 text-xs font-medium bg-amber-600 hover:bg-amber-500 text-white rounded-lg">
          <Plus className="w-3.5 h-3.5" /> Note
        </button>
      </section>

      <div className="flex flex-wrap gap-1.5">
        <button type="button" onClick={() => setFilter('')}
          className={cn('text-[11px] px-2.5 py-1 rounded-lg', filter === '' ? 'bg-amber-600 text-white' : 'bg-zinc-800 text-zinc-300')}>All</button>
        {KINDS.map((k) => (
          <button key={k} type="button" onClick={() => setFilter(k)}
            className={cn('text-[11px] px-2.5 py-1 rounded-lg capitalize', filter === k ? 'bg-amber-600 text-white' : 'bg-zinc-800 text-zinc-300')}>{k}</button>
        ))}
      </div>

      {shown.length === 0 ? (
        <p className="text-[11px] text-zinc-400 italic py-6 text-center">No notes. Capture research and worldbuilding here.</p>
      ) : (
        <ul className="space-y-2">
          {shown.map((n) => (
            <li key={n.id} className="bg-zinc-900/70 border border-zinc-800 rounded-xl">
              <div className="flex items-center gap-2 p-3">
                <NotebookPen className={cn('w-3.5 h-3.5', KIND_COLOR[n.kind])} />
                <button type="button" onClick={() => { setOpen(open === n.id ? null : n.id); setDraft(n.body); }}
                  className="flex-1 text-left text-xs font-medium text-zinc-100">{n.title}
                  <span className={cn('ml-2 text-[9px] uppercase', KIND_COLOR[n.kind])}>{n.kind}</span>
                </button>
                <button aria-label="Delete" type="button" onClick={() => del(n.id)} className="text-zinc-600 hover:text-rose-400">
                  <Trash2 className="w-3.5 h-3.5" />
                </button>
              </div>
              {open === n.id && (
                <div className="px-3 pb-3 space-y-1.5">
                  <textarea value={draft} onChange={(e) => setDraft(e.target.value)} rows={5}
                    className="w-full bg-zinc-950 border border-zinc-700 rounded-lg px-2 py-1.5 text-xs text-zinc-100 resize-y" />
                  <button type="button" onClick={() => saveBody(n.id)} disabled={draft === n.body}
                    className="flex items-center gap-1 px-2.5 py-1 text-[11px] bg-zinc-800 hover:bg-zinc-700 disabled:opacity-40 text-zinc-200 rounded-lg">
                    <Save className="w-3 h-3" /> {draft === n.body ? 'Saved' : 'Save'}
                  </button>
                </div>
              )}
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
