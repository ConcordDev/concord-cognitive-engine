// Behavioral macro tests for the pharmacy lens — the SAFETY-RELEVANT macros the
// live lens surfaces actually drive through its real frontend channels:
//
//   • FdaDrugReference.tsx / PharmacyActionPanel.tsx
//         → apiHelpers.lens.runDomain('pharmacy', action, { input })  (POST /api/lens/run)
//         → handler(ctx, virtualArtifact, input); virtualArtifact.data === input === params
//         (drug-label, adverse-events, drugInteractionCheck, dosageCalculator)
//   • page.tsx PharmacyAnalysisEngine buttons + RxMedicationsPanel / RxRefillsPanel /
//     RxAdherencePanel / RxHealthLogPanel
//         → lensRun('pharmacy', action, params)  (same dispatch)
//         (dosageCalculator, inventoryAlert, formularySearch, med-add, schedule-set,
//          dose-log, adherence-report, adherence-streak, adherence-calendar,
//          refills-due, price-compare, measurement-history)
//
// This is the PHASE-2 COMPONENT-EXACT-SHAPE layer — it does NOT duplicate the
// behavior-smoke shape coverage. It pins, with the EXACT input the lens sends
// and the EXACT output fields the component renders from `r.result`:
//   - dosageCalculator: weightKg / dosePerKg / singleDose / dailyDose / capped
//     (the exact fields PharmacyActionPanel's dose card + page dosageResult read)
//   - inventoryAlert: lowStock / expired / nearExpiry / alerts[].{name,daysToExpiry}
//   - formularySearch: matches[].{generic,brand,tier,covered,priorAuth} / found
//   - drugInteractionCheck: medicationsChecked / interactionsFound /
//     interactions[].{drug1,drug2,severity,effect} (the FdaDrugReference +
//     page interaction cards) AND coMentions (PharmacyActionPanel) — same data,
//     no phantom field. (network path stubbed via global.fetch)
//   - days-supply (refills-due) + adherence math (real dose-log → streak/report)
//   - VALIDATION-REJECTION: <2 drugs, no dose, empty inventory → honest result
//   - DEGRADE-GRACEFUL: STATE gone → {ok:false} (never throws)
//   - FAIL-CLOSED on poisoned numerics (NaN/Infinity/"abc"/-1): no NaN leaks,
//     no crash, sanitised to safe bounds — a dosing calculator never lies.
//
// Hermetic: a local register harness mirrors the /api/lens/run dispatch. No
// server boot, no real network (fetch is stubbed per-test), no LLM, no DB.

import { describe, it, before, beforeEach, afterEach } from "node:test";
import assert from "node:assert/strict";
import registerPharmacyActions from "../domains/pharmacy.js";

const ACTIONS = new Map();
function register(domain, name, fn) {
  assert.equal(domain, "pharmacy", `unexpected domain: ${domain}`);
  ACTIONS.set(name, fn);
}

// Mirror POST /api/lens/run: `rest = body.input` (already artifact-peeled by the
// dispatch), then virtualArtifact.data = rest AND the 3rd `params` arg = rest.
// So calc macros (read art.data) and trade macros (read params) BOTH see `input`.
async function call(name, ctx, input = {}) {
  const fn = ACTIONS.get(name);
  if (!fn) throw new Error(`pharmacy.${name} not registered`);
  const virtualArtifact = { id: null, domain: "pharmacy", type: "domain_action", data: input, meta: {} };
  return await fn(ctx, virtualArtifact, input);
}

before(() => {
  registerPharmacyActions(register);
});

const realFetch = global.fetch;
beforeEach(() => {
  globalThis._concordSTATE = {};
  globalThis._concordSaveStateDebounced = () => {};
});
afterEach(() => {
  global.fetch = realFetch;
});

const ctxA = { actor: { userId: "user_a", id: "user_a" }, userId: "user_a" };

/* ───────── registration: every safety-relevant macro the lens drives ───────── */

