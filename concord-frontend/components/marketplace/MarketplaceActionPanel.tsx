'use client';

/**
 * MarketplaceActionPanel — a creator-listing workbench.
 * Surfaces listingScore / priceOptimize / sellerMetrics macros plus
 * mint/DM/publish/agent.
 */

import { useState } from 'react';
import {
  ShoppingBag, TrendingUp, Tag, BarChart3,
  Sparkles, Send, Globe, Wand2,
  Loader2, Check, AlertTriangle,
} from 'lucide-react';
import { motion, AnimatePresence } from 'framer-motion';
import { api, apiHelpers, lensRun } from '@/lib/api/client';
import { cn } from '@/lib/utils';
import { usePipe, useRecallableAction, RecallSlot } from '@/components/panel-polish';

interface MacroEnvelope<T> { ok: boolean; result?: T; error?: string; reason?: string }
async function callMacro<T>(action: string, input: Record<string, unknown>): Promise<MacroEnvelope<T>> {
  const r = await apiHelpers.lens.runDomain('marketplace', action, { input });
  const data = (r as { data?: { ok: boolean; result?: T } }).data;
  if (!data) return { ok: false, error: 'empty response' };
  if (data.ok && data.result && typeof data.result === 'object' && 'ok' in data.result) {
    return data.result as MacroEnvelope<T>;
  }
  return data as MacroEnvelope<T>;
}

type Feedback = { kind: 'ok' | 'err'; text: string } | null;
type ActionId = 'score' | 'price' | 'metrics' | 'mint' | 'dm' | 'publish' | 'agent';

function pickMessage(e: unknown): string {
  const ax = e as { response?: { data?: { error?: string } }; message?: string };
  return ax?.response?.data?.error ?? ax?.message ?? 'request failed';
}

interface ScoreResult { score?: number; band?: string; factors?: Record<string, number>; tips?: string[] }
interface PriceResult { suggestedPrice?: number; competitorAvg?: number; demandIndex?: number; rationale?: string }
interface MetricsResult { listings?: number; views?: number; sales?: number; conversionPct?: number; revenue?: number }

