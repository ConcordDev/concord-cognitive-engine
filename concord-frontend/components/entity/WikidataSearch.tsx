'use client';

import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { Network, Loader2, ExternalLink, Search } from 'lucide-react';
import { SaveAsDtuButton } from '@/components/dtu/SaveAsDtuButton';

interface Match {
  id: string;
  label?: string;
  description?: string;
  url?: string;
  concepturi?: string;
  match?: { type: string; text: string };
  aliases?: string[];
}

export function WikidataSearch() {
  const [draft, setDraft] = useState('Tesla');
  const [query, setQuery] = useState('Tesla');

  const results = useQuery({
    queryKey: ['wikidata', query],
    queryFn: async () => {
      const r = await fetch(`https://www.wikidata.org/w/api.php?action=wbsearchentities&search=${encodeURIComponent(query)}&format=json&language=en&type=item&limit=20&origin=*`);
      if (!r.ok) throw new Error(`wikidata ${r.status}`);
      const j = await r.json();
      return (j.search || []) as Match[];
    },
    enabled: query.length >= 2,
    staleTime: 30 * 60 * 1000,
  });

  const list = results.data || [];
  const withDescriptions = list.filter((m) => !!m.description).length;
  const withAliases = list.filter((m) => m.aliases && m.aliases.length > 0).length;

  return (
    <div className="space-y-4">
      <header className="flex flex-wrap items-center justify-between gap-3 border-b border-cyan-500/15 pb-3">
        <div className="flex items-center gap-2">
          <Network className="h-5 w-5 text-cyan-400" />
          <h2 className="text-sm font-semibold text-white">Wikidata entity resolution</h2>
          <span className="rounded bg-zinc-800 px-1.5 py-0.5 font-mono text-[10px] uppercase tracking-wider text-zinc-400">wikidata.org · wbsearchentities</span>
        </div>
        {list.length > 0 && (
          <SaveAsDtuButton
            compact
            apiSource="wikidata-entities"
            apiUrl={`https://www.wikidata.org/w/api.php?action=wbsearchentities&search=${encodeURIComponent(query)}`}
            title={`Wikidata search — "${query}" (${list.length} matches)`}
            content={list.slice(0, 20).map((m, i) => `${i + 1}. ${m.id} — ${m.label || ''}\n   ${m.description || '(no description)'}${m.aliases?.length ? `\n   aliases: ${m.aliases.join(', ')}` : ''}\n   https://www.wikidata.org/wiki/${m.id}`).join('\n\n')}
            extraTags={['entity', 'wikidata', 'knowledge-graph', query.toLowerCase().replace(/\s+/g, '-')]}
            rawData={{ query, matches: list }}
          />
        )}
      </header>
      <form
        onSubmit={(e) => { e.preventDefault(); setQuery(draft.trim()); }}
        className="flex items-center gap-2"
      >
        <div className="relative flex-1">
          <Search className="absolute left-2 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-zinc-500" />
          <input
            type="text"
            value={draft}
            onChange={(e) => setDraft(e.target.value)}
            placeholder="Search Wikidata — entity name, concept, person…"
            className="w-full rounded border border-zinc-800 bg-zinc-950 pl-7 pr-2 py-1.5 text-xs text-white focus:border-cyan-500/40 focus:outline-none"
          />
        </div>
        <button type="submit" className="rounded border border-cyan-500/40 bg-cyan-500/10 px-3 py-1.5 text-xs font-mono text-cyan-200 hover:bg-cyan-500/20">resolve</button>
      </form>
      {results.isError && <div className="rounded border border-red-500/20 bg-red-500/5 px-3 py-2 text-xs text-red-300">Wikidata unreachable.</div>}
      <div className="grid grid-cols-3 gap-2">
        <div className="rounded border border-zinc-800 bg-zinc-950 px-2.5 py-1.5">
          <div className="text-[10px] uppercase tracking-wider text-zinc-500">Matches</div>
          <div className="mt-0.5 font-mono text-lg text-cyan-300">{list.length}</div>
        </div>
        <div className="rounded border border-zinc-800 bg-zinc-950 px-2.5 py-1.5">
          <div className="text-[10px] uppercase tracking-wider text-zinc-500">With description</div>
          <div className="mt-0.5 font-mono text-lg text-cyan-300">{withDescriptions}</div>
        </div>
        <div className="rounded border border-zinc-800 bg-zinc-950 px-2.5 py-1.5">
          <div className="text-[10px] uppercase tracking-wider text-zinc-500">With aliases</div>
          <div className="mt-0.5 font-mono text-lg text-cyan-300">{withAliases}</div>
        </div>
      </div>
      <div className="space-y-1.5 max-h-[500px] overflow-y-auto">
        {list.map((m) => (
          <a key={m.id} href={`https://www.wikidata.org/wiki/${m.id}`} target="_blank" rel="noopener noreferrer" className="block rounded-lg border border-cyan-500/20 bg-cyan-500/5 p-2.5 hover:border-cyan-500/40">
            <div className="flex items-start justify-between gap-2">
              <div className="flex-1 min-w-0">
                <div className="flex items-center gap-2">
                  <span className="font-mono text-xs text-cyan-300">{m.id}</span>
                  <span className="text-[12px] text-zinc-100">{m.label || '(unlabeled)'}</span>
                </div>
                {m.description && <p className="mt-0.5 line-clamp-2 text-[11px] text-zinc-300">{m.description}</p>}
                {m.aliases && m.aliases.length > 0 && (
                  <div className="mt-1 flex flex-wrap gap-1">
                    {m.aliases.slice(0, 5).map((a) => <span key={a} className="rounded bg-zinc-800 px-1 font-mono text-[9px] text-zinc-300">{a}</span>)}
                  </div>
                )}
              </div>
              <ExternalLink className="h-3 w-3 shrink-0 text-zinc-500" />
            </div>
          </a>
        ))}
        {list.length === 0 && !results.isPending && !results.isError && query.length >= 2 && (
          <div className="rounded border border-dashed border-zinc-800 p-4 text-center text-[11px] text-zinc-500">No matches for &quot;{query}&quot;.</div>
        )}
        {query.length < 2 && (
          <div className="rounded border border-dashed border-zinc-800 p-4 text-center text-[11px] text-zinc-500">Type at least 2 characters and press resolve.</div>
        )}
      </div>
      {results.isPending && query.length >= 2 && <div className="flex items-center gap-2 text-xs text-zinc-500"><Loader2 className="h-4 w-4 animate-spin" /> Resolving…</div>}
    </div>
  );
}
