// Behavioral macro tests for the carpentry lens — the macros the live lens
// surfaces actually drive through the two real frontend channels:
//
//   • JobOps.tsx        → lensRun('carpentry', action, params)
//                         POST /api/lens/run {input: params} → handler(ctx, art, params)
//                         (cutListOptimize, materialTakeoff, crew*, schedule*,
//                          timer*, timeEntry*, photoLog*, estimateToInvoice,
//                          invoice*, signEstimate, portal*)
//   • CarpentryShop.tsx → apiHelpers.lens.runDomain('carpentry', action, {input: data})
//                         POST /api/lens/run {input: data} → handler reads art.data.*
//                         (boardFootCalc, jointStrength, woodSelection, finishRecommendation)
//
// This file is the PHASE-2 LENS-DRIVEN GAP layer — it does NOT duplicate the
// shape/round-trip coverage in carpentry-domain-parity.test.js or the depth
// behavioral file. It pins, with the EXACT input wrapping the lens sends:
//   - the per-board cut-list LAYOUT + kerf accounting the JobOps bar-chart reads
//   - boardFootCalc wasteAllowance / totalWithWaste / per-piece cost:null
//     (the fields CarpentryShop's result cards render)
//   - DEGRADE-GRACEFUL: STATE-unavailable returns {ok:false} (never throws)
//   - FAIL-CLOSED on poisoned numerics (NaN/Infinity/"abc"/-1): no NaN leaks,
//     no crash, sanitised to safe bounds — the calculator never lies
//
// Hermetic: a local register harness mirrors the /api/lens/run dispatch
// (handler(ctx, virtualArtifact, input); virtualArtifact.data === input). No
// server boot, no network, no LLM, no DB — runs in <1s.

import { describe, it, before, beforeEach } from "node:test";
import assert from "node:assert/strict";
import registerCarpentryActions from "../domains/carpentry.js";

const ACTIONS = new Map();
function register(domain, name, fn) {
  assert.equal(domain, "carpentry", `unexpected domain: ${domain}`);
  ACTIONS.set(name, fn);
}

// Mirror POST /api/lens/run (server.js:39283): `rest = body.input`, then
// virtualArtifact.data = rest AND the 3rd `params` arg = rest. So the calc
// macros (read art.data) and the trade macros (read params) BOTH see `input`.
function call(name, ctx, input = {}) {
  const fn = ACTIONS.get(name);
  if (!fn) throw new Error(`carpentry.${name} not registered`);
  const virtualArtifact = { id: null, domain: "carpentry", type: "domain_action", data: input, meta: {} };
  return fn(ctx, virtualArtifact, input);
}

before(() => {
  registerCarpentryActions(register);
});

beforeEach(() => {
  globalThis._concordSTATE = {};
  globalThis._concordSaveStateDebounced = () => {};
});

const ctxA = { actor: { userId: "user_a", id: "user_a" }, userId: "user_a" };

/* ───────── registration: every macro the two lens channels drive ───────── */

describe("carpentry lens — registration of the driven macros", () => {
  it("registers every macro the page + JobOps + CarpentryShop call", () => {
    const driven = [
      // CarpentryShop pure calculators
      "boardFootCalc", "jointStrength", "woodSelection", "finishRecommendation",
      // JobOps trade-management
      "cutListOptimize", "materialTakeoff",
      "crewAdd", "crewList", "crewRemove",
      "scheduleAdd", "scheduleList", "scheduleUpdate", "scheduleDelete",
      "timerStart", "timerStop", "timeEntryAdd", "timeEntryList", "timeEntryDelete",
      "photoLogAdd", "photoLogList", "photoLogDelete",
      "estimateToInvoice", "invoiceList", "invoiceMarkPaid", "signEstimate",
      "portalCreate", "portalView", "portalList", "portalRespond", "portalUpdateProgress",
    ];
    for (const m of driven) {
      assert.equal(typeof ACTIONS.get(m), "function", `missing carpentry.${m}`);
    }
  });
});

/* ───── CarpentryShop calculators: exact fields the result cards render ───── */

