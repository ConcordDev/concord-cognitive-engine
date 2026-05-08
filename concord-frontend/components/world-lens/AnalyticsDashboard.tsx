'use client';

import React, { useState, useMemo } from 'react';

// ── Types ──────────────────────────────────────────────────────────

type DashboardTab = 'personal' | 'world' | 'global';
type TimeRange = '7d' | '30d' | '90d' | 'all';

interface PersonalStats {
  totalCitations: number;
  totalRoyalties: number;
  mostCitedDTU: { name: string; citations: number };
  mostUsedMaterial: { name: string; uses: number };
  reputationByDomain: Record<string, number>;
  buildCount: number;
  playtime: number;
  loginStreak: number;
}

interface WorldStats {
  worldId: string;
  population: number;
  buildingCount: number;
  infraCoverage: number;
  envScore: number;
  economicActivity: number;
  visitorCount: number;
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
  timeRange?: TimeRange;
  onTimeRangeChange?: (range: TimeRange) => void;
}

// ── Seed Data ──────────────────────────────────────────────────────

const SEED_PERSONAL: PersonalStats = {
  totalCitations: 487, totalRoyalties: 34.72,
  mostCitedDTU: { name: 'USB-A Reinforced Beam', citations: 47 },
  mostUsedMaterial: { name: 'USB Composite A', uses: 89 },
  reputationByDomain: { structural: 340, materials: 120, infrastructure: 85, energy: 45, architecture: 200, mentorship: 30, governance: 15, exploration: 60 },
  buildCount: 28, playtime: 147, loginStreak: 12,
};

const SEED_WORLD: WorldStats = {
  worldId: 'concordia', population: 2400, buildingCount: 47, infraCoverage: 72,
  envScore: 68, economicActivity: 14500, visitorCount: 890,
  timeseries: [
    { date: '2025-10-01', visitors: 12, buildings: 2 },
    { date: '2025-10-15', visitors: 45, buildings: 8 },
    { date: '2025-11-01', visitors: 120, buildings: 23 },
    { date: '2025-11-15', visitors: 230, buildings: 47 },
  ],
};

const SEED_GLOBAL: GlobalStats = {
  activeDistricts: 10, totalBuildings: 1250, totalCitations: 45000, activeUsers: 890, totalWorlds: 67,
  trendingComponents: [
    { name: 'USB-B I-Beam 30cm', creator: '@struct_team', citationsThisWeek: 89 },
    { name: 'Solar Mount v3', creator: '@green_firm', citationsThisWeek: 67 },
    { name: 'Concrete Foundation Slab', creator: '@builder_bob', citationsThisWeek: 52 },
  ],
  topCreators: [
    { userId: 'u1', name: '@engineer_jane', citations: 2100, rank: 1 },
    { userId: 'u2', name: '@architect_alex', citations: 1800, rank: 2 },
    { userId: 'u3', name: '@materials_lab', citations: 1200, rank: 3 },
  ],
};

const REPUTATION_DOMAINS = ['structural', 'materials', 'infrastructure', 'energy', 'architecture', 'mentorship', 'governance', 'exploration'];
const DOMAIN_COLORS: Record<string, string> = {
  structural: 'bg-blue-500', materials: 'bg-green-500', infrastructure: 'bg-cyan-500', energy: 'bg-yellow-500',
  architecture: 'bg-purple-500', mentorship: 'bg-pink-500', governance: 'bg-orange-500', exploration: 'bg-teal-500',
};

// ── Component ──────────────────────────────────────────────────────

