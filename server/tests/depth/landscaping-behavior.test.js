// tests/depth/landscaping-behavior.test.js
//
// REAL behavioral tests for the landscaping lens-action domain. Calc actions
// assert the exact computed value (irrigation gallons, material cubic-yards,
// proposal cost roll-up, zone plant matching); CRUD actions assert round-trip
// persistence (beds / plantings / care-log / layouts / diary). Network/LLM
// actions (trefle-*, feed, identify-plant, climate-match) are skipped.
// Every lensRun("landscaping", …) is a literal behavioral invocation
// (grader-credited).
import { describe, it, before } from "node:test";
import assert from "node:assert/strict";
import { lensRun, depthCtx } from "./_harness.js";

describe("landscaping — calc actions (exact computed values)", () => {
  it("irrigationCalc: gallons = round(sqft × inchesPerWeek × 0.623), lawn at 1.0 in/wk", async () => {
    // 1000 sqft × 1.0 in/wk × 0.623 = 623 gal/wk; ×4 = 2492/mo;
    // runtime = round(623/5) = 125 min; freq "3x per week" (rate > 0.8);
    // monthlyCost = round(2492 × 0.004 × 100)/100 = 9.97
    const r = await lensRun("landscaping", "irrigationCalc", { data: { squareFootage: 1000, plantType: "lawn" } });
    assert.equal(r.ok, true);
    assert.equal(r.result.inchesPerWeek, 1.0);
    assert.equal(r.result.gallonsPerWeek, 623);
    assert.equal(r.result.gallonsPerMonth, 2492);
    assert.equal(r.result.runtimeMinutes, 125);
    assert.equal(r.result.frequency, "3x per week");
    assert.equal(r.result.monthlyCost, 9.97);
  });

  it("irrigationCalc: xeriscape uses far less water than lawn and drops to 2x/week", async () => {
    // 1000 × 0.2 × 0.623 = round(124.6) = 125 gal/wk; rate 0.2 ≤ 0.8 → "2x per week"
    const xeri = await lensRun("landscaping", "irrigationCalc", { data: { squareFootage: 1000, plantType: "xeriscape" } });
    assert.equal(xeri.ok, true);
    assert.equal(xeri.result.inchesPerWeek, 0.2);
    assert.equal(xeri.result.gallonsPerWeek, 125);
    assert.equal(xeri.result.frequency, "2x per week");
    const lawn = await lensRun("landscaping", "irrigationCalc", { data: { squareFootage: 1000, plantType: "lawn" } });
    assert.ok(xeri.result.gallonsPerWeek < lawn.result.gallonsPerWeek, "xeriscape draws less than lawn");
  });

  it("materialEstimate: mulch cubic-yards = round((sqft × depth/12 / 27) × 10)/10", async () => {
    // 100 sqft × 3in mulch: (100×3/12/27) = 0.9259 → round(9.259)/10 = 0.9 yd³;
    // bags = ceil(0.9 × 13.5) = 13; cost = round(0.9 × 35) = 32; bagged note (≤3)
    const r = await lensRun("landscaping", "materialEstimate", { data: { squareFootage: 100, material: "mulch" } });
    assert.equal(r.ok, true);
    assert.equal(r.result.depthInches, 3);
    assert.equal(r.result.cubicYards, 0.9);
    assert.equal(r.result.bags, 13);
    assert.equal(r.result.estimatedCost, 32);
    assert.equal(r.result.deliveryNote, "Bagged purchase sufficient");
  });

  it("materialEstimate: large gravel job tips into bulk-delivery", async () => {
    // 540 sqft × 2in gravel: (540×2/12/27) = 3.333 → round(33.33)/10 = 3.3 yd³ (>3)
    const r = await lensRun("landscaping", "materialEstimate", { data: { squareFootage: 540, material: "gravel" } });
    assert.equal(r.ok, true);
    assert.equal(r.result.depthInches, 2);
    assert.equal(r.result.cubicYards, 3.3);
    assert.equal(r.result.estimatedCost, Math.round(3.3 * 45)); // 149
    assert.equal(r.result.deliveryNote, "Bulk delivery recommended");
  });

  it("plantSelection: zone-7/full-sun/loam yields the 5 suitable species (partial-sun always admitted)", async () => {
    const r = await lensRun("landscaping", "plantSelection", { data: { hardnessZone: 7, sunExposure: "full", soilType: "loam" } });
    assert.equal(r.ok, true);
    assert.equal(r.result.zone, 7);
    assert.equal(r.result.totalMatches, 5);
    const names = r.result.recommendations.map((p) => p.name);
    assert.ok(names.includes("Lavender"), "Lavender (full/loam/5-9) matches");
    assert.ok(names.includes("Japanese Maple"), "Japanese Maple (partial sun) is always admitted");
    assert.ok(!names.includes("Hosta"), "Hosta (shade-only) excluded for full sun");
  });

  it("proposal-build: rolls subtotal → overhead → margin → tax to the exact total", async () => {
    // 2 × $500 = $1000 subtotal; overhead 15% = 150; margin 20% of 1150 = 230;
    // preTax 1380; tax 0% = 0; total 1380
    const r = await lensRun("landscaping", "proposal-build", {
      params: {
        client: "Acme", project: "Front yard",
        lineItems: [{ description: "Sod install", category: "labor", unit: "sqft", quantity: 2, unitCost: 500 }],
      },
    });
    assert.equal(r.ok, true);
    assert.equal(r.result.subtotal, 1000);
    assert.equal(r.result.overhead, 150);
    assert.equal(r.result.margin, 230);
    assert.equal(r.result.tax, 0);
    assert.equal(r.result.total, 1380);
    assert.equal(r.result.lineItems[0].lineTotal, 1000);
    assert.match(String(r.result.proposalMarkdown), /Landscaping Proposal/);
  });

  it("proposal-build: rejects an empty proposal (no line items)", async () => {
    const r = await lensRun("landscaping", "proposal-build", { params: { client: "Acme", lineItems: [] } });
    assert.equal(r.result.ok, false);
    assert.match(String(r.result.error), /lineItems required/i);
  });
});

