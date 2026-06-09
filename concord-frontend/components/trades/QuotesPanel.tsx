'use client';

import { useEffect, useState } from 'react';
import { FileText, Plus, Loader2, Send, Check, X } from 'lucide-react';
import { lensRun } from '@/lib/api/client';
import { cn } from '@/lib/utils';

interface LineItem { desc: string; qty: number; unitPrice: number }
interface Quote {
  id: string; customerId: string; title: string; description: string;
  lineItems: LineItem[]; subtotal: number; tax: number; total: number;
  status: 'draft' | 'sent' | 'accepted' | 'rejected';
  createdAt: string;
}

const STATUS_COLOUR: Record<Quote['status'], string> = {
  draft: 'bg-gray-500/15 text-gray-300',
  sent: 'bg-amber-500/15 text-amber-300',
  accepted: 'bg-emerald-500/15 text-emerald-300',
  rejected: 'bg-rose-500/15 text-rose-300',
};

export function QuotesPanel() {
  const [quotes, setQuotes] = useState<Quote[]>([]);
  const [loading, setLoading] = useState(true);
  const [creating, setCreating] = useState(false);
  const [form, setForm] = useState({ customerId: '', title: '', taxRate: '8' });
  const [lines, setLines] = useState<LineItem[]>([{ desc: '', qty: 1, unitPrice: 0 }]);

  useEffect(() => { refresh(); }, []);

  async function refresh() {
    setLoading(true);
    try {
      const res = await lensRun({ domain: 'trades', action: 'quotes-list', input: {} });
      setQuotes((res.data?.result?.quotes || []) as Quote[]);
    } catch (e) { console.error('[Quotes] failed', e); }
    finally { setLoading(false); }
  }

  function setLine(i: number, key: keyof LineItem, val: string | number) {
    setLines(prev => prev.map((l, idx) => idx === i ? { ...l, [key]: val } : l));
  }

  async function create() {
    const validLines = lines.filter(l => l.desc.trim() && l.qty > 0);
    if (!form.customerId.trim() || !form.title.trim() || validLines.length === 0) return;
    try {
      await lensRun({
        domain: 'trades', action: 'quotes-create',
        input: { customerId: form.customerId, title: form.title, lineItems: validLines.map(l => ({ ...l, qty: Number(l.qty), unitPrice: Number(l.unitPrice) })), taxRate: Number(form.taxRate) || 0 },
      });
      setForm({ customerId: '', title: '', taxRate: '8' });
      setLines([{ desc: '', qty: 1, unitPrice: 0 }]);
      setCreating(false);
      await refresh();
    } catch (e) { console.error('[Quotes] create', e); }
  }

  async function action(id: string, act: 'send' | 'accept' | 'reject') {
    try {
      await lensRun({ domain: 'trades', action: `quotes-${act}`, input: { id } });
      await refresh();
    } catch (e) { console.error('[Quotes]', act, e); }
  }

  return (
    <div className="bg-[#0d1117] border border-violet-500/20 rounded-lg overflow-hidden">
      <header className="px-4 py-2 border-b border-white/10 flex items-center gap-2">
        <FileText className="w-4 h-4 text-violet-400" />
        <span className="text-xs uppercase font-semibold text-gray-300 tracking-wider">Quotes & estimates</span>
        <span className="ml-auto text-[10px] text-gray-400">{quotes.length}</span>
        <button aria-label="Add" onClick={() => setCreating(v => !v)} className="p-1 text-gray-400 hover:text-white"><Plus className="w-4 h-4" /></button>
      </header>

      {creating && (
        <div className="p-3 border-b border-white/10 space-y-2">
          <div className="grid grid-cols-4 gap-2">
            <input value={form.customerId} onChange={e => setForm({ ...form, customerId: e.target.value })} placeholder="Customer ID" className="px-2 py-1.5 text-xs bg-lattice-deep border border-lattice-border rounded text-white font-mono" />
            <input value={form.title} onChange={e => setForm({ ...form, title: e.target.value })} placeholder="Title" className="col-span-2 px-2 py-1.5 text-xs bg-lattice-deep border border-lattice-border rounded text-white" />
            <input type="number" value={form.taxRate} onChange={e => setForm({ ...form, taxRate: e.target.value })} placeholder="Tax %" className="px-2 py-1.5 text-xs bg-lattice-deep border border-lattice-border rounded text-white" />
          </div>
          {lines.map((l, i) => (
            <div key={i} className="grid grid-cols-6 gap-2">
              <input value={l.desc} onChange={e => setLine(i, 'desc', e.target.value)} placeholder="Description" className="col-span-3 px-2 py-1 text-xs bg-lattice-deep border border-lattice-border rounded text-white" />
              <input type="number" value={l.qty} onChange={e => setLine(i, 'qty', Number(e.target.value))} placeholder="Qty" className="px-2 py-1 text-xs bg-lattice-deep border border-lattice-border rounded text-white" />
              <input type="number" value={l.unitPrice} onChange={e => setLine(i, 'unitPrice', Number(e.target.value))} placeholder="Unit $" className="px-2 py-1 text-xs bg-lattice-deep border border-lattice-border rounded text-white" />
              <button onClick={() => setLines(prev => prev.filter((_, idx) => idx !== i))} className="text-rose-400 hover:text-rose-300 text-xs">×</button>
            </div>
          ))}
          <div className="flex items-center gap-2">
            <button onClick={() => setLines(prev => [...prev, { desc: '', qty: 1, unitPrice: 0 }])} className="px-2 py-1 text-xs rounded bg-violet-500/30 text-violet-300 hover:bg-violet-500/50">+ Line</button>
            <button onClick={create} className="ml-auto px-3 py-1.5 text-xs rounded bg-violet-500 text-white font-bold hover:bg-violet-400">Create quote</button>
          </div>
        </div>
      )}

      <div className="max-h-80 overflow-y-auto">
        {loading ? (
          <div className="flex items-center justify-center py-6 text-xs text-gray-400"><Loader2 className="w-4 h-4 animate-spin mr-2" /> Loading…</div>
        ) : quotes.length === 0 ? (
          <div className="px-3 py-10 text-center text-xs text-gray-400"><FileText className="w-6 h-6 mx-auto mb-2 opacity-30" />No quotes yet.</div>
        ) : (
          <ul className="divide-y divide-white/5">
            {quotes.map(q => (
              <li key={q.id} className="px-3 py-2 hover:bg-white/[0.03] group">
                <div className="flex items-center gap-2">
                  <span className="text-sm text-white font-medium flex-1 truncate">{q.title}</span>
                  <span className={cn('text-[9px] uppercase tracking-wider px-1.5 py-0.5 rounded', STATUS_COLOUR[q.status])}>{q.status}</span>
                  <span className="font-mono text-sm tabular-nums text-violet-300">${q.total.toFixed(2)}</span>
                  {q.status === 'draft' && <button onClick={() => action(q.id, 'send')} className="p-1 text-cyan-400 hover:text-cyan-300" title="Send"><Send className="w-3 h-3" /></button>}
                  {q.status === 'sent' && (
                    <>
                      <button onClick={() => action(q.id, 'accept')} className="p-1 text-emerald-400 hover:text-emerald-300" title="Accept"><Check className="w-3 h-3" /></button>
                      <button onClick={() => action(q.id, 'reject')} className="p-1 text-rose-400 hover:text-rose-300" title="Reject"><X className="w-3 h-3" /></button>
                    </>
                  )}
                </div>
                <div className="text-[10px] text-gray-400 mt-0.5">{q.lineItems.length} line{q.lineItems.length === 1 ? '' : 's'} · subtotal ${q.subtotal.toFixed(2)} + ${q.tax.toFixed(2)} tax</div>
              </li>
            ))}
          </ul>
        )}
      </div>
    </div>
  );
}

export default QuotesPanel;
