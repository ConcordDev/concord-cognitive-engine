'use client';

/* eslint-disable @typescript-eslint/no-explicit-any */

/**
 * CaseWorkbench — full ODR (online dispute resolution) case workbench.
 *
 * Drives the disputes-domain case-lifecycle macros end to end:
 *  - case-open / case-list / case-detail / case-advance / case-resolve
 *  - evidence-add / evidence-remove        (evidence attachment)
 *  - message-post / message-list           (two-party messaging thread)
 *  - mediator-assign / mediator-unassign   (neutral-party workflow)
 *  - offer-make / offer-respond            (settlement offer exchange)
 *  - sla-check                             (auto-escalation of stalled stages)
 *  - archive-search                        (searchable resolved-case archive)
 *  - escrow-freeze / escrow-release / escrow-status (fund hold integration)
 *
 * Every value rendered comes from a real macro call. No mock/seed data.
 */

import { useCallback, useEffect, useMemo, useState } from 'react';
import { lensRun } from '@/lib/api/client';
import { ChartKit, TimelineView } from '@/components/viz';
import type { TimelineEvent } from '@/components/viz';
import {
  AlertTriangle, ArrowRight, CheckCircle2, Clock, DollarSign, FileText,
  Gavel, Loader2, Lock, MessageSquare, Paperclip, Plus, Scale, Search,
  Send, Trash2, Unlock, UserCheck, X, XCircle,
} from 'lucide-react';

/* ------------------------------------------------------------------ */
/*  Types                                                              */
/* ------------------------------------------------------------------ */

interface PublicCase {
  id: string;
  caseNumber: number;
  title: string;
  dispute_type: string;
  status: string;
  disputeAmount: number;
  claimantId: string;
  respondentId: string | null;
  mediatorId: string | null;
  escrowFrozen: boolean;
  escrowAmount: number;
  evidenceCount: number;
  messageCount: number;
  offerCount: number;
  slaDeadline: string | null;
  slaBreached: boolean;
  outcome: any | null;
  openedAt: string;
  updatedAt: string;
  resolvedAt: string | null;
}

interface EvidenceItem {
  id: string;
  label: string;
  kind: string;
  url: string | null;
  note: string;
  reliability: number;
  uploadedBy: string;
  uploadedAt: string;
}

interface ThreadMessage {
  id: string;
  role: string;
  authorId: string;
  body: string;
  postedAt: string;
}

interface SettlementOffer {
  id: string;
  fromRole: string;
  fromId: string;
  amount: number;
  terms: string;
  isCounter: boolean;
  status: string;
  madeAt: string;
  respondedAt: string | null;
}

interface HistoryEntry {
  at: string;
  event: string;
  actor: string;
  [k: string]: any;
}

interface CaseDetail {
  case: PublicCase;
  description: string;
  evidence: EvidenceItem[];
  messages: ThreadMessage[];
  offers: SettlementOffer[];
  history: HistoryEntry[];
}

interface ListStats {
  total: number;
  open: number;
  active: number;
  escalated: number;
  resolved: number;
  slaBreached: number;
  escrowHeld: number;
}

/* ------------------------------------------------------------------ */
/*  Constants                                                          */
/* ------------------------------------------------------------------ */

const DISPUTE_TYPES = [
  'not_as_described', 'unauthorized_purchase', 'non_delivery', 'quality',
  'fraudulent_listing', 'copyright', 'derivative_claim', 'other',
];

const EVIDENCE_KINDS = [
  'document', 'screenshot', 'photo', 'video', 'receipt',
  'correspondence', 'file', 'witness', 'expert',
];

const STATUS_TONE: Record<string, string> = {
  open: 'bg-yellow-500/15 text-yellow-400 border-yellow-500/30',
  under_review: 'bg-blue-500/15 text-blue-400 border-blue-500/30',
  mediation: 'bg-purple-500/15 text-purple-400 border-purple-500/30',
  escalated: 'bg-orange-500/15 text-orange-400 border-orange-500/30',
  resolved: 'bg-green-500/15 text-green-400 border-green-500/30',
  dismissed: 'bg-gray-500/15 text-gray-400 border-gray-500/30',
};

const OUTCOME_TYPES = [
  'full_refund', 'partial_refund', 'no_refund',
  'replacement', 'negotiated_settlement', 'dismissed',
];

const fmtLabel = (s: string) => s.replace(/_/g, ' ').replace(/\b\w/g, (c) => c.toUpperCase());
const fmtDate = (s: string | null) => (s ? new Date(s).toLocaleString() : '—');

/* ------------------------------------------------------------------ */
/*  Small shared bits                                                  */
/* ------------------------------------------------------------------ */

function StatusPill({ status }: { status: string }) {
  return (
    <span className={`inline-flex items-center px-2 py-0.5 rounded-full text-[11px] font-medium border ${STATUS_TONE[status] || STATUS_TONE.open}`}>
      {fmtLabel(status)}
    </span>
  );
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <label className="block">
      <span className="block text-[11px] uppercase tracking-wider text-zinc-400 mb-1">{label}</span>
      {children}
    </label>
  );
}

const inputCls = 'w-full rounded-md bg-zinc-900 border border-zinc-700 px-3 py-1.5 text-sm text-zinc-100 focus:border-indigo-500 focus:outline-none';
const btnPrimary = 'inline-flex items-center gap-1.5 rounded-md bg-indigo-600 hover:bg-indigo-500 px-3 py-1.5 text-sm font-medium text-white disabled:opacity-40 disabled:cursor-not-allowed transition-colors';
const btnGhost = 'inline-flex items-center gap-1.5 rounded-md border border-zinc-700 hover:bg-zinc-800 px-3 py-1.5 text-sm text-zinc-300 disabled:opacity-40 transition-colors';

