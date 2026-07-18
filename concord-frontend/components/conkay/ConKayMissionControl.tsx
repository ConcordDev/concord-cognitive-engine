'use client';

// concord-frontend/components/conkay/ConKayMissionControl.tsx
//
// Unit A4 — the ConKay cockpit's mission-control panel. A persistent, read-only
// surface that promotes a free-form multi-tool ConKay run into a legible ordered
// PLAN: each REAL tool call the agent loop made, rendered as a numbered step in
// execution order, with its receipt (result status + any reason.verify verdict
// badge) shown the moment it lands.
//
// Data source — `conkayRunStore` ONLY, nothing invented. That store's single
// writer is ConKayOverlay's `/api/chat-agent/stream` SSE reader (`chatWithBrain`),
// which pushes ONE step per real `tool_call` event (server/lib/chat-agent.js's
// executeToolCall receipts). Each `tool_call` is an after-the-fact receipt — the
// tool already ran server-side — so a step's status is REAL (`ok`), never a
// guessed spinner, and there are no fabricated "pending"/upcoming steps (the
// stream carries no forward-looking plan, so this panel never invents one).
//
// Prop-free + self-contained (the panel-registry eligibility bar): it reads the
// store directly and takes no props, so it can be cross-mounted anywhere.
//
// Honest motion: the only animated element is the header's "running" pulse while
// a run is actively streaming (`active`) — a plain CSS keyframe (`ck-ring`, the
// same live-indicator class ConKayWorkStatus / OrchestrationTracePanel use), not
// a timer. Row content changes ONLY when the store's real fields change. No
// interval/timeout-driven motion anywhere (enforced by scripts/check-conkay-honest-motion.mjs).

import { Check, X, Wrench, ShieldCheck } from 'lucide-react';
import { useConkayRunStore, type ConkayRunStep } from './conkayRunStore';

const VERDICT_BADGE: Record<string, string> = {
  proven: 'text-emerald-300 border-emerald-400/30 bg-emerald-400/10',
  grounded: 'text-emerald-300 border-emerald-400/30 bg-emerald-400/10',
  citations_resolve: 'text-emerald-300/80 border-emerald-400/20 bg-emerald-400/5',
  unsupported: 'text-amber-300 border-amber-400/30 bg-amber-400/10',
  refuted: 'text-rose-300 border-rose-400/30 bg-rose-400/10',
  fabricated_citation: 'text-rose-300 border-rose-500/50 bg-rose-500/15',
  unverified: 'text-cyan-300/70 border-cyan-400/20 bg-cyan-400/5',
};

function StepStatus({ ok }: { ok: boolean | null }) {
  if (ok === true) {
    return (
      <span
        data-testid="ck-mc-dot-done"
        className="grid h-4 w-4 shrink-0 place-items-center rounded-full bg-emerald-400/20 text-emerald-300"
      >
        <Check className="h-3 w-3" />
      </span>
    );
  }
  if (ok === false) {
    return (
      <span
        data-testid="ck-mc-dot-failed"
        className="grid h-4 w-4 shrink-0 place-items-center rounded-full bg-rose-400/20 text-rose-300"
      >
        <X className="h-3 w-3" />
      </span>
    );
  }
  // The event carried no `ok` — show a neutral marker rather than guess a status.
  return (
    <span
      data-testid="ck-mc-dot-unknown"
      className="grid h-4 w-4 shrink-0 place-items-center rounded-full bg-white/10 text-white/50"
    >
      <Wrench className="h-2.5 w-2.5" />
    </span>
  );
}

