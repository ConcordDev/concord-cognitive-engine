// FIX-agriculture-005: the agriculture export must include the
// Workbench records — the caller's fields (with acreage and crop,
// the columns the ticket found missing) and scouting pins. They live
// in STATE.agricultureLens as nested per-user Maps the export's
// state leg cannot enumerate; agriculture.js registers a lens
// export provider over the store's own per-user buckets.
import { describe, it, before } from "node:test";
import assert from "node:assert/strict";

const { collectLensExport, hasLensExportProvider } = await import("../lib/lens-export.js");
const registerAgricultureActions = (await import("../domains/agriculture.js")).default;

const listMacro = async (domain, action) => {
  if (domain === "lens" && action === "list") return { ok: true, artifacts: [], total: 0 };
  if (domain === "dtu" && action === "list") return { ok: true, dtus: [] };
  return { ok: false, error: "unexpected_macro" };
};

describe("agriculture export provider (FIX-agriculture-005)", () => {
  before(() => {
    registerAgricultureActions(() => {});
    globalThis._concordSTATE = {
      agricultureLens: {
        fields: new Map([
          ["user-a", new Map([
            ["field_1", { id: "field_1", name: "North 40", acreage: 40.5, lat: 41.7, lng: -73.9, soilType: "loam", currentCrop: "corn", createdAt: "2026-11-01T00:00:00.000Z", updatedAt: "2026-11-02T00:00:00.000Z" }],
          ])],
          ["user-b", new Map([
            ["field_9", { id: "field_9", name: "Not yours", acreage: 3, lat: 0, lng: 0, soilType: "sand", currentCrop: "rye", createdAt: "2026-11-01T00:00:00.000Z", updatedAt: "2026-11-01T00:00:00.000Z" }],
          ])],
        ]),
        scouts: new Map([
          ["user-a", [{ id: "scout_1", fieldId: "field_1", note: "Aphids on the east edge", category: "pest", severity: "high", lat: 41.7, lng: -73.9, createdAt: "2026-11-03T00:00:00.000Z" }]],
        ]),
        rotations: new Map(),
      },
    };
  });

  it("registers a provider for the agriculture domain", () => {
    assert.equal(hasLensExportProvider("agriculture"), true);
  });

  it("exports the caller's fields with acreage and crop", async () => {
    const out = await collectLensExport({
      runMacro: listMacro, domain: "agriculture",
      ctx: { actor: { userId: "user-a" } },
    });
    const field = out.artifacts.find((r) => r.type === "field");
    assert.ok(field, "field row present");
    assert.equal(field.title, "North 40");
    assert.equal(field.data.acreage, 40.5);
    assert.equal(field.data.currentCrop, "corn");
    assert.equal(field.data.soilType, "loam");
  });

  it("exports the caller's scouting pins", async () => {
    const out = await collectLensExport({
      runMacro: listMacro, domain: "agriculture",
      ctx: { actor: { userId: "user-a" } },
    });
    const pin = out.artifacts.find((r) => r.type === "scouting-pin");
    assert.ok(pin, "pin row present");
    assert.equal(pin.data.fieldId, "field_1");
    assert.equal(pin.data.category, "pest");
    assert.equal(pin.data.severity, "high");
  });

  it("never leaks another farmer's fields", async () => {
    const out = await collectLensExport({
      runMacro: listMacro, domain: "agriculture",
      ctx: { actor: { userId: "user-a" } },
    });
    assert.equal(out.artifacts.some((r) => r.id === "field_9"), false);
  });

  it("exports nothing for an anonymous caller", async () => {
    const out = await collectLensExport({
      runMacro: listMacro, domain: "agriculture", ctx: {},
    });
    assert.equal(out.artifacts.length, 0);
  });
});
