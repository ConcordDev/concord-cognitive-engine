'use client';

/**
 * ModeComparison — runs one prompt through two HLR reasoning modes and
 * shows the results side by side: confidence, convergence, novelty, the
 * synthesized conclusion, and the full inference tree for each. Both runs
 * go through the real HLR engine via `cognition.compareModes`.
 */

import { useState } from 'react';
import { lensRun } from '@/lib/api/client';
import { Loader2, GitCompare } from 'lucide-react';
import {
  ReasoningTraceTree,
  type ReasoningTrace,
  type TraceChain,
} from './ReasoningTraceTree';

const MODES = [
  'deductive',
  'inductive',
  'abductive',
  'adversarial',
  'analogical',
  'temporal',
  'counterfactual',
];

interface ModeResult {
  mode: string;
  ok: boolean;
  error?: string;
  traceId?: string | null;
  conclusion?: string | null;
  chainCount?: number;
  confidence?: number | null;
  convergence?: number | null;
  novelty?: number | null;
  proposedDTUCount?: number;
  openQuestionCount?: number;
  chains?: TraceChain[];
}

interface CompareResult {
  prompt: string;
  depth: number;
  a: ModeResult;
  b: ModeResult;
  higherConfidence: string;
}

function pct(n?: number | null): string {
  return n == null || !Number.isFinite(n) ? '—' : `${Math.round(n * 100)}%`;
}

function ResultCard({
  res,
  isWinner,
}: {
  res: ModeResult;
  isWinner: boolean;
}) {
  if (!res.ok) {
    return (
      <div className="rounded-lg border border-rose-800/40 bg-rose-950/20 p-3">
        <div className="font-mono text-sm capitalize text-rose-200">{res.mode}</div>
        <p className="mt-1 text-xs text-rose-400">{res.error || 'run failed'}</p>
      </div>
    );
  }
  const trace: ReasoningTrace = {
    traceId: res.traceId || undefined,
    mode: res.mode,
    chains: res.chains,
    evaluation: {
      confidence: res.confidence ?? undefined,
      convergence: res.convergence ?? undefined,
      novelty: res.novelty ?? undefined,
    },
    output: { synthesizedConclusion: res.conclusion ?? undefined },
  };
  return (
    <div
      className={`rounded-lg border p-3 ${
        isWinner
          ? 'border-emerald-700/50 bg-emerald-950/15'
          : 'border-violet-900/40 bg-violet-950/10'
      }`}
    >
      <div className="flex items-center gap-2">
        <span className="font-mono text-sm capitalize text-violet-100">
          {res.mode}
        </span>
        {isWinner && (
          <span className="rounded bg-emerald-800/40 px-1.5 py-0.5 text-[10px] text-emerald-300">
            higher confidence
          </span>
        )}
      </div>
      <dl className="mt-2 grid grid-cols-3 gap-2 text-center">
        {[
          ['Confidence', pct(res.confidence)],
          ['Convergence', pct(res.convergence)],
          ['Novelty', pct(res.novelty)],
        ].map(([k, v]) => (
          <div key={k} className="rounded bg-black/30 px-1 py-1.5">
            <dt className="text-[9px] uppercase tracking-wider text-violet-700">
              {k}
            </dt>
            <dd className="font-mono text-sm text-violet-200">{v}</dd>
          </div>
        ))}
      </dl>
      <div className="mt-2 flex gap-3 text-[10px] text-violet-600">
        <span>{res.chainCount ?? 0} chains</span>
        <span>{res.proposedDTUCount ?? 0} proposed DTUs</span>
        <span>{res.openQuestionCount ?? 0} open Qs</span>
      </div>
      <div className="mt-3">
        <ReasoningTraceTree trace={trace} />
      </div>
    </div>
  );
}

export function ModeComparison({ prompt }: { prompt: string }) {
  const [modeA, setModeA] = useState('deductive');
  const [modeB, setModeB] = useState('adversarial');
  const [result, setResult] = useState<CompareResult | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const run = async () => {
    const q = prompt.trim();
    if (!q) {
      setError('Enter a claim or question above first.');
      return;
    }
    if (modeA === modeB) {
      setError('Pick two different modes to compare.');
      return;
    }
    setLoading(true);
    setError(null);
    try {
      const r = await lensRun<CompareResult>('cognition', 'compareModes', {
        question: q,
        modeA,
        modeB,
      });
      if (r.data?.ok && r.data.result) {
        setResult(r.data.result);
      } else {
        setError(r.data?.error || 'Comparison failed.');
      }
    } catch {
      setError('Comparison request failed.');
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="rounded-lg border border-violet-900/40 bg-violet-950/10 p-4">
      <h3 className="flex items-center gap-1.5 text-sm font-semibold text-violet-300">
        <GitCompare className="h-3.5 w-3.5" aria-hidden /> Compare two modes
      </h3>
      <p className="mt-1 text-[10px] text-violet-700">
        Runs the prompt above through two reasoning modes so you can see how
        each frames the problem.
      </p>
      <div className="mt-3 flex flex-wrap items-center gap-2">
        <label className="text-xs text-violet-700">
          Mode A
          <select
            value={modeA}
            onChange={(e) => setModeA(e.target.value)}
            className="ml-1.5 rounded border border-violet-900/40 bg-black/40 px-1.5 py-1 text-xs capitalize text-violet-200 focus:border-violet-500 focus:outline-none"
          >
            {MODES.map((m) => (
              <option key={m} value={m} className="capitalize">
                {m}
              </option>
            ))}
          </select>
        </label>
        <label className="text-xs text-violet-700">
          Mode B
          <select
            value={modeB}
            onChange={(e) => setModeB(e.target.value)}
            className="ml-1.5 rounded border border-violet-900/40 bg-black/40 px-1.5 py-1 text-xs capitalize text-violet-200 focus:border-violet-500 focus:outline-none"
          >
            {MODES.map((m) => (
              <option key={m} value={m} className="capitalize">
                {m}
              </option>
            ))}
          </select>
        </label>
        <button
          onClick={run}
          disabled={loading}
          className="inline-flex items-center gap-1.5 rounded bg-violet-600 px-2.5 py-1.5 text-xs font-medium text-white hover:bg-violet-500 disabled:opacity-40 focus:outline-none focus:ring-2 focus:ring-violet-400"
        >
          {loading ? (
            <Loader2 className="h-3 w-3 animate-spin" />
          ) : (
            <GitCompare className="h-3 w-3" />
          )}
          Compare
        </button>
      </div>

      {error && <p className="mt-2 text-xs text-rose-400">{error}</p>}

      {result && (
        <div className="mt-4 grid grid-cols-1 gap-3 lg:grid-cols-2">
          <ResultCard
            res={result.a}
            isWinner={result.higherConfidence === result.a.mode}
          />
          <ResultCard
            res={result.b}
            isWinner={result.higherConfidence === result.b.mode}
          />
        </div>
      )}
    </div>
  );
}
