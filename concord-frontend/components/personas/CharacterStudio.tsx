'use client';

import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { User, Loader2, ExternalLink, BookOpen } from 'lucide-react';
import { SaveAsDtuButton } from '@/components/dtu/SaveAsDtuButton';

interface Summary { title: string; description?: string; extract: string; content_urls?: { desktop?: { page?: string } }; }

const PERSONAS = [
  { id: 'Socrates', label: 'Socrates' },
  { id: 'Confucius', label: 'Confucius' },
  { id: 'Marie_Curie', label: 'Marie Curie' },
  { id: 'Leonardo_da_Vinci', label: 'Leonardo da Vinci' },
  { id: 'Mahatma_Gandhi', label: 'Gandhi' },
  { id: 'Nikola_Tesla', label: 'Tesla' },
  { id: 'Toni_Morrison', label: 'Toni Morrison' },
  { id: 'Carl_Jung', label: 'Carl Jung' },
];

export function CharacterStudio() {
  const [selected, setSelected] = useState(PERSONAS[0].id);

  const summary = useQuery({
    queryKey: ['wiki-persona', selected],
    queryFn: async () => {
      const r = await fetch(`https://en.wikipedia.org/api/rest_v1/page/summary/${selected}`);
      if (!r.ok) throw new Error(`wiki ${r.status}`);
      return (await r.json()) as Summary;
    },
    staleTime: 60 * 60 * 1000,
  });

  const s = summary.data;
  const wikiUrl = s?.content_urls?.desktop?.page;

  return (
    <div className="space-y-4">
      <header className="flex flex-wrap items-center justify-between gap-3 border-b border-cyan-500/15 pb-3">
        <div className="flex items-center gap-2"><User className="h-5 w-5 text-sky-400" /><h2 className="text-sm font-semibold text-white">Real-world persona reference</h2><span className="rounded bg-zinc-800 px-1.5 py-0.5 font-mono text-[10px] uppercase tracking-wider text-zinc-400">wikipedia REST</span></div>
        {s && <SaveAsDtuButton compact apiSource="wikipedia-persona" apiUrl={`https://en.wikipedia.org/api/rest_v1/page/summary/${selected}`} title={`${s.title} — persona`} content={`${s.description ? s.description + '\n\n' : ''}${s.extract}\n\n${wikiUrl || ''}`} extraTags={['personas', 'biography', 'wikipedia', selected.toLowerCase()]} rawData={s as unknown as Record<string, unknown>} />}
      </header>
      <div className="flex flex-wrap gap-1.5">{PERSONAS.map((p) => <button key={p.id} type="button" onClick={() => setSelected(p.id)} className={`rounded-full border px-2.5 py-1 text-[11px] transition-colors ${selected === p.id ? 'border-sky-500 bg-sky-500/20 text-sky-200' : 'border-zinc-800 bg-zinc-950 text-zinc-400 hover:border-zinc-700'}`}>{p.label}</button>)}</div>
      {summary.isError && <div className="rounded border border-red-500/20 bg-red-500/5 px-3 py-2 text-xs text-red-300">Wikipedia REST unreachable.</div>}
      {summary.isPending && <div className="flex items-center gap-2 text-xs text-zinc-400"><Loader2 className="h-4 w-4 animate-spin" /> Pulling…</div>}
      {s && (
        <article className="rounded-lg border border-sky-500/20 bg-sky-500/5 p-3">
          <h3 className="flex items-center gap-2 text-sm font-semibold text-white"><BookOpen className="h-3.5 w-3.5 text-sky-300" />{s.title}</h3>
          {s.description && <p className="mt-0.5 text-[11px] uppercase tracking-wider text-sky-300">{s.description}</p>}
          <p className="mt-2 text-[12px] leading-relaxed text-zinc-200">{s.extract}</p>
          {wikiUrl && <a href={wikiUrl} target="_blank" rel="noopener noreferrer" className="mt-2 inline-flex items-center gap-1 text-[11px] text-sky-300 hover:text-sky-200">Read on Wikipedia <ExternalLink className="h-3 w-3" /></a>}
        </article>
      )}
    </div>
  );
}
