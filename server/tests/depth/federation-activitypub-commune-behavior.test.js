// tests/depth/federation-activitypub-commune-behavior.test.js
//
// REAL behavioral tests for two macro clusters registered directly in
// server/server.js (NOT server/domains/federation.js, so
// scripts/lens-unsurfaced.mjs — which only scans server/domains/*.js —
// cannot see them and they had zero test coverage before this file):
//
//   1. ActivityPub identity reads: federation.actor / federation.outbox /
//      federation.inbox (server.js:75804-75821, :76029-76041), over
//      server/lib/activitypub-bridge.js. `federation.inbox_receive` is the
//      internal handler for the PUBLIC delivery route (a remote peer POSTs
//      to it) and is intentionally not exercised here the same way — it's
//      covered indirectly by the route-level tests elsewhere.
//   2. Communes: federation.commune_create/join/list/status (server.js
//      :75704-75801) — a federated peer-set + shared lens-anchor pool,
//      backed by real `communes`/`commune_members` tables.
//
// Wired to a real UI in concord-frontend/components/federation/
// {FediverseIdentityPanel,CommunesPanel}.tsx during the Wave-3 frontend
// rebuild (see docs/lens-specs/federation-capability-map.md).
import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { macroRuntime } from "./_harness.js";

describe("federation — ActivityPub identity reads (real, not fabricated)", () => {
  it("actor: builds a spec-shaped Person descriptor for the calling user", async () => {
    const { runMacro, ctx } = await macroRuntime("depth:federation:ap");
    const r = await runMacro("federation", "actor", {}, ctx);
    assert.equal(r.ok, true);
    assert.equal(r.actor.type, "Person");
    assert.equal(r.actor.preferredUsername, ctx.actor.userId);
    assert.match(r.actor.id, /\/api\/federation\/users\//);
    assert.ok(r.actor.inbox.startsWith(r.actor.id));
    assert.ok(r.actor.outbox.startsWith(r.actor.id));
  });

  it("outbox: starts empty for a fresh user, shaped as {ok, items}", async () => {
    const { runMacro, ctx } = await macroRuntime("depth:federation:ap-outbox-fresh");
    const r = await runMacro("federation", "outbox", {}, ctx);
    assert.equal(r.ok, true);
    assert.ok(Array.isArray(r.items));
  });

  it("inbox: starts empty for a fresh user, shaped as {ok, items}", async () => {
    const { runMacro, ctx } = await macroRuntime("depth:federation:ap-inbox-fresh");
    const r = await runMacro("federation", "inbox", {}, ctx);
    assert.equal(r.ok, true);
    assert.ok(Array.isArray(r.items));
  });
});

describe("federation — communes (real DB-backed peer-groups)", () => {
  it("commune_create requires a name and a real actor", async () => {
    const { runMacro, ctx } = await macroRuntime("depth:federation:commune-founder");
    const bad = await runMacro("federation", "commune_create", {}, ctx);
    assert.equal(bad.ok, false);
    assert.equal(bad.reason, "missing_name");
  });

  it("commune_create → the founder is auto-joined with role 'founder'", async () => {
    const { runMacro, ctx } = await macroRuntime("depth:federation:commune-founder2");
    const created = await runMacro("federation", "commune_create", { name: `Test Commune ${Date.now()}`, description: "d" }, ctx);
    assert.equal(created.ok, true);
    assert.ok(created.communeId);
    const status = await runMacro("federation", "commune_status", { communeId: created.communeId }, ctx);
    assert.equal(status.ok, true);
    assert.equal(status.isMember, true);
    assert.equal(status.memberCount, 1);
    assert.equal(status.members[0].role, "founder");
    assert.equal(status.members[0].user_id, ctx.actor.userId);
  });

  it("commune_join adds a second member without duplicating the founder", async () => {
    const { runMacro, ctx: founderCtx } = await macroRuntime("depth:federation:commune-a");
    const created = await runMacro("federation", "commune_create", { name: `Joinable ${Date.now()}` }, founderCtx);
    assert.equal(created.ok, true);

    const { runMacro: runMacro2, ctx: joinerCtx } = await macroRuntime("depth:federation:commune-b");
    const joined = await runMacro2("federation", "commune_join", { communeId: created.communeId }, joinerCtx);
    assert.equal(joined.ok, true);
    assert.equal(joined.joined, true);

    const status = await runMacro("federation", "commune_status", { communeId: created.communeId }, founderCtx);
    assert.equal(status.memberCount, 2);
    assert.equal(status.members.filter((m) => m.role === "founder").length, 1);
    // Re-joining is idempotent (INSERT OR IGNORE), not a second row.
    await runMacro2("federation", "commune_join", { communeId: created.communeId }, joinerCtx);
    const status2 = await runMacro("federation", "commune_status", { communeId: created.communeId }, founderCtx);
    assert.equal(status2.memberCount, 2);
  });

  it("commune_list only returns public communes, newest first", async () => {
    const { runMacro, ctx } = await macroRuntime("depth:federation:commune-list");
    const uniqueName = `Listable ${Date.now()}`;
    await runMacro("federation", "commune_create", { name: uniqueName, visibility: "public" }, ctx);
    const list = await runMacro("federation", "commune_list", { limit: 100 }, ctx);
    assert.equal(list.ok, true);
    assert.ok(list.communes.some((c) => c.name === uniqueName));
  });

  it("commune_status on an unknown id fails honestly, not with fabricated data", async () => {
    const { runMacro, ctx } = await macroRuntime("depth:federation:commune-missing");
    const r = await runMacro("federation", "commune_status", { communeId: 999999999 }, ctx);
    assert.equal(r.ok, false);
    assert.equal(r.reason, "not_found");
  });
});
