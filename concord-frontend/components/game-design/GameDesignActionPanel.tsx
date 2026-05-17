'use client';

/**
 * GameDesignActionPanel — game-designer bench.
 * mechanicsAnalysis / playerFlow / narrativeBranch / monetizationModel +
 * mint/DM/publish/agent.
 */

import { useState } from 'react';
import { Gamepad2, Activity, GitFork, DollarSign, Sparkles, Send, Globe, Wand2, Loader2, Check, AlertTriangle } from 'lucide-react';
import { motion, AnimatePresence } from 'framer-motion';
import { api, apiHelpers } from '@/lib/api/client';
import { cn } from '@/lib/utils';

interface MacroEnvelope<T> { ok: boolean; result?: T; error?: string }
async function callMacro<T>(action: string, input: Record<string, unknown>): Promise<MacroEnvelope<T>> {
  const r = await apiHelpers.lens.runDomain('game-design', action, { input });
  const data = (r as { data?: { ok: boolean; result?: T } }).data;
  if (!data) return { ok: false, error: 'empty response' };
  if (data.ok && data.result && typeof data.result === 'object' && 'ok' in data.result) return data.result as MacroEnvelope<T>;
  return data as MacroEnvelope<T>;
}

type Feedback = { kind: 'ok' | 'err'; text: string } | null;
type ActionId = 'mechanics' | 'flow' | 'branch' | 'money' | 'mint' | 'dm' | 'publish' | 'agent';
function pickMessage(e: unknown): string { const ax = e as { response?: { data?: { error?: string } }; message?: string }; return ax?.response?.data?.error ?? ax?.message ?? 'request failed'; }

interface MechanicsResult { totalMechanics: number; categories: { category: string; count: number }[]; depthScore: number; loopCount: number; emergentPotential: string; pillars: string[] }
interface FlowState { state: string; challenge: number; skill: number; duration: number; flowZone: boolean }
interface FlowResult { states: FlowState[]; totalStates: number; inFlowZone: number; flowPercent: number; totalDuration: number; pacing: string }
interface BranchResult { totalNodes: number; totalChoices: number; avgChoicesPerNode: number; endings: number; maxBranchDepth: number; complexity: string; replayValue: string }
interface MoneyResult { model: string; revenue: string; avgLTV: number; retention: string; fairness: string; development: string; expectedDAU: number; conversionRate: string; projectedMonthlyRevenue: number; projectedAnnualRevenue: number; ethicalConsiderations: string[] }

const DEFAULT_MECH = JSON.stringify({ mechanics: [{ name: 'Sword combat', category: 'combat' }, { name: 'Skill tree', category: 'progression' }, { name: 'Co-op missions', category: 'social' }, { name: 'Guild bank', category: 'economy' }, { name: 'Movement parkour', category: 'core', loop: true }, { name: 'Reputation', category: 'social' }, { name: 'Crafting', category: 'economy', isLoop: true }, { name: 'PvP arena', category: 'combat' }] }, null, 2);
const DEFAULT_FLOW = JSON.stringify({ states: [{ name: 'Tutorial intro', challenge: 15, skillRequired: 10, durationMinutes: 8 }, { name: 'First boss', challenge: 55, skillRequired: 50, durationMinutes: 15 }, { name: 'Mid-game hub', challenge: 30, skillRequired: 65, durationMinutes: 20 }, { name: 'Raid finale', challenge: 90, skillRequired: 85, durationMinutes: 45 }, { name: 'New game+', challenge: 70, skillRequired: 60, durationMinutes: 30 }] }, null, 2);
const DEFAULT_BRANCH = JSON.stringify({ nodes: Array.from({ length: 12 }).map((_, i) => ({ id: `n${i}`, choices: i % 3 === 0 ? [] : ['A', 'B'], isEnding: i % 5 === 0 })) }, null, 2);
const DEFAULT_MONEY = JSON.stringify({ model: 'battle-pass', expectedDAU: 25000, conversionRate: 0.08 }, null, 2);

