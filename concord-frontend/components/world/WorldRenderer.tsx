/**
 * WorldRenderer — Three.js 3D World for Concord World Lens
 *
 * Renders the Global City with:
 * - District zones as colored ground planes with boundaries
 * - DTU objects as 3D entities in the world
 * - Workstation interaction points
 * - WASD + mouse movement controls
 * - LOD (Level of Detail) management
 * - Chunk-based loading for performance
 * - Minimap overlay
 *
 * Uses @react-three/fiber and @react-three/drei for React integration.
 */

import React, { useRef, useState, useEffect, useMemo, useCallback, Suspense } from "react";
import { Canvas, useFrame, useThree } from "@react-three/fiber";
import {
  Sky, Text, OrbitControls,
} from "@react-three/drei";
import * as THREE from "three";

// ── Constants ────────────────────────────────────────────────────────────────

const WORLD_SIZE = 4000;
const CHUNK_SIZE = 200;
const VIEW_DISTANCE = 1200;
const PLAYER_SPEED = 50;
const PLAYER_SPRINT_SPEED = 100;
const PLAYER_HEIGHT = 1.8;

const DISTRICT_COLORS: Record<string, string> = {
  CREATIVE_QUARTER: "#e74c3c",
  KNOWLEDGE_CAMPUS: "#3498db",
  PROFESSIONAL_PARK: "#2ecc71",
  CIVIC_CENTER: "#f39c12",
  NATURE_ZONE: "#27ae60",
};

const LOD_DISTANCES = {
  high: 200,
  medium: 600,
  low: 1200,
};

// ── Types ────────────────────────────────────────────────────────────────────

interface District {
  id: string;
  name: string;
  category: string;
  lens: string;
  description: string;
  position: { x: number; z: number };
  radius: number;
  landmarks: string[];
  workstations: string[];
}

interface WorldObject {
  id: string;
  type: string;
  position: { x: number; y: number; z: number };
  label?: string;
  color?: string;
  scale?: number;
}

interface PlayerState {
  position: THREE.Vector3;
  rotation: THREE.Euler;
  velocity: THREE.Vector3;
  currentDistrict: string | null;
  nearestWorkstation: string | null;
}

// ── Player Controller ────────────────────────────────────────────────────────

function PlayerController({
  onDistrictChange,
  onWorkstationNear,
  onPositionChange,
  districts,
}: {
  onDistrictChange: (districtId: string | null) => void;
  onWorkstationNear: (workstation: string | null) => void;
  onPositionChange?: (pos: { x: number; z: number }) => void;
  districts: District[];
}) {
  const { camera } = useThree();
  const keysRef = useRef<Set<string>>(new Set());
  const velocityRef = useRef(new THREE.Vector3());
  const positionRef = useRef(new THREE.Vector3(0, PLAYER_HEIGHT, 0));

  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent) => keysRef.current.add(e.key.toLowerCase());
    const onKeyUp = (e: KeyboardEvent) => keysRef.current.delete(e.key.toLowerCase());
    window.addEventListener("keydown", onKeyDown);
    window.addEventListener("keyup", onKeyUp);
    return () => {
      window.removeEventListener("keydown", onKeyDown);
      window.removeEventListener("keyup", onKeyUp);
    };
  }, []);

  useFrame((_state, delta) => {
    const keys = keysRef.current;
    const speed = keys.has("shift") ? PLAYER_SPRINT_SPEED : PLAYER_SPEED;
    const direction = new THREE.Vector3();

    if (keys.has("w") || keys.has("arrowup")) direction.z -= 1;
    if (keys.has("s") || keys.has("arrowdown")) direction.z += 1;
    if (keys.has("a") || keys.has("arrowleft")) direction.x -= 1;
    if (keys.has("d") || keys.has("arrowright")) direction.x += 1;

    if (direction.length() > 0) {
      direction.normalize();
      // Apply camera rotation to movement direction
      direction.applyQuaternion(camera.quaternion);
      direction.y = 0;
      direction.normalize();

      velocityRef.current.copy(direction).multiplyScalar(speed * delta);
      positionRef.current.add(velocityRef.current);

      // Clamp to world bounds
      const half = WORLD_SIZE / 2;
      positionRef.current.x = Math.max(-half, Math.min(half, positionRef.current.x));
      positionRef.current.z = Math.max(-half, Math.min(half, positionRef.current.z));
      positionRef.current.y = PLAYER_HEIGHT;

      camera.position.copy(positionRef.current);
      onPositionChange?.({ x: positionRef.current.x, z: positionRef.current.z });
    }

    // Check current district
    const px = positionRef.current.x;
    const pz = positionRef.current.z;
    let foundDistrict: string | null = null;

    for (const d of districts) {
      const dx = px - d.position.x;
      const dz = pz - d.position.z;
      if (Math.sqrt(dx * dx + dz * dz) <= d.radius) {
        foundDistrict = d.id;
        break;
      }
    }

    onDistrictChange(foundDistrict);

    // Check nearest workstation
    let nearest: string | null = null;
    const WORKSTATION_INTERACT_RANGE = 15;
    for (const d of districts) {
      for (let i = 0; i < d.workstations.length; i++) {
        const angle = ((i + 0.5) / d.workstations.length) * Math.PI * 2;
        const r = d.radius * 0.4;
        const wx = d.position.x + Math.cos(angle) * r;
        const wz = d.position.z + Math.sin(angle) * r;
        const dist = Math.sqrt((px - wx) ** 2 + (pz - wz) ** 2);
        if (dist <= WORKSTATION_INTERACT_RANGE) {
          nearest = d.workstations[i];
          break;
        }
      }
      if (nearest) break;
    }
    onWorkstationNear(nearest);
  });

  return null;
}

