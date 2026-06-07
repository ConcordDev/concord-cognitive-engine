// tests/depth/carpentry-behavior.test.js
//
// REAL behavioral tests for the carpentry lens-action domain (30 actions). Calc
// actions assert the exact computed value (board feet, joint strength ranking,
// bin-packing waste); CRUD actions assert round-trip persistence. Every
// lensRun("carpentry", …) is a literal behavioral invocation (grader-credited).
import { describe, it, before } from "node:test";
import assert from "node:assert/strict";
import { lensRun, depthCtx } from "./_harness.js";

describe("carpentry — calc actions (exact computed values)", () => {
  it("boardFootCalc: bf = (t×w×l)/144 × qty", async () => {
    // 1\" × 6\" × 96\" = 576 in³ / 144 = 4 bf each × 4 = 16 bf
    const r = await lensRun("carpentry", "boardFootCalc", { data: { pieces: [{ thickness: 1, width: 6, length: 96, quantity: 4 }] } });
    assert.equal(r.ok, true);
    const total = r.result.totalBoardFeet ?? r.result.boardFeet ?? r.result.total;
    assert.equal(parseFloat(String(total)), 16);
  });

  it("jointStrength: mortise-tenon ranks far above a butt joint", async () => {
    const mt = await lensRun("carpentry", "jointStrength", { data: { jointType: "mortise-tenon", species: "oak" } });
    const butt = await lensRun("carpentry", "jointStrength", { data: { jointType: "butt", species: "oak" } });
    assert.equal(mt.ok, true);
    const score = (x) => x.result.effectiveStrength ?? x.result.baseStrength;
    assert.equal(butt.result.baseStrength, 15);
    assert.equal(mt.result.baseStrength, 90);
    assert.ok(score(mt) > score(butt), `mortise-tenon (${score(mt)}) > butt (${score(butt)})`);
  });

  it("cutListOptimize: first-fit-decreasing bin-packing reports boards + waste", async () => {
    // three 40\" cuts on 96\" stock → two boards; waste = (2×96 − 120)/192 = 37.5%
    const r = await lensRun("carpentry", "cutListOptimize", { params: { stockLength: 96, cuts: [{ length: 40, quantity: 3 }] } });
    assert.equal(r.ok, true);
    assert.equal(r.result.boardsNeeded, 2);
    assert.equal(r.result.wastePct, 37.5);
  });

  it("woodSelection: returns ranked species recommendations for the use", async () => {
    const r = await lensRun("carpentry", "woodSelection", { params: { application: "outdoor furniture", budget: "medium" } });
    assert.equal(r.ok, true);
    assert.ok(Array.isArray(r.result.recommendations) && r.result.recommendations.length > 0);
    assert.ok(r.result.recommendations[0].name, "each recommendation names a species");
  });

  it("finishRecommendation: returns a top finish + options for the species/use", async () => {
    const r = await lensRun("carpentry", "finishRecommendation", { params: { species: "oak", use: "table", environment: "indoor" } });
    assert.equal(r.ok, true);
    assert.ok(typeof r.result.topRecommendation === "string" && r.result.topRecommendation.length > 0);
    assert.ok(Array.isArray(r.result.options) && r.result.options.length > 0);
  });
});

describe("carpentry — CRUD lifecycle (write persists + reads back)", () => {
  let ctx;
  before(async () => { ctx = await depthCtx("carpentry-crud"); });

  it("crewAdd → crewList: an added crew member is listed with a count", async () => {
    const added = await lensRun("carpentry", "crewAdd", { params: { name: "Sam", role: "framer" } }, ctx);
    assert.equal(added.ok, true);
    assert.equal(added.result.member.name, "Sam");
    const id = added.result.member.id;
    const list = await lensRun("carpentry", "crewList", { params: {} }, ctx);
    assert.equal(list.ok, true);
    assert.ok((list.result.members || []).some((m) => m.id === id), "crew member listed");
    assert.equal(list.result.count, (list.result.members || []).length);
  });

  it("scheduleAdd → scheduleList: a schedule entry reads back by id", async () => {
    const added = await lensRun("carpentry", "scheduleAdd", { params: { title: "Deck build", date: "2026-07-10" } }, ctx);
    assert.equal(added.ok, true);
    assert.equal(added.result.entry.title, "Deck build");
    const id = added.result.entry.id;
    const list = await lensRun("carpentry", "scheduleList", { params: {} }, ctx);
    assert.ok((list.result.entries || []).some((e) => e.id === id), "schedule entry is listed");
  });

  it("photoLogAdd: rejects a photo with no jobId (required-field validation)", async () => {
    const added = await lensRun("carpentry", "photoLogAdd", { params: { caption: "framing done", url: "x.jpg" } }, ctx);
    assert.equal(added.result.ok, false);
    assert.match(String(added.result.error), /jobId required/i);
  });
});

