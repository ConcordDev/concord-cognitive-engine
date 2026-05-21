// server/tests/dreams-domain-parity.test.js
//
// Contract tests for server/domains/dreams.js — the in-game dream-record
// mechanic surface (recent / detail / publish / unpublish / reprice / tag /
// tags / search / timeline / interpret / predictions). Exercises each macro
// against a real in-memory dreams + dtus schema and asserts the { ok } envelope.

import { describe, it, before, beforeEach } from "node:test";
import assert from "node:assert/strict";
import Database from "better-sqlite3";

import registerDreamsMacros from "../domains/dreams.js";

const ACTIONS = new Map();
function register(domain, name, fn) { ACTIONS.set(`${domain}.${name}`, fn); }
function call(name, ctx, input = {}) {
  const fn = ACTIONS.get(`dreams.${name}`);
  if (!fn) throw new Error(`dreams.${name} not registered`);
  return fn(ctx, input);
}

before(() => { registerDreamsMacros(register); });

let db;

function seed() {
  // Fresh per-user STATE so tag/interpretation caches don't leak between tests.
  if (globalThis._concordSTATE) {
    globalThis._concordSTATE.dreamTags = new Map();
    globalThis._concordSTATE.dreamInterpretations = new Map();
  }

  db = new Database(":memory:");
  // dreams table — mirrors migration 115.
  db.prepare(`
    CREATE TABLE dreams (
      id            TEXT PRIMARY KEY,
      user_id       TEXT NOT NULL,
      world_id      TEXT,
      dream_dtu_id  TEXT,
      fragment_count INTEGER NOT NULL DEFAULT 0,
      signature     TEXT NOT NULL,
      composer      TEXT NOT NULL DEFAULT 'deterministic',
      composed_at   INTEGER NOT NULL DEFAULT (unixepoch())
    )
  `).run();
  // dtus table — mirrors the live shape the dream-engine inserts into.
  db.prepare(`
    CREATE TABLE dtus (
      id          TEXT PRIMARY KEY,
      creator_id  TEXT,
      kind        TEXT,
      type        TEXT,
      title       TEXT,
      scope       TEXT DEFAULT 'personal',
      data        TEXT,
      meta_json   TEXT,
      created_at  INTEGER
    )
  `).run();
  // forward_predictions — mirrors migration 116 (enough for getActivePredictions).
  db.prepare(`
    CREATE TABLE forward_predictions (
      id            TEXT PRIMARY KEY,
      user_id       TEXT NOT NULL,
      world_id      TEXT,
      subject_kind  TEXT,
      subject_id    TEXT,
      anticipated   TEXT,
      confidence    REAL,
      composer      TEXT,
      composed_at   INTEGER,
      expires_at    INTEGER,
      realised_at   INTEGER
    )
  `).run();

  const now = Math.floor(Date.now() / 1000);

  function insertDream(id, userId, agoSec, dreamData) {
    const dtuId = `dream_dtu_${id}`;
    db.prepare(`
      INSERT INTO dtus (id, creator_id, kind, type, title, scope, data, meta_json, created_at)
      VALUES (?, ?, 'dream', 'dream', ?, 'personal', ?, '{}', ?)
    `).run(dtuId, userId, dreamData.title, JSON.stringify({
      human: dreamData.human,
      core: dreamData.core,
      machine: dreamData.machine,
    }), now - agoSec);
    db.prepare(`
      INSERT INTO dreams (id, user_id, world_id, dream_dtu_id, fragment_count, signature, composer, composed_at)
      VALUES (?, ?, ?, ?, ?, ?, 'deterministic', ?)
    `).run(id, userId, "concordia-hub", dtuId, dreamData.core.fragments.length,
      `sig_${id}`, now - agoSec);
  }

  insertDream("drm_1", "user_a", 60, {
    title: "Dream",
    human: "There was blood today. 2 fell. You traded blows 4 times.",
    core: {
      fragments: [
        { kind: "combat" }, { kind: "combat" }, { kind: "pain" },
        { kind: "gather" }, { kind: "visit" },
      ],
      summary: { combatHits: 4, combatTaken: 2, kills: 2, painCount: 1, painTotal: 0.7, gathered: 3, visited: 2, dtusCreated: 0 },
    },
    machine: { composer: "deterministic" },
  });
  insertDream("drm_2", "user_a", 90000, {
    title: "Dream",
    human: "A quiet day. The world held still long enough for you to notice it.",
    core: {
      fragments: [
        { kind: "visit" }, { kind: "visit" }, { kind: "visit" },
        { kind: "dtu" }, { kind: "dtu" },
      ],
      summary: { combatHits: 0, combatTaken: 0, kills: 0, painCount: 0, painTotal: 0, gathered: 0, visited: 3, dtusCreated: 2 },
    },
    machine: { composer: "deterministic" },
  });
  insertDream("drm_b", "user_b", 120, {
    title: "Dream",
    human: "Your hands worked the world 9 times.",
    core: {
      fragments: [{ kind: "gather" }, { kind: "gather" }, { kind: "gather" }, { kind: "gather" }, { kind: "gather" }],
      summary: { combatHits: 0, combatTaken: 0, kills: 0, painCount: 0, painTotal: 0, gathered: 9, visited: 1, dtusCreated: 0 },
    },
    machine: { composer: "deterministic" },
  });

  db.prepare(`
    INSERT INTO forward_predictions
      (id, user_id, world_id, subject_kind, subject_id, anticipated, confidence, composer, composed_at, expires_at, realised_at)
    VALUES (?, 'user_a', 'concordia-hub', 'quest', 'q1', 'You will return to the ruins.', 0.62, 'deterministic', ?, ?, NULL)
  `).run("fp_1", now, now + 7200);

  return db;
}

