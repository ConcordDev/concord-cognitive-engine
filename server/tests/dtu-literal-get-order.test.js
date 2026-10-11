/**
 * Literal DTU GETs in production registration order.
 *
 * server.js calls registerDtuRoutes before registerHelpersExtendedRoutes.
 * GET /api/dtus/:id lives in the first call. GET /api/dtus/recent and
 * GET /api/dtus/search used to live in the second, and GET /api/dtus/shadow
 * was registered after :id in the same function. Express matches in
 * registration order, so :id captured those words and the by-id handler
 * answered 404 {"ok":false,"error":"DTU not found"} on live.
 *
 * GET /api/dtus/search/semantic is a longer path. :id does not capture it.
 * This file mounts the two registrars in the server.js order and would
 * fail on that pre-fix tree for recent, search, and shadow.
 *
 * Run:
 *   node --test --test-timeout=60000 tests/dtu-literal-get-order.test.js
 */

import { describe, it, before, after } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import express from "express";
import registerDtuRoutes from "../routes/dtus.js";
import registerHelpersExtendedRoutes from "../routes/helpers-extended.js";
import { ctxMayReadDtu } from "../lib/dtu-read-access.js";

const OWNER = "order-owner";
const OTHER = "order-other";
const SECRET = "order-secret-content";

