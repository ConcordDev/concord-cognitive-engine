'use client';
import { useCallback, useEffect, useState } from 'react';
import { macro } from './_macro';

export function CalendarPanel() {
  const [months, setMonths] = useState<Array<{ index: number; name: string; days: number; seasonIndex: number }>>([]);
  const [civic, setCivic] = useState<Array<{ idx: number; range: string; label: string }>>([]);
  const [yearDay, setYearDay] = useState(0);
  const refresh = useCallback(async () => {
    const [m, c] = await Promise.all([macro('tunyan', 'months'), macro('tunyan', 'civic_blocks')]);
    if (m?.ok) setMonths(m.months || []);
    if (c?.ok) setCivic(c.blocks || []);
  }, []);
  useEffect(() => { void refresh(); }, [refresh]);
  const currentMonth = months.find((m) => m.index === Math.floor(yearDay / 2.33) + 1);
  return (
    <div className="text-sm">
      <h3 className="text-xs uppercase tracking-wider text-zinc-400 mb-2">Tunyan 18-month ledger</h3>
      <label className="block mb-2">
        <span className="text-xs text-zinc-400">Year-day</span>
        <input type="range" min="0" max="41" value={yearDay} onChange={(e) => setYearDay(Number(e.target.value))} aria-label="Year day" className="ml-2 w-48" />
        <span className="ml-2 text-xs font-mono text-zinc-300">{yearDay}</span>
      </label>
      {currentMonth && <p className="text-xs text-amber-300 mb-2">Currently: <strong>{currentMonth.name}</strong> (season {currentMonth.seasonIndex})</p>}
      <ul className="grid grid-cols-3 gap-1 text-[10px] mb-3">
        {months.map((m) => (
          <li key={m.index} className={`border rounded p-1 ${currentMonth?.index === m.index ? 'bg-amber-950/40 border-amber-700' : 'bg-zinc-900/40 border-zinc-800'}`}>
            <span className="text-zinc-300">{m.name}</span><span className="ml-1 text-zinc-400">·{m.days}d</span>
          </li>
        ))}
      </ul>
      <h3 className="text-xs uppercase tracking-wider text-zinc-400 mb-2">Civic clock</h3>
      <ul className="grid grid-cols-2 gap-1 text-[10px]">
        {civic.map((b) => (
          <li key={b.idx} className="bg-zinc-900/40 border border-zinc-800 rounded p-1">
            <span className="text-zinc-300 font-mono">{b.range}</span>
            <span className="ml-1 text-zinc-400">{b.label}</span>
          </li>
        ))}
      </ul>
    </div>
  );
}
