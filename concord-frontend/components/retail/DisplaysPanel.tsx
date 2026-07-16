'use client';

/**
 * DisplaysPanel — the real in-store marketing display / endcap board that
 * closes retail's third "Genuinely missing, deferred" gap
 * (docs/lens-specs/retail-capability-map.md "In-store marketing displays":
 * "a persisted display/endcap record (location, budget, impressions,
 * conversions). No macro anywhere."). Backs onto the persisted
 * retail.displays-* macro family (displays-list / displays-upsert /
 * displays-status-move / displays-log-impressions / displays-record-
 * conversion / displays-delete) — every number here (impressions,
 * conversions, conversion rate, attributed revenue, revenue-per-budget-
 * dollar) is server-computed, never client-invented.
 *
 * A DISTINCT, PHYSICAL concept from CampaignsManager (digital email/SMS/
 * discount sends) — this board is for real endcaps/windows/floor displays
 * placed at a physical store location.
 *
 * Two honesty design points carried through from the backend:
 *   - Impressions are a MANUALLY LOGGED count (staff observation), never a
 *     fabricated sensor feed — the "Log impressions" action is explicit
 *     about that in its label and it appends to a running log, it doesn't
 *     pretend to auto-track foot traffic.
 *   - "Record conversion" is gated on picking a REAL order from the
 *     merchant's own order book (fetched via orders-list) — there is no
 *     free-floating "+1 conversion" button anywhere in this panel.
 */

import { useEffect, useMemo, useState } from 'react';
import { LayoutTemplate, Plus, Trash2, Loader2, RotateCcw, Eye, ShoppingBag, CheckCircle2 } from 'lucide-react';
import { lensRun } from '@/lib/api/client';
import { cn } from '@/lib/utils';

type DisplayType = 'endcap' | 'window' | 'checkout-counter' | 'floor-display' | 'shelf-talker' | 'promotional-table';
type Status = 'planned' | 'active' | 'removed';

interface ImpressionLogEntry { count: number; note: string; at: string }
interface Display {
  id: string; location: string; displayType: DisplayType; budget: number;
  startDate: string | null; endDate: string | null; productSkus: string[]; notes: string;
  status: Status;
  statusHistory: Array<{ from: Status | null; to: Status; at: string; note?: string; reopened?: boolean }>;
  impressions: number; impressionLog: ImpressionLogEntry[];
  conversions: number; attributedOrderIds: string[]; attributedRevenue: number;
  removedAt: string | null; createdAt: string; updatedAt: string;
  conversionRate: number; revenuePerBudgetDollar: number | null;
}
interface Rollup {
  totalDisplays: number; plannedCount: number; activeCount: number; removedCount: number;
  totalImpressions: number; totalConversions: number; conversionRate: number;
  totalBudget: number; totalAttributedRevenue: number; revenuePerBudgetDollar: number | null;
}
interface Order { id: string; number: string; total: number }

const DISPLAY_TYPES: { id: DisplayType; label: string }[] = [
  { id: 'endcap', label: 'Endcap' },
  { id: 'window', label: 'Window' },
  { id: 'checkout-counter', label: 'Checkout counter' },
  { id: 'floor-display', label: 'Floor display' },
  { id: 'shelf-talker', label: 'Shelf talker' },
  { id: 'promotional-table', label: 'Promotional table' },
];
const STATUS_FILTERS: { id: 'all' | Status; label: string }[] = [
  { id: 'all', label: 'All' },
  { id: 'planned', label: 'Planned' },
  { id: 'active', label: 'Active' },
  { id: 'removed', label: 'Removed' },
];
const STATUS_BADGE: Record<Status, string> = {
  planned: 'bg-sky-500/15 text-sky-300 border-sky-500/30',
  active: 'bg-emerald-500/15 text-emerald-300 border-emerald-500/30',
  removed: 'bg-gray-500/15 text-gray-400 border-gray-500/20',
};

