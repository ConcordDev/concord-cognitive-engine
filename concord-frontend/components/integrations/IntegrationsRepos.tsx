'use client';

import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { Plug, Loader2, ExternalLink, Star, GitBranch } from 'lucide-react';
import { SaveAsDtuButton } from '@/components/dtu/SaveAsDtuButton';

interface Repo { id: number; full_name: string; html_url: string; description?: string; stargazers_count: number; forks_count: number; language?: string; license?: { spdx_id?: string }; }

const TOPICS = [
  { id: 'api', label: 'api' },
  { id: 'webhook', label: 'webhook' },
  { id: 'oauth', label: 'oauth' },
  { id: 'sdk', label: 'sdk' },
  { id: 'mcp', label: 'mcp' },
  { id: 'zapier', label: 'zapier' },
];

export function IntegrationsRepos() {
  const [topic, setTopic] = useState(TOPICS[0].id);

  const repos = useQuery({
    queryKey: ['gh-integrations', topic],
    queryFn: async () => {
      const r = await fetch(`https://api.github.com/search/repositories?q=topic:${topic}&sort=stars&order=desc&per_page=25`);
      if (!r.ok) throw new Error(`gh ${r.status}`);
      const j = await r.json();
      return (j.items || []) as Repo[];
    },
    staleTime: 30 * 60 * 1000,
  });

  const list = repos.data || [];
  const totalStars = list.reduce((a, r) => a + (r.stargazers_count || 0), 0);

  return (
    <div className="space-y-4">
      <header className="flex flex-wrap items-center justify-between gap-3 border-b border-cyan-500/15 pb-3">
        <div className="flex items-center gap-2"><Plug className="h-5 w-5 text-cyan-400" /><h2 className="text-sm font-semibold text-white">Real-world integration tooling</h2><span className="rounded bg-zinc-800 px-1.5 py-0.5 font-mono text-[10px] uppercase tracking-wider text-zinc-400">github · topic:{topic}</span></div>
        <div className="flex items-center gap-2">
          <select value={topic} onChange={(e) => setTopic(e.target.value)} className="rounded border border-zinc-800 bg-zinc-950 px-2 py-1 text-xs text-white">{TOPICS.map((t) => <option key={t.id} value={t.id}>{t.label}</option>)}</select>
          {list.length > 0 && <SaveAsDtuButton compact apiSource="github-integrations" apiUrl={`https://api.github.com/search/repositories?q=topic:${topic}&sort=stars`} title={`GitHub integrations — topic:${topic} (${list.length})`} content={list.slice(0, 20).map((r, i) => `${i + 1}. ★${r.stargazers_count.toLocaleString()} · ${r.full_name}\n   ${r.description || ''}\n   ${r.html_url}`).join('\n\n')} extraTags={['integrations', 'github', topic]} rawData={{ topic, repos: list }} />}
        </div>
      </header>
      {repos.isError && <div className="rounded border border-red-500/20 bg-red-500/5 px-3 py-2 text-xs text-red-300">GitHub unreachable.</div>}
      <div className="grid grid-cols-2 gap-2">
        <div className="rounded border border-zinc-800 bg-zinc-950 px-2.5 py-1.5"><div className="text-[10px] uppercase tracking-wider text-zinc-400">Repos</div><div className="mt-0.5 font-mono text-lg text-cyan-300">{list.length}</div></div>
        <div className="rounded border border-zinc-800 bg-zinc-950 px-2.5 py-1.5"><div className="text-[10px] uppercase tracking-wider text-zinc-400">Total stars</div><div className="mt-0.5 font-mono text-lg text-cyan-300">{totalStars.toLocaleString()}</div></div>
      </div>
      <div className="space-y-1.5 max-h-[500px] overflow-y-auto">
        {list.map((r) => (
          <a key={r.id} href={r.html_url} target="_blank" rel="noopener noreferrer" className="block rounded-lg border border-cyan-500/20 bg-cyan-500/5 p-2.5 hover:border-cyan-500/40">
            <p className="text-[12px] font-mono text-zinc-100">{r.full_name}</p>
            {r.description && <p className="mt-0.5 line-clamp-2 text-[11px] text-zinc-300">{r.description}</p>}
            <div className="mt-1 flex flex-wrap items-center gap-x-3 text-[10px] text-zinc-400">
              <span className="flex items-center gap-0.5"><Star className="h-3 w-3" />{r.stargazers_count.toLocaleString()}</span>
              <span className="flex items-center gap-0.5"><GitBranch className="h-3 w-3" />{r.forks_count.toLocaleString()}</span>
              {r.language && <span className="rounded bg-zinc-800 px-1 font-mono text-[9px] text-zinc-300">{r.language}</span>}
              <ExternalLink className="h-3 w-3 text-zinc-400" />
            </div>
          </a>
        ))}
        {list.length === 0 && !repos.isPending && !repos.isError && <div className="rounded border border-dashed border-zinc-800 p-4 text-center text-[11px] text-zinc-400">No repos.</div>}
      </div>
      {repos.isPending && <div className="flex items-center gap-2 text-xs text-zinc-400"><Loader2 className="h-4 w-4 animate-spin" /> Pulling…</div>}
    </div>
  );
}
