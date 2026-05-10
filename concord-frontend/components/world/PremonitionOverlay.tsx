'use client';

/**
 * PremonitionOverlay — surfaces Layer-10 forward-sim predictions to the
 * player as in-fiction "feelings" / dreams. Pulled from
 * forward_sim.predictions_for_player macro. Shows the highest-confidence
 * unrealised prediction as a small floating card on the left edge.
 *
 * The card auto-hides after 12 s. Player can click "I felt that" to mark
 * the prediction as realised on the server, earning concord_alignment
 * (the prediction-realisation hook lives in forward-sim cycle).
 */

import { useEffect, useState } from 'react';

interface Prediction {
  id: string;
  subject_kind: string;
  subject_id: string;
  anticipated: string;
  confidence: number;
  composed_at: number;
  expires_at: number | null;
  realised_at: number | null;
}

export default function PremonitionOverlay() {
  const [topPrediction, setTopPrediction] = useState<Prediction | null>(null);
  const [hidden, setHidden] = useState(false);

  useEffect(() => {
    let alive = true;
    const refresh = async () => {
      const r = await fetch('/api/lens/run', {
        method: 'POST',
        credentials: 'include',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ domain: 'forward_sim', name: 'predictions_for_player', input: {} }),
      }).catch(() => null);
      if (!r?.ok || !alive) return;
      const data = await r.json().catch(() => null);
      const list: Prediction[] = data?.predictions || [];
      const unrealised = list.filter(p => !p.realised_at).sort((a, b) => b.confidence - a.confidence);
      if (unrealised.length > 0) {
        setTopPrediction(unrealised[0]);
        setHidden(false);
      }
    };
    void refresh();
    const interval = window.setInterval(refresh, 30_000);
    return () => { alive = false; window.clearInterval(interval); };
  }, []);

  useEffect(() => {
    if (!topPrediction) return;
    const t = window.setTimeout(() => setHidden(true), 12_000);
    return () => window.clearTimeout(t);
  }, [topPrediction]);

  if (!topPrediction || hidden) return null;

  const confidencePct = Math.round((topPrediction.confidence || 0) * 100);

  return (
    <div className="fixed left-3 top-1/3 z-40 max-w-xs animate-fade-in pointer-events-auto">
      <div className="bg-indigo-950/85 backdrop-blur-md border border-indigo-500/50 rounded-xl px-4 py-3 shadow-xl">
        <div className="text-[10px] uppercase tracking-widest text-indigo-300 font-bold mb-1">
          A Feeling… <span className="opacity-60">({topPrediction.subject_kind})</span>
        </div>
        <div className="text-sm text-indigo-50 italic leading-snug">
          {topPrediction.anticipated}
        </div>
        <div className="mt-2 flex items-center justify-between text-[10px] text-indigo-300/80">
          <span>conviction {confidencePct}%</span>
          <button
            type="button"
            className="text-indigo-200 hover:text-white underline-offset-2 hover:underline"
            onClick={() => setHidden(true)}
          >
            dismiss
          </button>
        </div>
      </div>
    </div>
  );
}
