import { useGLTF } from "@react-three/drei";
import { useMemo } from "react";
import * as THREE from "three";
import { heightAt } from "@/game/life";
import { WORLD_CONTRACTS } from "@/game/world-contract";
import type { WorldId } from "@/game/content";

function KenneyMesh({ url, x, z, s, rot, worldId }: { url: string; x: number; z: number; s: number; rot: number; worldId: WorldId }) {
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
  const y = heightAt(worldId, x, z);
  return <primitive object={scene} position={[x, y, z]} rotation={[0, rot, 0]} scale={s} />;
}

export function KenneyField({
  worldId,
  items,
}: {
  worldId: WorldId;
  items: { kind: string; x: number; z: number; s: number; rot: number }[];
}) {
  const c = WORLD_CONTRACTS[worldId];
  const trees = c.kenneyTrees;
  const rocks = c.kenneyRocks;
  const near = items.filter((it) => Math.hypot(it.x, it.z) < 90).slice(0, 16);
  return (
    <group>
      {near.map((it, i) => {
        const list = it.kind === "tree" || it.kind === "spire" ? trees : rocks;
        const file = list[i % list.length];
        if (!file) return null;
        const url = `/models/kenney/${file}`;
        const s = it.kind === "tree" ? 1.35 * it.s : 0.9 * it.s;
        return <KenneyMesh key={`${it.x}-${it.z}-${i}`} url={url} x={it.x} z={it.z} s={s} rot={it.rot} worldId={worldId} />;
      })}
    </group>
  );
}
