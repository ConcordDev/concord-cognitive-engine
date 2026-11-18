'use client';

/**
 * BeamViewport — the Workshop's hologram table for the I-beam study.
 *
 * The beam is drawn from the study's own dimensions, split into the same
 * elements the FEA model uses (one per solver member).
 *
 * Its look is a pure function of real state:
 *  - unsolved / inputs edited since the solve → an open cyan wireframe;
 *  - a solve returns → the beam "materialises" (fill rises from wire to
 *    solid) coloured by each member's utilization exactly as
 *    engineering.beamStudy returned it; members over 100 % get red edges;
 *  - while a solve request is in flight → a scan plane sweeps the span
 *    (an indeterminate "working" mark — it never claims a percentage);
 *  - readout callouts (peak stress on the governing member, deflection at
 *    the load, safety factor at the support) appear only for a fresh solve.
 *
 * Labels on the model are plain DOM in an overlay above the canvas, moved
 * to their 3-D anchors by one per-frame projector. (drei's <Html> mounts a
 * separate React root per label and unmounts it synchronously during
 * commit — React's "synchronously unmount a root while React was already
 * rendering" error on every load. No extra roots here.)
 */

import { useEffect, useMemo, useRef } from 'react';
import { Vector3 } from 'three';
import type { Mesh, MeshStandardMaterial } from 'three';
import { Canvas, useFrame, useThree } from '@react-three/fiber';
import { Edges, GizmoHelper, GizmoViewport, Grid, Line, OrbitControls } from '@react-three/drei';
import { Bloom, EffectComposer } from '@react-three/postprocessing';
import type { BeamDims, BeamSupport } from '@/lib/conkay/workspace-commands';
import { utilizationColor, type DisplayMode, type ViewPreset } from '@/lib/conkay/beam-view';

/** The solver numbers a fresh solve puts on the model. Null = no callouts. */
export interface BeamCallouts {
  maxStressMPa: number;
  maxDeflectionMm: number;
  safetyFactor: number;
  pass: boolean;
  /** Changes on every new solve; drives the materialise transition. */
  solveKey: string;
}

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
  /** Clicking a dimension label focuses that parameter field (ConKay F13). */
  onDimFocus?: (key: keyof BeamDims) => void;
  /** A solve request is in flight right now. */
  solving?: boolean;
  /** Fresh-solve readouts, or null. */
  callouts?: BeamCallouts | null;
}

const ARC = '#59e3ff';
const ARC_EDGE = '#9af1ff';
const FAIL = '#ff4f61';
const LOAD = '#ffb547';
const SUPPORT = '#5f7d91';
const SUPPORT_EDGE = '#8fb3c7';

// ── Geometry shared by the scene and its labels ─────────────────────────────

/** Scene units: the beam's length always spans 4. */
function beamGeometry(dims: BeamDims) {
  const s = 4 / dims.length;
  return { L: dims.length * s, H: dims.height * s, W: dims.flangeWidth * s, tf: dims.flangeThickness * s, tw: dims.webThickness * s };
}

/** The governing member: where the solver put the peak utilization. */
function peakOf(utilization: number[] | null, L: number) {
  if (!utilization || utilization.length === 0) return null;
  let i = 0;
  for (let k = 1; k < utilization.length; k++) if (utilization[k] > utilization[i]) i = k;
  const seg = L / utilization.length;
  return { i, u: utilization[i], x: -L / 2 + seg * (i + 0.5) };
}

const loadXOf = (support: BeamSupport, L: number) => (support === 'cantilever' ? L / 2 : 0);

// ── Labels: DOM overlay + projector ─────────────────────────────────────────

interface SceneLabel {
  key: string;
  at: [number, number, number];
  text: React.ReactNode;
  onClick?: () => void;
  title?: string;
  tone?: 'warn' | 'fail';
}

