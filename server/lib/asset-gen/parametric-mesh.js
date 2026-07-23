// server/lib/asset-gen/parametric-mesh.js
//
// Program C, Stage 2 — parametric mesh generation. A loft/profile-sweep
// builder: cross-section "rings" are placed along a straight centerline and
// adjacent rings are knit into triangles, producing a closed (watertight)
// solid. Output shape is exactly what
// server/lib/evo-asset/glb-bridge.js#packGLB consumes:
//   { positions: Float32Array, indices: Uint32Array, normals?: Float32Array }
//
// Pure, deterministic, no RNG, no three.js dependency (plain typed arrays +
// hand-rolled ring-knitting — there is no built-in three.js primitive for
// variable-width lofting, so a custom builder is the correct approach).
//
// Centerline convention: length runs along +X. Cross-sections live in the
// Y-Z plane (Y = "width", Z = "thickness"). This is an authored convention
// for this module, not a physical law — callers/consumers can transform as
// needed.
//
// Winding: every triangle is wound so a face's (b-a)×(c-a) normal points
// OUTWARD from the solid (CCW as seen from outside), verified two ways in
// server/tests/parametric-mesh.test.js: (a) the directed-edge invariant of a
// consistently-oriented closed 2-manifold — every directed edge (a,b)
// appears exactly once, and its reverse (b,a) appears exactly once on the
// neighboring triangle — and (b) known-primitive analytic volumes (unit box,
// cylinder, cone, rhombus-based "diamond cone") computed via the exact same
// signed-tetrahedron-sum formula used in mass-properties.js.

import { momentOfInertia } from "../compute/physics-compute.js";

// ── Cross-section profiles ──────────────────────────────────────────────
// Unit-scale 2D points (Y,Z) around the origin, CCW as seen looking down the
// -X axis from +X. Station-level halfWidth/halfThickness scale these.
function profilePoints(shape, sides) {
  switch (shape) {
    case "rect":
      // Flat rectangular cross-section (e.g. a crossguard bar).
      return [[-1, -1], [1, -1], [1, 1], [-1, 1]];
    case "diamond":
      // Lenticular/diamond cross-section (a common real bladed-weapon
      // section for rigidity) — 4 points on the width/thickness axes.
      return [[0, -1], [1, 0], [0, 1], [-1, 0]];
    case "circle": {
      // Regular N-gon approximating a circle (grip/pommel).
      const n = sides || 8;
      if (!Number.isInteger(n) || n < 3) {
        throw new Error(`parametric_mesh_bad_sides: sides must be an integer >= 3, got ${sides}`);
      }
      const pts = [];
      for (let i = 0; i < n; i++) {
        const theta = (i / n) * Math.PI * 2;
        pts.push([Math.cos(theta), Math.sin(theta)]);
      }
      return pts;
    }
    default:
      throw new Error(`parametric_mesh_bad_shape: unknown profile shape "${shape}"`);
  }
}

/**
 * Loft a single closed tube: a sequence of cross-section stations knit into
 * triangles, with the two ends either flat-capped (fan triangulation) or
 * collapsed to a single apex vertex ("point" — e.g. a blade tip).
 *
 * @param {"rect"|"diamond"|"circle"} shape
 * @param {Array<{x:number, halfWidth:number, halfThickness:number}>} stations
 *   Must have length >= 2. Ordered by increasing x (not enforced, but the
 *   caller owns centerline monotonicity).
 * @param {object} [opts]
 * @param {number} [opts.sides=8] polygon sides when shape === "circle"
 * @param {boolean} [opts.capStart=true] flat-cap the first station (ignored if pointStart)
 * @param {boolean} [opts.capEnd=true] flat-cap the last station (ignored if pointEnd)
 * @param {boolean} [opts.pointStart=false] collapse the first station to a single apex vertex
 * @param {boolean} [opts.pointEnd=false] collapse the last station to a single apex vertex
 * @returns {{positions:Float32Array, indices:Uint32Array, vertsPerRing:number}}
 */
