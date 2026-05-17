'use client';

/**
 * CookingActionPanel — home cook bench.
 * usda-search (FoodData Central) / scaleRecipe / nutritionEstimate /
 * substitution + mint/DM/publish/agent.
 */

import { useState } from 'react';
import { ChefHat, Apple, Calculator, Shuffle, Sparkles, Send, Globe, Wand2, Loader2, Check, AlertTriangle } from 'lucide-react';
import { motion, AnimatePresence } from 'framer-motion';
import { api, apiHelpers } from '@/lib/api/client';
import { cn } from '@/lib/utils';

interface MacroEnvelope<T> { ok: boolean; result?: T; error?: string }
async function callMacro<T>(action: string, input: Record<string, unknown>): Promise<MacroEnvelope<T>> {
  const r = await apiHelpers.lens.runDomain('cooking', action, { input });
  const data = (r as { data?: { ok: boolean; result?: T } }).data;
  if (!data) return { ok: false, error: 'empty response' };
  if (data.ok && data.result && typeof data.result === 'object' && 'ok' in data.result) return data.result as MacroEnvelope<T>;
  return data as MacroEnvelope<T>;
}

type Feedback = { kind: 'ok' | 'err'; text: string } | null;
type ActionId = 'usda' | 'scale' | 'nutr' | 'sub' | 'mint' | 'dm' | 'publish' | 'agent';
function pickMessage(e: unknown): string { const ax = e as { response?: { data?: { error?: string } }; message?: string }; return ax?.response?.data?.error ?? ax?.message ?? 'request failed'; }

interface Food { fdcId: number; description: string; dataType?: string; brandOwner?: string; servingSize?: number; servingSizeUnit?: string }
interface UsdaResult { foods: Food[]; count: number; totalHits?: number }
interface ScaledIng { name: string; original: string; scaled: string }
interface ScaleResult { recipe: string; baseServings: number; targetServings: number; scaleFactor: number; ingredients: ScaledIng[] }
interface NutrResult { totalCalories: number; perServing: number; macros: { protein: string; carbs: string; fat: string }; servings: number; note?: string }
interface Sub { sub: string; ratio: string; note?: string }
interface SubResult { ingredient: string; substitutions: Sub[]; found: boolean }

const DEMO_RECIPE = JSON.stringify({
  name: 'Chocolate chip cookies',
  servings: 24,
  targetServings: 48,
  ingredients: [
    { name: 'flour', quantity: '2.25', unit: 'cup', grams: 280 },
    { name: 'butter', quantity: '1', unit: 'cup', grams: 226 },
    { name: 'sugar', quantity: '0.75', unit: 'cup', grams: 150 },
    { name: 'egg', quantity: '2', unit: 'large', grams: 100 },
    { name: 'chocolate chips', quantity: '2', unit: 'cup', grams: 340 },
  ],
}, null, 2);

