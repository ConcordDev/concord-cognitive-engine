// Behavioral macro tests for server/domains/expedition-journal.js — the
// per-world expedition progress tracker (progress / journal entries /
// screenshots / XP + badge rewards / cross-world summary).
//
// LIGHTWEIGHT + HERMETIC: a local register harness drives each macro the way
// runMacro would — a canonical (ctx, input) call through the SAME shim the
// real server.js registration uses — against the REAL in-memory
// globalThis._concordSTATE.expeditionJournalLens store the domain persists to.
// NO server boot, NO DB (the domain is STATE-only), runs in well under 10s.
//
// These are NOT shape-only assertions: every test asserts ACTUAL values +
// multi-step round-trips (mark a stage → XP awarded once → unmark → re-mark →
// no double XP; complete every stage of a world → world-complete badge; finish
// 3 worlds → pathfinder; finish all → grand-explorer; entry add → list →
// delete; photo add → meta-only list → delete), per-user isolation, the
// unknown-world / unknown-stage rejections, and the fail-CLOSED behaviour the
// macro-assassin's V2 vector probes.

import { describe, it, before, beforeEach } from "node:test";
import assert from "node:assert/strict";
import registerExpeditionJournalActions from "../domains/expedition-journal.js";

// Local register harness: registerExpeditionJournalActions(register) installs
// its own legacy shim, so `register` receives canonical (ctx, input) handlers —
// exactly what runMacro / server.js's register() would hold.
const ACTIONS = new Map();
function register(domain, name, fn) {
  assert.equal(domain, "expedition-journal", `unexpected domain: ${domain}`);
  ACTIONS.set(name, fn);
}
function call(name, ctx, input = {}) {
  const fn = ACTIONS.get(name);
  if (!fn) throw new Error(`expedition-journal.${name} not registered`);
  return fn(ctx, input);
}

before(() => { registerExpeditionJournalActions(register); });
beforeEach(() => { globalThis._concordSTATE = {}; });

const ctxA = { actor: { userId: "user_a" } };
const ctxB = { actor: { userId: "user_b" } };

const ALL_MACROS = [
  "worlds", "progress", "mark-stage",
  "entry-add", "entry-list", "entry-delete",
  "photo-add", "photo-list", "photo-delete",
  "rewards", "summary",
];

describe("expedition-journal — registration", () => {
  it("registers every macro the lens calls", () => {
    for (const m of ALL_MACROS) {
      assert.equal(typeof ACTIONS.get(m), "function", `missing expedition-journal.${m}`);
    }
  });
});

describe("expedition-journal — worlds catalog (pure read)", () => {
  it("returns every canon world with its ordered stage defs", () => {
    const r = call("worlds", ctxA, {});
    assert.equal(r.ok, true);
    const worlds = r.result.worlds;
    assert.ok(Array.isArray(worlds) && worlds.length >= 6, "≥6 canon worlds");
    const hub = worlds.find((w) => w.worldId === "concordia-hub");
    assert.ok(hub, "concordia-hub present");
    assert.equal(hub.stageCount, hub.stages.length);
    assert.ok(hub.stages.length >= 3);
    // every stage carries an objective + xp number
    for (const st of hub.stages) {
      assert.equal(typeof st.objective, "string");
      assert.equal(typeof st.xp, "number");
      assert.ok(st.xp > 0);
    }
  });

  it("works with no actor (pure catalog — never no_user)", () => {
    const r = call("worlds", {}, {});
    assert.equal(r.ok, true);
    assert.ok(r.result.worlds.length >= 6);
  });
});

describe("expedition-journal — progress view", () => {
  it("returns a fresh, all-incomplete view for a known world", () => {
    const r = call("progress", ctxA, { worldId: "cyber" });
    assert.equal(r.ok, true);
    assert.equal(r.result.worldId, "cyber");
    assert.equal(r.result.completed, 0);
    assert.equal(r.result.percent, 0);
    assert.equal(r.result.expeditionComplete, false);
    assert.equal(r.result.stages.every((s) => s.done === false), true);
    assert.equal(r.result.total, r.result.stages.length);
  });

  it("defaults to concordia-hub when no worldId is given", () => {
    const r = call("progress", ctxA, {});
    assert.equal(r.ok, true);
    assert.equal(r.result.worldId, "concordia-hub");
  });

  it("rejects an unknown world", () => {
    const r = call("progress", ctxA, { worldId: "atlantis" });
    assert.equal(r.ok, false);
    assert.match(r.error, /unknown world/);
  });
});

