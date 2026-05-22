'use client';
/* eslint-disable @typescript-eslint/no-explicit-any */

/**
 * AgentRuntime — the agent-platform runtime surface (AutoGPT / CrewAI parity).
 *
 * Wires every macro in server/domains/agents.js that the registry/config UI
 * does not: the autonomous multi-step run loop + tool-call inspector,
 * agent-to-agent orchestration graphs, scheduled / triggered runs,
 * per-agent conversation threads, cost/token budgets with enforcement,
 * and template-marketplace import. Every value rendered comes from a real
 * macro round-trip — no mock data.
 */

import { useState, useEffect, useCallback, useMemo } from 'react';
import { lensRun } from '@/lib/api/client';
import { TreeDiagram, TreeNode, TimelineView, TimelineEvent, ChartKit } from '@/components/viz';
import {
  Play, Loader2, ListTree, GitBranch, CalendarClock, MessageSquare, Wallet,
  Package, Plus, Trash2, Power, Send, RefreshCw, Zap, AlertTriangle, Download,
} from 'lucide-react';

const DOMAIN = 'agents';

// ── Shared shapes ────────────────────────────────────────────────────────
interface RunStep {
  index: number; tool: string; toolKind: string; input: string;
  output: Record<string, any>; latencyMs: number; tokens: number; status: string; ts: string;
}
interface AgentRun {
  id: string; agentId: string; agentName: string; goal: string; status: string;
  stoppedReason: string | null; steps: RunStep[]; stepCount: number;
  totalLatencyMs: number; totalTokens: number; startedAt: string; finishedAt: string;
  trigger?: string;
}
interface GraphNode { id: string; agentId: string | null; label: string; role: string }
interface GraphEdge { from: string; to: string; label: string }
interface OrchGraph { id: string; name: string; nodes: GraphNode[]; edges: GraphEdge[]; createdAt: string; updatedAt: string }
interface Schedule {
  id: string; agentId: string; agentName: string; kind: string; spec: string;
  goal: string; enabled: boolean; createdAt: string; lastFiredAt: string | null; fireCount: number;
}
interface ThreadMsg { id: string; role: string; text: string; ts: string }
interface Thread { agentId: string; agentName: string; messages: ThreadMsg[]; createdAt: string | null }
interface Budget {
  agentId: string; tokenLimit: number; costPer1k: number; enforce: boolean;
  tokensUsed: number; updatedAt: string;
}
interface BudgetView {
  budget: Budget | null; remaining: number; pctUsed: number;
  estCostUsed: number; estCostLimit: number; exceeded: boolean;
}
interface Template {
  id: string; name: string; type: string; description: string; goals: string[];
  tools: string[]; model: string; temperature: number; maxTokens: number;
  author: string; installs: number;
}
interface RuntimeOverview {
  totalRuns: number; completed: number; halted: number; totalTokensSpent: number;
  activeSchedules: number; totalSchedules: number; graphCount: number;
  budgetedAgents: number; threadCount: number;
  recentRuns: { id: string; agentName: string; status: string; stepCount: number; totalTokens: number; finishedAt: string }[];
}

interface AgentLite { id: string; name: string; tools?: string[]; type?: string }

type RuntimeTab = 'runs' | 'orchestration' | 'schedules' | 'threads' | 'budgets' | 'templates';

const TABS: { id: RuntimeTab; label: string; icon: React.ComponentType<{ className?: string }> }[] = [
  { id: 'runs', label: 'Run Loop', icon: Play },
  { id: 'orchestration', label: 'Orchestration', icon: GitBranch },
  { id: 'schedules', label: 'Triggers', icon: CalendarClock },
  { id: 'threads', label: 'Threads', icon: MessageSquare },
  { id: 'budgets', label: 'Budgets', icon: Wallet },
  { id: 'templates', label: 'Templates', icon: Package },
];

export function AgentRuntime({ agents }: { agents: AgentLite[] }) {
  const [tab, setTab] = useState<RuntimeTab>('runs');
  const [overview, setOverview] = useState<RuntimeOverview | null>(null);

  const loadOverview = useCallback(async () => {
    const r = await lensRun<RuntimeOverview>(DOMAIN, 'runtimeOverview', {});
    if (r.data?.ok && r.data.result) setOverview(r.data.result);
  }, []);

  useEffect(() => { loadOverview(); }, [loadOverview]);

  return (
    <div className="space-y-4">
      <header className="flex items-center gap-2 border-b border-cyan-500/15 pb-3">
        <Zap className="h-5 w-5 text-cyan-400" />
        <h2 className="text-sm font-semibold text-white">Agent Runtime</h2>
        <span className="rounded bg-zinc-800 px-1.5 py-0.5 font-mono text-[10px] uppercase tracking-wider text-zinc-400">
          autonomous execution
        </span>
        <button
          onClick={loadOverview}
          className="ml-auto inline-flex items-center gap-1 rounded border border-zinc-700 px-2 py-1 text-[10px] text-zinc-400 hover:text-white"
        >
          <RefreshCw className="h-3 w-3" /> Refresh
        </button>
      </header>

      {/* Runtime overview stats — real aggregate macro */}
      {overview && (
        <div className="grid grid-cols-3 gap-2 md:grid-cols-6">
          <Stat label="Runs" value={overview.totalRuns} />
          <Stat label="Completed" value={overview.completed} tone="good" />
          <Stat label="Halted" value={overview.halted} tone={overview.halted > 0 ? 'warn' : 'default'} />
          <Stat label="Tokens" value={overview.totalTokensSpent.toLocaleString()} />
          <Stat label="Schedules" value={`${overview.activeSchedules}/${overview.totalSchedules}`} />
          <Stat label="Graphs" value={overview.graphCount} />
        </div>
      )}

      {/* Tab bar */}
      <div className="flex flex-wrap gap-1 border-b border-zinc-800">
        {TABS.map((t) => (
          <button
            key={t.id}
            onClick={() => setTab(t.id)}
            className={`-mb-px flex items-center gap-1.5 border-b-2 px-3 py-2 text-xs font-medium transition-colors ${
              tab === t.id ? 'border-cyan-400 text-cyan-300' : 'border-transparent text-zinc-500 hover:text-zinc-300'
            }`}
          >
            <t.icon className="h-3.5 w-3.5" /> {t.label}
          </button>
        ))}
      </div>

      {tab === 'runs' && <RunsPanel agents={agents} onChange={loadOverview} />}
      {tab === 'orchestration' && <OrchestrationPanel agents={agents} onChange={loadOverview} />}
      {tab === 'schedules' && <SchedulesPanel agents={agents} onChange={loadOverview} />}
      {tab === 'threads' && <ThreadsPanel agents={agents} />}
      {tab === 'budgets' && <BudgetsPanel agents={agents} onChange={loadOverview} />}
      {tab === 'templates' && <TemplatesPanel />}
    </div>
  );
}

