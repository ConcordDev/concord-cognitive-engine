/**
 * Tier-2 contract tests for world-event scheduler cadence enforcement.
 *
 * Locks down the per-event-type CADENCE_MS table (server/lib/world-event-scheduler.js:29-43)
 * and the no-double-fire-within-window guarantee at line 146.
 *
 * Each test uses a unique worldId so the module-level _lastGeneratedAt Map
 * doesn't leak state between cases.
 *
 * Run: node --test tests/world-event-scheduler.test.js
 */

import { describe, it } from "node:test";
import assert from "node:assert/strict";

import { scheduleEventsForWorld, tick } from "../lib/world-event-scheduler.js";
import { validateEvent } from "../lib/event-shapes.js";

const ONE_HOUR_MS = 60 * 60 * 1000;
const ONE_DAY_MS  = 24 * ONE_HOUR_MS;

let _testWorldCounter = 0;
function uniqueWorld(tag) {
  return `wtest-${tag}-${Date.now()}-${++_testWorldCounter}`;
}

function typesCreated(result) {
  return new Set(result.created.map((c) => c.type));
}

describe("scheduleEventsForWorld — first call seeds every event type", () => {
  it("first invocation creates one of each event type", () => {
    const worldId = uniqueWorld("seed");
    const r = scheduleEventsForWorld({ worldId, now: Date.now() });
    assert.equal(r.ok, true);
    const types = typesCreated(r);
    // 13 EVENT_TYPES are scheduled (per CADENCE_MS table).
    for (const t of [
      "meetup", "market", "workshop", "debate", "exhibition",
      "concert", "tournament", "hackathon", "ceremony",
      "rally", "festival", "raid", "referendum",
    ]) {
      assert.ok(types.has(t), `expected first call to schedule ${t}`);
    }
  });

  it("returns {ok:false, reason:'no_world_id'} for missing worldId", () => {
    const r = scheduleEventsForWorld({ worldId: "" });
    assert.equal(r.ok, false);
    assert.equal(r.reason, "no_world_id");
    assert.deepStrictEqual(r.created, []);
  });
});

describe("scheduleEventsForWorld — daily cadence (meetup, market)", () => {
  it("does not re-create within the same day", () => {
    const worldId = uniqueWorld("daily-noop");
    const t0 = Date.UTC(2026, 4, 1, 0, 0, 0);
    scheduleEventsForWorld({ worldId, now: t0 });

    // 12 hours later: should not re-fire daily events
    const r2 = scheduleEventsForWorld({ worldId, now: t0 + 12 * ONE_HOUR_MS });
    const types = typesCreated(r2);
    assert.equal(types.has("meetup"), false, "meetup must not double-fire within 24h");
    assert.equal(types.has("market"), false, "market must not double-fire within 24h");
  });

  it("re-creates after 24h", () => {
    const worldId = uniqueWorld("daily-rerun");
    const t0 = Date.UTC(2026, 4, 1, 0, 0, 0);
    scheduleEventsForWorld({ worldId, now: t0 });

    const r2 = scheduleEventsForWorld({ worldId, now: t0 + ONE_DAY_MS + 1 });
    const types = typesCreated(r2);
    assert.ok(types.has("meetup"), "meetup must re-fire after 24h");
    assert.ok(types.has("market"), "market must re-fire after 24h");
  });
});

describe("scheduleEventsForWorld — 3.5d cadence (workshop, debate, exhibition)", () => {
  it("does not re-create within 3.5d", () => {
    const worldId = uniqueWorld("3d-noop");
    const t0 = Date.UTC(2026, 4, 1, 0, 0, 0);
    scheduleEventsForWorld({ worldId, now: t0 });

    const r2 = scheduleEventsForWorld({ worldId, now: t0 + 3 * ONE_DAY_MS });
    const types = typesCreated(r2);
    for (const t of ["workshop", "debate", "exhibition"]) {
      assert.equal(types.has(t), false, `${t} must wait the full 3.5d window`);
    }
  });

  it("re-creates after 3.5d", () => {
    const worldId = uniqueWorld("3d-rerun");
    const t0 = Date.UTC(2026, 4, 1, 0, 0, 0);
    scheduleEventsForWorld({ worldId, now: t0 });

    const r2 = scheduleEventsForWorld({ worldId, now: t0 + 4 * ONE_DAY_MS });
    const types = typesCreated(r2);
    for (const t of ["workshop", "debate", "exhibition"]) {
      assert.ok(types.has(t), `${t} must re-fire after 3.5d`);
    }
  });
});

