'use client';

import { useState } from 'react';
import { Link as LinkIcon, Loader2, Check, AlertCircle, Save } from 'lucide-react';
import { lensRun } from '@/lib/api/client';

export interface ImportedRecipe {
  title: string;
  servings: number;
  totalTimeMin: number;
  ingredients: Array<{ qty: number; unit: string; item: string }>;
  steps: Array<{ order: number; instruction: string; timerSec?: number }>;
  nutrition?: { calories: number; protein_g: number; carbs_g: number; fat_g: number };
  sourceUrl: string;
}

type Slot = 'Breakfast' | 'Lunch' | 'Dinner' | 'Snack';
const SLOTS: Slot[] = ['Breakfast', 'Lunch', 'Dinner', 'Snack'];

interface RecipeImporterProps {
  onImported?: (recipe: ImportedRecipe) => void;
  /** Called after the imported recipe is saved into the user's real recipe library (food.recipe-add). */
  onSaved?: () => void;
}

export function RecipeImporter({ onImported, onSaved }: RecipeImporterProps) {
  const [url, setUrl] = useState('');
  const [loading, setLoading] = useState(false);
  const [recipe, setRecipe] = useState<ImportedRecipe | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [source, setSource] = useState<'jsonld' | 'llm' | null>(null);
  const [slot, setSlot] = useState<Slot>('Dinner');
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);

  async function importRecipe() {
    if (!url.trim()) return;
    setLoading(true); setError(null); setRecipe(null); setSaved(false);
    try {
      const res = await lensRun({
        domain: 'food', action: 'recipe-import-url', input: { url: url.trim() },
      });
      const r = res.data?.result;
      if (r?.recipe) {
        setRecipe(r.recipe as ImportedRecipe);
        setSource((r.source as 'jsonld' | 'llm') || null);
        onImported?.(r.recipe);
      } else {
        setError(res.data?.error || 'Could not extract a recipe from that URL.');
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : 'import failed');
    } finally { setLoading(false); }
  }

  async function saveToLibrary() {
    if (!recipe) return;
    setSaving(true); setError(null);
    try {
      const res = await lensRun('food', 'recipe-add', {
        title: recipe.title,
        slot,
        servings: recipe.servings || 1,
        calories: recipe.nutrition?.calories || 0,
        protein: recipe.nutrition?.protein_g || 0,
        carbs: recipe.nutrition?.carbs_g || 0,
        fat: recipe.nutrition?.fat_g || 0,
        tags: [],
        ingredients: recipe.ingredients.map((i) => ({ item: i.item, qty: i.qty, unit: i.unit })),
      });
      if (res.data?.ok) {
        setSaved(true);
        onSaved?.();
      } else {
        setError(res.data?.error || 'Could not save to your recipe library.');
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : 'save failed');
    } finally { setSaving(false); }
  }

  return (
    <div className="bg-[#0d1117] border border-cyan-500/20 rounded-lg overflow-hidden">
      <header className="px-4 py-2 border-b border-white/10 flex items-center gap-2">
        <LinkIcon className="w-4 h-4 text-cyan-400" />
        <span className="text-xs uppercase font-semibold text-gray-300 tracking-wider">Recipe import</span>
        <span className="ml-auto text-[10px] text-gray-400">JSON-LD schema.org first, LLM fallback</span>
      </header>
      <div className="p-4 space-y-3">
        <div className="flex items-center gap-2">
          <input
            value={url}
            onChange={e => setUrl(e.target.value)}
            placeholder="https://yourfoodblog.com/some-recipe"
            className="flex-1 px-3 py-2 text-sm bg-lattice-deep border border-lattice-border rounded text-white"
            onKeyDown={(e) => { if (e.key === 'Enter') importRecipe(); }}
          />
          <button onClick={importRecipe} disabled={loading || !url.trim()} className="inline-flex items-center gap-2 px-4 py-2 rounded bg-cyan-500 text-black font-bold hover:bg-cyan-400 disabled:opacity-50">
            {loading ? <Loader2 className="w-4 h-4 animate-spin" /> : <LinkIcon className="w-4 h-4" />}
            Import
          </button>
        </div>
        {error && <div className="text-xs text-red-400 inline-flex items-center gap-1"><AlertCircle className="w-3 h-3" /> {error}</div>}
        {recipe && (
          <div className="space-y-2 pt-2 border-t border-white/10">
            <div className="flex items-center gap-2">
              <Check className="w-4 h-4 text-green-400" />
              <h3 className="text-lg font-bold text-white">{recipe.title}</h3>
              {source && <span className="text-[10px] px-1.5 py-0.5 rounded bg-cyan-500/20 text-cyan-300 uppercase tracking-wider">{source}</span>}
            </div>
            <div className="text-xs text-gray-400">
              Serves {recipe.servings} · {recipe.totalTimeMin} min total · {recipe.ingredients.length} ingredients · {recipe.steps.length} steps
            </div>
            {recipe.nutrition && (
              <div className="text-xs text-cyan-200 tabular-nums">
                {Math.round(recipe.nutrition.calories)} kcal · P {Math.round(recipe.nutrition.protein_g)}g · C {Math.round(recipe.nutrition.carbs_g)}g · F {Math.round(recipe.nutrition.fat_g)}g
              </div>
            )}
            {recipe.steps.length > 0 && (
              <ol className="text-xs text-gray-300 space-y-1 list-decimal list-inside">
                {recipe.steps.map((s) => <li key={s.order}>{s.instruction}</li>)}
              </ol>
            )}
            <div className="text-[10px] text-gray-400 truncate">{recipe.sourceUrl}</div>

            <div className="flex items-center gap-2 pt-2 border-t border-white/10">
              <select value={slot} onChange={(e) => setSlot(e.target.value as Slot)} disabled={saved}
                className="px-2 py-1.5 text-xs bg-lattice-deep border border-lattice-border rounded text-white disabled:opacity-50">
                {SLOTS.map((s) => <option key={s} value={s}>{s}</option>)}
              </select>
              <button
                onClick={saveToLibrary}
                disabled={saving || saved}
                className={`inline-flex items-center gap-2 px-3 py-1.5 rounded text-xs font-bold disabled:opacity-70 ${saved ? 'bg-green-500/20 text-green-300 border border-green-500/40' : 'bg-cyan-500 text-black hover:bg-cyan-400'}`}
              >
                {saving ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : saved ? <Check className="w-3.5 h-3.5" /> : <Save className="w-3.5 h-3.5" />}
                {saved ? 'Saved to Recipe Library' : 'Save to Recipe Library'}
              </button>
            </div>
            {saved && (
              <p className="text-[10px] text-gray-400">
                Title, servings, {recipe.ingredients.length} ingredient{recipe.ingredients.length === 1 ? '' : 's'} and nutrition were saved.
                Step-by-step instructions above are for reference — the recipe library doesn&apos;t store steps yet.
              </p>
            )}
          </div>
        )}
      </div>
    </div>
  );
}

export default RecipeImporter;
