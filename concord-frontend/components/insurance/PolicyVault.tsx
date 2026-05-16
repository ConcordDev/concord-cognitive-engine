'use client';

import { useEffect, useState } from 'react';
import { Shield, FileText, Plus, Loader2, AlertTriangle, Calendar } from 'lucide-react';
import { api } from '@/lib/api/client';
import { cn } from '@/lib/utils';

export interface Policy {
  id: string;
  carrier: string;
  kind: 'auto' | 'home' | 'health' | 'life' | 'umbrella' | 'renters' | 'pet' | 'travel' | 'business';
  policyNumber: string;
  annualPremium: number;
  deductible: number;
  liabilityLimit?: number;
  effectiveDate: string;
  renewalDate: string;
  status: 'active' | 'cancelled' | 'expired';
  documents: number;
}

const KIND_LABEL: Record<Policy['kind'], string> = {
  auto: 'Auto', home: 'Home', health: 'Health', life: 'Life', umbrella: 'Umbrella',
  renters: 'Renters', pet: 'Pet', travel: 'Travel', business: 'Business',
};

export function PolicyVault() {
  const [policies, setPolicies] = useState<Policy[]>([]);
  const [loading, setLoading] = useState(true);
  const [adding, setAdding] = useState(false);
  const [draft, setDraft] = useState<Partial<Policy>>({ kind: 'auto', annualPremium: 0, deductible: 0 });

  useEffect(() => { refresh(); }, []);

  async function refresh() {
    setLoading(true);
    try {
      const res = await api.post('/api/lens/run', { domain: 'insurance', action: 'policy-list', input: {} });
      setPolicies((res.data?.result?.policies || []) as Policy[]);
    } catch (e) { console.error('[Policy] failed', e); }
    finally { setLoading(false); }
  }

  async function add() {
    if (!draft.carrier?.trim() || !draft.policyNumber?.trim()) return;
    try {
      await api.post('/api/lens/run', { domain: 'insurance', action: 'policy-add', input: draft });
      setDraft({ kind: 'auto', annualPremium: 0, deductible: 0 });
      setAdding(false);
      await refresh();
    } catch (e) { console.error('[Policy] add failed', e); }
  }

  const totalPremium = policies.filter(p => p.status === 'active').reduce((s, p) => s + p.annualPremium, 0);
  const renewingSoon = policies.filter(p => {
    if (p.status !== 'active') return false;
    const days = (new Date(p.renewalDate).getTime() - Date.now()) / 86400000;
    return days > 0 && days < 30;
  }).length;

  return (
    <div className="bg-[#0d1117] border border-cyan-500/20 rounded-lg overflow-hidden">
      <header className="px-4 py-2 border-b border-white/10 flex items-center gap-2">
        <Shield className="w-4 h-4 text-cyan-400" />
        <span className="text-xs uppercase font-semibold text-gray-300 tracking-wider">Policy vault</span>
        <span className="ml-auto text-[10px] text-gray-500">${totalPremium.toFixed(0)}/yr total{renewingSoon > 0 ? ` · ${renewingSoon} renewing soon` : ''}</span>
        <button onClick={() => setAdding(v => !v)} className="p-1 text-gray-400 hover:text-white" title="Add policy">
          <Plus className="w-4 h-4" />
        </button>
      </header>

      {adding && (
        <div className="p-3 border-b border-white/10 grid grid-cols-3 gap-2 text-xs">
          <select value={draft.kind} onChange={e => setDraft({ ...draft, kind: e.target.value as Policy['kind'] })} className="px-2 py-1.5 bg-lattice-deep border border-lattice-border rounded text-white">
            {Object.entries(KIND_LABEL).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
          </select>
          <input value={draft.carrier || ''} onChange={e => setDraft({ ...draft, carrier: e.target.value })} placeholder="Carrier (e.g. Geico)" className="px-2 py-1.5 bg-lattice-deep border border-lattice-border rounded text-white" />
          <input value={draft.policyNumber || ''} onChange={e => setDraft({ ...draft, policyNumber: e.target.value })} placeholder="Policy #" className="px-2 py-1.5 bg-lattice-deep border border-lattice-border rounded text-white" />
          <input type="number" value={draft.annualPremium || 0} onChange={e => setDraft({ ...draft, annualPremium: Number(e.target.value) })} placeholder="Annual premium $" className="px-2 py-1.5 bg-lattice-deep border border-lattice-border rounded text-white" />
          <input type="number" value={draft.deductible || 0} onChange={e => setDraft({ ...draft, deductible: Number(e.target.value) })} placeholder="Deductible $" className="px-2 py-1.5 bg-lattice-deep border border-lattice-border rounded text-white" />
          <input type="date" value={draft.renewalDate || ''} onChange={e => setDraft({ ...draft, renewalDate: e.target.value })} className="px-2 py-1.5 bg-lattice-deep border border-lattice-border rounded text-white" />
          <button onClick={add} className="col-span-3 py-1.5 rounded bg-cyan-500 text-black font-bold hover:bg-cyan-400">Save policy</button>
        </div>
      )}

      <div className="max-h-96 overflow-y-auto">
        {loading ? (
          <div className="flex items-center justify-center py-6 text-xs text-gray-500"><Loader2 className="w-4 h-4 animate-spin mr-2" /> Loading…</div>
        ) : policies.length === 0 ? (
          <div className="px-3 py-10 text-center text-xs text-gray-500"><Shield className="w-6 h-6 mx-auto mb-2 opacity-30" /> No policies yet. Hit + to add.</div>
        ) : (
          <ul className="divide-y divide-white/5">
            {policies.map(p => {
              const days = (new Date(p.renewalDate).getTime() - Date.now()) / 86400000;
              return (
                <li key={p.id} className="px-3 py-2 hover:bg-white/[0.03] group">
                  <div className="flex items-center gap-2">
                    <span className={cn('text-[10px] uppercase px-1.5 py-0.5 rounded font-bold',
                      p.kind === 'auto' ? 'bg-blue-500/20 text-blue-300' :
                      p.kind === 'home' ? 'bg-green-500/20 text-green-300' :
                      p.kind === 'health' ? 'bg-red-500/20 text-red-300' :
                      p.kind === 'life' ? 'bg-purple-500/20 text-purple-300' :
                      'bg-cyan-500/20 text-cyan-300'
                    )}>{KIND_LABEL[p.kind]}</span>
                    <span className="text-sm text-white">{p.carrier}</span>
                    <span className="text-[10px] text-gray-500">#{p.policyNumber}</span>
                    <span className="ml-auto text-sm font-mono tabular-nums text-yellow-300">${p.annualPremium.toFixed(0)}/yr</span>
                  </div>
                  <div className="text-[10px] text-gray-500 mt-0.5 flex items-center gap-3">
                    <span>${p.deductible.toFixed(0)} deductible</span>
                    {p.liabilityLimit && <span>${(p.liabilityLimit / 1000).toFixed(0)}k liability</span>}
                    <span className={cn('inline-flex items-center gap-1', days < 30 && days > 0 && 'text-yellow-300', days <= 0 && 'text-red-400')}>
                      <Calendar className="w-3 h-3" /> renews {new Date(p.renewalDate).toLocaleDateString()}
                    </span>
                    <span className="inline-flex items-center gap-1"><FileText className="w-3 h-3" /> {p.documents} docs</span>
                    {days < 30 && days > 0 && <span className="text-yellow-300 inline-flex items-center gap-1"><AlertTriangle className="w-3 h-3" /> shop before renewal</span>}
                  </div>
                </li>
              );
            })}
          </ul>
        )}
      </div>
    </div>
  );
}

export default PolicyVault;
