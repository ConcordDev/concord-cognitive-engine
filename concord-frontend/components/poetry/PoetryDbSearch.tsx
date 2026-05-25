'use client';

import { useState } from 'react';
import { useMutation } from '@tanstack/react-query';
import { motion } from 'framer-motion';
import { Feather, Loader2 } from 'lucide-react';
import { apiHelpers } from '@/lib/api/client';
import { SaveAsDtuButton } from '@/components/dtu/SaveAsDtuButton';

interface Poem { title: string; author: string; lines: string[]; lineCount: number }

interface MacroEnvelope<T> { ok: boolean; result?: T; error?: string }

async function callMacro<T>(action: string, input: Record<string, unknown>): Promise<MacroEnvelope<T>> {
  const r = await apiHelpers.lens.runDomain('poetry', action, { input });
  const data = (r as { data?: { ok: boolean; result?: T } }).data;
  if (!data) return { ok: false, error: 'empty response' };
  if (data.ok && data.result && typeof data.result === 'object' && 'ok' in data.result) {
    return data.result as MacroEnvelope<T>;
  }
  return data as MacroEnvelope<T>;
}

export function PoetryDbSearch() {
  const [author, setAuthor] = useState('');
  const [title, setTitle] = useState('');
  const [poems, setPoems] = useState<Poem[]>([]);
  const search = useMutation({
    mutationFn: async () => callMacro<{ poems: Poem[] }>('poetrydb-search', { author: author.trim() || undefined, title: title.trim() || undefined }),
    onSuccess: (env) => { if (env.ok && env.result) setPoems(env.result.poems); else setPoems([]); },
  });
  return (
    <div className="space-y-4">
      <header className="flex items-center justify-between gap-3 border-b border-cyan-500/15 pb-3">
        <div className="flex items-center gap-2">
          <Feather className="h-5 w-5 text-cyan-400" />
          <h2 className="text-sm font-semibold text-white">PoetryDB Search</h2>
          <span className="rounded bg-zinc-800 px-1.5 py-0.5 font-mono text-[10px] uppercase tracking-wider text-zinc-400">classical poetry · open</span>
        </div>
      </header>
      <form onSubmit={(e) => { e.preventDefault(); if (author.trim() || title.trim()) search.mutate(); }} className="flex items-center gap-2">
        <input type="text" value={author} onChange={(e) => setAuthor(e.target.value)} placeholder="Author (e.g. Dickinson)" className="flex-1 rounded border border-zinc-800 bg-zinc-950 px-2 py-1.5 text-xs text-white" />
        <input type="text" value={title} onChange={(e) => setTitle(e.target.value)} placeholder="Title (e.g. Hope)" className="flex-1 rounded border border-zinc-800 bg-zinc-950 px-2 py-1.5 text-xs text-white" />
        <button type="submit" disabled={(!author.trim() && !title.trim()) || search.isPending} className="inline-flex items-center gap-1.5 rounded-md border border-cyan-500/30 bg-cyan-500/10 px-3 py-1.5 text-xs text-cyan-200 hover:bg-cyan-500/20 disabled:opacity-50">
          {search.isPending ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Feather className="h-3.5 w-3.5" />}
          Find
        </button>
      </form>
      <div className="space-y-2">
        {poems.map((p, i) => (
          <motion.div key={`${p.title}-${i}`} layout initial={{ opacity: 0, y: 4 }} animate={{ opacity: 1, y: 0 }} className="rounded-lg border border-cyan-500/20 bg-zinc-950/60 p-3">
            <div className="flex items-start justify-between gap-2">
              <div>
                <h3 className="font-serif text-base text-white">{p.title}</h3>
                <p className="text-[11px] italic text-cyan-300/80">— {p.author}</p>
              </div>
              <SaveAsDtuButton
                compact
                apiSource="poetrydb"
                title={`${p.title} — ${p.author}`}
                content={`${p.title}\n— ${p.author}\n\n${p.lines.join('\n')}`}
                extraTags={['poetry', 'poetrydb', p.author.toLowerCase().replace(/\s+/g, '-')]}
                rawData={p}
              />
            </div>
            <pre className="mt-2 max-h-72 overflow-y-auto whitespace-pre-wrap font-serif text-xs leading-relaxed text-zinc-200">
              {p.lines.join('\n')}
            </pre>
            <div className="mt-1 text-[10px] text-zinc-400">{p.lineCount} lines</div>
          </motion.div>
        ))}
      </div>
    </div>
  );
}
