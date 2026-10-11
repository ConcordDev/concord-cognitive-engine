/**
 * PR-B route contracts:
 *   GET /api/dtus?q= finds a DTU created a second earlier, including when
 *   the sidecar returns an empty cache.
 *   PATCH and DELETE of someone else's DTU return HTTP 403.
 *   GET /api/dtus/paginated puts total on the top level and searches content.
 *   A production actor (userId, no id) still lists the owner's private DTU
 *   from mine, q, tag, and the DTUs lens paginated query.
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
import { privateDtuHiddenFrom } from "../lib/dtu-read-access.js";

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

  it("lists a just-created private DTU for the owner under a production actor", async () => {
    const marker = `osr-owner-${Date.now()}`;
    const tag = `tag${marker}`;
    const ctx = makeCtx({ user: { id: OWNER, role: "member" }, headers: {}, get() { return ""; } });
    const created = await runMacro("dtu", "create", {
      title: `Owner search repro ${marker}`,
      content: `owner search body ${marker}`,
      tags: [tag, "watchdog-test"],
      source: "user",
      core: { definitions: ["private vault row"], claims: ["created just now"] },
      human: { summary: "private vault row" },
    }, ctx);
    assert.equal(created.ok, true, JSON.stringify(created));
    const id = created.dtu.id;
    assert.equal(created.dtu.visibility, "private");
    assert.equal(created.dtu.ownerId, OWNER);
    const stored = STATE.dtus.get(id);
    assert.ok(stored, "create landed in STATE.dtus");

    const mine = await http.get("/api/dtus?mine=true", { userId: OWNER });
    assert.equal(mine.status, 200);
    assert.equal((mine.body.dtus || []).some((d) => d.id === id), true);
    assert.ok((mine.body.total || 0) >= 1);

    const byTitle = await http.get(`/api/dtus?q=${encodeURIComponent(marker)}`, { userId: OWNER });
    assert.equal((byTitle.body.dtus || []).some((d) => d.id === id), true);

    const byContent = await http.get(`/api/dtus?q=${encodeURIComponent("owner search body " + marker)}`, { userId: OWNER });
    assert.equal((byContent.body.dtus || []).some((d) => d.id === id), true);

    const bySearch = await http.get(`/api/dtus?search=${encodeURIComponent(marker)}`, { userId: OWNER });
    assert.equal((bySearch.body.dtus || []).some((d) => d.id === id), true);

    const byTag = await http.get(`/api/dtus?tag=${encodeURIComponent(tag)}`, { userId: OWNER });
    assert.equal((byTag.body.dtus || []).some((d) => d.id === id), true);
    assert.equal((byTag.body.dtus || []).every((d) => (d.tags || []).some((t) => String(t).toLowerCase() === tag)), true);

    const byTags = await http.get(`/api/dtus?tags=${encodeURIComponent(tag)}`, { userId: OWNER });
    assert.equal((byTags.body.dtus || []).some((d) => d.id === id), true);

    const other = await http.get(`/api/dtus?q=${encodeURIComponent(marker)}&mine=true`, { userId: OTHER });
    assert.equal((other.body.dtus || []).some((d) => d.id === id), false);
    const otherTag = await http.get(`/api/dtus?tag=${encodeURIComponent(tag)}`, { userId: OTHER });
    assert.equal((otherTag.body.dtus || []).some((d) => d.id === id), false);

    const anon = await http.get(`/api/dtus?q=${encodeURIComponent(marker)}`);
    assert.equal((anon.body.dtus || []).some((d) => d.id === id), false);
    const anonMine = await http.get("/api/dtus?mine=true");
    assert.equal((anonMine.body.dtus || []).some((d) => d.id === id), false);
    const anonTag = await http.get(`/api/dtus?tag=${encodeURIComponent(tag)}`);
    assert.equal((anonTag.body.dtus || []).some((d) => d.id === id), false);

    const uncapped = await http.get("/api/dtus", { userId: OWNER });
    assert.equal(uncapped.body.limit, 50);
    assert.ok((uncapped.body.dtus || []).length <= 50);
    assert.ok((uncapped.body.total || 0) >= (uncapped.body.dtus || []).length);

    const explicit = await http.get("/api/dtus?limit=200&mine=true", { userId: OWNER });
    assert.equal(explicit.body.limit, 200);
    assert.equal((explicit.body.dtus || []).some((d) => d.id === id), true);
  });

  it("falls back from an empty sidecar mine to the owner's private DTU", async () => {
    const marker = `osr-side-${Date.now()}`;
    const ctx = makeCtx({ user: { id: OWNER, role: "member" }, headers: {}, get() { return ""; } });
    const created = await runMacro("dtu", "create", {
      title: `sidecar mine ${marker}`,
      content: "private sidecar miss",
      source: "user",
      core: { definitions: ["sidecar mine"], claims: ["empty cache"] },
      human: { summary: "sidecar mine" },
    }, ctx);
    assert.equal(created.ok, true, JSON.stringify(created));
    globalThis.__dtuSidecarList = async () => ({ ok: true, dtus: [], total: 0, _source: "dtu-sidecar" });
    try {
      const listed = await http.get("/api/dtus?mine=true", { userId: OWNER });
      assert.equal(listed.status, 200);
      assert.notEqual(listed.body._source, "dtu-sidecar");
      assert.equal((listed.body.dtus || []).some((d) => d.id === created.dtu.id), true);
    } finally {
      globalThis.__dtuSidecarList = undefined;
    }
  });

  it("paginated mine puts a just-created private DTU on page 1 for the lens", async () => {
    const marker = `osr-lens-${Date.now()}`;
    const ctx = makeCtx({ user: { id: OWNER, role: "member" }, headers: {}, get() { return ""; } });
    const older = await runMacro("dtu", "create", {
      title: `older vault ${marker}`,
      content: "older",
      source: "user",
      core: { definitions: ["older"], claims: ["page tail"] },
      human: { summary: "older" },
    }, ctx);
    assert.equal(older.ok, true, JSON.stringify(older));
    const olderRow = STATE.dtus.get(older.dtu.id);
    olderRow.createdAt = "2000-01-01T00:00:00.000Z";

    const created = await runMacro("dtu", "create", {
      title: `lens vault ${marker}`,
      content: `lens body ${marker}`,
      source: "user",
      core: { definitions: ["lens"], claims: ["page one"] },
      human: { summary: "lens" },
    }, ctx);
    assert.equal(created.ok, true, JSON.stringify(created));

    const page = await http.get("/api/dtus/paginated?scope=mine&limit=1&offset=0", { userId: OWNER });
    assert.equal(page.status, 200);
    const rows = page.body.dtus || page.body.items || [];
    assert.equal(rows[0]?.id, created.dtu.id);
    assert.ok(page.body.total >= 2);

    const actorOnly = await http.get(`/api/dtus/paginated?scope=mine&query=${encodeURIComponent(marker)}`, { userId: OWNER, actorOnly: true });
    assert.equal((actorOnly.body.dtus || actorOnly.body.items || []).some((d) => d.id === created.dtu.id), true);

    const other = await http.get(`/api/dtus/paginated?scope=mine&query=${encodeURIComponent(marker)}`, { userId: OTHER });
    assert.equal((other.body.dtus || other.body.items || []).some((d) => d.id === created.dtu.id), false);
    const anon = await http.get(`/api/dtus/paginated?scope=mine&query=${encodeURIComponent(marker)}`);
    assert.equal((anon.body.dtus || anon.body.items || []).some((d) => d.id === created.dtu.id), false);
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
    if (privateDtuHiddenFrom(d, userId)) return false;
    const owner = d.author || d.ownerId || d.userId || d.createdBy;
    const tier = d.federation_tier || d.federationTier || null;
    if (tier === "local" && userId !== owner) return false;
    return true;
  });
  const app = express();
  app.use(express.json());
  app.use((req, _res, next) => {
    const uid = req.get("x-test-user");
    const role = req.get("x-test-role") || "member";
    if (uid) {
      // Production actor middleware stamps userId and omits id. makeCtx
      // prefers req.actor, so a list that only reads actor.id sees nobody.
      req.actor = { userId: uid, orgId: "default", role, scopes: ["read", "write"] };
      if (req.get("x-test-actor-only") !== "1") req.user = { id: uid, role };
    }
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
    if (opts.actorOnly) headers["x-test-actor-only"] = "1";
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
