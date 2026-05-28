'use client';

/**
 * AchievementToast — Phase U2.
 *
 * Listens for the `achievement:unlocked` realtime event and renders a
 * slide-in toast top-right. Rarity colors the border. Auto-dismisses
 * after 6s; click to dismiss early. Queues multiple unlocks so a chain
 * (e.g. "first kill" + "first blood" + stat threshold) doesn't drop any.
 */

import { useEffect, useState } from 'react';
import { Trophy, X, Sparkles, Coins } from 'lucide-react';

interface UnlockEvent {
  achievementId: string;
  title: string;
  rarity: 'bronze' | 'silver' | 'gold' | 'legendary';
  icon?: string;
  rewardCc?: number;
  rewardTitle?: string | null;
}

const RARITY_STYLES: Record<UnlockEvent['rarity'], string> = {
  bronze:    'border-amber-600/60 bg-amber-700/20 text-amber-100',
  silver:    'border-slate-300/60 bg-slate-400/20 text-slate-100',
  gold:      'border-yellow-400/60 bg-yellow-500/20 text-yellow-100',
  legendary: 'border-fuchsia-400/60 bg-fuchsia-500/20 text-fuchsia-100 shadow-fuchsia-500/40 shadow-lg',
};

export function AchievementToast() {
  const [queue, setQueue] = useState<UnlockEvent[]>([]);

  useEffect(() => {
    if (typeof window === 'undefined') return;
    const handler = (ev: Event) => {
      const detail = (ev as CustomEvent<UnlockEvent>).detail;
      if (!detail?.achievementId) return;
      setQueue((prev) => [...prev, detail]);
    };
    window.addEventListener('achievement:unlocked', handler);
    return () => window.removeEventListener('achievement:unlocked', handler);
  }, []);

  // Auto-dismiss each toast after 6s.
  useEffect(() => {
    if (queue.length === 0) return;
    const t = setTimeout(() => setQueue((q) => q.slice(1)), 6000);
    return () => clearTimeout(t);
  }, [queue]);

  if (queue.length === 0) return null;

  return (
    <div className="pointer-events-none fixed right-3 top-16 z-40 flex flex-col gap-2">
      {queue.slice(0, 3).map((u, idx) => (
        <div
          key={`${u.achievementId}-${idx}`}
          role="alert"
          className={`pointer-events-auto animate-slide-in-right flex items-start gap-2 rounded-lg border p-3 backdrop-blur ${RARITY_STYLES[u.rarity] || RARITY_STYLES.bronze}`}
          style={{ minWidth: 260, maxWidth: 320 }}
        >
          <div className="rounded-full bg-black/30 p-2">
            <Trophy className="h-4 w-4" />
          </div>
          <div className="flex-1 min-w-0">
            <div className="flex items-center gap-1 text-[10px] uppercase tracking-wider opacity-80">
              <Sparkles className="h-3 w-3" />
              Achievement unlocked
            </div>
            <div className="text-sm font-semibold truncate">{u.title}</div>
            <div className="mt-1 flex flex-wrap gap-1 text-[10px]">
              {!!u.rewardCc && u.rewardCc > 0 && (
                <span className="flex items-center gap-1 rounded bg-yellow-500/20 px-1.5 py-0.5">
                  <Coins className="h-2.5 w-2.5" /> +{u.rewardCc} CC
                </span>
              )}
              {u.rewardTitle && (
                <span className="rounded bg-fuchsia-500/30 px-1.5 py-0.5">Title: {u.rewardTitle}</span>
              )}
            </div>
          </div>
          <button
            type="button"
            onClick={() => setQueue((q) => q.filter((_, i) => i !== idx))}
            aria-label="Dismiss"
            className="opacity-50 hover:opacity-100"
          >
            <X className="h-3 w-3" />
          </button>
        </div>
      ))}
    </div>
  );
}
