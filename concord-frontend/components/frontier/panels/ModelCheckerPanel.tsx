'use client';

/**
 * ModelCheckerPanel — Wave W2-B, `audit.modelCheckLedgerConservation` +
 * `audit.modelCheckTreasuryInvariant` + `audit.modelCheckRoyaltyCascade`.
 *
 * Reference app (per docs/UI_QUALITY_RUBRIC.md §0 — name one, adopt its
 * exact interaction language): the TLA+ TOOLBOX's TLC error-trace viewer.
 * TLC is a bounded explicit-state model checker that, on finding a
 * violation, shows a numbered sequence of states reached by applying named
 * actions — never a diff, never a summary sentence, a literal step-by-step
 * replay. This panel borrows that shape directly: a monospace numbered
 * "Step N: actionName()" list is the flagship element of the Verify cell.
 *
 * Honesty note on the trace: `checkModel()` returns the counterexample as
 * an array of ACTION NAMES (`trace: string[]`) plus the single STATE where
 * the invariant broke (`state`) — it does NOT return a full array of
 * intermediate states. Two of the three macros additionally call
 * `replayTrace()` server-side and surface only `{reproduced, finalState}`
 * (never the full per-step state array — that's internal to the server,
 * not wire data). This panel renders exactly that shape: the action
 * sequence as numbered steps, the single violating state as the "final"
 * step's result, and the replay confirmation when present. It never
 * fabricates intermediate per-step states the server didn't send.
 */

import { useState } from 'react';
import { ds } from '@/lib/design-system';
import { cn } from '@/lib/utils';
import { lensRun } from '@/lib/api/client';
import { useLensCommand } from '@/hooks/useLensCommand';
import { ComputeCell, VerifyCell, BoundaryCell, type VerifyStatus } from '@/components/frontier/FrontierEngineShell';
import type { FrontierEngineDef } from '@/lib/frontier-engines';

type ModelId = 'ledger' | 'treasury' | 'royalty';

const MODEL_LABEL: Record<ModelId, string> = {
  ledger: 'Ledger conservation',
  treasury: 'Treasury invariant',
  royalty: 'Royalty cascade',
};

const MODEL_MACRO: Record<ModelId, string> = {
  ledger: 'modelCheckLedgerConservation',
  treasury: 'modelCheckTreasuryInvariant',
  royalty: 'modelCheckRoyaltyCascade',
};

const MODEL_DESCRIPTION: Record<ModelId, string> = {
  ledger:
    'Explores a 2-user + platform-account ledger model (mint / transfer / marketplace_purchase / withdraw, ' +
    '≤5 rows) checking circulating balance never exceeds total minted USD.',
  treasury:
    'The same underlying state machine as ledger conservation, exposed as a distinct macro so intent at the ' +
    'call site is legible — checks the identical circulating-vs-minted invariant.',
  royalty:
    'Explores citeAncestor() / purchase() over up to 4 ancestors and up to 50 generations, checking the real ' +
    'decay formula rate(gen)=max(initialRate/2^gen, floor) never pays out more than 30% of the sale to ancestors.',
};

interface CheckModelResult {
  status:
    | 'violation'
    | 'nondeterministic_action'
    | 'error'
    | 'state_space_exhausted'
    | 'depth_bound_reached'
    | 'no_violation_found';
  invariant?: string;
  message?: string;
  trace?: string[];
  state?: Record<string, unknown>;
  statesExplored?: number;
  bound?: { maxStates: number; maxDepth: number };
  exhaustive?: boolean;
  note?: string;
  action?: string;
  reason?: string;
  replay?: { reproduced: boolean; finalState?: Record<string, unknown> };
}

const STATUS_LABEL: Record<CheckModelResult['status'], string> = {
  violation: 'INVARIANT VIOLATED',
  no_violation_found: 'No violation found (exhaustive)',
  state_space_exhausted: 'State cap reached — incomplete',
  depth_bound_reached: 'Depth cap reached — incomplete',
  nondeterministic_action: 'Model action is nondeterministic',
  error: 'Model action threw',
};

