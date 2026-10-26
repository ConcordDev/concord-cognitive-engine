'use client';

/**
 * MeshArtifactView — the 3D model a ConKay design or generate_3d returns.
 * CAD layouts are 1 unit = 1 mm. A media URL is a GLB already in those
 * units. Inline positions that are still metres are scaled for display.
 * A TRELLIS mesh with no requested size stays unitless.
 */

import { useEffect, useMemo, useState } from 'react';
import { Canvas } from '@react-three/fiber';
import { Bounds, Edges, Grid, OrbitControls } from '@react-three/drei';
import { BufferAttribute, BufferGeometry, Mesh, MeshStandardMaterial, type Group, type Material } from 'three';
import { dimensionLabel, displayScale, gridStep, isUnitless, scaleBarLength, spanMm, type MeshSize } from '@/lib/mesh/scale-readout';

export interface MeshArtifact extends MeshSize {
  positions?: number[];
  indices?: number[];
  /** Private media stream, `/api/media/:id/stream`. Cookies go with the GLB fetch. */
  url?: string;
  color?: string | null;
  title?: string;
  partList?: Array<{ name: string; size_mm?: number[] | { x?: number; y?: number; z?: number } }>;
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

function Part({ positions, indices, color, scale }: { positions: number[]; indices: number[]; color?: string | null; scale: number }) {
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
      <meshStandardMaterial color={color || '#94a3b8'} metalness={0.3} roughness={0.5} />
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

export default function MeshArtifactView({
  positions, indices, url, color, className, testId,
  units, geometryUnits, bbox_mm, scaleNote, extents_mm, partList,
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
        <Canvas camera={{ position: [1, 0.8, 1.2], fov: 40 }} dpr={1}>
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
          <Bounds fit clip observe margin={1.3}>
            {showPositions ? <Part positions={positions!} indices={indices!} color={color} scale={scale} /> : scene ? <primitive object={scene} /> : null}
          </Bounds>
          <OrbitControls makeDefault enableDamping />
        </Canvas>
      )}
      <Readout mesh={size} partList={partList} />
    </div>
  );
}
