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
import { readFileSync } from "node:fs";
import { webcrypto } from "node:crypto";
import Database from "better-sqlite3";

import {
  encryptKey, decryptKey, previewOf, ciphertextVersion,
  assertByoCryptoReady, BYO_CRYPTO_CONSTANTS,
} from "../lib/byo-crypto.js";
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
  // Pin a non-production env so a weak ambient JWT_SECRET cannot turn
  // this into the production secret refusal (that path throws on purpose).
  await withEnv({ NODE_ENV: "test" }, async () => {
    const plain = await decryptKey("alice", Buffer.from([1, 2, 3]));
    assert.equal(plain, null);
    const plain2 = await decryptKey("alice", null);
    assert.equal(plain2, null);
  });
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

// Historical on-disk layout, copied so a future writer change cannot
// quietly redefine what "v1" means. iv(12) || aes-gcm, PBKDF2-SHA256,
// salt = SHA-256("byo-salt:"+userId)[0:16], password = secret+":"+userId.
async function frameCiphertext(userId, plaintext, secret, iterations, versioned) {
  const enc = new TextEncoder();
  const baseKey = await webcrypto.subtle.importKey(
    "raw",
    enc.encode(secret + ":" + userId),
    { name: "PBKDF2" },
    false,
    ["deriveKey"],
  );
  const saltSrc = await webcrypto.subtle.digest("SHA-256", enc.encode(`byo-salt:${userId}`));
  const salt = new Uint8Array(saltSrc).slice(0, 16);
  const key = await webcrypto.subtle.deriveKey(
    { name: "PBKDF2", salt, iterations, hash: "SHA-256" },
    baseKey,
    { name: "AES-GCM", length: 256 },
    false,
    ["encrypt"],
  );
  const iv = webcrypto.getRandomValues(new Uint8Array(12));
  const cipher = new Uint8Array(await webcrypto.subtle.encrypt(
    { name: "AES-GCM", iv },
    key,
    enc.encode(plaintext),
  ));
  const magic = versioned ? Buffer.from(BYO_CRYPTO_CONSTANTS.V2_MAGIC) : Buffer.alloc(0);
  const out = Buffer.alloc(magic.length + iv.length + cipher.length);
  if (magic.length) magic.copy(out, 0);
  Buffer.from(iv).copy(out, magic.length);
  Buffer.from(cipher).copy(out, magic.length + iv.length);
  return out;
}

async function withEnv(patch, fn) {
  const prev = new Map();
  for (const [k, v] of Object.entries(patch)) {
    prev.set(k, Object.prototype.hasOwnProperty.call(process.env, k) ? process.env[k] : undefined);
    if (v === undefined) delete process.env[k];
    else process.env[k] = v;
  }
  try {
    return await fn();
  } finally {
    for (const [k, v] of prev) {
      if (v === undefined) delete process.env[k];
      else process.env[k] = v;
    }
  }
}

const STRONG_SECRET = "byo-test-strong-jwt-secret-0123456789abcdef";
const LEGACY_PLAIN = "sk-ant-legacy-key-1234567890";

test("new writes are version 2 and use the v2 iteration count", async () => {
  assert.ok(BYO_CRYPTO_CONSTANTS.V2_ITERATIONS >= 600_000);
  assert.equal(BYO_CRYPTO_CONSTANTS.V1_ITERATIONS, 10_000);
  assert.equal(BYO_CRYPTO_CONSTANTS.ITERATIONS, BYO_CRYPTO_CONSTANTS.V2_ITERATIONS);
  await withEnv({ NODE_ENV: "test", JWT_SECRET: STRONG_SECRET }, async () => {
    const plain = "sk-ant-new-version-key-1234567890";
    const cipher = await encryptKey("user_new", plain);
    assert.equal(ciphertextVersion(cipher), 2);
    assert.equal(cipher.subarray(0, BYO_CRYPTO_CONSTANTS.V2_MAGIC.length).toString(), BYO_CRYPTO_CONSTANTS.V2_MAGIC);
    assert.equal(await decryptKey("user_new", cipher), plain);

    // Reader accepts a blob we framed ourselves at the exported v2 count,
    // and rejects the same framing at the legacy 10_000 count.
    const atV2 = await frameCiphertext("user_new", plain, STRONG_SECRET, BYO_CRYPTO_CONSTANTS.V2_ITERATIONS, true);
    assert.equal(await decryptKey("user_new", atV2), plain);
    const atV1Count = await frameCiphertext("user_new", plain, STRONG_SECRET, 10_000, true);
    assert.equal(await decryptKey("user_new", atV1Count), null);
  });
});

test("legacy untagged ciphertext (10_000 iterations) still decrypts", async () => {
  const cipher = await frameCiphertext("user_legacy", LEGACY_PLAIN, STRONG_SECRET, 10_000, false);
  assert.equal(ciphertextVersion(cipher), 1);
  assert.equal(cipher.subarray(0, 6).toString() === BYO_CRYPTO_CONSTANTS.V2_MAGIC, false);
  await withEnv({ NODE_ENV: "test", JWT_SECRET: STRONG_SECRET }, async () => {
    assert.equal(await decryptKey("user_legacy", cipher), LEGACY_PLAIN);
  });
  // An untagged blob derived at the new iteration count is not a v1 row.
  const wrongCount = await frameCiphertext("user_legacy", LEGACY_PLAIN, STRONG_SECRET, BYO_CRYPTO_CONSTANTS.V2_ITERATIONS, false);
  await withEnv({ NODE_ENV: "test", JWT_SECRET: STRONG_SECRET }, async () => {
    assert.equal(await decryptKey("user_legacy", wrongCount), null);
  });
});

