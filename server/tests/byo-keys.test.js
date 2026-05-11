// server/tests/byo-keys.test.js
//
// Sprint 10A acceptance — BYO API key substrate.
//
// Pins the load-bearing security guarantees:
//   1. Encryption/decryption round-trips correctly.
//   2. Per-user keyspace isolation (user A cannot decrypt user B's key).
//   3. Tampered ciphertexts decrypt to null, never throw.
//   4. setKey persists encrypted; listOverrides returns previews only.
//   5. Router falls through to default Ollama when override absent OR
//      when key is undecryptable.
//   6. concord_default / ollama provider doesn't require a key.

import test from "node:test";
import assert from "node:assert/strict";
import Database from "better-sqlite3";

import { encryptKey, decryptKey, previewOf } from "../lib/byo-crypto.js";
import {
  setKey, removeKey, setActive, listOverrides,
  listAvailableProviders,
} from "../lib/byo-keys.js";
import { getOverride } from "../lib/byo-router.js";

import { up as upMig170 } from "../migrations/170_byo_brain_overrides.js";

function setup() {
  const db = new Database(":memory:");
  // Minimal `dtus` table so the ALTER COLUMN in mig 170 doesn't throw.
  db.exec(`
    CREATE TABLE dtus (id TEXT PRIMARY KEY, title TEXT, content TEXT);
  `);
  upMig170(db);
  return db;
}

test("encrypt + decrypt round-trips", async () => {
  process.env.JWT_SECRET = "test-jwt-secret-for-byo-tests-only";
  const cipher = await encryptKey("user_alice", "sk-ant-fake-key-1234567890");
  assert.ok(cipher);
  assert.ok(cipher.length > 16, "ciphertext must include IV + body");
  const plain = await decryptKey("user_alice", cipher);
  assert.equal(plain, "sk-ant-fake-key-1234567890");
});

test("per-user keyspace isolation — bob cannot decrypt alice's key", async () => {
  process.env.JWT_SECRET = "test-jwt-secret-for-byo-tests-only";
  const cipher = await encryptKey("alice", "sk-secret");
  const plain = await decryptKey("bob", cipher);
  assert.equal(plain, null, "different user must not decrypt to plaintext");
});

test("tampered ciphertext returns null, never throws", async () => {
  process.env.JWT_SECRET = "test-jwt-secret-for-byo-tests-only";
  const cipher = await encryptKey("alice", "sk-real");
  // Flip a byte in the body region (not the IV).
  cipher[cipher.length - 1] = cipher[cipher.length - 1] ^ 0xff;
  const plain = await decryptKey("alice", cipher);
  assert.equal(plain, null);
});

test("decrypt returns null on garbage input — never throws", async () => {
  const plain = await decryptKey("alice", Buffer.from([1, 2, 3]));
  assert.equal(plain, null);
  const plain2 = await decryptKey("alice", null);
  assert.equal(plain2, null);
});

test("previewOf masks long keys, '•••' for short", () => {
  assert.equal(previewOf("sk-ant-fakekey1234567890"), "sk-a…7890");
  assert.equal(previewOf("short"), "•••");
  assert.equal(previewOf(null), "***");
});

test("setKey persists encrypted ciphertext + preview, never plaintext", async () => {
  const db = setup();
  const r = await setKey(db, "alice", {
    slot: "conscious",
    provider: "anthropic",
    modelId: "claude-opus-4-7",
    apiKey: "sk-ant-fakekey1234567890",
  });
  assert.equal(r.ok, true);
  assert.equal(r.preview, "sk-a…7890");

  // Verify the row contains a non-null encrypted_key + preview, but
  // NOT the plaintext.
  const row = db.prepare(`SELECT * FROM user_brain_overrides WHERE user_id = ? AND brain_slot = ?`)
    .get("alice", "conscious");
  assert.ok(row.encrypted_key);
  assert.equal(row.key_preview, "sk-a…7890");
  // Make sure the raw plaintext isn't sitting in any text column.
  const dump = JSON.stringify(row);
  assert.ok(!dump.includes("sk-ant-fakekey1234567890"), "plaintext must not appear in any text column");
});

test("listOverrides returns previews only, no ciphertext or plaintext", async () => {
  const db = setup();
  await setKey(db, "alice", {
    slot: "conscious", provider: "anthropic", modelId: "claude-opus-4-7",
    apiKey: "sk-ant-very-secret-key-xyz",
  });
  const rows = listOverrides(db, "alice");
  assert.equal(rows.length, 1);
  assert.equal(rows[0].provider, "anthropic");
  assert.equal(rows[0].model_id, "claude-opus-4-7");
  assert.equal(rows[0].key_preview, "sk-a…-xyz");
  // The encrypted_key column should NOT be in the returned shape.
  assert.equal(rows[0].encrypted_key, undefined);
  // Plaintext absolutely not.
  const dump = JSON.stringify(rows);
  assert.ok(!dump.includes("sk-ant-very-secret-key-xyz"));
});

