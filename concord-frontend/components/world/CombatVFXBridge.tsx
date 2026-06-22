'use client';

/**
 * CombatVFXBridge — 3D-world element VFX, weapon trails, blood decals.
 *
 * Subscribes to the combat socket events that already exist
 * (combat:hit, combat:stagger, combat:chain) and spawns matching
 * particle bursts + blood decals at the target's world position.
 *
 * The bridge waits for the scene to be ready (concordia:scene-ready
 * CustomEvent — already dispatched by ConcordiaScene at boot) so it
 * can attach effects to the live THREE.Scene without prop-drilling.
 */

import { useEffect, useRef } from 'react';
import { subscribe } from '@/lib/realtime/socket';
import type { ElementKind, ElementVfxAPI } from '@/lib/world-lens/element-vfx';
import type { BloodDecalAPI } from '@/lib/world-lens/blood-decal';

type Vec3Like = { x: number; y?: number; z: number };

interface CombatHitEvent {
  targetId?:        string;
  attackerId?:      string;
  element?:         string;
  damage?:          number;
  magnitude?:       number;
  lethal?:          boolean;
  targetPosition?:  Vec3Like;
  attackerPosition?: Vec3Like;
}

interface CombatStaggerEvent {
  targetId?:        string;
  durationMs?:      number;
  structuralStress?: number;
  elementContrib?:  string;
  targetPosition?:  Vec3Like;
}

interface CombatChainEvent {
  sourceId?:    string;
  chainTargets?: Array<{ id: string; position: Vec3Like; magnitude?: number }>;
}

interface CombatImpactEvent {
  targetId?:       string;
  attackerId?:     string;
  element?:        string;
  damage?:         number;
  severity?:       string;
  targetPosition?: Vec3Like;
  vfx?: {
    element?: string;
    tier?: string;
    particles?: { count?: number; scale?: number; trailLength?: number };
    glow?: number;
  };
}

const ELEMENT_ALLOW: Record<string, ElementKind> = {
  fire: 'fire',
  ice: 'ice',
  lightning: 'lightning',
  poison: 'poison',
  water: 'water',
  energy: 'energy',
  physical: 'physical',
  bio: 'poison',
  storm: 'lightning',
  frost: 'ice',
  flame: 'fire',
  plasma: 'energy',
};

function normalizeElement(raw: unknown): ElementKind {
  if (typeof raw !== 'string') return 'physical';
  return ELEMENT_ALLOW[raw.toLowerCase()] ?? 'physical';
}

function toVec3(v: Vec3Like | undefined): { x: number; y: number; z: number } | null {
  if (!v || typeof v.x !== 'number' || typeof v.z !== 'number') return null;
  return { x: v.x, y: typeof v.y === 'number' ? v.y : 1.4, z: v.z };
}

/**
 * Mount once near the world canvas. Spawns particle bursts + blood
 * decals on every combat:hit / combat:stagger / combat:chain event.
 *
 * Drives its own RAF tick loop so the effects evolve smoothly
 * independently of the main render-loop's frame cadence.
 */