// ── Feature 1 + 2: autonomous run loop + tool-call inspector ─────────────
function RunsPanel({ agents, onChange }: { agents: AgentLite[]; onChange: () => void }) {
  const [agentId, setAgentId] = useState(agents[0]?.id || '');
  const [goal, setGoal] = useState('');
  const [maxSteps, setMaxSteps] = useState(6);
  const [busy, setBusy] = useState(false);
  const [runs, setRuns] = useState<AgentRun[]>([]);
  const [selectedRun, setSelectedRun] = useState<AgentRun | null>(null);
  const [runTree, setRunTree] = useState<TreeNode | null>(null);
  const [err, setErr] = useState<string | null>(null);

  useEffect(() => { if (!agentId && agents[0]) setAgentId(agents[0].id); }, [agents, agentId]);

  const loadRuns = useCallback(async () => {
    const r = await lensRun<{ runs: AgentRun[] }>(DOMAIN, 'listRuns', { limit: 50 });
    if (r.data?.ok && r.data.result) setRuns(r.data.result.runs || []);
  }, []);
  useEffect(() => { loadRuns(); }, [loadRuns]);

  const selectedAgent = agents.find((a) => a.id === agentId);

  const execute = async () => {
    if (!agentId) { setErr('Select an agent first'); return; }
    setBusy(true); setErr(null);
    const r = await lensRun<{ run: AgentRun; budgetRemaining: number | null }>(DOMAIN, 'executeRun', {
      agentId,
      agentName: selectedAgent?.name,
      goal: goal.trim() || undefined,
      tools: selectedAgent?.tools,
      maxSteps,
    });
    setBusy(false);
    if (r.data?.ok && r.data.result) {
      setSelectedRun(r.data.result.run);
      await loadRuns(); onChange();
      void inspect(r.data.result.run.id);
    } else {
      setErr(r.data?.error || 'Run failed');
    }
  };

  const inspect = async (runId: string) => {
    const r = await lensRun<{ run: AgentRun; tree: TreeNode }>(DOMAIN, 'getRunTrace', { runId });
    if (r.data?.ok && r.data.result) {
      setSelectedRun(r.data.result.run);
      // map backend tree (label/meta) -> viz TreeNode (label/detail/tone)
      const t = r.data.result.tree;
      setRunTree({
        id: t.id,
        label: (t as any).label,
        detail: `${(t as any).meta?.status} · ${(t as any).meta?.tokens} tok`,
        tone: (t as any).meta?.status === 'completed' ? 'good' : 'warn',
        children: ((t as any).children || []).map((c: any) => ({
          id: c.id,
          label: c.label,
          detail: `${c.meta?.kind} · ${c.meta?.latencyMs}ms · ${c.meta?.tokens} tok`,
          tone: 'info' as const,
        })),
      });
    }
  };

  return (
    <div className="grid gap-4 md:grid-cols-2">
      {/* Launch a run */}
      <div className="space-y-3 rounded-lg border border-zinc-800 bg-zinc-950 p-3">
        <h3 className="text-xs font-semibold text-white">Launch autonomous run</h3>
        <select value={agentId} onChange={(e) => setAgentId(e.target.value)} className="w-full rounded border border-zinc-800 bg-zinc-900 px-2 py-1.5 text-xs text-white">
          <option value="">Select agent…</option>
          {agents.map((a) => <option key={a.id} value={a.id}>{a.name}</option>)}
        </select>
        <textarea
          value={goal} onChange={(e) => setGoal(e.target.value)}
          placeholder="Goal for this run (e.g. Summarize new research on X)"
          className="h-16 w-full resize-none rounded border border-zinc-800 bg-zinc-900 px-2 py-1.5 text-xs text-white"
        />
        <div className="flex items-center gap-2 text-[11px] text-zinc-400">
          <span>Max steps</span>
          <input
            type="range" min={1} max={20} value={maxSteps}
            onChange={(e) => setMaxSteps(parseInt(e.target.value))} className="flex-1"
          />
          <span className="w-6 text-right font-mono text-cyan-300">{maxSteps}</span>
        </div>
        {selectedAgent?.tools && selectedAgent.tools.length > 0 && (
          <div className="flex flex-wrap gap-1">
            {selectedAgent.tools.slice(0, 8).map((t) => (
              <span key={t} className="rounded bg-cyan-500/10 px-1.5 py-0.5 font-mono text-[9px] text-cyan-300">{t}</span>
            ))}
          </div>
        )}
        <button
          onClick={execute} disabled={busy || !agentId}
          className="inline-flex w-full items-center justify-center gap-1.5 rounded-md border border-cyan-500/30 bg-cyan-500/10 px-3 py-2 text-xs font-medium text-cyan-200 hover:bg-cyan-500/20 disabled:opacity-40"
        >
          {busy ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Play className="h-3.5 w-3.5" />}
          Execute run loop
        </button>
        {err && <p className="text-[11px] text-rose-400">{err}</p>}

        {/* Run history */}
        <div className="space-y-1 pt-1">
          <p className="text-[10px] uppercase tracking-wider text-zinc-500">Recent runs</p>
          <div className="max-h-48 space-y-1 overflow-y-auto">
            {runs.length === 0 && <p className="text-[11px] text-zinc-600">No runs yet.</p>}
            {runs.map((r) => (
              <button
                key={r.id} onClick={() => inspect(r.id)}
                className={`flex w-full items-center justify-between gap-2 rounded border px-2 py-1 text-left text-[11px] ${
                  selectedRun?.id === r.id ? 'border-cyan-500/40 bg-cyan-500/5' : 'border-zinc-800 bg-zinc-900 hover:border-zinc-700'
                }`}
              >
                <span className="min-w-0 flex-1 truncate text-white">{r.agentName}: {r.goal}</span>
                <span className={`shrink-0 font-mono ${r.status === 'completed' ? 'text-emerald-300' : 'text-amber-300'}`}>
                  {r.status} · {r.stepCount}s
                </span>
              </button>
            ))}
          </div>
        </div>
      </div>

      {/* Tool-call inspector */}
      <div className="space-y-3 rounded-lg border border-zinc-800 bg-zinc-950 p-3">
        <h3 className="flex items-center gap-1.5 text-xs font-semibold text-white">
          <ListTree className="h-3.5 w-3.5 text-cyan-400" /> Tool-call inspector
        </h3>
        {!selectedRun ? (
          <p className="py-8 text-center text-[11px] text-zinc-600">Run an agent or pick a run to inspect each step.</p>
        ) : (
          <>
            <div className="grid grid-cols-3 gap-2">
              <Stat label="Steps" value={selectedRun.stepCount} />
              <Stat label="Latency" value={`${selectedRun.totalLatencyMs}ms`} />
              <Stat label="Tokens" value={selectedRun.totalTokens} />
            </div>
            {selectedRun.stoppedReason && (
              <p className="flex items-center gap-1 rounded bg-amber-500/10 px-2 py-1 text-[11px] text-amber-300">
                <AlertTriangle className="h-3 w-3" /> Halted: {selectedRun.stoppedReason}
              </p>
            )}
            {runTree && <TreeDiagram root={runTree} />}
            {/* per-step input/output detail */}
            <div className="max-h-56 space-y-1.5 overflow-y-auto">
              {selectedRun.steps.map((st) => (
                <div key={st.index} className="rounded border border-zinc-800 bg-zinc-900 p-2">
                  <div className="flex items-center justify-between text-[11px]">
                    <span className="font-mono text-cyan-300">{st.index}. {st.tool}</span>
                    <span className="text-zinc-500">{st.latencyMs}ms · {st.tokens} tok</span>
                  </div>
                  <p className="mt-1 text-[10px] text-zinc-500">in: {st.input}</p>
                  <pre className="mt-0.5 overflow-x-auto rounded bg-zinc-950 p-1.5 font-mono text-[10px] text-zinc-300">
                    {JSON.stringify(st.output, null, 1)}
                  </pre>
                </div>
              ))}
            </div>
          </>
        )}
      </div>
    </div>
  );
}

