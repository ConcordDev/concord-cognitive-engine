import { useFrame } from "@react-three/fiber";
import { useMemo, useRef, type MutableRefObject, Suspense } from "react";
import * as THREE from "three";
import type { Theme } from "@/game/content";
import { farHills, gatherFlora, heightAt, type FloraKind } from "@/game/life";
import { PLAZA_RADIUS } from "@/game/realms";
import { settlementsOf } from "@/game/realms";
import type { WorldId } from "@/game/worlds";
import type { Sim } from "@/game/sim";
import { LitMesh } from "./Lit";
import { KenneyField } from "./KenneyField";

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
  const nearFlora = useMemo(() => gatherFlora(worldId, 0, 0, 70).slice(0, 16), [worldId]);
  const hills = useMemo(() => farHills(worldId), [worldId]);
  const towns = useMemo(() => settlementsOf(worldId), [worldId]);

  useFrame(() => {
    const p = simRef.current.player;
    const key = `${Math.floor(p.x / 40)}:${Math.floor(p.z / 40)}`;
    if (key === chunk.current) return;
    chunk.current = key;
    const flora = gatherFlora(worldId, p.x, p.z, 110);
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
      {worldId !== "concordia-hub" ? (
        <Suspense fallback={null}>
          <KenneyField worldId={worldId} items={nearFlora} />
        </Suspense>
      ) : null}
      <instancedMesh ref={trees} args={[undefined, undefined, 280]} castShadow key={`${worldId}-trees`}>
        {worldId === "sovereign-ruins" ? <cylinderGeometry args={[0.16, 0.28, 3.1, 6]} /> : <coneGeometry args={[1.1, 3.4, 6]} />}
        <meshPhysicalMaterial
          color={worldId === "cyber" ? theme.lamp : worldId === "sovereign-ruins" ? "#5a4630" : "#3d5a32"}
          roughness={0.88}
          metalness={0.02}
          sheen={worldId === "sovereign-ruins" ? 0 : 0.18}
          sheenColor="#6a8a40"
          envMapIntensity={0.4}
        />
      </instancedMesh>
      <instancedMesh ref={rocks} args={[undefined, undefined, 160]} castShadow>
        <dodecahedronGeometry args={[0.7, 0]} />
        <meshPhysicalMaterial color={theme.building2} roughness={0.92} metalness={0.04} clearcoat={0.08} clearcoatRoughness={0.7} envMapIntensity={0.5} />
      </instancedMesh>
      <instancedMesh ref={grass} args={[undefined, undefined, 180]}>
        <coneGeometry args={[0.18, 0.7, 4]} />
        <meshPhysicalMaterial
          color={worldId === "sovereign-ruins" ? "#8a7a50" : "#6a8a44"}
          roughness={0.94}
          sheen={0.15}
          sheenColor="#6a8a44"
          envMapIntensity={0.35}
        />
      </instancedMesh>

      {hills.map((h, i) => (
        <mesh key={`h${i}`} position={[h.x, heightAt(worldId, h.x, h.z) + h.s * 0.45, h.z]} scale={[h.s, h.s * 0.55, h.s]}>
          <cylinderGeometry args={[0.55, 0.85, 1, 6]} />
          <meshPhysicalMaterial color={theme.building} roughness={0.9} metalness={0.04} envMapIntensity={0.45} />
        </mesh>
      ))}

      {towns.map((t) => {
        const gy = heightAt(worldId, t.x, t.z);
        const keep = t.kind === "keep";
        const camp = t.kind === "camp";
        return (
          <group key={t.id} position={[t.x, gy, t.z]}>
            {worldId === "sovereign-ruins" ? (
              <>
                <LitMesh color={theme.building2} surface="stone" position={[0, 2.4, 0]} scale={[3.4, 4.8, 3.2]}>
                  <boxGeometry args={[1, 1, 1]} />
                </LitMesh>
                <LitMesh color={theme.building} surface="stone" position={[1.4, 4.9, -0.4]} rotation={[0, 0.2, 0.35]} scale={[2.2, 0.45, 1.8]}>
                  <boxGeometry args={[1, 1, 1]} />
                </LitMesh>
                <LitMesh color={theme.building} surface="stone" position={[3.6, 1.1, 0.8]} rotation={[0, 0.3, 0.15]} scale={[2.2, 2.2, 1.6]}>
                  <boxGeometry args={[1, 1, 1]} />
                </LitMesh>
                <LitMesh color={theme.building2} surface="stone" position={[-2.8, 0.9, -1.2]} rotation={[0.1, -0.4, 0]} scale={[1.8, 1.8, 2.0]}>
                  <boxGeometry args={[1, 1, 1]} />
                </LitMesh>
                <LitMesh color={theme.building} surface="stone" position={[-1.6, 0.35, 1.8]} rotation={[0.3, 0.5, 0.1]} scale={[1.1, 0.5, 0.8]}>
                  <boxGeometry args={[1, 1, 1]} />
                </LitMesh>
                <LitMesh color={theme.building} surface="stone" position={[2.2, 0.55, -1.6]}>
                  <cylinderGeometry args={[0.22, 0.28, 1.1, 8]} />
                </LitMesh>
              </>
            ) : (
              <>
                <LitMesh color={theme.building2} surface="stone" position={[0, keep ? 3.1 : 2.2, 0]} scale={keep ? [3.6, 6.2, 3.6] : camp ? [2.2, 2.4, 2.4] : [3.2, 4.4, 3.2]}>
                  <boxGeometry args={[1, 1, 1]} />
                </LitMesh>
                <LitMesh color={theme.building} surface="stone" position={[4.2, 1.6, 1.2]} scale={[2.4, 3.2, 2.2]}>
                  <boxGeometry args={[1, 1, 1]} />
                </LitMesh>
                <LitMesh color={theme.building} surface="stone" position={[-3.6, 1.3, -1.4]} scale={[2.1, 2.6, 2.4]}>
                  <boxGeometry args={[1, 1, 1]} />
                </LitMesh>
                {keep ? (
                  <LitMesh color={theme.building2} surface="stone" position={[0, 6.4, 0]} scale={[4.2, 0.45, 4.2]}>
                    <boxGeometry args={[1, 1, 1]} />
                  </LitMesh>
                ) : null}
              </>
            )}
            {camp ? (
              <>
                <LitMesh color="#6a4a28" position={[2.4, 1.1, -2.2]} scale={[1.8, 2.2, 1.8]}>
                  <coneGeometry args={[0.7, 1, 4]} />
                </LitMesh>
                <mesh position={[-1.8, 0.7, 2]}>
                  <coneGeometry args={[0.28, 0.7, 6]} />
                  <meshBasicMaterial color={theme.lamp} />
                </mesh>
                <pointLight color={theme.lamp} intensity={0.8} distance={10} position={[-1.8, 1.2, 2]} />
              </>
            ) : null}
            <mesh position={[0, keep ? 6.9 : 5.0, 0]}>
              <sphereGeometry args={[0.35, 8, 6]} />
              <meshBasicMaterial color={theme.lamp} />
            </mesh>
            <mesh rotation={[-Math.PI / 2, 0, 0]} position={[0, 0.04, 0]} receiveShadow>
              <circleGeometry args={[14, 20]} />
              <meshPhysicalMaterial color={theme.ground} roughness={0.92} metalness={0.03} envMapIntensity={0.4} />
            </mesh>
            <LitMesh color="#7a6a58" surface="stone" position={[0, 0.06, 0]} rotation={[-Math.PI / 2, 0, 0]} scale={[8, 18, 1]}>
              <planeGeometry args={[1, 1]} />
            </LitMesh>
          </group>
        );
      })}

      <mesh rotation={[-Math.PI / 2, 0, 0]} position={[0, -0.02, 0]} receiveShadow>
        <ringGeometry args={[PLAZA_RADIUS - 0.5, 80, 48]} />
        <meshPhysicalMaterial color={theme.ground} roughness={0.92} metalness={0.03} envMapIntensity={0.4} />
      </mesh>
    </group>
  );
}
