/**
 * FIX-ingest-009: the dedup config's strategy + threshold were stored
 * but never applied — every sync deduped by exact-content hash, so the
 * panel's controls were decorative. Pins the engine the sync path now
 * runs: exact / key-field / semantic-hash with a real threshold.
 */
import { describe, it, expect } from "vitest";
import registerIngestActions, { getApplyDedup } from "../domains/ingest.js";

registerIngestActions(() => {});
const applyDedup = getApplyDedup();
if (!applyDedup) throw new Error("dedup engine not registered");

const a = { id: "1", title: "Quarterly report", body: "revenue grew ten percent this quarter" };
const aReordered = { body: "revenue grew ten percent this quarter", title: "Quarterly report", id: "1" };
const aEdited = { id: "2", title: "Quarterly report", body: "revenue grew ten percent this quarter overall" };
const other = { id: "3", title: "Hiring plan", body: "two engineers join next month" };

describe("applyDedup strategies", () => {
  it("exact: key order does not matter, an edited copy is kept", () => {
    const r = applyDedup([a, aReordered, aEdited], { enabled: true, strategy: "exact", threshold: 1 });
    expect(r.removed).toBe(1);
    expect(r.kept).toHaveLength(2);
  });
  it("key-field: same key value dedupes, missing key is kept", () => {
    const r = applyDedup([a, { ...other, id: "1" }, { title: "No id" }], { enabled: true, strategy: "key-field", keyField: "id", threshold: 1 });
    expect(r.removed).toBe(1);
    expect(r.kept).toHaveLength(2);
  });
  it("semantic-hash: threshold decides whether a lightly edited copy is a duplicate", () => {
    const strict = applyDedup([a, aEdited], { enabled: true, strategy: "semantic-hash", threshold: 1 });
    expect(strict.removed).toBe(0);
    const loose = applyDedup([a, aEdited], { enabled: true, strategy: "semantic-hash", threshold: 0.75 });
    expect(loose.removed).toBe(1);
    const unrelated = applyDedup([a, other], { enabled: true, strategy: "semantic-hash", threshold: 0.75 });
    expect(unrelated.removed).toBe(0);
  });
  it("disabled: nothing is removed", () => {
    const r = applyDedup([a, aReordered], { enabled: false, strategy: "exact", threshold: 1 });
    expect(r.removed).toBe(0);
    expect(r.kept).toHaveLength(2);
  });
});
