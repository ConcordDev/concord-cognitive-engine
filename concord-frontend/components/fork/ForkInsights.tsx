'use client';

/**
 * ForkInsights — the GitHub-parity insight surface for the fork lens.
 * Six purpose-built tabs, each wired to one live GitHub-API macro:
 *   - Ahead/Behind  → fork.commitCompare
 *   - Pull Requests → fork.pullRequests
 *   - Network Graph → fork.networkGraph
 *   - Stale Forks   → fork.staleForkScan
 *   - Releases      → fork.releases
 *   - File Diff     → fork.fileDiff
 * All data is real (live GitHub public API). Empty states are explicit;
 * nothing is mocked or seeded.
 */

import { useCallback, useState } from 'react';
import {
  GitCompareArrows, GitPullRequest, Network, AlertTriangle, Tag, FileDiff,
  Loader2, ExternalLink, ArrowUp, ArrowDown, Plus, Minus, Star,
} from 'lucide-react';
import { lensRun } from '@/lib/api/client';
import { ChartKit } from '@/components/viz/ChartKit';

type TabId = 'compare' | 'prs' | 'network' | 'stale' | 'releases' | 'diff';

const TABS: { id: TabId; label: string; icon: typeof Network }[] = [
  { id: 'compare', label: 'Ahead / Behind', icon: GitCompareArrows },
  { id: 'prs', label: 'Pull Requests', icon: GitPullRequest },
  { id: 'network', label: 'Network Graph', icon: Network },
  { id: 'stale', label: 'Stale Forks', icon: AlertTriangle },
  { id: 'releases', label: 'Releases & Tags', icon: Tag },
  { id: 'diff', label: 'File Diff', icon: FileDiff },
];

// ── shared macro types ────────────────────────────────────────────────
interface CompareResult {
  baseRepo: string; headRepo: string; baseRef: string; headRef: string;
  status: string; aheadBy: number; behindBy: number; totalCommits: number;
  filesChanged: number; additions: number; deletions: number; netLines: number;
  files: { filename: string; status: string; additions: number; deletions: number; changes: number }[];
  commits: { sha: string; message: string; author: string; date: string | null }[];
}
interface PRResult {
  fullName: string; state: string; count: number;
  counts: Record<string, number>;
  forkContributions: { repo: string; open: number; merged: number; closed: number; total: number }[];
  pullRequests: {
    number: number; title: string; author: string; state: string; draft: boolean;
    headRepo: string | null; headRef: string | null; baseRef: string | null;
    htmlUrl: string; createdAt: string; updatedAt: string; mergedAt: string | null; comments: number;
  }[];
}
interface NetworkResult {
  parent: string; forkCount: number; grandTotalCommits: number;
  repos: { repo: string; isParent: boolean; total: number; available: boolean;
    weeks: { week: number; total: number }[] }[];
  combined: { week: number; total: number }[];
}
interface StaleResult {
  repo: string; staleDays: number; totalForks: number; networkHealthPct: number;
  counts: Record<string, number>;
  alerts: { fullName: string; severity: string; message: string }[];
  forks: { fullName: string; htmlUrl: string; stargazers: number; daysSincePush: number | null; band: string }[];
}
interface ReleasesResult {
  fullName: string; releaseCount: number; tagCount: number; totalAssetDownloads: number;
  latest: { name: string; tagName: string; publishedAt: string | null; htmlUrl: string } | null;
  releases: {
    name: string; tagName: string; draft: boolean; prerelease: boolean; author: string | null;
    publishedAt: string | null; htmlUrl: string; bodyExcerpt: string;
    assets: { name: string; downloadCount: number; size: number }[];
  }[];
  tags: { name: string; sha: string }[];
}
interface DiffResult {
  baseRepo: string; headRepo: string; path: string; baseRef: string; headRef: string;
  baseExists: boolean; headExists: boolean; additions: number; deletions: number;
  identical: boolean; truncated: boolean;
  rows: { type: 'context' | 'add' | 'del'; text: string; aLine: number | null; bLine: number | null }[];
}

const inputCls =
  'rounded border border-zinc-800 bg-zinc-950 px-2 py-1.5 font-mono text-xs text-white placeholder:text-zinc-600';

