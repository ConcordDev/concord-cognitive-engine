/**
 * Pins server/lib/asset-gen/stl-export.js#meshToSTL — the binary STL
 * serializer for the same {positions, indices} mesh shape
 * server/lib/evo-asset/glb-bridge.js#packGLB consumes.
 *
 * Ground truth for the "did it serialize correctly" assertions is a hand-
 * built unit cube (8 vertices, 12 axis-aligned triangles) whose per-face
 * normals are trivially hand-verifiable (+/-X, +/-Y, +/-Z unit vectors) —
 * this is simple, exactly-checkable vector math, not a case that needs a
 * compute engine as an oracle. The test PARSES the binary STL buffer back
 * apart byte-by-byte (header, triangle count, per-triangle normal +
 * vertices + attribute byte count) rather than merely asserting the call
 * didn't throw.
 */
import { describe, it } from "node:test";
import assert from "node:assert/strict";

import {
  meshToSTL,
  STL_BINARY_HEADER_BYTES,
  STL_BINARY_TRIANGLE_RECORD_BYTES,
} from "../lib/asset-gen/stl-export.js";

// ── Unit cube fixture ───────────────────────────────────────────────────
// Corners of a side-2 cube centered at the origin. Each of the 6 faces is
// split into 2 triangles, wound so (b-a)x(c-a) points outward (verified by
// hand below in the per-face comments).
const CUBE_POSITIONS = [
  -1, -1, -1, // 0
   1, -1, -1, // 1
   1,  1, -1, // 2
  -1,  1, -1, // 3
  -1, -1,  1, // 4
   1, -1,  1, // 5
   1,  1,  1, // 6
  -1,  1,  1, // 7
];

// Triangle order (12 triangles, 36 indices): bottom(-Z), top(+Z), -Y, +Y, -X, +X.
const CUBE_INDICES = [
  0, 2, 1,  0, 3, 2, // bottom, normal (0,0,-1)
  4, 5, 6,  4, 6, 7, // top,    normal (0,0,1)
  0, 1, 5,  0, 5, 4, // -Y,     normal (0,-1,0)
  3, 6, 2,  3, 7, 6, // +Y,     normal (0,1,0)
  0, 4, 7,  0, 7, 3, // -X,     normal (-1,0,0)
  1, 6, 5,  1, 2, 6, // +X,     normal (1,0,0)
];

const EXPECTED_FACE_NORMALS = [
  [0, 0, -1], [0, 0, -1],
  [0, 0, 1], [0, 0, 1],
  [0, -1, 0], [0, -1, 0],
  [0, 1, 0], [0, 1, 0],
  [-1, 0, 0], [-1, 0, 0],
  [1, 0, 0], [1, 0, 0],
];

function cubeMesh() {
  return { positions: Float32Array.from(CUBE_POSITIONS), indices: Uint32Array.from(CUBE_INDICES) };
}

function readTriangle(buffer, t) {
  const base = STL_BINARY_HEADER_BYTES + 4 + t * STL_BINARY_TRIANGLE_RECORD_BYTES;
  const normal = [
    buffer.readFloatLE(base), buffer.readFloatLE(base + 4), buffer.readFloatLE(base + 8),
  ];
  const va = [buffer.readFloatLE(base + 12), buffer.readFloatLE(base + 16), buffer.readFloatLE(base + 20)];
  const vb = [buffer.readFloatLE(base + 24), buffer.readFloatLE(base + 28), buffer.readFloatLE(base + 32)];
  const vc = [buffer.readFloatLE(base + 36), buffer.readFloatLE(base + 40), buffer.readFloatLE(base + 44)];
  const attrByteCount = buffer.readUInt16LE(base + 48);
  return { normal, va, vb, vc, attrByteCount };
}

function assertVec3Close(actual, expected, msg) {
  for (let i = 0; i < 3; i++) {
    assert.ok(Math.abs(actual[i] - expected[i]) < 1e-5, `${msg}: component ${i} expected ${expected[i]} got ${actual[i]}`);
  }
}

