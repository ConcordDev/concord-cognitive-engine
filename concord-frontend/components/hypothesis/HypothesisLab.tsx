'use client';

/**
 * HypothesisLab — the formal hypothesis lifecycle:
 *   proposed → testing → confirmed / rejected → refined → archived
 *
 * Backed by server/emergent/hypothesis-engine.js (13 real macros —
 * propose/get/list/add_evidence/add_test/update_test/add_prediction/
 * verify_prediction/confirm/reject/refine/archive/metrics), registered
 * inline in server.js's Ghost Fleet loader under the "hypothesis" domain.
 * Before this component, all 13 had ZERO frontend call sites (found in
 * the Wave 3 audit — see docs/lens-specs/hypothesis-capability-map.md) —
 * the page only drove a legacy stub engine that nothing had populated
 * since propose() was intentionally shadowed by the real engine.
 *
 * Confidence auto-recalculates server-side on every evidence/test/
 * prediction change (weighted evidence + test pass rate + verified/
 * falsified predictions) and auto-transitions proposed→testing→confirmed
 * — this UI never computes or fakes a confidence number, it only ever
 * renders what the engine returns.
 */

import { useCallback, useMemo, useRef, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { motion, AnimatePresence } from 'framer-motion';
import {
  FlaskConical, Plus, CheckCircle2, XCircle, Archive, GitBranch,
  Beaker, Target, Loader2, ChevronRight, Clock, ShieldCheck,
} from 'lucide-react';
import { lensRun } from '@/lib/api/client';
import { useLensCommand } from '@/hooks/useLensCommand';

// ── Types (mirror server/emergent/hypothesis-engine.js exactly) ───────────

interface EvidenceEntry { dtuId: string; weight: number; summary: string; }
interface TestEntry { id: string; description: string; status: 'pending' | 'passed' | 'failed' | 'inconclusive'; result: string | null; }
interface PredictionEntry { statement: string; verified: boolean | null; }
interface LifecycleEvent { event: string; by: string; at: string; note?: string; }
interface HypothesisCore {
  statement: string; status: string; confidence: number; falsifiable: boolean;
  evidence_for: EvidenceEntry[]; evidence_against: EvidenceEntry[];
  tests: TestEntry[]; predictions: PredictionEntry[]; lifecycle: LifecycleEvent[];
  parentHypothesis: string | null; childHypotheses: string[];
  domain: string; priority: string;
}
interface HypothesisDTU { id: string; createdAt: string; updatedAt: string; machine: { kind: string; hypothesis: HypothesisCore }; }
interface Metrics { total: number; byStatus: Record<string, number>; avgConfidence: number; factDTUsCreated: number; rejectionDTUsCreated: number; }

const STATUS_ORDER = ['proposed', 'testing', 'confirmed', 'rejected', 'refined', 'archived'] as const;
const STATUS_COLOR: Record<string, string> = {
  proposed: 'bg-blue-400/20 text-blue-300',
  testing: 'bg-yellow-400/20 text-yellow-300',
  confirmed: 'bg-neon-green/20 text-neon-green',
  rejected: 'bg-red-400/20 text-red-300',
  refined: 'bg-neon-purple/20 text-neon-purple',
  archived: 'bg-gray-500/20 text-gray-400',
};

async function hyp<T>(action: string, input: Record<string, unknown> = {}): Promise<{ ok: boolean; data: T | null; error: string | null }> {
  const r = await lensRun('hypothesis', action, input);
  const d = r.data;
  if (!d.ok) return { ok: false, data: null, error: d.error || 'request failed' };
  // `get` returns { ok, hypothesis }; list returns a raw array; metrics/
  // propose/add_* return their own shape directly — pass through as-is.
  return { ok: true, data: d.result as T, error: null };
}

export function HypothesisLab() {
  const qc = useQueryClient();
  const [statusFilter, setStatusFilter] = useState<string>('all');
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [newStatement, setNewStatement] = useState('');
  const [newDomain, setNewDomain] = useState('');
  const [newPriority, setNewPriority] = useState('normal');

  const [evSide, setEvSide] = useState<'for' | 'against'>('for');
  const [evSummary, setEvSummary] = useState('');
  const [evWeight, setEvWeight] = useState(0.5);

  const [testDesc, setTestDesc] = useState('');
  const [predStatement, setPredStatement] = useState('');
  const [rejectReason, setRejectReason] = useState('');
  const [refineStatement, setRefineStatement] = useState('');
  const [showReject, setShowReject] = useState(false);
  const [showRefine, setShowRefine] = useState(false);
  const statementRef = useRef<HTMLTextAreaElement>(null);

  useLensCommand(
    [
      { id: 'focus-new', keys: 'n', description: 'Propose a new hypothesis', category: 'actions', action: () => statementRef.current?.focus() },
      { id: 'filter-all', keys: '1', description: 'All statuses', category: 'view', action: () => setStatusFilter('all') },
      { id: 'filter-proposed', keys: '2', description: 'Proposed', category: 'view', action: () => setStatusFilter('proposed') },
      { id: 'filter-testing', keys: '3', description: 'Testing', category: 'view', action: () => setStatusFilter('testing') },
      { id: 'filter-confirmed', keys: '4', description: 'Confirmed', category: 'view', action: () => setStatusFilter('confirmed') },
      { id: 'filter-rejected', keys: '5', description: 'Rejected', category: 'view', action: () => setStatusFilter('rejected') },
    ],
    { lensId: 'hypothesis' },
  );

  const listQ = useQuery({
    queryKey: ['hypothesis-lab-list', statusFilter],
    queryFn: () => hyp<HypothesisDTU[]>('list', statusFilter === 'all' ? {} : { status: statusFilter }),
    refetchInterval: 15000,
  });
  const metricsQ = useQuery({
    queryKey: ['hypothesis-lab-metrics'],
    queryFn: () => hyp<Metrics>('metrics'),
    refetchInterval: 15000,
  });
  const detailQ = useQuery({
    queryKey: ['hypothesis-lab-detail', selectedId],
    queryFn: () => hyp<{ ok: boolean; hypothesis: HypothesisDTU }>('get', { id: selectedId }),
    enabled: !!selectedId,
  });

  const invalidateAll = useCallback(() => {
    qc.invalidateQueries({ queryKey: ['hypothesis-lab-list'] });
    qc.invalidateQueries({ queryKey: ['hypothesis-lab-metrics'] });
    qc.invalidateQueries({ queryKey: ['hypothesis-lab-detail', selectedId] });
  }, [qc, selectedId]);

  const propose = useMutation({
    mutationFn: () => hyp<{ hypothesis: HypothesisDTU }>('propose', { statement: newStatement, domain: newDomain || undefined, priority: newPriority }),
    onSuccess: (r) => {
      if (r.ok && r.data?.hypothesis) {
        setNewStatement(''); setNewDomain('');
        setSelectedId(r.data.hypothesis.id);
      }
      invalidateAll();
    },
  });

  const addEvidence = useMutation({
    mutationFn: () => hyp('add_evidence', { hypothesisId: selectedId, side: evSide, weight: evWeight, summary: evSummary }),
    onSuccess: () => { setEvSummary(''); invalidateAll(); },
  });

  const addTest = useMutation({
    mutationFn: () => hyp<{ testId: string }>('add_test', { hypothesisId: selectedId, description: testDesc }),
    onSuccess: () => { setTestDesc(''); invalidateAll(); },
  });
  const updateTest = useMutation({
    mutationFn: (vars: { testId: string; result: string }) => hyp('update_test', { hypothesisId: selectedId, testId: vars.testId, result: vars.result }),
    onSuccess: invalidateAll,
  });

  const addPrediction = useMutation({
    mutationFn: () => hyp('add_prediction', { hypothesisId: selectedId, statement: predStatement }),
    onSuccess: () => { setPredStatement(''); invalidateAll(); },
  });
  const verifyPrediction = useMutation({
    mutationFn: (vars: { predIndex: number; verified: boolean }) => hyp('verify_prediction', { hypothesisId: selectedId, predIndex: vars.predIndex, verified: vars.verified }),
    onSuccess: invalidateAll,
  });

  const confirmHyp = useMutation({ mutationFn: () => hyp('confirm', { id: selectedId }), onSuccess: invalidateAll });
  const rejectHyp = useMutation({
    mutationFn: () => hyp('reject', { id: selectedId, reason: rejectReason }),
    onSuccess: () => { setShowReject(false); setRejectReason(''); invalidateAll(); },
  });
  const refineHyp = useMutation({
    mutationFn: () => hyp<{ childId: string }>('refine', { id: selectedId, newStatement: refineStatement }),
    onSuccess: (r) => {
      setShowRefine(false); setRefineStatement('');
      if (r.ok && r.data?.childId) setSelectedId(r.data.childId);
      invalidateAll();
    },
  });
  const archiveHyp = useMutation({ mutationFn: () => hyp('archive', { id: selectedId }), onSuccess: invalidateAll });

  const list: HypothesisDTU[] = useMemo(() => (Array.isArray(listQ.data?.data) ? listQ.data!.data! : []), [listQ.data]);
  const metrics = metricsQ.data?.data || null;
  const detail: HypothesisDTU | null = detailQ.data?.data?.hypothesis || null;
  const h = detail?.machine?.hypothesis;

  return (
    <div className="space-y-4">
      <header className="flex flex-wrap items-center justify-between gap-3 border-b border-white/10 pb-3">
        <div className="flex items-center gap-2">
          <FlaskConical className="w-4 h-4 text-neon-purple" />
          <h2 className="font-semibold text-white">Hypothesis Lab</h2>
          <span className="text-[10px] uppercase tracking-wider text-gray-500 font-mono">formal lifecycle</span>
        </div>
        {metrics && (
          <div className="flex flex-wrap items-center gap-1.5 text-[10px]">
            <span className="rounded bg-white/5 px-2 py-0.5 text-gray-300">total {metrics.total}</span>
            {STATUS_ORDER.map((s) => metrics.byStatus?.[s] ? (
              <span key={s} className={`rounded px-2 py-0.5 ${STATUS_COLOR[s]}`}>{s} {metrics.byStatus[s]}</span>
            ) : null)}
            <span className="rounded bg-white/5 px-2 py-0.5 text-gray-300">avg conf {(metrics.avgConfidence * 100).toFixed(0)}%</span>
          </div>
        )}
      </header>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
        {/* Propose + list */}
        <div className="space-y-3">
          <div className="lens-card space-y-2">
            <h3 className="text-xs font-semibold flex items-center gap-1.5 text-gray-300"><Plus className="w-3.5 h-3.5 text-neon-purple" /> Propose a hypothesis</h3>
            <textarea
              ref={statementRef}
              value={newStatement}
              onChange={(e) => setNewStatement(e.target.value)}
              placeholder="A falsifiable claim, e.g. &quot;Users who complete onboarding day-1 retain 2x longer&quot;  (n focuses)"
              rows={2}
              className="input-lattice w-full text-xs resize-none"
            />
            <div className="flex gap-2">
              <input value={newDomain} onChange={(e) => setNewDomain(e.target.value)} placeholder="Domain (optional)" className="input-lattice flex-1 text-xs" />
              <select value={newPriority} onChange={(e) => setNewPriority(e.target.value)} className="input-lattice text-xs">
                <option value="low">low</option>
                <option value="normal">normal</option>
                <option value="high">high</option>
              </select>
            </div>
            <button
              onClick={() => propose.mutate()}
              disabled={!newStatement.trim() || propose.isPending}
              className="btn-neon purple w-full text-xs flex items-center justify-center gap-1.5 disabled:opacity-50"
            >
              {propose.isPending ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <FlaskConical className="w-3.5 h-3.5" />}
              Propose
            </button>
          </div>

          <div className="lens-card">
            <div className="flex gap-1 flex-wrap text-[10px] mb-2">
              {(['all', ...STATUS_ORDER] as const).map((s) => (
                <button
                  key={s}
                  onClick={() => setStatusFilter(s)}
                  className={`px-2 py-0.5 rounded transition-colors ${statusFilter === s ? 'bg-neon-purple/20 text-neon-purple border border-neon-purple/40' : 'bg-white/5 text-gray-400 border border-white/10 hover:text-white'}`}
                >
                  {s}
                </button>
              ))}
            </div>
            <div className="space-y-1.5 max-h-96 overflow-y-auto">
              {listQ.isLoading && <p className="text-xs text-gray-500 text-center py-3">Loading…</p>}
              {!listQ.isLoading && list.length === 0 && (
                <p className="text-xs text-gray-500 text-center py-4">No hypotheses{statusFilter !== 'all' ? ` in "${statusFilter}"` : ' yet'}. Propose one above.</p>
              )}
              {list.map((item, i) => {
                const ih = item.machine?.hypothesis;
                if (!ih) return null;
                return (
                  <motion.button
                    key={item.id}
                    initial={{ opacity: 0, y: 8 }}
                    animate={{ opacity: 1, y: 0 }}
                    transition={{ delay: i * 0.03 }}
                    onClick={() => setSelectedId(item.id)}
                    className={`w-full text-left lens-card !p-2 ${selectedId === item.id ? 'border-neon-cyan' : ''}`}
                  >
                    <p className="text-xs font-medium text-gray-200 line-clamp-2">{ih.statement}</p>
                    <div className="mt-1 flex items-center gap-1.5">
                      <span className={`text-[9px] px-1.5 py-0.5 rounded ${STATUS_COLOR[ih.status] || 'bg-white/10 text-gray-400'}`}>{ih.status}</span>
                      {ih.domain && ih.domain !== 'general' && <span className="text-[9px] text-gray-500">{ih.domain}</span>}
                      <span className="text-[9px] font-mono text-gray-500 ml-auto">{(ih.confidence * 100).toFixed(0)}%</span>
                    </div>
                  </motion.button>
                );
              })}
            </div>
          </div>
        </div>

        {/* Detail */}
        <div className="lg:col-span-2 lens-card space-y-4">
          {!selectedId ? (
            <div className="text-center py-12 text-gray-500">
              <FlaskConical className="w-10 h-10 mx-auto mb-3 opacity-30" />
              <p className="text-sm">Select a hypothesis to track evidence, tests, and predictions.</p>
            </div>
          ) : detailQ.isLoading ? (
            <p className="text-xs text-gray-500 text-center py-8">Loading…</p>
          ) : !h ? (
            <p className="text-xs text-red-400 text-center py-8">Hypothesis not found.</p>
          ) : (
            <>
              <div>
                <div className="flex items-start justify-between gap-2">
                  <p className="text-sm font-medium text-white">{h.statement}</p>
                  <span className={`shrink-0 text-[10px] px-2 py-0.5 rounded ${STATUS_COLOR[h.status]}`}>{h.status}</span>
                </div>
                <div className="mt-1.5 flex items-center gap-2">
                  <span className="text-[10px] text-gray-500">confidence</span>
                  <div className="flex-1 h-1.5 bg-lattice-deep rounded-full overflow-hidden">
                    <div className="h-full bg-neon-cyan transition-all" style={{ width: `${h.confidence * 100}%` }} />
                  </div>
                  <span className="text-[10px] font-mono text-gray-400">{(h.confidence * 100).toFixed(1)}%</span>
                </div>
                <div className="mt-1 flex items-center gap-2 text-[10px] text-gray-500">
                  {h.domain && <span>{h.domain}</span>}
                  <span>· {h.priority} priority</span>
                  <span className="flex items-center gap-0.5"><ShieldCheck className="w-2.5 h-2.5" /> falsifiable</span>
                  {h.parentHypothesis && (
                    <button onClick={() => setSelectedId(h.parentHypothesis)} className="flex items-center gap-0.5 text-neon-purple hover:underline">
                      <GitBranch className="w-2.5 h-2.5" /> refined from parent
                    </button>
                  )}
                </div>
              </div>

              {/* Lifecycle actions */}
              <div className="flex flex-wrap gap-1.5">
                <button onClick={() => confirmHyp.mutate()} disabled={h.status === 'confirmed' || h.status === 'archived' || confirmHyp.isPending} className="btn-neon text-[11px] px-2.5 py-1 flex items-center gap-1 disabled:opacity-40">
                  <CheckCircle2 className="w-3 h-3" /> Confirm
                </button>
                <button onClick={() => setShowReject((v) => !v)} disabled={h.status === 'rejected' || h.status === 'archived'} className="btn-neon text-[11px] px-2.5 py-1 flex items-center gap-1 disabled:opacity-40">
                  <XCircle className="w-3 h-3" /> Reject
                </button>
                <button onClick={() => setShowRefine((v) => !v)} disabled={h.status === 'archived'} className="btn-neon text-[11px] px-2.5 py-1 flex items-center gap-1 disabled:opacity-40">
                  <GitBranch className="w-3 h-3" /> Refine
                </button>
                <button onClick={() => archiveHyp.mutate()} disabled={h.status === 'archived'} className="btn-neon text-[11px] px-2.5 py-1 flex items-center gap-1 disabled:opacity-40">
                  <Archive className="w-3 h-3" /> Archive
                </button>
              </div>
              <AnimatePresence>
                {showReject && (
                  <motion.div initial={{ opacity: 0, height: 0 }} animate={{ opacity: 1, height: 'auto' }} exit={{ opacity: 0, height: 0 }} className="flex gap-2 overflow-hidden">
                    <input value={rejectReason} onChange={(e) => setRejectReason(e.target.value)} placeholder="Reason for rejection" className="input-lattice flex-1 text-xs" />
                    <button onClick={() => rejectHyp.mutate()} disabled={rejectHyp.isPending} className="btn-neon text-[11px] px-2">Confirm reject</button>
                  </motion.div>
                )}
                {showRefine && (
                  <motion.div initial={{ opacity: 0, height: 0 }} animate={{ opacity: 1, height: 'auto' }} exit={{ opacity: 0, height: 0 }} className="flex gap-2 overflow-hidden">
                    <input value={refineStatement} onChange={(e) => setRefineStatement(e.target.value)} placeholder="Refined statement (creates a child hypothesis)" className="input-lattice flex-1 text-xs" />
                    <button onClick={() => refineHyp.mutate()} disabled={!refineStatement.trim() || refineHyp.isPending} className="btn-neon purple text-[11px] px-2">Create</button>
                  </motion.div>
                )}
              </AnimatePresence>

              {/* Evidence */}
              <div>
                <h4 className="text-xs font-semibold text-gray-300 mb-1.5">Evidence <span className="text-gray-500 font-normal">({h.evidence_for.length} for · {h.evidence_against.length} against)</span></h4>
                <div className="grid grid-cols-2 gap-2 mb-2">
                  <div className="space-y-1">
                    {h.evidence_for.map((e, i) => (
                      <div key={i} className="text-[11px] rounded border-l-2 border-neon-green bg-neon-green/5 px-2 py-1">
                        <p className="text-gray-200">{e.summary}</p>
                        <span className="text-[9px] text-gray-500 font-mono">weight {e.weight.toFixed(2)}</span>
                      </div>
                    ))}
                    {h.evidence_for.length === 0 && <p className="text-[10px] text-gray-600 italic">none</p>}
                  </div>
                  <div className="space-y-1">
                    {h.evidence_against.map((e, i) => (
                      <div key={i} className="text-[11px] rounded border-l-2 border-red-400 bg-red-400/5 px-2 py-1">
                        <p className="text-gray-200">{e.summary}</p>
                        <span className="text-[9px] text-gray-500 font-mono">weight {e.weight.toFixed(2)}</span>
                      </div>
                    ))}
                    {h.evidence_against.length === 0 && <p className="text-[10px] text-gray-600 italic">none</p>}
                  </div>
                </div>
                <div className="flex gap-1.5 items-center">
                  <select value={evSide} onChange={(e) => setEvSide(e.target.value as 'for' | 'against')} className="input-lattice text-[11px] w-24">
                    <option value="for">For</option>
                    <option value="against">Against</option>
                  </select>
                  <input value={evSummary} onChange={(e) => setEvSummary(e.target.value)} placeholder="Evidence summary…" className="input-lattice flex-1 text-[11px]" />
                  <input type="range" min={0} max={1} step={0.05} value={evWeight} onChange={(e) => setEvWeight(Number(e.target.value))} className="w-16" title={`weight ${evWeight}`} />
                  <button onClick={() => addEvidence.mutate()} disabled={!evSummary.trim() || addEvidence.isPending} className="btn-neon text-[11px] px-2 disabled:opacity-40">Add</button>
                </div>
              </div>

              {/* Tests */}
              <div>
                <h4 className="text-xs font-semibold text-gray-300 mb-1.5 flex items-center gap-1"><Beaker className="w-3 h-3" /> Tests</h4>
                <div className="space-y-1 mb-2">
                  {h.tests.map((t) => (
                    <div key={t.id} className="flex items-center justify-between gap-2 text-[11px] rounded bg-white/[0.03] px-2 py-1">
                      <span className="text-gray-300 truncate">{t.description}</span>
                      <div className="flex gap-1 shrink-0">
                        {t.status === 'pending' ? (
                          (['passed', 'failed', 'inconclusive'] as const).map((r) => (
                            <button key={r} onClick={() => updateTest.mutate({ testId: t.id, result: r })} className="text-[9px] px-1.5 py-0.5 rounded bg-white/5 hover:bg-white/10 text-gray-400">{r}</button>
                          ))
                        ) : (
                          <span className={`text-[9px] px-1.5 py-0.5 rounded ${t.status === 'passed' ? 'bg-neon-green/20 text-neon-green' : t.status === 'failed' ? 'bg-red-400/20 text-red-300' : 'bg-gray-500/20 text-gray-400'}`}>{t.status}</span>
                        )}
                      </div>
                    </div>
                  ))}
                  {h.tests.length === 0 && <p className="text-[10px] text-gray-600 italic">no tests yet</p>}
                </div>
                <div className="flex gap-1.5">
                  <input value={testDesc} onChange={(e) => setTestDesc(e.target.value)} placeholder="Test description…" className="input-lattice flex-1 text-[11px]" />
                  <button onClick={() => addTest.mutate()} disabled={!testDesc.trim() || addTest.isPending} className="btn-neon text-[11px] px-2 disabled:opacity-40">Add</button>
                </div>
              </div>

              {/* Predictions */}
              <div>
                <h4 className="text-xs font-semibold text-gray-300 mb-1.5 flex items-center gap-1"><Target className="w-3 h-3" /> Predictions</h4>
                <div className="space-y-1 mb-2">
                  {h.predictions.map((p, i) => (
                    <div key={i} className="flex items-center justify-between gap-2 text-[11px] rounded bg-white/[0.03] px-2 py-1">
                      <span className="text-gray-300 truncate">{p.statement}</span>
                      {p.verified === null ? (
                        <div className="flex gap-1 shrink-0">
                          <button onClick={() => verifyPrediction.mutate({ predIndex: i, verified: true })} className="text-[9px] px-1.5 py-0.5 rounded bg-neon-green/10 text-neon-green hover:bg-neon-green/20">verify</button>
                          <button onClick={() => verifyPrediction.mutate({ predIndex: i, verified: false })} className="text-[9px] px-1.5 py-0.5 rounded bg-red-400/10 text-red-300 hover:bg-red-400/20">falsify</button>
                        </div>
                      ) : (
                        <span className={`text-[9px] px-1.5 py-0.5 rounded shrink-0 ${p.verified ? 'bg-neon-green/20 text-neon-green' : 'bg-red-400/20 text-red-300'}`}>{p.verified ? 'verified' : 'falsified'}</span>
                      )}
                    </div>
                  ))}
                  {h.predictions.length === 0 && <p className="text-[10px] text-gray-600 italic">no predictions yet</p>}
                </div>
                <div className="flex gap-1.5">
                  <input value={predStatement} onChange={(e) => setPredStatement(e.target.value)} placeholder="If this holds, then…" className="input-lattice flex-1 text-[11px]" />
                  <button onClick={() => addPrediction.mutate()} disabled={!predStatement.trim() || addPrediction.isPending} className="btn-neon text-[11px] px-2 disabled:opacity-40">Add</button>
                </div>
              </div>

              {/* Lifecycle timeline */}
              <details className="text-[11px]">
                <summary className="cursor-pointer text-gray-400 flex items-center gap-1"><Clock className="w-3 h-3" /> Lifecycle ({h.lifecycle.length} events)</summary>
                <div className="mt-1.5 space-y-1 max-h-40 overflow-y-auto">
                  {h.lifecycle.slice().reverse().map((ev, i) => (
                    <div key={i} className="flex items-start gap-1.5 text-gray-500">
                      <ChevronRight className="w-3 h-3 mt-0.5 shrink-0 text-gray-600" />
                      <span><span className="text-gray-300">{ev.event}</span> by {ev.by} — {ev.note}</span>
                    </div>
                  ))}
                </div>
              </details>
            </>
          )}
        </div>
      </div>
    </div>
  );
}
