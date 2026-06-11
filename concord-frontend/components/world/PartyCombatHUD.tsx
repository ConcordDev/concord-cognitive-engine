'use client';

// Phase DB9 — Party combat HUD (OPTIONAL tactical RTwP layer).
//
// IMPORTANT: this is NOT the canonical combat surface. The canonical combat
// in Concordia is Skyrim-style action — keyboard input via
// CombatInputController (E/F/R/Q + Shift) → real-time socket events,
// driven by the procedural biomechanics + PD-motor pipeline in
// lib/concordia/combat-{biomechanics,motor-driver}.ts. No pause.
//
// This HUD only surfaces when the player is inside a `party_combat_sessions`
// row (a separate optional tactical-party substrate, mig 259). It polls
// /api/party-combat/active at 1Hz to detect that, then /tick + /state at
// 5Hz while active. Pause via setTimeScale(0) — same primitive as PhotoMode.
// If you never start a party-tactics session, this component renders null.

import { useCallback, useEffect, useRef, useState } from 'react';
import { useRealtimeRefresh } from '@/hooks/useRealtimeRefresh';
import { useClientConfig } from '@/hooks/useClientConfig';
import { Pause, Play, FastForward, Zap } from 'lucide-react';

interface Combatant {
  entity_id: string;
  entity_kind: string;
  team: string;
  hp: number;
  max_hp: number;
  next_action_at_ms: number;
  profile_name?: string;
}

interface Queued {
  entity_id: string;
  action_kind: string;
  payload_json?: string;
  queued_at_ms: number;
}

interface SessionState {
  id: string;
  world_id: string;
  mode: string;
  started_at_ms: number;
  ended_at_ms: number | null;
  time_scale: number;
  profile_name?: string;
  combatants: Combatant[];
  queued: Queued[];
}

