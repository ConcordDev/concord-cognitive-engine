'use client';

/**
 * AssemblyViewer — the parametric vehicle, orbitable.
 * Studio is the default: clearcoat paint (the same graphite as the Cycles
 * render and the presentation GLB, or silver), transmissive glass, instanced
 * wheels, a same-origin CC0 sky HDRI for lighting and reflections over a flat
 * studio backdrop (three.js RoomEnvironment until it loads, and if it fails).
 * Engineering flattens the shading and shows every envelope.
 * Selection, hide, isolate, transparency, explode and a section plane work
 * in both. A narrow screen is view-only: the canvas stays, the controls do not.
 */

import { useEffect, useMemo, useRef, useState } from 'react';
import { Canvas, useThree } from '@react-three/fiber';
import { ContactShadows, OrbitControls } from '@react-three/drei';
import * as THREE from 'three';
import { RoomEnvironment } from 'three/examples/jsm/environments/RoomEnvironment.js';
import { HDRLoader } from 'three/examples/jsm/loaders/HDRLoader.js';
import { explodedShift, sectionPlane, toThree, type ExplodePart } from '@/lib/conkay/assembly-view';
import { STUDIO_HDRI_URL, STUDIO_PAINTS, type StudioPaintId } from '@/lib/conkay/present-paint';

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
  verification?: { statement: string; geometricOnly?: string[] };
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
    /** 'styling-loft': placed on the styled loft, which is not the analysed solid drawn here. */
    placedOn?: string;
  })[];
  checks: { id: string; status: 'pass' | 'warn' | 'fail'; detail: string; outside?: string[] }[];
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

function WheelInstances({ assembly, explode, clip, opacity, visible }: {
  assembly: VehicleAssembly; explode: number; clip: THREE.Plane[]; opacity: number; visible: boolean;
}) {
  const tires = useMemo(() => assembly.components.filter((c) => c.role === 'wheel'), [assembly]);
  const tire = useMemo(() => geo(assembly.wheel.tire), [assembly]);
  const rim = useMemo(() => geo(assembly.wheel.rim), [assembly]);
  const disc = useMemo(() => geo(assembly.wheel.disc), [assembly]);
  const caliper = useMemo(() => geo(assembly.wheel.caliper), [assembly]);
  const tireRef = useRef<THREE.InstancedMesh>(null);
  const rimRef = useRef<THREE.InstancedMesh>(null);
  const discRef = useRef<THREE.InstancedMesh>(null);
  const caliperRef = useRef<THREE.InstancedMesh>(null);
  useEffect(() => {
    const dummy = new THREE.Object3D();
    const meshes = [tireRef, rimRef, discRef, caliperRef];
    tires.forEach((w, i) => {
      const [x, y, z] = explodedShift(w, explode);
      const [tx, ty, tz] = toThree(x, y, z);
      dummy.position.set(tx, ty, tz);
      dummy.scale.set(1, 1, w.placement.y < 0 ? -1 : 1);
      dummy.updateMatrix();
      for (const r of meshes) r.current?.setMatrixAt(i, dummy.matrix);
    });
    for (const r of meshes) if (r.current) r.current.instanceMatrix.needsUpdate = true;
  }, [tires, explode]);
  if (!visible || !tires.length) return null;
  const n = tires.length;
  return (
    <group>
      <instancedMesh ref={tireRef} args={[tire, undefined as unknown as THREE.Material, n]}>
        <meshStandardMaterial color="#161616" roughness={0.94} side={THREE.DoubleSide} clippingPlanes={clip} transparent={opacity < 1} opacity={opacity} />
      </instancedMesh>
      <instancedMesh ref={rimRef} args={[rim, undefined as unknown as THREE.Material, n]}>
        <meshPhysicalMaterial color="#8a8e94" metalness={1} roughness={0.22} clearcoat={0.45} clearcoatRoughness={0.12} side={THREE.DoubleSide} clippingPlanes={clip} transparent={opacity < 1} opacity={opacity} />
      </instancedMesh>
      <instancedMesh ref={discRef} args={[disc, undefined as unknown as THREE.Material, n]}>
        <meshStandardMaterial color="#3e4248" metalness={0.9} roughness={0.32} side={THREE.DoubleSide} clippingPlanes={clip} transparent={opacity < 1} opacity={opacity} />
      </instancedMesh>
      <instancedMesh ref={caliperRef} args={[caliper, undefined as unknown as THREE.Material, n]}>
        <meshStandardMaterial color="#c45c26" metalness={0.55} roughness={0.38} side={THREE.DoubleSide} clippingPlanes={clip} transparent={opacity < 1} opacity={opacity} />
      </instancedMesh>
    </group>
  );
}

