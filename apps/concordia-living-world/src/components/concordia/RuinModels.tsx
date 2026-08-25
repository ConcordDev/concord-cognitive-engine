import { useGLTF } from "@react-three/drei";
import { useMemo } from "react";
import * as THREE from "three";

const STATUE = "/models/ruins/gothic_statue/gothic_statue_1k.gltf";
const BOULDER = "/models/ruins/boulder_01/boulder_01_1k.gltf";
const BUST = "/models/ruins/marble_bust_01/marble_bust_01_1k.gltf";

useGLTF.preload(STATUE);
useGLTF.preload(BOULDER);
useGLTF.preload(BUST);

function GltfClone({ url, scale = 1 }: { url: string; scale?: number }) {
  const gltf = useGLTF(url);
  const scene = useMemo(() => {
    const c = gltf.scene.clone(true);
    c.traverse((o) => {
      const m = o as THREE.Mesh;
      if (!m.isMesh) return;
      m.castShadow = true;
      m.receiveShadow = true;
    });
    return c;
  }, [gltf.scene]);
  return <primitive object={scene} scale={scale} />;
}

export function RuinStatue({ variant = "gothic" }: { variant?: "gothic" | "bust" }) {
  if (variant === "bust") return <GltfClone url={BUST} scale={2.4} />;
  return <GltfClone url={STATUE} scale={1.15} />;
}

export function RuinBoulder({ scale = 1 }: { scale?: number }) {
  return <GltfClone url={BOULDER} scale={scale} />;
}
