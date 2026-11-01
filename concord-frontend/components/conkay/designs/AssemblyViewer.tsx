'use client';

/**
 * AssemblyViewer — the parametric vehicle, orbitable.
 * Studio is the default: clearcoat paint (the same graphite as the Cycles
 * render and the presentation GLB, or silver), transmissive glass, one mesh
 * per wheel, a same-origin CC0 sky HDRI for lighting and reflections over a flat
 * studio backdrop (three.js RoomEnvironment until it loads, and if it fails).
 * Engineering flattens the shading and shows every envelope.
 * Selection, hide, isolate, transparency, explode and a section plane work
 * in both. A narrow screen is view-only: the canvas stays, the controls do not.
 */

import { useCallback, useEffect, useMemo, useState } from 'react';
import { Canvas, useThree } from '@react-three/fiber';
import { ContactShadows, OrbitControls } from '@react-three/drei';
import * as THREE from 'three';
import { RoomEnvironment } from 'three/examples/jsm/environments/RoomEnvironment.js';
import { HDRLoader } from 'three/examples/jsm/loaders/HDRLoader.js';
import { explodedShift, sectionPlane, toThree, explodeAmountFor, EXPLODE_SUBSYSTEMS, type ExplodePart } from '@/lib/conkay/assembly-view';
import { STUDIO_HDRI_URL, STUDIO_PAINTS, type StudioPaintId } from '@/lib/conkay/present-paint';
import { workbenchClient, type FitCheckFlip, type PartAnalysis, type WorkbenchClient, type WorkbenchKnob, type WorkbenchView } from '@/lib/conkay/workbench-api';
import { feaUtilToColor } from '@/lib/conkay/fea-util-color';

export interface AssemblyMesh {
  positions: number[];
  normals?: number[];
  indices: number[];
}
export type GlassField = number[] | AssemblyMesh;
/** cad.design-surface layers drawn on the analysed solid (server/lib/conkay/assembly/surface-overlays.js). */
export interface SurfaceOverlays {
  source: 'cad.design-surface';
  onSolid: 'cad.body';
  skinTrimmed: false;
  panelLines: { id: string; kind: string; side?: string; polylines: number[][]; samples: number; missed: number }[];
  glass: { id: string; kind: string; positions: number[]; indices: number[]; samples: number; missed: number }[];
  lamps: { id: string; kind: string; positions: number[]; indices: number[]; samples: number; missed: number }[];
  coverage?: { samples: number; missed: number; note?: string };
  conflicts?: { id: string; reference: string; package: string; copied: boolean }[];
}
export interface VehicleAssembly {
  schema?: string;
  verification?: { statement: string; geometricOnly?: string[]; geometricOnlyParts?: string[] };
  coordinateSystem?: { axes?: Record<string, string>; origin?: string };
  components: (ExplodePart & {
    name: string;
    group: string;
    role: string;
    half: number[] | null;
    geometry: { kind: string; label?: string };
    mesh?: { outline?: number[][]; side?: string; positions?: number[]; normals?: number[]; indices?: number[] };
    parameters?: { id: string; name: string; value: number | string; unit: string; provenance: { state: string; source?: string; note?: string } }[];
    relationships?: { kind: string; target: string; note?: string }[];
    /** Per-part solver analyses joined from a live session (HANDOFF-3 A4); absent on a saved snapshot. */
    analyses?: PartAnalysis[];
    /** 'styling-loft': placed on the styled loft, which is not the analysed solid drawn here. */
    placedOn?: string;
  })[];
  checks: { id: string; status: 'pass' | 'warn' | 'fail'; detail: string; outside?: string[]; parts?: string[]; clearanceM?: number | null }[];
  surface: { source?: 'cad.body' | 'styling'; overlays?: SurfaceOverlays | null; mesh: { positions: number[]; normals: number[]; paint: number[]; glass: GlassField; arch?: AssemblyMesh; bounds: { min: number[]; max: number[] } } };
  wheel: { tire: AssemblyMesh; rim: AssemblyMesh; disc: AssemblyMesh; caliper: AssemblyMesh; spec?: { spokes?: number } };
  detail?: { lamp?: AssemblyMesh; grille?: AssemblyMesh };
}

const GROUP_COLOR: Record<string, string> = {
  exterior: '#9aa3ad', wheels: '#2a2a2a', chassis: '#8d6a45', powertrain: '#c45c26', interior: '#4c6b8a', storage: '#6b7c5a',
};

function useNarrow() {
  const [narrow, setNarrow] = useState(false);
  useEffect(() => {
    if (typeof window.matchMedia !== 'function') return;
    const q = window.matchMedia('(max-width: 767px)');
    const apply = () => setNarrow(q.matches);
    apply();
    q.addEventListener?.('change', apply);
    return () => q.removeEventListener?.('change', apply);
  }, []);
  return narrow;
}

/** Vehicle Z-up vertices and normals into three.js Y-up. Placement is converted separately. */
function vehicleMesh(mesh: AssemblyMesh): AssemblyMesh {
  const positions: number[] = [];
  const normals: number[] = [];
  const hasN = !!mesh.normals && mesh.normals.length === mesh.positions.length;
  for (let i = 0; i < mesh.positions.length; i += 3) {
    const x = mesh.positions[i];
    const y = mesh.positions[i + 1];
    const z = mesh.positions[i + 2];
    positions.push(x, z, -y);
    if (hasN && mesh.normals) normals.push(mesh.normals[i], mesh.normals[i + 2], -mesh.normals[i + 1]);
  }
  return { positions, normals: hasN ? normals : undefined, indices: mesh.indices };
}

function geo(mesh: AssemblyMesh, index?: number[]) {
  const v = vehicleMesh(mesh);
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(v.positions, 3));
  if (v.normals && v.normals.length === v.positions.length) g.setAttribute('normal', new THREE.Float32BufferAttribute(v.normals, 3));
  g.setIndex(index || v.indices);
  if (!v.normals) g.computeVertexNormals();
  return g;
}

function glassGeometry(assembly: VehicleAssembly) {
  const g = assembly.surface.mesh.glass;
  if (g && !Array.isArray(g) && g.positions) return geo(g);
  return geo(
    { positions: assembly.surface.mesh.positions, normals: assembly.surface.mesh.normals, indices: Array.isArray(g) ? g : [] },
  );
}

function StudioEnv({ hdriUrl }: { hdriUrl: string | null }) {
  const gl = useThree((s) => s.gl);
  const room = useMemo(() => {
    const pmrem = new THREE.PMREMGenerator(gl);
    const env = pmrem.fromScene(new RoomEnvironment(), 0.04).texture;
    pmrem.dispose();
    return env;
  }, [gl]);
  useEffect(() => () => { room.dispose(); }, [room]);
  const [sky, setSky] = useState<THREE.Texture | null>(null);
  useEffect(() => {
    if (!hdriUrl) return;
    let live = true;
    let made: THREE.Texture | null = null;
    new HDRLoader().load(hdriUrl, (eq) => {
      if (!live) { eq.dispose(); return; }
      const pmrem = new THREE.PMREMGenerator(gl);
      made = pmrem.fromEquirectangular(eq).texture;
      pmrem.dispose();
      eq.dispose();
      setSky(made);
    }, undefined, () => { /* the room environment stays */ });
    return () => { live = false; made?.dispose(); setSky(null); };
  }, [gl, hdriUrl]);
  return <primitive object={sky || room} attach="environment" />;
}

function patchGeo(p: { positions: number[]; indices: number[] }) {
  const g = geo({ positions: p.positions, indices: p.indices });
  g.computeVertexNormals();
  return g;
}

