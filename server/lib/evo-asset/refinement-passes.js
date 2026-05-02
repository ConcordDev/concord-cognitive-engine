// server/lib/evo-asset/refinement-passes.js
// The 5 refinement passes that take a candidate asset and produce a
// higher-quality variant. Each pass returns a candidate file path + a
// diff summary; the variant must pass the Atlas 5-stage quality gate
// before it gets promoted to canonical.
//
// Passes in order of progressive quality:
//   1. subdivision      — geometry subdivision + recomputed normals
//   2. detail_maps      — vision-LLaVA-driven detail/normal map generation
//   3. material_upgrade — basic → MeshPhysicalMaterial with proper PBR
//   4. procedural_wear  — weathering based on age + interaction history
//   5. higher_lod       — denser mesh variant for closer-distance LOD band
//
// Heavy passes (2, 3, 5) lean on the existing platform substrate:
//   - vision: server/lib/vision-inference.js (LLaVA via Ollama)
//   - image gen: _callMultimodalBrain in server.js (SD/ComfyUI/A1111 local
//     + DALL-E-3 cloud fallback)
//
// All passes are best-effort — failure returns null and the asset stays
// at its current quality level. Promotion is gated downstream.

import fs from "fs";
import path from "path";
import crypto from "crypto";

const EVO_DIR = process.env.EVO_ASSET_DIR
  || path.join(process.env.DATA_DIR || "./data", "evo-assets");

function ensureEvoDir() {
  try { fs.mkdirSync(EVO_DIR, { recursive: true }); } catch { /* exists */ }
}

function evoVariantPath(assetId, passKind, ext) {
  ensureEvoDir();
  const dir = path.join(EVO_DIR, assetId);
  try { fs.mkdirSync(dir, { recursive: true }); } catch { /* exists */ }
  const stamp = Date.now().toString(36);
  return path.join(dir, `${passKind}_${stamp}${ext}`);
}

/**
 * Pass 1 — geometry subdivision.
 *
 * Pure-math pass: applies Loop subdivision to a BufferGeometry-style mesh
 * stored as JSON {positions: number[], indices: number[]}. Server-side this
 * is a CPU operation — no GPU needed. Real frontends would use Three.js's
 * `LoopSubdivisionModifier`; here we ship the math directly so the server
 * can produce candidates without a Three.js dependency.
 *
 * @param {object} mesh    {positions: number[], indices: number[]}
 * @returns {object|null}  {positions: number[], indices: number[], stats: {...}}
 */
export function subdivideGeometry(mesh) {
  if (!mesh?.positions || !mesh?.indices) return null;
  const inPos  = mesh.positions;
  const inIdx  = mesh.indices;
  const triCount = inIdx.length / 3;
  if (triCount === 0) return null;
  // Cap: don't subdivide meshes that would explode. 1500-tri input → 6000-tri output.
  if (triCount > 1500) return null;

  // Loop subdivision: each tri → 4 tris by inserting midpoints on each edge.
  // This is the simplified linear variant (no smoothing weights) — produces
  // the "rounder" variant. Real Loop subdivision averages neighbor verts.
  const outPos = inPos.slice();
  const outIdx = [];
  const midpointCache = new Map();

  function midpointIndex(a, b) {
    const k = a < b ? `${a}_${b}` : `${b}_${a}`;
    const cached = midpointCache.get(k);
    if (cached !== undefined) return cached;
    const ax = inPos[a * 3], ay = inPos[a * 3 + 1], az = inPos[a * 3 + 2];
    const bx = inPos[b * 3], by = inPos[b * 3 + 1], bz = inPos[b * 3 + 2];
    const idx = outPos.length / 3;
    outPos.push((ax + bx) / 2, (ay + by) / 2, (az + bz) / 2);
    midpointCache.set(k, idx);
    return idx;
  }

  for (let i = 0; i < inIdx.length; i += 3) {
    const a = inIdx[i], b = inIdx[i + 1], c = inIdx[i + 2];
    const ab = midpointIndex(a, b);
    const bc = midpointIndex(b, c);
    const ca = midpointIndex(c, a);
    outIdx.push(a, ab, ca, ab, b, bc, ca, bc, c, ab, bc, ca);
  }

  return {
    positions: outPos,
    indices: outIdx,
    stats: {
      inTris: triCount,
      outTris: outIdx.length / 3,
      newVerts: outPos.length / 3 - inPos.length / 3,
    },
  };
}

