'use client';

import { useState } from 'react';
import { useMutation } from '@tanstack/react-query';
import { Github, Loader2, GitCommit, MessageCircle, Code2 } from 'lucide-react';
import { apiHelpers } from '@/lib/api/client';
import { SaveAsDtuButton } from '@/components/dtu/SaveAsDtuButton';

interface Commit { sha: string; message?: string; author?: string; date?: string; url?: string; loginAuthor?: string }
interface Issue { number: number; title: string; state: string; author?: string; labels?: string[]; comments?: number; updatedAt?: string; url?: string; isPullRequest?: boolean }
interface Languages { [lang: string]: number }

interface MacroEnvelope<T> { ok: boolean; result?: T; error?: string }

async function callMacro<T>(action: string, input: Record<string, unknown>): Promise<MacroEnvelope<T>> {
  const r = await apiHelpers.lens.runDomain('repos', action, { input });
  const data = (r as { data?: { ok: boolean; result?: T } }).data;
  if (!data) return { ok: false, error: 'empty response' };
  if (data.ok && data.result && typeof data.result === 'object' && 'ok' in data.result) {
    return data.result as MacroEnvelope<T>;
  }
  return data as MacroEnvelope<T>;
}

export function RepoBrowser() {
  const [owner, setOwner] = useState('facebook');
  const [repo, setRepo] = useState('react');
  const [commits, setCommits] = useState<Commit[]>([]);
  const [issues, setIssues] = useState<Issue[]>([]);
  const [languages, setLanguages] = useState<Languages>({});

  const load = useMutation({
    mutationFn: async () => {
      const [c, i, l] = await Promise.all([
        callMacro<{ commits: Commit[] }>('github-commits-recent', { owner, repo, limit: 20 }),
        callMacro<{ issues: Issue[] }>('github-issues', { owner, repo, state: 'open', limit: 20 }),
        callMacro<{ languages: Languages }>('github-languages', { owner, repo }),
      ]);
      if (c.ok && c.result) setCommits(c.result.commits);
      if (i.ok && i.result) setIssues(i.result.issues);
      if (l.ok && l.result) setLanguages(l.result.languages || (l.result as unknown as Languages));
    },
  });

  const totalBytes = Object.values(languages).reduce((s, v) => s + v, 0);

  return (
    <div className="space-y-4">
      <header className="flex items-center justify-between gap-3 border-b border-cyan-500/15 pb-3">
        <div className="flex items-center gap-2">
          <Github className="h-5 w-5 text-cyan-400" />
          <h2 className="text-sm font-semibold text-white">Repo Browser</h2>
          <span className="rounded bg-zinc-800 px-1.5 py-0.5 font-mono text-[10px] uppercase tracking-wider text-zinc-400">github api</span>
        </div>
      </header>
      <form onSubmit={(e) => { e.preventDefault(); load.mutate(); }} className="flex items-center gap-2">
        <input type="text" value={owner} onChange={(e) => setOwner(e.target.value)} placeholder="owner" className="w-32 rounded border border-zinc-800 bg-zinc-950 px-2 py-1.5 font-mono text-xs text-white" />
        <span className="text-zinc-500">/</span>
        <input type="text" value={repo} onChange={(e) => setRepo(e.target.value)} placeholder="repo" className="w-40 rounded border border-zinc-800 bg-zinc-950 px-2 py-1.5 font-mono text-xs text-white" />
        <button type="submit" disabled={!owner || !repo || load.isPending} className="inline-flex items-center gap-1.5 rounded-md border border-cyan-500/30 bg-cyan-500/10 px-3 py-1.5 text-xs text-cyan-200 hover:bg-cyan-500/20 disabled:opacity-50">
          {load.isPending ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Github className="h-3.5 w-3.5" />}
          Load
        </button>
        {(commits.length > 0 || issues.length > 0) && (
          <SaveAsDtuButton
            compact
            apiSource="github"
            apiUrl={`https://github.com/${owner}/${repo}`}
            title={`${owner}/${repo} snapshot`}
            content={`Repo: ${owner}/${repo}\nCommits (${commits.length}):\n${commits.slice(0, 5).map((c) => `  ${c.sha?.slice(0, 7)} ${c.author}: ${c.message?.split('\n')[0]}`).join('\n')}\n\nOpen issues (${issues.length}):\n${issues.slice(0, 5).map((i) => `  #${i.number} ${i.title}`).join('\n')}\n\nLanguages: ${Object.keys(languages).join(', ')}`}
            extraTags={['repos', 'github', owner.toLowerCase(), repo.toLowerCase()]}
            rawData={{ commits, issues, languages }}
          />
        )}
      </form>

      {Object.keys(languages).length > 0 && (
        <div className="rounded-md border border-zinc-800 bg-zinc-950 p-2">
          <div className="mb-1 flex items-center gap-1 text-[10px] uppercase tracking-wider text-zinc-500">
            <Code2 className="h-3 w-3" /> Language mix
          </div>
          <div className="flex h-3 w-full overflow-hidden rounded-full bg-zinc-800">
            {Object.entries(languages).sort((a, b) => b[1] - a[1]).map(([k, v]) => (
              <div key={k} className="bg-cyan-500" style={{ width: `${(v / totalBytes) * 100}%`, opacity: 0.3 + (v / totalBytes) }} title={`${k}: ${((v / totalBytes) * 100).toFixed(1)}%`} />
            ))}
          </div>
          <div className="mt-1 flex flex-wrap gap-1 text-[10px]">
            {Object.entries(languages).sort((a, b) => b[1] - a[1]).slice(0, 6).map(([k, v]) => (
              <span key={k} className="rounded bg-zinc-800 px-1.5 py-0.5 font-mono text-cyan-300">{k} {((v / totalBytes) * 100).toFixed(1)}%</span>
            ))}
          </div>
        </div>
      )}

      <div className="grid grid-cols-1 gap-3 md:grid-cols-2">
        <div className="rounded-md border border-zinc-800 bg-zinc-950/40 p-3">
          <div className="mb-2 flex items-center gap-1 text-xs font-semibold text-zinc-200"><GitCommit className="h-3.5 w-3.5 text-cyan-400" /> Recent commits</div>
          <div className="space-y-1 max-h-72 overflow-y-auto">
            {commits.map((c) => (
              <a key={c.sha} href={c.url} target="_blank" rel="noopener noreferrer" className="block rounded border border-zinc-800 bg-zinc-950 p-2 text-[11px] hover:border-cyan-500/30">
                <div className="flex items-baseline gap-2">
                  <span className="font-mono text-cyan-300">{c.sha?.slice(0, 7)}</span>
                  <span className="text-zinc-400">{c.author}</span>
                </div>
                <div className="line-clamp-1 text-zinc-200">{c.message?.split('\n')[0]}</div>
              </a>
            ))}
          </div>
        </div>
        <div className="rounded-md border border-zinc-800 bg-zinc-950/40 p-3">
          <div className="mb-2 flex items-center gap-1 text-xs font-semibold text-zinc-200"><MessageCircle className="h-3.5 w-3.5 text-cyan-400" /> Open issues</div>
          <div className="space-y-1 max-h-72 overflow-y-auto">
            {issues.map((i) => (
              <a key={i.number} href={i.url} target="_blank" rel="noopener noreferrer" className="block rounded border border-zinc-800 bg-zinc-950 p-2 text-[11px] hover:border-cyan-500/30">
                <div className="flex items-baseline gap-2">
                  <span className="font-mono text-cyan-300">#{i.number}</span>
                  {i.isPullRequest && <span className="rounded bg-violet-500/20 px-1 text-[9px] text-violet-300">PR</span>}
                </div>
                <div className="line-clamp-1 text-zinc-200">{i.title}</div>
                <div className="flex flex-wrap gap-1 text-[10px] text-zinc-500">
                  {i.labels?.map((l) => <span key={l} className="rounded bg-zinc-800 px-1">{l}</span>)}
                </div>
              </a>
            ))}
          </div>
        </div>
      </div>
    </div>
  );
}
