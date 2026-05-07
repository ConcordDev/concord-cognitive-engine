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
//
// Phase D scale-up: world bounds expanded from 4km to 20km. Existing chunk
// bookkeeping survives the change because chunks are computed from world
// position; we simply have more chunks now. Frustum culling + the existing
// LOD bands (kept unchanged) keep the render cost bounded. Vehicles can
// reach 150 m/s (planes) so VIEW_DISTANCE is bumped to keep approach
// detection viable; on weak machines this can be lowered without breaking
// gameplay because anti-cheat is server-side.

const WORLD_SIZE = 20000;
const CHUNK_SIZE = 1000;        // 1km terrain chunks → 20×20 grid
const VIEW_DISTANCE = 5000;     // 5km — enough to see an approaching plane in time
const PLAYER_SPEED = 50;
const PLAYER_SPRINT_SPEED = 100;
const PLAYER_HEIGHT = 1.8;
const ACTIVE_CHUNK_RADIUS = 1;  // 3×3 grid of chunks loaded around the camera

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

// ── Day / Night Cycle ───────────────────────────────────────────────────────
//
// Phase F fix 4: gives Concordia a real day/night cycle. Until now the
// world was eternal grey noon; the audit's World-life cell flagged this as
// the single biggest "feels lifeless" complaint.
//
// One in-world day = DAY_LENGTH_MS of real time (default 24 minutes).
// Sun orbits in a great circle east → up → west → down → up. Five color
// stops keyed off the cycle phase t ∈ [0,1):
//   t=0.00 dawn     warm orange  ambient 0.45  directional 0.9
//   t=0.25 noon     bright white ambient 0.55  directional 1.4
//   t=0.50 dusk     deep amber   ambient 0.40  directional 0.8
//   t=0.75 midnight cold blue    ambient 0.15  directional 0.25
//
// Throttled to ~10Hz state updates so drei's <Sky> doesn't re-render every
// frame. If skyPreset is provided as anything other than 'auto', the cycle
// is paused at that preset for backward compatibility with callers that
// want a fixed time-of-day.

const DAY_LENGTH_MS = 24 * 60 * 1000;

interface DayNightStop {
  t: number;
  sky:        [number, number, number]; // sunPosition vector
  ambient:    number;
  directional: number;
}

const DAY_NIGHT_STOPS: DayNightStop[] = [
  { t: 0.00, sky: [ 1.0, 0.10, 0.0],  ambient: 0.45, directional: 0.9  }, // dawn (east horizon)
  { t: 0.25, sky: [ 0.0, 1.00, 0.0],  ambient: 0.55, directional: 1.4  }, // noon (overhead)
  { t: 0.50, sky: [-1.0, 0.10, 0.0],  ambient: 0.40, directional: 0.8  }, // dusk (west horizon)
  { t: 0.75, sky: [ 0.0, -1.0, 0.0],  ambient: 0.15, directional: 0.25 }, // midnight (below)
];

function lerp(a: number, b: number, k: number): number { return a + (b - a) * k; }
function lerp3(a: [number, number, number], b: [number, number, number], k: number): [number, number, number] {
  return [lerp(a[0], b[0], k), lerp(a[1], b[1], k), lerp(a[2], b[2], k)];
}

function sampleDayNight(t: number): { sky: [number, number, number]; ambient: number; directional: number } {
  // Wrap to [0,1)
  const phase = ((t % 1) + 1) % 1;
  // Find adjacent stops
  let i = 0;
  for (; i < DAY_NIGHT_STOPS.length - 1; i++) {
    if (phase < DAY_NIGHT_STOPS[i + 1].t) break;
  }
  const a = DAY_NIGHT_STOPS[i];
  const b = DAY_NIGHT_STOPS[(i + 1) % DAY_NIGHT_STOPS.length];
  const span = (b.t > a.t ? b.t : b.t + 1) - a.t;
  const k = span === 0 ? 0 : (phase - a.t) / span;
  return {
    sky:         lerp3(a.sky, b.sky, k),
    ambient:     lerp(a.ambient, b.ambient, k),
    directional: lerp(a.directional, b.directional, k),
  };
}

interface DayNightCycleProps {
  skyPreset?: "auto" | "sunset" | "dawn" | "night" | "noon";
  startedAt?: number; // epoch ms — used so all clients see the same time-of-day
}

