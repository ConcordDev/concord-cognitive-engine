'use client';

import { useRef, useMemo } from 'react';
import { Canvas, useThree } from '@react-three/fiber';
import { OrbitControls, Line } from '@react-three/drei';
import * as THREE from 'three';

// ── Types ─────────────────────────────────────────────────────────────────────

export interface FEANode {
  id: string;
  x: number;
  y: number;
  z: number;
}

export interface FEAMember {
  id: string;
  nodeI: string;
  nodeJ: string;
  utilization: number;
  stress: number;
}

export interface FEADisplacement {
  nodeId: string;
  dx: number;
  dy: number;
  dz: number;
}

export interface FEAResultViewerProps {
  nodes: FEANode[];
  members: FEAMember[];
  displacements?: FEADisplacement[];
  amplification?: number;
  showDeformed?: boolean;
  showStress?: boolean;
  height?: string;
}

// ── Stress color: blue(0) → green(0.5) → red(1.0+) ──────────────────────────
// Matches the formula specified in the engineering workspace task spec.

function stressToColor(u: number): THREE.Color {
  const t = Math.min(Math.max(u, 0), 1);
  if (t < 0.5) return new THREE.Color(0, t * 2, 1 - t * 2); // blue → green
  return new THREE.Color((t - 0.5) * 2, 1 - (t - 0.5) * 2, 0); // green → red
}

// ── Camera auto-centering on mount ────────────────────────────────────────────

