'use client';

import { useState } from 'react';
import { useMutation } from '@tanstack/react-query';
import { Leaf, Loader2, Search, Sun, Droplets, Thermometer, Sprout } from 'lucide-react';
import { apiHelpers } from '@/lib/api/client';
import { SaveAsDtuButton } from '@/components/dtu/SaveAsDtuButton';

interface PlantHit { id: number; commonName?: string; scientificName?: string; family?: string; image?: string; year?: number }
interface PlantDetail {
  id: number; commonName?: string; scientificName?: string; family?: string; genus?: string;
  edible?: boolean; ediblePart?: string[]; imageUrl?: string;
  growthHabit?: string; averageHeightCm?: number; maxHeightCm?: number;
  lightRequirement?: number; soilHumidity?: number; phMinimum?: number; phMaximum?: number;
  minimumTempC?: number; maximumTempC?: number; growthMonths?: string[]; bloomMonths?: string[];
}

interface MacroEnvelope<T> { ok: boolean; result?: T; error?: string }

async function callMacro<T>(action: string, input: Record<string, unknown>): Promise<MacroEnvelope<T>> {
  const r = await apiHelpers.lens.runDomain('landscaping', action, { input });
  const data = (r as { data?: { ok: boolean; result?: T } }).data;
  if (!data) return { ok: false, error: 'empty response' };
  if (data.ok && data.result && typeof data.result === 'object' && 'ok' in data.result) {
    return data.result as MacroEnvelope<T>;
  }
  return data as MacroEnvelope<T>;
}