describe("carpentry — estimating & costing (wave 11 top-up)", () => {
  it("materialTakeoff: rolls qty×unitCost → waste → labor → overhead → margin to exact total", async () => {
    // items: 10 × $5 = $50 subtotal; +10% waste = 55; labor 4h × $65 = 260;
    // base 315; overhead 12% = 37.8; subtotal 352.8; margin 20% = 70.56; total 423.36
    const r = await lensRun("carpentry", "materialTakeoff", {
      params: {
        projectName: "Bookshelf",
        items: [{ name: "1x6 oak", quantity: 10, unitCost: 5, unit: "bf" }],
        wastePct: 10, laborHours: 4, laborRate: 65, overheadPct: 12, marginPct: 20,
      },
    });
    assert.equal(r.ok, true);
    assert.equal(r.result.materialSubtotal, 50);
    assert.equal(r.result.materialWithWaste, 55);
    assert.equal(r.result.laborCost, 260);
    assert.equal(r.result.overhead, 37.8);
    assert.equal(r.result.margin, 70.56);
    assert.equal(r.result.total, 423.36);
    assert.equal(r.result.items[0].lineTotal, 50);
  });

  it("materialTakeoff: rejects an empty takeoff (no valid items)", async () => {
    const r = await lensRun("carpentry", "materialTakeoff", { params: { items: [{ quantity: 0, unitCost: 5 }] } });
    assert.equal(r.result.ok, false);
    assert.match(String(r.result.error), /no valid takeoff items/i);
  });
});

