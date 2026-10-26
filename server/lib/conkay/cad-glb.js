// Design-IR and layout meshes → a GLB at real scale.
// 1 GLB unit = 1 mm. Each solid part is its own named node with the
// material it was assigned. Shells and kernel CAD bodies are skipped:
// they are not a unique primitive solid.

import { Document, NodeIO } from "@gltf-transform/core";
import { getMaterial } from "./materials/index.js";
import { geometryVolumeM3 } from "./physics/solvers/mass-cost.js";

export const MASS_NOTE = "No material is assigned on this layout, so mass is not computed.";
const POSITION_NOTE = "position not set; drawn at the origin";
const SKIN_NOTE = "Outer skin only. Thickness is not modelled as a solid.";

const CATEGORY_COLOR = {
  metal: [0.72, 0.75, 0.78],
  polymer: [0.85, 0.78, 0.45],
  plastic: [0.85, 0.78, 0.45],
  composite: [0.25, 0.28, 0.32],
  glass: [0.70, 0.86, 0.92],
  elastomer: [0.18, 0.18, 0.20],
  foam: [0.92, 0.91, 0.86],
  fastener: [0.55, 0.57, 0.60],
};
const DEFAULT_COLOR = [0.58, 0.64, 0.70];

const SKIP = {
  shell: "no unique solid",
  "cad-body": "kernel solid, not a primitive",
};

function designNodes(input) {
  if (Array.isArray(input?.nodes)) return input.nodes;
  if (Array.isArray(input?.design?.nodes)) return input.design.nodes;
  if (Array.isArray(input?.design?.design?.nodes)) return input.design.design.nodes;
  return [];
}

function slug(name) {
  const s = String(name || "part").trim().toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "");
  return s || "part";
}

/** Preserve a unique preset nodeName; otherwise a unique slug of the part name. */
export function assignNodeNames(parts) {
  const used = new Set();
  for (const p of parts) {
    const preset = p.nodeName && !used.has(p.nodeName) ? String(p.nodeName) : null;
    let name = preset || slug(p.name);
    if (!preset) {
      let n = name;
      let i = 2;
      while (used.has(n)) n = `${name}-${i++}`;
      name = n;
    }
    p.nodeName = name;
    used.add(name);
  }
  return parts;
}

export function positionsBBox(positions) {
  let minX = Infinity, minY = Infinity, minZ = Infinity;
  let maxX = -Infinity, maxY = -Infinity, maxZ = -Infinity;
  if (!Array.isArray(positions)) return null;
  for (let i = 0; i < positions.length; i += 3) {
    const x = positions[i], y = positions[i + 1], z = positions[i + 2];
    if (![x, y, z].every(Number.isFinite)) continue;
    if (x < minX) minX = x;
    if (y < minY) minY = y;
    if (z < minZ) minZ = z;
    if (x > maxX) maxX = x;
    if (y > maxY) maxY = y;
    if (z > maxZ) maxZ = z;
  }
  if (!Number.isFinite(minX)) return null;
  return { minX, minY, minZ, maxX, maxY, maxZ, sx: maxX - minX, sy: maxY - minY, sz: maxZ - minZ };
}

function addBox(positions, indices, [cx, cy, cz], [sx, sy, sz]) {
  const x0 = cx - sx / 2, x1 = cx + sx / 2;
  const y0 = cy - sy / 2, y1 = cy + sy / 2;
  const z0 = cz - sz / 2, z1 = cz + sz / 2;
  const v = [[x0, y0, z0], [x1, y0, z0], [x1, y1, z0], [x0, y1, z0], [x0, y0, z1], [x1, y0, z1], [x1, y1, z1], [x0, y1, z1]];
  const quads = [[3, 2, 1, 0], [4, 5, 6, 7], [0, 4, 7, 3], [2, 6, 5, 1], [7, 6, 2, 3], [0, 1, 5, 4]];
  for (const q of quads) {
    const i = positions.length / 3;
    for (const k of q) positions.push(v[k][0], v[k][1], v[k][2]);
    indices.push(i, i + 1, i + 2, i, i + 2, i + 3);
  }
}

