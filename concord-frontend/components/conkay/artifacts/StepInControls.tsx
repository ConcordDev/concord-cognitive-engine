'use client';

// components/conkay/artifacts/StepInControls.tsx
//
// Phase S2-b — the reusable r3f camera control behind ConKay's "step in"
// affordance. It renders one of two real controls inside an artifact's Canvas:
//
//   mode='orbit'  → drei <OrbitControls> (the existing inspect-from-outside view)
//   mode='walk'   → a first-person free-cam at REAL SCALE: WASD/arrows translate
//                   in metres, drag-look rotates. Movement + look math is the
//                   pure, unit-tested core in lib/conkay/step-in-camera.ts.
//
// HONEST-BY-CONSTRUCTION: the walk cam is driven ENTIRELY by useFrame (r3f's
// rAF loop) reading input refs — there is NO setInterval/setTimeout, so it
// passes the honest-hologram motion gate (scripts/check-conkay-honest-motion).
// Nothing here animates on a clock; every camera change is a pure function of a
// real input event or the real frame delta.
//
// It is renderer-agnostic: any artifact adapter that owns an r3f <Canvas> can
// drop <StepInControls> in and get the same orbit↔walk behaviour. The walk
// start pose + look target are supplied by the adapter from the artifact's real
// dimensions, so "real scale" is honest — the geometry is already in real units.

import { useEffect, useRef } from 'react';
import { useThree, useFrame } from '@react-three/fiber';
import { OrbitControls } from '@react-three/drei';
import {
  stepMoveDelta,
  nextLook,
  lookDirection,
  type StepInKeys,
} from '@/lib/conkay/step-in-camera';

export interface StepInControlsProps {
  mode: 'orbit' | 'walk';
  /** Orbit pivot / walk look-at focus, in world units. */
  target: [number, number, number];
  /** Camera position when walk mode is entered, in world units (metres). */
  walkStart: [number, number, number];
  /** Walk translation speed in metres/second. Default 2.2 (a calm walk). */
  moveSpeedMps?: number;
  /** Radians of look rotation per pixel dragged. Default 0.0032. */
  lookSensitivity?: number;
  /** Optional: prevent OrbitControls panning in orbit mode. */
  orbitEnablePan?: boolean;
}

const MOVE_KEY: Record<string, keyof StepInKeys> = {
  KeyW: 'forward',
  ArrowUp: 'forward',
  KeyS: 'back',
  ArrowDown: 'back',
  KeyA: 'left',
  ArrowLeft: 'left',
  KeyD: 'right',
  ArrowRight: 'right',
  Space: 'up',
  ShiftLeft: 'down',
  ShiftRight: 'down',
};

export function StepInControls({
  mode,
  target,
  walkStart,
  moveSpeedMps = 2.2,
  lookSensitivity = 0.0032,
  orbitEnablePan = false,
}: StepInControlsProps) {
  const camera = useThree((s) => s.camera);
  const gl = useThree((s) => s.gl);

  const keysRef = useRef<StepInKeys>({});
  const yawRef = useRef(0);
  const pitchRef = useRef(0);
  const draggingRef = useRef(false);
  const lastPointerRef = useRef<{ x: number; y: number } | null>(null);

  // On entering walk mode, place the camera at the real-scale start pose and
  // aim it at the focus target — deriving the initial yaw/pitch so the first
  // frame already looks the right way (no snap).
  useEffect(() => {
    if (mode !== 'walk') return;
    camera.position.set(walkStart[0], walkStart[1], walkStart[2]);
    const dx = target[0] - walkStart[0];
    const dy = target[1] - walkStart[1];
    const dz = target[2] - walkStart[2];
    const len = Math.hypot(dx, dy, dz) || 1;
    // Invert lookDirection: horizontal forward = (-sin yaw, *, -cos yaw).
    yawRef.current = Math.atan2(-dx / len, -dz / len);
    pitchRef.current = Math.asin(Math.max(-1, Math.min(1, dy / len)));
    keysRef.current = {};
    draggingRef.current = false;
    lastPointerRef.current = null;
  }, [mode, camera, walkStart, target]);

  // Walk input listeners — only bound while in walk mode.
  useEffect(() => {
    if (mode !== 'walk') return;
    const dom = gl.domElement;

    const onKeyDown = (e: KeyboardEvent) => {
      const k = MOVE_KEY[e.code];
      if (!k) return;
      keysRef.current[k] = true;
      // Stop the page scrolling on space/arrows while walking.
      e.preventDefault();
    };
    const onKeyUp = (e: KeyboardEvent) => {
      const k = MOVE_KEY[e.code];
      if (k) keysRef.current[k] = false;
    };
    const onPointerDown = (e: PointerEvent) => {
      draggingRef.current = true;
      lastPointerRef.current = { x: e.clientX, y: e.clientY };
      try {
        dom.setPointerCapture(e.pointerId);
      } catch {
        /* capture is best-effort */
      }
    };
    const onPointerMove = (e: PointerEvent) => {
      if (!draggingRef.current || !lastPointerRef.current) return;
      const dxp = e.clientX - lastPointerRef.current.x;
      const dyp = e.clientY - lastPointerRef.current.y;
      lastPointerRef.current = { x: e.clientX, y: e.clientY };
      const { yaw, pitch } = nextLook(
        yawRef.current,
        pitchRef.current,
        dxp,
        dyp,
        lookSensitivity,
      );
      yawRef.current = yaw;
      pitchRef.current = pitch;
    };
    const endDrag = () => {
      draggingRef.current = false;
      lastPointerRef.current = null;
    };

    window.addEventListener('keydown', onKeyDown);
    window.addEventListener('keyup', onKeyUp);
    dom.addEventListener('pointerdown', onPointerDown);
    dom.addEventListener('pointermove', onPointerMove);
    dom.addEventListener('pointerup', endDrag);
    dom.addEventListener('pointerleave', endDrag);
    dom.style.cursor = 'grab';

    return () => {
      window.removeEventListener('keydown', onKeyDown);
      window.removeEventListener('keyup', onKeyUp);
      dom.removeEventListener('pointerdown', onPointerDown);
      dom.removeEventListener('pointermove', onPointerMove);
      dom.removeEventListener('pointerup', endDrag);
      dom.removeEventListener('pointerleave', endDrag);
      dom.style.cursor = '';
      keysRef.current = {};
    };
  }, [mode, gl, lookSensitivity]);

  // Per-frame walk integration — rAF only, never a timer.
  useFrame((_s, dt) => {
    if (mode !== 'walk') return;
    const { dx, dy, dz } = stepMoveDelta(keysRef.current, yawRef.current, moveSpeedMps, dt);
    camera.position.x += dx;
    camera.position.y += dy;
    camera.position.z += dz;
    const dir = lookDirection(yawRef.current, pitchRef.current);
    camera.lookAt(camera.position.x + dir.x, camera.position.y + dir.y, camera.position.z + dir.z);
  });

  if (mode === 'orbit') {
    return <OrbitControls makeDefault target={target} enablePan={orbitEnablePan} />;
  }
  // Walk mode owns the camera imperatively via useFrame — no declarative control.
  return null;
}

export default StepInControls;
