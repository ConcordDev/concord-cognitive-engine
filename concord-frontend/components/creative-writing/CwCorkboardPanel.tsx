'use client';

/**
 * CwCorkboardPanel — draggable index-card view of every scene synopsis,
 * grouped by chapter. Cards can be dragged to reorder within a chapter
 * or dropped into a different chapter; the new order persists through
 * the `scene-set-order` macro. Clicking a card cycles its status.
 */

import { useCallback, useEffect, useState } from 'react';
import { Loader2, StickyNote, GripVertical } from 'lucide-react';
import { lensRun } from '@/lib/api/client';
import { cn } from '@/lib/utils';

interface Card { id: string; chapterId: string | null; title: string; synopsis: string | null; status: string; wordCount: number }
interface Group { id: string; title: string; cards: Card[] }

const STATUS = ['outline', 'draft', 'revised', 'final'];
const STATUS_BG: Record<string, string> = {
  outline: 'border-zinc-700', draft: 'border-amber-600', revised: 'border-sky-600', final: 'border-emerald-600',
};
const STATUS_DOT: Record<string, string> = {
  outline: 'bg-zinc-500', draft: 'bg-amber-400', revised: 'bg-sky-400', final: 'bg-emerald-400',
};
const UNFILED = '__unfiled__';

export function CwCorkboardPanel({ projectId }: { projectId: string }) {
  const [chapters, setChapters] = useState<Group[]>([]);
  const [unfiled, setUnfiled] = useState<Card[]>([]);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [dragId, setDragId] = useState<string | null>(null);
  const [overKey, setOverKey] = useState<string | null>(null);

  const refresh = useCallback(async () => {
    setLoading(true);
    const r = await lensRun('creative-writing', 'corkboard', { projectId });
    setChapters((r.data?.result?.chapters as Group[]) || []);
    setUnfiled((r.data?.result?.unfiled as Card[]) || []);
    setLoading(false);
  }, [projectId]);

  useEffect(() => { void refresh(); }, [refresh]);

  const cycleStatus = async (card: Card) => {
    const next = STATUS[(STATUS.indexOf(card.status) + 1) % STATUS.length];
    await lensRun('creative-writing', 'scene-update', { sceneId: card.id, status: next });
    await refresh();
  };

  // Drop the dragged card before `beforeId` within the target column.
  const onDrop = useCallback(async (groupKey: string, beforeId: string | null) => {
    setOverKey(null);
    if (!dragId) return;
    const targetChapterId = groupKey === UNFILED ? null : groupKey;
    // Build the column's current ordered card-id list.
    const column = groupKey === UNFILED
      ? unfiled.map((c) => c.id)
      : (chapters.find((c) => c.id === groupKey)?.cards.map((x) => x.id) || []);
    const next = column.filter((id) => id !== dragId);
    const idx = beforeId ? next.indexOf(beforeId) : next.length;
    next.splice(idx < 0 ? next.length : idx, 0, dragId);
    setBusy(true);
    await lensRun('creative-writing', 'scene-set-order', {
      projectId, chapterId: targetChapterId || undefined, sceneIds: next,
    });
    setDragId(null);
    setBusy(false);
    await refresh();
  }, [dragId, unfiled, chapters, projectId, refresh]);

  if (loading) {
    return <div className="flex items-center justify-center py-10 text-zinc-400"><Loader2 className="w-5 h-5 animate-spin" /></div>;
  }

  const renderColumn = (groupKey: string, cards: Card[]) => (
    <div
      className={cn('grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 gap-2 min-h-[64px] rounded-lg p-1 transition-colors',
        overKey === groupKey && !cards.length ? 'bg-amber-500/10 ring-1 ring-amber-600/40' : '')}
      onDragOver={(e) => { if (dragId) { e.preventDefault(); setOverKey(groupKey); } }}
      onDrop={(e) => { e.preventDefault(); void onDrop(groupKey, null); }}
    >
      {cards.map((c) => (
        <div
          key={c.id}
          draggable
          onDragStart={() => setDragId(c.id)}
          onDragEnd={() => { setDragId(null); setOverKey(null); }}
          onDragOver={(e) => { if (dragId && dragId !== c.id) { e.preventDefault(); setOverKey(`${groupKey}:${c.id}`); } }}
          onDrop={(e) => { e.preventDefault(); e.stopPropagation(); void onDrop(groupKey, c.id); }}
          className={cn('group relative bg-amber-50/[0.04] border-l-4 rounded-lg p-2.5 cursor-grab active:cursor-grabbing transition-all',
            STATUS_BG[c.status],
            dragId === c.id ? 'opacity-40' : 'hover:bg-amber-50/[0.07]',
            overKey === `${groupKey}:${c.id}` ? 'ring-1 ring-amber-500' : '')}
        >
          <div className="flex items-center gap-1.5 mb-1">
            <GripVertical className="w-3 h-3 text-zinc-600 opacity-0 group-hover:opacity-100 shrink-0" />
            <span className={cn('w-1.5 h-1.5 rounded-full', STATUS_DOT[c.status])} />
            <span className="text-xs font-semibold text-zinc-100 truncate flex-1">{c.title}</span>
          </div>
          <button type="button" onClick={() => cycleStatus(c)} className="block w-full text-left">
            <p className="text-[11px] text-zinc-400 line-clamp-3 min-h-[2.4rem]">
              {c.synopsis || <span className="italic text-zinc-600">No synopsis yet</span>}
            </p>
            <p className="text-[9px] text-zinc-400 mt-1 uppercase hover:text-amber-400">{c.status} · {c.wordCount} words</p>
          </button>
        </div>
      ))}
      {!cards.length && (
        <p className="col-span-full text-[10px] text-zinc-400 italic text-center py-3">Drop a card here</p>
      )}
    </div>
  );

  const hasCards = chapters.some((c) => c.cards.length) || unfiled.length;

  return (
    <div className="space-y-4">
      <p className="flex items-center gap-1.5 text-[11px] text-zinc-400">
        <StickyNote className="w-3.5 h-3.5 text-amber-400" />
        Drag cards to reorder or move between chapters. Click a synopsis to cycle status.
        {busy && <Loader2 className="w-3 h-3 animate-spin text-amber-400" />}
      </p>
      {!hasCards && <p className="text-[11px] text-zinc-400 italic py-6 text-center">No scenes yet. Add scenes in the Binder.</p>}
      {chapters.map((ch) => (
        <section key={ch.id}>
          <h3 className="text-xs font-semibold text-zinc-300 mb-1.5">{ch.title}</h3>
          {renderColumn(ch.id, ch.cards)}
        </section>
      ))}
      {(unfiled.length > 0 || (dragId && hasCards)) && (
        <section>
          <h3 className="text-xs font-semibold text-zinc-300 mb-1.5">Unfiled</h3>
          {renderColumn(UNFILED, unfiled)}
        </section>
      )}
    </div>
  );
}
