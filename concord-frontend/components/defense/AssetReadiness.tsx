'use client';

/**
 * AssetReadiness — per-asset status feeding a fleet readiness rollup.
 * Backed by defense.asset-upsert / asset-delete / asset-rollup macros.
 */

import { useState, useEffect, useCallback } from 'react';
import { ChartKit } from '@/components/viz';
import { lensRun } from '@/lib/api/client';
import { Plus, Trash2, Loader2, Crosshair, Edit2, X } from 'lucide-react';

interface DefAsset {
  id: string;
  designation: string;
  type: string;
  status: 'operational' | 'maintenance' | 'deployed' | 'decommissioned';
  readiness: number;
  assignedUnit: string;
  lat?: number | null;
  lon?: number | null;
}

interface AssetRollupResult {
  total: number;
  inService: number;
  byStatus: Record<string, number>;
  byType: Record<string, number>;
  fleetReadiness: number;
  availabilityPct: number;
  meanReadiness: number;
  lowReadiness: { id: string; designation: string; readiness: number; status: string }[];
  rollupStatus: 'green' | 'amber' | 'red';
}

const ASSET_TYPES = ['vehicle', 'aircraft', 'vessel', 'weapon_system', 'sensor', 'comms'] as const;
const ASSET_STATUSES = ['operational', 'maintenance', 'deployed', 'decommissioned'] as const;

const STATUS_COLOR: Record<string, string> = {
  operational: 'text-green-400',
  maintenance: 'text-orange-400',
  deployed: 'text-cyan-400',
  decommissioned: 'text-zinc-500',
};

const ROLLUP_COLOR: Record<string, string> = {
  green: 'text-green-400',
  amber: 'text-amber-400',
  red: 'text-red-400',
};

function readinessBar(v: number): string {
  if (v >= 80) return 'bg-green-500';
  if (v >= 55) return 'bg-amber-500';
  return 'bg-red-500';
}

interface AssetForm {
  id?: string;
  designation: string;
  type: string;
  status: string;
  readiness: string;
  assignedUnit: string;
}

const EMPTY_FORM: AssetForm = {
  designation: '',
  type: 'vehicle',
  status: 'operational',
  readiness: '100',
  assignedUnit: '',
};

