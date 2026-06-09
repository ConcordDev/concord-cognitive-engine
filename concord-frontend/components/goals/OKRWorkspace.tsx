'use client';

/**
 * OKRWorkspace — the OKR-tool feature surface for the goals lens.
 * Covers the seven feature-parity backlog items:
 *  - alignment tree (link key results to parent objectives across teams)
 *  - cadence check-ins (weekly status + confidence)
 *  - team / shared goals with per-member contribution
 *  - goal templates by category + recurring goals
 *  - progress charts (burndown / trend)
 *  - reminders + scheduled review prompts
 *  - goal dependencies (this goal blocks that one)
 * All data is real user input, persisted by the `goals` domain macros.
 */

import { useCallback, useEffect, useState } from 'react';
import { lensRun } from '@/lib/api/client';
import { ChartKit } from '@/components/viz/ChartKit';
import {
  GitBranch, CalendarCheck, Users, LayoutTemplate, BarChart3,
  Bell, Link2, Loader2, Plus, Trash2, RefreshCw, Repeat, AlertTriangle,
} from 'lucide-react';

// --------------- Types ---------------

interface AlignObjective {
  id: string; title: string; parentId: string | null; owner: string | null;
  team: string | null; level: string; keyResults: string[];
  children?: AlignObjective[];
}
interface AlignStats {
  objectiveCount: number; rootCount: number; maxDepth: number;
  keyResultsLinked: number; teams: string[];
}
interface Checkin {
  id: string; goalId: string; status: string; confidence: number;
  progress: number | null; note: string; period: string;
}
interface TeamMemberShare { member: string; amount: number; sharePct: number; }
interface TeamGoal {
  id: string; title: string; description: string; members: string[];
  target: number; progress: number; totalContributed: number;
  byMember: TeamMemberShare[];
}
interface GoalTemplate {
  id: string; category: string; name: string; description: string;
  cadence: string; keyResults: string[];
}
interface RecurringGoal {
  id: string; title: string; cadence: string; category: string | null;
  nextDue: string; occurrences: number;
}
interface ChartPoint { date: string; progress: number; }
interface TrendPoint extends Record<string, unknown> { date: string; progress: number; ideal: number; }
interface BurndownPoint extends Record<string, unknown> { date: string; remaining: number; idealRemaining: number; }
interface ChartStats {
  points: number; currentProgress: number; target: number; remaining: number;
  velocityPerDay: number; varianceFromIdeal: number; pace: string;
}
interface Reminder {
  id: string; goalId: string | null; label: string; kind: string;
  cadence: string; dueAt: string; done: boolean; firedCount: number;
}
interface DepEdge { id: string; from: string; to: string; kind: string; }
interface DepResult {
  edges: DepEdge[]; blockedGoals: string[]; readyGoals: string[];
  blockersByGoal: Record<string, string[]>;
  stats: { edgeCount: number; blockingCount: number; nodeCount: number };
}

type TabKey = 'alignment' | 'checkins' | 'team' | 'templates' | 'charts' | 'reminders' | 'deps';

const TABS: { key: TabKey; label: string; icon: typeof GitBranch }[] = [
  { key: 'alignment', label: 'Alignment Tree', icon: GitBranch },
  { key: 'checkins', label: 'Check-ins', icon: CalendarCheck },
  { key: 'team', label: 'Team Goals', icon: Users },
  { key: 'templates', label: 'Templates', icon: LayoutTemplate },
  { key: 'charts', label: 'Progress Charts', icon: BarChart3 },
  { key: 'reminders', label: 'Reminders', icon: Bell },
  { key: 'deps', label: 'Dependencies', icon: Link2 },
];

const STATUS_COLOR: Record<string, string> = {
  on_track: 'text-emerald-400 bg-emerald-500/15',
  at_risk: 'text-amber-400 bg-amber-500/15',
  off_track: 'text-red-400 bg-red-500/15',
};

const inputCls = 'rounded border border-zinc-800 bg-zinc-950 px-2 py-1 text-xs text-white placeholder:text-zinc-400 focus:border-cyan-500/50 focus:outline-none';
const btnCls = 'flex items-center gap-1 rounded bg-cyan-500/15 px-2.5 py-1 text-xs font-medium text-cyan-300 hover:bg-cyan-500/25 disabled:opacity-40';

// --------------- Main ---------------

export function OKRWorkspace() {
  const [tab, setTab] = useState<TabKey>('alignment');

  return (
    <div className="space-y-4">
      <header className="flex items-center gap-2 border-b border-cyan-500/15 pb-3">
        <GitBranch className="h-5 w-5 text-cyan-400" />
        <h2 className="text-sm font-semibold text-white">OKR Workspace</h2>
        <span className="rounded bg-zinc-800 px-1.5 py-0.5 font-mono text-[10px] uppercase tracking-wider text-zinc-400">
          alignment · cadence · teams
        </span>
      </header>

      <div className="flex flex-wrap gap-1 rounded-lg bg-white/5 p-1">
        {TABS.map((t) => {
          const Icon = t.icon;
          return (
            <button
              key={t.key}
              onClick={() => setTab(t.key)}
              className={`flex items-center gap-1.5 rounded-md px-2.5 py-1.5 text-xs font-medium transition-colors ${
                tab === t.key
                  ? 'bg-cyan-500/20 text-cyan-300'
                  : 'text-zinc-400 hover:bg-white/5 hover:text-zinc-200'
              }`}
            >
              <Icon className="h-3.5 w-3.5" />
              {t.label}
            </button>
          );
        })}
      </div>

      {tab === 'alignment' && <AlignmentTab />}
      {tab === 'checkins' && <CheckinsTab />}
      {tab === 'team' && <TeamGoalsTab />}
      {tab === 'templates' && <TemplatesTab />}
      {tab === 'charts' && <ChartsTab />}
      {tab === 'reminders' && <RemindersTab />}
      {tab === 'deps' && <DependenciesTab />}
    </div>
  );
}

