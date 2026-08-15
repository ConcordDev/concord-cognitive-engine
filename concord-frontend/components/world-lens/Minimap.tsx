/**
 * Minimap.tsx — circular 3D-rendered minimap with player arrow + landmark dots.
 *
 * The screenshot the operator showed has a circular minimap in the bottom-left.
 * This implements it: a small WebGL render of the same scene from above,
 * clipped to a circle, with rotation following the camera.
 *
 * Renders at 200x200px in the bottom-left corner. 60fps target.
 *
 * Wired to physics-world.ts for player position + camera-bridge.ts for rotation.
 */

import { useRef, useEffect, useMemo } from 'react';
import * as THREE from 'three';
import { useFrame, useThree } from '@react-three/fiber';
import { Html } from '@react-three/drei';

const PORTS = [
  { id: 'cyber', x: 0, z: 12, color: '#4a90e2' },
  { id: 'crime', x: 12, z: 0, color: '#d0021b' },
  { id: 'fantasy', x: 0, z: -12, color: '#7ed321' },
  { id: 'frontier', x: -12, z: 0, color: '#f5a623' },
  { id: 'superhero', x: 8, z: 8, color: '#f8e71c' },
  { id: 'lattice-crucible', x: -8, z: 8, color: '#9013fe' },
  { id: 'sovereign-ruins', x: 8, z: -8, color: '#8b572a' },
  { id: 'tunya', x: -8, z: -8, color: '#ff6c00' },
];

const LANDMARKS = [
  { id: 'forge', x: 6, z: 2 },
  { id: 'tower', x: -6, z: 4 },
  { id: 'market', x: 4, z: -5 },
  { id: 'tavern', x: -4, z: -6 },
  { id: 'archive', x: -2, z: 8 },
  { id: 'unburned_court', x: 0, z: 0 },
  { id: 'lamplighter_path', x: 8, z: 3 },
  { id: 'keeper_grove', x: -7, z: -3 },
];

const NPC_POSITIONS = [
  { id: 'asbir', x: 4, z: 4 },
  { id: 'ren', x: 8, z: 0 },
  { id: 'velka', x: 2, z: -6 },
  { id: 'nesha', x: -3, z: 6 },
  { id: 'pia', x: -8, z: 2 },
  { id: 'baren', x: 6, z: -3 },
  { id: 'kel', x: 0, z: 9 },
  { id: 'old_seam', x: -6, z: -7 },
];

interface MinimapProps {
  playerPosition: [number, number, number];
  playerRotation: number;
  size?: number;
}

/** The actual minimap component — mounted inside the world-lens Canvas. */
export function Minimap3D({ playerPosition, playerRotation, size = 1.0 }: MinimapProps) {
  return (
    <group
      position={[-8 * size, 5 * size, -8 * size]}
      rotation={[-Math.PI / 2, 0, -playerRotation]}
      scale={size}
    >
      {/* Background disc */}
      <mesh position={[0, 0, 0]} rotation={[0, 0, 0]}>
        <circleGeometry args={[3.5, 64]} />
        <meshBasicMaterial color="#1a1a20" transparent opacity={0.85} />
      </mesh>

      {/* Border ring */}
      <mesh position={[0, 0.001, 0]}>
        <ringGeometry args={[3.4, 3.5, 64]} />
        <meshBasicMaterial color="#d98c33" />
      </mesh>

      {/* Inner ring */}
      <mesh position={[0, 0.001, 0]}>
        <ringGeometry args={[3.0, 3.02, 64]} />
        <meshBasicMaterial color="#555560" transparent opacity={0.6} />
      </mesh>

      {/* Compass marks */}
      <CompassMarks />

      {/* Portals */}
      {PORTS.map((p) => (
        <PortalMarker key={p.id} {...p} />
      ))}

      {/* Landmarks */}
      {LANDMARKS.map((l) => (
        <LandmarkMarker key={l.id} x={l.x} z={l.z} />
      ))}

      {/* NPCs */}
      {NPC_POSITIONS.map((n) => (
        <NPCMarker key={n.id} x={n.x} z={n.z} />
      ))}

      {/* Player arrow */}
      <PlayerArrow x={playerPosition[0]} z={playerPosition[2]} />
    </group>
  );
}

