'use client';

/**
 * ConstructionActionPanel — GC bench.
 * takeoffEstimate / criticalPath (CPM) / safetyCompliance (OSHA TRIR) /
 * progressReport + mint/DM/publish/agent.
 */

import { useState } from 'react';
import { Hammer, GitBranch, ShieldCheck, TrendingUp, Sparkles, Send, Globe, Wand2, Loader2, Check, AlertTriangle } from 'lucide-react';
import { motion, AnimatePresence } from 'framer-motion';
import { api, apiHelpers } from '@/lib/api/client';
import { cn } from '@/lib/utils';
import { usePipe, useRecallableAction, RecallSlot } from '@/components/panel-polish';

interface MacroEnvelope<T> { ok: boolean; result?: T; error?: string }
async function callMacro<T>(action: string, input: Record<string, unknown>): Promise<MacroEnvelope<T>> {
  const r = await apiHelpers.lens.runDomain('construction', action, { input });
  const data = (r as { data?: { ok: boolean; result?: T } }).data;
  if (!data) return { ok: false, error: 'empty response' };
  if (data.ok && data.result && typeof data.result === 'object' && 'ok' in data.result) return data.result as MacroEnvelope<T>;
  return data as MacroEnvelope<T>;
}

type Feedback = { kind: 'ok' | 'err'; text: string } | null;
type ActionId = 'takeoff' | 'cpm' | 'safety' | 'progress' | 'mint' | 'dm' | 'publish' | 'agent';
function pickMessage(e: unknown): string { const ax = e as { response?: { data?: { error?: string } }; message?: string }; return ax?.response?.data?.error ?? ax?.message ?? 'request failed'; }

interface TakeoffLine { description?: string; quantity: number; unit: string; unitCost: number; wastePercent: number; adjustedQuantity: number; lineCost: number }
interface TakeoffResult { lineItems: TakeoffLine[]; subtotalMaterials: number; laborCost: number; overhead: number; profit: number; grandTotal: number; costPerSqFt?: number | null }
interface CpmTask { name: string; duration: number; earlyStart: number; earlyFinish: number; slack: number; onCriticalPath: boolean }
interface CpmResult { projectDuration: number; criticalPath: string[]; tasks: CpmTask[]; totalTasks: number }
interface SafetyResult { complianceRate: number; checklistResults: { passed: number; failed: number; total: number }; incidentRate: number; incidents: number; workers: number; hoursWorked: number; rating: string; criticalFailures: string[] }
interface ProgPhase { phase?: string; plannedPercent: number; actualPercent: number; variance: number; status: string }
interface ProgResult { phases: ProgPhase[]; overallPlannedPercent: number; overallActualPercent: number; overallVariance: number; projectStatus: string; behindPhases: string[] }

