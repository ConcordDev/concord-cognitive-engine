'use client';

// concord-frontend/components/conkay/ConKayScene.tsx
//
// ConKay's signature holographic surface — NOT the generic Jarvis dot-cloud.
// It renders the Concordia "world-tree of light": a luminous energy trunk that
// branches upward into a canopy of glowing galaxy-discs (the DTU lattice /
// sub-worlds), with drifting crystalline shards, on a dark cosmic field.
// GPU-driven (@react-three/fiber — the stack Concordia already uses), reactive
// to ConKay's real state machine + live mic amplitude. Full-bleed.

import { useMemo, useRef } from 'react';
import { Canvas, useFrame } from '@react-three/fiber';
import * as THREE from 'three';
import type { ConKayState } from './conkay-persona';
import { CONKAY_STATE_COLOR } from './ConKayHud';
import { useConkayHudStore } from './conkayHudStore';

// Cosmic palette for the galaxy-discs (the lattice canopy).
const GALAXY_PALETTE = ['#22d3ee', '#a855f7', '#34d399', '#fb7185', '#7dd3fc', '#c084fc', '#5eead4', '#f0abfc'];

// Soft radial-glow sprite texture (white core → transparent), shared by all
// galaxy-discs + shards. Generated once on the client.
function makeGlowTexture(): THREE.Texture {
  const s = 128;
  const c = document.createElement('canvas');
  c.width = c.height = s;
  const ctx = c.getContext('2d')!;
  const g = ctx.createRadialGradient(s / 2, s / 2, 0, s / 2, s / 2, s / 2);
  g.addColorStop(0, 'rgba(255,255,255,1)');
  g.addColorStop(0.25, 'rgba(255,255,255,0.85)');
  g.addColorStop(0.55, 'rgba(255,255,255,0.25)');
  g.addColorStop(1, 'rgba(255,255,255,0)');
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, s, s);
  const tex = new THREE.CanvasTexture(c);
  tex.needsUpdate = true;
  return tex;
}

interface Disc {
  pos: THREE.Vector3;
  rx: number; ry: number;
  color: THREE.Color;
  spin: number;
  phase: number;
}

// The canopy: glowing galaxy-discs fanned in an arc above the trunk.
function GalaxyCanopy({ stateRef, amplitudeRef, tex }: {
  stateRef: React.MutableRefObject<ConKayState>;
  amplitudeRef: React.MutableRefObject<number>;
  tex: THREE.Texture;
}) {
  const group = useRef<THREE.Group>(null);
  const discs = useMemo<Disc[]>(() => {
    const out: Disc[] = [];
    const N = 16;
    for (let i = 0; i < N; i++) {
      // Fan across an arc in the upper half.
      const f = i / (N - 1);
      const ang = Math.PI * (0.12 + 0.76 * f); // left→right across the top
      const radius = 3.0 + Math.sin(f * Math.PI) * 1.4 + (i % 3) * 0.35;
      const x = Math.cos(ang) * radius * 1.7;
      const y = 1.1 + Math.sin(ang) * radius * 0.9;
      const z = -1.2 - (i % 4) * 0.5;
      const rx = 0.55 + Math.random() * 0.7;
      out.push({
        pos: new THREE.Vector3(x, y, z),
        rx, ry: rx * (0.45 + Math.random() * 0.3),
        color: new THREE.Color(GALAXY_PALETTE[i % GALAXY_PALETTE.length]),
        spin: (Math.random() - 0.5) * 0.4,
        phase: Math.random() * Math.PI * 2,
      });
    }
    return out;
  }, []);
  const mats = useRef<THREE.SpriteMaterial[]>([]);

  useFrame((_, dt) => {
    const st = stateRef.current;
    const amp = amplitudeRef.current;
    const time = performance.now() / 1000;
    const energy = st === 'processing' || st === 'acting' ? 1.9 : st === 'presenting' ? 1.3 : st === 'listening' ? 1.05 : 0.7;
    // The canopy spins up while ConKay works (the galaxy-disc lattice "churning"),
    // and the discs pulse brighter the harder it's thinking.
    if (group.current) group.current.rotation.z += dt * 0.02 * energy;
    discs.forEach((d, i) => {
      const m = mats.current[i];
      if (!m) return;
      const pulse = 0.7 + Math.sin(time * (1.3 * energy) + d.phase) * 0.22 + amp * 0.5;
      m.opacity = Math.min(1, 0.45 * energy * pulse);
      m.rotation += d.spin * dt * energy;
    });
  });

  return (
    <group ref={group}>
      {discs.map((d, i) => (
        <sprite key={i} position={d.pos} scale={[d.rx * 2.4, d.ry * 2.4, 1]}>
          <spriteMaterial
            ref={(r) => { if (r) mats.current[i] = r; }}
            map={tex} color={d.color} transparent opacity={0.55}
            depthWrite={false} blending={THREE.AdditiveBlending}
          />
        </sprite>
      ))}
    </group>
  );
}

