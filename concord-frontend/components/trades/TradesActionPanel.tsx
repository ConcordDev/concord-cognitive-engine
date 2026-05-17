'use client';

/**
 * TradesActionPanel — contractor business bench.
 * calculateEstimate / calculatePL / checkPermits / materialsCost +
 * mint/DM/publish/agent.
 */

import { useState } from 'react';
import { Calculator, TrendingUp, FileCheck, Package, Sparkles, Send, Globe, Wand2, Loader2, Check, AlertTriangle } from 'lucide-react';
import { motion, AnimatePresence } from 'framer-motion';
import { api, apiHelpers } from '@/lib/api/client';
import { cn } from '@/lib/utils';

interface MacroEnvelope<T> { ok: boolean; result?: T; error?: string }
async function callMacro<T>(action: string, payload: Record<string, unknown>): Promise<MacroEnvelope<T>> {
  const r = await apiHelpers.lens.runDomain('trades', action, payload);
  const data = (r as { data?: { ok: boolean; result?: T; error?: string } }).data;
  if (!data) return { ok: false, error: 'empty response' };
  if (data.ok && data.result && typeof data.result === 'object' && 'ok' in data.result) return data.result as MacroEnvelope<T>;
  return data as MacroEnvelope<T>;
}

type Feedback = { kind: 'ok' | 'err'; text: string } | null;
type ActionId = 'est' | 'pl' | 'permit' | 'mat' | 'mint' | 'dm' | 'publish' | 'agent';
function pickMessage(e: unknown): string { const ax = e as { response?: { data?: { error?: string } }; message?: string }; return ax?.response?.data?.error ?? ax?.message ?? 'request failed'; }

interface EstLine { line: number; description: string; category: string; quantity: number; unitCost: number; lineTotal: number }
interface EstResult { lineItems: EstLine[]; subtotal: number; markupPct: number; markupAmount: number; discountAmount: number; taxAmount: number; grandTotal: number; byCategory: Record<string, number> }
interface PlResult { revenue: number; totalCosts: number; grossProfit: number; margin: number; status: string; costBreakdown: { materialsPercent: number; laborPercent: number; overheadPercent: number; otherPercent: number } }
interface PermitRow { permitId: string; type: string; status: string; isExpired?: boolean; daysToExpiry?: number }
interface PermitResult { required?: string[]; missing?: string[]; expired?: PermitRow[]; expiringSoon?: PermitRow[]; valid?: PermitRow[]; readyToBuild?: boolean; recommendation?: string }
interface MatRow { material: string; total: number; unitCost?: number; quantity?: number }
interface MatResult { totalCost?: number; byMaterial?: MatRow[]; mostExpensive?: string; wasteFactor?: number; adjustedTotal?: number }

const DEFAULT_EST = JSON.stringify({ lineItems: [{ description: 'Framing lumber', category: 'materials', quantity: 120, unitCost: 6.5 }, { description: 'Electrical rough-in', category: 'labor', quantity: 16, unitCost: 95 }, { description: 'Permit fees', category: 'other', quantity: 1, unitCost: 450 }, { description: 'Drywall + finish', category: 'labor', quantity: 28, unitCost: 65 }] }, null, 2);
const DEFAULT_EST_PARAMS = JSON.stringify({ markupPct: 22, taxRate: 0.0875, discountPct: 0 }, null, 2);
const DEFAULT_PL = JSON.stringify({ revenue: 48000, costs: { materials: 14500, labor: 18000, overhead: 4200, other: 1300 } }, null, 2);
const DEFAULT_PERMIT = JSON.stringify({ jobType: 'electrical', permits: [{ permitId: 'P-1', type: 'electrical_permit', status: 'active', expiryDate: '2027-01-15' }, { permitId: 'P-2', type: 'building_permit', status: 'active', expiryDate: '2026-06-01' }, { permitId: 'P-3', type: 'plumbing_permit', status: 'expired', expiryDate: '2026-04-15' }] }, null, 2);
const DEFAULT_MAT = JSON.stringify({ materials: [{ material: 'Pine 2x4', quantity: 90, unitCost: 6 }, { material: 'OSB sheathing', quantity: 36, unitCost: 22 }, { material: 'Insulation R-21', quantity: 20, unitCost: 65 }, { material: 'Drywall 4×8', quantity: 48, unitCost: 14 }] }, null, 2);