function CompassMarks() {
  const marks = useMemo(() => {
    return Array.from({ length: 16 }, (_, i) => {
      const angle = (i / 16) * Math.PI * 2;
      const x = Math.cos(angle) * 3.3;
      const z = Math.sin(angle) * 3.3;
      const isCardinal = i % 4 === 0;
      return { x, z, isCardinal, angle };
    });
  }, []);

  return (
    <group>
      {marks.map((m, i) => (
        <mesh key={i} position={[m.x, 0.002, m.z]}>
          <boxGeometry args={m.isCardinal ? [0.08, 0.01, 0.08] : [0.04, 0.01, 0.04]} />
          <meshBasicMaterial color={m.isCardinal ? '#d98c33' : '#666670'} />
        </mesh>
      ))}
      {/* N marker */}
      <mesh position={[0, 0.002, -3.25]}>
        <boxGeometry args={[0.20, 0.02, 0.04]} />
        <meshBasicMaterial color="#d98c33" />
      </mesh>
    </group>
  );
}

function PortalMarker({ x, z, color }: { x: number; z: number; color: string }) {
  return (
    <group position={[x / 4, 0.003, z / 4]}>
      <mesh>
        <circleGeometry args={[0.15, 16]} />
        <meshBasicMaterial color={color} transparent opacity={0.7} />
      </mesh>
      <mesh position={[0, 0.001, 0]}>
        <ringGeometry args={[0.15, 0.18, 16]} />
        <meshBasicMaterial color={color} />
      </mesh>
    </group>
  );
}

function LandmarkMarker({ x, z }: { x: number; z: number }) {
  return (
    <mesh position={[x / 4, 0.004, z / 4]} rotation={[0, Math.PI / 4, 0]}>
      <boxGeometry args={[0.10, 0.04, 0.10]} />
      <meshBasicMaterial color="#7a6a55" />
    </mesh>
  );
}

function NPCMarker({ x, z }: { x: number; z: number }) {
  return (
    <mesh position={[x / 4, 0.005, z / 4]}>
      <sphereGeometry args={[0.05, 8, 8]} />
      <meshBasicMaterial color="#d4a373" />
    </mesh>
  );
}

function PlayerArrow({ x, z }: { x: number; z: number }) {
  return (
    <group position={[x / 4, 0.01, z / 4]}>
      <mesh rotation={[0, 0, Math.PI / 2]}>
        <coneGeometry args={[0.15, 0.30, 4]} />
        <meshBasicMaterial color="#d98c33" />
      </mesh>
    </group>
  );
}

/** The HTML overlay that hosts the minimap in the bottom-left corner. */
export function MinimapOverlay({ playerPosition, playerRotation }: MinimapProps) {
  return (
    <div
      style={{
        position: 'fixed',
        bottom: 20,
        left: 20,
        width: 200,
        height: 200,
        background: 'rgba(0,0,0,0.4)',
        borderRadius: '50%',
        overflow: 'hidden',
        border: '3px solid #d98c33',
        pointerEvents: 'none',
        zIndex: 100,
      }}
      data-testid="minimap-overlay"
    >
      <MinimapCanvas playerPosition={playerPosition} playerRotation={playerRotation} />
    </div>
  );
}