export function loftClosedTube(shape, stations, opts = {}) {
  const { sides = 8, capStart = true, capEnd = true, pointStart = false, pointEnd = false } = opts;
  if (!Array.isArray(stations) || stations.length < 2) {
    throw new Error("parametric_mesh_bad_stations: need at least 2 stations");
  }
  for (const st of stations) {
    if (!Number.isFinite(st.x) || !Number.isFinite(st.halfWidth) || !Number.isFinite(st.halfThickness)) {
      throw new Error("parametric_mesh_bad_station: x/halfWidth/halfThickness must be finite numbers");
    }
    if (st.halfWidth < 0 || st.halfThickness < 0) {
      throw new Error("parametric_mesh_bad_station: halfWidth/halfThickness must be >= 0");
    }
  }

  const profile = profilePoints(shape, sides);
  const n = profile.length;
  const positions = [];
  const ringStartIndex = [];

  for (let s = 0; s < stations.length; s++) {
    const st = stations[s];
    const isPointStation = (s === 0 && pointStart) || (s === stations.length - 1 && pointEnd);
    ringStartIndex.push(positions.length / 3);
    if (isPointStation) {
      positions.push(st.x, 0, 0);
    } else {
      for (let k = 0; k < n; k++) {
        const [py, pz] = profile[k];
        positions.push(st.x, py * st.halfWidth, pz * st.halfThickness);
      }
    }
  }

  const indices = [];
  for (let s = 0; s < stations.length - 1; s++) {
    const aIsPoint = s === 0 && pointStart;
    const bIsPoint = s + 1 === stations.length - 1 && pointEnd;
    const aStart = ringStartIndex[s];
    const bStart = ringStartIndex[s + 1];
    if (!aIsPoint && !bIsPoint) {
      // Quad strip between two full rings — verified outward winding:
      // (a0,b1,b0) + (a0,a1,b1).
      for (let k = 0; k < n; k++) {
        const k2 = (k + 1) % n;
        const a0 = aStart + k, a1 = aStart + k2, b0 = bStart + k, b1 = bStart + k2;
        indices.push(a0, b1, b0, a0, a1, b1);
      }
    } else if (bIsPoint) {
      // Fan from ring `a` up to the apex at `b`.
      const apex = bStart;
      for (let k = 0; k < n; k++) {
        const k2 = (k + 1) % n;
        indices.push(aStart + k, aStart + k2, apex);
      }
    } else if (aIsPoint) {
      // Fan from the apex at `a` down to ring `b`.
      const apex = aStart;
      for (let k = 0; k < n; k++) {
        const k2 = (k + 1) % n;
        indices.push(apex, bStart + k2, bStart + k);
      }
    }
  }

  if (capStart && !pointStart) {
    const start = ringStartIndex[0];
    for (let k = 1; k < n - 1; k++) indices.push(start, start + k + 1, start + k);
  }
  if (capEnd && !pointEnd) {
    const end = ringStartIndex[ringStartIndex.length - 1];
    for (let k = 1; k < n - 1; k++) indices.push(end, end + k, end + k + 1);
  }

  return { positions: Float32Array.from(positions), indices: Uint32Array.from(indices), vertsPerRing: n };
}

/** Merge several {positions,indices} meshes into one, offsetting indices. Pure. */
export function mergeMeshes(parts) {
  let vertOffset = 0;
  const positions = [];
  const indices = [];
  for (const p of parts) {
    for (const v of p.positions) positions.push(v);
    for (const i of p.indices) indices.push(i + vertOffset);
    vertOffset += p.positions.length / 3;
  }
  return { positions: Float32Array.from(positions), indices: Uint32Array.from(indices) };
}

// Default absolute position-match tolerance (meters) for weldCoincidentVertices.
// Small enough to never merge genuinely distinct features at real sword scale
// (mm-to-tens-of-cm), large enough to absorb Float32 round-trip error on
// vertices produced by identical arithmetic.
export const WELD_EPSILON_M = 1e-6;