export default function AnalyticsDashboard({
  personalStats = SEED_PERSONAL,
  worldStats = SEED_WORLD,
  globalStats = SEED_GLOBAL,
  timeRange = '30d',
  onTimeRangeChange,
}: AnalyticsDashboardProps) {
  const [tab, setTab] = useState<DashboardTab>('personal');
  const [range, setRange] = useState<TimeRange>(timeRange);

  const maxReputation = useMemo(() => {
    return Math.max(...Object.values(personalStats.reputationByDomain), 1);
  }, [personalStats]);

  const handleRangeChange = (r: TimeRange) => {
    setRange(r);
    onTimeRangeChange?.(r);
  };

  return (
    <div className="bg-black/80 backdrop-blur-sm border border-white/10 rounded-lg p-4 space-y-4">
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
      {tab === 'personal' && (
        <div className="space-y-4">
          {/* Big numbers */}
          <div className="grid grid-cols-3 gap-3">
            <div className="text-center p-3 bg-white/5 rounded-lg">
              <p className="text-3xl font-bold text-blue-400">{personalStats.totalCitations.toLocaleString()}</p>
              <p className="text-xs text-white/50 mt-1">Total Citations</p>
            </div>
            <div className="text-center p-3 bg-white/5 rounded-lg">
              <p className="text-3xl font-bold text-yellow-400">{personalStats.totalRoyalties.toFixed(2)}</p>
              <p className="text-xs text-white/50 mt-1">Royalties Earned</p>
            </div>
            <div className="text-center p-3 bg-white/5 rounded-lg">
              <p className="text-3xl font-bold text-green-400">{personalStats.loginStreak}</p>
              <p className="text-xs text-white/50 mt-1">Day Streak</p>
            </div>
          </div>

          {/* Best DTU / Material */}
          <div className="grid grid-cols-2 gap-3">
            <div className="p-3 bg-white/5 rounded-lg">
              <p className="text-xs text-white/50">Most Cited DTU</p>
              <p className="text-sm text-white font-semibold mt-1">{personalStats.mostCitedDTU.name}</p>
              <p className="text-xs text-blue-400">{personalStats.mostCitedDTU.citations} citations</p>
            </div>
            <div className="p-3 bg-white/5 rounded-lg">
              <p className="text-xs text-white/50">Most Used Material</p>
              <p className="text-sm text-white font-semibold mt-1">{personalStats.mostUsedMaterial.name}</p>
              <p className="text-xs text-green-400">{personalStats.mostUsedMaterial.uses} uses</p>
            </div>
          </div>

          {/* Reputation Bars */}
          <div>
            <h4 className="text-xs font-semibold text-white/70 uppercase mb-2">Reputation by Domain</h4>
            <div className="space-y-1.5">
              {REPUTATION_DOMAINS.map(domain => {
                const val = personalStats.reputationByDomain[domain] || 0;
                const pct = (val / maxReputation) * 100;
                return (
                  <div key={domain} className="flex items-center gap-2">
                    <span className="text-xs text-white/60 w-24 capitalize">{domain}</span>
                    <div className="flex-1 h-3 bg-white/10 rounded-full overflow-hidden">
                      <div className={`h-full rounded-full ${DOMAIN_COLORS[domain] || 'bg-white/30'}`} style={{ width: `${pct}%` }} />
                    </div>
                    <span className="text-xs text-white/50 w-10 text-right">{val}</span>
                  </div>
                );
              })}
            </div>
          </div>

          {/* Meta stats */}
          <div className="flex items-center justify-between text-xs text-white/40 pt-2 border-t border-white/10">
            <span>{personalStats.buildCount} builds</span>
            <span>{personalStats.playtime}h playtime</span>
            <span>Top 5% structural engineers</span>
          </div>
        </div>
      )}

      {/* World Tab */}
      {tab === 'world' && (
        <div className="space-y-4">
          <div className="grid grid-cols-3 gap-3">
            <div className="text-center p-3 bg-white/5 rounded-lg">
              <p className="text-2xl font-bold text-white">{worldStats.population.toLocaleString()}</p>
              <p className="text-xs text-white/50">Population</p>
            </div>
            <div className="text-center p-3 bg-white/5 rounded-lg">
              <p className="text-2xl font-bold text-white">{worldStats.buildingCount}</p>
              <p className="text-xs text-white/50">Buildings</p>
            </div>
            <div className="text-center p-3 bg-white/5 rounded-lg">
              <p className="text-2xl font-bold text-white">{worldStats.visitorCount}</p>
              <p className="text-xs text-white/50">Visitors</p>
            </div>
          </div>

          {/* Gauges */}
          <div className="grid grid-cols-2 gap-3">
            {[
              { label: 'Infrastructure', value: worldStats.infraCoverage, color: 'bg-cyan-500' },
              { label: 'Environment', value: worldStats.envScore, color: 'bg-green-500' },
            ].map(g => (
              <div key={g.label} className="p-3 bg-white/5 rounded-lg">
                <div className="flex justify-between text-xs mb-1">
                  <span className="text-white/60">{g.label}</span>
                  <span className="text-white">{g.value}%</span>
                </div>
                <div className="h-2 bg-white/10 rounded-full">
                  <div className={`h-full rounded-full ${g.color}`} style={{ width: `${g.value}%` }} />
                </div>
              </div>
            ))}
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
            Economic Activity: {worldStats.economicActivity.toLocaleString()} CC
          </div>
        </div>
      )}

      {/* Global Tab */}
      {tab === 'global' && (
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
