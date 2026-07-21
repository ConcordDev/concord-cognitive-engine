/**
 * bootstrapOS3A pointed at a manifest URL (list.json) that 404s on the real
 * repo — it has been a silent no-op since it was written (safeFetch swallows
 * the failed response and the loader returns empty stats with no error).
 * The real repo is a two-tier manifest: data/projects.json (one entry per
 * collection, each with an asset_data_file) -> data/<asset_data_file> (one
 * entry per model, with a directly downloadable model_file_url). This test
 * pins the fixed two-tier fetch + registration behavior against fixtures
 * shaped exactly like the real, verified API responses.
 */
import { describe, it, beforeEach, afterEach } from "node:test";
import assert from "node:assert/strict";
import Database from "better-sqlite3";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

import { up as up073 } from "../migrations/073_evo_assets.js";
import { bootstrapOS3A } from "../lib/evo-asset/source-loaders.js";

function setupDb() {
  const db = new Database(":memory:");
  up073(db);
  return db;
}

const PROJECTS_FIXTURE = [
  { id: "pm-ca-world", name: "ca-world", asset_data_file: "assets/pm-ca-world.json" },
];
const ASSETS_FIXTURE = [
  {
    id: "ca-world-002",
    name: "Bench_01",
    model_file_url: "https://raw.githubusercontent.com/ToxSam/cc0-models-Polygonal-Mind/main/projects/ca-world/Bench_01.glb",
    metadata: { attributes: [{ trait_type: "Category", value: "Furniture" }, { trait_type: "Setting", value: "Outdoor" }] },
  },
];

const realFetch = global.fetch;
let tmpCacheDir;

beforeEach(() => {
  tmpCacheDir = fs.mkdtempSync(path.join(os.tmpdir(), "evo-os3a-test-"));
  process.env.EVO_ASSET_CACHE_DIR = tmpCacheDir;
});
afterEach(() => {
  global.fetch = realFetch;
  delete process.env.EVO_ASSET_CACHE_DIR;
  fs.rmSync(tmpCacheDir, { recursive: true, force: true });
});

function mockFetch(routes) {
  global.fetch = async (url) => {
    for (const [match, body] of routes) {
      if (url.includes(match)) {
        return { ok: true, json: async () => body, arrayBuffer: async () => new TextEncoder().encode("glb-bytes").buffer };
      }
    }
    // Anything else is treated as a real model-file download (the .glb URLs
    // referenced by the fixtures) — always succeeds with fake bytes.
    if (url.endsWith(".glb")) {
      return { ok: true, arrayBuffer: async () => new TextEncoder().encode("glb-bytes").buffer };
    }
    return { ok: false };
  };
}

describe("bootstrapOS3A (fixed two-tier manifest)", () => {
  it("walks projects.json -> per-collection asset file -> registers real assets", async () => {
    mockFetch([
      ["data/projects.json", PROJECTS_FIXTURE],
      ["data/assets/pm-ca-world.json", ASSETS_FIXTURE],
    ]);
    const db = setupDb();
    const stats = await bootstrapOS3A(db);
    assert.equal(stats.registered, 1);
    const row = db.prepare(`SELECT * FROM evo_assets WHERE source = 'os3a' AND source_id = 'ca-world-002'`).get();
    assert.ok(row, "asset should be registered");
    assert.equal(row.category, "ca-world");
    const tags = JSON.parse(row.tags_json);
    assert.deepEqual(tags, ["Furniture", "Outdoor"]);
  });

  it("is idempotent — re-running does not duplicate", async () => {
    mockFetch([
      ["data/projects.json", PROJECTS_FIXTURE],
      ["data/assets/pm-ca-world.json", ASSETS_FIXTURE],
    ]);
    const db = setupDb();
    await bootstrapOS3A(db);
    const second = await bootstrapOS3A(db);
    assert.equal(second.registered, 0);
    assert.equal(second.skipped, 1);
  });

  it("returns empty stats (not a throw) when projects.json is unreachable", async () => {
    global.fetch = async () => ({ ok: false });
    const db = setupDb();
    const stats = await bootstrapOS3A(db);
    assert.equal(stats.registered, 0);
    assert.equal(stats.fetched, 0);
  });

  it("skips a collection whose asset_data_file 404s but continues to the next collection", async () => {
    const twoProjects = [
      { id: "broken", name: "broken", asset_data_file: "assets/broken.json" },
      { id: "pm-ca-world", name: "ca-world", asset_data_file: "assets/pm-ca-world.json" },
    ];
    mockFetch([
      ["data/projects.json", twoProjects],
      ["data/assets/pm-ca-world.json", ASSETS_FIXTURE],
    ]);
    const db = setupDb();
    const stats = await bootstrapOS3A(db);
    assert.equal(stats.registered, 1, "the reachable collection should still register");
  });
});
