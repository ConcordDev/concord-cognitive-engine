import { useFrame } from "@react-three/fiber";
import { useRef, type RefObject } from "react";
import * as THREE from "three";
import { LitMesh } from "./Lit";
import type { BeastKind } from "@/game/worlds";
import { beastDef } from "@/game/creatures";
import type { Pose } from "@/game/sim";
import type { EvoTraits } from "@/game/evo";
import { FaunaBeast } from "./FaunaModels";

function Wings({
  wingL,
  wingR,
  accent,
  span = 1.8,
}: {
  wingL: RefObject<THREE.Group | null>;
  wingR: RefObject<THREE.Group | null>;
  accent: string;
  span?: number;
}) {
  return (
    <>
      <group ref={wingL} position={[-0.35, 1.15, 0]}>
        <LitMesh color={accent} position={[-span * 0.5, 0.08, 0]} rotation={[0.2, 0, 0.25]} scale={[span, 0.07, span * 0.5]}>
          <boxGeometry args={[1, 1, 1]} />
        </LitMesh>
      </group>
      <group ref={wingR} position={[0.35, 1.15, 0]}>
        <LitMesh color={accent} position={[span * 0.5, 0.08, 0]} rotation={[0.2, 0, -0.25]} scale={[span, 0.07, span * 0.5]}>
          <boxGeometry args={[1, 1, 1]} />
        </LitMesh>
      </group>
    </>
  );
}

function TraitBits({ traits, accent }: { traits?: EvoTraits; accent: string }) {
  if (!traits) return null;
  return (
    <group>
      {traits.horns ? (
        <>
          <LitMesh color={accent} position={[-0.16, 1.85, 0.35]} rotation={[0.35, 0, -0.3]} scale={[0.08, 0.4, 0.08]}>
            <coneGeometry args={[0.5, 1, 5]} />
          </LitMesh>
          <LitMesh color={accent} position={[0.16, 1.85, 0.35]} rotation={[0.35, 0, 0.3]} scale={[0.08, 0.4, 0.08]}>
            <coneGeometry args={[0.5, 1, 5]} />
          </LitMesh>
        </>
      ) : null}
      {traits.glow ? (
        <mesh position={[0, 1.1, 0.4]}>
          <sphereGeometry args={[0.16, 8, 6]} />
          <meshBasicMaterial color={accent} transparent opacity={0.75} />
        </mesh>
      ) : null}
      {traits.plates ? (
        <LitMesh color={accent} position={[0, 0.95, 0.15]} scale={[0.7, 0.12, 0.55]}>
          <boxGeometry args={[1, 1, 1]} />
        </LitMesh>
      ) : null}
    </group>
  );
}

const FAUNA_KINDS = new Set<BeastKind>([
  "wolf",
  "hound",
  "griffin",
  "harpy",
  "dragon",
  "wyrm",
  "drone",
  "golem",
  "construct",
  "wraith",
  "sentinel",
]);

export function BeastMesh({
  kind,
  pose,
  color,
  accent,
  scale,
  traits,
  flyH,
}: {
  kind: BeastKind;
  pose: Pose;
  flyH?: number;
  color?: string;
  accent?: string;
  scale?: number;
  traits?: EvoTraits;
}) {
  const base = beastDef(kind);
  if (FAUNA_KINDS.has(kind)) {
    return (
      <FaunaBeast
        kind={kind}
        pose={pose}
        color={color ?? base.color}
        scale={scale ?? base.scale}
        traits={traits}
      />
    );
  }
  return (
    <ProcBeast kind={kind} pose={pose} color={color} accent={accent} scale={scale} traits={traits} flyH={flyH} />
  );
}