function StatTile({ label, value, tone }: { label: string; value: string | number; tone?: string }) {
  return (
    <div className="rounded-lg border border-zinc-800 bg-zinc-900/60 px-3 py-2 text-center">
      <p className={`text-lg font-bold ${tone || 'text-zinc-100'}`}>{value}</p>
      <p className="text-[9px] uppercase tracking-wide text-zinc-500">{label}</p>
    </div>
  );
}

function ErrLine({ msg }: { msg: string }) {
  return <div className="rounded border border-red-500/20 bg-red-500/5 px-3 py-2 text-xs text-red-300">{msg}</div>;
}

// ── tab: commitCompare ────────────────────────────────────────────────
function CompareTab() {
  const [baseRepo, setBaseRepo] = useState('');
  const [headRepo, setHeadRepo] = useState('');
  const [baseRef, setBaseRef] = useState('');
  const [headRef, setHeadRef] = useState('');
  const [data, setData] = useState<CompareResult | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  const run = useCallback(async () => {
    setLoading(true); setErr(null); setData(null);
    const r = await lensRun<CompareResult>('fork', 'commitCompare', {
      baseRepo, headRepo, baseRef: baseRef || undefined, headRef: headRef || undefined,
    });
    if (r.data?.ok && r.data.result) setData(r.data.result);
    else setErr(r.data?.error || 'comparison failed');
    setLoading(false);
  }, [baseRepo, headRepo, baseRef, headRef]);

  return (
    <div className="space-y-3">
      <p className="text-[11px] text-zinc-500">
        Commit-level ahead/behind comparison between a fork and its parent (or any two repos).
      </p>
      <form onSubmit={(e) => { e.preventDefault(); void run(); }} className="grid grid-cols-2 gap-2 sm:grid-cols-4">
        <input className={inputCls} value={baseRepo} onChange={(e) => setBaseRepo(e.target.value)} placeholder="base owner/repo" />
        <input className={inputCls} value={headRepo} onChange={(e) => setHeadRepo(e.target.value)} placeholder="head owner/repo" />
        <input className={inputCls} value={baseRef} onChange={(e) => setBaseRef(e.target.value)} placeholder="base ref (optional)" />
        <input className={inputCls} value={headRef} onChange={(e) => setHeadRef(e.target.value)} placeholder="head ref (optional)" />
        <button type="submit" disabled={!baseRepo.trim() || !headRepo.trim() || loading}
          className="col-span-2 inline-flex items-center justify-center gap-1.5 rounded-md border border-cyan-500/30 bg-cyan-500/10 px-3 py-1.5 text-xs text-cyan-200 hover:bg-cyan-500/20 disabled:opacity-50 sm:col-span-4">
          {loading ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <GitCompareArrows className="h-3.5 w-3.5" />}
          Compare
        </button>
      </form>
      {err && <ErrLine msg={err} />}
      {data && (
        <div className="space-y-3">
          <div className="grid grid-cols-3 gap-2 sm:grid-cols-6">
            <StatTile label="ahead" value={data.aheadBy} tone="text-emerald-300" />
            <StatTile label="behind" value={data.behindBy} tone="text-amber-300" />
            <StatTile label="commits" value={data.totalCommits} />
            <StatTile label="files" value={data.filesChanged} />
            <StatTile label="+lines" value={data.additions} tone="text-emerald-300" />
            <StatTile label="-lines" value={data.deletions} tone="text-red-300" />
          </div>
          <p className="text-[11px] text-zinc-500">
            <span className="font-mono text-zinc-300">{data.baseRepo}@{data.baseRef}</span>
            {' '}<span className="text-cyan-400">···</span>{' '}
            <span className="font-mono text-zinc-300">{data.headRepo}@{data.headRef}</span>
            {' · status '}<span className="text-cyan-300">{data.status}</span>
          </p>
          {data.files.length > 0 && (
            <div className="rounded-lg border border-zinc-800 bg-zinc-950/60">
              <p className="border-b border-zinc-800 px-3 py-1.5 text-[10px] font-semibold uppercase tracking-wide text-zinc-500">Changed files</p>
              <ul className="max-h-56 divide-y divide-zinc-900 overflow-y-auto">
                {data.files.map((f) => (
                  <li key={f.filename} className="flex items-center gap-2 px-3 py-1.5 text-[11px]">
                    <span className="w-12 shrink-0 font-mono uppercase text-zinc-500">{f.status.slice(0, 4)}</span>
                    <span className="min-w-0 flex-1 truncate font-mono text-zinc-300">{f.filename}</span>
                    <span className="font-mono text-emerald-400">+{f.additions}</span>
                    <span className="font-mono text-red-400">-{f.deletions}</span>
                  </li>
                ))}
              </ul>
            </div>
          )}
          {data.commits.length > 0 && (
            <div className="rounded-lg border border-zinc-800 bg-zinc-950/60">
              <p className="border-b border-zinc-800 px-3 py-1.5 text-[10px] font-semibold uppercase tracking-wide text-zinc-500">Commits ({data.commits.length})</p>
              <ul className="max-h-56 divide-y divide-zinc-900 overflow-y-auto">
                {data.commits.map((c) => (
                  <li key={c.sha} className="px-3 py-1.5 text-[11px]">
                    <span className="mr-2 font-mono text-cyan-400">{c.sha}</span>
                    <span className="text-zinc-300">{c.message}</span>
                    <span className="ml-2 text-zinc-600">{c.author}{c.date ? ` · ${c.date.slice(0, 10)}` : ''}</span>
                  </li>
                ))}
              </ul>
            </div>
          )}
        </div>
      )}
    </div>
  );
}

