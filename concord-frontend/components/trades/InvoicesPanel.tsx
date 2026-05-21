'use client';

import { useCallback, useEffect, useState } from 'react';
import { Receipt, Plus, Loader2, Trash2, DollarSign } from 'lucide-react';
import { lensRun } from '@/lib/api/client';
import { cn } from '@/lib/utils';

interface LineItem { description: string; qty: number; unitPrice: number }
interface PaymentRow { amount: number; method: string; at: string }
interface Invoice {
  id: string;
  number: string;
  customerName: string;
  lineItems: LineItem[];
  subtotal: number;
  taxRate: number;
  tax: number;
  total: number;
  amountPaid: number;
  status: 'unpaid' | 'partial' | 'paid';
  dueDate: string | null;
  method: string | null;
  overdue?: boolean;
  payments?: PaymentRow[];
  createdAt: string;
}
interface ListResult { invoices: Invoice[]; outstanding: number; collected: number; overdueCount: number }

const STATUS: Record<Invoice['status'], string> = {
  unpaid: 'bg-amber-500/15 text-amber-300',
  partial: 'bg-cyan-500/15 text-cyan-300',
  paid: 'bg-emerald-500/15 text-emerald-300',
};
const METHODS = ['card', 'ach', 'cash', 'check'] as const;

