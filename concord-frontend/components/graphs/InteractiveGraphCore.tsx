'use client';

import { useEffect, useRef, useState } from 'react';
import cytoscape, { Core } from 'cytoscape';
import { motion, AnimatePresence } from 'framer-motion';
import {
  ZoomIn,
  ZoomOut,
  Maximize,
  Download,
  RefreshCw,
  Eye,
  EyeOff,
  Search,
  Layers
} from 'lucide-react';
import { cn } from '@/lib/utils';

interface GraphNode {
  id: string;
  label: string;
  tier: 'regular' | 'mega' | 'hyper' | 'shadow';
  tags?: string[];
  resonance?: number;
  createdAt?: string;
}

interface GraphEdge {
  source: string;
  target: string;
  weight?: number;
  type?: string;
}

interface InteractiveGraphProps {
  nodes: GraphNode[];
  edges: GraphEdge[];
  onNodeClick?: (node: GraphNode) => void;
  onNodeDoubleClick?: (node: GraphNode) => void;
  onEdgeClick?: (edge: GraphEdge) => void;
  selectedNodeId?: string;
  className?: string;
  layout?: 'force' | 'circle' | 'grid' | 'hierarchy' | 'concentric';
  showControls?: boolean;
  showMinimap?: boolean;
}

const tierColors = {
  regular: { bg: '#6b7280', border: '#9ca3af', glow: 'rgba(107, 114, 128, 0.5)' },
  mega: { bg: '#22d3ee', border: '#67e8f9', glow: 'rgba(34, 211, 238, 0.5)' },
  hyper: { bg: '#a855f7', border: '#c084fc', glow: 'rgba(168, 85, 247, 0.5)' },
  shadow: { bg: '#374151', border: '#4b5563', glow: 'rgba(55, 65, 81, 0.3)' }
};

const layoutConfigs = {
  force: {
    name: 'cose',
    animate: true,
    animationDuration: 500,
    nodeRepulsion: 8000,
    idealEdgeLength: 100,
    gravity: 0.25
  },
  circle: {
    name: 'circle',
    animate: true,
    animationDuration: 300
  },
  grid: {
    name: 'grid',
    animate: true,
    animationDuration: 300,
    rows: undefined,
    cols: undefined
  },
  hierarchy: {
    name: 'breadthfirst',
    animate: true,
    animationDuration: 300,
    directed: true,
    spacingFactor: 1.5
  },
  concentric: {
    name: 'concentric',
    animate: true,
    animationDuration: 300,
    concentric: (node: cytoscape.NodeSingular) => node.data('resonance') || 1,
    levelWidth: () => 2
  }
};

