'use client';

/**
 * RockMineralIdPanel — hand-specimen identification bench for the geology
 * lens. Wires geology.rockClassify + geology.mineralId (the two
 * pure-compute macros that shipped with the domain but had zero UI —
 * every other geology macro already has a bespoke component; these two
 * did not). Modeled on the Mindat/USGS field-ID workflow: enter the
 * observable properties (Mohs hardness, luster, streak, cleavage,
 * fracture, specific gravity), get a classification.
 */

import { useState } from 'react';
import { Gem, Mountain } from 'lucide-react';
import { CalcPanel } from '@/components/lens-primitives/CalcPanel';

interface RockInput { name: string; mohsHardness: number; luster: string; color: string; texture: string }
interface MineralInput { name: string; hardness: number; streak: string; cleavage: string; fracture: string; specificGravity: number; color: string }
interface RockResult { specimen?: string; rockType?: string; mohsHardness?: number; luster?: string; color?: string; texture?: string; durability?: string; commonUses?: string[] }
interface MineralResult {
  specimen?: string;
  properties?: { hardness: number; streak: string; cleavage: string; fracture: string; specific_gravity: number };
  identificationConfidence?: number;
  testsPerformed?: number;
  testsRecommended?: string[];
  classification?: string;
}

const LUSTERS = ['metallic', 'vitreous', 'pearly', 'silky', 'resinous', 'earthy', 'dull', 'waxy'];
const TEXTURES = ['crystalline', 'foliated', 'vesicular', 'porphyritic', 'clastic', 'fossiliferous', 'fine-grained', 'coarse-grained'];
const CLEAVAGES = ['none', 'one direction', 'two directions', 'three directions', 'perfect', 'imperfect'];
const FRACTURES = ['conchoidal', 'uneven', 'fibrous', 'hackly', 'splintery'];

const ROCK_TYPE_COLOR: Record<string, string> = {
  igneous: 'text-red-300', sedimentary: 'text-yellow-300', metamorphic: 'text-purple-300', unclassified: 'text-zinc-400',
};

