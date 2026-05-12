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
import { registerAsset } from "./registry.js";

const CACHE_DIR = process.env.EVO_ASSET_CACHE_DIR
  || path.join(process.env.DATA_DIR || "./data", "evo-asset-cache");

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

const OS3A_MANIFEST_URL = "https://raw.githubusercontent.com/toxsam/open-source-3D-assets/main/list.json";

export async function bootstrapOS3A(db, { limit = 50 } = {}) {
  const dir = ensureCacheDir("os3a");
  const stats = { fetched: 0, registered: 0, skipped: 0 };

  const res = await safeFetch(OS3A_MANIFEST_URL);
  if (!res) return stats;
  let list;
  try { list = await res.json(); } catch { return stats; }
  if (!Array.isArray(list)) return stats;

  for (const item of list.slice(0, limit)) {
    stats.fetched += 1;
    const id = item?.id ?? item?.name;
    const url = item?.url ?? item?.download;
    if (!id || !url) continue;

    const existing = db.prepare(`SELECT id FROM evo_assets WHERE source = 'os3a' AND source_id = ?`).get(id);
    if (existing) { stats.skipped += 1; continue; }

    const destPath = path.join(dir, `${id}.glb`);
    if (!fs.existsSync(destPath)) {
      const ok = await downloadTo(url, destPath);
      if (!ok) continue;
    }

    registerAsset(db, {
      kind: "mesh",
      source: "os3a",
      sourceId: id,
      localPath: destPath,
      category: item.category ?? null,
      tags: item.tags ?? [],
      qualityLevel: 0, // start at base
    });
    stats.registered += 1;
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
 * Run all available bootstrappers. Caller controls ordering + limits.
 * Designed to be invoked once at server boot (best-effort, behind try/catch).
 */
export async function bootstrapAllSources(db, opts = {}) {
  const out = {};
  try { out.polyhaven = await bootstrapPolyHaven(db, opts.polyhaven ?? {}); } catch { out.polyhaven = { error: true }; }
  try { out.ambientcg = await bootstrapAmbientCG(db, opts.ambientcg ?? {}); } catch { out.ambientcg = { error: true }; }
  try { out.os3a      = await bootstrapOS3A(db, opts.os3a ?? {}); } catch { out.os3a = { error: true }; }
  if (opts.kenneyDir) {
    try { out.kenney = await bootstrapKenneyFromDir(db, opts.kenneyDir, opts.kenney ?? {}); } catch { out.kenney = { error: true }; }
  }
  return out;
}
