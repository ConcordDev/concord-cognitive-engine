// server/lib/evo-asset/glb-bridge.js
// Vertex-extraction bridge between binary GLB assets and the pure-math
// refinement passes (subdivision / procedural_wear / higher_lod).
//
// The refinement passes operate on a plain {positions, indices} mesh shape
// (the format the content/evo-seed/*.mesh.json seed primitives use). Real
// world-lens assets ship as binary GLBs, which the passes' own
// fs.readFile(utf8) + JSON.parse can't touch — they throw and get swallowed
// to null. This module closes that gap: extract vertex data out of a GLB,
// let the UNCHANGED pure transforms run, then pack the result back into a
// real GLB.
//
// v1 scope (honest): single-mesh, single-primitive GLBs only. Multi-mesh or
// multi-primitive sources throw a named error (never mangled), and the
// caller's existing try/catch turns that into a clean no-op (null) instead
// of a crash. POSITION is required; missing indices are derived as a
// sequential triangle-soup range (valid, lossless glTF).
//
// Uses @gltf-transform/core (NodeIO + Document) — no GPU, no Three.js dep,
// runs server-side from the evolution heartbeat.

import fs from "fs";
import path from "path";
import { NodeIO, Document } from "@gltf-transform/core";

/**
 * True if the source is a GLB/glTF: extension check first (cheap), then a
 * 4-byte magic-number read ('glTF') as a fallback for extension-less files.
 * Synchronous — used at the top of each pass to branch cleanly.
 *
 * @param {string} sourcePath
 * @returns {boolean}
 */
export function isGlbSource(sourcePath) {
  if (!sourcePath || typeof sourcePath !== "string") return false;
  const ext = path.extname(sourcePath).toLowerCase();
  if (ext === ".glb" || ext === ".gltf") return true;
  // Magic-byte fallback for extension-less files.
  let fd = null;
  try {
    fd = fs.openSync(sourcePath, "r");
    const buf = Buffer.alloc(4);
    const n = fs.readSync(fd, buf, 0, 4, 0);
    return n === 4 && buf.toString("latin1") === "glTF";
  } catch {
    return false;
  } finally {
    if (fd !== null) { try { fs.closeSync(fd); } catch { /* ignore */ } }
  }
}

/**
 * Extract vertex data from a single-primitive GLB.
 *
 * @param {string} glbPath
 * @returns {Promise<{
 *   positions: Float32Array,
 *   indices: Uint32Array,
 *   normals: Float32Array|null,
 *   colors: Float32Array|null,
 *   material: {baseColorFactor:number[], metallicFactor:number, roughnessFactor:number}|null
 * }>}
 * @throws on 0 meshes, >1 mesh, >1 primitive, or missing POSITION — honest,
 *   never mangled. The caller swallows to null per the existing pass pattern.
 */
export async function extractMeshData(glbPath) {
  const doc = await new NodeIO().read(glbPath);
  const meshes = doc.getRoot().listMeshes();
  if (meshes.length === 0) {
    throw new Error(`glb_no_mesh: ${glbPath} contains no meshes`);
  }
  if (meshes.length > 1) {
    const totalPrims = meshes.reduce((s, m) => s + m.listPrimitives().length, 0);
    throw new Error(
      `glb_multi_mesh_unsupported: ${meshes.length} meshes / ${totalPrims} primitives — v1 bridge handles single-primitive GLBs only`,
    );
  }
  const prims = meshes[0].listPrimitives();
  if (prims.length !== 1) {
    throw new Error(
      `glb_multi_mesh_unsupported: 1 mesh / ${prims.length} primitives — v1 bridge handles single-primitive GLBs only`,
    );
  }

  const prim = prims[0];
  const posAcc = prim.getAttribute("POSITION");
  if (!posAcc) {
    throw new Error(`glb_no_position: ${glbPath} primitive has no POSITION attribute`);
  }
  const positions = Float32Array.from(posAcc.getArray());
  const vertCount = positions.length / 3;

  const idxAcc = prim.getIndices();
  let indices;
  if (idxAcc) {
    indices = Uint32Array.from(idxAcc.getArray());
  } else {
    // Non-indexed triangle soup is valid glTF — derive a sequential range.
    indices = new Uint32Array(vertCount);
    for (let i = 0; i < vertCount; i++) indices[i] = i;
  }

  const normAcc = prim.getAttribute("NORMAL");
  const normals = normAcc ? Float32Array.from(normAcc.getArray()) : null;

  const colAcc = prim.getAttribute("COLOR_0");
  let colors = null;
  if (colAcc) {
    const raw = Float32Array.from(colAcc.getArray());
    // COLOR_0 may be VEC4 (rgba) — the wear pass works in rgb, so strip alpha.
    if (colAcc.getType() === "VEC4") {
      const rgb = new Float32Array((raw.length / 4) * 3);
      for (let i = 0, j = 0; i < raw.length; i += 4, j += 3) {
        rgb[j] = raw[i]; rgb[j + 1] = raw[i + 1]; rgb[j + 2] = raw[i + 2];
      }
      colors = rgb;
    } else {
      colors = raw;
    }
  }

  const mat = prim.getMaterial();
  const material = mat
    ? {
        baseColorFactor: mat.getBaseColorFactor(),
        metallicFactor: mat.getMetallicFactor(),
        roughnessFactor: mat.getRoughnessFactor(),
      }
    : null;

  return { positions, indices, normals, colors, material };
}

