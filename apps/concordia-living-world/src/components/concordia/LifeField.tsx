import { useFrame } from "@react-three/fiber";
import { useMemo, useRef, type MutableRefObject } from "react";
import * as THREE from "three";
import type { Theme } from "@/game/content";
import { farHills, gatherFlora, heightAt, type FloraKind } from "@/game/life";
import { PLAZA_RADIUS } from "@/game/realms";
import { settlementsOf } from "@/game/realms";
import type { WorldId } from "@/game/worlds";
import type { Sim } from "@/game/sim";
import { ToonMesh } from "./Toon";

const _m = new THREE.Matrix4();
const _q = new THREE.Quaternion();
const _s = new THREE.Vector3();
const _p = new THREE.Vector3();
const _e = new THREE.Euler();

function paint(
  mesh: THREE.InstancedMesh | null,
  items: { x: number; z: number; s: number; rot: number }[],
  worldId: WorldId,
  yMul: number,
  yOff: number,
) {
  if (!mesh) return;
  const n = Math.min(items.length, mesh.count);
  for (let i = 0; i < n; i++) {
    const it = items[i]!;
    const y = heightAt(worldId, it.x, it.z) * yMul + yOff;
    _p.set(it.x, y, it.z);
    _e.set(0, it.rot, 0);
    _q.setFromEuler(_e);
    _s.set(it.s, it.s, it.s);
    _m.compose(_p, _q, _s);
    mesh.setMatrixAt(i, _m);
  }
  mesh.count = n;
  mesh.instanceMatrix.needsUpdate = true;
}

export function LifeField({
  worldId,
  theme,
  simRef,
}: {
  worldId: WorldId;
  theme: Theme;
  simRef: MutableRefObject<Sim>;
}) {
  const trees = useRef<THREE.InstancedMesh>(null);
  const rocks = useRef<THREE.InstancedMesh>(null);
  const grass = useRef<THREE.InstancedMesh>(null);
  const chunk = useRef("x");
  const hills = useMemo(() => farHills(worldId), [worldId]);
  const towns = useMemo(() => settlementsOf(worldId), [worldId]);

  useFrame(() => {
    const p = simRef.current.player;
    const key = `${Math.floor(p.x / 40)}:${Math.floor(p.z / 40)}`;
    if (key === chunk.current) return;
    chunk.current = key;
    const flora = gatherFlora(worldId, p.x, p.z);
    const by: Record<FloraKind, typeof flora> = { tree: [], rock: [], grass: [], spire: [], bone: [] };
    for (const f of flora) by[f.kind].push(f);
    const treeish = [...by.tree, ...by.spire];
    const rocky = [...by.rock, ...by.bone];
    paint(trees.current, treeish, worldId, 1, 0);
    paint(rocks.current, rocky, worldId, 1, 0.2);
    paint(grass.current, by.grass, worldId, 1, 0.05);
  });

  return (
    <group>
      <instancedMesh ref={trees} args={[undefined, undefined, 720]} castShadow>
        <coneGeometry args={[1.1, 3.4, 6]} />
        <meshToonMaterial color={worldId === "cyber" ? theme.lamp : "#3d5a32"} />
      </instancedMesh>
      <instancedMesh ref={rocks} args={[undefined, undefined, 480]} castShadow>
        <dodecahedronGeometry args={[0.7, 0]} />
        <meshToonMaterial color={theme.building2} />
      </instancedMesh>
      <instancedMesh ref={grass} args={[undefined, undefined, 640]}>
        <coneGeometry args={[0.18, 0.7, 4]} />
        <meshToonMaterial color="#6a8a44" />
      </instancedMesh>

      {hills.map((h, i) => (
        <mesh key={`h${i}`} position={[h.x, heightAt(worldId, h.x, h.z) + h.s * 0.45, h.z]} scale={[h.s, h.s * 0.55, h.s]}>
          <cylinderGeometry args={[0.55, 0.85, 1, 6]} />
          <meshToonMaterial color={theme.building} />
        </mesh>
      ))}

      {towns.map((t) => (
        <group key={t.id} position={[t.x, heightAt(worldId, t.x, t.z), t.z]}>
          <ToonMesh color={theme.building2} position={[0, 2.4, 0]} scale={[3.2, 4.8, 3.2]}>
            <boxGeometry args={[1, 1, 1]} />
          </ToonMesh>
          <ToonMesh color={theme.building} position={[4.2, 1.6, 1.2]} scale={[2.4, 3.2, 2.2]}>
            <boxGeometry args={[1, 1, 1]} />
          </ToonMesh>
          <ToonMesh color={theme.building} position={[-3.6, 1.3, -1.4]} scale={[2.1, 2.6, 2.4]}>
            <boxGeometry args={[1, 1, 1]} />
          </ToonMesh>
          <mesh position={[0, 5.2, 0]}>
            <sphereGeometry args={[0.35, 8, 6]} />
            <meshBasicMaterial color={theme.lamp} />
          </mesh>
          <mesh rotation={[-Math.PI / 2, 0, 0]} position={[0, 0.04, 0]}>
            <circleGeometry args={[14, 20]} />
            <meshBasicMaterial color={theme.ground} />
          </mesh>
        </group>
      ))}

      <mesh rotation={[-Math.PI / 2, 0, 0]} position={[0, -0.02, 0]} receiveShadow>
        <ringGeometry args={[PLAZA_RADIUS - 0.5, 80, 48]} />
        <meshToonMaterial color={theme.ground} />
      </mesh>
    </group>
  );
}
