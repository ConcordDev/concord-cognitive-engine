// server/lib/evo-asset/game-lod.js
//
// Game-distance LODs for externally generated, already-textured GLBs
// (Meshy / Tripo / a future image-to-3D provider). The complement of
// refinement-passes.js, not a replacement:
//
//   refinement-passes.js  — subdivides UP (higher_lod = 2x subdivision) and
//                           repacks positions/indices/normals only. Correct
//                           for Concord's own untextured seed meshes; WRONG
//                           for a textured external asset (it drops
//                           TEXCOORD_0, so the texture set is orphaned, and it
//                           refuses anything over 1500 input tris anyway).
//   game-lod.js           — decimates DOWN for the far-camera bands
//                           (bible PERFORMANCE.md: "LODs + impostors for
//                           anything > 60m"), keeping every vertex attribute
//                           and the material/texture graph intact.
//
// Output is ONE .glb holding `<node>_LOD0` (the original, or — when
// `lod0MaxTris` is set and exceeded — the original decimated to that
// budget) plus `<node>_LOD1..N` as sibling nodes that all reference the SAME
// material, so
// the texture set is stored and uploaded once. Writing a separate file per
// band would embed a full copy of the textures in each (Meshy's three 2k
// JPEGs are ~95% of a GLB's bytes) and triple texture memory in Unity.
// The `_LODn` suffix is the naming convention Unity-side tooling builds a
// LODGroup from.
//
// Mechanism: meshoptimizer's attribute-aware simplifier rewrites only the
// index buffer, so every surviving vertex keeps its original UV/normal;
// compactMesh then drops unreferenced vertices. `Permissive` is required for
// AI-generated meshes: Meshy's UV atlas is fragmented enough that ~60% of
// vertices are seam duplicates, and without it the simplifier refuses to go
// below ~52% of the source (measured on faun_court_pigeon). The UV term in
// the error metric still penalizes collapses that would smear the texture.
//
// Honest-by-construction: the simplifier stops early when collapsing more
// would exceed the error bound (a fraction of the mesh extent), so a band
// can land ABOVE its requested ratio. Results report the achieved triangle
// count and error; they never claim the requested ratio was hit.

import fs from "fs";
import path from "path";
import { NodeIO } from "@gltf-transform/core";
import { MeshoptSimplifier } from "meshoptimizer";

const TRIANGLES = 4; // glTF primitive mode
const UNUSED = 0xffffffff;

// Weights for the attribute-aware error metric. Normals keep shading from
// faceting; the UV term keeps collapses from visibly sliding the texture.
const NORMAL_WEIGHT = 0.25;
const UV_WEIGHT = 1.0;

export const DEFAULT_LOD_RATIOS = Object.freeze([0.5, 0.2]);
export const DEFAULT_TARGET_ERROR = 0.05; // 5% of mesh extent

/** Count triangles + vertices across every triangle primitive in a document. */
export function measureDocument(doc) {
  let tris = 0;
  let verts = 0;
  for (const mesh of doc.getRoot().listMeshes()) {
    for (const prim of mesh.listPrimitives()) {
      if (prim.getMode() !== TRIANGLES) continue;
      const idx = prim.getIndices();
      const pos = prim.getAttribute("POSITION");
      tris += idx ? idx.getCount() / 3 : (pos?.getCount() ?? 0) / 3;
      verts += pos?.getCount() ?? 0;
    }
  }
  return { tris, verts };
}

function floatPositions(acc) {
  const arr = acc.getArray();
  if (arr instanceof Float32Array && !acc.getNormalized()) return arr;
  const n = acc.getCount();
  const out = new Float32Array(n * 3);
  const el = [0, 0, 0];
  for (let v = 0; v < n; v += 1) { acc.getElement(v, el); out.set(el, v * 3); }
  return out;
}

