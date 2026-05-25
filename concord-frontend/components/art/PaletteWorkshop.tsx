'use client';

import { useState, useMemo } from 'react';
import { useMutation } from '@tanstack/react-query';
import { Palette, Loader2, Copy, Wand2 } from 'lucide-react';
import { apiHelpers } from '@/lib/api/client';
import { SaveAsDtuButton } from '@/components/dtu/SaveAsDtuButton';

interface PaletteEntry { hex: string; hsl?: { h: number; s: number; l: number }; role?: string }
interface HarmonyMatch { type: string; colors: [string, string]; hueDistance: number }
interface PaletteResult { palette?: PaletteEntry[]; baseColor?: string; harmony?: string }
interface HarmonyResult { colors?: Array<{ hex: string; rgb: { r: number; g: number; b: number }; hsl: { h: number; s: number; l: number } }>; harmonies?: HarmonyMatch[]; message?: string }

const HARMONIES = ['analogous', 'complementary', 'triadic', 'split-complementary', 'square', 'monochromatic'] as const;

async function callArt<T>(action: string, input: Record<string, unknown>): Promise<T | null> {
  try {
    const r = await apiHelpers.lens.runDomain('art', action, { input });
    const env = (r as { data?: { ok: boolean; result?: T } }).data;
    if (!env?.ok) return null;
    // Action results sometimes nest under .result.result
    const result = env.result as unknown as { ok?: boolean; result?: T } | T;
    if (result && typeof result === 'object' && 'ok' in result && 'result' in result) {
      return (result as { result: T }).result;
    }
    return env.result as T;
  } catch { return null; }
}

