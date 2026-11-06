// Urban-planning full-build suite (B6) — pins Review 5's first-pass
// findings F2/F3/F4/F5/F7 at the server layer:
//   F2 census field fidelity — bachelor's-or-higher sums B15003 022–025;
//      60+ commute sums B08303 014+015 (the 45–59 bucket _013 is a decoy);
//      HUD income tiers are shaped into household-size rows, raw il* API
//      keys never reach a surface.
//   F3 traffic — named ITE rates (LU 220 7.32/unit; LU 820 37.75/1,000 sq
//      ft), the housing/commercial split and the basis string are printed;
//      the pass's probe case (120 units + 15,000 sq ft) lands in its
//      1,400–1,700 band instead of the pre-fix 1,110.
//   F4 permit_issued — a wired lifecycle stage between approved and
//      under_construction, recorded in history.
//   F5 walkability — best-per-category coverage endpoints: all walkable =
//      100 walkers-paradise; present but none walkable = 25 car-dependent.
//   F7 comment-remove — the author can delete their own comment; another
//      user's comment is untouched; derivedFar rides the massing result.
import { describe, it, before, beforeEach } from "node:test";
import assert from "node:assert/strict";
import registerUrbanplanningActions from "../domains/urbanplanning.js";

const ACTIONS = new Map();
registerUrbanplanningActions((d, n, fn) => ACTIONS.set(n, fn));
function call(name, ctx, input = {}) {
  const fn = ACTIONS.get(name);
  if (!fn) throw new Error(`urban-planning.${name} not registered`);
  return fn(ctx, { id: null, domain: "urban-planning", type: "domain_action", data: input, meta: {} }, input);
}
const ctxA = { actor: { userId: "user_a" } };
const ctxB = { actor: { userId: "user_b" } };

before(() => {});
beforeEach(() => {
  globalThis._concordSTATE = {};
  globalThis._concordSaveStateDebounced = () => {};
  delete process.env.HUD_API_TOKEN;
});

describe("F2 — census field fidelity", () => {
  it("sums the degree columns and the true 60+ commute buckets", async () => {
    const headers = ["B01003_001E", "B19013_001E", "B01002_001E", "B15003_022E", "B15003_023E", "B15003_024E", "B15003_025E", "B15003_001E", "B25003_002E", "B25003_003E", "B08303_001E", "B08303_013E", "B08303_014E", "B08303_015E", "NAME", "state", "county"];
    // Truth: bachelors+ = (30+20+8+6)/100 = 64%; 60+ = (1750+1000)/10000 = 27.5%.
    // _013 (45–59 min) = 270 is the decoy the pre-fix code read.
    const row = ["100000", "90000", "38.0", "30000", "20000", "8000", "6000", "100000", "60000", "40000", "10000", "270", "1750", "1000", "Test County", "36", "061"];
    globalThis.fetch = async () => ({ ok: true, json: async () => [headers, row] });
    const r = await call("census-acs-county", ctxA, { stateFips: "36", countyFips: "061" });
    assert.equal(r.ok, true);
    assert.equal(r.result.bachelorsPlusPct, 64);
    assert.equal(r.result.longCommutePct, 27.5);
    assert.equal(r.result.ownerOccupiedPct, 60);
  });

  it("HUD tiers arrive as household-size rows with no raw API keys", async () => {
    process.env.HUD_API_TOKEN = "suite-token";
    globalThis.fetch = async () => ({
      ok: true, status: 200,
      json: async () => ({ data: { area_name: "Test Metro", median_income: 100000, very_low: { il50_p1p: 30000, il50_p2p: 34000, il50_p4p: 42000 }, extremely_low: { il30_p1p: 18000 }, low: { il80_p8p: 90000 } } }),
    });
    const r = await call("hud-income-limits", ctxA, { stateAbbr: "NY", countyFips: "061" });
    assert.equal(r.ok, true);
    assert.deepEqual(r.result.veryLowIncome50Pct, [
      { householdSize: 1, limit: 30000 },
      { householdSize: 2, limit: 34000 },
      { householdSize: 4, limit: 42000 },
    ]);
    assert.equal(JSON.stringify(r.result).includes("il50_"), false, "no raw HUD keys survive shaping");
    assert.equal(r.result.lowIncome80Pct[0].householdSize, 8);
  });
});

