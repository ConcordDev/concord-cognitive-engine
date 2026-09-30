'use client';

/**
 * SpaceDashboardPanel — personal mission-control journal stats.
 * Extracted from space/page.tsx (mission timeline + orbital zones).
 * Backed by useLensData Mission/Satellite/Launch/Telemetry — not live feeds.
 */

import { useMemo } from 'react';
import { motion } from 'framer-motion';
import { Timer, Globe } from 'lucide-react';
import { useLensData } from '@/lib/hooks/use-lens-data';
import { cn } from '@/lib/utils';
import {
  type MissionData,
  type SatelliteData,
  type TelemetryData,
  type ArtifactDataUnion,
  STATUS_COLORS,
  STATUS_DOT_COLORS,
  getOrbitalZone,
} from './space-ops';

export function SpaceDashboardPanel() {
  const { items: missions } = useLensData<MissionData>('space', 'Mission', { seed: [] });
  const { items: satellites } = useLensData<SatelliteData>('space', 'Satellite', { seed: [] });
  const { items: telemetryItems } = useLensData<TelemetryData>('space', 'Telemetry', { seed: [] });
  const { items: launchItems } = useLensData<ArtifactDataUnion>('space', 'Launch', { seed: [] });

  const stats = useMemo(() => {
    const activeMissions = missions.filter(m => ['active', 'orbit'].includes((m.data as MissionData).status)).length;
    const totalMissions = missions.length;
    const opSatellites = satellites.filter(s => (s.data as SatelliteData).status === 'operational').length;
    const totalSatellites = satellites.length;
    const launchReadyCount = launchItems.filter(l => {
      const d = l.data as Record<string, unknown>;
      return d.status === 'prelaunch' || d.status === 'ready';
    }).length;
    const telemetryFeedCount = telemetryItems.length;
    return { activeMissions, totalMissions, opSatellites, totalSatellites, launchReadyCount, telemetryFeedCount };
  }, [missions, satellites, launchItems, telemetryItems]);

  const sortedMissions = useMemo(() =>
    [...missions]
      .filter(m => (m.data as MissionData).launchDate)
      .sort((a, b) => new Date((a.data as MissionData).launchDate).getTime() - new Date((b.data as MissionData).launchDate).getTime()),
    [missions],
  );

  const orbitalZones = useMemo(() => {
    const zones: Record<'LEO' | 'MEO' | 'GEO', number> = { LEO: 0, MEO: 0, GEO: 0 };
    satellites.forEach(s => {
      const alt = (s.data as SatelliteData).altitude;
      if (typeof alt === 'number') zones[getOrbitalZone(alt)]++;
    });
    return zones;
  }, [satellites]);

  return (
    <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} className="space-y-4">
      <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
        {[
          { label: 'Active Missions', value: stats.activeMissions, total: stats.totalMissions, color: 'green' },
          { label: 'Operational Satellites', value: stats.opSatellites, total: stats.totalSatellites, color: 'cyan' },
          { label: 'Launch Readiness', value: stats.launchReadyCount, total: launchItems.length, color: 'indigo' },
          { label: 'Telemetry Feeds', value: stats.telemetryFeedCount, total: stats.telemetryFeedCount, color: 'purple' },
        ].map((s, i) => (
          <motion.div
            key={s.label}
            initial={{ opacity: 0, y: 10 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ delay: i * 0.07 }}
            className="p-3 bg-zinc-900 rounded-lg border border-zinc-800"
          >
            <p className={`text-2xl font-bold text-${s.color}-400`}>{s.value}</p>
            <p className="text-xs text-gray-400">{s.label}</p>
            {s.total > 0 && s.label !== 'Telemetry Feeds' && (
              <p className="text-xs text-gray-400">of {s.total} total</p>
            )}
          </motion.div>
        ))}
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
        <div className="bg-zinc-900 rounded-lg border border-zinc-800 p-4">
          <h2 className="text-sm font-semibold text-white mb-3 flex items-center gap-2">
            <Timer className="w-4 h-4 text-indigo-400" /> Mission Timeline
          </h2>
          {sortedMissions.length === 0 ? (
            <p className="text-xs text-gray-400">No missions with launch dates.</p>
          ) : (
            <ol className="relative space-y-0">
              {sortedMissions.map((m, idx) => {
                const d = m.data as MissionData;
                const dotColor = STATUS_DOT_COLORS[d.status] ?? 'bg-gray-500';
                const isLast = idx === sortedMissions.length - 1;
                return (
                  <li key={m.id} className="relative pl-6 pb-4">
                    {!isLast && (
                      <span className="absolute left-[7px] top-4 bottom-0 w-px bg-zinc-700" />
                    )}
                    <span className={cn('absolute left-0 top-1 w-3.5 h-3.5 rounded-full border-2 border-zinc-900', dotColor)} />
                    <p className="text-xs font-medium text-white leading-tight">{m.title}</p>
                    <p className="text-[11px] text-gray-400 mt-0.5">
                      {d.launchDate ? new Date(d.launchDate).toLocaleDateString() : '—'}
                      {' · '}
                      <span className={cn('font-medium', STATUS_COLORS[d.status]?.split(' ')[0])}>
                        {d.status}
                      </span>
                    </p>
                  </li>
                );
              })}
            </ol>
          )}
        </div>

        <div className="bg-zinc-900 rounded-lg border border-zinc-800 p-4">
          <h2 className="text-sm font-semibold text-white mb-3 flex items-center gap-2">
            <Globe className="w-4 h-4 text-cyan-400" /> Orbital Status
          </h2>
          <div className="font-mono text-[11px] text-gray-400 leading-relaxed space-y-1 mb-4 select-none">
            <p className="text-center text-gray-600">· · · · · GEO · · · · ·</p>
            <p className="text-center text-gray-400">· · MEO · · · MEO · ·</p>
            <p className="text-center text-cyan-500/70">·  LEO  ·  LEO  ·</p>
            <p className="text-center text-indigo-400 font-bold">[ EARTH ]</p>
            <p className="text-center text-cyan-500/70">·  LEO  ·  LEO  ·</p>
            <p className="text-center text-gray-400">· · MEO · · · MEO · ·</p>
            <p className="text-center text-gray-600">· · · · · GEO · · · · ·</p>
          </div>
          <div className="space-y-2">
            {(['LEO', 'MEO', 'GEO'] as const).map(zone => {
              const count = orbitalZones[zone];
              const colors: Record<string, string> = { LEO: 'text-cyan-400', MEO: 'text-indigo-400', GEO: 'text-purple-400' };
              const barColors: Record<string, string> = { LEO: 'bg-cyan-500', MEO: 'bg-indigo-500', GEO: 'bg-purple-500' };
              const maxCount = Math.max(...Object.values(orbitalZones), 1);
              return (
                <div key={zone} className="flex items-center gap-2">
                  <span className={cn('text-xs font-mono w-8 shrink-0', colors[zone])}>{zone}</span>
                  <div className="flex-1 h-1.5 bg-zinc-800 rounded-full overflow-hidden">
                    <div
                      className={cn('h-full rounded-full transition-all', barColors[zone])}
                      style={{ width: `${(count / maxCount) * 100}%` }}
                    />
                  </div>
                  <span className="text-xs text-gray-400 w-4 text-right">{count}</span>
                </div>
              );
            })}
          </div>
        </div>
      </div>
    </motion.div>
  );
}
