#!/usr/bin/env node
// server/scripts/register-external-assets.mjs
//
// Register externally generated 3D assets (Meshy, Tripo) in the evo_assets
// registry and build game-distance LODs for them.
//
//   node scripts/register-external-assets.mjs            # register + LODs
//   node scripts/register-external-assets.mjs --dry-run  # report only
//   node scripts/register-external-assets.mjs --no-lods  # register only
//
// Sources:
//   Meshy — Unity Assets/Concordia/Models/Meshy/MESHY_MANIFEST.json (task
//           ids + prompts pulled from Meshy's own task records).
//   Tripo — Unity Assets/Generated_Models/*/<name>_metadata.json written by
//           AuraForUnity's Tripo integration. FBX only: registered, no LODs
//           (game-lod.js reads GLB).
//
// quality_level is set to 5 — the refinement scheduler's cutoff
// (nextPassFor returns null at >= PASS_ORDER.length). Its passes subdivide
// UP and repack without UVs, which would only degrade a finished textured
// asset. 5 records "do not auto-refine"; it is NOT a claim that the asset
// passed the Atlas quality gate.
//
// Idempotent: registration dedups on (source, source_id); LODs are
// rewritten from the untouched source GLB each run.

import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";
import Database from "better-sqlite3";
import { registerAsset } from "../lib/evo-asset/registry.js";
import { buildGameLods } from "../lib/evo-asset/game-lod.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const SERVER = path.resolve(__dirname, "..");
const UNITY_ASSETS = path.resolve(SERVER, "../apps/concordia-living-world/unity-client/Assets");
const MESHY_DIR = path.join(UNITY_ASSETS, "Concordia/Models/Meshy");
const TRIPO_DIR = path.join(UNITY_ASSETS, "Generated_Models");
const DB_PATH = process.env.DB_PATH || path.join(SERVER, "data/concord.db");
const NO_AUTO_REFINE_QUALITY = 5;

const args = new Set(process.argv.slice(2));
const DRY = args.has("--dry-run");
const LODS = !args.has("--no-lods");

function meshyAssets() {
  const manifestPath = path.join(MESHY_DIR, "MESHY_MANIFEST.json");
  if (!fs.existsSync(manifestPath)) return { manifestPath: null, items: [] };
  const manifest = JSON.parse(fs.readFileSync(manifestPath, "utf8"));
  const items = manifest.assets.map((a) => ({
    source: "meshy",
    sourceId: `meshy:${a.meshy.refine_task_id}`,
    localPath: path.join(UNITY_ASSETS, a.glb.replace(/^Assets\//, "")),
    kind: "mesh",
    category: a.category === "bosses" ? "boss" : "fauna",
    nodeName: a.id,
    tags: [
      "meshy", "ai-generated", `native-bible:${a.id}`, `bible-batch:${a.bible_batch}`,
      ...(a.world_ids || []).map((w) => `world:${w}`),
      "no-auto-refine", "scale:normalized-2-units",
    ],
    manifestEntry: a,
  }));
  return { manifestPath, manifest, items };
}

function tripoAssets() {
  if (!fs.existsSync(TRIPO_DIR)) return [];
  const items = [];
  for (const name of fs.readdirSync(TRIPO_DIR)) {
    const dir = path.join(TRIPO_DIR, name);
    const metaPath = path.join(dir, `${name}_metadata.json`);
    if (!fs.statSync(dir).isDirectory() || !fs.existsSync(metaPath)) continue;
    const meta = JSON.parse(fs.readFileSync(metaPath, "utf8"));
    const model = ["glb", "fbx"].map((ext) => path.join(dir, `${name}.${ext}`)).find((p) => fs.existsSync(p));
    if (!model || !meta.task_id) continue;
    // Category from Tripo's own generation record, not the folder name —
    // the "*Hero" folders are per-world hero LANDMARKS, not characters.
    const desc = String(meta.description || "");
    const category = meta.pose_type && meta.pose_type !== "Default" ? "mount"
      : /landmark|monument|\bhall\b|shrine|archive|\bgate\b|cradle/i.test(desc) ? "landmark"
      : "prop";
    items.push({
      source: "tripo",
      sourceId: `tripo:${meta.task_id}`,
      localPath: model,
      kind: "mesh",
      category,
      nodeName: name,
      tags: ["tripo", "ai-generated", `tripo-model:${meta.model_version || "unknown"}`,
        `format:${path.extname(model).slice(1)}`, "no-auto-refine",
        ...(/^provisional, non-canon/i.test(desc) ? ["provisional-non-canon"] : [])],
    });
  }
  return items;
}

async function main() {
  const { manifestPath, manifest, items: meshy } = meshyAssets();
  const tripo = tripoAssets();
  const all = [...meshy, ...tripo];
  const missing = all.filter((a) => !fs.existsSync(a.localPath));
  if (missing.length) {
    console.error("missing model files:", missing.map((a) => a.localPath));
    process.exitCode = 1;
    return;
  }
  console.log(`found ${meshy.length} meshy + ${tripo.length} tripo assets${DRY ? " (dry run)" : ""}`);
  if (DRY) {
    for (const a of all) console.log(`  ${a.source} ${a.nodeName} -> ${path.relative(SERVER, a.localPath)}`);
    return;
  }

  const db = new Database(DB_PATH);
  db.pragma("busy_timeout = 10000");
  db.pragma("foreign_keys = ON");
  const summary = { registered: 0, existing: 0, lods: 0, lodSkipped: 0 };

  for (const a of all) {
    const reg = registerAsset(db, {
      kind: a.kind, source: a.source, sourceId: a.sourceId, localPath: a.localPath,
      category: a.category, tags: a.tags, qualityLevel: NO_AUTO_REFINE_QUALITY,
    });
    summary[reg.created ? "registered" : "existing"] += 1;

    let lodInfo = null;
    if (LODS && /\.glb$/i.test(a.localPath)) {
      const r = await buildGameLods(a.localPath, { nodeName: a.nodeName });
      if (r.ok) {
        summary.lods += 1;
        lodInfo = {
          file: path.relative(UNITY_ASSETS, r.path).replace(/^/, "Assets/"),
          bytes: r.bytes,
          lod0Tris: r.source.tris,
          bands: r.bands.map((b) => ({ band: b.band, tris: b.tris, achievedRatio: +b.achievedRatio.toFixed(3), maxError: +b.maxError.toFixed(4) })),
        };
      } else {
        summary.lodSkipped += 1;
        lodInfo = { skipped: r.reason };
      }
    } else if (LODS) {
      summary.lodSkipped += 1;
    }
    if (a.manifestEntry) {
      a.manifestEntry.evo_asset_id = reg.id;
      if (lodInfo) a.manifestEntry.lods = lodInfo;
    }
    const lodText = lodInfo?.bands ? ` LOD ${lodInfo.lod0Tris}→${lodInfo.bands.map((b) => b.tris).join("→")}` : lodInfo?.skipped ? ` LOD skipped (${lodInfo.skipped})` : "";
    console.log(`  ${reg.created ? "+" : "="} ${a.source} ${a.nodeName} ${reg.id}${lodText}`);
  }

  if (manifestPath) fs.writeFileSync(manifestPath, JSON.stringify(manifest, null, 2) + "\n");
  db.close();
  console.log(summary);
}

main().catch((err) => { console.error(err); process.exitCode = 1; });
