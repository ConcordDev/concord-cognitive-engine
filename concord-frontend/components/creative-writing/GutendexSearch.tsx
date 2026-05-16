'use client';

import { useState } from 'react';
import { useMutation } from '@tanstack/react-query';
import { BookOpen, Loader2, Search, ExternalLink, Download } from 'lucide-react';
import { SaveAsDtuButton } from '@/components/dtu/SaveAsDtuButton';

interface Book {
  id: number;
  title: string;
  authors: { name: string; birth_year?: number; death_year?: number }[];
  subjects: string[];
  languages: string[];
  download_count: number;
  formats: Record<string, string>;
}

export function GutendexSearch() {
  const [query, setQuery] = useState('shakespeare');
  const [books, setBooks] = useState<Book[]>([]);
  const [error, setError] = useState<string | null>(null);

  const search = useMutation({
    mutationFn: async () => {
      setError(null);
      try {
        const r = await fetch(`https://gutendex.com/books?search=${encodeURIComponent(query)}`);
        if (!r.ok) throw new Error(`gutendex ${r.status}`);
        const j = await r.json();
        setBooks((j.results || []) as Book[]);
      } catch (e) { setBooks([]); setError(e instanceof Error ? e.message : 'request failed'); }
    },
  });

  const preferredFormat = (b: Book) => {
    return b.formats['text/plain; charset=utf-8'] || b.formats['text/html; charset=utf-8'] || b.formats['application/epub+zip'] || b.formats['text/html'] || Object.values(b.formats)[0];
  };

  return (
    <div className="space-y-4">
      <header className="flex items-center justify-between gap-3 border-b border-cyan-500/15 pb-3">
        <div className="flex items-center gap-2">
          <BookOpen className="h-5 w-5 text-cyan-400" />
          <h2 className="text-sm font-semibold text-white">Project Gutenberg search</h2>
          <span className="rounded bg-zinc-800 px-1.5 py-0.5 font-mono text-[10px] uppercase tracking-wider text-zinc-400">gutendex.com · 75k public-domain books</span>
        </div>
        {books.length > 0 && (
          <SaveAsDtuButton
            compact
            apiSource="gutendex"
            apiUrl={`https://gutendex.com/books?search=${encodeURIComponent(query)}`}
            title={`Project Gutenberg — "${query}" (${books.length})`}
            content={books.slice(0, 20).map((b, i) => `${i + 1}. ${b.title} — ${b.authors.map((a) => a.name).join(', ')}\n   ${b.subjects.slice(0, 3).join(' / ')}\n   ${b.download_count.toLocaleString()} downloads · ${preferredFormat(b)}`).join('\n\n')}
            extraTags={['creative-writing', 'gutenberg', 'public-domain']}
            rawData={{ query, books }}
          />
        )}
      </header>
      <form onSubmit={(e) => { e.preventDefault(); if (query.trim()) search.mutate(); }} className="flex items-center gap-2">
        <div className="relative flex-1">
          <Search className="pointer-events-none absolute left-2.5 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-zinc-500" />
          <input type="text" value={query} onChange={(e) => setQuery(e.target.value)} placeholder="Search 75k public-domain books…" className="w-full rounded-md border border-zinc-800 bg-zinc-950 py-1.5 pl-8 pr-3 text-sm text-white" />
        </div>
        <button type="submit" disabled={!query.trim() || search.isPending} className="inline-flex items-center gap-1.5 rounded-md border border-cyan-500/30 bg-cyan-500/10 px-3 py-1.5 text-xs text-cyan-200 hover:bg-cyan-500/20 disabled:opacity-50">
          {search.isPending ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Search className="h-3.5 w-3.5" />}
          Search
        </button>
      </form>
      {error && <div className="rounded border border-red-500/20 bg-red-500/5 px-3 py-2 text-xs text-red-300">{error}</div>}
      <div className="space-y-1 max-h-[480px] overflow-y-auto">
        {books.map((b) => (
          <div key={b.id} className="rounded border border-zinc-800 bg-zinc-950 p-2.5">
            <div className="flex items-start justify-between gap-2">
              <div className="flex-1 min-w-0">
                <div className="flex items-baseline gap-2">
                  <span className="line-clamp-1 text-sm text-white">{b.title}</span>
                  <span className="font-mono text-[10px] text-zinc-500">#{b.id}</span>
                </div>
                <p className="text-[11px] text-cyan-300/80">
                  {b.authors.map((a) => `${a.name}${a.birth_year || a.death_year ? ` (${a.birth_year || '?'}–${a.death_year || '?'})` : ''}`).join(', ')}
                </p>
                <div className="mt-0.5 flex flex-wrap gap-1">
                  {b.subjects.slice(0, 4).map((s) => <span key={s} className="rounded bg-zinc-800 px-1 font-mono text-[9px] text-zinc-300">{s}</span>)}
                  {b.languages.map((l) => <span key={l} className="rounded bg-amber-500/10 px-1 font-mono text-[9px] text-amber-300">{l}</span>)}
                </div>
                <div className="mt-0.5 font-mono text-[10px] text-zinc-500"><Download className="mr-0.5 inline h-2.5 w-2.5" />{b.download_count.toLocaleString()} downloads</div>
              </div>
              <a href={preferredFormat(b)} target="_blank" rel="noopener noreferrer" className="rounded border border-cyan-500/30 bg-cyan-500/10 px-2 py-1 text-[10px] text-cyan-200"><ExternalLink className="h-3 w-3" /></a>
            </div>
          </div>
        ))}
        {books.length === 0 && !search.isPending && !error && (
          <div className="rounded border border-dashed border-zinc-800 p-6 text-center text-[11px] text-zinc-500">Search the live Project Gutenberg catalog.</div>
        )}
      </div>
    </div>
  );
}