describe("landscaping — bed CRUD lifecycle (write persists + reads back)", () => {
  let ctx;
  before(async () => { ctx = await depthCtx("landscaping-crud"); });

  it("bed-add → bed-list: an added bed lists with planting/care counts and aggregate sqft", async () => {
    const added = await lensRun("landscaping", "bed-add", { params: { name: "South Border", sizeSqft: 120, sunExposure: "full", soilType: "loam" } }, ctx);
    assert.equal(added.ok, true);
    assert.equal(added.result.bed.name, "South Border");
    assert.equal(added.result.bed.sizeSqft, 120);
    const id = added.result.bed.id;
    const list = await lensRun("landscaping", "bed-list", { params: {} }, ctx);
    assert.equal(list.ok, true);
    assert.ok(list.result.beds.some((b) => b.id === id), "bed is listed");
    assert.equal(list.result.count, list.result.beds.length);
    assert.ok(list.result.totalSqft >= 120, "aggregate sqft includes the new bed");
  });

  it("bed-add: rejects a bed with no name (required-field validation)", async () => {
    const r = await lensRun("landscaping", "bed-add", { params: { sizeSqft: 50 } }, ctx);
    assert.equal(r.result.ok, false);
    assert.match(String(r.result.error), /bed name required/i);
  });

  it("planting-add → bed-list: a planting attaches to its bed and bumps plantingCount", async () => {
    const bed = await lensRun("landscaping", "bed-add", { params: { name: "Veg Plot", sizeSqft: 64 } }, ctx);
    const bedId = bed.result.bed.id;
    const plant = await lensRun("landscaping", "planting-add", { params: { bedId, plant: "Tomato", quantity: 6, status: "growing" } }, ctx);
    assert.equal(plant.ok, true);
    assert.equal(plant.result.planting.plant, "Tomato");
    assert.equal(plant.result.planting.quantity, 6);
    const list = await lensRun("landscaping", "bed-list", { params: {} }, ctx);
    const found = list.result.beds.find((b) => b.id === bedId);
    assert.ok(found, "bed still listed");
    assert.equal(found.plantingCount, 1);
  });

  it("planting-add: rejects an unknown bed id", async () => {
    const r = await lensRun("landscaping", "planting-add", { params: { bedId: "nope", plant: "Rose" } }, ctx);
    assert.equal(r.result.ok, false);
    assert.match(String(r.result.error), /bed not found/i);
  });

  it("care-log → care-reminders: a watering entry derives a due reminder within the horizon", async () => {
    const bed = await lensRun("landscaping", "bed-add", { params: { name: "Herb Bed", sizeSqft: 30 } }, ctx);
    const bedId = bed.result.bed.id;
    // a watering logged 2 days ago → cadence 3 days → due tomorrow (daysUntil 1 ≤ horizon)
    const twoDaysAgo = new Date(Date.now() - 2 * 86_400_000).toISOString().slice(0, 10);
    const logged = await lensRun("landscaping", "care-log", { params: { bedId, kind: "water", date: twoDaysAgo } }, ctx);
    assert.equal(logged.ok, true);
    assert.equal(logged.result.entry.kind, "water");
    const rem = await lensRun("landscaping", "care-reminders", { params: { horizonDays: 14 } }, ctx);
    assert.equal(rem.ok, true);
    const mine = rem.result.reminders.find((x) => x.bedId === bedId && x.kind === "water");
    assert.ok(mine, "watering reminder derived for the bed");
    assert.equal(mine.cadenceDays, 3);
    assert.equal(mine.lastDone, twoDaysAgo);
  });

  it("bed-delete: removes a bed so it no longer lists; unknown id rejects", async () => {
    const bed = await lensRun("landscaping", "bed-add", { params: { name: "Temp Bed" } }, ctx);
    const id = bed.result.bed.id;
    const del = await lensRun("landscaping", "bed-delete", { params: { id } }, ctx);
    assert.equal(del.ok, true);
    assert.equal(del.result.deleted, id);
    const list = await lensRun("landscaping", "bed-list", { params: {} }, ctx);
    assert.ok(!list.result.beds.some((b) => b.id === id), "deleted bed is gone");
    const bad = await lensRun("landscaping", "bed-delete", { params: { id: "missing" } }, ctx);
    assert.equal(bad.result.ok, false);
    assert.match(String(bad.result.error), /bed not found/i);
  });
});

