'use client';

/**
 * ManufacturingActionPanel — shop-floor lead bench.
 * oeeCalculate / bomCost / safetyRate / scheduleOptimize +
 * mint/DM/publish/agent.
 */

import { useState } from 'react';
import { Factory, DollarSign, ShieldAlert, Calendar, Sparkles, Send, Globe, Wand2, Loader2, Check, AlertTriangle } from 'lucide-react';
import { motion, AnimatePresence } from 'framer-motion';
import { api, apiHelpers } from '@/lib/api/client';
import { cn } from '@/lib/utils';

interface MacroEnvelope<T> { ok: boolean; result?: T; error?: string }
async function callMacro<T>(action: string, input: Record<string, unknown>): Promise<MacroEnvelope<T>> {
  const r = await apiHelpers.lens.runDomain('manufacturing', action, { input });
  const data = (r as { data?: { ok: boolean; result?: T } }).data;
  if (!data) return { ok: false, error: 'empty response' };
  if (data.ok && data.result && typeof data.result === 'object' && 'ok' in data.result) return data.result as MacroEnvelope<T>;
  return data as MacroEnvelope<T>;
}

type Feedback = { kind: 'ok' | 'err'; text: string } | null;
type ActionId = 'oee' | 'bom' | 'safe' | 'sched' | 'mint' | 'dm' | 'publish' | 'agent';
function pickMessage(e: unknown): string { const ax = e as { response?: { data?: { error?: string } }; message?: string }; return ax?.response?.data?.error ?? ax?.message ?? 'request failed'; }

interface OEEResult { machine?: string; availability: number; performance: number; quality: number; oee: number; rating: string }
interface BomItem { material?: string; quantity?: number; unitCost?: number; lineCost?: number }
interface BomResult { product?: string; items?: BomItem[]; totalCost?: number; itemCount?: number; targetPrice?: number; targetMargin?: number; marginPercent?: number }
interface SafeIncident { type?: string; severity?: string; date?: string }
interface SafeResult { incidentRate: number; recordableIncidents: number; totalIncidents: number; hoursWorked: number; benchmark: string }
interface SchedJob { id?: string; product?: string; duration?: number; machine?: string; startTime?: number; endTime?: number }
interface SchedResult { jobs?: SchedJob[]; totalDuration?: number; makespan?: number; utilization?: number; bottleneck?: string }

const DEMO_BOM = JSON.stringify({
  product: 'Widget-Pro',
  bom: [
    { material: 'Steel housing', quantity: 1, unitCost: 12.5 },
    { material: 'PCB assembly', quantity: 1, unitCost: 8.75 },
    { material: 'M3 screws', quantity: 4, unitCost: 0.05 },
    { material: 'O-ring', quantity: 2, unitCost: 0.15 },
    { material: 'Label', quantity: 1, unitCost: 0.02 },
  ],
  targetPrice: 49.99,
}, null, 2);

const DEMO_INCIDENTS = JSON.stringify({
  hoursWorked: 200000,
  incidents: [
    { type: 'finger laceration', severity: 'first-aid', oshaRecordable: false, date: '2026-04-12' },
    { type: 'sprain', severity: 'recordable', oshaRecordable: true, date: '2026-03-08' },
    { type: 'eye irritation', severity: 'recordable', oshaRecordable: true, date: '2026-02-15' },
  ],
}, null, 2);

const DEMO_JOBS = JSON.stringify({
  jobs: [
    { id: 'J1', product: 'Widget A', duration: 120, machine: 'CNC-01' },
    { id: 'J2', product: 'Widget B', duration: 90, machine: 'CNC-02' },
    { id: 'J3', product: 'Widget A', duration: 80, machine: 'CNC-01' },
    { id: 'J4', product: 'Bracket', duration: 45, machine: 'CNC-03' },
  ],
}, null, 2);

