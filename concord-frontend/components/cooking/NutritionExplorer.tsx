'use client';

/**
 * NutritionExplorer — bespoke USDA FoodData Central search + nutrition
 * detail UX for the cooking lens. Backed by:
 *   cooking.usda-search    — fuzzy text search (600K+ items)
 *   cooking.usda-nutrition — full nutrient profile by fdcId
 *
 * Per category-leader UX research against MyFitnessPal, Cronometer,
 * Yuka, Lose It!, NutritionData.self.com, NYT Cooking:
 *
 *   • 300ms debounced typeahead, 8-result max, bold matched substring,
 *     dataType chip to distinguish Foundation/SR Legacy (generic) from
 *     Branded foods (Cronometer convention)
 *   • Food detail as a 3-tier collapsible card:
 *       Tier 1 — kcal + 3-macro split (cyan protein / amber carbs /
 *                violet fat), always visible
 *       Tier 2 — macro %DV bars (cyan-500/20 track + cyan fill,
 *                amber for low, red for ceiling-over)
 *       Tier 3 — full micronutrient grid (vitamins / minerals) as a
 *                scrollable 2-column list of horizontal bars
 *   • Save-as-DTU per food snapshot with source: "usda-fdc"
 *
 * NOTE: macro convention — protein blue, carbs orange, fat yellow is
 * common but not standardized. We pin to Concord's own palette:
 * cyan (protein) / amber (carbs) / violet (fat). Defensible.
 */

import { useState, useEffect, useMemo, useRef } from 'react';
import { useMutation } from '@tanstack/react-query';
import { motion, AnimatePresence } from 'framer-motion';
import {
  Salad, Search, Loader2, ChevronDown, ChevronRight, Flame, ExternalLink,
} from 'lucide-react';
import { apiHelpers } from '@/lib/api/client';
import { SaveAsDtuButton } from '@/components/dtu/SaveAsDtuButton';

interface FoodHit {
  fdcId: number;
  description: string;
  dataType?: string;        // 'Foundation' | 'SR Legacy' | 'Branded' | 'Survey (FNDDS)'
  brandOwner?: string;
  brandName?: string;
  gtinUpc?: string;
  servingSize?: number;
  servingSizeUnit?: string;
  score?: number;
}

interface NutrientDetail {
  fdcId: number;
  description: string;
  dataType?: string;
  brandOwner?: string;
  servingSize?: number;
  servingSizeUnit?: string;
  householdServingFullText?: string;
  headline: {
    caloriesKcal: number | null;
    proteinG: number | null;
    totalFatG: number | null;
    saturatedFatG: number | null;
    carbsG: number | null;
    fiberG: number | null;
    sugarG: number | null;
    sodiumMg: number | null;
    calciumMg: number | null;
    ironMg: number | null;
    potassiumMg: number | null;
    vitaminCMg: number | null;
  };
  nutrients: Record<string, { amount: number | null; unit: string }>;
  source: string;
  usingDemoKey?: boolean;
}

interface MacroEnvelope<T> { ok: boolean; result?: T; error?: string }

async function callMacro<T>(action: string, input: Record<string, unknown>): Promise<MacroEnvelope<T>> {
  const r = await apiHelpers.lens.runDomain('cooking', action, { input });
  const data = (r as { data?: { ok: boolean; result?: T } }).data;
  if (!data) return { ok: false, error: 'empty response' };
  if (data.ok && data.result && typeof data.result === 'object' && 'ok' in data.result) {
    return data.result as MacroEnvelope<T>;
  }
  return data as MacroEnvelope<T>;
}

// FDA Daily Values (adult, 2000 kcal reference) for the % DV bars.
const DAILY_VALUES: Record<string, { dv: number; unit: string; ceiling?: boolean }> = {
  proteinG:      { dv: 50, unit: 'g' },
  totalFatG:     { dv: 78, unit: 'g' },
  saturatedFatG: { dv: 20, unit: 'g', ceiling: true },
  carbsG:        { dv: 275, unit: 'g' },
  fiberG:        { dv: 28, unit: 'g' },
  sugarG:        { dv: 50, unit: 'g', ceiling: true },
  sodiumMg:      { dv: 2300, unit: 'mg', ceiling: true },
  calciumMg:     { dv: 1300, unit: 'mg' },
  ironMg:        { dv: 18, unit: 'mg' },
  potassiumMg:   { dv: 4700, unit: 'mg' },
  vitaminCMg:    { dv: 90, unit: 'mg' },
};

