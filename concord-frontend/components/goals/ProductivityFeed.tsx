'use client';

import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { Target, Loader2, ExternalLink, ArrowUp, MessageSquare } from 'lucide-react';
import { SaveAsDtuButton } from '@/components/dtu/SaveAsDtuButton';

interface Post { id: string; title: string; permalink: string; author: string; score: number; num_comments: number; link_flair_text?: string; }

const SUBS = [
  { id: 'getdisciplined', label: 'r/getdisciplined' },
  { id: 'productivity', label: 'r/productivity' },
  { id: 'GetMotivated', label: 'r/GetMotivated' },
  { id: 'selfimprovement', label: 'r/selfimprovement' },
  { id: 'decidingtobebetter', label: 'r/decidingtobebetter' },
];
const WINDOWS = ['day', 'week', 'month'] as const;

export function ProductivityFeed() {
  const [sub, setSub] = useState(SUBS[0].id);
  const [windowKey, setWindowKey] = useState<typeof WINDOWS[number]>('week');

  const posts = useQuery({
    queryKey: ['reddit-goals', sub, windowKey],
    queryFn: async () => {
      const r = await fetch(`https://www.reddit.com/r/${sub}/top.json?t=${windowKey}&limit=25`);
      if (!r.ok) throw new Error(`reddit ${r.status}`);
      const j = await r.json();
      return (j?.data?.children || []).map((c: { data: Post }) => c.data) as Post[];
    },
    staleTime: 5 * 60 * 1000,
  });

  const list = posts.data || [];
  const totalScore = list.reduce((a, p) => a + (p.score || 0), 0);
  const totalComments = list.reduce((a, p) => a + (p.num_comments || 0), 0);

  return (
    <div className="space-y-4">
      <header className="flex flex-wrap items-center justify-between gap-3 border-b border-cyan-500/15 pb-3">
        <div className="flex items-center gap-2"><Target className="h-5 w-5 text-emerald-400" /><h2 className="text-sm font-semibold text-white">Real-world goal-setting feed</h2><span className="rounded bg-zinc-800 px-1.5 py-0.5 font-mono text-[10px] uppercase tracking-wider text-zinc-400">reddit · top {windowKey}</span></div>
        <div className="flex items-center gap-2">
          <select value={sub} onChange={(e) => setSub(e.target.value)} className="rounded border border-zinc-800 bg-zinc-950 px-2 py-1 text-xs text-white">{SUBS.map((s) => <option key={s.id} value={s.id}>{s.label}</option>)}</select>
          <select value={windowKey} onChange={(e) => setWindowKey(e.target.value as typeof WINDOWS[number])} className="rounded border border-zinc-800 bg-zinc-950 px-2 py-1 text-xs text-white">{WINDOWS.map((w) => <option key={w} value={w}>{w}</option>)}</select>
          {list.length > 0 && <SaveAsDtuButton compact apiSource="reddit-goals" apiUrl={`https://www.reddit.com/r/${sub}/top.json?t=${windowKey}`} title={`r/${sub} — top ${windowKey} (${list.length})`} content={list.slice(0, 20).map((p, i) => `${i + 1}. [${p.score}↑ · ${p.num_comments}💬] ${p.title}\n   https://reddit.com${p.permalink}`).join('\n\n')} extraTags={['goals', 'reddit', sub.toLowerCase(), windowKey]} rawData={{ sub, window: windowKey, posts: list }} />}
        </div>
      </header>
      {posts.isError && <div className="rounded border border-red-500/20 bg-red-500/5 px-3 py-2 text-xs text-red-300">Reddit unreachable.</div>}
      <div className="grid grid-cols-3 gap-2">
        <div className="rounded border border-zinc-800 bg-zinc-950 px-2.5 py-1.5"><div className="text-[10px] uppercase tracking-wider text-zinc-400">Posts</div><div className="mt-0.5 font-mono text-lg text-emerald-300">{list.length}</div></div>
        <div className="rounded border border-zinc-800 bg-zinc-950 px-2.5 py-1.5"><div className="text-[10px] uppercase tracking-wider text-zinc-400">Upvotes</div><div className="mt-0.5 font-mono text-lg text-emerald-300">{totalScore.toLocaleString()}</div></div>
        <div className="rounded border border-zinc-800 bg-zinc-950 px-2.5 py-1.5"><div className="text-[10px] uppercase tracking-wider text-zinc-400">Comments</div><div className="mt-0.5 font-mono text-lg text-emerald-300">{totalComments.toLocaleString()}</div></div>
      </div>
      <div className="space-y-1.5 max-h-[500px] overflow-y-auto">
        {list.map((p) => (
          <a key={p.id} href={`https://reddit.com${p.permalink}`} target="_blank" rel="noopener noreferrer" className="block rounded-lg border border-emerald-500/20 bg-emerald-500/5 p-2.5 hover:border-emerald-500/40">
            <p className="line-clamp-2 text-[12px] text-zinc-100">{p.title}</p>
            <div className="mt-1 flex flex-wrap items-center gap-x-3 text-[10px] text-zinc-400">
              <span className="flex items-center gap-0.5"><ArrowUp className="h-3 w-3" />{p.score}</span>
              <span className="flex items-center gap-0.5"><MessageSquare className="h-3 w-3" />{p.num_comments}</span>
              <span>u/{p.author}</span>
              {p.link_flair_text && <span className="rounded bg-emerald-500/20 px-1 font-mono text-[9px] text-emerald-200">{p.link_flair_text}</span>}
              <ExternalLink className="h-3 w-3 text-zinc-400" />
            </div>
          </a>
        ))}
        {list.length === 0 && !posts.isPending && !posts.isError && <div className="rounded border border-dashed border-zinc-800 p-4 text-center text-[11px] text-zinc-400">No posts.</div>}
      </div>
      {posts.isPending && <div className="flex items-center gap-2 text-xs text-zinc-400"><Loader2 className="h-4 w-4 animate-spin" /> Pulling…</div>}
    </div>
  );
}