// ── Feature 3: agent-to-agent orchestration graph ────────────────────────
function OrchestrationPanel({ agents, onChange }: { agents: AgentLite[]; onChange: () => void }) {
  const [graphs, setGraphs] = useState<OrchGraph[]>([]);
  const [name, setName] = useState('');
  const [picked, setPicked] = useState<string[]>([]);
  const [busy, setBusy] = useState(false);
  const [selected, setSelected] = useState<OrchGraph | null>(null);
  const [goal, setGoal] = useState('');
  const [orchResult, setOrchResult] = useState<any>(null);
  const [err, setErr] = useState<string | null>(null);

  const loadGraphs = useCallback(async () => {
    const r = await lensRun<{ graphs: OrchGraph[] }>(DOMAIN, 'listGraphs', {});
    if (r.data?.ok && r.data.result) setGraphs(r.data.result.graphs || []);
  }, []);
  useEffect(() => { loadGraphs(); }, [loadGraphs]);

  const togglePick = (id: string) =>
    setPicked((p) => (p.includes(id) ? p.filter((x) => x !== id) : [...p, id]));

  const save = async () => {
    setErr(null);
    if (!name.trim()) { setErr('Graph name required'); return; }
    if (picked.length < 2) { setErr('Pick an orchestrator + at least one worker'); return; }
    setBusy(true);
    // first picked = orchestrator, rest = workers; orchestrator -> each worker edge
    const nodes: GraphNode[] = picked.map((id, i) => {
      const a = agents.find((x) => x.id === id)!;
      return { id, agentId: id, label: a.name, role: i === 0 ? 'orchestrator' : 'worker' };
    });
    const edges: GraphEdge[] = picked.slice(1).map((id) => ({
      from: picked[0], to: id, label: 'delegates',
    }));
    const r = await lensRun<{ graph: OrchGraph }>(DOMAIN, 'saveGraph', { name: name.trim(), nodes, edges });
    setBusy(false);
    if (r.data?.ok) { setName(''); setPicked([]); await loadGraphs(); onChange(); }
    else setErr(r.data?.error || 'Save failed');
  };

  const remove = async (id: string) => {
    await lensRun(DOMAIN, 'deleteGraph', { id });
    if (selected?.id === id) { setSelected(null); setOrchResult(null); }
    await loadGraphs(); onChange();
  };

  const run = async (g: OrchGraph) => {
    setBusy(true); setErr(null); setSelected(g); setOrchResult(null);
    const r = await lensRun<{ orchestration: any }>(DOMAIN, 'runGraph', { graphId: g.id, goal: goal.trim() || undefined });
    setBusy(false);
    if (r.data?.ok && r.data.result) { setOrchResult(r.data.result.orchestration); onChange(); }
    else setErr(r.data?.error || 'Run failed');
  };

  const graphTree = (g: OrchGraph): TreeNode => {
    const orch = g.nodes.find((n) => n.role === 'orchestrator') || g.nodes[0];
    const targets = new Set(g.edges.filter((e) => e.from === orch.id).map((e) => e.to));
    return {
      id: orch.id, label: orch.label, detail: 'orchestrator', tone: 'info',
      children: g.nodes.filter((n) => targets.has(n.id)).map((w) => ({
        id: w.id, label: w.label, detail: 'worker', tone: 'good',
      })),
    };
  };

  return (
    <div className="grid gap-4 md:grid-cols-2">
      <div className="space-y-3 rounded-lg border border-zinc-800 bg-zinc-950 p-3">
        <h3 className="text-xs font-semibold text-white">Build orchestration graph</h3>
        <input
          value={name} onChange={(e) => setName(e.target.value)}
          placeholder="Graph name"
          className="w-full rounded border border-zinc-800 bg-zinc-900 px-2 py-1.5 text-xs text-white"
        />
        <p className="text-[10px] text-zinc-500">First picked = orchestrator, rest = workers it delegates to.</p>
        <div className="flex flex-wrap gap-1">
          {agents.map((a) => {
            const idx = picked.indexOf(a.id);
            return (
              <button
                key={a.id} onClick={() => togglePick(a.id)}
                className={`rounded border px-2 py-1 text-[10px] ${
                  idx === 0 ? 'border-yellow-500/40 bg-yellow-500/10 text-yellow-300'
                    : idx > 0 ? 'border-emerald-500/40 bg-emerald-500/10 text-emerald-300'
                      : 'border-zinc-800 bg-zinc-900 text-zinc-400'
                }`}
              >
                {idx === 0 ? '★ ' : idx > 0 ? `${idx} ` : ''}{a.name}
              </button>
            );
          })}
          {agents.length === 0 && <p className="text-[11px] text-zinc-600">Create agents first.</p>}
        </div>
        <button
          onClick={save} disabled={busy}
          className="inline-flex w-full items-center justify-center gap-1.5 rounded-md border border-cyan-500/30 bg-cyan-500/10 px-3 py-2 text-xs font-medium text-cyan-200 hover:bg-cyan-500/20 disabled:opacity-40"
        >
          {busy ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Plus className="h-3.5 w-3.5" />} Save graph
        </button>
        {err && <p className="text-[11px] text-rose-400">{err}</p>}

        <div className="space-y-1 pt-1">
          {graphs.map((g) => (
            <div key={g.id} className={`rounded border p-2 ${selected?.id === g.id ? 'border-cyan-500/40 bg-cyan-500/5' : 'border-zinc-800 bg-zinc-900'}`}>
              <div className="flex items-center justify-between gap-2">
                <span className="truncate text-xs text-white">{g.name}</span>
                <span className="font-mono text-[10px] text-zinc-500">{g.nodes.length}n / {g.edges.length}e</span>
              </div>
              <div className="mt-1 flex gap-1">
                <button onClick={() => run(g)} className="inline-flex items-center gap-1 rounded border border-cyan-500/30 bg-cyan-500/10 px-1.5 py-0.5 text-[10px] text-cyan-200 hover:bg-cyan-500/20">
                  <Play className="h-3 w-3" /> run
                </button>
                <button onClick={() => remove(g.id)} className="inline-flex items-center gap-1 rounded border border-rose-500/30 bg-rose-500/10 px-1.5 py-0.5 text-[10px] text-rose-300 hover:bg-rose-500/20">
                  <Trash2 className="h-3 w-3" /> delete
                </button>
              </div>
            </div>
          ))}
        </div>
      </div>

      <div className="space-y-3 rounded-lg border border-zinc-800 bg-zinc-950 p-3">
        <h3 className="flex items-center gap-1.5 text-xs font-semibold text-white">
          <GitBranch className="h-3.5 w-3.5 text-cyan-400" /> Delegation graph
        </h3>
        <input
          value={goal} onChange={(e) => setGoal(e.target.value)}
          placeholder="Goal to delegate (used when running a graph)"
          className="w-full rounded border border-zinc-800 bg-zinc-900 px-2 py-1.5 text-xs text-white"
        />
        {!selected ? (
          <p className="py-8 text-center text-[11px] text-zinc-600">Run a graph to see the delegation tree.</p>
        ) : (
          <>
            <TreeDiagram root={graphTree(selected)} />
            {orchResult && (
              <div className="space-y-2">
                <div className="grid grid-cols-2 gap-2">
                  <Stat label="Workers dispatched" value={orchResult.workerCount} />
                  <Stat label="Total tokens" value={orchResult.totalTokens} />
                </div>
                {orchResult.dispatched.map((d: any) => (
                  <div key={d.node} className="rounded border border-zinc-800 bg-zinc-900 p-2">
                    <div className="flex items-center justify-between text-[11px]">
                      <span className="font-medium text-emerald-300">{d.agentLabel}</span>
                      <span className="font-mono text-zinc-500">{d.steps.length} steps · {d.tokens} tok</span>
                    </div>
                    <div className="mt-1 flex flex-wrap gap-1">
                      {d.steps.map((s: any) => (
                        <span key={s.index} className="rounded bg-zinc-950 px-1.5 py-0.5 font-mono text-[9px] text-zinc-400">
                          {s.tool} {s.latencyMs}ms
                        </span>
                      ))}
                    </div>
                  </div>
                ))}
              </div>
            )}
          </>
        )}
      </div>
    </div>
  );
}

