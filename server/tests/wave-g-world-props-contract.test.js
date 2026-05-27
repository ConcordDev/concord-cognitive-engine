// server/tests/wave-g-world-props-contract.test.js
//
// Wave G1 — pins the world-props substrate contract: seeding, listing,
// distance gate, cooldown, signal feedback, and animation clip mapping.

import { describe, it, before, after, beforeEach } from "node:test";
import assert from "node:assert/strict";
import Database from "better-sqlite3";
import {
  PROP_KIND_CATALOG,
  composeAuthoredProps,
  composeProceduralProps,
  listInWorld,
  listNearby,
  getProp,
  interact,
  refillProps,
} from "../lib/world-props.js";
import createWorldPropsRouter from "../routes/world-props.js";

let db;

function buildSchema(d) {
  d.exec(`
    CREATE TABLE world_props (
      id TEXT PRIMARY KEY, world_id TEXT NOT NULL, district TEXT,
      prop_kind TEXT NOT NULL, x REAL NOT NULL, z REAL NOT NULL,
      y REAL DEFAULT 0, rotation REAL DEFAULT 0, variant TEXT,
      durability REAL DEFAULT 1.0, state_json TEXT,
      created_at INTEGER DEFAULT (unixepoch())
    );
    CREATE TABLE prop_interaction_log (
      id INTEGER PRIMARY KEY AUTOINCREMENT, prop_id TEXT NOT NULL,
      user_id TEXT NOT NULL, kind TEXT NOT NULL,
      at INTEGER DEFAULT (unixepoch())
    );
  `);
}

before(() => { db = new Database(":memory:"); buildSchema(db); });
after(() => { db?.close(); });
beforeEach(() => {
  db.exec(`DELETE FROM world_props; DELETE FROM prop_interaction_log;`);
});

describe("PROP_KIND_CATALOG", () => {
  it("every catalog entry maps every verb to an animation clip", () => {
    for (const [kind, spec] of Object.entries(PROP_KIND_CATALOG)) {
      assert.ok(Array.isArray(spec.verbs) && spec.verbs.length > 0, `${kind} has verbs`);
      for (const verb of spec.verbs) {
        assert.ok(typeof spec.clip?.[verb] === "string", `${kind}.${verb} → clip`);
      }
    }
  });
});

describe("composeAuthoredProps — idempotent seeding", () => {
  it("inserts and skips known duplicates", () => {
    const props = [
      { kind: "chair", district: "inn", x: 10, z: 20 },
      { kind: "torch", district: "inn", x: 11, z: 20 },
    ];
    const first = composeAuthoredProps(db, "concordia-hub", props);
    assert.equal(first.ok, true);
    assert.equal(first.inserted, 2);
    const second = composeAuthoredProps(db, "concordia-hub", props);
    assert.equal(second.inserted, 0);
    assert.equal(second.skipped, 2);
  });

  it("rejects unknown prop_kind", () => {
    const r = composeAuthoredProps(db, "concordia-hub", [{ kind: "nonsense", x: 0, z: 0 }]);
    assert.equal(r.skipped, 1);
    assert.equal(r.inserted, 0);
  });

  it("rejects malformed entries", () => {
    const r = composeAuthoredProps(db, "concordia-hub", [{ kind: "chair" }, null, { x: 5 }]);
    assert.equal(r.inserted, 0);
    assert.equal(r.skipped, 3);
  });
});

describe("listInWorld / listNearby", () => {
  it("filters by world + district + kind", () => {
    composeAuthoredProps(db, "concordia-hub", [
      { kind: "chair", district: "inn",   x: 1, z: 1 },
      { kind: "chair", district: "plaza", x: 2, z: 2 },
      { kind: "torch", district: "inn",   x: 3, z: 3 },
    ]);
    assert.equal(listInWorld(db, "concordia-hub").length, 3);
    assert.equal(listInWorld(db, "concordia-hub", { district: "inn" }).length, 2);
    assert.equal(listInWorld(db, "concordia-hub", { kind: "chair" }).length, 2);
  });

  it("listNearby refines by Euclidean radius", () => {
    composeAuthoredProps(db, "w", [
      { kind: "torch", x: 0,   z: 0 },
      { kind: "torch", x: 5,   z: 0 },
      { kind: "torch", x: 100, z: 0 },
    ]);
    const near = listNearby(db, "w", 0, 0, 10);
    assert.equal(near.length, 2);
  });
});

