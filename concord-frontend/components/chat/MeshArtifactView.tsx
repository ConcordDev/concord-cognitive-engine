'use client';

/**
 * MeshArtifactView — the 3D model a ConKay design returns (conkay_design's
 * `mesh` artifact: the solved part's triangle positions + indices, the same
 * arrays POST /api/conkay/design serves). Orbit to inspect; coloured by the
 * solver's utilization band when the server sent one.
 */

import { useMemo } from 'react';
import { Canvas } from '@react-three/fiber';
import { Bounds, Edges, OrbitControls } from '@react-three/drei';
import { BufferAttribute, BufferGeometry } from 'three';

export interface MeshArtifact {
  positions: number[];
  indices: number[];
  color?: string | null;
  title?: string;
}

function Part({ positions, indices, color }: MeshArtifact) {
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

export default function MeshArtifactView(props: MeshArtifact) {
  return (
    <div className="h-56 w-full overflow-hidden rounded-lg bg-[radial-gradient(ellipse_at_center,#0b2340_0%,#050b14_70%)] ring-1 ring-sky-400/20" data-testid="mesh-artifact">
      <Canvas camera={{ position: [1, 0.8, 1.2], fov: 40 }} dpr={[1, 2]}>
        <ambientLight intensity={0.6} />
        <directionalLight position={[3, 5, 4]} intensity={1.1} />
        <Bounds fit clip observe margin={1.3}>
          <Part {...props} />
        </Bounds>
        <OrbitControls makeDefault enableDamping />
      </Canvas>
    </div>
  );
}
