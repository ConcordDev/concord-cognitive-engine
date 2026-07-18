'use client';

// XpActivityFeed — the real per-event XP/gold activity log for the Habitica-
// style gamification substrate (server/domains/game.js's `awardXp` hook,
// shared by taskComplete / partyContribute / challengeProgress, now logs
// every non-zero award to a per-user ledger via the `xpLogList` macro).
//
// This replaces the History tab's old honest-note placeholder ("A per-event
// XP log isn't tracked server-side yet"). It genuinely IS tracked now — this
// component is wired directly to `lensRun('game', 'xpLogList', …)`, no
// fabricated entries, no client-side invention. An empty log renders an
// honest empty state rather than sample data.

import { useCallback, useEffect, useState } from 'react';
import { lensRun } from '@/lib/api/client';
import { cn } from '@/lib/utils';
import { CheckSquare, Users, Swords, Sparkles, Loader2, Filter } from 'lucide-react';

interface XpLogEntry {
  id: string;
  source: string;
  label: string | null;
  refId: string | null;
  xpDelta: number;
  goldDelta: number;
  xpAfter: number;
  levelAfter: number;
  at: string;
}

const SOURCE_META: Record<string, { label: string; icon: typeof CheckSquare; color: string }> = {
  task: { label: 'Task', icon: CheckSquare, color: 'text-neon-cyan border-neon-cyan/30' },
  party_quest: { label: 'Party Quest', icon: Users, color: 'text-neon-purple border-neon-purple/30' },
  challenge_prize: { label: 'Challenge', icon: Swords, color: 'text-neon-pink border-neon-pink/30' },
  unknown: { label: 'Other', icon: Sparkles, color: 'text-gray-400 border-gray-600' },
};

const SOURCE_FILTERS: { id: string; label: string }[] = [
  { id: '', label: 'All' },
  { id: 'task', label: 'Tasks' },
  { id: 'party_quest', label: 'Party' },
  { id: 'challenge_prize', label: 'Challenges' },
];

function relativeTime(iso: string): string {
  const diffMs = Date.now() - new Date(iso).getTime();
  const s = Math.max(0, Math.floor(diffMs / 1000));
  if (s < 60) return 'just now';
  const m = Math.floor(s / 60);
  if (m < 60) return `${m}m ago`;
  const h = Math.floor(m / 60);
  if (h < 24) return `${h}h ago`;
  const d = Math.floor(h / 24);
  return `${d}d ago`;
}

export function XpActivityFeed() {
  const [entries, setEntries] = useState<XpLogEntry[]>([]);
  const [totalXp, setTotalXp] = useState(0);
  const [totalGold, setTotalGold] = useState(0);
  const [sourceFilter, setSourceFilter] = useState('');
  const [loading, setLoading] = useState(true);
  const [err, setErr] = useState<string | null>(null);

  const load = useCallback(async (source: string) => {
    setLoading(true);
    setErr(null);
    try {
      const input = source ? { source, limit: 25 } : { limit: 25 };
      const r = await lensRun('game', 'xpLogList', input);
      if (r.data.ok && r.data.result) {
        const res = r.data.result as { entries: XpLogEntry[]; totalXpAllTime: number; totalGoldAllTime: number };
        setEntries(res.entries || []);
        setTotalXp(res.totalXpAllTime || 0);
        setTotalGold(res.totalGoldAllTime || 0);
      } else if (!r.data.ok) {
        setErr(r.data.error || 'Failed to load activity');
      }
    } catch (e) {
      setErr(e instanceof Error ? e.message : 'Failed to load activity');
    }
    setLoading(false);
  }, []);

  useEffect(() => { load(sourceFilter); }, [load, sourceFilter]);

  return (
    <div className="panel p-4" data-lens-theme="game">
      <div className="flex items-center justify-between flex-wrap gap-2 mb-3">
        <h3 className="font-semibold text-white flex items-center gap-2">
          <Sparkles className="w-4 h-4 text-neon-cyan" /> Recent Activity
        </h3>
        <div className="flex items-center gap-1.5 text-[10px]">
          <Filter className="w-3 h-3 text-gray-500" />
          {SOURCE_FILTERS.map((f) => (
            <button
              key={f.id || 'all'}
              onClick={() => setSourceFilter(f.id)}
              className={cn(
                'px-2 py-1 rounded border transition-colors',
                sourceFilter === f.id ? 'bg-neon-purple/20 text-neon-purple border-neon-purple/40' : 'text-gray-400 border-gray-600 hover:text-white',
              )}
            >
              {f.label}
            </button>
          ))}
        </div>
      </div>

      <div className="grid grid-cols-2 gap-3 mb-3">
        <div className="lens-card text-center py-2">
          <p className="text-lg font-bold text-neon-yellow">{totalXp.toLocaleString()}</p>
          <p className="text-[10px] text-gray-400">Lifetime XP earned</p>
        </div>
        <div className="lens-card text-center py-2">
          <p className="text-lg font-bold text-amber-400">{totalGold.toLocaleString()}</p>
          <p className="text-[10px] text-gray-400">Lifetime gold earned</p>
        </div>
      </div>

      {loading && (
        <div className="flex items-center justify-center py-6 text-gray-400 text-xs gap-2">
          <Loader2 className="w-4 h-4 animate-spin" /> Loading activity…
        </div>
      )}
      {!loading && err && (
        <p className="text-xs text-red-400 py-4">{err}</p>
      )}
      {!loading && !err && entries.length === 0 && (
        <p className="text-xs text-gray-400 italic py-6 text-center">
          No XP earned yet. Complete a daily or habit, contribute to a party quest, or win a
          challenge in the Habit Hub tab to start your activity log.
        </p>
      )}
      {!loading && !err && entries.length > 0 && (
        <div className="space-y-1.5 max-h-96 overflow-y-auto">
          {entries.map((e) => {
            const meta = SOURCE_META[e.source] || SOURCE_META.unknown;
            const Icon = meta.icon;
            const positive = e.xpDelta >= 0;
            return (
              <div key={e.id} className="flex items-center justify-between gap-2 lens-card px-3 py-2">
                <div className="flex items-center gap-2 min-w-0">
                  <span className={cn('shrink-0 rounded border p-1', meta.color)}>
                    <Icon className="w-3 h-3" />
                  </span>
                  <div className="min-w-0">
                    <p className="text-xs text-white truncate">{e.label || meta.label}</p>
                    <p className="text-[10px] text-gray-500">{meta.label} · {relativeTime(e.at)}</p>
                  </div>
                </div>
                <div className="text-right shrink-0 font-mono text-xs">
                  <p className={positive ? 'text-neon-green' : 'text-red-400'}>{positive ? '+' : ''}{e.xpDelta} XP</p>
                  {e.goldDelta !== 0 && <p className="text-amber-400">+{e.goldDelta} gold</p>}
                </div>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
