// Full-build behavioural tests for the Carpentry lens — build(carpentry),
// GB-1088 second lens (B7 aviation → carpentry), built from Review 5's
// frozen first pass (2026-11-01, PROBE-LIVE; 13 flows 6 PASS / 6 PARTIAL /
// 1 FAIL) as filed in the canonical research sync.
//
// Pins, per finding:
//   F2 (premise-discharged pin) — the board-foot tally sums EVERY piece:
//       the pass's own fixture (2×6×96 + 1×6×96 @ $5/BF) totals 12 BF / $60.
//   F3 — materialTakeoff returns the full numbered breakdown (subtotal ·
//       waste · labor · overhead · margin · total) and honours an explicit
//       overheadPct; the pass's $1,139.71 reproduces exactly.
//   F4 — a quote signed BEFORE conversion keeps its signature on the
//       invoice; the deposit is computed and carried (depositDue).
//   F5 — scheduleUpdate edits title / address / jobId, not only status.
//   F6 — speciesReference serves the trade table (Janka · density ·
//       workability) from the same data woodSelection reads.
//   F7 — invoiceDelete and portalDelete exist and are owner-scoped.
//   F8 — jointStrength never exceeds its /100 scale; woodSelection never
//       recommends a species whose cost tier exceeds the budget tier.
//
// Hermetic: same local register harness as carpentry-lens-macros.test.js.

import { describe, it, before, beforeEach } from "node:test";
import assert from "node:assert/strict";
import registerCarpentryActions from "../domains/carpentry.js";

const ACTIONS = new Map();
function register(domain, name, fn) {
  assert.equal(domain, "carpentry", `unexpected domain: ${domain}`);
  ACTIONS.set(name, fn);
}
function call(name, ctx, input = {}) {
  const fn = ACTIONS.get(name);
  if (!fn) throw new Error(`carpentry.${name} not registered`);
  const virtualArtifact = { id: null, domain: "carpentry", type: "domain_action", data: input, meta: {} };
  return fn(ctx, virtualArtifact, input);
}

before(() => { registerCarpentryActions(register); });
beforeEach(() => {
  globalThis._concordSTATE = {};
  globalThis._concordSaveStateDebounced = () => {};
});

const ctxA = { actor: { userId: "user_a", id: "user_a" }, userId: "user_a" };
const ctxB = { actor: { userId: "user_b", id: "user_b" }, userId: "user_b" };

describe("F2 pin — board-foot tally sums every piece (the pass fixture)", () => {
  it("2×6×96 + 1×6×96 @ $5/BF totals exactly 12 BF / $60", () => {
    const r = call("boardFootCalc", ctxA, {
      pieces: [
        { thickness: 2, width: 6, length: 96, pricePerBF: 5, species: "oak" },
        { thickness: 1, width: 6, length: 96, pricePerBF: 5, species: "pine" },
      ],
    });
    assert.equal(r.ok, true);
    assert.equal(r.result.totalBoardFeet, 12);
    assert.equal(r.result.totalCost, 60);
    assert.equal(r.result.pieces.length, 2);
    assert.equal(r.result.pieces[0].totalBoardFeet, 8);
    assert.equal(r.result.pieces[1].totalBoardFeet, 4);
  });
});