/**
 * Pass 1 wrapper — read a JSON mesh file, subdivide, write the candidate.
 * Returns the candidate path + diff summary, or null on failure.
 */
export async function runSubdivisionPass(assetId, sourcePath) {
  try {
    const raw = await fs.promises.readFile(sourcePath, "utf8");
    const mesh = JSON.parse(raw);
    const out = subdivideGeometry(mesh);
    if (!out) return null;
    const dest = evoVariantPath(assetId, "subdivision", ".json");
    await fs.promises.writeFile(dest, JSON.stringify({
      positions: out.positions,
      indices: out.indices,
    }));
    return {
      passKind: "subdivision",
      localPath: dest,
      diffSummary: `subdivision ${out.stats.inTris}→${out.stats.outTris} tris (+${out.stats.newVerts} verts)`,
    };
  } catch {
    return null;
  }
}

/**
 * Pass 4 — procedural wear.
 *
 * Pure-math pass that applies vertex-color weathering based on the asset's
 * interaction history + age. No external models needed. Reads a base mesh
 * with optional vertex colors and writes a variant with color-shifted verts
 * (darker/grayer in high-traffic regions).
 *
 * Heuristic: noise-modulated tint toward (#5a5246, gray-brown) scaled by
 * age-in-days/180 + interaction_density. Caps at 0.45 mix so the asset
 * stays recognizable.
 */
export function applyProceduralWear(mesh, { ageDays = 0, interactionDensity = 0 }) {
  if (!mesh?.positions) return null;
  const verts = mesh.positions.length / 3;
  const baseColors = mesh.colors ?? new Array(verts * 3).fill(1.0);
  const out = baseColors.slice();

  const ageFactor = Math.min(1, ageDays / 180);
  const useFactor = Math.min(1, interactionDensity / 100);
  const wearMix = Math.min(0.45, 0.15 + 0.30 * ageFactor + 0.20 * useFactor);

  // Worn target color
  const wr = 0x5a / 255, wg = 0x52 / 255, wb = 0x46 / 255;

  for (let i = 0; i < verts; i++) {
    // Spatial noise — a hash of vertex index for a pseudo-random per-vertex
    // wear amount. Concentrates wear at "high points" by position.y heuristic.
    const y = mesh.positions[i * 3 + 1];
    const hash = Math.abs(Math.sin(i * 12.9898 + y * 78.233) * 43758.5453);
    const local = (hash % 1) * wearMix;
    out[i * 3]     = baseColors[i * 3]     * (1 - local) + wr * local;
    out[i * 3 + 1] = baseColors[i * 3 + 1] * (1 - local) + wg * local;
    out[i * 3 + 2] = baseColors[i * 3 + 2] * (1 - local) + wb * local;
  }

  return {
    positions: mesh.positions,
    indices: mesh.indices,
    colors: out,
    stats: { wearMix, ageFactor, useFactor },
  };
}

export async function runWearPass(assetId, sourcePath, { ageDays, interactionDensity }) {
  try {
    const raw = await fs.promises.readFile(sourcePath, "utf8");
    const mesh = JSON.parse(raw);
    const out = applyProceduralWear(mesh, { ageDays, interactionDensity });
    if (!out) return null;
    const dest = evoVariantPath(assetId, "procedural_wear", ".json");
    await fs.promises.writeFile(dest, JSON.stringify({
      positions: out.positions,
      indices: out.indices,
      colors: out.colors,
    }));
    return {
      passKind: "procedural_wear",
      localPath: dest,
      diffSummary: `wear mix=${out.stats.wearMix.toFixed(2)} (age=${ageDays}d, use=${interactionDensity})`,
    };
  } catch {
    return null;
  }
}

