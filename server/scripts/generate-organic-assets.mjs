#!/usr/bin/env node
// server/scripts/generate-organic-assets.mjs
//
// Batch front-end for lib/asset-gen/organic/generate-organic.js — the same
// pipeline evo-asset.generate-organic runs inside the server.
//
//   node scripts/generate-organic-assets.mjs --batch B4_monsters [--limit 3]
//   node scripts/generate-organic-assets.mjs --ids mon_sunder_basilisk,mon_tunya_harpy
//   add --force to regenerate ids already in ORGANIC_MANIFEST.json
//   add --concept-only to spend ~5 GPU-s per id on concepts, so each can be
//   checked against the bible before its ~120 GPU-s mesh run
//   add --seeds 0,1,2 (with --concept-only) for several candidates per id —
//   image models handle negations ("no chicken legs") poorly, so picking the
//   best of a few seeds is cheaper than rewriting prompts
//   add --concept-seed N to mesh from an already-reviewed concept_N.png
//
// Stops at the first quota_exhausted (the Hugging Face GPU quota is per
// account, so every later id would fail the same way) and prints what's
// left, so the next run resumes where this one stopped.

import path from "path";
import { fileURLToPath } from "url";
import Database from "better-sqlite3";
import { loadBible } from "../lib/asset-gen/organic/prompts.js";
import { generateOrganicAsset, alreadyGenerated } from "../lib/asset-gen/organic/generate-organic.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const DB_PATH = process.env.DB_PATH || path.join(__dirname, "..", "data", "concord.db");

const argv = process.argv.slice(2);
const arg = (name) => { const i = argv.indexOf(name); return i >= 0 ? argv[i + 1] : undefined; };
const force = argv.includes("--force");
const conceptOnly = argv.includes("--concept-only");
const limit = Number(arg("--limit")) || Infinity;
const seeds = (arg("--seeds") ?? "0").split(",").map((x) => Number(x.trim())).filter(Number.isInteger);
const conceptSeed = arg("--concept-seed") !== undefined ? Number(arg("--concept-seed")) : null;

let ids = arg("--ids")?.split(",").map((s) => s.trim()).filter(Boolean) ?? [];
const batch = arg("--batch");
if (batch) ids = [...loadBible().values()].filter((e) => e.batch === batch).map((e) => e.id);
if (ids.length === 0) {
  console.error("usage: --batch <B4_monsters|...> | --ids a,b [--limit N] [--force]");
  process.exit(2);
}

const generated = await Promise.all(ids.map((id) => (force || conceptOnly ? false : alreadyGenerated(id))));
const todo = ids.filter((_, i) => !generated[i]);
console.log(`${ids.length} ids, ${ids.length - todo.length} already generated, running up to ${Math.min(limit, todo.length)}`);

const db = new Database(DB_PATH);
db.pragma("busy_timeout = 10000");
db.pragma("foreign_keys = ON");

const done = [];
let stopped = null;
const RAW_ROOT = path.join(process.env.DATA_DIR || path.join(__dirname, "..", "data"), "evo-assets", "organic");
for (const id of todo.slice(0, limit)) {
  if (conceptOnly && seeds.length > 1) {
    for (const seed of seeds) {
      const t = Date.now();
      const r = await generateOrganicAsset({ id, db, seed, stopAfter: "concept" });
      console.log(`${id} seed ${seed}: ${r.ok ? `concept ${Math.round((Date.now() - t) / 1000)}s via ${r.stages.concept.provider}` : `FAILED ${r.reason}`}`);
      if (!r.ok && ["quota_exhausted", "bad_token", "no_python_env"].includes(r.reason)) { stopped = r.reason; break; }
    }
    if (stopped) break;
    done.push(id);
    continue;
  }
  const t = Date.now();
  process.stdout.write(`${id} … `);
  const conceptImage = conceptSeed !== null ? path.join(RAW_ROOT, id, `concept_${conceptSeed}.png`) : null;
  const r = await generateOrganicAsset({ id, db, seed: conceptSeed ?? 0, conceptImage, stopAfter: conceptOnly ? "concept" : null, onStage: (s) => process.stdout.write(`${s} `) });
  const secs = Math.round((Date.now() - t) / 1000);
  if (r.ok && conceptOnly) {
    console.log(`concept ${secs}s  ${r.conceptPng}`);
    done.push(id);
  } else if (r.ok) {
    const l = r.stages.lods;
    console.log(`OK ${secs}s  ${l.sourceTris}→${l.lod0Tris}→${l.bands.map((b) => b.tris).join("→")}  via ${r.stages.mesh.provider}`);
    done.push(id);
  } else {
    console.log(`FAILED at ${r.stage}: ${r.reason}${r.error ? ` (${String(r.error).slice(0, 160)})` : ""}`);
    if (["quota_exhausted", "bad_token", "no_python_env"].includes(r.reason)) { stopped = r.reason; break; }
  }
}
db.close();
const remaining = todo.filter((id) => !done.includes(id));
console.log(JSON.stringify({ generated: done, stopped, remaining }, null, 2));
