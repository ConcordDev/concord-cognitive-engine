'use client';

/**
 * ExpeditionSummary — cross-world progress overview. Surfaces overall
 * completion, the per-world stacked progress chart, an XP/level rollup
 * and the earned-badge ledger. Data comes from the
 * expedition-journal.summary + .rewards backend macros.
 */

import { ChartKit } from '@/components/viz';
import { Award, Trophy, Flag, Compass, Globe } from 'lucide-react';

export interface WorldStage {
  id: string;
  title: string;
  done: boolean;
}

export interface WorldView {
  worldId: string;
  stages: WorldStage[];
  completed: number;
  total: number;
  percent: number;
  expeditionComplete: boolean;
}

export interface SummaryData {
  worlds: WorldView[];
  totalStages: number;
  completedStages: number;
  overallPercent: number;
  completedWorlds: number;
  totalWorlds: number;
  xp: number;
  level: number;
  badgeCount: number;
  entryCount: number;
  photoCount: number;
}

export interface Badge {
  id: string;
  worldId: string | null;
  title: string;
  icon: string;
  desc: string;
  awardedAt: string;
}

const BADGE_ICON: Record<string, typeof Flag> = {
  flag: Flag,
  compass: Compass,
  globe: Globe,
};

const WORLD_LABELS: Record<string, string> = {
  'concordia-hub': 'Concordia Hub',
  'concord-link-frontier': 'Link Frontier',
  cyber: 'Cyber',
  fantasy: 'Fantasy',
  'lattice-crucible': 'Lattice Crucible',
  'sovereign-ruins': 'Sovereign Ruins',
};

export function ExpeditionSummary({ data, badges }: { data: SummaryData | null; badges: Badge[] }) {
  if (!data) {
    return <div className="rounded-lg border border-white/10 bg-white/5 p-4 text-xs text-gray-400">Loading summary…</div>;
  }

  const chartData = data.worlds.map((w) => ({
    name: WORLD_LABELS[w.worldId] || w.worldId,
    done: w.completed,
    remaining: w.total - w.completed,
  }));

  return (
    <div className="space-y-4">
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-5">
        <Stat label="Overall" value={`${data.overallPercent}%`} sub={`${data.completedStages}/${data.totalStages} stages`} />
        <Stat label="Worlds done" value={`${data.completedWorlds}/${data.totalWorlds}`} sub="expeditions" />
        <Stat label="XP / Level" value={`L${data.level}`} sub={`${data.xp} XP`} />
        <Stat label="Journal" value={String(data.entryCount)} sub="entries written" />
        <Stat label="Screenshots" value={String(data.photoCount)} sub="captured" />
      </div>

      <div className="rounded-lg border border-white/10 bg-white/5 p-4">
        <h3 className="mb-2 text-xs uppercase tracking-wide text-gray-400">Stages by world</h3>
        <ChartKit
          kind="bar"
          data={chartData}
          xKey="name"
          stacked
          height={210}
          series={[
            { key: 'done', label: 'Completed', color: '#22c55e' },
            { key: 'remaining', label: 'Remaining', color: '#3f3f46' },
          ]}
        />
      </div>

      <div className="rounded-lg border border-white/10 bg-white/5 p-4">
        <h3 className="mb-3 flex items-center gap-1.5 text-xs uppercase tracking-wide text-gray-400">
          <Trophy className="h-3.5 w-3.5 text-amber-400" /> Badge ledger ({badges.length})
        </h3>
        {badges.length === 0 ? (
          <p className="text-xs text-gray-400">Complete a full expedition to earn your first badge.</p>
        ) : (
          <div className="flex flex-wrap gap-2">
            {badges.map((b) => {
              const Icon = BADGE_ICON[b.icon] || Award;
              return (
                <div key={`${b.id}:${b.worldId ?? ''}`} className="flex items-center gap-2 rounded-lg border border-amber-500/30 bg-amber-500/10 px-3 py-2">
                  <Icon className="h-4 w-4 text-amber-300" />
                  <div>
                    <p className="text-sm font-medium text-amber-200">
                      {b.title}{b.worldId ? ` · ${WORLD_LABELS[b.worldId] || b.worldId}` : ''}
                    </p>
                    <p className="text-[10px] text-amber-500/80">{b.desc} · {new Date(b.awardedAt).toLocaleDateString()}</p>
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </div>
    </div>
  );
}

function Stat({ label, value, sub }: { label: string; value: string; sub: string }) {
  return (
    <div className="rounded-lg border border-white/10 bg-white/5 p-3">
      <p className="text-[10px] uppercase tracking-wide text-gray-400">{label}</p>
      <p className="mt-0.5 text-xl font-semibold text-emerald-200">{value}</p>
      <p className="text-[10px] text-gray-400">{sub}</p>
    </div>
  );
}
