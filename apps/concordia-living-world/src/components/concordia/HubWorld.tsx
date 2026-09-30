import { useMemo } from "react";
import * as THREE from "three";
import { GATES, RING_RADIUS, COURT_RADIUS, ARENA, WALL_RADIUS, type Theme } from "@/game/content";
import { HUB_LAYOUT } from "@/game/layout";
import { LitMesh } from "./Lit";
import { pbrBark, pbrBrick, pbrGrass, pbrLeaf, pbrPlaster, pbrRoad, pbrStone, tilePbr } from "@/game/pbr";

function plateTex(text: string, tint: string) {
  const c = document.createElement("canvas");
  c.width = 512;
  c.height = 128;
  const g = c.getContext("2d")!;
  g.clearRect(0, 0, 512, 128);
  g.fillStyle = "rgba(14,12,9,0.78)";
  g.beginPath();
  if (g.roundRect) g.roundRect(12, 20, 488, 88, 18);
  else g.rect(12, 20, 488, 88);
  g.fill();
  g.strokeStyle = tint;
  g.lineWidth = 4;
  g.stroke();
  g.fillStyle = "#f4ecda";
  g.font = "600 40px Outfit, Segoe UI, sans-serif";
  g.textAlign = "center";
  g.textBaseline = "middle";
  g.fillText(text, 256, 64);
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  t.needsUpdate = true;
  return t;
}

function Gate({
  angle,
  color,
  name,
  active,
  stone,
}: {
  angle: number;
  color: string;
  name: string;
  active: boolean;
  stone: ReturnType<typeof tilePbr>;
}) {
  const x = Math.cos(angle) * RING_RADIUS;
  const z = Math.sin(angle) * RING_RADIUS;
  const rot = -angle + Math.PI / 2;
  const tex = useMemo(() => plateTex(name, color), [name, color]);
  return (
    <group position={[x, 0, z]} rotation={[0, rot, 0]}>
      <LitMesh
        color="#cfc3a8"
        map={stone.map}
        normalMap={stone.normalMap}
        roughnessMap={stone.roughnessMap}
        surface="stone"
        position={[-1.65, 2.2, 0]}
        scale={[0.58, 4.4, 0.58]}
      >
        <boxGeometry args={[1, 1, 1]} />
      </LitMesh>
      <LitMesh
        color="#cfc3a8"
        map={stone.map}
        normalMap={stone.normalMap}
        roughnessMap={stone.roughnessMap}
        surface="stone"
        position={[1.65, 2.2, 0]}
        scale={[0.58, 4.4, 0.58]}
      >
        <boxGeometry args={[1, 1, 1]} />
      </LitMesh>
      <LitMesh
        color="#d8cbb0"
        map={stone.map}
        normalMap={stone.normalMap}
        roughnessMap={stone.roughnessMap}
        surface="stone"
        position={[0, 4.4, 0]}
        scale={[4.0, 0.52, 0.78]}
      >
        <boxGeometry args={[1, 1, 1]} />
      </LitMesh>
      <mesh position={[0, 2.25, 0]}>
        <planeGeometry args={[2.7, 3.7]} />
        <meshPhysicalMaterial
          color={color}
          transparent
          opacity={active ? 0.52 : 0.24}
          side={THREE.DoubleSide}
          depthWrite={false}
          roughness={0.15}
          metalness={0.05}
          emissive={color}
          emissiveIntensity={active ? 0.35 : 0.12}
          envMapIntensity={0.8}
        />
      </mesh>
      <mesh position={[0, 5.15, 0.12]}>
        <planeGeometry args={[4.4, 1.1]} />
        <meshBasicMaterial map={tex} transparent depthWrite={false} />
      </mesh>
      <mesh position={[0, 5.15, -0.12]} rotation={[0, Math.PI, 0]}>
        <planeGeometry args={[4.4, 1.1]} />
        <meshBasicMaterial map={tex} transparent depthWrite={false} />
      </mesh>
    </group>
  );
}