export function InvoicesPanel() {
  const [data, setData] = useState<ListResult | null>(null);
  const [loading, setLoading] = useState(true);
  const [creating, setCreating] = useState(false);
  const [customerName, setCustomerName] = useState('');
  const [dueDate, setDueDate] = useState('');
  const [taxRate, setTaxRate] = useState('');
  const [lines, setLines] = useState<LineItem[]>([{ description: '', qty: 1, unitPrice: 0 }]);
  const [payDraft, setPayDraft] = useState<Record<string, { amount: string; method: typeof METHODS[number] }>>({});

  const refresh = useCallback(async () => {
    setLoading(true);
    try {
      const r = await lensRun<ListResult>('trades', 'invoices-list', {});
      if (r.data?.ok && r.data.result) setData(r.data.result);
    } catch (e) { console.error('[Invoices] list failed', e); }
    finally { setLoading(false); }
  }, []);

  useEffect(() => { refresh(); }, [refresh]);

  const subtotal = lines.reduce((s, l) => s + (Number(l.qty) || 0) * (Number(l.unitPrice) || 0), 0);
  const taxPct = Math.max(0, Math.min(50, Number(taxRate) || 0));
  const total = subtotal * (1 + taxPct / 100);

  async function createInvoice() {
    const valid = lines.filter(l => l.description.trim());
    if (!customerName.trim() || valid.length === 0) return;
    try {
      const r = await lensRun('trades', 'invoices-create', {
        customerName, lineItems: valid, taxRate: taxPct, dueDate: dueDate || null,
      });
      if (r.data?.ok) {
        setCreating(false);
        setCustomerName(''); setDueDate(''); setTaxRate('');
        setLines([{ description: '', qty: 1, unitPrice: 0 }]);
        await refresh();
      }
    } catch (e) { console.error('[Invoices] create failed', e); }
  }

  async function recordPayment(id: string, fullTotal: number, paid: number) {
    const d = payDraft[id] || { amount: String(fullTotal - paid), method: 'card' as const };
    const amount = Number(d.amount);
    if (!Number.isFinite(amount) || amount <= 0) return;
    try {
      const r = await lensRun('trades', 'invoices-record-payment', { id, amount, method: d.method });
      if (r.data?.ok) { setPayDraft(p => ({ ...p, [id]: { amount: '', method: 'card' } })); await refresh(); }
    } catch (e) { console.error('[Invoices] payment failed', e); }
  }

  const updLine = (i: number, patch: Partial<LineItem>) =>
    setLines(ls => ls.map((l, idx) => (idx === i ? { ...l, ...patch } : l)));

  return (
    <div className="bg-[#0d1117] border border-emerald-500/20 rounded-lg overflow-hidden">
      <header className="px-4 py-2 border-b border-white/10 flex items-center gap-2">
        <Receipt className="w-4 h-4 text-emerald-400" />
        <span className="text-xs uppercase font-semibold text-gray-300 tracking-wider">Invoices &amp; payments</span>
        {data && (
          <span className="ml-auto text-[10px] text-gray-500">
            ${data.outstanding.toFixed(0)} outstanding · ${data.collected.toFixed(0)} collected · {data.overdueCount} overdue
          </span>
        )}
      </header>

      <div className="p-3 border-b border-white/10">
        <button onClick={() => setCreating(v => !v)} className="inline-flex items-center gap-1 px-2.5 py-1 rounded-md border border-emerald-500/30 bg-emerald-500/10 text-xs text-emerald-200">
          <Plus className="w-3 h-3" /> New invoice
        </button>
        {creating && (
          <div className="mt-2 rounded border border-emerald-500/30 bg-emerald-500/5 p-3 space-y-2">
            <div className="grid grid-cols-3 gap-2">
              <input value={customerName} onChange={e => setCustomerName(e.target.value)} placeholder="Customer name" className="col-span-1 px-2 py-1.5 text-xs bg-black/40 border border-white/10 rounded text-gray-100" />
              <input type="date" value={dueDate} onChange={e => setDueDate(e.target.value)} className="px-2 py-1.5 text-xs bg-black/40 border border-white/10 rounded text-gray-100" />
              <input type="number" value={taxRate} onChange={e => setTaxRate(e.target.value)} placeholder="Tax %" step="0.01" className="px-2 py-1.5 text-xs bg-black/40 border border-white/10 rounded text-gray-100 font-mono" />
            </div>
            {lines.map((l, i) => (
              <div key={i} className="grid grid-cols-12 gap-1.5">
                <input value={l.description} onChange={e => updLine(i, { description: e.target.value })} placeholder="Line description" className="col-span-6 px-2 py-1 text-xs bg-black/40 border border-white/10 rounded text-gray-100" />
                <input type="number" value={l.qty} onChange={e => updLine(i, { qty: Number(e.target.value) })} placeholder="Qty" className="col-span-2 px-2 py-1 text-xs bg-black/40 border border-white/10 rounded text-gray-100 font-mono" />
                <input type="number" value={l.unitPrice} onChange={e => updLine(i, { unitPrice: Number(e.target.value) })} placeholder="Unit $" step="0.01" className="col-span-3 px-2 py-1 text-xs bg-black/40 border border-white/10 rounded text-gray-100 font-mono" />
                <button onClick={() => setLines(ls => ls.filter((_, idx) => idx !== i))} disabled={lines.length === 1} className="col-span-1 p-1 text-gray-600 hover:text-rose-300 disabled:opacity-30" aria-label="Remove line"><Trash2 className="w-3 h-3 mx-auto" /></button>
              </div>
            ))}
            <div className="flex items-center justify-between">
              <button onClick={() => setLines(ls => [...ls, { description: '', qty: 1, unitPrice: 0 }])} className="text-[10px] text-emerald-300 hover:text-emerald-200">+ Add line</button>
              <span className="text-xs font-mono text-emerald-300">Total ${total.toFixed(2)}</span>
            </div>
            <button onClick={createInvoice} disabled={!customerName.trim() || !lines.some(l => l.description.trim())} className="px-3 py-1 rounded-md border border-emerald-500/40 bg-emerald-500/15 text-xs text-emerald-100 disabled:opacity-40">
              Issue invoice
            </button>
          </div>
        )}
      </div>

      <div className="max-h-96 overflow-y-auto">
        {loading ? (
          <div className="flex items-center justify-center py-8 text-xs text-gray-500"><Loader2 className="w-4 h-4 animate-spin mr-2" /> Loading…</div>
        ) : !data || data.invoices.length === 0 ? (
          <div className="px-3 py-10 text-center text-xs text-gray-500"><Receipt className="w-6 h-6 mx-auto mb-2 opacity-30" />No invoices yet.</div>
        ) : (
          <ul className="divide-y divide-white/5">
            {data.invoices.map(inv => {
              const d = payDraft[inv.id] || { amount: '', method: 'card' as const };
              return (
                <li key={inv.id} className="px-3 py-2">
                  <div className="flex items-center gap-2">
                    <span className="font-mono text-xs text-emerald-300">{inv.number}</span>
                    <span className="text-xs text-white truncate flex-1">{inv.customerName}</span>
                    {inv.overdue && <span className="text-[9px] uppercase px-1.5 py-0.5 rounded bg-rose-500/15 text-rose-300">overdue</span>}
                    <span className={cn('text-[9px] uppercase px-1.5 py-0.5 rounded', STATUS[inv.status])}>{inv.status}</span>
                    <span className="font-mono text-sm tabular-nums text-emerald-300">${inv.total.toFixed(2)}</span>
                  </div>
                  <div className="text-[10px] text-gray-500 mt-0.5">
                    {inv.lineItems.length} lines · paid ${inv.amountPaid.toFixed(2)}{inv.dueDate ? ` · due ${inv.dueDate}` : ''}
                  </div>
                  {inv.status !== 'paid' && (
                    <div className="mt-1.5 flex items-center gap-1.5">
                      <input
                        type="number" value={d.amount} placeholder={`${(inv.total - inv.amountPaid).toFixed(2)}`}
                        onChange={e => setPayDraft(p => ({ ...p, [inv.id]: { ...d, amount: e.target.value } }))}
                        className="w-24 px-2 py-1 text-xs bg-black/40 border border-white/10 rounded text-gray-100 font-mono"
                      />
                      <select value={d.method} onChange={e => setPayDraft(p => ({ ...p, [inv.id]: { ...d, method: e.target.value as typeof METHODS[number] } }))} className="px-2 py-1 text-xs bg-black/40 border border-white/10 rounded text-gray-100">
                        {METHODS.map(m => <option key={m} value={m}>{m}</option>)}
                      </select>
                      <button onClick={() => recordPayment(inv.id, inv.total, inv.amountPaid)} className="inline-flex items-center gap-1 px-2 py-1 rounded border border-emerald-500/40 bg-emerald-500/15 text-[10px] text-emerald-200">
                        <DollarSign className="w-3 h-3" /> Record payment
                      </button>
                    </div>
                  )}
                </li>
              );
            })}
          </ul>
        )}
      </div>
    </div>
  );
}

export default InvoicesPanel;
