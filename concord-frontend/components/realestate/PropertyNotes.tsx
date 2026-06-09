'use client';

import { useEffect, useState } from 'react';
import { StickyNote, Plus, Trash2, Loader2 } from 'lucide-react';
import { lensRun } from '@/lib/api/client';

interface Note { id: string; listingId: string; text: string; timestamp: string }

export function PropertyNotes({ listingId }: { listingId?: string }) {
  const [notes, setNotes] = useState<Note[]>([]);
  const [loading, setLoading] = useState(true);
  const [draft, setDraft] = useState('');

  // eslint-disable-next-line react-hooks/exhaustive-deps
  useEffect(() => { refresh(); }, [listingId]);

  async function refresh() {
    setLoading(true);
    try {
      const res = await lensRun({ domain: 'realestate', action: 'notes-list', input: listingId ? { listingId } : {} });
      setNotes((res.data?.result?.notes || []) as Note[]);
    } catch (e) { console.error('[Notes] list failed', e); }
    finally { setLoading(false); }
  }

  async function save() {
    if (!draft.trim() || !listingId) return;
    try {
      await lensRun({ domain: 'realestate', action: 'notes-save', input: { listingId, text: draft.trim() } });
      setDraft('');
      await refresh();
    } catch (e) { console.error('[Notes] save failed', e); }
  }

  async function remove(id: string) {
    try {
      await lensRun({ domain: 'realestate', action: 'notes-delete', input: { id } });
      setNotes(prev => prev.filter(n => n.id !== id));
    } catch (e) { console.error('[Notes] delete failed', e); }
  }

  return (
    <div className="bg-[#0d1117] border border-cyan-500/20 rounded-lg overflow-hidden">
      <header className="px-4 py-2 border-b border-white/10 flex items-center gap-2">
        <StickyNote className="w-4 h-4 text-amber-300" />
        <span className="text-xs uppercase font-semibold text-gray-300 tracking-wider">Notes{listingId ? ` · ${listingId.slice(0, 12)}…` : ' (all)'}</span>
        <span className="ml-auto text-[10px] text-gray-400">{notes.length}</span>
      </header>
      {listingId && (
        <div className="p-3 border-b border-white/10 flex items-center gap-2">
          <textarea value={draft} onChange={e => setDraft(e.target.value)} placeholder="Quick note about this listing…" rows={2} className="flex-1 px-2 py-1.5 text-xs bg-lattice-deep border border-lattice-border rounded text-white resize-none" />
          <button onClick={save} disabled={!draft.trim()} className="px-3 py-1.5 text-xs rounded bg-amber-500 text-black hover:bg-amber-400 disabled:opacity-40 inline-flex items-center gap-1"><Plus className="w-3 h-3" />Save</button>
        </div>
      )}
      <div className="max-h-80 overflow-y-auto">
        {loading ? (
          <div className="flex items-center justify-center py-6 text-xs text-gray-400"><Loader2 className="w-4 h-4 animate-spin mr-2" /> Loading…</div>
        ) : notes.length === 0 ? (
          <div className="px-3 py-10 text-center text-xs text-gray-400"><StickyNote className="w-6 h-6 mx-auto mb-2 opacity-30" />{listingId ? 'No notes for this listing yet.' : 'No notes yet. Select a listing to add one.'}</div>
        ) : (
          <ul className="divide-y divide-white/5">
            {notes.map(n => (
              <li key={n.id} className="px-3 py-2 hover:bg-white/[0.03] group flex items-start gap-3">
                <StickyNote className="w-3.5 h-3.5 text-amber-300 mt-0.5" />
                <div className="flex-1 min-w-0">
                  <div className="text-xs text-gray-100 whitespace-pre-wrap break-words">{n.text}</div>
                  <div className="text-[10px] text-gray-400 mt-0.5 font-mono">{n.listingId.slice(0, 14)} · {new Date(n.timestamp).toLocaleString()}</div>
                </div>
                <button aria-label="Delete" onClick={() => remove(n.id)} className="opacity-0 group-hover:opacity-100 p-1 text-gray-400 hover:text-rose-400"><Trash2 className="w-3 h-3" /></button>
              </li>
            ))}
          </ul>
        )}
      </div>
    </div>
  );
}

export default PropertyNotes;