function buildLabels(dims: BeamDims, support: BeamSupport, utilization: number[] | null, showDims: boolean, callouts: BeamCallouts | null, onDimFocus?: (key: keyof BeamDims) => void): SceneLabel[] {
  const { L, H, W, tw } = beamGeometry(dims);
  const out: SceneLabel[] = [];
  const dim = (key: keyof BeamDims, at: [number, number, number], text: string, title: string) =>
    out.push({ key: `dim-${key}`, at, text, title, onClick: onDimFocus ? () => onDimFocus(key) : undefined });
  if (showDims) {
    dim('length', [-L / 2.8, H / 2 + 0.38, -W / 2], `L = ${dims.length} mm`, 'Edit length');
    dim('height', [L / 2 - 0.05, H / 2 + 0.32, W / 2 + 0.1], `D = ${dims.height} mm`, 'Edit depth');
    dim('flangeWidth', [-L / 2, -H / 2 - 0.3, W / 2], `W = ${dims.flangeWidth} mm`, 'Edit flange width');
    dim('flangeThickness', [L / 2 + 0.1, H / 2 + 0.12, W / 2 + 0.15], `t_f = ${dims.flangeThickness} mm`, 'Edit flange thickness');
    dim('webThickness', [L / 2 + 0.1, -H / 4, tw / 2 + 0.25], `t_w = ${dims.webThickness} mm`, 'Edit web thickness');
  }
  const peak = peakOf(utilization, L);
  if (callouts && peak) {
    const loadX = loadXOf(support, L);
    out.push({
      key: 'c-stress', at: [peak.x + 0.75, H / 2 + 1.12, W / 2 + 0.2], tone: peak.u > 1 ? 'fail' : peak.u > 0.8 ? 'warn' : undefined,
      text: <>σ max <b>{callouts.maxStressMPa.toFixed(1)} MPa</b> · util {(peak.u * 100).toFixed(1)}%</>,
    });
    out.push({ key: 'c-defl', at: [loadX - 0.3, -H / 2 - 0.78, 0.2], text: <>δ max <b>{callouts.maxDeflectionMm.toFixed(3)} mm</b></> });
    out.push({
      key: 'c-sf', at: [-L / 2 - 0.2, H / 2 + 0.55, -W / 2], tone: callouts.pass ? undefined : 'fail',
      text: <>SF <b>{callouts.safetyFactor.toFixed(2)}</b> · {callouts.pass ? 'PASS' : 'FAIL'}</>,
    });
  }
  return out;
}

function LabelProjector({ labels, refs }: { labels: SceneLabel[]; refs: React.MutableRefObject<Array<HTMLElement | null>> }) {
  const { camera, size } = useThree();
  const v = useMemo(() => new Vector3(), []);
  useFrame(() => {
    for (let i = 0; i < labels.length; i++) {
      const el = refs.current[i];
      if (!el) continue;
      v.set(labels[i].at[0], labels[i].at[1], labels[i].at[2]).project(camera);
      el.style.opacity = v.z < 1 && v.z > -1 ? '1' : '0';
      el.style.transform = `translate(${((v.x + 1) / 2) * size.width}px, ${((1 - v.y) / 2) * size.height}px) translate(-50%, -50%)`;
    }
  });
  return null;
}

function LabelLayer({ labels, refs }: { labels: SceneLabel[]; refs: React.MutableRefObject<Array<HTMLElement | null>> }) {
  return (
    <div className="pointer-events-none absolute inset-0 z-[5] overflow-hidden">
      {labels.map((l, i) => (
        l.onClick ? (
          <button key={l.key} ref={(el) => { refs.current[i] = el; }} type="button" onClick={l.onClick} title={l.title}
            className="ws-callout pointer-events-auto absolute left-0 top-0 cursor-pointer" data-tone={l.tone} style={{ opacity: 0 }}>
            {l.text}
          </button>
        ) : (
          <span key={l.key} ref={(el) => { refs.current[i] = el; }} className="ws-callout absolute left-0 top-0" data-tone={l.tone} style={{ opacity: 0 }}>
            {l.text}
          </span>
        )
      ))}
    </div>
  );
}

// ── Camera ──────────────────────────────────────────────────────────────────

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

// ── The beam ────────────────────────────────────────────────────────────────

