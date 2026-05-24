'use client';

import { useState } from 'react';
import {
  ShieldAlert, Eye, UserCheck, Search, CheckCircle2, XCircle, Lock, Unlock, X,
} from 'lucide-react';
import { lensRun } from '@/lib/api/client';
import type { PsyopsAlert, AlertCounts, AlertDetail } from './types';
import { SIGNAL_LABELS } from './types';

const SEVERITY_STYLE: Record<string, string> = {
  critical: 'border-rose-600 bg-rose-950/40',
  high: 'border-amber-600/60 bg-amber-950/30',
  medium: 'border-zinc-700 bg-zinc-900/40',
};

const SEVERITY_BADGE: Record<string, string> = {
  critical: 'bg-rose-600 text-white',
  high: 'bg-amber-600 text-white',
  medium: 'bg-zinc-700 text-zinc-200',
};

const STATUS_BADGE: Record<string, string> = {
  open: 'bg-rose-900/60 text-rose-200',
  assigned: 'bg-indigo-900/60 text-indigo-200',
  investigating: 'bg-amber-900/60 text-amber-200',
  resolved: 'bg-emerald-900/60 text-emerald-200',
  dismissed: 'bg-zinc-800 text-zinc-400',
};

function ts(ms: number): string {
  return new Date(ms).toLocaleString();
}