export function PartyCombatHUD() {
  const _cfg = useClientConfig(); // E0 — server-tunable cadence
  const DISCOVERY_MS = _cfg.poll.partyCombatDiscMs;
  const TICK_MS = _cfg.poll.partyCombatTickMs;
  const [session, setSession] = useState<SessionState | null>(null);
  const [nowMs, setNowMs] = useState(Date.now());
  const tickRef = useRef<number | null>(null);

  // Discovery: a starting/changing party-combat session is pushed via
  // party-combat:state; we only backstop-poll while NOT yet in a session. Once a
  // session is active the 200ms tick loop below drives it (that's the combat
  // engine, not status polling).
  const discover = useCallback(async () => {
    try {
      const j = await fetch('/api/party-combat/active', { credentials: 'include' }).then(r => r.ok ? r.json() : null);
      setSession(j?.session || null);
    } catch { /* swallow */ }
  }, []);
  useRealtimeRefresh(['party-combat:state'], discover, { backstopMs: DISCOVERY_MS, enabled: !session });

  // Tick + resolve loop while in a session.
  useEffect(() => {
    if (!session?.id || session.ended_at_ms) return;
    const id = session.id;
    let cancelled = false;

    const loop = async () => {
      try {
        await fetch(`/api/party-combat/${id}/tick`, {
          method: 'POST', credentials: 'include',
          headers: { 'content-type': 'application/json' }, body: '{}',
        });
        const j = await fetch(`/api/party-combat/${id}/state`, { credentials: 'include' }).then(r => r.json());
        if (!cancelled && j?.ok) setSession(j.session);
      } catch { /* swallow */ }
      setNowMs(Date.now());
    };

    tickRef.current = window.setInterval(loop, TICK_MS) as unknown as number;
    return () => {
      cancelled = true;
      if (tickRef.current) clearInterval(tickRef.current);
    };
  }, [session?.id, session?.ended_at_ms, TICK_MS]);

  const setTimeScale = useCallback(async (scale: number) => {
    if (!session) return;
    await fetch(`/api/party-combat/${session.id}/time-scale`, {
      method: 'POST', credentials: 'include',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ scale }),
    });
  }, [session]);

  const queueAction = useCallback(async (actorId: string, kind: string, targetId?: string) => {
    if (!session) return;
    await fetch(`/api/party-combat/${session.id}/queue`, {
      method: 'POST', credentials: 'include',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ actorId, action: { kind, targetId } }),
    });
  }, [session]);

  if (!session || session.ended_at_ms) return null;

  const queuedByActor = new Map<string, Queued>();
  for (const q of session.queued) queuedByActor.set(q.entity_id, q);

  const playerCombatants = session.combatants.filter((c) => c.team === 'allies' || c.team === 'player');
  const enemyCombatants = session.combatants.filter((c) => c.team !== 'allies' && c.team !== 'player');
  const isPaused = session.time_scale === 0;

  return (
    <>
      {/* Top-center: HP bars per combatant */}
      <div className="pointer-events-none fixed inset-x-0 top-3 z-25 flex flex-col items-center gap-1">
        <div className="pointer-events-auto flex max-w-4xl flex-wrap items-center justify-center gap-1.5 rounded-lg border border-rose-500/40 bg-zinc-950/95 px-3 py-1.5 shadow-xl backdrop-blur">
          <span className="text-[10px] uppercase tracking-wider text-rose-300/70">RTwP combat</span>
          {[...playerCombatants, ...enemyCombatants].map((c) => {
            const hpPct = c.hp / Math.max(1, c.max_hp);
            const cdMs = Math.max(0, c.next_action_at_ms - nowMs);
            const cdSec = (cdMs / 1000).toFixed(1);
            const enemy = c.team !== 'allies' && c.team !== 'player';
            const queued = queuedByActor.get(c.entity_id);
            return (
              <div key={c.entity_id} className="flex w-32 flex-col gap-0.5">
                <div className="flex items-center justify-between text-[10px]">
                  <span className={enemy ? 'text-red-300' : 'text-emerald-300'}>
                    {c.entity_id.slice(0, 10)}
                  </span>
                  <span className="font-mono text-zinc-400">{c.hp}/{c.max_hp}</span>
                </div>
                <div className="relative h-1.5 overflow-hidden rounded bg-zinc-800">
                  <div
                    className={enemy ? 'h-full bg-red-500' : 'h-full bg-emerald-500'}
                    style={{ width: `${hpPct * 100}%` }}
                  />
                </div>
                <div className="flex items-center justify-between text-[9px]">
                  <span className="font-mono text-amber-300/70">CD {cdSec}s</span>
                  {queued && (
                    <span className="rounded bg-amber-500/30 px-1 text-amber-100">{queued.action_kind}</span>
                  )}
                </div>
              </div>
            );
          })}
        </div>
      </div>

      {/* Bottom-right: time-scale controls + queue panel */}
      <div className="concordia-hud-slide-right pointer-events-auto fixed bottom-36 right-4 z-25 w-64 rounded-lg border border-rose-500/40 bg-zinc-950/95 p-2 shadow-xl backdrop-blur">
        <header className="mb-1 flex items-center gap-1 text-[10px] uppercase tracking-wider text-rose-300/70">
          <Zap size={11} />
          combat tempo · {session.time_scale.toFixed(2)}×
        </header>
        <div className="mb-2 grid grid-cols-4 gap-1">
          <button
            onClick={() => setTimeScale(0)}
            className={['rounded px-1 py-1 text-[10px]', isPaused ? 'bg-rose-500/50 text-rose-50' : 'bg-zinc-800 text-zinc-300 hover:bg-zinc-700'].join(' ')}
            title="Pause"
          ><Pause size={11} /></button>
          <button onClick={() => setTimeScale(0.25)} className="rounded bg-zinc-800 px-1 py-1 text-[10px] text-zinc-300 hover:bg-zinc-700" title="Slow-mo">¼×</button>
          <button onClick={() => setTimeScale(1.0)} className="rounded bg-zinc-800 px-1 py-1 text-[10px] text-zinc-300 hover:bg-zinc-700" title="Real-time"><Play size={11} /></button>
          <button onClick={() => setTimeScale(2.0)} className="rounded bg-zinc-800 px-1 py-1 text-[10px] text-zinc-300 hover:bg-zinc-700" title="Fast"><FastForward size={11} /></button>
        </div>

        <div className="space-y-1">
          {playerCombatants.map((c) => {
            const firstEnemy = enemyCombatants.find((e) => e.hp > 0);
            const queued = queuedByActor.get(c.entity_id);
            return (
              <div key={c.entity_id} className="rounded border border-rose-500/20 bg-zinc-900/50 p-1.5">
                <div className="mb-1 text-[10px] text-emerald-300">{c.entity_id.slice(0, 14)}</div>
                <div className="grid grid-cols-3 gap-1">
                  <button
                    disabled={!firstEnemy}
                    onClick={() => firstEnemy && queueAction(c.entity_id, 'attack', firstEnemy.entity_id)}
                    className="rounded bg-rose-500/30 px-1 py-0.5 text-[10px] text-rose-100 hover:bg-rose-500/50 disabled:opacity-50"
                  >attack</button>
                  <button
                    onClick={() => queueAction(c.entity_id, 'ability')}
                    className="rounded bg-violet-500/30 px-1 py-0.5 text-[10px] text-violet-100 hover:bg-violet-500/50"
                  >ability</button>
                  <button
                    onClick={() => queueAction(c.entity_id, 'wait')}
                    className="rounded bg-zinc-800 px-1 py-0.5 text-[10px] text-zinc-300 hover:bg-zinc-700"
                  >wait</button>
                </div>
                {queued && (
                  <div className="mt-0.5 text-[9px] text-amber-300/70">
                    queued: {queued.action_kind}
                  </div>
                )}
              </div>
            );
          })}
        </div>
      </div>
    </>
  );
}
