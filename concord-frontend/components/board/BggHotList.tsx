'use client';

import { useQuery } from '@tanstack/react-query';
import { Dices, Loader2, ExternalLink } from 'lucide-react';
import { SaveAsDtuButton } from '@/components/dtu/SaveAsDtuButton';

interface HotGame { id: string; rank: number; name: string; yearPublished?: string; thumbnail?: string }

export function BggHotList() {

  const games = useQuery({
    queryKey: ['bgg-hot'],
    queryFn: async () => {
      const r = await fetch('https://boardgamegeek.com/xmlapi2/hot?type=boardgame');
      if (!r.ok) throw new Error(`bgg ${r.status}`);
      const xml = await r.text();
      const parser = new DOMParser();
      const doc = parser.parseFromString(xml, 'application/xml');
      const items = Array.from(doc.querySelectorAll('item'));
      return items.map((el) => ({
        id: el.getAttribute('id') || '',
        rank: Number(el.getAttribute('rank') || 0),
        name: el.querySelector('name')?.getAttribute('value') || '',
        yearPublished: el.querySelector('yearpublished')?.getAttribute('value') || undefined,
        thumbnail: el.querySelector('thumbnail')?.getAttribute('value') || undefined,
      })) as HotGame[];
    },
    staleTime: 6 * 60 * 60 * 1000,
  });

  return (
    <div className="space-y-4">
      <header className="flex items-center justify-between gap-3 border-b border-cyan-500/15 pb-3">
        <div className="flex items-center gap-2">
          <Dices className="h-5 w-5 text-cyan-400" />
          <h2 className="text-sm font-semibold text-white">BoardGameGeek hot list</h2>
          <span className="rounded bg-zinc-800 px-1.5 py-0.5 font-mono text-[10px] uppercase tracking-wider text-zinc-400">boardgamegeek.com xmlapi2 · live</span>
        </div>
        {(games.data?.length ?? 0) > 0 && (
          <SaveAsDtuButton
            compact
            apiSource="boardgamegeek"
            apiUrl="https://boardgamegeek.com/xmlapi2/hot?type=boardgame"
            title={`BGG hot board games — ${games.data?.length}`}
            content={(games.data || []).map((g) => `#${g.rank} ${g.name}${g.yearPublished ? ` (${g.yearPublished})` : ''} — https://boardgamegeek.com/boardgame/${g.id}`).join('\n')}
            extraTags={['board', 'games', 'bgg']}
            rawData={{ games: games.data }}
          />
        )}
      </header>
      {games.isError && <div className="rounded border border-red-500/20 bg-red-500/5 px-3 py-2 text-xs text-red-300">BGG unreachable.</div>}
      {games.isPending && <div className="flex items-center gap-2 text-xs text-zinc-400"><Loader2 className="h-4 w-4 animate-spin" /> Pulling BGG hot list…</div>}
      <div className="grid grid-cols-2 gap-2 sm:grid-cols-3 md:grid-cols-4 max-h-[520px] overflow-y-auto">
        {(games.data || []).map((g) => (
          <a key={g.id} href={`https://boardgamegeek.com/boardgame/${g.id}`} target="_blank" rel="noopener noreferrer" className="group block rounded border border-zinc-800 bg-zinc-950 overflow-hidden hover:border-cyan-500/30">
            {g.thumbnail ? (
              // eslint-disable-next-line @next/next/no-img-element
              <img src={g.thumbnail} alt={g.name} className="h-28 w-full object-cover" loading="lazy" />
            ) : (
              <div className="flex h-28 items-center justify-center bg-zinc-900"><Dices className="h-7 w-7 text-zinc-700" /></div>
            )}
            <div className="px-2 py-1.5">
              <div className="flex items-center gap-1.5">
                <span className="rounded bg-cyan-500/20 px-1 font-mono text-[9px] text-cyan-300">#{g.rank}</span>
                <span className="line-clamp-1 text-[11px] text-white group-hover:text-cyan-300">{g.name}</span>
              </div>
              <div className="mt-0.5 flex items-center justify-between text-[10px] text-zinc-400">
                <span>{g.yearPublished || '—'}</span>
                <ExternalLink className="h-2.5 w-2.5" />
              </div>
            </div>
          </a>
        ))}
      </div>
    </div>
  );
}