describe("F3 — traffic prints its basis", () => {
  it("the pass's probe case lands in the ITE band with the split printed", () => {
    const r = call("trafficImpact", ctxA, { newHousingUnits: 120, newCommercialSqFt: 15000, currentADT: 10000 });
    assert.equal(r.result.housingTrips, 878, "120 × 7.32");
    assert.equal(r.result.commercialTrips, 566, "15000 × 0.03775");
    assert.equal(r.result.newDailyTrips, 1444);
    assert.ok(r.result.newDailyTrips >= 1400 && r.result.newDailyTrips <= 1700);
    assert.match(r.result.rateBasis, /LU 220/);
    assert.match(r.result.rateBasis, /LU 820/);
  });
});

describe("F5 — walkability endpoints", () => {
  const CATS = ["grocery", "restaurant", "school", "park", "transit", "retail", "healthcare"];
  it("every category walkable scores 100, walkers-paradise", () => {
    const r = call("walkabilityScore", ctxA, { amenities: CATS.map((c) => ({ category: c, withinWalkingDistance: true })) });
    assert.equal(r.result.walkabilityScore, 100);
    assert.equal(r.result.rating, "walkers-paradise");
  });
  it("amenities present but none walkable scores 25, car-dependent", () => {
    const r = call("walkabilityScore", ctxA, { amenities: CATS.map((c) => ({ category: c, withinWalkingDistance: false })) });
    assert.equal(r.result.walkabilityScore, 25);
    assert.equal(r.result.rating, "car-dependent");
  });
  it("a second nearer amenity in a category raises that category only", () => {
    const r = call("walkabilityScore", ctxA, { amenities: [
      { category: "park", withinWalkingDistance: false },
      { category: "park", withinWalkingDistance: true },
    ] });
    assert.equal(r.result.amenityScores.park, 1);
    assert.equal(r.result.walkabilityScore, 14, "round(1/7 × 100)");
  });
});

describe("F4 — permit_issued lifecycle", () => {
  it("proposed → approved → permit_issued → under_construction → built, history recorded", () => {
    const added = call("project-add", ctxA, { name: "Permit Path Tower" });
    const id = added.result.project.id;
    for (const s of ["approved", "permit_issued", "under_construction", "built"]) {
      const r = call("project-status-update", ctxA, { id, status: s });
      assert.equal(r.ok, true, `transition to ${s}`);
    }
    const list = call("project-list", ctxA, {});
    const p = list.result.projects.find((x) => x.id === id);
    assert.equal(p.status, "built");
    assert.deepEqual(p.statusHistory.map((h) => h.status), ["proposed", "approved", "permit_issued", "under_construction", "built"]);
  });

  it("an unknown status is still rejected", () => {
    const added = call("project-add", ctxA, { name: "Reject Tower" });
    const r = call("project-status-update", ctxA, { id: added.result.project.id, status: "teleported" });
    assert.equal(r.ok, false);
    assert.match(r.error, /unrecognized status/);
  });
});

describe("F7 — comment-remove and derived FAR", () => {
  it("the author removes their comment; another user's list is untouched", () => {
    const scn = call("scenario-create", ctxA, { name: "Comment Host" });
    const cA = call("comment-add", ctxA, { subjectId: scn.result.scenario.id, body: "mine", stance: "support" });
    call("comment-add", ctxB, { subjectId: scn.result.scenario.id, body: "theirs", stance: "concern" });
    const rm = call("comment-remove", ctxA, { id: cA.result.comment.id });
    assert.equal(rm.ok, true);
    assert.equal(call("comment-list", ctxA, {}).result.total, 0);
    assert.equal(call("comment-list", ctxB, {}).result.total, 1);
    const again = call("comment-remove", ctxA, { id: cA.result.comment.id });
    assert.equal(again.ok, false);
    assert.equal(again.error, "not_found");
  });

  it("massing carries derivedFar = GFA / lot (scenario A shape: 3.2, not the nominal 3)", () => {
    const m = call("massingEnvelope", ctxA, { zoneType: "mixed", lotSizeSqFt: 10000 });
    assert.equal(m.result.floorAreaRatio, 3);
    assert.equal(m.result.derivedFar, 3.2);
    const z = call("massingEnvelope", ctxA, { zoneType: "mixed", lotSizeSqFt: 0 });
    assert.equal(z.result.derivedFar, null);
  });
});
