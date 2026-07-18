'use client';

// components/conkay/artifacts/BuildingIterateBar.tsx
//
// Phase S3-b — the "Iterate" affordance on a building artifact: say how to
// change it, review the exact before→after, apply, watch it rebuild. The whole
// bar is a thin shell over the pure spine in lib/conkay/iterate-building.ts —
// no timers, no fake progress (honest-hologram gate stays green): the building
// re-renders because a real new input was applied, nothing else moves on a clock.
//
// Honesty surfaces first: an utterance with no size change, an artifact with no
// dimensions, or a delta that clamps to a no-op each show a worded reason and
// change NOTHING (invariant #4). A parsed change opens an explicit confirm gate
// (the exact metres, before→after) — the artifact only changes on Apply.

import { useState } from 'react';
import {
  proposeBuildingIteration,
  type IterationProposal,
  type IterationRejection,
} from '@/lib/conkay/iterate-building';
import { dimensionsFromInput } from '@/lib/conkay/delta-intent';

export function BuildingIterateBar({
  sourceInput,
  dirty,
  onApply,
  onRevert,
}: {
  /** The current building's macro input (working artifact's sourceInput). */
  sourceInput: Record<string, unknown>;
  /** Whether the building has unsaved iterate edits. */
  dirty: boolean;
  /** Apply an accepted iteration's new input (re-derives + re-renders). */
  onApply: (newInput: Record<string, unknown>) => void;
  /** Discard all iterate edits, back to the originally-published building. */
  onRevert: () => void;
}) {
  const [text, setText] = useState('');
  const [outcome, setOutcome] = useState<IterationProposal | IterationRejection | null>(null);

  // No editable dimensions ⟹ no iterate affordance (honest: nothing to change).
  if (!dimensionsFromInput(sourceInput)) return null;

  const submit = () => {
    const t = text.trim();
    if (!t) return;
    setOutcome(proposeBuildingIteration(sourceInput, t));
  };

  const apply = () => {
    if (outcome?.ok) {
      onApply(outcome.newInput);
      setText('');
      setOutcome(null);
    }
  };

  return (
    <div data-testid="ck-building-iterate" className="mt-2 rounded-lg border border-cyan-400/20 bg-black/40 p-2">
      <div className="flex items-center gap-2">
        <input
          data-testid="ck-iterate-input"
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
          placeholder="Change it… “make it taller”, “wider by 3m”, “set height to 20”"
          className="min-w-0 flex-1 rounded-md border border-white/10 bg-black/50 px-2 py-1 text-[12px] text-cyan-100 placeholder:text-cyan-300/30 focus:border-cyan-400/40 focus:outline-none"
        />
        <button
          type="button"
          data-testid="ck-iterate-submit"
          onClick={submit}
          className="rounded-md border border-cyan-400/30 bg-cyan-500/10 px-2 py-1 text-[11px] font-medium text-cyan-200 hover:border-cyan-300/60"
        >
          Iterate
        </button>
        {dirty && (
          <button
            type="button"
            data-testid="ck-iterate-revert"
            onClick={onRevert}
            className="rounded-md border border-white/10 px-2 py-1 text-[11px] text-white/50 hover:text-white/80"
          >
            Revert
          </button>
        )}
      </div>

      {dirty && (
        <div data-testid="ck-iterate-dirty" className="mt-1 text-[10px] text-amber-300/70">
          edited · not published — “Own it” to publish this version
        </div>
      )}

      {/* Honest rejection — worded, changes nothing. */}
      {outcome && !outcome.ok && (
        <div data-testid="ck-iterate-reject" className="mt-2 text-[11px] text-rose-300/80">
          {outcome.message}
        </div>
      )}

      {/* Confirm gate — the exact before→after; artifact changes only on Apply. */}
      {outcome?.ok && (
        <div data-testid="ck-iterate-confirm" className="mt-2 rounded-md border border-cyan-400/20 bg-black/40 p-2">
          <div className="text-[11px] text-cyan-200">
            Apply <span className="font-medium">{outcome.summary}</span>?
          </div>
          <ul className="mt-1 space-y-0.5">
            {outcome.changed.map((c) => (
              <li key={c.axis} className="font-mono text-[11px] text-cyan-100/80">
                {c.axis}: {c.before} m → <span className="text-cyan-200">{c.after} m</span>{' '}
                <span className={c.deltaM >= 0 ? 'text-emerald-300/70' : 'text-rose-300/70'}>
                  ({c.deltaM >= 0 ? '+' : '−'}
                  {Math.abs(c.deltaM)})
                </span>
              </li>
            ))}
          </ul>
          <div className="mt-2 flex gap-2">
            <button
              type="button"
              data-testid="ck-iterate-apply"
              onClick={apply}
              className="rounded-md border border-emerald-400/40 bg-emerald-500/10 px-2 py-1 text-[11px] font-medium text-emerald-200 hover:border-emerald-300/70"
            >
              Apply
            </button>
            <button
              type="button"
              data-testid="ck-iterate-cancel"
              onClick={() => setOutcome(null)}
              className="rounded-md border border-white/10 px-2 py-1 text-[11px] text-white/60 hover:text-white/90"
            >
              Cancel
            </button>
          </div>
        </div>
      )}
    </div>
  );
}

export default BuildingIterateBar;
