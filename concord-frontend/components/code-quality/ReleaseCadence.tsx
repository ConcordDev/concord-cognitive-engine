'use client';

import { useState } from 'react';
import { useMutation } from '@tanstack/react-query';
import { GitBranch, Loader2, Calendar, ExternalLink, Tag } from 'lucide-react';
import { SaveAsDtuButton } from '@/components/dtu/SaveAsDtuButton';

interface Release {
  id: number;
  tag_name: string;
  name?: string;
  body?: string;
  draft: boolean;
  prerelease: boolean;
  published_at: string;
  html_url: string;
  author?: { login: string };
}

export function ReleaseCadence() {
  const [owner, setOwner] = useState('facebook');
  const [repo, setRepo] = useState('react');
  const [releases, setReleases] = useState<Release[]>([]);
  const [error, setError] = useState<string | null>(null);

  const load = useMutation({
    mutationFn: async () => {
      setError(null);
      try {
        const r = await fetch(`https://api.github.com/repos/${encodeURIComponent(owner)}/${encodeURIComponent(repo)}/releases?per_page=30`, { headers: { Accept: 'application/vnd.github+json' } });
        if (!r.ok) throw new Error(`github ${r.status}`);
        const j = await r.json();
        setReleases(j as Release[]);
      } catch (e) { setReleases([]); setError(e instanceof Error ? e.message : 'request failed'); }
    },
  });

  // Compute cadence
  const releaseGaps = releases.slice(0, -1).map((r, i) => {
    const next = releases[i + 1];
    return (new Date(r.published_at).getTime() - new Date(next.published_at).getTime()) / 86_400_000;
  });
  const avgGapDays = releaseGaps.length > 0 ? releaseGaps.reduce((s, v) => s + v, 0) / releaseGaps.length : null;
  const lastRelease = releases[0];
  const daysSinceLast = lastRelease ? Math.floor((Date.now() - new Date(lastRelease.published_at).getTime()) / 86_400_000) : null;

  return (
    <div className="space-y-4">
      <header className="flex items-center justify-between gap-3 border-b border-cyan-500/15 pb-3">
        <div className="flex items-center gap-2">
          <GitBranch className="h-5 w-5 text-cyan-400" />
          <h2 className="text-sm font-semibold text-white">Release cadence (real-data quality signal)</h2>
          <span className="rounded bg-zinc-800 px-1.5 py-0.5 font-mono text-[10px] uppercase tracking-wider text-zinc-400">api.github.com/repos/{`{owner}/{repo}`}/releases</span>
        </div>
        {releases.length > 0 && (
          <SaveAsDtuButton
            compact
            apiSource="github-releases"
            apiUrl={`https://api.github.com/repos/${owner}/${repo}/releases`}
            title={`${owner}/${repo} release cadence — ${releases.length} releases`}
            content={`avg gap ${avgGapDays?.toFixed(1) ?? '—'} days · days since last ${daysSinceLast ?? '—'}\n\n${releases.slice(0, 25).map((r) => `${r.tag_name} (${new Date(r.published_at).toISOString().slice(0, 10)})${r.prerelease ? ' [pre]' : ''}${r.draft ? ' [draft]' : ''}`).join('\n')}`}
            extraTags={['code-quality', 'github', 'releases', owner.toLowerCase(), repo.toLowerCase()]}
            rawData={{ owner, repo, releases }}
          />
        )}
      </header>
      <form onSubmit={(e) => { e.preventDefault(); load.mutate(); }} className="flex items-center gap-2">
        <input type="text" value={owner} onChange={(e) => setOwner(e.target.value)} placeholder="owner" className="w-32 rounded border border-zinc-800 bg-zinc-950 px-2 py-1.5 font-mono text-xs text-white" />
        <span className="text-zinc-400">/</span>
        <input type="text" value={repo} onChange={(e) => setRepo(e.target.value)} placeholder="repo" className="w-40 rounded border border-zinc-800 bg-zinc-950 px-2 py-1.5 font-mono text-xs text-white" />
        <button type="submit" disabled={!owner || !repo || load.isPending} className="inline-flex items-center gap-1.5 rounded-md border border-cyan-500/30 bg-cyan-500/10 px-3 py-1.5 text-xs text-cyan-200 hover:bg-cyan-500/20 disabled:opacity-50">
          {load.isPending ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Calendar className="h-3.5 w-3.5" />}
          Load
        </button>
      </form>
      {error && <div className="rounded border border-red-500/20 bg-red-500/5 px-3 py-2 text-xs text-red-300">{error}</div>}
      {avgGapDays != null && (
        <div className="grid grid-cols-3 gap-2">
          <div className="rounded border border-zinc-800 bg-zinc-950 px-2.5 py-1.5">
            <div className="text-[10px] uppercase tracking-wider text-zinc-400">Releases</div>
            <div className="mt-0.5 font-mono text-lg text-cyan-300">{releases.length}</div>
          </div>
          <div className="rounded border border-zinc-800 bg-zinc-950 px-2.5 py-1.5">
            <div className="text-[10px] uppercase tracking-wider text-zinc-400">Avg gap</div>
            <div className="mt-0.5 font-mono text-lg text-cyan-300">{avgGapDays.toFixed(1)}d</div>
          </div>
          <div className="rounded border border-zinc-800 bg-zinc-950 px-2.5 py-1.5">
            <div className="text-[10px] uppercase tracking-wider text-zinc-400">Days since last</div>
            <div className={`mt-0.5 font-mono text-lg ${(daysSinceLast ?? 0) > (avgGapDays * 2) ? 'text-amber-300' : 'text-cyan-300'}`}>{daysSinceLast}d</div>
          </div>
        </div>
      )}
      <div className="space-y-1 max-h-[480px] overflow-y-auto">
        {releases.map((r) => (
          <a key={r.id} href={r.html_url} target="_blank" rel="noopener noreferrer" className="block rounded border border-zinc-800 bg-zinc-950 p-2 hover:border-cyan-500/30">
            <div className="flex items-start justify-between gap-2">
              <div className="flex-1 min-w-0">
                <div className="flex items-center gap-2">
                  <Tag className="h-3 w-3 text-cyan-400" />
                  <span className="font-mono text-sm text-white">{r.tag_name}</span>
                  {r.prerelease && <span className="rounded bg-amber-500/20 px-1 font-mono text-[9px] text-amber-300">pre</span>}
                  {r.draft && <span className="rounded bg-zinc-700 px-1 font-mono text-[9px] text-zinc-300">draft</span>}
                  {r.name && r.name !== r.tag_name && <span className="text-[11px] text-zinc-400">— {r.name}</span>}
                </div>
                <div className="mt-0.5 text-[10px] text-zinc-400">
                  {new Date(r.published_at).toLocaleDateString()} by {r.author?.login || '?'}
                </div>
              </div>
              <ExternalLink className="h-3 w-3 shrink-0 text-zinc-400" />
            </div>
          </a>
        ))}
        {releases.length === 0 && !load.isPending && !error && (
          <div className="rounded border border-dashed border-zinc-800 p-6 text-center text-[11px] text-zinc-400">Load a repo to see real release cadence.</div>
        )}
      </div>
    </div>
  );
}
