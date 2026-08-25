import { useAnimations, useGLTF } from "@react-three/drei";
import { useFrame } from "@react-three/fiber";
import { Suspense, useMemo, useRef } from "react";
import * as THREE from "three";
import { clone as cloneRig } from "three/examples/jsm/utils/SkeletonUtils.js";
import { combatClock } from "@/game/anim";
import { attackSwing } from "@/game/anim-machine";
import { layerWeights } from "@/game/anim-layers";
import { PLAYER_HUMANOID, certifyPlayerRig } from "@/game/evo-asset";
import type { HumanoidBones } from "@/game/humanoid-cert";
import { airPose, lookIK } from "@/game/ik";
import type { AttackKind } from "@/game/combat";
import type { Gait } from "@/game/locomotion";
import type { Pose } from "@/game/sim";
import { Figure } from "./Figures";

useGLTF.preload(PLAYER_HUMANOID.url);

function makeSword() {
  const g = new THREE.Group();
  g.name = "HeldSword";
  const steel = new THREE.MeshStandardMaterial({ color: "#e8e2d4", metalness: 0.88, roughness: 0.18 });
  const wood = new THREE.MeshStandardMaterial({ color: "#4a3020", roughness: 0.65 });
  const pommel = new THREE.Mesh(new THREE.SphereGeometry(2.6, 8, 6), steel);
  pommel.position.set(0, -8, 0);
  const hilt = new THREE.Mesh(new THREE.CylinderGeometry(2.1, 2.4, 14, 8), wood);
  const guard = new THREE.Mesh(new THREE.BoxGeometry(22, 2.8, 4.5), steel);
  guard.position.set(0, 9, 0);
  const blade = new THREE.Mesh(new THREE.BoxGeometry(3.2, 96, 9), steel);
  blade.position.set(0, 58, 0);
  const tip = new THREE.Mesh(new THREE.ConeGeometry(2.6, 12, 4), steel);
  tip.position.set(0, 110, 0);
  for (const m of [pommel, hilt, guard, blade, tip]) {
    m.castShadow = true;
    g.add(m);
  }
  g.position.set(-3, 9, 2);
  g.rotation.set(0, 0, -Math.PI / 2);
  return g;
}

function setWeight(action: THREE.AnimationAction | null | undefined, weight: number) {
  if (!action) return;
  action.enabled = true;
  action.setEffectiveTimeScale(1);
  action.setEffectiveWeight(Math.max(0, weight));
}

