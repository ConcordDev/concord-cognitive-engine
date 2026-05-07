'use client';

import { useState, useMemo, useEffect, useCallback } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { useLensNav } from '@/hooks/useLensNav';
import { useLensData } from '@/lib/hooks/use-lens-data';
import { useRunArtifact } from '@/lib/hooks/use-lens-artifacts';
import { ds } from '@/lib/design-system';
import { cn } from '@/lib/utils';
import { UniversalActions } from '@/components/lens/UniversalActions';
import { LensFeaturePanel } from '@/components/lens/LensFeaturePanel';
import {
  Rocket, Plus, Search, Trash2, BarChart3,
  Layers, ChevronDown, MapPin, Users, Radio,
  Orbit, Satellite, Globe, Flame, Timer,
  Eye, AlertTriangle, Zap, Signal, Database,
} from 'lucide-react';
import { ErrorState } from '@/components/common/EmptyState';
import { useRealtimeLens } from '@/hooks/useRealtimeLens';
import { LiveIndicator } from '@/components/lens/LiveIndicator';
import { DTUExportButton } from '@/components/lens/DTUExportButton';
import { RealtimeDataPanel } from '@/components/lens/RealtimeDataPanel';

type ModeTab = 'Dashboard' | 'Missions' | 'Satellites' | 'LaunchOps' | 'Telemetry' | 'Crew' | 'Debris';

interface MissionData {
  name: string;
  status: 'planning' | 'prelaunch' | 'active' | 'orbit' | 'reentry' | 'completed' | 'aborted';
  missionType: 'orbital' | 'suborbital' | 'deep_space' | 'station_resupply' | 'satellite_deploy';
  launchVehicle: string;
  launchSite: string;
  launchDate: string;
  orbit: string;
  payload: string;
  payloadMass: number;
  crewSize: number;
  duration: string;
  objective: string;
}

interface SatelliteData {
  designation: string;
  type: 'communications' | 'earth_observation' | 'navigation' | 'science' | 'military' | 'weather';
  status: 'operational' | 'standby' | 'degraded' | 'decommissioned';
  orbit: string;
  altitude: number;
  inclination: number;
  period: string;
  launchDate: string;
  endOfLife: string;
  operator: string;
}

interface TelemetryData {
  source: string;
  signalStrength: number;
  dataRate: string;
  lastContact: string;
  altitude: number;
  velocity: number;
  temperature: number;
  powerLevel: number;
  anomalies: string[];
}

type ArtifactDataUnion = MissionData | SatelliteData | TelemetryData | Record<string, unknown>;

const MODE_TABS: { key: ModeTab; label: string; icon: typeof Rocket }[] = [
  { key: 'Dashboard', label: 'Dashboard', icon: BarChart3 },
  { key: 'Missions', label: 'Missions', icon: Rocket },
  { key: 'Satellites', label: 'Satellites', icon: Satellite },
  { key: 'LaunchOps', label: 'Launch Ops', icon: Flame },
  { key: 'Telemetry', label: 'Telemetry', icon: Radio },
  { key: 'Crew', label: 'Crew', icon: Users },
  { key: 'Debris', label: 'Debris Track', icon: Orbit },
];

function getTypeForTab(tab: ModeTab): string {
  const map: Record<ModeTab, string> = {
    Dashboard: 'Mission', Missions: 'Mission', Satellites: 'Satellite',
    LaunchOps: 'Launch', Telemetry: 'Telemetry', Crew: 'Crew', Debris: 'Debris',
  };
  return map[tab];
}

const STATUS_COLORS: Record<string, string> = {
  planning: 'text-blue-400 bg-blue-400/10', prelaunch: 'text-yellow-400 bg-yellow-400/10',
  active: 'text-green-400 bg-green-400/10', orbit: 'text-cyan-400 bg-cyan-400/10',
  reentry: 'text-orange-400 bg-orange-400/10', completed: 'text-gray-400 bg-gray-400/10',
  aborted: 'text-red-400 bg-red-400/10', operational: 'text-green-400 bg-green-400/10',
  standby: 'text-yellow-400 bg-yellow-400/10', degraded: 'text-orange-400 bg-orange-400/10',
  decommissioned: 'text-gray-500 bg-gray-500/10',
};

