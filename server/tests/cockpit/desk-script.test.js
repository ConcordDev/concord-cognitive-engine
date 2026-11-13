import test, { before, after } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import crypto from "node:crypto";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import express from "express";
import { memDb, scenarioDeps } from "./_helpers.js";
import { mountCockpitRoutes } from "../../routes/cockpit.js";
import { publishRun } from "../../lib/cockpit/events.js";
import { resetSigningKeyCache } from "../../lib/receipts/attest.js";
import { deskSlowThisCall, deskFixtureAllowed } from "../../lib/cockpit/desk-fixture.js";
import { SCENARIO_STEPS, SCENARIO_MODEL_SCRIPT, makeScenarioExec } from "./scenario-32.fixture.js";
import { runScenario } from "../../scripts/cockpit-desk-scenario.mjs";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const SCRIPT = path.resolve(HERE, "../../scripts/cockpit-desk-scenario.mjs");
const KEYS = ["CONCORD_COCKPIT_RUNS", "CONCORD_COCKPIT_DESK_FIXTURE", "NODE_ENV", "CONCORD_RECEIPT_SIGNING_KEY"];
const saved = Object.fromEntries(KEYS.map((k) => [k, process.env[k]]));
before(() => {
  process.env.CONCORD_COCKPIT_RUNS = "1";
  process.env.CONCORD_COCKPIT_DESK_FIXTURE = "1";
  const { privateKey } = crypto.generateKeyPairSync("ed25519");
  process.env.CONCORD_RECEIPT_SIGNING_KEY = privateKey.export({ type: "pkcs8", format: "pem" }).toString();
  resetSigningKeyCache();
});
after(() => {
  for (const [k, v] of Object.entries(saved)) { if (v === undefined) delete process.env[k]; else process.env[k] = v; }
  resetSigningKeyCache();
});

const runScript = (args, env = {}) => spawnSync(process.execPath, [SCRIPT, ...args], {
  encoding: "utf8", env: { PATH: process.env.PATH, ...env },
});

test("--dry-run prints 32 goals and four induced failures", () => {
  const r = runScript(["--dry-run"]);
  assert.equal(r.status, 0);
  const lines = r.stdout.trim().split("\n");
  assert.equal(lines.filter((l) => /^\d\d\. /.test(l)).length, 32);
  assert.equal(lines.filter((l) => l.startsWith("induced ")).length, 4);
});

test("--dry-run makes no network call", async () => {
  const { dryRunLines } = await import("../../scripts/cockpit-desk-scenario.mjs");
  const real = globalThis.fetch;
  let calls = 0;
  globalThis.fetch = async () => { calls += 1; return new Response("{}"); };
  try { dryRunLines("all"); } finally { globalThis.fetch = real; }
  assert.equal(calls, 0);
});

test("without COCKPIT_DESK_COOKIE it exits non-zero with the stated message", () => {
  const r = runScript(["--base", "http://127.0.0.1:5055"]);
  assert.notEqual(r.status, 0);
  assert.match(r.stderr, /COCKPIT_DESK_COOKIE is not set/);
});

test("a remote host is refused without --allow-remote", () => {
  const r = runScript(["--base", "https://concord-os.org"], { COCKPIT_DESK_COOKIE: "x=1" });
  assert.notEqual(r.status, 0);
  assert.match(r.stderr, /refusing/);
});

test("the script never reads the secrets folder or prints the cookie value", () => {
  const src = fs.readFileSync(SCRIPT, "utf8");
  assert.ok(!src.includes(".zuko/secrets"));
  // The env-var name may appear in "is not set" errors. Flag only an actual cookie value or a secrets-path read.
  assert.ok(!/console\.(log|error|info|debug|warn)\([^)]*\b(process\.env\.COCKPIT_DESK_COOKIE|o\.cookie|headers\.cookie)\b/.test(src));
  assert.ok(!/(?:^|[^.\w])log\([^)]*\b(process\.env\.COCKPIT_DESK_COOKIE|o\.cookie|headers\.cookie)\b/.test(src));
});