// ── Feature 4: scheduled / triggered runs ────────────────────────────────
function SchedulesPanel({ agents, onChange }: { agents: AgentLite[]; onChange: () => void }) {
  const [schedules, setSchedules] = useState<Schedule[]>([]);
  const [agentId, setAgentId] = useState(agents[0]?.id || '');
  const [kind, setKind] = useState('interval');
  const [spec, setSpec] = useState('');
  const [goal, setGoal] = useState('');
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [fireResult, setFireResult] = useState<AgentRun | null>(null);

  useEffect(() => { if (!agentId && agents[0]) setAgentId(agents[0].id); }, [agents, agentId]);

  const load = useCallback(async () => {
    const r = await lensRun<{ schedules: Schedule[] }>(DOMAIN, 'listSchedules', {});
    if (r.data?.ok && r.data.result) setSchedules(r.data.result.schedules || []);
  }, []);
  useEffect(() => { load(); }, [load]);

  const create = async () => {
    setErr(null);
    if (!agentId) { setErr('Select an agent'); return; }
    if (!spec.trim()) { setErr('Trigger spec required'); return; }
    setBusy(true);
    const a = agents.find((x) => x.id === agentId);
    const r = await lensRun(DOMAIN, 'createSchedule', {
      agentId, agentName: a?.name, kind, spec: spec.trim(), goal: goal.trim() || undefined,
    });
    setBusy(false);
    if (r.data?.ok) { setSpec(''); setGoal(''); await load(); onChange(); }
    else setErr(r.data?.error || 'Create failed');
  };

  const toggle = async (id: string) => { await lensRun(DOMAIN, 'toggleSchedule', { id }); await load(); onChange(); };
  const remove = async (id: string) => { await lensRun(DOMAIN, 'deleteSchedule', { id }); await load(); onChange(); };
  const fire = async (id: string) => {
    setErr(null);
    const r = await lensRun<{ run: AgentRun }>(DOMAIN, 'fireSchedule', { id });
    if (r.data?.ok && r.data.result) { setFireResult(r.data.result.run); await load(); onChange(); }
    else setErr(r.data?.error || 'Fire failed');
  };

  const specHint = kind === 'interval' ? 'milliseconds (e.g. 900000)'
    : kind === 'cron' ? 'cron expr (e.g. 0 */6 * * *)'
      : kind === 'webhook' ? 'webhook path (e.g. /hook/research)'
        : 'event name (e.g. dtu:published)';

  return (
    <div className="grid gap-4 md:grid-cols-2">
      <div className="space-y-3 rounded-lg border border-zinc-800 bg-zinc-950 p-3">
        <h3 className="text-xs font-semibold text-white">New trigger</h3>
        <select value={agentId} onChange={(e) => setAgentId(e.target.value)} className="w-full rounded border border-zinc-800 bg-zinc-900 px-2 py-1.5 text-xs text-white">
          <option value="">Select agent…</option>
          {agents.map((a) => <option key={a.id} value={a.id}>{a.name}</option>)}
        </select>
        <div className="grid grid-cols-4 gap-1">
          {(['interval', 'cron', 'webhook', 'event'] as const).map((k) => (
            <button
              key={k} onClick={() => setKind(k)}
              className={`rounded border px-2 py-1 text-[10px] capitalize ${
                kind === k ? 'border-cyan-500/40 bg-cyan-500/10 text-cyan-300' : 'border-zinc-800 bg-zinc-900 text-zinc-400'
              }`}
            >
              {k}
            </button>
          ))}
        </div>
        <input
          value={spec} onChange={(e) => setSpec(e.target.value)} placeholder={specHint}
          className="w-full rounded border border-zinc-800 bg-zinc-900 px-2 py-1.5 text-xs text-white"
        />
        <input
          value={goal} onChange={(e) => setGoal(e.target.value)} placeholder="Goal (optional)"
          className="w-full rounded border border-zinc-800 bg-zinc-900 px-2 py-1.5 text-xs text-white"
        />
        <button
          onClick={create} disabled={busy}
          className="inline-flex w-full items-center justify-center gap-1.5 rounded-md border border-cyan-500/30 bg-cyan-500/10 px-3 py-2 text-xs font-medium text-cyan-200 hover:bg-cyan-500/20 disabled:opacity-40"
        >
          {busy ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <CalendarClock className="h-3.5 w-3.5" />} Create trigger
        </button>
        {err && <p className="text-[11px] text-rose-400">{err}</p>}
      </div>

      <div className="space-y-2 rounded-lg border border-zinc-800 bg-zinc-950 p-3">
        <h3 className="text-xs font-semibold text-white">Active triggers</h3>
        {schedules.length === 0 && <p className="text-[11px] text-zinc-600">No triggers configured.</p>}
        <div className="max-h-72 space-y-1 overflow-y-auto">
          {schedules.map((sc) => (
            <div key={sc.id} className="rounded border border-zinc-800 bg-zinc-900 p-2">
              <div className="flex items-center justify-between gap-2">
                <span className="truncate text-xs text-white">{sc.agentName}</span>
                <span className={`rounded px-1 font-mono text-[9px] ${sc.enabled ? 'bg-emerald-500/10 text-emerald-300' : 'bg-zinc-800 text-zinc-500'}`}>
                  {sc.kind}
                </span>
              </div>
              <p className="mt-0.5 font-mono text-[10px] text-zinc-500">{sc.spec} · fired {sc.fireCount}×</p>
              <div className="mt-1 flex gap-1">
                <button onClick={() => fire(sc.id)} disabled={!sc.enabled} className="inline-flex items-center gap-1 rounded border border-cyan-500/30 bg-cyan-500/10 px-1.5 py-0.5 text-[10px] text-cyan-200 hover:bg-cyan-500/20 disabled:opacity-40">
                  <Play className="h-3 w-3" /> fire
                </button>
                <button onClick={() => toggle(sc.id)} className="inline-flex items-center gap-1 rounded border border-zinc-700 px-1.5 py-0.5 text-[10px] text-zinc-400 hover:text-white">
                  <Power className="h-3 w-3" /> {sc.enabled ? 'pause' : 'enable'}
                </button>
                <button onClick={() => remove(sc.id)} className="inline-flex items-center gap-1 rounded border border-rose-500/30 bg-rose-500/10 px-1.5 py-0.5 text-[10px] text-rose-300 hover:bg-rose-500/20">
                  <Trash2 className="h-3 w-3" /> delete
                </button>
              </div>
            </div>
          ))}
        </div>
        {fireResult && (
          <div className="rounded border border-cyan-500/30 bg-cyan-500/5 p-2">
            <p className="text-[11px] text-cyan-200">Fired: {fireResult.stepCount} steps · {fireResult.totalTokens} tokens · {fireResult.status}</p>
          </div>
        )}
      </div>
    </div>
  );
}

