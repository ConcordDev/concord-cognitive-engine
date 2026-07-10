'use client';

/**
 * CaseAnalytics — runs the real, deterministic `law.caseAnalysis` and
 * `law.deadlineTracker` macros over the user's actual Case Files (from
 * `CaseFiles`), instead of requiring a separate hand-authored JSON
 * artifact. This is what makes those two macros a DESIGNED feature
 * rather than a dead "paste JSON here" strip: the input is the real,
 * already-persisted case list.
 */

import { useMemo, useState } from 'react';
import { BarChart3, Loader2, Play, Gavel, Scale, AlertTriangle, Clock } from 'lucide-react';
import { useMacroDispatchFeedback } from '@/hooks/useMacroDispatchFeedback';
import { DataTable, EmptyState, StatTile, StatTileGrid } from '@/components/ui';
import type { DataTableColumn } from '@/components/ui';
import { ds } from '@/lib/design-system';
import { cn } from '@/lib/utils';
import type { CaseFileSummary } from './case-types';

interface CaseAnalysisResult {
  totalCases: number;
  openCases: number;
  closedCases: number;
  duration: { avgDays: number | null; medianDays: number | null; minDays: number | null; maxDays: number | null };
  typeBreakdown: { type: string; count: number; avgDurationDays: number | null; outcomes: Record<string, number> }[];
  outcomes: Record<string, number>;
  winRate: { wins: number; losses: number; decided: number; percentage: number | null };
  judgeStats: { judge: string; totalCases: number; wins: number; losses: number; winRate: number | null }[];
}

interface DeadlineTask {
  id: string;
  description: string;
  category: string;
  dueDate: string;
  daysRemaining: number | null;
  priority: 'overdue' | 'urgent' | 'warning' | 'on_track' | 'completed' | 'unknown';
  isCompleted: boolean;
}
interface DeadlineTrackerResult {
  summary: { total: number; overdue: number; urgent: number; upcoming: number; completed: number; avgDaysRemaining: number | null };
  allDeadlines: DeadlineTask[];
}

const PRIORITY_STYLE: Record<string, string> = {
  overdue: 'text-rose-300',
  urgent: 'text-amber-300',
  warning: 'text-yellow-300',
  on_track: 'text-emerald-300',
  completed: 'text-gray-500',
  unknown: 'text-gray-400',
};