function CameraRig({ nodes }: { nodes: FEANode[] }) {
  const { camera } = useThree();
  const initialized = useRef(false);

  useMemo(() => {
    if (initialized.current || nodes.length === 0) return;
    initialized.current = true;

    const xs = nodes.map((n) => n.x);
    const ys = nodes.map((n) => n.y);
    const zs = nodes.map((n) => n.z);

    const minX = Math.min(...xs),
      maxX = Math.max(...xs);
    const minY = Math.min(...ys),
      maxY = Math.max(...ys);
    const minZ = Math.min(...zs),
      maxZ = Math.max(...zs);

    const cx = (minX + maxX) / 2;
    const cy = (minY + maxY) / 2;
    const cz = (minZ + maxZ) / 2;

    const diagX = maxX - minX;
    const diagY = maxY - minY;
    const diagZ = maxZ - minZ;
    const diagonal = Math.sqrt(diagX * diagX + diagY * diagY + diagZ * diagZ);
    const dist = Math.max(diagonal * 1.4, 5);

    camera.position.set(cx + dist * 0.6, cy + dist * 0.5, cz + dist * 0.8);
    camera.lookAt(cx, cy, cz);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [nodes]);

  return null;
}

// ── Scene ─────────────────────────────────────────────────────────────────────

function FEAScene({
  nodes,
  members,
  displacements,
  amplification,
  showDeformed,
  showStress,
}: Required<Omit<FEAResultViewerProps, 'height'>>) {
  // Build lookup maps
  const nodeMap = useMemo(() => {
    const m = new Map<string, FEANode>();
    for (const n of nodes) m.set(n.id, n);
    return m;
  }, [nodes]);

  const dispMap = useMemo(() => {
    const m = new Map<string, FEADisplacement>();
    for (const d of displacements) m.set(d.nodeId, d);
    return m;
  }, [displacements]);

  // Deformed position of a node
  const deformedPos = useMemo(() => {
    const m = new Map<string, [number, number, number]>();
    for (const n of nodes) {
      const d = dispMap.get(n.id);
      if (d) {
        m.set(n.id, [
          n.x + d.dx * amplification,
          n.y + d.dy * amplification,
          n.z + d.dz * amplification,
        ]);
      } else {
        m.set(n.id, [n.x, n.y, n.z]);
      }
    }
    return m;
  }, [nodes, dispMap, amplification]);

  const hasDisplacements = displacements.length > 0;

  return (
    <>
      <ambientLight intensity={0.6} />
      <directionalLight position={[10, 20, 10]} intensity={0.8} />
      <axesHelper args={[2]} />
      <CameraRig nodes={nodes} />
      <OrbitControls makeDefault enableDamping dampingFactor={0.08} />

      {members.map((member) => {
        const nI = nodeMap.get(member.nodeI);
        const nJ = nodeMap.get(member.nodeJ);
        if (!nI || !nJ) return null;

        const origI: [number, number, number] = [nI.x, nI.y, nI.z];
        const origJ: [number, number, number] = [nJ.x, nJ.y, nJ.z];

        const defI = deformedPos.get(member.nodeI) ?? origI;
        const defJ = deformedPos.get(member.nodeJ) ?? origJ;

        const stressColor = stressToColor(member.utilization);
        const colorHex = `#${stressColor.getHexString()}`;

        return (
          <group key={member.id}>
            {/* Undeformed wireframe — gray, thin, low opacity */}
            <Line
              points={[origI, origJ]}
              color="#555566"
              lineWidth={1}
              transparent
              opacity={0.35}
            />

            {/* Stress heatmap — colored by utilization */}
            {showStress && (
              <Line
                points={[origI, origJ]}
                color={colorHex}
                lineWidth={2.5}
                transparent
                opacity={0.85}
              />
            )}

            {/* Deformed shape — white, only when displacements are available */}
            {showDeformed && hasDisplacements && (
              <Line points={[defI, defJ]} color="#ffffff" lineWidth={2} transparent opacity={0.9} />
            )}
          </group>
        );
      })}
    </>
  );
}

// ── Utilization badge ─────────────────────────────────────────────────────────

function UtilizationBadge({ utilization }: { utilization: number }) {
  if (utilization < 0.8) {
    return (
      <span className="inline-flex items-center px-2 py-0.5 rounded-full text-xs font-medium bg-green-500/20 text-green-400">
        PASS
      </span>
    );
  }
  if (utilization <= 1.0) {
    return (
      <span className="inline-flex items-center px-2 py-0.5 rounded-full text-xs font-medium bg-yellow-500/20 text-yellow-400">
        WARN
      </span>
    );
  }
  return (
    <span className="inline-flex items-center px-2 py-0.5 rounded-full text-xs font-medium bg-red-500/20 text-red-400">
      FAIL
    </span>
  );
}

// ── Color legend ──────────────────────────────────────────────────────────────

function StressLegend() {
  const stops = [0, 0.25, 0.5, 0.75, 1.0];
  return (
    <div className="flex items-center gap-3 mt-3 px-2">
      <span className="text-xs text-gray-500">Utilization:</span>
      <div className="flex items-center gap-1">
        {stops.map((u) => {
          const c = stressToColor(u);
          return (
            <div key={u} className="flex flex-col items-center gap-0.5">
              <div
                className="w-6 h-3 rounded-sm"
                style={{ backgroundColor: `#${c.getHexString()}` }}
              />
              <span className="text-[9px] text-gray-500">{(u * 100).toFixed(0)}%</span>
            </div>
          );
        })}
      </div>
    </div>
  );
}

// ── Main exported component ───────────────────────────────────────────────────

export function FEAResultViewer({
  nodes,
  members,
  displacements = [],
  amplification = 10,
  showDeformed = true,
  showStress = true,
  height = '400px',
}: FEAResultViewerProps) {
  const sortedMembers = useMemo(
    () => [...members].sort((a, b) => b.utilization - a.utilization),
    [members]
  );

  return (
    <div className="space-y-4">
      {/* 3-D Viewport */}
      <div
        className="relative rounded-lg overflow-hidden border border-lattice-border bg-black/40"
        style={{ height }}
      >
        {nodes.length === 0 ? (
          <div className="flex items-center justify-center h-full text-gray-500 text-sm">
            No FEA data to display
          </div>
        ) : (
          <Canvas
            gl={{ antialias: true, alpha: true }}
            camera={{ fov: 50, near: 0.01, far: 10000 }}
            style={{ background: 'transparent' }}
          >
            <FEAScene
              nodes={nodes}
              members={members}
              displacements={displacements}
              amplification={amplification}
              showDeformed={showDeformed}
              showStress={showStress}
            />
          </Canvas>
        )}

        {/* Legend overlay */}
        {nodes.length > 0 && showStress && (
          <div className="absolute bottom-3 left-3 bg-lattice-void/80 backdrop-blur-sm rounded-lg px-3 py-2 border border-lattice-border">
            <StressLegend />
          </div>
        )}

        {/* Info overlay */}
        <div className="absolute top-3 left-3 bg-lattice-void/80 backdrop-blur-sm rounded-lg px-3 py-2 border border-lattice-border text-xs space-y-0.5">
          <p className="text-gray-400">
            Nodes: <span className="text-neon-cyan font-mono">{nodes.length}</span>
          </p>
          <p className="text-gray-400">
            Members: <span className="text-neon-cyan font-mono">{members.length}</span>
          </p>
          {displacements.length > 0 && (
            <p className="text-gray-400">
              Amp: <span className="text-neon-cyan font-mono">{amplification}×</span>
            </p>
          )}
        </div>

        {/* Viewport legend */}
        <div className="absolute top-3 right-3 bg-lattice-void/80 backdrop-blur-sm rounded-lg px-3 py-2 border border-lattice-border text-xs space-y-1">
          <div className="flex items-center gap-2">
            <div className="w-6 h-0.5 bg-[#555566] opacity-50" />
            <span className="text-gray-500">Undeformed</span>
          </div>
          {showDeformed && displacements.length > 0 && (
            <div className="flex items-center gap-2">
              <div className="w-6 h-0.5 bg-white" />
              <span className="text-gray-400">Deformed ×{amplification}</span>
            </div>
          )}
          {showStress && (
            <div className="flex items-center gap-2">
              <div className="w-6 h-0.5 bg-gradient-to-r from-blue-500 to-red-500" />
              <span className="text-gray-400">Stress</span>
            </div>
          )}
        </div>
      </div>

      {/* Member utilization table */}
      {members.length > 0 && (
        <div className="rounded-lg border border-lattice-border overflow-hidden">
          <div className="overflow-x-auto max-h-64">
            <table className="w-full text-sm">
              <thead className="bg-lattice-void sticky top-0">
                <tr className="border-b border-lattice-border">
                  <th className="px-3 py-2 text-left text-xs text-gray-500 font-medium">
                    Member ID
                  </th>
                  <th className="px-3 py-2 text-right text-xs text-gray-500 font-medium">
                    Stress (MPa)
                  </th>
                  <th className="px-3 py-2 text-right text-xs text-gray-500 font-medium">
                    Utilization
                  </th>
                  <th className="px-3 py-2 text-center text-xs text-gray-500 font-medium">
                    Status
                  </th>
                </tr>
              </thead>
              <tbody>
                {sortedMembers.map((m, i) => {
                  const c = stressToColor(m.utilization);
                  return (
                    <tr
                      key={m.id}
                      className={`border-b border-lattice-border/50 ${
                        i % 2 === 0 ? 'bg-white/[0.01]' : ''
                      }`}
                    >
                      <td className="px-3 py-2 font-mono text-xs text-gray-300">{m.id}</td>
                      <td className="px-3 py-2 text-right font-mono text-xs text-gray-300">
                        {m.stress.toFixed(1)}
                      </td>
                      <td className="px-3 py-2 text-right">
                        <div className="flex items-center justify-end gap-2">
                          <div className="w-20 h-1.5 rounded-full bg-white/10 overflow-hidden">
                            <div
                              className="h-full rounded-full transition-all"
                              style={{
                                width: `${Math.min(m.utilization * 100, 100)}%`,
                                backgroundColor: `#${c.getHexString()}`,
                              }}
                            />
                          </div>
                          <span className="font-mono text-xs text-gray-300 w-10 text-right">
                            {(m.utilization * 100).toFixed(1)}%
                          </span>
                        </div>
                      </td>
                      <td className="px-3 py-2 text-center">
                        <UtilizationBadge utilization={m.utilization} />
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </div>
      )}
    </div>
  );
}
