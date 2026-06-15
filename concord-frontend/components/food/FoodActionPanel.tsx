'use client';

/**
 * FoodActionPanel — Yummly + restaurant-POS-shape kitchen workbench.
 * Surfaces scaleRecipe / costPlate / suggestMeals / wasteReport plus
 * mint/DM/publish/agent.
 */

import { useState } from 'react';
import {
  ChefHat, Scale, DollarSign, UtensilsCrossed, Trash2,
  Sparkles, Send, Globe, Wand2,
  Loader2, Check, AlertTriangle,
} from 'lucide-react';
import { motion, AnimatePresence } from 'framer-motion';
import { api, apiHelpers, lensRun } from '@/lib/api/client';
import { cn } from '@/lib/utils';
import { usePipe, useRecallableAction, RecallSlot } from '@/components/panel-polish';

interface MacroEnvelope<T> { ok: boolean; result?: T; error?: string }
async function callMacro<T>(action: string, input: Record<string, unknown>): Promise<MacroEnvelope<T>> {
  const r = await apiHelpers.lens.runDomain('food', action, { input });
  const data = (r as { data?: { ok: boolean; result?: T } }).data;
  if (!data) return { ok: false, error: 'empty response' };
  if (data.ok && data.result && typeof data.result === 'object' && 'ok' in data.result) {
    return data.result as MacroEnvelope<T>;
  }
  return data as MacroEnvelope<T>;
}

type Feedback = { kind: 'ok' | 'err'; text: string } | null;
type ActionId = 'scale' | 'cost' | 'suggest' | 'waste' | 'mint' | 'dm' | 'publish' | 'agent';

function pickMessage(e: unknown): string {
  const ax = e as { response?: { data?: { error?: string } }; message?: string };
  return ax?.response?.data?.error ?? ax?.message ?? 'request failed';
}

interface ScaleResult { servings?: number; ingredients?: Array<{ name: string; quantity: number; unit: string }> }
interface CostResult { totalCost?: number; perPlate?: number; ingredientCosts?: Array<{ ingredient: string; cost: number }> }
interface SuggestResult { meals?: Array<{ name: string; cuisine?: string; matchScore?: number }>; matched?: number }
interface WasteResult { weeklyWasteKg?: number; topWasted?: string[]; suggestion?: string }

