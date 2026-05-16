'use client';

import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { Gavel, Loader2, ExternalLink, MessageSquare, ArrowUp, CheckCircle } from 'lucide-react';
import { SaveAsDtuButton } from '@/components/dtu/SaveAsDtuButton';

interface Question {
  question_id: number;
  title: string;
  link: string;
  score: number;
  answer_count: number;
  view_count: number;
  is_answered: boolean;
  creation_date: number;
  tags: string[];
  owner?: { display_name: string };
  accepted_answer_id?: number;
}

const SITES = [
  { id: 'law', label: 'law' },
  { id: 'politics', label: 'politics' },
  { id: 'workplace', label: 'workplace' },
  { id: 'money', label: 'money' },
];
const SORTS = [
  { id: 'votes', label: 'top voted' },
  { id: 'activity', label: 'recent activity' },
  { id: 'creation', label: 'newest' },
] as const;

export function LawStackFeed() {
  const [site, setSite] = useState(SITES[0].id);
  const [sort, setSort] = useState<typeof SORTS[number]['id']>('votes');

  const questions = useQuery({
    queryKey: ['stackex', site, sort],
    queryFn: async () => {
      const r = await fetch(`https://api.stackexchange.com/2.3/questions?order=desc&sort=${sort}&site=${site}&pagesize=25`);
      if (!r.ok) throw new Error(`stackex ${r.status}`);
      const j = await r.json();
      return (j.items || []) as Question[];
    },
    staleTime: 5 * 60 * 1000,
    refetchInterval: 5 * 60 * 1000,
  });

  const list = questions.data || [];
  const answered = list.filter((q) => q.is_answered).length;
  const totalViews = list.reduce((a, q) => a + (q.view_count || 0), 0);

  return (
    <div className="space-y-4">
      <header className="flex flex-wrap items-center justify-between gap-3 border-b border-cyan-500/15 pb-3">
        <div className="flex items-center gap-2">
          <Gavel className="h-5 w-5 text-amber-400" />
          <h2 className="text-sm font-semibold text-white">Real-world dispute Q&amp;A</h2>
          <span className="rounded bg-zinc-800 px-1.5 py-0.5 font-mono text-[10px] uppercase tracking-wider text-zinc-400">stackexchange · {site}.stackexchange.com</span>
        </div>
        <div className="flex items-center gap-2">
          <select value={site} onChange={(e) => setSite(e.target.value)} className="rounded border border-zinc-800 bg-zinc-950 px-2 py-1 text-xs text-white">
            {SITES.map((s) => <option key={s.id} value={s.id}>{s.label}.SE</option>)}
          </select>
          <select value={sort} onChange={(e) => setSort(e.target.value as typeof SORTS[number]['id'])} className="rounded border border-zinc-800 bg-zinc-950 px-2 py-1 text-xs text-white">
            {SORTS.map((s) => <option key={s.id} value={s.id}>{s.label}</option>)}
          </select>
          {list.length > 0 && (
            <SaveAsDtuButton
              compact
              apiSource="stackexchange-law"
              apiUrl={`https://api.stackexchange.com/2.3/questions?order=desc&sort=${sort}&site=${site}`}
              title={`${site}.SE — ${sort} (${list.length} questions)`}
              content={list.slice(0, 20).map((q, i) => `${i + 1}. [${q.score}↑ · ${q.answer_count}A · ${q.view_count.toLocaleString()} views${q.is_answered ? ' · ✓answered' : ''}] ${q.title}\n   ${q.link}`).join('\n\n')}
              extraTags={['disputes', 'stackexchange', site, sort]}
              rawData={{ site, sort, questions: list }}
            />
          )}
        </div>
      </header>
      {questions.isError && <div className="rounded border border-red-500/20 bg-red-500/5 px-3 py-2 text-xs text-red-300">Stack Exchange unreachable (rate-limit or network).</div>}
      <div className="grid grid-cols-3 gap-2">
        <div className="rounded border border-zinc-800 bg-zinc-950 px-2.5 py-1.5">
          <div className="text-[10px] uppercase tracking-wider text-zinc-500">Questions</div>
          <div className="mt-0.5 font-mono text-lg text-amber-300">{list.length}</div>
        </div>
        <div className="rounded border border-zinc-800 bg-zinc-950 px-2.5 py-1.5">
          <div className="text-[10px] uppercase tracking-wider text-zinc-500">Answered</div>
          <div className="mt-0.5 font-mono text-lg text-emerald-300">{answered} <span className="text-[10px] text-zinc-500">/ {list.length}</span></div>
        </div>
        <div className="rounded border border-zinc-800 bg-zinc-950 px-2.5 py-1.5">
          <div className="text-[10px] uppercase tracking-wider text-zinc-500">Total views</div>
          <div className="mt-0.5 font-mono text-lg text-amber-300">{totalViews.toLocaleString()}</div>
        </div>
      </div>
      <div className="space-y-1.5 max-h-[500px] overflow-y-auto">
        {list.map((q) => (
          <a key={q.question_id} href={q.link} target="_blank" rel="noopener noreferrer" className="block rounded-lg border border-amber-500/20 bg-amber-500/5 p-2.5 hover:border-amber-500/40">
            <div className="flex items-start justify-between gap-2">
              <div className="flex-1 min-w-0">
                <p className="line-clamp-2 text-[12px] text-zinc-100" dangerouslySetInnerHTML={{ __html: q.title }} />
                <div className="mt-1 flex flex-wrap items-center gap-x-3 gap-y-0.5 text-[10px] text-zinc-500">
                  <span className="flex items-center gap-0.5"><ArrowUp className="h-3 w-3" />{q.score}</span>
                  <span className="flex items-center gap-0.5"><MessageSquare className="h-3 w-3" />{q.answer_count}</span>
                  <span>{q.view_count.toLocaleString()} views</span>
                  {q.accepted_answer_id && <span className="flex items-center gap-0.5 text-emerald-400"><CheckCircle className="h-3 w-3" />accepted</span>}
                  {q.owner?.display_name && <span>by {q.owner.display_name}</span>}
                  <span>{new Date(q.creation_date * 1000).toLocaleDateString()}</span>
                </div>
                <div className="mt-1 flex flex-wrap gap-1">
                  {(q.tags || []).slice(0, 5).map((t) => <span key={t} className="rounded bg-zinc-800 px-1 font-mono text-[9px] text-zinc-300">{t}</span>)}
                </div>
              </div>
              <ExternalLink className="h-3 w-3 shrink-0 text-zinc-500" />
            </div>
          </a>
        ))}
        {list.length === 0 && !questions.isPending && !questions.isError && (
          <div className="rounded border border-dashed border-zinc-800 p-4 text-center text-[11px] text-zinc-500">No questions returned.</div>
        )}
      </div>
      {questions.isPending && <div className="flex items-center gap-2 text-xs text-zinc-500"><Loader2 className="h-4 w-4 animate-spin" /> Pulling Stack Exchange…</div>}
    </div>
  );
}
