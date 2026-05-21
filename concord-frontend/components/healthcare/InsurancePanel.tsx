'use client';

/**
 * InsurancePanel — coverage policies + eligibility verification +
 * claims/billing workflow. Backend: healthcare.coverage-list /
 * coverage-add / coverage-verify / claim-create / claim-list /
 * claim-submit / claim-adjudicate.
 */

import { useEffect, useState, useCallback } from 'react';
import { ShieldCheck, Loader2, Plus, CheckCircle, Send, FileText, Trash2 } from 'lucide-react';
import { lensRun } from '@/lib/api/client';
import { cn } from '@/lib/utils';

interface Policy {
  id: string; patientId: string; payer: string; memberId: string;
  groupNumber: string; planName: string; planType: string;
  copayUsd: number | null; deductibleUsd: number | null; deductibleMetUsd: number;
  effectiveDate: string; eligibilityStatus: string; verifiedAt: string | null;
}
interface ClaimLine { cpt: string; description: string; units: number; chargeUsd: number }
interface Claim {
  id: string; claimNumber: string; patientId: string; encounterId: string;
  coverageId: string; diagnosisCodes: string[]; lines: ClaimLine[];
  totalChargeUsd: number; allowedUsd: number | null; paidUsd: number | null;
  patientResponsibilityUsd: number | null;
  status: 'draft' | 'submitted' | 'paid' | 'partial' | 'denied';
  denialReason: string; submittedAt: string | null; adjudicatedAt: string | null;
}

const PLAN_TYPES = ['PPO', 'HMO', 'EPO', 'POS', 'HDHP', 'Medicare', 'Medicaid', 'other'];
const CLAIM_STATUS_STYLE: Record<Claim['status'], string> = {
  draft: 'bg-gray-500/20 text-gray-300',
  submitted: 'bg-cyan-500/20 text-cyan-300',
  paid: 'bg-emerald-500/20 text-emerald-300',
  partial: 'bg-amber-500/20 text-amber-300',
  denied: 'bg-rose-500/20 text-rose-300',
};

