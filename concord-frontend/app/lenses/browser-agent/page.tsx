'use client';

/**
 * /lenses/browser-agent — Browser Agent Sprint A.
 *
 * Operator-shape three-pane layout: task list on the left, live
 * action stream + screenshot strip in the middle, controls (cost
 * meter + budget + approval gates + cancel) on the right.
 *
 * Sits on top of the existing /lenses/agents (general roster +
 * builder). This lens is purpose-built for single-task Computer-Use-
 * style execution with safety + observability.
 */

import { useState, useEffect, useCallback, useMemo } from 'react';
import { LensShell } from '@/components/lens/LensShell';
import { callBrowserAgentMacro, type BrowserTask, type BrowserAction, type BrowserApproval, type BrowserBudget } from '@/lib/api/browser-agent';
import { BrowserTaskList } from '@/components/browser-agent/BrowserTaskList';
import { BrowserTaskCreate } from '@/components/browser-agent/BrowserTaskCreate';
import { BrowserActionStream } from '@/components/browser-agent/BrowserActionStream';
import { BrowserCostMeter } from '@/components/browser-agent/BrowserCostMeter';
import { BrowserApprovalsPanel } from '@/components/browser-agent/BrowserApprovalsPanel';
import { BrowserBudgetSettings } from '@/components/browser-agent/BrowserBudgetSettings';
import { BrowserPlanPreview } from '@/components/browser-agent/BrowserPlanPreview';
import { BrowserCostDashboard } from '@/components/browser-agent/BrowserCostDashboard';
import { BrowserVoiceTask } from '@/components/browser-agent/BrowserVoiceTask';
import {
  Plus, Loader2, Bot, Zap, Settings as SettingsIcon, ShieldAlert,
  ListChecks, BarChart3, Sparkles,
} from 'lucide-react';