// ── tab: pullRequests ─────────────────────────────────────────────────
function PRTab() {
  const [fullName, setFullName] = useState('');
  const [state, setState] = useState<'open' | 'closed' | 'all'>('open');
  const [data, setData] = useState<PRResult | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  const run = useCallback(async () => {
    setLoading(true); setErr(null); setData(null);
    const r = await lensRun<PRResult>('fork', 'pullRequests', { fullName, state, limit: 50 });
    if (r.data?.ok && r.data.result) setData(r.data.result);
    else setErr(r.data?.error || 'pull-request lookup failed');
    setLoading(false);
  }, [fullName, state]);

  const stateTone: Record<string, string> = {
    open: 'text-emerald-300', merged: 'text-violet-300', closed: 'text-red-300',
  };

  return (
    <div className="space-y-3">
      <p className="text-[11px] text-zinc-500">
        Pull-request status overlay — open / merged / closed PRs and which forks contribute them.
      </p>
      <form onSubmit={(e) => { e.preventDefault(); void run(); }} className="flex flex-wrap items-center gap-2">
        <input className={`${inputCls} flex-1 min-w-[160px]`} value={fullName} onChange={(e) => setFullName(e.target.value)} placeholder="owner/repo" />
        <div className="flex rounded-md border border-zinc-800 bg-zinc-950 p-0.5 text-[10px]">
          {(['open', 'closed', 'all'] as const).map((s) => (
            <button key={s} type="button" onClick={() => setState(s)}
              className={`rounded px-2 py-0.5 font-mono uppercase ${state === s ? 'bg-cyan-500/20 text-cyan-200' : 'text-zinc-500 hover:text-zinc-300'}`}>{s}</button>
          ))}
        </div>
        <button type="submit" disabled={!fullName.trim() || loading}
          className="inline-flex items-center gap-1.5 rounded-md border border-cyan-500/30 bg-cyan-500/10 px-3 py-1.5 text-xs text-cyan-200 hover:bg-cyan-500/20 disabled:opacity-50">
          {loading ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <GitPullRequest className="h-3.5 w-3.5" />}
          Load PRs
        </button>
      </form>
      {err && <ErrLine msg={err} />}
      {data && (
        <div className="space-y-3">
          <div className="grid grid-cols-3 gap-2 sm:grid-cols-4">
            <StatTile label="total" value={data.count} />
            <StatTile label="open" value={data.counts.open || 0} tone="text-emerald-300" />
            <StatTile label="merged" value={data.counts.merged || 0} tone="text-violet-300" />
            <StatTile label="closed" value={data.counts.closed || 0} tone="text-red-300" />
          </div>
          {data.forkContributions.length > 0 && (
            <div className="rounded-lg border border-zinc-800 bg-zinc-950/60">
              <p className="border-b border-zinc-800 px-3 py-1.5 text-[10px] font-semibold uppercase tracking-wide text-zinc-500">PRs by contributing fork</p>
              <ul className="max-h-40 divide-y divide-zinc-900 overflow-y-auto">
                {data.forkContributions.map((fc) => (
                  <li key={fc.repo} className="flex items-center gap-2 px-3 py-1.5 text-[11px]">
                    <span className="min-w-0 flex-1 truncate font-mono text-zinc-300">{fc.repo}</span>
                    <span className="text-emerald-400">{fc.open} open</span>
                    <span className="text-violet-400">{fc.merged} merged</span>
                    <span className="text-zinc-500">{fc.total} total</span>
                  </li>
                ))}
              </ul>
            </div>
          )}
          {data.pullRequests.length === 0 ? (
            <p className="py-3 text-center text-xs italic text-zinc-500">No pull requests for this state.</p>
          ) : (
            <div className="rounded-lg border border-zinc-800 bg-zinc-950/60">
              <ul className="max-h-64 divide-y divide-zinc-900 overflow-y-auto">
                {data.pullRequests.map((p) => (
                  <li key={p.number} className="flex items-center gap-2 px-3 py-1.5 text-[11px]">
                    <span className={`font-mono ${stateTone[p.state] || 'text-zinc-400'}`}>#{p.number}</span>
                    <span className="min-w-0 flex-1 truncate text-zinc-200">{p.title}</span>
                    {p.draft && <span className="rounded bg-zinc-800 px-1 text-[9px] text-zinc-400">draft</span>}
                    <span className={`font-mono uppercase ${stateTone[p.state] || 'text-zinc-400'}`}>{p.state}</span>
                    <span className="text-zinc-600">{p.author}</span>
                    <a href={p.htmlUrl} target="_blank" rel="noopener noreferrer" className="text-cyan-400 hover:text-cyan-300">
                      <ExternalLink className="h-3 w-3" />
                    </a>
                  </li>
                ))}
              </ul>
            </div>
          )}
        </div>
      )}
    </div>
  );
}

