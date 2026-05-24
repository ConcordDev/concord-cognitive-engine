'use client';

import { useEffect, useState } from 'react';
import { Calculator, Loader2 } from 'lucide-react';
import { lensRun } from '@/lib/api/client';

export interface ScaledIngredient {
  original: { qty: number; unit: string; item: string };
  scaled: { qty: number; unit: string; item: string };
  display: string;
}

interface RecipeScalerProps {
  baseServings: number;
  ingredients: Array<{ qty: number; unit: string; item: string }>;
}

export function RecipeScaler({ baseServings, ingredients }: RecipeScalerProps) {
  const [targetServings, setTargetServings] = useState(baseServings);
  const [scaled, setScaled] = useState<ScaledIngredient[]>([]);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    if (targetServings === baseServings) {
      setScaled(ingredients.map(i => ({ original: i, scaled: i, display: formatIng(i) })));
      return;
    }
    let cancelled = false;
    setLoading(true);
    (async () => {
      try {
        const res = await lensRun({
          domain: 'food', action: 'recipe-scale',
          input: { ingredients, baseServings, targetServings },
        });
        if (!cancelled) setScaled((res.data?.result?.ingredients || []) as ScaledIngredient[]);
      } catch (e) { console.error('[Scale] failed', e); }
      finally { if (!cancelled) setLoading(false); }
    })();
    return () => { cancelled = true; };
  }, [targetServings, baseServings, ingredients]);

  return (
    <div className="bg-[#0d1117] border border-cyan-500/20 rounded-lg overflow-hidden">
      <header className="px-4 py-2 border-b border-white/10 flex items-center gap-2">
        <Calculator className="w-4 h-4 text-cyan-400" />
        <span className="text-xs uppercase font-semibold text-gray-300 tracking-wider">Scale recipe</span>
        <span className="ml-auto text-[10px] text-gray-400">base = {baseServings} servings</span>
      </header>
      <div className="p-3 border-b border-white/10 flex items-center gap-3 text-sm">
        <label className="text-gray-400">Servings:</label>
        <button onClick={() => setTargetServings(Math.max(1, targetServings - 1))} className="w-8 h-8 rounded bg-white/10 hover:bg-white/20 text-white">−</button>
        <input type="number" value={targetServings} onChange={e => setTargetServings(Math.max(1, Number(e.target.value) || 1))} className="w-16 px-2 py-1 bg-lattice-deep border border-lattice-border rounded text-white text-center tabular-nums" />
        <button onClick={() => setTargetServings(targetServings + 1)} className="w-8 h-8 rounded bg-white/10 hover:bg-white/20 text-white">+</button>
        <span className="ml-auto text-xs text-cyan-300 tabular-nums">×{(targetServings / baseServings).toFixed(2)}</span>
      </div>
      <ul className="divide-y divide-white/5 max-h-72 overflow-y-auto">
        {loading ? (
          <li className="flex items-center justify-center py-6 text-xs text-gray-400"><Loader2 className="w-4 h-4 animate-spin mr-2" /> Scaling…</li>
        ) : (
          scaled.map((s, i) => (
            <li key={i} className="px-3 py-2 text-sm">
              <span className="text-cyan-300 tabular-nums">{s.display}</span>
            </li>
          ))
        )}
      </ul>
    </div>
  );
}

function formatIng(i: { qty: number; unit: string; item: string }): string {
  return `${i.qty} ${i.unit}${i.unit ? ' ' : ''}${i.item}`.trim();
}

export default RecipeScaler;
