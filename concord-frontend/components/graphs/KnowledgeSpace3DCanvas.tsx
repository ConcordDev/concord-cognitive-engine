'use client';

import { useRef, useState, useMemo, useEffect, Suspense } from 'react';
import { Canvas, useFrame, useThree } from '@react-three/fiber';
import { OrbitControls, Html, Stars, Line } from '@react-three/drei';
import * as THREE from 'three';
import { motion } from 'framer-motion';
import { RotateCcw, Eye } from 'lucide-react';
import { cn } from '@/lib/utils';
import { LensErrorBoundary } from '@/components/common/LensErrorBoundary';

interface Node3D {
  id: string;
  label: string;
  tier: 'regular' | 'mega' | 'hyper' | 'shadow';
  position: [number, number, number];
  connections: string[];
  resonance?: number;
}

interface KnowledgeSpace3DProps {
  nodes: Node3D[];
  onNodeClick?: (node: Node3D) => void;
  selectedNodeId?: string;
  className?: string;
}

const tierConfig = {
  regular: { color: '#6b7280', emissive: '#4b5563', size: 0.3 },
  mega: { color: '#22d3ee', emissive: '#0891b2', size: 0.5 },
  hyper: { color: '#a855f7', emissive: '#7c3aed', size: 0.7 },
  shadow: { color: '#374151', emissive: '#1f2937', size: 0.25 }
};

// Individual node component
function Node({
  node,
  isSelected,
  isHovered,
  onClick,
  onHover
}: {
  node: Node3D;
  isSelected: boolean;
  isHovered: boolean;
  onClick: () => void;
  onHover: (hovered: boolean) => void;
}) {
  const meshRef = useRef<THREE.Mesh>(null);
  const config = tierConfig[node.tier];
  const scale = isSelected ? 1.5 : isHovered ? 1.2 : 1;

  useFrame((state) => {
    if (meshRef.current) {
      // Gentle floating animation
      meshRef.current.position.y = node.position[1] + Math.sin(state.clock.elapsedTime + node.position[0]) * 0.05;

      // Pulsing for selected
      if (isSelected) {
        const pulse = 1 + Math.sin(state.clock.elapsedTime * 3) * 0.1;
        meshRef.current.scale.setScalar(config.size * scale * pulse);
      }
    }
  });

  return (
    <group position={node.position}>
      <mesh
        ref={meshRef}
        onClick={(e) => {
          e.stopPropagation();
          onClick();
        }}
        onPointerOver={(e) => {
          e.stopPropagation();
          onHover(true);
          document.body.style.cursor = 'pointer';
        }}
        onPointerOut={() => {
          onHover(false);
          document.body.style.cursor = 'default';
        }}
        scale={config.size * scale}
      >
        <sphereGeometry args={[1, 32, 32]} />
        <meshStandardMaterial
          color={config.color}
          emissive={config.emissive}
          emissiveIntensity={isSelected ? 0.8 : isHovered ? 0.5 : 0.2}
          metalness={0.3}
          roughness={0.4}
        />
      </mesh>

      {/* Glow effect */}
      <mesh scale={config.size * scale * 1.5}>
        <sphereGeometry args={[1, 16, 16]} />
        <meshBasicMaterial
          color={config.color}
          transparent
          opacity={isSelected ? 0.3 : isHovered ? 0.2 : 0.1}
        />
      </mesh>

      {/* Label */}
      {(isSelected || isHovered) && (
        <Html
          position={[0, config.size * 1.5, 0]}
          center
          style={{ pointerEvents: 'none' }}
        >
          <div className="px-2 py-1 bg-black/80 rounded text-xs text-white whitespace-nowrap">
            {node.label}
          </div>
        </Html>
      )}
    </group>
  );
}

// Edge component
function Edge({
  start,
  end,
  isHighlighted
}: {
  start: [number, number, number];
  end: [number, number, number];
  isHighlighted: boolean;
}) {
  const points = useMemo(() => {
    return [start, end] as [[number, number, number], [number, number, number]];
  }, [start, end]);

  return (
    <Line
      points={points}
      color={isHighlighted ? '#22d3ee' : '#4b5563'}
      lineWidth={isHighlighted ? 2 : 1}
      transparent
      opacity={isHighlighted ? 0.8 : 0.3}
    />
  );
}

