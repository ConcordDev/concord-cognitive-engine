import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { guestRows, segmentRows, storeEmptyCopy, tierRows } from "./operations-store.ts";

const launch = { id: "evt_1", name: "Launch" };

describe("operations store join", () => {
  it("shows host tiers on the tickets view", () => {
    const rows = tierRows([launch], {
      evt_1: [
        { id: "t1", name: "General", price: 25, quantity: 10, sold: 1 },
        { id: "t2", name: "VIP", price: 80, quantity: 4, sold: 0 },
      ],
    });
    assert.equal(rows[0].tiers.length, 2);
    assert.equal(rows[0].tiers[0].name, "General");
    assert.equal(storeEmptyCopy("tiers", 1, 2), null);
  });

  it("does not call a filled tier list missing", () => {
    assert.equal(storeEmptyCopy("tiers", 0, 0), "No events yet. Host one, and its tiers, segments, and guests show here.");
    assert.equal(storeEmptyCopy("tiers", 1, 0), "No ticket tiers yet.");
    assert.notEqual(storeEmptyCopy("tiers", 1, 2), "No ticket tiers found");
  });

  it("shows the same segments and guests the host console stores", () => {
    const segments = segmentRows([launch], {
      evt_1: [{ id: "ag1", title: "Doors", startTime: "18:00", durationMin: 30, owner: "Floor" }],
    });
    assert.equal(segments[0].segments[0].title, "Doors");
    const guests = guestRows([launch], {
      evt_1: [{ id: "reg1", name: "PR5EV Guest One", email: "one@test.local", tierName: "General" }],
    });
    assert.equal(guests[0].guests[0].name, "PR5EV Guest One");
    assert.equal(storeEmptyCopy("segments", 1, 1), null);
    assert.equal(storeEmptyCopy("guests", 1, 0), "No guests yet. Register one on a ticket tier.");
  });
});
