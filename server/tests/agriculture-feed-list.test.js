// F3 join — agriculture feed-list: the display half of the feed verb.
// The ingested World Bank DTUs are stored at local scope by dtu.create
// and so can never reach the global feed route (selectGlobalFeed admits
// only scope "global" / isGlobal rows). feed-list reads the lens's own
// ingest back through dtu.list, pinned to the feed handler's mint
// (source "worldbank-feed"), so the panel lists what Pull ingested.

import { describe, it, before, beforeEach } from "node:test";
import assert from "node:assert/strict";
import registerAgricultureActions from "../domains/agriculture.js";

const ACTIONS = new Map();
function register(domain, name, fn) { ACTIONS.set(`${domain}.${name}`, fn); }
function call(name, ctx, params = {}) {
  const fn = ACTIONS.get(`agriculture.${name}`);
  assert.ok(fn, `agriculture.${name} not registered`);
  return fn(ctx, { id: null, data: {}, meta: {} }, params);
}

before(() => { registerAgricultureActions(register); });
beforeEach(() => {
  globalThis._concordSTATE = { dtus: new Map() };
  globalThis._concordSaveStateDebounced = () => {};
});

const WB = (over = {}) => ({
  id: "dtu_wb_1",
  title: "Cereal yield: France (2022)",
  source: "worldbank-feed",
  tags: ["agriculture", "feed", "crop-yield", "worldbank"],
  core: { claims: ["Country: France", "Year: 2022", "Cereal yield: 6900 kg per hectare"], definitions: [] },
  meta: { country: "France", year: "2022", yieldKgHa: 6900 },
  createdAt: "2026-11-04T10:00:00.000Z",
  ...over,
});

function ctxWithRows(rows, capture) {
  return {
    actor: { userId: "user_a" }, userId: "user_a",
    macro: {
      run: async (domain, name, input) => {
        if (capture) capture.push({ domain, name, input });
        assert.equal(domain, "dtu");
        assert.equal(name, "list");
        return { ok: true, dtus: rows };
      },
    },
  };
}

describe("agriculture feed-list (F3)", () => {
  it("lists only this handler's mint, shaped for the panel, newest first", async () => {
    const older = WB();
    const newer = WB({
      id: "dtu_wb_2", title: "Cereal yield: Brazil (2022)",
      meta: { country: "Brazil", year: "2022", yieldKgHa: 4100 },
      core: { claims: ["Country: Brazil", "Year: 2022", "Cereal yield: 4100 kg per hectare"], definitions: [] },
      createdAt: "2026-11-04T12:00:00.000Z",
    });
    const foreign = WB({ id: "dtu_other", source: "openfoodfacts-feed", title: "Not ours" });
    const r = await call("feed-list", ctxWithRows([older, foreign, newer]), {});
    assert.equal(r.ok, true);
    assert.equal(r.result.total, 2);
    assert.deepEqual(r.result.items.map((i) => i.id), ["dtu_wb_2", "dtu_wb_1"]);
    const first = r.result.items[1];
    assert.match(first.summary, /Country: France · Year: 2022/);
    assert.equal(first.sourceName, "World Bank Open Data");
    assert.match(first.sourceUrl, /AG\.YLD\.CREL\.KG/);
    assert.equal(first.country, "France");
    assert.equal(first.yieldKgHa, 6900);
    assert.ok(!first.tags.includes("feed"));
    assert.ok(first.tags.includes("crop-yield"));
  });

  it("asks dtu.list for the crop-yield tag and honours the limit", async () => {
    const capture = [];
    const rows = Array.from({ length: 5 }, (_, i) => WB({ id: `dtu_wb_${i}`, createdAt: `2026-11-0${i + 1}T10:00:00.000Z` }));
    const r = await call("feed-list", ctxWithRows(rows, capture), { limit: 2 });
    assert.equal(capture.length, 1);
    assert.equal(capture[0].input.tags, "crop-yield");
    assert.equal(r.result.items.length, 2);
    assert.equal(r.result.items[0].id, "dtu_wb_4");
  });

  it("an empty ingest reads as an empty list, not an error", async () => {
    const r = await call("feed-list", ctxWithRows([]), {});
    assert.equal(r.ok, true);
    assert.deepEqual(r.result, { items: [], total: 0 });
  });
});
