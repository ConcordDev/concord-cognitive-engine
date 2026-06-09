'use client';

/** AcPurchaseOrdersPanel — purchase orders to vendors, received into bills. */

import { useCallback, useEffect, useState } from 'react';
import { Loader2, Plus, Trash2, PackageCheck } from 'lucide-react';
import { lensRun } from '@/lib/api/client';

interface Vendor { id: string; name: string }
interface POLine { description: string; qty: number; unitCost: number }
interface PO { id: string; number: string; vendorName: string; lines: POLine[]; total: number; status: string }

export function AcPurchaseOrdersPanel() {
  const [pos, setPos] = useState<PO[]>([]);
  const [vendors, setVendors] = useState<Vendor[]>([]);
  const [loading, setLoading] = useState(true);
  const [vendorId, setVendorId] = useState('');
  const [lines, setLines] = useState<{ description: string; qty: string; unitCost: string }[]>([
    { description: '', qty: '1', unitCost: '' },
  ]);

  const refresh = useCallback(async () => {
    setLoading(true);
    const [p, v] = await Promise.all([
      lensRun({ domain: 'accounting', action: 'po-list', input: {} }),
      lensRun({ domain: 'accounting', action: 'vendors-list', input: {} }),
    ]);
    setPos(p.data?.result?.purchaseOrders || []);
    setVendors(v.data?.result?.vendors || []);
    setLoading(false);
  }, []);

  useEffect(() => { void refresh(); }, [refresh]);

  const create = async () => {
    const cleanLines = lines
      .filter((l) => l.description.trim() && Number(l.unitCost) >= 0)
      .map((l) => ({ description: l.description.trim(), qty: Number(l.qty) || 1, unitCost: Number(l.unitCost) || 0 }));
    if (!vendorId || !cleanLines.length) return;
    await lensRun({ domain: 'accounting', action: 'po-create', input: { vendorId, lines: cleanLines } });
    setVendorId('');
    setLines([{ description: '', qty: '1', unitCost: '' }]);
    await refresh();
  };
  const receive = async (id: string) => {
    await lensRun({ domain: 'accounting', action: 'po-receive', input: { id } });
    await refresh();
  };

  if (loading) return <Spin />;

  return (
    <div className="space-y-4 p-1">
      <section className="bg-black/30 border border-white/10 rounded-lg p-3 space-y-2">
        <h3 className="text-xs font-semibold text-gray-300">New purchase order</h3>
        <select value={vendorId} onChange={(e) => setVendorId(e.target.value)} className={inp}>
          <option value="">Select vendor…</option>
          {vendors.map((v) => <option key={v.id} value={v.id}>{v.name}</option>)}
        </select>
        {lines.map((l, i) => (
          <div key={i} className="flex items-center gap-2">
            <input placeholder="Description" value={l.description}
              onChange={(e) => setLines(lines.map((x, j) => (j === i ? { ...x, description: e.target.value } : x)))}
              className={inp} />
            <input placeholder="Qty" value={l.qty}
              onChange={(e) => setLines(lines.map((x, j) => (j === i ? { ...x, qty: e.target.value } : x)))}
              className="w-16 bg-black/40 border border-white/10 rounded px-2 py-1.5 text-xs text-gray-100" />
            <input placeholder="Unit cost" value={l.unitCost}
              onChange={(e) => setLines(lines.map((x, j) => (j === i ? { ...x, unitCost: e.target.value } : x)))}
              className="w-24 bg-black/40 border border-white/10 rounded px-2 py-1.5 text-xs text-gray-100" />
          </div>
        ))}
        <div className="flex items-center gap-2">
          <button type="button" onClick={() => setLines([...lines, { description: '', qty: '1', unitCost: '' }])}
            className="text-[11px] text-gray-400 hover:text-gray-200">+ line</button>
          <div className="flex-1" />
          <button type="button" onClick={create} className={btn}><Plus className="w-3.5 h-3.5" /> Create PO</button>
        </div>
      </section>

      {pos.length === 0 ? <Empty text="No purchase orders." /> : (
        <ul className="space-y-1.5">
          {pos.map((po) => (
            <li key={po.id} className="bg-black/20 border border-white/10 rounded-lg p-2.5">
              <div className="flex items-center gap-2">
                <span className="text-xs font-mono text-emerald-400">{po.number}</span>
                <span className="text-xs text-gray-200 flex-1">{po.vendorName}</span>
                <span className="text-xs text-gray-300">${po.total.toLocaleString()}</span>
                {po.status === 'open' ? (
                  <button type="button" onClick={() => receive(po.id)}
                    className="flex items-center gap-1 text-[10px] px-2 py-0.5 bg-emerald-600 hover:bg-emerald-500 text-white rounded">
                    <PackageCheck className="w-3 h-3" /> Receive
                  </button>
                ) : <span className="text-[10px] text-emerald-400 uppercase">received</span>}
                <button aria-label="Delete" type="button" onClick={() => lensRun({ domain: 'accounting', action: 'po-delete', input: { id: po.id } }).then(refresh)}
                  className="text-gray-600 hover:text-rose-400"><Trash2 className="w-3.5 h-3.5" /></button>
              </div>
              <p className="text-[10px] text-gray-400 mt-0.5">
                {po.lines.map((l) => `${l.qty}× ${l.description}`).join(' · ')}
              </p>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

const inp = 'flex-1 bg-black/40 border border-white/10 rounded px-2 py-1.5 text-xs text-gray-100';
const btn = 'flex items-center justify-center gap-1 bg-emerald-600 hover:bg-emerald-500 text-white text-xs font-medium rounded px-3 py-1.5';
function Spin() { return <div className="flex items-center justify-center py-10 text-gray-400"><Loader2 className="w-5 h-5 animate-spin" /></div>; }
function Empty({ text }: { text: string }) { return <p className="text-[11px] text-gray-400 italic">{text}</p>; }
