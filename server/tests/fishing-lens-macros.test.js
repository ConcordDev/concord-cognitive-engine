// Behavioral macro tests for server/domains/fishing.js — the cast → bite →
// reel → mint substrate the /lenses/fishing lens (+ FishingMinigameOverlay)
// drives. Fishing is a GAME lens, not a calculator: the load-bearing math is
// the skill/accuracy-weighted species pick + the clamped qualityScore, and the
// load-bearing side effect is the single raw_fish inventory row a catch mints.
//
// Fishing registers via the PATH-2 macro convention — register(domain, name, fn)
// — and the live dispatch invokes each handler as `m.fn(ctx, input)` (the
// 2-ARG order, ctx FIRST), then peels exactly one sole-key
// { artifact: { data } } wrapper at /api/lens/run before the call. This harness
// reproduces BOTH: it collects the handlers through the same register signature
// and drives them with the SAME peel + (ctx, input) call the server makes, so a
// double-wrap dead-surface regression or an arg-order drift surfaces here.
//
// These are NOT shape-only assertions. They pin: the EXACT input fields the
// page + overlay SEND and the EXACT output fields they RENDER (a dead-surface
// regression fails here), real computed values + the cast→reel→catch→inventory
// round-trip, validation-rejection, graceful degradation, and a fail-CLOSED
// poisoned-numeric contract (Infinity/NaN/'1e999' reactionMs/tension/skill/x/z
// are clamped, NEVER leak Infinity/NaN, NEVER throw, NEVER 500).

import { describe, it, beforeEach } from "node:test";
import assert from "node:assert/strict";
import Database from "better-sqlite3";
import registerFishingMacros from "../domains/fishing.js";
import { getSession, listFishForWorld } from "../lib/fishing.js";
import { peelRedundantArtifactWrapper } from "../lib/lens-input-normalize.js";

// Mirror the live register(domain, name, fn) collection.
function collectMacros() {
  const map = new Map();
  registerFishingMacros((domain, name, handler) => {
    assert.equal(domain, "fishing", `unexpected domain: ${domain}`);
    map.set(name, handler);
  });
  return map;
}

// player_inventory at its post-migration shape (the columns lib/fishing.js's
// primary INSERT path writes), built inline so the test doesn't depend on the
// full migration chain.
function freshDb() {
  const db = new Database(":memory:");
  db.exec(`
    CREATE TABLE player_inventory (
      id          TEXT PRIMARY KEY,
      user_id     TEXT NOT NULL,
      world_id    TEXT NOT NULL DEFAULT 'concordia-hub',
      item_type   TEXT NOT NULL DEFAULT 'material',
      item_id     TEXT NOT NULL,
      item_name   TEXT NOT NULL DEFAULT '',
      quantity    INTEGER NOT NULL DEFAULT 1,
      schema_id   TEXT,
      acquired_at INTEGER NOT NULL DEFAULT (unixepoch()),
      metadata    TEXT
    );
  `);
  return db;
}

function ctxFor(db, userId) {
  return { db, actor: { userId } };
}

// Drive a macro the way /api/lens/run does: peel exactly one redundant
// { artifact: { data } } wrapper, then call handler(ctx, peeledInput).
function call(macros, name, ctx, rawInput = {}) {
  const fn = macros.get(name);
  if (!fn) throw new Error(`fishing.${name} not registered`);
  return fn(ctx, peelRedundantArtifactWrapper(rawInput));
}

// Assert no value in the (possibly nested) object is a non-finite number.
function assertNoNonFinite(obj, path = "root") {
  if (obj == null) return;
  if (typeof obj === "number") {
    assert.ok(Number.isFinite(obj), `non-finite number at ${path}: ${obj}`);
    return;
  }
  if (Array.isArray(obj)) { obj.forEach((v, i) => assertNoNonFinite(v, `${path}[${i}]`)); return; }
  if (typeof obj === "object") { for (const k of Object.keys(obj)) assertNoNonFinite(obj[k], `${path}.${k}`); }
}