// --------------- Alignment Tree ---------------

function AlignmentTab() {
  const [flat, setFlat] = useState<AlignObjective[]>([]);
  const [tree, setTree] = useState<AlignObjective[]>([]);
  const [stats, setStats] = useState<AlignStats | null>(null);
  const [busy, setBusy] = useState(false);
  const [title, setTitle] = useState('');
  const [parentId, setParentId] = useState('');
  const [team, setTeam] = useState('');
  const [level, setLevel] = useState('company');
  const [krText, setKrText] = useState('');

  const load = useCallback(async () => {
    const r = await lensRun('goals', 'alignmentTree', { op: 'list' });
    if (r.data?.ok && r.data.result) {
      setFlat(r.data.result.flat || []);
      setTree(r.data.result.tree || []);
      setStats(r.data.result.stats || null);
    }
  }, []);
  useEffect(() => { load(); }, [load]);

  const add = async () => {
    if (!title.trim()) return;
    setBusy(true);
    const r = await lensRun('goals', 'alignmentTree', {
      op: 'upsert', title: title.trim(), parentId: parentId || undefined,
      team: team.trim() || undefined, level,
      keyResults: krText.split('\n').map((s) => s.trim()).filter(Boolean),
    });
    setBusy(false);
    if (r.data?.ok && r.data.result) {
      setFlat(r.data.result.flat || []);
      setTree(r.data.result.tree || []);
      setStats(r.data.result.stats || null);
      setTitle(''); setKrText(''); setTeam('');
    }
  };

  const remove = async (id: string) => {
    const r = await lensRun('goals', 'alignmentTree', { op: 'remove', id });
    if (r.data?.ok && r.data.result) {
      setFlat(r.data.result.flat || []);
      setTree(r.data.result.tree || []);
      setStats(r.data.result.stats || null);
    }
  };

  const renderNode = (node: AlignObjective, depth: number) => (
    <div key={node.id} style={{ marginLeft: depth * 16 }} className="space-y-1">
      <div className="flex items-start gap-2 rounded border border-zinc-800 bg-zinc-950 px-2.5 py-1.5">
        <GitBranch className="mt-0.5 h-3.5 w-3.5 flex-shrink-0 text-cyan-400" />
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-1.5">
            <span className="text-xs font-medium text-white">{node.title}</span>
            <span className="rounded bg-cyan-500/15 px-1 text-[9px] uppercase text-cyan-300">{node.level}</span>
            {node.team && <span className="rounded bg-purple-500/15 px-1 text-[9px] text-purple-300">{node.team}</span>}
          </div>
          {node.keyResults.length > 0 && (
            <ul className="mt-1 space-y-0.5">
              {node.keyResults.map((kr, i) => (
                <li key={i} className="text-[10px] text-zinc-400">→ {kr}</li>
              ))}
            </ul>
          )}
        </div>
        <button aria-label="Delete" onClick={() => remove(node.id)} className="text-zinc-600 hover:text-red-400">
          <Trash2 className="h-3.5 w-3.5" />
        </button>
      </div>
      {(node.children || []).map((c) => renderNode(c, depth + 1))}
    </div>
  );

  return (
    <div className="space-y-3">
      <div className="grid grid-cols-2 gap-2 rounded-lg border border-zinc-800 bg-zinc-950/40 p-3 md:grid-cols-3">
        <input value={title} onChange={(e) => setTitle(e.target.value)} placeholder="Objective title" className={inputCls} />
        <select value={parentId} onChange={(e) => setParentId(e.target.value)} className={inputCls}>
          <option value="">No parent (root)</option>
          {flat.map((o) => <option key={o.id} value={o.id}>{o.title}</option>)}
        </select>
        <select value={level} onChange={(e) => setLevel(e.target.value)} className={inputCls}>
          {['company', 'team', 'individual'].map((l) => <option key={l} value={l}>{l}</option>)}
        </select>
        <input value={team} onChange={(e) => setTeam(e.target.value)} placeholder="Team (optional)" className={inputCls} />
        <textarea
          value={krText}
          onChange={(e) => setKrText(e.target.value)}
          placeholder="Key results (one per line)"
          className={`${inputCls} h-14 resize-none md:col-span-2`}
        />
        <button onClick={add} disabled={busy || !title.trim()} className={`${btnCls} justify-center`}>
          {busy ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Plus className="h-3.5 w-3.5" />}
          Add Objective
        </button>
      </div>

      {stats && stats.objectiveCount > 0 && (
        <div className="grid grid-cols-4 gap-2">
          {[
            { label: 'Objectives', value: stats.objectiveCount },
            { label: 'Roots', value: stats.rootCount },
            { label: 'Max Depth', value: stats.maxDepth },
            { label: 'Key Results', value: stats.keyResultsLinked },
          ].map((s) => (
            <div key={s.label} className="rounded border border-zinc-800 bg-zinc-950 px-2 py-1.5 text-center">
              <div className="font-mono text-base text-cyan-300">{s.value}</div>
              <div className="text-[9px] uppercase tracking-wider text-zinc-400">{s.label}</div>
            </div>
          ))}
        </div>
      )}

      <div className="space-y-1">
        {tree.map((n) => renderNode(n, 0))}
        {tree.length === 0 && <EmptyMsg text="No objectives yet. Add one to build your alignment tree." />}
      </div>
    </div>
  );
}