// ── District Zone ────────────────────────────────────────────────────────────

function DistrictZone({ district, lodLevel }: { district: District; lodLevel: "high" | "medium" | "low" }) {
  const color = DISTRICT_COLORS[district.category] || "#95a5a6";
  const segments = lodLevel === "high" ? 32 : lodLevel === "medium" ? 16 : 8;

  return (
    <group position={[district.position.x, 0.01, district.position.z]}>
      {/* Ground plane */}
      <mesh rotation={[-Math.PI / 2, 0, 0]}>
        <circleGeometry args={[district.radius, segments]} />
        <meshStandardMaterial
          color={color}
          transparent
          opacity={0.2}
          side={THREE.DoubleSide}
        />
      </mesh>

      {/* Border ring */}
      <mesh rotation={[-Math.PI / 2, 0, 0]}>
        <ringGeometry args={[district.radius - 2, district.radius, segments]} />
        <meshStandardMaterial color={color} transparent opacity={0.5} />
      </mesh>

      {/* District label */}
      {lodLevel !== "low" && (
        <Text
          position={[0, 15, 0]}
          fontSize={8}
          color={color}
          anchorX="center"
          anchorY="middle"
          outlineWidth={0.5}
          outlineColor="#000000"
        >
          {district.name}
        </Text>
      )}

      {/* Lens indicator */}
      {lodLevel === "high" && (
        <Text
          position={[0, 10, 0]}
          fontSize={4}
          color="#ecf0f1"
          anchorX="center"
          anchorY="middle"
        >
          [{district.lens}]
        </Text>
      )}

      {/* Landmark markers */}
      {lodLevel === "high" &&
        district.landmarks.map((landmark, i) => {
          const angle = (i / district.landmarks.length) * Math.PI * 2;
          const r = district.radius * 0.6;
          return (
            <group
              key={landmark}
              position={[Math.cos(angle) * r, 2, Math.sin(angle) * r]}
            >
              <mesh>
                <boxGeometry args={[4, 4, 4]} />
                <meshStandardMaterial color="#ecf0f1" />
              </mesh>
              <Text position={[0, 5, 0]} fontSize={2} color="#fff" anchorX="center">
                {landmark}
              </Text>
            </group>
          );
        })}

      {/* Workstation markers */}
      {lodLevel === "high" &&
        district.workstations.map((ws, i) => {
          const angle = ((i + 0.5) / district.workstations.length) * Math.PI * 2;
          const r = district.radius * 0.4;
          return (
            <group
              key={ws}
              position={[Math.cos(angle) * r, 1, Math.sin(angle) * r]}
            >
              <mesh>
                <cylinderGeometry args={[1.5, 1.5, 3, 8]} />
                <meshStandardMaterial color="#f1c40f" emissive="#f39c12" emissiveIntensity={0.3} />
              </mesh>
              <Text position={[0, 4, 0]} fontSize={1.5} color="#f1c40f" anchorX="center">
                {ws}
              </Text>
            </group>
          );
        })}
    </group>
  );
}

