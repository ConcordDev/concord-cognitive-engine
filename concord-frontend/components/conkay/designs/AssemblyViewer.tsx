'use client';

/**
 * AssemblyViewer — the parametric vehicle, orbitable.
 * Studio is the default: clearcoat paint, transmissive glass, instanced
 * wheels, a local studio environment (three.js RoomEnvironment, no network
 * HDRI). Engineering flattens the shading and shows every envelope.
 * Selection, hide, isolate, transparency, explode and a section plane work
 * in both. A narrow screen is view-only: the canvas stays, the controls do not.
 */

import { useEffect, useMemo, useRef, useState } from 'react';
import { Canvas, useThree } from '@react-three/fiber';
import { ContactShadows, OrbitControls } from '@react-three/drei';
import * as THREE from 'three';
import { RoomEnvironment } from 'three/examples/jsm/environments/RoomEnvironment.js';
import { explodedShift, sectionPlane, toThree, type ExplodePart } from '@/lib/conkay/assembly-view';

export interface AssemblyMesh {
  positions: number[];
  normals?: number[];
  indices: number[];
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
    mesh?: { outline?: number[][]; side?: string };
    parameters?: { id: string; name: string; value: number | string; unit: string; provenance: { state: string; source?: string; note?: string } }[];
    relationships?: { kind: string; target: string; note?: string }[];
  })[];
  checks: { id: string; status: 'pass' | 'warn' | 'fail'; detail: string }[];
  surface: { mesh: { positions: number[]; normals: number[]; paint: number[]; glass: number[]; bounds: { min: number[]; max: number[] } } };
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

function geo(mesh: AssemblyMesh, index?: number[]) {
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(mesh.positions, 3));
  if (mesh.normals && mesh.normals.length === mesh.positions.length) g.setAttribute('normal', new THREE.Float32BufferAttribute(mesh.normals, 3));
  g.setIndex(index || mesh.indices);
  if (!mesh.normals) g.computeVertexNormals();
  return g;
}

