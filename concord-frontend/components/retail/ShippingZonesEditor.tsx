'use client';

import { useEffect, useState } from 'react';
import { Truck, Plus, Trash2, Loader2, Globe } from 'lucide-react';
import { lensRun } from '@/lib/api/client';

interface Zone {
  id: string; name: string; countries: string[];
  rates: Array<{ id: string; name: string; priceCents: number; freeThreshold: number | null }>;
}

export function ShippingZonesEditor() {
  const [zones, setZones] = useState<Zone[]>([]);
  const [loading, setLoading] = useState(true);
  const [creating, setCreating] = useState(false);
  const [form, setForm] = useState({ name: '', countries: 'US, CA', standardCents: '500', standardFreeThreshold: '50', expressCents: '2000' });
  const [quoteCountry, setQuoteCountry] = useState('US');
  const [quoteSubtotal, setQuoteSubtotal] = useState('75');
  const [quote, setQuote] = useState<{ zone: string; quotes: Array<{ name: string; priceCents: number; free: boolean }> } | null>(null);

  useEffect(() => { refresh(); }, []);

  async function refresh() {
    setLoading(true);
    try {
      const res = await lensRun({ domain: 'retail', action: 'shipping-zones-list', input: {} });
      setZones((res.data?.result?.zones || []) as Zone[]);
    } catch (e) { console.error('[Shipping] list failed', e); }
    finally { setLoading(false); }
  }

  async function create() {
    if (!form.name.trim() || !form.countries.trim()) return;
    const countries = form.countries.split(',').map(s => s.trim().toUpperCase()).filter(Boolean);
    const rates = [];
    if (form.standardCents) rates.push({ id: 'r_std', name: 'Standard', priceCents: Number(form.standardCents), freeThreshold: form.standardFreeThreshold ? Number(form.standardFreeThreshold) : null });
    if (form.expressCents) rates.push({ id: 'r_exp', name: 'Express', priceCents: Number(form.expressCents), freeThreshold: null });
    try {
      await lensRun({ domain: 'retail', action: 'shipping-zones-create', input: { name: form.name, countries, rates } });
      setForm({ name: '', countries: 'US, CA', standardCents: '500', standardFreeThreshold: '50', expressCents: '2000' });
      setCreating(false);
      await refresh();
    } catch (e) { console.error('[Shipping] create failed', e); }
  }

  async function remove(id: string) {
    try {
      await lensRun({ domain: 'retail', action: 'shipping-zones-delete', input: { id } });
      setZones(prev => prev.filter(z => z.id !== id));
    } catch (e) { console.error('[Shipping] delete failed', e); }
  }

  async function getQuote() {
    try {
      const res = await lensRun({
        domain: 'retail', action: 'shipping-rate-quote',
        input: { country: quoteCountry, subtotal: Number(quoteSubtotal) || 0 },
      });
      setQuote({
        zone: res.data?.result?.zone || res.data?.result?.message || 'No zone',
        quotes: res.data?.result?.quotes || [],
      });
    } catch (e) { console.error('[Shipping] quote failed', e); }
  }

  return (
    <div className="bg-[#0d1117] border border-emerald-500/20 rounded-lg overflow-hidden">
      <header className="px-4 py-2 border-b border-white/10 flex items-center gap-2">
        <Truck className="w-4 h-4 text-emerald-400" />
        <span className="text-xs uppercase font-semibold text-gray-300 tracking-wider">Shipping zones</span>
        <span className="ml-auto text-[10px] text-gray-400">{zones.length}</span>
        <button onClick={() => setCreating(v => !v)} aria-label="New shipping zone" className="p-1 text-gray-400 hover:text-white"><Plus className="w-4 h-4" /></button>
      </header>

      {creating && (
        <div className="p-3 border-b border-white/10 grid grid-cols-5 gap-2">
          <input value={form.name} onChange={e => setForm({ ...form, name: e.target.value })} placeholder="Zone name" className="col-span-2 px-2 py-1.5 text-xs bg-lattice-deep border border-lattice-border rounded text-white" />
          <input value={form.countries} onChange={e => setForm({ ...form, countries: e.target.value })} placeholder="US, CA, MX" className="col-span-3 px-2 py-1.5 text-xs bg-lattice-deep border border-lattice-border rounded text-white font-mono" />
          <input type="number" value={form.standardCents} onChange={e => setForm({ ...form, standardCents: e.target.value })} placeholder="Standard ¢" className="px-2 py-1.5 text-xs bg-lattice-deep border border-lattice-border rounded text-white" />
          <input type="number" value={form.standardFreeThreshold} onChange={e => setForm({ ...form, standardFreeThreshold: e.target.value })} placeholder="Free at $" className="px-2 py-1.5 text-xs bg-lattice-deep border border-lattice-border rounded text-white" />
          <input type="number" value={form.expressCents} onChange={e => setForm({ ...form, expressCents: e.target.value })} placeholder="Express ¢" className="px-2 py-1.5 text-xs bg-lattice-deep border border-lattice-border rounded text-white" />
          <button onClick={create} className="col-span-2 px-3 py-1.5 text-xs rounded bg-emerald-500 text-black font-bold hover:bg-emerald-400">Create zone</button>
        </div>
      )}

      <div className="max-h-72 overflow-y-auto">
        {loading ? (
          <div className="flex items-center justify-center py-6 text-xs text-gray-400"><Loader2 className="w-4 h-4 animate-spin mr-2" /> Loading…</div>
        ) : zones.length === 0 ? (
          <div className="px-3 py-10 text-center text-xs text-gray-400"><Truck className="w-6 h-6 mx-auto mb-2 opacity-30" />No shipping zones. Hit + to add.</div>
        ) : (
          <ul className="divide-y divide-white/5">
            {zones.map(z => (
              <li key={z.id} className="px-3 py-2 hover:bg-white/[0.03] group">
                <div className="flex items-center gap-2">
                  <Globe className="w-3.5 h-3.5 text-cyan-300" />
                  <span className="text-sm text-white font-medium flex-1 truncate">{z.name}</span>
                  <span className="text-[10px] text-gray-400 font-mono">{z.countries.join(', ')}</span>
                  <button aria-label="Delete" onClick={() => remove(z.id)} className="opacity-0 group-hover:opacity-100 p-1 text-gray-400 hover:text-rose-400"><Trash2 className="w-3 h-3" /></button>
                </div>
                <div className="mt-1 grid grid-cols-2 gap-1 text-[11px]">
                  {z.rates.map(r => (
                    <div key={r.id} className="flex items-center gap-2 px-2 py-1 rounded bg-white/[0.03]">
                      <span className="text-gray-400">{r.name}</span>
                      <span className="ml-auto font-mono text-cyan-300">${(r.priceCents / 100).toFixed(2)}</span>
                      {r.freeThreshold != null && <span className="text-[10px] text-emerald-300">free ≥${r.freeThreshold}</span>}
                    </div>
                  ))}
                </div>
              </li>
            ))}
          </ul>
        )}
      </div>

      <footer className="px-3 py-2 border-t border-white/10 bg-white/[0.02] grid grid-cols-4 gap-2 text-xs">
        <input value={quoteCountry} onChange={e => setQuoteCountry(e.target.value.toUpperCase())} placeholder="Country" className="px-2 py-1 bg-lattice-deep border border-lattice-border rounded text-white font-mono" />
        <input type="number" value={quoteSubtotal} onChange={e => setQuoteSubtotal(e.target.value)} placeholder="Subtotal $" className="px-2 py-1 bg-lattice-deep border border-lattice-border rounded text-white" />
        <button onClick={getQuote} className="px-2 py-1 text-xs rounded bg-cyan-500/20 text-cyan-300 hover:bg-cyan-500/30">Quote</button>
        {quote && (
          <span className="text-[11px] text-gray-300 truncate">
            {quote.zone}: {quote.quotes.length > 0 ? quote.quotes.map(q => `${q.name} ${q.free ? 'FREE' : `$${(q.priceCents / 100).toFixed(2)}`}`).join(' · ') : 'no rates'}
          </span>
        )}
      </footer>
    </div>
  );
}

export default ShippingZonesEditor;