// No seeded examples — paste real takeoff/CPM/safety/phase JSON.
export function ConstructionActionPanel() {
  const [takeoffText, setTakeoffText] = useState('');
  const [tasksText, setTasksText] = useState('');
  const [safetyText, setSafetyText] = useState('');
  const [phasesText, setPhasesText] = useState('');
  const [recipient, setRecipient] = useState('');

  const [busy, setBusy] = useState<ActionId | null>(null);
  const [feedback, setFeedback] = useState<Feedback>(null);
  const [takeoffResult, setTakeoffResult] = useState<TakeoffResult | null>(null);
  const [cpmResult, setCpmResult] = useState<CpmResult | null>(null);
  const [safetyResult, setSafetyResult] = useState<SafetyResult | null>(null);
  const [progResult, setProgResult] = useState<ProgResult | null>(null);
  const [mintedDtuId, setMintedDtuId] = useState<string | null>(null);
  const [publishedDtuId, setPublishedDtuId] = useState<string | null>(null);
  const [agentReply, setAgentReply] = useState<string | null>(null);

  const ok = (m: string) => setFeedback({ kind: 'ok', text: m });
  const err = (m: string) => setFeedback({ kind: 'err', text: m });

  function parseJSON<T>(text: string): T | null { try { return JSON.parse(text) as T; } catch { return null; } }

  const pipe = usePipe();
  const dmRecall = useRecallableAction({ label: 'DM', windowMs: 60_000, onUndo: async (id) => { await api.delete(`/api/social/dm/${encodeURIComponent(id)}`); } });
  const publishRecall = useRecallableAction({ label: 'publish', windowMs: 30_000, onUndo: async (id) => { await api.delete(`/api/dtus/${encodeURIComponent(id)}/publish`); setPublishedDtuId(null); } });

  async function actTakeoff() {
    if (!takeoffText.trim()) { err('Paste takeoff JSON first.'); return; }
    const parsed = parseJSON<Record<string, unknown>>(takeoffText); if (!parsed) { err('Invalid takeoff JSON.'); return; }
    setBusy('takeoff'); setFeedback(null);
    try {
      const r = await callMacro<TakeoffResult>('takeoffEstimate', { artifact: { data: parsed } });
      if (r.ok && r.result) { setTakeoffResult(r.result); pipe.publish('construction.takeoff', r.result, { label: `Takeoff $${r.result.grandTotal.toLocaleString()}` }); ok(`$${r.result.grandTotal.toLocaleString()} grand total.`); } else err(r.error ?? 'takeoff failed');
    } catch (e) { err(pickMessage(e)); } finally { setBusy(null); }
  }
  async function actCpm() {
    if (!tasksText.trim()) { err('Paste CPM tasks JSON first.'); return; }
    const parsed = parseJSON<Record<string, unknown>>(tasksText); if (!parsed) { err('Invalid tasks JSON.'); return; }
    setBusy('cpm'); setFeedback(null);
    try {
      const r = await callMacro<CpmResult>('criticalPath', { artifact: { data: parsed } });
      if (r.ok && r.result) { setCpmResult(r.result); pipe.publish('construction.cpm', r.result, { label: `CPM ${r.result.projectDuration}d` }); ok(`${r.result.projectDuration}d · CP: ${r.result.criticalPath.join(' → ')}.`); } else err(r.error ?? 'cpm failed');
    } catch (e) { err(pickMessage(e)); } finally { setBusy(null); }
  }
  async function actSafety() {
    if (!safetyText.trim()) { err('Paste safety JSON first.'); return; }
    const parsed = parseJSON<Record<string, unknown>>(safetyText); if (!parsed) { err('Invalid safety JSON.'); return; }
    setBusy('safety'); setFeedback(null);
    try {
      const r = await callMacro<SafetyResult>('safetyCompliance', { artifact: { data: parsed } });
      if (r.ok && r.result) { setSafetyResult(r.result); pipe.publish('construction.safety', r.result, { label: `Safety ${r.result.complianceRate}%` }); ok(`${r.result.complianceRate}% · TRIR ${r.result.incidentRate} · ${r.result.rating}.`); } else err(r.error ?? 'safety failed');
    } catch (e) { err(pickMessage(e)); } finally { setBusy(null); }
  }
  async function actProgress() {
    if (!phasesText.trim()) { err('Paste phases JSON first.'); return; }
    const parsed = parseJSON<Record<string, unknown>>(phasesText); if (!parsed) { err('Invalid phases JSON.'); return; }
    setBusy('progress'); setFeedback(null);
    try {
      const r = await callMacro<ProgResult>('progressReport', { artifact: { data: parsed } });
      if (r.ok && r.result) { setProgResult(r.result); pipe.publish('construction.progress', r.result, { label: `${r.result.overallActualPercent}% (${r.result.projectStatus})` }); ok(`${r.result.overallActualPercent}% vs ${r.result.overallPlannedPercent}% (${r.result.projectStatus}).`); } else err(r.error ?? 'progress failed');
    } catch (e) { err(pickMessage(e)); } finally { setBusy(null); }
  }
  async function actMint() {
    setBusy('mint'); setFeedback(null);
    try {
      const r = await api.post('/api/lens/run', { domain: 'dtu', name: 'create', input: { title: `Job report — ${progResult?.projectStatus ?? 'project'}`, tags: ['construction', 'jobsite', progResult?.projectStatus].filter((t): t is string => !!t), source: 'construction:job:mint', meta: { visibility: 'private', consent: { allowCitations: false }, gc: { takeoff: takeoffResult, cpm: cpmResult, safety: safetyResult, prog: progResult } } } });
      const id = r.data?.result?.dtu?.id ?? r.data?.dtu?.id ?? r.data?.result?.id;
      if (id) { setMintedDtuId(id); pipe.publish('construction.mintedDtuId', id, { label: `Job DTU ${id.slice(0, 8)}…` }); ok(`Job DTU ${id.slice(0, 8)}…`); } else err('No DTU id.');
    } catch (e) { err(pickMessage(e)); } finally { setBusy(null); }
  }
  async function actDm() {
    if (!recipient.trim()) { err('Recipient required.'); return; }
    setBusy('dm'); setFeedback(null);
    const body = [`🔨 Jobsite brief`, '',
      takeoffResult ? `Estimate: $${takeoffResult.grandTotal.toLocaleString()} (mat $${takeoffResult.subtotalMaterials} + lab $${takeoffResult.laborCost} + OH $${takeoffResult.overhead} + P $${takeoffResult.profit})${takeoffResult.costPerSqFt ? ` · $${takeoffResult.costPerSqFt}/sf` : ''}` : '',
      cpmResult ? `Schedule: ${cpmResult.projectDuration}d · CP: ${cpmResult.criticalPath.join(' → ')}` : '',
      safetyResult ? `Safety: ${safetyResult.complianceRate}% (${safetyResult.rating}) · TRIR ${safetyResult.incidentRate}${safetyResult.criticalFailures.length ? ` · ⚠ ${safetyResult.criticalFailures.join(', ')}` : ''}` : '',
      progResult ? `Progress: ${progResult.overallActualPercent}% vs ${progResult.overallPlannedPercent}% plan (${progResult.projectStatus})${progResult.behindPhases.length ? ` · behind: ${progResult.behindPhases.join(', ')}` : ''}` : '',
      mintedDtuId ? `\n[DTU ${mintedDtuId}]` : '',
    ].filter(Boolean).join('\n');
    try {
      const messageId = await dmRecall.run(async () => {
        const r = await api.post('/api/social/dm', { toUserId: recipient.trim(), content: body });
        if (r.data?.ok === false) throw new Error(r.data?.error ?? 'send failed');
        return r.data?.message?.id as string;
      });
      if (messageId) { ok('Sent. 60s to recall.'); setRecipient(''); }
    } catch (e) { err(pickMessage(e)); } finally { setBusy(null); }
  }
  async function actPublish() {
    if (!takeoffResult) { err('Run takeoff first.'); return; }
    setBusy('publish'); setFeedback(null);
    try {
      const id = await publishRecall.run(async () => {
        const r = await api.post('/api/lens/run', { domain: 'dtu', name: 'create', input: { title: `Cost benchmark`, tags: ['construction', 'cost', 'benchmark', 'public'], source: 'construction:cost:publish', meta: { visibility: 'public', consent: { allowCitations: true }, anon: true, takeoff: takeoffResult } } });
        const newId = r.data?.result?.dtu?.id ?? r.data?.dtu?.id ?? r.data?.result?.id;
        if (!newId) throw new Error('No DTU id.');
        const pub = await api.post(`/api/dtus/${encodeURIComponent(newId)}/publish`);
        if (pub.data?.ok === false) throw new Error(pub.data?.error ?? 'publish failed');
        return newId as string;
      });
      if (id) { setPublishedDtuId(id); pipe.publish('construction.publishedDtuId', id, { label: `Public benchmark ${id.slice(0, 8)}…` }); ok(`Published ${id.slice(0, 8)}… · 30s to recall.`); }
    } catch (e) { err(pickMessage(e)); } finally { setBusy(null); }
  }
  async function actAgent() {
    setBusy('agent'); setFeedback(null); setAgentReply(null);
    try {
      const task = `Construction PM review. ${takeoffResult ? `Estimate $${takeoffResult.grandTotal.toLocaleString()}${takeoffResult.costPerSqFt ? ` ($${takeoffResult.costPerSqFt}/sf)` : ''}.` : ''} ${cpmResult ? `${cpmResult.projectDuration}-day schedule, critical path: ${cpmResult.criticalPath.join(' → ')}.` : ''} ${safetyResult ? `Safety ${safetyResult.complianceRate}% (${safetyResult.rating})${safetyResult.criticalFailures.length ? `, critical: ${safetyResult.criticalFailures.join(', ')}` : ''}.` : ''} ${progResult ? `Status: ${progResult.projectStatus}${progResult.behindPhases.length ? `, behind: ${progResult.behindPhases.join(', ')}` : ''}.` : ''} Identify single highest-priority action for the week + one risk to flag. Plain text, 3 sentences max.`;
      const r = await api.post('/api/lens/run', { domain: 'chat_agent', name: 'do', input: { task, maxTurns: 3 } });
      const reply = r.data?.result?.reply ?? r.data?.result?.summary ?? r.data?.result?.output ?? r.data?.reply;
      if (reply) { setAgentReply(typeof reply === 'string' ? reply : JSON.stringify(reply, null, 2)); ok('Brief ready.'); } else err('Agent returned empty.');
    } catch (e) { err(pickMessage(e)); } finally { setBusy(null); }
  }

  const actions = [
    { id: 'takeoff' as ActionId, label: 'Takeoff', desc: 'takeoffEstimate', icon: Hammer, accent: '#f59e0b', handler: actTakeoff },
    { id: 'cpm' as ActionId, label: 'CPM', desc: 'criticalPath (CPM)', icon: GitBranch, accent: '#a855f7', handler: actCpm },
    { id: 'safety' as ActionId, label: 'Safety', desc: 'OSHA TRIR', icon: ShieldCheck, accent: '#ef4444', handler: actSafety },
    { id: 'progress' as ActionId, label: 'Progress', desc: 'plan vs actual', icon: TrendingUp, accent: '#22c55e', handler: actProgress },
    { id: 'mint' as ActionId, label: mintedDtuId ? 'Saved' : 'Mint', desc: mintedDtuId ? `${mintedDtuId.slice(0, 8)}…` : 'Private job DTU', icon: Sparkles, accent: '#06b6d4', handler: actMint },
    { id: 'dm' as ActionId, label: 'DM', desc: 'Send jobsite brief', icon: Send, accent: '#ec4899', handler: actDm },
    { id: 'publish' as ActionId, label: publishedDtuId ? 'Published' : 'Publish', desc: publishedDtuId ? `${publishedDtuId.slice(0, 8)}…` : 'Anon cost benchmark', icon: Globe, accent: '#15803d', handler: actPublish },
    { id: 'agent' as ActionId, label: 'PM brief', desc: 'Agent: weekly action', icon: Wand2, accent: '#eab308', handler: actAgent },
  ];

  return (
    <div className="rounded-lg border border-amber-500/20 bg-zinc-950/60 p-3 space-y-3">
      <header className="flex items-center gap-2 border-b border-amber-500/10 pb-2">
        <Hammer className="h-4 w-4 text-amber-400" />
        <h3 className="text-sm font-semibold text-white">Construction PM</h3>
        <span className="rounded bg-zinc-800 px-1.5 py-0.5 font-mono text-[10px] uppercase tracking-wider text-zinc-400">takeoff · CPM · OSHA · progress</span>
      </header>

      <div className="grid grid-cols-1 md:grid-cols-2 gap-2">
        <div>
          <label className="text-[10px] uppercase tracking-wider text-amber-400 font-semibold">Takeoff JSON</label>
          <textarea value={takeoffText} onChange={(e) => setTakeoffText(e.target.value)} rows={6} className="w-full bg-zinc-900 border border-zinc-800 rounded px-3 py-1.5 text-[10px] text-white font-mono mt-1" />
        </div>
        <div>
          <label className="text-[10px] uppercase tracking-wider text-purple-400 font-semibold">CPM tasks JSON</label>
          <textarea value={tasksText} onChange={(e) => setTasksText(e.target.value)} rows={6} className="w-full bg-zinc-900 border border-zinc-800 rounded px-3 py-1.5 text-[10px] text-white font-mono mt-1" />
        </div>
        <div>
          <label className="text-[10px] uppercase tracking-wider text-red-400 font-semibold">Safety JSON</label>
          <textarea value={safetyText} onChange={(e) => setSafetyText(e.target.value)} rows={5} className="w-full bg-zinc-900 border border-zinc-800 rounded px-3 py-1.5 text-[10px] text-white font-mono mt-1" />
        </div>
        <div>
          <label className="text-[10px] uppercase tracking-wider text-green-400 font-semibold">Phases JSON</label>
          <textarea value={phasesText} onChange={(e) => setPhasesText(e.target.value)} rows={5} className="w-full bg-zinc-900 border border-zinc-800 rounded px-3 py-1.5 text-[10px] text-white font-mono mt-1" />
        </div>
        <div className="md:col-span-2 flex items-center gap-2 flex-wrap">
          <input type="text" value={recipient} onChange={(e) => setRecipient(e.target.value)} className="flex-1 bg-zinc-900 border border-zinc-800 rounded px-3 py-1.5 text-[11px] text-white" placeholder="DM recipient" />
          <RecallSlot ctl={dmRecall} />
          <RecallSlot ctl={publishRecall} />
        </div>
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
        {takeoffResult && (
          <div className="rounded-md border border-amber-500/30 bg-amber-500/5 p-2.5">
            <div className="text-[10px] uppercase tracking-wider text-amber-300 font-semibold">Takeoff</div>
            <div className="text-2xl font-bold text-amber-300">${takeoffResult.grandTotal.toLocaleString()}</div>
            {takeoffResult.costPerSqFt && <div className="text-[10px] text-zinc-500">${takeoffResult.costPerSqFt}/sf</div>}
            <div className="text-[10px] text-zinc-500">mat ${takeoffResult.subtotalMaterials.toLocaleString()}</div>
            <div className="text-[10px] text-zinc-500">lab ${takeoffResult.laborCost.toLocaleString()} · OH ${takeoffResult.overhead} · P ${takeoffResult.profit}</div>
          </div>
        )}
        {cpmResult && (
          <div className="rounded-md border border-purple-500/30 bg-purple-500/5 p-2.5 max-h-48 overflow-y-auto">
            <div className="text-[10px] uppercase tracking-wider text-purple-300 font-semibold">CPM · {cpmResult.projectDuration}d</div>
            <div className="text-[11px] text-purple-200">CP: {cpmResult.criticalPath.join(' → ')}</div>
            {cpmResult.tasks.slice(0, 6).map((t, i) => <div key={i} className={cn('text-[10px] mt-0.5', t.onCriticalPath ? 'text-purple-200 font-semibold' : 'text-zinc-400')}>{t.onCriticalPath ? '★' : '·'} <span className="font-mono">{t.name}</span> · {t.duration}d · slack {t.slack}</div>)}
          </div>
        )}
        {safetyResult && (
          <div className={cn('rounded-md border p-2.5', safetyResult.rating === 'excellent' ? 'border-emerald-500/30 bg-emerald-500/5' : safetyResult.rating === 'acceptable' ? 'border-amber-500/30 bg-amber-500/5' : 'border-red-500/30 bg-red-500/5')}>
            <div className="text-[10px] uppercase tracking-wider text-red-300 font-semibold">Safety · {safetyResult.rating}</div>
            <div className={cn('text-2xl font-bold', safetyResult.complianceRate >= 95 ? 'text-emerald-300' : safetyResult.complianceRate >= 80 ? 'text-amber-300' : 'text-red-300')}>{safetyResult.complianceRate}%</div>
            <div className="text-[10px] text-zinc-500">TRIR {safetyResult.incidentRate} · {safetyResult.incidents} incidents / {safetyResult.hoursWorked.toLocaleString()}h</div>
            {safetyResult.criticalFailures.length > 0 && <div className="text-[10px] text-red-300 mt-0.5">⚠ {safetyResult.criticalFailures.join(', ')}</div>}
          </div>
        )}
        {progResult && (
          <div className={cn('rounded-md border p-2.5', progResult.projectStatus === 'on-schedule' ? 'border-emerald-500/30 bg-emerald-500/5' : progResult.projectStatus === 'minor-delay' ? 'border-amber-500/30 bg-amber-500/5' : 'border-red-500/30 bg-red-500/5')}>
            <div className="text-[10px] uppercase tracking-wider text-green-300 font-semibold">Progress · {progResult.projectStatus}</div>
            <div className="text-2xl font-bold text-green-300">{progResult.overallActualPercent}%<span className="text-xs text-zinc-400"> / {progResult.overallPlannedPercent}% plan</span></div>
            <div className="text-[10px] text-zinc-500">variance {progResult.overallVariance >= 0 ? '+' : ''}{progResult.overallVariance}%</div>
            {progResult.behindPhases.length > 0 && <div className="text-[10px] text-red-300">behind: {progResult.behindPhases.join(', ')}</div>}
            {progResult.phases.slice(0, 4).map((p, i) => <div key={i} className="text-[10px] text-zinc-400 mt-0.5"><span className="font-mono">{p.phase}</span> · {p.actualPercent}/{p.plannedPercent}%</div>)}
          </div>
        )}
      </div>

      {agentReply && (<div className="rounded-md border border-yellow-500/30 bg-yellow-500/5 p-3 max-h-60 overflow-y-auto"><div className="flex items-center gap-1.5 text-yellow-400 font-semibold mb-1.5 uppercase tracking-wider text-[10px]"><Wand2 className="w-3 h-3" /> PM action</div><pre className="whitespace-pre-wrap font-sans text-[11px] text-zinc-200 leading-relaxed">{agentReply}</pre></div>)}

      <AnimatePresence>
        {feedback && (<motion.div key={feedback.text} initial={{ opacity: 0, y: -2 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: -2 }} className={cn('px-3 py-2 rounded text-[11px] flex items-start gap-2 border', feedback.kind === 'ok' ? 'bg-emerald-500/10 text-emerald-300 border-emerald-500/30' : 'bg-red-500/10 text-red-300 border-red-500/30')}>{feedback.kind === 'ok' ? <Check className="h-3 w-3 mt-0.5" /> : <AlertTriangle className="h-3 w-3 mt-0.5" />}<span>{feedback.text}</span></motion.div>)}
      </AnimatePresence>
    </div>
  );
}
