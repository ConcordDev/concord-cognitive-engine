'use client';

/**
 * BillingCalculator — ad-hoc legal-billing calculator wired to the real
 * `law.billingCalculator` macro (hourly rates → totals, by-attorney
 * utilization, by-category, monthly breakdown).
 *
 * Honest scope: this is a CALCULATOR, not a time-tracking system — Concord
 * has no per-user billable-hours ledger in the `law` lens (that lives in
 * the separate `legal` practice-management lens's own domain). Entries you
 * add here live only in this browser tab for this session; nothing is
 * persisted. Every number shown is computed by the real macro from the
 * exact rows you entered — never fabricated.
 */

import { useState } from 'react';
import { Calculator, Loader2, Play, Plus, Trash2, Receipt } from 'lucide-react';
import { useMacroDispatchFeedback } from '@/hooks/useMacroDispatchFeedback';
import { DataTable, EmptyState, StatTile, StatTileGrid } from '@/components/ui';
import type { DataTableColumn } from '@/components/ui';
import { ds } from '@/lib/design-system';
import { cn } from '@/lib/utils';

interface TimeEntry {
  key: string;
  attorney: string;
  hours: string;
  rate: string;
  date: string;
  description: string;
  category: string;
  billable: boolean;
}

interface AttorneyRow { attorney: string; totalHours: number; billableHours: number; billableAmount: number; utilizationRate: number; effectiveRate: number }
interface CategoryRow { category: string; hours: number; amount: number; count: number }
interface MonthRow { month: string; hours: number; amount: number; count: number }
interface BillingResult {
  totals: {
    billableHours: number; nonBillableHours: number; totalHours: number;
    subtotal: number; discount: number; afterDiscount: number; tax: number; grandTotal: number; entryCount: number;
  };
  attorneyBreakdown: AttorneyRow[];
  categoryBreakdown: CategoryRow[];
  monthlyBreakdown: MonthRow[];
}

