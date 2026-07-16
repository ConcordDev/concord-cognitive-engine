'use client';

/**
 * ReasoningToolkit — designed UI entry points for two metacognition macros
 * that were functional and correctly-shaped server-side but had no button
 * anywhere in page.tsx (see docs/lens-specs/metacognition-capability-map.md,
 * "Genuinely missing, deferred"):
 *
 *  - `select_strategy` (server.js) reads `{problem}`, matches it against 7
 *    named reasoning-strategy triggers (deductive/inductive/abductive/
 *    analogical/decomposition/simulation/empirical), and returns
 *    `{ok, strategy: {name, description}, alternatives: [...]}`.
 *  - `adjust_confidence` (server.js) reads `{domain, confidence}` and returns
 *    `{original, adjusted, factor, domain, explanation}` — a domain-specific
 *    confidence adjustment learned from past introspection passes.
 *
 * Both are read via the canonical `lensRun()` client helper (POST
 * /api/lens/run), matching the direct-call pattern already used by the
 * Predictions Analysis panel elsewhere on this page. Honest by construction:
 * a failed call surfaces the real error text, never a fabricated result.
 */

import { useState } from 'react';
import { ArrowDown, ArrowUp, Compass, Gauge, Loader2, Minus, Sparkles } from 'lucide-react';
import { lensRun } from '@/lib/api/client';

interface StrategyOption {
  name: string;
  description: string;
}

interface StrategyResult {
  strategy: StrategyOption;
  alternatives: StrategyOption[];
}

interface ConfidenceResult {
  original: number;
  adjusted: number;
  factor: number;
  domain: string;
  explanation: string;
}

