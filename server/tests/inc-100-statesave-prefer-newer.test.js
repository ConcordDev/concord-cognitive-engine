// INC-100 state-save: load prefers the newer of SQLite vs JSON by savedAt.
// Pure sort contract — mirrors loadStateFromDisk candidate ordering.
import { describe, it } from "node:test";
import assert from "node:assert/strict";

function pickNewest(candidates) {
  return [...candidates].sort((a, b) => String(b.savedAt).localeCompare(String(a.savedAt)))[0];
}

describe("INC-100 state-save prefer newer snapshot", () => {
  it("prefers JSON when its savedAt is later", () => {
    const pick = pickNewest([
      { source: "sqlite", savedAt: "2026-10-19T12:00:00.000Z" },
      { source: "json", savedAt: "2026-10-19T12:17:55.000Z" },
    ]);
    assert.equal(pick.source, "json");
  });

  it("prefers SQLite when its savedAt is later (critical/sync path)", () => {
    const pick = pickNewest([
      { source: "json", savedAt: "2026-10-19T12:00:00.000Z" },
      { source: "sqlite", savedAt: "2026-10-19T12:18:00.000Z" },
    ]);
    assert.equal(pick.source, "sqlite");
  });

  it("handles missing savedAt without throwing", () => {
    const pick = pickNewest([
      { source: "sqlite", savedAt: "" },
      { source: "json", savedAt: "2026-10-19T12:00:00.000Z" },
    ]);
    assert.equal(pick.source, "json");
  });
});
