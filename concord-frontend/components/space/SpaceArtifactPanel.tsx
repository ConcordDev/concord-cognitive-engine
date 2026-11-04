'use client';

/**
 * SpaceArtifactPanel — personal tracker CRUD for Missions/Satellites/LaunchOps/
 * Telemetry/Crew/Debris.
 *
 * R2 space pass build (2026-11-03):
 *  - S1/F2: "+ New X" used to create a default-named row in place — no form,
 *    no name field, no Edit anywhere. Create/Edit now open a real form with
 *    a name field and the per-type fields the rows render; creates and
 *    edits receipt with a toast. Search/empty copy uses per-view nouns
 *    instead of the naive `${type}s` plural ("launchs", "debriss", …).
 *  - S3/F3: Delete is two-step (arm → "Confirm delete?"), never one-click.
 *  - F9: the search input lives OUTSIDE every loading/error branch. It used
 *    to sit inside the tree the `isLoading` branch replaced, so the first
 *    keystroke (which starts a search refetch — a new query key) unmounted
 *    the input, focus fell to <body>, and the remaining letters fired the
 *    page's letter view-shortcuts — typing "space" ended in the Crew view
 *    with the text destroyed.
 */

import { useState, useMemo, useEffect, useCallback, useRef } from 'react';
import { useLensCommand } from '@/hooks/useLensCommand';
import { motion, AnimatePresence } from 'framer-motion';
import {
  Rocket, Plus, Search, Trash2, MapPin, Users, Orbit, Eye, AlertTriangle, Zap,
  Flame, Signal, Database, Pencil, X,
} from 'lucide-react';
import { useLensData } from '@/lib/hooks/use-lens-data';
import { useRunArtifact } from '@/lib/hooks/use-lens-artifacts';
import { ErrorState } from '@/components/common/EmptyState';
import { useUIStore } from '@/store/ui';
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

/** Hand-written per-type nouns — never a generated plural. */
const NOUN: Record<string, string> = {
  Mission: 'missions',
  Satellite: 'satellites',
  Launch: 'launches',
  Telemetry: 'telemetry records',
  Crew: 'crew members',
  Debris: 'debris objects',
};

const MISSION_STATUSES = ['planning', 'prelaunch', 'active', 'orbit', 'reentry', 'completed', 'aborted'];
const SATELLITE_STATUSES = ['operational', 'standby', 'degraded', 'decommissioned'];

type EditorState = { id?: string; title: string; data: Record<string, unknown> };

