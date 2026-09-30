'use client';

/**
 * SpaceArtifactPanel — personal tracker CRUD for Missions/Satellites/LaunchOps/
 * Telemetry/Crew/Debris. Extracted from space/page.tsx. Uses useLensData +
 * useRunArtifact('analyze') — same macros as before.
 */

import { useState, useMemo, useEffect, useCallback, useRef } from 'react';
import { useLensCommand } from '@/hooks/useLensCommand';
import { motion, AnimatePresence } from 'framer-motion';
import {
  Rocket, Plus, Search, Trash2, MapPin, Users, Orbit, Eye, AlertTriangle, Zap,
  Flame, Signal, Database,
} from 'lucide-react';
import { useLensData } from '@/lib/hooks/use-lens-data';
import { useRunArtifact } from '@/lib/hooks/use-lens-artifacts';
import { ErrorState } from '@/components/common/EmptyState';
import { cn } from '@/lib/utils';
import { artifactTypeForView, type SpaceArtifactView } from './space-nav';
import {
  type MissionData,
  type ArtifactDataUnion,
  STATUS_COLORS,
  formatCountdown,
  SignalBar,
  getOrbitalZone,
} from './space-ops';

export function SpaceArtifactPanel({ view }: { view: SpaceArtifactView }) {
  const searchInputRef = useRef<HTMLInputElement>(null);
  useLensCommand(
    [{ id: 'focus-search', keys: '/', description: 'Focus search', category: 'navigation', action: () => searchInputRef.current?.focus() }],
    { lensId: 'space' },
  );
  const [searchQuery, setSearchQuery] = useState('');
  const [tick, setTick] = useState(0);
  const currentType = artifactTypeForView(view);

  useEffect(() => {
    if (view !== 'launchops') return;
    const id = setInterval(() => setTick(t => t + 1), 1000);
    return () => clearInterval(id);
  }, [view]);

  const { items, isLoading, isError, error, refetch, create, remove } =
    useLensData<ArtifactDataUnion>('space', currentType, { search: searchQuery || undefined });

  const { items: missions } = useLensData<MissionData>('space', 'Mission', { seed: [] });
  const { items: telemetryItems } = useLensData<ArtifactDataUnion>('space', 'Telemetry', { seed: [] });

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

  const avgSignal = useMemo(() => {
    if (telemetryItems.length === 0) return 0;
    const sum = telemetryItems.reduce((acc, t) => {
      const sig = (t.data as { signalStrength?: number }).signalStrength;
      return acc + (typeof sig === 'number' ? sig : 0);
    }, 0);
    return Math.round(sum / telemetryItems.length);
  }, [telemetryItems]);

  const sortedMissions = useMemo(() =>
    [...missions]
      .filter(m => (m.data as MissionData).launchDate)
      .sort((a, b) => new Date((a.data as MissionData).launchDate).getTime() - new Date((b.data as MissionData).launchDate).getTime()),
    [missions],
  );

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

  const isMission = view === 'missions';
  const isSatellite = view === 'satellites';
  const isTelemetry = view === 'telemetry';

  return (
    <div className="space-y-4">
      {runAction.isPending && <span className="text-xs text-neon-cyan animate-pulse">AI processing...</span>}

      <div className="flex items-center gap-2">
        <div className="flex-1 relative">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-gray-400" />
          <input
            ref={searchInputRef}
            value={searchQuery}
            onChange={e => setSearchQuery(e.target.value)}
            placeholder={`Search ${currentType.toLowerCase()}s...`}
            className="w-full pl-9 pr-3 py-2 bg-zinc-900 border border-zinc-800 rounded-lg text-sm text-white placeholder-gray-500"
          />
        </div>
        <button
          type="button"
          onClick={() => create({ title: `New ${currentType}`, data: {} })}
          className="flex items-center gap-2 px-3 py-2 bg-indigo-600 hover:bg-indigo-500 text-white rounded-lg text-sm"
        >
          <Plus className="w-4 h-4" /> New {currentType}
        </button>
      </div>

      <AnimatePresence>
        {view === 'launchops' && nextPrelaunchMission && (
          <motion.div
            key="countdown"
            initial={{ opacity: 0, y: -8 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: -8 }}
            className="bg-zinc-900 border border-yellow-500/30 rounded-xl p-4 flex items-center gap-4"
          >
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
                <p className="text-xs text-gray-400">{(nextPrelaunchMission.data as MissionData).launchVehicle}</p>
              )}
            </div>
            <div className="text-right shrink-0">
              <p className="text-xs text-gray-400 mb-0.5">Countdown</p>
              <p className="text-xl font-mono font-bold text-yellow-400 tabular-nums">
                {tick >= 0 && formatCountdown((nextPrelaunchMission.data as MissionData).launchDate)}
              </p>
            </div>
          </motion.div>
        )}
      </AnimatePresence>

      <AnimatePresence>
        {view === 'telemetry' && (telemetryItems.length > 0 ? (
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
          <div className="text-center py-6 text-gray-400 text-sm border border-dashed border-white/10 rounded-lg">
            <p>No telemetry data yet. Add telemetry records to see spacecraft data.</p>
          </div>
        ))}
      </AnimatePresence>

      <div className="space-y-2">
        <AnimatePresence>
          {items.map((item, idx) => {
            const d = item.data as Record<string, unknown>;
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
                    <button type="button" onClick={() => handleAction('analyze', item.id)} className="p-1.5 hover:bg-zinc-800 rounded text-gray-400 hover:text-neon-cyan" aria-label="Activate">
                      <Zap className="w-3.5 h-3.5" />
                    </button>
                    <button type="button" onClick={() => remove(item.id)} className="p-1.5 hover:bg-zinc-800 rounded text-gray-400 hover:text-red-400" aria-label="Delete">
                      <Trash2 className="w-3.5 h-3.5" />
                    </button>
                  </div>
                </div>

                {!!d.objective && (
                  <p className="text-xs text-gray-400 mt-2">{String(d.objective)}</p>
                )}

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

                {isTelemetry && (
                  <div className="flex flex-wrap items-center gap-3 mt-2">
                    {typeof d.signalStrength === 'number' && (
                      <div className="flex items-center gap-1.5">
                        <span className="text-[11px] text-gray-400">Signal</span>
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
                        d.anomalies.length > 0 ? 'bg-red-500/10 text-red-400' : 'bg-zinc-800 text-gray-400',
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
          <div className="text-center py-12 text-gray-400">
            <Rocket className="w-10 h-10 mx-auto mb-3 opacity-30" />
            <p>No {currentType.toLowerCase()}s found</p>
          </div>
        )}
      </div>
    </div>
  );
}