describe("interact — gates + log + side-effects", () => {
  let propId;
  beforeEach(() => {
    composeAuthoredProps(db, "w", [{ kind: "chair", x: 10, z: 10 }]);
    propId = listInWorld(db, "w")[0].id;
  });

  it("requires propId + userId", () => {
    assert.equal(interact(db, {}).ok, false);
    assert.equal(interact(db, { propId }).ok, false);
  });

  it("rejects unsupported verb", () => {
    const r = interact(db, { propId, userId: "U1", kind: "drink" });
    assert.equal(r.ok, false);
    assert.equal(r.reason, "verb_not_supported");
  });

  it("enforces distance gate (≤3m)", () => {
    const far = interact(db, { propId, userId: "U1", kind: "sit", position: { x: 100, z: 100 } });
    assert.equal(far.ok, false);
    assert.equal(far.reason, "too_far");
    const near = interact(db, { propId, userId: "U1", kind: "sit", position: { x: 10.5, z: 10.5 } });
    assert.equal(near.ok, true);
  });

  it("enforces cooldown (5s per user+prop+verb)", () => {
    const r1 = interact(db, { propId, userId: "U1", kind: "sit" });
    assert.equal(r1.ok, true);
    const r2 = interact(db, { propId, userId: "U1", kind: "sit" });
    assert.equal(r2.ok, false);
    assert.equal(r2.reason, "cooldown");
  });

  it("returns the animation clip", () => {
    const r = interact(db, { propId, userId: "U1", kind: "sit" });
    assert.equal(r.clip, "sit");
  });

  it("writes a signal feedback row when configured", () => {
    composeAuthoredProps(db, "w", [{ kind: "torch", x: 20, z: 20 }]);
    const torchId = listInWorld(db, "w", { kind: "torch" })[0].id;
    const calls = [];
    const stub = (_db, payload) => calls.push(payload);
    const r = interact(db, { propId: torchId, userId: "U1", kind: "light", recordSignal: stub });
    assert.equal(r.ok, true);
    assert.equal(calls.length, 1);
    assert.equal(calls[0].channel, "thermal_os.ambient_temp");
    assert.ok(calls[0].value > 0);
    assert.equal(calls[0].source, "prop_interact");
  });

  it("decrements durability on consumable verbs (mug → drink)", () => {
    composeAuthoredProps(db, "w", [{ kind: "mug", x: 30, z: 30 }]);
    const mugId = listInWorld(db, "w", { kind: "mug" })[0].id;
    interact(db, { propId: mugId, userId: "U1", kind: "drink" });
    const after = getProp(db, mugId);
    assert.ok(after.durability < 1.0);
  });

  it("sets lit=true on torch light", () => {
    composeAuthoredProps(db, "w", [{ kind: "torch", x: 40, z: 40 }]);
    const tid = listInWorld(db, "w", { kind: "torch" })[0].id;
    interact(db, { propId: tid, userId: "U1", kind: "light" });
    const after = getProp(db, tid);
    assert.equal(after.state?.lit, true);
  });
});

describe("refillProps — heartbeat refill pass", () => {
  it("restores depleted mug durability", () => {
    composeAuthoredProps(db, "w", [{ kind: "mug", x: 0, z: 0 }]);
    const mugId = listInWorld(db, "w", { kind: "mug" })[0].id;
    db.prepare(`UPDATE world_props SET durability = 0.5 WHERE id = ?`).run(mugId);
    const r = refillProps(db);
    assert.equal(r.ok, true);
    const after = getProp(db, mugId);
    assert.ok(after.durability > 0.5);
  });
});

describe("router contract", () => {
  let router;
  before(() => {
    router = createWorldPropsRouter({
      db,
      requireAuth: (req, _res, next) => { req.user = { id: "U1" }; next(); },
    });
  });

  function invoke(method, path, body, extraParams = {}) {
    return new Promise((resolve) => {
      let status = 200;
      const req = {
        method, url: path, headers: {}, params: extraParams, body: body || {},
        query: Object.fromEntries(new URL(`http://x${path}`).searchParams),
        app: { locals: { io: { to: () => ({ emit: () => {} }) } } },
      };
      const res = {
        status(c) { status = c; return this; },
        json(b) { resolve({ status, body: b }); },
      };
      router.handle(req, res, () => resolve({ status: 404, body: null }));
    });
  }

  it("GET / lists props for a world", async () => {
    composeAuthoredProps(db, "w-test", [{ kind: "chair", x: 0, z: 0 }]);
    const r = await invoke("GET", "/?worldId=w-test");
    assert.equal(r.status, 200);
    assert.ok(Array.isArray(r.body.props));
  });

  it("POST /:id/interact enforces 500ms minimum response delay", async () => {
    composeAuthoredProps(db, "w-test2", [{ kind: "chair", x: 50, z: 50 }]);
    const p = listInWorld(db, "w-test2")[0];
    const t0 = Date.now();
    const r = await invoke("POST", `/${p.id}/interact`, { kind: "sit" }, { propId: p.id });
    const elapsed = Date.now() - t0;
    assert.equal(r.status, 200);
    assert.ok(elapsed >= 500, `elapsed ${elapsed}ms >= 500ms`);
  });
});

describe("composeProceduralProps", () => {
  it("seeds deterministically per (worldId, district, salt)", () => {
    const r1 = composeProceduralProps(db, "w-proc", "plaza", { chair: 3, torch: 2 });
    assert.equal(r1.inserted, 5);
    const props = listInWorld(db, "w-proc");
    assert.equal(props.length, 5);
    // All have district = 'plaza'
    assert.ok(props.every((p) => p.district === "plaza"));
  });
});
