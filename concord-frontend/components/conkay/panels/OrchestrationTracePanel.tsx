'use client';

// concord-frontend/components/conkay/panels/OrchestrationTracePanel.tsx
//
// Unit A4 — the ConKay cockpit's mission-control orchestration-trace panel
// (docs/NEXT_ARC_PLAN.md Wave 1). A self-contained, prop-free surface (the
// panel-registry eligibility bar) that renders the ordered sequence of REAL
// backend tool calls the current session has made, as a legible taskboard —
// the "mission-control plan + receipts" pattern.
//
// Data source — `conkayHudStore` ONLY, nothing invented:
//   - `telemetry` (newest-first, capped at TELEMETRY_CAP) is the ordered
//     history of completed `macro:started`/`macro:completed` backend events —
//     every `/api/lens/run` call (client-initiated OR the server agent loop's
//     tool calls) emits this pair to the user's room (server.js, the
//     `emitMacroLife` call sites around the dispatcher). We reverse it to
//     chronological order (oldest -> newest) so the panel reads top-to-bottom
//     like a plan, not a feed.
//   - `inFlight` + `activeLabel` + `stage` describe the ONE call currently
//     running (if any) — appended as the final row with status "running" and
//     its real sub-step (`stage`) shown verbatim when the backend has reported
//     one.
//   - `lastVerify` + `runDtuRefs` are the real `reason.verify` verdict/DTU
//     refs (F2's single narrow exception — see conkayHudStore.ts header).
//     They describe exactly ONE call (the most recent `reason.verify`), so we
//     attach them as a "receipt" ONLY to the most recent telemetry row whose
//     domain+action is literally `reason.verify` — never to any other row,
//     and never duplicated across older `reason.verify` rows the store no
//     longer has a verdict for.
//
// What we deliberately do NOT render: a "pending" status. The store carries
// no forward-looking plan/manifest of steps that haven't started yet — only
// facts about what already started, completed, or is in flight. Inventing
// upcoming steps would be fabrication, so the taskboard only ever shows rows
// for calls the backend has genuinely reported. An idle store (nothing ever
// ran, nothing running) renders an explicit "No active run" empty state —
// never a placeholder skeleton row.
//
// No interval/timeout-driven animation anywhere in this file — the running
// row's motion is a plain CSS keyframe class (`ck-ring`, already used by
// ConKayWorkStatus for the identical "this step is live" affordance), not a
// scheduled callback. The row's *content* only changes when the store's real
// fields change.

import { Check, X } from 'lucide-react';
import { useConkayHudStore, type ConkayDtuRef, type ConkayVerifyVerdict } from '../conkayHudStore';

export type TraceRowStatus = 'done' | 'failed' | 'running';

export interface TraceReceipt {
  verdict: string;
  mode: string | null;
  confidence: number | null;
  dtuRefs: ConkayDtuRef[];
}

export interface TraceRow {
  key: string;
  domain: string;
  action: string;
  status: TraceRowStatus;
  /** Real elapsed ms the backend reported, or null (running rows / unreported). */
  ms: number | null;
  /** Real sub-step string for the running row, or null. */
  stage: string | null;
  receipt: TraceReceipt | null;
}

interface TraceState {
  telemetry: { domain: string; action: string; ok: boolean; ms: number | null }[];
  inFlight: number;
  activeLabel: string | null;
  stage: string | null;
  lastVerify: ConkayVerifyVerdict | null;
  runDtuRefs: ConkayDtuRef[];
}

/** Split a `domain.action` label on the FIRST dot — mirrors MacroLibraryPanel's
 *  convention (domain names never contain dots; an action theoretically could). */
function splitLabel(label: string): { domain: string; action: string } {
  const idx = label.indexOf('.');
  if (idx === -1) return { domain: label, action: '' };
  return { domain: label.slice(0, idx), action: label.slice(idx + 1) };
}

/** Pure builder: real store fields in, ordered rows out. Exported for direct
 *  unit pinning alongside the render test. Never fabricates a row — an entry
 *  only exists here because the store recorded a real started/completed/
 *  in-flight fact. */
export function buildTraceRows(state: TraceState): TraceRow[] {
  const chronological = [...state.telemetry].reverse();
  const rows: TraceRow[] = chronological.map((t, i) => ({
    key: `t-${i}-${t.domain}.${t.action}`,
    domain: t.domain,
    action: t.action,
    status: t.ok ? 'done' : 'failed',
    ms: t.ms,
    stage: null,
    receipt: null,
  }));

  // Attach the verify receipt to the MOST RECENT reason.verify row only — the
  // store retains exactly one verdict (the latest), so attaching it anywhere
  // else would misrepresent which call it actually belongs to.
  if (state.lastVerify) {
    for (let i = rows.length - 1; i >= 0; i -= 1) {
      if (rows[i].domain === 'reason' && rows[i].action === 'verify') {
        rows[i] = {
          ...rows[i],
          receipt: {
            verdict: state.lastVerify.verdict,
            mode: state.lastVerify.mode,
            confidence: state.lastVerify.confidence,
            dtuRefs: state.runDtuRefs,
          },
        };
        break;
      }
    }
  }

  if (state.inFlight > 0 && state.activeLabel) {
    const { domain, action } = splitLabel(state.activeLabel);
    rows.push({
      key: `running-${state.activeLabel}`,
      domain,
      action,
      status: 'running',
      ms: null,
      stage: state.stage,
      receipt: null,
    });
  }

  return rows;
}

