'use client';

/**
 * CaseManagementPanel — genuine persisted Case entity (migration 362).
 *
 * Prior to this component there was NO persisted "Case" record in the
 * law-enforcement lens at all: `caseAnalysis` is a pure-compute
 * case-strength calculator over caller-supplied evidence/witness/suspect
 * counts (never writes anything), and the closest persisted case-adjacent
 * records were reports (`reportDraft`/`reportList`) and bookings
 * (`bookingCreate`) — each carrying a free-text `caseNumber` field with
 * nothing behind it. See docs/lens-specs/law-enforcement-capability-map.md
 * ("No persisted 'Case' record type exists server-side" — closed) and
 * docs/WAVE4_INVENTORY.md's `| law-enforcement |` row.
 *
 * This panel is a real detective's case board: a case list with a status
 * filter, a structured create form (title / synopsis / case number /
 * assigned detective — no JSON-paste), a detail view driven by the new
 * `caseLinked` macro (which JOINs reports/evidence/bookings/warrants by
 * matching `caseNumber`, case-insensitive), and a status-transition
 * control that only offers the transitions the backend state machine
 * actually allows (open -> under_investigation/closed,
 * under_investigation -> closed/cold/open, closed -> open (reopen),
 * cold -> under_investigation/closed).
 *
 * Every value rendered comes from a real `law-enforcement.case*` macro
 * round-trip against migration 362's `le_cases` table. No seed data.
 */

import { useState, useCallback, useEffect } from 'react';
import { lensRun } from '@/lib/api/client';
import {
  Folder, FolderOpen, FolderCheck, FolderClock, Plus, Loader2, Check,
  AlertTriangle, ArrowRight, FileText, Boxes, Fingerprint, Scale,
} from 'lucide-react';
import { cn } from '@/lib/utils';

const DOMAIN = 'law-enforcement';

async function run<T = unknown>(action: string, input: Record<string, unknown> = {}): Promise<{ ok: boolean; result: T | null; error: string | null }> {
  const r = await lensRun<T>(DOMAIN, action, input);
  return r.data;
}

// ---- shared primitives (mirrors RmsCadConsole's house style) --------------

function Field({ label, ...rest }: { label: string } & React.InputHTMLAttributes<HTMLInputElement>) {
  return (
    <label className="block">
      <span className="text-[10px] uppercase tracking-wider text-zinc-400 font-semibold">{label}</span>
      <input
        {...rest}
        className="w-full mt-0.5 bg-zinc-900 border border-zinc-800 rounded px-2.5 py-1.5 text-xs text-white placeholder-zinc-600 focus:border-blue-500 focus:outline-none"
      />
    </label>
  );
}

function Btn({ children, busy, variant = 'primary', ...rest }: { children: React.ReactNode; busy?: boolean; variant?: 'primary' | 'ghost' } & React.ButtonHTMLAttributes<HTMLButtonElement>) {
  return (
    <button
      {...rest}
      disabled={busy || rest.disabled}
      className={cn(
        'flex items-center justify-center gap-1.5 px-3 py-1.5 rounded text-xs font-semibold transition-colors disabled:opacity-40 disabled:cursor-not-allowed',
        variant === 'primary' ? 'bg-blue-600 hover:bg-blue-500 text-white' : 'bg-zinc-800 hover:bg-zinc-700 text-zinc-200',
      )}
    >
      {busy ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : children}
    </button>
  );
}

function Banner({ feedback }: { feedback: { kind: 'ok' | 'err'; text: string } | null }) {
  if (!feedback) return null;
  return (
    <div className={cn(
      'flex items-start gap-2 px-3 py-1.5 rounded text-[11px] border',
      feedback.kind === 'ok'
        ? 'bg-emerald-500/10 text-emerald-300 border-emerald-500/30'
        : 'bg-red-500/10 text-red-300 border-red-500/30',
    )}>
      {feedback.kind === 'ok' ? <Check className="w-3 h-3 mt-0.5" /> : <AlertTriangle className="w-3 h-3 mt-0.5" />}
      <span>{feedback.text}</span>
    </div>
  );
}

// ---- types ------------------------------------------------------------

export interface CaseRec {
  id: string;
  caseNumber: string;
  title: string;
  synopsis: string;
  status: 'open' | 'under_investigation' | 'closed' | 'cold';
  assignedDetective: string;
  openedAt: string;
  closedAt: string | null;
  closureReason: string | null;
  createdAt: string;
  updatedAt: string;
}

