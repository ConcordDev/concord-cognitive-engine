'use client';

import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { Sparkles, Loader2, ExternalLink, BookOpen } from 'lucide-react';
import { SaveAsDtuButton } from '@/components/dtu/SaveAsDtuButton';

interface Summary {
  title: string;
  description?: string;
  extract: string;
  content_urls?: { desktop?: { page?: string } };
  type?: string;
}

const PANTHEONS = [
  { id: 'Greek_mythology', label: 'Greek' },
  { id: 'Norse_mythology', label: 'Norse' },
  { id: 'Egyptian_mythology', label: 'Egyptian' },
  { id: 'Hindu_mythology', label: 'Hindu' },
  { id: 'Yoruba_religion', label: 'Yoruba' },
  { id: 'Aztec_mythology', label: 'Aztec' },
  { id: 'Celtic_mythology', label: 'Celtic' },
  { id: 'Shinto', label: 'Shinto' },
  { id: 'Mesopotamian_religion', label: 'Mesopotamian' },
  { id: 'Slavic_paganism', label: 'Slavic' },
];

export function PantheonExplorer() {
  const [selected, setSelected] = useState(PANTHEONS[0].id);

  const summary = useQuery({
    queryKey: ['wiki-pantheon', selected],
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
        <div className="flex items-center gap-2">
          <Sparkles className="h-5 w-5 text-purple-400" />
          <h2 className="text-sm font-semibold text-white">World pantheons</h2>
          <span className="rounded bg-zinc-800 px-1.5 py-0.5 font-mono text-[10px] uppercase tracking-wider text-zinc-400">wikipedia REST · live</span>
        </div>
        {s && (
          <SaveAsDtuButton
            compact
            apiSource="wikipedia-pantheon"
            apiUrl={`https://en.wikipedia.org/api/rest_v1/page/summary/${selected}`}
            title={`${s.title} — Wikipedia summary`}
            content={`${s.description ? s.description + '\n\n' : ''}${s.extract}\n\n${wikiUrl || ''}`}
            extraTags={['deities', 'mythology', 'wikipedia', selected.toLowerCase()]}
            rawData={s as unknown as Record<string, unknown>}
          />
        )}
      </header>
      <div className="flex flex-wrap gap-1.5">
        {PANTHEONS.map((p) => (
          <button
            key={p.id}
            type="button"
            onClick={() => setSelected(p.id)}
            className={`rounded-full border px-2.5 py-1 text-[11px] transition-colors ${selected === p.id ? 'border-purple-500 bg-purple-500/20 text-purple-200' : 'border-zinc-800 bg-zinc-950 text-zinc-400 hover:border-zinc-700'}`}
          >
            {p.label}
          </button>
        ))}
      </div>
      {summary.isError && <div className="rounded border border-red-500/20 bg-red-500/5 px-3 py-2 text-xs text-red-300">Wikipedia REST unreachable.</div>}
      {summary.isPending && <div className="flex items-center gap-2 text-xs text-zinc-400"><Loader2 className="h-4 w-4 animate-spin" /> Pulling summary…</div>}
      {s && (
        <article className="rounded-lg border border-purple-500/20 bg-purple-500/5 p-3">
          <h3 className="flex items-center gap-2 text-sm font-semibold text-white">
            <BookOpen className="h-3.5 w-3.5 text-purple-300" />
            {s.title}
          </h3>
          {s.description && <p className="mt-0.5 text-[11px] uppercase tracking-wider text-purple-300">{s.description}</p>}
          <p className="mt-2 text-[12px] leading-relaxed text-zinc-200">{s.extract}</p>
          {wikiUrl && (
            <a href={wikiUrl} target="_blank" rel="noopener noreferrer" className="mt-2 inline-flex items-center gap-1 text-[11px] text-purple-300 hover:text-purple-200">
              Read on Wikipedia <ExternalLink className="h-3 w-3" />
            </a>
          )}
        </article>
      )}
    </div>
  );
}