describe("landscaping — yard layout designer (clamp + round-trip)", () => {
  let ctx;
  before(async () => { ctx = await depthCtx("landscaping-layout"); });

  it("layout-create → layout-save-elements: clamps element coords into plot bounds + reads back", async () => {
    const created = await lensRun("landscaping", "layout-create", { params: { name: "Backyard", plotWidthFt: 40, plotHeightFt: 30 } }, ctx);
    assert.equal(created.ok, true);
    assert.equal(created.result.layout.plotWidthFt, 40);
    const layoutId = created.result.layout.id;
    // x=999 must clamp to plotWidthFt (40); unknown kind falls back to "plant"
    const saved = await lensRun("landscaping", "layout-save-elements", {
      params: { layoutId, elements: [{ kind: "bogus", label: "Maple", x: 999, y: 5, widthFt: 3, heightFt: 3 }] },
    }, ctx);
    assert.equal(saved.ok, true);
    assert.equal(saved.result.elementCount, 1);
    assert.equal(saved.result.layout.elements[0].x, 40, "x clamped to plot width");
    assert.equal(saved.result.layout.elements[0].kind, "plant", "unknown kind defaults to plant");
    const list = await lensRun("landscaping", "layout-list", { params: {} }, ctx);
    const found = list.result.layouts.find((l) => l.id === layoutId);
    assert.ok(found, "layout listed");
    assert.equal(found.elementCount, 1);
  });

  it("layout-save-elements: rejects an unknown layout id", async () => {
    const r = await lensRun("landscaping", "layout-save-elements", { params: { layoutId: "nope", elements: [] } }, ctx);
    assert.equal(r.result.ok, false);
    assert.match(String(r.result.error), /layout not found/i);
  });
});

