'use client';

import { useEffect, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { Hammer, Loader2, Award, Boxes } from 'lucide-react';
import { api } from '@/lib/api/client';
import { SaveAsDtuButton } from '@/components/dtu/SaveAsDtuButton';

// Shapes mirror the REAL server/routes/crafting.js response bodies — the
// earlier shapes here (flat name/kind/tier/ingredients/output/difficulty/
// xpReward on the recipe; a bare `skills` array on the skill query) were
// fabricated guesses that never matched the endpoint, so this panel always
// rendered blank recipe metadata and an always-empty skills list even with
// real data present. `/recipes` returns raw `dtus` rows (`id`/`title`/
// `data.spec.*`); `/skills` returns `{ skillLevels, skillDTUs }` rows from
// `player_skill_levels` (`skill_type`/`level`/`xp`/`xp_to_next`/
// `native_world_type`). Aligned 2026-07-09.
interface RecipeSpec {
  output?: { type?: string; name?: string; quality?: number };
  skill_requirements?: Array<{ skill_type: string; level: number }>;
  resource_requirements?: Array<{ resource_type: string; quantity: number }>;
}
interface Recipe { id: string; title: string; created_at?: string; data?: { spec?: RecipeSpec } | string }
interface SkillLevel { id?: string; skill_type: string; native_world_type?: string; level: number; xp: number; xp_to_next: number }

function recipeSpec(r: Recipe): RecipeSpec | undefined {
  const data = typeof r.data === 'string' ? safeParseJson(r.data) : r.data;
  return (data as { spec?: RecipeSpec } | undefined)?.spec;
}
function safeParseJson(s: string): unknown { try { return JSON.parse(s); } catch { return undefined; } }

export function RecipeLedger() {
  const [tick, setTick] = useState(0);
  useEffect(() => { const id = setInterval(() => setTick((t) => t + 1), 30000); return () => clearInterval(id); }, []);
  useEffect(() => { void tick; }, [tick]);

  const recipes = useQuery({
    queryKey: ['crafting-recipes'],
    queryFn: async () => {
      const r = await api.get('/api/crafting/recipes');
      const data = r.data as { recipes?: Recipe[] };
      return (data.recipes || []) as Recipe[];
    },
    refetchInterval: 30000,
  });
  const skills = useQuery({
    queryKey: ['crafting-skills'],
    queryFn: async () => {
      const r = await api.get('/api/crafting/skills');
      const data = r.data as { skillLevels?: SkillLevel[] };
      return (data.skillLevels || []) as SkillLevel[];
    },
    refetchInterval: 60000,
  });

  const r = recipes.data || [];
  const s = skills.data || [];

  return (
    <div className="space-y-4">
      <header className="flex items-center justify-between gap-3 border-b border-cyan-500/15 pb-3">
        <div className="flex items-center gap-2">
          <Hammer className="h-5 w-5 text-cyan-400" />
          <h2 className="text-sm font-semibold text-white">Recipe ledger &amp; skill tree</h2>
          <span className="rounded bg-zinc-800 px-1.5 py-0.5 font-mono text-[10px] uppercase tracking-wider text-zinc-400">/api/crafting/recipes + /skills · live</span>
        </div>
        {(r.length > 0 || s.length > 0) && (
          <SaveAsDtuButton
            compact
            apiSource="concord-crafting"
            title={`Crafting ledger — ${r.length} recipes · ${s.length} skills`}
            content={`Recipes (${r.length}):\n${r.slice(0, 15).map((x) => { const spec = recipeSpec(x); return `  ${x.title || x.id} · ${spec?.output?.type || '?'} · xp -`; }).join('\n')}\n\nSkills (${s.length}):\n${s.map((x) => `  ${x.skill_type} · L${x.level ?? '-'} · xp ${x.xp ?? '-'}/${x.xp_to_next ?? '-'}${x.native_world_type ? ` · ${x.native_world_type}` : ''}`).join('\n')}`}
            extraTags={['crafting', 'recipes', 'skills']}
            rawData={{ recipes: r, skills: s }}
          />
        )}
      </header>
      {(recipes.isError || skills.isError) && <div className="rounded border border-red-500/20 bg-red-500/5 px-3 py-2 text-xs text-red-300">Crafting backend unreachable.</div>}
      <div className="grid grid-cols-1 gap-3 md:grid-cols-2">
        <div className="rounded-md border border-zinc-800 bg-zinc-950/40 p-3">
          <div className="mb-2 flex items-center gap-1 text-xs font-semibold text-zinc-200"><Boxes className="h-3.5 w-3.5 text-cyan-400" /> Recipes ({r.length})</div>
          <div className="space-y-1 max-h-72 overflow-y-auto">
            {r.map((x, i) => {
              const spec = recipeSpec(x);
              return (
                <div key={x.id || i} className="rounded border border-zinc-800 bg-zinc-950 p-2 text-[11px]">
                  <div className="flex items-center justify-between">
                    <span className="text-white">{x.title || x.id}</span>
                    {spec?.output?.quality != null && (
                      <span className="rounded bg-amber-500/20 px-1 font-mono text-[9px] text-amber-300">
                        Q{Math.round(Number(spec.output.quality) * 100) / 100}
                      </span>
                    )}
                  </div>
                  <div className="mt-0.5 flex flex-wrap gap-x-3 font-mono text-[10px] text-zinc-400">
                    {spec?.output?.type && <span>{spec.output.type.replace(/_/g, ' ')}</span>}
                    {(spec?.skill_requirements?.length ?? 0) > 0 && <span>{spec!.skill_requirements!.length} skill req</span>}
                    {(spec?.resource_requirements?.length ?? 0) > 0 && <span>{spec!.resource_requirements!.length} resource req</span>}
                    {spec?.output?.name && <span>→ {spec.output.name}</span>}
                  </div>
                </div>
              );
            })}
            {r.length === 0 && <div className="rounded border border-dashed border-zinc-800 p-3 text-center text-[10px] text-zinc-400">No recipes available.</div>}
          </div>
        </div>
        <div className="rounded-md border border-zinc-800 bg-zinc-950/40 p-3">
          <div className="mb-2 flex items-center gap-1 text-xs font-semibold text-zinc-200"><Award className="h-3.5 w-3.5 text-cyan-400" /> Skills ({s.length})</div>
          <div className="space-y-1 max-h-72 overflow-y-auto">
            {s.map((x, i) => {
              const pct = x.xp_to_next ? (x.xp / x.xp_to_next) * 100 : 0;
              return (
                <div key={x.id || i} className="rounded border border-zinc-800 bg-zinc-950 p-2 text-[11px]">
                  <div className="flex items-center justify-between">
                    <span className="text-white">
                      {x.skill_type}
                      {x.native_world_type && <span className="text-zinc-500"> · {x.native_world_type}</span>}
                    </span>
                    <span className="font-mono text-[10px] text-cyan-300">L{x.level ?? '-'}</span>
                  </div>
                  {x.xp_to_next > 0 && (
                    <div className="mt-1 h-1.5 w-full rounded-full bg-zinc-800">
                      <div className="h-full rounded-full bg-cyan-500/60" style={{ width: `${Math.min(100, pct)}%` }} />
                    </div>
                  )}
                  <div className="mt-0.5 font-mono text-[10px] text-zinc-400">{x.xp ?? '-'} / {x.xp_to_next ?? '-'} xp</div>
                </div>
              );
            })}
            {s.length === 0 && <div className="rounded border border-dashed border-zinc-800 p-3 text-center text-[10px] text-zinc-400">No skills tracked.</div>}
          </div>
        </div>
      </div>
      {(recipes.isPending || skills.isPending) && <div className="flex items-center gap-2 text-xs text-zinc-400"><Loader2 className="h-4 w-4 animate-spin" /> Polling…</div>}
    </div>
  );
}
