// POST /api/abstraction/upgrade forces a store-wide tier upgrade: admin roles
// only, fail-closed. Mounted through the real operations registrar and the
// same role gate server.js uses.
import { describe, it, before, after } from "node:test";
import assert from "node:assert/strict";
import http from "node:http";
import express from "express";
import { createRoleGate } from "../lib/role-gate.js";
import registerOperationRoutes from "../routes/operations.js";

let upgrades = 0;
function post(port, path, role) {
  return new Promise((resolve, reject) => {
    const headers = { "content-type": "application/json" };
    if (role) headers["x-test-role"] = role;
    const req = http.request({ hostname: "127.0.0.1", port, path, method: "POST", headers }, (res) => {
      const c = []; res.on("data", (x) => c.push(x)); res.on("end", () => resolve({ status: res.statusCode, body: Buffer.concat(c).toString() }));
    });
    req.on("error", reject); req.end("{}");
  });
}

describe("POST /api/abstraction/upgrade role gate", () => {
  let server; let port;
  before(async () => {
    const { requireRole } = createRoleGate(() => "hybrid");
    const app = express();
    app.use(express.json());
    app.use((req, _res, next) => { const r = req.headers["x-test-role"]; if (r) req.user = { id: "u", role: r }; next(); });
    const noop = () => {};
    registerOperationRoutes(app, {
      STATE: { abstraction: {}, dtus: new Map(), organs: new Map() }, requireRole, runMacro: noop, _withAck: (x) => x, ensureOrganRegistry: noop, ensureQueues: noop, userVisibleDTUs: () => [],
      uid: () => "id", sha256Hex: () => "h", nowISO: () => new Date().toISOString(), saveStateDebounced: noop, PIPE: {}, TEMPORAL_FRAMES: {},
      pipeListProposals: () => [], computeAbstractionSnapshot: () => ({}), maybeRunLocalUpgrade: async () => { upgrades++; return { ok: true }; },
      runAutoPromotion: async () => ({}), tryLoadSeedDTUs: () => [], toOptionADTU: (x) => x, SEED_INFO: {}, _kernelTick: noop, _uiJson: (x) => x,
    });
    server = await new Promise((r) => { const s = http.createServer(app); s.listen(0, "127.0.0.1", () => r(s)); });
    port = server.address().port;
  });
  after(() => server?.close());

  it("anonymous is refused and nothing runs", async () => {
    const r = await post(port, "/api/abstraction/upgrade");
    assert.equal(r.status, 401);
    assert.equal(upgrades, 0);
  });
  it("a member is refused (403) and nothing runs", async () => {
    for (const role of ["member", "viewer", "user", "pro"]) {
      const r = await post(port, "/api/abstraction/upgrade", role);
      assert.equal(r.status, 403, role);
    }
    assert.equal(upgrades, 0);
  });
  it("owner/admin/founder can run it", async () => {
    for (const role of ["owner", "admin", "founder"]) {
      const r = await post(port, "/api/abstraction/upgrade", role);
      assert.equal(r.status, 200, `${role}: ${r.body}`);
    }
    assert.equal(upgrades, 3);
  });
});
