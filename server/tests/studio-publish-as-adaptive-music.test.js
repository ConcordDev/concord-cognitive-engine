// Contract test for the studio → adaptive-music content-engine bridge.

import { describe, it, before, beforeEach, after } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import os from "node:os";
import Database from "better-sqlite3";
import registerStudioActions from "../domains/studio.js";

const ACTIONS = new Map();
function register(domain, name, fn) { ACTIONS.set(`${domain}.${name}`, fn); }
function call(name, ctx, params = {}) {
  const fn = ACTIONS.get(`studio.${name}`);
  assert.ok(fn, `studio.${name} not registered`);
  return fn(ctx, { id: null, data: {}, meta: {} }, params);
}

const tinyAudio = Buffer.alloc(100, 0x7f).toString("base64");
const TINY_WAV_DATA_URL = `data:audio/wav;base64,${tinyAudio}`;

let tmpDataDir;
let db;

before(() => {
  registerStudioActions(register);
  tmpDataDir = fs.mkdtempSync(path.join(os.tmpdir(), "concord-studio-pub-"));
  process.env.DATA_DIR = tmpDataDir;
});

after(() => {
  try { fs.rmSync(tmpDataDir, { recursive: true, force: true }); } catch { /* idempotent */ }
  delete process.env.DATA_DIR;
});

beforeEach(() => {
  globalThis._concordSTATE = {};
  globalThis._concordSaveStateDebounced = () => {};
  db = new Database(":memory:");
  db.exec(`
    CREATE TABLE dtus (
      id TEXT PRIMARY KEY,
      owner_user_id TEXT,
      title TEXT NOT NULL DEFAULT 'Untitled',
      body_json TEXT NOT NULL DEFAULT '{}',
      tags_json TEXT NOT NULL DEFAULT '[]',
      visibility TEXT NOT NULL DEFAULT 'private'
        CHECK (visibility IN ('private','internal','public','marketplace')),
      tier TEXT NOT NULL DEFAULT 'regular'
        CHECK (tier IN ('regular','mega','hyper','shadow')),
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      updated_at TEXT NOT NULL DEFAULT (datetime('now'))
    );
  `);
});

const ctxAlice = (overrides = {}) => ({
  actor: { userId: "user_alice" },
  userId: "user_alice",
  db,
  ...overrides,
});

const validParams = {
  soundscapeRegion: "tavern",
  intensity: "ambient",
  referenceStemDataUrl: TINY_WAV_DATA_URL,
  manifest: { trackCount: 2, version: 1 },
  durationMs: 30000,
  title: "Quiet inn evening",
  moodTags: ["calm", "cozy"],
};