/**
 * Weld coincident vertices in a merged mesh. Any two vertices whose (x,y,z)
 * position is within `eps` of each other are unioned into a single vertex
 * (the lower-index survivor becomes the canonical representative); triangle
 * indices are remapped to the canonical vertices. Two kinds of now-redundant
 * triangles are then dropped: (1) a triangle that repeats a vertex after
 * remap (self-intersecting/zero-area), and (2) a pair of triangles that
 * reference the exact same 3 canonical vertices with opposite winding —
 * this is what an abutting section's two independent, oppositely-facing
 * interior end caps look like once their shared ring has been welded to the
 * same vertices; the pair contributes equal-and-opposite signed volume and
 * represents no real exterior surface, so both are removed. Unreferenced
 * vertices are then compacted out.
 *
 * O(n^2) vertex comparison — deliberately not a spatial hash: asset-gen
 * meshes here are tens to low hundreds of vertices, not a real-time budget,
 * and O(n^2) is simpler to keep exactly correct at an eps boundary (no
 * quantization-cell edge cases to reason about).
 *
 * Two modes:
 *  - **Auto** (default, no `opts.seams`): scans every vertex pair mesh-wide.
 *    Vertices with no coincident partner are left untouched — a safe,
 *    non-destructive no-op wherever a mesh has no genuine coincident
 *    geometry. (See generateSwordMesh's HONESTY_NOTES: its hilt→guard and
 *    guard→blade junctions do NOT actually share vertex positions — circle
 *    → rect → diamond are different profile shapes at different scales —
 *    so this pass correctly welds nothing there today; the pass exists as a
 *    general-purpose safety net for meshes whose sections genuinely do
 *    share a boundary ring.)
 *  - **Seam-checked** (`opts.seams`): an array of
 *    `{ a: {start, count}, b: {start, count} }` descriptors where the
 *    CALLER asserts vertex `a.start + k` should coincide 1:1, in order,
 *    with vertex `b.start + k` for every `k < count`. A declared seam that
 *    doesn't actually satisfy that (mismatched counts, or any pair beyond
 *    `eps`) is a real modeling inconsistency — this throws a NAMED error
 *    (`parametric_mesh_seam_mismatch`) rather than silently leaving an
 *    un-welded (or wrongly welded) seam.
 *
 * @param {{positions:Float32Array|number[], indices:Uint32Array|number[]}} mesh
 * @param {number} [eps=WELD_EPSILON_M] absolute position-match tolerance (meters)
 * @param {object} [opts]
 * @param {Array<{a:{start:number,count:number}, b:{start:number,count:number}}>} [opts.seams]
 * @returns {{positions:Float32Array, indices:Uint32Array, weldedVertexCount:number, droppedTriangleCount:number}}
 */
