// server/lib/conkay/assembly/present-glb.js
//
// Presentation GLB of the analysed solid: the kernel's own triangles (read
// from its binary STL), welded, with area-weighted vertex normals and a PBR
// clearcoat paint material (KHR_materials_clearcoat).
//
// Presentation only. The kernel's body.glb (positions + indices, hashed into
// drawing receipts) is untouched; this file is a second, derived export. Its
// geometry is the same triangles: vertices are welded and rounded to 10 µm by
// cadSkinMesh, degenerate-after-weld triangles dropped, nothing added, moved
// or smoothed. The solid has no glazing surface, so the GLB has one material
// (paint) and no glass; glass/lamp overlays are a separate layer.

import { createHash } from "node:crypto";
import { readBinaryStl, cadSkinMesh } from "./cad-skin.js";

export const PRESENT_GLB_VERSION = "1.0.0";

/** The paint the Cycles studio render (render_studio.py) and the Studio viewer use too. */
export const PRESENT_PAINT = Object.freeze({
  baseColor: [0.10, 0.11, 0.13],
  metallic: 0.7,
  roughness: 0.32,
  clearcoat: 1.0,
  clearcoatRoughness: 0.03,
});

const pad4 = (buf, fill) => {
  const extra = (4 - (buf.length % 4)) % 4;
  return extra ? Buffer.concat([buf, Buffer.alloc(extra, fill)]) : buf;
};

/**
 * @param {Buffer} stl  the kernel's binary body.stl
 * @param {{ source?: object, paint?: typeof PRESENT_PAINT }} [opts]
 * @returns {{ glb: Buffer, sha256: string, triangles: number, vertices: number }}
 */
export function presentGlbFromStl(stl, opts = {}) {
  const mesh = cadSkinMesh(readBinaryStl(stl));
  const paint = { ...PRESENT_PAINT, ...(opts.paint || {}) };
  const nV = mesh.positions.length / 3;
  const pos = Buffer.from(new Float32Array(mesh.positions).buffer);
  const nrm = Buffer.from(new Float32Array(mesh.normals).buffer);
  const idx = Buffer.from(new Uint32Array(mesh.paint).buffer);
  const gltf = {
    asset: {
      version: "2.0",
      generator: `conkay present-glb ${PRESENT_GLB_VERSION}`,
      extras: {
        geometry: "cad.body triangles (welded at 10 µm, no smoothing, nothing added)",
        sourceStlSha256: createHash("sha256").update(stl).digest("hex"),
        glazing: "none: the analysed solid has no glass surface",
        ...(opts.source ? { source: opts.source } : {}),
      },
    },
    extensionsUsed: ["KHR_materials_clearcoat"],
    scene: 0,
    scenes: [{ nodes: [0] }],
    nodes: [{ mesh: 0, name: "body" }],
    materials: [{
      name: "paint",
      pbrMetallicRoughness: {
        baseColorFactor: [...paint.baseColor, 1],
        metallicFactor: paint.metallic,
        roughnessFactor: paint.roughness,
      },
      extensions: { KHR_materials_clearcoat: { clearcoatFactor: paint.clearcoat, clearcoatRoughnessFactor: paint.clearcoatRoughness } },
    }],
    meshes: [{ name: "body", primitives: [{ attributes: { POSITION: 0, NORMAL: 1 }, indices: 2, material: 0 }] }],
    buffers: [{ byteLength: pos.length + nrm.length + idx.length }],
    bufferViews: [
      { buffer: 0, byteOffset: 0, byteLength: pos.length, target: 34962 },
      { buffer: 0, byteOffset: pos.length, byteLength: nrm.length, target: 34962 },
      { buffer: 0, byteOffset: pos.length + nrm.length, byteLength: idx.length, target: 34963 },
    ],
    accessors: [
      { bufferView: 0, componentType: 5126, count: nV, type: "VEC3", min: mesh.bounds.min, max: mesh.bounds.max },
      { bufferView: 1, componentType: 5126, count: nV, type: "VEC3" },
      { bufferView: 2, componentType: 5125, count: mesh.paint.length, type: "SCALAR" },
    ],
  };
  const js = pad4(Buffer.from(JSON.stringify(gltf)), 0x20);
  const bin = pad4(Buffer.concat([pos, nrm, idx]), 0);
  const head = Buffer.alloc(12);
  head.writeUInt32LE(0x46546c67, 0); head.writeUInt32LE(2, 4); head.writeUInt32LE(12 + 8 + js.length + 8 + bin.length, 8);
  const chunk = (len, type) => { const b = Buffer.alloc(8); b.writeUInt32LE(len, 0); b.writeUInt32LE(type, 4); return b; };
  const glb = Buffer.concat([head, chunk(js.length, 0x4e4f534a), js, chunk(bin.length, 0x004e4942), bin]);
  return { glb, sha256: createHash("sha256").update(glb).digest("hex"), triangles: mesh.triangles, vertices: nV };
}

/** Parse a GLB back into { json, bin } (used by the tests and by callers checking an export). */
export function parseGlb(glb) {
  if (glb.readUInt32LE(0) !== 0x46546c67) throw new Error("not a GLB: bad magic");
  if (glb.readUInt32LE(8) !== glb.length) throw new Error("GLB length header does not match the file");
  const jl = glb.readUInt32LE(12);
  if (glb.readUInt32LE(16) !== 0x4e4f534a) throw new Error("GLB first chunk is not JSON");
  const json = JSON.parse(glb.subarray(20, 20 + jl).toString("utf8"));
  const bl = glb.readUInt32LE(20 + jl);
  if (glb.readUInt32LE(24 + jl) !== 0x004e4942) throw new Error("GLB second chunk is not BIN");
  return { json, bin: glb.subarray(28 + jl, 28 + jl + bl) };
}