const STATUS_DOT_COLORS: Record<string, string> = {
  planning: 'bg-blue-400', prelaunch: 'bg-yellow-400',
  active: 'bg-green-400', orbit: 'bg-cyan-400',
  reentry: 'bg-orange-400', completed: 'bg-gray-400',
  aborted: 'bg-red-400', operational: 'bg-green-400',
  standby: 'bg-yellow-400', degraded: 'bg-orange-400',
  decommissioned: 'bg-gray-500',
};

function getOrbitalZone(altitude: number): 'LEO' | 'MEO' | 'GEO' {
  if (altitude < 2000) return 'LEO';
  if (altitude < 35000) return 'MEO';
  return 'GEO';
}

function formatCountdown(targetDateStr: string): string {
  const now = Date.now();
  const target = new Date(targetDateStr).getTime();
  const diff = target - now;
  if (diff <= 0) return 'T-00:00:00';
  const h = Math.floor(diff / 3_600_000);
  const m = Math.floor((diff % 3_600_000) / 60_000);
  const s = Math.floor((diff % 60_000) / 1_000);
  return `T-${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`;
}

function SignalBar({ strength }: { strength: number }) {
  const color = strength > 80 ? 'bg-green-400' : strength >= 50 ? 'bg-yellow-400' : 'bg-red-400';
  return (
    <div className="flex items-center gap-1">
      {[20, 40, 60, 80, 100].map(threshold => (
        <div
          key={threshold}
          className={cn(
            'w-1 rounded-sm transition-colors',
            strength >= threshold ? color : 'bg-zinc-700',
          )}
          style={{ height: `${(threshold / 100) * 14 + 4}px` }}
        />
      ))}
    </div>
  );
}

