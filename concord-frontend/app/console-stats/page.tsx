'use client';

/**
 * /console-stats — public demand-visibility page.
 *
 * Shows live counts of sessions on each device class — Xbox /
 * PlayStation / Switch / Steam Deck / desktop / mobile / tablet —
 * over the last hour, last 24h, and last 7 days. The strategic
 * point: by making this public, platform holders can see exactly
 * how much traffic Concord is sending them via their own browsers,
 * and that becomes the leverage for native-integration conversations.
 *
 * No PII rendered. The endpoint behind this page only persists
 * hour-bucketed counts derived from User-Agent + optional gamepad
 * id; nothing user-identifiable.
 */

import { useEffect, useState } from 'react';
import { Activity, Monitor, Smartphone, Gamepad2, Tablet } from 'lucide-react';

import { api } from '@/lib/api/client';
import { cn } from '@/lib/utils';

interface StatsResponse {
  ok: boolean;
  deviceClasses: string[];
  lastHour: Record<string, number>;
  last24h: Record<string, number>;
  last7d: Record<string, number>;
  series: Array<{ hour: string; counts: Record<string, number> }>;
  totalActive24h: number;
  consoleActive24h: number;
  consolePct24h: number;
}

const DEVICE_META: Record<string, { label: string; emoji: string; tone: string }> = {
  'xbox':         { label: 'Xbox',         emoji: '🟢', tone: 'text-emerald-300' },
  'playstation':  { label: 'PlayStation',  emoji: '🔷', tone: 'text-sky-300' },
  'switch':       { label: 'Switch',       emoji: '🟥', tone: 'text-rose-300' },
  'steam-deck':   { label: 'Steam Deck',   emoji: '🟦', tone: 'text-blue-300' },
  'desktop':      { label: 'Desktop',      emoji: '🖥️',  tone: 'text-gray-300' },
  'mobile':       { label: 'Mobile',       emoji: '📱',  tone: 'text-cyan-300' },
  'tablet':       { label: 'Tablet',       emoji: '📔',  tone: 'text-violet-300' },
  'unknown':      { label: 'Unknown',      emoji: '·',   tone: 'text-gray-500' },
};