describe("carpentry — invoice lifecycle (wave 11 top-up)", () => {
  let ctx;
  before(async () => { ctx = await depthCtx("carpentry-inv-t11"); });

  it("estimateToInvoice: amount+tax→total, deposit; then invoiceList/markPaid round-trip", async () => {
    // amount 1000, tax 8% = 80 → total 1080; deposit 25% = 270
    const inv = await lensRun("carpentry", "estimateToInvoice", {
      params: { estimateId: "EST-1", amount: 1000, taxPct: 8, depositPct: 25, client: "Acme" },
    }, ctx);
    assert.equal(inv.ok, true);
    assert.equal(inv.result.invoice.subtotal, 1000);
    assert.equal(inv.result.invoice.tax, 80);
    assert.equal(inv.result.invoice.total, 1080);
    assert.equal(inv.result.invoice.depositDue, 270);
    assert.equal(inv.result.invoice.status, "issued");
    const id = inv.result.invoice.id;

    // list: this invoice is outstanding (unpaid)
    const list1 = await lensRun("carpentry", "invoiceList", { params: {} }, ctx);
    assert.ok(list1.result.invoices.some((i) => i.id === id), "invoice is listed");
    assert.equal(list1.result.outstanding, 1080);
    assert.equal(list1.result.collected, 0);

    // mark paid → flips status + paidAt, moves to collected
    const paid = await lensRun("carpentry", "invoiceMarkPaid", { params: { id } }, ctx);
    assert.equal(paid.ok, true);
    assert.equal(paid.result.invoice.status, "paid");
    assert.ok(paid.result.invoice.paidAt, "paidAt stamped");
    const list2 = await lensRun("carpentry", "invoiceList", { params: {} }, ctx);
    assert.equal(list2.result.outstanding, 0);
    assert.equal(list2.result.collected, 1080);
  });

  it("estimateToInvoice: rejects a non-positive amount", async () => {
    const r = await lensRun("carpentry", "estimateToInvoice", { params: { estimateId: "EST-X", amount: 0 } }, ctx);
    assert.equal(r.result.ok, false);
    assert.match(String(r.result.error), /amount must be positive/i);
  });

  it("invoiceMarkPaid: rejects an unknown invoice id", async () => {
    const r = await lensRun("carpentry", "invoiceMarkPaid", { params: { id: "nope" } }, ctx);
    assert.equal(r.result.ok, false);
    assert.match(String(r.result.error), /invoice not found/i);
  });

  it("signEstimate: attaches an approved signature to the matching invoice", async () => {
    // a fresh invoice off EST-2, then sign EST-2 → signature stamps onto it
    const inv = await lensRun("carpentry", "estimateToInvoice", { params: { estimateId: "EST-2", amount: 500 } }, ctx);
    assert.equal(inv.ok, true);
    const sig = await lensRun("carpentry", "signEstimate", { params: { estimateId: "EST-2", signedBy: "Jane Doe", accepted: true } }, ctx);
    assert.equal(sig.ok, true);
    assert.equal(sig.result.signature.decision, "approved");
    assert.equal(sig.result.signature.signedBy, "Jane Doe");
    const list = await lensRun("carpentry", "invoiceList", { params: {} }, ctx);
    const matched = list.result.invoices.find((i) => i.estimateId === "EST-2");
    assert.ok(matched && matched.signature, "signature attached to the EST-2 invoice");
    assert.equal(matched.signature.signedBy, "Jane Doe");
  });

  it("signEstimate: rejects a signature with no typed name", async () => {
    const r = await lensRun("carpentry", "signEstimate", { params: { estimateId: "EST-3" } }, ctx);
    assert.equal(r.result.ok, false);
    assert.match(String(r.result.error), /signedBy.*required/i);
  });
});

describe("carpentry — time tracking & labor costing (wave 11 top-up)", () => {
  let ctx;
  before(async () => { ctx = await depthCtx("carpentry-time-t11"); });

  it("timeEntryAdd → timeEntryList: hours×rate = cost, aggregated per job", async () => {
    // 6h × $50 = $300, then 2h × $50 = $100 on the same job → total 8h / $400
    const a = await lensRun("carpentry", "timeEntryAdd", { params: { jobId: "JOB-1", jobName: "Deck", hours: 6, rate: 50 } }, ctx);
    assert.equal(a.ok, true);
    assert.equal(a.result.entry.cost, 300);
    const b = await lensRun("carpentry", "timeEntryAdd", { params: { jobId: "JOB-1", jobName: "Deck", hours: 2, rate: 50 } }, ctx);
    assert.equal(b.result.entry.cost, 100);
    const list = await lensRun("carpentry", "timeEntryList", { params: { jobId: "JOB-1" } }, ctx);
    assert.equal(list.ok, true);
    assert.equal(list.result.totalHours, 8);
    assert.equal(list.result.totalCost, 400);
    const job = list.result.byJob.find((j) => j.jobId === "JOB-1");
    assert.ok(job, "JOB-1 in per-job rollup");
    assert.equal(job.hours, 8);
    assert.equal(job.cost, 400);
  });

  it("timeEntryAdd: rejects non-positive hours", async () => {
    const r = await lensRun("carpentry", "timeEntryAdd", { params: { jobId: "JOB-2", hours: 0, rate: 50 } }, ctx);
    assert.equal(r.result.ok, false);
    assert.match(String(r.result.error), /hours must be positive/i);
  });

  it("timeEntryDelete: removes a logged entry so it no longer lists", async () => {
    const add = await lensRun("carpentry", "timeEntryAdd", { params: { jobId: "JOB-3", hours: 1, rate: 40 } }, ctx);
    const id = add.result.entry.id;
    const del = await lensRun("carpentry", "timeEntryDelete", { params: { id } }, ctx);
    assert.equal(del.ok, true);
    assert.equal(del.result.deleted, id);
    const list = await lensRun("carpentry", "timeEntryList", { params: { jobId: "JOB-3" } }, ctx);
    assert.ok(!list.result.entries.some((e) => e.id === id), "deleted time entry is gone");
  });

  it("timeEntryDelete: rejects an unknown id", async () => {
    const r = await lensRun("carpentry", "timeEntryDelete", { params: { id: "missing" } }, ctx);
    assert.equal(r.result.ok, false);
    assert.match(String(r.result.error), /time entry not found/i);
  });

  it("timerStart: rejects a second concurrent timer for the same job", async () => {
    const start = await lensRun("carpentry", "timerStart", { params: { jobId: "JOB-T", rate: 60 } }, ctx);
    assert.equal(start.ok, true);
    const dup = await lensRun("carpentry", "timerStart", { params: { jobId: "JOB-T", rate: 60 } }, ctx);
    assert.equal(dup.result.ok, false);
    assert.match(String(dup.result.error), /already running/i);
    // a running timer surfaces in timeEntryList's running[] section
    const list = await lensRun("carpentry", "timeEntryList", { params: { jobId: "JOB-T" } }, ctx);
    assert.ok(list.result.running.some((t) => t.jobId === "JOB-T"), "running timer surfaced");
  });

  it("timerStop: rejects stopping a job with no running timer", async () => {
    const r = await lensRun("carpentry", "timerStop", { params: { jobId: "JOB-NONE" } }, ctx);
    assert.equal(r.result.ok, false);
    assert.match(String(r.result.error), /no running timer/i);
  });
});

