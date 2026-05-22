'use client';

/**
 * LogisticsBoard — supply-chain tracking. Resupply requests advance
 * through requested → approved → in_transit → delivered.
 * Backed by defense.supply-request / supply-advance / supply-delete /
 * supply-board macros.
 */

import { useState, useEffect, useCallback } from 'react';
import { lensRun } from '@/lib/api/client';
import { Plus, Trash2, Loader2, Truck, ChevronRight, X } from 'lucide-react';

interface SupplyRequest {
  id: string;
  item: string;
  quantity: number;
  category: 'ammunition' | 'fuel' | 'rations' | 'medical' | 'parts' | 'equipment';
  priority: 'routine' | 'priority' | 'urgent' | 'flash';
  status: 'requested' | 'approved' | 'in_transit' | 'delivered' | 'cancelled';
  destination: string;
  requestedBy: string;
  history: { at: string; status: string }[];
}

interface SupplyBoardResult {
  requests: SupplyRequest[];
  total: number;
  byStatus: Record<string, number>;
  byCategory: Record<string, number>;
  openCount: number;
  fulfillmentPct: number;
}

const CATEGORIES = ['ammunition', 'fuel', 'rations', 'medical', 'parts', 'equipment'] as const;
const PRIORITIES = ['routine', 'priority', 'urgent', 'flash'] as const;

const STATUS_COLOR: Record<string, string> = {
  requested: 'text-zinc-400',
  approved: 'text-blue-400',
  in_transit: 'text-cyan-400',
  delivered: 'text-green-400',
  cancelled: 'text-red-400',
};

const PRIORITY_COLOR: Record<string, string> = {
  routine: 'text-zinc-400',
  priority: 'text-yellow-400',
  urgent: 'text-orange-400',
  flash: 'text-red-400',
};