describe("pharmacy lens — registration of the driven macros", () => {
  it("registers every calculator + STATE-backed macro the page + panels call", () => {
    const driven = [
      // pure / network calculators
      "dosageCalculator", "inventoryAlert", "formularySearch",
      "drugInteractionCheck", "drug-label", "adverse-events",
      // medications + schedules + dose logging
      "med-add", "med-list", "schedule-set", "dose-log",
      // adherence + refill math
      "adherence-report", "adherence-streak", "adherence-calendar",
      "refills-due", "today-doses",
      // pharmacy price + health log
      "price-record", "price-compare", "measurement-log", "measurement-history",
    ];
    for (const m of driven) {
      assert.equal(typeof ACTIONS.get(m), "function", `missing pharmacy.${m}`);
    }
  });
});

/* ─── dosageCalculator: the EXACT fields the dose card + page dosageResult render ─── */

describe("pharmacy lens — dosageCalculator (PharmacyActionPanel dose card + page)", () => {
  // PharmacyActionPanel sends { weightKg, dosePerKg, frequencyPerDay, maxDailyDose }
  // and renders weightKg / dosePerKg / singleDose / frequency / dailyDose /
  // maxDailyDose / capped. page.tsx reads the same set.
  it("singleDose = round(weight×dosePerKg×100)/100, dailyDose = round(single×freq)", async () => {
    // 70kg × 10mg/kg = 700mg single ; ×3/day = 2100mg ; cap 4000 not hit
    const r = await call("dosageCalculator", ctxA, {
      weightKg: 70, dosePerKg: 10, frequencyPerDay: 3, maxDailyDose: 4000,
    });
    assert.equal(r.ok, true);
    assert.equal(r.result.weightKg, 70);
    assert.equal(r.result.dosePerKg, 10);
    assert.equal(r.result.singleDose, "700 mg");
    assert.equal(r.result.frequency, "3x daily");
    assert.equal(r.result.dailyDose, "2100 mg");
    assert.equal(r.result.maxDailyDose, "4000 mg");
    assert.equal(r.result.capped, false);
    assert.match(String(r.result.disclaimer), /Verify all dosages/i);
  });

  it("dailyDose is clamped to maxDailyDose and capped:true flags it (the orange card)", async () => {
    // 80kg × 15mg/kg = 1200 single ; ×4 = 4800 daily ; cap 3000 → dailyDose 3000, capped true
    const r = await call("dosageCalculator", ctxA, {
      weightKg: 80, dosePerKg: 15, frequencyPerDay: 4, maxDailyDose: 3000,
    });
    assert.equal(r.ok, true);
    assert.equal(r.result.singleDose, "1200 mg");
    assert.equal(r.result.dailyDose, "3000 mg");
    assert.equal(r.result.capped, true);
  });

  it("fractional single dose rounds to 2dp (round(weight×dosePerKg×100)/100)", async () => {
    // 12.5kg × 0.333mg/kg = 4.1625 → round to 4.16
    const r = await call("dosageCalculator", ctxA, { weightKg: 12.5, dosePerKg: 0.333, frequencyPerDay: 1 });
    assert.equal(r.ok, true);
    assert.equal(r.result.singleDose, "4.16 mg");
    assert.equal(r.result.maxDailyDose, "not specified");
  });

  it("VALIDATION: no dosePerKg returns the honest prompt (the page 'message' branch), not a fake 0mg", async () => {
    const r = await call("dosageCalculator", ctxA, { weightKg: 70, frequencyPerDay: 2 });
    assert.equal(r.ok, true);
    assert.match(String(r.result.message), /Provide dose per kg/i);
    assert.equal(r.result.singleDose, undefined, "no fabricated dose when dose/kg missing");
  });
});

/* ─── inventoryAlert: the EXACT fields the page Inventory Alert card renders ─── */