function Building({
  b,
  theme,
  brick,
  brick2,
}: {
  b: (typeof HUB_LAYOUT.buildings)[number];
  theme: Theme;
  brick: ReturnType<typeof tilePbr>;
  brick2: ReturnType<typeof tilePbr>;
}) {
  const color = b.variant % 2 === 0 ? theme.building : theme.building2;
  const map = b.variant % 2 === 0 ? brick : brick2;
  const hMul = theme.style === "neon" ? 1.7 : theme.style === "noir" ? 0.7 : theme.style === "arcology" ? 1.4 : 1;
  const wMul = theme.style === "neon" ? 0.72 : theme.style === "noir" ? 1.15 : 1;
  const h = b.h * hMul;
  const ww = b.w * wMul;
  const dd = b.d * wMul;
  const win = theme.style === "neon" ? theme.lamp : theme.style === "noir" ? "#c8a060" : "#6a8498";
  const rows = Math.max(2, Math.min(5, Math.floor(h / 1.35)));
  return (
    <group position={[b.x, 0, b.z]} rotation={[0, b.rot, 0]}>
      <LitMesh
        color={color}
        map={map.map}
        normalMap={map.normalMap}
        roughnessMap={map.roughnessMap}
        surface="stone"
        position={[0, h / 2, 0]}
        scale={[ww, h, dd]}
      >
        <boxGeometry args={[1, 1, 1]} />
      </LitMesh>
      <LitMesh color="#8a7a62" surface="stone" position={[0, h + 0.22, 0]} scale={[ww * 1.06, 0.38, dd * 1.06]}>
        <boxGeometry args={[1, 1, 1]} />
      </LitMesh>
      {theme.style === "neon" ? (
        <mesh position={[0, h * 0.55, dd * 0.51]}>
          <planeGeometry args={[ww * 0.7, h * 0.7]} />
          <meshPhysicalMaterial color={theme.lamp} transparent opacity={0.38} emissive={theme.lamp} emissiveIntensity={0.6} />
        </mesh>
      ) : (
        <>
          {Array.from({ length: rows }, (_, row) =>
            [-0.28, 0, 0.28].map((col) => (
              <mesh key={`${row}${col}`} position={[col * ww * 0.85, 1.15 + row * ((h - 1.6) / Math.max(1, rows - 1)), dd * 0.501]}>
                <planeGeometry args={[0.38, 0.48]} />
                <meshPhysicalMaterial
                  color={win}
                  roughness={0.18}
                  metalness={0.22}
                  emissive={win}
                  emissiveIntensity={0.22}
                  envMapIntensity={1.1}
                />
              </mesh>
            )),
          )}
          <mesh position={[0, 0.78, dd * 0.501]}>
            <planeGeometry args={[0.52, 1.45]} />
            <meshPhysicalMaterial color="#2a2218" roughness={0.7} />
          </mesh>
          {b.variant % 3 === 0 ? (
            <LitMesh color="#7a6a52" surface="stone" position={[ww * 0.18, h + 0.7, -dd * 0.12]} scale={[0.55, 0.7, 0.55]}>
              <boxGeometry args={[1, 1, 1]} />
            </LitMesh>
          ) : null}
        </>
      )}
    </group>
  );
}

function Tree({ x, z, s, bark, leaf }: { x: number; z: number; s: number; bark: ReturnType<typeof tilePbr>; leaf: ReturnType<typeof tilePbr> }) {
  return (
    <group position={[x, 0, z]} scale={s}>
      <LitMesh
        color="#6a4a28"
        map={bark.map}
        normalMap={bark.normalMap}
        roughnessMap={bark.roughnessMap}
        surface="foliage"
        position={[0, 1.05, 0]}
        scale={[0.36, 2.1, 0.36]}
      >
        <cylinderGeometry args={[0.5, 0.62, 1, 8]} />
      </LitMesh>
      <LitMesh
        color="#3f6a32"
        map={leaf.map}
        normalMap={leaf.normalMap}
        roughnessMap={leaf.roughnessMap}
        surface="foliage"
        position={[0, 2.45, 0]}
        scale={[1.75, 1.4, 1.75]}
      >
        <sphereGeometry args={[0.5, 12, 10]} />
      </LitMesh>
      <LitMesh color="#2f5a28" map={leaf.map} surface="foliage" position={[0.45, 2.15, 0.2]} scale={[1.05, 0.9, 1.05]}>
        <sphereGeometry args={[0.5, 10, 8]} />
      </LitMesh>
      <LitMesh color="#4a7a38" map={leaf.map} surface="foliage" position={[-0.38, 2.28, -0.24]} scale={[0.95, 0.82, 0.95]}>
        <sphereGeometry args={[0.5, 10, 8]} />
      </LitMesh>
    </group>
  );
}