export function AssetReadiness() {
  const [assets, setAssets] = useState<DefAsset[]>([]);
  const [rollup, setRollup] = useState<AssetRollupResult | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [form, setForm] = useState<AssetForm | null>(null);

  const refresh = useCallback(async () => {
    setLoading(true);
    setError(null);
    // asset-rollup returns fleet aggregates + the lowReadiness at-risk subset.
    // The full per-asset table is maintained as a session mirror updated on
    // each upsert/delete (the rollup macro is aggregate-only by design).
    const r = await lensRun<AssetRollupResult>('defense', 'asset-rollup', {});
    if (r.data?.ok && r.data.result) {
      setRollup(r.data.result);
    } else {
      setError(r.data?.error || 'Failed to load asset rollup');
    }
    setLoading(false);
  }, []);

  useEffect(() => {
    refresh();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const save = useCallback(async () => {
    if (!form) return;
    if (!form.designation.trim()) {
      setError('Designation is required');
      return;
    }
    setBusy(true);
    setError(null);
    const r = await lensRun<{ asset: DefAsset }>('defense', 'asset-upsert', {
      id: form.id,
      designation: form.designation.trim(),
      type: form.type,
      status: form.status,
      readiness: Number(form.readiness) || 0,
      assignedUnit: form.assignedUnit.trim(),
    });
    if (r.data?.ok && r.data.result) {
      const a = r.data.result.asset;
      setAssets((prev) => {
        const others = prev.filter((p) => p.id !== a.id);
        return [...others, a].sort((x, y) => x.designation.localeCompare(y.designation));
      });
      setForm(null);
      await refresh();
    } else {
      setError(r.data?.error || 'Failed to save asset');
    }
    setBusy(false);
  }, [form, refresh]);

  const remove = useCallback(async (id: string) => {
    setBusy(true);
    const r = await lensRun('defense', 'asset-delete', { id });
    if (r.data?.ok) {
      setAssets((prev) => prev.filter((p) => p.id !== id));
      await refresh();
    } else {
      setError(r.data?.error || 'Failed to delete asset');
    }
    setBusy(false);
  }, [refresh]);

  const statusChart = rollup
    ? ASSET_STATUSES.map((s) => ({ status: s, count: rollup.byStatus[s] || 0 }))
    : [];

  return (
    <section className="rounded-xl border border-zinc-800 bg-zinc-950/40 p-4 space-y-3">
      <header className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          <Crosshair className="w-4 h-4 text-cyan-400" />
          <h3 className="text-sm font-semibold text-white">Asset Readiness Rollup</h3>
        </div>
        {rollup && (
          <span className={`text-xs font-semibold ${ROLLUP_COLOR[rollup.rollupStatus]}`}>
            {rollup.rollupStatus.toUpperCase()} · fleet {rollup.fleetReadiness}%
          </span>
        )}
      </header>

      {error && (
        <div className="rounded-md border border-red-500/30 bg-red-500/10 px-3 py-1.5 text-xs text-red-400">
          {error}
        </div>
      )}

      {loading ? (
        <div className="flex items-center justify-center py-12 text-zinc-500">
          <Loader2 className="w-5 h-5 animate-spin" />
        </div>
      ) : (
        <>
          {/* Rollup metrics */}
          {rollup && (
            <div className="grid grid-cols-2 md:grid-cols-4 gap-2">
              <div className="rounded border border-zinc-800 bg-zinc-900/60 px-2.5 py-2">
                <div className="text-[10px] uppercase tracking-wider text-zinc-500">Fleet Readiness</div>
                <div className={`text-xl font-bold ${ROLLUP_COLOR[rollup.rollupStatus]}`}>
                  {rollup.fleetReadiness}%
                </div>
              </div>
              <div className="rounded border border-zinc-800 bg-zinc-900/60 px-2.5 py-2">
                <div className="text-[10px] uppercase tracking-wider text-zinc-500">Availability</div>
                <div className="text-xl font-bold text-cyan-400">{rollup.availabilityPct}%</div>
              </div>
              <div className="rounded border border-zinc-800 bg-zinc-900/60 px-2.5 py-2">
                <div className="text-[10px] uppercase tracking-wider text-zinc-500">In Service</div>
                <div className="text-xl font-bold text-white">
                  {rollup.inService}/{rollup.total}
                </div>
              </div>
              <div className="rounded border border-zinc-800 bg-zinc-900/60 px-2.5 py-2">
                <div className="text-[10px] uppercase tracking-wider text-zinc-500">Mean Readiness</div>
                <div className="text-xl font-bold text-white">{rollup.meanReadiness}%</div>
              </div>
            </div>
          )}

          {rollup && rollup.total > 0 && (
            <ChartKit
              kind="bar"
              data={statusChart}
              xKey="status"
              series={[{ key: 'count', label: 'Assets by status' }]}
              height={140}
            />
          )}

          {/* At-risk assets (from rollup) */}
          {rollup && rollup.lowReadiness.length > 0 && (
            <div className="rounded-md border border-red-500/30 bg-red-500/5 p-2.5">
              <div className="text-[10px] uppercase tracking-wider text-red-300 font-semibold mb-1">
                Low readiness — {rollup.lowReadiness.length} asset(s) below 60%
              </div>
              {rollup.lowReadiness.map((a) => (
                <div key={a.id} className="flex items-center justify-between text-[11px] mt-0.5">
                  <span className="text-zinc-200">{a.designation}</span>
                  <span className="text-red-400 font-mono">
                    {a.readiness}% · {a.status}
                  </span>
                </div>
              ))}
            </div>
          )}

          {/* Per-asset list (local mirror, populated on upsert) */}
          {assets.length > 0 && (
            <div className="space-y-1 max-h-56 overflow-y-auto">
              {assets.map((a) => (
                <div
                  key={a.id}
                  className="flex items-center justify-between rounded border border-zinc-800 bg-zinc-900/60 px-2.5 py-1.5"
                >
                  <div className="flex items-center gap-2 min-w-0 flex-1">
                    <span className="text-xs text-white truncate">{a.designation}</span>
                    <span className="text-[10px] text-zinc-600 shrink-0">{a.type}</span>
                    <span className={`text-[10px] shrink-0 ${STATUS_COLOR[a.status]}`}>{a.status}</span>
                    {a.assignedUnit && (
                      <span className="text-[10px] text-zinc-500 shrink-0">{a.assignedUnit}</span>
                    )}
                    <div className="flex items-center gap-1.5 shrink-0 ml-1">
                      <div className="h-1.5 w-16 rounded-full bg-zinc-800 overflow-hidden">
                        <div
                          className={`h-full ${readinessBar(a.readiness)}`}
                          style={{ width: `${a.readiness}%` }}
                        />
                      </div>
                      <span className="text-[10px] text-zinc-400 font-mono">{a.readiness}%</span>
                    </div>
                  </div>
                  <div className="flex items-center gap-0.5">
                    <button
                      onClick={() =>
                        setForm({
                          id: a.id,
                          designation: a.designation,
                          type: a.type,
                          status: a.status,
                          readiness: String(a.readiness),
                          assignedUnit: a.assignedUnit,
                        })
                      }
                      aria-label="Edit asset"
                      className="p-1 text-zinc-500 hover:text-cyan-400"
                    >
                      <Edit2 className="w-3.5 h-3.5" />
                    </button>
                    <button
                      onClick={() => remove(a.id)}
                      disabled={busy}
                      aria-label="Delete asset"
                      className="p-1 text-zinc-500 hover:text-red-400 disabled:opacity-50"
                    >
                      <Trash2 className="w-3.5 h-3.5" />
                    </button>
                  </div>
                </div>
              ))}
            </div>
          )}
        </>
      )}

      {/* Asset editor */}
      {form ? (
        <div className="rounded-md border border-cyan-500/30 bg-cyan-500/5 p-3 space-y-2">
          <div className="flex items-center justify-between">
            <span className="text-xs font-semibold text-white">
              {form.id ? 'Edit Asset' : 'New Asset'}
            </span>
            <button onClick={() => setForm(null)} aria-label="Close editor" className="text-zinc-500 hover:text-white">
              <X className="w-3.5 h-3.5" />
            </button>
          </div>
          <div className="grid grid-cols-2 md:grid-cols-3 gap-2">
            <input
              value={form.designation}
              onChange={(e) => setForm({ ...form, designation: e.target.value })}
              placeholder="Designation"
              className="col-span-2 bg-zinc-900 border border-zinc-800 rounded px-2 py-1.5 text-xs text-white"
            />
            <select
              value={form.type}
              onChange={(e) => setForm({ ...form, type: e.target.value })}
              className="bg-zinc-900 border border-zinc-800 rounded px-2 py-1.5 text-xs text-white"
            >
              {ASSET_TYPES.map((t) => (
                <option key={t} value={t}>
                  {t}
                </option>
              ))}
            </select>
            <select
              value={form.status}
              onChange={(e) => setForm({ ...form, status: e.target.value })}
              className="bg-zinc-900 border border-zinc-800 rounded px-2 py-1.5 text-xs text-white"
            >
              {ASSET_STATUSES.map((s) => (
                <option key={s} value={s}>
                  {s}
                </option>
              ))}
            </select>
            <input
              value={form.readiness}
              onChange={(e) => setForm({ ...form, readiness: e.target.value })}
              placeholder="Readiness %"
              className="bg-zinc-900 border border-zinc-800 rounded px-2 py-1.5 text-xs text-white font-mono"
            />
            <input
              value={form.assignedUnit}
              onChange={(e) => setForm({ ...form, assignedUnit: e.target.value })}
              placeholder="Assigned unit"
              className="bg-zinc-900 border border-zinc-800 rounded px-2 py-1.5 text-xs text-white"
            />
          </div>
          <button
            onClick={save}
            disabled={busy}
            className="inline-flex items-center gap-1.5 rounded-md bg-cyan-600 hover:bg-cyan-500 px-3 py-1.5 text-xs font-medium text-white disabled:opacity-50"
          >
            {busy ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Plus className="w-3.5 h-3.5" />}
            Save Asset
          </button>
        </div>
      ) : (
        <button
          onClick={() => setForm({ ...EMPTY_FORM })}
          className="inline-flex items-center gap-1.5 rounded-md border border-zinc-700 hover:border-cyan-500/50 px-3 py-1.5 text-xs font-medium text-zinc-300"
        >
          <Plus className="w-3.5 h-3.5" />
          Add Asset
        </button>
      )}
    </section>
  );
}