// Main scene
function Scene({
  nodes,
  onNodeClick,
  selectedNodeId
}: {
  nodes: Node3D[];
  onNodeClick?: (node: Node3D) => void;
  selectedNodeId?: string;
}) {
  const [hoveredNodeId, setHoveredNodeId] = useState<string | null>(null);
   
  const { camera } = useThree();

  // Focus camera on selected node when selection changes
  useEffect(() => {
    if (selectedNodeId) {
      const node = nodes.find(n => n.id === selectedNodeId);
      if (node) {
        const [tx, ty, tz] = node.position;
        camera.lookAt(tx, ty, tz);
      }
    }
  }, [selectedNodeId, nodes, camera]);

  // Create position map for edges
  const positionMap = useMemo(() => {
    const map = new Map<string, [number, number, number]>();
    nodes.forEach(node => map.set(node.id, node.position));
    return map;
  }, [nodes]);

  // Get all edges
  const edges = useMemo(() => {
    const edgeSet = new Set<string>();
    const result: { start: [number, number, number]; end: [number, number, number]; highlighted: boolean }[] = [];

    nodes.forEach(node => {
      node.connections.forEach(targetId => {
        const edgeId = [node.id, targetId].sort().join('-');
        if (!edgeSet.has(edgeId)) {
          edgeSet.add(edgeId);
          const targetPos = positionMap.get(targetId);
          if (targetPos) {
            const isHighlighted = selectedNodeId === node.id ||
                                  selectedNodeId === targetId ||
                                  hoveredNodeId === node.id ||
                                  hoveredNodeId === targetId;
            result.push({
              start: node.position,
              end: targetPos,
              highlighted: isHighlighted
            });
          }
        }
      });
    });

    return result;
  }, [nodes, positionMap, selectedNodeId, hoveredNodeId]);

  return (
    <>
      {/* Ambient lighting */}
      <ambientLight intensity={0.3} />
      <pointLight position={[10, 10, 10]} intensity={0.8} />
      <pointLight position={[-10, -10, -10]} intensity={0.4} color="#22d3ee" />

      {/* Stars background */}
      <Stars radius={100} depth={50} count={2000} factor={4} fade speed={1} />

      {/* Edges */}
      {edges.map((edge, i) => (
        <Edge
          key={i}
          start={edge.start}
          end={edge.end}
          isHighlighted={edge.highlighted}
        />
      ))}

      {/* Nodes */}
      {nodes.map(node => (
        <Node
          key={node.id}
          node={node}
          isSelected={selectedNodeId === node.id}
          isHovered={hoveredNodeId === node.id}
          onClick={() => onNodeClick?.(node)}
          onHover={(hovered) => setHoveredNodeId(hovered ? node.id : null)}
        />
      ))}

      {/* Camera controls */}
      <OrbitControls
        enablePan={true}
        enableZoom={true}
        enableRotate={true}
        autoRotate={false}
        autoRotateSpeed={0.5}
        minDistance={5}
        maxDistance={50}
      />
    </>
  );
}

// Loading component
function LoadingFallback() {
  return (
    <div className="absolute inset-0 flex items-center justify-center">
      <div className="flex flex-col items-center gap-3">
        <div className="w-8 h-8 border-2 border-neon-cyan border-t-transparent rounded-full animate-spin" />
        <p className="text-sm text-gray-400">Loading 3D space...</p>
      </div>
    </div>
  );
}

// Main component
export function KnowledgeSpace3D({
  nodes,
  onNodeClick,
  selectedNodeId,
  className
}: KnowledgeSpace3DProps) {
  const [autoRotate, setAutoRotate] = useState(false);
  const [showLabels, setShowLabels] = useState(true);

  // Convert flat nodes to 3D positions if not provided
  const nodes3D = useMemo(() => {
    return nodes.map((node, i) => {
      if (node.position) return node;

      // Generate spiral galaxy-like distribution
      const t = i / nodes.length;
      const radius = 5 + t * 15;
      const angle = t * Math.PI * 8;
      const y = (Math.random() - 0.5) * 5;

      return {
        ...node,
        position: [
          Math.cos(angle) * radius,
          y,
          Math.sin(angle) * radius
        ] as [number, number, number]
      };
    });
  }, [nodes]);

  return (
    <div className={cn('relative h-full w-full bg-black', className)}>
      <LensErrorBoundary name="Resonance Universe">
        <Suspense fallback={<LoadingFallback />}>
          <Canvas
            camera={{ position: [0, 10, 25], fov: 60 }}
            gl={{ antialias: true }}
          >
            <Scene
              nodes={nodes3D}
              onNodeClick={onNodeClick}
              selectedNodeId={selectedNodeId}
            />
          </Canvas>
        </Suspense>
      </LensErrorBoundary>

      {/* Controls overlay */}
      <div className="absolute top-4 right-4 flex flex-col gap-2 z-10">
        <div className="flex flex-col bg-black/60 backdrop-blur border border-gray-700 rounded-lg overflow-hidden">
          <button
            onClick={() => setAutoRotate(!autoRotate)}
            className={cn(
              'p-2 transition-colors',
              autoRotate ? 'text-neon-cyan' : 'text-gray-400 hover:text-white'
            )}
            title={autoRotate ? 'Stop rotation' : 'Auto rotate'}
          >
            <RotateCcw className="w-4 h-4" />
          </button>
          <button
            onClick={() => setShowLabels(!showLabels)}
            className={cn(
              'p-2 transition-colors border-t border-gray-700',
              showLabels ? 'text-neon-cyan' : 'text-gray-400 hover:text-white'
            )}
            title={showLabels ? 'Hide labels' : 'Show labels'}
          >
            <Eye className="w-4 h-4" />
          </button>
        </div>
      </div>

      {/* Legend */}
      <div className="absolute bottom-4 left-4 z-10">
        <div className="flex items-center gap-3 px-3 py-2 bg-black/60 backdrop-blur border border-gray-700 rounded-lg">
          {Object.entries(tierConfig).map(([tier, config]) => (
            <div key={tier} className="flex items-center gap-1.5">
              <div
                className="w-3 h-3 rounded-full"
                style={{ backgroundColor: config.color }}
              />
              <span className="text-xs text-gray-400 capitalize">{tier}</span>
            </div>
          ))}
        </div>
      </div>

      {/* Stats */}
      <div className="absolute bottom-4 right-4 text-xs text-gray-400 z-10">
        {nodes.length} nodes in 3D space
      </div>

      {/* Instructions */}
      <motion.div
        initial={{ opacity: 1 }}
        animate={{ opacity: 0 }}
        transition={{ delay: 3, duration: 1 }}
        className="absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 text-center z-10 pointer-events-none"
      >
        <p className="text-gray-400 text-sm">
          Drag to rotate · Scroll to zoom · Click nodes to select
        </p>
      </motion.div>
    </div>
  );
}

