// FIX-genesis-008: the Genesis lens export must include the caller's saved
// searches. They live on STATE.genesisSavedSearches — a top-level state key
// the shared export's state leg never reads (it reads STATE.<domain>Lens
// bags) — so genesis.js registers a lens export provider for them.
import { describe, it, before } from "node:test";
import assert from "node:assert/strict";

const { collectLensExport, hasLensExportProvider } = await import("../lib/lens-export.js");
const registerGenesisActions = (await import("../domains/genesis.js")).default;

const listMacro = async (domain, action) => {
  if (domain === "lens" && action === "list") return { ok: true, artifacts: [], total: 0 };
  if (domain === "dtu" && action === "list") return { ok: true, dtus: [] };
  return { ok: false, error: "unexpected_macro" };
};

describe("genesis export provider (FIX-genesis-008)", () => {
  before(() => {
    registerGenesisActions(() => {});
    globalThis._concordSTATE = {
      genesisSavedSearches: new Map([
        ["user-a", [
          { id: "gs_1", label: "Builders in crisis worlds", filters: { query: "builder", role: "", state: "active", focus: "crisis" }, createdAt: 111 },
          { id: "gs_2", label: "Idle poets", filters: { query: "", role: "poet", state: "idle", focus: "" }, createdAt: 222 },
        ]],
        ["user-b", [
          { id: "gs_9", label: "Someone else's preset", filters: { query: "x", role: "", state: "all", focus: "" }, createdAt: 333 },
        ]],
      ]),
    };
  });

  it("registers a provider for the genesis domain", () => {
    assert.equal(hasLensExportProvider("genesis"), true);
  });

  it("exports the caller's saved searches with their filters", async () => {
    const out = await collectLensExport({
      runMacro: listMacro, domain: "genesis",
      ctx: { actor: { userId: "user-a" } },
    });
    assert.equal(out.ok, true);
    const byId = new Map(out.artifacts.map((r) => [r.id, r]));
    const first = byId.get("gs_1");
    assert.ok(first, "first saved search present");
    assert.equal(first.type, "saved-search");
    assert.equal(first.title, "Builders in crisis worlds");
    assert.equal(first.data.filters.focus, "crisis");
    assert.ok(byId.get("gs_2"), "second saved search present");
  });

  it("never leaks another user's saved searches", async () => {
    const out = await collectLensExport({
      runMacro: listMacro, domain: "genesis",
      ctx: { actor: { userId: "user-a" } },
    });
    assert.equal(out.artifacts.some((r) => r.id === "gs_9"), false);
  });

  it("exports nothing for an anonymous caller", async () => {
    const out = await collectLensExport({
      runMacro: listMacro, domain: "genesis", ctx: {},
    });
    assert.equal(out.artifacts.length, 0);
  });
});
