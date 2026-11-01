/**
 * Lens actions land in the acting member's Activity feed.
 *
 * Live finding (R3 arm verdict on PR #1906, 2026-10-31, 0 of 12 legs):
 * every lens's Activity panel read "No activity yet" for members after
 * full working sessions. The shared ActivityTimeline had been repointed
 * at GET /api/events/paginated, but that feed's sources (DTU timeline,
 * audit log, STATE.logs, economy ledger) contained no lens-action
 * records at all — lens actions persisted only into their domain's own
 * state. A member's feed held only rows stamped with their id (their
 * auth audit rows); the defect was invisible from admin seats, whose
 * feed is full of system rows.
 *
 * The fix records at the dispatch chokepoint: /api/lens/run emits one
 * STATE.logs row (type = the lens domain, user-language message,
 * actor-stamped) after a successful, non-internal dispatch on BOTH
 * dispatch branches (lens-action and macro), and the paginated route's
 * Source 3 collects user-attributed rows from the whole log store
 * (filter-before-slice) so they cannot churn out under system noise.
 *
 * This test spawns the real server and drives it as two members:
 * the actor's actions must appear in the actor's feed (timestamped,
 * naming the action and, where the call carries one, the object) and
 * must NOT appear in a bystander's feed. A failed action emits nothing.
 *
 * Run: node --test tests/e2e/activity-feed-lens-actions.test.js
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
  const timeoutMs = 90000;
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
      OPENAI_API_KEY: "",
      ANTHROPIC_API_KEY: "",
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

async function getJSON(base, path, headers) {
  const res = await apiFetch(base, path, { headers: headers || {} });
  let body = null;
  try { body = await res.json(); } catch { body = null; }
  return { status: res.status, body };
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
  // Username cap is 30 chars on the register validator — keep the
  // unique suffix compact.
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

async function feedRows(base, headers) {
  const { status, body } = await getJSON(base, "/api/events/paginated?limit=100", headers);
  assert.equal(status, 200);
  assert.equal(body?.ok, true);
  return body.items || [];
}

describe("E2E — lens actions land in the actor's Activity feed", { timeout: 240000 }, () => {
  let base;
  let serverProc;
  let dataDir;
  let actor;
  let bystander;
  let experimentId = null;

  before(async () => {
    const port = await getFreePort();
    dataDir = mkdtempSync(join(tmpdir(), "concord-e2e-activity-"));
    base = "http://127.0.0.1:" + port;
    serverProc = await spawnServer(port, dataDir);
    // First registered user is owner; the two members under test follow.
    await registerUser(base, "actOwner");
    actor = await registerUser(base, "actActor");
    bystander = await registerUser(base, "actBystander");
    assert.equal(actor.role, "member");
    assert.equal(bystander.role, "member");

    // Lens-action branch: an inference KB fact and an ML experiment.
    const kb = await postJSON(base, "/api/lens/run",
      { domain: "inference", action: "kb-add", text: "parent(tom, bob)" }, actor.headers);
    assert.equal(kb.body?.ok, true, "kb-add should succeed: " + JSON.stringify(kb.body));

    const exp = await postJSON(base, "/api/lens/run",
      { domain: "ml", action: "experiment-start", input: { name: "DiagExp" } }, actor.headers);
    assert.equal(exp.body?.ok, true, "experiment-start should succeed: " + JSON.stringify(exp.body));
    experimentId = exp.body?.result?.experiment?.id;
    assert.ok(experimentId, "experiment-start should return the experiment id");

    const del = await postJSON(base, "/api/lens/run",
      { domain: "ml", action: "experiment-delete", input: { experimentId } }, actor.headers);
    assert.equal(del.body?.ok, true, "experiment-delete should succeed: " + JSON.stringify(del.body));

    // Macro branch: atlas.status dispatches through runMacro.
    const atlas = await postJSON(base, "/api/lens/run",
      { domain: "atlas", action: "status", input: {} }, actor.headers);
    assert.equal(atlas.body?.ok, true, "atlas status should succeed: " + JSON.stringify(atlas.body));

    // A FAILED action must emit nothing.
    const failed = await postJSON(base, "/api/lens/run",
      { domain: "ml", action: "experiment-start", input: {} }, actor.headers);
    assert.equal(failed.body?.ok, false, "nameless experiment-start should fail");
  });

  after(async () => {
    await stopServer(serverProc);
    if (dataDir) rmSync(dataDir, { recursive: true, force: true });
  });

  it("records the actor's lens-action runs as timestamped feed rows naming action and object", async () => {
    const rows = await feedRows(base, actor.headers);
    const byType = (t) => rows.filter((r) => r.type === t);

    const inf = byType("inference");
    assert.equal(inf.length, 1, "exactly one inference activity row: " + JSON.stringify(rows));
    assert.match(inf[0].message, /kb add/);
    assert.match(inf[0].message, /parent\(tom, bob\)/);
    assert.ok(inf[0].timestamp && !Number.isNaN(Date.parse(inf[0].timestamp)), "row is timestamped");

    const ml = byType("ml");
    assert.equal(ml.length, 2, "create + delete rows, and NOT the failed start: " + JSON.stringify(ml));
    assert.ok(ml.some((r) => r.message === "experiment start: DiagExp"),
      "create row names the action and the object: " + JSON.stringify(ml));
    assert.ok(ml.some((r) => /experiment delete/.test(r.message)),
      "delete row present (ML F17's done-state is create + delete): " + JSON.stringify(ml));
  });

  it("records macro-branch dispatches too", async () => {
    const rows = await feedRows(base, actor.headers);
    assert.ok(rows.some((r) => r.type === "atlas" && /status/.test(r.message)),
      "macro-branch row present: " + JSON.stringify(rows));
  });

  it("keeps the actor's activity invisible to a bystander member", async () => {
    const rows = await feedRows(base, bystander.headers);
    const leaked = rows.filter((r) => ["ml", "inference", "atlas"].includes(r.type));
    assert.equal(leaked.length, 0, "no cross-user activity leakage: " + JSON.stringify(leaked));
  });
});
