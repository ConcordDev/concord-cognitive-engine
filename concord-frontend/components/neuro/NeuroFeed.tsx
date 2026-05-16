'use client';

import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { Brain, Loader2, ExternalLink } from 'lucide-react';
import { SaveAsDtuButton } from '@/components/dtu/SaveAsDtuButton';

interface Paper { id: string; title: string; summary: string; authors: string[]; published: string; link: string; category?: string; }

const QUERIES = [
  { id: 'cat:q-bio.NC', label: 'q-bio.NC (neuroscience)' },
  { id: 'all:neuroplasticity', label: 'neuroplasticity' },
  { id: 'all:consciousness', label: 'consciousness' },
  { id: 'all:brain+computer+interface', label: 'BCI' },
];

function parseArxivAtom(xml: string): Paper[] {
  const entries: Paper[] = [];
  const doc = new DOMParser().parseFromString(xml, 'application/xml');
  doc.querySelectorAll('entry').forEach((e) => {
    const id = e.querySelector('id')?.textContent || '';
    const title = e.querySelector('title')?.textContent?.replace(/\s+/g, ' ').trim() || '';
    const summary = e.querySelector('summary')?.textContent?.replace(/\s+/g, ' ').trim() || '';
    const authors = Array.from(e.querySelectorAll('author > name')).map((n) => n.textContent || '');
    const published = e.querySelector('published')?.textContent || '';
    const link = e.querySelector('link[rel="alternate"]')?.getAttribute('href') || id;
    const category = e.querySelector('category')?.getAttribute('term') || '';
    entries.push({ id, title, summary, authors, published, link, category });
  });
  return entries;
}

export function NeuroFeed() {
  const [q, setQ] = useState(QUERIES[0].id);

  const papers = useQuery({
    queryKey: ['arxiv-neuro', q],
    queryFn: async () => {
      const r = await fetch(`https://export.arxiv.org/api/query?search_query=${encodeURIComponent(q)}&start=0&max_results=20&sortBy=submittedDate&sortOrder=descending`);
      if (!r.ok) throw new Error(`arxiv ${r.status}`);
      const xml = await r.text();
      return parseArxivAtom(xml);
    },
    staleTime: 30 * 60 * 1000,
  });

  const list = papers.data || [];

  return (
    <div className="space-y-4">
      <header className="flex flex-wrap items-center justify-between gap-3 border-b border-cyan-500/15 pb-3">
        <div className="flex items-center gap-2"><Brain className="h-5 w-5 text-fuchsia-400" /><h2 className="text-sm font-semibold text-white">Neuroscience research</h2><span className="rounded bg-zinc-800 px-1.5 py-0.5 font-mono text-[10px] uppercase tracking-wider text-zinc-400">arxiv · {q}</span></div>
        <div className="flex items-center gap-2">
          <select value={q} onChange={(e) => setQ(e.target.value)} className="rounded border border-zinc-800 bg-zinc-950 px-2 py-1 text-xs text-white">{QUERIES.map((qq) => <option key={qq.id} value={qq.id}>{qq.label}</option>)}</select>
          {list.length > 0 && <SaveAsDtuButton compact apiSource="arxiv-neuro" apiUrl={`https://export.arxiv.org/api/query?search_query=${q}`} title={`arXiv neuro — ${q} (${list.length})`} content={list.slice(0, 15).map((p, i) => `${i + 1}. ${p.title}\n   ${p.authors.slice(0, 3).join(', ')} · ${p.published.slice(0, 10)}\n   ${p.link}`).join('\n\n')} extraTags={['neuro', 'arxiv', q]} rawData={{ query: q, papers: list }} />}
        </div>
      </header>
      {papers.isError && <div className="rounded border border-red-500/20 bg-red-500/5 px-3 py-2 text-xs text-red-300">arXiv unreachable.</div>}
      <div className="grid grid-cols-2 gap-2">
        <div className="rounded border border-zinc-800 bg-zinc-950 px-2.5 py-1.5"><div className="text-[10px] uppercase tracking-wider text-zinc-500">Papers</div><div className="mt-0.5 font-mono text-lg text-fuchsia-300">{list.length}</div></div>
        <div className="rounded border border-zinc-800 bg-zinc-950 px-2.5 py-1.5"><div className="text-[10px] uppercase tracking-wider text-zinc-500">Newest</div><div className="mt-0.5 font-mono text-lg text-fuchsia-300">{list[0]?.published?.slice(0, 10) || '—'}</div></div>
      </div>
      <div className="space-y-1.5 max-h-[500px] overflow-y-auto">
        {list.map((p) => (
          <a key={p.id} href={p.link} target="_blank" rel="noopener noreferrer" className="block rounded-lg border border-fuchsia-500/20 bg-fuchsia-500/5 p-2.5 hover:border-fuchsia-500/40">
            <p className="line-clamp-2 text-[12px] text-zinc-100">{p.title}</p>
            <p className="mt-0.5 line-clamp-2 text-[10px] text-zinc-400">{p.summary}</p>
            <div className="mt-1 flex flex-wrap items-center gap-x-3 text-[10px] text-zinc-500">
              <span>{p.authors.slice(0, 2).join(', ')}</span>
              <span>{p.published.slice(0, 10)}</span>
              <ExternalLink className="h-3 w-3 text-zinc-500" />
            </div>
          </a>
        ))}
        {list.length === 0 && !papers.isPending && !papers.isError && <div className="rounded border border-dashed border-zinc-800 p-4 text-center text-[11px] text-zinc-500">No papers.</div>}
      </div>
      {papers.isPending && <div className="flex items-center gap-2 text-xs text-zinc-500"><Loader2 className="h-4 w-4 animate-spin" /> Pulling…</div>}
    </div>
  );
}
