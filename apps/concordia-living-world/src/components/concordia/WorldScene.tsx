import { useFrame } from "@react-three/fiber";
import { useMemo, useRef, type MutableRefObject, Suspense } from "react";
import * as THREE from "three";
import type { Theme, WorldId } from "@/game/content";
import { worldKit } from "@/game/worlds";
import { loreStones } from "@/game/lore-play";
import { LitMesh } from "./Lit";
import { heightAt } from "@/game/life";
import { qualityOpts } from "@/game/quality";
import { useOverlay } from "@/game/store";
import { LifeField } from "./LifeField";
import type { Sim } from "@/game/sim";
import { pbrDirt, pbrGrass, pbrStone, tilePbr } from "@/game/pbr";
import { RuinBoulder, RuinStatue } from "./RuinModels";

function Landmark({
  kind,
  x,
  z,
  rot = 0,
  s = 1,
  theme,
  worldId = "sovereign-ruins",
}: {
  kind: string;
  x: number;
  z: number;
  rot?: number;
  s?: number;
  theme: Theme;
  worldId?: WorldId;
}) {
  const stone = theme.building;
  const dark = theme.building2;
  const lamp = theme.lamp;
  return (
    <group position={[x, heightAt(worldId, x, z), z]} rotation={[0, rot, 0]} scale={s}>
      {kind === "tree" ? (
        worldId === "sovereign-ruins" ? (
          <>
            <LitMesh color="#5a4632" surface="foliage" position={[0, 1.15, 0]}>
              <cylinderGeometry args={[0.12, 0.22, 2.3, 6]} />
            </LitMesh>
            <LitMesh color="#4a3a28" surface="foliage" position={[0.35, 1.7, 0.05]} rotation={[0, 0, 0.85]}>
              <cylinderGeometry args={[0.05, 0.08, 1.1, 5]} />
            </LitMesh>
            <LitMesh color="#4a3a28" surface="foliage" position={[-0.28, 2.05, -0.08]} rotation={[0.2, 0, -0.7]}>
              <cylinderGeometry args={[0.04, 0.07, 0.9, 5]} />
            </LitMesh>
          </>
        ) : (
          <>
            <LitMesh color="#6a4a28" surface="foliage" position={[0, 0.9, 0]} scale={[0.38, 1.8, 0.38]}>
              <cylinderGeometry args={[0.5, 0.5, 1, 6]} />
            </LitMesh>
            <LitMesh color="#4f6a38" surface="foliage" position={[0, 2.3, 0]} scale={[2.1, 1.8, 2.1]}>
              <sphereGeometry args={[0.5, 10, 8]} />
            </LitMesh>
          </>
        )
      ) : null}
      {kind === "mesa" ? (
        <LitMesh color={stone} surface="stone" position={[0, 1.1, 0]} scale={[2.4, 2.2, 2.4]}>
          <cylinderGeometry args={[0.5, 0.62, 1, 8]} />
        </LitMesh>
      ) : null}
      {kind === "arch" ? (
        <>
          <LitMesh color={stone} surface="stone" position={[-1.25, 0.18, 0]} scale={[1.1, 0.36, 1.0]}>
            <boxGeometry args={[1, 1, 1]} />
          </LitMesh>
          <LitMesh color={stone} surface="stone" position={[1.25, 0.18, 0]} scale={[1.1, 0.36, 1.0]}>
            <boxGeometry args={[1, 1, 1]} />
          </LitMesh>
          <LitMesh color={stone} surface="stone" position={[-1.15, 1.7, 0]} scale={[0.55, 3.1, 0.7]}>
            <boxGeometry args={[1, 1, 1]} />
          </LitMesh>
          <LitMesh color={stone} surface="stone" position={[1.15, 1.55, 0]} scale={[0.5, 2.8, 0.65]}>
            <boxGeometry args={[1, 1, 1]} />
          </LitMesh>
          <LitMesh color={dark} surface="stone" position={[-0.2, 3.35, 0]} rotation={[0, 0, 0.08]} scale={[1.7, 0.42, 0.8]}>
            <boxGeometry args={[1, 1, 1]} />
          </LitMesh>
          <LitMesh color={dark} surface="stone" position={[1.05, 3.15, 0.08]} rotation={[0.15, 0.2, -0.35]} scale={[0.9, 0.35, 0.55]}>
            <boxGeometry args={[1, 1, 1]} />
          </LitMesh>
          <LitMesh color={stone} surface="stone" position={[1.4, 0.45, 0.35]} rotation={[0.4, 0.3, 0.2]} scale={[0.55, 0.35, 0.4]}>
            <boxGeometry args={[1, 1, 1]} />
          </LitMesh>
        </>
      ) : null}
      {kind === "pillar" ? (
        <>
          <LitMesh color={dark} surface="stone" position={[0, 0.18, 0]} scale={[0.95, 0.36, 0.95]}>
            <boxGeometry args={[1, 1, 1]} />
          </LitMesh>
          <LitMesh color={stone} surface="stone" position={[0, 1.7, 0]}>
            <cylinderGeometry args={[0.22, 0.28, 3.1, 8]} />
          </LitMesh>
          <LitMesh color={dark} surface="stone" position={[0, 3.28, 0]} scale={[0.7, 0.22, 0.7]}>
            <boxGeometry args={[1, 1, 1]} />
          </LitMesh>
          <LitMesh color={stone} surface="stone" position={[0.42, 0.28, 0.22]} rotation={[0.5, 0.4, 0.3]} scale={[0.45, 0.28, 0.32]}>
            <boxGeometry args={[1, 1, 1]} />
          </LitMesh>
        </>
      ) : null}
      {kind === "column" ? (
        <>
          <LitMesh color={dark} surface="stone" position={[0, 0.16, 0]} scale={[0.85, 0.32, 0.85]}>
            <boxGeometry args={[1, 1, 1]} />
          </LitMesh>
          <LitMesh color={stone} surface="stone" position={[0, 1.6, 0]}>
            <cylinderGeometry args={[0.2, 0.26, 2.9, 8]} />
          </LitMesh>
          <LitMesh color={stone} surface="stone" position={[0.15, 3.15, 0]} rotation={[0.4, 0, 0.15]} scale={[0.42, 0.45, 0.38]}>
            <boxGeometry args={[1, 1, 1]} />
          </LitMesh>
        </>
      ) : null}
      {kind === "statue" ? (
        worldId === "sovereign-ruins" ? (
          <Suspense fallback={null}>
            <RuinStatue variant="gothic" />
          </Suspense>
        ) : (
        <>
          <LitMesh color={dark} surface="stone" position={[0, 0.22, 0]} scale={[1.15, 0.44, 1.15]}>
            <boxGeometry args={[1, 1, 1]} />
          </LitMesh>
          <LitMesh color={stone} surface="stone" position={[0.1, 0.7, 0.04]} scale={[0.22, 0.7, 0.2]}>
            <boxGeometry args={[1, 1, 1]} />
          </LitMesh>
          <LitMesh color={stone} surface="stone" position={[-0.12, 0.62, 0]} scale={[0.2, 0.55, 0.18]}>
            <boxGeometry args={[1, 1, 1]} />
          </LitMesh>
          <LitMesh color={stone} surface="stone" position={[0, 1.35, 0.05]} scale={[0.48, 0.7, 0.32]}>
            <boxGeometry args={[1, 1, 1]} />
          </LitMesh>
          <LitMesh color={stone} surface="stone" position={[0.38, 1.45, 0.05]} rotation={[0, 0, 0.7]} scale={[0.12, 0.55, 0.12]}>
            <boxGeometry args={[1, 1, 1]} />
          </LitMesh>
          <LitMesh color={stone} surface="stone" position={[0.02, 1.85, 0.06]}>
            <sphereGeometry args={[0.16, 8, 6]} />
          </LitMesh>
          <LitMesh color={dark} surface="stone" position={[0.55, 0.18, 0.35]} rotation={[0.2, 0.6, 0]} scale={[0.22, 0.16, 0.28]}>
            <boxGeometry args={[1, 1, 1]} />
          </LitMesh>
        </>
        )
      ) : null}
      {kind === "banner" ? (
        <>
          <LitMesh color="#5a4a32" surface="stone" position={[0, 1.6, 0]} scale={[0.12, 3.2, 0.12]}>
            <cylinderGeometry args={[0.5, 0.5, 1, 6]} />
          </LitMesh>
          <mesh position={[0.55, 2.4, 0]}>
            <planeGeometry args={[1.1, 1.4]} />
            <meshPhysicalMaterial color={lamp} side={THREE.DoubleSide} transparent opacity={0.85} roughness={0.55} sheen={0.3} />
          </mesh>
        </>
      ) : null}
      {kind === "wall" ? (
        <>
          <LitMesh color={stone} surface="stone" position={[0, 1.35, 0]} scale={[6.6, 2.7, 0.55]}>
            <boxGeometry args={[1, 1, 1]} />
          </LitMesh>
          <LitMesh color={dark} surface="stone" position={[-2.4, 2.85, 0]} scale={[1.4, 0.35, 0.7]}>
            <boxGeometry args={[1, 1, 1]} />
          </LitMesh>
          <LitMesh color={dark} surface="stone" position={[0.4, 2.9, 0]} scale={[1.1, 0.4, 0.7]}>
            <boxGeometry args={[1, 1, 1]} />
          </LitMesh>
          <LitMesh color={stone} surface="stone" position={[2.6, 1.05, 0.15]} rotation={[0, 0, 0.18]} scale={[1.5, 2.1, 0.5]}>
            <boxGeometry args={[1, 1, 1]} />
          </LitMesh>
          <LitMesh color={dark} surface="stone" position={[-1.2, 0.22, 0.4]} rotation={[0.2, 0.4, 0]} scale={[0.7, 0.4, 0.5]}>
            <boxGeometry args={[1, 1, 1]} />
          </LitMesh>
        </>
      ) : null}
      {kind === "gate" ? (
        <>
          <LitMesh color={dark} surface="stone" position={[-1.85, 0.22, 0.1]} scale={[1.4, 0.44, 1.3]}>
            <boxGeometry args={[1, 1, 1]} />
          </LitMesh>
          <LitMesh color={dark} surface="stone" position={[1.85, 0.22, 0.1]} scale={[1.4, 0.44, 1.3]}>
            <boxGeometry args={[1, 1, 1]} />
          </LitMesh>
          <LitMesh color={stone} surface="stone" position={[-1.85, 2.05, 0]} scale={[0.7, 3.7, 0.85]}>
            <boxGeometry args={[1, 1, 1]} />
          </LitMesh>
          <LitMesh color={stone} surface="stone" position={[1.85, 1.9, 0]} scale={[0.65, 3.4, 0.8]}>
            <boxGeometry args={[1, 1, 1]} />
          </LitMesh>
          <LitMesh color={dark} surface="stone" position={[-1.85, 4.05, 0]} scale={[0.95, 0.4, 1.05]}>
            <boxGeometry args={[1, 1, 1]} />
          </LitMesh>
          <LitMesh color={dark} surface="stone" position={[1.85, 3.75, 0]} scale={[0.9, 0.35, 1.0]}>
            <boxGeometry args={[1, 1, 1]} />
          </LitMesh>
          <LitMesh color={stone} surface="stone" position={[-0.15, 4.25, 0]} rotation={[0, 0, 0.06]} scale={[2.2, 0.48, 1.05]}>
            <boxGeometry args={[1, 1, 1]} />
          </LitMesh>
          <LitMesh color={stone} surface="stone" position={[1.35, 4.0, 0.12]} rotation={[0.2, 0.15, -0.4]} scale={[1.15, 0.38, 0.7]}>
            <boxGeometry args={[1, 1, 1]} />
          </LitMesh>
          <LitMesh color="#2a2218" surface="cloth" position={[0, 1.7, 0.12]} scale={[2.4, 3.2, 0.08]}>
            <boxGeometry args={[1, 1, 1]} />
          </LitMesh>
          <LitMesh color={dark} surface="stone" position={[2.3, 0.35, 0.45]} rotation={[0.35, 0.5, 0.1]} scale={[0.7, 0.4, 0.5]}>
            <boxGeometry args={[1, 1, 1]} />
          </LitMesh>
        </>
      ) : null}
      {kind === "tower" ? (
        <>
          <LitMesh color={dark} surface="stone" position={[0, 0.2, 0]} scale={[1.9, 0.4, 1.9]}>
            <boxGeometry args={[1, 1, 1]} />
          </LitMesh>
          <LitMesh color={stone} surface="stone" position={[0, 2.5, 0]} scale={[1.45, 4.8, 1.45]}>
            <boxGeometry args={[1, 1, 1]} />
          </LitMesh>
          <LitMesh color={dark} surface="stone" position={[-0.55, 5.05, -0.55]} scale={[0.4, 0.7, 0.4]}>
            <boxGeometry args={[1, 1, 1]} />
          </LitMesh>
          <LitMesh color={dark} surface="stone" position={[0.55, 4.85, 0.55]} scale={[0.38, 0.45, 0.38]}>
            <boxGeometry args={[1, 1, 1]} />
          </LitMesh>
          <mesh position={[0, 3.15, 0.74]}>
            <planeGeometry args={[0.7, 1.5]} />
            <meshPhysicalMaterial color={lamp} transparent opacity={0.4} emissive={lamp} emissiveIntensity={0.3} />
          </mesh>
          <LitMesh color={stone} surface="stone" position={[0.95, 1.1, 0.7]} rotation={[0.15, 0.4, 0.25]} scale={[0.7, 0.5, 0.45]}>
            <boxGeometry args={[1, 1, 1]} />
          </LitMesh>
        </>
      ) : null}
      {kind === "rack" ? (
        <>
          <LitMesh color="#4a3828" surface="stone" position={[0, 0.7, 0]} scale={[1.6, 1.4, 0.35]}>
            <boxGeometry args={[1, 1, 1]} />
          </LitMesh>
          <LitMesh color={lamp} surface="metal" position={[-0.3, 1.15, 0.05]} rotation={[0, 0, 0.3]} scale={[0.08, 1.1, 0.08]}>
            <boxGeometry args={[1, 1, 1]} />
          </LitMesh>
          <LitMesh color={lamp} surface="metal" position={[0.25, 1.1, 0.05]} rotation={[0, 0, -0.2]} scale={[0.08, 1.05, 0.08]}>
            <boxGeometry args={[1, 1, 1]} />
          </LitMesh>
        </>
      ) : null}
      {kind === "fire" ? (
        <>
          <LitMesh color="#3a2a1c" surface="stone" position={[0, 0.2, 0]} scale={[0.9, 0.4, 0.9]}>
            <cylinderGeometry args={[0.5, 0.55, 1, 8]} />
          </LitMesh>
          <mesh position={[0, 0.7, 0]}>
            <coneGeometry args={[0.28, 0.7, 6]} />
            <meshPhysicalMaterial color={lamp} emissive={lamp} emissiveIntensity={1.6} roughness={0.4} />
          </mesh>
          <pointLight color={lamp} intensity={1.1} distance={8} position={[0, 0.9, 0]} />
        </>
      ) : null}
      {kind === "wagon" ? (
        <>
          <LitMesh color="#6a4a28" surface="stone" position={[0, 0.85, 0]} scale={[2.6, 1.1, 1.4]}>
            <boxGeometry args={[1, 1, 1]} />
          </LitMesh>
          <LitMesh color="#2a2018" surface="stone" position={[-0.9, 0.35, 0.7]} scale={[0.7, 0.7, 0.18]}>
            <cylinderGeometry args={[0.5, 0.5, 1, 10]} />
          </LitMesh>
          <LitMesh color="#2a2018" surface="stone" position={[0.9, 0.35, 0.7]} scale={[0.7, 0.7, 0.18]}>
            <cylinderGeometry args={[0.5, 0.5, 1, 10]} />
          </LitMesh>
        </>
      ) : null}
      {kind === "cactus" ? (
        <>
          <LitMesh color="#3a6a40" surface="foliage" position={[0, 1.1, 0]} scale={[0.32, 2.2, 0.32]}>
            <cylinderGeometry args={[0.5, 0.5, 1, 8]} />
          </LitMesh>
          <LitMesh color="#3a6a40" surface="foliage" position={[0.45, 1.35, 0]} rotation={[0, 0, 1.1]} scale={[0.22, 0.9, 0.22]}>
            <cylinderGeometry args={[0.5, 0.5, 1, 8]} />
          </LitMesh>
        </>
      ) : null}
      {kind === "shard" ? (
        <LitMesh color={lamp} surface="metal" position={[0, 1.8, 0]} rotation={[0.3, 0.4, 0.2]} scale={[0.7, 3.6, 0.35]}>
          <boxGeometry args={[1, 1, 1]} />
        </LitMesh>
      ) : null}
      {kind === "hut" ? (
        <>
          <LitMesh color={dark} surface="stone" position={[0, 0.85, 0]} scale={[1.8, 1.7, 1.6]}>
            <boxGeometry args={[1, 1, 1]} />
          </LitMesh>
          <LitMesh color="#6a3a1c" surface="stone" position={[0, 1.95, 0]} rotation={[0, Math.PI / 4, 0]} scale={[1.5, 0.7, 1.5]}>
            <coneGeometry args={[0.85, 1, 4]} />
          </LitMesh>
        </>
      ) : null}
      {kind === "tent" ? (
        <LitMesh color={stone} surface="cloth" position={[0, 1.0, 0]} scale={[1.6, 2.0, 1.6]}>
          <coneGeometry args={[0.7, 1, 4]} />
        </LitMesh>
      ) : null}
      {kind === "stall" ? (
        <>
          <LitMesh color="#6a4a28" surface="stone" position={[0, 0.7, 0]} scale={[1.8, 0.2, 1.1]}>
            <boxGeometry args={[1, 1, 1]} />
          </LitMesh>
          <LitMesh color={dark} surface="stone" position={[-0.8, 1.1, 0]} scale={[0.1, 1.6, 0.1]}>
            <boxGeometry args={[1, 1, 1]} />
          </LitMesh>
          <LitMesh color={dark} surface="stone" position={[0.8, 1.1, 0]} scale={[0.1, 1.6, 0.1]}>
            <boxGeometry args={[1, 1, 1]} />
          </LitMesh>
          <LitMesh color={lamp} surface="cloth" position={[0, 1.85, 0]} scale={[1.9, 0.08, 1.2]}>
            <boxGeometry args={[1, 1, 1]} />
          </LitMesh>
        </>
      ) : null}
      {kind === "crate" ? (
        <LitMesh color="#6a5030" surface="stone" position={[0, 0.4, 0]} scale={[0.85, 0.8, 0.85]}>
          <boxGeometry args={[1, 1, 1]} />
        </LitMesh>
      ) : null}
      {kind === "boulder" ? (
        <LitMesh color={dark} surface="stone" position={[0, 0.45, 0]} scale={[1.3, 0.9, 1.1]}>
          <dodecahedronGeometry args={[0.55, 0]} />
        </LitMesh>
      ) : null}
      {kind === "shrine" ? (
        <>
          <LitMesh color={stone} surface="stone" position={[0, 0.2, 0]} scale={[1.3, 0.4, 1.3]}>
            <cylinderGeometry args={[0.5, 0.5, 1, 8]} />
          </LitMesh>
          <LitMesh color={lamp} surface="metal" position={[0, 0.9, 0]} scale={[0.35, 0.9, 0.35]}>
            <octahedronGeometry args={[0.5, 0]} />
          </LitMesh>
        </>
      ) : null}
      {kind === "lamp" ? (
        <>
          <LitMesh color="#4a3a28" surface="metal" position={[0, 1.3, 0]} scale={[0.1, 2.6, 0.1]}>
            <cylinderGeometry args={[0.5, 0.5, 1, 6]} />
          </LitMesh>
          <mesh position={[0, 2.55, 0]}>
            <sphereGeometry args={[0.18, 8, 6]} />
            <meshPhysicalMaterial color={lamp} emissive={lamp} emissiveIntensity={1.5} roughness={0.2} />
          </mesh>
          <pointLight color={lamp} intensity={0.9} distance={9} position={[0, 2.55, 0]} />
        </>
      ) : null}
      {kind === "grave" ? (
        worldId === "sovereign-ruins" ? (
          <group>
            <LitMesh color={stone} surface="stone" position={[0, 0.18, 0]} scale={[0.7, 0.36, 0.7]}>
              <boxGeometry args={[1, 1, 1]} />
            </LitMesh>
            <group position={[0, 0.36, 0]}>
              <Suspense fallback={null}>
                <RuinStatue variant="bust" />
              </Suspense>
            </group>
          </group>
        ) : (
        <LitMesh color={stone} surface="stone" position={[0, 0.55, 0]} scale={[0.55, 1.1, 0.18]}>
          <boxGeometry args={[1, 1, 1]} />
        </LitMesh>
        )
      ) : null}
      {kind === "bone" ? (
        <LitMesh color="#e8dcc0" surface="stone" position={[0, 0.12, 0]} rotation={[0, 0, 0.4]} scale={[0.7, 0.12, 0.12]}>
          <capsuleGeometry args={[0.5, 1, 3, 6]} />
        </LitMesh>
      ) : null}
      {kind === "rubble" ? (
        worldId === "sovereign-ruins" ? (
          <Suspense fallback={null}>
            <RuinBoulder scale={0.55} />
          </Suspense>
        ) : (
        <>
          <LitMesh color={dark} surface="stone" position={[0, 0.22, 0]} scale={[1.3, 0.45, 0.95]}>
            <boxGeometry args={[1, 1, 1]} />
          </LitMesh>
          <LitMesh color={stone} surface="stone" position={[0.35, 0.48, 0.12]} rotation={[0.35, 0.5, 0.15]} scale={[0.55, 0.42, 0.48]}>
            <boxGeometry args={[1, 1, 1]} />
          </LitMesh>
          <LitMesh color={stone} surface="stone" position={[-0.4, 0.32, -0.15]} rotation={[0.2, -0.4, 0.3]} scale={[0.4, 0.28, 0.35]}>
            <dodecahedronGeometry args={[0.5, 0]} />
          </LitMesh>
        </>
        )
      ) : null}
      {kind === "crystal" ? (
        <LitMesh color={lamp} surface="metal" position={[0, 0.85, 0]} rotation={[0.15, 0.3, 0.1]} scale={[0.35, 1.6, 0.35]}>
          <octahedronGeometry args={[0.5, 0]} />
        </LitMesh>
      ) : null}
      {kind === "dish" ? (
        <>
          <LitMesh color={dark} surface="metal" position={[0, 0.7, 0]} scale={[0.18, 1.4, 0.18]}>
            <cylinderGeometry args={[0.5, 0.5, 1, 6]} />
          </LitMesh>
          <mesh position={[0, 1.45, 0]} rotation={[0.7, 0, 0]}>
            <circleGeometry args={[0.7, 16]} />
            <meshPhysicalMaterial color={lamp} side={THREE.DoubleSide} transparent opacity={0.55} metalness={0.4} roughness={0.2} />
          </mesh>
        </>
      ) : null}
      {kind === "sign" ? (
        <>
          <LitMesh color="#3a2a1c" surface="stone" position={[0, 0.9, 0]} scale={[0.1, 1.8, 0.1]}>
            <boxGeometry args={[1, 1, 1]} />
          </LitMesh>
          <mesh position={[0, 1.7, 0.06]}>
            <planeGeometry args={[1.2, 0.7]} />
            <meshPhysicalMaterial color={lamp} roughness={0.6} />
          </mesh>
        </>
      ) : null}
      {kind === "fence" ? (
        <>
          <LitMesh color="#5a4030" surface="stone" position={[-0.7, 0.55, 0]} scale={[0.1, 1.1, 0.1]}>
            <boxGeometry args={[1, 1, 1]} />
          </LitMesh>
          <LitMesh color="#5a4030" surface="stone" position={[0.7, 0.55, 0]} scale={[0.1, 1.1, 0.1]}>
            <boxGeometry args={[1, 1, 1]} />
          </LitMesh>
          <LitMesh color="#6a4a32" surface="stone" position={[0, 0.7, 0]} scale={[1.6, 0.1, 0.08]}>
            <boxGeometry args={[1, 1, 1]} />
          </LitMesh>
        </>
      ) : null}
      {kind === "fern" ? (
        <LitMesh color="#3a6a38" surface="foliage" position={[0, 0.45, 0]} scale={[0.7, 0.9, 0.25]}>
          <coneGeometry args={[0.5, 1, 5]} />
        </LitMesh>
      ) : null}
      {kind === "waystone" ? (
        <>
          <LitMesh color={stone} surface="stone" position={[0, 0.85, 0]} scale={[0.55, 1.7, 0.28]}>
            <boxGeometry args={[1, 1, 1]} />
          </LitMesh>
          <LitMesh color={dark} surface="stone" position={[0, 0.12, 0]} scale={[0.9, 0.18, 0.55]}>
            <boxGeometry args={[1, 1, 1]} />
          </LitMesh>
          <mesh position={[0, 0.95, 0.16]}>
            <planeGeometry args={[0.42, 0.7]} />
            <meshPhysicalMaterial color={lamp} emissive={lamp} emissiveIntensity={0.35} roughness={0.4} />
          </mesh>
        </>
      ) : null}
    </group>
  );
}

