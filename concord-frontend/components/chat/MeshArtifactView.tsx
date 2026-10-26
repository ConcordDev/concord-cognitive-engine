'use client';

/**
 * MeshArtifactView — the 3D model a ConKay design or generate_3d returns.
 * CAD layouts are 1 unit = 1 mm. A media URL is a GLB already in those
 * units. Inline positions that are still metres are scaled for display.
 * A TRELLIS mesh with no requested size stays unitless.
 */

import { useCallback, useEffect, useMemo, useState } from 'react';
import { Canvas, useThree } from '@react-three/fiber';
import { Bounds, Edges, Grid, OrbitControls } from '@react-three/drei';
import { BufferAttribute, BufferGeometry, Mesh, MeshStandardMaterial, Plane, Raycaster, Vector2, Vector3, type Group, type Material } from 'three';
import { dimensionLabel, displayScale, gridStep, isUnitless, scaleBarLength, spanMm, type MeshSize } from '@/lib/mesh/scale-readout';
import {
  applySectionClip, massLabel, measureDistance, partVisibility, pushMeasurePoint, sectionAt, STEP_EXPORT, VIEW_DIRECTION, visibleIndices,
  type ClipObject, type PartRange, type StandardView, type Vec3,
} from '@/lib/mesh/engineering-view';
import { meshToGlb, meshToStep, meshToStl } from '@/lib/mesh/mesh-export';

export interface MeshArtifact extends MeshSize {
  positions?: number[];
  indices?: number[];
  /** Private media stream, `/api/media/:id/stream`. Cookies go with the GLB fetch. */
  url?: string;
  color?: string | null;
  title?: string;
  partList?: Array<{ name: string; size_mm?: number[] | { x?: number; y?: number; z?: number }; nodeName?: string }>;
  partRanges?: PartRange[];
  engineering?: { massKg?: number | null; massNote?: string | null };
  /** Container classes; defaults to the chat card size. */
  className?: string;
  testId?: string;
}

const MEDIA_URL = /^\/api\/media\/[^/]+\/stream$/;

function sizeText(size: number[] | { x?: number; y?: number; z?: number } | undefined): string {
  if (Array.isArray(size)) return size.join('×');
  if (size && typeof size === 'object' && size.x != null && size.y != null && size.z != null) {
    return `${size.x}×${size.y}×${size.z}`;
  }
  return '';
}

function Part({ positions, indices, color, scale, clip }: { positions: number[]; indices: number[]; color?: string | null; scale: number; clip: Plane[] }) {
  const geometry = useMemo(() => {
    const src = scale === 1 ? positions : positions.map((n) => n * scale);
    const g = new BufferGeometry();
    g.setAttribute('position', new BufferAttribute(new Float32Array(src), 3));
    g.setIndex(indices);
    g.computeVertexNormals();
    return g;
  }, [positions, indices, scale]);
  return (
    <mesh geometry={geometry}>
      <meshStandardMaterial color={color || '#94a3b8'} metalness={0.3} roughness={0.5} clippingPlanes={clip} />
      <Edges threshold={20} color="#0f172a" />
    </mesh>
  );
}

function hasOwnMaterial(material: Material | Material[] | undefined): boolean {
  if (Array.isArray(material)) return material.length > 0;
  return !!material;
}

function useGlbScene(url: string | undefined, color?: string | null) {
  const [scene, setScene] = useState<Group | null>(null);
  const [failed, setFailed] = useState(false);
  useEffect(() => {
    if (!url) return;
    let cancel = false;
    setFailed(false);
    setScene(null);
    (async () => {
      try {
        const { GLTFLoader } = await import('three/addons/loaders/GLTFLoader.js');
        const loader = new GLTFLoader();
        // img tags send cookies. FileLoader does not, and this media is private.
        loader.setWithCredentials(true);
        const gltf = await loader.loadAsync(url);
        if (cancel) return;
        gltf.scene.traverse((obj) => {
          if (!(obj instanceof Mesh)) return;
          // A CAD GLB already carries one material per part. Retinting it
          // would erase that.
          if (hasOwnMaterial(obj.material)) return;
          obj.material = new MeshStandardMaterial({ color: color || '#94a3b8', metalness: 0.3, roughness: 0.5 });
        });
        setScene(gltf.scene);
      } catch {
        if (!cancel) setFailed(true);
      }
    })();
    return () => { cancel = true; };
  }, [url, color]);
  return { scene, failed };
}

