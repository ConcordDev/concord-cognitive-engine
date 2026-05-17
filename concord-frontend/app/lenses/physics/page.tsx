'use client';

import { useLensNav } from '@/hooks/useLensNav';
import { useLensCommand } from '@/hooks/useLensCommand';
import { LensShell } from '@/components/lens/LensShell';
import { RecentMineCard } from '@/components/lens/RecentMineCard';
import { FirstRunTour } from '@/components/lens/FirstRunTour';
import { DepthBadge } from '@/components/lens/DepthBadge';
import { PhysicsArxiv } from '@/components/physics/PhysicsArxiv';
import { UniversalActions } from '@/components/lens/UniversalActions';
import { SubLensQuickNav } from '@/components/lens/SubLensQuickNav';
import { useState, useRef, useEffect, useCallback } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import {
  Play,
  Pause,
  RotateCcw,
  Settings,
  Gauge,
  Circle,
  Square,
  Trash2,
  Link2,
  Zap,
  Download,
  Upload,
  ChevronDown,
  Move,
  Target,
  Magnet,
  Layers,
  Loader2,
} from 'lucide-react';
import { useRunArtifact } from '@/lib/hooks/use-lens-artifacts';
import { ErrorState } from '@/components/common/EmptyState';
import { useLensData } from '@/lib/hooks/use-lens-data';
import { useRealtimeLens } from '@/hooks/useRealtimeLens';
import { LiveIndicator } from '@/components/lens/LiveIndicator';
import { DTUExportButton } from '@/components/lens/DTUExportButton';
import { RealtimeDataPanel } from '@/components/lens/RealtimeDataPanel';
import { LensFeaturePanel } from '@/components/lens/LensFeaturePanel';
import LiveFeed, { adaptToLiveFeedArticles } from '@/components/lens/LiveFeed';
import PhysicsWorkbench from '@/components/physics/PhysicsWorkbench';
import { PhysicsActionPanel } from '@/components/physics/PhysicsActionPanel';
import { PipingProvider } from '@/components/panel-polish';

// Physics body types
interface Vector2D {
  x: number;
  y: number;
}

interface Body {
  id: string;
  type: 'circle' | 'rectangle' | 'polygon';
  position: Vector2D;
  velocity: Vector2D;
  acceleration: Vector2D;
  mass: number;
  restitution: number; // Bounciness 0-1
  friction: number;
  radius?: number; // For circles
  width?: number;  // For rectangles
  height?: number;
  vertices?: Vector2D[]; // For polygons
  rotation: number;
  angularVelocity: number;
  isStatic: boolean;
  color: string;
  trail: Vector2D[];
  name: string;
  pinned: boolean;
}

interface Constraint {
  id: string;
  type: 'spring' | 'rigid' | 'rope';
  bodyA: string;
  bodyB: string;
  restLength: number;
  stiffness: number;
  damping: number;
  color: string;
}

interface ForceField {
  id: string;
  type: 'gravity' | 'wind' | 'attractor' | 'repulsor';
  position: Vector2D;
  strength: number;
  radius: number;
  active: boolean;
}

type Tool = 'select' | 'circle' | 'rectangle' | 'polygon' | 'spring' | 'force' | 'delete';

interface Preset {
  name: string;
  icon: string;
  bodies: Partial<Body>[];
  constraints?: Partial<Constraint>[];
  forceFields?: Partial<ForceField>[];
  settings?: Partial<SimSettings>;
}

interface SimSettings {
  gravity: Vector2D;
  airFriction: number;
  timeScale: number;
  substeps: number;
  showVectors: boolean;
  showTrails: boolean;
  showForces: boolean;
  trailLength: number;
  wallBounce: boolean;
}

const COLORS = [
  '#00ffff', '#ff00ff', '#00ff88', '#ffaa00', '#ff4488',
  '#44aaff', '#ff6644', '#88ff44', '#aa44ff', '#ffff44'
];

const generateId = () => Math.random().toString(36).substr(2, 9);