// ── tab: networkGraph ─────────────────────────────────────────────────
function NetworkTab() {
  const [owner, setOwner] = useState('');
  const [repo, setRepo] = useState('');
  const [data, setData] = useState<NetworkResult | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  const run = useCallback(async () => {
    setLoading(true); setErr(null); setData(null);
    const r = await lensRun<NetworkResult>('fork', 'networkGraph', { owner, repo, limitForks: 8 });
    if (r.data?.ok && r.data.result) setData(r.data.result);
    else setErr(r.data?.error || 'network graph failed');
    setLoading(false);
  }, [owner, repo]);

  const chartData = data
    ? data.combined.map((c) => ({ label: new Date(c.week * 1000).toISOString().slice(0, 10), value: c.total }))
    : [];

  return (
    <div className="space-y-3">
      <p className="text-[11px] text-zinc-500">
        Commits-over-time across the parent and its top forks — GitHub-style network graph.
      </p>
      <form onSubmit={(e) => { e.preventDefault(); void run(); }} className="flex flex-wrap items-center gap-2">
        <input className={`${inputCls} w-32`} value={owner} onChange={(e) => setOwner(e.target.value)} placeholder="owner" />
        <span className="text-zinc-500">/</span>
        <input className={`${inputCls} w-40`} value={repo} onChange={(e) => setRepo(e.target.value)} placeholder="repo" />
        <button type="submit" disabled={!owner.trim() || !repo.trim() || loading}
          className="inline-flex items-center gap-1.5 rounded-md border border-cyan-500/30 bg-cyan-500/10 px-3 py-1.5 text-xs text-cyan-200 hover:bg-cyan-500/20 disabled:opacity-50">
          {loading ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Network className="h-3.5 w-3.5" />}
          Build graph
        </button>
      </form>
      {err && <ErrLine msg={err} />}
      {data && (
        <div className="space-y-3">
          <div className="grid grid-cols-3 gap-2">
            <StatTile label="forks" value={data.forkCount} />
            <StatTile label="repos charted" value={data.repos.length} />
            <StatTile label="total commits" value={data.grandTotalCommits} tone="text-cyan-300" />
          </div>
          {chartData.length > 0 ? (
            <div className="rounded-lg border border-zinc-800 bg-zinc-950/60 p-3">
              <p className="mb-2 text-[10px] font-semibold uppercase tracking-wide text-zinc-500">Weekly commits — combined network</p>
              <ChartKit
                kind="area"
                data={chartData}
                xKey="label"
                series={[{ key: 'value', label: 'commits', color: '#22d3ee' }]}
                height={150}
                showLegend={false}
              />
            </div>
          ) : (
            <p className="py-3 text-center text-xs italic text-zinc-500">
              GitHub is still computing commit statistics for this network — retry shortly.
            </p>
          )}
          <div className="rounded-lg border border-zinc-800 bg-zinc-950/60">
            <p className="border-b border-zinc-800 px-3 py-1.5 text-[10px] font-semibold uppercase tracking-wide text-zinc-500">Per-repo commit volume</p>
            <ul className="max-h-56 divide-y divide-zinc-900 overflow-y-auto">
              {data.repos.map((rp) => {
                const max = Math.max(1, ...data.repos.map((x) => x.total));
                return (
                  <li key={rp.repo} className="px-3 py-1.5 text-[11px]">
                    <div className="flex items-center gap-2">
                      <span className="min-w-0 flex-1 truncate font-mono text-zinc-300">
                        {rp.repo}{rp.isParent && <span className="ml-1 text-cyan-400">(parent)</span>}
                      </span>
                      <span className="font-mono text-zinc-400">{rp.available ? rp.total : 'n/a'}</span>
                    </div>
                    <div className="mt-1 h-1.5 overflow-hidden rounded-full bg-zinc-800">
                      <div className={`h-full rounded-full ${rp.isParent ? 'bg-cyan-400' : 'bg-violet-500'}`}
                        style={{ width: `${(rp.total / max) * 100}%` }} />
                    </div>
                  </li>
                );
              })}
            </ul>
          </div>
        </div>
      )}
    </div>
  );
}

