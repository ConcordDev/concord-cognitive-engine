/**
 * GET /api/hypothesis/status 500s in production with
 * "macro not found: hypothesis.metrics".
 *
 * The route used to call runMacro("hypothesis", "metrics"). That name is
 * registered only inside initGhostFleet (server.js), which starts after
 * CONCORD_GHOST_FLEET_DELAY_MS and is skipped entirely when
 * CONCORD_DISABLE_GHOST_FLEET=true. The boot-time hypothesis.* set is the
 * legacy stub (status/propose/get/list/…) and does not include metrics,
 * add_test, or add_evidence. runMacro throws, and the route error handler
 * turns that into HTTP 500 { code: "INTERNAL_ERROR" } for every caller.
 *
 * This mounts the real domain routes with a runMacro that throws the same
 * error production throws when the macro is absent, and asserts the status
 * route (and the experiment/evidence siblings) still return the real
 * lifecycle engine instead of a 500 or a fabricated zero store.
 *
 * Run: node --test --import=./tests/preload/no-egress.mjs tests/hypothesis-status-route.test.js
 */
import { describe, it, before, after } from "node:test";
import assert from "node:assert/strict";
import express from "express";
import registerDomainRoutes from "../routes/domain.js";
import { hypothesisStatusFromMetrics } from "../lib/hypothesis-rest.js";
import {
  proposeHypothesis,
  getHypothesisMetrics,
} from "../emergent/hypothesis-engine.js";

function productionMissingMacro(domain, name) {
  throw new Error(`macro not found: ${domain}.${name}`);
}

function mount() {
  const calls = [];
  const app = express();
  app.use(express.json());
  registerDomainRoutes(app, {
    STATE: {},
    makeCtx: () => ({ actor: { userId: "anon", role: "viewer" }, reqMeta: { path: "/api/hypothesis/status", method: "GET" } }),
    runMacro: async (domain, name) => {
      calls.push(`${domain}.${name}`);
      return productionMissingMacro(domain, name);
    },
    _withAck: (x) => x,
    kernelTick: () => {},
    listDomains: () => [],
    listMacros: () => [],
    _dtusArray: () => [],
    _normalizeText: (s) => s,
    clamp: (n) => n,
    _nowISO: () => new Date().toISOString(),
    saveStateDebounced: () => {},
    retrieveDTUs: () => ({ top: [] }),
    _isShadowDTU: () => false,
    fs: {},
    ensureExperienceLearning: () => {},
    ensureAttentionManager: () => {},
    ensureReflectionEngine: () => {},
    validate: () => (_req, _res, next) => next(),
    requireOwner: (_req, _res, next) => next(),
  });
  // Same fallback the production error handler uses for a thrown runMacro.
  app.use((err, _req, res, _next) => {
    if (res.headersSent) return;
    res.status(500).json({ ok: false, error: "An unexpected error occurred", code: "INTERNAL_ERROR" });
  });
  return { app, calls };
}

function listen(app) {
  return new Promise((resolve) => {
    const server = app.listen(0, "127.0.0.1", () => resolve(server));
  });
}

async function request(server, method, path, body) {
  const res = await fetch(`http://127.0.0.1:${server.address().port}${path}`, {
    method,
    headers: body ? { "content-type": "application/json" } : undefined,
    body: body ? JSON.stringify(body) : undefined,
  });
  const json = await res.json();
  return { status: res.status, json };
}

describe("hypothesis REST routes when hypothesis.metrics is not registered", () => {
  let server;
  let calls;
  before(async () => {
    const mounted = mount();
    calls = mounted.calls;
    server = await listen(mounted.app);
  });
  after(() => new Promise((resolve) => server.close(resolve)));

  it("GET /api/hypothesis/status returns the real engine, including the legacy stats shim", async () => {
    const before = getHypothesisMetrics();
    assert.equal(before.ok, true);
    const created = proposeHypothesis("status route reads the lifecycle engine", "test", "normal");
    assert.equal(created.ok, true);

    const { status, json } = await request(server, "GET", "/api/hypothesis/status");
    const live = getHypothesisMetrics();

    assert.equal(status, 200);
    assert.equal(json.ok, true);
    assert.equal(json.code, undefined);
    assert.equal(json.total, live.total);
    assert.equal(json.byStatus.proposed, live.byStatus.proposed);
    assert.equal(json.byStatus.proposed, before.byStatus.proposed + 1);
    assert.deepEqual(json.stats, {
      proposed: live.byStatus.proposed,
      supported: live.byStatus.confirmed,
      refuted: live.byStatus.rejected,
      inconclusive: live.byStatus.testing,
    });
    assert.equal(calls.includes("hypothesis.metrics"), false);
  });

  it("POST experiment and evidence do not 500 when add_test and add_evidence are unregistered", async () => {
    const created = proposeHypothesis("sibling routes call the lifecycle engine", "test", "normal");
    assert.equal(created.ok, true);
    const id = created.hypothesis.id;

    const experiment = await request(server, "POST", `/api/hypothesis/${id}/experiment`, { design: "measure the claim" });
    assert.equal(experiment.status, 200);
    assert.equal(experiment.json.ok, true);
    assert.equal(typeof experiment.json.testId, "string");
    assert.equal(calls.includes("hypothesis.add_test"), false);

    const evidence = await request(server, "POST", `/api/hypothesis/${id}/evidence`, { evidence: "a real observation", supports: true, weight: 0.4 });
    assert.equal(evidence.status, 200);
    assert.equal(evidence.json.ok, true);
    assert.equal(calls.includes("hypothesis.add_evidence"), false);

    const missing = await request(server, "POST", "/api/hypothesis/does-not-exist/experiment", { design: "nope" });
    assert.notEqual(missing.status, 500);
    assert.equal(missing.json.ok, false);
    assert.equal(missing.json.error, "not_found");
    assert.equal(missing.json.code, undefined);
  });
});

describe("hypothesis status response shape", () => {
  it("does not invent a zero stats shim when the engine result is not ok", () => {
    const failed = hypothesisStatusFromMetrics({ ok: false, error: "metrics_failed" });
    assert.equal(failed.status, 503);
    assert.equal(failed.body.ok, false);
    assert.equal(failed.body.error, "metrics_failed");
    assert.equal(failed.body.code, "ENGINE_UNAVAILABLE");
    assert.equal("stats" in failed.body, false);

    const missing = hypothesisStatusFromMetrics(null);
    assert.equal(missing.status, 503);
    assert.equal(missing.body.error, "hypothesis_engine_unavailable");
    assert.equal("stats" in missing.body, false);
    assert.equal("byStatus" in missing.body, false);
  });

  it("maps a real empty engine onto the legacy stats fields", () => {
    const http = hypothesisStatusFromMetrics({
      ok: true,
      total: 0,
      byStatus: { proposed: 0, testing: 0, confirmed: 0, rejected: 0, refined: 0, archived: 0 },
      avgConfidence: 0,
      factDTUsCreated: 0,
      rejectionDTUsCreated: 0,
    });
    assert.equal(http.status, 200);
    assert.deepEqual(http.body.stats, { proposed: 0, supported: 0, refuted: 0, inconclusive: 0 });
    assert.equal(http.body.byStatus.refined, 0);
  });
});
