// server/lib/asset-gen/stl-export.js
//
// Binary STL serializer for the exact mesh shape produced throughout
// asset-gen and consumed by server/lib/evo-asset/glb-bridge.js#packGLB:
//   { positions: Float32Array, indices: Uint32Array, normals?: Float32Array }
// (VEC3 vertex positions, flat triangle-index list). Read directly from
// parametric-mesh.js + glb-bridge.js before writing this module — no shape
// guessing:
//   - parametric-mesh.js#loftClosedTube / mergeMeshes / weldCoincidentVertices
//     only ever emit `indices.length % 3 === 0` triangle lists (quad strips
//     are split into two triangles inline — see loftClosedTube's
//     `indices.push(a0, b1, b0, a0, a1, b1)` — and end caps are fan-
//     triangulated). No archetype in this codebase emits quads/n-gons, so
//     there is NO triangulation step here — building one would be unused
//     code for a shape this codebase never produces. If a future archetype
//     ever emits non-triangular faces, `meshToSTL` will (correctly) reject
//     it via the `non_triangular_indices` honest-failure below rather than
//     silently mis-serializing it.
//   - packGLB (glb-bridge.js:148-162) asserts the same invariants this
//     module re-validates (positions/indices non-empty, indices.length % 3
//     === 0, no index out of vertex-count range) before packing a GLB — STL
//     export applies the identical honesty bar, never writing a corrupt or
//     silently-wrong file for a malformed mesh.
//
// Binary STL format (the real spec, not guessed):
//   [0..80)   80-byte header (arbitrary ASCII, conventionally unused by
//             readers but must be present and exactly 80 bytes)
//   [80..84)  uint32 LE — triangle count N
//   then, per triangle (50 bytes each, N times):
//     [0..12)  3x float32 LE — facet normal (nx, ny, nz)
//     [12..24) 3x float32 LE — vertex A (x, y, z)
//     [24..36) 3x float32 LE — vertex B (x, y, z)
//     [36..48) 3x float32 LE — vertex C (x, y, z)
//     [48..50) uint16 LE — attribute byte count (0; unused by this exporter)
//   Total size = 84 + 50*N bytes.
//
// Facet normals are ALWAYS recomputed here from each triangle's own 3
// vertices (cross product of two edges, normalized) — never copied from a
// mesh's optional per-vertex `normals` field, even when present. STL's
// facet normal is a genuinely FLAT per-face value by format definition;
// glb-bridge.js's `computeVertexNormals` produces area-weighted SMOOTHED
// per-vertex normals (deliberately, for shaded rendering) — reusing one of
// those per-vertex values in the facet-normal slot would be a plausible-
// looking but wrong number, exactly the kind of fabrication CLAUDE.md's
// "honest by construction" rule exists to prevent. Recomputing the true
// facet normal per triangle is simple, deterministic vector math (not
// something requiring a compute engine) and is always correct here.
//
// ASCII STL is NOT implemented — out of scope. Binary is the compact,
// real-tooling-standard format the task asked for, and is strictly smaller
// + faster to parse; nothing in this codebase needs the ASCII variant
// today. Add an `asciiSTL` sibling function later if a real consumer needs
// human-readable STL.
//
// Honest failure states (never a corrupt or silently-wrong file — every
// rejection returns `{ ok:false, reason, ... }`, no throw for a malformed
// *mesh*):
//   empty_mesh              — no positions and/or no indices
//   malformed_mesh           — positions.length not a multiple of 3, or an
//                              index references a vertex outside range
//   non_triangular_indices  — indices.length not a multiple of 3
//   non_finite_coordinate   — a NaN/Infinity coordinate anywhere in positions
//   degenerate_triangle     — a triangle whose 3 vertices are collinear/
//                              coincident (zero cross-product magnitude, so
//                              no well-defined facet normal exists)
//
// `meshToSTL` still throws synchronously for a caller programming error
// (meshData isn't an object at all) — matching packGLB's own contract of
// failing loud on a clearly-wrong call shape rather than a malformed mesh.

const HEADER_BYTES = 80;
const TRIANGLE_RECORD_BYTES = 50; // 12 (normal) + 36 (3 verts) + 2 (attr count)
const DEFAULT_HEADER = "Concord Cognitive Engine — asset-gen STL export";

// Squared-cross-product-magnitude floor below which a triangle is treated
// as degenerate (collinear or duplicate vertices — no well-defined facet
// normal). The cross product magnitude is 2x the triangle's area, so this
// is effectively an area^2 floor. Deliberately tiny in absolute terms (not
// scaled to mesh size) so it only catches genuine zero-area triangles
// (exact or near-exact vertex coincidence), never a legitimately small but
// valid triangle on a small-scale asset-gen mesh (mm-to-tens-of-cm parts —
// see parametric-mesh.js's WELD_EPSILON_M comment for the scale this
// codebase actually works at).
const DEGENERATE_LEN_SQ_EPSILON = 1e-20;

function toFloat32Array(v) {
  if (v instanceof Float32Array) return v;
  return Float32Array.from(v ?? []);
}

