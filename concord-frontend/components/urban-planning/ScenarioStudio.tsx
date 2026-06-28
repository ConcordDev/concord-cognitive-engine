/* eslint-disable @typescript-eslint/no-explicit-any */
'use client';

import { useState, useCallback, useEffect } from 'react';
import { lensRun } from '@/lib/api/client';
import { ChartKit } from '@/components/viz';
import {
  Layers,
  Plus,
  Trash2,
  Loader2,
  Box,
  GitCompare,
  RefreshCw,
} from 'lucide-react';

interface Massing {
  zoneType: string;
  lotSizeSqFt: number;
  floorAreaRatio: number;
  lotCoveragePct: number;
  footprintSqFt: number;
  floors: number;
  buildingHeightFt: number;
  maxHeightFt: number;
  setbackFt: number;
  grossFloorAreaSqFt: number;
  netFloorAreaSqFt: number;
  dwellingUnits: number;
  jobs: number;
  population: number;
  emissionsTonnesPerYear: number;
  envelope: { widthFt: number; depthFt: number; heightFt: number };
}

interface Scenario {
  id: string;
  name: string;
  description: string;
  zoneType: string;
  lotSizeSqFt: number;
  useMix: string;
  efficiency: number;
  impacts?: Massing;
}

interface CompareRow extends Massing {
  id: string;
  name: string;
}

interface CompareResult {
  scenarios: CompareRow[];
  metrics: string[];
  totals: Record<string, number>;
  best: Record<string, string>;
  count: number;
}

const ZONES = ['residential', 'commercial', 'mixed', 'industrial'];
const MIXES = ['residential', 'commercial', 'mixed', 'industrial'];

const METRIC_LABELS: Record<string, string> = {
  dwellingUnits: 'Dwelling units',
  jobs: 'Jobs',
  population: 'Residents',
  grossFloorAreaSqFt: 'Gross floor area (sqft)',
  emissionsTonnesPerYear: 'Emissions (t CO2e/yr)',
  floors: 'Floors',
};

function MassingBox({ m }: { m: Massing }) {
  // Scaled isometric massing block — height proportional to floors.
  const maxFloors = Math.max(m.floors, Math.floor(m.maxHeightFt / 11));
  const fillPct = maxFloors > 0 ? (m.floors / maxFloors) * 100 : 0;
  return (
    <div className="flex items-end gap-3">
      <div
        className="relative w-20 rounded-sm border border-emerald-500/40 bg-zinc-900"
        style={{ height: 120 }}
        title={`${m.floors} floors of max ${maxFloors}`}
      >
        <div
          className="absolute bottom-0 left-0 right-0 rounded-sm bg-gradient-to-t from-emerald-600/70 to-emerald-400/40"
          style={{ height: `${Math.min(100, fillPct)}%` }}
        />
        {Array.from({ length: Math.min(m.floors, 24) }).map((_, i) => (
          <div
            key={i}
            className="absolute left-0 right-0 border-t border-emerald-300/20"
            style={{ bottom: `${((i + 1) / Math.max(maxFloors, 1)) * 100}%` }}
          />
        ))}
      </div>
      <div className="text-xs text-zinc-400 space-y-0.5">
        <div className="text-emerald-300 font-semibold">{m.floors} floors · {m.buildingHeightFt} ft</div>
        <div>Envelope {m.envelope.widthFt}×{m.envelope.depthFt}×{m.envelope.heightFt} ft</div>
        <div>Footprint {m.footprintSqFt.toLocaleString()} sqft ({m.lotCoveragePct}% cov)</div>
        <div>GFA {m.grossFloorAreaSqFt.toLocaleString()} · FAR {m.floorAreaRatio}</div>
      </div>
    </div>
  );
}

