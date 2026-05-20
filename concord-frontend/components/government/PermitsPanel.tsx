'use client';

import { useEffect, useState } from 'react';
import { FileText, Plus, Loader2, CreditCard, Check, X, Send } from 'lucide-react';
import { lensRun } from '@/lib/api/client';
import { cn } from '@/lib/utils';

interface Permit {
  id: string; recordNumber: string; kind: string; description: string;
  applicantName: string; applicantEmail: string; applicantPhone: string;
  siteAddress: string; feeUsd: number; paid: boolean;
  status: 'applied' | 'under_review' | 'approved' | 'issued' | 'denied';
  inspectionIds: string[]; denialReason?: string;
  submittedAt: string; approvedAt?: string; issuedAt?: string; expiresAt?: string;
}

const STATUS_COLOUR: Record<Permit['status'], string> = {
  applied: 'bg-gray-500/15 text-gray-300',
  under_review: 'bg-amber-500/15 text-amber-300',
  approved: 'bg-cyan-500/15 text-cyan-300',
  issued: 'bg-emerald-500/15 text-emerald-300',
  denied: 'bg-rose-500/15 text-rose-300',
};

export function PermitsPanel() {
  const [permits, setPermits] = useState<Permit[]>([]);
  const [loading, setLoading] = useState(true);
  const [form, setForm] = useState({ applicantName: '', applicantEmail: '', applicantPhone: '', kind: 'building_residential', description: '', siteAddress: '', feeUsd: '0' });

  useEffect(() => { refresh(); }, []);

  async function refresh() {
    setLoading(true);
    try {
      const res = await lensRun({ domain: 'government', action: 'permits-list', input: {} });
      setPermits((res.data?.result?.permits || []) as Permit[]);
    } catch (e) { console.error('[Permits] failed', e); }
    finally { setLoading(false); }
  }

  async function apply() {
    if (!form.applicantName.trim() || !form.applicantEmail.trim() || !form.kind.trim()) return;
    try {
      await lensRun({ domain: 'government', action: 'permits-apply', input: { ...form, feeUsd: Number(form.feeUsd) || 0 } });
      setForm({ applicantName: '', applicantEmail: '', applicantPhone: '', kind: 'building_residential', description: '', siteAddress: '', feeUsd: '0' });
      await refresh();
    } catch (e) { console.error('[Permits] apply', e); }
  }

  async function action(id: string, act: 'pay-fee' | 'approve' | 'issue' | 'deny') {
    const reason = act === 'deny' ? prompt('Denial reason?') : null;
    try {
      const input: Record<string, unknown> = { id };
      if (act === 'deny' && reason) input.reason = reason;
      if (act === 'issue') input.validForDays = 365;
      const res = await lensRun({ domain: 'government', action: `permits-${act}`, input });
      if (res.data?.ok === false) alert(res.data?.error);
      await refresh();
    } catch (e) { console.error('[Permits]', act, e); }
  }

  return (
    <div className="bg-[#0d1117] border border-violet-500/20 rounded-lg overflow-hidden">
      <header className="px-4 py-2 border-b border-white/10 flex items-center gap-2">
        <FileText className="w-4 h-4 text-violet-400" />
        <span className="text-xs uppercase font-semibold text-gray-300 tracking-wider">Permits</span>
        <span className="ml-auto text-[10px] text-gray-500">{permits.length}</span>
      </header>
      <div className="p-3 border-b border-white/10 grid grid-cols-4 gap-2">
        <input value={form.applicantName} onChange={e => setForm({ ...form, applicantName: e.target.value })} placeholder="Applicant name" className="col-span-2 px-2 py-1.5 text-xs bg-lattice-deep border border-lattice-border rounded text-white" />
        <input value={form.applicantEmail} onChange={e => setForm({ ...form, applicantEmail: e.target.value })} placeholder="Email" className="col-span-2 px-2 py-1.5 text-xs bg-lattice-deep border border-lattice-border rounded text-white" />
        <input value={form.kind} onChange={e => setForm({ ...form, kind: e.target.value })} placeholder="Kind (building / fence / business_license / event)" className="col-span-2 px-2 py-1.5 text-xs bg-lattice-deep border border-lattice-border rounded text-white" />
        <input value={form.siteAddress} onChange={e => setForm({ ...form, siteAddress: e.target.value })} placeholder="Site address" className="col-span-2 px-2 py-1.5 text-xs bg-lattice-deep border border-lattice-border rounded text-white" />
        <input value={form.description} onChange={e => setForm({ ...form, description: e.target.value })} placeholder="Description" className="col-span-3 px-2 py-1.5 text-xs bg-lattice-deep border border-lattice-border rounded text-white" />
        <input type="number" value={form.feeUsd} onChange={e => setForm({ ...form, feeUsd: e.target.value })} placeholder="Fee $" className="px-2 py-1.5 text-xs bg-lattice-deep border border-lattice-border rounded text-white" />
        <button onClick={apply} className="col-span-4 px-3 py-1.5 text-xs rounded bg-violet-500 text-white font-bold hover:bg-violet-400 inline-flex items-center justify-center gap-1"><Plus className="w-3 h-3" />Apply for permit</button>
      </div>
      <div className="max-h-96 overflow-y-auto">
        {loading ? (
          <div className="flex items-center justify-center py-6 text-xs text-gray-500"><Loader2 className="w-4 h-4 animate-spin mr-2" /> Loading…</div>
        ) : permits.length === 0 ? (
          <div className="px-3 py-10 text-center text-xs text-gray-500"><FileText className="w-6 h-6 mx-auto mb-2 opacity-30" />No permits yet.</div>
        ) : (
          <ul className="divide-y divide-white/5">
            {permits.map(p => (
              <li key={p.id} className="px-3 py-2 hover:bg-white/[0.03]">
                <div className="flex items-center gap-2 mb-1">
                  <span className="text-[10px] font-mono text-violet-300">{p.recordNumber}</span>
                  <span className={cn('text-[9px] uppercase px-1.5 py-0.5 rounded', STATUS_COLOUR[p.status])}>{p.status.replace(/_/g, ' ')}</span>
                  <span className="text-sm text-white">{p.kind}</span>
                  <span className="ml-auto text-[10px] text-gray-500">{p.applicantName} · ${p.feeUsd} {p.paid ? 'paid' : 'unpaid'}</span>
                </div>
                {p.description && <div className="text-[11px] text-gray-400 mb-1">{p.description}</div>}
                <div className="flex items-center gap-1">
                  {p.status === 'applied' && !p.paid && <button onClick={() => action(p.id, 'pay-fee')} className="px-2 py-0.5 text-[10px] rounded bg-emerald-500/30 text-emerald-300 hover:bg-emerald-500/50 inline-flex items-center gap-1"><CreditCard className="w-2.5 h-2.5" />Pay fee</button>}
                  {p.status === 'under_review' && <button onClick={() => action(p.id, 'approve')} className="px-2 py-0.5 text-[10px] rounded bg-cyan-500/30 text-cyan-300 hover:bg-cyan-500/50 inline-flex items-center gap-1"><Check className="w-2.5 h-2.5" />Approve</button>}
                  {p.status === 'approved' && <button onClick={() => action(p.id, 'issue')} className="px-2 py-0.5 text-[10px] rounded bg-emerald-500/30 text-emerald-300 hover:bg-emerald-500/50 inline-flex items-center gap-1"><Send className="w-2.5 h-2.5" />Issue</button>}
                  {p.status !== 'issued' && p.status !== 'denied' && <button onClick={() => action(p.id, 'deny')} className="px-2 py-0.5 text-[10px] rounded bg-rose-500/30 text-rose-300 hover:bg-rose-500/50 inline-flex items-center gap-1"><X className="w-2.5 h-2.5" />Deny</button>}
                  {p.expiresAt && <span className="ml-auto text-[10px] text-gray-500">Expires {p.expiresAt.slice(0, 10)}</span>}
                </div>
                {p.denialReason && <div className="mt-1 text-[10px] text-rose-300">Denial reason: {p.denialReason}</div>}
              </li>
            ))}
          </ul>
        )}
      </div>
    </div>
  );
}

export default PermitsPanel;
