// server/tests/literary-gutenberg-ingest.test.js
//
// In-process Gutenberg ingest (replaces running scripts/ingest-gutenberg.mjs
// against a live DB). Offline: the Gutenberg fetch is stubbed, the db is a temp
// migrated SQLite file, embeddings off. Pins: 401 anonymous, 403 non-admin,
// admin runs the ingest on the handed db, a second call is idempotent (0 new,
// all skipped), a concurrent call is refused (409), the rate limit (429), and
// the server.js wiring (same route behind requireRole, no new DB connection).

import { describe, it, before, after } from "node:test";
import assert from "node:assert/strict";
import http from "node:http";
import express from "express";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import Database from "better-sqlite3";
import { runMigrations } from "../migrate.js";
import { createRoleGate } from "../lib/role-gate.js";
import { GUTENBERG_MANIFEST, createGutenbergIngest, mountGutenbergIngestRoutes, stripGutenbergBoilerplate } from "../lib/literary-gutenberg.js";

const here = path.dirname(fileURLToPath(import.meta.url));

const BOOK = `*** START OF THE PROJECT GUTENBERG EBOOK TEST ***\nCHAPTER I. One\n\n${"It was the best of times, it was the worst of times. ".repeat(80)}\n\nCHAPTER II. Two\n\n${"Call me Ishmael. Some years ago, never mind how long precisely. ".repeat(80)}\n*** END OF THE PROJECT GUTENBERG EBOOK TEST ***\nlicense text`;

function stubFetch(log, { failIds = [] } = {}) {
  return async (url) => {
    log.push(url);
    if (failIds.some((id) => url.includes(`/${id}/`) || url.includes(`pg${id}.txt`))) return { ok: false, text: async () => "" };
    return { ok: true, text: async () => BOOK };
  };
}

let dir, db;
before(async () => {
  dir = fs.mkdtempSync(path.join(os.tmpdir(), "gut-ingest-"));
  db = new Database(path.join(dir, "t.db"));
  db.pragma("journal_mode = WAL");
  db.pragma("foreign_keys = ON");
  const orig = console.log; console.log = () => {};
  try { await runMigrations(db); } finally { console.log = orig; }
});
after(() => { try { db.close(); } catch { /* */ } fs.rmSync(dir, { recursive: true, force: true }); });

function buildApp({ authMode = "hybrid", ingestOpts = {} } = {}) {
  const { requireRole } = createRoleGate(() => authMode);
  const app = express();
  app.use(express.json());
  app.use((req, _res, next) => { const r = req.headers["x-test-role"]; if (r) req.user = { id: "u1", role: r }; next(); });
  mountGutenbergIngestRoutes(app, { requireRole, getDb: () => db, ingestOpts });
  return app;
}
const serve = (app) => new Promise((r) => { const s = http.createServer(app); s.listen(0, "127.0.0.1", () => r({ s, port: s.address().port })); });
const call = (port, method, role, body) => new Promise((resolve, reject) => {
  const headers = { "content-type": "application/json" }; if (role) headers["x-test-role"] = role;
  const req = http.request({ hostname: "127.0.0.1", port, path: "/api/admin/literary-ingest/gutenberg", method, headers }, (res) => {
    const c = []; res.on("data", (x) => c.push(x));
    res.on("end", () => resolve({ status: res.statusCode, body: JSON.parse(Buffer.concat(c).toString() || "{}") }));
  });
  req.on("error", reject); if (body) req.write(JSON.stringify(body)); req.end();
});
const waitIdle = async (port, role = "admin") => { for (let i = 0; i < 400; i++) { const r = await call(port, "GET", role); if (!r.body.running) return r.body; await new Promise((x) => setTimeout(x, 25)); } throw new Error("run did not finish"); };

describe("authz", () => {
  let srv; const fetched = [];
  before(async () => { srv = await serve(buildApp({ ingestOpts: { fetchImpl: stubFetch(fetched), minIntervalMs: 0, fetchOpts: { backoffMs: 0 } } })); });
  after(() => srv.s.close());
  it("anonymous -> 401 on POST and GET, nothing fetched", async () => {
    assert.equal((await call(srv.port, "POST", null, {})).status, 401);
    assert.equal((await call(srv.port, "GET", null)).status, 401);
    assert.equal(fetched.length, 0);
  });
  it("member-class roles -> 403, nothing fetched", async () => {
    for (const role of ["member", "viewer", "user", "editor"]) {
      assert.equal((await call(srv.port, "POST", role, {})).status, 403, role);
    }
    assert.equal(fetched.length, 0);
  });
});