export function weldCoincidentVertices(mesh, eps = WELD_EPSILON_M, opts = {}) {
  const { seams } = opts;
  const positions = Array.from(mesh.positions);
  const indices = Array.from(mesh.indices);
  const vertCount = positions.length / 3;

  const dist = (i, j) => {
    const dx = positions[i * 3] - positions[j * 3];
    const dy = positions[i * 3 + 1] - positions[j * 3 + 1];
    const dz = positions[i * 3 + 2] - positions[j * 3 + 2];
    return Math.sqrt(dx * dx + dy * dy + dz * dz);
  };

  if (Array.isArray(seams)) {
    for (const seam of seams) {
      const { a, b } = seam || {};
      if (!a || !b || !Number.isInteger(a.count) || a.count !== b.count) {
        throw new Error(
          `parametric_mesh_seam_mismatch: declared seam ring vertex counts differ (a=${a?.count}, b=${b?.count}) — these rings cannot be welded`,
        );
      }
      for (let k = 0; k < a.count; k++) {
        const ai = a.start + k;
        const bi = b.start + k;
        const d = dist(ai, bi);
        if (d > eps) {
          throw new Error(
            `parametric_mesh_seam_mismatch: seam vertex ${k} positions differ by ${d} (> eps ${eps}) — declared seam rings do not actually coincide`,
          );
        }
      }
    }
  }

  // Auto-weld: union every vertex with the first earlier vertex it
  // coincides with (one-level union — canonical[j] is always already a
  // self-canonical root at the moment it's chosen, so no path compression
  // is needed).
  const canonical = new Int32Array(vertCount);
  for (let i = 0; i < vertCount; i++) {
    canonical[i] = i;
    for (let j = 0; j < i; j++) {
      if (canonical[j] === j && dist(i, j) <= eps) {
        canonical[i] = j;
        break;
      }
    }
  }

  let droppedTriangleCount = 0;
  const survivingTris = [];
  for (let t = 0; t < indices.length; t += 3) {
    const a = canonical[indices[t]];
    const b = canonical[indices[t + 1]];
    const c = canonical[indices[t + 2]];
    if (a === b || b === c || a === c) {
      // A literal degenerate/self-intersecting triangle (repeats a vertex
      // after remap) — zero area, drop outright.
      droppedTriangleCount++;
      continue;
    }
    survivingTris.push([a, b, c]);
  }

  // Cancel exact mirror-pairs: once a shared ring is welded, an abutting
  // section's interior end cap and the next section's interior start cap
  // reference the SAME 3 (canonical) vertices but with opposite winding
  // (they face each other — see HONESTY_NOTES). Each such pair contributes
  // equal-and-opposite signed volume (swapping two vertices of a triple
  // negates the scalar triple product), so together they represent no real
  // exterior surface and both are dropped. This is a distinct condition
  // from the self-intersecting case above (three DIFFERENT triangles, not
  // one triangle repeating a vertex).
  const bySortedKey = new Map();
  for (let i = 0; i < survivingTris.length; i++) {
    const [a, b, c] = survivingTris[i];
    const arr = [a, b, c];
    let sign = 1;
    // Bubble-sort 3 elements while tracking permutation parity — safe
    // because a, b, c are already known-distinct (degenerate case handled
    // above), so parity is well-defined.
    for (let x = 0; x < 3; x++) {
      for (let y = 0; y < 2 - x; y++) {
        if (arr[y] > arr[y + 1]) {
          const tmp = arr[y]; arr[y] = arr[y + 1]; arr[y + 1] = tmp;
          sign = -sign;
        }
      }
    }
    const key = arr.join(",");
    if (!bySortedKey.has(key)) bySortedKey.set(key, []);
    bySortedKey.get(key).push({ i, sign });
  }
  const isCancelled = new Uint8Array(survivingTris.length);
  for (const entries of bySortedKey.values()) {
    const pos = entries.filter((e) => e.sign > 0);
    const neg = entries.filter((e) => e.sign < 0);
    const pairCount = Math.min(pos.length, neg.length);
    for (let k = 0; k < pairCount; k++) {
      isCancelled[pos[k].i] = 1;
      isCancelled[neg[k].i] = 1;
      droppedTriangleCount += 2;
    }
  }

  const newIndices = [];
  for (let i = 0; i < survivingTris.length; i++) {
    if (!isCancelled[i]) newIndices.push(...survivingTris[i]);
  }

  // Compact: keep only self-canonical (root) vertices, remap indices into
  // the new, tighter index space.
  const remap = new Int32Array(vertCount).fill(-1);
  const newPositions = [];
  let next = 0;
  for (let i = 0; i < vertCount; i++) {
    if (canonical[i] === i) {
      remap[i] = next++;
      newPositions.push(positions[i * 3], positions[i * 3 + 1], positions[i * 3 + 2]);
    }
  }
  const finalIndices = newIndices.map((v) => remap[v]);

  return {
    positions: Float32Array.from(newPositions),
    indices: Uint32Array.from(finalIndices),
    weldedVertexCount: vertCount - next,
    droppedTriangleCount,
  };
}

