'use client';

/* eslint-disable react-hooks/exhaustive-deps */

/**
 * EstimateInvoiceFlow — labor + materials estimate builder that converts
 * to a tracked invoice. Material lines pull from the user's price list
 * (electrical.priceListGet). Persists via the electrical.estimate*,
 * electrical.invoice* and electrical.priceList* macros.
 */

import { useState, useEffect, useCallback } from 'react';
import { useMutation } from '@tanstack/react-query';
import { Receipt, FileText, Plus, Trash2, Loader2, ArrowRight, CheckCircle2, Package } from 'lucide-react';
import { lensRun } from '@/lib/api/client';

interface LaborLine { id: string; description: string; hours: number; rate: number }
interface MaterialLine { id: string; description: string; quantity: number; unitPrice: number; unit: string }
interface Estimate {
  id: string; client: string; address: string; title: string; status: string;
  laborLines: LaborLine[]; materialLines: MaterialLine[]; taxRate: number; invoiceId: string | null;
  laborTotal?: number; materialTotal?: number; subtotal?: number; tax?: number; total?: number;
}
interface Invoice {
  id: string; invoiceNumber: string; client: string; title: string;
  status: string; total: number; issuedDate: string; dueDate: string | null; paidDate: string | null;
}
interface MaterialPrice { id: string; name: string; unit: string; price: number; category: string }