export function PlantFinder() {
  const [query, setQuery] = useState('lavender');
  const [hits, setHits] = useState<PlantHit[]>([]);
  const [detail, setDetail] = useState<PlantDetail | null>(null);
  const [error, setError] = useState<string | null>(null);

  const search = useMutation({
    mutationFn: async () => {
      setError(null);
      const env = await callMacro<{ plants: PlantHit[] }>('trefle-search', { query: query.trim() });
      if (env.ok && env.result) { setHits(env.result.plants); setDetail(null); }
      else { setHits([]); setError(env.error || 'Trefle unavailable'); }
    },
  });

  const open = useMutation({
    mutationFn: async (id: number) => {
      setError(null);
      const env = await callMacro<PlantDetail>('trefle-plant', { id });
      if (env.ok && env.result) setDetail(env.result);
      else setError(env.error || 'detail fetch failed');
    },
  });

  return (
    <div className="space-y-4">
      <header className="flex items-center justify-between gap-3 border-b border-cyan-500/15 pb-3">
        <div className="flex items-center gap-2">
          <Leaf className="h-5 w-5 text-cyan-400" />
          <h2 className="text-sm font-semibold text-white">Plant Finder</h2>
          <span className="rounded bg-zinc-800 px-1.5 py-0.5 font-mono text-[10px] uppercase tracking-wider text-zinc-400">trefle.io · 1M+ species</span>
        </div>
      </header>
      <form onSubmit={(e) => { e.preventDefault(); if (query.trim()) search.mutate(); }} className="flex items-center gap-2">
        <div className="relative flex-1">
          <Search className="pointer-events-none absolute left-2.5 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-zinc-400" />
          <input type="text" value={query} onChange={(e) => setQuery(e.target.value)} placeholder="Common or scientific name…" className="w-full rounded-md border border-zinc-800 bg-zinc-950 py-1.5 pl-8 pr-3 text-sm text-white" />
        </div>
        <button type="submit" disabled={!query.trim() || search.isPending} className="inline-flex items-center gap-1.5 rounded-md border border-cyan-500/30 bg-cyan-500/10 px-3 py-1.5 text-xs text-cyan-200 hover:bg-cyan-500/20 disabled:opacity-50">
          {search.isPending ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Search className="h-3.5 w-3.5" />}
          Search
        </button>
      </form>

      {error && <div className="rounded border border-red-500/20 bg-red-500/5 px-3 py-2 text-xs text-red-300">{error}</div>}

      <div className="grid grid-cols-1 gap-3 md:grid-cols-3">
        <div className="md:col-span-1 space-y-1 max-h-[420px] overflow-y-auto">
          {hits.map((p) => (
            <button key={p.id} onClick={() => open.mutate(p.id)} className={`block w-full rounded border bg-zinc-950 p-2 text-left ${detail?.id === p.id ? 'border-cyan-500/40' : 'border-zinc-800 hover:border-cyan-500/30'}`}>
              <div className="flex gap-2">
                {p.image && (
                  // eslint-disable-next-line @next/next/no-img-element
                  <img src={p.image} alt="" className="h-10 w-10 rounded border border-zinc-800 object-cover" />
                )}
                <div className="min-w-0 flex-1">
                  <div className="line-clamp-1 text-sm text-white">{p.commonName || p.scientificName}</div>
                  <div className="line-clamp-1 font-mono text-[10px] italic text-zinc-400">{p.scientificName}</div>
                  {p.family && <div className="text-[10px] text-zinc-400">{p.family}{p.year ? ` · ${p.year}` : ''}</div>}
                </div>
              </div>
            </button>
          ))}
          {hits.length === 0 && !search.isPending && !error && (
            <div className="rounded border border-dashed border-zinc-800 p-4 text-center text-[11px] text-zinc-400">Search to see species.</div>
          )}
        </div>

        <div className="md:col-span-2">
          {detail ? (
            <div className="rounded-lg border border-cyan-500/20 bg-zinc-950/60 p-4">
              <div className="flex items-start justify-between gap-3">
                <div className="flex items-start gap-3">
                  {detail.imageUrl && (
                    // eslint-disable-next-line @next/next/no-img-element
                    <img src={detail.imageUrl} alt="" className="h-20 w-20 rounded-lg border border-zinc-800 object-cover" />
                  )}
                  <div>
                    <h3 className="text-base font-semibold text-white">{detail.commonName || detail.scientificName}</h3>
                    <p className="font-mono text-[11px] italic text-cyan-300/80">{detail.scientificName}</p>
                    <p className="text-[11px] text-zinc-400">{detail.family} · {detail.genus}{detail.growthHabit ? ` · ${detail.growthHabit}` : ''}</p>
                    {detail.edible && <span className="mt-1 inline-block rounded bg-emerald-500/20 px-1.5 py-0.5 text-[10px] text-emerald-300">Edible{detail.ediblePart?.length ? `: ${detail.ediblePart.join(', ')}` : ''}</span>}
                  </div>
                </div>
                <SaveAsDtuButton
                  compact
                  apiSource="trefle"
                  apiUrl={`https://trefle.io/api/v1/plants/${detail.id}`}
                  title={`${detail.commonName || detail.scientificName} — Trefle`}
                  content={`${detail.commonName || ''} (${detail.scientificName})\n${detail.family} · ${detail.genus}\n\nGrowth habit: ${detail.growthHabit || '—'}\nHeight: avg ${detail.averageHeightCm || '—'} cm / max ${detail.maxHeightCm || '—'} cm\nLight requirement: ${detail.lightRequirement ?? '—'}/10\nSoil humidity: ${detail.soilHumidity ?? '—'}/10\npH: ${detail.phMinimum ?? '—'}–${detail.phMaximum ?? '—'}\nTemp tolerance: ${detail.minimumTempC ?? '—'}°C to ${detail.maximumTempC ?? '—'}°C\nGrowth months: ${detail.growthMonths?.join(', ') || '—'}\nBloom months: ${detail.bloomMonths?.join(', ') || '—'}`}
                  extraTags={['landscaping', 'trefle', (detail.commonName || detail.scientificName || '').toLowerCase().replace(/\s+/g, '-')]}
                  rawData={detail}
                />
              </div>
              <div className="mt-3 grid grid-cols-2 gap-2 sm:grid-cols-4">
                <Cell label="Light" value={detail.lightRequirement != null ? `${detail.lightRequirement}/10` : '—'} icon={Sun} />
                <Cell label="Soil humidity" value={detail.soilHumidity != null ? `${detail.soilHumidity}/10` : '—'} icon={Droplets} />
                <Cell label="pH range" value={detail.phMinimum != null && detail.phMaximum != null ? `${detail.phMinimum}–${detail.phMaximum}` : '—'} />
                <Cell label="Temp" value={detail.minimumTempC != null && detail.maximumTempC != null ? `${detail.minimumTempC}°C…${detail.maximumTempC}°C` : '—'} icon={Thermometer} />
                <Cell label="Height" value={detail.averageHeightCm ? `${detail.averageHeightCm} cm avg` : detail.maxHeightCm ? `${detail.maxHeightCm} cm max` : '—'} icon={Sprout} />
                <Cell label="Growth mo." value={detail.growthMonths?.join('·') || '—'} />
                <Cell label="Bloom mo." value={detail.bloomMonths?.join('·') || '—'} />
                <Cell label="Edible" value={detail.edible ? 'yes' : 'no'} />
              </div>
            </div>
          ) : (
            <div className="rounded border border-dashed border-zinc-800 p-8 text-center text-[11px] text-zinc-400">Pick a species to see growth requirements.</div>
          )}
        </div>
      </div>
    </div>
  );
}

function Cell({ label, value, icon: Icon }: { label: string; value: string; icon?: React.ComponentType<{ className?: string }> }) {
  return (
    <div className="rounded border border-zinc-800 bg-zinc-950 px-2.5 py-1.5">
      <div className="flex items-center gap-1 text-[10px] uppercase tracking-wider text-zinc-400">{Icon && <Icon className="h-3 w-3" />}{label}</div>
      <div className="mt-0.5 font-mono text-sm text-cyan-300">{value}</div>
    </div>
  );
}
