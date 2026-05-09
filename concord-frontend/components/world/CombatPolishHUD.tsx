'use client';

/**
 * CombatPolishHUD — Phase 8 combat surface.
 *
 * Displays:
 *   - Stamina ring (gas tank), color-coded; pulses when gassed_out
 *   - Combo counter with timing-window pulse (decays visually)
 *   - Rocked indicator (red overlay edge when self is rocked)
 *   - Parry-window glint when an incoming strike is timed-pierce-able
 *   - Profile badge (UFC / Sifu / Street / Chrome / Aerial)
 *
 * Subscribes to:
 *   - 'combat:polish' socket events (server-emitted)
 *   - polls beats.list pattern not used; combat state is live-only
 *
 * The HUD is the read surface. Animation/audio/camera/VFX bridges are
 * SEPARATE files — they listen to the same events but call out to
 * the user's asset systems.
 */

import { useCallback, useEffect, useRef, useState } from 'react';
import { subscribe } from '@/lib/realtime/socket';

interface CombatActorState {
  actor_kind: 'player' | 'npc';
  actor_id: string;
  world_id: string;
  profile_id: string;
  stance: string;
  posture: string;
  awareness: string;
  awareness_target: string | null;
  gas: number;
  max_gas: number;
  combo_count: number;
  combo_last_at_ms: number;
  rocked_until_ms: number;
  grapple_target: string | null;
  updated_at: number;
}

interface CombatPolishEvent {
  id: string;
  worldId: string;
  actorKind: 'player' | 'npc';
  actorId: string;
  eventKind: string;
  detail: Record<string, unknown>;
  ts: number;
}

const PROFILE_LABELS: Record<string, string> = {
  ufc_groundgame:   'UFC',
  sifu_brawler:     'SIFU',
  street_freeroam:  'STREET',
  chrome_blade:     'CHROME',
  caped_aerial:     'AERIAL',
};

async function callMacro<T = unknown>(domain: string, name: string, input: Record<string, unknown> = {}): Promise<T | null> {
  try {
    const res = await fetch('/api/lens/run', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      credentials: 'same-origin',
      body: JSON.stringify({ domain, name, input }),
    });
    if (!res.ok) return null;
    return (await res.json()) as T;
  } catch {
    return null;
  }
}

