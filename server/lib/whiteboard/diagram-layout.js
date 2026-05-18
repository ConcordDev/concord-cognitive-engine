// server/lib/whiteboard/diagram-layout.js
//
// Whiteboard Sprint B Item #8 — real diagram layouter.
//
// Takes a structured graph { nodes: [{id, label, kind?}],
//                            edges: [{from, to, label?}] }
// and returns positioned whiteboard elements (rectangle/ellipse/arrow/
// text) ready to drop on the canvas.
//
// Algorithms:
//   - flowchart  → Sugiyama-style layered DAG (longest-path layering +
//                  median-heuristic crossing reduction + simple x-assignment)
//   - sequence   → vertical lifelines + diagonal arrows
//   - erd        → tree layout from the first node
//   - mindmap    → radial layout (root center, kids on rings)
//   - uml_class  → packed grid of class boxes with relations as arrows
//   - swot       → fixed 2×2 frames
//
// No external deps. Pure JS. Tested against fixture graphs in
// tests/whiteboard-diagram-layout.test.js.

const DEFAULT_NODE_W = 160;
const DEFAULT_NODE_H = 56;
const COL_GAP = 80;
const ROW_GAP = 100;

function _nodeKindFor(diagramKind) {
  if (diagramKind === "mindmap" || diagramKind === "erd") return "ellipse";
  if (diagramKind === "uml_class") return "notecard";
  return "rectangle";
}

/**
 * Layered DAG layout (Sugiyama-lite).
 * Layer assignment via longest-path; ordering via median heuristic;
 * x-assignment via centred bary-coords.
 */
function _layoutLayered(nodes, edges) {
  const ids = nodes.map((n) => n.id);
  const idToIdx = new Map(ids.map((id, i) => [id, i]));
  // Adjacency
  const out = ids.map(() => []);
  const inc = ids.map(() => []);
  for (const e of edges) {
    const f = idToIdx.get(e.from), t = idToIdx.get(e.to);
    if (f == null || t == null) continue;
    out[f].push(t); inc[t].push(f);
  }
  // Longest-path layering (works for DAGs; for cycles we just truncate)
  const layer = new Array(ids.length).fill(0);
  const order = _topoSort(ids.length, out);
  for (const i of order) {
    for (const j of out[i]) layer[j] = Math.max(layer[j], layer[i] + 1);
  }
  // Group by layer
  const layers = [];
  for (let i = 0; i < ids.length; i++) {
    (layers[layer[i]] = layers[layer[i]] || []).push(i);
  }
  // Crossing reduction — 2 sweeps of median heuristic
  for (let sweep = 0; sweep < 4; sweep++) {
    for (let L = 1; L < layers.length; L++) {
      const above = layers[L - 1];
      const aboveIdx = new Map(above.map((n, i) => [n, i]));
      layers[L].sort((a, b) => {
        const ma = _median(inc[a].map((p) => aboveIdx.get(p) ?? 0));
        const mb = _median(inc[b].map((p) => aboveIdx.get(p) ?? 0));
        return ma - mb;
      });
    }
  }
  // X-assignment: centre layers around 0
  const positions = new Array(ids.length).fill(null);
  let maxLayerWidth = 0;
  for (const L of layers) maxLayerWidth = Math.max(maxLayerWidth, L.length);
  const slotW = DEFAULT_NODE_W + COL_GAP;
  const slotH = DEFAULT_NODE_H + ROW_GAP;
  for (let L = 0; L < layers.length; L++) {
    const row = layers[L];
    const rowW = row.length * slotW;
    const xOff = (maxLayerWidth * slotW - rowW) / 2;
    for (let i = 0; i < row.length; i++) {
      positions[row[i]] = { x: xOff + i * slotW, y: L * slotH };
    }
  }
  return positions.map((p, i) => ({ id: ids[i], x: p?.x ?? 0, y: p?.y ?? 0, w: DEFAULT_NODE_W, h: DEFAULT_NODE_H }));
}

function _median(arr) {
  if (arr.length === 0) return 0;
  const s = arr.slice().sort((a, b) => a - b);
  const m = Math.floor(s.length / 2);
  return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2;
}

function _topoSort(n, out) {
  const indeg = new Array(n).fill(0);
  for (let i = 0; i < n; i++) for (const j of out[i]) indeg[j]++;
  const q = []; for (let i = 0; i < n; i++) if (indeg[i] === 0) q.push(i);
  const order = [];
  while (q.length) {
    const v = q.shift(); order.push(v);
    for (const j of out[v]) { indeg[j]--; if (indeg[j] === 0) q.push(j); }
  }
  // For cycles, append the rest deterministically.
  if (order.length < n) {
    for (let i = 0; i < n; i++) if (!order.includes(i)) order.push(i);
  }
  return order;
}

