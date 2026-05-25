'use client';

import { useState } from 'react';
import { useMutation } from '@tanstack/react-query';
import { GitFork, Loader2, Star, Eye, AlertCircle, Archive, ExternalLink, Github } from 'lucide-react';
import { apiHelpers } from '@/lib/api/client';
import { SaveAsDtuButton } from '@/components/dtu/SaveAsDtuButton';

interface RepoDetail {
  fullName: string; owner?: string; description?: string; htmlUrl?: string;
  stargazers?: number; watchers?: number; forks?: number; openIssues?: number;
  defaultBranch?: string; language?: string; topics?: string[]; license?: string;
  archived?: boolean; disabled?: boolean; isFork?: boolean; parent?: string | null;
  pushedAt?: string; createdAt?: string; updatedAt?: string; size?: number;
}
interface Fork {
  id: number; fullName: string; owner?: string; ownerType?: string; htmlUrl?: string;
  description?: string; stargazers?: number; watchers?: number; forks?: number;
  openIssues?: number; defaultBranch?: string; language?: string; license?: string;
  archived?: boolean; disabled?: boolean; pushedAt?: string; createdAt?: string;
}

interface MacroEnvelope<T> { ok: boolean; result?: T; error?: string }

async function callMacro<T>(action: string, input: Record<string, unknown>): Promise<MacroEnvelope<T>> {
  const r = await apiHelpers.lens.runDomain('fork', action, { input });
  const data = (r as { data?: { ok: boolean; result?: T } }).data;
  if (!data) return { ok: false, error: 'empty response' };
  if (data.ok && data.result && typeof data.result === 'object' && 'ok' in data.result) {
    return data.result as MacroEnvelope<T>;
  }
  return data as MacroEnvelope<T>;
}

function freshness(pushedAt?: string): { days: number; band: 'live' | 'recent' | 'stale' | 'dead' } {
  if (!pushedAt) return { days: 9999, band: 'dead' };
  const days = Math.floor((Date.now() - new Date(pushedAt).getTime()) / 86_400_000);
  if (days <= 30) return { days, band: 'live' };
  if (days <= 180) return { days, band: 'recent' };
  if (days <= 730) return { days, band: 'stale' };
  return { days, band: 'dead' };
}

const BANDS = {
  live: 'border-emerald-500/30 text-emerald-300',
  recent: 'border-cyan-500/30 text-cyan-300',
  stale: 'border-amber-500/30 text-amber-300',
  dead: 'border-zinc-700 text-zinc-400',
};

