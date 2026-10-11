import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { collectPaginatedEvents, coerceEventTimestamp, emptyEventsPage } from "../lib/events-page.js";

describe("events page", () => {
  it("sorts numeric log timestamps without throwing", () => {
    const page = collectPaginatedEvents({
      logs: [
        { id: "a", domain: "system", action: "boot", message: "up", ts: 1_700_000_000_000 },
        { id: "b", domain: "system", action: "boot", message: "later", ts: 1_700_000_100_000 },
      ],
      timeline: [],
      auditRows: [],
      ledgerRows: [],
      limit: 8,
      offset: 0,
    });
    assert.equal(page.ok, true);
    assert.equal(page.events.length, 2);
    assert.equal(page.items.length, 2);
    assert.equal(page.items[0].id, "b");
    assert.match(page.items[0].timestamp, /^\d{4}-\d{2}-\d{2}T/);
    assert.equal(page.total, 2);
  });

  it("returns an empty page for a fresh user with no activity", () => {
    const page = collectPaginatedEvents({ limit: 8 });
    assert.equal(page.ok, true);
    assert.deepEqual(page.items, []);
    assert.deepEqual(page.events, []);
    assert.equal(page.total, 0);
  });

  it("coerces a number and leaves an empty failure page honest", () => {
    assert.match(coerceEventTimestamp(1_700_000_000_000), /T/);
    assert.equal(coerceEventTimestamp(null), "");
    const empty = emptyEventsPage("db locked", { limit: 8, offset: 0 });
    assert.equal(empty.ok, true);
    assert.deepEqual(empty.items, []);
    assert.equal(empty.unavailable, "db locked");
    assert.equal(empty.events.length, 0);
  });
});
