'use client';

import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { Key, Loader2, Search, Cpu } from 'lucide-react';
import { SaveAsDtuButton } from '@/components/dtu/SaveAsDtuButton';

interface OrModel {
  id: string;
  name?: string;
  description?: string;
  pricing?: { prompt: string; completion: string };
  context_length?: number;
  architecture?: { modality?: string; tokenizer?: string };
  per_request_limits?: Record<string, unknown> | null;
  top_provider?: { is_moderated?: boolean; max_completion_tokens?: number };
}

export function OpenRouterCatalog() {
  const [query, setQuery] = useState('');

  const models = useQuery({
    queryKey: ['openrouter-models'],
    queryFn: async () => {
      const r = await fetch('https://openrouter.ai/api/v1/models');
      if (!r.ok) throw new Error(`openrouter ${r.status}`);
      const j = await r.json();
      return (j.data || []) as OrModel[];
    },
    staleTime: 60 * 60 * 1000,
  });

  const filtered = (models.data || []).filter((m) => !query.trim() || m.id.toLowerCase().includes(query.toLowerCase()) || (m.name || '').toLowerCase().includes(query.toLowerCase())).slice(0, 100);

  const fmtPrice = (p?: string) => {
    if (!p) return '—';
    const n = parseFloat(p);
    if (n === 0) return 'free';
    return `$${(n * 1000000).toFixed(2)}/M`;
  };

  return (
    <div className="space-y-4">
      <header className="flex items-center justify-between gap-3 border-b border-cyan-500/15 pb-3">
        <div className="flex items-center gap-2">
          <Key className="h-5 w-5 text-cyan-400" />
          <h2 className="text-sm font-semibold text-white">Provider catalog</h2>
          <span className="rounded bg-zinc-800 px-1.5 py-0.5 font-mono text-[10px] uppercase tracking-wider text-zinc-400">openrouter.ai/api/v1/models · {models.data?.length ?? '—'} models</span>
        </div>
        {filtered.length > 0 && (
          <SaveAsDtuButton
            compact
            apiSource="openrouter"
            apiUrl="https://openrouter.ai/api/v1/models"
            title={`OpenRouter model catalog — ${filtered.length}${query ? ` matching "${query}"` : ''}`}
            content={filtered.slice(0, 50).map((m) => `${m.id} · ctx=${m.context_length || '?'} · in=${fmtPrice(m.pricing?.prompt)} · out=${fmtPrice(m.pricing?.completion)}${m.name ? ` · ${m.name}` : ''}`).join('\n')}
            extraTags={['byo-keys', 'llm-catalog', 'openrouter']}
            rawData={{ query, count: filtered.length, models: filtered.slice(0, 80) }}
          />
        )}
      </header>
      <form onSubmit={(e) => e.preventDefault()} className="flex items-center gap-2">
        <div className="relative flex-1">
          <Search className="pointer-events-none absolute left-2.5 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-zinc-400" />
          <input type="text" value={query} onChange={(e) => setQuery(e.target.value)} placeholder="Filter (e.g. opus, claude, gpt-4, qwen, llama)…" className="w-full rounded-md border border-zinc-800 bg-zinc-950 py-1.5 pl-8 pr-3 text-sm text-white" />
        </div>
        <span className="font-mono text-[10px] text-zinc-400">{filtered.length} / {models.data?.length ?? '—'}</span>
      </form>
      {models.isError && <div className="rounded border border-red-500/20 bg-red-500/5 px-3 py-2 text-xs text-red-300">OpenRouter unreachable.</div>}
      {models.isPending && <div className="flex items-center gap-2 text-xs text-zinc-400"><Loader2 className="h-4 w-4 animate-spin" /> Pulling provider catalog…</div>}
      <div className="space-y-1 max-h-[500px] overflow-y-auto">
        {filtered.map((m) => (
          <div key={m.id} className="rounded border border-zinc-800 bg-zinc-950 p-2">
            <div className="flex items-baseline justify-between gap-2">
              <span className="font-mono text-sm text-cyan-300 line-clamp-1">{m.id}</span>
              <div className="flex items-center gap-2 font-mono text-[10px] text-zinc-400">
                <span>ctx {m.context_length?.toLocaleString() || '?'}</span>
                <span className="text-emerald-300">in {fmtPrice(m.pricing?.prompt)}</span>
                <span className="text-amber-300">out {fmtPrice(m.pricing?.completion)}</span>
              </div>
            </div>
            {m.name && m.name !== m.id && <div className="text-[10px] text-zinc-400">{m.name}</div>}
            {m.description && <p className="line-clamp-2 text-[11px] text-zinc-400">{m.description}</p>}
            <div className="mt-0.5 flex flex-wrap gap-1 text-[9px]">
              {m.architecture?.modality && <span className="rounded bg-zinc-800 px-1 font-mono text-zinc-300"><Cpu className="mr-0.5 inline h-2.5 w-2.5" />{m.architecture.modality}</span>}
              {m.architecture?.tokenizer && <span className="rounded bg-zinc-800 px-1 font-mono text-zinc-300">{m.architecture.tokenizer}</span>}
              {m.top_provider?.is_moderated && <span className="rounded bg-amber-500/10 px-1 font-mono text-amber-300">moderated</span>}
            </div>
          </div>
        ))}
        {filtered.length === 0 && !models.isPending && (
          <div className="rounded border border-dashed border-zinc-800 p-6 text-center text-[11px] text-zinc-400">No matching models.</div>
        )}
      </div>
    </div>
  );
}
