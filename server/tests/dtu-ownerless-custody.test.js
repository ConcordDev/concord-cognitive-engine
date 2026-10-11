/**
 * Ownerless / system DTUs are not a public write surface, and boot
 * normalization has to survive a restart.
 *
 * The old dtu.update / dtu.delete gate only fired when a foreign owner
 * existed AND the caller was not "anon", so any caller could rewrite a
 * DTU that had no owner. Boot normalization mutated the cached object and
 * called saveStateDebounced(), which omits DTUs once the write-through
 * store is active — rehydrate restored the ownerless oracle_answer JSON.
 *
 * Run: node --test server/tests/dtu-ownerless-custody.test.js
 */

import { describe, it, beforeEach, afterEach } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import express from "express";
import Database from "better-sqlite3";
import { initDTUStore, createDTUStore } from "../lib/dtu-store.js";
import { getAuditLog } from "../lib/audit-logger.js";
import {
  assignDtuCustody,
  dtuMutationDenial,
  normalizeOwnerlessDtus,
  viewerCanReadDtu,
} from "../lib/dtu-ownership.js";
import registerDtuRoutes from "../routes/dtus.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));

function actor(userId, role) {
  if (!userId) return { actor: { userId: "anon", id: "anon", role: "guest" } };
  return { actor: { userId, id: userId, role } };
}

function denial(dtu, userId, role, verb = "update") {
  return dtuMutationDenial(dtu, actor(userId, role), { authMode: "hybrid", verb, actorUserId: userId || "anon" });
}

describe("dtuMutationDenial — ownerless and system DTUs", () => {
  const ownerless = { id: "dtu_oracle_1", type: "oracle_answer", title: "answer", tags: ["oracle_answer"] };
  const systemOwned = { id: "sys1", ownerId: "system", title: "internal note" };
  const mine = { id: "mine", ownerId: "member-1", title: "mine" };
  const theirs = { id: "theirs", author: "member-2", title: "theirs" };

  it("anonymous is 401 in a secured mode", () => {
    for (const dtu of [ownerless, systemOwned, mine]) {
      const out = denial(dtu, null, "guest");
      assert.equal(out.status, 401);
      assert.equal(out.code, "AUTH_REQUIRED");
    }
  });

  it("a member is 403 on an ownerless DTU and on a system-owned DTU", () => {
    for (const dtu of [ownerless, systemOwned]) {
      for (const verb of ["update", "delete"]) {
        const out = denial(dtu, "member-1", "member", verb);
        assert.equal(out.status, 403, `${verb} ${dtu.id}`);
        assert.match(out.error, /unauthorized/);
        assert.match(out.error, new RegExp(`${verb}d`));
      }
    }
  });

  it("a member is 403 on someone else's DTU and allowed on their own", () => {
    const foreign = denial(theirs, "member-1", "member");
    assert.equal(foreign.status, 403);
    assert.equal(denial(mine, "member-1", "member"), null);
    assert.equal(denial(mine, "member-1", "member", "delete"), null);
  });

  it("owner, admin, founder, and sovereign may edit ownerless and system DTUs", () => {
    for (const role of ["owner", "admin", "founder", "sovereign"]) {
      assert.equal(denial(ownerless, "admin-1", role), null, role);
      assert.equal(denial(systemOwned, "admin-1", role, "delete"), null, role);
    }
  });

  it("AUTH_MODE=public keeps the local-first exception", () => {
    const out = dtuMutationDenial(ownerless, actor(null, "guest"), { authMode: "public", verb: "update" });
    assert.equal(out, null);
  });

  it("a system sentinel owner is still ownerless", () => {
    for (const ownerId of ["system", "concord_system", "oracle_system", "anon"]) {
      const out = denial({ id: "x", ownerId }, "member-1", "member");
      assert.equal(out.status, 403, ownerId);
    }
  });
});

