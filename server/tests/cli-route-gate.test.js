// POST /api/cli runs corpus-wide operator commands (full-corpus export,
// backup creation, tagging/adding DTUs) with no per-command scoping, so the
// route is gated to owner/admin — sovereign passes inside requireRole, as on
// the other operator routes. Behaviour is exercised through the same
// role-gate factory server.js uses (the abstraction-upgrade-role pattern),
// and a wiring pin asserts the registration in server.js carries the gate.
import { describe, it, before, after } from "node:test";
import assert from "node:assert/strict";
import http from "node:http";
import express from "express";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import path from "node:path";
import { createRoleGate } from "../lib/role-gate.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));

let runs = 0;
function post(port, role) {
  return new Promise((resolve, reject) => {
    const headers = { "content-type": "application/json" };
    if (role) headers["x-test-role"] = role;
    const req = http.request(
      { hostname: "127.0.0.1", port, path: "/api/cli", method: "POST", headers },
      (res) => {
        const c = [];
        res.on("data", (x) => c.push(x));
        res.on("end", () => resolve({ status: res.statusCode, body: Buffer.concat(c).toString() }));
      },
    );
    req.on("error", reject);
    req.end(JSON.stringify({ command: "export" }));
  });
}

function buildApp(authMode) {
  const { requireRole } = createRoleGate(() => authMode);
  const app = express();
  app.use(express.json());
  app.use((req, _res, next) => {
    const r = req.headers["x-test-role"];
    if (r) req.user = { id: "u1", role: r };
    next();
  });
  // Registered exactly as server.js registers the route.
  app.post("/api/cli", requireRole("owner", "admin"), (req, res) => {
    runs++;
    res.json({ ok: true });
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

describe("POST /api/cli operator gate (hybrid auth mode)", () => {
  let server, port;
  before(async () => {
    ({ server, port } = await serve(buildApp("hybrid")));
  });
  after(() => server?.close());

  it("anonymous is refused (401) and no command runs", async () => {
    const r = await post(port, null);
    assert.equal(r.status, 401);
    assert.equal(runs, 0);
  });

  it("member-class roles are refused (403) and no command runs", async () => {
    for (const role of ["member", "viewer", "user", "pro", "editor"]) {
      const r = await post(port, role);
      assert.equal(r.status, 403, role);
    }
    assert.equal(runs, 0);
  });

  it("owner and admin pass the gate", async () => {
    for (const role of ["owner", "admin"]) {
      const r = await post(port, role);
      assert.equal(r.status, 200, role);
    }
    assert.equal(runs, 2);
  });

  it("sovereign passes the gate (requireRole's standing rule)", async () => {
    const r = await post(port, "sovereign");
    assert.equal(r.status, 200);
    assert.equal(runs, 3);
  });
});

describe("POST /api/cli in AUTH_MODE=public (local/demo deploys)", () => {
  let server, port;
  before(async () => {
    ({ server, port } = await serve(buildApp("public")));
  });
  after(() => server?.close());

  it("the gate skips by design, as it does for every requireRole route", async () => {
    const before = runs;
    const r = await post(port, null);
    assert.equal(r.status, 200);
    assert.equal(runs, before + 1);
  });
});

describe("wiring", () => {
  it("server.js registers POST /api/cli behind requireRole(\"owner\", \"admin\")", () => {
    const src = readFileSync(path.join(__dirname, "..", "server.js"), "utf8");
    assert.match(src, /app\.post\("\/api\/cli", requireRole\("owner", "admin"\)/);
  });
});