beforeEach(() => { seed(); });

const ctxA = () => ({ db, actor: { userId: "user_a" } });
const ctxB = () => ({ db, actor: { userId: "user_b" } });

describe("dreams.recent (baseline)", () => {
  it("returns the calling player's dreams with hydrated dtu", async () => {
    const r = await call("recent", ctxA(), { limit: 10 });
    assert.equal(r.ok, true);
    assert.equal(r.count, 2);
    assert.ok(r.dreams[0].dtu);
    assert.ok(Array.isArray(r.dreams[0].tags));
  });
  it("no_db without a db", async () => {
    const r = await call("recent", { actor: { userId: "x" } }, {});
    assert.equal(r.ok, false);
    assert.equal(r.reason, "no_db");
  });
  it("no_actor without an actor", async () => {
    const r = await call("recent", { db }, {});
    assert.equal(r.ok, false);
    assert.equal(r.reason, "no_actor");
  });
});

describe("dreams.predictions", () => {
  it("returns active forward-sim predictions", async () => {
    const r = await call("predictions", ctxA(), {});
    assert.equal(r.ok, true);
    assert.ok(r.count >= 1);
  });
  it("filters by worldId", async () => {
    const r = await call("predictions", ctxA(), { worldId: "concordia-hub" });
    assert.equal(r.ok, true);
    assert.ok(r.predictions.every((p) => !p.world_id || p.world_id === "concordia-hub"));
  });
});

describe("dreams.detail (full-text reader)", () => {
  it("rejects a missing dreamId", async () => {
    const r = await call("detail", ctxA(), {});
    assert.equal(r.ok, false);
    assert.equal(r.reason, "missing_dreamId");
  });
  it("not found for an unknown dream", async () => {
    const r = await call("detail", ctxA(), { dreamId: "nope" });
    assert.equal(r.ok, false);
    assert.equal(r.reason, "dream_not_found");
  });
  it("returns full prose + fragments + summary", async () => {
    const r = await call("detail", ctxA(), { dreamId: "drm_1" });
    assert.equal(r.ok, true);
    assert.match(r.dream.prose, /blood/);
    assert.equal(r.dream.fragments.length, 5);
    assert.equal(r.dream.summary.kills, 2);
    assert.equal(r.dream.scope, "personal");
  });
  it("does not leak another player's dream", async () => {
    const r = await call("detail", ctxA(), { dreamId: "drm_b" });
    assert.equal(r.ok, false);
    assert.equal(r.reason, "dream_not_found");
  });
});

describe("dreams.publish / reprice / unpublish", () => {
  it("publishes at a custom CC price", async () => {
    const r = await call("publish", ctxA(), { dreamId: "drm_1", priceCc: 25 });
    assert.equal(r.ok, true);
    assert.equal(r.priceCc, 25);
    assert.equal(r.scope, "public");
    const detail = await call("detail", ctxA(), { dreamId: "drm_1" });
    assert.equal(detail.dream.scope, "public");
    assert.equal(detail.dream.priceCc, 25);
  });
  it("clamps an out-of-range price", async () => {
    const r = await call("publish", ctxA(), { dreamId: "drm_2", priceCc: 0 });
    assert.equal(r.ok, true);
    assert.ok(r.priceCc >= 1);
  });
  it("reprices an already-published dream", async () => {
    await call("publish", ctxA(), { dreamId: "drm_1", priceCc: 10 });
    const r = await call("reprice", ctxA(), { dreamId: "drm_1", priceCc: 99 });
    assert.equal(r.ok, true);
    assert.equal(r.priceCc, 99);
  });
  it("refuses to reprice an unpublished dream", async () => {
    const r = await call("reprice", ctxA(), { dreamId: "drm_2", priceCc: 50 });
    assert.equal(r.ok, false);
    assert.equal(r.reason, "not_published");
  });
  it("unpublishes back to personal scope", async () => {
    await call("publish", ctxA(), { dreamId: "drm_1", priceCc: 10 });
    const r = await call("unpublish", ctxA(), { dreamId: "drm_1" });
    assert.equal(r.ok, true);
    assert.equal(r.scope, "personal");
    const detail = await call("detail", ctxA(), { dreamId: "drm_1" });
    assert.equal(detail.dream.scope, "personal");
  });
});

