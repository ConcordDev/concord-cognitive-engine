'use client';

/**
 * RetailActionPanel — store ops bench.
 * reorderCheck / pipelineValue / customerLTV / slaStatus +
 * mint/DM/publish/agent.
 */

import { useState } from 'react';
import { ShoppingCart, Target, Users, Clock, Sparkles, Send, Globe, Wand2, Loader2, Check, AlertTriangle } from 'lucide-react';
import { motion, AnimatePresence } from 'framer-motion';
import { api, apiHelpers } from '@/lib/api/client';
import { cn } from '@/lib/utils';

interface MacroEnvelope<T> { ok: boolean; result?: T; error?: string }
async function callMacro<T>(action: string, input: Record<string, unknown>): Promise<MacroEnvelope<T>> {
  const r = await apiHelpers.lens.runDomain('retail', action, { input });
  const data = (r as { data?: { ok: boolean; result?: T } }).data;
  if (!data) return { ok: false, error: 'empty response' };
  if (data.ok && data.result && typeof data.result === 'object' && 'ok' in data.result) return data.result as MacroEnvelope<T>;
  return data as MacroEnvelope<T>;
}

type Feedback = { kind: 'ok' | 'err'; text: string } | null;
type ActionId = 'reorder' | 'pipe' | 'ltv' | 'sla' | 'mint' | 'dm' | 'publish' | 'agent';
function pickMessage(e: unknown): string { const ax = e as { response?: { data?: { error?: string } }; message?: string }; return ax?.response?.data?.error ?? ax?.message ?? 'request failed'; }

interface ReorderEntry { sku?: string; name?: string; onHand: number; reorderPoint: number; daysOfStock: number | string; status: string }
interface ReorderResult { totalProducts: number; criticalCount: number; reorderCount: number; sufficientCount: number; critical: ReorderEntry[]; needsReorder: ReorderEntry[] }
interface PipeStageBreak { count?: number; unweighted?: number; weighted?: number }
interface PipeResult { totalDeals?: number; totalUnweighted?: number; totalWeighted?: number; byStage?: Record<string, PipeStageBreak>; expectedRevenue?: number; conversionRate?: number }
interface LtvResult { avgOrderValue?: number; purchaseFrequency?: number; customerLifespanYears?: number; ltv?: number; cac?: number; ltvToCacRatio?: number; profitable?: boolean }
interface SlaResult { totalIncidents?: number; withinSLA?: number; breaches?: number; complianceRate?: number; avgResponseMinutes?: number; tier?: string }

const DEMO_PRODUCTS = JSON.stringify({
  products: [
    { sku: 'WID-100', name: 'Widget Pro', onHand: 12, reorderPoint: 20, reorderQty: 100, dailyUsage: 4, leadTimeDays: 7 },
    { sku: 'GIZ-200', name: 'Gizmo', onHand: 0, reorderPoint: 15, reorderQty: 50, dailyUsage: 2, leadTimeDays: 10 },
    { sku: 'BOLT-3', name: 'Bolt M3', onHand: 480, reorderPoint: 200, reorderQty: 1000, dailyUsage: 30, leadTimeDays: 5 },
    { sku: 'GASKET', name: 'Rubber Gasket', onHand: 35, reorderPoint: 40, reorderQty: 200, dailyUsage: 6, leadTimeDays: 14 },
  ],
}, null, 2);

const DEMO_DEALS = JSON.stringify({
  deals: [
    { name: 'Acme retainer', value: 45000, probability: 0.75, stage: 'proposal', expectedCloseDate: '2026-06-15' },
    { name: 'Globex expansion', value: 120000, probability: 0.40, stage: 'discovery', expectedCloseDate: '2026-07-30' },
    { name: 'Initech upsell', value: 22000, probability: 0.90, stage: 'negotiation', expectedCloseDate: '2026-05-28' },
    { name: 'Hooli pilot', value: 8000, probability: 0.95, stage: 'closed-won', expectedCloseDate: '2026-05-01' },
    { name: 'Pied Piper', value: 75000, probability: 0.30, stage: 'qualification', expectedCloseDate: '2026-09-15' },
  ],
}, null, 2);

const DEMO_INCIDENTS = JSON.stringify({
  incidents: [
    { id: 'INC-1', responseMinutes: 8, slaMinutes: 15 },
    { id: 'INC-2', responseMinutes: 22, slaMinutes: 15 },
    { id: 'INC-3', responseMinutes: 12, slaMinutes: 15 },
    { id: 'INC-4', responseMinutes: 5, slaMinutes: 30 },
    { id: 'INC-5', responseMinutes: 60, slaMinutes: 30 },
  ],
}, null, 2);