/** One FEA element's slab. Its fill rises from wire to solid when a solve lands. */
function Slab({ pos, size, color, edge, solid, wire, solveKey }: {
  pos: [number, number, number]; size: [number, number, number]; color: string; edge: string; solid: boolean; wire: boolean; solveKey: string;
}) {
  const mat = useRef<MeshStandardMaterial>(null);
  const t0 = useRef(0);
  // The materialise transition starts when a new solve arrives (solveKey).
  useEffect(() => { t0.current = typeof performance !== 'undefined' ? performance.now() : 0; }, [solveKey]);
  const target = solid ? (wire ? 0.32 : 0.86) : wire ? 0.05 : 0.5;
  useFrame(() => {
    const m = mat.current;
    if (!m) return;
    const k = solid ? Math.min(1, (performance.now() - t0.current) / 650) : 1;
    const eased = 1 - Math.pow(1 - k, 3);
    m.opacity = solid ? 0.05 + (target - 0.05) * eased : target;
  });
  return (
    <mesh position={pos}>
      <boxGeometry args={size} />
      <meshStandardMaterial
        ref={mat}
        color={color}
        transparent
        opacity={target}
        emissive={color}
        emissiveIntensity={solid ? 0.55 : 0.35}
        roughness={0.3}
        metalness={0.15}
        depthWrite={!wire && solid}
      />
      <Edges color={edge} />
    </mesh>
  );
}

/** Sweeps the span while (and only while) a solve request is in flight. */
function ScanPlane({ L, H, W }: { L: number; H: number; W: number }) {
  const ref = useRef<Mesh>(null);
  useFrame(({ clock }) => {
    if (!ref.current) return;
    const p = (clock.getElapsedTime() % 1.4) / 1.4;
    ref.current.position.x = -L / 2 + p * L;
  });
  return (
    <mesh ref={ref}>
      <boxGeometry args={[0.012, H * 1.6, W * 1.8]} />
      <meshBasicMaterial color={ARC} transparent opacity={0.55} />
    </mesh>
  );
}

function BeamScene({ dims, support, utilization, display, showDims, solving, callouts }: Omit<Props, 'view' | 'leftInset' | 'onDimFocus'>) {
  const { L, H, W, tf, tw } = beamGeometry(dims);
  const n = utilization && utilization.length > 0 ? utilization.length : 8;
  const seg = L / n;
  const solved = utilization !== null;
  const showStress = (display === 'stress' || display === 'wire-stress') && solved;
  const wire = display === 'wire' || display === 'wire-stress';
  const solveKey = callouts?.solveKey ?? 'none';

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

  const peak = useMemo(() => peakOf(utilization, L), [utilization, L]);
  const loadX = loadXOf(support, L);
  const arrowTop = H / 2 + Math.max(0.5, H * 0.9);
  const glyph = Math.max(0.12, H * 0.35);

  return (
    <group>
      {parts.map((p) => {
        const u = utilization ? utilization[p.i] : NaN;
        const color = showStress ? utilizationColor(u) : ARC;
        const edge = showStress ? (u > 1 ? FAIL : color) : ARC_EDGE;
        return <Slab key={p.key} pos={p.pos} size={p.size} color={color} edge={edge} solid={solved && showStress} wire={wire} solveKey={solveKey} />;
      })}

      {solving && <ScanPlane L={L} H={H} W={W} />}

      {/* Supports */}
      {(support === 'fixed' || support === 'cantilever') && (
        <mesh position={[-L / 2 - 0.03, 0, 0]}>
          <boxGeometry args={[0.06, H * 1.8, W * 1.8]} />
          <meshStandardMaterial color={SUPPORT} transparent opacity={0.3} />
          <Edges color={SUPPORT_EDGE} />
        </mesh>
      )}
      {support === 'fixed' && (
        <mesh position={[L / 2 + 0.03, 0, 0]}>
          <boxGeometry args={[0.06, H * 1.8, W * 1.8]} />
          <meshStandardMaterial color={SUPPORT} transparent opacity={0.3} />
          <Edges color={SUPPORT_EDGE} />
        </mesh>
      )}
      {support === 'simply-supported' && (
        <>
          <mesh position={[-L / 2, -H / 2 - glyph / 2, 0]}>
            <coneGeometry args={[glyph * 0.6, glyph, 3]} />
            <meshStandardMaterial color={SUPPORT} transparent opacity={0.45} />
            <Edges color={SUPPORT_EDGE} />
          </mesh>
          <mesh position={[L / 2, -H / 2 - glyph * 0.45, 0]}>
            <sphereGeometry args={[glyph * 0.45, 16, 12]} />
            <meshStandardMaterial color={SUPPORT} transparent opacity={0.45} wireframe />
          </mesh>
        </>
      )}

      {/* Point load */}
      <Line points={[[loadX, arrowTop, 0], [loadX, H / 2 + glyph * 0.8, 0]]} color={LOAD} lineWidth={2} />
      <mesh position={[loadX, H / 2 + glyph * 0.4, 0]} rotation={[Math.PI, 0, 0]}>
        <coneGeometry args={[glyph * 0.3, glyph * 0.8, 12]} />
        <meshStandardMaterial color={LOAD} emissive={LOAD} emissiveIntensity={0.8} />
      </mesh>

      {/* Dimension lines (their tags are DOM, see LabelLayer). */}
      {showDims && (
        <>
          <Line points={[[-L / 2, H / 2 + 0.25, -W / 2], [L / 2, H / 2 + 0.25, -W / 2]]} color={ARC_EDGE} lineWidth={1} dashed dashSize={0.05} gapSize={0.04} />
          <Line points={[[L / 2 + 0.2, -H / 2, W / 2], [L / 2 + 0.2, H / 2, W / 2]]} color={ARC_EDGE} lineWidth={1} />
          <Line points={[[-L / 2, -H / 2 - 0.12, -W / 2], [-L / 2, -H / 2 - 0.12, W / 2]]} color={ARC_EDGE} lineWidth={1} />
        </>
      )}

      {/* Leader lines for the solver readouts — fresh solves only. */}
      {callouts && peak && (
        <>
          <Line points={[[peak.x, H / 2, W / 2], [peak.x + 0.75, H / 2 + 1.0, W / 2 + 0.2]]} color={peak.u > 1 ? FAIL : ARC} lineWidth={1} />
          <Line points={[[loadX, -H / 2, 0], [loadX - 0.3, -H / 2 - 0.65, 0.2]]} color={ARC} lineWidth={1} />
        </>
      )}
    </group>
  );
}