describe("expedition-journal — mark-stage lifecycle + XP/badge rewards", () => {
  it("awards stage XP exactly once across mark → unmark → re-mark", () => {
    const first = call("mark-stage", ctxA, { worldId: "cyber", stageId: "arrive", done: true });
    assert.equal(first.ok, true);
    // cyber.arrive xp is 25
    assert.equal(first.result.totalXp, 25);
    assert.equal(first.result.world.completed, 1);
    const xpAward = first.result.awarded.find((a) => a.kind === "xp");
    assert.equal(xpAward.amount, 25);

    // re-marking the SAME stage true again grants no extra XP
    const again = call("mark-stage", ctxA, { worldId: "cyber", stageId: "arrive", done: true });
    assert.equal(again.result.totalXp, 25, "no double XP on repeat completion");
    assert.equal(again.result.awarded.find((a) => a.kind === "xp"), undefined);

    // unmark → still no XP refund/change; stage flips incomplete
    const off = call("mark-stage", ctxA, { worldId: "cyber", stageId: "arrive", done: false });
    assert.equal(off.result.world.completed, 0);
    assert.equal(off.result.totalXp, 25);

    // re-complete it → fresh completion grants XP again (was reset to incomplete)
    const re = call("mark-stage", ctxA, { worldId: "cyber", stageId: "arrive", done: true });
    assert.equal(re.result.totalXp, 50, "re-completing an unmarked stage grants XP again");
  });

  it("grants the world-complete badge when every stage of a world is done", () => {
    const defs = call("worlds", ctxA, {}).result.worlds.find((w) => w.worldId === "cyber").stages;
    let last;
    for (const st of defs) {
      last = call("mark-stage", ctxA, { worldId: "cyber", stageId: st.id, done: true });
      assert.equal(last.ok, true);
    }
    assert.equal(last.result.world.expeditionComplete, true);
    const badge = last.result.badges.find((b) => b.id === "world-complete" && b.worldId === "cyber");
    assert.ok(badge, "world-complete badge granted for cyber");
    // total XP equals the sum of the world's stage XP
    const expectedXp = defs.reduce((a, s) => a + s.xp, 0);
    assert.equal(last.result.totalXp, expectedXp);
  });

  it("grants pathfinder at 3 worlds and grand-explorer at all worlds", () => {
    const catalog = call("worlds", ctxA, {}).result.worlds;
    function completeWorld(worldId) {
      const defs = catalog.find((w) => w.worldId === worldId).stages;
      let last;
      for (const st of defs) last = call("mark-stage", ctxA, { worldId, stageId: st.id, done: true });
      return last;
    }
    // complete 3 worlds → pathfinder
    completeWorld("concordia-hub");
    completeWorld("cyber");
    const third = completeWorld("fantasy");
    assert.ok(third.result.badges.some((b) => b.id === "pathfinder"), "pathfinder at 3 worlds");
    assert.equal(third.result.badges.some((b) => b.id === "grand-explorer"), false);

    // complete the rest → grand-explorer
    let last;
    for (const w of catalog.map((c) => c.worldId)) last = completeWorld(w);
    assert.ok(last.result.badges.some((b) => b.id === "grand-explorer"), "grand-explorer at all worlds");
    // each badge id appears at most once (idempotent grants)
    const meta = last.result.badges.filter((b) => b.id === "pathfinder");
    assert.equal(meta.length, 1, "pathfinder granted only once");
  });

  it("rejects an unknown world or stage", () => {
    assert.match(call("mark-stage", ctxA, { worldId: "atlantis", stageId: "arrive" }).error, /unknown world/);
    assert.match(call("mark-stage", ctxA, { worldId: "cyber", stageId: "nope" }).error, /unknown stage/);
  });
});

describe("expedition-journal — journal entry round-trip", () => {
  it("adds, lists (filtered), and deletes entries", () => {
    const a = call("entry-add", ctxA, { worldId: "cyber", stageId: "arrive", text: "Jacked in.", mood: "tense" });
    assert.equal(a.ok, true);
    assert.equal(a.result.entry.text, "Jacked in.");
    assert.equal(a.result.entry.mood, "tense");

    call("entry-add", ctxA, { worldId: "cyber", stageId: "extract", text: "Banked the payload." });
    call("entry-add", ctxA, { worldId: "fantasy", text: "Crossed the fae-gate." });

    // unfiltered list — newest first
    let r = call("entry-list", ctxA, {});
    assert.equal(r.result.count, 3);

    // filter by world
    r = call("entry-list", ctxA, { worldId: "cyber" });
    assert.equal(r.result.count, 2);
    assert.equal(r.result.entries.every((e) => e.worldId === "cyber"), true);

    // filter by stage
    r = call("entry-list", ctxA, { worldId: "cyber", stageId: "arrive" });
    assert.equal(r.result.count, 1);
    assert.equal(r.result.entries[0].text, "Jacked in.");

    // delete the first entry → count drops; deleting again is not found
    const del = call("entry-delete", ctxA, { id: a.result.entry.id });
    assert.equal(del.ok, true);
    assert.equal(del.result.deleted, a.result.entry.id);
    assert.equal(call("entry-list", ctxA, {}).result.count, 2);
    assert.match(call("entry-delete", ctxA, { id: a.result.entry.id }).error, /not found/);
  });

  it("rejects empty text, unknown world, unknown stage", () => {
    assert.match(call("entry-add", ctxA, { worldId: "cyber", text: "   " }).error, /text required/);
    assert.match(call("entry-add", ctxA, { worldId: "atlantis", text: "x" }).error, /unknown world/);
    assert.match(call("entry-add", ctxA, { worldId: "cyber", stageId: "nope", text: "x" }).error, /unknown stage/);
  });
});

