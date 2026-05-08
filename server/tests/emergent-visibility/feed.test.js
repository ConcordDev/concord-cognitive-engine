// server/tests/emergent-visibility/feed.test.js
import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { emitFeedEvent, getFeedEvents, FEED_EVENT_TYPES } from "../../emergent/feed.js";

function makeMockDb() {
  const rows = [];
  return {
    prepare: (sql) => ({
      run: (...args) => rows.push({ sql, args }),
      all: (...args) => {
        if (sql.includes("emergent_activity_feed")) {return rows.filter(r => r.sql?.includes("emergent_activity_feed")).map(r => ({
          id: r.args[0], emergent_id: r.args[1], event_type: r.args[2],
          event_data: r.args[3], created_at: r.args[4],
        }));}
        return [];
      },
    }),
    _rows: rows,
  };
}

describe("FEED_EVENT_TYPES", () => {
  it("contains expected event types", () => {
    assert.ok("emergence" in FEED_EVENT_TYPES);
    assert.ok("naming" in FEED_EVENT_TYPES);
    assert.ok("artifact_created" in FEED_EVENT_TYPES);
    assert.ok("communication" in FEED_EVENT_TYPES);
  });
});

describe("emitFeedEvent", () => {
  it("returns id and type", () => {
    const db = makeMockDb();
    const result = emitFeedEvent({ type: "observation", emergentId: "e1", data: { observation: "test" } }, db, null);
    assert.ok(result.id.startsWith("evt_"));
    assert.equal(result.type, "observation");
    assert.ok(typeof result.timestamp === "number");
  });

  it("persists event to db", () => {
    const db = makeMockDb();
    emitFeedEvent({ type: "naming", emergentId: "e1", data: { name: "Aria" } }, db, null);
    assert.ok(db._rows.some(r => r.sql?.includes("emergent_activity_feed")));
  });

  it("calls realtimeEmit when provided", () => {
    let emitted = null;
    const realtimeEmit = (event, payload) => { emitted = { event, payload }; };
    emitFeedEvent({ type: "dream", emergentId: "e1", data: {} }, makeMockDb(), realtimeEmit);
    assert.ok(emitted !== null);
    assert.equal(emitted.event, "emergent:activity");
    assert.equal(emitted.payload.type, "dream");
  });

  it("does not throw when db is null", () => {
    assert.doesNotThrow(() => {
      emitFeedEvent({ type: "observation", data: {} }, null, null);
    });
  });

  it("does not throw when realtimeEmit is null", () => {
    const db = makeMockDb();
    assert.doesNotThrow(() => {
      emitFeedEvent({ type: "observation", data: {} }, db, null);
    });
  });
});

describe("getFeedEvents", () => {
  it("returns empty array when db is null", () => {
    const result = getFeedEvents(null);
    assert.deepEqual(result, []);
  });

  it("returns empty array when no events", () => {
    const db = makeMockDb();
    const result = getFeedEvents(db);
    assert.ok(Array.isArray(result));
  });
});
