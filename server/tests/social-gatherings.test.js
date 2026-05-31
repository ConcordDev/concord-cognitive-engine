// SL5 — social gathering composer. Pins the attendee/beat composition per kind:
// a wedding seats a grudge-holder for tension, a funeral assembles the bereaved
// + rivals and triggers grief, a festival gathers the community; attendees
// de-dupe by name.
//
// Run: node --test tests/social-gatherings.test.js

import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { composeGathering, GATHERING_KINDS } from "../lib/social-gatherings.js";

describe("composeGathering — wedding", () => {
  it("seats the couple + family + a single grudge-holder for tension", () => {
    const g = composeGathering({
      kind: "wedding", focalName: "Iyenn",
      partners: ["Sand-Mother Vesh"], family: ["Old Seam"], friends: ["Brackish"],
      grudgeHolders: ["Kel the Spurned", "Another Rival"],
    });
    const roles = g.attendees.map((a) => a.role);
    assert.ok(roles.includes("celebrant") && roles.includes("partner"));
    assert.equal(g.attendees.filter((a) => a.role === "uninvited").length, 1); // ONE grudge-holder
    assert.ok(g.beats.some((b) => b.includes("vows")));
    assert.ok(g.beats.some((b) => b.includes("unsmiling")));
    assert.equal(g.triggersGrief, false);
  });

  it("a wedding with no grudge-holder reads as pure celebration", () => {
    const g = composeGathering({ kind: "wedding", focalName: "A", partners: ["B"] });
    assert.ok(g.beats.some((b) => b.includes("celebration")));
    assert.equal(g.attendees.some((a) => a.role === "uninvited"), false);
  });
});

describe("composeGathering — funeral", () => {
  it("assembles the bereaved + rivals and triggers the grief path", () => {
    const g = composeGathering({
      kind: "funeral", focalName: "Asbir",
      family: ["Heir"], friends: ["Comrade"], grudgeHolders: ["The Usurper"],
    });
    assert.equal(g.triggersGrief, true);
    assert.ok(g.attendees.some((a) => a.role === "bereaved"));
    assert.ok(g.attendees.some((a) => a.role === "rival"));
    assert.ok(g.beats.some((b) => b.includes("eulogy")));
  });
});

describe("composeGathering — general", () => {
  it("festival gathers the community; unknown kind falls back to festival", () => {
    const g = composeGathering({ kind: "harvest_dance", focalName: "Mayor", friends: ["X", "Y"] });
    assert.equal(g.kind, "festival");
    assert.ok(g.attendees.some((a) => a.role === "host"));
  });

  it("de-dupes an attendee who fills two relations", () => {
    const g = composeGathering({ kind: "wedding", focalName: "A", partners: ["Bo"], family: ["Bo"] });
    assert.equal(g.attendees.filter((a) => a.name === "Bo").length, 1);
  });

  it("exposes the kind set", () => {
    assert.deepEqual(GATHERING_KINDS, ["wedding", "funeral", "festival"]);
  });
});