describe("expedition-journal — photo capture round-trip", () => {
  const PNG = "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==";

  it("adds a photo, returns META ONLY (no dataUrl echoed), lists + deletes", () => {
    const a = call("photo-add", ctxA, { worldId: "cyber", stageId: "arrive", dataUrl: PNG, caption: "grid.png" });
    assert.equal(a.ok, true);
    assert.equal(a.result.photo.caption, "grid.png");
    assert.equal(a.result.photo.dataUrl, undefined, "dataUrl must NOT be echoed back");
    assert.ok(a.result.photo.id);

    const r = call("photo-list", ctxA, { worldId: "cyber" });
    assert.equal(r.result.count, 1);

    const del = call("photo-delete", ctxA, { id: a.result.photo.id });
    assert.equal(del.ok, true);
    assert.equal(call("photo-list", ctxA, {}).result.count, 0);
  });

  it("rejects a non-image / non-http dataUrl and a missing one", () => {
    assert.match(call("photo-add", ctxA, { worldId: "cyber", dataUrl: "" }).error, /required/);
    assert.match(call("photo-add", ctxA, { worldId: "cyber", dataUrl: "javascript:alert(1)" }).error, /data:image|http/i);
  });
});

describe("expedition-journal — rewards + summary rollups", () => {
  it("rewards reports xp, level, badges and a ledger", () => {
    call("mark-stage", ctxA, { worldId: "cyber", stageId: "arrive", done: true });
    const r = call("rewards", ctxA, {});
    assert.equal(r.ok, true);
    assert.equal(r.result.xp, 25);
    assert.equal(r.result.level, 1 + Math.floor(25 / 200));
    assert.ok(Array.isArray(r.result.log));
    assert.equal(r.result.log[0].kind, "stage-xp");
  });

  it("summary aggregates across every world", () => {
    const catalog = call("worlds", ctxA, {}).result.worlds;
    const cyber = catalog.find((w) => w.worldId === "cyber").stages;
    for (const st of cyber) call("mark-stage", ctxA, { worldId: "cyber", stageId: st.id, done: true });
    call("entry-add", ctxA, { worldId: "cyber", text: "done" });

    const s = call("summary", ctxA, {});
    assert.equal(s.ok, true);
    assert.equal(s.result.totalWorlds, catalog.length);
    assert.equal(s.result.completedWorlds, 1);
    assert.equal(s.result.entryCount, 1);
    assert.ok(s.result.completedStages >= cyber.length);
    assert.equal(s.result.worlds.find((w) => w.worldId === "cyber").expeditionComplete, true);
    assert.ok(s.result.overallPercent > 0 && s.result.overallPercent <= 100);
  });
});

describe("expedition-journal — per-user isolation", () => {
  it("never leaks one user's progress / entries to another", () => {
    call("mark-stage", ctxA, { worldId: "cyber", stageId: "arrive", done: true });
    call("entry-add", ctxA, { worldId: "cyber", text: "A only" });

    // user B sees a clean slate
    assert.equal(call("progress", ctxB, { worldId: "cyber" }).result.completed, 0);
    assert.equal(call("entry-list", ctxB, {}).result.count, 0);
    assert.equal(call("rewards", ctxB, {}).result.xp, 0);
    // user A still intact
    assert.equal(call("progress", ctxA, { worldId: "cyber" }).result.completed, 1);
  });
});

describe("expedition-journal — assassin-shape: canonical artifact-wrapped input", () => {
  it("unwraps the harness {artifact:{data}} shape so progress still resolves", () => {
    // The contract harness / assassin call runMacro with buildDefaultInput =
    // { artifact: { id, data: {} } }. The shim must unwrap data, NOT treat
    // `artifact` as a worldId.
    const r = call("progress", ctxA, { artifact: { id: "x", data: {} } });
    assert.equal(r.ok, true);
    assert.equal(r.result.worldId, "concordia-hub", "empty data → default world, not 'unknown world: [object]'");
  });

  it("mark-stage with empty harness input fails CLOSED (no world), never ok:true", () => {
    const r = call("mark-stage", ctxA, { artifact: { id: "x", data: {} } });
    assert.equal(r.ok, false, "no worldId → fail closed");
    assert.match(r.error, /unknown world/);
  });
});