// --------------- Check-ins ---------------

function CheckinsTab() {
  const [checkins, setCheckins] = useState<Checkin[]>([]);
  const [stats, setStats] = useState<{ count: number; avgConfidence: number; latestStatus: string | null } | null>(null);
  const [goalId, setGoalId] = useState('');
  const [confidence, setConfidence] = useState(0.7);
  const [progress, setProgress] = useState('');
  const [note, setNote] = useState('');
  const [busy, setBusy] = useState(false);

  const load = useCallback(async () => {
    const r = await lensRun('goals', 'checkin', { op: 'list' });
    if (r.data?.ok && r.data.result) {
      setCheckins(r.data.result.checkins || []);
      setStats(r.data.result.stats || null);
    }
  }, []);
  useEffect(() => { load(); }, [load]);

  const add = async () => {
    if (!goalId.trim()) return;
    setBusy(true);
    const r = await lensRun('goals', 'checkin', {
      op: 'add', goalId: goalId.trim(), confidence,
      progress: progress ? Number(progress) : undefined, note: note.trim(),
    });
    setBusy(false);
    if (r.data?.ok && r.data.result) {
      setCheckins(r.data.result.checkins || []);
      setStats(r.data.result.stats || null);
      setNote(''); setProgress('');
    }
  };

  const remove = async (id: string) => {
    const r = await lensRun('goals', 'checkin', { op: 'remove', id });
    if (r.data?.ok && r.data.result) {
      setCheckins(r.data.result.checkins || []);
      setStats(r.data.result.stats || null);
    }
  };

  return (
    <div className="space-y-3">
      <div className="grid grid-cols-2 gap-2 rounded-lg border border-zinc-800 bg-zinc-950/40 p-3 md:grid-cols-4">
        <input value={goalId} onChange={(e) => setGoalId(e.target.value)} placeholder="Goal / objective id" className={inputCls} />
        <label className="flex items-center gap-2 text-[10px] text-zinc-400">
          <span>Conf</span>
          <input
            type="range" min={0} max={1} step={0.05}
            value={confidence} onChange={(e) => setConfidence(Number(e.target.value))}
            className="flex-1 accent-cyan-500"
          />
          <span className="font-mono text-cyan-300">{Math.round(confidence * 100)}%</span>
        </label>
        <input value={progress} onChange={(e) => setProgress(e.target.value)} type="number" min={0} max={100} placeholder="Progress %" className={inputCls} />
        <input value={note} onChange={(e) => setNote(e.target.value)} placeholder="Status note" className={inputCls} />
        <button onClick={add} disabled={busy || !goalId.trim()} className={`${btnCls} justify-center md:col-span-4`}>
          {busy ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Plus className="h-3.5 w-3.5" />}
          Log Check-in
        </button>
      </div>

      {stats && stats.count > 0 && (
        <div className="grid grid-cols-3 gap-2">
          <div className="rounded border border-zinc-800 bg-zinc-950 px-2 py-1.5 text-center">
            <div className="font-mono text-base text-cyan-300">{stats.count}</div>
            <div className="text-[9px] uppercase tracking-wider text-zinc-400">Check-ins</div>
          </div>
          <div className="rounded border border-zinc-800 bg-zinc-950 px-2 py-1.5 text-center">
            <div className="font-mono text-base text-cyan-300">{Math.round(stats.avgConfidence * 100)}%</div>
            <div className="text-[9px] uppercase tracking-wider text-zinc-400">Avg Confidence</div>
          </div>
          <div className="rounded border border-zinc-800 bg-zinc-950 px-2 py-1.5 text-center">
            <div className={`text-xs font-medium ${STATUS_COLOR[stats.latestStatus || '']?.split(' ')[0] || 'text-zinc-400'}`}>
              {(stats.latestStatus || '—').replace('_', ' ')}
            </div>
            <div className="text-[9px] uppercase tracking-wider text-zinc-400">Latest</div>
          </div>
        </div>
      )}

      <div className="space-y-1.5">
        {checkins.map((c) => (
          <div key={c.id} className="flex items-start gap-2 rounded border border-zinc-800 bg-zinc-950 px-2.5 py-1.5">
            <span className={`rounded px-1.5 py-0.5 text-[9px] font-medium uppercase ${STATUS_COLOR[c.status] || 'text-zinc-400 bg-zinc-800'}`}>
              {c.status.replace('_', ' ')}
            </span>
            <div className="min-w-0 flex-1">
              <div className="flex flex-wrap items-center gap-x-2 text-[11px] text-zinc-300">
                <span className="font-mono text-zinc-400">{c.goalId}</span>
                <span>· {Math.round(c.confidence * 100)}% conf</span>
                {c.progress != null && <span>· {c.progress}% done</span>}
                <span className="text-zinc-600">{c.period}</span>
              </div>
              {c.note && <p className="mt-0.5 text-[10px] text-zinc-400">{c.note}</p>}
            </div>
            <button aria-label="Delete" onClick={() => remove(c.id)} className="text-zinc-600 hover:text-red-400">
              <Trash2 className="h-3.5 w-3.5" />
            </button>
          </div>
        ))}
        {checkins.length === 0 && <EmptyMsg text="No check-ins yet. Log a weekly status to track confidence over time." />}
      </div>
    </div>
  );
}