// ── Feature 5: conversation thread per agent ─────────────────────────────
function ThreadsPanel({ agents }: { agents: AgentLite[] }) {
  const [agentId, setAgentId] = useState(agents[0]?.id || '');
  const [thread, setThread] = useState<Thread | null>(null);
  const [text, setText] = useState('');
  const [busy, setBusy] = useState(false);

  useEffect(() => { if (!agentId && agents[0]) setAgentId(agents[0].id); }, [agents, agentId]);

  const load = useCallback(async (id: string) => {
    if (!id) { setThread(null); return; }
    const r = await lensRun<{ thread: Thread }>(DOMAIN, 'getThread', { agentId: id });
    if (r.data?.ok && r.data.result) setThread(r.data.result.thread);
  }, []);
  useEffect(() => { load(agentId); }, [agentId, load]);

  const send = async () => {
    if (!agentId || !text.trim()) return;
    setBusy(true);
    const a = agents.find((x) => x.id === agentId);
    const r = await lensRun<{ thread: Thread }>(DOMAIN, 'postMessage', {
      agentId, agentName: a?.name, text: text.trim(), tools: a?.tools,
    });
    setBusy(false);
    if (r.data?.ok && r.data.result) { setThread(r.data.result.thread); setText(''); }
  };

  const clear = async () => {
    if (!agentId) return;
    await lensRun(DOMAIN, 'clearThread', { agentId });
    await load(agentId);
  };

  return (
    <div className="space-y-3 rounded-lg border border-zinc-800 bg-zinc-950 p-3">
      <div className="flex items-center gap-2">
        <select value={agentId} onChange={(e) => setAgentId(e.target.value)} className="flex-1 rounded border border-zinc-800 bg-zinc-900 px-2 py-1.5 text-xs text-white">
          <option value="">Select agent…</option>
          {agents.map((a) => <option key={a.id} value={a.id}>{a.name}</option>)}
        </select>
        <button onClick={clear} disabled={!thread?.messages.length} className="inline-flex items-center gap-1 rounded border border-zinc-700 px-2 py-1.5 text-[10px] text-zinc-400 hover:text-white disabled:opacity-40">
          <Trash2 className="h-3 w-3" /> clear
        </button>
      </div>
      <div className="h-72 space-y-2 overflow-y-auto rounded border border-zinc-800 bg-zinc-900 p-2">
        {!thread?.messages.length && <p className="py-12 text-center text-[11px] text-zinc-600">No messages. Start a conversation with this agent.</p>}
        {thread?.messages.map((m) => (
          <div key={m.id} className={`flex ${m.role === 'user' ? 'justify-end' : 'justify-start'}`}>
            <div className={`max-w-[80%] rounded-lg px-2.5 py-1.5 text-xs ${
              m.role === 'user' ? 'bg-cyan-500/15 text-cyan-100' : 'bg-zinc-800 text-zinc-200'
            }`}>
              <p>{m.text}</p>
              <p className="mt-0.5 text-[9px] text-zinc-500">{new Date(m.ts).toLocaleTimeString()}</p>
            </div>
          </div>
        ))}
      </div>
      <div className="flex items-center gap-2">
        <input
          value={text} onChange={(e) => setText(e.target.value)}
          onKeyDown={(e) => { if (e.key === 'Enter' && !busy) send(); }}
          placeholder="Message the agent…" disabled={!agentId}
          className="flex-1 rounded border border-zinc-800 bg-zinc-900 px-2 py-1.5 text-xs text-white"
        />
        <button
          onClick={send} disabled={busy || !agentId || !text.trim()}
          className="inline-flex items-center gap-1 rounded border border-cyan-500/30 bg-cyan-500/10 px-3 py-1.5 text-xs text-cyan-200 hover:bg-cyan-500/20 disabled:opacity-40"
        >
          {busy ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Send className="h-3.5 w-3.5" />}
        </button>
      </div>
    </div>
  );
}

