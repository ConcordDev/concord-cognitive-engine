'use client';

import { useEffect, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { Hammer, Loader2, Award, Boxes } from 'lucide-react';
import { api } from '@/lib/api/client';
import { SaveAsDtuButton } from '@/components/dtu/SaveAsDtuButton';

interface Recipe { id?: string; name?: string; kind?: string; tier?: number; ingredients?: { item: string; qty: number }[]; output?: { item: string; qty: number }; difficulty?: number; xpReward?: number; author?: string; createdAt?: string }
interface Skill { id?: string; type?: string; level?: number; xp?: number; unlocked?: boolean; nextThreshold?: number }

export function RecipeLedger() {
  const [tick, setTick] = useState(0);
  useEffect(() => { const id = setInterval(() => setTick((t) => t + 1), 30000); return () => clearInterval(id); }, []);
  useEffect(() => { void tick; }, [tick]);

  const recipes = useQuery({
    queryKey: ['crafting-recipes'],
    queryFn: async () => {
      const r = await api.get('/api/crafting/recipes');
      const data = r.data as { recipes?: Recipe[] } | Recipe[];
      return (Array.isArray(data) ? data : data.recipes || []) as Recipe[];
    },
    refetchInterval: 30000,
  });
  const skills = useQuery({
    queryKey: ['crafting-skills'],
    queryFn: async () => {
      const r = await api.get('/api/crafting/skills');
      const data = r.data as { skills?: Skill[] } | Skill[];
      return (Array.isArray(data) ? data : data.skills || []) as Skill[];
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
            content={`Recipes (${r.length}):\n${r.slice(0, 15).map((x) => `  ${x.name || x.id} · ${x.kind || '?'} · tier ${x.tier ?? '-'} · xp ${x.xpReward ?? '-'}`).join('\n')}\n\nSkills (${s.length}):\n${s.map((x) => `  ${x.type || x.id} · L${x.level ?? '-'} · xp ${x.xp ?? '-'}${x.unlocked ? '' : ' (locked)'}`).join('\n')}`}
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
            {r.map((x, i) => (
              <div key={x.id || i} className="rounded border border-zinc-800 bg-zinc-950 p-2 text-[11px]">
                <div className="flex items-center justify-between">
                  <span className="text-white">{x.name || x.id}</span>
                  {x.tier != null && <span className="rounded bg-amber-500/20 px-1 font-mono text-[9px] text-amber-300">T{x.tier}</span>}
                </div>
                <div className="mt-0.5 flex flex-wrap gap-x-3 font-mono text-[10px] text-zinc-500">
                  {x.kind && <span>{x.kind}</span>}
                  {x.difficulty != null && <span>diff {x.difficulty}</span>}
                  {x.xpReward != null && <span>+{x.xpReward} xp</span>}
                  {x.output && <span>→ {x.output.qty}× {x.output.item}</span>}
                </div>
              </div>
            ))}
            {r.length === 0 && <div className="rounded border border-dashed border-zinc-800 p-3 text-center text-[10px] text-zinc-500">No recipes available.</div>}
          </div>
        </div>
        <div className="rounded-md border border-zinc-800 bg-zinc-950/40 p-3">
          <div className="mb-2 flex items-center gap-1 text-xs font-semibold text-zinc-200"><Award className="h-3.5 w-3.5 text-cyan-400" /> Skills ({s.length})</div>
          <div className="space-y-1 max-h-72 overflow-y-auto">
            {s.map((x, i) => {
              const pct = x.nextThreshold && x.xp ? (x.xp / x.nextThreshold) * 100 : 0;
              return (
                <div key={x.id || i} className={`rounded border ${x.unlocked === false ? 'border-zinc-800 opacity-50' : 'border-zinc-800'} bg-zinc-950 p-2 text-[11px]`}>
                  <div className="flex items-center justify-between">
                    <span className="text-white">{x.type || x.id}</span>
                    <span className="font-mono text-[10px] text-cyan-300">L{x.level ?? '-'}</span>
                  </div>
                  {x.nextThreshold && (
                    <div className="mt-1 h-1.5 w-full rounded-full bg-zinc-800">
                      <div className="h-full rounded-full bg-cyan-500/60" style={{ width: `${Math.min(100, pct)}%` }} />
                    </div>
                  )}
                  <div className="mt-0.5 font-mono text-[10px] text-zinc-500">{x.xp ?? '-'} / {x.nextThreshold ?? '-'} xp</div>
                </div>
              );
            })}
            {s.length === 0 && <div className="rounded border border-dashed border-zinc-800 p-3 text-center text-[10px] text-zinc-500">No skills tracked.</div>}
          </div>
        </div>
      </div>
      {(recipes.isPending || skills.isPending) && <div className="flex items-center gap-2 text-xs text-zinc-500"><Loader2 className="h-4 w-4 animate-spin" /> Polling…</div>}
    </div>
  );
}
