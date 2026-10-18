/**
 * INC-110 + INC-111 regression tests.
 *
 * INC-110: GET /api/dtus/:id/related must not depend on the missing `dtusArray`
 * dependency passed to registerHelpersExtendedRoutes; it must return readable
 * same-tag DTUs and never leak another user's private DTU.
 *
 * INC-111: PATCH /api/dtus/:id {title} must regenerate `cretiHuman` so it no
 * longer starts with the old title.
 *
 * Run:
 *   node --test --import=./tests/preload/no-egress.mjs --test-timeout=300000 tests/INC-110-111-related-creti.test.js
 */

import { describe, it, before, after } from "node:test";
import assert from "node:assert/strict";
import express from "express";
import { load } from "./depth/_harness.js";
import registerHelpersExtendedRoutes from "../routes/helpers-extended.js";
import registerDtuRoutes from "../routes/dtus.js";

const OWNER = "inc110-owner";
const OTHER = "inc110-other";
const SHARED_TAG = "inc110-shared";

describe("INC-110 /api/dtus/:id/related", () => {
  let runMacro, makeCtx, makeInternalCtx, STATE, db, http;

  before(async () => {
    ({ runMacro, makeCtx, makeInternalCtx, STATE, db } = await load());
    http = await startHttp({ STATE, db, runMacro, makeCtx });
  });

  after(async () => {
    await http?.close();
  });

  it("owner gets 200 ok:true with readable same-tag DTUs, excludes other's private DTU", async () => {
    const ownerCtx = makeInternalCtx(OWNER);
    const ownerDtu = await runMacro(
      "dtu",
      "create",
      {
        title: "Owner note",
        tags: [SHARED_TAG],
        source: "user",
        visibility: "private",
        scope: "local",
        human: { summary: "owner summary" },
        core: {
          definitions: ["A private DTU owned by the test owner."],
          claims: ["Owner can read this DTU.", "Others cannot read this DTU unless shared."],
        },
      },
      ownerCtx,
    );
    assert.equal(ownerDtu.ok, true, "owner DTU creation must succeed");
    const ownerId = ownerDtu.dtu.id;

    const otherCtx = makeInternalCtx(OTHER);
    const otherDtu = await runMacro(
      "dtu",
      "create",
      {
        title: "Other private note",
        tags: [SHARED_TAG],
        source: "user",
        visibility: "private",
        scope: "local",
        human: { summary: "other summary" },
        core: {
          definitions: ["A private DTU owned by another user."],
          claims: ["Owner can read this DTU.", "Strangers cannot read this DTU."],
        },
      },
      otherCtx,
    );
    assert.equal(otherDtu.ok, true, "other DTU creation must succeed");
    const otherId = otherDtu.dtu.id;

    const publicCtx = makeInternalCtx("inc110-public-user");
    const publicDtu = await runMacro(
      "dtu",
      "create",
      {
        title: "Public note",
        tags: [SHARED_TAG],
        source: "user",
        visibility: "public",
        scope: "global",
        human: { summary: "public summary" },
        core: {
          definitions: ["A public DTU for related-query testing."],
          claims: ["Anyone can read this DTU.", "It should appear in related results across users."],
        },
      },
      publicCtx,
    );
    assert.equal(publicDtu.ok, true, "public DTU creation must succeed");
    const publicId = publicDtu.dtu.id;

    const ownerRelated = await http.get(`/api/dtus/${ownerId}/related`, { userId: OWNER });
    assert.equal(ownerRelated.status, 200, JSON.stringify(ownerRelated.body));
    assert.equal(ownerRelated.body.ok, true);
    assert.equal(
      JSON.stringify(ownerRelated.body).includes("is not a function"),
      false,
      "response must not expose a missing-function error",
    );

    const relatedIds = (ownerRelated.body.related || []).map((r) => r.id);
    assert.ok(relatedIds.includes(publicId), "owner should see the readable same-tag public DTU");
    assert.equal(
      relatedIds.includes(otherId),
      false,
      "owner must not see another user's private DTU",
    );

    const anonRelated = await http.get(`/api/dtus/${ownerId}/related`);
    assert.equal(anonRelated.status, 404, "anonymous caller must get 404");

    const otherRelated = await http.get(`/api/dtus/${ownerId}/related`, { userId: OTHER });
    assert.equal(otherRelated.status, 404, "non-owner must get 404");
  });
});

describe("INC-111 cretiHuman stays fresh after title edit", () => {
  let runMacro, makeCtx, makeInternalCtx, STATE, db, http;

  before(async () => {
    ({ runMacro, makeCtx, makeInternalCtx, STATE, db } = await load());
    http = await startHttp({ STATE, db, runMacro, makeCtx });
  });

  after(async () => {
    await http?.close();
  });

  it("PATCH title regenerates cretiHuman beginning with the new title", async () => {
    const ctx = makeInternalCtx(OWNER);
    const created = await runMacro(
      "dtu",
      "create",
      { title: "Old title", source: "user", human: { summary: "A note" } },
      ctx,
    );
    assert.equal(created.ok, true, "DTU creation must succeed");
    const id = created.dtu.id;
    assert.ok(
      created.dtu.cretiHuman.startsWith("# Old title"),
      `fresh cretiHuman should start with created title, got: ${created.dtu.cretiHuman.slice(0, 80)}`,
    );

    const patched = await http.patch(`/api/dtus/${id}`, {
      userId: OWNER,
      body: { title: "New title" },
    });
    assert.equal(patched.status, 200, JSON.stringify(patched.body));
    assert.equal(patched.body.ok, true);
    assert.ok(
      patched.body.dtu.cretiHuman.startsWith("# New title"),
      `patched cretiHuman should start with new title, got: ${patched.body.dtu.cretiHuman.slice(0, 80)}`,
    );

    const fetched = await runMacro("dtu", "get", { id }, ctx);
    assert.equal(fetched.ok, true);
    assert.ok(
      fetched.dtu.cretiHuman.startsWith("# New title"),
      `stored cretiHuman should reflect new title, got: ${fetched.dtu.cretiHuman.slice(0, 80)}`,
    );
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

  // Mount helpers-extended with the same (incomplete) dependency shape as
  // production so that /related must survive without `dtusArray`.
  registerHelpersExtendedRoutes(app, {
    db,
    STATE,
    makeCtx,
    runMacro,
    saveStateDebounced: () => {},
    uid: (prefix) => `${prefix}_test`,
    requireAuth: passthrough,
    requireRole: () => passthrough(),
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

  async function request(method, path, opts = {}) {
    const headers = {};
    if (opts.userId) headers["x-test-user"] = opts.userId;
    if (opts.role) headers["x-test-role"] = opts.role;
    if (opts.body) headers["Content-Type"] = "application/json";
    const res = await fetch(`http://127.0.0.1:${port}${path}`, {
      method,
      headers,
      body: opts.body ? JSON.stringify(opts.body) : undefined,
    });
    const text = await res.text();
    let body = null;
    try {
      body = JSON.parse(text);
    } catch {
      body = { raw: text };
    }
    return { status: res.status, body };
  }

  return {
    get: (path, opts) => request("GET", path, opts),
    patch: (path, opts) => request("PATCH", path, opts),
    close: () => new Promise((resolve) => server.close(resolve)),
  };
}
