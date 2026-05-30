// concord-frontend/lib/world-lens/avatar-aura-renderer.ts
//
// Render-Everything WS3.3 — buff/debuff AURAS on the player avatar.
//
// The Living Society substrate applies effects into `user_active_effects`
// (consumable buffs, the Phase-0 craft-backfire debuff, conditional god-tier
// glows like daylight_avatar / war_ramp / eternal_regen). Today only the 2D
// ActiveEffectsBar shows them — the avatar itself reads neutral. This renders a
// soft, additive aura at the player's feet whose COLOUR + INTENSITY track the
// live effect stack: warm cyan/gold when buffs dominate, sickly red/violet when
// debuffs do, blended when mixed, pulsing with the strongest magnitude. No
// effects → no aura (fades out).
//
// Follows the player via `window.__concordiaPlayerPos` (set by AvatarSystem3D)
// and polls `/api/world/effects/me`. Pure helper `auraVisual(effects)` is
// unit-testable; the renderer is a factory `(parentGroup, opts) => {update,
// dispose, refresh}` matching the other infrastructure-layer renderers.

import * as THREE from "three";

export interface ActiveEffect {
  effect_id: string;
  kind: "buff" | "debuff";
  magnitude: number;
  started_at?: number;
  expires_at?: number;
}

export interface AvatarAuraRendererOpts {
  authToken?: () => string | null;
  pollMs?: number;
  apiBase?: string;
  /** Test seam — supply effects directly instead of fetching. */
  fetchEffects?: () => Promise<ActiveEffect[]>;
  /** Override the player-position accessor (defaults to window global). */
  playerPos?: () => { x: number; y?: number; z: number } | null;
}

export interface AuraVisual {
  active: boolean;
  /** 0xRRGGBB aura colour (buff/debuff/mixed blend). */
  color: number;
  /** 0..1 overall aura intensity. */
  intensity: number;
  /** Pulse speed (Hz-ish) — stronger stacks pulse faster. */
  pulse: number;
}

const BUFF_COLOR = new THREE.Color(0x4fd6ff); // warm cyan
const DEBUFF_COLOR = new THREE.Color(0xc0392b); // sickly red
const NOW_S = () => Date.now() / 1000;

/**
 * PURE: fold a live effect stack into aura attributes.
 * - active === false when there are no (unexpired) effects.
 * - colour blends buff-cyan vs debuff-red by their magnitude shares.
 * - intensity saturates with total magnitude (clamped 0..1).
 * - pulse rises with the strongest single magnitude.
 */
export function auraVisual(effects: ActiveEffect[], nowS: number = NOW_S()): AuraVisual {
  const live = (effects || []).filter(
    (e) => e && Number.isFinite(e.magnitude) && (e.expires_at == null || e.expires_at > nowS),
  );
  if (live.length === 0) return { active: false, color: 0x000000, intensity: 0, pulse: 0 };

  let buffMag = 0;
  let debuffMag = 0;
  let strongest = 0;
  for (const e of live) {
    const m = Math.abs(Number(e.magnitude)) || 0.0;
    strongest = Math.max(strongest, m);
    if (e.kind === "debuff") debuffMag += m;
    else buffMag += m;
  }
  const total = buffMag + debuffMag;
  // Blend cyan↔red by debuff share.
  const debuffShare = total > 0 ? debuffMag / total : 0;
  const c = BUFF_COLOR.clone().lerp(DEBUFF_COLOR, Math.max(0, Math.min(1, debuffShare)));
  return {
    active: true,
    color: c.getHex(),
    intensity: Math.max(0.15, Math.min(1, total)),
    pulse: 1.0 + Math.min(3, strongest * 2),
  };
}

export interface AvatarAuraRenderer {
  update(delta: number, elapsed: number): void;
  dispose(): void;
  refresh(): Promise<void>;
}

