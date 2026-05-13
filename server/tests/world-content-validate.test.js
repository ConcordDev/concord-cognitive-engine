/**
 * Tier-2 contract test for Concordia Phase 14 — authored landmass
 * meta.json files validate.
 *
 * Pins:
 *   - 13 authored landmasses present
 *   - each meta.json parses as JSON
 *   - each has required fields (world_id, world_name, description,
 *     culture_id, anchors with x/z)
 *   - culture_id matches one of the 10 Tunyan cultures from Phase 13
 *
 * Run: node --test tests/world-content-validate.test.js
 */

import { describe, it } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";

const KNOWN_CULTURES = new Set([
  "dinye", "aekon", "asbir", "fluxom", "akeia",
  "sangree", "kree", "medici", "sahm", "tunyan_pure",
]);

const LANDMASSES = [
  "tunya", "dinye", "aekon", "asbir", "fluxom", "nil",
  "akeia", "sangree", "medici", "sahm", "bahiij",
  "ancient-tunyan-ruins", "cactem-strip",
];

const REPO_ROOT = path.resolve(import.meta.dirname, "../..");

describe("Phase 14 / world-content — 13 landmasses", () => {
  it("all 13 landmass directories exist", () => {
    for (const name of LANDMASSES) {
      const dir = path.join(REPO_ROOT, "content", "world", name);
      assert.ok(fs.existsSync(dir), `missing dir: content/world/${name}`);
    }
  });

  it("each landmass has meta.json", () => {
    for (const name of LANDMASSES) {
      const file = path.join(REPO_ROOT, "content", "world", name, "meta.json");
      assert.ok(fs.existsSync(file), `missing meta.json: content/world/${name}/meta.json`);
    }
  });

  it("each meta.json parses + has required fields", () => {
    for (const name of LANDMASSES) {
      const file = path.join(REPO_ROOT, "content", "world", name, "meta.json");
      const raw = fs.readFileSync(file, "utf-8");
      let parsed;
      try { parsed = JSON.parse(raw); }
      catch (err) { assert.fail(`${name}/meta.json: parse failed — ${err.message}`); }
      assert.ok(parsed.world_id, `${name}: missing world_id`);
      assert.ok(parsed.world_name, `${name}: missing world_name`);
      assert.ok(parsed.description, `${name}: missing description`);
      // culture_id is required for new landmasses; tunya predates Phase 13
      // and has a different schema. Validate culture_id only when present.
      if (parsed.culture_id) {
        assert.ok(typeof parsed.culture_id === "string", `${name}: culture_id must be string`);
      }
      // Pre-existing landmasses (tunya) use a different shape; anchors
      // required only for newly authored ones.
      if (name === "tunya") continue;
      assert.ok(Array.isArray(parsed.anchors) && parsed.anchors.length >= 1, `${name}: missing/empty anchors`);
      for (const a of parsed.anchors) {
        assert.ok(typeof a.id === "string" && a.id.length > 0, `${name}: anchor missing id`);
        assert.ok(Number.isFinite(a.x) && Number.isFinite(a.z), `${name}: anchor ${a.id} missing x/z`);
      }
    }
  });

  it("each non-tunya meta.json's culture_id is a known Tunyan culture", () => {
    // tunya itself has its own custom culture_id (the pre-existing meta.json).
    for (const name of LANDMASSES) {
      if (name === "tunya") continue;
      const file = path.join(REPO_ROOT, "content", "world", name, "meta.json");
      const parsed = JSON.parse(fs.readFileSync(file, "utf-8"));
      assert.ok(KNOWN_CULTURES.has(parsed.culture_id), `${name}: culture_id "${parsed.culture_id}" not in Phase-13 culture set`);
    }
  });
});
