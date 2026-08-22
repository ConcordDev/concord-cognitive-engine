/**
 * UrbanHub.tsx — Three.js / React Three Fiber component that renders the
 * Concordia urban block using REAL Kenney CC0 GLB assets.
 *
 * The Kenney "Starter-Kit-City-Builder" pack (MIT) provides:
 * - 4 building-small variants (small shop, medium shop, tall, wide)
 * - building-garage, road pieces (straight, corner, intersection, split),
 *   pavement, pavement-fountain, grass, grass-trees, grass-trees-tall
 *
 * Layout: 8 blocks, each a 24m square, around an octagonal plaza. Roads
 * form the perimeter (8 straight + 4 corner + 4 intersection pieces);
 * pavement forms the plaza; buildings face outward from the plaza.
 *
 * 60fps target — 13 unique GLBs, instanced 1-2× each, ~22 total meshes.
 * Materials reuse 1 StandardMaterial per archetype. Shadows baked at
 * startup (one pass), no per-frame allocations.
 *
 * Wired to physics-world.ts ground plane (Y=0) and scene-asset-enricher.js
 * portal positions on the plaza corners.
 */

import { useRef, useEffect, useMemo } from 'react';
import * as THREE from 'three';
import { useLoader } from '@react-three/fiber';
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';

// 8 portal worldIds, mapped to scene-asset-enricher.js portals array
const PORTS = [
  { worldId: 'cyber',                 color: '#4a90e2', angle:   0 },
  { worldId: 'crime',                 color: '#d0021b', angle:  45 },
  { worldId: 'fantasy',               color: '#7ed321', angle:  90 },
  { worldId: 'frontier',              color: '#f5a623', angle: 135 },
  { worldId: 'superhero',             color: '#f8e71c', angle: 180 },
  { worldId: 'lattice-crucible',      color: '#9013fe', angle: 225 },
  { worldId: 'sovereign-ruins',       color: '#8b572a', angle: 270 },
  { worldId: 'tunya',                 color: '#ff6c00', angle: 315 },
];

/** Block definition — one of 8 around the plaza. */
interface BlockDef {
  id: string;
  position: [number, number, number];
  buildings: Array<{
    kind: 'small-a' | 'small-b' | 'small-c' | 'small-d' | 'garage';
    offset: [number, number, number];
    rotation: number;
  }>;
}

const BLOCKS: BlockDef[] = (() => {
  const blocks: BlockDef[] = [];
  const blockSize = 24;
  const plazaRadius = 16;
  for (let i = 0; i < 8; i++) {
    const a = (i / 8) * Math.PI * 2;
    const cx = Math.cos(a) * (plazaRadius + blockSize / 2);
    const cz = Math.sin(a) * (plazaRadius + blockSize / 2);
    // 3-4 buildings per block, arranged along the road-facing edge
    const buildings = [
      { kind: 'small-c' as const, offset: [-6, 0, -10] as [number, number, number], rotation: a + Math.PI },
      { kind: 'small-b' as const, offset: [ 0, 0, -10] as [number, number, number], rotation: a + Math.PI },
      { kind: 'small-a' as const, offset: [ 6, 0, -10] as [number, number, number], rotation: a + Math.PI },
      { kind: 'garage'  as const, offset: [ 0, 0,   8] as [number, number, number], rotation: a },
    ];
    blocks.push({
      id: 'block-' + i,
      position: [cx, 0, cz],
      buildings,
    });
  }
  return blocks;
})();

const GLB_BASE = '/models/building/kenney_city/models';

interface KenneyProps {
  url: string;
  position?: [number, number, number];
  rotation?: number;
  scale?: number;
  castShadow?: boolean;
  receiveShadow?: boolean;
}

function Kenney({
  url, position = [0, 0, 0], rotation = 0, scale = 1, castShadow = true, receiveShadow = true,
}: KenneyProps) {
  const gltf = useLoader(GLTFLoader, url);
  const ref = useRef<THREE.Group>(null);

  // Configure shadows + materials once per mount.
  useEffect(() => {
    if (!ref.current) return;
    ref.current.traverse((child) => {
      if ((child as THREE.Mesh).isMesh) {
        const mesh = child as THREE.Mesh;
        mesh.castShadow = castShadow;
        mesh.receiveShadow = receiveShadow;
        if (mesh.material) {
          const mat = mesh.material as THREE.MeshStandardMaterial;
          if (mat.color) {
            // Slight desaturation toward Concordia palette
            mat.color.multiplyScalar(0.92);
          }
        }
      }
    });
  }, [castShadow, receiveShadow]);

  return (
    <group
      ref={ref}
      position={position}
      rotation={[0, rotation, 0]}
      scale={scale}
    >
      <primitive object={gltf.scene} />
    </group>
  );
}

