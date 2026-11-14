/**
 * FIX-export-011 pins — GET /api/dtus/paginated?scope=all under the
 * owner-scoped export contract (lens-export ruling, 2026-11-14).
 *
 * scope=all is the Export Desk's "include the shared library" cut. It
 * used to return the whole global substrate: system feed DTUs and
 * other users' global DTUs rode a personal export (the ticket counted
 * 41 non-owned rows).
 *
 * INTERIM (B9, fa89ebdb8): with no caller-scoped library-membership
 * concept wired to the leg, scope=all carried only the caller's own
 * DTUs and anonymous callers got nothing.
 *
 * SAVED-SET CONTRACT (this build, founder-authorized 2026-11-14,
 * superseding the interim where the saved-set scope applies): the
 * membership concept is the saved domain's per-user saved set
 * (domains/saved.js — kind "dtu", refId = DTU id). scope=all now
 * carries exactly the DTUs the caller has saved — whoever made them —
 * under the ruling's invariants: ownerless rows fall even when saved,
 * system rows are excluded under every stamp even when saved, a
 * caller's own UNSAVED DTUs do not ride here (they ride scope=mine),
 * another caller's saved items never ride, and anonymous callers get
 * nothing. The Global Library browse (scope=global) is NOT this
 * contract and must not change: it stays substrate-only on a plain
 * browse.
 *
 * Harness mirrors the original suite's (the route mounted as
 * production mounts it, DTUs seeded in dtu.create's shape), with
 * runMacro wired to the REAL saved domain (in-memory store) and
 * makeCtx stamping the actor the way production's does, so the
 * saved-set read is exercised end to end.
 *
 * Run:
 *   node --test --test-timeout=300000 tests/dtus-paginated-all-scope.test.js
 */
import { describe, it, before, after } from "node:test";
import assert from "node:assert/strict";
import express from "express";
import registerSystemRoutes from "../routes/system.js";
import registerSavedMacros from "../domains/saved.js";
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
    ["dtu_all_ownerless_global", { ...base, id: "dtu_all_ownerless_global", title: "Ownerless Global", scope: "global", visibility: "public", source: "feed" }],
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

// The real saved domain, registered into a bare registry and driven
// through a runMacro that mimics production's envelope unwrapping.
const savedRegistry = new Map();
registerSavedMacros((domain, action, handler) => {
  savedRegistry.set(`${domain}.${action}`, handler);
});
async function runMacro(domain, action, input, ctx) {
  const handler = savedRegistry.get(`${domain}.${action}`);
  if (!handler) return { ok: false, error: "not wired in this harness" };
  const out = await handler(ctx, input);
  if (!out || out.ok === false) return out || { ok: false, error: "empty" };
  return out.result !== undefined ? out.result : out;
}
const ctxFor = (userId) => ({ actor: userId ? { userId, role: "member" } : null, userId: userId || null });
async function saveDtu(userId, refId, title) {
  const out = await runMacro("saved", "add", { kind: "dtu", refId, title }, ctxFor(userId));
  assert.ok(out && out.item, `saved.add failed for ${userId}/${refId}: ${JSON.stringify(out)}`);
}

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
    makeCtx: (req) => ctxFor(req?.actor?.userId || null),
    runMacro,
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

describe("FIX-export-011 — /api/dtus/paginated scope=all is the caller's saved set", () => {
  let http;
  before(async () => {
    globalThis._concordSTATE = { savedLens: { items: new Map(), folders: new Map() } };
    // OWNER saves: another user's public DTU, a system DTU, an
    // ownerless DTU, and one of their own. OTHER saves: OWNER's public
    // DTU only. Nobody saves dtu_all_own_global for OWNER, and OTHER's
    // private DTU is never visible to OWNER at all.
    await saveDtu(OWNER, "dtu_all_other_global", "Other Global");
    await saveDtu(OWNER, "dtu_all_system_global", "System Feed");
    await saveDtu(OWNER, "dtu_all_ownerless_global", "Ownerless Global");
    await saveDtu(OWNER, "dtu_all_own_local", "Own Local");
    await saveDtu(OTHER, "dtu_all_own_global", "Own Placed Global");
    http = await startHttp({ dtus: seedDtus() });
  });
  after(async () => { if (http) await http.close(); });

  it("scope=all returns exactly the caller's saved set — another owner's saved DTU rides; system and ownerless rows fall even though saved", async () => {
    const r = await http.get(`/api/dtus/paginated?scope=all&limit=100`, { userId: OWNER });
    assert.equal(r.status, 200);
    assert.deepEqual(ids(r.body), ["dtu_all_other_global", "dtu_all_own_local"]);
  });

  it("scope=all follows the caller's OWN saved set — OTHER's export is OTHER's saves, not OWNER's", async () => {
    const r = await http.get(`/api/dtus/paginated?scope=all&limit=100`, { userId: OTHER });
    assert.deepEqual(ids(r.body), ["dtu_all_own_global"]);
  });

  it("a caller who saved nothing gets nothing under scope=all — their own DTUs ride scope=mine instead (the interim superseded)", async () => {
    const mine = await http.get(`/api/dtus/paginated?scope=mine&limit=100`, { userId: OTHER });
    assert.deepEqual(ids(mine.body), ["dtu_all_other_global", "dtu_all_other_private"]);
    const fresh = await http.get(`/api/dtus/paginated?scope=all&limit=100`, { userId: "all-third" });
    assert.deepEqual(ids(fresh.body), []);
  });

  it("scope=all anonymous returns nothing — no saved set, no substrate leak", async () => {
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
