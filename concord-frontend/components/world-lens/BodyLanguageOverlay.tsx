'use client';

/**
 * BodyLanguageOverlay — readable combat intent layer.
 *
 * Subscribes to `combat:telegraph` (fired by server before applyAttack
 * resolves) and `combat:hit` (after) to render a brief body-language
 * indicator on the attacker. Severity and tier drive ring color, glow
 * intensity, and pulse speed.
 *
 * Two layers:
 *   1. World-space: would project to the attacker's screen position via
 *      a known entity-position lookup. Falls back to HUD overlay when
 *      attacker position isn't known to this client (rare).
 *   2. HUD overlay: a stack of recent telegraph events shown as a thin
 *      strip, so even off-screen attacks register in the player's read.
 *
 * Telegraph windows are short (80–320ms) — the overlay is intentionally
 * cheap to render. Aged-out entries fall off the strip.
 */

import { useEffect, useState } from 'react';
import { Eye, Swords } from 'lucide-react';
import { subscribe } from '@/lib/realtime/socket';

interface TelegraphEntry {
  id: string;
  attackerId: string;
  targetId?: string;
  severity: 'light' | 'heavy';
  anticipationMs: number;
  style?: string | null;
  tier?: number;
  bornAt: number;
  expiresAt: number;
}

const STRIP_MAX = 6;
const ENTRY_TTL_GRACE_MS = 800; // keep visible briefly after telegraph window

export function BodyLanguageOverlay() {
  const [strip, setStrip] = useState<TelegraphEntry[]>([]);

  // Subscribe to telegraphs
  useEffect(() => {
    const off = subscribe<{
      attackerId: string;
      targetId?: string;
      severity: 'light' | 'heavy';
      anticipationMs: number;
      style?: string | null;
      tier?: number;
    }>('combat:telegraph', (payload) => {
      const now = Date.now();
      const entry: TelegraphEntry = {
        id: `tg-${now}-${Math.random().toString(36).slice(2, 6)}`,
        attackerId: payload.attackerId,
        targetId: payload.targetId,
        severity: payload.severity || 'light',
        anticipationMs: Math.max(40, payload.anticipationMs || 120),
        style: payload.style,
        tier: payload.tier,
        bornAt: now,
        expiresAt: now + Math.max(40, payload.anticipationMs || 120) + ENTRY_TTL_GRACE_MS,
      };
      setStrip((prev) => [entry, ...prev].slice(0, STRIP_MAX));
    });
    return off;
  }, []);

  // Sweep expired entries
  useEffect(() => {
    const id = setInterval(() => {
      const now = Date.now();
      setStrip((prev) => prev.filter((e) => e.expiresAt > now));
    }, 200);
    return () => clearInterval(id);
  }, []);

  if (strip.length === 0) return null;

  return (
    <div className="pointer-events-none fixed left-1/2 top-24 z-[35] -translate-x-1/2">
      <div className="flex items-center gap-1.5 rounded-full bg-black/45 px-2 py-1 backdrop-blur-sm">
        <Eye className="h-3 w-3 text-amber-200/70" />
        <ul className="flex items-center gap-1.5">
          {strip.map((e) => {
            const isHeavy = e.severity === 'heavy';
            const elapsed = Date.now() - e.bornAt;
            const inWindow = elapsed < e.anticipationMs;
            const baseColor = isHeavy ? 'rose' : 'amber';
            return (
              <li
                key={e.id}
                className={`relative flex items-center gap-1 rounded-full px-1.5 py-0.5 text-[10px] ${
                  inWindow
                    ? `bg-${baseColor}-500/25 text-${baseColor}-100 ${isHeavy ? 'animate-pulse' : ''}`
                    : `bg-slate-700/40 text-slate-300/80`
                }`}
                style={{
                  boxShadow: inWindow
                    ? isHeavy
                      ? '0 0 10px rgba(244, 63, 94, 0.55)'
                      : '0 0 8px rgba(252, 211, 77, 0.40)'
                    : 'none',
                }}
              >
                <Swords className="h-2.5 w-2.5" />
                <span className="font-medium">
                  {e.attackerId.slice(0, 8)}
                </span>
                {e.style && (
                  <span className="opacity-70">· {String(e.style).slice(0, 14)}</span>
                )}
                {e.tier && (
                  <span className="opacity-60 tabular-nums">T{e.tier}</span>
                )}
              </li>
            );
          })}
        </ul>
      </div>
    </div>
  );
}
