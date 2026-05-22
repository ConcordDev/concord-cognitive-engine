'use client';

/* eslint-disable @typescript-eslint/no-explicit-any */

/**
 * ResidueDetail — full investigation view for a single spectral residue.
 * Mounts ghost-hunt.detail (context + hints + map coords + reward) and the
 * multi-stage hunt chain (track → investigate → confront) driven by
 * ghost-hunt.advance and ghost-hunt.confront.
 */

import { useCallback, useEffect, useState } from 'react';
import { lensRun } from '@/lib/api/client';

const STAGE_LABEL: Record<string, string> = {
  track: 'Track',
  investigate: 'Investigate',
  confront: 'Confront',
  extinguished: 'Extinguished',
};

interface ResidueDetailData {
  id: string;
  drift_type: string;
  severity: string;
  signature: string;
  detected_at: number;
  context: Record<string, any>;
  coords: { x: number; z: number };
  worldId: string | null;
}

interface DetailResult {
  ok: boolean;
  residue?: ResidueDetailData;
  hints?: string[];
  difficulty?: number;
  potentialReward?: { xp: number; essence: number; title: string };
  stage?: string;
  stageIndex?: number;
  stages?: string[];
}

interface ConfrontResult {
  ok: boolean;
  result?: string;
  won?: boolean;
  winChance?: number;
  reward?: { xp: number; essence: number; title: string | null };
  stage?: string;
}

