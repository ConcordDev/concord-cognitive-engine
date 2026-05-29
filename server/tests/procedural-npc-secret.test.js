/**
 * D4 #5 — a fraction of procedural NPCs get their GENERATED secret promoted into
 * the discoverable `secrets` table, so they can seed procedural content (the
 * surveillance → hook → quest-gate chain) instead of only flavouring dialogue.
 *
 * Run: node --test tests/procedural-npc-secret.test.js
 */

import { describe, it } from "node:test";
import assert from "node:assert/strict";
import Database from "better-sqlite3";
import { up as up153 } from "../migrations/153_npc_opinions.js";
import { up as up154 } from "../migrations/154_secrets.js";
import { seedSecretForNpc, discoverSecret, listDiscoveredForUser } from "../lib/secrets.js";
import { generateHookFromSecretDiscovery, getHooksHeldBy } from "../lib/hooks.js";
import { up as up277 } from "../migrations/277_npc_hooks.js";
import { generateNpc } from "../lib/npc-generator.js";

function setupDb() {
  const db = new Database(":memory:");
  up153(db); up154(db); up277(db);
  return db;
}

describe("D4#5 — seedSecretForNpc", () => {
  it("promotes a procedural NPC's generated secret into the secrets table", () => {
    const db = setupDb();
    const npc = generateNpc({ factionId: "iron_wardens", seed: "s1", worldId: "w" });
    assert.ok(npc.narrative_context.secret, "generated NPC carries a secret");
    const r = seedSecretForNpc(db, npc);
    assert.equal(r.ok, true);
    assert.equal(r.action, "seeded");
    const row = db.prepare(`SELECT holder_npc_id, body FROM secrets WHERE id = ?`).get(r.secretId);
    assert.equal(row.holder_npc_id, npc.id);
    assert.equal(row.body, npc.narrative_context.secret);
  });

  it("is idempotent on replay", () => {
    const db = setupDb();
    const npc = generateNpc({ factionId: "scholars_guild", seed: "s2", worldId: "w" });
    seedSecretForNpc(db, npc);
    const r2 = seedSecretForNpc(db, npc);
    assert.equal(r2.action, "exists");
    assert.equal(db.prepare(`SELECT COUNT(*) n FROM secrets WHERE holder_npc_id = ?`).get(npc.id).n, 1);
  });

  it("no-ops when the NPC has no secret", () => {
    const db = setupDb();
    const r = seedSecretForNpc(db, { id: "n_nosecret", narrative_context: {} });
    assert.equal(r.ok, false);
    assert.equal(r.reason, "no_secret");
  });

  it("a seeded procedural secret is discoverable (the quest-gating substrate)", () => {
    const db = setupDb();
    const npc = generateNpc({ factionId: "merchant_collective", seed: "s3", worldId: "w" });
    const s = seedSecretForNpc(db, npc);
    const d = discoverSecret(db, "u1", s.secretId, "surveillance");
    assert.equal(d.ok, true);
    assert.equal(listDiscoveredForUser(db, "u1").length, 1);
  });

  it("an npc-subject procedural secret yields a hook on discovery (full chain)", () => {
    const db = setupDb();
    // a secret naming another NPC (snake_case handle) → coercible subject → hook
    const npc = { id: "pn_holder", narrative_context: { secret: "owes a blood debt to rival_merchant from the old fire" } };
    const s = seedSecretForNpc(db, npc);
    assert.equal(s.ok, true);
    discoverSecret(db, "u1", s.secretId, "surveillance");
    const h = generateHookFromSecretDiscovery(db, { holderId: "u1", secretId: s.secretId });
    assert.equal(h.ok, true);
    assert.ok(getHooksHeldBy(db, "player", "u1").length >= 1, "discovery produced a hook over the named subject");
  });
});
