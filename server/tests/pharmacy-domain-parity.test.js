// Contract tests for server/domains/pharmacy.js — pure-compute helpers
// (dosage, inventory, formulary) plus real OpenFDA Drug API integration.

import { describe, it, before, beforeEach } from "node:test";
import assert from "node:assert/strict";
import registerPharmacyActions from "../domains/pharmacy.js";

const ACTIONS = new Map();
function register(domain, name, fn) { ACTIONS.set(`${domain}.${name}`, fn); }
function call(name, ctx, artifactOrParams = {}, maybeParams) {
  const fn = ACTIONS.get(`pharmacy.${name}`);
  if (!fn) throw new Error(`pharmacy.${name} not registered`);
  const artifact = arguments.length === 4 ? artifactOrParams : { id: null, data: {}, meta: {} };
  const params = arguments.length === 4 ? (maybeParams || {}) : artifactOrParams;
  return fn(ctx, artifact, params);
}

before(() => { registerPharmacyActions(register); });

beforeEach(() => {
  globalThis.fetch = async () => { throw new Error("network disabled in tests"); };
  delete process.env.OPENFDA_API_KEY;
});

const ctxA = { actor: { userId: "user_a" }, userId: "user_a" };

describe("pharmacy.dosageCalculator (pure compute)", () => {
  it("computes single + daily dose from weight × dosePerKg × freq", () => {
    const r = call("dosageCalculator", ctxA, { data: { weightKg: 70, dosePerKg: 10, frequencyPerDay: 3, maxDailyDose: 4000 } }, {});
    assert.equal(r.result.singleDose, "700 mg");
    assert.equal(r.result.dailyDose, "2100 mg");
    assert.equal(r.result.capped, false);
  });
});

describe("pharmacy.drugInteractionCheck (real OpenFDA SPL)", () => {
  it("rejects fewer than 2 medications", async () => {
    const r = await call("drugInteractionCheck", ctxA, { data: { medications: ["aspirin"] } }, {});
    assert.equal(r.ok, false);
    assert.match(r.error, /at least 2/);
  });

  it("fetches each drug's SPL label + detects cross-mentions (warfarin ↔ aspirin)", async () => {
    let urlCount = 0;
    globalThis.fetch = async (url) => {
      urlCount++;
      const isAspirin = url.includes("aspirin");
      return {
        ok: true,
        json: async () => ({
          results: [{
            set_id: isAspirin ? "asp-set-id" : "warf-set-id",
            openfda: {
              generic_name: [isAspirin ? "aspirin" : "warfarin sodium"],
              brand_name: [isAspirin ? "Bayer Aspirin" : "Coumadin"],
              manufacturer_name: [isAspirin ? "Bayer" : "Bristol-Myers Squibb"],
            },
            drug_interactions: [isAspirin
              ? "Anticoagulants such as warfarin sodium (Coumadin) increase bleeding risk when co-administered with aspirin."
              : "NSAIDs including aspirin (Bayer Aspirin) may increase the anticoagulant effect of warfarin sodium."],
            warnings: ["Standard hemorrhage warnings apply."],
          }],
        }),
      };
    };
    const r = await call("drugInteractionCheck", ctxA, {
      data: { medications: ["warfarin", "aspirin"] },
    }, {});
    assert.equal(r.ok, true);
    assert.equal(urlCount, 2);  // one fetch per drug
    assert.equal(r.result.interactionsFound, 1);
    assert.equal(r.result.coMentions[0].drug1, "warfarin");
    assert.equal(r.result.coMentions[0].drug2, "aspirin");
    assert.equal(r.result.coMentions[0].aMentionsB, true);
    assert.equal(r.result.coMentions[0].bMentionsA, true);
    assert.match(r.result.disclaimer, /Lexicomp/);
    assert.equal(r.result.source, "openfda-drug-label");
  });

  it("handles drugs not found in OpenFDA (404 per drug)", async () => {
    globalThis.fetch = async () => ({ ok: false, status: 404, json: async () => ({}) });
    const r = await call("drugInteractionCheck", ctxA, {
      data: { medications: ["xyzbogus1", "xyzbogus2"] },
    }, {});
    assert.equal(r.ok, true);
    // No labels found → no interactions surfaced (correct behavior)
    assert.equal(r.result.interactionsFound, 0);
    assert.equal(r.result.labels[0].found, false);
  });

  it("surfaces 429 rate-limit with helpful key-setup pointer", async () => {
    globalThis.fetch = async () => ({ ok: false, status: 429, json: async () => ({}) });
    const r = await call("drugInteractionCheck", ctxA, {
      data: { medications: ["aspirin", "warfarin"] },
    }, {});
    assert.equal(r.ok, false);
    assert.match(r.error, /rate limit exceeded.*OPENFDA_API_KEY/);
  });

  it("uses OPENFDA_API_KEY env when set", async () => {
    process.env.OPENFDA_API_KEY = "test-key";
    let capturedUrl = "";
    globalThis.fetch = async (url) => {
      capturedUrl = url;
      return { ok: true, json: async () => ({ results: [] }) };
    };
    await call("drugInteractionCheck", ctxA, { data: { medications: ["a", "b"] } }, {});
    assert.match(capturedUrl, /api_key=test-key/);
  });
});