describe("admin run on the running server's db handle", () => {
  let srv; const fetched = []; let before0;
  before(async () => {
    srv = await serve(buildApp({ ingestOpts: { fetchImpl: stubFetch(fetched, { failIds: ["844"] }), minIntervalMs: 0, fetchOpts: { backoffMs: 0 } } }));
    before0 = db.prepare("SELECT COUNT(*) n FROM literary_sources").get().n;
  });
  after(() => srv.s.close());

  it("admin starts a run (202) and it ingests the manifest, isolating a failed work", async () => {
    const r = await call(srv.port, "POST", "admin", { embed: false });
    assert.equal(r.status, 202);
    const st = await waitIdle(srv.port);
    const sum = st.last;
    assert.equal(sum.total, GUTENBERG_MANIFEST.length);
    assert.equal(sum.ingested, GUTENBERG_MANIFEST.length - 1);
    assert.equal(sum.failed, 1);
    assert.equal(sum.skipped, 0);
    assert.ok(sum.chunks > 0);
    assert.equal(sum.works.find((w) => w.gutenbergId === "844").status, "failed");
    const n = db.prepare("SELECT COUNT(*) n FROM literary_sources WHERE chunk_count > 0").get().n;
    assert.equal(n - before0, GUTENBERG_MANIFEST.length - 1);
  });

  it("a second call is idempotent: 0 new works, the rest reported skipped", async () => {
    const chunksBefore = db.prepare("SELECT COUNT(*) n FROM literary_chunks").get().n;
    const r = await call(srv.port, "POST", "owner", { embed: false });
    assert.equal(r.status, 202);
    const sum = (await waitIdle(srv.port, "owner")).last;
    assert.equal(sum.ingested, 0);
    assert.equal(sum.skipped, GUTENBERG_MANIFEST.length - 1);
    assert.equal(sum.failed, 1); // the one unavailable work is retried and still unavailable
    assert.equal(db.prepare("SELECT COUNT(*) n FROM literary_chunks").get().n, chunksBefore);
  });

  it("max limits how many manifest works a run considers", async () => {
    const r = await call(srv.port, "POST", "admin", { max: 2, embed: false });
    assert.equal(r.status, 202);
    assert.equal((await waitIdle(srv.port)).last.total, 2);
  });
});

describe("single-flight and rate limit", () => {
  it("a concurrent call while a run is in progress is refused with 409", async () => {
    let release; const gate = new Promise((r) => { release = r; });
    const slowFetch = async () => { await gate; return { ok: true, text: async () => BOOK }; };
    const srv = await serve(buildApp({ ingestOpts: { fetchImpl: slowFetch, minIntervalMs: 0, fetchOpts: { backoffMs: 0 }, manifest: GUTENBERG_MANIFEST.slice(0, 1).map((w) => ({ ...w, gutenbergId: "9001" })) } }));
    try {
      assert.equal((await call(srv.port, "POST", "admin", { embed: false })).status, 202);
      const second = await call(srv.port, "POST", "admin", { embed: false });
      assert.equal(second.status, 409);
      assert.equal(second.body.error, "already_running");
      assert.equal((await call(srv.port, "GET", "admin")).body.running, true);
      release();
      await waitIdle(srv.port);
      assert.equal((await call(srv.port, "GET", "admin")).body.running, false);
    } finally { release(); srv.s.close(); }
  });

  it("a new run inside minIntervalMs is refused with 429 and retryAfterMs", async () => {
    let t = 1000;
    const svc = createGutenbergIngest({ db, manifest: [], minIntervalMs: 60000, now: () => t });
    const a = svc.start(); assert.equal(a.started, true); await a.done;
    t += 10000;
    const b = svc.start(); assert.equal(b.started, false); assert.equal(b.reason, "rate_limited"); assert.equal(b.retryAfterMs, 50000);
    t += 60000;
    assert.equal(svc.start().started, true);
  });

  it("the route maps rate_limited to 429", async () => {
    const srv = await serve(buildApp({ ingestOpts: { fetchImpl: stubFetch([]), minIntervalMs: 3600000, manifest: [] } }));
    try {
      assert.equal((await call(srv.port, "POST", "admin", {})).status, 202);
      await waitIdle(srv.port);
      const r = await call(srv.port, "POST", "admin", {});
      assert.equal(r.status, 429);
      assert.ok(r.body.retryAfterMs > 0);
    } finally { srv.s.close(); }
  });
});

describe("helpers + wiring", () => {
  it("strips the Gutenberg header and footer", () => {
    const t = stripGutenbergBoilerplate(BOOK);
    assert.ok(!/PROJECT GUTENBERG/.test(t) && !/license text/.test(t) && /CHAPTER I/.test(t));
  });
  it("server.js mounts the routes on the running db handle, no new connection or migration in the lib", () => {
    const src = fs.readFileSync(path.join(here, "..", "server.js"), "utf8");
    assert.match(src, /mountGutenbergIngestRoutes\(app, \{ requireRole, getDb: \(\) => db,/);
    const lib = fs.readFileSync(path.join(here, "..", "lib", "literary-gutenberg.js"), "utf8");
    assert.ok(!/better-sqlite3|new Database|runMigrations/.test(lib.replace(/\/\/.*$/gm, "")));
  });
  it("the offline script refuses the live default db path", () => {
    const sc = fs.readFileSync(path.join(here, "..", "..", "scripts", "ingest-gutenberg.mjs"), "utf8");
    assert.match(sc, /refusing to open the live database/);
    assert.match(sc, /POST \/api\/admin\/literary-ingest\/gutenberg/);
  });
});
