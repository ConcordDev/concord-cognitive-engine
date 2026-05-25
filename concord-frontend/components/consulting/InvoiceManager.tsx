'use client';

/**
 * InvoiceManager — generate invoices from logged time, mark paid,
 * export a printable document, and track outstanding / overdue / collected
 * totals. Wires consulting.invoice-create / invoice-list / invoice-mark-paid
 * / invoice-delete / invoice-export.
 */

import { useCallback, useEffect, useState } from 'react';
import { FileText, Loader2, Trash2, Check, Download, Plus } from 'lucide-react';
import { lensRun } from '@/lib/api/client';

interface LineItem { timeEntryId: string; hours: number; date: string; note: string; rate: number; amount: number }
interface Invoice {
  id: string; number: string; engagementId: string; engagementName: string; client: string;
  lineItems: LineItem[]; subtotal: number; taxRate: number; tax: number; total: number;
  status: string; issuedAt: string; dueDate: string; paidAt: string | null;
}
interface EngagementOption { id: string; name: string }

const STATUS_COLOR: Record<string, string> = {
  sent: 'text-sky-400 bg-sky-500/10',
  paid: 'text-emerald-400 bg-emerald-500/10',
  overdue: 'text-rose-400 bg-rose-500/10',
};

export function InvoiceManager({ engagements }: { engagements: EngagementOption[] }) {
  const [invoices, setInvoices] = useState<Invoice[]>([]);
  const [totals, setTotals] = useState({ outstanding: 0, overdue: 0, collected: 0 });
  const [loading, setLoading] = useState(true);
  const [engId, setEngId] = useState('');
  const [taxRate, setTaxRate] = useState('');
  const [dueInDays, setDueInDays] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [exportDoc, setExportDoc] = useState<{ number: string; text: string } | null>(null);

  const refresh = useCallback(async () => {
    const r = await lensRun('consulting', 'invoice-list', {});
    const res = r.data?.result as { invoices?: Invoice[]; outstanding?: number; overdue?: number; collected?: number } | null;
    setInvoices(res?.invoices || []);
    setTotals({ outstanding: res?.outstanding || 0, overdue: res?.overdue || 0, collected: res?.collected || 0 });
    setLoading(false);
  }, []);
  useEffect(() => { void refresh(); }, [refresh]);

  async function generate() {
    if (!engId) { setError('Pick an engagement'); return; }
    setBusy(true); setError('');
    const r = await lensRun('consulting', 'invoice-create', {
      engagementId: engId,
      taxRate: taxRate ? Number(taxRate) / 100 : 0,
      dueInDays: dueInDays ? Number(dueInDays) : 30,
    });
    setBusy(false);
    if (!r.data?.ok) { setError(r.data?.error || 'No unbilled time to invoice'); return; }
    setEngId(''); setTaxRate(''); setDueInDays('');
    await refresh();
  }
  async function markPaid(id: string) {
    await lensRun('consulting', 'invoice-mark-paid', { id });
    await refresh();
  }
  async function del(id: string) {
    await lensRun('consulting', 'invoice-delete', { id });
    await refresh();
  }
  async function exportInvoice(inv: Invoice) {
    const r = await lensRun('consulting', 'invoice-export', { id: inv.id });
    const res = r.data?.result as { document?: string } | null;
    if (res?.document) setExportDoc({ number: inv.number, text: res.document });
  }
  function downloadDoc() {
    if (!exportDoc) return;
    const blob = new Blob([exportDoc.text], { type: 'text/plain' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url; a.download = `${exportDoc.number}.txt`;
    a.click();
    URL.revokeObjectURL(url);
  }

  if (loading) return <div className="flex justify-center py-6 text-zinc-400"><Loader2 className="w-4 h-4 animate-spin" /></div>;

  return (
    <div className="space-y-3">
      <div className="grid grid-cols-3 gap-2">
        {([['Outstanding', totals.outstanding, 'text-amber-400'], ['Overdue', totals.overdue, 'text-rose-400'], ['Collected', totals.collected, 'text-emerald-400']] as const).map(([l, v, c]) => (
          <div key={l} className="bg-zinc-900/60 border border-zinc-800 rounded-lg px-3 py-2 text-center">
            <p className={`text-base font-bold ${c}`}>${v.toLocaleString()}</p>
            <p className="text-[10px] text-zinc-400 uppercase tracking-wide">{l}</p>
          </div>
        ))}
      </div>

      <div className="bg-zinc-900/60 border border-zinc-800 rounded-lg p-3 flex flex-wrap items-end gap-2">
        <div className="flex-1 min-w-[160px]">
          <label className="block text-[10px] text-zinc-400 mb-1 uppercase">Engagement</label>
          <select value={engId} onChange={e => setEngId(e.target.value)}
            className="w-full bg-zinc-950 border border-zinc-800 rounded px-2 py-1 text-xs text-zinc-200">
            <option value="">Select engagement…</option>
            {engagements.map(e => <option key={e.id} value={e.id}>{e.name}</option>)}
          </select>
        </div>
        <div className="w-20">
          <label className="block text-[10px] text-zinc-400 mb-1 uppercase">Tax %</label>
          <input value={taxRate} onChange={e => setTaxRate(e.target.value)} placeholder="0"
            className="w-full bg-zinc-950 border border-zinc-800 rounded px-2 py-1 text-xs text-zinc-200" />
        </div>
        <div className="w-24">
          <label className="block text-[10px] text-zinc-400 mb-1 uppercase">Net days</label>
          <input value={dueInDays} onChange={e => setDueInDays(e.target.value)} placeholder="30"
            className="w-full bg-zinc-950 border border-zinc-800 rounded px-2 py-1 text-xs text-zinc-200" />
        </div>
        <button onClick={generate} disabled={busy}
          className="px-3 py-1.5 text-xs rounded bg-indigo-600 hover:bg-indigo-500 text-white font-semibold disabled:opacity-40 inline-flex items-center gap-1">
          {busy ? <Loader2 className="w-3 h-3 animate-spin" /> : <Plus className="w-3 h-3" />}Generate
        </button>
      </div>
      {error && <p className="text-[11px] text-rose-400">{error}</p>}

      <ul className="space-y-1.5">
        {invoices.length === 0 && <li className="text-xs text-zinc-400 italic py-3 text-center">No invoices yet — log time on an engagement, then generate.</li>}
        {invoices.map(inv => (
          <li key={inv.id} className="bg-zinc-900/60 border border-zinc-800 rounded-lg px-3 py-2">
            <div className="group flex items-center gap-2">
              <FileText className="w-4 h-4 text-indigo-400 shrink-0" />
              <div className="min-w-0 flex-1">
                <p className="text-xs font-semibold text-zinc-100 truncate">{inv.number} · {inv.client}</p>
                <p className="text-[10px] text-zinc-400">{inv.engagementName} · {inv.lineItems.length} items · issued {inv.issuedAt} · due {inv.dueDate}</p>
              </div>
              <span className="text-sm font-bold text-zinc-100">${inv.total.toLocaleString()}</span>
              <span className={`text-[10px] px-1.5 py-0.5 rounded-full font-semibold uppercase ${STATUS_COLOR[inv.status] || 'text-zinc-400 bg-zinc-800'}`}>{inv.status}</span>
              <button onClick={() => exportInvoice(inv)} aria-label="Export" className="text-zinc-400 hover:text-indigo-400"><Download className="w-3.5 h-3.5" /></button>
              {inv.status !== 'paid' && (
                <button onClick={() => markPaid(inv.id)} aria-label="Mark paid" className="text-zinc-400 hover:text-emerald-400"><Check className="w-3.5 h-3.5" /></button>
              )}
              <button onClick={() => del(inv.id)} aria-label="Delete" className="opacity-0 group-hover:opacity-100 text-rose-400"><Trash2 className="w-3.5 h-3.5" /></button>
            </div>
          </li>
        ))}
      </ul>

      {exportDoc && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm" onClick={() => setExportDoc(null)} role="button" tabIndex={0} onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); (e.currentTarget as HTMLElement).click(); } }}>
          <div className="w-full max-w-md bg-zinc-950 border border-zinc-800 rounded-xl p-4" onClick={e => e.stopPropagation()} role="button" tabIndex={0} onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); (e.currentTarget as HTMLElement).click(); } }}>
            <div className="flex items-center justify-between mb-2">
              <h4 className="text-sm font-bold text-zinc-100">{exportDoc.number}</h4>
              <button onClick={downloadDoc} className="px-2 py-1 text-xs rounded bg-indigo-600 hover:bg-indigo-500 text-white inline-flex items-center gap-1">
                <Download className="w-3 h-3" />Download
              </button>
            </div>
            <pre className="text-[11px] text-zinc-300 bg-zinc-900/60 border border-zinc-800 rounded p-3 whitespace-pre-wrap font-mono max-h-[60vh] overflow-y-auto">{exportDoc.text}</pre>
          </div>
        </div>
      )}
    </div>
  );
}
