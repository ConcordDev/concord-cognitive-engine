'use client';

import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { Globe, Loader2, ExternalLink, Users, Languages } from 'lucide-react';
import { SaveAsDtuButton } from '@/components/dtu/SaveAsDtuButton';

interface Country {
  name: { common: string; official: string };
  cca3: string;
  capital?: string[];
  region: string;
  subregion?: string;
  population: number;
  area?: number;
  languages?: Record<string, string>;
  currencies?: Record<string, { name: string; symbol?: string }>;
  flags?: { png?: string; alt?: string };
}

const REGIONS = ['Africa', 'Americas', 'Asia', 'Europe', 'Oceania', 'Antarctic'];

export function CountryAtlas() {
  const [region, setRegion] = useState('Europe');

  const countries = useQuery({
    queryKey: ['restcountries', region],
    queryFn: async () => {
      const r = await fetch(`https://restcountries.com/v3.1/region/${region}?fields=name,cca3,capital,region,subregion,population,area,languages,currencies`);
      if (!r.ok) throw new Error(`rc ${r.status}`);
      const j = (await r.json()) as Country[];
      return j.sort((a, b) => b.population - a.population).slice(0, 30);
    },
    staleTime: 60 * 60 * 1000,
  });

  const list = countries.data || [];
  const totalPop = list.reduce((a, c) => a + (c.population || 0), 0);
  const subregions = new Set(list.map((c) => c.subregion).filter(Boolean)).size;

  return (
    <div className="space-y-4">
      <header className="flex flex-wrap items-center justify-between gap-3 border-b border-cyan-500/15 pb-3">
        <div className="flex items-center gap-2"><Globe className="h-5 w-5 text-sky-400" /><h2 className="text-sm font-semibold text-white">Global atlas — countries by region</h2><span className="rounded bg-zinc-800 px-1.5 py-0.5 font-mono text-[10px] uppercase tracking-wider text-zinc-400">restcountries.com</span></div>
        <div className="flex items-center gap-2">
          <select value={region} onChange={(e) => setRegion(e.target.value)} className="rounded border border-zinc-800 bg-zinc-950 px-2 py-1 text-xs text-white">{REGIONS.map((r) => <option key={r} value={r}>{r}</option>)}</select>
          {list.length > 0 && <SaveAsDtuButton compact apiSource="restcountries" apiUrl={`https://restcountries.com/v3.1/region/${region}`} title={`Country atlas — ${region} (${list.length} countries)`} content={list.slice(0, 30).map((c, i) => `${i + 1}. ${c.name.common} (${c.cca3}) · capital ${c.capital?.[0] || '—'} · pop ${c.population.toLocaleString()}`).join('\n')} extraTags={['global', 'countries', region.toLowerCase()]} rawData={{ region, countries: list }} />}
        </div>
      </header>
      {countries.isError && <div className="rounded border border-red-500/20 bg-red-500/5 px-3 py-2 text-xs text-red-300">REST Countries unreachable.</div>}
      <div className="grid grid-cols-3 gap-2">
        <div className="rounded border border-zinc-800 bg-zinc-950 px-2.5 py-1.5"><div className="text-[10px] uppercase tracking-wider text-zinc-500">Countries</div><div className="mt-0.5 font-mono text-lg text-sky-300">{list.length}</div></div>
        <div className="rounded border border-zinc-800 bg-zinc-950 px-2.5 py-1.5"><div className="text-[10px] uppercase tracking-wider text-zinc-500">Pop (sum)</div><div className="mt-0.5 font-mono text-lg text-sky-300">{totalPop > 1e9 ? `${(totalPop / 1e9).toFixed(2)}B` : `${(totalPop / 1e6).toFixed(0)}M`}</div></div>
        <div className="rounded border border-zinc-800 bg-zinc-950 px-2.5 py-1.5"><div className="text-[10px] uppercase tracking-wider text-zinc-500">Subregions</div><div className="mt-0.5 font-mono text-lg text-sky-300">{subregions}</div></div>
      </div>
      <div className="space-y-1 max-h-[500px] overflow-y-auto">
        {list.map((c) => (
          <a key={c.cca3} href={`https://en.wikipedia.org/wiki/${c.name.common.replace(/\s+/g, '_')}`} target="_blank" rel="noopener noreferrer" className="flex items-center gap-2 rounded border border-sky-500/15 bg-sky-500/5 p-2 text-[11px] hover:border-sky-500/40">
            <span className="w-10 shrink-0 font-mono text-[10px] text-zinc-500">{c.cca3}</span>
            <span className="flex-1 truncate font-mono text-zinc-100">{c.name.common}</span>
            <span className="hidden sm:inline truncate text-zinc-400">{c.capital?.[0] || ''}</span>
            <span className="flex items-center gap-1 font-mono text-zinc-400"><Users className="h-3 w-3" />{c.population > 1e6 ? `${(c.population / 1e6).toFixed(1)}M` : c.population.toLocaleString()}</span>
            <span className="hidden md:inline-flex items-center gap-1 font-mono text-zinc-500"><Languages className="h-3 w-3" />{Object.keys(c.languages || {}).length}</span>
            <ExternalLink className="h-3 w-3 text-zinc-500" />
          </a>
        ))}
      </div>
      {countries.isPending && <div className="flex items-center gap-2 text-xs text-zinc-500"><Loader2 className="h-4 w-4 animate-spin" /> Pulling…</div>}
    </div>
  );
}