describe("pharmacy.drug-label (real OpenFDA)", () => {
  it("rejects missing drug", async () => {
    const r = await call("drug-label", ctxA, {});
    assert.equal(r.ok, false);
  });

  it("hits OpenFDA + shapes the label response", async () => {
    let capturedUrl = "";
    globalThis.fetch = async (url) => {
      capturedUrl = url;
      return {
        ok: true,
        json: async () => ({
          results: [{
            set_id: "abc-set-id",
            openfda: {
              generic_name: ["atorvastatin calcium"],
              brand_name: ["Lipitor"],
              manufacturer_name: ["Pfizer"],
              product_type: ["HUMAN PRESCRIPTION DRUG"],
              route: ["ORAL"],
              rxotc: ["RX"],
            },
            indications_and_usage: ["INDICATIONS AND USAGE\nLipitor is indicated to reduce the risk of MI, stroke..."],
            warnings: ["WARNINGS AND PRECAUTIONS\nMyopathy/Rhabdomyolysis..."],
            mechanism_of_action: ["MECHANISM OF ACTION\nLipitor is a selective, competitive inhibitor of HMG-CoA reductase..."],
            pregnancy: ["Pregnancy Category X"],
          }],
        }),
      };
    };
    const r = await call("drug-label", ctxA, { drug: "Lipitor" });
    assert.equal(r.ok, true);
    assert.match(capturedUrl, /api\.fda\.gov\/drug\/label\.json/);
    assert.equal(r.result.brandName, "Lipitor");
    assert.equal(r.result.genericName, "atorvastatin calcium");
    assert.equal(r.result.rxOtc, "RX");
    assert.match(r.result.indications, /reduce the risk/);
    assert.match(r.result.mechanismOfAction, /HMG-CoA reductase/);
    assert.equal(r.result.source, "openfda-drug-label");
  });

  it("returns clear 404 when drug doesn't exist in OpenFDA", async () => {
    globalThis.fetch = async () => ({ ok: false, status: 404, json: async () => ({}) });
    const r = await call("drug-label", ctxA, { drug: "xyzbogus" });
    assert.equal(r.ok, false);
    assert.match(r.error, /no FDA label found/);
  });
});

describe("pharmacy.adverse-events (real OpenFDA FAERS)", () => {
  it("rejects missing drug", async () => {
    assert.equal((await call("adverse-events", ctxA, {})).ok, false);
  });

  it("hits FAERS + aggregates top reactions", async () => {
    let capturedUrl = "";
    globalThis.fetch = async (url) => {
      capturedUrl = url;
      return {
        ok: true,
        json: async () => ({
          results: [
            { term: "HEADACHE", count: 1450 },
            { term: "NAUSEA", count: 980 },
            { term: "DIZZINESS", count: 620 },
          ],
        }),
      };
    };
    const r = await call("adverse-events", ctxA, { drug: "Lipitor" });
    assert.equal(r.ok, true);
    assert.match(capturedUrl, /api\.fda\.gov\/drug\/event\.json/);
    assert.match(capturedUrl, /patient\.drug\.medicinalproduct/);
    assert.equal(r.result.reportCount, 3050);
    assert.equal(r.result.topReactions[0].term, "HEADACHE");
    assert.match(r.result.disclaimer, /voluntary submissions.*causality/);
  });

  it("handles 404 (no reports) gracefully as ok:true with 0 reports", async () => {
    globalThis.fetch = async () => ({ ok: false, status: 404, json: async () => ({}) });
    const r = await call("adverse-events", ctxA, { drug: "xyzbogus" });
    assert.equal(r.ok, true);
    assert.equal(r.result.reportCount, 0);
    assert.deepEqual(r.result.topReactions, []);
  });
});