export function InsurancePanel({ patientId }: { patientId: string }) {
  const [policies, setPolicies] = useState<Policy[]>([]);
  const [claims, setClaims] = useState<Claim[]>([]);
  const [outstanding, setOutstanding] = useState(0);
  const [loading, setLoading] = useState(true);
  const [addingPolicy, setAddingPolicy] = useState(false);
  const [addingClaim, setAddingClaim] = useState(false);
  const [policyDraft, setPolicyDraft] = useState({ payer: '', memberId: '', planName: '', planType: 'PPO', copayUsd: '', deductibleUsd: '' });
  const [lines, setLines] = useState<ClaimLine[]>([{ cpt: '', description: '', units: 1, chargeUsd: 0 }]);
  const [dxCodes, setDxCodes] = useState('');
  const [adjudicate, setAdjudicate] = useState<{ id: string; allowedUsd: string; paidUsd: string; denialReason: string } | null>(null);

  const refresh = useCallback(async () => {
    setLoading(true);
    try {
      const [c, cl] = await Promise.all([
        lensRun('healthcare', 'coverage-list', { patientId }),
        lensRun('healthcare', 'claim-list', { patientId }),
      ]);
      if (c.data?.ok) setPolicies((c.data.result.policies || []) as Policy[]);
      if (cl.data?.ok) {
        setClaims((cl.data.result.claims || []) as Claim[]);
        setOutstanding(cl.data.result.outstandingUsd || 0);
      }
    } catch (e) { console.error('[Insurance] refresh', e); }
    finally { setLoading(false); }
  }, [patientId]);

  useEffect(() => { refresh(); }, [refresh]);

  async function addPolicy() {
    if (!policyDraft.payer.trim() || !policyDraft.memberId.trim()) return;
    try {
      const r = await lensRun('healthcare', 'coverage-add', {
        patientId,
        payer: policyDraft.payer.trim(),
        memberId: policyDraft.memberId.trim(),
        planName: policyDraft.planName.trim(),
        planType: policyDraft.planType,
        copayUsd: policyDraft.copayUsd ? Number(policyDraft.copayUsd) : undefined,
        deductibleUsd: policyDraft.deductibleUsd ? Number(policyDraft.deductibleUsd) : undefined,
      });
      if (r.data?.ok) {
        setPolicyDraft({ payer: '', memberId: '', planName: '', planType: 'PPO', copayUsd: '', deductibleUsd: '' });
        setAddingPolicy(false);
        await refresh();
      }
    } catch (e) { console.error('[Insurance] addPolicy', e); }
  }

  async function verify(id: string) {
    try {
      const r = await lensRun('healthcare', 'coverage-verify', { id });
      if (r.data?.ok) await refresh();
    } catch (e) { console.error('[Insurance] verify', e); }
  }

  async function createClaim() {
    const valid = lines.filter(l => l.cpt.trim());
    if (valid.length === 0) return;
    try {
      const r = await lensRun('healthcare', 'claim-create', {
        patientId,
        lines: valid,
        diagnosisCodes: dxCodes.split(',').map(s => s.trim()).filter(Boolean),
      });
      if (r.data?.ok) {
        setLines([{ cpt: '', description: '', units: 1, chargeUsd: 0 }]);
        setDxCodes('');
        setAddingClaim(false);
        await refresh();
      }
    } catch (e) { console.error('[Insurance] createClaim', e); }
  }

  async function submitClaim(id: string) {
    try {
      const r = await lensRun('healthcare', 'claim-submit', { id });
      if (r.data?.ok) await refresh();
    } catch (e) { console.error('[Insurance] submitClaim', e); }
  }

  async function runAdjudicate() {
    if (!adjudicate) return;
    try {
      const r = await lensRun('healthcare', 'claim-adjudicate', {
        id: adjudicate.id,
        allowedUsd: Number(adjudicate.allowedUsd) || 0,
        paidUsd: Number(adjudicate.paidUsd) || 0,
        denialReason: adjudicate.denialReason.trim(),
      });
      if (r.data?.ok) { setAdjudicate(null); await refresh(); }
    } catch (e) { console.error('[Insurance] adjudicate', e); }
  }

  function updateLine(idx: number, patch: Partial<ClaimLine>) {
    setLines(ls => ls.map((l, i) => i === idx ? { ...l, ...patch } : l));
  }

  return (
    <div className="space-y-4">
      {/* Coverage policies */}
      <div className="bg-[#0d1117] border border-cyan-500/15 rounded-lg overflow-hidden">
        <header className="px-4 py-2.5 border-b border-white/10 flex items-center gap-2">
          <ShieldCheck className="w-4 h-4 text-cyan-400" />
          <span className="text-sm font-semibold text-gray-200">Insurance coverage</span>
          <span className="text-[10px] text-gray-500">{policies.length}</span>
          <button onClick={() => setAddingPolicy(v => !v)} className="ml-auto px-2.5 py-1 text-xs rounded bg-cyan-500 text-black font-semibold hover:bg-cyan-400 inline-flex items-center gap-1">
            <Plus className="w-3 h-3" />Add policy
          </button>
        </header>

        {addingPolicy && (
          <div className="p-3 grid grid-cols-12 gap-2 border-b border-white/10">
            <input value={policyDraft.payer} onChange={e => setPolicyDraft({ ...policyDraft, payer: e.target.value })} placeholder="Payer *" className="col-span-4 px-2 py-1.5 text-xs bg-lattice-deep border border-lattice-border rounded text-white" />
            <input value={policyDraft.memberId} onChange={e => setPolicyDraft({ ...policyDraft, memberId: e.target.value })} placeholder="Member ID *" className="col-span-4 px-2 py-1.5 text-xs bg-lattice-deep border border-lattice-border rounded text-white" />
            <select value={policyDraft.planType} onChange={e => setPolicyDraft({ ...policyDraft, planType: e.target.value })} className="col-span-4 px-2 py-1.5 text-xs bg-lattice-deep border border-lattice-border rounded text-white">
              {PLAN_TYPES.map(t => <option key={t} value={t}>{t}</option>)}
            </select>
            <input value={policyDraft.planName} onChange={e => setPolicyDraft({ ...policyDraft, planName: e.target.value })} placeholder="Plan name" className="col-span-4 px-2 py-1.5 text-xs bg-lattice-deep border border-lattice-border rounded text-white" />
            <input type="number" value={policyDraft.copayUsd} onChange={e => setPolicyDraft({ ...policyDraft, copayUsd: e.target.value })} placeholder="Copay $" className="col-span-3 px-2 py-1.5 text-xs bg-lattice-deep border border-lattice-border rounded text-white" />
            <input type="number" value={policyDraft.deductibleUsd} onChange={e => setPolicyDraft({ ...policyDraft, deductibleUsd: e.target.value })} placeholder="Deductible $" className="col-span-3 px-2 py-1.5 text-xs bg-lattice-deep border border-lattice-border rounded text-white" />
            <button onClick={addPolicy} className="col-span-2 px-3 py-1.5 text-xs rounded bg-cyan-500 text-black font-bold hover:bg-cyan-400">Save</button>
          </div>
        )}

        {loading ? (
          <div className="flex items-center justify-center py-8 text-xs text-gray-500"><Loader2 className="w-4 h-4 animate-spin mr-2" /> Loading…</div>
        ) : policies.length === 0 ? (
          <div className="px-3 py-8 text-center text-xs text-gray-500">No coverage on file.</div>
        ) : (
          <ul className="divide-y divide-white/5">
            {policies.map(p => (
              <li key={p.id} className="px-4 py-2.5 flex items-center gap-3">
                <span className={cn('text-[9px] uppercase px-1.5 py-0.5 rounded font-mono',
                  p.eligibilityStatus === 'active' ? 'bg-emerald-500/20 text-emerald-300' :
                  p.eligibilityStatus === 'incomplete' ? 'bg-rose-500/20 text-rose-300' :
                  'bg-gray-500/20 text-gray-300')}>{p.eligibilityStatus}</span>
                <div className="flex-1 min-w-0">
                  <div className="text-sm text-white truncate">{p.payer} <span className="text-[10px] text-gray-500">{p.planType}{p.planName && ` · ${p.planName}`}</span></div>
                  <div className="text-[10px] text-gray-500 truncate">
                    Member {p.memberId}
                    {p.copayUsd != null && ` · copay $${p.copayUsd}`}
                    {p.deductibleUsd != null && ` · deductible $${p.deductibleUsd}`}
                  </div>
                </div>
                <button onClick={() => verify(p.id)} className="px-2 py-0.5 text-[10px] rounded bg-cyan-500/20 text-cyan-300 hover:bg-cyan-500/30 inline-flex items-center gap-0.5"><CheckCircle className="w-3 h-3" />Verify eligibility</button>
              </li>
            ))}
          </ul>
        )}
      </div>

      {/* Claims */}
      <div className="bg-[#0d1117] border border-cyan-500/15 rounded-lg overflow-hidden">
        <header className="px-4 py-2.5 border-b border-white/10 flex items-center gap-2">
          <FileText className="w-4 h-4 text-cyan-400" />
          <span className="text-sm font-semibold text-gray-200">Claims &amp; billing</span>
          <span className="text-[10px] text-gray-500">{claims.length}</span>
          {outstanding > 0 && <span className="text-[10px] text-amber-300">outstanding ${outstanding.toFixed(2)}</span>}
          <button onClick={() => setAddingClaim(v => !v)} className="ml-auto px-2.5 py-1 text-xs rounded bg-cyan-500 text-black font-semibold hover:bg-cyan-400 inline-flex items-center gap-1">
            <Plus className="w-3 h-3" />New claim
          </button>
        </header>

        {addingClaim && (
          <div className="p-3 space-y-2 border-b border-white/10">
            {lines.map((l, i) => (
              <div key={i} className="grid grid-cols-12 gap-2">
                <input value={l.cpt} onChange={e => updateLine(i, { cpt: e.target.value })} placeholder="CPT *" className="col-span-2 px-2 py-1.5 text-xs bg-lattice-deep border border-lattice-border rounded text-white" />
                <input value={l.description} onChange={e => updateLine(i, { description: e.target.value })} placeholder="Description" className="col-span-5 px-2 py-1.5 text-xs bg-lattice-deep border border-lattice-border rounded text-white" />
                <input type="number" min={1} value={l.units} onChange={e => updateLine(i, { units: Number(e.target.value) || 1 })} placeholder="Units" className="col-span-2 px-2 py-1.5 text-xs bg-lattice-deep border border-lattice-border rounded text-white" />
                <input type="number" value={l.chargeUsd} onChange={e => updateLine(i, { chargeUsd: Number(e.target.value) || 0 })} placeholder="Charge $" className="col-span-2 px-2 py-1.5 text-xs bg-lattice-deep border border-lattice-border rounded text-white" />
                {lines.length > 1 && (
                  <button onClick={() => setLines(ls => ls.filter((_, idx) => idx !== i))} className="col-span-1 flex items-center justify-center text-rose-400 hover:text-rose-300" aria-label="Remove line"><Trash2 className="w-3.5 h-3.5" /></button>
                )}
              </div>
            ))}
            <div className="grid grid-cols-12 gap-2">
              <button onClick={() => setLines(ls => [...ls, { cpt: '', description: '', units: 1, chargeUsd: 0 }])} className="col-span-3 px-2 py-1.5 text-xs rounded bg-white/5 text-gray-300 hover:bg-white/10">+ Line item</button>
              <input value={dxCodes} onChange={e => setDxCodes(e.target.value)} placeholder="Dx codes (comma sep)" className="col-span-6 px-2 py-1.5 text-xs bg-lattice-deep border border-lattice-border rounded text-white" />
              <button onClick={createClaim} className="col-span-3 px-3 py-1.5 text-xs rounded bg-cyan-500 text-black font-bold hover:bg-cyan-400">Create draft</button>
            </div>
          </div>
        )}

        {claims.length === 0 ? (
          <div className="px-3 py-8 text-center text-xs text-gray-500">No claims yet.</div>
        ) : (
          <ul className="divide-y divide-white/5">
            {claims.map(c => (
              <li key={c.id} className="px-4 py-2.5">
                <div className="flex items-center gap-3">
                  <span className={cn('text-[9px] uppercase px-1.5 py-0.5 rounded font-mono', CLAIM_STATUS_STYLE[c.status])}>{c.status}</span>
                  <div className="flex-1 min-w-0">
                    <div className="text-sm text-white truncate font-mono">{c.claimNumber}</div>
                    <div className="text-[10px] text-gray-500 truncate">
                      {c.lines.length} line{c.lines.length === 1 ? '' : 's'} · charge ${c.totalChargeUsd.toFixed(2)}
                      {c.paidUsd != null && ` · paid $${c.paidUsd.toFixed(2)}`}
                      {c.patientResponsibilityUsd != null && c.patientResponsibilityUsd > 0 && ` · patient $${c.patientResponsibilityUsd.toFixed(2)}`}
                      {c.denialReason && ` · ${c.denialReason}`}
                    </div>
                  </div>
                  {c.status === 'draft' && (
                    <button onClick={() => submitClaim(c.id)} className="px-2 py-0.5 text-[10px] rounded bg-cyan-500 text-black font-bold hover:bg-cyan-400 inline-flex items-center gap-0.5"><Send className="w-3 h-3" />Submit</button>
                  )}
                  {c.status === 'submitted' && (
                    <button onClick={() => setAdjudicate({ id: c.id, allowedUsd: '', paidUsd: '', denialReason: '' })} className="px-2 py-0.5 text-[10px] rounded bg-amber-500/20 text-amber-300 hover:bg-amber-500/30">Adjudicate</button>
                  )}
                </div>
                {adjudicate?.id === c.id && (
                  <div className="mt-2 grid grid-cols-12 gap-2">
                    <input type="number" value={adjudicate.allowedUsd} onChange={e => setAdjudicate({ ...adjudicate, allowedUsd: e.target.value })} placeholder="Allowed $" className="col-span-3 px-2 py-1.5 text-xs bg-lattice-deep border border-lattice-border rounded text-white" />
                    <input type="number" value={adjudicate.paidUsd} onChange={e => setAdjudicate({ ...adjudicate, paidUsd: e.target.value })} placeholder="Paid $" className="col-span-3 px-2 py-1.5 text-xs bg-lattice-deep border border-lattice-border rounded text-white" />
                    <input value={adjudicate.denialReason} onChange={e => setAdjudicate({ ...adjudicate, denialReason: e.target.value })} placeholder="Denial reason (if any)" className="col-span-4 px-2 py-1.5 text-xs bg-lattice-deep border border-lattice-border rounded text-white" />
                    <button onClick={runAdjudicate} className="col-span-2 px-3 py-1.5 text-xs rounded bg-cyan-500 text-black font-bold hover:bg-cyan-400">Post</button>
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

export default InsurancePanel;