// ── Cross-section area + moment-of-inertia (for the beam co-product) ───────
// Area is always computed exactly from the profile geometry (plain
// geometry, no physics-library dependency). Moment of inertia REUSES
// server/lib/compute/physics-compute.js#momentOfInertia's rectangle/circle
// formulas per CLAUDE.md's compute-don't-guess doctrine — it is never
// reimplemented here.
//
// Honesty note: physics-compute.js has no "rhombus"/"diamond" shape. For a
// diamond cross-section we report I using the RECTANGLE formula over the
// same full width/thickness (a bounding-box approximation), NOT the true
// rhombus formula (I_true = width·thickness³/48 vs the rectangle's
// width·thickness³/12 — the rectangle approximation over-states stiffness
// ~4×). This is flagged in the returned station via `approximation` so a
// Stage-4 FEA consumer can decide whether to correct for it.
function crossSectionProps(shape, halfWidth, halfThickness) {
  const width = 2 * halfWidth;
  const thickness = 2 * halfThickness;
  if (shape === "circle") {
    // halfWidth === halfThickness === radius by construction for circle stations.
    const radius = halfWidth;
    const area = Math.PI * radius * radius;
    const moi = momentOfInertia("circle", { radius });
    return { area, momentOfInertia: moi.value ?? 0, approximation: false };
  }
  if (shape === "rect") {
    const area = width * thickness;
    const moi = momentOfInertia("rectangle", { base: width, height: thickness });
    return { area, momentOfInertia: moi.value ?? 0, approximation: false };
  }
  if (shape === "diamond") {
    // Exact rhombus area (diagonals width × thickness).
    const area = (width * thickness) / 2;
    // Approximate: bounding-box rectangle formula (see doc-comment above).
    const moi = momentOfInertia("rectangle", { base: width, height: thickness });
    return { area, momentOfInertia: moi.value ?? 0, approximation: true };
  }
  throw new Error(`parametric_mesh_bad_shape: unknown profile shape "${shape}"`);
}

// ── Archetype 1: bladed weapon (sword) ──────────────────────────────────────
const SWORD_DEFAULTS = {
  bladeLength: 0.75,
  bladeBaseWidth: 0.045,
  bladeBaseThickness: 0.006,
  bladeSegments: 10,
  guardWidth: 0.12,
  guardThickness: 0.018,
  guardLength: 0.02,
  hiltLength: 0.11,
  hiltRadius: 0.013,
  pommelRadius: 0.022,
  pommelLength: 0.025,
  hiltSides: 8,
};

function assertPositive(name, v) {
  if (!Number.isFinite(v) || v <= 0) {
    throw new Error(`parametric_mesh_bad_param: ${name} must be a positive finite number, got ${v}`);
  }
}

/**
 * Generate a deterministic bladed-weapon (sword) mesh: pommel + grip (a
 * tapered circular tube) → guard (a rectangular crossbar block) → blade (a
 * diamond-section taper converging to a point tip). Three appended,
 * individually-closed lofted sections, run through a `weldCoincidentVertices`
 * pass at the merge step — see the module-level honesty note in the
 * exported `HONESTY_NOTES` below re: what that pass does (and, verified,
 * does not do) for this specific geometry.
 *
 * Same params → byte-identical arrays (pure function, no RNG, no Date.now).
 *
 * @param {object} [params] see SWORD_DEFAULTS for the full parameter set + units (meters)
 * @returns {{
 *   positions: Float32Array, indices: Uint32Array, normals: Float32Array,
 *   beam: { stations: Array<{s:number, area:number, momentOfInertia:number, approximation:boolean}> },
 *   meta: { totalLength:number, sectionVertexCounts:number[], sectionTriangleCounts:number[] },
 *   weld: { weldedVertexCount:number, droppedTriangleCount:number }
 * }}
 */
