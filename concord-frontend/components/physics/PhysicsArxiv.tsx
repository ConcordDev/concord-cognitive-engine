'use client';

import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { Atom, Loader2, ExternalLink } from 'lucide-react';
import { SaveAsDtuButton } from '@/components/dtu/SaveAsDtuButton';
import { lensRun } from '@/lib/api/client';

interface Paper { id: string; title: string; summary: string; authors: string[]; published: string; link: string; category?: string; }

const CATEGORIES = [
  { id: 'physics.gen-ph', label: 'general physics' },
  { id: 'cond-mat', label: 'cond-mat' },
  { id: 'astro-ph', label: 'astro-ph' },
  { id: 'hep-th', label: 'hep-th' },
  { id: 'quant-ph', label: 'quant-ph' },
];

interface MacroPaper {
  arxivId?: string | null; title: string; summary: string; published: string;
  authors?: string[]; abstractUrl?: string; category?: string | null;
}

export function PhysicsArxiv() {
  const [cat, setCat] = useState(CATEGORIES[0].id);

  // FIX-physics-002: this panel used to fetch export.arxiv.org directly
  // from the browser. arXiv sends no CORS headers, so the browser
  // blocked every response — the feed showed "unavailable" with 0
  // papers and a CORS error in the console, on every load, for every
  // user. The papers now come through the server like every other
  // arXiv surface: the physics domain's live_arxiv macro fetches and
  // parses the Atom feed server-side and refuses honestly when arXiv
  // answers nothing.
  const papers = useQuery({
    queryKey: ['arxiv-physics', cat],
    queryFn: async () => {
      const r = await lensRun({ domain: 'physics', name: 'live_arxiv', input: { category: cat, limit: 20 } });
      const d = r?.data?.result as { ok?: boolean; error?: string; papers?: MacroPaper[] } | undefined;
      if (!d?.ok) throw new Error(d?.error || 'arXiv feed failed');
      return (d.papers ?? []).map((p): Paper => ({
        id: p.abstractUrl || p.arxivId || p.title,
        title: p.title,
        summary: p.summary,
        authors: p.authors ?? [],
        published: p.published,
        link: p.abstractUrl || (p.arxivId ? `https://arxiv.org/abs/${p.arxivId}` : ''),
        category: p.category || cat,
      }));
    },
    staleTime: 30 * 60 * 1000,
  });

  const list = papers.data || [];

  return (
    <div className="space-y-4">
      <header className="flex flex-wrap items-center justify-between gap-3 border-b border-cyan-500/15 pb-3">
        <div className="flex items-center gap-2"><Atom className="h-5 w-5 text-blue-400" /><h2 className="text-sm font-semibold text-white">Real-world physics papers</h2><span className="rounded bg-zinc-800 px-1.5 py-0.5 font-mono text-[10px] uppercase tracking-wider text-zinc-400">arxiv · {cat}</span></div>
        <div className="flex items-center gap-2">
          <select value={cat} onChange={(e) => setCat(e.target.value)} className="rounded border border-zinc-800 bg-zinc-950 px-2 py-1 text-xs text-white">{CATEGORIES.map((c) => <option key={c.id} value={c.id}>{c.label}</option>)}</select>
          {list.length > 0 && <SaveAsDtuButton compact apiSource="arxiv-physics" apiUrl={`https://export.arxiv.org/api/query?search_query=cat:${cat}`} title={`arXiv physics — ${cat} (${list.length})`} content={list.slice(0, 15).map((p, i) => `${i + 1}. ${p.title}\n   ${p.authors.slice(0, 3).join(', ')} · ${p.published.slice(0, 10)}\n   ${p.link}`).join('\n\n')} extraTags={['physics', 'arxiv', cat]} rawData={{ category: cat, papers: list }} defaultContentClass="knowledge" />}
        </div>
      </header>
      {papers.isError && <div className="rounded border border-red-500/20 bg-red-500/5 px-3 py-2 text-xs text-red-300">arXiv feed unavailable — the Concord server could not pull it.{papers.error instanceof Error && papers.error.message ? ` (${papers.error.message})` : ''}</div>}
      <div className="grid grid-cols-2 gap-2">
        <div className="rounded border border-zinc-800 bg-zinc-950 px-2.5 py-1.5"><div className="text-[10px] uppercase tracking-wider text-zinc-400">Papers</div><div className="mt-0.5 font-mono text-lg text-blue-300">{list.length}</div></div>
        <div className="rounded border border-zinc-800 bg-zinc-950 px-2.5 py-1.5"><div className="text-[10px] uppercase tracking-wider text-zinc-400">Newest</div><div className="mt-0.5 font-mono text-lg text-blue-300">{list[0]?.published?.slice(0, 10) || '—'}</div></div>
      </div>
      <div className="space-y-1.5 max-h-[500px] overflow-y-auto">
        {list.map((p) => (
          <a key={p.id} href={p.link} target="_blank" rel="noopener noreferrer" className="block rounded-lg border border-blue-500/20 bg-blue-500/5 p-2.5 hover:border-blue-500/40">
            <p className="line-clamp-2 text-[12px] text-zinc-100">{p.title}</p>
            <p className="mt-0.5 line-clamp-2 text-[10px] text-zinc-400">{p.summary}</p>
            <div className="mt-1 flex flex-wrap items-center gap-x-3 text-[10px] text-zinc-400">
              <span>{p.authors.slice(0, 2).join(', ')}</span>
              <span>{p.published.slice(0, 10)}</span>
              <ExternalLink className="h-3 w-3 text-zinc-400" />
            </div>
          </a>
        ))}
        {list.length === 0 && !papers.isPending && !papers.isError && <div className="rounded border border-dashed border-zinc-800 p-4 text-center text-[11px] text-zinc-400">No papers.</div>}
      </div>
      {papers.isPending && <div className="flex items-center gap-2 text-xs text-zinc-400"><Loader2 className="h-4 w-4 animate-spin" /> Pulling…</div>}
    </div>
  );
}