function Lamp({ x, z, color }: { x: number; z: number; color: string }) {
  return (
    <group position={[x, 0, z]}>
      <LitMesh color="#3a3228" surface="metal" roughness={0.55} metalness={0.4} position={[0, 1.35, 0]} scale={[0.12, 2.7, 0.12]}>
        <cylinderGeometry args={[0.5, 0.5, 1, 8]} />
      </LitMesh>
      <mesh position={[0, 2.72, 0]}>
        <sphereGeometry args={[0.2, 10, 8]} />
        <meshPhysicalMaterial color={color} emissive={color} emissiveIntensity={1.4} roughness={0.2} transparent opacity={0.95} />
      </mesh>
      <pointLight color={color} intensity={1.15} distance={11} position={[0, 2.7, 0]} />
    </group>
  );
}

function Stall({ x, z, rot, theme }: { x: number; z: number; rot: number; theme: Theme }) {
  return (
    <group position={[x, 0, z]} rotation={[0, rot, 0]}>
      <LitMesh color="#6a4a28" surface="stone" position={[0, 0.55, 0]} scale={[2.2, 1.1, 1.4]}>
        <boxGeometry args={[1, 1, 1]} />
      </LitMesh>
      <LitMesh color={theme.building2} surface="cloth" position={[0, 1.55, 0]} rotation={[0, 0, 0.12]} scale={[2.5, 0.12, 1.7]}>
        <boxGeometry args={[1, 1, 1]} />
      </LitMesh>
    </group>
  );
}

