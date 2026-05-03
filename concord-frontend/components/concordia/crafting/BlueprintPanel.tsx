'use client';

import React, { useState, useEffect, useCallback } from 'react';
import { api } from '@/lib/api/client';
import { CraftingMinigame } from './CraftingMinigame';

interface Material { id: string; quantity: number; }
interface InventoryItem { item_id: string; quantity: number; }

interface Blueprint {
  id: string;
  title: string;
  createdAt: string;
  designTitle?: string;
  requiredMaterials?: Material[];
  requiredToolTier?: number;
  complexityScore?: number;
  craftingSteps?: string[];
}

interface BlueprintPanelProps {
  playerId: string;
  toolTier: number;
  skillLevel: number;
  onClose: () => void;
}

export function BlueprintPanel({ playerId: _playerId, toolTier, skillLevel, onClose }: BlueprintPanelProps) {
  const [blueprints, setBlueprints] = useState<Blueprint[]>([]);
  const [selected, setSelected] = useState<Blueprint | null>(null);
  const [inventory, setInventory] = useState<InventoryItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [crafting, setCrafting] = useState(false);
  const [result, setResult] = useState<string | null>(null);

  useEffect(() => {
    Promise.all([
      api.get('/api/blueprints').then(r => setBlueprints(r.data?.blueprints ?? [])),
      api.get('/api/world/inventory').then(r => setInventory(r.data?.items ?? [])).catch(() => {}),
    ]).finally(() => setLoading(false));
  }, []);

  const loadBlueprint = useCallback(async (id: string) => {
    const r = await api.get(`/api/blueprints/${id}`);
    setSelected(r.data?.blueprint ?? null);
  }, []);

  const hasMaterials = (bp: Blueprint) => {
    return (bp.requiredMaterials ?? []).every(mat => {
      const inv = inventory.find(i => i.item_id === mat.id);
      return (inv?.quantity ?? 0) >= mat.quantity;
    });
  };

  const hasToolTier = (bp: Blueprint) => toolTier >= (bp.requiredToolTier ?? 0);

  const canCraft = selected ? hasMaterials(selected) && hasToolTier(selected) : false;

  const handleMinigameComplete = useCallback(async (multiplier: number) => {
    setCrafting(false);
    if (!selected) return;
    try {
      const r = await api.post('/api/crafting/execute', {
        recipeId: selected.id,
        worldId: 'concordia',
        qualityMultiplier: multiplier,
      });
      const data = r.data;
      if (data?.ok) {
        setResult(`✓ Crafted ${data.dtu?.name ?? selected.designTitle ?? selected.title} at ×${multiplier} quality.`);
        // Refresh inventory so the materials-checklist updates immediately
        api.get('/api/world/inventory').then((ir) => setInventory(ir.data?.items ?? [])).catch(() => {});
        // Surface to the polish-pass toast + craft-ding via existing event channels
        if (typeof window !== 'undefined') {
          const ratedRarity = multiplier >= 1.4 ? 'epic'
            : multiplier >= 1.15 ? 'rare'
            : multiplier >= 0.9 ? 'uncommon'
            : 'common';
          window.dispatchEvent(new CustomEvent('concordia:item-acquired', {
            detail: {
              name: data.dtu?.name ?? selected.title,
              qty: 1,
              type: data.dtu?.type ?? 'item',
              rarity: ratedRarity,
            },
          }));
          window.dispatchEvent(new CustomEvent('concordia:craft-success', {
            detail: { recipeId: selected.id, quality: multiplier },
          }));
        }
      } else if (data?.error === 'Insufficient resources') {
        const missing = (data.missing_resources ?? []).map((m: { resource_id: string; shortage: number }) =>
          `${m.shortage}× ${m.resource_id}`).join(', ');
        setResult(`Need: ${missing}`);
      } else {
        setResult(data?.error ?? 'Craft failed.');
      }
    } catch {
      setResult('Network error — craft did not complete.');
    }
  }, [selected]);

  if (loading) {
    return (
      <div className="p-6 text-white/40 text-sm text-center">Loading blueprints…</div>
    );
  }

  if (crafting && selected) {
    return (
      <CraftingMinigame
        skillLevel={skillLevel}
        itemName={selected.designTitle ?? selected.title}
        onComplete={handleMinigameComplete}
        onCancel={() => setCrafting(false)}
      />
    );
  }

  return (
    <div className="flex flex-col h-full">
      <div className="flex items-center justify-between px-4 py-3 border-b border-white/10">
        <h3 className="text-white font-bold text-sm">Blueprints</h3>
        <button onClick={onClose} className="text-white/30 hover:text-white">✕</button>
      </div>

      <div className="flex flex-1 overflow-hidden">
        {/* Blueprint list */}
        <div className="w-44 border-r border-white/10 overflow-y-auto flex-shrink-0">
          {blueprints.length === 0 ? (
            <div className="p-4 text-white/30 text-xs text-center">No blueprints yet.<br/>Design something in any lens and press "→ Concordia Blueprint".</div>
          ) : (
            blueprints.map(bp => (
              <button
                key={bp.id}
                onClick={() => loadBlueprint(bp.id)}
                className={`w-full text-left px-3 py-2.5 text-xs border-b border-white/5 hover:bg-white/5 transition-all ${selected?.id === bp.id ? 'bg-white/10' : ''}`}
              >
                <div className="text-white font-medium truncate">{bp.title}</div>
                <div className="text-white/30 mt-0.5">{new Date(bp.createdAt).toLocaleDateString()}</div>
              </button>
            ))
          )}
        </div>

        {/* Blueprint detail */}
        <div className="flex-1 overflow-y-auto p-4 space-y-4">
          {!selected ? (
            <div className="text-white/30 text-xs text-center pt-8">Select a blueprint</div>
          ) : (
            <>
              <div>
                <div className="text-white font-semibold">{selected.designTitle ?? selected.title}</div>
                <div className="text-white/40 text-xs mt-1">Complexity: {selected.complexityScore ?? '?'}/100 · Tool Tier {selected.requiredToolTier ?? 0}</div>
              </div>

              {/* Tool tier check */}
              {!hasToolTier(selected) && (
                <div className="px-3 py-2 rounded-lg bg-red-500/10 border border-red-500/20 text-xs text-red-400">
                  Requires Tool Tier {selected.requiredToolTier} — you have Tier {toolTier}. Craft a better tool first.
                </div>
              )}

              {/* Materials checklist */}
              {(selected.requiredMaterials ?? []).length > 0 && (
                <div className="space-y-1.5">
                  <div className="text-white/50 text-xs font-semibold uppercase tracking-wider">Required Materials</div>
                  {selected.requiredMaterials!.map(mat => {
                    const have = inventory.find(i => i.item_id === mat.id)?.quantity ?? 0;
                    const ok = have >= mat.quantity;
                    return (
                      <div key={mat.id} className="flex items-center justify-between text-xs">
                        <span className={ok ? 'text-white' : 'text-white/50'}>{mat.id.replace(/_/g, ' ')}</span>
                        <span className={`font-mono ${ok ? 'text-green-400' : 'text-red-400'}`}>{have}/{mat.quantity}</span>
                      </div>
                    );
                  })}
                </div>
              )}

              {/* Crafting steps */}
              {(selected.craftingSteps ?? []).length > 0 && (
                <div className="space-y-1">
                  <div className="text-white/50 text-xs font-semibold uppercase tracking-wider">Steps</div>
                  {selected.craftingSteps!.map((step, i) => (
                    <div key={i} className="text-xs text-white/60 flex gap-2">
                      <span className="text-white/30 font-mono">{i + 1}.</span>
                      <span>{step}</span>
                    </div>
                  ))}
                </div>
              )}

              {result && (
                <div className="px-3 py-2 rounded-lg bg-green-500/10 border border-green-500/20 text-xs text-green-400">{result}</div>
              )}

              <button
                disabled={!canCraft}
                onClick={() => setCrafting(true)}
                className="w-full py-2.5 rounded-xl text-sm font-bold transition-all disabled:opacity-30 bg-green-700 hover:bg-green-600 text-white disabled:cursor-not-allowed"
              >
                {canCraft ? 'Begin Crafting' : 'Missing requirements'}
              </button>
            </>
          )}
        </div>
      </div>
    </div>
  );
}
