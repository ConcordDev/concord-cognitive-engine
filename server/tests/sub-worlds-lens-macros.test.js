// Behavioral macro tests for the sub-worlds lens — server/domains/sub-worlds.js.
//
// The lens page (concord-frontend/app/lenses/sub-worlds/page.tsx) drives these
// macros via lensRun('sub_worlds', 'discover'|'list'|'spawn'|'favorite'|
// 'my_favorites'|'set_status'|'visit', …). The lens-id is `sub-worlds`; the
// macro DOMAIN is `sub_worlds` (underscore) — distinct and correct.
//
// LIGHTWEIGHT + HERMETIC: no server boot, no network, no LLM, no real DB. The
// domain is an in-memory STATE domain (globalThis._concordSTATE.subWorldsLens),
// like answers/message/whiteboard, so a local register harness over the REAL
// handlers + a fresh STATE per test is the honest unit surface. These are NOT
// shape-only assertions — every test asserts ACTUAL values and multi-step
// round-trips: spawn → list/discover surfaces it; favorite → my_favorites
// reflects it; set_status mutates the real row; visit increments real counters.
//
// It also pins the DUAL-BUS reachability the domain ships: every handler is
// registered into BOTH the LENS_ACTIONS registry (frontend /api/lens/run) and
// the MACROS bus (runMacro / MCP / macro-assassin). The earlier defect was
// that a registerLensAction-only handler was invisible to runMacro (threw
// "macro domain not found") and to the contract/assassin pipeline. We assert
// the MACROS mirror exists and behaves identically.
//
// And it pins the fail-CLOSED numeric guards (the macro-assassin V2 vector):
// a poisoned NaN/Infinity/-1 capacity (spawn/update_settings) or limit
// (discover) returns ok:false bad_numeric_field, never a silent default.

import { describe, it, before, beforeEach } from "node:test";
import assert from "node:assert/strict";
import registerSubWorldsActions from "../domains/sub-worlds.js";

// LENS_ACTIONS-shaped registry: handler(ctx, artifact, params).
const LENS = new Map();
// MACROS-shaped registry the domain mirrors into: { fn(ctx, input) }.
const MACROS = new Map();

function registerLensAction(domain, name, handler) {
  assert.equal(domain, "sub_worlds", `unexpected domain: ${domain}`);
  LENS.set(name, handler);
}

// Stand in for the live MACROS bus so the domain's dual-bus mirror has a target.
// The domain reads globalThis._concordMACROS and writes { fn, spec } entries.
function callLens(name, ctx, params = {}) {
  const fn = LENS.get(name);
  if (!fn) throw new Error(`sub_worlds.${name} not registered (LENS_ACTIONS)`);
  return fn(ctx, { id: null, domain: "sub_worlds", type: "domain_action", data: params, meta: {} }, params);
}
// Drive via the MACROS bus exactly as runMacro(ctx, input) would.
function callMacro(name, ctx, input = {}) {
  const entry = MACROS.get("sub_worlds")?.get(name);
  if (!entry) throw new Error(`sub_worlds.${name} not on MACROS bus`);
  return entry.fn(ctx, input);
}

before(() => {
  // The dual-bus mirror writes into globalThis._concordMACROS at registration
  // time, so it must exist BEFORE registerSubWorldsActions runs.
  globalThis._concordMACROS = MACROS;
  registerSubWorldsActions(registerLensAction);
});
beforeEach(() => {
  globalThis._concordSTATE = { dtus: new Map() };
  globalThis._concordSaveStateDebounced = () => {};
});

const ctxA = { actor: { userId: "user_a" }, userId: "user_a" };
const ctxB = { actor: { userId: "user_b" }, userId: "user_b" };

function spawn(ctx = ctxA, over = {}) {
  const r = callLens("spawn", ctx, { name: "Gravity Lab", kind: "physics_simulator", ...over });
  assert.equal(r.ok, true, `spawn failed: ${r.error}`);
  return r.result.world;
}

