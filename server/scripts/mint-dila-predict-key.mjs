#!/usr/bin/env node
// server/scripts/mint-dila-predict-key.mjs
//
// One-shot: mints a DURABLE, predict-scoped csk_ API key for the existing
// 'hermes' (Dila) user, inserting directly into the api_keys SQLite table
// so it survives server restarts (loaded via lib/api-keys.js#loadKeysFromDb
// at boot — see that file's header). Unlike mint-mcp-token.mjs (in-memory
// only, full "*" scope, dies on restart), this key is:
//   - durable (row in api_keys, reloaded every boot)
//   - scoped to ["predict"] only — least privilege. checkScope() in
//     lib/api-keys.js rejects any domain other than "predict", so even if
//     this key leaked it cannot call trading/economy/admin macros.
//
// Prints the raw key ONCE. Paste it into the Python trader's env as
// CONCORD_PREDICT_API_KEY — never commit it, never log it elsewhere.
//
// Usage:
//   DATA_DIR=/Users/dutch/concord/concord-cognitive-engine/server/data \
//     node server/scripts/mint-dila-predict-key.mjs

import crypto from "node:crypto";
import path from "node:path";
import Database from "better-sqlite3";

const DATA_DIR = process.env.DATA_DIR || path.join(process.cwd(), "data");
const DB_PATH = process.env.DB_PATH || path.join(DATA_DIR, "concord.db");

const db = new Database(DB_PATH);

const user = db.prepare("SELECT id, role FROM users WHERE id = 'hermes'").get();
if (!user) {
  console.error(`FATAL: no 'hermes' user row found in ${DB_PATH}. Refusing to mint.`);
  process.exit(1);
}

const rawKey = `csk_${crypto.randomBytes(32).toString("hex")}`;
const hash = crypto.createHash("sha256").update(rawKey).digest("hex");
const id = `apikey_${crypto.randomBytes(8).toString("hex")}`;
const prefix = rawKey.slice(0, 8);
const now = new Date().toISOString();

db.prepare(`
  INSERT INTO api_keys (id, user_id, name, key_hash, key_prefix, scopes, created_at, last_used_at, is_active, status, tier, total_calls)
  VALUES (?, 'hermes', 'dila-predict-recording-layer', ?, ?, '["predict"]', ?, NULL, 1, 'active', 'free', 0)
`).run(id, hash, prefix, now);

db.close();

const banner = "=".repeat(64);
console.log(banner);
console.log("Dila Predict recording-layer key minted (durable, scope: predict only)");
console.log(banner);
console.log(rawKey);
console.log(banner);
console.log(`key id:  ${id}`);
console.log(`user:    hermes`);
console.log(`scope:   ["predict"]  (rejected for any other domain)`);
console.log(`durable: yes — survives server restart (loaded from api_keys table)`);
console.log(banner);
console.log("Save this as CONCORD_PREDICT_API_KEY in the Dila trader's env.");
console.log("It will not be shown again — the row in the DB stores only its hash.");
console.log(banner);
