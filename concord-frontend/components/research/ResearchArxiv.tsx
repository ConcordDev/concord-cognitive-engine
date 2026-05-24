'use client';

import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { Microscope, Loader2, ExternalLink, Search } from 'lucide-react';
import { SaveAsDtuButton } from '@/components/dtu/SaveAsDtuButton';

interface Paper { id: string; title: string; summary: string; authors: string[]; published: string; link: string; category?: string; }

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

export function ResearchArxiv() {
  const [draft, setDraft] = useState('large language models');
  const [q, setQ] = useState('large language models');

  const papers = useQuery({
    queryKey: ['arxiv-research', q],
    queryFn: async () => {
      const r = await fetch(`https://export.arxiv.org/api/query?search_query=all:${encodeURIComponent(q)}&start=0&max_results=20&sortBy=submittedDate&sortOrder=descending`);
      if (!r.ok) throw new Error(`arxiv ${r.status}`);
      const xml = await r.text();
      return parseArxivAtom(xml);
    },
    enabled: q.length >= 2,
    staleTime: 30 * 60 * 1000,
  });

  const list = papers.data || [];

  return (
    <div className="space-y-4">
      <header className="flex flex-wrap items-center justify-between gap-3 border-b border-cyan-500/15 pb-3">
        <div className="flex items-center gap-2"><Microscope className="h-5 w-5 text-emerald-400" /><h2 className="text-sm font-semibold text-white">arXiv research search</h2><span className="rounded bg-zinc-800 px-1.5 py-0.5 font-mono text-[10px] uppercase tracking-wider text-zinc-400">arxiv · live</span></div>
        {list.length > 0 && <SaveAsDtuButton compact apiSource="arxiv-research" apiUrl={`https://export.arxiv.org/api/query?search_query=all:${encodeURIComponent(q)}`} title={`arXiv research — "${q}" (${list.length})`} content={list.slice(0, 15).map((p, i) => `${i + 1}. ${p.title}\n   ${p.authors.slice(0, 3).join(', ')} · ${p.published.slice(0, 10)}\n   ${p.link}`).join('\n\n')} extraTags={['research', 'arxiv', q.toLowerCase().replace(/\s+/g, '-')]} rawData={{ query: q, papers: list }} />}
      </header>
      <form onSubmit={(e) => { e.preventDefault(); setQ(draft.trim()); }} className="flex items-center gap-2">
        <div className="relative flex-1">
          <Search className="absolute left-2 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-zinc-400" />
          <input type="text" value={draft} onChange={(e) => setDraft(e.target.value)} placeholder="Search arXiv" className="w-full rounded border border-zinc-800 bg-zinc-950 pl-7 pr-2 py-1.5 text-xs text-white focus:border-emerald-500/40 focus:outline-none" />
        </div>
        <button type="submit" className="rounded border border-emerald-500/40 bg-emerald-500/10 px-3 py-1.5 text-xs font-mono text-emerald-200 hover:bg-emerald-500/20">search</button>
      </form>
      {papers.isError && <div className="rounded border border-red-500/20 bg-red-500/5 px-3 py-2 text-xs text-red-300">arXiv unreachable.</div>}
      <div className="space-y-1.5 max-h-[500px] overflow-y-auto">
        {list.map((p) => (
          <a key={p.id} href={p.link} target="_blank" rel="noopener noreferrer" className="block rounded-lg border border-emerald-500/20 bg-emerald-500/5 p-2.5 hover:border-emerald-500/40">
            <p className="line-clamp-2 text-[12px] text-zinc-100">{p.title}</p>
            <p className="mt-0.5 line-clamp-2 text-[10px] text-zinc-400">{p.summary}</p>
            <div className="mt-1 flex flex-wrap items-center gap-x-3 text-[10px] text-zinc-400">
              <span>{p.authors.slice(0, 2).join(', ')}</span>
              <span>{p.published.slice(0, 10)}</span>
              <ExternalLink className="h-3 w-3 text-zinc-400" />
            </div>
          </a>
        ))}
        {list.length === 0 && !papers.isPending && !papers.isError && q.length >= 2 && <div className="rounded border border-dashed border-zinc-800 p-4 text-center text-[11px] text-zinc-400">No papers.</div>}
      </div>
      {papers.isPending && q.length >= 2 && <div className="flex items-center gap-2 text-xs text-zinc-400"><Loader2 className="h-4 w-4 animate-spin" /> Pulling…</div>}
    </div>
  );
}