export function TradesActionPanel() {
  const [estText, setEstText] = useState(DEFAULT_EST);
  const [estParams, setEstParams] = useState(DEFAULT_EST_PARAMS);
  const [plText, setPlText] = useState(DEFAULT_PL);
  const [permitText, setPermitText] = useState(DEFAULT_PERMIT);
  const [matText, setMatText] = useState(DEFAULT_MAT);
  const [recipient, setRecipient] = useState('');

  const [busy, setBusy] = useState<ActionId | null>(null);
  const [feedback, setFeedback] = useState<Feedback>(null);
  const [estResult, setEstResult] = useState<EstResult | null>(null);
  const [plResult, setPlResult] = useState<PlResult | null>(null);
  const [permitResult, setPermitResult] = useState<PermitResult | null>(null);
  const [matResult, setMatResult] = useState<MatResult | null>(null);
  const [mintedDtuId, setMintedDtuId] = useState<string | null>(null);
  const [publishedDtuId, setPublishedDtuId] = useState<string | null>(null);
  const [agentReply, setAgentReply] = useState<string | null>(null);

  const ok = (m: string) => setFeedback({ kind: 'ok', text: m });
  const err = (m: string) => setFeedback({ kind: 'err', text: m });

  async function actEst() {
    try { const parsed = JSON.parse(estText); const params = JSON.parse(estParams); setBusy('est'); setFeedback(null);
      const r = await callMacro<EstResult>('calculateEstimate', { artifact: { data: parsed }, params });
      if (r.ok && r.result) { setEstResult(r.result); ok(`$${r.result.grandTotal} total (${r.result.markupPct}% markup)`); } else err(r.error ?? 'est failed');
    } catch (e) { err(e instanceof SyntaxError ? 'Invalid est JSON.' : pickMessage(e)); } finally { setBusy(null); }
  }
  async function actPl() {
    try { const parsed = JSON.parse(plText); setBusy('pl'); setFeedback(null);
      const r = await callMacro<PlResult>('calculatePL', { artifact: { data: parsed } });
      if (r.ok && r.result) { setPlResult(r.result); ok(`$${r.result.grossProfit} · ${r.result.margin}% · ${r.result.status}`); } else err(r.error ?? 'pl failed');
    } catch (e) { err(e instanceof SyntaxError ? 'Invalid PL JSON.' : pickMessage(e)); } finally { setBusy(null); }
  }
  async function actPermit() {
    try { const parsed = JSON.parse(permitText); setBusy('permit'); setFeedback(null);
      const r = await callMacro<PermitResult>('checkPermits', { artifact: { data: parsed } });
      if (r.ok && r.result) { setPermitResult(r.result); ok(r.result.readyToBuild ? 'Ready to build.' : `${r.result.missing?.length ?? 0} missing · ${r.result.expired?.length ?? 0} expired`); } else err(r.error ?? 'permit failed');
    } catch (e) { err(e instanceof SyntaxError ? 'Invalid permit JSON.' : pickMessage(e)); } finally { setBusy(null); }
  }
  async function actMat() {
    try { const parsed = JSON.parse(matText); setBusy('mat'); setFeedback(null);
      const r = await callMacro<MatResult>('materialsCost', { artifact: { data: parsed } });
      if (r.ok && r.result) { setMatResult(r.result); ok(`$${r.result.adjustedTotal ?? r.result.totalCost ?? '?'} total`); } else err(r.error ?? 'mat failed');
    } catch (e) { err(e instanceof SyntaxError ? 'Invalid mat JSON.' : pickMessage(e)); } finally { setBusy(null); }
  }
  async function actMint() {
    setBusy('mint'); setFeedback(null);
    try {
      const r = await api.post('/api/lens/run', { domain: 'dtu', name: 'create', input: { title: `Trades job brief`, tags: ['trades', plResult?.status, permitResult?.readyToBuild ? 'ready' : 'blocked'].filter((t): t is string => !!t), source: 'trades:job:mint', meta: { visibility: 'private', consent: { allowCitations: false }, trades: { est: estResult, pl: plResult, permit: permitResult, mat: matResult } } } });
      const id = r.data?.result?.dtu?.id ?? r.data?.dtu?.id ?? r.data?.result?.id;
      if (id) { setMintedDtuId(id); ok(`Job DTU ${id.slice(0, 8)}…`); } else err('No DTU id.');
    } catch (e) { err(pickMessage(e)); } finally { setBusy(null); }
  }
  async function actDm() {
    if (!recipient.trim()) { err('Recipient required.'); return; }
    setBusy('dm'); setFeedback(null);
    const body = [`🔧 Trades job brief`, '', estResult ? `Estimate: $${estResult.grandTotal} (${estResult.markupPct}% markup · $${estResult.taxAmount} tax)` : '', plResult ? `P&L: rev $${plResult.revenue} − costs $${plResult.totalCosts} = profit $${plResult.grossProfit} (${plResult.margin}% margin · ${plResult.status})` : '', permitResult ? `Permits: ${permitResult.readyToBuild ? 'READY TO BUILD' : 'BLOCKED'} · ${permitResult.missing?.length ?? 0} missing · ${permitResult.expired?.length ?? 0} expired` : '', matResult ? `Materials: $${matResult.adjustedTotal ?? matResult.totalCost ?? '?'} (most expensive: ${matResult.mostExpensive ?? '—'})` : '', mintedDtuId ? `\n[DTU ${mintedDtuId}]` : ''].filter(Boolean).join('\n');
    try { const r = await api.post('/api/social/dm', { toUserId: recipient.trim(), content: body }); if (r.data?.ok !== false) { ok('Sent.'); setRecipient(''); } else err(r.data?.error ?? 'send failed'); }
    catch (e) { err(pickMessage(e)); } finally { setBusy(null); }
  }
  async function actPublish() {
    if (!estResult) { err('Estimate first.'); return; }
    setBusy('publish'); setFeedback(null);
    try {
      const r = await api.post('/api/lens/run', { domain: 'dtu', name: 'create', input: { title: `Job package`, tags: ['trades', 'job', 'public'], source: 'trades:job:publish', meta: { visibility: 'public', consent: { allowCitations: true }, anon: true, trades: { est: estResult, mat: matResult } } } });
      const id = r.data?.result?.dtu?.id ?? r.data?.dtu?.id ?? r.data?.result?.id;
      if (!id) { err('No DTU id.'); return; }
      const pub = await api.post(`/api/dtus/${encodeURIComponent(id)}/publish`);
      if (pub.data?.ok !== false) { setPublishedDtuId(id); ok(`Published ${id.slice(0, 8)}…`); } else err(pub.data?.error ?? 'publish failed');
    } catch (e) { err(pickMessage(e)); } finally { setBusy(null); }
  }
  async function actAgent() {
    setBusy('agent'); setFeedback(null); setAgentReply(null);
    try {
      const task = `Trades GC brief. ${estResult ? `Estimate $${estResult.grandTotal} (markup ${estResult.markupPct}%).` : ''} ${plResult ? `P&L: profit $${plResult.grossProfit} at ${plResult.margin}% margin (${plResult.status}).` : ''} ${permitResult ? `Permits: ${permitResult.readyToBuild ? 'ready' : 'blocked'}; missing ${permitResult.missing?.join(',') ?? 'none'}.` : ''} ${matResult ? `Materials cost $${matResult.adjustedTotal ?? matResult.totalCost ?? '?'}.` : ''} Recommend the highest-margin lever to pull + one compliance risk to address. Plain text, ≤ 3 sentences.`;
      const r = await api.post('/api/lens/run', { domain: 'chat_agent', name: 'do', input: { task, maxTurns: 3 } });
      const reply = r.data?.result?.reply ?? r.data?.result?.summary ?? r.data?.result?.output ?? r.data?.reply;
      if (reply) { setAgentReply(typeof reply === 'string' ? reply : JSON.stringify(reply, null, 2)); ok('GC brief ready.'); } else err('Agent returned empty.');
    } catch (e) { err(pickMessage(e)); } finally { setBusy(null); }
  }

  const actions = [
    { id: 'est' as ActionId, label: 'Estimate', desc: 'calculateEstimate', icon: Calculator, accent: '#3b82f6', handler: actEst },
    { id: 'pl' as ActionId, label: 'P&L', desc: 'calculatePL', icon: TrendingUp, accent: '#22c55e', handler: actPl },
    { id: 'permit' as ActionId, label: 'Permits', desc: 'checkPermits', icon: FileCheck, accent: '#a855f7', handler: actPermit },
    { id: 'mat' as ActionId, label: 'Materials', desc: 'materialsCost', icon: Package, accent: '#f59e0b', handler: actMat },
    { id: 'mint' as ActionId, label: mintedDtuId ? 'Saved' : 'Mint', desc: mintedDtuId ? `${mintedDtuId.slice(0, 8)}…` : 'Private brief', icon: Sparkles, accent: '#06b6d4', handler: actMint },
    { id: 'dm' as ActionId, label: 'DM', desc: 'Send brief', icon: Send, accent: '#ec4899', handler: actDm },
    { id: 'publish' as ActionId, label: publishedDtuId ? 'Published' : 'Publish', desc: publishedDtuId ? `${publishedDtuId.slice(0, 8)}…` : 'Public package', icon: Globe, accent: '#15803d', handler: actPublish },
    { id: 'agent' as ActionId, label: 'GC', desc: 'Agent: margin lever', icon: Wand2, accent: '#eab308', handler: actAgent },
  ];

  const STATUS_COLOR: Record<string, string> = { profitable: 'text-emerald-300', 'break-even': 'text-amber-300', loss: 'text-red-300' };

  return (
    <div className="rounded-lg border border-amber-500/20 bg-zinc-950/60 p-3 space-y-3">
      <header className="flex items-center gap-2 border-b border-amber-500/10 pb-2">
        <Calculator className="h-4 w-4 text-amber-400" />
        <h3 className="text-sm font-semibold text-white">Trades / GC bench</h3>
        <span className="rounded bg-zinc-800 px-1.5 py-0.5 font-mono text-[10px] uppercase tracking-wider text-zinc-400">estimate · P&L · permits · materials</span>
      </header>

      <div className="grid grid-cols-1 md:grid-cols-2 gap-2">
        <div>
          <label className="text-[10px] uppercase tracking-wider text-blue-400 font-semibold">Line items JSON</label>
          <textarea value={estText} onChange={(e) => setEstText(e.target.value)} rows={5} className="w-full bg-zinc-900 border border-zinc-800 rounded px-3 py-1 text-[10px] text-white font-mono mt-1" />
        </div>
        <div>
          <label className="text-[10px] uppercase tracking-wider text-blue-400 font-semibold">Estimate params</label>
          <textarea value={estParams} onChange={(e) => setEstParams(e.target.value)} rows={5} className="w-full bg-zinc-900 border border-zinc-800 rounded px-3 py-1 text-[10px] text-white font-mono mt-1" />
        </div>
        <div>
          <label className="text-[10px] uppercase tracking-wider text-green-400 font-semibold">P&L JSON</label>
          <textarea value={plText} onChange={(e) => setPlText(e.target.value)} rows={4} className="w-full bg-zinc-900 border border-zinc-800 rounded px-3 py-1 text-[10px] text-white font-mono mt-1" />
        </div>
        <div>
          <label className="text-[10px] uppercase tracking-wider text-purple-400 font-semibold">Permits JSON</label>
          <textarea value={permitText} onChange={(e) => setPermitText(e.target.value)} rows={4} className="w-full bg-zinc-900 border border-zinc-800 rounded px-3 py-1 text-[10px] text-white font-mono mt-1" />
        </div>
        <div>
          <label className="text-[10px] uppercase tracking-wider text-amber-400 font-semibold">Materials JSON</label>
          <textarea value={matText} onChange={(e) => setMatText(e.target.value)} rows={4} className="w-full bg-zinc-900 border border-zinc-800 rounded px-3 py-1 text-[10px] text-white font-mono mt-1" />
        </div>
        <input type="text" value={recipient} onChange={(e) => setRecipient(e.target.value)} className="bg-zinc-900 border border-zinc-800 rounded px-3 py-1.5 text-[11px] text-white" placeholder="DM recipient user-id" />
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
        {estResult && (
          <div className="rounded-md border border-blue-500/30 bg-blue-500/5 p-2.5 max-h-44 overflow-y-auto">
            <div className="text-[10px] uppercase tracking-wider text-blue-300 font-semibold">Estimate</div>
            <div className="text-2xl font-bold text-blue-200">${estResult.grandTotal}</div>
            <div className="text-[10px] text-zinc-500">Sub ${estResult.subtotal} · markup ${estResult.markupAmount} · tax ${estResult.taxAmount}</div>
            {Object.entries(estResult.byCategory).map(([k, v], i) => <div key={i} className="text-[10px] text-zinc-300 mt-0.5 flex justify-between"><span>{k}</span><span className="font-mono text-blue-200">${v}</span></div>)}
          </div>
        )}
        {plResult && (
          <div className={cn('rounded-md border p-2.5', plResult.status === 'profitable' ? 'border-emerald-500/30 bg-emerald-500/5' : plResult.status === 'loss' ? 'border-red-500/30 bg-red-500/5' : 'border-amber-500/30 bg-amber-500/5')}>
            <div className="text-[10px] uppercase tracking-wider text-green-300 font-semibold">P&L · {plResult.status}</div>
            <div className={cn('text-3xl font-bold', STATUS_COLOR[plResult.status])}>{plResult.margin}<span className="text-xs text-zinc-400">%</span></div>
            <div className="text-[10px] text-zinc-300">profit ${plResult.grossProfit}</div>
            <div className="text-[10px] text-zinc-500">rev ${plResult.revenue} · costs ${plResult.totalCosts}</div>
            <div className="text-[10px] text-zinc-400 mt-1">Mat {plResult.costBreakdown.materialsPercent}% · Lab {plResult.costBreakdown.laborPercent}% · OH {plResult.costBreakdown.overheadPercent}%</div>
          </div>
        )}
        {permitResult && (
          <div className={cn('rounded-md border p-2.5 max-h-44 overflow-y-auto', permitResult.readyToBuild ? 'border-emerald-500/30 bg-emerald-500/5' : 'border-red-500/30 bg-red-500/5')}>
            <div className="text-[10px] uppercase tracking-wider text-purple-300 font-semibold">Permits</div>
            <div className={cn('text-xl font-bold', permitResult.readyToBuild ? 'text-emerald-300' : 'text-red-300')}>{permitResult.readyToBuild ? 'READY' : 'BLOCKED'}</div>
            {permitResult.missing?.length ? <div className="text-[10px] text-red-300 mt-1">Missing: {permitResult.missing.join(', ')}</div> : null}
            {permitResult.expired?.slice(0, 3).map((p, i) => <div key={i} className="text-[10px] text-red-300 mt-0.5">⚠ expired: {p.type}</div>)}
            {permitResult.expiringSoon?.slice(0, 2).map((p, i) => <div key={i} className="text-[10px] text-amber-200 mt-0.5">⏰ {p.type}: {p.daysToExpiry}d</div>)}
            {permitResult.recommendation && <div className="text-[10px] text-purple-200 mt-1 italic">{permitResult.recommendation}</div>}
          </div>
        )}
        {matResult && (
          <div className="rounded-md border border-amber-500/30 bg-amber-500/5 p-2.5 max-h-44 overflow-y-auto">
            <div className="text-[10px] uppercase tracking-wider text-amber-300 font-semibold">Materials</div>
            <div className="text-2xl font-bold text-amber-200">${matResult.adjustedTotal ?? matResult.totalCost ?? '?'}</div>
            <div className="text-[10px] text-zinc-500">{matResult.wasteFactor ? `incl ${(matResult.wasteFactor * 100).toFixed(0)}% waste` : 'total'}</div>
            <div className="text-[10px] text-zinc-300 mt-1">Top: {matResult.mostExpensive ?? '—'}</div>
            {matResult.byMaterial?.slice(0, 5).map((m, i) => <div key={i} className="text-[10px] text-zinc-300 mt-0.5 flex justify-between"><span>{m.material}</span><span className="font-mono text-amber-200">${m.total}</span></div>)}
          </div>
        )}
      </div>

      {agentReply && (<div className="rounded-md border border-yellow-500/30 bg-yellow-500/5 p-3 max-h-60 overflow-y-auto"><div className="flex items-center gap-1.5 text-yellow-400 font-semibold mb-1.5 uppercase tracking-wider text-[10px]"><Wand2 className="w-3 h-3" /> GC brief</div><pre className="whitespace-pre-wrap font-sans text-[11px] text-zinc-200 leading-relaxed">{agentReply}</pre></div>)}

      <AnimatePresence>
        {feedback && (<motion.div key={feedback.text} initial={{ opacity: 0, y: -2 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: -2 }} className={cn('px-3 py-2 rounded text-[11px] flex items-start gap-2 border', feedback.kind === 'ok' ? 'bg-emerald-500/10 text-emerald-300 border-emerald-500/30' : 'bg-red-500/10 text-red-300 border-red-500/30')}>{feedback.kind === 'ok' ? <Check className="h-3 w-3 mt-0.5" /> : <AlertTriangle className="h-3 w-3 mt-0.5" />}<span>{feedback.text}</span></motion.div>)}
      </AnimatePresence>
    </div>
  );
}
