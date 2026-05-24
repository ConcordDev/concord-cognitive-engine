'use client';

import { useCallback, useEffect, useState } from 'react';
import { UserCircle, Loader2, Check, X, FileText, Receipt, Wrench } from 'lucide-react';
import { lensRun } from '@/lib/api/client';
import { cn } from '@/lib/utils';

interface Customer { id: string; name: string; email: string; phone: string; address: string }
interface PortalJob { number: string; description: string; status: string; scheduledFor: string | null; assignedTech: string | null }
interface PortalQuote { id: string; title: string; total: number; status: string; validUntil: string | null }
interface PortalInvoice { id: string; number: string; total: number; amountPaid: number; status: string; dueDate: string | null }
interface PortalView {
  customer: Customer;
  jobs: PortalJob[];
  quotes: PortalQuote[];
  invoices: PortalInvoice[];
  balanceDue: number;
}

export function CustomerPortalPanel() {
  const [customers, setCustomers] = useState<Customer[]>([]);
  const [selected, setSelected] = useState('');
  const [view, setView] = useState<PortalView | null>(null);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    (async () => {
      try {
        const r = await lensRun<{ customers: Customer[] }>('trades', 'customer-list', {});
        if (r.data?.ok && r.data.result) setCustomers(r.data.result.customers);
      } catch (e) { console.error('[Portal] customers failed', e); }
    })();
  }, []);

  const loadPortal = useCallback(async (customerId: string) => {
    if (!customerId) { setView(null); return; }
    setLoading(true);
    try {
      const r = await lensRun<PortalView>('trades', 'portal-view', { customerId });
      if (r.data?.ok && r.data.result) setView(r.data.result);
    } catch (e) { console.error('[Portal] view failed', e); }
    finally { setLoading(false); }
  }, []);

  useEffect(() => { loadPortal(selected); }, [selected, loadPortal]);

  async function respond(quoteId: string, decision: 'accept' | 'reject') {
    try {
      const r = await lensRun('trades', 'portal-quote-respond', { id: quoteId, decision });
      if (r.data?.ok) await loadPortal(selected);
    } catch (e) { console.error('[Portal] respond failed', e); }
  }

  return (
    <div className="bg-[#0d1117] border border-sky-500/20 rounded-lg overflow-hidden">
      <header className="px-4 py-2 border-b border-white/10 flex items-center gap-2">
        <UserCircle className="w-4 h-4 text-sky-400" />
        <span className="text-xs uppercase font-semibold text-gray-300 tracking-wider">Customer portal</span>
        <span className="ml-auto text-[10px] text-gray-400">client-facing job / quote / invoice view</span>
      </header>

      <div className="p-3 border-b border-white/10">
        <select value={selected} onChange={e => setSelected(e.target.value)} className="w-full px-2 py-1.5 text-xs bg-black/40 border border-white/10 rounded text-gray-100">
          <option value="">— select a customer to open their portal —</option>
          {customers.map(c => <option key={c.id} value={c.id}>{c.name}</option>)}
        </select>
      </div>

      {!selected ? (
        <div className="px-3 py-10 text-center text-xs text-gray-400">Pick a customer above to preview what they see.</div>
      ) : loading ? (
        <div className="flex items-center justify-center py-10 text-xs text-gray-400"><Loader2 className="w-4 h-4 animate-spin mr-2" /> Loading portal…</div>
      ) : !view ? (
        <div className="px-3 py-10 text-center text-xs text-gray-400">No portal data.</div>
      ) : (
        <div className="p-3 space-y-3">
          <div className="rounded border border-sky-500/20 bg-sky-500/[0.04] p-3">
            <div className="text-sm text-white font-medium">{view.customer.name}</div>
            <div className="text-[10px] text-gray-400">{[view.customer.email, view.customer.phone, view.customer.address].filter(Boolean).join(' · ') || 'no contact info'}</div>
            <div className="mt-1 text-xs">Balance due: <span className={cn('font-mono', view.balanceDue > 0 ? 'text-amber-300' : 'text-emerald-300')}>${view.balanceDue.toFixed(2)}</span></div>
          </div>

          <section>
            <div className="text-[10px] uppercase tracking-wider text-violet-400 mb-1 flex items-center gap-1"><FileText className="w-3 h-3" /> Quotes · {view.quotes.length}</div>
            {view.quotes.length === 0 ? <p className="text-[10px] text-gray-400">No quotes.</p> : (
              <ul className="space-y-1">
                {view.quotes.map(q => (
                  <li key={q.id} className="rounded border border-white/10 bg-black/20 px-2 py-1.5 flex items-center gap-2">
                    <span className="text-xs text-white truncate flex-1">{q.title}</span>
                    <span className="font-mono text-xs text-violet-300">${q.total.toFixed(2)}</span>
                    <span className="text-[9px] uppercase px-1.5 py-0.5 rounded bg-white/5 text-gray-400">{q.status}</span>
                    {(q.status === 'sent' || q.status === 'draft') && (
                      <div className="flex gap-1">
                        <button onClick={() => respond(q.id, 'accept')} className="p-1 rounded bg-emerald-500/15 text-emerald-300 hover:bg-emerald-500/25" aria-label="Accept quote"><Check className="w-3 h-3" /></button>
                        <button onClick={() => respond(q.id, 'reject')} className="p-1 rounded bg-rose-500/15 text-rose-300 hover:bg-rose-500/25" aria-label="Reject quote"><X className="w-3 h-3" /></button>
                      </div>
                    )}
                  </li>
                ))}
              </ul>
            )}
          </section>

          <section>
            <div className="text-[10px] uppercase tracking-wider text-emerald-400 mb-1 flex items-center gap-1"><Receipt className="w-3 h-3" /> Invoices · {view.invoices.length}</div>
            {view.invoices.length === 0 ? <p className="text-[10px] text-gray-400">No invoices.</p> : (
              <ul className="space-y-1">
                {view.invoices.map(inv => (
                  <li key={inv.id} className="rounded border border-white/10 bg-black/20 px-2 py-1.5 flex items-center gap-2">
                    <span className="font-mono text-xs text-emerald-300">{inv.number}</span>
                    <span className="text-[10px] text-gray-400 flex-1">{inv.dueDate ? `due ${inv.dueDate}` : ''}</span>
                    <span className="font-mono text-xs text-white">${inv.total.toFixed(2)}</span>
                    <span className="text-[9px] uppercase px-1.5 py-0.5 rounded bg-white/5 text-gray-400">{inv.status}</span>
                  </li>
                ))}
              </ul>
            )}
          </section>

          <section>
            <div className="text-[10px] uppercase tracking-wider text-cyan-400 mb-1 flex items-center gap-1"><Wrench className="w-3 h-3" /> Jobs · {view.jobs.length}</div>
            {view.jobs.length === 0 ? <p className="text-[10px] text-gray-400">No jobs.</p> : (
              <ul className="space-y-1">
                {view.jobs.map((j, i) => (
                  <li key={j.number + i} className="rounded border border-white/10 bg-black/20 px-2 py-1.5">
                    <div className="flex items-center gap-2">
                      <span className="font-mono text-xs text-cyan-300">{j.number}</span>
                      <span className="text-[9px] uppercase px-1.5 py-0.5 rounded bg-white/5 text-gray-400">{j.status}</span>
                      {j.scheduledFor && <span className="text-[10px] text-gray-400 ml-auto">{j.scheduledFor.replace('T', ' ')}</span>}
                    </div>
                    <div className="text-[11px] text-gray-400 mt-0.5">{j.description}</div>
                  </li>
                ))}
              </ul>
            )}
          </section>
        </div>
      )}
    </div>
  );
}

export default CustomerPortalPanel;
