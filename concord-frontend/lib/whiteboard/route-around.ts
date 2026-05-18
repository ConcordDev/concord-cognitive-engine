// concord-frontend/lib/whiteboard/route-around.ts
//
// Whiteboard Sprint B Item #13 — smart connector auto-routing.
//
// Orthogonal routing with obstacle avoidance via A* on a coarse grid.
// Produces a polyline that connects two anchor points while avoiding
// the rectangles of all other elements. When no path is found (rare),
// falls back to a straight diagonal — UX never breaks.
//
// Pure JS, no deps. Tested in tests/lib/whiteboard/route-around.test.ts.

export interface RoutingObstacle { x: number; y: number; width: number; height: number }
export interface RoutingAnchor   { x: number; y: number }
export interface RoutingResult   { points: Array<{ x: number; y: number }>; routed: boolean }

const DEFAULT_CELL = 20;
const PAD = 10;

interface Cell { r: number; c: number }
interface CellWithCost extends Cell { f: number; g: number; from: Cell | null }

/**
 * Route an orthogonal connector from `from` to `to` while avoiding
 * the given obstacles. Returns the polyline points (start, corner(s),
 * end). When the A* fails, returns a straight diagonal and
 * `routed: false`.
 */
export function routeAround(
  from: RoutingAnchor,
  to: RoutingAnchor,
  obstacles: RoutingObstacle[] = [],
  opts: { cellSize?: number; maxIter?: number } = {},
): RoutingResult {
  const cell = Math.max(4, opts.cellSize ?? DEFAULT_CELL);
  const maxIter = Math.max(100, opts.maxIter ?? 20_000);
  // Build a bounding box that contains both anchors + all obstacles.
  let minX = Math.min(from.x, to.x), minY = Math.min(from.y, to.y);
  let maxX = Math.max(from.x, to.x), maxY = Math.max(from.y, to.y);
  for (const o of obstacles) {
    minX = Math.min(minX, o.x - PAD); minY = Math.min(minY, o.y - PAD);
    maxX = Math.max(maxX, o.x + o.width + PAD); maxY = Math.max(maxY, o.y + o.height + PAD);
  }
  minX -= cell * 2; minY -= cell * 2; maxX += cell * 2; maxY += cell * 2;
  const rows = Math.ceil((maxY - minY) / cell);
  const cols = Math.ceil((maxX - minX) / cell);
  if (rows <= 0 || cols <= 0) return { points: [from, to], routed: false };

  const blocked = new Uint8Array(rows * cols);
  for (const o of obstacles) {
    const c0 = Math.max(0, Math.floor((o.x - PAD - minX) / cell));
    const r0 = Math.max(0, Math.floor((o.y - PAD - minY) / cell));
    const c1 = Math.min(cols - 1, Math.floor((o.x + o.width + PAD - minX) / cell));
    const r1 = Math.min(rows - 1, Math.floor((o.y + o.height + PAD - minY) / cell));
    for (let r = r0; r <= r1; r++)
      for (let c = c0; c <= c1; c++) blocked[r * cols + c] = 1;
  }
  const start: Cell = { c: Math.floor((from.x - minX) / cell), r: Math.floor((from.y - minY) / cell) };
  const goal: Cell  = { c: Math.floor((to.x - minX) / cell),   r: Math.floor((to.y - minY) / cell) };
  // Allow start/goal even if they fell inside an obstacle padding.
  blocked[start.r * cols + start.c] = 0;
  blocked[goal.r * cols + goal.c] = 0;

  const open: CellWithCost[] = [{ ...start, f: heur(start, goal), g: 0, from: null }];
  const visited = new Uint8Array(rows * cols);
  const cameFrom = new Map<number, Cell>();
  const gscore = new Map<number, number>();
  gscore.set(start.r * cols + start.c, 0);
  let iter = 0;
  while (open.length > 0 && iter++ < maxIter) {
    // Pop lowest-f (simple linear; fine for grids we expect).
    let bestI = 0;
    for (let i = 1; i < open.length; i++) if (open[i].f < open[bestI].f) bestI = i;
    const cur = open.splice(bestI, 1)[0];
    const key = cur.r * cols + cur.c;
    if (visited[key]) continue;
    visited[key] = 1;
    if (cur.r === goal.r && cur.c === goal.c) {
      const path = _reconstruct(cur, cameFrom, cols);
      return { points: _pathToWorld(path, minX, minY, cell, from, to), routed: true };
    }
    const neighbours: Array<[number, number]> = [
      [cur.r - 1, cur.c], [cur.r + 1, cur.c], [cur.r, cur.c - 1], [cur.r, cur.c + 1],
    ];
    for (const [nr, nc] of neighbours) {
      if (nr < 0 || nc < 0 || nr >= rows || nc >= cols) continue;
      const nk = nr * cols + nc;
      if (visited[nk]) continue;
      if (blocked[nk]) continue;
      // Penalise turns slightly — keeps routes orthogonal-ish.
      const turn = cur.from && (cur.from.r === cur.r ? (nr !== cur.r) : (nc !== cur.c)) ? 0.5 : 0;
      const tentative = (cur.g || 0) + 1 + turn;
      const existing = gscore.get(nk);
      if (existing != null && tentative >= existing) continue;
      gscore.set(nk, tentative);
      cameFrom.set(nk, cur);
      open.push({ r: nr, c: nc, g: tentative, f: tentative + heur({ r: nr, c: nc }, goal), from: cur });
    }
  }
  // Failed — straight line.
  return { points: [from, to], routed: false };
}

function heur(a: Cell, b: Cell) {
  return Math.abs(a.r - b.r) + Math.abs(a.c - b.c);
}

function _reconstruct(end: Cell, cameFrom: Map<number, Cell>, cols: number): Cell[] {
  const out: Cell[] = [end];
  let cur = end;
  while (true) {
    const k = cur.r * cols + cur.c;
    const prev = cameFrom.get(k);
    if (!prev) break;
    out.push(prev);
    cur = prev;
  }
  return out.reverse();
}

function _pathToWorld(path: Cell[], minX: number, minY: number, cell: number, from: RoutingAnchor, to: RoutingAnchor) {
  // Convert grid cells to world coords (centre of cell), then collapse
  // collinear runs into corner points only.
  const raw = path.map((p) => ({ x: minX + p.c * cell + cell / 2, y: minY + p.r * cell + cell / 2 }));
  raw[0] = from;
  raw[raw.length - 1] = to;
  const collapsed: Array<{ x: number; y: number }> = [raw[0]];
  for (let i = 1; i < raw.length - 1; i++) {
    const prev = collapsed[collapsed.length - 1];
    const next = raw[i + 1];
    const colinearH = prev.y === raw[i].y && raw[i].y === next.y;
    const colinearV = prev.x === raw[i].x && raw[i].x === next.x;
    if (!colinearH && !colinearV) collapsed.push(raw[i]);
  }
  collapsed.push(raw[raw.length - 1]);
  return collapsed;
}
