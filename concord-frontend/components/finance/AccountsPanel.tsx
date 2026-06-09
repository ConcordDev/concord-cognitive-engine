'use client';

import { useEffect, useMemo, useState } from 'react';
import { Building2, Plus, Trash2, Loader2, Edit3, Check, X } from 'lucide-react';
import { lensRun } from '@/lib/api/client';
import { cn } from '@/lib/utils';

interface Account {
  id: string;
  institution: string;
  name: string;
  kind: 'checking' | 'savings' | 'credit' | 'investment' | 'loan' | 'mortgage' | 'crypto';
  mask: string;
  balance: number;
  currency: string;
  status: string;
  linkedAt: string;
}

const KIND_LABELS: Record<Account['kind'], string> = {
  checking: 'Checking', savings: 'Savings', credit: 'Credit', investment: 'Investment', loan: 'Loan', mortgage: 'Mortgage', crypto: 'Crypto',
};
const KIND_COLORS: Record<Account['kind'], string> = {
  checking: 'bg-cyan-500/15 text-cyan-300', savings: 'bg-emerald-500/15 text-emerald-300', credit: 'bg-rose-500/15 text-rose-300',
  investment: 'bg-violet-500/15 text-violet-300', loan: 'bg-orange-500/15 text-orange-300', mortgage: 'bg-amber-500/15 text-amber-300', crypto: 'bg-yellow-500/15 text-yellow-300',
};

