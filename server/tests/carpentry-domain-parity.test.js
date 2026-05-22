// Contract tests for server/domains/carpentry.js — pure-math calculators
// plus the trade-management substrate (cut-list optimization, material
// takeoff, photo logs, crew scheduling, time tracking, estimate→invoice
// conversion + e-signature, and the client portal).

import { describe, it, before, beforeEach } from "node:test";
import assert from "node:assert/strict";
import registerCarpentryActions from "../domains/carpentry.js";

const ACTIONS = new Map();
function register(domain, name, fn) { ACTIONS.set(`${domain}.${name}`, fn); }
function call(name, ctx, params = {}) {
  const fn = ACTIONS.get(`carpentry.${name}`);
  if (!fn) throw new Error(`carpentry.${name} not registered`);
  // /api/lens/run sets both artifact.data and params to the input object.
  const artifact = { id: null, domain: "carpentry", type: "domain_action", data: params, meta: {} };
  return fn(ctx, artifact, params);
}

before(() => {
  // STATE-backed macros need a global STATE container.
  globalThis._concordSTATE = {};
  registerCarpentryActions(register);
});

beforeEach(() => {
  // fresh per-user STATE each test
  globalThis._concordSTATE = {};
});

const ctxA = { actor: { userId: "user_a" }, userId: "user_a" };

/* ───────────────── pure-math calculators ───────────────── */

describe("carpentry pure calculators", () => {
  it("boardFootCalc tallies board feet across pieces", () => {
    const r = call("boardFootCalc", ctxA, {});
    // boardFootCalc reads artifact.data.pieces — exercised via empty + populated
    assert.equal(r.ok, true);
    const r2 = ACTIONS.get("carpentry.boardFootCalc")(
      ctxA,
      { data: { pieces: [{ thickness: 1, width: 6, length: 96, quantity: 2 }] } },
      {},
    );
    assert.equal(r2.ok, true);
    assert.equal(r2.result.totalBoardFeet, 8);
  });

  it("jointStrength rates a joint with species multiplier", () => {
    const r = ACTIONS.get("carpentry.jointStrength")(
      ctxA, { data: { jointType: "dovetail", species: "oak" } }, {},
    );
    assert.equal(r.ok, true);
    assert.ok(r.result.effectiveStrength > 80);
  });

  it("woodSelection recommends woods", () => {
    const r = ACTIONS.get("carpentry.woodSelection")(
      ctxA, { data: { application: "outdoor", indoor: false } }, {},
    );
    assert.equal(r.ok, true);
    assert.ok(r.result.recommendations.length > 0);
  });

  it("finishRecommendation ranks finishes", () => {
    const r = ACTIONS.get("carpentry.finishRecommendation")(
      ctxA, { data: { species: "oak", indoor: true } }, {},
    );
    assert.equal(r.ok, true);
    assert.ok(r.result.topRecommendation);
  });
});

/* ───────────────── cut-list optimization ───────────────── */

describe("carpentry.cutListOptimize", () => {
  it("rejects no cuts", () => {
    const r = call("cutListOptimize", ctxA, { cuts: [] });
    assert.equal(r.ok, false);
  });

  it("rejects a cut longer than stock", () => {
    const r = call("cutListOptimize", ctxA, { stockLength: 96, cuts: [{ label: "x", length: 120 }] });
    assert.equal(r.ok, false);
  });

  it("first-fit-decreasing packs cuts into minimal boards", () => {
    const r = call("cutListOptimize", ctxA, {
      stockLength: 96, kerf: 0,
      cuts: [{ label: "rail", length: 48, quantity: 4 }],
      stockCostPerBoard: 10,
    });
    assert.equal(r.ok, true);
    assert.equal(r.result.boardsNeeded, 2);
    assert.equal(r.result.wastePct, 0);
    assert.equal(r.result.materialCost, 20);
  });
});

/* ───────────────── material takeoff ───────────────── */

