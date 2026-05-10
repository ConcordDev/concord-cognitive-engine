'use client';

/**
 * UnderwaterPostFX — Sprint C / X1+X2+X3 (upgraded from DOM hack to real
 * shader during Sprint D).
 *
 * Mounts a full-screen ShaderMaterial pass when the player is below the
 * water plane. Uses the underwater-pass.ts shader (depth-based blue/green
 * tint, fog, caustic projection, particulates, low-oxygen vignette,
 * cheap screen-space god rays).
 *
 * For non-R3F scenes that prefer the DOM overlay (debugging, no-WebGL2
 * fallback), keeps the simple overlay path as a fallback.
 *
 * Per-frame oxygen polling driven by the same /api/lens/run macro
 * shipped in Sprint C.
 */

import * as THREE from 'three';
import { useEffect, useRef, useState } from 'react';
import { createUnderwaterMaterial, BIOME_TINT } from '@/lib/world-lens/underwater-pass';

interface SwimSnapshot {
  depth: number;
  isSwimming: boolean;
}

interface OxygenSnapshot {
  oxygen_pct: number;
}

interface Props {
  worldId: string;
  intervalMs?: number;
  /** Optional biome name for tint selection. */
  biome?: keyof typeof BIOME_TINT;
  /** Sun direction in world space (for screen-space god-rays). */
  sunDir?: { x: number; y: number; z: number };
  /** Camera object so we can read viewProjection for sun-screen-projection. */
  camera?: THREE.Camera | null;
  /** Optional overlay style instead of WebGL pass (for tests / no-canvas). */
  fallbackToDOM?: boolean;
}

