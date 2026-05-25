'use client';

import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { Sparkles, Loader2, ArrowUp, MessageSquare, ExternalLink } from 'lucide-react';
import { SaveAsDtuButton } from '@/components/dtu/SaveAsDtuButton';

interface RedditPost {
  id: string;
  title: string;
  author: string;
  permalink: string;
  url: string;
  score: number;
  num_comments: number;
  created_utc: number;
  subreddit: string;
  thumbnail?: string;
  link_flair_text?: string | null;
  is_video?: boolean;
  preview?: { images?: { source: { url: string; width: number; height: number } }[] };
}

const SUBS = [
  { id: 'Design', label: 'Design' },
  { id: 'graphic_design', label: 'GraphicDesign' },
  { id: 'art', label: 'Art' },
  { id: 'WeWantPlates', label: 'Plates' },
  { id: 'IndustrialDesign', label: 'IndustrialDesign' },
  { id: 'creativity', label: 'Creativity' },
];

export function RedditCreative() {
  const [sub, setSub] = useState(SUBS[0].id);
  const [sort, setSort] = useState<'top' | 'hot' | 'new'>('top');

  const posts = useQuery({
    queryKey: ['reddit-creative', sub, sort],
    queryFn: async () => {
      const r = await fetch(`https://www.reddit.com/r/${sub}/${sort}.json?limit=25&t=week`);
      if (!r.ok) throw new Error(`reddit ${r.status}`);
      const j = await r.json();
      return ((j.data?.children || []) as { data: RedditPost }[]).map((c) => c.data);
    },
    staleTime: 10 * 60 * 1000,
  });

  return (
    <div className="space-y-4">
      <header className="flex flex-wrap items-center justify-between gap-3 border-b border-cyan-500/15 pb-3">
        <div className="flex items-center gap-2">
          <Sparkles className="h-5 w-5 text-cyan-400" />
          <h2 className="text-sm font-semibold text-white">Reddit creative feed</h2>
          <span className="rounded bg-zinc-800 px-1.5 py-0.5 font-mono text-[10px] uppercase tracking-wider text-zinc-400">reddit.com/r/{sub} · live</span>
        </div>
        <div className="flex items-center gap-2">
          <select value={sub} onChange={(e) => setSub(e.target.value)} className="rounded border border-zinc-800 bg-zinc-950 px-2 py-1 text-xs text-white">
            {SUBS.map((s) => <option key={s.id} value={s.id}>r/{s.label}</option>)}
          </select>
          <div className="flex rounded-md border border-zinc-800 bg-zinc-950 p-0.5 text-[10px]">
            {(['top', 'hot', 'new'] as const).map((s) => (
              <button key={s} onClick={() => setSort(s)} className={`rounded px-2 py-0.5 font-mono uppercase ${sort === s ? 'bg-cyan-500/20 text-cyan-200' : 'text-zinc-400 hover:text-zinc-300'}`}>{s}</button>
            ))}
          </div>
          {(posts.data?.length ?? 0) > 0 && (
            <SaveAsDtuButton
              compact
              apiSource="reddit"
              apiUrl={`https://www.reddit.com/r/${sub}/${sort}.json`}
              title={`r/${sub} ${sort} — ${posts.data?.length} posts`}
              content={(posts.data || []).slice(0, 20).map((p, i) => `${i + 1}. ${p.title} [${p.score}↑ · ${p.num_comments} comments] by ${p.author}\n   https://reddit.com${p.permalink}`).join('\n\n')}
              extraTags={['creative', 'reddit', sub.toLowerCase()]}
              rawData={{ sub, sort, posts: posts.data }}
            />
          )}
        </div>
      </header>
      {posts.isError && <div className="rounded border border-red-500/20 bg-red-500/5 px-3 py-2 text-xs text-red-300">Reddit unreachable.</div>}
      {posts.isPending && <div className="flex items-center gap-2 text-xs text-zinc-400"><Loader2 className="h-4 w-4 animate-spin" /> Loading…</div>}
      <div className="grid grid-cols-2 gap-2 sm:grid-cols-3 md:grid-cols-4 max-h-[520px] overflow-y-auto">
        {(posts.data || []).map((p) => {
          const img = p.preview?.images?.[0]?.source?.url?.replace(/&amp;/g, '&');
          const hasThumb = img || (p.thumbnail && p.thumbnail.startsWith('http'));
          return (
            <a key={p.id} href={`https://reddit.com${p.permalink}`} target="_blank" rel="noopener noreferrer" className="group block rounded border border-zinc-800 bg-zinc-950 overflow-hidden hover:border-cyan-500/30">
              {hasThumb ? (
                // eslint-disable-next-line @next/next/no-img-element
                <img src={img || p.thumbnail} alt={p.title} className="h-32 w-full object-cover" loading="lazy" />
              ) : (
                <div className="flex h-32 items-center justify-center bg-zinc-900"><Sparkles className="h-7 w-7 text-zinc-700" /></div>
              )}
              <div className="px-2 py-1.5">
                <div className="line-clamp-2 text-[11px] text-white group-hover:text-cyan-300">{p.title}</div>
                <div className="mt-0.5 flex items-center justify-between font-mono text-[9px] text-zinc-400">
                  <span className="flex items-center gap-0.5"><ArrowUp className="h-2.5 w-2.5" />{p.score}</span>
                  <span className="flex items-center gap-0.5"><MessageSquare className="h-2.5 w-2.5" />{p.num_comments}</span>
                  <ExternalLink className="h-2.5 w-2.5" />
                </div>
              </div>
            </a>
          );
        })}
      </div>
    </div>
  );
}