function Readout({ mesh, partList }: { mesh: MeshSize; partList?: MeshArtifact['partList'] }) {
  const label = dimensionLabel(mesh);
  const span = spanMm(mesh);
  const unitless = isUnitless(mesh);
  const step = span > 0 ? gridStep(span) : 0;
  const bar = span > 0 ? scaleBarLength(span) : 0;
  if (!label && !unitless && step <= 0) return null;
  return (
    <div className="pointer-events-none absolute inset-x-0 bottom-0 z-10 bg-gradient-to-t from-black/80 to-transparent px-3 pb-2 pt-6 text-[11px] text-zinc-200">
      {label ? <div data-testid="mesh-dimensions">{label}</div> : null}
      {unitless ? (
        <div data-testid="mesh-unit-grid">grid (mesh units)</div>
      ) : step > 0 ? (
        <div data-testid="mesh-unit-grid">grid {step} mm</div>
      ) : null}
      {unitless ? (
        <div data-testid="mesh-scale-bar">mesh units</div>
      ) : bar > 0 ? (
        <div data-testid="mesh-scale-bar" style={{ width: '4rem' }}>{bar} mm</div>
      ) : null}
      {partList && partList.length > 0 ? (
        <ul data-testid="mesh-part-sizes" className="mt-1 max-h-16 overflow-hidden">
          {partList.map((p, i) => (
            <li key={`${p.name}-${i}`}>{p.name}{sizeText(p.size_mm) ? ` ${sizeText(p.size_mm)}` : ''}</li>
          ))}
        </ul>
      ) : null}
    </div>
  );
}

function SectionApplier({ planes }: { planes: Plane[] }) {
  const scene = useThree((s) => s.scene);
  useEffect(() => {
    applySectionClip(scene as unknown as ClipObject, planes);
  }, [scene, planes]);
  return null;
}

function MeasureProbe({ enabled, onPoint }: { enabled: boolean; onPoint: (p: Vec3) => void }) {
  const { camera, scene, gl } = useThree();
  useEffect(() => {
    if (!enabled) return;
    const ray = new Raycaster();
    const ndc = new Vector2();
    const onDown = (ev: PointerEvent) => {
      const rect = gl.domElement.getBoundingClientRect();
      if (!rect.width || !rect.height) return;
      ndc.set(((ev.clientX - rect.left) / rect.width) * 2 - 1, -((ev.clientY - rect.top) / rect.height) * 2 + 1);
      ray.setFromCamera(ndc, camera);
      const hit = ray.intersectObjects(scene.children, true)[0];
      if (hit) onPoint([hit.point.x, hit.point.y, hit.point.z]);
    };
    gl.domElement.addEventListener('pointerdown', onDown);
    return () => gl.domElement.removeEventListener('pointerdown', onDown);
  }, [enabled, camera, scene, gl, onPoint]);
  return null;
}

function textEncoderBytes(text: string): Uint8Array {
  return new TextEncoder().encode(text);
}

function downloadBytes(bytes: ArrayBuffer | Uint8Array, filename: string, mime: string) {
  const blob = new Blob([bytes as BlobPart], { type: mime });
  const href = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = href;
  a.download = filename;
  a.click();
  URL.revokeObjectURL(href);
}

