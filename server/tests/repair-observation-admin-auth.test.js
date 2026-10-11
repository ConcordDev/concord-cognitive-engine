// Admin repair-cortex status is owner-only.
//
// The routes are the same registrar server.js mounts. The gate is the same
// createRoleGate server.js delegates requireAuth/requireRole to. Anonymous
// callers have no req.user (401). A member is authenticated and rejected (403).
// An owner receives the durable signature counts.
//
// Run: node --test tests/repair-observation-admin-auth.test.js

import { describe, it, before, after } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import http from "node:http";
import express from "express";
import Database from "better-sqlite3";
import { createRoleGate } from "../lib/role-gate.js";
import { registerRepairCortexStatusRoutes } from "../lib/repair-cortex-status-routes.js";
import { up as migrateSignatures } from "../migrations/473_repair_observation_signatures.js";
import {
  observe,
  configureRepairPersistence,
  getErrorAccumulator,
  getRepairMemoryStats,
  getRepairObservationStatus,
  getFullRepairStatus,
  _resetRepairObservationsForTest,
} from "../emergent/repair-cortex.js";

function listen(app) {
  return new Promise((resolve) => {
    const server = http.createServer(app);
    server.listen(0, "127.0.0.1", () => resolve(server));
  });
}

function request(port, path, role) {
  return new Promise((resolve, reject) => {
    const headers = {};
    if (role) headers["x-test-role"] = role;
    const req = http.request(
      { hostname: "127.0.0.1", port, path, method: "GET", headers },
      (res) => {
        const chunks = [];
        res.on("data", (chunk) => chunks.push(chunk));
        res.on("end", () => {
          const raw = Buffer.concat(chunks).toString("utf8");
          let body = null;
          try { body = JSON.parse(raw); } catch { body = raw; }
          resolve({ status: res.statusCode, body });
        });
      },
    );
    req.on("error", reject);
    req.end();
  });
}

describe("admin repair status exposure", () => {
  let server;
  let port;
  let db;
  let signature;

  before(async () => {
    process.env.CONCORD_REPAIR_OBS_FLUSH_MS = "0";
    _resetRepairObservationsForTest();
    db = new Database(":memory:");
    migrateSignatures(db);
    configureRepairPersistence(db);
    const marker = `admin-visible-${Date.now()}`;
    observe(new Error(marker), "admin_status");
    signature = getRepairObservationStatus().entries.find((entry) => entry.message.includes("admin-visible"))?.signature;
    assert.ok(signature, "expected a signature for the marker error");

    const { requireAuth, requireRole } = createRoleGate(() => "hybrid");
    const app = express();
    // Stand-in for the JWT middleware: it sets req.user before the route gate.
    // No header means anonymous, which is what requireAuth rejects.
    app.use((req, _res, next) => {
      const role = req.headers["x-test-role"];
      if (typeof role === "string" && role) req.user = { id: "user-test", role };
      next();
    });
    registerRepairCortexStatusRoutes(app, {
      requireAuth,
      requireRole,
      repairState: {
        sleeping: false,
        currentFix: null,
        totalFixes: 0,
        knownPatterns: [],
        consecutiveFailures: 0,
        maxConsecutiveFailures: 3,
        fixHistory: [],
      },
      brain: { repair: { enabled: false } },
      getErrorAccumulator,
      getRepairMemoryStats,
      getRepairObservationStatus,
      getFullRepairStatus,
    });
    server = await listen(app);
    port = server.address().port;
  });

  after(async () => {
    if (server) await new Promise((resolve) => server.close(resolve));
    try { db?.close(); } catch { /* noop */ }
    _resetRepairObservationsForTest();
    delete process.env.CONCORD_REPAIR_OBS_FLUSH_MS;
  });

  for (const path of ["/api/admin/repair/status", "/api/admin/repair/full-status"]) {
    it(`GET ${path} is 401 for an anonymous caller`, async () => {
      const res = await request(port, path);
      assert.equal(res.status, 401);
      assert.equal(JSON.stringify(res.body).includes(signature), false);
    });

    it(`GET ${path} is 403 for a member`, async () => {
      const res = await request(port, path, "member");
      assert.equal(res.status, 403);
      assert.equal(res.body.ok, false);
      assert.deepEqual(res.body.requiredRoles, ["owner"]);
      assert.equal(JSON.stringify(res.body).includes(signature), false);
    });

    it(`GET ${path} returns signature counts to an owner`, async () => {
      const res = await request(port, path, "owner");
      assert.equal(res.status, 200);
      const observations = path.endsWith("/full-status")
        ? res.body.observations
        : res.body.cortex.observations;
      assert.equal(observations.ok, true);
      assert.ok(observations.entries.some((entry) => entry.signature === signature && entry.count >= 1));
    });
  }

  it("server.js mounts these routes through the shared gate", () => {
    const serverSrc = fs.readFileSync(path.join(path.dirname(fileURLToPath(import.meta.url)), "..", "server.js"), "utf8");
    assert.match(serverSrc, /const _roleGate = createRoleGate\(\(\) => AUTH_MODE\)/);
    assert.match(serverSrc, /return _roleGate\.requireAuth\(\.\.\.args\)/);
    assert.match(serverSrc, /return _roleGate\.requireRole\(\.\.\.roles\)/);
    assert.match(serverSrc, /registerRepairCortexStatusRoutes\(app,/);
    const routeSrc = fs.readFileSync(path.join(path.dirname(fileURLToPath(import.meta.url)), "..", "lib", "repair-cortex-status-routes.js"), "utf8");
    assert.match(routeSrc, /app\.get\("\/api\/admin\/repair\/status", requireAuth\(\), requireRole\("owner"\)/);
    assert.match(routeSrc, /app\.get\("\/api\/admin\/repair\/full-status", requireAuth\(\), requireRole\("owner"\)/);
    assert.match(routeSrc, /observations: getRepairObservationStatus\(\)/);
  });

  it("requireAuth still accepts the direct (req, res, next) call shape", () => {
    const { requireAuth } = createRoleGate(() => "hybrid");
    let reached = false;
    const req = { headers: {}, user: { id: "1", role: "member" } };
    const res = { status() { return this; }, json() { return this; } };
    requireAuth(req, res, () => { reached = true; });
    assert.equal(reached, true);

    let status = null;
    requireAuth({ headers: {} }, { status(code) { status = code; return this; }, json() { return this; } }, () => {});
    assert.equal(status, 401);
  });
});