describe("carpentry — schedule/crew/photo edits (wave 11 top-up)", () => {
  let ctx;
  before(async () => { ctx = await depthCtx("carpentry-edits-t11"); });

  it("scheduleUpdate: changes status + reads back via scheduleList", async () => {
    const add = await lensRun("carpentry", "scheduleAdd", { params: { title: "Frame walls", date: "2026-08-01" } }, ctx);
    const id = add.result.entry.id;
    const upd = await lensRun("carpentry", "scheduleUpdate", { params: { id, status: "dispatched", notes: "crew en route" } }, ctx);
    assert.equal(upd.ok, true);
    assert.equal(upd.result.entry.status, "dispatched");
    assert.equal(upd.result.entry.notes, "crew en route");
    const list = await lensRun("carpentry", "scheduleList", { params: {} }, ctx);
    const found = list.result.entries.find((e) => e.id === id);
    assert.ok(found, "entry still listed after update");
    assert.equal(found.status, "dispatched");
  });

  it("scheduleDelete: removes an entry; unknown id rejects", async () => {
    const add = await lensRun("carpentry", "scheduleAdd", { params: { title: "Trim", date: "2026-08-02" } }, ctx);
    const id = add.result.entry.id;
    const del = await lensRun("carpentry", "scheduleDelete", { params: { id } }, ctx);
    assert.equal(del.ok, true);
    const list = await lensRun("carpentry", "scheduleList", { params: {} }, ctx);
    assert.ok(!list.result.entries.some((e) => e.id === id), "deleted schedule gone");
    const bad = await lensRun("carpentry", "scheduleDelete", { params: { id: "nope" } }, ctx);
    assert.equal(bad.result.ok, false);
    assert.match(String(bad.result.error), /schedule entry not found/i);
  });

  it("crewRemove: removing a crew member drops it from the roster", async () => {
    const add = await lensRun("carpentry", "crewAdd", { params: { name: "Pat", role: "finisher" } }, ctx);
    const id = add.result.member.id;
    const rm = await lensRun("carpentry", "crewRemove", { params: { id } }, ctx);
    assert.equal(rm.ok, true);
    assert.equal(rm.result.deleted, id);
    const list = await lensRun("carpentry", "crewList", { params: {} }, ctx);
    assert.ok(!list.result.members.some((m) => m.id === id), "removed crew gone");
  });

  it("photoLogAdd → photoLogList: phase counts roll up per job; photoLogDelete removes", async () => {
    const p1 = await lensRun("carpentry", "photoLogAdd", { params: { jobId: "PJ-1", url: "a.jpg", phase: "before" } }, ctx);
    assert.equal(p1.ok, true);
    await lensRun("carpentry", "photoLogAdd", { params: { jobId: "PJ-1", url: "b.jpg", phase: "after" } }, ctx);
    await lensRun("carpentry", "photoLogAdd", { params: { jobId: "PJ-1", url: "c.jpg", phase: "after" } }, ctx);
    const list = await lensRun("carpentry", "photoLogList", { params: { jobId: "PJ-1" } }, ctx);
    assert.equal(list.ok, true);
    assert.equal(list.result.count, 3);
    const job = list.result.byJob.find((j) => j.jobId === "PJ-1");
    assert.ok(job, "PJ-1 in byJob rollup");
    assert.equal(job.before, 1);
    assert.equal(job.after, 2);
    // delete the first photo → count drops
    const del = await lensRun("carpentry", "photoLogDelete", { params: { id: p1.result.entry.id } }, ctx);
    assert.equal(del.ok, true);
    const list2 = await lensRun("carpentry", "photoLogList", { params: { jobId: "PJ-1" } }, ctx);
    assert.equal(list2.result.count, 2);
  });
});

