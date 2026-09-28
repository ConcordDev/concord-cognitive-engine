// server/lib/asset-gen/organic/generate-organic.js
//
// Concord's organic asset pipeline: one native-bible id in → a registered,
// in-budget, LOD'd GLB in the Unity project out.
//
//   bible entry ──prompts.js──▶ concept prompt + budget
//   FLUX.1-schnell (HF Space) ──▶ concept image (WebP → PNG via sharp)
//   TRELLIS.2 → TRELLIS (HF Space) ──▶ raw GLB (≥100k faces, WebP textures)
//   glb-normalize.js ──▶ no required extensions, JPEG/PNG textures
//   game-lod.js ──▶ LOD0 at budget + LOD1/LOD2, one shared material
//   evo-asset registry ──▶ source 'trellis' (migration 452), quality 5
//
// Honest by construction: every stage can fail with a named reason
// (quota_exhausted, provider_down, bad_token, no_python_env, …) and a failed
// stage never produces a placeholder asset. Nothing is written into the
// Unity project until the final LOD file exists. Raw provider outputs are
// kept under data/evo-assets/organic/<id>/ for provenance.
//
// What this does NOT do (still open, see docs/CONCORD_ORGANIC_ASSET_PIPELINE.md):
// no automatic fidelity check against the bible's silhouette notes (G3), no
// rigging (G6), no forward-axis/real-world-scale fix (Unity import side).

import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";
import sharp from "sharp";
import { planFor } from "./prompts.js";
import { generateConcept, generateMesh } from "./providers.js";
import { normalizeGlb } from "./glb-normalize.js";
import { buildGameLods } from "../../evo-asset/game-lod.js";
import { registerAsset } from "../../evo-asset/registry.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const SERVER = path.resolve(__dirname, "../../..");
// CONCORD_ORGANIC_UNITY_DIR lets tests (and non-Mac hosts) redirect output away
// from the real Unity project.
export const UNITY_GENERATED = process.env.CONCORD_ORGANIC_UNITY_DIR
  || path.resolve(SERVER, "../apps/concordia-living-world/unity-client/Assets/Concordia/Models/Generated");
const RAW_ROOT = path.join(process.env.DATA_DIR || path.join(SERVER, "data"), "evo-assets", "organic");
export const MANIFEST = path.join(UNITY_GENERATED, "ORGANIC_MANIFEST.json");
const NO_AUTO_REFINE_QUALITY = 5;

// All file I/O here is async: generation runs in-process (evo-asset macros /
// jobs.js), and multi-MB GLB/PNG reads and copies must not block the event loop.
const fsp = fs.promises;

async function exists(p) {
  try { await fsp.access(p); return true; } catch { return false; }
}

async function readManifest() {
  try { return JSON.parse(await fsp.readFile(MANIFEST, "utf8")); }
  catch { return { schema: "concordia-organic-manifest/1", pipeline: "FLUX.1-schnell → TRELLIS.2/TRELLIS → Concord normalize + game-lod", assets: {} }; }
}

async function writeManifest(m) {
  await fsp.mkdir(path.dirname(MANIFEST), { recursive: true });
  await fsp.writeFile(MANIFEST, JSON.stringify(m, null, 2) + "\n");
}

export async function alreadyGenerated(id) {
  const entry = (await readManifest()).assets[id];
  return !!(entry?.lodsFile && await exists(path.join(UNITY_GENERATED, "..", "..", "..", "..", entry.lodsFile)));
}

/**
 * @param {object} opts
 * @param {string} opts.id            native-bible id (e.g. "mon_sunder_basilisk")
 * @param {object} [opts.db]          better-sqlite3 handle; registration skipped when absent
 * @param {number} [opts.seed]
 * @param {"concept"} [opts.stopAfter] generate the concept only (≈5 GPU-s) so it can be
 *                                    checked against the bible before a mesh (≈120 GPU-s)
 * @param {string} [opts.conceptImage] an already-approved concept image; skips the concept stage
 * @param {string} [opts.rawGlb]       an already-generated provider GLB; skips the mesh stage
 * @param {string} [opts.meshProvider] provenance label when `rawGlb` is supplied
 * @param {(stage:string, info?:object)=>void} [opts.onStage]
 * @param {object} [opts.plan]        a pre-built plan (from planForPrompt) that bypasses
 *                                    the native-bible lookup — the ad-hoc/ConKay path.
 *                                    `id` is still required (the caller assigns a
 *                                    synthetic one) since it names the output files.
 */
