'use client';

import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { MessageSquare, Loader2, ExternalLink, ArrowUp } from 'lucide-react';
import { SaveAsDtuButton } from '@/components/dtu/SaveAsDtuButton';

interface Hit { objectID: string; title?: string; story_title?: string; url?: string; story_url?: string; author: string; points?: number; num_comments?: number; created_at: string; }

const TAGS = [
  { id: 'ask_hn', label: 'Ask HN' },
  { id: 'show_hn', label: 'Show HN' },
  { id: 'launch_hn', label: 'Launch HN' },
  { id: 'comment', label: 'comments' },
];

export function ThreadFeed() {
  const [tag, setTag] = useState(TAGS[0].id);

  const hits = useQuery({
    queryKey: ['hn-thread', tag],
    queryFn: async () => {
      const r = await fetch(`https://hn.algolia.com/api/v1/search?tags=${tag}&hitsPerPage=25`);
      if (!r.ok) throw new Error(`hn ${r.status}`);
      const j = await r.json();
      return (j.hits || []) as Hit[];
    },
    staleTime: 5 * 60 * 1000,
  });

  const list = hits.data || [];
  const totalComments = list.reduce((a, h) => a + (h.num_comments || 0), 0);

  return (
    <div className="space-y-4">
      <header className="flex flex-wrap items-center justify-between gap-3 border-b border-cyan-500/15 pb-3">
        <div className="flex items-center gap-2"><MessageSquare className="h-5 w-5 text-orange-400" /><h2 className="text-sm font-semibold text-white">Real-world threads</h2><span className="rounded bg-zinc-800 px-1.5 py-0.5 font-mono text-[10px] uppercase tracking-wider text-zinc-400">hn.algolia.com · {tag}</span></div>
        <div className="flex items-center gap-2">
          <select value={tag} onChange={(e) => setTag(e.target.value)} className="rounded border border-zinc-800 bg-zinc-950 px-2 py-1 text-xs text-white">{TAGS.map((t) => <option key={t.id} value={t.id}>{t.label}</option>)}</select>
          {list.length > 0 && <SaveAsDtuButton compact apiSource="hn-thread" apiUrl={`https://hn.algolia.com/api/v1/search?tags=${tag}`} title={`HN ${tag} threads (${list.length})`} content={list.slice(0, 20).map((h, i) => `${i + 1}. [${h.points || 0}↑ · ${h.num_comments || 0}💬] ${h.title || h.story_title}\n   ${h.url || h.story_url || `https://news.ycombinator.com/item?id=${h.objectID}`}`).join('\n\n')} extraTags={['thread', 'hn', tag]} rawData={{ tag, hits: list }} />}
        </div>
      </header>
      {hits.isError && <div className="rounded border border-red-500/20 bg-red-500/5 px-3 py-2 text-xs text-red-300">HN unreachable.</div>}
      <div className="grid grid-cols-2 gap-2">
        <div className="rounded border border-zinc-800 bg-zinc-950 px-2.5 py-1.5"><div className="text-[10px] uppercase tracking-wider text-zinc-500">Threads</div><div className="mt-0.5 font-mono text-lg text-orange-300">{list.length}</div></div>
        <div className="rounded border border-zinc-800 bg-zinc-950 px-2.5 py-1.5"><div className="text-[10px] uppercase tracking-wider text-zinc-500">Comments</div><div className="mt-0.5 font-mono text-lg text-orange-300">{totalComments.toLocaleString()}</div></div>
      </div>
      <div className="space-y-1.5 max-h-[500px] overflow-y-auto">
        {list.map((h) => {
          const title = h.title || h.story_title || '(no title)';
          const url = h.url || h.story_url || `https://news.ycombinator.com/item?id=${h.objectID}`;
          return (
            <a key={h.objectID} href={url} target="_blank" rel="noopener noreferrer" className="block rounded-lg border border-orange-500/20 bg-orange-500/5 p-2.5 hover:border-orange-500/40">
              <p className="line-clamp-2 text-[12px] text-zinc-100">{title}</p>
              <div className="mt-1 flex flex-wrap items-center gap-x-3 text-[10px] text-zinc-500">
                <span className="flex items-center gap-0.5"><ArrowUp className="h-3 w-3" />{h.points || 0}</span>
                <span className="flex items-center gap-0.5"><MessageSquare className="h-3 w-3" />{h.num_comments || 0}</span>
                <span>{h.author}</span>
                <ExternalLink className="h-3 w-3 text-zinc-500" />
              </div>
            </a>
          );
        })}
        {list.length === 0 && !hits.isPending && !hits.isError && <div className="rounded border border-dashed border-zinc-800 p-4 text-center text-[11px] text-zinc-500">No threads.</div>}
      </div>
      {hits.isPending && <div className="flex items-center gap-2 text-xs text-zinc-500"><Loader2 className="h-4 w-4 animate-spin" /> Pulling…</div>}
    </div>
  );
}
