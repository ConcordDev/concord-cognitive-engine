'use client';

import { useState } from 'react';
import { Link as LinkIcon, Loader2, Check, AlertCircle } from 'lucide-react';
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

interface RecipeImporterProps {
  onImported?: (recipe: ImportedRecipe) => void;
}

export function RecipeImporter({ onImported }: RecipeImporterProps) {
  const [url, setUrl] = useState('');
  const [loading, setLoading] = useState(false);
  const [recipe, setRecipe] = useState<ImportedRecipe | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [source, setSource] = useState<'jsonld' | 'llm' | null>(null);

  async function importRecipe() {
    if (!url.trim()) return;
    setLoading(true); setError(null); setRecipe(null);
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

  return (
    <div className="bg-[#0d1117] border border-cyan-500/20 rounded-lg overflow-hidden">
      <header className="px-4 py-2 border-b border-white/10 flex items-center gap-2">
        <LinkIcon className="w-4 h-4 text-cyan-400" />
        <span className="text-xs uppercase font-semibold text-gray-300 tracking-wider">Recipe import</span>
        <span className="ml-auto text-[10px] text-gray-500">JSON-LD schema.org first, LLM fallback</span>
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
            <div className="text-[10px] text-gray-500 truncate">{recipe.sourceUrl}</div>
          </div>
        )}
      </div>
    </div>
  );
}

export default RecipeImporter;