export function InteractiveGraph({
  nodes,
  edges,
  onNodeClick,
  onNodeDoubleClick,
  onEdgeClick,
  selectedNodeId,
  className,
  layout = 'force',
  showControls = true,
  showMinimap = false
}: InteractiveGraphProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const cyRef = useRef<Core | null>(null);
  const [currentLayout, setCurrentLayout] = useState(layout);
  const [showLabels, setShowLabels] = useState(true);
  const [filterTiers, setFilterTiers] = useState<Set<string>>(new Set(['regular', 'mega', 'hyper', 'shadow']));
  const [searchQuery, setSearchQuery] = useState('');
  const [hoveredNode, setHoveredNode] = useState<GraphNode | null>(null);
  const [tooltipPosition, setTooltipPosition] = useState({ x: 0, y: 0 });

  // Initialize Cytoscape
  useEffect(() => {
    if (!containerRef.current) return;

    const cy = cytoscape({
      container: containerRef.current,
      style: [
        {
          selector: 'node',
          style: {
            'background-color': 'data(color)',
            'border-color': 'data(borderColor)',
            'border-width': 2,
            'label': showLabels ? 'data(label)' : '',
            'color': '#fff',
            'font-size': 10,
            'text-valign': 'bottom',
            'text-margin-y': 5,
            'width': 'data(size)',
            'height': 'data(size)',
            'text-max-width': '80px',
            'text-wrap': 'ellipsis'
          }
        },
        {
          selector: 'node:selected',
          style: {
            'border-width': 4,
            'border-color': '#22d3ee',
            'overlay-opacity': 0.2,
            'overlay-color': '#22d3ee'
          }
        },
        {
          selector: 'node.highlighted',
          style: {
            'border-width': 3,
            'border-color': '#f59e0b'
          }
        },
        {
          selector: 'node.faded',
          style: {
            'opacity': 0.3
          }
        },
        {
          selector: 'edge',
          style: {
            'width': 'data(width)',
            'line-color': '#4b5563',
            'target-arrow-color': '#4b5563',
            'target-arrow-shape': 'triangle',
            'curve-style': 'bezier',
            'opacity': 0.6
          }
        },
        {
          selector: 'edge:selected',
          style: {
            'line-color': '#22d3ee',
            'target-arrow-color': '#22d3ee',
            'opacity': 1
          }
        },
        {
          selector: 'edge.highlighted',
          style: {
            'line-color': '#f59e0b',
            'target-arrow-color': '#f59e0b',
            'opacity': 1
          }
        },
        {
          selector: 'edge.faded',
          style: {
            'opacity': 0.1
          }
        }
      ],
      layout: layoutConfigs[currentLayout] as cytoscape.LayoutOptions,
      minZoom: 0.2,
      maxZoom: 3,
      wheelSensitivity: 0.3
    });

    cyRef.current = cy;

    // Event handlers
    cy.on('tap', 'node', (e) => {
      const nodeData = e.target.data();
      onNodeClick?.(nodeData);
    });

    cy.on('dbltap', 'node', (e) => {
      const nodeData = e.target.data();
      onNodeDoubleClick?.(nodeData);
    });

    cy.on('tap', 'edge', (e) => {
      const edgeData = e.target.data();
      onEdgeClick?.(edgeData);
    });

    cy.on('mouseover', 'node', (e) => {
      const node = e.target;
      const nodeData = node.data();
      const position = node.renderedPosition();

      setHoveredNode(nodeData);
      setTooltipPosition({ x: position.x, y: position.y - 40 });

      // Highlight connected nodes and edges
      const neighborhood = node.neighborhood().add(node);
      cy.elements().addClass('faded');
      neighborhood.removeClass('faded').addClass('highlighted');
    });

    cy.on('mouseout', 'node', () => {
      setHoveredNode(null);
      cy.elements().removeClass('faded highlighted');
    });

    return () => {
      cy.destroy();
    };
  }, [currentLayout, onEdgeClick, onNodeClick, onNodeDoubleClick, showLabels]);

  // Update graph data
  useEffect(() => {
    const cy = cyRef.current;
    if (!cy) return;

    // Filter nodes by tier
    const filteredNodes = nodes.filter(n => filterTiers.has(n.tier));
    const filteredNodeIds = new Set(filteredNodes.map(n => n.id));
    const filteredEdges = edges.filter(e =>
      filteredNodeIds.has(e.source) && filteredNodeIds.has(e.target)
    );

    // Clear and add elements
    cy.elements().remove();

    cy.add([
      ...filteredNodes.map(node => ({
        group: 'nodes' as const,
        data: {
          ...node,
          color: tierColors[node.tier].bg,
          borderColor: tierColors[node.tier].border,
          size: node.tier === 'hyper' ? 50 : node.tier === 'mega' ? 40 : 30
        }
      })),
      ...filteredEdges.map(edge => ({
        group: 'edges' as const,
        data: {
          ...edge,
          id: `${edge.source}-${edge.target}`,
          width: Math.max(1, (edge.weight || 1) * 2)
        }
      }))
    ]);

    // Run layout
    cy.layout(layoutConfigs[currentLayout] as cytoscape.LayoutOptions).run();
  }, [nodes, edges, filterTiers, currentLayout]);

  // Update selected node
  useEffect(() => {
    const cy = cyRef.current;
    if (!cy) return;

    cy.nodes().unselect();
    if (selectedNodeId) {
      cy.getElementById(selectedNodeId).select();
    }
  }, [selectedNodeId]);

  // Update label visibility
  useEffect(() => {
    const cy = cyRef.current;
    if (!cy) return;

    cy.style()
      .selector('node')
      .style('label', showLabels ? 'data(label)' : '')
      .update();
  }, [showLabels]);

  // Search highlight
  useEffect(() => {
    const cy = cyRef.current;
    if (!cy) return;

    cy.nodes().removeClass('highlighted');
    if (searchQuery) {
      cy.nodes().filter(node =>
        node.data('label').toLowerCase().includes(searchQuery.toLowerCase())
      ).addClass('highlighted');
    }
  }, [searchQuery]);

  const handleZoomIn = () => cyRef.current?.zoom(cyRef.current.zoom() * 1.2);
  const handleZoomOut = () => cyRef.current?.zoom(cyRef.current.zoom() / 1.2);
  const handleFit = () => cyRef.current?.fit(undefined, 50);
  const handleRefresh = () => cyRef.current?.layout(layoutConfigs[currentLayout] as cytoscape.LayoutOptions).run();

  const handleExport = () => {
    const cy = cyRef.current;
    if (!cy) return;

    const png = cy.png({ full: true, scale: 2 });
    const link = document.createElement('a');
    link.download = 'knowledge-graph.png';
    link.href = png;
    link.click();
  };

  const toggleTier = (tier: string) => {
    setFilterTiers(prev => {
      const next = new Set(prev);
      if (next.has(tier)) {
        next.delete(tier);
      } else {
        next.add(tier);
      }
      return next;
    });
  };

  return (
    <div className={cn('relative h-full w-full bg-lattice-bg', className)}>
      {/* Graph container */}
      <div ref={containerRef} className="absolute inset-0" />

      {/* Controls */}
      {showControls && (
        <div className="absolute top-4 right-4 flex flex-col gap-2 z-10">
          {/* Zoom controls */}
          <div className="flex flex-col bg-lattice-surface border border-lattice-border rounded-lg overflow-hidden">
            <button
              onClick={handleZoomIn}
              className="p-2 text-gray-400 hover:text-white hover:bg-lattice-border transition-colors"
              title="Zoom in"
            >
              <ZoomIn className="w-4 h-4" />
            </button>
            <button
              onClick={handleZoomOut}
              className="p-2 text-gray-400 hover:text-white hover:bg-lattice-border transition-colors border-t border-lattice-border"
              title="Zoom out"
            >
              <ZoomOut className="w-4 h-4" />
            </button>
            <button
              onClick={handleFit}
              className="p-2 text-gray-400 hover:text-white hover:bg-lattice-border transition-colors border-t border-lattice-border"
              title="Fit to view"
            >
              <Maximize className="w-4 h-4" />
            </button>
          </div>

          {/* View controls */}
          <div className="flex flex-col bg-lattice-surface border border-lattice-border rounded-lg overflow-hidden">
            <button
              onClick={() => setShowLabels(!showLabels)}
              className={cn(
                'p-2 transition-colors',
                showLabels ? 'text-neon-cyan' : 'text-gray-400 hover:text-white'
              )}
              title={showLabels ? 'Hide labels' : 'Show labels'}
            >
              {showLabels ? <Eye className="w-4 h-4" /> : <EyeOff className="w-4 h-4" />}
            </button>
            <button
              onClick={handleRefresh}
              className="p-2 text-gray-400 hover:text-white hover:bg-lattice-border transition-colors border-t border-lattice-border"
              title="Refresh layout"
            >
              <RefreshCw className="w-4 h-4" />
            </button>
            <button
              onClick={handleExport}
              className="p-2 text-gray-400 hover:text-white hover:bg-lattice-border transition-colors border-t border-lattice-border"
              title="Export as image"
            >
              <Download className="w-4 h-4" />
            </button>
          </div>
        </div>
      )}

      {/* Layout selector */}
      {showControls && (
        <div className="absolute top-4 left-4 z-10">
          <div className="flex items-center gap-2 p-2 bg-lattice-surface border border-lattice-border rounded-lg">
            <Layers className="w-4 h-4 text-gray-400" />
            <select
              value={currentLayout}
              onChange={(e) => setCurrentLayout(e.target.value as typeof currentLayout)}
              className="bg-transparent text-sm text-white focus:outline-none cursor-pointer"
            >
              <option value="force">Force-directed</option>
              <option value="circle">Circle</option>
              <option value="grid">Grid</option>
              <option value="hierarchy">Hierarchy</option>
              <option value="concentric">Concentric</option>
            </select>
          </div>
        </div>
      )}

      {/* Search */}
      {showControls && (
        <div className="absolute bottom-4 left-4 right-4 z-10">
          <div className="flex items-center gap-3 max-w-md">
            <div className="flex-1 flex items-center gap-2 px-3 py-2 bg-lattice-surface border border-lattice-border rounded-lg">
              <Search className="w-4 h-4 text-gray-400" />
              <input
                type="text"
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                placeholder="Search nodes..."
                className="flex-1 bg-transparent text-sm text-white placeholder-gray-500 focus:outline-none"
              />
            </div>

            {/* Tier filters */}
            <div className="flex items-center gap-1 p-1 bg-lattice-surface border border-lattice-border rounded-lg">
              {Object.entries(tierColors).map(([tier, colors]) => (
                <button
                  key={tier}
                  onClick={() => toggleTier(tier)}
                  className={cn(
                    'w-6 h-6 rounded transition-opacity',
                    filterTiers.has(tier) ? 'opacity-100' : 'opacity-30'
                  )}
                  style={{ backgroundColor: colors.bg }}
                  title={`${filterTiers.has(tier) ? 'Hide' : 'Show'} ${tier} nodes`}
                />
              ))}
            </div>
          </div>
        </div>
      )}

      {/* Node tooltip */}
      <AnimatePresence>
        {hoveredNode && (
          <motion.div
            initial={{ opacity: 0, y: 10 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: 10 }}
            style={{
              position: 'absolute',
              left: tooltipPosition.x,
              top: tooltipPosition.y,
              transform: 'translate(-50%, -100%)'
            }}
            className="pointer-events-none z-20"
          >
            <div className="px-3 py-2 bg-lattice-bg border border-lattice-border rounded-lg shadow-xl">
              <p className="text-sm font-medium text-white">{hoveredNode.label}</p>
              <p className="text-xs text-gray-400 capitalize">{hoveredNode.tier} DTU</p>
              {hoveredNode.resonance && (
                <p className="text-xs text-neon-cyan">
                  Resonance: {(hoveredNode.resonance * 100).toFixed(0)}%
                </p>
              )}
            </div>
          </motion.div>
        )}
      </AnimatePresence>

      {/* Minimap overlay */}
      {showMinimap && (
        <div className="absolute top-4 left-1/2 -translate-x-1/2 z-10 pointer-events-none">
          <div className="w-40 h-28 bg-lattice-bg/80 border border-lattice-border rounded-lg overflow-hidden backdrop-blur-sm">
            <div className="w-full h-full relative">
              {nodes.map(node => {
                const colors = tierColors[node.tier];
                return (
                  <div
                    key={node.id}
                    className="absolute w-1.5 h-1.5 rounded-full"
                    style={{
                      backgroundColor: colors.bg,
                      left: `${((node as GraphNode & { x?: number }).x ?? Math.random() * 100) % 100}%`,
                      top: `${((node as GraphNode & { y?: number }).y ?? Math.random() * 100) % 100}%`,
                    }}
                  />
                );
              })}
            </div>
          </div>
        </div>
      )}

      {/* Stats overlay */}
      <div className="absolute bottom-4 right-4 text-xs text-gray-400 z-10">
        {nodes.length} nodes · {edges.length} edges
      </div>
    </div>
  );
}
