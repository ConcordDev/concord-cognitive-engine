'use client';

/**
 * StlViewer — the CAD kernel's own tessellation of a design (binary STL from
 * the snapshot), orbitable. No smoothing or decoration beyond vertex normals:
 * what you see is the mesh cad.body exported.
 */

import { useEffect, useMemo, useState } from 'react';
import { Canvas } from '@react-three/fiber';
import { OrbitControls } from '@react-three/drei';
import * as THREE from 'three';
import { STLLoader } from 'three/examples/jsm/loaders/STLLoader.js';

export default function StlViewer({ url, onError }: { url: string; onError?: (msg: string) => void }) {
  const [geometry, setGeometry] = useState<THREE.BufferGeometry | null>(null);

  useEffect(() => {
    let live = true;
    fetch(url, { credentials: 'omit' })
      .then((r) => { if (!r.ok) throw new Error(`model request failed (${r.status})`); return r.arrayBuffer(); })
      .then((buf) => {
        if (!live) return;
        const g = new STLLoader().parse(buf);
        g.rotateX(-Math.PI / 2); // kernel is z-up; three is y-up
        g.computeVertexNormals();
        g.computeBoundingBox();
        const c = new THREE.Vector3();
        g.boundingBox?.getCenter(c);
        g.translate(-c.x, -(g.boundingBox?.min.y ?? 0), -c.z);
        setGeometry(g);
      })
      .catch((e: unknown) => onError?.(e instanceof Error ? e.message : String(e)));
    return () => { live = false; };
  }, [url, onError]);

  const size = useMemo(() => {
    if (!geometry?.boundingBox) return 5;
    const s = new THREE.Vector3();
    geometry.boundingBox.getSize(s);
    return Math.max(s.x, s.y, s.z);
  }, [geometry]);

  return (
    <Canvas camera={{ position: [size * 0.9, size * 0.45, size * 0.9], fov: 35 }} dpr={[1, 2]}>
      <color attach="background" args={['#050d18']} />
      <hemisphereLight args={['#dbe7ff', '#0b1220', 0.9]} />
      <directionalLight position={[size, size * 1.5, size * 0.8]} intensity={1.6} />
      <directionalLight position={[-size, size * 0.6, -size]} intensity={0.5} />
      {geometry && (
        <mesh geometry={geometry}>
          <meshStandardMaterial color="#9aa6b8" metalness={0.55} roughness={0.32} />
        </mesh>
      )}
      <gridHelper args={[size * 2, 20, '#1e3a5f', '#0f2238']} />
      <OrbitControls makeDefault enableDamping target={[0, size * 0.12, 0]} />
    </Canvas>
  );
}