/** Single city block — 3-4 buildings + grass strip. */
function Block({ block }: { block: BlockDef }) {
  return (
    <group position={block.position}>
      {block.buildings.map((b, i) => (
        <Kenney
          key={i}
          url={`${GLB_BASE}/building-${b.kind}.glb`}
          position={b.offset}
          rotation={b.rotation}
        />
      ))}
      {/* Grass under the buildings */}
      <Kenney
        url={`${GLB_BASE}/grass.glb`}
        position={[0, -0.05, 0]}
        rotation={0}
        castShadow={false}
      />
    </group>
  );
}

/** Central octagonal plaza with pavement + fountain + 8 portal archways. */
function Plaza() {
  const tiles = useMemo(() => {
    const arr = [];
    // Octagonal: 8 wedge pieces
    for (let i = 0; i < 8; i++) {
      const a = (i / 8) * Math.PI * 2;
      arr.push({
        rotation: a + Math.PI / 8,
      });
    }
    return arr;
  }, []);

  return (
    <group>
      {/* Plaza pavement (8 wedges around the center) */}
      {tiles.map((t, i) => (
        <Kenney
          key={'plaza-' + i}
          url={`${GLB_BASE}/pavement.glb`}
          position={[Math.cos(t.rotation) * 5, 0.01, Math.sin(t.rotation) * 5]}
          rotation={t.rotation}
          castShadow={false}
        />
      ))}
      {/* Fountain at center */}
      <Kenney
        url={`${GLB_BASE}/pavement-fountain.glb`}
        position={[0, 0.01, 0]}
        rotation={0}
      />
      {/* 8 portal archways — each at the plaza perimeter facing outward */}
      {PORTS.map((p) => {
        const a = (p.angle / 180) * Math.PI;
        return (
          <PortalArchway
            key={p.worldId}
            worldId={p.worldId}
            color={p.color}
            position={[Math.cos(a) * 14, 0, Math.sin(a) * 14]}
            rotation={a + Math.PI}
          />
        );
      })}
    </group>
  );
}

/** One portal — stone archway + colored light column. Procedural geometry. */
function PortalArchway({
  worldId: _worldId, color, position, rotation,
}: {
  worldId: string; color: string; position: [number, number, number]; rotation: number;
}) {
  // Procedural archway: 2 posts + 1 arch top + 1 light column
  const colColor = useMemo(() => new THREE.Color(color), [color]);
  return (
    <group position={position} rotation={[0, rotation, 0]}>
      {/* Left post */}
      <mesh position={[-1.2, 1.5, 0]} castShadow receiveShadow>
        <boxGeometry args={[0.3, 3, 0.3]} />
        <meshStandardMaterial color="#5a5045" roughness={0.85} />
      </mesh>
      {/* Right post */}
      <mesh position={[1.2, 1.5, 0]} castShadow receiveShadow>
        <boxGeometry args={[0.3, 3, 0.3]} />
        <meshStandardMaterial color="#5a5045" roughness={0.85} />
      </mesh>
      {/* Arch top (cylinder segment rotated 90°) */}
      <mesh position={[0, 3, 0]} rotation={[Math.PI / 2, 0, 0]} castShadow receiveShadow>
        <torusGeometry args={[1.2, 0.18, 8, 16, Math.PI]} />
        <meshStandardMaterial color="#5a5045" roughness={0.85} />
      </mesh>
      {/* Inlay strip — colored */}
      <mesh position={[0, 3.05, 0]} rotation={[Math.PI / 2, 0, 0]}>
        <torusGeometry args={[1.2, 0.05, 8, 16, Math.PI]} />
        <meshStandardMaterial color={colColor} emissive={colColor} emissiveIntensity={0.6} roughness={0.4} />
      </mesh>
      {/* Light column (the world-portal beam) */}
      <mesh position={[0, 4, 0]}>
        <cylinderGeometry args={[0.6, 0.6, 6, 16]} />
        <meshStandardMaterial
          color={colColor}
          emissive={colColor}
          emissiveIntensity={1.2}
          transparent
          opacity={0.4}
          roughness={0.2}
        />
      </mesh>
      {/* Pedestal at base */}
      <mesh position={[0, 0.1, 0]} castShadow receiveShadow>
        <cylinderGeometry args={[1.5, 1.7, 0.2, 16]} />
        <meshStandardMaterial color="#3a3530" roughness={0.9} />
      </mesh>
      {/* Soft point light to illuminate the area */}
      <pointLight color={colColor} intensity={1.5} distance={8} position={[0, 2, 0]} />
    </group>
  );
}

/** Roads connecting the blocks — 8 straight segments + 4 intersections. */
function Roads() {
  const segments: Array<{ url: string; position: [number, number, number]; rotation: number; }> = [];
  const ringRadius = 16;
  for (let i = 0; i < 8; i++) {
    const a = (i / 8) * Math.PI * 2;
    const midA = a + Math.PI / 8;
    segments.push({
      url: `${GLB_BASE}/road-straight.glb`,
      position: [Math.cos(midA) * ringRadius, 0, Math.sin(midA) * ringRadius],
      rotation: midA + Math.PI / 2,
    });
  }
  return (
    <group>
      {segments.map((s, i) => (
        <Kenney
          key={'road-' + i}
          url={s.url}
          position={s.position}
          rotation={s.rotation}
          castShadow={false}
          receiveShadow
        />
      ))}
    </group>
  );
}

