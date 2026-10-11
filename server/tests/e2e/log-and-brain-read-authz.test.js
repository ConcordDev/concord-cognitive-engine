/**
 * Mounted-app authz for the log ring and the two live anonymous leaks.
 *
 * Spawns server.js (AUTH_MODE=hybrid) and drives it with a normal browser
 * User-Agent. Gate 1's publicReadPaths still lets anonymous GET /api/events
 * and /api/brain through to the handlers; these assertions prove the
 * handlers themselves refuse that caller. A hermetic router test cannot
 * see that bypass.
 *
 * First registered user is owner. Second is member. A third row is flipped
 * to admin in sqlite (CONCORD_USER_CACHE_TTL_MS=0) so the admin case is the
 * admin role, not only the organic owner.
 */

import { describe, it, before, after } from "node:test";
import assert from "node:assert/strict";
import { createServer } from "node:http";
import { spawn } from "node:child_process";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { randomUUID } from "node:crypto";
import Database from "better-sqlite3";
import { armOrphanGuard } from "../lib/e2e-orphan-guard.js";

const __dirname = dirname(fileURLToPath(import.meta.url));
const SERVER_JS = join(__dirname, "../../server.js");
const SERVER_CWD = join(__dirname, "../..");
const BROWSER_UA = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36";

const MEMBER_EVENT = "MEMBER_ONLY_EVENT_9f3a";
const OTHER_EVENT = "OTHER_USER_EVENT_9f3a";
const SYSTEM_EVENT = "SYSTEM_UNATTRIBUTED_EVENT_9f3a";

const READS = [
  "/api/logs",
  "/api/events",
  "/api/events/log",
  "/api/events/paginated",
  "/api/admin/logs",
  "/api/audit",
  "/api/brain/status",
];

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
  const timer = setTimeout(() => controller.abort(), 8000);
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
  return { status: res.status, body, text: JSON.stringify(body) };
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
  const uniq = label + Date.now() + "_" + Math.random().toString(36).slice(2, 8);
  const reg = await postJSON(base, "/api/auth/register", {
    username: uniq,
    email: uniq + "@example.com",
    password: "CorrectHorseBattery9!",
    dateOfBirth: "1990-01-01",
    _t: Date.now() - 5000,
  });
  if (reg.status !== 201 || !reg.body?.token) {
    throw new Error("Setup failed: could not register " + label + ": " + JSON.stringify(reg));
  }
  return {
    headers: { Authorization: "Bearer " + reg.body.token },
    userId: reg.body.user?.id,
  };
}

