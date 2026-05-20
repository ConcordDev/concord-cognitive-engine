// server/domains/graph.js
// Domain actions for graph: node analysis, path finding, cluster detection, graph metrics.

export default function registerGraphActions(registerLensAction) {
  /**
   * nodeAnalysis
   * Compute degree centrality and connectivity for nodes in adjacency data.
   * artifact.data.nodes: [string | { id }]
   * artifact.data.edges: [{ source, target, weight? }] or [[ source, target ]]
   * artifact.data.directed: boolean (default false)
   */
  registerLensAction("graph", "nodeAnalysis", (ctx, artifact, _params) => {
    const rawNodes = artifact.data?.nodes || [];
    const rawEdges = artifact.data?.edges || [];
    const directed = artifact.data?.directed || false;

    if (rawNodes.length === 0 && rawEdges.length === 0) {
      return { ok: true, result: { message: "No graph data provided. Supply artifact.data.nodes and artifact.data.edges ([{ source, target, weight? }]).", nodes: [], summary: null } };
    }

    // Normalize nodes
    const nodeSet = new Set();
    for (const n of rawNodes) {
      nodeSet.add(typeof n === "object" ? String(n.id) : String(n));
    }

    // Normalize edges and collect implicit nodes
    const edges = rawEdges.map((e) => {
      if (Array.isArray(e)) {
        return { source: String(e[0]), target: String(e[1]), weight: parseFloat(e[2]) || 1 };
      }
      return { source: String(e.source), target: String(e.target), weight: parseFloat(e.weight) || 1 };
    });

    for (const e of edges) {
      nodeSet.add(e.source);
      nodeSet.add(e.target);
    }

    const nodeIds = [...nodeSet];
    const n = nodeIds.length;

    // Build adjacency lists
    const adjOut = {};
    const adjIn = {};
    for (const id of nodeIds) {
      adjOut[id] = [];
      adjIn[id] = [];
    }

    for (const e of edges) {
      adjOut[e.source].push({ target: e.target, weight: e.weight });
      adjIn[e.target].push({ source: e.source, weight: e.weight });
      if (!directed) {
        adjOut[e.target].push({ target: e.source, weight: e.weight });
        adjIn[e.source].push({ source: e.target, weight: e.weight });
      }
    }

    // Degree centrality: degree / (n - 1)
    const maxPossibleDegree = n > 1 ? n - 1 : 1;

    // Closeness centrality via BFS shortest paths (unweighted)
    function bfsDistances(startId) {
      const dist = {};
      dist[startId] = 0;
      const queue = [startId];
      let head = 0;
      while (head < queue.length) {
        const curr = queue[head++];
        for (const neighbor of adjOut[curr]) {
          if (dist[neighbor.target] === undefined) {
            dist[neighbor.target] = dist[curr] + 1;
            queue.push(neighbor.target);
          }
        }
      }
      return dist;
    }

    // Betweenness centrality (Brandes' algorithm)
    const betweenness = {};
    for (const id of nodeIds) betweenness[id] = 0;

    for (const s of nodeIds) {
      const stack = [];
      const predecessors = {};
      const sigma = {};
      const dist = {};
      const delta = {};

      for (const id of nodeIds) {
        predecessors[id] = [];
        sigma[id] = 0;
        dist[id] = -1;
        delta[id] = 0;
      }

      sigma[s] = 1;
      dist[s] = 0;
      const queue = [s];
      let head = 0;

      while (head < queue.length) {
        const v = queue[head++];
        stack.push(v);
        for (const neighbor of adjOut[v]) {
          const w = neighbor.target;
          if (dist[w] < 0) {
            queue.push(w);
            dist[w] = dist[v] + 1;
          }
          if (dist[w] === dist[v] + 1) {
            sigma[w] += sigma[v];
            predecessors[w].push(v);
          }
        }
      }

      while (stack.length > 0) {
        const w = stack.pop();
        for (const v of predecessors[w]) {
          delta[v] += (sigma[v] / sigma[w]) * (1 + delta[w]);
        }
        if (w !== s) {
          betweenness[w] += directed ? delta[w] : delta[w] / 2;
        }
      }
    }

    // Normalize betweenness
    const betweennessNorm = n > 2 ? ((n - 1) * (n - 2)) / (directed ? 1 : 2) : 1;

    const nodeAnalysis = nodeIds.map((id) => {
      const outDegree = adjOut[id].length;
      const inDegree = directed ? adjIn[id].length : outDegree;
      const totalWeight = adjOut[id].reduce((s, e) => s + e.weight, 0);
      const neighbors = [...new Set(adjOut[id].map((e) => e.target))];

      // Closeness
      const distances = bfsDistances(id);
      const reachableNodes = Object.values(distances).filter((d) => d > 0);
      const totalDist = reachableNodes.reduce((s, d) => s + d, 0);
      const closeness = totalDist > 0 ? Math.round(((reachableNodes.length) / totalDist) * 10000) / 10000 : 0;

      return {
        id,
        outDegree,
        inDegree: directed ? inDegree : undefined,
        degree: directed ? outDegree + adjIn[id].length : outDegree,
        degreeCentrality: Math.round((outDegree / maxPossibleDegree) * 10000) / 10000,
        closenessCentrality: closeness,
        betweennessCentrality: Math.round((betweenness[id] / betweennessNorm) * 10000) / 10000,
        totalEdgeWeight: Math.round(totalWeight * 100) / 100,
        neighborCount: neighbors.length,
        neighbors,
        isIsolated: outDegree === 0 && (!directed || adjIn[id].length === 0),
      };
    });

    // Sort by degree centrality descending
    nodeAnalysis.sort((a, b) => b.degreeCentrality - a.degreeCentrality);

    const totalDegree = nodeAnalysis.reduce((s, na) => s + (na.degree || na.outDegree), 0);
    const avgDegree = n > 0 ? Math.round((totalDegree / n) * 100) / 100 : 0;
    const isolatedNodes = nodeAnalysis.filter((na) => na.isIsolated).length;

    const result = {
      nodeCount: n,
      edgeCount: edges.length,
      directed,
      nodes: nodeAnalysis,
      summary: {
        averageDegree: avgDegree,
        mostConnected: nodeAnalysis[0]?.id || null,
        leastConnected: nodeAnalysis[nodeAnalysis.length - 1]?.id || null,
        isolatedNodes,
        highBetweennessNodes: nodeAnalysis
          .filter((na) => na.betweennessCentrality > 0.1)
          .map((na) => na.id),
      },
    };

    artifact.data.nodeAnalysis = result;
    return { ok: true, result };
  });

  /**
   * pathFind
   * BFS shortest path between two nodes.
   * artifact.data.edges: [{ source, target, weight? }]
   * artifact.data.from: string
   * artifact.data.to: string
   * artifact.data.directed: boolean (default false)
   */
  registerLensAction("graph", "pathFind", (ctx, artifact, _params) => {
    const rawEdges = artifact.data?.edges || [];
    const from = artifact.data?.from != null ? String(artifact.data.from) : null;
    const to = artifact.data?.to != null ? String(artifact.data.to) : null;
    const directed = artifact.data?.directed || false;

    if (rawEdges.length === 0 || !from || !to) {
      return { ok: true, result: { message: "Provide artifact.data.edges, artifact.data.from, and artifact.data.to. Edges: [{ source, target }].", path: null, distance: null } };
    }

    // Build adjacency
    const adj = {};
    const edges = rawEdges.map((e) => {
      if (Array.isArray(e)) {
        return { source: String(e[0]), target: String(e[1]), weight: parseFloat(e[2]) || 1 };
      }
      return { source: String(e.source), target: String(e.target), weight: parseFloat(e.weight) || 1 };
    });

    for (const e of edges) {
      if (!adj[e.source]) adj[e.source] = [];
      adj[e.source].push({ target: e.target, weight: e.weight });
      if (!directed) {
        if (!adj[e.target]) adj[e.target] = [];
        adj[e.target].push({ target: e.source, weight: e.weight });
      }
    }

    const allNodes = new Set(Object.keys(adj));
    for (const e of edges) { allNodes.add(e.source); allNodes.add(e.target); }

    if (!allNodes.has(from)) {
      return { ok: true, result: { message: `Source node "${from}" not found in the graph.`, path: null, found: false } };
    }
    if (!allNodes.has(to)) {
      return { ok: true, result: { message: `Target node "${to}" not found in the graph.`, path: null, found: false } };
    }

    // BFS for unweighted shortest path
    const visited = new Set();
    const parent = {};
    const dist = {};
    visited.add(from);
    dist[from] = 0;
    parent[from] = null;
    const queue = [from];
    let head = 0;
    let found = false;

    while (head < queue.length) {
      const curr = queue[head++];
      if (curr === to) {
        found = true;
        break;
      }
      for (const neighbor of (adj[curr] || [])) {
        if (!visited.has(neighbor.target)) {
          visited.add(neighbor.target);
          parent[neighbor.target] = curr;
          dist[neighbor.target] = dist[curr] + 1;
          queue.push(neighbor.target);
        }
      }
    }

    if (!found) {
      return { ok: true, result: { message: `No path exists from "${from}" to "${to}".`, from, to, found: false, path: null, exploredNodes: visited.size } };
    }

    // Reconstruct path
    const path = [];
    let curr = to;
    while (curr !== null) {
      path.unshift(curr);
      curr = parent[curr];
    }

    // Calculate weighted distance along the path
    let weightedDist = 0;
    for (let i = 0; i < path.length - 1; i++) {
      const neighbors = adj[path[i]] || [];
      const edge = neighbors.find((e) => e.target === path[i + 1]);
      weightedDist += edge ? edge.weight : 1;
    }

    // Also find all nodes reachable from source to assess connectivity
    const reachableFromSource = visited.size;

    const result = {
      from,
      to,
      found: true,
      path,
      hopCount: path.length - 1,
      weightedDistance: Math.round(weightedDist * 100) / 100,
      exploredNodes: visited.size,
      legs: path.slice(0, -1).map((node, i) => {
        const next = path[i + 1];
        const neighbors = adj[node] || [];
        const edge = neighbors.find((e) => e.target === next);
        return { from: node, to: next, weight: edge ? edge.weight : 1 };
      }),
    };

    artifact.data.pathResult = result;
    return { ok: true, result };
  });

  /**
   * clusterDetect
   * Identify connected components in a graph.
   * artifact.data.edges: [{ source, target }]
   * artifact.data.nodes: [string] (optional, to include isolated nodes)
   * artifact.data.directed: boolean (default false; if true, finds weakly connected components)
   */
  registerLensAction("graph", "clusterDetect", (ctx, artifact, _params) => {
    const rawEdges = artifact.data?.edges || [];
    const rawNodes = artifact.data?.nodes || [];

    if (rawEdges.length === 0 && rawNodes.length === 0) {
      return { ok: true, result: { message: "No graph data provided. Supply artifact.data.edges as [{ source, target }] and optionally artifact.data.nodes.", clusters: [], clusterCount: 0 } };
    }

    // Build undirected adjacency (weakly connected for directed graphs)
    const adj = {};
    const nodeSet = new Set();

    for (const n of rawNodes) {
      const id = typeof n === "object" ? String(n.id) : String(n);
      nodeSet.add(id);
    }

    const edges = rawEdges.map((e) => {
      if (Array.isArray(e)) {
        return { source: String(e[0]), target: String(e[1]) };
      }
      return { source: String(e.source), target: String(e.target) };
    });

    for (const e of edges) {
      nodeSet.add(e.source);
      nodeSet.add(e.target);
      if (!adj[e.source]) adj[e.source] = [];
      if (!adj[e.target]) adj[e.target] = [];
      adj[e.source].push(e.target);
      adj[e.target].push(e.source);
    }

    for (const id of nodeSet) {
      if (!adj[id]) adj[id] = [];
    }

    // Find connected components via BFS
    const visited = new Set();
    const components = [];

    for (const nodeId of nodeSet) {
      if (visited.has(nodeId)) continue;
      const component = [];
      const queue = [nodeId];
      let head = 0;
      visited.add(nodeId);

      while (head < queue.length) {
        const curr = queue[head++];
        component.push(curr);
        for (const neighbor of adj[curr]) {
          if (!visited.has(neighbor)) {
            visited.add(neighbor);
            queue.push(neighbor);
          }
        }
      }
      components.push(component);
    }

    // Sort components by size descending
    components.sort((a, b) => b.length - a.length);

    // Analyze each component
    const clusters = components.map((comp, idx) => {
      // Count internal edges
      const compSet = new Set(comp);
      let internalEdges = 0;
      for (const e of edges) {
        if (compSet.has(e.source) && compSet.has(e.target)) {
          internalEdges++;
        }
      }

      const maxEdges = (comp.length * (comp.length - 1)) / 2;
      const density = maxEdges > 0 ? Math.round((internalEdges / maxEdges) * 10000) / 10000 : comp.length === 1 ? 0 : 0;

      return {
        clusterId: idx,
        size: comp.length,
        nodes: comp,
        internalEdges,
        density,
        isIsolatedNode: comp.length === 1 && adj[comp[0]].length === 0,
      };
    });

    const totalNodes = nodeSet.size;
    const isolatedCount = clusters.filter((c) => c.isIsolatedNode).length;
    const largestSize = clusters.length > 0 ? clusters[0].size : 0;
    const largestFraction = totalNodes > 0 ? Math.round((largestSize / totalNodes) * 10000) / 10000 : 0;

    // Fragmentation index: 1 - sum((component_size / total)^2)
    const fragmentation = totalNodes > 0
      ? Math.round((1 - clusters.reduce((s, c) => s + Math.pow(c.size / totalNodes, 2), 0)) * 10000) / 10000
      : 0;

    const result = {
      totalNodes,
      totalEdges: edges.length,
      clusterCount: clusters.length,
      clusters,
      summary: {
        largestClusterSize: largestSize,
        largestClusterFraction: largestFraction,
        isolatedNodes: isolatedCount,
        fragmentationIndex: fragmentation,
        connectivity: clusters.length === 1 ? "fully-connected" : clusters.length <= 3 ? "mostly-connected" : "fragmented",
      },
    };

    artifact.data.clusters = result;
    return { ok: true, result };
  });

  /**
   * graphMetrics
   * Calculate density, diameter, average degree for a graph.
   * artifact.data.edges: [{ source, target }]
   * artifact.data.nodes: [string] (optional)
   * artifact.data.directed: boolean (default false)
   */
  registerLensAction("graph", "graphMetrics", (ctx, artifact, _params) => {
    const rawEdges = artifact.data?.edges || [];
    const rawNodes = artifact.data?.nodes || [];
    const directed = artifact.data?.directed || false;

    if (rawEdges.length === 0 && rawNodes.length === 0) {
      return { ok: true, result: { message: "No graph data provided. Supply artifact.data.edges and optionally artifact.data.nodes.", metrics: null } };
    }

    const nodeSet = new Set();
    for (const n of rawNodes) {
      nodeSet.add(typeof n === "object" ? String(n.id) : String(n));
    }

    const edges = rawEdges.map((e) => {
      if (Array.isArray(e)) {
        return { source: String(e[0]), target: String(e[1]) };
      }
      return { source: String(e.source), target: String(e.target) };
    });

    for (const e of edges) {
      nodeSet.add(e.source);
      nodeSet.add(e.target);
    }

    const nodeIds = [...nodeSet];
    const n = nodeIds.length;
    const m = edges.length;

    // Build adjacency
    const adj = {};
    for (const id of nodeIds) adj[id] = [];
    for (const e of edges) {
      adj[e.source].push(e.target);
      if (!directed) adj[e.target].push(e.source);
    }

    // Density
    const maxEdges = directed ? n * (n - 1) : (n * (n - 1)) / 2;
    const density = maxEdges > 0 ? Math.round((m / maxEdges) * 10000) / 10000 : 0;

    // Degree distribution
    const degrees = nodeIds.map((id) => adj[id].length);
    const totalDegree = degrees.reduce((s, d) => s + d, 0);
    const avgDegree = n > 0 ? Math.round((totalDegree / n) * 100) / 100 : 0;
    const maxDeg = Math.max(0, ...degrees);
    const minDeg = Math.min(Infinity, ...degrees);
    const degreeVariance = n > 0
      ? degrees.reduce((s, d) => s + Math.pow(d - avgDegree, 2), 0) / n
      : 0;
    const degreeStdDev = Math.round(Math.sqrt(degreeVariance) * 100) / 100;

    // Degree histogram
    const histogram = {};
    for (const d of degrees) {
      histogram[d] = (histogram[d] || 0) + 1;
    }

    // BFS from each node to compute diameter, avg path length, eccentricity
    let diameter = 0;
    let totalPathLength = 0;
    let pathCount = 0;
    const eccentricities = {};
    let radius = Infinity;

    for (const startId of nodeIds) {
      const dist = {};
      dist[startId] = 0;
      const queue = [startId];
      let head = 0;
      let maxDist = 0;

      while (head < queue.length) {
        const curr = queue[head++];
        for (const neighbor of adj[curr]) {
          if (dist[neighbor] === undefined) {
            dist[neighbor] = dist[curr] + 1;
            if (dist[neighbor] > maxDist) maxDist = dist[neighbor];
            totalPathLength += dist[neighbor];
            pathCount++;
            queue.push(neighbor);
          }
        }
      }

      eccentricities[startId] = maxDist;
      if (maxDist > diameter) diameter = maxDist;
      if (maxDist < radius && Object.keys(dist).length === n) radius = maxDist;
    }

    if (radius === Infinity) radius = 0;
    const avgPathLength = pathCount > 0 ? Math.round((totalPathLength / pathCount) * 10000) / 10000 : 0;

    // Clustering coefficient (local transitivity)
    let totalClustering = 0;
    let clusterableNodes = 0;
    for (const id of nodeIds) {
      const neighbors = [...new Set(adj[id])];
      const k = neighbors.length;
      if (k < 2) continue;
      clusterableNodes++;
      let triangles = 0;
      for (let i = 0; i < neighbors.length; i++) {
        for (let j = i + 1; j < neighbors.length; j++) {
          if (adj[neighbors[i]].includes(neighbors[j])) {
            triangles++;
          }
        }
      }
      const possibleTriangles = (k * (k - 1)) / 2;
      totalClustering += triangles / possibleTriangles;
    }
    const avgClusteringCoefficient = clusterableNodes > 0
      ? Math.round((totalClustering / clusterableNodes) * 10000) / 10000
      : 0;

    // Check if connected
    const startDist = {};
    startDist[nodeIds[0]] = 0;
    const bfsQueue = [nodeIds[0]];
    let bfsHead = 0;
    while (bfsHead < bfsQueue.length) {
      const curr = bfsQueue[bfsHead++];
      for (const neighbor of adj[curr]) {
        if (startDist[neighbor] === undefined) {
          startDist[neighbor] = startDist[curr] + 1;
          bfsQueue.push(neighbor);
        }
      }
    }
    const isConnected = Object.keys(startDist).length === n;

    const result = {
      nodeCount: n,
      edgeCount: m,
      directed,
      metrics: {
        density,
        densityLabel: density > 0.7 ? "dense" : density > 0.3 ? "moderate" : density > 0.1 ? "sparse" : "very-sparse",
        averageDegree: avgDegree,
        maxDegree: maxDeg,
        minDegree: minDeg === Infinity ? 0 : minDeg,
        degreeStdDev,
        diameter: isConnected ? diameter : null,
        radius: isConnected ? radius : null,
        averagePathLength: avgPathLength,
        clusteringCoefficient: avgClusteringCoefficient,
        isConnected,
      },
      degreeHistogram: histogram,
      eccentricities,
    };

    artifact.data.graphMetrics = result;
    return { ok: true, result };
  });

  // ─── Mind-map / concept-graph builder (XMind / MindMeister shape) ────

  function getGraphState() {
    const STATE = globalThis._concordSTATE;
    if (!STATE) return null;
    if (!STATE.graphLens) STATE.graphLens = {};
    if (!(STATE.graphLens.maps instanceof Map)) STATE.graphLens.maps = new Map(); // userId -> Array
    return STATE.graphLens;
  }
  function saveGraph() {
    if (typeof globalThis._concordSaveStateDebounced === "function") {
      try { globalThis._concordSaveStateDebounced(); } catch (_e) { /* best effort */ }
    }
  }
  const gphId = (p) => `${p}_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`;
  const gphActor = (ctx) => ctx?.actor?.userId || ctx?.userId || "anon";
  const gphClean = (v, max = 600) => String(v == null ? "" : v).trim().slice(0, max);
  const gphMaps = (s, userId) => { if (!s.maps.has(userId)) s.maps.set(userId, []); return s.maps.get(userId); };

  registerLensAction("graph", "map-create", (ctx, _a, params = {}) => {
    const s = getGraphState(); if (!s) return { ok: false, error: "STATE unavailable" };
    const title = gphClean(params.title, 160);
    if (!title) return { ok: false, error: "map title required" };
    // a fresh map starts with a central node
    const central = { id: gphId("nd"), label: title, notes: "", central: true };
    const map = { id: gphId("mp"), title, nodes: [central], edges: [], createdAt: new Date().toISOString() };
    gphMaps(s, gphActor(ctx)).push(map);
    saveGraph();
    return { ok: true, result: { map } };
  });

  registerLensAction("graph", "map-list", (ctx, _a, _params = {}) => {
    const s = getGraphState(); if (!s) return { ok: false, error: "STATE unavailable" };
    const maps = gphMaps(s, gphActor(ctx)).map((m) => ({
      id: m.id, title: m.title, nodeCount: m.nodes.length, edgeCount: m.edges.length, createdAt: m.createdAt,
    }));
    return { ok: true, result: { maps, count: maps.length } };
  });

  registerLensAction("graph", "map-detail", (ctx, _a, params = {}) => {
    const s = getGraphState(); if (!s) return { ok: false, error: "STATE unavailable" };
    const m = gphMaps(s, gphActor(ctx)).find((x) => x.id === params.id);
    if (!m) return { ok: false, error: "map not found" };
    return { ok: true, result: { map: m } };
  });

  registerLensAction("graph", "map-delete", (ctx, _a, params = {}) => {
    const s = getGraphState(); if (!s) return { ok: false, error: "STATE unavailable" };
    const arr = gphMaps(s, gphActor(ctx));
    const i = arr.findIndex((x) => x.id === params.id);
    if (i < 0) return { ok: false, error: "map not found" };
    arr.splice(i, 1);
    saveGraph();
    return { ok: true, result: { deleted: params.id } };
  });

  function findMap(s, ctx, id) { return gphMaps(s, gphActor(ctx)).find((x) => x.id === id); }

  registerLensAction("graph", "node-add", (ctx, _a, params = {}) => {
    const s = getGraphState(); if (!s) return { ok: false, error: "STATE unavailable" };
    const m = findMap(s, ctx, params.mapId);
    if (!m) return { ok: false, error: "map not found" };
    const label = gphClean(params.label, 240);
    if (!label) return { ok: false, error: "node label required" };
    const node = { id: gphId("nd"), label, notes: gphClean(params.notes, 2000) || "", central: false };
    m.nodes.push(node);
    let edge = null;
    if (params.parentId) {
      const parent = m.nodes.find((n) => n.id === params.parentId);
      if (parent) {
        edge = { id: gphId("ed"), from: parent.id, to: node.id, label: "" };
        m.edges.push(edge);
      }
    }
    saveGraph();
    return { ok: true, result: { node, edge } };
  });

  registerLensAction("graph", "node-update", (ctx, _a, params = {}) => {
    const s = getGraphState(); if (!s) return { ok: false, error: "STATE unavailable" };
    const m = findMap(s, ctx, params.mapId);
    if (!m) return { ok: false, error: "map not found" };
    const node = m.nodes.find((n) => n.id === params.nodeId);
    if (!node) return { ok: false, error: "node not found" };
    if (params.label != null) node.label = gphClean(params.label, 240) || node.label;
    if (params.notes != null) node.notes = gphClean(params.notes, 2000);
    saveGraph();
    return { ok: true, result: { node } };
  });

  registerLensAction("graph", "node-delete", (ctx, _a, params = {}) => {
    const s = getGraphState(); if (!s) return { ok: false, error: "STATE unavailable" };
    const m = findMap(s, ctx, params.mapId);
    if (!m) return { ok: false, error: "map not found" };
    const node = m.nodes.find((n) => n.id === params.nodeId);
    if (!node) return { ok: false, error: "node not found" };
    if (node.central) return { ok: false, error: "cannot delete the central node" };
    m.nodes = m.nodes.filter((n) => n.id !== params.nodeId);
    m.edges = m.edges.filter((e) => e.from !== params.nodeId && e.to !== params.nodeId);
    saveGraph();
    return { ok: true, result: { deleted: params.nodeId } };
  });

  registerLensAction("graph", "edge-add", (ctx, _a, params = {}) => {
    const s = getGraphState(); if (!s) return { ok: false, error: "STATE unavailable" };
    const m = findMap(s, ctx, params.mapId);
    if (!m) return { ok: false, error: "map not found" };
    const from = m.nodes.find((n) => n.id === params.fromNodeId);
    const to = m.nodes.find((n) => n.id === params.toNodeId);
    if (!from || !to) return { ok: false, error: "both nodes must exist" };
    if (from.id === to.id) return { ok: false, error: "an edge cannot connect a node to itself" };
    if (m.edges.some((e) => e.from === from.id && e.to === to.id)) return { ok: false, error: "edge already exists" };
    const edge = { id: gphId("ed"), from: from.id, to: to.id, label: gphClean(params.label, 80) || "" };
    m.edges.push(edge);
    saveGraph();
    return { ok: true, result: { edge } };
  });

  registerLensAction("graph", "edge-delete", (ctx, _a, params = {}) => {
    const s = getGraphState(); if (!s) return { ok: false, error: "STATE unavailable" };
    const m = findMap(s, ctx, params.mapId);
    if (!m) return { ok: false, error: "map not found" };
    const i = m.edges.findIndex((e) => e.id === params.edgeId);
    if (i < 0) return { ok: false, error: "edge not found" };
    m.edges.splice(i, 1);
    saveGraph();
    return { ok: true, result: { deleted: params.edgeId } };
  });

  // map-metrics — degree distribution + most-connected node over a map.
  registerLensAction("graph", "map-metrics", (ctx, _a, params = {}) => {
    const s = getGraphState(); if (!s) return { ok: false, error: "STATE unavailable" };
    const m = findMap(s, ctx, params.id);
    if (!m) return { ok: false, error: "map not found" };
    const degree = {};
    for (const n of m.nodes) degree[n.id] = 0;
    for (const e of m.edges) { degree[e.from] = (degree[e.from] || 0) + 1; degree[e.to] = (degree[e.to] || 0) + 1; }
    let hub = null;
    for (const n of m.nodes) {
      if (!hub || degree[n.id] > degree[hub.id]) hub = n;
    }
    const isolated = m.nodes.filter((n) => degree[n.id] === 0 && !n.central);
    return {
      ok: true,
      result: {
        nodeCount: m.nodes.length,
        edgeCount: m.edges.length,
        avgDegree: m.nodes.length > 0 ? Math.round((m.edges.length * 2 / m.nodes.length) * 100) / 100 : 0,
        mostConnected: hub ? { label: hub.label, degree: degree[hub.id] } : null,
        isolatedNodes: isolated.length,
      },
    };
  });

  registerLensAction("graph", "graph-dashboard", (ctx, _a, _params = {}) => {
    const s = getGraphState(); if (!s) return { ok: false, error: "STATE unavailable" };
    const maps = gphMaps(s, gphActor(ctx));
    return {
      ok: true,
      result: {
        maps: maps.length,
        totalNodes: maps.reduce((n, m) => n + m.nodes.length, 0),
        totalEdges: maps.reduce((n, m) => n + m.edges.length, 0),
      },
    };
  });
}
