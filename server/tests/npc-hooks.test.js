/**
 * D5 (depth plan) — CK3-style hooks: spendable, expiring, inheritable leverage.
 *
 * Covers the lib contract (grant/get/block/spend/expire/from-secret/inherit),
 * the discovery→hook→weaponise→spend loop, and the proposeScheme strong-hook
 * passive block. Real in-memory better-sqlite3; schema from migration 277.
 *
 * Run: node --test tests/npc-hooks.test.js
 */

import { describe, it, beforeEach } from "node:test";
import assert from "node:assert/strict";
import Database from "better-sqlite3";

import { up as hooksUp } from "../migrations/277_npc_hooks.js";
import {
  grantHook, getActiveHooks, hasBlockingHook, spendHook,
  expireHooks, grantHookFromSecret, inheritHooks,
} from "../lib/npc-hooks.js";

function freshDb() {
  const db = new Database(":memory:");
  hooksUp(db);
  return db;
}

describe("D5 — grantHook / getActiveHooks", () => {
  let db;
  beforeEach(() => { db = freshDb(); });

  it("grants a weak hook (uses_left 1) and lists it", () => {
    const r = grantHook(db, { holderKind: "player", holderId: "u1", targetKind: "npc", targetId: "n1" });
    assert.equal(r.ok, true);
    assert.equal(r.strength, "weak");
    const live = getActiveHooks(db, { holderKind: "player", holderId: "u1" });
    assert.equal(live.length, 1);
    assert.equal(live[0].uses_left, 1);
  });

  it("strong hooks have unlimited uses (null)", () => {
    grantHook(db, { holderKind: "npc", holderId: "a", targetKind: "npc", targetId: "b", strength: "strong" });
    const live = getActiveHooks(db, { holderKind: "npc", holderId: "a" });
    assert.equal(live[0].uses_left, null);
  });

  it("rejects self-hooks", () => {
    const r = grantHook(db, { holderKind: "npc", holderId: "x", targetKind: "npc", targetId: "x" });
    assert.equal(r.ok, false);
    assert.equal(r.reason, "self_hook");
  });

  it("is idempotent on (holder,target,secret)", () => {
    const a = grantHook(db, { holderKind: "player", holderId: "u1", targetKind: "npc", targetId: "n1", sourceSecretId: "s1" });
    const b = grantHook(db, { holderKind: "player", holderId: "u1", targetKind: "npc", targetId: "n1", sourceSecretId: "s1" });
    assert.equal(b.action, "exists");
    assert.equal(b.hookId, a.hookId);
    assert.equal(getActiveHooks(db, { holderKind: "player", holderId: "u1" }).length, 1);
  });

  it("filters by target", () => {
    grantHook(db, { holderKind: "player", holderId: "u1", targetKind: "npc", targetId: "n1" });
    grantHook(db, { holderKind: "player", holderId: "u1", targetKind: "npc", targetId: "n2" });
    assert.equal(getActiveHooks(db, { holderKind: "player", holderId: "u1", targetKind: "npc", targetId: "n2" }).length, 1);
  });
});

describe("D5 — hasBlockingHook (strong-hook passive block)", () => {
  let db;
  beforeEach(() => { db = freshDb(); });

  it("only a STRONG hook blocks", () => {
    grantHook(db, { holderKind: "npc", holderId: "a", targetKind: "npc", targetId: "b", strength: "weak" });
    assert.equal(hasBlockingHook(db, { holderKind: "npc", holderId: "a", targetKind: "npc", targetId: "b" }), false);
    grantHook(db, { holderKind: "npc", holderId: "a", targetKind: "npc", targetId: "b", strength: "strong", sourceSecretId: "s9" });
    assert.equal(hasBlockingHook(db, { holderKind: "npc", holderId: "a", targetKind: "npc", targetId: "b" }), true);
  });
});

describe("D5 — spendHook", () => {
  let db;
  beforeEach(() => { db = freshDb(); });

  it("weak hook consumes and marks spent", () => {
    const r = grantHook(db, { holderKind: "player", holderId: "u1", targetKind: "npc", targetId: "n1" });
    const s = spendHook(db, r.hookId);
    assert.equal(s.consumed, true);
    assert.equal(s.remaining, 0);
    assert.equal(getActiveHooks(db, { holderKind: "player", holderId: "u1" }).length, 0); // gone
    assert.equal(spendHook(db, r.hookId).reason, "already_spent");
  });

  it("strong hook never depletes", () => {
    const r = grantHook(db, { holderKind: "npc", holderId: "a", targetKind: "npc", targetId: "b", strength: "strong" });
    const s = spendHook(db, r.hookId);
    assert.equal(s.consumed, false);
    assert.equal(getActiveHooks(db, { holderKind: "npc", holderId: "a" }).length, 1); // still live
  });
});

