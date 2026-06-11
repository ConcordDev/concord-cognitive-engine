'use client';

// Phase F3.3 — surfaces the player's active forward predictions
// (Layer 10 forward-sim). Predictions are short, grounded anticipations
// of what might happen next, composed every ~25min for offline players.
// Until now they were written to the table but never displayed.
//
// Mounted in the world lens as a collapsible sidebar card. Polls
// /api/forward-predictions/active every 5 minutes (predictions don't
// change often).

import { useCallback, useEffect, useState } from 'react';
import { Sparkles, ChevronDown, ChevronUp } from 'lucide-react';
import { useClientConfig } from '@/hooks/useClientConfig';

interface Prediction {
  id: string;
  subject_kind: 'quest' | 'npc' | 'decision' | 'faction' | 'self';
  subject_id: string;
  anticipated_text: string;
  confidence: number;
  composer: string;
  composed_at: number;
  expires_at: number;
}

export function ForwardPredictionsPanel() {
  const POLL_MS = useClientConfig().poll.forwardPredMs; // E0 — server-tunable
  const [predictions, setPredictions] = useState<Prediction[]>([]);
  const [collapsed, setCollapsed] = useState(true); // default collapsed; quiet
  const [seenIds, setSeenIds] = useState<Set<string>>(new Set());

  const refresh = useCallback(async () => {
    try {
      const r = await fetch('/api/forward-predictions/active?limit=6', { credentials: 'include' });
      const j = await r.json();
      if (j?.ok && Array.isArray(j.predictions)) setPredictions(j.predictions);
    } catch { /* swallow */ }
  }, []);

  useEffect(() => {
    refresh();
    const t = setInterval(refresh, POLL_MS);
    return () => clearInterval(t);
  }, [refresh, POLL_MS]);

  // Also react to prediction:realised events to refresh.
  useEffect(() => {
    const onRealised = () => refresh();
    window.addEventListener('concordia:prediction-realised', onRealised);
    return () => window.removeEventListener('concordia:prediction-realised', onRealised);
  }, [refresh]);

  if (predictions.length === 0) return null;

  const unseenCount = predictions.filter((p) => !seenIds.has(p.id)).length;

  return (
    <div className="concordia-hud-slide-right pointer-events-auto fixed bottom-32 right-4 z-30 w-72 rounded-lg border border-violet-500/40 bg-zinc-950/95 shadow-xl backdrop-blur">
      <header
        className="flex cursor-pointer items-center justify-between border-b border-violet-500/20 px-3 py-2"
        onClick={() => setCollapsed((v) => !v)}
      >
        <h2 className="flex items-center gap-2 text-xs font-semibold text-violet-200">
          <Sparkles size={12} /> Anticipating
          {unseenCount > 0 && (
            <span className="ml-1 rounded bg-violet-500/40 px-1.5 py-0.5 text-[9px] text-violet-50">{unseenCount}</span>
          )}
        </h2>
        {collapsed ? <ChevronDown size={11} className="text-zinc-400" /> : <ChevronUp size={11} className="text-zinc-400" />}
      </header>

      {!collapsed && (
        <div className="max-h-80 space-y-2 overflow-y-auto p-2">
          {predictions.map((p) => (
            <div
              key={p.id}
              className="rounded border border-violet-500/30 bg-violet-950/30 p-2 text-[11px]"
              onMouseEnter={() => {
                if (!seenIds.has(p.id)) {
                  setSeenIds(new Set([...seenIds, p.id]));
                }
              }}
            >
              <div className="flex items-center justify-between">
                <span className="text-[9px] uppercase tracking-wider text-violet-300/70">
                  {p.subject_kind} · {p.subject_id.slice(0, 16)}
                </span>
                <span className="text-[9px] text-violet-300/70">
                  {Math.round(p.confidence * 100)}%
                </span>
              </div>
              <div className="mt-1 leading-relaxed text-zinc-300">{p.anticipated_text}</div>
            </div>
          ))}
          <p className="text-center text-[9px] text-violet-300/60">
            Predictions are speculative. Watch for outcomes.
          </p>
        </div>
      )}
    </div>
  );
}
