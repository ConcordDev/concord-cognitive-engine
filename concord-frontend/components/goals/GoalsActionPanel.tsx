'use client';

/**
 * GoalsActionPanel — OKR / planning bench.
 * okrScoring / goalDecomposition / progressForecast (3 macros + reset) +
 * mint/DM/publish/agent.
 */

import { useState } from 'react';
import { Target, GitBranch, TrendingUp, RefreshCw, Sparkles, Send, Globe, Wand2, Loader2, Check, AlertTriangle } from 'lucide-react';
import { motion, AnimatePresence } from 'framer-motion';
import { api, apiHelpers } from '@/lib/api/client';
import { cn } from '@/lib/utils';

interface MacroEnvelope<T> { ok: boolean; result?: T; error?: string }
async function callMacro<T>(action: string, payload: Record<string, unknown>): Promise<MacroEnvelope<T>> {
  const r = await apiHelpers.lens.runDomain('goals', action, payload);
  const data = (r as { data?: { ok: boolean; result?: T; error?: string } }).data;
  if (!data) return { ok: false, error: 'empty response' };
  if (data.ok && data.result && typeof data.result === 'object' && 'ok' in data.result) return data.result as MacroEnvelope<T>;
  return data as MacroEnvelope<T>;
}

type Feedback = { kind: 'ok' | 'err'; text: string } | null;
type ActionId = 'okr' | 'decomp' | 'forecast' | 'reset' | 'mint' | 'dm' | 'publish' | 'agent';
function pickMessage(e: unknown): string { const ax = e as { response?: { data?: { error?: string } }; message?: string }; return ax?.response?.data?.error ?? ax?.message ?? 'request failed'; }

interface OkrKr { id: string; title: string; target: number; current: number; progress: number; status: string }
interface OkrObjective { id: string; title: string; score: number; status: string; krCount: number; krOnTrack: number; krAtRisk: number; krOffTrack: number; keyResults: OkrKr[] }
interface OkrResult { overallScore: number; overallStatus: string; periodProgress: number | null; objectives: OkrObjective[]; summary: { objectiveCount: number; totalKeyResults: number; onTrack: number; atRisk: number; offTrack: number; avgProgress: number; avgConfidence: number } }
interface DecompTask { id: string; title: string; duration: number; isCritical?: boolean; effort?: number }
interface DecompResult { tasks?: DecompTask[]; totalTasks?: number; criticalPath?: string[]; totalDuration?: number; totalEffort?: number; resourceConflicts?: string[] }
interface ForecastResult { goalId?: string; currentProgress?: number; projectedCompletion?: number; projectedCompletionDate?: string; trajectory?: string; recommendations?: string[] }

const DEFAULT_OKR = JSON.stringify({ objectives: [{ id: 'O1', title: 'Grow MRR', weight: 2, keyResults: [{ id: 'KR1', title: 'Land 30 new customers', target: 30, current: 18, startValue: 0, confidence: 0.7 }, { id: 'KR2', title: 'Reduce churn to 2%', target: 2, current: 3.5, startValue: 6, confidence: 0.6 }] }, { id: 'O2', title: 'Ship platform v2', weight: 1.5, keyResults: [{ id: 'KR3', title: 'Beta with 50 users', target: 50, current: 42, startValue: 0, confidence: 0.85 }, { id: 'KR4', title: 'p99 latency < 200ms', target: 200, current: 240, startValue: 400, confidence: 0.7 }] }] }, null, 2);
const DEFAULT_OKR_PARAMS = JSON.stringify({ periodStartDate: '2026-04-01', periodEndDate: '2026-06-30' }, null, 2);
const DEFAULT_DECOMP = JSON.stringify({ goals: [{ id: 'G1', title: 'Launch v2 platform', duration: 12, effort: 60, dependencies: [], resources: ['backend', 'frontend'], subGoals: [{ id: 'G1a', title: 'API design', duration: 3, effort: 12 }, { id: 'G1b', title: 'Implementation', duration: 6, effort: 32, dependencies: ['G1a'] }, { id: 'G1c', title: 'Testing', duration: 3, effort: 16, dependencies: ['G1b'] }] }, { id: 'G2', title: 'GTM campaign', duration: 8, effort: 40, dependencies: ['G1'], resources: ['marketing'] }] }, null, 2);
const DEFAULT_FORECAST = JSON.stringify({ goal: { id: 'O1', target: 30, history: [{ date: '2026-04-01', value: 0 }, { date: '2026-04-15', value: 6 }, { date: '2026-05-01', value: 12 }, { date: '2026-05-15', value: 18 }] }, deadline: '2026-06-30' }, null, 2);

