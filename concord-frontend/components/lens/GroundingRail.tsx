'use client';

// GroundingRail — surfaces a lens's OWN grounding DTUs (the job a + b payoff).
// Drop into any lens; it pulls the routed corpus for that lens via
// useLensGrounding (discovery.search + lens hint) and renders a compact list.
// Renders nothing when the lens has no grounding yet (graceful, no empty chrome).

import { useLensGrounding } from '@/hooks/useLensGrounding';
import { BookOpen } from 'lucide-react';

export function GroundingRail({ lens, query, limit = 12 }: { lens: string; query?: string; limit?: number }) {
  const { items, loading } = useLensGrounding(lens, query, limit);
  if (!loading && items.length === 0) return null;

  return (
    <aside className="space-y-2" data-testid="grounding-rail">
      <div className="flex items-center gap-1.5 text-xs font-medium text-zinc-400">
        <BookOpen className="w-3.5 h-3.5" />
        <span>Grounding</span>
        {!loading && <span className="text-zinc-600">· {items.length}</span>}
      </div>
      {loading && items.length === 0 ? (
        <div className="h-3 w-24 animate-pulse rounded bg-zinc-800" />
      ) : (
        <ul className="space-y-1">
          {items.map((d) => (
            <li key={d.id} className="rounded-md border border-zinc-800 bg-zinc-900/50 px-2.5 py-1.5">
              <div className="text-xs font-medium text-zinc-200 truncate">{d.title}</div>
              {d.snippet && <div className="text-[11px] text-zinc-500 line-clamp-2">{d.snippet}</div>}
            </li>
          ))}
        </ul>
      )}
    </aside>
  );
}

export default GroundingRail;