describe("carpentry lens — boardFootCalc (the CarpentryShop board-foot card)", () => {
  // The card reads totalBoardFeet, totalWithWaste, totalCost, and per-piece
  // {dimensions, species, quantity, totalBoardFeet, cost}. parity asserts only
  // totalBoardFeet — pin the waste + per-piece-cost fields the UI shows.
  it("computes BF = (t×w×l)/144 × qty with 15% waste allowance + per-piece cost", () => {
    // 2 pieces of 1×6×96 = 4 BF each → totalBoardFeet 8; price 5/BF → 4×5×2 = 40
    const r = call("boardFootCalc", ctxA, {
      pieces: [{ thickness: 1, width: 6, length: 96, quantity: 2, pricePerBF: 5, species: "oak" }],
    });
    assert.equal(r.ok, true);
    assert.equal(r.result.totalBoardFeet, 8);
    // wasteAllowance = 8 × 0.15 = 1.2 ; totalWithWaste = 8 × 1.15 = 9.2
    assert.equal(r.result.wasteAllowance, 1.2);
    assert.equal(r.result.totalWithWaste, 9.2);
    assert.equal(r.result.totalCost, 40);
    const p = r.result.pieces[0];
    assert.equal(p.species, "oak");
    assert.equal(p.dimensions, '1" x 6" x 96"');
    assert.equal(p.quantity, 2);
    assert.equal(p.boardFeetEach, 4);
    assert.equal(p.totalBoardFeet, 8);
    assert.equal(p.cost, 40);
  });

  it("per-piece cost is null (not 0, not NaN) when no price is supplied", () => {
    const r = call("boardFootCalc", ctxA, {
      pieces: [{ thickness: 1, width: 6, length: 96, quantity: 1, species: "pine" }],
    });
    assert.equal(r.ok, true);
    assert.equal(r.result.pieces[0].cost, null);
    // totalCost falls back to the honest "not specified" string, never a fake $0
    assert.equal(r.result.totalCost, "Price per BF not specified");
  });

  it("empty pieces returns the honest prompt, not a fabricated tally", () => {
    const r = call("boardFootCalc", ctxA, { pieces: [] });
    assert.equal(r.ok, true);
    assert.match(String(r.result.message), /Add lumber pieces/i);
    assert.equal(r.result.totalBoardFeet, undefined);
  });
});

describe("carpentry lens — jointStrength (the CarpentryShop joinery card)", () => {
  // The card reads effectiveStrength + rating + glueBonus + speciesMultiplier.
  it("effectiveStrength = round(base × speciesMult) + glueBonus; rating bands", () => {
    // dovetail base 95, oak mult 1.2 → round(114)=114, +20 glue = 134; rating excellent
    const r = call("jointStrength", ctxA, { jointType: "dovetail", species: "oak", glued: true });
    assert.equal(r.ok, true);
    assert.equal(r.result.baseStrength, 95);
    assert.equal(r.result.speciesMultiplier, 1.2);
    assert.equal(r.result.glueBonus, "+20");
    assert.equal(r.result.effectiveStrength, 134);
    assert.equal(r.result.rating, "excellent");
  });

  it("glued:false drops the glue bonus (the toggle the card surfaces)", () => {
    const glued = call("jointStrength", ctxA, { jointType: "butt", species: "pine", glued: true });
    const dry = call("jointStrength", ctxA, { jointType: "butt", species: "pine", glued: false });
    // butt 15, pine 0.7 → round(10.5)=11 ; +20 glued = 31 vs dry 11
    assert.equal(dry.result.glueBonus, "none");
    assert.equal(dry.result.effectiveStrength, 11);
    assert.equal(glued.result.effectiveStrength, 31);
    assert.equal(dry.result.rating, "weak");
  });
});

describe("carpentry lens — woodSelection + finishRecommendation (card field shapes)", () => {
  it("woodSelection returns name/cost/hardness/workability/bestFor + topPick", () => {
    const r = call("woodSelection", ctxA, { application: "decking", budget: "medium", indoor: false });
    assert.equal(r.ok, true);
    assert.equal(r.result.environment, "outdoor");
    assert.ok(r.result.recommendations.length > 0);
    const w = r.result.recommendations[0];
    // exact fields CarpentryShop's wood card reads
    assert.equal(typeof w.name, "string");
    assert.equal(typeof w.cost, "string");
    assert.match(w.hardness, /Janka/);
    assert.equal(typeof w.workability, "string");
    assert.equal(typeof w.bestFor, "string");
    assert.equal(typeof r.result.topPick, "string");
    // outdoor filter excludes indoor-only species (e.g. Walnut)
    assert.ok(!r.result.recommendations.some((x) => x.name === "Walnut"));
  });

  it("finishRecommendation returns options[].{durability,easeOfApplication,dryTime,coatsNeeded} + topRecommendation", () => {
    const r = call("finishRecommendation", ctxA, { species: "oak", application: "table", indoor: true });
    assert.equal(r.ok, true);
    assert.equal(typeof r.result.topRecommendation, "string");
    assert.ok(r.result.options.length > 0);
    const f = r.result.options[0];
    assert.match(f.durability, /\/5/);
    assert.match(f.easeOfApplication, /\/5/);
    assert.match(f.dryTime, /h$/);
    assert.equal(typeof f.coatsNeeded, "number");
    assert.equal(typeof f.toxicity, "string");
  });
});

/* ───── JobOps cutListOptimize: the per-board LAYOUT + kerf the bar-chart reads ───── */

