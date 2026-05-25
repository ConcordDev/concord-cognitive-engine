'use client';

// Per-field profit / cost analysis. Tracks real input-cost line items and a
// commodity price, then computes gross revenue, net profit, breakeven price
// and margin against logged harvest passes.

import { useCallback, useEffect, useMemo, useState } from 'react';
import { DollarSign, Loader2, Plus, Trash2, Calculator } from 'lucide-react';
import { lensRun } from '@/lib/api/client';
import { cn } from '@/lib/utils';
import { ChartKit } from '@/components/viz/ChartKit';
import type { AgField } from './PrecisionAgPanel';

interface CostEntry {
  id: string;
  fieldId: string;
  label: string;
  amount: number;
  category: string;
  season: string;
  perAcre: boolean;
}
interface ProfitResult {
  fieldName: string;
  acreage: number;
  yieldPerAcre: number;
  totalBushels: number;
  commodityPrice: number;
  grossRevenue: number;
  totalCost: number;
  costPerAcre: number;
  costBreakdown: Record<string, number>;
  netProfit: number;
  profitPerAcre: number;
  breakevenPrice: number | null;
  breakevenYieldPerAcre: number | null;
  marginPct: number | null;
  status: string;
}

const CATEGORIES = [
  'seed',
  'fertilizer',
  'chemical',
  'fuel',
  'labor',
  'machinery',
  'land',
  'insurance',
  'drying',
  'other',
];

