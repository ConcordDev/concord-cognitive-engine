'use client';

import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { Brain, Loader2, ExternalLink, MessageSquare, ArrowUp, CheckCircle } from 'lucide-react';
import { SaveAsDtuButton } from '@/components/dtu/SaveAsDtuButton';

interface Question { question_id: number; title: string; link: string; score: number; answer_count: number; view_count: number; is_answered: boolean; tags: string[]; accepted_answer_id?: number; }

const TAGS = [
  { id: 'epistemology', label: 'epistemology' },
  { id: 'metaphysics', label: 'metaphysics' },
  { id: 'logic', label: 'logic' },
  { id: 'philosophy-of-mind', label: 'philosophy-of-mind' },
  { id: 'aesthetics', label: 'aesthetics' },
  { id: 'phenomenology', label: 'phenomenology' },
];

export function PhiloFeed() {
  const [tag, setTag] = useState(TAGS[0].id);

  const questions = useQuery({
    queryKey: ['philo-stack', tag],
    queryFn: async () => {
      const r = await fetch(`https://api.stackexchange.com/2.3/questions?tagged=${tag}&order=desc&sort=votes&site=philosophy&pagesize=25`);
      if (!r.ok) throw new Error(`stackex ${r.status}`);
      const j = await r.json();
      return (j.items || []) as Question[];
    },
    staleTime: 30 * 60 * 1000,
  });

  const list = questions.data || [];
  const answered = list.filter((q) => q.is_answered).length;

  return (
    <div className="space-y-4">
      <header className="flex flex-wrap items-center justify-between gap-3 border-b border-cyan-500/15 pb-3">
        <div className="flex items-center gap-2"><Brain className="h-5 w-5 text-violet-400" /><h2 className="text-sm font-semibold text-white">Real-world philosophy Q&amp;A</h2><span className="rounded bg-zinc-800 px-1.5 py-0.5 font-mono text-[10px] uppercase tracking-wider text-zinc-400">philosophy.stackexchange.com · {tag}</span></div>
        <div className="flex items-center gap-2">
          <select value={tag} onChange={(e) => setTag(e.target.value)} className="rounded border border-zinc-800 bg-zinc-950 px-2 py-1 text-xs text-white">{TAGS.map((t) => <option key={t.id} value={t.id}>{t.label}</option>)}</select>
          {list.length > 0 && <SaveAsDtuButton compact apiSource="philosophy-stackexchange" apiUrl={`https://api.stackexchange.com/2.3/questions?tagged=${tag}&site=philosophy`} title={`philosophy.SE — ${tag} (${list.length})`} content={list.slice(0, 20).map((q, i) => `${i + 1}. [${q.score}↑ · ${q.answer_count}A${q.is_answered ? ' ✓' : ''}] ${q.title}\n   ${q.link}`).join('\n\n')} extraTags={['philosophy', 'stackexchange', tag]} rawData={{ tag, questions: list }} />}
        </div>
      </header>
      {questions.isError && <div className="rounded border border-red-500/20 bg-red-500/5 px-3 py-2 text-xs text-red-300">Stack Exchange unreachable.</div>}
      <div className="grid grid-cols-2 gap-2">
        <div className="rounded border border-zinc-800 bg-zinc-950 px-2.5 py-1.5"><div className="text-[10px] uppercase tracking-wider text-zinc-500">Questions</div><div className="mt-0.5 font-mono text-lg text-violet-300">{list.length}</div></div>
        <div className="rounded border border-zinc-800 bg-zinc-950 px-2.5 py-1.5"><div className="text-[10px] uppercase tracking-wider text-zinc-500">Answered</div><div className="mt-0.5 font-mono text-lg text-emerald-300">{answered}</div></div>
      </div>
      <div className="space-y-1.5 max-h-[500px] overflow-y-auto">
        {list.map((q) => (
          <a key={q.question_id} href={q.link} target="_blank" rel="noopener noreferrer" className="block rounded-lg border border-violet-500/20 bg-violet-500/5 p-2.5 hover:border-violet-500/40">
            <p className="line-clamp-2 text-[12px] text-zinc-100" dangerouslySetInnerHTML={{ __html: q.title }} />
            <div className="mt-1 flex flex-wrap items-center gap-x-3 text-[10px] text-zinc-500">
              <span className="flex items-center gap-0.5"><ArrowUp className="h-3 w-3" />{q.score}</span>
              <span className="flex items-center gap-0.5"><MessageSquare className="h-3 w-3" />{q.answer_count}</span>
              {q.accepted_answer_id && <span className="flex items-center gap-0.5 text-emerald-400"><CheckCircle className="h-3 w-3" />accepted</span>}
              <ExternalLink className="h-3 w-3 text-zinc-500" />
            </div>
            <div className="mt-1 flex flex-wrap gap-1">{(q.tags || []).slice(0, 5).map((t) => <span key={t} className="rounded bg-zinc-800 px-1 font-mono text-[9px] text-zinc-300">{t}</span>)}</div>
          </a>
        ))}
        {list.length === 0 && !questions.isPending && !questions.isError && <div className="rounded border border-dashed border-zinc-800 p-4 text-center text-[11px] text-zinc-500">No questions.</div>}
      </div>
      {questions.isPending && <div className="flex items-center gap-2 text-xs text-zinc-500"><Loader2 className="h-4 w-4 animate-spin" /> Pulling…</div>}
    </div>
  );
}