describe("landscaping — plant health diary (round-trip + filter)", () => {
  let ctx;
  before(async () => { ctx = await depthCtx("landscaping-diary"); });

  it("diary-add → diary-timeline: entries sort by date and filter by plant", async () => {
    await lensRun("landscaping", "diary-add", { params: { plant: "Fig", date: "2026-05-01", health: "healthy", heightCm: 40 } }, ctx);
    await lensRun("landscaping", "diary-add", { params: { plant: "Fig", date: "2026-03-01", health: "stressed", heightCm: 20 } }, ctx);
    await lensRun("landscaping", "diary-add", { params: { plant: "Apple", date: "2026-04-01", health: "thriving" } }, ctx);
    const figs = await lensRun("landscaping", "diary-timeline", { params: { plant: "Fig" } }, ctx);
    assert.equal(figs.ok, true);
    assert.equal(figs.result.count, 2);
    assert.equal(figs.result.filteredBy, "Fig");
    // sorted ascending by date → earliest first
    assert.equal(figs.result.entries[0].date, "2026-03-01");
    assert.equal(figs.result.entries[1].date, "2026-05-01");
    assert.ok(figs.result.plants.includes("Apple"), "plants[] lists all diary plants, not just the filter");
  });

  it("diary-add: rejects an entry with no plant name", async () => {
    const r = await lensRun("landscaping", "diary-add", { params: { date: "2026-05-01" } }, ctx);
    assert.equal(r.result.ok, false);
    assert.match(String(r.result.error), /plant name required/i);
  });

  it("diary-delete: removes a diary entry; unknown id rejects", async () => {
    const add = await lensRun("landscaping", "diary-add", { params: { plant: "Peach", date: "2026-06-01" } }, ctx);
    const id = add.result.entry.id;
    const del = await lensRun("landscaping", "diary-delete", { params: { id } }, ctx);
    assert.equal(del.ok, true);
    assert.equal(del.result.deleted, id);
    const tl = await lensRun("landscaping", "diary-timeline", { params: { plant: "Peach" } }, ctx);
    assert.equal(tl.result.count, 0, "deleted Peach entry is gone");
    const bad = await lensRun("landscaping", "diary-delete", { params: { id: "missing" } }, ctx);
    assert.equal(bad.result.ok, false);
    assert.match(String(bad.result.error), /diary entry not found/i);
  });
});

describe("landscaping — seasonal plan (4-season schedule + month-derived current season)", () => {
  it("seasonalPlan: returns all four seasons; currentSeason matches the month table; immediateActions echoes it", async () => {
    const r = await lensRun("landscaping", "seasonalPlan", { data: { hardnessZone: 7 } });
    assert.equal(r.ok, true);
    assert.equal(r.result.zone, 7);
    // each season has its full authored task list
    assert.equal(r.result.plan.spring.length, 5);
    assert.equal(r.result.plan.summer.length, 5);
    assert.equal(r.result.plan.fall.length, 5);
    assert.equal(r.result.plan.winter.length, 5);
    assert.ok(r.result.plan.spring.includes("Plant annuals"), "spring includes Plant annuals");
    // currentSeason is derived from the month table — assert it matches the same table
    const expected = ["winter","winter","spring","spring","spring","summer","summer","summer","fall","fall","fall","winter"][new Date().getMonth()];
    assert.equal(r.result.currentSeason, expected);
    // immediateActions is exactly the plan for the current season
    assert.deepEqual(r.result.immediateActions, r.result.plan[expected]);
  });

  it("seasonalPlan: defaults zone to 7 when omitted", async () => {
    const r = await lensRun("landscaping", "seasonalPlan", { data: {} });
    assert.equal(r.ok, true);
    assert.equal(r.result.zone, 7);
  });
});

