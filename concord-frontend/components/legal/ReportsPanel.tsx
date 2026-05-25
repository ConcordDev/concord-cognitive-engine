'use client';

/**
 * ReportsPanel — Clio-parity matter budgeting + realization reporting.
 *
 * Firm-wide realization/collection rollup across all matters, plus a
 * per-matter budget editor and a worked → billed → collected report.
 * All numbers are computed server-side from real time entries, invoices
 * and payments — no seeds.
 */

import { useEffect, useState, useCallback } from 'react';
import {
  BarChart3, Loader2, Target, TrendingUp, AlertTriangle, Save,
} from 'lucide-react';
import { lensRun } from '@/lib/api/client';
import { cn } from '@/lib/utils';

interface Matter { id: string; name: string; number: string; status: string }

interface RollupRow {
  matterId: string;
  matterName: string;
  status: string;
  worked: number;
  billed: number;
  collected: number;
  realizationRate: number | null;
  collectionRate: number | null;
  budgetAmount: number | null;
  overBudget: boolean;
}
interface RollupTotals {
  worked: number;
  billed: number;
  collected: number;
  firmRealizationRate: number | null;
  firmCollectionRate: number | null;
  mattersOverBudget: number;
}

interface Budget {
  matterId: string;
  matterName: string;
  budgetAmount: number;
  budgetHours: number;
  alertThreshold: number;
  note: string;
}
interface BudgetStatus {
  consumedFraction: number;
  remaining: number;
  overBudget: boolean;
  alert: boolean;
  hoursConsumedFraction: number | null;
}
interface BudgetReport {
  matterId: string;
  matterName: string;
  budget: Budget | null;
  budgetStatus: BudgetStatus | null;
  workedValue: number;
  workedHours: number;
  billableHours: number;
  billedValue: number;
  collectedValue: number;
  realizationRate: number | null;
  collectionRate: number | null;
  overallRate: number | null;
  utilizationRate: number | null;
  unbilledValue: number;
  uncollectedValue: number;
}

function money(v: number | null | undefined): string {
  if (v == null) return '—';
  return new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD', maximumFractionDigits: 0 }).format(v);
}
function pct(v: number | null | undefined): string {
  if (v == null) return '—';
  return `${Math.round(v * 100)}%`;
}