function toUint32Array(v) {
  if (v instanceof Uint32Array) return v;
  return Uint32Array.from(v ?? []);
}

/**
 * Serialize a {positions, indices} triangle mesh into a binary STL buffer.
 *
 * @param {object} meshData
 * @param {Float32Array|number[]} meshData.positions  flat VEC3 vertex positions
 * @param {Uint32Array|number[]}  meshData.indices     flat triangle index list (length % 3 === 0)
 * @param {object} [opts]
 * @param {string} [opts.header]  up to 80 ASCII bytes; truncated if longer,
 *   zero-padded if shorter. Defaults to a Concord-identifying string.
 * @returns {
 *   {ok:true, buffer:Buffer, triangleCount:number, vertexCount:number} |
 *   {ok:false, reason:string, [detail]:any}
 * }
 */
export function meshToSTL(meshData, opts = {}) {
  if (!meshData || typeof meshData !== "object") {
    throw new Error("stl_export_bad_call: meshData must be an object with positions/indices");
  }

  const positions = toFloat32Array(meshData.positions);
  const indices = toUint32Array(meshData.indices);

  if (positions.length === 0 || indices.length === 0) {
    return { ok: false, reason: "empty_mesh" };
  }
  if (positions.length % 3 !== 0) {
    return { ok: false, reason: "malformed_mesh", detail: `positions.length ${positions.length} not a multiple of 3` };
  }
  if (indices.length % 3 !== 0) {
    return { ok: false, reason: "non_triangular_indices", detail: `indices.length ${indices.length} not a multiple of 3` };
  }

  const vertCount = positions.length / 3;
  for (let i = 0; i < indices.length; i++) {
    const idx = indices[i];
    if (!Number.isInteger(idx) || idx < 0 || idx >= vertCount) {
      return { ok: false, reason: "malformed_mesh", detail: `index ${idx} at position ${i} exceeds vertex count ${vertCount}` };
    }
  }
  for (let i = 0; i < positions.length; i++) {
    if (!Number.isFinite(positions[i])) {
      return { ok: false, reason: "non_finite_coordinate", detail: `non-finite value at positions[${i}]` };
    }
  }

  const triangleCount = indices.length / 3;
  const buffer = Buffer.alloc(HEADER_BYTES + 4 + triangleCount * TRIANGLE_RECORD_BYTES);

  const headerStr = String(opts.header || DEFAULT_HEADER);
  buffer.write(headerStr, 0, HEADER_BYTES, "latin1");
  buffer.writeUInt32LE(triangleCount, HEADER_BYTES);

  let offset = HEADER_BYTES + 4;
  for (let t = 0; t < triangleCount; t++) {
    const ia = indices[t * 3];
    const ib = indices[t * 3 + 1];
    const ic = indices[t * 3 + 2];

    const ax = positions[ia * 3], ay = positions[ia * 3 + 1], az = positions[ia * 3 + 2];
    const bx = positions[ib * 3], by = positions[ib * 3 + 1], bz = positions[ib * 3 + 2];
    const cx = positions[ic * 3], cy = positions[ic * 3 + 1], cz = positions[ic * 3 + 2];

    // Facet normal = normalize((b-a) x (c-a)).
    const e1x = bx - ax, e1y = by - ay, e1z = bz - az;
    const e2x = cx - ax, e2y = cy - ay, e2z = cz - az;
    const nx = e1y * e2z - e1z * e2y;
    const ny = e1z * e2x - e1x * e2z;
    const nz = e1x * e2y - e1y * e2x;
    const lenSq = nx * nx + ny * ny + nz * nz;

    if (lenSq <= DEGENERATE_LEN_SQ_EPSILON) {
      return { ok: false, reason: "degenerate_triangle", detail: { triangleIndex: t, indices: [ia, ib, ic] } };
    }
    const len = Math.sqrt(lenSq);
    const unx = nx / len, uny = ny / len, unz = nz / len;

    buffer.writeFloatLE(unx, offset);
    buffer.writeFloatLE(uny, offset + 4);
    buffer.writeFloatLE(unz, offset + 8);
    buffer.writeFloatLE(ax, offset + 12);
    buffer.writeFloatLE(ay, offset + 16);
    buffer.writeFloatLE(az, offset + 20);
    buffer.writeFloatLE(bx, offset + 24);
    buffer.writeFloatLE(by, offset + 28);
    buffer.writeFloatLE(bz, offset + 32);
    buffer.writeFloatLE(cx, offset + 36);
    buffer.writeFloatLE(cy, offset + 40);
    buffer.writeFloatLE(cz, offset + 44);
    buffer.writeUInt16LE(0, offset + 48);

    offset += TRIANGLE_RECORD_BYTES;
  }

  return { ok: true, buffer, triangleCount, vertexCount: vertCount };
}

export const STL_BINARY_HEADER_BYTES = HEADER_BYTES;
export const STL_BINARY_TRIANGLE_RECORD_BYTES = TRIANGLE_RECORD_BYTES;