export function MarketplaceActionPanel() {
  const [listingTitle, setListingTitle] = useState('');
  const [listingDesc, setListingDesc] = useState('');
  const [listingPrice, setListingPrice] = useState('');
  const [listingTags, setListingTags] = useState('');
  const [category, setCategory] = useState<string>('digital-art');
  const [recipient, setRecipient] = useState('');

  const [busy, setBusy] = useState<ActionId | null>(null);
  const [feedback, setFeedback] = useState<Feedback>(null);

  const [scoreResult, setScoreResult] = useState<ScoreResult | null>(null);
  const [priceResult, setPriceResult] = useState<PriceResult | null>(null);
  const [metricsResult, setMetricsResult] = useState<MetricsResult | null>(null);
  const [mintedDtuId, setMintedDtuId] = useState<string | null>(null);
  const [publishedDtuId, setPublishedDtuId] = useState<string | null>(null);
  const [agentReply, setAgentReply] = useState<string | null>(null);

  const ok  = (text: string) => setFeedback({ kind: 'ok',  text });
  const err = (text: string) => setFeedback({ kind: 'err', text });
  const ready = listingTitle.trim().length > 0;

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

  async function actScore() {
    if (!ready) { err('Listing title required.'); return; }
    setBusy('score'); setFeedback(null);
    try {
      const r = await callMacro<ScoreResult>('listingScore', { title: listingTitle.trim(), description: listingDesc, price: parseFloat(listingPrice), tags: listingTags.split(',').map(t => t.trim()).filter(Boolean), category });
      if (r.ok && r.result) { setScoreResult(r.result); pipe.publish('marketplace.score', r.result, { label: `score ${r.result.score}` }); ok(`Score ${r.result.score} (${r.result.band}).`); }
      else err(r.error ?? 'score failed');
    } catch (e) { err(pickMessage(e)); }
    finally { setBusy(null); }
  }
  async function actPrice() {
    if (!ready) { err('Listing title required.'); return; }
    setBusy('price'); setFeedback(null);
    try {
      const r = await callMacro<PriceResult>('priceOptimize', { title: listingTitle.trim(), category, currentPrice: parseFloat(listingPrice) });
      if (r.ok && r.result) { setPriceResult(r.result); pipe.publish('marketplace.price', r.result, { label: `$${r.result.suggestedPrice}` }); ok(`Suggested $${r.result.suggestedPrice}.`); }
      else err(r.error ?? 'price failed');
    } catch (e) { err(pickMessage(e)); }
    finally { setBusy(null); }
  }
  async function actMetrics() {
    setBusy('metrics'); setFeedback(null);
    try {
      const r = await callMacro<MetricsResult>('sellerMetrics', {});
      if (r.ok && r.result) { setMetricsResult(r.result); pipe.publish('marketplace.metrics', r.result, { label: `${r.result.sales} sales` }); ok(`${r.result.sales} sales · ${r.result.conversionPct}% conv.`); }
      else err(r.error ?? 'metrics failed');
    } catch (e) { err(pickMessage(e)); }
    finally { setBusy(null); }
  }

  async function actMint() {
    if (!ready) { err('Listing title required.'); return; }
    setBusy('mint'); setFeedback(null);
    try {
      const r = await lensRun({
        domain: 'dtu', name: 'create',
        input: {
          title: `Listing — ${listingTitle.trim()}`,
          tags: ['marketplace', 'listing', category, `price:${listingPrice}`],
          source: 'marketplace:listing:mint',
          meta: { visibility: 'private', consent: { allowCitations: false }, listing: { title: listingTitle, description: listingDesc, price: parseFloat(listingPrice), category, tags: listingTags.split(',').map(t => t.trim()).filter(Boolean), score: scoreResult, priceOpt: priceResult } },
        },
      });
      const dtu = r.data?.result?.dtu ?? r.data?.result;
      const id = dtu?.id ?? dtu?.dtuId;
      if (id) { setMintedDtuId(id); pipe.publish('marketplace.mintedDtuId', id, { label: `listing ${id.slice(0, 8)}` }); ok(`Listing DTU ${id.slice(0, 8)}…`); }
      else err('No DTU id returned.');
    } catch (e) { err(pickMessage(e)); }
    finally { setBusy(null); }
  }
  async function actDm() {
    if (!recipient.trim()) { err('Enter a recipient.'); return; }
    setBusy('dm'); setFeedback(null);
    const body = [
      `🛒 Listing: ${listingTitle.trim()}`, '',
      `Price: $${listingPrice} · category: ${category}`,
      scoreResult ? `Score: ${scoreResult.score}/100 (${scoreResult.band})` : '',
      priceResult ? `Suggested price: $${priceResult.suggestedPrice} (current $${listingPrice})` : '',
      mintedDtuId ? `\n[Listing DTU ${mintedDtuId}]` : '',
    ].filter(Boolean).join('\n');
    try {
      const messageId = await dmRecall.run(async () => {
        const r = await api.post('/api/social/dm', { toUserId: recipient.trim(), content: body });
        if (r.data?.ok === false) throw new Error(r.data?.error ?? 'send failed');
        return r.data?.message?.id as string;
      });
      if (messageId) { ok('Sent. 60s to recall.'); setRecipient(''); }
    } catch (e) { err(pickMessage(e)); }
    finally { setBusy(null); }
  }
  async function actPublish() {
    if (!ready) { err('Listing title required.'); return; }
    setBusy('publish'); setFeedback(null);
    try {
      const id = await publishRecall.run(async () => {
        const r = await lensRun({
          domain: 'dtu', name: 'create',
          input: {
            title: `For sale — ${listingTitle.trim()}`,
            tags: ['marketplace', 'listing', 'public', 'for-sale', category],
            source: 'marketplace:listing:publish',
            meta: { visibility: 'public', consent: { allowCitations: true }, listing: { title: listingTitle, description: listingDesc, price: parseFloat(listingPrice), category, tags: listingTags.split(',').map(t => t.trim()).filter(Boolean) } },
          },
        });
        const dtu = r.data?.result?.dtu ?? r.data?.result;
        const newId = dtu?.id ?? dtu?.dtuId;
        if (!newId) throw new Error('No DTU id returned.');
        const pub = await api.post(`/api/dtus/${encodeURIComponent(newId)}/publish`);
        if (pub.data?.ok === false) throw new Error(pub.data?.error ?? 'publish flag failed');
        return newId as string;
      });
      if (id) { setPublishedDtuId(id); pipe.publish('marketplace.publishedDtuId', id, { label: `live ${id.slice(0, 8)}` }); ok(`Listing live ${id.slice(0, 8)}… · 30s to recall.`); }
    } catch (e) { err(pickMessage(e)); }
    finally { setBusy(null); }
  }
  async function actAgent() {
    if (!ready) { err('Listing title required.'); return; }
    setBusy('agent'); setFeedback(null); setAgentReply(null);
    try {
      const task = [
        `Marketplace listing: "${listingTitle.trim()}" ($${listingPrice}, ${category}).`,
        listingDesc ? `Description: ${listingDesc.slice(0, 400)}` : 'No description.',
        scoreResult ? `Score ${scoreResult.score} (${scoreResult.band}).` : '',
        priceResult ? `Price optimization suggests $${priceResult.suggestedPrice}.` : '',
        '',
        'Rewrite the listing title + first sentence of description for maximum conversion for a creator marketplace.',
        'Return: new title, new opening sentence, why it converts better. Plain text.',
      ].filter(Boolean).join(' ');
      const r = await lensRun({ domain: 'chat_agent', name: 'do', input: { task, maxTurns: 4 } });
      const reply = r.data?.result?.reply ?? r.data?.result?.summary ?? r.data?.result?.output;
      if (reply) { setAgentReply(typeof reply === 'string' ? reply : JSON.stringify(reply, null, 2)); ok('Copy ready.'); }
      else err('Agent returned empty.');
    } catch (e) { err(pickMessage(e)); }
    finally { setBusy(null); }
  }

  const actions: Array<{ id: ActionId; label: string; desc: string; icon: React.ComponentType<{ className?: string }>; accent: string; handler: () => void }> = [
    { id: 'score',    label: 'Score',   desc: 'listingScore quality + tips',          icon: Tag,         accent: '#06b6d4', handler: actScore },
    { id: 'price',    label: 'Price',   desc: 'priceOptimize against competitors',    icon: TrendingUp,  accent: '#eab308', handler: actPrice },
    { id: 'metrics',  label: 'Metrics', desc: 'sellerMetrics views / sales / conv',  icon: BarChart3,   accent: '#8b5cf6', handler: actMetrics },
    { id: 'mint',     label: mintedDtuId      ? 'Saved'     : 'Mint',         desc: mintedDtuId      ? `DTU ${mintedDtuId.slice(0, 8)}…`     : 'Private listing DTU',                       icon: Sparkles,    accent: '#3b82f6', handler: actMint },
    { id: 'dm',       label: 'DM',      desc: 'Send listing + score to user',         icon: Send,        accent: '#ec4899', handler: actDm },
    { id: 'publish',  label: publishedDtuId ? 'Live' : 'Go live',  desc: publishedDtuId ? `DTU ${publishedDtuId.slice(0, 8)}…` : 'Public listing DTU + federation',          icon: Globe,    accent: '#22c55e', handler: actPublish },
    { id: 'agent',    label: 'Copy AI', desc: 'Agent rewrites title + opening',       icon: Wand2,       accent: '#a855f7', handler: actAgent },
  ];

  return (
    <div className="rounded-lg border border-green-500/20 bg-zinc-950/60 p-3 space-y-3">
      <header className="flex items-center gap-2 border-b border-green-500/10 pb-2">
        <ShoppingBag className="h-4 w-4 text-green-400" />
        <h3 className="text-sm font-semibold text-white">Listing workbench</h3>
      </header>

      <div className="grid grid-cols-1 md:grid-cols-4 gap-2">
        <input type="text" value={listingTitle} onChange={(e) => setListingTitle(e.target.value)} className="md:col-span-2 bg-zinc-900 border border-zinc-800 rounded px-3 py-1.5 text-[12px] text-white" placeholder="Listing title" />
        <input type="text" value={listingPrice} onChange={(e) => setListingPrice(e.target.value.replace(/[^\d.]/g, ''))} className="bg-zinc-900 border border-zinc-800 rounded px-3 py-1.5 text-[12px] text-white font-mono" placeholder="Price $" />
        <select value={category} onChange={(e) => setCategory(e.target.value)} className="bg-zinc-900 border border-zinc-800 rounded px-3 py-1.5 text-[11px] text-white">
          {['digital-art', 'music', 'ebook', 'course', 'software', 'template', 'preset', 'physical'].map(c => <option key={c} value={c}>{c}</option>)}
        </select>
        <input type="text" value={listingTags} onChange={(e) => setListingTags(e.target.value)} className="md:col-span-3 bg-zinc-900 border border-zinc-800 rounded px-3 py-1.5 text-[11px] text-white" placeholder="Tags (comma-separated)" />
        <input type="text" value={recipient} onChange={(e) => setRecipient(e.target.value)} className="bg-zinc-900 border border-zinc-800 rounded px-3 py-1.5 text-[11px] text-white" placeholder="DM recipient" />
      </div>

      <div className="flex items-center gap-2 flex-wrap">
        <RecallSlot ctl={dmRecall} />
        <RecallSlot ctl={publishRecall} />
      </div>

      <div>
        <label className="text-[10px] uppercase tracking-wider text-zinc-400 font-semibold mb-1 block">Description</label>
        <textarea value={listingDesc} onChange={(e) => setListingDesc(e.target.value)} rows={5} className="w-full bg-zinc-900 border border-zinc-800 rounded px-3 py-2 text-[12px] text-white focus:outline-none focus:ring-2 focus:ring-green-400/40 resize-y leading-relaxed" placeholder="What is it, who is it for, why $X..." />
      </div>

      <div className="grid grid-cols-3 md:grid-cols-4 lg:grid-cols-7 gap-2">
        {actions.map(a => {
          const Icon = a.icon;
          const isBusy = busy === a.id;
          return (
            <button key={a.id} type="button" disabled={!!busy} onClick={a.handler}
              className={cn('group flex flex-col items-start gap-1.5 p-2.5 rounded-lg text-left border transition-all', 'bg-zinc-900/40 border-zinc-800 hover:bg-zinc-800/60 hover:border-zinc-700', 'disabled:opacity-40 disabled:cursor-not-allowed')}>
              <div className="w-7 h-7 rounded-md flex items-center justify-center" style={{ backgroundColor: a.accent + '20', color: a.accent }}>
                {isBusy ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Icon className="w-3.5 h-3.5" />}
              </div>
              <div className="text-[11px] font-semibold text-zinc-100 leading-tight">{a.label}</div>
              <div className="text-[10px] text-zinc-400 leading-tight line-clamp-2">{a.desc}</div>
            </button>
          );
        })}
      </div>

      <div className="grid grid-cols-1 md:grid-cols-3 gap-2">
        {scoreResult && (
          <div className={cn('rounded-md border p-2.5', (scoreResult.score ?? 0) >= 70 ? 'border-emerald-500/40 bg-emerald-500/5' : (scoreResult.score ?? 0) >= 40 ? 'border-amber-500/40 bg-amber-500/5' : 'border-rose-500/40 bg-rose-500/5')}>
            <div className="text-[10px] uppercase tracking-wider text-cyan-300 font-semibold flex items-center gap-1.5"><Tag className="w-3 h-3" /> Score {scoreResult.band}</div>
            <div className="text-2xl font-bold text-zinc-100 mt-1">{scoreResult.score}<span className="text-sm text-zinc-400">/100</span></div>
            {scoreResult.tips?.length ? <ul className="text-[11px] text-zinc-300 list-disc list-inside mt-1">{scoreResult.tips.slice(0, 3).map((t, i) => <li key={i}>{t}</li>)}</ul> : null}
          </div>
        )}
        {priceResult && (
          <div className="rounded-md border border-yellow-500/40 bg-yellow-500/5 p-2.5">
            <div className="text-[10px] uppercase tracking-wider text-yellow-300 font-semibold flex items-center gap-1.5"><TrendingUp className="w-3 h-3" /> Price</div>
            <div className="text-2xl font-bold text-yellow-200 mt-1">${priceResult.suggestedPrice}</div>
            <div className="text-[10px] text-zinc-400">vs competitor avg ${priceResult.competitorAvg} · demand {priceResult.demandIndex}</div>
            {priceResult.rationale && <p className="text-[11px] text-zinc-300 mt-1">{priceResult.rationale}</p>}
          </div>
        )}
        {metricsResult && (
          <div className="rounded-md border border-purple-500/30 bg-purple-500/5 p-2.5">
            <div className="text-[10px] uppercase tracking-wider text-purple-300 font-semibold flex items-center gap-1.5"><BarChart3 className="w-3 h-3" /> Seller metrics</div>
            <div className="text-[11px] text-zinc-300 mt-1 space-y-0.5">
              <div>{metricsResult.listings} listings · {metricsResult.sales} sales</div>
              <div>conversion <span className="font-mono">{metricsResult.conversionPct}%</span></div>
              <div className="text-emerald-300 font-semibold">revenue <span className="font-mono">${metricsResult.revenue?.toLocaleString()}</span></div>
            </div>
          </div>
        )}
      </div>

      {agentReply && (
        <div className="rounded-md border border-purple-500/30 bg-purple-500/5 p-3 max-h-72 overflow-y-auto">
          <div className="flex items-center gap-1.5 text-purple-300 font-semibold mb-1.5 uppercase tracking-wider text-[10px]"><Wand2 className="w-3 h-3" /> Copy rewrite</div>
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
