'use client';

/**
 * BeamViewport — the ConKay workspace's 3-D view of the study.
 *
 * The beam is drawn from the study's own dimensions, split into the same
 * elements the FEA model uses (one per solver member). Stress colouring is
 * each member's utilization exactly as engineering.beamStudy returned it, and
 * only while the inputs on screen are the inputs that were solved — after an
 * edit the colours turn off until the study is re-run.
 */

import { useEffect, useMemo } from 'react';
import { Canvas, useThree } from '@react-three/fiber';
import { Edges, GizmoHelper, GizmoViewport, Html, Line, OrbitControls } from '@react-three/drei';
import type { BeamDims, BeamSupport } from '@/lib/conkay/workspace-commands';
import { utilizationColor, type DisplayMode, type ViewPreset } from '@/lib/conkay/beam-view';

interface Props {
  dims: BeamDims;
  support: BeamSupport;
  /** Per-member utilization from the last solve, or null when not solved / stale. */
  utilization: number[] | null;
  view: ViewPreset;
  display: DisplayMode;
  showDims: boolean;
  /** Fraction of the panel's width covered on the left (the parameters card). */
  leftInset?: number;
}

const BASE = '#38bdf8';

/**
 * Frame the beam: distance is the bounding radius over the sine of the
 * narrower half field of view, so the whole beam and its labels fit whatever
 * the panel's aspect. `shiftX` aims left of centre so the beam sits clear of
 * the parameters panel when it is open.
 */
function CameraRig({ view, radius, shiftX }: { view: ViewPreset; radius: number; shiftX: number }) {
  const { camera, controls, size } = useThree() as unknown as {
    camera: { fov: number; position: { set: (x: number, y: number, z: number) => void }; lookAt: (x: number, y: number, z: number) => void; updateProjectionMatrix: () => void };
    controls: { target: { set: (x: number, y: number, z: number) => void }; update: () => void } | null;
    size: { width: number; height: number };
  };
  useEffect(() => {
    const aspect = size.width / Math.max(1, size.height);
    const vHalf = (camera.fov * Math.PI) / 360;
    const hHalf = Math.atan(Math.tan(vHalf) * aspect);
    const d = radius / Math.sin(Math.min(vHalf, hHalf));
    const dirs: Record<ViewPreset, [number, number, number]> = {
      isometric: [0.62, 0.45, 0.78],
      front: [0, 0, 1],
      top: [0, 1, 0.0001],
      end: [1, 0, 0],
    };
    const [x, y, z] = dirs[view];
    const len = Math.hypot(x, y, z);
    const tx = view === 'end' ? 0 : shiftX;
    camera.position.set(tx + (x / len) * d, (y / len) * d, (z / len) * d);
    camera.lookAt(tx, 0, 0);
    camera.updateProjectionMatrix();
    if (controls) { controls.target.set(tx, 0, 0); controls.update(); }
  }, [camera, controls, view, radius, shiftX, size.width, size.height]);
  return null;
}

function Label({ position, children }: { position: [number, number, number]; children: React.ReactNode }) {
  return (
    <Html position={position} center zIndexRange={[10, 0]} style={{ pointerEvents: 'none' }}>
      <span className="whitespace-nowrap rounded bg-[#06101c]/80 px-1.5 py-0.5 font-mono text-[11px] text-sky-200 shadow-[0_0_8px_rgba(56,189,248,0.35)]">
        {children}
      </span>
    </Html>
  );
}