// ── Feature 6: cost / token budget per agent with enforcement ────────────
function BudgetsPanel({ agents, onChange }: { agents: AgentLite[]; onChange: () => void }) {
  const [agentId, setAgentId] = useState(agents[0]?.id || '');
  const [view, setView] = useState<BudgetView | null>(null);
  const [tokenLimit, setTokenLimit] = useState(50000);
  const [costPer1k, setCostPer1k] = useState(3);
  const [enforce, setEnforce] = useState(true);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  useEffect(() => { if (!agentId && agents[0]) setAgentId(agents[0].id); }, [agents, agentId]);

  const load = useCallback(async (id: string) => {
    if (!id) { setView(null); return; }
    const r = await lensRun<BudgetView>(DOMAIN, 'getBudget', { agentId: id });
    if (r.data?.ok) setView(r.data.result);
  }, []);
  useEffect(() => { load(agentId); }, [agentId, load]);

  const save = async () => {
    setErr(null);
    if (!agentId) { setErr('Select an agent'); return; }
    setBusy(true);
    const r = await lensRun(DOMAIN, 'setBudget', { agentId, tokenLimit, costPer1k, enforce });
    setBusy(false);
    if (r.data?.ok) { await load(agentId); onChange(); }
    else setErr(r.data?.error || 'Save failed');
  };

  const reset = async () => {
    if (!agentId) return;
    await lensRun(DOMAIN, 'resetBudget', { agentId });
    await load(agentId); onChange();
  };

  const chartData = useMemo(() => {
    if (!view?.budget) return null;
    return [
      { bucket: 'Used', tokens: view.budget.tokensUsed },
      { bucket: 'Remaining', tokens: view.remaining },
    ];
  }, [view]);

  return (
    <div className="grid gap-4 md:grid-cols-2">
      <div className="space-y-3 rounded-lg border border-zinc-800 bg-zinc-950 p-3">
        <h3 className="text-xs font-semibold text-white">Set token budget</h3>
        <select value={agentId} onChange={(e) => setAgentId(e.target.value)} className="w-full rounded border border-zinc-800 bg-zinc-900 px-2 py-1.5 text-xs text-white">
          <option value="">Select agent…</option>
          {agents.map((a) => <option key={a.id} value={a.id}>{a.name}</option>)}
        </select>
        <label className="block text-[11px] text-zinc-400">
          Token limit
          <input
            type="number" min={1000} step={1000} value={tokenLimit}
            onChange={(e) => setTokenLimit(parseInt(e.target.value) || 0)}
            className="mt-0.5 w-full rounded border border-zinc-800 bg-zinc-900 px-2 py-1.5 text-xs text-white"
          />
        </label>
        <label className="block text-[11px] text-zinc-400">
          Cost per 1k tokens ($)
          <input
            type="number" min={0} step={0.5} value={costPer1k}
            onChange={(e) => setCostPer1k(parseFloat(e.target.value) || 0)}
            className="mt-0.5 w-full rounded border border-zinc-800 bg-zinc-900 px-2 py-1.5 text-xs text-white"
          />
        </label>
        <label className="flex items-center gap-2 text-[11px] text-zinc-400">
          <input type="checkbox" checked={enforce} onChange={(e) => setEnforce(e.target.checked)} />
          Hard-enforce (halt runs that would exceed budget)
        </label>
        <div className="flex gap-2">
          <button
            onClick={save} disabled={busy}
            className="inline-flex flex-1 items-center justify-center gap-1.5 rounded-md border border-cyan-500/30 bg-cyan-500/10 px-3 py-2 text-xs font-medium text-cyan-200 hover:bg-cyan-500/20 disabled:opacity-40"
          >
            {busy ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Wallet className="h-3.5 w-3.5" />} Save budget
          </button>
          <button onClick={reset} className="inline-flex items-center gap-1 rounded border border-zinc-700 px-2 py-2 text-xs text-zinc-400 hover:text-white">
            <RefreshCw className="h-3.5 w-3.5" /> reset
          </button>
        </div>
        {err && <p className="text-[11px] text-rose-400">{err}</p>}
      </div>

      <div className="space-y-3 rounded-lg border border-zinc-800 bg-zinc-950 p-3">
        <h3 className="text-xs font-semibold text-white">Budget status</h3>
        {!view?.budget ? (
          <p className="py-8 text-center text-[11px] text-zinc-600">No budget set for this agent.</p>
        ) : (
          <>
            <div className="grid grid-cols-2 gap-2">
              <Stat label="Used" value={view.budget.tokensUsed.toLocaleString()} />
              <Stat label="Remaining" value={view.remaining.toLocaleString()} tone={view.exceeded ? 'bad' : 'good'} />
              <Stat label="Cost used" value={`$${view.estCostUsed}`} />
              <Stat label="Cost cap" value={`$${view.estCostLimit}`} />
            </div>
            <div className="h-2 overflow-hidden rounded bg-zinc-800">
              <div
                className={`h-full ${view.pctUsed >= 100 ? 'bg-rose-500' : view.pctUsed >= 80 ? 'bg-amber-500' : 'bg-emerald-500'}`}
                style={{ width: `${Math.min(100, view.pctUsed)}%` }}
              />
            </div>
            <p className="text-[11px] text-zinc-400">{view.pctUsed}% of budget consumed{view.exceeded && ' · enforced halt active'}</p>
            {chartData && (
              <ChartKit
                kind="bar"
                data={chartData}
                xKey="bucket"
                series={[{ key: 'tokens', label: 'Tokens' }]}
                height={120}
                showLegend={false}
              />
            )}
          </>
        )}
      </div>
    </div>
  );
}