describe("carpentry lens — cutListOptimize layout + kerf (the JobOps cut-list bar)", () => {
  it("first-fit-decreasing emits a per-board layout with usedLength + offcut", () => {
    // two 30\" + one 50\" on 96\" stock, kerf 0:
    //   sorted desc → [50, 30, 30]. Board1: 50 (rem 46), then 30 (rem 16), then 30 won't fit (>16).
    //   Board2: 30 (rem 66). → 2 boards.
    const r = call("cutListOptimize", ctxA, {
      stockLength: 96, kerf: 0,
      cuts: [{ label: "leg", length: 30, quantity: 2 }, { label: "rail", length: 50, quantity: 1 }],
    });
    assert.equal(r.ok, true);
    assert.equal(r.result.boardsNeeded, 2);
    assert.equal(r.result.layout.length, 2);
    const b1 = r.result.layout[0];
    // board 1 holds the 50 + one 30 → used 80, offcut 16
    assert.equal(b1.board, 1);
    assert.equal(b1.usedLength, 80);
    assert.equal(b1.offcut, 16);
    assert.deepEqual(b1.cuts.map((c) => c.length).sort((a, z) => z - a), [50, 30]);
    // total cut length = 50+30+30 = 110, stock 2×96 = 192 → waste 82 → 42.7%
    assert.equal(r.result.totalCutLength, 110);
    assert.equal(r.result.wasteLength, 82);
    assert.equal(r.result.wastePct, 42.7);
  });

  it("kerf is charged once per ADDITIONAL cut on a board, not the first", () => {
    // four 23\" cuts on 96\" with kerf 0.25:
    //   cut1 23 (no kerf), cut2 23+0.25, cut3 23+0.25, cut4 23+0.25 → used = 92.75 ≤ 96 → ONE board.
    const r = call("cutListOptimize", ctxA, {
      stockLength: 96, kerf: 0.25,
      cuts: [{ label: "slat", length: 23, quantity: 4 }],
    });
    assert.equal(r.ok, true);
    assert.equal(r.result.boardsNeeded, 1);
    assert.equal(r.result.kerf, 0.25);
    // used = 23×4 + 0.25×3 = 92.75 ; offcut = 96 − 92.75 = 3.25
    assert.equal(r.result.layout[0].usedLength, 92.75);
    assert.equal(r.result.layout[0].offcut, 3.25);
  });

  it("materialCost is null when no per-board cost given (UI shows '—', never $0)", () => {
    const r = call("cutListOptimize", ctxA, { stockLength: 96, kerf: 0, cuts: [{ length: 40, quantity: 1 }] });
    assert.equal(r.ok, true);
    assert.equal(r.result.materialCost, null);
  });

  it("VALIDATION: rejects a cut longer than stock with a descriptive error", () => {
    const r = call("cutListOptimize", ctxA, { stockLength: 96, cuts: [{ label: "beam", length: 120 }] });
    assert.equal(r.ok, false);
    assert.match(String(r.error), /exceeds stock length/i);
  });

  it("VALIDATION: rejects when no positive-length cut survives", () => {
    const r = call("cutListOptimize", ctxA, { cuts: [{ label: "x", length: 0 }, { label: "y", length: -5 }] });
    assert.equal(r.ok, false);
    assert.match(String(r.error), /no valid cuts/i);
  });
});

/* ───── FAIL-CLOSED: poisoned numerics must sanitise, never leak NaN/crash ───── */