export function GameDesignActionPanel() {
  const [mechText, setMechText] = useState(DEFAULT_MECH);
  const [flowText, setFlowText] = useState(DEFAULT_FLOW);
  const [branchText, setBranchText] = useState(DEFAULT_BRANCH);
  const [moneyText, setMoneyText] = useState(DEFAULT_MONEY);
  const [recipient, setRecipient] = useState('');

  const [busy, setBusy] = useState<ActionId | null>(null);
  const [feedback, setFeedback] = useState<Feedback>(null);
  const [mechResult, setMechResult] = useState<MechanicsResult | null>(null);
  const [flowResult, setFlowResult] = useState<FlowResult | null>(null);
  const [branchResult, setBranchResult] = useState<BranchResult | null>(null);
  const [moneyResult, setMoneyResult] = useState<MoneyResult | null>(null);
  const [mintedDtuId, setMintedDtuId] = useState<string | null>(null);
  const [publishedDtuId, setPublishedDtuId] = useState<string | null>(null);
  const [agentReply, setAgentReply] = useState<string | null>(null);

  const ok = (m: string) => setFeedback({ kind: 'ok', text: m });
  const err = (m: string) => setFeedback({ kind: 'err', text: m });

  async function actMech() {
    try { const parsed = JSON.parse(mechText); setBusy('mechanics'); setFeedback(null);
      const r = await callMacro<MechanicsResult>('mechanicsAnalysis', { artifact: { data: parsed } });
      if (r.ok && r.result) { setMechResult(r.result); ok(`Depth ${r.result.depthScore} · ${r.result.emergentPotential} emergence`); } else err(r.error ?? 'mechanics failed');
    } catch (e) { err(e instanceof SyntaxError ? 'Invalid mechanics JSON.' : pickMessage(e)); } finally { setBusy(null); }
  }
  async function actFlow() {
    try { const parsed = JSON.parse(flowText); setBusy('flow'); setFeedback(null);
      const r = await callMacro<FlowResult>('playerFlow', { artifact: { data: parsed } });
      if (r.ok && r.result) { setFlowResult(r.result); ok(`Flow ${r.result.flowPercent}% · ${r.result.pacing}`); } else err(r.error ?? 'flow failed');
    } catch (e) { err(e instanceof SyntaxError ? 'Invalid flow JSON.' : pickMessage(e)); } finally { setBusy(null); }
  }
  async function actBranch() {
    try { const parsed = JSON.parse(branchText); setBusy('branch'); setFeedback(null);
      const r = await callMacro<BranchResult>('narrativeBranch', { artifact: { data: parsed } });
      if (r.ok && r.result) { setBranchResult(r.result); ok(`${r.result.endings} endings · ${r.result.replayValue} replay`); } else err(r.error ?? 'branch failed');
    } catch (e) { err(e instanceof SyntaxError ? 'Invalid branch JSON.' : pickMessage(e)); } finally { setBusy(null); }
  }
  async function actMoney() {
    try { const parsed = JSON.parse(moneyText); setBusy('money'); setFeedback(null);
      const r = await callMacro<MoneyResult>('monetizationModel', { artifact: { data: parsed } });
      if (r.ok && r.result) { setMoneyResult(r.result); ok(`$${r.result.projectedMonthlyRevenue.toLocaleString()}/mo · ${r.result.model}`); } else err(r.error ?? 'money failed');
    } catch (e) { err(e instanceof SyntaxError ? 'Invalid money JSON.' : pickMessage(e)); } finally { setBusy(null); }
  }
  async function actMint() {
    setBusy('mint'); setFeedback(null);
    try {
      const r = await api.post('/api/lens/run', { domain: 'dtu', name: 'create', input: { title: `Game design doc`, tags: ['game-design', moneyResult?.model, branchResult?.complexity].filter((t): t is string => !!t), source: 'game-design:doc:mint', meta: { visibility: 'private', consent: { allowCitations: false }, gd: { mechanics: mechResult, flow: flowResult, branch: branchResult, money: moneyResult } } } });
      const id = r.data?.result?.dtu?.id ?? r.data?.dtu?.id ?? r.data?.result?.id;
      if (id) { setMintedDtuId(id); ok(`GDD DTU ${id.slice(0, 8)}…`); } else err('No DTU id.');
    } catch (e) { err(pickMessage(e)); } finally { setBusy(null); }
  }
  async function actDm() {
    if (!recipient.trim()) { err('Recipient required.'); return; }
    setBusy('dm'); setFeedback(null);
    const body = [`🎮 Game design brief`, '', mechResult ? `Mechanics: ${mechResult.totalMechanics} (depth ${mechResult.depthScore}, ${mechResult.emergentPotential} emergence) · pillars: ${mechResult.pillars.join(', ')}` : '', flowResult ? `Flow: ${flowResult.flowPercent}% in zone · ${flowResult.pacing} (${flowResult.totalDuration}m)` : '', branchResult ? `Narrative: ${branchResult.totalNodes} nodes, ${branchResult.endings} endings · ${branchResult.replayValue} replay` : '', moneyResult ? `Monetization: ${moneyResult.model} · $${moneyResult.projectedAnnualRevenue.toLocaleString()}/yr at ${moneyResult.expectedDAU.toLocaleString()} DAU` : '', mintedDtuId ? `\n[DTU ${mintedDtuId}]` : ''].filter(Boolean).join('\n');
    try { const r = await api.post('/api/social/dm', { toUserId: recipient.trim(), content: body }); if (r.data?.ok !== false) { ok('Sent.'); setRecipient(''); } else err(r.data?.error ?? 'send failed'); }
    catch (e) { err(pickMessage(e)); } finally { setBusy(null); }
  }
  async function actPublish() {
    if (!mechResult) { err('Mechanics first.'); return; }
    setBusy('publish'); setFeedback(null);
    try {
      const r = await api.post('/api/lens/run', { domain: 'dtu', name: 'create', input: { title: `Game design card`, tags: ['game-design', 'card', 'public'], source: 'game-design:card:publish', meta: { visibility: 'public', consent: { allowCitations: true }, gd: { mechanics: mechResult, flow: flowResult, branch: branchResult } } } });
      const id = r.data?.result?.dtu?.id ?? r.data?.dtu?.id ?? r.data?.result?.id;
      if (!id) { err('No DTU id.'); return; }
      const pub = await api.post(`/api/dtus/${encodeURIComponent(id)}/publish`);
      if (pub.data?.ok !== false) { setPublishedDtuId(id); ok(`Published ${id.slice(0, 8)}…`); } else err(pub.data?.error ?? 'publish failed');
    } catch (e) { err(pickMessage(e)); } finally { setBusy(null); }
  }
  async function actAgent() {
    setBusy('agent'); setFeedback(null); setAgentReply(null);
    try {
      const task = `Senior game designer review. ${mechResult ? `Mechanics depth ${mechResult.depthScore}/100 · ${mechResult.emergentPotential} emergence.` : ''} ${flowResult ? `Flow: ${flowResult.flowPercent}% in zone · ${flowResult.pacing}.` : ''} ${branchResult ? `Narrative: ${branchResult.complexity}, ${branchResult.endings} endings, ${branchResult.replayValue} replay.` : ''} ${moneyResult ? `Monetization: ${moneyResult.model} · projecting $${moneyResult.projectedMonthlyRevenue.toLocaleString()}/mo.` : ''} Recommend the single most-impactful design change + one ethical risk to flag. Plain text, ≤ 3 sentences.`;
      const r = await api.post('/api/lens/run', { domain: 'chat_agent', name: 'do', input: { task, maxTurns: 3 } });
      const reply = r.data?.result?.reply ?? r.data?.result?.summary ?? r.data?.result?.output ?? r.data?.reply;
      if (reply) { setAgentReply(typeof reply === 'string' ? reply : JSON.stringify(reply, null, 2)); ok('Designer review ready.'); } else err('Agent returned empty.');
    } catch (e) { err(pickMessage(e)); } finally { setBusy(null); }
  }

  const actions = [
    { id: 'mechanics' as ActionId, label: 'Mechanics', desc: 'mechanicsAnalysis', icon: Gamepad2, accent: '#3b82f6', handler: actMech },
    { id: 'flow' as ActionId, label: 'Flow', desc: 'playerFlow (Csiks.)', icon: Activity, accent: '#22c55e', handler: actFlow },
    { id: 'branch' as ActionId, label: 'Narrative', desc: 'narrativeBranch', icon: GitFork, accent: '#a855f7', handler: actBranch },
    { id: 'money' as ActionId, label: 'Money', desc: 'monetizationModel', icon: DollarSign, accent: '#f59e0b', handler: actMoney },
    { id: 'mint' as ActionId, label: mintedDtuId ? 'Saved' : 'Mint', desc: mintedDtuId ? `${mintedDtuId.slice(0, 8)}…` : 'Private GDD', icon: Sparkles, accent: '#06b6d4', handler: actMint },
    { id: 'dm' as ActionId, label: 'DM', desc: 'Send brief', icon: Send, accent: '#ec4899', handler: actDm },
    { id: 'publish' as ActionId, label: publishedDtuId ? 'Published' : 'Publish', desc: publishedDtuId ? `${publishedDtuId.slice(0, 8)}…` : 'Public card', icon: Globe, accent: '#15803d', handler: actPublish },
    { id: 'agent' as ActionId, label: 'Senior GD', desc: 'Agent: change+risk', icon: Wand2, accent: '#eab308', handler: actAgent },
  ];

  const PACING_COLOR: Record<string, string> = { 'well-paced': 'text-emerald-300', 'needs-tension-relief-balance': 'text-amber-300' };
  const REPLAY_COLOR: Record<string, string> = { high: 'text-emerald-300', moderate: 'text-blue-300', low: 'text-amber-300' };

  return (
    <div className="rounded-lg border border-violet-500/20 bg-zinc-950/60 p-3 space-y-3">
      <header className="flex items-center gap-2 border-b border-violet-500/10 pb-2">
        <Gamepad2 className="h-4 w-4 text-violet-400" />
        <h3 className="text-sm font-semibold text-white">Game designer bench</h3>
        <span className="rounded bg-zinc-800 px-1.5 py-0.5 font-mono text-[10px] uppercase tracking-wider text-zinc-400">mechanics · flow · narrative · money</span>
      </header>

      <div className="grid grid-cols-1 md:grid-cols-2 gap-2">
        <div>
          <label className="text-[10px] uppercase tracking-wider text-blue-400 font-semibold">Mechanics JSON</label>
          <textarea value={mechText} onChange={(e) => setMechText(e.target.value)} rows={5} className="w-full bg-zinc-900 border border-zinc-800 rounded px-3 py-1 text-[10px] text-white font-mono mt-1" />
        </div>
        <div>
          <label className="text-[10px] uppercase tracking-wider text-green-400 font-semibold">Flow states JSON</label>
          <textarea value={flowText} onChange={(e) => setFlowText(e.target.value)} rows={5} className="w-full bg-zinc-900 border border-zinc-800 rounded px-3 py-1 text-[10px] text-white font-mono mt-1" />
        </div>
        <div>
          <label className="text-[10px] uppercase tracking-wider text-purple-400 font-semibold">Narrative nodes JSON</label>
          <textarea value={branchText} onChange={(e) => setBranchText(e.target.value)} rows={5} className="w-full bg-zinc-900 border border-zinc-800 rounded px-3 py-1 text-[10px] text-white font-mono mt-1" />
        </div>
        <div>
          <label className="text-[10px] uppercase tracking-wider text-amber-400 font-semibold">Monetization JSON</label>
          <textarea value={moneyText} onChange={(e) => setMoneyText(e.target.value)} rows={5} className="w-full bg-zinc-900 border border-zinc-800 rounded px-3 py-1 text-[10px] text-white font-mono mt-1" />
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
        {mechResult && (
          <div className="rounded-md border border-blue-500/30 bg-blue-500/5 p-2.5 max-h-44 overflow-y-auto">
            <div className="text-[10px] uppercase tracking-wider text-blue-300 font-semibold">Mechanics · {mechResult.emergentPotential}</div>
            <div className="text-2xl font-bold text-blue-200">{mechResult.depthScore}</div>
            <div className="text-[10px] text-zinc-500">{mechResult.totalMechanics} total · {mechResult.loopCount} loops</div>
            {mechResult.categories.filter(c => c.count > 0).map((c, i) => <div key={i} className="text-[10px] text-zinc-300 mt-0.5 flex items-center gap-2"><span className="font-mono w-16">{c.category}</span><div className="flex-1 h-1 bg-zinc-800 rounded-full overflow-hidden"><div className="h-full bg-blue-400" style={{ width: `${Math.min(100, c.count * 25)}%` }} /></div><span className="font-mono text-blue-200">{c.count}</span></div>)}
            <div className="text-[10px] text-zinc-400 mt-1">Pillars: {mechResult.pillars.join(', ')}</div>
          </div>
        )}
        {flowResult && (
          <div className="rounded-md border border-green-500/30 bg-green-500/5 p-2.5 max-h-44 overflow-y-auto">
            <div className="text-[10px] uppercase tracking-wider text-green-300 font-semibold">Flow · {flowResult.flowPercent}%</div>
            <div className={cn('text-xl font-bold', PACING_COLOR[flowResult.pacing])}>{flowResult.pacing}</div>
            <div className="text-[10px] text-zinc-500">{flowResult.inFlowZone}/{flowResult.totalStates} in zone · {flowResult.totalDuration}m total</div>
            {flowResult.states.map((s, i) => <div key={i} className={cn('text-[10px] mt-0.5 flex justify-between', s.flowZone ? 'text-emerald-300' : 'text-amber-300')}><span>{s.flowZone ? '✓' : '⚠'} {s.state}</span><span className="font-mono">C{s.challenge}/S{s.skill} · {s.duration}m</span></div>)}
          </div>
        )}
        {branchResult && (
          <div className="rounded-md border border-purple-500/30 bg-purple-500/5 p-2.5 max-h-44 overflow-y-auto">
            <div className="text-[10px] uppercase tracking-wider text-purple-300 font-semibold">Narrative · {branchResult.complexity}</div>
            <div className="text-2xl font-bold text-purple-200">{branchResult.endings}<span className="text-xs text-zinc-400"> endings</span></div>
            <div className="text-[10px] text-zinc-300">{branchResult.totalNodes} nodes · {branchResult.totalChoices} choices · depth {branchResult.maxBranchDepth}</div>
            <div className={cn('text-[10px] font-semibold mt-1', REPLAY_COLOR[branchResult.replayValue])}>Replay: {branchResult.replayValue}</div>
            <div className="text-[10px] text-zinc-500">{branchResult.avgChoicesPerNode} avg/node</div>
          </div>
        )}
        {moneyResult && (
          <div className="rounded-md border border-amber-500/30 bg-amber-500/5 p-2.5 max-h-44 overflow-y-auto">
            <div className="text-[10px] uppercase tracking-wider text-amber-300 font-semibold">Money · {moneyResult.model}</div>
            <div className="text-2xl font-bold text-amber-200">${(moneyResult.projectedMonthlyRevenue / 1000).toFixed(0)}<span className="text-xs text-zinc-400">k/mo</span></div>
            <div className="text-[10px] text-zinc-300">LTV ${moneyResult.avgLTV} · conv {moneyResult.conversionRate} · ret {moneyResult.retention}</div>
            <div className="text-[10px] text-zinc-500">${moneyResult.projectedAnnualRevenue.toLocaleString()}/yr · {moneyResult.expectedDAU.toLocaleString()} DAU</div>
            {moneyResult.ethicalConsiderations.slice(0, 2).map((e, i) => <div key={i} className="text-[10px] text-amber-200 mt-0.5">⚠ {e}</div>)}
          </div>
        )}
      </div>

      {agentReply && (<div className="rounded-md border border-yellow-500/30 bg-yellow-500/5 p-3 max-h-60 overflow-y-auto"><div className="flex items-center gap-1.5 text-yellow-400 font-semibold mb-1.5 uppercase tracking-wider text-[10px]"><Wand2 className="w-3 h-3" /> Designer review</div><pre className="whitespace-pre-wrap font-sans text-[11px] text-zinc-200 leading-relaxed">{agentReply}</pre></div>)}

      <AnimatePresence>
        {feedback && (<motion.div key={feedback.text} initial={{ opacity: 0, y: -2 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: -2 }} className={cn('px-3 py-2 rounded text-[11px] flex items-start gap-2 border', feedback.kind === 'ok' ? 'bg-emerald-500/10 text-emerald-300 border-emerald-500/30' : 'bg-red-500/10 text-red-300 border-red-500/30')}>{feedback.kind === 'ok' ? <Check className="h-3 w-3 mt-0.5" /> : <AlertTriangle className="h-3 w-3 mt-0.5" />}<span>{feedback.text}</span></motion.div>)}
      </AnimatePresence>
    </div>
  );
}
