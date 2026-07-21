// @env-config-ok: intentional external URL references
// @sql-loop-ok: evo-asset boot loaders — startup-only, bounded source count
// @sync-fs-ok: evo asset loaders run from heartbeat, not request handlers
// server/lib/evo-asset/source-loaders.js
// Pluggable loaders for CC0 asset sources. Each loader fetches a manifest,
// downloads any missing assets, and registers them in the EvoAsset registry
// at quality_level = 0.
//
// All loaders are network-dependent and graceful-on-failure: if fetch
// fails (offline, rate-limited, source down), the loader logs and returns
// an empty result. The system keeps running with whatever assets are
// already registered.
//
// Sources (per user direction):
//   1. Kenney.nl — 18,000+ CC0 game-ready assets
//   2. Poly Haven — REST API at https://api.polyhaven.com
//   3. ambientCG — REST API at https://ambientcg.com/api/v3/
//   4. OS3A — JSON manifest at https://github.com/toxsam/open-source-3D-assets
//   5. Sketchfab — deferred (OAuth complication)

import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";
import { registerAsset } from "./registry.js";

const CACHE_DIR = process.env.EVO_ASSET_CACHE_DIR
  || path.join(process.env.DATA_DIR || "./data", "evo-asset-cache");

// Committed offline seed pack — guarantees the evo-asset registry is never
// empty even with zero outbound network access. Override with EVO_SEED_DIR.
const SEED_DIR = process.env.EVO_SEED_DIR
  || path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../../content/evo-seed");

function ensureCacheDir(sub) {
  const dir = path.join(CACHE_DIR, sub);
  try { fs.mkdirSync(dir, { recursive: true }); } catch { /* exists */ }
  return dir;
}

async function safeFetch(url, opts = {}) {
  try {
    const r = await fetch(url, { ...opts, signal: AbortSignal.timeout(15_000) });
    if (!r.ok) return null;
    return r;
  } catch { return null; }
}

async function downloadTo(url, destPath) {
  const res = await safeFetch(url);
  if (!res) return false;
  try {
    const buf = Buffer.from(await res.arrayBuffer());
    await fs.promises.writeFile(destPath, buf);
    return true;
  } catch { return false; }
}

// ─── Poly Haven ─────────────────────────────────────────────────────────

export async function bootstrapPolyHaven(db, { limit = 30 } = {}) {
  const dir = ensureCacheDir("polyhaven");
  const stats = { fetched: 0, registered: 0, skipped: 0 };

  // List all CC0 models. We pick a small subset (limit) so the first
  // bootstrap doesn't hammer the network.
  const list = await safeFetch("https://api.polyhaven.com/assets?type=models");
  if (!list) return stats;
  let manifest;
  try { manifest = await list.json(); } catch { return stats; }
  if (!manifest || typeof manifest !== "object") return stats;

  const ids = Object.keys(manifest).slice(0, limit);
  for (const id of ids) {
    stats.fetched += 1;
    // Skip if already registered.
    const existing = db.prepare(`SELECT id FROM evo_assets WHERE source = 'polyhaven' AND source_id = ?`).get(id);
    if (existing) { stats.skipped += 1; continue; }

    // Get download urls. Pick GLB at 1k resolution to start (Pass 5 can
    // upgrade to a higher-res variant later).
    const filesRes = await safeFetch(`https://api.polyhaven.com/files/${id}`);
    if (!filesRes) continue;
    let files;
    try { files = await filesRes.json(); } catch { continue; }

    const glbUrl = files?.blend?.["1k"]?.glb?.url
      ?? files?.gltf?.["1k"]?.gltf?.url
      ?? null;
    if (!glbUrl) continue;

    const ext = glbUrl.endsWith(".gltf") ? ".gltf" : ".glb";
    const destPath = path.join(dir, `${id}${ext}`);
    if (!fs.existsSync(destPath)) {
      const ok = await downloadTo(glbUrl, destPath);
      if (!ok) continue;
    }

    const meta = manifest[id] || {};
    registerAsset(db, {
      kind: "mesh",
      source: "polyhaven",
      sourceId: id,
      localPath: destPath,
      category: meta.categories?.[0] ?? null,
      tags: meta.tags ?? [],
      qualityLevel: 1, // Poly Haven is already higher than truly raw procedural
    });
    stats.registered += 1;
  }
  return stats;
}

// ─── ambientCG ──────────────────────────────────────────────────────────

