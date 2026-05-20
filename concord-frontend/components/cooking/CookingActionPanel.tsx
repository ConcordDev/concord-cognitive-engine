'use client';

/**
 * CookingActionPanel — home cook bench.
 * usda-search (FoodData Central) / scaleRecipe / nutritionEstimate /
 * substitution + mint/DM/publish/agent.
 *
 * Max-polish: structured ingredient editor, pipe publish/import, recall
 * window on DM + publish, USDA result rows promote to ingredient grams.
 */

import { useState } from 'react';
import { ChefHat, Apple, Calculator, Shuffle, Sparkles, Send, Globe, Wand2, Loader2, Check, AlertTriangle, Plus } from 'lucide-react';
import { motion, AnimatePresence } from 'framer-motion';
import { api, apiHelpers, lensRun } from '@/lib/api/client';
import { cn } from '@/lib/utils';
import {
  StructuredArrayEditor,
  type ColumnSpec,
  usePipe,
  PipeImporter,
  useRecallableAction,
  RecallSlot,
  LoadFromSubstrate,
} from '@/components/panel-polish';

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

interface IngRow { name: string; quantity: string; unit: string; grams: number }
interface RecipeDtu { id: string; title?: string; tags?: string[]; meta?: { recipe?: { name?: string; servings?: number; ingredients?: IngRow[] } } }
const ING_COLS: ColumnSpec<IngRow>[] = [
  { key: 'name', label: 'Ingredient', type: 'text', flex: 2 },
  { key: 'quantity', label: 'Qty', type: 'text', width: '4rem' },
  { key: 'unit', label: 'Unit', type: 'text', width: '5rem', defaultValue: 'g' },
  { key: 'grams', label: 'Grams', type: 'number', width: '5rem', step: 1, min: 0, defaultValue: 100 },
];