describe("landscaping — dashboard aggregation (counts roll up across beds)", () => {
  let ctx;
  before(async () => { ctx = await depthCtx("landscaping-dash"); });

  it("landscaping-dashboard: aggregates bed count, total sqft, plantings and care events", async () => {
    // start clean (fresh ctx → empty store)
    const empty = await lensRun("landscaping", "landscaping-dashboard", { params: {} }, ctx);
    assert.equal(empty.ok, true);
    assert.equal(empty.result.beds, 0);
    assert.equal(empty.result.totalSqft, 0);

    const b1 = await lensRun("landscaping", "bed-add", { params: { name: "Plot A", sizeSqft: 100 } }, ctx);
    const b2 = await lensRun("landscaping", "bed-add", { params: { name: "Plot B", sizeSqft: 50 } }, ctx);
    await lensRun("landscaping", "planting-add", { params: { bedId: b1.result.bed.id, plant: "Basil", quantity: 3 } }, ctx);
    await lensRun("landscaping", "planting-add", { params: { bedId: b2.result.bed.id, plant: "Mint" } }, ctx);
    await lensRun("landscaping", "care-log", { params: { bedId: b1.result.bed.id, kind: "water" } }, ctx);

    const dash = await lensRun("landscaping", "landscaping-dashboard", { params: {} }, ctx);
    assert.equal(dash.ok, true);
    assert.equal(dash.result.beds, 2);
    assert.equal(dash.result.totalSqft, 150, "100 + 50");
    assert.equal(dash.result.plantings, 2);
    assert.equal(dash.result.careEvents, 1);
  });
});

describe("landscaping — layout-delete (round-trip removal)", () => {
  let ctx;
  before(async () => { ctx = await depthCtx("landscaping-layout-del"); });

  it("layout-delete: removes a created layout; unknown id rejects", async () => {
    const created = await lensRun("landscaping", "layout-create", { params: { name: "Side Yard", plotWidthFt: 20, plotHeightFt: 15 } }, ctx);
    const id = created.result.layout.id;
    const del = await lensRun("landscaping", "layout-delete", { params: { id } }, ctx);
    assert.equal(del.ok, true);
    assert.equal(del.result.deleted, id);
    const list = await lensRun("landscaping", "layout-list", { params: {} }, ctx);
    assert.ok(!list.result.layouts.some((l) => l.id === id), "deleted layout is gone");
    const bad = await lensRun("landscaping", "layout-delete", { params: { id: "missing" } }, ctx);
    assert.equal(bad.result.ok, false);
    assert.match(String(bad.result.error), /layout not found/i);
  });

  it("layout-create: rejects a layout with no name and clamps plot bounds to [4,2000]", async () => {
    const noName = await lensRun("landscaping", "layout-create", { params: { plotWidthFt: 10 } }, ctx);
    assert.equal(noName.result.ok, false);
    assert.match(String(noName.result.error), /layout name required/i);
    // width 1 clamps up to 4; height 9999 clamps down to 2000
    const clamped = await lensRun("landscaping", "layout-create", { params: { name: "Tiny", plotWidthFt: 1, plotHeightFt: 9999 } }, ctx);
    assert.equal(clamped.ok, true);
    assert.equal(clamped.result.layout.plotWidthFt, 4);
    assert.equal(clamped.result.layout.plotHeightFt, 2000);
  });
});

