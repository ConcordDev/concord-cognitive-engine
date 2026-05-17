'use client';

/**
 * TemporalActionPanel — time-series bench.
 * timeSeriesDecompose / anomalyDetection / forecast (3 macros + reset) +
 * mint/DM/publish/agent.
 */

import { useState } from 'react';
import { Activity, AlertCircle, TrendingUp, RefreshCw, Sparkles, Send, Globe, Wand2, Loader2, Check, AlertTriangle } from 'lucide-react';
import { motion, AnimatePresence } from 'framer-motion';
import { api, apiHelpers } from '@/lib/api/client';
import { cn } from '@/lib/utils';

interface MacroEnvelope<T> { ok: boolean; result?: T; error?: string }
async function callMacro<T>(action: string, payload: Record<string, unknown>): Promise<MacroEnvelope<T>> {
  const r = await apiHelpers.lens.runDomain('temporal', action, payload);
  const data = (r as { data?: { ok: boolean; result?: T; error?: string } }).data;
  if (!data) return { ok: false, error: 'empty response' };
  if (data.ok && data.result && typeof data.result === 'object' && 'ok' in data.result) return data.result as MacroEnvelope<T>;
  return data as MacroEnvelope<T>;
}

type Feedback = { kind: 'ok' | 'err'; text: string } | null;
type ActionId = 'decompose' | 'anomaly' | 'forecast' | 'reset' | 'mint' | 'dm' | 'publish' | 'agent';
function pickMessage(e: unknown): string { const ax = e as { response?: { data?: { error?: string } }; message?: string }; return ax?.response?.data?.error ?? ax?.message ?? 'request failed'; }

interface DecomposeResult { n: number; detectedPeriod: number; strength: { trend: number; seasonal: number; trendLabel: string; seasonalLabel: string }; variance: { total: number; trend: number; seasonal: number; residual: number }; seasonalPattern: number[]; trend: number[] }
interface AnomalyZ { index: number; value: number; zScore: number; direction: string }
interface AnomalyIqr { index: number; value: number; severity: string; direction: string }
interface AnomalyResult { zScoreAnomalies?: AnomalyZ[]; iqrAnomalies?: AnomalyIqr[]; clusters?: { start: number; end: number; count: number }[]; summary?: { totalPoints: number; zScoreFlagged: number; iqrFlagged: number; clustersDetected: number; severity: string } }
interface ForecastResult { method?: string; forecasts?: { index: number; value: number; lower?: number; upper?: number }[]; mape?: number; mae?: number; rmse?: number; horizon?: number; confidence?: number }

const DEFAULT_DECOMP = JSON.stringify({ values: Array.from({ length: 48 }).map((_, i) => 100 + Math.sin(i * Math.PI / 6) * 15 + i * 0.5 + (Math.random() - 0.5) * 4) }, null, 2);
const DEFAULT_ANOM = JSON.stringify({ values: [10, 12, 11, 13, 12, 90, 11, 14, 12, 11, 13, 12, 11, 12, -45, 13, 12, 11, 12, 14, 11, 12, 13, 12, 11] }, null, 2);
const DEFAULT_FCAST = JSON.stringify({ values: Array.from({ length: 24 }).map((_, i) => 100 + i * 2 + Math.sin(i * 0.5) * 6) }, null, 2);
const DEFAULT_FCAST_PARAMS = JSON.stringify({ horizon: 8, method: 'auto' }, null, 2);

