'use client';


/**
 * SentinelTriage — threat triage workbench. Promotes scanned threats into
 * tracked cases, drives a case state machine (open → investigating →
 * contained → resolved/dismissed), assigns owners, takes notes, and
 * correlates intel findings. Wires sentinel.triage.* + sentinel.intel.*.
 */

import { useCallback, useEffect, useState } from 'react';
import { lensRun } from '@/lib/api/client';
import {
  AlertOctagon, Loader2, UserPlus, StickyNote, Link2, Unlink, RefreshCw,
  ShieldCheck, ShieldX,
} from 'lucide-react';

const TRIAGE_STATES = ['open', 'investigating', 'contained', 'resolved', 'dismissed'] as const;
type TriageState = (typeof TRIAGE_STATES)[number];

const SEV_TONE: Record<string, string> = {
  critical: 'bg-rose-900/50 text-rose-200 border-rose-700/50',
  high: 'bg-orange-900/50 text-orange-200 border-orange-700/50',
  medium: 'bg-amber-900/50 text-amber-200 border-amber-700/50',
  low: 'bg-sky-900/50 text-sky-200 border-sky-700/50',
  info: 'bg-zinc-800 text-zinc-300 border-zinc-700',
  unknown: 'bg-zinc-800 text-zinc-400 border-zinc-700',
};

const STATE_TONE: Record<string, string> = {
  open: 'text-rose-300',
  investigating: 'text-amber-300',
  contained: 'text-sky-300',
  resolved: 'text-emerald-300',
  dismissed: 'text-zinc-400',
};

interface IntelLink {
  id: string;
  intelDomain: string;
  summary: string;
  relevance: number;
  linkedAt: string;
}
interface CaseNote { id: string; at: string; text: string; by: string }
interface TriageCase {
  caseId: string;
  threatId: string;
  title: string;
  severity: string;
  state: TriageState;
  assignee: string | null;
  description: string;
  vector: string | null;
  notes: CaseNote[];
  correlatedIntel: IntelLink[];
  createdAt: string;
  updatedAt: string;
}

