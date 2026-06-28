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
import { usePipe, useRecallableAction, RecallSlot } from '@/components/panel-polish';

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

// Result shapes below mirror the REAL handler contract in
// server/domains/manufacturing.js (oeeCalculate / bomCost / safetyRate /
// scheduleOptimize). Field names are aligned exactly to what each handler
// RETURNS — no fabricated/aspirational fields.
interface OEEResult { machine?: string; availability: number; performance: number; quality: number; oee: number; rating: string }
interface BomItem { part?: string; quantity?: number; unitCost?: number; lineCost?: number }
interface BomResult { product?: string; components?: BomItem[]; totalCost?: number; componentCount?: number }
interface SafeIncident { type?: string; severity?: string; date?: string; oshaRecordable?: boolean }
interface SafeResult { incidentRate: number; recordableIncidents: number; totalIncidents: number; hoursWorked: number; benchmark: string }
interface SchedSeqEntry { position?: number; id?: string; priority?: number; dueDate?: string }
interface SchedResult { sequence?: SchedSeqEntry[]; count?: number }

// No seed data — every input starts empty.
export function ManufacturingActionPanel() {
  const [plannedTime, setPlannedTime] = useState('');
  const [downtime, setDowntime] = useState('');
  const [idealCycleTime, setIdealCycleTime] = useState('');
  const [totalPieces, setTotalPieces] = useState('');
  const [goodPieces, setGoodPieces] = useState('');
  const [bomText, setBomText] = useState('');
  const [incidentsText, setIncidentsText] = useState('');
  const [jobsText, setJobsText] = useState('');
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

  const pipe = usePipe();
  const dmRecall = useRecallableAction({ label: 'DM', windowMs: 60_000, onUndo: async (id) => { await api.delete(`/api/social/dm/${encodeURIComponent(id)}`); } });
  const publishRecall = useRecallableAction({ label: 'publish', windowMs: 30_000, onUndo: async (id) => { await api.delete(`/api/dtus/${encodeURIComponent(id)}/publish`); setPublishedDtuId(null); } });

  async function actOee() {
    const pt = parseFloat(plannedTime), dt = parseFloat(downtime), ct = parseFloat(idealCycleTime), tp = parseInt(totalPieces, 10), gp = parseInt(goodPieces, 10);
    if (![pt, dt, ct, tp, gp].every(Number.isFinite)) { err('All 5 OEE inputs required (planned, downtime, cycle, total, good).'); return; }
    setBusy('oee'); setFeedback(null);
    try {
      const r = await callMacro<OEEResult>('oeeCalculate', { artifact: { title: 'Line 1', data: { plannedTime: pt, downtime: dt, idealCycleTime: ct, totalPieces: tp, goodPieces: gp } } });
      if (r.ok && r.result) { setOeeResult(r.result); pipe.publish('mfg.oee', r.result, { label: `OEE ${r.result.oee}% (${r.result.rating})` }); ok(`OEE ${r.result.oee}% (${r.result.rating}).`); } else err(r.error ?? 'oee failed');
    } catch (e) { err(pickMessage(e)); } finally { setBusy(null); }
  }
  async function actBom() {
    if (!bomText.trim()) { err('Paste BOM JSON first.'); return; }
    const parsed = parseJSON<{ product?: string; components?: unknown[]; bom?: unknown[] }>(bomText); if (!parsed) { err('Invalid BOM JSON.'); return; }
    // Handler (server/domains/manufacturing.js#bomCost) reads `data.components`
    // (each `{ name|partRef, quantity, unitCost }`) + product from artifact.title
    // or `data.product`. Accept the `bom` alias and normalize to `components`.
    const components = Array.isArray(parsed.components) ? parsed.components : Array.isArray(parsed.bom) ? parsed.bom : [];
    if (components.length === 0) { err('BOM needs a non-empty "components" array.'); return; }
    setBusy('bom'); setFeedback(null);
    try {
      const r = await callMacro<BomResult>('bomCost', { artifact: { data: { product: parsed.product, components } } });
      if (r.ok && r.result) { setBomResult(r.result); pipe.publish('mfg.bom', r.result, { label: `BOM $${r.result.totalCost}` }); ok(`${r.result.componentCount} components · $${r.result.totalCost}.`); } else err(r.error ?? 'bom failed');
    } catch (e) { err(pickMessage(e)); } finally { setBusy(null); }
  }
  async function actSafe() {
    if (!incidentsText.trim()) { err('Paste incidents JSON first.'); return; }
    const parsed = parseJSON<{ hoursWorked?: number; incidents?: SafeIncident[] }>(incidentsText); if (!parsed) { err('Invalid incidents JSON.'); return; }
    setBusy('safe'); setFeedback(null);
    try {
      const r = await callMacro<SafeResult>('safetyRate', { artifact: { data: parsed } });
      if (r.ok && r.result) { setSafeResult(r.result); pipe.publish('mfg.safe', r.result, { label: `TRIR ${r.result.incidentRate}` }); ok(`TRIR ${r.result.incidentRate} (${r.result.benchmark}).`); } else err(r.error ?? 'safe failed');
    } catch (e) { err(pickMessage(e)); } finally { setBusy(null); }
  }
  async function actSched() {
    if (!jobsText.trim()) { err('Paste work-orders JSON first.'); return; }
    const parsed = parseJSON<{ workOrders?: unknown[]; jobs?: unknown[] }>(jobsText); if (!parsed) { err('Invalid work-orders JSON.'); return; }
    // Handler (scheduleOptimize) reads `data.workOrders` (each `{ id|title,
    // priority, dueDate }`) and returns `{ sequence, count }` — a priority/
    // due-date ordering, not a Gantt. Accept the `jobs` alias.
    const workOrders = Array.isArray(parsed.workOrders) ? parsed.workOrders : Array.isArray(parsed.jobs) ? parsed.jobs : [];
    if (workOrders.length === 0) { err('Schedule needs a non-empty "workOrders" array.'); return; }
    setBusy('sched'); setFeedback(null);
    try {
      const r = await callMacro<SchedResult>('scheduleOptimize', { artifact: { data: { workOrders } } });
      if (r.ok && r.result) { setSchedResult(r.result); pipe.publish('mfg.sched', r.result, { label: `Sequenced ${r.result.count ?? 0}` }); ok(`${r.result.count ?? 0} work orders sequenced.`); } else err(r.error ?? 'sched failed');
    } catch (e) { err(pickMessage(e)); } finally { setBusy(null); }
  }
  async function actMint() {
    setBusy('mint'); setFeedback(null);
    try {
      const r = await api.post('/api/lens/run', { domain: 'dtu', name: 'create', input: { title: `Shop-floor — ${oeeResult?.rating ?? 'shift'}`, tags: ['manufacturing', 'shopfloor', oeeResult?.rating].filter((t): t is string => !!t), source: 'manufacturing:shift:mint', meta: { visibility: 'private', consent: { allowCitations: false }, mfg: { oee: oeeResult, bom: bomResult, safe: safeResult, sched: schedResult } } } });
      const id = r.data?.result?.dtu?.id ?? r.data?.dtu?.id ?? r.data?.result?.id;
      if (id) { setMintedDtuId(id); pipe.publish('mfg.mintedDtuId', id, { label: `Shift DTU ${id.slice(0, 8)}…` }); ok(`Shift DTU ${id.slice(0, 8)}…`); } else err('No DTU id.');
    } catch (e) { err(pickMessage(e)); } finally { setBusy(null); }
  }
  async function actDm() {
    if (!recipient.trim()) { err('Recipient required.'); return; }
    setBusy('dm'); setFeedback(null);
    const body = [`🏭 Shift brief`, '',
      oeeResult ? `OEE: ${oeeResult.oee}% (A ${oeeResult.availability}% × P ${oeeResult.performance}% × Q ${oeeResult.quality}%) — ${oeeResult.rating}` : '',
      bomResult ? `BOM cost: $${bomResult.totalCost} × ${bomResult.componentCount} components` : '',
      safeResult ? `TRIR: ${safeResult.incidentRate} (${safeResult.recordableIncidents} recordable / ${safeResult.hoursWorked.toLocaleString()} hrs) · ${safeResult.benchmark}` : '',
      schedResult ? `Schedule: ${schedResult.count ?? 0} work orders sequenced` : '',
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
    if (!oeeResult) { err('Run OEE first.'); return; }
    setBusy('publish'); setFeedback(null);
    try {
      const id = await publishRecall.run(async () => {
        const r = await api.post('/api/lens/run', { domain: 'dtu', name: 'create', input: { title: `OEE benchmark`, tags: ['manufacturing', 'oee', 'benchmark', 'public'], source: 'manufacturing:oee:publish', meta: { visibility: 'public', consent: { allowCitations: true }, anon: true, oee: oeeResult } } });
        const newId = r.data?.result?.dtu?.id ?? r.data?.dtu?.id ?? r.data?.result?.id;
        if (!newId) throw new Error('No DTU id.');
        const pub = await api.post(`/api/dtus/${encodeURIComponent(newId)}/publish`);
        if (pub.data?.ok === false) throw new Error(pub.data?.error ?? 'publish failed');
        return newId as string;
      });
      if (id) { setPublishedDtuId(id); pipe.publish('mfg.publishedDtuId', id, { label: `Public OEE ${id.slice(0, 8)}…` }); ok(`Published ${id.slice(0, 8)}… · 30s to recall.`); }
    } catch (e) { err(pickMessage(e)); } finally { setBusy(null); }
  }
  async function actAgent() {
    setBusy('agent'); setFeedback(null); setAgentReply(null);
    try {
      const task = `Shop-floor review. ${oeeResult ? `OEE ${oeeResult.oee}% (avail ${oeeResult.availability}, perf ${oeeResult.performance}, qual ${oeeResult.quality}, ${oeeResult.rating}).` : ''} ${bomResult ? `BOM cost $${bomResult.totalCost} across ${bomResult.componentCount} components.` : ''} ${safeResult ? `TRIR ${safeResult.incidentRate} (${safeResult.benchmark}).` : ''} Identify the single biggest leverage for OEE improvement + one safety hazard to address. Plain text, 3 sentences max.`;
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
          <div className="flex items-center gap-2 flex-wrap">
            <RecallSlot ctl={dmRecall} />
            <RecallSlot ctl={publishRecall} />
          </div>
        </div>
        <div>
          <label className="text-[10px] uppercase tracking-wider text-amber-400 font-semibold">BOM JSON</label>
          <textarea value={bomText} onChange={(e) => setBomText(e.target.value)} rows={6} placeholder={'{"product":"HA-400","components":[{"name":"Housing","quantity":1,"unitCost":12.5}]}'} className="w-full bg-zinc-900 border border-zinc-800 rounded px-3 py-1.5 text-[10px] text-white font-mono mt-1" />
        </div>
        <div className="grid grid-cols-1 gap-2">
          <div>
            <label className="text-[10px] uppercase tracking-wider text-red-400 font-semibold">Incidents JSON</label>
            <textarea value={incidentsText} onChange={(e) => setIncidentsText(e.target.value)} rows={3} placeholder={'{"hoursWorked":200000,"incidents":[{"type":"laceration","oshaRecordable":true}]}'} className="w-full bg-zinc-900 border border-zinc-800 rounded px-3 py-1.5 text-[10px] text-white font-mono mt-1" />
          </div>
          <div>
            <label className="text-[10px] uppercase tracking-wider text-cyan-400 font-semibold">Work-orders JSON</label>
            <textarea value={jobsText} onChange={(e) => setJobsText(e.target.value)} rows={3} placeholder={'{"workOrders":[{"id":"WO-1","priority":1,"dueDate":"2026-07-01"}]}'} className="w-full bg-zinc-900 border border-zinc-800 rounded px-3 py-1.5 text-[10px] text-white font-mono mt-1" />
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
              <div className="text-[10px] text-zinc-400 leading-tight line-clamp-2">{act.desc}</div>
            </button>
          );
        })}
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-2">
        {oeeResult && (
          <div className="rounded-md border border-green-500/30 bg-green-500/5 p-2.5">
            <div className="text-[10px] uppercase tracking-wider text-green-300 font-semibold">OEE</div>
            <div className={cn('text-3xl font-bold', RATING_COLOR[oeeResult.rating])}>{oeeResult.oee}%</div>
            <div className="text-[10px] text-zinc-400">A {oeeResult.availability}% × P {oeeResult.performance}% × Q {oeeResult.quality}%</div>
            <div className={cn('text-[10px] font-semibold', RATING_COLOR[oeeResult.rating])}>{oeeResult.rating.replace('_', ' ')}</div>
          </div>
        )}
        {bomResult && (
          <div className="rounded-md border border-amber-500/30 bg-amber-500/5 p-2.5 max-h-44 overflow-y-auto">
            <div className="text-[10px] uppercase tracking-wider text-amber-300 font-semibold">BOM{bomResult.product ? ` · ${bomResult.product}` : ''}</div>
            <div className="text-2xl font-bold text-amber-300">${bomResult.totalCost}</div>
            <div className="text-[11px] text-zinc-400 font-semibold">{bomResult.componentCount} component{bomResult.componentCount === 1 ? '' : 's'}</div>
            {(bomResult.components ?? []).slice(0, 4).map((i, idx) => <div key={idx} className="text-[10px] text-zinc-400 mt-0.5">{i.part} ×{i.quantity} = ${i.lineCost?.toFixed(2)}</div>)}
          </div>
        )}
        {safeResult && (
          <div className="rounded-md border border-red-500/30 bg-red-500/5 p-2.5">
            <div className="text-[10px] uppercase tracking-wider text-red-300 font-semibold">TRIR</div>
            <div className={cn('text-2xl font-bold', BENCH_COLOR[safeResult.benchmark])}>{safeResult.incidentRate}</div>
            <div className="text-[10px] text-zinc-400">{safeResult.recordableIncidents} rec / {safeResult.totalIncidents} total</div>
            <div className="text-[10px] text-zinc-400">{safeResult.hoursWorked.toLocaleString()} hrs</div>
            <div className={cn('text-[10px] font-semibold', BENCH_COLOR[safeResult.benchmark])}>{safeResult.benchmark.replace('_', ' ')}</div>
          </div>
        )}
        {schedResult && (
          <div className="rounded-md border border-cyan-500/30 bg-cyan-500/5 p-2.5 max-h-44 overflow-y-auto">
            <div className="text-[10px] uppercase tracking-wider text-cyan-300 font-semibold">Schedule</div>
            <div className="text-2xl font-bold text-cyan-300">{schedResult.count ?? 0}<span className="text-xs text-zinc-400"> sequenced</span></div>
            {(schedResult.sequence ?? []).slice(0, 4).map((wo, i) => <div key={i} className="text-[10px] text-zinc-400 mt-0.5">#{wo.position} · {wo.id} · P{wo.priority}{wo.dueDate ? ` · ${wo.dueDate}` : ''}</div>)}
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
