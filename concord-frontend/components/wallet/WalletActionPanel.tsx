'use client';

/**
 * WalletActionPanel — a wallet workbench.
 * Surfaces portfolioBalance / transactionCategorize / budgetCheck /
 * spendingTrend + mint/DM/publish/agent.
 */

import { useState } from 'react';
import {
  Wallet, PieChart, Tags, AlertCircle, TrendingUp,
  Sparkles, Send, Globe, Wand2,
  Loader2, Check, AlertTriangle,
} from 'lucide-react';
import { motion, AnimatePresence } from 'framer-motion';
import { api, apiHelpers } from '@/lib/api/client';
import { cn } from '@/lib/utils';
import { usePipe, useRecallableAction, RecallSlot } from '@/components/panel-polish';

interface MacroEnvelope<T> { ok: boolean; result?: T; error?: string }
async function callMacro<T>(action: string, input: Record<string, unknown>): Promise<MacroEnvelope<T>> {
  const r = await apiHelpers.lens.runDomain('wallet', action, { input });
  const data = (r as { data?: { ok: boolean; result?: T } }).data;
  if (!data) return { ok: false, error: 'empty response' };
  if (data.ok && data.result && typeof data.result === 'object' && 'ok' in data.result) {
    return data.result as MacroEnvelope<T>;
  }
  return data as MacroEnvelope<T>;
}

type Feedback = { kind: 'ok' | 'err'; text: string } | null;
type ActionId = 'balance' | 'categorize' | 'budget' | 'trend' | 'mint' | 'dm' | 'publish' | 'agent';

function pickMessage(e: unknown): string {
  const ax = e as { response?: { data?: { error?: string } }; message?: string };
  return ax?.response?.data?.error ?? ax?.message ?? 'request failed';
}

interface BalanceResult { totalUsd?: number; holdings?: Array<{ symbol: string; amount: number; usdValue: number; pct?: number }> }
interface CategorizeResult { categorized?: Array<{ description: string; amount: number; category: string }>; byCategory?: Record<string, number> }
interface BudgetResult { onTrack?: boolean; overBudget?: string[]; underBudget?: string[]; summary?: string }
interface TrendResult { direction?: string; changePct?: number; topGrowing?: string[]; topShrinking?: string[] }

