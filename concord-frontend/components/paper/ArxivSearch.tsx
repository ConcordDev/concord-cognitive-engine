'use client';

import { useState } from 'react';
import { useMutation } from '@tanstack/react-query';
import { motion } from 'framer-motion';
import { FileText, Loader2, ExternalLink, Search } from 'lucide-react';
import { apiHelpers } from '@/lib/api/client';
import { SaveAsDtuButton } from '@/components/dtu/SaveAsDtuButton';

interface Paper { id: string; title: string; abstract?: string; authors?: string[]; published?: string; updated?: string; url?: string; pdfUrl?: string | null; primaryCategory?: string | null }

interface MacroEnvelope<T> { ok: boolean; result?: T; error?: string }

async function callMacro<T>(action: string, input: Record<string, unknown>): Promise<MacroEnvelope<T>> {
  const r = await apiHelpers.lens.runDomain('paper', action, { input });
  const data = (r as { data?: { ok: boolean; result?: T } }).data;
  if (!data) return { ok: false, error: 'empty response' };
  if (data.ok && data.result && typeof data.result === 'object' && 'ok' in data.result) {
    return data.result as MacroEnvelope<T>;
  }
  return data as MacroEnvelope<T>;
}

export function ArxivSearch() {
  const [query, setQuery] = useState('');
  const [papers, setPapers] = useState<Paper[]>([]);

  const search = useMutation({
    mutationFn: async () => callMacro<{ papers: Paper[] }>('search', { query: query.trim(), limit: 20 }),
    onSuccess: (env) => { if (env.ok && env.result) setPapers(env.result.papers); else setPapers([]); },
  });

  return (
    <div className="space-y-4">
      <header className="flex items-center justify-between gap-3 border-b border-cyan-500/15 pb-3">
        <div className="flex items-center gap-2">
          <FileText className="h-5 w-5 text-cyan-400" />
          <h2 className="text-sm font-semibold text-white">arXiv Search</h2>
          <span className="rounded bg-zinc-800 px-1.5 py-0.5 font-mono text-[10px] uppercase tracking-wider text-zinc-400">arxiv export api</span>
        </div>
      </header>
      <form onSubmit={(e) => { e.preventDefault(); if (query.trim()) search.mutate(); }} className="flex items-center gap-2">
        <div className="relative flex-1">
          <Search className="pointer-events-none absolute left-2.5 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-zinc-400" />
          <input type="text" value={query} onChange={(e) => setQuery(e.target.value)} placeholder="Topic — transformer attention, dark matter, graph neural networks…" className="w-full rounded-md border border-zinc-800 bg-zinc-950 py-1.5 pl-8 pr-3 text-sm text-white" />
        </div>
        <button type="submit" disabled={!query.trim() || search.isPending} className="inline-flex items-center gap-1.5 rounded-md border border-cyan-500/30 bg-cyan-500/10 px-3 py-1.5 text-xs text-cyan-200 hover:bg-cyan-500/20 disabled:opacity-50">
          {search.isPending ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Search className="h-3.5 w-3.5" />}
          Search arXiv
        </button>
      </form>
      <div className="space-y-1.5">
        {papers.map((p) => (
          <motion.div key={p.id} layout initial={{ opacity: 0, y: 4 }} animate={{ opacity: 1, y: 0 }} className="rounded border border-zinc-800 bg-zinc-950 p-3">
            <div className="flex items-start gap-3">
              <div className="min-w-0 flex-1">
                <div className="flex items-baseline gap-2">
                  <span className="font-mono text-[10px] text-cyan-300">{p.id}</span>
                  {p.primaryCategory && <span className="rounded bg-zinc-800 px-1.5 text-[9px] font-mono text-amber-300">{p.primaryCategory}</span>}
                  {p.published && <span className="text-[10px] text-zinc-400">{p.published.slice(0, 10)}</span>}
                </div>
                <h3 className="mt-0.5 line-clamp-2 text-sm font-semibold text-white">{p.title}</h3>
                {p.authors && p.authors.length > 0 && <p className="text-[11px] text-zinc-400">{p.authors.slice(0, 5).join(', ')}{p.authors.length > 5 ? ' et al.' : ''}</p>}
                {p.abstract && <p className="mt-1 line-clamp-3 text-[11px] text-zinc-400">{p.abstract}</p>}
              </div>
              <div className="flex shrink-0 items-center gap-1">
                <SaveAsDtuButton
                  compact
                  apiSource="arxiv"
                  apiUrl={p.url}
                  title={`${p.id} — ${p.title.slice(0, 80)}`}
                  content={`arXiv: ${p.id}\nTitle: ${p.title}\nAuthors: ${(p.authors || []).join(', ')}\nCategory: ${p.primaryCategory}\nPublished: ${p.published}\n\nAbstract:\n${p.abstract}\n\nURL: ${p.url}\nPDF: ${p.pdfUrl || ''}`}
                  extraTags={['paper', 'arxiv', p.primaryCategory || 'preprint']}
                  rawData={p}
                />
                {p.pdfUrl && <a href={p.pdfUrl} target="_blank" rel="noopener noreferrer" className="flex h-6 w-6 items-center justify-center rounded text-zinc-400 hover:bg-zinc-800 hover:text-zinc-200" aria-label="PDF"><ExternalLink className="h-3 w-3" /></a>}
              </div>
            </div>
          </motion.div>
        ))}
      </div>
    </div>
  );
}
