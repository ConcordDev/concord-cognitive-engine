'use client';

/**
 * PowerClusterLayer — the Saints Row IV / Crackdown "data-cluster" pickup loop,
 * rendered diegetically in the 3D world. Floating power-orbs scattered across
 * Concordia; walk into one and it's CLAIMED (per-player), awarding progression
 * toward a traversal/combat power. The reason to live in the 3D world: you
 * upgrade your moves by exploring, not by grinding a menu.
 *
 * Mirrors WorldEventBeacons (attach a Three.js group to `window.__concordiaScene`,
 * animate via rAF). Pickup uses `window.__concordiaPlayerPos` (set by
 * AvatarSystem3D) — when the player is within CLAIM_R of an unclaimed orb it
 * fires `power-clusters.claim`; on success the orb pops + discovery juice plays.
 *
 * Render-less from React's view. Kill-switch: enabled={false} (or the backend
 * CONCORD_POWER_CLUSTERS=0, which returns an empty list).
 */

import { useCallback, useEffect, useRef } from 'react';
import * as THREE from 'three';
import { discoveryJuice } from '@/lib/concordia/juice';
import { pushSystem } from './SystemFeed';

interface Cluster {
  id: string;
  power_tag: string;
  tier: number;
  x: number;
  y: number;
  z: number;
  claimed: boolean;
}

interface Props {
  worldId: string;
  pollMs?: number;
  enabled?: boolean;
}

const CLAIM_R = 4.5;      // walk-into pickup radius (matches server CLAIM_RADIUS_M)
const ORB_Y = 1.6;        // float height above ground

const TAG_COLOR: Record<string, number> = {
  sprint: 0x4ad2ff,   // cyan — traversal
  flight: 0x9988ff,   // violet — air
  combat: 0xff5a4a,   // red — combat
  glyph: 0xffd24a,    // gold — magic
  focus: 0x66ffcc,    // teal — mind
  vitality: 0x88ffaa, // green — body
};

