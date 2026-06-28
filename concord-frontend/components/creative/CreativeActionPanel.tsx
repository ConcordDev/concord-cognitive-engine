'use client';

/**
 * CreativeActionPanel — film/video producer bench.
 * shotListGenerate / assetOrganize / budgetTrack / distributionChecklist +
 * mint/DM/publish/agent.
 */

import { useState } from 'react';
import { Film, FolderOpen, DollarSign, ListChecks, Sparkles, Send, Globe, Wand2, Loader2, Check, AlertTriangle } from 'lucide-react';
import { motion, AnimatePresence } from 'framer-motion';
import { api, apiHelpers, lensRun } from '@/lib/api/client';
import { cn } from '@/lib/utils';
import { usePipe, useRecallableAction, RecallSlot } from '@/components/panel-polish';

interface MacroEnvelope<T> { ok: boolean; result?: T; error?: string }
async function callMacro<T>(action: string, input: Record<string, unknown>): Promise<MacroEnvelope<T>> {
  const r = await apiHelpers.lens.runDomain('creative', action, { input });
  const data = (r as { data?: { ok: boolean; result?: T } }).data;
  if (!data) return { ok: false, error: 'empty response' };
  if (data.ok && data.result && typeof data.result === 'object' && 'ok' in data.result) return data.result as MacroEnvelope<T>;
  return data as MacroEnvelope<T>;
}

type Feedback = { kind: 'ok' | 'err'; text: string } | null;
type ActionId = 'shots' | 'assets' | 'budget' | 'dist' | 'mint' | 'dm' | 'publish' | 'agent';
function pickMessage(e: unknown): string { const ax = e as { response?: { data?: { error?: string } }; message?: string }; return ax?.response?.data?.error ?? ax?.message ?? 'request failed'; }

interface Shot { shotNumber?: number; description?: string; type?: string; duration?: number; equipment?: string }
interface ShotsResult { shots: Shot[]; totalShots: number; estimatedRuntime: number; equipmentList: string[] }
interface Asset { name?: string; type?: string; status?: string; size?: string }
interface AssetsResult { totalAssets: number; byType?: Record<string, number>; byStatus?: Record<string, number>; missing?: Asset[]; ready?: number }
interface BudgetLine { category?: string; budgeted: number; actual: number; variance: number; status: string }
interface BudgetResult { totalBudgeted: number; totalActual: number; totalVariance: number; overBudget?: boolean; lines: BudgetLine[] }
interface DistResult { platform?: string; checklist: { item: string; ready: boolean; notes?: string }[]; readyCount: number; total: number; percent: number; deliveryDate?: string }