describe("scheduleEventsForWorld — weekly cadence (concert, tournament, hackathon, ceremony)", () => {
  it("does not re-create within 7d", () => {
    const worldId = uniqueWorld("week-noop");
    const t0 = Date.UTC(2026, 4, 1, 0, 0, 0);
    scheduleEventsForWorld({ worldId, now: t0 });

    const r2 = scheduleEventsForWorld({ worldId, now: t0 + 6 * ONE_DAY_MS });
    const types = typesCreated(r2);
    for (const t of ["concert", "tournament", "hackathon", "ceremony"]) {
      assert.equal(types.has(t), false, `${t} must wait full 7d window`);
    }
  });

  it("re-creates after 7d", () => {
    const worldId = uniqueWorld("week-rerun");
    const t0 = Date.UTC(2026, 4, 1, 0, 0, 0);
    scheduleEventsForWorld({ worldId, now: t0 });

    const r2 = scheduleEventsForWorld({ worldId, now: t0 + 7 * ONE_DAY_MS + 1 });
    const types = typesCreated(r2);
    for (const t of ["concert", "tournament", "hackathon", "ceremony"]) {
      assert.ok(types.has(t), `${t} must re-fire after 7d`);
    }
  });
});

describe("scheduleEventsForWorld — 14d cadence (raid)", () => {
  it("does not re-create within 14d (e.g., 13d after first)", () => {
    const worldId = uniqueWorld("raid-noop");
    const t0 = Date.UTC(2026, 4, 1, 0, 0, 0);
    scheduleEventsForWorld({ worldId, now: t0 });

    const r2 = scheduleEventsForWorld({ worldId, now: t0 + 13 * ONE_DAY_MS });
    assert.equal(typesCreated(r2).has("raid"), false);
  });

  it("re-creates after 14d", () => {
    const worldId = uniqueWorld("raid-rerun");
    const t0 = Date.UTC(2026, 4, 1, 0, 0, 0);
    scheduleEventsForWorld({ worldId, now: t0 });

    const r2 = scheduleEventsForWorld({ worldId, now: t0 + 14 * ONE_DAY_MS + 1 });
    assert.ok(typesCreated(r2).has("raid"));
  });
});

describe("scheduleEventsForWorld — monthly cadence (rally, festival, referendum)", () => {
  it("does not re-create within 30d (e.g., 29d after first)", () => {
    const worldId = uniqueWorld("month-noop");
    const t0 = Date.UTC(2026, 4, 1, 0, 0, 0);
    scheduleEventsForWorld({ worldId, now: t0 });

    const r2 = scheduleEventsForWorld({ worldId, now: t0 + 29 * ONE_DAY_MS });
    const types = typesCreated(r2);
    for (const t of ["rally", "festival", "referendum"]) {
      assert.equal(types.has(t), false, `${t} must wait 30d`);
    }
  });

  it("re-creates after 30d", () => {
    const worldId = uniqueWorld("month-rerun");
    const t0 = Date.UTC(2026, 4, 1, 0, 0, 0);
    scheduleEventsForWorld({ worldId, now: t0 });

    const r2 = scheduleEventsForWorld({ worldId, now: t0 + 30 * ONE_DAY_MS + 1 });
    const types = typesCreated(r2);
    for (const t of ["rally", "festival", "referendum"]) {
      assert.ok(types.has(t), `${t} must re-fire after 30d`);
    }
  });
});

