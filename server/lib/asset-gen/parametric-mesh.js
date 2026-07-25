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
export function profilePoints(shape, sides) {
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
 *    geometry. generateSwordMesh's hilt→guard and guard→blade junctions
 *    (circle → rect → diamond, different profile shapes at different
 *    scales) do NOT actually share vertex positions, so this pass correctly
 *    welds nothing there — those junctions are instead closed by
 *    `bridgeMismatchedRings` (see `loftSectionsWithBridges`), which is the
 *    right tool for two mismatched, merely-abutting rings. This pass
 *    remains a general-purpose safety net for meshes whose sections
 *    genuinely DO share a boundary ring (e.g. two abutting same-profile
 *    tubes — see the "genuine-coincidence case" tests).
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

// ── Mismatched-profile junctions (ring bridging) ────────────────────────────
//
// weldCoincidentVertices (above) correctly handles an abutting junction
// whose two rings genuinely coincide (same shape, same scale). It is a
// verified no-op when they don't — e.g. generateSwordMesh's hilt→guard
// (circle meeting rect) and guard→blade (rect meeting diamond) junctions,
// where the two independent flat end-caps a naive capStart:true/capEnd:true
// pairing would produce are NOT the same polygon, so nothing welds and the
// two caps are left overlapping/interpenetrating in the render (z-fighting),
// with a hole between the two silhouettes not actually being closed by
// either cap.
//
// The fix here is NOT a general boolean/CSG solid union — the two sections
// are coaxial and only ABUT (they share a single plane, they do not
// interpenetrate), so there is no volume overlap to resolve, and this is
// exactly the input BSP-style CSG degenerates on (coplanar faces). Instead:
// drop BOTH interior caps and connect the two rings DIRECTLY with a single
// triangle strip built ONLY from each ring's own real vertices (no new
// points are ever synthesized) — a "zipper"/bridge triangulation, the
// standard technique for lofting between mismatched-vertex-count profiles.
// This is exact (no interpolation, no float-robustness class of bug beyond
// the same eps-comparisons the rest of this module already uses), manifold
// by construction (proven below, not asserted), and composes with
// weldCoincidentVertices for the genuinely-coincident case, which is left
// completely untouched.
//
// ── Why this closes the manifold (verified via directedEdgeInvariant in
// server/tests/parametric-mesh.test.js, not just argued here) ─────────────
// Consider ring A the end of an EARLIER section (loft with capEnd:false)
// and ring B the start of a LATER section (loft with capStart:false). A's
// own lateral wall (the quad strip connecting A's ring to the ring before
// it) leaves A's ring with only its BACKWARD around-the-ring edges present
// (ring[k+1]->ring[k]); B's own lateral wall leaves B's ring with only its
// FORWARD around-the-ring edges present (ring[k]->ring[k+1]) — this is the
// same "half-open" structure a normal capEnd/capStart fan exists to close
// (a fan's own edges are shown, by direct trace, to supply exactly the
// missing direction). bridgeMismatchedRings supplies exactly the same two
// missing directions itself: FORWARD for ring A, BACKWARD for ring B — so
// together with the two sections' own lateral walls, every directed edge
// around both rings gets its reverse, with no leftover cap needed.
//
// ── Ordering to the origin ("star-shaped") is a real precondition ─────────
// The merge walks both rings by absolute polar angle (atan2 around the
// common centerline, y/z plane) — this REQUIRES each ring's own vertex
// sequence to be monotonically increasing in angle (mod 2*pi, one wrap
// allowed) around a shared center, i.e. "star-shaped from the origin". This
// holds for every profile this module emits today (rect/diamond/circle are
// all symmetric polygons built around (0,0) by profilePoints) but is NOT
// assumed silently: assertStarShapedRing throws a NAMED error
// (parametric_mesh_bridge_non_star_shaped) rather than emit a
// wrong-but-plausible-looking mesh for a future profile that violates it.
const BRIDGE_EPS_THETA = 1e-9;

function ringAngle(y, z) {
  let a = Math.atan2(z, y);
  if (a < 0) a += Math.PI * 2;
  return a;
}

function assertStarShapedRing(points, label) {
  if (!Array.isArray(points) || points.length < 3) {
    throw new Error(`parametric_mesh_bridge_bad_ring: ${label} needs at least 3 points, got ${points?.length}`);
  }
  const thetas = points.map((p) => ringAngle(p.y, p.z));
  let wraps = 0;
  for (let i = 1; i < thetas.length; i++) {
    if (thetas[i] <= thetas[i - 1]) wraps++;
  }
  // A valid CCW closed ring wraps past 2*pi exactly once (going from its
  // largest angle back toward its smallest as the index cycles) — more than
  // one non-increasing step means the ring is not star-shaped from the
  // origin (e.g. self-intersecting, or not centered there), which this
  // technique cannot correctly bridge.
  if (wraps > 1) {
    throw new Error(
      `parametric_mesh_bridge_non_star_shaped: ${label} vertex angles are not monotonic around the origin (${wraps} non-increasing steps) — cannot bridge`,
    );
  }
}

/**
 * Compute the real (x,y,z) ring points for a single station — the exact same
 * formula loftClosedTube uses internally for one ring, exposed standalone so
 * a caller can build a ring to bridge against without lofting a whole
 * (redundant) tube for it.
 *
 * @param {"rect"|"diamond"|"circle"} shape
 * @param {number} x
 * @param {number} halfWidth
 * @param {number} halfThickness
 * @param {number} [sides] only used when shape === "circle"
 * @returns {Array<{x:number,y:number,z:number}>}
 */
export function ringPointsAt(shape, x, halfWidth, halfThickness, sides) {
  return profilePoints(shape, sides).map(([py, pz]) => ({
    x, y: py * halfWidth, z: pz * halfThickness,
  }));
}

/**
 * Bridge two mismatched-profile rings sharing a junction: ringA is the
 * closing ring of the EARLIER (smaller-x) section, ringB is the opening
 * ring of the LATER (larger-x) section. Connects them with a single
 * triangle strip built entirely from their own real vertices via an
 * angle-sorted "zipper" merge (na + nb triangles for na + nb vertices,
 * ties — an angular coincidence between an A vertex and a B vertex, e.g.
 * two same-shape rings at different tessellation — merged into one quad
 * step so the genuinely-equal-ring case degenerates to an ordinary
 * loftClosedTube-style quad strip). No new vertices are ever synthesized:
 * this is why it composes with weldCoincidentVertices instead of needing
 * its own dedup pass — the ring positions it emits are byte-identical to
 * whatever ringPointsAt (or loftClosedTube's internal ring builder) already
 * produced for the two adjoining tubes, so the auto weld pass unions them.
 *
 * @param {Array<{x:number,y:number,z:number}>} ringA
 * @param {Array<{x:number,y:number,z:number}>} ringB
 * @returns {{positions:Float32Array, indices:Uint32Array}}
 */
export function bridgeMismatchedRings(ringA, ringB) {
  assertStarShapedRing(ringA, "ringA");
  assertStarShapedRing(ringB, "ringB");

  const na = ringA.length, nb = ringB.length;
  const thetaA = ringA.map((p) => ringAngle(p.y, p.z));
  const thetaB = ringB.map((p) => ringAngle(p.y, p.z));
  const bIdx = (j) => na + j;

  const positions = [];
  for (const p of ringA) positions.push(p.x, p.y, p.z);
  for (const p of ringB) positions.push(p.x, p.y, p.z);

  // Merge-sort every vertex of both rings by absolute angle.
  const events = [
    ...thetaA.map((theta, idx) => ({ src: "A", idx, theta })),
    ...thetaB.map((theta, idx) => ({ src: "B", idx, theta })),
  ].sort((p, q) => p.theta - q.theta || (p.src === q.src ? 0 : (p.src === "A" ? -1 : 1)));

  // Collapse an exact (within eps) angular tie between one A vertex and one
  // B vertex into a single combined step (see module doc-comment: this is
  // what makes the equal-ring case degenerate to a normal quad strip).
  const steps = [];
  for (const e of events) {
    const prev = steps[steps.length - 1];
    const prevTheta = Array.isArray(prev) ? prev[0].theta : prev?.theta;
    const prevSrc = Array.isArray(prev) ? prev[0].src : prev?.src;
    if (prev && prevSrc !== e.src && Math.abs(prevTheta - e.theta) < BRIDGE_EPS_THETA) {
      steps[steps.length - 1] = Array.isArray(prev) ? [...prev, e] : [prev, e];
    } else {
      steps.push(e);
    }
  }

  // Each ring's own vertex sequence is monotonic in RAW angle only from
  // whichever native index happens to sit at the smallest raw angle (a
  // profile like "rect" starts its native index 0 at 225 degrees, not 0) --
  // start the walk at that vertex's predecessor (the ring's true
  // largest-raw-angle vertex), not blindly at index n-1.
  const argmin = (arr) => {
    let mi = 0;
    for (let i = 1; i < arr.length; i++) if (arr[i] < arr[mi]) mi = i;
    return mi;
  };
  let curA = (argmin(thetaA) - 1 + na) % na;
  let curB = (argmin(thetaB) - 1 + nb) % nb;

  const indices = [];
  for (const step of steps) {
    if (Array.isArray(step)) {
      const a = step.find((e) => e.src === "A");
      const b = step.find((e) => e.src === "B");
      const A0 = curA, A1 = a.idx, B0 = bIdx(curB), B1 = bIdx(b.idx);
      // Same quad split/winding as loftClosedTube's own ring-to-ring quad.
      indices.push(A0, B1, B0, A0, A1, B1);
      curA = a.idx; curB = b.idx;
    } else if (step.src === "A") {
      // Provides the FORWARD around-ring-A edge (A0->A1) that ring A's own
      // lateral wall is missing without its (removed) end cap.
      indices.push(curA, step.idx, bIdx(curB));
      curA = step.idx;
    } else {
      // Provides the BACKWARD around-ring-B edge (B1->B0) that ring B's own
      // lateral wall is missing without its (removed) start cap.
      indices.push(curA, bIdx(step.idx), bIdx(curB));
      curB = step.idx;
    }
  }

  return { positions: Float32Array.from(positions), indices: Uint32Array.from(indices) };
}

/**
 * Loft a chain of coaxial sections into ONE watertight solid, bridging every
 * internal junction with bridgeMismatchedRings instead of leaving two
 * independent flat end-caps there. Only the very first section's start and
 * the very last section's end get a real cap (or a point, if pointStart /
 * pointEnd is set) — every junction in between is closed by a bridge, and
 * the whole thing is run through weldCoincidentVertices (a no-op today,
 * since a bridge never introduces a genuinely-duplicate ring, but kept as
 * the same general-purpose safety net generateSwordMesh already documents).
 *
 * @param {Array<{
 *   shape: "rect"|"diamond"|"circle",
 *   stations: Array<{x:number,halfWidth:number,halfThickness:number}>,
 *   sides?: number,
 *   pointStart?: boolean,
 *   pointEnd?: boolean,
 * }>} sections must have length >= 1; consecutive sections must share an x
 *   at the touching stations (not enforced — the caller owns centerline
 *   monotonicity, same convention as loftClosedTube).
 * @returns {{
 *   positions: Float32Array, indices: Uint32Array,
 *   sectionVertexCounts: number[], sectionTriangleCounts: number[],
 *   weld: {weldedVertexCount:number, droppedTriangleCount:number},
 * }}
 */
export function loftSectionsWithBridges(sections) {
  if (!Array.isArray(sections) || sections.length < 1) {
    throw new Error("parametric_mesh_bad_sections: need at least 1 section");
  }
  const parts = [];
  const bridges = [];
  const sectionVertexCounts = [];
  const sectionTriangleCounts = [];

  for (let i = 0; i < sections.length; i++) {
    const sec = sections[i];
    const isFirst = i === 0;
    const isLast = i === sections.length - 1;
    const capStart = isFirst && !sec.pointStart;
    const capEnd = isLast && !sec.pointEnd;
    const mesh = loftClosedTube(sec.shape, sec.stations, {
      sides: sec.sides, capStart, capEnd,
      pointStart: !!sec.pointStart, pointEnd: !!sec.pointEnd,
    });
    parts.push(mesh);
    sectionVertexCounts.push(mesh.positions.length / 3);
    sectionTriangleCounts.push(mesh.indices.length / 3);

    if (!isLast) {
      const next = sections[i + 1];
      if (!sec.pointEnd && !next.pointStart) {
        const lastSt = sec.stations[sec.stations.length - 1];
        const firstSt = next.stations[0];
        const ringA = ringPointsAt(sec.shape, lastSt.x, lastSt.halfWidth, lastSt.halfThickness, sec.sides);
        const ringB = ringPointsAt(next.shape, firstSt.x, firstSt.halfWidth, firstSt.halfThickness, next.sides);
        bridges.push(bridgeMismatchedRings(ringA, ringB));
      }
      // If either side collapses to a point, that section's own point-fan
      // already closes the junction (see loftClosedTube's pointStart/
      // pointEnd handling) -- no bridge triangle is needed or well-defined.
    }
  }

  const merged = mergeMeshes([...parts, ...bridges]);
  const welded = weldCoincidentVertices(merged);

  return {
    positions: welded.positions,
    indices: welded.indices,
    sectionVertexCounts,
    sectionTriangleCounts,
    weld: { weldedVertexCount: welded.weldedVertexCount, droppedTriangleCount: welded.droppedTriangleCount },
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
 * Shared assembly step used by every archetype below (and, in spirit, by
 * generateSwordMesh — kept separate there since it predates this helper and
 * its own tests already pin its exact return shape): loft the section chain
 * via loftSectionsWithBridges, then build the matching beam co-product by
 * mapping crossSectionProps over the SAME sections/stations used for the
 * mesh, at the SAME totalLength normalization. Every archetype's `sections`
 * array is both the mesh spec and the beam spec — there is exactly one
 * source of truth for a station's shape/scale, never two.
 *
 * @param {Array<{shape:string, stations:Array<{x:number,halfWidth:number,halfThickness:number}>, sides?:number, pointStart?:boolean, pointEnd?:boolean}>} sections
 * @param {number} totalLength
 * @returns {{positions:Float32Array, indices:Uint32Array, beam:object, meta:object, weld:object}}
 */
function assembleArchetype(sections, totalLength) {
  const loft = loftSectionsWithBridges(sections);
  const beamStations = [];
  for (const sec of sections) {
    for (const st of sec.stations) {
      beamStations.push({ s: st.x / totalLength, ...crossSectionProps(sec.shape, st.halfWidth, st.halfThickness) });
    }
  }
  return {
    positions: loft.positions,
    indices: loft.indices,
    beam: { stations: beamStations },
    meta: {
      totalLength,
      sectionVertexCounts: loft.sectionVertexCounts,
      sectionTriangleCounts: loft.sectionTriangleCounts,
    },
    weld: loft.weld,
  };
}

/** Convenience: wrap an archetype's plain generator with glb-bridge's
 * computeVertexNormals, matching generateSwordMeshWithNormals's shape. */
function withNormalsWrapper(generate) {
  return async function generateWithNormals(params = {}) {
    const { computeVertexNormals } = await import("../evo-asset/glb-bridge.js");
    const mesh = generate(params);
    const normals = computeVertexNormals(mesh.positions, mesh.indices);
    return { ...mesh, normals };
  };
}

/**
 * Generate a deterministic bladed-weapon (sword) mesh: pommel + grip (a
 * tapered circular tube) → guard (a rectangular crossbar block) → blade (a
 * diamond-section taper converging to a point tip). Assembled via
 * `loftSectionsWithBridges`, so the hilt→guard and guard→blade junctions
 * (mismatched profile AND scale at both) are closed by a real ring-to-ring
 * bridge rather than two independent, interpenetrating flat caps — see the
 * exported `HONESTY_NOTES` below and `loftSectionsWithBridges`'s doc-comment
 * for what that guarantees (a single closed, consistently-wound manifold
 * across section junctions, verified via the directed-edge invariant in
 * server/tests/parametric-mesh.test.js) and what it does not (this is still
 * a coaxial abutting-solids merge, not a general boolean/CSG union — see
 * that function's doc-comment for the distinction and why it doesn't need
 * one here).
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

  // ── Section 2: guard (rect profile, constant cross-section block) ──────
  const xGuardStart = xGripEnd;
  const xGuardEnd = xGuardStart + p.guardLength;
  const guardStations = [
    { x: xGuardStart, halfWidth: p.guardWidth / 2, halfThickness: p.guardThickness / 2 },
    { x: xGuardEnd, halfWidth: p.guardWidth / 2, halfThickness: p.guardThickness / 2 },
  ];

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

  // ── Assemble: hilt(circle) → guard(rect) → blade(diamond, tapers to a
  // point tip). The hilt→guard and guard→blade junctions are genuinely
  // mismatched profiles (different shape AND scale — a sword's grip is
  // narrower than its crossguard, and the crossguard is a flat bar while the
  // blade is a lenticular taper) — loftSectionsWithBridges closes each of
  // those junctions with a real ring-to-ring bridge (see that function's
  // doc-comment for why this is exact and manifold, not an approximation),
  // instead of leaving two independent, interpenetrating flat caps there.
  const loft = loftSectionsWithBridges([
    { shape: "circle", stations: hiltStations, sides: p.hiltSides },
    { shape: "rect", stations: guardStations },
    { shape: "diamond", stations: bladeStations, pointEnd: true },
  ]);

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
    positions: loft.positions,
    indices: loft.indices,
    // normals computed by the caller (or via glb-bridge's
    // computeVertexNormals) to keep this module free of the GLB bridge
    // dependency direction — see generateSwordMeshWithNormals below for the
    // convenience wrapper that does import it.
    beam: { stations: beamStations },
    meta: {
      totalLength,
      // Section counts are PRE-weld/PRE-bridge (as emitted by each
      // independent loftClosedTube call inside loftSectionsWithBridges,
      // capStart/capEnd already reflecting that only the very first/last
      // section is actually capped — see `weld` below for the post-bridge
      // delta actually applied to positions/indices).
      sectionVertexCounts: loft.sectionVertexCounts,
      sectionTriangleCounts: loft.sectionTriangleCounts,
    },
    weld: loft.weld,
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
// 1. THE SWORD IS ONE CONTINUOUS MANIFOLD ACROSS ITS SECTION JUNCTIONS —
//    verified, not asserted (server/tests/parametric-mesh.test.js checks
//    the directed-edge invariant across the WHOLE merged+bridged mesh, plus
//    a mass/volume cross-check via mass-properties.js). This corrects an
//    earlier version of this module: the hilt→guard junction (circle ring,
//    radius hiltRadius, meeting rect ring, half-width guardWidth/2,
//    half-thickness guardThickness/2) and the guard→blade junction (rect
//    ring meeting diamond ring) are different profile shapes at different
//    scales at BOTH junctions, by deliberate design (a sword's grip is
//    narrower than its crossguard, and the crossguard is a flat bar while
//    the blade is a lenticular taper) — no vertex on either side of either
//    junction is ever within weld distance of a vertex on the other side, so
//    a `weldCoincidentVertices`-only approach (independently-capped
//    sections, welded after the fact) was a genuine, verified no-op there:
//    two full, differently-shaped flat caps were left sitting at/near the
//    same x-plane, which is exactly the z-fighting + non-manifold-in-spirit
//    defect this module's earlier honesty note flagged.
//    `generateSwordMesh` now assembles via `loftSectionsWithBridges`, which
//    drops BOTH interior caps at each junction and connects the two rings
//    directly with a `bridgeMismatchedRings` triangle strip (see that
//    function's doc-comment for the exact mechanism and why it's manifold
//    by construction, not just visually plausible). This is a coaxial
//    ring-to-ring bridge, not a general boolean/CSG solid union — the
//    sections only ABUT (share a single plane, zero volume overlap), so
//    there's no interpenetration for a boolean operation to resolve, and a
//    BSP-style CSG union would degenerate on exactly this coplanar-cap
//    input. `weldCoincidentVertices` is still run as the same
//    general-purpose safety net (a no-op today, since the bridge never
//    introduces a genuinely-duplicate ring on its own) — see that
//    function's doc-comment, which is otherwise unchanged and still handles
//    the genuinely-coincident case (e.g. two abutting SAME-profile tubes)
//    exactly as before.
// 2. The diamond blade's `momentOfInertia` in `beam.stations` is a
//    RECTANGLE-formula approximation of a true rhombus section (see
//    crossSectionProps' doc-comment) — it over-states bending stiffness by
//    roughly 4× relative to the exact rhombus formula, which is not
//    reused here because physics-compute.js has no rhombus/diamond shape.
export const HONESTY_NOTES = Object.freeze({
  weldPassApplied: true,
  junctionsClosedByRingBridge: true,
  diamondMomentOfInertiaIsRectangleApproximation: true,
});

// ── Archetype 2: polearm (spear) ────────────────────────────────────────────
// haft (long circular tapered pole) → socket/ferrule (a WIDER circular
// collar the spearhead's socket fits over — same shape as the haft, but a
// genuinely different scale, so this is the "nested, no angular crossing"
// bridging case) → head (a diamond/lenticular leaf-blade taper to a point,
// the same real cross-section a bladed weapon actually uses, exercised at a
// different length/proportion than the sword's blade).
const SPEAR_DEFAULTS = {
  haftLength: 1.8,
  haftRadius: 0.014,
  haftSides: 8,
  socketRadius: 0.02,
  socketLength: 0.04,
  headLength: 0.28,
  headBaseWidth: 0.045,
  headBaseThickness: 0.007,
  headSegments: 8,
};

/**
 * Generate a deterministic polearm (spear) mesh. Same honesty contract as
 * generateSwordMesh: pure/deterministic, junctions closed by
 * bridgeMismatchedRings (not two independent caps), beam co-product for
 * Stage 4 FEA (the diamond head uses the same rectangle-formula
 * momentOfInertia approximation as the sword's blade — see
 * crossSectionProps' doc-comment and HONESTY_NOTES above).
 *
 * @param {object} [params] see SPEAR_DEFAULTS for the full parameter set + units (meters)
 */
export function generateSpearMesh(params = {}) {
  const p = { ...SPEAR_DEFAULTS, ...params };
  for (const k of [
    "haftLength", "haftRadius", "socketRadius", "socketLength",
    "headLength", "headBaseWidth", "headBaseThickness",
  ]) assertPositive(k, p[k]);
  if (!Number.isInteger(p.haftSides) || p.haftSides < 3) {
    throw new Error(`parametric_mesh_bad_param: haftSides must be an integer >= 3, got ${p.haftSides}`);
  }
  if (!Number.isInteger(p.headSegments) || p.headSegments < 1) {
    throw new Error(`parametric_mesh_bad_param: headSegments must be a positive integer, got ${p.headSegments}`);
  }

  const xHaftStart = 0;
  const xHaftEnd = xHaftStart + p.haftLength;
  const haftStations = [
    { x: xHaftStart, halfWidth: p.haftRadius, halfThickness: p.haftRadius },
    { x: xHaftEnd, halfWidth: p.haftRadius, halfThickness: p.haftRadius },
  ];

  const xSocketEnd = xHaftEnd + p.socketLength;
  const socketStations = [
    { x: xHaftEnd, halfWidth: p.socketRadius, halfThickness: p.socketRadius },
    { x: xSocketEnd, halfWidth: p.socketRadius, halfThickness: p.socketRadius },
  ];

  const xHeadStart = xSocketEnd;
  const headStations = [];
  for (let i = 0; i <= p.headSegments; i++) {
    const t = i / p.headSegments;
    headStations.push({
      x: xHeadStart + t * p.headLength,
      halfWidth: (p.headBaseWidth / 2) * (1 - t),
      halfThickness: (p.headBaseThickness / 2) * (1 - t),
    });
  }

  const totalLength = xHeadStart + p.headLength;
  return assembleArchetype([
    { shape: "circle", stations: haftStations, sides: p.haftSides },
    { shape: "circle", stations: socketStations, sides: p.haftSides },
    { shape: "diamond", stations: headStations, pointEnd: true },
  ], totalLength);
}

export const generateSpearMeshWithNormals = withNormalsWrapper(generateSpearMesh);

// ── Archetype 3: quarterstaff (staff) ───────────────────────────────────────
// grip (long thin circular pole) → orb/finial (a WIDER circular head — same
// shape, different scale AND different tessellation, both bridged) with its
// own flat cap at the top (no taper-to-point here, unlike the bladed
// archetypes — a genuinely different silhouette, not a renamed clone).
const STAFF_DEFAULTS = {
  gripLength: 1.4,
  gripRadius: 0.012,
  gripSides: 8,
  orbLength: 0.09,
  orbRadius: 0.05,
  orbSides: 12,
};

/** Generate a deterministic quarterstaff mesh. See SPEAR/generateSwordMesh
 * for the shared honesty contract. */
export function generateStaffMesh(params = {}) {
  const p = { ...STAFF_DEFAULTS, ...params };
  for (const k of ["gripLength", "gripRadius", "orbLength", "orbRadius"]) assertPositive(k, p[k]);
  if (!Number.isInteger(p.gripSides) || p.gripSides < 3) {
    throw new Error(`parametric_mesh_bad_param: gripSides must be an integer >= 3, got ${p.gripSides}`);
  }
  if (!Number.isInteger(p.orbSides) || p.orbSides < 3) {
    throw new Error(`parametric_mesh_bad_param: orbSides must be an integer >= 3, got ${p.orbSides}`);
  }

  const xGripStart = 0;
  const xGripEnd = xGripStart + p.gripLength;
  const gripStations = [
    { x: xGripStart, halfWidth: p.gripRadius, halfThickness: p.gripRadius },
    { x: xGripEnd, halfWidth: p.gripRadius, halfThickness: p.gripRadius },
  ];

  const xOrbEnd = xGripEnd + p.orbLength;
  const orbStations = [
    { x: xGripEnd, halfWidth: p.orbRadius, halfThickness: p.orbRadius },
    { x: xOrbEnd, halfWidth: p.orbRadius, halfThickness: p.orbRadius },
  ];

  const totalLength = xOrbEnd;
  return assembleArchetype([
    { shape: "circle", stations: gripStations, sides: p.gripSides },
    { shape: "circle", stations: orbStations, sides: p.orbSides },
  ], totalLength);
}

export const generateStaffMeshWithNormals = withNormalsWrapper(generateStaffMesh);

// ── Archetype 4: flanged mace ────────────────────────────────────────────────
// handle (circular tapered pole) → collar/ferrule (a wider circular ring) →
// head (a diamond cross-section, WIDE in one axis and THIN in the other —
// a flanged mace head's real proportions, not a sword-blade clone — tapered
// down to a smaller-but-nonzero flat top rather than a point, since a mace
// head is blunt, not bladed). At default proportions the collar→head
// junction genuinely CROSSES (the diamond's thin axis is narrower than the
// collar, its wide axis is wider), the same real-junction shape sword's
// hilt→guard junction has — exercised again here at different geometry.
const MACE_DEFAULTS = {
  handleLength: 0.55,
  handleRadius: 0.014,
  handleSides: 8,
  collarLength: 0.03,
  collarRadius: 0.02,
  headLength: 0.16,
  headBaseWidth: 0.09,
  headBaseThickness: 0.03,
  headTipWidth: 0.035,
  headTipThickness: 0.02,
  headSegments: 6,
};

/** Generate a deterministic flanged-mace mesh. See SPEAR/generateSwordMesh
 * for the shared honesty contract. */
export function generateMaceMesh(params = {}) {
  const p = { ...MACE_DEFAULTS, ...params };
  for (const k of [
    "handleLength", "handleRadius", "collarLength", "collarRadius",
    "headLength", "headBaseWidth", "headBaseThickness", "headTipWidth", "headTipThickness",
  ]) assertPositive(k, p[k]);
  if (!Number.isInteger(p.handleSides) || p.handleSides < 3) {
    throw new Error(`parametric_mesh_bad_param: handleSides must be an integer >= 3, got ${p.handleSides}`);
  }
  if (!Number.isInteger(p.headSegments) || p.headSegments < 1) {
    throw new Error(`parametric_mesh_bad_param: headSegments must be a positive integer, got ${p.headSegments}`);
  }

  const xHandleStart = 0;
  const xHandleEnd = xHandleStart + p.handleLength;
  const handleStations = [
    { x: xHandleStart, halfWidth: p.handleRadius, halfThickness: p.handleRadius },
    { x: xHandleEnd, halfWidth: p.handleRadius, halfThickness: p.handleRadius },
  ];

  const xCollarEnd = xHandleEnd + p.collarLength;
  const collarStations = [
    { x: xHandleEnd, halfWidth: p.collarRadius, halfThickness: p.collarRadius },
    { x: xCollarEnd, halfWidth: p.collarRadius, halfThickness: p.collarRadius },
  ];

  const xHeadStart = xCollarEnd;
  const headStations = [];
  for (let i = 0; i <= p.headSegments; i++) {
    const t = i / p.headSegments;
    headStations.push({
      x: xHeadStart + t * p.headLength,
      halfWidth: (p.headBaseWidth / 2) * (1 - t) + (p.headTipWidth / 2) * t,
      halfThickness: (p.headBaseThickness / 2) * (1 - t) + (p.headTipThickness / 2) * t,
    });
  }

  const totalLength = xHeadStart + p.headLength;
  return assembleArchetype([
    { shape: "circle", stations: handleStations, sides: p.handleSides },
    { shape: "circle", stations: collarStations, sides: p.handleSides },
    { shape: "diamond", stations: headStations }, // flat-capped top (blunt, not bladed) — no pointEnd
  ], totalLength);
}

export const generateMaceMeshWithNormals = withNormalsWrapper(generateMaceMesh);

// ── Archetype 5: round shield ────────────────────────────────────────────────
// A genuinely different topology from the other four: the centerline here
// is the shield's DEPTH axis (front-to-back), not a weapon's length axis.
// plate (a wide, thin circular disc — the shield face) → boss (a smaller
// circular dome rising from the plate's center, tapering to a point). The
// boss is strictly nested inside the plate's footprint (no angular
// crossing) — this is precisely the "shoulder" case where the OLD
// independent-double-cap approach was most visibly wrong: two full flat
// discs of very different radii both claiming the same plane, instead of
// one continuous surface with a smaller circular hole where the boss rises
// through it.
const SHIELD_DEFAULTS = {
  plateRadius: 0.35,
  plateThickness: 0.012,
  plateSides: 16,
  bossRadius: 0.06,
  bossHeight: 0.05,
  bossSides: 12,
};

/** Generate a deterministic round-shield mesh. See SPEAR/generateSwordMesh
 * for the shared honesty contract. */
export function generateShieldMesh(params = {}) {
  const p = { ...SHIELD_DEFAULTS, ...params };
  for (const k of ["plateRadius", "plateThickness", "bossRadius", "bossHeight"]) assertPositive(k, p[k]);
  if (!Number.isInteger(p.plateSides) || p.plateSides < 3) {
    throw new Error(`parametric_mesh_bad_param: plateSides must be an integer >= 3, got ${p.plateSides}`);
  }
  if (!Number.isInteger(p.bossSides) || p.bossSides < 3) {
    throw new Error(`parametric_mesh_bad_param: bossSides must be an integer >= 3, got ${p.bossSides}`);
  }

  const xPlateStart = 0;
  const xPlateEnd = xPlateStart + p.plateThickness;
  const plateStations = [
    { x: xPlateStart, halfWidth: p.plateRadius, halfThickness: p.plateRadius },
    { x: xPlateEnd, halfWidth: p.plateRadius, halfThickness: p.plateRadius },
  ];

  const xBossEnd = xPlateEnd + p.bossHeight;
  const bossStations = [
    { x: xPlateEnd, halfWidth: p.bossRadius, halfThickness: p.bossRadius },
    { x: xBossEnd, halfWidth: 0, halfThickness: 0 },
  ];

  const totalLength = xBossEnd;
  return assembleArchetype([
    { shape: "circle", stations: plateStations, sides: p.plateSides },
    { shape: "circle", stations: bossStations, sides: p.bossSides, pointEnd: true },
  ], totalLength);
}

export const generateShieldMeshWithNormals = withNormalsWrapper(generateShieldMesh);
