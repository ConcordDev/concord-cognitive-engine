/**
 * FIX-export-011 pins — GET /api/dtus/paginated?scope=all under the
 * owner-scoped export contract (lens-export ruling, 2026-11-14).
 *
 * scope=all is the Export Desk's "include the shared library" cut. It
 * used to return the whole global substrate: system feed DTUs and
 * other users' global DTUs rode a personal export (the ticket counted
 * 41 non-owned rows). No caller-scoped library-membership ("saved
 * into the shared library") concept exists yet, so the interim
 * contract is: scope=all carries only what the caller placed — their
 * own DTUs, any scope — and anonymous callers get nothing. The Global
 * Library browse (scope=global) is NOT this contract and must not
 * change: it stays substrate-only on a plain browse.
 *
 * Harness mirrors tests/library-search-layer.test.js (the route
 * mounted as production mounts it, DTUs seeded in dtu.create's shape).
 *
 * Run:
 *   node --test --test-timeout=300000 tests/dtus-paginated-all-scope.test.js
 */
import { describe, it, before, after } from "node:test";
import assert from "node:assert/strict";
import express from "express";
import registerSystemRoutes from "../routes/system.js";
import { privateDtuHiddenFrom } from "../lib/dtu-read-access.js";

const OWNER = "all-owner";
const OTHER = "all-other";

function seedDtus() {
  const base = { tier: "regular", tags: ["export"], content: "all-scope body", createdAt: "2026-11-14T10:00:00.000Z" };
  return new Map([
    ["dtu_all_own_local", { ...base, id: "dtu_all_own_local", title: "Own Local", scope: "local", visibility: "private", ownerId: OWNER, author: OWNER, source: "user" }],
    ["dtu_all_own_global", { ...base, id: "dtu_all_own_global", title: "Own Placed Global", scope: "global", visibility: "public", ownerId: OWNER, author: OWNER, source: "user" }],
    ["dtu_all_other_global", { ...base, id: "dtu_all_other_global", title: "Other Global", scope: "global", visibility: "public", ownerId: OTHER, author: OTHER, source: "user" }],
    ["dtu_all_system_global", { ...base, id: "dtu_all_system_global", title: "System Feed", scope: "global", visibility: "public", ownerId: "system", author: "system", source: "feed" }],
    ["dtu_all_other_private", { ...base, id: "dtu_all_other_private", title: "Other Private", scope: "local", visibility: "private", ownerId: OTHER, author: OTHER, source: "user" }],
  ]);
}

function paginateResults(items, { page = 1, pageSize = 20 } = {}) {
  const total = items.length;
  const start = (page - 1) * pageSize;
  return {
    items: items.slice(start, start + pageSize),
    pagination: { page, pageSize, total, hasNext: start + pageSize < total },
  };
}
const clamp = (n, lo, hi) => Math.min(hi, Math.max(lo, n));

async function startHttp(STATE) {
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
      req.actor = { userId: uid, orgId: "default", role, scopes: ["read", "write"] };
      req.user = { id: uid, role };
    }
    next();
  });
  const passthrough = () => (_req, _res, next) => next();
  registerSystemRoutes(app, {
    STATE,
    makeCtx: () => ({}),
    runMacro: async () => ({ ok: false, error: "not wired in this harness" }),
    requireRole: () => passthrough(),
    db: null,
    userVisibleDTUs,
    paginateResults,
    clamp,
    VERSION: "test",
    PORT: 0,
    NODE_ENV: "test",
    MACROS: new Map(),
  });
  const server = app.listen(0, "127.0.0.1");
  await new Promise((resolve, reject) => {
    server.once("listening", resolve);
    server.once("error", reject);
  });
  const port = server.address().port;
  async function get(pathname, opts = {}) {
    const headers = {};
    if (opts.userId) headers["x-test-user"] = opts.userId;
    const res = await fetch(`http://127.0.0.1:${port}${pathname}`, { headers });
    const text = await res.text();
    let body = null;
    try { body = JSON.parse(text); } catch { body = { raw: text }; }
    return { status: res.status, body };
  }
  return { get, close: () => new Promise((resolve) => server.close(resolve)) };
}

const ids = (body) => (body.items || body.dtus || []).map((d) => d.id).sort();

describe("FIX-export-011 — /api/dtus/paginated scope=all is owner-scoped", () => {
  let http;
  before(async () => {
    http = await startHttp({ dtus: seedDtus() });
  });
  after(async () => { if (http) await http.close(); });

  it("scope=all returns the caller's own DTUs only — both scopes, nothing of anyone else's, no system rows", async () => {
    const r = await http.get(`/api/dtus/paginated?scope=all&limit=100`, { userId: OWNER });
    assert.equal(r.status, 200);
    assert.deepEqual(ids(r.body), ["dtu_all_own_global", "dtu_all_own_local"]);
  });

  it("scope=all for another caller returns THEIR own — the filter follows the caller, not a fixed set", async () => {
    const r = await http.get(`/api/dtus/paginated?scope=all&limit=100`, { userId: OTHER });
    assert.deepEqual(ids(r.body), ["dtu_all_other_global", "dtu_all_other_private"]);
  });

  it("scope=all anonymous returns nothing — no placed content, no substrate leak", async () => {
    const r = await http.get(`/api/dtus/paginated?scope=all&limit=100`);
    assert.deepEqual(ids(r.body), []);
  });

  it("scope=global browse is unchanged: the substrate (incl. system + other-owner global rows) still browses", async () => {
    const r = await http.get(`/api/dtus/paginated?scope=global&limit=100`, { userId: OWNER });
    const got = ids(r.body);
    assert.ok(got.includes("dtu_all_system_global"), "system substrate still browsable in the library");
    assert.ok(got.includes("dtu_all_other_global"), "other-owner global still browsable in the library");
    assert.ok(got.includes("dtu_all_own_global"));
    assert.ok(!got.includes("dtu_all_own_local"), "plain browse stays substrate-only");
  });
});