// ── World Object ─────────────────────────────────────────────────────────────

function WorldObjectMesh({ obj, onClick }: { obj: WorldObject; onClick?: (obj: WorldObject) => void }) {
  const scale = obj.scale || 1;
  const color = obj.color || "#3498db";

  const geometry = useMemo(() => {
    switch (obj.type) {
      case "dtu":
        return <octahedronGeometry args={[scale * 1.5, 0]} />;
      case "building":
        return <boxGeometry args={[scale * 4, scale * 8, scale * 4]} />;
      case "tree":
        return <coneGeometry args={[scale * 2, scale * 6, 6]} />;
      case "marker":
        return <sphereGeometry args={[scale, 8, 8]} />;
      default:
        return <boxGeometry args={[scale * 2, scale * 2, scale * 2]} />;
    }
  }, [obj.type, scale]);

  return (
    <group position={[obj.position.x, obj.position.y, obj.position.z]}>
      <mesh castShadow onClick={() => onClick?.(obj)}>
        {geometry}
        <meshStandardMaterial color={color} />
      </mesh>
      {obj.label && (
        <Text
          position={[0, scale * 5 + 2, 0]}
          fontSize={1.5}
          color="#fff"
          anchorX="center"
          outlineWidth={0.3}
          outlineColor="#000"
        >
          {obj.label}
        </Text>
      )}
    </group>
  );
}

// ── Ground Plane ─────────────────────────────────────────────────────────────

function Ground() {
  return (
    <mesh rotation={[-Math.PI / 2, 0, 0]} position={[0, 0, 0]} receiveShadow>
      <planeGeometry args={[WORLD_SIZE, WORLD_SIZE, 100, 100]} />
      <meshStandardMaterial
        color="#1a1a2e"
        roughness={0.9}
        metalness={0.1}
      />
    </mesh>
  );
}

// ── Grid Overlay ─────────────────────────────────────────────────────────────

function GridOverlay() {
  return (
    <gridHelper
      args={[WORLD_SIZE, WORLD_SIZE / CHUNK_SIZE, "#333355", "#222244"]}
      position={[0, 0.02, 0]}
    />
  );
}

// ── HUD Overlay ──────────────────────────────────────────────────────────────

interface HUDProps {
  currentDistrict: District | null;
  playerPosition: { x: number; z: number };
  fps: number;
}

function HUD({ currentDistrict, playerPosition, fps }: HUDProps) {
  return (
    <div
      style={{
        position: "absolute",
        top: 16,
        left: 16,
        color: "#ecf0f1",
        fontFamily: "monospace",
        fontSize: 14,
        background: "rgba(0,0,0,0.7)",
        padding: "12px 16px",
        borderRadius: 8,
        minWidth: 220,
        pointerEvents: "none",
        zIndex: 100,
      }}
    >
      <div style={{ fontWeight: "bold", fontSize: 16, marginBottom: 8 }}>
        CONCORD WORLD
      </div>
      <div>
        District:{" "}
        <span style={{ color: currentDistrict ? "#2ecc71" : "#e74c3c" }}>
          {currentDistrict?.name || "Wilderness"}
        </span>
      </div>
      {currentDistrict && (
        <div style={{ color: "#f39c12" }}>Lens: {currentDistrict.lens}</div>
      )}
      <div style={{ marginTop: 4, fontSize: 12, opacity: 0.7 }}>
        Pos: {Math.round(playerPosition.x)}, {Math.round(playerPosition.z)}
      </div>
      <div style={{ fontSize: 12, opacity: 0.5 }}>FPS: {fps}</div>
      <div style={{ marginTop: 8, fontSize: 11, opacity: 0.6 }}>
        WASD: Move | Shift: Sprint | Mouse: Look
      </div>
    </div>
  );
}

