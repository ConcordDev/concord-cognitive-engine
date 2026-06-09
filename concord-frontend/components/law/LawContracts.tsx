'use client';

/**
 * LawContracts — Ironclad / LegalZoom 2026-shape contract lifecycle
 * workbench: draft contracts, compose from a clause library, run a
 * risk review, sign, and track to expiry. Wires the law.contract-*,
 * law.clause-* and law.contract-dashboard macros.
 */

import { useCallback, useEffect, useImperativeHandle, forwardRef, useState } from 'react';
import {
  FileText, Plus, Trash2, ShieldCheck, PenLine, Loader2, AlertTriangle, X,
  History, Users, PenTool, ScanText,
} from 'lucide-react';
import { lensRun } from '@/lib/api/client';
import { cn } from '@/lib/utils';
import { ContractVersions } from './ContractVersions';
import { ApprovalWorkflow } from './ApprovalWorkflow';
import { ContractEsign } from './ContractEsign';
import { ClauseExtractor } from './ClauseExtractor';

interface ContractSummary {
  id: string; title: string; type: string; counterparty: string; value: number;
  status: string; clauseCount: number; signatureCount: number; expiryDate: string | null;
}
interface Clause { id: string; category: string; title: string; text: string }
interface Signature { party: string; signedAt: string }
interface Contract extends ContractSummary {
  clauses: Clause[]; signatures: Signature[]; effectiveDate: string | null;
}
interface Review { riskScore: number; grade: string; findings: { severity: string; message: string }[] }
interface Dash { total: number; totalValue: number; expiringSoon: number; unsigned: number; byStatus: Record<string, number> }
interface LibraryClause { title: string; text: string }

const TYPES = ['nda', 'services', 'employment', 'license', 'lease', 'sale', 'partnership', 'other'];
const STATUSES = ['draft', 'in_review', 'sent', 'signed', 'active', 'expired', 'terminated'];

type DetailTab = 'clauses' | 'versions' | 'approvals' | 'esign' | 'extract';

export interface LawContractsHandle {
  refresh: () => Promise<void>;
  open: (id: string) => Promise<void>;
}

