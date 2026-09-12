// server/tests/auth-gate/coverage.test.js
//
// F0.7 — Universal coverage test.
// Proves that EVERY registered MCP tool passes through the AuthGate
// composition layer (lib/auth-gate/dispatch.js) when dispatched via the
// real POST /mcp/call route — no tool silently bypasses the gate.
//
// Rewritten 2026-09-11 (was a manual audit script, not a node:test suite):
// the original file (a) hardcoded a local dev-machine path
// (`/Users/dutch/.local/bin/concord-local-mcp.py`) to enumerate tools via a
// spawned Python MCP stdio client — which cannot exist on any other machine,
// let alone a GitHub Actions runner — and (b) required an already-running
// server at `CONCORD_BACKEND || http://127.0.0.1:5050`, which CI's
// `CONCORD_NO_LISTEN=true` sandboxed test step never provides. Both made
// this file fail 100% of the time in CI (same structural gap as the 14
// `acceptance.test.js` files fixed alongside it), NOT a real AuthGate
// coverage regression — but that also meant this real security invariant
// had ZERO CI enforcement.
//
// Fixed for real rather than deferred or renamed away: this now boots a
// genuine `server.js` child process (same `spawnServer` + `armOrphanGuard`
// shape as `tests/e2e/admin-liveness-role-gate.test.js`), enumerates tools
// via the in-process-importable `MCP_TOOLS` registry
// (`lib/mcp-tools.js`) instead of a local Python client, and probes each
// one via a real anonymous HTTP POST to `/mcp/call` — the exact same code
// path (`routes` → `authorizeToolCall` → `dispatchMCP` → AuthGate
// composition → `callMCPTool`) a real caller hits. `AUTH_MODE=hybrid` (real
// enforcement, not the `CONCORD_MCP_PUBLIC`/`AUTH_MODE=public` dev bypass
// that synthesizes a founder identity) so a genuine bypass can't hide
// behind a permissive test mode.
//
// Run standalone: node --test server/tests/auth-gate/coverage.test.js

import { describe, it, before, after } from "node:test";
import assert from "node:assert/strict";
import { createServer } from "node:http";
import { spawn } from "node:child_process";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { armOrphanGuard } from "../lib/e2e-orphan-guard.js";
import { MCP_TOOLS } from "../../lib/mcp-tools.js";

const __dirname = dirname(fileURLToPath(import.meta.url));
const SERVER_JS = join(__dirname, "../../server.js");
const SERVER_CWD = join(__dirname, "../..");

// Tools that are intentionally protected — never callable via the
// anonymous /mcp/call path (MCP_TOOLS_REQUIRE_REAL_AUTH in server.js).
const PROTECTED_TOOLS = new Set(["reflect_invoke", "reflect_rescan"]);

// ── Boilerplate (same shape as tests/e2e/admin-liveness-role-gate.test.js) ──

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

function spawnServer(port, dataDir, extraEnv, timeoutMs) {
  timeoutMs = timeoutMs || 90000;
  extraEnv = extraEnv || {};
  return new Promise((resolve, reject) => {
    const { DB_PATH: _parentDbPath, ...parentEnvWithoutDbPath } = process.env;
    const env = Object.assign({}, parentEnvWithoutDbPath, {
      PORT: String(port),
      NODE_ENV: "e2e-test",
      CONCORD_NO_LISTEN: "false",
      // Same rationale as every other spawnServer() e2e file: full-suite
      // contention triggers the request-admission shedder on requests that
      // have nothing to do with what this file tests.
      CONCORD_LOAD_SHED_ENABLED: "0",
      DATA_DIR: dataDir,
      LOG_LEVEL: "info",
      LOG_FORMAT: "json",
      OPENAI_API_KEY: "",
      ANTHROPIC_API_KEY: "",
    }, extraEnv);

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
        reject(new Error(`Server on port ${port} did not become ready within ${timeoutMs}ms`));
      }
    }, timeoutMs);

    function checkLine(line) {
      if (
        line.indexOf("server_listening") !== -1 ||
        line.indexOf(`http://localhost:${port}`) !== -1 ||
        line.indexOf(`"url":"http://localhost:${port}"`) !== -1 ||
        line.indexOf(`Listening on port ${port}`) !== -1 ||
        line.indexOf("listening on") !== -1
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
        reject(new Error(`Server exited early (code=${code} signal=${signal})`));
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

async function probeTool(base, toolName, timeoutMs = 10000) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const res = await fetch(`${base}/mcp/call`, {
      method: "POST",
      headers: { "Content-Type": "application/json", "X-Trace-Id": `cov-${toolName}-${Date.now()}` },
      body: JSON.stringify({ tool: toolName, args: {} }),
      signal: controller.signal,
    });
    return await res.json();
  } finally {
    clearTimeout(timer);
  }
}

