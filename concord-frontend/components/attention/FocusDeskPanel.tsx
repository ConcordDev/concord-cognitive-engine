'use client';

/**
 * Focus desk — Pomodoro/planner toolkit + computational macros
 * (focusScore / priorityMatrix / attentionBudget). Extracted from the
 * welded attention page; every macro call preserved.
 */

import { useEffect, useState } from 'react';
import { lensRun } from '@/lib/api/client';
import {
  Focus, Zap, Loader2, XCircle, BarChart3, Target, Gauge, AlertTriangle,
} from 'lucide-react';
import { motion } from 'framer-motion';
import { FocusToolkit } from '@/components/attention/FocusToolkit';

export function FocusDeskPanel() {
  const [actionResult, setActionResult] = useState<Record<string, unknown> | null>(null);
  const [isRunning, setIsRunning] = useState<string | null>(null);
  const [hasSessions, setHasSessions] = useState(false);
  const [hasPlannerTasks, setHasPlannerTasks] = useState(false);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      const [stats, plan] = await Promise.all([
        lensRun('attention', 'pomodoroStats', {}),
        lensRun('attention', 'plannerGet', {}),
      ]);
      if (cancelled) return;
      setHasSessions(((stats.data?.result as { recentSessions?: unknown[] } | null)?.recentSessions?.length || 0) > 0);
      setHasPlannerTasks((((plan.data?.result as { day?: { tasks?: unknown[] } } | null)?.day?.tasks?.length) || 0) > 0);
    })();
    return () => { cancelled = true; };
  }, [actionResult]);

  const handleAttentionAction = async (action: string) => {
    setIsRunning(action);
    try {
      if (action === 'focusScore') {
        const stats = await lensRun('attention', 'pomodoroStats', {});
        const recent = (stats.data?.result as { recentSessions?: Array<Record<string, unknown>> } | null)?.recentSessions || [];
        const sessions = recent.map((s) => ({
          id: s.id, taskId: s.taskId, startTime: s.startedAt, endTime: s.endedAt,
          interruptions: s.interruptions, deepWork: s.deepWork,
        }));
        const r = await lensRun('attention', 'focusScore', { sessions });
        setActionResult((r.data?.result as Record<string, unknown>) || { message: r.data?.error || 'Action failed' });
      } else {
        const plan = await lensRun('attention', 'plannerGet', {});
        const day = (plan.data?.result as { day?: { tasks?: Array<Record<string, unknown>> } } | null)?.day;
        const nowMinute = new Date().getHours() * 60 + new Date().getMinutes();
        const tasks = (day?.tasks || []).map((t) => {
          const priority = Number(t.priority ?? 0.5);
          const startMinute = Number(t.startMinute ?? nowMinute);
          const durationMinutes = Number(t.durationMinutes ?? 60);
          const minutesUntilStart = startMinute - nowMinute;
          const urgency = Math.max(0, Math.min(10, minutesUntilStart <= 0 ? 9 : 10 - minutesUntilStart / 60));
          return {
            id: t.id, name: t.name,
            importance: Math.round(priority * 10 * 10) / 10,
            urgency: Math.round(urgency * 10) / 10,
            effort: Math.max(0.25, Math.round((durationMinutes / 60) * 100) / 100),
            cognitiveLoad: Math.max(1, Math.min(10, Math.round(1 + priority * 9))),
            estimatedMinutes: durationMinutes,
            priority: Math.max(1, Math.min(10, Math.round(1 + priority * 9))),
          };
        });
        const r = await lensRun('attention', action, { tasks });
        setActionResult((r.data?.result as Record<string, unknown>) || { message: r.data?.error || 'Action failed' });
      }
    } catch (e) {
      console.error(`Action ${action} failed:`, e);
      setActionResult({ message: `Action failed: ${e instanceof Error ? e.message : 'Unknown error'}` });
    }
    setIsRunning(null);
  };

  return (
    <div className="space-y-6">
      <section data-tour="focus-toolkit">
        <h2 className="mb-3 flex items-center gap-2 text-lg font-bold text-white">
          <Focus className="h-5 w-5 text-neon-cyan" /> Focus Toolkit
        </h2>
        <FocusToolkit />
      </section>

      <div className="panel p-4">
        <h3 className="font-semibold text-white mb-4 flex items-center gap-2">
          <Zap className="w-4 h-4 text-neon-yellow" /> Computational Actions
        </h3>
        <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
          <button
            onClick={() => handleAttentionAction('focusScore')}
            disabled={isRunning !== null || !hasSessions}
            title={hasSessions ? undefined : 'Complete a focus session in the Focus Toolkit above first'}
            className="flex flex-col items-center gap-2 p-3 bg-lattice-bg rounded-lg border border-lattice-border hover:border-neon-cyan/50 transition-colors disabled:opacity-50"
          >
            {isRunning === 'focusScore' ? <Loader2 className="w-5 h-5 text-neon-cyan animate-spin" /> : <Focus className="w-5 h-5 text-neon-cyan" />}
            <span className="text-xs text-gray-300">Focus Score</span>
          </button>
          <button
            onClick={() => handleAttentionAction('priorityMatrix')}
            disabled={isRunning !== null || !hasPlannerTasks}
            title={hasPlannerTasks ? undefined : "Add a task to today's planner in the Focus Toolkit above first"}
            className="flex flex-col items-center gap-2 p-3 bg-lattice-bg rounded-lg border border-lattice-border hover:border-neon-purple/50 transition-colors disabled:opacity-50"
          >
            {isRunning === 'priorityMatrix' ? <Loader2 className="w-5 h-5 text-neon-purple animate-spin" /> : <Target className="w-5 h-5 text-neon-purple" />}
            <span className="text-xs text-gray-300">Priority Matrix</span>
          </button>
          <button
            onClick={() => handleAttentionAction('attentionBudget')}
            disabled={isRunning !== null || !hasPlannerTasks}
            title={hasPlannerTasks ? undefined : "Add a task to today's planner in the Focus Toolkit above first"}
            className="flex flex-col items-center gap-2 p-3 bg-lattice-bg rounded-lg border border-lattice-border hover:border-neon-green/50 transition-colors disabled:opacity-50"
          >
            {isRunning === 'attentionBudget' ? <Loader2 className="w-5 h-5 text-neon-green animate-spin" /> : <Gauge className="w-5 h-5 text-neon-green" />}
            <span className="text-xs text-gray-300">Attention Budget</span>
          </button>
        </div>
        {(!hasSessions || !hasPlannerTasks) && (
          <p className="text-xs text-gray-400 mt-3 text-center">
            {!hasSessions && !hasPlannerTasks
              ? 'Start a Pomodoro session and add a planner task in the Focus Toolkit above to unlock these.'
              : !hasSessions
                ? 'Complete a Pomodoro focus session above to unlock Focus Score.'
                : "Add a task to today's planner above to unlock Priority Matrix and Attention Budget."}
          </p>
        )}
      </div>

      {actionResult && (
        <motion.div
          initial={{ opacity: 0, y: 8 }}
          animate={{ opacity: 1, y: 0 }}
          className="panel p-4"
        >
          <div className="flex items-center justify-between mb-3">
            <h3 className="font-semibold text-white flex items-center gap-2">
              <BarChart3 className="w-4 h-4 text-neon-cyan" /> Action Result
            </h3>
            <button onClick={() => setActionResult(null)} className="text-gray-400 hover:text-white" aria-label="Close result">
              <XCircle className="w-4 h-4" />
            </button>
          </div>

          {actionResult.focusScore !== undefined && (
            <div className="space-y-3">
              <div className="flex items-center gap-3">
                <div className="text-4xl font-bold text-neon-cyan">{actionResult.focusScore as number}</div>
                <div>
                  <span className={`text-sm font-medium px-2 py-0.5 rounded capitalize ${
                    (actionResult.focusLevel as string) === 'excellent' ? 'bg-green-500/20 text-green-400' :
                    (actionResult.focusLevel as string) === 'good' ? 'bg-blue-500/20 text-blue-400' :
                    (actionResult.focusLevel as string) === 'moderate' ? 'bg-yellow-500/20 text-yellow-400' :
                    'bg-red-500/20 text-red-400'
                  }`}>
                    {actionResult.focusLevel as string}
                  </span>
                  <p className="text-xs text-gray-400 mt-1">{actionResult.sessionCount as number} sessions analyzed</p>
                </div>
              </div>
              <div className="grid grid-cols-2 md:grid-cols-4 gap-2">
                <div className="p-2 bg-lattice-bg rounded text-center">
                  <p className="text-sm font-bold text-neon-green">{(actionResult.deepWork as Record<string, unknown>)?.ratio as number}%</p>
                  <p className="text-[10px] text-gray-400">Deep Work Ratio</p>
                </div>
                <div className="p-2 bg-lattice-bg rounded text-center">
                  <p className="text-sm font-bold text-neon-blue">{(actionResult.interruptions as Record<string, unknown>)?.perHour as number}/hr</p>
                  <p className="text-[10px] text-gray-400">Interruptions</p>
                </div>
                <div className="p-2 bg-lattice-bg rounded text-center">
                  <p className="text-sm font-bold text-neon-purple">{(actionResult.contextSwitching as Record<string, unknown>)?.switches as number}</p>
                  <p className="text-[10px] text-gray-400">Context Switches</p>
                </div>
                <div className="p-2 bg-lattice-bg rounded text-center">
                  <p className="text-sm font-bold text-neon-yellow">{actionResult.longestUninterruptedStreak as number}m</p>
                  <p className="text-[10px] text-gray-400">Longest Streak</p>
                </div>
              </div>
              {(actionResult.componentScores as Record<string, number>) && (
                <div className="pt-2 border-t border-lattice-border">
                  <p className="text-xs text-gray-400 mb-2">Component Scores</p>
                  <div className="grid grid-cols-2 md:grid-cols-4 gap-2">
                    {Object.entries(actionResult.componentScores as Record<string, number>).map(([key, val]) => (
                      <div key={key} className="text-center">
                        <p className="text-sm font-bold text-gray-200">{val}</p>
                        <p className="text-[10px] text-gray-400 capitalize">{key.replace(/Score$/, '').replace(/([A-Z])/g, ' $1').trim()}</p>
                      </div>
                    ))}
                  </div>
                </div>
              )}
            </div>
          )}

          {actionResult.quadrants !== undefined && (
            <div className="space-y-3">
              <div className="flex items-center justify-between">
                <span className="text-sm text-gray-300">{actionResult.taskCount as number} tasks ranked</span>
                <span className="text-xs text-gray-400">Eisenhower Matrix</span>
              </div>
              <div className="grid grid-cols-2 gap-2">
                {(['do-first', 'schedule', 'delegate', 'eliminate'] as const).map((q) => {
                  const quad = (actionResult.quadrants as Record<string, { count: number; tasks: Array<{ name: string; priorityScore: number }> }>)[q];
                  const colors: Record<string, string> = {
                    'do-first': 'border-red-500/40 bg-red-500/5',
                    'schedule': 'border-blue-500/40 bg-blue-500/5',
                    'delegate': 'border-yellow-500/40 bg-yellow-500/5',
                    'eliminate': 'border-gray-500/40 bg-gray-500/5',
                  };
                  const labels: Record<string, string> = {
                    'do-first': 'Do First',
                    'schedule': 'Schedule',
                    'delegate': 'Delegate',
                    'eliminate': 'Eliminate',
                  };
                  return (
                    <div key={q} className={`p-2 rounded-lg border ${colors[q]}`}>
                      <p className="text-xs font-medium text-gray-300 mb-1">{labels[q]} <span className="text-gray-400">({quad.count})</span></p>
                      {quad.tasks.slice(0, 2).map((t) => (
                        <div key={t.name} className="flex justify-between text-[10px] text-gray-400">
                          <span className="truncate max-w-[80px]">{t.name}</span>
                          <span className="text-neon-cyan">{t.priorityScore}</span>
                        </div>
                      ))}
                      {quad.count > 2 && <p className="text-[10px] text-gray-400 mt-0.5">+{quad.count - 2} more</p>}
                    </div>
                  );
                })}
              </div>
              {(actionResult.optimalOrder as Array<{ name: string; priorityScore: number }>)?.slice(0, 5).length > 0 && (
                <div className="pt-2 border-t border-lattice-border">
                  <p className="text-xs text-gray-400 mb-2">Optimal Order (top 5)</p>
                  <div className="space-y-1">
                    {(actionResult.optimalOrder as Array<{ name: string; priorityScore: number }>).slice(0, 5).map((t, i) => (
                      <div key={i} className="flex items-center justify-between text-xs">
                        <div className="flex items-center gap-2">
                          <span className="text-gray-600 w-4">{i + 1}.</span>
                          <span className="text-gray-300">{t.name}</span>
                        </div>
                        <span className="text-neon-purple font-mono">{t.priorityScore}</span>
                      </div>
                    ))}
                  </div>
                </div>
              )}
            </div>
          )}

          {actionResult.schedule !== undefined && actionResult.efficiency !== undefined && (
            <div className="space-y-3">
              <div className="flex items-center gap-3">
                <div className="text-3xl font-bold text-neon-green">{actionResult.efficiency as number}%</div>
                <div>
                  <p className="text-sm text-gray-300">Allocation Efficiency</p>
                  <p className="text-xs text-gray-400">{actionResult.scheduledTasks as number}/{actionResult.totalTasks as number} tasks scheduled</p>
                </div>
              </div>
              <div className="grid grid-cols-2 md:grid-cols-3 gap-2">
                <div className="p-2 bg-lattice-bg rounded text-center">
                  <p className="text-sm font-bold text-neon-cyan">{actionResult.totalAllocatedMinutes as number}m</p>
                  <p className="text-[10px] text-gray-400">Allocated</p>
                </div>
                <div className="p-2 bg-lattice-bg rounded text-center">
                  <p className="text-sm font-bold text-neon-yellow">{actionResult.remainingMinutes as number}m</p>
                  <p className="text-[10px] text-gray-400">Remaining</p>
                </div>
                <div className="p-2 bg-lattice-bg rounded text-center">
                  <p className="text-sm font-bold text-neon-purple">{actionResult.avgCognitiveLoad as number}</p>
                  <p className="text-[10px] text-gray-400">Avg Cog Load</p>
                </div>
              </div>
              {(actionResult.schedule as Array<{ name: string; startMinute: number; allocatedMinutes: number; cognitiveLoad: number; partial?: boolean }>).slice(0, 4).length > 0 && (
                <div className="pt-2 border-t border-lattice-border">
                  <p className="text-xs text-gray-400 mb-2">Schedule Preview</p>
                  <div className="space-y-1">
                    {(actionResult.schedule as Array<{ name: string; startMinute: number; allocatedMinutes: number; cognitiveLoad: number; partial?: boolean }>).slice(0, 4).map((s, i) => (
                      <div key={i} className="flex items-center justify-between p-2 bg-lattice-bg rounded text-xs">
                        <div className="flex items-center gap-2">
                          <span className="text-gray-400 font-mono w-12">{Math.floor(s.startMinute / 60)}h{s.startMinute % 60}m</span>
                          <span className="text-gray-300">{s.name}</span>
                          {s.partial && <span className="text-yellow-400 text-[10px]">partial</span>}
                        </div>
                        <div className="flex items-center gap-3 text-gray-400">
                          <span>Load: {s.cognitiveLoad}</span>
                          <span className="text-neon-green">{s.allocatedMinutes}m</span>
                        </div>
                      </div>
                    ))}
                  </div>
                </div>
              )}
              {(actionResult.unscheduledTasks as unknown[])?.length > 0 && (
                <div className="flex items-center gap-2 p-2 rounded-lg bg-yellow-400/5 border border-yellow-400/20">
                  <AlertTriangle className="w-4 h-4 text-yellow-400 flex-shrink-0" />
                  <p className="text-xs text-yellow-400">{(actionResult.unscheduledTasks as unknown[]).length} task(s) could not be scheduled within the available time budget.</p>
                </div>
              )}
            </div>
          )}

          {!!actionResult.message && actionResult.focusScore === undefined && actionResult.quadrants === undefined && actionResult.schedule === undefined && (
            <p className="text-sm text-gray-400">{actionResult.message as string}</p>
          )}
        </motion.div>
      )}
    </div>
  );
}