function packAttributes(prim, vertexCount) {
  const normal = prim.getAttribute("NORMAL");
  const uv = prim.getAttribute("TEXCOORD_0");
  const stride = (normal ? 3 : 0) + (uv ? 2 : 0);
  if (stride === 0) return null;
  const out = new Float32Array(vertexCount * stride);
  const weights = [];
  if (normal) weights.push(NORMAL_WEIGHT, NORMAL_WEIGHT, NORMAL_WEIGHT);
  if (uv) weights.push(UV_WEIGHT, UV_WEIGHT);
  const n = [0, 0, 0];
  const t = [0, 0];
  for (let v = 0; v < vertexCount; v += 1) {
    let o = v * stride;
    if (normal) { normal.getElement(v, n); out[o++] = n[0]; out[o++] = n[1]; out[o++] = n[2]; }
    if (uv) { uv.getElement(v, t); out[o++] = t[0]; out[o++] = t[1]; }
  }
  return { data: out, stride, weights };
}

/**
 * Build a decimated copy of one triangle primitive as a NEW primitive in the
 * same document (new accessors, same material). The source is not modified.
 */
function decimatedPrimitive(doc, prim, ratio, targetError) {
  if (prim.getMode() !== TRIANGLES) return { skipped: "non_triangle_mode" };
  const posAcc = prim.getAttribute("POSITION");
  if (!posAcc) return { skipped: "no_position" };
  const vertexCount = posAcc.getCount();
  const idxAcc = prim.getIndices();
  const indices = idxAcc
    ? Uint32Array.from(idxAcc.getArray())
    : Uint32Array.from({ length: vertexCount }, (_, i) => i);
  const srcTris = indices.length / 3;
  const positions = floatPositions(posAcc);
  const targetIndexCount = Math.max(3, Math.floor(srcTris * ratio) * 3);

  const attrs = packAttributes(prim, vertexCount);
  const [simplified, error] = attrs
    ? MeshoptSimplifier.simplifyWithAttributes(
        indices, positions, 3, attrs.data, attrs.stride, attrs.weights,
        null, targetIndexCount, targetError, ["Permissive"],
      )
    : MeshoptSimplifier.simplify(indices, positions, 3, targetIndexCount, targetError, ["Permissive"]);
  if (simplified.length === 0) return { skipped: "collapsed_to_empty" };

  const [remap, unique] = MeshoptSimplifier.compactMesh(simplified);
  const buffer = posAcc.getBuffer();
  const out = doc.createPrimitive().setMode(TRIANGLES).setMaterial(prim.getMaterial());
  for (const semantic of prim.listSemantics()) {
    const acc = prim.getAttribute(semantic);
    const size = acc.getElementSize();
    const src = acc.getArray();
    const dst = new src.constructor(unique * size);
    for (let v = 0; v < vertexCount; v += 1) {
      const to = remap[v];
      if (to === UNUSED) continue;
      for (let c = 0; c < size; c += 1) dst[to * size + c] = src[v * size + c];
    }
    out.setAttribute(semantic, doc.createAccessor()
      .setType(acc.getType()).setNormalized(acc.getNormalized()).setArray(dst).setBuffer(buffer));
  }
  const outIndices = unique <= 0xffff ? Uint16Array.from(simplified) : simplified;
  out.setIndices(doc.createAccessor().setType("SCALAR").setArray(outIndices).setBuffer(buffer));
  return { primitive: out, srcTris, tris: simplified.length / 3, verts: unique, error };
}

/**
 * Write `<base>_lods.glb` next to (or instead of `outDir`) the source: the
 * original mesh as `_LOD0` plus one decimated sibling node per ratio, all
 * sharing the source material + textures. The source file is not modified.
 *
 * @param {string} srcPath - source .glb
 * @param {object} [opts]
 * @param {number[]} [opts.ratios]      - target triangle fractions, e.g. [0.5, 0.2]
 * @param {number}   [opts.targetError] - max error, fraction of mesh extent
 * @param {string}   [opts.outDir]      - defaults to the source's directory
 * @param {string}   [opts.nodeName]    - node base name when the GLB has one mesh node
 * @param {number}   [opts.lod0MaxTris] - if the source exceeds this, LOD0 itself is
 *                                        decimated to it and band ratios apply to that
 * @returns {Promise<{ ok:boolean, reason?:string, path?:string, bytes?:number,
 *   source?:{tris:number,verts:number}, bands?:Array }>}
 */
