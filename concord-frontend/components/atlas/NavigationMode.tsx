'use client';

/**
 * NavigationMode — real-time turn-by-turn navigation with re-routing.
 * Calls the `nav-start` / `nav-update` / `nav-status` / `nav-stop`
 * atlas macros. Starts a session for a route, then feeds the live
 * device GPS position (or a manually entered position) into nav-update,
 * which advances the step pointer and re-routes on off-route drift.
 *
 * Backend: atlas.nav-{start,update,status,stop} — OSRM, no key.
 */

import { useState, useEffect, useCallback, useRef } from 'react';
import {
  Loader2, Navigation, Square, LocateFixed, RefreshCw, Flag, ChevronRight,
} from 'lucide-react';
import { lensRun } from '@/lib/api/client';

type Mode = 'driving' | 'walking' | 'cycling';

interface NavStep {
  instruction: string;
  roadName: string;
  distanceMeters: number;
}

interface NavSession {
  id: string;
  mode: Mode;
  destination: { lat: number; lng: number };
  steps: NavStep[];
  totalDistanceMeters: number;
  currentStepIndex: number;
  progressMeters: number;
  rerouteCount: number;
  status: 'active' | 'arrived';
  startedAt: string;
}

interface NavUpdate {
  session: NavSession;
  rerouted: boolean;
  arrived: boolean;
  offRouteMeters?: number;
  remainingMeters?: number;
  remainingText?: string;
  nextStep?: NavStep | null;
}

function fmtMeters(m: number): string {
  return m >= 1000 ? `${(m / 1000).toFixed(1)} km` : `${Math.round(m)} m`;
}