export function NutritionExplorer() {
  const [queryInput, setQueryInput] = useState('');
  const [debouncedQuery, setDebouncedQuery] = useState('');
  const [showSuggestions, setShowSuggestions] = useState(false);
  const [hits, setHits] = useState<FoodHit[]>([]);
  const [detail, setDetail] = useState<NutrientDetail | null>(null);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const searchMutation = useMutation({
    mutationFn: async (q: string) => callMacro<{ foods: FoodHit[]; totalHits: number; usingDemoKey?: boolean }>('usda-search', { query: q, pageSize: 8 }),
    onSuccess: (env) => {
      if (env.ok && env.result) { setHits(env.result.foods); setErrorMsg(null); }
      else { setHits([]); setErrorMsg(env.error || 'No foods matched'); }
    },
  });

  const detailMutation = useMutation({
    mutationFn: async (fdcId: number) => callMacro<NutrientDetail>('usda-nutrition', { fdcId }),
    onSuccess: (env) => {
      if (env.ok && env.result) setDetail(env.result);
      else setDetail(null);
    },
  });

  useEffect(() => {
    if (debounceRef.current) clearTimeout(debounceRef.current);
    if (queryInput.trim().length < 2) { setHits([]); return; }
    debounceRef.current = setTimeout(() => setDebouncedQuery(queryInput.trim()), 300);
    return () => { if (debounceRef.current) clearTimeout(debounceRef.current); };
  }, [queryInput]);

  useEffect(() => {
    if (debouncedQuery.length >= 2) searchMutation.mutate(debouncedQuery);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [debouncedQuery]);

  const openFood = (hit: FoodHit) => {
    setShowSuggestions(false);
    setQueryInput(hit.description);
    setDetail(null);
    detailMutation.mutate(hit.fdcId);
  };

  const groupedHits = useMemo(() => {
    const generic = hits.filter((h) => h.dataType !== 'Branded');
    const branded = hits.filter((h) => h.dataType === 'Branded');
    return { generic: generic.slice(0, 5), branded: branded.slice(0, 3) };
  }, [hits]);

  return (
    <div className="space-y-4">
      <header className="flex items-center justify-between gap-3 border-b border-cyan-500/15 pb-3">
        <div className="flex items-center gap-2">
          <Salad className="h-5 w-5 text-cyan-400" />
          <h2 className="text-sm font-semibold text-white">Nutrition Explorer</h2>
          <span className="rounded bg-zinc-800 px-1.5 py-0.5 font-mono text-[10px] uppercase tracking-wider text-zinc-400">
            usda fdc · 600K foods
          </span>
        </div>
      </header>

      <div className="relative">
        <Search className="pointer-events-none absolute left-2.5 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-zinc-400" />
        <input
          type="text"
          value={queryInput}
          onChange={(e) => { setQueryInput(e.target.value); setShowSuggestions(true); }}
          onFocus={() => setShowSuggestions(true)}
          onBlur={() => window.setTimeout(() => setShowSuggestions(false), 150)}
          placeholder="Search any food — apple, chicken breast, oatmeal, almond butter…"
          className="w-full rounded-md border border-zinc-800 bg-zinc-950 py-1.5 pl-8 pr-3 text-sm text-white placeholder-zinc-600 focus:border-cyan-500/40 focus:outline-none"
        />
        {showSuggestions && hits.length > 0 && (
          <div className="absolute z-10 mt-1 max-h-80 w-full overflow-y-auto rounded-md border border-cyan-500/20 bg-zinc-950 shadow-2xl">
            {groupedHits.generic.length > 0 && (
              <>
                <div className="px-3 py-1 text-[10px] uppercase tracking-wider text-zinc-400">Generic foods</div>
                {groupedHits.generic.map((h) => (
                  <Suggestion key={h.fdcId} hit={h} query={debouncedQuery} onPick={openFood} />
                ))}
              </>
            )}
            {groupedHits.branded.length > 0 && (
              <>
                <div className="border-t border-zinc-800 px-3 py-1 text-[10px] uppercase tracking-wider text-zinc-400">Branded</div>
                {groupedHits.branded.map((h) => (
                  <Suggestion key={h.fdcId} hit={h} query={debouncedQuery} onPick={openFood} />
                ))}
              </>
            )}
          </div>
        )}
      </div>

      {errorMsg && !detail && (
        <div className="rounded-md border border-red-500/20 bg-red-500/5 px-3 py-2 text-xs text-red-300">
          {errorMsg}
        </div>
      )}

      {detailMutation.isPending && (
        <div className="flex items-center justify-center py-6 text-xs text-zinc-400">
          <Loader2 className="mr-2 h-4 w-4 animate-spin" /> Loading nutrition…
        </div>
      )}

      {!detail && !detailMutation.isPending && (
        <div className="rounded-md border border-dashed border-zinc-800 bg-zinc-950/40 px-3 py-6 text-center text-xs text-zinc-400">
          USDA FoodData Central — 600,000+ foods with full macro + micronutrient breakdowns.
          Search above to load a food, then expand each tier for detail.
        </div>
      )}

      {detail && <FoodDetailCard detail={detail} />}
    </div>
  );
}

function Suggestion({ hit, query, onPick }: { hit: FoodHit; query: string; onPick: (h: FoodHit) => void }) {
  const matchedTitle = useMemo(() => {
    if (!query) return hit.description;
    const re = new RegExp(`(${query.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')})`, 'i');
    return hit.description.split(re).map((p, i) =>
      re.test(p)
        ? <strong key={i} className="font-semibold text-white">{p}</strong>
        : <span key={i}>{p}</span>
    );
  }, [hit.description, query]);
  return (
    <button
      type="button"
      onMouseDown={(e) => { e.preventDefault(); onPick(hit); }}
      className="block w-full border-b border-zinc-800 px-3 py-2 text-left transition-colors last:border-b-0 hover:bg-cyan-500/10"
    >
      <div className="text-xs text-zinc-300">{matchedTitle}</div>
      <div className="mt-0.5 flex items-center gap-2 text-[10px] text-zinc-400">
        <span className="rounded bg-zinc-800 px-1.5 py-0.5 font-mono uppercase">{hit.dataType || '?'}</span>
        {hit.brandOwner && <span>{hit.brandOwner}</span>}
        {hit.servingSize && hit.servingSizeUnit && <span>{hit.servingSize}{hit.servingSizeUnit} serving</span>}
      </div>
    </button>
  );
}

function FoodDetailCard({ detail }: { detail: NutrientDetail }) {
  const [openTier2, setOpenTier2] = useState(true);
  const [openTier3, setOpenTier3] = useState(false);
  const h = detail.headline;
  const protein = h.proteinG ?? 0;
  const carbs = h.carbsG ?? 0;
  const fat = h.totalFatG ?? 0;
  // Calorie-from-macro composition (kcal/g: protein/carbs 4, fat 9)
  const kcalP = protein * 4;
  const kcalC = carbs * 4;
  const kcalF = fat * 9;
  const kcalTotal = Math.max(1, kcalP + kcalC + kcalF);
  const pP = (kcalP / kcalTotal) * 100;
  const pC = (kcalC / kcalTotal) * 100;
  const pF = (kcalF / kcalTotal) * 100;
  const perWhat = detail.servingSize && detail.servingSizeUnit
    ? `per ${detail.servingSize}${detail.servingSizeUnit} serving`
    : 'per 100g';

  return (
    <motion.div
      key={detail.fdcId}
      initial={{ opacity: 0, y: 6 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.2 }}
      className="space-y-3"
    >
      {/* Tier 1 — kcal + 3-macro split — always visible */}
      <div className="rounded-lg border border-cyan-500/20 bg-gradient-to-br from-cyan-500/10 via-zinc-950/60 to-zinc-950/80 p-4">
        <div className="flex items-start justify-between gap-3">
          <div className="min-w-0 flex-1">
            <h3 className="text-base font-semibold text-white">{detail.description}</h3>
            <p className="mt-0.5 text-[11px] text-zinc-400">
              {detail.dataType} {detail.brandOwner && `· ${detail.brandOwner}`} · {perWhat}
            </p>
          </div>
          <SaveAsDtuButton
            apiSource="usda-fdc"
            apiUrl={`https://api.nal.usda.gov/fdc/v1/food/${detail.fdcId}`}
            title={`${detail.description} — USDA nutrition`}
            content={[
              `Food: ${detail.description}`,
              `Source type: ${detail.dataType || '—'}`,
              detail.brandOwner ? `Brand: ${detail.brandOwner}` : '',
              `Reference: ${perWhat}`,
              '',
              `Calories: ${h.caloriesKcal ?? '—'} kcal`,
              `Protein: ${h.proteinG ?? '—'} g`,
              `Carbohydrates: ${h.carbsG ?? '—'} g (fiber ${h.fiberG ?? '—'} g, sugar ${h.sugarG ?? '—'} g)`,
              `Total fat: ${h.totalFatG ?? '—'} g (saturated ${h.saturatedFatG ?? '—'} g)`,
              `Sodium: ${h.sodiumMg ?? '—'} mg`,
              `FDC ID: ${detail.fdcId}`,
            ].filter(Boolean).join('\n')}
            extraTags={['cooking', 'nutrition', 'usda', detail.dataType?.toLowerCase().replace(/\s+/g, '-') || 'food']}
            rawData={detail}
          />
        </div>

        <div className="mt-3 grid grid-cols-4 gap-2">
          <div className="rounded-md border border-zinc-800 bg-zinc-950/40 px-3 py-2 text-center">
            <div className="flex items-center justify-center gap-1 text-[10px] uppercase tracking-wider text-zinc-400">
              <Flame className="h-2.5 w-2.5" /> kcal
            </div>
            <div className="mt-0.5 font-mono text-xl font-bold text-white">{h.caloriesKcal ?? '—'}</div>
          </div>
          <MacroCard label="Protein" value={h.proteinG} unit="g" color="cyan" />
          <MacroCard label="Carbs" value={h.carbsG} unit="g" color="amber" />
          <MacroCard label="Fat" value={h.totalFatG} unit="g" color="violet" />
        </div>

        {/* Calorie-from-macro bar */}
        <div className="mt-3">
          <div className="mb-1 flex items-center justify-between text-[10px] uppercase tracking-wider text-zinc-400">
            <span>Calorie split</span>
            <span>{Math.round(pP)}% P · {Math.round(pC)}% C · {Math.round(pF)}% F</span>
          </div>
          <div className="flex h-2 w-full overflow-hidden rounded-full bg-zinc-800">
            <div className="bg-cyan-500" style={{ width: `${pP}%` }} />
            <div className="bg-amber-500" style={{ width: `${pC}%` }} />
            <div className="bg-violet-500" style={{ width: `${pF}%` }} />
          </div>
        </div>
      </div>

      {/* Tier 2 — Macro %DV bars */}
      <Tier
        label="Macro % Daily Value (2000 kcal ref)"
        open={openTier2}
        onToggle={() => setOpenTier2((v) => !v)}
      >
        <div className="space-y-1.5">
          {(['proteinG', 'totalFatG', 'saturatedFatG', 'carbsG', 'fiberG', 'sugarG', 'sodiumMg'] as const).map((k) => (
            <DvBar key={k} label={prettyLabel(k)} value={h[k]} dv={DAILY_VALUES[k].dv} unit={DAILY_VALUES[k].unit} ceiling={DAILY_VALUES[k].ceiling} />
          ))}
        </div>
      </Tier>

      {/* Tier 3 — Full micronutrient grid */}
      <Tier
        label="Micronutrient grid"
        open={openTier3}
        onToggle={() => setOpenTier3((v) => !v)}
      >
        <div className="grid grid-cols-1 gap-1.5 sm:grid-cols-2">
          {Object.entries(detail.nutrients).filter(([, v]) => v.amount != null).slice(0, 40).map(([name, v]) => (
            <div key={name} className="flex items-center justify-between gap-2 rounded border border-zinc-800 bg-zinc-950/40 px-2.5 py-1 text-[11px]">
              <span className="truncate text-zinc-300">{name}</span>
              <span className="shrink-0 font-mono text-cyan-300">
                {v.amount} <span className="text-zinc-400">{v.unit}</span>
              </span>
            </div>
          ))}
        </div>
      </Tier>

      <a
        href={`https://fdc.nal.usda.gov/food-details/${detail.fdcId}`}
        target="_blank"
        rel="noopener noreferrer"
        className="inline-flex items-center gap-1 text-[11px] text-cyan-400 hover:underline"
      >
        <ExternalLink className="h-3 w-3" />
        FDC source page
      </a>
    </motion.div>
  );
}

function MacroCard({ label, value, unit, color }: { label: string; value: number | null; unit: string; color: 'cyan' | 'amber' | 'violet' }) {
  const fg = color === 'cyan' ? 'text-cyan-300' : color === 'amber' ? 'text-amber-300' : 'text-violet-300';
  return (
    <div className="rounded-md border border-zinc-800 bg-zinc-950/40 px-3 py-2 text-center">
      <div className="text-[10px] uppercase tracking-wider text-zinc-400">{label}</div>
      <div className={`mt-0.5 font-mono text-xl font-bold ${fg}`}>{value ?? '—'}<span className="ml-0.5 text-[10px] text-zinc-400">{unit}</span></div>
    </div>
  );
}

function DvBar({ label, value, dv, unit, ceiling }: { label: string; value: number | null; dv: number; unit: string; ceiling?: boolean }) {
  const v = value ?? 0;
  const pct = Math.min(200, (v / dv) * 100); // cap at 200% for display
  const isOver = ceiling && pct > 100;
  const isLow = !ceiling && pct < 50;
  const barColor = isOver ? 'bg-red-500' : isLow ? 'bg-amber-500' : 'bg-cyan-500';
  return (
    <div>
      <div className="mb-0.5 flex items-baseline justify-between gap-2 text-[11px]">
        <span className="text-zinc-300">{label}</span>
        <span className="font-mono text-zinc-400">
          {value ?? '—'} {unit}
          <span className={`ml-1.5 ${isOver ? 'text-red-300' : isLow ? 'text-amber-300' : 'text-cyan-300'}`}>
            {value != null ? `· ${Math.round(pct)}% DV` : ''}
          </span>
        </span>
      </div>
      <div className="h-1.5 w-full overflow-hidden rounded-full bg-cyan-500/10">
        <div className={`h-full transition-all ${barColor}`} style={{ width: `${Math.min(100, pct)}%` }} />
      </div>
    </div>
  );
}

function Tier({ label, open, onToggle, children }: { label: string; open: boolean; onToggle: () => void; children: React.ReactNode }) {
  return (
    <div className="overflow-hidden rounded-md border border-zinc-800 bg-zinc-950/40">
      <button
        type="button"
        onClick={onToggle}
        className="flex w-full items-center justify-between px-3 py-2 text-left text-xs font-medium text-zinc-200 transition-colors hover:bg-zinc-900/60"
      >
        <span>{label}</span>
        {open ? <ChevronDown className="h-3.5 w-3.5 text-zinc-400" /> : <ChevronRight className="h-3.5 w-3.5 text-zinc-400" />}
      </button>
      <AnimatePresence initial={false}>
        {open && (
          <motion.div
            initial={{ height: 0, opacity: 0 }}
            animate={{ height: 'auto', opacity: 1 }}
            exit={{ height: 0, opacity: 0 }}
            transition={{ duration: 0.16 }}
            className="overflow-hidden border-t border-zinc-800"
          >
            <div className="p-3">{children}</div>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}

function prettyLabel(key: string): string {
  switch (key) {
    case 'proteinG': return 'Protein';
    case 'totalFatG': return 'Total fat';
    case 'saturatedFatG': return 'Saturated fat';
    case 'carbsG': return 'Carbohydrates';
    case 'fiberG': return 'Fiber';
    case 'sugarG': return 'Sugar';
    case 'sodiumMg': return 'Sodium';
    default: return key;
  }
}