export default function UnderwaterPostFX({
  worldId,
  intervalMs = 200,
  biome = 'temperate',
  sunDir = { x: 0.3, y: 0.8, z: 0.5 },
  camera = null,
  fallbackToDOM = false,
}: Props) {
  const [swim, setSwim] = useState<SwimSnapshot>({ depth: 0, isSwimming: false });
  const [oxygen, setOxygen] = useState<OxygenSnapshot>({ oxygen_pct: 100 });
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const rendererRef = useRef<THREE.WebGLRenderer | null>(null);
  const sceneRef = useRef<THREE.Scene | null>(null);
  const camRef = useRef<THREE.OrthographicCamera | null>(null);
  const matRef = useRef<THREE.ShaderMaterial | null>(null);
  const startTime = useRef(performance.now() / 1000);
  const rafRef = useRef<number | null>(null);

  // Poll swim state.
  useEffect(() => {
    const interval = window.setInterval(() => {
      const s = (window as unknown as { __concordia_swim_state?: SwimSnapshot }).__concordia_swim_state;
      if (s) setSwim(s);
    }, intervalMs);
    return () => window.clearInterval(interval);
  }, [intervalMs]);

  // Poll oxygen.
  useEffect(() => {
    if (!swim.isSwimming || swim.depth <= 0.3) {
      setOxygen({ oxygen_pct: 100 });
      return;
    }
    let cancelled = false;
    const tick = async () => {
      try {
        const r = await fetch('/api/lens/run', {
          method: 'POST', credentials: 'include',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ domain: 'oxygen', name: 'tick', input: { worldId, depth: swim.depth } }),
        });
        if (!r.ok) return;
        const j = await r.json();
        if (!cancelled && typeof j?.oxygen_pct === 'number') setOxygen({ oxygen_pct: j.oxygen_pct });
      } catch { /* fine */ }
    };
    void tick();
    const interval = window.setInterval(tick, 2000);
    return () => { cancelled = true; window.clearInterval(interval); };
  }, [worldId, swim.isSwimming, swim.depth]);

  // Setup renderer + scene + material once.
  useEffect(() => {
    if (fallbackToDOM) return;
    const canvas = canvasRef.current;
    if (!canvas) return;
    const renderer = new THREE.WebGLRenderer({ canvas, alpha: true });
    renderer.setPixelRatio(window.devicePixelRatio);
    renderer.setSize(window.innerWidth, window.innerHeight);
    rendererRef.current = renderer;

    const scene = new THREE.Scene();
    sceneRef.current = scene;
    const cam = new THREE.OrthographicCamera(-1, 1, 1, -1, 0, 1);
    camRef.current = cam;

    const mat = createUnderwaterMaterial();
    mat.uniforms.uTint.value = new THREE.Color(BIOME_TINT[biome] ?? BIOME_TINT.temperate);
    mat.uniforms.uResolution.value = new THREE.Vector2(window.innerWidth, window.innerHeight);
    matRef.current = mat;

    const quad = new THREE.Mesh(new THREE.PlaneGeometry(2, 2), mat);
    scene.add(quad);

    const onResize = () => {
      renderer.setSize(window.innerWidth, window.innerHeight);
      mat.uniforms.uResolution.value.set(window.innerWidth, window.innerHeight);
    };
    window.addEventListener('resize', onResize);

    return () => {
      window.removeEventListener('resize', onResize);
      mat.dispose();
      quad.geometry.dispose();
      renderer.dispose();
    };
  }, [biome, fallbackToDOM]);

  // Render loop.
  useEffect(() => {
    if (fallbackToDOM) return;
    if (!swim.isSwimming || swim.depth < 0.3) return;
    const tick = () => {
      const renderer = rendererRef.current;
      const scene = sceneRef.current;
      const cam = camRef.current;
      const mat = matRef.current;
      if (!renderer || !scene || !cam || !mat) {
        rafRef.current = requestAnimationFrame(tick);
        return;
      }
      const now = performance.now() / 1000 - startTime.current;
      mat.uniforms.uTime.value = now;
      mat.uniforms.uCameraDepth.value = swim.depth;
      mat.uniforms.uOxygenPct.value = oxygen.oxygen_pct;

      // Project sun direction to screen.
      if (camera && sunDir) {
        const v = new THREE.Vector3(sunDir.x, sunDir.y, sunDir.z).normalize();
        v.add(camera.position);
        v.project(camera);
        // v.x/y now in NDC ([-1,1]) — convert to UV [0,1].
        mat.uniforms.uSunDirScreen.value.set(v.x * 0.5 + 0.5, 1 - (v.y * 0.5 + 0.5));
      } else {
        mat.uniforms.uSunDirScreen.value.set(0.5, 0.15);
      }

      renderer.render(scene, cam);
      rafRef.current = requestAnimationFrame(tick);
    };
    rafRef.current = requestAnimationFrame(tick);
    return () => { if (rafRef.current) cancelAnimationFrame(rafRef.current); };
  }, [swim.isSwimming, swim.depth, oxygen.oxygen_pct, camera, sunDir, fallbackToDOM]);

  if (!swim.isSwimming || swim.depth < 0.3) return null;

  if (fallbackToDOM) {
    const depthFactor = Math.min(1, swim.depth / 15);
    const tintAlpha = 0.15 + depthFactor * 0.35;
    return (
      <div
        aria-hidden
        style={{
          position: 'fixed', inset: 0, pointerEvents: 'none', zIndex: 9,
          background: `rgba(60, 110, 130, ${tintAlpha})`,
          mixBlendMode: 'multiply',
        }}
      />
    );
  }

  return (
    <>
      <canvas
        ref={canvasRef}
        aria-hidden
        style={{
          position: 'fixed', inset: 0, pointerEvents: 'none', zIndex: 9,
          mixBlendMode: 'screen',
        }}
      />
      {/* Oxygen HUD */}
      <div style={{
        position: 'fixed', bottom: 24, left: '50%', transform: 'translateX(-50%)',
        background: 'rgba(0,0,0,0.6)', padding: '6px 14px', zIndex: 10,
        borderRadius: 4, border: `1px solid ${oxygen.oxygen_pct < 30 ? '#a44' : '#446'}`,
        color: oxygen.oxygen_pct < 30 ? '#f88' : '#dde',
        font: '12px/1.2 -apple-system, system-ui, sans-serif', letterSpacing: '0.05em',
        pointerEvents: 'none',
      }}>
        OXYGEN {oxygen.oxygen_pct.toFixed(0)}% · DEPTH {swim.depth.toFixed(1)}m
      </div>
    </>
  );
}
