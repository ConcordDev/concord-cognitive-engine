'use client';

import React, { useState, useMemo, useEffect } from 'react';
import { ds } from '@/lib/design-system';
import { lensRun } from '@/lib/api/client';
import { unavailableMessage } from '@/lib/unavailable';

// ── Types ──────────────────────────────────────────────────────────

type DashboardTab = 'personal' | 'world' | 'global';
type TimeRange = '7d' | '30d' | '90d' | 'all';

interface PersonalStats {
  totalCitations: number | null;
  totalRoyalties: number | null;
  royaltyReason?: string | null;
  mostCitedDTU: { name: string | null; citations: number | null } | null;
  mostUsedMaterial: { name: string | null; uses: number | null } | null;
  mostUsedMaterialReason?: string | null;
  reputationByDomain: Record<string, number | null>;
  reputationReason?: string | null;
  buildCount: number | null;
  buildReason?: string | null;
  playtime: number | null;
  playtimeReason?: string | null;
  loginStreak: number | null;
  loginStreakReason?: string | null;
}

interface WorldStats {
  worldId: string;
  population: number | null;
  buildingCount: number | null;
  infraCoverage: number | null;
  infraReason?: string | null;
  envScore: number | null;
  envReason?: string | null;
  economicActivity: number | null;
  visitorCount: number | null;
  timeseries?: { date: string; visitors: number; buildings: number }[];
}

interface GlobalStats {
  activeDistricts: number;
  totalBuildings: number;
  totalCitations: number;
  activeUsers: number;
  totalWorlds: number;
  trendingComponents: { name: string; creator: string; citationsThisWeek: number }[];
  topCreators: { userId: string; name: string; citations: number; rank: number }[];
}

interface AnalyticsDashboardProps {
  personalStats?: PersonalStats;
  worldStats?: WorldStats;
  globalStats?: GlobalStats;
  /** Which world the World tab should fetch real analytics for. */
  worldId?: string;
  timeRange?: TimeRange;
  onTimeRangeChange?: (range: TimeRange) => void;
}

// ── Constants ──────────────────────────────────────────────────────

const REPUTATION_DOMAINS = ['structural', 'materials', 'infrastructure', 'energy', 'architecture', 'mentorship', 'governance', 'exploration'];

function finiteOrNull(v: number | null | undefined): number | null {
  return typeof v === 'number' && Number.isFinite(v) ? v : null;
}

// A null value renders as "Not available — <reason>", never as a dash, "null" or a 0.
function Unavailable({ reason, className = 'text-xs text-white/50 py-2' }: { reason?: string | null; className?: string }) {
  return <p className={className}>{unavailableMessage(reason)}</p>;
}

// Footer-line variant of Metric: same null → "Not available — reason" rule, inline <span>.
function MetaStat({
  value, reason, format,
}: { value: number | null | undefined; reason?: string | null; format: (n: number) => string }) {
  const n = finiteOrNull(value);
  return <span>{n == null ? unavailableMessage(reason) : format(n)}</span>;
}

// A measured number (including a real 0) renders as-is; null renders Unavailable.
function Metric({
  value, reason, className, format = (n: number) => n.toLocaleString(),
}: { value: number | null | undefined; reason?: string | null; className: string; format?: (n: number) => string }) {
  const n = finiteOrNull(value);
  if (n == null) return <Unavailable reason={reason} />;
  return <p className={className}>{format(n)}</p>;
}

const DOMAIN_COLORS: Record<string, string> = {
  structural: 'bg-blue-500', materials: 'bg-green-500', infrastructure: 'bg-cyan-500', energy: 'bg-yellow-500',
  architecture: 'bg-purple-500', mentorship: 'bg-pink-500', governance: 'bg-orange-500', exploration: 'bg-teal-500',
};

// ── Component ──────────────────────────────────────────────────────

interface AnalyticsDashboardResult {
  totalEvents?: number;
  uniqueUsers?: number;
  eventsToday?: number;
  savedFunnels?: number;
  savedDashboards?: number;
  savedAlerts?: number;
  behavioralCohorts?: number;
  eventTypes?: number;
}

interface WorldSummaryResult {
  worldId?: string;
  worldName?: string | null;
  found?: boolean;
  population?: number;
  buildingCount?: number;
  standingBuildings?: number;
  infraCoverage?: number;
  /** Environment gauge on the 0-100 scale (null + envReason when unmeasured). */
  envScore?: number | null;
  envReason?: string | null;
  eventCount?: number;
  activePresence?: number;
  uniqueVisitors?: number;
  totalVisits?: number;
  taggedDtus?: number;
}