describe("startup normalization survives a restart and keeps public system content", () => {
  let db;

  function openStore(memory = new Map()) {
    const store = createDTUStore(db, memory, { log: () => {} });
    return store;
  }

  function column(id) {
    return db.prepare("SELECT owner_user_id, visibility, data FROM dtu_store WHERE id = ?").get(id);
  }

  beforeEach(() => {
    db = new Database(":memory:");
    initDTUStore(db);
  });

  afterEach(() => {
    try { db.close(); } catch { /* already closed */ }
  });

  function seed(store) {
    store.set("dtu_oracle_1", {
      id: "dtu_oracle_1",
      type: "oracle_answer",
      title: "oracle",
      tags: ["oracle_answer"],
      content: "secret answer",
    });
    store.set("dtu_oracle_public", {
      id: "dtu_oracle_public",
      type: "oracle_answer",
      title: "published oracle",
      visibility: "public",
      tags: ["oracle_answer"],
    });
    store.set("news_1", {
      id: "news_1",
      type: "news",
      source: "RSS:reuters",
      title: "headline",
      tags: ["news-feed"],
    });
    store.set("genesis_reality_anchor_v1", {
      id: "genesis_reality_anchor_v1",
      kind: "genesis",
      seedOrigin: true,
      source: "concord_brain_index",
      title: "genesis",
    });
    store.set("summary_1", {
      id: "summary_1",
      type: "system_summary",
      title: "digest",
      meta: { systemSummary: true },
    });
    store.set("scratch_1", {
      id: "scratch_1",
      title: "unowned note",
      content: "not public corpus",
    });
    store.set("owned_1", {
      id: "owned_1",
      ownerId: "member-9",
      visibility: "public",
      title: "already owned",
    });
  }

  it("stamps ownerless oracle_answer rows through store.set so a rehydrate keeps them", () => {
    const first = openStore();
    seed(first);

    const report = normalizeOwnerlessDtus(first);
    assert.equal(report.errors, 0);
    assert.equal(report.internalized, 2, "unset oracle + scratch note");
    assert.equal(report.publicKept, 4, "explicit-public oracle, news, genesis, summary");
    assert.equal(report.skipped, 1, "already-owned row");
    assert.equal(report.migrated, 6);

    const restarted = openStore(new Map());
    const hydrated = restarted.rehydrateFromSQLite();
    assert.equal(hydrated.errors, 0);
    assert.ok(hydrated.loaded >= 7);

    const oracle = restarted.get("dtu_oracle_1");
    assert.equal(oracle.ownerId, "system");
    assert.equal(oracle.visibility, "internal");
    assert.equal(oracle.type, "oracle_answer");
    const oracleCol = column("dtu_oracle_1");
    assert.equal(oracleCol.owner_user_id, "system");
    assert.equal(oracleCol.visibility, "internal");
    const oracleJson = JSON.parse(oracleCol.data);
    assert.equal(oracleJson.ownerId, "system");
    assert.equal(oracleJson.visibility, "internal");

    assert.equal(viewerCanReadDtu(oracle, null), false);
    assert.equal(viewerCanReadDtu(oracle, "member-1"), false);
    assert.equal(viewerCanReadDtu(oracle, "admin-1"), false, "internal is hidden from everyone");

    for (const id of ["dtu_oracle_public", "news_1", "genesis_reality_anchor_v1", "summary_1"]) {
      const dtu = restarted.get(id);
      assert.equal(dtu.ownerId, "system", id);
      assert.equal(dtu.visibility, "public", id);
      assert.equal(column(id).visibility, "public", id);
      assert.equal(column(id).owner_user_id, "system", id);
      assert.equal(viewerCanReadDtu(dtu, null), true, `${id} stays readable`);
    }

    const owned = restarted.get("owned_1");
    assert.equal(owned.ownerId, "member-9");
    assert.equal(owned.visibility, "public");

    const second = normalizeOwnerlessDtus(restarted);
    assert.equal(second.migrated, 0);
    assert.equal(second.internalized, 0);
    assert.equal(second.publicKept, 0);
  });
});

