// Presentation GLB (visual polish a): the analysed solid's own triangles with
// normals and a clearcoat paint material. Pins that the export is the same
// geometry as the kernel STL (nothing added, moved or smoothed), that it is a
// valid glTF 2.0 binary, and that it is deterministic.

import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { presentGlbFromStl, parseGlb, PRESENT_PAINT } from "../lib/conkay/assembly/present-glb.js";
import { readBinaryStl } from "../lib/conkay/assembly/cad-skin.js";
import { createHash } from "node:crypto";

/** Binary STL of an axis-aligned box (12 triangles, outward winding). */
function boxStl([x0, y0, z0], [x1, y1, z1]) {
  const v = (i) => [i & 1 ? x1 : x0, i & 2 ? y1 : y0, i & 4 ? z1 : z0];
  const faces = [[0, 2, 3, 1], [4, 5, 7, 6], [0, 1, 5, 4], [2, 6, 7, 3], [0, 4, 6, 2], [1, 3, 7, 5]];
  const tris = faces.flatMap(([a, b, c, d]) => [[a, b, c], [a, c, d]]);
  const buf = Buffer.alloc(84 + tris.length * 50);
  buf.writeUInt32LE(tris.length, 80);
  tris.forEach((t, k) => t.forEach((vi, j) => v(vi).forEach((c, a) => buf.writeFloatLE(c, 84 + k * 50 + 12 + j * 12 + a * 4))));
  return buf;
}

const stl = boxStl([0, -0.9, 0.1], [4.5, 0.9, 1.3]);

describe("presentation GLB of the analysed solid", () => {
  it("is a valid glTF 2.0 binary with POSITION, NORMAL, indices and one clearcoat paint material", () => {
    const { glb } = presentGlbFromStl(stl);
    const { json, bin } = parseGlb(glb);
    assert.equal(json.asset.version, "2.0");
    assert.deepEqual(json.extensionsUsed, ["KHR_materials_clearcoat"]);
    const prim = json.meshes[0].primitives[0];
    assert.deepEqual(Object.keys(prim.attributes).sort(), ["NORMAL", "POSITION"]);
    assert.equal(json.materials.length, 1, "paint only: the solid has no glazing surface");
    const mat = json.materials[0];
    assert.equal(mat.pbrMetallicRoughness.metallicFactor, PRESENT_PAINT.metallic);
    assert.equal(mat.extensions.KHR_materials_clearcoat.clearcoatFactor, PRESENT_PAINT.clearcoat);
    assert.equal(mat.extensions.KHR_materials_clearcoat.clearcoatRoughnessFactor, PRESENT_PAINT.clearcoatRoughness);
    assert.equal(bin.length, json.buffers[0].byteLength);
    assert.equal(glb.length % 4, 0);
  });

  it("draws exactly the STL's triangles: same vertex set, same triangle count, indices in range", () => {
    const { glb, triangles, vertices } = presentGlbFromStl(stl);
    const { json, bin } = parseGlb(glb);
    const acc = json.accessors, views = json.bufferViews;
    const f32 = (a) => new Float32Array(bin.buffer.slice(bin.byteOffset + views[acc[a].bufferView].byteOffset, bin.byteOffset + views[acc[a].bufferView].byteOffset + views[acc[a].bufferView].byteLength));
    const pos = f32(0), nrm = f32(1);
    const iv = views[acc[2].bufferView];
    const idx = new Uint32Array(bin.buffer.slice(bin.byteOffset + iv.byteOffset, bin.byteOffset + iv.byteOffset + iv.byteLength));
    assert.equal(triangles, 12);
    assert.equal(vertices, 8, "the box's 8 corners, welded");
    assert.equal(idx.length, 36);
    assert.ok(idx.every((i) => i < vertices));
    const stlVerts = new Set(readBinaryStl(stl).flat().map((p) => p.map((c) => c.toFixed(4)).join(",")));
    for (let v = 0; v < vertices; v++) {
      const k = [pos[v * 3], pos[v * 3 + 1], pos[v * 3 + 2]].map((c) => c.toFixed(4)).join(",");
      assert.ok(stlVerts.has(k), `GLB vertex ${k} must be an STL vertex`);
      assert.ok(Math.abs(Math.hypot(nrm[v * 3], nrm[v * 3 + 1], nrm[v * 3 + 2]) - 1) < 1e-4, "unit normals");
    }
    assert.deepEqual(acc[0].min, [0, -0.9, 0.1]);
    assert.deepEqual(acc[0].max, [4.5, 0.9, 1.3]);
  });

  it("normals point outward (box corner normal points away from the centre)", () => {
    const { json, bin } = parseGlb(presentGlbFromStl(stl).glb);
    const v = json.bufferViews;
    const pos = new Float32Array(bin.buffer.slice(bin.byteOffset, bin.byteOffset + v[0].byteLength));
    const nrm = new Float32Array(bin.buffer.slice(bin.byteOffset + v[1].byteOffset, bin.byteOffset + v[1].byteOffset + v[1].byteLength));
    const c = [2.25, 0, 0.7];
    for (let i = 0; i < pos.length; i += 3) {
      const dot = (pos[i] - c[0]) * nrm[i] + (pos[i + 1] - c[1]) * nrm[i + 1] + (pos[i + 2] - c[2]) * nrm[i + 2];
      assert.ok(dot > 0, "outward normal");
    }
  });

  it("records the source STL hash and is byte-for-byte deterministic", () => {
    const a = presentGlbFromStl(stl, { source: { requestHash: "abc" } });
    const b = presentGlbFromStl(stl, { source: { requestHash: "abc" } });
    assert.equal(a.sha256, b.sha256);
    const { json } = parseGlb(a.glb);
    assert.match(json.asset.extras.sourceStlSha256, /^[0-9a-f]{64}$/);
    assert.equal(json.asset.extras.source.requestHash, "abc");
  });

  it("refuses a truncated STL and a non-GLB buffer", () => {
    assert.throws(() => presentGlbFromStl(stl.subarray(0, 100)), /not a binary STL/);
    assert.throws(() => parseGlb(Buffer.alloc(32)), /bad magic/);
  });
});