// ─── Feature-parity backlog: Medisafe + GoodRx 2026 ──────────────────
// Dose reminders, caregiver alerts, live price lookup, pill identifier,
// refill auto-reorder, graded interactions, adherence gamification.
// STATE-backed macros need a fresh STATE per test.

describe("pharmacy backlog: dose reminders", () => {
  beforeEach(() => {
    globalThis._concordSTATE = { dtus: new Map() };
    globalThis._concordSaveStateDebounced = () => {};
  });

  function freshMed() {
    return call("med-add", ctxA, { name: "Lisinopril", quantity: 30 }).result.medication;
  }

  it("reminder-set requires a med + valid HH:MM time, lists and toggles", () => {
    assert.equal(call("reminder-set", ctxA, { medId: "nope" }).ok, false);
    const med = freshMed();
    const set = call("reminder-set", ctxA, { medId: med.id, times: ["08:00", "20:00"] });
    assert.equal(set.ok, true);
    assert.deepEqual(set.result.reminder.times, ["08:00", "20:00"]);
    assert.equal(call("reminder-list", ctxA, {}).result.count, 1);
    const tog = call("reminder-toggle", ctxA, { id: set.result.reminder.id });
    assert.equal(tog.result.reminder.enabled, false);
    assert.equal(call("reminder-delete", ctxA, { id: set.result.reminder.id }).result.deleted, 1);
  });

  it("reminder-due reports reminders within the window", () => {
    const med = freshMed();
    const now = new Date();
    const hh = String(now.getHours()).padStart(2, "0");
    const mm = String(now.getMinutes()).padStart(2, "0");
    call("reminder-set", ctxA, { medId: med.id, times: [`${hh}:${mm}`] });
    const due = call("reminder-due", ctxA, { windowMinutes: 60 });
    assert.equal(due.ok, true);
    assert.equal(due.result.count, 1);
  });
});

describe("pharmacy backlog: caregiver alerts", () => {
  beforeEach(() => {
    globalThis._concordSTATE = { dtus: new Map() };
    globalThis._concordSaveStateDebounced = () => {};
  });

  it("caregiver-add requires a name, lists and removes", () => {
    assert.equal(call("caregiver-add", ctxA, {}).ok, false);
    const cg = call("caregiver-add", ctxA, { name: "Jordan", relationship: "spouse" });
    assert.equal(cg.ok, true);
    assert.equal(call("caregiver-list", ctxA, {}).result.caregivers.length, 1);
    assert.equal(call("caregiver-remove", ctxA, { id: cg.result.caregiver.id }).result.removed, 1);
  });

  it("caregiver-alerts returns a structured alert set", () => {
    call("caregiver-add", ctxA, { name: "Jordan" });
    const a = call("caregiver-alerts", ctxA, {});
    assert.equal(a.ok, true);
    assert.ok(Array.isArray(a.result.alerts));
  });
});

describe("pharmacy backlog: live price lookup", () => {
  it("price-lookup requires a drug name", async () => {
    assert.equal((await call("price-lookup", ctxA, {})).ok, false);
  });

  it("price-lookup normalises via RxNorm + ranks NADAC quotes", async () => {
    globalThis.fetch = async (url) => {
      if (url.includes("rxnav.nlm.nih.gov")) {
        return { ok: true, json: async () => ({ idGroup: { rxnormId: ["83367"], name: "atorvastatin" } }) };
      }
      return {
        ok: true,
        json: async () => ([
          { ndc_description: "ATORVASTATIN 10MG TAB", nadac_per_unit: 0.12, pricing_unit: "EA", effective_date: "2026-01-01" },
          { ndc_description: "ATORVASTATIN 20MG TAB", nadac_per_unit: 0.05, pricing_unit: "EA", effective_date: "2026-01-01" },
        ]),
      };
    };
    const r = await call("price-lookup", ctxA, { drug: "atorvastatin", quantity: 30 });
    assert.equal(r.ok, true);
    assert.equal(r.result.rxcui, "83367");
    assert.equal(r.result.quotes[0].perUnit, 0.05);
    assert.equal(r.result.lowestTotal, 1.5);
  });
});

