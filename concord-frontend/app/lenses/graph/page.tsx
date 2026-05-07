'use client';

import { useState, useRef, useEffect, useCallback, useMemo } from 'react';
import { useLensNav } from '@/hooks/useLensNav';
import { useQuery } from '@tanstack/react-query';
import { apiHelpers } from '@/lib/api/client';
import { useLensData } from '@/lib/hooks/use-lens-data';
import { useRunArtifact } from '@/lib/hooks/use-lens-artifacts';
import { motion, AnimatePresence } from 'framer-motion';
import {
  ZoomIn, ZoomOut, RotateCcw, Search, Eye, EyeOff,
  Circle, X, Play, Pause, Settings, Download,
  Share2, GitBranch, ChevronRight, Copy, ExternalLink,
  Plus, Link2, User, AudioWaveform,
  TreePine, Users, Filter,
  Layers, ChevronDown, Loader2, BarChart3, Network, Cpu,
} from 'lucide-react';
import { cn } from '@/lib/utils';
import { UniversalActions } from '@/components/lens/UniversalActions';
import { ErrorState } from '@/components/common/EmptyState';
import { showToast } from '@/components/common/Toasts';
import { useLensDTUs } from '@/hooks/useLensDTUs';
import { LensContextPanel } from '@/components/lens/LensContextPanel';
import { FeedbackWidget } from '@/components/feedback/FeedbackWidget';
import { useRealtimeLens } from '@/hooks/useRealtimeLens';
import { LiveIndicator } from '@/components/lens/LiveIndicator';
import { DTUExportButton } from '@/components/lens/DTUExportButton';
import { RealtimeDataPanel } from '@/components/lens/RealtimeDataPanel';
import { LensFeaturePanel } from '@/components/lens/LensFeaturePanel';
import { ProvenanceBadge } from '@/components/dtu/ProvenanceBadge';
import { useLatticeStore } from '@/store/lattice';
import { InteractiveGraph } from '@/components/graphs/InteractiveGraphCore';
import { KnowledgeSpace3D } from '@/components/graphs/KnowledgeSpace3D';
import { FractalEmpireExplorer } from '@/components/graphs/FractalEmpireExplorer';
import KnowledgeGenomeBrowser from '@/components/visualizations/KnowledgeGenomeBrowser';

// --- Types ---

type NodeType = 'regular' | 'mega' | 'hyper' | 'shadow' | 'track' | 'artist' | 'sample' | 'release';
type EdgeType = 'parent' | 'sibling' | 'semantic' | 'temporal' | 'sampled_from' | 'remixed_by' | 'collaborated_with' | 'released_on';
type LayoutMode = 'force' | 'radial' | 'hierarchical';
type ViewMode = 'default' | 'heatmap' | 'cluster' | 'sample_tree' | 'collab_network' | 'interactive' | '3d' | 'fractal';

interface GraphNode {
  id: string;
  label: string;
  tier: NodeType;
  x: number;
  y: number;
  vx: number;
  vy: number;
  fx: number | null;
  fy: number | null;
  connections: number;
  tags: string[];
  createdAt: string;
  cluster?: number;
  content?: string;
  nodeType?: NodeType;
  bpm?: number;
  key?: string;
  genre?: string;
  playCount?: number;
  collabCount?: number;
  rating?: number;
  originalSource?: string;
  releaseDate?: string;
  platform?: string;
  trackList?: string[];
}

interface GraphEdge {
  source: string;
  target: string;
  weight: number;
  type?: EdgeType;
}

// --- Color maps ---

const NODE_COLORS: Record<NodeType, { fill: string; glow: string; name: string; icon: string }> = {
  regular: { fill: '#00d4ff', glow: 'rgba(0, 212, 255, 0.5)', name: 'Regular', icon: 'circle' },
  mega:    { fill: '#a855f7', glow: 'rgba(168, 85, 247, 0.5)', name: 'MEGA', icon: 'circle' },
  hyper:   { fill: '#ec4899', glow: 'rgba(236, 72, 153, 0.5)', name: 'HYPER', icon: 'circle' },
  shadow:  { fill: '#6b7280', glow: 'rgba(107, 114, 128, 0.3)', name: 'Shadow', icon: 'circle' },
  track:   { fill: '#06b6d4', glow: 'rgba(6, 182, 212, 0.5)', name: 'Track', icon: 'music' },
  artist:  { fill: '#8b5cf6', glow: 'rgba(139, 92, 246, 0.5)', name: 'Artist', icon: 'user' },
  sample:  { fill: '#22c55e', glow: 'rgba(34, 197, 94, 0.5)', name: 'Sample', icon: 'wave' },
  release: { fill: '#f472b6', glow: 'rgba(244, 114, 182, 0.5)', name: 'Release', icon: 'disc' },
};

const EDGE_COLORS: Record<EdgeType, string> = {
  parent: '#a855f7',
  sibling: '#00d4ff',
  semantic: '#22c55e',
  temporal: '#f59e0b',
  sampled_from: '#10b981',
  remixed_by: '#f97316',
  collaborated_with: '#8b5cf6',
  released_on: '#f472b6',
};

const EDGE_LABELS: Record<EdgeType, string> = {
  parent: 'Parent', sibling: 'Sibling', semantic: 'Semantic', temporal: 'Temporal',
  sampled_from: 'Sampled From', remixed_by: 'Remixed By',
  collaborated_with: 'Collaborated', released_on: 'Released On',
};

const CLUSTER_COLORS = [
  '#00d4ff', '#a855f7', '#ec4899', '#22c55e', '#f59e0b',
  '#ef4444', '#8b5cf6', '#06b6d4', '#84cc16', '#f97316',
];

// --- Helpers for drawing node icons on canvas ---

function drawNodeIcon(ctx: CanvasRenderingContext2D, node: GraphNode, cx: number, cy: number, r: number) {
  const iconType = NODE_COLORS[node.tier]?.icon || 'circle';
  ctx.save();
  ctx.strokeStyle = '#0f0f1a';
  ctx.lineWidth = 1.5;
  ctx.fillStyle = '#0f0f1a';
  const s = r * 0.5;

  if (iconType === 'music') {
    // Music note
    ctx.beginPath();
    ctx.arc(cx - s * 0.3, cy + s * 0.3, s * 0.35, 0, Math.PI * 2);
    ctx.fill();
    ctx.beginPath();
    ctx.moveTo(cx - s * 0.3 + s * 0.35, cy + s * 0.3);
    ctx.lineTo(cx - s * 0.3 + s * 0.35, cy - s * 0.7);
    ctx.lineTo(cx + s * 0.5, cy - s * 0.9);
    ctx.stroke();
  } else if (iconType === 'user') {
    // User silhouette
    ctx.beginPath();
    ctx.arc(cx, cy - s * 0.3, s * 0.35, 0, Math.PI * 2);
    ctx.fill();
    ctx.beginPath();
    ctx.arc(cx, cy + s * 0.6, s * 0.55, Math.PI, 0);
    ctx.fill();
  } else if (iconType === 'wave') {
    // Waveform
    ctx.beginPath();
    ctx.lineWidth = 1.5;
    const bars = 5;
    const bw = (s * 1.4) / bars;
    const heights = [0.4, 0.8, 1.0, 0.7, 0.3];
    for (let i = 0; i < bars; i++) {
      const bx = cx - s * 0.7 + i * bw + bw / 2;
      const bh = s * heights[i];
      ctx.moveTo(bx, cy - bh / 2);
      ctx.lineTo(bx, cy + bh / 2);
    }
    ctx.stroke();
  } else if (iconType === 'disc') {
    // Disc
    ctx.beginPath();
    ctx.arc(cx, cy, s * 0.7, 0, Math.PI * 2);
    ctx.stroke();
    ctx.beginPath();
    ctx.arc(cx, cy, s * 0.2, 0, Math.PI * 2);
    ctx.fill();
  }
  ctx.restore();
}

// --- Main component ---