describe("scheduleEventsForWorld — district affinity per event type", () => {
  // Helper: collect district IDs created across many runs (use unique worlds
  // per call and pick a long window so all types fire each call).
  function districtsForType(eventType, runs = 30) {
    const districts = new Set();
    let t = Date.UTC(2026, 4, 1, 0, 0, 0);
    for (let i = 0; i < runs; i++) {
      const worldId = uniqueWorld(`aff-${eventType}-${i}`);
      const r = scheduleEventsForWorld({ worldId, now: t });
      for (const c of r.created) if (c.type === eventType) districts.add(c.districtId);
      t += ONE_DAY_MS * 31; // advance well past every cadence
    }
    return districts;
  }

  it("concerts land in arts/nexus districts", () => {
    const ds = districtsForType("concert");
    for (const d of ds) {
      assert.ok(["district-arts", "district-nexus"].includes(d), `concert hit unexpected district ${d}`);
    }
    assert.ok(ds.size >= 1);
  });

  it("markets land in exchange/commons districts", () => {
    const ds = districtsForType("market");
    for (const d of ds) {
      assert.ok(["district-exchange", "district-commons"].includes(d), `market hit unexpected district ${d}`);
    }
  });

  it("raids land in arena/frontier districts", () => {
    const ds = districtsForType("raid");
    for (const d of ds) {
      assert.ok(["district-arena", "district-frontier"].includes(d), `raid hit unexpected district ${d}`);
    }
  });

  it("hackathons land in tech/grid districts", () => {
    const ds = districtsForType("hackathon");
    for (const d of ds) {
      assert.ok(["district-tech", "district-grid"].includes(d), `hackathon hit unexpected district ${d}`);
    }
  });
});

describe("scheduleEventsForWorld — created event payload shape", () => {
  it("each created entry has id, type, districtId, hostId, reward", () => {
    const worldId = uniqueWorld("shape");
    const r = scheduleEventsForWorld({ worldId, now: Date.now() });
    for (const c of r.created) {
      assert.ok(c.id, "missing id");
      assert.ok(c.type, "missing type");
      assert.ok(c.districtId, "missing districtId");
      assert.ok(c.hostId, "missing hostId");
      assert.ok(c.reward, "missing reward");
      assert.equal(typeof c.reward.cc, "number");
    }
  });
});

// Wave 4 (docs/lens-specs/spectate-capability-map.md "Honest residual" closure)
// — verifies world:event:scheduled's payload (what server.js's
// world_event_scheduler_tick heartbeat block actually emits via
// `REALTIME?.io?.emit?.("world:event:scheduled", c)` for each `c` in
// `tick().created`) already carries the real worldId of the world it fired
// for, and that the new event-shapes.js entry accepts it. Unlike combat:hit/
// dtu:promoted/the faction:* events, this emit site needed NO server.js
// payload change — only the previously-missing schema registration — because
// `tick()` already merges `{ ...c, worldId }` onto every created item
// (server/lib/world-event-scheduler.js, confirmed via git blame at the
// original commit, not a recent fix).
describe("tick() — worldId on every created event (world:event:scheduled payload)", () => {
  it("merges the real worldId onto every created event, matching the world it scheduled for", () => {
    const worldId = uniqueWorld("tick-worldid");
    const r = tick({ worlds: [worldId] });
    assert.equal(r.ok, true);
    assert.ok(r.created.length > 0, "first tick should seed events");
    for (const c of r.created) {
      assert.equal(c.worldId, worldId, `created event ${c.type} must carry the world it was scheduled for`);
    }
  });

  it("keeps each world's events scoped to their own worldId across multiple worlds in one tick", () => {
    const worldA = uniqueWorld("tick-multi-a");
    const worldB = uniqueWorld("tick-multi-b");
    const r = tick({ worlds: [worldA, worldB] });
    assert.equal(r.ok, true);
    const worldsSeen = new Set(r.created.map((c) => c.worldId));
    assert.ok(worldsSeen.has(worldA));
    assert.ok(worldsSeen.has(worldB));
    // No cross-contamination: every created event's worldId is one of the
    // two worlds passed in, never invented, never blank.
    for (const c of r.created) {
      assert.ok(c.worldId === worldA || c.worldId === worldB, `unexpected worldId ${c.worldId}`);
    }
  });

  it("the emitted payload shape (each tick() item) validates against event-shapes.js", () => {
    const worldId = uniqueWorld("tick-shape");
    const r = tick({ worlds: [worldId] });
    for (const c of r.created) {
      // This is exactly the object server.js passes to
      // REALTIME.io.emit("world:event:scheduled", c) — no transformation.
      const v = validateEvent("world:event:scheduled", c);
      assert.equal(v.ok, true, `payload for ${c.type} failed shape validation: ${JSON.stringify(v)}`);
    }
  });

  it("a payload missing worldId now fails required-field validation (regression lock)", () => {
    const v = validateEvent("world:event:scheduled", { id: "e1", type: "concert" });
    assert.equal(v.ok, false);
    assert.ok(v.missing.includes("worldId"));
  });
});
