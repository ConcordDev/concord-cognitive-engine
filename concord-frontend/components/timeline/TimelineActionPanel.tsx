'use client';

/**
 * TimelineActionPanel — PM/timeline bench.
 * criticalPath / ganttSchedule / temporalClustering / trendAnalysis +
 * mint/DM/publish/agent.
 */

import { useState } from 'react';
import { GitBranch, Calendar, Layers, TrendingUp, Sparkles, Send, Globe, Wand2, Loader2, Check, AlertTriangle } from 'lucide-react';
import { motion, AnimatePresence } from 'framer-motion';
import { api, apiHelpers } from '@/lib/api/client';
import { cn } from '@/lib/utils';

interface MacroEnvelope<T> { ok: boolean; result?: T; error?: string }
async function callMacro<T>(action: string, input: Record<string, unknown>): Promise<MacroEnvelope<T>> {
  const r = await apiHelpers.lens.runDomain('timeline', action, { input });
  const data = (r as { data?: { ok: boolean; result?: T; error?: string } }).data;
  if (!data) return { ok: false, error: 'empty response' };
  if (data.ok && data.result && typeof data.result === 'object' && 'ok' in data.result) return data.result as MacroEnvelope<T>;
  return data as MacroEnvelope<T>;
}

type Feedback = { kind: 'ok' | 'err'; text: string } | null;
type ActionId = 'cpm' | 'gantt' | 'cluster' | 'trend' | 'mint' | 'dm' | 'publish' | 'agent';
function pickMessage(e: unknown): string { const ax = e as { response?: { data?: { error?: string } }; message?: string }; return ax?.response?.data?.error ?? ax?.message ?? 'request failed'; }

interface CpmTask { id: string; name: string; duration: number; earliestStart: number; earliestFinish: number; slack: number; isCritical: boolean }
interface CpmResult { tasks: CpmTask[]; projectDuration: number; criticalPath: { id: string; name: string; duration: number }[]; criticalPathLength: number; totalTasks: number; criticalTaskCount: number; averageSlack: number }
interface GanttRow { id: string; name: string; start: number; end: number; resource?: string }
interface GanttResult { schedule?: GanttRow[]; projectEnd?: number; maxParallelUsed?: number }
interface ClusterResult { clusters?: { start: number; end: number; count: number; densityPerDay: number }[]; totalEvents?: number; clustersDetected?: number; insight?: string }
interface TrendResult { direction?: string; slope?: number; rSquared?: number; volatility?: number; momentum?: string }

const DEFAULT_TASKS = JSON.stringify({ tasks: [{ id: 'A', name: 'Spec', duration: 5 }, { id: 'B', name: 'Design', duration: 8, dependencies: ['A'] }, { id: 'C', name: 'Backend', duration: 12, dependencies: ['B'] }, { id: 'D', name: 'Frontend', duration: 10, dependencies: ['B'] }, { id: 'E', name: 'Integration', duration: 6, dependencies: ['C', 'D'] }, { id: 'F', name: 'QA', duration: 5, dependencies: ['E'] }, { id: 'G', name: 'Launch', duration: 2, dependencies: ['F'] }] }, null, 2);
const DEFAULT_CLUSTER = JSON.stringify({ events: [{ timestamp: '2026-05-01T10:00Z' }, { timestamp: '2026-05-01T11:30Z' }, { timestamp: '2026-05-01T13:00Z' }, { timestamp: '2026-05-04T09:00Z' }, { timestamp: '2026-05-10T15:00Z' }, { timestamp: '2026-05-10T15:30Z' }, { timestamp: '2026-05-10T16:00Z' }, { timestamp: '2026-05-10T16:45Z' }, { timestamp: '2026-05-14T09:00Z' }] }, null, 2);
const DEFAULT_TREND = JSON.stringify({ series: Array.from({ length: 30 }).map((_, i) => ({ t: i, value: 100 + i * 1.6 + Math.sin(i * 0.3) * 8 })) }, null, 2);

