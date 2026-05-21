'use client';

/**
 * ModeRecommender — given a free-text question, calls the
 * `cognition.recommendMode` rule-based classifier and shows which of the
 * 7 HLR reasoning modes best fits, with a transparent ranking and the
 * surface-form signals that drove the pick. Selecting a mode hands it
 * back to the parent so the user can run HLR with it directly.
 */

import { useState } from 'react';
import { lensRun } from '@/lib/api/client';
import { Loader2, Lightbulb, ArrowRight } from 'lucide-react';

interface RankedMode {
  mode: string;
  label: string;
  blurb: string;
  score: number;
  fit: number;
}

interface Recommendation {
  question: string;
  recommended: string;
  recommendedLabel: string;
  confidence: number;
  rationale: string[];
  ranking: RankedMode[];
}

export function ModeRecommender({
  question,
  onPickMode,
}: {
  question: string;
  onPickMode: (mode: string) => void;
}) {
  const [rec, setRec] = useState<Recommendation | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const recommend = async () => {
    const q = question.trim();
    if (!q) {
      setError('Enter a question above first.');
      return;
    }
    setLoading(true);
    setError(null);
    try {
      const r = await lensRun<Recommendation>('cognition', 'recommendMode', {
        question: q,
      });
      if (r.data?.ok && r.data.result) {
        setRec(r.data.result);
      } else {
        setError(r.data?.error || 'Recommendation failed.');
      }
    } catch {
      setError('Recommendation request failed.');
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="rounded-lg border border-violet-900/40 bg-violet-950/10 p-4">
      <div className="flex items-center justify-between">
        <h3 className="flex items-center gap-1.5 text-sm font-semibold text-violet-300">
          <Lightbulb className="h-3.5 w-3.5" aria-hidden /> Mode recommendation
        </h3>
        <button
          onClick={recommend}
          disabled={loading}
          className="inline-flex items-center gap-1.5 rounded border border-violet-700/50 bg-violet-900/20 px-2.5 py-1 text-xs font-medium text-violet-300 hover:bg-violet-800/40 disabled:opacity-40 focus:outline-none focus:ring-2 focus:ring-violet-400"
        >
          {loading ? (
            <Loader2 className="h-3 w-3 animate-spin" />
          ) : (
            <Lightbulb className="h-3 w-3" />
          )}
          Recommend mode
        </button>
      </div>
      <p className="mt-1 text-[10px] text-violet-700">
        Analyses the surface form of your question to pick the best-fit
        reasoning mode.
      </p>

      {error && <p className="mt-2 text-xs text-rose-400">{error}</p>}

      {rec && (
        <div className="mt-3 space-y-3">
          <div className="rounded-lg border border-violet-700/40 bg-violet-900/20 p-3">
            <div className="flex items-center gap-2">
              <span className="text-[10px] uppercase tracking-wider text-violet-600">
                Recommended
              </span>
              <span className="font-mono text-sm text-violet-100">
                {rec.recommendedLabel}
              </span>
              <span className="rounded bg-violet-800/40 px-1.5 py-0.5 text-[10px] text-violet-300">
                {Math.round(rec.confidence * 100)}% confidence
              </span>
              <button
                onClick={() => onPickMode(rec.recommended)}
                className="ml-auto inline-flex items-center gap-1 rounded bg-violet-600 px-2 py-1 text-[11px] font-medium text-white hover:bg-violet-500 focus:outline-none focus:ring-2 focus:ring-violet-400"
              >
                Use this mode <ArrowRight className="h-3 w-3" />
              </button>
            </div>
            {rec.rationale.length > 0 && (
              <ul className="mt-1.5 list-disc pl-4 text-[11px] text-violet-400">
                {rec.rationale.map((why, i) => (
                  <li key={i}>{why}</li>
                ))}
              </ul>
            )}
          </div>

          <div className="space-y-1">
            {rec.ranking.map((m) => (
              <div
                key={m.mode}
                className="flex items-center gap-2 rounded border border-violet-900/30 bg-violet-950/10 px-2.5 py-1.5"
              >
                <span className="w-24 shrink-0 font-mono text-[11px] text-violet-300">
                  {m.label}
                </span>
                <div className="h-1.5 flex-1 overflow-hidden rounded bg-violet-950/60">
                  <div
                    className="h-full bg-violet-500"
                    style={{ width: `${Math.round(m.fit * 100)}%` }}
                  />
                </div>
                <span className="w-8 shrink-0 text-right text-[10px] text-violet-600">
                  {m.score}
                </span>
                <button
                  onClick={() => onPickMode(m.mode)}
                  className="shrink-0 rounded px-1.5 py-0.5 text-[10px] text-violet-500 hover:bg-violet-800/40 hover:text-violet-200"
                >
                  use
                </button>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
