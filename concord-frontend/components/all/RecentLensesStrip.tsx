'use client';

import Link from 'next/link';
import { useCallback, useEffect, useState } from 'react';
import { Clock, Loader2, TrendingUp } from 'lucide-react';
import { lensRun } from '@/lib/api/client';
import { getLensById } from '@/lib/lens-registry';

interface UsageRow { lensId: string; count: number; lastAt: string | null; firstAt: string | null }
interface UsageListResult { mode: string; recent: UsageRow[]; frequent: UsageRow[]; totalTracked: number }

function relTime(iso: string | null): string {
  if (!iso) return '';
  const ms = Date.now() - new Date(iso).getTime();
  if (!Number.isFinite(ms) || ms < 0) return '';
  const m = Math.floor(ms / 60000);
  if (m < 1) return 'just now';
  if (m < 60) return `${m}m ago`;
  const h = Math.floor(m / 60);
  if (h < 24) return `${h}h ago`;
  return `${Math.floor(h / 24)}d ago`;
}

/**
 * RecentLensesStrip — recency / frequency lens ordering, sourced from the
 * per-user usage ledger (`all.usage-list`). Toggle between Recent and
 * Most-used views. `refreshKey` forces a re-fetch after a lens open.
 */
export function RecentLensesStrip({ refreshKey }: { refreshKey: number }) {
  const [data, setData] = useState<UsageListResult | null>(null);
  const [mode, setMode] = useState<'recent' | 'frequent'>('recent');
  const [loading, setLoading] = useState(true);

  const load = useCallback(async () => {
    setLoading(true);
    const r = await lensRun<UsageListResult>('all', 'usage-list', { limit: 12 });
    if (r.data?.ok && r.data.result) setData(r.data.result);
    setLoading(false);
  }, []);

  useEffect(() => { void load(); }, [load, refreshKey]);

  const rows = mode === 'recent' ? data?.recent ?? [] : data?.frequent ?? [];

  return (
    <section className="panel p-4">
      <div className="flex items-center justify-between mb-3">
        <h2 className="text-sm uppercase tracking-wider text-neon-cyan flex items-center gap-2">
          <Clock className="w-4 h-4" /> {mode === 'recent' ? 'Recently used' : 'Most used'}
        </h2>
        <div className="flex items-center gap-1 text-[11px]">
          <button
            type="button"
            onClick={() => setMode('recent')}
            className={`px-2 py-1 rounded ${mode === 'recent' ? 'bg-neon-cyan/15 text-neon-cyan' : 'text-gray-500 hover:text-white'}`}
          >
            <Clock className="w-3 h-3 inline mr-1" />Recent
          </button>
          <button
            type="button"
            onClick={() => setMode('frequent')}
            className={`px-2 py-1 rounded ${mode === 'frequent' ? 'bg-neon-cyan/15 text-neon-cyan' : 'text-gray-500 hover:text-white'}`}
          >
            <TrendingUp className="w-3 h-3 inline mr-1" />Most used
          </button>
        </div>
      </div>
      {loading ? (
        <div className="flex items-center gap-2 text-xs text-gray-500">
          <Loader2 className="w-3.5 h-3.5 animate-spin" /> Loading usage history…
        </div>
      ) : rows.length === 0 ? (
        <p className="text-xs text-gray-500">No lens history yet. Open a lens and it will appear here.</p>
      ) : (
        <div className="flex flex-wrap gap-2">
          {rows.map((row) => {
            const lens = getLensById(row.lensId);
            const Icon = lens?.icon;
            return (
              <Link
                key={row.lensId}
                href={lens?.path || `/lenses/${row.lensId}`}
                className="flex items-center gap-2 bg-lattice-void border border-lattice-border rounded-lg px-3 py-1.5 text-sm text-white hover:border-neon-cyan/50 transition-colors"
              >
                {Icon ? <Icon className="w-3.5 h-3.5 text-neon-cyan" /> : null}
                <span className="truncate max-w-[10rem]">{lens?.name || row.lensId}</span>
                <span className="text-[10px] text-gray-500">
                  {mode === 'frequent' ? `${row.count}×` : relTime(row.lastAt)}
                </span>
              </Link>
            );
          })}
        </div>
      )}
    </section>
  );
}