export default function MeshArtifactView({
  positions, indices, url, color, className, testId,
  units, geometryUnits, bbox_mm, scaleNote, extents_mm, partList, partRanges, engineering,
}: MeshArtifact) {
  const hasPositions = Array.isArray(positions) && positions.length >= 9 && Array.isArray(indices) && indices.length >= 3;
  const mediaUrl = typeof url === 'string' && MEDIA_URL.test(url) ? url : '';
  const { scene, failed } = useGlbScene(mediaUrl || undefined, color);
  const showPositions = hasPositions && (!mediaUrl || failed);
  const scale = displayScale({ usingPositions: showPositions, geometryUnits, units });
  const shell = `${className ?? 'h-56 w-full overflow-hidden rounded-lg bg-[radial-gradient(ellipse_at_center,#0b2340_0%,#050b14_70%)] ring-1 ring-sky-400/20'} relative`;
  const size: MeshSize = { units, geometryUnits, bbox_mm, scaleNote, extents_mm };
  const span = spanMm(size);
  const step = span > 0 ? gridStep(span) : 0;
  const unitless = isUnitless(size);
  const [view, setView] = useState<StandardView | 'orbit'>('orbit');
  const [sectionOn, setSectionOn] = useState(false);
  const [sectionT, setSectionT] = useState(0.5);
  const [measuring, setMeasuring] = useState(false);
  const [measurePts, setMeasurePts] = useState<Vec3[]>([]);
  const [hidden, setHidden] = useState<string[]>([]);
  const [isolated, setIsolated] = useState<string | null>(null);
  const hiddenSet = useMemo(() => new Set(hidden), [hidden]);
  const xMax = bbox_mm?.length && bbox_mm.length > 0 ? bbox_mm.length : (extents_mm?.x && extents_mm.x > 0 ? extents_mm.x : span);
  const cut = sectionAt(0, xMax || 1, sectionT);
  const planes = useMemo(() => (sectionOn ? [new Plane(new Vector3(1, 0, 0), -cut)] : []), [sectionOn, cut]);
  const shownIndices = useMemo(
    () => (hasPositions && indices ? visibleIndices(indices, partRanges, hiddenSet, isolated) : []),
    [hasPositions, indices, partRanges, hiddenSet, isolated],
  );
  const onPoint = useCallback((p: Vec3) => setMeasurePts((cur) => pushMeasurePoint(cur, p)), []);
  const distance = measurePts.length === 2 ? measureDistance(measurePts[0], measurePts[1]) : null;
  const parts = (partList && partList.length > 0 ? partList : [{ name: 'model' }]).map((p, i) => ({
    id: p.nodeName || partRanges?.[i]?.nodeName || p.name,
    label: p.name,
  }));
  const exportPositions = hasPositions ? (scale === 1 ? positions! : positions!.map((n) => n * scale)) : null;
  const exportIndices = hasPositions ? indices! : null;
  const save = (kind: 'stl' | 'glb' | 'step') => {
    if (!exportPositions || !exportIndices) return;
    if (kind === 'stl') downloadBytes(meshToStl(exportPositions, exportIndices), 'model.stl', 'model/stl');
    else if (kind === 'glb') downloadBytes(meshToGlb(exportPositions, exportIndices, 'model'), 'model.glb', 'model/gltf-binary');
    else downloadBytes(textEncoderBytes(meshToStep(exportPositions, exportIndices)), 'model.stp', 'application/step');
  };
  const camPosition: [number, number, number] = view === 'orbit'
    ? [Math.max(span, 1), Math.max(span, 1) * 0.8, Math.max(span, 1) * 1.2]
    : [
      VIEW_DIRECTION[view].position[0] * Math.max(span, 1) * 2,
      VIEW_DIRECTION[view].position[1] * Math.max(span, 1) * 2,
      VIEW_DIRECTION[view].position[2] * Math.max(span, 1) * 2,
    ];
  if (!hasPositions && !mediaUrl) return null;
  return (
    <div className={shell} data-testid={testId ?? 'mesh-artifact'}>
      {mediaUrl && !scene && !failed ? (
        <div className="h-full w-full animate-pulse bg-white/5" />
      ) : mediaUrl && failed && !hasPositions ? (
        <div className="flex h-full items-center justify-center px-4 text-center text-xs text-zinc-400">
          This 3D model could not be loaded.
        </div>
      ) : (
        <Canvas
          key={view}
          orthographic={view !== 'orbit'}
          camera={view === 'orbit' ? { position: camPosition, fov: 40 } : { position: camPosition, zoom: span > 0 ? 200 / span : 1 }}
          dpr={1}
          gl={{ localClippingEnabled: true }}
        >
          <ambientLight intensity={0.6} />
          <directionalLight position={[3, 5, 4]} intensity={1.1} />
          {step > 0 ? (
            <Grid
              args={[span * 2, span * 2]}
              cellSize={step}
              sectionSize={step * 5}
              cellColor="#334155"
              sectionColor="#64748b"
              infiniteGrid={false}
              fadeDistance={span * 4}
            />
          ) : null}
          <SectionApplier planes={planes} />
          <MeasureProbe enabled={measuring} onPoint={onPoint} />
          <Bounds fit clip observe margin={1.3}>
            {showPositions && shownIndices.length >= 3 ? <Part positions={positions!} indices={shownIndices} color={color} scale={scale} clip={planes} /> : scene ? <primitive object={scene} /> : null}
          </Bounds>
          <OrbitControls makeDefault enableDamping />
        </Canvas>
      )}
      <Readout mesh={size} partList={partList} />
      <div className="pointer-events-auto absolute inset-x-0 top-0 z-10 flex flex-wrap items-center gap-1 bg-black/55 px-2 py-1 text-[11px] text-zinc-100">
        <button type="button" data-testid="mesh-measure" aria-pressed={measuring} className="rounded px-1.5 py-0.5 hover:bg-white/10" onClick={() => { setMeasuring((v) => !v); setMeasurePts([]); }}>Measure</button>
        <button type="button" data-testid="mesh-section-toggle" aria-pressed={sectionOn} className="rounded px-1.5 py-0.5 hover:bg-white/10" onClick={() => setSectionOn((v) => !v)}>Section</button>
        {(Object.keys(VIEW_DIRECTION) as StandardView[]).map((id) => (
          <button key={id} type="button" data-testid={`view-${id}`} aria-pressed={view === id} className="rounded px-1.5 py-0.5 hover:bg-white/10" onClick={() => setView(id)}>{VIEW_DIRECTION[id].label}</button>
        ))}
        <button type="button" data-testid="view-orbit" aria-pressed={view === 'orbit'} className="rounded px-1.5 py-0.5 hover:bg-white/10" onClick={() => setView('orbit')}>Orbit</button>
        <span data-testid="mesh-mass">{massLabel(engineering) || (unitless ? '' : '')}</span>
        <button type="button" data-testid="export-stl" disabled={!exportPositions} className="rounded px-1.5 py-0.5 hover:bg-white/10 disabled:opacity-40" onClick={() => save('stl')}>STL</button>
        <button type="button" data-testid="export-glb" disabled={!exportPositions} className="rounded px-1.5 py-0.5 hover:bg-white/10 disabled:opacity-40" onClick={() => save('glb')}>GLB</button>
        <button type="button" data-testid="export-step" disabled={!exportPositions} className="rounded px-1.5 py-0.5 hover:bg-white/10 disabled:opacity-40" onClick={() => save('step')}>{STEP_EXPORT.label}</button>
      </div>
      {sectionOn ? (
        <label className="pointer-events-auto absolute left-2 top-8 z-10 text-[11px] text-zinc-200">
          section x = {unitless ? cut.toFixed(2) : `${Math.round(cut)} mm`}
          <input data-testid="mesh-section" type="range" min={0} max={1000} value={Math.round(sectionT * 1000)} onChange={(e) => setSectionT(Number(e.target.value) / 1000)} />
        </label>
      ) : null}
      {measuring ? (
        <div data-testid="mesh-measure-readout" className="pointer-events-none absolute right-2 top-8 z-10 text-[11px] text-zinc-100">
          {distance == null ? 'Click two points on the model.' : `${Math.round(distance * 1000) / 1000} ${unitless ? 'mesh units' : 'mm'}`}
        </div>
      ) : null}
      <ul data-testid="mesh-parts-tree" className="pointer-events-auto absolute bottom-16 left-2 z-10 max-h-24 overflow-auto text-[11px] text-zinc-200">
        {parts.map((p) => {
          const shown = partVisibility(p.id, hiddenSet, isolated);
          return (
            <li key={p.id} className="flex gap-1">
              <span>{p.label}</span>
              <button type="button" data-testid={`part-hide-${p.id}`} aria-pressed={!shown} onClick={() => setHidden((cur) => cur.includes(p.id) ? cur.filter((x) => x !== p.id) : [...cur, p.id])}>{shown ? 'Hide' : 'Show'}</button>
              <button type="button" data-testid={`part-isolate-${p.id}`} aria-pressed={isolated === p.id} onClick={() => setIsolated((cur) => cur === p.id ? null : p.id)}>Isolate</button>
            </li>
          );
        })}
      </ul>
      <p data-testid="step-note" className="pointer-events-none absolute bottom-10 right-2 z-10 max-w-[14rem] text-[10px] text-zinc-400">{STEP_EXPORT.note}</p>
    </div>
  );
}