// --------------- Team Goals ---------------

function TeamGoalsTab() {
  const [goals, setGoals] = useState<TeamGoal[]>([]);
  const [title, setTitle] = useState('');
  const [target, setTarget] = useState('100');
  const [busy, setBusy] = useState(false);
  const [contribInputs, setContribInputs] = useState<Record<string, { member: string; amount: string }>>({});

  const load = useCallback(async () => {
    const r = await lensRun('goals', 'teamGoal', { op: 'list' });
    if (r.data?.ok && r.data.result) setGoals(r.data.result.teamGoals || []);
  }, []);
  useEffect(() => { load(); }, [load]);

  const create = async () => {
    if (!title.trim()) return;
    setBusy(true);
    const r = await lensRun('goals', 'teamGoal', {
      op: 'create', title: title.trim(), target: Number(target) || 100,
    });
    setBusy(false);
    if (r.data?.ok && r.data.result) {
      setGoals(r.data.result.teamGoals || []);
      setTitle('');
    }
  };

  const contribute = async (id: string) => {
    const inp = contribInputs[id];
    if (!inp?.member?.trim() || !inp?.amount) return;
    const r = await lensRun('goals', 'teamGoal', {
      op: 'contribute', id, member: inp.member.trim(), amount: Number(inp.amount),
    });
    if (r.data?.ok && r.data.result) {
      setGoals(r.data.result.teamGoals || []);
      setContribInputs((prev) => ({ ...prev, [id]: { member: '', amount: '' } }));
    }
  };

  const remove = async (id: string) => {
    const r = await lensRun('goals', 'teamGoal', { op: 'remove', id });
    if (r.data?.ok && r.data.result) setGoals(r.data.result.teamGoals || []);
  };

  return (
    <div className="space-y-3">
      <div className="grid grid-cols-3 gap-2 rounded-lg border border-zinc-800 bg-zinc-950/40 p-3">
        <input value={title} onChange={(e) => setTitle(e.target.value)} placeholder="Shared goal title" className={`${inputCls} col-span-2`} />
        <input value={target} onChange={(e) => setTarget(e.target.value)} type="number" min={1} placeholder="Target" className={inputCls} />
        <button onClick={create} disabled={busy || !title.trim()} className={`${btnCls} col-span-3 justify-center`}>
          {busy ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Plus className="h-3.5 w-3.5" />}
          Create Team Goal
        </button>
      </div>

      <div className="space-y-2">
        {goals.map((g) => (
          <div key={g.id} className="rounded-lg border border-zinc-800 bg-zinc-950 p-3">
            <div className="flex items-start justify-between gap-2">
              <div>
                <h4 className="text-xs font-semibold text-white">{g.title}</h4>
                <p className="text-[10px] text-zinc-400">
                  {g.totalContributed} / {g.target} · {g.members.length} member{g.members.length !== 1 ? 's' : ''}
                </p>
              </div>
              <button aria-label="Delete" onClick={() => remove(g.id)} className="text-zinc-600 hover:text-red-400">
                <Trash2 className="h-3.5 w-3.5" />
              </button>
            </div>
            <div className="mt-2 h-2 overflow-hidden rounded-full bg-white/10">
              <div className="h-full rounded-full bg-gradient-to-r from-cyan-500 to-purple-500" style={{ width: `${g.progress}%` }} />
            </div>
            {g.byMember.length > 0 && (
              <div className="mt-2 space-y-1">
                {g.byMember.map((m) => (
                  <div key={m.member} className="flex items-center gap-2 text-[10px]">
                    <span className="w-20 truncate text-zinc-300">{m.member}</span>
                    <div className="h-1.5 flex-1 overflow-hidden rounded-full bg-white/5">
                      <div className="h-full rounded-full bg-emerald-500" style={{ width: `${m.sharePct}%` }} />
                    </div>
                    <span className="w-16 text-right font-mono text-zinc-400">{m.amount} ({m.sharePct}%)</span>
                  </div>
                ))}
              </div>
            )}
            <div className="mt-2 flex gap-1.5">
              <input
                value={contribInputs[g.id]?.member || ''}
                onChange={(e) => setContribInputs((p) => ({ ...p, [g.id]: { ...(p[g.id] || { amount: '' }), member: e.target.value } }))}
                placeholder="Member"
                className={`${inputCls} flex-1`}
              />
              <input
                value={contribInputs[g.id]?.amount || ''}
                onChange={(e) => setContribInputs((p) => ({ ...p, [g.id]: { ...(p[g.id] || { member: '' }), amount: e.target.value } }))}
                type="number" min={0} placeholder="Amount"
                className={`${inputCls} w-24`}
              />
              <button onClick={() => contribute(g.id)} className={btnCls}>
                <Plus className="h-3.5 w-3.5" /> Contribute
              </button>
            </div>
          </div>
        ))}
        {goals.length === 0 && <EmptyMsg text="No team goals yet. Create a shared goal and log per-member contributions." />}
      </div>
    </div>
  );
}

