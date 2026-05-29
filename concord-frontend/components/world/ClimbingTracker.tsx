'use client';

// Phase DB1 — Climbing tracker.
//
// Mounts in the top-left widget cluster (below resource bars). Polls
// /api/climbing/mine every 30s; queries the player's stamina state
// inline. When state === 'climbing', shows live altitude bar + current
// route progress + nearest top-route height to beat.
//
// Records the route on state transition (climbing → rest / exhausted)
// via /api/climbing/route. Server-side first_summit + cliff_master
// achievements consume the resulting climbing_routes rows.

import { useCallback, useEffect, useRef, useState } from 'react';
import { useRealtimeRefresh } from '@/hooks/useRealtimeRefresh';
import { Mountain, TrendingUp } from 'lucide-react';
import { milestoneJuice } from '@/lib/concordia/juice';

interface ClimbingRoute {
  id: string;
  world_id: string;
  start_y: number;
  end_y: number;
  peak_altitude: number;
  height_climbed: number;
  duration_s: number;
  completed_at: number;
}

interface TopRoute {
  id: string;
  user_id: string;
  peak_altitude: number;
  height_climbed: number;
  duration_s: number;
  completed_at: number;
}

interface StaminaState {
  state: string;
  remaining_pct: number;
}

interface Props {
  worldId: string;
  playerY: number;        // current avatar Y position (altitude)
}

const POLL_MS = 30_000;
const STATE_POLL_MS = 2_000;

export function ClimbingTracker({ worldId, playerY }: Props) {
  const [active, setActive] = useState(false);
  const [staminaPct, setStaminaPct] = useState(100);
  const [recentTop, setRecentTop] = useState<TopRoute | null>(null);
  const [routes, setRoutes] = useState<ClimbingRoute[]>([]);

  // Climb capture refs.
  const climbingRef = useRef<{
    startX: number; startY: number; startZ: number; startedAt: number; peakY: number;
  } | null>(null);

  // Poll player stamina state to detect climbing transitions.
  useEffect(() => {
    let cancelled = false;
    async function pollStamina() {
      try {
        const r = await fetch('/api/players/me/stamina', { credentials: 'include' });
        if (!r.ok) return;
        const j = await r.json() as { ok: boolean; stamina?: StaminaState };
        if (cancelled || !j?.ok || !j.stamina) return;
        const s = j.stamina;
        setStaminaPct(s.remaining_pct);
        const isClimb = s.state === 'climbing';
        setActive(prev => {
          // Entering climbing — capture start
          if (!prev && isClimb) {
            climbingRef.current = {
              startX: 0, startY: playerY, startZ: 0,
              startedAt: Date.now(),
              peakY: playerY,
            };
          }
          // Leaving climbing — record the route
          if (prev && !isClimb && climbingRef.current) {
            const c = climbingRef.current;
            const duration = Math.floor((Date.now() - c.startedAt) / 1000);
            const height = Math.max(0, c.peakY - c.startY);
            if (height >= 1) {  // ignore trivial climbs
              fetch('/api/climbing/route', {
                method: 'POST', credentials: 'include',
                headers: { 'content-type': 'application/json' },
                body: JSON.stringify({
                  worldId,
                  startX: c.startX, startY: c.startY, startZ: c.startZ,
                  endX: 0, endY: playerY, endZ: 0,
                  peakAltitude: c.peakY,
                  durationS: duration,
                }),
              }).catch(() => {});
              // Phase Z7 — celebrate the summit.
              if (height >= 8) milestoneJuice('ui_climb_summit');
            }
            climbingRef.current = null;
          }
          return isClimb;
        });
      } catch { /* swallow */ }
    }
    pollStamina();
    const t = setInterval(pollStamina, STATE_POLL_MS);
    return () => { cancelled = true; clearInterval(t); };
  }, [worldId, playerY]);

  // Track peak altitude during climb.
  useEffect(() => {
    if (active && climbingRef.current) {
      climbingRef.current.peakY = Math.max(climbingRef.current.peakY, playerY);
    }
  }, [active, playerY]);

  // Poll routes + top-route.
  const refresh = useCallback(async () => {
    try {
      const mine = await fetch('/api/climbing/mine', { credentials: 'include' }).then(r => r.ok ? r.json() : null);
      if (mine?.ok) setRoutes(mine.routes || []);
      const top = await fetch(`/api/climbing/world/${encodeURIComponent(worldId)}/top?limit=1`).then(r => r.ok ? r.json() : null);
      if (top?.ok && top.top?.[0]) setRecentTop(top.top[0]);
    } catch { /* network */ }
  }, [worldId]);

  // Push: a completed climb route refreshes the list instantly; slow backstop.
  useRealtimeRefresh(['climbing:route-completed'], refresh, { backstopMs: POLL_MS });

  // Don't show if not climbing AND no recent route to advertise.
  if (!active && routes.length === 0) return null;

  return (
    <div className="concordia-hud-fade rounded-md border border-stone-500/40 bg-zinc-950/85 p-2 text-stone-100 shadow-lg backdrop-blur">
      <div className="mb-1 flex items-center gap-1 text-[10px] uppercase tracking-wider text-stone-300/70">
        <Mountain size={11} />
        Climbing
      </div>

      {active ? (
        <>
          <div className="mb-1 flex items-baseline gap-2">
            <span className="text-[10px] text-stone-400">altitude</span>
            <span className="font-mono text-base font-semibold text-stone-100">{playerY.toFixed(1)}m</span>
          </div>
          {/* Stamina bar — gates climbing duration */}
          <div className="mb-1">
            <div className="h-1.5 overflow-hidden rounded bg-zinc-800">
              <div
                className={`h-full transition-all ${staminaPct < 20 ? 'bg-rose-500' : staminaPct < 50 ? 'bg-amber-500' : 'bg-emerald-500'}`}
                style={{ width: `${Math.max(0, Math.min(100, staminaPct))}%` }}
              />
            </div>
            <div className="mt-0.5 text-[9px] text-stone-500">stamina {staminaPct.toFixed(0)}%</div>
          </div>
          {climbingRef.current && (
            <div className="text-[10px] text-stone-300">
              this route: {Math.max(0, playerY - climbingRef.current.startY).toFixed(1)}m
            </div>
          )}
        </>
      ) : (
        <div className="text-[10px] text-stone-400">
          {routes.length} route{routes.length === 1 ? '' : 's'} climbed
        </div>
      )}

      {recentTop && (
        <div className="mt-1 flex items-center gap-1 border-t border-stone-700/50 pt-1 text-[9px] text-stone-400">
          <TrendingUp size={9} />
          <span>top: {recentTop.height_climbed.toFixed(0)}m</span>
        </div>
      )}
    </div>
  );
}
