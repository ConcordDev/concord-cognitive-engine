// FIX-global-012: the Global lens export must include the caller's saved
// views. They live in STATE.globalSavedViews — a top-level state key the
// shared export's state leg never reads — so global.js registers a lens
// export provider for them.
import { describe, it, before } from "node:test";
import assert from "node:assert/strict";

const { collectLensExport, hasLensExportProvider } = await import("../lib/lens-export.js");
const registerGlobalActions = (await import("../domains/global.js")).default;

const listMacro = async (domain, action) => {
  if (domain === "lens" && action === "list") return { ok: true, artifacts: [], total: 0 };
  if (domain === "dtu" && action === "list") return { ok: true, dtus: [] };
  return { ok: false, error: "unexpected_macro" };
};

describe("global export provider (FIX-global-012)", () => {
  before(() => {
    registerGlobalActions(() => {});
    globalThis._concordSTATE = {
      globalSavedViews: new Map([
        ["user-a", [
          { id: "gv_1", mode: "choropleth", label: "Literacy by country", config: { indicator: "literacy" }, createdAt: "2026-11-01T00:00:00.000Z" },
          { id: "gv_2", mode: "bubble", label: "Wealth vs health", config: {}, createdAt: "2026-11-02T00:00:00.000Z" },
        ]],
        ["user-b", [
          { id: "gv_9", mode: "line", label: "Someone else's view", config: {}, createdAt: "2026-11-03T00:00:00.000Z" },
        ]],
      ]),
    };
  });

  it("registers a provider for the global domain", () => {
    assert.equal(hasLensExportProvider("global"), true);
  });

  it("exports the caller's saved views with mode, config and share link", async () => {
    const out = await collectLensExport({
      runMacro: listMacro, domain: "global",
      ctx: { actor: { userId: "user-a" } },
    });
    assert.equal(out.ok, true);
    const byId = new Map(out.artifacts.map((r) => [r.id, r]));
    const first = byId.get("gv_1");
    assert.ok(first, "first saved view present");
    assert.equal(first.type, "saved-view");
    assert.equal(first.title, "Literacy by country");
    assert.equal(first.data.mode, "choropleth");
    assert.equal(first.data.config.indicator, "literacy");
    assert.equal(first.data.shareLink, "/lenses/global?view=gv_1");
    assert.ok(byId.get("gv_2"), "second saved view present");
  });

  it("never leaks another user's saved views", async () => {
    const out = await collectLensExport({
      runMacro: listMacro, domain: "global",
      ctx: { actor: { userId: "user-a" } },
    });
    assert.equal(out.artifacts.some((r) => r.id === "gv_9"), false);
  });

  it("exports nothing for an anonymous caller", async () => {
    const out = await collectLensExport({
      runMacro: listMacro, domain: "global", ctx: {},
    });
    assert.equal(out.artifacts.length, 0);
  });
});
