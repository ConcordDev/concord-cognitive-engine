'use client';

import { useEffect, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { Quote, Loader2, RefreshCw } from 'lucide-react';
import { SaveAsDtuButton } from '@/components/dtu/SaveAsDtuButton';

interface ZenQuote { q: string; a: string; h?: string }

export function DailyInspiration() {
  const [tick, setTick] = useState(0);

  const quote = useQuery({
    queryKey: ['zen-quote', tick],
    queryFn: async () => {
      const r = await fetch('https://zenquotes.io/api/random');
      if (!r.ok) throw new Error(`zenquotes ${r.status}`);
      const j = await r.json();
      return (j[0] || null) as ZenQuote | null;
    },
    staleTime: Infinity,
  });

  useEffect(() => { void tick; }, [tick]);

  const q = quote.data;

  return (
    <div className="space-y-4">
      <header className="flex items-center justify-between gap-3 border-b border-cyan-500/15 pb-3">
        <div className="flex items-center gap-2">
          <Quote className="h-5 w-5 text-cyan-400" />
          <h2 className="text-sm font-semibold text-white">Daily inspiration</h2>
          <span className="rounded bg-zinc-800 px-1.5 py-0.5 font-mono text-[10px] uppercase tracking-wider text-zinc-400">zenquotes.io · live</span>
        </div>
        <div className="flex items-center gap-2">
          <button onClick={() => setTick((t) => t + 1)} className="inline-flex items-center gap-1 rounded border border-cyan-500/30 bg-cyan-500/10 px-2 py-1 text-[10px] text-cyan-200 hover:bg-cyan-500/20"><RefreshCw className="h-3 w-3" /> new</button>
          {q && (
            <SaveAsDtuButton
              compact
              apiSource="zenquotes"
              apiUrl="https://zenquotes.io/api/random"
              title={`Quote — ${q.a}`}
              content={`"${q.q}"\n— ${q.a}`}
              extraTags={['daily', 'quote', q.a.toLowerCase().replace(/\s+/g, '-')]}
              rawData={q}
            />
          )}
        </div>
      </header>
      {quote.isError && <div className="rounded border border-red-500/20 bg-red-500/5 px-3 py-2 text-xs text-red-300">zenquotes unreachable.</div>}
      {quote.isPending && <div className="flex items-center gap-2 text-xs text-zinc-400"><Loader2 className="h-4 w-4 animate-spin" /> Pulling a fresh quote…</div>}
      {q && (
        <blockquote className="rounded-lg border border-cyan-500/20 bg-zinc-950/60 p-6">
          <p className="font-serif text-lg leading-relaxed text-white">&ldquo;{q.q}&rdquo;</p>
          <p className="mt-4 text-right font-mono text-sm text-cyan-300">— {q.a}</p>
        </blockquote>
      )}
    </div>
  );
}
