// Records the owner just created must reload.
// Hermetic: imports the domain modules directly. Does not boot server.js.
import { describe, it, before } from "node:test";
import assert from "node:assert/strict";
import registerParenting from "../domains/parenting.js";
import registerProductivity from "../domains/productivity.js";
import registerAppmaker from "../domains/appmaker.js";
import registerArtistry from "../domains/artistry.js";
import registerMl from "../domains/ml.js";

const ACTIONS = new Map();
function registerLensAction(domain, name, fn) {
  ACTIONS.set(`${domain}.${name}`, fn);
}
before(() => {
  registerParenting(registerLensAction);
  registerProductivity(registerLensAction);
  registerAppmaker(registerLensAction);
  registerArtistry(registerLensAction);
  registerMl(registerLensAction);
});

function ctxFor(userId) {
  return { actor: { userId }, userId };
}
async function call(domain, name, ctx, input = {}) {
  const fn = ACTIONS.get(`${domain}.${name}`);
  if (!fn) throw new Error(`${domain}.${name} not registered`);
  const artifact = { id: null, domain, type: "domain_action", data: { ...(input || {}) }, meta: {} };
  return fn(ctx, artifact, input || {});
}

describe("wave 2 — a logged row stays on the owner's history", () => {
  it("parenting feed-log rejects an unparseable at instead of hiding the row", async () => {
    globalThis._concordSTATE = {};
    const ctx = ctxFor("user-parent");
    const child = await call("parenting", "child-add", ctx, { name: "Ada", birthDate: "2024-01-01" });
    assert.equal(child.ok, true);
    const childId = child.result.child.id;
    const bad = await call("parenting", "feed-log", ctx, { childId, kind: "bottle", amountMl: 80, at: "not a time" });
    assert.equal(bad.ok, false);
    assert.equal(bad.error, "invalid_input");
    assert.equal(bad.field, "at");
    const hist = await call("parenting", "feed-history", ctx, { childId, days: 7 });
    assert.equal(hist.result.count, 0);
  });

  it("parenting pump-history still lists a legacy row whose at does not parse", async () => {
    globalThis._concordSTATE = {};
    const ctx = ctxFor("user-pump");
    const ok = await call("parenting", "pump-log", ctx, { amountMl: 40, side: "left", durationMin: 5 });
    assert.equal(ok.ok, true);
    const s = globalThis._concordSTATE.parentingLens;
    s.pumps.get("user-pump").push({ id: "pmp_legacy", amountMl: 5, side: "both", durationMin: 1, at: "not-a-time" });
    const hist = await call("parenting", "pump-history", ctx, { days: 7 });
    const ids = hist.result.entries.map((e) => e.id);
    assert.ok(ids.includes(ok.result.entry.id));
    assert.ok(ids.includes("pmp_legacy"));
  });
});

describe("wave 2 — taskCreate lands in the task store task-list reads", () => {
  it("create then list then delete by the returned id", async () => {
    globalThis._concordSTATE = {};
    const ctx = ctxFor("user-tasks");
    const created = await call("productivity", "taskCreate", ctx, { title: "Buy milk", priority: 2, dueDate: "2026-11-05" });
    assert.equal(created.ok, true);
    const id = created.result.task.id;
    assert.match(id, /^tsk_/);
    const list = await call("productivity", "task-list", ctx, {});
    assert.ok(list.result.tasks.some((t) => t.id === id && t.content === "Buy milk"));
    const del = await call("productivity", "task-delete", ctx, { id });
    assert.equal(del.ok, true);
    const after = await call("productivity", "task-list", ctx, {});
    assert.equal(after.result.tasks.some((t) => t.id === id), false);
  });
});

describe("wave 2 — get and delete accept the id create returned", () => {
  it("app-maker projectGet and projectDelete accept id", async () => {
    globalThis._concordSTATE = {};
    const ctx = ctxFor("user-app");
    const created = await call("app-maker", "projectCreate", ctx, { name: "Ledger" });
    const id = created.result.project.id;
    const got = await call("app-maker", "projectGet", ctx, { id });
    assert.equal(got.ok, true);
    assert.equal(got.result.project.id, id);
    const del = await call("app-maker", "projectDelete", ctx, { id });
    assert.equal(del.ok, true);
    const missing = await call("app-maker", "projectGet", ctx, { id });
    assert.equal(missing.ok, false);
    assert.equal(missing.error, "project_not_found");
  });

  it("app-maker questGraphGet accepts id", async () => {
    globalThis._concordSTATE = {};
    const ctx = ctxFor("user-quest");
    const created = await call("app-maker", "questGraphCreate", ctx, { title: "Opening" });
    const id = created.result.graph.id;
    const got = await call("app-maker", "questGraphGet", ctx, { id });
    assert.equal(got.ok, true);
    assert.equal(got.result.graph.id, id);
  });

  it("artistry projectDelete accepts id", async () => {
    globalThis._concordSTATE = {};
    const ctx = ctxFor("user-art");
    const created = await call("artistry", "projectCreate", ctx, { title: "Study" });
    assert.equal(created.ok, true);
    const id = created.result.project.id;
    const del = await call("artistry", "projectDelete", ctx, { id });
    assert.equal(del.ok, true);
    assert.equal(del.result.deleted, true);
    const listed = await call("artistry", "projectList", ctx, {});
    assert.equal(listed.ok, true);
    const ids = (listed.result.projects || listed.result.list || []).map((p) => p.id);
    assert.equal(ids.includes(id), false);
    const again = await call("artistry", "projectDelete", ctx, { id });
    assert.equal(again.ok, false);
    assert.equal(again.error, "project_not_found");
  });

  it("ml space-get accepts the space id create returned", async () => {
    globalThis._concordSTATE = {};
    const ctx = ctxFor("user-ml");
    const created = await call("ml", "space-create", ctx, { title: "Demo", modelId: "org/model" });
    assert.equal(created.ok, true);
    const id = created.result.space.id;
    const got = await call("ml", "space-get", ctx, { id });
    assert.equal(got.ok, true);
    assert.equal(got.result.space.id, id);
    assert.equal(got.result.isOwner, true);
  });
});