export function SpaceArtifactPanel({ view }: { view: SpaceArtifactView }) {
  const searchInputRef = useRef<HTMLInputElement>(null);
  useLensCommand(
    [{ id: 'focus-search', keys: '/', description: 'Focus search', category: 'navigation', action: () => searchInputRef.current?.focus() }],
    { lensId: 'space' },
  );
  const [searchQuery, setSearchQuery] = useState('');
  const [tick, setTick] = useState(0);
  const [editor, setEditor] = useState<EditorState | null>(null);
  const [saving, setSaving] = useState(false);
  const [armDeleteId, setArmDeleteId] = useState<string | null>(null);
  const currentType = artifactTypeForView(view);
  const addToast = useUIStore((s) => s.addToast);

  useEffect(() => {
    if (view !== 'launchops') return;
    const id = setInterval(() => setTick(t => t + 1), 1000);
    return () => clearInterval(id);
  }, [view]);

  useEffect(() => {
    if (!armDeleteId) return;
    const id = setTimeout(() => setArmDeleteId(null), 4000);
    return () => clearTimeout(id);
  }, [armDeleteId]);

  // Changing views closes any half-filled editor rather than carrying a
  // Mission draft into the Satellites form.
  useEffect(() => { setEditor(null); setArmDeleteId(null); }, [view]);

  const { items, isLoading, isError, error, refetch, create, update, remove } =
    useLensData<ArtifactDataUnion>('space', currentType, { search: searchQuery || undefined });

  const { items: missions } = useLensData<MissionData>('space', 'Mission', { seed: [] });
  const { items: telemetryItems } = useLensData<ArtifactDataUnion>('space', 'Telemetry', { seed: [] });

  const runAction = useRunArtifact('space');

  const handleAction = useCallback(async (action: string, artifactId?: string) => {
    const targetId = artifactId || items[0]?.id;
    if (!targetId) return;
    try {
      await runAction.mutateAsync({ id: targetId, action });
    } catch {
      addToast({ type: 'error', message: 'That action could not be completed.' });
    }
  }, [items, runAction, addToast]);

  const openCreate = () => {
    const status = currentType === 'Mission' ? 'planning' : currentType === 'Satellite' ? 'operational' : '';
    setEditor({ title: '', data: status ? { status } : {} });
  };

  const openEdit = (item: { id: string; title: string; data: unknown }) => {
    setEditor({ id: item.id, title: item.title, data: { ...(item.data as Record<string, unknown>) } });
  };

  const setField = (key: string, value: unknown) =>
    setEditor((e) => (e ? { ...e, data: { ...e.data, [key]: value } } : e));

  const numVal = (v: unknown) => (typeof v === 'number' ? v : '');
  const numField = (key: string) => (e: React.ChangeEvent<HTMLInputElement>) => {
    const v = e.target.value;
    setField(key, v === '' ? undefined : Number(v));
  };

  const saveEditor = async () => {
    if (!editor) return;
    const title = editor.title.trim();
    if (!title) {
      addToast({ type: 'error', message: `Give the ${currentType.toLowerCase()} a name first.` });
      return;
    }
    setSaving(true);
    try {
      if (editor.id) {
        await update(editor.id, { title, data: editor.data });
        addToast({ type: 'success', message: `${currentType} updated.` });
      } else {
        await create({ title, data: editor.data });
        addToast({ type: 'success', message: `${currentType} created.` });
      }
      setEditor(null);
    } catch {
      addToast({ type: 'error', message: `Could not save the ${currentType.toLowerCase()}.` });
    } finally {
      setSaving(false);
    }
  };

  const confirmRemove = async (id: string) => {
    try {
      await remove(id);
      addToast({ type: 'success', message: `${currentType} deleted.` });
    } catch {
      addToast({ type: 'error', message: `Could not delete the ${currentType.toLowerCase()}.` });
    } finally {
      setArmDeleteId(null);
    }
  };

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

  const isMission = view === 'missions';
  const isSatellite = view === 'satellites';
  const isTelemetry = view === 'telemetry';
  const noun = NOUN[currentType] || `${currentType.toLowerCase()} records`;
  const statuses = currentType === 'Mission' ? MISSION_STATUSES : currentType === 'Satellite' ? SATELLITE_STATUSES : null;
  const fieldCls = 'w-full bg-zinc-950 border border-zinc-800 rounded-lg px-2 py-1.5 text-sm text-white placeholder-gray-500';
  const labelCls = 'flex flex-col gap-1 text-[11px] text-zinc-400';

  return (
    <div className="space-y-4">
      {runAction.isPending && <span className="text-xs text-neon-cyan animate-pulse">AI processing...</span>}

      {/* Header — ALWAYS mounted (F9): a refetch must never be able to
          unmount the search input and drop its focus. */}
      <div className="flex items-center gap-2">
        <div className="flex-1 relative">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-gray-400" />
          <input
            ref={searchInputRef}
            value={searchQuery}
            onChange={e => setSearchQuery(e.target.value)}
            placeholder={`Search ${noun}...`}
            aria-label={`Search ${noun}`}
            className="w-full pl-9 pr-3 py-2 bg-zinc-900 border border-zinc-800 rounded-lg text-sm text-white placeholder-gray-500"
          />
        </div>
        <button
          type="button"
          onClick={openCreate}
          className="flex items-center gap-2 px-3 py-2 bg-indigo-600 hover:bg-indigo-500 text-white rounded-lg text-sm"
        >
          <Plus className="w-4 h-4" /> New {currentType}
        </button>
      </div>

      {editor && (
        <div className="bg-zinc-900 border border-indigo-500/30 rounded-xl p-4 space-y-3">
          <div className="flex items-center justify-between">
            <h3 className="text-sm font-semibold text-white">{editor.id ? `Edit ${currentType}` : `New ${currentType}`}</h3>
            <button type="button" onClick={() => setEditor(null)} aria-label="Close editor" className="p-1 hover:bg-zinc-800 rounded text-gray-400 hover:text-white">
              <X className="w-4 h-4" />
            </button>
          </div>
          <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
            <label className={labelCls}>Name
              <input value={editor.title} onChange={(e) => setEditor({ ...editor, title: e.target.value })} placeholder={`e.g. ${currentType === 'Mission' ? 'Artemis III' : currentType === 'Satellite' ? 'NOAA-21' : `My ${currentType.toLowerCase()}`}`} className={fieldCls} />
            </label>
            {statuses ? (
              <label className={labelCls}>Status
                <select value={String(editor.data.status || statuses[0])} onChange={(e) => setField('status', e.target.value)} className={fieldCls}>
                  {statuses.map((s) => <option key={s} value={s}>{s}</option>)}
                </select>
              </label>
            ) : (
              <label className={labelCls}>Status
                <input value={String(editor.data.status || '')} onChange={(e) => setField('status', e.target.value)} placeholder="e.g. scheduled" className={fieldCls} />
              </label>
            )}
            {isMission && (
              <>
                <label className={labelCls}>Launch vehicle
                  <input value={String(editor.data.launchVehicle || '')} onChange={(e) => setField('launchVehicle', e.target.value)} placeholder="e.g. Falcon 9" className={fieldCls} />
                </label>
                <label className={labelCls}>Launch date
                  <input type="date" value={String(editor.data.launchDate || '')} onChange={(e) => setField('launchDate', e.target.value)} className={fieldCls} />
                </label>
                <label className={labelCls}>Payload
                  <input value={String(editor.data.payload || '')} onChange={(e) => setField('payload', e.target.value)} placeholder="e.g. Starlink v2 mini ×21" className={fieldCls} />
                </label>
                <label className={labelCls}>Crew size
                  <input type="number" min={0} value={numVal(editor.data.crewSize)} onChange={numField('crewSize')} className={fieldCls} />
                </label>
                <label className={cn(labelCls, 'md:col-span-2')}>Objective
                  <input value={String(editor.data.objective || '')} onChange={(e) => setField('objective', e.target.value)} placeholder="What is this mission for?" className={fieldCls} />
                </label>
              </>
            )}
            {isSatellite && (
              <>
                <label className={labelCls}>Orbit
                  <input value={String(editor.data.orbit || '')} onChange={(e) => setField('orbit', e.target.value)} placeholder="e.g. LEO / SSO" className={fieldCls} />
                </label>
                <label className={labelCls}>Altitude (km)
                  <input type="number" min={0} value={numVal(editor.data.altitude)} onChange={numField('altitude')} className={fieldCls} />
                </label>
                <label className={labelCls}>Inclination (°)
                  <input type="number" step="0.1" value={numVal(editor.data.inclination)} onChange={numField('inclination')} className={fieldCls} />
                </label>
                <label className={labelCls}>Operator
                  <input value={String(editor.data.operator || '')} onChange={(e) => setField('operator', e.target.value)} placeholder="e.g. NOAA" className={fieldCls} />
                </label>
              </>
            )}
            {view === 'launchops' && (
              <>
                <label className={labelCls}>Launch vehicle
                  <input value={String(editor.data.launchVehicle || '')} onChange={(e) => setField('launchVehicle', e.target.value)} placeholder="e.g. Electron" className={fieldCls} />
                </label>
                <label className={labelCls}>Launch date
                  <input type="date" value={String(editor.data.launchDate || '')} onChange={(e) => setField('launchDate', e.target.value)} className={fieldCls} />
                </label>
                <label className={labelCls}>Pad / site
                  <input value={String(editor.data.pad || '')} onChange={(e) => setField('pad', e.target.value)} placeholder="e.g. LC-1A, Wallops" className={fieldCls} />
                </label>
              </>
            )}
            {isTelemetry && (
              <>
                <label className={labelCls}>Source
                  <input value={String(editor.data.source || '')} onChange={(e) => setField('source', e.target.value)} placeholder="e.g. DSN Madrid" className={fieldCls} />
                </label>
                <label className={labelCls}>Signal strength (%)
                  <input type="number" min={0} max={100} value={numVal(editor.data.signalStrength)} onChange={numField('signalStrength')} className={fieldCls} />
                </label>
                <label className={labelCls}>Data rate
                  <input value={String(editor.data.dataRate || '')} onChange={(e) => setField('dataRate', e.target.value)} placeholder="e.g. 256 kbps" className={fieldCls} />
                </label>
              </>
            )}
            {view === 'crew' && (
              <label className={labelCls}>Role
                <input value={String(editor.data.role || '')} onChange={(e) => setField('role', e.target.value)} placeholder="e.g. Commander" className={fieldCls} />
              </label>
            )}
            {view === 'debris' && (
              <>
                <label className={labelCls}>Orbit
                  <input value={String(editor.data.orbit || '')} onChange={(e) => setField('orbit', e.target.value)} placeholder="e.g. LEO" className={fieldCls} />
                </label>
                <label className={labelCls}>Altitude (km)
                  <input type="number" min={0} value={numVal(editor.data.altitude)} onChange={numField('altitude')} className={fieldCls} />
                </label>
              </>
            )}
          </div>
          <div className="flex gap-2">
            <button type="button" onClick={saveEditor} disabled={saving} className="px-3 py-1.5 bg-indigo-600 hover:bg-indigo-500 disabled:opacity-50 text-white rounded-lg text-sm">
              {saving ? 'Saving…' : editor.id ? 'Save changes' : `Create ${currentType.toLowerCase()}`}
            </button>
            <button type="button" onClick={() => setEditor(null)} className="px-3 py-1.5 bg-zinc-800 hover:bg-zinc-700 text-zinc-200 rounded-lg text-sm">Cancel</button>
          </div>
        </div>
      )}

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

      {/* Content region — loading/error swap ONLY here, never the header. */}
      {isLoading && items.length === 0 ? (
        <div className="flex items-center justify-center p-8">
          <div className="text-center space-y-3">
            <div className="w-8 h-8 border-2 border-indigo-500 border-t-transparent rounded-full animate-spin mx-auto" />
            <p className="text-sm text-gray-400">Loading space operations...</p>
          </div>
        </div>
      ) : isError && items.length === 0 ? (
        <div className="flex items-center justify-center p-8"><ErrorState error={error?.message} onRetry={refetch} /></div>
      ) : (
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
                    <button type="button" onClick={() => handleAction('analyze', item.id)} className="p-1.5 hover:bg-zinc-800 rounded text-gray-400 hover:text-neon-cyan" aria-label="Analyze" title="Analyze">
                      <Zap className="w-3.5 h-3.5" />
                    </button>
                    <button type="button" onClick={() => openEdit(item)} className="p-1.5 hover:bg-zinc-800 rounded text-gray-400 hover:text-white" aria-label="Edit" title="Edit">
                      <Pencil className="w-3.5 h-3.5" />
                    </button>
                    {armDeleteId === item.id ? (
                      <button type="button" onClick={() => confirmRemove(item.id)} className="px-2 py-1 bg-red-600 hover:bg-red-500 text-white rounded text-xs" aria-label="Confirm delete">
                        Confirm delete?
                      </button>
                    ) : (
                      <button type="button" onClick={() => setArmDeleteId(item.id)} className="p-1.5 hover:bg-zinc-800 rounded text-gray-400 hover:text-red-400" aria-label="Delete" title="Delete">
                        <Trash2 className="w-3.5 h-3.5" />
                      </button>
                    )}
                  </div>
                </div>

                {!!d.objective && (
                  <p className="text-xs text-gray-400 mt-2">{String(d.objective)}</p>
                )}
                {!!d.role && view === 'crew' && (
                  <p className="text-xs text-gray-400 mt-2">{String(d.role)}</p>
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
                        <Zap className="w-3.5 h-3.5 text-yellow-400" /> {String(d.dataRate)}
                      </span>
                    )}
                    {Array.isArray(d.anomalies) && (
                      <span className={cn(
                        'text-[11px] px-2 py-0.5 rounded-full',
                        d.anomalies.length > 0 ? 'bg-red-500/10 text-red-400' : 'bg-zinc-800 text-gray-400',
                      )}>
                        <AlertTriangle className="w-3 h-3 inline" /> {d.anomalies.length} anomal{d.anomalies.length === 1 ? 'y' : 'ies'}
                      </span>
                    )}
                  </div>
                )}
              </motion.div>
            );
          })}
        </AnimatePresence>

        {items.length === 0 && !isLoading && (
          <div className="text-center py-12 text-gray-400">
            <Rocket className="w-10 h-10 mx-auto mb-3 opacity-30" />
            <p>No {noun} found</p>
            <p className="text-xs mt-1">Use “New {currentType}” to add one — you name it.</p>
          </div>
        )}
      </div>
      )}
    </div>
  );
}