export function generateSwordMesh(params = {}) {
  const p = { ...SWORD_DEFAULTS, ...params };
  for (const k of [
    "bladeLength", "bladeBaseWidth", "bladeBaseThickness", "guardWidth",
    "guardThickness", "guardLength", "hiltLength", "hiltRadius",
    "pommelRadius", "pommelLength",
  ]) assertPositive(k, p[k]);
  if (!Number.isInteger(p.bladeSegments) || p.bladeSegments < 1) {
    throw new Error(`parametric_mesh_bad_param: bladeSegments must be a positive integer, got ${p.bladeSegments}`);
  }
  if (!Number.isInteger(p.hiltSides) || p.hiltSides < 3) {
    throw new Error(`parametric_mesh_bad_param: hiltSides must be an integer >= 3, got ${p.hiltSides}`);
  }

  // ── Section 1: pommel + grip (circle profile tapered tube) ──────────────
  const xPommel = 0;
  const xGripStart = xPommel + p.pommelLength;
  const xGripEnd = xGripStart + p.hiltLength;
  const hiltStations = [
    { x: xPommel, halfWidth: p.pommelRadius, halfThickness: p.pommelRadius },
    { x: xGripStart, halfWidth: p.hiltRadius, halfThickness: p.hiltRadius },
    { x: xGripEnd, halfWidth: p.hiltRadius, halfThickness: p.hiltRadius },
  ];
  const hiltMesh = loftClosedTube("circle", hiltStations, { sides: p.hiltSides, capStart: true, capEnd: true });

  // ── Section 2: guard (rect profile, constant cross-section block) ──────
  const xGuardStart = xGripEnd;
  const xGuardEnd = xGuardStart + p.guardLength;
  const guardStations = [
    { x: xGuardStart, halfWidth: p.guardWidth / 2, halfThickness: p.guardThickness / 2 },
    { x: xGuardEnd, halfWidth: p.guardWidth / 2, halfThickness: p.guardThickness / 2 },
  ];
  const guardMesh = loftClosedTube("rect", guardStations, { capStart: true, capEnd: true });

  // ── Section 3: blade (diamond profile, linear taper to a point tip) ────
  const xBladeStart = xGuardEnd;
  const bladeStations = [];
  for (let i = 0; i <= p.bladeSegments; i++) {
    const t = i / p.bladeSegments;
    bladeStations.push({
      x: xBladeStart + t * p.bladeLength,
      halfWidth: (p.bladeBaseWidth / 2) * (1 - t),
      halfThickness: (p.bladeBaseThickness / 2) * (1 - t),
    });
  }
  const bladeMesh = loftClosedTube("diamond", bladeStations, { capStart: true, capEnd: false, pointEnd: true });

  const merged = mergeMeshes([hiltMesh, guardMesh, bladeMesh]);

  // ── Weld pass over the merged solid (see weldCoincidentVertices' doc
  // comment + this file's HONESTY_NOTES) ──────────────────────────────────
  // Verified empirically (server/tests/parametric-mesh.test.js): the
  // hilt→guard and guard→blade junctions do NOT actually share coincident
  // vertex positions — circle (hilt, radius hiltRadius) → rect (guard,
  // half-width/thickness guardWidth/2, guardThickness/2) → diamond (blade)
  // are different profile shapes at different scales at each transition, by
  // deliberate design (a sword's grip is narrower than its guard). This
  // auto-weld pass is therefore a correct, verified NO-OP for the current
  // SWORD_DEFAULTS-shaped geometry (0 vertices welded, 0 triangles dropped)
  // — it's applied here as a general-purpose safety net so any future
  // archetype/parameter combination whose sections genuinely DO share a
  // boundary ring gets welded automatically, without silently leaving a
  // seam. It never fabricates a weld: no `seams` are declared here (since
  // none actually match), so it can't throw for this call.
  const welded = weldCoincidentVertices(merged);

  // ── Beam abstraction co-product (Stage 4 input) ─────────────────────────
  const totalLength = xBladeStart + p.bladeLength;
  const beamStations = [];
  for (const st of hiltStations) {
    const props = crossSectionProps("circle", st.halfWidth, st.halfThickness);
    beamStations.push({ s: st.x / totalLength, ...props });
  }
  for (const st of guardStations) {
    const props = crossSectionProps("rect", st.halfWidth, st.halfThickness);
    beamStations.push({ s: st.x / totalLength, ...props });
  }
  for (const st of bladeStations) {
    const props = crossSectionProps("diamond", st.halfWidth, st.halfThickness);
    beamStations.push({ s: st.x / totalLength, ...props });
  }

  return {
    positions: welded.positions,
    indices: welded.indices,
    // normals computed by the caller (or via glb-bridge's
    // computeVertexNormals) to keep this module free of the GLB bridge
    // dependency direction — see generateSwordMeshWithNormals below for the
    // convenience wrapper that does import it.
    beam: { stations: beamStations },
    meta: {
      totalLength,
      // Section counts are PRE-weld (as emitted by each independent
      // loftClosedTube call, unaffected by the weld pass — see `weld` below
      // for the post-weld delta actually applied to positions/indices).
      sectionVertexCounts: [hiltMesh.positions.length / 3, guardMesh.positions.length / 3, bladeMesh.positions.length / 3],
      sectionTriangleCounts: [hiltMesh.indices.length / 3, guardMesh.indices.length / 3, bladeMesh.indices.length / 3],
    },
    weld: {
      weldedVertexCount: welded.weldedVertexCount,
      droppedTriangleCount: welded.droppedTriangleCount,
    },
  };
}