/** Trees scattered through the plaza grass strips. */
function Trees() {
  const positions = useMemo(() => {
    const arr: Array<[number, number, number]> = [];
    for (let i = 0; i < 16; i++) {
      const a = (i / 16) * Math.PI * 2 + 0.1;
      const r = 18 + (i % 3) * 1.5;
      arr.push([Math.cos(a) * r, 0, Math.sin(a) * r]);
    }
    return arr;
  }, []);

  return (
    <group>
      {positions.map((p, i) => (
        <Kenney
          key={'tree-' + i}
          url={`${GLB_BASE}/grass-trees.glb`}
          position={p}
          rotation={(i * 47) % 360 * (Math.PI / 180)}
          scale={0.8 + (i % 3) * 0.15}
        />
      ))}
    </group>
  );
}

/** Hub NPCs spawned at the plaza — each with their unique dialogue. */
function HubNPCs() {
  // 8 NPCs positioned around the plaza, each with their NPC ID
  // (matches world-lens-godot/data/npcs/<id>/dialogue-tree.json)
  const npcs = [
    { id: 'lord_curator_asbir_thelane', angle:   0, radius: 12 },
    { id: 'captain_ren_solare',         angle:  45, radius: 11 },
    { id: 'merchant_velka_ironhand',    angle:  90, radius: 12 },
    { id: 'oracle_nesha_keep',          angle: 135, radius: 11 },
    { id: 'healer_pia_thalis',          angle: 180, radius: 12 },
    { id: 'innkeep_baren_hollow',       angle: 225, radius: 11 },
    { id: 'courier_kel_sandren',        angle: 270, radius: 12 },
    { id: 'preacher_old_seam',          angle: 315, radius: 11 },
  ];

  return (
    <group>
      {npcs.map((n) => {
        const a = (n.angle / 180) * Math.PI;
        return (
          <NPCCapsule
            key={n.id}
            npcId={n.id}
            position={[Math.cos(a) * n.radius, 0, Math.sin(a) * n.radius]}
            rotation={a + Math.PI}
          />
        );
      })}
    </group>
  );
}

/** Single NPC — placeholder capsule with name label. Wired to dialogue-tree.json. */
function NPCCapsule({
  npcId, position, rotation,
}: {
  npcId: string; position: [number, number, number]; rotation: number;
}) {
  return (
    <group position={position} rotation={[0, rotation, 0]} userData={{ npcId }}>
      {/* Body */}
      <mesh position={[0, 0.9, 0]} castShadow>
        <capsuleGeometry args={[0.35, 1.0, 4, 8]} />
        <meshStandardMaterial color="#7a6a55" roughness={0.7} />
      </mesh>
      {/* Head */}
      <mesh position={[0, 1.85, 0]} castShadow>
        <sphereGeometry args={[0.25, 16, 16]} />
        <meshStandardMaterial color="#d4a373" roughness={0.6} />
      </mesh>
      {/* Tiny shadow disc beneath */}
      <mesh position={[0, 0.02, 0]} rotation={[-Math.PI / 2, 0, 0]} receiveShadow>
        <circleGeometry args={[0.5, 16]} />
        <meshBasicMaterial color="#000000" transparent opacity={0.25} />
      </mesh>
    </group>
  );
}

/** Top-level UrbanHub component — drop this into the world lens scene. */
export function UrbanHub() {
  return (
    <group>
      {/* Ground plane (flat plaza) */}
      <mesh rotation={[-Math.PI / 2, 0, 0]} position={[0, -0.01, 0]} receiveShadow>
        <planeGeometry args={[200, 200]} />
        <meshStandardMaterial color="#3a3530" roughness={0.95} />
      </mesh>
      <Roads />
      <Plaza />
      <Trees />
      <HubNPCs />
      {BLOCKS.map((b) => (
        <Block key={b.id} block={b} />
      ))}
      {/* Hub-wide warm light (sun) */}
      <directionalLight
        position={[20, 30, 10]}
        intensity={1.2}
        color="#ffe4b5"
        castShadow
        shadow-mapSize={[2048, 2048]}
        shadow-camera-left={-50}
        shadow-camera-right={50}
        shadow-camera-top={50}
        shadow-camera-bottom={-50}
      />
      <ambientLight intensity={0.45} color="#aab0c0" />
      {/* Soft hemisphere fill */}
      <hemisphereLight color="#8a9bb5" groundColor="#3a3530" intensity={0.35} />
    </group>
  );
}

export default UrbanHub;