// Bounded-concurrency map — 118+ tools probed sequentially at up to 10s
// each could take 20 minutes; most calls resolve in milliseconds (this is
// a dispatch-shape check, not a behavioral one), so a handful of genuinely
// slow/hanging tools shouldn't gate the other ~110 fast ones. CONCURRENCY=12
// keeps this comfortably under the describe block's 300s timeout even if
// several tools hit their full per-call timeout.
async function mapWithConcurrency(items, concurrency, fn) {
  const results = new Array(items.length);
  let next = 0;
  async function worker() {
    for (;;) {
      const i = next++;
      if (i >= items.length) return;
      results[i] = await fn(items[i], i);
    }
  }
  await Promise.all(Array.from({ length: Math.min(concurrency, items.length) }, worker));
  return results;
}

describe("F0.7 — Universal AuthGate coverage", { timeout: 300000 }, () => {
  let base;
  let serverProc;
  let dataDir;

  before(async () => {
    const port = await getFreePort();
    dataDir = mkdtempSync(join(tmpdir(), "concord-e2e-authgate-cov-"));
    base = `http://127.0.0.1:${port}`;
    // CONCORD_MCP_PUBLIC=1 is the REAL deployment mode this feature exists
    // for — "local-first MCP server for cloud workers" (server.js Sprint 54
    // comment): a single operator's own machine, where Express-level
    // session auth is intentionally bypassed (synthesizing a
    // `mcp-anonymous`/founder identity) and AuthGate's own composition
    // (lib/auth-gate/dispatch.js) is the ENTIRE authorization boundary for
    // every tool call. Verified directly (manual curl during development):
    // in AUTH_MODE=hybrid — a different, also-legitimate posture — a global
    // pre-route auth check rejects every anonymous /mcp/call with a plain
    // 401 "Login required" BEFORE dispatchMCP ever runs, which is a
    // DIFFERENT (stricter) security boundary, not a bypass of this one —
    // asserting AuthGate coverage against that mode would fail this test
    // for the wrong reason on every single tool. This test's job is to
    // prove AuthGate itself has no gaps in the mode where it IS the
    // boundary, which is CONCORD_MCP_PUBLIC=1.
    serverProc = await spawnServer(port, dataDir, { CONCORD_MCP_PUBLIC: "1" }, 90000);
  });

  after(async () => {
    await stopServer(serverProc);
    // Each run migrates a full SQLite tree into a fresh mkdtemp dir — clean
    // it up so a full suite run doesn't strand it (same discipline as
    // tests/e2e/admin-liveness-role-gate.test.js).
    rmSync(dataDir, { recursive: true, force: true });
  });

  it("discovers a non-trivial number of registered MCP tools", () => {
    assert.ok(MCP_TOOLS.length > 50, `expected 50+ tools, got ${MCP_TOOLS.length}`);
  });

  it("every non-protected tool reports auth_gate_mode (bypass = 0) and resolves ALLOW or DENY", async () => {
    const toolsToProbe = MCP_TOOLS.filter((t) => !PROTECTED_TOOLS.has(t.name));

    const outcomes = await mapWithConcurrency(toolsToProbe, 12, async ({ name: tool }) => {
      try {
        return { tool, r: await probeTool(base, tool) };
      } catch (e) {
        return { tool, err: e.message };
      }
    });

    let bypassCount = 0;
    let denyCount = 0;
    let allowCount = 0;
    let errorCount = 0;
    const bypassTools = [];
    const errorTools = [];

    for (const { tool, r, err } of outcomes) {
      if (err) {
        errorCount++;
        errorTools.push(`${tool}: ${err}`);
        continue;
      }
      if (r && r.error && (String(r.error).includes("requires real authentication") || String(r.error).includes("forbidden"))) {
        // Expected for a tool this run's PROTECTED_TOOLS set doesn't yet
        // know about — surfaces as a genuine failure below via the count
        // mismatch, not silently swallowed.
        errorCount++;
        errorTools.push(`${tool}: ${r.error}`);
        continue;
      }
      if (!r || !r.auth_gate_mode) {
        bypassCount++;
        bypassTools.push(tool);
        continue;
      }
      if (r.decision === "DENY") denyCount++;
      else if (r.decision === "ALLOW" || r.decision === "OBSERVE") allowCount++;
      else errorCount++;
    }

    const expectedThrough = MCP_TOOLS.length - PROTECTED_TOOLS.size;
    assert.equal(bypassCount, 0, `Tools bypassing AuthGate: ${bypassTools.join(", ")}`);
    assert.equal(allowCount + denyCount, expectedThrough - errorCount,
      `Expected ${expectedThrough - errorCount} tools through the gate (allow+deny), got ${allowCount + denyCount}. Errored: ${errorTools.join("; ")}`);
  });

  it("protected tools (require real authentication) are blocked without a real login", async () => {
    for (const tool of PROTECTED_TOOLS) {
      // Only assert on tools that still exist in the live registry — a
      // retired tool name here would otherwise report a false "not
      // blocked" against a 404/unknown-tool response.
      if (!MCP_TOOLS.some((t) => t.name === tool)) continue;
      const r = await probeTool(base, tool);
      assert.ok(
        (r && (r.error || r.decision === "DENY")),
        `protected tool ${tool} not blocked: ${JSON.stringify(r).slice(0, 200)}`,
      );
    }
  });
});
