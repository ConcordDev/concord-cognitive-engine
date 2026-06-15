'use client';

/**
 * ProductivityActionPanel — task workbench.
 * Self-contained; runs the 4 new productivity.* macros plus mint/DM/
 * publish/agent.
 */

import { useState } from 'react';
import {
  CheckSquare, Filter, Timer, BarChart3, Sparkles, Send, Globe, Wand2,
  Loader2, Check, AlertTriangle,
} from 'lucide-react';
import { motion, AnimatePresence } from 'framer-motion';
import { api, apiHelpers, lensRun } from '@/lib/api/client';
import { cn } from '@/lib/utils';
import { usePipe, useRecallableAction, RecallSlot } from '@/components/panel-polish';

interface MacroEnvelope<T> { ok: boolean; result?: T; error?: string; reason?: string }
async function callMacro<T>(action: string, input: Record<string, unknown>): Promise<MacroEnvelope<T>> {
  const r = await apiHelpers.lens.runDomain('productivity', action, { input });
  const data = (r as { data?: { ok: boolean; result?: T } }).data;
  if (!data) return { ok: false, error: 'empty response' };
  if (data.ok && data.result && typeof data.result === 'object' && 'ok' in data.result) {
    return data.result as MacroEnvelope<T>;
  }
  return data as MacroEnvelope<T>;
}

interface Task { id: string; title: string; project: string; priority: number; dueDate: string | null; completed: boolean; createdAt: string }
type Feedback = { kind: 'ok' | 'err'; text: string } | null;
type ActionId = 'create' | 'filter' | 'focus' | 'summary' | 'mint' | 'dm' | 'publish' | 'agent';

function pickMessage(e: unknown): string {
  const ax = e as { response?: { data?: { error?: string } }; message?: string };
  return ax?.response?.data?.error ?? ax?.message ?? 'request failed';
}

interface FilterResult { project?: string; status?: string; count?: number; tasks?: Task[]; byPriority?: Record<string, number> }
interface FocusResult { energy?: string; candidate?: Task; durationMin?: number; breakAfterMin?: number; nextUp?: Array<{ id: string; title: string; priority: number }>; rationale?: string; message?: string }
interface SummaryResult { date?: string; createdToday?: number; completedToday?: number; openTotal?: number; overdueCount?: number; throughput?: string; completedByProject?: Record<string, number> }

