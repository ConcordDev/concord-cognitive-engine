'use client';

/**
 * CwSnapshotDiffPanel — pick a scene, take/list revision snapshots and
 * view a line-level diff between any snapshot and the live draft (or
 * another snapshot). The diff is computed by the `snapshot-diff` macro.
 */

import { useCallback, useEffect, useState } from 'react';
import { Loader2, Camera, GitCompare } from 'lucide-react';
import { lensRun } from '@/lib/api/client';
import { cn } from '@/lib/utils';

interface Scene { id: string; title: string; chapterId: string | null }
interface Snapshot { id: string; title: string; wordCount: number; takenAt: string }
interface DiffLine { type: 'equal' | 'added' | 'removed'; text: string }
interface Diff {
  fromLabel: string; toLabel: string;
  diff: DiffLine[];
  addedLines: number; removedLines: number; unchangedLines: number;
  fromWords: number; toWords: number; wordDelta: number;
}

const LINE_STYLE: Record<DiffLine['type'], string> = {
  equal: 'text-zinc-500',
  added: 'text-emerald-300 bg-emerald-950/40',
  removed: 'text-rose-300 bg-rose-950/40 line-through decoration-rose-700/60',
};
const LINE_MARK: Record<DiffLine['type'], string> = { equal: ' ', added: '+', removed: '-' };

export function CwSnapshotDiffPanel({ projectId }: { projectId: string }) {
  const [scenes, setScenes] = useState<Scene[]>([]);
  const [sceneId, setSceneId] = useState('');
  const [snapshots, setSnapshots] = useState<Snapshot[]>([]);
  const [fromId, setFromId] = useState('');
  const [toId, setToId] = useState('');
  const [diff, setDiff] = useState<Diff | null>(null);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);

  const loadScenes = useCallback(async () => {
    setLoading(true);
    const r = await lensRun('creative-writing', 'project-get', { id: projectId });
    const list = (r.data?.result?.scenes as Scene[]) || [];
    setScenes(list);
    setSceneId((prev) => (list.some((s) => s.id === prev) ? prev : list[0]?.id || ''));
    setLoading(false);
  }, [projectId]);

  const loadSnapshots = useCallback(async () => {
    if (!sceneId) { setSnapshots([]); setFromId(''); setToId(''); return; }
    const r = await lensRun('creative-writing', 'snapshot-list', { sceneId });
    const list = (r.data?.result?.snapshots as Snapshot[]) || [];
    setSnapshots(list);
    setFromId((prev) => (list.some((s) => s.id === prev) ? prev : list[0]?.id || ''));
    setToId((prev) => (list.some((s) => s.id === prev) ? prev : ''));
    setDiff(null);
  }, [sceneId]);

  useEffect(() => { void loadScenes(); }, [loadScenes]);
  useEffect(() => { void loadSnapshots(); }, [loadSnapshots]);

  const takeSnapshot = async () => {
    if (!sceneId) return;
    setBusy(true);
    await lensRun('creative-writing', 'snapshot-take', { sceneId });
    setBusy(false);
    await loadSnapshots();
  };

  const runDiff = async () => {
    if (!fromId) return;
    setBusy(true);
    const r = await lensRun('creative-writing', 'snapshot-diff', {
      fromId, toId: toId || undefined,
    });
    setDiff(r.data?.ok === false ? null : (r.data?.result as Diff));
    setBusy(false);
  };

  if (loading) {
    return <div className="flex items-center justify-center py-10 text-zinc-500"><Loader2 className="w-5 h-5 animate-spin" /></div>;
  }
  if (!scenes.length) {
    return <p className="text-[11px] text-zinc-500 italic py-8 text-center">No scenes yet. Add scenes in the Binder.</p>;
  }

  return (
    <div className="space-y-3">
      <section className="bg-zinc-900/70 border border-zinc-800 rounded-xl p-3 space-y-2.5">
        <div className="flex flex-wrap items-center gap-2">
          <select value={sceneId} onChange={(e) => setSceneId(e.target.value)}
            className="flex-1 min-w-[160px] bg-zinc-950 border border-zinc-700 rounded-lg px-2 py-1.5 text-xs text-zinc-100">
            {scenes.map((s) => <option key={s.id} value={s.id}>{s.title}</option>)}
          </select>
          <button type="button" onClick={takeSnapshot} disabled={busy || !sceneId}
            className="flex items-center gap-1 px-2.5 py-1.5 text-[11px] bg-amber-600 hover:bg-amber-500 disabled:opacity-40 text-white rounded-lg">
            <Camera className="w-3.5 h-3.5" /> Take snapshot
          </button>
        </div>
        {snapshots.length === 0 ? (
          <p className="text-[11px] text-zinc-500 italic">No snapshots for this scene yet. Take one to start versioning.</p>
        ) : (
          <div className="grid grid-cols-1 sm:grid-cols-[1fr_1fr_auto] gap-2 items-end">
            <label className="text-[11px] text-zinc-400">
              From snapshot
              <select value={fromId} onChange={(e) => setFromId(e.target.value)}
                className="mt-0.5 w-full bg-zinc-950 border border-zinc-700 rounded-lg px-2 py-1.5 text-xs text-zinc-100">
                {snapshots.map((s) => <option key={s.id} value={s.id}>{s.title} ({s.wordCount}w)</option>)}
              </select>
            </label>
            <label className="text-[11px] text-zinc-400">
              Compare against
              <select value={toId} onChange={(e) => setToId(e.target.value)}
                className="mt-0.5 w-full bg-zinc-950 border border-zinc-700 rounded-lg px-2 py-1.5 text-xs text-zinc-100">
                <option value="">Current draft</option>
                {snapshots.map((s) => <option key={s.id} value={s.id}>{s.title} ({s.wordCount}w)</option>)}
              </select>
            </label>
            <button type="button" onClick={runDiff} disabled={busy || !fromId}
              className="flex items-center gap-1 px-3 py-1.5 text-xs font-medium bg-zinc-800 hover:bg-zinc-700 disabled:opacity-40 text-zinc-100 rounded-lg">
              <GitCompare className="w-3.5 h-3.5" /> Diff
            </button>
          </div>
        )}
      </section>

      {diff && (
        <section className="bg-zinc-900/70 border border-zinc-800 rounded-xl p-3 space-y-2">
          <div className="flex flex-wrap items-center gap-2 text-[11px]">
            <span className="text-zinc-300 font-medium">{diff.fromLabel}</span>
            <span className="text-zinc-600">→</span>
            <span className="text-zinc-300 font-medium">{diff.toLabel}</span>
            <span className="ml-auto flex gap-2">
              <span className="text-emerald-400">+{diff.addedLines}</span>
              <span className="text-rose-400">−{diff.removedLines}</span>
              <span className="text-zinc-500">={diff.unchangedLines}</span>
              <span className={cn(diff.wordDelta >= 0 ? 'text-emerald-400' : 'text-rose-400')}>
                {diff.wordDelta >= 0 ? '+' : ''}{diff.wordDelta}w
              </span>
            </span>
          </div>
          <div className="bg-zinc-950 border border-zinc-800 rounded-lg p-2 max-h-80 overflow-auto font-mono text-[11px] leading-relaxed">
            {diff.diff.map((l, i) => (
              <div key={i} className={cn('whitespace-pre-wrap px-1 rounded', LINE_STYLE[l.type])}>
                <span className="select-none text-zinc-600 mr-1.5">{LINE_MARK[l.type]}</span>
                {l.text || ' '}
              </div>
            ))}
          </div>
        </section>
      )}
    </div>
  );
}
