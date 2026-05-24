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
  title?: string;
  name?: string;
  category?: string;
  ingredients: { dtuId?: string; type?: string; quantity: number; name?: string }[];
  output: { name: string; type: string; quality?: string };
  durationMs?: number;
  craftable?: boolean;
  missing?: { type: string; name: string; required: number; have: number }[];
}

interface InventoryRow {
  type: string;
  title: string;
  quantity: number;
}

interface CraftingPanelProps {
  worldId: string;
  onClose?: () => void;
}

const PANEL = 'rounded-lg border border-amber-500/30 bg-black/85 backdrop-blur-sm';

export default function CraftingPanelV2({ worldId: _worldId, onClose }: CraftingPanelProps) {
  const [recipes, setRecipes] = useState<Recipe[]>([]);
  const [inventory, setInventory] = useState<InventoryRow[]>([]);
  const [crafting, setCrafting] = useState<string | null>(null);
  const [toast, setToast] = useState<{ kind: 'ok' | 'err'; msg: string } | null>(null);

  const refresh = useCallback(() => {
    Promise.all([
      fetch('/api/starter/recipes', { credentials: 'include' }).then((r) => r.json()).catch(() => null),
      fetch('/api/starter/inventory', { credentials: 'include' }).then((r) => r.json()).catch(() => null),
    ]).then(([rec, inv]) => {
      setRecipes((rec?.recipes ?? []) as Recipe[]);
      setInventory((inv?.items ?? []) as InventoryRow[]);
    });
  }, []);

  useEffect(() => { refresh(); }, [refresh]);

  const showToast = useCallback((kind: 'ok' | 'err', msg: string) => {
    setToast({ kind, msg });
    setTimeout(() => setToast(null), 3000);
  }, []);

  const handleCraft = useCallback(async (recipe: Recipe) => {
    setCrafting(recipe.id);
    try {
      const r = await fetch('/api/starter/craft', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify({ recipeId: recipe.id }),
      });
      const data = await r.json();
      if (data?.ok) {
        showToast('ok', `Crafted ${recipe.output.name}.`);
        refresh();
        try {
          window.dispatchEvent(new CustomEvent('concordia:game-juice', {
            detail: { trigger: 'craft-complete', opts: { value: recipe.output.name } },
          }));
          window.dispatchEvent(new CustomEvent('concordia:tutorial-action', {
            detail: { action: 'crafted' },
          }));
          // Polish-pass craft-ding SFX (heard by WorldSFXHooks)
          window.dispatchEvent(new CustomEvent('concordia:craft-success', {
            detail: { recipeId: recipe.id, output: recipe.output.name },
          }));
          // Polish-pass item-acquisition toast — uses recipe.output.quality
          // tier as a rough rarity hint (tier_1 → common, tier_4 → epic)
          const qualityToRarity: Record<string, string> = {
            tier_1: 'common', tier_2: 'uncommon', tier_3: 'rare', tier_4: 'epic', tier_5: 'legendary',
          };
          window.dispatchEvent(new CustomEvent('concordia:item-acquired', {
            detail: {
              name: recipe.output.name,
              qty: 1,
              type: recipe.output.type ?? recipe.category ?? 'material',
              rarity: qualityToRarity[recipe.output.quality ?? 'tier_1'] ?? 'common',
            },
          }));
        } catch { /* ok */ }
      } else if (data?.error === 'insufficient_resources') {
        const missing = (data.missing ?? []).map((m: { name: string; required: number; have: number }) =>
          `${m.required - m.have}× ${m.name}`).join(', ');
        showToast('err', `Need: ${missing}`);
      } else {
        showToast('err', data?.error ?? 'Craft failed');
      }
    } catch {
      showToast('err', 'Network error');
    } finally {
      setCrafting(null);
    }
  }, [showToast, refresh]);

  return (
    <div className={`${PANEL} p-4 max-w-2xl w-full`}>
      <div className="flex items-center justify-between mb-3">
        <h3 className="text-amber-300 font-semibold text-lg">Crafting</h3>
        {onClose && (
          <button onClick={onClose} className="text-gray-400 hover:text-white text-sm">close</button>
        )}
      </div>

      {/* Inventory grid */}
      <div className="grid grid-cols-3 md:grid-cols-4 gap-2 mb-4 text-xs">
        {inventory.map((row) => (
          <div key={`${row.type}_${row.title}`} className="flex justify-between items-center bg-black/40 border border-white/5 rounded px-2 py-1">
            <span className="truncate text-gray-200">{row.title}</span>
            <span className="font-mono text-amber-300">{row.quantity}</span>
          </div>
        ))}
        {inventory.length === 0 && (
          <div className="col-span-full text-gray-400 italic">Empty inventory. Right-click terrain to gather.</div>
        )}
      </div>

      {/* Recipe list */}
      <div className="space-y-2 max-h-[320px] overflow-y-auto">
        {recipes.length === 0 ? (
          <div className="text-gray-400 italic">No recipes available.</div>
        ) : (
          recipes.map((recipe) => {
            const canCraft = recipe.craftable !== false;
            return (
              <div key={recipe.id} className={`border rounded p-3 transition-colors ${canCraft ? 'border-white/10 hover:border-amber-500/40' : 'border-white/5 opacity-60'}`}>
                <div className="flex items-center justify-between mb-2">
                  <div>
                    <div className="text-amber-200 font-medium">{recipe.output.name}</div>
                    <div className="text-[10px] text-gray-400 uppercase tracking-wider">
                      {recipe.category ?? recipe.output.type}
                    </div>
                  </div>
                  <button
                    type="button"
                    onClick={() => handleCraft(recipe)}
                    disabled={crafting === recipe.id || !canCraft}
                    className="px-3 py-1 bg-amber-600 hover:bg-amber-500 disabled:opacity-40 disabled:cursor-not-allowed rounded text-white text-xs"
                    title={!canCraft ? `Missing: ${(recipe.missing ?? []).map(m => `${m.required - m.have}× ${m.name}`).join(', ')}` : undefined}
                  >
                    {crafting === recipe.id ? 'Crafting...' : canCraft ? 'Craft' : 'Need more'}
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
            );
          })
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
