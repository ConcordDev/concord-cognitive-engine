'use client';

/**
 * PgMilestonesPanel — CDC "Learn the Signs" milestone checklist for the
 * child's current age bracket plus cumulative progress by category.
 */

import { useCallback, useEffect, useState } from 'react';
import { Loader2, Sparkles, Check } from 'lucide-react';
import { lensRun } from '@/lib/api/client';
import { cn } from '@/lib/utils';

interface Milestone { id: string; ageMonths: number; category: string; text: string; achieved: boolean }
interface Checklist { ageMonths: number; checkpoint: number; items: Milestone[]; achievedCount: number }
interface Progress {
  ageMonths: number; eligibleCount: number; achievedCount: number;
  byCategory: Record<string, { total: number; achieved: number }>;
}

const CAT_COLOR: Record<string, string> = {
  social: 'text-pink-400', language: 'text-sky-400',
  cognitive: 'text-amber-400', movement: 'text-emerald-400',
};

export function PgMilestonesPanel({ childId }: { childId: string }) {
  const [checklist, setChecklist] = useState<Checklist | null>(null);
  const [progress, setProgress] = useState<Progress | null>(null);
  const [loading, setLoading] = useState(true);

  const refresh = useCallback(async () => {
    setLoading(true);
    const [c, p] = await Promise.all([
      lensRun('parenting', 'milestone-checklist', { childId }),
      lensRun('parenting', 'milestone-progress', { childId }),
    ]);
    setChecklist((c.data?.result as Checklist | null) || null);
    setProgress((p.data?.result as Progress | null) || null);
    setLoading(false);
  }, [childId]);

  useEffect(() => { void refresh(); }, [refresh]);

  const toggle = async (m: Milestone) => {
    await lensRun('parenting', 'milestone-record', { childId, milestoneId: m.id, achieved: !m.achieved });
    await refresh();
  };

  if (loading) {
    return <div className="flex items-center justify-center py-10 text-zinc-500"><Loader2 className="w-5 h-5 animate-spin" /></div>;
  }

  return (
    <div className="space-y-4">
      {/* Progress by category */}
      {progress && (
        <div className="bg-zinc-900/70 border border-zinc-800 rounded-xl p-3">
          <h3 className="text-xs font-semibold text-zinc-300 mb-2">
            Progress · {progress.achievedCount}/{progress.eligibleCount} milestones to date
          </h3>
          <div className="space-y-1.5">
            {Object.entries(progress.byCategory).map(([cat, v]) => (
              <div key={cat} className="flex items-center gap-2">
                <span className={cn('w-20 text-xs capitalize', CAT_COLOR[cat])}>{cat}</span>
                <div className="flex-1 h-2 rounded-full bg-zinc-800 overflow-hidden">
                  <div className="h-full bg-rose-500 rounded-full"
                    style={{ width: `${v.total ? (v.achieved / v.total) * 100 : 0}%` }} />
                </div>
                <span className="text-[10px] text-zinc-500 w-10 text-right">{v.achieved}/{v.total}</span>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Checklist */}
      {checklist && (
        <section>
          <h3 className="flex items-center gap-1 text-xs font-semibold text-zinc-300 mb-2">
            <Sparkles className="w-3.5 h-3.5 text-rose-400" /> CDC checklist · {checklist.checkpoint}-month milestones
          </h3>
          <p className="text-[10px] text-zinc-500 mb-2">
            Tap to mark milestones your child has reached. Share concerns with your pediatrician — every child grows differently.
          </p>
          <ul className="space-y-1.5">
            {checklist.items.map((m) => (
              <li key={m.id}>
                <button type="button" onClick={() => toggle(m)}
                  className={cn('flex items-start gap-2 w-full text-left bg-zinc-900/70 border rounded-lg px-3 py-2',
                    m.achieved ? 'border-rose-800/60' : 'border-zinc-800 hover:border-zinc-700')}>
                  <span className={cn('mt-0.5 w-4 h-4 rounded flex items-center justify-center shrink-0',
                    m.achieved ? 'bg-rose-600' : 'border border-zinc-600')}>
                    {m.achieved && <Check className="w-3 h-3 text-white" />}
                  </span>
                  <span className="flex-1">
                    <span className="text-xs text-zinc-200">{m.text}</span>
                    <span className={cn('block text-[10px] capitalize', CAT_COLOR[m.category])}>{m.category}</span>
                  </span>
                </button>
              </li>
            ))}
          </ul>
        </section>
      )}
    </div>
  );
}
