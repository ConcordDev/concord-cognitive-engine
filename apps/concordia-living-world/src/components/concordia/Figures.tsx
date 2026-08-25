import { useFrame } from "@react-three/fiber";
import { useMemo, useRef } from "react";
import * as THREE from "three";
import { solveBody, type Joint } from "@/game/anim";
import type { AttackKind } from "@/game/combat";
import type { Gait } from "@/game/locomotion";
import type { Pose } from "@/game/sim";
import { LitMesh } from "./Lit";

export type { Pose };

function dampJoint(g: THREE.Group | null, t: Joint, dt: number, rate: number) {
  if (!g) return;
  g.rotation.x = THREE.MathUtils.damp(g.rotation.x, t.rx, rate, dt);
  g.rotation.y = THREE.MathUtils.damp(g.rotation.y, t.ry, rate, dt);
  g.rotation.z = THREE.MathUtils.damp(g.rotation.z, t.rz, rate, dt);
  if (t.py != null) g.position.y = THREE.MathUtils.damp(g.position.y, t.py, rate, dt);
}

function Sword({ drawn }: { drawn: boolean }) {
  return (
    <group visible={drawn} rotation={[1.05, 0.06, 0.18]} position={[0.02, -0.02, 0.04]}>
      <LitMesh color="#3a2c22" surface="cloth" roughness={0.7} position={[0, 0.02, 0]}>
        <cylinderGeometry args={[0.018, 0.02, 0.12, 8]} />
      </LitMesh>
      <LitMesh color="#c4b89a" surface="metal" position={[0, -0.05, 0]}>
        <sphereGeometry args={[0.02, 8, 6]} />
      </LitMesh>
      <LitMesh color="#b8b0a0" surface="metal" position={[0, 0.09, 0]} rotation={[0, 0, Math.PI / 2]} scale={[0.02, 0.13, 0.026]}>
        <boxGeometry args={[1, 1, 1]} />
      </LitMesh>
      <LitMesh color="#d8d4cc" surface="metal" position={[0, 0.5, 0]} scale={[0.022, 0.78, 0.07]}>
        <boxGeometry args={[1, 1, 1]} />
      </LitMesh>
      <LitMesh color="#ece8e0" surface="metal" position={[0, 0.9, 0]} scale={[0.014, 0.1, 0.036]}>
        <coneGeometry args={[0.5, 1, 4]} />
      </LitMesh>
    </group>
  );
}

/**
 * Hierarchical humanoid. Local +Z is the face.
 * Pelvis is the locomotion root; spine/chest/arms inherit it.
 * Weapon is parented to the right hand, not the character root.
 */
