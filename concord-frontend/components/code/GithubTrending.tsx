'use client';

import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { Github, Loader2, Star, GitFork, Eye, ExternalLink } from 'lucide-react';
import { SaveAsDtuButton } from '@/components/dtu/SaveAsDtuButton';

interface Repo {
  id: number;
  full_name: string;
  description?: string;
  html_url: string;
  stargazers_count: number;
  forks_count: number;
  watchers_count: number;
  language?: string;
  topics?: string[];
  pushed_at: string;
  owner: { login: string; avatar_url: string };
}

const LANGUAGES = ['any', 'TypeScript', 'JavaScript', 'Python', 'Rust', 'Go', 'C++', 'Java', 'Swift', 'Ruby'];
const WINDOWS = [
  { id: 'day', label: 'today', days: 1 },
  { id: 'week', label: '7d', days: 7 },
  { id: 'month', label: '30d', days: 30 },
] as const;

export function GithubTrending() {
  const [language, setLanguage] = useState('any');
  const [window, setWindow] = useState<typeof WINDOWS[number]['id']>('week');

  const trending = useQuery({
    queryKey: ['github-trending', language, window],
    queryFn: async () => {
      const days = WINDOWS.find((w) => w.id === window)?.days ?? 7;
      const date = new Date(Date.now() - days * 86_400_000).toISOString().slice(0, 10);
      const q = `created:>${date}${language !== 'any' ? ` language:${language}` : ''}`;
      const r = await fetch(`https://api.github.com/search/repositories?q=${encodeURIComponent(q)}&sort=stars&order=desc&per_page=20`, { headers: { Accept: 'application/vnd.github+json' } });
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
          <Github className="h-5 w-5 text-cyan-400" />
          <h2 className="text-sm font-semibold text-white">Trending repositories</h2>
          <span className="rounded bg-zinc-800 px-1.5 py-0.5 font-mono text-[10px] uppercase tracking-wider text-zinc-400">api.github.com/search · live</span>
        </div>
        {(trending.data?.length ?? 0) > 0 && (
          <SaveAsDtuButton
            compact
            apiSource="github-trending"
            apiUrl="https://api.github.com/search/repositories"
            title={`GitHub trending — ${language} · ${window} (${trending.data?.length})`}
            content={(trending.data || []).map((r, i) => `${i + 1}. ${r.full_name} · ⭐${r.stargazers_count.toLocaleString()} · ${r.language || '?'}\n   ${r.description || ''}\n   ${r.html_url}`).join('\n\n')}
            extraTags={['code', 'github', 'trending', language.toLowerCase(), window]}
            rawData={{ language, window, repos: trending.data }}
          />
        )}
      </header>
      <div className="flex flex-wrap items-center gap-2">
        <select value={language} onChange={(e) => setLanguage(e.target.value)} className="rounded border border-zinc-800 bg-zinc-950 px-2 py-1.5 text-xs text-white">
          {LANGUAGES.map((l) => <option key={l} value={l}>{l}</option>)}
        </select>
        <div className="flex rounded-md border border-zinc-800 bg-zinc-950 p-0.5 text-[10px]">
          {WINDOWS.map((w) => (
            <button key={w.id} onClick={() => setWindow(w.id)} className={`rounded px-2 py-0.5 font-mono uppercase ${window === w.id ? 'bg-cyan-500/20 text-cyan-200' : 'text-zinc-400 hover:text-zinc-300'}`}>{w.label}</button>
          ))}
        </div>
      </div>
      {trending.isError && <div className="rounded border border-red-500/20 bg-red-500/5 px-3 py-2 text-xs text-red-300">GitHub unreachable / rate-limited.</div>}
      {trending.isPending && <div className="flex items-center gap-2 text-xs text-zinc-400"><Loader2 className="h-4 w-4 animate-spin" /> Searching trending repos…</div>}
      <div className="space-y-1 max-h-[500px] overflow-y-auto">
        {(trending.data || []).map((r) => (
          <a key={r.id} href={r.html_url} target="_blank" rel="noopener noreferrer" className="block rounded border border-zinc-800 bg-zinc-950 p-2.5 hover:border-cyan-500/30">
            <div className="flex items-start justify-between gap-2">
              <div className="flex-1 min-w-0">
                <div className="flex items-center gap-2">
                  <span className="font-mono text-sm text-cyan-300">{r.full_name}</span>
                  {r.language && <span className="rounded bg-zinc-800 px-1 font-mono text-[10px] text-zinc-300">{r.language}</span>}
                </div>
                {r.description && <p className="mt-0.5 line-clamp-2 text-[11px] text-zinc-400">{r.description}</p>}
                {r.topics && r.topics.length > 0 && (
                  <div className="mt-1 flex flex-wrap gap-1">
                    {r.topics.slice(0, 6).map((t) => <span key={t} className="rounded bg-zinc-800 px-1 font-mono text-[9px] text-cyan-300/80">{t}</span>)}
                  </div>
                )}
              </div>
              <div className="flex flex-col items-end gap-0.5 text-[10px] font-mono text-zinc-400">
                <span className="flex items-center gap-0.5"><Star className="h-3 w-3" />{r.stargazers_count.toLocaleString()}</span>
                <span className="flex items-center gap-0.5"><GitFork className="h-3 w-3" />{r.forks_count.toLocaleString()}</span>
                <span className="flex items-center gap-0.5"><Eye className="h-3 w-3" />{r.watchers_count.toLocaleString()}</span>
                <ExternalLink className="h-3 w-3 text-zinc-400" />
              </div>
            </div>
          </a>
        ))}
      </div>
    </div>
  );
}
