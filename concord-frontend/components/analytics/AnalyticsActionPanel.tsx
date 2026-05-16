'use client';

/**
 * AnalyticsActionPanel — analyst bench.
 * funnelAnalysis / cohortAnalysis / detectAnomalies / trendForecast +
 * mint/DM/publish/agent.
 */

import { useState } from 'react';
import { BarChart3, Filter, Users, TrendingUp, Sparkles, Send, Globe, Wand2, Loader2, Check, AlertTriangle } from 'lucide-react';
import { motion, AnimatePresence } from 'framer-motion';
import { api, apiHelpers } from '@/lib/api/client';
import { cn } from '@/lib/utils';

interface MacroEnvelope<T> { ok: boolean; result?: T; error?: string }
async function callMacro<T>(action: string, input: Record<string, unknown>): Promise<MacroEnvelope<T>> {
  const r = await apiHelpers.lens.runDomain('analytics', action, { input });
  const data = (r as { data?: { ok: boolean; result?: T } }).data;
  if (!data) return { ok: false, error: 'empty response' };
  if (data.ok && data.result && typeof data.result === 'object' && 'ok' in data.result) return data.result as MacroEnvelope<T>;
  return data as MacroEnvelope<T>;
}

type Feedback = { kind: 'ok' | 'err'; text: string } | null;
type ActionId = 'funnel' | 'cohort' | 'anom' | 'trend' | 'mint' | 'dm' | 'publish' | 'agent';
function pickMessage(e: unknown): string { const ax = e as { response?: { data?: { error?: string } }; message?: string }; return ax?.response?.data?.error ?? ax?.message ?? 'request failed'; }

interface FunnelStage { stage: string; count: number; dropoff: number; conversionFromTop: number }
interface FunnelResult { stages: FunnelStage[]; overallConversion: number; worstDropoff?: string; worstDropoffRate?: number }
interface CohortPeriod { period: number; retained: number; rate: number }
interface CohortRow { cohort: string; initialUsers: number; retentionCurve: CohortPeriod[]; avgRetention: number }
interface CohortResult { cohorts: CohortRow[]; bestCohort?: string }
interface Anomaly { date: string; value: number; zScore: number; isAnomaly: boolean; direction: string }
interface AnomalyResult { mean: number; stdDev: number; totalPoints: number; anomaliesFound: number; anomalies: Anomaly[]; threshold: string }
interface ForecastPt { periodsAhead: number; predicted: number }
interface TrendResult { trend: string; slope: number; dataPoints: number; lastValue: number; forecast: ForecastPt[]; confidence: string }

const DEMO_FUNNEL = JSON.stringify({
  stages: [
    { name: 'Visited', count: 10000 },
    { name: 'Signed up', count: 2400 },
    { name: 'Activated', count: 1200 },
    { name: 'Subscribed', count: 380 },
    { name: 'Retained 30d', count: 290 },
  ],
}, null, 2);

const DEMO_COHORTS = JSON.stringify({
  cohorts: [
    { name: '2026-01', initialUsers: 1200, retention: [1200, 720, 540, 420, 360, 320] },
    { name: '2026-02', initialUsers: 1450, retention: [1450, 945, 765, 590, 510, 460] },
    { name: '2026-03', initialUsers: 1620, retention: [1620, 1085, 880, 700, 620] },
    { name: '2026-04', initialUsers: 1380, retention: [1380, 970, 815, 670] },
  ],
}, null, 2);

const DEMO_TIMESERIES = JSON.stringify({
  dataPoints: [
    { date: '2026-04-01', value: 1240 }, { date: '2026-04-02', value: 1310 }, { date: '2026-04-03', value: 1280 },
    { date: '2026-04-04', value: 1350 }, { date: '2026-04-05', value: 1290 }, { date: '2026-04-06', value: 1420 },
    { date: '2026-04-07', value: 1380 }, { date: '2026-04-08', value: 2890 }, { date: '2026-04-09', value: 1410 },
    { date: '2026-04-10', value: 1450 }, { date: '2026-04-11', value: 1490 }, { date: '2026-04-12', value: 1530 },
  ],
}, null, 2);

