// Debug workspace behaviour tests (Product Review 2, debug.md — B5 build).
//
// S1 (founder ruling, §8): the error-tracking domain is a per-user
// workspace, NOT a platform-internal surface — a normal signed-in
// account can ingest/list/update/delete its own issues, traces,
// metrics, alerts and releases end to end, isolated from other users.
// S3/S4: grouping by fingerprint, regression reopen, workflow states.
// Boots the real server on a temp DATA_DIR (same pattern as the
// database workspace tests).

import { describe, it, before, after } from "node:test";
import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { armOrphanGuard } from "./lib/e2e-orphan-guard.js";

const SERVER = join(dirname(fileURLToPath(import.meta.url)), "..", "server.js");
const PORT = 18900 + Math.floor(Math.random() * 800);
const BASE = `http://127.0.0.1:${PORT}`;
let proc = null;
let dataDir = null;

// A full server.js boot takes well over a minute on a loaded box; 60 s made the whole file cancel.
async function waitReady(tries = 120) {
  for (let i = 0; i < tries; i++) {
    try {
      const r = await fetch(`${BASE}/api/health`);
      if (r.ok) return true;
    } catch { /* not up yet */ }
    await new Promise((r) => setTimeout(r, 1000));
  }
  return false;
}

function client() {
  let cookie = "";
  let token = "";
  return {
    setToken(t) { token = t; },
    async call(method, path, body) {
      const res = await fetch(`${BASE}${path}`, {
        method,
        headers: {
          "Content-Type": "application/json",
          ...(cookie ? { Cookie: cookie } : {}),
          ...(token ? { Authorization: `Bearer ${token}` } : {}),
        },
        body: body === undefined ? undefined : JSON.stringify(body),
      });
      const setCookie = res.headers.get("set-cookie");
      if (setCookie) cookie = setCookie.split(";")[0];
      let json = null;
      try { json = await res.json(); } catch { /* no body */ }
      return { status: res.status, json };
    },
  };
}

const lens = (c, action, input = {}, artifactData) =>
  c.call("POST", "/api/lens/run", {
    domain: "debug",
    action,
    input,
    ...(artifactData !== undefined ? { artifact: { data: artifactData } } : {}),
  });

async function signup(c, name) {
  const r = await c.call("POST", "/api/auth/register", {
    username: name,
    email: `${name}@example.com`,
    password: "CorrectHorseBattery9!",
    dateOfBirth: "1990-01-01",
    _t: Date.now() - 5000,
  });
  assert.equal(r.status, 201, `register ${name}: ${JSON.stringify(r.json)}`);
  assert.ok(r.json?.token, "register returns a token");
  c.setToken(r.json.token);
}

