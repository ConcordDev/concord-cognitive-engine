// tests/depth/offline-filtered-replication-behavior.test.js — REAL behavioral
// tests for the offline domain's new filtered/scoped replication feature
// (WAVE4_INVENTORY row 254 / docs/lens-specs/offline-capability-map.md
// "Filtered/scoped replication ... GENUINELY MISSING" gap-closure).
//
// Boots the real server (via ./_harness.js#lensRun) and drives the actual
// production dispatch path: registerLensAction("offline", ...) →
// LENS_ACTIONS → the "lens.run" macro → runMacro("lens","run", ...). This is
// the SAME wiring `/api/lens/run` uses in production (confirmed live:
// LENS_ACTIONS.has("offline.filterCreate") === true after a real boot), so
// these tests exercise the whole real path, not just the domain module in
// isolation.
//
// `lens.run` unwraps a handler's `{ok:true, result:{...}}` return to
// `r.result = {...}` directly (dropping the inner `ok`), but does NOT unwrap
// an `{ok:false, error:...}` return (no `result` key to unwrap) — so error
// assertions check `r.result.ok === false` / `r.result.error`, matching the
// established idiom across this directory (see accounting-behavior.test.js).
import { describe, it, before } from "node:test";
import assert from "node:assert/strict";
import { lensRun, depthCtx } from "./_harness.js";

describe("offline filtered replication — filterCreate/filterList/filterDelete", () => {
  let ctx;
  before(async () => { ctx = await depthCtx("depth:offline:filters"); });

  it("creates a collection filter, lists it back, then deletes it (round trip)", async () => {
    const created = await lensRun("offline", "filterCreate", {
      params: { name: "notes only", collection: "note" },
    }, ctx);
    assert.equal(created.ok, true);
    assert.ok(created.result.filter.id.startsWith("filter_"));
    assert.equal(created.result.filter.name, "notes only");
    assert.equal(created.result.filter.collection, "note");
    assert.deepEqual(created.result.filter.fieldMatch, []);
    assert.ok(created.result.filter.createdAt);

    const listed = await lensRun("offline", "filterList", { params: {} }, ctx);
    assert.equal(listed.ok, true);
    assert.ok(listed.result.filters.some((f) => f.id === created.result.filter.id));

    const deleted = await lensRun("offline", "filterDelete", {
      params: { id: created.result.filter.id },
    }, ctx);
    assert.equal(deleted.ok, true);
    assert.equal(deleted.result.deleted, true);

    const listedAfter = await lensRun("offline", "filterList", { params: {} }, ctx);
    assert.equal(listedAfter.result.filters.some((f) => f.id === created.result.filter.id), false);
  });

  it("creates a fieldMatch filter with real predicate conditions", async () => {
    const created = await lensRun("offline", "filterCreate", {
      params: {
        name: "shopping items",
        fieldMatch: [{ field: "tag", op: "eq", value: "shopping" }],
      },
    }, ctx);
    assert.equal(created.ok, true);
    assert.equal(created.result.filter.collection, null);
    assert.equal(created.result.filter.fieldMatch.length, 1);
    assert.equal(created.result.filter.fieldMatch[0].field, "tag");
    assert.equal(created.result.filter.fieldMatch[0].op, "eq");
    assert.equal(created.result.filter.fieldMatch[0].value, "shopping");
  });

  it("rejects a filter with neither collection nor fieldMatch (ambiguous no-op)", async () => {
    const r = await lensRun("offline", "filterCreate", { params: { name: "empty" } }, ctx);
    assert.equal(r.result.ok, false);
    assert.match(r.result.error, /collection.*fieldMatch|fieldMatch.*collection/);
  });

  it("rejects a filter with no name", async () => {
    const r = await lensRun("offline", "filterCreate", { params: { collection: "note" } }, ctx);
    assert.equal(r.result.ok, false);
    assert.match(r.result.error, /name required/);
  });

  it("silently drops a malformed fieldMatch condition (bad op) rather than accepting it", async () => {
    const r = await lensRun("offline", "filterCreate", {
      params: {
        name: "bad op",
        fieldMatch: [{ field: "tag", op: "regex_explode", value: "x" }, { field: "tag", op: "eq", value: "y" }],
      },
    }, ctx);
    assert.equal(r.ok, true);
    // Only the valid condition survives — the invalid op is dropped, not
    // silently coerced into an always-true/always-false predicate.
    assert.equal(r.result.filter.fieldMatch.length, 1);
    assert.equal(r.result.filter.fieldMatch[0].op, "eq");
  });

  it("honestly rejects deleting an unknown filter id", async () => {
    const r = await lensRun("offline", "filterDelete", { params: { id: "filter_does_not_exist" } }, ctx);
    assert.equal(r.result.ok, false);
    assert.equal(r.result.error, "filter_not_found");
  });

  it("filters are isolated per user — user B cannot delete or resolve user A's filter", async () => {
    const ctxA = await depthCtx("depth:offline:filters:userA");
    const ctxB = await depthCtx("depth:offline:filters:userB");
    const created = await lensRun("offline", "filterCreate", {
      params: { name: "A's filter", collection: "note" },
    }, ctxA);
    assert.equal(created.ok, true);

    const bListed = await lensRun("offline", "filterList", { params: {} }, ctxB);
    assert.equal(bListed.result.filters.some((f) => f.id === created.result.filter.id), false);

    const bDelete = await lensRun("offline", "filterDelete", {
      params: { id: created.result.filter.id },
    }, ctxB);
    assert.equal(bDelete.result.ok, false);
    assert.equal(bDelete.result.error, "filter_not_found");

    // The filter is untouched from A's perspective.
    const aListed = await lensRun("offline", "filterList", { params: {} }, ctxA);
    assert.equal(aListed.result.filters.some((f) => f.id === created.result.filter.id), true);
  });
});

