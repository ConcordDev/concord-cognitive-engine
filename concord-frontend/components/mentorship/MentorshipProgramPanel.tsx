'use client';

/**
 * MentorshipProgramPanel — MentorcliQ-style program admin: cohort tracking and
 * match-quality reporting. All data from the `mentorship` program-report macro.
 */

import { useCallback, useEffect, useState } from 'react';
import { Loader2, BarChart3, RefreshCw, Users } from 'lucide-react';
import { lensRun } from '@/lib/api/client';
import { ChartKit } from '@/components/viz';
import { cn } from '@/lib/utils';

interface CohortRow {
  mentorId: string;
  name: string;
  skills: string[];
  menteeCount: number;
  capacity: number;
  rating: number;
  reviewCount: number;
  utilization: number;
}
interface ProgramReport {
  mentors: number;
  activeMatches: number;
  requests: { total: number; accepted: number; declined: number; pending: number };
  matchAcceptanceRate: number;
  sessions: { total: number; completed: number };
  sessionCompletionRate: number;
  goals: { total: number; done: number };
  goalCompletionRate: number;
  avgSessionRating: number;
  avgMentorRating: number;
  cohort: CohortRow[];
}

export function MentorshipProgramPanel() {
  const [report, setReport] = useState<ProgramReport | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const refresh = useCallback(async () => {
    setLoading(true);
    const r = await lensRun('mentorship', 'program-report', {});
    if (r.data?.ok === false) { setError(r.data.error || 'Failed to load program report.'); }
    else { setReport((r.data?.result as ProgramReport) || null); setError(null); }
    setLoading(false);
  }, []);

  useEffect(() => { void refresh(); }, [refresh]);

  if (loading) {
    return <div className="flex justify-center py-8"><Loader2 className="w-5 h-5 animate-spin text-zinc-500" /></div>;
  }
  if (error || !report) {
    return <p className="text-sm text-red-400 text-center py-8">{error || 'No report available.'}</p>;
  }

  const kpis = [
    { label: 'Mentors', value: report.mentors, color: 'text-neon-blue' },
    { label: 'Active matches', value: report.activeMatches, color: 'text-neon-green' },
    { label: 'Match acceptance', value: `${report.matchAcceptanceRate}%`, color: 'text-neon-cyan' },
    { label: 'Session completion', value: `${report.sessionCompletionRate}%`, color: 'text-neon-purple' },
    { label: 'Goal completion', value: `${report.goalCompletionRate}%`, color: 'text-amber-400' },
    { label: 'Avg session rating', value: report.avgSessionRating > 0 ? `${report.avgSessionRating}/5` : '--', color: 'text-amber-400' },
  ];

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <h3 className="font-semibold flex items-center gap-2"><BarChart3 className="w-4 h-4 text-neon-purple" /> Program Report</h3>
        <button onClick={refresh} className="btn-secondary text-xs flex items-center gap-1">
          <RefreshCw className="w-3 h-3" /> Refresh
        </button>
      </div>

      <div className="grid grid-cols-2 md:grid-cols-3 gap-3">
        {kpis.map((k) => (
          <div key={k.label} className="lens-card text-center">
            <p className={cn('text-xl font-bold', k.color)}>{k.value}</p>
            <p className="text-xs text-zinc-400">{k.label}</p>
          </div>
        ))}
      </div>

      <div className="panel p-4">
        <h4 className="font-semibold text-sm mb-2">Request funnel</h4>
        <ChartKit
          kind="bar"
          xKey="stage"
          data={[
            { stage: 'Total', count: report.requests.total },
            { stage: 'Accepted', count: report.requests.accepted },
            { stage: 'Declined', count: report.requests.declined },
            { stage: 'Pending', count: report.requests.pending },
          ]}
          series={[{ key: 'count', label: 'Requests' }]}
        />
      </div>

      <div className="panel p-4">
        <h4 className="font-semibold text-sm flex items-center gap-2 mb-2">
          <Users className="w-4 h-4 text-neon-cyan" /> Cohort ({report.cohort.length} mentors)
        </h4>
        {report.cohort.length === 0 ? (
          <p className="text-xs text-zinc-500">No mentors in the program yet.</p>
        ) : (
          <div className="space-y-2">
            {report.cohort.map((c) => (
              <div key={c.mentorId} className="lens-card">
                <div className="flex items-center justify-between">
                  <span className="font-medium text-sm">{c.name}</span>
                  <span className="text-xs text-amber-400">{c.rating > 0 ? `${c.rating}★ (${c.reviewCount})` : 'unrated'}</span>
                </div>
                <div className="flex flex-wrap gap-1 my-1">
                  {c.skills.map((s) => <span key={s} className="text-[10px] px-1.5 py-0.5 rounded bg-zinc-800 text-zinc-300">{s}</span>)}
                </div>
                <div className="flex items-center gap-2">
                  <div className="flex-1 h-2 bg-lattice-deep rounded-full overflow-hidden">
                    <div className={cn('h-full rounded-full', c.utilization >= 80 ? 'bg-amber-400' : 'bg-neon-cyan')} style={{ width: `${Math.min(100, c.utilization)}%` }} />
                  </div>
                  <span className="text-[10px] font-mono text-zinc-400">{c.menteeCount}/{c.capacity} · {c.utilization}%</span>
                </div>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