describe("dreams.tag / tags", () => {
  it("sets and normalises tags", async () => {
    const r = await call("tag", ctxA(), { dreamId: "drm_1", tags: ["  Combat ", "FEAR", "fear", "x".repeat(40)] });
    assert.equal(r.ok, true);
    assert.deepEqual(r.tags.sort(), ["combat", "fear"]);
  });
  it("rejects tagging an unknown dream", async () => {
    const r = await call("tag", ctxA(), { dreamId: "nope", tags: ["a"] });
    assert.equal(r.ok, false);
    assert.equal(r.reason, "dream_not_found");
  });
  it("builds a tag cloud across your dreams", async () => {
    await call("tag", ctxA(), { dreamId: "drm_1", tags: ["combat", "vivid"] });
    await call("tag", ctxA(), { dreamId: "drm_2", tags: ["vivid"] });
    const r = await call("tags", ctxA(), {});
    assert.equal(r.ok, true);
    const vivid = r.tags.find((t) => t.tag === "vivid");
    assert.equal(vivid.count, 2);
  });
});

describe("dreams.search", () => {
  it("matches free text in prose", async () => {
    const r = await call("search", ctxA(), { query: "blood" });
    assert.equal(r.ok, true);
    assert.equal(r.count, 1);
    assert.equal(r.dreams[0].id, "drm_1");
  });
  it("filters by tag", async () => {
    await call("tag", ctxA(), { dreamId: "drm_2", tags: ["calm"] });
    const r = await call("search", ctxA(), { tag: "calm" });
    assert.equal(r.ok, true);
    assert.equal(r.count, 1);
    assert.equal(r.dreams[0].id, "drm_2");
  });
  it("filters by scope", async () => {
    await call("publish", ctxA(), { dreamId: "drm_1", priceCc: 5 });
    const r = await call("search", ctxA(), { scope: "public" });
    assert.equal(r.ok, true);
    assert.ok(r.dreams.every((d) => d.scope === "public"));
  });
  it("returns no rows for an unmatched query", async () => {
    const r = await call("search", ctxA(), { query: "zzzznomatch" });
    assert.equal(r.ok, true);
    assert.equal(r.count, 0);
  });
});

describe("dreams.timeline", () => {
  it("groups dreams by calendar day", async () => {
    const r = await call("timeline", ctxA(), {});
    assert.equal(r.ok, true);
    assert.equal(r.totalDreams, 2);
    assert.ok(r.days.length >= 1);
    const total = r.days.reduce((a, d) => a + d.count, 0);
    assert.equal(total, 2);
  });
});

describe("dreams.interpret", () => {
  it("rejects a missing dreamId", async () => {
    const r = await call("interpret", ctxA(), {});
    assert.equal(r.ok, false);
    assert.equal(r.reason, "missing_dreamId");
  });
  it("produces a grounded reflection from the summary", async () => {
    const r = await call("interpret", ctxA(), { dreamId: "drm_1" });
    assert.equal(r.ok, true);
    assert.equal(r.cached, false);
    assert.ok(r.interpretation.themes.includes("conflict"));
    assert.ok(r.interpretation.reflection.length > 0);
    assert.equal(r.interpretation.tone, "charged");
  });
  it("caches the interpretation across calls", async () => {
    await call("interpret", ctxA(), { dreamId: "drm_2" });
    const r = await call("interpret", ctxA(), { dreamId: "drm_2" });
    assert.equal(r.ok, true);
    assert.equal(r.cached, true);
  });
  it("recomputes when refresh is set", async () => {
    await call("interpret", ctxA(), { dreamId: "drm_2" });
    const r = await call("interpret", ctxA(), { dreamId: "drm_2", refresh: true });
    assert.equal(r.ok, true);
    assert.equal(r.cached, false);
  });
  it("interprets a quiet dream as stillness", async () => {
    const r = await call("interpret", ctxB(), { dreamId: "drm_b" });
    assert.equal(r.ok, true);
    assert.ok(r.interpretation.themes.includes("provision"));
  });
});
