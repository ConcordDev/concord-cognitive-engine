// Contract tests for mining.pit-optimize — the ultimate-pit optimizer that
// layers a maximum-weight-closure economic solve (Lerchs-Grossmann via
// Picard's max-flow/min-cut construction; see the citation comment above the
// macro in server/domains/mining.js) on top of the real IDW block model that
// mining.block-model already builds from logged drill-hole assays.
//
// Every "expected" number below is either (a) hand-derived from the exact
// documented block-value formula against grades the code itself already
// prints (verified by running the real macros — see the derivation comments
// inline), or (b) computed by an INDEPENDENT brute-force search over the
// small (<=64-subset) precedence-valid closures, written from scratch in
// this file rather than by calling any of pit-optimize's own machinery.
// This is the "compute-don't-guess" methodology from CLAUDE.md: the engine
// (block-model) is trusted as the grade oracle, and the NEW optimizer logic
// (economic value + slope precedence + max-weight closure) is what's
// independently re-derived and checked against.
//
// Same lightweight direct-call harness as tests/mining-domain-parity.test.js
// (register the domain against a fake globalThis._concordSTATE, call
// handlers directly) — no full server boot needed since these are pure
// STATE-backed handlers.

import { describe, it, before, beforeEach } from "node:test";
import assert from "node:assert/strict";
import registerMiningActions from "../domains/mining.js";

const ACTIONS = new Map();
function register(domain, name, fn) { ACTIONS.set(`${domain}.${name}`, fn); }
function call(name, ctx, params = {}) {
  const fn = ACTIONS.get(`mining.${name}`);
  assert.ok(fn, `mining.${name} not registered`);
  return fn(ctx, { id: null, data: {}, meta: {} }, params);
}

before(() => { registerMiningActions(register); });
beforeEach(() => {
  globalThis._concordSTATE = { dtus: new Map() };
  globalThis._concordSaveStateDebounced = () => {};
});

const ctxA = { actor: { userId: "user_a" }, userId: "user_a" };

function addHole(ctx, name, x, collarZ) {
  return call("drillhole-add", ctx, { name, collarX: x, collarY: 0, collarZ, azimuth: 0, dip: -90, totalDepth: 60 }).result.hole;
}

// A single vertical hole: a low-grade shallow interval (economically
// unprocessable waste on its own) sitting directly above a rich deep
// interval. Since nx=ny=1 (one drill trace, no lateral spread), the only
// precedence relationship is "the bottom block requires the top block" —
// this isolates the VERTICAL chain case: is it worth removing an
// unprofitable overburden block purely because it unlocks a profitable
// block underneath?
function seedVerticalChain(ctx) {
  const h = addHole(ctx, "V", 0, 100);
  call("drillhole-log-interval", ctx, { holeId: h.id, from: 4, to: 6, assayGrade: 0.05 });   // mid=5  -> z=95 (shallow, lean)
  call("drillhole-log-interval", ctx, { holeId: h.id, from: 34, to: 36, assayGrade: 8.0 });  // mid=35 -> z=65 (deep, rich)
  return h;
}

// Three holes spread along X (-20, 0, +20) at blockSize=15 -> a 3x1x2
// grid (6 blocks). The center hole alone carries a rich deep interval;
// the two side holes carry only a lean shallow interval, and the RIGHT
// hole additionally carries a low-grade interval anchored almost exactly
// at its own deep block's center (mid=27 -> z=73, block center z=73) so
// that block's IDW grade is pulled down to the anchor's own lean value
// instead of leaking a big chunk of the center composite's richness in
// from lateral distance. This isolates the LATERAL case: a 45-degree
// slope (radius 1 block/level) means the CENTER deep block requires ALL
// THREE shallow blocks above it, so all three get dragged in as "must
// remove overburden" even though two of them have no economic deep block
// of their own directly below — while the deep block on the right,
// which turns out uneconomic on its own, must be correctly EXCLUDED even
// though its own required predecessors (the two blocks above it) are
// already included for other reasons.
function seedThreeColumn(ctx) {
  const hC = addHole(ctx, "C", 0, 100);
  call("drillhole-log-interval", ctx, { holeId: hC.id, from: 4, to: 6, assayGrade: 0.05 });
  call("drillhole-log-interval", ctx, { holeId: hC.id, from: 34, to: 36, assayGrade: 8.0 });

  const hL = addHole(ctx, "L", -20, 100);
  call("drillhole-log-interval", ctx, { holeId: hL.id, from: 4, to: 6, assayGrade: 0.05 });

  const hR = addHole(ctx, "R", 20, 100);
  call("drillhole-log-interval", ctx, { holeId: hR.id, from: 4, to: 6, assayGrade: 0.05 });
  call("drillhole-log-interval", ctx, { holeId: hR.id, from: 26, to: 28, assayGrade: 0.05 }); // anchor at its own deep block
}

