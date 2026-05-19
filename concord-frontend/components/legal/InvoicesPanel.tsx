'use client';

import { useEffect, useState } from 'react';
import { FileText, Loader2, CheckCircle, Sparkles } from 'lucide-react';
import { api } from '@/lib/api/client';
import { cn } from '@/lib/utils';

interface Matter { id: string; name: string }
interface LegalInvoice {
  id: string; number: string;
  matterId: string; matterName: string;
  clientName: string;
  issuedAt: string; dueAt: string;
  subtotal: number; tax: number; total: number;
  status: 'open' | 'paid'; paidAt: string | null;
  lineItems: Array<{ entryId: string; date: string; description: string; hours: number; rate: number; amount: number }>;
}

export function InvoicesPanel() {
  const [invoices, setInvoices] = useState<LegalInvoice[]>([]);
  const [matters, setMatters] = useState<Matter[]>([]);
  const [filter, setFilter] = useState<'all' | 'open' | 'paid'>('open');
  const [loading, setLoading] = useState(true);
  const [billMatter, setBillMatter] = useState('');
  const [taxRate, setTaxRate] = useState('');
  const [expanded, setExpanded] = useState<string | null>(null);

  useEffect(() => { refresh(); }, [filter]);

  async function refresh() {
    setLoading(true);
    try {
      const [i, m] = await Promise.all([
        api.post('/api/lens/run', { domain: 'legal', action: 'invoices-list', input: filter === 'all' ? {} : { status: filter } }),
        api.post('/api/lens/run', { domain: 'legal', action: 'matters-list', input: { status: 'open' } }),
      ]);
      setInvoices((i.data?.result?.invoices || []) as LegalInvoice[]);
      setMatters((m.data?.result?.matters || []) as Matter[]);
    } catch (e) { console.error('[Invoices] refresh failed', e); }
    finally { setLoading(false); }
  }

  async function billFromTime() {
    if (!billMatter) return;
    try {
      const r = await api.post('/api/lens/run', {
        domain: 'legal', action: 'invoices-from-time',
        input: { matterId: billMatter, taxRate: Number(taxRate) || 0 },
      });
      if (r.data?.ok === false) { alert(r.data?.error); return; }
      setBillMatter(''); setTaxRate('');
      await refresh();
    } catch (e) { console.error('[Invoices] bill failed', e); }
  }

  async function markPaid(id: string) {
    try {
      await api.post('/api/lens/run', { domain: 'legal', action: 'invoices-mark-paid', input: { id } });
      await refresh();
    } catch (e) { console.error('[Invoices] mark-paid failed', e); }
  }

  const totalOpen = invoices.filter(i => i.status === 'open').reduce((s, i) => s + i.total, 0);

  return (
    <div className="bg-[#0d1117] border border-amber-500/15 rounded-lg overflow-hidden">
      <header className="px-4 py-2.5 border-b border-white/10 flex items-center gap-2">
        <FileText className="w-4 h-4 text-amber-400" />
        <span className="text-sm font-semibold text-gray-200">Bills (matter invoices)</span>
        <span className="text-[10px] text-amber-300 font-mono">${totalOpen.toFixed(2)} open</span>
        <select value={filter} onChange={e => setFilter(e.target.value as typeof filter)} className="ml-2 text-[10px] px-1.5 py-0.5 bg-lattice-deep border border-lattice-border rounded text-white">
          <option value="open">Open</option>
          <option value="paid">Paid</option>
          <option value="all">All</option>
        </select>
      </header>

      {/* "Bill from unbilled time" — Clio Manage AI parity */}
      <div className="p-3 grid grid-cols-12 gap-2 border-b border-white/10 bg-amber-500/[0.03]">
        <div className="col-span-12 flex items-center gap-1.5 text-[10px] uppercase tracking-wider text-amber-300">
          <Sparkles className="w-3 h-3" />Bill all unbilled time on a matter
        </div>
        <select value={billMatter} onChange={e => setBillMatter(e.target.value)} className="col-span-7 px-2 py-1.5 text-xs bg-lattice-deep border border-lattice-border rounded text-white">
          <option value="">Pick matter…</option>
          {matters.map(m => <option key={m.id} value={m.id}>{m.name}</option>)}
        </select>
        <input type="number" step="0.01" value={taxRate} onChange={e => setTaxRate(e.target.value)} placeholder="Tax (e.g. 0.08)" className="col-span-2 px-2 py-1.5 text-xs bg-lattice-deep border border-lattice-border rounded text-white font-mono" />
        <button onClick={billFromTime} disabled={!billMatter} className="col-span-3 px-3 py-1.5 text-xs rounded bg-amber-500 text-black font-bold hover:bg-amber-400 disabled:opacity-40">Generate invoice</button>
      </div>

      <div className="max-h-[28rem] overflow-y-auto">
        {loading ? (
          <div className="flex items-center justify-center py-10 text-xs text-gray-500"><Loader2 className="w-4 h-4 animate-spin mr-2" /> Loading…</div>
        ) : invoices.length === 0 ? (
          <div className="px-3 py-10 text-center text-xs text-gray-500">No invoices in this view.</div>
        ) : (
          <ul className="divide-y divide-white/5">
            {invoices.map(inv => {
              const today = new Date().toISOString().slice(0, 10);
              const overdue = inv.status === 'open' && inv.dueAt < today;
              const isOpen = expanded === inv.id;
              return (
                <li key={inv.id} className="hover:bg-white/[0.02]">
                  <div onClick={() => setExpanded(isOpen ? null : inv.id)} className="px-4 py-2.5 cursor-pointer flex items-center gap-3">
                    <FileText className={cn('w-3.5 h-3.5', inv.status === 'paid' ? 'text-emerald-400' : overdue ? 'text-rose-400' : 'text-amber-400')} />
                    <div className="flex-1 min-w-0">
                      <div className="text-sm text-white flex items-center gap-2">
                        <span className="font-mono text-[10px] text-gray-500">{inv.number}</span>
                        <span className="truncate">{inv.matterName}</span>
                        {overdue && <span className="text-[9px] uppercase text-rose-300">Overdue</span>}
                      </div>
                      <div className="text-[10px] text-gray-500">{inv.clientName || '—'} · {inv.lineItems.length} time entries · issued {inv.issuedAt}</div>
                    </div>
                    <div className="text-sm font-mono tabular-nums text-white w-24 text-right">${inv.total.toFixed(2)}</div>
                    {inv.status === 'open' ? (
                      <button onClick={(e) => { e.stopPropagation(); markPaid(inv.id); }} className="px-2 py-1 text-[10px] rounded bg-emerald-500 text-black font-bold hover:bg-emerald-400 inline-flex items-center gap-1">
                        <CheckCircle className="w-3 h-3" />Mark paid
                      </button>
                    ) : (
                      <span className="text-[10px] text-emerald-400 inline-flex items-center gap-0.5"><CheckCircle className="w-3 h-3" />paid</span>
                    )}
                  </div>
                  {isOpen && (
                    <div className="px-4 pb-3 bg-black/30">
                      <table className="w-full text-xs">
                        <thead className="text-[10px] uppercase text-gray-500 border-b border-white/5">
                          <tr><th className="text-left py-1">Date</th><th className="text-left">Description</th><th className="text-right">Hours</th><th className="text-right">Rate</th><th className="text-right">Amount</th></tr>
                        </thead>
                        <tbody className="divide-y divide-white/5">
                          {inv.lineItems.map(li => (
                            <tr key={li.entryId}>
                              <td className="py-1 text-gray-500 font-mono">{li.date}</td>
                              <td className="text-white">{li.description || <span className="italic text-gray-500">(no description)</span>}</td>
                              <td className="text-right font-mono text-gray-400">{li.hours.toFixed(2)}</td>
                              <td className="text-right font-mono text-gray-400">${li.rate}</td>
                              <td className="text-right font-mono text-white">${li.amount.toFixed(2)}</td>
                            </tr>
                          ))}
                          <tr className="border-t border-white/10">
                            <td colSpan={4} className="py-1 text-right text-gray-400">Subtotal</td>
                            <td className="text-right font-mono text-white">${inv.subtotal.toFixed(2)}</td>
                          </tr>
                          {inv.tax > 0 && (
                            <tr>
                              <td colSpan={4} className="py-1 text-right text-gray-400">Tax</td>
                              <td className="text-right font-mono text-white">${inv.tax.toFixed(2)}</td>
                            </tr>
                          )}
                          <tr>
                            <td colSpan={4} className="py-1 text-right text-amber-200 font-semibold">Total</td>
                            <td className="text-right font-mono text-amber-200 font-bold">${inv.total.toFixed(2)}</td>
                          </tr>
                        </tbody>
                      </table>
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
