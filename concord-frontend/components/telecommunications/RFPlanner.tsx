'use client';

/**
 * RFPlanner — telecom network-planning workbench.
 *
 * Wires the full telecommunications planning suite to real backend macros:
 *   towerList/towerSave/towerDelete  — persistent per-user site inventory
 *   propagationModel                 — COST-231 Hata terrain-aware coverage
 *   interferenceAnalysis             — cell-overlap + co-channel C/I
 *   capacityProjection               — subscriber-growth vs headroom
 *   topology                         — towers + backhaul + core links
 *   spectrumList/Allocate/Delete/Plan — frequency-band allocation planner
 *   outageList/Report/Resolve/slaReport — fault dashboard + SLA tracking
 *   driveTestImport/List/Validate    — measured vs predicted coverage
 *
 * Every rendered value comes from a real macro call. No mock/seed data.
 */

import { useState, useCallback, useEffect, useMemo } from 'react';
import {
  Antenna, Radar, Radio, TrendingUp, Network, Wifi, AlertTriangle,
  Route, Plus, Trash2, Loader2, Check, X, RefreshCw,
} from 'lucide-react';
import { lensRun } from '@/lib/api/client';
import { ChartKit, TimelineView, TreeDiagram, MapView } from '@/components/viz';
import type { MapMarker, TreeNode, TimelineEvent } from '@/components/viz';
import { cn } from '@/lib/utils';

const DOMAIN = 'telecommunications';

// ---- types ------------------------------------------------------------------

interface Tower {
  id: string;
  name: string;
  lat: number;
  lon: number;
  heightM: number;
  powerWatts: number;
  gainDbi: number;
  freqMhz: number;
  technology: string;
  terrain: 'urban' | 'suburban' | 'rural' | 'water';
  status: 'active' | 'maintenance' | 'planned' | 'decommissioned';
  backhaul: 'fiber' | 'microwave' | 'satellite';
  sectors: number;
}

interface PropCell {
  id: string; name: string; lat: number; lon: number; terrain: string;
  freqMhz: number; eirpDbm: number; linkBudgetDb: number;
  effectiveRangeKm: number; coverageKm2: number; edgeRsrpDbm: number; edgeQuality: string;
}
interface PropResult {
  model: string; cells: PropCell[]; totalCoverageKm2: number;
  assumptions: { rxSensitivityDbm: number; mobileHeightM: number; fadeMarginDb: number };
}
interface InterferencePair {
  towerA: string; towerB: string; separationKm: number; overlapKm2: number;
  overlapPercent: number; coChannel: boolean; freqGapMhz: number; ciDb: number; severity: string;
}
interface InterferenceResult {
  pairsAnalyzed: number; overlappingPairs: number; coChannelConflicts: number;
  worstCiDb: number | null; conflicts: InterferencePair[]; recommendation: string;
}
interface CapPoint {
  month: number; subscribers: number; demandMbps: number;
  utilizationPercent: number; headroomPercent: number;
}
interface CapResult {
  horizonMonths: number; series: CapPoint[]; targetUtilizationPercent: number;
  breachMonth: number | null; breachWarning: string;
  recommendedBandwidthGbps: number; additionalGbps: number;
}
interface TopoResult {
  tree: TreeNode; towerCount: number; aggregationHubs: number;
  totalBackhaulGbps: number; satelliteHops: number;
  links: Array<{ from: string; to: string; kind: string; latencyMs: number; demandGbps?: number }>;
}
interface Allocation {
  id: string; band: string; startMhz: number; widthMhz: number; endMhz: number;
  technology: string; licenseType: string; region: string; guardBandMhz: number;
}
interface SpectrumPlan {
  allocations: Allocation[]; totalAllocatedMhz: number; spectralSpanMhz: number;
  utilizationPercent: number;
  gaps: Array<{ afterBand: string; beforeBand: string; startMhz: number; widthMhz: number }>;
  guardBandViolations: Array<{ bandA: string; bandB: string; actualGapMhz: number; requiredGuardMhz: number }>;
  byTechnology: Array<{ technology: string; mhz: number }>;
}
interface Outage {
  id: string; site: string; cause: string; severity: 'critical' | 'major' | 'minor';
  affectedSubscribers: number; startedAt: number; resolvedAt: number | null; status: string;
}
interface SlaResult {
  windowDays: number; slaTargetPercent: number; availabilityPercent: number;
  downtimeHours: number; incidents: number; openIncidents: number; mttrHours: number | null;
  slaMet: boolean; breachBudgetHours: number;
  bySeverity: Array<{ severity: string; count: number }>;
}
interface DriveTestPoint {
  id: string; lat: number; lon: number; measuredDbm: number;
  predictedDbm: number; errorDbm: number; server: string | null;
}
interface DriveTestResult {
  points: DriveTestPoint[]; sampleCount: number; meanErrorDbm: number;
  rmseDbm: number; meanAbsErrorDbm: number; calibrationOffsetDbm: number;
  modelGrade: string; recommendation: string;
}

type SubTab = 'sites' | 'propagation' | 'interference' | 'capacity'
  | 'topology' | 'spectrum' | 'outages' | 'drivetest';

// ---- small ui helpers -------------------------------------------------------

const SEVERITY_TONE: Record<string, MapMarker['tone']> = {
  critical: 'bad', major: 'warn', minor: 'info',
  high: 'warn', moderate: 'info', low: 'good', good: 'good',
  fair: 'warn', weak: 'bad',
};

function Field({ label, value, onChange, type = 'text', placeholder }: {
  label: string; value: string; onChange: (v: string) => void;
  type?: string; placeholder?: string;
}) {
  return (
    <label className="flex flex-col gap-0.5">
      <span className="text-[10px] uppercase tracking-wider text-zinc-400">{label}</span>
      <input
        type={type}
        value={value}
        onChange={(e) => onChange(e.target.value)}
        placeholder={placeholder}
        className="bg-zinc-900 border border-zinc-800 rounded px-2 py-1 text-[12px] text-white font-mono"
      />
    </label>
  );
}