describe("carpentry.materialTakeoff", () => {
  it("rejects empty items", () => {
    const r = call("materialTakeoff", ctxA, { items: [] });
    assert.equal(r.ok, false);
  });

  it("rolls items + labor + overhead + margin into a total", () => {
    const r = call("materialTakeoff", ctxA, {
      projectName: "Deck", items: [{ name: "2x6", quantity: 10, unitCost: 8 }],
      wastePct: 0, laborHours: 4, laborRate: 50, overheadPct: 0, marginPct: 0,
    });
    assert.equal(r.ok, true);
    assert.equal(r.result.materialSubtotal, 80);
    assert.equal(r.result.laborCost, 200);
    assert.equal(r.result.total, 280);
  });
});

/* ───────────────── photo job log ───────────────── */

describe("carpentry photo log", () => {
  it("adds, lists and deletes a job photo", () => {
    const add = call("photoLogAdd", ctxA, { jobId: "job1", imageUrl: "https://x/a.jpg", phase: "before" });
    assert.equal(add.ok, true);
    const list = call("photoLogList", ctxA, {});
    assert.equal(list.ok, true);
    assert.equal(list.result.count, 1);
    const del = call("photoLogDelete", ctxA, { id: add.result.entry.id });
    assert.equal(del.ok, true);
    assert.equal(call("photoLogList", ctxA, {}).result.count, 0);
  });

  it("requires jobId and imageUrl", () => {
    assert.equal(call("photoLogAdd", ctxA, { imageUrl: "https://x" }).ok, false);
    assert.equal(call("photoLogAdd", ctxA, { jobId: "j" }).ok, false);
  });
});

/* ───────────────── crew + scheduling ───────────────── */

describe("carpentry crew + schedule", () => {
  it("adds crew and lists them", () => {
    const add = call("crewAdd", ctxA, { name: "Sam", role: "Framer", hourlyRate: 55 });
    assert.equal(add.ok, true);
    const list = call("crewList", ctxA, {});
    assert.equal(list.result.count, 1);
    assert.equal(call("crewRemove", ctxA, { id: add.result.member.id }).ok, true);
  });

  it("schedules a job, resolves crew names, updates and deletes", () => {
    const crew = call("crewAdd", ctxA, { name: "Lee" });
    const add = call("scheduleAdd", ctxA, {
      title: "Trim install", date: "2026-06-01", crewIds: [crew.result.member.id],
    });
    assert.equal(add.ok, true);
    const list = call("scheduleList", ctxA, {});
    assert.equal(list.result.count, 1);
    assert.deepEqual(list.result.entries[0].crewNames, ["Lee"]);
    const upd = call("scheduleUpdate", ctxA, { id: add.result.entry.id, status: "dispatched" });
    assert.equal(upd.result.entry.status, "dispatched");
    assert.equal(call("scheduleDelete", ctxA, { id: add.result.entry.id }).ok, true);
  });

  it("rejects schedule without title or date", () => {
    assert.equal(call("scheduleAdd", ctxA, { date: "2026-01-01" }).ok, false);
    assert.equal(call("scheduleAdd", ctxA, { title: "x" }).ok, false);
  });
});

/* ───────────────── time tracking ───────────────── */

describe("carpentry time tracking", () => {
  it("starts then stops a timer producing a costed entry", () => {
    const start = call("timerStart", ctxA, { jobId: "job1", jobName: "Cabinet", rate: 60 });
    assert.equal(start.ok, true);
    // double-start blocked
    assert.equal(call("timerStart", ctxA, { jobId: "job1" }).ok, false);
    const stop = call("timerStop", ctxA, { jobId: "job1" });
    assert.equal(stop.ok, true);
    assert.equal(stop.result.entry.rate, 60);
  });

  it("adds a manual time entry and aggregates by job", () => {
    const add = call("timeEntryAdd", ctxA, { jobId: "job2", jobName: "Stairs", hours: 3, rate: 50 });
    assert.equal(add.ok, true);
    const list = call("timeEntryList", ctxA, {});
    assert.equal(list.ok, true);
    assert.equal(list.result.totalHours, 3);
    assert.equal(list.result.totalCost, 150);
    assert.equal(list.result.byJob[0].jobId, "job2");
    assert.equal(call("timeEntryDelete", ctxA, { id: add.result.entry.id }).ok, true);
  });

  it("rejects non-positive hours", () => {
    assert.equal(call("timeEntryAdd", ctxA, { jobId: "j", hours: 0 }).ok, false);
  });
});