describe("studio.publish-as-adaptive-music", async () => {
  it("rejects anonymous publishers", async () => {
    const r = await call("publish-as-adaptive-music", { db, actor: { userId: "anon" }, userId: "anon" }, validParams);
    assert.equal(r.ok, false);
    assert.match(r.error, /auth/i);
  });

  it("rejects unknown region", async () => {
    const r = await call("publish-as-adaptive-music", ctxAlice(), { ...validParams, soundscapeRegion: "moon" });
    assert.equal(r.ok, false);
    assert.match(r.error, /region/i);
  });

  it("rejects unknown intensity", async () => {
    const r = await call("publish-as-adaptive-music", ctxAlice(), { ...validParams, intensity: "ferocious" });
    assert.equal(r.ok, false);
    assert.match(r.error, /intensity/i);
  });

  it("rejects missing manifest", async () => {
    const r = await call("publish-as-adaptive-music", ctxAlice(), { ...validParams, manifest: null });
    assert.equal(r.ok, false);
    assert.match(r.error, /manifest/i);
  });

  it("rejects non-data-URL audio", async () => {
    const r = await call("publish-as-adaptive-music", ctxAlice(), {
      ...validParams,
      referenceStemDataUrl: "https://example/x.wav",
    });
    assert.equal(r.ok, false);
    assert.match(r.error, /base64 data/i);
  });

  it("writes route_artifacts row + dtu row + returns downloadUrl", async () => {
    const r = await call("publish-as-adaptive-music", ctxAlice(), validParams);
    assert.equal(r.ok, true);
    assert.equal(r.result.region, "tavern");
    assert.equal(r.result.intensity, "ambient");
    assert.equal(r.result.durationMs, 30000);
    assert.deepEqual(r.result.moodTags, ["calm", "cozy"]);
    assert.ok(r.result.dtuId);
    assert.ok(r.result.artifactId);
    assert.equal(r.result.downloadUrl, `/api/artifacts/${r.result.artifactId}/download`);

    const artifact = db.prepare("SELECT * FROM route_artifacts WHERE artifact_id = ?").get(r.result.artifactId);
    assert.ok(artifact);
    assert.equal(artifact.mime_type, "audio/wav");
    assert.equal(artifact.storage_mode, "inline");

    const dtu = db.prepare("SELECT * FROM dtus WHERE id = ?").get(r.result.dtuId);
    assert.ok(dtu);
    assert.equal(dtu.visibility, "public");
    const tags = JSON.parse(dtu.tags_json);
    assert.ok(tags.includes("adaptive_music"));
    assert.ok(tags.includes("region:tavern"));
    assert.ok(tags.includes("intensity:ambient"));
    assert.ok(tags.includes("mood:calm"));
    assert.ok(tags.includes("mood:cozy"));
    const body = JSON.parse(dtu.body_json);
    assert.equal(body.type, "adaptive_music");
    assert.equal(body.manifest.trackCount, 2);
  });

  it("accepts all 9 regions", async () => {
    const regions = ["tavern", "archive", "forge", "market", "tower", "plaza", "wilderness", "arena", "underground"];
    for (const r of regions) {
      const res = await call("publish-as-adaptive-music", ctxAlice(), { ...validParams, soundscapeRegion: r });
      assert.equal(res.ok, true, `${r} should publish`);
    }
    const count = db.prepare("SELECT COUNT(*) AS n FROM dtus").get().n;
    assert.equal(count, regions.length);
  });

  it("accepts all 3 intensities", async () => {
    for (const i of ["ambient", "active", "battle"]) {
      const res = await call("publish-as-adaptive-music", ctxAlice(), { ...validParams, intensity: i });
      assert.equal(res.ok, true);
    }
  });
});

describe("studio.list-adaptive-music", async () => {
  it("returns empty when nothing published", async () => {
    const r = await call("list-adaptive-music", ctxAlice(), {});
    assert.equal(r.ok, true);
    assert.equal(r.result.count, 0);
  });

  it("lists every track with downloadUrl + manifestSummary", async () => {
    await call("publish-as-adaptive-music", ctxAlice(), validParams);
    await call("publish-as-adaptive-music", ctxAlice(), { ...validParams, soundscapeRegion: "arena", intensity: "battle" });
    const r = await call("list-adaptive-music", ctxAlice(), {});
    assert.equal(r.ok, true);
    assert.equal(r.result.count, 2);
    for (const t of r.result.tracks) {
      assert.ok(t.downloadUrl?.startsWith("/api/artifacts/"));
      assert.ok(t.artifactId);
      assert.ok(t.manifestSummary);
    }
  });

  it("filters by region", async () => {
    await call("publish-as-adaptive-music", ctxAlice(), validParams);
    await call("publish-as-adaptive-music", ctxAlice(), { ...validParams, soundscapeRegion: "arena" });
    const r = await call("list-adaptive-music", ctxAlice(), { region: "arena" });
    assert.equal(r.ok, true);
    assert.equal(r.result.count, 1);
    assert.equal(r.result.tracks[0].region, "arena");
  });

  it("filters by intensity", async () => {
    await call("publish-as-adaptive-music", ctxAlice(), { ...validParams, intensity: "ambient" });
    await call("publish-as-adaptive-music", ctxAlice(), { ...validParams, intensity: "battle" });
    const r = await call("list-adaptive-music", ctxAlice(), { intensity: "battle" });
    assert.equal(r.ok, true);
    assert.equal(r.result.count, 1);
    assert.equal(r.result.tracks[0].intensity, "battle");
  });

  it("excludes private DTUs", async () => {
    const r = await call("publish-as-adaptive-music", ctxAlice(), validParams);
    db.prepare("UPDATE dtus SET visibility = 'private' WHERE id = ?").run(r.result.dtuId);
    const listed = await call("list-adaptive-music", ctxAlice(), {});
    assert.equal(listed.result.count, 0);
  });
});