function HubPortal({ color, ruined }: { color: string; ruined?: boolean }) {
  if (ruined) {
    return (
      <group>
        <LitMesh color="#8a7a60" surface="stone" position={[-1.55, 0.2, 0]} scale={[1.2, 0.4, 1.15]}>
          <boxGeometry args={[1, 1, 1]} />
        </LitMesh>
        <LitMesh color="#8a7a60" surface="stone" position={[1.55, 0.2, 0]} scale={[1.2, 0.4, 1.15]}>
          <boxGeometry args={[1, 1, 1]} />
        </LitMesh>
        <LitMesh color="#9a8a70" surface="stone" position={[-1.5, 2.0, 0]} scale={[0.62, 3.8, 0.72]}>
          <boxGeometry args={[1, 1, 1]} />
        </LitMesh>
        <LitMesh color="#9a8a70" surface="stone" position={[1.5, 1.8, 0]} scale={[0.58, 3.4, 0.68]}>
          <boxGeometry args={[1, 1, 1]} />
        </LitMesh>
        <LitMesh color="#7a6a52" surface="stone" position={[-0.15, 4.05, 0]} rotation={[0, 0, 0.08]} scale={[2.0, 0.45, 0.9]}>
          <boxGeometry args={[1, 1, 1]} />
        </LitMesh>
        <LitMesh color="#7a6a52" surface="stone" position={[1.2, 3.75, 0.1]} rotation={[0.2, 0.1, -0.45]} scale={[1.1, 0.35, 0.6]}>
          <boxGeometry args={[1, 1, 1]} />
        </LitMesh>
        <mesh position={[0, 1.8, 0]}>
          <planeGeometry args={[2.1, 3.0]} />
          <meshPhysicalMaterial
            color={color}
            transparent
            opacity={0.28}
            side={THREE.DoubleSide}
            depthWrite={false}
            emissive={color}
            emissiveIntensity={0.18}
            roughness={0.35}
          />
        </mesh>
        <LitMesh color="#6a5a44" surface="stone" position={[1.9, 0.3, 0.45]} rotation={[0.4, 0.5, 0.1]} scale={[0.7, 0.35, 0.5]}>
          <boxGeometry args={[1, 1, 1]} />
        </LitMesh>
      </group>
    );
  }
  return (
    <group position={[0, 0, 0]}>
      <LitMesh color="#cfc3a8" surface="stone" position={[-1.35, 1.7, 0]} scale={[0.38, 3.4, 0.38]}>
        <boxGeometry args={[1, 1, 1]} />
      </LitMesh>
      <LitMesh color="#cfc3a8" surface="stone" position={[1.35, 1.7, 0]} scale={[0.38, 3.4, 0.38]}>
        <boxGeometry args={[1, 1, 1]} />
      </LitMesh>
      <LitMesh color="#d8cbb0" surface="stone" position={[0, 3.5, 0]} scale={[3.2, 0.38, 0.5]}>
        <boxGeometry args={[1, 1, 1]} />
      </LitMesh>
      <mesh position={[0, 1.7, 0]}>
        <planeGeometry args={[2.2, 2.9]} />
        <meshPhysicalMaterial
          color={color}
          transparent
          opacity={0.5}
          side={THREE.DoubleSide}
          depthWrite={false}
          emissive={color}
          emissiveIntensity={0.28}
          roughness={0.2}
        />
      </mesh>
    </group>
  );
}