function StudioEnv() {
  const gl = useThree((s) => s.gl);
  const texture = useMemo(() => {
    const pmrem = new THREE.PMREMGenerator(gl);
    const env = pmrem.fromScene(new RoomEnvironment(), 0.04).texture;
    pmrem.dispose();
    return env;
  }, [gl]);
  useEffect(() => () => { texture.dispose(); }, [texture]);
  return <primitive object={texture} attach="environment" />;
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

function CarScene({ assembly, mode, explode, section, opacity, hidden, isolated, onSelect }: {
  assembly: VehicleAssembly;
  mode: 'studio' | 'engineering';
  explode: number;
  section: { axis: 'x' | 'y' | 'z'; position: number } | null;
  opacity: number;
  hidden: Set<string>;
  isolated: string | null;
  onSelect: (id: string) => void;
}) {
  const bounds = assembly.surface.mesh.bounds;
  const cx = (bounds.min[0] + bounds.max[0]) / 2;
  const paint = useMemo(() => geo({ positions: assembly.surface.mesh.positions, normals: assembly.surface.mesh.normals, indices: assembly.surface.mesh.paint }), [assembly]);
  const glass = useMemo(() => geo({ positions: assembly.surface.mesh.positions, normals: assembly.surface.mesh.normals, indices: assembly.surface.mesh.glass }), [assembly]);
  const lampGeo = useMemo(() => (assembly.detail?.lamp ? geo(assembly.detail.lamp) : null), [assembly]);
  const grilleGeo = useMemo(() => (assembly.detail?.grille ? geo(assembly.detail.grille) : null), [assembly]);
  const doors = useMemo(() => assembly.components.filter((c) => c.role === 'opening' && c.mesh?.outline).map((c) => {
    const y = c.placement.y + (c.mesh?.side === 'L' ? -0.004 : 0.004);
    const geometry = new THREE.BufferGeometry().setFromPoints((c.mesh?.outline || []).map(([ox, oz]) => new THREE.Vector3(...toThree(ox, y, oz))));
    return { id: c.id, geometry, placementY: c.placement.y };
  }), [assembly]);
  const clip = useMemo(() => {
    if (!section) return [];
    const p = sectionPlane(section.axis, section.position);
    return [new THREE.Plane(new THREE.Vector3(...p.normal), p.constant)];
  }, [section]);
  const show = (id: string) => !hidden.has(id) && (!isolated || isolated === id);
  const showInterior = mode === 'engineering' || explode > 0.02;
  return (
    <>
      {mode === 'studio' && <StudioEnv />}
      <ambientLight intensity={mode === 'studio' ? 0.35 : 0.7} />
      <directionalLight position={[4, 8, 3]} intensity={mode === 'studio' ? 2.2 : 1} castShadow />
      <directionalLight position={[-4, 3, -2]} intensity={0.6} color="#d7e2f0" />
      <group position={[-cx, 0, 0]}>
        {show('BODY_SHELL') && (
          <mesh geometry={paint} castShadow receiveShadow onClick={(e) => { e.stopPropagation(); onSelect('BODY_SHELL'); }}>
            {mode === 'studio'
              ? <meshPhysicalMaterial color="#e6e8ee" metalness={0.9} roughness={0.16} clearcoat={1} clearcoatRoughness={0.05} clippingPlanes={clip} transparent={opacity < 1} opacity={opacity} />
              : <meshLambertMaterial color={GROUP_COLOR.exterior} flatShading clippingPlanes={clip} transparent opacity={Math.min(opacity, 0.45)} />}
          </mesh>
        )}
        {show('GLAZING') && (
          <mesh geometry={glass} onClick={(e) => { e.stopPropagation(); onSelect('GLAZING'); }}>
            <meshPhysicalMaterial color="#9ec4d4" metalness={0} roughness={0.05} transmission={mode === 'studio' ? 0.86 : 0.2} thickness={0.4} clippingPlanes={clip} transparent opacity={mode === 'studio' ? opacity : 0.35} />
          </mesh>
        )}
        <WheelInstances assembly={assembly} explode={explode} clip={clip} opacity={opacity} visible={assembly.components.some((c) => c.role === 'wheel' && show(c.id))} />
        {doors.filter((d) => show(d.id)).map((d) => {
          const part = assembly.components.find((c) => c.id === d.id);
          const dy = part ? explodedShift(part, explode)[1] - d.placementY : 0;
          return (
            <lineLoop key={d.id} geometry={d.geometry} position={[0, 0, -dy]}>
              <lineBasicMaterial color={mode === 'studio' ? '#1c1c1c' : '#333'} clippingPlanes={clip} />
            </lineLoop>
          );
        })}
        {assembly.components.filter((c) => c.role === 'lamp' || c.role === 'intake' || (showInterior && c.half && c.role !== 'wheel' && c.role !== 'body' && c.role !== 'glass' && c.role !== 'opening' && c.id !== 'SPARE')).map((c) => {
          if (!show(c.id) || !c.half) return null;
          const [x, y, z] = explodedShift(c, explode);
          const [tx, ty, tz] = toThree(x, y, z);
          const studioDetail = c.role === 'lamp' || c.role === 'intake';
          if (mode === 'studio' && !studioDetail && !showInterior) return null;
          const shaped = (c.role === 'lamp' && lampGeo) || (c.role === 'intake' && grilleGeo);
          return (
            <mesh key={c.id} geometry={shaped || undefined} position={[tx, ty, tz]} onClick={(e) => { e.stopPropagation(); onSelect(c.id); }}>
              {!shaped && <boxGeometry args={[c.half[0] * 2, c.half[2] * 2, c.half[1] * 2]} />}
              {c.role === 'lamp'
                ? <meshPhysicalMaterial color="#e7eef8" emissive="#f7fbff" emissiveIntensity={mode === 'studio' ? 1.6 : 0.4} roughness={0.08} metalness={0.05} clearcoat={1} clearcoatRoughness={0.05} clippingPlanes={clip} />
                : c.role === 'intake'
                  ? <meshStandardMaterial color="#121212" roughness={0.72} metalness={0.4} clippingPlanes={clip} />
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

export function AssemblyViewer({ assembly, viewOnly = false }: { assembly: VehicleAssembly; viewOnly?: boolean }) {
  const narrow = useNarrow();
  const locked = viewOnly || narrow;
  const [mode, setMode] = useState<'studio' | 'engineering'>('studio');
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
        <div className="h-[420px] overflow-hidden rounded-lg bg-[#c5c6c8] lg:h-[520px]" data-testid="assembly-canvas">
          <Canvas
            gl={{ antialias: true, toneMapping: THREE.ACESFilmicToneMapping, toneMappingExposure: 1.05, localClippingEnabled: true }}
            camera={{ position: [viewNose - 1.8, 0.92, 2.6], fov: 28 }}
            dpr={narrow ? [1, 1] : [1, 1.5]}
          >
            <color attach="background" args={[mode === 'studio' ? '#d8d9db' : '#ececec']} />
            <CarScene assembly={assembly} mode={mode} explode={explode} section={section} opacity={opacity} hidden={hidden} isolated={isolated} onSelect={setSelected} />
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
