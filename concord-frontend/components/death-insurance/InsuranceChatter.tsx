'use client';

import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { Scroll, Loader2, ExternalLink, MessageSquare, ArrowUp } from 'lucide-react';
import { SaveAsDtuButton } from '@/components/dtu/SaveAsDtuButton';

interface Post {
  id: string;
  title: string;
  permalink: string;
  url: string;
  author: string;
  score: number;
  num_comments: number;
  created_utc: number;
  subreddit: string;
  selftext?: string;
  link_flair_text?: string;
}

const SUBS = [
  { id: 'Insurance', label: 'r/Insurance' },
  { id: 'personalfinance', label: 'r/personalfinance' },
  { id: 'EstatePlanning', label: 'r/EstatePlanning' },
  { id: 'inheritance', label: 'r/inheritance' },
];
const WINDOWS = ['day', 'week', 'month'] as const;

export function InsuranceChatter() {
  const [sub, setSub] = useState(SUBS[0].id);
  const [windowKey, setWindowKey] = useState<typeof WINDOWS[number]>('week');

  const posts = useQuery({
    queryKey: ['reddit-insurance', sub, windowKey],
    queryFn: async () => {
      const r = await fetch(`https://www.reddit.com/r/${sub}/top.json?t=${windowKey}&limit=25`);
      if (!r.ok) throw new Error(`reddit ${r.status}`);
      const j = await r.json();
      return (j?.data?.children || []).map((c: { data: Post }) => c.data) as Post[];
    },
    staleTime: 5 * 60 * 1000,
    refetchInterval: 5 * 60 * 1000,
  });

  const list = posts.data || [];
  const totalScore = list.reduce((a, p) => a + (p.score || 0), 0);
  const totalComments = list.reduce((a, p) => a + (p.num_comments || 0), 0);

  return (
    <div className="space-y-4">
      <header className="flex flex-wrap items-center justify-between gap-3 border-b border-cyan-500/15 pb-3">
        <div className="flex items-center gap-2">
          <Scroll className="h-5 w-5 text-amber-400" />
          <h2 className="text-sm font-semibold text-white">Real-world insurance chatter</h2>
          <span className="rounded bg-zinc-800 px-1.5 py-0.5 font-mono text-[10px] uppercase tracking-wider text-zinc-400">reddit.com · top {windowKey}</span>
        </div>
        <div className="flex items-center gap-2">
          <select value={sub} onChange={(e) => setSub(e.target.value)} className="rounded border border-zinc-800 bg-zinc-950 px-2 py-1 text-xs text-white">
            {SUBS.map((s) => <option key={s.id} value={s.id}>{s.label}</option>)}
          </select>
          <select value={windowKey} onChange={(e) => setWindowKey(e.target.value as typeof WINDOWS[number])} className="rounded border border-zinc-800 bg-zinc-950 px-2 py-1 text-xs text-white">
            {WINDOWS.map((w) => <option key={w} value={w}>{w}</option>)}
          </select>
          {list.length > 0 && (
            <SaveAsDtuButton
              compact
              apiSource="reddit-insurance"
              apiUrl={`https://www.reddit.com/r/${sub}/top.json?t=${windowKey}`}
              title={`r/${sub} — top ${windowKey} (${list.length} posts)`}
              content={list.slice(0, 20).map((p, i) => `${i + 1}. [${p.score}↑ · ${p.num_comments}💬] ${p.title}${p.link_flair_text ? ` · ${p.link_flair_text}` : ''}\n   https://reddit.com${p.permalink}`).join('\n\n')}
              extraTags={['death-insurance', 'reddit', sub.toLowerCase(), windowKey]}
              rawData={{ sub, window: windowKey, posts: list }}
            />
          )}
        </div>
      </header>
      {posts.isError && <div className="rounded border border-red-500/20 bg-red-500/5 px-3 py-2 text-xs text-red-300">Reddit unreachable (rate-limit or network).</div>}
      <div className="grid grid-cols-3 gap-2">
        <div className="rounded border border-zinc-800 bg-zinc-950 px-2.5 py-1.5">
          <div className="text-[10px] uppercase tracking-wider text-zinc-400">Posts</div>
          <div className="mt-0.5 font-mono text-lg text-amber-300">{list.length}</div>
        </div>
        <div className="rounded border border-zinc-800 bg-zinc-950 px-2.5 py-1.5">
          <div className="text-[10px] uppercase tracking-wider text-zinc-400">Total upvotes</div>
          <div className="mt-0.5 font-mono text-lg text-amber-300">{totalScore.toLocaleString()}</div>
        </div>
        <div className="rounded border border-zinc-800 bg-zinc-950 px-2.5 py-1.5">
          <div className="text-[10px] uppercase tracking-wider text-zinc-400">Total comments</div>
          <div className="mt-0.5 font-mono text-lg text-amber-300">{totalComments.toLocaleString()}</div>
        </div>
      </div>
      <div className="space-y-1.5 max-h-[500px] overflow-y-auto">
        {list.map((p) => (
          <a key={p.id} href={`https://reddit.com${p.permalink}`} target="_blank" rel="noopener noreferrer" className="block rounded-lg border border-amber-500/20 bg-amber-500/5 p-2.5 hover:border-amber-500/40">
            <div className="flex items-start justify-between gap-2">
              <div className="flex-1 min-w-0">
                <p className="line-clamp-2 text-[12px] text-zinc-100">{p.title}</p>
                <div className="mt-1 flex flex-wrap items-center gap-x-3 text-[10px] text-zinc-400">
                  <span className="flex items-center gap-0.5"><ArrowUp className="h-3 w-3" />{p.score}</span>
                  <span className="flex items-center gap-0.5"><MessageSquare className="h-3 w-3" />{p.num_comments}</span>
                  <span>u/{p.author}</span>
                  <span>{new Date(p.created_utc * 1000).toLocaleDateString()}</span>
                  {p.link_flair_text && <span className="rounded bg-amber-500/20 px-1 font-mono text-[9px] text-amber-200">{p.link_flair_text}</span>}
                </div>
              </div>
              <ExternalLink className="h-3 w-3 shrink-0 text-zinc-400" />
            </div>
          </a>
        ))}
        {list.length === 0 && !posts.isPending && !posts.isError && (
          <div className="rounded border border-dashed border-zinc-800 p-4 text-center text-[11px] text-zinc-400">No posts in this window.</div>
        )}
      </div>
      {posts.isPending && <div className="flex items-center gap-2 text-xs text-zinc-400"><Loader2 className="h-4 w-4 animate-spin" /> Pulling top posts…</div>}
    </div>
  );
}