function addCylinder(positions, indices, center, radius, length, axis) {
  const seg = 32;
  const h = length / 2;
  const at = (a, along) => {
    const u = Math.cos(a) * radius;
    const w = Math.sin(a) * radius;
    if (axis === "x") return [center[0] + along, center[1] + u, center[2] + w];
    if (axis === "z") return [center[0] + u, center[1] + w, center[2] + along];
    return [center[0] + u, center[1] + along, center[2] + w];
  };
  const base = positions.length / 3;
  for (let i = 0; i < seg; i++) {
    const p = at((i / seg) * Math.PI * 2, -h);
    positions.push(p[0], p[1], p[2]);
  }
  for (let i = 0; i < seg; i++) {
    const p = at((i / seg) * Math.PI * 2, h);
    positions.push(p[0], p[1], p[2]);
  }
  const cap = (sign) => {
    if (axis === "x") return [center[0] + sign * h, center[1], center[2]];
    if (axis === "z") return [center[0], center[1], center[2] + sign * h];
    return [center[0], center[1] + sign * h, center[2]];
  };
  const c0 = positions.length / 3;
  positions.push(...cap(-1), ...cap(1));
  for (let i = 0; i < seg; i++) {
    const j = (i + 1) % seg;
    indices.push(base + i, base + j, base + seg + j, base + i, base + seg + j, base + seg + i);
    indices.push(c0, base + j, base + i);
    indices.push(c0 + 1, base + seg + i, base + seg + j);
  }
}

function addRectTube(positions, indices, c, g, axis) {
  const L = g.length * 1000;
  const W = g.width * 1000;
  const H = g.height * 1000;
  const t = g.wall * 1000;
  const place = (cu, cv, cw, su, sv, sw) => {
    let center;
    let size;
    if (axis === "y") {
      center = [c[0] + cv, c[1] + cu, c[2] + cw];
      size = [sv, su, sw];
    } else if (axis === "z") {
      center = [c[0] + cv, c[1] + cw, c[2] + cu];
      size = [sv, sw, su];
    } else {
      center = [c[0] + cu, c[1] + cv, c[2] + cw];
      size = [su, sv, sw];
    }
    addBox(positions, indices, center, size);
  };
  const innerW = W - 2 * t;
  place(0, -W / 2 + t / 2, 0, L, t, H);
  place(0, W / 2 - t / 2, 0, L, t, H);
  if (innerW > 0 && H - 2 * t > 0) {
    place(0, 0, -H / 2 + t / 2, L, innerW, t);
    place(0, 0, H / 2 - t / 2, L, innerW, t);
  }
}

function addEllipsoid(positions, indices, center, rx, ry, rz) {
  const stacks = 16;
  const slices = 24;
  const base = positions.length / 3;
  for (let i = 0; i <= stacks; i++) {
    const theta = (i / stacks) * Math.PI;
    const st = Math.sin(theta);
    const ct = Math.cos(theta);
    for (let j = 0; j <= slices; j++) {
      const phi = (j / slices) * Math.PI * 2;
      positions.push(
        center[0] + rx * st * Math.cos(phi),
        center[1] + ry * st * Math.sin(phi),
        center[2] + rz * ct,
      );
    }
  }
  const row = slices + 1;
  for (let i = 0; i < stacks; i++) {
    for (let j = 0; j < slices; j++) {
      const a = base + i * row + j;
      const b = a + row;
      indices.push(a, b, a + 1, b, b + 1, a + 1);
    }
  }
}

/** Overall size of a primitive, in millimetres, on x/y/z. */
export function shapeSizeMm(g, axis = "y") {
  if (!g) return null;
  const mm = (m) => m * 1000;
  switch (g.shape) {
    case "box": return { x: mm(g.length), y: mm(g.width), z: mm(g.height) };
    case "plate": return { x: mm(g.length), y: mm(g.width), z: mm(g.thickness) };
    case "cylinder":
    case "rod":
    case "bolt": {
      const d = mm(g.diameter);
      const len = mm(g.length);
      if (axis === "x") return { x: len, y: d, z: d };
      if (axis === "z") return { x: d, y: d, z: len };
      return { x: d, y: len, z: d };
    }
    case "i-beam": return { x: mm(g.length), y: mm(g.height), z: mm(g.flangeWidth) };
    case "rect-tube": {
      if (axis === "y") return { x: mm(g.width), y: mm(g.length), z: mm(g.height) };
      if (axis === "z") return { x: mm(g.width), y: mm(g.height), z: mm(g.length) };
      return { x: mm(g.length), y: mm(g.width), z: mm(g.height) };
    }
    case "ellipsoid-shell": return { x: mm(g.length), y: mm(g.width), z: mm(g.height) };
    default: return null;
  }
}