interface LinkedReport { id: string; reportNumber: string; offense: string; status: string; }
interface LinkedEvidence { id: string; barcode: string; description: string; status: string; }
interface LinkedBooking { id: string; bookingNumber: string; subjectName: string; kind: string; }
interface LinkedWarrant { id: string; warrantNumber: string; subject: string; status: string; }

interface CaseLinked {
  case: CaseRec;
  reports: LinkedReport[];
  evidence: LinkedEvidence[];
  bookings: LinkedBooking[];
  warrants: LinkedWarrant[];
  counts: { reports: number; evidence: number; bookings: number; warrants: number };
}

const STATUS_TONE: Record<string, string> = {
  open: 'text-blue-300 bg-blue-500/15',
  under_investigation: 'text-amber-300 bg-amber-500/15',
  closed: 'text-emerald-300 bg-emerald-500/15',
  cold: 'text-zinc-400 bg-zinc-500/15',
};
const STATUS_ICON: Record<string, typeof Folder> = {
  open: FolderOpen, under_investigation: Folder, closed: FolderCheck, cold: FolderClock,
};
const CASE_TRANSITIONS: Record<string, string[]> = {
  open: ['under_investigation', 'closed'],
  under_investigation: ['closed', 'cold', 'open'],
  closed: ['open'],
  cold: ['under_investigation', 'closed'],
};

