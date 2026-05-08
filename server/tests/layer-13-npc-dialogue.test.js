// Layer 13 contract test — NPC-initiated conversations.
// Pins:
//   - migration 118 creates npc_conversations with the canonical columns
//   - findConversationCandidates skips pairs that opened recently (cooldown)
//   - composeDeterministicOpener is non-empty + stable for a fixed bucket
//   - tryInitiateConversation inserts a row + returns conversation id
//   - sweepExpiredConversations transitions expired rows to closed
//   - runNpcConversationInitiator never throws + always returns {ok}

import { test, beforeEach } from "node:test";
import assert from "node:assert/strict";
import Database from "better-sqlite3";

import { runMigrations } from "../migrate.js";
import {
  findConversationCandidates,
  composeDeterministicOpener,
  tryInitiateConversation,
  sweepExpiredConversations,
  getActiveConversations,
  _internal,
} from "../lib/embodied/npc-dialogue.js";
import { runNpcConversationInitiator } from "../emergent/npc-conversation-initiator.js";

let db;
beforeEach(async () => {
  db = new Database(":memory:");
  db.pragma("journal_mode = MEMORY");
  db.pragma("foreign_keys = ON");
  await runMigrations(db);
});

function colExists(table, col) {
  return db.prepare(`SELECT name FROM pragma_table_info(?)`).all(table)
    .some((r) => r.name === col);
}

function seedNpcs(worldId, count = 4) {
  const stmt = db.prepare(`
    INSERT INTO world_npcs (id, world_id, npc_type, current_location, state)
    VALUES (?, ?, 'generic', '{}', ?)
  `);
  for (let i = 0; i < count; i++) {
    stmt.run(`npc-${worldId}-${i}`, worldId, JSON.stringify({ factionId: i < count / 2 ? "alpha" : "beta" }));
  }
}

// ─────────────────────────────────────────────────────────────────────────
test("migration 118 creates npc_conversations with canonical columns", () => {
  for (const c of [
    "id", "world_id", "npc_a", "npc_b", "opened_at", "last_msg_at",
    "expires_at", "status", "composer", "seed_context_json", "messages_json",
  ]) assert.ok(colExists("npc_conversations", c), `missing column: ${c}`);
});

test("findConversationCandidates returns pairs from same world", () => {
  seedNpcs("w1", 4);
  const candidates = findConversationCandidates(db, "w1", { limit: 3 });
  assert.ok(candidates.length >= 1, "expected at least one candidate pair");
  for (const c of candidates) {
    assert.ok(c.a < c.b, "pair must be sorted");
    assert.strictEqual(c.worldId, "w1");
  }
});

test("findConversationCandidates returns [] for worlds with <2 NPCs", () => {
  seedNpcs("w-solo", 1);
  assert.deepStrictEqual(findConversationCandidates(db, "w-solo"), []);
});

test("composeDeterministicOpener returns non-empty grounded string", () => {
  const opener = composeDeterministicOpener("alice", "bob", { worldId: "w1", factionA: "alpha", sameFaction: false });
  assert.ok(typeof opener === "string" && opener.length > 0);
  assert.match(opener, /alice|bob/i, "opener must reference at least one NPC name");
});

test("composeDeterministicOpener is stable within a 30-min bucket", () => {
  const ctx = { worldId: "w1", factionA: "alpha" };
  const a = composeDeterministicOpener("alice", "bob", ctx);
  const b = composeDeterministicOpener("alice", "bob", ctx);
  assert.strictEqual(a, b, "same args + same bucket must produce same opener");
});

test("tryInitiateConversation inserts a row and returns id", () => {
  seedNpcs("w-init", 3);
  const r = tryInitiateConversation(db, "w-init");
  assert.strictEqual(r.ok, true, `expected ok, got: ${JSON.stringify(r)}`);
  assert.match(r.conversationId, /^conv_/);
  const rows = getActiveConversations(db, "w-init");
  assert.strictEqual(rows.length, 1);
  assert.strictEqual(rows[0].messages.length, 1);
  assert.match(rows[0].messages[0].text, /\w+/);
});

test("tryInitiateConversation honours pair cooldown", () => {
  seedNpcs("w-cd", 2); // exactly one pair
  const r1 = tryInitiateConversation(db, "w-cd");
  assert.strictEqual(r1.ok, true);
  const r2 = tryInitiateConversation(db, "w-cd");
  assert.strictEqual(r2.ok, false, "second initiation within cooldown must fail");
  assert.match(r2.reason, /no_candidates/);
});

test("sweepExpiredConversations closes expired rows", () => {
  seedNpcs("w-exp", 2);
  tryInitiateConversation(db, "w-exp");
  // Backdate expires_at past now
  db.prepare(`UPDATE npc_conversations SET expires_at = unixepoch() - 60 WHERE world_id = 'w-exp'`).run();
  const before = db.prepare(`SELECT status FROM npc_conversations WHERE world_id = 'w-exp'`).get();
  assert.strictEqual(before.status, "active");
  const r = sweepExpiredConversations(db);
  assert.strictEqual(r.ok, true);
  assert.ok(r.closed >= 1);
  const after = db.prepare(`SELECT status FROM npc_conversations WHERE world_id = 'w-exp'`).get();
  assert.strictEqual(after.status, "closed");
});

test("runNpcConversationInitiator never throws on empty world set", async () => {
  const r = await runNpcConversationInitiator({ db });
  assert.strictEqual(r.ok, true);
  assert.strictEqual(r.opened, 0);
  assert.strictEqual(r.worldsScanned, 0);
});

test("runNpcConversationInitiator opens up to MAX_PER_PASS per world", async () => {
  seedNpcs("w-multi", 6);
  const r = await runNpcConversationInitiator({ db });
  assert.strictEqual(r.ok, true);
  assert.ok(r.opened >= 1, `expected opened>=1, got ${r.opened}`);
  assert.ok(r.opened <= _internal.MAX_PER_PASS, `expected opened<=MAX_PER_PASS, got ${r.opened}`);
});

test("runNpcConversationInitiator missing db returns {ok:false} not throw", async () => {
  const r = await runNpcConversationInitiator({});
  assert.strictEqual(r.ok, false);
  assert.match(r.reason, /no_db/);
});

test("internal cooldown / TTL constants are sane", () => {
  assert.ok(_internal.COOLDOWN_S >= 60, "cooldown must be at least a minute");
  assert.ok(_internal.TTL_S > 0);
  assert.ok(_internal.MAX_PER_PASS >= 1);
  assert.ok(_internal.MIN_NPCS_FOR_CONVERSATION >= 2);
});
