'use client';

// Side-by-side seed / hybrid trial comparison. Logs replicated trial entries
// and ranks hybrids by measured yield, moisture and economics. All entries
// are real user-entered trial observations.

import { useCallback, useEffect, useState } from 'react';
import { FlaskConical, Loader2, Plus, Trash2, Trophy } from 'lucide-react';
import { lensRun } from '@/lib/api/client';
import { cn } from '@/lib/utils';
import { ChartKit } from '@/components/viz/ChartKit';

interface TrialEntry {
  id: string;
  trialName: string;
  hybrid: string;
  brand: string;
  yieldPerAcre: number;
  moisturePct: number | null;
  testWeightLbs: number | null;
  maturityDays: number | null;
  seedCostPerAcre: number | null;
  replicate: string;
}
interface RankedHybrid {
  hybrid: string;
  brand: string;
  replicates: number;
  avgYieldPerAcre: number;
  avgMoisturePct: number | null;
  avgSeedCostPerAcre: number | null;
  grossPerAcre: number | null;
  netPerAcre: number | null;
  vsTrialAvgPct: number;
}
interface CompareResult {
  trialName: string;
  hybridCount: number;
  entryCount: number;
  trialAvgYield: number;
  ranked: RankedHybrid[];
  winner: { hybrid: string; avgYieldPerAcre: number; netPerAcre: number | null } | null;
  summary: string;
}