export function HubWorld({ theme, pulse }: { theme: Theme; pulse: number }) {
  const maps = useMemo(() => {
    return {
      brick: tilePbr(pbrBrick("#8a5344"), 2.2, 3.4),
      brick2: tilePbr(pbrBrick("#6a4a38"), 2.4, 3.2),
      grass: tilePbr(pbrGrass("#6a7a38"), 18, 18),
      stone: tilePbr(pbrStone("#d4c6a8"), 6, 6),
      road: tilePbr(pbrRoad("#6a6458"), 8, 1.2),
      ring: tilePbr(pbrStone("#b8a888"), 14, 2),
      bark: tilePbr(pbrBark(), 1, 2),
      leaf: tilePbr(pbrLeaf(), 2, 2),
      plaster: tilePbr(pbrPlaster(theme.building), 2, 2),
    };
  }, [theme.building]);

  return (
    <>
      <pointLight color={theme.lamp} intensity={1.05} distance={20} position={[0, 3.2, 0]} />

      <mesh rotation={[-Math.PI / 2, 0, 0]} receiveShadow>
        <circleGeometry args={[WALL_RADIUS + 8, 64]} />
        <meshPhysicalMaterial
          color={theme.ground}
          map={maps.grass.map}
          normalMap={maps.grass.normalMap}
          roughnessMap={maps.grass.roughnessMap}
          roughness={1}
          metalness={0.02}
          envMapIntensity={0.5}
        />
      </mesh>

      <mesh rotation={[-Math.PI / 2, 0, 0]} position={[18, 0.04, 0]} receiveShadow>
        <planeGeometry args={[22, 4.2]} />
        <meshPhysicalMaterial
          color="#7a7468"
          map={maps.road.map}
          normalMap={maps.road.normalMap}
          roughnessMap={maps.road.roughnessMap}
          roughness={1}
          metalness={0.04}
          envMapIntensity={0.45}
        />
      </mesh>

      <mesh rotation={[-Math.PI / 2, 0, 0]} position={[0, 0.03, 0]} receiveShadow>
        <ringGeometry args={[RING_RADIUS - 1.8, RING_RADIUS + 1.8, 80]} />
        <meshPhysicalMaterial
          color="#8a7c58"
          map={maps.ring.map}
          normalMap={maps.ring.normalMap}
          roughnessMap={maps.ring.roughnessMap}
          roughness={1}
          metalness={0.04}
          side={THREE.DoubleSide}
          envMapIntensity={0.5}
        />
      </mesh>

      <mesh rotation={[-Math.PI / 2, 0, 0]} position={[0, 0.05, 0]} receiveShadow>
        <circleGeometry args={[COURT_RADIUS, 48]} />
        <meshPhysicalMaterial
          color="#d8c9a4"
          map={maps.stone.map}
          normalMap={maps.stone.normalMap}
          roughnessMap={maps.stone.roughnessMap}
          roughness={1}
          metalness={0.05}
          clearcoat={0.12}
          clearcoatRoughness={0.55}
          envMapIntensity={0.65}
        />
      </mesh>
      <mesh rotation={[-Math.PI / 2, 0, 0]} position={[0, 0.06, 0]}>
        <ringGeometry args={[COURT_RADIUS - 0.55, COURT_RADIUS, 48]} />
        <meshPhysicalMaterial color="#8a7a58" side={THREE.DoubleSide} roughness={0.7} metalness={0.08} />
      </mesh>

      {Array.from({ length: 12 }, (_, i) => {
        const a = (i / 12) * Math.PI * 2 + pulse * 0.08;
        return (
          <mesh key={`petal-${i}`} position={[Math.cos(a) * 1.15, 0.22, Math.sin(a) * 1.15]} rotation={[0.4, a, 0]}>
            <sphereGeometry args={[0.22, 8, 6]} />
            <meshPhysicalMaterial color={i % 2 ? "#c45a6a" : "#e8d080"} roughness={0.45} sheen={0.4} sheenColor={i % 2 ? "#c45a6a" : "#e8d080"} />
          </mesh>
        );
      })}

      <LitMesh
        color="#cfc3a8"
        map={maps.stone.map}
        normalMap={maps.stone.normalMap}
        roughnessMap={maps.stone.roughnessMap}
        surface="stone"
        position={[0, 0.5, 0]}
        scale={[1.8, 0.28, 1.8]}
      >
        <cylinderGeometry args={[0.5, 0.5, 1, 16]} />
      </LitMesh>
      <mesh position={[0, 0.95, 0]}>
        <sphereGeometry args={[0.32, 10, 8]} />
        <meshPhysicalMaterial color="#e8d8a0" emissive="#e8d8a0" emissiveIntensity={0.55} roughness={0.25} />
      </mesh>

      {GATES.map((g) => (
        <Gate
          key={g.id}
          angle={g.angle}
          color={g.color}
          name={g.name}
          active={theme.id !== "concordia-hub" ? g.worldId === theme.id : true}
          stone={maps.stone}
        />
      ))}

      {HUB_LAYOUT.buildings.map((b, i) => (
        <Building key={i} b={b} theme={theme} brick={maps.brick} brick2={maps.brick2} />
      ))}
      {HUB_LAYOUT.trees.map((t, i) => (
        <Tree key={i} x={t.x} z={t.z} s={t.s} bark={maps.bark} leaf={maps.leaf} />
      ))}
      {HUB_LAYOUT.lamps.map((l, i) => (
        <Lamp key={i} x={l.x} z={l.z} color={theme.lamp} />
      ))}
      {HUB_LAYOUT.stalls.map((s, i) => (
        <Stall key={i} x={s.x} z={s.z} rot={s.rot} theme={theme} />
      ))}

      <group position={[ARENA.x, 0, ARENA.z]}>
        <mesh rotation={[-Math.PI / 2, 0, 0]} position={[0, 0.04, 0]} receiveShadow>
          <circleGeometry args={[ARENA.r, 36]} />
          <meshPhysicalMaterial
            color="#c2a878"
            map={maps.stone.map}
            normalMap={maps.stone.normalMap}
            roughnessMap={maps.stone.roughnessMap}
            roughness={1}
            metalness={0.04}
          />
        </mesh>
        {Array.from({ length: 16 }, (_, i) => {
          const a = (i / 16) * Math.PI * 2;
          return (
            <LitMesh
              key={i}
              color="#b7a88a"
              map={maps.stone.map}
              normalMap={maps.stone.normalMap}
              roughnessMap={maps.stone.roughnessMap}
              surface="stone"
              position={[Math.cos(a) * ARENA.r, 0.45, Math.sin(a) * ARENA.r]}
              scale={[0.55, 0.9, 0.55]}
            >
              <boxGeometry args={[1, 1, 1]} />
            </LitMesh>
          );
        })}
      </group>

      <mesh rotation={[-Math.PI / 2, 0, 0]} position={[0, 0.9, 0]}>
        <ringGeometry args={[WALL_RADIUS - 0.7, WALL_RADIUS + 0.5, 72]} />
        <meshPhysicalMaterial
          color="#c8bca0"
          map={maps.stone.map}
          normalMap={maps.stone.normalMap}
          roughnessMap={maps.stone.roughnessMap}
          roughness={1}
          side={THREE.DoubleSide}
        />
      </mesh>
      {Array.from({ length: 10 }, (_, i) => {
        const a = (i / 10) * Math.PI * 2;
        return (
          <LitMesh
            key={i}
            color="#d0c4a8"
            map={maps.plaster.map}
            normalMap={maps.plaster.normalMap}
            roughnessMap={maps.plaster.roughnessMap}
            surface="stone"
            position={[Math.cos(a) * WALL_RADIUS, 3.4, Math.sin(a) * WALL_RADIUS]}
            scale={[2.4, 6.8, 2.4]}
          >
            <cylinderGeometry args={[0.5, 0.5, 1, 10]} />
          </LitMesh>
        );
      })}
    </>
  );
}
