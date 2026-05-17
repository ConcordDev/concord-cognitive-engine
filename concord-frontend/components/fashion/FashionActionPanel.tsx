'use client';

/**
 * FashionActionPanel — stylist / wardrobe bench.
 * styleProfile / outfitSuggest / trendAnalysis / costPerWear +
 * mint/DM/publish/agent.
 */

import { useState } from 'react';
import { Shirt, Sparkles as Spark, TrendingUp, DollarSign, Sparkles, Send, Globe, Wand2, Loader2, Check, AlertTriangle } from 'lucide-react';
import { motion, AnimatePresence } from 'framer-motion';
import { api, apiHelpers } from '@/lib/api/client';
import { cn } from '@/lib/utils';

interface MacroEnvelope<T> { ok: boolean; result?: T; error?: string }
async function callMacro<T>(action: string, input: Record<string, unknown>): Promise<MacroEnvelope<T>> {
  const r = await apiHelpers.lens.runDomain('fashion', action, { input });
  const data = (r as { data?: { ok: boolean; result?: T; error?: string } }).data;
  if (!data) return { ok: false, error: 'empty response' };
  if (data.ok && data.result && typeof data.result === 'object' && 'ok' in data.result) return data.result as MacroEnvelope<T>;
  return data as MacroEnvelope<T>;
}

type Feedback = { kind: 'ok' | 'err'; text: string } | null;
type ActionId = 'style' | 'outfit' | 'trend' | 'cpw' | 'mint' | 'dm' | 'publish' | 'agent';
function pickMessage(e: unknown): string { const ax = e as { response?: { data?: { error?: string } }; message?: string }; return ax?.response?.data?.error ?? ax?.message ?? 'request failed'; }

interface StyleResult { wardrobeSize: number; dominantColors: { color: string; count: number }[]; categoryBreakdown: Record<string, number>; style: string; bodyType: string; budget: string; season: string }
interface OutfitSuggestion { top?: string; bottom?: string; outerwear?: string; note?: string }
interface OutfitResult { occasion: string; season: string; suggestions: OutfitSuggestion[]; wardrobeSize: number; missingPieces: string[] }
interface TrendResult { totalTrends: number; categories: number; byCategory: { category: string; count: number; trending: number }[]; hottest: string }
interface CpwItem { name: string; cost: number; wears: number; costPerWear: number; value: string }
interface CpwResult { items: CpwItem[]; bestValue: string; worstValue: string; avgCostPerWear: number; tip: string }

const DEFAULT_STYLE = JSON.stringify({ preferences: { style: 'minimal-modern', bodyType: 'rectangle', budget: 'moderate', season: 'all-season' }, wardrobe: [{ name: 'Black tee', category: 'top', color: 'black', cost: 32, wears: 45 }, { name: 'Linen blouse', category: 'top', color: 'cream', cost: 78, wears: 22 }, { name: 'Dark jeans', category: 'bottom', color: 'indigo', cost: 120, wears: 78 }, { name: 'Wool blazer', category: 'jacket', color: 'navy', cost: 240, wears: 38 }, { name: 'White button-up', category: 'shirt', color: 'white', cost: 65, wears: 30 }, { name: 'Black trousers', category: 'pants', color: 'black', cost: 110, wears: 25 }] }, null, 2);
const DEFAULT_OUTFIT = JSON.stringify({ occasion: 'business-casual', season: 'fall', wardrobe: [{ name: 'White button-up', category: 'shirt' }, { name: 'Black tee', category: 'top' }, { name: 'Dark jeans', category: 'pants' }, { name: 'Black trousers', category: 'pants' }, { name: 'Wool blazer', category: 'jacket' }] }, null, 2);
const DEFAULT_TREND = JSON.stringify({ trends: [{ name: 'Quiet luxury', category: 'aesthetic', popularity: 95, trending: true }, { name: 'Wide-leg trousers', category: 'silhouette', popularity: 85, trending: true }, { name: 'Sage green', category: 'color', popularity: 78, trending: true }, { name: 'Skinny jeans revival', category: 'silhouette', popularity: 40, trending: false }, { name: 'Tomato red', category: 'color', popularity: 82, trending: true }] }, null, 2);
const DEFAULT_CPW = JSON.stringify({ items: [{ name: 'Dark jeans', cost: 120, wears: 78 }, { name: 'Black tee', cost: 32, wears: 45 }, { name: 'Wool blazer', cost: 240, wears: 38 }, { name: 'Sequin dress', cost: 320, wears: 3 }, { name: 'White button-up', cost: 65, wears: 30 }] }, null, 2);

