'use client';
import { useEffect, useRef, useState } from 'react';
import { useClientConfig } from '@/hooks/useClientConfig';
import { resolveDemeanor } from '@/lib/concordia/npc-demeanor';

// Theme 4 (game-feel pass): floating activity icon above each NPC head.
//
// The Concordia npc-routine-cycle heartbeat already drives every authored
// NPC through an 8-block daily schedule (sleep / train / patrol / trade /
// craft / commune / etc.) — but the player can't see what an NPC is
// currently doing. This overlay surfaces the cycle's `activity_kind`
// straight to the camera using the existing concordia:projector-ready
// world-to-screen function, with a 12m visibility radius from the player.
//
// Same pattern as BazaarLayer: cache the projector ref, requestAnimationFrame
// loop at ~12 Hz, render absolute-positioned <span>s.
//
// Hidden when:
//   - NPC has no current activity
//   - NPC is past VISIBLE_RADIUS_M from the player camera focus
//   - The activity is "default" / generic (no signal worth surfacing)

const VISIBLE_RADIUS_M = 12;

// Map activity_kind → emoji + short label. Unknown activities get nothing —
// we'd rather show no icon than a generic dot that adds noise.
const ACTIVITY_ICON: Record<string, { emoji: string; label: string }> = {
  train:     { emoji: '⚔︎', label: 'training' },
  patrol:    { emoji: '🛡', label: 'on patrol' },
  trade:     { emoji: '⚖︎', label: 'trading' },
  craft:     { emoji: '⚒', label: 'crafting' },
  socialize: { emoji: '☕', label: 'socializing' },
  commune:   { emoji: '✺', label: 'communing' },
  sleep:     { emoji: '☾', label: 'sleeping' },
  rest:      { emoji: '⌒', label: 'resting' },
  // negative-space: the routine cycle uses these labels but they're
  // covered by the lookup above.
};

interface NpcLite {
  id: string;
  name?: string;
  position: { x: number; y?: number; z: number };
  currentActivity?: string | null;
  // WS-CONSEQUENCE — the world's memory of YOU toward this NPC (optional; when
  // present the tag tints + shows a regard glyph so the consequence is visible
  // before a word is spoken).
  grudge?: number;
  reputation?: number;
  gratitude?: number;
  hostile?: boolean;
  // Track 3 — mood tells: the NPC's OWN emotional state (not player-specific).
  // `mood` is server-derived (npc-mood.js); a tense/breaking/coping NPC shows a
  // glyph so distress is legible before dialogue (RimWorld "show the consequence").
  mood?: string | null;
  coping?: string | null;
}

// mood → a small glyph + tint above the activity tag (quiet for neutral/content).
const MOOD_TELL: Record<string, { icon: string; tint: string; label: string }> = {
  tense:    { icon: '〰', tint: '#e0a030', label: 'Tense' },
  breaking: { icon: '!',  tint: '#e05050', label: 'Breaking down' },
  coping:   { icon: '☍',  tint: '#b070d0', label: 'Coping' },
};

interface NPCActivityTagProps {
  npcs: NpcLite[];
  playerPosition?: { x: number; z: number };
  enabled?: boolean;
}

type Projection = { x: number; y: number; visible: boolean };
type Projector = (world: { x: number; y: number; z: number }) => Projection | null;