export async function bootstrapAmbientCG(db, { limit = 30 } = {}) {
  const dir = ensureCacheDir("ambientcg");
  const stats = { fetched: 0, registered: 0, skipped: 0 };

  const list = await safeFetch(`https://ambientcg.com/api/v2/full_json?type=Material&limit=${limit}`);
  if (!list) return stats;
  let manifest;
  try { manifest = await list.json(); } catch { return stats; }
  const items = Array.isArray(manifest?.foundAssets) ? manifest.foundAssets : [];

  for (const item of items) {
    stats.fetched += 1;
    const id = item.assetId;
    if (!id) continue;
    const existing = db.prepare(`SELECT id FROM evo_assets WHERE source = 'ambientcg' AND source_id = ?`).get(id);
    if (existing) { stats.skipped += 1; continue; }

    const dl = item.downloadFolders?.default?.downloadFiletypeCategories?.zip?.downloads?.[0]?.downloadLink;
    if (!dl) continue;
    const destPath = path.join(dir, `${id}.zip`);
    if (!fs.existsSync(destPath)) {
      const ok = await downloadTo(dl, destPath);
      if (!ok) continue;
    }

    registerAsset(db, {
      kind: "material",
      source: "ambientcg",
      sourceId: id,
      localPath: destPath,
      category: item.category ?? null,
      tags: item.tags ?? [],
      qualityLevel: 2, // ambientCG materials are PBR-ready, start higher
    });
    stats.registered += 1;
  }
  return stats;
}

// ─── OS3A (Open Source 3D Assets) ───────────────────────────────────────
//
// Two-tier manifest (verified against the live repo — the previous
// `list.json` URL 404s; it never existed at that path, so this loader has
// been silently a no-op since it was written):
//   1. data/projects.json — one entry per collection, each with an
//      `asset_data_file` pointing at tier 2.
//   2. data/<asset_data_file> — one entry per model, with a directly
//      downloadable `model_file_url` (raw.githubusercontent.com) and a
//      `metadata.attributes` array of {trait_type, value} pairs (Category/
//      Type/Setting/...) — the closest thing to a taxonomy this source
//      offers. Folded into `tags` best-effort; no reliable per-asset
//      building/vegetation/creature split exists upstream, so category
//      stays the raw OS3A value rather than a guessed evo-asset kind.

const OS3A_PROJECTS_URL = "https://raw.githubusercontent.com/ToxSam/open-source-3D-assets/main/data/projects.json";
const OS3A_ASSET_DATA_BASE = "https://raw.githubusercontent.com/ToxSam/open-source-3D-assets/main/data/";

export async function bootstrapOS3A(db, { limit = 50, projectLimit = 10 } = {}) {
  const dir = ensureCacheDir("os3a");
  const stats = { fetched: 0, registered: 0, skipped: 0 };

  const projectsRes = await safeFetch(OS3A_PROJECTS_URL);
  if (!projectsRes) return stats;
  let projects;
  try { projects = await projectsRes.json(); } catch { return stats; }
  if (!Array.isArray(projects)) return stats;

  for (const project of projects.slice(0, projectLimit)) {
    if (stats.registered >= limit) break;
    const assetDataFile = project?.asset_data_file;
    if (!assetDataFile) continue;

    const assetsRes = await safeFetch(`${OS3A_ASSET_DATA_BASE}${assetDataFile}`);
    if (!assetsRes) continue;
    let items;
    try { items = await assetsRes.json(); } catch { continue; }
    if (!Array.isArray(items)) continue;

    for (const item of items) {
      if (stats.registered >= limit) break;
      stats.fetched += 1;
      const id = item?.id;
      const url = item?.model_file_url;
      if (!id || !url) continue;

      const existing = db.prepare(`SELECT id FROM evo_assets WHERE source = 'os3a' AND source_id = ?`).get(id);
      if (existing) { stats.skipped += 1; continue; }

      const destPath = path.join(dir, `${id}.glb`);
      if (!fs.existsSync(destPath)) {
        const ok = await downloadTo(url, destPath);
        if (!ok) continue;
      }

      const attrs = item?.metadata?.attributes ?? [];
      const tags = attrs.map((a) => a?.value).filter(Boolean);

      registerAsset(db, {
        kind: "mesh",
        source: "os3a",
        sourceId: id,
        localPath: destPath,
        category: project.name ?? project.id ?? null,
        tags,
        qualityLevel: 0, // start at base
      });
      stats.registered += 1;
    }
  }
  return stats;
}