export function CombatPolishHUD({ userId }: { userId: string | null }) {
  const [state, setState] = useState<CombatActorState | null>(null);
  const [comboFlashAt, setComboFlashAt] = useState(0);
  const [parryGlintAt, setParryGlintAt] = useState(0);
  const [rockedTick, setRockedTick] = useState(0);
  const stateRef = useRef<CombatActorState | null>(null);
  stateRef.current = state;

  // ── Bootstrap state on mount ──
  useEffect(() => {
    if (!userId) return;
    let cancelled = false;
    (async () => {
      const r = await callMacro<{ ok: boolean; state?: CombatActorState }>(
        'combat_polish',
        'state_for_actor',
        { actorKind: 'player', actorId: userId, worldId: 'concordia-hub' },
      );
      if (cancelled || !r?.ok || !r.state) return;
      setState(r.state);
    })();
    return () => { cancelled = true; };
  }, [userId]);

  // ── Subscribe to live polish events ──
  useEffect(() => {
    if (!userId) return;
    const off = subscribe(
      'combat:polish' as Parameters<typeof subscribe>[0],
      (payload: unknown) => {
        const ev = payload as CombatPolishEvent;
        if (!ev || ev.actorId !== userId) return;

        // Update local state from the event.
        const detail = ev.detail || {};
        setState((prev) => {
          if (!prev) return prev;
          const next = { ...prev };
          switch (ev.eventKind) {
            case 'combo_start':
            case 'combo_extend':
              next.combo_count = Number(detail.combo) || prev.combo_count + 1;
              next.combo_last_at_ms = ev.ts;
              break;
            case 'combo_break':
              next.combo_count = 0;
              break;
            case 'combo_finish':
              next.combo_count = Number(detail.combo) || prev.combo_count;
              next.combo_last_at_ms = ev.ts;
              break;
            case 'rocked':
              next.rocked_until_ms = Number(detail.until) || ev.ts + 2000;
              break;
            case 'gassed_out':
              next.gas = Number(detail.gas_after) || 0;
              break;
            case 'awareness_transition':
              next.awareness = String(detail.to || prev.awareness);
              if (detail.target) next.awareness_target = String(detail.target);
              break;
            case 'stance_change':
              next.stance = String(detail.to || prev.stance);
              break;
          }
          return next;
        });

        // Trigger visual flashes
        if (ev.eventKind === 'combo_extend' || ev.eventKind === 'combo_finish' || ev.eventKind === 'combo_start') {
          setComboFlashAt(Date.now());
        }
        if (ev.eventKind === 'parry_perfect' || ev.eventKind === 'parry') {
          setParryGlintAt(Date.now());
        }
      },
    );
    return () => off?.();
  }, [userId]);

  // ── Rocked countdown tick (causes re-render every 100ms while rocked) ──
  useEffect(() => {
    if (!state) return;
    const isRocked = state.rocked_until_ms > Date.now();
    if (!isRocked) return;
    const t = setInterval(() => setRockedTick((n) => n + 1), 100);
    return () => clearInterval(t);
  }, [state, rockedTick]);

  if (!state) return null;

  const gasPct = Math.max(0, Math.min(1, state.gas / state.max_gas));
  const isRocked = state.rocked_until_ms > Date.now();
  const isGassed = state.gas < 15;
  const profileLabel = PROFILE_LABELS[state.profile_id] || state.profile_id;
  const inCombat = state.awareness === 'combat' || state.awareness === 'alert';

  // Combo decay: visually fade combo counter as time-since-last-strike approaches the window.
  const sinceCombo = Date.now() - state.combo_last_at_ms;
  const COMBO_WINDOW_VISUAL_MS = 1400;
  const comboFreshness = state.combo_count > 0 ? Math.max(0, 1 - sinceCombo / COMBO_WINDOW_VISUAL_MS) : 0;
  const showCombo = state.combo_count > 0 && comboFreshness > 0;

  // Combo flash pulse (0.3s)
  const flashPulse = Math.max(0, 1 - (Date.now() - comboFlashAt) / 300);
  const parryPulse = Math.max(0, 1 - (Date.now() - parryGlintAt) / 400);

  return (
    <>
      {/* Rocked overlay — red vignette pulses while rocked */}
      {isRocked && (
        <div
          aria-hidden
          style={{
            position: 'fixed',
            inset: 0,
            pointerEvents: 'none',
            boxShadow: 'inset 0 0 200px 60px rgba(255, 60, 60, 0.5)',
            opacity: 0.5 + 0.3 * Math.sin(rockedTick * 0.5),
            zIndex: 990,
            transition: 'opacity 100ms linear',
          }}
        />
      )}

      {/* Parry glint */}
      {parryPulse > 0 && (
        <div
          aria-hidden
          style={{
            position: 'fixed',
            inset: 0,
            pointerEvents: 'none',
            boxShadow: `inset 0 0 80px 20px rgba(180, 220, 255, ${0.8 * parryPulse})`,
            zIndex: 991,
          }}
        />
      )}

      {/* Main HUD card — bottom-left */}
      <div
        style={{
          position: 'fixed',
          bottom: '20px',
          left: '20px',
          display: 'flex',
          alignItems: 'center',
          gap: '14px',
          padding: '10px 14px',
          background: 'rgba(20, 18, 38, 0.85)',
          border: `1px solid ${inCombat ? 'rgba(255, 130, 130, 0.6)' : 'rgba(180, 150, 255, 0.4)'}`,
          borderRadius: '8px',
          fontFamily: 'system-ui, -apple-system, sans-serif',
          color: '#e7e0ff',
          zIndex: 998,
          boxShadow: '0 6px 24px rgba(0, 0, 0, 0.4)',
          minWidth: '280px',
        }}
      >
        {/* Stamina ring */}
        <div
          style={{
            position: 'relative',
            width: '50px',
            height: '50px',
            flexShrink: 0,
          }}
        >
          <svg width="50" height="50" viewBox="0 0 50 50">
            <circle cx="25" cy="25" r="22" stroke="rgba(255,255,255,0.1)" strokeWidth="3" fill="none" />
            <circle
              cx="25" cy="25" r="22"
              stroke={isGassed ? '#ff6060' : gasPct < 0.4 ? '#ffb04a' : '#7fe0a0'}
              strokeWidth="3"
              strokeLinecap="round"
              fill="none"
              strokeDasharray={`${gasPct * 138.2} 138.2`}
              transform="rotate(-90 25 25)"
              style={{
                transition: 'stroke-dasharray 200ms ease-out, stroke 200ms',
                filter: isGassed ? `drop-shadow(0 0 6px rgba(255, 80, 80, 0.6))` : 'none',
              }}
            />
            <text
              x="25" y="29"
              textAnchor="middle"
              fontSize="12"
              fill="#e7e0ff"
              fontWeight={isGassed ? 700 : 500}
            >
              {Math.round(state.gas)}
            </text>
          </svg>
          {isGassed && (
            <div
              style={{
                position: 'absolute',
                top: '-8px',
                right: '-12px',
                fontSize: '9px',
                color: '#ff6060',
                background: 'rgba(255, 60, 60, 0.18)',
                padding: '1px 5px',
                borderRadius: '3px',
                letterSpacing: '0.05em',
                textTransform: 'uppercase',
                fontWeight: 700,
              }}
            >
              gas out
            </div>
          )}
        </div>

        {/* Combo counter */}
        <div style={{ minWidth: '80px' }}>
          <div
            style={{
              fontSize: '10px',
              color: 'rgba(200, 180, 255, 0.7)',
              textTransform: 'uppercase',
              letterSpacing: '0.08em',
              marginBottom: '2px',
            }}
          >
            combo
          </div>
          {showCombo ? (
            <div
              style={{
                fontSize: '24px',
                fontWeight: 700,
                color: '#ffffff',
                opacity: 0.4 + 0.6 * comboFreshness,
                textShadow: flashPulse > 0
                  ? `0 0 ${12 * flashPulse}px rgba(255, 220, 100, ${flashPulse})`
                  : 'none',
                transition: 'text-shadow 150ms',
                lineHeight: 1,
              }}
            >
              {state.combo_count}
              <span style={{ fontSize: '12px', color: 'rgba(255,255,255,0.5)', marginLeft: '4px' }}>×</span>
            </div>
          ) : (
            <div style={{ fontSize: '24px', color: 'rgba(200, 180, 255, 0.2)', lineHeight: 1 }}>—</div>
          )}
        </div>

        {/* Stance + profile */}
        <div style={{ flexGrow: 1 }}>
          <div
            style={{
              fontSize: '10px',
              color: 'rgba(200, 180, 255, 0.7)',
              textTransform: 'uppercase',
              letterSpacing: '0.08em',
              marginBottom: '2px',
            }}
          >
            {profileLabel} · {state.stance}
          </div>
          <div
            style={{
              fontSize: '11px',
              color: inCombat ? '#ff8080' : 'rgba(180, 200, 220, 0.7)',
              textTransform: 'uppercase',
              letterSpacing: '0.04em',
            }}
          >
            {state.awareness}
            {state.awareness_target ? ` → ${String(state.awareness_target).slice(0, 12)}` : ''}
          </div>
        </div>
      </div>
    </>
  );
}