export function FashionActionPanel() {
  const [styleText, setStyleText] = useState(DEFAULT_STYLE);
  const [outfitText, setOutfitText] = useState(DEFAULT_OUTFIT);
  const [trendText, setTrendText] = useState(DEFAULT_TREND);
  const [cpwText, setCpwText] = useState(DEFAULT_CPW);
  const [recipient, setRecipient] = useState('');

  const [busy, setBusy] = useState<ActionId | null>(null);
  const [feedback, setFeedback] = useState<Feedback>(null);
  const [styleResult, setStyleResult] = useState<StyleResult | null>(null);
  const [outfitResult, setOutfitResult] = useState<OutfitResult | null>(null);
  const [trendResult, setTrendResult] = useState<TrendResult | null>(null);
  const [cpwResult, setCpwResult] = useState<CpwResult | null>(null);
  const [mintedDtuId, setMintedDtuId] = useState<string | null>(null);
  const [publishedDtuId, setPublishedDtuId] = useState<string | null>(null);
  const [agentReply, setAgentReply] = useState<string | null>(null);

  const ok = (m: string) => setFeedback({ kind: 'ok', text: m });
  const err = (m: string) => setFeedback({ kind: 'err', text: m });

  async function actStyle() {
    try { const parsed = JSON.parse(styleText); setBusy('style'); setFeedback(null);
      const r = await callMacro<StyleResult>('styleProfile', { artifact: { data: parsed } });
      if (r.ok && r.result) { setStyleResult(r.result); ok(`${r.result.style} · ${r.result.wardrobeSize} pieces`); } else err(r.error ?? 'style failed');
    } catch (e) { err(e instanceof SyntaxError ? 'Invalid style JSON.' : pickMessage(e)); } finally { setBusy(null); }
  }
  async function actOutfit() {
    try { const parsed = JSON.parse(outfitText); setBusy('outfit'); setFeedback(null);
      const r = await callMacro<OutfitResult>('outfitSuggest', { artifact: { data: parsed } });
      if (r.ok && r.result) { setOutfitResult(r.result); ok(`${r.result.suggestions.length} outfits for ${r.result.occasion}`); } else err(r.error ?? 'outfit failed');
    } catch (e) { err(e instanceof SyntaxError ? 'Invalid outfit JSON.' : pickMessage(e)); } finally { setBusy(null); }
  }
  async function actTrend() {
    try { const parsed = JSON.parse(trendText); setBusy('trend'); setFeedback(null);
      const r = await callMacro<TrendResult>('trendAnalysis', { artifact: { data: parsed } });
      if (r.ok && r.result) { setTrendResult(r.result); ok(`${r.result.totalTrends} trends · hottest: ${r.result.hottest}`); } else err(r.error ?? 'trend failed');
    } catch (e) { err(e instanceof SyntaxError ? 'Invalid trend JSON.' : pickMessage(e)); } finally { setBusy(null); }
  }
  async function actCpw() {
    try { const parsed = JSON.parse(cpwText); setBusy('cpw'); setFeedback(null);
      const r = await callMacro<CpwResult>('costPerWear', { artifact: { data: parsed } });
      if (r.ok && r.result) { setCpwResult(r.result); ok(`avg $${r.result.avgCostPerWear}/wear · best: ${r.result.bestValue}`); } else err(r.error ?? 'cpw failed');
    } catch (e) { err(e instanceof SyntaxError ? 'Invalid cpw JSON.' : pickMessage(e)); } finally { setBusy(null); }
  }
  async function actMint() {
    setBusy('mint'); setFeedback(null);
    try {
      const r = await api.post('/api/lens/run', { domain: 'dtu', name: 'create', input: { title: `Style profile`, tags: ['fashion', styleResult?.style].filter((t): t is string => !!t), source: 'fashion:profile:mint', meta: { visibility: 'private', consent: { allowCitations: false }, fashion: { style: styleResult, outfit: outfitResult, trend: trendResult, cpw: cpwResult } } } });
      const id = r.data?.result?.dtu?.id ?? r.data?.dtu?.id ?? r.data?.result?.id;
      if (id) { setMintedDtuId(id); ok(`Profile DTU ${id.slice(0, 8)}…`); } else err('No DTU id.');
    } catch (e) { err(pickMessage(e)); } finally { setBusy(null); }
  }
  async function actDm() {
    if (!recipient.trim()) { err('Recipient required.'); return; }
    setBusy('dm'); setFeedback(null);
    const body = [`👔 Style profile`, '', styleResult ? `Style: ${styleResult.style} · ${styleResult.wardrobeSize} pieces · budget ${styleResult.budget} · top colors: ${styleResult.dominantColors.slice(0, 3).map(c => c.color).join(', ')}` : '', outfitResult ? `Outfits (${outfitResult.occasion}): ${outfitResult.suggestions.length} suggested${outfitResult.missingPieces.length ? ` · need: ${outfitResult.missingPieces.join(', ')}` : ''}` : '', trendResult ? `Trends: ${trendResult.totalTrends} tracked · hottest: ${trendResult.hottest}` : '', cpwResult ? `Cost/wear avg $${cpwResult.avgCostPerWear} · best: ${cpwResult.bestValue} · worst: ${cpwResult.worstValue}` : '', mintedDtuId ? `\n[DTU ${mintedDtuId}]` : ''].filter(Boolean).join('\n');
    try { const r = await api.post('/api/social/dm', { toUserId: recipient.trim(), content: body }); if (r.data?.ok !== false) { ok('Sent.'); setRecipient(''); } else err(r.data?.error ?? 'send failed'); }
    catch (e) { err(pickMessage(e)); } finally { setBusy(null); }
  }
  async function actPublish() {
    if (!styleResult && !trendResult) { err('Style or trend first.'); return; }
    setBusy('publish'); setFeedback(null);
    try {
      const r = await api.post('/api/lens/run', { domain: 'dtu', name: 'create', input: { title: `Style card`, tags: ['fashion', 'style', 'public'], source: 'fashion:card:publish', meta: { visibility: 'public', consent: { allowCitations: true }, anon: true, fashion: { style: styleResult, trend: trendResult } } } });
      const id = r.data?.result?.dtu?.id ?? r.data?.dtu?.id ?? r.data?.result?.id;
      if (!id) { err('No DTU id.'); return; }
      const pub = await api.post(`/api/dtus/${encodeURIComponent(id)}/publish`);
      if (pub.data?.ok !== false) { setPublishedDtuId(id); ok(`Published ${id.slice(0, 8)}…`); } else err(pub.data?.error ?? 'publish failed');
    } catch (e) { err(pickMessage(e)); } finally { setBusy(null); }
  }
  async function actAgent() {
    setBusy('agent'); setFeedback(null); setAgentReply(null);
    try {
      const task = `Personal stylist brief. ${styleResult ? `Wardrobe: ${styleResult.wardrobeSize} pieces, style ${styleResult.style}, top colors ${styleResult.dominantColors.slice(0, 3).map(c => c.color).join(', ')}.` : ''} ${outfitResult ? `${outfitResult.suggestions.length} outfits for ${outfitResult.occasion}/${outfitResult.season}; missing ${outfitResult.missingPieces.join(', ') || 'nothing'}.` : ''} ${trendResult ? `Hottest trend: ${trendResult.hottest}.` : ''} ${cpwResult ? `Best CPW ${cpwResult.bestValue}, worst ${cpwResult.worstValue} ($${cpwResult.avgCostPerWear}/wear avg).` : ''} Recommend one wardrobe addition + one piece to part with. Plain text, ≤ 3 sentences.`;
      const r = await api.post('/api/lens/run', { domain: 'chat_agent', name: 'do', input: { task, maxTurns: 3 } });
      const reply = r.data?.result?.reply ?? r.data?.result?.summary ?? r.data?.result?.output ?? r.data?.reply;
      if (reply) { setAgentReply(typeof reply === 'string' ? reply : JSON.stringify(reply, null, 2)); ok('Stylist brief ready.'); } else err('Agent returned empty.');
    } catch (e) { err(pickMessage(e)); } finally { setBusy(null); }
  }

  const actions = [
    { id: 'style' as ActionId, label: 'Style', desc: 'styleProfile', icon: Shirt, accent: '#a855f7', handler: actStyle },
    { id: 'outfit' as ActionId, label: 'Outfit', desc: 'outfitSuggest', icon: Spark, accent: '#ec4899', handler: actOutfit },
    { id: 'trend' as ActionId, label: 'Trend', desc: 'trendAnalysis', icon: TrendingUp, accent: '#3b82f6', handler: actTrend },
    { id: 'cpw' as ActionId, label: 'Cost/wear', desc: 'costPerWear', icon: DollarSign, accent: '#22c55e', handler: actCpw },
    { id: 'mint' as ActionId, label: mintedDtuId ? 'Saved' : 'Mint', desc: mintedDtuId ? `${mintedDtuId.slice(0, 8)}…` : 'Private profile', icon: Sparkles, accent: '#06b6d4', handler: actMint },
    { id: 'dm' as ActionId, label: 'DM', desc: 'Send profile', icon: Send, accent: '#f59e0b', handler: actDm },
    { id: 'publish' as ActionId, label: publishedDtuId ? 'Published' : 'Publish', desc: publishedDtuId ? `${publishedDtuId.slice(0, 8)}…` : 'Anon card', icon: Globe, accent: '#15803d', handler: actPublish },
    { id: 'agent' as ActionId, label: 'Stylist', desc: 'Agent: add/cull', icon: Wand2, accent: '#eab308', handler: actAgent },
  ];

  const VALUE_COLOR: Record<string, string> = { excellent: 'text-emerald-300', good: 'text-blue-300', moderate: 'text-amber-300', poor: 'text-red-300' };

  return (
    <div className="rounded-lg border border-pink-500/20 bg-zinc-950/60 p-3 space-y-3">
      <header className="flex items-center gap-2 border-b border-pink-500/10 pb-2">
        <Shirt className="h-4 w-4 text-pink-400" />
        <h3 className="text-sm font-semibold text-white">Fashion / wardrobe bench</h3>
        <span className="rounded bg-zinc-800 px-1.5 py-0.5 font-mono text-[10px] uppercase tracking-wider text-zinc-400">style · outfit · trend · cost/wear</span>
      </header>

      <div className="grid grid-cols-1 md:grid-cols-2 gap-2">
        <div>
          <label className="text-[10px] uppercase tracking-wider text-purple-400 font-semibold">Style profile JSON</label>
          <textarea value={styleText} onChange={(e) => setStyleText(e.target.value)} rows={5} className="w-full bg-zinc-900 border border-zinc-800 rounded px-3 py-1 text-[10px] text-white font-mono mt-1" />
        </div>
        <div>
          <label className="text-[10px] uppercase tracking-wider text-pink-400 font-semibold">Outfit JSON</label>
          <textarea value={outfitText} onChange={(e) => setOutfitText(e.target.value)} rows={5} className="w-full bg-zinc-900 border border-zinc-800 rounded px-3 py-1 text-[10px] text-white font-mono mt-1" />
        </div>
        <div>
          <label className="text-[10px] uppercase tracking-wider text-blue-400 font-semibold">Trends JSON</label>
          <textarea value={trendText} onChange={(e) => setTrendText(e.target.value)} rows={5} className="w-full bg-zinc-900 border border-zinc-800 rounded px-3 py-1 text-[10px] text-white font-mono mt-1" />
        </div>
        <div>
          <label className="text-[10px] uppercase tracking-wider text-green-400 font-semibold">CPW items JSON</label>
          <textarea value={cpwText} onChange={(e) => setCpwText(e.target.value)} rows={5} className="w-full bg-zinc-900 border border-zinc-800 rounded px-3 py-1 text-[10px] text-white font-mono mt-1" />
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
        {styleResult && (
          <div className="rounded-md border border-purple-500/30 bg-purple-500/5 p-2.5 max-h-44 overflow-y-auto">
            <div className="text-[10px] uppercase tracking-wider text-purple-300 font-semibold">Style · {styleResult.style}</div>
            <div className="text-2xl font-bold text-purple-200">{styleResult.wardrobeSize}</div>
            <div className="text-[10px] text-zinc-500">{styleResult.bodyType} · {styleResult.budget}</div>
            <div className="text-[10px] text-zinc-300 mt-1">Colors:</div>
            <div className="flex flex-wrap gap-1 mt-0.5">{styleResult.dominantColors.map((c, i) => <span key={i} className="px-1.5 py-0.5 rounded bg-zinc-800 text-[9px] text-purple-200">{c.color} ({c.count})</span>)}</div>
            {Object.entries(styleResult.categoryBreakdown).map(([k, v], i) => <div key={i} className="text-[10px] text-zinc-300 mt-0.5 flex justify-between"><span>{k}</span><span className="font-mono text-purple-200">{v}</span></div>)}
          </div>
        )}
        {outfitResult && (
          <div className="rounded-md border border-pink-500/30 bg-pink-500/5 p-2.5 max-h-44 overflow-y-auto">
            <div className="text-[10px] uppercase tracking-wider text-pink-300 font-semibold">Outfits · {outfitResult.occasion}</div>
            <div className="text-2xl font-bold text-pink-200">{outfitResult.suggestions.length}</div>
            <div className="text-[10px] text-zinc-500">{outfitResult.season} · {outfitResult.wardrobeSize} pieces</div>
            {outfitResult.suggestions.slice(0, 4).map((o, i) => <div key={i} className="text-[10px] text-zinc-300 mt-1">{o.note ?? `${o.top ?? '—'} + ${o.bottom ?? '—'}${o.outerwear ? ` + ${o.outerwear}` : ''}`}</div>)}
            {outfitResult.missingPieces.length > 0 && <div className="text-[10px] text-amber-200 mt-1">⚠ Missing: {outfitResult.missingPieces.join(', ')}</div>}
          </div>
        )}
        {trendResult && (
          <div className="rounded-md border border-blue-500/30 bg-blue-500/5 p-2.5 max-h-44 overflow-y-auto">
            <div className="text-[10px] uppercase tracking-wider text-blue-300 font-semibold">Trends</div>
            <div className="text-2xl font-bold text-blue-200">{trendResult.totalTrends}</div>
            <div className="text-[10px] text-zinc-300">across {trendResult.categories} categories</div>
            <div className="text-[10px] text-emerald-200 mt-1">★ {trendResult.hottest}</div>
            {trendResult.byCategory.slice(0, 5).map((c, i) => <div key={i} className="text-[10px] text-zinc-300 mt-0.5 flex justify-between"><span>{c.category}</span><span className="font-mono text-blue-200">{c.trending}/{c.count}</span></div>)}
          </div>
        )}
        {cpwResult && (
          <div className="rounded-md border border-green-500/30 bg-green-500/5 p-2.5 max-h-44 overflow-y-auto">
            <div className="text-[10px] uppercase tracking-wider text-green-300 font-semibold">CPW</div>
            <div className="text-2xl font-bold text-emerald-200">${cpwResult.avgCostPerWear}<span className="text-xs text-zinc-400">/wear</span></div>
            <div className="text-[10px] text-zinc-500">Best: {cpwResult.bestValue} · worst: {cpwResult.worstValue}</div>
            {cpwResult.items.slice(0, 5).map((it, i) => <div key={i} className="text-[10px] text-zinc-300 mt-0.5 flex justify-between"><span className="truncate">{it.name} (×{it.wears})</span><span className={cn('font-mono text-[9px]', VALUE_COLOR[it.value])}>${it.costPerWear}</span></div>)}
            <div className="text-[10px] text-green-200 mt-1 italic">{cpwResult.tip}</div>
          </div>
        )}
      </div>

      {agentReply && (<div className="rounded-md border border-yellow-500/30 bg-yellow-500/5 p-3 max-h-60 overflow-y-auto"><div className="flex items-center gap-1.5 text-yellow-400 font-semibold mb-1.5 uppercase tracking-wider text-[10px]"><Wand2 className="w-3 h-3" /> Personal stylist</div><pre className="whitespace-pre-wrap font-sans text-[11px] text-zinc-200 leading-relaxed">{agentReply}</pre></div>)}

      <AnimatePresence>
        {feedback && (<motion.div key={feedback.text} initial={{ opacity: 0, y: -2 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: -2 }} className={cn('px-3 py-2 rounded text-[11px] flex items-start gap-2 border', feedback.kind === 'ok' ? 'bg-emerald-500/10 text-emerald-300 border-emerald-500/30' : 'bg-red-500/10 text-red-300 border-red-500/30')}>{feedback.kind === 'ok' ? <Check className="h-3 w-3 mt-0.5" /> : <AlertTriangle className="h-3 w-3 mt-0.5" />}<span>{feedback.text}</span></motion.div>)}
      </AnimatePresence>
    </div>
  );
}