describe("debug workspace (S1 unwall + S3/S4 issue loop)", () => {
  before(async () => {
    dataDir = mkdtempSync(join(tmpdir(), "concord-debug-test-"));
    proc = spawn(process.execPath, [SERVER], {
      env: {
        ...process.env,
        PORT: String(PORT),
        DATA_DIR: dataDir,
        NODE_ENV: "e2e-test",
        AUTH_MODE: "hybrid",
        CONCORD_NO_LISTEN: "false",
        CONCORD_LOAD_SHED_ENABLED: "0",
        CONCORD_SEED_FRESH: "1",
        OPENAI_API_KEY: "",
        ANTHROPIC_API_KEY: "",
        // The parent's per-file isolation paths must not leak into the child (see animation-share-routes).
        DB_PATH: "",
        STATE_PATH: "",
      },
      stdio: ["ignore", "pipe", "pipe"],
    });
    armOrphanGuard(proc, dataDir);
    proc.stderr.on("data", () => {});
    assert.equal(await waitReady(), true, "server did not become ready");
  }, { timeout: 200000 });

  after(() => {
    if (proc) proc.kill("SIGKILL");
    if (dataDir) rmSync(dataDir, { recursive: true, force: true });
  });

  it("S1: a normal account ingests, lists, works and deletes its own issue", async () => {
    const c = client();
    await signup(c, "dbg_alice");
    const ing = await lens(c, "issue-ingest", {
      type: "TypeError",
      message: "Cannot read properties of undefined (reading 'map')",
      culprit: "QueryGrid.tsx:renderRows",
      level: "error",
      stack: "TypeError: Cannot read properties of undefined (reading 'map')\n    at renderRows (QueryGrid.tsx:42:17)",
      release: "v1.2.0",
    });
    assert.equal(ing.json?.ok, true, JSON.stringify(ing.json));
    assert.equal(ing.json.result.isNew, true);
    const id = ing.json.result.issue.id;

    const list = await lens(c, "issue-list", {});
    assert.equal(list.json?.ok, true);
    assert.equal(list.json.result.count, 1);
    assert.equal(list.json.result.summary.open, 1);
    // List strips the stack; detail carries it.
    assert.equal(list.json.result.issues[0].stack, undefined);
    const detail = await lens(c, "issue-detail", { id });
    assert.match(detail.json.result.issue.stack, /renderRows/);

    const upd = await lens(c, "issue-update", { id, status: "resolved", assignee: "alice" });
    assert.equal(upd.json.result.issue.status, "resolved");
    assert.equal(upd.json.result.issue.assignee, "alice");

    const del = await lens(c, "issue-delete", { id });
    assert.equal(del.json?.ok, true);
    const after = await lens(c, "issue-list", {});
    assert.equal(after.json.result.count, 0);
  });

  it("S4: identical errors group into one issue; a recurrence after resolve reopens it as a regression", async () => {
    const c = client();
    await signup(c, "dbg_bob");
    const payload = {
      type: "RangeError",
      message: "Maximum call stack size exceeded in worker 7",
      culprit: "walk.ts:visit",
    };
    const a = await lens(c, "issue-ingest", payload);
    const b = await lens(c, "issue-ingest", { ...payload, message: "Maximum call stack size exceeded in worker 99" });
    assert.equal(a.json.result.issue.id, b.json.result.issue.id, "fingerprints should group");
    assert.equal(b.json.result.issue.count, 2);
    assert.equal(b.json.result.isNew, false);

    await lens(c, "issue-update", { id: a.json.result.issue.id, status: "resolved" });
    const c3 = await lens(c, "issue-ingest", payload);
    assert.equal(c3.json.result.issue.status, "open");
    assert.equal(c3.json.result.issue.regressed, true);
    assert.equal(c3.json.result.issue.count, 3);
  });

  it("S1: workspaces are per-user — a second account sees none of the first account's data", async () => {
    const c = client();
    await signup(c, "dbg_carol");
    const list = await lens(c, "issue-list", {});
    assert.equal(list.json.result.count, 0);
    const traces = await lens(c, "trace-list", {});
    assert.equal(traces.json.result.count, 0);
    const rules = await lens(c, "alert-list", {});
    assert.equal(rules.json.result.count, 0);
    const rels = await lens(c, "release-list", {});
    assert.equal(rels.json.result.count, 0);
  });

  it("S7/S8 backends: releases annotate tied issues; traces carry a waterfall; metrics chart real samples", async () => {
    const c = client();
    await signup(c, "dbg_dana");
    const rel = await lens(c, "release-create", { version: "v2.0.0", environment: "production" });
    assert.equal(rel.json?.ok, true);
    await lens(c, "issue-ingest", { type: "Error", message: "boom in v2", release: "v2.0.0" });
    const rels = await lens(c, "release-list", {});
    assert.equal(rels.json.result.releases[0].issueCount, 1);
    assert.equal(rels.json.result.releases[0].openIssues, 1);
    const del = await lens(c, "release-delete", { id: rel.json.result.release.id });
    assert.equal(del.json?.ok, true);

    const tr = await lens(c, "trace-record", {
      name: "lens-run",
      spans: [
        { spanId: "a", name: "http", service: "web", startMs: 0, endMs: 100 },
        { spanId: "b", parentId: "a", name: "solve", service: "conkay", startMs: 10, endMs: 60, status: "error" },
      ],
    });
    assert.equal(tr.json?.ok, true);
    assert.equal(tr.json.result.trace.errorCount, 1);
    assert.equal(tr.json.result.trace.spans[1].depth, 1);
    const td = await lens(c, "trace-detail", { id: tr.json.result.trace.id });
    assert.equal(td.json.result.serviceBreakdown.length, 2);

    await lens(c, "metric-record", { metric: "heap_used_mb", value: 512, unit: "MB" });
    await lens(c, "metric-record", { metric: "heap_used_mb", value: 640, unit: "MB" });
    const series = await lens(c, "metric-series", { metric: "heap_used_mb" });
    assert.equal(series.json.result.stats.count, 2);
    assert.equal(series.json.result.stats.max, 640);
    assert.deepEqual(series.json.result.metrics, ["heap_used_mb"]);
  });

  it("S5 backends: the analysis quartet answers from caller-supplied input, naming its contents", async () => {
    const c = client();
    await signup(c, "dbg_erin");
    const now = new Date().toISOString();
    const logs = await lens(c, "logAnalysis", {
      logs: [
        { timestamp: now, level: "error", message: "frobnicate failed for widget", source: "api" },
        { timestamp: now, level: "error", message: "frobnicate failed for widget", source: "api" },
        { timestamp: now, level: "info", message: "boot ok", source: "api" },
      ],
    });
    assert.equal(logs.json?.ok, true, JSON.stringify(logs.json).slice(0, 300));
    assert.equal(logs.json.result.totalLogs, 3);
    assert.equal(logs.json.result.levelDistribution.error, 2);

    const clusters = await lens(c, "errorCluster", {
      errors: [
        { message: "frobnicate failed for widget", count: 2 },
        { message: "frobnicate failed for widget", count: 1 },
        { message: "unrelated splat", count: 1 },
      ],
    });
    assert.equal(clusters.json?.ok, true, JSON.stringify(clusters.json).slice(0, 300));
    assert.equal(clusters.json.result.totalErrors, 3);

    const stack = await lens(c, "stackTraceAnalysis", {
      stackTraces: [
        { error: "TypeError: frobnicate failed", stack: "TypeError: frobnicate failed\n    at doFrob (src/frob.ts:12:5)\n    at main (src/main.ts:3:1)" },
      ],
    });
    assert.equal(stack.json?.ok, true, JSON.stringify(stack.json).slice(0, 300));
    assert.equal(stack.json.result.totalTraces, 1);
  });
});