export function AnalyticsActionPanel() {
  const [funnelText, setFunnelText] = useState(DEMO_FUNNEL);
  const [cohortText, setCohortText] = useState(DEMO_COHORTS);
  const [seriesText, setSeriesText] = useState(DEMO_TIMESERIES);
  const [recipient, setRecipient] = useState('');

  const [busy, setBusy] = useState<ActionId | null>(null);
  const [feedback, setFeedback] = useState<Feedback>(null);
  const [funnelResult, setFunnelResult] = useState<FunnelResult | null>(null);
  const [cohortResult, setCohortResult] = useState<CohortResult | null>(null);
  const [anomResult, setAnomResult] = useState<AnomalyResult | null>(null);
  const [trendResult, setTrendResult] = useState<TrendResult | null>(null);
  const [mintedDtuId, setMintedDtuId] = useState<string | null>(null);
  const [publishedDtuId, setPublishedDtuId] = useState<string | null>(null);
  const [agentReply, setAgentReply] = useState<string | null>(null);

  const ok = (m: string) => setFeedback({ kind: 'ok', text: m });
  const err = (m: string) => setFeedback({ kind: 'err', text: m });

  function parseJSON<T>(text: string): T | null { try { return JSON.parse(text) as T; } catch { return null; } }

  async function actFunnel() {
    const parsed = parseJSON<{ stages: unknown[] }>(funnelText); if (!parsed) { err('Invalid funnel JSON.'); return; }
    setBusy('funnel'); setFeedback(null);
    try { const r = await callMacro<FunnelResult>('funnelAnalysis', { artifact: { data: parsed } }); if (r.ok && r.result) { setFunnelResult(r.result); ok(`${r.result.overallConversion}% top-to-bottom.`); } else err(r.error ?? 'funnel failed'); }
    catch (e) { err(pickMessage(e)); } finally { setBusy(null); }
  }
  async function actCohort() {
    const parsed = parseJSON<{ cohorts: unknown[] }>(cohortText); if (!parsed) { err('Invalid cohorts JSON.'); return; }
    setBusy('cohort'); setFeedback(null);
    try { const r = await callMacro<CohortResult>('cohortAnalysis', { artifact: { data: parsed } }); if (r.ok && r.result) { setCohortResult(r.result); ok(`Best: ${r.result.bestCohort}.`); } else err(r.error ?? 'cohort failed'); }
    catch (e) { err(pickMessage(e)); } finally { setBusy(null); }
  }
  async function actAnom() {
    const parsed = parseJSON<{ dataPoints: unknown[] }>(seriesText); if (!parsed) { err('Invalid series JSON.'); return; }
    setBusy('anom'); setFeedback(null);
    try { const r = await callMacro<AnomalyResult>('detectAnomalies', { artifact: { data: parsed } }); if (r.ok && r.result) { setAnomResult(r.result); ok(`${r.result.anomaliesFound} anomalies (μ ${r.result.mean}).`); } else err(r.error ?? 'anom failed'); }
    catch (e) { err(pickMessage(e)); } finally { setBusy(null); }
  }
  async function actTrend() {
    const parsed = parseJSON<{ dataPoints: unknown[] }>(seriesText); if (!parsed) { err('Invalid series JSON.'); return; }
    setBusy('trend'); setFeedback(null);
    try { const r = await callMacro<TrendResult>('trendForecast', { artifact: { data: parsed } }); if (r.ok && r.result) { setTrendResult(r.result); ok(`${r.result.trend} · slope ${r.result.slope}.`); } else err(r.error ?? 'trend failed'); }
    catch (e) { err(pickMessage(e)); } finally { setBusy(null); }
  }
  async function actMint() {
    setBusy('mint'); setFeedback(null);
    try {
      const r = await api.post('/api/lens/run', { domain: 'dtu', name: 'create', input: { title: `Analytics report`, tags: ['analytics', 'report', trendResult?.trend].filter((t): t is string => !!t), source: 'analytics:report:mint', meta: { visibility: 'private', consent: { allowCitations: false }, an: { funnel: funnelResult, cohort: cohortResult, anom: anomResult, trend: trendResult } } } });
      const id = r.data?.result?.dtu?.id ?? r.data?.dtu?.id ?? r.data?.result?.id;
      if (id) { setMintedDtuId(id); ok(`Report DTU ${id.slice(0, 8)}…`); } else err('No DTU id.');
    } catch (e) { err(pickMessage(e)); } finally { setBusy(null); }
  }
  async function actDm() {
    if (!recipient.trim()) { err('Recipient required.'); return; }
    setBusy('dm'); setFeedback(null);
    const body = [`📊 Analytics report`, '', funnelResult ? `Funnel: ${funnelResult.overallConversion}% top-to-bottom · worst drop: ${funnelResult.worstDropoff} (${funnelResult.worstDropoffRate}%)` : '', cohortResult ? `Cohorts: best ${cohortResult.bestCohort}` : '', anomResult ? `Anomalies: ${anomResult.anomaliesFound}/${anomResult.totalPoints} (μ ${anomResult.mean}, σ ${anomResult.stdDev})` : '', trendResult ? `Trend ${trendResult.trend} · next 5p: ${trendResult.forecast.find(f => f.periodsAhead === 5)?.predicted}` : '', mintedDtuId ? `\n[DTU ${mintedDtuId}]` : ''].filter(Boolean).join('\n');
    try { const r = await api.post('/api/social/dm', { toUserId: recipient.trim(), content: body }); if (r.data?.ok !== false) { ok('Sent.'); setRecipient(''); } else err(r.data?.error ?? 'send failed'); }
    catch (e) { err(pickMessage(e)); } finally { setBusy(null); }
  }
  async function actPublish() {
    if (!funnelResult && !trendResult) { err('Run funnel or trend first.'); return; }
    setBusy('publish'); setFeedback(null);
    try {
      const r = await api.post('/api/lens/run', { domain: 'dtu', name: 'create', input: { title: `Analytics benchmark`, tags: ['analytics', 'benchmark', 'public'], source: 'analytics:bench:publish', meta: { visibility: 'public', consent: { allowCitations: true }, anon: true, funnel: funnelResult, trend: trendResult } } });
      const id = r.data?.result?.dtu?.id ?? r.data?.dtu?.id ?? r.data?.result?.id;
      if (!id) { err('No DTU id.'); return; }
      const pub = await api.post(`/api/dtus/${encodeURIComponent(id)}/publish`);
      if (pub.data?.ok !== false) { setPublishedDtuId(id); ok(`Published ${id.slice(0, 8)}…`); } else err(pub.data?.error ?? 'publish failed');
    } catch (e) { err(pickMessage(e)); } finally { setBusy(null); }
  }
  async function actAgent() {
    setBusy('agent'); setFeedback(null); setAgentReply(null);
    try {
      const task = `Analytics review. ${funnelResult ? `Funnel: ${funnelResult.overallConversion}% conversion, worst drop at ${funnelResult.worstDropoff} (${funnelResult.worstDropoffRate}%).` : ''} ${cohortResult ? `Best cohort: ${cohortResult.bestCohort}.` : ''} ${anomResult ? `${anomResult.anomaliesFound} anomalies.` : ''} ${trendResult ? `Trend ${trendResult.trend}.` : ''} Identify the single biggest growth lever this quarter. Plain text, 3 sentences max.`;
      const r = await api.post('/api/lens/run', { domain: 'chat_agent', name: 'do', input: { task, maxTurns: 3 } });
      const reply = r.data?.result?.reply ?? r.data?.result?.summary ?? r.data?.result?.output ?? r.data?.reply;
      if (reply) { setAgentReply(typeof reply === 'string' ? reply : JSON.stringify(reply, null, 2)); ok('Lever ready.'); } else err('Agent returned empty.');
    } catch (e) { err(pickMessage(e)); } finally { setBusy(null); }
  }

  const actions = [
    { id: 'funnel' as ActionId, label: 'Funnel', desc: 'funnelAnalysis', icon: Filter, accent: '#3b82f6', handler: actFunnel },
    { id: 'cohort' as ActionId, label: 'Cohorts', desc: 'cohortAnalysis', icon: Users, accent: '#a855f7', handler: actCohort },
    { id: 'anom' as ActionId, label: 'Anomalies', desc: 'detectAnomalies', icon: AlertTriangle, accent: '#ef4444', handler: actAnom },
    { id: 'trend' as ActionId, label: 'Forecast', desc: 'trendForecast', icon: TrendingUp, accent: '#22c55e', handler: actTrend },
    { id: 'mint' as ActionId, label: mintedDtuId ? 'Saved' : 'Mint', desc: mintedDtuId ? `${mintedDtuId.slice(0, 8)}…` : 'Private report DTU', icon: Sparkles, accent: '#06b6d4', handler: actMint },
    { id: 'dm' as ActionId, label: 'DM', desc: 'Send report', icon: Send, accent: '#ec4899', handler: actDm },
    { id: 'publish' as ActionId, label: publishedDtuId ? 'Published' : 'Publish', desc: publishedDtuId ? `${publishedDtuId.slice(0, 8)}…` : 'Anon benchmark', icon: Globe, accent: '#15803d', handler: actPublish },
    { id: 'agent' as ActionId, label: 'Lever', desc: 'Agent: growth lever', icon: Wand2, accent: '#eab308', handler: actAgent },
  ];

  const TREND_COLOR: Record<string, string> = { upward: 'text-emerald-300', flat: 'text-zinc-300', downward: 'text-red-300' };

  return (
    <div className="rounded-lg border border-cyan-500/20 bg-zinc-950/60 p-3 space-y-3">
      <header className="flex items-center gap-2 border-b border-cyan-500/10 pb-2">
        <BarChart3 className="h-4 w-4 text-cyan-400" />
        <h3 className="text-sm font-semibold text-white">Analytics bench</h3>
        <span className="rounded bg-zinc-800 px-1.5 py-0.5 font-mono text-[10px] uppercase tracking-wider text-zinc-400">funnel · cohort · anomaly · forecast</span>
      </header>

      <div className="grid grid-cols-1 md:grid-cols-3 gap-2">
        <div>
          <label className="text-[10px] uppercase tracking-wider text-blue-400 font-semibold">Funnel JSON</label>
          <textarea value={funnelText} onChange={(e) => setFunnelText(e.target.value)} rows={5} className="w-full bg-zinc-900 border border-zinc-800 rounded px-3 py-1.5 text-[10px] text-white font-mono mt-1" />
        </div>
        <div>
          <label className="text-[10px] uppercase tracking-wider text-purple-400 font-semibold">Cohorts JSON</label>
          <textarea value={cohortText} onChange={(e) => setCohortText(e.target.value)} rows={5} className="w-full bg-zinc-900 border border-zinc-800 rounded px-3 py-1.5 text-[10px] text-white font-mono mt-1" />
        </div>
        <div>
          <label className="text-[10px] uppercase tracking-wider text-green-400 font-semibold">Time series JSON</label>
          <textarea value={seriesText} onChange={(e) => setSeriesText(e.target.value)} rows={5} className="w-full bg-zinc-900 border border-zinc-800 rounded px-3 py-1.5 text-[10px] text-white font-mono mt-1" />
        </div>
        <input type="text" value={recipient} onChange={(e) => setRecipient(e.target.value)} className="md:col-span-3 bg-zinc-900 border border-zinc-800 rounded px-3 py-1.5 text-[11px] text-white" placeholder="DM recipient" />
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

      <div className="grid grid-cols-1 md:grid-cols-2 gap-2">
        {funnelResult && (
          <div className="rounded-md border border-blue-500/30 bg-blue-500/5 p-2.5">
            <div className="text-[10px] uppercase tracking-wider text-blue-300 font-semibold">Funnel · {funnelResult.overallConversion}%</div>
            {funnelResult.stages.map((s, i) => <div key={i} className="text-[11px] text-zinc-300 mt-1"><div className="flex items-center gap-2"><span className="font-mono w-24 truncate">{s.stage}</span><div className="flex-1 h-2 bg-zinc-800 rounded-sm overflow-hidden"><div className="h-full bg-blue-400" style={{ width: `${s.conversionFromTop}%` }} /></div><span className="font-mono text-blue-200 text-[10px]">{s.count.toLocaleString()}</span></div>{i > 0 && <div className="text-[9px] text-zinc-500 ml-24">drop {s.dropoff}%</div>}</div>)}
            {funnelResult.worstDropoff && <div className="text-[10px] text-red-300 mt-1">⚠ worst drop: {funnelResult.worstDropoff} ({funnelResult.worstDropoffRate}%)</div>}
          </div>
        )}
        {cohortResult && (
          <div className="rounded-md border border-purple-500/30 bg-purple-500/5 p-2.5 max-h-56 overflow-y-auto">
            <div className="text-[10px] uppercase tracking-wider text-purple-300 font-semibold">Cohorts · best {cohortResult.bestCohort}</div>
            {cohortResult.cohorts.map((c, i) => <div key={i} className="text-[10px] text-zinc-300 mt-1"><div><strong className="text-purple-200">{c.cohort}</strong> · {c.initialUsers} · avg {c.avgRetention}%</div><div className="flex gap-0.5 mt-0.5">{c.retentionCurve.map((p, j) => <div key={j} className="flex-1 h-3 rounded-sm" style={{ backgroundColor: `rgba(168, 85, 247, ${0.2 + p.rate / 200})` }} title={`P${p.period}: ${p.rate}%`}><div className="text-center text-[8px] text-purple-100">{p.rate}</div></div>)}</div></div>)}
          </div>
        )}
        {anomResult && (
          <div className="rounded-md border border-red-500/30 bg-red-500/5 p-2.5 max-h-44 overflow-y-auto">
            <div className="text-[10px] uppercase tracking-wider text-red-300 font-semibold">Anomalies · {anomResult.anomaliesFound}</div>
            <div className="text-[10px] text-zinc-500">μ {anomResult.mean} · σ {anomResult.stdDev} · {anomResult.threshold}</div>
            {anomResult.anomalies.slice(0, 6).map((a, i) => <div key={i} className={cn('text-[10px] mt-0.5', a.direction === 'high' ? 'text-amber-300' : 'text-blue-300')}><span className="font-mono">{a.date}</span> · {a.value} (z={a.zScore} · {a.direction})</div>)}
          </div>
        )}
        {trendResult && (
          <div className="rounded-md border border-green-500/30 bg-green-500/5 p-2.5">
            <div className="text-[10px] uppercase tracking-wider text-green-300 font-semibold">Forecast · {trendResult.confidence}</div>
            <div className={cn('text-2xl font-bold capitalize', TREND_COLOR[trendResult.trend])}>{trendResult.trend}</div>
            <div className="text-[10px] text-zinc-500">slope {trendResult.slope} · last {trendResult.lastValue}</div>
            {trendResult.forecast.map((f, i) => <div key={i} className="text-[10px] text-zinc-300 mt-0.5">+{f.periodsAhead}p: <span className="text-green-200 font-mono">{f.predicted}</span></div>)}
          </div>
        )}
      </div>

      {agentReply && (<div className="rounded-md border border-yellow-500/30 bg-yellow-500/5 p-3 max-h-60 overflow-y-auto"><div className="flex items-center gap-1.5 text-yellow-400 font-semibold mb-1.5 uppercase tracking-wider text-[10px]"><Wand2 className="w-3 h-3" /> Growth lever</div><pre className="whitespace-pre-wrap font-sans text-[11px] text-zinc-200 leading-relaxed">{agentReply}</pre></div>)}

      <AnimatePresence>
        {feedback && (<motion.div key={feedback.text} initial={{ opacity: 0, y: -2 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: -2 }} className={cn('px-3 py-2 rounded text-[11px] flex items-start gap-2 border', feedback.kind === 'ok' ? 'bg-emerald-500/10 text-emerald-300 border-emerald-500/30' : 'bg-red-500/10 text-red-300 border-red-500/30')}>{feedback.kind === 'ok' ? <Check className="h-3 w-3 mt-0.5" /> : <AlertTriangle className="h-3 w-3 mt-0.5" />}<span>{feedback.text}</span></motion.div>)}
      </AnimatePresence>
    </div>
  );
}