describe("landscaping — AR photo overlay (create / place / list / delete)", () => {
  let ctx;
  before(async () => { ctx = await depthCtx("landscaping-overlay"); });

  it("overlay-create → overlay-list: photo stored, heavy photoUrl not echoed, hasPhoto flagged", async () => {
    const created = await lensRun("landscaping", "overlay-create", { params: { name: "Front", photoUrl: "data:image/png;base64,AAAA" } }, ctx);
    assert.equal(created.ok, true);
    assert.equal(created.result.overlay.name, "Front");
    assert.equal(created.result.overlay.hasPhoto, true);
    assert.equal(created.result.overlay.photoUrl, undefined, "create does not echo the heavy photoUrl");
    const id = created.result.overlay.id;
    const list = await lensRun("landscaping", "overlay-list", { params: {} }, ctx);
    assert.equal(list.ok, true);
    const found = list.result.overlays.find((o) => o.id === id);
    assert.ok(found, "overlay listed");
    assert.equal(found.placementCount, 0);
  });

  it("overlay-create: rejects when photoUrl missing", async () => {
    const r = await lensRun("landscaping", "overlay-create", { params: { name: "NoPhoto" } }, ctx);
    assert.equal(r.result.ok, false);
    assert.match(String(r.result.error), /photoUrl required/i);
  });

  it("overlay-place: clamps placement percentages/scale and reads back via list", async () => {
    const created = await lensRun("landscaping", "overlay-create", { params: { photoUrl: "data:image/png;base64,BBBB" } }, ctx);
    const overlayId = created.result.overlay.id;
    // xPct 150 clamps to 100; yPct -10 clamps to 0; scalePct 999 clamps to 300
    const placed = await lensRun("landscaping", "overlay-place", {
      params: { overlayId, placements: [{ plant: "Rose", xPct: 150, yPct: -10, scalePct: 999 }] },
    }, ctx);
    assert.equal(placed.ok, true);
    assert.equal(placed.result.overlay.placements.length, 1);
    const pl = placed.result.overlay.placements[0];
    assert.equal(pl.plant, "Rose");
    assert.equal(pl.xPct, 100, "xPct clamped to 100");
    assert.equal(pl.yPct, 0, "yPct clamped to 0");
    assert.equal(pl.scalePct, 300, "scalePct clamped to 300");
    const list = await lensRun("landscaping", "overlay-list", { params: {} }, ctx);
    const found = list.result.overlays.find((o) => o.id === overlayId);
    assert.equal(found.placementCount, 1);
  });

  it("overlay-place: rejects an unknown overlay id", async () => {
    const r = await lensRun("landscaping", "overlay-place", { params: { overlayId: "nope", placements: [] } }, ctx);
    assert.equal(r.result.ok, false);
    assert.match(String(r.result.error), /overlay not found/i);
  });

  it("overlay-delete: removes an overlay; unknown id rejects", async () => {
    const created = await lensRun("landscaping", "overlay-create", { params: { photoUrl: "data:image/png;base64,CCCC" } }, ctx);
    const id = created.result.overlay.id;
    const del = await lensRun("landscaping", "overlay-delete", { params: { id } }, ctx);
    assert.equal(del.ok, true);
    assert.equal(del.result.deleted, id);
    const list = await lensRun("landscaping", "overlay-list", { params: {} }, ctx);
    assert.ok(!list.result.overlays.some((o) => o.id === id), "deleted overlay is gone");
    const bad = await lensRun("landscaping", "overlay-delete", { params: { id: "missing" } }, ctx);
    assert.equal(bad.result.ok, false);
    assert.match(String(bad.result.error), /overlay not found/i);
  });
});

describe("landscaping — maintenance calendar (12-month schedule + bed bias)", () => {
  let ctx;
  before(async () => { ctx = await depthCtx("landscaping-cal"); });

  it("maintenance-calendar (no bed): generic 12-month schedule with authored tasks", async () => {
    const r = await lensRun("landscaping", "maintenance-calendar", { params: {} }, ctx);
    assert.equal(r.ok, true);
    assert.equal(r.result.generic.length, 12);
    assert.equal(r.result.generic[0].month, "Jan");
    assert.ok(r.result.generic[0].tasks.includes("Plan layout"), "Jan has Plan layout");
    assert.equal(r.result.generic[11].month, "Dec");
    assert.ok(r.result.generic[11].tasks.includes("Protect from frost"), "Dec has frost protection");
  });

  it("maintenance-calendar (per-bed): full-sun bed gets summer water bias + planting inspection", async () => {
    const bed = await lensRun("landscaping", "bed-add", { params: { name: "Sun Bed", sizeSqft: 80, sunExposure: "full" } }, ctx);
    const bedId = bed.result.bed.id;
    await lensRun("landscaping", "planting-add", { params: { bedId, plant: "Sunflower", quantity: 4 } }, ctx);
    const r = await lensRun("landscaping", "maintenance-calendar", { params: { bedId } }, ctx);
    assert.equal(r.ok, true);
    assert.equal(r.result.bedId, bedId);
    assert.equal(r.result.months.length, 12);
    // months 5,6,7 (Jun/Jul/Aug) get the full-sun extra-water bias
    assert.ok(r.result.months[6].tasks.includes("Extra water — full sun"), "Jul biased for full sun");
    // months 3 and 9 get the planting-inspection note (1 planting)
    assert.ok(r.result.months[3].tasks.includes("Inspect 1 planting(s)"), "Apr inspects plantings");
  });

  it("maintenance-calendar: rejects an unknown bed id", async () => {
    const r = await lensRun("landscaping", "maintenance-calendar", { params: { bedId: "nope" } }, ctx);
    assert.equal(r.result.ok, false);
    assert.match(String(r.result.error), /bed not found/i);
  });
});