function forbiddenBrainHits(value, hits = []) {
  const urlKeys = new Set(["url", "urls", "host", "hostname", "endpoint", "endpoints", "baseUrl", "baseURL", "ollamaUrl"]);
  const modelKeys = new Set(["model", "modelName", "pipelineOllamaModel"]);
  if (Array.isArray(value)) {
    for (const child of value) forbiddenBrainHits(child, hits);
    return hits;
  }
  if (value && typeof value === "object") {
    for (const [key, child] of Object.entries(value)) {
      if (urlKeys.has(key) || modelKeys.has(key)) hits.push(key);
      forbiddenBrainHits(child, hits);
    }
    return hits;
  }
  if (typeof value === "string" && (/^(https?|cloudflare|ollama):\/\//i.test(value) || /ollama-(conscious|subconscious|utility|repair|vision)/i.test(value) || /:1143\d/.test(value))) {
    hits.push(value);
  }
  return hits;
}

describe("E2E — mounted log and brain read authz", { timeout: 180000 }, () => {
  let base;
  let serverProc;
  let dataDir;
  let owner;
  let member;
  let adminHeaders;

  before(async () => {
    const port = await getFreePort();
    dataDir = mkdtempSync(join(tmpdir(), "concord-e2e-log-brain-"));
    base = "http://127.0.0.1:" + port;
    serverProc = await spawnServer(port, dataDir);
    owner = await registerUser(base, "logOwner");
    member = await registerUser(base, "logMember");
    const admin = await registerUser(base, "logAdmin");
    adminHeaders = admin.headers;
    const db = new Database(join(dataDir, "concord.db"));
    try {
      db.prepare("UPDATE users SET role = ? WHERE id = ?").run("admin", admin.userId);
      const insert = db.prepare("INSERT INTO audit_log (id, timestamp, category, action, user_id, path, details) VALUES (?, ?, ?, ?, ?, ?, ?)");
      const stamp = "2099-01-01T00:00:00.000Z";
      insert.run(randomUUID(), stamp, "security", "member_marker", member.userId, "/api/events/paginated", JSON.stringify({ message: MEMBER_EVENT }));
      insert.run(randomUUID(), stamp, "security", "other_marker", owner.userId, "/api/events/paginated", JSON.stringify({ message: OTHER_EVENT }));
      insert.run(randomUUID(), stamp, "security", "system_marker", null, "/api/events/paginated", JSON.stringify({ message: SYSTEM_EVENT }));
    } finally {
      db.close();
    }
  });

  after(async () => {
    await stopServer(serverProc);
    rmSync(dataDir, { recursive: true, force: true });
  });

  it("anonymous browser gets 401 on /api/logs, its siblings, events/paginated, and brain/status", async () => {
    const handlerGated = new Set(["/api/events", "/api/events/log", "/api/events/paginated", "/api/brain/status"]);
    for (const path of READS) {
      const res = await getJSON(base, path, {});
      assert.equal(res.status, 401, path + " " + res.text);
      assert.equal(res.body?.ok, false, path);
      if (handlerGated.has(path)) {
        assert.equal(res.body?.error, "authentication_required", path + " " + res.text);
      }
      assert.equal(res.text.includes(MEMBER_EVENT), false, path);
      assert.equal(res.text.includes(OTHER_EVENT), false, path);
      assert.equal(res.text.includes(SYSTEM_EVENT), false, path);
      assert.equal(forbiddenBrainHits(res.body).length, 0, path + " " + res.text);
    }
  });

  it("a member sees only their own events and a brain status with no URLs or model names", async () => {
    for (const path of ["/api/admin/logs", "/api/audit"]) {
      const res = await getJSON(base, path, member.headers);
      assert.equal(res.status, 403, path + " " + res.text);
    }

    for (const path of ["/api/logs", "/api/events", "/api/events/log"]) {
      const res = await getJSON(base, path, member.headers);
      assert.equal(res.status, 200, path + " " + res.text);
      assert.equal(res.body?.ok, true, path);
      assert.equal(res.text.includes(OTHER_EVENT), false, path);
      assert.equal(res.text.includes(SYSTEM_EVENT), false, path);
    }

    const feed = await getJSON(base, "/api/events/paginated", member.headers);
    assert.equal(feed.status, 200, feed.text);
    assert.equal(feed.body?.ok, true);
    const messages = JSON.stringify(feed.body?.events || []);
    assert.equal(messages.includes(MEMBER_EVENT), true, feed.text);
    assert.equal(messages.includes(OTHER_EVENT), false, feed.text);
    assert.equal(messages.includes(SYSTEM_EVENT), false, feed.text);
    assert.ok(Array.isArray(feed.body?.items), "guidance panels read items");
    assert.equal(JSON.stringify(feed.body.items).includes(OTHER_EVENT), false);

    const brain = await getJSON(base, "/api/brain/status", member.headers);
    assert.equal(brain.status, 200, brain.text);
    assert.equal(typeof brain.body?.mode, "string");
    assert.equal(typeof brain.body?.onlineCount, "number");
    assert.deepEqual(forbiddenBrainHits(brain.body), [], brain.text);
  });

  it("an admin and the owner see the full event feed and the raw brain status", async () => {
    for (const headers of [adminHeaders, owner.headers]) {
      const feed = await getJSON(base, "/api/events/paginated", headers);
      assert.equal(feed.status, 200, feed.text);
      assert.equal(feed.text.includes(MEMBER_EVENT), true, feed.text);
      assert.equal(feed.text.includes(OTHER_EVENT), true, feed.text);
      assert.equal(feed.text.includes(SYSTEM_EVENT), true, feed.text);

      const logs = await getJSON(base, "/api/logs", headers);
      assert.equal(logs.status, 200, logs.text);
      assert.equal(logs.body?.ok, true);

      const adminLogs = await getJSON(base, "/api/admin/logs", headers);
      assert.equal(adminLogs.status, 200, adminLogs.text);

      const brain = await getJSON(base, "/api/brain/status", headers);
      assert.equal(brain.status, 200, brain.text);
      const hits = forbiddenBrainHits(brain.body);
      assert.ok(hits.includes("url"), "admin brain status should include a url field: " + brain.text.slice(0, 500));
      assert.ok(hits.includes("model"), "admin brain status should include a model field: " + brain.text.slice(0, 500));
    }
  });
});