function DayNightCycle({ skyPreset = "auto", startedAt }: DayNightCycleProps) {
  const [sample, setSample] = useState(() => sampleDayNight(0));
  const lastUpdateRef = useRef(0);
  const startRef      = useRef(startedAt ?? Date.now());

  // Subscribe to server-broadcast world clock so all clients see exactly the
  // same time-of-day. Falls back to local Date.now() if the server hasn't
  // emitted yet.
  useEffect(() => {
    const handler = (e: Event) => {
      const detail = (e as CustomEvent).detail as { epochMs?: number; dayLengthMs?: number } | undefined;
      if (detail?.epochMs)     startRef.current = detail.epochMs;
      // If server reports a non-default day length, honor it locally.
      // (We don't reassign DAY_LENGTH_MS here; a future enhancement could
      // dispatch a context event for renderer-wide consumption.)
    };
    window.addEventListener("concordia:world-clock", handler);
    return () => window.removeEventListener("concordia:world-clock", handler);
  }, []);

  useFrame(() => {
    if (skyPreset !== "auto") return;
    const now = performance.now();
    if (now - lastUpdateRef.current < 100) return; // ~10Hz
    lastUpdateRef.current = now;
    const t = ((Date.now() - startRef.current) % DAY_LENGTH_MS) / DAY_LENGTH_MS;
    setSample(sampleDayNight(t));
  });

  // Backward-compat presets (paused cycle).
  let sky:         [number, number, number] = sample.sky;
  let ambient:     number = sample.ambient;
  let directional: number = sample.directional;
  if (skyPreset === "noon")    { sky = [0, 1, 0];     ambient = 0.55; directional = 1.4; }
  if (skyPreset === "dawn")    { sky = [1, 0.1, 0];   ambient = 0.45; directional = 0.9; }
  if (skyPreset === "sunset")  { sky = [1, 0.3, -0.5]; ambient = 0.40; directional = 0.8; }
  if (skyPreset === "night")   { sky = [0, -1, 0];    ambient = 0.15; directional = 0.25; }

  return (
    <>
      <ambientLight intensity={ambient} />
      <directionalLight
        position={[sky[0] * 500, Math.max(50, sky[1] * 300), sky[2] * 200]}
        intensity={directional}
        castShadow
        shadow-mapSize-width={2048}
        shadow-mapSize-height={2048}
        shadow-camera-far={2000}
        shadow-camera-left={-500}
        shadow-camera-right={500}
        shadow-camera-top={500}
        shadow-camera-bottom={-500}
      />
      <Sky distance={450000} sunPosition={sky} inclination={0.5} azimuth={0.25} />
    </>
  );
}

// ── Chunk Streamer ──────────────────────────────────────────────────────────
//
// Phase F fix 7: with WORLD_SIZE=20km the entire world cannot be rendered at
// once on weak hardware. ChunkStreamer keeps only the (2*radius+1)² grid of
// chunks around the player active, filtering districts and world objects
// by position. Cheap: filters a JS array per render pass and lets React
// reconcile the diff. ACTIVE_CHUNK_RADIUS=1 → 3×3 grid → ~9 km² loaded.
//
// Coordinates: world center is (0,0). Chunk index for a position p is
//   Math.floor((p + WORLD_SIZE/2) / CHUNK_SIZE).
// Inputs that lack a position default to the world center so legacy data
// without coords still appears (graceful degradation).

interface ChunkStreamerProps {
  playerPos: { x: number; z: number };
  districts: District[];
  objects: WorldObject[];
  chunkRadius?: number;
  onObjectClick?: (obj: WorldObject) => void;
}

function chunkIndex(p: number): number {
  return Math.floor((p + WORLD_SIZE / 2) / CHUNK_SIZE);
}

function isWithinActiveChunk(
  pos: { x: number; z: number } | undefined,
  cx: number,
  cz: number,
  radius: number
): boolean {
  if (!pos) return true; // missing coords → always show, never accidentally cull
  const ix = chunkIndex(pos.x);
  const iz = chunkIndex(pos.z);
  return Math.abs(ix - cx) <= radius && Math.abs(iz - cz) <= radius;
}

function ChunkStreamer({
  playerPos,
  districts,
  objects,
  chunkRadius = ACTIVE_CHUNK_RADIUS,
  onObjectClick,
}: ChunkStreamerProps) {
  const cx = chunkIndex(playerPos.x);
  const cz = chunkIndex(playerPos.z);

  const visibleDistricts = districts.filter((d) =>
    isWithinActiveChunk(d.position ? { x: d.position.x, z: d.position.z } : undefined, cx, cz, chunkRadius)
  );
  const visibleObjects = objects.filter((obj) =>
    isWithinActiveChunk(obj.position ? { x: obj.position.x, z: obj.position.z } : undefined, cx, cz, chunkRadius)
  );

  return (
    <>
      {visibleDistricts.map((d) => (
        <DistrictZone key={d.id} district={d} lodLevel="high" />
      ))}
      {visibleObjects.map((obj) => (
        <WorldObjectMesh key={obj.id} obj={obj} onClick={onObjectClick} />
      ))}
    </>
  );
}

// ── Main World Renderer ──────────────────────────────────────────────────────

interface WorldRendererProps {
  districts?: District[];
  objects?: WorldObject[];
  onDistrictEnter?: (district: District) => void;
  onWorkstationActivate?: (workstation: string, district: District) => void;
  onObjectClick?: (obj: WorldObject) => void;
  /** 'auto' (default) runs the live day/night cycle. Any other value pins the sky to that preset. */
  skyPreset?: "auto" | "sunset" | "dawn" | "night" | "noon";
}

export default function WorldRenderer({
  districts = [],
  objects = [],
  onDistrictEnter,
  onWorkstationActivate,
  onObjectClick,
  skyPreset = "auto",
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
          {/* Lighting + sky driven by the day/night cycle. Setting skyPreset
              to a fixed value (the original behavior) pauses the cycle there
              for backward compat; the default 'auto' lets the cycle run. */}
          <DayNightCycle skyPreset={skyPreset === "auto" ? "auto" : skyPreset} />
          <pointLight position={[0, 50, 0]} intensity={0.5} color="#f39c12" />

          {/* Fog */}
          <fog attach="fog" args={["#1a1a2e", VIEW_DISTANCE * 0.5, VIEW_DISTANCE]} />

          {/* Ground */}
          <Ground />
          <GridOverlay />

          {/* Districts + World Objects, streamed by ChunkStreamer so only
              the chunks within ACTIVE_CHUNK_RADIUS of the player are mounted */}
          <ChunkStreamer
            playerPos={playerPos}
            districts={districts}
            objects={objects}
            chunkRadius={ACTIVE_CHUNK_RADIUS}
            onObjectClick={onObjectClick}
          />

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