describe("meshToSTL — binary STL serialization", () => {
  it("serializes a unit cube to a valid, byte-level-correct binary STL", () => {
    const result = meshToSTL(cubeMesh());
    assert.equal(result.ok, true);
    assert.equal(result.triangleCount, 12);
    assert.equal(result.vertexCount, 8);

    const buf = result.buffer;
    const expectedLen = STL_BINARY_HEADER_BYTES + 4 + 12 * STL_BINARY_TRIANGLE_RECORD_BYTES;
    assert.equal(buf.length, expectedLen);
    assert.equal(buf.length, 84 + 12 * 50); // spec constants, spelled out literally

    // Header is exactly 80 bytes, non-empty, ASCII.
    const header = buf.subarray(0, 80).toString("latin1").replace(/\0+$/, "");
    assert.ok(header.length > 0);
    assert.ok(header.startsWith("Concord"));

    // Triangle count at offset 80.
    assert.equal(buf.readUInt32LE(80), 12);

    // Every triangle: correct facet normal, correct vertex coordinates
    // (pulled straight from the fixture by index), and a zero attribute
    // byte count.
    for (let t = 0; t < 12; t++) {
      const tri = readTriangle(buf, t);
      assertVec3Close(tri.normal, EXPECTED_FACE_NORMALS[t], `triangle ${t} normal`);
      // Normal must be unit length.
      const len = Math.hypot(tri.normal[0], tri.normal[1], tri.normal[2]);
      assert.ok(Math.abs(len - 1) < 1e-5, `triangle ${t} normal not unit length (${len})`);

      const ia = CUBE_INDICES[t * 3], ib = CUBE_INDICES[t * 3 + 1], ic = CUBE_INDICES[t * 3 + 2];
      const expectA = CUBE_POSITIONS.slice(ia * 3, ia * 3 + 3);
      const expectB = CUBE_POSITIONS.slice(ib * 3, ib * 3 + 3);
      const expectC = CUBE_POSITIONS.slice(ic * 3, ic * 3 + 3);
      assertVec3Close(tri.va, expectA, `triangle ${t} vertex A`);
      assertVec3Close(tri.vb, expectB, `triangle ${t} vertex B`);
      assertVec3Close(tri.vc, expectC, `triangle ${t} vertex C`);
      assert.equal(tri.attrByteCount, 0, `triangle ${t} attribute byte count`);
    }
  });

  it("truncates/pads a custom header to exactly 80 bytes", () => {
    const shortResult = meshToSTL(cubeMesh(), { header: "hi" });
    assert.equal(shortResult.ok, true);
    const shortHeader = shortResult.buffer.subarray(0, 80).toString("latin1").replace(/\0+$/, "");
    assert.equal(shortHeader, "hi");

    const longHeader = "x".repeat(200);
    const longResult = meshToSTL(cubeMesh(), { header: longHeader });
    assert.equal(longResult.ok, true);
    assert.equal(longResult.buffer.length, 84 + 12 * 50); // header stays exactly 80 bytes regardless
  });

  it("accepts plain arrays as well as typed arrays for positions/indices", () => {
    const result = meshToSTL({ positions: CUBE_POSITIONS, indices: CUBE_INDICES });
    assert.equal(result.ok, true);
    assert.equal(result.triangleCount, 12);
  });

  // ── Honest-failure cases ────────────────────────────────────────────
  it("returns an honest failure for an empty mesh (never a corrupt file)", () => {
    const result = meshToSTL({ positions: [], indices: [] });
    assert.equal(result.ok, false);
    assert.equal(result.reason, "empty_mesh");
  });

  it("returns an honest failure for a degenerate (zero-area) triangle", () => {
    // A "triangle" whose three vertices are all the same point — zero
    // cross-product magnitude, no well-defined facet normal.
    const degenerate = {
      positions: [0, 0, 0, 0, 0, 0, 0, 0, 0],
      indices: [0, 1, 2],
    };
    const result = meshToSTL(degenerate);
    assert.equal(result.ok, false);
    assert.equal(result.reason, "degenerate_triangle");
    assert.equal(result.detail.triangleIndex, 0);
  });

  it("returns an honest failure for collinear (degenerate) vertices", () => {
    const collinear = {
      positions: [0, 0, 0, 1, 0, 0, 2, 0, 0], // all on the X axis — zero area
      indices: [0, 1, 2],
    };
    const result = meshToSTL(collinear);
    assert.equal(result.ok, false);
    assert.equal(result.reason, "degenerate_triangle");
  });

  it("returns an honest failure for non-triangular index lists", () => {
    const result = meshToSTL({ positions: [0, 0, 0, 1, 0, 0, 0, 1, 0], indices: [0, 1, 2, 3] });
    assert.equal(result.ok, false);
    assert.equal(result.reason, "non_triangular_indices");
  });

  it("returns an honest failure for malformed positions length", () => {
    const result = meshToSTL({ positions: [0, 0, 0, 1, 0], indices: [0, 1, 0] });
    assert.equal(result.ok, false);
    assert.equal(result.reason, "malformed_mesh");
  });

  it("returns an honest failure for an out-of-range index", () => {
    const result = meshToSTL({ positions: [0, 0, 0, 1, 0, 0, 0, 1, 0], indices: [0, 1, 99] });
    assert.equal(result.ok, false);
    assert.equal(result.reason, "malformed_mesh");
  });

  it("returns an honest failure for a non-finite coordinate", () => {
    const result = meshToSTL({ positions: [0, 0, 0, 1, 0, 0, 0, NaN, 0], indices: [0, 1, 2] });
    assert.equal(result.ok, false);
    assert.equal(result.reason, "non_finite_coordinate");
  });

  it("throws (does not silently proceed) when meshData is not an object", () => {
    assert.throws(() => meshToSTL(null), /stl_export_bad_call/);
    assert.throws(() => meshToSTL(undefined), /stl_export_bad_call/);
  });
});