describe("pharmacy lens — inventoryAlert (page Inventory Alert card)", () => {
  it("flags low stock, expired, and near-expiry with the alerts[] the card lists", async () => {
    const future = new Date(Date.now() + 10 * 86400000).toISOString().slice(0, 10);
    const past = new Date(Date.now() - 5 * 86400000).toISOString().slice(0, 10);
    const r = await call("inventoryAlert", ctxA, {
      inventory: [
        { name: "Aspirin", quantity: 2, reorderPoint: 10, expiryDate: future }, // low + nearExpiry
        { name: "Warfarin", quantity: 100, reorderPoint: 10, expiryDate: past },  // expired
        { name: "Lisinopril", quantity: 100, reorderPoint: 10 },                  // all clear
      ],
    });
    assert.equal(r.ok, true);
    assert.equal(r.result.totalItems, 3);
    assert.equal(r.result.lowStock, 1);
    assert.equal(r.result.expired, 1);
    assert.equal(r.result.nearExpiry, 1);
    assert.equal(r.result.allClear, false);
    // alerts[] only carries the rows the card renders (low/expired/nearExpiry)
    assert.equal(r.result.alerts.length, 2);
    const aspirin = r.result.alerts.find((a) => a.name === "Aspirin");
    assert.equal(aspirin.lowStock, true);
    assert.equal(aspirin.nearExpiry, true);
    assert.equal(aspirin.daysToExpiry, 10);
    const warfarin = r.result.alerts.find((a) => a.name === "Warfarin");
    assert.equal(warfarin.expired, true);
  });

  it("VALIDATION: empty inventory returns the honest prompt (page 'message' branch)", async () => {
    const r = await call("inventoryAlert", ctxA, { inventory: [] });
    assert.equal(r.ok, true);
    assert.match(String(r.result.message), /Add inventory items/i);
  });

  it("allClear:true when nothing is low/expired/near-expiry", async () => {
    const r = await call("inventoryAlert", ctxA, {
      inventory: [{ name: "Metformin", quantity: 90, reorderPoint: 10 }],
    });
    assert.equal(r.ok, true);
    assert.equal(r.result.allClear, true);
    assert.equal(r.result.alerts.length, 0);
  });
});

/* ─── formularySearch: the EXACT match fields the page Formulary card renders ─── */

describe("pharmacy lens — formularySearch (page Formulary Search card)", () => {
  it("matches by generic OR brand and returns generic/brand/tier/covered/priorAuth", async () => {
    const r = await call("formularySearch", ctxA, {
      query: "atorva",
      formulary: [
        { genericName: "atorvastatin", brandName: "Lipitor", tier: 1, covered: true, priorAuth: false },
        { genericName: "metformin", brandName: "Glucophage", tier: 1, covered: true },
        { genericName: "adalimumab", brandName: "Humira", tier: 4, covered: false, priorAuth: true },
      ],
    });
    assert.equal(r.ok, true);
    assert.equal(r.result.query, "atorva");
    assert.equal(r.result.found, 1);
    assert.equal(r.result.formularySize, 3);
    const m = r.result.matches[0];
    assert.equal(m.generic, "atorvastatin");
    assert.equal(m.brand, "Lipitor");
    assert.equal(m.tier, 1);
    assert.equal(m.covered, true);
    assert.equal(m.priorAuth, false);
  });

  it("VALIDATION: empty query returns the honest prompt, not the whole formulary", async () => {
    const r = await call("formularySearch", ctxA, {
      query: "", formulary: [{ genericName: "x", tier: 1 }],
    });
    assert.equal(r.ok, true);
    assert.match(String(r.result.message), /Provide a drug name/i);
  });
});

/* ─── drugInteractionCheck: component-exact-shape with global.fetch stubbed ─── */