function WeatherField({
  weather,
  lamp,
  simRef,
}: {
  weather: string;
  lamp: string;
  simRef: MutableRefObject<Sim>;
}) {
  const ref = useRef<THREE.Group>(null);
  const n = weather === "clear" ? 0 : 64;
  const pts = useMemo(
    () =>
      Array.from({ length: 64 }, (_, i) => ({
        x: ((i * 47) % 48) - 24,
        y: (i % 9) * 0.55 + 1.1,
        z: ((i * 19) % 48) - 24,
      })),
    [],
  );
  useFrame((_, dt) => {
    const g = ref.current;
    if (!g) return;
    const p = simRef.current.player;
    g.position.set(p.x, 0, p.z);
    const fall = weather === "rain" || weather === "ash" ? 7 : weather === "grove" ? 1.4 : 3;
    for (const c of g.children) {
      c.position.y -= dt * fall;
      if (weather === "wind" || weather === "drift") c.position.x += dt * 2.4;
      if (c.position.y < 0.1) {
        c.position.y = 8.5;
        c.position.x = ((c.position.x + 40) % 48) - 24;
      }
    }
  });
  if (!n) return null;
  const color = weather === "rain" ? "#9ab0c8" : weather === "ash" ? "#d8c8a8" : weather === "neon" ? lamp : weather === "grove" ? "#c8e070" : lamp;
  return (
    <group ref={ref}>
      {pts.slice(0, n).map((p, i) => (
        <mesh key={i} position={[p.x, p.y, p.z]}>
          <boxGeometry args={weather === "rain" ? [0.03, 0.32, 0.03] : weather === "ash" ? [0.12, 0.05, 0.12] : [0.08, 0.08, 0.08]} />
          <meshBasicMaterial color={color} transparent opacity={0.5} depthWrite={false} />
        </mesh>
      ))}
    </group>
  );
}

