import { describe, it, before, after } from "node:test";
import assert from "node:assert/strict";
import fs from "fs";
import os from "os";
import path from "path";
import crypto from "crypto";
import { Document, NodeIO } from "@gltf-transform/core";
import { buildGameLods, measureDocument } from "../lib/evo-asset/game-lod.js";

// 1x1 PNG — enough for a real texture reference; the pass must carry it over.
const PNG_1X1 = Buffer.from(
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==",
  "base64",
);

// UV sphere with a duplicated seam column (u=0 and u=1), the same kind of
// attribute discontinuity that makes AI-generated meshes hard to decimate.
function uvSphere(rings, segments) {
  const pos = []; const nrm = []; const uv = []; const idx = [];
  for (let r = 0; r <= rings; r += 1) {
    const phi = (r / rings) * Math.PI;
    for (let s = 0; s <= segments; s += 1) {
      const theta = (s / segments) * Math.PI * 2;
      const x = Math.sin(phi) * Math.cos(theta);
      const y = Math.cos(phi);
      const z = Math.sin(phi) * Math.sin(theta);
      pos.push(x, y, z); nrm.push(x, y, z); uv.push(s / segments, r / rings);
    }
  }
  const row = segments + 1;
  for (let r = 0; r < rings; r += 1) {
    for (let s = 0; s < segments; s += 1) {
      const a = r * row + s; const b = a + row;
      idx.push(a, b, a + 1, a + 1, b, b + 1);
    }
  }
  return { pos: new Float32Array(pos), nrm: new Float32Array(nrm), uv: new Float32Array(uv), idx: new Uint32Array(idx) };
}

async function writeTexturedSphere(file) {
  const doc = new Document();
  const buffer = doc.createBuffer();
  const s = uvSphere(40, 60);
  const tex = doc.createTexture("albedo").setImage(PNG_1X1).setMimeType("image/png");
  const mat = doc.createMaterial("skin").setBaseColorTexture(tex);
  const prim = doc.createPrimitive()
    .setAttribute("POSITION", doc.createAccessor().setType("VEC3").setArray(s.pos).setBuffer(buffer))
    .setAttribute("NORMAL", doc.createAccessor().setType("VEC3").setArray(s.nrm).setBuffer(buffer))
    .setAttribute("TEXCOORD_0", doc.createAccessor().setType("VEC2").setArray(s.uv).setBuffer(buffer))
    .setIndices(doc.createAccessor().setType("SCALAR").setArray(s.idx).setBuffer(buffer))
    .setMaterial(mat);
  const mesh = doc.createMesh("mesh").addPrimitive(prim);
  doc.createScene().addChild(doc.createNode("mesh").setMesh(mesh));
  await new NodeIO().write(file, doc);
}

function bbox(acc) {
  const min = [Infinity, Infinity, Infinity]; const max = [-Infinity, -Infinity, -Infinity];
  const el = [0, 0, 0];
  for (let i = 0; i < acc.getCount(); i += 1) {
    acc.getElement(i, el);
    for (let c = 0; c < 3; c += 1) { min[c] = Math.min(min[c], el[c]); max[c] = Math.max(max[c], el[c]); }
  }
  return { min, max };
}

const sha = (f) => crypto.createHash("sha256").update(fs.readFileSync(f)).digest("hex");

describe("game-lod: decimated LOD bands for textured external GLBs", () => {
  let dir; let src;
  before(async () => {
    dir = fs.mkdtempSync(path.join(os.tmpdir(), "game-lod-"));
    src = path.join(dir, "faun_test.glb");
    await writeTexturedSphere(src);
  });
  after(() => fs.rmSync(dir, { recursive: true, force: true }));

  it("writes one file with LOD0 + decimated bands sharing the source material and texture", async () => {
    const before = sha(src);
    const r = await buildGameLods(src, { nodeName: "faun_test" });
    assert.equal(r.ok, true, JSON.stringify(r));
    assert.equal(sha(src), before, "source GLB must not be modified");
    assert.equal(path.basename(r.path), "faun_test_lods.glb");

    const doc = await new NodeIO().read(r.path);
    const root = doc.getRoot();
    assert.deepEqual(root.listNodes().map((n) => n.getName()), ["faun_test_LOD0", "faun_test_LOD1", "faun_test_LOD2"]);
    assert.equal(root.listMaterials().length, 1, "bands share one material");
    assert.equal(root.listTextures().length, 1, "texture stored once, not per band");
    for (const mesh of root.listMeshes()) {
      for (const prim of mesh.listPrimitives()) {
        assert.equal(prim.getMaterial(), root.listMaterials()[0]);
        assert.ok(prim.getAttribute("TEXCOORD_0"), "UVs survive decimation");
        assert.ok(prim.getAttribute("NORMAL"), "normals survive decimation");
      }
    }
  });

  it("reports achieved ratios honestly and actually reduces triangles", async () => {
    const r = await buildGameLods(src, { ratios: [0.5, 0.2] });
    assert.equal(r.source.tris, 40 * 60 * 2);
    const [b1, b2] = r.bands;
    assert.ok(b1.tris < r.source.tris && b2.tris < b1.tris, "each band is coarser than the last");
    assert.equal(b1.achievedRatio, b1.tris / r.source.tris);
    assert.ok(b1.achievedRatio <= 0.55 && b2.achievedRatio <= 0.25, `bands near target: ${b1.achievedRatio} ${b2.achievedRatio}`);
    assert.ok(b2.maxError < 0.05, "stays within the error bound");
  });

  it("keeps the silhouette, UV range and index validity of every band", async () => {
    const r = await buildGameLods(src);
    const doc = await new NodeIO().read(r.path);
    const meshes = doc.getRoot().listMeshes();
    const ref = bbox(meshes[0].listPrimitives()[0].getAttribute("POSITION"));
    for (const mesh of meshes.slice(1)) {
      const prim = mesh.listPrimitives()[0];
      const pos = prim.getAttribute("POSITION");
      const b = bbox(pos);
      for (let c = 0; c < 3; c += 1) {
        assert.ok(Math.abs(b.min[c] - ref.min[c]) < 0.1 && Math.abs(b.max[c] - ref.max[c]) < 0.1, `bbox axis ${c} drifted`);
      }
      const uv = prim.getAttribute("TEXCOORD_0").getArray();
      assert.ok(uv.every((v) => v >= 0 && v <= 1), "UVs stay inside the source range");
      const idx = prim.getIndices().getArray();
      assert.ok(idx.every((i) => i < pos.getCount()), "indices reference compacted vertices");
      assert.equal(prim.getAttribute("TEXCOORD_0").getCount(), pos.getCount(), "attributes compacted together");
    }
    assert.equal(measureDocument(doc).tris, r.source.tris + r.bands.reduce((s, b) => s + b.tris, 0));
  });

  it("fails closed on bad input", async () => {
    assert.deepEqual(await buildGameLods(path.join(dir, "x.obj")), { ok: false, reason: "not_glb" });
    assert.deepEqual(await buildGameLods(path.join(dir, "missing.glb")), { ok: false, reason: "source_missing" });
    assert.equal((await buildGameLods(src, { ratios: [1.2] })).reason, "ratio_out_of_range");
  });
});