/**
 * Convenience wrapper: generateSwordMesh + area-weighted smooth normals via
 * glb-bridge's computeVertexNormals (imported, read-only — glb-bridge.js
 * itself is not modified). Returns the exact shape packGLB expects.
 */
export async function generateSwordMeshWithNormals(params = {}) {
  const { computeVertexNormals } = await import("../evo-asset/glb-bridge.js");
  const mesh = generateSwordMesh(params);
  const normals = computeVertexNormals(mesh.positions, mesh.indices);
  return { ...mesh, normals };
}

// Honesty notes (read before treating this as a single seamless solid):
//
// 1. A WELD PASS RUNS, BUT THE SWORD'S ACTUAL SEAMS DON'T COINCIDE (verified
//    numerically — see server/tests/parametric-mesh.test.js). The
//    hilt/guard/blade sections are each independently closed, watertight,
//    correctly-wound 2-manifolds (proven by the directed-edge invariant +
//    analytic-volume tests) and are concatenated end-to-end at matching
//    x-planes via `weldCoincidentVertices`. That pass genuinely welds
//    coincident vertices where they exist — but for THIS archetype's
//    default and any real-world-shaped parameters, the hilt→guard junction
//    is a circle ring (radius hiltRadius) meeting a rect ring (half-width
//    guardWidth/2, half-thickness guardThickness/2), and the guard→blade
//    junction is a rect ring meeting a diamond ring: different profile
//    shapes at different scales at BOTH junctions, by deliberate design (a
//    sword's grip is narrower than its crossguard, and the crossguard is a
//    flat bar while the blade is a lenticular taper). No vertex on either
//    side of either junction is within the weld epsilon of any vertex on
//    the other side, so the pass correctly welds 0 vertices / drops 0
//    triangles here — a verified no-op, not a broken weld. Each section
//    keeps its own independent end cap at the two junctions, so there
//    remain two distinct (non-overlapping-vertex, partially-overlapping-in-
//    footprint) cap surfaces there rather than one continuous outer hull.
//    This is harmless for volume/mass (each closed sub-solid still
//    contributes its own correct signed volume — see mass-properties.js)
//    and the merged whole still satisfies the closed-2-manifold
//    directed-edge invariant (each disjoint closed sub-solid trivially
//    does), but a render pass could still show partial z-fighting in the
//    footprint area where two differently-shaped caps at the same x-plane
//    overlap. Fully resolving that would require a true boolean/CSG union
//    between mismatched cross-sections (out of scope — see
//    `weldCoincidentVertices`'s doc-comment for why that's not warranted
//    here), or Stage 4 FEA consuming the `beam.stations` co-product
//    directly instead of the raw triangle soup at the joints (which it
//    already does — see fea-gate.js).
// 2. The diamond blade's `momentOfInertia` in `beam.stations` is a
//    RECTANGLE-formula approximation of a true rhombus section (see
//    crossSectionProps' doc-comment) — it over-states bending stiffness by
//    roughly 4× relative to the exact rhombus formula, which is not
//    reused here because physics-compute.js has no rhombus/diamond shape.
export const HONESTY_NOTES = Object.freeze({
  weldPassApplied: true,
  swordJunctionsShareNoCoincidentVertices: true,
  diamondMomentOfInertiaIsRectangleApproximation: true,
});