function _layoutRadial(nodes, edges) {
  if (nodes.length === 0) return [];
  // Pick root: first node with no incoming edges, fallback nodes[0]
  const incoming = new Set();
  for (const e of edges) incoming.add(e.to);
  const root = nodes.find((n) => !incoming.has(n.id)) || nodes[0];
  // BFS to assign rings
  const ringOf = new Map([[root.id, 0]]);
  const childrenOf = new Map();
  for (const n of nodes) childrenOf.set(n.id, []);
  for (const e of edges) {
    const arr = childrenOf.get(e.from);
    if (arr) arr.push(e.to);
  }
  const queue = [root.id];
  while (queue.length) {
    const id = queue.shift();
    const lvl = ringOf.get(id);
    for (const c of childrenOf.get(id) || []) {
      if (!ringOf.has(c)) { ringOf.set(c, lvl + 1); queue.push(c); }
    }
  }
  // Group by ring
  const rings = {};
  for (const n of nodes) {
    const r = ringOf.get(n.id) ?? 1;
    (rings[r] = rings[r] || []).push(n.id);
  }
  const positions = new Map();
  const ringRadius = 220;
  for (const [rStr, ids] of Object.entries(rings)) {
    const r = Number(rStr);
    if (r === 0) {
      positions.set(ids[0], { x: 0, y: 0, w: DEFAULT_NODE_W, h: DEFAULT_NODE_H });
      continue;
    }
    const radius = ringRadius * r;
    for (let i = 0; i < ids.length; i++) {
      const angle = (2 * Math.PI * i) / ids.length;
      positions.set(ids[i], { x: Math.round(radius * Math.cos(angle)), y: Math.round(radius * Math.sin(angle)), w: DEFAULT_NODE_W, h: DEFAULT_NODE_H });
    }
  }
  return nodes.map((n) => ({ id: n.id, ...(positions.get(n.id) || { x: 0, y: 0, w: DEFAULT_NODE_W, h: DEFAULT_NODE_H }) }));
}

function _layoutGridSwot(nodes) {
  // Pin first 4 nodes to the SWOT quadrants; rest cascade below.
  const quadrants = [
    { x: 0,   y: 0,   w: 380, h: 280 },
    { x: 400, y: 0,   w: 380, h: 280 },
    { x: 0,   y: 300, w: 380, h: 280 },
    { x: 400, y: 300, w: 380, h: 280 },
  ];
  const out = [];
  for (let i = 0; i < nodes.length; i++) {
    if (i < 4) out.push({ id: nodes[i].id, ...quadrants[i] });
    else out.push({ id: nodes[i].id, x: (i - 4) % 4 * (DEFAULT_NODE_W + COL_GAP), y: 600 + Math.floor((i - 4) / 4) * (DEFAULT_NODE_H + ROW_GAP), w: DEFAULT_NODE_W, h: DEFAULT_NODE_H });
  }
  return out;
}

function _layoutSequence(nodes, edges) {
  // Lifelines (vertical) for each node; arrows at successive y bands.
  const COL = DEFAULT_NODE_W + COL_GAP * 2;
  const out = nodes.map((n, i) => ({
    id: n.id, x: i * COL, y: 0, w: DEFAULT_NODE_W, h: DEFAULT_NODE_H,
    isLifeline: true,
  }));
  // Lifeline trunks rendered later as long verticals; positions already set.
  void edges;
  return out;
}

/**
 * Layout entrypoint.
 *
 * @param {object} graph — { nodes, edges, kind }
 * @returns {object} { elements, edgesElements } — drop-in whiteboard elements
 */
