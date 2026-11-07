/**
 * The Emergency Services roster lifecycle, exercised end to end (S2).
 *
 * First pass (Product Review 2, 2026-11-01): a roster unit, once
 * added, could never be edited or removed — the row offered only the
 * guarded dispatch arrow — and the registered status writer stood
 * unsurfaced. Cross-check #71(b) split the price: status is a
 * surfacing; edit and delete are builds.
 *
 * This test spawns the real server and drives the shipped macros as a
 * member through /api/lens/run: add a unit, correct its record,
 * take it out of service and back (the non-dispatch status path),
 * retire it. A bystander member's roster stays empty throughout.
 * Synthetic fixtures only; no incident is created and nothing is
 * dispatched — the dispatch core stays NOT RUN, per the lens's
 * standing guardrail.
 *
 * Run: node --test tests/e2e/emergency-services-unit-lifecycle.test.js
 */

import { describe, it, before, after } from "node:test";
import assert from "node:assert/strict";
import { createServer } from "node:http";
import { spawn } from "node:child_process";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { armOrphanGuard } from "../lib/e2e-orphan-guard.js";

const __dirname = dirname(fileURLToPath(import.meta.url));
const SERVER_JS = join(__dirname, "../../server.js");
const SERVER_CWD = join(__dirname, "../..");
const BROWSER_UA = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36";

function getFreePort() {
  return new Promise((resolve, reject) => {
    const srv = createServer();
    srv.listen(0, "127.0.0.1", () => {
      const { port } = srv.address();
      srv.close(() => resolve(port));
    });
    srv.on("error", reject);
  });
}

function spawnServer(port, dataDir) {
  // Current main's cold boot measures ~90s on this VM class (the
  // October harness's 90s budget no longer fits it); 240s of headroom
  // keeps a slow boot from masquerading as a product failure.
  const timeoutMs = 240000;
  return new Promise((resolve, reject) => {
    const env = Object.assign({}, process.env, {
      PORT: String(port),
      NODE_ENV: "e2e-test",
      CONCORD_NO_LISTEN: "false",
      CONCORD_LOAD_SHED_ENABLED: "0",
      CONCORD_USER_CACHE_TTL_MS: "0",
      CONCORD_DISABLE_BRAINS: "true",
      DATA_DIR: dataDir,
      LOG_LEVEL: "info",
      LOG_FORMAT: "json",
      AUTH_MODE: "hybrid",
    });
    delete env.DB_PATH;
    delete env.STATE_PATH;

    const child = spawn(process.execPath, [SERVER_JS], {
      env,
      cwd: SERVER_CWD,
      stdio: ["ignore", "pipe", "pipe"],
    });
    armOrphanGuard(child, dataDir);

    let resolved = false;
    const timer = setTimeout(() => {
      if (!resolved) {
        child.kill("SIGKILL");
        reject(new Error("Server on port " + port + " did not become ready within " + timeoutMs + "ms"));
      }
    }, timeoutMs);

    function checkLine(line) {
      if (
        line.includes("server_listening") ||
        line.includes("http://localhost:" + port) ||
        line.includes('"url":"http://localhost:' + port + '"') ||
        line.includes("Listening on port " + port) ||
        line.includes("listening on")
      ) {
        if (!resolved) {
          resolved = true;
          clearTimeout(timer);
          resolve(child);
        }
      }
    }

    let stdoutBuf = "";
    child.stdout.on("data", (chunk) => {
      stdoutBuf += chunk.toString();
      const lines = stdoutBuf.split("\n");
      stdoutBuf = lines.pop();
      lines.forEach(checkLine);
    });
    let stderrBuf = "";
    child.stderr.on("data", (chunk) => {
      stderrBuf += chunk.toString();
      const lines = stderrBuf.split("\n");
      stderrBuf = lines.pop();
      lines.forEach(checkLine);
    });
    child.on("exit", (code, signal) => {
      if (!resolved) {
        clearTimeout(timer);
        reject(new Error("Server exited early (code=" + code + " signal=" + signal + ")"));
      }
    });
    child.on("error", (err) => {
      if (!resolved) {
        clearTimeout(timer);
        reject(err);
      }
    });
  });
}

function stopServer(child) {
  if (!child || child.killed) return Promise.resolve();
  return new Promise((resolve) => {
    child.kill("SIGTERM");
    const t = setTimeout(() => { child.kill("SIGKILL"); resolve(); }, 5000);
    child.on("exit", () => { clearTimeout(t); resolve(); });
  });
}

async function apiFetch(base, path, options = {}) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 15000);
  try {
    return await fetch(base + path, {
      ...options,
      signal: controller.signal,
      headers: {
        "User-Agent": BROWSER_UA,
        ...(options.headers || {}),
      },
    });
  } finally {
    clearTimeout(timer);
  }
}

async function postJSON(base, path, payload, headers) {
  const res = await apiFetch(base, path, {
    method: "POST",
    headers: { "Content-Type": "application/json", ...(headers || {}) },
    body: JSON.stringify(payload || {}),
  });
  let body = null;
  try { body = await res.json(); } catch { body = null; }
  return { status: res.status, body };
}