describe("pharmacy lens — drugInteractionCheck (FdaDrugReference + page interaction cards)", () => {
  // Stub OpenFDA: two labels where warfarin's interactions text mentions aspirin.
  function stubFda() {
    global.fetch = async (url) => {
      const u = String(url);
      const label = (generic, brand, interactionsText) => ({
        results: [{
          set_id: `set-${generic}`,
          openfda: { generic_name: [generic], brand_name: [brand], manufacturer_name: ["ACME"] },
          drug_interactions: [interactionsText],
          warnings: ["General warnings."],
        }],
      });
      if (/warfarin/i.test(u)) {
        return { ok: true, status: 200, json: async () => label("warfarin", "Coumadin", "Concurrent aspirin increases bleeding risk.") };
      }
      if (/aspirin/i.test(u)) {
        return { ok: true, status: 200, json: async () => label("aspirin", "Bayer", "Use caution with anticoagulants.") };
      }
      return { ok: false, status: 404, json: async () => ({}) };
    };
  }

  it("returns medicationsChecked + interactionsFound + interactions[] (no phantom field)", async () => {
    stubFda();
    // FdaDrugReference + page send { medications: [a, b] }
    const r = await call("drugInteractionCheck", ctxA, { medications: ["warfarin", "aspirin"] });
    assert.equal(r.ok, true);
    // page.tsx + FdaDrugReference both read medicationsChecked
    assert.equal(r.result.medicationsChecked, 2);
    assert.equal(r.result.interactionsFound, 1);
    // interactions[] (FdaDrugReference InteractionsPanel + page list) === coMentions
    // (PharmacyActionPanel) — same real data, with the real effect string.
    assert.equal(r.result.interactions.length, 1);
    assert.deepEqual(r.result.interactions, r.result.coMentions);
    const ix = r.result.interactions[0];
    assert.equal(ix.drug1, "warfarin");
    assert.equal(ix.drug2, "aspirin");
    assert.equal(ix.severity, "review-label");
    // `effect` is a real grounded string the InteractionCard renders, not blank
    assert.equal(typeof ix.effect, "string");
    assert.ok(ix.effect.length > 0);
    // warfarin's label mentions aspirin → aMentionsB direction reflected in effect
    assert.match(ix.effect, /warfarin|aspirin/i);
    // medications[] (PharmacyActionPanel) carries the real names too
    assert.deepEqual(r.result.medications, ["warfarin", "aspirin"]);
  });

  it("no co-mention → interactionsFound 0 and empty interactions[] (the green 'no mentions' card)", async () => {
    global.fetch = async (url) => {
      const u = String(url);
      const label = (g, b) => ({ results: [{ set_id: `s-${g}`, openfda: { generic_name: [g], brand_name: [b] }, drug_interactions: ["No relevant interactions."], warnings: [""] }] });
      if (/metformin/i.test(u)) return { ok: true, status: 200, json: async () => label("metformin", "Glucophage") };
      if (/vitamin/i.test(u)) return { ok: true, status: 200, json: async () => label("vitamin c", "Cecon") };
      return { ok: false, status: 404, json: async () => ({}) };
    };
    const r = await call("drugInteractionCheck", ctxA, { medications: ["metformin", "vitamin c"] });
    assert.equal(r.ok, true);
    assert.equal(r.result.interactionsFound, 0);
    assert.equal(r.result.interactions.length, 0);
    assert.equal(r.result.medicationsChecked, 2);
  });

  it("VALIDATION: fewer than 2 medications is rejected (never an empty fake 'all clear')", async () => {
    const r = await call("drugInteractionCheck", ctxA, { medications: ["warfarin"] });
    assert.equal(r.ok, false);
    assert.match(String(r.error), /at least 2 medications/i);
    assert.equal(r.result, undefined);
  });

  it("DEGRADE-GRACEFUL: OpenFDA unreachable returns {ok:false} with a real error (no throw)", async () => {
    global.fetch = async () => { throw new Error("network down"); };
    let r;
    await assert.doesNotReject(async () => { r = await call("drugInteractionCheck", ctxA, { medications: ["a", "b"] }); });
    assert.equal(r.ok, false);
    assert.match(String(r.error), /unreachable/i);
  });
});

/* ─── days-supply (refills-due) + adherence math: real dose-log → derived state ─── */

