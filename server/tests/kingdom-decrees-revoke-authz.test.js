// server/tests/kingdom-decrees-revoke-authz.test.js
//
// Pins the authorization fix on `revokeDecree` (server/lib/kingdom-decrees.js).
//
// Found during the 2026-07-11 factions/politics/governance capability audit
// (docs/concordia-specs/factions-politics-capability-map.md), independently
// confirming a gap already flagged by docs/lens-specs/kingdoms-capability-map.md:
// `revokeDecree` had no check that the caller is the realm's ruler, unlike its
// sibling `proposeDecree` which does check `issuedByKind`/`issuedById` against
// `ruler_kind`/`ruler_id`. Any authenticated user who knew (or enumerated) a
// `decreeId` could revoke ANY realm's active decree via the
// `kingdoms.revoke_decree` macro.

import { describe, it, beforeEach } from "node:test";
import assert from "node:assert/strict";
import Database from "better-sqlite3";

import { up as up158 } from "../migrations/158_kingdoms.js";
import { proposeDecree, issueDecree, revokeDecree } from "../lib/kingdom-decrees.js";

function setupDb() {
  const db = new Database(":memory:");
  up158(db);
  return db;
}

function seedRealm(db, overrides = {}) {
  const id = overrides.id || "realm_test";
  db.prepare(`
    INSERT INTO realms (id, name, world_id, ruler_kind, ruler_id, legitimacy, treasury, tax_rate)
    VALUES (?, ?, ?, ?, ?, 60, 1000, 0.10)
  `).run(id, overrides.name || "Test Realm", overrides.worldId || "concordia-hub",
    overrides.rulerKind || "player", overrides.rulerId || "ruler_user");
  return id;
}

describe("kingdom-decrees — revokeDecree authorization", () => {
  let db;
  beforeEach(() => { db = setupDb(); });

  it("rejects revocation by a non-ruler caller", () => {
    const kingdomId = seedRealm(db, { rulerId: "ruler_user" });
    const proposed = proposeDecree(db, kingdomId, {
      kind: "festival", issuedByKind: "player", issuedById: "ruler_user",
    });
    assert.equal(proposed.ok, true);
    issueDecree(db, proposed.id);

    const r = revokeDecree(db, proposed.id, "someone_else");
    assert.equal(r.ok, false);
    assert.equal(r.reason, "not_authorised");

    // Decree must remain active — not silently revoked.
    const row = db.prepare(`SELECT effect_state FROM realm_decrees WHERE id = ?`).get(proposed.id);
    assert.equal(row.effect_state, "active");
  });

  it("allows revocation by the realm's actual ruler", () => {
    const kingdomId = seedRealm(db, { rulerId: "ruler_user" });
    const proposed = proposeDecree(db, kingdomId, {
      kind: "festival", issuedByKind: "player", issuedById: "ruler_user",
    });
    issueDecree(db, proposed.id);

    const r = revokeDecree(db, proposed.id, "ruler_user");
    assert.equal(r.ok, true);

    const row = db.prepare(`SELECT effect_state FROM realm_decrees WHERE id = ?`).get(proposed.id);
    assert.equal(row.effect_state, "revoked");
  });

  it("rejects revocation against an NPC-ruled realm by any player caller", () => {
    const kingdomId = seedRealm(db, { rulerKind: "npc", rulerId: "npc_ruler_1" });
    const proposed = proposeDecree(db, kingdomId, { kind: "festival", issuedByKind: "system" });
    issueDecree(db, proposed.id);

    const r = revokeDecree(db, proposed.id, "some_player");
    assert.equal(r.ok, false);
    assert.equal(r.reason, "not_authorised");
  });

  it("still allows system/unattributed revocation (by=null, e.g. inheritance reset)", () => {
    const kingdomId = seedRealm(db, { rulerId: "ruler_user" });
    const proposed = proposeDecree(db, kingdomId, { kind: "festival", issuedByKind: "system" });
    issueDecree(db, proposed.id);

    const r = revokeDecree(db, proposed.id, null);
    assert.equal(r.ok, true);
    const row = db.prepare(`SELECT effect_state FROM realm_decrees WHERE id = ?`).get(proposed.id);
    assert.equal(row.effect_state, "revoked");
  });

  it("returns decree_not_found for an unknown decreeId", () => {
    const r = revokeDecree(db, "does_not_exist", "someone");
    assert.equal(r.ok, false);
    assert.equal(r.reason, "decree_not_found");
  });
});