export function NavigationMode() {
  const [startLat, setStartLat] = useState('');
  const [startLng, setStartLng] = useState('');
  const [endLat, setEndLat] = useState('');
  const [endLng, setEndLng] = useState('');
  const [mode, setMode] = useState<Mode>('driving');
  const [session, setSession] = useState<NavSession | null>(null);
  const [lastUpdate, setLastUpdate] = useState<NavUpdate | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const watchRef = useRef<number | null>(null);

  const stopWatch = useCallback(() => {
    if (watchRef.current != null && typeof navigator !== 'undefined' && navigator.geolocation) {
      navigator.geolocation.clearWatch(watchRef.current);
      watchRef.current = null;
    }
  }, []);

  useEffect(() => () => stopWatch(), [stopWatch]);

  // Load any existing session on mount.
  useEffect(() => {
    (async () => {
      try {
        const r = await lensRun<{ session: NavSession | null }>('atlas', 'nav-status', {});
        if (r.data?.ok && r.data.result?.session) setSession(r.data.result.session);
      } catch {
        /* no session */
      }
    })();
  }, []);

  const ready =
    [startLat, startLng, endLat, endLng].every((v) => v.trim() !== '' && Number.isFinite(Number(v)));

  const pushPosition = useCallback(async (lat: number, lng: number) => {
    try {
      const r = await lensRun<NavUpdate>('atlas', 'nav-update', { lat, lng });
      if (r.data?.ok && r.data.result) {
        setLastUpdate(r.data.result);
        setSession(r.data.result.session);
        if (r.data.result.arrived) stopWatch();
      } else {
        setError(r.data?.error || 'Position update failed.');
      }
    } catch {
      setError('Navigation service unreachable.');
    }
  }, [stopWatch]);

  async function start() {
    if (!ready) return;
    setLoading(true);
    setError(null);
    setLastUpdate(null);
    try {
      const r = await lensRun<{ session: NavSession }>('atlas', 'nav-start', {
        mode,
        waypoints: [
          { lat: Number(startLat), lng: Number(startLng) },
          { lat: Number(endLat), lng: Number(endLng) },
        ],
      });
      if (r.data?.ok && r.data.result) {
        setSession(r.data.result.session);
        // Begin tracking the device's live position.
        if (typeof navigator !== 'undefined' && navigator.geolocation) {
          watchRef.current = navigator.geolocation.watchPosition(
            (pos) => { void pushPosition(pos.coords.latitude, pos.coords.longitude); },
            () => { /* GPS unavailable — manual position entry still works */ },
            { enableHighAccuracy: true, maximumAge: 5000 },
          );
        }
      } else {
        setError(r.data?.error || 'Could not start navigation.');
      }
    } catch {
      setError('Navigation service unreachable.');
    }
    setLoading(false);
  }

  async function stop() {
    stopWatch();
    try {
      await lensRun('atlas', 'nav-stop', {});
    } catch {
      /* ignore */
    }
    setSession(null);
    setLastUpdate(null);
  }

  async function manualPosition() {
    if (!Number.isFinite(Number(startLat)) || !Number.isFinite(Number(startLng))) return;
    await pushPosition(Number(startLat), Number(startLng));
  }

  const progressPct = session && session.totalDistanceMeters > 0
    ? Math.min(100, Math.round((session.progressMeters / session.totalDistanceMeters) * 100))
    : 0;

  return (
    <div className="overflow-hidden rounded-xl border border-zinc-800 bg-zinc-950">
      <div className="border-b border-zinc-800 bg-zinc-900/60 p-3">
        <div className="flex items-center gap-2">
          <Navigation className="h-4 w-4 text-violet-400" />
          <span className="text-sm font-semibold text-white">Navigation mode</span>
        </div>

        {!session && (
          <>
            <div className="mt-3 flex items-center gap-1 rounded-lg border border-zinc-800 bg-zinc-950 p-1">
              {(['driving', 'walking', 'cycling'] as Mode[]).map((m) => (
                <button
                  key={m}
                  type="button"
                  onClick={() => setMode(m)}
                  className={`flex-1 rounded px-2 py-1.5 text-[11px] capitalize transition ${mode === m ? 'bg-violet-500/20 text-violet-200' : 'text-zinc-400 hover:bg-zinc-800/60 hover:text-zinc-200'}`}
                >
                  {m}
                </button>
              ))}
            </div>
            <div className="mt-3 grid grid-cols-2 gap-2">
              <input type="number" step="any" placeholder="Start lat" value={startLat} onChange={(e) => setStartLat(e.target.value)} className="rounded border border-zinc-800 bg-zinc-950 px-2 py-1.5 text-xs text-white placeholder:text-zinc-600 focus:border-violet-500/40 focus:outline-none" />
              <input type="number" step="any" placeholder="Start lng" value={startLng} onChange={(e) => setStartLng(e.target.value)} className="rounded border border-zinc-800 bg-zinc-950 px-2 py-1.5 text-xs text-white placeholder:text-zinc-600 focus:border-violet-500/40 focus:outline-none" />
              <input type="number" step="any" placeholder="Dest lat" value={endLat} onChange={(e) => setEndLat(e.target.value)} className="rounded border border-zinc-800 bg-zinc-950 px-2 py-1.5 text-xs text-white placeholder:text-zinc-600 focus:border-violet-500/40 focus:outline-none" />
              <input type="number" step="any" placeholder="Dest lng" value={endLng} onChange={(e) => setEndLng(e.target.value)} className="rounded border border-zinc-800 bg-zinc-950 px-2 py-1.5 text-xs text-white placeholder:text-zinc-600 focus:border-violet-500/40 focus:outline-none" />
            </div>
            <button
              type="button"
              onClick={start}
              disabled={loading || !ready}
              className="mt-3 inline-flex w-full items-center justify-center gap-1.5 rounded-md bg-violet-500 px-3 py-2 text-xs font-semibold text-white hover:bg-violet-400 disabled:opacity-50"
            >
              {loading ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Navigation className="h-3.5 w-3.5" />}
              Start navigation
            </button>
          </>
        )}

        {session && (
          <div className="mt-3 flex items-center gap-2">
            <button
              type="button"
              onClick={manualPosition}
              className="inline-flex items-center gap-1.5 rounded bg-violet-500/20 px-2.5 py-1.5 text-[11px] text-violet-200 hover:bg-violet-500/30"
            >
              <LocateFixed className="h-3.5 w-3.5" /> Push position
            </button>
            <button
              type="button"
              onClick={stop}
              className="ml-auto inline-flex items-center gap-1.5 rounded bg-rose-500/15 px-2.5 py-1.5 text-[11px] text-rose-300 hover:bg-rose-500/25"
            >
              <Square className="h-3.5 w-3.5" /> End
            </button>
          </div>
        )}
      </div>

      <div className="p-3">
        {error && (
          <div className="mb-2 rounded border border-rose-500/30 bg-rose-500/10 px-3 py-2 text-xs text-rose-200">{error}</div>
        )}
        {!session && !error && !loading && (
          <div className="rounded border border-dashed border-zinc-800 p-6 text-center text-[11px] text-zinc-500">
            No data yet. Enter a start and destination to begin a live navigation session.
            Device GPS feeds positions automatically; "Push position" sends the start coordinates manually.
          </div>
        )}
        {session && (
          <div className="space-y-3">
            {session.status === 'arrived' ? (
              <div className="flex items-center gap-2 rounded-lg border border-emerald-500/30 bg-emerald-500/10 px-3 py-3 text-sm text-emerald-200">
                <Flag className="h-4 w-4" /> You have arrived at your destination.
              </div>
            ) : (
              <div className="rounded-lg border border-violet-500/30 bg-violet-500/5 p-3">
                <p className="text-[10px] uppercase tracking-wider text-zinc-500">Next instruction</p>
                <p className="mt-1 text-sm capitalize text-white">
                  {lastUpdate?.nextStep?.instruction || session.steps[session.currentStepIndex]?.instruction || 'Proceed to route'}
                </p>
                {(lastUpdate?.nextStep?.roadName || session.steps[session.currentStepIndex]?.roadName) && (
                  <p className="text-[11px] text-zinc-400">
                    on {lastUpdate?.nextStep?.roadName || session.steps[session.currentStepIndex]?.roadName}
                  </p>
                )}
              </div>
            )}

            <div>
              <div className="mb-1 flex items-center justify-between text-[10px] text-zinc-500">
                <span>{fmtMeters(session.progressMeters)} done</span>
                <span>{lastUpdate?.remainingText ? `${lastUpdate.remainingText} left` : `${fmtMeters(session.totalDistanceMeters)} total`}</span>
              </div>
              <div className="h-2 overflow-hidden rounded-full bg-zinc-800">
                <div className="h-full bg-violet-500 transition-all" style={{ width: `${progressPct}%` }} />
              </div>
            </div>

            <div className="grid grid-cols-3 gap-2">
              <div className="rounded border border-zinc-800 bg-zinc-900/40 p-2 text-center">
                <p className="font-mono text-sm text-white capitalize">{session.mode}</p>
                <p className="text-[9px] text-zinc-500">Mode</p>
              </div>
              <div className="rounded border border-zinc-800 bg-zinc-900/40 p-2 text-center">
                <p className="font-mono text-sm text-white">{session.rerouteCount}</p>
                <p className="text-[9px] text-zinc-500">Reroutes</p>
              </div>
              <div className="rounded border border-zinc-800 bg-zinc-900/40 p-2 text-center">
                <p className="font-mono text-sm text-white">{progressPct}%</p>
                <p className="text-[9px] text-zinc-500">Progress</p>
              </div>
            </div>

            {lastUpdate?.rerouted && (
              <div className="flex items-center gap-1.5 rounded border border-amber-500/30 bg-amber-500/10 px-2.5 py-1.5 text-[11px] text-amber-200">
                <RefreshCw className="h-3.5 w-3.5" /> Off-route — recalculated a new route to your destination.
              </div>
            )}

            <div className="space-y-1">
              <div className="text-[10px] uppercase tracking-wider text-zinc-500">Upcoming steps</div>
              {session.steps.slice(session.currentStepIndex, session.currentStepIndex + 6).map((step, i) => (
                <div key={i} className="flex items-start gap-2 rounded border border-zinc-800 bg-zinc-900/40 px-2.5 py-1.5">
                  <ChevronRight className={`mt-0.5 h-3.5 w-3.5 shrink-0 ${i === 0 ? 'text-violet-400' : 'text-zinc-600'}`} />
                  <div className="flex-1 text-[11px]">
                    <div className="capitalize text-zinc-100">{step.instruction}</div>
                    <div className="text-[10px] text-zinc-500">
                      {step.roadName && <span>{step.roadName} · </span>}{fmtMeters(step.distanceMeters)}
                    </div>
                  </div>
                </div>
              ))}
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
