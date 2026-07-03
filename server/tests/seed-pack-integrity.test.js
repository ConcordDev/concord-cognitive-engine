/**
 * Seed-pack integrity — the boot-load contract for the genesis DTU corpus.
 *
 * The server boots the knowledge substrate from data/seed/manifest.json +
 * dtus-*.json (server.js#tryLoadSeedDTUs). That loader HASH-GATES every pack:
 * a pack whose sha256 doesn't match the manifest is silently SKIPPED
 * (console.warn + continue). That gate once dropped ~420 genesis DTUs (part1-7,
 * enriched with real worked examples) because the packs were updated but the
 * 2026-05-07 manifest hashes were not — a silent, boot-time data loss.
 *
 * These tests pin the contract so the drift cannot recur unnoticed:
 *   1. every pack file exists, is a JSON array, and its count matches the manifest;
 *   2. every pack's on-disk sha256 matches the manifest (⇒ the boot loader loads
 *      ALL packs, 0 skipped) — this is the exact check server.js performs;
 *   3. the summed DTU count equals manifest.totalDtus (nothing silently dropped).
 *
 * Repair, if this goes red: `node scripts/regenerate-seed-manifest.mjs` (it
 * validates the packs first, then refreshes the manifest hashes — it never edits
 * pack content). Do NOT "fix" it by running convert-dtus-to-seed-packs.js, which
 * regenerates packs FROM the deprecated dtus.js and would overwrite enrichments.
 *
 * Run: node --test server/tests/seed-pack-integrity.test.js
 */

import { describe, it } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import crypto from "node:crypto";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const SEED_DIR = path.join(__dirname, "..", "data", "seed");
const MANIFEST_PATH = path.join(SEED_DIR, "manifest.json");

const manifest = JSON.parse(fs.readFileSync(MANIFEST_PATH, "utf-8"));

describe("seed-pack integrity — genesis DTU boot-load contract", () => {
  it("is a seed-packs manifest with a pack list", () => {
    assert.equal(manifest.format, "seed-packs");
    assert.ok(Array.isArray(manifest.packs) && manifest.packs.length > 0);
    assert.equal(manifest.packCount, manifest.packs.length);
  });

  it("every pack loads under the boot loader's hash gate (0 skipped) and counts match", () => {
    let totalDtus = 0;
    const skipped = [];
    for (const pack of manifest.packs) {
      const fp = path.join(SEED_DIR, pack.file);
      assert.ok(fs.existsSync(fp), `${pack.file} must exist`);
      const content = fs.readFileSync(fp, "utf-8");

      const entries = JSON.parse(content);
      assert.ok(Array.isArray(entries), `${pack.file} must be a JSON array`);
      if (typeof pack.count === "number") {
        assert.equal(entries.length, pack.count, `${pack.file} DTU count must match manifest`);
      }
      totalDtus += entries.length;

      // The exact gate server.js#tryLoadSeedDTUs applies: a string sha256 that
      // doesn't match ⇒ the pack is skipped at boot. Any skip is a genesis-data
      // regression — fail loudly here instead of losing DTUs silently at runtime.
      const hash = crypto.createHash("sha256").update(content).digest("hex");
      if (typeof pack.sha256 === "string" && hash !== pack.sha256) {
        skipped.push(`${pack.file} (manifest ${pack.sha256.slice(0, 12)}…, disk ${hash.slice(0, 12)}…)`);
      }
    }
    assert.deepEqual(
      skipped, [],
      `these packs would be SKIPPED at boot (hash drift) → run 'node scripts/regenerate-seed-manifest.mjs':\n  ${skipped.join("\n  ")}`,
    );
    assert.equal(
      totalDtus, manifest.totalDtus,
      `summed pack DTUs (${totalDtus}) must equal manifest.totalDtus (${manifest.totalDtus})`,
    );
  });
});