// ── tab: staleForkScan ────────────────────────────────────────────────
function StaleTab() {
  const [owner, setOwner] = useState('');
  const [repo, setRepo] = useState('');
  const [staleDays, setStaleDays] = useState(180);
  const [data, setData] = useState<StaleResult | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  const run = useCallback(async () => {
    setLoading(true); setErr(null); setData(null);
    const r = await lensRun<StaleResult>('fork', 'staleForkScan', { owner, repo, staleDays, limit: 80 });
    if (r.data?.ok && r.data.result) setData(r.data.result);
    else setErr(r.data?.error || 'stale-fork scan failed');
    setLoading(false);
  }, [owner, repo, staleDays]);

  const bandTone: Record<string, string> = {
    active: 'text-emerald-300', slowing: 'text-amber-300',
    stale: 'text-red-300', archived: 'text-zinc-500', unknown: 'text-zinc-500',
  };
  const sevTone: Record<string, string> = {
    high: 'border-red-500/30 bg-red-500/5 text-red-300',
    warning: 'border-amber-500/30 bg-amber-500/5 text-amber-300',
    info: 'border-zinc-700 bg-zinc-900/40 text-zinc-400',
  };

  return (
    <div className="space-y-3">
      <p className="text-[11px] text-zinc-500">
        Contributor activity / stale-fork detection — flags forks gone quiet past the threshold.
      </p>
      <form onSubmit={(e) => { e.preventDefault(); void run(); }} className="flex flex-wrap items-center gap-2">
        <input className={`${inputCls} w-28`} value={owner} onChange={(e) => setOwner(e.target.value)} placeholder="owner" />
        <span className="text-zinc-500">/</span>
        <input className={`${inputCls} w-36`} value={repo} onChange={(e) => setRepo(e.target.value)} placeholder="repo" />
        <label className="flex items-center gap-1 text-[10px] text-zinc-500">
          stale after
          <input type="number" min={1} max={3650} value={staleDays}
            onChange={(e) => setStaleDays(Math.max(1, Math.min(3650, Number(e.target.value) || 180)))}
            className={`${inputCls} w-16`} />
          days
        </label>
        <button type="submit" disabled={!owner.trim() || !repo.trim() || loading}
          className="inline-flex items-center gap-1.5 rounded-md border border-cyan-500/30 bg-cyan-500/10 px-3 py-1.5 text-xs text-cyan-200 hover:bg-cyan-500/20 disabled:opacity-50">
          {loading ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <AlertTriangle className="h-3.5 w-3.5" />}
          Scan forks
        </button>
      </form>
      {err && <ErrLine msg={err} />}
      {data && (
        <div className="space-y-3">
          <div className="grid grid-cols-3 gap-2 sm:grid-cols-5">
            <StatTile label="forks" value={data.totalForks} />
            <StatTile label="active" value={data.counts.active || 0} tone="text-emerald-300" />
            <StatTile label="slowing" value={data.counts.slowing || 0} tone="text-amber-300" />
            <StatTile label="stale" value={data.counts.stale || 0} tone="text-red-300" />
            <StatTile label="net health" value={`${data.networkHealthPct}%`}
              tone={data.networkHealthPct >= 50 ? 'text-emerald-300' : 'text-amber-300'} />
          </div>
          {data.alerts.length > 0 && (
            <div className="space-y-1">
              {data.alerts.map((a) => (
                <div key={a.fullName} className={`rounded border px-3 py-1.5 text-[11px] ${sevTone[a.severity] || sevTone.info}`}>
                  {a.message}
                </div>
              ))}
            </div>
          )}
          {data.forks.length > 0 && (
            <div className="rounded-lg border border-zinc-800 bg-zinc-950/60">
              <ul className="max-h-64 divide-y divide-zinc-900 overflow-y-auto">
                {data.forks.map((f) => (
                  <li key={f.fullName} className="flex items-center gap-2 px-3 py-1.5 text-[11px]">
                    <span className="min-w-0 flex-1 truncate font-mono text-zinc-300">{f.fullName}</span>
                    <span className="inline-flex items-center gap-0.5 text-zinc-500"><Star className="h-3 w-3" />{f.stargazers}</span>
                    <span className="text-zinc-600">{f.daysSincePush != null ? `${f.daysSincePush}d` : '—'}</span>
                    <span className={`font-mono uppercase ${bandTone[f.band] || 'text-zinc-500'}`}>{f.band}</span>
                    <a href={f.htmlUrl} target="_blank" rel="noopener noreferrer" className="text-cyan-400 hover:text-cyan-300">
                      <ExternalLink className="h-3 w-3" />
                    </a>
                  </li>
                ))}
              </ul>
            </div>
          )}
        </div>
      )}
    </div>
  );
}

