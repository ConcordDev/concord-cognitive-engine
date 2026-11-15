// HV-03 pin (Mega Plan v2, Track A): the export-leak convergence proof's
// behavioural half. The 2026-11-09 hotfix (7d522b454) stopped lens export
// leaking private activity as public system mirrors; the CB-0588/0589/0590
// owner-scoped ruling line then made a personal export carry ONLY the
// caller's own rows. This pin states the security property end-to-end
// through collectLensExport, across BOTH legs (lens.list artifacts + the
// caller's-DTU leg):
//
//   user B's export holds NO row owned by user A — public or private —
//   and NO system mirror of A's private DTU.
//
// On dae9e10a6 (main's pre-hotfix head) the artifacts leg carried every
// row to every caller, so this suite fails there; on the sweep head it
// passes. See audit/harvest/HOTFIX-CONVERGE.md.
import { describe, it } from "node:test";
import assert from "node:assert/strict";

const { collectLensExport, _clearLensExportProvidersForTests } = await import("../lib/lens-export.js");

const A = "user-a";
const B = "user-b";

function runMacroStub() {
  return async (domain, action) => {
    if (domain === "lens" && action === "list") {
      return {
        ok: true,
        total: 4,
        artifacts: [
          { id: "b-own", type: "note", title: "B's own note", ownerId: B, meta: { visibility: "private" }, data: {} },
          { id: "a-own-private", type: "note", title: "A's private note", ownerId: A, meta: { visibility: "private" }, data: {} },
          { id: "a-own-public", type: "note", title: "A's public note", ownerId: A, meta: { visibility: "public" }, data: {} },
          {
            // The hotfix's leak shape: A's private DTU exhaust, mirrored
            // as a public system artifact by dtu-auto-sync.
            id: "dtu_lens_notes_a-private-dtu",
            type: "regular",
            title: "Lens:notes draft",
            ownerId: "system",
            meta: { visibility: "public", createdFrom: "dtu-auto-sync" },
            data: { dtuId: "a-private-dtu", summary: "A's secret draft text" },
          },
        ],
      };
    }
    if (domain === "dtu" && action === "list") {
      return {
        ok: true,
        dtus: [
          { id: "a-private-dtu", title: "A's private DTU", author: A },
          { id: "b-dtu", title: "B's own DTU", author: B },
        ],
      };
    }
    return { ok: false, error: "unexpected" };
  };
}

describe("sec-export-no-foreign-rows (HV-03)", () => {
  it("user B's export holds no row owned by A and no system mirror of A's private DTU", async () => {
    _clearLensExportProvidersForTests();
    const out = await collectLensExport({
      runMacro: runMacroStub(),
      domain: "notes",
      ctx: { actor: { userId: B } },
    });
    assert.equal(out.ok, true);
    const ids = out.artifacts.map((a) => a.id);
    assert.ok(ids.includes("b-own"), "B's own artifact rides B's export");
    assert.ok(ids.includes("b-dtu"), "B's own DTU rides B's export");
    assert.ok(!ids.includes("a-own-private"), "A's private row never rides B's export");
    assert.ok(!ids.includes("a-own-public"), "A's public row never rides B's PERSONAL export (owner-scoped contract)");
    assert.ok(!ids.includes("dtu_lens_notes_a-private-dtu"), "the system mirror of A's private DTU never rides B's export");
    assert.ok(!ids.includes("a-private-dtu"), "A's private DTU itself never rides B's export");
    const serialized = JSON.stringify(out.artifacts);
    assert.ok(!serialized.includes("A's secret draft text"), "the mirrored private content itself is absent");
    assert.ok(!serialized.includes("A's private note"), "A's private title is absent");
  });

  it("the property is symmetric: A's export holds none of B's rows", async () => {
    _clearLensExportProvidersForTests();
    const out = await collectLensExport({
      runMacro: runMacroStub(),
      domain: "notes",
      ctx: { actor: { userId: A } },
    });
    assert.equal(out.ok, true);
    const ids = out.artifacts.map((a) => a.id);
    assert.ok(ids.includes("a-own-private") && ids.includes("a-private-dtu"), "A's own rows ride A's export");
    assert.ok(!ids.includes("b-own") && !ids.includes("b-dtu"), "B's rows never ride A's export");
    assert.ok(!ids.includes("dtu_lens_notes_a-private-dtu"), "the system mirror does not ride even A's export — the mirror is not A's row");
  });
});