export function WalletActionPanel() {
  const [holdings, setHoldings] = useState('');
  const [transactions, setTransactions] = useState('');
  const [budgetMap, setBudgetMap] = useState('');
  const [recipient, setRecipient] = useState('');

  const [busy, setBusy] = useState<ActionId | null>(null);
  const [feedback, setFeedback] = useState<Feedback>(null);
  const [balanceResult, setBalanceResult] = useState<BalanceResult | null>(null);
  const [categorizeResult, setCategorizeResult] = useState<CategorizeResult | null>(null);
  const [budgetResult, setBudgetResult] = useState<BudgetResult | null>(null);
  const [trendResult, setTrendResult] = useState<TrendResult | null>(null);
  const [mintedDtuId, setMintedDtuId] = useState<string | null>(null);
  const [publishedDtuId, setPublishedDtuId] = useState<string | null>(null);
  const [agentReply, setAgentReply] = useState<string | null>(null);

  const ok = (t: string) => setFeedback({ kind: 'ok', text: t });
  const err = (t: string) => setFeedback({ kind: 'err', text: t });

  const pipe = usePipe();
  const dmRecall = useRecallableAction({
    label: 'DM',
    windowMs: 60_000,
    onUndo: async (id) => { await api.delete(`/api/social/dm/${encodeURIComponent(id)}`); },
  });
  const publishRecall = useRecallableAction({
    label: 'publish',
    windowMs: 30_000,
    onUndo: async (id) => {
      await api.delete(`/api/dtus/${encodeURIComponent(id)}/publish`);
      setPublishedDtuId(null);
    },
  });

  function parseHoldings() {
    return holdings.split('\n').map(l => { const m = l.trim().match(/^(\S+)\s+([\d.]+)\s+([\d.]+)$/); return m ? { symbol: m[1], amount: parseFloat(m[2]), priceUsd: parseFloat(m[3]) } : null; }).filter(Boolean);
  }
  function parseTransactions() {
    return transactions.split('\n').map(l => { const m = l.trim().match(/^(.+?)\s+([\d.]+)$/); return m ? { description: m[1], amount: parseFloat(m[2]) } : null; }).filter(Boolean);
  }
  function parseBudget() {
    const map: Record<string, number> = {};
    budgetMap.split('\n').forEach(l => { const m = l.trim().match(/^(\S+)\s+([\d.]+)$/); if (m) map[m[1]] = parseFloat(m[2]); });
    return map;
  }

  async function actBalance() {
    const h = parseHoldings(); if (!h.length) { err('Add holdings.'); return; }
    setBusy('balance'); setFeedback(null);
    try { const r = await callMacro<BalanceResult>('portfolioBalance', { holdings: h }); if (r.ok && r.result) { setBalanceResult(r.result); pipe.publish('wallet.balance', r.result, { label: `$${r.result.totalUsd?.toLocaleString()}` }); ok(`Total: $${r.result.totalUsd?.toLocaleString()}.`); } else err(r.error ?? 'balance failed'); }
    catch (e) { err(pickMessage(e)); } finally { setBusy(null); }
  }
  async function actCategorize() {
    const t = parseTransactions(); if (!t.length) { err('Add transactions.'); return; }
    setBusy('categorize'); setFeedback(null);
    try { const r = await callMacro<CategorizeResult>('transactionCategorize', { transactions: t }); if (r.ok && r.result) { setCategorizeResult(r.result); pipe.publish('wallet.categorize', r.result, { label: `${r.result.categorized?.length ?? 0} categorized` }); ok(`${r.result.categorized?.length ?? 0} categorized.`); } else err(r.error ?? 'categorize failed'); }
    catch (e) { err(pickMessage(e)); } finally { setBusy(null); }
  }
  async function actBudget() {
    setBusy('budget'); setFeedback(null);
    try { const r = await callMacro<BudgetResult>('budgetCheck', { budget: parseBudget(), categorized: categorizeResult?.byCategory ?? {} }); if (r.ok && r.result) { setBudgetResult(r.result); pipe.publish('wallet.budget', r.result, { label: r.result.onTrack ? 'on track' : 'over' }); ok(r.result.onTrack ? 'On track.' : 'Over budget.'); } else err(r.error ?? 'budget failed'); }
    catch (e) { err(pickMessage(e)); } finally { setBusy(null); }
  }
  async function actTrend() {
    setBusy('trend'); setFeedback(null);
    try { const r = await callMacro<TrendResult>('spendingTrend', { window: 'month' }); if (r.ok && r.result) { setTrendResult(r.result); pipe.publish('wallet.trend', r.result, { label: r.result.direction ?? 'trend' }); ok(`Trend: ${r.result.direction}.`); } else err(r.error ?? 'trend failed'); }
    catch (e) { err(pickMessage(e)); } finally { setBusy(null); }
  }
  async function actMint() {
    setBusy('mint'); setFeedback(null);
    try {
      const r = await api.post('/api/lens/run', { domain: 'dtu', name: 'create', input: { title: `Wallet snapshot — ${new Date().toISOString().slice(0, 10)}`, tags: ['wallet', 'snapshot', budgetResult?.onTrack ? 'on-track' : 'over-budget'], source: 'wallet:snapshot:mint', meta: { visibility: 'private', consent: { allowCitations: false }, wallet: { balance: balanceResult, categorize: categorizeResult, budget: budgetResult, trend: trendResult } } } });
      const id = r.data?.result?.dtu?.id ?? r.data?.dtu?.id ?? r.data?.result?.id;
      if (id) { setMintedDtuId(id); pipe.publish('wallet.mintedDtuId', id, { label: `snapshot ${id.slice(0, 8)}` }); ok(`Wallet DTU ${id.slice(0, 8)}…`); } else err('No DTU id.');
    } catch (e) { err(pickMessage(e)); } finally { setBusy(null); }
  }
  async function actDm() {
    if (!recipient.trim()) { err('Recipient required.'); return; }
    setBusy('dm'); setFeedback(null);
    const body = [`💼 Wallet snapshot — ${new Date().toLocaleDateString()}`, '', balanceResult ? `Portfolio: $${balanceResult.totalUsd?.toLocaleString()}` : '', budgetResult ? `Budget: ${budgetResult.onTrack ? '✓ on track' : '⚠ over'}` : '', trendResult ? `Trend: ${trendResult.direction} (${trendResult.changePct}%)` : '', mintedDtuId ? `\n[DTU ${mintedDtuId}]` : ''].filter(Boolean).join('\n');
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
    if (!trendResult) { err('Run a trend first (anonymized).'); return; }
    setBusy('publish'); setFeedback(null);
    try {
      const id = await publishRecall.run(async () => {
        const r = await api.post('/api/lens/run', { domain: 'dtu', name: 'create', input: { title: `Spending insight — ${trendResult.direction}`, tags: ['wallet', 'insight', 'public'], source: 'wallet:insight:publish', meta: { visibility: 'public', consent: { allowCitations: true }, anonymized: true, insight: { trend: trendResult.direction, changePct: trendResult.changePct, growing: trendResult.topGrowing } } } });
        const newId = r.data?.result?.dtu?.id ?? r.data?.dtu?.id ?? r.data?.result?.id;
        if (!newId) throw new Error('No DTU id.');
        const pub = await api.post(`/api/dtus/${encodeURIComponent(newId)}/publish`);
        if (pub.data?.ok === false) throw new Error(pub.data?.error ?? 'publish failed');
        return newId as string;
      });
      if (id) { setPublishedDtuId(id); pipe.publish('wallet.publishedDtuId', id, { label: `insight ${id.slice(0, 8)}` }); ok(`Insight published ${id.slice(0, 8)}… · 30s to recall.`); }
    } catch (e) { err(pickMessage(e)); } finally { setBusy(null); }
  }
  async function actAgent() {
    setBusy('agent'); setFeedback(null); setAgentReply(null);
    try {
      const task = `Wallet: ${balanceResult ? `$${balanceResult.totalUsd?.toLocaleString()} portfolio.` : ''} ${budgetResult ? `Budget ${budgetResult.onTrack ? 'on track' : 'over'}.` : ''} ${trendResult ? `Spending ${trendResult.direction} (${trendResult.changePct}%).` : ''} Identify the single rebalance move (asset or spend) that highest-leverage improves financial health. Plain text.`;
      const r = await api.post('/api/lens/run', { domain: 'chat_agent', name: 'do', input: { task, maxTurns: 3 } });
      const reply = r.data?.result?.reply ?? r.data?.result?.summary ?? r.data?.result?.output ?? r.data?.reply;
      if (reply) { setAgentReply(typeof reply === 'string' ? reply : JSON.stringify(reply, null, 2)); ok('Rebalance ready.'); } else err('Agent returned empty.');
    } catch (e) { err(pickMessage(e)); } finally { setBusy(null); }
  }

  const actions = [
    { id: 'balance' as ActionId, label: 'Balance', desc: 'portfolioBalance + allocation', icon: PieChart, accent: '#22c55e', handler: actBalance },
    { id: 'categorize' as ActionId, label: 'Categorize', desc: 'transactionCategorize spend', icon: Tags, accent: '#06b6d4', handler: actCategorize },
    { id: 'budget' as ActionId, label: 'Budget', desc: 'budgetCheck on track?', icon: AlertCircle, accent: '#f97316', handler: actBudget },
    { id: 'trend' as ActionId, label: 'Trend', desc: 'spendingTrend direction', icon: TrendingUp, accent: '#8b5cf6', handler: actTrend },
    { id: 'mint' as ActionId, label: mintedDtuId ? 'Saved' : 'Mint', desc: mintedDtuId ? `${mintedDtuId.slice(0, 8)}…` : 'Private wallet DTU', icon: Sparkles, accent: '#3b82f6', handler: actMint },
    { id: 'dm' as ActionId, label: 'DM', desc: 'Send snapshot to advisor', icon: Send, accent: '#ec4899', handler: actDm },
    { id: 'publish' as ActionId, label: publishedDtuId ? 'Published' : 'Publish', desc: publishedDtuId ? `${publishedDtuId.slice(0, 8)}…` : 'Anonymized spending insight DTU', icon: Globe, accent: '#15803d', handler: actPublish },
    { id: 'agent' as ActionId, label: 'Rebalance', desc: 'Agent: single rebalance move', icon: Wand2, accent: '#eab308', handler: actAgent },
  ];

  return (
    <div className="rounded-lg border border-emerald-500/20 bg-zinc-950/60 p-3 space-y-3">
      <header className="flex items-center gap-2 border-b border-emerald-500/10 pb-2">
        <Wallet className="h-4 w-4 text-emerald-400" />
        <h3 className="text-sm font-semibold text-white">Wallet workbench</h3>
      </header>

      <div className="grid grid-cols-1 md:grid-cols-3 gap-2">
        <div><label className="text-[10px] uppercase tracking-wider text-zinc-400 font-semibold mb-1 block">Holdings (SYM amt price)</label><textarea value={holdings} onChange={(e) => setHoldings(e.target.value)} rows={5} className="w-full bg-zinc-900 border border-zinc-800 rounded px-2 py-1 text-[11px] text-emerald-200 font-mono focus:outline-none focus:ring-2 focus:ring-emerald-400/40 resize-none" /></div>
        <div><label className="text-[10px] uppercase tracking-wider text-zinc-400 font-semibold mb-1 block">Transactions (desc amount)</label><textarea value={transactions} onChange={(e) => setTransactions(e.target.value)} rows={5} className="w-full bg-zinc-900 border border-zinc-800 rounded px-2 py-1 text-[11px] text-emerald-200 font-mono focus:outline-none focus:ring-2 focus:ring-emerald-400/40 resize-none" /></div>
        <div><label className="text-[10px] uppercase tracking-wider text-zinc-400 font-semibold mb-1 block">Budget (category $)</label><textarea value={budgetMap} onChange={(e) => setBudgetMap(e.target.value)} rows={5} className="w-full bg-zinc-900 border border-zinc-800 rounded px-2 py-1 text-[11px] text-emerald-200 font-mono focus:outline-none focus:ring-2 focus:ring-emerald-400/40 resize-none" /></div>
      </div>

      <input type="text" value={recipient} onChange={(e) => setRecipient(e.target.value)} className="w-full bg-zinc-900 border border-zinc-800 rounded px-3 py-1.5 text-[12px] text-white" placeholder="DM recipient (advisor / partner)" />

      <div className="flex items-center gap-2 flex-wrap">
        <RecallSlot ctl={dmRecall} />
        <RecallSlot ctl={publishRecall} />
      </div>

      <div className="grid grid-cols-2 md:grid-cols-4 lg:grid-cols-8 gap-2">
        {actions.map(a => {
          const Icon = a.icon; const isBusy = busy === a.id;
          return (
            <button key={a.id} type="button" disabled={!!busy} onClick={a.handler}
              className={cn('flex flex-col items-start gap-1.5 p-2.5 rounded-lg text-left border transition-all', 'bg-zinc-900/40 border-zinc-800 hover:bg-zinc-800/60 hover:border-zinc-700', 'disabled:opacity-40 disabled:cursor-not-allowed')}>
              <div className="w-7 h-7 rounded-md flex items-center justify-center" style={{ backgroundColor: a.accent + '20', color: a.accent }}>
                {isBusy ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Icon className="w-3.5 h-3.5" />}
              </div>
              <div className="text-[11px] font-semibold text-zinc-100 leading-tight">{a.label}</div>
              <div className="text-[10px] text-zinc-400 leading-tight line-clamp-2">{a.desc}</div>
            </button>
          );
        })}
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 gap-2">
        {balanceResult && (
          <div className="rounded-md border border-emerald-500/30 bg-emerald-500/5 p-2.5">
            <div className="text-[10px] uppercase tracking-wider text-emerald-300 font-semibold">Portfolio</div>
            <div className="text-2xl font-bold text-emerald-300">${balanceResult.totalUsd?.toLocaleString()}</div>
            {balanceResult.holdings && <div className="flex flex-wrap gap-1 mt-1">{balanceResult.holdings.slice(0, 8).map((h, i) => <span key={i} className="rounded bg-emerald-500/20 text-emerald-200 px-1.5 py-0.5 text-[10px] font-mono">{h.symbol} {h.pct ?? Math.round((h.usdValue / (balanceResult.totalUsd ?? 1)) * 100)}%</span>)}</div>}
          </div>
        )}
        {categorizeResult?.byCategory && (
          <div className="rounded-md border border-cyan-500/30 bg-cyan-500/5 p-2.5">
            <div className="text-[10px] uppercase tracking-wider text-cyan-300 font-semibold">Spend by category</div>
            {Object.entries(categorizeResult.byCategory).slice(0, 8).map(([cat, amt]) => <div key={cat} className="text-[11px] text-zinc-300 flex justify-between"><span className="capitalize">{cat}</span><span className="font-mono text-cyan-300">${amt}</span></div>)}
          </div>
        )}
        {budgetResult && (
          <div className={cn('rounded-md border p-2.5', budgetResult.onTrack ? 'border-emerald-500/40 bg-emerald-500/5' : 'border-amber-500/40 bg-amber-500/5')}>
            <div className={cn('text-[10px] uppercase tracking-wider font-semibold', budgetResult.onTrack ? 'text-emerald-300' : 'text-amber-300')}>Budget: {budgetResult.onTrack ? 'on track' : 'over'}</div>
            {budgetResult.summary && <p className="text-[11px] text-zinc-300 mt-1">{budgetResult.summary}</p>}
            {budgetResult.overBudget?.length ? <div className="text-[10px] text-rose-300 mt-1">Over: {budgetResult.overBudget.join(', ')}</div> : null}
            {budgetResult.underBudget?.length ? <div className="text-[10px] text-emerald-300">Under: {budgetResult.underBudget.join(', ')}</div> : null}
          </div>
        )}
        {trendResult && (
          <div className={cn('rounded-md border p-2.5', trendResult.direction === 'rising' ? 'border-rose-500/40 bg-rose-500/5' : trendResult.direction === 'falling' ? 'border-emerald-500/40 bg-emerald-500/5' : 'border-purple-500/30 bg-purple-500/5')}>
            <div className="text-[10px] uppercase tracking-wider text-purple-300 font-semibold">Trend</div>
            <div className={cn('text-lg font-bold capitalize', trendResult.direction === 'rising' ? 'text-rose-300' : trendResult.direction === 'falling' ? 'text-emerald-300' : 'text-zinc-100')}>{trendResult.direction} {trendResult.changePct ? `(${trendResult.changePct >= 0 ? '+' : ''}${trendResult.changePct}%)` : ''}</div>
            {trendResult.topGrowing && <div className="text-[10px] text-zinc-400">Growing: {trendResult.topGrowing.join(', ')}</div>}
          </div>
        )}
      </div>

      {agentReply && (
        <div className="rounded-md border border-yellow-500/30 bg-yellow-500/5 p-3 max-h-60 overflow-y-auto">
          <div className="flex items-center gap-1.5 text-yellow-400 font-semibold mb-1.5 uppercase tracking-wider text-[10px]"><Wand2 className="w-3 h-3" /> Rebalance</div>
          <pre className="whitespace-pre-wrap font-sans text-[11px] text-zinc-200 leading-relaxed">{agentReply}</pre>
        </div>
      )}

      <AnimatePresence>
        {feedback && (
          <motion.div key={feedback.text} initial={{ opacity: 0, y: -2 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: -2 }}
            className={cn('px-3 py-2 rounded text-[11px] flex items-start gap-2 border', feedback.kind === 'ok' ? 'bg-emerald-500/10 text-emerald-300 border-emerald-500/30' : 'bg-red-500/10 text-red-300 border-red-500/30')}>
            {feedback.kind === 'ok' ? <Check className="h-3 w-3 mt-0.5" /> : <AlertTriangle className="h-3 w-3 mt-0.5" />}
            <span>{feedback.text}</span>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}
