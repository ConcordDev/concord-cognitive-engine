// FIX-app-maker-001 S4 — the server preview data store + previewBridge.
// The store is session-scoped and ephemeral (the F1 data copy: app-maker
// tables are schema-only, so preview rows exist only inside a session).
// Pins cover the happy path, isolation, the owner gate, and every named
// refusal. Harness mirrors appmaker-lens-macros.test.js.
import { describe, it, before, beforeEach } from "node:test";
import assert from "node:assert/strict";
import registerAppmakerActions from "../domains/appmaker.js";

const ACTIONS = new Map();
function registerLensAction(domain, name, fn) {
  assert.equal(domain, "app-maker");
  ACTIONS.set(name, fn);
}
async function call(name, ctx, input = {}) {
  const fn = ACTIONS.get(name);
  if (!fn) throw new Error(`app-maker.${name} not registered`);
  const virtualArtifact = { id: null, domain: "app-maker", type: "domain_action", data: input || {}, meta: {} };
  return await fn(ctx, virtualArtifact, input || {});
}
const ctxA = { actor: { userId: "user_a" }, userId: "user_a" };
const ctxB = { actor: { userId: "user_b" }, userId: "user_b" };

before(() => { registerAppmakerActions(registerLensAction); });
beforeEach(() => {
  globalThis._concordSTATE = {};
  globalThis.fetch = async () => { throw new Error("network disabled in tests"); };
});

async function projectWithTable(ctx = ctxA) {
  const p = await call("projectCreate", ctx, { name: "Bridge App" });
  const proj = p.result.project;
  const t = await call("dataAddTable", ctx, { projectId: proj.id, name: "Customers" });
  const tableId = t.result.table.id;
  await call("dataSaveTable", ctx, {
    projectId: proj.id, tableId,
    fields: [{ name: "id", type: "text" }, { name: "name", type: "text" }, { name: "visits", type: "number" }],
  });
  return proj;
}
const bridge = (ctx, proj, over = {}) => call("previewBridge", ctx, {
  projectId: proj.id, sessionId: "pv_s1", action: "create_row", table: "Customers",
  config: { values: { name: "Ada", visits: 2 } }, ...over,
});

describe("app-maker previewBridge store (FIX-app-maker-001 S4)", () => {
  it("create_row stores declared fields, stamps an id, and returns the full row set", async () => {
    const proj = await projectWithTable();
    const r = await bridge(ctxA, proj);
    assert.equal(r.ok, true);
    assert.equal(r.result.rows.length, 1);
    assert.equal(r.result.rows[0].name, "Ada");
    assert.equal(r.result.rows[0].visits, 2);
    assert.ok(r.result.rows[0].id.startsWith("row_"));
    const r2 = await bridge(ctxA, proj, { config: { values: { name: "Grace" } } });
    assert.equal(r2.result.rows.length, 2);
  });

  it("sessions are isolated: a second session on the same project starts empty", async () => {
    const proj = await projectWithTable();
    await bridge(ctxA, proj);
    const other = await bridge(ctxA, proj, { sessionId: "pv_s2", config: { values: { name: "Only" } } });
    assert.equal(other.result.rows.length, 1);
    assert.equal(other.result.rows[0].name, "Only");
  });

  it("another user's project refuses at the owner gate", async () => {
    const proj = await projectWithTable(ctxA);
    const r = await bridge(ctxB, proj);
    assert.equal(r.ok, false);
    assert.equal(r.error, "project_not_found");
  });

  it("unknown table and unknown field are refused by name", async () => {
    const proj = await projectWithTable();
    const t = await bridge(ctxA, proj, { table: "Nope" });
    assert.equal(t.ok, false);
    assert.match(t.error, /no table named 'Nope'/);
    const f = await bridge(ctxA, proj, { config: { values: { name: "Ada", hacker: "x" } } });
    assert.equal(f.ok, false);
    assert.match(f.error, /unknown field 'hacker' for table 'Customers'/);
  });

  it("update_row patches and delete_row removes; both refuse a missing row by name", async () => {
    const proj = await projectWithTable();
    const c = await bridge(ctxA, proj);
    const id = c.result.rows[0].id;
    const u = await bridge(ctxA, proj, { action: "update_row", config: { id, values: { visits: 5 } } });
    assert.equal(u.ok, true);
    assert.equal(u.result.rows[0].visits, 5);
    assert.equal(u.result.rows[0].name, "Ada");
    const miss = await bridge(ctxA, proj, { action: "update_row", config: { id: "row_nope", values: { visits: 1 } } });
    assert.equal(miss.ok, false);
    assert.match(miss.error, /no row 'row_nope'/);
    const d = await bridge(ctxA, proj, { action: "delete_row", config: { id } });
    assert.equal(d.ok, true);
    assert.equal(d.result.rows.length, 0);
    const dMiss = await bridge(ctxA, proj, { action: "delete_row", config: { id } });
    assert.equal(dMiss.ok, false);
  });

  it("the 500-row cap refuses by name", async () => {
    const proj = await projectWithTable();
    let last;
    for (let i = 0; i < 500; i++) {
      last = await bridge(ctxA, proj, { config: { values: { name: `n${i}` } } });
      assert.equal(last.ok, true);
    }
    const over = await bridge(ctxA, proj, { config: { values: { name: "one too many" } } });
    assert.equal(over.ok, false);
    assert.match(over.error, /is full \(500 rows\)/);
  });

  it("previewSessionClose drops the session; the next bridge call starts empty", async () => {
    const proj = await projectWithTable();
    await bridge(ctxA, proj);
    const close = await call("previewSessionClose", ctxA, { projectId: proj.id, sessionId: "pv_s1" });
    assert.equal(close.ok, true);
    assert.equal(close.result.closed, true);
    const after = await bridge(ctxA, proj, { config: { values: { name: "Fresh" } } });
    assert.equal(after.result.rows.length, 1);
    assert.equal(after.result.rows[0].name, "Fresh");
  });

  it("a bad session id and a non-table action are refused", async () => {
    const proj = await projectWithTable();
    const bad = await bridge(ctxA, proj, { sessionId: "has spaces!" });
    assert.equal(bad.ok, false);
    assert.match(bad.error, /valid preview session id/);
    const act = await bridge(ctxA, proj, { action: "call_api" });
    assert.equal(act.ok, false);
    assert.match(act.error, /not a preview table action/);
  });
});
