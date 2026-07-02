'use client';

// concord-frontend/components/conkay/panels/ForwardSimPanel.tsx
//
// Unit F7 — the ConKay cockpit's Forward-Sim panel (K3). A self-contained,
// prop-free surface (panel-registry eligibility bar) that does TWO honest
// things and nothing more:
//
//   1. PROGRESS — a direct render of the REAL `stage` string the backend macro
//      emits while a solve is in flight (`macro:stage`, plumbed into
//      conkayHudStore). The engineering FEA solve emits exactly three genuine
//      sub-steps — "assembling" → "solving" → "postprocess" (see
//      server/lib/simulation/fea-solver.js#stage) — so for an `engineering.runFEA`
//      run we render a 3-step tracker whose highlighted step IS the current
//      `stage` value, verbatim. THERE IS NO TIMER — no interval, no scheduled
//      callback, no animated percentage: the tracker moves iff the backend
//      reports a new real sub-step, and freezes on whatever step reality last
//      reached. Motion ⟺ real work — the store's one rule, honoured.
//
//   2. PREVIEW — when a real FEA solve has completed with the cockpit open, its
//      solver output (reshaped into FEAResultViewer's prop shape by
//      conkayHudStore#feaResultFromRun, from real numbers only) is embedded as
//      the "forward simulation preview." Until such a run lands, `lastFea` is
//      null and we render an explicit, worded empty state — never a placeholder
//      structure or fabricated numbers.
//
// Why no "Reasoned — verify" verdict badge here: everything this panel shows is
// either the verbatim backend `stage` string (a fact, not a judgement) or the
// FEA solver's own directly-computed numbers (via FEAResultViewer). NONE of it
// is an LLM-judged / reason.verify claim, so there is no real verdict to badge —
// synthesising a VerdictBadge over computed engine output would fabricate a
// judgement that was never made. What DOES belong is an honest caveat about the
// NATURE of the numbers (a deterministic MODEL, not a certification of
// real-world behaviour), which is a plain factual note needing no verdict enum.
// This mirrors the ConKayViz TrustBadge doctrine ("never as proof of
// real-world/physics behaviour") without inventing a verdict string.

import { useConkayHudStore } from '../conkayHudStore';
import { FEAResultViewer } from '@/components/engineering/FEAResultViewer';

/** The macro whose stage stream this panel tracks (engineering FEA solve). */
const FEA_LABEL = 'engineering.runFEA';

/** The REAL, ordered sub-steps the FEA solver emits — verbatim keys from
 *  server/lib/simulation/fea-solver.js (`stage('assembling'|'solving'|'postprocess')`). */
const FEA_STAGES: { key: string; label: string }[] = [
  { key: 'assembling', label: 'Assembling' },
  { key: 'solving', label: 'Solving' },
  { key: 'postprocess', label: 'Post-processing' },
];

function StageTracker({ stage }: { stage: string | null }) {
  // Pure function of the real `stage`: the highlighted step is whichever one the
  // backend last reported reaching. Unknown/absent stage → nothing highlighted
  // yet (all pending), which is the honest state of a run that hasn't emitted a
  // sub-step. No index is advanced by anything but a real store update.
  const currentIdx = stage ? FEA_STAGES.findIndex((s) => s.key === stage) : -1;
  return (
    <div data-testid="fs-stage-tracker" className="flex items-stretch gap-1">
      {FEA_STAGES.map((s, i) => {
        const state = i < currentIdx ? 'done' : i === currentIdx ? 'active' : 'pending';
        const cls =
          state === 'active'
            ? 'border-cyan-400/60 bg-cyan-400/15 text-cyan-100'
            : state === 'done'
              ? 'border-emerald-400/30 bg-emerald-400/10 text-emerald-300/80'
              : 'border-white/10 bg-black/20 text-white/35';
        return (
          <div
            key={s.key}
            data-testid={`fs-stage-${s.key}`}
            data-state={state}
            className={`flex-1 rounded-lg border px-2 py-1 text-center text-[10px] uppercase tracking-wide ${cls}`}
          >
            {s.label}
          </div>
        );
      })}
    </div>
  );
}

export function ForwardSimPanel() {
  const stage = useConkayHudStore((s) => s.stage);
  const inFlight = useConkayHudStore((s) => s.inFlight);
  const activeLabel = useConkayHudStore((s) => s.activeLabel);
  const lastFea = useConkayHudStore((s) => s.lastFea);

  const running = inFlight > 0;
  const isFeaRun = activeLabel === FEA_LABEL;

  return (
    <div
      data-testid="ck-forward-sim-panel"
      className="mx-auto mt-2 max-w-2xl rounded-xl border border-cyan-400/15 bg-black/30 p-3"
    >
      <div className="px-1 pb-1 text-[10px] uppercase tracking-wide text-cyan-300/50">forward sim</div>

      {/* ── Progress: a DIRECT render of the real `stage` string ── */}
      <div className="mb-2">
        {running && isFeaRun ? (
          <>
            <StageTracker stage={stage} />
            <div className="mt-1 px-1 text-[10px] text-cyan-300/50">
              {stage ? (
                <>
                  current step:{' '}
                  <span data-testid="fs-current-stage" className="text-cyan-200/80">
                    {stage}
                  </span>
                </>
              ) : (
                <span data-testid="fs-current-stage">solve started — awaiting first sub-step…</span>
              )}
            </div>
          </>
        ) : running ? (
          // A non-FEA run is in flight — we still render its real stage verbatim
          // (honest), we just can't map it onto the FEA 3-step tracker.
          <div data-testid="fs-generic-progress" className="px-1 text-[11px] text-cyan-300/60">
            {activeLabel ?? 'backend'} running
            {stage ? (
              <>
                {' — '}
                <span data-testid="fs-current-stage" className="text-cyan-200/80">
                  {stage}
                </span>
              </>
            ) : (
              '…'
            )}
          </div>
        ) : (
          <div data-testid="fs-idle" className="px-1 py-1 text-[11px] text-white/40">
            No solve running. Run a structural FEA solve and its real stages
            (assembling → solving → post-processing) will track here.
          </div>
        )}
      </div>

      {/* ── Preview: the real completed solve, or an honest empty state ── */}
      {lastFea ? (
        <div data-testid="fs-preview">
          <div className="px-1 pb-1 text-[10px] uppercase tracking-wide text-cyan-300/50">
            forward-sim preview
          </div>
          <FEAResultViewer
            nodes={lastFea.nodes}
            members={lastFea.members}
            displacements={lastFea.displacements}
            height="300px"
          />
          {/* Honest note about the NATURE of the numbers — factual, not a
              reason.verify verdict, so no VerdictBadge (see file header). */}
          <div data-testid="fs-model-caveat" className="mt-2 px-1 text-[10px] text-amber-300/60">
            Deterministic FEA model — the solver&apos;s exact computed output, not
            a certification of real-world structural behaviour.
          </div>
        </div>
      ) : (
        <div data-testid="fs-no-result" className="px-1 py-1 text-[11px] text-white/40">
          No FEA result to display yet. Run a structural solve with the cockpit
          open and its computed forward-sim preview will render here.
        </div>
      )}
    </div>
  );
}

export default ForwardSimPanel;
