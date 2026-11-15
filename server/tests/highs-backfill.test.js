import { describe, it, before, beforeEach } from "node:test";
import assert from "node:assert/strict";
import registerAnalytics from "../domains/analytics.js";
import registerMath from "../domains/math.js";
import registerPaper from "../domains/paper.js";
import registerEntity from "../domains/entity.js";
import { registerWebhook, listWebhooks } from "../emergent/public-api.js";

const actions = new Map();
function register(domain, name, fn) { actions.set(`${domain}.${name}`, fn); }
function call(domain, name, params = {}, artifact = { id: null, data: {}, meta: {} }) {
  const fn = actions.get(`${domain}.${name}`);
  assert.ok(fn, `${domain}.${name}`);
  return fn({ actor: { userId: "owner" }, userId: "owner" }, artifact, params);
}

before(() => {
  registerAnalytics(register);
  registerMath(register);
  registerPaper(register);
  registerEntity(register);
});
beforeEach(() => {
  globalThis._concordSTATE = { dtus: new Map() };
  globalThis._concordSaveStateDebounced = () => {};
});

describe("backfill for the phone, feed, and export fixes", () => {
  it("refuses a dashboard name longer than 100 characters", () => {
    const bad = call("analytics", "dashboard-save", { name: "n".repeat(300), widgets: [] });
    assert.equal(bad.ok, false);
    assert.match(bad.error, /at most 100/);
    const ok = call("analytics", "dashboard-save", { name: "Signups", widgets: [] });
    assert.equal(ok.ok, true);
    assert.equal(ok.result.dashboard.name, "Signups");
  });

  it("answers a 2-inch drain slope in inches per foot", () => {
    const r = call("math", "naturalQuery", { query: "what is the slope for a 2 inch drain" });
    assert.equal(r.ok, true);
    assert.equal(r.result.kind, "drain-slope");
    assert.equal(r.result.answer, "0.25 inches per foot");
  });

  it("exports a paper as a PDF that includes the body", () => {
    const r = call("paper", "export_pdf", {}, {
      id: "p1",
      title: "Slope Notes",
      data: { abstract: "Short.", body: "The body paragraph." },
      meta: {},
    });
    assert.equal(r.ok, true);
    assert.equal(r.result.format, "pdf");
    assert.ok(r.result.filename.endsWith(".pdf"));
    assert.ok(r.result.content.includes("The body paragraph."));
    assert.ok(r.result.content.startsWith("%PDF-1.4"));
  });

  it("drops a relation that points at a deleted node by target id", () => {
    const a = call("entity", "node-create", { name: "Ada" }).result.node;
    const b = call("entity", "node-create", { name: "Bea" }).result.node;
    const edge = call("entity", "edge-create", { from: a.id, to: b.id, relType: "knows" });
    assert.equal(edge.ok, true);
    const dtu = globalThis._concordSTATE.dtus.get(a.id);
    dtu.relations.push({ target: b.id, type: "legacy" });
    assert.equal(call("entity", "node-delete", { id: b.id }).ok, true);
    const left = (globalThis._concordSTATE.dtus.get(a.id).relations || []).filter((rel) => rel.to === b.id || rel.target === b.id);
    assert.equal(left.length, 0);
  });

  it("stores a webhook and lists it for the owner", () => {
    const state = {};
    const made = registerWebhook(state, { url: "https://example.com/hook", events: ["dtu:created"], ownerId: "owner" });
    assert.equal(made.ok, true);
    const listed = listWebhooks(state, "owner");
    assert.equal(listed.total, 1);
    assert.equal(listed.webhooks[0].url, "https://example.com/hook");
    assert.equal(registerWebhook(state, { url: "not a url", events: ["dtu:created"], ownerId: "owner" }).ok, false);
  });
});