export function ForkNetworkExplorer() {
  const [owner, setOwner] = useState('vercel');
  const [repo, setRepo] = useState('next.js');
  const [sort, setSort] = useState<'newest' | 'oldest' | 'stargazers'>('stargazers');
  const [parent, setParent] = useState<RepoDetail | null>(null);
  const [forks, setForks] = useState<Fork[]>([]);
  const [error, setError] = useState<string | null>(null);

  const load = useMutation({
    mutationFn: async () => {
      setError(null);
      const [p, f] = await Promise.all([
        callMacro<RepoDetail>('github-repo', { owner, repo }),
        callMacro<{ forks: Fork[] }>('github-forks', { owner, repo, sort, limit: 30 }),
      ]);
      if (p.ok && p.result) setParent(p.result); else { setParent(null); setError(p.error || 'parent lookup failed'); }
      if (f.ok && f.result) setForks(f.result.forks);
      else setForks([]);
    },
  });

  return (
    <div className="space-y-4">
      <header className="flex items-center justify-between gap-3 border-b border-cyan-500/15 pb-3">
        <div className="flex items-center gap-2">
          <GitFork className="h-5 w-5 text-cyan-400" />
          <h2 className="text-sm font-semibold text-white">Fork network</h2>
          <span className="rounded bg-zinc-800 px-1.5 py-0.5 font-mono text-[10px] uppercase tracking-wider text-zinc-400">github api · live fork tree</span>
        </div>
      </header>
      <form onSubmit={(e) => { e.preventDefault(); load.mutate(); }} className="flex flex-wrap items-center gap-2">
        <input type="text" value={owner} onChange={(e) => setOwner(e.target.value)} placeholder="owner" className="w-32 rounded border border-zinc-800 bg-zinc-950 px-2 py-1.5 font-mono text-xs text-white" />
        <span className="text-zinc-400">/</span>
        <input type="text" value={repo} onChange={(e) => setRepo(e.target.value)} placeholder="repo" className="w-40 rounded border border-zinc-800 bg-zinc-950 px-2 py-1.5 font-mono text-xs text-white" />
        <div className="flex rounded-md border border-zinc-800 bg-zinc-950 p-0.5 text-[10px]">
          {(['stargazers', 'newest', 'oldest'] as const).map((s) => (
            <button key={s} type="button" onClick={() => setSort(s)} className={`rounded px-2 py-0.5 font-mono uppercase ${sort === s ? 'bg-cyan-500/20 text-cyan-200' : 'text-zinc-400 hover:text-zinc-300'}`}>{s}</button>
          ))}
        </div>
        <button type="submit" disabled={!owner || !repo || load.isPending} className="inline-flex items-center gap-1.5 rounded-md border border-cyan-500/30 bg-cyan-500/10 px-3 py-1.5 text-xs text-cyan-200 hover:bg-cyan-500/20 disabled:opacity-50">
          {load.isPending ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Github className="h-3.5 w-3.5" />}
          Explore
        </button>
        {(parent || forks.length > 0) && (
          <SaveAsDtuButton
            compact
            apiSource="github"
            apiUrl={`https://api.github.com/repos/${owner}/${repo}/forks`}
            title={`${owner}/${repo} fork network — ${forks.length} forks`}
            content={`Parent: ${parent?.fullName} · ⭐${parent?.stargazers} · forks ${parent?.forks}\n\nTop forks (sorted ${sort}):\n${forks.slice(0, 15).map((f, i) => `  ${i + 1}. ${f.fullName} · ⭐${f.stargazers} · pushed ${f.pushedAt}`).join('\n')}`}
            extraTags={['fork', 'github', owner.toLowerCase(), repo.toLowerCase()]}
            rawData={{ parent, forks }}
          />
        )}
      </form>

      {error && <div className="rounded border border-red-500/20 bg-red-500/5 px-3 py-2 text-xs text-red-300">{error}</div>}

      {parent && (
        <div className="rounded-lg border border-cyan-500/20 bg-zinc-950/60 p-3">
          <div className="flex items-start justify-between gap-3">
            <div className="min-w-0">
              <h3 className="text-base font-semibold text-white">{parent.fullName}</h3>
              <p className="line-clamp-1 text-[11px] text-zinc-400">{parent.description}</p>
              <div className="mt-1 flex flex-wrap items-center gap-x-3 gap-y-1 text-[11px] text-zinc-400">
                <span className="inline-flex items-center gap-1"><Star className="h-3 w-3" /> {parent.stargazers?.toLocaleString()}</span>
                <span className="inline-flex items-center gap-1"><Eye className="h-3 w-3" /> {parent.watchers?.toLocaleString()}</span>
                <span className="inline-flex items-center gap-1"><GitFork className="h-3 w-3" /> {parent.forks?.toLocaleString()}</span>
                <span className="inline-flex items-center gap-1"><AlertCircle className="h-3 w-3" /> {parent.openIssues?.toLocaleString()}</span>
                {parent.language && <span className="rounded bg-zinc-800 px-1 font-mono text-[10px] text-cyan-300">{parent.language}</span>}
                {parent.license && <span className="rounded bg-zinc-800 px-1 font-mono text-[10px] text-zinc-300">{parent.license}</span>}
                {parent.archived && <span className="inline-flex items-center gap-0.5 rounded bg-amber-500/10 px-1 text-amber-300"><Archive className="h-3 w-3" /> archived</span>}
              </div>
            </div>
            <a href={parent.htmlUrl} target="_blank" rel="noopener noreferrer" className="inline-flex items-center gap-1 rounded border border-zinc-800 px-2 py-1 text-[11px] text-cyan-300 hover:border-cyan-500/30"><ExternalLink className="h-3 w-3" /> open</a>
          </div>
        </div>
      )}

      <div className="space-y-2 max-h-[500px] overflow-y-auto">
        {forks.map((f) => {
          const fr = freshness(f.pushedAt);
          return (
            <a key={f.id} href={f.htmlUrl} target="_blank" rel="noopener noreferrer" className={`block rounded border ${BANDS[fr.band]} bg-zinc-950/40 p-2 hover:bg-zinc-950/70`}>
              <div className="flex items-start justify-between gap-2">
                <div className="min-w-0 flex-1">
                  <div className="flex items-center gap-2">
                    <span className="line-clamp-1 text-sm text-white">{f.fullName}</span>
                    {f.archived && <span className="rounded bg-amber-500/10 px-1 text-[9px] text-amber-300">archived</span>}
                  </div>
                  {f.description && <p className="line-clamp-1 text-[11px] text-zinc-400">{f.description}</p>}
                  <div className="mt-1 flex flex-wrap items-center gap-x-3 text-[10px] text-zinc-400">
                    <span className="inline-flex items-center gap-0.5"><Star className="h-3 w-3" /> {f.stargazers?.toLocaleString()}</span>
                    <span className="inline-flex items-center gap-0.5"><GitFork className="h-3 w-3" /> {f.forks?.toLocaleString()}</span>
                    {f.language && <span className="font-mono text-cyan-300/80">{f.language}</span>}
                    {f.license && <span className="font-mono">{f.license}</span>}
                  </div>
                </div>
                <span className={`shrink-0 rounded px-1.5 py-0.5 font-mono text-[10px] uppercase ${BANDS[fr.band]}`}>{fr.band} · {fr.days}d</span>
              </div>
            </a>
          );
        })}
        {forks.length === 0 && !load.isPending && !error && (
          <div className="rounded border border-dashed border-zinc-800 p-6 text-center text-xs text-zinc-400">No forks yet — load a repo to see its network.</div>
        )}
      </div>
    </div>
  );
}
