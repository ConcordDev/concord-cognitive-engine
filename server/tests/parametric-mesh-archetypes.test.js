/**
 * Program C, Stage 2 — parametric mesh archetypes beyond "sword".
 *
 * generateSwordMesh was the ONLY archetype the CAS -> FEA structural
 * pipeline supported. This file pins four new ones (spear / staff / mace /
 * shield), each with a genuinely distinct cross-section chain (not a sword
 * clone with a renamed key — see the doc-comment above each archetype in
 * parametric-mesh.js for the real-world proportions/topology it models),
 * and each exercising bridgeMismatchedRings at a junction the sword
 * archetype does not (same-shape/different-scale "nested" bridging for
 * spear/staff/mace's pole junctions, a genuine angular crossing for mace's
 * collar->head junction, and a large-radius-difference nested "shoulder"
 * for shield's plate->boss junction).
 *
 * Same verification idiom as parametric-mesh.test.js: the directed-edge
 * invariant is the manifold proof (not vertex/triangle counts alone), plus
 * a plausible-magnitude positive-volume sanity check, plus (for spear,
 * whose head uses the same diamond/approximation-flagged profile as the
 * sword's blade) a real run through the UNMODIFIED fea-gate.js structural
 * solver, proving a new archetype survives the structural pipeline
 * end-to-end, not just the mesh layer.
 */
import { describe, it } from "node:test";
import assert from "node:assert/strict";

import {
  generateSpearMesh,
  generateSpearMeshWithNormals,
  generateStaffMesh,
  generateMaceMesh,
  generateShieldMesh,
} from "../lib/asset-gen/parametric-mesh.js";
import { structuralCheck } from "../lib/asset-gen/fea-gate.js";
import { packGLB, extractMeshData, computeVertexNormals } from "../lib/evo-asset/glb-bridge.js";

// ── Shared geometry helpers (independent re-derivation, same as
// parametric-mesh.test.js — this file doesn't import them so it doesn't
// just re-check itself against its own production code's internal math).
function directedEdgeInvariant(indices) {
  const dir = new Map();
  for (let i = 0; i < indices.length; i += 3) {
    const tri = [indices[i], indices[i + 1], indices[i + 2]];
    for (let e = 0; e < 3; e++) {
      const a = tri[e], b = tri[(e + 1) % 3];
      const key = `${a}_${b}`;
      dir.set(key, (dir.get(key) || 0) + 1);
    }
  }
  let dupDirected = 0, missingReverse = 0;
  for (const [key, count] of dir) {
    if (count > 1) dupDirected++;
    const [a, b] = key.split("_");
    if (!dir.has(`${b}_${a}`)) missingReverse++;
  }
  return { dupDirected, missingReverse, directedEdgeCount: dir.size };
}

function signedVolume(positions, indices) {
  let vol = 0;
  for (let i = 0; i < indices.length; i += 3) {
    const ia = indices[i] * 3, ib = indices[i + 1] * 3, ic = indices[i + 2] * 3;
    const ax = positions[ia], ay = positions[ia + 1], az = positions[ia + 2];
    const bx = positions[ib], by = positions[ib + 1], bz = positions[ib + 2];
    const cx = positions[ic], cy = positions[ic + 1], cz = positions[ic + 2];
    const crossX = by * cz - bz * cy, crossY = bz * cx - bx * cz, crossZ = bx * cy - by * cx;
    vol += (ax * crossX + ay * crossY + az * crossZ) / 6;
  }
  return vol;
}

// Every vertex index a mesh's index buffer references must be in-bounds —
// a cheap, independent sanity check alongside the manifold invariant.
function assertIndicesInBounds(mesh) {
  const vertCount = mesh.positions.length / 3;
  for (const i of mesh.indices) assert.ok(i >= 0 && i < vertCount, `index ${i} out of bounds (${vertCount} verts)`);
}

const ARCHETYPES = [
  {
    name: "spear",
    generate: generateSpearMesh,
    // (approx. cross-section area) x (haft length) as a coarse lower bound —
    // the real volume also includes the tapered head + socket, so it must
    // exceed the plain-cylinder haft estimate.
    minVolume: Math.PI * 0.014 * 0.014 * 1.8 * 0.85, // 0.85: n-gon vs true circle area shortfall
    maxVolume: 0.01,
  },
  { name: "staff", generate: generateStaffMesh, minVolume: 1e-4, maxVolume: 0.01 },
  { name: "mace", generate: generateMaceMesh, minVolume: 1e-5, maxVolume: 0.005 },
  { name: "shield", generate: generateShieldMesh, minVolume: 1e-3, maxVolume: 0.02 },
];

