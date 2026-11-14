'use client';

/**
 * RepoWatchlist — a repository-tracking workbench: watch GitHub repos
 * (upstream / fork / competitor / dependency), refresh live stats, and
 * pull a real GitHub events feed into DTUs. Wires the fork.watch-* and
 * fork.feed macros.
 */

import { useCallback, useEffect, useState } from 'react';
import { GitFork, Trash2, Loader2, RefreshCw, Rss } from 'lucide-react';
import { apiHelpers, lensRun } from '@/lib/api/client';
import { StickyDeleteConfirm } from '@/components/common/StickyDeleteConfirm';

interface Repo { id: string; fullName: string; note: string; reason: string; lastStars: number | null; lastPushedAt: string | null; openIssues?: number | null; forks?: number | null }
interface Dash { repos: number; totalStars: number; refreshed: number; byReason: Record<string, number> }
interface FeedItem { id: string; title: string; repo: string | null; type: string | null; actor: string | null; publishedAt: string | null }

const REASONS = ['upstream', 'fork', 'competitor', 'reference', 'dependency'];

export function RepoWatchlist() {
  const [repos, setRepos] = useState<Repo[]>([]);
  const [dash, setDash] = useState<Dash | null>(null);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState<string | null>(null);
  const [form, setForm] = useState({ fullName: '', reason: 'reference' });
  const [editId, setEditId] = useState<string | null>(null);
  const [editForm, setEditForm] = useState({ reason: 'reference', note: '' });
  const [feedRepo, setFeedRepo] = useState('');
  const [feedMsg, setFeedMsg] = useState<string | null>(null);
  const [feedItems, setFeedItems] = useState<FeedItem[]>([]);
  const [feedListMsg, setFeedListMsg] = useState<string | null>(null);

  const refresh = useCallback(async () => {
    const [wl, d, fl] = await Promise.all([
      lensRun('fork', 'watch-list', {}),
      lensRun('fork', 'watch-dashboard', {}),
      lensRun('fork', 'feed-list', {}),
    ]);
    setRepos((wl.data?.result?.repos as Repo[]) || []);
    setDash((d.data?.result as Dash) || null);
    setFeedItems((fl.data?.result?.items as FeedItem[]) || []);
    setLoading(false);
  }, []);
  useEffect(() => { void refresh(); }, [refresh]);

  async function addRepo() {
    if (!form.fullName.trim()) return;
    const r = await lensRun('fork', 'watch-add', { fullName: form.fullName.trim(), reason: form.reason });
    if (r.data?.ok) { setForm({ fullName: '', reason: 'reference' }); await refresh(); }
  }
  async function saveEdit(id: string) {
    const r = await lensRun('fork', 'watch-update', { id, reason: editForm.reason, note: editForm.note });
    if (r.data?.ok) { setEditId(null); await refresh(); }
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
  // FIX-fork-011 (remove leg, riding the canonical DTU verb of CB-0554
  // (1)): an ingested event DTU can be removed from the lens. dtus.delete
  // is owner-gated server-side; a refusal is named, never silent.
  async function delFeedItem(id: string) {
    try {
      const resp = await apiHelpers.dtus.delete(id) as { data?: { ok?: boolean; error?: string } };
      if (resp.data?.ok === false) { setFeedListMsg(resp.data?.error || 'That DTU could not be deleted.'); return; }
      setFeedListMsg(null);
      await refresh();
    } catch {
      setFeedListMsg('That DTU could not be deleted.');
    }
  }
  async function pullFeed() {
    setBusy('feed');
    setFeedMsg(null);
    const r = await lensRun('fork', 'feed', { fullName: feedRepo.trim() || undefined });
    setBusy(null);
    const res = r.data?.result as { ingested?: number; skipped?: number } | undefined;
    setFeedMsg(r.data?.ok ? `Ingested ${res?.ingested ?? 0} event DTUs (${res?.skipped ?? 0} dedup-skipped)` : (r.data?.error || 'Feed failed'));
    if (r.data?.ok) await refresh();
  }

  if (loading) return <div className="flex items-center justify-center py-6 text-zinc-400"><Loader2 className="w-4 h-4 animate-spin" /></div>;

  return (
    <div className="rounded-2xl border border-zinc-800 bg-zinc-950/60 p-4">
      <div className="flex items-center gap-2 mb-3">
        <GitFork className="w-4 h-4 text-violet-400" />
        <h3 className="text-sm font-bold text-zinc-100">Repo Watchlist</h3>
      </div>

      {dash && (
        <div className="grid grid-cols-1 md:grid-cols-3 gap-2 mb-3">
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

      {/* FIX-fork-011 (view leg): what the pull actually brought in. The
          ingested DTUs were invisible from this lens before feed-list. */}
      <div className="bg-zinc-900/60 border border-zinc-800 rounded-lg p-2.5 mb-3">
        <p className="text-[10px] font-semibold uppercase tracking-wide text-zinc-400 mb-1.5">Ingested from the feed</p>
        {feedItems.length === 0 ? (
          <p className="text-xs text-zinc-500 italic">Nothing ingested yet — pull a feed to bring its events in as DTUs.</p>
        ) : (
          <ul className="space-y-1">
            {feedItems.map(item => (
              <li key={item.id} className="group flex items-baseline gap-2 text-xs">
                <span className="min-w-0 flex-1 truncate font-medium text-zinc-200">{item.title}</span>
                <span className="shrink-0 text-[10px] text-zinc-500">
                  {[item.repo, item.actor, item.publishedAt ? item.publishedAt.slice(0, 10) : null].filter(Boolean).join(' · ')}
                </span>
                <StickyDeleteConfirm onConfirm={() => { void delFeedItem(item.id); }} className="shrink-0 self-center opacity-0 group-hover:opacity-100 text-rose-400" armAriaLabel={`Delete ${item.title}`} confirmLabel="Remove this DTU?" confirmAriaLabel={`Confirm delete ${item.title}`} armLabel={<Trash2 className="w-3 h-3" />} />
              </li>
            ))}
          </ul>
        )}
        {feedListMsg && <p role="alert" className="mt-1.5 text-[10px] text-rose-300">{feedListMsg}</p>}
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
              {r.note && <p className="text-[10px] text-zinc-500 italic truncate">{r.note}</p>}
              {editId === r.id && (
                <div className="mt-1.5 flex flex-wrap items-center gap-1.5">
                  <select aria-label={`Category for ${r.fullName}`} value={editForm.reason} onChange={e => setEditForm({ ...editForm, reason: e.target.value })}
                    className="bg-zinc-950 border border-zinc-800 rounded px-1.5 py-1 text-xs text-zinc-200">
                    {REASONS.map(x => <option key={x} value={x}>{x}</option>)}
                  </select>
                  <input aria-label={`Note for ${r.fullName}`} value={editForm.note} onChange={e => setEditForm({ ...editForm, note: e.target.value })} placeholder="Note (e.g. QA fixture name)"
                    className="flex-1 min-w-[120px] bg-zinc-950 border border-zinc-800 rounded px-2 py-1 text-xs text-zinc-200" />
                  <button onClick={() => void saveEdit(r.id)} className="px-2 py-1 text-xs rounded bg-violet-600 hover:bg-violet-500 text-white font-semibold">Save</button>
                  <button onClick={() => setEditId(null)} className="px-2 py-1 text-xs rounded bg-zinc-800 text-zinc-300">Cancel</button>
                </div>
              )}
            </div>
            <button onClick={() => { setEditId(editId === r.id ? null : r.id); setEditForm({ reason: r.reason, note: r.note || '' }); }} aria-label={`Edit ${r.fullName}`} className="text-zinc-400 hover:text-violet-300 text-[10px] font-semibold">
              Edit
            </button>
            <button onClick={() => refreshRepo(r.id)} disabled={busy === r.id} className="text-zinc-400 hover:text-violet-300">
              {busy === r.id ? <Loader2 className="w-3 h-3 animate-spin" /> : <RefreshCw className="w-3 h-3" />}
            </button>
            <StickyDeleteConfirm onConfirm={() => { void delRepo(r.id); }} className="opacity-0 group-hover:opacity-100 text-rose-400" armAriaLabel={`Delete ${r.fullName}`} confirmLabel={`Stop watching ${r.fullName}?`} confirmAriaLabel={`Confirm delete ${r.fullName}`} armLabel={<Trash2 className="w-3 h-3" />} />
          </li>
        ))}
      </ul>
    </div>
  );
}
