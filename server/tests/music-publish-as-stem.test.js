// Contract test for the music → adaptive-stem content-engine bridge.

import { describe, it, before, beforeEach, after } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import os from "node:os";
import Database from "better-sqlite3";
import registerMusicActions from "../domains/music.js";

const ACTIONS = new Map();
function register(domain, name, fn) { ACTIONS.set(`${domain}.${name}`, fn); }
// publish-as-stem is async (async fs); list-published-stems is sync. Awaiting a
// sync return is harmless, so this helper works for both.
async function call(name, ctx, params = {}) {
  const fn = ACTIONS.get(`music.${name}`);
  assert.ok(fn, `music.${name} not registered`);
  return await fn(ctx, { id: null, data: {}, meta: {} }, params);
}

// 100-byte WAV-ish payload — valid base64; the macro doesn't validate
// the audio container, just the data-URL prefix + buffer length.
const tinyAudio = Buffer.alloc(100, 0x7f).toString("base64");
const TINY_WAV_DATA_URL  = `data:audio/wav;base64,${tinyAudio}`;
const TINY_MP3_DATA_URL  = `data:audio/mpeg;base64,${tinyAudio}`;

let tmpDataDir;
let db;

before(() => {
  registerMusicActions(register);
  tmpDataDir = fs.mkdtempSync(path.join(os.tmpdir(), "concord-mus-pub-"));
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
  // Minimal dtus + users schema to satisfy FK + columns the macro touches.
  db.exec(`
    CREATE TABLE users (id TEXT PRIMARY KEY);
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
    CREATE INDEX IF NOT EXISTS idx_dtus_created ON dtus(created_at DESC);
  `);
});

const ctxAlice = (overrides = {}) => ({
  actor: { userId: "user_alice" },
  userId: "user_alice",
  db,
  ...overrides,
});

describe("music.publish-as-stem", async () => {
  it("rejects anonymous publishers", async () => {
    const r = await call("publish-as-stem", { db, actor: { userId: "anon" }, userId: "anon" }, {
      stemName: "ambient_bed", audioDataUrl: TINY_WAV_DATA_URL,
    });
    assert.equal(r.ok, false);
    assert.match(r.error, /auth/i);
  });

  it("rejects unknown stemName", async () => {
    const r = await call("publish-as-stem", ctxAlice(), {
      stemName: "intro_strings", audioDataUrl: TINY_WAV_DATA_URL,
    });
    assert.equal(r.ok, false);
    assert.match(r.error, /stemName/);
  });

  it("rejects a non-data-URL audioDataUrl", async () => {
    const r = await call("publish-as-stem", ctxAlice(), {
      stemName: "ambient_bed", audioDataUrl: "https://example/x.wav",
    });
    assert.equal(r.ok, false);
    assert.match(r.error, /base64 data/i);
  });

  it("rejects when db is unavailable", async () => {
    const r = await call("publish-as-stem", { actor: { userId: "user_alice" }, userId: "user_alice" }, {
      stemName: "combat_drum", audioDataUrl: TINY_WAV_DATA_URL,
    });
    assert.equal(r.ok, false);
    assert.match(r.error, /db/i);
  });

  it("inserts route_artifacts + dtus row and returns downloadUrl", async () => {
    const r = await call("publish-as-stem", ctxAlice(), {
      stemName: "ambient_bed",
      audioDataUrl: TINY_WAV_DATA_URL,
      durationMs: 12000,
      mood: "calm",
      title: "Forest at dawn",
    });
    assert.equal(r.ok, true);
    assert.equal(r.result.stemName, "ambient_bed");
    assert.equal(r.result.mood, "calm");
    assert.equal(r.result.durationMs, 12000);
    assert.equal(r.result.mimeType, "audio/wav");
    assert.ok(r.result.artifactId);
    assert.ok(r.result.dtuId);
    assert.equal(r.result.downloadUrl, `/api/artifacts/${r.result.artifactId}/download`);

    const artifact = db
      .prepare("SELECT * FROM route_artifacts WHERE artifact_id = ?")
      .get(r.result.artifactId);
    assert.ok(artifact);
    assert.equal(artifact.mime_type, "audio/wav");
    assert.equal(artifact.storage_mode, "inline");
    assert.equal(artifact.created_by, "user_alice");

    const dtu = db.prepare("SELECT * FROM dtus WHERE id = ?").get(r.result.dtuId);
    assert.ok(dtu);
    assert.equal(dtu.visibility, "public");
    assert.equal(dtu.owner_user_id, "user_alice");
    assert.equal(dtu.title, "Forest at dawn");
    const tags = JSON.parse(dtu.tags_json);
    assert.ok(tags.includes("adaptive_music"));
    assert.ok(tags.includes("stem:ambient_bed"));
    assert.ok(tags.includes("mood:calm"));
    assert.ok(tags.includes("creator:user_alice"));
    const body = JSON.parse(dtu.body_json);
    assert.equal(body.type, "adaptive_stem");
    assert.equal(body.stemName, "ambient_bed");
    assert.equal(body.artifactId, r.result.artifactId);
  });

  it("accepts each of the 4 stems", async () => {
    const stems = ["ambient_bed", "tension_pad", "combat_drum", "revelation_strings"];
    for (const s of stems) {
      const r = await call("publish-as-stem", ctxAlice(), {
        stemName: s, audioDataUrl: TINY_MP3_DATA_URL,
      });
      assert.equal(r.ok, true, `${s} should publish`);
    }
    const count = db.prepare("SELECT COUNT(*) AS n FROM dtus").get().n;
    assert.equal(count, stems.length);
  });

  it("each publish creates a distinct dtuId + artifactId", async () => {
    const r1 = await call("publish-as-stem", ctxAlice(), {
      stemName: "ambient_bed", audioDataUrl: TINY_WAV_DATA_URL,
    });
    const r2 = await call("publish-as-stem", ctxAlice(), {
      stemName: "ambient_bed", audioDataUrl: TINY_WAV_DATA_URL,
    });
    assert.equal(r1.ok, true);
    assert.equal(r2.ok, true);
    assert.notEqual(r1.result.dtuId, r2.result.dtuId);
    assert.notEqual(r1.result.artifactId, r2.result.artifactId);
  });
});