// The trunk: particles flowing UP along branching curves from the base into the
// canopy — the "world-tree" of light.
function EnergyTrunk({ stateRef, amplitudeRef }: {
  stateRef: React.MutableRefObject<ConKayState>;
  amplitudeRef: React.MutableRefObject<number>;
}) {
  const pts = useRef<THREE.Points>(null);
  const mat = useRef<THREE.PointsMaterial>(null);
  const color = useRef(new THREE.Color('#9fe8ff'));
  const target = useRef(new THREE.Color('#9fe8ff'));

  const N = 2600;
  const { curves, particles, positions } = useMemo(() => {
    const base = new THREE.Vector3(0, -2.6, 0);
    // A handful of branches fanning from the base up into the canopy arc.
    const curves: THREE.CatmullRomCurve3[] = [];
    const BR = 7;
    for (let b = 0; b < BR; b++) {
      const f = b / (BR - 1);
      const ang = Math.PI * (0.18 + 0.64 * f);
      const top = new THREE.Vector3(Math.cos(ang) * 3.4 * 1.7, 1.2 + Math.sin(ang) * 2.8, -1.0 - (b % 3) * 0.4);
      const mid = new THREE.Vector3(base.x + (top.x) * 0.32 + (Math.random() - 0.5) * 0.5, -0.7 + Math.random() * 0.6, base.z + (top.z) * 0.4);
      const mid2 = new THREE.Vector3(top.x * 0.7 + (Math.random() - 0.5) * 0.4, 0.5 + Math.random() * 0.5, top.z * 0.7);
      curves.push(new THREE.CatmullRomCurve3([base.clone(), mid, mid2, top]));
    }
    const particles = new Array(N).fill(0).map(() => ({
      c: Math.floor(Math.random() * BR),
      t0: Math.random(),
      speed: 0.04 + Math.random() * 0.10,
      jitter: 0.06 + Math.random() * 0.14,
      jx: (Math.random() - 0.5), jy: (Math.random() - 0.5), jz: (Math.random() - 0.5),
    }));
    const positions = new Float32Array(N * 3);
    return { curves, particles, positions };
  }, []);

  useFrame((_, dt) => {
    const st = stateRef.current;
    const amp = amplitudeRef.current;
    target.current.set(CONKAY_STATE_COLOR[st]).lerp(new THREE.Color('#bfefff'), 0.45);
    color.current.lerp(target.current, 0.05);
    const working = st === 'processing' || st === 'acting';
    if (mat.current) {
      mat.current.color.copy(color.current);
      // Brighter + bigger particles while working — the trunk visibly surges as
      // ConKay "builds", then settles when presenting.
      mat.current.opacity = (st === 'idle' ? 0.5 : working ? 0.95 : 0.8) + amp * 0.2;
      mat.current.size = 0.05 + (working ? 0.035 : st === 'presenting' ? 0.02 : 0) + amp * 0.035;
    }
    // Energy flow up the world-tree: a strong surge while building/acting, a
    // calm settle while presenting the result, gentle at rest.
    const flow = working ? 3.2 : st === 'presenting' ? 1.6 : st === 'listening' ? 1.5 : 0.8;
    const arr = positions;
    const tmp = new THREE.Vector3();
    for (let i = 0; i < N; i++) {
      const p = particles[i];
      p.t0 = (p.t0 + p.speed * flow * dt) % 1;
      curves[p.c].getPoint(p.t0, tmp);
      // taper jitter toward the top so the trunk is tight at the base, open in canopy
      const open = 0.3 + p.t0 * 1.2;
      arr[i * 3] = tmp.x + p.jx * p.jitter * open;
      arr[i * 3 + 1] = tmp.y + p.jy * p.jitter * open;
      arr[i * 3 + 2] = tmp.z + p.jz * p.jitter * open;
    }
    if (pts.current) (pts.current.geometry.getAttribute('position') as THREE.BufferAttribute).needsUpdate = true;
  });

  return (
    <points ref={pts}>
      <bufferGeometry>
        <bufferAttribute attach="attributes-position" args={[positions, 3]} />
      </bufferGeometry>
      <pointsMaterial ref={mat} size={0.05} transparent opacity={0.75} sizeAttenuation
        depthWrite={false} blending={THREE.AdditiveBlending} color="#bfefff" />
    </points>
  );
}