// ─── Kenney ────────────────────────────────────────────────────────────

/**
 * Kenney bootstrap is best-served by a manual operator step (the all-in-1
 * bundle is a multi-GB itch.io download). We expose a simple "scan an
 * already-extracted directory" API so an operator can dump the bundle on
 * disk and have the registry index it.
 */
export async function bootstrapKenneyFromDir(db, dir, { limit = 200 } = {}) {
  const stats = { found: 0, registered: 0 };
  if (!fs.existsSync(dir)) return stats;
  const walk = (d) => {
    let out = [];
    try {
      for (const f of fs.readdirSync(d, { withFileTypes: true })) {
        const p = path.join(d, f.name);
        if (f.isDirectory()) out = out.concat(walk(p));
        else if (/\.(glb|gltf|obj|fbx)$/i.test(f.name)) out.push(p);
      }
    } catch { /* unreadable dir */ }
    return out;
  };
  const files = walk(dir).slice(0, limit);
  for (const file of files) {
    stats.found += 1;
    const id = path.relative(dir, file).replace(/[\\/]/g, "_");
    const existing = db.prepare(`SELECT id FROM evo_assets WHERE source = 'kenney' AND source_id = ?`).get(id);
    if (existing) continue;
    registerAsset(db, {
      kind: "mesh",
      source: "kenney",
      sourceId: id,
      localPath: file,
      category: path.dirname(path.relative(dir, file)).split(path.sep)[0] || null,
      tags: [],
      qualityLevel: 0,
    });
    stats.registered += 1;
  }
  return stats;
}

/**
 * T1.6 — committed offline seed loader. Reads content/evo-seed/manifest.json
 * and registers each bundled CC0 primitive mesh. The whole point: the registry
 * is never empty even fully offline, so runEvolutionTick always has candidates
 * to chew on. The network loaders below are *enrichment on top of this floor*,
 * not the only source. Idempotent via registerAsset's (source, source_id) dedup.
 */
export function bootstrapLocalSeed(db, dir = SEED_DIR) {
  const stats = { found: 0, registered: 0 };
  let manifest;
  try {
    manifest = JSON.parse(fs.readFileSync(path.join(dir, "manifest.json"), "utf8"));
  } catch {
    return stats; // no seed pack present
  }
  for (const entry of (manifest.assets || [])) {
    const file = entry?.file;
    if (!file) continue;
    const localPath = path.join(dir, file);
    if (!fs.existsSync(localPath)) continue;
    stats.found += 1;
    try {
      const r = registerAsset(db, {
        // evo_assets.source CHECK admits 'authored' — the seed primitives are
        // authored CC0 geometry, so this is the honest, schema-valid source.
        kind: entry.kind || "mesh",
        source: "authored",
        sourceId: `seed:${file}`,
        localPath,
        category: entry.category ?? null,
        tags: entry.tags ?? ["seed"],
        qualityLevel: entry.qualityLevel ?? 1,
      });
      if (r?.created) stats.registered += 1;
    } catch { /* registration best-effort */ }
  }
  return stats;
}

// content/evo-seed/world-lens-manifest.json — real, licensed 3D/texture
// assets sourced directly from GitHub repos for the World Lens (weapons,
// terrain photos, buildings, vegetation, creatures, hero character
// meshes), distinct from manifest.json's CC0 primitive placeholder floor.
// Override with EVO_WORLD_LENS_SEED_DIR.
const WORLD_LENS_SEED_DIR = process.env.EVO_WORLD_LENS_SEED_DIR
  || path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../../content/evo-seed");

