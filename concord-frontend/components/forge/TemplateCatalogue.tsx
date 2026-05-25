'use client';

import { useQuery } from '@tanstack/react-query';
import { Hammer, Loader2, Layers } from 'lucide-react';
import { api } from '@/lib/api/client';
import { SaveAsDtuButton } from '@/components/dtu/SaveAsDtuButton';

interface Template { id?: string; name?: string; description?: string; language?: string; category?: string; sections?: number; }

export function TemplateCatalogue() {
  const templates = useQuery({
    queryKey: ['forge-list'],
    queryFn: async () => {
      const r = await api.post('/api/lens/run', { domain: 'forge', name: 'list' });
      const data = r.data as { ok: boolean; result?: Template[] | { templates?: Template[] }; templates?: Template[] };
      const arr = Array.isArray(data.result) ? data.result : (data.result as { templates?: Template[] })?.templates || data.templates || [];
      return arr as Template[];
    },
    refetchInterval: 5 * 60 * 1000,
  });

  const list = templates.data || [];
  const langs = Array.from(new Set(list.map((t) => t.language).filter(Boolean))).length;
  const cats = Array.from(new Set(list.map((t) => t.category).filter(Boolean))).length;

  return (
    <div className="space-y-4">
      <header className="flex flex-wrap items-center justify-between gap-3 border-b border-cyan-500/15 pb-3">
        <div className="flex items-center gap-2">
          <Hammer className="h-5 w-5 text-orange-400" />
          <h2 className="text-sm font-semibold text-white">Forge template catalogue</h2>
          <span className="rounded bg-zinc-800 px-1.5 py-0.5 font-mono text-[10px] uppercase tracking-wider text-zinc-400">forge.list · live</span>
        </div>
        {list.length > 0 && (
          <SaveAsDtuButton
            compact
            apiSource="concord-forge"
            title={`Forge templates — ${list.length} available`}
            content={list.slice(0, 30).map((t, i) => `${i + 1}. ${t.name || t.id}${t.language ? ` · ${t.language}` : ''}${t.category ? ` · ${t.category}` : ''}\n   ${t.description || ''}`).join('\n\n')}
            extraTags={['forge', 'templates', 'concord']}
            rawData={{ templates: list }}
          />
        )}
      </header>
      {templates.isError && <div className="rounded border border-red-500/20 bg-red-500/5 px-3 py-2 text-xs text-red-300">forge.list macro unreachable.</div>}
      <div className="grid grid-cols-3 gap-2">
        <div className="rounded border border-zinc-800 bg-zinc-950 px-2.5 py-1.5"><div className="text-[10px] uppercase tracking-wider text-zinc-400">Templates</div><div className="mt-0.5 font-mono text-lg text-orange-300">{list.length}</div></div>
        <div className="rounded border border-zinc-800 bg-zinc-950 px-2.5 py-1.5"><div className="text-[10px] uppercase tracking-wider text-zinc-400">Languages</div><div className="mt-0.5 font-mono text-lg text-orange-300">{langs}</div></div>
        <div className="rounded border border-zinc-800 bg-zinc-950 px-2.5 py-1.5"><div className="text-[10px] uppercase tracking-wider text-zinc-400">Categories</div><div className="mt-0.5 font-mono text-lg text-orange-300">{cats}</div></div>
      </div>
      <div className="space-y-1 max-h-[500px] overflow-y-auto">
        {list.map((t) => (
          <div key={t.id || t.name} className="rounded border border-orange-500/15 bg-orange-500/5 p-2 text-[11px]">
            <div className="flex items-center justify-between gap-2">
              <span className="flex items-center gap-1 font-mono text-zinc-100">
                <Layers className="h-3 w-3 text-orange-400" />
                {t.name || t.id}
              </span>
              {t.sections != null && <span className="rounded bg-zinc-800 px-1 font-mono text-[9px] text-zinc-300">{t.sections} sections</span>}
            </div>
            {t.description && <p className="mt-0.5 line-clamp-2 text-[10px] text-zinc-400">{t.description}</p>}
            <div className="mt-0.5 flex flex-wrap items-center gap-2 text-[9px] text-zinc-400">
              {t.language && <span className="rounded bg-zinc-800 px-1 font-mono">{t.language}</span>}
              {t.category && <span className="rounded bg-orange-500/20 px-1 font-mono text-orange-200">{t.category}</span>}
            </div>
          </div>
        ))}
        {list.length === 0 && !templates.isPending && !templates.isError && <div className="rounded border border-dashed border-zinc-800 p-4 text-center text-[11px] text-zinc-400">No templates returned.</div>}
      </div>
      {templates.isPending && <div className="flex items-center gap-2 text-xs text-zinc-400"><Loader2 className="h-4 w-4 animate-spin" /> Pulling forge…</div>}
    </div>
  );
}