describe("GET /designs/:id/present.glb (public demo router)", () => {
  it("serves the car snapshot's analysed solid as a GLB with the same triangle count as its STL", async () => {
    const { default: express } = await import("express");
    const { default: createConkayDemoRouter } = await import("../routes/conkay-demo.js");
    const { loadSnapshot, loadSnapshotFile } = await import("../lib/conkay/showcase/index.js");
    const app = express();
    app.use("/d", createConkayDemoRouter({}));
    const server = await new Promise((r) => { const s = app.listen(0, "127.0.0.1", () => r(s)); });
    try {
      const base = `http://127.0.0.1:${server.address().port}/d`;
      const res = await fetch(`${base}/designs/car/present.glb`);
      assert.equal(res.status, 200);
      assert.equal(res.headers.get("content-type"), "model/gltf-binary");
      const glb = Buffer.from(await res.arrayBuffer());
      const { json } = parseGlb(glb);
      const snap = await loadSnapshot("car");
      const stlName = snap.files.find((f) => /^body-.*\.stl$/.test(f.name)).name;
      const stl = await loadSnapshotFile("car", stlName);
      assert.equal(json.asset.extras.source.stlSha256, stl.sha256);
      assert.equal(json.accessors[2].count, 3 * stl.data.readUInt32LE(80), "every kernel triangle, none added");
      assert.equal(res.headers.get("etag"), `"${createHashHex(glb)}"`);
      // a design without a body solid is an honest 404, not an empty GLB
      const none = await fetch(`${base}/designs/methanol-water/present.glb`);
      assert.equal(none.status, 404);
      assert.equal((await fetch(`${base}/designs/no-such-design/present.glb`)).status, 404);
    } finally {
      await new Promise((r) => server.close(r));
    }
  });
});

function createHashHex(buf) {
  return createHash("sha256").update(buf).digest("hex");
}
