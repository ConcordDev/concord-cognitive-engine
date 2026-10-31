// GET /api/cli/stats returns operator telemetry (corpus, session, macro,
// plugin and embedding counts plus uptime) and takes the same operator gate
// as POST /api/cli: owner/admin, sovereign passing inside requireRole.
// Behaviour is exercised through the same role-gate factory server.js uses,
// and a wiring pin asserts the registration in server.js carries the gate.
// (Sibling of cli-route-gate.test.js, which pins the POST route.)
import { describe, it, before, after } from "node:test";
import assert from "node:assert/strict";
import http from "node:http";
import express from "express";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import path from "node:path";
import { createRoleGate } from "../lib/role-gate.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));

let serves = 0;
function get(port, role) {
  return new Promise((resolve, reject) => {
    const headers = {};
    if (role) headers["x-test-role"] = role;
    const req = http.request(
      { hostname: "127.0.0.1", port, path: "/api/cli/stats", method: "GET", headers },
      (res) => {
        const c = [];
        res.on("data", (x) => c.push(x));
        res.on("end", () => resolve({ status: res.statusCode, body: Buffer.concat(c).toString() }));
      },
    );
    req.on("error", reject);
    req.end();
  });
}

function buildApp(authMode) {
  const { requireRole } = createRoleGate(() => authMode);
  const app = express();
  app.use((req, _res, next) => {
    const r = req.headers["x-test-role"];
    if (r) req.user = { id: "u1", role: r };
    next();
  });
  // Registered exactly as server.js registers the route.
  app.get("/api/cli/stats", requireRole("owner", "admin"), (req, res) => {
    serves++;
    res.json({ ok: true, stats: {} });
  });
  return app;
}

async function serve(app) {
  const server = await new Promise((r) => {
    const s = http.createServer(app);
    s.listen(0, "127.0.0.1", () => r(s));
  });
  return { server, port: server.address().port };
}

describe("GET /api/cli/stats operator gate (hybrid auth mode)", () => {
  let server, port;
  before(async () => {
    ({ server, port } = await serve(buildApp("hybrid")));
  });
  after(() => server?.close());

  it("anonymous is refused (401) and no stats are served", async () => {
    const r = await get(port, null);
    assert.equal(r.status, 401);
    assert.equal(serves, 0);
  });

  it("member-class roles are refused (403) and no stats are served", async () => {
    for (const role of ["member", "viewer", "user", "pro", "editor"]) {
      const r = await get(port, role);
      assert.equal(r.status, 403, role);
    }
    assert.equal(serves, 0);
  });

  it("owner, admin and sovereign pass the gate", async () => {
    for (const role of ["owner", "admin", "sovereign"]) {
      const r = await get(port, role);
      assert.equal(r.status, 200, role);
    }
    assert.equal(serves, 3);
  });
});

describe("GET /api/cli/stats in AUTH_MODE=public (local/demo deploys)", () => {
  let server, port;
  before(async () => {
    ({ server, port } = await serve(buildApp("public")));
  });
  after(() => server?.close());

  it("the gate skips by design, as it does for every requireRole route", async () => {
    const before = serves;
    const r = await get(port, null);
    assert.equal(r.status, 200);
    assert.equal(serves, before + 1);
  });
});

describe("wiring", () => {
  it("server.js registers GET /api/cli/stats behind requireRole(\"owner\", \"admin\")", () => {
    const src = readFileSync(path.join(__dirname, "..", "server.js"), "utf8");
    assert.match(src, /app\.get\("\/api\/cli\/stats", requireRole\("owner", "admin"\)/);
  });
});
