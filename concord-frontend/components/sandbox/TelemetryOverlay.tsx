'use client';

/**
 * TelemetryOverlay — measures combat-feel numerically. A live frame-time
 * meter (driven by requestAnimationFrame) plus a hitstop tracker (driven by
 * the `concordia:hit-pause` window event the GameJuice layer dispatches).
 * A session can be recorded and persisted via the sandbox domain so feel
 * passes can be compared over time.
 *
 * Also renders a Street-Fighter-6/Tekken-practice-mode-style frame-data
 * timeline for the currently equipped weapon (startup/active/recovery +
 * parry/dodge windows), sourced live from `GET /api/combat/frame-data/:skillId`
 * (server/server.js, delegates to server/lib/combat-frame-data.js). See the
 * WEAPON_TO_FRAME_KIND note below for how the sandbox's weapon id is
 * resolved to a real backend frame envelope.
 */

import { useCallback, useEffect, useRef, useState } from 'react';
import { api, lensRun } from '@/lib/api/client';
import { ChartKit } from '@/components/viz/ChartKit';
import { Activity, CircleDot, Save, Loader2, Trash2, Zap, AlertTriangle } from 'lucide-react';

interface FrameData {
  skillId: string | null;
  name: string;
  kind: string;
  level: number;
  startup_ms: number;
  active_ms: number;
  recovery_ms: number;
  parry_window_ms: number;
  dodge_window_ms: number;
  combo_followups: Array<{ skillId: string; name: string }>;
}
type FrameDataStatus = 'idle' | 'loading' | 'error' | 'ready';

// The sandbox's fixed weapon catalog (server/domains/sandbox.js WEAPONS:
// fist/blade/pistol/staff/greataxe) doesn't share ids 1:1 with the backend's
// built-in frame-envelope vocabulary (server/lib/combat-frame-data.js
// KIND_FRAME_BASE: sword/axe/spear/bow/staff/fist/dagger/hammer). Two ids
// match exactly (fist, staff); the rest are routed to their nearest real
// weapon archetype so this panel always resolves a genuine backend-computed
// envelope instead of inventing one — every number rendered below is
// unmodified server output, this map only chooses which real envelope to
// ask for. `pistol` -> `bow` also matches design intent: both are ranged
// and report a zero parry window.
const WEAPON_TO_FRAME_KIND: Record<string, string> = {
  fist: 'fist',
  blade: 'sword',
  pistol: 'bow',
  staff: 'staff',
  greataxe: 'axe',
};

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

