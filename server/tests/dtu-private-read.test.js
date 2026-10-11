/**
 * Private DTU by-id reads.
 *
 * GET /api/dtus/:id used to return any non-shadow DTU to an anonymous
 * caller. The list endpoint already hid those rows via userVisibleDTUs.
 * This pins the same private predicate on dtu.get and the sibling by-id
 * routes that returned a single DTU's content.
 *
 * Run:
 *   node --test --import=./tests/preload/no-egress.mjs --test-timeout=300000 tests/dtu-private-read.test.js
 */

import { describe, it, before } from "node:test";
import assert from "node:assert/strict";
import express from "express";
import { load } from "./depth/_harness.js";
import {
  privateDtuHiddenFrom,
  viewerIdFromCtx,
  ctxMayReadDtu,
  dtuFromStoreRow,
} from "../lib/dtu-read-access.js";
import registerDtuRoutes from "../routes/dtus.js";
import registerHelpersExtendedRoutes from "../routes/helpers-extended.js";
import registerOperationRoutes from "../routes/operations.js";
import { registerGuidanceEndpoints } from "../guidance.js";

const OWNER = "privread-owner";
const OTHER = "privread-other";
const SECRET = "privread-secret-content-9f3a";
const PUBLIC_BODY = "privread-public-body";

function fakeReq(user) {
  return {
    user: user || undefined,
    ip: "127.0.0.1",
    method: "GET",
    path: "/api/dtus/x",
    headers: {},
    query: {},
    get: () => "",
  };
}

describe("dtu-read-access predicate", () => {
  const owned = {
    visibility: "private",
    scope: "local",
    ownerId: OWNER,
    content: SECRET,
  };

  it("hides a private DTU from anonymous and from a different member", () => {
    assert.equal(privateDtuHiddenFrom(owned, null), true);
    assert.equal(privateDtuHiddenFrom(owned, OTHER), true);
    assert.equal(privateDtuHiddenFrom(owned, OWNER), false);
  });

  it("treats followers-only, privacy private, and scope user as owner-only", () => {
    assert.equal(privateDtuHiddenFrom({ privacy: "followers-only", ownerId: OWNER }, OTHER), true);
    assert.equal(privateDtuHiddenFrom({ privacy: "private", author: OWNER }, null), true);
    assert.equal(privateDtuHiddenFrom({ scope: "user", visibility: "public", createdBy: OWNER }, OTHER), true);
    assert.equal(privateDtuHiddenFrom({ scope: "user", visibility: "public", createdBy: OWNER }, OWNER), false);
  });

  it("leaves public and null-visibility DTUs readable, including federation-local public", () => {
    assert.equal(privateDtuHiddenFrom({ visibility: "public", scope: "global", federation_tier: "local" }, null), false);
    assert.equal(privateDtuHiddenFrom({ scope: "global", title: "legacy" }, null), false);
    assert.equal(privateDtuHiddenFrom({ visibility: "public", scope: "personal", ownerId: OWNER }, null), false);
  });

  it("ignores the anonymous placeholder and honors req.user.id", () => {
    assert.equal(viewerIdFromCtx(null), null);
    assert.equal(viewerIdFromCtx({ actor: { userId: "anon" } }), null);
    assert.equal(viewerIdFromCtx({ actor: { userId: OWNER } }), OWNER);
    assert.equal(viewerIdFromCtx({ user: { id: OWNER } }), OWNER);
    assert.equal(ctxMayReadDtu({ actor: { role: "admin", id: "admin-1" } }, owned), false);
    assert.equal(ctxMayReadDtu({ internal: true, actor: { userId: "system" } }, owned), true);
  });

  it("fills visibility and owner from a dtu_store row when the JSON omits them", () => {
    const obj = dtuFromStoreRow({
      data: JSON.stringify({ title: "row" }),
      visibility: "private",
      owner_user_id: OWNER,
      scope: "global",
    });
    assert.equal(obj.visibility, "private");
    assert.equal(obj.ownerId, OWNER);
    assert.equal(obj.scope, undefined);
    assert.equal(privateDtuHiddenFrom(obj, OTHER), true);
    assert.equal(privateDtuHiddenFrom(obj, OWNER), false);
  });
});

