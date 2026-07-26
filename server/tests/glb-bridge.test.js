/**
 * Pins the GLB vertex-extraction bridge that closes the evo-asset refinement
 * residual: subdivision / procedural_wear / higher_lod can now refine binary
 * GLBs, not just {positions, indices} mesh-JSON seeds.
 *
 * Round-trip fixtures are built with packGLB itself (the module is its own
 * ground truth for the accessor layout), then extracted back and refined.
 * Multi-primitive GLBs must throw an honest error and swallow to null in the
 * pass; the JSON seed path must remain byte-for-byte unchanged.
 */
import { describe, it, before, after } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { NodeIO, Document } from "@gltf-transform/core";

import {
  isGlbSource,
  extractMeshData,
  packGLB,
  computeVertexNormals,
} from "../lib/evo-asset/glb-bridge.js";
import {
  runSubdivisionPass,
  runWearPass,
  runHigherLodPass,
} from "../lib/evo-asset/refinement-passes.js";

let tmpDir;
before(() => { tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "glb-bridge-")); });
after(() => { try { fs.rmSync(tmpDir, { recursive: true, force: true }); } catch { /* ignore */ } });

// A unit triangle and a minimal 2-triangle quad.
const TRI = {
  positions: [0, 0, 0, 1, 0, 0, 0, 1, 0],
  indices: [0, 1, 2],
};
const QUAD = {
  positions: [0, 0, 0, 1, 0, 0, 1, 1, 0, 0, 1, 0],
  indices: [0, 1, 2, 0, 2, 3],
};

describe("glb-bridge round-trip", () => {
  it("packGLB → extractMeshData preserves positions, indices, material", async () => {
    const out = path.join(tmpDir, "tri.glb");
    await packGLB({
      ...TRI,
      material: { baseColorFactor: [0.2, 0.4, 0.6, 1], metallicFactor: 0.3, roughnessFactor: 0.7 },
    }, out);

    assert.equal(fs.readFileSync(out).slice(0, 4).toString("latin1"), "glTF");
    assert.ok(isGlbSource(out));

    const ext = await extractMeshData(out);
    assert.equal(ext.positions.length, TRI.positions.length);
    assert.equal(ext.indices.length, TRI.indices.length);
    for (let i = 0; i < TRI.positions.length; i++) {
      assert.ok(Math.abs(ext.positions[i] - TRI.positions[i]) < 1e-6, `pos[${i}]`);
    }
    assert.deepEqual(Array.from(ext.indices), TRI.indices);
    assert.ok(ext.material);
    assert.ok(Math.abs(ext.material.metallicFactor - 0.3) < 1e-6);
    assert.ok(Math.abs(ext.material.roughnessFactor - 0.7) < 1e-6);
  });

  it("computeVertexNormals returns unit normals, one per vertex", () => {
    const n = computeVertexNormals(TRI.positions, TRI.indices);
    assert.equal(n.length, TRI.positions.length);
    // Flat z-up triangle → all normals ≈ (0,0,±1), unit length.
    for (let v = 0; v < n.length; v += 3) {
      const len = Math.hypot(n[v], n[v + 1], n[v + 2]);
      assert.ok(Math.abs(len - 1) < 1e-6, "unit length");
      assert.ok(Math.abs(Math.abs(n[v + 2]) - 1) < 1e-6, "z-facing");
    }
  });
});