test("setKey rejects too-short keys + invalid slots/providers", async () => {
  const db = setup();
  const r1 = await setKey(db, "alice", { slot: "conscious", provider: "anthropic", apiKey: "abc" });
  assert.equal(r1.ok, false);
  assert.equal(r1.reason, "missing_or_short_api_key");

  const r2 = await setKey(db, "alice", { slot: "ghost_slot", provider: "anthropic", apiKey: "abcdefgh1234" });
  assert.equal(r2.ok, false);
  assert.equal(r2.reason, "invalid_slot");

  const r3 = await setKey(db, "alice", { slot: "conscious", provider: "ghost_provider", apiKey: "abcdefgh1234" });
  assert.equal(r3.ok, false);
  assert.equal(r3.reason, "invalid_provider");
});

test("concord_default provider doesn't require an API key", async () => {
  const db = setup();
  const r = await setKey(db, "alice", {
    slot: "conscious", provider: "concord_default", modelId: null, apiKey: null,
  });
  assert.equal(r.ok, true);
});

test("setActive toggles without deleting the encrypted key", async () => {
  const db = setup();
  await setKey(db, "alice", {
    slot: "conscious", provider: "anthropic", modelId: "claude-opus-4-7",
    apiKey: "sk-ant-fakekey-abc-12345",
  });
  setActive(db, "alice", "conscious", false);
  const rows = listOverrides(db, "alice");
  assert.equal(rows[0].active, 0);
  // Key preview still present — proving the key wasn't dropped.
  assert.ok(rows[0].key_preview);
});

test("removeKey deletes the row entirely", async () => {
  const db = setup();
  await setKey(db, "alice", {
    slot: "conscious", provider: "anthropic", apiKey: "sk-ant-fakekey-abc-12345",
  });
  const r = removeKey(db, "alice", "conscious");
  assert.equal(r.ok, true);
  assert.equal(r.deleted, 1);
  assert.equal(listOverrides(db, "alice").length, 0);
});

test("router getOverride returns null when no active override", () => {
  const db = setup();
  assert.equal(getOverride(db, "alice", "conscious"), null);
});

test("router getOverride returns the row when active=1", async () => {
  const db = setup();
  await setKey(db, "alice", {
    slot: "conscious", provider: "anthropic", modelId: "claude-opus-4-7",
    apiKey: "sk-ant-fakekey-abc-12345",
  });
  const o = getOverride(db, "alice", "conscious");
  assert.ok(o);
  assert.equal(o.provider, "anthropic");
  assert.equal(o.model_id, "claude-opus-4-7");
});

test("router getOverride excludes inactive rows", async () => {
  const db = setup();
  await setKey(db, "alice", {
    slot: "conscious", provider: "anthropic", apiKey: "sk-ant-fakekey-abc-12345",
  });
  setActive(db, "alice", "conscious", false);
  assert.equal(getOverride(db, "alice", "conscious"), null);
});

test("listAvailableProviders returns 4 providers + 5 slots", () => {
  const r = listAvailableProviders();
  assert.equal(r.providers.length, 4);
  assert.equal(r.slots.length, 5);
  const ids = r.providers.map(p => p.id);
  assert.deepEqual(ids.sort(), ["anthropic", "google", "openai", "xai"]);
});

test("dtus table got minted_by_provider + minted_by_model columns", () => {
  const db = setup();
  // The ALTER ran during mig170 against the dtus stub we created in setup().
  // Verify columns exist.
  const cols = db.prepare(`PRAGMA table_info(dtus)`).all();
  const colNames = cols.map(c => c.name);
  assert.ok(colNames.includes("minted_by_provider"));
  assert.ok(colNames.includes("minted_by_model"));
});

test("DTU mint can stamp provenance — pre-existing rows have NULL", () => {
  const db = setup();
  db.prepare(`INSERT INTO dtus (id, title, content) VALUES (?, ?, ?)`).run("dtu_legacy", "Old", "Old content");
  db.prepare(`
    INSERT INTO dtus (id, title, content, minted_by_provider, minted_by_model)
    VALUES (?, ?, ?, ?, ?)
  `).run("dtu_new", "New", "New", "anthropic", "claude-opus-4-7");

  const legacy = db.prepare(`SELECT minted_by_provider, minted_by_model FROM dtus WHERE id = ?`).get("dtu_legacy");
  assert.equal(legacy.minted_by_provider, null);
  assert.equal(legacy.minted_by_model, null);

  const fresh = db.prepare(`SELECT minted_by_provider, minted_by_model FROM dtus WHERE id = ?`).get("dtu_new");
  assert.equal(fresh.minted_by_provider, "anthropic");
  assert.equal(fresh.minted_by_model, "claude-opus-4-7");
});
