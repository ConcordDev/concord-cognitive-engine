'use client';

/**
 * DiyActionPanel — maker bench.
 * estimateProject / cutList / toolCheck / safetyCheck +
 * mint/DM/publish/agent.
 */

import { useState } from 'react';
import { Hammer, Ruler, Wrench, ShieldAlert, Sparkles, Send, Globe, Wand2, Loader2, Check, AlertTriangle } from 'lucide-react';
import { motion, AnimatePresence } from 'framer-motion';
import { api, apiHelpers } from '@/lib/api/client';
import { cn } from '@/lib/utils';

interface MacroEnvelope<T> { ok: boolean; result?: T; error?: string }
async function callMacro<T>(action: string, input: Record<string, unknown>): Promise<MacroEnvelope<T>> {
  const r = await apiHelpers.lens.runDomain('diy', action, { input });
  const data = (r as { data?: { ok: boolean; result?: T } }).data;
  if (!data) return { ok: false, error: 'empty response' };
  if (data.ok && data.result && typeof data.result === 'object' && 'ok' in data.result) return data.result as MacroEnvelope<T>;
  return data as MacroEnvelope<T>;
}

type Feedback = { kind: 'ok' | 'err'; text: string } | null;
type ActionId = 'estimate' | 'cuts' | 'tools' | 'safety' | 'mint' | 'dm' | 'publish' | 'agent';
function pickMessage(e: unknown): string { const ax = e as { response?: { data?: { error?: string } }; message?: string }; return ax?.response?.data?.error ?? ax?.message ?? 'request failed'; }

interface MaterialItem { name: string; quantity: number; unit: string; unitPrice: number; total: number }
interface EstimateResult { projectName: string; category: string; difficulty: string; breakdown: { materialsCost: number; wasteAllowance: number; adjustedMaterials: number; laborCost: number; laborHours: number; hourlyRate: number; contingency: number; contingencyRate: string }; totalEstimate: number; materialItems: MaterialItem[]; budgetTip: string }
interface BoardRow { board: number; cuts: string[]; remaining: number; utilization: number }
interface CutResult { stockLength: number; kerfWidth: number; totalCuts: number; boardsNeeded: number; boards: BoardRow[]; efficiency: number; totalWaste: number; wasteTip: string }
interface ToolRow { tool: string; owned: boolean; condition: string | null; needsRepair: boolean }
interface ToolCost { tool: string; buyEstimate: number | null; rentEstimate: number | null }
interface ToolResult { totalRequired: number; owned: number; missing: number; needsRepair: number; readyToStart: boolean; tools: ToolRow[]; missingCosts: ToolCost[]; totalBuyCost: number; totalRentCost: number; recommendation: string }
interface SafetyResult { riskLevel: string; requiredPPE: string[]; hazards: string[]; precautions: string[]; safetyScore: number; clearToStart: boolean }

const DEFAULT_EST = JSON.stringify({ name: 'Bookshelf', category: 'furniture', difficulty: 'intermediate', materials: [{ name: 'Pine 1x12', quantity: 4, unit: 'board', unitPrice: 22 }, { name: 'Wood screws', quantity: 50, unit: 'pcs', unitPrice: 0.1 }, { name: 'Wood glue', quantity: 1, unit: 'bottle', unitPrice: 7 }, { name: 'Stain', quantity: 1, unit: 'qt', unitPrice: 18 }], estimatedHours: 8, hourlyRate: 30 }, null, 2);
const DEFAULT_CUTS = JSON.stringify({ stockLength: 96, cuts: [{ length: 36, quantity: 4, label: 'Shelf' }, { length: 60, quantity: 2, label: 'Side' }, { length: 33, quantity: 1, label: 'Top' }] }, null, 2);
const DEFAULT_TOOLS = JSON.stringify({ requiredTools: ['circular saw', 'drill', 'sander', 'clamps'], ownedTools: [{ name: 'drill', condition: 'good' }, { name: 'clamps', condition: 'good' }] }, null, 2);
const DEFAULT_SAFETY = JSON.stringify({ category: 'furniture', tools: ['circular saw', 'drill', 'sander'], materials: ['wood', 'stain'], difficulty: 'intermediate' }, null, 2);