export default function ConsoleStatsPage() {
  const [stats, setStats] = useState<StatsResponse | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let mounted = true;
    const fetchStats = () => {
      api
        .get<StatsResponse>('/api/telemetry/console-stats')
        .then((r) => {
          if (!mounted) return;
          setStats(r.data);
          setLoading(false);
        })
        .catch(() => {
          if (mounted) setLoading(false);
        });
    };
    fetchStats();
    const t = setInterval(fetchStats, 60_000); // refresh every minute
    return () => {
      mounted = false;
      clearInterval(t);
    };
  }, []);

  return (
    <main className="min-h-screen bg-[#0a0a0d] text-gray-100 p-6">
      <div className="max-w-5xl mx-auto">
        <header className="mb-8">
          <h1 className="text-3xl font-semibold inline-flex items-center gap-3">
            <Activity className="w-7 h-7 text-emerald-300" />
            Where Concord runs
          </h1>
          <p className="text-sm text-gray-400 mt-2 max-w-2xl">
            Live demand counter across device classes. No platform deals — Concord runs in
            every console&rsquo;s built-in browser the same way it runs on desktop. The
            numbers below are real traffic, refreshed every minute, with no PII attached.
          </p>
        </header>

        {loading && !stats ? (
          <div className="text-sm text-gray-500 italic">Reading the signal…</div>
        ) : !stats ? (
          <div className="text-sm text-rose-300">Stats unavailable. Try again shortly.</div>
        ) : (
          <>
            {/* Headline: console share of total */}
            <section className="mb-6 rounded-lg border border-emerald-500/30 bg-emerald-500/5 p-5">
              <div className="text-xs uppercase tracking-wider text-emerald-300/80 mb-2">
                Console share, last 24 hours
              </div>
              <div className="flex items-baseline gap-3">
                <span className="text-5xl font-mono text-emerald-200 tabular-nums">
                  {stats.consolePct24h.toFixed(1)}%
                </span>
                <span className="text-sm text-gray-400">
                  · {stats.consoleActive24h.toLocaleString()} of {stats.totalActive24h.toLocaleString()} sessions came from Xbox / PlayStation / Switch / Steam Deck
                </span>
              </div>
              <p className="mt-3 text-xs text-emerald-200/80 max-w-3xl">
                Each of those sessions arrived through the console&rsquo;s built-in browser.
                Microsoft, Sony, Valve, and Nintendo received zero install requests, zero
                cert submissions, zero exclusivity asks.
              </p>
            </section>

            {/* Device-class breakdown */}
            <section className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 gap-3 mb-8">
              {stats.deviceClasses.map((cls) => {
                const meta = DEVICE_META[cls] ?? DEVICE_META.unknown;
                const last24 = stats.last24h[cls] ?? 0;
                const last7 = stats.last7d[cls] ?? 0;
                const lastH = stats.lastHour[cls] ?? 0;
                return (
                  <article
                    key={cls}
                    className="rounded-md border border-white/10 bg-black/40 p-3"
                  >
                    <div className="flex items-baseline justify-between mb-1">
                      <span className="text-sm font-semibold text-white">{meta.emoji} {meta.label}</span>
                      {lastH > 0 && (
                        <span className="text-[10px] text-emerald-300 font-mono">live</span>
                      )}
                    </div>
                    <div className={cn('text-2xl font-mono tabular-nums', meta.tone)}>
                      {last24.toLocaleString()}
                    </div>
                    <div className="text-[10px] text-gray-500 mt-1">
                      24h · {last7.toLocaleString()} this week
                    </div>
                  </article>
                );
              })}
            </section>

            {/* Hourly time-series */}
            <section className="rounded-lg border border-white/10 bg-black/40 p-4 mb-6">
              <div className="flex items-baseline justify-between mb-3">
                <h2 className="text-sm font-semibold text-white">Last 24 hours, hourly</h2>
                <span className="text-[10px] text-gray-500 font-mono">stacked counts</span>
              </div>
              <SeriesBars series={stats.series} />
            </section>

            <footer className="text-xs text-gray-500 max-w-2xl">
              <p className="mb-2">
                <strong className="text-gray-300">Why this is public:</strong> when N thousand
                console players choose Concord without their platform&rsquo;s help, that&rsquo;s a
                signal worth seeing. The leverage isn&rsquo;t in our marketing copy &mdash; it&rsquo;s in
                this counter.
              </p>
              <p className="flex flex-wrap items-center gap-2">
                <Monitor className="w-3 h-3" /> Browser-only
                <span aria-hidden>·</span>
                <Gamepad2 className="w-3 h-3" /> Standard Gamepad API
                <span aria-hidden>·</span>
                <Smartphone className="w-3 h-3" /> Mobile via PWA
                <span aria-hidden>·</span>
                <Tablet className="w-3 h-3" /> Tablet ready
              </p>
            </footer>
          </>
        )}
      </div>
    </main>
  );
}

interface SeriesBarsProps {
  series: Array<{ hour: string; counts: Record<string, number> }>;
}

function SeriesBars({ series }: SeriesBarsProps) {
  const max = Math.max(
    1,
    ...series.map((s) => Object.values(s.counts).reduce((a, b) => a + b, 0))
  );
  const consoleClasses = ['xbox', 'playstation', 'switch', 'steam-deck'];
  const otherClasses   = ['desktop', 'mobile', 'tablet', 'unknown'];
  return (
    <div className="flex items-end gap-1 h-32 overflow-x-auto">
      {series.map((s) => {
        const consoleCount = consoleClasses.reduce((a, k) => a + (s.counts[k] || 0), 0);
        const otherCount   = otherClasses.reduce((a, k) => a + (s.counts[k] || 0), 0);
        const total = consoleCount + otherCount;
        const consolePct = total > 0 ? (consoleCount / max) * 100 : 0;
        const otherPct   = total > 0 ? (otherCount / max) * 100 : 0;
        const hour = new Date(s.hour);
        const label = `${hour.getHours()}h`;
        return (
          <div key={s.hour} className="flex flex-col items-center gap-0.5 flex-1 min-w-[10px]">
            <div className="flex flex-col-reverse w-full h-28 justify-start">
              <div
                className="w-full bg-emerald-400/40"
                style={{ height: `${consolePct}%` }}
                title={`${consoleCount} console`}
              />
              <div
                className="w-full bg-white/10"
                style={{ height: `${otherPct}%` }}
                title={`${otherCount} other`}
              />
            </div>
            <span className="text-[8px] text-gray-600 font-mono">{label}</span>
          </div>
        );
      })}
    </div>
  );
}