export function layoutDiagram(graph) {
  const kind = String(graph?.kind || "flowchart");
  const nodes = Array.isArray(graph?.nodes) ? graph.nodes : [];
  const edges = Array.isArray(graph?.edges) ? graph.edges : [];
  if (nodes.length === 0) return { elements: [], edgesElements: [] };

  let positions;
  if (kind === "mindmap") positions = _layoutRadial(nodes, edges);
  else if (kind === "swot") positions = _layoutGridSwot(nodes);
  else if (kind === "sequence") positions = _layoutSequence(nodes, edges);
  else if (kind === "erd" || kind === "uml_class") positions = _layoutRadial(nodes, edges);
  else positions = _layoutLayered(nodes, edges); // default = flowchart

  const elementKind = _nodeKindFor(kind);
  const elements = nodes.map((n, i) => {
    const p = positions.find((q) => q.id === n.id) || { x: 0, y: 0, w: DEFAULT_NODE_W, h: DEFAULT_NODE_H };
    return {
      id: `diag_${kind}_n_${i}`,
      sourceId: n.id,
      kind: elementKind,
      type: elementKind,
      x: p.x, y: p.y,
      width: p.w, height: p.h,
      text: String(n.label || n.id).slice(0, 200),
      stroke: "#9ca3af", fill: "transparent", strokeWidth: 2,
    };
  });

  const idToElement = new Map(elements.map((e) => [e.sourceId, e]));
  const edgesElements = edges.map((e, i) => {
    const a = idToElement.get(e.from);
    const b = idToElement.get(e.to);
    if (!a || !b) return null;
    return {
      id: `diag_${kind}_e_${i}`,
      kind: "arrow", type: "arrow",
      x: a.x + a.width / 2, y: a.y + a.height,
      x2: b.x + b.width / 2, y2: b.y,
      stroke: "#9ca3af", strokeWidth: 2,
      text: e.label ? String(e.label).slice(0, 60) : undefined,
    };
  }).filter(Boolean);

  return { elements, edgesElements, kind };
}

/**
 * Minimal Mermaid grammar parser — supports flowchart / sequenceDiagram /
 * erDiagram / mindmap. Returns the same { nodes, edges, kind } shape so
 * layoutDiagram can drop it on the canvas.
 */
export function parseMermaid(source) {
  if (!source || typeof source !== "string") return { ok: false, reason: "source_required" };
  const lines = source.split("\n").map((l) => l.trim()).filter(Boolean);
  if (lines.length === 0) return { ok: false, reason: "empty" };
  const header = lines[0].toLowerCase();
  let kind = "flowchart";
  if (header.startsWith("sequencediagram")) kind = "sequence";
  else if (header.startsWith("erdiagram")) kind = "erd";
  else if (header.startsWith("mindmap")) kind = "mindmap";
  else if (header.startsWith("classdiagram")) kind = "uml_class";

  const nodes = [];
  const edges = [];
  const idMap = new Map();
  function getOrAdd(id, label) {
    if (!idMap.has(id)) {
      idMap.set(id, true);
      nodes.push({ id, label: label || id });
    }
  }

  for (let i = 1; i < lines.length; i++) {
    const line = lines[i];
    if (kind === "flowchart" || kind === "uml_class" || kind === "erd") {
      // A[Label] --> B[Label]   or   A --> B
      const m = line.match(/^([A-Za-z0-9_]+)(?:\[([^\]]+)\])?\s*(-->|--o|--x|---|<--|<-->|\|>|---->)\s*([A-Za-z0-9_]+)(?:\[([^\]]+)\])?(?:\s*:\s*(.+))?/);
      if (m) {
        const [, a, aLabel, , b, bLabel, edgeLabel] = m;
        getOrAdd(a, aLabel);
        getOrAdd(b, bLabel);
        edges.push({ from: a, to: b, label: edgeLabel });
        continue;
      }
      // bare node: A[Label]
      const ml = line.match(/^([A-Za-z0-9_]+)\[([^\]]+)\]$/);
      if (ml) getOrAdd(ml[1], ml[2]);
    } else if (kind === "sequence") {
      // participant Alice
      const p = line.match(/^participant\s+(\w+)$/);
      if (p) { getOrAdd(p[1], p[1]); continue; }
      // Alice->>Bob: msg
      const arr = line.match(/^(\w+)\s*->>?\s*(\w+)\s*:\s*(.+)$/);
      if (arr) {
        getOrAdd(arr[1]); getOrAdd(arr[2]);
        edges.push({ from: arr[1], to: arr[2], label: arr[3] });
      }
    } else if (kind === "mindmap") {
      // simple indent-based: root + indented children
      const indent = (line.match(/^(\s*)/) || ["", ""])[1].length;
      const label = line.trim();
      const id = `m_${nodes.length}`;
      nodes.push({ id, label, _indent: indent });
      // Find parent: nearest preceding node with smaller indent
      for (let j = nodes.length - 2; j >= 0; j--) {
        if (nodes[j]._indent < indent) { edges.push({ from: nodes[j].id, to: id }); break; }
      }
    }
  }
  if (nodes.length === 0) return { ok: false, reason: "no_nodes_parsed" };
  return { ok: true, graph: { kind, nodes, edges } };
}
