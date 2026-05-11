'use client';

/**
 * QuestWaypointBeacon — Sprint 9 diegetic 3D waypoint.
 *
 * Renders a tall, gently-pulsing column of light at the active
 * objective's worldPos. Inspired by Elden Ring's stone-crone hints
 * + Tears of the Kingdom's Skyview-tower silhouettes: an unmissable
 * in-world pointer that doesn't break the fourth wall.
 *
 * Polls `guidance_waypoint.active_objective` every 8 s. When the
 * objective coords change, the beacon glides to the new spot over
 * 1.5 s rather than teleporting (avoids jarring jumps).
 *
 * Beacon is silent when there's no active objective — never reaches
 * the scene tree at all in that case.
 */

import { useEffect, useRef, useState, useCallback } from 'react';
import * as THREE from 'three';

interface Objective {
  kind: string;
  questId: number | null;
  description?: string;
  worldId: string;
  worldPos: { x: number; y?: number; z: number } | null;
  npcId: string | null;
}

interface ActiveObjectiveResponse {
  ok: boolean;
  objective: Objective | null;
  hint: string;
  worldId: string;
}

interface QuestWaypointBeaconProps {
  /** The Three.js scene to attach the beacon group to. Reads from
   * `window.__concordiaScene` if not passed (the ConcordiaScene component
   * stashes it there on init — same pattern as __concordiaRenderer). */
  scene?: THREE.Scene | null;
  /** Optional world filter — defaults to localStorage `concordia:activeWorldId`. */
  worldId?: string;
}

