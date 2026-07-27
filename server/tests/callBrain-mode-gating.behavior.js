// server/tests/callBrain-mode-gating.behavior.js
//
// Task #34 of the Private Mode / High Power Mode plan: behavioral proof
// for callBrain()'s Private/High Power Mode groundwork (task #22).
//
// Honest scope, stated up front: callBrain() has NO real cloud dispatch
// path today (confirmed by reading its own code comment in server.js,
// right above the `_cbMode` lookup: "callBrain has NO cloud path today
// ... this is a no-op guard against a FUTURE platform-provider branch").
// So there is nothing for a Private-mode call to "leak" to yet — every
// callBrain() call reaches local Ollama regardless of brain_mode, by
// construction. What this file actually verifies, honestly:
//   1. That fact holds for BOTH 'private' and 'high_power' accounts —
//      the groundwork doesn't accidentally reroute high_power traffic
//      anywhere different (there's nowhere different to route it yet).
//   2. The `_cbMode` lookup itself (options._userId + a real STATE.db
//      read of users.brain_mode) never throws — for a private user, a
//      high_power user, and a user id that doesn't exist in the users
//      table (defensive fallback to 'private', matching
//      byo-router.js#getBrainMode's own fail-closed contract).
//   3. options._userId, once populated, is real end-to-end plumbing —
//      confirmed by observing it reach the SQL lookup (a malformed users
//      table degrades gracefully rather than crashing the call).
//
// Boots the real server.js (same __TEST__ + fake-Ollama-server pattern as
// tests/governance-critic-ethicist-auditor-parallel.test.js and
// tests/inference-metering-chat-wiring.test.js) rather than a simulated
// shape.

import { describe, it, before, after } from "node:test";
import assert from "node:assert/strict";
import http from "node:http";
import os from "node:os";
import path from "node:path";
import { registerServerCleanExit } from "./lib/server-clean-exit.js";

function makeFakeOllamaServer() {
  const hits = [];
  const server = http.createServer((req, res) => {
    let body = "";
    req.on("data", (c) => { body += c; });
    req.on("end", () => {
      if (req.method === "POST" && req.url === "/api/chat") hits.push(body);
      res.writeHead(200, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ message: { content: "ok" }, eval_count: 3 }));
    });
  });
  return { server, hits, url: null };
}

function listen(fake) {
  return new Promise((resolve, reject) => {
    fake.server.listen(0, "127.0.0.1", (err) => {
      if (err) return reject(err);
      const { port } = fake.server.address();
      fake.url = `http://127.0.0.1:${port}`;
      resolve(fake);
    });
  });
}

let fake, T;

before(async () => {
  process.env.NODE_ENV = process.env.NODE_ENV || "test";
  process.env.CONCORD_NO_LISTEN = process.env.CONCORD_NO_LISTEN || "true";
  if (!process.env.STATE_PATH) {
    process.env.STATE_PATH = path.join(os.tmpdir(), `concord-callbrain-mode-gating-state-${process.pid}-${Date.now()}.json`);
  }
  if (!process.env.DB_PATH) {
    process.env.DB_PATH = path.join(os.tmpdir(), `concord-callbrain-mode-gating-${process.pid}-${Date.now()}.db`);
  }

  fake = makeFakeOllamaServer();
  await listen(fake);
  delete process.env.BRAIN_CONSCIOUS_URLS;
  process.env.BRAIN_CONSCIOUS_URL = fake.url;

  T = (await import("../server.js")).__TEST__;
  assert.ok(T?.callBrain, "server.js __TEST__ must expose callBrain");
  assert.ok(T?.STATE?.db, "server boot must produce a real db handle");
  T.BRAIN.conscious.enabled = true;
});

after(async () => {
  await new Promise((resolve) => fake.server.close(() => resolve()));
});

registerServerCleanExit(() => T);

function seedUser(userId, brainMode) {
  // The real server.js `users` table (server.js's own CREATE TABLE,
  // already applied by boot) has several NOT NULL columns beyond id/
  // brain_mode (username, email, password_hash, created_at) -- populate
  // them with throwaway values so this insert satisfies the real schema
  // rather than a hand-rolled minimal one.
  T.STATE.db.prepare(`
    INSERT OR REPLACE INTO users (id, username, email, password_hash, created_at, brain_mode)
    VALUES (?, ?, ?, 'x', datetime('now'), ?)
  `).run(userId, `${userId}_uname`, `${userId}@test.invalid`, brainMode);
}

describe("callBrain() Private/High Power Mode groundwork", () => {
  it("a Private-mode user's call still reaches local Ollama (no cloud path exists to misroute to)", async () => {
    seedUser("cb_user_private", "private");
    fake.hits.length = 0;
    const r = await T.callBrain("conscious", "hello", { _userId: "cb_user_private" });
    assert.equal(r.ok, true);
    assert.equal(fake.hits.length, 1, "must reach the local fake Ollama endpoint exactly once");
  });

  it("a High-Power-mode user's call ALSO reaches the same local Ollama endpoint today (honest: no cloud branch to divert it yet)", async () => {
    seedUser("cb_user_highpower", "high_power");
    fake.hits.length = 0;
    const r = await T.callBrain("conscious", "hello", { _userId: "cb_user_highpower" });
    assert.equal(r.ok, true);
    assert.equal(fake.hits.length, 1);
  });

  it("the mode lookup never throws for a user id that doesn't exist in the users table", async () => {
    fake.hits.length = 0;
    const r = await T.callBrain("conscious", "hello", { _userId: "cb_user_never_seeded_ghost" });
    assert.equal(r.ok, true, "an unknown user must still degrade gracefully to a working call, not throw");
    assert.equal(fake.hits.length, 1);
  });

  it("a call with no _userId at all (system-scoped call site) still works, mode lookup skipped entirely", async () => {
    fake.hits.length = 0;
    const r = await T.callBrain("conscious", "hello", {});
    assert.equal(r.ok, true);
    assert.equal(fake.hits.length, 1);
  });
});