export function CaseAnalytics({ cases }: { cases: CaseFileSummary[] }) {
  const analysis = useMacroDispatchFeedback<CaseAnalysisResult>();
  const deadlines = useMacroDispatchFeedback<DeadlineTrackerResult>();
  const [ran, setRan] = useState(false);

  const casesForMacro = useMemo(
    () =>
      cases.map((c) => ({
        id: c.id,
        type: c.caseType,
        filedDate: c.filedDate,
        closedDate: c.closedDate,
        outcome: c.outcome,
        parties: [],
        judge: c.judge || undefined,
      })),
    [cases]
  );

  const deadlinesForMacro = useMemo(
    () =>
      cases
        .filter((c) => c.deadline)
        .map((c) => ({
          id: c.id,
          description: c.title,
          dueDate: c.deadline,
          category: c.jurisdiction,
          status: c.status === 'closed' ? 'completed' : 'open',
        })),
    [cases]
  );

  async function runBoth() {
    setRan(true);
    await Promise.all([
      analysis.dispatch('law', 'caseAnalysis', { cases: casesForMacro }),
      deadlines.dispatch('law', 'deadlineTracker', { deadlines: deadlinesForMacro }),
    ]);
  }

  const analysisBusy = analysis.status === 'dispatched' || analysis.status === 'running';
  const deadlinesBusy = deadlines.status === 'dispatched' || deadlines.status === 'running';
  const busy = analysisBusy || deadlinesBusy;

  const typeColumns: DataTableColumn<CaseAnalysisResult['typeBreakdown'][number]>[] = [
    { id: 'type', header: 'Case type', accessor: (r) => <span className="capitalize">{r.type.replace('-', ' ')}</span>, sortable: true, sortValue: (r) => r.type },
    { id: 'count', header: 'Count', accessor: (r) => r.count, align: 'right', sortable: true, sortValue: (r) => r.count, monospace: true },
    { id: 'avgDuration', header: 'Avg duration', accessor: (r) => (r.avgDurationDays != null ? `${r.avgDurationDays}d` : '—'), align: 'right', monospace: true },
    { id: 'outcomes', header: 'Outcomes', accessor: (r) => Object.entries(r.outcomes).map(([k, v]) => `${k}:${v}`).join(', ') || '—' },
  ];

  const judgeColumns: DataTableColumn<CaseAnalysisResult['judgeStats'][number]>[] = [
    { id: 'judge', header: 'Judge', accessor: (r) => r.judge, sortable: true, sortValue: (r) => r.judge },
    { id: 'total', header: 'Cases', accessor: (r) => r.totalCases, align: 'right', monospace: true, sortable: true, sortValue: (r) => r.totalCases },
    { id: 'wins', header: 'Won', accessor: (r) => r.wins, align: 'right', monospace: true },
    { id: 'losses', header: 'Lost', accessor: (r) => r.losses, align: 'right', monospace: true },
    { id: 'winRate', header: 'Win rate', accessor: (r) => (r.winRate != null ? `${r.winRate}%` : '—'), align: 'right', monospace: true, sortable: true, sortValue: (r) => r.winRate ?? -1 },
  ];

  const deadlineColumns: DataTableColumn<DeadlineTask>[] = [
    { id: 'description', header: 'Case', accessor: (r) => r.description, sortable: true, sortValue: (r) => r.description },
    { id: 'category', header: 'Jurisdiction', accessor: (r) => r.category },
    { id: 'due', header: 'Due', accessor: (r) => r.dueDate, monospace: true, sortable: true, sortValue: (r) => r.dueDate },
    {
      id: 'priority',
      header: 'Urgency',
      accessor: (r) => (
        <span className={cn('font-medium capitalize', PRIORITY_STYLE[r.priority])}>
          {r.priority === 'overdue' && r.daysRemaining != null ? `${Math.abs(r.daysRemaining)}d overdue` : r.priority.replace('_', ' ')}
        </span>
      ),
      align: 'right',
      sortable: true,
      sortValue: (r) => r.daysRemaining ?? 9999,
    },
  ];

  if (cases.length === 0) {
    return (
      <EmptyState
        icon={<BarChart3 className="h-5 w-5" aria-hidden="true" />}
        title="No case files to analyze yet."
        description="Add cases in the Case Files tab — analytics runs the real caseAnalysis / deadlineTracker macros over your real matters, never sample data."
        ariaLabel="Case analytics empty"
      />
    );
  }

  return (
    <div className={cn(ds.panel, 'space-y-4')}>
      <div className="flex items-center gap-2">
        <BarChart3 className="w-4 h-4 text-neon-purple" />
        <h2 className="font-semibold text-white">Case Analysis &amp; Deadline Triage</h2>
        <span className="text-[10px] text-gray-400">{cases.length} case{cases.length === 1 ? '' : 's'} on file</span>
        <button
          onClick={runBoth}
          disabled={busy}
          className="ml-auto px-3 py-1.5 text-xs rounded bg-neon-purple/20 text-neon-purple hover:bg-neon-purple/30 disabled:opacity-50 inline-flex items-center gap-1.5"
        >
          {busy ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Play className="w-3.5 h-3.5" />}
          {busy ? 'Computing…' : 'Run analysis'}
        </button>
      </div>

      {(analysis.status === 'error' || deadlines.status === 'error') && (
        <p className="text-xs text-rose-400" role="alert">{analysis.error || deadlines.error}</p>
      )}

      {!ran && !busy && (
        <p className="text-xs text-gray-400">Click &quot;Run analysis&quot; to compute win-rate, duration, and deadline urgency over your real case files.</p>
      )}

      {analysis.status === 'done' && analysis.result && (
        <div className="space-y-3">
          <div className="flex items-center gap-1.5 text-xs text-gray-400">
            <Scale className="w-3.5 h-3.5 text-neon-purple" /> Case analysis
          </div>
          <StatTileGrid columns={5}>
            <StatTile label="Total" value={analysis.result.totalCases} />
            <StatTile label="Open" value={analysis.result.openCases} />
            <StatTile label="Closed" value={analysis.result.closedCases} />
            <StatTile
              label="Win rate"
              value={analysis.result.winRate.percentage ?? 0}
              unit="%"
              caption={`${analysis.result.winRate.decided} decided`}
              tone={analysis.result.winRate.percentage == null ? 'neutral' : analysis.result.winRate.percentage >= 50 ? 'positive' : 'negative'}
            />
            <StatTile label="Avg duration" value={analysis.result.duration.avgDays ?? 0} unit="d" caption="filed → closed/now" />
          </StatTileGrid>

          {analysis.result.typeBreakdown.length > 0 && (
            <DataTable columns={typeColumns} rows={analysis.result.typeBreakdown} getRowId={(r) => r.type} density="compact" caption="By case type" />
          )}
          {analysis.result.judgeStats.length > 0 && (
            <div>
              <p className="text-[11px] uppercase tracking-wide text-gray-400 mb-1 flex items-center gap-1"><Gavel className="w-3 h-3" />By judge</p>
              <DataTable columns={judgeColumns} rows={analysis.result.judgeStats} getRowId={(r) => r.judge} density="compact" caption="By judge" />
            </div>
          )}
        </div>
      )}

      {deadlines.status === 'done' && deadlines.result && (
        <div className="space-y-2 pt-2 border-t border-white/10">
          <div className="flex items-center gap-1.5 text-xs text-gray-400">
            <Clock className="w-3.5 h-3.5 text-amber-300" /> Deadline triage
          </div>
          <StatTileGrid columns={4}>
            <StatTile label="Overdue" value={deadlines.result.summary.overdue} tone={deadlines.result.summary.overdue > 0 ? 'negative' : 'positive'} />
            <StatTile label="Urgent (≤7d)" value={deadlines.result.summary.urgent} tone={deadlines.result.summary.urgent > 0 ? 'negative' : 'neutral'} />
            <StatTile label="Upcoming" value={deadlines.result.summary.upcoming} />
            <StatTile label="Completed" value={deadlines.result.summary.completed} tone="positive" />
          </StatTileGrid>
          {deadlines.result.allDeadlines.length === 0 ? (
            <EmptyState compact icon={<AlertTriangle className="h-5 w-5" aria-hidden="true" />} title="No cases carry a filing deadline." ariaLabel="Deadlines empty" />
          ) : (
            <DataTable columns={deadlineColumns} rows={deadlines.result.allDeadlines} getRowId={(r) => r.id} density="compact" defaultSort={{ columnId: 'priority', direction: 'asc' }} caption="Deadline urgency" />
          )}
        </div>
      )}
    </div>
  );
}
