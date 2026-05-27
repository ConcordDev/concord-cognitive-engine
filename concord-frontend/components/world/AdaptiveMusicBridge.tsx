'use client';

/**
 * AdaptiveMusicBridge — drives the adaptive vertical-layer music
 * stems from gameplay state.
 *
 * Subscribes to:
 *   combat:polish           → combat = 1 (decays back to 0 over 6s)
 *   combat:hit              → combat = max(combat, 0.7)
 *   combat:stagger          → tension bump
 *   npc:scheme_revealed     → revelation = 1 (decays over 8s)
 *   quest:triggered         → tension = 1 (decays over 10s)
 *   world:refusal-field     → tension bump
 *
 * State decays back toward exploration baseline when no signals fire.
 * Tick loop runs at 60Hz to smooth-ease gains per setState contract.
 */

import { useEffect, useRef } from 'react';
import { subscribe } from '@/lib/realtime/socket';
import { lensRun } from '@/lib/api/client';
import type { AdaptiveMusicAPI, StemName } from '@/lib/world-lens/adaptive-music';

const ADAPTIVE_STEMS: StemName[] = [
  'ambient_bed', 'tension_pad', 'combat_drum', 'revelation_strings',
];

interface PublishedStem {
  dtuId:        string;
  stemName:     StemName;
  downloadUrl:  string | null;
  mood:         string | null;
  durationMs:   number | null;
  createdAt:    string;
}

async function fetchAndDecodeStem(
  ctx: AudioContext,
  url: string,
): Promise<AudioBuffer | null> {
  try {
    const resp = await fetch(url, { credentials: 'include' });
    if (!resp.ok) return null;
    const arr = await resp.arrayBuffer();
    return await ctx.decodeAudioData(arr);
  } catch {
    return null;
  }
}

/**
 * Pick the canonical stem to load per slot. Strategy: prefer the
 * newest published stem per name (latest createdAt wins). When the
 * marketplace/canon vote layer lands, this becomes a quality-score
 * sort instead.
 */
function selectCanonStems(stems: PublishedStem[]): Partial<Record<StemName, PublishedStem>> {
  const byName: Partial<Record<StemName, PublishedStem>> = {};
  for (const s of stems) {
    if (!ADAPTIVE_STEMS.includes(s.stemName)) continue;
    if (!s.downloadUrl) continue;
    const existing = byName[s.stemName];
    if (!existing || s.createdAt > existing.createdAt) {
      byName[s.stemName] = s;
    }
  }
  return byName;
}

const DECAY_RATES = {
  combat:     1 / 6,   // 6s back to 0
  tension:    1 / 10,  // 10s
  revelation: 1 / 8,   // 8s
} as const;

export default function AdaptiveMusicBridge() {
  const musicRef = useRef<AdaptiveMusicAPI | null>(null);
  const stateRef = useRef({ combat: 0, tension: 0, revelation: 0, exploration: 1 });
  const rafRef   = useRef<number | null>(null);
  const ctxRef   = useRef<AudioContext | null>(null);

  useEffect(() => {
    let disposed = false;
    let lastTick = performance.now() / 1000;
    let off1: (() => void) | null = null;
    let off2: (() => void) | null = null;
    let off3: (() => void) | null = null;
    let off4: (() => void) | null = null;
    let off5: (() => void) | null = null;

    function bump(key: 'combat' | 'tension' | 'revelation', amount: number) {
      stateRef.current[key] = Math.max(stateRef.current[key], amount);
      stateRef.current.exploration = Math.max(
        0,
        1 - Math.max(stateRef.current.combat, stateRef.current.tension, stateRef.current.revelation),
      );
      musicRef.current?.setState(stateRef.current);
    }

    async function init() {
      try {
        const AudioCtor = (window as unknown as {
          AudioContext?: typeof AudioContext;
          webkitAudioContext?: typeof AudioContext;
        }).AudioContext ?? (window as unknown as {
          webkitAudioContext?: typeof AudioContext;
        }).webkitAudioContext;
        if (!AudioCtor) return;
        const ctx = new AudioCtor();
        ctxRef.current = ctx;
        const { createAdaptiveMusic } = await import('@/lib/world-lens/adaptive-music');
        musicRef.current = createAdaptiveMusic(ctx, { masterGain: 0.10 });
        // Don't auto-start — wait for user gesture (browser autoplay policy)
        const onUserGesture = () => {
          if (disposed || !musicRef.current) return;
          if (ctx.state === 'suspended') ctx.resume().catch(() => undefined);
          musicRef.current.start();
          window.removeEventListener('pointerdown', onUserGesture);
          window.removeEventListener('keydown', onUserGesture);
        };
        window.addEventListener('pointerdown', onUserGesture, { once: true });
        window.addEventListener('keydown', onUserGesture, { once: true });

        // ── Tier-1 stems: load music-lens published audio over the
        // procedural fallback. Marketplace canon vote will sort which
        // stem wins each slot when that layer lands. For now: newest
        // wins. Failures fall through to procedural silently.
        try {
          const stemsResp = await lensRun('music', 'list-published-stems', {});
          const stems = (stemsResp.data?.result?.stems as PublishedStem[] | undefined) ?? [];
          const canon = selectCanonStems(stems);
          await Promise.all(
            ADAPTIVE_STEMS.map(async (name) => {
              if (disposed) return;
              const stem = canon[name];
              if (!stem?.downloadUrl) return;
              const buf = await fetchAndDecodeStem(ctx, stem.downloadUrl);
              if (buf && musicRef.current && !disposed) {
                await musicRef.current.loadStem(name, buf);
              }
            }),
          );
        } catch {
          /* stem discovery is non-fatal — keep procedural fallback */
        }
      } catch {
        /* audio unavailable — silently no-op */
      }

      const tick = () => {
        if (disposed) return;
        const now = performance.now() / 1000;
        const dt = Math.max(0, Math.min(0.1, now - lastTick));
        lastTick = now;
        const s = stateRef.current;
        s.combat     = Math.max(0, s.combat     - DECAY_RATES.combat     * dt);
        s.tension    = Math.max(0, s.tension    - DECAY_RATES.tension    * dt);
        s.revelation = Math.max(0, s.revelation - DECAY_RATES.revelation * dt);
        s.exploration = Math.max(0, 1 - Math.max(s.combat, s.tension, s.revelation));
        musicRef.current?.setState(s);
        musicRef.current?.tick(dt);
        rafRef.current = requestAnimationFrame(tick);
      };
      rafRef.current = requestAnimationFrame(tick);
    }

    init();

    off1 = subscribe('combat:polish' as Parameters<typeof subscribe>[0], () => {
      bump('combat', 1);
    });
    off2 = subscribe('combat:hit' as Parameters<typeof subscribe>[0], () => {
      bump('combat', 0.7);
    });
    off3 = subscribe('combat:stagger' as Parameters<typeof subscribe>[0], () => {
      bump('tension', 0.6);
    });
    off4 = subscribe('npc:scheme_revealed' as Parameters<typeof subscribe>[0], () => {
      bump('revelation', 1);
    });
    off5 = subscribe('quest:triggered' as Parameters<typeof subscribe>[0], () => {
      bump('tension', 0.85);
    });

    return () => {
      disposed = true;
      if (rafRef.current !== null) cancelAnimationFrame(rafRef.current);
      try { off1?.(); off2?.(); off3?.(); off4?.(); off5?.(); } catch { /* idempotent */ }
      try { musicRef.current?.dispose(); } catch { /* idempotent */ }
      try { ctxRef.current?.close(); } catch { /* idempotent */ }
      musicRef.current = null;
    };
  }, []);

  return null;
}