const PRESETS: Preset[] = [
  {
    name: 'Solar System',
    icon: '🌍',
    bodies: [
      { type: 'circle', position: { x: 400, y: 300 }, velocity: { x: 0, y: 0 }, mass: 1000, radius: 40, isStatic: true, color: '#ffcc00', name: 'Sun' },
      { type: 'circle', position: { x: 500, y: 300 }, velocity: { x: 0, y: -4 }, mass: 1, radius: 8, color: '#8888ff', name: 'Mercury' },
      { type: 'circle', position: { x: 560, y: 300 }, velocity: { x: 0, y: -3.5 }, mass: 2, radius: 10, color: '#ffaa44', name: 'Venus' },
      { type: 'circle', position: { x: 640, y: 300 }, velocity: { x: 0, y: -3 }, mass: 3, radius: 12, color: '#4488ff', name: 'Earth' },
      { type: 'circle', position: { x: 740, y: 300 }, velocity: { x: 0, y: -2.5 }, mass: 1.5, radius: 9, color: '#ff4444', name: 'Mars' },
    ],
    forceFields: [
      { type: 'attractor', position: { x: 400, y: 300 }, strength: 500, radius: 500, active: true }
    ],
    settings: { gravity: { x: 0, y: 0 }, wallBounce: false }
  },
  {
    name: 'Billiards',
    icon: '🎱',
    bodies: [
      { type: 'circle', position: { x: 200, y: 300 }, velocity: { x: 8, y: 0.5 }, mass: 1, radius: 15, color: '#ffffff', name: 'Cue Ball', restitution: 0.95 },
      { type: 'circle', position: { x: 500, y: 300 }, velocity: { x: 0, y: 0 }, mass: 1, radius: 15, color: '#ff0000', name: 'Ball 1', restitution: 0.95 },
      { type: 'circle', position: { x: 530, y: 283 }, velocity: { x: 0, y: 0 }, mass: 1, radius: 15, color: '#ffff00', name: 'Ball 2', restitution: 0.95 },
      { type: 'circle', position: { x: 530, y: 317 }, velocity: { x: 0, y: 0 }, mass: 1, radius: 15, color: '#0000ff', name: 'Ball 3', restitution: 0.95 },
      { type: 'circle', position: { x: 560, y: 266 }, velocity: { x: 0, y: 0 }, mass: 1, radius: 15, color: '#ff00ff', name: 'Ball 4', restitution: 0.95 },
      { type: 'circle', position: { x: 560, y: 300 }, velocity: { x: 0, y: 0 }, mass: 1, radius: 15, color: '#00ff00', name: 'Ball 5', restitution: 0.95 },
      { type: 'circle', position: { x: 560, y: 334 }, velocity: { x: 0, y: 0 }, mass: 1, radius: 15, color: '#ff8800', name: 'Ball 6', restitution: 0.95 },
    ],
    settings: { gravity: { x: 0, y: 0 }, airFriction: 0.01, wallBounce: true }
  },
  {
    name: 'Newton Cradle',
    icon: '⚖️',
    bodies: [
      { type: 'circle', position: { x: 300, y: 100 }, velocity: { x: 0, y: 0 }, mass: 1000, radius: 5, isStatic: true, color: '#888888', name: 'Pivot 1' },
      { type: 'circle', position: { x: 350, y: 100 }, velocity: { x: 0, y: 0 }, mass: 1000, radius: 5, isStatic: true, color: '#888888', name: 'Pivot 2' },
      { type: 'circle', position: { x: 400, y: 100 }, velocity: { x: 0, y: 0 }, mass: 1000, radius: 5, isStatic: true, color: '#888888', name: 'Pivot 3' },
      { type: 'circle', position: { x: 450, y: 100 }, velocity: { x: 0, y: 0 }, mass: 1000, radius: 5, isStatic: true, color: '#888888', name: 'Pivot 4' },
      { type: 'circle', position: { x: 500, y: 100 }, velocity: { x: 0, y: 0 }, mass: 1000, radius: 5, isStatic: true, color: '#888888', name: 'Pivot 5' },
      { type: 'circle', position: { x: 220, y: 250 }, velocity: { x: 0, y: 0 }, mass: 5, radius: 20, color: '#00ffff', name: 'Ball 1', restitution: 1 },
      { type: 'circle', position: { x: 350, y: 300 }, velocity: { x: 0, y: 0 }, mass: 5, radius: 20, color: '#00ffff', name: 'Ball 2', restitution: 1 },
      { type: 'circle', position: { x: 400, y: 300 }, velocity: { x: 0, y: 0 }, mass: 5, radius: 20, color: '#00ffff', name: 'Ball 3', restitution: 1 },
      { type: 'circle', position: { x: 450, y: 300 }, velocity: { x: 0, y: 0 }, mass: 5, radius: 20, color: '#00ffff', name: 'Ball 4', restitution: 1 },
      { type: 'circle', position: { x: 500, y: 300 }, velocity: { x: 0, y: 0 }, mass: 5, radius: 20, color: '#00ffff', name: 'Ball 5', restitution: 1 },
    ],
    constraints: [
      { type: 'rigid', bodyA: 'Pivot 1', bodyB: 'Ball 1', restLength: 200, stiffness: 1, damping: 0 },
      { type: 'rigid', bodyA: 'Pivot 2', bodyB: 'Ball 2', restLength: 200, stiffness: 1, damping: 0 },
      { type: 'rigid', bodyA: 'Pivot 3', bodyB: 'Ball 3', restLength: 200, stiffness: 1, damping: 0 },
      { type: 'rigid', bodyA: 'Pivot 4', bodyB: 'Ball 4', restLength: 200, stiffness: 1, damping: 0 },
      { type: 'rigid', bodyA: 'Pivot 5', bodyB: 'Ball 5', restLength: 200, stiffness: 1, damping: 0 },
    ],
    settings: { gravity: { x: 0, y: 9.8 }, airFriction: 0 }
  },
  {
    name: 'Bouncing Balls',
    icon: '🏀',
    bodies: Array.from({ length: 15 }, (_, i) => ({
      type: 'circle' as const,
      position: { x: 100 + (i % 5) * 150, y: 100 + Math.floor(i / 5) * 100 },
      velocity: { x: (Math.random() - 0.5) * 4, y: (Math.random() - 0.5) * 4 },
      mass: 1 + Math.random() * 2,
      radius: 15 + Math.random() * 20,
      color: COLORS[i % COLORS.length],
      name: `Ball ${i + 1}`,
      restitution: 0.9
    })),
    settings: { gravity: { x: 0, y: 9.8 }, wallBounce: true }
  },
  {
    name: 'Soft Body',
    icon: '🫧',
    bodies: [
      { type: 'circle', position: { x: 350, y: 200 }, mass: 1, radius: 10, color: '#ff00ff', name: 'N1' },
      { type: 'circle', position: { x: 400, y: 200 }, mass: 1, radius: 10, color: '#ff00ff', name: 'N2' },
      { type: 'circle', position: { x: 450, y: 200 }, mass: 1, radius: 10, color: '#ff00ff', name: 'N3' },
      { type: 'circle', position: { x: 350, y: 250 }, mass: 1, radius: 10, color: '#ff00ff', name: 'N4' },
      { type: 'circle', position: { x: 400, y: 250 }, mass: 1, radius: 10, color: '#ff00ff', name: 'N5' },
      { type: 'circle', position: { x: 450, y: 250 }, mass: 1, radius: 10, color: '#ff00ff', name: 'N6' },
      { type: 'circle', position: { x: 350, y: 300 }, mass: 1, radius: 10, color: '#ff00ff', name: 'N7' },
      { type: 'circle', position: { x: 400, y: 300 }, mass: 1, radius: 10, color: '#ff00ff', name: 'N8' },
      { type: 'circle', position: { x: 450, y: 300 }, mass: 1, radius: 10, color: '#ff00ff', name: 'N9' },
    ],
    constraints: [
      // Horizontal
      { type: 'spring', bodyA: 'N1', bodyB: 'N2', restLength: 50, stiffness: 0.5, damping: 0.1 },
      { type: 'spring', bodyA: 'N2', bodyB: 'N3', restLength: 50, stiffness: 0.5, damping: 0.1 },
      { type: 'spring', bodyA: 'N4', bodyB: 'N5', restLength: 50, stiffness: 0.5, damping: 0.1 },
      { type: 'spring', bodyA: 'N5', bodyB: 'N6', restLength: 50, stiffness: 0.5, damping: 0.1 },
      { type: 'spring', bodyA: 'N7', bodyB: 'N8', restLength: 50, stiffness: 0.5, damping: 0.1 },
      { type: 'spring', bodyA: 'N8', bodyB: 'N9', restLength: 50, stiffness: 0.5, damping: 0.1 },
      // Vertical
      { type: 'spring', bodyA: 'N1', bodyB: 'N4', restLength: 50, stiffness: 0.5, damping: 0.1 },
      { type: 'spring', bodyA: 'N2', bodyB: 'N5', restLength: 50, stiffness: 0.5, damping: 0.1 },
      { type: 'spring', bodyA: 'N3', bodyB: 'N6', restLength: 50, stiffness: 0.5, damping: 0.1 },
      { type: 'spring', bodyA: 'N4', bodyB: 'N7', restLength: 50, stiffness: 0.5, damping: 0.1 },
      { type: 'spring', bodyA: 'N5', bodyB: 'N8', restLength: 50, stiffness: 0.5, damping: 0.1 },
      { type: 'spring', bodyA: 'N6', bodyB: 'N9', restLength: 50, stiffness: 0.5, damping: 0.1 },
      // Diagonal
      { type: 'spring', bodyA: 'N1', bodyB: 'N5', restLength: 70, stiffness: 0.3, damping: 0.1 },
      { type: 'spring', bodyA: 'N2', bodyB: 'N4', restLength: 70, stiffness: 0.3, damping: 0.1 },
      { type: 'spring', bodyA: 'N2', bodyB: 'N6', restLength: 70, stiffness: 0.3, damping: 0.1 },
      { type: 'spring', bodyA: 'N3', bodyB: 'N5', restLength: 70, stiffness: 0.3, damping: 0.1 },
      { type: 'spring', bodyA: 'N4', bodyB: 'N8', restLength: 70, stiffness: 0.3, damping: 0.1 },
      { type: 'spring', bodyA: 'N5', bodyB: 'N7', restLength: 70, stiffness: 0.3, damping: 0.1 },
      { type: 'spring', bodyA: 'N5', bodyB: 'N9', restLength: 70, stiffness: 0.3, damping: 0.1 },
      { type: 'spring', bodyA: 'N6', bodyB: 'N8', restLength: 70, stiffness: 0.3, damping: 0.1 },
    ],
    settings: { gravity: { x: 0, y: 9.8 }, wallBounce: true }
  },
  {
    name: 'Wind Tunnel',
    icon: '🌬️',
    bodies: Array.from({ length: 8 }, (_, i) => ({
      type: 'circle' as const,
      position: { x: 600, y: 100 + i * 70 },
      velocity: { x: 0, y: 0 },
      mass: 0.5 + Math.random(),
      radius: 10 + Math.random() * 15,
      color: COLORS[i % COLORS.length],
      name: `Particle ${i + 1}`
    })),
    forceFields: [
      { type: 'wind', position: { x: 100, y: 300 }, strength: 15, radius: 800, active: true }
    ],
    settings: { gravity: { x: 0, y: 2 }, wallBounce: true, airFriction: 0.02 }
  }
];

