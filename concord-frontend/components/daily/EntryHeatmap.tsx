'use client';

/**
 * EntryHeatmap — Day One-style streak grid. A GitHub-contributions-shaped
 * calendar heatmap of journaling activity, coloured by entry count and
 * tinted by average mood. Wires the daily.entry-heatmap macro.
 */

import { useCallback, useEffect, useState } from 'react';
import { CalendarDays, Flame, Loader2 } from 'lucide-react';
import { lensRun } from '@/lib/api/client';
import { cn } from '@/lib/utils';

interface HeatCell { date: string; count: number; avgMood: number | null; intensity: number }
interface HeatResult { cells: HeatCell[]; days: number; writtenDays: number; longestStreak: number; coverage: number }

const RANGES = [
  { label: '3 months', days: 91 },
  { label: '6 months', days: 182 },
  { label: 'Year', days: 365 },
];

const INTENSITY_BG = [
  'bg-zinc-800/60',
  'bg-rose-900/50',
  'bg-rose-700/60',
  'bg-rose-600/70',
  'bg-rose-500',
];

export function EntryHeatmap({ refreshKey = 0 }: { refreshKey?: number }) {
  const [data, setData] = useState<HeatResult | null>(null);
  const [days, setDays] = useState(182);
  const [loading, setLoading] = useState(true);
  const [hover, setHover] = useState<HeatCell | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    const r = await lensRun<HeatResult>('daily', 'entry-heatmap', { days });
    if (r.data?.ok && r.data.result) setData(r.data.result);
    setLoading(false);
  }, [days]);

  useEffect(() => { void load(); }, [load, refreshKey]);

  // group cells into week columns (7 rows). first cell may not be Sunday;
  // pad the leading week so each column is a calendar week.
  const cells = data?.cells || [];
  const columns: (HeatCell | null)[][] = [];
  if (cells.length > 0) {
    const lead = new Date(cells[0].date + 'T12:00:00').getDay();
    let col: (HeatCell | null)[] = Array(lead).fill(null);
    for (const c of cells) {
      col.push(c);
      if (col.length === 7) { columns.push(col); col = []; }
    }
    if (col.length > 0) { while (col.length < 7) col.push(null); columns.push(col); }
  }

  return (
    <div>
      <div className="flex items-center gap-2 mb-3">
        <CalendarDays className="w-4 h-4 text-rose-400" />
        <h3 className="text-sm font-bold text-zinc-100">Streak grid</h3>
        <div className="ml-auto flex gap-1">
          {RANGES.map((r) => (
            <button key={r.days} onClick={() => setDays(r.days)}
              className={cn('px-2 py-0.5 text-[11px] rounded',
                days === r.days ? 'bg-rose-600 text-white' : 'bg-zinc-800 text-zinc-400 hover:text-zinc-200')}>
              {r.label}
            </button>
          ))}
        </div>
      </div>

      {loading ? (
        <div className="flex items-center justify-center py-8 text-zinc-500"><Loader2 className="w-4 h-4 animate-spin" /></div>
      ) : !data || cells.length === 0 ? (
        <p className="text-xs text-zinc-500 italic text-center py-6">No journaling activity yet.</p>
      ) : (
        <>
          <div className="grid grid-cols-3 gap-2 mb-3">
            <Stat label="Days written" value={data.writtenDays} />
            <Stat label="Longest streak" value={data.longestStreak} flame={data.longestStreak > 0} />
            <Stat label="Coverage" value={`${data.coverage}%`} />
          </div>
          <div className="overflow-x-auto pb-1">
            <div className="flex gap-[3px]" style={{ minWidth: 'min-content' }}>
              {columns.map((col, ci) => (
                <div key={ci} className="flex flex-col gap-[3px]">
                  {col.map((cell, ri) => (
                    <div
                      key={ri}
                      onMouseEnter={() => cell && setHover(cell)}
                      onMouseLeave={() => setHover(null)}
                      className={cn('w-[11px] h-[11px] rounded-[2px]',
                        cell ? INTENSITY_BG[cell.intensity] : 'bg-transparent',
                        cell && 'hover:ring-1 hover:ring-rose-400')}
                      title={cell ? `${cell.date}: ${cell.count} entr${cell.count === 1 ? 'y' : 'ies'}` : undefined}
                    />
                  ))}
                </div>
              ))}
            </div>
          </div>
          <div className="flex items-center justify-between mt-2">
            <p className="text-[11px] text-zinc-500 h-4">
              {hover ? `${hover.date} — ${hover.count} entr${hover.count === 1 ? 'y' : 'ies'}${hover.avgMood != null ? ` · mood ${hover.avgMood}` : ''}` : ''}
            </p>
            <div className="flex items-center gap-1 text-[10px] text-zinc-500">
              <span>Less</span>
              {INTENSITY_BG.map((bg, i) => <span key={i} className={cn('w-[10px] h-[10px] rounded-[2px]', bg)} />)}
              <span>More</span>
            </div>
          </div>
        </>
      )}
    </div>
  );
}

function Stat({ label, value, flame }: { label: string; value: number | string; flame?: boolean }) {
  return (
    <div className="bg-zinc-900/60 border border-zinc-800 rounded-lg px-2 py-1.5 text-center">
      <p className="text-base font-bold text-zinc-100 inline-flex items-center gap-1">
        {flame && <Flame className="w-3.5 h-3.5 text-orange-400" />}{value}
      </p>
      <p className="text-[9px] text-zinc-500 uppercase tracking-wide">{label}</p>
    </div>
  );
}