// ── Minimap ──────────────────────────────────────────────────────────────────

function Minimap({
  districts,
  playerPosition,
}: {
  districts: District[];
  playerPosition: { x: number; z: number };
}) {
  const size = 180;
  const scale = size / WORLD_SIZE;

  return (
    <div
      style={{
        position: "absolute",
        bottom: 16,
        right: 16,
        width: size,
        height: size,
        background: "rgba(0,0,0,0.8)",
        border: "2px solid #444",
        borderRadius: 8,
        overflow: "hidden",
        zIndex: 100,
        pointerEvents: "none",
      }}
    >
      <svg width={size} height={size} viewBox={`0 0 ${size} ${size}`}>
        {districts.map((d) => {
          const cx = (d.position.x + WORLD_SIZE / 2) * scale;
          const cy = (d.position.z + WORLD_SIZE / 2) * scale;
          const r = d.radius * scale;
          const color = DISTRICT_COLORS[d.category] || "#555";
          return (
            <circle
              key={d.id}
              cx={cx}
              cy={cy}
              r={r}
              fill={color}
              opacity={0.4}
              stroke={color}
              strokeWidth={1}
            />
          );
        })}
        {/* Player dot */}
        <circle
          cx={(playerPosition.x + WORLD_SIZE / 2) * scale}
          cy={(playerPosition.z + WORLD_SIZE / 2) * scale}
          r={3}
          fill="#fff"
          stroke="#000"
          strokeWidth={1}
        />
      </svg>
    </div>
  );
}

// ── Workstation Prompt ───────────────────────────────────────────────────────

function WorkstationPrompt({
  workstation,
  onActivate,
}: {
  workstation: string | null;
  onActivate: () => void;
}) {
  if (!workstation) return null;

  return (
    <div
      style={{
        position: "absolute",
        bottom: 100,
        left: "50%",
        transform: "translateX(-50%)",
        color: "#f1c40f",
        fontFamily: "monospace",
        fontSize: 16,
        background: "rgba(0,0,0,0.8)",
        padding: "12px 24px",
        borderRadius: 8,
        border: "1px solid #f39c12",
        cursor: "pointer",
        zIndex: 100,
      }}
      onClick={onActivate}
    >
      Press <strong>E</strong> to use {workstation}
    </div>
  );
}

// ── Main World Renderer ──────────────────────────────────────────────────────

interface WorldRendererProps {
  districts?: District[];
  objects?: WorldObject[];
  onDistrictEnter?: (district: District) => void;
  onWorkstationActivate?: (workstation: string, district: District) => void;
  onObjectClick?: (obj: WorldObject) => void;
  skyPreset?: "sunset" | "dawn" | "night" | "noon";
}

