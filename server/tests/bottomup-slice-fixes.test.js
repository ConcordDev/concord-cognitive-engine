// Bottom-up slice pins (B6, CB-0604) — FIX-ghost-tracker-001 server leg.
// An unreadable residue substrate (the drift_alerts table absent on the
// serving DB) must be named substrate_unavailable — never reported as a
// false residue_not_found (the swallowed-error shape), and a genuinely
// missing residue in a READABLE store still reads not_found.
import { describe, it, before } from "node:test";
import assert from "node:assert/strict";
import Database from "better-sqlite3";

import registerGhostHuntMacros from "../domains/ghost-hunt.js";

const ACTIONS = new Map();
function register(domain, name, fn) { ACTIONS.set(`${domain}.${name}`, fn); }
function call(name, ctx, input = {}) {
  const fn = ACTIONS.get(`ghost-hunt.${name}`);
  if (!fn) throw new Error(`ghost-hunt.${name} not registered`);
  return fn(ctx, input);
}
before(() => { registerGhostHuntMacros(register); });

function bareDb() { return new Database(":memory:"); }
function seededDb() {
  const db = new Database(":memory:");
  db.exec(`
    CREATE TABLE drift_alerts (id TEXT PRIMARY KEY, drift_type TEXT, severity TEXT,
      signature TEXT, context_json TEXT, detected_at INTEGER);
    CREATE TABLE dtus (id TEXT PRIMARY KEY, owner_user_id TEXT, creator_id TEXT,
      title TEXT NOT NULL DEFAULT 'Untitled', body_json TEXT NOT NULL DEFAULT '{}',
      tags_json TEXT NOT NULL DEFAULT '[]', visibility TEXT NOT NULL DEFAULT 'private',
      tier TEXT NOT NULL DEFAULT 'regular', type TEXT NOT NULL DEFAULT 'knowledge',
      created_at TEXT NOT NULL DEFAULT (datetime('now')), updated_at TEXT NOT NULL DEFAULT (datetime('now')));
  `);
  db.prepare(`INSERT INTO drift_alerts (id, drift_type, severity, signature, context_json, detected_at)
              VALUES ('res_1', 'spectral', 'high', 'sig-a', '{"worldId":"concordia-hub"}', ?)`
  ).run(Math.floor(Date.now() / 1000));
  return db;
}
const ACTOR = { actor: { userId: "u-pin" }, userId: "u-pin" };

describe("FIX-ghost-tracker-001 — substrate failure is named, never a false not-found", () => {
  it("residues on a table-less DB reads substrate_unavailable", async () => {
    const r = await call("residues", { ...ACTOR, db: bareDb() }, { worldId: "concordia-hub" });
    assert.equal(r.ok, false);
    assert.equal(r.reason, "substrate_unavailable");
  });

  it("detail on a table-less DB reads substrate_unavailable, not residue_not_found", async () => {
    const r = await call("detail", { ...ACTOR, db: bareDb() }, { residueId: "res_1" });
    assert.equal(r.ok, false);
    assert.equal(r.reason, "substrate_unavailable");
  });

  it("confront on a table-less DB reads substrate_unavailable", async () => {
    const r = await call("confront", { ...ACTOR, db: bareDb() }, { residueId: "res_1" });
    assert.equal(r.ok, false);
    assert.equal(r.reason, "substrate_unavailable");
  });

  it("a readable store still answers honestly: seeded residue found, missing id not_found", async () => {
    const db = seededDb();
    const found = await call("detail", { ...ACTOR, db }, { residueId: "res_1" });
    assert.equal(found.ok, true);
    const missing = await call("detail", { ...ACTOR, db }, { residueId: "res_nope" });
    assert.equal(missing.ok, false);
    assert.equal(missing.reason, "residue_not_found");
    const list = await call("residues", { ...ACTOR, db }, { worldId: "concordia-hub" });
    assert.equal(list.ok, true);
    assert.equal(list.count, 1);
  });
});