function ProcBeast({
  kind,
  pose,
  color,
  accent,
  scale,
  traits,
}: {
  kind: BeastKind;
  pose: Pose;
  flyH?: number;
  color?: string;
  accent?: string;
  scale?: number;
  traits?: EvoTraits;
}) {
  const root = useRef<THREE.Group>(null);
  const wingL = useRef<THREE.Group>(null);
  const wingR = useRef<THREE.Group>(null);
  const tRef = useRef(0);
  const base = beastDef(kind);
  const def = {
    ...base,
    color: color ?? base.color,
    accent: accent ?? base.accent,
    scale: scale ?? base.scale,
  };

  useFrame((_, dt) => {
    tRef.current += dt;
    const t = tRef.current;
    const g = root.current;
    if (!g) return;
    const squash = pose === "hurt" ? 0.88 : pose === "down" ? 0.38 : pose === "strike" ? 1.06 : 1;
    g.scale.set(def.scale, def.scale * squash, def.scale);
    const flap = def.flyHeight > 0 || traits?.wings ? Math.sin(t * (kind === "drone" ? 10 : 6)) * 0.48 : 0;
    if (wingL.current) wingL.current.rotation.z = 0.35 + flap + (pose === "strike" ? 0.4 : 0);
    if (wingR.current) wingR.current.rotation.z = -0.35 - flap - (pose === "strike" ? 0.4 : 0);
    if (kind === "serpent" || kind === "basilisk") {
      g.rotation.z = Math.sin(t * 3) * 0.08;
    }
    if (pose === "walk") {
      g.rotation.x = Math.sin(t * 7) * 0.06;
      g.position.y = Math.abs(Math.sin(t * 7)) * 0.04;
    } else if (pose === "strike") {
      g.rotation.x = 0.22;
    } else if (pose === "hurt") {
      g.rotation.x = -0.18;
    } else if (pose === "down") {
      g.rotation.x = 1.05;
    } else {
      g.rotation.x = THREE.MathUtils.damp(g.rotation.x, 0, 8, dt);
      g.position.y = THREE.MathUtils.damp(g.position.y, 0, 8, dt);
    }
  });

  const extras = (
    <>
      {traits?.wings ? <Wings wingL={wingL} wingR={wingR} accent={def.accent} span={1.45} /> : null}
      <TraitBits traits={traits} accent={def.accent} />
    </>
  );

  if (kind === "dragon" || kind === "wyrm") {
    const long = kind === "wyrm";
    return (
      <group ref={root} scale={def.scale}>
        <LitMesh color={def.color} position={[0, 1.05, 0.05]} scale={long ? [0.7, 0.55, 1.9] : [0.95, 0.72, 1.7]}>
          <capsuleGeometry args={[0.5, 1, 4, 8]} />
        </LitMesh>
        <LitMesh color={def.color} position={[0, 1.42, 1.15]} scale={[0.58, 0.5, 0.72]}>
          <sphereGeometry args={[0.5, 8, 6]} />
        </LitMesh>
        <LitMesh color={def.accent} position={[-0.18, 1.72, 1.05]} rotation={[0.2, 0, -0.4]} scale={[0.08, 0.35, 0.08]}>
          <coneGeometry args={[0.5, 1, 5]} />
        </LitMesh>
        <LitMesh color={def.accent} position={[0.18, 1.72, 1.05]} rotation={[0.2, 0, 0.4]} scale={[0.08, 0.35, 0.08]}>
          <coneGeometry args={[0.5, 1, 5]} />
        </LitMesh>
        <LitMesh color={def.color} position={[0, 0.95, -1.25]} rotation={[0.45, 0, 0]} scale={[0.2, 0.2, 1.5]}>
          <capsuleGeometry args={[0.5, 1, 3, 6]} />
        </LitMesh>
        <LitMesh color={def.color} position={[-0.45, 0.35, 0.45]} scale={[0.22, 0.7, 0.22]}>
          <cylinderGeometry args={[0.4, 0.5, 1, 6]} />
        </LitMesh>
        <LitMesh color={def.color} position={[0.45, 0.35, 0.45]} scale={[0.22, 0.7, 0.22]}>
          <cylinderGeometry args={[0.4, 0.5, 1, 6]} />
        </LitMesh>
        <Wings wingL={wingL} wingR={wingR} accent={def.accent} span={kind === "wyrm" ? 1.5 : 1.95} />
        <mesh position={[0.18, 1.48, 1.4]}>
          <sphereGeometry args={[0.07, 6, 6]} />
          <meshBasicMaterial color={def.accent} />
        </mesh>
        {extras}
      </group>
    );
  }

  if (kind === "griffin") {
    return (
      <group ref={root} scale={def.scale}>
        <LitMesh color={def.color} position={[0, 0.95, 0]} scale={[0.75, 0.55, 1.35]}>
          <capsuleGeometry args={[0.5, 1, 4, 8]} />
        </LitMesh>
        <LitMesh color={def.accent} position={[0, 1.35, 0.85]} scale={[0.42, 0.42, 0.5]}>
          <sphereGeometry args={[0.5, 8, 6]} />
        </LitMesh>
        <LitMesh color={def.accent} position={[0, 1.55, 0.7]} scale={[0.08, 0.28, 0.08]}>
          <coneGeometry args={[0.5, 1, 4]} />
        </LitMesh>
        <LitMesh color={def.color} position={[0, 0.85, -0.85]} rotation={[0.5, 0, 0]} scale={[0.16, 0.16, 0.7]}>
          <capsuleGeometry args={[0.5, 1, 3, 6]} />
        </LitMesh>
        <Wings wingL={wingL} wingR={wingR} accent={def.accent} span={1.7} />
        {extras}
      </group>
    );
  }

  if (kind === "harpy") {
    return (
      <group ref={root} scale={def.scale}>
        <LitMesh color={def.color} position={[0, 0.85, 0]} scale={[0.45, 0.9, 0.35]}>
          <capsuleGeometry args={[0.5, 1, 4, 8]} />
        </LitMesh>
        <LitMesh color={def.accent} position={[0, 1.5, 0]} scale={[0.38, 0.38, 0.38]}>
          <sphereGeometry args={[0.5, 8, 6]} />
        </LitMesh>
        <Wings wingL={wingL} wingR={wingR} accent={def.accent} span={1.35} />
        {extras}
      </group>
    );
  }

  if (kind === "drone" || kind === "drift" || kind === "sentinel") {
    const tall = kind === "sentinel";
    return (
      <group ref={root} scale={def.scale}>
        <LitMesh color={def.color} position={[0, tall ? 0.9 : 0.4, 0]} scale={tall ? [0.55, 1.5, 0.55] : [0.9, 0.28, 0.9]}>
          {tall ? <cylinderGeometry args={[0.45, 0.55, 1, 6]} /> : <octahedronGeometry args={[0.5, 0]} />}
        </LitMesh>
        <mesh position={[0, tall ? 1.5 : 0.4, 0]} rotation={[tall ? Math.PI / 2 : 0, 0, 0]}>
          <ringGeometry args={[0.5, 0.68, 16]} />
          <meshBasicMaterial color={def.accent} side={THREE.DoubleSide} />
        </mesh>
        {tall ? (
          <mesh position={[0, 1.1, 0.35]}>
            <sphereGeometry args={[0.12, 8, 6]} />
            <meshBasicMaterial color={def.accent} />
          </mesh>
        ) : null}
        {extras}
      </group>
    );
  }

  if (kind === "wolf" || kind === "hound" || kind === "sealie") {
    const long = kind === "sealie";
    return (
      <group ref={root} scale={def.scale}>
        <LitMesh color={def.color} position={[0, 0.55, 0.1]} scale={long ? [0.55, 0.42, 1.5] : [0.5, 0.42, 1.15]}>
          <capsuleGeometry args={[0.5, 1, 3, 8]} />
        </LitMesh>
        <LitMesh color={def.color} position={[0, 0.72, 0.7]} scale={[0.38, 0.38, 0.42]}>
          <sphereGeometry args={[0.5, 8, 6]} />
        </LitMesh>
        <LitMesh color={def.accent} position={[0, 0.62, -0.7]} rotation={[0.5, 0, 0]} scale={[0.16, 0.16, 0.7]}>
          <capsuleGeometry args={[0.5, 1, 3, 6]} />
        </LitMesh>
        <LitMesh color={def.color} position={[-0.18, 0.22, 0.35]} scale={[0.12, 0.4, 0.12]}>
          <cylinderGeometry args={[0.5, 0.5, 1, 5]} />
        </LitMesh>
        <LitMesh color={def.color} position={[0.18, 0.22, 0.35]} scale={[0.12, 0.4, 0.12]}>
          <cylinderGeometry args={[0.5, 0.5, 1, 5]} />
        </LitMesh>
        {extras}
      </group>
    );
  }

  if (kind === "serpent" || kind === "basilisk") {
    const thick = kind === "basilisk";
    return (
      <group ref={root} scale={def.scale}>
        <LitMesh color={def.color} position={[0, 0.35, 0.2]} scale={thick ? [0.7, 0.5, 2.1] : [0.38, 0.32, 2.2]}>
          <capsuleGeometry args={[0.5, 1, 3, 8]} />
        </LitMesh>
        <LitMesh color={def.color} position={[0, 0.55, 1.15]} scale={thick ? [0.5, 0.48, 0.55] : [0.32, 0.32, 0.38]}>
          <sphereGeometry args={[0.5, 8, 6]} />
        </LitMesh>
        <mesh position={[0.12, 0.62, 1.35]}>
          <sphereGeometry args={[0.06, 6, 6]} />
          <meshBasicMaterial color={def.accent} />
        </mesh>
        {thick ? (
          <LitMesh color={def.accent} position={[0, 0.85, 1.0]} scale={[0.12, 0.28, 0.12]}>
            <coneGeometry args={[0.5, 1, 5]} />
          </LitMesh>
        ) : null}
        {extras}
      </group>
    );
  }

  if (kind === "spider") {
    return (
      <group ref={root} scale={def.scale}>
        <LitMesh color={def.color} position={[0, 0.42, 0]} scale={[0.85, 0.45, 0.7]}>
          <sphereGeometry args={[0.5, 8, 6]} />
        </LitMesh>
        <LitMesh color={def.color} position={[0, 0.38, 0.45]} scale={[0.4, 0.32, 0.4]}>
          <sphereGeometry args={[0.5, 8, 6]} />
        </LitMesh>
        <LitMesh color={def.accent} position={[-0.55, 0.22, 0.2]} rotation={[0, 0, 0.7]} scale={[0.08, 0.7, 0.08]}>
          <boxGeometry args={[1, 1, 1]} />
        </LitMesh>
        <LitMesh color={def.accent} position={[0.55, 0.22, 0.2]} rotation={[0, 0, -0.7]} scale={[0.08, 0.7, 0.08]}>
          <boxGeometry args={[1, 1, 1]} />
        </LitMesh>
        <LitMesh color={def.accent} position={[-0.5, 0.18, -0.2]} rotation={[0, 0, 0.85]} scale={[0.08, 0.65, 0.08]}>
          <boxGeometry args={[1, 1, 1]} />
        </LitMesh>
        <LitMesh color={def.accent} position={[0.5, 0.18, -0.2]} rotation={[0, 0, -0.85]} scale={[0.08, 0.65, 0.08]}>
          <boxGeometry args={[1, 1, 1]} />
        </LitMesh>
        {extras}
      </group>
    );
  }

  if (kind === "construct" || kind === "golem") {
    const bulk = kind === "golem";
    return (
      <group ref={root} scale={def.scale}>
        <LitMesh color={def.color} position={[0, bulk ? 1.2 : 1.1, 0]} scale={bulk ? [0.95, 1.6, 0.6] : [0.7, 1.4, 0.45]}>
          <boxGeometry args={[1, 1, 1]} />
        </LitMesh>
        <LitMesh color={def.accent} position={[0, bulk ? 2.2 : 2.05, 0]} scale={bulk ? [0.62, 0.55, 0.55] : [0.5, 0.5, 0.5]}>
          <boxGeometry args={[1, 1, 1]} />
        </LitMesh>
        <LitMesh color={def.color} position={[bulk ? 0.7 : 0.55, 1.2, 0]} scale={[0.24, 1.15, 0.24]}>
          <boxGeometry args={[1, 1, 1]} />
        </LitMesh>
        <LitMesh color={def.color} position={[bulk ? -0.7 : -0.55, 1.2, 0]} scale={[0.24, 1.15, 0.24]}>
          <boxGeometry args={[1, 1, 1]} />
        </LitMesh>
        {extras}
      </group>
    );
  }

  return (
    <group ref={root} scale={def.scale}>
      <LitMesh color={def.color} position={[0, 1.1, 0]} scale={[0.55, 1.6, 0.4]}>
        <capsuleGeometry args={[0.5, 1, 4, 8]} />
      </LitMesh>
      <mesh position={[0, 1.6, 0.18]}>
        <sphereGeometry args={[0.12, 8, 6]} />
        <meshBasicMaterial color={def.accent} transparent opacity={0.7} />
      </mesh>
      {extras}
    </group>
  );
}
