// Forecast full-lens build (GB-1021) — end-to-end through the REAL server,
// driven exactly as the frontend drives it (POST /api/lens/run, forecast.*):
//
//   1. A fresh world answers honestly everywhere: recent = null, archive
//      count 0, accuracy sample_count 0 — no invented weather.
//   2. S2's server half: compose (persist) lands in the archive IN SESSION —
//      a second compose grows the count again, with no restart or reload
//      between the calls. (The FE half — the page's compose version
//      re-reading every mounted view — is pinned in the FE suite.)
//   3. The hourly and multi-day macros answer over the wire at the windows
//      the panels request (48h / 7d).
//
// Value-level pins (humidity normalization, the hourly day-2 drift, the
// accuracy derivation) live in tests/forecast-full-build.test.js against
// seeded in-process DBs; this file proves the HTTP path end to end.
// Hermetic data (temp DATA_DIR, synthetic users). Boot budget 240s:
// current main's cold boot measures ~30-90s on this VM class.

import { describe, it, before, after } from "node:test";
import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { tmpdir } from "node:os";
import { mkdtemp, rm } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const SERVER_DIR = path.resolve(__dirname, "..", "..");
const PORT = 18754;
const BASE = `http://127.0.0.1:${PORT}`;
const BROWSER_UA = "Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0 Safari/537.36";
const WORLD = "e2e-forecast-world";

function spawnServer(dataDir) {
  return new Promise((resolve, reject) => {
    const child = spawn("node", ["server.js"], {
      cwd: SERVER_DIR,
      env: {
        ...process.env,
        NODE_ENV: "e2e-test",
        PORT: String(PORT),
        DATA_DIR: dataDir,
        CONCORD_NO_LISTEN: "false",
        CONCORD_LOAD_SHED_ENABLED: "0",
        CONCORD_USER_CACHE_TTL_MS: "0",
        CONCORD_DISABLE_BRAINS: "true",
        AUTH_MODE: "hybrid",
      },
      stdio: ["ignore", "pipe", "pipe"],
    });
    let resolved = false;
    const timer = setTimeout(() => { if (!resolved) { resolved = true; reject(new Error("server_listening not seen within 240s")); } }, 240000);
    const checkLine = (line) => {
      if (!resolved && line.includes("server_listening")) {
        resolved = true; clearTimeout(timer); resolve(child);
      }
    };
    let stdoutBuf = "";
    child.stdout.on("data", (chunk) => { stdoutBuf += chunk.toString(); const lines = stdoutBuf.split("\n"); stdoutBuf = lines.pop(); lines.forEach(checkLine); });
    let stderrBuf = "";
    child.stderr.on("data", (chunk) => { stderrBuf += chunk.toString(); const lines = stderrBuf.split("\n"); stderrBuf = lines.pop(); lines.forEach(checkLine); });
    child.on("exit", (code, signal) => { if (!resolved) { resolved = true; clearTimeout(timer); reject(new Error("Server exited early (code=" + code + " signal=" + signal + ")")); } });
    child.on("error", (err) => { if (!resolved) { resolved = true; clearTimeout(timer); reject(err); } });
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

async function apiFetch(pathname, options = {}) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 60000);
  try {
    return await fetch(BASE + pathname, { ...options, signal: controller.signal, headers: { "User-Agent": BROWSER_UA, ...(options.headers || {}) } });
  } finally { clearTimeout(timer); }
}

async function reqJSON(method, pathname, payload, headers) {
  const res = await apiFetch(pathname, {
    method,
    headers: { "Content-Type": "application/json", ...(headers || {}) },
    body: payload ? JSON.stringify(payload) : undefined,
  });
  let body = null;
  try { body = await res.json(); } catch { body = null; }
  return { status: res.status, body };
}

async function registerUser(label) {
  const uniq = (label + Date.now().toString(36) + Math.random().toString(36).slice(2, 6)).slice(0, 28);
  const reg = await reqJSON("POST", "/api/auth/register", {
    username: uniq, email: uniq + "@example.com", password: "e2e-password-" + label + "-1234",
    dateOfBirth: "1990-01-01", _t: Date.now() - 5000,
  });
  if (reg.status !== 201 || !reg.body?.token) throw new Error("Setup failed: could not register " + label + ": " + JSON.stringify(reg));
  return { headers: { Authorization: "Bearer " + reg.body.token }, userId: reg.body.user?.id };
}

const lens = (actor, name, input) => reqJSON("POST", "/api/lens/run", { domain: "forecast", name, input }, actor.headers);

describe("forecast full build — compose/archive in-session freshness + honest empties (real server)", { timeout: 480000 }, () => {
  let child, dataDir, owner, member;

  before(async () => {
    dataDir = await mkdtemp(path.join(tmpdir(), "forecast-e2e-"));
    child = await spawnServer(dataDir);
    owner = await registerUser("fcowner");
    member = await registerUser("fcmember");
  });

  after(async () => {
    await stopServer(child);
    if (dataDir) await rm(dataDir, { recursive: true, force: true });
  });

  it("a fresh world answers honestly: no forecast, empty archive, zero consistency samples", async () => {
    const recent = await lens(member, "recent", { worldId: WORLD });
    assert.equal(recent.body?.result?.ok, true);
    assert.equal(recent.body.result.forecast, null);
    const archive = await lens(member, "archive", { worldId: WORLD });
    assert.equal(archive.body?.result?.count, 0);
    const accuracy = await lens(member, "accuracy", { worldId: WORLD });
    assert.equal(accuracy.body?.result?.ok, true);
    assert.equal(accuracy.body.result.summary.sample_count, 0);
  });

  it("compose persists in session: the archive grows compose by compose", async () => {
    const c1 = await lens(member, "compose", { worldId: WORLD, persist: true });
    assert.equal(c1.body?.result?.ok, true);
    const a1 = await lens(member, "archive", { worldId: WORLD });
    assert.equal(a1.body?.result?.count, 1);
    const c2 = await lens(member, "compose", { worldId: WORLD, persist: true });
    assert.equal(c2.body?.result?.ok, true);
    const a2 = await lens(member, "archive", { worldId: WORLD });
    assert.equal(a2.body?.result?.count, 2);
    const recent = await lens(member, "recent", { worldId: WORLD });
    assert.ok(recent.body?.result?.forecast, "recent returns the persisted forecast");
  });

  it("hourly answers at 48h and multi-day at 7d over the wire", async () => {
    const hourly = await lens(member, "hourly", { worldId: WORLD, hours: 48 });
    assert.equal(hourly.body?.result?.ok, true);
    assert.equal(hourly.body.result.breakdown.length, 48);
    const multi = await lens(member, "multiDay", { worldId: WORLD, days: 7 });
    assert.equal(multi.body?.result?.ok, true);
    assert.equal(multi.body.result.outlook.length, 7);
  });
});
