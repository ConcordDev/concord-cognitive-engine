'use client';

import Link from 'next/link';
import { useCallback, useEffect, useState } from 'react';
import { Activity, Loader2, FileText } from 'lucide-react';
import { lensRun } from '@/lib/api/client';
import { getLensById } from '@/lib/lens-registry';

interface DomainStatsResult {
  totalDtus: number;
  domains: number;
  topDomains: { domain: string; count: number }[];
  message?: string;
}

interface ActivityRow { dtuId: string; title?: string; domain?: string; createdAt?: string; creatorId?: string }
interface RecentActivityResult { feed: ActivityRow[] }

function relTime(iso?: string): string {
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
 * SubstratePulsePanel — the launcher's "what's happening across the whole
 * substrate right now" surface. Sourced from the real `all.domainStats`
 * (DTU counts per domain) + `all.recentActivity` (cross-domain creation
 * feed) macros — both computed live off the running DTU store, not a
 * canned snapshot. Silently renders nothing when the substrate is empty
 * (fresh install / no DTUs yet) rather than showing a fabricated number.
 */
export function SubstratePulsePanel() {
  const [stats, setStats] = useState<DomainStatsResult | null>(null);
  const [feed, setFeed] = useState<ActivityRow[]>([]);
  const [loading, setLoading] = useState(true);

  const load = useCallback(async () => {
    setLoading(true);
    const [statsRes, feedRes] = await Promise.all([
      lensRun<DomainStatsResult>('all', 'domainStats', {}),
      lensRun<RecentActivityResult>('all', 'recentActivity', { limit: 8 }),
    ]);
    if (statsRes.data?.ok && statsRes.data.result) setStats(statsRes.data.result);
    if (feedRes.data?.ok && feedRes.data.result) setFeed(feedRes.data.result.feed || []);
    setLoading(false);
  }, []);

  useEffect(() => { void load(); }, [load]);

  if (loading) {
    return (
      <section className="panel p-4">
        <div className="flex items-center gap-2 text-xs text-gray-400">
          <Loader2 className="w-3.5 h-3.5 animate-spin" /> Reading the substrate…
        </div>
      </section>
    );
  }

  const hasData = (stats?.totalDtus ?? 0) > 0 && feed.length > 0;
  if (!hasData) return null; // honest empty-state: nothing fabricated to show yet

  return (
    <section className="panel p-4">
      <h2 className="text-sm uppercase tracking-wider text-neon-cyan flex items-center gap-2 mb-3">
        <Activity className="w-4 h-4" /> Substrate pulse
      </h2>
      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
        <div>
          <p className="text-[11px] text-gray-400 mb-2">
            {stats?.totalDtus.toLocaleString()} DTUs across {stats?.domains} domains · top by volume
          </p>
          <div className="space-y-1.5">
            {(stats?.topDomains || []).slice(0, 6).map((d) => {
              const lens = getLensById(d.domain);
              const max = stats?.topDomains?.[0]?.count || 1;
              return (
                <Link
                  key={d.domain}
                  href={lens?.path || `/lenses/${d.domain}`}
                  className="flex items-center gap-2 text-xs group"
                >
                  <span className="w-20 truncate text-gray-400 group-hover:text-white">{lens?.name || d.domain}</span>
                  <span className="flex-1 h-1.5 rounded-full bg-lattice-void overflow-hidden">
                    <span
                      className="block h-full bg-neon-cyan/60 group-hover:bg-neon-cyan"
                      style={{ width: `${Math.max(4, Math.round((d.count / max) * 100))}%` }}
                    />
                  </span>
                  <span className="w-8 text-right text-gray-400">{d.count}</span>
                </Link>
              );
            })}
          </div>
        </div>
        <div>
          <p className="text-[11px] text-gray-400 mb-2">Recent activity, every domain</p>
          <div className="space-y-1 max-h-40 overflow-y-auto">
            {feed.map((row) => {
              const lens = row.domain ? getLensById(row.domain) : undefined;
              return (
                <Link
                  key={row.dtuId}
                  href={lens?.path ? `${lens.path}?dtu=${encodeURIComponent(row.dtuId)}` : `/lenses/dtus?id=${encodeURIComponent(row.dtuId)}`}
                  className="flex items-center gap-2 text-xs hover:text-white text-gray-400"
                >
                  <FileText className="w-3 h-3 shrink-0 text-neon-cyan/70" />
                  <span className="truncate flex-1">{row.title || row.dtuId}</span>
                  {row.domain && <span className="text-[9px] px-1 rounded bg-lattice-void shrink-0">{row.domain}</span>}
                  <span className="text-[10px] shrink-0">{relTime(row.createdAt)}</span>
                </Link>
              );
            })}
          </div>
        </div>
      </div>
    </section>
  );
}
