'use client';

import { useEffect, useState } from 'react';
import { Loader2, Plus, ToggleLeft, ToggleRight } from 'lucide-react';
import { lensRun } from '@/lib/api/client';
import { cn } from '@/lib/utils';

interface Promotion {
  id: string; number: string; code: string;
  kind: 'percent' | 'fixed' | 'free_shipping';
  amount: number; validFrom: string; validUntil: string;
  minOrderUsd: number; active: boolean; usageCount: number;
}

export function MarketingPanel() {
  const [list, setList] = useState<Promotion[]>([]);
  const [loading, setLoading] = useState(true);
  const [creating, setCreating] = useState(false);
  const [draft, setDraft] = useState({ code: '', kind: 'percent' as Promotion['kind'], amount: '', minOrderUsd: '', validUntil: '' });

  useEffect(() => { refresh(); }, []);

  async function refresh() {
    setLoading(true);
    try {
      const r = await lensRun({ domain: 'marketplace', action: 'promotions-list', input: {} });
      setList((r.data?.result?.promotions || []) as Promotion[]);
    } catch (e) { console.error('[Promos] failed', e); }
    finally { setLoading(false); }
  }

  async function create() {
    if (!draft.code.trim() || !draft.amount) return;
    try {
      const r = await lensRun({ domain: 'marketplace', action: 'promotions-create', input: {
        code: draft.code.trim(), kind: draft.kind, amount: Number(draft.amount),
        minOrderUsd: Number(draft.minOrderUsd) || 0,
        validUntil: draft.validUntil || undefined,
      } });
      if (r.data?.ok === false) { alert(r.data?.error); return; }
      setDraft({ code: '', kind: 'percent', amount: '', minOrderUsd: '', validUntil: '' });
      setCreating(false);
      await refresh();
    } catch (e) { console.error('[Promos] create', e); }
  }

  async function toggle(id: string) {
    try { await lensRun({ domain: 'marketplace', action: 'promotions-toggle', input: { id } }); await refresh(); }
    catch (e) { console.error('[Promos] toggle', e); }
  }

  return (
    <div className="bg-[#0d1117] border border-orange-500/15 rounded-lg overflow-hidden">
      <header className="px-4 py-2.5 border-b border-white/10 flex items-center gap-2">
        <span className="text-sm font-semibold text-gray-200">Promotions / coupons</span>
        <span className="text-[10px] text-gray-500">{list.length}</span>
        <button onClick={() => setCreating(v => !v)} className="ml-auto px-2.5 py-1 text-xs rounded bg-orange-500 text-black font-semibold hover:bg-orange-400 inline-flex items-center gap-1">
          <Plus className="w-3 h-3" />New code
        </button>
      </header>

      {creating && (
        <div className="px-4 py-3 border-b border-white/10 grid grid-cols-12 gap-2">
          <input value={draft.code} onChange={e => setDraft({ ...draft, code: e.target.value.toUpperCase() })} placeholder="CODE *" className="col-span-4 px-2 py-1.5 text-xs bg-lattice-deep border border-lattice-border rounded text-white font-mono" />
          <select value={draft.kind} onChange={e => setDraft({ ...draft, kind: e.target.value as Promotion['kind'] })} className="col-span-3 px-2 py-1.5 text-xs bg-lattice-deep border border-lattice-border rounded text-white">
            <option value="percent">% off</option>
            <option value="fixed">$ off</option>
            <option value="free_shipping">Free shipping</option>
          </select>
          {draft.kind !== 'free_shipping' && (
            <input type="number" step="0.01" value={draft.amount} onChange={e => setDraft({ ...draft, amount: e.target.value })} placeholder={draft.kind === 'percent' ? 'Percent (1-100)' : 'Amount (USD)'} className="col-span-2 px-2 py-1.5 text-xs bg-lattice-deep border border-lattice-border rounded text-white font-mono" />
          )}
          <input type="number" step="0.01" value={draft.minOrderUsd} onChange={e => setDraft({ ...draft, minOrderUsd: e.target.value })} placeholder="Min order" className="col-span-3 px-2 py-1.5 text-xs bg-lattice-deep border border-lattice-border rounded text-white font-mono" />
          <input type="date" value={draft.validUntil} onChange={e => setDraft({ ...draft, validUntil: e.target.value })} placeholder="Expires" className="col-span-6 px-2 py-1.5 text-xs bg-lattice-deep border border-lattice-border rounded text-white font-mono" />
          <button onClick={create} className="col-span-6 px-3 py-1.5 text-xs rounded bg-orange-500 text-black font-bold hover:bg-orange-400">Create code</button>
        </div>
      )}

      <div className="max-h-[28rem] overflow-y-auto">
        {loading ? (
          <div className="flex items-center justify-center py-10 text-xs text-gray-500"><Loader2 className="w-4 h-4 animate-spin mr-2" /> Loading…</div>
        ) : list.length === 0 ? (
          <div className="px-3 py-10 text-center text-xs text-gray-500">No promotions yet.</div>
        ) : (
          <ul className="divide-y divide-white/5">
            {list.map(p => (
              <li key={p.id} className="px-4 py-2.5 hover:bg-white/[0.02] flex items-center gap-3">
                <button onClick={() => toggle(p.id)} className={cn('p-1 rounded', p.active ? 'text-emerald-300' : 'text-gray-500')} title={p.active ? 'Active — click to disable' : 'Disabled — click to activate'}>
                  {p.active ? <ToggleRight className="w-5 h-5" /> : <ToggleLeft className="w-5 h-5" />}
                </button>
                <span className="font-mono text-sm text-orange-300 font-bold">{p.code}</span>
                <div className="flex-1 text-xs text-gray-300">
                  {p.kind === 'percent' ? `${p.amount}% off` : p.kind === 'fixed' ? `$${p.amount} off` : 'Free shipping'}
                  {p.minOrderUsd > 0 && <span className="text-gray-500"> · min ${p.minOrderUsd}</span>}
                  {p.validUntil && <span className="text-gray-500"> · expires {p.validUntil}</span>}
                </div>
                <span className="text-[10px] text-gray-500 font-mono">{p.usageCount} uses</span>
              </li>
            ))}
          </ul>
        )}
      </div>
    </div>
  );
}

export default MarketingPanel;