export default function QuestWaypointBeacon({ scene: sceneProp, worldId }: QuestWaypointBeaconProps) {
  const [scene, setScene] = useState<THREE.Scene | null>(sceneProp ?? null);
  // Poll for the global scene until ConcordiaScene boots it.
  useEffect(() => {
    if (sceneProp) {
      setScene(sceneProp);
      return;
    }
    const tick = () => {
      const w = window as unknown as { __concordiaScene?: THREE.Scene };
      if (w.__concordiaScene && w.__concordiaScene !== scene) {
        setScene(w.__concordiaScene);
      }
    };
    tick();
    const id = setInterval(tick, 1000);
    return () => clearInterval(id);
  }, [sceneProp, scene]);
  const groupRef = useRef<THREE.Group | null>(null);
  const targetPosRef = useRef<THREE.Vector3 | null>(null);
  const [objective, setObjective] = useState<Objective | null>(null);

  const resolveWorldId = useCallback(() => {
    if (worldId) return worldId;
    return typeof window !== 'undefined'
      ? localStorage.getItem('concordia:activeWorldId') || 'concordia-hub'
      : 'concordia-hub';
  }, [worldId]);

  // ── Poll active objective ───────────────────────────────────────
  const fetchObjective = useCallback(async () => {
    try {
      const r = await fetch('/api/lens/run', {
        method: 'POST', credentials: 'include',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          domain: 'guidance_waypoint', name: 'active_objective',
          input: { worldId: resolveWorldId() },
        }),
      });
      if (!r.ok) return;
      const j = await r.json();
      const payload = (j.result || j) as ActiveObjectiveResponse;
      if (payload?.ok) setObjective(payload.objective);
    } catch { /* offline — silent */ }
  }, [resolveWorldId]);

  useEffect(() => {
    fetchObjective();
    const id = setInterval(fetchObjective, 8000);
    return () => clearInterval(id);
  }, [fetchObjective]);

  // ── Build/destroy the Three.js group on objective change ───────
  useEffect(() => {
    if (!scene) return;

    // Tear down any existing beacon group first.
    if (groupRef.current) {
      scene.remove(groupRef.current);
      groupRef.current.traverse(o => {
        if ((o as THREE.Mesh).geometry) (o as THREE.Mesh).geometry.dispose();
        const mat = (o as THREE.Mesh).material as THREE.Material | THREE.Material[] | undefined;
        if (Array.isArray(mat)) mat.forEach(m => m.dispose());
        else if (mat) mat.dispose();
      });
      groupRef.current = null;
    }

    if (!objective?.worldPos) return;

    const group = new THREE.Group();
    group.name = 'sprint9:quest-waypoint';

    // Light column — a tall, semi-transparent cylinder with additive blend.
    const columnGeom = new THREE.CylinderGeometry(0.4, 0.6, 50, 12, 1, true);
    const beaconColor = objective.kind === 'premonition'
      ? new THREE.Color(0x9988ff)
      : objective.kind === 'lattice_born'
        ? new THREE.Color(0xff8866)
        : new THREE.Color(0x88ffaa);
    const columnMat = new THREE.MeshBasicMaterial({
      color: beaconColor,
      transparent: true,
      opacity: 0.32,
      blending: THREE.AdditiveBlending,
      side: THREE.DoubleSide,
      depthWrite: false,
    });
    const column = new THREE.Mesh(columnGeom, columnMat);
    column.position.y = 25;
    column.name = 'beacon:column';
    group.add(column);

    // Base ring — a flat torus that sits on the ground to localise the spot.
    const ringGeom = new THREE.TorusGeometry(2.2, 0.18, 8, 32);
    const ringMat = new THREE.MeshBasicMaterial({
      color: beaconColor,
      transparent: true,
      opacity: 0.65,
      blending: THREE.AdditiveBlending,
    });
    const ring = new THREE.Mesh(ringGeom, ringMat);
    ring.rotation.x = -Math.PI / 2;
    ring.position.y = 0.15;
    ring.name = 'beacon:ring';
    group.add(ring);

    // Hovering core — a small sphere that bobs gently to draw the eye.
    const coreGeom = new THREE.SphereGeometry(0.45, 16, 16);
    const coreMat = new THREE.MeshBasicMaterial({
      color: beaconColor,
      transparent: true,
      opacity: 0.9,
      blending: THREE.AdditiveBlending,
    });
    const core = new THREE.Mesh(coreGeom, coreMat);
    core.position.y = 3.0;
    core.name = 'beacon:core';
    group.add(core);

    // Position group at objective.
    const targetPos = new THREE.Vector3(
      objective.worldPos.x,
      objective.worldPos.y || 0,
      objective.worldPos.z,
    );
    group.position.copy(targetPos);
    targetPosRef.current = targetPos;
    scene.add(group);
    groupRef.current = group;

    return () => {
      if (groupRef.current) {
        scene.remove(groupRef.current);
        groupRef.current = null;
      }
    };
  }, [scene, objective]);

  // ── Pulse amplification on `?`-button press ─────────────────────
  const pulseUntilRef = useRef<number>(0);
  useEffect(() => {
    const onPulse = (e: Event) => {
      const detail = (e as CustomEvent).detail as { durationMs?: number } | undefined;
      pulseUntilRef.current = performance.now() + (detail?.durationMs ?? 4000);
    };
    window.addEventListener('concordia:waypoint-pulse', onPulse);
    return () => window.removeEventListener('concordia:waypoint-pulse', onPulse);
  }, []);

  // ── Animation loop — pulse + bob ────────────────────────────────
  useEffect(() => {
    let rafId: number | null = null;
    const animate = () => {
      const group = groupRef.current;
      if (group) {
        const t = performance.now() / 1000;
        const amplify = performance.now() < pulseUntilRef.current ? 2.4 : 1.0;
        const pulse = (0.85 + 0.15 * Math.sin(t * 2.2)) * amplify;
        const column = group.getObjectByName('beacon:column') as THREE.Mesh | undefined;
        const ring   = group.getObjectByName('beacon:ring')   as THREE.Mesh | undefined;
        const core   = group.getObjectByName('beacon:core')   as THREE.Mesh | undefined;
        if (column) (column.material as THREE.MeshBasicMaterial).opacity = 0.32 * pulse;
        if (ring) {
          (ring.material as THREE.MeshBasicMaterial).opacity = 0.65 * pulse;
          ring.rotation.z += 0.005;
        }
        if (core) {
          core.position.y = 3.0 + 0.6 * Math.sin(t * 1.6);
          (core.material as THREE.MeshBasicMaterial).opacity = 0.7 + 0.3 * pulse;
        }
      }
      rafId = requestAnimationFrame(animate);
    };
    rafId = requestAnimationFrame(animate);
    return () => {
      if (rafId !== null) cancelAnimationFrame(rafId);
    };
  }, []);

  // This component is render-less from React's perspective; it mutates
  // the Three.js scene imperatively. The HUD card lives separately.
  return null;
}
