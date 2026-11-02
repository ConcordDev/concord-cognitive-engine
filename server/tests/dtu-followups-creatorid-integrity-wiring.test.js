/**
 * #1756 follow-ups:
 *  1. POST /api/connective-tissue/dtu/create forces creatorId to req.user.id
 *     (a caller can no longer mint a DTU owned by someone else).
 *  2. GET /api/canonical/integrity/:id works once an integrity system is wired
 *     into registerCanonicalRoutes (server.js passes a lazy delegate to
 *     app.locals.dtuIntegrity).
 *  3. createDTU logs a warning (no secrets) when provenance recording fails.
 *
 * Run: node --test server/tests/dtu-followups-creatorid-integrity-wiring.test.js
 */
import { describe, it, before } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import Database from "better-sqlite3";
import express from "express";
import { runMigrations } from "../migrate.js";
import connectiveTissueRoutes from "../routes/connective-tissue.js";
import registerCanonicalRoutes from "../routes/canonical.js";
import { createIntegritySystem } from "../lib/dtu-integrity.js";
import { createDTU } from "../economy/dtu-pipeline.js";

process.env.CONCORD_DTU_SIGNING_KEY = "dtu-followups-test-only-key";

function makeApp(db, extra = {}) {
  const app = express();
  app.use(express.json());
  app.use((req, _res, next) => {
    const uid = req.get("x-test-user-id");
    if (uid) req.user = { id: uid };
    next();
  });
  const requireAuth = () => (req, res, next) =>
    req.user ? next() : res.status(401).json({ ok: false, error: "Unauthorized" });
  app.use("/api/connective-tissue", connectiveTissueRoutes({ db, requireAuth }));
  registerCanonicalRoutes(app, { db, requireAuth, STATE: {}, ...extra });
  return app;
}

async function call(app, method, path, body, callerId) {
  const server = app.listen(0);
  try {
    const headers = { "content-type": "application/json" };
    if (callerId) headers["x-test-user-id"] = callerId;
    const res = await fetch(`http://127.0.0.1:${server.address().port}${path}`, {
      method, headers, body: body ? JSON.stringify(body) : undefined,
    });
    return { status: res.status, json: await res.json().catch(() => ({})) };
  } finally {
    server.close();
  }
}

describe("#1756 follow-ups", () => {
  let db;
  before(async () => {
    db = new Database(":memory:");
    db.pragma("foreign_keys = ON");
    await runMigrations(db);
  });

  it("dtu/create forces creatorId (and drops owner overrides) to the caller", async () => {
    const app = makeApp(db);
    const r = await call(app, "POST", "/api/connective-tissue/dtu/create", {
      creatorId: "victim", ownerId: "victim", owner_id: "victim", creator_id: "victim",
      title: "Mine", content: "hello", contentType: "text", lensId: "studio",
    }, "alice");
    assert.equal(r.status, 200);
    const id = r.json.dtu?.id ?? r.json.dtuId;
    assert.ok(id, "created a DTU");
    assert.equal(db.prepare("SELECT creator_id FROM dtus WHERE id = ?").get(id).creator_id, "alice");
    assert.equal(db.prepare("SELECT owner_id FROM dtu_ownership WHERE dtu_id = ?").get(id).owner_id, "alice");
  });

  it("dtu/create still requires auth", async () => {
    const r = await call(makeApp(db), "POST", "/api/connective-tissue/dtu/create",
      { creatorId: "x", title: "t", content: "c", lensId: "studio" });
    assert.equal(r.status, 401);
  });

  it("canonical integrity report works with a wired integrity system", async () => {
    const created = createDTU(db, { creatorId: "bob", title: "T", content: "body", contentType: "text", lensId: "studio" });
    const id = created.dtu?.id ?? created.dtuId;
    const app = makeApp(db, { integritySystem: createIntegritySystem(db) });
    const r = await call(app, "GET", `/api/canonical/integrity/${id}`);
    assert.equal(r.status, 200);
    assert.notEqual(r.json?.ok, false);
  });

  it("server.js passes integritySystem into registerCanonicalRoutes", () => {
    const src = readFileSync(new URL("../server.js", import.meta.url), "utf8");
    const line = src.split("\n").find((l) => l.includes("registerCanonicalRoutes(app,"));
    assert.ok(line && line.includes("integritySystem"), "integritySystem wired");
    assert.ok(src.includes("app.locals.dtuIntegrity"));
  });

  it("createDTU warns (without secrets) when provenance recording fails", async () => {
    // Fresh handle so the per-db integrity system cache is cold, with
    // dtu_integrity statements forced to throw.
    const bad = new Database(":memory:");
    bad.pragma("foreign_keys = ON");
    await runMigrations(bad);
    // integrityFor() touches db.exec on a cold handle, inside createDTU's
    // provenance try-block: make that access throw.
    const handle = new Proxy(bad, {
      get(t, prop) {
        if (prop === "exec") throw new Error("induced_integrity_failure");
        const v = t[prop];
        return typeof v === "function" ? v.bind(t) : v;
      },
    });
    const warns = [];
    const orig = console.warn;
    console.warn = (...a) => warns.push(a.join(" "));
    let r;
    try {
      r = createDTU(handle, { creatorId: "carol", title: "T2", content: "b2", contentType: "text", lensId: "studio" });
    } finally {
      console.warn = orig;
    }
    assert.ok(r.ok !== false, "publish still succeeds");
    const w = warns.find((m) => m.includes("dtu_provenance_failed"));
    assert.ok(w, `warn logged (got: ${JSON.stringify(warns)})`);
    assert.ok(w.includes("induced_integrity_failure"));
    assert.ok(!w.includes("dtu-followups-test-only-key"));
  });
});