function Select({ label, value, onChange, options }: {
  label: string; value: string; onChange: (v: string) => void; options: string[];
}) {
  return (
    <label className="flex flex-col gap-0.5">
      <span className="text-[10px] uppercase tracking-wider text-zinc-400">{label}</span>
      <select
        value={value}
        onChange={(e) => onChange(e.target.value)}
        className="bg-zinc-900 border border-zinc-800 rounded px-2 py-1 text-[12px] text-white"
      >
        {options.map((o) => <option key={o} value={o}>{o}</option>)}
      </select>
    </label>
  );
}

function Stat({ label, value, tone }: { label: string; value: string | number; tone?: string }) {
  return (
    <div className="rounded-md border border-zinc-800 bg-zinc-900/60 p-2.5">
      <div className={cn('text-xl font-bold',
        tone === 'bad' ? 'text-red-400' : tone === 'warn' ? 'text-amber-400'
          : tone === 'good' ? 'text-emerald-400' : 'text-violet-300')}>
        {value}
      </div>
      <div className="text-[10px] text-zinc-400">{label}</div>
    </div>
  );
}

// ---- main -------------------------------------------------------------------

export function RFPlanner() {
  const [tab, setTab] = useState<SubTab>('sites');
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  // shared state
  const [towers, setTowers] = useState<Tower[]>([]);
  const [allocations, setAllocations] = useState<Allocation[]>([]);
  const [outages, setOutages] = useState<Outage[]>([]);

  const flash = useCallback((msg: string) => {
    setNotice(msg);
    setTimeout(() => setNotice(null), 4000);
  }, []);

  const run = useCallback(async <T,>(action: string, input: Record<string, unknown> = {}): Promise<T | null> => {
    setBusy(action);
    setError(null);
    try {
      const r = await lensRun<T>(DOMAIN, action, input);
      if (!r.data.ok || r.data.result == null) {
        setError(r.data.error || `${action} failed`);
        return null;
      }
      return r.data.result;
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
      return null;
    } finally {
      setBusy(null);
    }
  }, []);

  const refreshTowers = useCallback(async () => {
    const r = await run<{ towers: Tower[] }>('towerList');
    if (r) setTowers(r.towers || []);
  }, [run]);

  const refreshSpectrum = useCallback(async () => {
    const r = await run<{ allocations: Allocation[] }>('spectrumList');
    if (r) setAllocations(r.allocations || []);
  }, [run]);

  const refreshOutages = useCallback(async () => {
    const r = await run<{ outages: Outage[] }>('outageList');
    if (r) setOutages(r.outages || []);
  }, [run]);

  // initial load
  useEffect(() => {
    refreshTowers();
    refreshSpectrum();
    refreshOutages();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const TABS: { key: SubTab; label: string; icon: typeof Antenna }[] = [
    { key: 'sites', label: 'Sites', icon: Antenna },
    { key: 'propagation', label: 'RF Coverage', icon: Radar },
    { key: 'interference', label: 'Interference', icon: Radio },
    { key: 'capacity', label: 'Capacity Plan', icon: TrendingUp },
    { key: 'topology', label: 'Topology', icon: Network },
    { key: 'spectrum', label: 'Spectrum', icon: Wifi },
    { key: 'outages', label: 'Outages / SLA', icon: AlertTriangle },
    { key: 'drivetest', label: 'Drive Test', icon: Route },
  ];

  return (
    <div className="rounded-lg border border-violet-500/20 bg-zinc-950/60 p-3 space-y-3">
      <header className="flex items-center gap-2 border-b border-violet-500/10 pb-2">
        <Radar className="h-4 w-4 text-violet-400" />
        <h3 className="text-sm font-semibold text-white">RF Network Planner</h3>
        <span className="rounded bg-zinc-800 px-1.5 py-0.5 font-mono text-[10px] uppercase tracking-wider text-zinc-400">
          COST-231 propagation · interference · spectrum · SLA
        </span>
      </header>

      <div className="flex gap-1 bg-zinc-900 rounded-lg p-1 flex-wrap">
        {TABS.map(({ key, label, icon: Icon }) => (
          <button
            key={key}
            onClick={() => { setTab(key); setError(null); }}
            className={cn(
              'flex items-center gap-1.5 px-2.5 py-1.5 rounded-md text-[12px] font-medium transition-colors',
              tab === key ? 'bg-zinc-800 text-white' : 'text-zinc-400 hover:text-zinc-300',
            )}
          >
            <Icon className="w-3.5 h-3.5" /> {label}
          </button>
        ))}
      </div>

      {error && (
        <div className="px-3 py-2 rounded text-[11px] flex items-center gap-2 border bg-red-500/10 text-red-300 border-red-500/30">
          <X className="h-3 w-3" /> {error}
        </div>
      )}
      {notice && (
        <div className="px-3 py-2 rounded text-[11px] flex items-center gap-2 border bg-emerald-500/10 text-emerald-300 border-emerald-500/30">
          <Check className="h-3 w-3" /> {notice}
        </div>
      )}

      {tab === 'sites' && (
        <SitesTab towers={towers} run={run} busy={busy} refreshTowers={refreshTowers} flash={flash} />
      )}
      {tab === 'propagation' && (
        <PropagationTab towers={towers} run={run} busy={busy} />
      )}
      {tab === 'interference' && (
        <InterferenceTab towers={towers} run={run} busy={busy} />
      )}
      {tab === 'capacity' && (
        <CapacityTab run={run} busy={busy} />
      )}
      {tab === 'topology' && (
        <TopologyTab towers={towers} run={run} busy={busy} />
      )}
      {tab === 'spectrum' && (
        <SpectrumTab allocations={allocations} run={run} busy={busy} refreshSpectrum={refreshSpectrum} flash={flash} />
      )}
      {tab === 'outages' && (
        <OutagesTab outages={outages} run={run} busy={busy} refreshOutages={refreshOutages} flash={flash} />
      )}
      {tab === 'drivetest' && (
        <DriveTestTab towers={towers} run={run} busy={busy} />
      )}
    </div>
  );
}

// ===========================================================================
// Sites — tower CRUD + map
// ===========================================================================

interface RunFn { <T>(action: string, input?: Record<string, unknown>): Promise<T | null>; }

function SitesTab({ towers, run, busy, refreshTowers, flash }: {
  towers: Tower[]; run: RunFn; busy: string | null;
  refreshTowers: () => Promise<void>; flash: (m: string) => void;
}) {
  const [form, setForm] = useState({
    name: '', lat: '', lon: '', heightM: '30', powerWatts: '40',
    gainDbi: '16', freqMhz: '1800', technology: '4G', terrain: 'suburban',
    status: 'active', backhaul: 'fiber', sectors: '3',
  });
  const set = (k: string) => (v: string) => setForm((f) => ({ ...f, [k]: v }));

  const save = async () => {
    const r = await run<{ tower: Tower }>('towerSave', {
      name: form.name || undefined,
      lat: parseFloat(form.lat),
      lon: parseFloat(form.lon),
      heightM: parseFloat(form.heightM),
      powerWatts: parseFloat(form.powerWatts),
      gainDbi: parseFloat(form.gainDbi),
      freqMhz: parseFloat(form.freqMhz),
      technology: form.technology,
      terrain: form.terrain,
      status: form.status,
      backhaul: form.backhaul,
      sectors: parseInt(form.sectors, 10),
    });
    if (r) {
      await refreshTowers();
      flash(`Saved ${r.tower.name}`);
      setForm((f) => ({ ...f, name: '', lat: '', lon: '' }));
    }
  };

  const del = async (id: string) => {
    const r = await run<{ removed: number }>('towerDelete', { id });
    if (r) { await refreshTowers(); flash(`Removed ${r.removed} site`); }
  };

  const markers: MapMarker[] = towers.map((t) => ({
    id: t.id, lat: t.lat, lon: t.lon, label: `${t.name} · ${t.technology}`,
    tone: t.status === 'active' ? 'good' : t.status === 'planned' ? 'info'
      : t.status === 'maintenance' ? 'warn' : 'default',
  }));

  return (
    <div className="space-y-3">
      <div className="grid grid-cols-2 md:grid-cols-4 lg:grid-cols-6 gap-2">
        <Field label="Site name" value={form.name} onChange={set('name')} placeholder="auto" />
        <Field label="Latitude" value={form.lat} onChange={set('lat')} type="number" placeholder="-90..90" />
        <Field label="Longitude" value={form.lon} onChange={set('lon')} type="number" placeholder="-180..180" />
        <Field label="Height (m)" value={form.heightM} onChange={set('heightM')} type="number" />
        <Field label="Power (W)" value={form.powerWatts} onChange={set('powerWatts')} type="number" />
        <Field label="Gain (dBi)" value={form.gainDbi} onChange={set('gainDbi')} type="number" />
        <Field label="Freq (MHz)" value={form.freqMhz} onChange={set('freqMhz')} type="number" />
        <Field label="Sectors" value={form.sectors} onChange={set('sectors')} type="number" />
        <Select label="Technology" value={form.technology} onChange={set('technology')} options={['5G', '4G', '3G']} />
        <Select label="Terrain" value={form.terrain} onChange={set('terrain')} options={['urban', 'suburban', 'rural', 'water']} />
        <Select label="Status" value={form.status} onChange={set('status')} options={['active', 'maintenance', 'planned', 'decommissioned']} />
        <Select label="Backhaul" value={form.backhaul} onChange={set('backhaul')} options={['fiber', 'microwave', 'satellite']} />
      </div>
      <button
        onClick={save}
        disabled={!!busy}
        className="flex items-center gap-1.5 px-3 py-1.5 bg-violet-600 hover:bg-violet-500 disabled:opacity-40 text-white rounded-md text-[12px]"
      >
        {busy === 'towerSave' ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Plus className="w-3.5 h-3.5" />}
        Save site
      </button>

      <div>
        <div className="text-[10px] uppercase tracking-wider text-violet-400 mb-1">
          Site map ({towers.length})
        </div>
        <MapView markers={markers} height={260} />
      </div>

      <div className="space-y-1">
        {towers.map((t) => (
          <div key={t.id} className="flex items-center justify-between rounded-md border border-zinc-800 bg-zinc-900/50 px-3 py-2">
            <div className="text-[12px] text-zinc-200">
              <span className="font-semibold">{t.name}</span>
              <span className="text-zinc-400 ml-2 font-mono">
                {t.lat.toFixed(3)},{t.lon.toFixed(3)} · {t.technology} · {t.freqMhz}MHz · {t.powerWatts}W · {t.terrain} · {t.status}
              </span>
            </div>
            <button
              onClick={() => del(t.id)}
              disabled={!!busy}
              className="p-1 hover:bg-zinc-800 rounded text-zinc-400 hover:text-red-400"
              aria-label="Delete site"
            >
              <Trash2 className="w-3.5 h-3.5" />
            </button>
          </div>
        ))}
        {towers.length === 0 && (
          <p className="py-4 text-center text-[11px] text-zinc-400">No sites yet — add one above.</p>
        )}
      </div>
    </div>
  );
}

// ===========================================================================
// Propagation — RF coverage prediction map
// ===========================================================================

function PropagationTab({ towers, run, busy }: { towers: Tower[]; run: RunFn; busy: string | null }) {
  const [result, setResult] = useState<PropResult | null>(null);
  const [rx, setRx] = useState('-100');
  const [fade, setFade] = useState('8');
  const [mob, setMob] = useState('1.5');

  const predict = async () => {
    const r = await run<PropResult>('propagationModel', {
      rxSensitivityDbm: parseFloat(rx),
      fadeMarginDb: parseFloat(fade),
      mobileHeightM: parseFloat(mob),
    });
    if (r) setResult(r);
  };

  const markers: MapMarker[] = (result?.cells || []).map((c) => ({
    id: c.id, lat: c.lat, lon: c.lon,
    label: `${c.name} · ${c.effectiveRangeKm}km · RSRP ${c.edgeRsrpDbm}dBm`,
    tone: SEVERITY_TONE[c.edgeQuality] || 'info',
    value: Math.max(0, Math.min(1, c.effectiveRangeKm / 20)),
  }));

  return (
    <div className="space-y-3">
      <div className="grid grid-cols-3 gap-2 max-w-md">
        <Field label="Rx sens (dBm)" value={rx} onChange={setRx} type="number" />
        <Field label="Fade margin (dB)" value={fade} onChange={setFade} type="number" />
        <Field label="Mobile h (m)" value={mob} onChange={setMob} type="number" />
      </div>
      <button
        onClick={predict}
        disabled={!!busy || towers.length === 0}
        className="flex items-center gap-1.5 px-3 py-1.5 bg-violet-600 hover:bg-violet-500 disabled:opacity-40 text-white rounded-md text-[12px]"
      >
        {busy === 'propagationModel' ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Radar className="w-3.5 h-3.5" />}
        Predict coverage
      </button>
      {towers.length === 0 && (
        <p className="text-[11px] text-zinc-400">Add sites in the Sites tab first.</p>
      )}

      {result && (
        <>
          <div className="grid grid-cols-2 md:grid-cols-4 gap-2">
            <Stat label="Total coverage" value={`${result.totalCoverageKm2} km²`} />
            <Stat label="Cells modelled" value={result.cells.length} />
            <Stat label="Model" value={result.model.split('+')[0].trim()} />
            <Stat label="Fade margin" value={`${result.assumptions.fadeMarginDb} dB`} />
          </div>
          <div>
            <div className="text-[10px] uppercase tracking-wider text-violet-400 mb-1">
              Predicted coverage footprint
            </div>
            <MapView markers={markers} height={260} />
          </div>
          <div className="overflow-x-auto">
            <table className="w-full text-[11px]">
              <thead>
                <tr className="text-zinc-400 text-left">
                  <th className="py-1">Cell</th><th>Terrain</th><th>EIRP</th>
                  <th>Link budget</th><th>Range</th><th>Coverage</th><th>Edge RSRP</th><th>Quality</th>
                </tr>
              </thead>
              <tbody>
                {result.cells.map((c) => (
                  <tr key={c.id} className="border-t border-zinc-800 text-zinc-300">
                    <td className="py-1 font-medium">{c.name}</td>
                    <td>{c.terrain}</td>
                    <td>{c.eirpDbm} dBm</td>
                    <td>{c.linkBudgetDb} dB</td>
                    <td>{c.effectiveRangeKm} km</td>
                    <td>{c.coverageKm2} km²</td>
                    <td>{c.edgeRsrpDbm} dBm</td>
                    <td className={cn(
                      c.edgeQuality === 'good' ? 'text-emerald-400'
                        : c.edgeQuality === 'fair' ? 'text-amber-400' : 'text-red-400')}>
                      {c.edgeQuality}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </>
      )}
    </div>
  );
}

// ===========================================================================
// Interference — cell-overlap + co-channel C/I
// ===========================================================================

function InterferenceTab({ towers, run, busy }: { towers: Tower[]; run: RunFn; busy: string | null }) {
  const [result, setResult] = useState<InterferenceResult | null>(null);

  const analyze = async () => {
    const r = await run<InterferenceResult>('interferenceAnalysis');
    if (r) setResult(r);
  };

  const chartData = useMemo(
    () => (result?.conflicts || []).map((p) => ({
      pair: `${p.towerA}↔${p.towerB}`,
      ciDb: p.ciDb,
      overlapPercent: p.overlapPercent,
    })),
    [result],
  );

  return (
    <div className="space-y-3">
      <button
        onClick={analyze}
        disabled={!!busy || towers.length < 2}
        className="flex items-center gap-1.5 px-3 py-1.5 bg-violet-600 hover:bg-violet-500 disabled:opacity-40 text-white rounded-md text-[12px]"
      >
        {busy === 'interferenceAnalysis' ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Radio className="w-3.5 h-3.5" />}
        Analyze interference
      </button>
      {towers.length < 2 && (
        <p className="text-[11px] text-zinc-400">Need at least 2 sites for interference analysis.</p>
      )}

      {result && (
        <>
          <div className="grid grid-cols-2 md:grid-cols-4 gap-2">
            <Stat label="Pairs analyzed" value={result.pairsAnalyzed} />
            <Stat label="Overlapping pairs" value={result.overlappingPairs}
              tone={result.overlappingPairs ? 'warn' : 'good'} />
            <Stat label="Co-channel conflicts" value={result.coChannelConflicts}
              tone={result.coChannelConflicts ? 'bad' : 'good'} />
            <Stat label="Worst C/I" value={result.worstCiDb != null ? `${result.worstCiDb} dB` : '—'}
              tone={result.worstCiDb != null && result.worstCiDb < 12 ? 'bad' : 'good'} />
          </div>
          <div className="px-3 py-2 rounded text-[11px] border bg-violet-500/10 text-violet-200 border-violet-500/30">
            {result.recommendation}
          </div>
          {chartData.length > 0 && (
            <ChartKit
              kind="bar"
              data={chartData}
              xKey="pair"
              series={[
                { key: 'ciDb', label: 'C/I (dB)', color: '#22c55e' },
                { key: 'overlapPercent', label: 'Overlap %', color: '#f59e0b' },
              ]}
              height={220}
            />
          )}
          <div className="space-y-1">
            {result.conflicts.map((p, i) => (
              <div key={i} className="flex items-center justify-between rounded-md border border-zinc-800 bg-zinc-900/50 px-3 py-2 text-[11px]">
                <span className="text-zinc-200 font-medium">{p.towerA} ↔ {p.towerB}</span>
                <span className="text-zinc-400 font-mono">
                  {p.separationKm}km · {p.overlapPercent}% overlap · C/I {p.ciDb}dB · gap {p.freqGapMhz}MHz
                  {p.coChannel ? ' · CO-CHANNEL' : ''}
                </span>
                <span className={cn('px-1.5 py-0.5 rounded text-[10px]',
                  p.severity === 'critical' ? 'bg-red-500/20 text-red-300'
                    : p.severity === 'high' ? 'bg-amber-500/20 text-amber-300'
                      : p.severity === 'moderate' ? 'bg-indigo-500/20 text-indigo-300'
                        : 'bg-emerald-500/20 text-emerald-300')}>
                  {p.severity}
                </span>
              </div>
            ))}
            {result.conflicts.length === 0 && (
              <p className="py-3 text-center text-[11px] text-zinc-400">No overlapping cells.</p>
            )}
          </div>
        </>
      )}
    </div>
  );
}

// ===========================================================================
// Capacity — subscriber-growth projection
// ===========================================================================

function CapacityTab({ run, busy }: { run: RunFn; busy: string | null }) {
  const [result, setResult] = useState<CapResult | null>(null);
  const [f, setF] = useState({
    bandwidthGbps: '10', currentSubscribers: '5000', monthlyGrowthPercent: '4',
    months: '24', mbpsPerSubscriber: '1.5', targetUtilizationPercent: '80',
  });
  const set = (k: string) => (v: string) => setF((s) => ({ ...s, [k]: v }));

  const project = async () => {
    const r = await run<CapResult>('capacityProjection', {
      bandwidthGbps: parseFloat(f.bandwidthGbps),
      currentSubscribers: parseInt(f.currentSubscribers, 10),
      monthlyGrowthPercent: parseFloat(f.monthlyGrowthPercent),
      months: parseInt(f.months, 10),
      mbpsPerSubscriber: parseFloat(f.mbpsPerSubscriber),
      targetUtilizationPercent: parseFloat(f.targetUtilizationPercent),
    });
    if (r) setResult(r);
  };

  return (
    <div className="space-y-3">
      <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-6 gap-2">
        <Field label="Bandwidth (Gbps)" value={f.bandwidthGbps} onChange={set('bandwidthGbps')} type="number" />
        <Field label="Subscribers" value={f.currentSubscribers} onChange={set('currentSubscribers')} type="number" />
        <Field label="Growth %/mo" value={f.monthlyGrowthPercent} onChange={set('monthlyGrowthPercent')} type="number" />
        <Field label="Horizon (mo)" value={f.months} onChange={set('months')} type="number" />
        <Field label="Mbps/sub" value={f.mbpsPerSubscriber} onChange={set('mbpsPerSubscriber')} type="number" />
        <Field label="Target util %" value={f.targetUtilizationPercent} onChange={set('targetUtilizationPercent')} type="number" />
      </div>
      <button
        onClick={project}
        disabled={!!busy}
        className="flex items-center gap-1.5 px-3 py-1.5 bg-violet-600 hover:bg-violet-500 disabled:opacity-40 text-white rounded-md text-[12px]"
      >
        {busy === 'capacityProjection' ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <TrendingUp className="w-3.5 h-3.5" />}
        Project capacity
      </button>

      {result && (
        <>
          <div className="grid grid-cols-2 md:grid-cols-4 gap-2">
            <Stat label="Horizon" value={`${result.horizonMonths} mo`} />
            <Stat label="Breach month"
              value={result.breachMonth != null ? `M${result.breachMonth}` : 'none'}
              tone={result.breachMonth != null ? 'bad' : 'good'} />
            <Stat label="Recommended BW" value={`${result.recommendedBandwidthGbps} Gbps`} />
            <Stat label="Additional BW" value={`+${result.additionalGbps} Gbps`}
              tone={result.additionalGbps > 0 ? 'warn' : 'good'} />
          </div>
          <div className={cn('px-3 py-2 rounded text-[11px] border',
            result.breachMonth != null
              ? 'bg-amber-500/10 text-amber-200 border-amber-500/30'
              : 'bg-emerald-500/10 text-emerald-200 border-emerald-500/30')}>
            {result.breachWarning}
          </div>
          <ChartKit
            kind="area"
            data={result.series as unknown as Array<Record<string, unknown>>}
            xKey="month"
            series={[
              { key: 'utilizationPercent', label: 'Utilization %', color: '#ef4444' },
              { key: 'headroomPercent', label: 'Headroom %', color: '#22c55e' },
            ]}
            height={240}
          />
          <ChartKit
            kind="line"
            data={result.series as unknown as Array<Record<string, unknown>>}
            xKey="month"
            series={[
              { key: 'subscribers', label: 'Subscribers', color: '#6366f1' },
              { key: 'demandMbps', label: 'Demand (Mbps)', color: '#06b6d4' },
            ]}
            height={220}
          />
        </>
      )}
    </div>
  );
}

// ===========================================================================
// Topology — towers + backhaul + core
// ===========================================================================

function TopologyTab({ towers, run, busy }: { towers: Tower[]; run: RunFn; busy: string | null }) {
  const [result, setResult] = useState<TopoResult | null>(null);
  const [coreName, setCoreName] = useState('Core / EPC');

  const build = async () => {
    const r = await run<TopoResult>('topology', { coreNodeName: coreName });
    if (r) setResult(r);
  };

  return (
    <div className="space-y-3">
      <div className="flex items-end gap-2">
        <div className="w-56">
          <Field label="Core node name" value={coreName} onChange={setCoreName} />
        </div>
        <button
          onClick={build}
          disabled={!!busy || towers.length === 0}
          className="flex items-center gap-1.5 px-3 py-1.5 bg-violet-600 hover:bg-violet-500 disabled:opacity-40 text-white rounded-md text-[12px]"
        >
          {busy === 'topology' ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Network className="w-3.5 h-3.5" />}
          Build topology
        </button>
      </div>
      {towers.length === 0 && (
        <p className="text-[11px] text-zinc-400">Add sites in the Sites tab first.</p>
      )}

      {result && (
        <>
          <div className="grid grid-cols-2 md:grid-cols-4 gap-2">
            <Stat label="Towers" value={result.towerCount} />
            <Stat label="Aggregation hubs" value={result.aggregationHubs} />
            <Stat label="Total backhaul" value={`${result.totalBackhaulGbps} Gbps`} />
            <Stat label="Satellite hops" value={result.satelliteHops}
              tone={result.satelliteHops ? 'warn' : 'good'} />
          </div>
          <div>
            <div className="text-[10px] uppercase tracking-wider text-violet-400 mb-1">
              Network topology
            </div>
            <TreeDiagram root={result.tree} />
          </div>
          <div className="overflow-x-auto">
            <table className="w-full text-[11px]">
              <thead>
                <tr className="text-zinc-400 text-left">
                  <th className="py-1">From</th><th>To</th><th>Link</th><th>Latency</th><th>Demand</th>
                </tr>
              </thead>
              <tbody>
                {result.links.map((l, i) => (
                  <tr key={i} className="border-t border-zinc-800 text-zinc-300">
                    <td className="py-1 font-mono">{l.from}</td>
                    <td className="font-mono">{l.to}</td>
                    <td>{l.kind}</td>
                    <td className={l.latencyMs > 50 ? 'text-amber-400' : ''}>{l.latencyMs} ms</td>
                    <td>{l.demandGbps != null ? `${l.demandGbps} Gbps` : '—'}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </>
      )}
    </div>
  );
}

// ===========================================================================
// Spectrum — frequency-band allocation planner
// ===========================================================================

function SpectrumTab({ allocations, run, busy, refreshSpectrum, flash }: {
  allocations: Allocation[]; run: RunFn; busy: string | null;
  refreshSpectrum: () => Promise<void>; flash: (m: string) => void;
}) {
  const [plan, setPlan] = useState<SpectrumPlan | null>(null);
  const [f, setF] = useState({
    band: '', startMhz: '', widthMhz: '', technology: '5G',
    licenseType: 'licensed', region: 'national', guardBandMhz: '1',
  });
  const set = (k: string) => (v: string) => setF((s) => ({ ...s, [k]: v }));

  const allocate = async () => {
    const r = await run<{ allocation: Allocation }>('spectrumAllocate', {
      band: f.band || undefined,
      startMhz: parseFloat(f.startMhz),
      widthMhz: parseFloat(f.widthMhz),
      technology: f.technology,
      licenseType: f.licenseType,
      region: f.region,
      guardBandMhz: parseFloat(f.guardBandMhz),
    });
    if (r) {
      await refreshSpectrum();
      flash(`Allocated ${r.allocation.band}`);
      setF((s) => ({ ...s, band: '', startMhz: '', widthMhz: '' }));
    }
  };

  const del = async (id: string) => {
    const r = await run<{ removed: number }>('spectrumDelete', { id });
    if (r) { await refreshSpectrum(); setPlan(null); flash('Allocation removed'); }
  };

  const analyzePlan = async () => {
    const r = await run<SpectrumPlan>('spectrumPlan');
    if (r) setPlan(r);
  };

  return (
    <div className="space-y-3">
      <div className="grid grid-cols-2 md:grid-cols-4 lg:grid-cols-7 gap-2">
        <Field label="Band name" value={f.band} onChange={set('band')} placeholder="auto" />
        <Field label="Start (MHz)" value={f.startMhz} onChange={set('startMhz')} type="number" />
        <Field label="Width (MHz)" value={f.widthMhz} onChange={set('widthMhz')} type="number" />
        <Field label="Guard (MHz)" value={f.guardBandMhz} onChange={set('guardBandMhz')} type="number" />
        <Select label="Technology" value={f.technology} onChange={set('technology')} options={['5G', '4G', '3G', 'IoT']} />
        <Select label="License" value={f.licenseType} onChange={set('licenseType')} options={['licensed', 'unlicensed', 'shared']} />
        <Field label="Region" value={f.region} onChange={set('region')} />
      </div>
      <div className="flex gap-2">
        <button
          onClick={allocate}
          disabled={!!busy}
          className="flex items-center gap-1.5 px-3 py-1.5 bg-violet-600 hover:bg-violet-500 disabled:opacity-40 text-white rounded-md text-[12px]"
        >
          {busy === 'spectrumAllocate' ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Plus className="w-3.5 h-3.5" />}
          Allocate block
        </button>
        <button
          onClick={analyzePlan}
          disabled={!!busy || allocations.length === 0}
          className="flex items-center gap-1.5 px-3 py-1.5 bg-zinc-800 hover:bg-zinc-700 disabled:opacity-40 text-white rounded-md text-[12px]"
        >
          {busy === 'spectrumPlan' ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Wifi className="w-3.5 h-3.5" />}
          Analyze plan
        </button>
      </div>

      <div className="space-y-1">
        {allocations.map((a) => (
          <div key={a.id} className="flex items-center justify-between rounded-md border border-zinc-800 bg-zinc-900/50 px-3 py-2 text-[11px]">
            <span className="text-zinc-200 font-medium">{a.band}</span>
            <span className="text-zinc-400 font-mono">
              {a.startMhz}–{a.endMhz} MHz · {a.widthMhz}MHz · {a.technology} · {a.licenseType} · guard {a.guardBandMhz}MHz
            </span>
            <button
              onClick={() => del(a.id)}
              disabled={!!busy}
              className="p-1 hover:bg-zinc-800 rounded text-zinc-400 hover:text-red-400"
              aria-label="Delete allocation"
            >
              <Trash2 className="w-3.5 h-3.5" />
            </button>
          </div>
        ))}
        {allocations.length === 0 && (
          <p className="py-3 text-center text-[11px] text-zinc-400">No spectrum allocated yet.</p>
        )}
      </div>

      {plan && (
        <>
          <div className="grid grid-cols-2 md:grid-cols-4 gap-2">
            <Stat label="Total allocated" value={`${plan.totalAllocatedMhz} MHz`} />
            <Stat label="Spectral span" value={`${plan.spectralSpanMhz} MHz`} />
            <Stat label="Spectral util" value={`${plan.utilizationPercent}%`} />
            <Stat label="Guard violations" value={plan.guardBandViolations.length}
              tone={plan.guardBandViolations.length ? 'bad' : 'good'} />
          </div>
          {/* spectrum band map */}
          <div className="rounded-md border border-zinc-800 bg-zinc-950/40 p-2">
            <div className="text-[10px] uppercase tracking-wider text-violet-400 mb-1">Band layout</div>
            <div className="relative h-7 w-full rounded bg-zinc-900 overflow-hidden">
              {plan.allocations.map((a, i) => {
                const lo = plan.allocations[0].startMhz;
                const span = plan.spectralSpanMhz || 1;
                const left = ((a.startMhz - lo) / span) * 100;
                const w = (a.widthMhz / span) * 100;
                const colors = ['#6366f1', '#22c55e', '#f59e0b', '#ec4899', '#06b6d4', '#a855f7'];
                return (
                  <div
                    key={a.id}
                    className="absolute top-0 h-full flex items-center justify-center text-[9px] text-white font-mono"
                    style={{ left: `${left}%`, width: `${w}%`, backgroundColor: colors[i % colors.length] }}
                    title={`${a.band}: ${a.startMhz}-${a.endMhz}MHz`}
                  >
                    {w > 6 ? a.band : ''}
                  </div>
                );
              })}
            </div>
          </div>
          {plan.byTechnology.length > 0 && (
            <ChartKit
              kind="bar"
              data={plan.byTechnology}
              xKey="technology"
              series={[{ key: 'mhz', label: 'Allocated MHz', color: '#a855f7' }]}
              height={200}
            />
          )}
          {plan.gaps.length > 0 && (
            <div className="px-3 py-2 rounded text-[11px] border bg-zinc-800/40 text-zinc-300 border-zinc-700">
              <span className="text-zinc-400">Spectrum gaps: </span>
              {plan.gaps.map((g, i) => (
                <span key={i} className="font-mono">
                  {g.widthMhz}MHz @ {g.startMhz}MHz ({g.afterBand}→{g.beforeBand}){i < plan.gaps.length - 1 ? ', ' : ''}
                </span>
              ))}
            </div>
          )}
          {plan.guardBandViolations.length > 0 && (
            <div className="px-3 py-2 rounded text-[11px] border bg-red-500/10 text-red-300 border-red-500/30">
              {plan.guardBandViolations.map((v, i) => (
                <div key={i}>
                  {v.bandA} ↔ {v.bandB}: gap {v.actualGapMhz}MHz &lt; required {v.requiredGuardMhz}MHz
                </div>
              ))}
            </div>
          )}
        </>
      )}
    </div>
  );
}

// ===========================================================================
// Outages — fault dashboard + SLA tracking
// ===========================================================================

function OutagesTab({ outages, run, busy, refreshOutages, flash }: {
  outages: Outage[]; run: RunFn; busy: string | null;
  refreshOutages: () => Promise<void>; flash: (m: string) => void;
}) {
  const [sla, setSla] = useState<SlaResult | null>(null);
  const [windowDays, setWindowDays] = useState('30');
  const [slaTarget, setSlaTarget] = useState('99.9');
  const [f, setF] = useState({
    site: '', cause: '', severity: 'minor', affectedSubscribers: '0',
  });
  const set = (k: string) => (v: string) => setF((s) => ({ ...s, [k]: v }));

  const report = async () => {
    const r = await run<{ outage: Outage }>('outageReport', {
      site: f.site || undefined,
      cause: f.cause || undefined,
      severity: f.severity,
      affectedSubscribers: parseInt(f.affectedSubscribers, 10),
      startedAt: Date.now(),
    });
    if (r) {
      await refreshOutages();
      flash(`Outage logged for ${r.outage.site}`);
      setF((s) => ({ ...s, site: '', cause: '' }));
    }
  };

  const resolve = async (id: string) => {
    const r = await run<{ outage: Outage }>('outageResolve', { id });
    if (r) { await refreshOutages(); flash('Outage resolved'); }
  };

  const computeSla = async () => {
    const r = await run<SlaResult>('slaReport', {
      windowDays: parseInt(windowDays, 10),
      slaTargetPercent: parseFloat(slaTarget),
    });
    if (r) setSla(r);
  };

  const timeline: TimelineEvent[] = outages.map((o) => ({
    id: o.id,
    label: `${o.site} · ${o.cause}`,
    time: o.startedAt,
    tone: SEVERITY_TONE[o.severity] || 'default',
    detail: `${o.severity} · ${o.affectedSubscribers} subs · ${o.status}`,
  }));

  return (
    <div className="space-y-3">
      <div className="grid grid-cols-2 md:grid-cols-4 gap-2">
        <Field label="Site" value={f.site} onChange={set('site')} placeholder="site id" />
        <Field label="Cause" value={f.cause} onChange={set('cause')} placeholder="e.g. power loss" />
        <Select label="Severity" value={f.severity} onChange={set('severity')} options={['critical', 'major', 'minor']} />
        <Field label="Affected subs" value={f.affectedSubscribers} onChange={set('affectedSubscribers')} type="number" />
      </div>
      <button
        onClick={report}
        disabled={!!busy}
        className="flex items-center gap-1.5 px-3 py-1.5 bg-violet-600 hover:bg-violet-500 disabled:opacity-40 text-white rounded-md text-[12px]"
      >
        {busy === 'outageReport' ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <AlertTriangle className="w-3.5 h-3.5" />}
        Log outage
      </button>

      <div className="space-y-1">
        {outages.map((o) => (
          <div key={o.id} className="flex items-center justify-between rounded-md border border-zinc-800 bg-zinc-900/50 px-3 py-2 text-[11px]">
            <span className="text-zinc-200 font-medium">{o.site}</span>
            <span className="text-zinc-400 font-mono">
              {o.cause} · {o.severity} · {o.affectedSubscribers} subs · {o.status}
            </span>
            {o.status === 'open' ? (
              <button
                onClick={() => resolve(o.id)}
                disabled={!!busy}
                className="flex items-center gap-1 px-2 py-0.5 rounded bg-emerald-600/20 text-emerald-300 hover:bg-emerald-600/40 text-[10px]"
              >
                <Check className="w-3 h-3" /> Resolve
              </button>
            ) : (
              <span className="px-2 py-0.5 rounded bg-zinc-700/40 text-zinc-400 text-[10px]">resolved</span>
            )}
          </div>
        ))}
        {outages.length === 0 && (
          <p className="py-3 text-center text-[11px] text-zinc-400">No outages logged.</p>
        )}
      </div>

      {timeline.length > 0 && (
        <div>
          <div className="text-[10px] uppercase tracking-wider text-violet-400 mb-1">Incident timeline</div>
          <TimelineView events={timeline} height={120} />
        </div>
      )}

      <div className="border-t border-zinc-800 pt-3 space-y-2">
        <div className="flex items-end gap-2">
          <div className="w-32"><Field label="SLA window (days)" value={windowDays} onChange={setWindowDays} type="number" /></div>
          <div className="w-32"><Field label="SLA target %" value={slaTarget} onChange={setSlaTarget} type="number" /></div>
          <button
            onClick={computeSla}
            disabled={!!busy}
            className="flex items-center gap-1.5 px-3 py-1.5 bg-zinc-800 hover:bg-zinc-700 disabled:opacity-40 text-white rounded-md text-[12px]"
          >
            {busy === 'slaReport' ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <RefreshCw className="w-3.5 h-3.5" />}
            Compute SLA
          </button>
        </div>
        {sla && (
          <>
            <div className="grid grid-cols-2 md:grid-cols-4 gap-2">
              <Stat label="Availability" value={`${sla.availabilityPercent}%`}
                tone={sla.slaMet ? 'good' : 'bad'} />
              <Stat label="Downtime" value={`${sla.downtimeHours} h`} />
              <Stat label="MTTR" value={sla.mttrHours != null ? `${sla.mttrHours} h` : '—'} />
              <Stat label="Open incidents" value={sla.openIncidents}
                tone={sla.openIncidents ? 'warn' : 'good'} />
            </div>
            <div className={cn('px-3 py-2 rounded text-[11px] border',
              sla.slaMet
                ? 'bg-emerald-500/10 text-emerald-200 border-emerald-500/30'
                : 'bg-red-500/10 text-red-300 border-red-500/30')}>
              {sla.slaMet
                ? `SLA met — ${sla.availabilityPercent}% ≥ ${sla.slaTargetPercent}% target.`
                : `SLA breached — ${sla.breachBudgetHours}h over the downtime budget.`}
            </div>
            <ChartKit
              kind="bar"
              data={sla.bySeverity}
              xKey="severity"
              series={[{ key: 'count', label: 'Incidents', color: '#ef4444' }]}
              height={180}
            />
          </>
        )}
      </div>
    </div>
  );
}

// ===========================================================================
// Drive test — measured vs predicted coverage
// ===========================================================================

function DriveTestTab({ towers, run, busy }: { towers: Tower[]; run: RunFn; busy: string | null }) {
  const [csv, setCsv] = useState('');
  const [result, setResult] = useState<DriveTestResult | null>(null);
  const [imported, setImported] = useState<number | null>(null);

  const parseCsv = (text: string) => {
    // accepts "lat,lon,rsrpDbm[,sinrDb,technology]" rows, one per line
    return text.split(/\r?\n/).map((ln) => ln.trim()).filter(Boolean).map((ln) => {
      const c = ln.split(',').map((x) => x.trim());
      return {
        lat: parseFloat(c[0]),
        lon: parseFloat(c[1]),
        rsrpDbm: parseFloat(c[2]),
        sinrDb: c[3] != null && c[3] !== '' ? parseFloat(c[3]) : undefined,
        technology: c[4] || undefined,
      };
    }).filter((m) => Number.isFinite(m.lat) && Number.isFinite(m.lon) && Number.isFinite(m.rsrpDbm));
  };

  const importCsv = async () => {
    const measurements = parseCsv(csv);
    if (measurements.length === 0) return;
    const r = await run<{ imported: number; total: number }>('driveTestImport', { measurements });
    if (r) { setImported(r.imported); setCsv(''); }
  };

  const validate = async () => {
    const r = await run<DriveTestResult>('driveTestValidate');
    if (r) setResult(r);
  };

  const markers: MapMarker[] = (result?.points || []).map((p) => ({
    id: p.id, lat: p.lat, lon: p.lon,
    label: `meas ${p.measuredDbm}dBm · pred ${p.predictedDbm}dBm · err ${p.errorDbm}dB`,
    value: Math.max(0, Math.min(1, Math.abs(p.errorDbm) / 20)),
    tone: Math.abs(p.errorDbm) < 6 ? 'good' : Math.abs(p.errorDbm) < 10 ? 'warn' : 'bad',
  }));

  return (
    <div className="space-y-3">
      <div>
        <div className="text-[10px] uppercase tracking-wider text-violet-400 mb-1">
          Drive-test measurements (CSV: lat,lon,rsrpDbm[,sinrDb,technology])
        </div>
        <textarea
          value={csv}
          onChange={(e) => setCsv(e.target.value)}
          rows={5}
          placeholder={'40.71,-74.00,-82,12,4G\n40.72,-74.01,-95,8,4G'}
          className="w-full bg-zinc-900 border border-zinc-800 rounded px-3 py-2 text-[11px] text-white font-mono"
        />
      </div>
      <div className="flex gap-2">
        <button
          onClick={importCsv}
          disabled={!!busy || !csv.trim()}
          className="flex items-center gap-1.5 px-3 py-1.5 bg-violet-600 hover:bg-violet-500 disabled:opacity-40 text-white rounded-md text-[12px]"
        >
          {busy === 'driveTestImport' ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Plus className="w-3.5 h-3.5" />}
          Import measurements
        </button>
        <button
          onClick={validate}
          disabled={!!busy || towers.length === 0}
          className="flex items-center gap-1.5 px-3 py-1.5 bg-zinc-800 hover:bg-zinc-700 disabled:opacity-40 text-white rounded-md text-[12px]"
        >
          {busy === 'driveTestValidate' ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Route className="w-3.5 h-3.5" />}
          Validate vs predicted
        </button>
      </div>
      {imported != null && (
        <p className="text-[11px] text-emerald-400">Imported {imported} measurement(s).</p>
      )}
      {towers.length === 0 && (
        <p className="text-[11px] text-zinc-400">Add sites in the Sites tab to validate against.</p>
      )}

      {result && (
        <>
          <div className="grid grid-cols-2 md:grid-cols-4 gap-2">
            <Stat label="Samples" value={result.sampleCount} />
            <Stat label="RMSE" value={`${result.rmseDbm} dB`}
              tone={result.rmseDbm < 6 ? 'good' : result.rmseDbm < 10 ? 'warn' : 'bad'} />
            <Stat label="Mean error" value={`${result.meanErrorDbm} dB`} />
            <Stat label="Calibration offset" value={`${result.calibrationOffsetDbm} dB`} />
          </div>
          <div className={cn('px-3 py-2 rounded text-[11px] border',
            result.modelGrade === 'good fit'
              ? 'bg-emerald-500/10 text-emerald-200 border-emerald-500/30'
              : result.modelGrade === 'acceptable'
                ? 'bg-amber-500/10 text-amber-200 border-amber-500/30'
                : 'bg-red-500/10 text-red-300 border-red-500/30')}>
            <span className="font-semibold uppercase">{result.modelGrade}</span> — {result.recommendation}
          </div>
          <div>
            <div className="text-[10px] uppercase tracking-wider text-violet-400 mb-1">
              Measured vs predicted error map
            </div>
            <MapView markers={markers} height={240} />
          </div>
          <ChartKit
            kind="scatter"
            data={result.points.map((p) => ({
              predictedDbm: p.predictedDbm, measuredDbm: p.measuredDbm,
            }))}
            xKey="predictedDbm"
            series={[{ key: 'measuredDbm', label: 'Measured vs predicted (dBm)', color: '#06b6d4' }]}
            height={220}
          />
        </>
      )}
    </div>
  );
}
