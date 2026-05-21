'use client';

/**
 * PriorityMatrix — impact-vs-effort 2x2 grid (Productboard prioritization
 * matrix). Plots each open pain point into quick-wins / major-projects /
 * fill-ins / thankless quadrants. Data comes from the `priority-matrix` macro.
 */

import { useEffect, useState, useCallback } from 'react';
import { lensRun } from '@/lib/api/client';
import { Loader2, Grid2x2 } from 'lucide-react';

interface MatrixPoint {
  id: string;
  title: string;
  impact: number;
  effort: number;
  status: string;
  themeId: string | null;
}
interface MatrixResult {
  points: MatrixPoint[];
  quadrants: Record<string, MatrixPoint[]>;
  summary: { quickWins: number; majorProjects: number; fillIns: number; thankless: number };
}

const QUADRANTS = [
  { key: 'quick_wins', label: 'Quick Wins', sub: 'High impact · Low effort', tone: 'border-emerald-500/40 bg-emerald-500/[0.06]' },
  { key: 'major_projects', label: 'Major Projects', sub: 'High impact · High effort', tone: 'border-sky-500/40 bg-sky-500/[0.06]' },
  { key: 'fill_ins', label: 'Fill-ins', sub: 'Low impact · Low effort', tone: 'border-amber-500/40 bg-amber-500/[0.06]' },
  { key: 'thankless', label: 'Thankless', sub: 'Low impact · High effort', tone: 'border-rose-500/40 bg-rose-500/[0.06]' },
];

export function PriorityMatrix({ refreshKey }: { refreshKey: number }) {
  const [data, setData] = useState<MatrixResult | null>(null);
  const [loading, setLoading] = useState(true);
  const [err, setErr] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setErr(null);
    const res = await lensRun<MatrixResult>('suffering', 'priority-matrix', {});
    setLoading(false);
    if (!res.data.ok || !res.data.result) { setErr(res.data.error || 'Failed to load matrix'); return; }
    setData(res.data.result);
  }, []);

  useEffect(() => { load(); }, [load, refreshKey]);

  return (
    <div className="panel p-4">
      <h3 className="font-semibold flex items-center gap-2 mb-3">
        <Grid2x2 className="w-4 h-4 text-neon-purple" /> Prioritization Matrix
        {loading && <Loader2 className="w-4 h-4 animate-spin text-neon-cyan" />}
      </h3>
      {err && <p className="text-xs text-red-400 mb-2">{err}</p>}
      {data && data.points.length === 0 && (
        <p className="text-gray-500 text-sm text-center py-6">
          No open pain points to prioritize. Resolved items are excluded.
        </p>
      )}
      {data && data.points.length > 0 && (
        <>
          {/* Scatter plot */}
          <div className="relative w-full h-64 rounded-lg border border-white/10 bg-white/[0.02] mb-4">
            <div className="absolute inset-0 grid grid-cols-2 grid-rows-2 pointer-events-none">
              <div className="border-r border-b border-dashed border-white/10" />
              <div className="border-b border-dashed border-white/10" />
              <div className="border-r border-dashed border-white/10" />
              <div />
            </div>
            <span className="absolute left-1/2 -translate-x-1/2 bottom-1 text-[10px] text-gray-600">Effort →</span>
            <span className="absolute left-1 top-1/2 -translate-y-1/2 -rotate-90 text-[10px] text-gray-600">Impact →</span>
            {data.points.map((p) => {
              // impact 1..10 on Y (inverted), effort 1..10 on X.
              const x = ((p.effort - 1) / 9) * 88 + 6;
              const y = (1 - (p.impact - 1) / 9) * 84 + 6;
              const tone = p.impact >= 5
                ? (p.effort <= 5 ? '#22c55e' : '#06b6d4')
                : (p.effort <= 5 ? '#f59e0b' : '#f43f5e');
              return (
                <div
                  key={p.id}
                  className="absolute -translate-x-1/2 -translate-y-1/2 group"
                  style={{ left: `${x}%`, top: `${y}%` }}
                >
                  <div
                    className="w-3 h-3 rounded-full ring-2 ring-black/40"
                    style={{ backgroundColor: tone }}
                  />
                  <span className="absolute left-4 top-1/2 -translate-y-1/2 whitespace-nowrap text-[10px] text-gray-300 bg-black/80 px-1.5 py-0.5 rounded opacity-0 group-hover:opacity-100 transition-opacity z-10">
                    {p.title} (I{p.impact}/E{p.effort})
                  </span>
                </div>
              );
            })}
          </div>
          {/* Quadrant lists */}
          <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
            {QUADRANTS.map((q) => {
              const items = data.quadrants[q.key] || [];
              return (
                <div key={q.key} className={`rounded-lg border p-3 ${q.tone}`}>
                  <div className="flex items-center justify-between mb-1.5">
                    <span className="text-sm font-medium">{q.label}</span>
                    <span className="text-xs text-gray-400">{items.length}</span>
                  </div>
                  <p className="text-[10px] text-gray-500 mb-2">{q.sub}</p>
                  {items.length === 0 ? (
                    <p className="text-[11px] text-gray-600">—</p>
                  ) : (
                    <ul className="space-y-1">
                      {items.map((p) => (
                        <li key={p.id} className="text-xs text-gray-300 flex justify-between">
                          <span className="truncate">{p.title}</span>
                          <span className="text-gray-500 shrink-0 ml-2">I{p.impact}/E{p.effort}</span>
                        </li>
                      ))}
                    </ul>
                  )}
                </div>
              );
            })}
          </div>
        </>
      )}
    </div>
  );
}