export function AccountsPanel() {
  const [accounts, setAccounts] = useState<Account[]>([]);
  const [totals, setTotals] = useState({ totalAssets: 0, totalLiabilities: 0, netWorth: 0 });
  const [loading, setLoading] = useState(true);
  const [creating, setCreating] = useState(false);
  const [form, setForm] = useState({ institution: '', name: '', kind: 'checking' as Account['kind'], mask: '', balance: '' });
  const [editing, setEditing] = useState<{ id: string; value: string } | null>(null);

  useEffect(() => { refresh(); }, []);

  async function refresh() {
    setLoading(true);
    try {
      const res = await lensRun({ domain: 'finance', action: 'accounts-list', input: {} });
      setAccounts((res.data?.result?.accounts || []) as Account[]);
      setTotals({
        totalAssets: res.data?.result?.totalAssets || 0,
        totalLiabilities: res.data?.result?.totalLiabilities || 0,
        netWorth: res.data?.result?.netWorth || 0,
      });
    } catch (e) { console.error('[Accounts] list failed', e); }
    finally { setLoading(false); }
  }

  async function link() {
    if (!form.institution.trim() || !form.name.trim()) return;
    try {
      await lensRun({
        domain: 'finance', action: 'accounts-link',
        input: { institution: form.institution.trim(), name: form.name.trim(), kind: form.kind, mask: form.mask || '0000', balance: Number(form.balance) || 0 },
      });
      setForm({ institution: '', name: '', kind: 'checking', mask: '', balance: '' });
      setCreating(false);
      await refresh();
    } catch (e) { console.error('[Accounts] link failed', e); }
  }

  async function unlink(id: string) {
    try {
      await lensRun({ domain: 'finance', action: 'accounts-unlink', input: { id } });
      setAccounts(prev => prev.filter(a => a.id !== id));
      await refresh();
    } catch (e) { console.error('[Accounts] unlink failed', e); }
  }

  async function saveBalance(id: string) {
    if (!editing) return;
    const v = Number(editing.value);
    if (!Number.isFinite(v)) return;
    try {
      await lensRun({ domain: 'finance', action: 'accounts-update-balance', input: { id, balance: v } });
      setEditing(null);
      await refresh();
    } catch (e) { console.error('[Accounts] update failed', e); }
  }

  const grouped = useMemo(() => {
    const out: Record<string, Account[]> = {};
    for (const a of accounts) { (out[a.kind] ||= []).push(a); }
    return out;
  }, [accounts]);

  return (
    <div className="bg-[#0d1117] border border-cyan-500/20 rounded-lg overflow-hidden">
      <header className="px-4 py-2 border-b border-white/10 flex items-center gap-2">
        <Building2 className="w-4 h-4 text-cyan-400" />
        <span className="text-xs uppercase font-semibold text-gray-300 tracking-wider">Linked accounts</span>
        <button aria-label="Add" onClick={() => setCreating(v => !v)} className="ml-auto p-1 text-gray-400 hover:text-white"><Plus className="w-4 h-4" /></button>
      </header>

      <div className="px-4 py-3 border-b border-white/10 grid grid-cols-3 gap-3">
        <div className="rounded-md bg-white/[0.03] border border-white/5 p-3">
          <div className="text-[10px] uppercase tracking-wider text-gray-400">Assets</div>
          <div className="text-lg font-mono tabular-nums text-emerald-300">${totals.totalAssets.toLocaleString(undefined, { maximumFractionDigits: 0 })}</div>
        </div>
        <div className="rounded-md bg-white/[0.03] border border-white/5 p-3">
          <div className="text-[10px] uppercase tracking-wider text-gray-400">Liabilities</div>
          <div className="text-lg font-mono tabular-nums text-rose-300">${totals.totalLiabilities.toLocaleString(undefined, { maximumFractionDigits: 0 })}</div>
        </div>
        <div className="rounded-md bg-white/[0.03] border border-white/5 p-3">
          <div className="text-[10px] uppercase tracking-wider text-gray-400">Net worth</div>
          <div className={cn('text-lg font-mono tabular-nums', totals.netWorth >= 0 ? 'text-cyan-300' : 'text-rose-300')}>${totals.netWorth.toLocaleString(undefined, { maximumFractionDigits: 0 })}</div>
        </div>
      </div>

      {creating && (
        <div className="p-3 border-b border-white/10 grid grid-cols-6 gap-2">
          <input value={form.institution} onChange={e => setForm({ ...form, institution: e.target.value })} placeholder="Institution" className="col-span-2 px-2 py-1.5 text-xs bg-lattice-deep border border-lattice-border rounded text-white" />
          <input value={form.name} onChange={e => setForm({ ...form, name: e.target.value })} placeholder="Account name" className="col-span-2 px-2 py-1.5 text-xs bg-lattice-deep border border-lattice-border rounded text-white" />
          <select value={form.kind} onChange={e => setForm({ ...form, kind: e.target.value as Account['kind'] })} className="px-2 py-1.5 text-xs bg-lattice-deep border border-lattice-border rounded text-white">
            {Object.entries(KIND_LABELS).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
          </select>
          <input type="number" value={form.balance} onChange={e => setForm({ ...form, balance: e.target.value })} placeholder="Balance (neg for debt)" className="px-2 py-1.5 text-xs bg-lattice-deep border border-lattice-border rounded text-white" />
          <input value={form.mask} onChange={e => setForm({ ...form, mask: e.target.value })} placeholder="••0000" className="px-2 py-1.5 text-xs bg-lattice-deep border border-lattice-border rounded text-white font-mono" />
          <button onClick={link} className="col-span-5 px-3 py-1.5 text-xs rounded bg-cyan-500 text-black font-bold hover:bg-cyan-400">Link account</button>
        </div>
      )}

      <div className="max-h-96 overflow-y-auto">
        {loading ? (
          <div className="flex items-center justify-center py-6 text-xs text-gray-400"><Loader2 className="w-4 h-4 animate-spin mr-2" /> Loading…</div>
        ) : accounts.length === 0 ? (
          <div className="px-3 py-10 text-center text-xs text-gray-400"><Building2 className="w-6 h-6 mx-auto mb-2 opacity-30" />No accounts linked. Click + to add one.</div>
        ) : (
          Object.entries(grouped).map(([kind, group]) => (
            <div key={kind} className="border-b border-white/5 last:border-b-0">
              <div className="px-3 py-1.5 bg-white/[0.02] text-[10px] uppercase tracking-wider text-gray-400">{KIND_LABELS[kind as Account['kind']]} · {group.length}</div>
              <ul className="divide-y divide-white/5">
                {group.map(a => (
                  <li key={a.id} className="px-3 py-2 hover:bg-white/[0.03] group flex items-center gap-3 text-xs">
                    <span className={cn('text-[10px] uppercase px-1.5 py-0.5 rounded font-mono', KIND_COLORS[a.kind])}>{a.mask}</span>
                    <div className="flex-1 min-w-0">
                      <div className="text-sm text-white truncate">{a.institution}</div>
                      <div className="text-[10px] text-gray-400 truncate">{a.name}</div>
                    </div>
                    {editing?.id === a.id ? (
                      <span className="inline-flex items-center gap-1">
                        <input type="number" value={editing.value} onChange={e => setEditing({ id: a.id, value: e.target.value })} className="w-24 px-1.5 py-0.5 text-xs bg-lattice-deep border border-cyan-500/40 rounded text-white" autoFocus />
                        <button aria-label="Confirm" onClick={() => saveBalance(a.id)} className="text-emerald-300"><Check className="w-3.5 h-3.5" /></button>
                        <button onClick={() => setEditing(null)} className="text-gray-400"><X className="w-3.5 h-3.5" /></button>
                      </span>
                    ) : (
                      <button onClick={() => setEditing({ id: a.id, value: String(a.balance) })} className={cn('font-mono text-sm tabular-nums hover:underline', a.balance >= 0 ? 'text-white' : 'text-rose-300')}>
                        ${Math.abs(a.balance).toLocaleString(undefined, { maximumFractionDigits: 0 })}
                        <Edit3 className="w-2.5 h-2.5 inline ml-1 opacity-0 group-hover:opacity-100" />
                      </button>
                    )}
                    <button aria-label="Delete" onClick={() => unlink(a.id)} className="opacity-0 group-hover:opacity-100 p-1 text-gray-400 hover:text-rose-400"><Trash2 className="w-3 h-3" /></button>
                  </li>
                ))}
              </ul>
            </div>
          ))
        )}
      </div>
    </div>
  );
}

export default AccountsPanel;