describe("assignDtuCustody — dry-run, persist, read gate", () => {
  let db;
  let store;

  beforeEach(() => {
    db = new Database(":memory:");
    initDTUStore(db);
    store = createDTUStore(db, new Map(), { log: () => {} });
    store.set("dtu_oracle_2", {
      id: "dtu_oracle_2",
      type: "oracle_answer",
      title: "leak",
      tags: ["oracle_answer"],
      content: "still public",
    });
  });

  afterEach(() => {
    try { db.close(); } catch { /* already closed */ }
  });

  function snapshot(id) {
    const mem = store.get(id);
    const row = db.prepare("SELECT owner_user_id, visibility, data FROM dtu_store WHERE id = ?").get(id);
    return {
      mem: mem ? { ownerId: mem.ownerId || null, visibility: mem.visibility || null, title: mem.title } : null,
      colOwner: row?.owner_user_id || null,
      colVis: row?.visibility || null,
      json: row ? JSON.parse(row.data) : null,
    };
  }

  it("a non-admin is 403 and nothing is audited or written", () => {
    const before = snapshot("dtu_oracle_2");
    const beforeAudits = getAuditLog({ action: "dtu.assignCustody", actor: "member-1" }).total
      + getAuditLog({ action: "dtu.assignCustody.dry_run", actor: "member-1" }).total;
    const out = assignDtuCustody(store, {
      ids: ["dtu_oracle_2"],
      visibility: "private",
      owner: "member-1",
    }, actor("member-1", "member"));
    assert.equal(out.ok, false);
    assert.equal(out.status, 403);
    assert.deepEqual(snapshot("dtu_oracle_2"), before);
    const afterAudits = getAuditLog({ action: "dtu.assignCustody", actor: "member-1" }).total
      + getAuditLog({ action: "dtu.assignCustody.dry_run", actor: "member-1" }).total;
    assert.equal(afterAudits, beforeAudits);
  });

  it("anonymous custody is 401", () => {
    const out = assignDtuCustody(store, { ids: ["dtu_oracle_2"], visibility: "private", owner: "x" }, actor(null, "guest"));
    assert.equal(out.status, 401);
    assert.equal(store.get("dtu_oracle_2").ownerId, undefined);
  });

  it("dry-run reports the diff and leaves memory and sqlite unchanged", () => {
    const before = snapshot("dtu_oracle_2");
    const out = assignDtuCustody(store, {
      ids: ["dtu_oracle_2", "missing"],
      visibility: "private",
      owner: "reader-1",
      dryRun: true,
    }, actor("admin-1", "admin"), {
      persist: (dtu) => store.set(dtu.id, dtu),
    });
    assert.equal(out.ok, true);
    assert.equal(out.dryRun, true);
    assert.equal(out.updated, 1);
    const hit = out.results.find((r) => r.id === "dtu_oracle_2");
    assert.equal(hit.ok, true);
    assert.equal(hit.after.ownerId, "reader-1");
    assert.equal(hit.after.visibility, "private");
    assert.equal(out.results.find((r) => r.id === "missing").error, "not_found");
    assert.deepEqual(snapshot("dtu_oracle_2"), before);

    const audit = getAuditLog({ action: "dtu.assignCustody.dry_run", actor: "admin-1" });
    assert.ok(audit.total >= 1);
    assert.equal(audit.entries[0].metadata.dryRun, true);
    assert.equal(audit.entries[0].metadata.owner, "reader-1");
  });

  it("a real run persists through the store and a rehydrate keeps the new owner", () => {
    const out = assignDtuCustody(store, {
      ids: ["dtu_oracle_2"],
      visibility: "private",
      owner: "reader-1",
    }, actor("admin-1", "owner"), {
      persist: (dtu) => store.set(dtu.id, dtu),
    });
    assert.equal(out.ok, true);
    assert.equal(out.dryRun, false);
    assert.equal(out.updated, 1);

    const live = store.get("dtu_oracle_2");
    assert.equal(live.ownerId, "reader-1");
    assert.equal(live.visibility, "private");
    assert.equal(viewerCanReadDtu(live, null), false);
    assert.equal(viewerCanReadDtu(live, "someone-else"), false);
    assert.equal(viewerCanReadDtu(live, "reader-1"), true);

    const restarted = createDTUStore(db, new Map(), { log: () => {} });
    restarted.rehydrateFromSQLite();
    const again = restarted.get("dtu_oracle_2");
    assert.equal(again.ownerId, "reader-1");
    assert.equal(again.visibility, "private");
    const row = db.prepare("SELECT owner_user_id, visibility FROM dtu_store WHERE id = ?").get("dtu_oracle_2");
    assert.equal(row.owner_user_id, "reader-1");
    assert.equal(row.visibility, "private");

    const audit = getAuditLog({ action: "dtu.assignCustody", actor: "admin-1", target: "dtu_oracle_2" });
    assert.ok(audit.total >= 1);
    assert.equal(audit.entries[0].metadata.dryRun, false);
    assert.equal(audit.entries[0].metadata.visibility, "private");
  });
});