export function ModelCheckerPanel({ engine }: { engine: FrontierEngineDef }) {
  const [model, setModel] = useState<ModelId>('ledger');
  const [predicate, setPredicate] = useState<'correct' | 'buggy'>('buggy');
  const [enforceCap, setEnforceCap] = useState(true);
  const [saleAmount, setSaleAmount] = useState(1000);
  const [maxStates, setMaxStates] = useState(5000);
  const [maxDepth, setMaxDepth] = useState(6);

  const [status, setStatus] = useState<VerifyStatus>('idle');
  const [reason, setReason] = useState<string | null>(null);
  const [result, setResult] = useState<CheckModelResult | null>(null);
  const [runCount, setRunCount] = useState(0);

  function selectModel(id: ModelId) {
    setModel(id);
    setResult(null);
    setStatus('idle');
    setReason(null);
    setMaxDepth(id === 'royalty' ? 10 : 6);
    setMaxStates(5000);
  }

  async function runCheck() {
    setStatus('loading');
    setReason(null);
    setResult(null);
    try {
      const macro = MODEL_MACRO[model];
      const input: Record<string, unknown> =
        model === 'royalty'
          ? { enforceCap, saleAmount, maxStates, maxDepth }
          : { predicate, maxStates, maxDepth };

      const res = await lensRun<CheckModelResult>('audit', macro, input);
      setRunCount((n) => n + 1);

      if (!res.data?.ok || !res.data.result) {
        setReason(res.data?.error || 'Unknown refusal.');
        setStatus('error');
        return;
      }

      const r = res.data.result;
      setResult(r);

      if (r.status === 'nondeterministic_action' || r.status === 'error') {
        setReason(
          r.message
            || `Model action '${r.action}' did not behave as a pure function of state — the model itself, not the invariant, is what failed.`,
        );
        setStatus('error');
      } else {
        // 'violation', 'no_violation_found', 'state_space_exhausted', and
        // 'depth_bound_reached' are all genuine, complete findings from a
        // real bounded search — none of them are the server declining to
        // run. The shell's VerifyCell only renders children when status is
        // 'ok' (its 'refused' branch shows ONLY the generic reason text,
        // hiding the trace/stats view below), so all four render here,
        // distinguished by their own status-specific banner inside
        // ResultView — an incomplete-bound result is a real, honestly
        // partial finding, not a decline to answer.
        setStatus('ok');
      }
    } catch (e) {
      setReason(e instanceof Error ? e.message : String(e));
      setStatus('error');
    }
  }

  useLensCommand(
    [{ id: 'run-model-check', keys: 'mod+enter', description: 'Run bounded model check', category: 'actions', action: runCheck }],
    { lensId: 'frontier' },
  );

  const runDisabled = model === 'royalty' && !(saleAmount > 0);

  return (
    <div className="space-y-8">
      <ComputeCell
        cellNumber={1}
        macroLabel={`audit.${MODEL_MACRO[model]}`}
        running={status === 'loading'}
        onRun={runCheck}
        runLabel="Run bounded check"
        runDisabled={runDisabled}
        hotkey="⌘+Enter"
      >
        <div>
          <label className={ds.label} htmlFor="mc-model">Invariant model</label>
          <select
            id="mc-model"
            className={ds.select}
            value={model}
            onChange={(e) => selectModel(e.target.value as ModelId)}
          >
            {(Object.keys(MODEL_LABEL) as ModelId[]).map((id) => (
              <option key={id} value={id}>{MODEL_LABEL[id]}</option>
            ))}
          </select>
          <p className={cn(ds.textMuted, 'mt-1')}>{MODEL_DESCRIPTION[model]}</p>
        </div>

        {model !== 'royalty' ? (
          <div>
            <p className={cn(ds.label, 'mb-2')}>Credit predicate</p>
            <div className="flex gap-4 text-sm">
              <label className="flex items-center gap-2">
                <input
                  type="radio"
                  name="mc-predicate"
                  checked={predicate === 'buggy'}
                  onChange={() => setPredicate('buggy')}
                />
                Buggy — reproduces the historical double-credit bug (should find a violation)
              </label>
              <label className="flex items-center gap-2">
                <input
                  type="radio"
                  name="mc-predicate"
                  checked={predicate === 'correct'}
                  onChange={() => setPredicate('correct')}
                />
                Correct — the current CREDIT_ROW_PREDICATE (should find none, within bound)
              </label>
            </div>
          </div>
        ) : (
          <div className={ds.grid2}>
            <NumberField
              id="mc-sale-amount"
              label="Sale amount ($)"
              value={saleAmount}
              onChange={setSaleAmount}
              min={1}
              step={50}
            />
            <label className="flex items-center gap-2 mt-6 text-sm text-gray-300">
              <input type="checkbox" checked={enforceCap} onChange={(e) => setEnforceCap(e.target.checked)} />
              Enforce the 30% royalty cap (uncheck to see the cap invariant genuinely break)
            </label>
          </div>
        )}

        <div>
          <p className={cn(ds.label, 'mb-2')}>Bounded-search caps (BFS explicit-state, SHA-256 visited-dedup)</p>
          <div className={ds.grid2}>
            <NumberField
              id="mc-max-states"
              label={`Max states (≤ ${20000})`}
              value={maxStates}
              onChange={(v) => setMaxStates(Math.min(20000, Math.max(1, Math.round(v))))}
              min={1}
              max={20000}
              step={500}
            />
            <NumberField
              id="mc-max-depth"
              label={`Max depth (≤ ${model === 'royalty' ? 20 : 15})`}
              value={maxDepth}
              onChange={(v) => setMaxDepth(Math.min(model === 'royalty' ? 20 : 15, Math.max(1, Math.round(v))))}
              min={1}
              max={model === 'royalty' ? 20 : 15}
              step={1}
            />
          </div>
        </div>
      </ComputeCell>

      <VerifyCell cellNumber={2} status={runCount === 0 ? 'idle' : status} reason={reason}>
        {result && status === 'ok' && <ResultView result={result} />}
      </VerifyCell>

      <BoundaryCell cellNumber="B" text={engine.boundary ?? ''} source={engine.boundarySource} />
    </div>
  );
}

