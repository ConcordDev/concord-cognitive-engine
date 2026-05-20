'use client';

import { useEffect, useState } from 'react';
import { CreditCard, Plus, Loader2, Copy, Check } from 'lucide-react';
import { lensRun } from '@/lib/api/client';
import { cn } from '@/lib/utils';

interface Payment { id: string; invoiceRef: string; amount: number; status: 'pending' | 'paid'; hostedUrl: string; createdAt: string; paidAt?: string }

export function PaymentsPanel() {
  const [payments, setPayments] = useState<Payment[]>([]);
  const [loading, setLoading] = useState(true);
  const [form, setForm] = useState({ invoiceRef: '', amount: '' });

  useEffect(() => { refresh(); }, []);

  async function refresh() {
    setLoading(true);
    try {
      const res = await lensRun({ domain: 'trades', action: 'payments-list', input: {} });
      setPayments((res.data?.result?.payments || []) as Payment[]);
    } catch (e) { console.error('[Payments] failed', e); }
    finally { setLoading(false); }
  }

  async function createLink() {
    if (!form.invoiceRef.trim() || !form.amount) return;
    try {
      await lensRun({ domain: 'trades', action: 'payments-create-link', input: { invoiceRef: form.invoiceRef, amount: Number(form.amount) } });
      setForm({ invoiceRef: '', amount: '' });
      await refresh();
    } catch (e) { console.error('[Payments] create', e); }
  }

  async function markPaid(id: string) {
    try {
      await lensRun({ domain: 'trades', action: 'payments-mark-paid', input: { id } });
      await refresh();
    } catch (e) { console.error('[Payments] mark', e); }
  }

  const pending = payments.filter(p => p.status === 'pending').length;
  const totalPaid = payments.filter(p => p.status === 'paid').reduce((s, p) => s + p.amount, 0);

  return (
    <div className="bg-[#0d1117] border border-emerald-500/20 rounded-lg overflow-hidden">
      <header className="px-4 py-2 border-b border-white/10 flex items-center gap-2">
        <CreditCard className="w-4 h-4 text-emerald-400" />
        <span className="text-xs uppercase font-semibold text-gray-300 tracking-wider">Payments</span>
        <span className="ml-auto text-[10px] text-gray-500">{pending} pending · ${totalPaid.toFixed(0)} collected</span>
      </header>
      <div className="p-3 border-b border-white/10 grid grid-cols-4 gap-2">
        <input value={form.invoiceRef} onChange={e => setForm({ ...form, invoiceRef: e.target.value })} placeholder="Invoice ref" className="col-span-2 px-2 py-1.5 text-xs bg-lattice-deep border border-lattice-border rounded text-white font-mono" />
        <input type="number" value={form.amount} onChange={e => setForm({ ...form, amount: e.target.value })} placeholder="Amount $" className="px-2 py-1.5 text-xs bg-lattice-deep border border-lattice-border rounded text-white" />
        <button onClick={createLink} className="px-3 py-1.5 text-xs rounded bg-emerald-500 text-black font-bold hover:bg-emerald-400 inline-flex items-center justify-center gap-1"><Plus className="w-3 h-3" />Link</button>
      </div>
      <div className="max-h-80 overflow-y-auto">
        {loading ? (
          <div className="flex items-center justify-center py-6 text-xs text-gray-500"><Loader2 className="w-4 h-4 animate-spin mr-2" /> Loading…</div>
        ) : payments.length === 0 ? (
          <div className="px-3 py-10 text-center text-xs text-gray-500"><CreditCard className="w-6 h-6 mx-auto mb-2 opacity-30" />No payment links yet.</div>
        ) : (
          <ul className="divide-y divide-white/5">
            {payments.map(p => (
              <li key={p.id} className={cn('px-3 py-2 hover:bg-white/[0.03] flex items-center gap-3', p.status === 'paid' && 'opacity-60')}>
                <CreditCard className={cn('w-3.5 h-3.5', p.status === 'paid' ? 'text-emerald-400' : 'text-amber-400')} />
                <div className="flex-1 min-w-0">
                  <div className="text-xs text-white font-mono">{p.invoiceRef}</div>
                  <div className="text-[10px] text-gray-500 truncate">{p.hostedUrl}</div>
                </div>
                <button onClick={() => navigator.clipboard?.writeText(window.location.origin + p.hostedUrl)} className="p-1 text-gray-500 hover:text-cyan-300" title="Copy link"><Copy className="w-3 h-3" /></button>
                <span className="font-mono text-sm tabular-nums text-emerald-300">${p.amount.toFixed(2)}</span>
                <span className={cn('text-[9px] uppercase px-1.5 py-0.5 rounded', p.status === 'paid' ? 'bg-emerald-500/15 text-emerald-300' : 'bg-amber-500/15 text-amber-300')}>{p.status}</span>
                {p.status === 'pending' && <button onClick={() => markPaid(p.id)} className="p-1 text-emerald-400 hover:text-emerald-300" title="Mark paid"><Check className="w-3 h-3" /></button>}
              </li>
            ))}
          </ul>
        )}
      </div>
    </div>
  );
}

export default PaymentsPanel;