export default function WorldRenderer({
  districts = [],
  objects = [],
  onDistrictEnter,
  onWorkstationActivate,
  onObjectClick,
  skyPreset = "sunset",
}: WorldRendererProps) {
  const [currentDistrictId, setCurrentDistrictId] = useState<string | null>(null);
  const [nearestWorkstation, setNearestWorkstation] = useState<string | null>(null);
  const [playerPos, setPlayerPos] = useState({ x: 0, z: 0 });
  const [fps, setFps] = useState(60);
  const frameCountRef = useRef(0);
  const lastTimeRef = useRef(Date.now());

  const currentDistrict = useMemo(
    () => districts.find((d) => d.id === currentDistrictId) || null,
    [districts, currentDistrictId]
  );

  const handleDistrictChange = useCallback(
    (districtId: string | null) => {
      if (districtId !== currentDistrictId) {
        setCurrentDistrictId(districtId);
        if (districtId) {
          const d = districts.find((d) => d.id === districtId);
          if (d) onDistrictEnter?.(d);
        }
      }
    },
    [currentDistrictId, districts, onDistrictEnter]
  );

  // FPS counter
  useEffect(() => {
    const interval = setInterval(() => {
      const now = Date.now();
      const elapsed = (now - lastTimeRef.current) / 1000;
      setFps(Math.round(frameCountRef.current / elapsed));
      frameCountRef.current = 0;
      lastTimeRef.current = now;
    }, 1000);
    return () => clearInterval(interval);
  }, []);

  // Workstation activation via E key
  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if (e.key.toLowerCase() === "e" && nearestWorkstation && currentDistrict) {
        onWorkstationActivate?.(nearestWorkstation, currentDistrict);
      }
    };
    window.addEventListener("keydown", handler);
    return () => window.removeEventListener("keydown", handler);
  }, [nearestWorkstation, currentDistrict, onWorkstationActivate]);

  return (
    <div style={{ width: "100%", height: "100vh", position: "relative", background: "#000" }}>
      <HUD currentDistrict={currentDistrict} playerPosition={playerPos} fps={fps} />
      <Minimap districts={districts} playerPosition={playerPos} />
      <WorkstationPrompt
        workstation={nearestWorkstation}
        onActivate={() => {
          if (nearestWorkstation && currentDistrict) {
            onWorkstationActivate?.(nearestWorkstation, currentDistrict);
          }
        }}
      />

      <Canvas
        shadows
        camera={{
          position: [0, PLAYER_HEIGHT, 0],
          fov: 75,
          near: 0.1,
          far: VIEW_DISTANCE * 2,
        }}
        gl={{
          antialias: true,
          powerPreference: "high-performance",
          stencil: false,
        }}
        onCreated={({ gl }) => {
          gl.shadowMap.enabled = true;
          gl.shadowMap.type = THREE.PCFSoftShadowMap;
          gl.toneMapping = THREE.ACESFilmicToneMapping;
          gl.toneMappingExposure = 0.8;
        }}
      >
        <Suspense fallback={null}>
          {/* Lighting */}
          <ambientLight intensity={0.3} />
          <directionalLight
            position={[500, 300, 200]}
            intensity={1.2}
            castShadow
            shadow-mapSize-width={2048}
            shadow-mapSize-height={2048}
            shadow-camera-far={2000}
            shadow-camera-left={-500}
            shadow-camera-right={500}
            shadow-camera-top={500}
            shadow-camera-bottom={-500}
          />
          <pointLight position={[0, 50, 0]} intensity={0.5} color="#f39c12" />

          {/* Sky */}
          <Sky
            distance={450000}
            sunPosition={
              skyPreset === "noon"
                ? [0, 1, 0]
                : skyPreset === "dawn"
                ? [1, 0.1, 0]
                : skyPreset === "night"
                ? [0, -1, 0]
                : [1, 0.3, -0.5] // sunset
            }
            inclination={skyPreset === "night" ? 0 : 0.5}
            azimuth={0.25}
          />

          {/* Fog */}
          <fog attach="fog" args={["#1a1a2e", VIEW_DISTANCE * 0.5, VIEW_DISTANCE]} />

          {/* Ground */}
          <Ground />
          <GridOverlay />

          {/* Districts */}
          {districts.map((d) => (
            <DistrictZone key={d.id} district={d} lodLevel="high" />
          ))}

          {/* World Objects */}
          {objects.map((obj) => (
            <WorldObjectMesh key={obj.id} obj={obj} onClick={onObjectClick} />
          ))}

          {/* Player Controller */}
          <PlayerController
            districts={districts}
            onDistrictChange={handleDistrictChange}
            onWorkstationNear={setNearestWorkstation}
            onPositionChange={setPlayerPos}
          />

          {/* Camera Controls (orbit for now, WASD overrides) */}
          <OrbitControls
            enablePan={false}
            enableZoom={true}
            maxPolarAngle={Math.PI / 2 - 0.1}
            minDistance={5}
            maxDistance={100}
          />
        </Suspense>
      </Canvas>
    </div>
  );
}

// ── Named Exports ────────────────────────────────────────────────────────────

export { WORLD_SIZE, CHUNK_SIZE, VIEW_DISTANCE, DISTRICT_COLORS, LOD_DISTANCES };
export type { District, WorldObject, PlayerState, WorldRendererProps };