export function FoodActionPanel() {
  const [recipeName, setRecipeName] = useState('');
  const [recipeIngredients, setRecipeIngredients] = useState('');
  const [recipeServings, setRecipeServings] = useState('');
  const [scaleTo, setScaleTo] = useState('');
  const [pantry, setPantry] = useState('');
  const [recipient, setRecipient] = useState('');

  const [busy, setBusy] = useState<ActionId | null>(null);
  const [feedback, setFeedback] = useState<Feedback>(null);
  const [scaleResult, setScaleResult] = useState<ScaleResult | null>(null);
  const [costResult, setCostResult] = useState<CostResult | null>(null);
  const [suggestResult, setSuggestResult] = useState<SuggestResult | null>(null);
  const [wasteResult, setWasteResult] = useState<WasteResult | null>(null);
  const [mintedDtuId, setMintedDtuId] = useState<string | null>(null);
  const [publishedDtuId, setPublishedDtuId] = useState<string | null>(null);
  const [agentReply, setAgentReply] = useState<string | null>(null);

  const ok = (t: string) => setFeedback({ kind: 'ok', text: t });
  const err = (t: string) => setFeedback({ kind: 'err', text: t });

  const pipe = usePipe();
  const dmRecall = useRecallableAction({ label: 'DM', windowMs: 60_000, onUndo: async (id) => { await api.delete(`/api/social/dm/${encodeURIComponent(id)}`); } });
  const publishRecall = useRecallableAction({ label: 'publish', windowMs: 30_000, onUndo: async (id) => { await api.delete(`/api/dtus/${encodeURIComponent(id)}/publish`); setPublishedDtuId(null); } });

  function parseIngredients() {
    return recipeIngredients.split('\n').map(l => {
      const m = l.trim().match(/^(.+?)\s+([\d.]+)\s+(\S+)$/);
      return m ? { name: m[1], quantity: parseFloat(m[2]), unit: m[3] } : null;
    }).filter(Boolean) as Array<{ name: string; quantity: number; unit: string }>;
  }

  async function actScale() {
    const ing = parseIngredients();
    if (!ing.length) { err('Add ingredients.'); return; }
    setBusy('scale'); setFeedback(null);
    try {
      const r = await callMacro<ScaleResult>('scaleRecipe', { ingredients: ing, originalServings: parseInt(recipeServings, 10), targetServings: parseInt(scaleTo, 10) });
      if (r.ok && r.result) { setScaleResult(r.result); pipe.publish('food.scale', r.result, { label: `Scaled to ${scaleTo}` }); ok(`Scaled to ${scaleTo} servings.`); } else err(r.error ?? 'scale failed');
    } catch (e) { err(pickMessage(e)); } finally { setBusy(null); }
  }
  async function actCost() {
    const ing = parseIngredients();
    if (!ing.length) { err('Add ingredients.'); return; }
    setBusy('cost'); setFeedback(null);
    try {
      const r = await callMacro<CostResult>('costPlate', { ingredients: ing, servings: parseInt(recipeServings, 10) });
      if (r.ok && r.result) { setCostResult(r.result); pipe.publish('food.cost', r.result, { label: `$${r.result.perPlate?.toFixed(2)}/plate` }); ok(`Per plate: $${r.result.perPlate?.toFixed(2)}.`); } else err(r.error ?? 'cost failed');
    } catch (e) { err(pickMessage(e)); } finally { setBusy(null); }
  }
  async function actSuggest() {
    const items = pantry.split('\n').map(s => s.trim()).filter(Boolean);
    if (!items.length) { err('Add pantry items.'); return; }
    setBusy('suggest'); setFeedback(null);
    try {
      const r = await callMacro<SuggestResult>('suggestMeals', { pantry: items.map(name => ({ name })) });
      if (r.ok && r.result) { setSuggestResult(r.result); pipe.publish('food.suggest', r.result, { label: `${r.result.meals?.length ?? 0} meals` }); ok(`${r.result.meals?.length ?? 0} meals suggested.`); } else err(r.error ?? 'suggest failed');
    } catch (e) { err(pickMessage(e)); } finally { setBusy(null); }
  }
  async function actWaste() {
    setBusy('waste'); setFeedback(null);
    try {
      const r = await callMacro<WasteResult>('wasteReport', { window: 'week' });
      if (r.ok && r.result) { setWasteResult(r.result); pipe.publish('food.waste', r.result, { label: `Waste ${r.result.weeklyWasteKg}kg` }); ok(`Waste: ${r.result.weeklyWasteKg}kg.`); } else err(r.error ?? 'waste failed');
    } catch (e) { err(pickMessage(e)); } finally { setBusy(null); }
  }
  async function actMint() {
    setBusy('mint'); setFeedback(null);
    try {
      const r = await lensRun({ domain: 'dtu', name: 'create', input: { title: `Recipe — ${recipeName.trim() || 'untitled'}`, tags: ['food', 'recipe', `servings:${recipeServings}`], source: 'food:recipe:mint', meta: { visibility: 'private', consent: { allowCitations: false }, recipe: { name: recipeName, ingredients: parseIngredients(), servings: parseInt(recipeServings, 10), scaled: scaleResult, costed: costResult } } } });
      const id = r.data?.result?.dtu?.id ?? r.data?.result?.id;
      if (id) { setMintedDtuId(id); pipe.publish('food.mintedDtuId', id, { label: `Recipe DTU ${id.slice(0, 8)}…` }); ok(`Recipe DTU ${id.slice(0, 8)}…`); } else err('No DTU id.');
    } catch (e) { err(pickMessage(e)); } finally { setBusy(null); }
  }
  async function actDm() {
    if (!recipient.trim()) { err('Recipient required.'); return; }
    setBusy('dm'); setFeedback(null);
    const body = [`🍳 Recipe: ${recipeName || 'untitled'}`, `Servings: ${recipeServings}`, '', ...parseIngredients().map(i => `  ${i.name} ${i.quantity} ${i.unit}`), '', costResult ? `Per plate: $${costResult.perPlate?.toFixed(2)}` : '', mintedDtuId ? `\n[DTU ${mintedDtuId}]` : ''].filter(Boolean).join('\n');
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
    setBusy('publish'); setFeedback(null);
    try {
      const id = await publishRecall.run(async () => {
        const r = await lensRun({ domain: 'dtu', name: 'create', input: { title: `Public recipe — ${recipeName.trim() || 'untitled'}`, tags: ['food', 'recipe', 'public'], source: 'food:recipe:publish', meta: { visibility: 'public', consent: { allowCitations: true }, recipe: { name: recipeName, ingredients: parseIngredients(), servings: parseInt(recipeServings, 10) } } } });
        const newId = r.data?.result?.dtu?.id ?? r.data?.result?.id;
        if (!newId) throw new Error('No DTU id.');
        const pub = await api.post(`/api/dtus/${encodeURIComponent(newId)}/publish`);
        if (pub.data?.ok === false) throw new Error(pub.data?.error ?? 'publish failed');
        return newId as string;
      });
      if (id) { setPublishedDtuId(id); pipe.publish('food.publishedDtuId', id, { label: `Public recipe ${id.slice(0, 8)}…` }); ok(`Published ${id.slice(0, 8)}… · 30s to recall.`); }
    } catch (e) { err(pickMessage(e)); } finally { setBusy(null); }
  }
  async function actAgent() {
    setBusy('agent'); setFeedback(null); setAgentReply(null);
    try {
      const task = `Recipe: "${recipeName || 'untitled'}", ${recipeServings} servings. Ingredients: ${parseIngredients().map(i => `${i.name} ${i.quantity}${i.unit}`).join(', ')}. ${costResult ? `Per plate $${costResult.perPlate?.toFixed(2)}.` : ''} Suggest 3 substitutions that lower cost without sacrificing flavour. Plain text, one per line.`;
      const r = await lensRun({ domain: 'chat_agent', name: 'do', input: { task, maxTurns: 3 } });
      const reply = r.data?.result?.reply ?? r.data?.result?.summary ?? r.data?.result?.output;
      if (reply) { setAgentReply(typeof reply === 'string' ? reply : JSON.stringify(reply, null, 2)); ok('Substitutions ready.'); } else err('Agent returned empty.');
    } catch (e) { err(pickMessage(e)); } finally { setBusy(null); }
  }

  const actions = [
    { id: 'scale' as ActionId, label: 'Scale', desc: 'scaleRecipe to target servings', icon: Scale, accent: '#06b6d4', handler: actScale },
    { id: 'cost' as ActionId, label: 'Cost', desc: 'costPlate per-serving cost', icon: DollarSign, accent: '#22c55e', handler: actCost },
    { id: 'suggest' as ActionId, label: 'Suggest', desc: 'suggestMeals from pantry', icon: UtensilsCrossed, accent: '#8b5cf6', handler: actSuggest },
    { id: 'waste' as ActionId, label: 'Waste', desc: 'wasteReport weekly', icon: Trash2, accent: '#ef4444', handler: actWaste },
    { id: 'mint' as ActionId, label: mintedDtuId ? 'Saved' : 'Mint', desc: mintedDtuId ? `${mintedDtuId.slice(0, 8)}…` : 'Private recipe DTU', icon: Sparkles, accent: '#3b82f6', handler: actMint },
    { id: 'dm' as ActionId, label: 'DM', desc: 'Send recipe to user', icon: Send, accent: '#ec4899', handler: actDm },
    { id: 'publish' as ActionId, label: publishedDtuId ? 'Published' : 'Publish', desc: publishedDtuId ? `${publishedDtuId.slice(0, 8)}…` : 'Public recipe DTU + federation', icon: Globe, accent: '#15803d', handler: actPublish },
    { id: 'agent' as ActionId, label: 'Subs', desc: 'Agent: 3 cost-cutting subs', icon: Wand2, accent: '#eab308', handler: actAgent },
  ];

  return (
    <div className="rounded-lg border border-orange-500/20 bg-zinc-950/60 p-3 space-y-3">
      <header className="flex items-center gap-2 border-b border-orange-500/10 pb-2">
        <ChefHat className="h-4 w-4 text-orange-400" />
        <h3 className="text-sm font-semibold text-white">Kitchen workbench</h3>
      </header>

      <div className="grid grid-cols-1 md:grid-cols-5 gap-2">
        <input type="text" value={recipeName} onChange={(e) => setRecipeName(e.target.value)} className="md:col-span-2 bg-zinc-900 border border-zinc-800 rounded px-3 py-1.5 text-[12px] text-white" placeholder="Recipe name" />
        <input type="text" value={recipeServings} onChange={(e) => setRecipeServings(e.target.value.replace(/\D/g, ''))} className="bg-zinc-900 border border-zinc-800 rounded px-3 py-1.5 text-[12px] text-white font-mono" placeholder="Servings" />
        <input type="text" value={scaleTo} onChange={(e) => setScaleTo(e.target.value.replace(/\D/g, ''))} className="bg-zinc-900 border border-zinc-800 rounded px-3 py-1.5 text-[12px] text-white font-mono" placeholder="Scale to" />
        <input type="text" value={recipient} onChange={(e) => setRecipient(e.target.value)} className="bg-zinc-900 border border-zinc-800 rounded px-3 py-1.5 text-[12px] text-white" placeholder="DM recipient" />
      </div>
      <div className="flex items-center gap-2 flex-wrap">
        <RecallSlot ctl={dmRecall} />
        <RecallSlot ctl={publishRecall} />
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 gap-2">
        <div><label className="text-[10px] uppercase tracking-wider text-zinc-400 font-semibold mb-1 block">Ingredients (name qty unit per line)</label><textarea value={recipeIngredients} onChange={(e) => setRecipeIngredients(e.target.value)} rows={5} className="w-full bg-zinc-900 border border-zinc-800 rounded px-2 py-1 text-[11px] text-orange-200 font-mono focus:outline-none focus:ring-2 focus:ring-orange-400/40 resize-none" /></div>
        <div><label className="text-[10px] uppercase tracking-wider text-zinc-400 font-semibold mb-1 block">Pantry (one per line)</label><textarea value={pantry} onChange={(e) => setPantry(e.target.value)} rows={5} className="w-full bg-zinc-900 border border-zinc-800 rounded px-2 py-1 text-[11px] text-orange-200 font-mono focus:outline-none focus:ring-2 focus:ring-orange-400/40 resize-none" /></div>
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
        {scaleResult?.ingredients && (
          <div className="rounded-md border border-cyan-500/30 bg-cyan-500/5 p-2.5">
            <div className="text-[10px] uppercase tracking-wider text-cyan-300 font-semibold mb-1">Scaled to {scaleResult.servings}</div>
            {scaleResult.ingredients.slice(0, 8).map((i, idx) => <div key={idx} className="text-[11px] text-zinc-300 font-mono">{i.name}: {i.quantity} {i.unit}</div>)}
          </div>
        )}
        {costResult && (
          <div className="rounded-md border border-emerald-500/30 bg-emerald-500/5 p-2.5">
            <div className="text-[10px] uppercase tracking-wider text-emerald-300 font-semibold">Cost</div>
            <div className="text-2xl font-bold text-emerald-300">${costResult.perPlate?.toFixed(2)}<span className="text-xs text-zinc-400 ml-1">/plate</span></div>
            <div className="text-[10px] text-zinc-400">total ${costResult.totalCost?.toFixed(2)}</div>
          </div>
        )}
        {suggestResult?.meals && (
          <div className="rounded-md border border-purple-500/30 bg-purple-500/5 p-2.5 max-h-40 overflow-y-auto">
            <div className="text-[10px] uppercase tracking-wider text-purple-300 font-semibold">Suggested ({suggestResult.matched})</div>
            {suggestResult.meals.slice(0, 6).map((m, i) => <div key={i} className="text-[11px] text-zinc-300">{m.name}{m.cuisine && <span className="text-zinc-400"> · {m.cuisine}</span>}{m.matchScore != null && <span className="text-purple-300 ml-1 font-mono">{Math.round(m.matchScore * 100)}%</span>}</div>)}
          </div>
        )}
        {wasteResult && (
          <div className="rounded-md border border-rose-500/30 bg-rose-500/5 p-2.5">
            <div className="text-[10px] uppercase tracking-wider text-rose-300 font-semibold">Waste</div>
            <div className="text-2xl font-bold text-rose-300">{wasteResult.weeklyWasteKg}kg<span className="text-xs text-zinc-400 ml-1">/wk</span></div>
            {wasteResult.suggestion && <div className="text-[11px] text-zinc-400 italic">{wasteResult.suggestion}</div>}
          </div>
        )}
      </div>

      {agentReply && (
        <div className="rounded-md border border-yellow-500/30 bg-yellow-500/5 p-3 max-h-60 overflow-y-auto">
          <div className="flex items-center gap-1.5 text-yellow-400 font-semibold mb-1.5 uppercase tracking-wider text-[10px]"><Wand2 className="w-3 h-3" /> Substitutions</div>
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