function tessellate(node) {
  const g = node.geometry;
  const size = shapeSizeMm(g, node.props?.axis || "y");
  if (!size) return null;
  const positions = [];
  const indices = [];
  const placed = node.position && [node.position.x, node.position.y, node.position.z].every(Number.isFinite);
  const c = placed
    ? [node.position.x * 1000, node.position.y * 1000, node.position.z * 1000]
    : [0, 0, 0];
  const axis = node.props?.axis || "y";
  if (g.shape === "box" || g.shape === "plate") {
    addBox(positions, indices, c, [size.x, size.y, size.z]);
  } else if (g.shape === "cylinder" || g.shape === "rod" || g.shape === "bolt") {
    const radius = (g.diameter * 1000) / 2;
    const along = axis === "x" ? "x" : axis === "z" ? "z" : "y";
    addCylinder(positions, indices, c, radius, g.length * 1000, along);
  } else if (g.shape === "i-beam") {
    const L = g.length * 1000;
    const H = g.height * 1000;
    const fw = g.flangeWidth * 1000;
    const ft = g.flangeThickness * 1000;
    const wt = g.webThickness * 1000;
    const webH = Math.max(0, H - 2 * ft);
    addBox(positions, indices, [c[0], c[1] - H / 2 + ft / 2, c[2]], [L, ft, fw]);
    addBox(positions, indices, [c[0], c[1] + H / 2 - ft / 2, c[2]], [L, ft, fw]);
    if (webH > 0) addBox(positions, indices, c, [L, webH, wt]);
  } else if (g.shape === "rect-tube") {
    addRectTube(positions, indices, c, g, axis === "y" || axis === "z" ? axis : "x");
  } else if (g.shape === "ellipsoid-shell") {
    addEllipsoid(positions, indices, c, size.x / 2, size.y / 2, size.z / 2);
  } else {
    return null;
  }
  if (indices.length < 3) return null;
  return { positions, indices, size_mm: size, placed };
}

function partFromNode(node) {
  const g = node.geometry;
  if (!g?.shape) return { skip: null, part: null };
  if (SKIP[g.shape]) return { skip: { id: node.id, name: node.name, reason: SKIP[g.shape] }, part: null };
  const built = tessellate(node);
  if (!built) return { skip: { id: node.id, name: node.name, reason: "not a primitive" }, part: null };
  const mat = node.material ? getMaterial(node.material) : null;
  const density = mat?.densityKgM3 > 0 ? mat.densityKgM3 : null;
  const volumeM3 = geometryVolumeM3(g);
  const massKg = density != null && Number.isFinite(volumeM3) ? volumeM3 * density : null;
  const notes = [];
  if (!built.placed) notes.push(POSITION_NOTE);
  if (g.shape === "ellipsoid-shell") notes.push(SKIN_NOTE);
  return {
    skip: null,
    part: {
      id: node.id,
      name: node.name || node.id,
      nodeName: null,
      shape: g.shape,
      positions: built.positions,
      indices: built.indices,
      size_mm: {
        x: Math.round(built.size_mm.x * 1000) / 1000,
        y: Math.round(built.size_mm.y * 1000) / 1000,
        z: Math.round(built.size_mm.z * 1000) / 1000,
      },
      materialId: mat?.id || null,
      category: mat?.category || null,
      densityKgM3: density,
      volumeM3: Number.isFinite(volumeM3) ? volumeM3 : null,
      massKg,
      note: notes.join(" ") || null,
    },
  };
}

/** Tessellated parts (millimetres) plus the shapes that were not drawn. */
export function designIrParts(input) {
  const parts = [];
  const skipped = [];
  for (const node of designNodes(input)) {
    if (!node?.geometry) continue;
    const { skip, part } = partFromNode(node);
    if (skip) skipped.push(skip);
    else if (part) parts.push(part);
  }
  assignNodeNames(parts);
  return { parts, skipped };
}