export function LogisticsBoard() {
  const [board, setBoard] = useState<SupplyBoardResult | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [showForm, setShowForm] = useState(false);

  const [item, setItem] = useState('');
  const [quantity, setQuantity] = useState('');
  const [category, setCategory] = useState<typeof CATEGORIES[number]>('equipment');
  const [priority, setPriority] = useState<typeof PRIORITIES[number]>('routine');
  const [destination, setDestination] = useState('');
  const [requestedBy, setRequestedBy] = useState('');

  const refresh = useCallback(async () => {
    setLoading(true);
    setError(null);
    const r = await lensRun<SupplyBoardResult>('defense', 'supply-board', {});
    if (r.data?.ok && r.data.result) setBoard(r.data.result);
    else setError(r.data?.error || 'Failed to load logistics board');
    setLoading(false);
  }, []);

  useEffect(() => {
    refresh();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const submit = useCallback(async () => {
    if (!item.trim() || !quantity.trim()) {
      setError('Item and quantity are required');
      return;
    }
    setBusy(true);
    setError(null);
    const r = await lensRun('defense', 'supply-request', {
      item: item.trim(),
      quantity: Number(quantity),
      category,
      priority,
      destination: destination.trim(),
      requestedBy: requestedBy.trim(),
    });
    if (r.data?.ok) {
      setItem('');
      setQuantity('');
      setDestination('');
      setRequestedBy('');
      setShowForm(false);
      await refresh();
    } else {
      setError(r.data?.error || 'Failed to submit resupply request');
    }
    setBusy(false);
  }, [item, quantity, category, priority, destination, requestedBy, refresh]);

  const advance = useCallback(async (id: string) => {
    setBusy(true);
    const r = await lensRun('defense', 'supply-advance', { id });
    if (r.data?.ok) await refresh();
    else setError(r.data?.error || 'Failed to advance request');
    setBusy(false);
  }, [refresh]);

  const cancel = useCallback(async (id: string) => {
    setBusy(true);
    const r = await lensRun('defense', 'supply-advance', { id, status: 'cancelled' });
    if (r.data?.ok) await refresh();
    else setError(r.data?.error || 'Failed to cancel request');
    setBusy(false);
  }, [refresh]);

  const remove = useCallback(async (id: string) => {
    setBusy(true);
    const r = await lensRun('defense', 'supply-delete', { id });
    if (r.data?.ok) await refresh();
    else setError(r.data?.error || 'Failed to delete request');
    setBusy(false);
  }, [refresh]);

  const requests = board?.requests || [];

  return (
    <section className="rounded-xl border border-zinc-800 bg-zinc-950/40 p-4 space-y-3">
      <header className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          <Truck className="w-4 h-4 text-orange-400" />
          <h3 className="text-sm font-semibold text-white">Logistics Supply Chain</h3>
        </div>
        {board && (
          <div className="flex gap-3 text-[11px]">
            <span className="text-cyan-400">{board.byStatus.in_transit || 0} in transit</span>
            <span className="text-amber-400">{board.openCount} open</span>
            <span className="text-green-400">{board.fulfillmentPct}% fulfilled</span>
          </div>
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
        <div className="space-y-1.5 max-h-72 overflow-y-auto">
          {requests.map((r) => (
            <div
              key={r.id}
              className="rounded border border-zinc-800 bg-zinc-900/60 px-2.5 py-2"
            >
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-2 min-w-0">
                  <span className={`text-[10px] font-bold uppercase shrink-0 ${PRIORITY_COLOR[r.priority]}`}>
                    {r.priority}
                  </span>
                  <span className="text-xs text-white truncate">
                    {r.quantity}× {r.item}
                  </span>
                  <span className="text-[10px] text-zinc-500 shrink-0">{r.category}</span>
                  {r.destination && (
                    <span className="text-[10px] text-zinc-500 shrink-0">→ {r.destination}</span>
                  )}
                  <span className={`text-[10px] px-1.5 py-0.5 rounded bg-zinc-800 shrink-0 ${STATUS_COLOR[r.status]}`}>
                    {r.status}
                  </span>
                </div>
                <div className="flex items-center gap-0.5 shrink-0">
                  {r.status !== 'delivered' && r.status !== 'cancelled' && (
                    <>
                      <button
                        onClick={() => advance(r.id)}
                        disabled={busy}
                        title="Advance status"
                        className="p-1 text-zinc-500 hover:text-green-400 disabled:opacity-50"
                      >
                        <ChevronRight className="w-3.5 h-3.5" />
                      </button>
                      <button
                        onClick={() => cancel(r.id)}
                        disabled={busy}
                        aria-label="Cancel request"
                        className="p-1 text-zinc-500 hover:text-amber-400 disabled:opacity-50"
                      >
                        <X className="w-3.5 h-3.5" />
                      </button>
                    </>
                  )}
                  <button
                    onClick={() => remove(r.id)}
                    disabled={busy}
                    aria-label="Delete request"
                    className="p-1 text-zinc-500 hover:text-red-400 disabled:opacity-50"
                  >
                    <Trash2 className="w-3.5 h-3.5" />
                  </button>
                </div>
              </div>
              {r.requestedBy && (
                <p className="text-[10px] text-zinc-600 mt-0.5">requested by {r.requestedBy}</p>
              )}
            </div>
          ))}
          {requests.length === 0 && (
            <div className="text-center py-6 text-xs text-zinc-500">
              <Truck className="w-6 h-6 mx-auto mb-2 opacity-30" />
              No resupply requests. Create one below.
            </div>
          )}
        </div>
      )}

      {/* New request */}
      {showForm ? (
        <div className="rounded-md border border-orange-500/30 bg-orange-500/5 p-3 space-y-2">
          <div className="flex items-center justify-between">
            <span className="text-xs font-semibold text-white">New Resupply Request</span>
            <button onClick={() => setShowForm(false)} aria-label="Close form" className="text-zinc-500 hover:text-white">
              <X className="w-3.5 h-3.5" />
            </button>
          </div>
          <div className="grid grid-cols-2 md:grid-cols-3 gap-2">
            <input
              value={item}
              onChange={(e) => setItem(e.target.value)}
              placeholder="Item"
              className="bg-zinc-900 border border-zinc-800 rounded px-2 py-1.5 text-xs text-white"
            />
            <input
              value={quantity}
              onChange={(e) => setQuantity(e.target.value)}
              placeholder="Quantity"
              className="bg-zinc-900 border border-zinc-800 rounded px-2 py-1.5 text-xs text-white font-mono"
            />
            <select
              value={category}
              onChange={(e) => setCategory(e.target.value as typeof category)}
              className="bg-zinc-900 border border-zinc-800 rounded px-2 py-1.5 text-xs text-white"
            >
              {CATEGORIES.map((c) => (
                <option key={c} value={c}>
                  {c}
                </option>
              ))}
            </select>
            <select
              value={priority}
              onChange={(e) => setPriority(e.target.value as typeof priority)}
              className="bg-zinc-900 border border-zinc-800 rounded px-2 py-1.5 text-xs text-white"
            >
              {PRIORITIES.map((p) => (
                <option key={p} value={p}>
                  {p}
                </option>
              ))}
            </select>
            <input
              value={destination}
              onChange={(e) => setDestination(e.target.value)}
              placeholder="Destination"
              className="bg-zinc-900 border border-zinc-800 rounded px-2 py-1.5 text-xs text-white"
            />
            <input
              value={requestedBy}
              onChange={(e) => setRequestedBy(e.target.value)}
              placeholder="Requested by"
              className="bg-zinc-900 border border-zinc-800 rounded px-2 py-1.5 text-xs text-white"
            />
          </div>
          <button
            onClick={submit}
            disabled={busy}
            className="inline-flex items-center gap-1.5 rounded-md bg-orange-600 hover:bg-orange-500 px-3 py-1.5 text-xs font-medium text-white disabled:opacity-50"
          >
            {busy ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Plus className="w-3.5 h-3.5" />}
            Submit Request
          </button>
        </div>
      ) : (
        <button
          onClick={() => setShowForm(true)}
          className="inline-flex items-center gap-1.5 rounded-md border border-zinc-700 hover:border-orange-500/50 px-3 py-1.5 text-xs font-medium text-zinc-300"
        >
          <Plus className="w-3.5 h-3.5" />
          New Request
        </button>
      )}
    </section>
  );
}