describe("pharmacy lens — days-supply + adherence math (real STATE round-trip)", () => {
  it("refills-due computes daysOfSupply = floor(quantity / scheduledPerDay) and urgency", async () => {
    // Add a med with 6 tablets, schedule twice daily → 3 days supply → 'soon'
    const add = await call("med-add", ctxA, { name: "Lisinopril", quantity: 6 });
    assert.equal(add.ok, true);
    const medId = add.result.medication.id;
    const sched = await call("schedule-set", ctxA, { medId, times: ["08:00", "20:00"] });
    assert.equal(sched.ok, true);
    const due = await call("refills-due", ctxA, {});
    assert.equal(due.ok, true);
    const row = due.result.due.find((d) => d.medId === medId);
    assert.ok(row, "expected the low-supply med in refills-due");
    assert.equal(row.daysOfSupply, 3); // floor(6 / 2)
    assert.equal(row.urgency, "soon"); // >2 days → soon
    assert.equal(row.name, "Lisinopril");
  });

  it("dose-log taken decrements quantity; adherence-report computes overall pct", async () => {
    const add = await call("med-add", ctxA, { name: "Metformin", quantity: 30 });
    const medId = add.result.medication.id;
    await call("schedule-set", ctxA, { medId, times: ["09:00"] }); // 1/day
    const log = await call("dose-log", ctxA, { medId, status: "taken", scheduledTime: "09:00" });
    assert.equal(log.ok, true);
    assert.equal(log.result.quantityRemaining, 29); // 30 - 1
    const rep = await call("adherence-report", ctxA, { days: 30 });
    assert.equal(rep.ok, true);
    // 1 taken of 30 scheduled (1/day × 30) → ~3%
    const perMed = rep.result.perMed.find((m) => m.medId === medId);
    assert.ok(perMed);
    assert.equal(perMed.scheduled, 30);
    assert.equal(perMed.taken, 1);
    assert.equal(perMed.pct, 3); // round(1/30*100)
    assert.equal(typeof rep.result.overall, "number");
  });

  it("adherence-streak reports currentStreak/bestStreak/totalDosesTaken + nextMilestone", async () => {
    const add = await call("med-add", ctxA, { name: "Atorvastatin", quantity: 30 });
    const medId = add.result.medication.id;
    await call("schedule-set", ctxA, { medId, times: ["21:00"] });
    await call("dose-log", ctxA, { medId, status: "taken", scheduledTime: "21:00" });
    const st = await call("adherence-streak", ctxA, {});
    assert.equal(st.ok, true);
    assert.equal(typeof st.result.currentStreak, "number");
    assert.equal(typeof st.result.bestStreak, "number");
    assert.equal(st.result.totalDosesTaken, 1);
    assert.equal(st.result.nextMilestone, 3); // < 3 → next badge at 3
    assert.ok(Array.isArray(st.result.badges));
  });

  it("price-compare computes lowest/highest/savings/savingsPct over recorded quotes", async () => {
    await call("price-record", ctxA, { drugName: "Atorvastatin", cashPrice: 40, pharmacyName: "CVS" });
    await call("price-record", ctxA, { drugName: "Atorvastatin", cashPrice: 12, pharmacyName: "Costco" });
    const cmp = await call("price-compare", ctxA, { drugName: "Atorvastatin" });
    assert.equal(cmp.ok, true);
    assert.equal(cmp.result.lowest, 12);
    assert.equal(cmp.result.highest, 40);
    assert.equal(cmp.result.savings, 28);
    assert.equal(cmp.result.savingsPct, 70); // round((40-12)/40*100)
    assert.equal(cmp.result.quotes[0].isBest, true);
    assert.equal(cmp.result.quotes[0].rank, 1);
  });
});

/* ─── FAIL-CLOSED: poisoned numerics must sanitise, never leak NaN / crash ─── */