export default function BrowserAgentLensPage() {
  const [tasks, setTasks] = useState<BrowserTask[]>([]);
  const [activeTaskId, setActiveTaskId] = useState<string | null>(null);
  const [actions, setActions] = useState<BrowserAction[]>([]);
  const [approvals, setApprovals] = useState<BrowserApproval[]>([]);
  const [budget, setBudget] = useState<(BrowserBudget & { dailySpentCents?: number; monthlySpentCents?: number; concurrentActive?: number }) | null>(null);
  const [createOpen, setCreateOpen] = useState(false);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [planTaskId, setPlanTaskId] = useState<string | null>(null);
  const [costOpen, setCostOpen] = useState(false);
  const [loading, setLoading] = useState(true);

  const refreshTasks = useCallback(async () => {
    try {
      const r = await callBrowserAgentMacro<{ tasks?: BrowserTask[] }>('task_list', { limit: 100 });
      if (r?.tasks) setTasks(r.tasks);
      if (r?.tasks?.length && !activeTaskId) setActiveTaskId(r.tasks[0].id);
    } catch (e) { console.error('task_list', e); }
    finally { setLoading(false); }
  }, [activeTaskId]);

  const refreshBudget = useCallback(async () => {
    try {
      const r = await callBrowserAgentMacro('budget_get');
      if (r.ok) setBudget(r as unknown as typeof budget);
    } catch { /* silent */ }
  }, []);

  const refreshApprovals = useCallback(async () => {
    try {
      const r = await callBrowserAgentMacro<{ approvals?: BrowserApproval[] }>('approvals_pending');
      if (r?.approvals) setApprovals(r.approvals);
    } catch { /* silent */ }
  }, []);

  useEffect(() => {
    refreshTasks();
    refreshBudget();
    refreshApprovals();
  }, [refreshTasks, refreshBudget, refreshApprovals]);

  // Poll actions of the active task every 2s while it's live
  useEffect(() => {
    if (!activeTaskId) { setActions([]); return; }
    let cancelled = false;
    const fetchActions = async () => {
      try {
        const r = await callBrowserAgentMacro<{ actions?: BrowserAction[] }>('actions_list', { taskId: activeTaskId });
        if (!cancelled && r?.actions) setActions(r.actions);
      } catch { /* silent */ }
    };
    fetchActions();
    const active = tasks.find((t) => t.id === activeTaskId);
    const liveStatus = active?.status === 'running' || active?.status === 'awaiting_approval' || active?.status === 'planning';
    const t = liveStatus ? setInterval(fetchActions, 2000) : null;
    return () => { cancelled = true; if (t) clearInterval(t); };
  }, [activeTaskId, tasks]);

  const activeTask = useMemo(() => tasks.find((t) => t.id === activeTaskId) || null, [tasks, activeTaskId]);

  if (loading) {
    return (
      <LensShell lensId="browser-agent">
        <div className="flex items-center justify-center h-[calc(100vh-3.5rem)] text-white/40">
          <Loader2 className="w-6 h-6 animate-spin" />
        </div>
      </LensShell>
    );
  }

  return (
    <LensShell lensId="browser-agent">
      <div className="flex h-[calc(100vh-3.5rem)] bg-black/40">
        {/* Sidebar — task list + new task button */}
        <aside className="w-72 border-r border-white/10 flex flex-col bg-black/60">
          <div className="flex items-center justify-between p-3 border-b border-white/10">
            <h2 className="text-sm font-semibold text-white/80 flex items-center gap-2">
              <Bot className="w-4 h-4 text-cyan-400" /> Browser tasks
            </h2>
            <div className="flex items-center gap-1">
              <BrowserVoiceTask onCreated={refreshTasks} />
              <button onClick={() => setCostOpen(true)} className="p-1.5 rounded hover:bg-white/10 text-white/70" title="Cost dashboard">
                <BarChart3 className="w-4 h-4" />
              </button>
              <button onClick={() => setCreateOpen(true)} className="p-1.5 rounded hover:bg-white/10 text-white/70" title="New task">
                <Plus className="w-4 h-4" />
              </button>
            </div>
          </div>
          <BrowserTaskList
            tasks={tasks}
            activeTaskId={activeTaskId}
            onSelect={setActiveTaskId}
          />
          {/* Pending approvals badge */}
          {approvals.length > 0 && (
            <div className="border-t border-white/10 px-3 py-2 bg-amber-500/10">
              <div className="text-xs text-amber-300 flex items-center gap-1 font-semibold">
                <ShieldAlert className="w-3.5 h-3.5" />
                {approvals.length} pending approval{approvals.length === 1 ? '' : 's'}
              </div>
            </div>
          )}
        </aside>

        {/* Center — action stream */}
        <div className="flex-1 flex flex-col min-w-0">
          <div className="flex items-center gap-2 px-3 py-2 border-b border-white/10 bg-black/40">
            {activeTask ? (
              <>
                <span className={`w-2 h-2 rounded-full ${
                  activeTask.status === 'running' ? 'bg-green-400 animate-pulse' :
                  activeTask.status === 'awaiting_approval' ? 'bg-amber-400 animate-pulse' :
                  activeTask.status === 'paused' ? 'bg-zinc-400' :
                  activeTask.status === 'completed' ? 'bg-cyan-400' :
                  activeTask.status === 'failed' || activeTask.status === 'budget_exceeded' ? 'bg-red-400' :
                  'bg-white/30'
                }`} />
                <h2 className="text-sm font-semibold text-white flex-1 truncate">{activeTask.title}</h2>
                <button onClick={() => setPlanTaskId(activeTask.id)} className="px-2 py-1 text-xs rounded bg-cyan-500/10 hover:bg-cyan-500/20 text-cyan-200 flex items-center gap-1" title="Plan preview">
                  <ListChecks className="w-3 h-3" /> Plan
                </button>
                {["completed","failed","cancelled","budget_exceeded"].includes(activeTask.status) && (
                  <button
                    onClick={async () => { const r = await callBrowserAgentMacro<{ id?: string }>('ai_reschedule', { taskId: activeTask.id }); if (r.ok) { refreshTasks(); setActiveTaskId(r.id || null); } }}
                    className="px-2 py-1 text-xs rounded bg-white/5 hover:bg-white/10 text-white/70 flex items-center gap-1"
                    title="Re-run this task (Devin-style)"
                  >
                    <Sparkles className="w-3 h-3" /> Re-run
                  </button>
                )}
                <span className="text-xs text-white/40 uppercase">{activeTask.status}</span>
              </>
            ) : (
              <h2 className="text-sm text-white/40 flex-1">Pick a task or create a new one.</h2>
            )}
          </div>
          <div className="flex-1 overflow-hidden">
            {activeTask ? (
              <BrowserActionStream task={activeTask} actions={actions} onRefresh={refreshTasks} />
            ) : (
              <div className="flex items-center justify-center h-full text-white/30 text-sm">
                <button onClick={() => setCreateOpen(true)} className="px-4 py-2 rounded bg-cyan-500/20 hover:bg-cyan-500/30 text-cyan-200 flex items-center gap-2">
                  <Plus className="w-4 h-4" /> New browser task
                </button>
              </div>
            )}
          </div>
        </div>

        {/* Right — cost meter + approvals + settings */}
        <aside className="w-80 border-l border-white/10 flex flex-col bg-black/60">
          <div className="flex items-center gap-1 px-2 py-1.5 border-b border-white/10">
            <button onClick={() => setSettingsOpen(false)} className={`px-2 py-1 text-xs rounded ${!settingsOpen ? 'bg-white/10 text-white' : 'text-white/60 hover:text-white'}`}>Cost + approvals</button>
            <button onClick={() => setSettingsOpen(true)} className={`px-2 py-1 text-xs rounded flex items-center gap-1 ${settingsOpen ? 'bg-white/10 text-white' : 'text-white/60 hover:text-white'}`}>
              <SettingsIcon className="w-3 h-3" /> Budget
            </button>
          </div>
          <div className="flex-1 overflow-y-auto">
            {!settingsOpen ? (
              <>
                {budget && <BrowserCostMeter task={activeTask} budget={budget} />}
                <BrowserApprovalsPanel
                  approvals={approvals}
                  onDecided={() => { refreshApprovals(); refreshTasks(); }}
                />
              </>
            ) : (
              <BrowserBudgetSettings budget={budget} onSaved={refreshBudget} />
            )}
          </div>
        </aside>
      </div>

      <BrowserTaskCreate
        open={createOpen}
        onClose={() => setCreateOpen(false)}
        budget={budget}
        onCreated={() => {
          setCreateOpen(false);
          refreshTasks();
          refreshBudget();
        }}
      />

      <BrowserPlanPreview
        open={planTaskId !== null}
        taskId={planTaskId}
        onClose={() => setPlanTaskId(null)}
        onApproved={() => { refreshTasks(); }}
      />

      <BrowserCostDashboard
        open={costOpen}
        onClose={() => setCostOpen(false)}
      />
    </LensShell>
  );
}