// --------------- Templates + Recurring ---------------

function TemplatesTab() {
  const [templates, setTemplates] = useState<GoalTemplate[]>([]);
  const [recurring, setRecurring] = useState<RecurringGoal[]>([]);
  const [title, setTitle] = useState('');
  const [cadence, setCadence] = useState('weekly');
  const [category, setCategory] = useState('');
  const [busy, setBusy] = useState(false);

  const loadTemplates = useCallback(async () => {
    const r = await lensRun('goals', 'templates', { op: 'list' });
    if (r.data?.ok && r.data.result) setTemplates(r.data.result.templates || []);
  }, []);
  const loadRecurring = useCallback(async () => {
    const r = await lensRun('goals', 'templates', { op: 'recurring-list' });
    if (r.data?.ok && r.data.result) setRecurring(r.data.result.recurringGoals || []);
  }, []);
  useEffect(() => { loadTemplates(); loadRecurring(); }, [loadTemplates, loadRecurring]);

  const applyTemplate = (t: GoalTemplate) => {
    setTitle(t.name);
    setCadence(t.cadence === 'once' ? 'weekly' : t.cadence);
    setCategory(t.category);
  };

  const createRecurring = async () => {
    if (!title.trim()) return;
    setBusy(true);
    const r = await lensRun('goals', 'templates', {
      op: 'recurring-create', title: title.trim(), cadence,
      category: category || undefined,
    });
    setBusy(false);
    if (r.data?.ok && r.data.result) {
      setRecurring(r.data.result.recurringGoals || []);
      setTitle('');
    }
  };

  const removeRecurring = async (id: string) => {
    const r = await lensRun('goals', 'templates', { op: 'recurring-remove', id });
    if (r.data?.ok && r.data.result) setRecurring(r.data.result.recurringGoals || []);
  };

  const runDue = async () => {
    const r = await lensRun('goals', 'templates', { op: 'recurring-run-due' });
    if (r.data?.ok && r.data.result) setRecurring(r.data.result.recurringGoals || []);
  };

  return (
    <div className="space-y-3">
      <div>
        <p className="mb-1.5 text-[10px] uppercase tracking-wider text-zinc-400">Templates by category</p>
        <div className="grid grid-cols-1 gap-2 md:grid-cols-2">
          {templates.map((t) => (
            <div key={t.id} className="rounded-lg border border-zinc-800 bg-zinc-950 p-2.5">
              <div className="flex items-center justify-between">
                <span className="text-xs font-semibold text-white">{t.name}</span>
                <span className="rounded bg-purple-500/15 px-1 text-[9px] uppercase text-purple-300">{t.category}</span>
              </div>
              <p className="mt-0.5 text-[10px] text-zinc-400">{t.description}</p>
              <p className="mt-1 text-[9px] text-zinc-400">Cadence: {t.cadence} · {t.keyResults.length} KRs</p>
              <button onClick={() => applyTemplate(t)} className={`${btnCls} mt-1.5`}>
                <LayoutTemplate className="h-3.5 w-3.5" /> Use template
              </button>
            </div>
          ))}
          {templates.length === 0 && <EmptyMsg text="No templates available." />}
        </div>
      </div>

      <div className="rounded-lg border border-zinc-800 bg-zinc-950/40 p-3">
        <p className="mb-1.5 text-[10px] uppercase tracking-wider text-zinc-400">New recurring goal</p>
        <div className="grid grid-cols-3 gap-2">
          <input value={title} onChange={(e) => setTitle(e.target.value)} placeholder="Goal title" className={`${inputCls} col-span-3`} />
          <select value={cadence} onChange={(e) => setCadence(e.target.value)} className={inputCls}>
            {['daily', 'weekly', 'monthly', 'quarterly'].map((c) => <option key={c} value={c}>{c}</option>)}
          </select>
          <input value={category} onChange={(e) => setCategory(e.target.value)} placeholder="Category" className={inputCls} />
          <button onClick={createRecurring} disabled={busy || !title.trim()} className={`${btnCls} justify-center`}>
            {busy ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Repeat className="h-3.5 w-3.5" />}
            Add Recurring
          </button>
        </div>
      </div>

      <div>
        <div className="mb-1.5 flex items-center justify-between">
          <p className="text-[10px] uppercase tracking-wider text-zinc-400">Recurring goals</p>
          {recurring.length > 0 && (
            <button onClick={runDue} className={btnCls}>
              <RefreshCw className="h-3.5 w-3.5" /> Generate due occurrences
            </button>
          )}
        </div>
        <div className="space-y-1.5">
          {recurring.map((rg) => (
            <div key={rg.id} className="flex items-center gap-2 rounded border border-zinc-800 bg-zinc-950 px-2.5 py-1.5">
              <Repeat className="h-3.5 w-3.5 text-cyan-400" />
              <div className="min-w-0 flex-1">
                <span className="text-xs text-white">{rg.title}</span>
                <span className="ml-2 text-[10px] text-zinc-400">
                  {rg.cadence} · {rg.occurrences} run{rg.occurrences !== 1 ? 's' : ''} · next {rg.nextDue.slice(0, 10)}
                </span>
              </div>
              <button aria-label="Delete" onClick={() => removeRecurring(rg.id)} className="text-zinc-600 hover:text-red-400">
                <Trash2 className="h-3.5 w-3.5" />
              </button>
            </div>
          ))}
          {recurring.length === 0 && <EmptyMsg text="No recurring goals yet." />}
        </div>
      </div>
    </div>
  );
}