/** Panel lines, glass and lamp slots on the analysed solid. Drawing only: the solid is not cut. */
function OverlayLayer({ overlays, mode, clip }: { overlays: SurfaceOverlays; mode: 'studio' | 'engineering'; clip: THREE.Plane[] }) {
  const glass = useMemo(() => overlays.glass.filter((g) => g.indices.length).map((g) => ({ id: g.id, geometry: patchGeo(g) })), [overlays]);
  const lamps = useMemo(() => overlays.lamps.filter((l) => l.indices.length).map((l) => ({ id: l.id, geometry: patchGeo(l) })), [overlays]);
  const lineMat = useMemo(() => new THREE.LineBasicMaterial({ color: mode === 'studio' ? '#0a0b0d' : '#1f4d6e', clippingPlanes: clip }), [mode, clip]);
  const lines = useMemo(() => overlays.panelLines.flatMap((l) => l.polylines.map((run, k) => {
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.Float32BufferAttribute(vehicleMesh({ positions: run, indices: [] }).positions, 3));
    return { id: `${l.id}-${k}`, geometry: g };
  })), [overlays]);
  const lineObjects = useMemo(() => lines.map((l) => ({ id: l.id, object: new THREE.Line(l.geometry, lineMat) })), [lines, lineMat]);
  useEffect(() => () => { for (const x of [...glass, ...lamps, ...lines]) x.geometry.dispose(); }, [glass, lamps, lines]);
  useEffect(() => () => { lineMat.dispose(); }, [lineMat]);
  return (
    <group>
      {glass.map((g) => (
        <mesh key={g.id} geometry={g.geometry}>
          {mode === 'studio'
            ? <meshPhysicalMaterial color="#05080b" metalness={0} roughness={0.03} clearcoat={1} clearcoatRoughness={0.02} clippingPlanes={clip} />
            : <meshBasicMaterial color="#5aa0d8" transparent opacity={0.35} side={THREE.DoubleSide} clippingPlanes={clip} />}
        </mesh>
      ))}
      {lamps.map((l) => (
        <mesh key={l.id} geometry={l.geometry}>
          <meshStandardMaterial color="#eef4ff" emissive="#f7fbff" emissiveIntensity={mode === 'studio' ? 1.8 : 0.5} roughness={0.1} clippingPlanes={clip} />
        </mesh>
      ))}
      {lineObjects.map((l) => <primitive key={l.id} object={l.object} />)}
    </group>
  );
}

/** A status outline around a part the fit checks name: the door outlines' line idiom, in the check's colour. */
function MarkBox({ part, position, color, clip }: {
  part: ExplodePart & { half: number[] | null };
  position: [number, number, number];
  color: string;
  clip: THREE.Plane[];
}) {
  const edges = useMemo(() => new THREE.EdgesGeometry(new THREE.BoxGeometry((part.half?.[0] ?? 0) * 2 + 0.02, (part.half?.[2] ?? 0) * 2 + 0.02, (part.half?.[1] ?? 0) * 2 + 0.02)), [part]);
  const mat = useMemo(() => new THREE.LineBasicMaterial({ color, clippingPlanes: clip }), [color, clip]);
  const obj = useMemo(() => new THREE.LineSegments(edges, mat), [edges, mat]);
  useEffect(() => () => { edges.dispose(); }, [edges]);
  useEffect(() => () => { mat.dispose(); }, [mat]);
  return <primitive object={obj} position={position} />;
}

/** The parts a fit check names as its own (containment's outside list today; a check's parts when present). */
function checkParts(c: VehicleAssembly['checks'][number]): string[] {
  return c.parts ?? c.outside ?? [];
}

/** Check status colours, shared by the marks, the Checks overlay and the inspector. */
const CHECK_HEX: Record<'pass' | 'warn' | 'fail', string> = { pass: '#6ee7b7', warn: '#fcd34d', fail: '#fb7185' };

/** An analysis key-output value, verbatim from the solver's envelope (6dp at most, never rescaled). */
function fmtAnalysisValue(v: number | string): string {
  if (typeof v !== 'number') return v;
  return Number.isInteger(v) ? String(v) : String(Math.round(v * 1e6) / 1e6);
}
const CHECK_SEVERITY: Record<'pass' | 'warn' | 'fail', number> = { pass: 0, warn: 1, fail: 2 };

/** "Walk around" camera presets (HANDOFF-3 A5): fixed framings relative to the car's own
 *  focus point and length, applied when the preset changes. Free orbiting afterwards is the
 *  user's — the preset is the starting framing a shared link restores. */
export const CAMERA_PRESETS: Record<string, { label: string; position: (f: [number, number, number], len: number) => [number, number, number]; target?: (f: [number, number, number], len: number) => [number, number, number] }> = {
  front: { label: 'Front ¾', position: (f, len) => [f[0] - len * 0.4, 1.05, 2.7] },
  side: { label: 'Side', position: (f, len) => [f[0], 0.75, Math.max(3.2, len * 0.62)] },
  top: { label: 'Top', position: (f, len) => [f[0], Math.max(3.4, len * 0.66), 0.02] },
  rear: { label: 'Rear ¾', position: (f, len) => [f[0] + len * 0.4, 1.1, 2.7] },
  cabin: { label: 'Cabin', position: (f, len) => [f[0] + len * 0.1, 1.12, 1.3], target: (f, len) => [f[0] + len * 0.04, 0.72, 0] },
};