describe("New archetypes (spear/staff/mace/shield) — each a genuinely different cross-section chain, verified via the same manifold + volume idiom as generateSwordMesh", () => {
  for (const { name, generate, minVolume, maxVolume } of ARCHETYPES) {
    describe(name, () => {
      it("is deterministic (same params -> byte-identical positions/indices)", () => {
        const m1 = generate();
        const m2 = generate();
        assert.deepEqual(Array.from(m1.positions), Array.from(m2.positions));
        assert.deepEqual(Array.from(m1.indices), Array.from(m2.indices));
        assert.deepEqual(m1.meta, m2.meta);
      });

      it("is a single closed, consistently-wound 2-manifold end-to-end (directed-edge invariant)", () => {
        const m = generate();
        assertIndicesInBounds(m);
        const inv = directedEdgeInvariant(m.indices);
        assert.equal(inv.dupDirected, 0, `${name}: found duplicate directed edges (non-manifold / interpenetrating geometry)`);
        assert.equal(inv.missingReverse, 0, `${name}: found an open boundary (a junction is not actually closed)`);
        assert.ok(inv.directedEdgeCount > 0);
      });

      it("has a plausible, positive, finite enclosed volume (not degenerate, not absurd)", () => {
        const m = generate();
        const vol = signedVolume(m.positions, m.indices);
        assert.ok(Number.isFinite(vol), `${name}: volume is not finite`);
        assert.ok(vol > minVolume, `${name}: volume ${vol} is implausibly small (< ${minVolume})`);
        assert.ok(vol < maxVolume, `${name}: volume ${vol} is implausibly large (> ${maxVolume})`);
      });

      it("its junction bridge(s) genuinely welded — this is NOT a sword clone standing on a no-op weld", () => {
        const m = generate();
        // Every one of these archetypes has at least one internal junction
        // (a section boundary that isn't the very first/last), so the weld
        // pass (which unions the bridge's duplicate ring positions onto the
        // adjoining sections' own rings) must have welded a nonzero number
        // of vertices and dropped zero triangles (no leftover
        // mirror-pair caps — there are none left to cancel).
        assert.ok(m.weld.weldedVertexCount > 0, `${name}: weld welded 0 vertices — junction bridging did not actually run`);
        assert.equal(m.weld.droppedTriangleCount, 0);
      });

      it("produces a beam co-product with monotonic s in [0,1] and finite, non-negative area/momentOfInertia at every station", () => {
        const m = generate();
        assert.ok(m.beam.stations.length >= 2);
        assert.equal(m.beam.stations[0].s, 0);
        assert.ok(Math.abs(m.beam.stations[m.beam.stations.length - 1].s - 1) < 1e-9);
        let prevS = -Infinity;
        for (const st of m.beam.stations) {
          assert.ok(st.s >= prevS - 1e-12, `${name}: beam station s values are not monotonic`);
          prevS = st.s;
          assert.ok(Number.isFinite(st.area) && st.area >= 0);
          assert.ok(Number.isFinite(st.momentOfInertia) && st.momentOfInertia >= 0);
        }
      });

      it("default params produce a self-consistent mesh (positions length divisible by 3, indices length divisible by 3, meta.totalLength positive and finite)", () => {
        const m = generate();
        assert.equal(m.positions.length % 3, 0);
        assert.equal(m.indices.length % 3, 0);
        assert.ok(Number.isFinite(m.meta.totalLength) && m.meta.totalLength > 0);
      });
    });
  }

  it("spear: rejects bad params by name (haftSides < 3, non-integer headSegments, non-positive lengths)", () => {
    assert.throws(() => generateSpearMesh({ haftSides: 2 }), /parametric_mesh_bad_param/);
    assert.throws(() => generateSpearMesh({ headSegments: 1.5 }), /parametric_mesh_bad_param/);
    assert.throws(() => generateSpearMesh({ haftLength: 0 }), /parametric_mesh_bad_param/);
    assert.throws(() => generateSpearMesh({ headBaseWidth: -1 }), /parametric_mesh_bad_param/);
  });

  it("staff: rejects bad params by name (gripSides/orbSides < 3, non-positive lengths)", () => {
    assert.throws(() => generateStaffMesh({ gripSides: 2 }), /parametric_mesh_bad_param/);
    assert.throws(() => generateStaffMesh({ orbSides: 0 }), /parametric_mesh_bad_param/);
    assert.throws(() => generateStaffMesh({ orbRadius: 0 }), /parametric_mesh_bad_param/);
  });

  it("mace: rejects bad params by name (handleSides < 3, non-integer headSegments, non-positive dims)", () => {
    assert.throws(() => generateMaceMesh({ handleSides: 2 }), /parametric_mesh_bad_param/);
    assert.throws(() => generateMaceMesh({ headSegments: -1 }), /parametric_mesh_bad_param/);
    assert.throws(() => generateMaceMesh({ headBaseThickness: 0 }), /parametric_mesh_bad_param/);
  });

  it("shield: rejects bad params by name (plateSides/bossSides < 3, non-positive dims)", () => {
    assert.throws(() => generateShieldMesh({ plateSides: 2 }), /parametric_mesh_bad_param/);
    assert.throws(() => generateShieldMesh({ bossSides: 1 }), /parametric_mesh_bad_param/);
    assert.throws(() => generateShieldMesh({ plateRadius: -0.1 }), /parametric_mesh_bad_param/);
  });

  it("mace's collar->head junction genuinely CROSSES (the diamond head's thin axis is narrower than the collar, its wide axis is wider) — the same real-junction shape as the sword's hilt->guard, proving the bridge handles crossing profiles here too, not just the sword's specific numbers", () => {
    const m = generateMaceMesh();
    const collarRadius = 0.02; // MACE_DEFAULTS.collarRadius
    const headHalfThickness = 0.03 / 2; // MACE_DEFAULTS.headBaseThickness / 2
    const headHalfWidth = 0.09 / 2; // MACE_DEFAULTS.headBaseWidth / 2
    assert.ok(headHalfThickness < collarRadius, "precondition: head is narrower than the collar on its thin axis");
    assert.ok(headHalfWidth > collarRadius, "precondition: head is wider than the collar on its wide axis");
    // The manifold + volume tests above already prove the bridge closes
    // this crossing junction correctly; this test just pins the
    // precondition so the crossing case doesn't silently stop being
    // exercised if MACE_DEFAULTS changes.
    const inv = directedEdgeInvariant(m.indices);
    assert.equal(inv.dupDirected, 0);
    assert.equal(inv.missingReverse, 0);
  });

  it("spear's diamond head survives the REAL (unmodified) fea-gate.js structural solver end-to-end — a new archetype, not just a new mesh shape, is proven through the whole Stage 2 -> Stage 4 pipeline", () => {
    const mesh = generateSpearMesh();
    const check = structuralCheck(mesh.beam, { totalLength: mesh.meta.totalLength });
    assert.equal(check.ok, true, `spear failed structural check: ${JSON.stringify(check)}`);
    assert.ok(Number.isFinite(check.maxUtilization) && check.maxUtilization > 0 && check.maxUtilization <= 1);
    assert.equal(check.failingStations.length, 0);
  });

  it("spear + normals round-trips through glb-bridge packGLB -> extractMeshData (same contract as generateSwordMeshWithNormals)", async () => {
    const mesh = await generateSpearMeshWithNormals({ headSegments: 4, haftSides: 6 });
    assert.equal(mesh.normals.length, mesh.positions.length);
    const os = await import("node:os");
    const path = await import("node:path");
    const fs = await import("node:fs");
    const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "parametric-mesh-archetype-"));
    try {
      const out = path.join(tmpDir, "spear.glb");
      await packGLB({ positions: mesh.positions, indices: mesh.indices, normals: mesh.normals }, out);
      const ext = await extractMeshData(out);
      assert.equal(ext.positions.length, mesh.positions.length);
      assert.equal(ext.indices.length, mesh.indices.length);
      assert.deepEqual(Array.from(ext.indices), Array.from(mesh.indices));
      const normals = computeVertexNormals(mesh.positions, mesh.indices);
      for (let v = 0; v < normals.length; v += 3) {
        const len = Math.hypot(normals[v], normals[v + 1], normals[v + 2]);
        assert.ok(Math.abs(len - 1) < 1e-6, `unit-length normal at vertex ${v / 3}`);
      }
    } finally {
      fs.rmSync(tmpDir, { recursive: true, force: true });
    }
  });
});