function ResultView({ result }: { result: CheckModelResult }) {
  const isViolation = result.status === 'violation';
  const isClean = result.status === 'no_violation_found';
  return (
    <div className="space-y-4">
      <div
        className={cn(
          'rounded-lg border px-3 py-2 text-sm font-medium',
          isViolation && 'border-red-500/40 bg-red-500/10 text-red-400',
          isClean && 'border-emerald-500/40 bg-emerald-500/10 text-emerald-400',
          !isViolation && !isClean && 'border-amber-500/40 bg-amber-500/10 text-amber-400',
        )}
      >
        {STATUS_LABEL[result.status]}
        {result.invariant && <span className={cn(ds.monoXs, 'ml-2 opacity-80')}>invariant: {result.invariant}</span>}
      </div>

      {result.message && <p className={cn(ds.textBody, 'text-sm')}>{result.message}</p>}
      {result.note && <p className={cn(ds.textMuted, 'text-sm italic')}>{result.note}</p>}

      <div className="flex flex-wrap gap-4 text-sm">
        <Stat label="States explored" value={String(result.statesExplored ?? '—')} />
        <Stat
          label="Bound"
          value={result.bound ? `${result.bound.maxStates} states / depth ${result.bound.maxDepth}` : '—'}
        />
        <Stat label="Exhaustive" value={result.exhaustive === undefined ? '—' : result.exhaustive ? 'yes' : 'no'} tone={result.exhaustive ? 'good' : undefined} />
      </div>

      {isViolation && result.trace && (
        <div>
          <p className={cn(ds.label, 'mb-2')}>Counterexample — action sequence (TLC-style error trace)</p>
          <ol className={cn(ds.monoSm, 'space-y-1 border-l border-lattice-border pl-4')}>
            {result.trace.length === 0 && (
              <li className="text-amber-400">Step 0: violation on the INITIAL state — no actions needed to break it.</li>
            )}
            {result.trace.map((action, i) => (
              <li key={i}>
                <span className="text-gray-500">Step {i + 1}:</span> {action}
              </li>
            ))}
            <li className="text-red-400">→ invariant broke in the state shown below</li>
          </ol>
          {result.state && (
            <pre className={cn(ds.monoXs, 'mt-2 p-3 rounded-lg border border-lattice-border bg-lattice-surface overflow-x-auto')}>
              {JSON.stringify(result.state, null, 2)}
            </pre>
          )}
          {result.replay && (
            <p className={cn(ds.textMuted, 'text-xs mt-2')}>
              Server-side replay of this exact trace {result.replay.reproduced ? 'reproduced the same violating state.' : 'did NOT reproduce — the trace may not be replayable as recorded.'}
            </p>
          )}
        </div>
      )}
    </div>
  );
}

function NumberField({
  id, label, value, onChange, min, max, step,
}: { id: string; label: string; value: number; onChange: (v: number) => void; min?: number; max?: number; step?: number }) {
  return (
    <div>
      <label className={ds.label} htmlFor={id}>{label}</label>
      <input
        id={id}
        type="number"
        className={ds.input}
        value={value}
        min={min}
        max={max}
        step={step}
        onChange={(e) => onChange(Number(e.target.value))}
      />
    </div>
  );
}

function Stat({ label, value, tone }: { label: string; value: string; tone?: 'good' }) {
  return (
    <div className="min-w-[8rem]">
      <div className={ds.textMuted}>{label}</div>
      <div className={cn(ds.monoBase, tone === 'good' && 'text-emerald-400')}>{value}</div>
    </div>
  );
}

export default ModelCheckerPanel;
