/**
 * The Activity labelling layer, exercised end to end.
 *
 * Live finding (R3 re-sitting on PR #1910, 2026-10-31 — 4 PASS /
 * 8 FAIL of the twelve #1906 legs): the recorder writes, but rows
 * rendered raw camelCase tool names ("registerMonitor",
 * "sessionLog"), object-carrying actions recorded action-only rows
 * (the object sat under a key the generic probe never read), one
 * write recorded nothing at all (the Inference desk's Add-a-Fact
 * posts to a dedicated REST route that bypasses /api/lens/run), and
 * read dispatches flooded the feed until real rows rotated out of
 * the panel's single global page.
 *
 * This test spawns the real server and drives it as a member through
 * the re-sitting's own dispatches, asserting the exact feed rows:
 * user-language labels, the priced objects, delete rows held to the
 * creates' standard, quiet reads, the REST add recorded, and the
 * earliest write still on the first page after a read burst. A
 * bystander must see none of it.
 *
 * Run: node --test tests/e2e/activity-feed-labelling.test.js
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
  const uniq = (label + Date.now().toString(36) + Math.random().toString(36).slice(2, 6)).slice(0, 28);
  const reg = await postJSON(base, "/api/auth/register", {
    username: uniq,
    email: uniq + "@example.com",
    password: "<MASKED_SECRET_002>!",
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

async function feedRows(base, headers, limit = 100) {
  const { status, body } = await getJSON(base, "/api/events/paginated?limit=" + limit, headers);
  assert.equal(status, 200);
  assert.equal(body?.ok, true);
  return body.items || [];
}

function messages(rows, domain) {
  return rows.filter((r) => r.type === domain).map((r) => r.message);
}

describe("E2E — Activity rows carry user-language labels and their objects", { timeout: 240000 }, () => {
  let base;
  let serverProc;
  let dataDir;
  let actor;
  let bystander;
  let checkId = null;
  let compId = null;
  let mapId = null;

  before(async () => {
    const port = await getFreePort();
    dataDir = mkdtempSync(join(tmpdir(), "concord-e2e-labelling-"));
    base = "http://127.0.0.1:" + port;
    serverProc = await spawnServer(port, dataDir);
    await registerUser(base, "labOwner");
    actor = await registerUser(base, "labActor");
    bystander = await registerUser(base, "labBystander");
    assert.equal(actor.role, "member");
    assert.equal(bystander.role, "member");

    const run = async (domain, action, input) => {
      const r = await postJSON(base, "/api/lens/run", { domain, action, input }, actor.headers);
      assert.equal(r.body?.ok, true, `${domain}/${action} should succeed: ` + JSON.stringify(r.body));
      return r.body;
    };

    // Attention — object under input.source.
    await run("attention", "distractionLog", { source: "E2E distraction", kind: "Person", durationMinutes: 1 });

    // Commonsense — ask + finding, then the read burst that used to
    // flood this lens's panel.
    const ask = await run("commonsense", "check-ask", { question: "Can e2e questions appear?" });
    checkId = ask.result?.checkId || ask.result?.check?.id;
    assert.ok(checkId, "check-ask should return the check id");
    await run("commonsense", "check-finding", { id: checkId, finding: "State the obvious" });
    await run("commonsense", "check-detail", { id: checkId });
    await run("commonsense", "check-detail", { id: checkId });
    await run("commonsense", "check-detail", { id: checkId });
    await run("commonsense", "check-list", {});

    // Inference — the desk REST add (bypasses /api/lens/run), then a
    // KB remove through lens/run.
    const rest = await postJSON(base, "/api/inference/facts",
      { subject: "e2etoken", predicate: "is", object: "a token" }, actor.headers);
    assert.equal(rest.body?.ok, true, "REST fact add should succeed: " + JSON.stringify(rest.body));
    const kbl = await run("inference", "kb-list", {});
    const fact = (kbl.result?.facts || []).find((f) => f.subject === "e2etoken");
    assert.ok(fact?.id, "the REST-added fact should be in the KB");
    await run("inference", "kb-remove", { id: fact.id });

    // Cognition — creating a trace IS the exportTrace dispatch.
    await run("cognition", "exportTrace", { title: "E2E trace", trace: { input: { question: "What is 2+2?" } } });
    await run("cognition", "listExports", {});

    // Root — save, then delete the same computation.
    const save = await run("root", "save", { kind: "operation", a: 47, b: 0, op: "+", resultGlyph: "g47", resultDecimal: 47 });
    compId = save.result?.computation?.id;
    assert.ok(compId, "root save should return the computation id");
    await run("root", "deleteComputation", { id: compId });
    await run("root", "history", {});

    // Reasoning — create, then delete the same map.
    const mc = await run("reasoning", "map-create", { title: "E2E map", rootClaim: "E2E claim" });
    mapId = mc.result?.map?.id;
    assert.ok(mapId, "map-create should return the map id");
    await run("reasoning", "map-delete", { mapId });
    await run("reasoning", "map-list", {});

    // Invariant — object already surfaced; the verb was the raw name.
    await run("invariant", "registerMonitor", { name: "E2E monitor", expression: "balance >= 0", severity: "medium" });
    await run("invariant", "listMonitors", {});

    // Meditation — goal + length, never the track.
    await run("meditation", "pickTrack", { goal: "focus", minutes: 3 });
    await run("meditation", "sessionLog", {
      trackId: "med-focus-3-0", title: "Single-pointed attention",
      category: "guided", goal: "focus", minutes: 3,
      completedAt: new Date().toISOString(),
    });

    // UX Suite — prop rows name the component.
    await run("ux-suite", "save-props", { component: "AccessibilityPanel", props: { highContrast: true } });
    await run("ux-suite", "reset-props", { component: "AccessibilityPanel" });
    await run("ux-suite", "catalog", {});

    // Regression spot-check: a discharged domain's row is unchanged.
    await run("ml", "experiment-start", { name: "DiagExp" });
  });

  after(async () => {
    await stopServer(serverProc);
    if (dataDir) { try { rmSync(dataDir, { recursive: true, force: true }); } catch { /* best effort */ } }
  });

  it("labels are user language and objects are named, per leg", async () => {
    const rows = await feedRows(base, actor.headers);
    assert.ok(messages(rows, "attention").includes("distraction log: E2E distraction"), JSON.stringify(messages(rows, "attention")));
    assert.ok(messages(rows, "commonsense").includes("check ask: Can e2e questions appear?"), JSON.stringify(messages(rows, "commonsense")));
    assert.ok(messages(rows, "commonsense").includes("check finding: Can e2e questions appear?"), JSON.stringify(messages(rows, "commonsense")));
    assert.ok(messages(rows, "inference").includes("kb add: e2etoken is a token"), JSON.stringify(messages(rows, "inference")));
    assert.ok(messages(rows, "inference").includes("kb remove: e2etoken is a token"), JSON.stringify(messages(rows, "inference")));
    assert.ok(messages(rows, "cognition").includes("trace create: E2E trace"), JSON.stringify(messages(rows, "cognition")));
    assert.ok(messages(rows, "root").includes("computation save: 47 + 0"), JSON.stringify(messages(rows, "root")));
    assert.ok(messages(rows, "root").includes("computation delete: 47 + 0"), JSON.stringify(messages(rows, "root")));
    assert.ok(messages(rows, "reasoning").includes("map create: E2E map"), JSON.stringify(messages(rows, "reasoning")));
    assert.ok(messages(rows, "reasoning").includes("map delete: E2E map"), JSON.stringify(messages(rows, "reasoning")));
    assert.ok(messages(rows, "invariant").includes("register monitor: E2E monitor"), JSON.stringify(messages(rows, "invariant")));
    assert.ok(messages(rows, "meditation").includes("session log: Focus · 3 min"), JSON.stringify(messages(rows, "meditation")));
    assert.ok(messages(rows, "ux-suite").includes("save props: AccessibilityPanel"), JSON.stringify(messages(rows, "ux-suite")));
    assert.ok(messages(rows, "ux-suite").includes("reset props: AccessibilityPanel"), JSON.stringify(messages(rows, "ux-suite")));
    assert.ok(messages(rows, "ml").includes("experiment start: DiagExp"), JSON.stringify(messages(rows, "ml")));
  });

  it("no row anywhere renders a raw camelCase tool name or the meditation track", async () => {
    const rows = await feedRows(base, actor.headers);
    for (const r of rows) {
      assert.ok(!/^(registerMonitor|sessionLog|exportTrace|distractionLog|deleteComputation|pickTrack|listMonitors|journalPrompts|getScale|checkinHistory)\b/.test(r.message || ""), "raw tool name rendered: " + r.message);
      assert.ok(!(r.message || "").includes("Single-pointed attention"), "track title leaked as an object: " + r.message);
    }
  });

  it("read dispatches wrote no rows", async () => {
    const rows = await feedRows(base, actor.headers);
    const quiet = new Set([
      "commonsense:check-detail", "commonsense:check-list",
      "inference:kb-list", "cognition:listExports", "root:history",
      "reasoning:map-list", "invariant:listMonitors",
      "meditation:pickTrack", "ux-suite:catalog",
    ]);
    for (const r of rows) {
      const key = (r.meta?.domain || r.type) + ":" + (r.meta?.action || "");
      assert.ok(!quiet.has(key), "read dispatch recorded a row: " + key + " — " + r.message);
    }
  });

  it("the earliest write survives on the panel's old 50-row page after the read burst", async () => {
    const rows = await feedRows(base, actor.headers, 50);
    assert.ok(
      messages(rows, "attention").includes("distraction log: E2E distraction"),
      "the first write rotated out of the 50-row page: " + JSON.stringify(rows.map((r) => r.message)),
    );
  });

  it("a bystander sees none of the actor's rows", async () => {
    const rows = await feedRows(base, bystander.headers);
    const all = rows.map((r) => r.message || "");
    for (const m of ["distraction log: E2E distraction", "kb add: e2etoken is a token", "trace create: E2E trace", "session log: Focus · 3 min"]) {
      assert.ok(!all.includes(m), "bystander can see the actor's row: " + m);
    }
  });
});
