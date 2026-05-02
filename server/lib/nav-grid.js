// server/lib/nav-grid.js
// Grid-based A* pathfinder for NPC navigation.
// Built from the same heightmap data TerrainRenderer uses on the client.
// NPCs call findPath() to get a list of world-space waypoints; they walk
// between them one step per tick instead of teleporting.

const MAX_SLOPE_RAD     = Math.PI / 4;  // 45° — steeper = impassable
const WATER_HEIGHT_NORM = 0.03;         // anything below 3% norm height = water = blocked
const DIAGONAL_COST     = 1.414;

class NavGrid {
  /**
   * @param {Float32Array} hmData  – normalized heights (0..1), row-major
   * @param {number}       width   – number of columns
   * @param {number}       height  – number of rows
   * @param {number}       cellSize – world metres per cell
   * @param {number}       [maxSlopeRad] – steeper cells are blocked
   */
  constructor(hmData, width, height, cellSize, maxSlopeRad = MAX_SLOPE_RAD) {
    this.hmData      = hmData;
    this.width       = width;
    this.height      = height;
    this.cellSize    = cellSize;
    this.maxSlopeRad = maxSlopeRad;
    this.passable    = null; // Uint8Array, 1 = walkable
  }

  /** Build the passability grid — call once after construction. */
  buildGrid() {
    const { hmData, width, height, maxSlopeRad } = this;
    this.passable = new Uint8Array(width * height);

    for (let z = 0; z < height; z++) {
      for (let x = 0; x < width; x++) {
        const h = hmData[z * width + x];
        if (h < WATER_HEIGHT_NORM) continue; // water — blocked

        // Check slope against right and down neighbours
        const right = x + 1 < width  ? hmData[z * width + (x + 1)] : h;
        const down  = z + 1 < height ? hmData[(z + 1) * width + x] : h;
        const slopeX = Math.atan(Math.abs(right - h) * 80 / this.cellSize); // 80 = maxElevation
        const slopeZ = Math.atan(Math.abs(down  - h) * 80 / this.cellSize);

        if (slopeX <= maxSlopeRad && slopeZ <= maxSlopeRad) {
          this.passable[z * width + x] = 1;
        }
      }
    }
  }

  /** Convert world-space (x, z) to grid cell (ix, iz). */
  worldToCell(worldX, worldZ) {
    const TERRAIN_SIZE = this.width * this.cellSize;
    const nx = (worldX + TERRAIN_SIZE / 2) / TERRAIN_SIZE;
    const nz = (worldZ + TERRAIN_SIZE / 2) / TERRAIN_SIZE;
    return {
      ix: Math.max(0, Math.min(this.width  - 1, Math.floor(nx * this.width))),
      iz: Math.max(0, Math.min(this.height - 1, Math.floor(nz * this.height))),
    };
  }

  /** Convert grid cell (ix, iz) to world-space centre of that cell. */
  cellToWorld(ix, iz) {
    const TERRAIN_SIZE = this.width * this.cellSize;
    return {
      x: (ix / this.width)  * TERRAIN_SIZE - TERRAIN_SIZE / 2 + this.cellSize / 2,
      z: (iz / this.height) * TERRAIN_SIZE - TERRAIN_SIZE / 2 + this.cellSize / 2,
    };
  }

  /**
   * A* pathfind from (startX, startZ) to (goalX, goalZ) in world space.
   * Returns array of {x, z} world-space waypoints (start excluded, goal included),
   * or [] if no path found.
   */
  findPath(startX, startZ, goalX, goalZ) {
    if (!this.passable) return [];

    const { width, height, passable } = this;
    const start = this.worldToCell(startX, startZ);
    const goal  = this.worldToCell(goalX,  goalZ);

    if (!passable[start.iz * width + start.ix]) return [];
    if (!passable[goal.iz  * width + goal.ix])  return [];

    // A* with binary-heap-style open set (simple sorted array for NPC scale)
    const DIRS = [
      [-1, 0, 1], [1, 0, 1], [0, -1, 1], [0, 1, 1],
      [-1,-1, DIAGONAL_COST], [1,-1, DIAGONAL_COST],
      [-1, 1, DIAGONAL_COST], [1, 1, DIAGONAL_COST],
    ];

    const h = (ix, iz) => Math.sqrt(
      Math.pow(ix - goal.ix, 2) + Math.pow(iz - goal.iz, 2)
    );

    const startKey = start.iz * width + start.ix;
    const goalKey  = goal.iz  * width + goal.ix;

    const gScore   = new Float32Array(width * height).fill(Infinity);
    const fScore   = new Float32Array(width * height).fill(Infinity);
    const cameFrom = new Int32Array(width * height).fill(-1);

    gScore[startKey] = 0;
    fScore[startKey] = h(start.ix, start.iz);

    const open = new Set([startKey]);

    while (open.size > 0) {
      // Find lowest fScore in open set
      let current = -1;
      let bestF   = Infinity;
      for (const k of open) {
        if (fScore[k] < bestF) { bestF = fScore[k]; current = k; }
      }

      if (current === goalKey) {
        return this._reconstructPath(cameFrom, current, width);
      }

      open.delete(current);
      const cx = current % width;
      const cz = Math.floor(current / width);

      for (const [dx, dz, cost] of DIRS) {
        const nx = cx + dx;
        const nz = cz + dz;
        if (nx < 0 || nx >= width || nz < 0 || nz >= height) continue;
        const nKey = nz * width + nx;
        if (!passable[nKey]) continue;

        // Extra slope cost for diagonal moves
        const hDiff = Math.abs(this.hmData[nKey] - this.hmData[current]) * 80;
        const tentG = gScore[current] + cost + hDiff * 0.5;

        if (tentG < gScore[nKey]) {
          cameFrom[nKey] = current;
          gScore[nKey]   = tentG;
          fScore[nKey]   = tentG + h(nx, nz);
          open.add(nKey);
        }
      }

      // Safety: bail out if open set gets huge (unreachable)
      if (open.size > 10_000) return [];
    }

    return []; // no path
  }

  _reconstructPath(cameFrom, current, width) {
    const cells = [];
    while (cameFrom[current] !== -1) {
      cells.push(current);
      current = cameFrom[current];
    }
    cells.reverse();

    // Convert to world coords
    const waypoints = cells.map(k => {
      const ix = k % width;
      const iz = Math.floor(k / width);
      return this.cellToWorld(ix, iz);
    });

    // Smooth: remove collinear waypoints (same direction)
    return this._smooth(waypoints);
  }

  _smooth(pts) {
    if (pts.length <= 2) return pts;
    const out = [pts[0]];
    for (let i = 1; i < pts.length - 1; i++) {
      const prev = out[out.length - 1];
      const curr = pts[i];
      const next = pts[i + 1];
      const d1x  = curr.x - prev.x; const d1z = curr.z - prev.z;
      const d2x  = next.x - curr.x; const d2z = next.z - curr.z;
      // Cross product — if near zero, collinear → skip
      const cross = Math.abs(d1x * d2z - d1z * d2x);
      if (cross > 0.1) out.push(curr);
    }
    out.push(pts[pts.length - 1]);
    return out;
  }
}

export { NavGrid };
