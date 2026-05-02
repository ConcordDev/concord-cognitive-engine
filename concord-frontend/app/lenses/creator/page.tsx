'use client';

import { useEffect, useState } from 'react';

interface CreatorSummary {
  dtuCount: number;
  listingCount: number;
  totalDownloads: number;
  totalEarnings: number;
  citationsReceived: number;
  citationsMade: number;
  lineageDepth: number;
  reputationScore: number;
}

interface DashboardResponse {
  ok: boolean;
  userId?: string;
  summary?: CreatorSummary;
  recentDTUs?: { id: string; title: string; domain: string; createdAt: string }[];
  recentListings?: { id: string; title: string; price: number; downloads: number; promotionSource: string | null }[];
  topCitedDTUs?: { id: string; title: string; domain: string; citationsReceived: number }[];
  error?: string;
}

interface Leader {
  userId: string;
  dtuCount: number;
  citations: number;
  downloads: number;
  score: number;
}

interface TrendingHit {
  id: string;
  title: string;
  domain: string;
  ownerId: string;
  newCitations24h: number;
}

interface DriftHit {
  userId: string;
  recentCitations: number;
  priorCitations: number;
  change: number;
}

const PANEL = 'rounded-lg border border-white/10 bg-black/60 p-4';
const GRID  = 'grid grid-cols-1 md:grid-cols-2 gap-4';

export default function CreatorDashboardPage() {
  const [me, setMe] = useState<DashboardResponse | null>(null);
  const [leaderboard, setLeaderboard] = useState<Leader[]>([]);
  const [trending, setTrending] = useState<TrendingHit[]>([]);
  const [drift, setDrift] = useState<DriftHit[]>([]);

  useEffect(() => {
    Promise.all([
      fetch('/api/creator/dashboard', { credentials: 'include' }).then(r => r.json()).catch(() => null),
      fetch('/api/creator/leaderboard?limit=10', { credentials: 'include' }).then(r => r.json()).catch(() => null),
      fetch('/api/creator/trending-citations', { credentials: 'include' }).then(r => r.json()).catch(() => null),
      fetch('/api/creator/influence-drift', { credentials: 'include' }).then(r => r.json()).catch(() => null),
    ]).then(([m, l, t, d]) => {
      setMe(m as DashboardResponse | null);
      setLeaderboard((l?.creators ?? []) as Leader[]);
      setTrending((t?.trending ?? []) as TrendingHit[]);
      setDrift((d?.drift ?? []) as DriftHit[]);
    });
  }, []);

  return (
    <div className="min-h-screen bg-[#0b0f17] text-gray-100 p-6">
      <header className="mb-6">
        <h1 className="text-3xl font-semibold text-amber-300">Creator Dashboard</h1>
        <p className="text-gray-400 mt-1">
          Earnings, lineage, and influence at a glance. All numbers reflect live state.
        </p>
      </header>

      {/* Personal summary */}
      {me?.ok && me.summary ? (
        <section className={`${PANEL} mb-6`}>
          <h2 className="text-amber-200 font-semibold mb-3">Your stats</h2>
          <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
            <Stat label="DTUs"               value={me.summary.dtuCount} />
            <Stat label="Listings"           value={me.summary.listingCount} />
            <Stat label="Downloads"          value={me.summary.totalDownloads} />
            <Stat label="Earnings (CC)"      value={me.summary.totalEarnings} />
            <Stat label="Citations received" value={me.summary.citationsReceived} />
            <Stat label="Citations made"     value={me.summary.citationsMade} />
            <Stat label="Max lineage depth"  value={me.summary.lineageDepth} />
            <Stat label="Reputation score"   value={me.summary.reputationScore} />
          </div>
        </section>
      ) : (
        <div className={`${PANEL} mb-6 text-gray-500 italic`}>
          {me?.error ? `Sign in to see your dashboard.` : 'Loading your stats...'}
        </div>
      )}

      <div className={GRID}>
        {/* Leaderboard */}
        <section className={PANEL}>
          <h2 className="text-violet-300 font-semibold mb-3">Top creators</h2>
          {leaderboard.length === 0 ? (
            <div className="text-gray-500 italic">No data yet.</div>
          ) : (
            <ol className="space-y-1 text-sm">
              {leaderboard.map((c, i) => (
                <li key={c.userId} className="flex items-center gap-3">
                  <span className="w-6 text-amber-400 font-mono">{i + 1}</span>
                  <span className="flex-1 truncate text-gray-200">{c.userId}</span>
                  <span className="text-violet-300 font-mono">{Math.round(c.score)}</span>
                </li>
              ))}
            </ol>
          )}
        </section>

        {/* Trending citations */}
        <section className={PANEL}>
          <h2 className="text-emerald-300 font-semibold mb-3">Trending citations (24h)</h2>
          {trending.length === 0 ? (
            <div className="text-gray-500 italic">No surge.</div>
          ) : (
            <ul className="space-y-2 text-sm">
              {trending.slice(0, 8).map((t) => (
                <li key={t.id} className="border-l-2 border-emerald-400/40 pl-3">
                  <div className="text-gray-100 font-medium truncate">{t.title}</div>
                  <div className="text-xs text-gray-500">
                    {t.domain} · +{t.newCitations24h} new citations
                  </div>
                </li>
              ))}
            </ul>
          )}
        </section>

        {/* Influence drift */}
        <section className={`${PANEL} md:col-span-2`}>
          <h2 className="text-rose-300 font-semibold mb-3">Influence drift (7d)</h2>
          {drift.length === 0 ? (
            <div className="text-gray-500 italic">No significant drift.</div>
          ) : (
            <table className="w-full text-sm">
              <thead className="text-gray-500 text-xs uppercase tracking-wider">
                <tr>
                  <th className="text-left py-1">Creator</th>
                  <th className="text-right py-1">Recent</th>
                  <th className="text-right py-1">Prior</th>
                  <th className="text-right py-1">Change</th>
                </tr>
              </thead>
              <tbody>
                {drift.map((d) => (
                  <tr key={d.userId} className="border-t border-white/5">
                    <td className="py-1 text-gray-200 truncate">{d.userId}</td>
                    <td className="py-1 text-right text-gray-300">{d.recentCitations}</td>
                    <td className="py-1 text-right text-gray-500">{d.priorCitations}</td>
                    <td className={`py-1 text-right font-mono ${d.change > 0 ? 'text-emerald-400' : d.change < 0 ? 'text-rose-400' : 'text-gray-400'}`}>
                      {d.change > 0 ? '+' : ''}{d.change}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </section>
      </div>
    </div>
  );
}

function Stat({ label, value }: { label: string; value: number | string }) {
  return (
    <div>
      <div className="text-[10px] text-gray-500 uppercase tracking-wider">{label}</div>
      <div className="text-2xl text-amber-300 font-mono mt-1">{value}</div>
    </div>
  );
}