export function NPCActivityTag({ npcs, playerPosition, enabled = true }: NPCActivityTagProps) {
  const FRAME_THROTTLE_MS = useClientConfig().throttle.npcActivityFrameMs; // E0 — server-tunable
  const projectorRef = useRef<Projector | null>(null);
  const [screenPositions, setScreenPositions] = useState<Map<string, Projection>>(new Map());

  // Cache the scene-side projector when ConcordiaScene is ready.
  useEffect(() => {
    function onProjector(e: Event) {
      const detail = (e as CustomEvent).detail as { project: Projector };
      if (typeof detail?.project === 'function') projectorRef.current = detail.project;
    }
    window.addEventListener('concordia:projector-ready', onProjector);
    return () => window.removeEventListener('concordia:projector-ready', onProjector);
  }, []);

  // rAF loop: re-project NPC positions every ~80ms. Skip projection for NPCs
  // outside the visible radius from the player (cheap pre-filter; the
  // projector itself does no occlusion check).
  useEffect(() => {
    if (!enabled || !npcs.length) {
      setScreenPositions(new Map());
      return;
    }
    let raf = 0;
    let last = 0;
    function loop(t: number) {
      raf = requestAnimationFrame(loop);
      if (t - last < FRAME_THROTTLE_MS) return;
      last = t;
      const proj = projectorRef.current;
      if (!proj) return;
      const next = new Map<string, Projection>();
      for (const n of npcs) {
        if (!n.currentActivity) continue;
        if (!ACTIVITY_ICON[n.currentActivity]) continue;
        if (playerPosition) {
          const dx = n.position.x - playerPosition.x;
          const dz = n.position.z - playerPosition.z;
          if (Math.hypot(dx, dz) > VISIBLE_RADIUS_M) continue;
        }
        // Anchor the icon ~1.8m above the NPC's grounded position so it
        // sits above their head regardless of model height.
        const p = proj({ x: n.position.x, y: (n.position.y ?? 0) + 1.8, z: n.position.z });
        if (p) next.set(n.id, p);
      }
      setScreenPositions(next);
    }
    raf = requestAnimationFrame(loop);
    return () => cancelAnimationFrame(raf);
  }, [enabled, npcs, playerPosition, FRAME_THROTTLE_MS]);

  if (!enabled || screenPositions.size === 0) return null;

  return (
    <div
      className="fixed inset-0 pointer-events-none z-[35]"
      data-testid="npc-activity-tag-layer"
      aria-hidden="true"
    >
      {npcs.map((n) => {
        const pos = screenPositions.get(n.id);
        if (!pos?.visible) return null;
        const def = n.currentActivity ? ACTIVITY_ICON[n.currentActivity] : null;
        if (!def) return null;
        // WS-CONSEQUENCE — visible regard. Only computed when the NPC carries
        // remembered signals; neutral (or absent) leaves the tag unchanged.
        const dem = (n.grudge != null || n.reputation != null || n.gratitude != null || n.hostile)
          ? resolveDemeanor({ grudge: n.grudge, reputation: n.reputation, gratitude: n.gratitude, hostile: n.hostile })
          : null;
        const borderStyle = dem && dem.demeanor !== 'neutral' ? { borderColor: dem.tint } : undefined;
        return (
          <div
            key={n.id}
            className="absolute -translate-x-1/2 -translate-y-full select-none"
            style={{ left: `${pos.x}px`, top: `${pos.y}px` }}
            data-npc-id={n.id}
            data-activity={n.currentActivity ?? undefined}
          >
            <div className="flex flex-col items-center">
              <div
                className="px-1.5 py-0.5 bg-black/55 border border-white/15 rounded-full
                           backdrop-blur-sm shadow-md text-white/90 text-xs leading-none"
                style={borderStyle}
              >
                <span aria-hidden>{def.emoji}</span>
                {dem && dem.icon && (
                  <span aria-hidden style={{ color: dem.tint, marginLeft: 3 }} title={dem.label}>{dem.icon}</span>
                )}
                {n.mood && MOOD_TELL[n.mood] && (
                  <span aria-hidden style={{ color: MOOD_TELL[n.mood].tint, marginLeft: 3 }}
                    title={n.coping ? `${MOOD_TELL[n.mood].label}: ${n.coping}` : MOOD_TELL[n.mood].label}>
                    {MOOD_TELL[n.mood].icon}
                  </span>
                )}
              </div>
              <div className="mt-0.5 text-[8px] uppercase tracking-wide text-white/50">
                {def.label}
              </div>
            </div>
          </div>
        );
      })}
    </div>
  );
}
