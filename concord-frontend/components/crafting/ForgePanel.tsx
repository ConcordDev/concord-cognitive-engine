'use client';

import { useCallback, useEffect, useState } from 'react';
import { api } from '@/lib/api/client';
import {
  useArtifacts,
  useCreateArtifact,
} from '@/lib/hooks/use-lens-artifacts';
import {
  Beaker, RefreshCw, AlertCircle, Loader2, Sparkles, Hammer, Package,
} from 'lucide-react';
import {
  activeWorldId,
  type CraftingRecipe,
  type PlayerInventoryItem,
} from './crafting-shared';

export function ForgePanel({ onCrafted }: { onCrafted: () => void }) {
  const [recipes, setRecipes] = useState<CraftingRecipe[]>([]);
  const [inventory, setInventory] = useState<PlayerInventoryItem[]>([]);
  const [loading, setLoading] = useState(false);
  const [executing, setExecuting] = useState<string | null>(null);
  const [resultMsg, setResultMsg] = useState<Record<string, { ok: boolean; text: string }>>({});
  const [error, setError] = useState<string | null>(null);

  // Persisted craft sessions surfaced via the generic lens-artifact runtime
  // (POST /api/lens/crafting → runMacro("lens","create",{ domain:"crafting" })).
  // These records survive page reloads and feed analytics + cross-lens search.
  const sessionsQuery = useArtifacts<{
    recipeId: string;
    output: string;
    worldId: string;
    at: string;
  }>('crafting', { type: 'craft_session', limit: 5 });
  const createSession = useCreateArtifact<{
    recipeId: string;
    output: string;
    worldId: string;
    at: string;
  }>('crafting');

  const load = useCallback(async () => {
    setLoading(true); setError(null);
    try {
      const [recipeRes, invRes] = await Promise.all([
        api.get('/api/crafting/recipes'),
        api.get('/api/player-inventory', { params: { worldId: activeWorldId() } }),
      ]);
      setRecipes((recipeRes.data?.recipes ?? []) as CraftingRecipe[]);
      setInventory((invRes.data?.items ?? []) as PlayerInventoryItem[]);
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : 'Forge load failed');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { load(); }, [load]);

  async function executeCraftRecipe(recipeId: string) {
    setExecuting(recipeId);
    setResultMsg((prev) => ({ ...prev, [recipeId]: { ok: false, text: '' } }));
    try {
      const r = await api.post('/api/crafting/execute', {
        recipeId, worldId: activeWorldId(),
      });
      const out = r.data?.dtu?.title ?? r.data?.itemAdded?.item_name ?? 'crafted item';
      setResultMsg((prev) => ({
        ...prev, [recipeId]: { ok: true, text: `Crafted: ${out}` },
      }));
      // Record the craft session as a lens artifact so it persists across reloads
      // and is picked up by cross-lens discovery / analytics. Best-effort.
      createSession.mutate({
        type: 'craft_session',
        title: out,
        data: { recipeId, output: out, worldId: activeWorldId(), at: new Date().toISOString() },
        meta: { tags: ['crafting', 'forge'], status: 'completed', visibility: 'private' },
      });
      onCrafted();
      await load();
    } catch (e: unknown) {
      // axios error shape — server returns 422 with structured body
      type AxiosLike = { response?: { data?: { error?: string; missing_resources?: unknown[]; missing_skills?: unknown[] } }; message?: string };
      const ax = e as AxiosLike;
      const text =
        ax.response?.data?.error
          ? `${ax.response.data.error}${
              Array.isArray(ax.response.data.missing_resources) && ax.response.data.missing_resources.length
                ? ` (need ${ax.response.data.missing_resources.length} resource${ax.response.data.missing_resources.length === 1 ? '' : 's'})`
                : ''
            }${
              Array.isArray(ax.response.data.missing_skills) && ax.response.data.missing_skills.length
                ? ` (skill gap)`
                : ''
            }`
          : ax.message ?? 'Forge failed';
      setResultMsg((prev) => ({ ...prev, [recipeId]: { ok: false, text } }));
    } finally {
      setExecuting(null);
    }
  }

  return (
    <section>
      <div className="flex items-center justify-between mb-3">
        <div className="flex items-center gap-2">
          <Beaker className="w-4 h-4 text-cyan-300" />
          <h2 className="text-sm font-semibold">Forge — execute against inventory</h2>
        </div>
        <button
          onClick={load}
          className="text-white/40 hover:text-white text-xs inline-flex items-center gap-1"
        >
          <RefreshCw className="w-3 h-3" /> Refresh
        </button>
      </div>

      <InventoryStrip items={inventory} />

      {sessionsQuery.data?.artifacts && sessionsQuery.data.artifacts.length > 0 && (
        <div className="mt-2 text-[11px] text-white/50 flex flex-wrap items-center gap-1.5">
          <Sparkles className="w-3 h-3 text-amber-300" />
          <span className="text-white/40">Recent crafts:</span>
          {sessionsQuery.data.artifacts.slice(0, 5).map((a) => (
            <span key={a.id} className="bg-white/5 border border-white/10 rounded px-1.5 py-0.5 text-white/70">
              {a.title}
            </span>
          ))}
        </div>
      )}

      {error && (
        <div role="alert" className="flex items-center justify-between gap-3 bg-red-500/10 border border-red-500/30 rounded-md px-3 py-2 my-2">
          <span className="text-sm text-red-300 inline-flex items-center gap-1.5">
            <AlertCircle className="w-3.5 h-3.5" /> {error}
          </span>
          <button
            onClick={load}
            className="text-xs px-2 py-1 rounded border border-red-500/40 bg-red-500/10 hover:bg-red-500/20 text-red-200 inline-flex items-center gap-1"
          >
            <RefreshCw className="w-3 h-3" /> Retry
          </button>
        </div>
      )}

      {loading ? (
        <div role="status" aria-live="polite" className="flex items-center gap-2 text-white/60 mt-3">
          <Loader2 className="w-4 h-4 animate-spin" /> Loading…
        </div>
      ) : error ? null : recipes.length === 0 ? (
        <div className="bg-white/5 border border-white/10 rounded-lg p-4 mt-3 text-sm text-white/60">
          <p className="mb-2 inline-flex items-center gap-2">
            <AlertCircle className="w-4 h-4 text-amber-400" /> No craftable recipes yet.
          </p>
          <p className="text-xs text-white/40">
            Author a recipe under <span className="text-white/70">Author New</span> or buy one from <span className="text-white/70">Browse Marketplace</span>.
          </p>
        </div>
      ) : (
        <ul className="space-y-2 mt-3">
          {recipes.map((r) => {
            const data = typeof r.data === 'string' ? safeParse(r.data) : r.data;
            const spec = data?.spec;
            const result = resultMsg[r.id];
            return (
              <li key={r.id} className="bg-white/5 border border-white/10 rounded-lg p-3">
                <div className="flex items-start justify-between gap-3">
                  <div className="min-w-0 flex-1">
                    <p className="text-sm font-semibold truncate">{r.title}</p>
                    {spec?.output?.name && (
                      <p className="text-[11px] text-white/60 mt-0.5">
                        Output: <span className="text-white/80">{spec.output.name}</span>
                        {spec.output.quality != null && (
                          <span className="text-white/40"> · Q{Math.round(Number(spec.output.quality) * 100) / 100}</span>
                        )}
                      </p>
                    )}
                    <RequirementsRow
                      skills={spec?.skill_requirements ?? []}
                      resources={spec?.resource_requirements ?? []}
                      inventory={inventory}
                    />
                    {result && (
                      <p className={`text-[11px] mt-1 ${result.ok ? 'text-emerald-300' : 'text-red-300'}`}>
                        {result.ok && <Sparkles className="w-3 h-3 inline mr-1" />}
                        {result.text}
                      </p>
                    )}
                  </div>
                  <button
                    onClick={() => executeCraftRecipe(r.id)}
                    disabled={executing === r.id}
                    className="px-3 py-1.5 bg-cyan-500/20 border border-cyan-500/40 rounded-md text-xs hover:bg-cyan-500/30 disabled:opacity-50 inline-flex items-center gap-1"
                  >
                    {executing === r.id ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Hammer className="w-3.5 h-3.5" />}
                    Forge
                  </button>
                </div>
              </li>
            );
          })}
        </ul>
      )}
    </section>
  );
}

function safeParse(s: string): { spec?: CraftingRecipe['data'] extends infer T ? (T extends { spec?: infer S } ? S : undefined) : undefined } | undefined {
  try { return JSON.parse(s); } catch { return undefined; }
}

function InventoryStrip({ items }: { items: PlayerInventoryItem[] }) {
  if (items.length === 0) {
    return (
      <div className="bg-white/5 border border-white/10 rounded-lg p-2 text-xs text-white/50 inline-flex items-center gap-2">
        <Package className="w-3.5 h-3.5 text-white/40" /> Inventory empty in this world.
      </div>
    );
  }
  // Top 8 by quantity
  const sorted = [...items]
    .sort((a, b) => (b.quantity ?? 1) - (a.quantity ?? 1))
    .slice(0, 8);
  return (
    <div className="flex items-center gap-2 flex-wrap text-[11px]">
      <Package className="w-3.5 h-3.5 text-white/40" />
      {sorted.map((it) => (
        <span key={it.id} className="bg-white/5 border border-white/10 rounded px-2 py-0.5 text-white/70">
          {it.item_name}{it.quantity != null && it.quantity > 1 && <span className="text-white/40"> ×{it.quantity}</span>}
        </span>
      ))}
      {items.length > sorted.length && (
        <span className="text-white/40">+{items.length - sorted.length} more</span>
      )}
    </div>
  );
}

function RequirementsRow({
  skills, resources, inventory,
}: {
  skills: Array<{ skill_type: string; level: number }>;
  resources: Array<{ resource_type: string; quantity: number }>;
  inventory: PlayerInventoryItem[];
}) {
  if (skills.length === 0 && resources.length === 0) return null;
  return (
    <div className="flex flex-wrap items-center gap-1.5 mt-1.5">
      {skills.map((s, i) => (
        <span key={`s${i}`} className="text-[10px] bg-violet-500/10 border border-violet-500/20 rounded px-1.5 py-0.5 text-violet-200">
          {s.skill_type} ≥ {s.level}
        </span>
      ))}
      {resources.map((r, i) => {
        const have = inventory
          .filter((it) => (it.item_name === r.resource_type) || (it.item_type === r.resource_type))
          .reduce((sum, it) => sum + (it.quantity ?? 1), 0);
        const ok = have >= r.quantity;
        return (
          <span
            key={`r${i}`}
            className={`text-[10px] rounded px-1.5 py-0.5 border ${
              ok
                ? 'bg-emerald-500/10 border-emerald-500/30 text-emerald-200'
                : 'bg-rose-500/10 border-rose-500/30 text-rose-200'
            }`}
          >
            {r.resource_type} {have}/{r.quantity}
          </span>
        );
      })}
    </div>
  );
}