export function DiyActionPanel() {
  const [estText, setEstText] = useState(DEFAULT_EST);
  const [cutsText, setCutsText] = useState(DEFAULT_CUTS);
  const [toolsText, setToolsText] = useState(DEFAULT_TOOLS);
  const [safetyText, setSafetyText] = useState(DEFAULT_SAFETY);
  const [recipient, setRecipient] = useState('');

  const [busy, setBusy] = useState<ActionId | null>(null);
  const [feedback, setFeedback] = useState<Feedback>(null);
  const [estResult, setEstResult] = useState<EstimateResult | null>(null);
  const [cutResult, setCutResult] = useState<CutResult | null>(null);
  const [toolResult, setToolResult] = useState<ToolResult | null>(null);
  const [safetyResult, setSafetyResult] = useState<SafetyResult | null>(null);
  const [mintedDtuId, setMintedDtuId] = useState<string | null>(null);
  const [publishedDtuId, setPublishedDtuId] = useState<string | null>(null);
  const [agentReply, setAgentReply] = useState<string | null>(null);

  const ok = (m: string) => setFeedback({ kind: 'ok', text: m });
  const err = (m: string) => setFeedback({ kind: 'err', text: m });

  async function actEst() {
    try { const parsed = JSON.parse(estText); setBusy('estimate'); setFeedback(null);
      const r = await callMacro<EstimateResult>('estimateProject', { artifact: { data: parsed } });
      if (r.ok && r.result) { setEstResult(r.result); ok(`$${r.result.totalEstimate} total · ${r.result.difficulty}`); } else err(r.error ?? 'estimate failed');
    } catch (e) { err(e instanceof SyntaxError ? 'Invalid project JSON.' : pickMessage(e)); } finally { setBusy(null); }
  }
  async function actCuts() {
    try { const parsed = JSON.parse(cutsText); setBusy('cuts'); setFeedback(null);
      const r = await callMacro<CutResult>('cutList', { artifact: { data: parsed } });
      if (r.ok && r.result) { setCutResult(r.result); ok(`${r.result.boardsNeeded} boards · ${r.result.efficiency}% efficient`); } else err(r.error ?? 'cuts failed');
    } catch (e) { err(e instanceof SyntaxError ? 'Invalid cuts JSON.' : pickMessage(e)); } finally { setBusy(null); }
  }
  async function actTools() {
    try { const parsed = JSON.parse(toolsText); setBusy('tools'); setFeedback(null);
      const r = await callMacro<ToolResult>('toolCheck', { artifact: { data: parsed } });
      if (r.ok && r.result) { setToolResult(r.result); ok(r.result.readyToStart ? 'Ready to start.' : `${r.result.missing} missing.`); } else err(r.error ?? 'tools failed');
    } catch (e) { err(e instanceof SyntaxError ? 'Invalid tools JSON.' : pickMessage(e)); } finally { setBusy(null); }
  }
  async function actSafety() {
    try { const parsed = JSON.parse(safetyText); setBusy('safety'); setFeedback(null);
      const r = await callMacro<SafetyResult>('safetyCheck', { artifact: { data: parsed } });
      if (r.ok && r.result) { setSafetyResult(r.result); ok(`${r.result.riskLevel} risk · score ${r.result.safetyScore}`); } else err(r.error ?? 'safety failed');
    } catch (e) { err(e instanceof SyntaxError ? 'Invalid safety JSON.' : pickMessage(e)); } finally { setBusy(null); }
  }
  async function actMint() {
    setBusy('mint'); setFeedback(null);
    try {
      const r = await api.post('/api/lens/run', { domain: 'dtu', name: 'create', input: { title: `DIY project plan`, tags: ['diy', estResult?.category, estResult?.difficulty].filter((t): t is string => !!t), source: 'diy:plan:mint', meta: { visibility: 'private', consent: { allowCitations: false }, diy: { estimate: estResult, cuts: cutResult, tools: toolResult, safety: safetyResult } } } });
      const id = r.data?.result?.dtu?.id ?? r.data?.dtu?.id ?? r.data?.result?.id;
      if (id) { setMintedDtuId(id); ok(`Project DTU ${id.slice(0, 8)}…`); } else err('No DTU id.');
    } catch (e) { err(pickMessage(e)); } finally { setBusy(null); }
  }
  async function actDm() {
    if (!recipient.trim()) { err('Recipient required.'); return; }
    setBusy('dm'); setFeedback(null);
    const body = [`🔨 DIY plan`, '', estResult ? `Estimate: $${estResult.totalEstimate} · ${estResult.breakdown.laborHours}h labor` : '', cutResult ? `Cuts: ${cutResult.boardsNeeded} boards · ${cutResult.efficiency}% efficient` : '', toolResult ? `Tools: ${toolResult.owned}/${toolResult.totalRequired} owned · $${toolResult.totalRentCost} to rent missing` : '', safetyResult ? `Safety: ${safetyResult.riskLevel} risk · PPE: ${safetyResult.requiredPPE.slice(0, 3).join(', ')}` : '', mintedDtuId ? `\n[DTU ${mintedDtuId}]` : ''].filter(Boolean).join('\n');
    try { const r = await api.post('/api/social/dm', { toUserId: recipient.trim(), content: body }); if (r.data?.ok !== false) { ok('Sent.'); setRecipient(''); } else err(r.data?.error ?? 'send failed'); }
    catch (e) { err(pickMessage(e)); } finally { setBusy(null); }
  }
  async function actPublish() {
    if (!estResult) { err('Estimate first.'); return; }
    setBusy('publish'); setFeedback(null);
    try {
      const r = await api.post('/api/lens/run', { domain: 'dtu', name: 'create', input: { title: `${estResult.projectName ?? 'DIY project'}`, tags: ['diy', 'plan', 'public'], source: 'diy:plan:publish', meta: { visibility: 'public', consent: { allowCitations: true }, diy: { estimate: estResult, cuts: cutResult, safety: safetyResult } } } });
      const id = r.data?.result?.dtu?.id ?? r.data?.dtu?.id ?? r.data?.result?.id;
      if (!id) { err('No DTU id.'); return; }
      const pub = await api.post(`/api/dtus/${encodeURIComponent(id)}/publish`);
      if (pub.data?.ok !== false) { setPublishedDtuId(id); ok(`Published ${id.slice(0, 8)}…`); } else err(pub.data?.error ?? 'publish failed');
    } catch (e) { err(pickMessage(e)); } finally { setBusy(null); }
  }
  async function actAgent() {
    setBusy('agent'); setFeedback(null); setAgentReply(null);
    try {
      const task = `DIY build coach. ${estResult ? `Cost: $${estResult.totalEstimate} (${estResult.difficulty}).` : ''} ${toolResult ? `Tools: ${toolResult.missing} missing.` : ''} ${safetyResult ? `Safety: ${safetyResult.riskLevel} risk.` : ''} ${cutResult ? `Cut efficiency: ${cutResult.efficiency}%.` : ''} Give the most important build-order tip + one risk to mitigate. Plain text, ≤ 3 sentences.`;
      const r = await api.post('/api/lens/run', { domain: 'chat_agent', name: 'do', input: { task, maxTurns: 3 } });
      const reply = r.data?.result?.reply ?? r.data?.result?.summary ?? r.data?.result?.output ?? r.data?.reply;
      if (reply) { setAgentReply(typeof reply === 'string' ? reply : JSON.stringify(reply, null, 2)); ok('Plan ready.'); } else err('Agent returned empty.');
    } catch (e) { err(pickMessage(e)); } finally { setBusy(null); }
  }

  const actions = [
    { id: 'estimate' as ActionId, label: 'Estimate', desc: 'estimateProject ($)', icon: Hammer, accent: '#3b82f6', handler: actEst },
    { id: 'cuts' as ActionId, label: 'Cut list', desc: 'cutList (bin-packing)', icon: Ruler, accent: '#f59e0b', handler: actCuts },
    { id: 'tools' as ActionId, label: 'Tools', desc: 'toolCheck (buy/rent)', icon: Wrench, accent: '#22c55e', handler: actTools },
    { id: 'safety' as ActionId, label: 'Safety', desc: 'safetyCheck (PPE)', icon: ShieldAlert, accent: '#ef4444', handler: actSafety },
    { id: 'mint' as ActionId, label: mintedDtuId ? 'Saved' : 'Mint', desc: mintedDtuId ? `${mintedDtuId.slice(0, 8)}…` : 'Private plan', icon: Sparkles, accent: '#06b6d4', handler: actMint },
    { id: 'dm' as ActionId, label: 'DM', desc: 'Send plan', icon: Send, accent: '#ec4899', handler: actDm },
    { id: 'publish' as ActionId, label: publishedDtuId ? 'Published' : 'Publish', desc: publishedDtuId ? `${publishedDtuId.slice(0, 8)}…` : 'Public plan', icon: Globe, accent: '#15803d', handler: actPublish },
    { id: 'agent' as ActionId, label: 'Coach', desc: 'Agent: build tip', icon: Wand2, accent: '#eab308', handler: actAgent },
  ];

  return (
    <div className="rounded-lg border border-orange-500/20 bg-zinc-950/60 p-3 space-y-3">
      <header className="flex items-center gap-2 border-b border-orange-500/10 pb-2">
        <Hammer className="h-4 w-4 text-orange-400" />
        <h3 className="text-sm font-semibold text-white">DIY maker bench</h3>
        <span className="rounded bg-zinc-800 px-1.5 py-0.5 font-mono text-[10px] uppercase tracking-wider text-zinc-400">estimate · cuts · tools · safety</span>
      </header>

      <div className="grid grid-cols-1 md:grid-cols-2 gap-2">
        <div>
          <label className="text-[10px] uppercase tracking-wider text-blue-400 font-semibold">Project JSON</label>
          <textarea value={estText} onChange={(e) => setEstText(e.target.value)} rows={5} className="w-full bg-zinc-900 border border-zinc-800 rounded px-3 py-1 text-[10px] text-white font-mono mt-1" />
        </div>
        <div>
          <label className="text-[10px] uppercase tracking-wider text-amber-400 font-semibold">Cut list JSON</label>
          <textarea value={cutsText} onChange={(e) => setCutsText(e.target.value)} rows={5} className="w-full bg-zinc-900 border border-zinc-800 rounded px-3 py-1 text-[10px] text-white font-mono mt-1" />
        </div>
        <div>
          <label className="text-[10px] uppercase tracking-wider text-green-400 font-semibold">Tools JSON</label>
          <textarea value={toolsText} onChange={(e) => setToolsText(e.target.value)} rows={5} className="w-full bg-zinc-900 border border-zinc-800 rounded px-3 py-1 text-[10px] text-white font-mono mt-1" />
        </div>
        <div>
          <label className="text-[10px] uppercase tracking-wider text-red-400 font-semibold">Safety JSON</label>
          <textarea value={safetyText} onChange={(e) => setSafetyText(e.target.value)} rows={5} className="w-full bg-zinc-900 border border-zinc-800 rounded px-3 py-1 text-[10px] text-white font-mono mt-1" />
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

      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-2">
        {estResult && (
          <div className="rounded-md border border-blue-500/30 bg-blue-500/5 p-2.5 max-h-44 overflow-y-auto">
            <div className="text-[10px] uppercase tracking-wider text-blue-300 font-semibold">Estimate · {estResult.difficulty}</div>
            <div className="text-2xl font-bold text-blue-200">${estResult.totalEstimate}</div>
            <div className="text-[10px] text-zinc-300">Materials ${estResult.breakdown.adjustedMaterials} · Labor ${estResult.breakdown.laborCost} · Contingency ${estResult.breakdown.contingency} ({estResult.breakdown.contingencyRate})</div>
            {estResult.materialItems.slice(0, 5).map((m, i) => <div key={i} className="text-[10px] text-zinc-400 mt-0.5 flex justify-between"><span>{m.name} × {m.quantity}</span><span className="font-mono">${m.total}</span></div>)}
            <div className="text-[10px] text-blue-200 mt-1 italic">{estResult.budgetTip}</div>
          </div>
        )}
        {cutResult && (
          <div className="rounded-md border border-amber-500/30 bg-amber-500/5 p-2.5 max-h-44 overflow-y-auto">
            <div className="text-[10px] uppercase tracking-wider text-amber-300 font-semibold">Cuts · {cutResult.efficiency}% efficient</div>
            <div className="text-[10px] text-zinc-500">{cutResult.boardsNeeded} boards · {cutResult.totalCuts} cuts · {cutResult.totalWaste}" waste</div>
            {cutResult.boards.slice(0, 6).map((b, i) => <div key={i} className="text-[10px] text-zinc-300 mt-0.5"><strong>#{b.board}</strong>: {b.cuts.join(' + ')} · {b.utilization}% used</div>)}
            <div className="text-[10px] text-amber-200 mt-1 italic">{cutResult.wasteTip}</div>
          </div>
        )}
        {toolResult && (
          <div className="rounded-md border border-green-500/30 bg-green-500/5 p-2.5 max-h-44 overflow-y-auto">
            <div className="text-[10px] uppercase tracking-wider text-green-300 font-semibold">Tools · {toolResult.owned}/{toolResult.totalRequired}</div>
            <div className={cn('text-2xl font-bold', toolResult.readyToStart ? 'text-emerald-300' : 'text-amber-300')}>{toolResult.readyToStart ? 'Ready' : `${toolResult.missing} miss`}</div>
            <div className="text-[10px] text-zinc-500">Buy ${toolResult.totalBuyCost} · Rent ${toolResult.totalRentCost}</div>
            {toolResult.tools.map((t, i) => <div key={i} className={cn('text-[10px] mt-0.5', t.owned ? (t.needsRepair ? 'text-amber-300' : 'text-emerald-300') : 'text-red-300')}>{t.owned ? '✓' : '✗'} {t.tool}{t.condition && ` (${t.condition})`}</div>)}
            <div className="text-[10px] text-green-200 mt-1 italic">{toolResult.recommendation}</div>
          </div>
        )}
        {safetyResult && (
          <div className={cn('rounded-md border p-2.5 max-h-44 overflow-y-auto', safetyResult.riskLevel === 'high' ? 'border-red-500/40 bg-red-500/10' : safetyResult.riskLevel === 'moderate' ? 'border-amber-500/30 bg-amber-500/5' : 'border-emerald-500/30 bg-emerald-500/5')}>
            <div className="text-[10px] uppercase tracking-wider text-red-300 font-semibold">Safety · {safetyResult.riskLevel}</div>
            <div className={cn('text-2xl font-bold', safetyResult.safetyScore >= 70 ? 'text-emerald-300' : safetyResult.safetyScore >= 40 ? 'text-amber-300' : 'text-red-300')}>{safetyResult.safetyScore}/100</div>
            <div className="text-[10px] text-zinc-300 font-semibold mt-1">PPE</div>
            <div className="flex flex-wrap gap-1 mt-0.5">{safetyResult.requiredPPE.map((p, i) => <span key={i} className="px-1.5 py-0.5 rounded bg-zinc-800 text-[9px] text-red-200">{p}</span>)}</div>
            {safetyResult.hazards.slice(0, 4).map((h, i) => <div key={i} className="text-[10px] text-zinc-400 mt-0.5">⚠ {h}</div>)}
          </div>
        )}
      </div>

      {agentReply && (<div className="rounded-md border border-yellow-500/30 bg-yellow-500/5 p-3 max-h-60 overflow-y-auto"><div className="flex items-center gap-1.5 text-yellow-400 font-semibold mb-1.5 uppercase tracking-wider text-[10px]"><Wand2 className="w-3 h-3" /> Build coach</div><pre className="whitespace-pre-wrap font-sans text-[11px] text-zinc-200 leading-relaxed">{agentReply}</pre></div>)}

      <AnimatePresence>
        {feedback && (<motion.div key={feedback.text} initial={{ opacity: 0, y: -2 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: -2 }} className={cn('px-3 py-2 rounded text-[11px] flex items-start gap-2 border', feedback.kind === 'ok' ? 'bg-emerald-500/10 text-emerald-300 border-emerald-500/30' : 'bg-red-500/10 text-red-300 border-red-500/30')}>{feedback.kind === 'ok' ? <Check className="h-3 w-3 mt-0.5" /> : <AlertTriangle className="h-3 w-3 mt-0.5" />}<span>{feedback.text}</span></motion.div>)}
      </AnimatePresence>
    </div>
  );
}
