'use client';

/**
 * MeshArtifactView — the 3D model a ConKay design or generate_3d returns.
 * Older messages still carry triangle positions. A saved chat message keeps
 * a media URL (the GLB lives in the artifact store) and this view loads it.
 */

import { useEffect, useMemo, useState } from 'react';
import { Canvas } from '@react-three/fiber';
import { Bounds, Edges, OrbitControls } from '@react-three/drei';
import { BufferAttribute, BufferGeometry, Mesh, MeshStandardMaterial, type Group } from 'three';

export interface MeshArtifact {
  positions?: number[];
  indices?: number[];
  /** Private media stream, `/api/media/:id/stream`. Cookies go with the GLB fetch. */
  url?: string;
  color?: string | null;
  title?: string;
  /** Container classes; defaults to the chat card size. */
  className?: string;
  testId?: string;
}

function Part({ positions, indices, color }: { positions: number[]; indices: number[]; color?: string | null }) {
  const geometry = useMemo(() => {
    const g = new BufferGeometry();
    g.setAttribute('position', new BufferAttribute(new Float32Array(positions), 3));
    g.setIndex(indices);
    g.computeVertexNormals();
    return g;
  }, [positions, indices]);
  return (
    <mesh geometry={geometry}>
      <meshStandardMaterial color={color || '#38bdf8'} metalness={0.3} roughness={0.5} />
      <Edges threshold={20} color="#0f172a" />
    </mesh>
  );
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
        const tint = color || '#38bdf8';
        gltf.scene.traverse((obj) => {
          if (obj instanceof Mesh) {
            obj.material = new MeshStandardMaterial({ color: tint, metalness: 0.3, roughness: 0.5 });
          }
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

export default function MeshArtifactView({ positions, indices, url, color, className, testId }: MeshArtifact) {
  const hasPositions = Array.isArray(positions) && positions.length >= 9 && Array.isArray(indices) && indices.length >= 3;
  const mediaUrl = !hasPositions && typeof url === 'string' && /^\/api\/media\/[^/]+\/stream$/.test(url) ? url : '';
  const { scene, failed } = useGlbScene(mediaUrl || undefined, color);
  const shell = className ?? 'h-56 w-full overflow-hidden rounded-lg bg-[radial-gradient(ellipse_at_center,#0b2340_0%,#050b14_70%)] ring-1 ring-sky-400/20';
  if (!hasPositions && !mediaUrl) return null;
  if (mediaUrl && failed) {
    return (
      <div className={`${shell} flex items-center justify-center px-4 text-center text-xs text-zinc-400`} data-testid={testId ?? 'mesh-artifact'}>
        This 3D model could not be loaded.
      </div>
    );
  }
  return (
    <div className={shell} data-testid={testId ?? 'mesh-artifact'}>
      {mediaUrl && !scene ? (
        <div className="h-full w-full animate-pulse bg-white/5" />
      ) : (
        <Canvas camera={{ position: [1, 0.8, 1.2], fov: 40 }} dpr={[1, 2]}>
          <ambientLight intensity={0.6} />
          <directionalLight position={[3, 5, 4]} intensity={1.1} />
          <Bounds fit clip observe margin={1.3}>
            {hasPositions ? <Part positions={positions!} indices={indices!} color={color} /> : scene ? <primitive object={scene} /> : null}
          </Bounds>
          <OrbitControls makeDefault enableDamping />
        </Canvas>
      )}
    </div>
  );
}