describe("PUT/PATCH/DELETE /api/dtus/:id and POST /api/dtus/admin/custody", () => {
  function requireRole(...roles) {
    return (req, res, next) => {
      if (!req.user) return res.status(401).json({ ok: false, error: "Authentication required" });
      if (req.user.role === "sovereign") return next();
      if (roles.includes(req.user.role)) return next();
      return res.status(403).json({ ok: false, error: "Insufficient permissions" });
    };
  }

  function makeCtx(req) {
    if (!req.user) return { actor: { userId: "anon", id: "anon", role: "guest" }, log() {} };
    return { actor: { userId: req.user.id, id: req.user.id, role: req.user.role || "member" }, log() {} };
  }

  function build(state) {
    async function runMacro(domain, name, input, ctx) {
      assert.equal(domain, "dtu");
      if (name === "update") {
        const existing = state.dtus.get(input.id);
        if (!existing) return { ok: false, error: "DTU not found" };
        const blocked = dtuMutationDenial(existing, ctx, {
          authMode: "hybrid",
          verb: "update",
          actorUserId: ctx?.actor?.userId,
        });
        if (blocked) return { ok: false, error: blocked.error, status: blocked.status, code: blocked.code };
        const updated = { ...existing };
        if (input.title !== undefined) updated.title = String(input.title);
        if (input.content !== undefined) updated.content = String(input.content);
        if (input.tags !== undefined) updated.tags = input.tags;
        state.dtus.set(updated.id, updated);
        return { ok: true, dtu: updated };
      }
      if (name === "delete") {
        const dtu = state.dtus.get(input.id);
        if (!dtu) return { ok: false, error: "DTU not found" };
        const blocked = dtuMutationDenial(dtu, ctx, {
          authMode: "hybrid",
          verb: "delete",
          actorUserId: ctx?.actor?.userId,
        });
        if (blocked) return { ok: false, error: blocked.error, status: blocked.status, code: blocked.code };
        state.dtus.delete(input.id);
        return { ok: true, deleted: { id: input.id } };
      }
      if (name === "get") {
        const dtu = state.dtus.get(input.id);
        if (!dtu) return { ok: false, error: "DTU not found" };
        const raw = ctx?.actor?.id || ctx?.actor?.userId || null;
        const viewerId = !raw || raw === "anon" ? null : raw;
        if (!viewerCanReadDtu(dtu, viewerId)) return { ok: false, error: "DTU not found" };
        return { ok: true, dtu };
      }
      if (name === "list") {
        const raw = ctx?.actor?.id || ctx?.actor?.userId || null;
        const viewerId = !raw || raw === "anon" ? null : raw;
        const dtus = [...state.dtus.values()].filter((d) => viewerCanReadDtu(d, viewerId));
        return { ok: true, dtus };
      }
      if (name === "assignCustody") {
        return assignDtuCustody(state.dtus, input || {}, ctx, {
          persist: (dtu) => state.dtus.set(dtu.id, dtu),
        });
      }
      return { ok: false, error: `unhandled ${name}` };
    }

    const app = express();
    app.use(express.json());
    app.use((req, _res, next) => {
      const uid = req.get("x-test-user-id");
      const role = req.get("x-test-user-role");
      if (uid) req.user = { id: uid, role: role || "member" };
      next();
    });
    registerDtuRoutes(app, {
      STATE: state,
      makeCtx,
      runMacro,
      dtuForClient: (d) => d,
      dtusArray: () => [...state.dtus.values()],
      userVisibleDTUs: (viewerId) => [...state.dtus.values()].filter((d) => viewerCanReadDtu(d, viewerId)),
      _withAck: (out) => out,
      _saveStateDebounced: () => {},
      validate: () => (_req, _res, next) => next(),
      requireRole,
    });
    return app;
  }

  function listen(app) {
    return new Promise((resolve) => {
      const server = app.listen(0, "127.0.0.1", () => resolve(server));
    });
  }

  async function request(server, method, urlPath, { userId, role, body } = {}) {
    const port = server.address().port;
    const headers = {};
    if (body !== undefined) headers["content-type"] = "application/json";
    if (userId) headers["x-test-user-id"] = userId;
    if (role) headers["x-test-user-role"] = role;
    const res = await fetch(`http://127.0.0.1:${port}${urlPath}`, {
      method,
      headers,
      body: body !== undefined ? JSON.stringify(body) : undefined,
    });
    const json = await res.json().catch(() => null);
    return { status: res.status, body: json };
  }

  async function withServer(state, fn) {
    const server = await listen(build(state));
    try {
      return await fn(server);
    } finally {
      await new Promise((resolve) => server.close(resolve));
    }
  }

  function seedState() {
    return {
      dtus: new Map([
        ["dtu_oracle_9", { id: "dtu_oracle_9", type: "oracle_answer", title: "oracle", tags: ["oracle_answer"], content: "secret" }],
        ["sys_note", { id: "sys_note", ownerId: "system", title: "system", visibility: "public" }],
        ["mine", { id: "mine", ownerId: "member-1", title: "mine", visibility: "private" }],
        ["visible", { id: "visible", ownerId: "member-1", title: "visible", visibility: "public" }],
      ]),
      shadowDtus: new Map(),
    };
  }

  it("anonymous gets 401 and a member gets 403 on PUT, PATCH, and DELETE of an ownerless DTU", async () => {
    const state = seedState();
    await withServer(state, async (server) => {
      for (const method of ["PUT", "PATCH"]) {
        const anon = await request(server, method, "/api/dtus/dtu_oracle_9", { body: { title: "pwned" } });
        assert.equal(anon.status, 401, method);
        const member = await request(server, method, "/api/dtus/dtu_oracle_9", {
          userId: "member-1",
          role: "member",
          body: { title: "pwned" },
        });
        assert.equal(member.status, 403, method);
        assert.match(member.body.error, /unauthorized/);
      }
      const anonDel = await request(server, "DELETE", "/api/dtus/dtu_oracle_9");
      assert.equal(anonDel.status, 401);
      const memberDel = await request(server, "DELETE", "/api/dtus/dtu_oracle_9", { userId: "member-1", role: "member" });
      assert.equal(memberDel.status, 403);
      assert.equal(state.dtus.get("dtu_oracle_9").title, "oracle");
      assert.equal(state.dtus.has("dtu_oracle_9"), true);
    });
  });

  it("an admin can patch and delete an ownerless DTU; a member can still update their own", async () => {
    const state = seedState();
    await withServer(state, async (server) => {
      const patched = await request(server, "PATCH", "/api/dtus/dtu_oracle_9", {
        userId: "admin-1",
        role: "admin",
        body: { title: "reviewed", content: "redacted" },
      });
      assert.equal(patched.status, 200);
      assert.equal(patched.body.ok, true);
      assert.equal(state.dtus.get("dtu_oracle_9").title, "reviewed");
      assert.equal(state.dtus.get("dtu_oracle_9").content, "redacted");

      const own = await request(server, "PUT", "/api/dtus/mine", {
        userId: "member-1",
        role: "member",
        body: { title: "renamed" },
      });
      assert.equal(own.status, 200);
      assert.equal(state.dtus.get("mine").title, "renamed");

      const sys = await request(server, "PATCH", "/api/dtus/sys_note", {
        userId: "member-1",
        role: "member",
        body: { title: "nope" },
      });
      assert.equal(sys.status, 403);
      assert.equal(state.dtus.get("sys_note").title, "system");

      const sysAdmin = await request(server, "PATCH", "/api/dtus/sys_note", {
        userId: "admin-1",
        role: "owner",
        body: { title: "kept" },
      });
      assert.equal(sysAdmin.status, 200);
      assert.equal(state.dtus.get("sys_note").title, "kept");

      const removed = await request(server, "DELETE", "/api/dtus/dtu_oracle_9", { userId: "admin-1", role: "founder" });
      assert.equal(removed.status, 200);
      assert.equal(state.dtus.has("dtu_oracle_9"), false);
    });
  });

  it("custody: non-admin 403, dry-run writes nothing, a real run hides the DTU from everyone but the new owner", async () => {
    const state = seedState();
    await withServer(state, async (server) => {
      const anon = await request(server, "POST", "/api/dtus/admin/custody", {
        body: { ids: ["dtu_oracle_9"], visibility: "private", owner: "reader-1" },
      });
      assert.equal(anon.status, 401);

      const member = await request(server, "POST", "/api/dtus/admin/custody", {
        userId: "member-1",
        role: "member",
        body: { ids: ["dtu_oracle_9"], visibility: "private", owner: "reader-1" },
      });
      assert.equal(member.status, 403);
      assert.equal(state.dtus.get("dtu_oracle_9").title, "oracle");
      assert.equal(state.dtus.get("dtu_oracle_9").ownerId, undefined);

      const dry = await request(server, "POST", "/api/dtus/admin/custody", {
        userId: "admin-1",
        role: "admin",
        body: { ids: ["dtu_oracle_9"], visibility: "private", owner: "reader-1", dryRun: true },
      });
      assert.equal(dry.status, 200);
      assert.equal(dry.body.ok, true);
      assert.equal(dry.body.dryRun, true);
      assert.equal(state.dtus.get("dtu_oracle_9").ownerId, undefined);
      assert.equal(state.dtus.get("dtu_oracle_9").visibility, undefined);

      const real = await request(server, "POST", "/api/dtus/admin/custody", {
        userId: "admin-1",
        role: "admin",
        body: { ids: ["dtu_oracle_9"], visibility: "private", owner: "reader-1" },
      });
      assert.equal(real.status, 200);
      assert.equal(real.body.dryRun, false);
      assert.equal(state.dtus.get("dtu_oracle_9").ownerId, "reader-1");
      assert.equal(state.dtus.get("dtu_oracle_9").visibility, "private");

      const anonGet = await request(server, "GET", "/api/dtus/dtu_oracle_9");
      assert.equal(anonGet.status, 404);
      const otherGet = await request(server, "GET", "/api/dtus/dtu_oracle_9", { userId: "member-1", role: "member" });
      assert.equal(otherGet.status, 404);
      const ownerGet = await request(server, "GET", "/api/dtus/dtu_oracle_9", { userId: "reader-1", role: "member" });
      assert.equal(ownerGet.status, 200);
      assert.equal(ownerGet.body.dtu.ownerId, "reader-1");

      const anonList = await request(server, "GET", "/api/dtus");
      assert.equal(anonList.body.dtus.some((d) => d.id === "dtu_oracle_9"), false);
      assert.equal(anonList.body.dtus.some((d) => d.id === "visible"), true);
      const otherList = await request(server, "GET", "/api/dtus", { userId: "member-1", role: "member" });
      assert.equal(otherList.body.dtus.some((d) => d.id === "dtu_oracle_9"), false);
      assert.equal(otherList.body.dtus.some((d) => d.id === "mine"), true, "member still sees their own private DTU");
      const ownerList = await request(server, "GET", "/api/dtus", { userId: "reader-1", role: "member" });
      assert.equal(ownerList.body.dtus.some((d) => d.id === "dtu_oracle_9"), true);

      const dryAudit = getAuditLog({ action: "dtu.assignCustody.dry_run", actor: "admin-1", target: "dtu_oracle_9" });
      const realAudit = getAuditLog({ action: "dtu.assignCustody", actor: "admin-1", target: "dtu_oracle_9" });
      assert.ok(dryAudit.total >= 1);
      assert.ok(realAudit.total >= 1);
    });
  });
});