describe("F3 — takeoff breakdown is complete and overhead is an input", () => {
  it("reproduces the pass's $1,139.71 with every component numbered", () => {
    const r = call("materialTakeoff", ctxA, {
      items: [{ name: "materials", quantity: 1, unit: "lot", unitCost: 180 }],
      laborHours: 10, laborRate: 65, wastePct: 10, overheadPct: 12, marginPct: 20,
    });
    assert.equal(r.ok, true);
    assert.equal(r.result.materialSubtotal, 180);
    assert.equal(r.result.materialWithWaste, 198);
    assert.equal(r.result.laborCost, 650);
    assert.equal(r.result.overhead, 101.76);
    assert.equal(r.result.margin, 189.95);
    assert.equal(r.result.total, 1139.71);
    assert.equal(r.result.overheadPct, 12);
  });

  it("an explicit overheadPct of 0 yields zero overhead (no hidden default)", () => {
    const r = call("materialTakeoff", ctxA, {
      items: [{ name: "materials", quantity: 1, unit: "lot", unitCost: 100 }],
      laborHours: 0, laborRate: 65, wastePct: 0, overheadPct: 0, marginPct: 0,
    });
    assert.equal(r.ok, true);
    assert.equal(r.result.overhead, 0);
    assert.equal(r.result.total, 100);
  });
});

describe("F4 — signature survives sign-before-convert; deposit carried", () => {
  it("signing first, then converting, puts the signature on the invoice", () => {
    const sig = call("signEstimate", ctxA, { estimateId: "est_f4", signedBy: "Pat Client" });
    assert.equal(sig.ok, true);
    const inv = call("estimateToInvoice", ctxA, { estimateId: "est_f4", amount: 1100, depositPct: 25, client: "Pat Client" });
    assert.equal(inv.ok, true);
    assert.equal(inv.result.invoice.signature?.signedBy, "Pat Client");
    assert.equal(inv.result.invoice.depositPct, 25);
    assert.equal(inv.result.invoice.depositDue, 275);
  });

  it("signing after conversion still attaches (the pre-existing path)", () => {
    call("estimateToInvoice", ctxA, { estimateId: "est_f4b", amount: 500 });
    call("signEstimate", ctxA, { estimateId: "est_f4b", signedBy: "Sam Client" });
    const list = call("invoiceList", ctxA, {});
    const inv = list.result.invoices.find((i) => i.estimateId === "est_f4b");
    assert.equal(inv.signature?.signedBy, "Sam Client");
  });

  it("an unsigned estimate converts with signature null (no fabrication)", () => {
    const inv = call("estimateToInvoice", ctxA, { estimateId: "est_f4c", amount: 500 });
    assert.equal(inv.result.invoice.signature, null);
  });

  it("one user's signature never lands on another user's invoice", () => {
    call("signEstimate", ctxA, { estimateId: "est_shared", signedBy: "User A" });
    const invB = call("estimateToInvoice", ctxB, { estimateId: "est_shared", amount: 500 });
    assert.equal(invB.result.invoice.signature, null);
  });
});

describe("F5 — scheduleUpdate edits the job's fields", () => {
  it("title, address and jobId update and persist", () => {
    const add = call("scheduleAdd", ctxA, { title: "Old title", date: "2026-11-10", startTime: "08:00", endTime: "16:00", address: "1 Old St" });
    assert.equal(add.ok, true);
    const id = add.result.entry.id;
    const upd = call("scheduleUpdate", ctxA, { id, title: "New title", address: "22 New Ave", jobId: "job_9" });
    assert.equal(upd.ok, true);
    assert.equal(upd.result.entry.title, "New title");
    assert.equal(upd.result.entry.address, "22 New Ave");
    assert.equal(upd.result.entry.jobId, "job_9");
    const list = call("scheduleList", ctxA, {});
    const entry = list.result.entries.find((e) => e.id === id);
    assert.equal(entry.title, "New title");
  });
});

describe("F6 — speciesReference serves the lens's trade table", () => {
  it("returns Janka, density and workability for the covered species", () => {
    const r = call("speciesReference", ctxA, {});
    assert.equal(r.ok, true);
    assert.equal(r.result.species.length, 8);
    const oak = r.result.species.find((s) => s.name === "Oak");
    assert.equal(oak.janka, 1290);
    assert.equal(oak.densityKgM3, 720);
    assert.equal(typeof oak.workability, "string");
    const teak = r.result.species.find((s) => s.name === "Teak");
    assert.equal(teak.janka, 1155);
  });

  it("agrees with woodSelection's hardness figures (one table)", () => {
    const ref = call("speciesReference", ctxA, {}).result.species;
    const sel = call("woodSelection", ctxA, { application: "furniture", budget: "high", indoor: true }).result.recommendations;
    for (const rec of sel) {
      const row = ref.find((s) => s.name === rec.name);
      assert.ok(row, `${rec.name} missing from speciesReference`);
      assert.equal(rec.hardness, `${row.janka} (Janka)`);
    }
  });
});