const money = (n: number) => `$${n.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
const pct = (n: number) => `${n.toLocaleString(undefined, { maximumFractionDigits: 2 })}%`;

export function DisplaysPanel() {
  const [displays, setDisplays] = useState<Display[]>([]);
  const [rollup, setRollup] = useState<Rollup | null>(null);
  const [orders, setOrders] = useState<Order[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [creating, setCreating] = useState(false);
  const [statusFilter, setStatusFilter] = useState<'all' | Status>('all');
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [busyId, setBusyId] = useState<string | null>(null);

  const [form, setForm] = useState({
    location: '', displayType: 'endcap' as DisplayType, budget: '', startDate: '', endDate: '', productSkus: '', notes: '',
  });
  const [impressionDraft, setImpressionDraft] = useState({ count: '', note: '' });
  const [convertOrderId, setConvertOrderId] = useState('');
  const [convertManualId, setConvertManualId] = useState('');

  const refresh = async () => {
    setLoading(true);
    setError(null);
    const [displaysRes, ordersRes] = await Promise.all([
      lensRun({ domain: 'retail', action: 'displays-list', input: {} }),
      lensRun({ domain: 'retail', action: 'orders-list', input: {} }),
    ]);
    if (displaysRes.data?.ok) {
      setDisplays((displaysRes.data.result?.displays || []) as Display[]);
      setRollup((displaysRes.data.result?.rollup || null) as Rollup | null);
    } else {
      setError(displaysRes.data?.error || 'Could not load the display board.');
    }
    if (ordersRes.data?.ok) setOrders((ordersRes.data.result?.orders || []) as Order[]);
    setLoading(false);
  };

  useEffect(() => { void refresh(); }, []);

  const filtered = useMemo(
    () => (statusFilter === 'all' ? displays : displays.filter((d) => d.status === statusFilter)),
    [displays, statusFilter],
  );
  const selected = useMemo(() => displays.find((d) => d.id === selectedId) || null, [displays, selectedId]);

  const create = async () => {
    if (!form.location.trim()) return;
    const input: Record<string, unknown> = {
      location: form.location.trim(),
      displayType: form.displayType,
      notes: form.notes.trim(),
    };
    if (form.budget.trim() !== '') input.budget = Number(form.budget);
    if (form.startDate) input.startDate = form.startDate;
    if (form.endDate) input.endDate = form.endDate;
    const skus = form.productSkus.split(',').map((s) => s.trim()).filter(Boolean);
    if (skus.length > 0) input.productSkus = skus;

    const r = await lensRun({ domain: 'retail', action: 'displays-upsert', input });
    if (r.data?.ok) {
      setForm({ location: '', displayType: 'endcap', budget: '', startDate: '', endDate: '', productSkus: '', notes: '' });
      setCreating(false);
      await refresh();
    } else {
      setError(r.data?.error || 'Could not create the display.');
    }
  };

  const moveStatus = async (id: string, status: Status, reopen = false) => {
    setBusyId(id);
    const r = await lensRun({ domain: 'retail', action: 'displays-status-move', input: { id, status, reopen: reopen || undefined } });
    setBusyId(null);
    if (r.data?.ok) await refresh();
    else setError(r.data?.error || 'Could not update that display.');
  };

  const logImpressions = async () => {
    if (!selected) return;
    const count = Number(impressionDraft.count);
    if (!Number.isInteger(count) || count <= 0) return;
    setBusyId(selected.id);
    const r = await lensRun({
      domain: 'retail', action: 'displays-log-impressions',
      input: { id: selected.id, count, note: impressionDraft.note.trim() || undefined },
    });
    setBusyId(null);
    if (r.data?.ok) {
      setImpressionDraft({ count: '', note: '' });
      await refresh();
    } else {
      setError(r.data?.error || 'Could not log that impression count.');
    }
  };

  const recordConversion = async () => {
    if (!selected) return;
    const orderId = convertManualId.trim() || convertOrderId;
    if (!orderId) return;
    setBusyId(selected.id);
    const r = await lensRun({ domain: 'retail', action: 'displays-record-conversion', input: { id: selected.id, orderId } });
    setBusyId(null);
    if (r.data?.ok) {
      setConvertOrderId('');
      setConvertManualId('');
      await refresh();
    } else {
      // Honest surfacing of the real rejection reason — e.g. a fake orderId
      // genuinely comes back "order not found", never a silent success.
      setError(r.data?.error || 'Could not record that conversion.');
    }
  };

  const remove = async (id: string) => {
    setBusyId(id);
    await lensRun({ domain: 'retail', action: 'displays-delete', input: { id } });
    setBusyId(null);
    if (selectedId === id) setSelectedId(null);
    await refresh();
  };

  return (
    <div className="bg-[#0d1117] border border-emerald-500/20 rounded-lg overflow-hidden">
      <header className="px-4 py-2 border-b border-white/10 flex items-center gap-2">
        <LayoutTemplate className="w-4 h-4 text-emerald-400" />
        <span className="text-xs uppercase font-semibold text-gray-300 tracking-wider">In-store displays</span>
        <span className="ml-auto text-[10px] text-gray-400">{displays.length} display{displays.length === 1 ? '' : 's'}</span>
        <button type="button" onClick={() => setCreating((v) => !v)} aria-label="New display" className="p-1 text-gray-400 hover:text-white">
          <Plus className="w-4 h-4" />
        </button>
      </header>

      {rollup && (
        <div className="px-3 py-2 border-b border-white/10 grid grid-cols-2 sm:grid-cols-5 gap-3">
          <div>
            <div className="text-[10px] uppercase tracking-wider text-gray-400">Impressions</div>
            <div className="text-sm font-mono tabular-nums text-white">{rollup.totalImpressions.toLocaleString()}</div>
          </div>
          <div>
            <div className="text-[10px] uppercase tracking-wider text-gray-400">Conversions</div>
            <div className="text-sm font-mono tabular-nums text-white">{rollup.totalConversions}</div>
          </div>
          <div>
            <div className="text-[10px] uppercase tracking-wider text-gray-400">Conv. rate</div>
            <div className="text-sm font-mono tabular-nums text-emerald-300">{pct(rollup.conversionRate)}</div>
          </div>
          <div>
            <div className="text-[10px] uppercase tracking-wider text-gray-400">Attributed rev.</div>
            <div className="text-sm font-mono tabular-nums text-emerald-300">{money(rollup.totalAttributedRevenue)}</div>
          </div>
          <div>
            <div className="text-[10px] uppercase tracking-wider text-gray-400">Revenue / $ budget</div>
            <div className="text-sm font-mono tabular-nums text-gray-300">
              {rollup.revenuePerBudgetDollar === null ? 'n/a (no budget)' : `$${rollup.revenuePerBudgetDollar.toFixed(2)}`}
            </div>
          </div>
        </div>
      )}

      {creating && (
        <div className="p-3 border-b border-white/10 grid grid-cols-2 sm:grid-cols-3 gap-2">
          <input value={form.location} onChange={(e) => setForm({ ...form, location: e.target.value })} placeholder="Location (e.g. front endcap, aisle 3)" className="col-span-2 sm:col-span-2 px-2 py-1.5 text-xs bg-lattice-deep border border-lattice-border rounded text-white" />
          <select value={form.displayType} onChange={(e) => setForm({ ...form, displayType: e.target.value as DisplayType })} aria-label="Display type" className="px-2 py-1.5 text-xs bg-lattice-deep border border-lattice-border rounded text-white">
            {DISPLAY_TYPES.map((t) => <option key={t.id} value={t.id}>{t.label}</option>)}
          </select>
          <input value={form.budget} onChange={(e) => setForm({ ...form, budget: e.target.value })} placeholder="Budget ($)" type="number" min="0" className="px-2 py-1.5 text-xs bg-lattice-deep border border-lattice-border rounded text-white" />
          <input value={form.startDate} onChange={(e) => setForm({ ...form, startDate: e.target.value })} type="date" aria-label="Start date" className="px-2 py-1.5 text-xs bg-lattice-deep border border-lattice-border rounded text-white" />
          <input value={form.endDate} onChange={(e) => setForm({ ...form, endDate: e.target.value })} type="date" aria-label="End date" className="px-2 py-1.5 text-xs bg-lattice-deep border border-lattice-border rounded text-white" />
          <input value={form.productSkus} onChange={(e) => setForm({ ...form, productSkus: e.target.value })} placeholder="SKUs promoted, comma-separated" className="col-span-2 sm:col-span-2 px-2 py-1.5 text-xs bg-lattice-deep border border-lattice-border rounded text-white" />
          <textarea value={form.notes} onChange={(e) => setForm({ ...form, notes: e.target.value })} placeholder="Notes" rows={2} className="col-span-2 sm:col-span-3 px-2 py-1.5 text-xs bg-lattice-deep border border-lattice-border rounded text-white" />
          <button type="button" onClick={create} disabled={!form.location.trim()} className="px-3 py-1.5 text-xs rounded bg-emerald-500 text-black font-bold hover:bg-emerald-400 disabled:opacity-40">Add display</button>
        </div>
      )}

      {error && (
        <div role="alert" className="px-3 py-2 border-b border-rose-900/40 bg-rose-950/30 text-[11px] text-rose-300">{error}</div>
      )}

      <nav className="flex items-center gap-1 px-3 py-2 border-b border-white/10 overflow-x-auto">
        {STATUS_FILTERS.map((s) => (
          <button
            key={s.id}
            type="button"
            onClick={() => setStatusFilter(s.id)}
            className={cn(
              'px-2 py-1 rounded text-[10px] uppercase tracking-wider whitespace-nowrap transition',
              statusFilter === s.id ? 'bg-emerald-500/20 text-emerald-300' : 'text-gray-400 hover:text-emerald-300',
            )}
          >
            {s.label}
          </button>
        ))}
      </nav>

      {loading ? (
        <div className="flex items-center justify-center py-8 text-xs text-gray-400"><Loader2 className="w-4 h-4 animate-spin mr-2" /> Loading…</div>
      ) : (
        <div className="flex flex-col md:flex-row">
          <div className="md:w-1/2 border-b md:border-b-0 md:border-r border-white/10 max-h-[30rem] overflow-y-auto">
            {filtered.length === 0 ? (
              <div className="px-3 py-10 text-center text-xs text-gray-400">
                <LayoutTemplate className="w-6 h-6 mx-auto mb-2 opacity-30" />No displays in {statusFilter === 'all' ? 'the board' : statusFilter}.
              </div>
            ) : (
              <ul className="divide-y divide-white/5">
                {filtered.map((d) => (
                  <li
                    key={d.id}
                    data-testid={`display-card-${d.id}`}
                    onClick={() => setSelectedId(d.id)}
                    className={cn('px-3 py-2 cursor-pointer hover:bg-white/[0.03] group', selectedId === d.id && 'bg-emerald-500/[0.06]')}
                  >
                    <div className="flex items-start justify-between gap-2">
                      <div className="min-w-0">
                        <p className="text-xs text-white font-medium truncate">{d.location}</p>
                        <div className="mt-1 flex items-center gap-1.5 flex-wrap">
                          <span className="text-[9px] uppercase px-1.5 py-0.5 rounded border bg-white/5 text-gray-300 border-white/10">
                            {DISPLAY_TYPES.find((t) => t.id === d.displayType)?.label || d.displayType}
                          </span>
                          <span className={cn('text-[9px] uppercase px-1.5 py-0.5 rounded border', STATUS_BADGE[d.status])} data-testid={`status-badge-${d.id}`}>{d.status}</span>
                        </div>
                      </div>
                      <button
                        type="button"
                        onClick={(e) => { e.stopPropagation(); remove(d.id); }}
                        aria-label={`Delete ${d.location}`}
                        disabled={busyId === d.id}
                        className="opacity-0 group-hover:opacity-100 text-gray-500 hover:text-rose-400 shrink-0"
                      >
                        <Trash2 className="w-3 h-3" />
                      </button>
                    </div>
                    <div className="mt-1.5 grid grid-cols-4 gap-1 text-[10px] text-gray-400" data-testid={`stat-row-${d.id}`}>
                      <span><Eye className="w-2.5 h-2.5 inline mr-0.5" />{d.impressions}</span>
                      <span><ShoppingBag className="w-2.5 h-2.5 inline mr-0.5" />{d.conversions}</span>
                      <span>{pct(d.conversionRate)}</span>
                      <span className="truncate">{money(d.budget)} bud.</span>
                    </div>
                  </li>
                ))}
              </ul>
            )}
          </div>

          <div className="md:w-1/2 p-3 max-h-[30rem] overflow-y-auto">
            {!selected ? (
              <p className="text-[11px] text-gray-500 italic text-center py-8">Select a display to log impressions or record a conversion.</p>
            ) : (
              <div className="space-y-3">
                <div>
                  <p className="text-sm text-white font-medium">{selected.location}</p>
                  <div className="mt-1 flex items-center gap-1.5 flex-wrap text-[10px] text-gray-400">
                    <span className={cn('uppercase px-1.5 py-0.5 rounded border', STATUS_BADGE[selected.status])}>{selected.status}</span>
                    <span>{DISPLAY_TYPES.find((t) => t.id === selected.displayType)?.label}</span>
                    {(selected.startDate || selected.endDate) && (
                      <span>{selected.startDate || '…'} → {selected.endDate || '…'}</span>
                    )}
                  </div>
                  {selected.productSkus.length > 0 && (
                    <p className="mt-1 text-[10px] text-gray-500">Promoting: {selected.productSkus.join(', ')}</p>
                  )}
                  {selected.notes && <p className="mt-2 text-[11px] text-gray-300 whitespace-pre-wrap">{selected.notes}</p>}
                </div>

                <div className="grid grid-cols-2 gap-2 text-[10px] text-gray-400">
                  <div>Budget: <span className="text-gray-200 font-mono">{money(selected.budget)}</span></div>
                  <div>Attributed rev.: <span className="text-emerald-300 font-mono">{money(selected.attributedRevenue)}</span></div>
                  <div>Impressions: <span className="text-gray-200 font-mono">{selected.impressions}</span></div>
                  <div>
                    Rev./$ budget:{' '}
                    <span className="text-gray-200 font-mono">
                      {selected.revenuePerBudgetDollar === null ? 'n/a (no budget)' : `$${selected.revenuePerBudgetDollar.toFixed(2)}`}
                    </span>
                  </div>
                </div>

                <div className="flex items-center gap-2">
                  {selected.status !== 'removed' ? (
                    <>
                      <select
                        value={selected.status}
                        onChange={(e) => moveStatus(selected.id, e.target.value as Status)}
                        disabled={busyId === selected.id}
                        aria-label={`Move ${selected.location} to status`}
                        className="text-[10px] bg-lattice-deep border border-lattice-border rounded px-1.5 py-1 text-gray-300"
                      >
                        <option value="planned">planned</option>
                        <option value="active">active</option>
                        <option value="removed">removed</option>
                      </select>
                      {selected.status !== 'active' && (
                        <button
                          type="button"
                          onClick={() => moveStatus(selected.id, 'active')}
                          disabled={busyId === selected.id}
                          className="inline-flex items-center gap-1 px-2 py-1 text-[10px] rounded bg-emerald-500/15 text-emerald-300 border border-emerald-500/30 hover:bg-emerald-500/25"
                        >
                          <CheckCircle2 className="w-3 h-3" /> Activate
                        </button>
                      )}
                    </>
                  ) : (
                    <button
                      type="button"
                      onClick={() => moveStatus(selected.id, 'planned', true)}
                      disabled={busyId === selected.id}
                      className="inline-flex items-center gap-1 px-2 py-1 text-[10px] rounded bg-gray-500/15 text-gray-300 border border-gray-500/30 hover:text-emerald-300"
                    >
                      <RotateCcw className="w-3 h-3" /> Reopen
                    </button>
                  )}
                </div>

                <div className="border-t border-white/10 pt-2">
                  <div className="text-[10px] uppercase tracking-wider text-gray-500 mb-1">Log impressions (manual count)</div>
                  <p className="text-[9px] text-gray-600 mb-1.5">Staff-observed foot-traffic count — Concord has no automated in-store sensor.</p>
                  <div className="grid grid-cols-3 gap-1.5">
                    <input
                      value={impressionDraft.count}
                      onChange={(e) => setImpressionDraft({ ...impressionDraft, count: e.target.value })}
                      placeholder="Count"
                      type="number"
                      min="1"
                      className="px-2 py-1.5 text-xs bg-lattice-deep border border-lattice-border rounded text-white"
                    />
                    <input
                      value={impressionDraft.note}
                      onChange={(e) => setImpressionDraft({ ...impressionDraft, note: e.target.value })}
                      placeholder="Note (optional)"
                      className="col-span-2 px-2 py-1.5 text-xs bg-lattice-deep border border-lattice-border rounded text-white"
                    />
                    <button
                      type="button"
                      onClick={logImpressions}
                      disabled={!Number.isInteger(Number(impressionDraft.count)) || Number(impressionDraft.count) <= 0 || busyId === selected.id}
                      className="col-span-3 px-3 py-1.5 text-xs rounded bg-sky-500/20 text-sky-300 border border-sky-500/30 hover:bg-sky-500/30 disabled:opacity-40"
                    >
                      Log impressions
                    </button>
                  </div>
                  {selected.impressionLog.length > 0 && (
                    <p className="mt-1.5 text-[10px] text-gray-500">{selected.impressionLog.length} log{selected.impressionLog.length === 1 ? '' : 's'} · latest: {selected.impressionLog.at(-1)?.count}</p>
                  )}
                </div>

                <div className="border-t border-white/10 pt-2">
                  <div className="text-[10px] uppercase tracking-wider text-gray-500 mb-1">Record conversion</div>
                  <p className="text-[9px] text-gray-600 mb-1.5">Must be a real order from your order book — never a free-floating count.</p>
                  <div className="grid grid-cols-3 gap-1.5">
                    <select
                      value={convertOrderId}
                      onChange={(e) => setConvertOrderId(e.target.value)}
                      aria-label="Pick a real order"
                      className="col-span-3 px-2 py-1.5 text-xs bg-lattice-deep border border-lattice-border rounded text-white"
                      disabled={orders.length === 0}
                    >
                      <option value="">{orders.length === 0 ? 'No orders yet' : 'Pick an order…'}</option>
                      {orders.map((o) => (
                        <option key={o.id} value={o.id}>{o.number} — {money(o.total)}</option>
                      ))}
                    </select>
                    <input
                      value={convertManualId}
                      onChange={(e) => setConvertManualId(e.target.value)}
                      placeholder="…or paste an order id"
                      className="col-span-3 px-2 py-1.5 text-xs bg-lattice-deep border border-lattice-border rounded text-white"
                    />
                    <button
                      type="button"
                      onClick={recordConversion}
                      disabled={(!convertOrderId && !convertManualId.trim()) || busyId === selected.id}
                      className="col-span-3 px-3 py-1.5 text-xs rounded bg-emerald-500 text-black font-bold hover:bg-emerald-400 disabled:opacity-40"
                    >
                      Record conversion
                    </button>
                  </div>
                </div>
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  );
}

export default DisplaysPanel;