export function ReportsPanel() {
  const [matters, setMatters] = useState<Matter[]>([]);
  const [rollup, setRollup] = useState<RollupRow[]>([]);
  const [totals, setTotals] = useState<RollupTotals | null>(null);
  const [loading, setLoading] = useState(true);

  const [selectedId, setSelectedId] = useState<string>('');
  const [report, setReport] = useState<BudgetReport | null>(null);
  const [reportLoading, setReportLoading] = useState(false);

  // Budget editor draft
  const [budgetAmount, setBudgetAmount] = useState('');
  const [budgetHours, setBudgetHours] = useState('');
  const [alertThreshold, setAlertThreshold] = useState('80');
  const [budgetNote, setBudgetNote] = useState('');
  const [savingBudget, setSavingBudget] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const refresh = useCallback(async () => {
    setLoading(true);
    try {
      const [m, r] = await Promise.all([
        lensRun({ domain: 'legal', action: 'matters-list', input: {} }),
        lensRun({ domain: 'legal', action: 'realization-rollup', input: {} }),
      ]);
      setMatters((m.data?.result?.matters || []) as Matter[]);
      setRollup((r.data?.result?.matters || []) as RollupRow[]);
      setTotals((r.data?.result?.totals || null) as RollupTotals | null);
    } catch (e) {
      console.error('[Reports] refresh failed', e);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { refresh(); }, [refresh]);

  const loadReport = useCallback(async (matterId: string) => {
    if (!matterId) { setReport(null); return; }
    setReportLoading(true);
    setError(null);
    try {
      const r = await lensRun({ domain: 'legal', action: 'budget-report', input: { matterId } });
      const rep = (r.data?.result || null) as BudgetReport | null;
      setReport(rep);
      if (rep?.budget) {
        setBudgetAmount(String(rep.budget.budgetAmount || ''));
        setBudgetHours(String(rep.budget.budgetHours || ''));
        setAlertThreshold(String(Math.round((rep.budget.alertThreshold || 0.8) * 100)));
        setBudgetNote(rep.budget.note || '');
      } else {
        setBudgetAmount(''); setBudgetHours(''); setAlertThreshold('80'); setBudgetNote('');
      }
    } catch (e) {
      console.error('[Reports] budget-report failed', e);
    } finally {
      setReportLoading(false);
    }
  }, []);

  function selectMatter(id: string) {
    setSelectedId(id);
    loadReport(id);
  }

  async function saveBudget() {
    if (!selectedId) return;
    const amt = parseFloat(budgetAmount);
    if (!Number.isFinite(amt) || amt < 0) { setError('Budget amount must be a non-negative number.'); return; }
    setSavingBudget(true);
    setError(null);
    try {
      const r = await lensRun({
        domain: 'legal', action: 'budget-set',
        input: {
          matterId: selectedId,
          budgetAmount: amt,
          budgetHours: parseFloat(budgetHours) || 0,
          alertThreshold: (parseFloat(alertThreshold) || 80) / 100,
          note: budgetNote.trim(),
        },
      });
      if (r.data?.ok === false) { setError(r.data.error || 'Could not save budget.'); return; }
      await loadReport(selectedId);
      await refresh();
    } catch (e) {
      console.error('[Reports] budget-set failed', e);
      setError('Could not save budget.');
    } finally {
      setSavingBudget(false);
    }
  }

  return (
    <div className="space-y-3">
      {error && (
        <div className="flex items-center gap-2 px-3 py-2 text-xs rounded bg-rose-500/10 border border-rose-500/30 text-rose-200">
          <AlertTriangle className="w-3.5 h-3.5" /> {error}
        </div>
      )}

      {/* Firm-wide rollup */}
      <div className="bg-[#0d1117] border border-amber-500/15 rounded-lg overflow-hidden">
        <header className="px-4 py-2.5 border-b border-white/10 flex items-center gap-2">
          <TrendingUp className="w-4 h-4 text-amber-400" />
          <span className="text-sm font-semibold text-gray-200">Firm Realization Rollup</span>
        </header>
        {loading ? (
          <div className="flex items-center justify-center py-10 text-xs text-gray-400">
            <Loader2 className="w-4 h-4 animate-spin mr-2" /> Loading…
          </div>
        ) : (
          <>
            <div className="grid grid-cols-5 gap-px bg-white/5">
              {[
                { label: 'Worked', value: money(totals?.worked) },
                { label: 'Billed', value: money(totals?.billed) },
                { label: 'Collected', value: money(totals?.collected) },
                { label: 'Realization', value: pct(totals?.firmRealizationRate) },
                { label: 'Collection', value: pct(totals?.firmCollectionRate) },
              ].map((kpi) => (
                <div key={kpi.label} className="bg-[#0d1117] px-3 py-2.5 text-center">
                  <div className="text-base font-bold text-white">{kpi.value}</div>
                  <div className="text-[9px] uppercase tracking-wider text-gray-400">{kpi.label}</div>
                </div>
              ))}
            </div>
            {totals && totals.mattersOverBudget > 0 && (
              <div className="px-4 py-1.5 text-[10px] text-rose-300 bg-rose-500/[0.06] border-t border-rose-500/15">
                {totals.mattersOverBudget} matter(s) over budget
              </div>
            )}
            <div className="max-h-64 overflow-y-auto">
              {rollup.length === 0 ? (
                <div className="px-3 py-8 text-center text-xs text-gray-400">
                  <BarChart3 className="w-6 h-6 mx-auto mb-2 opacity-30" />
                  No matters yet. Open a matter and log time to see realization data.
                </div>
              ) : (
                <table className="w-full text-xs">
                  <thead>
                    <tr className="text-left text-gray-400 border-b border-white/5">
                      <th className="px-3 py-1.5 font-medium">Matter</th>
                      <th className="px-3 py-1.5 font-medium text-right">Worked</th>
                      <th className="px-3 py-1.5 font-medium text-right">Billed</th>
                      <th className="px-3 py-1.5 font-medium text-right">Collected</th>
                      <th className="px-3 py-1.5 font-medium text-right">Real.</th>
                      <th className="px-3 py-1.5 font-medium text-right">Coll.</th>
                    </tr>
                  </thead>
                  <tbody>
                    {rollup.map((row) => (
                      <tr
                        key={row.matterId}
                        onClick={() => selectMatter(row.matterId)}
                        className={cn(
                          'border-b border-white/5 cursor-pointer hover:bg-white/[0.03]',
                          selectedId === row.matterId && 'bg-amber-500/[0.06]',
                        )}
                      >
                        <td className="px-3 py-1.5 text-white truncate max-w-[10rem]">
                          {row.matterName}
                          {row.overBudget && <span className="ml-1 text-[9px] text-rose-300">over</span>}
                        </td>
                        <td className="px-3 py-1.5 text-right text-gray-300">{money(row.worked)}</td>
                        <td className="px-3 py-1.5 text-right text-gray-300">{money(row.billed)}</td>
                        <td className="px-3 py-1.5 text-right text-emerald-300">{money(row.collected)}</td>
                        <td className="px-3 py-1.5 text-right text-gray-400">{pct(row.realizationRate)}</td>
                        <td className="px-3 py-1.5 text-right text-gray-400">{pct(row.collectionRate)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              )}
            </div>
          </>
        )}
      </div>

      {/* Per-matter budget + realization */}
      <div className="bg-[#0d1117] border border-amber-500/15 rounded-lg overflow-hidden">
        <header className="px-4 py-2.5 border-b border-white/10 flex items-center gap-2">
          <Target className="w-4 h-4 text-amber-400" />
          <span className="text-sm font-semibold text-gray-200">Matter Budget &amp; Realization</span>
          <select
            value={selectedId}
            onChange={(e) => selectMatter(e.target.value)}
            className="ml-auto text-xs px-2 py-1 bg-lattice-deep border border-lattice-border rounded text-white max-w-[14rem]"
          >
            <option value="">— select a matter —</option>
            {matters.map((m) => <option key={m.id} value={m.id}>{m.name}</option>)}
          </select>
        </header>

        {!selectedId ? (
          <div className="px-3 py-8 text-center text-xs text-gray-400">
            Select a matter to set a budget and view its realization report.
          </div>
        ) : reportLoading ? (
          <div className="flex items-center justify-center py-10 text-xs text-gray-400">
            <Loader2 className="w-4 h-4 animate-spin mr-2" /> Loading report…
          </div>
        ) : report ? (
          <div className="p-4 space-y-3">
            {/* Budget editor */}
            <div className="grid grid-cols-12 gap-2 items-end">
              <div className="col-span-3">
                <label className="text-[9px] uppercase tracking-wider text-gray-400 font-semibold">Budget ($)</label>
                <input
                  type="number" value={budgetAmount} onChange={(e) => setBudgetAmount(e.target.value)}
                  placeholder="0"
                  className="w-full px-2 py-1.5 text-xs bg-lattice-deep border border-lattice-border rounded text-white"
                />
              </div>
              <div className="col-span-3">
                <label className="text-[9px] uppercase tracking-wider text-gray-400 font-semibold">Budget (hrs)</label>
                <input
                  type="number" value={budgetHours} onChange={(e) => setBudgetHours(e.target.value)}
                  placeholder="0"
                  className="w-full px-2 py-1.5 text-xs bg-lattice-deep border border-lattice-border rounded text-white"
                />
              </div>
              <div className="col-span-2">
                <label className="text-[9px] uppercase tracking-wider text-gray-400 font-semibold">Alert at (%)</label>
                <input
                  type="number" value={alertThreshold} onChange={(e) => setAlertThreshold(e.target.value)}
                  placeholder="80"
                  className="w-full px-2 py-1.5 text-xs bg-lattice-deep border border-lattice-border rounded text-white"
                />
              </div>
              <div className="col-span-4">
                <label className="text-[9px] uppercase tracking-wider text-gray-400 font-semibold">Note</label>
                <input
                  value={budgetNote} onChange={(e) => setBudgetNote(e.target.value)}
                  placeholder="Optional"
                  className="w-full px-2 py-1.5 text-xs bg-lattice-deep border border-lattice-border rounded text-white"
                />
              </div>
              <button
                onClick={saveBudget} disabled={savingBudget}
                className="col-span-12 px-3 py-1.5 text-xs rounded bg-amber-500 text-black font-bold hover:bg-amber-400 disabled:opacity-50 inline-flex items-center justify-center gap-1"
              >
                <Save className="w-3.5 h-3.5" />{savingBudget ? 'Saving…' : report.budget ? 'Update budget' : 'Set budget'}
              </button>
            </div>

            {/* Budget consumption */}
            {report.budgetStatus && report.budget && (
              <div className={cn(
                'rounded border p-2.5',
                report.budgetStatus.overBudget ? 'border-rose-500/30 bg-rose-500/[0.06]'
                  : report.budgetStatus.alert ? 'border-amber-500/30 bg-amber-500/[0.06]'
                  : 'border-emerald-500/20 bg-emerald-500/[0.04]',
              )}>
                <div className="flex items-center justify-between text-xs mb-1.5">
                  <span className="text-gray-300">
                    {money(report.workedValue)} of {money(report.budget.budgetAmount)} consumed
                  </span>
                  <span className={cn(
                    'font-semibold',
                    report.budgetStatus.overBudget ? 'text-rose-300'
                      : report.budgetStatus.alert ? 'text-amber-300' : 'text-emerald-300',
                  )}>
                    {pct(report.budgetStatus.consumedFraction)}
                    {report.budgetStatus.overBudget && ' — over budget'}
                  </span>
                </div>
                <div className="h-1.5 rounded-full bg-white/10 overflow-hidden">
                  <div
                    className={cn(
                      'h-full rounded-full',
                      report.budgetStatus.overBudget ? 'bg-rose-400'
                        : report.budgetStatus.alert ? 'bg-amber-400' : 'bg-emerald-400',
                    )}
                    style={{ width: `${Math.min(100, Math.round(report.budgetStatus.consumedFraction * 100))}%` }}
                  />
                </div>
                <div className="text-[10px] text-gray-400 mt-1">
                  {report.budgetStatus.remaining >= 0
                    ? `${money(report.budgetStatus.remaining)} remaining`
                    : `${money(-report.budgetStatus.remaining)} over`}
                </div>
              </div>
            )}

            {/* Realization breakdown */}
            <div className="grid grid-cols-4 gap-px bg-white/5 rounded overflow-hidden">
              {[
                { label: 'Worked value', value: money(report.workedValue) },
                { label: 'Billed value', value: money(report.billedValue) },
                { label: 'Collected', value: money(report.collectedValue) },
                { label: 'Unbilled', value: money(report.unbilledValue) },
                { label: 'Realization', value: pct(report.realizationRate) },
                { label: 'Collection', value: pct(report.collectionRate) },
                { label: 'Overall', value: pct(report.overallRate) },
                { label: 'Utilization', value: pct(report.utilizationRate) },
              ].map((kpi) => (
                <div key={kpi.label} className="bg-[#0d1117] px-2 py-2 text-center">
                  <div className="text-sm font-bold text-white">{kpi.value}</div>
                  <div className="text-[9px] uppercase tracking-wider text-gray-400">{kpi.label}</div>
                </div>
              ))}
            </div>
            <p className="text-[10px] text-gray-400">
              Realization = billed ÷ worked. Collection = collected ÷ billed. Utilization = billable hours ÷ total hours.
            </p>
          </div>
        ) : (
          <div className="px-3 py-8 text-center text-xs text-gray-400">No report available.</div>
        )}
      </div>
    </div>
  );
}

export default ReportsPanel;
