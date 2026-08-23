'use client';

// EcosystemMetricsBadge — small four-axis indicator that surfaces the
// player's per-world reactivity scalars: ecosystem_score (Concordia
// reactivity), concord_alignment (Concord visit threshold),
// concordia_alignment (Concordia warmth), refusal_debt (Sovereign visit
// threshold). Reads /api/world/me/metrics and refreshes on a slow
// cadence — these scalars drift from gameplay actions, not real time.

import { useEffect, useState, useCallback } from 'react';
import { api } from '@/lib/api/client';

interface Metrics {
  ecosystem_score: number;
  concord_alignment: number;
  concordia_alignment: number;
  refusal_debt: number;
}

function bar(value: number, range = 100): { width: number; tint: 'positive' | 'negative' | 'neutral' } {
  const clamped = Math.max(-range, Math.min(range, value));
  const width = Math.abs(clamped) / range * 100;
  if (Math.abs(clamped) < 2) return { width: 0, tint: 'neutral' };
  return { width, tint: clamped >= 0 ? 'positive' : 'negative' };
}

const TINT_CLASS: Record<'positive' | 'negative' | 'neutral', string> = {
  positive: 'bg-emerald-400',
  negative: 'bg-red-400',
  neutral:  'bg-white/30',
};

export default function EcosystemMetricsBadge({ worldId = 'concordia-hub' }: { worldId?: string }) {
  const [m, setM] = useState<Metrics | null>(null);
  const [open, setOpen] = useState(false);

  const refresh = useCallback(async () => {
    try {
      const r = await api.get('/api/world/me/metrics', { params: { worldId } });
      if (r.data?.ok) setM(r.data.metrics as Metrics);
    } catch { /* offline-tolerant */ }
  }, [worldId]);

  useEffect(() => {
    refresh();
    const t = setInterval(refresh, 30_000);
    return () => clearInterval(t);
  }, [refresh]);

  if (!m) return null;

  const rows: Array<[string, number]> = [
    ['ecosystem',  m.ecosystem_score],
    ['concord',    m.concord_alignment],
    ['concordia',  m.concordia_alignment],
    ['refusal',    m.refusal_debt],
  ];

  return (
    <div className="fixed bottom-3 left-3 z-30">
      <button
        onClick={() => setOpen((v) => !v)}
        className="bg-black/70 border border-white/10 rounded-lg px-2.5 py-1.5 text-white text-[11px] font-mono flex items-center gap-2 hover:bg-black/90"
        title="Per-world reactivity scalars"
      >
        <span className="w-1.5 h-1.5 rounded-full bg-emerald-400" />
        alignment
      </button>
      {open && (
        <div className="absolute bottom-10 left-0 bg-black/90 border border-white/10 rounded-lg p-3 text-white text-[11px] w-64 space-y-2">
          {rows.map(([name, value]) => {
            const { width, tint } = bar(value);
            return (
              <div key={name}>
                <div className="flex justify-between mb-0.5">
                  <span className="text-white/70">{name}</span>
                  <span className="tabular-nums text-white/60">{Math.round(value)}</span>
                </div>
                <div className="h-1.5 bg-white/5 rounded-full overflow-hidden relative">
                  <div className="absolute top-0 bottom-0 left-1/2 w-px bg-white/30" />
                  <div
                    className={`absolute top-0 bottom-0 ${TINT_CLASS[tint]}`}
                    style={
                      tint === 'positive'
                        ? { left: '50%', width: `${width / 2}%` }
                        : tint === 'negative'
                          ? { right: '50%', width: `${width / 2}%` }
                          : { width: 0 }
                    }
                  />
                </div>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
