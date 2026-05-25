'use client';

import { useState } from 'react';
import { useMutation } from '@tanstack/react-query';
import { Trees, Loader2, ExternalLink } from 'lucide-react';
import { SaveAsDtuButton } from '@/components/dtu/SaveAsDtuButton';

interface WikiSummary { title: string; extract?: string; description?: string; thumbnail?: { source: string }; content_urls?: { desktop?: { page: string } } }

const PRESETS = [
  'Oak', 'White oak', 'Red oak', 'Maple', 'Hard maple', 'Walnut', 'Black walnut',
  'Cherry', 'Mahogany', 'Pine', 'Douglas fir', 'Cedar', 'Western red cedar',
  'Teak', 'Birch', 'Ash (tree)', 'Beech', 'Poplar', 'Hickory', 'Cypress',
];

export function WoodSpeciesReference() {
  const [results, setResults] = useState<Record<string, WikiSummary>>({});
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const load = useMutation({
    mutationFn: async (species: string) => {
      setBusy(species); setError(null);
      try {
        const r = await fetch(`https://en.wikipedia.org/api/rest_v1/page/summary/${encodeURIComponent(species)}`);
        if (!r.ok) throw new Error(`wiki ${r.status}`);
        const data = (await r.json()) as WikiSummary;
        setResults((prev) => ({ ...prev, [species]: data }));
      } catch (e) { setError(e instanceof Error ? e.message : 'lookup failed'); }
      finally { setBusy(null); }
    },
  });

  const all = Object.entries(results);

  return (
    <div className="space-y-4">
      <header className="flex items-center justify-between gap-3 border-b border-cyan-500/15 pb-3">
        <div className="flex items-center gap-2">
          <Trees className="h-5 w-5 text-cyan-400" />
          <h2 className="text-sm font-semibold text-white">Wood species reference</h2>
          <span className="rounded bg-zinc-800 px-1.5 py-0.5 font-mono text-[10px] uppercase tracking-wider text-zinc-400">en.wikipedia.org REST · CC-BY-SA</span>
        </div>
        {all.length > 0 && (
          <SaveAsDtuButton
            compact
            apiSource="wikipedia"
            apiUrl="https://en.wikipedia.org/api/rest_v1/page/summary/"
            title={`Wood species reference — ${all.length} species`}
            content={all.map(([k, v]) => `${k}: ${v.description || ''}\n${v.extract?.slice(0, 300) || ''}\n${v.content_urls?.desktop?.page || ''}`).join('\n\n')}
            extraTags={['carpentry', 'wood-species', 'wikipedia']}
            rawData={results}
          />
        )}
      </header>
      <div className="flex flex-wrap gap-1 text-[10px]">
        {PRESETS.map((s) => (
          <button key={s} onClick={() => load.mutate(s)} disabled={busy === s} className={`rounded px-1.5 py-0.5 font-mono uppercase ${results[s] ? 'bg-cyan-500/20 text-cyan-200' : 'bg-zinc-800 text-zinc-400 hover:bg-zinc-700'}`}>{s}</button>
        ))}
      </div>
      {error && <div className="rounded border border-red-500/20 bg-red-500/5 px-3 py-2 text-xs text-red-300">{error}</div>}
      {load.isPending && <div className="flex items-center gap-2 text-xs text-zinc-400"><Loader2 className="h-4 w-4 animate-spin" /> Looking up {busy}…</div>}
      <div className="grid grid-cols-1 gap-3 md:grid-cols-2">
        {all.map(([k, v]) => (
          <a key={k} href={v.content_urls?.desktop?.page} target="_blank" rel="noopener noreferrer" className="block rounded-lg border border-cyan-500/20 bg-zinc-950/60 p-3 hover:border-cyan-500/40">
            <div className="flex gap-3">
              {v.thumbnail?.source && (
                // eslint-disable-next-line @next/next/no-img-element
                <img src={v.thumbnail.source} alt={v.title} className="h-16 w-16 rounded border border-zinc-800 object-cover" />
              )}
              <div className="min-w-0 flex-1">
                <div className="flex items-center gap-2">
                  <h3 className="font-semibold text-white">{v.title}</h3>
                  <ExternalLink className="h-3 w-3 text-zinc-400" />
                </div>
                {v.description && <p className="text-[10px] uppercase tracking-wider text-cyan-300/80">{v.description}</p>}
                <p className="mt-1 line-clamp-4 text-[11px] text-zinc-300">{v.extract}</p>
              </div>
            </div>
          </a>
        ))}
        {all.length === 0 && !load.isPending && (
          <div className="col-span-full rounded border border-dashed border-zinc-800 p-6 text-center text-[11px] text-zinc-400">Pick a species above to load real reference data.</div>
        )}
      </div>
    </div>
  );
}