describe("private DTU by-id reads", () => {
  let runMacro, makeCtx, makeInternalCtx, STATE, db;
  let http;

  const ids = {
    private: "privread-private",
    privacy: "privread-privacy",
    followers: "privread-followers",
    scopeUser: "privread-scope-user",
    public: "privread-public",
    bare: "privread-bare",
    fedLocal: "privread-fed-local",
    child: "privread-child",
    storeOnly: "privread-store-only",
    sql: "privread-sql",
  };

  function seed(id, over) {
    STATE.dtus.set(id, {
      id,
      tier: "regular",
      visibility: "public",
      scope: "global",
      title: id,
      content: PUBLIC_BODY,
      human: { summary: id },
      core: {},
      machine: {},
      createdAt: new Date().toISOString(),
      ...over,
    });
  }

  before(async () => {
    ({ runMacro, makeCtx, makeInternalCtx, STATE, db } = await load());
    seed(ids.private, {
      visibility: "private",
      scope: "local",
      ownerId: OWNER,
      author: OWNER,
      createdBy: OWNER,
      title: "privread-private-title",
      content: SECRET,
    });
    seed(ids.privacy, { privacy: "private", ownerId: OWNER, content: SECRET, visibility: "public" });
    seed(ids.followers, { privacy: "followers-only", ownerId: OWNER, content: SECRET });
    seed(ids.scopeUser, { scope: "user", visibility: "public", ownerId: OWNER, content: SECRET });
    seed(ids.public, { visibility: "public", scope: "global", content: PUBLIC_BODY, ownerId: OWNER });
    seed(ids.bare, { visibility: undefined, scope: "global", content: PUBLIC_BODY });
    seed(ids.fedLocal, {
      visibility: "public",
      scope: "global",
      federation_tier: "local",
      ownerId: OWNER,
      content: PUBLIC_BODY,
    });
    seed(ids.child, {
      visibility: "public",
      scope: "global",
      content: PUBLIC_BODY,
      lineage: { parents: [ids.private], children: [] },
      tags: ["privread-tag"],
    });

    const now = new Date().toISOString();
    db.prepare(
      `INSERT OR REPLACE INTO dtu_store (id, title, created_at, updated_at, data, visibility, owner_user_id)
       VALUES (?, ?, ?, ?, ?, ?, ?)`
    ).run(
      ids.storeOnly,
      "store private",
      now,
      now,
      JSON.stringify({ id: ids.storeOnly, visibility: "private", ownerId: OWNER, content: SECRET }),
      "private",
      OWNER,
    );
    db.prepare(
      `INSERT OR REPLACE INTO users (id, username, email, password_hash, created_at)
       VALUES (?, ?, ?, 'x', datetime('now'))`
    ).run(OWNER, OWNER, `${OWNER}@test.local`);
    db.prepare(
      `INSERT OR REPLACE INTO dtus (id, owner_user_id, title, body_json, visibility)
       VALUES (?, ?, ?, ?, 'private')`
    ).run(ids.sql, OWNER, "sql private", JSON.stringify({ content: SECRET }));
    db.prepare(
      `INSERT OR REPLACE INTO dtu_versions (id, dtu_id, version, body_json) VALUES (?, ?, 1, ?)`
    ).run(`${ids.sql}-v1`, ids.sql, JSON.stringify({ content: SECRET }));

    http = await startHttp({ STATE, db, runMacro, makeCtx });
  });

  function anonCtx() {
    return makeCtx(fakeReq(null));
  }
  function userCtx(id, role = "member") {
    return makeCtx(fakeReq({ id, role }));
  }

  async function getMacro(name, id, ctx) {
    return runMacro("dtu", name, { id }, ctx);
  }

  it("dtu.get: anonymous and another member miss; owner, internal, and public succeed", async () => {
    for (const id of [ids.private, ids.privacy, ids.followers, ids.scopeUser]) {
      const anon = await getMacro("get", id, anonCtx());
      const other = await getMacro("get", id, userCtx(OTHER));
      const admin = await getMacro("get", id, userCtx("privread-admin", "admin"));
      assert.equal(anon.ok, false);
      assert.equal(anon.error, "DTU not found");
      assert.equal(other.ok, false);
      assert.equal(admin.ok, false);
      assert.equal(JSON.stringify(anon).includes(SECRET), false);
      assert.equal(JSON.stringify(other).includes(SECRET), false);

      const owner = await getMacro("get", id, userCtx(OWNER));
      assert.equal(owner.ok, true);
      assert.equal(owner.dtu.content, SECRET);

      const ownerUserIdOnly = await getMacro("get", id, { actor: { userId: OWNER } });
      assert.equal(ownerUserIdOnly.ok, true, "owner ctx that only stamps userId can still read");

      const anonPlaceholder = await getMacro("get", id, { actor: { userId: "anon" } });
      assert.equal(anonPlaceholder.ok, false);

      const internal = await getMacro("get", id, makeInternalCtx("system"));
      assert.equal(internal.ok, true);
    }

    const pub = await getMacro("get", ids.public, anonCtx());
    assert.equal(pub.ok, true);
    assert.equal(pub.dtu.content, PUBLIC_BODY);

    const bare = await getMacro("get", ids.bare, anonCtx());
    assert.equal(bare.ok, true);

    const fed = await getMacro("get", ids.fedLocal, anonCtx());
    assert.equal(fed.ok, true, "visibility public stays readable by id even when federation_tier is local");
  });

  it("dtu.list still hides the private id from anonymous callers and shows it to the owner", async () => {
    const anon = await runMacro("dtu", "list", { limit: 5000 }, anonCtx());
    const anonIds = new Set((anon.dtus || []).map((d) => d.id));
    assert.equal(anonIds.has(ids.private), false);
    assert.equal(anonIds.has(ids.public), true);
    assert.equal(anonIds.has(ids.fedLocal), false, "list keeps the federation-local filter");

    const owner = await runMacro("dtu", "list", { limit: 5000 }, userCtx(OWNER));
    const ownerIds = new Set((owner.dtus || []).map((d) => d.id));
    assert.equal(ownerIds.has(ids.private), true);
    assert.equal(ownerIds.has(ids.public), true);
  });

  it("dtu.lineage 404s a hidden subject and redacts a private parent on a public child", async () => {
    const hidden = await getMacro("lineage", ids.private, userCtx(OTHER));
    assert.equal(hidden.ok, false);
    assert.equal(hidden.error, "DTU not found");
    assert.equal(JSON.stringify(hidden).includes(SECRET), false);

    const visible = await getMacro("lineage", ids.child, anonCtx());
    assert.equal(visible.ok, true);
    assert.equal(visible.parents.length, 1);
    assert.deepEqual(visible.parents[0], { id: ids.private });
    assert.equal(JSON.stringify(visible).includes(SECRET), false);
    assert.equal(JSON.stringify(visible).includes("privread-private-title"), false);

    const owner = await getMacro("lineage", ids.private, userCtx(OWNER));
    assert.equal(owner.ok, true);
    assert.equal(owner.current.title, "privread-private-title");
  });

  it("dtu.export misses for another member and succeeds for the owner", async () => {
    const other = await getMacro("export", ids.private, userCtx(OTHER));
    assert.equal(other.ok, false);
    assert.equal(other.error, "not_found");
    const owner = await getMacro("export", ids.private, userCtx(OWNER));
    assert.equal(owner.ok, true);
    assert.equal(owner.dtu.content, SECRET);
    const pub = await getMacro("export", ids.public, anonCtx());
    assert.equal(pub.ok, true);
  });

  it("HTTP GET /api/dtus/:id and sibling by-id routes", async () => {
    const anonPriv = await http.get(`/api/dtus/${ids.private}`);
    assert.equal(anonPriv.status, 404);
    assert.equal(anonPriv.body.ok, false);
    assert.equal(JSON.stringify(anonPriv.body).includes(SECRET), false);

    const otherPriv = await http.get(`/api/dtus/${ids.private}`, { userId: OTHER });
    assert.equal(otherPriv.status, 404);
    assert.equal(JSON.stringify(otherPriv.body).includes(SECRET), false);

    const ownerPriv = await http.get(`/api/dtus/${ids.private}`, { userId: OWNER });
    assert.equal(ownerPriv.status, 200);
    assert.equal(ownerPriv.body.dtu.content, SECRET);

    const anonPub = await http.get(`/api/dtus/${ids.public}`);
    assert.equal(anonPub.status, 200);
    assert.equal(anonPub.body.dtu.content, PUBLIC_BODY);

    const lineage = await http.get(`/api/dtus/${ids.private}/lineage`);
    assert.equal(lineage.status, 404);
    const lineageOwner = await http.get(`/api/dtus/${ids.private}/lineage`, { userId: OWNER });
    assert.equal(lineageOwner.status, 200);

    const view = await http.get(`/api/dtu_view/${ids.private}`);
    assert.equal(view.status, 404);
    const viewOwner = await http.get(`/api/dtu_view/${ids.private}`, { userId: OWNER });
    assert.equal(viewOwner.status, 200);

    const children = await http.get(`/api/dtus/${ids.private}/children`);
    assert.equal(children.status, 404);
    const childLine = await http.get(`/api/dtus/${ids.child}/children`);
    assert.equal(childLine.status, 200);

    const related = await http.get(`/api/dtus/${ids.private}/related`);
    assert.equal(related.status, 404);
    const history = await http.get(`/api/dtus/${ids.private}/history`);
    assert.equal(history.status, 404);
    const historyOwner = await http.get(`/api/dtus/${ids.private}/history`, { userId: OWNER });
    assert.equal(historyOwner.status, 200);
    assert.equal(JSON.stringify(history.body).includes(SECRET), false);

    const recent = await http.get("/api/dtus/recent?limit=100");
    assert.equal(recent.status, 200);
    assert.equal((recent.body.dtus || []).some((d) => d.id === ids.private), false);
    assert.equal(JSON.stringify(recent.body).includes(SECRET), false);
    const recentOwner = await http.get("/api/dtus/recent?limit=100", { userId: OWNER });
    assert.equal((recentOwner.body.dtus || []).some((d) => d.id === ids.private), true);

    const search = await http.get("/api/dtus/search?q=privread-private-title");
    assert.equal((search.body.results || []).some((d) => d.id === ids.private), false);
    const searchOwner = await http.get("/api/dtus/search?q=privread-private-title", { userId: OWNER });
    assert.equal((searchOwner.body.results || []).some((d) => d.id === ids.private), true);

    const attachments = await http.get(`/api/dtus/${ids.private}/attachments`);
    assert.equal(attachments.status, 404);
    assert.equal(attachments.body.error, "dtu_not_found");
    const bytes = await http.get(`/api/dtus/${ids.private}/attachment/abc`);
    assert.equal(bytes.status, 404);
    const archive = await http.get(`/api/dtus/${ids.private}/export.dtu`);
    assert.equal(archive.status, 404);
    const storeArchive = await http.get(`/api/dtus/${ids.storeOnly}/export.dtu`);
    assert.equal(storeArchive.status, 404);
    assert.equal(JSON.stringify(storeArchive.body).includes(SECRET), false);

    const versions = await http.get(`/api/dtus/${ids.sql}/versions`);
    assert.equal(versions.status, 404);
    assert.equal(JSON.stringify(versions.body).includes(SECRET), false);
    const versionsOwner = await http.get(`/api/dtus/${ids.sql}/versions`, { userId: OWNER });
    assert.equal(versionsOwner.status, 200);
    assert.equal(versionsOwner.body.versions[0].body.content, SECRET);
  });
});