export function ProfitAnalysisPanel({
  fields,
  fieldsLoading,
}: {
  fields: AgField[];
  fieldsLoading: boolean;
}) {
  const [fieldId, setFieldId] = useState('');
  const [entries, setEntries] = useState<CostEntry[]>([]);
  const [loading, setLoading] = useState(false);
  const [form, setForm] = useState({
    label: '',
    amount: '',
    category: 'seed',
    perAcre: false,
  });
  const [commodityPrice, setCommodityPrice] = useState('');
  const [totalBushels, setTotalBushels] = useState('');
  const [analysis, setAnalysis] = useState<ProfitResult | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [analysing, setAnalysing] = useState(false);

  useEffect(() => {
    if (!fieldId && fields.length > 0) setFieldId(fields[0].id);
  }, [fields, fieldId]);

  const refresh = useCallback(async () => {
    if (!fieldId) {
      setEntries([]);
      return;
    }
    setLoading(true);
    try {
      const r = await lensRun('agriculture', 'cost-entries-list', { fieldId });
      if (r.data?.ok) {
        setEntries(
          ((r.data.result as { entries?: CostEntry[] } | null)?.entries || []) as CostEntry[],
        );
      }
    } catch (e) {
      console.error('[Profit] cost-entries-list failed', e);
    } finally {
      setLoading(false);
    }
  }, [fieldId]);

  useEffect(() => {
    refresh();
    setAnalysis(null);
  }, [refresh]);

  async function addEntry() {
    if (!fieldId || !form.label.trim() || form.amount === '') return;
    try {
      const r = await lensRun('agriculture', 'cost-entry-add', {
        fieldId,
        label: form.label.trim(),
        amount: Number(form.amount),
        category: form.category,
        perAcre: form.perAcre,
      });
      if (r.data?.ok) {
        setForm({ label: '', amount: '', category: 'seed', perAcre: false });
        await refresh();
      } else {
        setError(r.data?.error || 'Could not add cost entry');
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    }
  }

  async function removeEntry(id: string) {
    try {
      await lensRun('agriculture', 'cost-entry-delete', { id });
      setEntries((prev) => prev.filter((e) => e.id !== id));
    } catch (e) {
      console.error('[Profit] delete failed', e);
    }
  }

  async function runAnalysis() {
    setError(null);
    if (!fieldId) return;
    if (commodityPrice === '' || Number(commodityPrice) <= 0) {
      setError('Enter a commodity price ($/bu) above zero.');
      return;
    }
    setAnalysing(true);
    try {
      const params: Record<string, unknown> = {
        fieldId,
        commodityPrice: Number(commodityPrice),
      };
      if (totalBushels !== '' && Number(totalBushels) > 0) {
        params.totalBushels = Number(totalBushels);
      }
      const r = await lensRun('agriculture', 'profit-analysis', params);
      if (r.data?.ok) {
        setAnalysis(r.data.result as ProfitResult);
      } else {
        setAnalysis(null);
        setError(r.data?.error || 'Profit analysis failed');
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setAnalysing(false);
    }
  }

  const breakdownChart = useMemo(() => {
    if (!analysis) return [];
    return Object.entries(analysis.costBreakdown).map(([category, amount]) => ({
      category,
      amount,
    }));
  }, [analysis]);

  if (fieldsLoading) {
    return (
      <div className="flex items-center justify-center py-10 text-xs text-gray-400">
        <Loader2 className="w-4 h-4 animate-spin mr-2" /> Loading fields…
      </div>
    );
  }
  if (fields.length === 0) {
    return (
      <div className="py-10 text-center text-xs text-gray-400">
        <DollarSign className="w-6 h-6 mx-auto mb-2 opacity-30" />
        No fields yet. Add a field to track its input costs and profitability.
      </div>
    );
  }

  return (
    <div className="space-y-4">
      <select
        value={fieldId}
        onChange={(e) => setFieldId(e.target.value)}
        className="px-2 py-1.5 text-xs bg-lattice-deep border border-lattice-border rounded text-white w-full sm:w-64"
      >
        {fields.map((f) => (
          <option key={f.id} value={f.id}>
            {f.name} ({f.acreage} ac)
          </option>
        ))}
      </select>

      {/* Cost entry editor */}
      <div className="rounded-lg border border-white/10 bg-white/[0.02] p-3 space-y-2">
        <div className="text-[11px] uppercase tracking-wider text-gray-400">Input costs</div>
        <div className="grid grid-cols-1 sm:grid-cols-[2fr_1fr_1fr_auto_auto] gap-2">
          <input
            value={form.label}
            onChange={(e) => setForm({ ...form, label: e.target.value })}
            placeholder="Line item (e.g. seed corn)"
            className="px-2 py-1.5 text-xs bg-lattice-deep border border-lattice-border rounded text-white"
          />
          <input
            type="number"
            value={form.amount}
            onChange={(e) => setForm({ ...form, amount: e.target.value })}
            placeholder="Amount $"
            className="px-2 py-1.5 text-xs bg-lattice-deep border border-lattice-border rounded text-white"
          />
          <select
            value={form.category}
            onChange={(e) => setForm({ ...form, category: e.target.value })}
            className="px-2 py-1.5 text-xs bg-lattice-deep border border-lattice-border rounded text-white"
          >
            {CATEGORIES.map((c) => (
              <option key={c} value={c}>
                {c}
              </option>
            ))}
          </select>
          <label className="inline-flex items-center gap-1 text-[11px] text-gray-400">
            <input
              type="checkbox"
              checked={form.perAcre}
              onChange={(e) => setForm({ ...form, perAcre: e.target.checked })}
            />
            $/ac
          </label>
          <button
            onClick={addEntry}
            className="px-3 py-1.5 text-xs rounded bg-emerald-500 text-black font-bold hover:bg-emerald-400 inline-flex items-center gap-1"
          >
            <Plus className="w-3 h-3" />
            Add
          </button>
        </div>
        {loading ? (
          <div className="text-xs text-gray-400 py-2">Loading…</div>
        ) : entries.length === 0 ? (
          <div className="text-xs text-gray-400 py-2">No cost entries for this field yet.</div>
        ) : (
          <ul className="divide-y divide-white/5">
            {entries.map((e) => (
              <li key={e.id} className="py-1.5 flex items-center gap-2 text-xs">
                <span className="text-gray-200 flex-1">{e.label}</span>
                <span className="text-gray-400 uppercase text-[10px]">{e.category}</span>
                <span className="text-emerald-300 font-mono">
                  ${e.amount.toLocaleString()}
                  {e.perAcre ? '/ac' : ''}
                </span>
                <button
                  onClick={() => removeEntry(e.id)}
                  className="p-1 text-rose-400 hover:text-rose-300"
                  aria-label="Delete cost entry"
                >
                  <Trash2 className="w-3 h-3" />
                </button>
              </li>
            ))}
          </ul>
        )}
      </div>

      {/* Analysis inputs */}
      <div className="grid grid-cols-1 sm:grid-cols-[1fr_1fr_auto] gap-2">
        <input
          type="number"
          value={commodityPrice}
          onChange={(e) => setCommodityPrice(e.target.value)}
          placeholder="Commodity price $/bu"
          className="px-2 py-1.5 text-xs bg-lattice-deep border border-lattice-border rounded text-white"
        />
        <input
          type="number"
          value={totalBushels}
          onChange={(e) => setTotalBushels(e.target.value)}
          placeholder="Total bushels (blank = use harvest passes)"
          className="px-2 py-1.5 text-xs bg-lattice-deep border border-lattice-border rounded text-white"
        />
        <button
          onClick={runAnalysis}
          disabled={analysing}
          className="px-3 py-1.5 text-xs rounded bg-amber-500 text-black font-bold hover:bg-amber-400 disabled:opacity-40 inline-flex items-center justify-center gap-1"
        >
          {analysing ? (
            <Loader2 className="w-3 h-3 animate-spin" />
          ) : (
            <Calculator className="w-3 h-3" />
          )}
          Analyze
        </button>
      </div>

      {error && (
        <div className="text-xs text-rose-300 bg-rose-500/10 border border-rose-500/20 rounded px-3 py-2">
          {error}
        </div>
      )}

      {analysis && (
        <div className="rounded-lg border border-amber-500/20 bg-amber-500/[0.04] p-3 space-y-3">
          <div className="flex items-center gap-2">
            <span className="text-xs font-semibold text-amber-300">
              {analysis.fieldName} — {analysis.acreage} ac
            </span>
            <span
              className={cn(
                'text-[10px] uppercase tracking-wider px-1.5 py-0.5 rounded',
                analysis.status === 'profitable'
                  ? 'bg-emerald-500/15 text-emerald-300'
                  : analysis.status === 'loss'
                    ? 'bg-rose-500/15 text-rose-300'
                    : 'bg-gray-500/15 text-gray-300',
              )}
            >
              {analysis.status}
            </span>
          </div>
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-2">
            {[
              { k: 'Gross revenue', v: `$${analysis.grossRevenue.toLocaleString()}` },
              { k: 'Total cost', v: `$${analysis.totalCost.toLocaleString()}` },
              {
                k: 'Net profit',
                v: `$${analysis.netProfit.toLocaleString()}`,
                accent: analysis.netProfit >= 0 ? 'text-emerald-300' : 'text-rose-300',
              },
              {
                k: 'Profit / ac',
                v: `$${analysis.profitPerAcre.toLocaleString()}`,
                accent: analysis.profitPerAcre >= 0 ? 'text-emerald-300' : 'text-rose-300',
              },
              { k: 'Cost / ac', v: `$${analysis.costPerAcre.toLocaleString()}` },
              {
                k: 'Breakeven $/bu',
                v: analysis.breakevenPrice != null ? `$${analysis.breakevenPrice}` : '—',
              },
              {
                k: 'Breakeven yld/ac',
                v:
                  analysis.breakevenYieldPerAcre != null
                    ? `${analysis.breakevenYieldPerAcre} bu`
                    : '—',
              },
              {
                k: 'Margin',
                v: analysis.marginPct != null ? `${analysis.marginPct}%` : '—',
              },
            ].map((m) => (
              <div key={m.k} className="rounded bg-lattice-deep px-2 py-1.5 text-center">
                <div className={cn('text-sm font-bold', m.accent || 'text-amber-200')}>{m.v}</div>
                <div className="text-[10px] text-gray-400">{m.k}</div>
              </div>
            ))}
          </div>
          {breakdownChart.length > 0 && (
            <ChartKit
              kind="bar"
              data={breakdownChart}
              xKey="category"
              series={[{ key: 'amount', label: 'Cost ($)', color: '#f59e0b' }]}
              height={180}
              showLegend={false}
            />
          )}
        </div>
      )}
    </div>
  );
}

export default ProfitAnalysisPanel;