// --------------- Progress Charts ---------------

function ChartsTab() {
  const [points, setPoints] = useState<ChartPoint[]>([]);
  const [date, setDate] = useState('');
  const [progress, setProgress] = useState('');
  const [target, setTarget] = useState('100');
  const [trend, setTrend] = useState<TrendPoint[]>([]);
  const [burndown, setBurndown] = useState<BurndownPoint[]>([]);
  const [stats, setStats] = useState<ChartStats | null>(null);
  const [view, setView] = useState<'trend' | 'burndown'>('trend');
  const [busy, setBusy] = useState(false);

  const compute = useCallback(async (pts: ChartPoint[]) => {
    if (pts.length === 0) {
      setTrend([]); setBurndown([]); setStats(null);
      return;
    }
    setBusy(true);
    const r = await lensRun('goals', 'progressChart', {
      history: pts, target: Number(target) || 100,
    });
    setBusy(false);
    if (r.data?.ok && r.data.result) {
      setTrend(r.data.result.trend || []);
      setBurndown(r.data.result.burndown || []);
      setStats(r.data.result.empty ? null : (r.data.result.stats || null));
    }
  }, [target]);

  const addPoint = () => {
    if (!date || progress === '') return;
    const next = [...points, { date, progress: Number(progress) }];
    setPoints(next);
    setDate(''); setProgress('');
    compute(next);
  };

  const removePoint = (idx: number) => {
    const next = points.filter((_, i) => i !== idx);
    setPoints(next);
    compute(next);
  };

  return (
    <div className="space-y-3">
      <div className="grid grid-cols-3 gap-2 rounded-lg border border-zinc-800 bg-zinc-950/40 p-3">
        <input value={date} onChange={(e) => setDate(e.target.value)} type="date" className={inputCls} />
        <input value={progress} onChange={(e) => setProgress(e.target.value)} type="number" min={0} max={100} placeholder="Progress %" className={inputCls} />
        <input value={target} onChange={(e) => { setTarget(e.target.value); compute(points); }} type="number" min={1} placeholder="Target" className={inputCls} />
        <button onClick={addPoint} disabled={!date || progress === ''} className={`${btnCls} col-span-3 justify-center`}>
          <Plus className="h-3.5 w-3.5" /> Add data point
        </button>
      </div>

      {points.length > 0 && (
        <div className="flex flex-wrap gap-1.5">
          {points.map((p, i) => (
            <span key={i} className="flex items-center gap-1 rounded bg-zinc-800 px-1.5 py-0.5 text-[10px] text-zinc-300">
              {p.date}: {p.progress}%
              <button aria-label="Delete" onClick={() => removePoint(i)} className="text-zinc-400 hover:text-red-400">
                <Trash2 className="h-3 w-3" />
              </button>
            </span>
          ))}
        </div>
      )}

      {stats && (
        <div className="grid grid-cols-4 gap-2">
          {[
            { label: 'Current', value: `${stats.currentProgress}%` },
            { label: 'Remaining', value: `${stats.remaining}` },
            { label: 'Velocity/day', value: stats.velocityPerDay },
            { label: 'Pace', value: stats.pace.replace('_', ' ') },
          ].map((s) => (
            <div key={s.label} className="rounded border border-zinc-800 bg-zinc-950 px-2 py-1.5 text-center">
              <div className="font-mono text-sm text-cyan-300">{s.value}</div>
              <div className="text-[9px] uppercase tracking-wider text-zinc-400">{s.label}</div>
            </div>
          ))}
        </div>
      )}

      {(trend.length > 0 || burndown.length > 0) && (
        <div className="rounded-lg border border-zinc-800 bg-zinc-950/40 p-3">
          <div className="mb-2 flex gap-1">
            {(['trend', 'burndown'] as const).map((v) => (
              <button
                key={v}
                onClick={() => setView(v)}
                className={`rounded px-2 py-0.5 text-[10px] font-medium capitalize ${
                  view === v ? 'bg-cyan-500/20 text-cyan-300' : 'text-zinc-400 hover:text-zinc-300'
                }`}
              >
                {v}
              </button>
            ))}
          </div>
          {view === 'trend' ? (
            <ChartKit
              kind="line"
              data={trend}
              xKey="date"
              series={[
                { key: 'progress', label: 'Actual', color: '#22d3ee' },
                { key: 'ideal', label: 'Ideal', color: '#a855f7' },
              ]}
              height={220}
            />
          ) : (
            <ChartKit
              kind="area"
              data={burndown}
              xKey="date"
              series={[
                { key: 'remaining', label: 'Remaining', color: '#f59e0b' },
                { key: 'idealRemaining', label: 'Ideal remaining', color: '#52525b' },
              ]}
              height={220}
            />
          )}
        </div>
      )}

      {points.length === 0 && (
        <EmptyMsg text="No progress data yet. Add dated data points to chart burndown and trend." />
      )}
      {busy && <div className="flex items-center gap-1.5 text-[10px] text-zinc-400"><Loader2 className="h-3 w-3 animate-spin" /> Computing…</div>}
    </div>
  );
}

// --------------- Reminders ---------------

