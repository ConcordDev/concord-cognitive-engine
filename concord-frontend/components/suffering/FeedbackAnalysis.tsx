'use client';

/**
 * FeedbackAnalysis — bulk pain-point mapping from a raw feedback batch.
 *
 * This is the ORIGINAL `suffering` domain macro (`painPointMapping`) —
 * distinct from, and complementary to, the ongoing per-pain CRUD board
 * (`pain-list`/`pain-create`/`priority-matrix`) that the rest of this lens
 * is built on. `painPointMapping` takes a one-shot BATCH of raw feedback
 * (e.g. an imported support-ticket / survey / review export) and clusters
 * it by category with Pareto (80/20) analysis and a frequency-impact
 * quadrant breakdown — a "triage a pile of feedback" tool, not a tracker.
 *
 * The rebuild audit found this macro had ZERO frontend callers (fully
 * UNSURFACED) while a newer, simpler CRUD substrate silently took over the
 * lens. Rather than leave it dark, this panel surfaces it for real AND
 * bridges the two systems: each Pareto cluster can be "Promoted" into a
 * tracked pain point on the board via a real `pain-create` call, seeded
 * from the cluster's own computed severity/impact/frequency — so bulk
 * triage feeds the ongoing tracker instead of living in a disconnected
 * silo.
 */

import { useCallback, useState } from 'react';
import { lensRun } from '@/lib/api/client';
import { EmptyState } from '@/components/ui/EmptyState';
import {
  Plus, Trash2, Loader2, Inbox, PieChart, ArrowUpRight, TrendingUp, TrendingDown, Minus,
} from 'lucide-react';

interface FeedbackRow {
  key: string;
  text: string;
  category: string;
  severity: number;
  impact: number;
  timestamp: string;
}

interface PainPointCluster {
  category: string;
  count: number;
  frequency: number;
  avgSeverity: number;
  maxSeverity: number;
  avgImpact: number;
  painScore: number;
  percentOfTotal: number;
  cumulativePercent: number;
  inPareto80: boolean;
}
interface MappingResult {
  totalFeedbackItems: number;
  uniqueCategories: number;
  painPoints: PainPointCluster[];
  vitalFew: { categories: string[]; count: number; percentOfCategories: number; coversPercentOfPain: number };
  frequencyImpactMatrix: Record<string, string[]>;
  trends: Record<string, 'increasing' | 'decreasing' | 'stable'> | null;
  topPainPoint: PainPointCluster | null;
  message?: string;
}

let rowSeq = 0;
function blankRow(): FeedbackRow {
  rowSeq += 1;
  return { key: `fb_${rowSeq}`, text: '', category: '', severity: 5, impact: 5, timestamp: '' };
}

const TREND_ICON = { increasing: TrendingUp, decreasing: TrendingDown, stable: Minus } as const;
const TREND_TONE = { increasing: 'text-rose-400', decreasing: 'text-emerald-400', stable: 'text-gray-400' } as const;