// ── tab: releases ─────────────────────────────────────────────────────
function ReleasesTab() {
  const [fullName, setFullName] = useState('');
  const [data, setData] = useState<ReleasesResult | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  const run = useCallback(async () => {
    setLoading(true); setErr(null); setData(null);
    const r = await lensRun<ReleasesResult>('fork', 'releases', { fullName, limit: 20 });
    if (r.data?.ok && r.data.result) setData(r.data.result);
    else setErr(r.data?.error || 'release lookup failed');
    setLoading(false);
  }, [fullName]);

  return (
    <div className="space-y-3">
      <p className="text-[11px] text-zinc-500">
        Release / tag tracking on a watched repo — latest stable, asset downloads, lightweight tags.
      </p>
      <form onSubmit={(e) => { e.preventDefault(); void run(); }} className="flex flex-wrap items-center gap-2">
        <input className={`${inputCls} flex-1 min-w-[160px]`} value={fullName} onChange={(e) => setFullName(e.target.value)} placeholder="owner/repo" />
        <button type="submit" disabled={!fullName.trim() || loading}
          className="inline-flex items-center gap-1.5 rounded-md border border-cyan-500/30 bg-cyan-500/10 px-3 py-1.5 text-xs text-cyan-200 hover:bg-cyan-500/20 disabled:opacity-50">
          {loading ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Tag className="h-3.5 w-3.5" />}
          Track releases
        </button>
      </form>
      {err && <ErrLine msg={err} />}
      {data && (
        <div className="space-y-3">
          <div className="grid grid-cols-3 gap-2">
            <StatTile label="releases" value={data.releaseCount} />
            <StatTile label="tags" value={data.tagCount} />
            <StatTile label="asset downloads" value={data.totalAssetDownloads.toLocaleString()} tone="text-cyan-300" />
          </div>
          {data.latest && (
            <div className="rounded-lg border border-cyan-500/20 bg-cyan-500/5 px-3 py-2 text-[11px]">
              <span className="font-semibold text-cyan-200">Latest stable: </span>
              <span className="font-mono text-zinc-200">{data.latest.tagName}</span>
              {data.latest.publishedAt && <span className="text-zinc-500"> · {data.latest.publishedAt.slice(0, 10)}</span>}
              <a href={data.latest.htmlUrl} target="_blank" rel="noopener noreferrer" className="ml-2 text-cyan-400 hover:text-cyan-300">open</a>
            </div>
          )}
          {data.releases.length === 0 ? (
            <p className="py-3 text-center text-xs italic text-zinc-500">No releases published for this repo.</p>
          ) : (
            <div className="rounded-lg border border-zinc-800 bg-zinc-950/60">
              <ul className="max-h-56 divide-y divide-zinc-900 overflow-y-auto">
                {data.releases.map((rel) => (
                  <li key={rel.tagName} className="px-3 py-1.5 text-[11px]">
                    <div className="flex items-center gap-2">
                      <span className="font-mono text-zinc-200">{rel.tagName}</span>
                      {rel.prerelease && <span className="rounded bg-amber-500/10 px-1 text-[9px] text-amber-300">pre</span>}
                      {rel.draft && <span className="rounded bg-zinc-800 px-1 text-[9px] text-zinc-400">draft</span>}
                      <span className="ml-auto text-zinc-600">{rel.publishedAt ? rel.publishedAt.slice(0, 10) : '—'}</span>
                      <a href={rel.htmlUrl} target="_blank" rel="noopener noreferrer" className="text-cyan-400 hover:text-cyan-300">
                        <ExternalLink className="h-3 w-3" />
                      </a>
                    </div>
                    {rel.bodyExcerpt && <p className="mt-0.5 line-clamp-2 text-zinc-500">{rel.bodyExcerpt}</p>}
                    {rel.assets.length > 0 && (
                      <p className="mt-0.5 text-zinc-600">
                        {rel.assets.length} asset{rel.assets.length !== 1 ? 's' : ''} ·{' '}
                        {rel.assets.reduce((s, a) => s + a.downloadCount, 0).toLocaleString()} downloads
                      </p>
                    )}
                  </li>
                ))}
              </ul>
            </div>
          )}
          {data.tags.length > 0 && (
            <div className="flex flex-wrap gap-1.5">
              {data.tags.map((t) => (
                <span key={t.name} className="rounded border border-zinc-800 bg-zinc-900/60 px-1.5 py-0.5 font-mono text-[10px] text-zinc-400">
                  {t.name} <span className="text-zinc-600">{t.sha}</span>
                </span>
              ))}
            </div>
          )}
        </div>
      )}
    </div>
  );
}

