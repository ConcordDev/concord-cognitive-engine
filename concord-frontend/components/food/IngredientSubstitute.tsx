'use client';

/**
 * IngredientSubstitute — LLM-backed ingredient swap finder
 * (food.recipe-substitute). Ranked substitutes with a ratio, confidence,
 * and caveat, plus a mandatory allergen cross-contamination disclaimer
 * (the macro always returns one — never silently dropped here). Honest
 * failure when the LLM brain isn't reachable — no fabricated substitutes.
 */

import { useState } from 'react';
import { Shuffle, Loader2, AlertTriangle, Sparkles } from 'lucide-react';
import { lensRun } from '@/lib/api/client';
import { cn } from '@/lib/utils';

type Mode = 'allergen_swap' | 'simpler' | 'healthier' | 'surprise';
const MODES: { id: Mode; label: string }[] = [
  { id: 'allergen_swap', label: 'Allergen swap' },
  { id: 'simpler', label: 'Simpler' },
  { id: 'healthier', label: 'Healthier' },
  { id: 'surprise', label: 'Surprise me' },
];

interface Substitute {
  original: string;
  substitute: string;
  ratio: string;
  confidence: number;
  caveat?: string;
}

export function IngredientSubstitute() {
  const [ingredient, setIngredient] = useState('');
  const [excludeAllergens, setExcludeAllergens] = useState('');
  const [mode, setMode] = useState<Mode>('allergen_swap');
  const [loading, setLoading] = useState(false);
  const [subs, setSubs] = useState<Substitute[] | null>(null);
  const [warning, setWarning] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  async function find() {
    if (!ingredient.trim()) return;
    setLoading(true); setError(null); setSubs(null); setWarning(null);
    try {
      const r = await lensRun<{ substitutes: Substitute[]; allergenWarning: string }>('food', 'recipe-substitute', {
        ingredient: ingredient.trim(),
        mode,
        excludeAllergens: excludeAllergens.split(',').map((a) => a.trim()).filter(Boolean),
      });
      if (r.data?.ok && r.data.result) {
        setSubs(r.data.result.substitutes || []);
        setWarning(r.data.result.allergenWarning || null);
      } else {
        setError(r.data?.error || 'Substitute lookup unavailable — the reasoning brain may be offline.');
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Substitute lookup failed');
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="bg-[#0d1117] border border-cyan-500/20 rounded-lg overflow-hidden">
      <header className="px-4 py-2 border-b border-white/10 flex items-center gap-2">
        <Shuffle className="w-4 h-4 text-cyan-400" />
        <span className="text-xs uppercase font-semibold text-gray-300 tracking-wider">Ingredient Substitute</span>
      </header>
      <div className="p-3 space-y-2">
        <div className="grid grid-cols-2 gap-2 text-xs">
          <input
            value={ingredient} onChange={(e) => setIngredient(e.target.value)}
            placeholder="Ingredient (e.g. buttermilk)"
            onKeyDown={(e) => { if (e.key === 'Enter') find(); }}
            className="px-2 py-1.5 bg-lattice-deep border border-lattice-border rounded text-white"
          />
          <input
            value={excludeAllergens} onChange={(e) => setExcludeAllergens(e.target.value)}
            placeholder="Exclude allergens (comma sep)"
            className="px-2 py-1.5 bg-lattice-deep border border-lattice-border rounded text-white"
          />
        </div>
        <div className="flex items-center gap-1.5 flex-wrap">
          {MODES.map((m) => (
            <button key={m.id} type="button" onClick={() => setMode(m.id)}
              className={cn('px-2 py-0.5 rounded-full text-[10px] border',
                mode === m.id ? 'border-cyan-500/50 bg-cyan-500/15 text-cyan-300' : 'border-lattice-border text-gray-400')}>
              {m.label}
            </button>
          ))}
          <button
            onClick={find}
            disabled={loading || !ingredient.trim()}
            className="ml-auto inline-flex items-center gap-1.5 px-3 py-1 rounded bg-cyan-500 text-black text-xs font-bold hover:bg-cyan-400 disabled:opacity-50"
          >
            {loading ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Sparkles className="w-3.5 h-3.5" />}
            Find substitutes
          </button>
        </div>

        {error && (
          <div className="flex items-center gap-1.5 text-xs text-amber-300">
            <AlertTriangle className="w-3.5 h-3.5 shrink-0" /> {error}
          </div>
        )}

        {subs && subs.length === 0 && !error && (
          <p className="text-xs text-gray-400">No substitutes found for that ingredient.</p>
        )}

        {subs && subs.length > 0 && (
          <div className="space-y-1.5">
            {subs.map((s, i) => (
              <div key={i} className="bg-lattice-deep border border-lattice-border rounded p-2 text-xs">
                <div className="flex items-center justify-between">
                  <span className="text-white font-medium">{s.substitute}</span>
                  <span className="text-gray-400">{s.ratio} · {Math.round(s.confidence * 100)}% confidence</span>
                </div>
                {s.caveat && <p className="text-[10px] text-gray-400 mt-0.5">{s.caveat}</p>}
              </div>
            ))}
            {warning && (
              <div className="flex items-start gap-1.5 text-[10px] text-amber-300 pt-1">
                <AlertTriangle className="w-3 h-3 shrink-0 mt-0.5" /> {warning}
              </div>
            )}
          </div>
        )}
      </div>
    </div>
  );
}

export default IngredientSubstitute;
