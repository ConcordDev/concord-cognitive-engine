// #2344 CodeQL missing-rate-limiting review: the two routes that amplify
// work per call get a per-user bucket; the rest are shown to be bounded by
// the global limiter (see the PR notes). Behaviour test for consent-all,
// source pin for the App Maker mutations.
import { describe, it, before, after } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import http from "node:http";
import express from "express";
import Database from "better-sqlite3";

delete process.env.CONCORD_RATE_LIMIT_BYPASS;
const { LIMITS, checkRateLimit } = await import("../rateLimit.js");
const { default: createLatticeRouter } = await import("../routes/lattice.js");

const __dirname = path.dirname(fileURLToPath(import.meta.url));

describe("rate limit buckets", () => {
  it("defines tight per-user buckets for consent-all and App Maker writes", () => {
    assert.deepEqual(LIMITS["write.consent-bulk"], { max: 20, windowMs: 60000 });
    assert.deepEqual(LIMITS["write.apps"], { max: 60, windowMs: 60000 });
  });

  it("denies the call after the bucket is spent and recovers per key", () => {
    const key = `unit-${Date.now()}`;
    for (let i = 0; i < 20; i++) assert.equal(checkRateLimit(key, "write.consent-bulk").allowed, true);
    assert.equal(checkRateLimit(key, "write.consent-bulk").allowed, false);
    assert.equal(checkRateLimit(`${key}-other`, "write.consent-bulk").allowed, true);
  });
});

describe("POST /api/lattice/dtus/consent-all", () => {
  let server, base, db;
  before(async () => {
    db = new Database(":memory:");
    db.exec(`CREATE TABLE dtus (id TEXT PRIMARY KEY, creator_id TEXT, train_consented INTEGER DEFAULT 0);
             CREATE TABLE lattice_consent_log (id TEXT PRIMARY KEY, user_id TEXT, action TEXT, dtu_id TEXT, old_value INTEGER, new_value INTEGER, affected INTEGER, created_at TEXT DEFAULT CURRENT_TIMESTAMP);
             INSERT INTO dtus (id, creator_id) VALUES ('d1','rl-user'),('d2','rl-user');`);
    const app = express();
    app.use(express.json());
    app.use((req, _res, next) => { req.user = { id: req.headers["x-test-user"] || "rl-user" }; next(); });
    app.use("/api/lattice", createLatticeRouter({ db, requireAuth: () => (_req, _res, next) => next() }));
    server = http.createServer(app);
    await new Promise((r) => server.listen(0, "127.0.0.1", r));
    base = `http://127.0.0.1:${server.address().port}`;
  });
  after(() => new Promise((r) => server.close(r)));

  const post = (user) => fetch(`${base}/api/lattice/dtus/consent-all`, {
    method: "POST", headers: { "content-type": "application/json", "x-test-user": user }, body: JSON.stringify({ consented: true }),
  });

  it("allows 20 per minute per user, then answers 429 with Retry-After, without writing", async () => {
    for (let i = 0; i < 20; i++) assert.equal((await post("rl-user")).status, 200);
    const logged = db.prepare("SELECT COUNT(*) n FROM lattice_consent_log").get().n;
    const blocked = await post("rl-user");
    assert.equal(blocked.status, 429);
    assert.ok(Number(blocked.headers.get("retry-after")) >= 0);
    assert.equal((await blocked.json()).endpoint, "write.consent-bulk");
    assert.equal(db.prepare("SELECT COUNT(*) n FROM lattice_consent_log").get().n, logged, "a refused call writes no audit row");
  });

  it("does not throttle a different user", async () => {
    assert.equal((await post("another-user")).status, 200);
  });
});

describe("App Maker mutations carry the write.apps limiter", () => {
  const src = fs.readFileSync(path.join(__dirname, "..", "server.js"), "utf8");
  for (const route of [
    'app.post("/api/apps",',
    'app.post("/api/apps/:id/promote",',
    'app.put("/api/apps/:id",',
    'app.delete("/api/apps/:id",',
  ]) {
    it(`${route} is rate limited after auth`, () => {
      const line = src.split("\n").find((l) => l.startsWith(route));
      assert.ok(line, `route line for ${route}`);
      assert.match(line, /requireAuth\(\), perEndpointRateLimit\("write\.apps"\), asyncHandler/);
    });
  }
});