export function CookingActionPanel() {
  const [foodQuery, setFoodQuery] = useState('quinoa');
  const [recipeText, setRecipeText] = useState(DEMO_RECIPE);
  const [substitute, setSubstitute] = useState('butter');
  const [recipient, setRecipient] = useState('');

  const [busy, setBusy] = useState<ActionId | null>(null);
  const [feedback, setFeedback] = useState<Feedback>(null);
  const [usdaResult, setUsdaResult] = useState<UsdaResult | null>(null);
  const [scaleResult, setScaleResult] = useState<ScaleResult | null>(null);
  const [nutrResult, setNutrResult] = useState<NutrResult | null>(null);
  const [subResult, setSubResult] = useState<SubResult | null>(null);
  const [mintedDtuId, setMintedDtuId] = useState<string | null>(null);
  const [publishedDtuId, setPublishedDtuId] = useState<string | null>(null);
  const [agentReply, setAgentReply] = useState<string | null>(null);

  const ok = (m: string) => setFeedback({ kind: 'ok', text: m });
  const err = (m: string) => setFeedback({ kind: 'err', text: m });

  async function actUsda() {
    if (!foodQuery.trim()) { err('Query required.'); return; }
    setBusy('usda'); setFeedback(null);
    try { const r = await callMacro<UsdaResult>('usda-search', { query: foodQuery.trim(), pageSize: 8 }); if (r.ok && r.result) { setUsdaResult(r.result); ok(`${r.result.count} of ${r.result.totalHits} foods.`); } else err(r.error ?? 'usda failed'); }
    catch (e) { err(pickMessage(e)); } finally { setBusy(null); }
  }
  async function actScale() {
    try { const parsed = JSON.parse(recipeText); setBusy('scale'); setFeedback(null);
      const r = await callMacro<ScaleResult>('scaleRecipe', { artifact: { data: parsed } }); if (r.ok && r.result) { setScaleResult(r.result); ok(`Scaled ${r.result.scaleFactor}× to ${r.result.targetServings}.`); } else err(r.error ?? 'scale failed');
    } catch (e) { err(e instanceof SyntaxError ? 'Invalid recipe JSON.' : pickMessage(e)); } finally { setBusy(null); }
  }
  async function actNutr() {
    try { const parsed = JSON.parse(recipeText); setBusy('nutr'); setFeedback(null);
      const r = await callMacro<NutrResult>('nutritionEstimate', { artifact: { data: parsed } }); if (r.ok && r.result) { setNutrResult(r.result); ok(`${r.result.perServing} cal/serving.`); } else err(r.error ?? 'nutr failed');
    } catch (e) { err(e instanceof SyntaxError ? 'Invalid recipe JSON.' : pickMessage(e)); } finally { setBusy(null); }
  }
  async function actSub() {
    if (!substitute.trim()) { err('Ingredient required.'); return; }
    setBusy('sub'); setFeedback(null);
    try { const r = await callMacro<SubResult>('substitution', { artifact: { data: { ingredient: substitute.trim() } } }); if (r.ok && r.result) { setSubResult(r.result); ok(`${r.result.substitutions.length} subs.`); } else err(r.error ?? 'sub failed'); }
    catch (e) { err(pickMessage(e)); } finally { setBusy(null); }
  }
  async function actMint() {
    setBusy('mint'); setFeedback(null);
    try {
      const r = await api.post('/api/lens/run', { domain: 'dtu', name: 'create', input: { title: `Recipe — ${scaleResult?.recipe ?? 'cooking'}`, tags: ['cooking', 'recipe'], source: 'cooking:recipe:mint', meta: { visibility: 'private', consent: { allowCitations: false }, cook: { usda: usdaResult, scale: scaleResult, nutr: nutrResult, sub: subResult } } } });
      const id = r.data?.result?.dtu?.id ?? r.data?.dtu?.id ?? r.data?.result?.id;
      if (id) { setMintedDtuId(id); ok(`Recipe DTU ${id.slice(0, 8)}…`); } else err('No DTU id.');
    } catch (e) { err(pickMessage(e)); } finally { setBusy(null); }
  }
  async function actDm() {
    if (!recipient.trim()) { err('Recipient required.'); return; }
    setBusy('dm'); setFeedback(null);
    const body = [`👨‍🍳 Recipe brief`, '', scaleResult ? `${scaleResult.recipe}: scaled ${scaleResult.baseServings}→${scaleResult.targetServings} (${scaleResult.scaleFactor}×)` : '', nutrResult ? `Nutrition: ${nutrResult.perServing} cal/serving · ${nutrResult.macros.protein} P / ${nutrResult.macros.carbs} C / ${nutrResult.macros.fat} F` : '', subResult?.substitutions[0] ? `${subResult.ingredient} sub: ${subResult.substitutions[0].sub} (${subResult.substitutions[0].ratio})` : '', usdaResult?.foods[0] ? `USDA: ${usdaResult.foods[0].description}` : '', mintedDtuId ? `\n[DTU ${mintedDtuId}]` : ''].filter(Boolean).join('\n');
    try { const r = await api.post('/api/social/dm', { toUserId: recipient.trim(), content: body }); if (r.data?.ok !== false) { ok('Sent.'); setRecipient(''); } else err(r.data?.error ?? 'send failed'); }
    catch (e) { err(pickMessage(e)); } finally { setBusy(null); }
  }
  async function actPublish() {
    if (!scaleResult) { err('Run scale first.'); return; }
    setBusy('publish'); setFeedback(null);
    try {
      const r = await api.post('/api/lens/run', { domain: 'dtu', name: 'create', input: { title: `Recipe — ${scaleResult.recipe}`, tags: ['cooking', 'recipe', 'public'], source: 'cooking:recipe:publish', meta: { visibility: 'public', consent: { allowCitations: true }, scale: scaleResult, nutr: nutrResult } } });
      const id = r.data?.result?.dtu?.id ?? r.data?.dtu?.id ?? r.data?.result?.id;
      if (!id) { err('No DTU id.'); return; }
      const pub = await api.post(`/api/dtus/${encodeURIComponent(id)}/publish`);
      if (pub.data?.ok !== false) { setPublishedDtuId(id); ok(`Published ${id.slice(0, 8)}…`); } else err(pub.data?.error ?? 'publish failed');
    } catch (e) { err(pickMessage(e)); } finally { setBusy(null); }
  }
  async function actAgent() {
    setBusy('agent'); setFeedback(null); setAgentReply(null);
    try {
      const task = `Home cook advisor. ${scaleResult ? `Making ${scaleResult.recipe}, ${scaleResult.targetServings} servings.` : ''} ${nutrResult ? `Per serving: ${nutrResult.perServing} cal, ${nutrResult.macros.protein} protein.` : ''} ${subResult?.substitutions[0] ? `Substituting ${subResult.ingredient} with ${subResult.substitutions[0].sub}.` : ''} Suggest one technique tip + one flavor enhancement. Plain text, 3 sentences max.`;
      const r = await api.post('/api/lens/run', { domain: 'chat_agent', name: 'do', input: { task, maxTurns: 3 } });
      const reply = r.data?.result?.reply ?? r.data?.result?.summary ?? r.data?.result?.output ?? r.data?.reply;
      if (reply) { setAgentReply(typeof reply === 'string' ? reply : JSON.stringify(reply, null, 2)); ok('Tips ready.'); } else err('Agent returned empty.');
    } catch (e) { err(pickMessage(e)); } finally { setBusy(null); }
  }

  const actions = [
    { id: 'usda' as ActionId, label: 'USDA', desc: 'FoodData Central', icon: Apple, accent: '#22c55e', handler: actUsda },
    { id: 'scale' as ActionId, label: 'Scale', desc: 'scaleRecipe', icon: ChefHat, accent: '#f59e0b', handler: actScale },
    { id: 'nutr' as ActionId, label: 'Nutrition', desc: 'nutritionEstimate', icon: Calculator, accent: '#3b82f6', handler: actNutr },
    { id: 'sub' as ActionId, label: 'Substitute', desc: 'substitution', icon: Shuffle, accent: '#a855f7', handler: actSub },
    { id: 'mint' as ActionId, label: mintedDtuId ? 'Saved' : 'Mint', desc: mintedDtuId ? `${mintedDtuId.slice(0, 8)}…` : 'Private recipe DTU', icon: Sparkles, accent: '#06b6d4', handler: actMint },
    { id: 'dm' as ActionId, label: 'DM', desc: 'Send recipe brief', icon: Send, accent: '#ec4899', handler: actDm },
    { id: 'publish' as ActionId, label: publishedDtuId ? 'Published' : 'Publish', desc: publishedDtuId ? `${publishedDtuId.slice(0, 8)}…` : 'Public recipe', icon: Globe, accent: '#15803d', handler: actPublish },
    { id: 'agent' as ActionId, label: 'Tips', desc: 'Agent: tech + flavor', icon: Wand2, accent: '#eab308', handler: actAgent },
  ];

  return (
    <div className="rounded-lg border border-amber-500/20 bg-zinc-950/60 p-3 space-y-3">
      <header className="flex items-center gap-2 border-b border-amber-500/10 pb-2">
        <ChefHat className="h-4 w-4 text-amber-400" />
        <h3 className="text-sm font-semibold text-white">Kitchen bench</h3>
        <span className="rounded bg-zinc-800 px-1.5 py-0.5 font-mono text-[10px] uppercase tracking-wider text-zinc-400">USDA FDC · scale · nutrition · subs</span>
      </header>

      <div className="grid grid-cols-1 md:grid-cols-3 gap-2">
        <div className="space-y-1.5">
          <input type="text" value={foodQuery} onChange={(e) => setFoodQuery(e.target.value)} className="w-full bg-zinc-900 border border-zinc-800 rounded px-3 py-1.5 text-[12px] text-white" placeholder="USDA food search" />
          <input type="text" value={substitute} onChange={(e) => setSubstitute(e.target.value)} className="w-full bg-zinc-900 border border-zinc-800 rounded px-3 py-1.5 text-[12px] text-white" placeholder="Ingredient to substitute" />
          <input type="text" value={recipient} onChange={(e) => setRecipient(e.target.value)} className="w-full bg-zinc-900 border border-zinc-800 rounded px-3 py-1.5 text-[12px] text-white" placeholder="DM recipient" />
        </div>
        <div className="md:col-span-2">
          <label className="text-[10px] uppercase tracking-wider text-amber-400 font-semibold">Recipe JSON</label>
          <textarea value={recipeText} onChange={(e) => setRecipeText(e.target.value)} rows={5} className="w-full bg-zinc-900 border border-zinc-800 rounded px-3 py-1 text-[10px] text-white font-mono mt-1" />
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

      <div className="grid grid-cols-1 md:grid-cols-2 gap-2">
        {usdaResult && (
          <div className="rounded-md border border-green-500/30 bg-green-500/5 p-2.5 max-h-60 overflow-y-auto">
            <div className="text-[10px] uppercase tracking-wider text-green-300 font-semibold">USDA · {usdaResult.totalHits} hits</div>
            {usdaResult.foods.slice(0, 8).map((f, i) => <div key={i} className="text-[11px] text-zinc-300 mt-1"><strong className="text-green-200">{f.description}</strong> <span className="font-mono text-zinc-500 text-[10px]">FDC {f.fdcId}</span>{f.brandOwner && <div className="text-[10px] text-zinc-400">{f.brandOwner}</div>}{f.servingSize && <div className="text-[10px] text-zinc-500">serving: {f.servingSize}{f.servingSizeUnit}</div>}</div>)}
          </div>
        )}
        {scaleResult && (
          <div className="rounded-md border border-amber-500/30 bg-amber-500/5 p-2.5 max-h-60 overflow-y-auto">
            <div className="text-[10px] uppercase tracking-wider text-amber-300 font-semibold">{scaleResult.recipe}</div>
            <div className="text-[11px] text-zinc-300">scaled <span className="text-amber-200 font-mono">{scaleResult.scaleFactor}×</span> · {scaleResult.baseServings} → {scaleResult.targetServings}</div>
            {scaleResult.ingredients.map((i, idx) => <div key={idx} className="text-[10px] text-zinc-300 mt-0.5"><strong>{i.name}:</strong> <span className="text-zinc-500 line-through">{i.original}</span> → <span className="text-amber-200 font-mono">{i.scaled}</span></div>)}
          </div>
        )}
        {nutrResult && (
          <div className="rounded-md border border-blue-500/30 bg-blue-500/5 p-2.5">
            <div className="text-[10px] uppercase tracking-wider text-blue-300 font-semibold">Nutrition · {nutrResult.servings} servings</div>
            <div className="text-2xl font-bold text-blue-300">{nutrResult.perServing}<span className="text-xs text-zinc-400"> cal/serving</span></div>
            <div className="text-[10px] text-zinc-500">total {nutrResult.totalCalories} cal</div>
            <div className="text-[10px] text-blue-200">P {nutrResult.macros.protein} · C {nutrResult.macros.carbs} · F {nutrResult.macros.fat}</div>
            {nutrResult.note && <div className="text-[10px] text-zinc-500 italic">{nutrResult.note}</div>}
          </div>
        )}
        {subResult && (
          <div className="rounded-md border border-purple-500/30 bg-purple-500/5 p-2.5">
            <div className="text-[10px] uppercase tracking-wider text-purple-300 font-semibold">{subResult.ingredient} subs · {subResult.found ? '✓ found' : '✗ none'}</div>
            {subResult.substitutions.map((s, i) => <div key={i} className="text-[11px] text-zinc-300 mt-1"><strong className="text-purple-200">{s.sub}</strong> <span className="font-mono text-zinc-500">{s.ratio}</span>{s.note && <div className="text-[10px] text-zinc-500 italic">{s.note}</div>}</div>)}
          </div>
        )}
      </div>

      {agentReply && (<div className="rounded-md border border-yellow-500/30 bg-yellow-500/5 p-3 max-h-60 overflow-y-auto"><div className="flex items-center gap-1.5 text-yellow-400 font-semibold mb-1.5 uppercase tracking-wider text-[10px]"><Wand2 className="w-3 h-3" /> Chef tips</div><pre className="whitespace-pre-wrap font-sans text-[11px] text-zinc-200 leading-relaxed">{agentReply}</pre></div>)}

      <AnimatePresence>
        {feedback && (<motion.div key={feedback.text} initial={{ opacity: 0, y: -2 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: -2 }} className={cn('px-3 py-2 rounded text-[11px] flex items-start gap-2 border', feedback.kind === 'ok' ? 'bg-emerald-500/10 text-emerald-300 border-emerald-500/30' : 'bg-red-500/10 text-red-300 border-red-500/30')}>{feedback.kind === 'ok' ? <Check className="h-3 w-3 mt-0.5" /> : <AlertTriangle className="h-3 w-3 mt-0.5" />}<span>{feedback.text}</span></motion.div>)}
      </AnimatePresence>
    </div>
  );
}