/* ================================================================== */
/*  Main component                                                     */
/* ================================================================== */

export function CaseWorkbench() {
  const [cases, setCases] = useState<PublicCase[]>([]);
  const [stats, setStats] = useState<ListStats | null>(null);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [detail, setDetail] = useState<CaseDetail | null>(null);
  const [loading, setLoading] = useState(false);
  const [busy, setBusy] = useState<string | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [showNew, setShowNew] = useState(false);

  /* ---- list ---- */
  const refreshList = useCallback(async () => {
    setLoading(true);
    const r = await lensRun('disputes', 'case-list', {});
    if (r.data.ok && r.data.result) {
      setCases((r.data.result as any).cases || []);
      setStats((r.data.result as any).stats || null);
    }
    setLoading(false);
  }, []);

  /* ---- detail ---- */
  const refreshDetail = useCallback(async (id: string) => {
    const r = await lensRun('disputes', 'case-detail', { caseId: id });
    if (r.data.ok && r.data.result) {
      setDetail(r.data.result as CaseDetail);
    }
  }, []);

  useEffect(() => {
    refreshList();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    if (selectedId) refreshDetail(selectedId);
    else setDetail(null);
  }, [selectedId, refreshDetail]);

  /* ---- generic macro runner ---- */
  const run = useCallback(async (action: string, input: Record<string, unknown>, key: string) => {
    setBusy(key);
    setErr(null);
    try {
      const r = await lensRun('disputes', action, input);
      if (!r.data.ok) {
        setErr(r.data.error || `${action} failed`);
        return null;
      }
      await refreshList();
      if (selectedId) await refreshDetail(selectedId);
      return r.data.result;
    } catch (e) {
      setErr(e instanceof Error ? e.message : 'request failed');
      return null;
    } finally {
      setBusy(null);
    }
  }, [refreshList, refreshDetail, selectedId]);

  const selected = useMemo(
    () => cases.find((c) => c.id === selectedId) || null,
    [cases, selectedId],
  );

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <h2 className="text-sm font-semibold text-zinc-200 flex items-center gap-2">
          <Scale className="w-4 h-4 text-indigo-400" /> ODR Case Workbench
        </h2>
        <div className="flex items-center gap-2">
          <SlaCheckButton onDone={refreshList} />
          <button className={btnPrimary} onClick={() => setShowNew(true)}>
            <Plus className="w-3.5 h-3.5" /> New Case
          </button>
        </div>
      </div>

      {stats && <StatsRow stats={stats} />}

      {err && (
        <div className="flex items-center gap-2 rounded-md border border-rose-500/30 bg-rose-500/10 px-3 py-2 text-sm text-rose-400">
          <XCircle className="w-4 h-4" /> {err}
        </div>
      )}

      <div className="grid grid-cols-1 lg:grid-cols-[320px_1fr] gap-4">
        {/* Case list */}
        <div className="space-y-2">
          {loading ? (
            <div className="flex items-center justify-center py-10 text-zinc-400 text-sm">
              <Loader2 className="w-4 h-4 animate-spin mr-2" /> Loading cases…
            </div>
          ) : cases.length === 0 ? (
            <div className="rounded-lg border border-dashed border-zinc-800 py-10 text-center text-sm text-zinc-400">
              No cases yet. Open one to start dispute resolution.
            </div>
          ) : (
            cases.map((c) => (
              <button
                key={c.id}
                onClick={() => setSelectedId(c.id)}
                className={`w-full text-left rounded-lg border px-3 py-2.5 transition-colors ${
                  selectedId === c.id
                    ? 'border-indigo-500/50 bg-indigo-500/5'
                    : 'border-zinc-800 hover:border-zinc-700 bg-zinc-950/40'
                }`}
              >
                <div className="flex items-center justify-between gap-2">
                  <span className="text-sm font-medium text-zinc-200 truncate">{c.title}</span>
                  <StatusPill status={c.status} />
                </div>
                <div className="flex items-center gap-3 mt-1 text-[11px] text-zinc-400">
                  <span className="font-mono">#{c.caseNumber}</span>
                  <span>{fmtLabel(c.dispute_type)}</span>
                  {c.disputeAmount > 0 && (
                    <span className="flex items-center gap-0.5">
                      <DollarSign className="w-3 h-3" />{c.disputeAmount}
                    </span>
                  )}
                </div>
                <div className="flex items-center gap-3 mt-1 text-[11px] text-zinc-400">
                  <span className="flex items-center gap-0.5"><Paperclip className="w-3 h-3" />{c.evidenceCount}</span>
                  <span className="flex items-center gap-0.5"><MessageSquare className="w-3 h-3" />{c.messageCount}</span>
                  <span className="flex items-center gap-0.5"><Gavel className="w-3 h-3" />{c.offerCount}</span>
                  {c.escrowFrozen && <span className="flex items-center gap-0.5 text-amber-500"><Lock className="w-3 h-3" />{c.escrowAmount}</span>}
                  {c.slaBreached && <span className="text-rose-400 flex items-center gap-0.5"><AlertTriangle className="w-3 h-3" />SLA</span>}
                </div>
              </button>
            ))
          )}
        </div>

        {/* Case detail */}
        <div>
          {selected && detail ? (
            <CaseDetailPanel
              c={selected}
              detail={detail}
              busy={busy}
              run={run}
            />
          ) : (
            <div className="rounded-lg border border-dashed border-zinc-800 py-20 text-center text-sm text-zinc-400">
              Select a case to view evidence, messages, offers and resolution controls.
            </div>
          )}
        </div>
      </div>

      <ArchivePanel />

      {showNew && (
        <NewCaseModal
          onClose={() => setShowNew(false)}
          onCreated={async (id) => {
            setShowNew(false);
            await refreshList();
            setSelectedId(id);
          }}
        />
      )}
    </div>
  );
}

