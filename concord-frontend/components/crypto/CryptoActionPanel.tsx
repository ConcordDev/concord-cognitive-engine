'use client';

/**
 * CryptoActionPanel — CoinGecko + Uniswap + Etherscan-shape crypto
 * workbench. Surfaces portfolioAnalysis / search-tokens / swap-quote /
 * estimateGas + mint/DM/publish/agent.
 */

import { useState } from 'react';
import {
  Coins, PieChart, Search, ArrowLeftRight, Fuel,
  Sparkles, Send, Globe, Wand2,
  Loader2, Check, AlertTriangle,
} from 'lucide-react';
import { motion, AnimatePresence } from 'framer-motion';
import { api, apiHelpers } from '@/lib/api/client';
import { cn } from '@/lib/utils';
import { usePipe, useRecallableAction, RecallSlot } from '@/components/panel-polish';

interface MacroEnvelope<T> { ok: boolean; result?: T; error?: string }
async function callMacro<T>(action: string, input: Record<string, unknown>): Promise<MacroEnvelope<T>> {
  const r = await apiHelpers.lens.runDomain('crypto', action, { input });
  const data = (r as { data?: { ok: boolean; result?: T } }).data;
  if (!data) return { ok: false, error: 'empty response' };
  if (data.ok && data.result && typeof data.result === 'object' && 'ok' in data.result) {
    return data.result as MacroEnvelope<T>;
  }
  return data as MacroEnvelope<T>;
}

type Feedback = { kind: 'ok' | 'err'; text: string } | null;
type ActionId = 'portfolio' | 'search' | 'swap' | 'gas' | 'mint' | 'dm' | 'publish' | 'agent';

function pickMessage(e: unknown): string {
  const ax = e as { response?: { data?: { error?: string } }; message?: string };
  return ax?.response?.data?.error ?? ax?.message ?? 'request failed';
}

interface PortfolioResult { totalUsd?: number; topAllocation?: string; diversificationScore?: number; concentrationRisk?: string }
interface Token { id?: string; symbol: string; name?: string; priceUsd?: number; change24h?: number }
interface SwapResult { fromAmount?: number; toAmount?: number; priceImpact?: number; route?: string[] }
interface GasResult { gwei?: number; usdCost?: number; congestion?: string }