const ECON = { metalPricePerTonne: 5000, recoveryPercent: 100, miningCostPerTonne: 10, processingCostPerTonne: 100, densityTonM3: 1 };

// Independent block-value re-derivation (NOT calling into mining.js) —
// mirrors the documented formula in the pit-optimize comment block:
//   revenue = tonnage * (grade/100) * (recovery/100) * price
//   processedValue = revenue - tonnage*processingCostPerTonne
//   value = max(processedValue, 0) - tonnage*miningCostPerTonne
function economicValue(grade, blockSize, econ) {
  const tonnage = blockSize * blockSize * blockSize * econ.densityTonM3;
  const revenue = tonnage * (grade / 100) * (econ.recoveryPercent / 100) * econ.metalPricePerTonne;
  const processingCost = tonnage * econ.processingCostPerTonne;
  const miningCost = tonnage * econ.miningCostPerTonne;
  const processedValue = revenue - processingCost;
  const processed = processedValue > 0;
  return { value: (processed ? processedValue : 0) - miningCost, processed, tonnage };
}

// Independent brute-force search over every precedence-valid subset of a
// small block list (grid dims + slope radius R). Written from scratch —
// does not call _maxFlowMinCut or any pit-optimize internals — so a match
// against pit-optimize's actual output is a genuine correctness check on
// the max-flow/min-cut implementation, not a tautology.
function bruteForceOptimalPit(blocks, nz, R, valueOf) {
  const n = blocks.length;
  const byKey = new Map(blocks.map((b, i) => [`${b.ix}_${b.iy}_${b.iz}`, i]));
  const required = blocks.map((b) => {
    if (b.iz === nz - 1) return [];
    const reqs = [];
    for (let dx = -R; dx <= R; dx++) {
      for (let dy = -R; dy <= R; dy++) {
        if (dx * dx + dy * dy > R * R) continue;
        const key = `${b.ix + dx}_${b.iy + dy}_${b.iz + 1}`;
        if (byKey.has(key)) reqs.push(byKey.get(key));
      }
    }
    return reqs;
  });
  const values = blocks.map((b) => valueOf(b));
  let bestProfit = 0; // "select nothing" is always a valid, zero-profit closure
  let bestMask = 0;
  for (let mask = 0; mask < (1 << n); mask++) {
    let valid = true;
    for (let i = 0; i < n && valid; i++) {
      if (!(mask & (1 << i))) continue;
      for (const r of required[i]) { if (!(mask & (1 << r))) { valid = false; break; } }
    }
    if (!valid) continue;
    let profit = 0;
    for (let i = 0; i < n; i++) if (mask & (1 << i)) profit += values[i];
    if (profit > bestProfit) { bestProfit = profit; bestMask = mask; }
  }
  const bestSet = new Set();
  for (let i = 0; i < n; i++) if (bestMask & (1 << i)) bestSet.add(i);
  return { bestProfit, bestSet };
}