describe("pharmacy backlog: pill identifier", () => {
  it("pill-identify requires an imprint or drug name", async () => {
    assert.equal((await call("pill-identify", ctxA, {})).ok, false);
  });

  it("pill-identify matches openFDA label records", async () => {
    globalThis.fetch = async () => ({
      ok: true,
      json: async () => ({
        results: [{
          set_id: "pill-set-1",
          spl_product_data_elements: ["WHITE ROUND TABLET L484"],
          openfda: { generic_name: ["acetaminophen"], brand_name: ["Tylenol"], dosage_form: ["TABLET"], route: ["ORAL"] },
          active_ingredient: ["acetaminophen 500 mg"],
        }],
      }),
    });
    const r = await call("pill-identify", ctxA, { imprint: "L484", color: "white", shape: "round" });
    assert.equal(r.ok, true);
    assert.equal(r.result.count, 1);
    assert.equal(r.result.matches[0].genericName, "acetaminophen");
    assert.equal(r.result.matches[0].colorMatch, true);
  });
});

describe("pharmacy backlog: refill auto-reorder", () => {
  beforeEach(() => {
    globalThis._concordSTATE = { dtus: new Map() };
    globalThis._concordSaveStateDebounced = () => {};
  });

  it("autoreorder-set/list/remove + run files refills below threshold", () => {
    const med = call("med-add", ctxA, { name: "Metformin", quantity: 3 }).result.medication;
    call("schedule-set", ctxA, { medId: med.id, times: ["08:00"] });
    assert.equal(call("autoreorder-set", ctxA, { medId: med.id, thresholdDays: 7 }).ok, true);
    assert.equal(call("autoreorder-list", ctxA, {}).result.configs.length, 1);
    const run = call("autoreorder-run", ctxA, {});
    assert.equal(run.result.count, 1);
    assert.equal(run.result.triggered[0].medId, med.id);
    // Idempotent: second run won't double-file while a request is open.
    assert.equal(call("autoreorder-run", ctxA, {}).result.count, 0);
    assert.equal(call("autoreorder-remove", ctxA, { medId: med.id }).result.removed, 1);
  });
});

describe("pharmacy backlog: graded interactions", () => {
  it("interaction-grade requires 2 medications", async () => {
    assert.equal((await call("interaction-grade", ctxA, { medications: ["aspirin"] })).ok, false);
  });

  it("interaction-grade resolves rxcuis + grades RxNav interactions", async () => {
    globalThis.fetch = async (url) => {
      if (url.includes("rxcui.json")) {
        const cui = url.includes("warfarin") ? "11289" : "1191";
        return { ok: true, json: async () => ({ idGroup: { rxnormId: [cui] } }) };
      }
      return {
        ok: true,
        json: async () => ({
          fullInteractionTypeGroup: [{
            sourceName: "ONCHigh",
            fullInteractionType: [{
              interactionPair: [{
                severity: "high",
                description: "Increased bleeding risk.",
                interactionConcept: [
                  { minConceptItem: { name: "warfarin" } },
                  { minConceptItem: { name: "aspirin" } },
                ],
              }],
            }],
          }],
        }),
      };
    };
    const r = await call("interaction-grade", ctxA, { medications: ["warfarin", "aspirin"] });
    assert.equal(r.ok, true);
    assert.equal(r.result.graded, 1);
    assert.equal(r.result.highestSeverity, "high");
    assert.deepEqual(r.result.sources, ["ONCHigh"]);
  });
});

describe("pharmacy backlog: adherence gamification", () => {
  beforeEach(() => {
    globalThis._concordSTATE = { dtus: new Map() };
    globalThis._concordSaveStateDebounced = () => {};
  });

  it("adherence-calendar builds a per-day grid", () => {
    const med = call("med-add", ctxA, { name: "Lisinopril", quantity: 30 }).result.medication;
    call("schedule-set", ctxA, { medId: med.id, times: ["08:00"] });
    call("dose-log", ctxA, { medId: med.id, status: "taken", scheduledTime: "08:00" });
    const cal = call("adherence-calendar", ctxA, { days: 30 });
    assert.equal(cal.ok, true);
    assert.equal(cal.result.cells.length, 30);
    assert.ok(cal.result.cells.some((c) => c.status === "perfect"));
  });

  it("adherence-streak computes streaks + badges", () => {
    const med = call("med-add", ctxA, { name: "Lisinopril", quantity: 30 }).result.medication;
    call("schedule-set", ctxA, { medId: med.id, times: ["08:00"] });
    call("dose-log", ctxA, { medId: med.id, status: "taken", scheduledTime: "08:00" });
    const st = call("adherence-streak", ctxA, {});
    assert.equal(st.ok, true);
    assert.equal(st.result.currentStreak, 1);
    assert.equal(st.result.totalDosesTaken, 1);
    assert.ok(Array.isArray(st.result.badges));
  });
});