describe("D5 — expireHooks", () => {
  it("sweeps lapsed hooks", () => {
    const db = freshDb();
    grantHook(db, { holderKind: "player", holderId: "u1", targetKind: "npc", targetId: "n1", ttlS: 3600 });
    const future = Math.floor(Date.now() / 1000) + 7200;
    const r = expireHooks(db, future);
    assert.equal(r.swept, 1);
    assert.equal(getActiveHooks(db, { holderKind: "player", holderId: "u1" }).length, 0);
  });
});

describe("D5 — grantHookFromSecret", () => {
  let db;
  beforeEach(() => { db = freshDb(); });

  it("deep secret (difficulty ≥ 8) yields a strong hook", () => {
    const r = grantHookFromSecret(db, {
      holderKind: "player", holderId: "u1",
      secret: { id: "s1", subject_kind: "npc", subject_id: "n1", discovery_difficulty: 9 },
    });
    assert.equal(r.strength, "strong");
  });
  it("shallow secret yields a weak hook", () => {
    const r = grantHookFromSecret(db, {
      holderKind: "player", holderId: "u1",
      secret: { id: "s2", subject_kind: "npc", subject_id: "n2", discovery_difficulty: 4 },
    });
    assert.equal(r.strength, "weak");
  });
  it("skips non-personal subjects (faction/world)", () => {
    const r = grantHookFromSecret(db, {
      holderKind: "player", holderId: "u1",
      secret: { id: "s3", subject_kind: "faction", subject_id: "f1", discovery_difficulty: 9 },
    });
    assert.equal(r.ok, false);
    assert.equal(r.reason, "non_personal_subject");
  });
});

describe("D5 — inheritHooks (leverage outlives the person)", () => {
  let db;
  beforeEach(() => { db = freshDb(); });

  it("the deceased's held hooks pass to the heir", () => {
    grantHook(db, { holderKind: "npc", holderId: "dead", targetKind: "npc", targetId: "victim" });
    const r = inheritHooks(db, "npc", "dead", "heir");
    assert.equal(r.held, 1);
    assert.equal(getActiveHooks(db, { holderKind: "npc", holderId: "heir" }).length, 1);
    assert.equal(getActiveHooks(db, { holderKind: "npc", holderId: "dead" }).length, 0);
  });

  it("hooks held OVER the deceased re-target to the heir", () => {
    grantHook(db, { holderKind: "npc", holderId: "rival", targetKind: "npc", targetId: "dead", strength: "strong", sourceSecretId: "s1" });
    inheritHooks(db, "npc", "dead", "heir");
    // rival now holds the hook over the heir.
    assert.equal(hasBlockingHook(db, { holderKind: "npc", holderId: "rival", targetKind: "npc", targetId: "heir" }), true);
  });

  it("drops self-hooks produced by reassignment", () => {
    // heir holds a hook over the soon-to-be-dead → after inheritance it would
    // become heir→heir, which must be dropped.
    grantHook(db, { holderKind: "npc", holderId: "heir", targetKind: "npc", targetId: "dead", sourceSecretId: "s2" });
    inheritHooks(db, "npc", "dead", "heir");
    const all = getActiveHooks(db, { holderKind: "npc", holderId: "heir" });
    assert.ok(all.every((h) => !(h.target_kind === "npc" && h.target_id === "heir")));
  });
});

describe("D5 — proposeScheme strong-hook passive block", () => {
  it("blocks a plotter when the target holds a strong hook over them", async () => {
    const db = freshDb();
    // target 'b' holds a strong hook over plotter 'a'.
    grantHook(db, { holderKind: "npc", holderId: "b", targetKind: "npc", targetId: "a", strength: "strong", sourceSecretId: "s1" });
    const { proposeScheme } = await import("../lib/npc-schemes.js");
    const r = proposeScheme(db, { plotterNpcId: "a", targetKind: "npc", targetId: "b" });
    assert.equal(r.ok, false);
    assert.equal(r.reason, "blocked_by_hook");
  });
});