/* ------------------------------------------------------------------ */
/*  Stats row                                                          */
/* ------------------------------------------------------------------ */

function StatsRow({ stats }: { stats: ListStats }) {
  const items = [
    { label: 'Total', value: stats.total, tone: 'text-zinc-300' },
    { label: 'Active', value: stats.active, tone: 'text-blue-400' },
    { label: 'Escalated', value: stats.escalated, tone: 'text-orange-400' },
    { label: 'Resolved', value: stats.resolved, tone: 'text-green-400' },
    { label: 'SLA Breached', value: stats.slaBreached, tone: 'text-rose-400' },
    { label: 'Escrow Held', value: stats.escrowHeld, tone: 'text-amber-400' },
  ];
  return (
    <div className="grid grid-cols-3 sm:grid-cols-6 gap-2">
      {items.map((s) => (
        <div key={s.label} className="rounded-lg border border-zinc-800 bg-zinc-950/40 px-3 py-2">
          <p className={`text-lg font-bold ${s.tone}`}>{s.value}</p>
          <p className="text-[10px] uppercase tracking-wider text-zinc-400">{s.label}</p>
        </div>
      ))}
    </div>
  );
}

/* ------------------------------------------------------------------ */
/*  SLA check button                                                   */
/* ------------------------------------------------------------------ */

function SlaCheckButton({ onDone }: { onDone: () => void }) {
  const [running, setRunning] = useState(false);
  const [result, setResult] = useState<{ escalatedCount: number; nearingDeadline: any[] } | null>(null);

  const check = async () => {
    setRunning(true);
    const r = await lensRun('disputes', 'sla-check', {});
    if (r.data.ok && r.data.result) {
      setResult(r.data.result as any);
      onDone();
    }
    setRunning(false);
  };

  return (
    <div className="flex items-center gap-2">
      {result && (
        <span className="text-[11px] text-zinc-400">
          {result.escalatedCount > 0
            ? <span className="text-orange-400">{result.escalatedCount} auto-escalated</span>
            : `${result.nearingDeadline.length} nearing deadline`}
        </span>
      )}
      <button className={btnGhost} onClick={check} disabled={running}>
        {running ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Clock className="w-3.5 h-3.5" />}
        SLA Check
      </button>
    </div>
  );
}

/* ------------------------------------------------------------------ */
/*  New case modal                                                     */
/* ------------------------------------------------------------------ */

function NewCaseModal({ onClose, onCreated }: { onClose: () => void; onCreated: (id: string) => void }) {
  const [title, setTitle] = useState('');
  const [disputeType, setDisputeType] = useState('not_as_described');
  const [disputeAmount, setDisputeAmount] = useState('');
  const [description, setDescription] = useState('');
  const [respondentId, setRespondentId] = useState('');
  const [freezeEscrow, setFreezeEscrow] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const submit = async () => {
    setSubmitting(true);
    setError(null);
    const r = await lensRun('disputes', 'case-open', {
      title: title.trim(),
      disputeType,
      disputeAmount: Number(disputeAmount) || 0,
      description: description.trim(),
      respondentId: respondentId.trim() || undefined,
      freezeEscrow,
    });
    setSubmitting(false);
    if (r.data.ok && r.data.result) {
      onCreated(((r.data.result as any).case as PublicCase).id);
    } else {
      setError(r.data.error || 'Failed to open case');
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 p-4" onClick={onClose} role="button" tabIndex={0} onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); (e.currentTarget as HTMLElement).click(); } }}>
      <div className="w-full max-w-lg rounded-xl border border-zinc-800 bg-zinc-950" onClick={(e) => e.stopPropagation()} role="button" tabIndex={0} onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); (e.currentTarget as HTMLElement).click(); } }}>
        <div className="flex items-center justify-between border-b border-zinc-800 px-4 py-3">
          <h3 className="text-sm font-semibold text-zinc-200 flex items-center gap-2">
            <Plus className="w-4 h-4 text-indigo-400" /> Open Dispute Case
          </h3>
          <button aria-label="Close" onClick={onClose} className="text-zinc-400 hover:text-zinc-300"><X className="w-4 h-4" /></button>
        </div>
        <div className="space-y-3 p-4">
          <Field label="Case Title">
            <input className={inputCls} value={title} onChange={(e) => setTitle(e.target.value)} placeholder="Item arrived damaged" />
          </Field>
          <div className="grid grid-cols-2 gap-3">
            <Field label="Dispute Type">
              <select className={inputCls} value={disputeType} onChange={(e) => setDisputeType(e.target.value)}>
                {DISPUTE_TYPES.map((t) => <option key={t} value={t}>{fmtLabel(t)}</option>)}
              </select>
            </Field>
            <Field label="Amount (CC)">
              <input className={inputCls} type="number" value={disputeAmount} onChange={(e) => setDisputeAmount(e.target.value)} placeholder="0" />
            </Field>
          </div>
          <Field label="Respondent ID (optional)">
            <input className={inputCls} value={respondentId} onChange={(e) => setRespondentId(e.target.value)} placeholder="seller user id" />
          </Field>
          <Field label="Description">
            <textarea className={`${inputCls} h-24`} value={description} onChange={(e) => setDescription(e.target.value)} placeholder="Describe the problem…" />
          </Field>
          <label className="flex items-center gap-2 text-sm text-zinc-300">
            <input type="checkbox" checked={freezeEscrow} onChange={(e) => setFreezeEscrow(e.target.checked)} />
            Freeze escrow on the disputed amount immediately
          </label>
          {error && <p className="text-sm text-rose-400 flex items-center gap-1"><XCircle className="w-3.5 h-3.5" />{error}</p>}
        </div>
        <div className="flex justify-end gap-2 border-t border-zinc-800 px-4 py-3">
          <button className={btnGhost} onClick={onClose}>Cancel</button>
          <button className={btnPrimary} onClick={submit} disabled={!title.trim() || submitting}>
            {submitting ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Send className="w-3.5 h-3.5" />}
            Open Case
          </button>
        </div>
      </div>
    </div>
  );
}