export function RockMineralIdPanel() {
  const [rock, setRock] = useState<RockInput>({ name: '', mohsHardness: 5, luster: 'vitreous', color: '', texture: 'crystalline' });
  const [mineral, setMineral] = useState<MineralInput>({ name: '', hardness: 5, streak: '', cleavage: 'none', fracture: 'conchoidal', specificGravity: 2.7, color: '' });

  return (
    <CalcPanel<RockResult, MineralResult>
      title="Rock & mineral identification"
      domain="geology"
      icon={<Gem className="h-5 w-5 text-orange-400" />}
      macroBadge="geology.rockClassify + mineralId"
      accent="orange"
      left={{
        macro: 'rockClassify',
        buildArtifact: () => ({ data: rock }),
        render: (
          <div className="space-y-2 rounded-lg border border-zinc-800 bg-zinc-950/40 p-3">
            <div className="flex items-center gap-1 text-[10px] uppercase tracking-wider text-zinc-400"><Mountain className="h-3 w-3" />Hand specimen (rock)</div>
            <input className="w-full rounded border border-zinc-800 bg-zinc-950 px-2 py-1 text-xs text-white" placeholder="Specimen name" value={rock.name} onChange={(e) => setRock({ ...rock, name: e.target.value })} />
            <div className="grid grid-cols-2 gap-2">
              <label className="block"><span className="block text-[9px] uppercase tracking-wider text-zinc-400">Mohs hardness ({rock.mohsHardness})</span>
                <input type="range" min={0} max={10} step={0.5} className="mt-1 w-full" value={rock.mohsHardness} onChange={(e) => setRock({ ...rock, mohsHardness: Number(e.target.value) })} /></label>
              <label className="block"><span className="block text-[9px] uppercase tracking-wider text-zinc-400">Luster</span>
                <select className="mt-1 w-full rounded border border-zinc-800 bg-zinc-950 px-2 py-1 text-xs text-white" value={rock.luster} onChange={(e) => setRock({ ...rock, luster: e.target.value })}>
                  {LUSTERS.map((l) => <option key={l} value={l}>{l}</option>)}
                </select></label>
            </div>
            <div className="grid grid-cols-2 gap-2">
              <input className="rounded border border-zinc-800 bg-zinc-950 px-2 py-1 text-xs text-white" placeholder="Color" value={rock.color} onChange={(e) => setRock({ ...rock, color: e.target.value })} />
              <label className="block"><span className="sr-only">Texture</span>
                <select className="w-full rounded border border-zinc-800 bg-zinc-950 px-2 py-1 text-xs text-white" value={rock.texture} onChange={(e) => setRock({ ...rock, texture: e.target.value })}>
                  {TEXTURES.map((t) => <option key={t} value={t}>{t}</option>)}
                </select></label>
            </div>
            <p className="text-[9px] text-zinc-500">Texture drives the igneous / sedimentary / metamorphic call — crystalline+foliated → metamorphic, vesicular+porphyritic → igneous, clastic+fossiliferous → sedimentary.</p>
          </div>
        ),
      }}
      right={{
        macro: 'mineralId',
        buildArtifact: () => ({ data: mineral }),
        render: (
          <div className="space-y-2 rounded-lg border border-zinc-800 bg-zinc-950/40 p-3">
            <div className="flex items-center gap-1 text-[10px] uppercase tracking-wider text-zinc-400"><Gem className="h-3 w-3" />Mineral test battery</div>
            <input className="w-full rounded border border-zinc-800 bg-zinc-950 px-2 py-1 text-xs text-white" placeholder="Specimen name" value={mineral.name} onChange={(e) => setMineral({ ...mineral, name: e.target.value })} />
            <div className="grid grid-cols-2 gap-2">
              <label className="block"><span className="block text-[9px] uppercase tracking-wider text-zinc-400">Hardness ({mineral.hardness})</span>
                <input type="range" min={0} max={10} step={0.5} className="mt-1 w-full" value={mineral.hardness} onChange={(e) => setMineral({ ...mineral, hardness: Number(e.target.value) })} /></label>
              <label className="block"><span className="block text-[9px] uppercase tracking-wider text-zinc-400">Specific gravity</span>
                <input type="number" step={0.1} min={0} max={25} className="mt-1 w-full rounded border border-zinc-800 bg-zinc-950 px-2 py-1 text-xs text-white font-mono" value={mineral.specificGravity} onChange={(e) => setMineral({ ...mineral, specificGravity: Number(e.target.value) || 0 })} /></label>
            </div>
            <div className="grid grid-cols-2 gap-2">
              <input className="rounded border border-zinc-800 bg-zinc-950 px-2 py-1 text-xs text-white" placeholder="Streak color" value={mineral.streak} onChange={(e) => setMineral({ ...mineral, streak: e.target.value })} />
              <input className="rounded border border-zinc-800 bg-zinc-950 px-2 py-1 text-xs text-white" placeholder="Color" value={mineral.color} onChange={(e) => setMineral({ ...mineral, color: e.target.value })} />
            </div>
            <div className="grid grid-cols-2 gap-2">
              <select className="rounded border border-zinc-800 bg-zinc-950 px-2 py-1 text-xs text-white" value={mineral.cleavage} onChange={(e) => setMineral({ ...mineral, cleavage: e.target.value })}>
                {CLEAVAGES.map((c) => <option key={c} value={c}>{c} cleavage</option>)}
              </select>
              <select className="rounded border border-zinc-800 bg-zinc-950 px-2 py-1 text-xs text-white" value={mineral.fracture} onChange={(e) => setMineral({ ...mineral, fracture: e.target.value })}>
                {FRACTURES.map((f) => <option key={f} value={f}>{f} fracture</option>)}
              </select>
            </div>
          </div>
        ),
      }}
      renderResults={(rockResult, mineralResult) => (
        <>
          <div className="rounded-lg border border-orange-500/20 bg-orange-500/5 p-3">
            <div className="mb-2 flex items-center gap-1 text-[10px] uppercase tracking-wider text-zinc-400"><Mountain className="h-3 w-3" />Rock classification</div>
            {!rockResult && <div className="text-[11px] text-zinc-400">Classify to compute.</div>}
            {rockResult && (
              <div className="space-y-2 text-[11px]">
                <div className="flex items-center gap-2">
                  <span className={`font-mono text-lg capitalize ${ROCK_TYPE_COLOR[rockResult.rockType || 'unclassified']}`}>{rockResult.rockType}</span>
                  <span className="rounded bg-zinc-800 px-2 py-0.5 text-[10px] text-zinc-300">{rockResult.durability}</span>
                </div>
                {rockResult.commonUses && (
                  <div className="flex flex-wrap gap-1">
                    {rockResult.commonUses.map((u) => <span key={u} className="rounded border border-orange-500/20 bg-zinc-950/40 px-1.5 py-0.5 text-[10px] text-orange-200">{u}</span>)}
                  </div>
                )}
              </div>
            )}
          </div>
          <div className="rounded-lg border border-purple-500/20 bg-purple-500/5 p-3">
            <div className="mb-2 flex items-center gap-1 text-[10px] uppercase tracking-wider text-zinc-400"><Gem className="h-3 w-3" />Mineral ID confidence</div>
            {!mineralResult && <div className="text-[11px] text-zinc-400">Run tests to score.</div>}
            {mineralResult && (
              <div className="space-y-2 text-[11px]">
                <div className="flex items-baseline gap-2">
                  <span className="font-mono text-2xl text-purple-200">{mineralResult.identificationConfidence}%</span>
                  <span className="text-zinc-400">· {mineralResult.testsPerformed} tests performed</span>
                </div>
                <div className="rounded border border-purple-500/15 bg-zinc-950/40 px-2 py-1 capitalize text-purple-200">{mineralResult.classification?.replace(/-/g, ' ')}</div>
                {!!mineralResult.testsRecommended?.length && (
                  <div className="space-y-0.5">
                    <div className="text-[9px] uppercase text-zinc-400">Recommended next tests</div>
                    <div className="flex flex-wrap gap-1">
                      {mineralResult.testsRecommended.map((t) => <span key={t} className="rounded border border-zinc-800 bg-zinc-950/40 px-1.5 py-0.5 text-[10px] text-zinc-300">{t}</span>)}
                    </div>
                  </div>
                )}
              </div>
            )}
          </div>
        </>
      )}
      dtu={{
        apiSource: 'concord-geology-identification',
        title: (r, m) => `Specimen ID — ${r.rockType ?? '—'} rock · ${m.classification?.replace(/-/g, ' ') ?? '—'} mineral`,
        content: (r, m) =>
          `Rock classification:\n  Type: ${r.rockType}\n  Hardness: ${r.mohsHardness}\n  Durability: ${r.durability}\n  Uses: ${(r.commonUses || []).join(', ')}\n\nMineral ID:\n  Classification: ${m.classification}\n  Confidence: ${m.identificationConfidence}%\n  Tests performed: ${m.testsPerformed}\n  Recommended: ${(m.testsRecommended || []).join(', ')}`,
        tags: () => ['geology', 'identification', 'rock', 'mineral'],
        rawData: (r, m) => ({ rock, mineral, rockResult: r, mineralResult: m }),
      }}
    />
  );
}