// ── tab: fileDiff ─────────────────────────────────────────────────────
function DiffTab() {
  const [baseRepo, setBaseRepo] = useState('');
  const [headRepo, setHeadRepo] = useState('');
  const [path, setPath] = useState('');
  const [baseRef, setBaseRef] = useState('');
  const [headRef, setHeadRef] = useState('');
  const [data, setData] = useState<DiffResult | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  const run = useCallback(async () => {
    setLoading(true); setErr(null); setData(null);
    const r = await lensRun<DiffResult>('fork', 'fileDiff', {
      baseRepo, headRepo, path, baseRef: baseRef || undefined, headRef: headRef || undefined,
    });
    if (r.data?.ok && r.data.result) setData(r.data.result);
    else setErr(r.data?.error || 'file diff failed');
    setLoading(false);
  }, [baseRepo, headRepo, path, baseRef, headRef]);

  const rowTone: Record<string, string> = {
    add: 'bg-emerald-500/10 text-emerald-200',
    del: 'bg-red-500/10 text-red-200',
    context: 'text-zinc-500',
  };

  return (
    <div className="space-y-3">
      <p className="text-[11px] text-zinc-500">
        Cross-fork file-level diff browser — compares one file across two repos / refs, line by line.
      </p>
      <form onSubmit={(e) => { e.preventDefault(); void run(); }} className="grid grid-cols-2 gap-2 sm:grid-cols-3">
        <input className={inputCls} value={baseRepo} onChange={(e) => setBaseRepo(e.target.value)} placeholder="base owner/repo" />
        <input className={inputCls} value={headRepo} onChange={(e) => setHeadRepo(e.target.value)} placeholder="head owner/repo" />
        <input className={inputCls} value={path} onChange={(e) => setPath(e.target.value)} placeholder="file path" />
        <input className={inputCls} value={baseRef} onChange={(e) => setBaseRef(e.target.value)} placeholder="base ref (optional)" />
        <input className={inputCls} value={headRef} onChange={(e) => setHeadRef(e.target.value)} placeholder="head ref (optional)" />
        <button type="submit" disabled={!baseRepo.trim() || !headRepo.trim() || !path.trim() || loading}
          className="inline-flex items-center justify-center gap-1.5 rounded-md border border-cyan-500/30 bg-cyan-500/10 px-3 py-1.5 text-xs text-cyan-200 hover:bg-cyan-500/20 disabled:opacity-50">
          {loading ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <FileDiff className="h-3.5 w-3.5" />}
          Diff file
        </button>
      </form>
      {err && <ErrLine msg={err} />}
      {data && (
        <div className="space-y-2">
          <div className="flex flex-wrap items-center gap-3 text-[11px]">
            <span className="font-mono text-zinc-300">{data.path}</span>
            <span className="inline-flex items-center gap-0.5 text-emerald-400"><Plus className="h-3 w-3" />{data.additions}</span>
            <span className="inline-flex items-center gap-0.5 text-red-400"><Minus className="h-3 w-3" />{data.deletions}</span>
            {data.identical && <span className="text-zinc-500">identical</span>}
            {!data.baseExists && <span className="inline-flex items-center gap-0.5 text-amber-300"><ArrowUp className="h-3 w-3" />absent in base</span>}
            {!data.headExists && <span className="inline-flex items-center gap-0.5 text-amber-300"><ArrowDown className="h-3 w-3" />absent in head</span>}
            {data.truncated && <span className="text-amber-400">(truncated)</span>}
          </div>
          {data.rows.length === 0 ? (
            <p className="py-3 text-center text-xs italic text-zinc-500">No content to diff.</p>
          ) : (
            <div className="overflow-x-auto rounded-lg border border-zinc-800 bg-zinc-950/80">
              <pre className="max-h-80 overflow-y-auto text-[10px] leading-relaxed">
                {data.rows.map((row, i) => (
                  <div key={i} className={`flex ${rowTone[row.type]}`}>
                    <span className="w-10 shrink-0 select-none px-1 text-right text-zinc-700">{row.aLine ?? ''}</span>
                    <span className="w-10 shrink-0 select-none px-1 text-right text-zinc-700">{row.bLine ?? ''}</span>
                    <span className="w-4 shrink-0 select-none text-center">
                      {row.type === 'add' ? '+' : row.type === 'del' ? '-' : ' '}
                    </span>
                    <span className="whitespace-pre-wrap break-all px-1 font-mono">{row.text || ' '}</span>
                  </div>
                ))}
              </pre>
            </div>
          )}
        </div>
      )}
    </div>
  );
}

