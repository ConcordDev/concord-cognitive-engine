'use client';

/**
 * NewsSourceTransparency — Ground News-shape source profile: bias lean,
 * factuality rating, transparency metrics and topic spread. Every value is
 * computed by `news.source-profile` from the real article corpus.
 */

import { useCallback, useEffect, useState } from 'react';
import { Loader2, ShieldCheck, BadgeCheck, AlertTriangle } from 'lucide-react';

import { lensRun } from '@/lib/api/client';
import { cn } from '@/lib/utils';

interface Channel {
  source: string;
  articleCount: number;
}

interface SourceProfile {
  source: string;
  articleCount: number;
  contributors: number;
  biasLean: 'left' | 'center' | 'right';
  biasScore: number;
  factualityRating: number;
  factualityLabel: 'high' | 'mixed' | 'low';
  transparency: { summaryRate: number; hedgeRate: number };
  topicSpread: { topic: string; count: number }[];
}

const LEAN_STYLE: Record<string, string> = {
  left: 'text-blue-300 bg-blue-500/10 border-blue-500/30',
  center: 'text-zinc-300 bg-zinc-500/10 border-zinc-500/30',
  right: 'text-red-300 bg-red-500/10 border-red-500/30',
};

const FACT_STYLE: Record<string, string> = {
  high: 'text-emerald-300 bg-emerald-500/10 border-emerald-500/30',
  mixed: 'text-amber-300 bg-amber-500/10 border-amber-500/30',
  low: 'text-red-300 bg-red-500/10 border-red-500/30',
};

export function NewsSourceTransparency() {
  const [channels, setChannels] = useState<Channel[]>([]);
  const [selected, setSelected] = useState<string | null>(null);
  const [profile, setProfile] = useState<SourceProfile | null>(null);
  const [loading, setLoading] = useState(true);
  const [profileLoading, setProfileLoading] = useState(false);

  const refresh = useCallback(async () => {
    setLoading(true);
    const r = await lensRun('news', 'channel-list', {});
    if (r.data?.ok) setChannels((r.data.result?.channels as Channel[]) || []);
    setLoading(false);
  }, []);

  useEffect(() => { void refresh(); }, [refresh]);

  const loadProfile = useCallback(async (source: string) => {
    setSelected(source);
    setProfileLoading(true);
    const r = await lensRun('news', 'source-profile', { source });
    if (r.data?.ok) setProfile(r.data.result as SourceProfile);
    else setProfile(null);
    setProfileLoading(false);
  }, []);

  return (
    <div className="rounded-2xl border border-zinc-800 bg-zinc-950/60 overflow-hidden">
      <header className="flex items-center gap-2 px-4 py-3 border-b border-zinc-800 bg-gradient-to-r from-indigo-600/15 to-transparent">
        <ShieldCheck className="w-5 h-5 text-indigo-400" />
        <h2 className="text-sm font-bold text-zinc-100">Source Transparency</h2>
        <span className="text-[11px] text-zinc-500">Bias · factuality · blindspots</span>
      </header>

      {loading ? (
        <div className="flex items-center justify-center py-10 text-zinc-500">
          <Loader2 className="w-5 h-5 animate-spin" />
        </div>
      ) : channels.length === 0 ? (
        <div className="px-4 py-10 text-center text-zinc-500 text-sm italic">
          No data yet — add articles so sources can be profiled.
        </div>
      ) : (
        <div className="grid grid-cols-1 md:grid-cols-2 divide-y md:divide-y-0 md:divide-x divide-zinc-800">
          {/* Source list */}
          <ul className="max-h-80 overflow-y-auto">
            {channels.map((c) => (
              <li key={c.source}>
                <button
                  type="button"
                  onClick={() => void loadProfile(c.source)}
                  className={cn(
                    'w-full flex items-center justify-between gap-2 px-4 py-2.5 text-left hover:bg-zinc-900/60 focus:outline-none focus:ring-2 focus:ring-indigo-500',
                    selected === c.source && 'bg-indigo-500/5',
                  )}
                >
                  <span className="text-xs font-medium text-zinc-100 truncate">{c.source}</span>
                  <span className="text-[10px] text-zinc-500 shrink-0">{c.articleCount} articles</span>
                </button>
              </li>
            ))}
          </ul>

          {/* Profile panel */}
          <div className="p-4">
            {profileLoading ? (
              <div className="flex items-center justify-center py-8 text-zinc-500">
                <Loader2 className="w-4 h-4 animate-spin" />
              </div>
            ) : !profile ? (
              <p className="text-[11px] text-zinc-600 italic text-center py-8">
                Select a source to view its transparency profile.
              </p>
            ) : (
              <div className="space-y-3">
                <div>
                  <p className="text-sm font-bold text-zinc-100">{profile.source}</p>
                  <p className="text-[10px] text-zinc-500">
                    {profile.articleCount} articles · {profile.contributors} contributor
                    {profile.contributors === 1 ? '' : 's'}
                  </p>
                </div>

                <div className="flex flex-wrap gap-2">
                  <span className={cn('text-[10px] px-2 py-0.5 rounded-full border capitalize', LEAN_STYLE[profile.biasLean])}>
                    {profile.biasLean} lean ({profile.biasScore > 0 ? '+' : ''}{profile.biasScore})
                  </span>
                  <span className={cn('flex items-center gap-1 text-[10px] px-2 py-0.5 rounded-full border capitalize', FACT_STYLE[profile.factualityLabel])}>
                    {profile.factualityLabel === 'low' ? (
                      <AlertTriangle className="w-3 h-3" />
                    ) : (
                      <BadgeCheck className="w-3 h-3" />
                    )}
                    {profile.factualityLabel} factuality · {profile.factualityRating}%
                  </span>
                </div>

                {/* Transparency metrics */}
                <div className="space-y-1.5">
                  <Metric label="Articles with summaries" pct={profile.transparency.summaryRate} good />
                  <Metric label="Hedged / unverified claims" pct={profile.transparency.hedgeRate} />
                </div>

                {/* Topic spread */}
                {profile.topicSpread.length > 0 && (
                  <div>
                    <p className="text-[10px] uppercase tracking-wide text-zinc-500 mb-1">Topic spread</p>
                    <div className="flex flex-wrap gap-1">
                      {profile.topicSpread.map((t) => (
                        <span
                          key={t.topic}
                          className="text-[10px] px-1.5 py-0.5 rounded bg-zinc-800 text-zinc-300 capitalize"
                        >
                          {t.topic} · {t.count}
                        </span>
                      ))}
                    </div>
                  </div>
                )}
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  );
}

function Metric({ label, pct, good }: { label: string; pct: number; good?: boolean }) {
  return (
    <div>
      <div className="flex justify-between text-[10px] text-zinc-400">
        <span>{label}</span>
        <span className="font-mono">{pct}%</span>
      </div>
      <div className="h-1.5 rounded-full bg-zinc-800 overflow-hidden mt-0.5">
        <div
          className={cn('h-full rounded-full', good ? 'bg-emerald-500' : 'bg-amber-500')}
          style={{ width: `${Math.min(100, Math.max(0, pct))}%` }}
        />
      </div>
    </div>
  );
}