export function Figure({
  color,
  accent,
  height,
  pose,
  lantern,
  speed = 0,
  gait = "idle",
  gaitPhase = 0,
  live = false,
  outfit = "robe",
}: {
  color: string;
  accent: string;
  height: number;
  pose: Pose;
  lantern?: boolean;
  speed?: number;
  gait?: Gait;
  gaitPhase?: number;
  live?: boolean;
  outfit?: "street" | "robe";
}) {
  const root = useRef<THREE.Group>(null);
  const pelvis = useRef<THREE.Group>(null);
  const spine = useRef<THREE.Group>(null);
  const chest = useRef<THREE.Group>(null);
  const head = useRef<THREE.Group>(null);
  const clavR = useRef<THREE.Group>(null);
  const clavL = useRef<THREE.Group>(null);
  const armR = useRef<THREE.Group>(null);
  const armL = useRef<THREE.Group>(null);
  const foreR = useRef<THREE.Group>(null);
  const foreL = useRef<THREE.Group>(null);
  const handR = useRef<THREE.Group>(null);
  const handL = useRef<THREE.Group>(null);
  const thighR = useRef<THREE.Group>(null);
  const thighL = useRef<THREE.Group>(null);
  const shinR = useRef<THREE.Group>(null);
  const shinL = useRef<THREE.Group>(null);
  const sheath = useRef<THREE.Group>(null);
  const weapon = useRef<THREE.Group>(null);
  const clock = useRef(0);
  const prevSpeed = useRef(0);
  const s = height / 1.75;
  const street = outfit === "street";
  const hair = useMemo(() => new THREE.Color(accent).multiplyScalar(0.42).getStyle(), [accent]);
  const cloth = useMemo(() => new THREE.Color(color).multiplyScalar(0.82).getStyle(), [color]);
  const skin = useMemo(
    () => (street ? "#c9a07a" : new THREE.Color(color).lerp(new THREE.Color("#c4a07a"), 0.45).getStyle()),
    [street, color],
  );
  const shirt = street ? "#efe6d6" : cloth;
  const pants = street ? "#4e3f2c" : cloth;
  const boot = street ? "#1c1612" : "#2c2118";
  const hairCol = street ? "#1a1614" : hair;
  const belt = street ? "#2a2218" : "#3a2c20";

  useFrame((_, dt) => {
    clock.current += dt;
    const g = root.current;
    if (!g) return;
    const parent = g.parent as THREE.Object3D | null;
    const ud = parent?.userData ?? {};
    const liveSpeed = live && parent ? Number(ud.speed ?? speed) : speed;
    const liveGait = ((live && parent ? ud.gait : gait) as Gait) || gait;
    const livePhase = live && parent ? Number(ud.foot ?? gaitPhase) : gaitPhase;
    const act = live && parent ? String(ud.act ?? "") : "";
    const stagger = live && parent ? String(ud.stagger ?? "") : "";
    const accel = (liveSpeed - prevSpeed.current) / Math.max(dt, 1 / 120);
    prevSpeed.current = liveSpeed;

    const targets = solveBody({
      t: clock.current,
      speed: liveSpeed,
      gait: liveGait,
      phase: livePhase,
      pose,
      act,
      stagger,
      hitDirX: Number(ud.hitDirX ?? 0),
      hitDirZ: Number(ud.hitDirZ ?? 1),
      now: Number(ud.now ?? 0),
      attackKind: (ud.attackKind as AttackKind | null) ?? null,
      windupUntil: Number(ud.windupUntil ?? 0),
      activeUntil: Number(ud.activeUntil ?? 0),
      recoverUntil: Number(ud.recoverUntil ?? 0),
      lookYaw: Number(ud.lookYaw ?? 0),
      accel,
      armed: street || Boolean(ud.armed),
    });

    g.scale.set(s, s * targets.rootSy, s);
    g.rotation.x = THREE.MathUtils.damp(g.rotation.x, targets.rootRx, 10, dt);

    dampJoint(pelvis.current, targets.pelvis, dt, 14);
    dampJoint(spine.current, targets.spine, dt, 12);
    dampJoint(chest.current, targets.chest, dt, 12);
    dampJoint(head.current, targets.head, dt, 8);
    dampJoint(clavR.current, targets.clavR, dt, 12);
    dampJoint(clavL.current, targets.clavL, dt, 12);
    const armRate = targets.weaponDrawn ? 18 : 14;
    dampJoint(armR.current, targets.armR, dt, armRate);
    dampJoint(armL.current, targets.armL, dt, armRate);
    dampJoint(foreR.current, targets.foreR, dt, armRate);
    dampJoint(foreL.current, targets.foreL, dt, armRate);
    dampJoint(handR.current, targets.handR, dt, 16);
    dampJoint(handL.current, targets.handL, dt, 16);
    dampJoint(thighR.current, targets.thighR, dt, 16);
    dampJoint(thighL.current, targets.thighL, dt, 16);
    dampJoint(shinR.current, targets.shinR, dt, 14);
    dampJoint(shinL.current, targets.shinL, dt, 14);

    if (weapon.current) weapon.current.visible = street || targets.weaponDrawn;
    if (sheath.current) sheath.current.visible = false;
  });

  const shX = 0.205;

  return (
    <group ref={root}>
      <mesh rotation={[-Math.PI / 2, 0, 0]} position={[0, 0.02, 0]} renderOrder={-1} receiveShadow>
        <circleGeometry args={[0.34, 16]} />
        <meshBasicMaterial color="#1a140c" transparent opacity={0.3} depthWrite={false} />
      </mesh>

      <group ref={pelvis}>
        <LitMesh color={pants} surface="cloth" position={[0, 0.95, 0.01]} scale={[0.36, 0.16, 0.22]}>
          <sphereGeometry args={[0.5, 10, 8]} />
        </LitMesh>
        <LitMesh color={belt} surface="cloth" roughness={0.62} position={[0, 1.02, 0.02]} scale={[0.38, 0.05, 0.24]}>
          <boxGeometry args={[1, 1, 1]} />
        </LitMesh>

        <group ref={thighR} position={[0.105, 0.9, 0]}>
          <LitMesh color={pants} surface="cloth" position={[0, -0.2, 0]}>
            <capsuleGeometry args={[0.078, 0.28, 4, 8]} />
          </LitMesh>
          <group ref={shinR} position={[0, -0.42, 0]}>
            <LitMesh color={pants} surface="cloth" position={[0, -0.18, 0]}>
              <capsuleGeometry args={[0.062, 0.26, 4, 8]} />
            </LitMesh>
            <LitMesh color={boot} surface="cloth" roughness={0.68} position={[0.015, -0.4, 0.07]} scale={[0.125, 0.1, 0.24]}>
              <boxGeometry args={[1, 1, 1]} />
            </LitMesh>
          </group>
        </group>
        <group ref={thighL} position={[-0.105, 0.9, 0]}>
          <LitMesh color={pants} surface="cloth" position={[0, -0.2, 0]}>
            <capsuleGeometry args={[0.078, 0.28, 4, 8]} />
          </LitMesh>
          <group ref={shinL} position={[0, -0.42, 0]}>
            <LitMesh color={pants} surface="cloth" position={[0, -0.18, 0]}>
              <capsuleGeometry args={[0.062, 0.26, 4, 8]} />
            </LitMesh>
            <LitMesh color={boot} surface="cloth" roughness={0.68} position={[-0.015, -0.4, 0.07]} scale={[0.125, 0.1, 0.24]}>
              <boxGeometry args={[1, 1, 1]} />
            </LitMesh>
          </group>
        </group>

        <group ref={spine} position={[0, 1.05, 0]}>
          <group ref={chest}>
            <LitMesh color={shirt} surface="cloth" position={[0, 0.08, 0.02]} scale={[0.3, 0.16, 0.18]}>
              <sphereGeometry args={[0.5, 10, 8]} />
            </LitMesh>
            <LitMesh color={shirt} surface="cloth" position={[0, 0.28, 0.03]}>
              <capsuleGeometry args={[0.2, 0.22, 6, 10]} />
            </LitMesh>
            <LitMesh color={shirt} surface="cloth" roughness={0.72} position={[0, 0.32, 0.02]} scale={[0.5, 0.34, 0.28]}>
              <sphereGeometry args={[0.5, 12, 10]} />
            </LitMesh>
            <LitMesh color={shirt} surface="cloth" roughness={0.74} position={[0, 0.44, -0.05]} scale={[0.3, 0.1, 0.14]}>
              <boxGeometry args={[1, 1, 1]} />
            </LitMesh>
            <LitMesh color={shirt} surface="cloth" roughness={0.7} position={[0, 0.48, 0.06]} scale={[0.22, 0.08, 0.1]}>
              <boxGeometry args={[1, 1, 1]} />
            </LitMesh>
            <LitMesh color={skin} surface="skin" position={[0, 0.5, 0.01]}>
              <cylinderGeometry args={[0.048, 0.066, 0.1, 8]} />
            </LitMesh>

            <group ref={head} position={[0, 0.64, 0.02]}>
              <LitMesh color={skin} surface="skin">
                <sphereGeometry args={[0.112, 16, 14]} />
              </LitMesh>
              <LitMesh color={hairCol} surface="cloth" roughness={0.9} position={[0, 0.05, -0.02]} scale={[1.1, 0.7, 1.12]}>
                <sphereGeometry args={[0.112, 12, 10]} />
              </LitMesh>
              <LitMesh color={hairCol} surface="cloth" roughness={0.92} position={[0, 0.02, -0.08]} scale={[0.95, 0.7, 0.7]}>
                <sphereGeometry args={[0.1, 10, 8]} />
              </LitMesh>
              <LitMesh color={skin} surface="skin" position={[0.108, 0, 0.01]} scale={[0.035, 0.055, 0.04]}>
                <sphereGeometry args={[1, 8, 6]} />
              </LitMesh>
              <LitMesh color={skin} surface="skin" position={[-0.108, 0, 0.01]} scale={[0.035, 0.055, 0.04]}>
                <sphereGeometry args={[1, 8, 6]} />
              </LitMesh>
              <mesh position={[0.038, 0.012, 0.096]} castShadow>
                <sphereGeometry args={[0.015, 8, 8]} />
                <meshPhysicalMaterial color="#1a120c" roughness={0.28} metalness={0.15} envMapIntensity={0.8} />
              </mesh>
              <mesh position={[-0.038, 0.012, 0.096]} castShadow>
                <sphereGeometry args={[0.015, 8, 8]} />
                <meshPhysicalMaterial color="#1a120c" roughness={0.28} metalness={0.15} envMapIntensity={0.8} />
              </mesh>
              <LitMesh color={skin} surface="skin" roughness={0.5} position={[0, -0.01, 0.108]} scale={[0.028, 0.036, 0.04]}>
                <boxGeometry args={[1, 1, 1]} />
              </LitMesh>
              <mesh position={[0, 0.038, 0.09]} rotation={[0.2, 0, 0]}>
                <boxGeometry args={[0.09, 0.018, 0.03]} />
                <meshPhysicalMaterial color="#3a2a20" roughness={0.7} />
              </mesh>
            </group>

            <group ref={clavR} position={[shX * 0.35, 0.38, 0]}>
              <group ref={armR} position={[shX * 0.65, 0, 0]}>
                <LitMesh color={shirt} surface="cloth" roughness={0.7}>
                  <sphereGeometry args={[0.08, 10, 8]} />
                </LitMesh>
                <LitMesh color={shirt} surface="cloth" roughness={0.7} position={[0.012, -0.13, 0]} rotation={[0, 0, 0.05]}>
                  <capsuleGeometry args={[0.056, 0.15, 4, 8]} />
                </LitMesh>
                <LitMesh color={skin} surface="skin" position={[0.016, -0.27, 0]} rotation={[0, 0, 0.04]}>
                  <capsuleGeometry args={[0.044, 0.12, 4, 8]} />
                </LitMesh>
                <group ref={foreR} position={[0.02, -0.4, 0]}>
                  <LitMesh color={skin} surface="skin" position={[0, -0.11, 0]}>
                    <capsuleGeometry args={[0.038, 0.18, 4, 8]} />
                  </LitMesh>
                  <group ref={handR} position={[0, -0.26, 0.015]}>
                    <LitMesh color={skin} surface="skin" roughness={0.5} scale={[0.058, 0.05, 0.085]}>
                      <boxGeometry args={[1, 1, 1]} />
                    </LitMesh>
                    <group ref={weapon}>
                      <Sword drawn />
                    </group>
                  </group>
                </group>
              </group>
            </group>

            <group ref={clavL} position={[-shX * 0.35, 0.38, 0]}>
              <group ref={armL} position={[-shX * 0.65, 0, 0]}>
                <LitMesh color={shirt} surface="cloth" roughness={0.7}>
                  <sphereGeometry args={[0.08, 10, 8]} />
                </LitMesh>
                <LitMesh color={shirt} surface="cloth" roughness={0.7} position={[-0.012, -0.13, 0]} rotation={[0, 0, -0.05]}>
                  <capsuleGeometry args={[0.056, 0.15, 4, 8]} />
                </LitMesh>
                <LitMesh color={skin} surface="skin" position={[-0.016, -0.27, 0]} rotation={[0, 0, -0.04]}>
                  <capsuleGeometry args={[0.044, 0.12, 4, 8]} />
                </LitMesh>
                <group ref={foreL} position={[-0.02, -0.4, 0]}>
                  <LitMesh color={skin} surface="skin" position={[0, -0.11, 0]}>
                    <capsuleGeometry args={[0.038, 0.18, 4, 8]} />
                  </LitMesh>
                  <group ref={handL} position={[0, -0.26, 0.015]}>
                    <LitMesh color={skin} surface="skin" roughness={0.5} scale={[0.058, 0.05, 0.085]}>
                      <boxGeometry args={[1, 1, 1]} />
                    </LitMesh>
                    {lantern ? (
                      <group position={[0, -0.06, 0.08]}>
                        <LitMesh color="#c8a050" surface="metal" metalness={0.45} roughness={0.4} scale={[0.14, 0.2, 0.14]}>
                          <boxGeometry args={[1, 1, 1]} />
                        </LitMesh>
                        <pointLight color="#ffd890" intensity={1.8} distance={7} />
                      </group>
                    ) : null}
                  </group>
                </group>
              </group>
            </group>

            {street ? (
              <group ref={sheath} position={[0.12, 0.14, -0.16]} rotation={[0.18, 0.42, 0.55]}>
                <LitMesh color="#2a2420" surface="cloth" roughness={0.7} scale={[0.05, 0.55, 0.05]}>
                  <cylinderGeometry args={[1, 1, 1, 6]} />
                </LitMesh>
                <LitMesh color="#b8b0a4" surface="metal" position={[0, 0.32, 0]} scale={[0.035, 0.22, 0.018]}>
                  <boxGeometry args={[1, 1, 1]} />
                </LitMesh>
              </group>
            ) : (
              <group ref={sheath} visible={false} />
            )}
          </group>
        </group>
      </group>
    </group>
  );
}