export function CryptoActionPanel() {
  const [holdings, setHoldings] = useState('');
  const [searchQuery, setSearchQuery] = useState('');
  const [fromToken, setFromToken] = useState('');
  const [toToken, setToToken] = useState('');
  const [fromAmount, setFromAmount] = useState('');
  const [gasNetwork, setGasNetwork] = useState<'ethereum' | 'polygon' | 'arbitrum' | 'base'>('ethereum');
  const [recipient, setRecipient] = useState('');

  const [busy, setBusy] = useState<ActionId | null>(null);
  const [feedback, setFeedback] = useState<Feedback>(null);
  const [portfolioResult, setPortfolioResult] = useState<PortfolioResult | null>(null);
  const [tokens, setTokens] = useState<Token[]>([]);
  const [swapResult, setSwapResult] = useState<SwapResult | null>(null);
  const [gasResult, setGasResult] = useState<GasResult | null>(null);
  const [mintedDtuId, setMintedDtuId] = useState<string | null>(null);
  const [publishedDtuId, setPublishedDtuId] = useState<string | null>(null);
  const [agentReply, setAgentReply] = useState<string | null>(null);

  const ok = (t: string) => setFeedback({ kind: 'ok', text: t });
  const err = (t: string) => setFeedback({ kind: 'err', text: t });

  const pipe = usePipe();
  const dmRecall = useRecallableAction({ label: 'DM', windowMs: 60_000, onUndo: async (id) => { await api.delete(`/api/social/dm/${encodeURIComponent(id)}`); } });
  const publishRecall = useRecallableAction({ label: 'publish', windowMs: 30_000, onUndo: async (id) => { await api.delete(`/api/dtus/${encodeURIComponent(id)}/publish`); setPublishedDtuId(null); } });

  function parseHoldings() {
    return holdings.split('\n').map(l => { const m = l.trim().match(/^(\S+)\s+([\d.]+)\s+([\d.]+)$/); return m ? { symbol: m[1], amount: parseFloat(m[2]), priceUsd: parseFloat(m[3]) } : null; }).filter(Boolean);
  }

  async function actPortfolio() {
    const h = parseHoldings(); if (!h.length) { err('Add holdings (one per line: SYMBOL amount priceUsd).'); return; }
    setBusy('portfolio'); setFeedback(null);
    try {
      const r = await callMacro<PortfolioResult>('portfolioAnalysis', { holdings: h });
      if (r.ok && r.result) { setPortfolioResult(r.result); pipe.publish('crypto.portfolio', r.result, { label: `Portfolio $${r.result.totalUsd?.toLocaleString()}` }); ok(`$${r.result.totalUsd?.toLocaleString()} portfolio.`); } else err(r.error ?? 'portfolio failed');
    } catch (e) { err(pickMessage(e)); } finally { setBusy(null); }
  }
  async function actSearch() {
    if (!searchQuery.trim()) { err('Token query required.'); return; }
    setBusy('search'); setFeedback(null);
    try {
      const r = await callMacro<{ tokens?: Token[] }>('search-tokens', { query: searchQuery.trim() });
      if (r.ok && r.result?.tokens) { setTokens(r.result.tokens); pipe.publish('crypto.search', r.result, { label: `${r.result.tokens.length} tokens` }); ok(`${r.result.tokens.length} tokens.`); } else err(r.error ?? 'search failed');
    } catch (e) { err(pickMessage(e)); } finally { setBusy(null); }
  }
  async function actSwap() {
    const amt = parseFloat(fromAmount);
    if (!Number.isFinite(amt) || !fromToken.trim() || !toToken.trim()) { err('From + to + numeric amount required.'); return; }
    setBusy('swap'); setFeedback(null);
    try {
      const r = await callMacro<SwapResult>('swap-quote', { fromSymbol: fromToken, toSymbol: toToken, fromAmount: amt });
      if (r.ok && r.result) { setSwapResult(r.result); pipe.publish('crypto.swap', r.result, { label: `${r.result.fromAmount} ${fromToken} → ${r.result.toAmount} ${toToken}` }); ok(`${r.result.fromAmount} ${fromToken} → ${r.result.toAmount} ${toToken}.`); } else err(r.error ?? 'swap failed');
    } catch (e) { err(pickMessage(e)); } finally { setBusy(null); }
  }
  async function actGas() {
    setBusy('gas'); setFeedback(null);
    try {
      const r = await callMacro<GasResult>('estimateGas', { network: gasNetwork, operation: 'swap' });
      if (r.ok && r.result) { setGasResult(r.result); pipe.publish('crypto.gas', r.result, { label: `Gas ${r.result.gwei} gwei` }); ok(`Gas: ${r.result.gwei} gwei.`); } else err(r.error ?? 'gas failed');
    } catch (e) { err(pickMessage(e)); } finally { setBusy(null); }
  }
  async function actMint() {
    setBusy('mint'); setFeedback(null);
    try {
      const r = await api.post('/api/lens/run', { domain: 'dtu', name: 'create', input: { title: `Crypto snapshot — ${new Date().toISOString().slice(0, 10)}`, tags: ['crypto', 'snapshot'], source: 'crypto:snapshot:mint', meta: { visibility: 'private', consent: { allowCitations: false }, crypto: { holdings: parseHoldings(), portfolio: portfolioResult, swap: swapResult, gas: gasResult } } } });
      const id = r.data?.result?.dtu?.id ?? r.data?.dtu?.id ?? r.data?.result?.id;
      if (id) { setMintedDtuId(id); pipe.publish('crypto.mintedDtuId', id, { label: `Crypto DTU ${id.slice(0, 8)}…` }); ok(`Crypto DTU ${id.slice(0, 8)}…`); } else err('No DTU id.');
    } catch (e) { err(pickMessage(e)); } finally { setBusy(null); }
  }
  async function actDm() {
    if (!recipient.trim()) { err('Recipient required.'); return; }
    setBusy('dm'); setFeedback(null);
    const body = [`🪙 Crypto snapshot`, '',
      portfolioResult ? `Portfolio: $${portfolioResult.totalUsd?.toLocaleString()} (top: ${portfolioResult.topAllocation})` : '',
      swapResult ? `Swap: ${swapResult.fromAmount} ${fromToken} → ${swapResult.toAmount} ${toToken}` : '',
      gasResult ? `Gas: ${gasResult.gwei} gwei (${gasResult.congestion})` : '',
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
    if (!portfolioResult) { err('Run portfolio analysis first.'); return; }
    setBusy('publish'); setFeedback(null);
    try {
      const id = await publishRecall.run(async () => {
        const r = await api.post('/api/lens/run', { domain: 'dtu', name: 'create', input: { title: `Portfolio allocation — ${portfolioResult.topAllocation}`, tags: ['crypto', 'allocation', 'public'], source: 'crypto:allocation:publish', meta: { visibility: 'public', consent: { allowCitations: true }, anonymized: true, allocation: { topAllocation: portfolioResult.topAllocation, diversification: portfolioResult.diversificationScore, concentrationRisk: portfolioResult.concentrationRisk } } } });
        const newId = r.data?.result?.dtu?.id ?? r.data?.dtu?.id ?? r.data?.result?.id;
        if (!newId) throw new Error('No DTU id.');
        const pub = await api.post(`/api/dtus/${encodeURIComponent(newId)}/publish`);
        if (pub.data?.ok === false) throw new Error(pub.data?.error ?? 'publish failed');
        return newId as string;
      });
      if (id) { setPublishedDtuId(id); pipe.publish('crypto.publishedDtuId', id, { label: `Public alloc ${id.slice(0, 8)}…` }); ok(`Published ${id.slice(0, 8)}… · 30s to recall.`); }
    } catch (e) { err(pickMessage(e)); } finally { setBusy(null); }
  }
  async function actAgent() {
    setBusy('agent'); setFeedback(null); setAgentReply(null);
    try {
      const task = `Crypto state: ${portfolioResult ? `$${portfolioResult.totalUsd?.toLocaleString()} portfolio, top alloc ${portfolioResult.topAllocation}, concentration ${portfolioResult.concentrationRisk}.` : ''} ${gasResult ? `${gasNetwork} gas ${gasResult.gwei} gwei (${gasResult.congestion}).` : ''} Suggest the single best rebalance or hedge move for this week. Plain text. Be specific about asset + size.`;
      const r = await api.post('/api/lens/run', { domain: 'chat_agent', name: 'do', input: { task, maxTurns: 3 } });
      const reply = r.data?.result?.reply ?? r.data?.result?.summary ?? r.data?.result?.output ?? r.data?.reply;
      if (reply) { setAgentReply(typeof reply === 'string' ? reply : JSON.stringify(reply, null, 2)); ok('Move ready.'); } else err('Agent returned empty.');
    } catch (e) { err(pickMessage(e)); } finally { setBusy(null); }
  }

  const actions = [
    { id: 'portfolio' as ActionId, label: 'Portfolio', desc: 'portfolioAnalysis allocation', icon: PieChart, accent: '#22c55e', handler: actPortfolio },
    { id: 'search' as ActionId, label: 'Tokens', desc: 'search-tokens by query', icon: Search, accent: '#06b6d4', handler: actSearch },
    { id: 'swap' as ActionId, label: 'Swap', desc: 'swap-quote from→to', icon: ArrowLeftRight, accent: '#8b5cf6', handler: actSwap },
    { id: 'gas' as ActionId, label: 'Gas', desc: 'estimateGas by network', icon: Fuel, accent: '#f97316', handler: actGas },
    { id: 'mint' as ActionId, label: mintedDtuId ? 'Saved' : 'Mint', desc: mintedDtuId ? `${mintedDtuId.slice(0, 8)}…` : 'Private crypto DTU', icon: Sparkles, accent: '#3b82f6', handler: actMint },
    { id: 'dm' as ActionId, label: 'DM', desc: 'Send snapshot', icon: Send, accent: '#ec4899', handler: actDm },
    { id: 'publish' as ActionId, label: publishedDtuId ? 'Published' : 'Publish', desc: publishedDtuId ? `${publishedDtuId.slice(0, 8)}…` : 'Anonymized allocation + federation', icon: Globe, accent: '#15803d', handler: actPublish },
    { id: 'agent' as ActionId, label: 'Rebal', desc: 'Agent: rebalance/hedge move', icon: Wand2, accent: '#eab308', handler: actAgent },
  ];

  return (
    <div className="rounded-lg border border-yellow-500/20 bg-zinc-950/60 p-3 space-y-3">
      <header className="flex items-center gap-2 border-b border-yellow-500/10 pb-2">
        <Coins className="h-4 w-4 text-yellow-400" />
        <h3 className="text-sm font-semibold text-white">Crypto workbench</h3>
        <span className="rounded bg-zinc-800 px-1.5 py-0.5 font-mono text-[10px] uppercase tracking-wider text-zinc-400">coingecko · uniswap · etherscan</span>
      </header>

      <div>
        <label className="text-[10px] uppercase tracking-wider text-zinc-400 font-semibold mb-1 block">Holdings (SYM amount priceUsd)</label>
        <textarea value={holdings} onChange={(e) => setHoldings(e.target.value)} rows={4} className="w-full bg-zinc-900 border border-zinc-800 rounded px-2 py-1 text-[11px] text-yellow-200 font-mono focus:outline-none focus:ring-2 focus:ring-yellow-400/40 resize-none" />
      </div>

      <div className="grid grid-cols-2 md:grid-cols-6 gap-2">
        <input type="text" value={searchQuery} onChange={(e) => setSearchQuery(e.target.value)} className="md:col-span-2 bg-zinc-900 border border-zinc-800 rounded px-3 py-1.5 text-[12px] text-white" placeholder="Token query" />
        <input type="text" value={fromToken} onChange={(e) => setFromToken(e.target.value.toUpperCase())} className="bg-zinc-900 border border-zinc-800 rounded px-3 py-1.5 text-[12px] text-white font-mono" placeholder="From" />
        <input type="text" value={toToken} onChange={(e) => setToToken(e.target.value.toUpperCase())} className="bg-zinc-900 border border-zinc-800 rounded px-3 py-1.5 text-[12px] text-white font-mono" placeholder="To" />
        <input type="text" value={fromAmount} onChange={(e) => setFromAmount(e.target.value.replace(/[^\d.]/g, ''))} className="bg-zinc-900 border border-zinc-800 rounded px-3 py-1.5 text-[12px] text-white font-mono" placeholder="Amount" />
        <select value={gasNetwork} onChange={(e) => setGasNetwork(e.target.value as typeof gasNetwork)} className="bg-zinc-900 border border-zinc-800 rounded px-3 py-1.5 text-[11px] text-white">
          {(['ethereum', 'polygon', 'arbitrum', 'base'] as const).map(n => <option key={n} value={n}>{n}</option>)}
        </select>
        <div className="md:col-span-6 flex items-center gap-2 flex-wrap">
          <input type="text" value={recipient} onChange={(e) => setRecipient(e.target.value)} className="flex-1 bg-zinc-900 border border-zinc-800 rounded px-3 py-1.5 text-[12px] text-white" placeholder="DM recipient" />
          <RecallSlot ctl={dmRecall} />
          <RecallSlot ctl={publishRecall} />
        </div>
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
              <div className="text-[10px] text-zinc-500 leading-tight line-clamp-2">{a.desc}</div>
            </button>
          );
        })}
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 gap-2">
        {portfolioResult && (
          <div className="rounded-md border border-emerald-500/30 bg-emerald-500/5 p-2.5">
            <div className="text-[10px] uppercase tracking-wider text-emerald-300 font-semibold">Portfolio</div>
            <div className="text-2xl font-bold text-emerald-300">${portfolioResult.totalUsd?.toLocaleString()}</div>
            <div className="text-[10px] text-zinc-500">top: {portfolioResult.topAllocation} · diversification {portfolioResult.diversificationScore} · risk {portfolioResult.concentrationRisk}</div>
          </div>
        )}
        {tokens.length > 0 && (
          <div className="rounded-md border border-cyan-500/30 bg-cyan-500/5 p-2.5 max-h-40 overflow-y-auto">
            <div className="text-[10px] uppercase tracking-wider text-cyan-300 font-semibold">Tokens ({tokens.length})</div>
            {tokens.slice(0, 8).map((t, i) => <div key={i} className="text-[11px] text-zinc-300 flex justify-between"><span><strong className="text-cyan-200">{t.symbol}</strong> {t.name}</span><span className="font-mono">${t.priceUsd?.toFixed(4)} {t.change24h != null && <span className={cn(t.change24h >= 0 ? 'text-emerald-300' : 'text-rose-300')}>{t.change24h >= 0 ? '+' : ''}{t.change24h.toFixed(1)}%</span>}</span></div>)}
          </div>
        )}
        {swapResult && (
          <div className="rounded-md border border-purple-500/30 bg-purple-500/5 p-2.5">
            <div className="text-[10px] uppercase tracking-wider text-purple-300 font-semibold">Swap quote</div>
            <div className="text-sm font-mono text-purple-200">{swapResult.fromAmount} {fromToken} → <span className="text-emerald-300">{swapResult.toAmount?.toFixed(6)} {toToken}</span></div>
            {swapResult.priceImpact != null && <div className="text-[10px] text-zinc-500">price impact {swapResult.priceImpact}% · route {swapResult.route?.join(' → ')}</div>}
          </div>
        )}
        {gasResult && (
          <div className={cn('rounded-md border p-2.5', gasResult.congestion === 'high' ? 'border-rose-500/40 bg-rose-500/5' : gasResult.congestion === 'medium' ? 'border-amber-500/40 bg-amber-500/5' : 'border-emerald-500/40 bg-emerald-500/5')}>
            <div className="text-[10px] uppercase tracking-wider text-orange-300 font-semibold">{gasNetwork} gas · {gasResult.congestion}</div>
            <div className="text-2xl font-bold text-orange-300">{gasResult.gwei} <span className="text-xs text-zinc-400">gwei</span></div>
            {gasResult.usdCost != null && <div className="text-[10px] text-zinc-500">~${gasResult.usdCost.toFixed(2)} per swap</div>}
          </div>
        )}
      </div>

      {agentReply && (
        <div className="rounded-md border border-yellow-500/30 bg-yellow-500/5 p-3 max-h-60 overflow-y-auto">
          <div className="flex items-center gap-1.5 text-yellow-400 font-semibold mb-1.5 uppercase tracking-wider text-[10px]"><Wand2 className="w-3 h-3" /> Rebalance move</div>
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