function colorOf(part) {
  if (Array.isArray(part.color) && part.color.length >= 3) return part.color;
  return CATEGORY_COLOR[part.category] || DEFAULT_COLOR;
}

/**
 * Named parts → one GLB. Positions are already in the scene unit
 * (millimetres for CAD). Each part is its own node.
 */
export async function partsToGlb(parts, { units = "mm" } = {}) {
  const doc = new Document();
  const buf = doc.createBuffer();
  const scene = doc.createScene("cad");
  doc.getRoot().setDefaultScene(scene);
  const mm = units === "mm";
  scene.setExtras({
    units: units || "mm",
    metersPerUnit: mm ? 0.001 : 1,
    concord: mm ? "conkay-cad" : "unitless",
  });
  const materials = new Map();
  for (const part of parts) {
    const pos = Float32Array.from(part.positions || []);
    const idx = Uint32Array.from(part.indices || []);
    if (pos.length < 9 || idx.length < 3) continue;
    const posAcc = doc.createAccessor().setType("VEC3").setArray(pos).setBuffer(buf);
    const idxAcc = doc.createAccessor().setType("SCALAR").setArray(idx).setBuffer(buf);
    const prim = doc.createPrimitive().setAttribute("POSITION", posAcc).setIndices(idxAcc);
    const key = `${part.materialId || ""}:${part.category || ""}:${colorOf(part).join(",")}`;
    let material = materials.get(key);
    if (!material) {
      const rgb = colorOf(part);
      material = doc.createMaterial(part.materialId || part.category || "part")
        .setBaseColorFactor([rgb[0], rgb[1], rgb[2], 1])
        .setMetallicFactor(part.category === "metal" || part.category === "fastener" ? 0.6 : 0.05)
        .setRoughnessFactor(0.45);
      materials.set(key, material);
    }
    prim.setMaterial(material);
    const node = doc.createNode(part.nodeName || part.name || "part")
      .setMesh(doc.createMesh(part.name || "part").addPrimitive(prim))
      .setExtras({
        name: part.name || null,
        shape: part.shape || null,
        materialId: part.materialId || null,
        densityKgM3: part.densityKgM3 ?? null,
        volumeM3: part.volumeM3 ?? null,
        massKg: part.massKg ?? null,
        size_mm: part.size_mm || null,
        note: part.note || null,
      });
    scene.addChild(node);
  }
  return Buffer.from(await new NodeIO().writeBinary(doc));
}

export async function designIrToGlb(input) {
  const { parts, skipped } = designIrParts(input);
  const glb = parts.length ? await partsToGlb(parts, { units: "mm" }) : null;
  return { glb, parts, skipped };
}

function sliceGeometry(positions, indices, range, scale) {
  const src = indices.slice(range.i0, range.i1);
  const used = new Map();
  const outP = [];
  const outI = [];
  for (const gi of src) {
    let li = used.get(gi);
    if (li == null) {
      li = outP.length / 3;
      used.set(gi, li);
      const o = gi * 3;
      outP.push(positions[o] * scale, positions[o + 1] * scale, positions[o + 2] * scale);
    }
    outI.push(li);
  }
  return { positions: outP, indices: outI };
}

/**
 * Chat mesh artifact → GLB bytes. Metre positions with units "mm" are
 * scaled ×1000. Positions that are already millimetres (a sized TRELLIS
 * mesh) are not scaled again.
 */
