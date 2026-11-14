/**
 * Library-search layer pins (B6, CB-0575):
 *   FIX-grounding-010 findability leg · FIX-entity-009 second leg ·
 *   FIX-ar-016 scoped leg.
 *
 * dtu.create stamps scope "local" on every ordinary create (Scope
 * Separation), while the Global Library's DTU tab queries
 * GET /api/dtus/paginated?scope=global — so a user's own saved/minted DTU
 * was unfindable in the Library by exact ID, by title, and under the
 * Private filter (which the route never read). The contract under test:
 *   - browse (scope=global, no q, no visibility) = global substrate only;
 *   - a signed-in search (q) or visibility filter unions the viewer's OWN
 *     DTUs into the candidate set;
 *   - the visibility param is honoured ("public" also matches "published");
 *   - another user's private DTU never appears, for anyone.
 *
 * DTUs are seeded directly in the exact shape dtu.create persists
 * (scope "local", top-level visibility, ownerId/author) — the route
 * contract is what is pinned here; the PR-B suite pins the create side.
 *
 * Run:
 *   node --test --test-timeout=300000 tests/library-search-layer.test.js
 */
import { describe, it, before, after } from "node:test";
import assert from "node:assert/strict";
import express from "express";
import registerSystemRoutes from "../routes/system.js";
import { privateDtuHiddenFrom } from "../lib/dtu-read-access.js";

const OWNER = "lib-owner";
const OTHER = "lib-other";

function seedDtus() {
  const base = { tier: "regular", tags: ["grounding", "verification"], content: "libtest body", createdAt: "2026-11-14T10:00:00.000Z" };
  return new Map([
    ["dtu_libtest_own_private", { ...base, id: "dtu_libtest_own_private", title: "Libtest Mint Verification", scope: "local", visibility: "private", ownerId: OWNER, author: OWNER, source: "grounding:verification:mint" }],
    ["dtu_libtest_own_public", { ...base, id: "dtu_libtest_own_public", title: "Libtest Public Note", scope: "local", visibility: "public", ownerId: OWNER, author: OWNER, source: "user" }],
    ["dtu_libtest_global_public", { ...base, id: "dtu_libtest_global_public", title: "Libtest Global Substrate", scope: "global", visibility: "public", ownerId: OTHER, author: OTHER, source: "feed" }],
    ["dtu_libtest_other_private", { ...base, id: "dtu_libtest_other_private", title: "Libtest Other Private", scope: "local", visibility: "private", ownerId: OTHER, author: OTHER, source: "user" }],
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

const ids = (body) => (body.items || body.dtus || []).map((d) => d.id);

describe("Library-search layer — /api/dtus/paginated scope=global", () => {
  let http;
  before(async () => {
    http = await startHttp({ dtus: seedDtus() });
  });
  after(async () => { if (http) await http.close(); });

  it("owner retrieves their own private local DTU by exact ID under scope=global + q", async () => {
    const r = await http.get(`/api/dtus/paginated?scope=global&q=${encodeURIComponent("dtu_libtest_own_private")}`, { userId: OWNER });
    assert.equal(r.status, 200);
    assert.ok(ids(r.body).includes("dtu_libtest_own_private"), JSON.stringify(r.body).slice(0, 300));
  });

  it("owner retrieves their own private local DTU by title under scope=global + q", async () => {
    const r = await http.get(`/api/dtus/paginated?scope=global&q=${encodeURIComponent("Libtest Mint")}`, { userId: OWNER });
    assert.ok(ids(r.body).includes("dtu_libtest_own_private"));
  });

  it("the Private filter lists the owner's own private DTUs — and only theirs", async () => {
    const r = await http.get(`/api/dtus/paginated?scope=global&visibility=private`, { userId: OWNER });
    const got = ids(r.body);
    assert.ok(got.includes("dtu_libtest_own_private"));
    assert.ok(!got.includes("dtu_libtest_other_private"));
    assert.ok(!got.includes("dtu_libtest_own_public"));
    assert.ok(!got.includes("dtu_libtest_global_public"));
  });

  it("another signed-in user searching the exact ID never sees the owner's private DTU", async () => {
    const r = await http.get(`/api/dtus/paginated?scope=global&q=${encodeURIComponent("dtu_libtest_own_private")}`, { userId: OTHER });
    assert.ok(!ids(r.body).includes("dtu_libtest_own_private"));
  });

  it("anonymous search never sees a private DTU", async () => {
    const r = await http.get(`/api/dtus/paginated?scope=global&q=${encodeURIComponent("dtu_libtest_own_private")}`);
    assert.ok(!ids(r.body).includes("dtu_libtest_own_private"));
  });

  it("browse stays substrate-only: scope=global with no q and no visibility excludes the owner's local DTUs", async () => {
    const r = await http.get(`/api/dtus/paginated?scope=global`, { userId: OWNER });
    const got = ids(r.body);
    assert.ok(got.includes("dtu_libtest_global_public"));
    assert.ok(!got.includes("dtu_libtest_own_private"));
    assert.ok(!got.includes("dtu_libtest_own_public"));
  });

  it("visibility=public finds the owner's own public DTU and never a private one", async () => {
    const r = await http.get(`/api/dtus/paginated?scope=global&visibility=public&q=${encodeURIComponent("Libtest")}`, { userId: OWNER });
    const got = ids(r.body);
    assert.ok(got.includes("dtu_libtest_own_public"));
    assert.ok(!got.includes("dtu_libtest_own_private"));
  });

  it("the mine default is untouched: the owner still lists their own private DTU without a scope param", async () => {
    const r = await http.get(`/api/dtus/paginated`, { userId: OWNER });
    assert.ok(ids(r.body).includes("dtu_libtest_own_private"));
  });
});
