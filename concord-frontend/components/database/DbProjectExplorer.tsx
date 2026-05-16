'use client';

import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { Database, Loader2, Star, GitFork, ExternalLink } from 'lucide-react';
import { SaveAsDtuButton } from '@/components/dtu/SaveAsDtuButton';

interface Repo { id: number; full_name: string; description?: string; html_url: string; stargazers_count: number; forks_count: number; language?: string; topics?: string[]; pushed_at: string }

const TOPICS = ['database', 'postgresql', 'mysql', 'sqlite', 'mongodb', 'redis', 'vector-database', 'graph-database', 'time-series', 'nosql', 'orm', 'data-warehouse'];

export function DbProjectExplorer() {
  const [topic, setTopic] = useState('database');

  const repos = useQuery({
    queryKey: ['db-repos', topic],
    queryFn: async () => {
      const r = await fetch(`https://api.github.com/search/repositories?q=topic:${encodeURIComponent(topic)}&sort=stars&order=desc&per_page=20`, { headers: { Accept: 'application/vnd.github+json' } });
      if (!r.ok) throw new Error(`github ${r.status}`);
      const j = await r.json();
      return (j.items || []) as Repo[];
    },
    staleTime: 5 * 60 * 1000,
  });

  return (
    <div className="space-y-4">
      <header className="flex flex-wrap items-center justify-between gap-3 border-b border-cyan-500/15 pb-3">
        <div className="flex items-center gap-2">
          <Database className="h-5 w-5 text-cyan-400" />
          <h2 className="text-sm font-semibold text-white">Top database projects</h2>
          <span className="rounded bg-zinc-800 px-1.5 py-0.5 font-mono text-[10px] uppercase tracking-wider text-zinc-400">api.github.com topic:{topic} · sorted by stars</span>
        </div>
        {(repos.data?.length ?? 0) > 0 && (
          <SaveAsDtuButton
            compact
            apiSource="github"
            apiUrl={`https://api.github.com/search/repositories?q=topic:${topic}`}
            title={`Top GitHub repos · topic:${topic}`}
            content={(repos.data || []).map((r, i) => `#${i + 1} ${r.full_name} · ⭐${r.stargazers_count.toLocaleString()} · ${r.language || '?'}\n   ${r.description || ''}`).join('\n')}
            extraTags={['database', 'github', topic]}
            rawData={{ topic, repos: repos.data }}
          />
        )}
      </header>
      <div className="flex flex-wrap gap-1 text-[10px]">
        {TOPICS.map((t) => (
          <button key={t} onClick={() => setTopic(t)} className={`rounded px-1.5 py-0.5 font-mono uppercase ${topic === t ? 'bg-cyan-500/20 text-cyan-200' : 'bg-zinc-800 text-zinc-400 hover:bg-zinc-700'}`}>{t}</button>
        ))}
      </div>
      {repos.isError && <div className="rounded border border-red-500/20 bg-red-500/5 px-3 py-2 text-xs text-red-300">GitHub rate-limited / unreachable.</div>}
      {repos.isPending && <div className="flex items-center gap-2 text-xs text-zinc-500"><Loader2 className="h-4 w-4 animate-spin" /> Loading…</div>}
      <div className="space-y-1 max-h-[480px] overflow-y-auto">
        {(repos.data || []).map((r, i) => (
          <a key={r.id} href={r.html_url} target="_blank" rel="noopener noreferrer" className="block rounded border border-zinc-800 bg-zinc-950 p-2.5 hover:border-cyan-500/30">
            <div className="flex items-start justify-between gap-2">
              <div className="flex-1 min-w-0">
                <div className="flex items-center gap-2">
                  <span className="font-mono text-[10px] text-zinc-500">#{i + 1}</span>
                  <span className="font-mono text-sm text-cyan-300">{r.full_name}</span>
                  {r.language && <span className="rounded bg-zinc-800 px-1 font-mono text-[10px] text-zinc-300">{r.language}</span>}
                </div>
                {r.description && <p className="mt-0.5 line-clamp-2 text-[11px] text-zinc-400">{r.description}</p>}
              </div>
              <div className="flex flex-col items-end gap-0.5 text-[10px] font-mono text-zinc-400">
                <span className="flex items-center gap-0.5"><Star className="h-3 w-3" />{r.stargazers_count.toLocaleString()}</span>
                <span className="flex items-center gap-0.5"><GitFork className="h-3 w-3" />{r.forks_count.toLocaleString()}</span>
                <ExternalLink className="h-3 w-3 text-zinc-500" />
              </div>
            </div>
          </a>
        ))}
      </div>
    </div>
  );
}