export async function glbFromMeshArtifact(artifact) {
  const positions = artifact?.positions;
  const indices = artifact?.indices;
  if (!Array.isArray(positions) || !Array.isArray(indices)) throw new Error("bad_positions");
  const scale = artifact.geometryUnits === "m" && artifact.units === "mm" ? 1000 : 1;
  const units = artifact.units === "mm" ? "mm" : (artifact.units || "unitless");
  const ranges = Array.isArray(artifact.partRanges) ? artifact.partRanges.filter((r) => Number.isFinite(r?.i0) && r.i1 > r.i0) : [];
  const parts = [];
  if (ranges.length) {
    for (const r of ranges) {
      const geom = sliceGeometry(positions, indices, r, scale);
      if (geom.indices.length < 3) continue;
      parts.push({
        name: r.name || "part",
        nodeName: r.nodeName || r.name || "part",
        shape: r.shape || null,
        positions: geom.positions,
        indices: geom.indices,
        size_mm: r.size_mm || null,
        materialId: r.materialId || null,
        category: r.category || null,
        densityKgM3: r.densityKgM3 ?? null,
        volumeM3: r.volumeM3 ?? null,
        massKg: r.massKg ?? null,
      });
    }
  }
  if (!parts.length) {
    parts.push({
      name: artifact.title || "mesh",
      nodeName: "mesh",
      positions: scale === 1 ? positions : positions.map((n) => n * scale),
      indices,
    });
  }
  return partsToGlb(parts, { units });
}

/** World-space bounding box of a GLB, in the file's own units. */
export async function glbExtents(glb) {
  const doc = await new NodeIO().readBinary(new Uint8Array(glb));
  const scene = doc.getRoot().getDefaultScene() || doc.getRoot().listScenes()[0];
  const min = [Infinity, Infinity, Infinity];
  const max = [-Infinity, -Infinity, -Infinity];
  const names = [];
  const visit = (node) => {
    const mesh = node.getMesh();
    if (mesh) {
      names.push(node.getName() || "");
      const M = node.getWorldMatrix();
      for (const prim of mesh.listPrimitives()) {
        const pos = prim.getAttribute("POSITION");
        if (!pos) continue;
        const v = [0, 0, 0];
        for (let i = 0; i < pos.getCount(); i++) {
          pos.getElement(i, v);
          const x = M[0] * v[0] + M[4] * v[1] + M[8] * v[2] + M[12];
          const y = M[1] * v[0] + M[5] * v[1] + M[9] * v[2] + M[13];
          const z = M[2] * v[0] + M[6] * v[1] + M[10] * v[2] + M[14];
          if (x < min[0]) min[0] = x;
          if (y < min[1]) min[1] = y;
          if (z < min[2]) min[2] = z;
          if (x > max[0]) max[0] = x;
          if (y > max[1]) max[1] = y;
          if (z > max[2]) max[2] = z;
        }
      }
    }
    for (const child of node.listChildren()) visit(child);
  };
  if (scene) for (const n of scene.listChildren()) visit(n);
  return {
    min, max, names,
    size: [max[0] - min[0], max[1] - min[1], max[2] - min[2]],
  };
}

function sizeList(size) {
  if (!Array.isArray(size) || size.length < 3) return null;
  return { x: size[0], y: size[1], z: size[2] };
}

/** Fields a robot/concept layout mesh needs so the GLB is millimetres per part. */
export function layoutMeshFields(mesh, assemblyParts) {
  const slices = Array.isArray(mesh?.parts) ? mesh.parts : [];
  const parts = (assemblyParts || []).map((p, i) => {
    const sl = slices[i] || {};
    return {
      name: p.name,
      shape: p.shape || sl.shape || null,
      nodeName: null,
      size_mm: sizeList(p.size_mm),
      v0: sl.v0,
      v1: sl.v1,
      i0: sl.i0,
      i1: sl.i1,
    };
  });
  assignNodeNames(parts);
  const partRanges = parts
    .filter((p) => Number.isFinite(p.i0) && Number.isFinite(p.i1) && p.i1 > p.i0)
    .map((p) => ({
      v0: p.v0,
      v1: p.v1,
      i0: p.i0,
      i1: p.i1,
      name: p.name,
      nodeName: p.nodeName,
      size_mm: p.size_mm,
      shape: p.shape,
    }));
  return {
    geometryUnits: "m",
    units: "mm",
    partRanges,
    engineering: { massKg: null, massNote: MASS_NOTE },
  };
}

/** A solved beam is metres, length along Z. Extents only — not a long/tall/wide bbox. */
export function solvedPartMeshFields(mesh) {
  const bb = positionsBBox(mesh?.positions);
  const mm = (n) => Math.round(n * 1000 * 1000) / 1000;
  return {
    geometryUnits: "m",
    units: "mm",
    ...(bb ? { extents_mm: { x: mm(bb.sx), y: mm(bb.sy), z: mm(bb.sz) } } : {}),
  };
}