export function RetailActionPanel() {
  const [productsText, setProductsText] = useState(DEMO_PRODUCTS);
  const [dealsText, setDealsText] = useState(DEMO_DEALS);
  const [aov, setAov] = useState('85');
  const [freq, setFreq] = useState('6');
  const [lifespan, setLifespan] = useState('3.5');
  const [cac, setCac] = useState('120');
  const [incidentsText, setIncidentsText] = useState(DEMO_INCIDENTS);
  const [recipient, setRecipient] = useState('');

  const [busy, setBusy] = useState<ActionId | null>(null);
  const [feedback, setFeedback] = useState<Feedback>(null);
  const [reorderResult, setReorderResult] = useState<ReorderResult | null>(null);
  const [pipeResult, setPipeResult] = useState<PipeResult | null>(null);
  const [ltvResult, setLtvResult] = useState<LtvResult | null>(null);
  const [slaResult, setSlaResult] = useState<SlaResult | null>(null);
  const [mintedDtuId, setMintedDtuId] = useState<string | null>(null);
  const [publishedDtuId, setPublishedDtuId] = useState<string | null>(null);
  const [agentReply, setAgentReply] = useState<string | null>(null);

  const ok = (m: string) => setFeedback({ kind: 'ok', text: m });
  const err = (m: string) => setFeedback({ kind: 'err', text: m });

  function parseJSON<T>(text: string): T | null { try { return JSON.parse(text) as T; } catch { return null; } }

  async function actReorder() {
    const parsed = parseJSON<{ products: unknown[] }>(productsText); if (!parsed) { err('Invalid products JSON.'); return; }
    setBusy('reorder'); setFeedback(null);
    try { const r = await callMacro<ReorderResult>('reorderCheck', { artifact: { data: parsed } }); if (r.ok && r.result) { setReorderResult(r.result); ok(`${r.result.criticalCount} critical, ${r.result.reorderCount} reorder.`); } else err(r.error ?? 'reorder failed'); }
    catch (e) { err(pickMessage(e)); } finally { setBusy(null); }
  }
  async function actPipe() {
    const parsed = parseJSON<{ deals: unknown[] }>(dealsText); if (!parsed) { err('Invalid deals JSON.'); return; }
    setBusy('pipe'); setFeedback(null);
    try { const r = await callMacro<PipeResult>('pipelineValue', { artifact: { data: parsed } }); if (r.ok && r.result) { setPipeResult(r.result); ok(`Weighted $${r.result.totalWeighted?.toLocaleString()}.`); } else err(r.error ?? 'pipe failed'); }
    catch (e) { err(pickMessage(e)); } finally { setBusy(null); }
  }
  async function actLtv() {
    setBusy('ltv'); setFeedback(null);
    try { const r = await callMacro<LtvResult>('customerLTV', { artifact: { data: { avgOrderValue: parseFloat(aov), purchaseFrequencyPerYear: parseFloat(freq), customerLifespanYears: parseFloat(lifespan), cac: parseFloat(cac) } } }); if (r.ok && r.result) { setLtvResult(r.result); ok(`LTV $${r.result.ltv} · ${r.result.ltvToCacRatio?.toFixed(1)}× CAC.`); } else err(r.error ?? 'ltv failed'); }
    catch (e) { err(pickMessage(e)); } finally { setBusy(null); }
  }
  async function actSla() {
    const parsed = parseJSON<{ incidents: unknown[] }>(incidentsText); if (!parsed) { err('Invalid incidents JSON.'); return; }
    setBusy('sla'); setFeedback(null);
    try { const r = await callMacro<SlaResult>('slaStatus', { artifact: { data: parsed } }); if (r.ok && r.result) { setSlaResult(r.result); ok(`${r.result.complianceRate}% compliance.`); } else err(r.error ?? 'sla failed'); }
    catch (e) { err(pickMessage(e)); } finally { setBusy(null); }
  }
  async function actMint() {
    setBusy('mint'); setFeedback(null);
    try {
      const r = await api.post('/api/lens/run', { domain: 'dtu', name: 'create', input: { title: `Retail ops`, tags: ['retail', 'ops'], source: 'retail:ops:mint', meta: { visibility: 'private', consent: { allowCitations: false }, retail: { reorder: reorderResult, pipe: pipeResult, ltv: ltvResult, sla: slaResult } } } });
      const id = r.data?.result?.dtu?.id ?? r.data?.dtu?.id ?? r.data?.result?.id;
      if (id) { setMintedDtuId(id); ok(`Ops DTU ${id.slice(0, 8)}…`); } else err('No DTU id.');
    } catch (e) { err(pickMessage(e)); } finally { setBusy(null); }
  }
  async function actDm() {
    if (!recipient.trim()) { err('Recipient required.'); return; }
    setBusy('dm'); setFeedback(null);
    const body = [`🛒 Retail brief`, '', reorderResult ? `Reorder: ${reorderResult.criticalCount} critical · ${reorderResult.reorderCount} below ROP · ${reorderResult.sufficientCount} OK` : '', pipeResult ? `Pipeline: $${pipeResult.totalWeighted?.toLocaleString()} weighted (${pipeResult.totalDeals} deals)` : '', ltvResult ? `LTV $${ltvResult.ltv} · CAC $${ltvResult.cac} · ratio ${ltvResult.ltvToCacRatio?.toFixed(1)}×` : '', slaResult ? `SLA: ${slaResult.complianceRate}% · ${slaResult.breaches} breaches` : '', mintedDtuId ? `\n[DTU ${mintedDtuId}]` : ''].filter(Boolean).join('\n');
    try { const r = await api.post('/api/social/dm', { toUserId: recipient.trim(), content: body }); if (r.data?.ok !== false) { ok('Sent.'); setRecipient(''); } else err(r.data?.error ?? 'send failed'); }
    catch (e) { err(pickMessage(e)); } finally { setBusy(null); }
  }
  async function actPublish() {
    if (!ltvResult) { err('Run LTV first.'); return; }
    setBusy('publish'); setFeedback(null);
    try {
      const r = await api.post('/api/lens/run', { domain: 'dtu', name: 'create', input: { title: `Retail unit econ`, tags: ['retail', 'ltv', 'public'], source: 'retail:ltv:publish', meta: { visibility: 'public', consent: { allowCitations: true }, anon: true, ltv: ltvResult } } });
      const id = r.data?.result?.dtu?.id ?? r.data?.dtu?.id ?? r.data?.result?.id;
      if (!id) { err('No DTU id.'); return; }
      const pub = await api.post(`/api/dtus/${encodeURIComponent(id)}/publish`);
      if (pub.data?.ok !== false) { setPublishedDtuId(id); ok(`Published ${id.slice(0, 8)}…`); } else err(pub.data?.error ?? 'publish failed');
    } catch (e) { err(pickMessage(e)); } finally { setBusy(null); }
  }
  async function actAgent() {
    setBusy('agent'); setFeedback(null); setAgentReply(null);
    try {
      const task = `Retail ops review. ${reorderResult ? `${reorderResult.criticalCount} critical stockouts, ${reorderResult.reorderCount} below reorder.` : ''} ${pipeResult ? `Weighted pipeline $${pipeResult.totalWeighted?.toLocaleString()}.` : ''} ${ltvResult ? `LTV $${ltvResult.ltv} on CAC $${ltvResult.cac} (${ltvResult.ltvToCacRatio?.toFixed(1)}× ratio).` : ''} ${slaResult ? `SLA ${slaResult.complianceRate}% compliance.` : ''} Identify the single most urgent operational lever. Plain text, 3 sentences max.`;
      const r = await api.post('/api/lens/run', { domain: 'chat_agent', name: 'do', input: { task, maxTurns: 3 } });
      const reply = r.data?.result?.reply ?? r.data?.result?.summary ?? r.data?.result?.output ?? r.data?.reply;
      if (reply) { setAgentReply(typeof reply === 'string' ? reply : JSON.stringify(reply, null, 2)); ok('Lever ready.'); } else err('Agent returned empty.');
    } catch (e) { err(pickMessage(e)); } finally { setBusy(null); }
  }

  const actions = [
    { id: 'reorder' as ActionId, label: 'Reorder', desc: 'reorderCheck', icon: ShoppingCart, accent: '#ef4444', handler: actReorder },
    { id: 'pipe' as ActionId, label: 'Pipeline', desc: 'pipelineValue', icon: Target, accent: '#3b82f6', handler: actPipe },
    { id: 'ltv' as ActionId, label: 'LTV', desc: 'customerLTV', icon: Users, accent: '#22c55e', handler: actLtv },
    { id: 'sla' as ActionId, label: 'SLA', desc: 'slaStatus', icon: Clock, accent: '#f59e0b', handler: actSla },
    { id: 'mint' as ActionId, label: mintedDtuId ? 'Saved' : 'Mint', desc: mintedDtuId ? `${mintedDtuId.slice(0, 8)}…` : 'Private ops DTU', icon: Sparkles, accent: '#a855f7', handler: actMint },
    { id: 'dm' as ActionId, label: 'DM', desc: 'Send ops brief', icon: Send, accent: '#ec4899', handler: actDm },
    { id: 'publish' as ActionId, label: publishedDtuId ? 'Published' : 'Publish', desc: publishedDtuId ? `${publishedDtuId.slice(0, 8)}…` : 'Anon unit econ', icon: Globe, accent: '#15803d', handler: actPublish },
    { id: 'agent' as ActionId, label: 'Lever', desc: 'Agent: top lever', icon: Wand2, accent: '#eab308', handler: actAgent },
  ];

  return (
    <div className="rounded-lg border border-rose-500/20 bg-zinc-950/60 p-3 space-y-3">
      <header className="flex items-center gap-2 border-b border-rose-500/10 pb-2">
        <ShoppingCart className="h-4 w-4 text-rose-400" />
        <h3 className="text-sm font-semibold text-white">Retail ops</h3>
        <span className="rounded bg-zinc-800 px-1.5 py-0.5 font-mono text-[10px] uppercase tracking-wider text-zinc-400">reorder · pipeline · LTV · SLA</span>
      </header>

      <div className="grid grid-cols-1 md:grid-cols-3 gap-2">
        <div>
          <label className="text-[10px] uppercase tracking-wider text-red-400 font-semibold">Products JSON</label>
          <textarea value={productsText} onChange={(e) => setProductsText(e.target.value)} rows={5} className="w-full bg-zinc-900 border border-zinc-800 rounded px-3 py-1 text-[10px] text-white font-mono mt-1" />
        </div>
        <div>
          <label className="text-[10px] uppercase tracking-wider text-blue-400 font-semibold">Deals JSON</label>
          <textarea value={dealsText} onChange={(e) => setDealsText(e.target.value)} rows={5} className="w-full bg-zinc-900 border border-zinc-800 rounded px-3 py-1 text-[10px] text-white font-mono mt-1" />
        </div>
        <div className="space-y-1.5">
          <div className="text-[10px] uppercase tracking-wider text-green-400 font-semibold">LTV inputs</div>
          <div className="grid grid-cols-2 gap-1">
            <input type="text" value={aov} onChange={(e) => setAov(e.target.value)} className="bg-zinc-900 border border-zinc-800 rounded px-2 py-1 text-[11px] text-white font-mono" placeholder="AOV $" />
            <input type="text" value={freq} onChange={(e) => setFreq(e.target.value)} className="bg-zinc-900 border border-zinc-800 rounded px-2 py-1 text-[11px] text-white font-mono" placeholder="Freq/yr" />
            <input type="text" value={lifespan} onChange={(e) => setLifespan(e.target.value)} className="bg-zinc-900 border border-zinc-800 rounded px-2 py-1 text-[11px] text-white font-mono" placeholder="Span yr" />
            <input type="text" value={cac} onChange={(e) => setCac(e.target.value)} className="bg-zinc-900 border border-zinc-800 rounded px-2 py-1 text-[11px] text-white font-mono" placeholder="CAC $" />
          </div>
          <div className="text-[10px] uppercase tracking-wider text-amber-400 font-semibold mt-1.5">Incidents JSON</div>
          <textarea value={incidentsText} onChange={(e) => setIncidentsText(e.target.value)} rows={2} className="w-full bg-zinc-900 border border-zinc-800 rounded px-3 py-1 text-[10px] text-white font-mono" />
          <input type="text" value={recipient} onChange={(e) => setRecipient(e.target.value)} className="w-full bg-zinc-900 border border-zinc-800 rounded px-3 py-1 text-[11px] text-white" placeholder="DM recipient" />
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
        {reorderResult && (
          <div className="rounded-md border border-red-500/30 bg-red-500/5 p-2.5 max-h-44 overflow-y-auto">
            <div className="text-[10px] uppercase tracking-wider text-red-300 font-semibold">Reorder · {reorderResult.totalProducts} SKUs</div>
            <div className="text-2xl font-bold text-red-300">{reorderResult.criticalCount} <span className="text-xs text-zinc-400">critical</span></div>
            <div className="text-[10px] text-amber-300">{reorderResult.reorderCount} below ROP · <span className="text-emerald-300">{reorderResult.sufficientCount} OK</span></div>
            {reorderResult.critical.slice(0, 3).map((p, i) => <div key={i} className="text-[10px] text-red-200 mt-0.5"><span className="font-mono">{p.sku}</span> · {p.onHand} on hand · {p.status}</div>)}
          </div>
        )}
        {pipeResult && (
          <div className="rounded-md border border-blue-500/30 bg-blue-500/5 p-2.5">
            <div className="text-[10px] uppercase tracking-wider text-blue-300 font-semibold">Pipeline · {pipeResult.totalDeals} deals</div>
            <div className="text-2xl font-bold text-blue-300">${pipeResult.totalWeighted?.toLocaleString()}</div>
            <div className="text-[10px] text-zinc-500">unweighted ${pipeResult.totalUnweighted?.toLocaleString()}</div>
            {pipeResult.expectedRevenue != null && <div className="text-[10px] text-blue-200">expected ${pipeResult.expectedRevenue.toLocaleString()}</div>}
            {pipeResult.byStage && Object.entries(pipeResult.byStage).slice(0, 4).map(([s, b]) => <div key={s} className="text-[10px] text-zinc-400 mt-0.5"><span className="font-mono text-blue-200">{s}</span>: {b.count} · ${b.weighted?.toLocaleString()}</div>)}
          </div>
        )}
        {ltvResult && (
          <div className={cn('rounded-md border p-2.5', (ltvResult.ltvToCacRatio ?? 0) >= 3 ? 'border-emerald-500/30 bg-emerald-500/5' : (ltvResult.ltvToCacRatio ?? 0) >= 1 ? 'border-amber-500/30 bg-amber-500/5' : 'border-red-500/30 bg-red-500/5')}>
            <div className="text-[10px] uppercase tracking-wider text-green-300 font-semibold">LTV / CAC</div>
            <div className="text-2xl font-bold text-green-300">${ltvResult.ltv?.toLocaleString()}</div>
            <div className="text-[10px] text-zinc-500">AOV ${ltvResult.avgOrderValue} × {ltvResult.purchaseFrequency}/yr × {ltvResult.customerLifespanYears}yr</div>
            <div className="text-[10px] text-zinc-500">CAC ${ltvResult.cac} · ratio <span className={(ltvResult.ltvToCacRatio ?? 0) >= 3 ? 'text-emerald-300' : (ltvResult.ltvToCacRatio ?? 0) >= 1 ? 'text-amber-300' : 'text-red-300'}>{ltvResult.ltvToCacRatio?.toFixed(2)}×</span></div>
          </div>
        )}
        {slaResult && (
          <div className={cn('rounded-md border p-2.5', (slaResult.complianceRate ?? 0) >= 95 ? 'border-emerald-500/30 bg-emerald-500/5' : (slaResult.complianceRate ?? 0) >= 80 ? 'border-amber-500/30 bg-amber-500/5' : 'border-red-500/30 bg-red-500/5')}>
            <div className="text-[10px] uppercase tracking-wider text-amber-300 font-semibold">SLA · {slaResult.tier}</div>
            <div className="text-2xl font-bold text-amber-300">{slaResult.complianceRate}%</div>
            <div className="text-[10px] text-zinc-500">{slaResult.withinSLA} within / {slaResult.breaches} breaches</div>
            <div className="text-[10px] text-zinc-500">avg {slaResult.avgResponseMinutes}min response</div>
          </div>
        )}
      </div>

      {agentReply && (<div className="rounded-md border border-yellow-500/30 bg-yellow-500/5 p-3 max-h-60 overflow-y-auto"><div className="flex items-center gap-1.5 text-yellow-400 font-semibold mb-1.5 uppercase tracking-wider text-[10px]"><Wand2 className="w-3 h-3" /> Top lever</div><pre className="whitespace-pre-wrap font-sans text-[11px] text-zinc-200 leading-relaxed">{agentReply}</pre></div>)}

      <AnimatePresence>
        {feedback && (<motion.div key={feedback.text} initial={{ opacity: 0, y: -2 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: -2 }} className={cn('px-3 py-2 rounded text-[11px] flex items-start gap-2 border', feedback.kind === 'ok' ? 'bg-emerald-500/10 text-emerald-300 border-emerald-500/30' : 'bg-red-500/10 text-red-300 border-red-500/30')}>{feedback.kind === 'ok' ? <Check className="h-3 w-3 mt-0.5" /> : <AlertTriangle className="h-3 w-3 mt-0.5" />}<span>{feedback.text}</span></motion.div>)}
      </AnimatePresence>
    </div>
  );
}
