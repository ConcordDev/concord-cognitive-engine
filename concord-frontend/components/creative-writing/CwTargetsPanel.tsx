'use client';

/**
 * CwTargetsPanel — per-document (scene) word-count targets plus the
 * rolled-up project progress bar. Each scene gets an editable target;
 * `target-progress` reports word count vs. target and project total.
 */

import { useCallback, useEffect, useState } from 'react';
import { Loader2, Target, Check } from 'lucide-react';
import { lensRun } from '@/lib/api/client';
import { cn } from '@/lib/utils';

interface DocProgress {
  sceneId: string; title: string; chapterId: string | null;
  wordCount: number; targetWords: number;
  progressPct: number | null; met: boolean | null;
}
interface Progress {
  documents: DocProgress[];
  totalWords: number;
  projectTarget: number;
  projectProgressPct: number | null;
  docsWithTargets: number;
  docsMet: number;
  sceneTargetSum: number;
}

export function CwTargetsPanel({ projectId }: { projectId: string }) {
  const [progress, setProgress] = useState<Progress | null>(null);
  const [loading, setLoading] = useState(true);
  const [edits, setEdits] = useState<Record<string, string>>({});
  const [savingId, setSavingId] = useState<string | null>(null);

  const refresh = useCallback(async () => {
    setLoading(true);
    const r = await lensRun('creative-writing', 'target-progress', { projectId });
    const res = (r.data?.result as Progress | null) || null;
    setProgress(res);
    setEdits(Object.fromEntries((res?.documents || []).map((d) => [d.sceneId, String(d.targetWords || '')])));
    setLoading(false);
  }, [projectId]);

  useEffect(() => { void refresh(); }, [refresh]);

  const saveTarget = async (sceneId: string) => {
    setSavingId(sceneId);
    await lensRun('creative-writing', 'scene-set-target', {
      sceneId, targetWords: Number(edits[sceneId]) || 0,
    });
    setSavingId(null);
    await refresh();
  };

  if (loading || !progress) {
    return <div className="flex items-center justify-center py-10 text-zinc-400"><Loader2 className="w-5 h-5 animate-spin" /></div>;
  }

  return (
    <div className="space-y-4">
      {/* Project progress bar */}
      <div className="bg-zinc-900/70 border border-zinc-800 rounded-xl p-3">
        <div className="flex items-center justify-between mb-1.5">
          <span className="flex items-center gap-1 text-xs font-semibold text-zinc-300">
            <Target className="w-3.5 h-3.5 text-amber-400" /> Project progress
          </span>
          <span className="text-[11px] text-zinc-400">
            {progress.totalWords.toLocaleString()}{progress.projectTarget > 0 && ` / ${progress.projectTarget.toLocaleString()}`} words
          </span>
        </div>
        {progress.projectTarget > 0 ? (
          <div className="h-2.5 rounded-full bg-zinc-800 overflow-hidden">
            <div className={cn('h-full rounded-full', (progress.projectProgressPct || 0) >= 100 ? 'bg-emerald-500' : 'bg-amber-500')}
              style={{ width: `${Math.min(100, progress.projectProgressPct || 0)}%` }} />
          </div>
        ) : (
          <p className="text-[10px] text-zinc-400">Set a project word target in the Manuscript Studio header.</p>
        )}
        <p className="text-[10px] text-zinc-400 mt-1.5">
          {progress.docsMet} of {progress.docsWithTargets} scene targets met ·
          {' '}{progress.sceneTargetSum.toLocaleString()} words across scene targets
        </p>
      </div>

      {/* Per-scene targets */}
      {progress.documents.length === 0 ? (
        <p className="text-[11px] text-zinc-400 italic py-6 text-center">No scenes yet. Add scenes in the Binder.</p>
      ) : (
        <ul className="space-y-1.5">
          {progress.documents.map((d) => {
            const pct = d.progressPct;
            return (
              <li key={d.sceneId} className="bg-zinc-900/70 border border-zinc-800 rounded-xl p-2.5 space-y-1.5">
                <div className="flex items-center gap-2">
                  <span className="flex-1 truncate text-xs font-medium text-zinc-100">{d.title}</span>
                  {d.met === true && <Check className="w-3.5 h-3.5 text-emerald-400" />}
                  <span className="text-[11px] text-zinc-400">{d.wordCount.toLocaleString()}w</span>
                  <input
                    inputMode="numeric"
                    placeholder="target"
                    value={edits[d.sceneId] ?? ''}
                    onChange={(e) => setEdits({ ...edits, [d.sceneId]: e.target.value })}
                    className="w-20 bg-zinc-950 border border-zinc-700 rounded-lg px-2 py-1 text-[11px] text-zinc-100" />
                  <button type="button" onClick={() => saveTarget(d.sceneId)}
                    disabled={savingId === d.sceneId || (edits[d.sceneId] ?? '') === String(d.targetWords || '')}
                    className="px-2 py-1 text-[10px] bg-zinc-800 hover:bg-zinc-700 disabled:opacity-40 text-zinc-200 rounded-lg">
                    {savingId === d.sceneId ? '…' : 'Set'}
                  </button>
                </div>
                {pct != null && (
                  <div className="h-1.5 rounded-full bg-zinc-800 overflow-hidden">
                    <div className={cn('h-full rounded-full', d.met ? 'bg-emerald-500' : 'bg-amber-500')}
                      style={{ width: `${Math.min(100, pct)}%` }} />
                  </div>
                )}
                {pct != null && <p className="text-[10px] text-zinc-400">{pct}% of {d.targetWords.toLocaleString()}-word target</p>}
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}