export function GoalsActionPanel() {
  const [okrText, setOkrText] = useState(DEFAULT_OKR);
  const [okrParams, setOkrParams] = useState(DEFAULT_OKR_PARAMS);
  const [decompText, setDecompText] = useState(DEFAULT_DECOMP);
  const [forecastText, setForecastText] = useState(DEFAULT_FORECAST);
  const [recipient, setRecipient] = useState('');

  const [busy, setBusy] = useState<ActionId | null>(null);
  const [feedback, setFeedback] = useState<Feedback>(null);
  const [okrResult, setOkrResult] = useState<OkrResult | null>(null);
  const [decompResult, setDecompResult] = useState<DecompResult | null>(null);
  const [forecastResult, setForecastResult] = useState<ForecastResult | null>(null);
  const [mintedDtuId, setMintedDtuId] = useState<string | null>(null);
  const [publishedDtuId, setPublishedDtuId] = useState<string | null>(null);
  const [agentReply, setAgentReply] = useState<string | null>(null);

  const ok = (m: string) => setFeedback({ kind: 'ok', text: m });
  const err = (m: string) => setFeedback({ kind: 'err', text: m });

  async function actOkr() {
    try { const parsed = JSON.parse(okrText); const params = JSON.parse(okrParams); setBusy('okr'); setFeedback(null);
      const r = await callMacro<OkrResult>('okrScoring', { artifact: { data: parsed }, params });
      if (r.ok && r.result) { setOkrResult(r.result); ok(`Score ${r.result.overallScore}% · ${r.result.overallStatus}`); } else err(r.error ?? 'okr failed');
    } catch (e) { err(e instanceof SyntaxError ? 'Invalid OKR JSON.' : pickMessage(e)); } finally { setBusy(null); }
  }
  async function actDecomp() {
    try { const parsed = JSON.parse(decompText); setBusy('decomp'); setFeedback(null);
      const r = await callMacro<DecompResult>('goalDecomposition', { artifact: { data: parsed } });
      if (r.ok && r.result) { setDecompResult(r.result); ok(`${r.result.totalTasks ?? 0} tasks · ${r.result.totalDuration ?? '?'}d total`); } else err(r.error ?? 'decomp failed');
    } catch (e) { err(e instanceof SyntaxError ? 'Invalid decomp JSON.' : pickMessage(e)); } finally { setBusy(null); }
  }
  async function actForecast() {
    try { const parsed = JSON.parse(forecastText); setBusy('forecast'); setFeedback(null);
      const r = await callMacro<ForecastResult>('progressForecast', { artifact: { data: parsed } });
      if (r.ok && r.result) { setForecastResult(r.result); ok(`Projected ${r.result.projectedCompletion?.toFixed?.(0) ?? '?'}% · ${r.result.trajectory ?? '?'}`); } else err(r.error ?? 'forecast failed');
    } catch (e) { err(e instanceof SyntaxError ? 'Invalid forecast JSON.' : pickMessage(e)); } finally { setBusy(null); }
  }
  function actReset() { setOkrResult(null); setDecompResult(null); setForecastResult(null); setMintedDtuId(null); setPublishedDtuId(null); setAgentReply(null); ok('Cleared.'); }
  async function actMint() {
    setBusy('mint'); setFeedback(null);
    try {
      const r = await api.post('/api/lens/run', { domain: 'dtu', name: 'create', input: { title: `OKR brief`, tags: ['goals', 'okr', okrResult?.overallStatus].filter((t): t is string => !!t), source: 'goals:okr:mint', meta: { visibility: 'private', consent: { allowCitations: false }, goals: { okr: okrResult, decomp: decompResult, forecast: forecastResult } } } });
      const id = r.data?.result?.dtu?.id ?? r.data?.dtu?.id ?? r.data?.result?.id;
      if (id) { setMintedDtuId(id); ok(`Brief DTU ${id.slice(0, 8)}…`); } else err('No DTU id.');
    } catch (e) { err(pickMessage(e)); } finally { setBusy(null); }
  }
  async function actDm() {
    if (!recipient.trim()) { err('Recipient required.'); return; }
    setBusy('dm'); setFeedback(null);
    const body = [`🎯 OKR brief`, '', okrResult ? `OKRs: ${okrResult.overallScore}% · ${okrResult.overallStatus} · ${okrResult.summary.onTrack} green / ${okrResult.summary.atRisk} yellow / ${okrResult.summary.offTrack} red of ${okrResult.summary.totalKeyResults} KRs` : '', decompResult ? `Decomp: ${decompResult.totalTasks ?? 0} tasks · ${decompResult.totalDuration ?? '?'}d critical path${decompResult.criticalPath?.length ? ` (${decompResult.criticalPath.slice(0, 5).join(' → ')})` : ''}` : '', forecastResult ? `Forecast: projected ${forecastResult.projectedCompletion?.toFixed?.(0) ?? '?'}% · ${forecastResult.trajectory ?? '?'}${forecastResult.projectedCompletionDate ? ` · est ${forecastResult.projectedCompletionDate}` : ''}` : '', mintedDtuId ? `\n[DTU ${mintedDtuId}]` : ''].filter(Boolean).join('\n');
    try { const r = await api.post('/api/social/dm', { toUserId: recipient.trim(), content: body }); if (r.data?.ok !== false) { ok('Sent.'); setRecipient(''); } else err(r.data?.error ?? 'send failed'); }
    catch (e) { err(pickMessage(e)); } finally { setBusy(null); }
  }
  async function actPublish() {
    if (!okrResult) { err('Score OKRs first.'); return; }
    setBusy('publish'); setFeedback(null);
    try {
      const r = await api.post('/api/lens/run', { domain: 'dtu', name: 'create', input: { title: `OKR snapshot`, tags: ['goals', 'okr', 'public'], source: 'goals:okr:publish', meta: { visibility: 'public', consent: { allowCitations: true }, anon: true, goals: { okr: okrResult, forecast: forecastResult } } } });
      const id = r.data?.result?.dtu?.id ?? r.data?.dtu?.id ?? r.data?.result?.id;
      if (!id) { err('No DTU id.'); return; }
      const pub = await api.post(`/api/dtus/${encodeURIComponent(id)}/publish`);
      if (pub.data?.ok !== false) { setPublishedDtuId(id); ok(`Published ${id.slice(0, 8)}…`); } else err(pub.data?.error ?? 'publish failed');
    } catch (e) { err(pickMessage(e)); } finally { setBusy(null); }
  }
  async function actAgent() {
    setBusy('agent'); setFeedback(null); setAgentReply(null);
    try {
      const task = `Executive coach brief. ${okrResult ? `OKRs: ${okrResult.overallScore}% (${okrResult.overallStatus}); ${okrResult.summary.offTrack} red KRs of ${okrResult.summary.totalKeyResults}.` : ''} ${decompResult ? `Plan: ${decompResult.totalDuration ?? '?'}d critical path; ${decompResult.criticalPath?.length ?? 0} hops.` : ''} ${forecastResult ? `Forecast: ${forecastResult.projectedCompletion?.toFixed?.(0) ?? '?'}% projected, trajectory ${forecastResult.trajectory ?? '?'}.` : ''} Identify the highest-leverage focus shift for next 2 weeks + one resource ask. Plain text, ≤ 3 sentences.`;
      const r = await api.post('/api/lens/run', { domain: 'chat_agent', name: 'do', input: { task, maxTurns: 3 } });
      const reply = r.data?.result?.reply ?? r.data?.result?.summary ?? r.data?.result?.output ?? r.data?.reply;
      if (reply) { setAgentReply(typeof reply === 'string' ? reply : JSON.stringify(reply, null, 2)); ok('Coach brief ready.'); } else err('Agent returned empty.');
    } catch (e) { err(pickMessage(e)); } finally { setBusy(null); }
  }

  const actions = [
    { id: 'okr' as ActionId, label: 'OKRs', desc: 'okrScoring', icon: Target, accent: '#3b82f6', handler: actOkr },
    { id: 'decomp' as ActionId, label: 'Decompose', desc: 'goalDecomposition', icon: GitBranch, accent: '#a855f7', handler: actDecomp },
    { id: 'forecast' as ActionId, label: 'Forecast', desc: 'progressForecast', icon: TrendingUp, accent: '#22c55e', handler: actForecast },
    { id: 'reset' as ActionId, label: 'Reset', desc: 'Clear results', icon: RefreshCw, accent: '#71717a', handler: actReset },
    { id: 'mint' as ActionId, label: mintedDtuId ? 'Saved' : 'Mint', desc: mintedDtuId ? `${mintedDtuId.slice(0, 8)}…` : 'Private brief', icon: Sparkles, accent: '#06b6d4', handler: actMint },
    { id: 'dm' as ActionId, label: 'DM', desc: 'Send brief', icon: Send, accent: '#ec4899', handler: actDm },
    { id: 'publish' as ActionId, label: publishedDtuId ? 'Published' : 'Publish', desc: publishedDtuId ? `${publishedDtuId.slice(0, 8)}…` : 'Anon snapshot', icon: Globe, accent: '#15803d', handler: actPublish },
    { id: 'agent' as ActionId, label: 'Coach', desc: 'Agent: focus shift', icon: Wand2, accent: '#eab308', handler: actAgent },
  ];

  const STATUS_COLOR: Record<string, string> = { green: 'text-emerald-300', yellow: 'text-amber-300', red: 'text-red-300' };

  return (
    <div className="rounded-lg border border-blue-500/20 bg-zinc-950/60 p-3 space-y-3">
      <header className="flex items-center gap-2 border-b border-blue-500/10 pb-2">
        <Target className="h-4 w-4 text-blue-400" />
        <h3 className="text-sm font-semibold text-white">Goals / OKR bench</h3>
        <span className="rounded bg-zinc-800 px-1.5 py-0.5 font-mono text-[10px] uppercase tracking-wider text-zinc-400">OKR · decompose · forecast</span>
      </header>

      <div className="grid grid-cols-1 md:grid-cols-2 gap-2">
        <div>
          <label className="text-[10px] uppercase tracking-wider text-blue-400 font-semibold">OKR JSON</label>
          <textarea value={okrText} onChange={(e) => setOkrText(e.target.value)} rows={6} className="w-full bg-zinc-900 border border-zinc-800 rounded px-3 py-1 text-[10px] text-white font-mono mt-1" />
        </div>
        <div>
          <label className="text-[10px] uppercase tracking-wider text-blue-400 font-semibold">OKR period params</label>
          <textarea value={okrParams} onChange={(e) => setOkrParams(e.target.value)} rows={6} className="w-full bg-zinc-900 border border-zinc-800 rounded px-3 py-1 text-[10px] text-white font-mono mt-1" />
        </div>
        <div>
          <label className="text-[10px] uppercase tracking-wider text-purple-400 font-semibold">Decomp JSON</label>
          <textarea value={decompText} onChange={(e) => setDecompText(e.target.value)} rows={6} className="w-full bg-zinc-900 border border-zinc-800 rounded px-3 py-1 text-[10px] text-white font-mono mt-1" />
        </div>
        <div>
          <label className="text-[10px] uppercase tracking-wider text-green-400 font-semibold">Forecast JSON</label>
          <textarea value={forecastText} onChange={(e) => setForecastText(e.target.value)} rows={6} className="w-full bg-zinc-900 border border-zinc-800 rounded px-3 py-1 text-[10px] text-white font-mono mt-1" />
        </div>
        <input type="text" value={recipient} onChange={(e) => setRecipient(e.target.value)} className="md:col-span-2 bg-zinc-900 border border-zinc-800 rounded px-3 py-1.5 text-[11px] text-white" placeholder="DM recipient user-id" />
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

      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-2">
        {okrResult && (
          <div className={cn('rounded-md border p-2.5 max-h-44 overflow-y-auto', okrResult.overallStatus === 'green' ? 'border-emerald-500/30 bg-emerald-500/5' : okrResult.overallStatus === 'yellow' ? 'border-amber-500/30 bg-amber-500/5' : 'border-red-500/30 bg-red-500/5')}>
            <div className="text-[10px] uppercase tracking-wider text-blue-300 font-semibold">OKRs · {okrResult.overallStatus}</div>
            <div className={cn('text-3xl font-bold', STATUS_COLOR[okrResult.overallStatus])}>{okrResult.overallScore}<span className="text-xs text-zinc-400">%</span></div>
            <div className="text-[10px] text-zinc-300">{okrResult.summary.totalKeyResults} KRs · {okrResult.summary.onTrack}🟢 {okrResult.summary.atRisk}🟡 {okrResult.summary.offTrack}🔴</div>
            {okrResult.periodProgress !== null && <div className="text-[10px] text-zinc-500">Period {okrResult.periodProgress}% elapsed</div>}
            {okrResult.objectives.slice(0, 4).map((o, i) => <div key={i} className="text-[10px] text-zinc-300 mt-0.5 flex justify-between"><span className="truncate"><strong>{o.title}</strong></span><span className={cn('font-mono text-[9px]', STATUS_COLOR[o.status])}>{o.score}%</span></div>)}
          </div>
        )}
        {decompResult && (
          <div className="rounded-md border border-purple-500/30 bg-purple-500/5 p-2.5 max-h-44 overflow-y-auto">
            <div className="text-[10px] uppercase tracking-wider text-purple-300 font-semibold">Decomp</div>
            <div className="text-2xl font-bold text-purple-200">{decompResult.totalDuration ?? '?'}<span className="text-xs text-zinc-400">d</span></div>
            <div className="text-[10px] text-zinc-300">{decompResult.totalTasks ?? 0} tasks · effort {decompResult.totalEffort ?? '?'}</div>
            <div className="text-[10px] text-zinc-500">Critical: {decompResult.criticalPath?.slice(0, 4).join(' → ') ?? '—'}</div>
            {decompResult.tasks?.slice(0, 5).map((t, i) => <div key={i} className={cn('text-[10px] mt-0.5 flex justify-between', t.isCritical ? 'text-red-300' : 'text-zinc-300')}><span>{t.isCritical ? '★ ' : ''}{t.title}</span><span className="font-mono">{t.duration}d</span></div>)}
            {decompResult.resourceConflicts?.slice(0, 2).map((c, i) => <div key={i} className="text-[10px] text-red-300 mt-0.5">⚠ {c}</div>)}
          </div>
        )}
        {forecastResult && (
          <div className="rounded-md border border-green-500/30 bg-green-500/5 p-2.5 max-h-44 overflow-y-auto">
            <div className="text-[10px] uppercase tracking-wider text-green-300 font-semibold">Forecast · {forecastResult.trajectory ?? '?'}</div>
            <div className={cn('text-3xl font-bold', (forecastResult.projectedCompletion ?? 0) >= 90 ? 'text-emerald-300' : (forecastResult.projectedCompletion ?? 0) >= 60 ? 'text-amber-300' : 'text-red-300')}>{forecastResult.projectedCompletion?.toFixed?.(0) ?? '?'}<span className="text-xs text-zinc-400">%</span></div>
            <div className="text-[10px] text-zinc-300">Current: {forecastResult.currentProgress?.toFixed?.(0) ?? '?'}%</div>
            {forecastResult.projectedCompletionDate && <div className="text-[10px] text-zinc-500">Est. complete: {forecastResult.projectedCompletionDate}</div>}
            {forecastResult.recommendations?.slice(0, 3).map((r, i) => <div key={i} className="text-[10px] text-green-200 mt-0.5">→ {r}</div>)}
          </div>
        )}
      </div>

      {agentReply && (<div className="rounded-md border border-yellow-500/30 bg-yellow-500/5 p-3 max-h-60 overflow-y-auto"><div className="flex items-center gap-1.5 text-yellow-400 font-semibold mb-1.5 uppercase tracking-wider text-[10px]"><Wand2 className="w-3 h-3" /> Executive coach</div><pre className="whitespace-pre-wrap font-sans text-[11px] text-zinc-200 leading-relaxed">{agentReply}</pre></div>)}

      <AnimatePresence>
        {feedback && (<motion.div key={feedback.text} initial={{ opacity: 0, y: -2 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: -2 }} className={cn('px-3 py-2 rounded text-[11px] flex items-start gap-2 border', feedback.kind === 'ok' ? 'bg-emerald-500/10 text-emerald-300 border-emerald-500/30' : 'bg-red-500/10 text-red-300 border-red-500/30')}>{feedback.kind === 'ok' ? <Check className="h-3 w-3 mt-0.5" /> : <AlertTriangle className="h-3 w-3 mt-0.5" />}<span>{feedback.text}</span></motion.div>)}
      </AnimatePresence>
    </div>
  );
}