function RiggedSoldier({
  color,
  height,
  lantern,
  armed,
}: {
  color: string;
  height: number;
  lantern?: boolean;
  armed?: boolean;
}) {
  const gltf = useGLTF(PLAYER_HUMANOID.url);
  const group = useRef<THREE.Group>(null);
  const weights = useRef({ idle: 1, walk: 0, run: 0 });
  const bonesRef = useRef<HumanoidBones>({});
  const started = useRef(false);
  const armedOnce = useRef(false);

  const rig = useMemo(() => {
    const cloned = cloneRig(gltf.scene) as THREE.Object3D;
    const ch = cloned.getObjectByName("Character") ?? cloned;
    ch.rotation.set(-Math.PI / 2, 0, 0);
    ch.scale.setScalar(0.01);
    ch.position.set(0, 0, 0);
    cloned.traverse((o) => {
      const mesh = o as THREE.Mesh;
      if (!mesh.isMesh) return;
      mesh.castShadow = true;
      mesh.receiveShadow = true;
      mesh.frustumCulled = false;
      const mats = Array.isArray(mesh.material) ? mesh.material : [mesh.material];
      const tint = new THREE.Color(color);
      const next = mats.map((m) => {
        const c = (m as THREE.MeshStandardMaterial).clone();
        if ("color" in c && c.color) c.color.lerp(tint, 0.16);
        return c;
      });
      mesh.material = Array.isArray(mesh.material) ? next : next[0]!;
    });
    const cert = certifyPlayerRig(cloned);
    bonesRef.current = cert.ok ? cert.bones : {};
    return cloned;
  }, [gltf.scene, color]);

  const { actions } = useAnimations(gltf.animations, rig);

  useFrame((_, dt) => {
    if (!started.current) {
      const idle = actions.Idle ?? actions.idle;
      const walk = actions.Walk ?? actions.walk;
      const run = actions.Run ?? actions.run;
      if (!idle) return;
      idle.reset().play();
      walk?.reset().play();
      run?.reset().play();
      setWeight(idle, 1);
      setWeight(walk, 0);
      setWeight(run, 0);
      started.current = true;
    }

    if (armed && !armedOnce.current) {
      const hand = bonesRef.current.handR;
      if (hand && !hand.getObjectByName("HeldSword")) {
        hand.add(makeSword());
        armedOnce.current = true;
      }
    }

    const g = group.current;
    const parent = g?.parent as THREE.Object3D | null;
    const ud = parent?.userData ?? {};
    const gait = (ud.gait as Gait) || "idle";
    const speed = Number(ud.speed ?? 0);
    const hop = Number(ud.hop ?? 0);
    const clock = combatClock({
      now: Number(ud.now ?? 0),
      attackKind: (ud.attackKind as AttackKind | null) ?? null,
      windupUntil: Number(ud.windupUntil ?? 0),
      activeUntil: Number(ud.activeUntil ?? 0),
      recoverUntil: Number(ud.recoverUntil ?? 0),
    });
    const layers = layerWeights({
      gait,
      speed,
      hop,
      stagger: Boolean(ud.stagger),
      attacking: Boolean(clock),
    });
    const k = 1 - Math.exp(-12 * Math.min(dt, 0.05));
    weights.current.idle += (layers.idle - weights.current.idle) * k;
    weights.current.walk += (layers.walk - weights.current.walk) * k;
    weights.current.run += (layers.run - weights.current.run) * k;
    const locoMul = clock ? 0.85 : 1;
    setWeight(actions.Idle ?? actions.idle, weights.current.idle * locoMul);
    setWeight(actions.Walk ?? actions.walk, weights.current.walk * locoMul);
    setWeight(actions.Run ?? actions.run, weights.current.run * locoMul);
    const runA = actions.Run ?? actions.run;
    const walkA = actions.Walk ?? actions.walk;
    const idleA = actions.Idle ?? actions.idle;
    const freeze = Number(ud.hitstop ?? 0) > 0 ? 0.12 : 1;
    if (runA) runA.timeScale = freeze * THREE.MathUtils.clamp(speed / 6.2, 0.9, 1.35);
    if (walkA) walkA.timeScale = freeze * THREE.MathUtils.clamp(speed / 3.2, 0.85, 1.3);
    if (idleA) idleA.timeScale = freeze;

    const bones = bonesRef.current;
    if (armed && !clock) {
      bones.armR?.rotateX(-0.65);
      bones.armR?.rotateZ(0.4);
      bones.foreR?.rotateX(-0.35);
    }
    if (clock) {
      const swing = attackSwing(clock.name, clock.u, clock.kind);
      bones.armR?.rotateX(swing.x);
      bones.armR?.rotateY(swing.y);
      bones.armR?.rotateZ(swing.z);
      bones.foreR?.rotateX(Math.max(0, swing.x) * 0.35);
      bones.spine1?.rotateY(swing.y * 0.55);
    }
    if (layers.hit) {
      bones.spine1?.rotateX(-0.28);
    }
    lookIK(bones, Number(ud.lookYaw ?? 0));
    airPose(bones, hop);
  });

  return (
    <group ref={group} scale={height / 1.72}>
      <primitive object={rig} />
      {lantern ? (
        <pointLight color="#ffd890" intensity={1.4} distance={6} position={[0.2, 1.2, 0.2]} />
      ) : null}
    </group>
  );
}

export function ActorMesh({
  color,
  accent,
  height,
  pose,
  lantern,
  live = false,
  outfit = "robe",
}: {
  color: string;
  accent: string;
  height: number;
  pose: Pose;
  lantern?: boolean;
  live?: boolean;
  outfit?: "street" | "robe";
}) {
  return (
    <Suspense
      fallback={
        <Figure
          color={color}
          accent={accent}
          height={height}
          pose={pose}
          lantern={lantern}
          live={live}
          outfit={outfit}
        />
      }
    >
      <RiggedSoldier color={color} height={height} lantern={lantern} armed={outfit === "street"} />
    </Suspense>
  );
}
