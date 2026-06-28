'use client';

/**
 * SnapshotPanel — capture, list, open and delete shareable cognitive
 * snapshots. Wires the cognitive-replay.snapshot-{create,list,get,delete}
 * macros. A snapshot freezes the aggregate at capture time so a share
 * link always shows the same numbers.
 */

import { useEffect, useState, useCallback } from 'react';
import { Loader2, Camera, Share2, Trash2, Check } from 'lucide-react';
import { lensRun } from '@/lib/api/client';

interface SnapshotStats {
  turns: number; sessions: number; totalTokens: number;
  totalCitations: number; topBrain: { brain: string; turns: number } | null;
  busiestDay: { day: string; turns: number } | null;
}
interface Snapshot {
  shareId: string;
  title: string;
  createdAt: number;
  sinceDays: number;
  stats: SnapshotStats;
}

export function SnapshotPanel({ sinceDays }: { sinceDays: number }) {
  const [list, setList] = useState<Snapshot[]>([]);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [copied, setCopied] = useState<string | null>(null);
  const [opened, setOpened] = useState<Snapshot | null>(null);

  const refresh = useCallback(async () => {
    setLoading(true);
    setError(null);
    const r = await lensRun<{ snapshots: Snapshot[] }>('cognitive-replay', 'snapshot-list', {});
    if (r.data.ok && r.data.result) setList(r.data.result.snapshots);
    else setError(r.data.error || 'failed to load snapshots');
    setLoading(false);
  }, []);

  useEffect(() => { refresh(); }, [refresh]);

  const create = useCallback(async () => {
    setBusy(true);
    setError(null);
    const r = await lensRun<{ shareId: string }>('cognitive-replay', 'snapshot-create', { sinceDays });
    if (r.data.ok) await refresh();
    else setError(r.data.error || 'snapshot failed');
    setBusy(false);
  }, [sinceDays, refresh]);

  const remove = useCallback(async (shareId: string) => {
    const r = await lensRun('cognitive-replay', 'snapshot-delete', { shareId });
    if (r.data.ok) await refresh();
    else setError(r.data.error || 'delete failed');
  }, [refresh]);

  const open = useCallback(async (shareId: string) => {
    const r = await lensRun<{ snapshot: Snapshot }>('cognitive-replay', 'snapshot-get', { shareId });
    if (r.data.ok && r.data.result) setOpened(r.data.result.snapshot);
    else setError(r.data.error || 'snapshot not found');
  }, []);

  const share = useCallback((shareId: string) => {
    const url = `${window.location.origin}/lenses/cognitive-replay?snapshot=${shareId}`;
    if (navigator.clipboard) {
      navigator.clipboard.writeText(url).then(() => {
        setCopied(shareId);
        setTimeout(() => setCopied(null), 1800);
      }).catch(() => { /* clipboard unavailable */ });
    }
  }, []);

  return (
    <div className="space-y-3">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          <Camera className="h-4 w-4 text-cyan-400" />
          <h2 className="text-sm font-semibold text-zinc-100">Shareable snapshots</h2>
        </div>
        <button
          onClick={create}
          disabled={busy}
          className="flex items-center gap-1.5 rounded-md border border-cyan-500/40 bg-cyan-500/10 px-2.5 py-1 text-[11px] font-medium text-cyan-200 hover:bg-cyan-500/20 disabled:opacity-50"
        >
          {busy ? <Loader2 className="h-3 w-3 animate-spin" /> : <Camera className="h-3 w-3" />}
          Capture last {sinceDays}d
        </button>
      </div>
      {error && (
        <div role="alert" className="flex items-center justify-between gap-3 rounded border border-rose-500/20 bg-rose-500/5 px-3 py-2 text-xs text-rose-300">
          <span>{error}</span>
          <button onClick={refresh} className="rounded border border-rose-500/40 px-2 py-0.5 font-medium text-rose-100 hover:bg-rose-500/20">Retry</button>
        </div>
      )}

      {opened && (
        <div className="rounded-xl border border-cyan-500/30 bg-cyan-500/5 p-3">
          <div className="flex items-center justify-between">
            <div className="text-xs font-semibold text-cyan-200">{opened.title}</div>
            <button onClick={() => setOpened(null)} className="text-[11px] text-zinc-400 hover:text-zinc-200">close</button>
          </div>
          <div className="mt-2 grid grid-cols-2 gap-2 text-[11px] text-zinc-300 sm:grid-cols-4">
            <span>{opened.stats.turns} turns</span>
            <span>{opened.stats.totalTokens.toLocaleString()} tokens</span>
            <span>top: {opened.stats.topBrain?.brain || '—'}</span>
            <span>{opened.stats.totalCitations} citations</span>
          </div>
        </div>
      )}

      {loading ? (
        <div role="status" aria-live="polite" className="flex items-center gap-2 text-xs text-zinc-400"><Loader2 className="h-4 w-4 animate-spin" /> Loading snapshots…</div>
      ) : list.length === 0 ? (
        <div className="rounded-lg border border-zinc-800 bg-zinc-950/40 p-4 text-xs text-zinc-400">No snapshots yet. Capture one to share your cognitive week.</div>
      ) : (
        <ul className="space-y-1.5">
          {list.map((s) => (
            <li key={s.shareId} className="flex items-center gap-2 rounded-lg border border-zinc-800 bg-zinc-950/60 p-2.5">
              <button onClick={() => open(s.shareId)} className="flex-1 min-w-0 text-left">
                <div className="truncate text-xs font-medium text-zinc-200">{s.title}</div>
                <div className="font-mono text-[10px] text-zinc-400">
                  {new Date(s.createdAt).toLocaleString()} · {s.stats.turns} turns · {s.stats.totalTokens.toLocaleString()} tok
                </div>
              </button>
              <button
                onClick={() => share(s.shareId)}
                title="Copy share link"
                className="rounded p-1 text-zinc-400 hover:text-cyan-400"
              >
                {copied === s.shareId ? <Check className="h-3.5 w-3.5 text-emerald-400" /> : <Share2 className="h-3.5 w-3.5" />}
              </button>
              <button
                onClick={() => remove(s.shareId)}
                title="Delete snapshot"
                className="rounded p-1 text-zinc-400 hover:text-rose-400"
              >
                <Trash2 className="h-3.5 w-3.5" />
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