describe("refinement passes on GLB sources", () => {
  it("runSubdivisionPass emits a .glb with more tris, itself round-trippable", async () => {
    const src = path.join(tmpDir, "sub-src.glb");
    await packGLB({ ...QUAD, material: { baseColorFactor: [1, 1, 1, 1], metallicFactor: 0, roughnessFactor: 0.5 } }, src);

    const r = await runSubdivisionPass("asset-sub", src);
    assert.ok(r, "returns non-null");
    assert.equal(path.extname(r.localPath), ".glb");
    assert.match(r.diffSummary, /subdivision\(glb\)/);

    const ext = await extractMeshData(r.localPath);
    // 2 input tris → 8 output tris (each tri → 4).
    assert.equal(ext.indices.length / 3, 8);
    assert.ok(ext.normals, "output carries NORMAL");
  });

  it("runWearPass emits a .glb carrying COLOR_0", async () => {
    const src = path.join(tmpDir, "wear-src.glb");
    await packGLB({ ...TRI, material: { baseColorFactor: [1, 1, 1, 1], metallicFactor: 0, roughnessFactor: 0.5 } }, src);

    const r = await runWearPass("asset-wear", src, { ageDays: 200, interactionDensity: 50 });
    assert.ok(r, "returns non-null");
    assert.equal(path.extname(r.localPath), ".glb");

    const ext = await extractMeshData(r.localPath);
    assert.ok(ext.colors, "output carries COLOR_0");
    assert.equal(ext.colors.length, TRI.positions.length);
  });

  it("runHigherLodPass emits a .glb with 16x tris on a single triangle", async () => {
    const src = path.join(tmpDir, "lod-src.glb");
    await packGLB({ ...TRI, material: { baseColorFactor: [1, 1, 1, 1], metallicFactor: 0, roughnessFactor: 0.5 } }, src);

    const r = await runHigherLodPass("asset-lod", src);
    assert.ok(r, "returns non-null");
    assert.equal(path.extname(r.localPath), ".glb");
    const ext = await extractMeshData(r.localPath);
    // 1 tri → 4 → 16.
    assert.equal(ext.indices.length / 3, 16);
  });
});

describe("honest failure — multi-primitive GLB", () => {
  async function buildMultiPrimGlb(outPath) {
    const doc = new Document();
    const buf = doc.createBuffer();
    const mkPrim = (arr) => {
      const pos = doc.createAccessor().setType("VEC3").setArray(new Float32Array(arr)).setBuffer(buf);
      const idx = doc.createAccessor().setType("SCALAR").setArray(new Uint32Array([0, 1, 2])).setBuffer(buf);
      return doc.createPrimitive().setAttribute("POSITION", pos).setIndices(idx);
    };
    const mesh = doc.createMesh()
      .addPrimitive(mkPrim([0, 0, 0, 1, 0, 0, 0, 1, 0]))
      .addPrimitive(mkPrim([0, 0, 1, 1, 0, 1, 0, 1, 1]));
    doc.createScene().addChild(doc.createNode().setMesh(mesh));
    await new NodeIO().write(outPath, doc);
  }

  it("extractMeshData throws the honest named error", async () => {
    const src = path.join(tmpDir, "multi.glb");
    await buildMultiPrimGlb(src);
    await assert.rejects(() => extractMeshData(src), /glb_multi_mesh_unsupported/);
  });

  it("runSubdivisionPass swallows the throw to null (no crash)", async () => {
    const src = path.join(tmpDir, "multi2.glb");
    await buildMultiPrimGlb(src);
    const r = await runSubdivisionPass("asset-multi", src);
    assert.equal(r, null);
  });
});

describe("JSON seed path — no regression", () => {
  it("runSubdivisionPass on a .json mesh still emits .json with the same shape", async () => {
    const src = path.join(tmpDir, "seed.mesh.json");
    fs.writeFileSync(src, JSON.stringify(QUAD));
    assert.equal(isGlbSource(src), false);

    const r = await runSubdivisionPass("asset-json", src);
    assert.ok(r);
    assert.equal(path.extname(r.localPath), ".json");
    assert.match(r.diffSummary, /^subdivision \d/);
    const parsed = JSON.parse(fs.readFileSync(r.localPath, "utf8"));
    assert.ok(Array.isArray(parsed.positions));
    assert.ok(Array.isArray(parsed.indices));
    assert.equal(parsed.indices.length / 3, 8);
    assert.equal(parsed.colors, undefined);
  });
});