// No seed data — every textarea starts empty. Paste real production data
// or use the JSON sample syntax described in the lens manifest.
export function CreativeActionPanel() {
  const [scenesText, setScenesText] = useState('');
  const [assetsText, setAssetsText] = useState('');
  const [budgetText, setBudgetText] = useState('');
  const [distText, setDistText] = useState('');
  const [recipient, setRecipient] = useState('');

  const [busy, setBusy] = useState<ActionId | null>(null);
  const [feedback, setFeedback] = useState<Feedback>(null);
  const [shotsResult, setShotsResult] = useState<ShotsResult | null>(null);
  const [assetsResult, setAssetsResult] = useState<AssetsResult | null>(null);
  const [budgetResult, setBudgetResult] = useState<BudgetResult | null>(null);
  const [distResult, setDistResult] = useState<DistResult | null>(null);
  const [mintedDtuId, setMintedDtuId] = useState<string | null>(null);
  const [publishedDtuId, setPublishedDtuId] = useState<string | null>(null);
  const [agentReply, setAgentReply] = useState<string | null>(null);

  const ok = (m: string) => setFeedback({ kind: 'ok', text: m });
  const err = (m: string) => setFeedback({ kind: 'err', text: m });

  const pipe = usePipe();
  const dmRecall = useRecallableAction({ label: 'DM', windowMs: 60_000, onUndo: async (id) => { await api.delete(`/api/social/dm/${encodeURIComponent(id)}`); } });
  const publishRecall = useRecallableAction({ label: 'publish', windowMs: 30_000, onUndo: async (id) => { await api.delete(`/api/dtus/${encodeURIComponent(id)}/publish`); setPublishedDtuId(null); } });

  async function actShots() {
    if (!scenesText.trim()) { err('Paste scenes JSON first.'); return; }
    try { const parsed = JSON.parse(scenesText); setBusy('shots'); setFeedback(null);
      const r = await callMacro<ShotsResult>('shotListGenerate', { artifact: { data: parsed } });
      if (r.ok && r.result) { setShotsResult(r.result); pipe.publish('creative.shots', r.result, { label: `${r.result.totalShots} shots` }); ok(`${r.result.totalShots} shots · ${r.result.estimatedRuntime}min.`); } else err(r.error ?? 'shots failed');
    } catch (e) { err(e instanceof SyntaxError ? 'Invalid scenes JSON.' : pickMessage(e)); } finally { setBusy(null); }
  }
  async function actAssets() {
    if (!assetsText.trim()) { err('Paste assets JSON first.'); return; }
    try { const parsed = JSON.parse(assetsText); setBusy('assets'); setFeedback(null);
      const r = await callMacro<AssetsResult>('assetOrganize', { artifact: { data: parsed } });
      if (r.ok && r.result) { setAssetsResult(r.result); pipe.publish('creative.assets', r.result, { label: `Assets ${r.result.ready ?? '-'}/${r.result.totalAssets}` }); ok(`${r.result.ready ?? '-'}/${r.result.totalAssets} ready.`); } else err(r.error ?? 'assets failed');
    } catch (e) { err(e instanceof SyntaxError ? 'Invalid assets JSON.' : pickMessage(e)); } finally { setBusy(null); }
  }
  async function actBudget() {
    if (!budgetText.trim()) { err('Paste budget JSON first.'); return; }
    try { const parsed = JSON.parse(budgetText); setBusy('budget'); setFeedback(null);
      const r = await callMacro<BudgetResult>('budgetTrack', { artifact: { data: parsed } });
      if (r.ok && r.result) { setBudgetResult(r.result); pipe.publish('creative.budget', r.result, { label: `Budget ${r.result.overBudget ? 'OVER' : 'OK'}` }); ok(`${r.result.overBudget ? '⚠' : '✓'} variance ${r.result.totalVariance >= 0 ? '+' : ''}${r.result.totalVariance.toLocaleString()}.`); } else err(r.error ?? 'budget failed');
    } catch (e) { err(e instanceof SyntaxError ? 'Invalid budget JSON.' : pickMessage(e)); } finally { setBusy(null); }
  }
  async function actDist() {
    if (!distText.trim()) { err('Paste delivery JSON first.'); return; }
    try { const parsed = JSON.parse(distText); setBusy('dist'); setFeedback(null);
      const r = await callMacro<DistResult>('distributionChecklist', { artifact: { data: parsed } });
      if (r.ok && r.result) { setDistResult(r.result); pipe.publish('creative.dist', r.result, { label: `${r.result.platform}: ${r.result.percent}%` }); ok(`${r.result.readyCount}/${r.result.total} ready (${r.result.percent}%).`); } else err(r.error ?? 'dist failed');
    } catch (e) { err(e instanceof SyntaxError ? 'Invalid dist JSON.' : pickMessage(e)); } finally { setBusy(null); }
  }
  async function actMint() {
    setBusy('mint'); setFeedback(null);
    try {
      const r = await lensRun({ domain: 'dtu', name: 'create', input: { title: `Production pkg`, tags: ['creative', 'production'], source: 'creative:pkg:mint', meta: { visibility: 'private', consent: { allowCitations: false }, prod: { shots: shotsResult, assets: assetsResult, budget: budgetResult, dist: distResult } } } });
      const id = r.data?.result?.dtu?.id ?? r.data?.result?.id;
      if (id) { setMintedDtuId(id); pipe.publish('creative.mintedDtuId', id, { label: `Pkg DTU ${id.slice(0, 8)}…` }); ok(`Pkg DTU ${id.slice(0, 8)}…`); } else err('No DTU id.');
    } catch (e) { err(pickMessage(e)); } finally { setBusy(null); }
  }
  async function actDm() {
    if (!recipient.trim()) { err('Recipient required.'); return; }
    setBusy('dm'); setFeedback(null);
    const body = [`🎬 Production status`, '',
      shotsResult ? `Shots: ${shotsResult.totalShots} · ~${shotsResult.estimatedRuntime}min runtime` : '',
      assetsResult ? `Assets: ${assetsResult.ready ?? '-'}/${assetsResult.totalAssets} ready · ${assetsResult.missing?.length ?? 0} missing` : '',
      budgetResult ? `Budget: $${budgetResult.totalActual.toLocaleString()} / $${budgetResult.totalBudgeted.toLocaleString()} · ${budgetResult.overBudget ? 'OVER' : 'within'}` : '',
      distResult ? `${distResult.platform}: ${distResult.percent}% ready (${distResult.readyCount}/${distResult.total}) · deliver ${distResult.deliveryDate}` : '',
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
    if (!shotsResult && !distResult) { err('Run shots or dist first.'); return; }
    setBusy('publish'); setFeedback(null);
    try {
      const id = await publishRecall.run(async () => {
        const r = await lensRun({ domain: 'dtu', name: 'create', input: { title: `Production handoff`, tags: ['creative', 'handoff', 'public'], source: 'creative:handoff:publish', meta: { visibility: 'public', consent: { allowCitations: true }, anon: true, shots: shotsResult, dist: distResult } } });
        const newId = r.data?.result?.dtu?.id ?? r.data?.result?.id;
        if (!newId) throw new Error('No DTU id.');
        const pub = await api.post(`/api/dtus/${encodeURIComponent(newId)}/publish`);
        if (pub.data?.ok === false) throw new Error(pub.data?.error ?? 'publish failed');
        return newId as string;
      });
      if (id) { setPublishedDtuId(id); pipe.publish('creative.publishedDtuId', id, { label: `Public handoff ${id.slice(0, 8)}…` }); ok(`Published ${id.slice(0, 8)}… · 30s to recall.`); }
    } catch (e) { err(pickMessage(e)); } finally { setBusy(null); }
  }
  async function actAgent() {
    setBusy('agent'); setFeedback(null); setAgentReply(null);
    try {
      const task = `Production status review. ${shotsResult ? `Shot list: ${shotsResult.totalShots} shots / ~${shotsResult.estimatedRuntime}min.` : ''} ${budgetResult ? `Budget: $${budgetResult.totalActual.toLocaleString()} of $${budgetResult.totalBudgeted.toLocaleString()}${budgetResult.overBudget ? ' (over)' : ''}.` : ''} ${distResult ? `${distResult.platform} delivery: ${distResult.percent}% ready by ${distResult.deliveryDate}.` : ''} Identify the single biggest schedule or budget risk + one mitigation. Plain text, 3 sentences max.`;
      const r = await lensRun({ domain: 'chat_agent', name: 'do', input: { task, maxTurns: 3 } });
      const reply = r.data?.result?.reply ?? r.data?.result?.summary ?? r.data?.result?.output;
      if (reply) { setAgentReply(typeof reply === 'string' ? reply : JSON.stringify(reply, null, 2)); ok('Review ready.'); } else err('Agent returned empty.');
    } catch (e) { err(pickMessage(e)); } finally { setBusy(null); }
  }

  const actions = [
    { id: 'shots' as ActionId, label: 'Shots', desc: 'shotListGenerate', icon: Film, accent: '#8b5cf6', handler: actShots },
    { id: 'assets' as ActionId, label: 'Assets', desc: 'assetOrganize', icon: FolderOpen, accent: '#f59e0b', handler: actAssets },
    { id: 'budget' as ActionId, label: 'Budget', desc: 'budgetTrack', icon: DollarSign, accent: '#22c55e', handler: actBudget },
    { id: 'dist' as ActionId, label: 'Delivery', desc: 'distributionChecklist', icon: ListChecks, accent: '#3b82f6', handler: actDist },
    { id: 'mint' as ActionId, label: mintedDtuId ? 'Saved' : 'Mint', desc: mintedDtuId ? `${mintedDtuId.slice(0, 8)}…` : 'Private pkg DTU', icon: Sparkles, accent: '#06b6d4', handler: actMint },
    { id: 'dm' as ActionId, label: 'DM', desc: 'Send status', icon: Send, accent: '#ec4899', handler: actDm },
    { id: 'publish' as ActionId, label: publishedDtuId ? 'Published' : 'Publish', desc: publishedDtuId ? `${publishedDtuId.slice(0, 8)}…` : 'Public handoff', icon: Globe, accent: '#15803d', handler: actPublish },
    { id: 'agent' as ActionId, label: 'Risk', desc: 'Agent: risk + fix', icon: Wand2, accent: '#eab308', handler: actAgent },
  ];

  return (
    <div className="rounded-lg border border-purple-500/20 bg-zinc-950/60 p-3 space-y-3">
      <header className="flex items-center gap-2 border-b border-purple-500/10 pb-2">
        <Film className="h-4 w-4 text-purple-400" />
        <h3 className="text-sm font-semibold text-white">Creative production</h3>
        <span className="rounded bg-zinc-800 px-1.5 py-0.5 font-mono text-[10px] uppercase tracking-wider text-zinc-400">shots · assets · budget · delivery</span>
      </header>

      <div className="grid grid-cols-1 md:grid-cols-2 gap-2">
        <div>
          <label className="text-[10px] uppercase tracking-wider text-purple-400 font-semibold">Scenes JSON</label>
          <textarea value={scenesText} onChange={(e) => setScenesText(e.target.value)} rows={5} className="w-full bg-zinc-900 border border-zinc-800 rounded px-3 py-1 text-[10px] text-white font-mono mt-1" />
        </div>
        <div>
          <label className="text-[10px] uppercase tracking-wider text-amber-400 font-semibold">Assets JSON</label>
          <textarea value={assetsText} onChange={(e) => setAssetsText(e.target.value)} rows={5} className="w-full bg-zinc-900 border border-zinc-800 rounded px-3 py-1 text-[10px] text-white font-mono mt-1" />
        </div>
        <div>
          <label className="text-[10px] uppercase tracking-wider text-green-400 font-semibold">Budget JSON</label>
          <textarea value={budgetText} onChange={(e) => setBudgetText(e.target.value)} rows={5} className="w-full bg-zinc-900 border border-zinc-800 rounded px-3 py-1 text-[10px] text-white font-mono mt-1" />
        </div>
        <div>
          <label className="text-[10px] uppercase tracking-wider text-blue-400 font-semibold">Delivery JSON</label>
          <textarea value={distText} onChange={(e) => setDistText(e.target.value)} rows={5} className="w-full bg-zinc-900 border border-zinc-800 rounded px-3 py-1 text-[10px] text-white font-mono mt-1" />
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
              <div className="text-[10px] text-zinc-400 leading-tight line-clamp-2">{act.desc}</div>
            </button>
          );
        })}
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-2">
        {shotsResult && (
          <div className="rounded-md border border-purple-500/30 bg-purple-500/5 p-2.5 max-h-44 overflow-y-auto">
            <div className="text-[10px] uppercase tracking-wider text-purple-300 font-semibold">Shots · ~{shotsResult.estimatedRuntime}min</div>
            <div className="text-2xl font-bold text-purple-300">{shotsResult.totalShots}</div>
            <div className="text-[10px] text-zinc-400">equipment: {shotsResult.equipmentList.slice(0, 3).join(', ')}</div>
            {shotsResult.shots.slice(0, 5).map((s, i) => <div key={i} className="text-[10px] text-zinc-300 mt-0.5"><span className="font-mono text-purple-200">#{s.shotNumber}</span> {s.type} · {s.duration}s</div>)}
          </div>
        )}
        {assetsResult && (
          <div className="rounded-md border border-amber-500/30 bg-amber-500/5 p-2.5 max-h-44 overflow-y-auto">
            <div className="text-[10px] uppercase tracking-wider text-amber-300 font-semibold">Assets</div>
            <div className="text-2xl font-bold text-amber-300">{assetsResult.ready ?? '-'}<span className="text-xs text-zinc-400">/{assetsResult.totalAssets} ready</span></div>
            {assetsResult.byType && Object.entries(assetsResult.byType).map(([k, v]) => <div key={k} className="text-[10px] text-zinc-300">{k}: {v}</div>)}
            {(assetsResult.missing ?? []).slice(0, 3).map((a, i) => <div key={i} className="text-[10px] text-red-300">⚠ {a.name}</div>)}
          </div>
        )}
        {budgetResult && (
          <div className={cn('rounded-md border p-2.5 max-h-44 overflow-y-auto', budgetResult.overBudget ? 'border-red-500/30 bg-red-500/5' : 'border-emerald-500/30 bg-emerald-500/5')}>
            <div className="text-[10px] uppercase tracking-wider text-green-300 font-semibold">Budget</div>
            <div className={cn('text-2xl font-bold', budgetResult.overBudget ? 'text-red-300' : 'text-emerald-300')}>${budgetResult.totalActual.toLocaleString()}</div>
            <div className="text-[10px] text-zinc-400">of ${budgetResult.totalBudgeted.toLocaleString()} · var {budgetResult.totalVariance >= 0 ? '+' : ''}${budgetResult.totalVariance.toLocaleString()}</div>
            {budgetResult.lines.slice(0, 4).map((l, i) => <div key={i} className={cn('text-[10px] mt-0.5', l.status === 'over' ? 'text-red-300' : 'text-zinc-300')}><span className="font-mono">{l.category}</span> ${l.actual.toLocaleString()}/${l.budgeted.toLocaleString()}</div>)}
          </div>
        )}
        {distResult && (
          <div className={cn('rounded-md border p-2.5 max-h-44 overflow-y-auto', distResult.percent >= 90 ? 'border-emerald-500/30 bg-emerald-500/5' : distResult.percent >= 60 ? 'border-amber-500/30 bg-amber-500/5' : 'border-red-500/30 bg-red-500/5')}>
            <div className="text-[10px] uppercase tracking-wider text-blue-300 font-semibold">{distResult.platform}</div>
            <div className={cn('text-2xl font-bold', distResult.percent >= 90 ? 'text-emerald-300' : distResult.percent >= 60 ? 'text-amber-300' : 'text-red-300')}>{distResult.percent}%</div>
            <div className="text-[10px] text-zinc-400">{distResult.readyCount}/{distResult.total} · deliver {distResult.deliveryDate}</div>
            {distResult.checklist.filter(c => !c.ready).slice(0, 3).map((c, i) => <div key={i} className="text-[10px] text-red-300">✗ {c.item}</div>)}
          </div>
        )}
      </div>

      {agentReply && (<div className="rounded-md border border-yellow-500/30 bg-yellow-500/5 p-3 max-h-60 overflow-y-auto"><div className="flex items-center gap-1.5 text-yellow-400 font-semibold mb-1.5 uppercase tracking-wider text-[10px]"><Wand2 className="w-3 h-3" /> Risk + mitigation</div><pre className="whitespace-pre-wrap font-sans text-[11px] text-zinc-200 leading-relaxed">{agentReply}</pre></div>)}

      <AnimatePresence>
        {feedback && (<motion.div key={feedback.text} initial={{ opacity: 0, y: -2 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: -2 }} className={cn('px-3 py-2 rounded text-[11px] flex items-start gap-2 border', feedback.kind === 'ok' ? 'bg-emerald-500/10 text-emerald-300 border-emerald-500/30' : 'bg-red-500/10 text-red-300 border-red-500/30')}>{feedback.kind === 'ok' ? <Check className="h-3 w-3 mt-0.5" /> : <AlertTriangle className="h-3 w-3 mt-0.5" />}<span>{feedback.text}</span></motion.div>)}
      </AnimatePresence>
    </div>
  );
}
