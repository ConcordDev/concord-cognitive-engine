import { describe, it } from 'vitest';
import assert from "node:assert/strict";
import { parksView, postalView } from "./reference-panels";

const yosemite = { parkCode: "yose", name: "Yosemite National Park", designation: "National Park" };

describe("parks view", () => {
  it("shows a California list that arrived on the result", () => {
    const view = parksView({
      ok: true,
      result: { parks: [yosemite], total: 9 },
    });
    assert.equal(view.kind, "list");
    if (view.kind === "list") {
      assert.equal(view.parks[0].name, "Yosemite National Park");
      assert.equal(view.total, 9);
    }
  });

  it("does not call a missing list an empty state", () => {
    const view = parksView({ ok: true, result: null });
    assert.equal(view.kind, "error");
    if (view.kind === "error") assert.match(view.message, /no park list/);
  });

  it("keeps a real empty list and a missing key distinct", () => {
    assert.equal(parksView({ ok: true, result: { parks: [] } }).kind, "empty");
    const key = parksView({ ok: false, reason: "missing_api_key", envVar: "NPS_API_KEY" });
    assert.equal(key.kind, "missing_key");
    const down = parksView({ ok: false, error: "upstream_unreachable" });
    assert.equal(down.kind, "error");
    if (down.kind === "error") assert.match(down.message, /upstream_unreachable/);
  });
});

describe("postal view", () => {
  it("shows places that arrived on the result", () => {
    const view = postalView({
      ok: true,
      result: { places: [{ placeName: "Beverly Hills", latitude: 34.09, longitude: -118.4, state: "California", stateAbbrev: "CA" }], postalCode: "90210", country: "United States" },
    }, "90210", "us");
    assert.equal(view.kind, "places");
    if (view.kind === "places") assert.equal(view.places.length, 1);
  });

  it("names a dropped list and an unreachable lookup", () => {
    const dropped = postalView({ ok: true, result: null }, "90210", "us");
    assert.equal(dropped.kind, "error");
    if (dropped.kind === "error") assert.match(dropped.message, /no place list/);
    const down = postalView({ ok: false, error: "zippopotam_unreachable" }, "90210", "us");
    assert.equal(down.kind, "error");
    if (down.kind === "error") {
      assert.match(down.message, /unreachable/);
      assert.doesNotMatch(down.message, /No match/);
    }
  });

  it("keeps a real no-match as a no-match", () => {
    const none = postalView({ ok: false, error: "fetch_failed" }, "00000", "us");
    assert.equal(none.kind, "error");
    if (none.kind === "error") assert.match(none.message, /No match/);
    assert.equal(postalView({ ok: true, result: { places: [] } }, "00000", "us").kind, "none");
  });
});
