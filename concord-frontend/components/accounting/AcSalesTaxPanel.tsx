'use client';

/** AcSalesTaxPanel — sales-tax codes, liability and remittance. */

import { useCallback, useEffect, useState } from 'react';
import { Loader2, Plus, Trash2 } from 'lucide-react';
import { lensRun } from '@/lib/api/client';

interface TaxCode { id: string; name: string; rate: number }

export function AcSalesTaxPanel() {
  const [codes, setCodes] = useState<TaxCode[]>([]);
  const [liability, setLiability] = useState(0);
  const [loading, setLoading] = useState(true);
  const [form, setForm] = useState({ name: '', rate: '' });
  const [payment, setPayment] = useState('');
  const [note, setNote] = useState<string | null>(null);

  const refresh = useCallback(async () => {
    setLoading(true);
    const [c, l] = await Promise.all([
      lensRun({ domain: 'accounting', action: 'tax-code-list', input: {} }),
      lensRun({ domain: 'accounting', action: 'tax-liability', input: {} }),
    ]);
    setCodes(c.data?.result?.taxCodes || []);
    setLiability(l.data?.result?.salesTaxPayable || 0);
    setLoading(false);
  }, []);

  useEffect(() => { void refresh(); }, [refresh]);

  const addCode = async () => {
    if (!form.name.trim()) return;
    await lensRun({ domain: 'accounting', action: 'tax-code-create', input: { name: form.name.trim(), rate: Number(form.rate) || 0 } });
    setForm({ name: '', rate: '' });
    await refresh();
  };
  const recordPayment = async () => {
    const amt = Number(payment);
    if (!(amt > 0)) return;
    const r = await lensRun({ domain: 'accounting', action: 'tax-payment-record', input: { amount: amt } });
    setNote(r.data?.ok === false ? (r.data?.error || 'Failed') : `Recorded $${amt.toLocaleString()} remittance.`);
    setPayment('');
    await refresh();
  };

  if (loading) return <Spin />;

  return (
    <div className="space-y-4 p-1">
      <div className="bg-black/30 border border-white/10 rounded-lg p-3 text-center">
        <p className="text-2xl font-bold text-amber-300">${liability.toLocaleString()}</p>
        <p className="text-[10px] text-gray-400 uppercase">Sales tax payable</p>
      </div>

      <section className="bg-black/30 border border-white/10 rounded-lg p-3">
        <h3 className="text-xs font-semibold text-gray-300 mb-2">Record a remittance</h3>
        <div className="flex items-center gap-2">
          <input placeholder="Amount paid" inputMode="decimal" value={payment} onChange={(e) => setPayment(e.target.value)} className={inp} />
          <button type="button" onClick={recordPayment} className={btn}>Record payment</button>
        </div>
        {note && <p className="text-[11px] text-emerald-300 mt-1.5">{note}</p>}
      </section>

      <section className="bg-black/30 border border-white/10 rounded-lg p-3">
        <h3 className="text-xs font-semibold text-gray-300 mb-2">Tax codes</h3>
        <div className="flex items-center gap-2 mb-2">
          <input placeholder="Code name (e.g. CA)" value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} className={inp} />
          <input placeholder="Rate %" inputMode="decimal" value={form.rate} onChange={(e) => setForm({ ...form, rate: e.target.value })}
            className="w-24 bg-black/40 border border-white/10 rounded px-2 py-1.5 text-xs text-gray-100" />
          <button type="button" onClick={addCode} className={btn}><Plus className="w-3.5 h-3.5" /> Add</button>
        </div>
        {codes.length === 0 ? <Empty text="No tax codes." /> : (
          <ul className="space-y-1">
            {codes.map((c) => (
              <li key={c.id} className="flex items-center gap-2 text-xs text-gray-300 bg-black/20 rounded px-2 py-1">
                <span className="flex-1">{c.name}</span>
                <span className="text-gray-400">{c.rate}%</span>
                <button aria-label="Delete" type="button" onClick={() => lensRun({ domain: 'accounting', action: 'tax-code-delete', input: { id: c.id } }).then(refresh)}
                  className="text-gray-600 hover:text-rose-400"><Trash2 className="w-3.5 h-3.5" /></button>
              </li>
            ))}
          </ul>
        )}
      </section>
    </div>
  );
}

const inp = 'flex-1 bg-black/40 border border-white/10 rounded px-2 py-1.5 text-xs text-gray-100';
const btn = 'flex items-center justify-center gap-1 bg-emerald-600 hover:bg-emerald-500 text-white text-xs font-medium rounded px-3 py-1.5';
function Spin() { return <div className="flex items-center justify-center py-10 text-gray-400"><Loader2 className="w-5 h-5 animate-spin" /></div>; }
function Empty({ text }: { text: string }) { return <p className="text-[11px] text-gray-400 italic">{text}</p>; }
