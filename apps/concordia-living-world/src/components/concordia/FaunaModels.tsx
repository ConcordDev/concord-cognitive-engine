import { useGLTF } from "@react-three/drei";
import { useFrame } from "@react-three/fiber";
import { Suspense, useEffect, useMemo, useRef } from "react";
import * as THREE from "three";
import { clone as cloneRig } from "three/examples/jsm/utils/SkeletonUtils.js";
import { faunaForKind } from "@/game/evo-asset";
import type { EvoTraits } from "@/game/evo";
import type { Pose } from "@/game/sim";
import type { BeastKind } from "@/game/worlds";

function FaunaRig({
  url,
  scale,
  y,
  color,
  pose,
}: {
  url: string;
  scale: number;
  y: number;
  color: string;
  pose: Pose;
}) {
  const gltf = useGLTF(url);
  const root = useRef<THREE.Group>(null);
  const current = useRef("");
  const rig = useMemo(() => {
    const cloned = cloneRig(gltf.scene) as THREE.Object3D;
    const tint = new THREE.Color(color);
    cloned.traverse((o) => {
      const m = o as THREE.Mesh;
      if (!m.isMesh) return;
      m.castShadow = true;
      m.receiveShadow = true;
      const mats = Array.isArray(m.material) ? m.material : [m.material];
      const next = mats.map((mat) => {
        const c = (mat as THREE.MeshStandardMaterial).clone();
        if ("color" in c && c.color) c.color.lerp(tint, 0.45);
        return c;
      });
      m.material = Array.isArray(m.material) ? next : next[0]!;
    });
    return cloned;
  }, [gltf.scene, color]);

  const mixer = useMemo(() => new THREE.AnimationMixer(rig), [rig]);
  const clips = gltf.animations ?? [];
  const actions = useMemo(() => {
    const map: Record<string, THREE.AnimationAction> = {};
    for (const clip of clips) map[clip.name] = mixer.clipAction(clip);
    return map;
  }, [clips, mixer]);

  useEffect(() => {
    const first = Object.values(actions)[0];
    first?.reset().play();
    current.current = first?.getClip().name ?? "";
    return () => {
      mixer.stopAllAction();
    };
  }, [actions, mixer]);

  useFrame((_, dt) => {
    const wantWalk = pose === "walk" || pose === "strike";
    let pick = Object.keys(actions)[0] ?? "";
    for (const n of Object.keys(actions)) {
      const l = n.toLowerCase();
      if (wantWalk && (l.includes("walk") || l.includes("run") || l.includes("fly"))) pick = n;
      if (!wantWalk && (l.includes("idle") || l.includes("survey"))) pick = n;
    }
    if (pick && pick !== current.current && actions[pick]) {
      actions[pick]!.reset().fadeIn(0.15).play();
      if (current.current) actions[current.current]?.fadeOut(0.15);
      current.current = pick;
    }
    mixer.update(Math.min(dt, 0.05));
  });

  return (
    <group ref={root} scale={scale} position={[0, y, 0]}>
      <primitive object={rig} />
    </group>
  );
}

export function FaunaBeast({
  kind,
  pose,
  color,
  scale,
  traits,
}: {
  kind: BeastKind;
  pose: Pose;
  color: string;
  scale?: number;
  traits?: EvoTraits;
}) {
  const asset = faunaForKind(kind, { scale: scale ?? 1, fly: !!traits?.wings, traits });
  return (
    <Suspense fallback={null}>
      <FaunaRig url={asset.url} scale={asset.scale} y={asset.y} color={color} pose={pose} />
    </Suspense>
  );
}