// Drifting crystalline shards / motes around the tree.
function Shards() {
  const pts = useRef<THREE.Points>(null);
  const N = 220;
  const positions = useMemo(() => {
    const a = new Float32Array(N * 3);
    for (let i = 0; i < N; i++) {
      a[i * 3] = (Math.random() - 0.5) * 12;
      a[i * 3 + 1] = (Math.random() - 0.5) * 8 - 0.5;
      a[i * 3 + 2] = -2 - Math.random() * 5;
    }
    return a;
  }, []);
  useFrame((_, dt) => { if (pts.current) pts.current.rotation.y += dt * 0.02; });
  return (
    <points ref={pts}>
      <bufferGeometry>
        <bufferAttribute attach="attributes-position" args={[positions, 3]} />
      </bufferGeometry>
      <pointsMaterial size={0.03} transparent opacity={0.5} sizeAttenuation depthWrite={false} blending={THREE.AdditiveBlending} color="#cbd5ff" />
    </points>
  );
}

// Orbital scanner rings — the JARVIS "it's working" tell, but HONEST: they spin
// IFF the backend reports a real macro in flight (Phase-2 binding). They read
// `inFlight` from the HUD store every frame via getState() (no 60fps selector),
// ease their angular velocity toward a target (working → spin, idle → 0), and
// brighten with the count of concurrent real runs. When ConKay is doing no real
// work the rings are still — there is no ambient motion to mistake for activity.
function OrbitalRings() {
  const group = useRef<THREE.Group>(null);
  const rings = useRef<THREE.Mesh[]>([]);
  const vel = useRef(0);          // current angular velocity (eased)
  const glow = useRef(0);         // current glow level (eased)
  const tilts = useMemo(
    () => [
      new THREE.Euler(Math.PI / 2.1, 0.0, 0.0),
      new THREE.Euler(Math.PI / 2.6, 0.6, 0.3),
      new THREE.Euler(Math.PI / 1.9, -0.5, -0.4),
    ],
    [],
  );
  const radii = [2.0, 2.55, 3.05];

  useFrame((_, dt) => {
    const inFlight = useConkayHudStore.getState().inFlight;
    const working = inFlight > 0;
    // Spin target scales gently with concurrent real runs; idle → exactly 0.
    const targetVel = working ? 0.6 + Math.min(inFlight, 4) * 0.18 : 0;
    const targetGlow = working ? Math.min(1, 0.35 + inFlight * 0.18) : 0.0;
    vel.current += (targetVel - vel.current) * Math.min(1, dt * 3);
    glow.current += (targetGlow - glow.current) * Math.min(1, dt * 3);
    if (group.current) group.current.rotation.z += vel.current * dt;
    rings.current.forEach((m, i) => {
      if (!m) return;
      // Counter-rotate alternate rings for the gyroscope read; all gated by vel.
      m.rotation.z += (i % 2 === 0 ? 1 : -1.4) * vel.current * dt;
      const mat = m.material as THREE.MeshBasicMaterial;
      mat.opacity = glow.current * (0.55 + 0.12 * i);
    });
  });

  return (
    <group ref={group} position={[0, 0.6, 0]}>
      {radii.map((r, i) => (
        <mesh
          key={i}
          rotation={tilts[i]}
          ref={(el) => { if (el) rings.current[i] = el; }}
        >
          <torusGeometry args={[r, 0.012 + i * 0.004, 8, 128]} />
          <meshBasicMaterial
            color={i === 1 ? '#fbbf24' : '#22d3ee'}
            transparent
            opacity={0}
            depthWrite={false}
            blending={THREE.AdditiveBlending}
          />
        </mesh>
      ))}
    </group>
  );
}

function Scene({ stateRef, amplitudeRef }: {
  stateRef: React.MutableRefObject<ConKayState>;
  amplitudeRef: React.MutableRefObject<number>;
}) {
  const tex = useMemo(() => makeGlowTexture(), []);
  // Scaled up + dropped so the trunk roots near the bottom edge and the canopy
  // reaches the top — the world-tree fills the frame rather than floating small.
  return (
    <group position={[0, -1.0, 0]} scale={1.35}>
      <Shards />
      <EnergyTrunk stateRef={stateRef} amplitudeRef={amplitudeRef} />
      <GalaxyCanopy stateRef={stateRef} amplitudeRef={amplitudeRef} tex={tex} />
      <OrbitalRings />
    </group>
  );
}

export function ConKayScene({ state, amplitudeRef, className }: {
  state: ConKayState;
  amplitudeRef: React.MutableRefObject<number>;
  className?: string;
}) {
  const stateRef = useRef<ConKayState>(state);
  stateRef.current = state;
  return (
    <div className={className} aria-hidden>
      <Canvas
        camera={{ position: [0, 0.5, 5.6], fov: 64 }}
        gl={{ alpha: true, antialias: true, powerPreference: 'high-performance' }}
        style={{ background: 'transparent' }}
        dpr={[1, 1.75]}
      >
        <Scene stateRef={stateRef} amplitudeRef={amplitudeRef} />
      </Canvas>
    </div>
  );
}

export default ConKayScene;