function CameraRig({ preset, focus, length }: { preset: string | null; focus: [number, number, number]; length: number }) {
  const camera = useThree((st) => st.camera);
  const controls = useThree((st) => st.controls) as unknown as { target: THREE.Vector3; update: () => void } | null;
  useEffect(() => {
    if (!preset || !camera) return;
    const p = CAMERA_PRESETS[preset];
    if (!p) return;
    const [px, py, pz] = p.position(focus, length);
    camera.position.set(px, py, pz);
    if (controls) {
      const t = p.target ? p.target(focus, length) : focus;
      controls.target.set(t[0], t[1], t[2]);
      controls.update();
    }
    // focus/length identity changes on every render; the preset VALUE is the trigger.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [preset, camera, controls]);
  return null;
}

/** A part the explode sequence can place: position/axis for the shift, group/role for its subsystem. */
type ExplodeSubject = ExplodePart & { group?: string; role?: string };

function WheelMeshes({ assembly, explodeFor, clip, opacity, visibleIds, checkColors }: {
  assembly: VehicleAssembly; explodeFor: (part: ExplodeSubject) => number; clip: THREE.Plane[]; opacity: number; visibleIds: Set<string>;
  /** Checks overlay: a wheel's tyre takes its worst check's colour when present. */
  checkColors?: Map<string, string> | null;
}) {
  const tires = useMemo(() => assembly.components.filter((c) => c.role === 'wheel' && visibleIds.has(c.id)), [assembly, visibleIds]);
  const tire = useMemo(() => geo(assembly.wheel.tire), [assembly]);
  const rim = useMemo(() => geo(assembly.wheel.rim), [assembly]);
  const disc = useMemo(() => geo(assembly.wheel.disc), [assembly]);
  const caliper = useMemo(() => geo(assembly.wheel.caliper), [assembly]);
  if (!tires.length) return null;
  // One mesh per wheel. InstancedMesh clipping ignores the instance matrix,
  // so a section plane cut the tyre in the wrong place.
  return (
    <group>
      {tires.map((w) => {
        const [x, y, z] = explodedShift(w, explodeFor(w));
        const [tx, ty, tz] = toThree(x, y, z);
        const mirror = w.placement.y < 0 ? -1 : 1;
        return (
          <group key={w.id} position={[tx, ty, tz]} scale={[1, 1, mirror]}>
            <mesh name="tyre" geometry={tire}>
              <meshStandardMaterial color={checkColors?.get(w.id) || '#161616'} roughness={0.94} side={THREE.DoubleSide} clippingPlanes={clip} transparent={opacity < 1} opacity={opacity} />
            </mesh>
            <mesh name="rim" geometry={rim}>
              <meshPhysicalMaterial color="#33363b" metalness={1} roughness={0.34} clearcoat={0.45} clearcoatRoughness={0.12} side={THREE.DoubleSide} clippingPlanes={clip} transparent={opacity < 1} opacity={opacity} />
            </mesh>
            <mesh name="disc" geometry={disc}>
              <meshStandardMaterial color="#3e4248" metalness={0.9} roughness={0.32} side={THREE.DoubleSide} clippingPlanes={clip} transparent={opacity < 1} opacity={opacity} />
            </mesh>
            <mesh name="caliper" geometry={caliper}>
              <meshStandardMaterial color="#c45c26" metalness={0.55} roughness={0.38} side={THREE.DoubleSide} clippingPlanes={clip} transparent={opacity < 1} opacity={opacity} />
            </mesh>
          </group>
        );
      })}
    </group>
  );
}

function CarScene({ assembly, mode, paintId, hdriUrl, showOverlays, explodeFor, section, opacity, hidden, isolated, onSelect, marks, checkColors, cameraPreset }: {
  assembly: VehicleAssembly;
  showOverlays: boolean;
  mode: 'studio' | 'engineering';
  paintId: StudioPaintId;
  hdriUrl: string | null;
  explodeFor: (part: ExplodeSubject) => number;
  cameraPreset: string | null;
  section: { axis: 'x' | 'y' | 'z'; position: number } | null;
  opacity: number;
  hidden: Set<string>;
  isolated: string | null;
  onSelect: (id: string) => void;
  /** Parts named by a fit check, outlined in the check's colour (a focused check may add pass outlines). */
  marks: Map<string, 'pass' | 'fail' | 'warn'>;
  /** Checks overlay (Engineering): part id → fill colour of its worst related check. Null = overlay off. */
  checkColors?: Map<string, string> | null;
}) {
  const bounds = assembly.surface.mesh.bounds;
  const cx = (bounds.min[0] + bounds.max[0]) / 2;
  const coat = STUDIO_PAINTS[paintId];
  const coatColor = useMemo(() => new THREE.Color().setRGB(...coat.baseColor, THREE.LinearSRGBColorSpace), [coat]);
  const paint = useMemo(() => geo({ positions: assembly.surface.mesh.positions, normals: assembly.surface.mesh.normals, indices: assembly.surface.mesh.paint }), [assembly]);
  const glass = useMemo(() => glassGeometry(assembly), [assembly]);
  const arch = useMemo(() => (assembly.surface.mesh.arch?.positions?.length ? geo(assembly.surface.mesh.arch) : null), [assembly]);
  const detailGeos = useMemo(() => {
    const map = new Map<string, THREE.BufferGeometry>();
    for (const c of assembly.components) {
      if (c.mesh?.positions && c.mesh.indices) {
        map.set(c.id, geo({ positions: c.mesh.positions, normals: c.mesh.normals, indices: c.mesh.indices }));
      }
    }
    return map;
  }, [assembly]);
  useEffect(() => () => { for (const g of detailGeos.values()) g.dispose(); }, [detailGeos]);
  const outsideIds = useMemo(() => {
    const hit = assembly.checks.find((c) => c.id === 'containment' && c.status === 'fail');
    return new Set(hit?.outside || []);
  }, [assembly]);
  const lampGeo = useMemo(() => (assembly.detail?.lamp ? geo(assembly.detail.lamp) : null), [assembly]);
  const grilleGeo = useMemo(() => (assembly.detail?.grille ? geo(assembly.detail.grille) : null), [assembly]);
  const doors = useMemo(() => assembly.components.filter((c) => c.role === 'opening' && c.mesh?.outline).map((c) => {
    const y = c.placement.y + (c.mesh?.side === 'L' ? -0.004 : 0.004);
    const geometry = new THREE.BufferGeometry().setFromPoints((c.mesh?.outline || []).map(([ox, oz]) => new THREE.Vector3(...toThree(ox, y, oz))));
    return { id: c.id, geometry, placementY: c.placement.y };
  }), [assembly]);
  const clip = useMemo(() => {
    if (!section) return [];
    const p = sectionPlane(section.axis, section.position, cx);
    return [new THREE.Plane(new THREE.Vector3(...p.normal), p.constant)];
  }, [section, cx]);
  const show = (id: string) => !hidden.has(id) && (!isolated || isolated === id);
  const showInterior = mode === 'engineering' || assembly.components.some((c) => explodeFor(c) > 0.02);
  return (
    <>
      {mode === 'studio' && <StudioEnv hdriUrl={hdriUrl} />}
      <ambientLight intensity={mode === 'studio' ? 0.35 : 0.7} />
      <directionalLight position={[4, 8, 3]} intensity={mode === 'studio' ? 2.2 : 1} color={mode === 'studio' ? '#fff4ea' : undefined} castShadow />
      <directionalLight position={[-4, 3, -2]} intensity={0.6} color="#d7e2f0" />
      {/* Studio rig completion (HANDOFF-3 A6): the rim and kicker lights from the headless
          studio render's proven setup — the rim is what sweeps the bright edge highlight
          along the shoulder toward the visual target; the kicker warms the nose. */}
      {mode === 'studio' && <directionalLight position={[-3.6, 2.8, -4.2]} intensity={2} color="#e7eeff" />}
      {mode === 'studio' && <directionalLight position={[4.8, 1.6, -1.2]} intensity={0.9} color="#fff1e0" />}
      <group position={[-cx, 0, 0]}>
        {show('BODY_SHELL') && (
          <mesh geometry={paint} castShadow receiveShadow onClick={(e) => { e.stopPropagation(); onSelect('BODY_SHELL'); }}>
            {mode === 'studio'
              ? <meshPhysicalMaterial color={coatColor} metalness={coat.metallic} roughness={coat.roughness} clearcoat={coat.clearcoat} clearcoatRoughness={coat.clearcoatRoughness} clippingPlanes={clip} transparent={opacity < 1} opacity={opacity} />
              : <meshLambertMaterial color={checkColors?.get('BODY_SHELL') || GROUP_COLOR.exterior} flatShading clippingPlanes={clip} transparent opacity={Math.min(opacity, 0.45)} />}
          </mesh>
        )}
        {show('GLAZING') && (
          <mesh geometry={glass} onClick={(e) => { e.stopPropagation(); onSelect('GLAZING'); }}>
            <meshPhysicalMaterial color="#102028" metalness={0} roughness={0.04} transmission={mode === 'studio' ? 0.48 : 0.15} thickness={0.8} clippingPlanes={clip} transparent opacity={mode === 'studio' ? opacity : 0.4} />
          </mesh>
        )}
        {arch && show('BODY_SHELL') && (
          <mesh geometry={arch}>
            <meshStandardMaterial color="#141618" roughness={0.92} metalness={0.05} side={THREE.DoubleSide} clippingPlanes={clip} />
          </mesh>
        )}
        {showOverlays && assembly.surface.source === 'cad.body' && assembly.surface.overlays && show('BODY_SHELL') && (
          <OverlayLayer overlays={assembly.surface.overlays} mode={mode} clip={clip} />
        )}
        <WheelMeshes assembly={assembly} explodeFor={explodeFor} clip={clip} opacity={opacity} checkColors={checkColors} visibleIds={new Set(assembly.components.filter((c) => c.role === 'wheel' && show(c.id)).map((c) => c.id))} />
        {mode === 'engineering' && doors.filter((d) => show(d.id)).map((d) => {
          const part = assembly.components.find((c) => c.id === d.id);
          const dy = part ? explodedShift(part, explodeFor(part))[1] - d.placementY : 0;
          return (
            <lineLoop key={d.id} geometry={d.geometry} position={[0, 0, -dy]}>
              <lineBasicMaterial color="#333" clippingPlanes={clip} />
            </lineLoop>
          );
        })}
        {assembly.components.filter((c) => {
          if (c.role === 'wheel' || c.role === 'body' || c.role === 'glass' || c.role === 'opening' || c.role === 'axle') return false;
          if (c.id === 'SPARE') return false;
          if (mode === 'studio' && outsideIds.has(c.id)) return false;
          // placed on the styled loft, not on the analysed solid drawn here: not drawn floating off it in Studio
          if (mode === 'studio' && c.placedOn === 'styling-loft' && assembly.surface.source === 'cad.body') return false;
          const detail = c.role === 'lamp' || c.role === 'intake' || c.role === 'mirror' || c.role === 'handle';
          if (detail) return true;
          return showInterior && !!c.half;
        }).map((c) => {
          if (!show(c.id)) return null;
          const [x, y, z] = explodedShift(c, explodeFor(c));
          const [tx, ty, tz] = toThree(x, y, z);
          const shaped = detailGeos.get(c.id) || (c.role === 'lamp' && lampGeo) || (c.role === 'intake' && grilleGeo) || null;
          const tail = c.id.startsWith('TAIL');
          return (
            <mesh key={c.id} geometry={shaped || undefined} position={[tx, ty, tz]} onClick={(e) => { e.stopPropagation(); onSelect(c.id); }}>
              {!shaped && c.half && <boxGeometry args={[c.half[0] * 2, c.half[2] * 2, c.half[1] * 2]} />}
              {c.role === 'lamp'
                ? <meshPhysicalMaterial color={tail ? '#ffd0d4' : '#e7eef8'} emissive={tail ? '#ff2a3a' : '#f7fbff'} emissiveIntensity={mode === 'studio' ? 1.6 : 0.4} roughness={0.08} metalness={0.05} clearcoat={1} clearcoatRoughness={0.05} clippingPlanes={clip} />
                : c.role === 'intake'
                  ? <meshStandardMaterial color="#121212" roughness={0.72} metalness={0.4} clippingPlanes={clip} />
                  : c.role === 'mirror'
                    ? <meshPhysicalMaterial color="#e6e8ee" metalness={0.9} roughness={0.16} clearcoat={1} clearcoatRoughness={0.05} clippingPlanes={clip} />
                    : c.role === 'handle'
                      ? <meshStandardMaterial color="#2a2e33" metalness={0.85} roughness={0.28} clippingPlanes={clip} />
                      : <meshLambertMaterial color={checkColors?.get(c.id) || GROUP_COLOR[c.group] || '#888'} flatShading={mode === 'engineering'} transparent opacity={mode === 'engineering' ? 0.85 : 0.55} clippingPlanes={clip} />}
            </mesh>
          );
        })}
        {[...marks.entries()].map(([pid, sev]) => {
          const c = assembly.components.find((x) => x.id === pid);
          if (!c || !c.half || !show(c.id)) return null;
          const [x, y, z] = explodedShift(c, explodeFor(c));
          const [tx, ty, tz] = toThree(x, y, z);
          return <MarkBox key={pid} part={c} position={[tx, ty, tz]} color={CHECK_HEX[sev]} clip={clip} />;
        })}
      </group>
      {mode === 'studio' && <ContactShadows position={[0, 0.001, 0]} opacity={0.42} scale={12} blur={2.6} far={3.2} />}
      <mesh rotation={[-Math.PI / 2, 0, 0]} position={[0, 0, 0]} receiveShadow>
        <circleGeometry args={[8, 48]} />
        <meshStandardMaterial color={mode === 'studio' ? '#d8d9db' : '#ececec'} roughness={0.95} />
      </mesh>
      <CameraRig preset={cameraPreset} focus={[(bounds.min[0] - cx) * 0.2, 0.5, 0]} length={bounds.max[0] - bounds.min[0]} />
      <OrbitControls makeDefault target={[(bounds.min[0] - cx) * 0.2, 0.5, 0]} />
    </>
  );
}

/** A live workbench session attached to the viewer (HANDOFF-3 A2): its knobs become editable in the inspector. */
export interface ViewerWorkbench {
  id: string;
  view: WorkbenchView;
  /** Injectable for tests; the real workbench client by default. */
  client?: WorkbenchClient;
  /** The page keeps its own copy of the view; every knob reply reports back through here. */
  onView?: (view: WorkbenchView) => void;
}

interface EditDiff { flips: FitCheckFlip[]; changed: { field: string; before: unknown; after: unknown; unit?: string }[]; rerun: number }

/** One driving-parameter knob in the inspector: range + number, committed through the workbench edit path. */
function ViewerKnob({ k, busy, onCommit }: { k: WorkbenchKnob; busy: boolean; onCommit: (k: WorkbenchKnob, value: number) => void }) {
  const [draft, setDraft] = useState<number>(typeof k.value === 'number' ? k.value : 0);
  useEffect(() => { if (typeof k.value === 'number') setDraft(k.value); }, [k.value]);
  const [lo, hi] = k.bounds as [number, number];
  return (
    <div className="flex flex-col gap-1" data-testid={`viewer-knob-${k.variable}`}>
      <div className="flex items-center justify-between gap-2">
        <span className="text-slate-200">{k.label}</span>
        <span className="font-mono text-[10px] text-slate-500">{lo}–{hi} {k.unit ?? ''}</span>
      </div>
      <div className="flex items-center gap-2">
        <input
          aria-label={`${k.label} slider`}
          data-testid={`viewer-knob-${k.variable}-range`}
          type="range" min={lo} max={hi} step={k.step ?? 0.01}
          disabled={k.locked || busy}
          value={draft}
          onChange={(e) => setDraft(Number(e.target.value))}
          className="flex-1"
        />
        <input
          aria-label={k.label}
          data-testid={`viewer-knob-${k.variable}-input`}
          type="number" min={lo} max={hi} step={k.step ?? 0.01}
          disabled={k.locked || busy}
          value={draft}
          onChange={(e) => setDraft(Number(e.target.value))}
          className="w-20 rounded border border-white/10 bg-black/30 px-1 py-0.5 font-mono text-[11px] text-slate-100 disabled:opacity-50"
        />
        <span className="text-slate-500">{k.unit ?? ''}</span>
        <button
          type="button"
          data-testid={`viewer-knob-${k.variable}-set`}
          disabled={k.locked || busy || draft === k.value}
          onClick={() => onCommit(k, draft)}
          className="rounded border border-white/10 px-1.5 py-0.5 text-slate-200 hover:bg-white/5 disabled:opacity-40"
        >Set</button>
      </div>
      {k.locked && <p className="text-[10px] text-amber-200/80">{k.variable} is locked: unlock it to change it</p>}
    </div>
  );
}

export function AssemblyViewer({ assembly, viewOnly = false, glbUrl = null, hdriUrl = STUDIO_HDRI_URL, workbench = null, onStartEditing, startingEdit = false }: {
  assembly: VehicleAssembly;
  viewOnly?: boolean;
  /** Presentation GLB of the analysed solid (offered for download in Studio); null hides the link. */
  glbUrl?: string | null;
  /** Equirectangular HDR for Studio lighting; null keeps the local RoomEnvironment. */
  hdriUrl?: string | null;
  /** A live workbench session: the driving parameters become editable and edits swap the model in. */
  workbench?: ViewerWorkbench | null;
  /** Snapshot mode: create a workbench session from this design and swap the page into workbench mode. */
  onStartEditing?: () => void;
  startingEdit?: boolean;
}) {
  const narrow = useNarrow();
  const locked = viewOnly || narrow;
  const [mode, setMode] = useState<'studio' | 'engineering'>('studio');
  const [paintId, setPaintId] = useState<StudioPaintId>('graphite');
  const [showOverlays, setShowOverlays] = useState(true);
  const [selected, setSelected] = useState<string | null>(null);
  const [explode, setExplode] = useState(0);
  // A5: the explode SEQUENCE position (0..subsystem count) — subsystem i is fully out at
  // position i+1, part-way while the position crosses it. Play steps it; the URL carries it.
  const [playing, setPlaying] = useState(false);
  const [cameraPreset, setCameraPreset] = useState<string | null>(null);
  const explodeFor = useCallback((c: ExplodeSubject) => explodeAmountFor(c, explode), [explode]);
  const stepExplode = (dir: 1 | -1) => {
    setPlaying(false);
    setExplode((v) => (dir > 0
      ? Math.min(EXPLODE_SUBSYSTEMS.length, Math.floor(v) + 1)
      : Math.max(0, Math.ceil(v) - 1)));
  };
  const togglePlay = () => {
    if (playing) { setPlaying(false); return; }
    if (explode >= EXPLODE_SUBSYSTEMS.length) setExplode(0);
    setPlaying(true);
  };
  useEffect(() => {
    if (!playing) return;
    const t = setInterval(() => {
      setExplode((v) => {
        const n = Math.min(EXPLODE_SUBSYSTEMS.length, Math.floor(v) + 1);
        if (n >= EXPLODE_SUBSYSTEMS.length) setPlaying(false);
        return n;
      });
    }, 1100);
    return () => clearInterval(t);
  }, [playing]);
  const [sectionAxis, setSectionAxis] = useState<'x' | 'y' | 'z' | null>(null);
  const [sectionPos, setSectionPos] = useState(2);
  const [opacity, setOpacity] = useState(1);
  const [hidden, setHidden] = useState<Set<string>>(new Set());
  const [isolated, setIsolated] = useState<string | null>(null);
  // Workbench mode: the session's view, the last edit's assembly (swapped in over the snapshot), its diff.
  const [wbView, setWbView] = useState<WorkbenchView | null>(workbench?.view ?? null);
  const [live, setLive] = useState<VehicleAssembly | null>(null);
  const [busy, setBusy] = useState(false);
  const [diff, setDiff] = useState<EditDiff | null>(null);
  const [wbError, setWbError] = useState('');
  useEffect(() => { if (workbench?.view) setWbView(workbench.view); }, [workbench?.view]);
  useEffect(() => { setLive(null); setDiff(null); setWbError(''); }, [assembly]);
  const shown = live ?? assembly;
  const overlays = shown.surface.source === 'cad.body' ? shown.surface.overlays || null : null;
  const marks = useMemo(() => {
    const m = new Map<string, 'fail' | 'warn'>();
    for (const c of shown.checks) {
      if (c.status !== 'fail' && c.status !== 'warn') continue;
      for (const p of checkParts(c)) if (c.status === 'fail' || !m.has(p)) m.set(p, c.status);
    }
    return m;
  }, [shown]);
  // A3: the Checks overlay (Engineering) colours each part by the worst check that names it, and a
  // focused Fit check outlines its parts on top of the standing fail/warn marks.
  const [checksOverlay, setChecksOverlay] = useState(false);
  const [focusCheck, setFocusCheck] = useState<string | null>(null);
  useEffect(() => { setFocusCheck(null); }, [shown]);
  const worstByPart = useMemo(() => {
    const m = new Map<string, 'pass' | 'warn' | 'fail'>();
    for (const c of shown.checks) {
      for (const p of checkParts(c)) {
        const cur = m.get(p);
        if (!cur || CHECK_SEVERITY[c.status] > CHECK_SEVERITY[cur]) m.set(p, c.status);
      }
    }
    return m;
  }, [shown]);
  const checkColors = useMemo(() => {
    if (mode !== 'engineering' || !checksOverlay) return null;
    const m = new Map<string, string>();
    for (const [pid, st] of worstByPart) m.set(pid, CHECK_HEX[st]);
    return m;
  }, [mode, checksOverlay, worstByPart]);
  const displayMarks = useMemo(() => {
    const m = new Map<string, 'pass' | 'warn' | 'fail'>(marks);
    const focused = focusCheck ? shown.checks.find((c) => c.id === focusCheck) : null;
    if (focused) for (const p of checkParts(focused)) m.set(p, focused.status);
    return m;
  }, [marks, focusCheck, shown]);
  const commitKnob = async (k: WorkbenchKnob, value: number) => {
    if (!workbench) return;
    const client = workbench.client ?? workbenchClient;
    setBusy(true);
    setWbError('');
    try {
      const r = await client.knob(workbench.id, k.variable, value);
      if (r.reply?.kind === 'locked') {
        setWbError(r.reply.note || `${k.variable} is locked: unlock it to change it`);
      } else if (r.reply?.kind === 'error') {
        setWbError(r.reply.message || r.reply.error || 'The edit was refused.');
      } else {
        if (r.assembly) setLive(r.assembly as unknown as VehicleAssembly);
        setDiff({ flips: r.fitCheckDiff ?? [], changed: r.reply?.diff?.changed ?? [], rerun: (r.rerun ?? []).length });
      }
      if (r.view) { setWbView(r.view); workbench.onView?.(r.view); }
    } catch (e) {
      const data = (e as { response?: { data?: { message?: string } } })?.response?.data;
      setWbError(data?.message || (e instanceof Error ? e.message : 'The edit failed.'));
    } finally {
      setBusy(false);
    }
  };
  const [inspTab, setInspTab] = useState<'details' | 'analyses'>('details');
  const runAnalysis = async (solver: string) => {
    if (!workbench) return;
    const client = workbench.client ?? workbenchClient;
    setBusy(true);
    setWbError('');
    try {
      const r = await client.rerun(workbench.id, solver);
      if (r.assembly) setLive(r.assembly as unknown as VehicleAssembly);
      if (r.view) { setWbView(r.view); workbench.onView?.(r.view); }
    } catch (e) {
      const data = (e as { response?: { data?: { message?: string } } })?.response?.data;
      setWbError(data?.message || (e instanceof Error ? e.message : 'The re-run failed.'));
    } finally {
      setBusy(false);
    }
  };
  const part = shown.components.find((c) => c.id === selected) || null;
  // The selected part's stored clearances: the gap each fit check computed and stored (clearanceM),
  // displayed verbatim — the browser never recomputes a clearance.
  const partClearances = part ? shown.checks.filter((c) => typeof c.clearanceM === 'number' && checkParts(c).includes(part.id)) : [];
  const partGeoOnly = part ? (shown.verification?.geometricOnlyParts || []).includes(part.id) : false;
  const bounds = shown.surface.mesh.bounds;
  const viewNose = bounds.min[0] - (bounds.min[0] + bounds.max[0]) / 2;
  const section = sectionAxis ? { axis: sectionAxis, position: sectionPos } : null;
  const span = sectionAxis === 'y' ? [bounds.min[1], bounds.max[1]] : sectionAxis === 'z' ? [bounds.min[2], bounds.max[2]] : [bounds.min[0], bounds.max[0]];
  // A5: shareable view state in the URL query, alongside DesignBuilder's ?wb=. Restored once
  // on mount (validated against this design's parts), written on every change with
  // history.replaceState so other params (wb, the page's own state) survive untouched.
  const [viewRestored, setViewRestored] = useState(false);
  useEffect(() => {
    try {
      const q = new URLSearchParams(window.location.search);
      const m = q.get('view');
      if (m === 'engineering' || m === 'studio') setMode(m);
      const x = q.get('xpos');
      if (x !== null && Number.isFinite(Number(x))) setExplode(Math.max(0, Math.min(EXPLODE_SUBSYSTEMS.length, Number(x))));
      const sec = q.get('sec');
      if (sec) {
        const [a, raw] = sec.split(':');
        const pos = Number(raw);
        if ((a === 'x' || a === 'y' || a === 'z') && Number.isFinite(pos)) {
          const sp = a === 'y' ? [bounds.min[1], bounds.max[1]] : a === 'z' ? [bounds.min[2], bounds.max[2]] : [bounds.min[0], bounds.max[0]];
          setSectionAxis(a);
          setSectionPos(Math.max(sp[0], Math.min(sp[1], pos)));
        }
      }
      const known = (id: string | null) => !!id && assembly.components.some((c) => c.id === id);
      if (known(q.get('sel'))) setSelected(q.get('sel'));
      if (known(q.get('iso'))) setIsolated(q.get('iso'));
      const hide = q.get('hide');
      if (hide) setHidden(new Set(hide.split(',').filter((id) => known(id))));
      const cam = q.get('cam');
      if (cam && cam in CAMERA_PRESETS) setCameraPreset(cam);
    } catch { /* a malformed URL never breaks the viewer */ }
    setViewRestored(true);
    // Mount-only restore: the initial assembly defines which part ids are valid.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  useEffect(() => {
    if (!viewRestored) return;
    try {
      const q = new URLSearchParams(window.location.search);
      const put = (k: string, v: string | null) => { if (v === null) q.delete(k); else q.set(k, v); };
      put('view', mode === 'studio' ? null : mode);
      put('xpos', explode > 0 ? String(Math.round(explode * 100) / 100) : null);
      put('sec', sectionAxis ? `${sectionAxis}:${Math.round(sectionPos * 1000) / 1000}` : null);
      put('sel', selected);
      put('iso', isolated);
      put('hide', hidden.size ? [...hidden].join(',') : null);
      put('cam', cameraPreset);
      const qs = q.toString();
      window.history.replaceState(null, '', window.location.pathname + (qs ? '?' + qs : '') + window.location.hash);
    } catch { /* history can be unavailable in embeds/tests */ }
  }, [viewRestored, mode, explode, sectionAxis, sectionPos, selected, isolated, hidden, cameraPreset]);

  return (
    <div className="flex flex-col gap-2" data-testid="assembly-viewer">
      <p className="text-[11px] leading-relaxed text-slate-400">{shown.verification?.statement}</p>
      <div className={`grid gap-2 ${locked ? '' : 'lg:grid-cols-[220px_minmax(0,1fr)_240px]'}`}>
        {!locked && (
          <div className="flex max-h-[520px] flex-col gap-1 overflow-auto rounded-lg border border-white/10 p-2">
            <div className="mb-1 flex gap-1">
              <button type="button" className={`rounded px-2 py-1 text-[11px] ${mode === 'studio' ? 'bg-white/15' : 'text-slate-400'}`} onClick={() => setMode('studio')}>Studio</button>
              <button type="button" className={`rounded px-2 py-1 text-[11px] ${mode === 'engineering' ? 'bg-white/15' : 'text-slate-400'}`} onClick={() => setMode('engineering')}>Engineering</button>
            </div>
            {mode === 'studio' && (
              <div className="mb-1 flex items-center gap-1.5 text-[11px] text-slate-400">
                Paint
                {(Object.keys(STUDIO_PAINTS) as StudioPaintId[]).map((id) => {
                  const [r, g, b] = STUDIO_PAINTS[id].baseColor.map((c) => Math.round(255 * Math.pow(c, 1 / 2.2)));
                  return (
                    <button
                      key={id}
                      type="button"
                      data-testid={`paint-${id}`}
                      aria-pressed={paintId === id}
                      title={STUDIO_PAINTS[id].label}
                      onClick={() => setPaintId(id)}
                      className={`h-4 w-4 rounded-full border transition-transform ${paintId === id ? 'scale-110 border-sky-300' : 'border-white/30 hover:scale-105'}`}
                      style={{ background: `rgb(${r},${g},${b})` }}
                    />
                  );
                })}
                {glbUrl && shown.surface.source === 'cad.body' && (
                  <a data-testid="present-glb" href={glbUrl} download className="ml-auto rounded border border-white/15 px-1.5 py-0.5 text-slate-300 hover:border-sky-400/40 hover:text-sky-100" title="Analysed solid with normals and this clearcoat material (glTF 2.0)">GLB</a>
                )}
              </div>
            )}
            <div>
              <div className="flex items-center justify-between text-[11px] text-slate-400">
                <span>Explode sequence</span>
                <span className="flex gap-1">
                  <button type="button" data-testid="explode-play" className="rounded px-1.5 py-0.5 hover:bg-white/10" onClick={togglePlay}>{playing ? 'Pause' : 'Play'}</button>
                  <button type="button" data-testid="explode-prev" disabled={explode <= 0} className="rounded px-1.5 py-0.5 hover:bg-white/10 disabled:opacity-40" onClick={() => stepExplode(-1)}>← Prev</button>
                  <button type="button" data-testid="explode-next" disabled={explode >= EXPLODE_SUBSYSTEMS.length} className="rounded px-1.5 py-0.5 hover:bg-white/10 disabled:opacity-40" onClick={() => stepExplode(1)}>Next →</button>
                </span>
              </div>
              <p data-testid="explode-step" className="text-[11px] text-slate-300">
                {explode >= EXPLODE_SUBSYSTEMS.length
                  ? 'Fully exploded — all six subsystems'
                  : explode <= 0
                    ? 'Assembled — step 1 is Body'
                    : `Step ${Math.min(EXPLODE_SUBSYSTEMS.length, Math.floor(explode) + 1)} of 6 — ${EXPLODE_SUBSYSTEMS[Math.min(EXPLODE_SUBSYSTEMS.length - 1, Math.floor(explode))].label}`}
              </p>
              <div className="flex flex-wrap gap-1">
                {EXPLODE_SUBSYSTEMS.map((sub, i) => {
                  const amt = Math.max(0, Math.min(1, explode - i));
                  const state = amt >= 1 ? 'exploded' : amt > 0 ? 'exploding' : 'assembled';
                  return (
                    <span key={sub.id} data-testid={`xsub-${sub.id}`} data-state={state} className={`rounded px-1.5 py-0.5 text-[10px] ${state === 'exploded' ? 'bg-teal-400/20 text-teal-200' : state === 'exploding' ? 'bg-amber-300/20 text-amber-200' : 'bg-white/5 text-slate-400'}`}>{sub.label}</span>
                  );
                })}
              </div>
              <input data-testid="explode" type="range" min={0} max={EXPLODE_SUBSYSTEMS.length} step={0.01} value={explode} onChange={(e) => { setPlaying(false); setExplode(Number(e.target.value)); }} className="w-full" aria-label="Explode sequence position" />
              <div className="mt-1 flex flex-wrap items-center gap-1 text-[11px]">
                <span className="text-slate-500">Camera</span>
                {Object.entries(CAMERA_PRESETS).map(([id, preset]) => (
                  <button key={id} type="button" data-testid={`cam-${id}`} aria-pressed={cameraPreset === id} className={`rounded px-1.5 py-0.5 ${cameraPreset === id ? 'bg-white/15 text-slate-100' : 'text-slate-400 hover:bg-white/5'}`} onClick={() => setCameraPreset(cameraPreset === id ? null : id)}>{preset.label}</button>
                ))}
              </div>
            </div>
            <div className="flex gap-1 text-[11px]">
              {(['x', 'y', 'z'] as const).map((a) => (
                <button key={a} type="button" data-testid={`section-${a}`} className={`rounded px-2 py-0.5 ${sectionAxis === a ? 'bg-white/15' : 'text-slate-400'}`} onClick={() => setSectionAxis(sectionAxis === a ? null : a)}>{a.toUpperCase()}</button>
              ))}
            </div>
            {sectionAxis && (
              <label className="text-[11px] text-slate-400">Section {sectionAxis.toUpperCase()}
                <input data-testid="section-pos" type="range" min={span[0]} max={span[1]} step={0.01} value={sectionPos} onChange={(e) => setSectionPos(Number(e.target.value))} className="w-full" />
              </label>
            )}
            {overlays && (
              <label className="flex items-center gap-1.5 text-[11px] text-slate-400" title="cad.design-surface panel lines, glass and lamps drawn on the analysed solid; the solid is not cut">
                <input data-testid="overlays-toggle" type="checkbox" checked={showOverlays} onChange={(e) => setShowOverlays(e.target.checked)} />
                Design surface (drawn, not cut)
              </label>
            )}
            {mode === 'engineering' && (
              <label className="flex items-center gap-1.5 text-[11px] text-slate-400" title="Colour every part by the worst fit check that names it; parts no check names keep their group colour">
                <input data-testid="checks-overlay" type="checkbox" checked={checksOverlay} onChange={(e) => setChecksOverlay(e.target.checked)} />
                Checks overlay — colour by worst check
              </label>
            )}
            <label className="text-[11px] text-slate-400">Transparency
              <input data-testid="opacity" type="range" min={0.15} max={1} step={0.01} value={opacity} onChange={(e) => setOpacity(Number(e.target.value))} className="w-full" />
            </label>
            <ul className="mt-1 space-y-0.5">
              {shown.components.filter((c) => c.role !== 'axle').map((c) => (
                <li key={c.id}>
                  <button type="button" data-testid={`part-${c.id}`} className={`w-full truncate rounded px-1 py-0.5 text-left text-[11px] ${selected === c.id ? 'bg-white/15' : 'text-slate-300'}`} onClick={() => setSelected(c.id)}>
                    {mode === 'engineering' ? `${c.id}  ${c.name}` : c.name}
                    {checkColors && worstByPart.get(c.id) && (
                      <span data-testid={`part-check-${c.id}`} className={`ml-1 ${worstByPart.get(c.id) === 'fail' ? 'text-rose-300' : worstByPart.get(c.id) === 'warn' ? 'text-amber-200' : 'text-emerald-200'}`}>· {worstByPart.get(c.id)}</span>
                    )}
                  </button>
                </li>
              ))}
            </ul>
          </div>
        )}
        <div className="relative h-[420px] overflow-hidden rounded-lg bg-[#c5c6c8] lg:h-[520px]" data-testid="assembly-canvas" tabIndex={0} role="application" aria-label="Assembly view — left and right arrow keys step the explode sequence" onKeyDown={(e) => { if (e.key === 'ArrowRight') { e.preventDefault(); stepExplode(1); } if (e.key === 'ArrowLeft') { e.preventDefault(); stepExplode(-1); } }}>
          {mode === 'studio' && (
            <div
              data-testid="studio-preview-badge"
              className="pointer-events-none absolute left-2 top-2 z-10 rounded-md border border-amber-300/60 bg-slate-900/80 px-2 py-1 text-[11px] font-medium text-amber-200 shadow"
            >
              {shown.surface.source === 'cad.body'
                ? 'Studio · analysed body (cad.body solid)'
                : 'Studio · styling preview — engineering geometry is authoritative'}
            </div>
          )}
          <Canvas
            gl={{ antialias: true, toneMapping: THREE.AgXToneMapping, toneMappingExposure: 1.05, localClippingEnabled: true }}
            camera={{ position: [viewNose - 1.8, 0.92, 2.6], fov: 28 }}
            dpr={narrow ? [1, 1] : [1, 1.5]}
          >
            <color attach="background" args={[mode === 'studio' ? '#d8d9db' : '#ececec']} />
            <CarScene assembly={shown} mode={mode} paintId={paintId} hdriUrl={hdriUrl} showOverlays={showOverlays} explodeFor={explodeFor} cameraPreset={cameraPreset} section={section} opacity={opacity} hidden={hidden} isolated={isolated} onSelect={setSelected} marks={displayMarks} checkColors={checkColors} />
          </Canvas>
        </div>
        {!locked && (
          <aside className="max-h-[520px] overflow-auto rounded-lg border border-white/10 p-2 text-[11px] leading-relaxed" data-testid="inspector">
            {workbench && wbView && (
              <div className="mb-3 border-b border-white/10 pb-2" data-testid="wb-edit">
                <h3 className="text-slate-200">Driving parameters</h3>
                <div className="mt-1 flex flex-col gap-2">
                  {wbView.knobs.filter((k) => k.bounds).map((k) => (
                    <ViewerKnob key={k.variable} k={k} busy={busy} onCommit={(kk, v) => void commitKnob(kk, v)} />
                  ))}
                  {wbView.knobs.filter((k) => k.bounds).length === 0 && <p className="text-slate-500">This design has no editable driving parameters.</p>}
                </div>
                {busy && <p role="status" className="mt-1 text-sky-200">Recomputing…</p>}
                {wbError && <p role="alert" className="mt-1 text-rose-300">{wbError}</p>}
                {diff && !busy && (
                  <div className="mt-2 rounded border border-white/10 p-1.5" data-testid="wb-diff">
                    <div className="flex items-center justify-between">
                      <h4 className="text-slate-200">Last edit</h4>
                      <button type="button" className="text-slate-400 hover:text-slate-200" onClick={() => setDiff(null)}>Dismiss</button>
                    </div>
                    {diff.changed.map((ch, i) => (
                      <p key={i} className="text-slate-300">{ch.field}: {String(ch.before)} → {String(ch.after)}{ch.unit ? ` ${ch.unit}` : ''}</p>
                    ))}
                    {diff.flips.length > 0 ? diff.flips.map((f) => (
                      <p key={f.id} className={f.to === 'fail' ? 'text-rose-300' : f.to === 'warn' ? 'text-amber-200' : 'text-emerald-200'}>
                        {f.id}: {f.from ?? '—'} → {f.to ?? '—'}
                      </p>
                    )) : <p className="text-slate-400">No fit checks flipped.</p>}
                    <p className="text-slate-500">{diff.rerun} solver runs re-ran.</p>
                  </div>
                )}
              </div>
            )}
            {!workbench && onStartEditing && (
              <div className="mb-3 border-b border-white/10 pb-2" data-testid="wb-start">
                <p className="text-slate-400">This is a saved snapshot — its numbers are fixed.</p>
                <button
                  type="button"
                  data-testid="start-editing"
                  disabled={startingEdit}
                  onClick={onStartEditing}
                  className="mt-1 rounded border border-sky-400/40 bg-sky-400/10 px-2 py-1 text-sky-100 hover:bg-sky-400/20 disabled:opacity-40"
                >
                  {startingEdit ? 'Starting…' : 'Start editing'}
                </button>
              </div>
            )}
            {!part && <p className="text-slate-400">Select a part. The list and the model both select.</p>}
            {part && (
              <>
                <h3 className="text-sm text-slate-100">{part.name}</h3>
                <p className="text-slate-400">{part.geometry.kind === 'envelope' ? part.geometry.label : 'Kernel or loft solid.'}</p>
                <p data-testid="part-badge" className={partGeoOnly ? 'text-amber-200' : 'text-emerald-200'} title={shown.verification?.statement}>
                  {partGeoOnly ? 'Geometric only — drawn form, not an analysed solid' : 'Verified envelope — a library box the fit checks evaluate'}
                </p>
                <p className="mt-1 text-slate-300">{part.id}</p>
                <p className="text-slate-300">x {part.placement.x} m · y {part.placement.y} m · z {part.placement.z} m</p>
                {part.half && <p className="text-slate-400">span { (part.half[0] * 2).toFixed(3) } × { (part.half[1] * 2).toFixed(3) } × { (part.half[2] * 2).toFixed(3) } m</p>}
                <div className="mt-2 flex gap-1">
                  <button type="button" className="rounded bg-white/10 px-2 py-0.5" onClick={() => setHidden((h) => { const n = new Set(h); if (n.has(part.id)) n.delete(part.id); else n.add(part.id); return n; })}>{hidden.has(part.id) ? 'Show' : 'Hide'}</button>
                  <button type="button" className="rounded bg-white/10 px-2 py-0.5" onClick={() => setIsolated(isolated === part.id ? null : part.id)}>{isolated === part.id ? 'Show all' : 'Isolate'}</button>
                </div>
                <div className="mt-2 flex gap-1">
                  <button type="button" data-testid="insp-tab-details" aria-pressed={inspTab === 'details'} className={`rounded px-2 py-0.5 ${inspTab === 'details' ? 'bg-white/15 text-slate-100' : 'text-slate-400'}`} onClick={() => setInspTab('details')}>Details</button>
                  <button type="button" data-testid="insp-tab-analyses" aria-pressed={inspTab === 'analyses'} className={`rounded px-2 py-0.5 ${inspTab === 'analyses' ? 'bg-white/15 text-slate-100' : 'text-slate-400'}`} onClick={() => setInspTab('analyses')}>Analyses</button>
                </div>
                {inspTab === 'analyses' && (
                  <div data-testid="part-analyses">
                    {part.analyses === undefined && (
                      <p className="mt-2 text-slate-400">{workbench ? 'No analyses are linked for this part in this session yet.' : 'Analyses link from a live workbench session — start editing to run the solvers on this design.'}</p>
                    )}
                    {part.analyses !== undefined && part.analyses.length === 0 && (
                      <p className="mt-2 text-slate-400">No solver analysis is mapped to this part.</p>
                    )}
                    {(part.analyses || []).map((a) => (
                      <div key={a.solver} data-testid={`analysis-${a.solver}`} className="mt-2 border-t border-white/10 pt-2">
                        <p className="text-slate-200">
                          {a.solver}{a.version ? ` v${a.version}` : ''} —{' '}
                          <span className={a.status === 'fail' || a.status === 'error' ? 'text-rose-300' : a.status === 'warn' ? 'text-amber-200' : a.status === 'pass' ? 'text-emerald-200' : 'text-slate-400'}>{a.status}</span>
                          {a.utilization != null && (
                            <span data-testid={`analysis-${a.solver}-util`} className="ml-1" style={{ color: feaUtilToColor(a.utilization).hex }}>· utilisation {(a.utilization * 100).toFixed(0)}%</span>
                          )}
                        </p>
                        {a.keyOutputs.map((o) => (
                          <p key={o.id} className="text-slate-300">{o.id}: {fmtAnalysisValue(o.value)}{o.unit ? ` ${o.unit}` : ''}</p>
                        ))}
                        {a.receipt && <p className="text-slate-500">receipt {a.receipt.runId} · inputs {a.receipt.inputHash ? `${a.receipt.inputHash.slice(0, 12)}…` : '—'}</p>}
                        {a.ranAt && <p className="text-slate-500">ran {a.ranAt}</p>}
                        {a.recordedAt && <p className="text-slate-500">recorded run imported {a.recordedAt}</p>}
                        {a.reason && <p className="text-slate-400">{a.reason}</p>}
                        {a.solver === 'aero.cfd' && a.status !== 'not_run' && <p className="text-slate-500">Recorded OpenFOAM result — imported from the pod, not re-run here.</p>}
                        {workbench && a.status !== 'not_run' && a.solver !== 'aero.cfd' && (
                          <button type="button" data-testid={`rerun-${a.solver}`} disabled={busy} className="mt-1 rounded border border-sky-400/40 bg-sky-400/10 px-2 py-0.5 text-sky-100 hover:bg-sky-400/20 disabled:opacity-40" onClick={() => void runAnalysis(a.solver)}>Re-run</button>
                        )}
                      </div>
                    ))}
                  </div>
                )}
                {inspTab === 'details' && (
                <>
                <ul className="mt-2 space-y-1">
                  {(part.parameters || []).map((p) => (
                    <li key={p.id}><span className="text-slate-200">{p.name}</span> {String(p.value)} {p.unit} <span className="text-slate-500">({p.provenance.state}{p.provenance.note ? `: ${p.provenance.note}` : ''})</span></li>
                  ))}
                </ul>
                {partClearances.length > 0 && (
                  <div className="mt-2" data-testid="part-clearances">
                    <h4 className="text-slate-200">Clearances</h4>
                    <ul className="space-y-1">
                      {partClearances.map((c) => (
                        <li key={c.id} data-testid={`clearance-${c.id}`} className={c.status === 'fail' ? 'text-rose-300' : c.status === 'warn' ? 'text-amber-200' : 'text-emerald-200'}>
                          {c.id}: {Math.round((c.clearanceM as number) * 1000)} mm ({c.status})
                        </li>
                      ))}
                    </ul>
                    <p className="text-slate-500">Stored solver values from the fit checks — not recomputed here.</p>
                  </div>
                )}
                {(part.relationships || []).length > 0 && (
                  <ul className="mt-2 space-y-1 text-slate-400">
                    {part.relationships!.map((r, i) => {
                      const target = shown.components.find((x) => x.id === r.target);
                      return (
                        <li key={i}>
                          {target
                            ? <button type="button" data-testid={`rel-${part.id}-${r.target}`} className="hover:text-slate-200 hover:underline" title={`Select ${r.target}`} onClick={() => setSelected(r.target)}>{r.kind} {r.target}</button>
                            : <span>{r.kind} {r.target}</span>}
                          {r.note ? ` — ${r.note}` : ''}
                        </li>
                      );
                    })}
                  </ul>
                )}
                </>
                )}
              </>
            )}
            {overlays?.conflicts && overlays.conflicts.length > 0 && (
              <div data-testid="style-conflicts">
                <h3 className="mt-3 text-slate-200">Style reference: not copied</h3>
                <ul className="space-y-1">
                  {overlays.conflicts.map((c) => (
                    <li key={c.id} className="text-slate-400"><span className="text-amber-200">{c.id}</span> {c.reference} <span className="text-slate-300">{c.package}</span></li>
                  ))}
                </ul>
                {overlays.coverage && overlays.coverage.missed > 0 && (
                  <p className="mt-1 text-slate-500">{overlays.coverage.missed} of {overlays.coverage.samples} overlay points miss the solid and are left out.</p>
                )}
              </div>
            )}
            <h3 className="mt-3 text-slate-200">Fit</h3>
            <ul className="space-y-1">
              {shown.checks.map((c) => {
                const first = checkParts(c)[0];
                return (
                  <li key={c.id} data-testid={`fit-${c.id}`} className={c.status === 'fail' ? 'text-rose-300' : c.status === 'warn' ? 'text-amber-200' : 'text-emerald-200'}>
                    {first
                      ? <button type="button" className="hover:underline" aria-pressed={focusCheck === c.id} onClick={() => { setSelected(first); setFocusCheck(focusCheck === c.id ? null : c.id); }} title="Select the first part this check names and outline every part it names">{c.status} {c.id}</button>
                      : <>{c.status} {c.id}</>}
                  </li>
                );
              })}
            </ul>
          </aside>
        )}
      </div>
      {locked && <p className="text-[11px] text-slate-500">View only on this screen. Orbit still works.</p>}
    </div>
  );
}
