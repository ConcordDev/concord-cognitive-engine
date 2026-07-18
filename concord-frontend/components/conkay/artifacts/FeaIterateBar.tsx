'use client';

// components/conkay/artifacts/FeaIterateBar.tsx
//
// Phase S3-c — the "Iterate" affordance on an FEA frame: say a structural
// change, review the intent, re-run the REAL solver, watch the frame recolor.
//
// Unlike the building bar (S3-b), the outcome here is solver-authoritative: the
// confirm gate states the INTENT ("thicken all members 60%"), not a predicted
// result — because the new utilization is only knowable by actually running
// engineering.runFEA. While it runs, an honest "Solving…" state (the solver is
// genuinely working); on failure, the solver's real error, verbatim. No timers,
// no fake progress — the await IS the wait (honest-hologram gate stays green).

import { useState } from 'react';
import {
  proposeFeaIteration,
  feaModelFromInput,
  type FeaModel,
  type FeaProposal,
  type FeaRejection,
} from '@/lib/conkay/fea-iterate';

export function FeaIterateBar({
  sourceInput,
  dirty,
  onResolve,
  onRevert,
}: {
  /** The FEA artifact's macro input (its sourceInput), carrying the real model. */
  sourceInput: Record<string, unknown> | undefined;
  dirty: boolean;
  /** Re-run the real solver with the transformed model; resolves ok/err. */
  onResolve: (newInput: { model: FeaModel }) => Promise<{ ok: boolean; error?: string }>;
  onRevert: () => void;
}) {
  const [text, setText] = useState('');
  const [outcome, setOutcome] = useState<FeaProposal | FeaRejection | null>(null);
  const [solving, setSolving] = useState(false);
  const [resolveError, setResolveError] = useState<string | null>(null);

  // No editable model ⟹ no re-solve affordance (honest: nothing to run).
  if (!feaModelFromInput(sourceInput)) return null;

  const submit = () => {
    const t = text.trim();
    if (!t || solving) return;
    setResolveError(null);
    setOutcome(proposeFeaIteration(sourceInput, t));
  };

  const resolve = async () => {
    if (!outcome?.ok || solving) return;
    setSolving(true);
    setResolveError(null);
    const r = await onResolve(outcome.newInput);
    setSolving(false);
    if (r.ok) {
      setText('');
      setOutcome(null);
    } else {
      setResolveError(r.error ?? 'The solver returned no result.');
    }
  };

  return (
    <div data-testid="ck-fea-iterate" className="mt-2 rounded-lg border border-cyan-400/20 bg-black/40 p-2">
      <div className="flex items-center gap-2">
        <input
          data-testid="ck-fea-iterate-input"
          value={text}
          onChange={(e) => {
            setText(e.target.value);
            if (outcome) setOutcome(null);
          }}
          onKeyDown={(e) => {
            if (e.key === 'Enter') {
              e.preventDefault();
              submit();
            }
          }}
          disabled={solving}
          placeholder="Re-solve… “make the members thicker”, “reduce the load 30%”, “double the load”"
          className="min-w-0 flex-1 rounded-md border border-white/10 bg-black/50 px-2 py-1 text-[12px] text-cyan-100 placeholder:text-cyan-300/30 focus:border-cyan-400/40 focus:outline-none disabled:opacity-50"
        />
        <button
          type="button"
          data-testid="ck-fea-iterate-submit"
          onClick={submit}
          disabled={solving}
          className="rounded-md border border-cyan-400/30 bg-cyan-500/10 px-2 py-1 text-[11px] font-medium text-cyan-200 hover:border-cyan-300/60 disabled:opacity-50"
        >
          Iterate
        </button>
        {dirty && !solving && (
          <button
            type="button"
            data-testid="ck-fea-iterate-revert"
            onClick={onRevert}
            className="rounded-md border border-white/10 px-2 py-1 text-[11px] text-white/50 hover:text-white/80"
          >
            Revert
          </button>
        )}
      </div>

      {dirty && (
        <div data-testid="ck-fea-iterate-dirty" className="mt-1 text-[10px] text-amber-300/70">
          re-solved from an edit · not the original analysis
        </div>
      )}

      {/* Honest rejection — worded, runs nothing. */}
      {outcome && !outcome.ok && (
        <div data-testid="ck-fea-iterate-reject" className="mt-2 text-[11px] text-rose-300/80">
          {outcome.message}
        </div>
      )}

      {/* Solver error, verbatim. */}
      {resolveError && (
        <div data-testid="ck-fea-iterate-error" className="mt-2 text-[11px] text-rose-300/80">
          Solver: {resolveError}
        </div>
      )}

      {/* Confirm gate — states the INTENT; the solver decides the result. */}
      {outcome?.ok && (
        <div data-testid="ck-fea-iterate-confirm" className="mt-2 rounded-md border border-cyan-400/20 bg-black/40 p-2">
          <div className="text-[11px] text-cyan-200">
            Re-run the solver: <span className="font-medium">{outcome.summary}</span>?
          </div>
          <div className="mt-2 flex items-center gap-2">
            <button
              type="button"
              data-testid="ck-fea-iterate-resolve"
              onClick={resolve}
              disabled={solving}
              className="rounded-md border border-emerald-400/40 bg-emerald-500/10 px-2 py-1 text-[11px] font-medium text-emerald-200 hover:border-emerald-300/70 disabled:opacity-50"
            >
              {solving ? 'Solving…' : 'Re-solve'}
            </button>
            {!solving && (
              <button
                type="button"
                data-testid="ck-fea-iterate-cancel"
                onClick={() => setOutcome(null)}
                className="rounded-md border border-white/10 px-2 py-1 text-[11px] text-white/60 hover:text-white/90"
              >
                Cancel
              </button>
            )}
          </div>
        </div>
      )}
    </div>
  );
}

export default FeaIterateBar;