/* ------------------------------------------------------------------ */
/*  Case detail panel                                                  */
/* ------------------------------------------------------------------ */

type RunFn = (action: string, input: Record<string, unknown>, key: string) => Promise<any>;
type DetailTab = 'evidence' | 'messages' | 'offers' | 'history';

function CaseDetailPanel({
  c, detail, busy, run,
}: {
  c: PublicCase;
  detail: CaseDetail;
  busy: string | null;
  run: RunFn;
}) {
  const [tab, setTab] = useState<DetailTab>('evidence');
  const closed = c.status === 'resolved' || c.status === 'dismissed';

  return (
    <div className="rounded-lg border border-zinc-800 bg-zinc-950/40">
      {/* header */}
      <div className="border-b border-zinc-800 px-4 py-3">
        <div className="flex items-start justify-between gap-3">
          <div>
            <p className="text-sm font-semibold text-zinc-100">{c.title}</p>
            <p className="text-[11px] text-zinc-400 mt-0.5">
              #{c.caseNumber} · {fmtLabel(c.dispute_type)} · opened {fmtDate(c.openedAt)}
            </p>
          </div>
          <StatusPill status={c.status} />
        </div>
        {detail.description && <p className="text-sm text-zinc-400 mt-2">{detail.description}</p>}

        {/* lifecycle controls */}
        <div className="flex flex-wrap items-center gap-2 mt-3">
          {!closed && (
            <button
              className={btnGhost}
              disabled={busy === 'advance'}
              onClick={() => run('case-advance', { caseId: c.id }, 'advance')}
            >
              {busy === 'advance' ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <ArrowRight className="w-3.5 h-3.5" />}
              Advance Stage
            </button>
          )}
          {c.slaDeadline && !closed && (
            <span className={`text-[11px] ${c.slaBreached ? 'text-rose-400' : 'text-zinc-400'}`}>
              SLA deadline: {fmtDate(c.slaDeadline)}{c.slaBreached ? ' (breached)' : ''}
            </span>
          )}
        </div>
      </div>

      {/* escrow + mediator strip */}
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 px-4 py-3 border-b border-zinc-800">
        <EscrowControls c={c} busy={busy} run={run} closed={closed} />
        <MediatorControls c={c} busy={busy} run={run} />
      </div>

      {/* resolution */}
      {closed && c.outcome ? (
        <div className="px-4 py-3 border-b border-zinc-800 bg-green-500/[0.03]">
          <p className="text-[11px] uppercase tracking-wider text-zinc-400 mb-1">Resolution Outcome</p>
          <p className="text-sm text-zinc-200 font-medium">{fmtLabel(c.outcome.type)}</p>
          {c.outcome.refundAmount > 0 && (
            <p className="text-sm text-green-400 flex items-center gap-1 mt-0.5">
              <DollarSign className="w-3.5 h-3.5" />{c.outcome.refundAmount} CC refunded
            </p>
          )}
          {c.outcome.settlementAmount != null && (
            <p className="text-sm text-green-400 mt-0.5">Settlement: {c.outcome.settlementAmount} CC</p>
          )}
          {c.outcome.rationale && <p className="text-xs text-zinc-400 mt-1">{c.outcome.rationale}</p>}
          {c.outcome.terms && <p className="text-xs text-zinc-400 mt-1">Terms: {c.outcome.terms}</p>}
          <p className="text-[11px] text-zinc-400 mt-1">Resolved {fmtDate(c.resolvedAt)}</p>
        </div>
      ) : (
        <ResolvePanel c={c} busy={busy} run={run} />
      )}

      {/* tabs */}
      <div className="flex border-b border-zinc-800">
        {([
          ['evidence', 'Evidence', detail.evidence.length],
          ['messages', 'Messages', detail.messages.length],
          ['offers', 'Offers', detail.offers.length],
          ['history', 'History', detail.history.length],
        ] as Array<[DetailTab, string, number]>).map(([id, label, count]) => (
          <button
            key={id}
            onClick={() => setTab(id)}
            className={`px-4 py-2 text-xs font-medium border-b-2 transition-colors ${
              tab === id ? 'border-indigo-500 text-indigo-400' : 'border-transparent text-zinc-400 hover:text-zinc-300'
            }`}
          >
            {label} <span className="text-zinc-600">{count}</span>
          </button>
        ))}
      </div>

      <div className="p-4">
        {tab === 'evidence' && <EvidenceTab c={c} items={detail.evidence} busy={busy} run={run} closed={closed} />}
        {tab === 'messages' && <MessagesTab c={c} messages={detail.messages} busy={busy} run={run} />}
        {tab === 'offers' && <OffersTab c={c} offers={detail.offers} busy={busy} run={run} closed={closed} />}
        {tab === 'history' && <HistoryTab history={detail.history} />}
      </div>
    </div>
  );
}

/* ------------------------------------------------------------------ */
/*  Escrow controls                                                    */
/* ------------------------------------------------------------------ */