export function FeedbackAnalysis({ onPromoted }: { onPromoted: () => void }) {
  const [rows, setRows] = useState<FeedbackRow[]>([blankRow(), blankRow(), blankRow()]);
  const [busy, setBusy] = useState(false);
  const [promoting, setPromoting] = useState<string | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [result, setResult] = useState<MappingResult | null>(null);

  const addRow = useCallback(() => setRows((r) => [...r, blankRow()]), []);
  const removeRow = useCallback((key: string) => setRows((r) => r.filter((x) => x.key !== key)), []);
  const updateRow = useCallback((key: string, patch: Partial<FeedbackRow>) => {
    setRows((r) => r.map((x) => (x.key === key ? { ...x, ...patch } : x)));
  }, []);

  const analyze = useCallback(async () => {
    const feedback = rows
      .filter((r) => r.text.trim())
      .map((r) => ({
        text: r.text.trim(),
        category: r.category.trim() || undefined,
        severity: r.severity,
        impact: r.impact,
        timestamp: r.timestamp || undefined,
      }));
    if (feedback.length === 0) { setErr('Add at least one feedback item with text.'); return; }
    setBusy(true);
    setErr(null);
    const res = await lensRun<MappingResult>('suffering', 'painPointMapping', { feedback });
    setBusy(false);
    if (!res.data.ok || !res.data.result) { setErr(res.data.error || 'Analysis failed'); return; }
    setResult(res.data.result);
  }, [rows]);

  const promote = useCallback(async (cluster: PainPointCluster) => {
    setPromoting(cluster.category);
    setErr(null);
    const trend = result?.trends?.[cluster.category];
    const res = await lensRun('suffering', 'pain-create', {
      title: `${cluster.category} (${cluster.count} reports)`,
      description: `Imported from feedback batch — Pareto ${cluster.percentOfTotal}% of total pain, cumulative ${cluster.cumulativePercent}%.${trend ? ` Trend: ${trend}.` : ''}`,
      severity: Math.round(cluster.avgSeverity),
      frequency: Math.max(1, Math.min(10, Math.round(cluster.frequency * 10))),
      impact: Math.round(cluster.avgImpact),
    });
    setPromoting(null);
    if (!res.data.ok) { setErr(res.data.error || 'Promote failed'); return; }
    onPromoted();
  }, [result, onPromoted]);

  return (
    <div className="space-y-4">
      <div className="panel p-4">
        <div className="flex items-center justify-between mb-3">
          <h3 className="font-semibold flex items-center gap-2">
            <Inbox className="w-4 h-4 text-amber-400" /> Feedback Batch Import
            {busy && <Loader2 className="w-4 h-4 animate-spin text-neon-cyan" />}
          </h3>
          <p className="text-xs text-gray-400">Pareto (80/20) + frequency-impact clustering — the <code>painPointMapping</code> macro</p>
        </div>
        <p className="text-xs text-gray-400 mb-3">
          Paste in raw feedback (support tickets, survey responses, reviews) and cluster it by
          category to find your vital few pain points — before deciding what to track individually.
        </p>
        {err && <p className="text-xs text-red-400 mb-2" role="alert">{err}</p>}

        <div className="space-y-2 mb-3">
          {rows.map((row) => (
            <div key={row.key} className="flex items-center gap-1.5 text-xs">
              <input
                value={row.text}
                onChange={(e) => updateRow(row.key, { text: e.target.value })}
                placeholder="Feedback text (e.g. checkout keeps failing on mobile)"
                className="flex-[3] bg-white/5 border border-white/10 rounded px-2 py-1.5"
              />
              <input
                value={row.category}
                onChange={(e) => updateRow(row.key, { category: e.target.value })}
                placeholder="Category"
                className="flex-1 bg-white/5 border border-white/10 rounded px-2 py-1.5"
              />
              <input
                type="number" min={1} max={10}
                value={row.severity}
                onChange={(e) => updateRow(row.key, { severity: Number(e.target.value) })}
                title="Severity 1-10"
                className="w-14 bg-white/5 border border-white/10 rounded px-1.5 py-1.5"
              />
              <input
                type="number" min={1} max={10}
                value={row.impact}
                onChange={(e) => updateRow(row.key, { impact: Number(e.target.value) })}
                title="Impact 1-10"
                className="w-14 bg-white/5 border border-white/10 rounded px-1.5 py-1.5"
              />
              <input
                type="date"
                value={row.timestamp}
                onChange={(e) => updateRow(row.key, { timestamp: e.target.value })}
                className="w-32 bg-white/5 border border-white/10 rounded px-1.5 py-1.5"
              />
              <button onClick={() => removeRow(row.key)} className="text-gray-600 hover:text-red-400 shrink-0" aria-label="Remove row">
                <Trash2 className="w-3.5 h-3.5" />
              </button>
            </div>
          ))}
        </div>
        <div className="flex items-center gap-2">
          <button
            onClick={addRow}
            className="flex items-center gap-1 px-2.5 py-1.5 bg-white/5 border border-white/10 rounded text-xs hover:bg-white/10"
          >
            <Plus className="w-3.5 h-3.5" /> Add row
          </button>
          <button
            onClick={analyze}
            disabled={busy}
            className="flex items-center gap-1.5 px-3 py-1.5 bg-amber-500/20 text-amber-300 rounded-lg text-sm hover:bg-amber-500/30 disabled:opacity-50"
          >
            <PieChart className="w-4 h-4" /> Analyze
          </button>
        </div>
      </div>

      {result && result.painPoints.length === 0 && (
        <EmptyState
          compact
          title="No categories to analyze."
          description={result.message || 'Add feedback with text to cluster.'}
        />
      )}

      {result && result.painPoints.length > 0 && (
        <div className="panel p-4 space-y-4">
          <div className="flex flex-wrap items-center gap-3 text-xs">
            <span className="px-2.5 py-1 rounded bg-white/5 border border-white/10">
              {result.totalFeedbackItems} items · {result.uniqueCategories} categories
            </span>
            {result.vitalFew.count > 0 && (
              <span className="px-2.5 py-1 rounded bg-rose-500/15 text-rose-300 border border-rose-500/30">
                Vital few: {result.vitalFew.categories.join(', ')} covers {result.vitalFew.coversPercentOfPain}% of pain
              </span>
            )}
          </div>

          <div className="space-y-1.5">
            {result.painPoints.map((c) => {
              const trend = result.trends?.[c.category];
              const TIcon = trend ? TREND_ICON[trend] : null;
              return (
                <div
                  key={c.category}
                  className={`flex items-center gap-2 p-2 rounded-lg border ${c.inPareto80 ? 'border-rose-500/30 bg-rose-500/[0.05]' : 'border-white/10 bg-white/[0.02]'}`}
                >
                  <span className="text-sm font-medium capitalize flex-1 truncate">{c.category}</span>
                  {TIcon && <TIcon className={`w-3.5 h-3.5 shrink-0 ${TREND_TONE[trend as keyof typeof TREND_TONE]}`} aria-label={trend} />}
                  <span className="text-[11px] text-gray-400 shrink-0">{c.count}×</span>
                  <span className="text-[11px] text-gray-400 shrink-0">S{c.avgSeverity.toFixed(1)}/I{c.avgImpact.toFixed(1)}</span>
                  <span className="text-xs font-bold text-neon-purple shrink-0" title="Pain score">{c.painScore.toFixed(2)}</span>
                  <span className="text-[11px] text-gray-400 shrink-0 w-14 text-right">{c.percentOfTotal}%</span>
                  <button
                    onClick={() => promote(c)}
                    disabled={promoting === c.category}
                    className="flex items-center gap-1 px-2 py-1 bg-neon-cyan/20 text-neon-cyan rounded text-[11px] hover:bg-neon-cyan/30 disabled:opacity-50 shrink-0"
                    title="Create a tracked pain point from this cluster"
                  >
                    {promoting === c.category ? <Loader2 className="w-3 h-3 animate-spin" /> : <ArrowUpRight className="w-3 h-3" />}
                    Promote
                  </button>
                </div>
              );
            })}
          </div>

          <div>
            <p className="text-xs text-gray-400 mb-1.5">Frequency-impact quadrants</p>
            <div className="grid grid-cols-2 gap-2 text-[11px]">
              {Object.entries(result.frequencyImpactMatrix).map(([q, cats]) => (
                <div key={q} className="rounded-lg bg-white/[0.03] border border-white/10 p-2">
                  <p className="capitalize font-medium mb-1">{q.replace(/([A-Z])/g, ' $1').trim()}</p>
                  <p className="text-gray-400">{cats.length ? cats.join(', ') : '—'}</p>
                </div>
              ))}
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