// ── shell ─────────────────────────────────────────────────────────────
export function ForkInsights() {
  const [tab, setTab] = useState<TabId>('compare');

  return (
    <div className="rounded-2xl border border-zinc-800 bg-zinc-950/60 p-4">
      <div className="mb-3 flex items-center gap-2">
        <GitCompareArrows className="h-4 w-4 text-cyan-400" />
        <h3 className="text-sm font-bold text-zinc-100">Fork Insights</h3>
        <span className="rounded bg-zinc-800 px-1.5 py-0.5 font-mono text-[9px] uppercase tracking-wider text-zinc-500">
          github api · live
        </span>
      </div>
      <div className="mb-4 flex flex-wrap gap-1">
        {TABS.map((t) => {
          const Icon = t.icon;
          return (
            <button key={t.id} onClick={() => setTab(t.id)}
              className={`inline-flex items-center gap-1.5 rounded-md px-2.5 py-1.5 text-[11px] font-medium transition-colors ${
                tab === t.id
                  ? 'bg-cyan-500/15 text-cyan-200 ring-1 ring-cyan-500/30'
                  : 'text-zinc-500 hover:bg-zinc-900 hover:text-zinc-300'
              }`}>
              <Icon className="h-3.5 w-3.5" />
              {t.label}
            </button>
          );
        })}
      </div>
      {tab === 'compare' && <CompareTab />}
      {tab === 'prs' && <PRTab />}
      {tab === 'network' && <NetworkTab />}
      {tab === 'stale' && <StaleTab />}
      {tab === 'releases' && <ReleasesTab />}
      {tab === 'diff' && <DiffTab />}
    </div>
  );
}