function DriftField({ pulse, lamp }: { pulse: number; lamp: string }) {
  const ref = useRef<THREE.Group>(null);
  useFrame((_, dt) => {
    const g = ref.current;
    if (!g) return;
    g.rotation.y += dt * 0.12;
    for (let i = 0; i < g.children.length; i++) {
      const c = g.children[i]!;
      c.position.y = 2.4 + Math.sin(pulse + i + g.rotation.y * 4) * 0.45;
    }
  });
  return (
    <group ref={ref}>
      {Array.from({ length: 10 }, (_, i) => {
        const a = (i / 10) * Math.PI * 2;
        return (
          <mesh key={i} position={[Math.cos(a) * 9, 2.4, Math.sin(a) * 9]}>
            <octahedronGeometry args={[0.28, 0]} />
            <meshPhysicalMaterial color={lamp} emissive={lamp} emissiveIntensity={0.8} roughness={0.2} metalness={0.4} />
          </mesh>
        );
      })}
    </group>
  );
}

function makeTerrain(worldId: WorldId, size: number, seg: number) {
  const geo = new THREE.PlaneGeometry(size, size, seg, seg);
  geo.rotateX(-Math.PI / 2);
  const pos = geo.attributes.position!;
  const col = new Float32Array(pos.count * 3);
  const cA = new THREE.Color("#6a7a38");
  const cB = new THREE.Color("#8a7048");
  const cC = new THREE.Color("#c8b8a0");
  const tmp = new THREE.Color();
  for (let i = 0; i < pos.count; i++) {
    const x = pos.getX(i);
    const z = pos.getZ(i);
    const y = heightAt(worldId, x, z);
    pos.setY(i, y);
    const t = THREE.MathUtils.clamp(y / 4.5, 0, 1);
    const n = Math.sin(x * 0.07) * Math.cos(z * 0.05) * 0.12;
    tmp.copy(cA).lerp(cB, Math.min(1, t * 1.4)).lerp(cC, Math.max(0, t - 0.45));
    tmp.offsetHSL(0, n, n * 0.4);
    col[i * 3] = tmp.r;
    col[i * 3 + 1] = tmp.g;
    col[i * 3 + 2] = tmp.b;
  }
  geo.setAttribute("color", new THREE.BufferAttribute(col, 3));
  geo.computeVertexNormals();
  return geo;
}