/**
 * Pass 2 — detail / normal maps via vision LLaVA + image gen.
 *
 * Workflow:
 *   1. LLaVA describes the current texture
 *   2. Brain prompt asks "given this description, what details would
 *      improve at higher resolution?"
 *   3. Image-gen produces a higher-detail variant
 *
 * Lean on existing infra: server/lib/vision-inference.js for LLaVA,
 * server.js _callMultimodalBrain for image gen. Pass them in as injected
 * deps so this module stays testable without server boot.
 *
 * Returns null if any step fails — the asset stays at current quality.
 */
export async function runDetailMapsPass(assetId, sourcePath, { callVision, callImageGen }) {
  if (!callVision || !callImageGen) return null;
  try {
    const raw = await fs.promises.readFile(sourcePath);
    const b64 = raw.toString("base64");
    const desc = await callVision(b64,
      "Describe this texture's content, style, and colors in 30 words. " +
      "What additional surface details would make it photorealistic?",
    );
    if (!desc?.ok || !desc.content) return null;

    const prompt = `High-resolution surface texture, photorealistic detail, seamless tiling. ${desc.content}`;
    const gen = await callImageGen({ prompt, size: "1024x1024", quality: "hd" });
    if (!gen?.ok || !gen.imageB64) return null;

    const dest = evoVariantPath(assetId, "detail_maps", ".png");
    await fs.promises.writeFile(dest, Buffer.from(gen.imageB64, "base64"));
    return {
      passKind: "detail_maps",
      localPath: dest,
      diffSummary: `LLaVA-described + image-gen detail upgrade`,
    };
  } catch {
    return null;
  }
}

/**
 * Pass 3 — material upgrade. Server-side this is a metadata change: swap
 * the material spec from basic-color to PBR with roughness+metalness+normal
 * map references. Frontend renderer reads the metadata and picks the right
 * Three.js material class.
 *
 * Stored as JSON metadata file, not a binary. Cheap.
 */
export function runMaterialUpgradePass(assetId, sourcePath, currentMeta = {}) {
  try {
    const upgraded = {
      ...currentMeta,
      shadingModel: "physical",
      roughness: currentMeta.roughness ?? 0.65,
      metalness: currentMeta.metalness ?? 0.0,
      clearcoat: 0.1,
      clearcoatRoughness: 0.4,
      iridescence: 0.0,
      sheen: currentMeta.sheen ?? 0.0,
      // The renderer falls back to procedural normals if no normal map
      // exists yet (Pass 2 may produce one separately).
    };
    const dest = evoVariantPath(assetId, "material_upgrade", ".json");
    fs.writeFileSync(dest, JSON.stringify(upgraded, null, 2));
    return {
      passKind: "material_upgrade",
      localPath: dest,
      diffSummary: "material → MeshPhysicalMaterial spec with PBR params",
    };
  } catch {
    return null;
  }
}

/**
 * Pass 5 — higher LOD variant. Like Pass 1 (subdivision) but applied
 * recursively — produces an even-denser variant for the close-camera band.
 * Reuses subdivideGeometry under the hood.
 */
export async function runHigherLodPass(assetId, sourcePath) {
  try {
    const raw = await fs.promises.readFile(sourcePath, "utf8");
    const mesh = JSON.parse(raw);
    const once = subdivideGeometry(mesh);
    if (!once) return null;
    const twice = subdivideGeometry(once);
    if (!twice) return null;
    const dest = evoVariantPath(assetId, "higher_lod", ".json");
    await fs.promises.writeFile(dest, JSON.stringify({
      positions: twice.positions,
      indices: twice.indices,
    }));
    return {
      passKind: "higher_lod",
      localPath: dest,
      diffSummary: `2x subdivision → ${twice.stats.outTris} tris`,
    };
  } catch {
    return null;
  }
}

/**
 * Dispatch table: given an asset's current quality_level, pick the next
 * pass to run. Earlier passes (cheap, geometry-only) run before later
 * passes (image-gen, material upgrades).
 */
export const PASS_ORDER = [
  "subdivision",
  "material_upgrade",
  "procedural_wear",
  "detail_maps",
  "higher_lod",
];

export function nextPassFor(qualityLevel) {
  if (qualityLevel < 0) return PASS_ORDER[0];
  if (qualityLevel >= PASS_ORDER.length) return null; // already maxed on the easy axis
  return PASS_ORDER[qualityLevel];
}

// helper exported for tests
export const _internal = { evoVariantPath };