async function startHttp({ STATE, db, runMacro, makeCtx }) {
  const app = express();
  app.use(express.json());
  app.use((req, _res, next) => {
    const uid = req.get("x-test-user");
    const role = req.get("x-test-role") || "member";
    if (uid) req.user = { id: uid, role };
    next();
  });
  const passthrough = () => (_req, _res, next) => next();
  // recent/search/shadow are registered in routes/dtus.js before
  // /api/dtus/:id. Production mount order is pinned by
  // tests/dtu-literal-get-order.test.js.
  registerHelpersExtendedRoutes(app, {
    db,
    STATE,
    makeCtx,
    runMacro,
    saveStateDebounced: () => {},
    dtusArray: () => [...STATE.dtus.values()],
    uid: (prefix) => `${prefix}_test`,
    requireAuth: passthrough,
    requireRole: () => passthrough(),
  });
  registerGuidanceEndpoints(app, db);
  registerOperationRoutes(app, {
    STATE,
    makeCtx,
    runMacro,
    _withAck: (out) => out,
    ensureOrganRegistry: () => {},
    ensureQueues: () => {},
    userVisibleDTUs: () => [],
    uid: (p) => `${p}_test`,
    sha256Hex: () => "",
    nowISO: () => new Date().toISOString(),
    saveStateDebounced: () => {},
    requireRole: () => passthrough(),
    PIPE: {},
    TEMPORAL_FRAMES: [],
    pipeListProposals: () => [],
    computeAbstractionSnapshot: () => ({}),
    maybeRunLocalUpgrade: () => {},
    runAutoPromotion: () => {},
    tryLoadSeedDTUs: () => {},
    toOptionADTU: () => ({}),
    SEED_INFO: {},
    _kernelTick: () => {},
    _uiJson: (x) => x,
  });
  registerDtuRoutes(app, {
    STATE,
    makeCtx,
    runMacro,
    dtuForClient: (d) => d,
    dtusArray: () => [...STATE.dtus.values()],
    userVisibleDTUs: () => [],
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

  async function get(path, opts = {}) {
    const headers = {};
    if (opts.userId) headers["x-test-user"] = opts.userId;
    if (opts.role) headers["x-test-role"] = opts.role;
    const res = await fetch(`http://127.0.0.1:${port}${path}`, { headers });
    const text = await res.text();
    let body = null;
    try { body = JSON.parse(text); } catch { body = { raw: text }; }
    return { status: res.status, body };
  }

  return { get, close: () => new Promise((resolve) => server.close(resolve)) };
}