export async function generateOrganicAsset({
  id, db = null, seed = 0, stopAfter = null, conceptImage = null, rawGlb: suppliedGlb = null,
  meshProvider = null, onStage = () => {}, plan: suppliedPlan = null,
} = {}) {
  const t0 = Date.now();
  const plan = suppliedPlan ?? planFor(id);
  if (!plan.ok) return plan;
  const rawDir = path.join(RAW_ROOT, id);
  await fsp.mkdir(rawDir, { recursive: true });
  const stages = {};
  const conceptPng = path.join(rawDir, `concept_${seed}.png`);

  if (conceptImage) {
    if (!await exists(conceptImage)) return { ok: false, id, stage: "concept", reason: "concept_image_missing" };
    // A reviewed concept from an earlier --concept-only run already IS concept_<seed>.png.
    if (path.resolve(conceptImage) !== path.resolve(conceptPng)) await sharp(conceptImage).png().toFile(conceptPng);
    stages.concept = { ok: true, provider: "supplied", source: path.basename(conceptImage) };
  } else {
    onStage("concept", { prompt: plan.prompt });
    const conceptRaw = path.join(rawDir, `concept_${seed}.img`);
    const concept = await generateConcept({ prompt: plan.prompt, out: conceptRaw, seed });
    stages.concept = { ok: concept.ok, reason: concept.reason, provider: concept.provider, seconds: concept.seconds, format: concept.format };
    if (!concept.ok) return { ok: false, id, stage: "concept", reason: concept.reason, error: concept.error, stages };
    await sharp(conceptRaw).png().toFile(conceptPng);
  }
  if (stopAfter === "concept") return { ok: true, id, stage: "concept", conceptPng, prompt: plan.prompt, stages };

  const rawGlb = path.join(rawDir, `raw_${seed}.glb`);
  if (suppliedGlb) {
    if (!await exists(suppliedGlb)) return { ok: false, id, stage: "mesh", reason: "raw_glb_missing" };
    await fsp.copyFile(suppliedGlb, rawGlb);
    stages.mesh = { ok: true, provider: meshProvider || "supplied", source: path.basename(suppliedGlb) };
  } else {
    onStage("mesh");
    const mesh = await generateMesh({ image: conceptPng, out: rawGlb, seed });
    stages.mesh = { ok: mesh.ok, reason: mesh.reason, provider: mesh.provider, seconds: mesh.seconds, attempts: mesh.attempts?.map((a) => a.reason) };
    if (!mesh.ok) return { ok: false, id, stage: "mesh", reason: mesh.reason, error: mesh.attempts?.at(-1)?.error, stages, conceptPng };
  }

  onStage("normalize");
  const normalized = path.join(rawDir, `normalized_${seed}.glb`);
  const norm = await normalizeGlb(rawGlb, normalized);
  stages.normalize = norm.ok ? { ok: true, converted: norm.converted } : norm;
  if (!norm.ok) return { ok: false, id, stage: "normalize", reason: norm.reason, stages };

  onStage("lods");
  const outDir = path.join(UNITY_GENERATED, plan.category);
  await fsp.mkdir(outDir, { recursive: true });
  const staged = path.join(rawDir, `${id}.glb`);
  await fsp.copyFile(normalized, staged);
  const lods = await buildGameLods(staged, { lod0MaxTris: plan.lod0MaxTris, nodeName: id, outDir: rawDir });
  if (!lods.ok) return { ok: false, id, stage: "lods", reason: lods.reason, stages };
  stages.lods = {
    ok: true, sourceTris: lods.source.tris, lod0Tris: lods.lod0.tris,
    bands: lods.bands.map((b) => ({ band: b.band, tris: b.tris, maxError: +b.maxError.toFixed(4) })),
  };

  // Only now touch the Unity project: final LOD file + concept reference.
  const lodsDest = path.join(outDir, `${id}_lods.glb`);
  const conceptDest = path.join(outDir, `${id}_concept.png`);
  await fsp.copyFile(lods.path, lodsDest);
  await fsp.copyFile(conceptPng, conceptDest);
  const rel = (p) => "Assets/" + path.relative(path.resolve(UNITY_GENERATED, "../../.."), p);

  let evoAssetId = null;
  if (db) {
    const reg = registerAsset(db, {
      kind: "mesh",
      source: "trellis",
      sourceId: `trellis:${id}:${seed}`,
      localPath: lodsDest,
      category: plan.category === "bosses" ? "boss" : plan.category.replace(/s$/, ""),
      tags: [
        "trellis", "ai-generated", "concord-organic-pipeline",
        ...(plan.batch === "adhoc" ? ["conkay-adhoc", ...plan.tags] : [`native-bible:${id}`]),
        `bible-batch:${plan.batch}`,
        ...plan.worldIds.map((w) => `world:${w}`), "no-auto-refine", "scale:normalized", "fidelity:unchecked",
      ],
      qualityLevel: NO_AUTO_REFINE_QUALITY,
    });
    evoAssetId = reg.id;
  }

  const manifest = await readManifest();
  manifest.assets[id] = {
    id, displayName: plan.displayName, batch: plan.batch, category: plan.category, worldIds: plan.worldIds,
    seed, prompt: plan.prompt, lod0MaxTris: plan.lod0MaxTris,
    lodsFile: rel(lodsDest), conceptFile: rel(conceptDest), evoAssetId,
    providers: { concept: stages.concept.provider, mesh: stages.mesh.provider },
    stages, fidelity: "unchecked", generatedAt: new Date().toISOString(),
    license: "FLUX.1-schnell (Apache-2.0) concept; TRELLIS/TRELLIS.2 (MIT) mesh",
  };
  await writeManifest(manifest);

  return { ok: true, id, evoAssetId, lodsFile: lodsDest, conceptFile: conceptDest, stages, seconds: Math.round((Date.now() - t0) / 1000) };
}
