'use client';

/**
 * CraftingPanelV2
 *
 * Frontend for server/lib/crafting/craft-engine.js. Lists known recipes,
 * shows resource availability, and submits craft requests via
 * POST /api/crafting/execute. Errors and successes surface as toasts.
 *
 * Existing CraftingPanel.tsx is a stub that doesn't reach the engine; this
 * is the wired version, mounted on the world page when showPanel='crafting'.
 */

import { useEffect, useState, useCallback } from 'react';

interface Recipe {
  id: string;
  name: string;
  category?: string;
  ingredients: { dtuId?: string; type?: string; quantity: number; name?: string }[];
  output: { name: string; type: string; quality?: string };
  durationMs?: number;
}

interface ResourceBar {
  type: string;
  current: number;
  max: number;
}

interface CraftingPanelProps {
  worldId: string;
  onClose?: () => void;
}

const PANEL = 'rounded-lg border border-amber-500/30 bg-black/85 backdrop-blur-sm';

export default function CraftingPanelV2({ worldId, onClose }: CraftingPanelProps) {
  const [recipes, setRecipes] = useState<Recipe[]>([]);
  const [resources, setResources] = useState<ResourceBar[]>([]);
  const [crafting, setCrafting] = useState<string | null>(null);
  const [toast, setToast] = useState<{ kind: 'ok' | 'err'; msg: string } | null>(null);

  useEffect(() => {
    Promise.all([
      fetch('/api/crafting/recipes', { credentials: 'include' }).then((r) => r.json()).catch(() => null),
      fetch(`/api/crafting/resource-bars/${encodeURIComponent(worldId)}`, { credentials: 'include' }).then((r) => r.json()).catch(() => null),
    ]).then(([rec, bars]) => {
      setRecipes((rec?.recipes ?? []) as Recipe[]);
      setResources((bars?.bars ?? bars?.resources ?? []) as ResourceBar[]);
    });
  }, [worldId]);

  const showToast = useCallback((kind: 'ok' | 'err', msg: string) => {
    setToast({ kind, msg });
    setTimeout(() => setToast(null), 3000);
  }, []);

  const handleCraft = useCallback(async (recipe: Recipe) => {
    setCrafting(recipe.id);
    try {
      const r = await fetch('/api/crafting/execute', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify({ worldId, recipeId: recipe.id }),
      });
      const data = await r.json();
      if (data?.ok) {
        showToast('ok', `Crafted ${recipe.output.name}.`);
        // Re-fetch resources.
        fetch(`/api/crafting/resource-bars/${encodeURIComponent(worldId)}`, { credentials: 'include' })
          .then((rr) => rr.json())
          .then((bars) => setResources((bars?.bars ?? bars?.resources ?? []) as ResourceBar[]))
          .catch(() => { /* ignore */ });
        // GameJuice on craft.
        try {
          window.dispatchEvent(new CustomEvent('concordia:game-juice', {
            detail: { trigger: 'craft-complete', opts: { value: recipe.output.name } },
          }));
        } catch { /* ok */ }
      } else {
        showToast('err', data?.error ?? 'Craft failed');
      }
    } catch (e) {
      showToast('err', 'Network error');
    } finally {
      setCrafting(null);
    }
  }, [worldId, showToast]);

  return (
    <div className={`${PANEL} p-4 max-w-2xl w-full`}>
      <div className="flex items-center justify-between mb-3">
        <h3 className="text-amber-300 font-semibold text-lg">Crafting</h3>
        {onClose && (
          <button onClick={onClose} className="text-gray-400 hover:text-white text-sm">close</button>
        )}
      </div>

      {/* Resource bars */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-2 mb-4">
        {resources.map((r) => {
          const pct = r.max > 0 ? Math.min(100, Math.round((r.current / r.max) * 100)) : 0;
          return (
            <div key={r.type} className="text-xs">
              <div className="flex justify-between text-gray-400 mb-1">
                <span>{r.type}</span>
                <span className="font-mono">{r.current} / {r.max}</span>
              </div>
              <div className="h-1.5 bg-stone-800 rounded overflow-hidden">
                <div
                  className="h-full bg-amber-500"
                  style={{ width: `${pct}%` }}
                />
              </div>
            </div>
          );
        })}
        {resources.length === 0 && (
          <div className="col-span-full text-gray-500 italic text-xs">No resources gathered yet.</div>
        )}
      </div>

      {/* Recipe list */}
      <div className="space-y-2 max-h-[320px] overflow-y-auto">
        {recipes.length === 0 ? (
          <div className="text-gray-500 italic">No recipes available.</div>
        ) : (
          recipes.map((recipe) => (
            <div key={recipe.id} className="border border-white/10 rounded p-3 hover:border-amber-500/40">
              <div className="flex items-center justify-between mb-2">
                <div>
                  <div className="text-amber-200 font-medium">{recipe.output.name}</div>
                  <div className="text-[10px] text-gray-500 uppercase tracking-wider">
                    {recipe.category ?? recipe.output.type}
                  </div>
                </div>
                <button
                  type="button"
                  onClick={() => handleCraft(recipe)}
                  disabled={crafting === recipe.id}
                  className="px-3 py-1 bg-amber-600 hover:bg-amber-500 disabled:opacity-40 rounded text-white text-xs"
                >
                  {crafting === recipe.id ? 'Crafting...' : 'Craft'}
                </button>
              </div>
              <div className="text-xs text-gray-400">
                Requires:&nbsp;
                {recipe.ingredients.map((ing, i) => (
                  <span key={i} className="mr-2">
                    {ing.quantity}x {ing.name ?? ing.type ?? ing.dtuId}
                  </span>
                ))}
              </div>
            </div>
          ))
        )}
      </div>

      {/* Toast */}
      {toast && (
        <div
          className={`fixed bottom-4 right-4 px-3 py-2 rounded text-sm shadow-lg ${
            toast.kind === 'ok' ? 'bg-emerald-700 text-white' : 'bg-rose-700 text-white'
          }`}
        >
          {toast.msg}
        </div>
      )}
    </div>
  );
}