export default function PhysicsLensPage() {
  useLensNav('physics');
  const { latestData: realtimeData, alerts: realtimeAlerts, insights: realtimeInsights, isLive, lastUpdated } = useRealtimeLens('physics');
  const { items: savedSims, create: saveSim, remove: removeSim, isError, error, refetch } = useLensData<Record<string, unknown>>('physics', 'simulation', { noSeed: true });

  const runAction = useRunArtifact('physics');
  const [physicsActionResult, setPhysicsActionResult] = useState<Record<string, unknown> | null>(null);
  const [physicsIsRunning, setPhysicsIsRunning] = useState<string | null>(null);
  const [workbenchOpen, setWorkbenchOpen] = useState(false);
  const handlePhysicsAction = async (action: string) => {
    const targetId = savedSims[0]?.id;
    if (!targetId) { setPhysicsActionResult({ message: 'Save a simulation first to run physics analysis.' }); return; }
    setPhysicsIsRunning(action);
    try {
      const res = await runAction.mutateAsync({ id: targetId, action });
      if (res.ok === false) { setPhysicsActionResult({ message: `Action failed: ${(res as Record<string, unknown>).error || 'Unknown error'}` }); } else { setPhysicsActionResult(res.result as Record<string, unknown>); }
    } catch (e) { console.error(`Action ${action} failed:`, e); setPhysicsActionResult({ message: `Action failed: ${e instanceof Error ? e.message : 'Unknown error'}` }); }
    finally { setPhysicsIsRunning(null); }
  };

  const canvasRef = useRef<HTMLCanvasElement>(null);
  const animationRef = useRef<number>(0);

  // Simulation state
  const [isRunning, setIsRunning] = useState(false);
  const [bodies, setBodies] = useState<Body[]>([]);
  const [constraints, setConstraints] = useState<Constraint[]>([]);
  const [forceFields, setForceFields] = useState<ForceField[]>([]);
  const [settings, setSettings] = useState<SimSettings>({
    gravity: { x: 0, y: 9.8 },
    airFriction: 0.01,
    timeScale: 1,
    substeps: 4,
    showVectors: false,
    showTrails: true,
    showForces: false,
    trailLength: 50,
    wallBounce: true
  });

  // UI state
  const [tool, setTool] = useState<Tool>('select');
  const [selectedBody, setSelectedBody] = useState<string | null>(null);
  const [selectedConstraint, setSelectedConstraint] = useState<string | null>(null);
  const [showSettings, setShowSettings] = useState(false);
  const [showPresets, setShowPresets] = useState(false);
  const [showFeatures, setShowFeatures] = useState(true);

  // Physics-tool shortcuts (Algodoo / Box2D Phaser idiom).
  useLensCommand(
    [
      { id: 'tool-select',    keys: 'v', description: 'Select',    category: 'view', action: () => setTool('select') },
      { id: 'tool-circle',    keys: 'c', description: 'Circle',    category: 'view', action: () => setTool('circle') },
      { id: 'tool-rectangle', keys: 'r', description: 'Rectangle', category: 'view', action: () => setTool('rectangle') },
      { id: 'tool-polygon',   keys: 'p', description: 'Polygon',   category: 'view', action: () => setTool('polygon') },
      { id: 'tool-spring',    keys: 's', description: 'Spring',    category: 'view', action: () => setTool('spring') },
      { id: 'tool-force',     keys: 'f', description: 'Force',     category: 'view', action: () => setTool('force') },
      { id: 'tool-delete',    keys: 'd', description: 'Delete',    category: 'view', action: () => setTool('delete') },
    ],
    { lensId: 'physics' }
  );
  const [dragStart, setDragStart] = useState<Vector2D | null>(null);
  const [draggingBody, setDraggingBody] = useState<string | null>(null);
  const [constraintStart, setConstraintStart] = useState<string | null>(null);

  // Stats
  const [stats, setStats] = useState({
    kineticEnergy: 0,
    potentialEnergy: 0,
    totalEnergy: 0,
    momentum: { x: 0, y: 0 },
    fps: 60
  });

  // Auto-load the Bouncing Balls preset and start simulation on first mount
  const hasInitialized = useRef(false);
  useEffect(() => {
    if (hasInitialized.current) return;
    hasInitialized.current = true;
    const preset = PRESETS.find(p => p.name === 'Bouncing Balls');
    if (preset) {
      loadPreset(preset);
      setIsRunning(true);
    }
  }, []);

  // Helper functions
  const distance = (a: Vector2D, b: Vector2D) =>
    Math.sqrt((b.x - a.x) ** 2 + (b.y - a.y) ** 2);

  const normalize = (v: Vector2D): Vector2D => {
    const mag = Math.sqrt(v.x * v.x + v.y * v.y);
    return mag > 0 ? { x: v.x / mag, y: v.y / mag } : { x: 0, y: 0 };
  };

  const dot = (a: Vector2D, b: Vector2D) => a.x * b.x + a.y * b.y;

  // Physics simulation step
  const simulate = useCallback(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;

    const dt = (1 / 60) * settings.timeScale;
    const substepDt = dt / settings.substeps;

    setBodies(prevBodies => {
      let newBodies = [...prevBodies];

      for (let step = 0; step < settings.substeps; step++) {
        // Apply forces
        newBodies = newBodies.map(body => {
          if (body.isStatic || body.pinned) return body;

          let ax = settings.gravity.x;
          let ay = settings.gravity.y;

          // Apply force fields
          forceFields.forEach(field => {
            if (!field.active) return;
            const dx = field.position.x - body.position.x;
            const dy = field.position.y - body.position.y;
            const dist = Math.sqrt(dx * dx + dy * dy);

            if (dist < field.radius && dist > 0) {
              const strength = field.strength * (1 - dist / field.radius);
              const dir = normalize({ x: dx, y: dy });

              switch (field.type) {
                case 'attractor':
                  ax += dir.x * strength / body.mass;
                  ay += dir.y * strength / body.mass;
                  break;
                case 'repulsor':
                  ax -= dir.x * strength / body.mass;
                  ay -= dir.y * strength / body.mass;
                  break;
                case 'wind':
                  ax += strength / body.mass;
                  break;
                case 'gravity':
                  ay += strength;
                  break;
              }
            }
          });

          // Air friction
          const friction = 1 - settings.airFriction;

          return {
            ...body,
            velocity: {
              x: (body.velocity.x + ax * substepDt) * friction,
              y: (body.velocity.y + ay * substepDt) * friction
            },
            angularVelocity: body.angularVelocity * friction
          };
        });

        // Apply constraints
        constraints.forEach(constraint => {
          const bodyA = newBodies.find(b => b.id === constraint.bodyA || b.name === constraint.bodyA);
          const bodyB = newBodies.find(b => b.id === constraint.bodyB || b.name === constraint.bodyB);
          if (!bodyA || !bodyB) return;

          const dx = bodyB.position.x - bodyA.position.x;
          const dy = bodyB.position.y - bodyA.position.y;
          const dist = Math.sqrt(dx * dx + dy * dy);
          const diff = (dist - constraint.restLength) / dist;

          const stiffness = constraint.type === 'rigid' ? 1 : constraint.stiffness;
          const offsetX = dx * diff * 0.5 * stiffness;
          const offsetY = dy * diff * 0.5 * stiffness;

          if (!bodyA.isStatic && !bodyA.pinned) {
            bodyA.position.x += offsetX;
            bodyA.position.y += offsetY;
            bodyA.velocity.x += offsetX * constraint.damping;
            bodyA.velocity.y += offsetY * constraint.damping;
          }
          if (!bodyB.isStatic && !bodyB.pinned) {
            bodyB.position.x -= offsetX;
            bodyB.position.y -= offsetY;
            bodyB.velocity.x -= offsetX * constraint.damping;
            bodyB.velocity.y -= offsetY * constraint.damping;
          }
        });

        // Update positions
        newBodies = newBodies.map(body => {
          if (body.isStatic || body.pinned) return body;

          return {
            ...body,
            position: {
              x: body.position.x + body.velocity.x * substepDt * 60,
              y: body.position.y + body.velocity.y * substepDt * 60
            },
            rotation: body.rotation + body.angularVelocity * substepDt
          };
        });

        // Collision detection
        for (let i = 0; i < newBodies.length; i++) {
          for (let j = i + 1; j < newBodies.length; j++) {
            const a = newBodies[i];
            const b = newBodies[j];

            if (a.type === 'circle' && b.type === 'circle') {
              const dist = distance(a.position, b.position);
              const minDist = (a.radius || 10) + (b.radius || 10);

              if (dist < minDist && dist > 0) {
                const overlap = minDist - dist;
                const nx = (b.position.x - a.position.x) / dist;
                const ny = (b.position.y - a.position.y) / dist;

                // Separate bodies
                const totalMass = a.mass + b.mass;
                if (!a.isStatic && !a.pinned) {
                  a.position.x -= nx * overlap * (b.mass / totalMass);
                  a.position.y -= ny * overlap * (b.mass / totalMass);
                }
                if (!b.isStatic && !b.pinned) {
                  b.position.x += nx * overlap * (a.mass / totalMass);
                  b.position.y += ny * overlap * (a.mass / totalMass);
                }

                // Elastic collision
                const dvx = a.velocity.x - b.velocity.x;
                const dvy = a.velocity.y - b.velocity.y;
                const dvn = dot({ x: dvx, y: dvy }, { x: nx, y: ny });

                if (dvn > 0) continue; // Moving apart

                const restitution = Math.min(a.restitution, b.restitution);
                const impulse = -(1 + restitution) * dvn / (1/a.mass + 1/b.mass);

                if (!a.isStatic && !a.pinned) {
                  a.velocity.x -= impulse * nx / a.mass;
                  a.velocity.y -= impulse * ny / a.mass;
                }
                if (!b.isStatic && !b.pinned) {
                  b.velocity.x += impulse * nx / b.mass;
                  b.velocity.y += impulse * ny / b.mass;
                }
              }
            }
          }
        }

        // Wall collisions
        if (settings.wallBounce) {
          newBodies = newBodies.map(body => {
            if (body.isStatic || body.pinned) return body;
            const r = body.radius || 10;

            if (body.position.x - r < 0) {
              body.position.x = r;
              body.velocity.x = -body.velocity.x * body.restitution;
            }
            if (body.position.x + r > canvas.width / 2) {
              body.position.x = canvas.width / 2 - r;
              body.velocity.x = -body.velocity.x * body.restitution;
            }
            if (body.position.y - r < 0) {
              body.position.y = r;
              body.velocity.y = -body.velocity.y * body.restitution;
            }
            if (body.position.y + r > canvas.height / 2) {
              body.position.y = canvas.height / 2 - r;
              body.velocity.y = -body.velocity.y * body.restitution;
            }

            return body;
          });
        }
      }

      // Update trails
      return newBodies.map(body => ({
        ...body,
        trail: settings.showTrails
          ? [...body.trail, { ...body.position }].slice(-settings.trailLength)
          : []
      }));
    });

    // Calculate stats
    setBodies(prev => {
      let ke = 0, pe = 0, mx = 0, my = 0;
      prev.forEach(b => {
        if (b.isStatic) return;
        const v2 = b.velocity.x ** 2 + b.velocity.y ** 2;
        ke += 0.5 * b.mass * v2;
        pe += b.mass * settings.gravity.y * (canvasRef.current?.height || 600) / 2 - b.position.y;
        mx += b.mass * b.velocity.x;
        my += b.mass * b.velocity.y;
      });
      setStats(s => ({ ...s, kineticEnergy: ke, potentialEnergy: pe, totalEnergy: ke + pe, momentum: { x: mx, y: my } }));
      return prev;
    });
  }, [settings, constraints, forceFields]);

  // Animation loop
  useEffect(() => {
    if (!isRunning) return;

    let lastTime = performance.now();
    let frameCount = 0;

    const loop = () => {
      simulate();
      frameCount++;

      const now = performance.now();
      if (now - lastTime >= 1000) {
        setStats(s => ({ ...s, fps: frameCount }));
        frameCount = 0;
        lastTime = now;
      }

      animationRef.current = requestAnimationFrame(loop);
    };

    animationRef.current = requestAnimationFrame(loop);
    return () => cancelAnimationFrame(animationRef.current);
  }, [isRunning, simulate]);

  // Render
  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;

    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    const scale = 2;
    ctx.setTransform(scale, 0, 0, scale, 0, 0);
    ctx.clearRect(0, 0, canvas.width, canvas.height);

    // Draw force fields
    if (settings.showForces) {
      forceFields.forEach(field => {
        if (!field.active) return;
        ctx.beginPath();
        ctx.arc(field.position.x, field.position.y, field.radius, 0, Math.PI * 2);
        ctx.strokeStyle = field.type === 'attractor' ? 'rgba(0, 255, 136, 0.3)' :
                          field.type === 'repulsor' ? 'rgba(255, 68, 136, 0.3)' :
                          field.type === 'wind' ? 'rgba(136, 200, 255, 0.3)' :
                          'rgba(255, 200, 0, 0.3)';
        ctx.lineWidth = 2;
        ctx.stroke();

        // Draw icon
        ctx.fillStyle = ctx.strokeStyle.replace('0.3', '0.8');
        ctx.font = '16px sans-serif';
        ctx.textAlign = 'center';
        ctx.fillText(
          field.type === 'attractor' ? '◎' : field.type === 'repulsor' ? '⊗' : field.type === 'wind' ? '➤' : '↓',
          field.position.x, field.position.y + 5
        );
      });
    }

    // Draw constraints
    constraints.forEach(constraint => {
      const bodyA = bodies.find(b => b.id === constraint.bodyA || b.name === constraint.bodyA);
      const bodyB = bodies.find(b => b.id === constraint.bodyB || b.name === constraint.bodyB);
      if (!bodyA || !bodyB) return;

      ctx.beginPath();
      ctx.moveTo(bodyA.position.x, bodyA.position.y);
      ctx.lineTo(bodyB.position.x, bodyB.position.y);

      if (constraint.type === 'spring') {
        ctx.strokeStyle = constraint.color || '#888888';
        ctx.setLineDash([4, 4]);
      } else if (constraint.type === 'rigid') {
        ctx.strokeStyle = constraint.color || '#aaaaaa';
        ctx.setLineDash([]);
      } else {
        ctx.strokeStyle = constraint.color || '#666666';
        ctx.setLineDash([2, 2]);
      }

      ctx.lineWidth = constraint.id === selectedConstraint ? 3 : 2;
      ctx.stroke();
      ctx.setLineDash([]);
    });

    // Draw trails
    if (settings.showTrails) {
      bodies.forEach(body => {
        if (body.trail.length < 2) return;
        ctx.beginPath();
        ctx.moveTo(body.trail[0].x, body.trail[0].y);
        body.trail.forEach((p, _i) => {
          ctx.lineTo(p.x, p.y);
        });
        ctx.strokeStyle = body.color + '40';
        ctx.lineWidth = 2;
        ctx.stroke();
      });
    }

    // Draw bodies
    bodies.forEach(body => {
      ctx.save();
      ctx.translate(body.position.x, body.position.y);
      ctx.rotate(body.rotation);

      // Glow effect for selected
      if (body.id === selectedBody) {
        ctx.shadowColor = body.color;
        ctx.shadowBlur = 20;
      }

      if (body.type === 'circle') {
        ctx.beginPath();
        ctx.arc(0, 0, body.radius || 10, 0, Math.PI * 2);
        ctx.fillStyle = body.color;
        ctx.fill();
        ctx.strokeStyle = body.id === selectedBody ? '#ffffff' : body.color;
        ctx.lineWidth = body.id === selectedBody ? 3 : 1;
        ctx.stroke();

        // Direction indicator
        if (!body.isStatic) {
          ctx.beginPath();
          ctx.moveTo(0, 0);
          ctx.lineTo((body.radius || 10) * 0.7, 0);
          ctx.strokeStyle = 'rgba(255,255,255,0.5)';
          ctx.lineWidth = 2;
          ctx.stroke();
        }
      } else if (body.type === 'rectangle') {
        const w = body.width || 30;
        const h = body.height || 30;
        ctx.fillStyle = body.color;
        ctx.fillRect(-w/2, -h/2, w, h);
        ctx.strokeStyle = body.id === selectedBody ? '#ffffff' : body.color;
        ctx.lineWidth = body.id === selectedBody ? 3 : 1;
        ctx.strokeRect(-w/2, -h/2, w, h);
      }

      ctx.restore();

      // Draw velocity vectors
      if (settings.showVectors && !body.isStatic) {
        ctx.beginPath();
        ctx.moveTo(body.position.x, body.position.y);
        ctx.lineTo(
          body.position.x + body.velocity.x * 10,
          body.position.y + body.velocity.y * 10
        );
        ctx.strokeStyle = '#00ff88';
        ctx.lineWidth = 2;
        ctx.stroke();

        // Arrow head
        const angle = Math.atan2(body.velocity.y, body.velocity.x);
        const headLen = 8;
        ctx.beginPath();
        ctx.moveTo(
          body.position.x + body.velocity.x * 10,
          body.position.y + body.velocity.y * 10
        );
        ctx.lineTo(
          body.position.x + body.velocity.x * 10 - headLen * Math.cos(angle - Math.PI/6),
          body.position.y + body.velocity.y * 10 - headLen * Math.sin(angle - Math.PI/6)
        );
        ctx.moveTo(
          body.position.x + body.velocity.x * 10,
          body.position.y + body.velocity.y * 10
        );
        ctx.lineTo(
          body.position.x + body.velocity.x * 10 - headLen * Math.cos(angle + Math.PI/6),
          body.position.y + body.velocity.y * 10 - headLen * Math.sin(angle + Math.PI/6)
        );
        ctx.stroke();
      }

      // Draw pinned indicator
      if (body.pinned) {
        ctx.fillStyle = '#ff4444';
        ctx.beginPath();
        ctx.arc(body.position.x, body.position.y - (body.radius || 10) - 8, 4, 0, Math.PI * 2);
        ctx.fill();
      }
    });

    // Draw drag preview
    if (dragStart && (tool === 'circle' || tool === 'rectangle')) {
      const { x, y } = dragStart;
      ctx.strokeStyle = '#ffffff';
      ctx.setLineDash([5, 5]);
      ctx.lineWidth = 2;
      if (tool === 'circle') {
        ctx.beginPath();
        ctx.arc(x, y, 20, 0, Math.PI * 2);
        ctx.stroke();
      } else {
        ctx.strokeRect(x - 15, y - 15, 30, 30);
      }
      ctx.setLineDash([]);
    }

    // Draw constraint preview
    if (constraintStart) {
      const startBody = bodies.find(b => b.id === constraintStart);
      if (startBody && dragStart) {
        ctx.beginPath();
        ctx.moveTo(startBody.position.x, startBody.position.y);
        ctx.lineTo(dragStart.x, dragStart.y);
        ctx.strokeStyle = '#ffaa00';
        ctx.setLineDash([5, 5]);
        ctx.lineWidth = 2;
        ctx.stroke();
        ctx.setLineDash([]);
      }
    }
  }, [bodies, constraints, forceFields, settings, selectedBody, selectedConstraint, dragStart, constraintStart, tool]);

  // Canvas event handlers
  const getCanvasPos = (e: React.MouseEvent): Vector2D => {
    const canvas = canvasRef.current;
    if (!canvas) return { x: 0, y: 0 };
    const rect = canvas.getBoundingClientRect();
    return {
      x: (e.clientX - rect.left) * (canvas.width / rect.width) / 2,
      y: (e.clientY - rect.top) * (canvas.height / rect.height) / 2
    };
  };

  const findBodyAt = (pos: Vector2D): Body | undefined => {
    return bodies.find(b => {
      if (b.type === 'circle') {
        return distance(pos, b.position) < (b.radius || 10);
      } else if (b.type === 'rectangle') {
        const w = (b.width || 30) / 2;
        const h = (b.height || 30) / 2;
        return pos.x >= b.position.x - w && pos.x <= b.position.x + w &&
               pos.y >= b.position.y - h && pos.y <= b.position.y + h;
      }
      return false;
    });
  };

  const handleMouseDown = (e: React.MouseEvent) => {
    const pos = getCanvasPos(e);
    setDragStart(pos);

    if (tool === 'select') {
      const body = findBodyAt(pos);
      if (body) {
        setSelectedBody(body.id);
        setSelectedConstraint(null);
        setDraggingBody(body.id);
      } else {
        setSelectedBody(null);
        // Check if clicking near a constraint line
        const clickedConstraint = constraints.find(c => {
          const bA = bodies.find(b => b.id === c.bodyA || b.name === c.bodyA);
          const bB = bodies.find(b => b.id === c.bodyB || b.name === c.bodyB);
          if (!bA || !bB) return false;
          const dx = bB.position.x - bA.position.x;
          const dy = bB.position.y - bA.position.y;
          const lenSq = dx * dx + dy * dy;
          if (lenSq === 0) return false;
          const t = Math.max(0, Math.min(1, dot({ x: pos.x - bA.position.x, y: pos.y - bA.position.y }, { x: dx, y: dy }) / lenSq));
          const projX = bA.position.x + t * dx;
          const projY = bA.position.y + t * dy;
          const distSq = (pos.x - projX) ** 2 + (pos.y - projY) ** 2;
          return distSq < 64; // 8px threshold
        });
        setSelectedConstraint(clickedConstraint?.id || null);
      }
    } else if (tool === 'spring') {
      const body = findBodyAt(pos);
      if (body) {
        setConstraintStart(body.id);
      }
    } else if (tool === 'delete') {
      const body = findBodyAt(pos);
      if (body) {
        setBodies(prev => prev.filter(b => b.id !== body.id));
        setConstraints(prev => prev.filter(c => c.bodyA !== body.id && c.bodyB !== body.id && c.bodyA !== body.name && c.bodyB !== body.name));
      }
    }
  };

  const handleMouseMove = (e: React.MouseEvent) => {
    const pos = getCanvasPos(e);

    if (draggingBody) {
      setBodies(prev => prev.map(b =>
        b.id === draggingBody
          ? { ...b, position: pos, velocity: { x: 0, y: 0 } }
          : b
      ));
    } else if (constraintStart) {
      setDragStart(pos);
    }
  };

  const handleMouseUp = (e: React.MouseEvent) => {
    const pos = getCanvasPos(e);

    if (tool === 'circle' && dragStart) {
      const newBody: Body = {
        id: generateId(),
        type: 'circle',
        position: pos,
        velocity: { x: 0, y: 0 },
        acceleration: { x: 0, y: 0 },
        mass: 1,
        restitution: 0.8,
        friction: 0.1,
        radius: 20,
        rotation: 0,
        angularVelocity: 0,
        isStatic: false,
        color: COLORS[Math.floor(Math.random() * COLORS.length)],
        trail: [],
        name: `Body ${bodies.length + 1}`,
        pinned: false
      };
      setBodies(prev => [...prev, newBody]);
    } else if (tool === 'rectangle' && dragStart) {
      const newBody: Body = {
        id: generateId(),
        type: 'rectangle',
        position: pos,
        velocity: { x: 0, y: 0 },
        acceleration: { x: 0, y: 0 },
        mass: 2,
        restitution: 0.7,
        friction: 0.2,
        width: 40,
        height: 40,
        rotation: 0,
        angularVelocity: 0,
        isStatic: false,
        color: COLORS[Math.floor(Math.random() * COLORS.length)],
        trail: [],
        name: `Body ${bodies.length + 1}`,
        pinned: false
      };
      setBodies(prev => [...prev, newBody]);
    } else if (tool === 'spring' && constraintStart) {
      const endBody = findBodyAt(pos);
      if (endBody && endBody.id !== constraintStart) {
        const startBody = bodies.find(b => b.id === constraintStart);
        if (startBody) {
          const newConstraint: Constraint = {
            id: generateId(),
            type: 'spring',
            bodyA: constraintStart,
            bodyB: endBody.id,
            restLength: distance(startBody.position, endBody.position),
            stiffness: 0.5,
            damping: 0.1,
            color: '#ffaa00'
          };
          setConstraints(prev => [...prev, newConstraint]);
        }
      }
    } else if (tool === 'force' && dragStart) {
      const newField: ForceField = {
        id: generateId(),
        type: 'attractor',
        position: pos,
        strength: 100,
        radius: 150,
        active: true
      };
      setForceFields(prev => [...prev, newField]);
    }

    setDragStart(null);
    setDraggingBody(null);
    setConstraintStart(null);
  };

  // Load preset
  const loadPreset = (preset: Preset) => {
    const newBodies: Body[] = preset.bodies.map((b, i) => ({
      id: generateId(),
      type: b.type || 'circle',
      position: b.position || { x: 400, y: 300 },
      velocity: b.velocity || { x: 0, y: 0 },
      acceleration: { x: 0, y: 0 },
      mass: b.mass || 1,
      restitution: b.restitution || 0.8,
      friction: b.friction || 0.1,
      radius: b.radius,
      width: b.width,
      height: b.height,
      rotation: 0,
      angularVelocity: 0,
      isStatic: b.isStatic || false,
      color: b.color || COLORS[i % COLORS.length],
      trail: [],
      name: b.name || `Body ${i + 1}`,
      pinned: false
    }));

    setBodies(newBodies);

    if (preset.constraints) {
      setConstraints(preset.constraints.map(c => ({
        id: generateId(),
        type: c.type || 'spring',
        bodyA: c.bodyA || '',
        bodyB: c.bodyB || '',
        restLength: c.restLength || 100,
        stiffness: c.stiffness || 0.5,
        damping: c.damping || 0.1,
        color: c.color || '#888888'
      })));
    } else {
      setConstraints([]);
    }

    if (preset.forceFields) {
      setForceFields(preset.forceFields.map(f => ({
        id: generateId(),
        type: f.type || 'attractor',
        position: f.position || { x: 400, y: 300 },
        strength: f.strength || 100,
        radius: f.radius || 150,
        active: f.active !== false
      })));
    } else {
      setForceFields([]);
    }

    if (preset.settings) {
      setSettings(s => ({ ...s, ...preset.settings }));
    }

    setShowPresets(false);
  };

  // Export/Import
  const exportSimulation = () => {
    const data = { bodies, constraints, forceFields, settings };
    const blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = 'physics-simulation.json';
    a.click();
    URL.revokeObjectURL(url);
  };

  const importSimulation = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

    const reader = new FileReader();
    reader.onload = (ev) => {
      try {
        const data = JSON.parse(ev.target?.result as string);
        if (data.bodies) setBodies(data.bodies);
        if (data.constraints) setConstraints(data.constraints);
        if (data.forceFields) setForceFields(data.forceFields);
        if (data.settings) setSettings(s => ({ ...s, ...data.settings }));
      } catch (err) {
        console.error('Failed to import simulation:', err);
      }
    };
    reader.readAsText(file);
  };

  // Get selected body for editing
  const selectedBodyObj = bodies.find(b => b.id === selectedBody);


  if (isError) {
    return (
      <div className="flex items-center justify-center h-full p-8">
        <ErrorState error={error?.message} onRetry={refetch} />
      </div>
    );
  }
  return (
    <LensShell lensId="physics" asMain={false}>
      <FirstRunTour lensId="physics" />
      <DepthBadge lensId="physics" size="sm" className="ml-2" />
    <div data-lens-theme="physics" className="p-6 space-y-6">
      {/* Sub-Lenses */}
      <SubLensQuickNav lensId="physics" />

      {/* Stat Cards Row */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
        {[
          { label: 'Bodies', value: bodies.length, color: 'text-violet-400', bg: 'bg-violet-500/10', icon: Circle },
          { label: 'Constraints', value: constraints.length, color: 'text-cyan-400', bg: 'bg-cyan-500/10', icon: Link2 },
          { label: 'Force Fields', value: forceFields.filter(f => f.active).length, color: 'text-amber-400', bg: 'bg-amber-500/10', icon: Magnet },
          { label: 'Time Scale', value: `${settings.timeScale}x`, color: 'text-emerald-400', bg: 'bg-emerald-500/10', icon: Gauge },
        ].map((s, i) => (
          <motion.div
            key={s.label}
            initial={{ opacity: 0, x: -10 }}
            animate={{ opacity: 1, x: 0 }}
            transition={{ delay: i * 0.06 }}
            className={`${s.bg} border border-white/5 rounded-lg p-3 flex items-center gap-3`}
          >
            <s.icon className={`w-4 h-4 ${s.color}`} />
            <div>
              <p className="text-lg font-bold font-mono">{s.value}</p>
              <p className="text-[10px] text-gray-500 uppercase">{s.label}</p>
            </div>
          </motion.div>
        ))}
      </div>

      {/* Equation Reference Card */}
      <motion.div
        initial={{ opacity: 0, y: 8 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ delay: 0.3 }}
        className="flex items-center gap-4 px-4 py-2 bg-white/[0.02] border border-white/5 rounded-lg overflow-x-auto"
      >
        <span className="text-[10px] text-gray-500 uppercase tracking-wider flex-shrink-0">Constants</span>
        {[
          { sym: 'g', val: `${settings.gravity.y.toFixed(1)} m/s\u00B2`, label: 'Gravity' },
          { sym: '\u03BC', val: settings.airFriction.toFixed(3), label: 'Air Friction' },
          { sym: 'F', val: `F = ma`, label: 'Newton 2' },
          { sym: 'E', val: `\u00BD mv\u00B2`, label: 'Kinetic Energy' },
        ].map((eq, _i) => (
          <div key={eq.label} className="flex items-center gap-2 flex-shrink-0 px-2 py-1 bg-white/[0.03] rounded">
            <span className="text-sm font-mono font-bold text-violet-400">{eq.sym}</span>
            <span className="text-xs text-gray-400 font-mono">{eq.val}</span>
          </div>
        ))}
        {/* Experiment status badge */}
        <div className="ml-auto flex items-center gap-1.5 flex-shrink-0">
          <span className={`w-2 h-2 rounded-full ${isRunning ? 'bg-green-400 animate-pulse' : 'bg-gray-600'}`} />
          <span className={`text-xs font-medium ${isRunning ? 'text-green-400' : 'text-gray-500'}`}>
            {isRunning ? 'Simulating' : 'Paused'}
          </span>
        </div>
      </motion.div>

      <header className="flex items-center justify-between">
        <div className="flex items-center gap-3">
          <span className="text-2xl">⚛️</span>
          <div>
            <h1 className="text-xl font-bold">Physics Lens</h1>
            <p className="text-sm text-gray-400">
              Interactive physics simulation engine
            </p>
          </div>

      {/* Real-time Enhancement Toolbar */}
      <div className="flex items-center gap-2 flex-wrap">
        <LiveIndicator isLive={isLive} lastUpdated={lastUpdated} compact />
        <DTUExportButton domain="physics" data={realtimeData || {}} compact />
        {realtimeAlerts.length > 0 && (
          <span className="text-xs px-2 py-0.5 rounded bg-yellow-500/10 text-yellow-400">
            {realtimeAlerts.length} alert{realtimeAlerts.length !== 1 ? 's' : ''}
          </span>
        )}
      </div>
        </div>
        <div className="flex items-center gap-2">
          <div className="relative">
            <button
              onClick={() => setShowPresets(!showPresets)}
              className="btn-neon flex items-center gap-2"
            >
              <Zap className="w-4 h-4" />
              Presets
              <ChevronDown className="w-4 h-4" />
            </button>
            <AnimatePresence>
              {showPresets && (
                <motion.div
                  initial={{ opacity: 0, y: -10 }}
                  animate={{ opacity: 1, y: 0 }}
                  exit={{ opacity: 0, y: -10 }}
                  className="absolute right-0 mt-2 w-48 bg-lattice-void border border-lattice-border rounded-lg shadow-xl z-50"
                >
                  {PRESETS.map(preset => (
                    <button
                      key={preset.name}
                      onClick={() => loadPreset(preset)}
                      className="w-full px-4 py-2 text-left hover:bg-white/5 flex items-center gap-2"
                    >
                      <span>{preset.icon}</span>
                      <span>{preset.name}</span>
                    </button>
                  ))}
                </motion.div>
              )}
            </AnimatePresence>
          </div>
          <button
            onClick={() => toggleSimulation(!isRunning)}
            className={`btn-neon ${isRunning ? 'pink' : 'purple'}`}
          >
            {isRunning ? <Pause className="w-4 h-4 mr-2 inline" /> : <Play className="w-4 h-4 mr-2 inline" />}
            {isRunning ? 'Pause' : 'Start'}
          </button>
          <button
            onClick={() => { setBodies([]); setConstraints([]); setForceFields([]); }}
            className="btn-neon"
            title="Clear All"
          >
            <RotateCcw className="w-4 h-4" />
          </button>
          <button onClick={() => setShowSettings(!showSettings)} className="btn-neon" aria-label="Settings">
            <Settings className="w-4 h-4" />
          </button>
        </div>
      </header>

      {/* Toolbar */}
      <div className="flex items-center gap-2 flex-wrap">
        <div className="panel px-2 py-1 flex items-center gap-1">
          {[
            { id: 'select', icon: Move, label: 'Select' },
            { id: 'circle', icon: Circle, label: 'Circle' },
            { id: 'rectangle', icon: Square, label: 'Rectangle' },
            { id: 'spring', icon: Link2, label: 'Spring' },
            { id: 'force', icon: Magnet, label: 'Force Field' },
            { id: 'delete', icon: Trash2, label: 'Delete' },
          ].map(t => (
            <button
              key={t.id}
              onClick={() => setTool(t.id as Tool)}
              className={`p-2 rounded transition-colors ${tool === t.id ? 'bg-neon-purple/30 text-neon-purple' : 'hover:bg-white/10'}`}
              title={t.label}
            >
              <t.icon className="w-5 h-5" />
            </button>
          ))}
        </div>

        <div className="panel px-3 py-1 flex items-center gap-3">
          <label className="flex items-center gap-2 text-sm">
            <input
              type="checkbox"
              checked={settings.showVectors}
              onChange={e => setSettings(s => ({ ...s, showVectors: e.target.checked }))}
              className="accent-neon-purple"
            />
            Vectors
          </label>
          <label className="flex items-center gap-2 text-sm">
            <input
              type="checkbox"
              checked={settings.showTrails}
              onChange={e => setSettings(s => ({ ...s, showTrails: e.target.checked }))}
              className="accent-neon-purple"
            />
            Trails
          </label>
          <label className="flex items-center gap-2 text-sm">
            <input
              type="checkbox"
              checked={settings.showForces}
              onChange={e => setSettings(s => ({ ...s, showForces: e.target.checked }))}
              className="accent-neon-purple"
            />
            Forces
          </label>
          <label className="flex items-center gap-2 text-sm">
            <input
              type="checkbox"
              checked={settings.wallBounce}
              onChange={e => setSettings(s => ({ ...s, wallBounce: e.target.checked }))}
              className="accent-neon-purple"
            />
            Walls
          </label>
        </div>

        <div className="panel px-3 py-1 flex items-center gap-2">
          <span className="text-sm text-gray-400">Speed:</span>
          <input
            type="range"
            min="0.1"
            max="3"
            step="0.1"
            value={settings.timeScale}
            onChange={e => setSettings(s => ({ ...s, timeScale: parseFloat(e.target.value) }))}
            className="w-24"
          />
          <span className="text-sm font-mono w-12">{settings.timeScale.toFixed(1)}x</span>
        </div>

        <div className="flex-1" />

        <label className="btn-neon cursor-pointer">
          <Upload className="w-4 h-4 mr-2 inline" />
          Import
          <input type="file" accept=".json" onChange={importSimulation} className="hidden" />
        </label>
        <button onClick={exportSimulation} className="btn-neon focus:outline-none focus:ring-2 focus:ring-amber-500">
          <Download className="w-4 h-4 mr-2 inline" />
          Export
        </button>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-4 gap-6">
        {/* Simulation Canvas */}
        <div className="lg:col-span-3 panel p-4">
          <div className="relative aspect-[4/3] bg-lattice-void/50 rounded-lg overflow-hidden">
            <canvas
              ref={canvasRef}
              width={1600}
              height={1200}
              className="w-full h-full cursor-crosshair"
              onMouseDown={handleMouseDown}
              onMouseMove={handleMouseMove}
              onMouseUp={handleMouseUp}
              onMouseLeave={handleMouseUp}
            />

            {/* Stats overlay */}
            <div className="absolute top-4 left-4 bg-lattice-void/80 px-3 py-2 rounded-lg">
              <p className="text-xs text-gray-400">Bodies</p>
              <p className="text-lg font-mono text-neon-blue">{bodies.length}</p>
            </div>

            <div className="absolute top-4 right-4 bg-lattice-void/80 px-3 py-2 rounded-lg">
              <p className="text-xs text-gray-400">FPS</p>
              <p className="text-lg font-mono text-neon-purple">{stats.fps}</p>
            </div>

            <div className="absolute bottom-4 left-4 bg-lattice-void/80 px-3 py-2 rounded-lg">
              <p className="text-xs text-gray-400">Total Energy</p>
              <p className="text-lg font-mono text-neon-green">{stats.totalEnergy.toFixed(1)} J</p>
            </div>

            <div className="absolute bottom-4 right-4 bg-lattice-void/80 px-3 py-2 rounded-lg text-xs">
              <p className="text-gray-400">Constraints: {constraints.length}</p>
              <p className="text-gray-400">Force Fields: {forceFields.length}</p>
            </div>
          </div>
        </div>

        {/* Controls Panel */}
        <div className="space-y-4">
          {/* Settings Panel */}
          <AnimatePresence>
            {showSettings && (
              <motion.div
                initial={{ opacity: 0, height: 0 }}
                animate={{ opacity: 1, height: 'auto' }}
                exit={{ opacity: 0, height: 0 }}
                className="panel p-4 space-y-4"
              >
                <h3 className="font-semibold flex items-center gap-2">
                  <Settings className="w-4 h-4 text-neon-purple" />
                  Simulation Settings
                </h3>

                <div className="space-y-3">
                  <div>
                    <label className="text-sm text-gray-400 block mb-1">
                      Gravity X: {settings.gravity.x.toFixed(1)}
                    </label>
                    <input
                      type="range"
                      min="-20"
                      max="20"
                      step="0.1"
                      value={settings.gravity.x}
                      onChange={e => setSettings(s => ({ ...s, gravity: { ...s.gravity, x: parseFloat(e.target.value) } }))}
                      className="w-full"
                    />
                  </div>

                  <div>
                    <label className="text-sm text-gray-400 block mb-1">
                      Gravity Y: {settings.gravity.y.toFixed(1)}
                    </label>
                    <input
                      type="range"
                      min="-20"
                      max="20"
                      step="0.1"
                      value={settings.gravity.y}
                      onChange={e => setSettings(s => ({ ...s, gravity: { ...s.gravity, y: parseFloat(e.target.value) } }))}
                      className="w-full"
                    />
                  </div>

                  <div>
                    <label className="text-sm text-gray-400 block mb-1">
                      Air Friction: {settings.airFriction.toFixed(3)}
                    </label>
                    <input
                      type="range"
                      min="0"
                      max="0.1"
                      step="0.001"
                      value={settings.airFriction}
                      onChange={e => setSettings(s => ({ ...s, airFriction: parseFloat(e.target.value) }))}
                      className="w-full"
                    />
                  </div>

                  <div>
                    <label className="text-sm text-gray-400 block mb-1">
                      Trail Length: {settings.trailLength}
                    </label>
                    <input
                      type="range"
                      min="10"
                      max="200"
                      step="10"
                      value={settings.trailLength}
                      onChange={e => setSettings(s => ({ ...s, trailLength: parseInt(e.target.value) }))}
                      className="w-full"
                    />
                  </div>

                  <div>
                    <label className="text-sm text-gray-400 block mb-1">
                      Substeps: {settings.substeps}
                    </label>
                    <input
                      type="range"
                      min="1"
                      max="16"
                      step="1"
                      value={settings.substeps}
                      onChange={e => setSettings(s => ({ ...s, substeps: parseInt(e.target.value) }))}
                      className="w-full"
                    />
                  </div>
                </div>
              </motion.div>
            )}
          </AnimatePresence>

          {/* Energy Stats */}
          <div className="panel p-4 space-y-4">
            <h3 className="font-semibold flex items-center gap-2">
              <Gauge className="w-4 h-4 text-neon-green" />
              System Stats
            </h3>
            <div className="space-y-2 text-sm">
              <div className="flex justify-between">
                <span className="text-gray-400">Kinetic Energy</span>
                <span className="font-mono">{stats.kineticEnergy.toFixed(2)} J</span>
              </div>
              <div className="flex justify-between">
                <span className="text-gray-400">Potential Energy</span>
                <span className="font-mono">{stats.potentialEnergy.toFixed(2)} J</span>
              </div>
              <div className="flex justify-between">
                <span className="text-gray-400">Total Energy</span>
                <span className="font-mono text-neon-green">{stats.totalEnergy.toFixed(2)} J</span>
              </div>
              <div className="flex justify-between">
                <span className="text-gray-400">Momentum X</span>
                <span className="font-mono">{stats.momentum.x.toFixed(2)}</span>
              </div>
              <div className="flex justify-between">
                <span className="text-gray-400">Momentum Y</span>
                <span className="font-mono">{stats.momentum.y.toFixed(2)}</span>
              </div>
            </div>
          </div>

          {/* Selected Body Editor */}
          {selectedBodyObj && (
            <motion.div
              initial={{ opacity: 0, y: 10 }}
              animate={{ opacity: 1, y: 0 }}
              className="panel p-4 space-y-4"
            >
              <h3 className="font-semibold flex items-center gap-2">
                <Target className="w-4 h-4 text-neon-cyan" />
                {selectedBodyObj.name}
              </h3>

              <div className="space-y-3 text-sm">
                <div>
                  <label className="text-gray-400 block mb-1">Mass: {selectedBodyObj.mass.toFixed(1)}</label>
                  <input
                    type="range"
                    min="0.1"
                    max="100"
                    step="0.1"
                    value={selectedBodyObj.mass}
                    onChange={e => setBodies(prev => prev.map(b =>
                      b.id === selectedBody ? { ...b, mass: parseFloat(e.target.value) } : b
                    ))}
                    className="w-full"
                  />
                </div>

                <div>
                  <label className="text-gray-400 block mb-1">Radius: {selectedBodyObj.radius?.toFixed(0) || 10}</label>
                  <input
                    type="range"
                    min="5"
                    max="100"
                    step="1"
                    value={selectedBodyObj.radius || 10}
                    onChange={e => setBodies(prev => prev.map(b =>
                      b.id === selectedBody ? { ...b, radius: parseFloat(e.target.value) } : b
                    ))}
                    className="w-full"
                  />
                </div>

                <div>
                  <label className="text-gray-400 block mb-1">Bounciness: {selectedBodyObj.restitution.toFixed(2)}</label>
                  <input
                    type="range"
                    min="0"
                    max="1"
                    step="0.05"
                    value={selectedBodyObj.restitution}
                    onChange={e => setBodies(prev => prev.map(b =>
                      b.id === selectedBody ? { ...b, restitution: parseFloat(e.target.value) } : b
                    ))}
                    className="w-full"
                  />
                </div>

                <div className="flex gap-2">
                  <label className="flex items-center gap-2">
                    <input
                      type="checkbox"
                      checked={selectedBodyObj.isStatic}
                      onChange={e => setBodies(prev => prev.map(b =>
                        b.id === selectedBody ? { ...b, isStatic: e.target.checked } : b
                      ))}
                      className="accent-neon-purple"
                    />
                    Static
                  </label>
                  <label className="flex items-center gap-2">
                    <input
                      type="checkbox"
                      checked={selectedBodyObj.pinned}
                      onChange={e => setBodies(prev => prev.map(b =>
                        b.id === selectedBody ? { ...b, pinned: e.target.checked } : b
                      ))}
                      className="accent-neon-purple"
                    />
                    Pinned
                  </label>
                </div>

                <div>
                  <label className="text-gray-400 block mb-1">Color</label>
                  <div className="flex gap-1 flex-wrap">
                    {COLORS.map(c => (
                      <button
                        key={c}
                        onClick={() => setBodies(prev => prev.map(b =>
                          b.id === selectedBody ? { ...b, color: c } : b
                        ))}
                        className={`w-6 h-6 rounded border-2 ${selectedBodyObj.color === c ? 'border-white' : 'border-transparent'}`}
                        style={{ backgroundColor: c }}
                      />
                    ))}
                  </div>
                </div>
              </div>
            </motion.div>
          )}

          {/* Body List */}
          <div className="panel p-4 space-y-4">
            <h3 className="font-semibold">Bodies ({bodies.length})</h3>
            <div className="space-y-1 max-h-48 overflow-auto">
              {bodies.map(body => (
                <div
                  key={body.id}
                  onClick={() => setSelectedBody(body.id)}
                  className={`flex items-center justify-between text-sm py-1 px-2 rounded cursor-pointer transition-colors ${
                    selectedBody === body.id ? 'bg-neon-purple/20' : 'hover:bg-white/5'
                  }`}
                >
                  <div className="flex items-center gap-2">
                    <div className="w-3 h-3 rounded-full" style={{ backgroundColor: body.color }} />
                    <span className="text-gray-300">{body.name}</span>
                    {body.isStatic && <span className="text-xs text-gray-500">(static)</span>}
                  </div>
                  <span className="text-xs text-gray-500">{body.mass.toFixed(1)} kg</span>
                </div>
              ))}
              {bodies.length === 0 && (
                <p className="text-gray-500 text-sm text-center py-4">
                  No bodies. Click canvas to add or load a preset.
                </p>
              )}
            </div>
          </div>

          {/* Saved Simulations */}
          <div className="panel p-4 space-y-4">
            <div className="flex items-center justify-between">
              <h3 className="font-semibold">Saved Simulations ({savedSims.length})</h3>
              <button
                onClick={() => saveSim({ title: `Sim ${new Date().toLocaleTimeString()}`, data: { bodies, constraints, forceFields, settings } as unknown as Record<string, unknown> })}
                className="text-xs px-2 py-1 bg-neon-purple/20 text-neon-purple rounded hover:bg-neon-purple/30 flex items-center gap-1"
                disabled={bodies.length === 0}
              >
                <Download className="w-3 h-3" /> Save
              </button>
            </div>
            <div className="space-y-1 max-h-48 overflow-auto">
              {savedSims.map(sim => (
                <div
                  key={sim.id}
                  className="flex items-center justify-between text-sm py-1.5 px-2 rounded hover:bg-white/5 cursor-pointer group"
                  onClick={() => {
                    const d = sim.data as Record<string, unknown>;
                    if (d.bodies) setBodies(d.bodies as Body[]);
                    if (d.constraints) setConstraints(d.constraints as Constraint[]);
                    if (d.forceFields) setForceFields(d.forceFields as ForceField[]);
                    if (d.settings) setSettings(d.settings as SimSettings);
                  }}
                >
                  <span className="text-gray-300 truncate">{sim.title}</span>
                  <button
                    onClick={e => { e.stopPropagation(); removeSim(sim.id); }}
                    className="text-gray-600 hover:text-red-400 opacity-0 group-hover:opacity-100 transition-opacity"
                  aria-label="Delete">
                    <Trash2 className="w-3 h-3" />
                  </button>
                </div>
              ))}
              {savedSims.length === 0 && (
                <p className="text-gray-500 text-sm text-center py-4">
                  No saved simulations yet.
                </p>
              )}
            </div>
          </div>
        </div>

      {/* Live arXiv papers — physics.* + hep-* categories */}
      <LiveFeed
        articles={adaptToLiveFeedArticles(realtimeData as Record<string, unknown> | null)}
        domain="research"
        isLive={isLive}
        lastUpdated={lastUpdated}
        limit={8}
      />
      {/* Real-time Data Panel */}
      {realtimeData && (
        <>
          <UniversalActions domain="physics" artifactId={null} compact />
          <RealtimeDataPanel
            domain="physics"
            data={realtimeData}
            isLive={isLive}
            lastUpdated={lastUpdated}
            insights={realtimeInsights}
            compact
          />
        </>
      )}
      </div>

      {/* Backend Action Panel */}
      <div className="panel p-4 space-y-3">
        <h2 className="font-semibold flex items-center gap-2">
          <Gauge className="w-4 h-4 text-neon-cyan" />
          Physics Analysis
        </h2>
        <div className="flex flex-wrap gap-2">
          {[
            { action: 'kinematicsSim', label: 'Kinematics Sim' },
            { action: 'orbitalMechanics', label: 'Orbital Mechanics' },
            { action: 'waveInterference', label: 'Wave Interference' },
            { action: 'thermodynamics', label: 'Thermodynamics' },
          ].map(({ action, label }) => (
            <button key={action} onClick={() => handlePhysicsAction(action)} disabled={!!physicsIsRunning}
              className="btn-secondary text-sm flex items-center gap-1 disabled:opacity-50">
              {physicsIsRunning === action ? <Loader2 className="w-3 h-3 animate-spin" /> : <Play className="w-3 h-3" />}
              {label}
            </button>
          ))}
        </div>
        {physicsActionResult && (
          <div className="bg-lattice-deep rounded-lg p-4 space-y-3 text-sm">
            {'bodies' in physicsActionResult && Array.isArray(physicsActionResult.bodies) && (
              <div className="space-y-2">
                <p className="text-xs text-gray-500 uppercase tracking-wider">Bodies ({(physicsActionResult.bodies as unknown[]).length})</p>
                {(physicsActionResult.bodies as Array<Record<string, unknown>>).map((b, i) => (
                  <div key={i} className="bg-lattice-surface rounded px-2 py-1 text-xs">
                    <span className="text-gray-300">{String(b.name || `Body ${i + 1}`)}</span>
                    {b.maxHeight !== undefined && <span className="ml-2 text-neon-cyan">Max h: {String(b.maxHeight)}</span>}
                    {b.range !== undefined && <span className="ml-2 text-neon-green">Range: {String(b.range)}</span>}
                    {b.flightTime !== undefined && <span className="ml-2 text-yellow-400">t: {String(b.flightTime)}s</span>}
                  </div>
                ))}
              </div>
            )}
            {'elements' in physicsActionResult && (
              <div className="space-y-2">
                {'elements' in physicsActionResult && physicsActionResult.elements !== null && typeof physicsActionResult.elements === 'object' && (
                  <div className="flex flex-wrap gap-3 text-xs">
                    {Object.entries(physicsActionResult.elements as Record<string, unknown>).slice(0, 4).map(([k, v]) => (
                      <span key={k} className="text-gray-400">{k}: <span className="text-neon-cyan">{String(v)}</span></span>
                    ))}
                  </div>
                )}
                {'hohmannTransfer' in physicsActionResult && physicsActionResult.hohmannTransfer !== null && typeof physicsActionResult.hohmannTransfer === 'object' && (
                  <div className="flex flex-wrap gap-3 text-xs">
                    {Object.entries(physicsActionResult.hohmannTransfer as Record<string, unknown>).slice(0, 3).map(([k, v]) => (
                      <span key={k} className="text-gray-400">{k}: <span className="text-neon-green">{String(v)}</span></span>
                    ))}
                  </div>
                )}
              </div>
            )}
            {'beatFrequency' in physicsActionResult && (
              <div className="flex flex-wrap gap-4 text-xs">
                <span className="text-gray-400">Beat Freq: <span className="text-neon-cyan font-bold">{String(physicsActionResult.beatFrequency)} Hz</span></span>
                {'sources' in physicsActionResult && Array.isArray(physicsActionResult.sources) && (
                  <span className="text-gray-400">Sources: <span className="text-neon-cyan">{String((physicsActionResult.sources as unknown[]).length)}</span></span>
                )}
              </div>
            )}
            {'process' in physicsActionResult && 'energetics' in physicsActionResult && (
              <div className="space-y-2">
                <div className="flex flex-wrap gap-4 text-xs">
                  <span className="text-gray-400">Process: <span className="text-neon-purple">{String(physicsActionResult.process)}</span></span>
                </div>
                {'energetics' in physicsActionResult && physicsActionResult.energetics !== null && typeof physicsActionResult.energetics === 'object' && (
                  <div className="flex flex-wrap gap-3 text-xs">
                    {Object.entries(physicsActionResult.energetics as Record<string, unknown>).map(([k, v]) => (
                      <span key={k} className="text-gray-400">{k}: <span className="text-neon-cyan">{String(v)}</span></span>
                    ))}
                  </div>
                )}
                {'efficiency' in physicsActionResult && physicsActionResult.efficiency !== null && typeof physicsActionResult.efficiency === 'object' && (
                  <div className="flex flex-wrap gap-3 text-xs">
                    {Object.entries(physicsActionResult.efficiency as Record<string, unknown>).map(([k, v]) => (
                      <span key={k} className="text-gray-400">{k}: <span className="text-neon-green">{String(v)}</span></span>
                    ))}
                  </div>
                )}
              </div>
            )}
            {'message' in physicsActionResult && <p className="text-gray-400">{String(physicsActionResult.message)}</p>}
          </div>
        )}
      </div>

      {/* Lens Features */}
      <div className="border-t border-white/10">
        <button
          onClick={() => setShowFeatures(!showFeatures)}
          className="w-full flex items-center justify-between px-4 py-3 text-sm text-gray-300 hover:text-white transition-colors bg-white/[0.02] hover:bg-white/[0.04] rounded-lg"
        >
          <span className="flex items-center gap-2">
            <Layers className="w-4 h-4" />
            Lens Features & Capabilities
          </span>
          <ChevronDown className={`w-4 h-4 transition-transform ${showFeatures ? 'rotate-180' : ''}`} />
        </button>
        {showFeatures && (
          <div className="px-4 pb-4">
            <LensFeaturePanel lensId="physics" />
          </div>
        )}
      </div>
    </div>
    {/* 2026 parity workbench — kinematics, projectile, units, constants */}
    <button
      type="button"
      onClick={() => setWorkbenchOpen(true)}
      className="fixed bottom-6 right-6 z-30 inline-flex items-center gap-2 px-4 py-2.5 rounded-full bg-indigo-500 hover:bg-indigo-400 text-indigo-50 shadow-2xl text-sm font-medium"
      title="Physics Workbench — kinematics, projectile motion, unit conversion, constants"
    >
      Physics Workbench
    </button>
    <PhysicsWorkbench open={workbenchOpen} onClose={() => setWorkbenchOpen(false)} />
    <section className="mt-6 mx-auto max-w-7xl rounded-xl border border-zinc-800 bg-zinc-950/40 p-4">
      <PhysicsArxiv />
    </section>

    <PipingProvider>
      <section className="mt-6 mx-auto max-w-7xl">
        <PhysicsActionPanel />
      </section>
    </PipingProvider>
          <RecentMineCard domain="physics" limit={10} hideWhenEmpty className="mt-4" />
    </LensShell>
  );

  function toggleSimulation(running: boolean) {
    setIsRunning(running);
  }
}
