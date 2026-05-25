'use client';

/**
 * TimelineView — horizontal time axis with plotted events. Used by any
 * lens that needs a chronological surface (history, event-timeline,
 * cognitive-replay, project milestones, audit trails, etc.).
 */

import { useMemo, useState } from 'react';

export interface TimelineEvent {
  id: string;
  label: string;
  /** epoch ms, or ISO string, or any Date-parseable value */
  time: number | string;
  tone?: 'default' | 'good' | 'warn' | 'bad' | 'info';
  detail?: string;
}

const TONE: Record<string, string> = {
  default: 'bg-zinc-400 border-zinc-300',
  good: 'bg-emerald-500 border-emerald-300',
  warn: 'bg-amber-500 border-amber-300',
  bad: 'bg-rose-500 border-rose-300',
  info: 'bg-indigo-500 border-indigo-300',
};

function ms(t: number | string): number {
  if (typeof t === 'number') return t;
  const n = Date.parse(t);
  return Number.isFinite(n) ? n : 0;
}

export function TimelineView({
  events,
  height = 120,
  onSelect,
}: {
  events: TimelineEvent[];
  height?: number;
  onSelect?: (e: TimelineEvent) => void;
}) {
  const [active, setActive] = useState<string | null>(null);

  const sorted = useMemo(
    () => [...events].sort((a, b) => ms(a.time) - ms(b.time)),
    [events],
  );
  const { min, span } = useMemo(() => {
    if (sorted.length === 0) return { min: 0, span: 1 };
    const lo = ms(sorted[0].time);
    const hi = ms(sorted[sorted.length - 1].time);
    return { min: lo, span: Math.max(1, hi - lo) };
  }, [sorted]);

  if (sorted.length === 0) {
    return (
      <div
        className="flex items-center justify-center rounded-lg border border-zinc-800 bg-zinc-950/40 text-xs text-zinc-400"
        style={{ height }}
      >
        No events on the timeline yet.
      </div>
    );
  }

  return (
    <div className="rounded-lg border border-zinc-800 bg-zinc-950/40 p-4" style={{ minHeight: height }}>
      <div className="relative" style={{ height: height - 32 }}>
        <div className="absolute left-0 right-0 top-1/2 h-px bg-zinc-700" />
        {sorted.map((e, i) => {
          const pct = ((ms(e.time) - min) / span) * 100;
          const above = i % 2 === 0;
          return (
            <button
              key={e.id}
              onClick={() => { setActive(e.id); onSelect?.(e); }}
              className="absolute -translate-x-1/2 group"
              style={{ left: `${pct}%`, top: '50%' }}
              title={e.label}
            >
              <span
                className={`block w-3 h-3 rounded-full border-2 ${TONE[e.tone || 'default']} ${
                  active === e.id ? 'ring-2 ring-white/50 scale-125' : ''
                } transition-transform -translate-y-1/2`}
              />
              <span
                className={`absolute left-1/2 -translate-x-1/2 whitespace-nowrap text-[10px] text-zinc-400 group-hover:text-zinc-100 ${
                  above ? 'bottom-3' : 'top-3'
                }`}
              >
                {e.label}
              </span>
            </button>
          );
        })}
      </div>
      {active && (
        <p className="mt-2 text-[11px] text-zinc-400 border-t border-zinc-800 pt-2">
          {(() => {
            const e = sorted.find((x) => x.id === active);
            if (!e) return null;
            return (
              <>
                <span className="text-zinc-200 font-medium">{e.label}</span>
                {' · '}
                {new Date(ms(e.time)).toLocaleString()}
                {e.detail ? ` — ${e.detail}` : ''}
              </>
            );
          })()}
        </p>
      )}
    </div>
  );
}
