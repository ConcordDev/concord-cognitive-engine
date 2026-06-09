'use client';

/**
 * RepoWatchlist — a repository-tracking workbench: watch GitHub repos
 * (upstream / fork / competitor / dependency), refresh live stats, and
 * pull a real GitHub events feed into DTUs. Wires the fork.watch-* and
 * fork.feed macros.
 */

import { useCallback, useEffect, useState } from 'react';
import { GitFork, Trash2, Loader2, RefreshCw, Rss } from 'lucide-react';
import { lensRun } from '@/lib/api/client';

interface Repo { id: string; fullName: string; note: string; reason: string; lastStars: number | null; lastPushedAt: string | null; openIssues?: number | null; forks?: number | null }
interface Dash { repos: number; totalStars: number; refreshed: number; byReason: Record<string, number> }

const REASONS = ['upstream', 'fork', 'competitor', 'reference', 'dependency'];

export function RepoWatchlist() {
  const [repos, setRepos] = useState<Repo[]>([]);
  const [dash, setDash] = useState<Dash | null>(null);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState<string | null>(null);
  const [form, setForm] = useState({ fullName: '', reason: 'reference' });
  const [feedRepo, setFeedRepo] = useState('');
  const [feedMsg, setFeedMsg] = useState<string | null>(null);

  const refresh = useCallback(async () => {
    const [wl, d] = await Promise.all([
      lensRun('fork', 'watch-list', {}),
      lensRun('fork', 'watch-dashboard', {}),
    ]);
    setRepos((wl.data?.result?.repos as Repo[]) || []);
    setDash((d.data?.result as Dash) || null);
    setLoading(false);
  }, []);
  useEffect(() => { void refresh(); }, [refresh]);

  async function addRepo() {
    if (!form.fullName.trim()) return;
    const r = await lensRun('fork', 'watch-add', { fullName: form.fullName.trim(), reason: form.reason });
    if (r.data?.ok) { setForm({ fullName: '', reason: 'reference' }); await refresh(); }
  }
  async function delRepo(id: string) {
    await lensRun('fork', 'watch-delete', { id });
    await refresh();
  }
  async function refreshRepo(id: string) {
    setBusy(id);
    await lensRun('fork', 'watch-refresh', { id });
    setBusy(null);
    await refresh();
  }
  async function pullFeed() {
    setBusy('feed');
    setFeedMsg(null);
    const r = await lensRun('fork', 'feed', { fullName: feedRepo.trim() || undefined });
    setBusy(null);
    const res = r.data?.result as { ingested?: number; skipped?: number } | undefined;
    setFeedMsg(r.data?.ok ? `Ingested ${res?.ingested ?? 0} event DTUs (${res?.skipped ?? 0} dedup-skipped)` : (r.data?.error || 'Feed failed'));
  }

  if (loading) return <div className="flex items-center justify-center py-6 text-zinc-400"><Loader2 className="w-4 h-4 animate-spin" /></div>;

  return (
    <div className="rounded-2xl border border-zinc-800 bg-zinc-950/60 p-4">
      <div className="flex items-center gap-2 mb-3">
        <GitFork className="w-4 h-4 text-violet-400" />
        <h3 className="text-sm font-bold text-zinc-100">Repo Watchlist</h3>
      </div>

      {dash && (
        <div className="grid grid-cols-3 gap-2 mb-3">
          {([['Repos', dash.repos], ['Total stars', dash.totalStars.toLocaleString()], ['Refreshed', dash.refreshed]] as const).map(([l, v]) => (
            <div key={l} className="bg-zinc-900/60 border border-zinc-800 rounded-lg px-2 py-1.5 text-center">
              <p className="text-sm font-bold text-zinc-100">{v}</p>
              <p className="text-[9px] text-zinc-400 uppercase tracking-wide">{l}</p>
            </div>
          ))}
        </div>
      )}

      <div className="bg-zinc-900/60 border border-zinc-800 rounded-lg p-2.5 mb-3 flex flex-wrap gap-1.5 items-center">
        <Rss className="w-3.5 h-3.5 text-violet-400" />
        <input value={feedRepo} onChange={e => setFeedRepo(e.target.value)} placeholder="owner/repo for events feed (default nodejs/node)"
          className="flex-1 min-w-[160px] bg-zinc-950 border border-zinc-800 rounded px-2 py-1 text-xs text-zinc-200" />
        <button onClick={pullFeed} disabled={busy === 'feed'}
          className="px-2.5 py-1 text-xs rounded bg-violet-600 hover:bg-violet-500 text-white font-semibold disabled:opacity-40 inline-flex items-center gap-1">
          {busy === 'feed' ? <Loader2 className="w-3 h-3 animate-spin" /> : <Rss className="w-3 h-3" />}Pull feed
        </button>
        {feedMsg && <p className="w-full text-[10px] text-zinc-400">{feedMsg}</p>}
      </div>

      <div className="bg-zinc-900/60 border border-zinc-800 rounded-lg p-2.5 mb-3 flex flex-wrap gap-1.5">
        <input value={form.fullName} onChange={e => setForm({ ...form, fullName: e.target.value })} placeholder="owner/repo"
          className="flex-1 min-w-[140px] bg-zinc-950 border border-zinc-800 rounded px-2 py-1 text-xs text-zinc-200" />
        <select value={form.reason} onChange={e => setForm({ ...form, reason: e.target.value })}
          className="bg-zinc-950 border border-zinc-800 rounded px-1.5 py-1 text-xs text-zinc-200">
          {REASONS.map(r => <option key={r} value={r}>{r}</option>)}
        </select>
        <button onClick={addRepo} disabled={!form.fullName.trim()}
          className="px-2.5 py-1 text-xs rounded bg-violet-600 hover:bg-violet-500 text-white font-semibold disabled:opacity-40">Watch</button>
      </div>

      <ul className="space-y-1">
        {repos.length === 0 && <li className="text-xs text-zinc-400 italic py-3 text-center">No repos watched yet.</li>}
        {repos.map(r => (
          <li key={r.id} className="group bg-zinc-900/60 border border-zinc-800 rounded-lg px-3 py-2 flex items-center gap-2">
            <div className="min-w-0 flex-1">
              <p className="text-xs font-semibold text-zinc-100 truncate">{r.fullName}</p>
              <p className="text-[10px] text-zinc-400">
                {r.reason}
                {r.lastStars != null ? ` · ★ ${r.lastStars.toLocaleString()}` : ''}
                {r.forks != null ? ` · ${r.forks} forks` : ''}
                {r.lastPushedAt ? ` · pushed ${r.lastPushedAt.slice(0, 10)}` : ' · not yet refreshed'}
              </p>
            </div>
            <button onClick={() => refreshRepo(r.id)} disabled={busy === r.id} className="text-zinc-400 hover:text-violet-300">
              {busy === r.id ? <Loader2 className="w-3 h-3 animate-spin" /> : <RefreshCw className="w-3 h-3" />}
            </button>
            <button aria-label="Delete" onClick={() => delRepo(r.id)} className="opacity-0 group-hover:opacity-100 text-rose-400"><Trash2 className="w-3 h-3" /></button>
          </li>
        ))}
      </ul>
    </div>
  );
}
