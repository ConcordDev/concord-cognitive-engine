'use client';

import { useState } from 'react';
import { useMutation } from '@tanstack/react-query';
import { MessageCircleQuestion, Loader2, Search, ExternalLink, ThumbsUp, CheckCircle2 } from 'lucide-react';
import { SaveAsDtuButton } from '@/components/dtu/SaveAsDtuButton';

interface SoQuestion {
  question_id: number;
  title: string;
  link: string;
  score: number;
  answer_count: number;
  is_answered: boolean;
  accepted_answer_id?: number;
  tags: string[];
  owner: { display_name: string; reputation: number };
  creation_date: number;
  view_count: number;
}

const SITES = [
  { id: 'stackoverflow', label: 'Stack Overflow' },
  { id: 'superuser', label: 'Super User' },
  { id: 'serverfault', label: 'Server Fault' },
  { id: 'softwareengineering', label: 'Software Eng.' },
  { id: 'ai', label: 'AI' },
  { id: 'datascience', label: 'Data Science' },
  { id: 'codereview', label: 'Code Review' },
];

export function StackOverflowSearch() {
  const [query, setQuery] = useState('');
  const [site, setSite] = useState('stackoverflow');
  const [hits, setHits] = useState<SoQuestion[]>([]);
  const [error, setError] = useState<string | null>(null);

  const search = useMutation({
    mutationFn: async () => {
      setError(null);
      const url = `https://api.stackexchange.com/2.3/search/advanced?order=desc&sort=relevance&q=${encodeURIComponent(query)}&site=${site}&pagesize=20&filter=!9_bDDxJY5`;
      try {
        const r = await fetch(url);
        if (!r.ok) throw new Error(`stackexchange ${r.status}`);
        const j = await r.json();
        if (j.error_id) throw new Error(j.error_message || 'Stack Exchange error');
        setHits(j.items || []);
      } catch (e) { setHits([]); setError(e instanceof Error ? e.message : 'request failed'); }
    },
  });

  return (
    <div className="space-y-4">
      <header className="flex flex-wrap items-center justify-between gap-3 border-b border-cyan-500/15 pb-3">
        <div className="flex items-center gap-2">
          <MessageCircleQuestion className="h-5 w-5 text-cyan-400" />
          <h2 className="text-sm font-semibold text-white">Stack Exchange answers</h2>
          <span className="rounded bg-zinc-800 px-1.5 py-0.5 font-mono text-[10px] uppercase tracking-wider text-zinc-400">api.stackexchange.com 2.3 · no key</span>
        </div>
        {hits.length > 0 && (
          <SaveAsDtuButton
            compact
            apiSource="stackexchange"
            apiUrl={`https://api.stackexchange.com/2.3/search/advanced?q=${encodeURIComponent(query)}&site=${site}`}
            title={`${SITES.find((s) => s.id === site)?.label} answers — "${query}" (${hits.length})`}
            content={hits.slice(0, 25).map((q, i) => `${i + 1}. ${q.title} [${q.score}↑ · ${q.answer_count} ans${q.is_answered ? ' · ✓ accepted' : ''}]\n   ${q.link}\n   tags: ${q.tags.join(', ')}`).join('\n\n')}
            extraTags={['answers', 'stackexchange', site]}
            rawData={{ query, site, hits }}
          />
        )}
      </header>
      <form onSubmit={(e) => { e.preventDefault(); if (query.trim()) search.mutate(); }} className="flex flex-wrap items-center gap-2">
        <select value={site} onChange={(e) => setSite(e.target.value)} className="rounded border border-zinc-800 bg-zinc-950 px-2 py-1.5 text-xs text-white">
          {SITES.map((s) => <option key={s.id} value={s.id}>{s.label}</option>)}
        </select>
        <div className="relative flex-1 min-w-[200px]">
          <Search className="pointer-events-none absolute left-2.5 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-zinc-500" />
          <input type="text" value={query} onChange={(e) => setQuery(e.target.value)} placeholder="Ask anything…" className="w-full rounded-md border border-zinc-800 bg-zinc-950 py-1.5 pl-8 pr-3 text-sm text-white" />
        </div>
        <button type="submit" disabled={!query.trim() || search.isPending} className="inline-flex items-center gap-1.5 rounded-md border border-cyan-500/30 bg-cyan-500/10 px-3 py-1.5 text-xs text-cyan-200 hover:bg-cyan-500/20 disabled:opacity-50">
          {search.isPending ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Search className="h-3.5 w-3.5" />}
          Search
        </button>
      </form>
      {error && <div className="rounded border border-red-500/20 bg-red-500/5 px-3 py-2 text-xs text-red-300">{error}</div>}
      <div className="space-y-1 max-h-96 overflow-y-auto">
        {hits.map((q) => (
          <a key={q.question_id} href={q.link} target="_blank" rel="noopener noreferrer" className="block rounded border border-zinc-800 bg-zinc-950 p-2.5 hover:border-cyan-500/30">
            <div className="flex items-start justify-between gap-2">
              <div className="flex-1 min-w-0">
                <div className="flex items-center gap-2">
                  <span className="line-clamp-1 text-sm text-white">{q.title}</span>
                  {q.is_answered && <CheckCircle2 className="h-3.5 w-3.5 shrink-0 text-emerald-400" />}
                </div>
                <div className="mt-0.5 flex flex-wrap items-center gap-x-3 gap-y-0.5 text-[10px] text-zinc-500">
                  <span className="flex items-center gap-0.5"><ThumbsUp className="h-3 w-3" />{q.score}</span>
                  <span>{q.answer_count} answers</span>
                  <span>{q.view_count.toLocaleString()} views</span>
                  <span>by {q.owner.display_name} ({q.owner.reputation.toLocaleString()})</span>
                </div>
                <div className="mt-1 flex flex-wrap gap-1">
                  {q.tags.slice(0, 6).map((t) => <span key={t} className="rounded bg-zinc-800 px-1 font-mono text-[9px] text-cyan-300">{t}</span>)}
                </div>
              </div>
              <ExternalLink className="h-3 w-3 text-zinc-500" />
            </div>
          </a>
        ))}
        {hits.length === 0 && !search.isPending && !error && (
          <div className="rounded border border-dashed border-zinc-800 p-6 text-center text-[11px] text-zinc-500">Search Stack Exchange for real answers.</div>
        )}
      </div>
    </div>
  );
}