describe("carpentry lens — fail-closed on poisoned numeric inputs", () => {
  it("cutListOptimize: NaN/Infinity/string stock+kerf fail-close (clean reject, never NaN success)", () => {
    // cpNum coerces NaN/Infinity/"x" → 0; stockLength floors to 1, kerf to 0.
    // A 40" cut now exceeds the 1" sanitised stock → the macro must REJECT
    // cleanly (descriptive error), never emit a NaN-poisoned "success".
    const r = call("cutListOptimize", ctxA, {
      stockLength: "not-a-number", kerf: Infinity, stockCostPerBoard: NaN,
      cuts: [{ label: "rail", length: 40, quantity: 2 }],
    });
    assert.equal(r.ok, false);
    assert.match(String(r.error), /exceeds stock length 1"/i);
    assert.equal(r.result, undefined, "no fabricated layout on rejection");
  });

  it("cutListOptimize: poisoned kerf/cost with VALID stock yields a finite layout (no NaN leak)", () => {
    // Valid 96" stock + Infinity kerf + NaN cost + one in-range cut → kerf
    // sanitised to 0, cost to null, every emitted number finite.
    const r = call("cutListOptimize", ctxA, {
      stockLength: 96, kerf: Infinity, stockCostPerBoard: NaN,
      cuts: [{ label: "rail", length: 40, quantity: 2 }],
    });
    assert.equal(r.ok, true);
    assert.equal(r.result.kerf, 0);
    assert.equal(r.result.materialCost, null);
    assert.ok(Number.isFinite(r.result.boardsNeeded), "boardsNeeded finite");
    assert.ok(Number.isFinite(r.result.wastePct), "wastePct finite");
    assert.ok(Number.isFinite(r.result.totalCutLength), "totalCutLength finite");
    for (const b of r.result.layout) {
      assert.ok(Number.isFinite(b.usedLength) && Number.isFinite(b.offcut));
    }
  });

  it("materialTakeoff: NaN/negative quantity+cost never produce a NaN total", () => {
    const r = call("materialTakeoff", ctxA, {
      items: [{ name: "stud", quantity: 10, unitCost: "abc" }, { name: "junk", quantity: NaN, unitCost: 5 }],
      laborHours: -4, laborRate: Infinity, wastePct: NaN, overheadPct: "x", marginPct: -99,
    });
    assert.equal(r.ok, true);
    // unitCost "abc" → 0 ; the NaN-qty row is dropped (qty<=0). Only the stud survives.
    assert.equal(r.result.items.length, 1);
    assert.equal(r.result.materialSubtotal, 0);
    for (const k of ["materialWithWaste", "laborCost", "overhead", "margin", "total"]) {
      assert.ok(Number.isFinite(r.result[k]), `${k} must be finite, got ${r.result[k]}`);
    }
    // labor floored at 0 (negative hours), so total cannot go negative
    assert.ok(r.result.total >= 0);
  });

  it("boardFootCalc: garbage dimensions fall back to the safe defaults, never NaN BF", () => {
    const r = call("boardFootCalc", ctxA, {
      pieces: [{ thickness: "x", width: NaN, length: "oops", quantity: "two", pricePerBF: Infinity, species: "ash" }],
    });
    assert.equal(r.ok, true);
    // defaults: t=1, w=6, l=96, qty=1 → 4 BF; Infinity price → cpNum/parseFloat path,
    // but the result must stay a finite number, never NaN/Infinity.
    assert.ok(Number.isFinite(r.result.totalBoardFeet), "totalBoardFeet finite");
    assert.ok(Number.isFinite(r.result.pieces[0].boardFeetEach), "boardFeetEach finite");
  });

  it("estimateToInvoice: a non-finite amount is rejected, not coerced to a junk invoice", () => {
    assert.equal(call("estimateToInvoice", ctxA, { estimateId: "e", amount: NaN }).ok, false);
    assert.equal(call("estimateToInvoice", ctxA, { estimateId: "e", amount: Infinity }).result?.ok ?? true, true);
    // Infinity: cpNum(Infinity) → 0 (not finite) → amount<=0 rejects.
    assert.equal(call("estimateToInvoice", ctxA, { estimateId: "e", amount: Infinity }).ok, false);
  });
});

/* ───── DEGRADE-GRACEFUL: STATE-unavailable returns {ok:false}, never throws ───── */

describe("carpentry lens — degrade-graceful when STATE is unavailable", () => {
  beforeEach(() => { globalThis._concordSTATE = undefined; });

  it("STATE-backed macros return {ok:false, error:'STATE unavailable'} (no throw)", () => {
    const stateBacked = [
      ["crewList", {}], ["crewAdd", { name: "Sam" }],
      ["scheduleList", {}], ["timeEntryList", {}],
      ["photoLogList", {}], ["invoiceList", {}],
      ["portalList", {}], ["portalCreate", { client: "X" }],
      ["timerStart", { jobId: "j" }],
      ["estimateToInvoice", { estimateId: "e", amount: 100 }],
    ];
    for (const [name, input] of stateBacked) {
      let r;
      assert.doesNotThrow(() => { r = call(name, ctxA, input); }, `${name} must not throw when STATE is gone`);
      assert.equal(r.ok, false, `${name} should fail-soft`);
      assert.match(String(r.error), /STATE unavailable/i, `${name} error message`);
    }
  });

  it("pure calculators DON'T need STATE — they still compute with STATE gone", () => {
    // boardFootCalc / jointStrength / woodSelection / finishRecommendation are
    // stateless; the CarpentryShop must keep working even if STATE is absent.
    assert.equal(call("boardFootCalc", ctxA, { pieces: [{ thickness: 1, width: 6, length: 96, quantity: 1 }] }).ok, true);
    assert.equal(call("jointStrength", ctxA, { jointType: "dovetail", species: "oak" }).ok, true);
    assert.equal(call("woodSelection", ctxA, { application: "furniture" }).ok, true);
    assert.equal(call("finishRecommendation", ctxA, { species: "oak" }).ok, true);
  });
});