interface GlobalSummaryResult {
  totalWorlds?: number;
  activeWorlds?: number;
  totalBuildings?: number;
  totalEvents?: number;
  totalDtus?: number;
  publicDtus?: number;
  activeUsers?: number;
  totalCitations?: number;
  topWorlds?: { worldId: string; name: string | null; population: number; npcCount: number }[];
}

export default function AnalyticsDashboard({
  personalStats: personalProp,
  worldStats: worldProp,
  globalStats: globalProp,
  worldId,
  timeRange = '30d',
  onTimeRangeChange,
}: AnalyticsDashboardProps) {
  const [tab, setTab] = useState<DashboardTab>('personal');
  const [range, setRange] = useState<TimeRange>(timeRange);

  // Real data — null means "not loaded / no data" → honest empty states.
  // `analytics.analytics-dashboard` is the only backing macro; it returns
  // event-tracking aggregates, not the structural build/world/global stats
  // this panel was seeded with. We surface what genuinely maps and empty-state
  // the rest rather than fabricate.
  const [personalStats, setPersonalStats] = useState<PersonalStats | null>(personalProp ?? null);
  // World + Global tabs are now backed by REAL macros:
  //   analytics.world-summary  — per-world buildings / events / presence / DTUs
  //   analytics.global-summary — cross-world worlds / buildings / events / DTUs
  // Only fields the macros genuinely provide are mapped; the rest stay
  // empty/zero — never invented. Caller-supplied props still win.
  const [worldStats, setWorldStats] = useState<WorldStats | null>(worldProp ?? null);
  const [globalStats, setGlobalStats] = useState<GlobalStats | null>(globalProp ?? null);

  useEffect(() => {
    if (personalProp) { setPersonalStats(personalProp); return; } // caller supplied real stats — don't override
    let cancelled = false;
    (async () => {
      try {
        const r = await lensRun<AnalyticsDashboardResult>('analytics', 'analytics-dashboard', {});
        if (cancelled) return;
        const d = r.data?.result;
        if (!r.data?.ok || !d) { setPersonalStats(null); return; }
        // Map only the fields the macro genuinely provides. Its totalEvents and
        // eventsToday are event-tracking counts, not citations or a login
        // streak, so those stay null. Unmapped fields have no backend source
        // and are null with a reason, never invented zeros.
        setPersonalStats({
          totalCitations: null,
          totalRoyalties: null,
          royaltyReason: 'not_recorded',
          mostCitedDTU: null,
          mostUsedMaterial: null,
          mostUsedMaterialReason: 'not_recorded',
          reputationByDomain: {},
          reputationReason: 'not_recorded',
          buildCount: finiteOrNull(d.savedDashboards),
          buildReason: finiteOrNull(d.savedDashboards) == null ? 'not_recorded' : null,
          playtime: null,
          playtimeReason: 'not_recorded',
          loginStreak: null,
          loginStreakReason: 'not_recorded',
        });
      } catch {
        if (!cancelled) setPersonalStats(null);
      }
    })();
    return () => { cancelled = true; };
  }, [personalProp]);

  // World tab — real per-world analytics for `worldId`.
  useEffect(() => {
    if (worldProp) { setWorldStats(worldProp); return; } // caller supplied real stats
    if (!worldId) { setWorldStats(null); return; } // no world selected → empty
    let cancelled = false;
    (async () => {
      try {
        const r = await lensRun<WorldSummaryResult>('analytics', 'world-summary', { worldId });
        if (cancelled) return;
        const d = r.data?.result;
        if (!r.data?.ok || !d || d.found === false) { setWorldStats(null); return; }
        // Map only fields the macro genuinely provides. Economic activity has
        // no backend source here, so it is null; no fabricated timeseries.
        // envScore is already on the 0-100 scale from the server.
        const infra = finiteOrNull(d.infraCoverage);
        const env = finiteOrNull(d.envScore);
        setWorldStats({
          worldId: d.worldId ?? worldId,
          population: finiteOrNull(d.population),
          buildingCount: finiteOrNull(d.buildingCount),
          infraCoverage: infra,
          infraReason: infra == null ? 'not_recorded' : null,
          envScore: env,
          envReason: env == null ? (d.envReason ?? 'not_recorded') : null,
          economicActivity: null,
          visitorCount: finiteOrNull(d.uniqueVisitors),
        });
      } catch {
        if (!cancelled) setWorldStats(null);
      }
    })();
    return () => { cancelled = true; };
  }, [worldProp, worldId]);

  // Global tab — real cross-world / platform aggregate.
  useEffect(() => {
    if (globalProp) { setGlobalStats(globalProp); return; } // caller supplied real stats
    let cancelled = false;
    (async () => {
      try {
        const r = await lensRun<GlobalSummaryResult>('analytics', 'global-summary', {});
        if (cancelled) return;
        const d = r.data?.result;
        if (!r.data?.ok || !d) { setGlobalStats(null); return; }
        // Map only real aggregates. Trending components + top creators have no
        // backend source here → empty arrays, never invented.
        setGlobalStats({
          activeDistricts: d.activeWorlds ?? 0,
          totalBuildings: d.totalBuildings ?? 0,
          totalCitations: d.totalCitations ?? 0,
          activeUsers: d.activeUsers ?? 0,
          totalWorlds: d.totalWorlds ?? 0,
          trendingComponents: [],
          topCreators: [],
        });
      } catch {
        if (!cancelled) setGlobalStats(null);
      }
    })();
    return () => { cancelled = true; };
  }, [globalProp]);

  const maxReputation = useMemo(() => {
    const vals = personalStats
      ? Object.values(personalStats.reputationByDomain).filter((v): v is number => finiteOrNull(v) != null)
      : [];
    return Math.max(...vals, 1);
  }, [personalStats]);

  const handleRangeChange = (r: TimeRange) => {
    setRange(r);
    onTimeRangeChange?.(r);
  };

  return (
    <div className={`${ds.panelFloating} p-4 space-y-4`}>
      {/* Tabs */}
      <div className="flex items-center justify-between">
        <div className="flex gap-2">
          {(['personal', 'world', 'global'] as const).map(t => (
            <button key={t} onClick={() => setTab(t)}
              className={`px-4 py-1.5 rounded text-sm capitalize ${tab === t ? 'bg-white/20 text-white font-semibold' : 'text-white/50 hover:text-white/70'}`}
            >{t}</button>
          ))}
        </div>
        <div className="flex gap-1">
          {(['7d', '30d', '90d', 'all'] as const).map(r => (
            <button key={r} onClick={() => handleRangeChange(r)}
              className={`px-2 py-0.5 rounded text-xs ${range === r ? 'bg-blue-600 text-white' : 'text-white/40 hover:text-white/60'}`}
            >{r}</button>
          ))}
        </div>
      </div>

      {/* Personal Tab */}
      {tab === 'personal' && !personalStats && (
        <div className="py-12 text-center text-sm text-white/40">No personal analytics yet.</div>
      )}
      {tab === 'personal' && personalStats && (
        <div className="space-y-4">
          {/* Big numbers */}
          <div className="grid grid-cols-3 gap-3">
            <div className="text-center p-3 bg-white/5 rounded-lg">
              <Metric value={personalStats.totalCitations} reason={personalStats.royaltyReason} className="text-3xl font-bold text-blue-400" />
              <p className="text-xs text-white/50 mt-1">Total Citations</p>
            </div>
            <div className="text-center p-3 bg-white/5 rounded-lg">
              <Metric value={personalStats.totalRoyalties} reason={personalStats.royaltyReason} className="text-3xl font-bold text-yellow-400" format={(n) => n.toFixed(2)} />
              <p className="text-xs text-white/50 mt-1">Royalties Earned</p>
            </div>
            <div className="text-center p-3 bg-white/5 rounded-lg">
              <Metric value={personalStats.loginStreak} reason={personalStats.loginStreakReason} className="text-3xl font-bold text-green-400" />
              <p className="text-xs text-white/50 mt-1">Day Streak</p>
            </div>
          </div>

          {/* Best DTU / Material */}
          <div className="grid grid-cols-2 gap-3">
            <div className="p-3 bg-white/5 rounded-lg">
              <p className="text-xs text-white/50">Most Cited DTU</p>
              {personalStats.mostCitedDTU ? (
                <>
                  <p className="text-sm text-white font-semibold mt-1">{personalStats.mostCitedDTU.name || 'None yet'}</p>
                  <Metric value={personalStats.mostCitedDTU.citations} reason={personalStats.royaltyReason} className="text-xs text-blue-400" format={(n) => `${n.toLocaleString()} citations`} />
                </>
              ) : (
                <Unavailable reason={personalStats.royaltyReason ?? 'not_recorded'} />
              )}
            </div>
            <div className="p-3 bg-white/5 rounded-lg">
              <p className="text-xs text-white/50">Most Used Material</p>
              {personalStats.mostUsedMaterial ? (
                <>
                  <p className="text-sm text-white font-semibold mt-1">{personalStats.mostUsedMaterial.name || 'None yet'}</p>
                  <Metric value={personalStats.mostUsedMaterial.uses} reason={personalStats.mostUsedMaterialReason} className="text-xs text-green-400" format={(n) => `${n.toLocaleString()} uses`} />
                </>
              ) : (
                <Unavailable reason={personalStats.mostUsedMaterialReason ?? 'not_recorded'} />
              )}
            </div>
          </div>

          {/* Reputation Bars */}
          <div>
            <h4 className="text-xs font-semibold text-white/70 uppercase mb-2">Reputation by Domain</h4>
            {personalStats.reputationReason ? (
              <Unavailable reason={personalStats.reputationReason} />
            ) : (
              <div className="space-y-1.5">
                {REPUTATION_DOMAINS.map(domain => {
                  const val = finiteOrNull(personalStats.reputationByDomain[domain]);
                  const pct = val == null ? 0 : (val / maxReputation) * 100;
                  return (
                    <div key={domain} className="flex items-center gap-2">
                      <span className="text-xs text-white/60 w-24 capitalize">{domain}</span>
                      <div className="flex-1 h-3 bg-white/10 rounded-full overflow-hidden">
                        <div className={`h-full rounded-full ${DOMAIN_COLORS[domain] || 'bg-white/30'}`} style={{ width: `${pct}%` }} />
                      </div>
                      {val == null ? (
                        <span className="text-xs text-white/50 text-right">{unavailableMessage('not_recorded')}</span>
                      ) : (
                        <span className="text-xs text-white/50 w-10 text-right">{val}</span>
                      )}
                    </div>
                  );
                })}
              </div>
            )}
          </div>

          {/* Meta stats */}
          <div className="flex items-center justify-between text-xs text-white/40 pt-2 border-t border-white/10">
            <MetaStat value={personalStats.buildCount} reason={personalStats.buildReason} format={(n) => `${n.toLocaleString()} saved dashboards`} />
            <MetaStat value={personalStats.playtime} reason={personalStats.playtimeReason} format={(n) => `${n}h playtime`} />
          </div>
        </div>
      )}

      {/* World Tab */}
      {tab === 'world' && !worldStats && (
        <div className="py-12 text-center text-sm text-white/40">No world analytics yet.</div>
      )}
      {tab === 'world' && worldStats && (
        <div className="space-y-4">
          <div className="grid grid-cols-3 gap-3">
            <div className="text-center p-3 bg-white/5 rounded-lg">
              <Metric value={worldStats.population} className="text-2xl font-bold text-white" />
              <p className="text-xs text-white/50">Population</p>
            </div>
            <div className="text-center p-3 bg-white/5 rounded-lg">
              <Metric value={worldStats.buildingCount} className="text-2xl font-bold text-white" />
              <p className="text-xs text-white/50">Buildings</p>
            </div>
            <div className="text-center p-3 bg-white/5 rounded-lg">
              <Metric value={worldStats.visitorCount} className="text-2xl font-bold text-white" />
              <p className="text-xs text-white/50">Visitors</p>
            </div>
          </div>

          {/* Gauges */}
          <div className="grid grid-cols-2 gap-3">
            {[
              { label: 'Infrastructure', value: worldStats.infraCoverage, reason: worldStats.infraReason, color: 'bg-cyan-500' },
              { label: 'Environment', value: worldStats.envScore, reason: worldStats.envReason, color: 'bg-green-500' },
            ].map(g => {
              // Both gauges are 0-100 percents. A finite value outside that range is
              // shown as unavailable, never clamped and presented as a real reading.
              const raw = finiteOrNull(g.value);
              const n = raw != null && raw >= 0 && raw <= 100 ? raw : null;
              const reason = raw != null && n == null ? 'out_of_range' : g.reason;
              return (
              <div key={g.label} className="p-3 bg-white/5 rounded-lg">
                <div className="flex justify-between text-xs mb-1">
                  <span className="text-white/60">{g.label}</span>
                  {n == null ? (
                    <span className="text-white/50 text-right">{unavailableMessage(reason)}</span>
                  ) : (
                    <span className="text-white">{`${n}%`}</span>
                  )}
                </div>
                <div className="h-2 bg-white/10 rounded-full">
                  <div className={`h-full rounded-full ${g.color}`} style={{ width: `${n ?? 0}%` }} />
                </div>
              </div>
              );
            })}
          </div>

          {/* Mini chart */}
          {worldStats.timeseries && worldStats.timeseries.length > 0 && (
            <div className="p-3 bg-white/5 rounded-lg">
              <h4 className="text-xs text-white/50 mb-2">Visitors Over Time</h4>
              <div className="flex items-end gap-1 h-16">
                {worldStats.timeseries.map((dp, i) => {
                  const maxV = Math.max(...worldStats.timeseries!.map(d => d.visitors));
                  const h = maxV > 0 ? (dp.visitors / maxV) * 100 : 0;
                  return (
                    <div key={i} className="flex-1 flex flex-col items-center gap-0.5">
                      <div className="w-full bg-blue-500/60 rounded-t" style={{ height: `${h}%` }} />
                      <span className="text-[8px] text-white/30">{dp.date.split('-').slice(1).join('/')}</span>
                    </div>
                  );
                })}
              </div>
            </div>
          )}

          <div className="text-center text-xs text-white/40">
            Economic Activity: {finiteOrNull(worldStats.economicActivity) == null
              ? unavailableMessage('not_recorded')
              : `${(worldStats.economicActivity as number).toLocaleString()} CC`}
          </div>
        </div>
      )}

      {/* Global Tab */}
      {tab === 'global' && !globalStats && (
        <div className="py-12 text-center text-sm text-white/40">No global analytics yet.</div>
      )}
      {tab === 'global' && globalStats && (
        <div className="space-y-4">
          {/* Platform stats */}
          <div className="grid grid-cols-4 gap-2">
            {[
              { label: 'Districts', value: globalStats.activeDistricts },
              { label: 'Buildings', value: globalStats.totalBuildings },
              { label: 'Citations', value: globalStats.totalCitations },
              { label: 'Users', value: globalStats.activeUsers },
            ].map(s => (
              <div key={s.label} className="text-center p-2 bg-white/5 rounded">
                <p className="text-lg font-bold text-white">{s.value >= 1000 ? `${(s.value / 1000).toFixed(1)}k` : s.value}</p>
                <p className="text-[10px] text-white/40">{s.label}</p>
              </div>
            ))}
          </div>

          {/* Trending */}
          <div>
            <h4 className="text-xs font-semibold text-white/70 uppercase mb-2">Trending Components</h4>
            <div className="space-y-1.5">
              {globalStats.trendingComponents.map((tc, i) => (
                <div key={i} className="flex items-center justify-between p-2 bg-white/5 rounded">
                  <div>
                    <p className="text-sm text-white">{tc.name}</p>
                    <p className="text-xs text-white/40">{tc.creator}</p>
                  </div>
                  <div className="text-right">
                    <p className="text-sm text-blue-400">+{tc.citationsThisWeek}</p>
                    <p className="text-[10px] text-white/30">this week</p>
                  </div>
                </div>
              ))}
            </div>
          </div>

          {/* Top Creators */}
          <div>
            <h4 className="text-xs font-semibold text-white/70 uppercase mb-2">Top Creators</h4>
            <div className="space-y-1.5">
              {globalStats.topCreators.map(tc => (
                <div key={tc.userId} className="flex items-center gap-3 p-2 bg-white/5 rounded">
                  <span className="text-lg">{tc.rank === 1 ? '🥇' : tc.rank === 2 ? '🥈' : '🥉'}</span>
                  <div className="flex-1">
                    <p className="text-sm text-white">{tc.name}</p>
                  </div>
                  <span className="text-sm text-yellow-400">{tc.citations.toLocaleString()} citations</span>
                </div>
              ))}
            </div>
          </div>

          <div className="text-center text-xs text-white/30">{globalStats.totalWorlds} worlds active</div>
        </div>
      )}
    </div>
  );
}
