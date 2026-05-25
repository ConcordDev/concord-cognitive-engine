'use client';

/**
 * TelemetryOverlay — measures combat-feel numerically. A live frame-time
 * meter (driven by requestAnimationFrame) plus a hitstop tracker (driven by
 * the `concordia:hit-pause` window event the GameJuice layer dispatches).
 * A session can be recorded and persisted via the sandbox domain so feel
 * passes can be compared over time.
 */

import { useCallback, useEffect, useRef, useState } from 'react';
import { lensRun } from '@/lib/api/client';
import { ChartKit } from '@/components/viz/ChartKit';
import { Activity, CircleDot, Save, Loader2, Trash2 } from 'lucide-react';

interface TelemetrySample {
  id: string;
  name: string;
  frameCount: number;
  avgFrameMs: number;
  minFrameMs: number;
  maxFrameMs: number;
  p95FrameMs: number;
  avgFps: number;
  jankFrames: number;
  hitstopCount: number;
  avgHitstopMs: number;
  maxHitstopMs: number;
  recordedAt: string;
}
interface TelemetryOverall {
  sessions: number;
  avgFps: number;
  avgFrameMs: number;
  worstP95Ms: number;
  totalJankFrames: number;
  avgHitstopMs: number;
}

const HISTORY = 90; // frame-times kept for the rolling sparkline