function VerifyBadge({ verify }: { verify: NonNullable<ConkayRunStep['verify']> }) {
  const cls = VERDICT_BADGE[verify.verdict] ?? 'text-white/70 border-white/20 bg-white/5';
  return (
    <div
      data-testid="ck-mc-verdict"
      data-verdict={verify.verdict}
      className={`mt-1 inline-flex items-center gap-1.5 rounded-md border px-1.5 py-0.5 text-[10px] font-medium ${cls}`}
    >
      <ShieldCheck className="h-3 w-3" />
      <span>{verify.verdict.replace(/_/g, ' ')}</span>
      {verify.mode && <span className="opacity-60">{verify.mode}</span>}
      {typeof verify.confidence === 'number' && (
        <span className="opacity-60">{Math.round(verify.confidence * 100)}%</span>
      )}
    </div>
  );
}

function StepRow({ step, index }: { step: ConkayRunStep; index: number }) {
  // The tool call's headline: a run_lens_action reads as its real domain.action;
  // any other tool reads as its own tool name.
  const headline =
    step.domain && step.action ? `${step.domain}.${step.action}` : step.tool;
  const showToolTag = Boolean(step.domain && step.action); // only when headline isn't the tool name itself

  return (
    <li
      data-testid={`ck-mc-row-${index}`}
      data-status={step.ok === true ? 'done' : step.ok === false ? 'failed' : 'unknown'}
      className="flex items-start gap-2.5 text-[12px]"
    >
      <span className="mt-0.5 w-4 shrink-0 text-right text-[10px] tabular-nums text-cyan-300/40">
        {step.seq}
      </span>
      <StepStatus ok={step.ok} />
      <div className="min-w-0 flex-1">
        <div className="flex items-center gap-1.5">
          <span
            className={
              step.ok === false ? 'truncate text-rose-200' : 'truncate text-cyan-100'
            }
          >
            {headline}
          </span>
          {showToolTag && (
            <span className="shrink-0 rounded border border-cyan-400/20 bg-cyan-400/5 px-1 text-[9px] text-cyan-300/50">
              {step.tool}
            </span>
          )}
        </div>
        {step.inputSummary && (
          <div className="truncate text-[10px] text-cyan-300/40">{step.inputSummary}</div>
        )}
        {step.error && (
          <div className="truncate text-[10px] text-rose-300/70">{step.error}</div>
        )}
        {step.verify && <VerifyBadge verify={step.verify} />}
      </div>
    </li>
  );
}

export function ConKayMissionControl() {
  const steps = useConkayRunStore((s) => s.steps);
  const active = useConkayRunStore((s) => s.active);
  const finalError = useConkayRunStore((s) => s.finalError);

  return (
    <div
      data-testid="ck-mission-control-panel"
      className="mx-auto mt-2 max-w-2xl rounded-xl border border-cyan-400/15 bg-black/30 p-3"
    >
      <div className="flex items-center justify-between px-1 pb-1">
        <span className="text-[10px] uppercase tracking-wide text-cyan-300/50">mission control</span>
        {active && (
          <span
            data-testid="ck-mc-running"
            className="flex items-center gap-1.5 text-[10px] text-cyan-200/80"
          >
            <span className="ck-ring block h-2.5 w-2.5 rounded-full border border-cyan-400/40 border-t-cyan-300" />
            running
          </span>
        )}
      </div>

      {steps.length === 0 ? (
        <div data-testid="ck-mc-empty" className="px-1 py-2 text-[11px] text-white/40">
          {active
            ? 'Running — no tool calls yet. Each real tool ConKay invokes will appear here in order.'
            : 'No tool calls yet. Ask ConKay to do something and each real backend tool call will appear here as an ordered plan.'}
        </div>
      ) : (
        <ol className="mt-1 space-y-2 border-l border-cyan-400/10 pl-3">
          {steps.map((step, i) => (
            <StepRow key={`${step.seq}-${step.tool}`} step={step} index={i} />
          ))}
        </ol>
      )}

      {finalError && (
        <div data-testid="ck-mc-error" className="mt-2 px-1 text-[10px] text-rose-300/70">
          Run ended with an error: {finalError}
        </div>
      )}
    </div>
  );
}

export default ConKayMissionControl;