/* ───────────────── estimate → invoice + e-signature ───────────────── */

describe("carpentry invoicing + signature", () => {
  it("converts an estimate to an invoice with tax", () => {
    const inv = call("estimateToInvoice", ctxA, {
      estimateId: "est1", client: "Acme", amount: 1000, taxPct: 10, depositPct: 25,
    });
    assert.equal(inv.ok, true);
    assert.equal(inv.result.invoice.tax, 100);
    assert.equal(inv.result.invoice.total, 1100);
    assert.equal(inv.result.invoice.depositDue, 275);
  });

  it("signs an estimate and attaches the signature to its invoice", () => {
    const inv = call("estimateToInvoice", ctxA, { estimateId: "est2", client: "Bob", amount: 500 });
    const sign = call("signEstimate", ctxA, { estimateId: "est2", signedBy: "Bob Jones", accepted: true });
    assert.equal(sign.ok, true);
    assert.equal(sign.result.signature.decision, "approved");
    const list = call("invoiceList", ctxA, {});
    const found = list.result.invoices.find((i) => i.id === inv.result.invoice.id);
    assert.equal(found.signature.signedBy, "Bob Jones");
  });

  it("marks an invoice paid and updates totals", () => {
    const inv = call("estimateToInvoice", ctxA, { estimateId: "est3", amount: 200 });
    assert.equal(call("invoiceList", ctxA, {}).result.outstanding, 200);
    call("invoiceMarkPaid", ctxA, { id: inv.result.invoice.id });
    const list = call("invoiceList", ctxA, {});
    assert.equal(list.result.collected, 200);
    assert.equal(list.result.outstanding, 0);
  });

  it("rejects bad invoice amounts and missing estimateId", () => {
    assert.equal(call("estimateToInvoice", ctxA, { estimateId: "x", amount: 0 }).ok, false);
    assert.equal(call("estimateToInvoice", ctxA, { amount: 10 }).ok, false);
    assert.equal(call("signEstimate", ctxA, { estimateId: "x" }).ok, false);
  });
});

/* ───────────────── client portal ───────────────── */

describe("carpentry client portal", () => {
  it("creates a portal, views it, lists it, and updates progress", () => {
    const create = call("portalCreate", ctxA, {
      client: "Carol", jobName: "Kitchen", estimateId: "est9", estimateAmount: 5000, progressPct: 10,
    });
    assert.equal(create.ok, true);
    const token = create.result.token;
    const view = call("portalView", ctxA, { token });
    assert.equal(view.ok, true);
    assert.equal(view.result.share.client, "Carol");
    const list = call("portalList", ctxA, {});
    assert.equal(list.result.count, 1);
    const upd = call("portalUpdateProgress", ctxA, { token, progressPct: 60 });
    assert.equal(upd.result.share.progressPct, 60);
  });

  it("lets a client approve the estimate via the portal", () => {
    const create = call("portalCreate", ctxA, { client: "Dave", estimateId: "est10" });
    const resp = call("portalRespond", ctxA, { token: create.result.token, decision: "approved", signedBy: "Dave R" });
    assert.equal(resp.ok, true);
    assert.equal(resp.result.share.status, "approved");
    assert.equal(resp.result.share.clientDecision.decision, "approved");
  });

  it("rejects unknown portal tokens and bad decisions", () => {
    assert.equal(call("portalView", ctxA, { token: "nope" }).ok, false);
    const create = call("portalCreate", ctxA, { client: "X" });
    assert.equal(call("portalRespond", ctxA, { token: create.result.token, decision: "maybe" }).ok, false);
  });
});
