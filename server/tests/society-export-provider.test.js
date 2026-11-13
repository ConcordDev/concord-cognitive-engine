// FIX-society-012: the Society lens export must include the caller's saved
// charts and the agent schedules its autonomy tab manages. Charts live in
// STATE.societyCharts (a share-id registry) and schedules in
// STATE.agentsLens.schedules — neither is a store the shared export's legs
// read — so society.js registers a lens export provider for them.
import { describe, it, before } from "node:test";
import assert from "node:assert/strict";

const { collectLensExport, hasLensExportProvider } = await import("../lib/lens-export.js");
const registerSocietyActions = (await import("../domains/society.js")).default;

const listMacro = async (domain, action) => {
  if (domain === "lens" && action === "list") return { ok: true, artifacts: [], total: 0 };
  if (domain === "dtu" && action === "list") return { ok: true, dtus: [] };
  return { ok: false, error: "unexpected_macro" };
};

describe("society export provider (FIX-society-012)", () => {
  before(() => {
    registerSocietyActions(() => {});
    globalThis._concordSTATE = {
      societyCharts: new Map([
        ["soc_a", { id: "soc_a", owner: "user-a", title: "Growth vs schooling", spec: { kind: "line" }, createdAt: "2026-11-01T00:00:00.000Z" }],
        ["soc_b", { id: "soc_b", owner: "user-b", title: "Someone else's chart", spec: { kind: "bar" }, createdAt: "2026-11-02T00:00:00.000Z" }],
      ]),
      agentsLens: {
        schedules: new Map([
          ["user-a", [{ id: "sched_1", agentId: "agent-1", agentName: "Milltown watcher", kind: "interval", spec: "60000", goal: "Watch the river gauge", enabled: true, createdAt: "2026-11-03T00:00:00.000Z", lastFiredAt: null, fireCount: 2 }]],
          ["user-b", [{ id: "sched_9", agentId: "agent-9", agentName: "Other agent", kind: "interval", spec: "1000", goal: "Not yours", enabled: true, createdAt: "2026-11-03T00:00:00.000Z", lastFiredAt: null, fireCount: 0 }]],
        ]),
      },
    };
  });

  it("registers a provider for the society domain", () => {
    assert.equal(hasLensExportProvider("society"), true);
  });

  it("exports the caller's charts and agent schedules", async () => {
    const out = await collectLensExport({
      runMacro: listMacro, domain: "society",
      ctx: { actor: { userId: "user-a" } },
    });
    assert.equal(out.ok, true);
    const byId = new Map(out.artifacts.map((r) => [r.id, r]));
    const chart = byId.get("soc_a");
    assert.ok(chart, "caller chart present");
    assert.equal(chart.type, "chart");
    assert.equal(chart.title, "Growth vs schooling");
    assert.equal(chart.data.permalink, "/lenses/society?chart=soc_a");
    const sched = byId.get("sched_1");
    assert.ok(sched, "caller agent schedule present");
    assert.equal(sched.type, "agent-schedule");
    assert.equal(sched.title, "Milltown watcher");
    assert.equal(sched.data.fireCount, 2);
  });

  it("never leaks another user's charts or schedules", async () => {
    const out = await collectLensExport({
      runMacro: listMacro, domain: "society",
      ctx: { actor: { userId: "user-a" } },
    });
    const ids = new Set(out.artifacts.map((r) => r.id));
    assert.equal(ids.has("soc_b"), false);
    assert.equal(ids.has("sched_9"), false);
  });

  it("exports nothing for an anonymous caller", async () => {
    const out = await collectLensExport({
      runMacro: listMacro, domain: "society", ctx: {},
    });
    assert.equal(out.artifacts.length, 0);
  });
});