function RemindersTab() {
  const [reminders, setReminders] = useState<Reminder[]>([]);
  const [stats, setStats] = useState<{ total: number; pending: number; overdue: number } | null>(null);
  const [label, setLabel] = useState('');
  const [dueAt, setDueAt] = useState('');
  const [kind, setKind] = useState('review');
  const [cadence, setCadence] = useState('once');
  const [goalId, setGoalId] = useState('');
  const [busy, setBusy] = useState(false);

  const load = useCallback(async () => {
    const r = await lensRun('goals', 'reminder', { op: 'list' });
    if (r.data?.ok && r.data.result) {
      setReminders(r.data.result.reminders || []);
      setStats(r.data.result.stats || null);
    }
  }, []);
  useEffect(() => { load(); }, [load]);

  const create = async () => {
    if (!label.trim() || !dueAt) return;
    setBusy(true);
    const r = await lensRun('goals', 'reminder', {
      op: 'create', label: label.trim(), dueAt, kind, cadence,
      goalId: goalId.trim() || undefined,
    });
    setBusy(false);
    if (r.data?.ok) {
      await load();
      setLabel(''); setDueAt(''); setGoalId('');
    }
  };

  const complete = async (id: string) => {
    const r = await lensRun('goals', 'reminder', { op: 'complete', id });
    if (r.data?.ok && r.data.result) {
      setReminders(r.data.result.reminders || []);
      const stat = await lensRun('goals', 'reminder', { op: 'list' });
      if (stat.data?.ok && stat.data.result) setStats(stat.data.result.stats || null);
    }
  };

  const remove = async (id: string) => {
    const r = await lensRun('goals', 'reminder', { op: 'remove', id });
    if (r.data?.ok) await load();
  };

  const now = Date.now();

  return (
    <div className="space-y-3">
      <div className="grid grid-cols-2 gap-2 rounded-lg border border-zinc-800 bg-zinc-950/40 p-3 md:grid-cols-3">
        <input value={label} onChange={(e) => setLabel(e.target.value)} placeholder="Reminder label" className={`${inputCls} md:col-span-3`} />
        <input value={dueAt} onChange={(e) => setDueAt(e.target.value)} type="date" className={inputCls} />
        <select value={kind} onChange={(e) => setKind(e.target.value)} className={inputCls}>
          {['review', 'checkin', 'deadline'].map((k) => <option key={k} value={k}>{k}</option>)}
        </select>
        <select value={cadence} onChange={(e) => setCadence(e.target.value)} className={inputCls}>
          {['once', 'daily', 'weekly', 'monthly'].map((c) => <option key={c} value={c}>{c}</option>)}
        </select>
        <input value={goalId} onChange={(e) => setGoalId(e.target.value)} placeholder="Goal id (optional)" className={`${inputCls} md:col-span-2`} />
        <button onClick={create} disabled={busy || !label.trim() || !dueAt} className={`${btnCls} justify-center`}>
          {busy ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Bell className="h-3.5 w-3.5" />}
          Schedule
        </button>
      </div>

      {stats && stats.total > 0 && (
        <div className="grid grid-cols-3 gap-2">
          {[
            { label: 'Total', value: stats.total, cls: 'text-cyan-300' },
            { label: 'Pending', value: stats.pending, cls: 'text-amber-300' },
            { label: 'Overdue', value: stats.overdue, cls: 'text-red-300' },
          ].map((s) => (
            <div key={s.label} className="rounded border border-zinc-800 bg-zinc-950 px-2 py-1.5 text-center">
              <div className={`font-mono text-base ${s.cls}`}>{s.value}</div>
              <div className="text-[9px] uppercase tracking-wider text-zinc-400">{s.label}</div>
            </div>
          ))}
        </div>
      )}

      <div className="space-y-1.5">
        {reminders.map((rm) => {
          const overdue = !rm.done && new Date(rm.dueAt).getTime() <= now;
          return (
            <div key={rm.id} className={`flex items-center gap-2 rounded border px-2.5 py-1.5 ${
              rm.done ? 'border-zinc-800 bg-zinc-950/40 opacity-60' : overdue ? 'border-red-500/30 bg-red-500/5' : 'border-zinc-800 bg-zinc-950'
            }`}>
              {overdue ? <AlertTriangle className="h-3.5 w-3.5 text-red-400" /> : <Bell className="h-3.5 w-3.5 text-cyan-400" />}
              <div className="min-w-0 flex-1">
                <span className={`text-xs ${rm.done ? 'text-zinc-400 line-through' : 'text-white'}`}>{rm.label}</span>
                <span className="ml-2 text-[10px] text-zinc-400">
                  {rm.kind} · {rm.cadence} · due {rm.dueAt.slice(0, 10)}
                  {rm.firedCount > 0 && ` · fired ${rm.firedCount}×`}
                </span>
              </div>
              {!rm.done && (
                <button onClick={() => complete(rm.id)} className="text-[10px] text-emerald-400 hover:text-emerald-300">Complete</button>
              )}
              <button aria-label="Delete" onClick={() => remove(rm.id)} className="text-zinc-600 hover:text-red-400">
                <Trash2 className="h-3.5 w-3.5" />
              </button>
            </div>
          );
        })}
        {reminders.length === 0 && <EmptyMsg text="No reminders yet. Schedule review prompts to stay on cadence." />}
      </div>
    </div>
  );
}

// --------------- Dependencies ---------------