export function ReasoningToolkit() {
  // --- Strategy Advisor state ---
  const [problem, setProblem] = useState('');
  const [strategyResult, setStrategyResult] = useState<StrategyResult | null>(null);
  const [strategyLoading, setStrategyLoading] = useState(false);
  const [strategyError, setStrategyError] = useState<string | null>(null);

  const suggestStrategy = async () => {
    const trimmed = problem.trim();
    if (!trimmed) return;
    setStrategyLoading(true);
    setStrategyError(null);
    setStrategyResult(null);
    try {
      const res = await lensRun('metacognition', 'select_strategy', { problem: trimmed });
      if (res.data.ok && res.data.result) {
        setStrategyResult(res.data.result as unknown as StrategyResult);
      } else {
        setStrategyError(res.data.error || 'Could not suggest a strategy.');
      }
    } catch (e) {
      setStrategyError(e instanceof Error ? e.message : 'Could not suggest a strategy.');
    } finally {
      setStrategyLoading(false);
    }
  };

  // --- Confidence Adjuster state ---
  const [confDomain, setConfDomain] = useState('');
  const [confInput, setConfInput] = useState(0.7);
  const [confResult, setConfResult] = useState<ConfidenceResult | null>(null);
  const [confLoading, setConfLoading] = useState(false);
  const [confError, setConfError] = useState<string | null>(null);

  const adjustConfidence = async () => {
    const domain = confDomain.trim();
    if (!domain) return;
    setConfLoading(true);
    setConfError(null);
    setConfResult(null);
    try {
      const res = await lensRun('metacognition', 'adjust_confidence', { domain, confidence: confInput });
      if (res.data.ok && res.data.result) {
        setConfResult(res.data.result as unknown as ConfidenceResult);
      } else {
        setConfError(res.data.error || 'Could not compute an adjusted estimate.');
      }
    } catch (e) {
      setConfError(e instanceof Error ? e.message : 'Could not compute an adjusted estimate.');
    } finally {
      setConfLoading(false);
    }
  };

  const direction = confResult
    ? confResult.factor > 1
      ? 'boosted'
      : confResult.factor < 1
        ? 'reduced'
        : 'unchanged'
    : null;

  return (
    <div className="panel p-4 space-y-4">
      <div>
        <h2 className="font-semibold flex items-center gap-2">
          <Compass className="w-4 h-4 text-neon-cyan" />
          Reasoning Toolkit
        </h2>
        <p className="text-xs text-gray-400 mt-1">
          Two on-demand meta-reasoning tools: pick a reasoning strategy for a stated
          problem, or see how a confidence estimate shifts given historical
          performance in a domain.
        </p>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
        {/* --- Strategy Advisor (select_strategy) --- */}
        <div className="lens-card space-y-3">
          <h3 className="text-sm font-medium flex items-center gap-2 text-gray-200">
            <Sparkles className="w-3.5 h-3.5 text-neon-purple" />
            Strategy Advisor
          </h3>
          <label className="text-xs text-gray-400 block" htmlFor="reasoning-toolkit-problem">
            What&apos;s your problem?
          </label>
          <textarea
            id="reasoning-toolkit-problem"
            value={problem}
            onChange={(e) => setProblem(e.target.value)}
            placeholder="Describe the problem you're reasoning through..."
            rows={2}
            className="input-lattice w-full resize-none"
          />
          <button
            onClick={suggestStrategy}
            disabled={!problem.trim() || strategyLoading}
            className="btn-secondary text-sm w-full flex items-center justify-center gap-2 disabled:opacity-50"
          >
            {strategyLoading ? (
              <Loader2 className="w-3.5 h-3.5 animate-spin" />
            ) : (
              <Compass className="w-3.5 h-3.5" />
            )}
            {strategyLoading ? 'Analyzing...' : 'Suggest a reasoning strategy'}
          </button>

          {strategyError && (
            <p className="text-xs text-red-400 bg-red-500/10 border border-red-500/20 rounded-lg p-2">
              {strategyError}
            </p>
          )}

          {strategyResult && (
            <div className="space-y-2 pt-1">
              <span className="inline-block text-xs uppercase tracking-wide text-neon-cyan bg-cyan-500/10 px-2 py-0.5 rounded-full capitalize">
                {strategyResult.strategy?.name}
              </span>
              <p className="text-sm text-gray-300">{strategyResult.strategy?.description}</p>
              {Array.isArray(strategyResult.alternatives) && strategyResult.alternatives.length > 0 && (
                <div>
                  <p className="text-xs text-gray-400 mb-1">Also consider:</p>
                  <div className="flex flex-wrap gap-1">
                    {strategyResult.alternatives.map((alt, i) => (
                      <span
                        key={`${alt.name}-${i}`}
                        title={alt.description}
                        className="text-xs bg-white/5 text-gray-300 px-2 py-0.5 rounded-full capitalize cursor-help"
                      >
                        {alt.name}
                      </span>
                    ))}
                  </div>
                </div>
              )}
            </div>
          )}
        </div>

        {/* --- Confidence Adjuster (adjust_confidence) --- */}
        <div className="lens-card space-y-3">
          <h3 className="text-sm font-medium flex items-center gap-2 text-gray-200">
            <Gauge className="w-3.5 h-3.5 text-neon-green" />
            Confidence Adjuster
          </h3>
          <label className="text-xs text-gray-400 block" htmlFor="reasoning-toolkit-domain">
            Domain
          </label>
          <input
            id="reasoning-toolkit-domain"
            type="text"
            value={confDomain}
            onChange={(e) => setConfDomain(e.target.value)}
            placeholder="e.g. reasoning, memory, engineering..."
            className="input-lattice w-full"
          />
          <label className="text-xs text-gray-400 block">
            Starting confidence: {(confInput * 100).toFixed(0)}%
          </label>
          <input
            type="range"
            min="0.1"
            max="1"
            step="0.05"
            value={confInput}
            onChange={(e) => setConfInput(parseFloat(e.target.value))}
            className="w-full"
            aria-label="Starting confidence"
          />
          <button
            onClick={adjustConfidence}
            disabled={!confDomain.trim() || confLoading}
            className="btn-secondary text-sm w-full flex items-center justify-center gap-2 disabled:opacity-50"
          >
            {confLoading ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Gauge className="w-3.5 h-3.5" />}
            {confLoading ? 'Adjusting...' : 'Get domain-adjusted estimate'}
          </button>

          {confError && (
            <p className="text-xs text-red-400 bg-red-500/10 border border-red-500/20 rounded-lg p-2">
              {confError}
            </p>
          )}

          {confResult && (
            <div className="space-y-2 pt-1">
              <div className="flex items-center gap-3">
                <div className="text-center">
                  <p className="text-lg font-bold font-mono text-gray-300">
                    {(confResult.original * 100).toFixed(0)}%
                  </p>
                  <p className="text-[10px] text-gray-500">Original</p>
                </div>
                {direction === 'boosted' && <ArrowUp className="w-4 h-4 text-green-400" aria-label="boosted" />}
                {direction === 'reduced' && <ArrowDown className="w-4 h-4 text-red-400" aria-label="reduced" />}
                {direction === 'unchanged' && <Minus className="w-4 h-4 text-gray-400" aria-label="unchanged" />}
                <div className="text-center">
                  <p
                    className={`text-lg font-bold font-mono ${
                      direction === 'boosted'
                        ? 'text-green-400'
                        : direction === 'reduced'
                          ? 'text-red-400'
                          : 'text-gray-300'
                    }`}
                  >
                    {(confResult.adjusted * 100).toFixed(0)}%
                  </p>
                  <p className="text-[10px] text-gray-500">Adjusted</p>
                </div>
                <span className="text-xs text-gray-400 font-mono ml-auto">×{confResult.factor.toFixed(2)}</span>
              </div>
              <p className="text-xs text-gray-400">{confResult.explanation}</p>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