/**
 * Pack a mesh into a real GLB. Validates geometry before writing so a
 * malformed transform result fails loud (caller try/catches) rather than
 * emitting a corrupt file.
 *
 * @param {object} mesh
 * @param {number[]|Float32Array} mesh.positions
 * @param {number[]|Uint32Array}  mesh.indices
 * @param {number[]|Float32Array} [mesh.normals]
 * @param {number[]|Float32Array} [mesh.colors]   VEC3 vertex colors (rgb)
 * @param {object} [mesh.material] {baseColorFactor, metallicFactor, roughnessFactor}
 * @param {string} outPath
 * @returns {Promise<string>} outPath
 */
export async function packGLB(mesh, outPath) {
  const positions = Float32Array.from(mesh.positions ?? []);
  const indices = Uint32Array.from(mesh.indices ?? []);
  if (positions.length === 0 || positions.length % 3 !== 0) {
    throw new Error(`packGLB_bad_positions: length ${positions.length} not a positive multiple of 3`);
  }
  if (indices.length === 0 || indices.length % 3 !== 0) {
    throw new Error(`packGLB_bad_indices: length ${indices.length} not a positive multiple of 3`);
  }
  const vertCount = positions.length / 3;
  for (let i = 0; i < indices.length; i++) {
    if (indices[i] < 0 || indices[i] >= vertCount) {
      throw new Error(`packGLB_index_oob: index ${indices[i]} at ${i} exceeds vertex count ${vertCount}`);
    }
  }

  const doc = new Document();
  const buf = doc.createBuffer();
  const posAcc = doc.createAccessor().setType("VEC3").setArray(positions).setBuffer(buf);
  const idxAcc = doc.createAccessor().setType("SCALAR").setArray(indices).setBuffer(buf);
  const prim = doc.createPrimitive().setAttribute("POSITION", posAcc).setIndices(idxAcc);

  if (mesh.normals) {
    const normals = Float32Array.from(mesh.normals);
    if (normals.length === positions.length) {
      const normAcc = doc.createAccessor().setType("VEC3").setArray(normals).setBuffer(buf);
      prim.setAttribute("NORMAL", normAcc);
    }
  }

  if (mesh.colors) {
    const colors = Float32Array.from(mesh.colors);
    if (colors.length === vertCount * 3) {
      const colAcc = doc.createAccessor().setType("VEC3").setArray(colors).setBuffer(buf);
      prim.setAttribute("COLOR_0", colAcc);
    }
  }

  const m = mesh.material;
  const mat = doc.createMaterial("evo_material")
    .setBaseColorFactor(Array.isArray(m?.baseColorFactor) && m.baseColorFactor.length === 4
      ? m.baseColorFactor : [1, 1, 1, 1])
    .setMetallicFactor(typeof m?.metallicFactor === "number" ? m.metallicFactor : 0.0)
    .setRoughnessFactor(typeof m?.roughnessFactor === "number" ? m.roughnessFactor : 0.65);
  prim.setMaterial(mat);

  const node = doc.createNode().setMesh(doc.createMesh().addPrimitive(prim));
  doc.createScene().addChild(node);

  await new NodeIO().write(outPath, doc);
  return outPath;
}

/**
 * Compute area-weighted smooth vertex normals for an indexed mesh. Pure
 * helper so subdivided / LOD outputs carry NORMAL instead of relying on
 * client-side flat shading. Exported for tests.
 *
 * @param {number[]|Float32Array} positions
 * @param {number[]|Uint32Array}  indices
 * @returns {Float32Array} one normal per vertex (length === positions.length)
 */
export function computeVertexNormals(positions, indices) {
  const pos = positions instanceof Float32Array ? positions : Float32Array.from(positions);
  const idx = indices instanceof Uint32Array ? indices : Uint32Array.from(indices);
  const normals = new Float32Array(pos.length);

  for (let i = 0; i < idx.length; i += 3) {
    const a = idx[i], b = idx[i + 1], c = idx[i + 2];
    const ax = pos[a * 3], ay = pos[a * 3 + 1], az = pos[a * 3 + 2];
    const bx = pos[b * 3], by = pos[b * 3 + 1], bz = pos[b * 3 + 2];
    const cx = pos[c * 3], cy = pos[c * 3 + 1], cz = pos[c * 3 + 2];
    // Face normal = (b-a) × (c-a); magnitude is proportional to 2× area, so
    // accumulating the un-normalized cross weights each face by its area.
    const e1x = bx - ax, e1y = by - ay, e1z = bz - az;
    const e2x = cx - ax, e2y = cy - ay, e2z = cz - az;
    const nx = e1y * e2z - e1z * e2y;
    const ny = e1z * e2x - e1x * e2z;
    const nz = e1x * e2y - e1y * e2x;
    normals[a * 3] += nx; normals[a * 3 + 1] += ny; normals[a * 3 + 2] += nz;
    normals[b * 3] += nx; normals[b * 3 + 1] += ny; normals[b * 3 + 2] += nz;
    normals[c * 3] += nx; normals[c * 3 + 1] += ny; normals[c * 3 + 2] += nz;
  }

  for (let v = 0; v < normals.length; v += 3) {
    const x = normals[v], y = normals[v + 1], z = normals[v + 2];
    const len = Math.hypot(x, y, z);
    if (len > 1e-8) {
      normals[v] = x / len; normals[v + 1] = y / len; normals[v + 2] = z / len;
    } else {
      normals[v] = 0; normals[v + 1] = 1; normals[v + 2] = 0;
    }
  }
  return normals;
}
