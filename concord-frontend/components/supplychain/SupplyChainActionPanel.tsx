'use client';

/**
 * SupplyChainActionPanel — operations planner bench.
 * leadTimeAnalysis / inventoryOptimize (EOQ + reorder point) /
 * supplierScore / demandForecast + mint/DM/publish/agent.
 */

import { useState } from 'react';
import { Truck, Package, Star, TrendingUp, Sparkles, Send, Globe, Wand2, Loader2, Check, AlertTriangle } from 'lucide-react';
import { motion, AnimatePresence } from 'framer-motion';
import { api, apiHelpers } from '@/lib/api/client';
import { cn } from '@/lib/utils';
import { usePipe, useRecallableAction, RecallSlot } from '@/components/panel-polish';

interface MacroEnvelope<T> { ok: boolean; result?: T; error?: string }
async function callMacro<T>(action: string, input: Record<string, unknown>): Promise<MacroEnvelope<T>> {
  const r = await apiHelpers.lens.runDomain('supplychain', action, { input });
  const data = (r as { data?: { ok: boolean; result?: T } }).data;
  if (!data) return { ok: false, error: 'empty response' };
  if (data.ok && data.result && typeof data.result === 'object' && 'ok' in data.result) return data.result as MacroEnvelope<T>;
  return data as MacroEnvelope<T>;
}

type Feedback = { kind: 'ok' | 'err'; text: string } | null;
type ActionId = 'lead' | 'inv' | 'sup' | 'fore' | 'mint' | 'dm' | 'publish' | 'agent';
function pickMessage(e: unknown): string { const ax = e as { response?: { data?: { error?: string } }; message?: string }; return ax?.response?.data?.error ?? ax?.message ?? 'request failed'; }

interface LeadResult { ordersAnalyzed: number; avgLeadTimeDays: number; minDays: number; maxDays: number; reliability: string }
interface InvItem { item: string; currentStock: number; reorderPoint: number; safetyStock: number; eoq: number; daysOfStock: number; needsReorder: boolean }
interface InvResult { items: InvItem[]; needsReorder: number; totalItems: number }
interface ScoredSup { supplier: string; quality: number; delivery: number; price: number; responsiveness: number; totalScore: number; tier: string }
interface SupResult { suppliers: ScoredSup[]; topSupplier: string; atRisk: number }
interface ForecastPt { period: string; predicted: number; confidence: string }
interface ForecastResult { historicalPeriods: number; avgDemand: number; trend: string; forecast: ForecastPt[] }

