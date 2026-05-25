'use client';

import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { GraduationCap, Loader2, ExternalLink, BookOpen, Download } from 'lucide-react';
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

const TOPICS = [
  { id: 'philosophy', label: 'philosophy' },
  { id: 'history', label: 'history' },
  { id: 'science', label: 'science' },
  { id: 'mathematics', label: 'mathematics' },
  { id: 'literature', label: 'literature' },
  { id: 'economics', label: 'economics' },
  { id: 'rhetoric', label: 'rhetoric' },
  { id: 'pedagogy', label: 'pedagogy' },
];

export function GutenbergCurriculum() {
  const [topic, setTopic] = useState(TOPICS[0].id);

  const books = useQuery({
    queryKey: ['gutendex', topic],
    queryFn: async () => {
      const r = await fetch(`https://gutendex.com/books?topic=${topic}&sort=popular`);
      if (!r.ok) throw new Error(`gutendex ${r.status}`);
      const j = await r.json();
      return ((j.results || []) as Book[]).slice(0, 25);
    },
    staleTime: 60 * 60 * 1000,
  });

  const list = books.data || [];
  const totalDl = list.reduce((a, b) => a + (b.download_count || 0), 0);
  const authors = new Set(list.flatMap((b) => b.authors?.map((a) => a.name) || [])).size;

  return (
    <div className="space-y-4">
      <header className="flex flex-wrap items-center justify-between gap-3 border-b border-cyan-500/15 pb-3">
        <div className="flex items-center gap-2">
          <GraduationCap className="h-5 w-5 text-sky-400" />
          <h2 className="text-sm font-semibold text-white">Public-domain curriculum</h2>
          <span className="rounded bg-zinc-800 px-1.5 py-0.5 font-mono text-[10px] uppercase tracking-wider text-zinc-400">gutendex.com · topic:{topic}</span>
        </div>
        <div className="flex items-center gap-2">
          <select value={topic} onChange={(e) => setTopic(e.target.value)} className="rounded border border-zinc-800 bg-zinc-950 px-2 py-1 text-xs text-white">
            {TOPICS.map((t) => <option key={t.id} value={t.id}>{t.label}</option>)}
          </select>
          {list.length > 0 && (
            <SaveAsDtuButton
              compact
              apiSource="gutendex"
              apiUrl={`https://gutendex.com/books?topic=${topic}&sort=popular`}
              title={`Project Gutenberg — ${topic} (${list.length} books)`}
              content={list.slice(0, 20).map((b, i) => `${i + 1}. ${b.title}\n   ${b.authors?.map((a) => a.name).join(', ') || 'anon'}\n   ${b.download_count.toLocaleString()} downloads · gutenberg.org/ebooks/${b.id}`).join('\n\n')}
              extraTags={['education', 'gutenberg', 'books', topic]}
              rawData={{ topic, books: list }}
            />
          )}
        </div>
      </header>
      {books.isError && <div className="rounded border border-red-500/20 bg-red-500/5 px-3 py-2 text-xs text-red-300">Gutendex unreachable.</div>}
      <div className="grid grid-cols-3 gap-2">
        <div className="rounded border border-zinc-800 bg-zinc-950 px-2.5 py-1.5">
          <div className="text-[10px] uppercase tracking-wider text-zinc-400">Books</div>
          <div className="mt-0.5 font-mono text-lg text-sky-300">{list.length}</div>
        </div>
        <div className="rounded border border-zinc-800 bg-zinc-950 px-2.5 py-1.5">
          <div className="text-[10px] uppercase tracking-wider text-zinc-400">Total downloads</div>
          <div className="mt-0.5 font-mono text-lg text-sky-300">{totalDl.toLocaleString()}</div>
        </div>
        <div className="rounded border border-zinc-800 bg-zinc-950 px-2.5 py-1.5">
          <div className="text-[10px] uppercase tracking-wider text-zinc-400">Authors</div>
          <div className="mt-0.5 font-mono text-lg text-sky-300">{authors}</div>
        </div>
      </div>
      <div className="space-y-1.5 max-h-[500px] overflow-y-auto">
        {list.map((b) => {
          const epub = b.formats?.['application/epub+zip'] || b.formats?.['text/html'] || `https://www.gutenberg.org/ebooks/${b.id}`;
          return (
            <a key={b.id} href={epub} target="_blank" rel="noopener noreferrer" className="block rounded-lg border border-sky-500/20 bg-sky-500/5 p-2.5 hover:border-sky-500/40">
              <div className="flex items-start justify-between gap-2">
                <div className="flex-1 min-w-0">
                  <p className="flex items-center gap-1.5 text-[12px] text-zinc-100">
                    <BookOpen className="h-3 w-3 shrink-0 text-sky-400" />
                    <span className="line-clamp-1">{b.title}</span>
                  </p>
                  {b.authors?.length > 0 && (
                    <p className="mt-0.5 text-[10px] text-zinc-400">
                      {b.authors.map((a) => `${a.name}${a.birth_year || a.death_year ? ` (${a.birth_year || '?'}–${a.death_year || '?'})` : ''}`).join(', ')}
                    </p>
                  )}
                  <div className="mt-1 flex flex-wrap items-center gap-x-3 text-[10px] text-zinc-400">
                    <span className="flex items-center gap-0.5"><Download className="h-3 w-3" />{b.download_count.toLocaleString()}</span>
                    {(b.languages || []).slice(0, 3).map((l) => <span key={l} className="rounded bg-zinc-800 px-1 font-mono text-[9px] text-zinc-300">{l}</span>)}
                  </div>
                </div>
                <ExternalLink className="h-3 w-3 shrink-0 text-zinc-400" />
              </div>
            </a>
          );
        })}
        {list.length === 0 && !books.isPending && !books.isError && (
          <div className="rounded border border-dashed border-zinc-800 p-4 text-center text-[11px] text-zinc-400">No books returned.</div>
        )}
      </div>
      {books.isPending && <div className="flex items-center gap-2 text-xs text-zinc-400"><Loader2 className="h-4 w-4 animate-spin" /> Pulling Gutenberg…</div>}
    </div>
  );
}