export default function PowerClusterLayer({ worldId, pollMs = 12000, enabled = true }: Props) {
  const orbsRef = useRef<Map<string, THREE.Group>>(new Map());
  const sceneRef = useRef<THREE.Scene | null>(null);
  const claimingRef = useRef<Set<string>>(new Set()); // in-flight claims (dedupe)

  const getScene = useCallback((): THREE.Scene | null => {
    if (sceneRef.current) return sceneRef.current;
    const w = window as unknown as { __concordiaScene?: THREE.Scene };
    sceneRef.current = w.__concordiaScene ?? null;
    return sceneRef.current;
  }, []);

  const disposeGroup = useCallback((scene: THREE.Scene, g: THREE.Group) => {
    scene.remove(g);
    g.traverse((o) => {
      const m = o as THREE.Mesh;
      if (m.geometry) m.geometry.dispose();
      const mat = m.material as THREE.Material | THREE.Material[] | undefined;
      if (Array.isArray(mat)) mat.forEach((x) => x.dispose());
      else if (mat) mat.dispose();
    });
  }, []);

  const buildOrb = useCallback((c: Cluster): THREE.Group => {
    const group = new THREE.Group();
    group.name = `power-cluster:${c.id}`;
    const color = new THREE.Color(TAG_COLOR[c.power_tag] ?? 0xffffff);
    // glowing core
    const core = new THREE.Mesh(
      new THREE.IcosahedronGeometry(0.4 + c.tier * 0.12, 0),
      new THREE.MeshBasicMaterial({ color, transparent: true, opacity: 0.92, blending: THREE.AdditiveBlending }),
    );
    core.name = 'orb:core';
    group.add(core);
    // halo ring
    const halo = new THREE.Mesh(
      new THREE.TorusGeometry(0.9, 0.07, 8, 24),
      new THREE.MeshBasicMaterial({ color, transparent: true, opacity: 0.5, blending: THREE.AdditiveBlending }),
    );
    halo.rotation.x = Math.PI / 2;
    halo.name = 'orb:halo';
    group.add(halo);
    // ground glow disc
    const disc = new THREE.Mesh(
      new THREE.CircleGeometry(1.1, 24),
      new THREE.MeshBasicMaterial({ color, transparent: true, opacity: 0.18, blending: THREE.AdditiveBlending, side: THREE.DoubleSide }),
    );
    disc.rotation.x = -Math.PI / 2;
    disc.position.y = -ORB_Y + 0.1;
    group.add(disc);
    group.position.set(c.x, ORB_Y, c.z);
    return group;
  }, []);

  // ── Poll unclaimed clusters + reconcile orbs ───────────────────
  const refresh = useCallback(async () => {
    if (!enabled) return;
    const scene = getScene();
    if (!scene) return;
    let clusters: Cluster[] = [];
    try {
      const r = await fetch('/api/lens/run', {
        method: 'POST', credentials: 'include',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ domain: 'power-clusters', name: 'list', input: { worldId, unclaimedOnly: true } }),
      });
      if (!r.ok) return;
      const j = await r.json();
      const payload = (j.result || j) as { ok?: boolean; clusters?: Cluster[] };
      clusters = Array.isArray(payload?.clusters) ? payload.clusters : [];
    } catch { return; }

    const live = new Set(clusters.map((c) => c.id));
    for (const [id, g] of orbsRef.current) {
      if (!live.has(id)) { disposeGroup(scene, g); orbsRef.current.delete(id); }
    }
    for (const c of clusters) {
      if (orbsRef.current.has(c.id)) continue;
      const g = buildOrb(c);
      scene.add(g);
      orbsRef.current.set(c.id, g);
    }
  }, [worldId, enabled, getScene, disposeGroup, buildOrb]);

  useEffect(() => {
    refresh();
    const id = setInterval(refresh, Math.max(4000, pollMs));
    return () => clearInterval(id);
  }, [refresh, pollMs]);

  useEffect(() => {
    const orbs = orbsRef.current; // capture at effect-run time for the cleanup
    return () => {
      const scene = sceneRef.current;
      if (scene) for (const g of orbs.values()) disposeGroup(scene, g);
      orbs.clear();
    };
  }, [worldId, disposeGroup]);

  // ── Claim on walk-into (proximity) ─────────────────────────────
  const claim = useCallback(async (clusterId: string, px: number, pz: number) => {
    if (claimingRef.current.has(clusterId)) return;
    claimingRef.current.add(clusterId);
    try {
      const r = await fetch('/api/lens/run', {
        method: 'POST', credentials: 'include',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ domain: 'power-clusters', name: 'claim', input: { worldId, clusterId, x: px, z: pz } }),
      });
      const j = await r.json().catch(() => ({}));
      const payload = (j.result || j) as { ok?: boolean; powerTag?: string; tier?: number; award?: unknown };
      if (payload?.ok) {
        const scene = sceneRef.current;
        const g = orbsRef.current.get(clusterId);
        if (scene && g) { disposeGroup(scene, g); orbsRef.current.delete(clusterId); }
        discoveryJuice();
        // Surface the claim on the System feed — the former
        // `concordia:power-cluster-claimed` dispatch had no consumer; the
        // diegetic effects (orb pop + discovery juice) already fire above, so
        // route the player-facing notice through the real System feed instead.
        const tagLabel = payload.powerTag ? String(payload.powerTag).replace(/[_-]/g, ' ') : 'Power cluster';
        pushSystem('POWER CLUSTER CLAIMED', payload.tier ? `${tagLabel} · tier ${payload.tier}` : tagLabel, 'power');
      }
    } catch { /* keep orb; retry next proximity pass */ }
    finally { claimingRef.current.delete(clusterId); }
  }, [worldId, disposeGroup]);

  // ── Animate (spin + bob) + proximity pickup ────────────────────
  useEffect(() => {
    let raf = 0;
    const animate = () => {
      raf = requestAnimationFrame(animate);
      const t = performance.now() / 1000;
      const ppos = (window as unknown as { __concordiaPlayerPos?: { x: number; z: number } }).__concordiaPlayerPos;
      for (const [id, g] of orbsRef.current) {
        const core = g.getObjectByName('orb:core');
        const halo = g.getObjectByName('orb:halo');
        if (core) core.rotation.y = t * 1.4;
        if (halo) halo.rotation.z = t * 0.8;
        g.position.y = ORB_Y + 0.18 * Math.sin(t * 1.8 + g.position.x);
        if (ppos) {
          const dx = g.position.x - ppos.x, dz = g.position.z - ppos.z;
          if (dx * dx + dz * dz <= CLAIM_R * CLAIM_R) claim(id, ppos.x, ppos.z);
        }
      }
    };
    raf = requestAnimationFrame(animate);
    return () => cancelAnimationFrame(raf);
  }, [claim]);

  return null;
}