// No seeded data — every input starts empty.
export function SupplyChainActionPanel() {
  const [ordersText, setOrdersText] = useState('');
  const [invText, setInvText] = useState('');
  const [supText, setSupText] = useState('');
  const [histText, setHistText] = useState('');
  const [recipient, setRecipient] = useState('');

  const [busy, setBusy] = useState<ActionId | null>(null);
  const [feedback, setFeedback] = useState<Feedback>(null);
  const [leadResult, setLeadResult] = useState<LeadResult | null>(null);
  const [invResult, setInvResult] = useState<InvResult | null>(null);
  const [supResult, setSupResult] = useState<SupResult | null>(null);
  const [foreResult, setForeResult] = useState<ForecastResult | null>(null);
  const [mintedDtuId, setMintedDtuId] = useState<string | null>(null);
  const [publishedDtuId, setPublishedDtuId] = useState<string | null>(null);
  const [agentReply, setAgentReply] = useState<string | null>(null);

  const ok = (m: string) => setFeedback({ kind: 'ok', text: m });
  const err = (m: string) => setFeedback({ kind: 'err', text: m });

  function parseJSON<T>(text: string): T | null { try { return JSON.parse(text) as T; } catch { return null; } }

  const pipe = usePipe();
  const dmRecall = useRecallableAction({ label: 'DM', windowMs: 60_000, onUndo: async (id) => { await api.delete(`/api/social/dm/${encodeURIComponent(id)}`); } });
  const publishRecall = useRecallableAction({ label: 'publish', windowMs: 30_000, onUndo: async (id) => { await api.delete(`/api/dtus/${encodeURIComponent(id)}/publish`); setPublishedDtuId(null); } });

  async function actLead() {
    if (!ordersText.trim()) { err('Paste orders JSON first.'); return; }
    const orders = parseJSON<unknown[]>(ordersText); if (!orders) { err('Invalid orders JSON.'); return; }
    setBusy('lead'); setFeedback(null);
    try {
      const r = await callMacro<LeadResult>('leadTimeAnalysis', { artifact: { data: { orders } } });
      if (r.ok && r.result) { setLeadResult(r.result); pipe.publish('supplychain.lead', r.result, { label: `Lead ${r.result.avgLeadTimeDays}d` }); ok(`Avg ${r.result.avgLeadTimeDays}d (${r.result.reliability}).`); } else err(r.error ?? 'lead failed');
    } catch (e) { err(pickMessage(e)); } finally { setBusy(null); }
  }
  async function actInv() {
    if (!invText.trim()) { err('Paste inventory JSON first.'); return; }
    const items = parseJSON<unknown[]>(invText); if (!items) { err('Invalid inventory JSON.'); return; }
    setBusy('inv'); setFeedback(null);
    try {
      const r = await callMacro<InvResult>('inventoryOptimize', { artifact: { data: { items } } });
      if (r.ok && r.result) { setInvResult(r.result); pipe.publish('supplychain.inv', r.result, { label: `Inv ${r.result.needsReorder}/${r.result.totalItems}` }); ok(`${r.result.needsReorder} of ${r.result.totalItems} need reorder.`); } else err(r.error ?? 'inv failed');
    } catch (e) { err(pickMessage(e)); } finally { setBusy(null); }
  }
  async function actSup() {
    if (!supText.trim()) { err('Paste suppliers JSON first.'); return; }
    const suppliers = parseJSON<unknown[]>(supText); if (!suppliers) { err('Invalid suppliers JSON.'); return; }
    setBusy('sup'); setFeedback(null);
    try {
      const r = await callMacro<SupResult>('supplierScore', { artifact: { data: { suppliers } } });
      if (r.ok && r.result) { setSupResult(r.result); pipe.publish('supplychain.sup', r.result, { label: `Top: ${r.result.topSupplier}` }); ok(`Top: ${r.result.topSupplier} · at-risk ${r.result.atRisk}.`); } else err(r.error ?? 'sup failed');
    } catch (e) { err(pickMessage(e)); } finally { setBusy(null); }
  }
  async function actFore() {
    if (!histText.trim()) { err('Paste history JSON first.'); return; }
    const history = parseJSON<unknown[]>(histText); if (!history) { err('Invalid history JSON.'); return; }
    setBusy('fore'); setFeedback(null);
    try {
      const r = await callMacro<ForecastResult>('demandForecast', { artifact: { data: { history } } });
      if (r.ok && r.result) { setForeResult(r.result); pipe.publish('supplychain.fore', r.result, { label: `Forecast ${r.result.trend}` }); ok(`${r.result.trend} · avg ${r.result.avgDemand}.`); } else err(r.error ?? 'forecast failed');
    } catch (e) { err(pickMessage(e)); } finally { setBusy(null); }
  }
  async function actMint() {
    setBusy('mint'); setFeedback(null);
    try {
      const r = await api.post('/api/lens/run', { domain: 'dtu', name: 'create', input: { title: `Ops — ${supResult?.topSupplier ?? 'pipeline'}`, tags: ['supplychain', 'ops', supResult?.topSupplier].filter((t): t is string => !!t), source: 'supplychain:ops:mint', meta: { visibility: 'private', consent: { allowCitations: false }, sc: { lead: leadResult, inv: invResult, sup: supResult, fore: foreResult } } } });
      const id = r.data?.result?.dtu?.id ?? r.data?.dtu?.id ?? r.data?.result?.id;
      if (id) { setMintedDtuId(id); pipe.publish('supplychain.mintedDtuId', id, { label: `Ops DTU ${id.slice(0, 8)}…` }); ok(`Ops DTU ${id.slice(0, 8)}…`); } else err('No DTU id.');
    } catch (e) { err(pickMessage(e)); } finally { setBusy(null); }
  }
  async function actDm() {
    if (!recipient.trim()) { err('Recipient required.'); return; }
    setBusy('dm'); setFeedback(null);
    const body = [`🚚 Ops brief`, '',
      leadResult ? `Lead time: avg ${leadResult.avgLeadTimeDays}d (${leadResult.minDays}-${leadResult.maxDays}, ${leadResult.reliability})` : '',
      invResult ? `Inventory: ${invResult.needsReorder}/${invResult.totalItems} need reorder` : '',
      supResult ? `Top supplier: ${supResult.topSupplier} · ${supResult.atRisk} at-risk` : '',
      foreResult ? `Forecast (${foreResult.trend}): +1=${foreResult.forecast[0]?.predicted} / +2=${foreResult.forecast[1]?.predicted} / +3=${foreResult.forecast[2]?.predicted}` : '',
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
    if (!supResult) { err('Run supplier score first.'); return; }
    setBusy('publish'); setFeedback(null);
    try {
      const id = await publishRecall.run(async () => {
        const r = await api.post('/api/lens/run', { domain: 'dtu', name: 'create', input: { title: `Supplier scorecard (anon)`, tags: ['supplychain', 'benchmark', 'public'], source: 'supplychain:scorecard:publish', meta: { visibility: 'public', consent: { allowCitations: true }, anon: true, supScorecard: supResult } } });
        const newId = r.data?.result?.dtu?.id ?? r.data?.dtu?.id ?? r.data?.result?.id;
        if (!newId) throw new Error('No DTU id.');
        const pub = await api.post(`/api/dtus/${encodeURIComponent(newId)}/publish`);
        if (pub.data?.ok === false) throw new Error(pub.data?.error ?? 'publish failed');
        return newId as string;
      });
      if (id) { setPublishedDtuId(id); pipe.publish('supplychain.publishedDtuId', id, { label: `Public scorecard ${id.slice(0, 8)}…` }); ok(`Published ${id.slice(0, 8)}… · 30s to recall.`); }
    } catch (e) { err(pickMessage(e)); } finally { setBusy(null); }
  }
  async function actAgent() {
    setBusy('agent'); setFeedback(null); setAgentReply(null);
    try {
      const task = `Supply-chain ops review. ${leadResult ? `Lead times avg ${leadResult.avgLeadTimeDays}d (${leadResult.reliability}).` : ''} ${invResult ? `${invResult.needsReorder} of ${invResult.totalItems} items need reorder.` : ''} ${supResult ? `Top supplier ${supResult.topSupplier}, ${supResult.atRisk} at-risk suppliers.` : ''} ${foreResult ? `Demand ${foreResult.trend}.` : ''} Identify the single biggest resilience risk + one concrete mitigation. Plain text, 3 sentences max.`;
      const r = await api.post('/api/lens/run', { domain: 'chat_agent', name: 'do', input: { task, maxTurns: 3 } });
      const reply = r.data?.result?.reply ?? r.data?.result?.summary ?? r.data?.result?.output ?? r.data?.reply;
      if (reply) { setAgentReply(typeof reply === 'string' ? reply : JSON.stringify(reply, null, 2)); ok('Risk ready.'); } else err('Agent returned empty.');
    } catch (e) { err(pickMessage(e)); } finally { setBusy(null); }
  }

  const actions = [
    { id: 'lead' as ActionId, label: 'Lead time', desc: 'leadTimeAnalysis', icon: Truck, accent: '#3b82f6', handler: actLead },
    { id: 'inv' as ActionId, label: 'EOQ', desc: 'inventoryOptimize', icon: Package, accent: '#22c55e', handler: actInv },
    { id: 'sup' as ActionId, label: 'Scorecard', desc: 'supplierScore', icon: Star, accent: '#f59e0b', handler: actSup },
    { id: 'fore' as ActionId, label: 'Forecast', desc: 'demandForecast', icon: TrendingUp, accent: '#06b6d4', handler: actFore },
    { id: 'mint' as ActionId, label: mintedDtuId ? 'Saved' : 'Mint', desc: mintedDtuId ? `${mintedDtuId.slice(0, 8)}…` : 'Private ops DTU', icon: Sparkles, accent: '#a855f7', handler: actMint },
    { id: 'dm' as ActionId, label: 'DM', desc: 'Send ops brief', icon: Send, accent: '#ec4899', handler: actDm },
    { id: 'publish' as ActionId, label: publishedDtuId ? 'Published' : 'Publish', desc: publishedDtuId ? `${publishedDtuId.slice(0, 8)}…` : 'Anon benchmark', icon: Globe, accent: '#15803d', handler: actPublish },
    { id: 'agent' as ActionId, label: 'Risk', desc: 'Agent: resilience', icon: Wand2, accent: '#eab308', handler: actAgent },
  ];

  const TIER_COLOR: Record<string, string> = { preferred: 'text-emerald-300', approved: 'text-blue-300', conditional: 'text-amber-300', 'at-risk': 'text-red-300' };
  const REL_COLOR: Record<string, string> = { excellent: 'text-emerald-300', good: 'text-blue-300', acceptable: 'text-amber-300', poor: 'text-red-300' };

  return (
    <div className="rounded-lg border border-blue-500/20 bg-zinc-950/60 p-3 space-y-3">
      <header className="flex items-center gap-2 border-b border-blue-500/10 pb-2">
        <Truck className="h-4 w-4 text-blue-400" />
        <h3 className="text-sm font-semibold text-white">Supply-chain bench</h3>
        <span className="rounded bg-zinc-800 px-1.5 py-0.5 font-mono text-[10px] uppercase tracking-wider text-zinc-400">lead time · EOQ · scorecard · forecast</span>
      </header>

      <div className="grid grid-cols-1 md:grid-cols-2 gap-2">
        <div>
          <label className="text-[10px] uppercase tracking-wider text-blue-400 font-semibold">Orders (JSON)</label>
          <textarea value={ordersText} onChange={(e) => setOrdersText(e.target.value)} rows={5} className="w-full bg-zinc-900 border border-zinc-800 rounded px-3 py-1.5 text-[10px] text-white font-mono mt-1" />
        </div>
        <div>
          <label className="text-[10px] uppercase tracking-wider text-green-400 font-semibold">Inventory (JSON)</label>
          <textarea value={invText} onChange={(e) => setInvText(e.target.value)} rows={5} className="w-full bg-zinc-900 border border-zinc-800 rounded px-3 py-1.5 text-[10px] text-white font-mono mt-1" />
        </div>
        <div>
          <label className="text-[10px] uppercase tracking-wider text-amber-400 font-semibold">Suppliers (JSON)</label>
          <textarea value={supText} onChange={(e) => setSupText(e.target.value)} rows={5} className="w-full bg-zinc-900 border border-zinc-800 rounded px-3 py-1.5 text-[10px] text-white font-mono mt-1" />
        </div>
        <div>
          <label className="text-[10px] uppercase tracking-wider text-cyan-400 font-semibold">Demand history (JSON)</label>
          <textarea value={histText} onChange={(e) => setHistText(e.target.value)} rows={5} className="w-full bg-zinc-900 border border-zinc-800 rounded px-3 py-1.5 text-[10px] text-white font-mono mt-1" />
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
        {leadResult && (
          <div className="rounded-md border border-blue-500/30 bg-blue-500/5 p-2.5">
            <div className="text-[10px] uppercase tracking-wider text-blue-300 font-semibold">Lead time · {leadResult.ordersAnalyzed} orders</div>
            <div className="text-2xl font-bold text-blue-300">{leadResult.avgLeadTimeDays}<span className="text-xs text-zinc-400">d avg</span></div>
            <div className="text-[10px] text-zinc-500">range {leadResult.minDays}-{leadResult.maxDays}d</div>
            <div className={cn('text-[10px] font-semibold', REL_COLOR[leadResult.reliability])}>{leadResult.reliability}</div>
          </div>
        )}
        {invResult && (
          <div className="rounded-md border border-green-500/30 bg-green-500/5 p-2.5 max-h-44 overflow-y-auto">
            <div className="text-[10px] uppercase tracking-wider text-green-300 font-semibold">Inventory · {invResult.needsReorder}/{invResult.totalItems} reorder</div>
            {invResult.items.slice(0, 4).map((i, idx) => <div key={idx} className={cn('text-[10px] mt-0.5', i.needsReorder ? 'text-red-300' : 'text-zinc-300')}><span className="font-mono">{i.item}</span> · stock {i.currentStock} · ROP {i.reorderPoint} · EOQ {i.eoq} · {i.daysOfStock}d{i.needsReorder ? ' ⚠' : ''}</div>)}
          </div>
        )}
        {supResult && (
          <div className="rounded-md border border-amber-500/30 bg-amber-500/5 p-2.5 max-h-44 overflow-y-auto">
            <div className="text-[10px] uppercase tracking-wider text-amber-300 font-semibold">Scorecard · top: {supResult.topSupplier}</div>
            {supResult.suppliers.slice(0, 5).map((s, i) => <div key={i} className="text-[10px] text-zinc-300 mt-0.5 flex items-center gap-2"><span className={cn('font-mono w-16 truncate', TIER_COLOR[s.tier])}>{s.supplier}</span><div className="flex-1 h-1 bg-zinc-800 rounded-full overflow-hidden"><div className="h-full bg-amber-400" style={{ width: `${s.totalScore}%` }} /></div><span className="font-mono text-amber-200">{s.totalScore}</span></div>)}
          </div>
        )}
        {foreResult && (
          <div className="rounded-md border border-cyan-500/30 bg-cyan-500/5 p-2.5">
            <div className="text-[10px] uppercase tracking-wider text-cyan-300 font-semibold">Forecast · {foreResult.trend}</div>
            <div className="text-2xl font-bold text-cyan-300">{foreResult.avgDemand}<span className="text-xs text-zinc-400"> avg</span></div>
            {foreResult.forecast.map((f, i) => <div key={i} className="text-[11px] text-zinc-300">{f.period}: <span className="text-cyan-200 font-mono">{f.predicted}</span> <span className="text-zinc-500">({f.confidence})</span></div>)}
          </div>
        )}
      </div>

      {agentReply && (<div className="rounded-md border border-yellow-500/30 bg-yellow-500/5 p-3 max-h-60 overflow-y-auto"><div className="flex items-center gap-1.5 text-yellow-400 font-semibold mb-1.5 uppercase tracking-wider text-[10px]"><Wand2 className="w-3 h-3" /> Resilience play</div><pre className="whitespace-pre-wrap font-sans text-[11px] text-zinc-200 leading-relaxed">{agentReply}</pre></div>)}

      <AnimatePresence>
        {feedback && (<motion.div key={feedback.text} initial={{ opacity: 0, y: -2 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: -2 }} className={cn('px-3 py-2 rounded text-[11px] flex items-start gap-2 border', feedback.kind === 'ok' ? 'bg-emerald-500/10 text-emerald-300 border-emerald-500/30' : 'bg-red-500/10 text-red-300 border-red-500/30')}>{feedback.kind === 'ok' ? <Check className="h-3 w-3 mt-0.5" /> : <AlertTriangle className="h-3 w-3 mt-0.5" />}<span>{feedback.text}</span></motion.div>)}
      </AnimatePresence>
    </div>
  );
}