export function ResidueDetail({
  residueId,
  onClose,
  onChanged,
}: {
  residueId: string;
  onClose: () => void;
  onChanged: () => void;
}) {
  const [data, setData] = useState<DetailResult | null>(null);
  const [loading, setLoading] = useState(true);
  const [acting, setActing] = useState(false);
  const [lastConfront, setLastConfront] = useState<ConfrontResult | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    const r = await lensRun<DetailResult>('ghost-hunt', 'detail', { residueId });
    setData(r.data.result);
    setLoading(false);
  }, [residueId]);

  // eslint-disable-next-line react-hooks/exhaustive-deps
  useEffect(() => { load(); }, [residueId]);

  const advance = useCallback(async () => {
    setActing(true);
    await lensRun('ghost-hunt', 'advance', { residueId });
    await load();
    onChanged();
    setActing(false);
  }, [residueId, load, onChanged]);

  const confront = useCallback(async () => {
    setActing(true);
    const worldId = (typeof window !== 'undefined' && localStorage.getItem('concordia:activeWorldId')) || 'concordia-hub';
    const r = await lensRun<ConfrontResult>('ghost-hunt', 'confront', { residueId, worldId });
    setLastConfront(r.data.result);
    await load();
    onChanged();
    setActing(false);
  }, [residueId, load, onChanged]);

  const r = data?.residue;
  const stage = data?.stage || 'track';
  const stages = data?.stages || ['track', 'investigate', 'confront', 'extinguished'];
  const stageIndex = data?.stageIndex ?? 0;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 p-4" onClick={onClose}>
      <div
        className="max-h-[88vh] w-full max-w-2xl overflow-y-auto rounded-xl border border-violet-700/40 bg-[#0e1320] p-6 text-gray-100 shadow-2xl"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-start justify-between">
          <h2 className="text-xl font-semibold text-violet-300">Residue Investigation</h2>
          <button type="button" onClick={onClose} className="text-gray-500 hover:text-gray-200">✕</button>
        </div>

        {loading && <p className="mt-4 text-gray-500">Reading the residue…</p>}
        {!loading && !r && <p className="mt-4 text-rose-400">This residue could not be read.</p>}

        {!loading && r && (
          <>
            <div className="mt-4 grid grid-cols-2 gap-3 text-sm">
              <Field label="Drift type" value={r.drift_type} />
              <Field label="Severity" value={r.severity} />
              <Field label="Detected" value={new Date(r.detected_at * 1000).toLocaleString()} />
              <Field label="World" value={r.worldId || '—'} />
              <Field label="Difficulty" value={`${data?.difficulty ?? 1} / 4`} />
              <Field label="Map cell" value={`x ${r.coords.x} · z ${r.coords.z}`} />
            </div>

            <div className="mt-4">
              <div className="text-xs uppercase tracking-wide text-violet-400">Signature</div>
              <p className="mt-1 break-all rounded bg-black/40 p-2 font-mono text-xs text-gray-300">{r.signature}</p>
            </div>

            {Object.keys(r.context || {}).length > 0 && (
              <div className="mt-4">
                <div className="text-xs uppercase tracking-wide text-violet-400">Drift context</div>
                <pre className="mt-1 max-h-40 overflow-auto rounded bg-black/40 p-2 text-xs text-gray-400">
                  {JSON.stringify(r.context, null, 2)}
                </pre>
              </div>
            )}

            <div className="mt-4">
              <div className="text-xs uppercase tracking-wide text-violet-400">Investigation hints</div>
              <ul className="mt-1 space-y-1">
                {(data?.hints || []).map((h, i) => (
                  <li key={i} className="rounded border border-violet-700/20 bg-violet-900/10 px-3 py-2 text-sm text-gray-300">
                    {h}
                  </li>
                ))}
              </ul>
            </div>

            {/* Hunt progression chain */}
            <div className="mt-5">
              <div className="text-xs uppercase tracking-wide text-violet-400">Hunt progression</div>
              <div className="mt-2 flex items-center gap-2">
                {stages.map((s, i) => (
                  <div key={s} className="flex items-center">
                    <div
                      className={`rounded px-2.5 py-1 text-xs ${
                        i < stageIndex
                          ? 'bg-emerald-600/30 text-emerald-200 border border-emerald-500/40'
                          : i === stageIndex
                            ? 'bg-violet-600/40 text-violet-100 border border-violet-400/50'
                            : 'bg-white/5 text-gray-500 border border-white/10'
                      }`}
                    >
                      {STAGE_LABEL[s] || s}
                    </div>
                    {i < stages.length - 1 && <span className="mx-1 text-gray-600">→</span>}
                  </div>
                ))}
              </div>
            </div>

            {data?.potentialReward && (
              <div className="mt-4 rounded border border-amber-600/20 bg-amber-900/10 p-3 text-sm">
                <span className="text-amber-300">Potential reward:</span>{' '}
                <span className="text-gray-300">
                  {data.potentialReward.xp} XP · {data.potentialReward.essence} essence · title “{data.potentialReward.title}”
                </span>
              </div>
            )}

            {lastConfront && (
              <div
                className={`mt-4 rounded p-3 text-sm ${
                  lastConfront.won
                    ? 'border border-emerald-600/30 bg-emerald-900/15 text-emerald-200'
                    : 'border border-rose-600/30 bg-rose-900/15 text-rose-200'
                }`}
              >
                {lastConfront.won ? 'Residue extinguished. ' : 'The residue resisted. '}
                Win chance was {Math.round((lastConfront.winChance || 0) * 100)}% · earned{' '}
                {lastConfront.reward?.xp ?? 0} XP{lastConfront.reward?.essence ? `, ${lastConfront.reward.essence} essence` : ''}.
              </div>
            )}

            <div className="mt-5 flex gap-2">
              {stage !== 'extinguished' && stage !== 'confront' && (
                <button
                  type="button"
                  disabled={acting}
                  onClick={advance}
                  className="rounded border border-violet-500/40 bg-violet-600/30 px-4 py-2 text-sm text-violet-100 hover:bg-violet-600/50 disabled:opacity-50"
                >
                  {stage === 'track' ? 'Begin investigation' : 'Ready to confront'}
                </button>
              )}
              {stage !== 'extinguished' && (
                <button
                  type="button"
                  disabled={acting}
                  onClick={confront}
                  className="rounded border border-rose-500/40 bg-rose-600/30 px-4 py-2 text-sm text-rose-100 hover:bg-rose-600/50 disabled:opacity-50"
                >
                  Confront residue
                </button>
              )}
              {stage === 'extinguished' && (
                <span className="rounded border border-emerald-500/40 bg-emerald-900/20 px-4 py-2 text-sm text-emerald-200">
                  This residue has been extinguished.
                </span>
              )}
            </div>
          </>
        )}
      </div>
    </div>
  );
}

function Field({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded border border-white/10 bg-white/5 px-3 py-2">
      <div className="text-[10px] uppercase tracking-wide text-gray-500">{label}</div>
      <div className="mt-0.5 text-gray-200">{value}</div>
    </div>
  );
}