test("production still decrypts a legacy v1 row under a strong JWT_SECRET", async () => {
  const cipher = await frameCiphertext("user_legacy_prod", LEGACY_PLAIN, STRONG_SECRET, 10_000, false);
  await withEnv({ NODE_ENV: "production", JWT_SECRET: STRONG_SECRET }, async () => {
    assert.equal(assertByoCryptoReady(), undefined);
    assert.equal(await decryptKey("user_legacy_prod", cipher), LEGACY_PLAIN);
  });
});

test("tampered legacy and versioned ciphertexts return null", async () => {
  await withEnv({ NODE_ENV: "test", JWT_SECRET: STRONG_SECRET }, async () => {
    const v2 = await encryptKey("user_tamper", "sk-ant-tamper-key-1234567890");
    v2[v2.length - 1] = v2[v2.length - 1] ^ 0xff;
    assert.equal(await decryptKey("user_tamper", v2), null);

    const v1 = await frameCiphertext("user_tamper", LEGACY_PLAIN, STRONG_SECRET, 10_000, false);
    v1[v1.length - 1] = v1[v1.length - 1] ^ 0xff;
    assert.equal(await decryptKey("user_tamper", v1), null);
  });
});

test("production refuses a missing, short, placeholder, or known-default JWT_SECRET", async () => {
  const plain = "sk-ant-should-not-leak-1234567890";
  const cases = [
    { secret: undefined, re: /not set/i },
    { secret: "", re: /not set/i },
    { secret: "pw-do-not-leak-xx", re: /shorter than 32/ },
    { secret: "change-me-please-this-is-a-placeholder-value", re: /placeholder/i },
    { secret: "concord-default-byo-pepper-not-for-prod", re: /known default|placeholder/i },
    { secret: "TEST-ONLY-byo-pepper-not-for-production", re: /known default|placeholder/i },
  ];
  for (const { secret, re } of cases) {
    await withEnv({ NODE_ENV: "production", JWT_SECRET: secret }, async () => {
      await assert.rejects(() => encryptKey("user_prod", plain), (err) => {
        assert.equal(err.code, "BYO_SECRET_REFUSED");
        assert.match(err.message, /BYOK encryption refused/);
        assert.match(err.message, /JWT_SECRET/);
        assert.match(err.message, re);
        assert.equal(err.message.includes(plain), false);
        assert.equal(err.message.includes("TEST-ONLY-byo-pepper"), false);
        assert.equal(err.message.includes("concord-default-byo-pepper"), false);
        if (secret) assert.equal(err.message.includes(secret), false);
        return true;
      });
      await assert.rejects(() => decryptKey("user_prod", Buffer.from("not-a-real-ciphertext-blob!!")), (err) => {
        assert.equal(err.code, "BYO_SECRET_REFUSED");
        assert.match(err.message, /BYOK encryption refused/);
        return true;
      });
      assert.throws(assertByoCryptoReady, (err) => err.code === "BYO_SECRET_REFUSED");
    });
  }
});

test("production setKey does not persist when JWT_SECRET is unfit", async () => {
  const db = setup();
  const apiKey = "sk-ant-should-not-leak-1234567890";
  await withEnv({ NODE_ENV: "production", JWT_SECRET: "change-me-please-this-is-a-placeholder-value" }, async () => {
    const r = await setKey(db, "alice", {
      slot: "conscious", provider: "anthropic", apiKey,
    });
    assert.equal(r.ok, false);
    assert.equal(r.reason, "encryption_failed");
    assert.match(r.error, /BYOK encryption refused/);
    assert.equal(r.error.includes(apiKey), false);
    assert.equal(r.error.includes("change-me-please"), false);
  });
  const row = db.prepare(`SELECT encrypted_key FROM user_brain_overrides WHERE user_id = ?`).get("alice");
  assert.equal(row, undefined);
});

test("dev/test with no JWT_SECRET still round-trips, and the retired pepper is not the fallback", async () => {
  const plain = "sk-ant-dev-key-1234567890";
  let cipher;
  await withEnv({ NODE_ENV: "development", JWT_SECRET: undefined }, async () => {
    assert.equal(assertByoCryptoReady(), undefined);
    cipher = await encryptKey("dev_user", plain);
    assert.equal(ciphertextVersion(cipher), 2);
    assert.equal(await decryptKey("dev_user", cipher), plain);
  });
  await withEnv({ NODE_ENV: "development", JWT_SECRET: "concord-default-byo-pepper-not-for-prod" }, async () => {
    assert.equal(await decryptKey("dev_user", cipher), null);
  });
});

test("server.js runs the BYOK secret gate at boot in production", () => {
  const src = readFileSync(new URL("../server.js", import.meta.url), "utf8");
  assert.match(src, /import \{ assertByoCryptoReady \} from "\.\/lib\/byo-crypto\.js"/);
  assert.match(src, /if \(NODE_ENV === "production"\) \{\s*try \{\s*assertByoCryptoReady\(\);/s);
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
