'use client';

/**
 * FashionTrendSandboxPanel — honest sandbox for fashion.trendAnalysis.
 *
 * There is no live fashion-trend feed wired into the backend (the macro
 * only computes over whatever `trends` array the caller supplies — see
 * `server/domains/fashion.js#trendAnalysis`). Rather than faking a "Hot
 * Right Now" feed off no real data source, this panel is honestly labeled
 * as a sandbox: the user enters their own trend observations (from a
 * magazine, a runway report, their own market research) as structured
 * rows, and the analysis runs for real over exactly what they entered.
 */

import { useState } from 'react';
import { Loader2, Plus, TrendingUp, Trash2, BarChart3 } from 'lucide-react';
import { lensRun } from '@/lib/api/client';
import { cn } from '@/lib/utils';

interface TrendRow { name: string; category: string; popularity: number; trending: boolean }
interface CategoryBreakdown { category: string; count: number; trending: number }
interface AnalysisResult { totalTrends: number; categories: number; byCategory: CategoryBreakdown[]; hottest: string }

const CATEGORIES = ['Tops', 'Bottoms', 'Dresses', 'Outerwear', 'Shoes', 'Accessories', 'Activewear', 'Formal'];

export function FashionTrendSandboxPanel() {
  const [rows, setRows] = useState<TrendRow[]>([]);
  const [form, setForm] = useState<TrendRow>({ name: '', category: 'Tops', popularity: 50, trending: true });
  const [result, setResult] = useState<AnalysisResult | null>(null);
  const [analyzing, setAnalyzing] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const addRow = () => {
    if (!form.name.trim()) { setError('Trend name is required.'); return; }
    setRows((r) => [...r, { ...form, name: form.name.trim() }]);
    setForm({ name: '', category: form.category, popularity: 50, trending: true });
    setError(null);
  };
  const removeRow = (idx: number) => setRows((r) => r.filter((_, i) => i !== idx));

  const analyze = async () => {
    if (rows.length === 0) { setError('Add at least one trend row to analyze.'); return; }
    setAnalyzing(true); setError(null);
    const r = await lensRun('fashion', 'trendAnalysis', { trends: rows });
    setAnalyzing(false);
    if (r.data?.ok === false) { setError(r.data?.error || 'Failed'); return; }
    setResult((r.data?.result as AnalysisResult) || null);
  };

  return (
    <div className="space-y-3">
      <div className="flex items-start gap-2 bg-amber-950/20 border border-amber-900/40 rounded-lg px-3 py-2">
        <TrendingUp className="w-3.5 h-3.5 text-amber-400 shrink-0 mt-0.5" />
        <p className="text-[11px] text-amber-200/90">
          No live trend feed is connected. Enter your own observations below (from a
          runway report, a magazine, your own research) and this computes real
          category/hotness breakdowns over exactly what you enter — nothing is fabricated.
        </p>
      </div>

      {error && <div className="text-xs text-rose-400 bg-rose-950/40 border border-rose-900/50 rounded-lg px-3 py-2">{error}</div>}

      <div className="grid grid-cols-5 gap-2 bg-zinc-900/70 border border-zinc-800 rounded-xl p-3">
        <input value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} placeholder="Trend name…"
          className="col-span-2 bg-zinc-950 border border-zinc-700 rounded-lg px-2 py-1.5 text-xs text-zinc-100" />
        <select value={form.category} onChange={(e) => setForm({ ...form, category: e.target.value })}
          className="bg-zinc-950 border border-zinc-700 rounded-lg px-2 py-1.5 text-xs text-zinc-100">
          {CATEGORIES.map((c) => <option key={c} value={c}>{c}</option>)}
        </select>
        <label className="flex items-center gap-1.5 text-[11px] text-zinc-400">
          Popularity
          <input type="number" min={0} max={100} value={form.popularity}
            onChange={(e) => setForm({ ...form, popularity: Math.max(0, Math.min(100, Number(e.target.value) || 0)) })}
            className="w-14 bg-zinc-950 border border-zinc-700 rounded-lg px-2 py-1 text-xs text-zinc-100" />
        </label>
        <label className="flex items-center gap-1.5 text-[11px] text-zinc-400">
          <input type="checkbox" checked={form.trending} onChange={(e) => setForm({ ...form, trending: e.target.checked })} />
          Trending
        </label>
        <button type="button" onClick={addRow}
          className="col-span-5 flex items-center justify-center gap-1 bg-zinc-800 hover:bg-zinc-700 text-zinc-200 text-xs font-medium rounded-lg px-2 py-1.5">
          <Plus className="w-3.5 h-3.5" /> Add trend row
        </button>
      </div>

      {rows.length > 0 && (
        <ul className="space-y-1">
          {rows.map((row, idx) => (
            <li key={idx} className="flex items-center justify-between bg-zinc-900/70 border border-zinc-800 rounded-lg px-3 py-1.5">
              <span className="text-xs text-zinc-200">
                {row.name} <span className="text-zinc-500">· {row.category} · {row.popularity}%{row.trending ? ' · trending' : ''}</span>
              </span>
              <button aria-label={`Remove ${row.name}`} type="button" onClick={() => removeRow(idx)} className="text-zinc-600 hover:text-rose-400">
                <Trash2 className="w-3.5 h-3.5" />
              </button>
            </li>
          ))}
        </ul>
      )}

      <button type="button" onClick={analyze} disabled={analyzing || rows.length === 0}
        className="w-full flex items-center justify-center gap-1.5 bg-fuchsia-600 hover:bg-fuchsia-500 disabled:opacity-50 text-white text-xs font-medium rounded-lg px-2 py-2">
        {analyzing ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <BarChart3 className="w-3.5 h-3.5" />}
        Analyze {rows.length} trend{rows.length === 1 ? '' : 's'}
      </button>

      {result && (
        <div className="bg-zinc-900/70 border border-zinc-800 rounded-xl p-3 space-y-2">
          <div className="grid grid-cols-3 gap-2 text-center">
            <div><p className="text-sm font-bold text-zinc-100">{result.totalTrends}</p><p className="text-[10px] text-zinc-400">Total</p></div>
            <div><p className="text-sm font-bold text-zinc-100">{result.categories}</p><p className="text-[10px] text-zinc-400">Categories</p></div>
            <div><p className="text-sm font-bold text-fuchsia-300 truncate">{result.hottest}</p><p className="text-[10px] text-zinc-400">Hottest</p></div>
          </div>
          {result.byCategory.length > 0 && (
            <div className="space-y-1">
              {result.byCategory.map((c) => (
                <div key={c.category} className="flex items-center gap-2 text-[11px]">
                  <span className="w-20 text-zinc-400 truncate">{c.category}</span>
                  <div className="flex-1 h-1.5 bg-zinc-800 rounded-full overflow-hidden">
                    <div className={cn('h-full bg-fuchsia-500/70 rounded-full')}
                      style={{ width: `${Math.min(100, (c.count / (result.totalTrends || 1)) * 100)}%` }} />
                  </div>
                  <span className="text-zinc-200 w-6 text-right">{c.count}</span>
                  <span className="text-emerald-400 w-16 text-right">{c.trending} hot</span>
                </div>
              ))}
            </div>
          )}
        </div>
      )}
    </div>
  );
}