describe("sub-worlds lens — dual-bus reachability", () => {
  it("registers every macro the page drives on BOTH buses", () => {
    const driven = ["spawn", "list", "discover", "favorite", "my_favorites", "set_status", "visit"];
    for (const m of driven) {
      assert.equal(typeof LENS.get(m), "function", `LENS_ACTIONS missing sub_worlds.${m}`);
      assert.equal(typeof MACROS.get("sub_worlds")?.get(m)?.fn, "function", `MACROS bus missing sub_worlds.${m}`);
    }
  });

  it("MACROS-bus call behaves identically to the LENS_ACTIONS call", () => {
    // Spawn via MACROS bus (runMacro signature), then read back via MACROS bus.
    const sp = callMacro("spawn", ctxA, { name: "Bus Parity World", kind: "research_zone" });
    assert.equal(sp.ok, true);
    assert.equal(sp.result.world.name, "Bus Parity World");
    assert.equal(sp.result.world.kind, "research_zone");
    const listed = callMacro("list", ctxA, {});
    assert.equal(listed.ok, true);
    assert.equal(listed.result.worlds.length, 1);
    assert.equal(listed.result.worlds[0].world_id, sp.result.world.world_id);
  });
});

describe("sub-worlds lens — spawn → list/discover round-trip", () => {
  it("spawns a world the owner sees in list and others see in discover", () => {
    // name too short rejected
    assert.equal(callLens("spawn", ctxA, { name: "ab" }).ok, false);
    const w = spawn(ctxA, { name: "Public Realm", privacy: "public", capacity: 24 });
    assert.equal(w.capacity, 24);
    assert.equal(w.status, "active");

    // owner list reflects it; a different user's list does not
    assert.equal(callLens("list", ctxA).result.worlds.length, 1);
    assert.equal(callLens("list", ctxB).result.worlds.length, 0);

    // discover surfaces the PUBLIC world cross-user
    const disc = callLens("discover", ctxB, {});
    assert.equal(disc.ok, true);
    assert.equal(disc.result.worlds.length, 1);
    assert.equal(disc.result.worlds[0].name, "Public Realm");
    assert.equal(disc.result.total, 1);
  });

  it("hides private worlds from discover but shows them to the owner", () => {
    spawn(ctxA, { name: "Secret Realm", privacy: "private" });
    assert.equal(callLens("discover", ctxB, {}).result.worlds.length, 0);
    assert.equal(callLens("discover", ctxA, {}).result.worlds.length, 1);
  });

  it("filters discover by query and kind", () => {
    spawn(ctxA, { name: "Ocean Sim", kind: "physics_simulator" });
    spawn(ctxA, { name: "Math Zone", kind: "research_zone" });
    assert.equal(callLens("discover", ctxB, { query: "ocean" }).result.worlds.length, 1);
    assert.equal(callLens("discover", ctxB, { kind: "research_zone" }).result.worlds.length, 1);
  });
});

describe("sub-worlds lens — favorite → my_favorites reflects it", () => {
  it("favorites a world, lists it, then unfavorites it", () => {
    const w = spawn(ctxA);
    assert.equal(callLens("my_favorites", ctxB).result.worlds.length, 0);

    const fav = callLens("favorite", ctxB, { worldId: w.world_id });
    assert.equal(fav.ok, true);
    assert.equal(fav.result.favorited, true);
    assert.equal(fav.result.favorites, 1);

    const myFavs = callLens("my_favorites", ctxB);
    assert.equal(myFavs.result.worlds.length, 1);
    assert.equal(myFavs.result.worlds[0].world_id, w.world_id);

    const unfav = callLens("favorite", ctxB, { worldId: w.world_id, favorite: false });
    assert.equal(unfav.result.favorited, false);
    assert.equal(unfav.result.favorites, 0);
    assert.equal(callLens("my_favorites", ctxB).result.worlds.length, 0);
  });

  it("favorite on an unknown world returns ok:false 'world not found'", () => {
    const r = callLens("favorite", ctxA, { worldId: "nope" });
    assert.equal(r.ok, false);
    assert.equal(r.error, "world not found");
  });
});