describe("mining.pit-optimize — vertical precedence chain (hand-derived)", () => {
  it("includes an unprofitable shallow block ONLY because it unlocks a profitable deep block below it", () => {
    seedVerticalChain(ctxA);
    const bm = call("block-model", ctxA, { blockSize: 15, cutoffGrade: 0 });
    assert.equal(bm.result.dimensions.nx, 1);
    assert.equal(bm.result.dimensions.ny, 1);
    assert.equal(bm.result.dimensions.nz, 2);
    const top = bm.result.blocks.find((b) => b.iz === 1);
    const deep = bm.result.blocks.find((b) => b.iz === 0);

    const vTop = economicValue(top.grade, 15, ECON);
    const vDeep = economicValue(deep.grade, 15, ECON);
    assert.ok(vTop.value < 0, "shallow block must be independently unprofitable for this to be a real test of precedence");
    assert.ok(vDeep.value > 0, "deep block must be independently profitable");
    assert.ok(vTop.value + vDeep.value > 0, "the full column must still be net-positive");

    const r = call("pit-optimize", ctxA, { blockSize: 15, slopeAngle: 45, ...ECON });
    assert.equal(r.ok, true);
    assert.equal(r.result.selectedCount, 2, "both blocks must be selected — the chain is only viable as a whole");
    assert.equal(r.result.blockCount, 2);
    const byIz = Object.fromEntries(r.result.pitBlocks.map((b) => [b.iz, b]));
    assert.equal(Math.round(byIz[1].value), Math.round(vTop.value));
    assert.equal(Math.round(byIz[0].value), Math.round(vDeep.value));
    assert.equal(byIz[1].processed, false);
    assert.equal(byIz[0].processed, true);
    assert.equal(r.result.totalValue, Math.round((vTop.value + vDeep.value) * 100) / 100);
    assert.equal(r.result.oreTonnes, Math.round(vDeep.tonnage));
    assert.equal(r.result.wasteTonnes, Math.round(vTop.tonnage));
  });
});

describe("mining.pit-optimize — lateral slope precedence + selective exclusion (brute-force verified)", () => {
  it("pulls in all three overburden columns for the profitable center ore, but excludes the uneconomic right-side deep block even though its own predecessors are already mined", () => {
    seedThreeColumn(ctxA);
    const bm = call("block-model", ctxA, { blockSize: 15, cutoffGrade: 0 });
    assert.equal(bm.result.dimensions.nx, 3);
    assert.equal(bm.result.dimensions.ny, 1);
    assert.equal(bm.result.dimensions.nz, 2);

    const r = call("pit-optimize", ctxA, { blockSize: 15, slopeAngle: 45, ...ECON });
    assert.equal(r.ok, true);
    assert.equal(r.result.blockCount, 6);

    // Independent ground truth: brute force every precedence-valid subset
    // of the ACTUAL block-model grades (not pit-optimize's own selection).
    const R = 1; // slopeAngle=45 -> round(1/tan(45deg)) = 1
    const { bestProfit, bestSet } = bruteForceOptimalPit(
      bm.result.blocks, bm.result.dimensions.nz, R,
      (b) => economicValue(b.grade, 15, ECON).value,
    );
    const expectedKeys = new Set([...bestSet].map((i) => {
      const b = bm.result.blocks[i];
      return `${b.ix}_${b.iy}_${b.iz}`;
    }));
    const actualKeys = new Set(r.result.pitBlocks.map((b) => `${b.ix}_${b.iy}_${b.iz}`));
    assert.deepEqual(actualKeys, expectedKeys, "pit-optimize's selected blocks must exactly match the brute-forced optimal closure");
    assert.equal(r.result.selectedCount, expectedKeys.size);
    assert.equal(r.result.totalValue, Math.round(bestProfit * 100) / 100);

    // And spell out the specific hand-derived shape this fixture was built
    // for, so a future reader doesn't have to re-run the brute force to
    // see what "optimal" means here: all three iz=1 (top) blocks in, the
    // center + left iz=0 (deep) blocks in, the right iz=0 deep block OUT.
    assert.equal(expectedKeys.size, 5);
    assert.equal(actualKeys.has("2_0_0"), false, "the right-side deep block is uneconomic on its own and must be excluded");
    assert.equal(actualKeys.has("2_0_1"), true, "the right-side TOP block is still required — the center deep block's slope cone reaches it");
    assert.equal(actualKeys.has("1_0_0"), true, "the center deep (ore) block must be included");
    assert.equal(r.result.stripRatio, 1.5); // 3 waste blocks / 2 ore blocks
  });

  it("is deterministic: identical inputs produce an identical pit shell", () => {
    seedThreeColumn(ctxA);
    const r1 = call("pit-optimize", ctxA, { blockSize: 15, slopeAngle: 45, ...ECON });

    globalThis._concordSTATE = { dtus: new Map() };
    seedThreeColumn(ctxA);
    const r2 = call("pit-optimize", ctxA, { blockSize: 15, slopeAngle: 45, ...ECON });

    assert.deepEqual(r1.result.pitBlocks, r2.result.pitBlocks);
    assert.equal(r1.result.totalValue, r2.result.totalValue);
    assert.equal(r1.result.selectedCount, r2.result.selectedCount);
  });
});