function DependenciesTab() {
  const [result, setResult] = useState<DepResult | null>(null);
  const [from, setFrom] = useState('');
  const [to, setTo] = useState('');
  const [kind, setKind] = useState('blocks');
  const [error, setError] = useState('');

  const load = useCallback(async () => {
    const r = await lensRun('goals', 'dependencies', { op: 'list' });
    if (r.data?.ok && r.data.result) setResult(r.data.result);
  }, []);
  useEffect(() => { load(); }, [load]);

  const link = async () => {
    setError('');
    if (!from.trim() || !to.trim()) return;
    const r = await lensRun('goals', 'dependencies', {
      op: 'link', from: from.trim(), to: to.trim(), kind,
    });
    if (r.data?.ok && r.data.result) {
      setResult(r.data.result);
      setFrom(''); setTo('');
    } else {
      setError(r.data?.error || 'Could not link');
    }
  };

  const unlink = async (e: DepEdge) => {
    const r = await lensRun('goals', 'dependencies', { op: 'unlink', from: e.from, to: e.to });
    if (r.data?.ok && r.data.result) setResult(r.data.result);
  };

  return (
    <div className="space-y-3">
      <div className="grid grid-cols-3 gap-2 rounded-lg border border-zinc-800 bg-zinc-950/40 p-3">
        <input value={from} onChange={(e) => setFrom(e.target.value)} placeholder="Blocker goal id" className={inputCls} />
        <input value={to} onChange={(e) => setTo(e.target.value)} placeholder="Blocked goal id" className={inputCls} />
        <select value={kind} onChange={(e) => setKind(e.target.value)} className={inputCls}>
          <option value="blocks">blocks</option>
          <option value="relates">relates to</option>
        </select>
        <button onClick={link} disabled={!from.trim() || !to.trim()} className={`${btnCls} col-span-3 justify-center`}>
          <Link2 className="h-3.5 w-3.5" /> Link dependency
        </button>
      </div>
      {error && (
        <div className="flex items-center gap-1.5 rounded border border-red-500/30 bg-red-500/5 px-2.5 py-1.5 text-[11px] text-red-300">
          <AlertTriangle className="h-3.5 w-3.5" /> {error}
        </div>
      )}

      {result && result.stats.edgeCount > 0 && (
        <div className="grid grid-cols-3 gap-2">
          {[
            { label: 'Edges', value: result.stats.edgeCount },
            { label: 'Blocking', value: result.stats.blockingCount },
            { label: 'Nodes', value: result.stats.nodeCount },
          ].map((s) => (
            <div key={s.label} className="rounded border border-zinc-800 bg-zinc-950 px-2 py-1.5 text-center">
              <div className="font-mono text-base text-cyan-300">{s.value}</div>
              <div className="text-[9px] uppercase tracking-wider text-zinc-400">{s.label}</div>
            </div>
          ))}
        </div>
      )}

      {result && (result.blockedGoals.length > 0 || result.readyGoals.length > 0) && (
        <div className="grid grid-cols-2 gap-2">
          <div className="rounded-lg border border-amber-500/20 bg-amber-500/5 p-2.5">
            <p className="mb-1 text-[10px] uppercase tracking-wider text-amber-400">Blocked</p>
            <div className="flex flex-wrap gap-1">
              {result.blockedGoals.map((g) => (
                <span key={g} className="rounded bg-amber-500/15 px-1.5 py-0.5 text-[10px] font-mono text-amber-300">{g}</span>
              ))}
              {result.blockedGoals.length === 0 && <span className="text-[10px] text-zinc-400">none</span>}
            </div>
          </div>
          <div className="rounded-lg border border-emerald-500/20 bg-emerald-500/5 p-2.5">
            <p className="mb-1 text-[10px] uppercase tracking-wider text-emerald-400">Ready</p>
            <div className="flex flex-wrap gap-1">
              {result.readyGoals.map((g) => (
                <span key={g} className="rounded bg-emerald-500/15 px-1.5 py-0.5 text-[10px] font-mono text-emerald-300">{g}</span>
              ))}
              {result.readyGoals.length === 0 && <span className="text-[10px] text-zinc-400">none</span>}
            </div>
          </div>
        </div>
      )}

      <div className="space-y-1.5">
        {(result?.edges || []).map((e) => (
          <div key={e.id} className="flex items-center gap-2 rounded border border-zinc-800 bg-zinc-950 px-2.5 py-1.5">
            <Link2 className={`h-3.5 w-3.5 ${e.kind === 'blocks' ? 'text-red-400' : 'text-zinc-400'}`} />
            <span className="font-mono text-[11px] text-zinc-300">{e.from}</span>
            <span className={`text-[10px] uppercase ${e.kind === 'blocks' ? 'text-red-400' : 'text-zinc-400'}`}>{e.kind}</span>
            <span className="font-mono text-[11px] text-zinc-300">{e.to}</span>
            <button aria-label="Delete" onClick={() => unlink(e)} className="ml-auto text-zinc-600 hover:text-red-400">
              <Trash2 className="h-3.5 w-3.5" />
            </button>
          </div>
        ))}
        {(!result || result.edges.length === 0) && (
          <EmptyMsg text="No dependencies yet. Link goals to model what blocks what." />
        )}
      </div>
    </div>
  );
}

// --------------- Shared ---------------

function EmptyMsg({ text }: { text: string }) {
  return (
    <div className="rounded-lg border border-dashed border-zinc-800 p-6 text-center text-[11px] text-zinc-400">
      {text}
    </div>
  );
}