export function ScenarioStudio() {
  const [scenarios, setScenarios] = useState<Scenario[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [compare, setCompare] = useState<CompareResult | null>(null);

  // New-scenario form.
  const [name, setName] = useState('');
  const [zoneType, setZoneType] = useState('mixed');
  const [useMix, setUseMix] = useState('mixed');
  const [lotSizeSqFt, setLotSizeSqFt] = useState('20000');
  const [efficiency, setEfficiency] = useState('0.82');
  const [description, setDescription] = useState('');

  const [loadError, setLoadError] = useState<string | null>(null);

  const refresh = useCallback(async () => {
    setLoading(true);
    setError(null);
    setLoadError(null);
    try {
      const r = await lensRun<{ scenarios: Scenario[] }>('urban-planning', 'scenario-list', {});
      if (r.data.ok && r.data.result) {
        setScenarios(r.data.result.scenarios);
      } else {
        // Do NOT swallow a load failure into a silently-empty page — surface it
        // as a dedicated error state with a working Retry (loadError, below).
        setLoadError(r.data.error || 'failed to load scenarios');
      }
    } catch (e) {
      setLoadError(e instanceof Error ? e.message : 'failed to load scenarios');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    refresh();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const create = useCallback(async () => {
    if (!name.trim()) {
      setError('scenario name required');
      return;
    }
    setBusy(true);
    setError(null);
    const r = await lensRun('urban-planning', 'scenario-create', {
      name,
      description,
      zoneType,
      useMix,
      lotSizeSqFt: Number(lotSizeSqFt),
      efficiency: Number(efficiency),
    });
    setBusy(false);
    if (r.data.ok) {
      setName('');
      setDescription('');
      await refresh();
    } else {
      setError(r.data.error || 'create failed');
    }
  }, [name, description, zoneType, useMix, lotSizeSqFt, efficiency, refresh]);

  const remove = useCallback(
    async (id: string) => {
      setBusy(true);
      await lensRun('urban-planning', 'scenario-remove', { id });
      setBusy(false);
      setCompare(null);
      await refresh();
    },
    [refresh],
  );

  const runCompare = useCallback(async () => {
    setBusy(true);
    setError(null);
    const r = await lensRun<CompareResult>('urban-planning', 'scenario-compare', {});
    setBusy(false);
    if (r.data.ok && r.data.result) setCompare(r.data.result);
    else setError(r.data.error || 'comparison needs at least one scenario');
  }, []);

  return (
    <div className="space-y-4">
      {/* New scenario */}
      <div className="rounded-lg border border-zinc-800 bg-zinc-900/60 p-4">
        <h3 className="mb-3 flex items-center gap-2 text-sm font-semibold text-white">
          <Layers className="h-4 w-4 text-emerald-400" /> New Development Scenario
        </h3>
        <div className="grid grid-cols-2 gap-2 md:grid-cols-3">
          <input
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder="Scenario name"
            className="rounded border border-zinc-800 bg-zinc-950 px-2 py-1.5 text-xs text-white placeholder-zinc-600"
          />
          <select
            value={zoneType}
            onChange={(e) => setZoneType(e.target.value)}
            className="rounded border border-zinc-800 bg-zinc-950 px-2 py-1.5 text-xs text-white"
          >
            {ZONES.map((z) => (
              <option key={z} value={z}>
                Zone: {z}
              </option>
            ))}
          </select>
          <select
            value={useMix}
            onChange={(e) => setUseMix(e.target.value)}
            className="rounded border border-zinc-800 bg-zinc-950 px-2 py-1.5 text-xs text-white"
          >
            {MIXES.map((m) => (
              <option key={m} value={m}>
                Use: {m}
              </option>
            ))}
          </select>
          <input
            value={lotSizeSqFt}
            onChange={(e) => setLotSizeSqFt(e.target.value)}
            type="number"
            placeholder="Lot size (sqft)"
            className="rounded border border-zinc-800 bg-zinc-950 px-2 py-1.5 text-xs text-white placeholder-zinc-600"
          />
          <input
            value={efficiency}
            onChange={(e) => setEfficiency(e.target.value)}
            type="number"
            step="0.01"
            min="0.4"
            max="1"
            placeholder="Floor efficiency 0.4-1"
            className="rounded border border-zinc-800 bg-zinc-950 px-2 py-1.5 text-xs text-white placeholder-zinc-600"
          />
          <input
            value={description}
            onChange={(e) => setDescription(e.target.value)}
            placeholder="Description (optional)"
            className="rounded border border-zinc-800 bg-zinc-950 px-2 py-1.5 text-xs text-white placeholder-zinc-600"
          />
        </div>
        <div className="mt-3 flex items-center gap-2">
          <button
            onClick={create}
            disabled={busy}
            className="inline-flex items-center gap-1.5 rounded-md bg-emerald-600 px-3 py-1.5 text-xs text-white hover:bg-emerald-500 disabled:opacity-50"
          >
            {busy ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Plus className="h-3.5 w-3.5" />}
            Add Scenario
          </button>
          <button
            onClick={runCompare}
            disabled={busy || scenarios.length === 0}
            className="inline-flex items-center gap-1.5 rounded-md border border-emerald-500/30 bg-emerald-500/10 px-3 py-1.5 text-xs text-emerald-200 hover:bg-emerald-500/20 disabled:opacity-50"
          >
            <GitCompare className="h-3.5 w-3.5" /> Compare All
          </button>
          <button
            onClick={refresh}
            className="inline-flex items-center gap-1.5 rounded-md border border-zinc-700 px-2 py-1.5 text-xs text-zinc-300 hover:bg-zinc-800"
            aria-label="Refresh scenarios"
          >
            <RefreshCw className="h-3.5 w-3.5" />
          </button>
        </div>
        {error && (
          <div className="mt-2 rounded border border-red-500/20 bg-red-500/5 px-2 py-1.5 text-xs text-red-300">
            {error}
          </div>
        )}
      </div>

      {/* Comparison dashboard */}
      {compare && (
        <div className="rounded-lg border border-emerald-500/20 bg-zinc-900/60 p-4">
          <h3 className="mb-3 flex items-center gap-2 text-sm font-semibold text-white">
            <GitCompare className="h-4 w-4 text-emerald-400" /> Scenario Comparison ({compare.count})
          </h3>
          <ChartKit
            kind="bar"
            data={compare.scenarios.map((s) => ({
              name: s.name,
              units: s.dwellingUnits,
              jobs: s.jobs,
              emissions: s.emissionsTonnesPerYear,
            }))}
            xKey="name"
            series={[
              { key: 'units', label: 'Units' },
              { key: 'jobs', label: 'Jobs' },
              { key: 'emissions', label: 'Emissions (t/yr)' },
            ]}
            height={220}
          />
          <div className="mt-3 overflow-x-auto">
            <table className="w-full text-xs">
              <thead>
                <tr className="text-left text-zinc-400">
                  <th className="py-1 pr-3">Metric</th>
                  {compare.scenarios.map((s) => (
                    <th key={s.id} className="py-1 pr-3 text-right">
                      {s.name}
                    </th>
                  ))}
                  <th className="py-1 pr-3 text-right">Total</th>
                </tr>
              </thead>
              <tbody>
                {compare.metrics.map((m) => (
                  <tr key={m} className="border-t border-zinc-800">
                    <td className="py-1 pr-3 text-zinc-400">{METRIC_LABELS[m] || m}</td>
                    {compare.scenarios.map((s) => (
                      <td
                        key={s.id}
                        className={
                          'py-1 pr-3 text-right font-mono ' +
                          (compare.best[m] === s.id
                            ? 'text-emerald-300 font-semibold'
                            : 'text-zinc-300')
                        }
                      >
                        {((s as any)[m] as number).toLocaleString()}
                      </td>
                    ))}
                    <td className="py-1 pr-3 text-right font-mono text-zinc-400">
                      {compare.totals[m]?.toLocaleString()}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
            <p className="mt-1 text-[10px] text-zinc-400">
              Emerald = best scenario for that metric (lowest emissions, highest yield otherwise).
            </p>
          </div>
        </div>
      )}

      {/* Scenario cards with massing + impacts */}
      {loading ? (
        <div
          role="status"
          aria-live="polite"
          className="flex items-center gap-2 text-xs text-zinc-400"
        >
          <Loader2 className="h-4 w-4 animate-spin" />
          <span>Loading scenarios…</span>
        </div>
      ) : loadError ? (
        <div
          role="alert"
          className="rounded-lg border border-red-500/30 bg-red-500/5 p-6 text-center"
        >
          <p className="text-sm text-red-300">{loadError}</p>
          <button
            onClick={refresh}
            className="mt-3 inline-flex items-center gap-1.5 rounded-md border border-red-500/30 bg-red-500/10 px-3 py-1.5 text-xs text-red-200 hover:bg-red-500/20"
          >
            <RefreshCw className="h-3.5 w-3.5" /> Retry
          </button>
        </div>
      ) : scenarios.length === 0 ? (
        <div className="rounded-lg border border-dashed border-zinc-800 p-8 text-center text-xs text-zinc-400">
          No scenarios yet. Create one above to model massing &amp; impacts.
        </div>
      ) : (
        <div className="grid gap-3 md:grid-cols-2">
          {scenarios.map((s) => (
            <div key={s.id} className="rounded-lg border border-zinc-800 bg-zinc-900/60 p-4">
              <div className="mb-2 flex items-start justify-between">
                <div>
                  <h4 className="flex items-center gap-2 text-sm font-semibold text-white">
                    <Box className="h-4 w-4 text-emerald-400" /> {s.name}
                  </h4>
                  {s.description && (
                    <p className="mt-0.5 text-xs text-zinc-400">{s.description}</p>
                  )}
                  <p className="mt-0.5 text-[10px] uppercase tracking-wider text-zinc-400">
                    {s.zoneType} · use {s.useMix} · {s.lotSizeSqFt.toLocaleString()} sqft lot
                  </p>
                </div>
                <button
                  onClick={() => remove(s.id)}
                  className="rounded p-1 text-zinc-600 hover:bg-zinc-800 hover:text-red-400"
                  aria-label="Delete scenario"
                >
                  <Trash2 className="h-3.5 w-3.5" />
                </button>
              </div>
              {s.impacts && (
                <>
                  <MassingBox m={s.impacts} />
                  <div className="mt-3 grid grid-cols-2 gap-1.5 sm:grid-cols-4">
                    {[
                      ['Units', s.impacts.dwellingUnits],
                      ['Jobs', s.impacts.jobs],
                      ['Residents', s.impacts.population],
                      ['t CO2e/yr', s.impacts.emissionsTonnesPerYear],
                    ].map(([label, val]) => (
                      <div
                        key={label as string}
                        className="rounded border border-zinc-800 bg-zinc-950 px-2 py-1"
                      >
                        <div className="text-[9px] uppercase tracking-wider text-zinc-400">
                          {label}
                        </div>
                        <div className="font-mono text-sm text-emerald-300">
                          {(val as number).toLocaleString()}
                        </div>
                      </div>
                    ))}
                  </div>
                </>
              )}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