describe("sub-worlds lens — set_status mutates the real row", () => {
  it("pauses then resumes the owner's world", () => {
    const w = spawn(ctxA);
    const paused = callLens("set_status", ctxA, { worldId: w.world_id, status: "paused" });
    assert.equal(paused.ok, true);
    assert.equal(paused.result.world.status, "paused");
    // the change is persisted — list reflects it
    assert.equal(callLens("list", ctxA).result.worlds[0].status, "paused");

    const active = callLens("set_status", ctxA, { worldId: w.world_id, status: "active" });
    assert.equal(active.result.world.status, "active");
  });

  it("rejects a bogus status and an unauthorized actor", () => {
    const w = spawn(ctxA);
    assert.equal(callLens("set_status", ctxA, { worldId: w.world_id, status: "bogus" }).ok, false);
    const hijack = callLens("set_status", ctxB, { worldId: w.world_id, status: "paused" });
    assert.equal(hijack.ok, false);
    assert.equal(hijack.error, "not authorized");
  });
});

describe("sub-worlds lens — visit increments real counters + hands off to world-travel", () => {
  it("records visits, unique visitors, and the travel destination", () => {
    const w = spawn(ctxA);
    const v1 = callLens("visit", ctxB, { worldId: w.world_id });
    assert.equal(v1.ok, true);
    assert.equal(v1.result.travel.destination_world_id, w.world_id);
    assert.equal(v1.result.visits, 1);
    assert.equal(v1.result.unique_visitors, 1);

    callLens("visit", ctxB, { worldId: w.world_id }); // repeat visitor
    const v3 = callLens("visit", ctxA, { worldId: w.world_id }); // new unique visitor
    assert.equal(v3.result.visits, 3);
    assert.equal(v3.result.unique_visitors, 2);
  });

  it("refuses to visit an archived world and an unknown world", () => {
    const w = spawn(ctxA);
    callLens("archive", ctxA, { worldId: w.world_id });
    assert.equal(callLens("visit", ctxB, { worldId: w.world_id }).ok, false);
    assert.equal(callLens("visit", ctxB, { worldId: "ghost" }).error, "world not found");
  });
});

describe("sub-worlds lens — fail-CLOSED numeric guards (macro-assassin V2)", () => {
  it("rejects a poisoned capacity on spawn", () => {
    for (const bad of [NaN, Infinity, -Infinity, -1, 1e308]) {
      const r = callLens("spawn", ctxA, { name: "Bad Capacity", capacity: bad });
      assert.equal(r.ok, false, `capacity ${bad} should fail closed`);
      assert.equal(r.error, "bad_numeric_field");
      assert.equal(r.field, "capacity");
    }
    // a clean capacity still works
    assert.equal(spawn(ctxA, { capacity: 50 }).capacity, 50);
  });

  it("rejects a poisoned limit on discover", () => {
    spawn(ctxA, { name: "Findable", privacy: "public" });
    for (const bad of [NaN, Infinity, -1]) {
      const r = callLens("discover", ctxB, { limit: bad });
      assert.equal(r.ok, false, `limit ${bad} should fail closed`);
      assert.equal(r.error, "bad_numeric_field");
    }
    // a clean limit still works
    assert.equal(callLens("discover", ctxB, { limit: 10 }).ok, true);
  });

  it("rejects a poisoned capacity on update_settings", () => {
    const w = spawn(ctxA);
    const r = callLens("update_settings", ctxA, { worldId: w.world_id, capacity: NaN });
    assert.equal(r.ok, false);
    assert.equal(r.error, "bad_numeric_field");
    // clean capacity update works and persists
    const ok = callLens("update_settings", ctxA, { worldId: w.world_id, capacity: 99 });
    assert.equal(ok.result.world.capacity, 99);
  });
});
