'use client';

import { useEffect, useState } from 'react';
import { FileText, Plus, Camera, Loader2, Clock, Check, X, DollarSign } from 'lucide-react';
import { lensRun } from '@/lib/api/client';
import { cn } from '@/lib/utils';

export interface Claim {
  id: string;
  policyId: string;
  carrier: string;
  kind: 'collision' | 'comprehensive' | 'property' | 'health' | 'life' | 'liability' | 'other';
  description: string;
  incidentDate: string;
  submittedDate?: string;
  status: 'draft' | 'submitted' | 'in_review' | 'approved' | 'paid' | 'denied';
  claimAmount: number;
  approvedAmount?: number;
  paidAmount?: number;
  daysSinceSubmit?: number;
  documents: number;
  adjusterName?: string;
}

const STATUS_COLORS: Record<Claim['status'], string> = {
  draft: 'bg-gray-500/20 text-gray-300',
  submitted: 'bg-blue-500/20 text-blue-300',
  in_review: 'bg-yellow-500/20 text-yellow-300',
  approved: 'bg-cyan-500/20 text-cyan-300',
  paid: 'bg-green-500/20 text-green-300',
  denied: 'bg-red-500/20 text-red-300',
};

export function ClaimTracker() {
  const [claims, setClaims] = useState<Claim[]>([]);
  const [loading, setLoading] = useState(true);
  const [adding, setAdding] = useState(false);
  const [draft, setDraft] = useState<Partial<Claim>>({ kind: 'collision', claimAmount: 0 });

  useEffect(() => { refresh(); }, []);

  async function refresh() {
    setLoading(true);
    try {
      const res = await lensRun({ domain: 'insurance', action: 'claim-list', input: {} });
      setClaims((res.data?.result?.claims || []) as Claim[]);
    } catch (e) { console.error('[Claims] failed', e); }
    finally { setLoading(false); }
  }

  async function fileNew() {
    if (!draft.carrier?.trim() || !draft.description?.trim()) return;
    try {
      await lensRun({ domain: 'insurance', action: 'claim-file', input: draft });
      setDraft({ kind: 'collision', claimAmount: 0 });
      setAdding(false);
      await refresh();
    } catch (e) { console.error('[Claim] file failed', e); }
  }

  return (
    <div className="bg-[#0d1117] border border-cyan-500/20 rounded-lg overflow-hidden">
      <header className="px-4 py-2 border-b border-white/10 flex items-center gap-2">
        <FileText className="w-4 h-4 text-cyan-400" />
        <span className="text-xs uppercase font-semibold text-gray-300 tracking-wider">Claims</span>
        <span className="ml-auto text-[10px] text-gray-400">{claims.length} claims</span>
        <button onClick={() => setAdding(v => !v)} className="p-1 text-gray-400 hover:text-white" title="File new claim">
          <Plus className="w-4 h-4" />
        </button>
      </header>

      {adding && (
        <div className="p-3 border-b border-white/10 space-y-2 text-xs">
          <div className="grid grid-cols-3 gap-2">
            <select value={draft.kind} onChange={e => setDraft({ ...draft, kind: e.target.value as Claim['kind'] })} className="px-2 py-1.5 bg-lattice-deep border border-lattice-border rounded text-white">
              <option value="collision">Collision</option>
              <option value="comprehensive">Comprehensive</option>
              <option value="property">Property</option>
              <option value="health">Health</option>
              <option value="liability">Liability</option>
              <option value="other">Other</option>
            </select>
            <input value={draft.carrier || ''} onChange={e => setDraft({ ...draft, carrier: e.target.value })} placeholder="Carrier" className="px-2 py-1.5 bg-lattice-deep border border-lattice-border rounded text-white" />
            <input type="number" value={draft.claimAmount || 0} onChange={e => setDraft({ ...draft, claimAmount: Number(e.target.value) })} placeholder="Amount $" className="px-2 py-1.5 bg-lattice-deep border border-lattice-border rounded text-white" />
          </div>
          <textarea value={draft.description || ''} onChange={e => setDraft({ ...draft, description: e.target.value })} placeholder="Describe what happened…" rows={3} className="w-full px-2 py-1.5 bg-lattice-deep border border-lattice-border rounded text-white resize-y" />
          <input type="date" value={draft.incidentDate || ''} onChange={e => setDraft({ ...draft, incidentDate: e.target.value })} className="px-2 py-1.5 bg-lattice-deep border border-lattice-border rounded text-white" />
          <div className="flex items-center gap-2">
            <button onClick={fileNew} className="px-3 py-1 text-xs rounded bg-cyan-500 text-black font-bold hover:bg-cyan-400">File claim</button>
            <button onClick={() => setAdding(false)} className="px-3 py-1 text-xs rounded border border-white/10 text-gray-400 hover:text-white">Cancel</button>
            <button type="button" disabled aria-label="Attach photos (coming soon)" title="Photo attachments coming soon" className="ml-auto inline-flex items-center gap-1 px-2 py-1 text-[10px] rounded border border-white/10 text-gray-400 cursor-not-allowed">
              <Camera className="w-3 h-3" /> Attach photos (soon)
            </button>
          </div>
        </div>
      )}

      <div className="max-h-[500px] overflow-y-auto">
        {loading ? (
          <div className="flex items-center justify-center py-6 text-xs text-gray-400"><Loader2 className="w-4 h-4 animate-spin mr-2" /> Loading…</div>
        ) : claims.length === 0 ? (
          <div className="px-3 py-10 text-center text-xs text-gray-400"><FileText className="w-6 h-6 mx-auto mb-2 opacity-30" /> No claims filed. Hit + when you need to file one.</div>
        ) : (
          <ul className="divide-y divide-white/5">
            {claims.map(c => {
              const STATUS_ICON: Record<Claim['status'], React.ReactNode> = {
                draft: <FileText className="w-3.5 h-3.5 text-gray-400" />,
                submitted: <Clock className="w-3.5 h-3.5 text-blue-400" />,
                in_review: <Loader2 className="w-3.5 h-3.5 text-yellow-400 animate-spin" />,
                approved: <Check className="w-3.5 h-3.5 text-cyan-400" />,
                paid: <DollarSign className="w-3.5 h-3.5 text-green-400" />,
                denied: <X className="w-3.5 h-3.5 text-red-400" />,
              };
              return (
                <li key={c.id} className="px-3 py-2 hover:bg-white/[0.03]">
                  <div className="flex items-center gap-2">
                    {STATUS_ICON[c.status]}
                    <span className="text-sm text-white font-medium">{c.carrier} #{c.id.slice(-6)}</span>
                    <span className={cn('text-[9px] uppercase tracking-wider px-1.5 py-0.5 rounded font-bold', STATUS_COLORS[c.status])}>{c.status.replace(/_/g, ' ')}</span>
                    <span className="ml-auto text-sm font-mono tabular-nums">
                      <span className="text-cyan-300">${c.claimAmount.toFixed(0)}</span>
                      {c.paidAmount != null && <span className="text-green-400"> → ${c.paidAmount.toFixed(0)}</span>}
                    </span>
                  </div>
                  <p className="text-xs text-gray-300 mt-1 line-clamp-2">{c.description}</p>
                  <div className="text-[10px] text-gray-400 mt-1 flex items-center gap-3">
                    <span>{c.kind} · incident {new Date(c.incidentDate).toLocaleDateString()}</span>
                    {c.daysSinceSubmit != null && <span>{c.daysSinceSubmit}d in pipeline</span>}
                    {c.adjusterName && <span>Adjuster: {c.adjusterName}</span>}
                    <span>{c.documents} docs</span>
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

export default ClaimTracker;
