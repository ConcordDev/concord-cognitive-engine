#!/usr/bin/env node
// scripts/regenerate-seed-manifest.mjs
//
// Recompute the seed-pack manifest's per-pack sha256 + sizeKB from the CURRENT
// pack files, WITHOUT ever touching pack content. This is the safe repair for
// the drift where the packs were enriched (e.g. [WAVE1] example placeholders
// filled with real worked examples) but the 2026-05-07 manifest hashes were
// never regenerated — so the boot loader (server.js#tryLoadSeedDTUs) silently
// SKIPPED every hash-mismatched pack, dropping ~420 genesis DTUs at startup.
//
// It is deliberately NOT `convert-dtus-to-seed-packs.js` (which regenerates the
// packs FROM the deprecated dtus.js and would OVERWRITE the enriched examples
// with placeholders). This script trusts the packs and only fixes the manifest.
//
// Safety: it validates each pack first (parseable JSON array + DTU count matches
// the manifest's recorded `count`). If any pack fails validation it ABORTS and
// changes nothing — a corrupted/truncated pack must never be blessed with a new
// hash. Pass --check to validate + report drift without writing.
//
// Usage:
//   node scripts/regenerate-seed-manifest.mjs           # rewrite the manifest
//   node scripts/regenerate-seed-manifest.mjs --check    # dry-run: report only

import fs from "node:fs";
import path from "node:path";
import crypto from "node:crypto";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const SEED_DIR = path.join(__dirname, "..", "data", "seed");
const MANIFEST_PATH = path.join(SEED_DIR, "manifest.json");
const CHECK_ONLY = process.argv.includes("--check");
// A stable regen timestamp (avoids embedding a run-time Date; pass CONCORD_SEED_STAMP to override).
const STAMP = process.env.CONCORD_SEED_STAMP || "2026-07-02T00:00:00.000Z";

function sha256(buf) { return crypto.createHash("sha256").update(buf).digest("hex"); }

function main() {
  const manifest = JSON.parse(fs.readFileSync(MANIFEST_PATH, "utf-8"));
  if (manifest.format !== "seed-packs" || !Array.isArray(manifest.packs)) {
    console.error("[regen] not a seed-packs manifest — aborting");
    process.exit(1);
  }

  const problems = [];
  const changed = [];
  let totalDtus = 0;

  for (const pack of manifest.packs) {
    const fp = path.join(SEED_DIR, pack.file);
    if (!fs.existsSync(fp)) { problems.push(`${pack.file}: MISSING`); continue; }
    const content = fs.readFileSync(fp, "utf-8");

    // Validate: must be a JSON array, and its DTU count must match the manifest.
    let entries;
    try { entries = JSON.parse(content); }
    catch (e) { problems.push(`${pack.file}: not valid JSON (${e.message})`); continue; }
    if (!Array.isArray(entries)) { problems.push(`${pack.file}: not a JSON array`); continue; }
    if (typeof pack.count === "number" && entries.length !== pack.count) {
      problems.push(`${pack.file}: count drift — manifest says ${pack.count}, file has ${entries.length}`);
      continue;
    }
    totalDtus += entries.length;

    const newHash = sha256(content);
    const newSize = Math.round((Buffer.byteLength(content, "utf-8") / 1024) * 10) / 10;
    if (pack.sha256 !== newHash) changed.push(`${pack.file}: ${String(pack.sha256).slice(0, 12)}… → ${newHash.slice(0, 12)}…`);
    pack.sha256 = newHash;
    pack.sizeKB = newSize;
    pack.count = entries.length;
  }

  if (problems.length) {
    console.error("[regen] ABORT — pack validation failed (no changes written):");
    for (const p of problems) console.error("   ✗ " + p);
    process.exit(1);
  }

  // Cross-check the declared total against the summed reality.
  if (typeof manifest.totalDtus === "number" && manifest.totalDtus !== totalDtus) {
    console.warn(`[regen] totalDtus corrected: ${manifest.totalDtus} → ${totalDtus}`);
  }
  manifest.totalDtus = totalDtus;
  manifest.packCount = manifest.packs.length;
  manifest.generatedAt = STAMP;

  console.log(`[regen] ${manifest.packs.length} packs · ${totalDtus} DTUs · ${changed.length} hash(es) refreshed`);
  for (const c of changed) console.log("   • " + c);

  if (CHECK_ONLY) {
    console.log(changed.length ? "[regen] --check: manifest is STALE (run without --check to fix)" : "[regen] --check: manifest is up to date");
    process.exit(changed.length ? 2 : 0);
  }

  fs.writeFileSync(MANIFEST_PATH, JSON.stringify(manifest, null, 2) + "\n", "utf-8");
  console.log(`[regen] wrote ${path.relative(path.join(__dirname, ".."), MANIFEST_PATH)}`);
}

main();
