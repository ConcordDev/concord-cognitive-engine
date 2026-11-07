'use client';

/**
 * StratigraphicColumnPanel — builds a real stratigraphic column from
 * user-entered layers via geology.stratigraphicColumn (a pure-compute
 * macro that had zero UI before this rebuild — the lens previously
 * showed a hardcoded, unvarying Cenozoic→Paleozoic time-scale table in
 * its place, which never reflected anything the user entered).
 */

import { useState } from 'react';
import { useMutation } from '@tanstack/react-query';
import { Layers, Plus, Trash2, Wand2, Loader2 } from 'lucide-react';
import { lensRun } from '@/lib/api/client';
import { SaveAsDtuButton } from '@/components/dtu/SaveAsDtuButton';

interface LayerInput { name: string; lithology: string; thickness: number; age: string; fossils: string }
interface ColumnLayer {
  formation: string; lithology: string; thickness: number; depthTop: number; depthBottom: number; age: string; fossils: string[];
}
interface ColumnResult {
  layers: ColumnLayer[]; totalThickness: number; layerCount: number; oldestFormation?: string; youngestFormation?: string; fossiliferous: number;
}

const LITHOLOGIES = ['sandstone', 'shale', 'limestone', 'conglomerate', 'basalt', 'granite', 'schist', 'gneiss', 'mudstone', 'siltstone', 'coal', 'other'];

const emptyLayer = (): LayerInput => ({ name: '', lithology: 'sandstone', thickness: 10, age: '', fossils: '' });