export default function CombatVFXBridge() {
  const vfxRef = useRef<ElementVfxAPI | null>(null);
  const decalRef = useRef<BloodDecalAPI | null>(null);
  const sceneReadyRef = useRef(false);
  const rafRef = useRef<number | null>(null);

  useEffect(() => {
    let disposed = false;
    let off1: (() => void) | null = null;
    let off2: (() => void) | null = null;
    let off3: (() => void) | null = null;
    let off4: (() => void) | null = null;
    let off5: (() => void) | null = null;
    let off6: (() => void) | null = null;
    const sceneReady = async (event: Event) => {
      if (disposed || sceneReadyRef.current) return;
      const detail = (event as CustomEvent).detail as { scene?: unknown } | undefined;
      const scene = detail?.scene;
      if (!scene) return;
      sceneReadyRef.current = true;

      const THREE = await import('three');
      const { createElementVfx } = await import('@/lib/world-lens/element-vfx');
      const { createBloodDecals } = await import('@/lib/world-lens/blood-decal');
      vfxRef.current = createElementVfx(THREE, scene as Parameters<typeof createElementVfx>[1], { maxConcurrent: 32 });
      decalRef.current = createBloodDecals(THREE, scene as Parameters<typeof createBloodDecals>[1], { capacity: 32 });

      const tick = () => {
        if (disposed) return;
        const now = performance.now() / 1000;
        vfxRef.current?.tick(now);
        decalRef.current?.tick(now);
        rafRef.current = requestAnimationFrame(tick);
      };
      rafRef.current = requestAnimationFrame(tick);
    };

    window.addEventListener('concordia:scene-ready', sceneReady as EventListener);
    if ((window as unknown as { __concordiaScene?: unknown }).__concordiaScene) {
      sceneReady(new CustomEvent('concordia:scene-ready', {
        detail: { scene: (window as unknown as { __concordiaScene?: unknown }).__concordiaScene },
      }));
    }

    off1 = subscribe('combat:hit' as Parameters<typeof subscribe>[0], (payload: unknown) => {
      const ev = payload as CombatHitEvent;
      const pos = toVec3(ev.targetPosition);
      if (!pos) return;
      const element = normalizeElement(ev.element);
      const damage = Number(ev.damage ?? ev.magnitude ?? 10);
      const magnitude = Math.max(0.4, Math.min(damage / 30, 2.5));
      vfxRef.current?.spawn(element, pos, magnitude);

      // ── Blood ────────────────────────────────────────────────────────
      // Concordia is a violent game — flesh hits should bleed. Physical
      // (melee) damage sprays a crimson burst on top of the impact dust, and
      // any non-elemental hit ≥2 dmg draws at least a little blood. Lethal
      // blows throw a heavier spray + a ground blood pool.
      const isFlesh = element === 'physical';
      if (isFlesh && damage >= 2) {
        // Bleed burst scales with the hit; a touch above the dust magnitude.
        vfxRef.current?.spawn('bleed', { x: pos.x, y: (pos.y ?? 0) + 0.1, z: pos.z }, Math.min(magnitude * 1.15, 2.5));
      }
      const att = toVec3(ev.attackerPosition);
      const normal = att
        ? { x: att.x - pos.x, y: 0, z: att.z - pos.z }
        : { x: 0, y: 0, z: 1 };
      // Ground splatter on solid flesh hits (threshold lowered 8 → 4 so even
      // light blows leave a mark).
      if (isFlesh && damage >= 4) {
        decalRef.current?.spawn(pos, normal, magnitude);
      }
      // Death blood — heavier spray + a wider pool decal under the body.
      if (ev.lethal) {
        vfxRef.current?.spawn('bleed', { x: pos.x, y: (pos.y ?? 0) + 0.3, z: pos.z }, 2.5);
        decalRef.current?.spawn(pos, normal, 2.5);
        decalRef.current?.spawn({ x: pos.x, y: pos.y, z: pos.z }, { x: 0, y: 1, z: 0 }, 2.2);
      }
    });

    off2 = subscribe('combat:stagger' as Parameters<typeof subscribe>[0], (payload: unknown) => {
      const ev = payload as CombatStaggerEvent;
      const pos = toVec3(ev.targetPosition);
      if (!pos) return;
      const element = normalizeElement(ev.elementContrib);
      vfxRef.current?.spawn(element, pos, 1.4);
    });

    off3 = subscribe('combat:chain' as Parameters<typeof subscribe>[0], (payload: unknown) => {
      const ev = payload as CombatChainEvent;
      if (!Array.isArray(ev.chainTargets)) return;
      for (const target of ev.chainTargets) {
        const pos = toVec3(target.position);
        if (!pos) continue;
        vfxRef.current?.spawn('lightning', pos, target.magnitude ?? 0.7);
      }
    });

    // T3.1 — per-skill VFX scaled by the caster's mastery tier. The server's
    // skillVfxDescriptor sets particles.scale (1.0 novice → 1.8 grandmaster),
    // so a master's cast throws a visibly larger burst for the same damage.
    off4 = subscribe('combat:impact' as Parameters<typeof subscribe>[0], (payload: unknown) => {
      const ev = payload as CombatImpactEvent;
      const pos = toVec3(ev.targetPosition);
      if (!pos) return;
      const element = normalizeElement(ev.element ?? ev.vfx?.element);
      const damage = Number(ev.damage ?? 10);
      const masteryScale = Math.max(0.8, Math.min(2, ev.vfx?.particles?.scale ?? 1));
      const magnitude = Math.max(0.4, Math.min((damage / 30) * masteryScale, 3.2));
      vfxRef.current?.spawn(element, pos, magnitude);
    });

    // Perfect dodge / parry → brief bullet-time (the reward feel). The server
    // emits the dilation %; apply it through the shared time-scale primitive.
    const onPerfectDefense = (payload: unknown) => {
      const ev = (payload as { timeDilationPct?: number; durationMs?: number }) || {};
      const scale = Math.max(0.1, Math.min(1, 1 - (Number(ev.timeDilationPct) || 30) / 100));
      const durationMs = Number(ev.durationMs) || 500;
      import('@/lib/concordia/use-time-scale').then((m) => m.slowMo(scale, durationMs)).catch(() => {});
      window.dispatchEvent(new CustomEvent('concordia:perfect-defense', { detail: ev }));
    };
    off5 = subscribe('combat:dodge:perfect' as Parameters<typeof subscribe>[0], onPerfectDefense);
    off6 = subscribe('combat:parry:perfect' as Parameters<typeof subscribe>[0], onPerfectDefense);

    return () => {
      disposed = true;
      window.removeEventListener('concordia:scene-ready', sceneReady as EventListener);
      if (rafRef.current !== null) cancelAnimationFrame(rafRef.current);
      try { off1?.(); } catch { /* idempotent */ }
      try { off2?.(); } catch { /* idempotent */ }
      try { off3?.(); } catch { /* idempotent */ }
      try { off4?.(); } catch { /* idempotent */ }
      try { off5?.(); } catch { /* idempotent */ }
      try { off6?.(); } catch { /* idempotent */ }
      try { vfxRef.current?.dispose(); } catch { /* idempotent */ }
      try { decalRef.current?.dispose(); } catch { /* idempotent */ }
      vfxRef.current = null;
      decalRef.current = null;
    };
  }, []);

  return null;
}