describe("music.list-published-stems", async () => {
  it("returns empty list when nothing published", async () => {
    const r = await call("list-published-stems", ctxAlice(), {});
    assert.equal(r.ok, true);
    assert.equal(r.result.count, 0);
    assert.deepEqual(r.result.stems, []);
  });

  it("lists every published stem with downloadUrl", async () => {
    await call("publish-as-stem", ctxAlice(), {
      stemName: "ambient_bed", audioDataUrl: TINY_WAV_DATA_URL, mood: "calm",
    });
    await call("publish-as-stem", ctxAlice(), {
      stemName: "combat_drum", audioDataUrl: TINY_MP3_DATA_URL,
    });
    const r = await call("list-published-stems", ctxAlice(), {});
    assert.equal(r.ok, true);
    assert.equal(r.result.count, 2);
    const names = r.result.stems.map((s) => s.stemName).sort();
    assert.deepEqual(names, ["ambient_bed", "combat_drum"]);
    for (const s of r.result.stems) {
      assert.ok(s.downloadUrl?.startsWith("/api/artifacts/"));
      assert.ok(s.artifactId);
    }
  });

  it("filters by stemName when specified", async () => {
    await call("publish-as-stem", ctxAlice(), {
      stemName: "ambient_bed", audioDataUrl: TINY_WAV_DATA_URL,
    });
    await call("publish-as-stem", ctxAlice(), {
      stemName: "tension_pad", audioDataUrl: TINY_WAV_DATA_URL,
    });
    const r = await call("list-published-stems", ctxAlice(), { stemName: "tension_pad" });
    assert.equal(r.ok, true);
    assert.equal(r.result.count, 1);
    assert.equal(r.result.stems[0].stemName, "tension_pad");
  });

  it("filters by mood when specified", async () => {
    await call("publish-as-stem", ctxAlice(), {
      stemName: "ambient_bed", audioDataUrl: TINY_WAV_DATA_URL, mood: "calm",
    });
    await call("publish-as-stem", ctxAlice(), {
      stemName: "ambient_bed", audioDataUrl: TINY_WAV_DATA_URL, mood: "intense",
    });
    const r = await call("list-published-stems", ctxAlice(), { mood: "calm" });
    assert.equal(r.ok, true);
    assert.equal(r.result.count, 1);
    assert.equal(r.result.stems[0].mood, "calm");
  });

  it("excludes private DTUs", async () => {
    const r = await call("publish-as-stem", ctxAlice(), {
      stemName: "ambient_bed", audioDataUrl: TINY_WAV_DATA_URL,
    });
    // Flip the visibility to private and confirm it disappears from the list.
    db.prepare("UPDATE dtus SET visibility = 'private' WHERE id = ?").run(r.result.dtuId);
    const listed = await call("list-published-stems", ctxAlice(), {});
    assert.equal(listed.result.count, 0);
  });
});
