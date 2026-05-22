'use client';

import { useCallback, useEffect, useState } from 'react';
import { lensRun } from '@/lib/api/client';
import { Receipt, Plus, Loader2, Trash2, DollarSign } from 'lucide-react';
import { VetInvoice, VetLineItem, PAY_METHODS } from './vet-types';

const STATUS_COLOR: Record<string, string> = {
  unpaid: 'text-red-400 bg-red-400/10',
  partial: 'text-yellow-400 bg-yellow-400/10',
  paid: 'text-green-400 bg-green-400/10',
};

type DraftItem = { description: string; qty: string; unitPrice: string };

export function BillingPanel({ onChanged }: { onChanged?: () => void }) {
  const [invoices, setInvoices] = useState<VetInvoice[]>([]);
  const [outstanding, setOutstanding] = useState(0);
  const [collected, setCollected] = useState(0);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const [patientName, setPatientName] = useState('');
  const [owner, setOwner] = useState('');
  const [taxRate, setTaxRate] = useState('0');
  const [items, setItems] = useState<DraftItem[]>([{ description: '', qty: '1', unitPrice: '' }]);
  const [busy, setBusy] = useState(false);

  const [payFor, setPayFor] = useState<string | null>(null);
  const [payAmount, setPayAmount] = useState('');
  const [payMethod, setPayMethod] = useState('card');

  const load = useCallback(async () => {
    setLoading(true);
    const r = await lensRun('veterinary', 'invoice-list', {});
    if (r.data.ok && r.data.result) {
      const res = r.data.result as { invoices: VetInvoice[]; outstanding: number; collected: number };
      setInvoices(res.invoices || []);
      setOutstanding(res.outstanding || 0);
      setCollected(res.collected || 0);
      setError(null);
    } else {
      setError(r.data.error || 'failed to load invoices');
    }
    setLoading(false);
  }, []);

  useEffect(() => {
    load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const draftSubtotal = items.reduce(
    (s, it) => s + (Number(it.qty) || 0) * (Number(it.unitPrice) || 0),
    0,
  );

  const createInvoice = async () => {
    if (!patientName.trim()) return;
    const lineItems = items
      .filter((it) => it.description.trim())
      .map((it) => ({
        description: it.description,
        qty: Number(it.qty) || 1,
        unitPrice: Number(it.unitPrice) || 0,
      }));
    setBusy(true);
    const r = await lensRun('veterinary', 'invoice-create', {
      patientName,
      owner,
      taxRate: Number(taxRate) || 0,
      lineItems,
    });
    setBusy(false);
    if (r.data.ok) {
      setPatientName('');
      setOwner('');
      setTaxRate('0');
      setItems([{ description: '', qty: '1', unitPrice: '' }]);
      await load();
      onChanged?.();
    } else {
      setError(r.data.error || 'failed to create invoice');
    }
  };

  const pay = async (id: string) => {
    if (!Number(payAmount)) return;
    await lensRun('veterinary', 'invoice-pay', {
      id,
      amount: Number(payAmount),
      method: payMethod,
    });
    setPayFor(null);
    setPayAmount('');
    await load();
    onChanged?.();
  };

  return (
    <div className="space-y-4">
      <div className="grid grid-cols-2 gap-2">
        <div className="rounded-lg border border-zinc-800 bg-zinc-950 px-3 py-2">
          <p className="text-[10px] uppercase tracking-wide text-zinc-500">Outstanding</p>
          <p className="font-mono text-lg text-red-300">${outstanding.toFixed(2)}</p>
        </div>
        <div className="rounded-lg border border-zinc-800 bg-zinc-950 px-3 py-2">
          <p className="text-[10px] uppercase tracking-wide text-zinc-500">Collected</p>
          <p className="font-mono text-lg text-green-300">${collected.toFixed(2)}</p>
        </div>
      </div>

      <div className="rounded-lg border border-zinc-800 bg-zinc-950/60 p-3 space-y-2">
        <div className="grid grid-cols-2 md:grid-cols-3 gap-2">
          <input
            value={patientName}
            onChange={(e) => setPatientName(e.target.value)}
            placeholder="Patient name *"
            className="rounded border border-zinc-800 bg-zinc-900 px-2 py-1.5 text-sm text-white"
          />
          <input
            value={owner}
            onChange={(e) => setOwner(e.target.value)}
            placeholder="Owner"
            className="rounded border border-zinc-800 bg-zinc-900 px-2 py-1.5 text-sm text-white"
          />
          <input
            value={taxRate}
            onChange={(e) => setTaxRate(e.target.value)}
            type="number"
            step="0.01"
            placeholder="Tax rate (0.07)"
            className="rounded border border-zinc-800 bg-zinc-900 px-2 py-1.5 text-sm text-white"
          />
        </div>
        {items.map((it, i) => (
          <div key={i} className="flex gap-1">
            <input
              value={it.description}
              onChange={(e) => {
                const next = [...items];
                next[i] = { ...next[i], description: e.target.value };
                setItems(next);
              }}
              placeholder="Line item"
              className="flex-1 rounded border border-zinc-800 bg-zinc-900 px-2 py-1 text-xs text-white"
            />
            <input
              value={it.qty}
              onChange={(e) => {
                const next = [...items];
                next[i] = { ...next[i], qty: e.target.value };
                setItems(next);
              }}
              type="number"
              placeholder="Qty"
              className="w-16 rounded border border-zinc-800 bg-zinc-900 px-2 py-1 text-xs text-white"
            />
            <input
              value={it.unitPrice}
              onChange={(e) => {
                const next = [...items];
                next[i] = { ...next[i], unitPrice: e.target.value };
                setItems(next);
              }}
              type="number"
              placeholder="$ each"
              className="w-20 rounded border border-zinc-800 bg-zinc-900 px-2 py-1 text-xs text-white"
            />
            <button
              onClick={() => setItems(items.filter((_, j) => j !== i))}
              aria-label="Remove line"
              className="rounded p-1 text-zinc-500 hover:text-red-400"
            >
              <Trash2 className="h-3.5 w-3.5" />
            </button>
          </div>
        ))}
        <div className="flex items-center justify-between">
          <button
            onClick={() => setItems([...items, { description: '', qty: '1', unitPrice: '' }])}
            className="text-xs text-blue-400 hover:text-blue-300"
          >
            + add line
          </button>
          <span className="text-xs text-zinc-400">
            Subtotal: <span className="font-mono text-white">${draftSubtotal.toFixed(2)}</span>
          </span>
        </div>
        <button
          onClick={createInvoice}
          disabled={busy || !patientName.trim()}
          className="flex w-full items-center justify-center gap-2 rounded bg-emerald-600 px-3 py-1.5 text-sm font-medium text-white hover:bg-emerald-500 disabled:opacity-50"
        >
          {busy ? <Loader2 className="h-4 w-4 animate-spin" /> : <Plus className="h-4 w-4" />}
          Create invoice
        </button>
      </div>

      {error && (
        <div className="rounded border border-red-500/30 bg-red-500/10 px-3 py-2 text-xs text-red-300">
          {error}
        </div>
      )}

      {loading ? (
        <div className="flex items-center gap-2 text-xs text-zinc-500">
          <Loader2 className="h-4 w-4 animate-spin" /> Loading invoices…
        </div>
      ) : invoices.length === 0 ? (
        <div className="rounded border border-dashed border-zinc-800 py-8 text-center text-sm text-zinc-500">
          <Receipt className="mx-auto mb-2 h-8 w-8 opacity-30" />
          No invoices yet.
        </div>
      ) : (
        <div className="space-y-2">
          {invoices.map((inv) => (
            <div key={inv.id} className="rounded-lg border border-zinc-800 bg-zinc-900 p-3">
              <div className="flex items-center justify-between">
                <div>
                  <p className="text-sm font-semibold text-white">
                    {inv.patientName}{' '}
                    <span
                      className={`ml-1 rounded px-1.5 py-0.5 text-[10px] ${STATUS_COLOR[inv.status] || ''}`}
                    >
                      {inv.status}
                    </span>
                  </p>
                  <p className="text-xs text-zinc-500">{inv.owner || 'no owner'}</p>
                </div>
                <div className="text-right">
                  <p className="font-mono text-sm text-white">${inv.total.toFixed(2)}</p>
                  <p className="text-[10px] text-zinc-500">due ${inv.balanceDue.toFixed(2)}</p>
                </div>
              </div>
              <div className="mt-2 space-y-0.5">
                {inv.lineItems.map((li: VetLineItem, i: number) => (
                  <div key={i} className="flex justify-between text-[11px] text-zinc-400">
                    <span>
                      {li.description} ×{li.qty}
                    </span>
                    <span className="font-mono">${li.lineTotal.toFixed(2)}</span>
                  </div>
                ))}
                {inv.tax > 0 && (
                  <div className="flex justify-between text-[11px] text-zinc-500">
                    <span>tax</span>
                    <span className="font-mono">${inv.tax.toFixed(2)}</span>
                  </div>
                )}
              </div>
              {inv.balanceDue > 0 &&
                (payFor === inv.id ? (
                  <div className="mt-2 flex gap-1">
                    <input
                      value={payAmount}
                      onChange={(e) => setPayAmount(e.target.value)}
                      type="number"
                      placeholder="Amount"
                      className="w-24 rounded border border-zinc-800 bg-zinc-950 px-2 py-1 text-xs text-white"
                    />
                    <select
                      value={payMethod}
                      onChange={(e) => setPayMethod(e.target.value)}
                      className="rounded border border-zinc-800 bg-zinc-950 px-2 py-1 text-xs text-white"
                    >
                      {PAY_METHODS.map((m) => (
                        <option key={m} value={m}>
                          {m}
                        </option>
                      ))}
                    </select>
                    <button
                      onClick={() => pay(inv.id)}
                      className="rounded bg-emerald-600 px-2 py-1 text-xs text-white hover:bg-emerald-500"
                    >
                      Apply
                    </button>
                    <button
                      onClick={() => setPayFor(null)}
                      className="rounded px-2 py-1 text-xs text-zinc-500 hover:text-white"
                    >
                      Cancel
                    </button>
                  </div>
                ) : (
                  <button
                    onClick={() => {
                      setPayFor(inv.id);
                      setPayAmount(String(inv.balanceDue));
                    }}
                    className="mt-2 flex items-center gap-1 rounded bg-zinc-800 px-2 py-1 text-xs text-emerald-300 hover:bg-zinc-700"
                  >
                    <DollarSign className="h-3 w-3" /> Record payment
                  </button>
                ))}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