export function TemporalActionPanel() {
  const [decompText, setDecompText] = useState(DEFAULT_DECOMP);
  const [anomText, setAnomText] = useState(DEFAULT_ANOM);
  const [fcastText, setFcastText] = useState(DEFAULT_FCAST);
  const [fcastParams, setFcastParams] = useState(DEFAULT_FCAST_PARAMS);
  const [recipient, setRecipient] = useState('');

  const [busy, setBusy] = useState<ActionId | null>(null);
  const [feedback, setFeedback] = useState<Feedback>(null);
  const [decompResult, setDecompResult] = useState<DecomposeResult | null>(null);
  const [anomResult, setAnomResult] = useState<AnomalyResult | null>(null);
  const [fcastResult, setFcastResult] = useState<ForecastResult | null>(null);
  const [mintedDtuId, setMintedDtuId] = useState<string | null>(null);
  const [publishedDtuId, setPublishedDtuId] = useState<string | null>(null);
  const [agentReply, setAgentReply] = useState<string | null>(null);

  const ok = (m: string) => setFeedback({ kind: 'ok', text: m });
  const err = (m: string) => setFeedback({ kind: 'err', text: m });

  async function actDecomp() {
    try { const parsed = JSON.parse(decompText); setBusy('decompose'); setFeedback(null);
      const r = await callMacro<DecomposeResult>('timeSeriesDecompose', { artifact: { data: parsed } });
      if (r.ok && r.result) { setDecompResult(r.result); ok(`Period ${r.result.detectedPeriod} · trend ${r.result.strength.trendLabel}`); } else err(r.error ?? 'decompose failed');
    } catch (e) { err(e instanceof SyntaxError ? 'Invalid series JSON.' : pickMessage(e)); } finally { setBusy(null); }
  }
  async function actAnom() {
    try { const parsed = JSON.parse(anomText); setBusy('anomaly'); setFeedback(null);
      const r = await callMacro<AnomalyResult>('anomalyDetection', { artifact: { data: parsed } });
      if (r.ok && r.result) { setAnomResult(r.result); ok(`${r.result.summary?.zScoreFlagged ?? 0} Z-flagged · ${r.result.summary?.iqrFlagged ?? 0} IQR · severity ${r.result.summary?.severity ?? '?'}`); } else err(r.error ?? 'anom failed');
    } catch (e) { err(e instanceof SyntaxError ? 'Invalid anom JSON.' : pickMessage(e)); } finally { setBusy(null); }
  }
  async function actForecast() {
    try { const parsedSeries = JSON.parse(fcastText); const parsedParams = JSON.parse(fcastParams); setBusy('forecast'); setFeedback(null);
      const r = await callMacro<ForecastResult>('forecast', { artifact: { data: parsedSeries }, params: parsedParams });
      if (r.ok && r.result) { setFcastResult(r.result); ok(`${r.result.method ?? '?'} · MAPE ${r.result.mape?.toFixed?.(2) ?? '?'}%`); } else err(r.error ?? 'forecast failed');
    } catch (e) { err(e instanceof SyntaxError ? 'Invalid forecast JSON.' : pickMessage(e)); } finally { setBusy(null); }
  }
  function actReset() { setDecompResult(null); setAnomResult(null); setFcastResult(null); setMintedDtuId(null); setPublishedDtuId(null); setAgentReply(null); ok('Cleared.'); }
  async function actMint() {
    setBusy('mint'); setFeedback(null);
    try {
      const r = await api.post('/api/lens/run', { domain: 'dtu', name: 'create', input: { title: `Time-series analysis`, tags: ['temporal', decompResult?.strength.trendLabel, anomResult?.summary?.severity].filter((t): t is string => !!t), source: 'temporal:analysis:mint', meta: { visibility: 'private', consent: { allowCitations: false }, temporal: { decomp: decompResult, anom: anomResult, fcast: fcastResult } } } });
      const id = r.data?.result?.dtu?.id ?? r.data?.dtu?.id ?? r.data?.result?.id;
      if (id) { setMintedDtuId(id); ok(`Analysis DTU ${id.slice(0, 8)}…`); } else err('No DTU id.');
    } catch (e) { err(pickMessage(e)); } finally { setBusy(null); }
  }
  async function actDm() {
    if (!recipient.trim()) { err('Recipient required.'); return; }
    setBusy('dm'); setFeedback(null);
    const body = [`⏱ Time-series brief`, '', decompResult ? `Decomposition: period ${decompResult.detectedPeriod} · trend ${decompResult.strength.trendLabel} (${decompResult.strength.trend.toFixed(2)}) · seasonal ${decompResult.strength.seasonalLabel} (${decompResult.strength.seasonal.toFixed(2)})` : '', anomResult ? `Anomalies: ${anomResult.summary?.zScoreFlagged ?? 0} Z + ${anomResult.summary?.iqrFlagged ?? 0} IQR · ${anomResult.summary?.clustersDetected ?? 0} clusters · severity ${anomResult.summary?.severity ?? '?'}` : '', fcastResult ? `Forecast (${fcastResult.method ?? '?'}, h=${fcastResult.horizon ?? '?'}): MAPE ${fcastResult.mape?.toFixed?.(2) ?? '?'}%` : '', mintedDtuId ? `\n[DTU ${mintedDtuId}]` : ''].filter(Boolean).join('\n');
    try { const r = await api.post('/api/social/dm', { toUserId: recipient.trim(), content: body }); if (r.data?.ok !== false) { ok('Sent.'); setRecipient(''); } else err(r.data?.error ?? 'send failed'); }
    catch (e) { err(pickMessage(e)); } finally { setBusy(null); }
  }
  async function actPublish() {
    if (!decompResult && !fcastResult) { err('Decompose or forecast first.'); return; }
    setBusy('publish'); setFeedback(null);
    try {
      const r = await api.post('/api/lens/run', { domain: 'dtu', name: 'create', input: { title: `Series profile`, tags: ['temporal', 'profile', 'public'], source: 'temporal:profile:publish', meta: { visibility: 'public', consent: { allowCitations: true }, anon: true, temporal: { decomp: decompResult, fcast: fcastResult } } } });
      const id = r.data?.result?.dtu?.id ?? r.data?.dtu?.id ?? r.data?.result?.id;
      if (!id) { err('No DTU id.'); return; }
      const pub = await api.post(`/api/dtus/${encodeURIComponent(id)}/publish`);
      if (pub.data?.ok !== false) { setPublishedDtuId(id); ok(`Published ${id.slice(0, 8)}…`); } else err(pub.data?.error ?? 'publish failed');
    } catch (e) { err(pickMessage(e)); } finally { setBusy(null); }
  }
  async function actAgent() {
    setBusy('agent'); setFeedback(null); setAgentReply(null);
    try {
      const task = `Time-series analyst brief. ${decompResult ? `Period ${decompResult.detectedPeriod}, trend ${decompResult.strength.trendLabel}, seasonal ${decompResult.strength.seasonalLabel}.` : ''} ${anomResult ? `${(anomResult.summary?.zScoreFlagged ?? 0) + (anomResult.summary?.iqrFlagged ?? 0)} anomalies, severity ${anomResult.summary?.severity ?? '?'}.` : ''} ${fcastResult ? `Forecast: ${fcastResult.method ?? '?'} · MAPE ${fcastResult.mape?.toFixed?.(2) ?? '?'}%.` : ''} Recommend the single most-revealing pattern + one operational implication. Plain text, ≤ 3 sentences.`;
      const r = await api.post('/api/lens/run', { domain: 'chat_agent', name: 'do', input: { task, maxTurns: 3 } });
      const reply = r.data?.result?.reply ?? r.data?.result?.summary ?? r.data?.result?.output ?? r.data?.reply;
      if (reply) { setAgentReply(typeof reply === 'string' ? reply : JSON.stringify(reply, null, 2)); ok('Analyst brief ready.'); } else err('Agent returned empty.');
    } catch (e) { err(pickMessage(e)); } finally { setBusy(null); }
  }

  const actions = [
    { id: 'decompose' as ActionId, label: 'Decompose', desc: 'trend / seasonal / residual', icon: Activity, accent: '#3b82f6', handler: actDecomp },
    { id: 'anomaly' as ActionId, label: 'Anomalies', desc: 'Z + IQR + clusters', icon: AlertCircle, accent: '#ef4444', handler: actAnom },
    { id: 'forecast' as ActionId, label: 'Forecast', desc: 'horizon predict', icon: TrendingUp, accent: '#22c55e', handler: actForecast },
    { id: 'reset' as ActionId, label: 'Reset', desc: 'Clear results', icon: RefreshCw, accent: '#71717a', handler: actReset },
    { id: 'mint' as ActionId, label: mintedDtuId ? 'Saved' : 'Mint', desc: mintedDtuId ? `${mintedDtuId.slice(0, 8)}…` : 'Private analysis', icon: Sparkles, accent: '#06b6d4', handler: actMint },
    { id: 'dm' as ActionId, label: 'DM', desc: 'Send brief', icon: Send, accent: '#ec4899', handler: actDm },
    { id: 'publish' as ActionId, label: publishedDtuId ? 'Published' : 'Publish', desc: publishedDtuId ? `${publishedDtuId.slice(0, 8)}…` : 'Public profile', icon: Globe, accent: '#15803d', handler: actPublish },
    { id: 'agent' as ActionId, label: 'Analyst', desc: 'Agent: pattern+op', icon: Wand2, accent: '#eab308', handler: actAgent },
  ];

  const STRENGTH_COLOR: Record<string, string> = { strong: 'text-emerald-300', moderate: 'text-amber-300', weak: 'text-zinc-400' };
  const SEV_COLOR: Record<string, string> = { high: 'text-red-300', medium: 'text-amber-300', low: 'text-emerald-300', none: 'text-zinc-400' };

  return (
    <div className="rounded-lg border border-cyan-500/20 bg-zinc-950/60 p-3 space-y-3">
      <header className="flex items-center gap-2 border-b border-cyan-500/10 pb-2">
        <Activity className="h-4 w-4 text-cyan-400" />
        <h3 className="text-sm font-semibold text-white">Temporal / time-series bench</h3>
        <span className="rounded bg-zinc-800 px-1.5 py-0.5 font-mono text-[10px] uppercase tracking-wider text-zinc-400">decompose · anomaly · forecast</span>
      </header>

      <div className="grid grid-cols-1 md:grid-cols-2 gap-2">
        <div>
          <label className="text-[10px] uppercase tracking-wider text-blue-400 font-semibold">Series JSON (decompose)</label>
          <textarea value={decompText} onChange={(e) => setDecompText(e.target.value)} rows={5} className="w-full bg-zinc-900 border border-zinc-800 rounded px-3 py-1 text-[10px] text-white font-mono mt-1" />
        </div>
        <div>
          <label className="text-[10px] uppercase tracking-wider text-red-400 font-semibold">Series JSON (anomaly)</label>
          <textarea value={anomText} onChange={(e) => setAnomText(e.target.value)} rows={5} className="w-full bg-zinc-900 border border-zinc-800 rounded px-3 py-1 text-[10px] text-white font-mono mt-1" />
        </div>
        <div>
          <label className="text-[10px] uppercase tracking-wider text-green-400 font-semibold">Forecast series JSON</label>
          <textarea value={fcastText} onChange={(e) => setFcastText(e.target.value)} rows={5} className="w-full bg-zinc-900 border border-zinc-800 rounded px-3 py-1 text-[10px] text-white font-mono mt-1" />
        </div>
        <div>
          <label className="text-[10px] uppercase tracking-wider text-emerald-400 font-semibold">Forecast params</label>
          <textarea value={fcastParams} onChange={(e) => setFcastParams(e.target.value)} rows={5} className="w-full bg-zinc-900 border border-zinc-800 rounded px-3 py-1 text-[10px] text-white font-mono mt-1" />
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
        {decompResult && (
          <div className="rounded-md border border-blue-500/30 bg-blue-500/5 p-2.5 max-h-44 overflow-y-auto">
            <div className="text-[10px] uppercase tracking-wider text-blue-300 font-semibold">Decompose · period {decompResult.detectedPeriod}</div>
            <div className="text-2xl font-bold text-blue-200">{decompResult.n}<span className="text-xs text-zinc-400"> pts</span></div>
            <div className="text-[10px] text-zinc-300">Trend: <span className={STRENGTH_COLOR[decompResult.strength.trendLabel]}>{decompResult.strength.trendLabel}</span> ({decompResult.strength.trend.toFixed(2)})</div>
            <div className="text-[10px] text-zinc-300">Seasonal: <span className={STRENGTH_COLOR[decompResult.strength.seasonalLabel]}>{decompResult.strength.seasonalLabel}</span> ({decompResult.strength.seasonal.toFixed(2)})</div>
            <div className="text-[10px] text-zinc-500 mt-1">Variance: trend {decompResult.variance.trend.toFixed(1)} · seasonal {decompResult.variance.seasonal.toFixed(1)} · resid {decompResult.variance.residual.toFixed(1)}</div>
            <div className="text-[10px] text-zinc-400 mt-1">Seasonal pattern (first {Math.min(8, decompResult.seasonalPattern.length)}):</div>
            <div className="flex items-end gap-0.5 mt-1 h-8">{decompResult.seasonalPattern.slice(0, 12).map((v, i) => { const max = Math.max(...decompResult.seasonalPattern.map(Math.abs), 1); return (<div key={i} className={cn('w-3 rounded-sm', v >= 0 ? 'bg-blue-400' : 'bg-red-400')} style={{ height: `${Math.max(2, Math.abs(v) / max * 32)}px` }} title={String(v)} />); })}</div>
          </div>
        )}
        {anomResult && (
          <div className={cn('rounded-md border p-2.5 max-h-44 overflow-y-auto', anomResult.summary?.severity === 'high' ? 'border-red-500/40 bg-red-500/10' : anomResult.summary?.severity === 'medium' ? 'border-amber-500/30 bg-amber-500/5' : 'border-emerald-500/30 bg-emerald-500/5')}>
            <div className="text-[10px] uppercase tracking-wider text-red-300 font-semibold">Anomalies · {anomResult.summary?.severity ?? '?'}</div>
            <div className={cn('text-2xl font-bold', SEV_COLOR[anomResult.summary?.severity ?? 'none'])}>{(anomResult.summary?.zScoreFlagged ?? 0) + (anomResult.summary?.iqrFlagged ?? 0)}</div>
            <div className="text-[10px] text-zinc-500">Z {anomResult.summary?.zScoreFlagged ?? 0} · IQR {anomResult.summary?.iqrFlagged ?? 0} · clusters {anomResult.summary?.clustersDetected ?? 0}</div>
            {(anomResult.zScoreAnomalies ?? []).slice(0, 4).map((a, i) => <div key={i} className="text-[10px] text-zinc-300 mt-0.5 flex justify-between"><span>idx {a.index}: {a.value.toFixed(2)}</span><span className={cn('font-mono text-[9px]', a.direction === 'above' ? 'text-red-300' : 'text-blue-300')}>z={a.zScore.toFixed(2)} {a.direction}</span></div>)}
            {(anomResult.iqrAnomalies ?? []).slice(0, 3).map((a, i) => <div key={i} className="text-[10px] text-zinc-300 mt-0.5">IQR idx {a.index}: <span className={cn('font-mono', a.severity === 'extreme' ? 'text-red-300' : 'text-amber-200')}>{a.severity}</span></div>)}
          </div>
        )}
        {fcastResult && (
          <div className="rounded-md border border-green-500/30 bg-green-500/5 p-2.5 max-h-44 overflow-y-auto">
            <div className="text-[10px] uppercase tracking-wider text-green-300 font-semibold">Forecast · {fcastResult.method ?? '?'}</div>
            <div className="text-2xl font-bold text-emerald-200">{fcastResult.mape?.toFixed?.(1) ?? '?'}<span className="text-xs text-zinc-400">% MAPE</span></div>
            <div className="text-[10px] text-zinc-500">h={fcastResult.horizon ?? '?'} · MAE {fcastResult.mae?.toFixed?.(2) ?? '?'} · RMSE {fcastResult.rmse?.toFixed?.(2) ?? '?'}</div>
            {(fcastResult.forecasts ?? []).slice(0, 8).map((f, i) => <div key={i} className="text-[10px] text-zinc-300 mt-0.5 flex justify-between"><span>t+{i + 1}</span><span className="font-mono text-emerald-200">{f.value.toFixed(2)}{f.lower !== undefined && f.upper !== undefined ? ` (${f.lower.toFixed(1)}–${f.upper.toFixed(1)})` : ''}</span></div>)}
          </div>
        )}
      </div>

      {agentReply && (<div className="rounded-md border border-yellow-500/30 bg-yellow-500/5 p-3 max-h-60 overflow-y-auto"><div className="flex items-center gap-1.5 text-yellow-400 font-semibold mb-1.5 uppercase tracking-wider text-[10px]"><Wand2 className="w-3 h-3" /> TS analyst</div><pre className="whitespace-pre-wrap font-sans text-[11px] text-zinc-200 leading-relaxed">{agentReply}</pre></div>)}

      <AnimatePresence>
        {feedback && (<motion.div key={feedback.text} initial={{ opacity: 0, y: -2 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: -2 }} className={cn('px-3 py-2 rounded text-[11px] flex items-start gap-2 border', feedback.kind === 'ok' ? 'bg-emerald-500/10 text-emerald-300 border-emerald-500/30' : 'bg-red-500/10 text-red-300 border-red-500/30')}>{feedback.kind === 'ok' ? <Check className="h-3 w-3 mt-0.5" /> : <AlertTriangle className="h-3 w-3 mt-0.5" />}<span>{feedback.text}</span></motion.div>)}
      </AnimatePresence>
    </div>
  );
}