export function TimelineActionPanel() {
  const [tasksText, setTasksText] = useState(DEFAULT_TASKS);
  const [clusterText, setClusterText] = useState(DEFAULT_CLUSTER);
  const [trendText, setTrendText] = useState(DEFAULT_TREND);
  const [recipient, setRecipient] = useState('');

  const [busy, setBusy] = useState<ActionId | null>(null);
  const [feedback, setFeedback] = useState<Feedback>(null);
  const [cpmResult, setCpmResult] = useState<CpmResult | null>(null);
  const [ganttResult, setGanttResult] = useState<GanttResult | null>(null);
  const [clusterResult, setClusterResult] = useState<ClusterResult | null>(null);
  const [trendResult, setTrendResult] = useState<TrendResult | null>(null);
  const [mintedDtuId, setMintedDtuId] = useState<string | null>(null);
  const [publishedDtuId, setPublishedDtuId] = useState<string | null>(null);
  const [agentReply, setAgentReply] = useState<string | null>(null);

  const ok = (m: string) => setFeedback({ kind: 'ok', text: m });
  const err = (m: string) => setFeedback({ kind: 'err', text: m });

  async function actCpm() {
    try { const parsed = JSON.parse(tasksText); setBusy('cpm'); setFeedback(null);
      const r = await callMacro<CpmResult>('criticalPath', { artifact: { data: parsed } });
      if (r.ok && r.result) { setCpmResult(r.result); ok(`${r.result.projectDuration}d · ${r.result.criticalTaskCount}/${r.result.totalTasks} critical`); } else err(r.error ?? 'cpm failed');
    } catch (e) { err(e instanceof SyntaxError ? 'Invalid tasks JSON.' : pickMessage(e)); } finally { setBusy(null); }
  }
  async function actGantt() {
    try { const parsed = JSON.parse(tasksText); setBusy('gantt'); setFeedback(null);
      const r = await callMacro<GanttResult>('ganttSchedule', { artifact: { data: parsed } });
      if (r.ok && r.result) { setGanttResult(r.result); ok(`Project ends day ${r.result.projectEnd ?? '?'}`); } else err(r.error ?? 'gantt failed');
    } catch (e) { err(e instanceof SyntaxError ? 'Invalid tasks JSON.' : pickMessage(e)); } finally { setBusy(null); }
  }
  async function actCluster() {
    try { const parsed = JSON.parse(clusterText); setBusy('cluster'); setFeedback(null);
      const r = await callMacro<ClusterResult>('temporalClustering', { artifact: { data: parsed } });
      if (r.ok && r.result) { setClusterResult(r.result); ok(`${r.result.clustersDetected ?? 0} clusters in ${r.result.totalEvents ?? 0} events`); } else err(r.error ?? 'cluster failed');
    } catch (e) { err(e instanceof SyntaxError ? 'Invalid cluster JSON.' : pickMessage(e)); } finally { setBusy(null); }
  }
  async function actTrend() {
    try { const parsed = JSON.parse(trendText); setBusy('trend'); setFeedback(null);
      const r = await callMacro<TrendResult>('trendAnalysis', { artifact: { data: parsed } });
      if (r.ok && r.result) { setTrendResult(r.result); ok(`${r.result.direction ?? '?'} · R²=${r.result.rSquared?.toFixed?.(2)}`); } else err(r.error ?? 'trend failed');
    } catch (e) { err(e instanceof SyntaxError ? 'Invalid trend JSON.' : pickMessage(e)); } finally { setBusy(null); }
  }
  async function actMint() {
    setBusy('mint'); setFeedback(null);
    try {
      const r = await api.post('/api/lens/run', { domain: 'dtu', name: 'create', input: { title: `Timeline brief`, tags: ['timeline', trendResult?.direction, clusterResult?.clustersDetected ? 'clustered' : ''].filter((t): t is string => !!t), source: 'timeline:brief:mint', meta: { visibility: 'private', consent: { allowCitations: false }, timeline: { cpm: cpmResult, gantt: ganttResult, cluster: clusterResult, trend: trendResult } } } });
      const id = r.data?.result?.dtu?.id ?? r.data?.dtu?.id ?? r.data?.result?.id;
      if (id) { setMintedDtuId(id); ok(`Brief DTU ${id.slice(0, 8)}…`); } else err('No DTU id.');
    } catch (e) { err(pickMessage(e)); } finally { setBusy(null); }
  }
  async function actDm() {
    if (!recipient.trim()) { err('Recipient required.'); return; }
    setBusy('dm'); setFeedback(null);
    const body = [`📅 Timeline brief`, '', cpmResult ? `CPM: ${cpmResult.projectDuration}d project · ${cpmResult.criticalTaskCount} critical tasks (${cpmResult.criticalPath.map(c => c.id).join(' → ')})` : '', ganttResult ? `Gantt: project end day ${ganttResult.projectEnd ?? '?'} · max parallel ${ganttResult.maxParallelUsed ?? '?'}` : '', clusterResult ? `Clusters: ${clusterResult.clustersDetected ?? 0} bursts in ${clusterResult.totalEvents ?? 0} events` : '', trendResult ? `Trend: ${trendResult.direction ?? '?'} · slope ${trendResult.slope?.toFixed?.(2)} · R²=${trendResult.rSquared?.toFixed?.(2)} · ${trendResult.momentum ?? ''}` : '', mintedDtuId ? `\n[DTU ${mintedDtuId}]` : ''].filter(Boolean).join('\n');
    try { const r = await api.post('/api/social/dm', { toUserId: recipient.trim(), content: body }); if (r.data?.ok !== false) { ok('Sent.'); setRecipient(''); } else err(r.data?.error ?? 'send failed'); }
    catch (e) { err(pickMessage(e)); } finally { setBusy(null); }
  }
  async function actPublish() {
    if (!cpmResult) { err('Run CPM first.'); return; }
    setBusy('publish'); setFeedback(null);
    try {
      const r = await api.post('/api/lens/run', { domain: 'dtu', name: 'create', input: { title: `Project plan`, tags: ['timeline', 'plan', 'public'], source: 'timeline:plan:publish', meta: { visibility: 'public', consent: { allowCitations: true }, anon: true, timeline: { cpm: cpmResult, gantt: ganttResult } } } });
      const id = r.data?.result?.dtu?.id ?? r.data?.dtu?.id ?? r.data?.result?.id;
      if (!id) { err('No DTU id.'); return; }
      const pub = await api.post(`/api/dtus/${encodeURIComponent(id)}/publish`);
      if (pub.data?.ok !== false) { setPublishedDtuId(id); ok(`Published ${id.slice(0, 8)}…`); } else err(pub.data?.error ?? 'publish failed');
    } catch (e) { err(pickMessage(e)); } finally { setBusy(null); }
  }
  async function actAgent() {
    setBusy('agent'); setFeedback(null); setAgentReply(null);
    try {
      const task = `Project manager brief. ${cpmResult ? `CPM: ${cpmResult.projectDuration}d critical path (${cpmResult.criticalPath.map(c => c.name).slice(0, 4).join(' → ')}); avg slack ${cpmResult.averageSlack}.` : ''} ${ganttResult ? `Gantt scheduled to day ${ganttResult.projectEnd ?? '?'}, max parallel ${ganttResult.maxParallelUsed ?? '?'}.` : ''} ${clusterResult ? `Activity: ${clusterResult.clustersDetected ?? 0} bursts in ${clusterResult.totalEvents ?? 0} events.` : ''} ${trendResult ? `Trend: ${trendResult.direction ?? '?'} (R²=${trendResult.rSquared?.toFixed?.(2)}).` : ''} Identify the highest schedule-risk task + one acceleration lever. Plain text, ≤ 3 sentences.`;
      const r = await api.post('/api/lens/run', { domain: 'chat_agent', name: 'do', input: { task, maxTurns: 3 } });
      const reply = r.data?.result?.reply ?? r.data?.result?.summary ?? r.data?.result?.output ?? r.data?.reply;
      if (reply) { setAgentReply(typeof reply === 'string' ? reply : JSON.stringify(reply, null, 2)); ok('PM brief ready.'); } else err('Agent returned empty.');
    } catch (e) { err(pickMessage(e)); } finally { setBusy(null); }
  }

  const actions = [
    { id: 'cpm' as ActionId, label: 'CPM', desc: 'criticalPath', icon: GitBranch, accent: '#ef4444', handler: actCpm },
    { id: 'gantt' as ActionId, label: 'Gantt', desc: 'ganttSchedule', icon: Calendar, accent: '#3b82f6', handler: actGantt },
    { id: 'cluster' as ActionId, label: 'Clusters', desc: 'temporalClustering', icon: Layers, accent: '#a855f7', handler: actCluster },
    { id: 'trend' as ActionId, label: 'Trend', desc: 'trendAnalysis', icon: TrendingUp, accent: '#22c55e', handler: actTrend },
    { id: 'mint' as ActionId, label: mintedDtuId ? 'Saved' : 'Mint', desc: mintedDtuId ? `${mintedDtuId.slice(0, 8)}…` : 'Private brief', icon: Sparkles, accent: '#06b6d4', handler: actMint },
    { id: 'dm' as ActionId, label: 'DM', desc: 'Send brief', icon: Send, accent: '#ec4899', handler: actDm },
    { id: 'publish' as ActionId, label: publishedDtuId ? 'Published' : 'Publish', desc: publishedDtuId ? `${publishedDtuId.slice(0, 8)}…` : 'Public plan', icon: Globe, accent: '#15803d', handler: actPublish },
    { id: 'agent' as ActionId, label: 'PM', desc: 'Agent: schedule risk', icon: Wand2, accent: '#eab308', handler: actAgent },
  ];

  return (
    <div className="rounded-lg border border-blue-500/20 bg-zinc-950/60 p-3 space-y-3">
      <header className="flex items-center gap-2 border-b border-blue-500/10 pb-2">
        <Calendar className="h-4 w-4 text-blue-400" />
        <h3 className="text-sm font-semibold text-white">Timeline / PM bench</h3>
        <span className="rounded bg-zinc-800 px-1.5 py-0.5 font-mono text-[10px] uppercase tracking-wider text-zinc-400">CPM · Gantt · clusters · trend</span>
      </header>

      <div className="grid grid-cols-1 md:grid-cols-3 gap-2">
        <div>
          <label className="text-[10px] uppercase tracking-wider text-red-400 font-semibold">Tasks JSON (CPM + Gantt)</label>
          <textarea value={tasksText} onChange={(e) => setTasksText(e.target.value)} rows={6} className="w-full bg-zinc-900 border border-zinc-800 rounded px-3 py-1 text-[10px] text-white font-mono mt-1" />
        </div>
        <div>
          <label className="text-[10px] uppercase tracking-wider text-purple-400 font-semibold">Events JSON</label>
          <textarea value={clusterText} onChange={(e) => setClusterText(e.target.value)} rows={6} className="w-full bg-zinc-900 border border-zinc-800 rounded px-3 py-1 text-[10px] text-white font-mono mt-1" />
        </div>
        <div>
          <label className="text-[10px] uppercase tracking-wider text-green-400 font-semibold">Trend series JSON</label>
          <textarea value={trendText} onChange={(e) => setTrendText(e.target.value)} rows={6} className="w-full bg-zinc-900 border border-zinc-800 rounded px-3 py-1 text-[10px] text-white font-mono mt-1" />
        </div>
        <input type="text" value={recipient} onChange={(e) => setRecipient(e.target.value)} className="md:col-span-3 bg-zinc-900 border border-zinc-800 rounded px-3 py-1.5 text-[11px] text-white" placeholder="DM recipient user-id" />
      </div>

      <div className="grid grid-cols-2 md:grid-cols-4 lg:grid-cols-8 gap-2">
        {actions.map(act => {
          const Icon = act.icon; const isBusy = busy === act.id;
          return (
            <button key={act.id} type="button" disabled={!!busy} onClick={act.handler}
              className={cn('flex flex-col items-start gap-1.5 p-2.5 rounded-lg text-left border transition-all', 'bg-zinc-900/40 border-zinc-800 hover:bg-zinc-800/60 hover:border-zinc-700', 'disabled:opacity-40 disabled:cursor-not-allowed')}>
              <div className="w-7 h-7 rounded-md flex items-center justify-center" style={{ backgroundColor: act.accent + '20', color: act.accent }}>
                {isBusy ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Icon className="w-3.5 h-3.5" />}
              </div>
              <div className="text-[11px] font-semibold text-zinc-100 leading-tight">{act.label}</div>
              <div className="text-[10px] text-zinc-500 leading-tight line-clamp-2">{act.desc}</div>
            </button>
          );
        })}
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-2">
        {cpmResult && (
          <div className="rounded-md border border-red-500/30 bg-red-500/5 p-2.5 max-h-44 overflow-y-auto">
            <div className="text-[10px] uppercase tracking-wider text-red-300 font-semibold">CPM · {cpmResult.projectDuration}d</div>
            <div className="text-2xl font-bold text-red-200">{cpmResult.criticalTaskCount}<span className="text-xs text-zinc-400">/{cpmResult.totalTasks}</span></div>
            <div className="text-[10px] text-zinc-500">critical · avg slack {cpmResult.averageSlack}</div>
            <div className="text-[10px] text-zinc-300 mt-1">Path:</div>
            <div className="text-[10px] text-red-200 font-mono">{cpmResult.criticalPath.map(c => c.id).join(' → ')}</div>
            {cpmResult.tasks.slice(0, 5).map((t, i) => <div key={i} className={cn('text-[10px] mt-0.5 flex justify-between', t.isCritical ? 'text-red-300' : 'text-zinc-300')}><span>{t.isCritical ? '★ ' : ''}{t.name}</span><span className="font-mono">{t.duration}d · slack {t.slack}</span></div>)}
          </div>
        )}
        {ganttResult && (
          <div className="rounded-md border border-blue-500/30 bg-blue-500/5 p-2.5 max-h-44 overflow-y-auto">
            <div className="text-[10px] uppercase tracking-wider text-blue-300 font-semibold">Gantt</div>
            <div className="text-2xl font-bold text-blue-200">{ganttResult.projectEnd ?? '?'}<span className="text-xs text-zinc-400">d</span></div>
            <div className="text-[10px] text-zinc-500">max parallel {ganttResult.maxParallelUsed ?? '?'}</div>
            {(ganttResult.schedule ?? []).slice(0, 6).map((s, i) => <div key={i} className="text-[10px] text-zinc-300 mt-0.5 flex items-center gap-2"><span className="font-mono w-12 truncate">{s.id}</span><div className="flex-1 h-1.5 bg-zinc-800 rounded relative" style={{ minWidth: '60px' }}><div className="absolute inset-y-0 bg-blue-400 rounded" style={{ left: `${(s.start / Math.max(1, ganttResult.projectEnd ?? 1)) * 100}%`, width: `${((s.end - s.start) / Math.max(1, ganttResult.projectEnd ?? 1)) * 100}%` }} /></div><span className="font-mono text-blue-200 text-[9px]">{s.start}-{s.end}</span></div>)}
          </div>
        )}
        {clusterResult && (
          <div className="rounded-md border border-purple-500/30 bg-purple-500/5 p-2.5 max-h-44 overflow-y-auto">
            <div className="text-[10px] uppercase tracking-wider text-purple-300 font-semibold">Clusters</div>
            <div className="text-2xl font-bold text-purple-200">{clusterResult.clustersDetected ?? 0}</div>
            <div className="text-[10px] text-zinc-500">{clusterResult.totalEvents ?? 0} events</div>
            {(clusterResult.clusters ?? []).slice(0, 5).map((c, i) => <div key={i} className="text-[10px] text-zinc-300 mt-0.5"><strong>{c.count}</strong> events · {c.densityPerDay.toFixed(2)}/day</div>)}
            {clusterResult.insight && <div className="text-[10px] text-purple-200 mt-1 italic">{clusterResult.insight}</div>}
          </div>
        )}
        {trendResult && (
          <div className="rounded-md border border-green-500/30 bg-green-500/5 p-2.5">
            <div className="text-[10px] uppercase tracking-wider text-green-300 font-semibold">Trend · {trendResult.direction ?? '?'}</div>
            <div className={cn('text-3xl font-bold', trendResult.direction === 'increasing' ? 'text-emerald-300' : trendResult.direction === 'decreasing' ? 'text-red-300' : 'text-blue-300')}>{trendResult.slope?.toFixed?.(2) ?? '?'}</div>
            <div className="text-[10px] text-zinc-300">slope · R²={trendResult.rSquared?.toFixed?.(2) ?? '?'}</div>
            <div className="text-[10px] text-zinc-500">Volatility {trendResult.volatility?.toFixed?.(2)}</div>
            {trendResult.momentum && <div className="text-[10px] text-green-200 mt-1">Momentum: {trendResult.momentum}</div>}
          </div>
        )}
      </div>

      {agentReply && (<div className="rounded-md border border-yellow-500/30 bg-yellow-500/5 p-3 max-h-60 overflow-y-auto"><div className="flex items-center gap-1.5 text-yellow-400 font-semibold mb-1.5 uppercase tracking-wider text-[10px]"><Wand2 className="w-3 h-3" /> PM brief</div><pre className="whitespace-pre-wrap font-sans text-[11px] text-zinc-200 leading-relaxed">{agentReply}</pre></div>)}

      <AnimatePresence>
        {feedback && (<motion.div key={feedback.text} initial={{ opacity: 0, y: -2 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: -2 }} className={cn('px-3 py-2 rounded text-[11px] flex items-start gap-2 border', feedback.kind === 'ok' ? 'bg-emerald-500/10 text-emerald-300 border-emerald-500/30' : 'bg-red-500/10 text-red-300 border-red-500/30')}>{feedback.kind === 'ok' ? <Check className="h-3 w-3 mt-0.5" /> : <AlertTriangle className="h-3 w-3 mt-0.5" />}<span>{feedback.text}</span></motion.div>)}
      </AnimatePresence>
    </div>
  );
}