describe("offline filtered replication — replicationPull with filterId (real predicate evaluation)", () => {
  it("a collection filter includes only matching real documents and excludes the rest", async () => {
    const ctx = await depthCtx("depth:offline:pull:collection");
    await lensRun("offline", "replicationPush", {
      params: {
        docs: [
          { id: "note:1", body: { title: "groceries", tag: "shopping" } },
          { id: "note:2", body: { title: "taxes", tag: "finance" } },
          { id: "task:1", body: { title: "walk dog", tag: "shopping" } },
        ],
      },
    }, ctx);
    const filter = await lensRun("offline", "filterCreate", {
      params: { name: "notes", collection: "note" },
    }, ctx);

    const pulled = await lensRun("offline", "replicationPull", {
      params: { since: 0, filterId: filter.result.filter.id },
    }, ctx);
    assert.equal(pulled.ok, true);
    assert.equal(pulled.result.changes.length, 2);
    const ids = pulled.result.changes.map((c) => c.id).sort();
    assert.deepEqual(ids, ["note:1", "note:2"]);
    // Real assertion against real document content, not just a count.
    const note1 = pulled.result.changes.find((c) => c.id === "note:1");
    assert.deepEqual(note1.doc, { title: "groceries", tag: "shopping" });
    const note2 = pulled.result.changes.find((c) => c.id === "note:2");
    assert.deepEqual(note2.doc, { title: "taxes", tag: "finance" });
    // The non-matching document is genuinely excluded, not merely reordered.
    assert.equal(pulled.result.changes.some((c) => c.id === "task:1"), false);
    assert.equal(pulled.result.filterId, filter.result.filter.id);
  });

  it("a fieldMatch filter (eq) includes only documents whose real field matches", async () => {
    const ctx = await depthCtx("depth:offline:pull:fieldmatch-eq");
    await lensRun("offline", "replicationPush", {
      params: {
        docs: [
          { id: "item:1", body: { tag: "shopping", price: 12 } },
          { id: "item:2", body: { tag: "finance", price: 999 } },
          { id: "item:3", body: { tag: "shopping", price: 4 } },
        ],
      },
    }, ctx);
    const filter = await lensRun("offline", "filterCreate", {
      params: { name: "shopping tag", fieldMatch: [{ field: "tag", op: "eq", value: "shopping" }] },
    }, ctx);
    const pulled = await lensRun("offline", "replicationPull", {
      params: { since: 0, filterId: filter.result.filter.id },
    }, ctx);
    assert.equal(pulled.result.changes.length, 2);
    assert.deepEqual(pulled.result.changes.map((c) => c.id).sort(), ["item:1", "item:3"]);
  });

  it("a fieldMatch filter (gt/lt/contains) evaluates real numeric and array fields", async () => {
    const ctx = await depthCtx("depth:offline:pull:fieldmatch-numeric");
    await lensRun("offline", "replicationPush", {
      params: {
        docs: [
          { id: "order:1", body: { total: 150, labels: ["urgent", "b2b"] } },
          { id: "order:2", body: { total: 40, labels: ["low-priority"] } },
          { id: "order:3", body: { total: 200, labels: ["b2b"] } },
        ],
      },
    }, ctx);
    const gtFilter = await lensRun("offline", "filterCreate", {
      params: { name: "big orders", fieldMatch: [{ field: "total", op: "gt", value: 100 }] },
    }, ctx);
    const gtPull = await lensRun("offline", "replicationPull", {
      params: { since: 0, filterId: gtFilter.result.filter.id },
    }, ctx);
    assert.deepEqual(gtPull.result.changes.map((c) => c.id).sort(), ["order:1", "order:3"]);

    const ltFilter = await lensRun("offline", "filterCreate", {
      params: { name: "small orders", fieldMatch: [{ field: "total", op: "lt", value: 100 }] },
    }, ctx);
    const ltPull = await lensRun("offline", "replicationPull", {
      params: { since: 0, filterId: ltFilter.result.filter.id },
    }, ctx);
    assert.deepEqual(ltPull.result.changes.map((c) => c.id), ["order:2"]);

    const containsFilter = await lensRun("offline", "filterCreate", {
      params: { name: "b2b orders", fieldMatch: [{ field: "labels", op: "contains", value: "b2b" }] },
    }, ctx);
    const containsPull = await lensRun("offline", "replicationPull", {
      params: { since: 0, filterId: containsFilter.result.filter.id },
    }, ctx);
    assert.deepEqual(containsPull.result.changes.map((c) => c.id).sort(), ["order:1", "order:3"]);
  });

  it("combining collection + fieldMatch requires BOTH predicates to match", async () => {
    const ctx = await depthCtx("depth:offline:pull:combined");
    await lensRun("offline", "replicationPush", {
      params: {
        docs: [
          { id: "note:1", body: { tag: "shopping" } },
          { id: "note:2", body: { tag: "finance" } },
          { id: "task:1", body: { tag: "shopping" } },
        ],
      },
    }, ctx);
    const filter = await lensRun("offline", "filterCreate", {
      params: { name: "shopping notes", collection: "note", fieldMatch: [{ field: "tag", op: "eq", value: "shopping" }] },
    }, ctx);
    const pulled = await lensRun("offline", "replicationPull", {
      params: { since: 0, filterId: filter.result.filter.id },
    }, ctx);
    // note:2 fails fieldMatch, task:1 fails collection — only note:1 survives.
    assert.deepEqual(pulled.result.changes.map((c) => c.id), ["note:1"]);
  });

  it("an honest empty-match filter returns zero results, not an error", async () => {
    const ctx = await depthCtx("depth:offline:pull:empty-match");
    await lensRun("offline", "replicationPush", {
      params: { docs: [{ id: "note:1", body: { tag: "shopping" } }] },
    }, ctx);
    const filter = await lensRun("offline", "filterCreate", {
      params: { name: "nothing matches", fieldMatch: [{ field: "tag", op: "eq", value: "does-not-exist" }] },
    }, ctx);
    const pulled = await lensRun("offline", "replicationPull", {
      params: { since: 0, filterId: filter.result.filter.id },
    }, ctx);
    assert.equal(pulled.ok, true);
    assert.equal(pulled.result.changes.length, 0);
    assert.equal(pulled.result.pending, 0);
    assert.equal(pulled.result.filterId, filter.result.filter.id);
  });

  it("a bogus filterId is honestly rejected, never silently treated as unfiltered", async () => {
    const ctx = await depthCtx("depth:offline:pull:bogus-filter");
    await lensRun("offline", "replicationPush", {
      params: { docs: [{ id: "note:1", body: { tag: "shopping" } }] },
    }, ctx);
    const pulled = await lensRun("offline", "replicationPull", {
      params: { since: 0, filterId: "filter_totally_bogus" },
    }, ctx);
    assert.equal(pulled.result.ok, false);
    assert.equal(pulled.result.error, "filter_not_found");
  });

  it("a filterId belonging to another user is rejected, not silently applied or ignored", async () => {
    const ctxA = await depthCtx("depth:offline:pull:cross-user-a");
    const ctxB = await depthCtx("depth:offline:pull:cross-user-b");
    await lensRun("offline", "replicationPush", {
      params: { docs: [{ id: "note:1", body: { tag: "x" } }] },
    }, ctxB);
    const filterA = await lensRun("offline", "filterCreate", {
      params: { name: "A's filter", collection: "note" },
    }, ctxA);
    const pulledAsB = await lensRun("offline", "replicationPull", {
      params: { since: 0, filterId: filterA.result.filter.id },
    }, ctxB);
    assert.equal(pulledAsB.result.ok, false);
    assert.equal(pulledAsB.result.error, "filter_not_found");
  });

  it("unfiltered pull behavior is completely unchanged (regression)", async () => {
    const ctx = await depthCtx("depth:offline:pull:unfiltered-regression");
    const push = await lensRun("offline", "replicationPush", {
      params: {
        docs: [
          { id: "note:1", body: { title: "first" } },
          { id: "note:2", body: { title: "second" } },
          { id: "task:1", body: { title: "third" } },
        ],
      },
    }, ctx);
    assert.equal(push.result.appliedCount, 3);

    const pulled = await lensRun("offline", "replicationPull", { params: { since: 0 } }, ctx);
    assert.equal(pulled.ok, true);
    assert.equal(pulled.result.changes.length, 3);
    assert.equal(pulled.result.lastSeq, 3);
    assert.equal(pulled.result.pending, 0);
    assert.equal(pulled.result.filterId, null);
    assert.deepEqual(pulled.result.changes.map((c) => c.id), ["note:1", "note:2", "task:1"]);
  });

  it("sequence numbers stay absolute/consistent across a filtered incremental sync", async () => {
    const ctx = await depthCtx("depth:offline:pull:seq-consistency");
    // 5 docs interleaved: only the "note:" ones match the filter, but seq
    // numbers must still be the REAL absolute feed positions so a client
    // that persists `lastSeq` as its next `since` never re-fetches or skips.
    await lensRun("offline", "replicationPush", {
      params: {
        docs: [
          { id: "note:1", body: { tag: "n" } },   // seq 1
          { id: "task:1", body: { tag: "t" } },   // seq 2
          { id: "note:2", body: { tag: "n" } },   // seq 3
          { id: "task:2", body: { tag: "t" } },   // seq 4
        ],
      },
    }, ctx);
    const filter = await lensRun("offline", "filterCreate", {
      params: { name: "notes", collection: "note" },
    }, ctx);

    const firstPage = await lensRun("offline", "replicationPull", {
      params: { since: 0, filterId: filter.result.filter.id, limit: 1 },
    }, ctx);
    assert.equal(firstPage.result.changes.length, 1);
    assert.equal(firstPage.result.changes[0].id, "note:1");
    assert.equal(firstPage.result.changes[0].seq, 1);
    assert.equal(firstPage.result.lastSeq, 1);
    assert.equal(firstPage.result.pending, 1); // note:2 still pending behind the limit

    // Persist the checkpoint exactly like the real client does, then push a
    // new task (non-matching) followed by a new note (matching).
    await lensRun("offline", "syncCheckpoint", {
      params: { replicationId: "filtered-repl", seq: firstPage.result.lastSeq },
    }, ctx);
    await lensRun("offline", "replicationPush", {
      params: { docs: [{ id: "task:3", body: { tag: "t" } }, { id: "note:3", body: { tag: "n" } }] }, // seq 5, 6
    }, ctx);

    const cp = await lensRun("offline", "syncCheckpoint", { params: { replicationId: "filtered-repl" } }, ctx);
    assert.equal(cp.result.seq, 1);

    const nextPage = await lensRun("offline", "replicationPull", {
      params: { since: cp.result.seq, filterId: filter.result.filter.id },
    }, ctx);
    // Everything after seq 1 that matches the filter: note:2 (seq 3) and note:3 (seq 6).
    assert.deepEqual(nextPage.result.changes.map((c) => c.id), ["note:2", "note:3"]);
    assert.deepEqual(nextPage.result.changes.map((c) => c.seq), [3, 6]);
    assert.equal(nextPage.result.lastSeq, 6);
    assert.equal(nextPage.result.pending, 0);

    // An unfiltered pull from the same `since` sees ALL real intervening
    // changes (proves seq numbers are shared/absolute across both streams,
    // not a filter-local counter).
    const unfilteredFromSame = await lensRun("offline", "replicationPull", {
      params: { since: cp.result.seq },
    }, ctx);
    assert.deepEqual(
      unfilteredFromSame.result.changes.map((c) => c.id),
      ["task:1", "note:2", "task:2", "task:3", "note:3"],
    );
    assert.equal(unfilteredFromSame.result.lastSeq, 6);
  });

  it("a deletion only passes a collection-only filter, not a fieldMatch filter (no body to evaluate)", async () => {
    const ctx = await depthCtx("depth:offline:pull:deletion-filter");
    await lensRun("offline", "replicationPush", {
      params: { docs: [{ id: "note:1", body: { tag: "shopping" } }] },
    }, ctx);
    await lensRun("offline", "replicationPush", {
      params: { docs: [{ id: "note:1", deleted: true }] },
    }, ctx);

    const collectionFilter = await lensRun("offline", "filterCreate", {
      params: { name: "notes", collection: "note" },
    }, ctx);
    const collectionPull = await lensRun("offline", "replicationPull", {
      params: { since: 0, filterId: collectionFilter.result.filter.id },
    }, ctx);
    const deletionChange = collectionPull.result.changes.find((c) => c.id === "note:1" && c.deleted);
    assert.ok(deletionChange, "collection-only filter must still surface the tombstone");
    assert.equal(deletionChange.doc, null);

    const fieldFilter = await lensRun("offline", "filterCreate", {
      params: { name: "shopping tag", fieldMatch: [{ field: "tag", op: "eq", value: "shopping" }] },
    }, ctx);
    const fieldPull = await lensRun("offline", "replicationPull", {
      params: { since: 0, filterId: fieldFilter.result.filter.id },
    }, ctx);
    assert.equal(fieldPull.result.changes.some((c) => c.id === "note:1" && c.deleted), false);
  });
});