function EscrowControls({ c, busy, run, closed }: { c: PublicCase; busy: string | null; run: RunFn; closed: boolean }) {
  const [amount, setAmount] = useState('');
  const [releaseTo, setReleaseTo] = useState('claimant');

  return (
    <div className="rounded-md border border-zinc-800 p-2.5">
      <p className="text-[11px] uppercase tracking-wider text-zinc-400 mb-1.5 flex items-center gap-1">
        {c.escrowFrozen ? <Lock className="w-3 h-3 text-amber-500" /> : <Unlock className="w-3 h-3" />} Escrow
      </p>
      {c.escrowFrozen ? (
        <div className="space-y-2">
          <p className="text-sm text-amber-400 flex items-center gap-1">
            <DollarSign className="w-3.5 h-3.5" />{c.escrowAmount} CC held
          </p>
          <div className="flex gap-2">
            <select className={inputCls} value={releaseTo} onChange={(e) => setReleaseTo(e.target.value)}>
              <option value="claimant">To claimant</option>
              <option value="respondent">To respondent</option>
              <option value="split">Split 50/50</option>
            </select>
            <button
              className={btnGhost}
              disabled={busy === 'escrow-release'}
              onClick={() => run('escrow-release', { caseId: c.id, releaseTo }, 'escrow-release')}
            >
              {busy === 'escrow-release' ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Unlock className="w-3.5 h-3.5" />}
              Release
            </button>
          </div>
        </div>
      ) : closed ? (
        <p className="text-sm text-zinc-400">No active hold.</p>
      ) : (
        <div className="flex gap-2">
          <input
            className={inputCls}
            type="number"
            placeholder={`${c.disputeAmount || 0}`}
            value={amount}
            onChange={(e) => setAmount(e.target.value)}
          />
          <button
            className={btnGhost}
            disabled={busy === 'escrow-freeze'}
            onClick={() => run('escrow-freeze', { caseId: c.id, amount: Number(amount) || undefined }, 'escrow-freeze')}
          >
            {busy === 'escrow-freeze' ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Lock className="w-3.5 h-3.5" />}
            Freeze
          </button>
        </div>
      )}
    </div>
  );
}

/* ------------------------------------------------------------------ */
/*  Mediator controls                                                  */
/* ------------------------------------------------------------------ */

function MediatorControls({ c, busy, run }: { c: PublicCase; busy: string | null; run: RunFn }) {
  const [mediatorId, setMediatorId] = useState('');
  const [mediatorName, setMediatorName] = useState('');

  return (
    <div className="rounded-md border border-zinc-800 p-2.5">
      <p className="text-[11px] uppercase tracking-wider text-zinc-400 mb-1.5 flex items-center gap-1">
        <UserCheck className="w-3 h-3" /> Mediator
      </p>
      {c.mediatorId ? (
        <div className="flex items-center justify-between gap-2">
          <p className="text-sm text-purple-400">{c.mediatorId}</p>
          <button
            className={btnGhost}
            disabled={busy === 'mediator-unassign'}
            onClick={() => run('mediator-unassign', { caseId: c.id }, 'mediator-unassign')}
          >
            {busy === 'mediator-unassign' ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <X className="w-3.5 h-3.5" />}
            Unassign
          </button>
        </div>
      ) : (
        <div className="space-y-2">
          <input className={inputCls} placeholder="Mediator user id" value={mediatorId} onChange={(e) => setMediatorId(e.target.value)} />
          <div className="flex gap-2">
            <input className={inputCls} placeholder="Name (optional)" value={mediatorName} onChange={(e) => setMediatorName(e.target.value)} />
            <button
              className={btnGhost}
              disabled={!mediatorId.trim() || busy === 'mediator-assign'}
              onClick={() => run('mediator-assign', { caseId: c.id, mediatorId: mediatorId.trim(), mediatorName: mediatorName.trim() || undefined }, 'mediator-assign')}
            >
              {busy === 'mediator-assign' ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <UserCheck className="w-3.5 h-3.5" />}
              Assign
            </button>
          </div>
        </div>
      )}
    </div>
  );
}

/* ------------------------------------------------------------------ */
/*  Resolve panel                                                      */
/* ------------------------------------------------------------------ */

function ResolvePanel({ c, busy, run }: { c: PublicCase; busy: string | null; run: RunFn }) {
  const [open, setOpen] = useState(false);
  const [outcomeType, setOutcomeType] = useState('full_refund');
  const [refundPercent, setRefundPercent] = useState(50);
  const [settlementAmount, setSettlementAmount] = useState('');
  const [rationale, setRationale] = useState('');

  if (!open) {
    return (
      <div className="px-4 py-3 border-b border-zinc-800">
        <button className={btnGhost} onClick={() => setOpen(true)}>
          <Gavel className="w-3.5 h-3.5" /> Record Resolution
        </button>
      </div>
    );
  }

  return (
    <div className="px-4 py-3 border-b border-zinc-800 space-y-3 bg-indigo-500/[0.02]">
      <p className="text-sm font-medium text-indigo-400 flex items-center gap-1.5">
        <Gavel className="w-4 h-4" /> Record Resolution
      </p>
      <div className="grid grid-cols-2 gap-3">
        <Field label="Outcome">
          <select className={inputCls} value={outcomeType} onChange={(e) => setOutcomeType(e.target.value)}>
            {OUTCOME_TYPES.map((t) => <option key={t} value={t}>{fmtLabel(t)}</option>)}
          </select>
        </Field>
        {outcomeType === 'partial_refund' && (
          <Field label={`Refund %: ${refundPercent}`}>
            <input type="range" min={1} max={99} value={refundPercent} onChange={(e) => setRefundPercent(Number(e.target.value))} className="w-full accent-indigo-500" />
          </Field>
        )}
        {outcomeType === 'negotiated_settlement' && (
          <Field label="Settlement Amount">
            <input className={inputCls} type="number" value={settlementAmount} onChange={(e) => setSettlementAmount(e.target.value)} />
          </Field>
        )}
      </div>
      <Field label="Rationale">
        <textarea className={`${inputCls} h-16`} value={rationale} onChange={(e) => setRationale(e.target.value)} placeholder="Reason for this decision…" />
      </Field>
      <div className="flex justify-end gap-2">
        <button className={btnGhost} onClick={() => setOpen(false)}>Cancel</button>
        <button
          className={btnPrimary}
          disabled={busy === 'case-resolve'}
          onClick={async () => {
            const ok = await run('case-resolve', {
              caseId: c.id,
              outcomeType,
              refundPercent: outcomeType === 'partial_refund' ? refundPercent : undefined,
              settlementAmount: outcomeType === 'negotiated_settlement' ? Number(settlementAmount) || 0 : undefined,
              rationale: rationale.trim() || undefined,
            }, 'case-resolve');
            if (ok) setOpen(false);
          }}
        >
          {busy === 'case-resolve' ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <CheckCircle2 className="w-3.5 h-3.5" />}
          Resolve Case
        </button>
      </div>
    </div>
  );
}

