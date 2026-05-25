'use client';

import { useState } from 'react';
import { useMutation } from '@tanstack/react-query';
import { motion } from 'framer-motion';
import { PawPrint, Loader2, Search } from 'lucide-react';
import { apiHelpers } from '@/lib/api/client';
import { SaveAsDtuButton } from '@/components/dtu/SaveAsDtuButton';

interface Breed {
  id: string | number; name: string;
  bredFor?: string; breedGroup?: string;
  lifeSpan?: string; temperament?: string;
  origin?: string; countryCode?: string;
  weightImperial?: string; weightMetric?: string;
  heightImperial?: string; heightMetric?: string;
  description?: string; hypoallergenic?: boolean;
  wikipediaUrl?: string; referenceImageUrl?: string | null;
}

interface MacroEnvelope<T> { ok: boolean; result?: T; error?: string }

async function callMacro<T>(action: string, input: Record<string, unknown>): Promise<MacroEnvelope<T>> {
  const r = await apiHelpers.lens.runDomain('pets', action, { input });
  const data = (r as { data?: { ok: boolean; result?: T } }).data;
  if (!data) return { ok: false, error: 'empty response' };
  if (data.ok && data.result && typeof data.result === 'object' && 'ok' in data.result) {
    return data.result as MacroEnvelope<T>;
  }
  return data as MacroEnvelope<T>;
}

export function BreedExplorer() {
  const [species, setSpecies] = useState<'dog' | 'cat'>('dog');
  const [name, setName] = useState('');
  const [breeds, setBreeds] = useState<Breed[]>([]);

  const search = useMutation({
    mutationFn: async () => callMacro<{ breeds: Breed[] }>('breed-info', { species, name: name.trim() }),
    onSuccess: (env) => { if (env.ok && env.result) setBreeds(env.result.breeds); else setBreeds([]); },
  });

  return (
    <div className="space-y-4">
      <header className="flex items-center justify-between gap-3 border-b border-cyan-500/15 pb-3">
        <div className="flex items-center gap-2">
          <PawPrint className="h-5 w-5 text-cyan-400" />
          <h2 className="text-sm font-semibold text-white">Breed Explorer</h2>
          <span className="rounded bg-zinc-800 px-1.5 py-0.5 font-mono text-[10px] uppercase tracking-wider text-zinc-400">the dog/cat api</span>
        </div>
        <div className="flex gap-1 rounded-md border border-zinc-800 bg-zinc-950 p-0.5">
          {(['dog', 'cat'] as const).map((s) => (
            <button key={s} type="button" onClick={() => setSpecies(s)} className={`rounded px-2.5 py-1 text-[11px] font-medium uppercase ${species === s ? 'bg-cyan-500/15 text-cyan-300' : 'text-zinc-400 hover:text-zinc-300'}`}>{s}</button>
          ))}
        </div>
      </header>
      <form onSubmit={(e) => { e.preventDefault(); if (name.trim()) search.mutate(); }} className="flex items-center gap-2">
        <div className="relative flex-1">
          <Search className="pointer-events-none absolute left-2.5 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-zinc-400" />
          <input type="text" value={name} onChange={(e) => setName(e.target.value)} placeholder={species === 'dog' ? 'Golden Retriever, Husky…' : 'Maine Coon, Persian…'} className="w-full rounded-md border border-zinc-800 bg-zinc-950 py-1.5 pl-8 pr-3 text-sm text-white placeholder-zinc-600 focus:border-cyan-500/40 focus:outline-none" />
        </div>
        <button type="submit" disabled={!name.trim() || search.isPending} className="inline-flex items-center gap-1.5 rounded-md border border-cyan-500/30 bg-cyan-500/10 px-3 py-1.5 text-xs text-cyan-200 hover:bg-cyan-500/20 disabled:opacity-50">
          {search.isPending ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Search className="h-3.5 w-3.5" />}
          Search
        </button>
      </form>
      <div className="grid grid-cols-1 gap-3 md:grid-cols-2">
        {breeds.map((b) => (
          <motion.div key={b.id} layout initial={{ opacity: 0, y: 4 }} animate={{ opacity: 1, y: 0 }} className="rounded-md border border-zinc-800 bg-zinc-950 p-3">
            {b.referenceImageUrl && (
              // eslint-disable-next-line @next/next/no-img-element
              <img src={b.referenceImageUrl} alt={b.name} loading="lazy" className="mb-2 aspect-video w-full rounded object-cover" />
            )}
            <div className="flex items-start justify-between gap-2">
              <div>
                <h3 className="text-base font-semibold text-white">{b.name}</h3>
                {b.origin && <p className="text-xs text-zinc-400">{b.origin}{b.breedGroup ? ` · ${b.breedGroup}` : ''}</p>}
              </div>
              <SaveAsDtuButton
                compact
                apiSource={species === 'dog' ? 'the-dog-api' : 'the-cat-api'}
                apiUrl={b.wikipediaUrl}
                title={`${b.name} — ${species}`}
                content={`Breed: ${b.name}\nOrigin: ${b.origin}\nGroup: ${b.breedGroup}\nBred for: ${b.bredFor}\nLife span: ${b.lifeSpan}\nWeight (metric): ${b.weightMetric}\nHeight (metric): ${b.heightMetric}\nTemperament: ${b.temperament}\nHypoallergenic: ${b.hypoallergenic}\n${b.description || ''}\nWikipedia: ${b.wikipediaUrl}`}
                extraTags={['pets', species, b.breedGroup?.toLowerCase() || species]}
                rawData={b}
              />
            </div>
            <div className="mt-1 grid grid-cols-2 gap-1 text-[10px] text-zinc-400">
              {b.lifeSpan && <Cell label="Life span" value={b.lifeSpan} />}
              {b.bredFor && <Cell label="Bred for" value={b.bredFor} />}
              {b.weightMetric && <Cell label="Weight (kg)" value={b.weightMetric} />}
              {b.heightMetric && <Cell label="Height (cm)" value={b.heightMetric} />}
            </div>
            {b.temperament && <p className="mt-2 text-[11px] italic text-zinc-300">{b.temperament}</p>}
            {b.description && <p className="mt-1 line-clamp-3 text-[11px] text-zinc-400">{b.description}</p>}
          </motion.div>
        ))}
      </div>
    </div>
  );
}

function Cell({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded border border-zinc-800 bg-zinc-950 px-2 py-1">
      <div className="text-[9px] uppercase tracking-wider text-zinc-400">{label}</div>
      <div className="font-mono text-cyan-300">{value}</div>
    </div>
  );
}