describe("mining.pit-optimize — honest empty results (no fabricated selections)", () => {
  it("returns an empty, honest note when no drill-holes are logged", () => {
    const r = call("pit-optimize", ctxA, { blockSize: 15, ...ECON });
    assert.equal(r.ok, true);
    assert.equal(r.result.pitBlocks.length, 0);
    assert.equal(r.result.blockCount, 0);
    assert.ok(r.result.note);
  });

  it("returns an empty, honest note when no logged interval has a positive grade", () => {
    const h = addHole(ctxA, "Z", 0, 100);
    call("drillhole-log-interval", ctxA, { holeId: h.id, from: 0, to: 10, assayGrade: 0 });
    const r = call("pit-optimize", ctxA, { blockSize: 15, ...ECON });
    assert.equal(r.ok, true);
    assert.equal(r.result.pitBlocks.length, 0);
    assert.ok(r.result.note);
  });

  it("selects NO blocks — not a fabricated fallback pit — when nothing pencils out economically", () => {
    seedThreeColumn(ctxA);
    const r = call("pit-optimize", ctxA, {
      blockSize: 15, slopeAngle: 45,
      metalPricePerTonne: 1, recoveryPercent: 100, miningCostPerTonne: 10, processingCostPerTonne: 100, densityTonM3: 1,
    });
    assert.equal(r.ok, true);
    assert.equal(r.result.selectedCount, 0);
    assert.equal(r.result.pitBlocks.length, 0);
    assert.equal(r.result.totalValue, 0);
    assert.equal(r.result.oreTonnes, 0);
    assert.equal(r.result.wasteTonnes, 0);
    assert.equal(r.result.stripRatio, null);
  });
});

describe("mining.pit-optimize — honest disclosure of defaults and estimate status", () => {
  it("discloses every economic parameter that fell back to a default", () => {
    seedVerticalChain(ctxA);
    const r = call("pit-optimize", ctxA, { blockSize: 15, slopeAngle: 45 }); // no economic params supplied
    assert.equal(r.ok, true);
    assert.ok(r.result.defaultsUsed.length >= 5, "price/recovery/miningCost/processingCost/density should all be disclosed as defaults");
    assert.ok(r.result.defaultsUsed.some((d) => d.startsWith("metalPricePerTonne=")));
    assert.ok(r.result.defaultsUsed.some((d) => d.startsWith("recoveryPercent=")));
    assert.ok(r.result.defaultsUsed.some((d) => d.startsWith("miningCostPerTonne=")));
    assert.ok(r.result.defaultsUsed.some((d) => d.startsWith("processingCostPerTonne=")));
    assert.ok(r.result.defaultsUsed.some((d) => d.startsWith("densityTonM3=")));
    assert.deepEqual(r.result.economicParamsUsed, {
      metalPricePerTonne: 5000, recoveryPercent: 85, miningCostPerTonne: 3, processingCostPerTonne: 12, densityTonM3: 2.7,
    });
  });

  it("discloses NO defaults when every economic param is explicitly supplied", () => {
    seedVerticalChain(ctxA);
    const r = call("pit-optimize", ctxA, { blockSize: 15, slopeAngle: 45, ...ECON });
    assert.equal(r.ok, true);
    assert.deepEqual(r.result.defaultsUsed, []);
  });

  it("never claims to be a measured reserve — the estimate disclosure is always present", () => {
    seedVerticalChain(ctxA);
    const r = call("pit-optimize", ctxA, { blockSize: 15, slopeAngle: 45, ...ECON });
    assert.equal(r.ok, true);
    assert.match(r.result.disclosure, /ESTIMATE/);
    assert.match(r.result.disclosure, /NOT a JORC/);
    assert.match(r.result.algorithm, /Lerchs-Grossmann/);
  });
});
