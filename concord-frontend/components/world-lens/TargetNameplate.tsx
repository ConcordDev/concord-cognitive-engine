'use client';

/**
 * TargetNameplate — focused frame for the current lock-on target.
 *
 * Tracks the locked target via the `concordia:lockon-changed` window event
 * (dispatched by cameraLookState.setLockOnTarget) and seeds the initial value
 * from cameraLookState.lockedTargetId. When a target id is set, it looks the
 * NPC up in the `npcs` prop for name + HP, then keeps HP live by subtracting
 * REAL damage from the `combat:impact` / `combat:hit` socket events whose
 * target is the locked id. `combat:death` for that id clears the frame.
 *
 * Authoritative re-sync: whenever the `npcs` prop refreshes (it polls server
 * state periodically), the cached HP is reset to the server value — local
 * socket-driven decrements are only a smoothing layer between refreshes.
 */

import { useCallback, useEffect, useRef, useState } from 'react';
import { cameraLookState } from '@/lib/world-lens/camera-look-state';
import { useSocket } from '@/hooks/useSocket';

interface NPCLite {
  id: string;
  name?: string;
  currentHp?: number;
  maxHp?: number;
}

type LockMode = 'soft' | 'hard' | null;

export function TargetNameplate({ npcs }: { npcs: NPCLite[] }) {
  const { on, off } = useSocket({ autoConnect: true });

  const [targetId, setTargetId] = useState<string | null>(cameraLookState.lockedTargetId);
  const [lockMode, setLockMode] = useState<LockMode>(cameraLookState.lockMode);
  // Local, smoothed HP between authoritative `npcs` refreshes.
  const [hp, setHp] = useState<number | null>(null);

  const targetIdRef = useRef<string | null>(targetId);
  targetIdRef.current = targetId;

  // ── Lock-on tracking ────────────────────────────────────────────
  useEffect(() => {
    if (typeof window === 'undefined') return;
    const handler = (e: Event) => {
      const detail = (e as CustomEvent).detail as { id: string | null; mode?: LockMode } | undefined;
      setTargetId(detail?.id ?? null);
      setLockMode(detail?.id ? detail?.mode ?? 'soft' : null);
    };
    window.addEventListener('concordia:lockon-changed', handler);
    return () => window.removeEventListener('concordia:lockon-changed', handler);
  }, []);

  // ── Look up the locked NPC + authoritative re-sync on npcs change ─
  const target = targetId ? npcs.find((n) => n.id === targetId) : undefined;

  useEffect(() => {
    if (target && typeof target.currentHp === 'number') {
      setHp(target.currentHp);
    } else {
      setHp(null);
    }
    // Re-sync whenever the locked id changes or the npcs array refreshes.
  }, [target, targetId]);

  // ── Live HP from real combat events ─────────────────────────────
  const applyDamage = useCallback((payload: unknown) => {
    if (!payload || typeof payload !== 'object') return;
    const p = payload as Record<string, unknown>;
    const tid = (p.targetId ?? p.victimId ?? p.defenderId) as string | undefined;
    if (!tid || tid !== targetIdRef.current) return;
    const dmg = Number(p.damage ?? p.finalDamage ?? 0);
    if (!Number.isFinite(dmg) || dmg <= 0) return;
    setHp((prev) => (prev == null ? prev : Math.max(0, prev - dmg)));
  }, []);

  const handleDeath = useCallback((payload: unknown) => {
    const p = (payload && typeof payload === 'object' ? payload : {}) as Record<string, unknown>;
    const tid = (p.targetId ?? p.victimId ?? p.id) as string | undefined;
    if (tid && tid === targetIdRef.current) {
      setTargetId(null);
      setLockMode(null);
    }
  }, []);

  useEffect(() => {
    on('combat:impact', applyDamage);
    on('combat:hit', applyDamage);
    on('combat:death', handleDeath);
    return () => {
      off('combat:impact', applyDamage);
      off('combat:hit', applyDamage);
      off('combat:death', handleDeath);
    };
  }, [on, off, applyDamage, handleDeath]);

  if (!targetId || !target) return null;

  const maxHp = typeof target.maxHp === 'number' && target.maxHp > 0 ? target.maxHp : null;
  const curHp = hp ?? (typeof target.currentHp === 'number' ? target.currentHp : null);
  const pct =
    maxHp != null && curHp != null ? Math.min(100, Math.max(0, Math.round((curHp / maxHp) * 100))) : null;

  return (
    <div className="pointer-events-none fixed left-1/2 top-3 z-30 -translate-x-1/2">
      <div className="min-w-[220px] rounded-lg border border-white/10 bg-black/80 px-4 py-2 text-white backdrop-blur-sm">
        <div className="mb-1 flex items-center justify-between gap-3">
          <span className="truncate text-sm font-semibold">{target.name || 'Target'}</span>
          {lockMode && (
            <span
              className={`rounded px-1.5 py-0.5 text-[9px] font-bold uppercase tracking-wider ${
                lockMode === 'hard' ? 'bg-rose-500/30 text-rose-200' : 'bg-amber-400/20 text-amber-200'
              }`}
            >
              {lockMode}
            </span>
          )}
        </div>
        <div className="h-2 overflow-hidden rounded bg-white/10">
          <div
            data-testid="target-hp-fill"
            className="h-full bg-rose-500 transition-[width] duration-150"
            style={{ width: pct != null ? `${pct}%` : '0%' }}
          />
        </div>
        {pct != null && curHp != null && maxHp != null && (
          <div className="mt-0.5 text-right text-[10px] tabular-nums text-white/60">
            {Math.round(curHp)} / {Math.round(maxHp)} ({pct}%)
          </div>
        )}
      </div>
    </div>
  );
}

export default TargetNameplate;