export function CookingActionPanel() {
  const pipe = usePipe();

  const [foodQuery, setFoodQuery] = useState('');
  const [recipeName, setRecipeName] = useState('');
  const [baseServings, setBaseServings] = useState(1);
  const [targetServings, setTargetServings] = useState(1);
  const [ingredients, setIngredients] = useState<IngRow[]>([]);
  const [substitute, setSubstitute] = useState('');
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

  const recipeFor = (override?: Partial<{ targetServings: number }>) => ({
    name: recipeName,
    servings: baseServings,
    targetServings: override?.targetServings ?? targetServings,
    ingredients,
  });

  const dmRecall = useRecallableAction({
    label: 'DM',
    windowMs: 60_000,
    onUndo: async (messageId) => { await api.delete(`/api/social/dm/${encodeURIComponent(messageId)}`); },
  });
  const publishRecall = useRecallableAction({
    label: 'publish',
    windowMs: 30_000,
    onUndo: async (dtuId) => {
      await api.delete(`/api/dtus/${encodeURIComponent(dtuId)}/publish`);
      setPublishedDtuId(null);
    },
  });

  async function actUsda() {
    if (!foodQuery.trim()) { err('Query required.'); return; }
    setBusy('usda'); setFeedback(null);
    try {
      const r = await callMacro<UsdaResult>('usda-search', { query: foodQuery.trim(), pageSize: 8 });
      if (r.ok && r.result) {
        setUsdaResult(r.result);
        pipe.publish('cooking.usda', r.result, { label: `USDA: ${r.result.foods[0]?.description ?? foodQuery}` });
        ok(`${r.result.count} of ${r.result.totalHits} foods.`);
      } else err(r.error ?? 'usda failed');
    } catch (e) { err(pickMessage(e)); } finally { setBusy(null); }
  }
  async function actScale() {
    if (ingredients.length === 0) { err('Add ingredients or "Load recipe" first.'); return; }
    if (!recipeName.trim()) { err('Recipe name required.'); return; }
    setBusy('scale'); setFeedback(null);
    try {
      const r = await callMacro<ScaleResult>('scaleRecipe', { artifact: { data: recipeFor() } });
      if (r.ok && r.result) {
        setScaleResult(r.result);
        pipe.publish('cooking.scale', r.result, { label: `Scaled ${r.result.scaleFactor}×` });
        ok(`Scaled ${r.result.scaleFactor}× to ${r.result.targetServings}.`);
      } else err(r.error ?? 'scale failed');
    } catch (e) { err(pickMessage(e)); } finally { setBusy(null); }
  }
  async function actNutr() {
    if (ingredients.length === 0) { err('Add ingredients first.'); return; }
    setBusy('nutr'); setFeedback(null);
    try {
      const r = await callMacro<NutrResult>('nutritionEstimate', { artifact: { data: recipeFor() } });
      if (r.ok && r.result) {
        setNutrResult(r.result);
        pipe.publish('cooking.nutr', r.result, { label: `${r.result.perServing} cal/serving` });
        ok(`${r.result.perServing} cal/serving.`);
      } else err(r.error ?? 'nutr failed');
    } catch (e) { err(pickMessage(e)); } finally { setBusy(null); }
  }
  async function actSub() {
    if (!substitute.trim()) { err('Ingredient required.'); return; }
    setBusy('sub'); setFeedback(null);
    try {
      const r = await callMacro<SubResult>('substitution', { artifact: { data: { ingredient: substitute.trim() } } });
      if (r.ok && r.result) {
        setSubResult(r.result);
        pipe.publish('cooking.sub', r.result, { label: `${r.result.ingredient} subs` });
        ok(`${r.result.substitutions.length} subs.`);
      } else err(r.error ?? 'sub failed');
    } catch (e) { err(pickMessage(e)); } finally { setBusy(null); }
  }
  async function actMint() {
    setBusy('mint'); setFeedback(null);
    try {
      const r = await lensRun({ domain: 'dtu', name: 'create', input: { title: `Recipe — ${scaleResult?.recipe ?? recipeName}`, tags: ['cooking', 'recipe'], source: 'cooking:recipe:mint', meta: { visibility: 'private', consent: { allowCitations: false }, cook: { usda: usdaResult, scale: scaleResult, nutr: nutrResult, sub: subResult, recipe: recipeFor() } } } });
      const id = r.data?.result?.dtu?.id ?? r.data?.result?.id;
      if (id) {
        setMintedDtuId(id);
        pipe.publish('cooking.mintedDtuId', id, { label: `Recipe DTU ${id.slice(0, 8)}…` });
        ok(`Recipe DTU ${id.slice(0, 8)}…`);
      } else err('No DTU id.');
    } catch (e) { err(pickMessage(e)); } finally { setBusy(null); }
  }
  async function actDm() {
    if (!recipient.trim()) { err('Recipient required.'); return; }
    setBusy('dm'); setFeedback(null);
    const body = [`👨‍🍳 Recipe brief`, '',
      scaleResult ? `${scaleResult.recipe}: scaled ${scaleResult.baseServings}→${scaleResult.targetServings} (${scaleResult.scaleFactor}×)` : '',
      nutrResult ? `Nutrition: ${nutrResult.perServing} cal/serving · ${nutrResult.macros.protein} P / ${nutrResult.macros.carbs} C / ${nutrResult.macros.fat} F` : '',
      subResult?.substitutions[0] ? `${subResult.ingredient} sub: ${subResult.substitutions[0].sub} (${subResult.substitutions[0].ratio})` : '',
      usdaResult?.foods[0] ? `USDA: ${usdaResult.foods[0].description}` : '',
      mintedDtuId ? `\n[DTU ${mintedDtuId}]` : '',
    ].filter(Boolean).join('\n');
    try {
      const messageId = await dmRecall.run(async () => {
        const r = await api.post('/api/social/dm', { toUserId: recipient.trim(), content: body });
        if (r.data?.ok === false) throw new Error(r.data?.error ?? 'send failed');
        const id = r.data?.message?.id;
        if (!id) throw new Error('no message id returned');
        return id as string;
      });
      if (messageId) { ok('Sent. 60s to recall.'); setRecipient(''); }
    } catch (e) { err(pickMessage(e)); } finally { setBusy(null); }
  }
  async function actPublish() {
    if (!scaleResult) { err('Run scale first.'); return; }
    setBusy('publish'); setFeedback(null);
    try {
      const id = await publishRecall.run(async () => {
        const r = await lensRun({ domain: 'dtu', name: 'create', input: { title: `Recipe — ${scaleResult.recipe}`, tags: ['cooking', 'recipe', 'public'], source: 'cooking:recipe:publish', meta: { visibility: 'public', consent: { allowCitations: true }, scale: scaleResult, nutr: nutrResult } } });
        const newId = r.data?.result?.dtu?.id ?? r.data?.result?.id;
        if (!newId) throw new Error('No DTU id.');
        const pub = await api.post(`/api/dtus/${encodeURIComponent(newId)}/publish`);
        if (pub.data?.ok === false) throw new Error(pub.data?.error ?? 'publish failed');
        return newId as string;
      });
      if (id) {
        setPublishedDtuId(id);
        pipe.publish('cooking.publishedDtuId', id, { label: `Public recipe ${id.slice(0, 8)}…` });
        ok(`Published ${id.slice(0, 8)}… · 30s to recall.`);
      }
    } catch (e) { err(pickMessage(e)); } finally { setBusy(null); }
  }
  async function actAgent() {
    setBusy('agent'); setFeedback(null); setAgentReply(null);
    try {
      const task = `Home cook advisor. ${scaleResult ? `Making ${scaleResult.recipe}, ${scaleResult.targetServings} servings.` : ''} ${nutrResult ? `Per serving: ${nutrResult.perServing} cal, ${nutrResult.macros.protein} protein.` : ''} ${subResult?.substitutions[0] ? `Substituting ${subResult.ingredient} with ${subResult.substitutions[0].sub}.` : ''} Suggest one technique tip + one flavor enhancement. Plain text, 3 sentences max.`;
      const r = await lensRun({ domain: 'chat_agent', name: 'do', input: { task, maxTurns: 3 } });
      const reply = r.data?.result?.reply ?? r.data?.result?.summary ?? r.data?.result?.output;
      if (reply) {
        const text = typeof reply === 'string' ? reply : JSON.stringify(reply, null, 2);
        setAgentReply(text);
        pipe.publish('cooking.agentReply', text, { label: 'Chef tips' });
        ok('Tips ready.');
      } else err('Agent returned empty.');
    } catch (e) { err(pickMessage(e)); } finally { setBusy(null); }
  }

  function addFoodAsIngredient(f: Food) {
    const grams = f.servingSize && f.servingSizeUnit?.toLowerCase() === 'g' ? f.servingSize : 100;
    const name = f.description.split(',')[0].toLowerCase();
    setIngredients((prev) => [...prev, { name, quantity: '1', unit: 'serving', grams }]);
    ok(`Added ${name} (${grams} g).`);
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
          <label className="text-[10px] uppercase tracking-wider text-zinc-400">Recipe name</label>
          <input type="text" value={recipeName} onChange={(e) => setRecipeName(e.target.value)} className="w-full bg-zinc-900 border border-zinc-800 rounded px-3 py-1.5 text-[12px] text-white" />
          <div className="grid grid-cols-2 gap-2">
            <div>
              <label className="text-[10px] text-zinc-500">Base servings</label>
              <input type="number" min={1} value={baseServings} onChange={(e) => setBaseServings(Number(e.target.value) || 1)} className="w-full bg-zinc-900 border border-zinc-800 rounded px-2 py-1 text-[11px] text-white font-mono" />
            </div>
            <div>
              <label className="text-[10px] text-zinc-500">Target</label>
              <input type="number" min={1} value={targetServings} onChange={(e) => setTargetServings(Number(e.target.value) || 1)} className="w-full bg-zinc-900 border border-zinc-800 rounded px-2 py-1 text-[11px] text-white font-mono" />
            </div>
          </div>
          <label className="text-[10px] uppercase tracking-wider text-zinc-400">USDA search</label>
          <input type="text" value={foodQuery} onChange={(e) => setFoodQuery(e.target.value)} className="w-full bg-zinc-900 border border-zinc-800 rounded px-3 py-1.5 text-[12px] text-white" placeholder="USDA food search" />
          <label className="text-[10px] uppercase tracking-wider text-zinc-400">Substitute</label>
          <input type="text" value={substitute} onChange={(e) => setSubstitute(e.target.value)} className="w-full bg-zinc-900 border border-zinc-800 rounded px-3 py-1.5 text-[12px] text-white" placeholder="Ingredient to substitute" />
          <input type="text" value={recipient} onChange={(e) => setRecipient(e.target.value)} className="w-full bg-zinc-900 border border-zinc-800 rounded px-3 py-1.5 text-[12px] text-white" placeholder="DM recipient" />
          <div className="flex items-center gap-2 flex-wrap">
            <RecallSlot ctl={dmRecall} />
            <RecallSlot ctl={publishRecall} />
          </div>
        </div>
        <div className="md:col-span-2 space-y-1">
          <div className="flex items-end justify-between gap-2">
            <label className="text-[10px] uppercase tracking-wider text-amber-400 font-semibold">Ingredients ({ingredients.length})</label>
            <div className="flex items-center gap-1">
              <LoadFromSubstrate<RecipeDtu>
                label="Load recipe"
                compact
                emptyHint="No recipe DTUs yet — mint one to populate."
                fetcher={async () => {
                  const r = await api.get('/api/dtus', { params: { tag: 'recipe', limit: 50 } });
                  const list = (r.data?.dtus ?? r.data?.items ?? []) as RecipeDtu[];
                  return list.filter((d) => d?.meta?.recipe?.ingredients?.length);
                }}
                describe={(d) => ({
                  id: d.id,
                  primary: d.title ?? d.meta?.recipe?.name ?? d.id,
                  secondary: `${d.meta?.recipe?.ingredients?.length ?? 0} ingredients · ${d.meta?.recipe?.servings ?? '?'} servings`,
                })}
                onSelect={(d) => {
                  const r = d.meta?.recipe;
                  if (!r) { err('Selected DTU has no recipe meta.'); return; }
                  if (r.name) setRecipeName(r.name);
                  if (typeof r.servings === 'number' && r.servings > 0) { setBaseServings(r.servings); setTargetServings(r.servings); }
                  setIngredients((r.ingredients ?? []).map((i) => ({
                    name: i.name ?? '', quantity: i.quantity ?? '', unit: i.unit ?? 'g', grams: i.grams ?? 0,
                  })));
                  ok(`Loaded recipe "${r.name ?? d.id.slice(0, 8)}" (${r.ingredients?.length ?? 0} ingredients).`);
                }}
              />
              <PipeImporter<IngRow[]> accept={['cooking.ingredientsImport']} onImport={(rows) => Array.isArray(rows) && setIngredients(rows)} compact />
            </div>
          </div>
          <StructuredArrayEditor<IngRow> value={ingredients} onChange={setIngredients} template={{ name: '', quantity: '1', unit: 'g', grams: 100 }} columns={ING_COLS} accent="amber" maxRows={80} />
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
            {usdaResult.foods.slice(0, 8).map((f, i) => (
              <div key={i} className="text-[11px] text-zinc-300 mt-1 flex items-start gap-2">
                <div className="flex-1 min-w-0">
                  <strong className="text-green-200">{f.description}</strong>
                  <span className="font-mono text-zinc-500 text-[10px] ml-1">FDC {f.fdcId}</span>
                  {f.brandOwner && <div className="text-[10px] text-zinc-400 truncate">{f.brandOwner}</div>}
                  {f.servingSize && <div className="text-[10px] text-zinc-500">serving: {f.servingSize}{f.servingSizeUnit}</div>}
                </div>
                <button type="button" onClick={() => addFoodAsIngredient(f)} className="flex-shrink-0 text-[10px] text-green-200 hover:text-white border border-green-500/30 rounded px-1.5 py-0.5 flex items-center gap-1" title="Add to ingredients">
                  <Plus className="w-3 h-3" /> add
                </button>
              </div>
            ))}
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
