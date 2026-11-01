'use client';

/**
 * GoalSearch — S14 (Review 5 flow 17): in-lens text search across
 * goal kinds. Personal goals and challenges ride the same lens-data
 * stores their panels use; objectives come from the alignment tree's
 * list. A result navigates to the view that owns its kind, and a
 * query with no matches says so — no silent empty box.
 */

import { useEffect, useMemo, useState } from 'react';
import { Search } from 'lucide-react';
import { useLensData } from '@/lib/hooks/use-lens-data';
import { lensRun } from '@/lib/api/client';
import { type Goal, type Challenge, type GoalTab } from '@/components/goals/goals-model';

interface ObjectiveLite { id: string; title: string; level?: string }
interface Hit { kind: 'Goal' | 'Challenge' | 'Objective'; view: GoalTab; id: string; title: string; meta: string }

export function GoalSearch({ onNavigate }: { onNavigate: (view: GoalTab) => void }) {
  const { items: goalItems } = useLensData<Record<string, unknown>>('goals', 'goal');
  const { items: challengeItems } = useLensData<Record<string, unknown>>('goals', 'challenge');
  const [objectives, setObjectives] = useState<ObjectiveLite[]>([]);
  const [query, setQuery] = useState('');

  useEffect(() => {
    let cancelled = false;
    (async () => {
      const r = await lensRun('goals', 'alignmentTree', { op: 'list' });
      if (!cancelled && r.data?.ok && r.data.result) {
        setObjectives((r.data.result.flat || []).map((o: ObjectiveLite) => ({ id: o.id, title: o.title, level: o.level })));
      }
    })();
    return () => { cancelled = true; };
  }, []);

  const hits = useMemo<Hit[]>(() => {
    const q = query.trim().toLowerCase();
    if (q.length < 2) return [];
    const out: Hit[] = [];
    for (const item of goalItems) {
      const g = { id: item.id, ...item.data } as unknown as Goal;
      if (g.title?.toLowerCase().includes(q) || g.description?.toLowerCase().includes(q)) {
        out.push({ kind: 'Goal', view: 'goals', id: g.id, title: g.title, meta: g.status });
      }
    }
    for (const item of challengeItems) {
      const c = { id: item.id, ...item.data } as unknown as Challenge;
      if (c.title?.toLowerCase().includes(q)) {
        out.push({ kind: 'Challenge', view: 'challenges', id: c.id, title: c.title, meta: `${c.progress}/${c.target}` });
      }
    }
    for (const o of objectives) {
      if (o.title?.toLowerCase().includes(q)) {
        out.push({ kind: 'Objective', view: 'okr', id: o.id, title: o.title, meta: o.level || 'objective' });
      }
    }
    return out.slice(0, 12);
  }, [query, goalItems, challengeItems, objectives]);

  const showResults = query.trim().length >= 2;

  return (
    <div className="relative mt-4 max-w-md">
      <div className="flex items-center gap-2 rounded-full border border-white/10 bg-white/[0.03] px-4 py-2">
        <Search className="h-4 w-4 text-zinc-500" />
        <input
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder="Search goals, challenges, objectives…"
          aria-label="Search goals"
          className="w-full bg-transparent text-[14px] text-zinc-100 placeholder:text-zinc-500 focus:outline-none"
        />
      </div>
      {showResults && (
        <div className="absolute left-0 right-0 top-full z-20 mt-2 overflow-hidden rounded-xl border border-white/10 bg-zinc-950 shadow-xl">
          {hits.length === 0 ? (
            <p className="px-4 py-3 text-[13px] text-zinc-500">No goals match &ldquo;{query.trim()}&rdquo;.</p>
          ) : (
            <ul>
              {hits.map((h) => (
                <li key={`${h.kind}-${h.id}`}>
                  <button
                    type="button"
                    onClick={() => { onNavigate(h.view); setQuery(''); }}
                    className="flex w-full items-center gap-3 px-4 py-2.5 text-left hover:bg-white/5"
                  >
                    <span className="rounded-full border border-white/10 px-2 py-0.5 text-[10px] uppercase tracking-wide text-zinc-400">{h.kind}</span>
                    <span className="flex-1 truncate text-[14px] text-zinc-100">{h.title}</span>
                    <span className="text-[11px] text-zinc-500">{h.meta}</span>
                  </button>
                </li>
              ))}
            </ul>
          )}
        </div>
      )}
    </div>
  );
}
