// Audit fix sweep (PR #2356) — FIX-history-004: the Map view showed
// no points for an imported timeline — timeline-from-wikipedia asked
// Wikipedia only for the extract and stamped every imported event
// lat/lng null, even for geotagged articles. The import now also
// requests the article's coordinates and stamps them (named by the
// article title) on its events, so map-points returns them; articles
// without coordinates still import with nulls — nothing invented.
import { describe, it, before, beforeEach } from "node:test";
import assert from "node:assert/strict";
import registerHistoryActions from "../domains/history.js";

const ACTIONS = new Map();
function register(domain, name, fn) { ACTIONS.set(`${domain}.${name}`, fn); }
function call(name, ctx, params = {}) {
  const fn = ACTIONS.get(`history.${name}`);
  if (!fn) throw new Error(`history.${name} not registered`);
  return fn(ctx, { id: null, data: {}, meta: {} }, params);
}

before(() => { registerHistoryActions(register); });
beforeEach(() => {
  globalThis._concordSTATE = { dtus: new Map() };
  globalThis._concordSaveStateDebounced = () => {};
  globalThis.fetch = async () => { throw new Error("network disabled in tests"); };
});

const ctxA = { actor: { userId: "user_a" }, userId: "user_a" };

const EXTRACT =
  "The wall was built in 1961 to divide the city. " +
  "It stood until 9 November 1989, when the crossings opened.";

function stubWiki(page) {
  globalThis.fetch = async (url) => {
    assert.match(String(url), /coordinates/, "the import asks for the article's coordinates");
    return { ok: true, json: async () => ({ query: { pages: { "1": page } } }) };
  };
}

describe("history import — map points", () => {
  it("a geotagged article's imported events carry its coordinates and map-points returns them", async () => {
    stubWiki({
      title: "Berlin Wall",
      extract: EXTRACT,
      coordinates: [{ lat: 52.5163, lon: 13.3777, primary: true }],
    });
    const r = await call("timeline-from-wikipedia", ctxA, { title: "Berlin Wall" });
    assert.equal(r.ok, true);
    assert.equal(r.result.timeline.location.place, "Berlin Wall");
    assert.ok(Math.abs(r.result.timeline.location.lat - 52.5163) < 1e-9);

    const pts = call("map-points", ctxA, { timelineId: r.result.timeline.id });
    assert.equal(pts.ok, true);
    assert.ok(pts.result.count >= 2, `expected mapped imported events, got ${pts.result.count}`);
    assert.equal(pts.result.points[0].place, "Berlin Wall");
  });

  it("an article without coordinates imports with no points — nothing invented", async () => {
    stubWiki({ title: "Roman Empire", extract: EXTRACT });
    const r = await call("timeline-from-wikipedia", ctxA, { title: "Roman Empire" });
    assert.equal(r.ok, true);
    assert.equal(r.result.timeline.location, null);
    const pts = call("map-points", ctxA, { timelineId: r.result.timeline.id });
    assert.equal(pts.result.count, 0);
  });
});
