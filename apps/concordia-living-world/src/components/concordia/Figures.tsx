import { useFrame } from "@react-three/fiber";
import { useMemo, useRef } from "react";
import * as THREE from "three";
import { ToonMesh } from "./Toon";
import type { Pose } from "@/game/sim";

export type { Pose };

export function Figure({
  color,
  accent,
  height,
  pose,
  lantern,
}: {
  color: string;
  accent: string;
  height: number;
  pose: Pose;
  lantern?: boolean;
}) {
  const root = useRef<THREE.Group>(null);
  const armR = useRef<THREE.Group>(null);
  const armL = useRef<THREE.Group>(null);
  const legR = useRef<THREE.Mesh>(null);
  const legL = useRef<THREE.Mesh>(null);
  const clock = useRef(0);
  const s = height / 1.75;
  const hair = useMemo(() => new THREE.Color(accent).multiplyScalar(0.45).getStyle(), [accent]);

  useFrame((_, dt) => {
    clock.current += dt;
    const t = clock.current;
    const g = root.current;
    if (!g) return;
    const squash = pose === "hurt" ? 0.88 : pose === "dodge" ? 0.92 : pose === "down" ? 0.42 : 1;
    g.scale.set(s, s * squash, s);
    const walk = pose === "walk" ? Math.sin(t * 9) : 0;
    const arm =
      pose === "windup" ? -1.15 : pose === "strike" ? 1.4 : pose === "walk" ? walk * 0.75 : Math.sin(t * 2) * 0.12;
    const lean = pose === "dodge" ? 0.42 : pose === "hurt" ? -0.28 : pose === "down" ? 1.15 : 0;
    g.rotation.x = lean;
    if (armR.current) armR.current.rotation.x = arm;
    if (armL.current) armL.current.rotation.x = -arm * 0.85;
    if (legR.current) legR.current.position.z = walk * 0.1;
    if (legL.current) legL.current.position.z = -walk * 0.1;
  });

  return (
    <group ref={root} scale={[s, s, s]}>
      <mesh rotation={[-Math.PI / 2, 0, 0]} position={[0, 0.02, 0]} renderOrder={-1}>
        <circleGeometry args={[0.42, 12]} />
        <meshBasicMaterial color="#1a140c" transparent opacity={0.28} depthWrite={false} />
      </mesh>
      <ToonMesh color={accent} position={[0, 0.98, 0.02]}>
        <capsuleGeometry args={[0.3, 0.62, 4, 8]} />
      </ToonMesh>
      <ToonMesh color={color} position={[0, 1.64, 0]} scale={[0.74, 0.74, 0.74]}>
        <sphereGeometry args={[0.5, 12, 10]} />
      </ToonMesh>
      <ToonMesh color={hair} outline={false} position={[0, 1.82, -0.04]} scale={[0.7, 0.38, 0.68]}>
        <sphereGeometry args={[0.5, 10, 8]} />
      </ToonMesh>
      <mesh position={[0.11, 1.67, 0.3]}>
        <sphereGeometry args={[0.045, 6, 6]} />
        <meshBasicMaterial color={accent} />
      </mesh>
      <mesh position={[-0.11, 1.67, 0.3]}>
        <sphereGeometry args={[0.045, 6, 6]} />
        <meshBasicMaterial color={accent} />
      </mesh>
      <group ref={armR} position={[0.4, 1.18, 0]} rotation={[0, 0, 0.18]}>
        <ToonMesh color={color} position={[0, -0.28, 0]} scale={[0.15, 0.68, 0.15]}>
          <capsuleGeometry args={[0.5, 1, 3, 6]} />
        </ToonMesh>
      </group>
      <group ref={armL} position={[-0.4, 1.18, 0]} rotation={[0, 0, -0.18]}>
        <ToonMesh color={color} position={[0, -0.28, 0]} scale={[0.15, 0.68, 0.15]}>
          <capsuleGeometry args={[0.5, 1, 3, 6]} />
        </ToonMesh>
      </group>
      <mesh ref={legR} position={[0.16, 0.38, 0]} scale={[0.18, 0.7, 0.18]}>
        <capsuleGeometry args={[0.5, 1, 3, 6]} />
        <meshToonMaterial color={color} />
      </mesh>
      <mesh ref={legL} position={[-0.16, 0.38, 0]} scale={[0.18, 0.7, 0.18]}>
        <capsuleGeometry args={[0.5, 1, 3, 6]} />
        <meshToonMaterial color={color} />
      </mesh>
      {lantern ? (
        <group position={[0.52, 0.72, 0.18]}>
          <ToonMesh color="#c8a050" outline={false} scale={[0.26, 0.36, 0.26]}>
            <boxGeometry args={[1, 1, 1]} />
          </ToonMesh>
          <pointLight color="#ffd890" intensity={1.8} distance={7} />
        </group>
      ) : null}
    </group>
  );
}