export function SentinelTriage({ onChanged }: { onChanged?: () => void }) {
  const [cases, setCases] = useState<TriageCase[]>([]);
  const [byState, setByState] = useState<Record<string, number>>({});
  const [filter, setFilter] = useState<TriageState | 'all'>('all');
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [selected, setSelected] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [note, setNote] = useState('');
  const [assignee, setAssignee] = useState('');
  const [intelDomain, setIntelDomain] = useState('');
  const [intelSummary, setIntelSummary] = useState('');

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    const input: Record<string, unknown> = {};
    if (filter !== 'all') input.state = filter;
    try {
      const r = await lensRun('sentinel', 'triage.list', input);
      if (r.data?.ok === false) {
        setError(r.data?.error || 'Failed to load triage cases.');
        setLoading(false);
        return;
      }
      const res = r.data?.result as { cases?: TriageCase[]; byState?: Record<string, number> } | null;
      setCases(res?.cases ?? []);
      setByState(res?.byState ?? {});
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to load triage cases.');
    } finally {
      setLoading(false);
    }
  }, [filter]);

  useEffect(() => { load(); }, [load]);

  const detail = cases.find((c) => c.caseId === selected) ?? null;

  async function transition(caseId: string, patch: Record<string, unknown>) {
    setBusy(true);
    await lensRun('sentinel', 'triage.update', { caseId, ...patch });
    await load();
    setBusy(false);
    onChanged?.();
  }

  async function correlate() {
    if (!detail || !intelDomain.trim() || !intelSummary.trim()) return;
    setBusy(true);
    await lensRun('sentinel', 'intel.correlate', {
      caseId: detail.caseId,
      intelDomain: intelDomain.trim(),
      summary: intelSummary.trim(),
      relevance: 0.7,
    });
    setIntelDomain('');
    setIntelSummary('');
    await load();
    setBusy(false);
    onChanged?.();
  }

  async function uncorrelate(linkId: string) {
    if (!detail) return;
    setBusy(true);
    await lensRun('sentinel', 'intel.uncorrelate', { caseId: detail.caseId, linkId });
    await load();
    setBusy(false);
  }

  return (
    <div className="grid gap-4 lg:grid-cols-[minmax(0,1fr)_minmax(0,1.3fr)]">
      <div>
        <div className="mb-3 flex flex-wrap items-center gap-1.5">
          {(['all', ...TRIAGE_STATES] as const).map((s) => (
            <button
              key={s}
              onClick={() => setFilter(s)}
              className={`rounded px-2 py-1 text-xs capitalize transition-colors ${
                filter === s ? 'bg-blue-700/50 text-blue-100' : 'bg-blue-950/30 text-blue-500 hover:text-blue-300'
              }`}
              aria-pressed={filter === s}
            >
              {s}
              {s !== 'all' && byState[s] != null && (
                <span className="ml-1 text-[10px] text-blue-400">{byState[s]}</span>
              )}
            </button>
          ))}
          <button
            onClick={load}
            className="ml-auto inline-flex items-center gap-1 rounded bg-blue-950/40 px-2 py-1 text-xs text-blue-400 hover:text-blue-200"
          >
            <RefreshCw className="h-3 w-3" /> Refresh
          </button>
        </div>

        {loading ? (
          <p
            data-testid="sentinel-triage-loading"
            className="flex items-center gap-2 px-3 py-6 text-xs text-blue-600"
            role="status"
            aria-busy="true"
          >
            <Loader2 className="h-4 w-4 animate-spin" /> Loading cases…
          </p>
        ) : error ? (
          <div
            data-testid="sentinel-triage-error"
            role="alert"
            className="rounded border border-rose-900/50 bg-rose-950/20 px-4 py-6 text-center text-xs text-rose-300"
          >
            <p>{error}</p>
            <button
              onClick={load}
              aria-label="Retry loading triage cases"
              className="mt-2 inline-flex items-center gap-1 rounded bg-rose-900/40 px-2 py-1 text-rose-200 hover:bg-rose-900/60"
            >
              <RefreshCw className="h-3 w-3" /> Retry
            </button>
          </div>
        ) : cases.length === 0 ? (
          <p
            data-testid="sentinel-triage-empty"
            className="rounded border border-blue-900/30 bg-blue-950/10 px-4 py-6 text-center text-xs text-blue-600"
          >
            No triage cases. Open one from a Shield threat.
          </p>
        ) : (
          <ul data-testid="sentinel-triage-list" className="space-y-1.5">
            {cases.map((c) => (
              <li key={c.caseId}>
                <button
                  onClick={() => setSelected(c.caseId)}
                  className={`w-full rounded border px-3 py-2 text-left text-xs transition-colors ${
                    selected === c.caseId
                      ? 'border-blue-500 bg-blue-950/40'
                      : 'border-blue-900/30 bg-blue-950/10 hover:border-blue-700/50'
                  }`}
                >
                  <div className="flex items-center gap-2">
                    <AlertOctagon className="h-3.5 w-3.5 shrink-0 text-rose-400" aria-hidden />
                    <span className="truncate font-medium text-blue-100">{c.title}</span>
                    <span className={`ml-auto shrink-0 rounded border px-1.5 py-0.5 text-[10px] ${SEV_TONE[c.severity]}`}>
                      {c.severity}
                    </span>
                  </div>
                  <div className="mt-1 flex items-center gap-2 text-[10px] text-blue-600">
                    <span className={`font-medium capitalize ${STATE_TONE[c.state]}`}>{c.state}</span>
                    <span>· {c.assignee ? `@${c.assignee}` : 'unassigned'}</span>
                    {c.correlatedIntel.length > 0 && <span>· {c.correlatedIntel.length} intel</span>}
                    <span className="ml-auto">{new Date(c.updatedAt).toLocaleDateString()}</span>
                  </div>
                </button>
              </li>
            ))}
          </ul>
        )}
      </div>

      <div className="rounded-lg border border-blue-900/40 bg-blue-950/10 p-4">
        {!detail ? (
          <p className="py-12 text-center text-xs text-blue-700">Select a case to triage.</p>
        ) : (
          <div className="space-y-4">
            <div>
              <div className="flex items-start gap-2">
                <h3 className="text-sm font-semibold text-blue-100">{detail.title}</h3>
                <span className={`ml-auto shrink-0 rounded border px-1.5 py-0.5 text-[10px] ${SEV_TONE[detail.severity]}`}>
                  {detail.severity}
                </span>
              </div>
              <p className="mt-0.5 font-mono text-[10px] text-blue-700">{detail.threatId}</p>
              {detail.description && <p className="mt-1.5 text-xs text-blue-300">{detail.description}</p>}
              {detail.vector && <p className="mt-1 text-[11px] text-blue-600">Vector: {detail.vector}</p>}
            </div>

            <div>
              <p className="mb-1.5 text-[10px] uppercase tracking-wider text-blue-700">State</p>
              <div className="flex flex-wrap gap-1.5">
                {TRIAGE_STATES.map((st) => (
                  <button
                    key={st}
                    disabled={busy || st === detail.state}
                    onClick={() => transition(detail.caseId, { state: st })}
                    className={`rounded px-2 py-1 text-xs capitalize transition-colors disabled:opacity-40 ${
                      st === detail.state
                        ? 'bg-blue-700/60 text-blue-100'
                        : 'bg-blue-950/40 text-blue-400 hover:bg-blue-900/40'
                    }`}
                  >
                    {st === 'resolved' && <ShieldCheck className="mr-1 inline h-3 w-3" />}
                    {st === 'dismissed' && <ShieldX className="mr-1 inline h-3 w-3" />}
                    {st}
                  </button>
                ))}
              </div>
            </div>

            <div>
              <p className="mb-1.5 text-[10px] uppercase tracking-wider text-blue-700">Assignee</p>
              <div className="flex gap-2">
                <input
                  value={assignee}
                  onChange={(e) => setAssignee(e.target.value)}
                  placeholder={detail.assignee || 'analyst handle…'}
                  className="flex-1 rounded border border-blue-900/40 bg-black/40 px-2 py-1 text-xs text-blue-100 focus:border-blue-500 focus:outline-none"
                  aria-label="Assignee"
                />
                <button
                  disabled={busy || !assignee.trim()}
                  onClick={() => { transition(detail.caseId, { assignee: assignee.trim() }); setAssignee(''); }}
                  className="inline-flex items-center gap-1 rounded bg-blue-700/50 px-2 py-1 text-xs text-blue-100 hover:bg-blue-700/70 disabled:opacity-40"
                >
                  <UserPlus className="h-3 w-3" /> Assign
                </button>
              </div>
            </div>

            <div>
              <p className="mb-1.5 text-[10px] uppercase tracking-wider text-blue-700">
                Notes ({detail.notes.length})
              </p>
              <div className="flex gap-2">
                <input
                  value={note}
                  onChange={(e) => setNote(e.target.value)}
                  placeholder="Add investigation note…"
                  className="flex-1 rounded border border-blue-900/40 bg-black/40 px-2 py-1 text-xs text-blue-100 focus:border-blue-500 focus:outline-none"
                  aria-label="Case note"
                />
                <button
                  disabled={busy || !note.trim()}
                  onClick={() => { transition(detail.caseId, { note: note.trim() }); setNote(''); }}
                  className="inline-flex items-center gap-1 rounded bg-blue-700/50 px-2 py-1 text-xs text-blue-100 hover:bg-blue-700/70 disabled:opacity-40"
                >
                  <StickyNote className="h-3 w-3" /> Note
                </button>
              </div>
              {detail.notes.length > 0 && (
                <ul className="mt-2 space-y-1">
                  {detail.notes.map((n) => (
                    <li key={n.id} className="rounded border border-blue-900/20 bg-black/30 px-2 py-1 text-[11px] text-blue-300">
                      <span className="text-blue-100">{n.text}</span>
                      <span className="ml-2 text-[9px] text-blue-700">{new Date(n.at).toLocaleString()}</span>
                    </li>
                  ))}
                </ul>
              )}
            </div>

            <div>
              <p className="mb-1.5 text-[10px] uppercase tracking-wider text-blue-700">
                Correlated intel ({detail.correlatedIntel.length})
              </p>
              <div className="flex gap-2">
                <input
                  value={intelDomain}
                  onChange={(e) => setIntelDomain(e.target.value)}
                  placeholder="domain"
                  className="w-28 rounded border border-blue-900/40 bg-black/40 px-2 py-1 text-xs text-blue-100 focus:border-blue-500 focus:outline-none"
                  aria-label="Intel domain"
                />
                <input
                  value={intelSummary}
                  onChange={(e) => setIntelSummary(e.target.value)}
                  placeholder="finding summary…"
                  className="flex-1 rounded border border-blue-900/40 bg-black/40 px-2 py-1 text-xs text-blue-100 focus:border-blue-500 focus:outline-none"
                  aria-label="Intel summary"
                />
                <button
                  disabled={busy || !intelDomain.trim() || !intelSummary.trim()}
                  onClick={correlate}
                  className="inline-flex items-center gap-1 rounded bg-blue-700/50 px-2 py-1 text-xs text-blue-100 hover:bg-blue-700/70 disabled:opacity-40"
                >
                  <Link2 className="h-3 w-3" /> Link
                </button>
              </div>
              {detail.correlatedIntel.length > 0 && (
                <ul className="mt-2 space-y-1">
                  {detail.correlatedIntel.map((l) => (
                    <li key={l.id} className="flex items-center gap-2 rounded border border-blue-900/20 bg-black/30 px-2 py-1 text-[11px]">
                      <span className="rounded bg-blue-900/40 px-1 py-0.5 text-[9px] text-blue-300">{l.intelDomain}</span>
                      <span className="flex-1 truncate text-blue-200">{l.summary}</span>
                      <span className="text-[9px] text-blue-600">{Math.round(l.relevance * 100)}%</span>
                      <button
                        onClick={() => uncorrelate(l.id)}
                        className="text-blue-700 hover:text-rose-400"
                        aria-label="Remove correlation"
                      >
                        <Unlink className="h-3 w-3" />
                      </button>
                    </li>
                  ))}
                </ul>
              )}
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