export default function BeamViewport({ dims, support, utilization, view, display, showDims, leftInset = 0, onDimFocus, solving = false, callouts = null }: Props) {
  // Beam spans 4 units; labels reach ~0.6 beyond it.
  const radius = 2.9;
  const shiftX = -leftInset * 4;
  const floorY = -Math.max(0.6, (dims.height / dims.length) * 4 * 0.9);
  const labels = useMemo(
    () => buildLabels(dims, support, utilization, showDims, callouts, onDimFocus),
    [dims, support, utilization, showDims, callouts, onDimFocus],
  );
  const labelRefs = useRef<Array<HTMLElement | null>>([]);
  return (
    <div className="absolute inset-0">
      <Canvas
        camera={{ position: [4.5, 3.3, 5.7], fov: 38, near: 0.01, far: 200 }}
        dpr={[1, 2]}
        gl={{ antialias: true, alpha: true }}
        aria-label="3-D hologram of the I-beam study"
      >
        <ambientLight intensity={0.45} />
        <directionalLight position={[4, 6, 5]} intensity={0.9} />
        <directionalLight position={[-5, -2, -4]} intensity={0.3} color={ARC} />
        <Grid
          position={[0, floorY, 0]}
          infiniteGrid
          cellSize={0.25}
          cellThickness={0.6}
          cellColor="#123447"
          sectionSize={1}
          sectionThickness={1}
          sectionColor="#1d6a86"
          fadeDistance={14}
          fadeStrength={1.6}
        />
        <BeamScene dims={dims} support={support} utilization={utilization} display={display} showDims={showDims} solving={solving} callouts={callouts} />
        <LabelProjector labels={labels} refs={labelRefs} />
        <OrbitControls makeDefault enableDamping dampingFactor={0.12} minDistance={1.2} maxDistance={30} />
        <CameraRig view={view} radius={radius} shiftX={shiftX} />
        <GizmoHelper alignment="bottom-left" margin={[56, 56]}>
          <GizmoViewport axisColors={['#ff4f61', '#7af5c4', '#59e3ff']} labelColor="#03060a" />
        </GizmoHelper>
        <EffectComposer multisampling={0}>
          <Bloom mipmapBlur intensity={0.85} luminanceThreshold={0.25} luminanceSmoothing={0.3} radius={0.7} />
        </EffectComposer>
      </Canvas>
      <LabelLayer labels={labels} refs={labelRefs} />
    </div>
  );
}
