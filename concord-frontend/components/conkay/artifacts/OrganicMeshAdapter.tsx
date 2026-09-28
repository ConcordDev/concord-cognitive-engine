'use client';

// concord-frontend/components/conkay/artifacts/OrganicMeshAdapter.tsx
//
// The `organic-mesh` adapter — ConKay's "artifact → interactive-3D" path for
// content that was never pre-authored (evo-asset.generate-organic's free-text
// prompt mode, see artifact-kinds.ts). Unlike CreatureAdapter (a procedural
// factory driven by real params) this loads the ACTUAL generated GLB — the
// exact file TRELLIS produced and Concord normalized/LOD'd — via the same
// cached GLTFLoader wrapper the world lens uses (lib/world-lens/asset-loader).
//
// Honest load states: the normalizer only ever hands this a genuinely
// finished job, but the mesh fetch itself is a real network request that can
// still be pending or fail (a stale evo_assets row, a moved file) — those
// get their own worded states, never a silent blank Canvas.

import { useEffect, useMemo, useState } from 'react';
import { Canvas } from '@react-three/fiber';
import { OrbitControls } from '@react-three/drei';
import * as THREE from 'three';
import { loadGLTF } from '@/lib/world-lens/asset-loader';
import type { ConkayOrganicMeshArtifact } from '@/lib/conkay/artifact-kinds';
import { ArtifactProvenance } from './ArtifactProvenance';

type LoadState = 'loading' | 'loaded' | 'error';

/** Fits a camera distance to the mesh's real bounding sphere so an arbitrary
 *  generated object (a lantern, a shrub, a two-headed goat) frames sensibly
 *  regardless of its actual scale — never a hardcoded distance that only
 *  suits one asset's size. */
function frameDistance(object: THREE.Object3D): number {
  const box = new THREE.Box3().setFromObject(object);
  const sphere = box.getBoundingSphere(new THREE.Sphere());
  if (!Number.isFinite(sphere.radius) || sphere.radius <= 0) return 2;
  return Math.max(0.5, sphere.radius * 2.4);
}

function OrganicMeshBridge({ url, onState }: { url: string; onState: (s: LoadState, dist?: number) => void }) {
  const [object, setObject] = useState<THREE.Object3D | null>(null);

  useEffect(() => {
    let cancelled = false;
    onState('loading');
    loadGLTF(url, THREE).then((scene) => {
      if (cancelled) return;
      if (!scene) {
        onState('error');
        return;
      }
      const obj = scene as THREE.Object3D;
      setObject(obj);
      onState('loaded', frameDistance(obj));
    });
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [url]);

  if (!object) return null;
  return <primitive object={object} />;
}

export function OrganicMeshAdapter({ artifact }: { artifact: ConkayOrganicMeshArtifact }) {
  const [state, setState] = useState<LoadState>('loading');
  const [camDist, setCamDist] = useState(2.4);

  const handleState = useMemo(
    () => (s: LoadState, dist?: number) => {
      setState(s);
      if (dist) setCamDist(dist);
    },
    [],
  );

  return (
    <div data-testid="ck-adapter-organic-mesh">
      <div className="relative h-[340px] w-full overflow-hidden rounded-lg bg-black">
        <Canvas camera={{ position: [camDist, camDist * 0.7, camDist], fov: 45 }}>
          <ambientLight intensity={0.8} />
          <directionalLight position={[3, 5, 2]} intensity={0.9} />
          {/* keyed by URL so a changed artifact remounts fresh (resets `object`
              to null) instead of manually resyncing state inside the effect. */}
          <OrganicMeshBridge key={artifact.glbUrl} url={artifact.glbUrl} onState={handleState} />
          <OrbitControls makeDefault />
        </Canvas>

        {state === 'loading' && (
          <div
            data-testid="ck-adapter-organic-mesh-loading"
            className="pointer-events-none absolute inset-0 flex items-center justify-center text-[12px] text-cyan-300/60"
          >
            loading generated mesh…
          </div>
        )}
        {state === 'error' && (
          <div
            data-testid="ck-adapter-organic-mesh-error"
            className="pointer-events-none absolute inset-0 flex items-center justify-center px-4 text-center text-[12px] text-rose-300/80"
          >
            mesh registered but the file couldn&apos;t be loaded — it may have moved or been archived.
          </div>
        )}

        {/* Honest facts, straight from the generation job — never invented. */}
        <div
          data-testid="ck-adapter-organic-mesh-facts"
          className="pointer-events-none absolute left-2 top-2 flex flex-col gap-0.5 rounded-md bg-black/50 px-2 py-1 text-[10px] text-emerald-200"
        >
          {artifact.displayName && <span className="font-mono">{artifact.displayName}</span>}
          {artifact.category && <span>{artifact.category}</span>}
          {artifact.lod0Tris != null && <span>{artifact.lod0Tris.toLocaleString()} tris</span>}
          {artifact.provider && <span className="text-cyan-300/70">{artifact.provider}</span>}
        </div>
      </div>
      <ArtifactProvenance artifact={artifact} />
    </div>
  );
}

export default OrganicMeshAdapter;