export function ProductivityActionPanel() {
  const [taskTitle, setTaskTitle] = useState('');
  const [taskProject, setTaskProject] = useState('Inbox');
  const [taskPriority, setTaskPriority] = useState<1 | 2 | 3 | 4>(4);
  const [taskDue, setTaskDue] = useState('');
  const [filterProject, setFilterProject] = useState('_all_');
  const [filterStatus, setFilterStatus] = useState<'open' | 'done' | 'all'>('open');
  const [energy, setEnergy] = useState<'high' | 'medium' | 'low'>('medium');
  const [recipient, setRecipient] = useState('');

  // Local task pool drives the macros (artifact emulation)
  const [tasks, setTasks] = useState<Task[]>([]);

  const [busy, setBusy] = useState<ActionId | null>(null);
  const [feedback, setFeedback] = useState<Feedback>(null);

  const [filterResult, setFilterResult] = useState<FilterResult | null>(null);
  const [focusResult, setFocusResult] = useState<FocusResult | null>(null);
  const [summaryResult, setSummaryResult] = useState<SummaryResult | null>(null);
  const [mintedDtuId, setMintedDtuId] = useState<string | null>(null);
  const [publishedDtuId, setPublishedDtuId] = useState<string | null>(null);
  const [agentReply, setAgentReply] = useState<string | null>(null);

  const ok  = (text: string) => setFeedback({ kind: 'ok',  text });
  const err = (text: string) => setFeedback({ kind: 'err', text });

  const pipe = usePipe();
  const dmRecall = useRecallableAction({
    label: 'DM',
    windowMs: 60_000,
    onUndo: async (id) => { await api.delete(`/api/social/dm/${encodeURIComponent(id)}`); },
  });
  const publishRecall = useRecallableAction({
    label: 'publish',
    windowMs: 30_000,
    onUndo: async (id) => {
      await api.delete(`/api/dtus/${encodeURIComponent(id)}/publish`);
      setPublishedDtuId(null);
    },
  });

  async function actCreate() {
    if (!taskTitle.trim()) { err('Task title required.'); return; }
    setBusy('create'); setFeedback(null);
    // Local-first; macro confirms shape but lens-data substrate persistence is via artifact create elsewhere.
    const newTask: Task = {
      id: `task-${Date.now()}`,
      title: taskTitle.trim(),
      project: taskProject || 'Inbox',
      priority: taskPriority,
      dueDate: taskDue || null,
      completed: false,
      createdAt: new Date().toISOString(),
    };
    setTasks(prev => [...prev, newTask]);
    setTaskTitle(''); setTaskDue('');
    pipe.publish('productivity.task', newTask, { label: `P${taskPriority} · ${newTask.title}` });
    ok(`Task created (P${taskPriority}).`);
    setBusy(null);
  }

  function toggle(id: string) {
    setTasks(prev => prev.map(t => t.id === id ? { ...t, completed: !t.completed, completedAt: !t.completed ? new Date().toISOString() : undefined } as Task : t));
  }

  async function actFilter() {
    setBusy('filter'); setFeedback(null);
    try {
      const r = await callMacro<FilterResult>('projectFilter', { project: filterProject, status: filterStatus });
      // Macro expects artifact.data.tasks — supply via inline artifact shape
      // (the new productivity domain reads artifact.data.tasks). Inject by sending alongside.
      if (r.ok && r.result) {
        // Apply filter locally too so users see live result
        const matches = tasks.filter(t => {
          if (filterProject !== '_all_' && t.project !== filterProject) return false;
          if (filterStatus === 'open' && t.completed) return false;
          if (filterStatus === 'done' && !t.completed) return false;
          return true;
        });
        const byPriority: Record<string, number> = { '1': 0, '2': 0, '3': 0, '4': 0 };
        for (const t of matches) byPriority[String(t.priority || 4)]++;
        const next: FilterResult = { project: filterProject, status: filterStatus, count: matches.length, tasks: matches.slice(0, 50), byPriority };
        setFilterResult(next);
        pipe.publish('productivity.filter', next, { label: `${matches.length} match` });
        ok(`${matches.length} task${matches.length === 1 ? '' : 's'} match.`);
      } else err(r.error ?? 'filter failed');
    } catch (e) { err(pickMessage(e)); }
    finally { setBusy(null); }
  }

  async function actFocus() {
    const open = tasks.filter(t => !t.completed);
    if (open.length === 0) { err('No open tasks. Create some first.'); return; }
    setBusy('focus'); setFeedback(null);
    // Local sort matching macro logic
    const sorted = [...open].sort((a, b) => {
      if (energy === 'high') return (a.priority || 4) - (b.priority || 4);
      if (energy === 'low') return (b.priority || 4) - (a.priority || 4);
      return ((a.priority || 4) + (b.id.length % 3)) - ((b.priority || 4) + (a.id.length % 3));
    });
    const next: FocusResult = {
      energy,
      candidate: sorted[0],
      durationMin: 25,
      breakAfterMin: 5,
      nextUp: sorted.slice(1, 4).map(t => ({ id: t.id, title: t.title, priority: t.priority })),
      rationale: energy === 'high' ? "Highest-priority task first — your energy can carry it." : energy === 'low' ? "Quick wins first — momentum > intensity." : "Mixed priority — alternate hard and easy.",
    };
    setFocusResult(next);
    pipe.publish('productivity.focus', next, { label: `focus · ${next.candidate?.title ?? ''}` });
    ok('Focus block ready.');
    setBusy(null);
  }

  async function actSummary() {
    setBusy('summary'); setFeedback(null);
    const date = new Date().toISOString().slice(0, 10);
    const created = tasks.filter(t => (t.createdAt || '').startsWith(date));
    const completed = tasks.filter(t => t.completed && ((t as Task & { completedAt?: string }).completedAt || '').startsWith(date));
    const stillOpen = tasks.filter(t => !t.completed);
    const overdue = stillOpen.filter(t => t.dueDate && t.dueDate < date);
    const byProject: Record<string, number> = {};
    for (const t of completed) byProject[t.project || 'Inbox'] = (byProject[t.project || 'Inbox'] || 0) + 1;
    const next: SummaryResult = {
      date,
      createdToday: created.length,
      completedToday: completed.length,
      openTotal: stillOpen.length,
      overdueCount: overdue.length,
      throughput: completed.length > 0 && created.length > 0 ? Math.round((completed.length / created.length) * 100) + '%' : '—',
      completedByProject: byProject,
    };
    setSummaryResult(next);
    pipe.publish('productivity.summary', next, { label: `${next.completedToday}/${next.createdToday} done` });
    ok('Summary ready.');
    setBusy(null);
  }

  async function actMint() {
    setBusy('mint'); setFeedback(null);
    try {
      const r = await lensRun({
        domain: 'dtu', name: 'create',
        input: {
          title: `Tasks — ${new Date().toISOString().slice(0, 10)}`,
          tags: ['productivity', 'tasks', `count:${tasks.length}`],
          source: 'productivity:snapshot:mint',
          meta: { visibility: 'private', consent: { allowCitations: false }, productivity: { tasks, summary: summaryResult, focus: focusResult } },
        },
      });
      const dtu = r.data?.result?.dtu ?? r.data?.result;
      const id = dtu?.id ?? dtu?.dtuId;
      if (id) { setMintedDtuId(id); pipe.publish('productivity.mintedDtuId', id, { label: `snapshot ${id.slice(0, 8)}` }); ok(`Snapshot DTU ${id.slice(0, 8)}…`); }
      else err('No DTU id returned.');
    } catch (e) { err(pickMessage(e)); }
    finally { setBusy(null); }
  }

  async function actDm() {
    if (!recipient.trim()) { err('Enter a recipient.'); return; }
    setBusy('dm'); setFeedback(null);
    const open = tasks.filter(t => !t.completed);
    const body = [
      `✅ Today's tasks — ${new Date().toLocaleDateString()}`,
      '',
      summaryResult ? `Open: ${summaryResult.openTotal} · done today: ${summaryResult.completedToday}${summaryResult.overdueCount ? ` · overdue: ${summaryResult.overdueCount}` : ''}` : `Open: ${open.length}`,
      '',
      open.slice(0, 10).map(t => `  [P${t.priority}] ${t.title}${t.dueDate ? ` (due ${t.dueDate})` : ''}`).join('\n'),
    ].filter(Boolean).join('\n');
    try {
      const messageId = await dmRecall.run(async () => {
        const r = await api.post('/api/social/dm', { toUserId: recipient.trim(), content: body });
        if (r.data?.ok === false) throw new Error(r.data?.error ?? 'send failed');
        return r.data?.message?.id as string;
      });
      if (messageId) { ok('Sent. 60s to recall.'); setRecipient(''); }
    } catch (e) { err(pickMessage(e)); }
    finally { setBusy(null); }
  }

  async function actPublish() {
    if (!summaryResult) { err('Run a summary first.'); return; }
    setBusy('publish'); setFeedback(null);
    try {
      const id = await publishRecall.run(async () => {
        const r = await lensRun({
          domain: 'dtu', name: 'create',
          input: {
            title: `Daily throughput — ${summaryResult.date}`,
            tags: ['productivity', 'public', 'throughput'],
            source: 'productivity:throughput:publish',
            meta: { visibility: 'public', consent: { allowCitations: true }, anonymized: true, summary: { date: summaryResult.date, completedToday: summaryResult.completedToday, throughput: summaryResult.throughput } },
          },
        });
        const dtu = r.data?.result?.dtu ?? r.data?.result;
        const newId = dtu?.id ?? dtu?.dtuId;
        if (!newId) throw new Error('No DTU id returned.');
        const pub = await api.post(`/api/dtus/${encodeURIComponent(newId)}/publish`);
        if (pub.data?.ok === false) throw new Error(pub.data?.error ?? 'publish flag failed');
        return newId as string;
      });
      if (id) { setPublishedDtuId(id); pipe.publish('productivity.publishedDtuId', id, { label: `throughput ${id.slice(0, 8)}` }); ok(`Throughput published ${id.slice(0, 8)}… · 30s to recall.`); }
    } catch (e) { err(pickMessage(e)); }
    finally { setBusy(null); }
  }

  async function actAgent() {
    setBusy('agent'); setFeedback(null); setAgentReply(null);
    try {
      const open = tasks.filter(t => !t.completed);
      const task = [
        `${open.length} open tasks across projects.`,
        `Energy level: ${energy}.`,
        focusResult?.candidate ? `Currently focused on: "${focusResult.candidate.title}" (P${focusResult.candidate.priority}).` : '',
        '',
        'Recommend the ideal 3-task ordering for the next 2 hours.',
        'For each task, give one sentence on why it goes in that slot. Plain text.',
        open.slice(0, 8).map(t => `[P${t.priority}] ${t.title}`).join('; '),
      ].filter(Boolean).join(' ');
      const r = await lensRun({ domain: 'chat_agent', name: 'do', input: { task, maxTurns: 4 } });
      const reply = r.data?.result?.reply ?? r.data?.result?.summary ?? r.data?.result?.output;
      if (reply) { setAgentReply(typeof reply === 'string' ? reply : JSON.stringify(reply, null, 2)); ok('Ordering ready.'); }
      else err('Agent returned empty.');
    } catch (e) { err(pickMessage(e)); }
    finally { setBusy(null); }
  }

  const actions: Array<{ id: ActionId; label: string; desc: string; icon: React.ComponentType<{ className?: string }>; accent: string; handler: () => void; disabled?: boolean }> = [
    { id: 'create',  label: 'Create',  desc: 'taskCreate add to inbox',                  icon: CheckSquare, accent: '#06b6d4', handler: actCreate },
    { id: 'filter',  label: 'Filter',  desc: 'projectFilter by project + status',        icon: Filter,      accent: '#8b5cf6', handler: actFilter },
    { id: 'focus',   label: 'Focus',   desc: 'focusBlock 25-min pomodoro pick',          icon: Timer,       accent: '#f97316', handler: actFocus },
    { id: 'summary', label: 'Summary', desc: 'dailySummary throughput',                  icon: BarChart3,   accent: '#22c55e', handler: actSummary },
    { id: 'mint',    label: mintedDtuId      ? 'Saved'     : 'Mint',         desc: mintedDtuId      ? `DTU ${mintedDtuId.slice(0, 8)}…`     : 'Private snapshot DTU',                   icon: Sparkles, accent: '#3b82f6', handler: actMint },
    { id: 'dm',      label: 'DM',     desc: 'Send today\'s open tasks',                 icon: Send,        accent: '#ec4899', handler: actDm },
    { id: 'publish', label: publishedDtuId ? 'Published' : 'Publish throughput', desc: publishedDtuId ? `DTU ${publishedDtuId.slice(0, 8)}…` : 'Anonymized throughput DTU + federation', icon: Globe,    accent: '#15803d', handler: actPublish, disabled: !summaryResult },
    { id: 'agent',   label: 'Order',   desc: 'Agent orders next 3 tasks for 2h',         icon: Wand2,       accent: '#eab308', handler: actAgent },
  ];

  return (
    <div className="rounded-lg border border-cyan-500/20 bg-zinc-950/60 p-3 space-y-3">
      <header className="flex items-center gap-2 border-b border-cyan-500/10 pb-2">
        <CheckSquare className="h-4 w-4 text-cyan-400" />
        <h3 className="text-sm font-semibold text-white">Task workbench</h3>
        <span className="ml-auto text-[10px] text-zinc-400 font-mono">{tasks.filter(t => !t.completed).length}/{tasks.length} open</span>
      </header>

      <div className="grid grid-cols-1 md:grid-cols-6 gap-2">
        <input type="text" value={taskTitle} onChange={(e) => setTaskTitle(e.target.value)} onKeyDown={(e) => { if (e.key === 'Enter') actCreate(); }} className="md:col-span-3 bg-zinc-900 border border-zinc-800 rounded px-3 py-1.5 text-[12px] text-white focus:outline-none focus:ring-2 focus:ring-cyan-400/40" placeholder="New task title (Enter to add)" />
        <input type="text" value={taskProject} onChange={(e) => setTaskProject(e.target.value)} className="bg-zinc-900 border border-zinc-800 rounded px-3 py-1.5 text-[12px] text-white" placeholder="Project" />
        <select value={taskPriority} onChange={(e) => setTaskPriority(parseInt(e.target.value, 10) as 1 | 2 | 3 | 4)} className="bg-zinc-900 border border-zinc-800 rounded px-3 py-1.5 text-[12px] text-white">
          <option value={1}>P1</option><option value={2}>P2</option><option value={3}>P3</option><option value={4}>P4</option>
        </select>
        <input type="date" value={taskDue} onChange={(e) => setTaskDue(e.target.value)} className="bg-zinc-900 border border-zinc-800 rounded px-3 py-1.5 text-[12px] text-white" />
      </div>

      <div className="grid grid-cols-2 md:grid-cols-4 gap-2">
        <input type="text" value={filterProject} onChange={(e) => setFilterProject(e.target.value)} className="bg-zinc-900 border border-zinc-800 rounded px-3 py-1.5 text-[11px] text-white" placeholder="Filter project (_all_)" />
        <select value={filterStatus} onChange={(e) => setFilterStatus(e.target.value as typeof filterStatus)} className="bg-zinc-900 border border-zinc-800 rounded px-3 py-1.5 text-[11px] text-white">
          <option value="open">Open</option><option value="done">Done</option><option value="all">All</option>
        </select>
        <select value={energy} onChange={(e) => setEnergy(e.target.value as typeof energy)} className="bg-zinc-900 border border-zinc-800 rounded px-3 py-1.5 text-[11px] text-white">
          <option value="high">⚡ High energy</option><option value="medium">⚖️ Medium</option><option value="low">😴 Low</option>
        </select>
        <input type="text" value={recipient} onChange={(e) => setRecipient(e.target.value)} className="bg-zinc-900 border border-zinc-800 rounded px-3 py-1.5 text-[11px] text-white" placeholder="DM recipient" />
      </div>

      <div className="flex items-center gap-2 flex-wrap">
        <RecallSlot ctl={dmRecall} />
        <RecallSlot ctl={publishRecall} />
      </div>

      <div className="grid grid-cols-2 md:grid-cols-4 lg:grid-cols-8 gap-2">
        {actions.map(a => {
          const Icon = a.icon;
          const isBusy = busy === a.id;
          return (
            <button key={a.id} type="button" disabled={a.disabled || !!busy} onClick={a.handler}
              className={cn('group flex flex-col items-start gap-1.5 p-2.5 rounded-lg text-left border transition-all', 'bg-zinc-900/40 border-zinc-800 hover:bg-zinc-800/60 hover:border-zinc-700', 'disabled:opacity-40 disabled:cursor-not-allowed')}>
              <div className="w-7 h-7 rounded-md flex items-center justify-center" style={{ backgroundColor: a.accent + '20', color: a.accent }}>
                {isBusy ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Icon className="w-3.5 h-3.5" />}
              </div>
              <div className="text-[12px] font-semibold text-zinc-100 leading-tight">{a.label}</div>
              <div className="text-[10px] text-zinc-400 leading-tight line-clamp-2">{a.desc}</div>
            </button>
          );
        })}
      </div>

      {/* Task list */}
      {tasks.length > 0 && (
        <div className="rounded-md border border-zinc-800 bg-zinc-900/40 p-2 space-y-1 max-h-60 overflow-y-auto">
          {tasks.map(t => (
            <label key={t.id} className="flex items-center gap-2 text-[12px] cursor-pointer hover:bg-zinc-800/60 px-2 py-1 rounded">
              <input type="checkbox" checked={t.completed} onChange={() => toggle(t.id)} className="rounded" />
              <span className={cn('flex-shrink-0 rounded px-1 text-[9px] font-mono', t.priority === 1 ? 'bg-rose-500/20 text-rose-300' : t.priority === 2 ? 'bg-orange-500/20 text-orange-300' : t.priority === 3 ? 'bg-yellow-500/20 text-yellow-300' : 'bg-zinc-700/40 text-zinc-400')}>P{t.priority}</span>
              <span className={cn('flex-1', t.completed && 'line-through text-zinc-400')}>{t.title}</span>
              <span className="text-[10px] text-zinc-400">{t.project}</span>
              {t.dueDate && <span className="text-[10px] text-cyan-400 font-mono">{t.dueDate}</span>}
            </label>
          ))}
        </div>
      )}

      {focusResult?.candidate && (
        <div className="rounded-md border border-orange-500/30 bg-orange-500/5 p-3">
          <div className="text-[10px] uppercase tracking-wider text-orange-300 font-semibold flex items-center gap-1.5 mb-1"><Timer className="w-3 h-3" /> Focus block ({focusResult.energy} energy)</div>
          <div className="text-sm font-semibold text-zinc-100">{focusResult.candidate.title}</div>
          <div className="text-[10px] text-zinc-400">P{focusResult.candidate.priority} · {focusResult.candidate.project} · {focusResult.durationMin}m work + {focusResult.breakAfterMin}m break</div>
          <div className="text-[10px] text-zinc-400 italic mt-1">{focusResult.rationale}</div>
          {focusResult.nextUp && focusResult.nextUp.length > 0 && (
            <div className="text-[10px] text-zinc-400 mt-2">Up next: {focusResult.nextUp.map(t => `P${t.priority} ${t.title}`).join(' · ')}</div>
          )}
        </div>
      )}

      {summaryResult && (
        <div className="grid grid-cols-2 md:grid-cols-5 gap-2">
          <Tile label="Created" big={`${summaryResult.createdToday}`} accent="#06b6d4" />
          <Tile label="Done" big={`${summaryResult.completedToday}`} accent="#22c55e" />
          <Tile label="Open" big={`${summaryResult.openTotal}`} accent="#8b5cf6" />
          <Tile label="Overdue" big={`${summaryResult.overdueCount}`} accent={summaryResult.overdueCount ? '#ef4444' : '#71717a'} />
          <Tile label="Throughput" big={summaryResult.throughput ?? '—'} accent="#eab308" />
        </div>
      )}

      {filterResult && filterResult.count != null && (
        <div className="rounded-md border border-purple-500/30 bg-purple-500/5 p-2.5 text-[11px] text-zinc-300">
          <strong className="text-purple-300">{filterResult.count}</strong> match
          {filterResult.byPriority && (
            <span className="ml-2">
              {Object.entries(filterResult.byPriority).map(([p, c]) => <span key={p} className="ml-2 font-mono">P{p}:{c}</span>)}
            </span>
          )}
        </div>
      )}

      {agentReply && (
        <div className="rounded-md border border-yellow-500/30 bg-yellow-500/5 p-3 max-h-72 overflow-y-auto">
          <div className="flex items-center gap-1.5 text-yellow-400 font-semibold mb-1.5 uppercase tracking-wider text-[10px]"><Wand2 className="w-3 h-3" /> 2-hour ordering</div>
          <pre className="whitespace-pre-wrap font-sans text-[11px] text-zinc-200 leading-relaxed">{agentReply}</pre>
        </div>
      )}

      <AnimatePresence>
        {feedback && (
          <motion.div key={feedback.text} initial={{ opacity: 0, y: -2 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: -2 }}
            className={cn('px-3 py-2 rounded text-[11px] flex items-start gap-2 border', feedback.kind === 'ok' ? 'bg-emerald-500/10 text-emerald-300 border-emerald-500/30' : 'bg-red-500/10 text-red-300 border-red-500/30')}>
            {feedback.kind === 'ok' ? <Check className="h-3 w-3 mt-0.5" /> : <AlertTriangle className="h-3 w-3 mt-0.5" />}
            <span>{feedback.text}</span>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}

function Tile({ label, big, accent }: { label: string; big: string; accent: string }) {
  return (
    <div className="rounded-md border p-2.5" style={{ borderColor: accent + '60', backgroundColor: accent + '10' }}>
      <div className="text-[10px] uppercase tracking-wider text-zinc-400 font-semibold">{label}</div>
      <div className="text-2xl font-bold" style={{ color: accent }}>{big}</div>
    </div>
  );
}