export function TelemetryOverlay() {
  const [recording, setRecording] = useState(false);
  const [liveFps, setLiveFps] = useState(0);
  const [liveFrameMs, setLiveFrameMs] = useState(0);
  const [history, setHistory] = useState<number[]>([]);
  const [samples, setSamples] = useState<TelemetrySample[]>([]);
  const [overall, setOverall] = useState<TelemetryOverall | null>(null);
  const [name, setName] = useState('');
  const [busy, setBusy] = useState(false);

  const rafRef = useRef<number | null>(null);
  const lastTsRef = useRef(0);
  const framesRef = useRef<number[]>([]);
  const hitstopsRef = useRef<number[]>([]);

  const refresh = useCallback(async () => {
    const r = await lensRun('sandbox', 'telemetryStats', {});
    if (r.data?.ok && r.data.result) {
      setSamples((r.data.result.samples as TelemetrySample[]) || []);
      setOverall((r.data.result.overall as TelemetryOverall | null) ?? null);
    }
  }, []);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  // Frame-time meter: always running so the live readout is honest; the
  // record buffer only fills while `recording` is true.
  useEffect(() => {
    const tick = (ts: number) => {
      if (lastTsRef.current > 0) {
        const dt = ts - lastTsRef.current;
        if (dt > 0 && dt < 1000) {
          setLiveFrameMs(Math.round(dt * 10) / 10);
          setLiveFps(Math.round(1000 / dt));
          setHistory((prev) => [...prev.slice(-(HISTORY - 1)), dt]);
          if (recording) framesRef.current.push(dt);
        }
      }
      lastTsRef.current = ts;
      rafRef.current = requestAnimationFrame(tick);
    };
    rafRef.current = requestAnimationFrame(tick);
    return () => {
      if (rafRef.current !== null) cancelAnimationFrame(rafRef.current);
    };
  }, [recording]);

  // Hitstop tracker: GameJuice dispatches `concordia:hit-pause` with a
  // numeric `ms` detail when a heavy/crit/kill freezes the scene.
  useEffect(() => {
    const onPause = (e: Event) => {
      if (!recording) return;
      const ms = Number((e as CustomEvent).detail?.ms);
      if (Number.isFinite(ms) && ms >= 0) hitstopsRef.current.push(ms);
    };
    window.addEventListener('concordia:hit-pause', onPause as EventListener);
    return () => window.removeEventListener('concordia:hit-pause', onPause as EventListener);
  }, [recording]);

  const startRecording = () => {
    framesRef.current = [];
    hitstopsRef.current = [];
    setRecording(true);
  };

  const stopAndSave = async () => {
    setRecording(false);
    const frameTimes = framesRef.current.slice();
    if (frameTimes.length === 0) return;
    setBusy(true);
    try {
      const r = await lensRun('sandbox', 'recordTelemetry', {
        name: name.trim(),
        frameTimes,
        hitstops: hitstopsRef.current.slice(),
      });
      if (r.data?.ok) {
        setName('');
        await refresh();
      }
    } finally {
      setBusy(false);
    }
  };

  const remove = async (id: string) => {
    await lensRun('sandbox', 'deleteTelemetry', { sampleId: id });
    await refresh();
  };

  const sparkData = history.map((ms, i) => ({ i, ms: Math.round(ms * 10) / 10 }));

  return (
    <div className="rounded-lg border border-slate-700/50 bg-slate-900/80 p-3 text-xs">
      <div className="mb-2 flex items-center gap-1.5 font-semibold uppercase tracking-wide text-amber-200">
        <Activity className="h-3.5 w-3.5" /> Frame Telemetry
      </div>

      <div className="mb-2 grid grid-cols-2 gap-2">
        <div className="rounded bg-slate-800/60 px-2 py-1.5">
          <div className="text-[9px] uppercase text-slate-400">Live FPS</div>
          <div className={`text-lg font-bold tabular-nums ${liveFps >= 55 ? 'text-emerald-300' : liveFps >= 30 ? 'text-amber-300' : 'text-rose-300'}`}>
            {liveFps || '—'}
          </div>
        </div>
        <div className="rounded bg-slate-800/60 px-2 py-1.5">
          <div className="text-[9px] uppercase text-slate-400">Frame ms</div>
          <div className="text-lg font-bold tabular-nums text-slate-200">{liveFrameMs || '—'}</div>
        </div>
      </div>

      <div className="mb-2">
        <ChartKit
          kind="area"
          data={sparkData}
          xKey="i"
          series={[{ key: 'ms', label: 'frame ms', color: '#f59e0b' }]}
          height={90}
          showLegend={false}
          showGrid={false}
        />
      </div>

      <div className="mb-2 flex items-center gap-1.5">
        {!recording ? (
          <button
            onClick={startRecording}
            className="flex items-center gap-1 rounded bg-rose-700 px-2 py-1 font-semibold hover:bg-rose-600"
          >
            <CircleDot className="h-3 w-3" /> Record session
          </button>
        ) : (
          <>
            <input
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="Session name"
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
          Recording — {framesRef.current.length} frames, {hitstopsRef.current.length} hitstops captured.
        </div>
      )}

      {overall && (
        <div className="mb-2 rounded bg-slate-800/40 px-2 py-1.5 text-[10px] text-slate-300">
          <div className="mb-0.5 font-semibold text-slate-200">{overall.sessions} recorded sessions</div>
          <div className="grid grid-cols-2 gap-x-2 gap-y-0.5 tabular-nums">
            <span>avg FPS <b className="text-slate-100">{overall.avgFps}</b></span>
            <span>worst p95 <b className="text-slate-100">{overall.worstP95Ms}ms</b></span>
            <span>jank frames <b className="text-slate-100">{overall.totalJankFrames}</b></span>
            <span>avg hitstop <b className="text-slate-100">{overall.avgHitstopMs}ms</b></span>
          </div>
        </div>
      )}

      {samples.length === 0 ? (
        <div className="rounded border border-dashed border-slate-700 px-2 py-2 text-center text-[10px] text-slate-400">
          No recorded sessions yet.
        </div>
      ) : (
        <ul className="max-h-40 space-y-1 overflow-y-auto">
          {samples.map((s) => (
            <li key={s.id} className="flex items-center gap-1.5 rounded bg-slate-800/60 px-2 py-1">
              <div className="min-w-0 flex-1">
                <div className="truncate text-slate-200">{s.name}</div>
                <div className="text-[9px] tabular-nums text-slate-400">
                  {s.avgFps} fps · p95 {s.p95FrameMs}ms · {s.jankFrames} jank · {s.hitstopCount} hitstops
                </div>
              </div>
              <button onClick={() => remove(s.id)} aria-label="Delete telemetry sample" className="text-slate-400 hover:text-rose-400">
                <Trash2 className="h-3 w-3" />
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