export function EstimateInvoiceFlow() {
  const [estimates, setEstimates] = useState<Estimate[]>([]);
  const [invoices, setInvoices] = useState<Invoice[]>([]);
  const [invSummary, setInvSummary] = useState<{ count: number; totalBilled: number; outstanding: number; paid: number } | null>(null);
  const [priceList, setPriceList] = useState<MaterialPrice[]>([]);
  const [activeId, setActiveId] = useState<string | null>(null);
  const [view, setView] = useState<'estimates' | 'invoices'>('estimates');
  const [showNew, setShowNew] = useState(false);
  const [newEst, setNewEst] = useState({ client: '', address: '', title: '', taxRate: '0' });
  const [labor, setLabor] = useState({ description: '', hours: '', rate: '95' });
  const [material, setMaterial] = useState({ priceId: '', description: '', quantity: '1', unitPrice: '', unit: 'each' });

  const refreshEstimates = useCallback(async () => {
    const r = await lensRun<{ estimates: Estimate[] }>('electrical', 'estimateList', {});
    setEstimates(r.data.result?.estimates || []);
  }, []);
  const refreshInvoices = useCallback(async () => {
    const r = await lensRun<{ invoices: Invoice[]; summary: typeof invSummary }>('electrical', 'invoiceList', {});
    setInvoices(r.data.result?.invoices || []);
    setInvSummary(r.data.result?.summary || null);
  }, []);
  const refreshPrices = useCallback(async () => {
    const r = await lensRun<{ materials: MaterialPrice[] }>('electrical', 'priceListGet', {});
    setPriceList(r.data.result?.materials || []);
  }, []);

  useEffect(() => { refreshEstimates(); refreshInvoices(); refreshPrices(); }, []);

  const active = estimates.find((e) => e.id === activeId) || null;

  const createEstimate = useMutation({
    mutationFn: async () => {
      const r = await lensRun<Estimate>('electrical', 'estimateCreate', {
        client: newEst.client || 'New Client',
        address: newEst.address,
        title: newEst.title || 'Electrical Estimate',
        taxRate: parseFloat(newEst.taxRate) || 0,
      });
      await refreshEstimates();
      if (r.data.result) setActiveId(r.data.result.id);
      setShowNew(false);
      setNewEst({ client: '', address: '', title: '', taxRate: '0' });
    },
  });

  const addLabor = useMutation({
    mutationFn: async () => {
      if (!activeId) return;
      await lensRun('electrical', 'estimateAddLine', {
        estimateId: activeId, lineType: 'labor',
        description: labor.description || 'Labor',
        hours: parseFloat(labor.hours) || 0,
        rate: parseFloat(labor.rate) || 0,
      });
      setLabor({ description: '', hours: '', rate: labor.rate });
      await refreshEstimates();
    },
  });

  const addMaterial = useMutation({
    mutationFn: async () => {
      if (!activeId) return;
      await lensRun('electrical', 'estimateAddLine', {
        estimateId: activeId, lineType: 'material',
        description: material.description || 'Material',
        quantity: parseFloat(material.quantity) || 0,
        unitPrice: parseFloat(material.unitPrice) || 0,
        unit: material.unit,
      });
      setMaterial({ priceId: '', description: '', quantity: '1', unitPrice: '', unit: 'each' });
      await refreshEstimates();
    },
  });

  const removeLine = useMutation({
    mutationFn: async (lineId: string) => {
      if (!activeId) return;
      await lensRun('electrical', 'estimateRemoveLine', { estimateId: activeId, lineId });
      await refreshEstimates();
    },
  });

  const deleteEstimate = useMutation({
    mutationFn: async (estimateId: string) => {
      await lensRun('electrical', 'estimateDelete', { estimateId });
      setActiveId(null);
      await refreshEstimates();
    },
  });

  const convertToInvoice = useMutation({
    mutationFn: async () => {
      if (!activeId) return;
      await lensRun('electrical', 'estimateToInvoice', { estimateId: activeId });
      await refreshEstimates();
      await refreshInvoices();
      setView('invoices');
    },
  });

  const markPaid = useMutation({
    mutationFn: async (invoiceId: string) => {
      await lensRun('electrical', 'invoiceMarkPaid', { invoiceId });
      await refreshInvoices();
    },
  });

  const onPickMaterial = (priceId: string) => {
    const mp = priceList.find((m) => m.id === priceId);
    setMaterial((m) => ({
      ...m, priceId,
      description: mp ? mp.name : m.description,
      unitPrice: mp ? String(mp.price) : m.unitPrice,
      unit: mp ? mp.unit : m.unit,
    }));
  };

  return (
    <div className="overflow-hidden rounded-xl border border-teal-500/20 bg-gradient-to-br from-zinc-950 via-teal-950/10 to-zinc-950">
      <header className="flex items-center justify-between border-b border-teal-500/20 bg-zinc-900/40 px-4 py-2">
        <div className="flex items-center gap-2">
          <Receipt className="h-4 w-4 text-teal-400" />
          <span className="text-sm font-semibold text-white">Estimate &rarr; invoice</span>
          <span className="rounded bg-zinc-800 px-1.5 py-0.5 font-mono text-[10px] text-zinc-400">electrical.estimate*</span>
        </div>
        <div className="flex gap-1">
          <button type="button" onClick={() => setView('estimates')} className={`rounded px-2 py-1 text-xs ${view === 'estimates' ? 'bg-teal-500/20 text-teal-200' : 'text-zinc-400 hover:text-white'}`}>Estimates</button>
          <button type="button" onClick={() => setView('invoices')} className={`rounded px-2 py-1 text-xs ${view === 'invoices' ? 'bg-teal-500/20 text-teal-200' : 'text-zinc-400 hover:text-white'}`}>Invoices</button>
        </div>
      </header>

      <div className="p-4 space-y-3">
        {view === 'estimates' && (
          <>
            <div className="flex items-center justify-between">
              <div className="flex flex-wrap gap-1.5">
                {estimates.map((e) => (
                  <button key={e.id} type="button" onClick={() => setActiveId(e.id)} className={`rounded px-2.5 py-1 text-xs ${activeId === e.id ? 'bg-teal-500/20 text-teal-200 border border-teal-500/40' : 'border border-zinc-800 text-zinc-400 hover:text-white'}`}>
                    {e.client} <span className="font-mono text-[10px] text-zinc-400">${(e.total || 0).toFixed(0)}</span>
                    {e.status === 'invoiced' && <span className="ml-1 text-[9px] text-emerald-400">&#10003;</span>}
                  </button>
                ))}
              </div>
              <button type="button" onClick={() => setShowNew((s) => !s)} className="inline-flex items-center gap-1 rounded bg-teal-500 px-2 py-1 text-xs font-semibold text-black hover:bg-teal-400"><Plus className="h-3 w-3" />New</button>
            </div>

            {showNew && (
              <div className="grid grid-cols-2 gap-2 rounded-lg border border-teal-500/15 bg-zinc-950/40 p-3">
                <input value={newEst.client} onChange={(e) => setNewEst({ ...newEst, client: e.target.value })} placeholder="Client name" className="rounded border border-zinc-800 bg-zinc-950 px-2 py-1 text-xs text-white" />
                <input value={newEst.title} onChange={(e) => setNewEst({ ...newEst, title: e.target.value })} placeholder="Job title" className="rounded border border-zinc-800 bg-zinc-950 px-2 py-1 text-xs text-white" />
                <input value={newEst.address} onChange={(e) => setNewEst({ ...newEst, address: e.target.value })} placeholder="Service address" className="rounded border border-zinc-800 bg-zinc-950 px-2 py-1 text-xs text-white" />
                <div className="flex gap-2">
                  <input type="number" value={newEst.taxRate} onChange={(e) => setNewEst({ ...newEst, taxRate: e.target.value })} placeholder="Tax %" className="w-20 rounded border border-zinc-800 bg-zinc-950 px-2 py-1 text-xs text-white font-mono" />
                  <button type="button" onClick={() => createEstimate.mutate()} disabled={createEstimate.isPending} className="flex-1 rounded bg-teal-500 px-2 py-1 text-xs font-semibold text-black hover:bg-teal-400 disabled:opacity-50">
                    {createEstimate.isPending ? <Loader2 className="mx-auto h-3.5 w-3.5 animate-spin" /> : 'Create estimate'}
                  </button>
                </div>
              </div>
            )}

            {estimates.length === 0 && !showNew && <div className="rounded border border-dashed border-zinc-800 p-6 text-center text-[11px] text-zinc-400">No estimates yet. Create one to build labor + material line items.</div>}

            {active && (
              <div className="space-y-3">
                <div className="rounded-lg border border-teal-500/15 bg-zinc-950/40 p-2">
                  <div className="text-[11px] font-semibold text-teal-200">{active.title} — {active.client}</div>
                  {active.address && <div className="text-[10px] text-zinc-400">{active.address}</div>}
                </div>

                {/* labor lines */}
                <div className="space-y-1">
                  <div className="text-[10px] uppercase tracking-wider text-zinc-400">Labor</div>
                  {active.laborLines.map((l) => (
                    <div key={l.id} className="grid grid-cols-[1fr_56px_56px_72px_28px] gap-1.5 rounded border border-teal-500/10 bg-zinc-950/40 px-2 py-1 text-[10px]">
                      <span className="truncate text-zinc-100">{l.description}</span>
                      <span className="font-mono text-zinc-400">{l.hours}h</span>
                      <span className="font-mono text-zinc-400">${l.rate}</span>
                      <span className="font-mono text-teal-200">${(l.hours * l.rate).toFixed(2)}</span>
                      <button aria-label="Delete" type="button" onClick={() => removeLine.mutate(l.id)} className="text-zinc-600 hover:text-rose-300"><Trash2 className="mx-auto h-3 w-3" /></button>
                    </div>
                  ))}
                  <div className="grid grid-cols-[1fr_56px_56px_72px] gap-1.5">
                    <input value={labor.description} onChange={(e) => setLabor({ ...labor, description: e.target.value })} placeholder="Labor description" className="rounded border border-zinc-800 bg-zinc-950 px-1.5 py-1 text-[11px] text-white" />
                    <input type="number" value={labor.hours} onChange={(e) => setLabor({ ...labor, hours: e.target.value })} placeholder="Hrs" className="rounded border border-zinc-800 bg-zinc-950 px-1.5 py-1 text-[11px] text-white font-mono" />
                    <input type="number" value={labor.rate} onChange={(e) => setLabor({ ...labor, rate: e.target.value })} placeholder="Rate" className="rounded border border-zinc-800 bg-zinc-950 px-1.5 py-1 text-[11px] text-white font-mono" />
                    <button type="button" onClick={() => addLabor.mutate()} disabled={addLabor.isPending || !labor.hours} className="rounded bg-teal-500/80 px-2 py-1 text-[11px] font-semibold text-black hover:bg-teal-400 disabled:opacity-50">Add</button>
                  </div>
                </div>

                {/* material lines */}
                <div className="space-y-1">
                  <div className="flex items-center gap-1 text-[10px] uppercase tracking-wider text-zinc-400"><Package className="h-3 w-3" />Materials</div>
                  {active.materialLines.map((m) => (
                    <div key={m.id} className="grid grid-cols-[1fr_56px_64px_72px_28px] gap-1.5 rounded border border-teal-500/10 bg-zinc-950/40 px-2 py-1 text-[10px]">
                      <span className="truncate text-zinc-100">{m.description}</span>
                      <span className="font-mono text-zinc-400">{m.quantity} {m.unit}</span>
                      <span className="font-mono text-zinc-400">${m.unitPrice}</span>
                      <span className="font-mono text-teal-200">${(m.quantity * m.unitPrice).toFixed(2)}</span>
                      <button aria-label="Delete" type="button" onClick={() => removeLine.mutate(m.id)} className="text-zinc-600 hover:text-rose-300"><Trash2 className="mx-auto h-3 w-3" /></button>
                    </div>
                  ))}
                  <div className="grid grid-cols-[1fr_56px_64px_72px] gap-1.5">
                    <select value={material.priceId} onChange={(e) => onPickMaterial(e.target.value)} className="rounded border border-zinc-800 bg-zinc-950 px-1.5 py-1 text-[11px] text-white">
                      <option value="">— pick from price list —</option>
                      {priceList.map((mp) => <option key={mp.id} value={mp.id}>{mp.name} (${mp.price}/{mp.unit})</option>)}
                    </select>
                    <input type="number" value={material.quantity} onChange={(e) => setMaterial({ ...material, quantity: e.target.value })} placeholder="Qty" className="rounded border border-zinc-800 bg-zinc-950 px-1.5 py-1 text-[11px] text-white font-mono" />
                    <input type="number" value={material.unitPrice} onChange={(e) => setMaterial({ ...material, unitPrice: e.target.value, priceId: '' })} placeholder="$/unit" className="rounded border border-zinc-800 bg-zinc-950 px-1.5 py-1 text-[11px] text-white font-mono" />
                    <button type="button" onClick={() => addMaterial.mutate()} disabled={addMaterial.isPending || !material.unitPrice} className="rounded bg-teal-500/80 px-2 py-1 text-[11px] font-semibold text-black hover:bg-teal-400 disabled:opacity-50">Add</button>
                  </div>
                </div>

                {/* totals */}
                <div className="rounded-lg border border-teal-500/20 bg-teal-500/5 p-2.5 text-[11px]">
                  <div className="flex justify-between text-zinc-400"><span>Labor</span><span className="font-mono">${(active.laborTotal || 0).toFixed(2)}</span></div>
                  <div className="flex justify-between text-zinc-400"><span>Materials</span><span className="font-mono">${(active.materialTotal || 0).toFixed(2)}</span></div>
                  <div className="flex justify-between text-zinc-300"><span>Subtotal</span><span className="font-mono">${(active.subtotal || 0).toFixed(2)}</span></div>
                  <div className="flex justify-between text-zinc-400"><span>Tax ({active.taxRate}%)</span><span className="font-mono">${(active.tax || 0).toFixed(2)}</span></div>
                  <div className="mt-1 flex justify-between border-t border-teal-500/20 pt-1 text-sm font-bold text-teal-100"><span>Total</span><span className="font-mono">${(active.total || 0).toFixed(2)}</span></div>
                </div>

                <div className="flex items-center gap-2">
                  {active.invoiceId ? (
                    <span className="inline-flex items-center gap-1 rounded bg-emerald-500/15 px-2 py-1 text-[11px] text-emerald-300"><CheckCircle2 className="h-3 w-3" />Converted to invoice</span>
                  ) : (
                    <button type="button" onClick={() => convertToInvoice.mutate()} disabled={convertToInvoice.isPending || ((active.subtotal || 0) <= 0)} className="inline-flex items-center gap-1 rounded bg-emerald-500 px-3 py-1 text-xs font-semibold text-black hover:bg-emerald-400 disabled:opacity-50">
                      {convertToInvoice.isPending ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <>Convert to invoice<ArrowRight className="h-3 w-3" /></>}
                    </button>
                  )}
                  <button type="button" onClick={() => deleteEstimate.mutate(active.id)} className="text-[10px] text-zinc-400 hover:text-rose-400">Delete estimate</button>
                </div>
              </div>
            )}
          </>
        )}

        {view === 'invoices' && (
          <>
            {invSummary && (
              <div className="grid grid-cols-3 gap-2 text-[11px]">
                <div className="rounded border border-teal-500/15 bg-zinc-950/40 px-2 py-1.5"><div className="text-[9px] text-zinc-400">Total billed</div><div className="font-mono text-teal-200">${invSummary.totalBilled.toFixed(2)}</div></div>
                <div className="rounded border border-amber-500/20 bg-amber-500/5 px-2 py-1.5"><div className="text-[9px] text-amber-300">Outstanding</div><div className="font-mono text-amber-200">${invSummary.outstanding.toFixed(2)}</div></div>
                <div className="rounded border border-emerald-500/20 bg-emerald-500/5 px-2 py-1.5"><div className="text-[9px] text-emerald-300">Paid</div><div className="font-mono text-emerald-200">${invSummary.paid.toFixed(2)}</div></div>
              </div>
            )}
            {invoices.length === 0 && <div className="rounded border border-dashed border-zinc-800 p-6 text-center text-[11px] text-zinc-400">No invoices yet. Convert an estimate to generate one.</div>}
            {invoices.map((inv) => (
              <div key={inv.id} className="flex items-center justify-between rounded-lg border border-teal-500/10 bg-zinc-950/40 px-3 py-2">
                <div className="flex items-center gap-2">
                  <FileText className="h-4 w-4 text-teal-400" />
                  <div>
                    <div className="text-[11px] font-semibold text-white">{inv.invoiceNumber} — {inv.client}</div>
                    <div className="text-[10px] text-zinc-400">{inv.title} · issued {new Date(inv.issuedDate).toLocaleDateString()}</div>
                  </div>
                </div>
                <div className="flex items-center gap-2">
                  <span className="font-mono text-sm text-teal-100">${inv.total.toFixed(2)}</span>
                  {inv.status === 'paid' ? (
                    <span className="rounded bg-emerald-500/15 px-2 py-0.5 text-[10px] text-emerald-300">Paid</span>
                  ) : (
                    <button type="button" onClick={() => markPaid.mutate(inv.id)} disabled={markPaid.isPending} className="rounded bg-emerald-500 px-2 py-0.5 text-[10px] font-semibold text-black hover:bg-emerald-400 disabled:opacity-50">Mark paid</button>
                  )}
                </div>
              </div>
            ))}
          </>
        )}
      </div>
    </div>
  );
}
