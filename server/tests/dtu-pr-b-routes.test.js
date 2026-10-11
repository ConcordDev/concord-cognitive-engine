/**
 * PR-B route contracts:
 *   GET /api/dtus?q= finds a DTU created a second earlier, including when
 *   the sidecar returns an empty cache.
 *   PATCH and DELETE of someone else's DTU return HTTP 403.
 *   GET /api/dtus/paginated puts total on the top level and searches content.
 *
 * Run:
 *   node --test --import=./tests/preload/no-egress.mjs --test-timeout=300000 tests/dtu-pr-b-routes.test.js
 */
import { describe, it, before, after } from "node:test";
import assert from "node:assert/strict";
import express from "express";
import { load } from "./depth/_harness.js";
import registerDtuRoutes from "../routes/dtus.js";
import registerSystemRoutes from "../routes/system.js";

const OWNER = "prb-owner";
const OTHER = "prb-other";

describe("PR-B DTU routes", () => {
  let http;
  let runMacro;
  let makeCtx;
  let STATE;

  before(async () => {
    const t = await load();
    runMacro = t.runMacro;
    makeCtx = t.makeCtx;
    STATE = t.STATE;
    http = await startHttp({ STATE, db: t.db, runMacro, makeCtx });
  });

  after(async () => {
    globalThis.__dtuSidecarList = undefined;
    if (http) await http.close();
  });

  it("?q= finds a DTU created a second earlier", async () => {
    const title = `prb-fresh-${Date.now()}`;
    const ctx = makeCtx({ user: { id: OWNER, role: "member" }, headers: {}, get() { return ""; } });
    const created = await runMacro("dtu", "create", {
      title,
      content: "helix body written just now",
      source: "user",
      visibility: "public",
      scope: "global",
      core: { definitions: ["a fresh search row"], claims: ["created a second ago"] },
      human: { summary: "fresh search row" },
    }, ctx);
    assert.equal(created.ok, true, JSON.stringify(created));
    assert.equal(created.dtu.content, "helix body written just now");
    assert.equal((created.dtu.tags || []).includes("quarantine:injection-review"), false);
    await new Promise((r) => setTimeout(r, 1000));

    const listed = await http.get(`/api/dtus?q=${encodeURIComponent(title)}`, { userId: OWNER });
    assert.equal(listed.status, 200);
    assert.equal((listed.body.dtus || []).some((d) => d.id === created.dtu.id), true);
    assert.ok((listed.body.total || 0) >= 1);
  });

  it("falls back to in-process search when the sidecar cache is empty", async () => {
    const title = `prb-sidecar-${Date.now()}`;
    const ctx = makeCtx({ user: { id: OWNER, role: "member" }, headers: {}, get() { return ""; } });
    const created = await runMacro("dtu", "create", {
      title,
      content: "sidecar miss body",
      source: "user",
      visibility: "public",
      scope: "global",
      core: { definitions: ["sidecar miss"], claims: ["cache lag"] },
      human: { summary: "sidecar miss" },
    }, ctx);
    assert.equal(created.ok, true, JSON.stringify(created));

    globalThis.__dtuSidecarList = async () => ({ ok: true, dtus: [], total: 0, _source: "dtu-sidecar" });
    try {
      const listed = await http.get(`/api/dtus?q=${encodeURIComponent(title)}`, { userId: OWNER });
      assert.equal(listed.status, 200);
      assert.notEqual(listed.body._source, "dtu-sidecar");
      assert.equal((listed.body.dtus || []).some((d) => d.id === created.dtu.id), true);
    } finally {
      globalThis.__dtuSidecarList = undefined;
    }
  });

  it("does not auto-tag a benign note, and does tag a real finding", async () => {
    const ctx = makeCtx({ user: { id: OWNER, role: "member" }, headers: {}, get() { return ""; } });
    globalThis._injectionDefenseModule = {
      scanContent: () => ({ threatLevel: "none", findings: [] }),
    };
    const benign = await runMacro("dtu", "create", {
      title: `prb-benign-${Date.now()}`,
      content: "hello world note",
      source: "user",
      core: { definitions: ["benign"], claims: ["no injection"] },
      human: { summary: "hello world note" },
    }, ctx);
    assert.equal(benign.ok, true, JSON.stringify(benign));
    assert.equal((benign.dtu.tags || []).includes("quarantine:injection-review"), false);

    globalThis._injectionDefenseModule = {
      scanContent: () => ({
        threatLevel: "low",
        findings: [{ type: "instruction_smuggling", severity: "low", message: "override" }],
      }),
    };
    const hit = await runMacro("dtu", "create", {
      title: `prb-hit-${Date.now()}`,
      content: "hello world note",
      source: "user",
      core: { definitions: ["hit"], claims: ["has a finding"] },
      human: { summary: "hello world note" },
    }, ctx);
    assert.equal(hit.ok, true, JSON.stringify(hit));
    assert.ok((hit.dtu.tags || []).includes("quarantine:injection-review"));
    assert.equal(hit.dtu.meta.injectionScan.threatLevel, "low");
    delete globalThis._injectionDefenseModule;
  });

  it("returns 403 when a non-owner patches or deletes", async () => {
    const ctx = makeCtx({ user: { id: OWNER, role: "member" }, headers: {}, get() { return ""; } });
    const created = await runMacro("dtu", "create", {
      title: `prb-owned-${Date.now()}`,
      content: "owner only",
      source: "user",
      visibility: "public",
      scope: "global",
      core: { definitions: ["owned"], claims: ["not yours"] },
      human: { summary: "owner only" },
    }, ctx);
    assert.equal(created.ok, true, JSON.stringify(created));
    const id = created.dtu.id;
    assert.equal(STATE.dtus.get(id).ownerId, OWNER);

    const patched = await http.send("PATCH", `/api/dtus/${id}`, { userId: OTHER, role: "member", body: { title: "stolen" } });
    assert.equal(patched.status, 403);
    assert.match(String(patched.body.error), /unauthorized/i);
    assert.equal(STATE.dtus.get(id).title, created.dtu.title);

    const deleted = await http.send("DELETE", `/api/dtus/${id}`, { userId: OTHER, role: "member" });
    assert.equal(deleted.status, 403);
    assert.match(String(deleted.body.error), /unauthorized/i);
    assert.ok(STATE.dtus.get(id));

    const ownerPatch = await http.send("PATCH", `/api/dtus/${id}`, { userId: OWNER, role: "member", body: { summary: "revised summary", title: "revised title" } });
    assert.equal(ownerPatch.status, 200);
    assert.equal(ownerPatch.body.ok, true);
    assert.equal(ownerPatch.body.dtu.human.summary, "revised summary");
  });

  it("paginated search returns a top-level total and matches content", async () => {
    const marker = `prb-page-body-${Date.now()}`;
    const ctx = makeCtx({ user: { id: OWNER, role: "member" }, headers: {}, get() { return ""; } });
    const created = await runMacro("dtu", "create", {
      title: "paginated shell",
      content: marker,
      source: "user",
      visibility: "private",
      scope: "local",
      core: { definitions: ["page"], claims: ["body search"] },
      human: { summary: "page shell" },
    }, ctx);
    assert.equal(created.ok, true, JSON.stringify(created));

    const page = await http.get(`/api/dtus/paginated?query=${encodeURIComponent(marker)}&scope=mine`, { userId: OWNER });
    assert.equal(page.status, 200);
    assert.ok(page.body.total >= 1);
    assert.equal(page.body.pagination.total, page.body.total);
    assert.equal((page.body.dtus || page.body.items || []).some((d) => d.id === created.dtu.id), true);
  });
});