describe("server.js wires the custody gate through the normal DTU path", () => {
  const source = fs.readFileSync(path.join(__dirname, "../server.js"), "utf8");
  const routes = fs.readFileSync(path.join(__dirname, "../routes/dtus.js"), "utf8");
  const readAccess = fs.readFileSync(path.join(__dirname, "../lib/dtu-read-access.js"), "utf8");

  it("boot normalization persists via the store, and update/delete/get/custody call the helper", () => {
    assert.match(source, /normalizeOwnerlessDtus\(STATE\.dtus\)/);
    assert.match(source, /dtuMutationDenial\(existing,/);
    assert.match(source, /dtuMutationDenial\(dtu,/);
    assert.match(source, /register\("dtu", "assignCustody"/);
    assert.match(source, /persist: \(dtu\) => upsertDTU\(dtu/);
    assert.match(source, /ctx\?\.actor\?\.userId/);
    const allow = source.match(/dtu: new Set\(\[([^\]]+)\]\)/);
    assert.ok(allow, "dtu public-read allowlist");
    assert.doesNotMatch(allow[1], /assignCustody/);
  });

  it("the custody route is admin-gated and writes return the macro status", () => {
    assert.match(routes, /app\.post\("\/api\/dtus\/admin\/custody"/);
    assert.match(routes, /requireRole\("owner", "admin", "founder"\)/);
    assert.match(routes, /respondDtuWrite\(res, out\)/);
  });

  it("by-id reads hide visibility internal, which is what boot stamps on oracle answers", () => {
    assert.match(readAccess, /dtu\?\.visibility === "internal"/);
  });
});