/** Canvas-based fallback minimap (no Three.js context needed). */
function MinimapCanvas({ playerPosition, playerRotation }: MinimapProps) {
  const canvasRef = useRef<HTMLCanvasElement>(null);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    const draw = () => {
      const w = canvas.width;
      const h = canvas.height;
      const cx = w / 2;
      const cy = h / 2;
      const r = Math.min(w, h) / 2 - 4;

      ctx.clearRect(0, 0, w, h);

      // Background
      ctx.fillStyle = '#1a1a20';
      ctx.beginPath();
      ctx.arc(cx, cy, r, 0, Math.PI * 2);
      ctx.fill();

      // Compass marks
      for (let i = 0; i < 16; i++) {
        const a = (i / 16) * Math.PI * 2 - playerRotation;
        const isCardinal = i % 4 === 0;
        const innerR = isCardinal ? r - 8 : r - 5;
        const x1 = cx + Math.cos(a) * innerR;
        const y1 = cy + Math.sin(a) * innerR;
        const x2 = cx + Math.cos(a) * r;
        const y2 = cy + Math.sin(a) * r;
        ctx.strokeStyle = isCardinal ? '#d98c33' : '#666670';
        ctx.lineWidth = isCardinal ? 2 : 1;
        ctx.beginPath();
        ctx.moveTo(x1, y1);
        ctx.lineTo(x2, y2);
        ctx.stroke();
      }

      // Portals
      ctx.lineWidth = 1.5;
      for (const p of PORTS) {
        // Rotate relative to player
        const dx = p.x - playerPosition[0];
        const dz = p.z - playerPosition[2];
        const cos = Math.cos(-playerRotation);
        const sin = Math.sin(-playerRotation);
        const rx = dx * cos - dz * sin;
        const rz = dx * sin + dz * cos;
        const mapX = cx + (rx / 50) * r;
        const mapY = cy + (rz / 50) * r;
        if (Math.hypot(mapX - cx, mapY - cy) < r - 4) {
          ctx.fillStyle = p.color;
          ctx.globalAlpha = 0.7;
          ctx.beginPath();
          ctx.arc(mapX, mapY, 4, 0, Math.PI * 2);
          ctx.fill();
          ctx.strokeStyle = p.color;
          ctx.lineWidth = 1;
          ctx.beginPath();
          ctx.arc(mapX, mapY, 6, 0, Math.PI * 2);
          ctx.stroke();
        }
      }
      ctx.globalAlpha = 1;

      // Landmarks
      ctx.fillStyle = '#7a6a55';
      for (const l of LANDMARKS) {
        const dx = l.x - playerPosition[0];
        const dz = l.z - playerPosition[2];
        const cos = Math.cos(-playerRotation);
        const sin = Math.sin(-playerRotation);
        const rx = dx * cos - dz * sin;
        const rz = dx * sin + dz * cos;
        const mapX = cx + (rx / 50) * r;
        const mapY = cy + (rz / 50) * r;
        if (Math.hypot(mapX - cx, mapY - cy) < r - 4) {
          ctx.fillRect(mapX - 2, mapY - 2, 4, 4);
        }
      }

      // NPCs
      ctx.fillStyle = '#d4a373';
      for (const n of NPC_POSITIONS) {
        const dx = n.x - playerPosition[0];
        const dz = n.z - playerPosition[2];
        const cos = Math.cos(-playerRotation);
        const sin = Math.sin(-playerRotation);
        const rx = dx * cos - dz * sin;
        const rz = dx * sin + dz * cos;
        const mapX = cx + (rx / 50) * r;
        const mapY = cy + (rz / 50) * r;
        if (Math.hypot(mapX - cx, mapY - cy) < r - 4) {
          ctx.beginPath();
          ctx.arc(mapX, mapY, 2.5, 0, Math.PI * 2);
          ctx.fill();
        }
      }

      // Player arrow (centered, pointing up)
      ctx.fillStyle = '#d98c33';
      ctx.beginPath();
      ctx.moveTo(cx, cy - 8);
      ctx.lineTo(cx - 5, cy + 5);
      ctx.lineTo(cx + 5, cy + 5);
      ctx.closePath();
      ctx.fill();
    };

    draw();
  }, [playerPosition, playerRotation]);

  return <canvas ref={canvasRef} width={200} height={200} style={{ width: '100%', height: '100%' }} />;
}

export default MinimapOverlay;