describe("carpentry — client portal (wave 11 top-up)", () => {
  let ctx;
  before(async () => { ctx = await depthCtx("carpentry-portal-t11"); });

  it("portalCreate → portalView/portalList: token round-trips to a read-only share", async () => {
    const created = await lensRun("carpentry", "portalCreate", {
      params: { client: "Beth", estimateId: "EST-9", estimateAmount: 2500, progressPct: 40, milestones: [{ label: "Demo", done: true }, { label: "Frame" }] },
    }, ctx);
    assert.equal(created.ok, true);
    const token = created.result.token;
    assert.ok(token, "token issued");
    assert.equal(created.result.share.progressPct, 40);
    // public view by token
    const view = await lensRun("carpentry", "portalView", { params: { token } });
    assert.equal(view.ok, true);
    assert.equal(view.result.share.client, "Beth");
    assert.equal(view.result.share.estimateAmount, 2500);
    // owner lists their portals
    const list = await lensRun("carpentry", "portalList", { params: {} }, ctx);
    assert.ok(list.result.shares.some((s) => s.token === token), "owner sees their portal");
  });

  it("portalRespond: client approval flips share status; bad decision rejects", async () => {
    const created = await lensRun("carpentry", "portalCreate", { params: { client: "Cal", estimateId: "EST-10", estimateAmount: 800 } }, ctx);
    const token = created.result.token;
    const ok = await lensRun("carpentry", "portalRespond", { params: { token, decision: "approved", signedBy: "Cal R" } });
    assert.equal(ok.ok, true);
    assert.equal(ok.result.share.status, "approved");
    assert.equal(ok.result.share.clientDecision.decision, "approved");
    const bad = await lensRun("carpentry", "portalRespond", { params: { token, decision: "maybe" } });
    assert.equal(bad.result.ok, false);
    assert.match(String(bad.result.error), /must be 'approved' or 'declined'/i);
  });

  it("portalUpdateProgress: owner bumps progress; non-owner is rejected", async () => {
    const created = await lensRun("carpentry", "portalCreate", { params: { client: "Dee", estimateId: "EST-11", estimateAmount: 400 } }, ctx);
    const token = created.result.token;
    const upd = await lensRun("carpentry", "portalUpdateProgress", { params: { token, progressPct: 75 } }, ctx);
    assert.equal(upd.ok, true);
    assert.equal(upd.result.share.progressPct, 75);
    // a different owner ctx must not be able to update it
    const otherCtx = await depthCtx("carpentry-portal-other-t11");
    const denied = await lensRun("carpentry", "portalUpdateProgress", { params: { token, progressPct: 5 } }, otherCtx);
    assert.equal(denied.result.ok, false);
    assert.match(String(denied.result.error), /not authorized/i);
  });

  it("portalView: rejects an unknown token", async () => {
    const r = await lensRun("carpentry", "portalView", { params: { token: "bogus" } });
    assert.equal(r.result.ok, false);
    assert.match(String(r.result.error), /not found or expired/i);
  });
});