async function registerUser(base, label) {
  const uniq = (label + Date.now().toString(36) + Math.random().toString(36).slice(2, 6)).slice(0, 28);
  const reg = await postJSON(base, "/api/auth/register", {
    username: uniq,
    email: uniq + "@example.com",
    password: "TestPass123!",
    dateOfBirth: "1990-01-01",
    _t: Date.now() - 5000,
  });
  if (reg.status !== 201 || !reg.body?.token) {
    throw new Error("Setup failed: could not register " + label + ": " + JSON.stringify(reg));
  }
  return {
    headers: { Authorization: "Bearer " + reg.body.token },
    userId: reg.body.user?.id,
    role: reg.body.user?.role,
  };
}

async function lens(base, actor, action, input) {
  // The /api/lens/run envelope (lib/lens-run-http.js) lifts a handler's
  // { ok:false } to the top of the body with a 4xx status — an honest
  // refusal is NOT an HTTP 200. Callers assert the envelope they mean.
  const r = await postJSON(base, "/api/lens/run", { domain: "emergency-services", action, input }, actor.headers);
  return r;
}

async function lensOk(base, actor, action, input) {
  const r = await lens(base, actor, action, input);
  assert.equal(r.status, 200, `${action} http status`);
  assert.equal(r.body?.ok, true, `${action} ok`);
  return r.body;
}

describe("E2E — Emergency Services roster lifecycle (S2)", { timeout: 480000 }, () => {
  let base;
  let serverProc;
  let dataDir;
  let member;
  let bystander;

  before(async () => {
    const port = await getFreePort();
    dataDir = mkdtempSync(join(tmpdir(), "concord-e2e-ems-lifecycle-"));
    base = "http://127.0.0.1:" + port;
    serverProc = await spawnServer(port, dataDir);
    await registerUser(base, "owner"); // first user = owner; tests run as members
    member = await registerUser(base, "member");
    bystander = await registerUser(base, "bystander");
  });

  after(async () => {
    await stopServer(serverProc);
    if (dataDir) { try { rmSync(dataDir, { recursive: true, force: true }); } catch { /* best effort */ } }
  });

  it("adds, corrects, repositions, parks and retires a unit through the real dispatch", async () => {
    // Add — with the review's own discipline problem: a call-sign that
    // will need correcting.
    const added = await lensOk(base, member, "unit-add", { name: "E2E Engin 1", kind: "fire_engine", station: "ST-1" });
    const unitId = added.result.unit.id;
    assert.ok(unitId);

    // Correct the record — call-sign, station, and a map position.
    const updated = await lensOk(base, member, "unit-update", { id: unitId, name: "E2E Engine 1", station: "ST-9", lat: 41.7, lng: -73.9 });
    assert.equal(updated.result.unit.name, "E2E Engine 1");
    assert.equal(updated.result.unit.station, "ST-9");
    assert.equal(updated.result.unit.lat, 41.7);

    // The roster reads the corrected record, with the server's legal
    // status set attached — and the bystander sees none of it.
    const mine = await lensOk(base, member, "unit-list", {});
    assert.equal(mine.result.count, 1);
    assert.equal(mine.result.units[0].name, "E2E Engine 1");
    assert.deepEqual(mine.result.units[0].allowedNext, ["dispatched", "out_of_service"]);
    const theirs = await lensOk(base, bystander, "unit-list", {});
    assert.equal(theirs.result.count, 0);

    // The non-dispatch status path: out of service and back.
    const parked = await lensOk(base, member, "unit-status-advance", { id: unitId, status: "out_of_service" });
    assert.equal(parked.result.unit.status, "out_of_service");
    const back = await lensOk(base, member, "unit-status-advance", { id: unitId, status: "available" });
    assert.equal(back.result.unit.status, "available");

    // Retire the unit: after delete, the roster is empty again.
    const removed = await lensOk(base, member, "unit-delete", { id: unitId });
    assert.equal(removed.result.deleted, true);
    const after = await lensOk(base, member, "unit-list", {});
    assert.equal(after.result.count, 0);
  });

  it("refuses to retire a committed unit and says why", async () => {
    const added = await lensOk(base, member, "unit-add", { name: "E2E Medic 1", kind: "ambulance", station: "ST-2" });
    const unitId = added.result.unit.id;
    // State-machine move only (synthetic record, no incident exists):
    // the unit now sits in the committed half of the flow.
    const moved = await lensOk(base, member, "unit-status-advance", { id: unitId, status: "dispatched" });
    const refused = await lens(base, member, "unit-delete", { id: unitId });
    assert.ok(refused.status >= 400, "the refusal rides a 4xx envelope, not a 200");
    assert.equal(refused.body?.ok, false);
    assert.equal(refused.body?.error, "unit_is_assigned");
    const list = await lensOk(base, member, "unit-list", {});
    assert.equal(list.result.count, 1);
    // Clean the fixture up through the legal path.
    await lens(base, member, "unit-status-advance", { id: unitId, status: "available" });
    const removed = await lensOk(base, member, "unit-delete", { id: unitId });
  });
});