export function PaletteWorkshop() {
  const [baseColor, setBaseColor] = useState('#3498db');
  const [harmony, setHarmony] = useState<typeof HARMONIES[number]>('analogous');
  const [count, setCount] = useState(5);
  const [palette, setPalette] = useState<PaletteEntry[]>([]);
  const [harmonyAnalysis, setHarmonyAnalysis] = useState<HarmonyResult | null>(null);

  const generate = useMutation({
    mutationFn: async () => {
      const result = await callArt<PaletteResult>('generatePalette', { baseColor, harmony, count });
      const colors = result?.palette || [];
      setPalette(colors);
      if (colors.length > 0) {
        const harmRes = await callArt<HarmonyResult>('colorHarmony', { palette: colors.map((c) => c.hex) });
        setHarmonyAnalysis(harmRes);
      }
      return result;
    },
  });

  const copyHex = (hex: string) => { void navigator.clipboard.writeText(hex); };

  const harmonyCounts = useMemo(() => {
    if (!harmonyAnalysis?.harmonies) return {} as Record<string, number>;
    return harmonyAnalysis.harmonies.reduce<Record<string, number>>((acc, h) => { acc[h.type] = (acc[h.type] || 0) + 1; return acc; }, {});
  }, [harmonyAnalysis]);

  return (
    <div className="space-y-4">
      <header className="flex flex-wrap items-center justify-between gap-3 border-b border-cyan-500/15 pb-3">
        <div className="flex items-center gap-2">
          <Palette className="h-5 w-5 text-fuchsia-400" />
          <h2 className="text-sm font-semibold text-white">Palette workshop</h2>
          <span className="rounded bg-zinc-800 px-1.5 py-0.5 font-mono text-[10px] uppercase tracking-wider text-zinc-400">art.generatePalette + colorHarmony</span>
        </div>
        {palette.length > 0 && (
          <SaveAsDtuButton
            compact
            apiSource="concord-art-palette"
            title={`Palette — ${harmony} from ${baseColor} (${palette.length} colors)`}
            content={`Base: ${baseColor}\nHarmony: ${harmony}\nCount: ${palette.length}\n\nColors:\n${palette.map((c, i) => `${i + 1}. ${c.hex}${c.role ? ` (${c.role})` : ''}`).join('\n')}${harmonyAnalysis?.harmonies?.length ? `\n\nHarmonies detected:\n${Object.entries(harmonyCounts).map(([t, n]) => `  ${t}: ${n}`).join('\n')}` : ''}`}
            extraTags={['art', 'palette', harmony]}
            rawData={{ baseColor, harmony, count, palette, harmonyAnalysis }}
          />
        )}
      </header>
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-4">
        <label className="block">
          <span className="block text-[10px] uppercase tracking-wider text-zinc-400">Base color</span>
          <div className="mt-1 flex items-center gap-1">
            <input type="color" value={baseColor} onChange={(e) => setBaseColor(e.target.value)} className="h-8 w-12 cursor-pointer rounded border border-zinc-800 bg-zinc-950" />
            <input type="text" value={baseColor} onChange={(e) => setBaseColor(e.target.value)} className="flex-1 rounded border border-zinc-800 bg-zinc-950 px-2 py-1 font-mono text-xs text-white" />
          </div>
        </label>
        <label className="block">
          <span className="block text-[10px] uppercase tracking-wider text-zinc-400">Harmony</span>
          <select value={harmony} onChange={(e) => setHarmony(e.target.value as typeof HARMONIES[number])} className="mt-1 w-full rounded border border-zinc-800 bg-zinc-950 px-2 py-1.5 text-xs text-white">
            {HARMONIES.map((h) => <option key={h} value={h}>{h}</option>)}
          </select>
        </label>
        <label className="block">
          <span className="block text-[10px] uppercase tracking-wider text-zinc-400">Count</span>
          <input type="number" min={2} max={12} value={count} onChange={(e) => setCount(Math.max(2, Math.min(12, Number(e.target.value) || 5)))} className="mt-1 w-full rounded border border-zinc-800 bg-zinc-950 px-2 py-1.5 text-xs text-white" />
        </label>
        <button type="button" onClick={() => generate.mutate()} disabled={generate.isPending} className="mt-auto inline-flex items-center justify-center gap-1 rounded border border-fuchsia-500/40 bg-fuchsia-500/15 px-3 py-1.5 text-xs font-mono text-fuchsia-200 hover:bg-fuchsia-500/25 disabled:opacity-50">
          {generate.isPending ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Wand2 className="h-3.5 w-3.5" />}
          Generate
        </button>
      </div>
      {generate.isError && <div className="rounded border border-red-500/20 bg-red-500/5 px-3 py-2 text-xs text-red-300">Palette generation failed.</div>}
      {palette.length > 0 && (
        <div className="space-y-3">
          <div className="flex flex-wrap gap-1">
            {palette.map((c, i) => (
              <button key={`${c.hex}-${i}`} type="button" onClick={() => copyHex(c.hex)} className="group relative flex flex-col items-center gap-0.5 rounded border border-zinc-800 p-1 hover:border-zinc-600" title={`Click to copy ${c.hex}`}>
                <span className="block h-12 w-16 rounded" style={{ backgroundColor: c.hex }} />
                <span className="font-mono text-[10px] text-zinc-400">{c.hex}</span>
                {c.role && <span className="font-mono text-[9px] text-zinc-400">{c.role}</span>}
                <Copy className="absolute right-1 top-1 h-3 w-3 text-zinc-600 opacity-0 group-hover:opacity-100" />
              </button>
            ))}
          </div>
          {harmonyAnalysis?.harmonies && harmonyAnalysis.harmonies.length > 0 && (
            <div className="rounded-lg border border-fuchsia-500/20 bg-fuchsia-500/5 p-3 text-[11px]">
              <div className="mb-1 text-[10px] uppercase tracking-wider text-zinc-400">Harmony relationships ({harmonyAnalysis.harmonies.length})</div>
              <div className="flex flex-wrap gap-1.5">
                {Object.entries(harmonyCounts).map(([type, n]) => (
                  <span key={type} className="rounded bg-fuchsia-500/20 px-1.5 py-0.5 font-mono text-fuchsia-200">{type} ×{n}</span>
                ))}
              </div>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