export function StratigraphicColumnPanel() {
  // Layers are entered youngest-first (top of column), matching how a
  // geologist reads a real section — the macro accumulates depth in that order.
  const [layers, setLayers] = useState<LayerInput[]>([emptyLayer()]);
  const [result, setResult] = useState<ColumnResult | null>(null);

  const build = useMutation({
    mutationFn: async () => {
      const r = await lensRun<{ message?: string } & Partial<ColumnResult>>('geology', 'stratigraphicColumn', {
        layers: layers
          .filter((l) => l.name.trim())
          .map((l) => ({
            name: l.name.trim(),
            lithology: l.lithology,
            thickness: l.thickness,
            age: l.age.trim() || 'unknown',
            fossils: l.fossils.split(',').map((f) => f.trim()).filter(Boolean),
          })),
      });
      return r.data;
    },
    onSuccess: (data) => {
      if (data?.ok && data.result && 'layers' in data.result) setResult(data.result as ColumnResult);
      else setResult(null);
    },
  });

  const addLayer = () => setLayers((ls) => [...ls, emptyLayer()]);
  const removeLayer = (i: number) => setLayers((ls) => ls.filter((_, idx) => idx !== i));
  const updateLayer = <K extends keyof LayerInput>(i: number, key: K, value: LayerInput[K]) =>
    setLayers((ls) => ls.map((l, idx) => (idx === i ? { ...l, [key]: value } : l)));

  return (
    <div className="space-y-4">
      <header className="flex flex-wrap items-center justify-between gap-3 border-b border-orange-500/15 pb-3">
        <div className="flex items-center gap-2">
          <Layers className="h-5 w-5 text-orange-400" />
          <h2 className="text-sm font-semibold text-white">Stratigraphic column builder</h2>
          <span className="rounded bg-zinc-800 px-1.5 py-0.5 font-mono text-[10px] uppercase tracking-wider text-zinc-400">geology.stratigraphicColumn</span>
        </div>
        {result && (
          <SaveAsDtuButton
            compact
            apiSource="concord-geology-stratigraphy"
            title={`Stratigraphic column — ${result.layerCount} layers, ${result.totalThickness}m (${result.youngestFormation ?? '?'} to ${result.oldestFormation ?? '?'})`}
            content={result.layers.map((l) => `${l.formation}: ${l.lithology}, ${l.thickness}m (${l.depthTop}-${l.depthBottom}m), age ${l.age}${l.fossils.length ? `, fossils: ${l.fossils.join(', ')}` : ''}`).join('\n')}
            extraTags={['geology', 'stratigraphy', 'column']}
            rawData={result}
          />
        )}
      </header>

      <div className="space-y-1.5 rounded-lg border border-zinc-800 bg-zinc-950/40 p-3">
        <div className="text-[9px] uppercase tracking-wider text-zinc-400">Layers, youngest (top) first</div>
        {layers.map((l, i) => (
          <div key={i} className="grid grid-cols-[1fr_110px_70px_90px_1fr_28px] gap-1.5">
            <input className="rounded border border-zinc-800 bg-zinc-950 px-1.5 py-1 text-[11px] text-white" placeholder="Formation name" value={l.name} onChange={(e) => updateLayer(i, 'name', e.target.value)} />
            <select className="rounded border border-zinc-800 bg-zinc-950 px-1.5 py-1 text-[11px] text-white" value={l.lithology} onChange={(e) => updateLayer(i, 'lithology', e.target.value)}>
              {LITHOLOGIES.map((lt) => <option key={lt} value={lt}>{lt}</option>)}
            </select>
            <input type="number" min={0} step={0.5} className="rounded border border-zinc-800 bg-zinc-950 px-1.5 py-1 text-[11px] text-white font-mono" placeholder="m" value={l.thickness} onChange={(e) => updateLayer(i, 'thickness', Number(e.target.value) || 0)} />
            <input className="rounded border border-zinc-800 bg-zinc-950 px-1.5 py-1 text-[11px] text-white" placeholder="Age" value={l.age} onChange={(e) => updateLayer(i, 'age', e.target.value)} />
            <input className="rounded border border-zinc-800 bg-zinc-950 px-1.5 py-1 text-[11px] text-white" placeholder="Fossils, comma-sep" value={l.fossils} onChange={(e) => updateLayer(i, 'fossils', e.target.value)} />
            <button type="button" onClick={() => removeLayer(i)} disabled={layers.length <= 1} className="rounded border border-zinc-800 text-xs text-zinc-400 hover:text-rose-300 disabled:opacity-30" aria-label="Remove layer"><Trash2 className="mx-auto h-3 w-3" /></button>
          </div>
        ))}
        <div className="flex items-center gap-2 pt-1">
          <button type="button" onClick={addLayer} className="inline-flex items-center gap-1 rounded border border-zinc-800 bg-zinc-950 px-2 py-1 text-xs text-zinc-300 hover:border-orange-500/40 hover:text-orange-200"><Plus className="h-3 w-3" />Add layer</button>
          <button
            type="button"
            onClick={() => build.mutate()}
            disabled={build.isPending || !layers.some((l) => l.name.trim())}
            className="inline-flex items-center gap-1 rounded border border-orange-500/40 bg-orange-500/15 px-3 py-1.5 text-xs font-mono text-orange-200 hover:bg-orange-500/25 disabled:opacity-50"
          >
            {build.isPending ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Wand2 className="h-3.5 w-3.5" />}
            Build column
          </button>
        </div>
      </div>

      {result && (
        <div className="space-y-2 rounded-lg border border-orange-500/20 bg-orange-500/5 p-3">
          <div className="flex flex-wrap items-center gap-3 text-[11px] text-zinc-300">
            <span>Total thickness <span className="font-mono text-orange-200">{result.totalThickness}m</span></span>
            <span>{result.layerCount} layers</span>
            <span>{result.fossiliferous} fossiliferous</span>
          </div>
          <div className="space-y-0.5">
            {result.layers.map((l, i) => (
              <div key={i} className="flex items-center gap-2 rounded border border-zinc-800 bg-zinc-950/60 px-2 py-1.5" style={{ minHeight: `${Math.max(20, Math.min(60, l.thickness))}px` }}>
                <div className="w-20 shrink-0 font-mono text-[10px] text-zinc-400">{l.depthTop}–{l.depthBottom}m</div>
                <div className="min-w-0 flex-1">
                  <div className="truncate text-[11px] font-medium text-white">{l.formation} <span className="text-zinc-400">· {l.lithology}</span></div>
                  <div className="text-[9px] text-zinc-500">{l.age}{l.fossils.length ? ` · fossils: ${l.fossils.join(', ')}` : ''}</div>
                </div>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
