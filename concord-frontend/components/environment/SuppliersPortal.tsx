'use client';

import { useEffect, useState } from 'react';
import { Building2, Plus, Send, Loader2, Copy } from 'lucide-react';
import { lensRun } from '@/lib/api/client';
import { cn } from '@/lib/utils';

interface Supplier {
  id: string; name: string; email: string; contactName: string; spendUsd: number;
  categoryCode: string; invitationStatus: 'not_invited' | 'invited' | 'responded';
  reportedCo2eTonnes: number | null; reportingYear?: string; portalToken?: string; lastReportedAt: string | null;
}

const STATUS_COLOUR: Record<Supplier['invitationStatus'], string> = {
  not_invited: 'bg-gray-500/15 text-gray-300',
  invited: 'bg-amber-500/15 text-amber-300',
  responded: 'bg-emerald-500/15 text-emerald-300',
};

export function SuppliersPortal() {
  const [suppliers, setSuppliers] = useState<Supplier[]>([]);
  const [loading, setLoading] = useState(true);
  const [form, setForm] = useState({ name: '', email: '', contactName: '', spendUsd: '', categoryCode: '' });
  const [discloseFor, setDiscloseFor] = useState<string | null>(null);
  const [discloseTonnes, setDiscloseTonnes] = useState('');

  useEffect(() => { refresh(); }, []);

  async function refresh() {
    setLoading(true);
    try {
      const r = await lensRun({ domain: 'environment', action: 'suppliers-list', input: {} });
      setSuppliers((r.data?.result?.suppliers || []) as Supplier[]);
    } catch (e) { console.error('[Suppliers] failed', e); }
    finally { setLoading(false); }
  }

  async function add() {
    if (!form.name.trim() || !form.email.trim()) return;
    try {
      await lensRun({ domain: 'environment', action: 'suppliers-add', input: { ...form, spendUsd: Number(form.spendUsd) || 0 } });
      setForm({ name: '', email: '', contactName: '', spendUsd: '', categoryCode: '' });
      await refresh();
    } catch (e) { console.error('[Suppliers] add', e); }
  }

  async function invite(id: string) {
    try {
      const r = await lensRun({ domain: 'environment', action: 'suppliers-invite', input: { id } });
      const link = r.data?.result?.portalLink;
      if (link) {
        const fullUrl = window.location.origin + link;
        navigator.clipboard?.writeText(fullUrl).catch(() => {});
        alert(`Invitation portal link copied to clipboard:\n${fullUrl}`);
      }
      await refresh();
    } catch (e) { console.error('[Suppliers] invite', e); }
  }

  async function recordDisclosure() {
    if (!discloseFor || !discloseTonnes) return;
    try {
      const r = await lensRun({ domain: 'environment', action: 'suppliers-record-disclosure', input: { id: discloseFor, co2eTonnes: Number(discloseTonnes) } });
      if (r.data?.ok === false) alert(r.data?.error);
      setDiscloseFor(null); setDiscloseTonnes('');
      await refresh();
    } catch (e) { console.error('[Suppliers] disclosure', e); }
  }

  const responseRate = suppliers.length > 0
    ? Math.round((suppliers.filter(s => s.invitationStatus === 'responded').length / suppliers.length) * 100)
    : 0;

  return (
    <div className="bg-[#0d1117] border border-violet-500/20 rounded-lg overflow-hidden">
      <header className="px-4 py-2 border-b border-white/10 flex items-center gap-2">
        <Building2 className="w-4 h-4 text-violet-400" />
        <span className="text-xs uppercase font-semibold text-gray-300 tracking-wider">Supplier portal · Scope 3</span>
        <span className="ml-auto text-[10px] text-gray-500">{responseRate}% response · {suppliers.length} suppliers</span>
      </header>
      <div className="p-3 border-b border-white/10 grid grid-cols-5 gap-2">
        <input value={form.name} onChange={e => setForm({ ...form, name: e.target.value })} placeholder="Supplier name" className="col-span-2 px-2 py-1.5 text-xs bg-lattice-deep border border-lattice-border rounded text-white" />
        <input value={form.email} onChange={e => setForm({ ...form, email: e.target.value })} placeholder="Email" className="col-span-2 px-2 py-1.5 text-xs bg-lattice-deep border border-lattice-border rounded text-white" />
        <input value={form.contactName} onChange={e => setForm({ ...form, contactName: e.target.value })} placeholder="Contact" className="px-2 py-1.5 text-xs bg-lattice-deep border border-lattice-border rounded text-white" />
        <input type="number" value={form.spendUsd} onChange={e => setForm({ ...form, spendUsd: e.target.value })} placeholder="Annual spend $" className="px-2 py-1.5 text-xs bg-lattice-deep border border-lattice-border rounded text-white" />
        <input value={form.categoryCode} onChange={e => setForm({ ...form, categoryCode: e.target.value })} placeholder="EEIO code (optional)" className="col-span-3 px-2 py-1.5 text-xs bg-lattice-deep border border-lattice-border rounded text-white" />
        <button onClick={add} className="px-3 py-1.5 text-xs rounded bg-violet-500 text-white font-bold hover:bg-violet-400 inline-flex items-center justify-center gap-1"><Plus className="w-3 h-3" />Add supplier</button>
      </div>
      <div className="max-h-96 overflow-y-auto">
        {loading ? (
          <div className="flex items-center justify-center py-6 text-xs text-gray-500"><Loader2 className="w-4 h-4 animate-spin mr-2" /> Loading…</div>
        ) : suppliers.length === 0 ? (
          <div className="px-3 py-10 text-center text-xs text-gray-500"><Building2 className="w-6 h-6 mx-auto mb-2 opacity-30" />No suppliers yet. Add your top 20 by spend to start engaging.</div>
        ) : (
          <ul className="divide-y divide-white/5">
            {suppliers.map(s => (
              <li key={s.id} className="px-3 py-2 hover:bg-white/[0.03]">
                <div className="flex items-center gap-2 mb-1">
                  <Building2 className="w-3.5 h-3.5 text-violet-300" />
                  <span className="text-sm text-white">{s.name}</span>
                  <span className="text-[10px] text-gray-500">{s.email}</span>
                  <span className="ml-auto text-[10px] text-gray-400 font-mono">${s.spendUsd.toLocaleString()}/yr</span>
                  <span className={cn('text-[9px] uppercase px-1.5 py-0.5 rounded', STATUS_COLOUR[s.invitationStatus])}>{s.invitationStatus.replace('_', ' ')}</span>
                </div>
                {s.reportedCo2eTonnes != null && (
                  <div className="text-[10px] text-emerald-300 ml-5">Reported {s.reportedCo2eTonnes.toLocaleString()} tCO₂e for {s.reportingYear} ({s.lastReportedAt?.slice(0, 10)})</div>
                )}
                <div className="mt-1 flex items-center gap-2">
                  {s.invitationStatus === 'not_invited' && (
                    <button onClick={() => invite(s.id)} className="px-2 py-0.5 text-[10px] rounded bg-violet-500/30 text-violet-300 hover:bg-violet-500/50 inline-flex items-center gap-1"><Send className="w-2.5 h-2.5" />Invite</button>
                  )}
                  {s.invitationStatus === 'invited' && s.portalToken && (
                    <>
                      <button onClick={() => { navigator.clipboard?.writeText(window.location.origin + '/supplier-portal/' + s.portalToken); }} className="px-2 py-0.5 text-[10px] rounded bg-cyan-500/30 text-cyan-300 hover:bg-cyan-500/50 inline-flex items-center gap-1"><Copy className="w-2.5 h-2.5" />Copy portal link</button>
                    </>
                  )}
                  {s.invitationStatus !== 'responded' && (
                    <button onClick={() => setDiscloseFor(s.id)} className="px-2 py-0.5 text-[10px] rounded bg-emerald-500/30 text-emerald-300 hover:bg-emerald-500/50">Record disclosure</button>
                  )}
                </div>
                {discloseFor === s.id && (
                  <div className="mt-2 ml-5 flex items-center gap-2">
                    <input type="number" value={discloseTonnes} onChange={e => setDiscloseTonnes(e.target.value)} placeholder="Total tCO₂e for prior year" className="flex-1 px-2 py-1 text-[11px] bg-lattice-deep border border-lattice-border rounded text-white" autoFocus />
                    <button onClick={recordDisclosure} className="px-3 py-1 text-[11px] rounded bg-emerald-500 text-black font-bold hover:bg-emerald-400">Save</button>
                    <button onClick={() => { setDiscloseFor(null); setDiscloseTonnes(''); }} className="px-2 py-1 text-[11px] text-gray-400">×</button>
                  </div>
                )}
              </li>
            ))}
          </ul>
        )}
      </div>
    </div>
  );
}

export default SuppliersPortal;