export function ManufacturingActionPanel() {
  const [plannedTime, setPlannedTime] = useState('480');
  const [downtime, setDowntime] = useState('45');
  const [idealCycleTime, setIdealCycleTime] = useState('0.5');
  const [totalPieces, setTotalPieces] = useState('800');
  const [goodPieces, setGoodPieces] = useState('780');
  const [bomText, setBomText] = useState(DEMO_BOM);
  const [incidentsText, setIncidentsText] = useState(DEMO_INCIDENTS);
  const [jobsText, setJobsText] = useState(DEMO_JOBS);
  const [recipient, setRecipient] = useState('');

  const [busy, setBusy] = useState<ActionId | null>(null);
  const [feedback, setFeedback] = useState<Feedback>(null);
  const [oeeResult, setOeeResult] = useState<OEEResult | null>(null);
  const [bomResult, setBomResult] = useState<BomResult | null>(null);
  const [safeResult, setSafeResult] = useState<SafeResult | null>(null);
  const [schedResult, setSchedResult] = useState<SchedResult | null>(null);
  const [mintedDtuId, setMintedDtuId] = useState<string | null>(null);
  const [publishedDtuId, setPublishedDtuId] = useState<string | null>(null);
  const [agentReply, setAgentReply] = useState<string | null>(null);

  const ok = (m: string) => setFeedback({ kind: 'ok', text: m });
  const err = (m: string) => setFeedback({ kind: 'err', text: m });

  function parseJSON<T>(text: string): T | null { try { return JSON.parse(text) as T; } catch { return null; } }

  async function actOee() {
    setBusy('oee'); setFeedback(null);
    try { const r = await callMacro<OEEResult>('oeeCalculate', { artifact: { title: 'Line 1', data: { plannedTime: parseFloat(plannedTime), downtime: parseFloat(downtime), idealCycleTime: parseFloat(idealCycleTime), totalPieces: parseInt(totalPieces, 10), goodPieces: parseInt(goodPieces, 10) } } }); if (r.ok && r.result) { setOeeResult(r.result); ok(`OEE ${r.result.oee}% (${r.result.rating}).`); } else err(r.error ?? 'oee failed'); }
    catch (e) { err(pickMessage(e)); } finally { setBusy(null); }
  }
  async function actBom() {
    const parsed = parseJSON<{ product?: string; bom?: unknown[]; targetPrice?: number }>(bomText); if (!parsed) { err('Invalid BOM JSON.'); return; }
    setBusy('bom'); setFeedback(null);
    try { const r = await callMacro<BomResult>('bomCost', { artifact: { data: parsed } }); if (r.ok && r.result) { setBomResult(r.result); ok(`${r.result.itemCount} items · $${r.result.totalCost}.`); } else err(r.error ?? 'bom failed'); }
    catch (e) { err(pickMessage(e)); } finally { setBusy(null); }
  }
  async function actSafe() {
    const parsed = parseJSON<{ hoursWorked?: number; incidents?: SafeIncident[] }>(incidentsText); if (!parsed) { err('Invalid incidents JSON.'); return; }
    setBusy('safe'); setFeedback(null);
    try { const r = await callMacro<SafeResult>('safetyRate', { artifact: { data: parsed } }); if (r.ok && r.result) { setSafeResult(r.result); ok(`TRIR ${r.result.incidentRate} (${r.result.benchmark}).`); } else err(r.error ?? 'safe failed'); }
    catch (e) { err(pickMessage(e)); } finally { setBusy(null); }
  }
  async function actSched() {
    const parsed = parseJSON<{ jobs?: unknown[] }>(jobsText); if (!parsed) { err('Invalid jobs JSON.'); return; }
    setBusy('sched'); setFeedback(null);
    try { const r = await callMacro<SchedResult>('scheduleOptimize', { artifact: { data: parsed } }); if (r.ok && r.result) { setSchedResult(r.result); ok(`Makespan ${r.result.makespan ?? '-'}min.`); } else err(r.error ?? 'sched failed'); }
    catch (e) { err(pickMessage(e)); } finally { setBusy(null); }
  }
  async function actMint() {
    setBusy('mint'); setFeedback(null);
    try {
      const r = await api.post('/api/lens/run', { domain: 'dtu', name: 'create', input: { title: `Shop-floor — ${oeeResult?.rating ?? 'shift'}`, tags: ['manufacturing', 'shopfloor', oeeResult?.rating].filter((t): t is string => !!t), source: 'manufacturing:shift:mint', meta: { visibility: 'private', consent: { allowCitations: false }, mfg: { oee: oeeResult, bom: bomResult, safe: safeResult, sched: schedResult } } } });
      const id = r.data?.result?.dtu?.id ?? r.data?.dtu?.id ?? r.data?.result?.id;
      if (id) { setMintedDtuId(id); ok(`Shift DTU ${id.slice(0, 8)}…`); } else err('No DTU id.');
    } catch (e) { err(pickMessage(e)); } finally { setBusy(null); }
  }
  async function actDm() {
    if (!recipient.trim()) { err('Recipient required.'); return; }
    setBusy('dm'); setFeedback(null);
    const body = [`🏭 Shift brief`, '', oeeResult ? `OEE: ${oeeResult.oee}% (A ${oeeResult.availability}% × P ${oeeResult.performance}% × Q ${oeeResult.quality}%) — ${oeeResult.rating}` : '', bomResult ? `BOM cost: $${bomResult.totalCost} × ${bomResult.itemCount} items${bomResult.marginPercent != null ? ` · margin ${bomResult.marginPercent}%` : ''}` : '', safeResult ? `TRIR: ${safeResult.incidentRate} (${safeResult.recordableIncidents} recordable / ${safeResult.hoursWorked.toLocaleString()} hrs) · ${safeResult.benchmark}` : '', schedResult ? `Schedule: makespan ${schedResult.makespan ?? '-'}min · util ${schedResult.utilization ?? '-'}%` : '', mintedDtuId ? `\n[DTU ${mintedDtuId}]` : ''].filter(Boolean).join('\n');
    try { const r = await api.post('/api/social/dm', { toUserId: recipient.trim(), content: body }); if (r.data?.ok !== false) { ok('Sent.'); setRecipient(''); } else err(r.data?.error ?? 'send failed'); }
    catch (e) { err(pickMessage(e)); } finally { setBusy(null); }
  }
  async function actPublish() {
    if (!oeeResult) { err('Run OEE first.'); return; }
    setBusy('publish'); setFeedback(null);
    try {
      const r = await api.post('/api/lens/run', { domain: 'dtu', name: 'create', input: { title: `OEE benchmark`, tags: ['manufacturing', 'oee', 'benchmark', 'public'], source: 'manufacturing:oee:publish', meta: { visibility: 'public', consent: { allowCitations: true }, anon: true, oee: oeeResult } } });
      const id = r.data?.result?.dtu?.id ?? r.data?.dtu?.id ?? r.data?.result?.id;
      if (!id) { err('No DTU id.'); return; }
      const pub = await api.post(`/api/dtus/${encodeURIComponent(id)}/publish`);
      if (pub.data?.ok !== false) { setPublishedDtuId(id); ok(`Published ${id.slice(0, 8)}…`); } else err(pub.data?.error ?? 'publish failed');
    } catch (e) { err(pickMessage(e)); } finally { setBusy(null); }
  }
  async function actAgent() {
    setBusy('agent'); setFeedback(null); setAgentReply(null);
    try {
      const task = `Shop-floor review. ${oeeResult ? `OEE ${oeeResult.oee}% (avail ${oeeResult.availability}, perf ${oeeResult.performance}, qual ${oeeResult.quality}, ${oeeResult.rating}).` : ''} ${bomResult ? `Unit cost $${bomResult.totalCost}${bomResult.marginPercent != null ? `, margin ${bomResult.marginPercent}%` : ''}.` : ''} ${safeResult ? `TRIR ${safeResult.incidentRate} (${safeResult.benchmark}).` : ''} Identify the single biggest leverage for OEE improvement + one safety hazard to address. Plain text, 3 sentences max.`;
      const r = await api.post('/api/lens/run', { domain: 'chat_agent', name: 'do', input: { task, maxTurns: 3 } });
      const reply = r.data?.result?.reply ?? r.data?.result?.summary ?? r.data?.result?.output ?? r.data?.reply;
      if (reply) { setAgentReply(typeof reply === 'string' ? reply : JSON.stringify(reply, null, 2)); ok('Review ready.'); } else err('Agent returned empty.');
    } catch (e) { err(pickMessage(e)); } finally { setBusy(null); }
  }

  const actions = [
    { id: 'oee' as ActionId, label: 'OEE', desc: 'A × P × Q', icon: Factory, accent: '#22c55e', handler: actOee },
    { id: 'bom' as ActionId, label: 'BOM', desc: 'unit cost + margin', icon: DollarSign, accent: '#f59e0b', handler: actBom },
    { id: 'safe' as ActionId, label: 'Safety', desc: 'OSHA TRIR', icon: ShieldAlert, accent: '#ef4444', handler: actSafe },
    { id: 'sched' as ActionId, label: 'Schedule', desc: 'scheduleOptimize', icon: Calendar, accent: '#06b6d4', handler: actSched },
    { id: 'mint' as ActionId, label: mintedDtuId ? 'Saved' : 'Mint', desc: mintedDtuId ? `${mintedDtuId.slice(0, 8)}…` : 'Private shift DTU', icon: Sparkles, accent: '#3b82f6', handler: actMint },
    { id: 'dm' as ActionId, label: 'DM', desc: 'Send shift brief', icon: Send, accent: '#ec4899', handler: actDm },
    { id: 'publish' as ActionId, label: publishedDtuId ? 'Published' : 'Publish', desc: publishedDtuId ? `${publishedDtuId.slice(0, 8)}…` : 'Anon OEE benchmark', icon: Globe, accent: '#15803d', handler: actPublish },
    { id: 'agent' as ActionId, label: 'Lever', desc: 'Agent: top OEE lever', icon: Wand2, accent: '#eab308', handler: actAgent },
  ];

  const RATING_COLOR: Record<string, string> = { world_class: 'text-emerald-300', typical: 'text-blue-300', needs_improvement: 'text-amber-300' };
  const BENCH_COLOR: Record<string, string> = { below_average: 'text-emerald-300', average: 'text-amber-300', above_average: 'text-red-300' };

  return (
    <div className="rounded-lg border border-amber-500/20 bg-zinc-950/60 p-3 space-y-3">
      <header className="flex items-center gap-2 border-b border-amber-500/10 pb-2">
        <Factory className="h-4 w-4 text-amber-400" />
        <h3 className="text-sm font-semibold text-white">Shop-floor bench</h3>
        <span className="rounded bg-zinc-800 px-1.5 py-0.5 font-mono text-[10px] uppercase tracking-wider text-zinc-400">OEE · BOM · TRIR · scheduler</span>
      </header>

      <div className="grid grid-cols-1 md:grid-cols-3 gap-2">
        <div className="space-y-1.5">
          <div className="text-[10px] uppercase tracking-wider text-green-400 font-semibold">OEE inputs</div>
          <div className="grid grid-cols-2 gap-1">
            <input type="text" value={plannedTime} onChange={(e) => setPlannedTime(e.target.value)} className="bg-zinc-900 border border-zinc-800 rounded px-2 py-1 text-[11px] text-white font-mono" placeholder="Planned min" />
            <input type="text" value={downtime} onChange={(e) => setDowntime(e.target.value)} className="bg-zinc-900 border border-zinc-800 rounded px-2 py-1 text-[11px] text-white font-mono" placeholder="Downtime" />
            <input type="text" value={idealCycleTime} onChange={(e) => setIdealCycleTime(e.target.value)} className="bg-zinc-900 border border-zinc-800 rounded px-2 py-1 text-[11px] text-white font-mono" placeholder="Cycle (min/pc)" />
            <input type="text" value={totalPieces} onChange={(e) => setTotalPieces(e.target.value)} className="bg-zinc-900 border border-zinc-800 rounded px-2 py-1 text-[11px] text-white font-mono" placeholder="Total pieces" />
            <input type="text" value={goodPieces} onChange={(e) => setGoodPieces(e.target.value)} className="col-span-2 bg-zinc-900 border border-zinc-800 rounded px-2 py-1 text-[11px] text-white font-mono" placeholder="Good pieces" />
          </div>
          <input type="text" value={recipient} onChange={(e) => setRecipient(e.target.value)} className="w-full bg-zinc-900 border border-zinc-800 rounded px-3 py-1.5 text-[12px] text-white" placeholder="DM recipient" />
        </div>
        <div>
          <label className="text-[10px] uppercase tracking-wider text-amber-400 font-semibold">BOM JSON</label>
          <textarea value={bomText} onChange={(e) => setBomText(e.target.value)} rows={6} className="w-full bg-zinc-900 border border-zinc-800 rounded px-3 py-1.5 text-[10px] text-white font-mono mt-1" />
        </div>
        <div className="grid grid-cols-1 gap-2">
          <div>
            <label className="text-[10px] uppercase tracking-wider text-red-400 font-semibold">Incidents JSON</label>
            <textarea value={incidentsText} onChange={(e) => setIncidentsText(e.target.value)} rows={3} className="w-full bg-zinc-900 border border-zinc-800 rounded px-3 py-1.5 text-[10px] text-white font-mono mt-1" />
          </div>
          <div>
            <label className="text-[10px] uppercase tracking-wider text-cyan-400 font-semibold">Jobs JSON</label>
            <textarea value={jobsText} onChange={(e) => setJobsText(e.target.value)} rows={3} className="w-full bg-zinc-900 border border-zinc-800 rounded px-3 py-1.5 text-[10px] text-white font-mono mt-1" />
          </div>
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
        {oeeResult && (
          <div className="rounded-md border border-green-500/30 bg-green-500/5 p-2.5">
            <div className="text-[10px] uppercase tracking-wider text-green-300 font-semibold">OEE</div>
            <div className={cn('text-3xl font-bold', RATING_COLOR[oeeResult.rating])}>{oeeResult.oee}%</div>
            <div className="text-[10px] text-zinc-500">A {oeeResult.availability}% × P {oeeResult.performance}% × Q {oeeResult.quality}%</div>
            <div className={cn('text-[10px] font-semibold', RATING_COLOR[oeeResult.rating])}>{oeeResult.rating.replace('_', ' ')}</div>
          </div>
        )}
        {bomResult && (
          <div className="rounded-md border border-amber-500/30 bg-amber-500/5 p-2.5 max-h-44 overflow-y-auto">
            <div className="text-[10px] uppercase tracking-wider text-amber-300 font-semibold">BOM · {bomResult.product}</div>
            <div className="text-2xl font-bold text-amber-300">${bomResult.totalCost}</div>
            {bomResult.marginPercent != null && <div className={cn('text-[11px] font-semibold', bomResult.marginPercent >= 30 ? 'text-emerald-300' : bomResult.marginPercent >= 15 ? 'text-amber-300' : 'text-red-300')}>margin {bomResult.marginPercent}%</div>}
            {(bomResult.items ?? []).slice(0, 4).map((i, idx) => <div key={idx} className="text-[10px] text-zinc-400 mt-0.5">{i.material} ×{i.quantity} = ${i.lineCost?.toFixed(2)}</div>)}
          </div>
        )}
        {safeResult && (
          <div className="rounded-md border border-red-500/30 bg-red-500/5 p-2.5">
            <div className="text-[10px] uppercase tracking-wider text-red-300 font-semibold">TRIR</div>
            <div className={cn('text-2xl font-bold', BENCH_COLOR[safeResult.benchmark])}>{safeResult.incidentRate}</div>
            <div className="text-[10px] text-zinc-500">{safeResult.recordableIncidents} rec / {safeResult.totalIncidents} total</div>
            <div className="text-[10px] text-zinc-500">{safeResult.hoursWorked.toLocaleString()} hrs</div>
            <div className={cn('text-[10px] font-semibold', BENCH_COLOR[safeResult.benchmark])}>{safeResult.benchmark.replace('_', ' ')}</div>
          </div>
        )}
        {schedResult && (
          <div className="rounded-md border border-cyan-500/30 bg-cyan-500/5 p-2.5 max-h-44 overflow-y-auto">
            <div className="text-[10px] uppercase tracking-wider text-cyan-300 font-semibold">Schedule</div>
            <div className="text-2xl font-bold text-cyan-300">{schedResult.makespan ?? '-'}<span className="text-xs text-zinc-400"> min</span></div>
            {schedResult.utilization != null && <div className="text-[10px] text-zinc-500">util {schedResult.utilization}%</div>}
            {schedResult.bottleneck && <div className="text-[10px] text-amber-300">⚠ bottleneck: {schedResult.bottleneck}</div>}
            {(schedResult.jobs ?? []).slice(0, 4).map((j, i) => <div key={i} className="text-[10px] text-zinc-400 mt-0.5">{j.id} · {j.machine} · {j.duration}min</div>)}
          </div>
        )}
      </div>

      {agentReply && (<div className="rounded-md border border-yellow-500/30 bg-yellow-500/5 p-3 max-h-60 overflow-y-auto"><div className="flex items-center gap-1.5 text-yellow-400 font-semibold mb-1.5 uppercase tracking-wider text-[10px]"><Wand2 className="w-3 h-3" /> Top lever + hazard</div><pre className="whitespace-pre-wrap font-sans text-[11px] text-zinc-200 leading-relaxed">{agentReply}</pre></div>)}

      <AnimatePresence>
        {feedback && (<motion.div key={feedback.text} initial={{ opacity: 0, y: -2 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: -2 }} className={cn('px-3 py-2 rounded text-[11px] flex items-start gap-2 border', feedback.kind === 'ok' ? 'bg-emerald-500/10 text-emerald-300 border-emerald-500/30' : 'bg-red-500/10 text-red-300 border-red-500/30')}>{feedback.kind === 'ok' ? <Check className="h-3 w-3 mt-0.5" /> : <AlertTriangle className="h-3 w-3 mt-0.5" />}<span>{feedback.text}</span></motion.div>)}
      </AnimatePresence>
    </div>
  );
}
