'use client';

/**
 * ReplayPanel — record a sequence of real combat hits (captured from the
 * live `combat:hit` socket the production pipeline emits), persist it through
 * the sandbox domain, and play it back frame by frame. The parent owns the
 * live hit stream; this panel collects, saves, and scrubs.
 */

import { useCallback, useEffect, useRef, useState } from 'react';
import { lensRun } from '@/lib/api/client';
import { Film, CircleDot, Save, Trash2, Loader2, Play, Pause, SkipBack, SkipForward } from 'lucide-react';

export interface ReplayFrame {
  t: number;
  kind: string;
  targetId: string;
  damage: number;
  isCrit?: boolean;
  heavy?: boolean;
}

interface ReplaySummary {
  id: string;
  name: string;
  frameCount: number;
  durationMs: number;
  totalDamage: number;
  hitCount: number;
  recordedAt: string;
}

export interface ReplayController {
  startRecording: () => void;
  pushFrame: (f: Omit<ReplayFrame, 't'>) => void;
  isRecording: () => boolean;
}

export function ReplayPanel({
  controllerRef,
  onPlayFrame,
}: {
  controllerRef: React.MutableRefObject<ReplayController | null>;
  onPlayFrame: (f: ReplayFrame, index: number) => void;
}) {
  const [recording, setRecording] = useState(false);
  const [frameCount, setFrameCount] = useState(0);
  const [name, setName] = useState('');
  const [saved, setSaved] = useState<ReplaySummary[]>([]);
  const [busy, setBusy] = useState(false);

  // Playback state
  const [activeFrames, setActiveFrames] = useState<ReplayFrame[] | null>(null);
  const [activeName, setActiveName] = useState('');
  const [cursor, setCursor] = useState(0);
  const [playing, setPlaying] = useState(false);

  const framesRef = useRef<ReplayFrame[]>([]);
  const recordStartRef = useRef(0);
  const playTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const refresh = useCallback(async () => {
    const r = await lensRun('sandbox', 'listReplays', {});
    if (r.data?.ok && r.data.result) setSaved((r.data.result.replays as ReplaySummary[]) || []);
  }, []);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  // Expose the recording controller to the parent page so its socket
  // handler can push real combat:hit events into the buffer.
  useEffect(() => {
    controllerRef.current = {
      startRecording: () => {
        framesRef.current = [];
        recordStartRef.current = performance.now();
        setFrameCount(0);
        setRecording(true);
      },
      pushFrame: (f) => {
        framesRef.current.push({ ...f, t: Math.round(performance.now() - recordStartRef.current) });
        setFrameCount(framesRef.current.length);
      },
      isRecording: () => framesRef.current.length >= 0 && recordStartRef.current > 0,
    };
    return () => {
      controllerRef.current = null;
    };
  }, [controllerRef]);

  const startRecording = () => {
    controllerRef.current?.startRecording();
  };

  const stopAndSave = async () => {
    setRecording(false);
    recordStartRef.current = 0;
    const frames = framesRef.current.slice();
    if (frames.length === 0) return;
    setBusy(true);
    try {
      const r = await lensRun('sandbox', 'saveReplay', { name: name.trim(), frames });
      if (r.data?.ok) {
        setName('');
        await refresh();
      }
    } finally {
      setBusy(false);
    }
  };

  const stopPlayback = useCallback(() => {
    if (playTimerRef.current) {
      clearTimeout(playTimerRef.current);
      playTimerRef.current = null;
    }
    setPlaying(false);
  }, []);

  const load = async (id: string, replayName: string) => {
    stopPlayback();
    const r = await lensRun('sandbox', 'getReplay', { replayId: id });
    if (r.data?.ok && r.data.result) {
      const frames = ((r.data.result.replay as { frames: ReplayFrame[] }).frames) || [];
      setActiveFrames(frames);
      setActiveName(replayName);
      setCursor(0);
    }
  };

  const remove = async (id: string) => {
    if (activeFrames && saved.find((s) => s.id === id)) {
      stopPlayback();
      setActiveFrames(null);
    }
    await lensRun('sandbox', 'deleteReplay', { replayId: id });
    await refresh();
  };

  // Frame-step controls.
  const stepTo = useCallback(
    (idx: number) => {
      if (!activeFrames || activeFrames.length === 0) return;
      const clamped = Math.max(0, Math.min(activeFrames.length - 1, idx));
      setCursor(clamped);
      onPlayFrame(activeFrames[clamped], clamped);
    },
    [activeFrames, onPlayFrame],
  );

  // Real-time playback at the recorded inter-frame intervals.
  useEffect(() => {
    if (!playing || !activeFrames) return;
    if (cursor >= activeFrames.length - 1) {
      setPlaying(false);
      return;
    }
    const cur = activeFrames[cursor];
    const next = activeFrames[cursor + 1];
    const delay = Math.max(0, Math.min(5000, next.t - cur.t));
    playTimerRef.current = setTimeout(() => {
      stepTo(cursor + 1);
    }, delay);
    return () => {
      if (playTimerRef.current) clearTimeout(playTimerRef.current);
    };
  }, [playing, cursor, activeFrames, stepTo]);

  useEffect(() => stopPlayback, [stopPlayback]);

  return (
    <div className="rounded-lg border border-slate-700/50 bg-slate-900/80 p-3 text-xs">
      <div className="mb-2 flex items-center gap-1.5 font-semibold uppercase tracking-wide text-amber-200">
        <Film className="h-3.5 w-3.5" /> Combat Replay
      </div>

      <div className="mb-2 flex items-center gap-1.5">
        {!recording ? (
          <button
            onClick={startRecording}
            className="flex items-center gap-1 rounded bg-rose-700 px-2 py-1 font-semibold hover:bg-rose-600"
          >
            <CircleDot className="h-3 w-3" /> Record combat
          </button>
        ) : (
          <>
            <input
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="Replay name"
              className="min-w-0 flex-1 rounded border border-slate-700 bg-slate-950 px-2 py-1 text-slate-100 placeholder:text-slate-600"
            />
            <button
              onClick={stopAndSave}
              disabled={busy}
              className="flex items-center gap-1 rounded bg-emerald-700 px-2 py-1 font-semibold hover:bg-emerald-600 disabled:opacity-40"
            >
              {busy ? <Loader2 className="h-3 w-3 animate-spin" /> : <Save className="h-3 w-3" />} Stop &amp; save
            </button>
          </>
        )}
      </div>
      {recording && (
        <div className="mb-2 rounded bg-rose-950/50 px-2 py-1 text-[10px] text-rose-300">
          Recording — {frameCount} combat hits captured.
        </div>
      )}

      {activeFrames && (
        <div className="mb-2 rounded border border-slate-700 bg-slate-950/60 p-2">
          <div className="mb-1 flex items-center justify-between">
            <span className="truncate font-semibold text-slate-200">{activeName}</span>
            <span className="tabular-nums text-[10px] text-slate-500">
              frame {activeFrames.length ? cursor + 1 : 0}/{activeFrames.length}
            </span>
          </div>
          <input
            type="range"
            min={0}
            max={Math.max(0, activeFrames.length - 1)}
            value={cursor}
            onChange={(e) => {
              stopPlayback();
              stepTo(Number(e.target.value));
            }}
            className="mb-1.5 w-full accent-amber-500"
            aria-label="Replay scrub"
          />
          <div className="mb-1.5 flex items-center gap-1.5">
            <button onClick={() => { stopPlayback(); stepTo(cursor - 1); }} aria-label="Previous frame" className="rounded bg-slate-700 p-1 hover:bg-slate-600">
              <SkipBack className="h-3 w-3" />
            </button>
            {playing ? (
              <button onClick={stopPlayback} aria-label="Pause" className="rounded bg-amber-600 p-1 hover:bg-amber-500">
                <Pause className="h-3 w-3" />
              </button>
            ) : (
              <button
                onClick={() => { if (cursor >= activeFrames.length - 1) stepTo(0); setPlaying(true); }}
                aria-label="Play"
                className="rounded bg-amber-600 p-1 hover:bg-amber-500"
                disabled={activeFrames.length === 0}
              >
                <Play className="h-3 w-3" />
              </button>
            )}
            <button onClick={() => { stopPlayback(); stepTo(cursor + 1); }} aria-label="Next frame" className="rounded bg-slate-700 p-1 hover:bg-slate-600">
              <SkipForward className="h-3 w-3" />
            </button>
          </div>
          {activeFrames[cursor] && (
            <div className="rounded bg-slate-800/60 px-2 py-1 text-[10px] tabular-nums text-slate-300">
              t+{activeFrames[cursor].t}ms · {activeFrames[cursor].kind} → {activeFrames[cursor].targetId} ·{' '}
              {Math.round(activeFrames[cursor].damage)} dmg
              {activeFrames[cursor].isCrit ? ' · crit' : ''}
              {activeFrames[cursor].heavy ? ' · heavy' : ''}
            </div>
          )}
        </div>
      )}

      {saved.length === 0 ? (
        <div className="rounded border border-dashed border-slate-700 px-2 py-2 text-center text-[10px] text-slate-500">
          No recorded replays yet.
        </div>
      ) : (
        <ul className="max-h-40 space-y-1 overflow-y-auto">
          {saved.map((r) => (
            <li key={r.id} className="flex items-center gap-1.5 rounded bg-slate-800/60 px-2 py-1">
              <button onClick={() => load(r.id, r.name)} className="min-w-0 flex-1 text-left hover:text-amber-200">
                <div className="truncate text-slate-200">{r.name}</div>
                <div className="text-[9px] tabular-nums text-slate-500">
                  {r.frameCount} frames · {(r.durationMs / 1000).toFixed(1)}s · {Math.round(r.totalDamage)} dmg
                </div>
              </button>
              <button onClick={() => remove(r.id)} aria-label="Delete replay" className="text-slate-500 hover:text-rose-400">
                <Trash2 className="h-3 w-3" />
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