export function createAvatarAuraRenderer(
  parentGroup: THREE.Group,
  opts: AvatarAuraRendererOpts = {},
): AvatarAuraRenderer {
  const pollMs = opts.pollMs ?? 3000;
  const apiBase = opts.apiBase ?? "";
  const url = `${apiBase}/api/world/effects/me`;
  const getPos =
    opts.playerPos ??
    (() => {
      if (typeof window === "undefined") return null;
      const p = (window as { __concordiaPlayerPos?: { x: number; y?: number; z: number } }).__concordiaPlayerPos;
      return p ?? null;
    });

  let disposed = false;
  let intervalId: ReturnType<typeof setInterval> | null = null;
  let current: AuraVisual = { active: false, color: 0x000000, intensity: 0, pulse: 0 };

  // Aura mesh: a flat additive disc at the feet + a faint vertical glow column.
  const group = new THREE.Group();
  group.visible = false;
  const discGeo = new THREE.RingGeometry(1.1, 2.2, 32);
  discGeo.rotateX(-Math.PI / 2);
  const discMat = new THREE.MeshBasicMaterial({
    color: 0xffffff,
    transparent: true,
    opacity: 0,
    blending: THREE.AdditiveBlending,
    depthWrite: false,
    side: THREE.DoubleSide,
  });
  const disc = new THREE.Mesh(discGeo, discMat);
  disc.position.y = 0.05;
  group.add(disc);

  const columnGeo = new THREE.CylinderGeometry(1.0, 1.4, 3.2, 16, 1, true);
  const columnMat = new THREE.MeshBasicMaterial({
    color: 0xffffff,
    transparent: true,
    opacity: 0,
    blending: THREE.AdditiveBlending,
    depthWrite: false,
    side: THREE.DoubleSide,
  });
  const column = new THREE.Mesh(columnGeo, columnMat);
  column.position.y = 1.6;
  group.add(column);
  parentGroup.add(group);

  function applyVisual(v: AuraVisual): void {
    current = v;
    group.visible = v.active;
    const col = new THREE.Color(v.color);
    (discMat.color as THREE.Color).copy(col);
    (columnMat.color as THREE.Color).copy(col);
  }

  async function refresh(): Promise<void> {
    if (disposed) return;
    try {
      let effects: ActiveEffect[];
      if (opts.fetchEffects) {
        effects = await opts.fetchEffects();
      } else {
        const headers: Record<string, string> = { Accept: "application/json" };
        const token = opts.authToken ? opts.authToken() : null;
        if (token) headers.Authorization = `Bearer ${token}`;
        const res = await fetch(url, { headers });
        if (!res.ok) return;
        const data = (await res.json()) as { effects?: ActiveEffect[] };
        if (!data || !Array.isArray(data.effects)) return;
        effects = data.effects;
      }
      applyVisual(auraVisual(effects));
    } catch {
      // Network/parse failure → keep the last known aura (no flicker, no fake).
    }
  }

  void refresh();
  intervalId = setInterval(() => void refresh(), pollMs);

  function update(_delta: number, elapsed: number): void {
    if (disposed || !current.active) return;
    const pos = getPos();
    if (pos) group.position.set(pos.x, pos.y ?? 0, pos.z);
    // Pulse the opacity so the aura breathes; stronger stacks pulse faster.
    const phase = 0.5 + 0.5 * Math.sin(elapsed * current.pulse);
    const base = current.intensity;
    discMat.opacity = base * (0.35 + 0.35 * phase);
    columnMat.opacity = base * (0.12 + 0.18 * phase);
    group.rotation.y = elapsed * 0.4;
  }

  function dispose(): void {
    if (disposed) return;
    disposed = true;
    if (intervalId) clearInterval(intervalId);
    intervalId = null;
    try { parentGroup.remove(group); } catch { /* idempotent */ }
    try { discGeo.dispose(); } catch { /* idempotent */ }
    try { discMat.dispose(); } catch { /* idempotent */ }
    try { columnGeo.dispose(); } catch { /* idempotent */ }
    try { columnMat.dispose(); } catch { /* idempotent */ }
  }

  return { update, dispose, refresh };
}