export default function SpaceLensPage() {
  useLensNav('space');
  const { latestData: realtimeData, isLive, lastUpdated, insights } = useRealtimeLens('space');

  const [activeMode, setActiveMode] = useState<ModeTab>('Dashboard');
  const [searchQuery, setSearchQuery] = useState('');
  const [showFeatures, setShowFeatures] = useState(true);
  const [tick, setTick] = useState(0);

  // Drive countdown re-renders every second while on LaunchOps
  useEffect(() => {
    if (activeMode !== 'LaunchOps') return;
    const id = setInterval(() => setTick(t => t + 1), 1000);
    return () => clearInterval(id);
  }, [activeMode]);

  const currentType = getTypeForTab(activeMode);

  const { items, isLoading, isError, error, refetch, create, remove } =
    useLensData<ArtifactDataUnion>('space', currentType, { search: searchQuery || undefined });

  const { items: missions } = useLensData<MissionData>('space', 'Mission', { seed: [] });
  const { items: satellites } = useLensData<SatelliteData>('space', 'Satellite', { seed: [] });
  const { items: telemetryItems } = useLensData<TelemetryData>('space', 'Telemetry', { seed: [] });
  const { items: launchItems } = useLensData<ArtifactDataUnion>('space', 'Launch', { seed: [] });

  const runAction = useRunArtifact('space');

  const handleAction = useCallback(async (action: string, artifactId?: string) => {
    const targetId = artifactId || items[0]?.id;
    if (!targetId) return;
    try {
      await runAction.mutateAsync({ id: targetId, action });
    } catch (err) {
      console.error('Action failed:', err);
    }
  }, [items, runAction]);

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

  const avgSignal = useMemo(() => {
    if (telemetryItems.length === 0) return 0;
    const sum = telemetryItems.reduce((acc, t) => {
      const sig = (t.data as TelemetryData).signalStrength;
      return acc + (typeof sig === 'number' ? sig : 0);
    }, 0);
    return Math.round(sum / telemetryItems.length);
  }, [telemetryItems]);

  const nextPrelaunchMission = useMemo(() =>
    sortedMissions.find(m => (m.data as MissionData).status === 'prelaunch'),
    [sortedMissions],
  );

  if (isLoading) {
    return (
      <div className="flex items-center justify-center h-full p-8">
        <div className="text-center space-y-3">
          <div className="w-8 h-8 border-2 border-indigo-500 border-t-transparent rounded-full animate-spin mx-auto" />
          <p className="text-sm text-gray-400">Loading space operations...</p>
        </div>
      </div>
    );
  }

  if (isError) {
    return <div className="flex items-center justify-center h-full p-8"><ErrorState error={error?.message} onRetry={refetch} /></div>;
  }

  return (
    <div data-lens-theme="space" className={cn(ds.pageContainer, 'space-y-4')}>

      {/* ── Header with starfield gradient ── */}
      <header className="bg-gradient-to-r from-indigo-900/20 via-transparent to-purple-900/20 rounded-xl p-4 flex items-center justify-between">
        <div className="flex items-center gap-3">
          {/* Orbit-ring decoration around rocket icon */}
          <div className="relative w-10 h-10 flex items-center justify-center">
            <div className="absolute inset-0 rounded-full border border-indigo-500/40 animate-spin" style={{ animationDuration: '8s' }} />
            <div className="absolute inset-1 rounded-full border border-indigo-400/20" />
            <div className="w-10 h-10 rounded-lg bg-indigo-500/20 flex items-center justify-center">
              <Rocket className="w-5 h-5 text-indigo-400" />
            </div>
          </div>
          <div>
            <h1 className="text-xl font-bold text-white">Space Operations</h1>
            <p className="text-sm text-gray-400">Missions, satellites, telemetry &amp; orbital management</p>
          </div>
        </div>
        <div className="flex items-center gap-2">
          {runAction.isPending && <span className="text-xs text-neon-cyan animate-pulse">AI processing...</span>}
          <LiveIndicator isLive={isLive} lastUpdated={lastUpdated} compact />
          <DTUExportButton domain="space" data={realtimeData || {}} compact />
        </div>
      </header>

      {/* ── Tab bar ── */}
      <div className="flex gap-1 bg-zinc-900 rounded-lg p-1 flex-wrap">
        {MODE_TABS.map(({ key, label, icon: Icon }) => (
          <button key={key} onClick={() => setActiveMode(key)}
            className={cn('flex items-center gap-2 px-3 py-2 rounded-md text-sm font-medium whitespace-nowrap transition-colors',
              activeMode === key ? 'bg-zinc-800 text-white' : 'text-zinc-500 hover:text-zinc-300')}>
            <Icon className="w-4 h-4" /> {label}
          </button>
        ))}
      </div>

      {/* ── Search / Create bar ── */}
      <div className="flex items-center gap-2">
        <div className="flex-1 relative">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-gray-500" />
          <input value={searchQuery} onChange={e => setSearchQuery(e.target.value)}
            placeholder={`Search ${currentType.toLowerCase()}s...`}
            className="w-full pl-9 pr-3 py-2 bg-zinc-900 border border-zinc-800 rounded-lg text-sm text-white placeholder-gray-500" />
        </div>
        <button onClick={() => create({ title: `New ${currentType}`, data: {} })} className="flex items-center gap-2 px-3 py-2 bg-indigo-600 hover:bg-indigo-500 text-white rounded-lg text-sm">
          <Plus className="w-4 h-4" /> New {currentType}
        </button>
      </div>

      {/* ── Dashboard ── */}
      <AnimatePresence mode="wait">
        {activeMode === 'Dashboard' && (
          <motion.div key="dashboard" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} className="space-y-4">

            {/* Stat cards */}
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
                    <p className="text-xs text-gray-600">of {s.total} total</p>
                  )}
                </motion.div>
              ))}
            </div>

            {/* Mission Timeline + Orbital Status side by side */}
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">

              {/* Mission Timeline */}
              <div className="bg-zinc-900 rounded-lg border border-zinc-800 p-4">
                <h2 className="text-sm font-semibold text-white mb-3 flex items-center gap-2">
                  <Timer className="w-4 h-4 text-indigo-400" /> Mission Timeline
                </h2>
                {sortedMissions.length === 0 ? (
                  <p className="text-xs text-gray-500">No missions with launch dates.</p>
                ) : (
                  <ol className="relative space-y-0">
                    {sortedMissions.map((m, idx) => {
                      const d = m.data as MissionData;
                      const dotColor = STATUS_DOT_COLORS[d.status] ?? 'bg-gray-500';
                      const isLast = idx === sortedMissions.length - 1;
                      return (
                        <li key={m.id} className="relative pl-6 pb-4">
                          {/* Connecting line */}
                          {!isLast && (
                            <span className="absolute left-[7px] top-4 bottom-0 w-px bg-zinc-700" />
                          )}
                          {/* Status dot */}
                          <span className={cn('absolute left-0 top-1 w-3.5 h-3.5 rounded-full border-2 border-zinc-900', dotColor)} />
                          <p className="text-xs font-medium text-white leading-tight">{m.title}</p>
                          <p className="text-[11px] text-gray-500 mt-0.5">
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

              {/* Orbital Status */}
              <div className="bg-zinc-900 rounded-lg border border-zinc-800 p-4">
                <h2 className="text-sm font-semibold text-white mb-3 flex items-center gap-2">
                  <Globe className="w-4 h-4 text-cyan-400" /> Orbital Status
                </h2>
                {/* ASCII-style orbit diagram */}
                <div className="font-mono text-[11px] text-gray-400 leading-relaxed space-y-1 mb-4 select-none">
                  <p className="text-center text-gray-600">· · · · · GEO · · · · ·</p>
                  <p className="text-center text-gray-500">· · MEO · · · MEO · ·</p>
                  <p className="text-center text-cyan-500/70">·  LEO  ·  LEO  ·</p>
                  <p className="text-center text-indigo-400 font-bold">[ EARTH ]</p>
                  <p className="text-center text-cyan-500/70">·  LEO  ·  LEO  ·</p>
                  <p className="text-center text-gray-500">· · MEO · · · MEO · ·</p>
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
        )}
      </AnimatePresence>

      {/* ── Launch countdown banner (LaunchOps tab) ── */}
      <AnimatePresence>
        {activeMode === 'LaunchOps' && nextPrelaunchMission && (
          <motion.div
            key="countdown"
            initial={{ opacity: 0, y: -8 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: -8 }}
            className="bg-zinc-900 border border-yellow-500/30 rounded-xl p-4 flex items-center gap-4"
          >
            {/* Pulsing flame icon */}
            <div className="relative flex items-center justify-center shrink-0">
              <span className="absolute w-10 h-10 rounded-full bg-yellow-400/20 animate-ping" />
              <span className="absolute w-8 h-8 rounded-full bg-yellow-400/10 animate-ping" style={{ animationDelay: '0.3s' }} />
              <div className="relative w-10 h-10 rounded-full bg-yellow-500/20 flex items-center justify-center">
                <Flame className="w-5 h-5 text-yellow-400" />
              </div>
            </div>
            <div className="flex-1 min-w-0">
              <p className="text-xs text-gray-400 uppercase tracking-widest mb-0.5">Next Launch</p>
              <p className="text-sm font-semibold text-white truncate">{nextPrelaunchMission.title}</p>
              {(nextPrelaunchMission.data as MissionData).launchVehicle && (
                <p className="text-xs text-gray-500">{(nextPrelaunchMission.data as MissionData).launchVehicle}</p>
              )}
            </div>
            <div className="text-right shrink-0">
              <p className="text-xs text-gray-500 mb-0.5">Countdown</p>
              <p className="text-xl font-mono font-bold text-yellow-400 tabular-nums">
                {/* tick is used to trigger re-render every second */}
                {tick >= 0 && formatCountdown((nextPrelaunchMission.data as MissionData).launchDate)}
              </p>
            </div>
          </motion.div>
        )}
      </AnimatePresence>

      {/* ── Telemetry system health bar ── */}
      <AnimatePresence>
        {activeMode === 'Telemetry' && (telemetryItems.length > 0 ? (
          <motion.div
            key="syshealth"
            initial={{ opacity: 0, y: -6 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0 }}
            className="bg-zinc-900 border border-zinc-800 rounded-lg p-3 flex items-center gap-3"
          >
            <Signal className="w-4 h-4 text-gray-400 shrink-0" />
            <div className="flex-1">
              <div className="flex items-center justify-between mb-1">
                <span className="text-xs text-gray-400">System Health — avg signal strength</span>
                <span className={cn(
                  'text-xs font-semibold tabular-nums',
                  avgSignal > 80 ? 'text-green-400' : avgSignal >= 50 ? 'text-yellow-400' : 'text-red-400',
                )}>
                  {avgSignal}%
                </span>
              </div>
              <div className="h-1.5 bg-zinc-800 rounded-full overflow-hidden">
                <motion.div
                  initial={{ width: 0 }}
                  animate={{ width: `${avgSignal}%` }}
                  transition={{ duration: 0.6, ease: 'easeOut' }}
                  className={cn(
                    'h-full rounded-full',
                    avgSignal > 80 ? 'bg-green-500' : avgSignal >= 50 ? 'bg-yellow-500' : 'bg-red-500',
                  )}
                />
              </div>
            </div>
          </motion.div>
        ) : (
          <div className="text-center py-6 text-gray-500 text-sm border border-dashed border-white/10 rounded-lg">
            <p>No telemetry data yet. Add telemetry records to see spacecraft data.</p>
          </div>
        ))}
      </AnimatePresence>

      {/* ── Item cards ── */}
      <div className="space-y-2">
        <AnimatePresence>
          {items.map((item, idx) => {
            const d = item.data as Record<string, unknown>;
            const isMission = activeMode === 'Missions';
            const isSatellite = activeMode === 'Satellites';
            const isTelemetry = activeMode === 'Telemetry';

            return (
              <motion.div
                key={item.id}
                initial={{ opacity: 0, y: 8 }}
                animate={{ opacity: 1, y: 0 }}
                exit={{ opacity: 0, y: -4 }}
                transition={{ delay: idx * 0.04, duration: 0.2 }}
                className="group p-4 bg-zinc-900 rounded-lg border border-zinc-800 hover:border-indigo-500/40 hover:shadow-[0_0_12px_rgba(99,102,241,0.15)] transition-all"
              >
                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-3 min-w-0">
                    <h3 className="text-sm font-semibold text-white truncate">{item.title}</h3>
                    {!!d.status && (
                      <span className={cn('text-xs px-2 py-0.5 rounded-full shrink-0', STATUS_COLORS[String(d.status)] || 'text-gray-400 bg-gray-400/10')}>
                        {String(d.status)}
                      </span>
                    )}
                  </div>
                  <div className="flex items-center gap-1 shrink-0">
                    <button onClick={() => handleAction('analyze', item.id)} className="p-1.5 hover:bg-zinc-800 rounded text-gray-500 hover:text-neon-cyan">
                      <Zap className="w-3.5 h-3.5" />
                    </button>
                    <button onClick={() => remove(item.id)} className="p-1.5 hover:bg-zinc-800 rounded text-gray-500 hover:text-red-400">
                      <Trash2 className="w-3.5 h-3.5" />
                    </button>
                  </div>
                </div>

                {/* Objective / description */}
                {!!d.objective && (
                  <p className="text-xs text-gray-500 mt-2">{String(d.objective)}</p>
                )}

                {/* Mission badges */}
                {isMission && (
                  <div className="flex flex-wrap items-center gap-2 mt-2">
                    {!!d.launchVehicle && (
                      <span className="inline-flex items-center gap-1 text-[11px] bg-indigo-500/10 text-indigo-300 px-2 py-0.5 rounded-full">
                        <Rocket className="w-3 h-3" /> {String(d.launchVehicle)}
                      </span>
                    )}
                    {!!d.payload && (
                      <span className="inline-flex items-center gap-1 text-[11px] bg-zinc-800 text-gray-300 px-2 py-0.5 rounded-full">
                        <Database className="w-3 h-3" /> {String(d.payload)}
                      </span>
                    )}
                    {typeof d.crewSize === 'number' && d.crewSize > 0 && (
                      <span className="inline-flex items-center gap-1 text-[11px] bg-cyan-500/10 text-cyan-300 px-2 py-0.5 rounded-full">
                        <Users className="w-3 h-3" /> {d.crewSize} crew
                      </span>
                    )}
                  </div>
                )}

                {/* Satellite details */}
                {isSatellite && (
                  <div className="flex flex-wrap items-center gap-2 mt-2">
                    {typeof d.altitude === 'number' && (
                      <span className="inline-flex items-center gap-1 text-[11px] bg-zinc-800 text-gray-300 px-2 py-0.5 rounded-full">
                        <MapPin className="w-3 h-3" /> {d.altitude} km · {getOrbitalZone(d.altitude)}
                      </span>
                    )}
                    {!!d.orbit && (
                      <span className="inline-flex items-center gap-1 text-[11px] bg-indigo-500/10 text-indigo-300 px-2 py-0.5 rounded-full">
                        <Orbit className="w-3 h-3" /> {String(d.orbit)}
                      </span>
                    )}
                    {!!d.operator && (
                      <span className="inline-flex items-center gap-1 text-[11px] bg-zinc-800 text-gray-400 px-2 py-0.5 rounded-full">
                        <Eye className="w-3 h-3" /> {String(d.operator)}
                      </span>
                    )}
                  </div>
                )}

                {/* Telemetry details */}
                {isTelemetry && (
                  <div className="flex flex-wrap items-center gap-3 mt-2">
                    {typeof d.signalStrength === 'number' && (
                      <div className="flex items-center gap-1.5">
                        <span className="text-[11px] text-gray-500">Signal</span>
                        <SignalBar strength={d.signalStrength} />
                        <span className={cn(
                          'text-[11px] tabular-nums font-medium',
                          d.signalStrength > 80 ? 'text-green-400' : d.signalStrength >= 50 ? 'text-yellow-400' : 'text-red-400',
                        )}>
                          {d.signalStrength}%
                        </span>
                      </div>
                    )}
                    {!!d.dataRate && (
                      <span className="inline-flex items-center gap-1 text-[11px] bg-zinc-800 text-gray-300 px-2 py-0.5 rounded-full">
                        <Zap className="w-3 h-3 text-yellow-400" /> {String(d.dataRate)}
                      </span>
                    )}
                    {Array.isArray(d.anomalies) && (
                      <span className={cn(
                        'inline-flex items-center gap-1 text-[11px] px-2 py-0.5 rounded-full',
                        d.anomalies.length > 0 ? 'bg-red-500/10 text-red-400' : 'bg-zinc-800 text-gray-500',
                      )}>
                        <AlertTriangle className="w-3 h-3" /> {d.anomalies.length} anomal{d.anomalies.length === 1 ? 'y' : 'ies'}
                      </span>
                    )}
                  </div>
                )}
              </motion.div>
            );
          })}
        </AnimatePresence>

        {items.length === 0 && (
          <div className="text-center py-12 text-gray-500">
            <Rocket className="w-10 h-10 mx-auto mb-3 opacity-30" />
            <p>No {currentType.toLowerCase()}s found</p>
          </div>
        )}
      </div>

      <UniversalActions domain="space" artifactId={items[0]?.id} />
      <RealtimeDataPanel data={insights} />

      <div className="border-t border-white/10">
        <button onClick={() => setShowFeatures(!showFeatures)}
          className="w-full flex items-center justify-between px-4 py-3 text-sm text-gray-300 hover:text-white transition-colors bg-white/[0.02] hover:bg-white/[0.04] rounded-lg">
          <span className="flex items-center gap-2"><Layers className="w-4 h-4" /> Lens Features</span>
          <ChevronDown className={cn('w-4 h-4 transition-transform', showFeatures && 'rotate-180')} />
        </button>
        {showFeatures && <div className="px-4 pb-4"><LensFeaturePanel lensId="space" /></div>}
      </div>
    </div>
  );
}