test("the slow-tool seam does nothing in production, and fires once per run otherwise", () => {
  assert.equal(deskSlowThisCall("r1", "web_search", { NODE_ENV: "production", CONCORD_COCKPIT_DESK_SLOW_TOOL: "web_search" }), false);
  const env = { NODE_ENV: "test", CONCORD_COCKPIT_DESK_SLOW_TOOL: "web_search" };
  assert.equal(deskSlowThisCall("r2", "web_search", env), true);
  assert.equal(deskSlowThisCall("r2", "web_search", env), false);
  assert.equal(deskSlowThisCall("r3", "dtu_search", env), false);
});

test("the fixture seam is refused in production", () => {
  assert.equal(deskFixtureAllowed({ NODE_ENV: "production", CONCORD_COCKPIT_DESK_FIXTURE: "1" }), false);
  assert.equal(deskFixtureAllowed({ NODE_ENV: "test", CONCORD_COCKPIT_DESK_FIXTURE: "1" }), true);
  assert.equal(deskFixtureAllowed({ NODE_ENV: "test" }), false);
});

async function makeApp({ deps }) {
  const db = memDb();
  const app = express();
  app.use(express.json({ limit: "1mb" }));
  app.use((req, _res, next) => { req.user = { id: "u1", role: "member" }; next(); });
  const planDeps = { brainChat: async () => ({ ok: true, text: JSON.stringify({ steps: [{ goal: "model plan step", tool: "web_search" }] }) }) };
  mountCockpitRoutes({
    app, db, lensActions: new Map(), planDeps,
    makeDeps: () => ({ ...deps, emit: (e) => publishRun(e.runId, e) }),
  });
  const server = await new Promise((r) => { const s = app.listen(0, () => r(s)); });
  return { db, base: `http://127.0.0.1:${server.address().port}`, close: () => server.close() };
}

test("POST /runs: a steps body is ignored in production and honoured in test", async () => {
  const ex = makeScenarioExec();
  const d = scenarioDeps({ execTable: ex.table, modelScript: SCENARIO_MODEL_SCRIPT });
  const t = await makeApp({ deps: d.deps });
  const post = async () => (await fetch(`${t.base}/api/cockpit/runs`, {
    method: "POST", headers: { "content-type": "application/json" },
    body: JSON.stringify({ goal: "design a beam", steps: SCENARIO_STEPS.slice(0, 2) }),
  })).json();
  try {
    process.env.NODE_ENV = "production";
    const prod = await post();
    process.env.NODE_ENV = "test";
    const dev = await post();
    assert.notEqual(prod.source, "fixture");
    assert.equal(dev.source, "fixture");
    assert.equal(dev.steps.length, 2);
  } finally { process.env.NODE_ENV = "test"; t.close(); }
});

test("runScenario completes against an in-process app and writes a row for every measure", async () => {
  process.env.NODE_ENV = "test";
  const ex = makeScenarioExec();
  const d = scenarioDeps({ execTable: ex.table, modelScript: SCENARIO_MODEL_SCRIPT });
  const t = await makeApp({ deps: d.deps });
  const out = path.join(fs.mkdtempSync(path.join(os.tmpdir(), "desk-")), "results.md");
  try {
    const r = await runScenario({
      base: t.base, cookie: "sid=test", out, planFixture: true, pollMs: 25, maxWaitMs: 120000,
      answer: async () => "y", onRestart: async () => {}, log: () => {},
    });
    const md = fs.readFileSync(out, "utf8");
    for (const row of ["Steps completed", "Induced failures recovered", "Human interventions", "Duplicate writes", "Receipts valid", "Largest packet", "Largest menu", "Runs ended by one failure"]) {
      assert.ok(md.includes(row), row);
    }
    assert.ok(r.report.total === 32);
    assert.match(md, /Verdict: (PASS|FAIL)/);
  } finally { t.close(); fs.rmSync(path.dirname(out), { recursive: true, force: true }); }
});
