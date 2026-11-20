'use client';

/**
 * The chalkboard over the stall: today's takings against yesterday at the
 * same time, a cumulative pace line by hour (today solid, yesterday
 * dashed), the daily goal with its bell, and crates running low. All of it
 * is retail.analytics-hourly + retail.low-stock, bucketed by the viewer's
 * local hour; the goal is retail.goal-set.
 */

import { useEffect, useMemo, useState } from 'react';
import { BellRing, Loader2 } from 'lucide-react';
import { cn } from '@/lib/utils';
import { retail, money, tzOffsetMinutes, type Hourly } from './retailApi';
import type { RetailSection } from './sections';

const W = 240, H = 56;

function paceLine(rows: { revenue: number }[], upTo: number, max: number) {
  let run = 0;
  const pts: string[] = [];
  for (let h = 0; h <= upTo; h++) {
    run += rows[h]?.revenue || 0;
    pts.push(`${((h + 1) / 24) * W},${H - (max > 0 ? (run / max) * (H - 4) : 0) - 2}`);
  }
  return `0,${H - 2} ${pts.join(' ')}`;
}

export function DayBoard({ refreshKey, ringKey, onNavigate }: { refreshKey: number; ringKey: number; onNavigate: (s: RetailSection, sub?: string) => void }) {
  const [data, setData] = useState<Hourly | null>(null);
  const [low, setLow] = useState<number | null>(null);
  const [failed, setFailed] = useState(false);
  const [editingGoal, setEditingGoal] = useState(false);
  const [goalInput, setGoalInput] = useState('');
  const [goalBusy, setGoalBusy] = useState(false);
  const [goalErr, setGoalErr] = useState<string | null>(null);
  const [ringing, setRinging] = useState(false);
  const [goalKey, setGoalKey] = useState(0);

  useEffect(() => {
    let live = true;
    Promise.all([
      retail<Hourly>('analytics-hourly', { tzOffsetMinutes: tzOffsetMinutes() }),
      retail<{ lowStock: unknown[] }>('low-stock', { threshold: 5 }),
    ]).then(([h, l]) => {
      if (!live) return;
      setFailed(!h.ok);
      if (h.ok && h.result) setData(h.result);
      if (l.ok && l.result) setLow(l.result.lowStock.length);
    });
    return () => { live = false; };
  }, [refreshKey, goalKey]);

  // The bell swings when a sale's server-stamped goal_hit arrives.
  useEffect(() => {
    if (!ringKey) return;
    setRinging(true);
    const t = setTimeout(() => setRinging(false), 750);
    return () => clearTimeout(t);
  }, [ringKey]);

  const saveGoal = async () => {
    setGoalBusy(true); setGoalErr(null);
    const r = await retail('goal-set', { amount: goalInput.trim() === '' ? 0 : Number(goalInput) });
    setGoalBusy(false);
    if (r.ok) { setEditingGoal(false); setGoalKey((k) => k + 1); }
    else setGoalErr(r.error || 'That goal was not saved.');
  };

  const chart = useMemo(() => {
    if (!data) return null;
    const total = (rows: { revenue: number }[]) => rows.reduce((n, r) => n + r.revenue, 0);
    const max = Math.max(total(data.today), total(data.yesterday), data.goal || 0, 1);
    return {
      today: paceLine(data.today, data.currentHour, max),
      yesterday: paceLine(data.yesterday, 23, max),
      goalY: data.goal > 0 ? H - (data.goal / max) * (H - 4) - 2 : null,
      nowX: ((data.currentHour + 1) / 24) * W,
    };
  }, [data]);

  const delta = data && data.yesterdaySameTime > 0 ? Math.round(((data.todayTotal - data.yesterdaySameTime) / data.yesterdaySameTime) * 100) : null;
  const pct = data?.goalProgress != null ? Math.round(data.goalProgress * 100) : null;

  return (
    <section aria-label="Day board" aria-busy={!data && !failed} title={data?.salesBasis}
      className="stall-board flex flex-shrink-0 flex-wrap items-stretch gap-x-6 gap-y-3 border-b border-[color:var(--stall-line)] px-5 py-3">
      <div className="min-w-[150px]">
        <div className="font-[family-name:var(--stall-font-hand)] text-[18px] leading-none text-[color:var(--stall-chalk-dim)]">Today</div>
        <div className="stall-chalk-text mt-0.5 font-[family-name:var(--stall-font-hand)] text-[40px] font-bold leading-none tabular-nums">{data ? money(data.todayTotal) : '—'}</div>
        <div className="mt-1.5 text-[12px] text-[color:var(--stall-chalk-dim)]">
          {data ? <>{data.todayOrders} sale{data.todayOrders === 1 ? '' : 's'}{delta !== null && <span className={cn('ml-1.5', delta >= 0 ? 'text-[color:var(--stall-leaf)]' : 'text-[color:var(--stall-tomato)]')}>{delta >= 0 ? '▲' : '▼'} {Math.abs(delta)}% vs this time yesterday</span>}{delta === null && data.yesterdayTotal === 0 && <span className="ml-1.5 text-[color:var(--stall-chalk-faint)]">· nothing sold yesterday</span>}</> : failed ? <span role="alert" className="text-[color:var(--stall-tomato)]">Board unavailable</span> : ' '}
        </div>
      </div>

      {chart && (
        <figure className="hidden items-end sm:flex" aria-label={`Pace: today ${money(data?.todayTotal)}, yesterday ${money(data?.yesterdayTotal)}`}>
          <svg viewBox={`0 0 ${W} ${H}`} width={W} height={H} className="overflow-visible">
            {chart.goalY !== null && <line x1={0} x2={W} y1={chart.goalY} y2={chart.goalY} stroke="var(--stall-brass)" strokeOpacity={0.5} strokeDasharray="2 4" />}
            <polyline points={chart.yesterday} fill="none" stroke="var(--stall-chalk-faint)" strokeWidth={1.5} strokeDasharray="4 4" strokeLinejoin="round" />
            <polyline points={chart.today} fill="none" stroke="var(--stall-chalk)" strokeWidth={2.25} strokeLinejoin="round" strokeLinecap="round" />
            <line x1={chart.nowX} x2={chart.nowX} y1={0} y2={H} stroke="var(--stall-chalk-faint)" strokeOpacity={0.4} />
          </svg>
          <figcaption className="ml-2 space-y-0.5 text-[11px] leading-tight text-[color:var(--stall-chalk-faint)]">
            <div><span className="text-[color:var(--stall-chalk)]">—</span> today</div>
            <div>- - yesterday {data ? money(data.yesterdayTotal) : ''}</div>
          </figcaption>
        </figure>
      )}

      <div className="flex min-w-[200px] items-center gap-3">
        <BellRing key={ringKey} className={cn('h-7 w-7 flex-shrink-0', pct !== null && pct >= 100 ? 'text-[color:var(--stall-brass)]' : 'text-[color:var(--stall-chalk-faint)]', ringing && 'stall-bell-ring')} aria-hidden />
        {editingGoal ? (
          <form onSubmit={(e) => { e.preventDefault(); saveGoal(); }} className="flex items-center gap-1.5">
            <input autoFocus type="number" min={0} step="1" inputMode="decimal" aria-label="Daily goal" value={goalInput} onChange={(e) => setGoalInput(e.target.value)} placeholder="0 = none"
              className="h-9 w-28 rounded-md border border-[color:var(--stall-line)] bg-black/20 px-2 font-[family-name:var(--stall-font-till)] text-[14px] text-[color:var(--stall-chalk)] focus:border-[color:var(--stall-brass)] focus:outline-none" />
            <button type="submit" disabled={goalBusy} className="h-9 rounded-md bg-[color:var(--stall-brass)] px-3 text-[12px] font-semibold text-[color:var(--stall-ink)]">{goalBusy ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : 'Set'}</button>
            <button type="button" onClick={() => setEditingGoal(false)} className="h-9 px-2 text-[12px] text-[color:var(--stall-chalk-dim)]">Cancel</button>
            {goalErr && <span role="alert" className="text-[12px] text-[color:var(--stall-tomato)]">{goalErr}</span>}
          </form>
        ) : (
          <button type="button" onClick={() => { setGoalInput(data?.goal ? String(data.goal) : ''); setEditingGoal(true); }} className="min-w-0 text-left" title="Set today's goal">
            {data && data.goal > 0 ? (
              <>
                <div className="font-[family-name:var(--stall-font-hand)] text-[18px] leading-none text-[color:var(--stall-chalk-dim)]">Goal {money(data.goal)}</div>
                <div className="mt-1.5 h-2 w-40 overflow-hidden rounded-full bg-black/30">
                  <div className={cn('h-full rounded-full transition-[width] duration-500', (pct ?? 0) >= 100 ? 'bg-[color:var(--stall-brass)]' : 'bg-[color:var(--stall-leaf)]')} style={{ width: `${pct ?? 0}%` }} />
                </div>
                <div className="mt-1 text-[12px] text-[color:var(--stall-chalk-dim)]">{(pct ?? 0) >= 100 ? 'Goal hit — ring that bell' : `${pct}% · ${money(Math.max(0, data.goal - data.todayTotal))} to go`}</div>
              </>
            ) : (
              <div className="font-[family-name:var(--stall-font-hand)] text-[20px] text-[color:var(--stall-chalk-dim)] underline decoration-dotted underline-offset-4">Chalk up today&rsquo;s goal</div>
            )}
          </button>
        )}
      </div>

      <div className="flex-1" />
      <button type="button" onClick={() => onNavigate('products', 'lowstock')} className="self-center rounded-md px-3 py-1.5 text-left hover:bg-white/[0.04]">
        <div className="font-[family-name:var(--stall-font-hand)] text-[18px] leading-none text-[color:var(--stall-chalk-dim)]">Running low</div>
        <div className={cn('mt-0.5 font-[family-name:var(--stall-font-hand)] text-[30px] font-bold leading-none', low ? 'text-[color:var(--stall-brass)]' : 'text-[color:var(--stall-chalk-faint)]')}>{low ?? '—'} <span className="font-sans text-[12px] text-[color:var(--stall-chalk-dim)]">crate{low === 1 ? '' : 's'}</span></div>
      </button>
    </section>
  );
}

export default DayBoard;