export function TelemetryOverlay({ weaponId }: { weaponId?: string }) {
  const [recording, setRecording] = useState(false);
  const [liveFps, setLiveFps] = useState(0);
  const [liveFrameMs, setLiveFrameMs] = useState(0);
  const [history, setHistory] = useState<number[]>([]);
  const [samples, setSamples] = useState<TelemetrySample[]>([]);
  const [overall, setOverall] = useState<TelemetryOverall | null>(null);
  const [name, setName] = useState('');
  const [busy, setBusy] = useState(false);

  const [frameData, setFrameData] = useState<FrameData | null>(null);
  const [frameStatus, setFrameStatus] = useState<FrameDataStatus>('idle');

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

  // Frame-data lookup: re-fetch the real backend envelope whenever the
  // equipped weapon changes. No weapon selected -> honest idle state, never
  // a fabricated/default frame table.
  useEffect(() => {
    if (!weaponId) {
      setFrameStatus('idle');
      setFrameData(null);
      return;
    }
    const kind = WEAPON_TO_FRAME_KIND[weaponId] || weaponId;
    let cancelled = false;
    setFrameStatus('loading');
    (async () => {
      try {
        const res = await api.get(`/api/combat/frame-data/${encodeURIComponent(kind)}`);
        if (cancelled) return;
        if (res.data?.ok && res.data.frameData) {
          setFrameData(res.data.frameData as FrameData);
          setFrameStatus('ready');
        } else {
          setFrameData(null);
          setFrameStatus('error');
        }
      } catch {
        if (!cancelled) {
          setFrameData(null);
          setFrameStatus('error');
        }
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [weaponId]);

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

  const frameTotal = frameData ? frameData.startup_ms + frameData.active_ms + frameData.recovery_ms : 0;
  const startupPct = frameTotal > 0 ? (frameData!.startup_ms / frameTotal) * 100 : 0;
  const activePct = frameTotal > 0 ? (frameData!.active_ms / frameTotal) * 100 : 0;
  const recoveryPct = frameTotal > 0 ? (frameData!.recovery_ms / frameTotal) * 100 : 0;

  return (
    <>
      {/* Street-Fighter-6/Tekken-practice-mode-style frame-data ruler for
          the currently equipped weapon. Real numbers from the backend
          envelope (server/lib/combat-frame-data.js) — no fabrication. */}
      <div className="rounded-lg border border-slate-700/50 bg-slate-900/80 p-3 text-xs">
        <div className="mb-2 flex items-center gap-1.5 font-semibold uppercase tracking-wide text-cyan-200">
          <Zap className="h-3.5 w-3.5" /> Frame Data
        </div>

        {frameStatus === 'idle' ? (
          <div className="rounded border border-dashed border-slate-700 px-2 py-2 text-center text-[10px] text-slate-400">
            Equip a weapon to see its frame data.
          </div>
        ) : frameStatus === 'loading' ? (
          <div
            className="h-16 animate-pulse rounded bg-slate-800/50"
            role="status"
            aria-busy="true"
            aria-label="Loading frame data"
          />
        ) : frameStatus === 'error' || !frameData ? (
          <div
            role="alert"
            className="flex items-center gap-1.5 rounded border border-dashed border-rose-700/50 px-2 py-2 text-[10px] text-rose-300"
          >
            <AlertTriangle className="h-3 w-3 shrink-0" /> No frame data for this weapon.
          </div>
        ) : (
          <div data-testid="frame-data-ready">
            <div className="mb-1 flex items-center justify-between text-[10px] text-slate-400">
              <span className="truncate text-slate-200">{frameData.name}</span>
              <span className="shrink-0">lvl {frameData.level}</span>
            </div>

            {/* Timeline bar: startup / active / recovery, proportional widths. */}
            <div
              className="mb-1.5 flex h-4 w-full overflow-hidden rounded bg-slate-950"
              role="img"
              aria-label={`Startup ${frameData.startup_ms}ms, active ${frameData.active_ms}ms, recovery ${frameData.recovery_ms}ms`}
            >
              <div className="bg-cyan-500/70" style={{ width: `${startupPct}%` }} title={`Startup ${frameData.startup_ms}ms`} />
              <div className="bg-amber-500/70" style={{ width: `${activePct}%` }} title={`Active ${frameData.active_ms}ms`} />
              <div className="bg-rose-500/70" style={{ width: `${recoveryPct}%` }} title={`Recovery ${frameData.recovery_ms}ms`} />
            </div>

            <div className="mb-2 grid grid-cols-3 gap-1 text-center text-[9px] tabular-nums text-slate-300">
              <div>
                <span className="block text-sm font-bold text-cyan-300">{frameData.startup_ms}</span>startup ms
              </div>
              <div>
                <span className="block text-sm font-bold text-amber-300">{frameData.active_ms}</span>active ms
              </div>
              <div>
                <span className="block text-sm font-bold text-rose-300">{frameData.recovery_ms}</span>recovery ms
              </div>
            </div>

            <div className="grid grid-cols-2 gap-1.5 text-[9px]">
              <div className="rounded bg-slate-800/60 px-1.5 py-1 text-center">
                <div className="uppercase text-emerald-300/70">parry window</div>
                <div className="tabular-nums text-emerald-100">
                  {frameData.parry_window_ms === 0 ? (
                    <span className="text-slate-500" title="Ranged weapons cannot parry">none</span>
                  ) : (
                    `${frameData.parry_window_ms}ms`
                  )}
                </div>
              </div>
              <div className="rounded bg-slate-800/60 px-1.5 py-1 text-center">
                <div className="uppercase text-violet-300/70">dodge window</div>
                <div className="tabular-nums text-violet-100">{frameData.dodge_window_ms}ms</div>
              </div>
            </div>
          </div>
        )}
      </div>

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
    </>
  );
}