// ── Feature 7: agent templates / marketplace import ──────────────────────
function TemplatesPanel() {
  const [templates, setTemplates] = useState<Template[]>([]);
  const [importing, setImporting] = useState<string | null>(null);
  const [imported, setImported] = useState<{ name: string; type: string } | null>(null);
  const [events, setEvents] = useState<TimelineEvent[]>([]);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      const r = await lensRun<{ templates: Template[] }>(DOMAIN, 'listTemplates', {});
      if (!cancelled && r.data?.ok && r.data.result) setTemplates(r.data.result.templates || []);
    })();
    return () => { cancelled = true; };
  }, []);

  const importTpl = async (tpl: Template) => {
    setImporting(tpl.id);
    const r = await lensRun<{ agentDefinition: any; template: Template }>(DOMAIN, 'importTemplate', { templateId: tpl.id });
    setImporting(null);
    if (r.data?.ok && r.data.result) {
      const def = r.data.result.agentDefinition;
      setImported({ name: def.name, type: def.type });
      setEvents((e) => [
        { id: `${tpl.id}-${Date.now()}`, label: `Imported ${def.name}`, detail: `${def.type} agent · ${def.tools.length} tools`, time: new Date().toISOString(), tone: 'good' },
        ...e,
      ]);
      // reflect bumped install count
      setTemplates((ts) => ts.map((t) => (t.id === tpl.id ? { ...t, installs: r.data.result!.template.installs } : t)));
    }
  };

  return (
    <div className="space-y-3">
      <div className="grid gap-2 md:grid-cols-2 lg:grid-cols-3">
        {templates.map((t) => (
          <div key={t.id} className="flex flex-col rounded-lg border border-zinc-800 bg-zinc-950 p-3">
            <div className="flex items-start justify-between gap-2">
              <h3 className="text-xs font-semibold text-white">{t.name}</h3>
              <span className="rounded bg-zinc-800 px-1 font-mono text-[9px] uppercase text-zinc-400">{t.type}</span>
            </div>
            <p className="mt-1 flex-1 text-[11px] text-zinc-400">{t.description}</p>
            <div className="mt-2 flex flex-wrap gap-1">
              {t.tools.map((tool) => (
                <span key={tool} className="rounded bg-cyan-500/10 px-1.5 py-0.5 font-mono text-[9px] text-cyan-300">{tool}</span>
              ))}
            </div>
            <div className="mt-2 flex items-center justify-between text-[10px] text-zinc-500">
              <span>by {t.author} · {t.installs} installs</span>
              <span className="font-mono">{t.model.split('-').slice(0, 2).join('-')}</span>
            </div>
            <button
              onClick={() => importTpl(t)} disabled={importing === t.id}
              className="mt-2 inline-flex items-center justify-center gap-1.5 rounded-md border border-cyan-500/30 bg-cyan-500/10 px-3 py-1.5 text-xs font-medium text-cyan-200 hover:bg-cyan-500/20 disabled:opacity-40"
            >
              {importing === t.id ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Download className="h-3.5 w-3.5" />} Import
            </button>
          </div>
        ))}
        {templates.length === 0 && <p className="text-[11px] text-zinc-600">Loading templates…</p>}
      </div>
      {imported && (
        <p className="rounded border border-emerald-500/30 bg-emerald-500/5 px-3 py-2 text-[11px] text-emerald-300">
          Imported &quot;{imported.name}&quot; ({imported.type}). The agent definition is ready — create it from the roster above.
        </p>
      )}
      {events.length > 0 && (
        <div className="rounded-lg border border-zinc-800 bg-zinc-950 p-3">
          <h3 className="mb-2 text-xs font-semibold text-white">Import history</h3>
          <TimelineView events={events} />
        </div>
      )}
    </div>
  );
}

// ── small helpers ────────────────────────────────────────────────────────
function Stat({ label, value, tone = 'default' }: { label: string; value: string | number; tone?: 'default' | 'good' | 'warn' | 'bad' }) {
  const c = tone === 'good' ? 'text-emerald-300' : tone === 'warn' ? 'text-amber-300' : tone === 'bad' ? 'text-rose-300' : 'text-cyan-300';
  return (
    <div className="rounded border border-zinc-800 bg-zinc-900 px-2.5 py-1.5">
      <div className="text-[9px] uppercase tracking-wider text-zinc-500">{label}</div>
      <div className={`mt-0.5 font-mono text-sm ${c}`}>{value}</div>
    </div>
  );
}
