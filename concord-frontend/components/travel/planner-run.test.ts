import { describe, it } from 'vitest';
import assert from "node:assert/strict";
import {
  formatConverted,
  plannerStart,
  tripPlanTags,
  visaDestination,
  visaHeadline,
  visaSaveLine,
} from "./planner-run";

describe("planner start", () => {
  it("names a blank destination and does not look it up", () => {
    assert.deepEqual(plannerStart(""), { kind: "field", error: "Destination is required." });
    assert.deepEqual(plannerStart("   "), { kind: "field", error: "Destination is required." });
  });

  it("looks up a filled name or code", () => {
    assert.deepEqual(plannerStart("France"), { kind: "lookup" });
    assert.deepEqual(plannerStart(" FR "), { kind: "lookup" });
  });
});

describe("visa destination", () => {
  it("accepts a two-letter code and refuses a name", () => {
    assert.equal(visaDestination("fr"), "FR");
    assert.equal(visaDestination(" JP "), "JP");
    assert.equal(visaDestination("France"), null);
    assert.equal(visaDestination(""), null);
    assert.equal(visaDestination(undefined), null);
  });

  it("does not call a missing code visa-free", () => {
    assert.equal(visaHeadline(true), "Visa required");
    assert.equal(visaHeadline(false), "Visa-free");
    assert.equal(visaHeadline(null), null);
    assert.equal(visaHeadline(undefined), null);
  });

  it("saves an unknown arrangement as not on file", () => {
    assert.match(visaSaveLine({ visaRequired: null }, "US", "FR", 7), /no bilateral entry on file/);
    assert.match(visaSaveLine(null, "US", "FR", 7), /no bilateral entry on file/);
    assert.match(visaSaveLine({ visaRequired: false, arrangement: "usmca-bilateral", maxFreeStay: "180 days" }, "US", "CA", 7), /visa-free/);
  });
});

describe("planner render guards", () => {
  it("omits a tag when the code is missing", () => {
    assert.deepEqual(tripPlanTags("fr"), ["travel", "trip-plan", "fr"]);
    assert.deepEqual(tripPlanTags(undefined), ["travel", "trip-plan"]);
  });

  it("does not format a missing conversion", () => {
    assert.equal(formatConverted(92.34), (92.34).toLocaleString(undefined, { maximumFractionDigits: 2 }));
    assert.equal(formatConverted(null), null);
    assert.equal(formatConverted(Number.NaN), null);
  });
});