/* ------------------------------------------------------------------ */
/*  Evidence tab                                                       */
/* ------------------------------------------------------------------ */

function EvidenceTab({ c, items, busy, run, closed }: { c: PublicCase; items: EvidenceItem[]; busy: string | null; run: RunFn; closed: boolean }) {
  const [label, setLabel] = useState('');
  const [kind, setKind] = useState('document');
  const [url, setUrl] = useState('');
  const [note, setNote] = useState('');
  const [reliability, setReliability] = useState(70);

  const add = async () => {
    const ok = await run('evidence-add', {
      caseId: c.id, label: label.trim(), kind, url: url.trim() || undefined,
      note: note.trim() || undefined, reliability: reliability / 100,
    }, 'evidence-add');
    if (ok) { setLabel(''); setUrl(''); setNote(''); }
  };

  return (
    <div className="space-y-3">
      {!closed && (
        <div className="rounded-md border border-zinc-800 p-3 space-y-2.5">
          <div className="grid grid-cols-2 gap-2">
            <Field label="Label">
              <input className={inputCls} value={label} onChange={(e) => setLabel(e.target.value)} placeholder="Photo of damage" />
            </Field>
            <Field label="Kind">
              <select className={inputCls} value={kind} onChange={(e) => setKind(e.target.value)}>
                {EVIDENCE_KINDS.map((k) => <option key={k} value={k}>{fmtLabel(k)}</option>)}
              </select>
            </Field>
          </div>
          <Field label="URL / attachment link (optional)">
            <input className={inputCls} value={url} onChange={(e) => setUrl(e.target.value)} placeholder="https://…" />
          </Field>
          <Field label="Note (optional)">
            <input className={inputCls} value={note} onChange={(e) => setNote(e.target.value)} />
          </Field>
          <Field label={`Reliability: ${reliability}%`}>
            <input type="range" min={0} max={100} value={reliability} onChange={(e) => setReliability(Number(e.target.value))} className="w-full accent-indigo-500" />
          </Field>
          <div className="flex justify-end">
            <button className={btnPrimary} disabled={!label.trim() || busy === 'evidence-add'} onClick={add}>
              {busy === 'evidence-add' ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Paperclip className="w-3.5 h-3.5" />}
              Attach Evidence
            </button>
          </div>
        </div>
      )}
      {items.length === 0 ? (
        <p className="text-sm text-zinc-400 text-center py-4">No evidence attached.</p>
      ) : (
        <ul className="space-y-2">
          {items.map((e) => (
            <li key={e.id} className="flex items-start justify-between gap-3 rounded-md border border-zinc-800 px-3 py-2">
              <div className="min-w-0">
                <p className="text-sm text-zinc-200 flex items-center gap-1.5">
                  <FileText className="w-3.5 h-3.5 text-zinc-400 shrink-0" />
                  {e.label}
                  <span className="text-[10px] text-zinc-400 uppercase">{e.kind}</span>
                </p>
                {e.url && (
                  <a href={e.url} target="_blank" rel="noopener noreferrer" className="text-xs text-indigo-400 hover:underline break-all">{e.url}</a>
                )}
                {e.note && <p className="text-xs text-zinc-400 mt-0.5">{e.note}</p>}
                <p className="text-[11px] text-zinc-400 mt-0.5">Reliability {Math.round(e.reliability * 100)}% · {fmtDate(e.uploadedAt)}</p>
              </div>
              {!closed && (
                <button aria-label="Remove evidence"
                  className="text-zinc-600 hover:text-rose-400"
                  disabled={busy === 'evidence-remove'}
                  onClick={() => run('evidence-remove', { caseId: c.id, evidenceId: e.id }, 'evidence-remove')}
                >
                  <Trash2 className="w-3.5 h-3.5" />
                </button>
              )}
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

/* ------------------------------------------------------------------ */
/*  Messages tab                                                       */
/* ------------------------------------------------------------------ */

function MessagesTab({ c, messages, busy, run }: { c: PublicCase; messages: ThreadMessage[]; busy: string | null; run: RunFn }) {
  const [body, setBody] = useState('');
  const [role, setRole] = useState('claimant');

  const post = async () => {
    const ok = await run('message-post', { caseId: c.id, body: body.trim(), role }, 'message-post');
    if (ok) setBody('');
  };

  return (
    <div className="space-y-3">
      <div className="space-y-2 max-h-72 overflow-y-auto">
        {messages.length === 0 ? (
          <p className="text-sm text-zinc-400 text-center py-4">No messages in this thread yet.</p>
        ) : (
          messages.map((m) => (
            <div key={m.id} className={`rounded-md border px-3 py-2 ${
              m.role === 'mediator' ? 'border-purple-500/30 bg-purple-500/5'
                : m.role === 'respondent' ? 'border-orange-500/30 bg-orange-500/5'
                : 'border-blue-500/30 bg-blue-500/5'
            }`}>
              <div className="flex items-center justify-between">
                <span className="text-[11px] font-medium uppercase tracking-wider text-zinc-400">{m.role}</span>
                <span className="text-[10px] text-zinc-400">{fmtDate(m.postedAt)}</span>
              </div>
              <p className="text-sm text-zinc-200 mt-0.5">{m.body}</p>
            </div>
          ))
        )}
      </div>
      <div className="flex gap-2">
        <select className="rounded-md bg-zinc-900 border border-zinc-700 px-2 py-1.5 text-sm text-zinc-100" value={role} onChange={(e) => setRole(e.target.value)}>
          <option value="claimant">Claimant</option>
          <option value="respondent">Respondent</option>
          <option value="mediator">Mediator</option>
        </select>
        <input className={inputCls} value={body} onChange={(e) => setBody(e.target.value)} placeholder="Write a message…" onKeyDown={(e) => { if (e.key === 'Enter' && body.trim()) post(); }} />
        <button className={btnPrimary} disabled={!body.trim() || busy === 'message-post'} onClick={post}>
          {busy === 'message-post' ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Send className="w-3.5 h-3.5" />}
        </button>
      </div>
    </div>
  );
}

/* ------------------------------------------------------------------ */
/*  Offers tab                                                         */
/* ------------------------------------------------------------------ */

function OffersTab({ c, offers, busy, run, closed }: { c: PublicCase; offers: SettlementOffer[]; busy: string | null; run: RunFn; closed: boolean }) {
  const [amount, setAmount] = useState('');
  const [fromRole, setFromRole] = useState('respondent');
  const [terms, setTerms] = useState('');

  const make = async () => {
    const ok = await run('offer-make', { caseId: c.id, amount: Number(amount), fromRole, terms: terms.trim() || undefined }, 'offer-make');
    if (ok) { setAmount(''); setTerms(''); }
  };

  return (
    <div className="space-y-3">
      {!closed && (
        <div className="rounded-md border border-zinc-800 p-3 space-y-2.5">
          <div className="grid grid-cols-2 gap-2">
            <Field label="Offer Amount (CC)">
              <input className={inputCls} type="number" value={amount} onChange={(e) => setAmount(e.target.value)} />
            </Field>
            <Field label="From">
              <select className={inputCls} value={fromRole} onChange={(e) => setFromRole(e.target.value)}>
                <option value="claimant">Claimant</option>
                <option value="respondent">Respondent</option>
                <option value="mediator">Mediator</option>
              </select>
            </Field>
          </div>
          <Field label="Terms (optional)">
            <input className={inputCls} value={terms} onChange={(e) => setTerms(e.target.value)} placeholder="Conditions of this offer…" />
          </Field>
          <div className="flex justify-end">
            <button className={btnPrimary} disabled={!amount || busy === 'offer-make'} onClick={make}>
              {busy === 'offer-make' ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Gavel className="w-3.5 h-3.5" />}
              {offers.length > 0 ? 'Counter-Offer' : 'Make Offer'}
            </button>
          </div>
        </div>
      )}
      {offers.length === 0 ? (
        <p className="text-sm text-zinc-400 text-center py-4">No settlement offers yet.</p>
      ) : (
        <ul className="space-y-2">
          {offers.map((o) => (
            <li key={o.id} className="rounded-md border border-zinc-800 px-3 py-2">
              <div className="flex items-center justify-between gap-3">
                <div>
                  <p className="text-sm text-zinc-200 flex items-center gap-1.5">
                    <DollarSign className="w-3.5 h-3.5 text-green-400" />
                    {o.amount} CC
                    {o.isCounter && <span className="text-[10px] text-amber-400 uppercase">Counter</span>}
                    <span className="text-[10px] text-zinc-400 uppercase">from {o.fromRole}</span>
                  </p>
                  {o.terms && <p className="text-xs text-zinc-400 mt-0.5">{o.terms}</p>}
                  <p className="text-[11px] text-zinc-400 mt-0.5">{fmtDate(o.madeAt)}</p>
                </div>
                <div className="flex flex-col items-end gap-1.5">
                  <span className={`text-[11px] px-2 py-0.5 rounded-full ${
                    o.status === 'accepted' ? 'bg-green-500/15 text-green-400'
                      : o.status === 'rejected' ? 'bg-rose-500/15 text-rose-400'
                      : o.status === 'superseded' ? 'bg-zinc-700/40 text-zinc-400'
                      : 'bg-yellow-500/15 text-yellow-400'
                  }`}>{fmtLabel(o.status)}</span>
                  {o.status === 'pending' && (
                    <div className="flex gap-1">
                      <button
                        className="text-[11px] px-2 py-0.5 rounded bg-green-600 hover:bg-green-500 text-white disabled:opacity-40"
                        disabled={busy === 'offer-respond'}
                        onClick={() => run('offer-respond', { caseId: c.id, offerId: o.id, decision: 'accept' }, 'offer-respond')}
                      >Accept</button>
                      <button
                        className="text-[11px] px-2 py-0.5 rounded bg-rose-600 hover:bg-rose-500 text-white disabled:opacity-40"
                        disabled={busy === 'offer-respond'}
                        onClick={() => run('offer-respond', { caseId: c.id, offerId: o.id, decision: 'reject' }, 'offer-respond')}
                      >Reject</button>
                    </div>
                  )}
                </div>
              </div>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

/* ------------------------------------------------------------------ */
/*  History tab                                                        */
/* ------------------------------------------------------------------ */

function HistoryTab({ history }: { history: HistoryEntry[] }) {
  const events: TimelineEvent[] = history.map((h, i) => ({
    id: `${h.at}_${i}`,
    label: fmtLabel(h.event),
    time: h.at,
    tone: h.event.includes('resolved') ? 'good'
      : h.event.includes('escalation') || h.event.includes('rejected') ? 'bad'
      : h.event.includes('escrow') ? 'warn' : 'info',
    detail: h.actor === 'system' ? 'Automated' : `by ${h.actor}`,
  }));
  if (events.length === 0) return <p className="text-sm text-zinc-400 text-center py-4">No history.</p>;
  return (
    <div className="space-y-3">
      <TimelineView events={events} height={110} />
      <ul className="space-y-1">
        {history.slice().reverse().map((h, i) => (
          <li key={i} className="flex items-center gap-3 text-xs">
            <span className="text-zinc-600 font-mono shrink-0">{new Date(h.at).toLocaleString()}</span>
            <span className="text-zinc-300">{fmtLabel(h.event)}</span>
            <span className="text-zinc-600">{h.actor === 'system' ? '(auto)' : h.actor}</span>
          </li>
        ))}
      </ul>
    </div>
  );
}

/* ------------------------------------------------------------------ */
/*  Archive panel                                                      */
/* ------------------------------------------------------------------ */

function ArchivePanel() {
  const [query, setQuery] = useState('');
  const [outcomeType, setOutcomeType] = useState('all');
  const [results, setResults] = useState<PublicCase[]>([]);
  const [meta, setMeta] = useState<{ total: number; totalRefunded: number; avgResolutionDays: number; outcomeBreakdown: Record<string, number> } | null>(null);
  const [searching, setSearching] = useState(false);

  const search = useCallback(async () => {
    setSearching(true);
    const r = await lensRun('disputes', 'archive-search', {
      query: query.trim() || undefined,
      outcomeType,
    });
    if (r.data.ok && r.data.result) {
      const res = r.data.result as any;
      setResults(res.cases || []);
      setMeta({
        total: res.total,
        totalRefunded: res.totalRefunded,
        avgResolutionDays: res.avgResolutionDays,
        outcomeBreakdown: res.outcomeBreakdown || {},
      });
    }
    setSearching(false);
  }, [query, outcomeType]);

  useEffect(() => {
    search();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const chartData = meta
    ? Object.entries(meta.outcomeBreakdown).map(([k, v]) => ({ name: fmtLabel(k), count: v }))
    : [];

  return (
    <div className="rounded-lg border border-zinc-800 bg-zinc-950/40 p-4 space-y-3">
      <h3 className="text-sm font-semibold text-zinc-200 flex items-center gap-2">
        <Search className="w-4 h-4 text-indigo-400" /> Resolved Case Archive
      </h3>
      <div className="flex gap-2">
        <input className={inputCls} value={query} onChange={(e) => setQuery(e.target.value)} placeholder="Search title, description, type…" onKeyDown={(e) => { if (e.key === 'Enter') search(); }} />
        <select className="rounded-md bg-zinc-900 border border-zinc-700 px-2 py-1.5 text-sm text-zinc-100" value={outcomeType} onChange={(e) => setOutcomeType(e.target.value)}>
          <option value="all">All outcomes</option>
          {OUTCOME_TYPES.map((t) => <option key={t} value={t}>{fmtLabel(t)}</option>)}
        </select>
        <button className={btnPrimary} onClick={search} disabled={searching}>
          {searching ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Search className="w-3.5 h-3.5" />}
          Search
        </button>
      </div>

      {meta && (
        <div className="grid grid-cols-3 gap-2">
          <div className="rounded-md border border-zinc-800 px-3 py-2">
            <p className="text-lg font-bold text-zinc-200">{meta.total}</p>
            <p className="text-[10px] uppercase tracking-wider text-zinc-400">Closed Cases</p>
          </div>
          <div className="rounded-md border border-zinc-800 px-3 py-2">
            <p className="text-lg font-bold text-green-400">{meta.totalRefunded}</p>
            <p className="text-[10px] uppercase tracking-wider text-zinc-400">Total Refunded</p>
          </div>
          <div className="rounded-md border border-zinc-800 px-3 py-2">
            <p className="text-lg font-bold text-blue-400">{meta.avgResolutionDays}d</p>
            <p className="text-[10px] uppercase tracking-wider text-zinc-400">Avg Resolution</p>
          </div>
        </div>
      )}

      {chartData.length > 0 && (
        <ChartKit
          kind="bar"
          data={chartData}
          xKey="name"
          series={[{ key: 'count', label: 'Cases' }]}
          height={180}
          showLegend={false}
        />
      )}

      {results.length === 0 ? (
        <p className="text-sm text-zinc-400 text-center py-3">No matching resolved cases.</p>
      ) : (
        <ul className="space-y-1.5">
          {results.map((c) => (
            <li key={c.id} className="flex items-center justify-between gap-3 rounded-md border border-zinc-800 px-3 py-2">
              <div className="min-w-0">
                <p className="text-sm text-zinc-200 truncate">{c.title}</p>
                <p className="text-[11px] text-zinc-400">
                  #{c.caseNumber} · {fmtLabel(c.dispute_type)} · resolved {fmtDate(c.resolvedAt)}
                </p>
              </div>
              <div className="flex items-center gap-2 shrink-0">
                {c.outcome && <span className="text-[11px] text-zinc-400">{fmtLabel(c.outcome.type)}</span>}
                <StatusPill status={c.status} />
              </div>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