const fmtUsd = (v: number) => `$${v.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
let seq = 0;
const newKey = () => `te_${Date.now()}_${seq++}`;

const blankEntry = (): TimeEntry => ({
  key: newKey(), attorney: '', hours: '', rate: '', date: new Date().toISOString().slice(0, 10), description: '', category: 'general', billable: true,
});

export function BillingCalculator() {
  const [rows, setRows] = useState<TimeEntry[]>([blankEntry()]);
  const [taxRate, setTaxRate] = useState('0');
  const [discountPercent, setDiscountPercent] = useState('0');
  const { status, error, result, dispatch } = useMacroDispatchFeedback<BillingResult>();
  const busy = status === 'dispatched' || status === 'running';

  function updateRow(key: string, patch: Partial<TimeEntry>) {
    setRows((rs) => rs.map((r) => (r.key === key ? { ...r, ...patch } : r)));
  }
  function addRow() {
    setRows((rs) => [...rs, blankEntry()]);
  }
  function removeRow(key: string) {
    setRows((rs) => (rs.length <= 1 ? rs : rs.filter((r) => r.key !== key)));
  }

  async function calculate() {
    const timeEntries = rows
      .filter((r) => r.attorney.trim() && Number(r.hours) > 0)
      .map((r) => ({
        attorney: r.attorney.trim(), hours: Number(r.hours) || 0, rate: Number(r.rate) || 0,
        date: r.date, description: r.description.trim(), category: r.category.trim() || 'general', billable: r.billable,
      }));
    if (timeEntries.length === 0) return;
    await dispatch('law', 'billingCalculator', { timeEntries, taxRate: Number(taxRate) || 0, discountPercent: Number(discountPercent) || 0 });
  }

  const attorneyColumns: DataTableColumn<AttorneyRow>[] = [
    { id: 'attorney', header: 'Attorney', accessor: (r) => r.attorney, sortable: true, sortValue: (r) => r.attorney },
    { id: 'hours', header: 'Billable hrs', accessor: (r) => r.billableHours.toFixed(1), align: 'right', monospace: true, sortable: true, sortValue: (r) => r.billableHours },
    { id: 'utilization', header: 'Utilization', accessor: (r) => `${r.utilizationRate}%`, align: 'right', monospace: true },
    { id: 'rate', header: 'Eff. rate', accessor: (r) => fmtUsd(r.effectiveRate), align: 'right', monospace: true },
    { id: 'amount', header: 'Amount', accessor: (r) => fmtUsd(r.billableAmount), align: 'right', monospace: true, sortable: true, sortValue: (r) => r.billableAmount },
  ];
  const categoryColumns: DataTableColumn<CategoryRow>[] = [
    { id: 'category', header: 'Category', accessor: (r) => r.category },
    { id: 'hours', header: 'Hours', accessor: (r) => r.hours.toFixed(1), align: 'right', monospace: true },
    { id: 'amount', header: 'Amount', accessor: (r) => fmtUsd(r.amount), align: 'right', monospace: true, sortable: true, sortValue: (r) => r.amount },
  ];

  return (
    <div className={cn(ds.panel, 'space-y-3')}>
      <div className="flex items-center gap-2">
        <Calculator className="w-4 h-4 text-emerald-300" />
        <h2 className="font-semibold text-white">Billing Calculator</h2>
        <span className="text-[10px] text-gray-400">ad-hoc — entries live only in this session, not saved</span>
      </div>

      <div className="space-y-1.5">
        {rows.map((r) => (
          <div key={r.key} className="grid grid-cols-1 md:grid-cols-[1.2fr_0.7fr_0.7fr_0.9fr_1.3fr_0.9fr_auto] gap-1.5 items-center">
            <input value={r.attorney} onChange={(e) => updateRow(r.key, { attorney: e.target.value })} placeholder="Attorney" className={cn(ds.input, 'text-xs py-1')} />
            <input type="number" min="0" step="0.25" value={r.hours} onChange={(e) => updateRow(r.key, { hours: e.target.value })} placeholder="Hours" className={cn(ds.input, 'text-xs py-1')} />
            <input type="number" min="0" step="1" value={r.rate} onChange={(e) => updateRow(r.key, { rate: e.target.value })} placeholder="Rate/hr" className={cn(ds.input, 'text-xs py-1')} />
            <input type="date" value={r.date} onChange={(e) => updateRow(r.key, { date: e.target.value })} className={cn(ds.input, 'text-xs py-1')} />
            <input value={r.description} onChange={(e) => updateRow(r.key, { description: e.target.value })} placeholder="Description" className={cn(ds.input, 'text-xs py-1')} />
            <label className="flex items-center gap-1.5 text-[10px] text-gray-400">
              <input type="checkbox" checked={r.billable} onChange={(e) => updateRow(r.key, { billable: e.target.checked })} className="accent-emerald-400" />
              Billable
            </label>
            <button onClick={() => removeRow(r.key)} disabled={rows.length <= 1} aria-label="Remove entry" className="p-1 text-rose-400 hover:bg-rose-500/10 rounded disabled:opacity-30">
              <Trash2 className="w-3.5 h-3.5" />
            </button>
          </div>
        ))}
        <button onClick={addRow} className="text-[11px] text-emerald-300 hover:text-emerald-200 inline-flex items-center gap-1">
          <Plus className="w-3 h-3" />Add time entry
        </button>
      </div>

      <div className="flex items-center gap-3 flex-wrap">
        <label className="flex items-center gap-1.5 text-[11px] text-gray-400">
          Discount %
          <input type="number" min="0" max="100" value={discountPercent} onChange={(e) => setDiscountPercent(e.target.value)} className={cn(ds.input, 'w-16 text-xs py-1')} />
        </label>
        <label className="flex items-center gap-1.5 text-[11px] text-gray-400">
          Tax %
          <input type="number" min="0" max="100" value={taxRate} onChange={(e) => setTaxRate(e.target.value)} className={cn(ds.input, 'w-16 text-xs py-1')} />
        </label>
        <button
          onClick={calculate}
          disabled={busy}
          className="ml-auto px-3 py-1.5 text-xs rounded bg-emerald-500/20 text-emerald-300 hover:bg-emerald-500/30 disabled:opacity-50 inline-flex items-center gap-1.5"
        >
          {busy ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Play className="w-3.5 h-3.5" />}
          {busy ? 'Calculating…' : 'Calculate'}
        </button>
      </div>

      {status === 'error' && <p className="text-xs text-rose-400" role="alert">{error}</p>}

      {status === 'done' && result && (
        <div className="space-y-3 pt-2 border-t border-white/10">
          <StatTileGrid columns={4}>
            <StatTile label="Billable hours" value={result.totals.billableHours} />
            <StatTile label="Subtotal" value={fmtUsd(result.totals.subtotal)} />
            <StatTile label="Discount" value={fmtUsd(result.totals.discount)} />
            <StatTile label="Grand total" value={fmtUsd(result.totals.grandTotal)} tone="positive" icon={<Receipt className="w-3.5 h-3.5" />} />
          </StatTileGrid>
          {result.attorneyBreakdown.length > 0 && (
            <DataTable columns={attorneyColumns} rows={result.attorneyBreakdown} getRowId={(r) => r.attorney} density="compact" caption="By attorney" />
          )}
          {result.categoryBreakdown.length > 0 && (
            <DataTable columns={categoryColumns} rows={result.categoryBreakdown} getRowId={(r) => r.category} density="compact" caption="By category" />
          )}
        </div>
      )}
      {status !== 'done' && !busy && (
        <EmptyState compact icon={<Calculator className="h-5 w-5" aria-hidden="true" />} title="No calculation run yet." description="Add time entries and press Calculate." ariaLabel="Billing calculator empty" />
      )}
    </div>
  );
}