describe("F7 — invoices and portal entries have exit paths", () => {
  it("invoiceDelete removes the caller's invoice; a second delete errors", () => {
    const inv = call("estimateToInvoice", ctxA, { estimateId: "est_f7", amount: 300 }).result.invoice;
    const del = call("invoiceDelete", ctxA, { id: inv.id });
    assert.equal(del.ok, true);
    assert.equal(del.result.deleted, inv.id);
    const list = call("invoiceList", ctxA, {});
    assert.equal(list.result.invoices.some((i) => i.id === inv.id), false);
    const again = call("invoiceDelete", ctxA, { id: inv.id });
    assert.equal(again.ok, false);
  });

  it("invoiceDelete cannot remove another user's invoice", () => {
    const inv = call("estimateToInvoice", ctxA, { estimateId: "est_f7b", amount: 300 }).result.invoice;
    const del = call("invoiceDelete", ctxB, { id: inv.id });
    assert.equal(del.ok, false);
    const list = call("invoiceList", ctxA, {});
    assert.equal(list.result.invoices.some((i) => i.id === inv.id), true);
  });

  it("portalDelete removes a revoked entry entirely; owner-scoped", () => {
    const share = call("portalCreate", ctxA, { client: "Pat", jobName: "Deck", estimateId: "est_f7", estimateAmount: 900 }).result.share;
    call("portalRevoke", ctxA, { token: share.token });
    const notMine = call("portalDelete", ctxB, { token: share.token });
    assert.equal(notMine.ok, false);
    const del = call("portalDelete", ctxA, { token: share.token });
    assert.equal(del.ok, true);
    const list = call("portalList", ctxA, {});
    assert.equal(list.result.shares.some((s) => s.token === share.token), false);
    const view = call("portalPublicView", ctxA, { token: share.token });
    assert.equal(view.ok, false);
  });
});

describe("F8 — scores stay on their scale; budgets bind recommendations", () => {
  it("mortise-tenon in oak, glued, reads 100 — not 128 / 100", () => {
    const r = call("jointStrength", ctxA, { jointType: "mortise-tenon", species: "oak", glued: true });
    assert.equal(r.result.effectiveStrength, 100);
    assert.equal(r.result.rating, "excellent");
  });

  it("a mid-scale joint is unchanged by the clamp (butt joint, pine, dry = 11)", () => {
    const r = call("jointStrength", ctxA, { jointType: "butt", species: "pine", glued: false });
    assert.equal(r.result.effectiveStrength, 11);
    assert.equal(r.result.rating, "weak");
  });

  it("a medium budget never returns a high-cost species (no Walnut)", () => {
    const r = call("woodSelection", ctxA, { application: "furniture", budget: "medium", indoor: true });
    assert.ok(r.result.recommendations.length > 0);
    assert.ok(r.result.recommendations.every((w) => w.cost !== "high"));
    assert.ok(!r.result.recommendations.some((w) => w.name === "Walnut"));
  });

  it("a low budget returns only low-cost species; high returns all tiers", () => {
    const low = call("woodSelection", ctxA, { application: "furniture", budget: "low", indoor: true });
    assert.ok(low.result.recommendations.every((w) => w.cost === "low"));
    const high = call("woodSelection", ctxA, { application: "furniture", budget: "high", indoor: true });
    assert.ok(high.result.recommendations.some((w) => w.cost === "high"));
  });
});