export function CaseManagementPanel() {
  const [cases, setCases] = useState<CaseRec[]>([]);
  const [statusFilter, setStatusFilter] = useState<string>('');
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [linked, setLinked] = useState<CaseLinked | null>(null);
  const [feedback, setFeedback] = useState<{ kind: 'ok' | 'err'; text: string } | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);

  // Create form
  const [title, setTitle] = useState('');
  const [caseNumber, setCaseNumber] = useState('');
  const [synopsis, setSynopsis] = useState('');
  const [assignedDetective, setAssignedDetective] = useState('');
  const [closureReason, setClosureReason] = useState('');

  const refreshList = useCallback(async () => {
    setLoading(true);
    const r = await run<{ cases: CaseRec[] }>('caseList', statusFilter ? { status: statusFilter } : {});
    if (r.ok && r.result) setCases(r.result.cases);
    setLoading(false);
  }, [statusFilter]);

  // eslint-disable-next-line react-hooks/exhaustive-deps
  useEffect(() => { refreshList(); }, [statusFilter]);

  const loadLinked = useCallback(async (id: string) => {
    const r = await run<CaseLinked>('caseLinked', { id });
    if (r.ok && r.result) setLinked(r.result);
    else { setLinked(null); setFeedback({ kind: 'err', text: r.error || 'Could not load case detail.' }); }
  }, []);

  useEffect(() => { if (selectedId) void loadLinked(selectedId); else setLinked(null); }, [selectedId, loadLinked]);

  async function create() {
    if (!title.trim()) { setFeedback({ kind: 'err', text: 'Case title is required.' }); return; }
    setBusy('create'); setFeedback(null);
    const r = await run<{ case: CaseRec }>('caseCreate', {
      title: title.trim(),
      caseNumber: caseNumber.trim() || undefined,
      synopsis: synopsis.trim(),
      assignedDetective: assignedDetective.trim(),
    });
    if (r.ok && r.result) {
      setFeedback({ kind: 'ok', text: `Opened ${r.result.case.caseNumber}.` });
      setTitle(''); setCaseNumber(''); setSynopsis(''); setAssignedDetective('');
      await refreshList();
      setSelectedId(r.result.case.id);
    } else setFeedback({ kind: 'err', text: r.error || 'Could not open case.' });
    setBusy(null);
  }

  async function transition(id: string, nextStatus: string) {
    setBusy(`t-${nextStatus}`); setFeedback(null);
    const r = await run<{ case: CaseRec }>('caseUpdate', {
      id, status: nextStatus,
      ...(nextStatus === 'closed' ? { closureReason: closureReason.trim() } : {}),
    });
    if (r.ok && r.result) {
      setFeedback({ kind: 'ok', text: `Status → ${nextStatus.replace(/_/g, ' ')}.` });
      setClosureReason('');
      await refreshList();
      await loadLinked(id);
    } else setFeedback({ kind: 'err', text: r.error || 'Transition rejected.' });
    setBusy(null);
  }

  async function reassign(id: string, name: string) {
    setBusy('reassign');
    const r = await run<{ case: CaseRec }>('caseUpdate', { id, assignedDetective: name });
    if (r.ok && r.result) { setFeedback({ kind: 'ok', text: `Assigned to ${name || '(unassigned)'}.` }); await loadLinked(id); await refreshList(); }
    else setFeedback({ kind: 'err', text: r.error || 'Could not reassign.' });
    setBusy(null);
  }

  const selected = linked?.case ?? null;

  return (
    <div className="space-y-4">
      <Banner feedback={feedback} />

      <div className="rounded-lg border border-zinc-800 bg-zinc-950/40 p-3 space-y-2">
        <h4 className="text-xs font-semibold text-white flex items-center gap-1.5"><Plus className="w-3.5 h-3.5 text-blue-400" /> Open Case</h4>
        <div className="grid grid-cols-2 md:grid-cols-4 gap-2">
          <Field label="Title" value={title} onChange={(e) => setTitle(e.target.value)} placeholder="Oak St burglary series" className="md:col-span-2" />
          <Field label="Case number (optional)" value={caseNumber} onChange={(e) => setCaseNumber(e.target.value)} placeholder="auto-generated if blank" />
          <Field label="Assigned detective" value={assignedDetective} onChange={(e) => setAssignedDetective(e.target.value)} placeholder="Det. Ramos" />
        </div>
        <Field label="Synopsis" value={synopsis} onChange={(e) => setSynopsis(e.target.value)} placeholder="3 linked break-ins on the same block, same MO" />
        <Btn busy={busy === 'create'} onClick={create}><Plus className="w-3.5 h-3.5" /> Open Case</Btn>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-[minmax(0,1fr)_minmax(0,1.2fr)] gap-3">
        {/* ---- case list ---- */}
        <div>
          <div className="flex items-center justify-between mb-1.5">
            <h4 className="text-xs font-semibold text-white">Case Board ({cases.length})</h4>
            <select
              value={statusFilter}
              onChange={(e) => setStatusFilter(e.target.value)}
              className="bg-zinc-900 border border-zinc-800 rounded px-2 py-1 text-[10px] text-zinc-300 focus:border-blue-500 focus:outline-none"
            >
              <option value="">all statuses</option>
              <option value="open">open</option>
              <option value="under_investigation">under investigation</option>
              <option value="closed">closed</option>
              <option value="cold">cold</option>
            </select>
          </div>
          {loading && cases.length === 0 && (
            <div role="status" className="flex items-center gap-2 py-6 justify-center text-zinc-400">
              <Loader2 className="w-4 h-4 animate-spin" /> <span className="text-xs">Loading case board…</span>
            </div>
          )}
          <div className="space-y-1.5 max-h-[26rem] overflow-y-auto pr-1">
            {cases.map((c) => {
              const Icon = STATUS_ICON[c.status] || Folder;
              return (
                <button
                  key={c.id}
                  type="button"
                  onClick={() => setSelectedId(c.id)}
                  className={cn(
                    'w-full text-left p-2.5 rounded-lg border transition-colors',
                    selectedId === c.id ? 'bg-blue-500/10 border-blue-500/40' : 'bg-zinc-900 border-zinc-800 hover:border-zinc-700',
                  )}
                >
                  <div className="flex items-center gap-2">
                    <Icon className="w-3.5 h-3.5 text-zinc-400 shrink-0" />
                    <span className="text-[10px] font-mono px-1.5 py-0.5 rounded bg-zinc-800 text-zinc-300">{c.caseNumber}</span>
                    <span className={cn('text-[10px] px-1.5 py-0.5 rounded font-semibold', STATUS_TONE[c.status])}>{c.status.replace(/_/g, ' ')}</span>
                  </div>
                  <div className="text-xs font-semibold text-white truncate mt-1">{c.title}</div>
                  <div className="text-[10px] text-zinc-400 truncate">{c.assignedDetective || 'unassigned'} · opened {new Date(c.openedAt).toLocaleDateString()}</div>
                </button>
              );
            })}
            {!loading && cases.length === 0 && <p className="text-[11px] text-zinc-400 py-4 text-center">No cases on file.</p>}
          </div>
        </div>

        {/* ---- case detail ---- */}
        <div className="rounded-lg border border-zinc-800 bg-zinc-950/40 p-3">
          {!selected && <p className="text-[11px] text-zinc-400 py-8 text-center">Select a case to view linked reports, evidence, bookings, and warrants.</p>}
          {selected && (
            <div className="space-y-3">
              <div>
                <div className="flex items-center gap-2 flex-wrap">
                  <span className="text-[10px] font-mono px-1.5 py-0.5 rounded bg-blue-500/15 text-blue-300">{selected.caseNumber}</span>
                  <span className={cn('text-[10px] px-1.5 py-0.5 rounded font-semibold', STATUS_TONE[selected.status])}>{selected.status.replace(/_/g, ' ')}</span>
                </div>
                <h3 className="text-sm font-bold text-white mt-1">{selected.title}</h3>
                {selected.synopsis && <p className="text-[11px] text-zinc-400 mt-0.5">{selected.synopsis}</p>}
                {selected.closureReason && <p className="text-[11px] text-emerald-300 mt-0.5">Closure: {selected.closureReason}</p>}
              </div>

              <div className="flex items-center gap-2 flex-wrap">
                <Field
                  label="Assigned detective"
                  defaultValue={selected.assignedDetective}
                  onBlur={(e) => { if (e.target.value !== selected.assignedDetective) void reassign(selected.id, e.target.value); }}
                  placeholder="unassigned"
                  className="w-48"
                />
              </div>

              <div className="flex items-center gap-1.5 flex-wrap">
                <span className="text-[10px] uppercase tracking-wider text-zinc-500 mr-1">Transition:</span>
                {(CASE_TRANSITIONS[selected.status] || []).map((next) => (
                  <button
                    key={next}
                    type="button"
                    disabled={busy === `t-${next}`}
                    onClick={() => transition(selected.id, next)}
                    className="flex items-center gap-1 text-[10px] px-2 py-1 rounded bg-zinc-800 hover:bg-zinc-700 disabled:opacity-30 text-zinc-200 transition-colors"
                  >
                    <ArrowRight className="w-3 h-3" /> {next.replace(/_/g, ' ')}
                  </button>
                ))}
                {(CASE_TRANSITIONS[selected.status] || []).includes('closed') && (
                  <Field label="" value={closureReason} onChange={(e) => setClosureReason(e.target.value)} placeholder="closure reason (optional)" className="w-44" />
                )}
              </div>

              <div className="grid grid-cols-2 md:grid-cols-4 gap-2">
                <div className="p-2 bg-zinc-900 rounded border border-zinc-800 text-center">
                  <div className="flex items-center justify-center gap-1 text-amber-300"><FileText className="w-3 h-3" /><span className="text-lg font-bold">{linked?.counts.reports ?? 0}</span></div>
                  <div className="text-[9px] text-zinc-400 uppercase tracking-wider">Reports</div>
                </div>
                <div className="p-2 bg-zinc-900 rounded border border-zinc-800 text-center">
                  <div className="flex items-center justify-center gap-1 text-cyan-300"><Boxes className="w-3 h-3" /><span className="text-lg font-bold">{linked?.counts.evidence ?? 0}</span></div>
                  <div className="text-[9px] text-zinc-400 uppercase tracking-wider">Evidence</div>
                </div>
                <div className="p-2 bg-zinc-900 rounded border border-zinc-800 text-center">
                  <div className="flex items-center justify-center gap-1 text-pink-300"><Fingerprint className="w-3 h-3" /><span className="text-lg font-bold">{linked?.counts.bookings ?? 0}</span></div>
                  <div className="text-[9px] text-zinc-400 uppercase tracking-wider">Bookings</div>
                </div>
                <div className="p-2 bg-zinc-900 rounded border border-zinc-800 text-center">
                  <div className="flex items-center justify-center gap-1 text-purple-300"><Scale className="w-3 h-3" /><span className="text-lg font-bold">{linked?.counts.warrants ?? 0}</span></div>
                  <div className="text-[9px] text-zinc-400 uppercase tracking-wider">Warrants</div>
                </div>
              </div>

              {linked && (linked.reports.length + linked.evidence.length + linked.bookings.length + linked.warrants.length > 0) && (
                <div className="space-y-1 max-h-40 overflow-y-auto pr-1">
                  {linked.reports.map((r) => <div key={r.id} className="text-[10px] text-zinc-300 truncate">📄 {r.reportNumber} — {r.offense} ({r.status})</div>)}
                  {linked.evidence.map((e) => <div key={e.id} className="text-[10px] text-zinc-300 truncate">📦 {e.barcode} — {e.description} ({e.status})</div>)}
                  {linked.bookings.map((b) => <div key={b.id} className="text-[10px] text-zinc-300 truncate">🖐 {b.bookingNumber} — {b.subjectName} ({b.kind})</div>)}
                  {linked.warrants.map((w) => <div key={w.id} className="text-[10px] text-zinc-300 truncate">⚖ {w.warrantNumber} — {w.subject} ({w.status})</div>)}
                </div>
              )}
              {linked && (linked.reports.length + linked.evidence.length + linked.bookings.length + linked.warrants.length === 0) && (
                <p className="text-[10px] text-zinc-500">No reports, evidence, bookings, or warrants filed against this case number yet — file one with the same Case Number ({selected.caseNumber}) in the RMS/CAD Console or Quick Analysis tab to link it.</p>
              )}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

export default CaseManagementPanel;