function BeamScene({ dims, support, utilization, display, showDims }: Omit<Props, 'view'>) {
  // Scene units: the beam's length always spans 4 units.
  const s = 4 / dims.length;
  const L = dims.length * s;
  const H = dims.height * s;
  const W = dims.flangeWidth * s;
  const tf = dims.flangeThickness * s;
  const tw = dims.webThickness * s;
  const n = utilization && utilization.length > 0 ? utilization.length : 8;
  const seg = L / n;
  const showStress = (display === 'stress' || display === 'wire-stress') && utilization !== null;
  const wire = display === 'wire' || display === 'wire-stress';

  const parts = useMemo(() => {
    const out: Array<{ key: string; pos: [number, number, number]; size: [number, number, number]; i: number }> = [];
    for (let i = 0; i < n; i++) {
      const x = -L / 2 + seg * (i + 0.5);
      out.push({ key: `top-${i}`, pos: [x, H / 2 - tf / 2, 0], size: [seg, tf, W], i });
      out.push({ key: `web-${i}`, pos: [x, 0, 0], size: [seg, Math.max(H - 2 * tf, 1e-4), tw], i });
      out.push({ key: `bot-${i}`, pos: [x, -H / 2 + tf / 2, 0], size: [seg, tf, W], i });
    }
    return out;
  }, [n, L, seg, H, tf, W, tw]);

  const loadX = support === 'cantilever' ? L / 2 : 0;
  const arrowTop = H / 2 + Math.max(0.5, H * 0.9);
  const glyph = Math.max(0.12, H * 0.35);

  return (
    <group>
      {parts.map((p) => {
        const color = showStress ? utilizationColor(utilization![p.i]) : BASE;
        return (
          <mesh key={p.key} position={p.pos}>
            <boxGeometry args={p.size} />
            <meshStandardMaterial
              color={color}
              transparent
              opacity={wire ? 0.18 : 0.72}
              emissive={color}
              emissiveIntensity={showStress ? 0.35 : 0.2}
              roughness={0.35}
              metalness={0.1}
              depthWrite={!wire}
            />
            {wire && <Edges color={showStress ? color : '#7dd3fc'} />}
          </mesh>
        );
      })}

      {/* Supports */}
      {(support === 'fixed' || support === 'cantilever') && (
        <mesh position={[-L / 2 - 0.03, 0, 0]}>
          <boxGeometry args={[0.06, H * 1.8, W * 1.8]} />
          <meshStandardMaterial color="#94a3b8" transparent opacity={0.35} />
        </mesh>
      )}
      {support === 'fixed' && (
        <mesh position={[L / 2 + 0.03, 0, 0]}>
          <boxGeometry args={[0.06, H * 1.8, W * 1.8]} />
          <meshStandardMaterial color="#94a3b8" transparent opacity={0.35} />
        </mesh>
      )}
      {support === 'simply-supported' && (
        <>
          <mesh position={[-L / 2, -H / 2 - glyph / 2, 0]}>
            <coneGeometry args={[glyph * 0.6, glyph, 3]} />
            <meshStandardMaterial color="#94a3b8" transparent opacity={0.6} />
          </mesh>
          <mesh position={[L / 2, -H / 2 - glyph * 0.45, 0]}>
            <sphereGeometry args={[glyph * 0.45, 16, 12]} />
            <meshStandardMaterial color="#94a3b8" transparent opacity={0.6} />
          </mesh>
        </>
      )}

      {/* Point load */}
      <Line points={[[loadX, arrowTop, 0], [loadX, H / 2 + glyph * 0.8, 0]]} color="#f472b6" lineWidth={2} />
      <mesh position={[loadX, H / 2 + glyph * 0.4, 0]} rotation={[Math.PI, 0, 0]}>
        <coneGeometry args={[glyph * 0.3, glyph * 0.8, 12]} />
        <meshStandardMaterial color="#f472b6" emissive="#f472b6" emissiveIntensity={0.4} />
      </mesh>

      {showDims && (
        <>
          <Line points={[[-L / 2, H / 2 + 0.25, -W / 2], [L / 2, H / 2 + 0.25, -W / 2]]} color="#7dd3fc" lineWidth={1} dashed dashSize={0.05} gapSize={0.04} />
          <Label position={[-L / 4, H / 2 + 0.38, -W / 2]}>L = {dims.length} mm</Label>
          <Line points={[[L / 2 + 0.2, -H / 2, W / 2], [L / 2 + 0.2, H / 2, W / 2]]} color="#7dd3fc" lineWidth={1} />
          <Label position={[L / 2 + 0.55, 0, W / 2]}>D = {dims.height} mm</Label>
          <Line points={[[-L / 2, -H / 2 - 0.12, -W / 2], [-L / 2, -H / 2 - 0.12, W / 2]]} color="#7dd3fc" lineWidth={1} />
          <Label position={[-L / 2, -H / 2 - 0.3, W / 2]}>W = {dims.flangeWidth} mm</Label>
          <Label position={[L / 2 + 0.1, H / 2 + 0.12, W / 2 + 0.15]}>t_f = {dims.flangeThickness} mm</Label>
          <Label position={[L / 2 + 0.1, -H / 4, tw / 2 + 0.25]}>t_w = {dims.webThickness} mm</Label>
        </>
      )}
    </group>
  );
}

export default function BeamViewport({ dims, support, utilization, view, display, showDims, leftInset = 0 }: Props) {
  // Beam spans 4 units; labels reach ~0.6 beyond it.
  const radius = 2.7;
  const shiftX = -leftInset * 4;
  return (
    <Canvas
      camera={{ position: [4.5, 3.3, 5.7], fov: 38, near: 0.01, far: 200 }}
      dpr={[1, 2]}
      gl={{ antialias: true, alpha: true }}
      aria-label="3-D view of the I-beam study"
    >
      <ambientLight intensity={0.55} />
      <directionalLight position={[4, 6, 5]} intensity={1.1} />
      <directionalLight position={[-5, -2, -4]} intensity={0.35} />
      <gridHelper args={[12, 24, '#1e3a5f', '#0f1f33']} position={[0, -Math.max(0.6, (dims.height / dims.length) * 4 * 0.9), 0]} />
      <BeamScene dims={dims} support={support} utilization={utilization} display={display} showDims={showDims} />
      <OrbitControls makeDefault enableDamping dampingFactor={0.12} minDistance={1.2} maxDistance={30} />
      <CameraRig view={view} radius={radius} shiftX={shiftX} />
      <GizmoHelper alignment="bottom-left" margin={[56, 56]}>
        <GizmoViewport axisColors={['#f87171', '#4ade80', '#60a5fa']} labelColor="#0b1220" />
      </GizmoHelper>
    </Canvas>
  );
}
