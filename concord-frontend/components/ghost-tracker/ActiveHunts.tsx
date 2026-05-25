'use client';

/**
 * ActiveHunts — surfaces every in-progress hunt for the calling user via
 * ghost-hunt.progress (no residueId → all hunts). Renders the multi-stage
 * track → investigate → confront chain so a hunter can resume any hunt.
 */

import { useCallback, useEffect, useState } from 'react';
import { lensRun } from '@/lib/api/client';

interface HuntRow {
  residueId: string;
  stage: string;
  stageIndex: number;
  startedAt: number;
}

interface ProgressResult {
  ok: boolean;
  hunts?: HuntRow[];
  count?: number;
  stages?: string[];
}

const STAGE_LABEL: Record<string, string> = {
  track: 'Track',
  investigate: 'Investigate',
  confront: 'Confront',
  extinguished: 'Extinguished',
};

export function ActiveHunts({
  refreshKey,
  onOpen,
}: {
  refreshKey: number;
  onOpen: (residueId: string) => void;
}) {
  const [hunts, setHunts] = useState<HuntRow[]>([]);
  const [stages, setStages] = useState<string[]>(['track', 'investigate', 'confront', 'extinguished']);
  const [loading, setLoading] = useState(true);

  const load = useCallback(async () => {
    setLoading(true);
    const r = await lensRun<ProgressResult>('ghost-hunt', 'progress', {});
    setHunts(r.data.result?.hunts ?? []);
    if (r.data.result?.stages) setStages(r.data.result.stages);
    setLoading(false);
  }, []);

  useEffect(() => { load(); }, [load, refreshKey]);

  if (loading) return <p className="text-xs text-gray-400">Loading hunts…</p>;
  if (hunts.length === 0) {
    return <p className="text-xs text-gray-400">No hunts in progress. Investigate a residue to begin one.</p>;
  }

  return (
    <ul className="space-y-2">
      {hunts.map((h) => (
        <li key={h.residueId} className="rounded border border-violet-700/25 bg-violet-900/10 p-2.5">
          <div className="flex items-center justify-between">
            <span className="font-mono text-[11px] text-gray-400">{h.residueId.slice(0, 16)}</span>
            <button
              type="button"
              onClick={() => onOpen(h.residueId)}
              className="rounded border border-violet-500/40 bg-violet-600/30 px-2 py-0.5 text-[11px] text-violet-100 hover:bg-violet-600/50"
            >
              Resume
            </button>
          </div>
          <div className="mt-1.5 flex items-center gap-1">
            {stages.map((s, i) => (
              <div key={s} className="flex items-center">
                <span
                  className={`rounded px-1.5 py-0.5 text-[10px] ${
                    i < h.stageIndex
                      ? 'bg-emerald-600/25 text-emerald-200'
                      : i === h.stageIndex
                        ? 'bg-violet-600/40 text-violet-100'
                        : 'bg-white/5 text-gray-600'
                  }`}
                >
                  {STAGE_LABEL[s] || s}
                </span>
                {i < stages.length - 1 && <span className="mx-0.5 text-gray-700">›</span>}
              </div>
            ))}
          </div>
        </li>
      ))}
    </ul>
  );
}