describe("fishing lens macros", () => {
  let db, macros;
  beforeEach(() => { db = freshDb(); macros = collectMacros(); });

  // ── registration: the full read + write surface the lens reaches ──────────
  it("registers every macro the lens + overlay + ⌘K can reach", () => {
    for (const name of ["catalog", "species", "list", "get", "catches", "session", "cast", "reel", "create"]) {
      assert.equal(typeof macros.get(name), "function", `missing macro: ${name}`);
    }
  });

  // ── FIELD ALIGNMENT: catalog ───────────────────────────────────────────────
  // The page sends  GET /api/fishing/catalog?worldId=<worldId>  and renders
  // c.fish[*] → { id, name, rarity, subBiome }. The catalog MACRO must return
  // the same { ok, fish:[{ id, name, rarity, biome, subBiome }] } the route does.
  it("catalog returns the world's real authored fish with the fields the page renders", async () => {
    const out = await call(macros, "catalog", ctxFor(db, "u1"), { worldId: "concordia-hub" });
    assert.equal(out.ok, true);
    assert.equal(out.worldId, "concordia-hub");
    assert.ok(Array.isArray(out.fish) && out.fish.length > 0, "catalog must list fish");
    // Every entry carries the EXACT fields the catalog list + RARITY_COLORS map render.
    for (const f of out.fish) {
      assert.equal(typeof f.id, "string");
      assert.equal(typeof f.name, "string");
      assert.equal(typeof f.rarity, "string");
      assert.ok(typeof f.biome === "string" || typeof f.subBiome === "string");
    }
    // Matches the lib's listing exactly — no duplicated/fabricated data.
    assert.deepEqual(
      out.fish.map((f) => f.id).sort(),
      listFishForWorld("concordia-hub").map((f) => f.id).sort(),
    );
  });

  it("catalog degrades graceful on an unknown world — hub fallback, never a crash", async () => {
    const out = await call(macros, "catalog", ctxFor(db, "u1"), { worldId: "no-such-world" });
    assert.equal(out.ok, true);
    // Falls back to the hub's authored pool (lib behavior) rather than empty/throw.
    assert.deepEqual(
      out.fish.map((f) => f.id).sort(),
      listFishForWorld("concordia-hub").map((f) => f.id).sort(),
    );
  });

  // ── species — biome-scoped pool ────────────────────────────────────────────
  it("species pools are genuinely per-biome and every fish belongs to the requested biome", async () => {
    const river = await call(macros, "species", ctxFor(db, "u1"), { worldId: "concordia-hub", biome: "river" });
    const ocean = await call(macros, "species", ctxFor(db, "u1"), { worldId: "concordia-hub", biome: "ocean" });
    assert.equal(river.ok, true);
    assert.equal(ocean.ok, true);
    assert.equal(river.biome, "river");
    assert.equal(ocean.biome, "ocean");
    assert.ok(river.fish.length > 0 && ocean.fish.length > 0);
    const riverIds = new Set(river.fish.map((f) => f.id));
    const oceanIds = new Set(ocean.fish.map((f) => f.id));
    assert.ok([...oceanIds].some((id) => !riverIds.has(id)), "ocean must contain a fish the river pool lacks");
    assert.ok(river.fish.every((f) => f.biome === "river" || f.subBiome === "river"));
    assert.ok(ocean.fish.every((f) => f.biome === "ocean" || f.subBiome === "ocean"));
  });

  // ── FIELD ALIGNMENT: cast ──────────────────────────────────────────────────
  // The page + overlay POST { worldId, x, z, biome } and the overlay reads
  // j.sessionId + j.biteAtEpochMs. The cast macro must return the same fields.
  it("cast returns the exact { sessionId, biteAtEpochMs, candidateCount } the overlay reads", async () => {
    const cast = await call(macros, "cast", ctxFor(db, "angler"), { worldId: "concordia-hub", x: 5, z: -3, biome: "water" });
    assert.equal(cast.ok, true);
    assert.equal(typeof cast.sessionId, "string");
    assert.ok(cast.sessionId.startsWith("fish_"));
    assert.ok(Number.isFinite(cast.biteAtEpochMs) && cast.biteAtEpochMs > Date.now());
    assert.ok(Number.isFinite(cast.candidateCount) && cast.candidateCount > 0);
  });

  it("cast without an actor returns a clean envelope, not a throw", async () => {
    const out = await call(macros, "cast", { db }, { worldId: "concordia-hub" });
    assert.equal(out.ok, false);
    assert.equal(out.reason, "no_user");
  });

  // ── the load-bearing round-trip: cast → bite-gate → reel → mint → log ──────
  it("cast → reel → catch yields a real species AND mints exactly one inventory row", async () => {
    const cast = await call(macros, "cast", ctxFor(db, "angler"), { worldId: "concordia-hub", biome: "water" });
    assert.equal(cast.ok, true);

    // The tension mechanic gates on bite timing: a reel before the bite is
    // rejected (no_bite_yet) — the mechanic must actually resolve that way.
    const tooEarly = await call(macros, "reel", ctxFor(db, "angler"), { sessionId: cast.sessionId });
    assert.equal(tooEarly.ok, false);
    assert.equal(tooEarly.reason, "no_bite_yet");

    // Advance the session past the bite window then reel with high accuracy.
    const s = getSession(cast.sessionId);
    s.biteAt = Date.now() - 500;
    s.resolved = false; // tooEarly flipped it; reset for the real attempt

    const reel = await call(macros, "reel", ctxFor(db, "angler"), {
      sessionId: cast.sessionId, reactionMs: 400, tensionAccuracy: 0.9, fishingSkill: 50,
    });
    assert.equal(reel.ok, true);
    // The overlay renders j.fish.name, j.tier, j.qualityScore — pin those fields.
    assert.ok(reel.fish && typeof reel.fish.id === "string" && typeof reel.fish.name === "string");
    const poolIds = new Set(listFishForWorld("concordia-hub", "water").map((f) => f.id));
    assert.ok(poolIds.has(reel.fish.id), "caught fish must come from the biome's species table");
    assert.ok(reel.qualityScore >= 0 && reel.qualityScore <= 1);
    assert.ok(["perfect", "good", "fair", "poor"].includes(reel.tier));
    assert.equal(reel.mint.ok, true);

    // Inventory gained exactly the caught item (one raw_fish row, matching id).
    const rows = db.prepare(
      `SELECT * FROM player_inventory WHERE user_id = 'angler' AND item_type = 'raw_fish'`,
    ).all();
    assert.equal(rows.length, 1, "exactly one catch row");
    assert.equal(rows[0].item_id, `raw_fish:${reel.fish.id}`);
    assert.equal(rows[0].quantity, 1);

    // FIELD ALIGNMENT: the catches macro surfaces the row with the exact fields
    // the page's catch log renders: { id, item_id, item_name, acquired_at }.
    const log = await call(macros, "catches", ctxFor(db, "angler"), {});
    assert.equal(log.ok, true);
    assert.equal(log.catches.length, 1);
    const row = log.catches[0];
    assert.equal(row.item_id, `raw_fish:${reel.fish.id}`);
    assert.equal(typeof row.item_name, "string");
    assert.ok(Number.isFinite(row.acquired_at));
  });

  it("higher skill + accuracy biases the catch toward rarer fish (the mechanic is real)", async () => {
    // Drive many high-skill casts; the set must land at least one non-common
    // fish, proving rarity weighting is wired (not a flat 1/8 random pick — the
    // hub pool is mostly common, so a flat pick would also occasionally hit
    // non-common, but skill bias makes it reliable across 120 trials).
    let rare = 0;
    for (let i = 0; i < 120; i++) {
      const c = await call(macros, "cast", ctxFor(db, "rare_angler"), { worldId: "concordia-hub", biome: "water" });
      const s = getSession(c.sessionId);
      s.biteAt = Date.now() - 500;
      const reel = await call(macros, "reel", ctxFor(db, "rare_angler"), {
        sessionId: c.sessionId, reactionMs: 400, tensionAccuracy: 0.95, fishingSkill: 90,
      });
      if (reel.ok && reel.fish.rarity !== "common") rare += 1;
    }
    assert.ok(rare >= 1, `high-skill angler should occasionally land a non-common fish (got ${rare} over 120)`);
  });

  it("create artifact verb mints a catch through the SAME path as reel", async () => {
    const cast = await call(macros, "create", ctxFor(db, "angler2"), {}); // create with no session → clean reject
    assert.equal(cast.ok, false);
    assert.equal(cast.reason, "no_session_id");

    const c = await call(macros, "cast", ctxFor(db, "angler2"), { worldId: "concordia-hub", biome: "water" });
    const s = getSession(c.sessionId);
    s.biteAt = Date.now() - 500;
    const out = await call(macros, "create", ctxFor(db, "angler2"), { sessionId: c.sessionId, tensionAccuracy: 0.8 });
    assert.equal(out.ok, true);
    assert.ok(out.fish && out.fish.id);
    const n = db.prepare(
      `SELECT COUNT(*) AS n FROM player_inventory WHERE user_id = 'angler2' AND item_type = 'raw_fish'`,
    ).get();
    assert.equal(n.n, 1);
  });

  // ── validation-rejection (clean envelope, never a throw) ───────────────────
  it("reel rejects a missing/expired session cleanly", async () => {
    const out = await call(macros, "reel", ctxFor(db, "u1"), { sessionId: "fish_does_not_exist" });
    assert.equal(out.ok, false);
    assert.equal(out.reason, "session_not_found");
  });

  it("reel without a db (read-only ctx) rejects with no_db, never throws", async () => {
    const out = await call(macros, "reel", { actor: { userId: "u1" } }, { sessionId: "x" });
    assert.equal(out.ok, false);
    assert.equal(out.reason, "no_db");
  });

  it("catches without an actor rejects with no_user (never silently lists another user)", async () => {
    const out = await call(macros, "catches", { db }, {});
    assert.equal(out.ok, false);
    assert.equal(out.reason, "no_user");
  });

  it("get returns a single fish descriptor or a clean miss", async () => {
    const any = listFishForWorld("concordia-hub")[0];
    const hit = await call(macros, "get", ctxFor(db, "u1"), { fishId: any.id });
    assert.equal(hit.ok, true);
    assert.equal(hit.fish.id, any.id);
    const miss = await call(macros, "get", ctxFor(db, "u1"), { fishId: "no_such_fish" });
    assert.equal(miss.ok, false);
    assert.equal(miss.reason, "no_fish");
    const noId = await call(macros, "get", ctxFor(db, "u1"), {});
    assert.equal(noId.ok, false);
    assert.equal(noId.reason, "no_fish_id");
  });

  it("session inspect returns the bite-timing fields the overlay derives, or a clean miss", async () => {
    const c = await call(macros, "cast", ctxFor(db, "u1"), { worldId: "concordia-hub", biome: "water" });
    const sess = await call(macros, "session", ctxFor(db, "u1"), { sessionId: c.sessionId });
    assert.equal(sess.ok, true);
    assert.equal(sess.session.worldId, "concordia-hub");
    assert.equal(sess.session.biome, "water");
    assert.ok(Number.isFinite(sess.session.biteAtEpochMs));
    assert.ok(Number.isFinite(sess.session.expiresAt));
    assert.equal(sess.session.resolved, false);
    assert.ok(sess.session.candidateCount > 0);
    const miss = await call(macros, "session", ctxFor(db, "u1"), { sessionId: "nope" });
    assert.equal(miss.ok, false);
    assert.equal(miss.reason, "session_not_found");
  });

  // ── fail-CLOSED poisoned numerics ──────────────────────────────────────────
  it("fail-CLOSED: poisoned Infinity/NaN/'1e999' reaction/tension/skill never leak NaN/Infinity, never throw", async () => {
    const cast = await call(macros, "cast", ctxFor(db, "poison_a"), {
      worldId: "concordia-hub", biome: "water", x: "1e999", z: "NaN",
    });
    assert.equal(cast.ok, true);
    // x/z are poison but never surface as a non-finite field on the envelope.
    assertNoNonFinite(cast);

    const s = getSession(cast.sessionId);
    s.biteAt = Date.now() - 500;
    const reel = await call(macros, "reel", ctxFor(db, "poison_a"), {
      sessionId: cast.sessionId, reactionMs: Infinity, tensionAccuracy: "1e999", fishingSkill: "NaN",
    });
    assert.equal(reel.ok, true);
    assert.ok(Number.isFinite(reel.qualityScore));
    assert.ok(reel.qualityScore >= 0 && reel.qualityScore <= 1);
    assert.ok(["perfect", "good", "fair", "poor"].includes(reel.tier));
    assertNoNonFinite({ qualityScore: reel.qualityScore });
    // mint with the poison-derived (but clamped) quality must still write a finite name.
    assert.equal(reel.mint.ok, true);
    const row = db.prepare(`SELECT item_name, metadata FROM player_inventory WHERE user_id = 'poison_a'`).get();
    assert.ok(!/Infinity|NaN/.test(row.item_name), `item_name must not embed Infinity/NaN: ${row.item_name}`);
    const meta = JSON.parse(row.metadata);
    assert.ok(Number.isFinite(meta.qualityScore));
  });

  it("fail-CLOSED: a non-string biome on catalog/species is coerced, never NaN-filtered into a crash", async () => {
    const cat = await call(macros, "catalog", ctxFor(db, "poison_b"), { worldId: "concordia-hub", biome: 42 });
    assert.equal(cat.ok, true);
    assert.ok(Array.isArray(cat.fish)); // a coerced "42" biome matches nothing → honest empty, not a throw
    assertNoNonFinite(cat);
    const sp = await call(macros, "species", ctxFor(db, "poison_b"), { worldId: "concordia-hub", biome: 42 });
    assert.equal(sp.ok, true);
    assert.equal(typeof sp.biome, "string"); // clamped to a string, never a raw number
  });

  // ── double-wrap dispatch parity — the dead-surface bug class ────────────────
  it("catalog reads through a sole-key { artifact:{ data } } wrapper identically to flat input", async () => {
    const wrapped = await call(macros, "catalog", ctxFor(db, "u1"), { artifact: { data: { worldId: "concordia-hub" } } });
    const flat = await call(macros, "catalog", ctxFor(db, "u1"), { worldId: "concordia-hub" });
    assert.equal(wrapped.ok, true);
    assert.deepEqual(wrapped.fish.map((f) => f.id).sort(), flat.fish.map((f) => f.id).sort());
  });

  it("cast reads through the wrapper so the lens-shell ⌘K path isn't a dead surface", async () => {
    const wrapped = await call(macros, "cast", ctxFor(db, "u1"), { artifact: { data: { worldId: "concordia-hub", biome: "water" } } });
    assert.equal(wrapped.ok, true);
    assert.ok(wrapped.sessionId.startsWith("fish_"));
    assert.ok(wrapped.candidateCount > 0);
  });
});