export const LawContracts = forwardRef<LawContractsHandle, { onContractsChange?: (c: { id: string; title: string }[]) => void }>(
  function LawContracts({ onContractsChange }, ref) {
  const [contracts, setContracts] = useState<ContractSummary[]>([]);
  const [dash, setDash] = useState<Dash | null>(null);
  const [active, setActive] = useState<Contract | null>(null);
  const [review, setReview] = useState<Review | null>(null);
  const [library, setLibrary] = useState<Record<string, LibraryClause[]>>({});
  const [loading, setLoading] = useState(true);
  const [showNew, setShowNew] = useState(false);
  const [nt, setNt] = useState({ title: '', type: 'services', counterparty: '' });
  const [tab, setTab] = useState<DetailTab>('clauses');

  const refresh = useCallback(async () => {
    const [cl, d] = await Promise.all([
      lensRun('law', 'contract-list', {}),
      lensRun('law', 'contract-dashboard', {}),
    ]);
    const list = (cl.data?.result?.contracts as ContractSummary[]) || [];
    setContracts(list);
    setDash((d.data?.result as Dash) || null);
    setLoading(false);
    onContractsChange?.(list.map((c) => ({ id: c.id, title: c.title })));
  }, [onContractsChange]);

  useEffect(() => {
    void refresh();
    void lensRun('law', 'clause-library', {}).then(r => setLibrary((r.data?.result?.library as Record<string, LibraryClause[]>) || {}));
  }, [refresh]);

  const openContract = useCallback(async (id: string) => {
    const r = await lensRun('law', 'contract-detail', { id });
    if (r.data?.ok) { setActive(r.data.result?.contract as Contract); setReview(null); setTab('clauses'); }
  }, []);

  useImperativeHandle(ref, () => ({ refresh, open: openContract }), [refresh, openContract]);
  async function reloadActive() {
    if (!active) return;
    const r = await lensRun('law', 'contract-detail', { id: active.id });
    if (r.data?.ok) setActive(r.data.result?.contract as Contract);
  }

  async function create() {
    if (!nt.title.trim()) return;
    const r = await lensRun('law', 'contract-create', nt);
    if (r.data?.ok) {
      setShowNew(false); setNt({ title: '', type: 'services', counterparty: '' });
      await refresh();
      await openContract(r.data.result?.contract.id);
    }
  }
  async function remove(id: string) {
    if (!confirm('Delete this contract?')) return;
    await lensRun('law', 'contract-delete', { id });
    if (active?.id === id) setActive(null);
    await refresh();
  }
  async function addClause(category: string, c: LibraryClause) {
    if (!active) return;
    await lensRun('law', 'clause-add', { contractId: active.id, category, title: c.title, text: c.text });
    await reloadActive(); await refresh();
  }
  async function removeClause(clauseId: string) {
    if (!active) return;
    await lensRun('law', 'clause-remove', { contractId: active.id, clauseId });
    await reloadActive(); await refresh();
  }
  async function runReview() {
    if (!active) return;
    const r = await lensRun('law', 'contract-review', { id: active.id });
    if (r.data?.ok) setReview(r.data.result as Review);
  }
  async function sign() {
    if (!active) return;
    const party = prompt('Signing party name?');
    if (!party?.trim()) return;
    const r = await lensRun('law', 'contract-sign', { id: active.id, party: party.trim() });
    if (!r.data?.ok) alert(r.data?.error || 'Could not sign.');
    await reloadActive(); await refresh();
  }
  async function setStatus(status: string) {
    if (!active) return;
    await lensRun('law', 'contract-update', { id: active.id, status });
    await reloadActive(); await refresh();
  }

  if (loading) return <div className="flex items-center justify-center py-10 text-gray-400"><Loader2 className="w-5 h-5 animate-spin" /></div>;

  return (
    <div className="panel p-4">
      <div className="flex items-center gap-2 mb-3">
        <FileText className="w-4 h-4 text-neon-cyan" />
        <h2 className="font-semibold text-white">Contract Lifecycle</h2>
        <span className="text-[10px] text-gray-400">Ironclad shape</span>
        <button onClick={() => setShowNew(v => !v)} className="ml-auto px-2.5 py-1 text-xs rounded bg-neon-cyan/20 text-neon-cyan hover:bg-neon-cyan/30 inline-flex items-center gap-1">
          <Plus className="w-3 h-3" />New contract
        </button>
      </div>

      {dash && (
        <div className="grid grid-cols-4 gap-2 mb-3">
          {([['Contracts', dash.total], ['Value', `$${dash.totalValue.toLocaleString()}`],
             ['Expiring 30d', dash.expiringSoon], ['Unsigned', dash.unsigned]] as const).map(([l, v]) => (
            <div key={l} className="bg-black/40 border border-white/10 rounded-lg px-2 py-1.5 text-center">
              <p className="text-sm font-bold text-white">{v}</p>
              <p className="text-[9px] text-gray-400 uppercase tracking-wide">{l}</p>
            </div>
          ))}
        </div>
      )}

      {showNew && (
        <div className="bg-black/40 border border-neon-cyan/20 rounded-lg p-3 mb-3 space-y-2">
          <input value={nt.title} onChange={e => setNt({ ...nt, title: e.target.value })} placeholder="Contract title"
            className="w-full bg-black/50 border border-white/15 rounded px-2 py-1.5 text-sm text-white" />
          <div className="flex gap-2">
            <select value={nt.type} onChange={e => setNt({ ...nt, type: e.target.value })}
              className="bg-black/50 border border-white/15 rounded px-2 py-1.5 text-xs text-white capitalize">
              {TYPES.map(t => <option key={t} value={t}>{t}</option>)}
            </select>
            <input value={nt.counterparty} onChange={e => setNt({ ...nt, counterparty: e.target.value })} placeholder="Counterparty"
              className="flex-1 bg-black/50 border border-white/15 rounded px-2 py-1.5 text-xs text-white" />
            <button onClick={create} className="px-3 py-1.5 text-xs rounded bg-neon-cyan text-black font-bold">Create</button>
          </div>
        </div>
      )}

      <div className="grid md:grid-cols-[240px_1fr] gap-3">
        {/* Contract list */}
        <ul className="space-y-1 max-h-[420px] overflow-y-auto">
          {contracts.length === 0 && <li className="text-xs text-gray-400 italic py-4 text-center">No contracts yet.</li>}
          {contracts.map(c => (
            <li key={c.id}>
              <button onClick={() => openContract(c.id)}
                className={cn('w-full text-left rounded-lg px-2.5 py-2 border', active?.id === c.id ? 'bg-neon-cyan/10 border-neon-cyan/40' : 'bg-black/30 border-white/10 hover:border-white/20')}>
                <p className="text-xs font-semibold text-white truncate">{c.title}</p>
                <p className="text-[10px] text-gray-400">{c.counterparty} · {c.clauseCount} clauses</p>
                <span className={cn('text-[9px] px-1.5 py-0.5 rounded mt-1 inline-block',
                  c.status === 'signed' || c.status === 'active' ? 'bg-neon-green/20 text-neon-green' : 'bg-white/10 text-gray-400')}>
                  {c.status}
                </span>
              </button>
            </li>
          ))}
        </ul>

        {/* Detail */}
        {active ? (
          <div className="bg-black/30 border border-white/10 rounded-lg p-3 space-y-3">
            <div className="flex items-start gap-2">
              <div className="flex-1 min-w-0">
                <h3 className="text-sm font-bold text-white">{active.title}</h3>
                <p className="text-[11px] text-gray-400 capitalize">{active.type} · {active.counterparty}{active.expiryDate ? ` · expires ${active.expiryDate}` : ''}</p>
              </div>
              <select value={active.status} onChange={e => setStatus(e.target.value)}
                className="bg-black/50 border border-white/15 rounded px-1.5 py-1 text-[11px] text-white">
                {STATUSES.map(s => <option key={s} value={s}>{s}</option>)}
              </select>
              <button aria-label="Delete" onClick={() => remove(active.id)} className="p-1 text-rose-400 hover:bg-rose-500/10 rounded"><Trash2 className="w-3.5 h-3.5" /></button>
            </div>

            <div className="flex gap-2">
              <button onClick={runReview} className="px-2.5 py-1 text-xs rounded bg-amber-500/20 text-amber-300 hover:bg-amber-500/30 inline-flex items-center gap-1">
                <ShieldCheck className="w-3 h-3" />Review risk
              </button>
              <button onClick={sign} className="px-2.5 py-1 text-xs rounded bg-neon-green/20 text-neon-green hover:bg-neon-green/30 inline-flex items-center gap-1">
                <PenLine className="w-3 h-3" />Sign ({active.signatures.length})
              </button>
            </div>

            {review && (
              <div className={cn('rounded-lg p-2 border',
                review.grade === 'high-risk' ? 'border-rose-500/40 bg-rose-500/5' : review.grade === 'needs-attention' ? 'border-amber-500/40 bg-amber-500/5' : 'border-neon-green/40 bg-neon-green/5')}>
                <p className="text-xs font-semibold text-white mb-1">Risk {review.riskScore}/100 — <span className="capitalize">{review.grade.replace('-', ' ')}</span></p>
                {review.findings.map((f, i) => (
                  <p key={i} className="text-[11px] text-gray-400 flex items-start gap-1">
                    <AlertTriangle className={cn('w-3 h-3 mt-0.5 shrink-0', f.severity === 'high' ? 'text-rose-400' : f.severity === 'warning' ? 'text-amber-400' : 'text-gray-400')} />
                    {f.message}
                  </p>
                ))}
              </div>
            )}

            {/* Feature tabs */}
            <div className="flex gap-1 border-b border-white/10 pb-1.5">
              {([
                ['clauses', 'Clauses', FileText],
                ['extract', 'Extract', ScanText],
                ['versions', 'Versions', History],
                ['approvals', 'Approvals', Users],
                ['esign', 'E-Sign', PenTool],
              ] as const).map(([id, label, Icon]) => (
                <button key={id} onClick={() => setTab(id)}
                  className={cn('px-2 py-1 text-[11px] rounded inline-flex items-center gap-1 transition-colors',
                    tab === id ? 'bg-neon-cyan/15 text-neon-cyan' : 'text-gray-400 hover:text-gray-300')}>
                  <Icon className="w-3 h-3" />{label}
                </button>
              ))}
            </div>

            {tab === 'clauses' && (
              <>
                {/* Clauses */}
                <div>
                  <p className="text-[11px] uppercase tracking-wide text-gray-400 mb-1">Clauses ({active.clauses.length})</p>
                  {active.clauses.length === 0 && <p className="text-[11px] text-gray-400 italic">No clauses — add from the library below.</p>}
                  {active.clauses.map(cl => (
                    <div key={cl.id} className="group bg-black/40 rounded px-2 py-1.5 mb-1">
                      <div className="flex items-center gap-1">
                        <span className="text-xs font-semibold text-white flex-1">{cl.title}</span>
                        <span className="text-[9px] text-gray-400">{cl.category}</span>
                        <button onClick={() => removeClause(cl.id)} className="opacity-0 group-hover:opacity-100 text-rose-400"><X className="w-3 h-3" /></button>
                      </div>
                      <p className="text-[10px] text-gray-400">{cl.text}</p>
                    </div>
                  ))}
                </div>

                {/* Clause library */}
                <div>
                  <p className="text-[11px] uppercase tracking-wide text-gray-400 mb-1">Clause library</p>
                  <div className="space-y-1 max-h-44 overflow-y-auto">
                    {Object.entries(library).map(([cat, clauses]) => clauses.map(c => (
                      <button key={cat + c.title} onClick={() => addClause(cat, c)}
                        className="w-full text-left bg-black/40 hover:bg-neon-cyan/10 rounded px-2 py-1 flex items-center gap-1">
                        <Plus className="w-3 h-3 text-neon-cyan shrink-0" />
                        <span className="text-[11px] text-gray-300 flex-1 truncate">{c.title}</span>
                        <span className="text-[9px] text-gray-400">{cat}</span>
                      </button>
                    )))}
                  </div>
                </div>
              </>
            )}

            {tab === 'extract' && (
              <ClauseExtractor contractId={active.id} onApplied={() => { void reloadActive(); void refresh(); }} />
            )}
            {tab === 'versions' && <ContractVersions contractId={active.id} />}
            {tab === 'approvals' && (
              <ApprovalWorkflow contractId={active.id} onChange={() => { void reloadActive(); void refresh(); }} />
            )}
            {tab === 'esign' && (
              <ContractEsign contractId={active.id} onSigned={() => { void reloadActive(); void refresh(); }} />
            )}
          </div>
        ) : (
          <div className="bg-black/20 border border-dashed border-white/10 rounded-lg flex items-center justify-center text-xs text-gray-400 min-h-[200px]">
            Select or create a contract.
          </div>
        )}
      </div>
    </div>
  );
});