function clamp(n, min, max) {
  return Math.max(min, Math.min(max, Number(n)));
}

function paginateResults(items, { page = 1, pageSize = 20 } = {}) {
  const total = items.length;
  const totalPages = Math.ceil(total / pageSize);
  const start = (page - 1) * pageSize;
  return {
    items: items.slice(start, start + pageSize),
    pagination: { page, pageSize, total, totalPages, hasNext: page < totalPages, hasPrev: page > 1 },
  };
}

async function startHttp({ STATE, db, runMacro, makeCtx }) {
  const userVisibleDTUs = (userId) => [...STATE.dtus.values()].filter((d) => {
    if (!d.ownerId || d.ownerId === userId) return true;
    return d.visibility === "public" || d.scope === "global";
  });
  const app = express();
  app.use(express.json());
  app.use((req, _res, next) => {
    const uid = req.get("x-test-user");
    const role = req.get("x-test-role") || "member";
    if (uid) req.user = { id: uid, role };
    next();
  });
  const passthrough = () => (_req, _res, next) => next();
  // Production mounts system routes before DTU routes (server.js). The
  // reverse lets GET /api/dtus/:id capture "paginated".
  registerSystemRoutes(app, {
    STATE,
    makeCtx,
    runMacro,
    requireRole: () => passthrough(),
    db,
    userVisibleDTUs,
    paginateResults,
    clamp,
    VERSION: "test",
    PORT: 0,
    NODE_ENV: "test",
    MACROS: new Map(),
  });
  registerDtuRoutes(app, {
    STATE,
    makeCtx,
    runMacro,
    dtuForClient: (d) => d,
    dtusArray: () => [...STATE.dtus.values()],
    userVisibleDTUs,
    _withAck: (out) => out,
    _saveStateDebounced: () => {},
    validate: passthrough,
    requireRole: () => passthrough(),
  });

  const server = app.listen(0, "127.0.0.1");
  await new Promise((resolve, reject) => {
    server.once("listening", resolve);
    server.once("error", reject);
  });
  const port = server.address().port;

  async function send(method, pathname, opts = {}) {
    const headers = { "content-type": "application/json" };
    if (opts.userId) headers["x-test-user"] = opts.userId;
    if (opts.role) headers["x-test-role"] = opts.role;
    const res = await fetch(`http://127.0.0.1:${port}${pathname}`, {
      method,
      headers,
      body: opts.body ? JSON.stringify(opts.body) : undefined,
    });
    const text = await res.text();
    let body = null;
    try { body = JSON.parse(text); } catch { body = { raw: text }; }
    return { status: res.status, body };
  }

  return {
    get: (pathname, opts) => send("GET", pathname, opts),
    send,
    close: () => new Promise((resolve) => server.close(resolve)),
  };
}