export async function buildGameLods(srcPath, opts = {}) {
  const ratios = Array.isArray(opts.ratios) && opts.ratios.length ? opts.ratios : DEFAULT_LOD_RATIOS;
  const targetError = Number.isFinite(opts.targetError) ? opts.targetError : DEFAULT_TARGET_ERROR;
  if (!/\.glb$/i.test(String(srcPath))) return { ok: false, reason: "not_glb" };
  if (!fs.existsSync(srcPath)) return { ok: false, reason: "source_missing" };
  for (const r of ratios) {
    if (!(r > 0 && r < 1)) return { ok: false, reason: "ratio_out_of_range", ratio: r };
  }

  await MeshoptSimplifier.ready;
  const io = new NodeIO();
  const doc = await io.read(srcPath);
  const source = measureDocument(doc);
  if (source.tris === 0) return { ok: false, reason: "no_triangles" };

  const root = doc.getRoot();
  const scene = root.getDefaultScene() || root.listScenes()[0];
  const meshNodes = root.listNodes().filter((n) => n.getMesh());
  if (meshNodes.length === 0) return { ok: false, reason: "no_mesh_nodes" };

  // Over-budget sources (TRELLIS.2 exports ≥ 100k faces) are brought to the
  // LOD0 budget first; the bands are then fractions of that budgeted LOD0.
  const lod0 = { tris: source.tris, verts: source.verts, maxError: 0, decimated: false };
  const lod0MaxTris = Number(opts.lod0MaxTris);
  if (Number.isFinite(lod0MaxTris) && lod0MaxTris > 0 && source.tris > lod0MaxTris) {
    const ratio = lod0MaxTris / source.tris;
    for (const node of meshNodes) {
      const mesh = node.getMesh();
      for (const prim of mesh.listPrimitives()) {
        const r = decimatedPrimitive(doc, prim, ratio, targetError);
        if (r.skipped) continue;
        const old = [prim.getIndices(), ...prim.listAttributes()].filter(Boolean);
        mesh.removePrimitive(prim);
        mesh.addPrimitive(r.primitive);
        prim.dispose();
        // Drop the full-resolution buffers so they are not written out.
        for (const acc of old) if (acc.listParents().every((p) => p === root)) acc.dispose();
        lod0.maxError = Math.max(lod0.maxError, r.error);
      }
    }
    const m = measureDocument(doc);
    Object.assign(lod0, { tris: m.tris, verts: m.verts, decimated: true });
  }

  const bands = ratios.map((ratio, i) => ({
    band: i + 1, requestedRatio: ratio, tris: 0, verts: 0, maxError: 0, skipped: [],
  }));

  // Meshy/Tripo name their single node something generic ("mesh"); a caller
  // that knows the asset id passes it so the bands read `<id>_LODn`.
  const nameOverride = meshNodes.length === 1 && typeof opts.nodeName === "string" && opts.nodeName
    ? opts.nodeName : null;

  for (const node of meshNodes) {
    const mesh = node.getMesh();
    const baseName = nameOverride || node.getName() || mesh.getName() || "mesh";
    const parent = node.getParentNode();
    ratios.forEach((ratio, i) => {
      const lodMesh = doc.createMesh(`${mesh.getName() || baseName}_LOD${i + 1}`);
      for (const prim of mesh.listPrimitives()) {
        const r = decimatedPrimitive(doc, prim, ratio, targetError);
        if (r.skipped) { bands[i].skipped.push(r.skipped); continue; }
        lodMesh.addPrimitive(r.primitive);
        bands[i].tris += r.tris;
        bands[i].verts += r.verts;
        bands[i].maxError = Math.max(bands[i].maxError, r.error);
      }
      const lodNode = doc.createNode(`${baseName}_LOD${i + 1}`)
        .setMesh(lodMesh)
        .setTranslation(node.getTranslation())
        .setRotation(node.getRotation())
        .setScale(node.getScale());
      if (parent) parent.addChild(lodNode);
      else scene.addChild(lodNode);
    });
    node.setName(`${baseName}_LOD0`);
  }

  const outDir = opts.outDir || path.dirname(srcPath);
  const base = path.basename(srcPath, path.extname(srcPath));
  const dest = path.join(outDir, `${base}_lods.glb`);
  await io.write(dest, doc);
  for (const b of bands) b.achievedRatio = b.tris / lod0.tris;
  return { ok: true, path: dest, bytes: fs.statSync(dest).size, source, lod0, bands };
}
