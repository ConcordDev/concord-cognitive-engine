'use client';

import { useState, useEffect } from 'react';
import { useMutation } from '@tanstack/react-query';
import { motion } from 'framer-motion';
import { Newspaper, Loader2, ExternalLink } from 'lucide-react';
import { apiHelpers } from '@/lib/api/client';
import { SaveAsDtuButton } from '@/components/dtu/SaveAsDtuButton';

interface Headline {
  id: string; category: string;
  title: string; url: string; source: string;
  sourceCountry?: string | null; language?: string;
  publishedAt: string; socialImageUrl?: string | null;
}

interface MacroEnvelope<T> { ok: boolean; result?: T; error?: string }

async function callMacro<T>(action: string, input: Record<string, unknown>): Promise<MacroEnvelope<T>> {
  const r = await apiHelpers.lens.runDomain('news', action, { input });
  const data = (r as { data?: { ok: boolean; result?: T } }).data;
  if (!data) return { ok: false, error: 'empty response' };
  if (data.ok && data.result && typeof data.result === 'object' && 'ok' in data.result) {
    return data.result as MacroEnvelope<T>;
  }
  return data as MacroEnvelope<T>;
}

const CATEGORIES = ['top', 'world', 'business', 'tech', 'science', 'politics', 'sports', 'health', 'entertainment'];

export function GdeltHeadlines() {
  const [category, setCategory] = useState('top');
  const [items, setItems] = useState<Headline[]>([]);

  const load = useMutation({
    mutationFn: async () => callMacro<{ headlines: Headline[] }>('headlines', { category, limit: 30 }),
    onSuccess: (env) => { if (env.ok && env.result) setItems(env.result.headlines); else setItems([]); },
  });

  useEffect(() => {
    load.mutate();
    // eslint-disable-next-line react-hooks/exhaustive-deps -- mutate stable
  }, [category]);

  return (
    <div className="space-y-4">
      <header className="flex items-center justify-between gap-3 border-b border-cyan-500/15 pb-3">
        <div className="flex items-center gap-2">
          <Newspaper className="h-5 w-5 text-cyan-400" />
          <h2 className="text-sm font-semibold text-white">Global News (GDELT)</h2>
          <span className="rounded bg-zinc-800 px-1.5 py-0.5 font-mono text-[10px] uppercase tracking-wider text-zinc-400">gdelt · realtime</span>
        </div>
      </header>
      <div className="flex flex-wrap gap-1">
        {CATEGORIES.map((c) => (
          <button key={c} type="button" onClick={() => setCategory(c)} className={`rounded-full border px-2.5 py-0.5 text-[10px] uppercase ${category === c ? 'border-cyan-500/50 bg-cyan-500/15 text-cyan-200' : 'border-zinc-800 bg-zinc-900/60 text-zinc-400'}`}>{c}</button>
        ))}
        {load.isPending && <Loader2 className="h-3.5 w-3.5 animate-spin text-cyan-400" />}
      </div>
      <div className="space-y-1.5 max-h-[32rem] overflow-y-auto">
        {items.map((h) => (
          <motion.div key={h.id} layout initial={{ opacity: 0, y: 4 }} animate={{ opacity: 1, y: 0 }} className="flex items-start gap-3 rounded border border-zinc-800 bg-zinc-950 p-2.5">
            {h.socialImageUrl && (
              // eslint-disable-next-line @next/next/no-img-element
              <img src={h.socialImageUrl} alt="" loading="lazy" className="h-12 w-16 shrink-0 rounded object-cover" />
            )}
            <div className="min-w-0 flex-1">
              <a href={h.url} target="_blank" rel="noopener noreferrer" className="line-clamp-2 text-sm text-white hover:text-cyan-300">{h.title}</a>
              <div className="mt-0.5 flex flex-wrap gap-x-2 text-[10px] text-zinc-400">
                <span className="font-medium text-zinc-400">{h.source}</span>
                {h.sourceCountry && <span>{h.sourceCountry}</span>}
                <span>{new Date(h.publishedAt).toLocaleString()}</span>
              </div>
            </div>
            <div className="flex shrink-0 items-center gap-1">
              <SaveAsDtuButton
                compact
                apiSource="gdelt"
                apiUrl={h.url}
                title={h.title.slice(0, 100)}
                content={`Title: ${h.title}\nSource: ${h.source} (${h.sourceCountry || '—'})\nPublished: ${h.publishedAt}\nURL: ${h.url}\nCategory: ${h.category}`}
                extraTags={['news', 'gdelt', h.category, h.sourceCountry?.toLowerCase() || 'us']}
                rawData={h}
              />
              <a href={h.url} target="_blank" rel="noopener noreferrer" className="flex h-6 w-6 items-center justify-center rounded text-zinc-400 hover:bg-zinc-800 hover:text-zinc-200" aria-label="open"><ExternalLink className="h-3 w-3" /></a>
            </div>
          </motion.div>
        ))}
      </div>
    </div>
  );
}