export function SeedTrialPanel() {
  const [trialName, setTrialName] = useState('');
  const [entries, setEntries] = useState<TrialEntry[]>([]);
  const [trials, setTrials] = useState<string[]>([]);
  const [loading, setLoading] = useState(true);
  const [commodityPrice, setCommodityPrice] = useState('');
  const [compare, setCompare] = useState<CompareResult | null>(null);
  const [comparing, setComparing] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [form, setForm] = useState({
    hybrid: '',
    brand: '',
    yieldPerAcre: '',
    moisturePct: '',
    seedCostPerAcre: '',
    replicate: '1',
  });

  const refresh = useCallback(async () => {
    setLoading(true);
    try {
      const r = await lensRun('agriculture', 'trial-entries-list', {});
      if (r.data?.ok) {
        const all = ((r.data.result as { entries?: TrialEntry[] } | null)?.entries ||
          []) as TrialEntry[];
        setTrials([...new Set(all.map((e) => e.trialName))].sort());
        setEntries(trialName ? all.filter((e) => e.trialName === trialName) : all);
      }
    } catch (e) {
      console.error('[SeedTrial] list failed', e);
    } finally {
      setLoading(false);
    }
  }, [trialName]);

  useEffect(() => {
    refresh();
    setCompare(null);
  }, [refresh]);

  async function addEntry() {
    setError(null);
    if (!trialName.trim() || !form.hybrid.trim() || form.yieldPerAcre === '') {
      setError('Trial name, hybrid and yield/ac are required.');
      return;
    }
    try {
      const r = await lensRun('agriculture', 'trial-entry-add', {
        trialName: trialName.trim(),
        hybrid: form.hybrid.trim(),
        brand: form.brand.trim(),
        yieldPerAcre: Number(form.yieldPerAcre),
        moisturePct: form.moisturePct === '' ? undefined : Number(form.moisturePct),
        seedCostPerAcre: form.seedCostPerAcre === '' ? undefined : Number(form.seedCostPerAcre),
        replicate: form.replicate || '1',
      });
      if (r.data?.ok) {
        setForm({
          hybrid: '',
          brand: '',
          yieldPerAcre: '',
          moisturePct: '',
          seedCostPerAcre: '',
          replicate: '1',
        });
        await refresh();
      } else {
        setError(r.data?.error || 'Could not add trial entry');
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    }
  }

  async function removeEntry(id: string) {
    try {
      await lensRun('agriculture', 'trial-entry-delete', { id });
      setEntries((prev) => prev.filter((e) => e.id !== id));
    } catch (e) {
      console.error('[SeedTrial] delete failed', e);
    }
  }

  async function runCompare() {
    setError(null);
    if (!trialName.trim()) {
      setError('Pick or name a trial first.');
      return;
    }
    setComparing(true);
    try {
      const params: Record<string, unknown> = { trialName: trialName.trim() };
      if (commodityPrice !== '' && Number(commodityPrice) > 0) {
        params.commodityPrice = Number(commodityPrice);
      }
      const r = await lensRun('agriculture', 'trial-compare', params);
      if (r.data?.ok) {
        setCompare(r.data.result as CompareResult);
      } else {
        setCompare(null);
        setError(r.data?.error || 'Comparison failed');
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setComparing(false);
    }
  }

  return (
    <div className="space-y-4">
      <div className="grid grid-cols-1 sm:grid-cols-[2fr_2fr] gap-2">
        <input
          value={trialName}
          onChange={(e) => setTrialName(e.target.value)}
          list="agri-trial-names"
          placeholder="Trial name (e.g. North 40 corn 2026)"
          className="px-2 py-1.5 text-xs bg-lattice-deep border border-lattice-border rounded text-white"
        />
        <datalist id="agri-trial-names">
          {trials.map((t) => (
            <option key={t} value={t} />
          ))}
        </datalist>
        <input
          type="number"
          value={commodityPrice}
          onChange={(e) => setCommodityPrice(e.target.value)}
          placeholder="Commodity price $/bu (optional, for economics)"
          className="px-2 py-1.5 text-xs bg-lattice-deep border border-lattice-border rounded text-white"
        />
      </div>

      {/* Entry editor */}
      <div className="rounded-lg border border-white/10 bg-white/[0.02] p-3 space-y-2">
        <div className="text-[11px] uppercase tracking-wider text-gray-400">
          Log a trial entry (replicated plots)
        </div>
        <div className="grid grid-cols-2 sm:grid-cols-3 gap-2">
          <input
            value={form.hybrid}
            onChange={(e) => setForm({ ...form, hybrid: e.target.value })}
            placeholder="Hybrid"
            className="px-2 py-1.5 text-xs bg-lattice-deep border border-lattice-border rounded text-white"
          />
          <input
            value={form.brand}
            onChange={(e) => setForm({ ...form, brand: e.target.value })}
            placeholder="Brand"
            className="px-2 py-1.5 text-xs bg-lattice-deep border border-lattice-border rounded text-white"
          />
          <input
            value={form.replicate}
            onChange={(e) => setForm({ ...form, replicate: e.target.value })}
            placeholder="Replicate"
            className="px-2 py-1.5 text-xs bg-lattice-deep border border-lattice-border rounded text-white"
          />
          <input
            type="number"
            value={form.yieldPerAcre}
            onChange={(e) => setForm({ ...form, yieldPerAcre: e.target.value })}
            placeholder="Yield bu/ac"
            className="px-2 py-1.5 text-xs bg-lattice-deep border border-lattice-border rounded text-white"
          />
          <input
            type="number"
            value={form.moisturePct}
            onChange={(e) => setForm({ ...form, moisturePct: e.target.value })}
            placeholder="Moisture %"
            className="px-2 py-1.5 text-xs bg-lattice-deep border border-lattice-border rounded text-white"
          />
          <input
            type="number"
            value={form.seedCostPerAcre}
            onChange={(e) => setForm({ ...form, seedCostPerAcre: e.target.value })}
            placeholder="Seed cost $/ac"
            className="px-2 py-1.5 text-xs bg-lattice-deep border border-lattice-border rounded text-white"
          />
        </div>
        <button
          onClick={addEntry}
          className="px-3 py-1.5 text-xs rounded bg-emerald-500 text-black font-bold hover:bg-emerald-400 inline-flex items-center gap-1"
        >
          <Plus className="w-3 h-3" />
          Add entry
        </button>
      </div>

      {error && (
        <div className="text-xs text-rose-300 bg-rose-500/10 border border-rose-500/20 rounded px-3 py-2">
          {error}
        </div>
      )}

      {/* Entry list */}
      {loading ? (
        <div className="text-xs text-gray-400 py-2">Loading…</div>
      ) : entries.length === 0 ? (
        <div className="text-xs text-gray-400 py-2">
          {trialName ? 'No entries for this trial yet.' : 'No trial entries logged yet.'}
        </div>
      ) : (
        <ul className="divide-y divide-white/5">
          {entries.map((e) => (
            <li key={e.id} className="py-1.5 flex items-center gap-2 text-xs">
              <span className="text-gray-200 font-medium">{e.hybrid}</span>
              {e.brand && <span className="text-gray-400">{e.brand}</span>}
              <span className="text-gray-600">rep {e.replicate}</span>
              <span className="ml-auto text-emerald-300 font-mono">{e.yieldPerAcre} bu/ac</span>
              {e.moisturePct != null && (
                <span className="text-sky-300 font-mono">{e.moisturePct}% H₂O</span>
              )}
              <button
                onClick={() => removeEntry(e.id)}
                className="p-1 text-rose-400 hover:text-rose-300"
                aria-label="Delete trial entry"
              >
                <Trash2 className="w-3 h-3" />
              </button>
            </li>
          ))}
        </ul>
      )}

      <button
        onClick={runCompare}
        disabled={comparing}
        className="px-3 py-1.5 text-xs rounded bg-amber-500 text-black font-bold hover:bg-amber-400 disabled:opacity-40 inline-flex items-center gap-1"
      >
        {comparing ? <Loader2 className="w-3 h-3 animate-spin" /> : <FlaskConical className="w-3 h-3" />}
        Compare hybrids
      </button>

      {compare && (
        <div className="rounded-lg border border-amber-500/20 bg-amber-500/[0.04] p-3 space-y-3">
          <div className="flex items-center gap-2 text-xs">
            <Trophy className="w-4 h-4 text-amber-300" />
            <span className="text-amber-200">{compare.summary}</span>
          </div>
          <ChartKit
            kind="bar"
            data={compare.ranked.map((r) => ({
              hybrid: r.hybrid,
              yield: r.avgYieldPerAcre,
            }))}
            xKey="hybrid"
            series={[{ key: 'yield', label: 'Avg yield bu/ac', color: '#f59e0b' }]}
            height={180}
            showLegend={false}
          />
          <div className="overflow-x-auto">
            <table className="w-full text-[11px]">
              <thead className="text-gray-400">
                <tr>
                  <th className="text-left px-2 py-1 font-normal">Hybrid</th>
                  <th className="px-2 py-1 font-normal">Reps</th>
                  <th className="px-2 py-1 font-normal">Yield</th>
                  <th className="px-2 py-1 font-normal">vs avg</th>
                  <th className="px-2 py-1 font-normal">Moisture</th>
                  <th className="px-2 py-1 font-normal">Net/ac</th>
                </tr>
              </thead>
              <tbody>
                {compare.ranked.map((r, i) => (
                  <tr key={r.hybrid} className="border-t border-white/5">
                    <td className="px-2 py-1 text-gray-200">
                      {i === 0 && '🏆 '}
                      {r.hybrid}
                      {r.brand && <span className="text-gray-400"> · {r.brand}</span>}
                    </td>
                    <td className="px-2 py-1 text-center text-gray-400">{r.replicates}</td>
                    <td className="px-2 py-1 text-center text-emerald-300 font-mono">
                      {r.avgYieldPerAcre}
                    </td>
                    <td
                      className={cn(
                        'px-2 py-1 text-center font-mono',
                        r.vsTrialAvgPct >= 0 ? 'text-emerald-300' : 'text-rose-300',
                      )}
                    >
                      {r.vsTrialAvgPct >= 0 ? '+' : ''}
                      {r.vsTrialAvgPct}%
                    </td>
                    <td className="px-2 py-1 text-center text-gray-400">
                      {r.avgMoisturePct != null ? `${r.avgMoisturePct}%` : '—'}
                    </td>
                    <td className="px-2 py-1 text-center text-gray-300 font-mono">
                      {r.netPerAcre != null ? `$${r.netPerAcre}` : '—'}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}
    </div>
  );
}

export default SeedTrialPanel;
