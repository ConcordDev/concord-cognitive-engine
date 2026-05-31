// SL4 tail — periodic expired-effects sweep. Pins that the heartbeat prunes
// expired user_active_effects rows, leaves live ones, and never throws.
//
// Run: node --test tests/effects-decay-cycle.test.js

import { describe, it, beforeEach, afterEach } from "node:test";
import assert from "node:assert/strict";
import Database from "better-sqlite3";
import { runMigrations } from "../migrate.js";
import { runEffectsDecayCycle } from "../emergent/effects-decay-cycle.js";

describe("effects-decay-cycle", () => {
  let db;
  beforeEach(async () => { db = new Database(":memory:"); await runMigrations(db); });
  afterEach(() => { try { db.close(); } catch { /* noop */ } });

  const insertEffect = (id, expiresAtUnix) =>
    db.prepare(`INSERT INTO user_active_effects (id, user_id, effect_id, kind, magnitude, expires_at) VALUES (?, 'u1', 'damage_resist', 'buff', 0.1, ?)`).run(id, expiresAtUnix);

  it("prunes expired rows and keeps live ones", async () => {
    const now = Math.floor(Date.now() / 1000);
    insertEffect("expired", now - 100);
    insertEffect("live", now + 10000);
    const r = await runEffectsDecayCycle({ db });
    assert.equal(r.ok, true);
    assert.equal(r.swept, 1);
    const remaining = db.prepare("SELECT id FROM user_active_effects").all().map((x) => x.id);
    assert.deepEqual(remaining, ["live"]);
  });

  it("is a no-op when nothing is expired", async () => {
    insertEffect("live", Math.floor(Date.now() / 1000) + 5000);
    const r = await runEffectsDecayCycle({ db });
    assert.equal(r.swept, 0);
  });

  it("never throws on a bad db", async () => {
    const r = await runEffectsDecayCycle({});
    assert.equal(r.ok, false);
  });
});