/**
 * Registers the real, licensed World Lens assets sourced this session
 * (weapons/terrain/buildings/vegetation/creatures/hero archetypes — see
 * concord-frontend/public/models/CREDITS.md +
 * concord-frontend/public/meshes/heroes/CREDITS.md for full per-file
 * provenance) into the evo-asset registry, so the interaction-tracking +
 * refinement-pass scheduler (server/lib/evo-asset/scheduler.js) has real
 * reference material to track and evolve instead of only the 3 CC0
 * primitive placeholder meshes bootstrapLocalSeed provides.
 *
 * `source: 'github'` (migration 373) is the honest tag — these files did
 * not come from Kenney/PolyHaven/ambientCG/OS3A/Sketchfab as platforms,
 * they were downloaded directly from their origin GitHub repos.
 * `sourceId` is `world-lens:<relative-path>` so re-runs dedupe cleanly.
 *
 * Deliberately registers only the 7 universal hero-archetype slots, not
 * all ~46 per-world variant files — those are the same underlying asset
 * reused for cross-world visual identity (see hero-mesh-registry.ts),
 * not distinct assets worth separate evolution tracking.
 *
 * ALSO registers a second `source: 'concordia'` alias row per asset, keyed
 * by the bare filename (no extension, e.g. `tavern` for
 * `models/building/tavern.glb`) — the exact `(source, sourceId)` pair
 * `concord-frontend/lib/world-lens/asset-loader.ts#resolveAssetReference`
 * actually queries (every real call site — BuildingRenderer3D,
 * creature-renderer, resource-node-renderer, weapon-archetypes — omits
 * `source`, which defaults to `"concordia"`, and passes `id` as this bare
 * filename). Without this alias, `resolveCurrentBest` never matched
 * anything registered under the `github`/`world-lens:` key, so a promoted
 * evo-asset refinement of a world-lens GLB could never reach the renderer
 * — the two halves of the pipeline were keyed in different namespaces.
 * The `github`-sourced row is left untouched (still the honest provenance
 * record); this alias is purely a resolution-key bridge to the same file.
 */
export function bootstrapWorldLensAssets(db, dir = WORLD_LENS_SEED_DIR) {
  const stats = { found: 0, registered: 0 };
  let manifest;
  try {
    manifest = JSON.parse(fs.readFileSync(path.join(dir, "world-lens-manifest.json"), "utf8"));
  } catch {
    return stats; // no world-lens seed manifest present
  }
  const publicDir = path.resolve(dir, "..", "..", manifest.publicDir || "concord-frontend/public");
  for (const entry of (manifest.assets || [])) {
    const file = entry?.file;
    if (!file) continue;
    const localPath = path.join(publicDir, file);
    if (!fs.existsSync(localPath)) continue;
    stats.found += 1;
    try {
      const r = registerAsset(db, {
        kind: entry.kind || "mesh",
        source: "github",
        sourceId: `world-lens:${file}`,
        localPath,
        category: entry.category ?? null,
        tags: entry.tags ?? [],
        qualityLevel: entry.qualityLevel ?? 4,
      });
      if (r?.created) stats.registered += 1;
    } catch { /* registration best-effort */ }
    try {
      const bareId = path.basename(file, path.extname(file));
      registerAsset(db, {
        kind: entry.kind || "mesh",
        source: "concordia",
        sourceId: bareId,
        localPath,
        category: entry.category ?? null,
        tags: entry.tags ?? [],
        qualityLevel: entry.qualityLevel ?? 4,
      });
    } catch { /* alias registration best-effort — the github row above is the real record */ }
  }
  return stats;
}

/**
 * Run all available bootstrappers. Caller controls ordering + limits.
 * Designed to be invoked once at server boot (best-effort, behind try/catch).
 *
 * The local seed runs FIRST and unconditionally, so even if every network
 * loader fails (offline / rate-limited / source down) the registry has a
 * guaranteed non-empty floor. Returns a `total` count + `empty` flag so the
 * caller can warn loudly if the engine would otherwise be silently starved.
 */
export async function bootstrapAllSources(db, opts = {}) {
  const out = {};
  try { out.localSeed = bootstrapLocalSeed(db, opts.seedDir ?? SEED_DIR); } catch { out.localSeed = { error: true }; }
  try { out.worldLensAssets = bootstrapWorldLensAssets(db, opts.worldLensSeedDir ?? WORLD_LENS_SEED_DIR); } catch { out.worldLensAssets = { error: true }; }
  try { out.polyhaven = await bootstrapPolyHaven(db, opts.polyhaven ?? {}); } catch { out.polyhaven = { error: true }; }
  try { out.ambientcg = await bootstrapAmbientCG(db, opts.ambientcg ?? {}); } catch { out.ambientcg = { error: true }; }
  try { out.os3a      = await bootstrapOS3A(db, opts.os3a ?? {}); } catch { out.os3a = { error: true }; }
  if (opts.kenneyDir) {
    try { out.kenney = await bootstrapKenneyFromDir(db, opts.kenneyDir, opts.kenney ?? {}); } catch { out.kenney = { error: true }; }
  }
  try {
    out.total = db.prepare(`SELECT COUNT(*) AS c FROM evo_assets`).get().c;
  } catch { out.total = null; }
  out.empty = out.total === 0;
  return out;
}