describe("DTU literal GETs in production registration order", () => {
  let http;

  before(async () => {
    const serverSrc = fs.readFileSync(
      path.join(path.dirname(fileURLToPath(import.meta.url)), "../server.js"),
      "utf8",
    );
    const dtuCall = serverSrc.indexOf("registerDtuRoutes(app");
    const helpersCall = serverSrc.indexOf("registerHelpersExtendedRoutes(app");
    const semanticCall = serverSrc.indexOf('app.get("/api/dtus/search/semantic"');
    assert.ok(
      dtuCall > 0 && helpersCall > dtuCall,
      "server.js registers DTU routes before helpers-extended",
    );
    assert.ok(
      semanticCall > helpersCall,
      "semantic search stays registered after both modules",
    );

    const STATE = { dtus: new Map(), shadowDtus: new Map() };
    const now = Date.now();
    STATE.dtus.set("order-public", {
      id: "order-public",
      title: "watchdog public note",
      tier: "regular",
      domain: "ops",
      visibility: "public",
      scope: "global",
      human: { summary: "a public watchdog note" },
      tags: ["watchdog"],
      createdAt: new Date(now - 1000).toISOString(),
      content: "public-body",
    });
    STATE.dtus.set("order-private", {
      id: "order-private",
      title: "watchdog private note",
      tier: "regular",
      domain: "ops",
      visibility: "private",
      scope: "local",
      ownerId: OWNER,
      author: OWNER,
      createdBy: OWNER,
      human: { summary: SECRET },
      tags: ["watchdog"],
      createdAt: new Date(now).toISOString(),
      content: SECRET,
    });

    const app = express();
    app.use(express.json());
    app.use((req, _res, next) => {
      const uid = req.get("x-test-user");
      if (uid) req.user = { id: uid, role: "member" };
      next();
    });
    const passthrough = () => (_req, _res, next) => next();

    function makeCtx(req) {
      const id = req.user?.id || null;
      return { user: req.user, actor: id ? { id } : { userId: "anon" } };
    }
    async function runMacro(_domain, name, input, ctx) {
      if (name === "get") {
        const d = STATE.dtus.get(input.id);
        if (!d || !ctxMayReadDtu(ctx, d)) return { ok: false, error: "DTU not found" };
        return { ok: true, dtu: d };
      }
      if (name === "listShadow") return { ok: true, dtus: [], source: "listShadow" };
      return { ok: true };
    }

    // Same order as server.js boot: routes/dtus.js, then helpers-extended.
    registerDtuRoutes(app, {
      STATE,
      makeCtx,
      runMacro,
      dtuForClient: (d) => d,
      dtusArray: () => [...STATE.dtus.values()],
      userVisibleDTUs: () => [],
      _withAck: (out) => out,
      _saveStateDebounced: () => {},
      validate: passthrough,
      requireRole: () => passthrough(),
    });
    registerHelpersExtendedRoutes(app, {
      db: null,
      STATE,
      makeCtx,
      runMacro,
      saveStateDebounced: () => {},
      dtusArray: () => [...STATE.dtus.values()],
      uid: (prefix) => `${prefix}_test`,
      requireAuth: passthrough,
      requireRole: () => passthrough(),
    });
    // Stand-in for the inline handler in server.js, registered in the
    // same position (after :id). Proves the extra segment is not captured.
    app.get("/api/dtus/search/semantic", (req, res) => {
      res.json({ ok: true, route: "semantic", q: req.query.q || "" });
    });

    http = await listen(app);
  });

  after(async () => {
    await http?.close();
  });

  it("GET /api/dtus/recent returns 200 and hides private DTUs from non-owners", async () => {
    const anon = await http.get("/api/dtus/recent?limit=5");
    assert.equal(anon.status, 200, JSON.stringify(anon.body));
    assert.equal(anon.body.ok, true);
    assert.equal(anon.body.error, undefined);
    const anonIds = (anon.body.dtus || []).map((d) => d.id);
    assert.ok(anonIds.includes("order-public"));
    assert.equal(anonIds.includes("order-private"), false);
    assert.equal(JSON.stringify(anon.body).includes(SECRET), false);

    const other = await http.get("/api/dtus/recent?limit=5", { userId: OTHER });
    assert.equal(other.status, 200);
    assert.equal((other.body.dtus || []).some((d) => d.id === "order-private"), false);

    const owner = await http.get("/api/dtus/recent?limit=5", { userId: OWNER });
    assert.equal(owner.status, 200);
    assert.equal((owner.body.dtus || []).some((d) => d.id === "order-private"), true);
  });

  it("GET /api/dtus/search returns 200 and applies the same owner gate", async () => {
    const anon = await http.get("/api/dtus/search?q=watchdog");
    assert.equal(anon.status, 200, JSON.stringify(anon.body));
    assert.equal(anon.body.ok, true);
    assert.equal(anon.body.error, undefined);
    const anonIds = (anon.body.results || []).map((d) => d.id);
    assert.ok(anonIds.includes("order-public"));
    assert.equal(anonIds.includes("order-private"), false);
    assert.equal(JSON.stringify(anon.body).includes(SECRET), false);

    const other = await http.get("/api/dtus/search?q=watchdog", { userId: OTHER });
    assert.equal((other.body.results || []).some((d) => d.id === "order-private"), false);

    const owner = await http.get("/api/dtus/search?q=watchdog", { userId: OWNER });
    assert.equal((owner.body.results || []).some((d) => d.id === "order-private"), true);

    const empty = await http.get("/api/dtus/search");
    assert.equal(empty.status, 200);
    assert.deepEqual(empty.body.results, []);
    assert.equal(empty.body.total, 0);
  });

  it("GET /api/dtus/:id still resolves real ids and hides private ones", async () => {
    const pub = await http.get("/api/dtus/order-public");
    assert.equal(pub.status, 200);
    assert.equal(pub.body.dtu.id, "order-public");

    const missing = await http.get("/api/dtus/does-not-exist");
    assert.equal(missing.status, 404);
    assert.equal(missing.body.error, "DTU not found");

    const anonPriv = await http.get("/api/dtus/order-private");
    assert.equal(anonPriv.status, 404);
    assert.equal(anonPriv.body.error, "DTU not found");
    assert.equal(JSON.stringify(anonPriv.body).includes(SECRET), false);

    const otherPriv = await http.get("/api/dtus/order-private", { userId: OTHER });
    assert.equal(otherPriv.status, 404);

    const ownerPriv = await http.get("/api/dtus/order-private", { userId: OWNER });
    assert.equal(ownerPriv.status, 200);
    assert.equal(ownerPriv.body.dtu.content, SECRET);
  });

  it("GET /api/dtus/shadow is the list route, not a by-id miss", async () => {
    const res = await http.get("/api/dtus/shadow");
    assert.equal(res.status, 200, JSON.stringify(res.body));
    assert.equal(res.body.ok, true);
    assert.equal(res.body.source, "listShadow");
    assert.notEqual(res.body.error, "DTU not found");
  });

  it("GET /api/dtus/search/semantic is not captured by :id", async () => {
    const res = await http.get("/api/dtus/search/semantic?q=watchdog");
    assert.equal(res.status, 200, JSON.stringify(res.body));
    assert.equal(res.body.route, "semantic");
    assert.equal(res.body.error, undefined);
  });
});

function listen(app) {
  const server = app.listen(0, "127.0.0.1");
  return new Promise((resolve, reject) => {
    server.once("error", reject);
    server.once("listening", () => {
      const port = server.address().port;
      async function get(urlPath, opts = {}) {
        const headers = {};
        if (opts.userId) headers["x-test-user"] = opts.userId;
        const res = await fetch(`http://127.0.0.1:${port}${urlPath}`, { headers });
        const text = await res.text();
        let body = null;
        try { body = JSON.parse(text); } catch { body = { raw: text }; }
        return { status: res.status, body };
      }
      resolve({
        get,
        close: () => new Promise((done) => server.close(done)),
      });
    });
  });
}
