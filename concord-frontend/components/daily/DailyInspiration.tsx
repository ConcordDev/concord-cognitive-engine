'use client';

import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { Quote, Loader2, RefreshCw } from 'lucide-react';
import { lensRun } from '@/lib/api/client';
import { SaveAsDtuButton } from '@/components/dtu/SaveAsDtuButton';

interface LiveQuote { content: string; author: string }
interface QuoteReply { source?: string; degraded?: boolean; quotes?: LiveQuote[] }

export function DailyInspiration() {
  const [tick, setTick] = useState(0);

  // daily.live_quote runs server-side (Quotable, falling back to ZenQuotes etc.) and
  // reports which provider answered. One call fetches a batch; "new" steps through it.
  const quotes = useQuery({
    queryKey: ['daily-live-quotes'],
    queryFn: async () => {
      const r = await lensRun<QuoteReply>('daily', 'live_quote', { limit: 10 });
      if (!r.data.ok) throw new Error(r.data.error || r.data.reason || 'quote_unavailable');
      return r.data.result || {};
    },
    staleTime: 10 * 60 * 1000,
  });

  const list = quotes.data?.quotes || [];
  const q = list.length > 0 ? list[tick % list.length] : null;
  const source = quotes.data?.source;
  const sourceLabel = source === 'local' ? "Concord's built-in list" : source;

  return (
    <div className="space-y-4">
      <header className="flex items-center justify-between gap-3 border-b border-cyan-500/15 pb-3">
        <div className="flex items-center gap-2">
          <Quote className="h-5 w-5 text-cyan-400" />
          <h2 className="text-sm font-semibold text-white">Daily inspiration</h2>
          <span className="rounded bg-zinc-800 px-1.5 py-0.5 font-mono text-[10px] uppercase tracking-wider text-zinc-400">{sourceLabel ? `${sourceLabel}${source === 'local' ? '' : ' · live'}` : 'quotes'}</span>
        </div>
        <div className="flex items-center gap-2">
          <button onClick={() => setTick((t) => t + 1)} disabled={list.length < 2} className="inline-flex items-center gap-1 rounded border border-cyan-500/30 bg-cyan-500/10 px-2 py-1 text-[10px] text-cyan-200 hover:bg-cyan-500/20 disabled:opacity-40"><RefreshCw className="h-3 w-3" /> new</button>
          {q && (
            <SaveAsDtuButton
              compact
              apiSource={source === 'ZenQuotes' ? 'zenquotes' : 'daily-quote'}
              apiUrl={source === 'ZenQuotes' ? 'https://zenquotes.io/api/random' : undefined}
              title={`Quote — ${q.author}`}
              content={`"${q.content}"\n— ${q.author}`}
              extraTags={['daily', 'quote', q.author.toLowerCase().replace(/\s+/g, '-')]}
              rawData={{ q: q.content, a: q.author, source }}
            />
          )}
        </div>
      </header>
      {quotes.isError && <div className="rounded border border-red-500/20 bg-red-500/5 px-3 py-2 text-xs text-red-300">Quote sources unreachable.</div>}
      {quotes.isPending && <div className="flex items-center gap-2 text-xs text-zinc-400"><Loader2 className="h-4 w-4 animate-spin" /> Pulling a fresh quote…</div>}
      {quotes.data?.degraded && !quotes.isError && (
        <p className="text-[11px] text-zinc-400">{source === 'local' ? "Live quote sources are unavailable; showing a quote from Concord's built-in list." : `Quotable is unavailable; showing a quote from ${source}.`}</p>
      )}
      {q && (
        <blockquote className="rounded-lg border border-cyan-500/20 bg-zinc-950/60 p-6">
          <p className="font-serif text-lg leading-relaxed text-white">&ldquo;{q.content}&rdquo;</p>
          <p className="mt-4 text-right font-mono text-sm text-cyan-300">— {q.author}</p>
        </blockquote>
      )}
    </div>
  );
}