export function AlertBoard({
  alerts,
  counts,
  selectedIds,
  onToggleSelect,
  onChange,
}: {
  alerts: PsyopsAlert[];
  counts: AlertCounts | null;
  selectedIds: string[];
  onToggleSelect: (id: string) => void;
  onChange: () => void;
}) {
  const [detail, setDetail] = useState<AlertDetail | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [note, setNote] = useState('');
  const [releaseReason, setReleaseReason] = useState('');

  const triage = async (alertId: string, action: string) => {
    setBusy(alertId);
    const r = await lensRun('psyops', 'alert_triage', { alertId, action, note: note.trim() });
    setBusy(null);
    if (r.data?.ok) {
      setNote('');
      onChange();
      if (detail?.alert.id === alertId) void openDetail(alertId);
    }
  };

  const openDetail = async (alertId: string) => {
    const r = await lensRun<AlertDetail>('psyops', 'alert_detail', { alertId });
    if (r.data?.ok && r.data.result) setDetail(r.data.result);
  };

  const quarantine = async (alertId: string, reason: string) => {
    setBusy(alertId);
    const r = await lensRun('psyops', 'quarantine_entity', { alertId, reason });
    setBusy(null);
    if (r.data?.ok) {
      onChange();
      if (detail?.alert.id === alertId) void openDetail(alertId);
    }
  };

  const release = async (alertId: string) => {
    if (!releaseReason.trim()) return;
    setBusy(alertId);
    const r = await lensRun('psyops', 'quarantine_release', { alertId, reason: releaseReason.trim() });
    setBusy(null);
    if (r.data?.ok) {
      setReleaseReason('');
      onChange();
      if (detail?.alert.id === alertId) void openDetail(alertId);
    }
  };

  return (
    <div className="space-y-3">
      <div className="flex items-center justify-between gap-2">
        <h2 className="flex items-center gap-2 text-sm font-semibold text-zinc-100">
          <ShieldAlert className="h-4 w-4 text-rose-400" /> Alert board
        </h2>
        {counts && (
          <div className="flex flex-wrap gap-1.5 text-[10px]">
            <span className="rounded bg-rose-900/60 px-1.5 py-0.5 text-rose-200">{counts.open} open</span>
            <span className="rounded bg-amber-900/60 px-1.5 py-0.5 text-amber-200">{counts.investigating} investigating</span>
            <span className="rounded bg-emerald-900/60 px-1.5 py-0.5 text-emerald-200">{counts.resolved} resolved</span>
            <span className="rounded bg-rose-600 px-1.5 py-0.5 text-white">{counts.critical} critical</span>
          </div>
        )}
      </div>

      {alerts.length === 0 ? (
        <p className="rounded-lg border border-zinc-800 bg-zinc-950/40 py-6 text-center text-xs italic text-zinc-400">
          No alerts. Run a multi-signal scan above to generate anomalies.
        </p>
      ) : (
        <ul className="space-y-2">
          {alerts.map((a) => (
            <li key={a.id} className={`rounded-lg border p-3 ${SEVERITY_STYLE[a.severity]} ${a.quarantined ? 'opacity-70' : ''}`}>
              <div className="flex items-start gap-2">
                <input
                  type="checkbox"
                  checked={selectedIds.includes(a.id)}
                  onChange={() => onToggleSelect(a.id)}
                  className="mt-1 accent-rose-500"
                  aria-label="select alert for incident"
                />
                <div className="min-w-0 flex-1">
                  <div className="flex flex-wrap items-center gap-1.5">
                    <span className={`rounded px-1.5 py-0.5 text-[9px] font-bold uppercase ${SEVERITY_BADGE[a.severity]}`}>{a.severity}</span>
                    <span className={`rounded px-1.5 py-0.5 text-[9px] uppercase ${STATUS_BADGE[a.status]}`}>{a.status}</span>
                    <span className="rounded bg-zinc-800 px-1.5 py-0.5 text-[9px] uppercase text-zinc-400">{SIGNAL_LABELS[a.signal] || a.signal}</span>
                    {a.quarantined && (
                      <span className="flex items-center gap-0.5 rounded bg-rose-800 px-1.5 py-0.5 text-[9px] uppercase text-white">
                        <Lock className="h-2.5 w-2.5" /> quarantined
                      </span>
                    )}
                    {a.incidentId && <span className="rounded bg-indigo-900/60 px-1.5 py-0.5 text-[9px] text-indigo-200">in incident</span>}
                  </div>
                  <p className="mt-1 truncate text-sm font-semibold text-zinc-100">{a.entityId}</p>
                  <p className="font-mono text-[10px] text-zinc-400">
                    value {a.value} · {a.sigmaAbove}σ above {a.cohortMean} baseline (σ {a.cohortStddev}) ·{' '}
                    {a.evidence.percentile}th pct
                  </p>
                  <p className="font-mono text-[10px] text-zinc-400">{ts(a.detectedAt)}{a.assignee ? ` · ${a.assignee}` : ''}</p>
                </div>
                <button
                  type="button"
                  onClick={() => void openDetail(a.id)}
                  className="flex shrink-0 items-center gap-1 rounded border border-zinc-700 bg-zinc-900 px-2 py-1 text-[10px] text-zinc-300 hover:border-zinc-600"
                >
                  <Eye className="h-3 w-3" /> Detail
                </button>
              </div>

              <div className="mt-2 flex flex-wrap gap-1.5">
                <button type="button" disabled={busy === a.id} onClick={() => void triage(a.id, 'assign')}
                  className="flex items-center gap-1 rounded bg-indigo-800 px-2 py-1 text-[10px] text-white hover:bg-indigo-700 disabled:opacity-50">
                  <UserCheck className="h-3 w-3" /> Assign me
                </button>
                <button type="button" disabled={busy === a.id} onClick={() => void triage(a.id, 'investigate')}
                  className="flex items-center gap-1 rounded bg-amber-800 px-2 py-1 text-[10px] text-white hover:bg-amber-700 disabled:opacity-50">
                  <Search className="h-3 w-3" /> Investigate
                </button>
                <button type="button" disabled={busy === a.id} onClick={() => void triage(a.id, 'resolve')}
                  className="flex items-center gap-1 rounded bg-emerald-800 px-2 py-1 text-[10px] text-white hover:bg-emerald-700 disabled:opacity-50">
                  <CheckCircle2 className="h-3 w-3" /> Resolve
                </button>
                <button type="button" disabled={busy === a.id} onClick={() => void triage(a.id, 'dismiss')}
                  className="flex items-center gap-1 rounded bg-zinc-800 px-2 py-1 text-[10px] text-zinc-300 hover:bg-zinc-700 disabled:opacity-50">
                  <XCircle className="h-3 w-3" /> Dismiss
                </button>
                {!a.quarantined ? (
                  <button type="button" disabled={busy === a.id} onClick={() => void quarantine(a.id, 'operator action from alert board')}
                    className="flex items-center gap-1 rounded bg-rose-800 px-2 py-1 text-[10px] text-white hover:bg-rose-700 disabled:opacity-50">
                    <Lock className="h-3 w-3" /> Quarantine
                  </button>
                ) : null}
              </div>
            </li>
          ))}
        </ul>
      )}

      <label className="block text-[11px] text-zinc-400">
        Triage note (attached to the next triage action)
        <input
          type="text"
          value={note}
          onChange={(e) => setNote(e.target.value)}
          placeholder="optional — recorded against the alert"
          className="mt-0.5 w-full rounded border border-zinc-700 bg-zinc-900 px-2 py-1 text-xs text-zinc-100 focus:border-rose-500 focus:outline-none"
        />
      </label>

      {detail && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 p-4" role="dialog" aria-modal="true">
          <div className="max-h-[85vh] w-full max-w-lg overflow-y-auto rounded-xl border border-zinc-700 bg-zinc-950 p-4">
            <div className="flex items-start justify-between">
              <h3 className="flex items-center gap-2 text-sm font-semibold text-zinc-100">
                <Eye className="h-4 w-4 text-rose-400" /> Alert evidence drill-down
              </h3>
              <button type="button" onClick={() => setDetail(null)} className="rounded p-1 text-zinc-400 hover:text-zinc-200" aria-label="close">
                <X className="h-4 w-4" />
              </button>
            </div>

            <div className="mt-3 space-y-1 rounded-lg border border-zinc-800 bg-zinc-900/50 p-3 text-xs">
              <p className="text-sm font-semibold text-zinc-100">{detail.alert.entityId}</p>
              <p className="font-mono text-[10px] text-zinc-400">{SIGNAL_LABELS[detail.alert.signal] || detail.alert.signal} · {detail.alert.severity} · {detail.alert.status}</p>
              <dl className="mt-2 grid grid-cols-2 gap-x-3 gap-y-1 font-mono text-[10px] text-zinc-300">
                <dt className="text-zinc-400">Observed value</dt><dd>{detail.alert.value}</dd>
                <dt className="text-zinc-400">Cohort mean</dt><dd>{detail.alert.cohortMean}</dd>
                <dt className="text-zinc-400">Cohort σ</dt><dd>{detail.alert.cohortStddev}</dd>
                <dt className="text-zinc-400">σ above</dt><dd className="text-rose-300">{detail.alert.sigmaAbove}</dd>
                <dt className="text-zinc-400">Percentile</dt><dd>{detail.alert.evidence.percentile}th</dd>
                <dt className="text-zinc-400">Cohort size</dt><dd>{detail.alert.evidence.cohortSize}</dd>
                <dt className="text-zinc-400">Rule σ</dt><dd>{detail.alert.evidence.ruleSigma}</dd>
                <dt className="text-zinc-400">Critical σ</dt><dd>{detail.alert.evidence.criticalSigma}</dd>
              </dl>
            </div>

            {detail.alert.notes.length > 0 && (
              <div className="mt-3">
                <p className="text-[11px] font-semibold text-zinc-300">Triage log</p>
                <ul className="mt-1 space-y-1">
                  {detail.alert.notes.map((n, i) => (
                    <li key={i} className="rounded border border-zinc-800 bg-zinc-900/40 px-2 py-1 text-[10px] text-zinc-400">
                      <span className="text-zinc-300">{n.action}</span> — {n.text}
                      <span className="ml-1 text-zinc-600">· {ts(n.at)} · {n.by}</span>
                    </li>
                  ))}
                </ul>
              </div>
            )}

            {detail.incident && (
              <p className="mt-3 rounded border border-indigo-800/50 bg-indigo-950/40 px-2 py-1.5 text-[10px] text-indigo-200">
                Correlated into incident: <span className="font-semibold">{detail.incident.title}</span> ({detail.incident.status})
              </p>
            )}

            {detail.related.length > 0 && (
              <div className="mt-3">
                <p className="text-[11px] font-semibold text-zinc-300">Related alerts ({detail.related.length})</p>
                <ul className="mt-1 space-y-1">
                  {detail.related.map((r) => (
                    <li key={r.id} className="rounded border border-zinc-800 bg-zinc-900/40 px-2 py-1 text-[10px] text-zinc-400">
                      {r.entityId} · {SIGNAL_LABELS[r.signal] || r.signal} · {r.sigmaAbove}σ
                    </li>
                  ))}
                </ul>
              </div>
            )}

            {detail.alert.quarantined && (
              <div className="mt-3 space-y-1.5 rounded-lg border border-rose-800/50 bg-rose-950/30 p-3">
                <p className="text-[11px] font-semibold text-rose-200">Quarantine review</p>
                <p className="text-[10px] text-zinc-400">A release is audited — a reason is mandatory.</p>
                <input
                  type="text"
                  value={releaseReason}
                  onChange={(e) => setReleaseReason(e.target.value)}
                  placeholder="release reason (required, logged)"
                  className="w-full rounded border border-zinc-700 bg-zinc-900 px-2 py-1 text-xs text-zinc-100 focus:border-rose-500 focus:outline-none"
                />
                <button
                  type="button"
                  disabled={busy === detail.alert.id || !releaseReason.trim()}
                  onClick={() => void release(detail.alert.id)}
                  className="flex items-center gap-1 rounded bg-emerald-800 px-2 py-1 text-[10px] text-white hover:bg-emerald-700 disabled:opacity-40"
                >
                  <Unlock className="h-3 w-3" /> Release from quarantine
                </button>
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