const VERDICT_BADGE: Record<string, string> = {
  proven: 'text-emerald-300 border-emerald-400/30 bg-emerald-400/10',
  grounded: 'text-emerald-300 border-emerald-400/30 bg-emerald-400/10',
  citations_resolve: 'text-emerald-300/80 border-emerald-400/20 bg-emerald-400/5',
  unsupported: 'text-amber-300 border-amber-400/30 bg-amber-400/10',
  refuted: 'text-rose-300 border-rose-400/30 bg-rose-400/10',
  fabricated_citation: 'text-rose-300 border-rose-500/50 bg-rose-500/15',
  unverified: 'text-cyan-300/70 border-cyan-400/20 bg-cyan-400/5',
};

function StatusDot({ status }: { status: TraceRowStatus }) {
  if (status === 'done') {
    return (
      <span
        data-testid="ck-trace-dot-done"
        className="grid h-4 w-4 shrink-0 place-items-center rounded-full bg-emerald-400/20 text-emerald-300"
      >
        <Check className="h-3 w-3" />
      </span>
    );
  }
  if (status === 'failed') {
    return (
      <span
        data-testid="ck-trace-dot-failed"
        className="grid h-4 w-4 shrink-0 place-items-center rounded-full bg-rose-400/20 text-rose-300"
      >
        <X className="h-3 w-3" />
      </span>
    );
  }
  // running — the ONLY motion here is the pre-existing `ck-ring` CSS keyframe
  // (a live indicator, no timer/interval driving it).
  return (
    <span
      data-testid="ck-trace-dot-running"
      className="ck-ring block h-4 w-4 shrink-0 rounded-full border border-cyan-400/40 border-t-cyan-300"
    />
  );
}

function ReceiptBadge({ receipt }: { receipt: TraceReceipt }) {
  const cls = VERDICT_BADGE[receipt.verdict] ?? 'text-white/70 border-white/20 bg-white/5';
  return (
    <div
      data-testid="ck-trace-receipt"
      data-verdict={receipt.verdict}
      className={`mt-1 inline-flex items-center gap-1.5 rounded-md border px-1.5 py-0.5 text-[10px] font-medium ${cls}`}
    >
      <span>{receipt.verdict.replace(/_/g, ' ')}</span>
      {typeof receipt.confidence === 'number' && (
        <span className="opacity-60">{Math.round(receipt.confidence * 100)}%</span>
      )}
      {receipt.dtuRefs.length > 0 && (
        <span className="opacity-60">
          {receipt.dtuRefs.length} DTU ref{receipt.dtuRefs.length === 1 ? '' : 's'}
        </span>
      )}
    </div>
  );
}

function TraceRowView({ row, index }: { row: TraceRow; index: number }) {
  const label = row.action ? `${row.domain}.${row.action}` : row.domain;
  const detailBits: string[] = [];
  if (row.status === 'running' && row.stage) detailBits.push(row.stage.replace(/_/g, ' '));
  if (row.status !== 'running' && typeof row.ms === 'number') detailBits.push(`${row.ms} ms`);

  return (
    <li
      data-testid={`ck-trace-row-${index}`}
      data-status={row.status}
      className="flex items-start gap-2.5 text-[12px]"
    >
      <StatusDot status={row.status} />
      <div className="min-w-0 flex-1">
        <div
          className={
            row.status === 'done'
              ? 'truncate text-cyan-100/70'
              : row.status === 'failed'
                ? 'truncate text-rose-200'
                : 'truncate text-cyan-100'
          }
        >
          {label}
        </div>
        {detailBits.length > 0 && (
          <div className="text-[10px] text-cyan-300/40">{detailBits.join(' — ')}</div>
        )}
        {row.receipt && <ReceiptBadge receipt={row.receipt} />}
      </div>
    </li>
  );
}

export function OrchestrationTracePanel() {
  const telemetry = useConkayHudStore((s) => s.telemetry);
  const inFlight = useConkayHudStore((s) => s.inFlight);
  const activeLabel = useConkayHudStore((s) => s.activeLabel);
  const stage = useConkayHudStore((s) => s.stage);
  const lastVerify = useConkayHudStore((s) => s.lastVerify);
  const runDtuRefs = useConkayHudStore((s) => s.runDtuRefs);

  const rows = buildTraceRows({ telemetry, inFlight, activeLabel, stage, lastVerify, runDtuRefs });

  return (
    <div
      data-testid="ck-orchestration-trace-panel"
      className="mx-auto mt-2 max-w-2xl rounded-xl border border-cyan-400/15 bg-black/30 p-3"
    >
      <div className="px-1 pb-1 text-[10px] uppercase tracking-wide text-cyan-300/50">orchestration trace</div>

      {rows.length === 0 ? (
        <div data-testid="ck-trace-empty" className="px-1 py-2 text-[11px] text-white/40">
          No active run. Run a macro or ask ConKay to do something, and each real
          backend step will appear here in order as it starts and completes.
        </div>
      ) : (
        <ol className="mt-1 space-y-2 border-l border-cyan-400/10 pl-3">
          {rows.map((row, i) => (
            <TraceRowView key={row.key} row={row} index={i} />
          ))}
        </ol>
      )}
    </div>
  );
}

export default OrchestrationTracePanel;