function CarScene({ assembly, mode, paintId, hdriUrl, showOverlays, explode, section, opacity, hidden, isolated, onSelect }: {
  assembly: VehicleAssembly;
  showOverlays: boolean;
  mode: 'studio' | 'engineering';
  paintId: StudioPaintId;
  hdriUrl: string | null;
  explode: number;
  section: { axis: 'x' | 'y' | 'z'; position: number } | null;
  opacity: number;
  hidden: Set<string>;
  isolated: string | null;
  onSelect: (id: string) => void;
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
  const showInterior = mode === 'engineering' || explode > 0.02;
  return (
    <>
      {mode === 'studio' && <StudioEnv hdriUrl={hdriUrl} />}
      <ambientLight intensity={mode === 'studio' ? 0.35 : 0.7} />
      <directionalLight position={[4, 8, 3]} intensity={mode === 'studio' ? 2.2 : 1} castShadow />
      <directionalLight position={[-4, 3, -2]} intensity={0.6} color="#d7e2f0" />
      <group position={[-cx, 0, 0]}>
        {show('BODY_SHELL') && (
          <mesh geometry={paint} castShadow receiveShadow onClick={(e) => { e.stopPropagation(); onSelect('BODY_SHELL'); }}>
            {mode === 'studio'
              ? <meshPhysicalMaterial color={coatColor} metalness={coat.metallic} roughness={coat.roughness} clearcoat={coat.clearcoat} clearcoatRoughness={coat.clearcoatRoughness} clippingPlanes={clip} transparent={opacity < 1} opacity={opacity} />
              : <meshLambertMaterial color={GROUP_COLOR.exterior} flatShading clippingPlanes={clip} transparent opacity={Math.min(opacity, 0.45)} />}
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
        <WheelInstances assembly={assembly} explode={explode} clip={clip} opacity={opacity} visible={assembly.components.some((c) => c.role === 'wheel' && show(c.id))} />
        {mode === 'engineering' && doors.filter((d) => show(d.id)).map((d) => {
          const part = assembly.components.find((c) => c.id === d.id);
          const dy = part ? explodedShift(part, explode)[1] - d.placementY : 0;
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
          const [x, y, z] = explodedShift(c, explode);
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
                      : <meshLambertMaterial color={GROUP_COLOR[c.group] || '#888'} flatShading={mode === 'engineering'} transparent opacity={mode === 'engineering' ? 0.85 : 0.55} clippingPlanes={clip} />}
            </mesh>
          );
        })}
      </group>
      {mode === 'studio' && <ContactShadows position={[0, 0.001, 0]} opacity={0.42} scale={12} blur={2.6} far={3.2} />}
      <mesh rotation={[-Math.PI / 2, 0, 0]} position={[0, 0, 0]} receiveShadow>
        <circleGeometry args={[8, 48]} />
        <meshStandardMaterial color={mode === 'studio' ? '#d8d9db' : '#ececec'} roughness={0.95} />
      </mesh>
      <OrbitControls makeDefault target={[(bounds.min[0] - cx) * 0.2, 0.5, 0]} />
    </>
  );
}

export function AssemblyViewer({ assembly, viewOnly = false, glbUrl = null, hdriUrl = STUDIO_HDRI_URL }: {
  assembly: VehicleAssembly;
  viewOnly?: boolean;
  /** Presentation GLB of the analysed solid (offered for download in Studio); null hides the link. */
  glbUrl?: string | null;
  /** Equirectangular HDR for Studio lighting; null keeps the local RoomEnvironment. */
  hdriUrl?: string | null;
}) {
  const narrow = useNarrow();
  const locked = viewOnly || narrow;
  const [mode, setMode] = useState<'studio' | 'engineering'>('studio');
  const [paintId, setPaintId] = useState<StudioPaintId>('graphite');
  const [showOverlays, setShowOverlays] = useState(true);
  const overlays = assembly.surface.source === 'cad.body' ? assembly.surface.overlays || null : null;
  const [selected, setSelected] = useState<string | null>(null);
  const [explode, setExplode] = useState(0);
  const [sectionAxis, setSectionAxis] = useState<'x' | 'y' | 'z' | null>(null);
  const [sectionPos, setSectionPos] = useState(2);
  const [opacity, setOpacity] = useState(1);
  const [hidden, setHidden] = useState<Set<string>>(new Set());
  const [isolated, setIsolated] = useState<string | null>(null);
  const part = assembly.components.find((c) => c.id === selected) || null;
  const bounds = assembly.surface.mesh.bounds;
  const viewNose = bounds.min[0] - (bounds.min[0] + bounds.max[0]) / 2;
  const section = sectionAxis ? { axis: sectionAxis, position: sectionPos } : null;
  const span = sectionAxis === 'y' ? [bounds.min[1], bounds.max[1]] : sectionAxis === 'z' ? [bounds.min[2], bounds.max[2]] : [bounds.min[0], bounds.max[0]];

  return (
    <div className="flex flex-col gap-2" data-testid="assembly-viewer">
      <p className="text-[11px] leading-relaxed text-slate-400">{assembly.verification?.statement}</p>
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
                {glbUrl && assembly.surface.source === 'cad.body' && (
                  <a data-testid="present-glb" href={glbUrl} download className="ml-auto rounded border border-white/15 px-1.5 py-0.5 text-slate-300 hover:border-sky-400/40 hover:text-sky-100" title="Analysed solid with normals and this clearcoat material (glTF 2.0)">GLB</a>
                )}
              </div>
            )}
            <label className="text-[11px] text-slate-400">Explode
              <input data-testid="explode" type="range" min={0} max={1} step={0.01} value={explode} onChange={(e) => setExplode(Number(e.target.value))} className="w-full" />
            </label>
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
            <label className="text-[11px] text-slate-400">Transparency
              <input data-testid="opacity" type="range" min={0.15} max={1} step={0.01} value={opacity} onChange={(e) => setOpacity(Number(e.target.value))} className="w-full" />
            </label>
            <ul className="mt-1 space-y-0.5">
              {assembly.components.filter((c) => c.role !== 'axle').map((c) => (
                <li key={c.id}>
                  <button type="button" data-testid={`part-${c.id}`} className={`w-full truncate rounded px-1 py-0.5 text-left text-[11px] ${selected === c.id ? 'bg-white/15' : 'text-slate-300'}`} onClick={() => setSelected(c.id)}>
                    {mode === 'engineering' ? `${c.id}  ${c.name}` : c.name}
                  </button>
                </li>
              ))}
            </ul>
          </div>
        )}
        <div className="relative h-[420px] overflow-hidden rounded-lg bg-[#c5c6c8] lg:h-[520px]" data-testid="assembly-canvas">
          {mode === 'studio' && (
            <div
              data-testid="studio-preview-badge"
              className="pointer-events-none absolute left-2 top-2 z-10 rounded-md border border-amber-300/60 bg-slate-900/80 px-2 py-1 text-[11px] font-medium text-amber-200 shadow"
            >
              {assembly.surface.source === 'cad.body'
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
            <CarScene assembly={assembly} mode={mode} paintId={paintId} hdriUrl={hdriUrl} showOverlays={showOverlays} explode={explode} section={section} opacity={opacity} hidden={hidden} isolated={isolated} onSelect={setSelected} />
          </Canvas>
        </div>
        {!locked && (
          <aside className="max-h-[520px] overflow-auto rounded-lg border border-white/10 p-2 text-[11px] leading-relaxed" data-testid="inspector">
            {!part && <p className="text-slate-400">Select a part. The list and the model both select.</p>}
            {part && (
              <>
                <h3 className="text-sm text-slate-100">{part.name}</h3>
                <p className="text-slate-400">{part.geometry.kind === 'envelope' ? part.geometry.label : 'Kernel or loft solid.'}</p>
                <p className="mt-1 text-slate-300">{part.id}</p>
                <p className="text-slate-300">x {part.placement.x} m · y {part.placement.y} m · z {part.placement.z} m</p>
                {part.half && <p className="text-slate-400">span { (part.half[0] * 2).toFixed(3) } × { (part.half[1] * 2).toFixed(3) } × { (part.half[2] * 2).toFixed(3) } m</p>}
                <div className="mt-2 flex gap-1">
                  <button type="button" className="rounded bg-white/10 px-2 py-0.5" onClick={() => setHidden((h) => { const n = new Set(h); if (n.has(part.id)) n.delete(part.id); else n.add(part.id); return n; })}>{hidden.has(part.id) ? 'Show' : 'Hide'}</button>
                  <button type="button" className="rounded bg-white/10 px-2 py-0.5" onClick={() => setIsolated(isolated === part.id ? null : part.id)}>{isolated === part.id ? 'Show all' : 'Isolate'}</button>
                </div>
                <ul className="mt-2 space-y-1">
                  {(part.parameters || []).map((p) => (
                    <li key={p.id}><span className="text-slate-200">{p.name}</span> {String(p.value)} {p.unit} <span className="text-slate-500">({p.provenance.state}{p.provenance.note ? `: ${p.provenance.note}` : ''})</span></li>
                  ))}
                </ul>
                {(part.relationships || []).length > 0 && (
                  <ul className="mt-2 space-y-1 text-slate-400">
                    {part.relationships!.map((r, i) => <li key={i}>{r.kind} {r.target}{r.note ? ` — ${r.note}` : ''}</li>)}
                  </ul>
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
              {assembly.checks.map((c) => (
                <li key={c.id} data-testid={`fit-${c.id}`} className={c.status === 'fail' ? 'text-rose-300' : c.status === 'warn' ? 'text-amber-200' : 'text-emerald-200'}>
                  {c.status} {c.id}
                </li>
              ))}
            </ul>
          </aside>
        )}
      </div>
      {locked && <p className="text-[11px] text-slate-500">View only on this screen. Orbit still works.</p>}
    </div>
  );
}