export default function GraphLensPage() {
  useLensNav('graph');
  const { latestData: realtimeData, alerts: realtimeAlerts, insights: realtimeInsights, isLive, lastUpdated } = useRealtimeLens('graph');

  // Real-time topology stats from lattice store (populated by resonance:update socket events)
  const topologyStats = useLatticeStore((s) => s.topologyStats);

  const {
    hyperDTUs, megaDTUs, regularDTUs,
    tierDistribution, publishToMarketplace,
    isLoading: dtusLoading, refetch: refetchDTUs,
  } = useLensDTUs({ lens: 'graph' });

  const canvasRef = useRef<HTMLCanvasElement>(null);
  const containerRef = useRef<HTMLDivElement>(null);
  const animationRef = useRef<number>();
  const nodesRef = useRef<GraphNode[]>([]);

  // Core graph state
  const [zoom, setZoom] = useState(1);
  const [offset, setOffset] = useState({ x: 0, y: 0 });
  const [isDragging, setIsDragging] = useState(false);
  const [dragStart, setDragStart] = useState({ x: 0, y: 0 });
  const [selectedNode, setSelectedNode] = useState<GraphNode | null>(null);
  const [hoveredNode, setHoveredNode] = useState<GraphNode | null>(null);
  const [draggedNode, setDraggedNode] = useState<GraphNode | null>(null);
  const [dimensions, setDimensions] = useState({ width: 800, height: 600 });
  const [searchQuery, setSearchQuery] = useState('');
  const [filterTiers, setFilterTiers] = useState<Set<string>>(new Set(['regular', 'mega', 'hyper', 'shadow']));
  const [showAutogen, setShowAutogen] = useState(false);
  const [showShadowConnections, setShowShadowConnections] = useState(false);
  const [showIsolated, setShowIsolated] = useState(false);
  const [nodeLimit, setNodeLimit] = useState(100);
  const [showLabels, setShowLabels] = useState(true);
  const [isSimulating, setIsSimulating] = useState(true);
  const [layoutMode, setLayoutMode] = useState<LayoutMode>('force');
  const [viewMode, setViewMode] = useState<ViewMode>('default');
  const [showSettings, setShowSettings] = useState(false);
  const [showPathfinder, setShowPathfinder] = useState(false);
  const [pathStart, setPathStart] = useState<string | null>(null);
  const [pathEnd, setPathEnd] = useState<string | null>(null);
  const [foundPath, setFoundPath] = useState<string[]>([]);
  const [showEdgeTypes, setShowEdgeTypes] = useState(true);
  const [clusterCount, setClusterCount] = useState(5);

  // Lens artifact persistence layer for graph entities
  const { isLoading, isError: isError, error: error, refetch: refetch, create: createEntity } = useLensData('graph', 'entity', { noSeed: true });
  const [contextMenu, setContextMenu] = useState<{ x: number; y: number; node: GraphNode } | null>(null);
  const [showLegend, setShowLegend] = useState(true);

  // Creative network state
  const [connectMode, setConnectMode] = useState(false);
  const [connectSource, setConnectSource] = useState<string | null>(null);
  const [newEdgeType, setNewEdgeType] = useState<EdgeType>('semantic');
  const [showAddNode, setShowAddNode] = useState(false);
  const [showFeatures, setShowFeatures] = useState(true);
  const [addNodeType, setAddNodeType] = useState<NodeType>('track');
  // --- Graph action wiring ---
  const { items: graphArtifacts } = useLensData('graph', 'graph-data', { seed: [] });
  const runGraphAction = useRunArtifact('graph');
  const [graphActionResult, setGraphActionResult] = useState<{ action: string; data: unknown } | null>(null);
  const handleGraphAction = useCallback((action: string) => {
    const artifactId = graphArtifacts[0]?.id;
    if (!artifactId) return;
    runGraphAction.mutate(
      { id: artifactId, action, params: {} },
      { onSuccess: (res) => setGraphActionResult({ action, data: res.result }) }
    );
  }, [graphArtifacts, runGraphAction]);
  const [addNodeLabel, setAddNodeLabel] = useState('');
  const [localEdges, setLocalEdges] = useState<GraphEdge[]>([]);
  const [filterRelated, setFilterRelated] = useState<string | null>(null);
  const [searchType, setSearchType] = useState<string>('all');
  const [bpmRange, setBpmRange] = useState<[number, number]>([0, 300]);
  const [hiddenEdgeTypes, setHiddenEdgeTypes] = useState<Set<string>>(new Set());
  const [hiddenNodeTypes, setHiddenNodeTypes] = useState<Set<string>>(new Set());
  const [focusedNodeIndex, setFocusedNodeIndex] = useState(-1);

  const [simParams, setSimParams] = useState({
    repulsion: 500,
    attraction: 0.01,
    damping: 0.9,
    centerGravity: 0.02,
    linkStrength: 0.3,
  });

  // --- Data fetching ---

  const { data: dtus, isError: isError2, error: error2, refetch: refetch2,} = useQuery({
    queryKey: ['dtus-graph'],
    queryFn: () => apiHelpers.dtus.paginated({ limit: 500 }).then((r) => r.data),
  });

  const { data: links, isError: isError3, error: error3, refetch: refetch3,} = useQuery({
    queryKey: ['links-graph'],
    queryFn: () => apiHelpers.worldmodel.relations().then((r) => r.data),
    retry: 1,
  });

  // Fetch force-directed graph data from dedicated endpoint
  const { data: graphForceData } = useQuery({
    queryKey: ['graph-force'],
    queryFn: () => apiHelpers.graph.force({ maxNodes: 500 }).then((r) => r.data),
    retry: 1,
    staleTime: 30000,
  });

  // Fetch graph visual data (tier-based), with optional shadow connections
  const { data: graphVisualData } = useQuery({
    queryKey: ['graph-visual', showShadowConnections],
    queryFn: () => apiHelpers.graph.visual({ limit: 500, includeShadow: showShadowConnections || undefined }).then((r) => r.data),
    retry: 1,
    staleTime: 30000,
  });

  // Subscribe to live DTU creation events for real-time graph updates
  useEffect(() => {
    let unsubCreated: (() => void) | undefined;
    let unsubPromoted: (() => void) | undefined;
    let unsubResonance: (() => void) | undefined;

    import('@/lib/realtime/socket').then(({ connectSocket, subscribe: socketSubscribe }) => {
      connectSocket();

      unsubCreated = socketSubscribe('dtu:created', () => {
        refetch2();
      });
      unsubPromoted = socketSubscribe('dtu:promoted', () => {
        refetch2();
      });
      unsubResonance = socketSubscribe('resonance:update', () => {
        refetch2();
        refetch3();
      });
    });

    return () => {
      unsubCreated?.();
      unsubPromoted?.();
      unsubResonance?.();
    };
  }, [refetch2, refetch3]);

  // --- Graph algorithms ---

  const graphDistance = useCallback((start: string, end: string, adjacency: Map<string, Set<string>>): number => {
    if (start === end) return 0;
    const visited = new Set<string>([start]);
    const queue = [{ id: start, dist: 0 }];
    while (queue.length > 0) {
      const { id, dist } = queue.shift()!;
      if (dist > 10) return Infinity;
      for (const neighbor of adjacency.get(id) || []) {
        if (neighbor === end) return dist + 1;
        if (!visited.has(neighbor)) {
          visited.add(neighbor);
          queue.push({ id: neighbor, dist: dist + 1 });
        }
      }
    }
    return Infinity;
  }, []);

  const assignClusters = useCallback((nodes: GraphNode[], linksList: Record<string, unknown>[], k: number) => {
    const adjacency = new Map<string, Set<string>>();
    nodes.forEach(n => adjacency.set(n.id, new Set()));
    linksList.forEach((l: Record<string, unknown>) => {
      adjacency.get(l.sourceId as string)?.add(l.targetId as string);
      adjacency.get(l.targetId as string)?.add(l.sourceId as string);
    });
    const sortedByConnections = [...nodes].sort((a, b) => b.connections - a.connections);
    const centroids = sortedByConnections.slice(0, k).map(n => n.id);
    nodes.forEach(node => {
      let minDist = Infinity;
      let cluster = 0;
      centroids.forEach((centroid, idx) => {
        const dist = graphDistance(node.id, centroid, adjacency);
        if (dist < minDist) { minDist = dist; cluster = idx; }
      });
      node.cluster = cluster;
    });
  }, [graphDistance]);

  // --- Initialize graph ---

  // Detect whether any music-domain DTUs exist
  const hasMusicDomain = useMemo(() => {
    const dtuList = dtus?.dtus || [];
    return dtuList.some((d: Record<string, unknown>) =>
      d.domain === 'music' || d.tier === 'track' || d.tier === 'artist' || d.tier === 'sample' || d.tier === 'release' || d.bpm != null
    );
  }, [dtus]);

  const initializeGraphData = useCallback(() => {
    let dtuList = dtus?.dtus || [];
    // Normalize: backend force graph returns 'links', visual returns 'edges'
    const linkList = links?.links || links?.edges || graphForceData?.links || graphForceData?.edges || graphVisualData?.edges || graphVisualData?.links || [];

    // Filter out autogenerated DTUs by default (pattern: truncated form descriptions)
    if (!showAutogen) {
      dtuList = dtuList.filter((d: Record<string, unknown>) => {
        const title = (d.title as string) || (d.content as string) || '';
        // Heuristic: autogenerated DTUs often have these patterns
        const isAutogen = /^(Cluster Compression|Pattern Extraction|form):/i.test(title);
        return !isAutogen;
      });
    }

    // Cap node count
    dtuList = dtuList.slice(0, nodeLimit);
    const width = dimensions.width;
    const height = dimensions.height;

    const nodes: GraphNode[] = dtuList.map((dtu: Record<string, unknown>, i: number) => {
      let x: number, y: number;
      if (layoutMode === 'radial') {
        const angle = (2 * Math.PI * i) / dtuList.length;
        const radius = Math.min(width, height) * 0.35;
        x = width / 2 + Math.cos(angle) * radius;
        y = height / 2 + Math.sin(angle) * radius;
      } else if (layoutMode === 'hierarchical') {
        const tier = (dtu.tier as string) || 'regular';
        const tierOrder: Record<string, number> = { hyper: 0, mega: 1, regular: 2, shadow: 3, track: 4, artist: 5, sample: 6, release: 7 };
        const tierY = ((tierOrder[tier] ?? 2) + 1) * (height / 10);
        x = (i % 10 + 1) * (width / 11);
        y = tierY + (Math.random() - 0.5) * 50;
      } else {
        x = width / 2 + (Math.random() - 0.5) * width * 0.6;
        y = height / 2 + (Math.random() - 0.5) * height * 0.6;
      }
      const tier = ((dtu.tier as string) || 'regular') as NodeType;
      return {
        id: dtu.id as string,
        label: (dtu.title as string) || (dtu.content as string)?.slice(0, 30) || `DTU ${i}`,
        tier,
        nodeType: tier,
        x, y, vx: 0, vy: 0, fx: null, fy: null,
        connections: linkList.filter((l: Record<string, unknown>) => l.sourceId === dtu.id || l.targetId === dtu.id).length,
        tags: (dtu.tags as string[]) || [],
        createdAt: dtu.createdAt as string,
        content: dtu.content as string,
        bpm: (dtu.bpm as number) || undefined,
        key: (dtu.key as string) || undefined,
        genre: (dtu.genre as string) || undefined,
        playCount: (dtu.playCount as number) || undefined,
      } as GraphNode;
    });

    if (viewMode === 'cluster') assignClusters(nodes, linkList, clusterCount);

    nodesRef.current = nodes;
    const apiEdges: GraphEdge[] = linkList.map((link: Record<string, unknown>) => ({
      source: link.sourceId as string,
      target: link.targetId as string,
      weight: (link.weight as number) || 0.5,
      type: ((link.type as string) || 'semantic') as EdgeType,
    }));
    return { nodes, edges: [...apiEdges, ...localEdges] };
  }, [dtus, links, dimensions, layoutMode, viewMode, clusterCount, assignClusters, localEdges, showAutogen, nodeLimit, graphForceData, graphVisualData]);

  const graphData = useMemo(() => initializeGraphData(), [initializeGraphData]);

  // --- Physics simulation ---

  useEffect(() => {
    if (!isSimulating || layoutMode !== 'force') return;
    const simulate = () => {
      const nodes = nodesRef.current;
      const edges = graphData.edges;
      const width = dimensions.width;
      const height = dimensions.height;

      nodes.forEach((node, i) => {
        if (node.fx !== null) { node.x = node.fx; node.vx = 0; }
        if (node.fy !== null) { node.y = node.fy; node.vy = 0; }
        node.vx += (width / 2 - node.x) * simParams.centerGravity;
        node.vy += (height / 2 - node.y) * simParams.centerGravity;
        nodes.forEach((other, j) => {
          if (i === j) return;
          const dx = node.x - other.x;
          const dy = node.y - other.y;
          const dist = Math.sqrt(dx * dx + dy * dy) || 1;
          const force = simParams.repulsion / (dist * dist);
          node.vx += (dx / dist) * force;
          node.vy += (dy / dist) * force;
        });
      });

      edges.forEach(edge => {
        const source = nodes.find(n => n.id === edge.source);
        const target = nodes.find(n => n.id === edge.target);
        if (!source || !target) return;
        const dx = target.x - source.x;
        const dy = target.y - source.y;
        const dist = Math.sqrt(dx * dx + dy * dy) || 1;
        const force = dist * simParams.attraction * simParams.linkStrength * (edge.weight + 0.5);
        source.vx += (dx / dist) * force;
        source.vy += (dy / dist) * force;
        target.vx -= (dx / dist) * force;
        target.vy -= (dy / dist) * force;
      });

      nodes.forEach(node => {
        if (node.fx === null) {
          node.vx *= simParams.damping;
          node.x += node.vx;
          node.x = Math.max(50, Math.min(width - 50, node.x));
        }
        if (node.fy === null) {
          node.vy *= simParams.damping;
          node.y += node.vy;
          node.y = Math.max(50, Math.min(height - 50, node.y));
        }
      });
      animationRef.current = requestAnimationFrame(simulate);
    };
    simulate();
    return () => { if (animationRef.current) cancelAnimationFrame(animationRef.current); };
  }, [isSimulating, layoutMode, graphData.edges, dimensions, simParams]);

  // --- Resize observer ---

  useEffect(() => {
    const updateDimensions = () => {
      if (containerRef.current) {
        setDimensions({ width: containerRef.current.clientWidth, height: containerRef.current.clientHeight });
      }
    };
    updateDimensions();
    window.addEventListener('resize', updateDimensions);
    return () => window.removeEventListener('resize', updateDimensions);
  }, []);

  // --- Pathfinder BFS ---

  const findPath = useCallback((startId: string, endId: string): string[] => {
    if (!startId || !endId) return [];
    const adjacency = new Map<string, string[]>();
    graphData.edges.forEach(edge => {
      if (!adjacency.has(edge.source)) adjacency.set(edge.source, []);
      if (!adjacency.has(edge.target)) adjacency.set(edge.target, []);
      adjacency.get(edge.source)!.push(edge.target);
      adjacency.get(edge.target)!.push(edge.source);
    });
    const queue = [[startId]];
    const visited = new Set([startId]);
    while (queue.length > 0) {
      const path = queue.shift()!;
      const node = path[path.length - 1];
      if (node === endId) return path;
      for (const neighbor of adjacency.get(node) || []) {
        if (!visited.has(neighbor)) { visited.add(neighbor); queue.push([...path, neighbor]); }
      }
    }
    return [];
  }, [graphData.edges]);

  useEffect(() => {
    if (pathStart && pathEnd) setFoundPath(findPath(pathStart, pathEnd));
    else setFoundPath([]);
  }, [pathStart, pathEnd, findPath]);

  // --- Get related node ids for "View Related" filter ---

  const relatedNodeIds = useMemo(() => {
    if (!filterRelated) return null;
    const ids = new Set<string>([filterRelated]);
    graphData.edges.forEach(e => {
      if (e.source === filterRelated) ids.add(e.target);
      if (e.target === filterRelated) ids.add(e.source);
    });
    return ids;
  }, [filterRelated, graphData.edges]);

  // --- Canvas rendering ---

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    const render = () => {
      const nodes = nodesRef.current;
      canvas.width = dimensions.width * 2;
      canvas.height = dimensions.height * 2;
      ctx.scale(2, 2);

      // Background gradient
      const bgGradient = ctx.createRadialGradient(
        dimensions.width / 2, dimensions.height / 2, 0,
        dimensions.width / 2, dimensions.height / 2, Math.max(dimensions.width, dimensions.height)
      );
      bgGradient.addColorStop(0, '#0f0f1a');
      bgGradient.addColorStop(1, '#0a0a0f');
      ctx.fillStyle = bgGradient;
      ctx.fillRect(0, 0, dimensions.width, dimensions.height);

      // Grid
      ctx.strokeStyle = 'rgba(100, 100, 150, 0.1)';
      ctx.lineWidth = 1;
      const gridSize = 50 * zoom;
      for (let x = (offset.x % gridSize); x < dimensions.width; x += gridSize) {
        ctx.beginPath(); ctx.moveTo(x, 0); ctx.lineTo(x, dimensions.height); ctx.stroke();
      }
      for (let y = (offset.y % gridSize); y < dimensions.height; y += gridSize) {
        ctx.beginPath(); ctx.moveTo(0, y); ctx.lineTo(dimensions.width, y); ctx.stroke();
      }

      ctx.save();
      ctx.translate(dimensions.width / 2 + offset.x, dimensions.height / 2 + offset.y);
      ctx.scale(zoom, zoom);
      ctx.translate(-dimensions.width / 2, -dimensions.height / 2);

      // Filter nodes
      const filteredNodes = nodes.filter((n: GraphNode) => {
        if (!filterTiers.has(n.tier)) return false;
        if (hiddenNodeTypes.has(n.tier)) return false;
        if (relatedNodeIds && !relatedNodeIds.has(n.id)) return false;

        // Hide isolated nodes (no edges) unless explicitly shown
        if (!showIsolated && n.connections === 0 && !searchQuery) return false;

        // Search filtering
        if (searchQuery) {
          const q = searchQuery.toLowerCase();
          const matchLabel = n.label.toLowerCase().includes(q);
          const matchTag = n.tags.some(t => t.toLowerCase().includes(q));
          const matchGenre = n.genre?.toLowerCase().includes(q);
          if (!matchLabel && !matchTag && !matchGenre) return false;
        }
        if (searchType !== 'all' && n.tier !== searchType) return false;
        if (n.bpm !== undefined && (n.bpm < bpmRange[0] || n.bpm > bpmRange[1])) return false;

        // View mode filters
        if (viewMode === 'sample_tree') {
          return n.tier === 'sample' || n.tier === 'track' ||
            graphData.edges.some(e => (e.type === 'sampled_from') && (e.source === n.id || e.target === n.id));
        }
        if (viewMode === 'collab_network') {
          return n.tier === 'artist' ||
            graphData.edges.some(e => (e.type === 'collaborated_with') && (e.source === n.id || e.target === n.id));
        }
        return true;
      });

      const nodeIds = new Set(filteredNodes.map((n: GraphNode) => n.id));
      const pathSet = new Set(foundPath);

      // Draw edges
      graphData.edges.forEach((edge: GraphEdge) => {
        if (!nodeIds.has(edge.source) || !nodeIds.has(edge.target)) return;
        if (edge.type && hiddenEdgeTypes.has(edge.type)) return;
        const source = filteredNodes.find((n: GraphNode) => n.id === edge.source);
        const target = filteredNodes.find((n: GraphNode) => n.id === edge.target);
        if (!source || !target) return;

        const isPathEdge = foundPath.length > 1 &&
          pathSet.has(edge.source) && pathSet.has(edge.target) &&
          Math.abs(foundPath.indexOf(edge.source) - foundPath.indexOf(edge.target)) === 1;

        ctx.beginPath();
        ctx.moveTo(source.x, source.y);
        const midX = (source.x + target.x) / 2;
        const midY = (source.y + target.y) / 2;
        const dx = target.x - source.x;
        const dy = target.y - source.y;
        const dist = Math.sqrt(dx * dx + dy * dy) || 1;
        const curveOffset = Math.min(50, dist * 0.1);
        const ctrlX = midX - dy * curveOffset / dist;
        const ctrlY = midY + dx * curveOffset / dist;
        ctx.quadraticCurveTo(ctrlX, ctrlY, target.x, target.y);

        if (isPathEdge) {
          ctx.strokeStyle = '#22c55e';
          ctx.lineWidth = 4;
          ctx.shadowColor = '#22c55e';
          ctx.shadowBlur = 10;
        } else if ((edge as GraphEdge & { isShadow?: boolean }).isShadow || (edge.type as string) === 'shadow_reference') {
          // Feature 42: Shadow edges render as dotted/faded lines
          ctx.strokeStyle = 'rgba(107, 114, 128, 0.35)';
          ctx.lineWidth = 1;
          ctx.shadowBlur = 0;
          ctx.setLineDash([4, 6]);
        } else if (showEdgeTypes && edge.type) {
          ctx.strokeStyle = EDGE_COLORS[edge.type as EdgeType] || 'rgba(100, 100, 150, 0.3)';
          ctx.lineWidth = 1 + edge.weight * 2;
          ctx.shadowBlur = 0;
          // Dashed lines for sample/remix edges
          if (edge.type === 'sampled_from' || edge.type === 'remixed_by') {
            ctx.setLineDash([6, 4]);
          }
        } else {
          ctx.strokeStyle = `rgba(100, 100, 150, ${0.2 + edge.weight * 0.3})`;
          ctx.lineWidth = 1 + edge.weight;
          ctx.shadowBlur = 0;
        }
        ctx.stroke();
        ctx.setLineDash([]);
        ctx.shadowBlur = 0;

        // Draw directional arrow for sampled_from / released_on
        if (edge.type === 'sampled_from' || edge.type === 'released_on' || edge.type === 'remixed_by') {
          const arrowLen = 8;
          const angle = Math.atan2(target.y - ctrlY, target.x - ctrlX);
          const tr = (target.tier === 'hyper' ? 18 : target.tier === 'mega' ? 14 : 10) + 2;
          const ax = target.x - Math.cos(angle) * tr;
          const ay = target.y - Math.sin(angle) * tr;
          ctx.beginPath();
          ctx.moveTo(ax, ay);
          ctx.lineTo(ax - arrowLen * Math.cos(angle - 0.4), ay - arrowLen * Math.sin(angle - 0.4));
          ctx.lineTo(ax - arrowLen * Math.cos(angle + 0.4), ay - arrowLen * Math.sin(angle + 0.4));
          ctx.closePath();
          ctx.fillStyle = EDGE_COLORS[edge.type as EdgeType] || '#666';
          ctx.fill();
        }
      });

      // Draw connect-mode preview line
      if (connectMode && connectSource) {
        const srcNode = filteredNodes.find(n => n.id === connectSource);
        if (srcNode && hoveredNode && hoveredNode.id !== connectSource) {
          ctx.beginPath();
          ctx.moveTo(srcNode.x, srcNode.y);
          ctx.lineTo(hoveredNode.x, hoveredNode.y);
          ctx.strokeStyle = 'rgba(0, 212, 255, 0.6)';
          ctx.lineWidth = 2;
          ctx.setLineDash([8, 4]);
          ctx.stroke();
          ctx.setLineDash([]);
        }
      }

      // Draw nodes
      filteredNodes.forEach((node: GraphNode) => {
        const colors = NODE_COLORS[node.tier] || NODE_COLORS.regular;
        let radius = node.tier === 'hyper' ? 18 : node.tier === 'mega' ? 14 :
          (node.tier === 'track' || node.tier === 'artist' || node.tier === 'sample' || node.tier === 'release') ? 12 : 10;
        if (viewMode === 'heatmap') radius = 8 + Math.min(node.connections * 2, 20);

        const isSelected = selectedNode?.id === node.id;
        const isHovered = hoveredNode?.id === node.id;
        const isInPath = pathSet.has(node.id);
        const isPathEndpoint = node.id === pathStart || node.id === pathEnd;
        const isConnectSrc = connectMode && connectSource === node.id;

        let fillColor = colors.fill;
        let glowColor = colors.glow;
        if (viewMode === 'cluster' && node.cluster !== undefined) {
          fillColor = CLUSTER_COLORS[node.cluster % CLUSTER_COLORS.length];
          glowColor = fillColor + '80';
        }

        // Glow effect
        if (isSelected || isHovered || isInPath || isConnectSrc) {
          const glowRadius = radius * (isPathEndpoint ? 4 : 3);
          const gradient = ctx.createRadialGradient(node.x, node.y, 0, node.x, node.y, glowRadius);
          gradient.addColorStop(0, isInPath ? 'rgba(34, 197, 94, 0.6)' : isConnectSrc ? 'rgba(0, 212, 255, 0.7)' : glowColor);
          gradient.addColorStop(1, 'transparent');
          ctx.fillStyle = gradient;
          ctx.fillRect(node.x - glowRadius, node.y - glowRadius, glowRadius * 2, glowRadius * 2);
        }

        // Node circle
        ctx.beginPath();
        ctx.arc(node.x, node.y, radius, 0, 2 * Math.PI);
        ctx.fillStyle = fillColor;
        ctx.fill();

        if (isSelected) { ctx.strokeStyle = '#ffffff'; ctx.lineWidth = 3; ctx.stroke(); }
        else if (isInPath) { ctx.strokeStyle = '#22c55e'; ctx.lineWidth = 3; ctx.stroke(); }
        else if (isConnectSrc) { ctx.strokeStyle = '#00d4ff'; ctx.lineWidth = 2; ctx.stroke(); }

        // Connection ring
        if (node.connections > 0 && !isInPath) {
          ctx.beginPath();
          ctx.arc(node.x, node.y, radius + 4, 0, 2 * Math.PI * Math.min(node.connections / 10, 1));
          ctx.strokeStyle = fillColor;
          ctx.lineWidth = 2;
          ctx.stroke();
        }

        // Draw icon for creative node types
        if (['track', 'artist', 'sample', 'release'].includes(node.tier)) {
          drawNodeIcon(ctx, node, node.x, node.y, radius);
        }

        // Label
        if (showLabels && (zoom > 0.5 || isSelected || isHovered)) {
          ctx.fillStyle = isSelected || isHovered ? '#ffffff' : '#9ca3af';
          ctx.font = `${Math.max(10, 12 / zoom)}px Inter, sans-serif`;
          ctx.textAlign = 'center';
          ctx.fillText(node.label.slice(0, 25) + (node.label.length > 25 ? '...' : ''), node.x, node.y + radius + 16);
        }
      });

      ctx.restore();

      // --- Mini-map ---
      const mmWidth = 180, mmHeight = 120;
      const mmX = dimensions.width - mmWidth - 10;
      const mmY = dimensions.height - mmHeight - 10;
      ctx.fillStyle = 'rgba(20, 20, 30, 0.9)';
      ctx.fillRect(mmX, mmY, mmWidth, mmHeight);
      ctx.strokeStyle = 'rgba(100, 100, 150, 0.5)';
      ctx.lineWidth = 1;
      ctx.strokeRect(mmX, mmY, mmWidth, mmHeight);

      const scale = Math.min(mmWidth / dimensions.width, mmHeight / dimensions.height) * 0.8;
      filteredNodes.forEach((node: GraphNode) => {
        ctx.beginPath();
        const nodeColor = viewMode === 'cluster' && node.cluster !== undefined
          ? CLUSTER_COLORS[node.cluster % CLUSTER_COLORS.length]
          : (NODE_COLORS[node.tier] || NODE_COLORS.regular).fill;
        ctx.arc(
          mmX + mmWidth / 2 + (node.x - dimensions.width / 2) * scale,
          mmY + mmHeight / 2 + (node.y - dimensions.height / 2) * scale,
          2, 0, 2 * Math.PI
        );
        ctx.fillStyle = nodeColor;
        ctx.fill();
      });

      const vpX = mmX + mmWidth / 2 - (offset.x * scale);
      const vpY = mmY + mmHeight / 2 - (offset.y * scale);
      const vpW = (dimensions.width / zoom) * scale;
      const vpH = (dimensions.height / zoom) * scale;
      ctx.strokeStyle = 'rgba(0, 212, 255, 0.5)';
      ctx.strokeRect(vpX - vpW / 2, vpY - vpH / 2, vpW, vpH);

      if (isSimulating && layoutMode === 'force') requestAnimationFrame(render);
    };
    render();
  }, [graphData, dimensions, zoom, offset, filterTiers, searchQuery, showLabels, selectedNode,
      hoveredNode, foundPath, pathStart, pathEnd, viewMode, showEdgeTypes, isSimulating, layoutMode,
      connectMode, connectSource, hiddenEdgeTypes, hiddenNodeTypes, relatedNodeIds, searchType, bpmRange,
      showIsolated]);

  // --- Mouse / interaction handlers ---

  const screenToWorld = useCallback((clientX: number, clientY: number) => {
    const rect = canvasRef.current?.getBoundingClientRect();
    if (!rect) return { x: 0, y: 0 };
    return {
      x: (clientX - rect.left - dimensions.width / 2 - offset.x) / zoom + dimensions.width / 2,
      y: (clientY - rect.top - dimensions.height / 2 - offset.y) / zoom + dimensions.height / 2,
    };
  }, [dimensions, offset, zoom]);

  const findNodeAt = useCallback((wx: number, wy: number) => {
    return nodesRef.current.find((n: GraphNode) => {
      const radius = n.tier === 'hyper' ? 18 : n.tier === 'mega' ? 14 : 12;
      return Math.sqrt((wx - n.x) ** 2 + (wy - n.y) ** 2) < radius + 5;
    });
  }, []);

  const handleMouseDown = (e: React.MouseEvent) => {
    setContextMenu(null);
    const { x, y } = screenToWorld(e.clientX, e.clientY);
    const clickedNode = findNodeAt(x, y);

    if (connectMode && clickedNode) {
      if (!connectSource) {
        setConnectSource(clickedNode.id);
      } else if (clickedNode.id !== connectSource) {
        const newEdge = {
          source: connectSource, target: clickedNode.id,
          weight: 0.5, type: newEdgeType,
        };
        setLocalEdges(prev => [...prev, newEdge]);
        setConnectSource(null);
        // Persist edge to backend
        apiHelpers.worldmodel.createRelation({
          from: connectSource,
          to: clickedNode.id,
          type: newEdgeType,
        }).then(() => {
          refetch3();
        }).catch(err => {
          console.warn('[Graph] Failed to persist edge:', err);
          showToast('error', 'Failed to save edge');
        });
      }
      return;
    }

    if (clickedNode) {
      if (showPathfinder) {
        if (!pathStart) setPathStart(clickedNode.id);
        else if (!pathEnd && clickedNode.id !== pathStart) setPathEnd(clickedNode.id);
        else { setPathStart(clickedNode.id); setPathEnd(null); }
      } else {
        setSelectedNode(clickedNode);
        setDraggedNode(clickedNode);
        clickedNode.fx = clickedNode.x;
        clickedNode.fy = clickedNode.y;
      }
    } else {
      setIsDragging(true);
      setDragStart({ x: e.clientX - offset.x, y: e.clientY - offset.y });
    }
  };

  const handleMouseMove = (e: React.MouseEvent) => {
    const { x, y } = screenToWorld(e.clientX, e.clientY);
    if (draggedNode) {
      draggedNode.fx = x; draggedNode.fy = y;
      draggedNode.x = x; draggedNode.y = y;
      return;
    }
    if (isDragging) {
      setOffset({ x: e.clientX - dragStart.x, y: e.clientY - dragStart.y });
      return;
    }
    const hovered = findNodeAt(x, y);
    setHoveredNode(hovered || null);
  };

  const handleMouseUp = () => {
    if (draggedNode) { draggedNode.fx = null; draggedNode.fy = null; setDraggedNode(null); }
    setIsDragging(false);
  };

  const handleContextMenu = (e: React.MouseEvent) => {
    e.preventDefault();
    const { x, y } = screenToWorld(e.clientX, e.clientY);
    const clickedNode = findNodeAt(x, y);
    if (clickedNode) setContextMenu({ x: e.clientX, y: e.clientY, node: clickedNode });
  };

  const handleWheel = (e: React.WheelEvent) => {
    e.preventDefault();
    setZoom(z => Math.min(Math.max(z * (e.deltaY > 0 ? 0.9 : 1.1), 0.1), 8));
  };

  const resetView = () => {
    setZoom(1); setOffset({ x: 0, y: 0 }); setSelectedNode(null);
    setPathStart(null); setPathEnd(null); setFoundPath([]);
    setFilterRelated(null); setConnectSource(null); setConnectMode(false);
  };

  // --- Keyboard navigation for graph nodes ---
  const handleGraphKeyDown = useCallback((e: React.KeyboardEvent) => {
    // Skip when user is typing in an input
    const tag = (e.target as HTMLElement).tagName;
    if (tag === 'INPUT' || tag === 'SELECT' || tag === 'TEXTAREA') return;

    const nodes = nodesRef.current;
    if (nodes.length === 0) return;

    switch (e.key) {
      case 'ArrowRight':
      case 'ArrowDown': {
        e.preventDefault();
        const next = focusedNodeIndex < nodes.length - 1 ? focusedNodeIndex + 1 : 0;
        setFocusedNodeIndex(next);
        setHoveredNode(nodes[next]);
        break;
      }
      case 'ArrowLeft':
      case 'ArrowUp': {
        e.preventDefault();
        const prev = focusedNodeIndex > 0 ? focusedNodeIndex - 1 : nodes.length - 1;
        setFocusedNodeIndex(prev);
        setHoveredNode(nodes[prev]);
        break;
      }
      case 'Enter':
      case ' ': {
        e.preventDefault();
        if (focusedNodeIndex >= 0 && focusedNodeIndex < nodes.length) {
          setSelectedNode(nodes[focusedNodeIndex]);
        }
        break;
      }
      case 'Escape': {
        e.preventDefault();
        setSelectedNode(null);
        setFocusedNodeIndex(-1);
        setHoveredNode(null);
        break;
      }
      case 'Home': {
        e.preventDefault();
        setFocusedNodeIndex(0);
        setHoveredNode(nodes[0]);
        break;
      }
      case 'End': {
        e.preventDefault();
        const last = nodes.length - 1;
        setFocusedNodeIndex(last);
        setHoveredNode(nodes[last]);
        break;
      }
      default:
        break;
    }
  }, [focusedNodeIndex, setSelectedNode, setHoveredNode]);

  const toggleTier = (tier: string) => {
    setFilterTiers(prev => {
      const next = new Set(prev);
      if (next.has(tier)) next.delete(tier); else next.add(tier);
      return next;
    });
  };

  // --- Add node ---

  const addNewNode = async () => {
    if (!addNodeLabel.trim()) return;
    const localId = `local-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`;
    const w = dimensions.width;
    const h = dimensions.height;
    const newNode: GraphNode = {
      id: localId, label: addNodeLabel.trim(), tier: addNodeType, nodeType: addNodeType,
      x: w / 2 + (Math.random() - 0.5) * 200, y: h / 2 + (Math.random() - 0.5) * 200,
      vx: 0, vy: 0, fx: null, fy: null, connections: 0,
      tags: [addNodeType], createdAt: new Date().toISOString(),
    };
    // Add locally for immediate feedback
    nodesRef.current = [...nodesRef.current, newNode];
    setAddNodeLabel('');
    setShowAddNode(false);
    // Persist to backend via DTU create
    try {
      await apiHelpers.dtus.create({
        title: newNode.label,
        content: newNode.label,
        tags: [addNodeType, 'graph-created'],
      });
      // Also persist as a graph entity artifact
      await createEntity({
        title: newNode.label,
        data: { tier: addNodeType, nodeType: addNodeType, tags: [addNodeType] },
      });
      refetch2();
    } catch (err) {
      console.warn('[Graph] Failed to persist new node:', err);
    }
  };

  // --- Export ---

  const exportGraph = (format: 'png' | 'json') => {
    if (format === 'png') {
      const canvas = canvasRef.current;
      if (!canvas) return;
      const link = document.createElement('a');
      link.download = `graph-${new Date().toISOString().slice(0, 10)}.png`;
      link.href = canvas.toDataURL('image/png');
      link.click();
    } else {
      const data = {
        nodes: nodesRef.current.map(n => ({
          id: n.id, label: n.label, tier: n.tier, tags: n.tags, x: n.x, y: n.y,
          nodeType: n.nodeType, bpm: n.bpm, key: n.key, genre: n.genre,
        })),
        edges: graphData.edges,
      };
      const blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' });
      const link = document.createElement('a');
      link.download = `graph-${new Date().toISOString().slice(0, 10)}.json`;
      link.href = URL.createObjectURL(blob);
      link.click();
    }
  };

  // --- Stats ---

  const stats = useMemo(() => {
    const nodes = nodesRef.current;
    const edges = graphData.edges;
    const typeCounts: Record<string, number> = {};
    Object.keys(NODE_COLORS).forEach(k => { typeCounts[k] = nodes.filter(n => n.tier === k).length; });
    // Prefer real-time topology stats from the lattice store when available
    const nodeCount = topologyStats.nodes || nodes.length;
    const edgeCount = topologyStats.edges || edges.length;
    return {
      avgConnections: nodes.length > 0 ? nodes.reduce((sum, n) => sum + n.connections, 0) / nodes.length : 0,
      density: nodeCount > 1 ? (edgeCount / (nodeCount * (nodeCount - 1) / 2)) * 100 : 0,
      typeCounts, nodeCount, edgeCount,
      clusterCount: topologyStats.clusters || 0,
    };
  }, [graphData, topologyStats]);

  // --- Detail panel helpers ---

  const connectedEdgesForSelected = useMemo(() => {
    if (!selectedNode) return [];
    return graphData.edges.filter(e => e.source === selectedNode.id || e.target === selectedNode.id);
  }, [selectedNode, graphData.edges]);

  // --- Render ---


  if (isLoading) {
    return (
      <div className="flex items-center justify-center h-full p-8">
        <div className="text-center space-y-3">
          <div className="w-8 h-8 border-2 border-neon-cyan border-t-transparent rounded-full animate-spin mx-auto" />
          <p className="text-sm text-gray-400">Loading...</p>
        </div>
      </div>
    );
  }

  if (isError || isError2 || isError3) {
    return (
      <div className="flex items-center justify-center h-full p-8">
        <ErrorState error={error?.message || error2?.message || error3?.message} onRetry={() => { refetch(); refetch2(); refetch3(); }} />
      </div>
    );
  }
  return (
    <div data-lens-theme="graph" className="h-full flex flex-col bg-[#0a0e14]">
      {/* Stat Cards Row */}
      <div className="flex items-center gap-3 px-4 py-2 border-b border-cyan-900/20 bg-[#0a0e14]/90 backdrop-blur-sm flex-wrap">
        {[
          { label: 'Nodes', value: stats.nodeCount, color: 'text-cyan-400', bg: 'bg-cyan-400/10' },
          { label: 'Edges', value: stats.edgeCount, color: 'text-purple-400', bg: 'bg-purple-400/10' },
          ...(stats.clusterCount > 0 ? [{ label: 'Clusters', value: stats.clusterCount, color: 'text-pink-400', bg: 'bg-pink-400/10' }] : []),
          { label: 'Density', value: `${stats.density.toFixed(1)}%`, color: 'text-emerald-400', bg: 'bg-emerald-400/10' },
          { label: 'Avg Connections', value: stats.avgConnections.toFixed(1), color: 'text-amber-400', bg: 'bg-amber-400/10' },
        ].map((s, i) => (
          <motion.div
            key={s.label}
            initial={{ opacity: 0, y: -8 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ delay: i * 0.05 }}
            className={`flex items-center gap-2 px-3 py-1.5 rounded-lg ${s.bg} border border-white/5 flex-shrink-0`}
          >
            <span className={`text-lg font-bold font-mono ${s.color}`}>{s.value}</span>
            <span className="text-[10px] text-gray-500 uppercase tracking-wider">{s.label}</span>
          </motion.div>
        ))}
        {/* Connection visualization mini-graph */}
        <div className="flex items-center gap-1 ml-auto flex-shrink-0">
          <div className="flex items-center gap-0.5">
            {Object.entries(stats.typeCounts).slice(0, 4).map(([tier, count]) => (
              count > 0 && (
                <motion.div
                  key={tier}
                  initial={{ width: 0 }}
                  animate={{ width: Math.max(4, Math.min(count * 2, 32)) }}
                  className="h-3 rounded-full"
                  style={{ backgroundColor: NODE_COLORS[tier as NodeType]?.fill || '#6b7280' }}
                  title={`${NODE_COLORS[tier as NodeType]?.name}: ${count}`}
                />
              )
            ))}
          </div>
        </div>
      </div>
      {/* Real-time Enhancement Toolbar */}
      <div className="flex items-center gap-2 px-4 py-1 border-b border-cyan-900/20 bg-[#0a0e14]/80 backdrop-blur-sm flex-wrap">
        <LiveIndicator isLive={isLive} lastUpdated={lastUpdated} compact />
        <DTUExportButton domain="graph" data={realtimeData || {}} compact />
        <RealtimeDataPanel domain="graph" data={realtimeData} isLive={isLive} lastUpdated={lastUpdated} insights={realtimeInsights} compact />
      <UniversalActions domain="graph" artifactId={null} compact />
        <button onClick={() => refetchDTUs()} disabled={dtusLoading} className="p-1 rounded hover:bg-lattice-surface/50 disabled:opacity-50 transition-colors" title="Refresh DTUs">
          {dtusLoading ? <Circle className="w-4 h-4 animate-spin text-neon-cyan" /> : <RotateCcw className="w-4 h-4 text-gray-400" />}
        </button>
        {realtimeAlerts.length > 0 && (
          <span className="text-xs px-2 py-0.5 rounded bg-yellow-500/10 text-yellow-400">
            {realtimeAlerts.length} alert{realtimeAlerts.length !== 1 ? 's' : ''}
          </span>
        )}
      </div>
      <div className="flex-1 flex overflow-hidden">
      <div
        ref={containerRef}
        className="flex-1 relative overflow-hidden"
        role="application"
        aria-label={`Knowledge graph with ${stats.nodeCount} nodes and ${stats.edgeCount} edges. Use arrow keys to navigate between nodes, Enter or Space to select, Escape to deselect.`}
        aria-roledescription="interactive graph"
        tabIndex={0}
        onKeyDown={handleGraphKeyDown}
      >
        {viewMode === 'interactive' ? (
          <InteractiveGraph
            nodes={graphData.nodes.map(n => ({
              id: n.id,
              label: n.label,
              tier: (['regular', 'mega', 'hyper', 'shadow'].includes(n.tier) ? n.tier : 'regular') as 'regular' | 'mega' | 'hyper' | 'shadow',
              tags: n.tags,
              resonance: n.connections > 0 ? Math.min(n.connections / 10, 1) : 0,
              createdAt: n.createdAt,
            }))}
            edges={graphData.edges.map(e => ({
              source: e.source,
              target: e.target,
              weight: e.weight,
              type: e.type,
            }))}
            onNodeClick={(node) => {
              const full = graphData.nodes.find(n => n.id === node.id);
              if (full) setSelectedNode(full);
            }}
            selectedNodeId={selectedNode?.id}
            className="absolute inset-0"
            showControls={false}
          />
        ) : viewMode === '3d' ? (
          <KnowledgeSpace3D
            nodes={graphData.nodes.map(n => ({
              id: n.id,
              label: n.label,
              tier: (['regular', 'mega', 'hyper', 'shadow'].includes(n.tier) ? n.tier : 'regular') as 'regular' | 'mega' | 'hyper' | 'shadow',
              position: [n.x - dimensions.width / 2, n.y - dimensions.height / 2, (n.connections || 0) * 2] as [number, number, number],
              connections: graphData.edges
                .filter(e => e.source === n.id || e.target === n.id)
                .map(e => e.source === n.id ? e.target : e.source),
              resonance: n.connections > 0 ? Math.min(n.connections / 10, 1) : 0,
            }))}
            onNodeClick={(node) => {
              const full = graphData.nodes.find(n => n.id === node.id);
              if (full) setSelectedNode(full);
            }}
            selectedNodeId={selectedNode?.id}
            className="absolute inset-0"
          />
        ) : viewMode === 'fractal' ? (
          // Fractal Empire Explorer — hierarchical drill-down of the
          // DTU graph. Uses mega/hyper tier as natural parent nodes
          // and collapses their descendants into fractal branches so
          // the whole knowledge space fits in one zoomable frame.
          <div className="absolute inset-0">
            <FractalEmpireExplorer
              data={(() => {
                // Build a two-level fractal tree: MEGA / HYPER nodes
                // become the root children; each root gets its
                // directly-linked regular nodes as descendants.
                const byId = new Map(graphData.nodes.map((n) => [n.id, n] as const));
                const childrenOf = new Map<string, string[]>();
                for (const e of graphData.edges) {
                  if (!childrenOf.has(e.source)) childrenOf.set(e.source, []);
                  childrenOf.get(e.source)!.push(e.target);
                }
                const roots = graphData.nodes
                  .filter((n) => n.tier === 'mega' || n.tier === 'hyper')
                  .slice(0, 12); // cap so the explorer stays legible
                return roots.map((r) => ({
                  id: r.id,
                  type: r.tier,
                  value: r.connections || 1,
                  depth: 0,
                  children: (childrenOf.get(r.id) || [])
                    .slice(0, 8)
                    .map((cid) => byId.get(cid))
                    .filter(Boolean)
                    .map((c) => ({
                      id: c!.id,
                      type: c!.tier,
                      value: c!.connections || 1,
                      depth: 1,
                    })),
                }));
              })()}
              zoom={1}
              selectedNode={selectedNode?.id || null}
              onNodeSelect={(id) => {
                const full = graphData.nodes.find((n) => n.id === id);
                if (full) setSelectedNode(full);
              }}
            />
          </div>
        ) : (
          <canvas
            ref={canvasRef}
            className={cn('w-full h-full', connectMode ? 'cursor-crosshair' : 'cursor-grab active:cursor-grabbing')}
            style={{ width: dimensions.width, height: dimensions.height }}
            aria-hidden="true"
            onMouseDown={handleMouseDown} onMouseMove={handleMouseMove}
            onMouseUp={handleMouseUp} onMouseLeave={handleMouseUp}
            onWheel={handleWheel} onContextMenu={handleContextMenu}
          />
        )}

        {/* Screen reader announcement for focused node */}
        <div className="sr-only" aria-live="polite" aria-atomic="true">
          {focusedNodeIndex >= 0 && nodesRef.current[focusedNodeIndex] && (
            `Focused on ${nodesRef.current[focusedNodeIndex].label}, ${(NODE_COLORS[nodesRef.current[focusedNodeIndex].tier] || NODE_COLORS.regular).name} node with ${nodesRef.current[focusedNodeIndex].connections} connections`
          )}
        </div>

        {/* --- Top-left: Search + Filters --- */}
        <div className="absolute top-4 left-4 space-y-3 max-w-xs">
          <div className="relative">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-cyan-600" />
            <input type="text" value={searchQuery} onChange={(e) => setSearchQuery(e.target.value)}
              placeholder="Search nodes, tags, genre..."
              className="pl-10 pr-4 py-2 bg-[#0d1117]/90 backdrop-blur-md border border-cyan-900/30 rounded-lg text-sm text-white placeholder-gray-600 focus:outline-none focus:border-cyan-500/50 focus:ring-1 focus:ring-cyan-500/20 w-72" />
          </div>

          {/* Advanced search row */}
          <div className="flex gap-2">
            <select value={searchType} onChange={e => setSearchType(e.target.value)}
              className="px-2 py-1.5 bg-lattice-surface/90 backdrop-blur border border-lattice-border rounded-lg text-xs text-white">
              <option value="all">All Types</option>
              {Object.entries(NODE_COLORS)
                .filter(([k]) => hasMusicDomain || !['track', 'artist', 'sample', 'release'].includes(k))
                .map(([k, v]) => (
                  <option key={k} value={k}>{v.name}</option>
                ))}
            </select>
            {/* BPM filter — only shown when music domain DTUs exist */}
            {hasMusicDomain && (
              <div className="flex items-center gap-1 bg-lattice-surface/90 backdrop-blur border border-lattice-border rounded-lg px-2">
                <span className="text-xs text-gray-400">BPM</span>
                <input type="number" value={bpmRange[0]} onChange={e => setBpmRange([+e.target.value, bpmRange[1]])}
                  className="w-12 bg-transparent text-xs text-white text-center focus:outline-none" placeholder="0" />
                <span className="text-xs text-gray-500">-</span>
                <input type="number" value={bpmRange[1]} onChange={e => setBpmRange([bpmRange[0], +e.target.value])}
                  className="w-12 bg-transparent text-xs text-white text-center focus:outline-none" placeholder="300" />
              </div>
            )}
          </div>

          {/* Toggle controls */}
          <div className="flex gap-2 flex-wrap">
            <button onClick={() => setShowAutogen(!showAutogen)}
              className={cn('px-2 py-1 rounded-md text-xs font-medium transition-colors border',
                showAutogen ? 'bg-lattice-bg text-white border-neon-cyan/40' : 'text-gray-500 border-lattice-border hover:text-gray-300')}>
              {showAutogen ? 'Hide' : 'Show'} autogen
            </button>
            <button onClick={() => setShowIsolated(!showIsolated)}
              className={cn('px-2 py-1 rounded-md text-xs font-medium transition-colors border',
                showIsolated ? 'bg-lattice-bg text-white border-neon-cyan/40' : 'text-gray-500 border-lattice-border hover:text-gray-300')}>
              {showIsolated ? 'Hide' : 'Show'} isolated
            </button>
            <button onClick={() => setNodeLimit(prev => Math.min(prev + 100, 500))}
              disabled={nodeLimit >= 500}
              className="px-2 py-1 rounded-md text-xs font-medium text-gray-500 border border-lattice-border hover:text-gray-300 disabled:opacity-30">
              Load more ({nodeLimit}/{(dtus?.dtus || []).length})
            </button>
          </div>

          {/* Tier filter chips — only show universal types by default, music types when detected */}
          <div className="flex flex-wrap gap-1.5 bg-[#0d1117]/80 backdrop-blur-md border border-cyan-900/20 rounded-xl p-2">
            {Object.entries(NODE_COLORS)
              .filter(([k]) => hasMusicDomain || !['track', 'artist', 'sample', 'release'].includes(k))
              .map(([tier, colors]) => (
                <button key={tier} onClick={() => toggleTier(tier)}
                  className={cn('flex items-center gap-1.5 px-2 py-1 rounded-md text-xs font-medium transition-colors',
                    filterTiers.has(tier) ? 'bg-lattice-bg text-white' : 'text-gray-500 hover:text-gray-300')}>
                  <Circle className="w-2.5 h-2.5" fill={filterTiers.has(tier) ? colors.fill : 'transparent'} stroke={colors.fill} />
                  {colors.name}
                </button>
              ))}
          </div>

          {/* Layout + View mode */}
          <div className="flex gap-2">
            <select value={layoutMode} onChange={(e) => { setLayoutMode(e.target.value as LayoutMode); nodesRef.current = initializeGraphData().nodes; }}
              className="px-3 py-2 bg-lattice-surface/90 backdrop-blur border border-lattice-border rounded-lg text-sm text-white">
              <option value="force">Force-Directed</option>
              <option value="radial">Radial</option>
              <option value="hierarchical">Hierarchical</option>
            </select>
            <select value={viewMode} onChange={(e) => setViewMode(e.target.value as ViewMode)}
              className="px-3 py-2 bg-lattice-surface/90 backdrop-blur border border-lattice-border rounded-lg text-sm text-white">
              <option value="default">Default</option>
              <option value="heatmap">Heatmap</option>
              <option value="cluster">Clusters</option>
              <option value="interactive">Interactive (Cytoscape)</option>
              <option value="3d">3D Space</option>
              <option value="fractal">Fractal Empire</option>
              {hasMusicDomain && <option value="sample_tree">Sample Tree</option>}
              {hasMusicDomain && <option value="collab_network">Collab Network</option>}
            </select>
          </div>
        </div>

        {/* --- Right toolbar --- */}
        <div className="absolute bottom-6 right-6 flex flex-col gap-2">
          <div className="bg-[#0d1117]/90 backdrop-blur-md border border-cyan-900/20 rounded-xl overflow-hidden shadow-lg shadow-cyan-900/10">
            <button onClick={() => setZoom(z => Math.min(z * 1.2, 8))} className="p-2.5 hover:bg-cyan-900/20 transition-colors block w-full">
              <ZoomIn className="w-5 h-5 text-cyan-300 mx-auto" />
            </button>
            <div className="px-2 py-1 text-xs text-center text-cyan-400/70 border-y border-cyan-900/20 font-mono">{Math.round(zoom * 100)}%</div>
            <button onClick={() => setZoom(z => Math.max(z / 1.2, 0.1))} className="p-2.5 hover:bg-cyan-900/20 transition-colors block w-full">
              <ZoomOut className="w-5 h-5 text-cyan-300 mx-auto" />
            </button>
          </div>

          <button onClick={resetView} className="p-2.5 bg-[#0d1117]/90 backdrop-blur-md border border-cyan-900/20 rounded-xl hover:bg-cyan-900/20 shadow-lg shadow-cyan-900/10" title="Reset View">
            <RotateCcw className="w-5 h-5 text-cyan-300" />
          </button>
          <button onClick={() => setShowLabels(!showLabels)} className="p-2.5 bg-[#0d1117]/90 backdrop-blur-md border border-cyan-900/20 rounded-xl hover:bg-cyan-900/20 shadow-lg shadow-cyan-900/10" title="Toggle Labels">
            {showLabels ? <Eye className="w-5 h-5 text-cyan-400" /> : <EyeOff className="w-5 h-5 text-gray-500" />}
          </button>
          <button onClick={() => setIsSimulating(!isSimulating)} className={cn('p-2 backdrop-blur border border-lattice-border rounded-lg', isSimulating ? 'bg-neon-green/20 text-neon-green' : 'bg-lattice-surface/90 text-gray-400')} title="Toggle Simulation">
            {isSimulating ? <Pause className="w-5 h-5" /> : <Play className="w-5 h-5" />}
          </button>
          <button onClick={() => setShowPathfinder(!showPathfinder)} className={cn('p-2 backdrop-blur border border-lattice-border rounded-lg', showPathfinder ? 'bg-neon-purple/20 text-neon-purple' : 'bg-lattice-surface/90 text-gray-400')} title="Path Finder">
            <GitBranch className="w-5 h-5" />
          </button>

          {/* New creative toolbar buttons */}
          <button onClick={() => setShowAddNode(!showAddNode)} className={cn('p-2 backdrop-blur border border-lattice-border rounded-lg', showAddNode ? 'bg-neon-cyan/20 text-neon-cyan' : 'bg-lattice-surface/90 text-gray-400')} title="Add Node">
            <Plus className="w-5 h-5" />
          </button>
          <button onClick={() => { setConnectMode(!connectMode); setConnectSource(null); }} className={cn('p-2 backdrop-blur border border-lattice-border rounded-lg', connectMode ? 'bg-neon-cyan/20 text-neon-cyan' : 'bg-lattice-surface/90 text-gray-400')} title="Connect Mode">
            <Link2 className="w-5 h-5" />
          </button>
          <button onClick={() => setViewMode(viewMode === 'sample_tree' ? 'default' : 'sample_tree')} className={cn('p-2 backdrop-blur border border-lattice-border rounded-lg', viewMode === 'sample_tree' ? 'bg-emerald-500/20 text-emerald-400' : 'bg-lattice-surface/90 text-gray-400')} title="Sample Tree View">
            <TreePine className="w-5 h-5" />
          </button>
          <button onClick={() => setViewMode(viewMode === 'collab_network' ? 'default' : 'collab_network')} className={cn('p-2 backdrop-blur border border-lattice-border rounded-lg', viewMode === 'collab_network' ? 'bg-violet-500/20 text-violet-400' : 'bg-lattice-surface/90 text-gray-400')} title="Collab Network View">
            <Users className="w-5 h-5" />
          </button>
          <button onClick={() => setShowShadowConnections(!showShadowConnections)} className={cn('p-2 backdrop-blur border border-lattice-border rounded-lg', showShadowConnections ? 'bg-gray-500/20 text-gray-300' : 'bg-lattice-surface/90 text-gray-400')} title="Show Shadow Connections">
            <Layers className="w-5 h-5" />
          </button>

          <button onClick={() => setShowSettings(!showSettings)} className="p-2 bg-lattice-surface/90 backdrop-blur border border-lattice-border rounded-lg hover:bg-lattice-bg" title="Settings">
            <Settings className="w-5 h-5 text-white" />
          </button>
          <button onClick={() => setShowLegend(!showLegend)} className={cn('p-2 backdrop-blur border border-lattice-border rounded-lg', showLegend ? 'bg-lattice-bg text-white' : 'bg-lattice-surface/90 text-gray-400')} title="Legend">
            <Filter className="w-5 h-5" />
          </button>
          <div className="bg-lattice-surface/90 backdrop-blur border border-lattice-border rounded-lg overflow-hidden">
            <button onClick={() => exportGraph('png')} className="p-2 hover:bg-lattice-bg block w-full" title="Export PNG">
              <Download className="w-5 h-5 text-white mx-auto" />
            </button>
            <button onClick={() => exportGraph('json')} className="p-2 hover:bg-lattice-bg block w-full border-t border-lattice-border" title="Export JSON">
              <Share2 className="w-5 h-5 text-white mx-auto" />
            </button>
          </div>
        </div>

        {/* --- Connect mode bar --- */}
        <AnimatePresence>
          {connectMode && (
            <motion.div initial={{ opacity: 0, y: -10 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: -10 }}
              className="absolute top-4 left-1/2 -translate-x-1/2 bg-neon-cyan/10 backdrop-blur border border-neon-cyan/40 rounded-lg px-4 py-2 flex items-center gap-3">
              <Link2 className="w-4 h-4 text-neon-cyan" />
              <span className="text-sm text-neon-cyan font-medium">
                {connectSource ? 'Click target node to connect' : 'Click source node to start'}
              </span>
              <select value={newEdgeType} onChange={e => setNewEdgeType(e.target.value as EdgeType)}
                className="px-2 py-1 bg-lattice-bg border border-lattice-border rounded text-xs text-white">
                {Object.entries(EDGE_LABELS).map(([k, v]) => (
                  <option key={k} value={k}>{v}</option>
                ))}
              </select>
              <button onClick={() => { setConnectMode(false); setConnectSource(null); }} className="text-xs text-gray-400 hover:text-white">Cancel</button>
            </motion.div>
          )}
        </AnimatePresence>

        {/* --- Add Node panel --- */}
        <AnimatePresence>
          {showAddNode && (
            <motion.div initial={{ opacity: 0, y: -20 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: -20 }}
              className="absolute top-20 left-1/2 -translate-x-1/2 bg-lattice-surface/95 backdrop-blur border border-lattice-border rounded-lg p-4 w-80">
              <h3 className="font-semibold text-white mb-3 flex items-center gap-2">
                <Plus className="w-4 h-4 text-neon-cyan" /> Add Node
              </h3>
              <div className="space-y-3">
                <input type="text" value={addNodeLabel} onChange={e => setAddNodeLabel(e.target.value)}
                  placeholder="Node label..." className="w-full px-3 py-2 bg-lattice-bg border border-lattice-border rounded-lg text-sm text-white placeholder-gray-500 focus:outline-none focus:border-neon-cyan" />
                <div className="grid grid-cols-4 gap-1.5">
                  {(Object.keys(NODE_COLORS) as NodeType[]).map(t => (
                    <button key={t} onClick={() => setAddNodeType(t)}
                      className={cn('px-2 py-1.5 rounded text-xs font-medium border transition-colors',
                        addNodeType === t ? 'border-white text-white bg-lattice-bg' : 'border-lattice-border text-gray-400 hover:text-white')}
                      style={addNodeType === t ? { borderColor: NODE_COLORS[t].fill } : undefined}>
                      {NODE_COLORS[t].name}
                    </button>
                  ))}
                </div>
                <button onClick={addNewNode} disabled={!addNodeLabel.trim()}
                  className="w-full py-2 bg-neon-cyan text-black font-medium rounded-lg hover:bg-neon-cyan/90 disabled:opacity-40 disabled:cursor-not-allowed text-sm">
                  Create Node
                </button>
              </div>
            </motion.div>
          )}
        </AnimatePresence>

        {/* --- Pathfinder panel --- */}
        <AnimatePresence>
          {showPathfinder && (
            <motion.div initial={{ opacity: 0, y: -20 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: -20 }}
              className="absolute top-20 left-1/2 -translate-x-1/2 bg-lattice-surface/95 backdrop-blur border border-lattice-border rounded-lg p-4 w-80">
              <h3 className="font-semibold text-white mb-3 flex items-center gap-2">
                <GitBranch className="w-4 h-4 text-neon-purple" /> Path Finder
              </h3>
              <p className="text-xs text-gray-400 mb-3">Click two nodes to find shortest path</p>
              <div className="space-y-2">
                <div className="flex items-center gap-2">
                  <div className="w-3 h-3 rounded-full bg-neon-green" />
                  <span className="text-sm text-gray-300">{pathStart ? nodesRef.current.find(n => n.id === pathStart)?.label || 'Start' : 'Click start node'}</span>
                </div>
                <div className="flex items-center gap-2">
                  <div className="w-3 h-3 rounded-full bg-neon-pink" />
                  <span className="text-sm text-gray-300">{pathEnd ? nodesRef.current.find(n => n.id === pathEnd)?.label || 'End' : 'Click end node'}</span>
                </div>
                {foundPath.length > 0 && <div className="mt-2 p-2 bg-lattice-bg rounded text-xs text-neon-green">Path found: {foundPath.length} nodes</div>}
                {pathStart && pathEnd && foundPath.length === 0 && <div className="mt-2 p-2 bg-lattice-bg rounded text-xs text-red-400">No path found</div>}
              </div>
              <button onClick={() => { setPathStart(null); setPathEnd(null); }} className="mt-3 w-full py-1.5 text-sm bg-lattice-bg text-gray-300 rounded hover:bg-lattice-elevated">Clear Path</button>
            </motion.div>
          )}
        </AnimatePresence>

        {/* --- Settings panel --- */}
        <AnimatePresence>
          {showSettings && (
            <motion.div initial={{ opacity: 0, x: 20 }} animate={{ opacity: 1, x: 0 }} exit={{ opacity: 0, x: 20 }}
              className="absolute top-4 right-20 bg-lattice-surface/95 backdrop-blur border border-lattice-border rounded-lg p-4 w-64">
              <h3 className="font-semibold text-white mb-3 flex items-center gap-2">
                <Settings className="w-4 h-4 text-gray-400" /> Simulation Settings
              </h3>
              <div className="space-y-4">
                <div><label className="text-xs text-gray-400 block mb-1">Repulsion: {simParams.repulsion}</label>
                  <input type="range" min="100" max="1000" value={simParams.repulsion} onChange={e => setSimParams(p => ({ ...p, repulsion: +e.target.value }))} className="w-full" /></div>
                <div><label className="text-xs text-gray-400 block mb-1">Attraction: {simParams.attraction.toFixed(3)}</label>
                  <input type="range" min="0.001" max="0.05" step="0.001" value={simParams.attraction} onChange={e => setSimParams(p => ({ ...p, attraction: +e.target.value }))} className="w-full" /></div>
                <div><label className="text-xs text-gray-400 block mb-1">Damping: {simParams.damping.toFixed(2)}</label>
                  <input type="range" min="0.5" max="0.99" step="0.01" value={simParams.damping} onChange={e => setSimParams(p => ({ ...p, damping: +e.target.value }))} className="w-full" /></div>
                <div className="flex items-center gap-2">
                  <input type="checkbox" checked={showEdgeTypes} onChange={e => setShowEdgeTypes(e.target.checked)} className="rounded" />
                  <label className="text-xs text-gray-400">Show edge types</label>
                </div>
                {viewMode === 'cluster' && (
                  <div><label className="text-xs text-gray-400 block mb-1">Clusters: {clusterCount}</label>
                    <input type="range" min="2" max="15" value={clusterCount} onChange={e => setClusterCount(+e.target.value)} className="w-full" /></div>
                )}
              </div>
            </motion.div>
          )}
        </AnimatePresence>

        {/* --- Bottom-left: Stats + Legend --- */}
        <div className="absolute bottom-4 left-4 space-y-2 max-w-md">
          {/* Empty state hint when no edges */}
          {stats.edgeCount === 0 && stats.nodeCount > 0 && (
            <div className="bg-lattice-surface/90 backdrop-blur border border-neon-cyan/20 rounded-lg p-4 text-center">
              <Share2 className="w-6 h-6 text-neon-cyan/50 mx-auto mb-2" />
              <p className="text-sm text-gray-300">No connections yet</p>
              <p className="text-xs text-gray-500 mt-1">As DTUs reference each other, the graph will grow. Toggle &quot;Show isolated&quot; to see all nodes.</p>
            </div>
          )}

          {/* Stats bar */}
          <div className="bg-lattice-surface/90 backdrop-blur border border-lattice-border rounded-lg p-4">
            <div className="grid grid-cols-4 gap-6 text-sm">
              <div><p className="text-gray-400">Nodes</p><p className="text-2xl font-bold text-white">{stats.nodeCount}</p></div>
              <div><p className="text-gray-400">Edges</p><p className="text-2xl font-bold text-white">{stats.edgeCount}</p></div>
              <div><p className="text-gray-400">Density</p><p className="text-2xl font-bold text-neon-cyan">{stats.density.toFixed(1)}%</p></div>
              <div><p className="text-gray-400">Avg Links</p><p className="text-2xl font-bold text-neon-purple">{stats.avgConnections.toFixed(1)}</p></div>
            </div>
            <div className="flex gap-4 mt-3 pt-3 border-t border-lattice-border flex-wrap">
              {Object.entries(stats.typeCounts).filter(([, c]) => c > 0).map(([tier, count]) => (
                <div key={tier} className="flex items-center gap-1">
                  <Circle className="w-2 h-2" fill={(NODE_COLORS[tier as NodeType] || NODE_COLORS.regular).fill} stroke="none" />
                  <span className="text-xs text-gray-400">{count}</span>
                </div>
              ))}
            </div>
          </div>

          {/* Legend panel */}
          <AnimatePresence>
            {showLegend && (
              <motion.div initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: 10 }}
                className="bg-lattice-surface/90 backdrop-blur border border-lattice-border rounded-lg p-3">
                <p className="text-xs font-semibold text-gray-300 mb-2">Node Types</p>
                <div className="grid grid-cols-4 gap-1 mb-3">
                  {(Object.entries(NODE_COLORS) as [NodeType, typeof NODE_COLORS[NodeType]][])
                    .filter(([type]) => hasMusicDomain || !['track', 'artist', 'sample', 'release'].includes(type))
                    .map(([type, colors]) => (
                    <button key={type} onClick={() => {
                      setHiddenNodeTypes(prev => {
                        const next = new Set(prev);
                        if (next.has(type)) next.delete(type); else next.add(type);
                        return next;
                      });
                    }} className={cn('flex items-center gap-1 px-1.5 py-1 rounded text-xs transition-opacity', hiddenNodeTypes.has(type) ? 'opacity-30' : 'opacity-100')}>
                      <Circle className="w-2.5 h-2.5 flex-shrink-0" fill={colors.fill} stroke="none" />
                      <span className="text-gray-300 truncate">{colors.name}</span>
                    </button>
                  ))}
                </div>
                <p className="text-xs font-semibold text-gray-300 mb-2">Edge Types</p>
                <div className="grid grid-cols-4 gap-1">
                  {(Object.entries(EDGE_COLORS) as [EdgeType, string][])
                    .filter(([type]) => hasMusicDomain || !['sampled_from', 'remixed_by', 'collaborated_with', 'released_on'].includes(type))
                    .map(([type, color]) => (
                    <button key={type} onClick={() => {
                      setHiddenEdgeTypes(prev => {
                        const next = new Set(prev);
                        if (next.has(type)) next.delete(type); else next.add(type);
                        return next;
                      });
                    }} className={cn('flex items-center gap-1 px-1.5 py-1 rounded text-xs transition-opacity', hiddenEdgeTypes.has(type) ? 'opacity-30' : 'opacity-100')}>
                      <div className="w-3 h-0.5 flex-shrink-0 rounded" style={{ backgroundColor: color }} />
                      <span className="text-gray-300 truncate">{EDGE_LABELS[type]}</span>
                    </button>
                  ))}
                </div>
              </motion.div>
            )}
          </AnimatePresence>
        </div>

        {/* --- Filtered-related indicator --- */}
        <AnimatePresence>
          {filterRelated && (
            <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}
              className="absolute top-4 left-1/2 -translate-x-1/2 bg-lattice-surface/90 backdrop-blur border border-neon-purple/40 rounded-lg px-4 py-2 flex items-center gap-2">
              <span className="text-sm text-neon-purple">Showing related nodes only</span>
              <button onClick={() => setFilterRelated(null)} className="text-xs text-gray-400 hover:text-white ml-2">Clear</button>
            </motion.div>
          )}
        </AnimatePresence>

        {/* --- Context menu --- */}
        <AnimatePresence>
          {contextMenu && (
            <motion.div initial={{ opacity: 0, scale: 0.95 }} animate={{ opacity: 1, scale: 1 }} exit={{ opacity: 0, scale: 0.95 }}
              className="fixed bg-lattice-surface border border-lattice-border rounded-lg shadow-xl overflow-hidden z-50"
              style={{ left: contextMenu.x, top: contextMenu.y }}>
              <button onClick={() => { setSelectedNode(contextMenu.node); setContextMenu(null); }} className="w-full px-4 py-2 text-left text-sm hover:bg-lattice-elevated flex items-center gap-2 text-gray-200">
                <Eye className="w-4 h-4" /> View Details
              </button>
              <button onClick={() => { setFilterRelated(contextMenu.node.id); setContextMenu(null); }} className="w-full px-4 py-2 text-left text-sm hover:bg-lattice-elevated flex items-center gap-2 text-gray-200">
                <Users className="w-4 h-4" /> View Related
              </button>
              <button onClick={() => { setConnectMode(true); setConnectSource(contextMenu.node.id); setContextMenu(null); }} className="w-full px-4 py-2 text-left text-sm hover:bg-lattice-elevated flex items-center gap-2 text-gray-200">
                <Link2 className="w-4 h-4" /> Connect From Here
              </button>
              <button onClick={() => { setPathStart(contextMenu.node.id); setShowPathfinder(true); setContextMenu(null); }} className="w-full px-4 py-2 text-left text-sm hover:bg-lattice-elevated flex items-center gap-2 text-gray-200">
                <GitBranch className="w-4 h-4" /> Set as Path Start
              </button>
              <button onClick={() => { navigator.clipboard.writeText(contextMenu.node.id); setContextMenu(null); }} className="w-full px-4 py-2 text-left text-sm hover:bg-lattice-elevated flex items-center gap-2 text-gray-200">
                <Copy className="w-4 h-4" /> Copy ID
              </button>
              <button onClick={() => { window.open(`/dtu/${contextMenu.node.id}`, '_blank'); setContextMenu(null); }} className="w-full px-4 py-2 text-left text-sm hover:bg-lattice-elevated flex items-center gap-2 border-t border-lattice-border text-gray-200">
                <ExternalLink className="w-4 h-4" /> Open DTU
              </button>
            </motion.div>
          )}
        </AnimatePresence>
      </div>

      {/* --- Right sidebar: Node detail panel --- */}
      <AnimatePresence>
        {selectedNode && (
          <motion.aside initial={{ x: 320, opacity: 0 }} animate={{ x: 0, opacity: 1 }} exit={{ x: 320, opacity: 0 }}
            role="complementary"
            aria-label={`Details for ${selectedNode.label}`}
            className="w-80 border-l border-cyan-900/20 bg-[#0d1117]/95 backdrop-blur-md p-4 overflow-y-auto shadow-2xl shadow-cyan-900/10">
            <div className="flex items-center justify-between mb-4">
              <h2 className="font-bold text-cyan-100">Node Details</h2>
              <button onClick={() => setSelectedNode(null)} className="p-1 hover:bg-cyan-900/20 rounded-lg transition-colors">
                <X className="w-5 h-5 text-cyan-500/50" />
              </button>
            </div>
            <div className="space-y-4">
              {/* Header */}
              <div className="p-4 bg-lattice-bg rounded-lg">
                <div className="flex items-center gap-3 mb-3">
                  <div className="w-4 h-4 rounded-full" style={{ backgroundColor: (NODE_COLORS[selectedNode.tier] || NODE_COLORS.regular).fill }} />
                  <span className="text-xs text-gray-400 uppercase font-medium">{(NODE_COLORS[selectedNode.tier] || NODE_COLORS.regular).name}</span>
                  {selectedNode.tier === 'track' && <GitBranch className="w-3.5 h-3.5 text-cyan-400" />}
                  {selectedNode.tier === 'artist' && <User className="w-3.5 h-3.5 text-violet-400" />}
                  {selectedNode.tier === 'sample' && <AudioWaveform className="w-3.5 h-3.5 text-green-400" />}
                  {selectedNode.tier === 'release' && <Share2 className="w-3.5 h-3.5 text-pink-400" />}
                </div>
                <div className="flex items-center gap-2">
                  <h3 className="font-semibold text-white text-lg">{selectedNode.label}</h3>
                  <ProvenanceBadge source={selectedNode.originalSource} />
                </div>
                {selectedNode.content && <p className="text-sm text-gray-400 mt-2 line-clamp-4">{selectedNode.content}</p>}
              </div>

              {/* Core stats */}
              <div className="grid grid-cols-2 gap-3">
                <div className="p-3 bg-lattice-bg rounded-lg">
                  <p className="text-xs text-gray-400">Connections</p>
                  <p className="text-xl font-bold text-neon-cyan">{selectedNode.connections}</p>
                </div>
                <div className="p-3 bg-lattice-bg rounded-lg">
                  <p className="text-xs text-gray-400">Created</p>
                  <p className="text-sm text-white">{new Date(selectedNode.createdAt).toLocaleDateString()}</p>
                </div>
              </div>

              {/* Track-specific details */}
              {selectedNode.tier === 'track' && (
                <div className="p-3 bg-lattice-bg rounded-lg space-y-2">
                  <p className="text-xs font-semibold text-cyan-400 uppercase">Track Info</p>
                  <div className="grid grid-cols-3 gap-2">
                    <div><p className="text-xs text-gray-500">BPM</p><p className="text-sm font-medium text-white">{selectedNode.bpm || '--'}</p></div>
                    <div><p className="text-xs text-gray-500">Key</p><p className="text-sm font-medium text-white">{selectedNode.key || '--'}</p></div>
                    <div><p className="text-xs text-gray-500">Plays</p><p className="text-sm font-medium text-white">{selectedNode.playCount?.toLocaleString() || '--'}</p></div>
                  </div>
                  {selectedNode.genre && <div><p className="text-xs text-gray-500">Genre</p><p className="text-sm text-white">{selectedNode.genre}</p></div>}
                  {/* Mini waveform visualization */}
                  <div className="flex items-end gap-px h-8 mt-1">
                    {Array.from({ length: 32 }).map((_, i) => {
                      const h = Math.sin(i * 0.4 + (selectedNode.bpm || 120) * 0.05) * 0.5 + 0.5;
                      return <div key={i} className="flex-1 bg-cyan-500/60 rounded-t" style={{ height: `${h * 100}%` }} />;
                    })}
                  </div>
                </div>
              )}

              {/* Artist-specific details */}
              {selectedNode.tier === 'artist' && (
                <div className="p-3 bg-lattice-bg rounded-lg space-y-2">
                  <p className="text-xs font-semibold text-violet-400 uppercase">Artist Info</p>
                  <div className="grid grid-cols-2 gap-2">
                    <div><p className="text-xs text-gray-500">Collabs</p><p className="text-sm font-medium text-white">{selectedNode.collabCount || connectedEdgesForSelected.filter(e => e.type === 'collaborated_with').length}</p></div>
                    <div><p className="text-xs text-gray-500">Rating</p><p className="text-sm font-medium text-white">{selectedNode.rating ? `${selectedNode.rating}/5` : '--'}</p></div>
                  </div>
                  {selectedNode.genre && <div><p className="text-xs text-gray-500">Genres</p><p className="text-sm text-white">{selectedNode.genre}</p></div>}
                </div>
              )}

              {/* Sample-specific details */}
              {selectedNode.tier === 'sample' && (
                <div className="p-3 bg-lattice-bg rounded-lg space-y-2">
                  <p className="text-xs font-semibold text-green-400 uppercase">Sample Info</p>
                  {selectedNode.originalSource && <div><p className="text-xs text-gray-500">Original Source</p><p className="text-sm text-white">{selectedNode.originalSource}</p></div>}
                  <div>
                    <p className="text-xs text-gray-500">Used By</p>
                    <div className="space-y-1 mt-1">
                      {connectedEdgesForSelected.filter(e => e.type === 'sampled_from').slice(0, 5).map(e => {
                        const otherId = e.source === selectedNode.id ? e.target : e.source;
                        const other = nodesRef.current.find(n => n.id === otherId);
                        return other ? <p key={otherId} className="text-xs text-gray-300">{other.label}</p> : null;
                      })}
                      {connectedEdgesForSelected.filter(e => e.type === 'sampled_from').length === 0 && <p className="text-xs text-gray-500 italic">No sample links yet</p>}
                    </div>
                  </div>
                </div>
              )}

              {/* Release-specific details */}
              {selectedNode.tier === 'release' && (
                <div className="p-3 bg-lattice-bg rounded-lg space-y-2">
                  <p className="text-xs font-semibold text-pink-400 uppercase">Release Info</p>
                  {selectedNode.releaseDate && <div><p className="text-xs text-gray-500">Release Date</p><p className="text-sm text-white">{selectedNode.releaseDate}</p></div>}
                  {selectedNode.platform && <div><p className="text-xs text-gray-500">Platform</p><p className="text-sm text-white">{selectedNode.platform}</p></div>}
                  <div>
                    <p className="text-xs text-gray-500">Tracks</p>
                    <div className="space-y-1 mt-1">
                      {selectedNode.trackList?.map((t, i) => (
                        <p key={i} className="text-xs text-gray-300">{i + 1}. {t}</p>
                      ))}
                      {!selectedNode.trackList?.length && (
                        connectedEdgesForSelected.filter(e => e.type === 'released_on').slice(0, 8).map(e => {
                          const otherId = e.source === selectedNode.id ? e.target : e.source;
                          const other = nodesRef.current.find(n => n.id === otherId);
                          return other ? <p key={otherId} className="text-xs text-gray-300">{other.label}</p> : null;
                        })
                      )}
                    </div>
                  </div>
                </div>
              )}

              {/* Cluster info */}
              {viewMode === 'cluster' && selectedNode.cluster !== undefined && (
                <div className="p-3 bg-lattice-bg rounded-lg">
                  <p className="text-xs text-gray-400">Cluster</p>
                  <div className="flex items-center gap-2 mt-1">
                    <div className="w-3 h-3 rounded-full" style={{ backgroundColor: CLUSTER_COLORS[selectedNode.cluster % CLUSTER_COLORS.length] }} />
                    <span className="font-medium text-white">Group {selectedNode.cluster + 1}</span>
                  </div>
                </div>
              )}

              {/* Tags */}
              {selectedNode.tags.length > 0 && (
                <div>
                  <p className="text-xs text-gray-400 mb-2">Tags</p>
                  <div className="flex flex-wrap gap-2">
                    {selectedNode.tags.map(tag => (
                      <button key={tag} onClick={() => setSearchQuery(tag)} className="px-2 py-1 text-xs bg-lattice-bg rounded text-gray-300 hover:text-neon-cyan">#{tag}</button>
                    ))}
                  </div>
                </div>
              )}

              {/* Connected nodes */}
              <div>
                <p className="text-xs text-gray-400 mb-2">Connected To</p>
                <div className="space-y-1 max-h-48 overflow-y-auto">
                  {connectedEdgesForSelected.slice(0, 12).map(e => {
                    const otherId = e.source === selectedNode.id ? e.target : e.source;
                    const other = nodesRef.current.find(n => n.id === otherId);
                    if (!other) return null;
                    return (
                      <button key={otherId} onClick={() => setSelectedNode(other)}
                        className="w-full flex items-center gap-2 p-2 bg-lattice-bg rounded text-left hover:bg-lattice-elevated">
                        <div className="w-2 h-2 rounded-full" style={{ backgroundColor: (NODE_COLORS[other.tier] || NODE_COLORS.regular).fill }} />
                        <span className="text-sm text-gray-300 truncate flex-1">{other.label}</span>
                        {e.type && <span className="text-xs px-1.5 py-0.5 rounded bg-lattice-surface text-gray-500">{EDGE_LABELS[e.type as EdgeType] || e.type}</span>}
                        <ChevronRight className="w-4 h-4 text-gray-500 flex-shrink-0" />
                      </button>
                    );
                  })}
                </div>
              </div>

              {/* Actions */}
              <div className="space-y-2 pt-4 border-t border-lattice-border">
                <button onClick={() => window.open(`/dtu/${selectedNode.id}`, '_blank')} className="w-full py-2 bg-neon-cyan text-black font-medium rounded-lg hover:bg-neon-cyan/90 text-sm">Open DTU</button>
                <button onClick={() => { setFilterRelated(selectedNode.id); }} className="w-full py-2 bg-lattice-bg text-gray-300 rounded-lg hover:bg-lattice-elevated text-sm">View Related</button>
                <button onClick={() => { setPathStart(selectedNode.id); setShowPathfinder(true); }} className="w-full py-2 bg-lattice-bg text-gray-300 rounded-lg hover:bg-lattice-elevated text-sm">Find Paths From Here</button>
                <button onClick={() => { setConnectMode(true); setConnectSource(selectedNode.id); }} className="w-full py-2 bg-lattice-bg text-gray-300 rounded-lg hover:bg-lattice-elevated text-sm">Connect From Here</button>
              </div>
            </div>
          </motion.aside>
        )}
      </AnimatePresence>
      </div>

      {/* Knowledge Genome Browser — DTU Lineage Visualization */}
      <div className="mt-6">
        <KnowledgeGenomeBrowser />
      </div>

      {/* DTU Context */}
      <div className="mt-6 space-y-3">
        <LensContextPanel
          hyperDTUs={hyperDTUs}
          megaDTUs={megaDTUs}
          regularDTUs={regularDTUs}
          tierDistribution={tierDistribution}
          onPublish={(dtu) => publishToMarketplace({ dtuId: dtu.id })}
          title="Graph DTUs"
        />
        <FeedbackWidget targetType="lens" targetId="graph" />
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
            <LensFeaturePanel lensId="graph" />
          </div>
        )}
      </div>

      {/* ---- Graph Domain Actions ---- */}
      <div className="panel p-4 space-y-4">
        <h2 className="font-semibold flex items-center gap-2">
          <Network className="w-4 h-4 text-neon-cyan" /> Graph Analytics Actions
        </h2>
        <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
          {[
            { action: 'nodeAnalysis', label: 'Node Analysis', icon: Cpu, color: 'neon-cyan', desc: 'Degree, betweenness & closeness centrality' },
            { action: 'pathFind', label: 'Path Find', icon: GitBranch, color: 'neon-purple', desc: 'BFS shortest path between nodes' },
            { action: 'clusterDetect', label: 'Cluster Detect', icon: Users, color: 'neon-green', desc: 'Connected components & fragmentation' },
            { action: 'graphMetrics', label: 'Graph Metrics', icon: BarChart3, color: 'amber-400', desc: 'Density, diameter, clustering coefficient' },
          ].map(({ action, label, icon: Icon, color, desc }) => (
            <button
              key={action}
              onClick={() => handleGraphAction(action)}
              disabled={runGraphAction.isPending || !graphArtifacts[0]?.id}
              className="p-3 rounded-lg border text-left transition-all disabled:opacity-50 disabled:cursor-not-allowed bg-lattice-surface border-lattice-border hover:border-white/20"
            >
              <div className="flex items-center gap-2 mb-1">
                {runGraphAction.isPending ? <Loader2 className={`w-4 h-4 text-${color} animate-spin`} /> : <Icon className={`w-4 h-4 text-${color}`} />}
                <span className="text-xs font-semibold text-white">{label}</span>
              </div>
              <p className="text-xs text-gray-500">{desc}</p>
            </button>
          ))}
        </div>
        {!graphArtifacts[0]?.id && (
          <p className="text-xs text-gray-500 text-center">Create a graph-data artifact to run graph analytics.</p>
        )}

        {runGraphAction.isPending && (
          <div className="flex items-center justify-center gap-3 py-4">
            <Loader2 className="w-5 h-5 text-neon-cyan animate-spin" />
            <span className="text-sm text-gray-400">Analyzing graph...</span>
          </div>
        )}

        {graphActionResult && !runGraphAction.isPending && (() => {
          const r = graphActionResult.data as Record<string, unknown>;
          if (graphActionResult.action === 'nodeAnalysis') {
            const summary = r.summary as Record<string, unknown> | undefined;
            const nodes = (r.nodes as { id: string; degree: number; degreeCentrality: number; betweennessCentrality: number; isIsolated: boolean }[]) || [];
            return (
              <div className="space-y-3">
                <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
                  <div className="lens-card text-center"><p className="text-xl font-bold text-white">{r.nodeCount as number}</p><p className="text-xs text-gray-400">Nodes</p></div>
                  <div className="lens-card text-center"><p className="text-xl font-bold text-white">{r.edgeCount as number}</p><p className="text-xs text-gray-400">Edges</p></div>
                  <div className="lens-card text-center"><p className="text-xl font-bold text-neon-cyan">{summary?.averageDegree as number}</p><p className="text-xs text-gray-400">Avg Degree</p></div>
                  <div className="lens-card text-center"><p className="text-xl font-bold text-yellow-400">{summary?.isolatedNodes as number}</p><p className="text-xs text-gray-400">Isolated</p></div>
                </div>
                {!!summary?.mostConnected && <div className="lens-card flex justify-between text-sm"><span className="text-gray-400">Most Connected</span><span className="text-neon-cyan font-mono">{summary.mostConnected as string}</span></div>}
                {nodes.slice(0, 5).length > 0 && (
                  <div className="space-y-1">
                    <p className="text-xs text-gray-500 uppercase tracking-wider">Top Nodes by Centrality</p>
                    {nodes.slice(0, 5).map((n) => (
                      <div key={n.id} className="lens-card flex items-center justify-between text-xs">
                        <span className="text-white font-mono">{n.id}</span>
                        <div className="flex items-center gap-3">
                          <span className="text-gray-400">degree: <span className="text-neon-cyan">{n.degree}</span></span>
                          <span className="text-gray-400">btw: <span className="text-neon-purple">{n.betweennessCentrality}</span></span>
                        </div>
                      </div>
                    ))}
                  </div>
                )}
              </div>
            );
          }
          if (graphActionResult.action === 'pathFind') {
            const found = r.found as boolean;
            const path = r.path as string[] | null;
            return (
              <div className="space-y-3">
                <div className={`lens-card flex items-center gap-3 border ${found ? 'border-neon-green/30' : 'border-red-400/30'}`}>
                  <span className={found ? 'text-neon-green' : 'text-red-400'}>{found ? 'Path found' : 'No path'}</span>
                  {found && <span className="text-xs text-gray-400">{r.hopCount as number} hops, weight: {r.weightedDistance as number}</span>}
                </div>
                {path && path.length > 0 && (
                  <div className="flex flex-wrap items-center gap-1">
                    {path.map((node, i) => (
                      <span key={i} className="flex items-center gap-1">
                        <span className="text-xs px-2 py-1 rounded bg-neon-cyan/10 text-neon-cyan font-mono">{node}</span>
                        {i < path.length - 1 && <span className="text-gray-500 text-xs">→</span>}
                      </span>
                    ))}
                  </div>
                )}
                {!!r.message && <p className="text-xs text-gray-400">{r.message as string}</p>}
              </div>
            );
          }
          if (graphActionResult.action === 'clusterDetect') {
            const clusters = (r.clusters as { clusterId: number; size: number; nodes: string[]; density: number; isIsolatedNode: boolean }[]) || [];
            const summary = r.summary as Record<string, unknown> | undefined;
            return (
              <div className="space-y-3">
                <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
                  <div className="lens-card text-center"><p className="text-xl font-bold text-white">{r.totalNodes as number}</p><p className="text-xs text-gray-400">Nodes</p></div>
                  <div className="lens-card text-center"><p className="text-xl font-bold text-neon-cyan">{r.clusterCount as number}</p><p className="text-xs text-gray-400">Clusters</p></div>
                  <div className="lens-card text-center"><p className="text-xl font-bold text-yellow-400">{summary?.isolatedNodes as number}</p><p className="text-xs text-gray-400">Isolated</p></div>
                  <div className="lens-card text-center"><p className="text-xl font-bold text-neon-purple">{summary?.fragmentationIndex as number}</p><p className="text-xs text-gray-400">Fragmentation</p></div>
                </div>
                {!!summary?.connectivity && <div className="lens-card flex justify-between text-sm"><span className="text-gray-400">Connectivity</span><span className="text-neon-cyan">{summary.connectivity as string}</span></div>}
                {clusters.slice(0, 4).map((c) => (
                  <div key={c.clusterId} className="lens-card">
                    <div className="flex items-center justify-between mb-1">
                      <span className="text-xs font-medium text-white">Cluster {c.clusterId}</span>
                      <div className="flex items-center gap-2 text-xs">
                        <span className="text-gray-400">{c.size} nodes</span>
                        <span className="text-gray-400">density: {c.density}</span>
                      </div>
                    </div>
                    <div className="flex flex-wrap gap-1">
                      {c.nodes.slice(0, 6).map((n) => <span key={n} className="text-xs px-1.5 py-0.5 rounded bg-neon-cyan/10 text-neon-cyan font-mono">{n}</span>)}
                      {c.nodes.length > 6 && <span className="text-xs text-gray-500">+{c.nodes.length - 6}</span>}
                    </div>
                  </div>
                ))}
              </div>
            );
          }
          if (graphActionResult.action === 'graphMetrics') {
            const metrics = r.metrics as Record<string, unknown> | undefined;
            return (
              <div className="space-y-3">
                <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
                  <div className="lens-card text-center"><p className="text-xl font-bold text-white">{r.nodeCount as number}</p><p className="text-xs text-gray-400">Nodes</p></div>
                  <div className="lens-card text-center"><p className="text-xl font-bold text-white">{r.edgeCount as number}</p><p className="text-xs text-gray-400">Edges</p></div>
                  {metrics && <>
                    <div className="lens-card text-center"><p className="text-xl font-bold text-neon-cyan">{metrics.density as number}</p><p className="text-xs text-gray-400">Density</p></div>
                    <div className="lens-card text-center"><p className="text-xl font-bold text-neon-purple">{metrics.clusteringCoefficient as number}</p><p className="text-xs text-gray-400">Clustering</p></div>
                  </>}
                </div>
                {metrics && (
                  <div className="grid grid-cols-2 gap-3">
                    <div className="lens-card space-y-1 text-sm">
                      <div className="flex justify-between"><span className="text-gray-400">Avg Degree</span><span className="text-white">{metrics.averageDegree as number}</span></div>
                      <div className="flex justify-between"><span className="text-gray-400">Max Degree</span><span className="text-white">{metrics.maxDegree as number}</span></div>
                      <div className="flex justify-between"><span className="text-gray-400">Density Label</span><span className="text-neon-cyan">{metrics.densityLabel as string}</span></div>
                    </div>
                    <div className="lens-card space-y-1 text-sm">
                      <div className="flex justify-between"><span className="text-gray-400">Diameter</span><span className="text-white">{(metrics.diameter as number | null | undefined) ?? 'n/a'}</span></div>
                      <div className="flex justify-between"><span className="text-gray-400">Avg Path Length</span><span className="text-white">{metrics.averagePathLength as number}</span></div>
                      <div className="flex justify-between"><span className="text-gray-400">Connected</span><span className={metrics.isConnected ? 'text-neon-green' : 'text-red-400'}>{metrics.isConnected ? 'Yes' : 'No'}</span></div>
                    </div>
                  </div>
                )}
              </div>
            );
          }
          return null;
        })()}
      </div>
    </div>
  );
}