export function WorldScene({
  worldId,
  theme,
  pulse,
  weather,
  simRef,
}: {
  worldId: WorldId;
  theme: Theme;
  pulse: number;
  weather?: string;
  simRef: MutableRefObject<Sim>;
}) {
  const kit = worldKit(worldId);
  const quality = useOverlay((s) => s.quality);
  const q = qualityOpts(quality);
  const wx = weather ?? kit.weather;
  const terrain = useMemo(() => makeTerrain(worldId, 500, q.terrainSeg), [worldId, q.terrainSeg]);
  const maps = useMemo(() => {
    return {
      ground: tilePbr(worldId === "sovereign-ruins" ? pbrDirt("#8a7048") : pbrGrass(theme.ground), 28, 28),
      stone: tilePbr(pbrStone(theme.building), 8, 8),
    };
  }, [worldId, theme.ground, theme.building]);

  return (
    <>
      <pointLight color={theme.lamp} intensity={0.85} distance={18} position={[0, 3.4, 0]} />

      <mesh geometry={terrain} receiveShadow>
        <meshPhysicalMaterial
          color={theme.ground}
          map={maps.ground.map}
          normalMap={maps.ground.normalMap}
          roughnessMap={maps.ground.roughnessMap}
          roughness={1}
          metalness={0.03}
          vertexColors
          envMapIntensity={0.48}
        />
      </mesh>
      <mesh rotation={[-Math.PI / 2, 0, 0]} position={[0, 0.05, 0]} receiveShadow>
        <circleGeometry args={[worldId === "sovereign-ruins" ? 14 : 28, 36]} />
        <meshPhysicalMaterial
          color={worldId === "sovereign-ruins" ? "#7a6a50" : theme.building}
          map={worldId === "sovereign-ruins" ? maps.ground.map : maps.stone.map}
          normalMap={worldId === "sovereign-ruins" ? maps.ground.normalMap : maps.stone.normalMap}
          roughnessMap={worldId === "sovereign-ruins" ? maps.ground.roughnessMap : maps.stone.roughnessMap}
          roughness={1}
          metalness={0.03}
          clearcoat={worldId === "sovereign-ruins" ? 0 : 0.08}
          clearcoatRoughness={0.6}
          envMapIntensity={0.5}
        />
      </mesh>
      {worldId === "sovereign-ruins" ? null : (
      <mesh rotation={[-Math.PI / 2, 0, 0]} position={[0, 0.08, 0]}>
        <ringGeometry args={[1.6, 2.2, 28]} />
        <meshPhysicalMaterial color={theme.lamp} transparent opacity={0.35} side={THREE.DoubleSide} emissive={theme.lamp} emissiveIntensity={0.25} />
      </mesh>
      )}

      {kit.landmarks.map((l, i) => (
        <Landmark key={i} kind={l.kind} x={l.x} z={l.z} rot={l.rot} s={l.s} theme={theme} worldId={worldId} />
      ))}
      {loreStones(worldId).map((s) => (
        <Landmark key={s.id} kind="waystone" x={s.x} z={s.z} theme={theme} worldId={worldId} />
      ))}

      <HubPortal color={theme.lamp} ruined={worldId === "sovereign-ruins"} />
      <WeatherField weather={wx} lamp={theme.lamp} simRef={simRef} />
      {worldId === "lattice-crucible" ? <DriftField pulse={pulse} lamp={theme.lamp} /> : null}
      <LifeField worldId={worldId} theme={theme} simRef={simRef} />
    </>
  );
}