describe("pharmacy lens — fail-closed on poisoned numeric inputs", () => {
  it("dosageCalculator: garbage weight/freq fall back to safe defaults, never NaN", async () => {
    // weight "abc" → parseFloat NaN → ||70 ; freq "x" → parseInt NaN → ||1.
    const r = await call("dosageCalculator", ctxA, {
      weightKg: "abc", dosePerKg: 5, frequencyPerDay: "x", maxDailyDose: NaN,
    });
    assert.equal(r.ok, true);
    // 70 × 5 = 350 single ; ×1 = 350 daily ; NaN max → Infinity → not specified
    assert.equal(r.result.singleDose, "350 mg");
    assert.equal(r.result.dailyDose, "350 mg");
    assert.equal(r.result.maxDailyDose, "not specified");
    assert.equal(r.result.capped, false);
    // never a NaN leak in the rendered numeric fields
    assert.ok(Number.isFinite(r.result.weightKg) && Number.isFinite(r.result.dosePerKg));
  });

  it("dosageCalculator: Infinity/NaN dosePerKg is treated as missing dose (honest prompt), never 'Infinity mg'", async () => {
    // FAIL-CLOSED: a non-finite dose/kg must NOT print "Infinity mg" / "NaN mg".
    // The fin() guard sanitises it to 0 → the calculator returns the honest prompt
    // instead of a poisoned dose.
    for (const poison of [Infinity, -Infinity, NaN, "Infinity"]) {
      const r = await call("dosageCalculator", ctxA, { weightKg: 70, dosePerKg: poison, frequencyPerDay: 1 });
      assert.equal(r.ok, true);
      assert.equal(r.result.singleDose, undefined, `dosePerKg=${poison} must not yield a dose`);
      assert.match(String(r.result.message), /Provide dose per kg/i);
    }
  });

  it("inventoryAlert: NaN/negative quantities never crash and never produce NaN counts", async () => {
    const r = await call("inventoryAlert", ctxA, {
      inventory: [
        { name: "junk", quantity: NaN, reorderPoint: "x" },
        { name: "neg", quantity: -5, reorderPoint: 10, expiryDate: "not-a-date" },
      ],
    });
    assert.equal(r.ok, true);
    for (const k of ["totalItems", "lowStock", "expired", "nearExpiry"]) {
      assert.ok(Number.isFinite(r.result[k]), `${k} must be finite, got ${r.result[k]}`);
    }
  });

  it("price-compare: poisoned cashPrice is rejected at record time (never a NaN quote)", async () => {
    const bad = await call("price-record", ctxA, { drugName: "X", cashPrice: NaN });
    assert.equal(bad.ok, false);
    const bad2 = await call("price-record", ctxA, { drugName: "X", cashPrice: -10 });
    assert.equal(bad2.ok, false);
  });
});

/* ─── DEGRADE-GRACEFUL: STATE-unavailable returns {ok:false}, never throws ─── */

describe("pharmacy lens — degrade-graceful when STATE is unavailable", () => {
  beforeEach(() => { globalThis._concordSTATE = undefined; });

  it("STATE-backed macros return {ok:false, error:'STATE unavailable'} (no throw)", async () => {
    const stateBacked = [
      ["med-list", {}], ["med-add", { name: "Aspirin" }],
      ["refills-due", {}], ["adherence-report", { days: 30 }],
      ["adherence-streak", {}], ["adherence-calendar", { days: 56 }],
      ["today-doses", {}], ["price-compare", { drugName: "x" }],
      ["measurement-history", { kind: "weight" }],
    ];
    for (const [name, input] of stateBacked) {
      let r;
      await assert.doesNotReject(async () => { r = await call(name, ctxA, input); }, `${name} must not throw when STATE is gone`);
      assert.equal(r.ok, false, `${name} should fail-soft`);
      assert.match(String(r.error), /STATE unavailable/i, `${name} error message`);
    }
  });

  it("pure calculators DON'T need STATE — they still compute with STATE gone", async () => {
    assert.equal((await call("dosageCalculator", ctxA, { weightKg: 70, dosePerKg: 5, frequencyPerDay: 1 })).ok, true);
    assert.equal((await call("inventoryAlert", ctxA, { inventory: [{ name: "x", quantity: 1, reorderPoint: 10 }] })).ok, true);
    assert.equal((await call("formularySearch", ctxA, { query: "asp", formulary: [{ genericName: "aspirin", tier: 1 }] })).ok, true);
  });
});
