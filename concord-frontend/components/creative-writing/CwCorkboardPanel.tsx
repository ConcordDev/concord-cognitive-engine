'use client';

/**
 * CwCorkboardPanel — index-card view of every scene synopsis, grouped
 * by chapter, with click-through status cycling.
 */

import { useCallback, useEffect, useState } from 'react';
import { Loader2, StickyNote } from 'lucide-react';
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

export function CwCorkboardPanel({ projectId }: { projectId: string }) {
  const [chapters, setChapters] = useState<Group[]>([]);
  const [unfiled, setUnfiled] = useState<Card[]>([]);
  const [loading, setLoading] = useState(true);

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

  if (loading) {
    return <div className="flex items-center justify-center py-10 text-zinc-500"><Loader2 className="w-5 h-5 animate-spin" /></div>;
  }

  const renderCards = (cards: Card[]) => (
    <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 gap-2">
      {cards.map((c) => (
        <button key={c.id} type="button" onClick={() => cycleStatus(c)}
          className={cn('text-left bg-amber-50/[0.04] border-l-4 rounded-lg p-2.5 hover:bg-amber-50/[0.07]', STATUS_BG[c.status])}>
          <div className="flex items-center gap-1.5 mb-1">
            <span className={cn('w-1.5 h-1.5 rounded-full', STATUS_DOT[c.status])} />
            <span className="text-xs font-semibold text-zinc-100 truncate flex-1">{c.title}</span>
          </div>
          <p className="text-[11px] text-zinc-400 line-clamp-3 min-h-[2.4rem]">
            {c.synopsis || <span className="italic text-zinc-600">No synopsis yet</span>}
          </p>
          <p className="text-[9px] text-zinc-600 mt-1 uppercase">{c.status} · {c.wordCount} words</p>
        </button>
      ))}
    </div>
  );

  const hasCards = chapters.some((c) => c.cards.length) || unfiled.length;

  return (
    <div className="space-y-4">
      <p className="flex items-center gap-1 text-[11px] text-zinc-500">
        <StickyNote className="w-3.5 h-3.5 text-amber-400" /> Click a card to cycle its status.
      </p>
      {!hasCards && <p className="text-[11px] text-zinc-500 italic py-6 text-center">No scenes yet. Add scenes in the Binder.</p>}
      {chapters.filter((c) => c.cards.length).map((ch) => (
        <section key={ch.id}>
          <h3 className="text-xs font-semibold text-zinc-300 mb-2">{ch.title}</h3>
          {renderCards(ch.cards)}
        </section>
      ))}
      {unfiled.length > 0 && (
        <section>
          <h3 className="text-xs font-semibold text-zinc-300 mb-2">Unfiled</h3>
          {renderCards(unfiled)}
        </section>
      )}
    </div>
  );
}
