'use client';

import { useState } from 'react';
import { useMutation } from '@tanstack/react-query';
import { Package, Loader2, Search, ExternalLink, Calendar } from 'lucide-react';
import { SaveAsDtuButton } from '@/components/dtu/SaveAsDtuButton';

interface NpmHit {
  package: {
    name: string;
    version: string;
    description?: string;
    keywords?: string[];
    date: string;
    publisher?: { username: string };
    links?: { npm?: string; homepage?: string; repository?: string };
  };
  score: { final: number; detail: { quality: number; popularity: number; maintenance: number } };
  searchScore: number;
  downloads?: { monthly: number; weekly: number };
}

export function NpmPackageSearch() {
  const [query, setQuery] = useState('react');
  const [hits, setHits] = useState<NpmHit[]>([]);
  const [error, setError] = useState<string | null>(null);

  const search = useMutation({
    mutationFn: async () => {
      setError(null);
      try {
        const r = await fetch(`https://registry.npmjs.com/-/v1/search?text=${encodeURIComponent(query)}&size=20`);
        if (!r.ok) throw new Error(`npm ${r.status}`);
        const j = await r.json();
        setHits(j.objects || []);
      } catch (e) { setHits([]); setError(e instanceof Error ? e.message : 'request failed'); }
    },
  });

  const scoreColor = (s: number) => s > 0.7 ? 'text-emerald-300' : s > 0.4 ? 'text-cyan-300' : s > 0.2 ? 'text-amber-300' : 'text-zinc-400';

  return (
    <div className="space-y-4">
      <header className="flex items-center justify-between gap-3 border-b border-cyan-500/15 pb-3">
        <div className="flex items-center gap-2">
          <Package className="h-5 w-5 text-cyan-400" />
          <h2 className="text-sm font-semibold text-white">NPM package search</h2>
          <span className="rounded bg-zinc-800 px-1.5 py-0.5 font-mono text-[10px] uppercase tracking-wider text-zinc-400">registry.npmjs.com · no key</span>
        </div>
        {hits.length > 0 && (
          <SaveAsDtuButton
            compact
            apiSource="npm-registry"
            apiUrl={`https://registry.npmjs.com/-/v1/search?text=${encodeURIComponent(query)}`}
            title={`NPM search — "${query}" (${hits.length})`}
            content={hits.slice(0, 25).map((h, i) => `${i + 1}. ${h.package.name}@${h.package.version} — ${h.package.description || ''}\n   score: q=${h.score.detail.quality.toFixed(2)} pop=${h.score.detail.popularity.toFixed(2)} maint=${h.score.detail.maintenance.toFixed(2)}\n   ${h.package.links?.npm || ''}`).join('\n\n')}
            extraTags={['app-maker', 'npm', 'packages']}
            rawData={{ query, hits }}
          />
        )}
      </header>
      <form onSubmit={(e) => { e.preventDefault(); if (query.trim()) search.mutate(); }} className="flex items-center gap-2">
        <div className="relative flex-1">
          <Search className="pointer-events-none absolute left-2.5 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-zinc-400" />
          <input type="text" value={query} onChange={(e) => setQuery(e.target.value)} placeholder="Search NPM (package name, keyword, author)…" className="w-full rounded-md border border-zinc-800 bg-zinc-950 py-1.5 pl-8 pr-3 text-sm text-white" />
        </div>
        <button type="submit" disabled={!query.trim() || search.isPending} className="inline-flex items-center gap-1.5 rounded-md border border-cyan-500/30 bg-cyan-500/10 px-3 py-1.5 text-xs text-cyan-200 hover:bg-cyan-500/20 disabled:opacity-50">
          {search.isPending ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Search className="h-3.5 w-3.5" />}
          Search
        </button>
      </form>
      {error && <div className="rounded border border-red-500/20 bg-red-500/5 px-3 py-2 text-xs text-red-300">{error}</div>}
      <div className="space-y-1 max-h-96 overflow-y-auto">
        {hits.map((h) => (
          <a key={h.package.name} href={h.package.links?.npm} target="_blank" rel="noopener noreferrer" className="block rounded border border-zinc-800 bg-zinc-950 p-2.5 hover:border-cyan-500/30">
            <div className="flex items-start justify-between gap-2">
              <div className="flex-1 min-w-0">
                <div className="flex items-center gap-2">
                  <span className="font-mono text-sm text-cyan-300">{h.package.name}</span>
                  <span className="font-mono text-[10px] text-zinc-400">@{h.package.version}</span>
                </div>
                <p className="mt-0.5 line-clamp-2 text-[11px] text-zinc-400">{h.package.description}</p>
                <div className="mt-1 flex flex-wrap items-center gap-x-3 gap-y-0.5 text-[10px] text-zinc-400">
                  {h.package.publisher && <span>{h.package.publisher.username}</span>}
                  {h.package.date && <span className="flex items-center gap-0.5"><Calendar className="h-3 w-3" />{new Date(h.package.date).toLocaleDateString()}</span>}
                  <span className={scoreColor(h.score.detail.quality)}>quality {(h.score.detail.quality * 100).toFixed(0)}</span>
                  <span className={scoreColor(h.score.detail.popularity)}>pop {(h.score.detail.popularity * 100).toFixed(0)}</span>
                  <span className={scoreColor(h.score.detail.maintenance)}>maint {(h.score.detail.maintenance * 100).toFixed(0)}</span>
                </div>
                {h.package.keywords && h.package.keywords.length > 0 && (
                  <div className="mt-1 flex flex-wrap gap-1">
                    {h.package.keywords.slice(0, 5).map((k) => <span key={k} className="rounded bg-zinc-800 px-1 font-mono text-[9px] text-cyan-300/80">{k}</span>)}
                  </div>
                )}
              </div>
              <div className="flex flex-col items-end gap-1 text-[10px]">
                <ExternalLink className="h-3 w-3 text-zinc-400" />
                <span className="font-mono text-cyan-400">{(h.score.final * 100).toFixed(0)}</span>
              </div>
            </div>
          </a>
        ))}
        {hits.length === 0 && !search.isPending && (
          <div className="rounded border border-dashed border-zinc-800 p-6 text-center text-[11px] text-zinc-400">Search the live NPM registry for packages to compose into your app.</div>
        )}
      </div>
    </div>
  );
}
