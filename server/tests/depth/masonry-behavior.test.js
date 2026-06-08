// tests/depth/masonry-behavior.test.js
// REAL behavioral tests for the masonry lens-action domain (29 actions).
import { describe, it, before } from "node:test";
import assert from "node:assert/strict";
import { lensRun, depthCtx } from "./_harness.js";

describe("masonry — calc actions (exact values)", () => {
  it("materialEstimate: brick units + cost scale with area", async () => {
    const r = await lensRun("masonry", "materialEstimate", { data: { material: "brick", squareFootage: 200 } });
    assert.equal(r.ok, true);
    assert.equal(r.result.unitsNeeded, 1470);                 // brick ≈ 7.35 units/ft² × 200
    assert.ok(r.result.totalMaterialCost > 0);
    const half = await lensRun("masonry", "materialEstimate", { data: { material: "brick", squareFootage: 100 } });
    assert.ok(half.result.unitsNeeded < r.result.unitsNeeded, "fewer ft² ⇒ fewer units");
  });

  it("mortarMix: Type N → 1:1:6 ratio, 750 psi", async () => {
    const r = await lensRun("masonry", "mortarMix", { params: { type: "N" }, data: { type: "N" } });
    assert.equal(r.ok, true);
    assert.match(r.result.ratio, /1:1:6/);
    assert.match(String(r.result.strength), /750/);
  });

  it("wallStrength: slenderness = height/thickness; taller wall ⇒ higher ratio", async () => {
    const r = await lensRun("masonry", "wallStrength", { data: { heightFeet: 8, thicknessInches: 8, reinforced: true } });
    assert.equal(r.ok, true);
    assert.equal(r.result.slendernessRatio, 12);              // 96in / 8in
    assert.equal(r.result.passesSlenderness, true);
    const tall = await lensRun("masonry", "wallStrength", { data: { heightFeet: 16, thicknessInches: 8 } });
    assert.ok(tall.result.slendernessRatio > r.result.slendernessRatio, "taller wall is more slender");
  });
});

describe("masonry — CRUD lifecycle", () => {
  let ctx;
  before(async () => { ctx = await depthCtx("masonry-crud"); });

  it("takeoff-save → takeoff-list: a saved takeoff is listed", async () => {
    const saved = await lensRun("masonry", "takeoff-save", { params: { name: "Wall A", material: "brick" } }, ctx);
    assert.equal(saved.ok, true);
    const id = saved.result.id;
    const list = await lensRun("masonry", "takeoff-list", { params: {} }, ctx);
    assert.ok((list.result.takeoffs || []).some((t) => t.id === id), "takeoff is listed");
  });

  it("pricebook-save → pricebook-list: a price item reads back by id", async () => {
    const saved = await lensRun("masonry", "pricebook-save", { params: { name: "Brick (std)", unitCost: 0.75 } }, ctx);
    assert.equal(saved.ok, true);
    assert.equal(saved.result.name, "Brick (std)");
    const id = saved.result.id;
    const list = await lensRun("masonry", "pricebook-list", { params: {} }, ctx);
    assert.ok((list.result.items || []).some((i) => i.id === id), "price item is listed");
  });
});

describe("masonry — jobCosting (exact arithmetic)", () => {
  it("empty items ⇒ guidance message, no totals", async () => {
    const r = await lensRun("masonry", "jobCosting", { data: { items: [] } });
    assert.equal(r.ok, true);
    assert.ok((r.result.message || "").length > 0, "returns a prompt message");
    assert.equal(r.result.grandTotal, undefined);
  });

  // NOTE: lens.run double-nests a macro's own {ok:false} refusal — the outer
  // r.ok stays true and the refusal surfaces at r.result.ok / r.result.error.

  it("labor + materials → overhead 15% + profit 10% compound exactly", async () => {
    // hours 10 @ rate 50 = 500 labor; materials 300 → item total 800
    const r = await lensRun("masonry", "jobCosting", {
      data: { items: [{ name: "Brick wall", hours: 10, rate: 50, materialCost: 300 }] },
    });
    assert.equal(r.ok, true);
    assert.equal(r.result.subtotalLabor, 500);
    assert.equal(r.result.subtotalMaterials, 300);
    // overhead = round((500+300)*0.15) = 120
    assert.equal(r.result.overhead, 120);
    // profit = round((800+120)*0.10) = 92
    assert.equal(r.result.profit, 92);
    // grandTotal = 500 + 300 + 120 + 92 = 1012
    assert.equal(r.result.grandTotal, 1012);
    assert.equal(r.result.items[0].laborCost, 500);
    assert.equal(r.result.items[0].totalCost, 800);
  });

  it("missing rate defaults to 55/hr", async () => {
    const r = await lensRun("masonry", "jobCosting", { data: { items: [{ name: "x", hours: 2 }] } });
    assert.equal(r.result.items[0].laborRate, 55);
    assert.equal(r.result.items[0].laborCost, 110); // 2 × 55
  });
});

describe("masonry — mortarMix application table", () => {
  it("structural → Type S, 1800 psi", async () => {
    const r = await lensRun("masonry", "mortarMix", { data: { application: "structural" } });
    assert.equal(r.ok, true);
    assert.equal(r.result.type, "Type S");
    assert.ok(String(r.result.strength).includes("1800"));
  });

  it("unknown application falls back to general (Type N)", async () => {
    const r = await lensRun("masonry", "mortarMix", { data: { application: "not-a-real-mix" } });
    assert.equal(r.ok, true);
    assert.equal(r.result.type, "Type N");
    assert.ok(r.result.ratio.includes("1:1:6"));
  });
});

describe("masonry — wallStrength slenderness gating", () => {
  it("over-slender unreinforced wall fails and recommends fix", async () => {
    // 24ft × 8in → ratio 36 > 20 (unreinforced max)
    const r = await lensRun("masonry", "wallStrength", { data: { heightFeet: 24, thicknessInches: 8, reinforced: false } });
    assert.equal(r.ok, true);
    assert.equal(r.result.slendernessRatio, 36);
    assert.equal(r.result.maxAllowedRatio, 20);
    assert.equal(r.result.passesSlenderness, false);
    assert.ok(r.result.recommendation.includes("too slender"));
  });
});

describe("masonry — takeoff compute (area + material math)", () => {
  let ctx;
  before(async () => { ctx = await depthCtx("masonry-takeoff"); });

  it("net area = gross − openings; units include waste factor", async () => {
    // segment 10ft × 8ft = 80 ft² gross; opening 3ft × 4ft = 12 ft²; net 68 ft²
    // brick: ceil(68 × 7 × 1.10) = ceil(523.6) = 524 units (10% waste)
    const r = await lensRun("masonry", "takeoff-save", {
      params: {
        name: "Garage wall", material: "brick", wastePct: 10,
        segments: [{ label: "S", lengthFeet: 10, heightFeet: 8 }],
        openings: [{ label: "Door", widthFeet: 3, heightFeet: 4 }],
      },
    }, ctx);
    assert.equal(r.ok, true);
    assert.equal(r.result.grossAreaSqFt, 80);
    assert.equal(r.result.openingAreaSqFt, 12);
    assert.equal(r.result.netAreaSqFt, 68);
    assert.equal(r.result.linearFeet, 10);
    assert.equal(r.result.unitsNeeded, 524);
    // mortar bags = ceil(68 × 0.02) = ceil(1.36) = 2; mortarCost = 2 × 12 = 24
    assert.equal(r.result.mortarBags80lb, 2);
    assert.equal(r.result.mortarCost, 24);
    // materialCost = round(524 × 0.75) = 393
    assert.equal(r.result.materialCost, 393);
    assert.equal(r.result.totalMaterialCost, 393 + 24);
  });

  it("takeoff-save (existing id) updates in place; takeoff-delete removes it", async () => {
    const c2 = await depthCtx("masonry-takeoff-edit");
    const saved = await lensRun("masonry", "takeoff-save", { params: { name: "First" } }, c2);
    const id = saved.result.id;
    const upd = await lensRun("masonry", "takeoff-save", { params: { id, name: "Renamed" } }, c2);
    assert.equal(upd.result.id, id);
    assert.equal(upd.result.name, "Renamed");
    const list1 = await lensRun("masonry", "takeoff-list", {}, c2);
    assert.equal(list1.result.takeoffs.filter((t) => t.id === id).length, 1, "no duplicate row on update");
    const del = await lensRun("masonry", "takeoff-delete", { params: { id } }, c2);
    assert.equal(del.ok, true);
    assert.equal(del.result.deleted, id);
    const list2 = await lensRun("masonry", "takeoff-list", {}, c2);
    assert.ok(!list2.result.takeoffs.some((t) => t.id === id), "deleted takeoff is gone");
  });

  it("takeoff-delete on missing id is refused", async () => {
    const r = await lensRun("masonry", "takeoff-delete", { params: { id: "nope" } }, ctx);
    assert.equal(r.result.ok, false);
    assert.ok(r.result.error.includes("not found"));
  });
});

describe("masonry — pricebook seeding + delete", () => {
  it("pricebook-list seeds the default book on first call", async () => {
    const c = await depthCtx("masonry-pb-seed");
    const r = await lensRun("masonry", "pricebook-list", {}, c);
    assert.equal(r.ok, true);
    assert.ok(r.result.items.some((i) => i.sku === "BRK-STD"), "default brick sku seeded");
    assert.ok(r.result.items.some((i) => i.sku === "LAB-MAS"));
  });

  it("pricebook-save requires a name", async () => {
    const c = await depthCtx("masonry-pb-name");
    const r = await lensRun("masonry", "pricebook-save", { params: { unitCost: 5 } }, c);
    assert.equal(r.result.ok, false);
    assert.ok(r.result.error.includes("Name required"));
  });

  it("pricebook-save → pricebook-delete round-trip", async () => {
    const c = await depthCtx("masonry-pb-del");
    const saved = await lensRun("masonry", "pricebook-save", { params: { name: "Custom mortar", unitCost: 14.5 } }, c);
    const id = saved.result.id;
    assert.equal(saved.result.unitCost, 14.5);
    const del = await lensRun("masonry", "pricebook-delete", { params: { id } }, c);
    assert.equal(del.ok, true);
    assert.equal(del.result.deleted, id);
    const list = await lensRun("masonry", "pricebook-list", {}, c);
    assert.ok(!list.result.items.some((i) => i.id === id));
  });
});

describe("masonry — proposals (pricing + lifecycle + render)", () => {
  let ctx;
  before(async () => { ctx = await depthCtx("masonry-proposal"); });

  it("proposal-create prices margin then tax in correct order", async () => {
    // line: 100 units @ 2.00 = 200 subtotal; margin 15% = 30; taxable 230; tax 10% = 23; total 253
    const r = await lensRun("masonry", "proposal-create", {
      params: {
        client: "Acme Corp", projectTitle: "Retaining wall", marginPct: 15, taxPct: 10,
        lineItems: [{ description: "Block", unit: "each", quantity: 100, unitCost: 2 }],
      },
    }, ctx);
    assert.equal(r.ok, true);
    assert.equal(r.result.subtotal, 200);
    assert.equal(r.result.margin, 30);
    assert.equal(r.result.tax, 23);
    assert.equal(r.result.total, 253);
    assert.equal(r.result.status, "draft");
    assert.ok(r.result.number.startsWith("PROP-"));
    assert.equal(r.result.lines[0].lineTotal, 200);
  });

  it("proposal-create requires a client name", async () => {
    const r = await lensRun("masonry", "proposal-create", { params: { lineItems: [] } }, ctx);
    assert.equal(r.result.ok, false);
    assert.ok(r.result.error.includes("Client"));
  });

  it("proposal-update-status to accepted stamps acceptedAt; list reflects it", async () => {
    const c = await depthCtx("masonry-prop-status");
    const created = await lensRun("masonry", "proposal-create", { params: { client: "Beta LLC", lineItems: [{ quantity: 1, unitCost: 100 }] } }, c);
    const id = created.result.id;
    assert.equal(created.result.acceptedAt, null);
    const upd = await lensRun("masonry", "proposal-update-status", { params: { id, status: "accepted" } }, c);
    assert.equal(upd.ok, true);
    assert.equal(upd.result.status, "accepted");
    assert.ok(upd.result.acceptedAt);
    const list = await lensRun("masonry", "proposal-list", {}, c);
    assert.ok(list.result.proposals.some((p) => p.id === id && p.status === "accepted"));
  });

  it("proposal-update-status on missing id is refused", async () => {
    const r = await lensRun("masonry", "proposal-update-status", { params: { id: "ghost", status: "sent" } }, ctx);
    assert.equal(r.result.ok, false);
    assert.ok(r.result.error.includes("not found"));
  });

  it("proposal-render emits a document with line + total", async () => {
    const c = await depthCtx("masonry-prop-render");
    const created = await lensRun("masonry", "proposal-create", {
      params: { client: "Gamma", projectTitle: "Chimney", lineItems: [{ description: "Stone", unit: "sqft", quantity: 50, unitCost: 8 }] },
    }, c);
    const r = await lensRun("masonry", "proposal-render", { params: { id: created.result.id } }, c);
    assert.equal(r.ok, true);
    assert.ok(r.result.document.includes("PROPOSAL"));
    assert.ok(r.result.document.includes("Gamma"));
    assert.ok(r.result.document.includes("Stone"));
    assert.equal(r.result.total, created.result.total);
  });
});

describe("masonry — schedule (weather advisory + crew load)", () => {
  let ctx;
  before(async () => { ctx = await depthCtx("masonry-schedule"); });

  it("schedule-add requires title and start date", async () => {
    const r = await lensRun("masonry", "schedule-add", { params: { title: "No date" } }, ctx);
    assert.equal(r.result.ok, false);
    assert.ok(r.result.error.includes("required"));
  });

  it("freeze + heavy precip ⇒ high risk with multiple advisories", async () => {
    const r = await lensRun("masonry", "schedule-add", {
      params: { title: "Cold job", startDate: "2026-01-15", forecastLowF: 28, precipChancePct: 70, crew: ["Sam", "Lee"], durationDays: 3 },
    }, ctx);
    assert.equal(r.ok, true);
    assert.equal(r.result.weather.risk, "high");
    assert.ok(r.result.weather.advisories.length >= 2);
    assert.equal(r.result.durationDays, 3);
  });

  it("mild forecast ⇒ clear risk; crew load aggregates by member", async () => {
    const c = await depthCtx("masonry-crewload");
    await lensRun("masonry", "schedule-add", { params: { title: "Job 1", startDate: "2026-05-01", forecastLowF: 60, crew: ["Sam"], durationDays: 2 } }, c);
    await lensRun("masonry", "schedule-add", { params: { title: "Job 2", startDate: "2026-05-10", forecastLowF: 65, crew: ["Sam"], durationDays: 4 } }, c);
    const list = await lensRun("masonry", "schedule-list", {}, c);
    assert.equal(list.ok, true);
    assert.equal(list.result.crewLoad.Sam, 6); // 2 + 4
    assert.equal(list.result.jobs.length, 2);
    // sorted by start date
    assert.equal(list.result.jobs[0].startDate, "2026-05-01");
  });

  it("schedule-delete removes a job; missing id refused", async () => {
    const c = await depthCtx("masonry-sched-del");
    const added = await lensRun("masonry", "schedule-add", { params: { title: "Temp", startDate: "2026-06-01" } }, c);
    const del = await lensRun("masonry", "schedule-delete", { params: { id: added.result.id } }, c);
    assert.equal(del.ok, true);
    const miss = await lensRun("masonry", "schedule-delete", { params: { id: "x" } }, c);
    assert.equal(miss.result.ok, false);
  });
});

describe("masonry — photos (phase grouping + timeline)", () => {
  let ctx;
  before(async () => { ctx = await depthCtx("masonry-photo"); });

  it("photo-add requires a URL; defaults phase to during", async () => {
    const bad = await lensRun("masonry", "photo-add", { params: { caption: "no url" } }, ctx);
    assert.equal(bad.result.ok, false);
    const ok = await lensRun("masonry", "photo-add", { params: { url: "http://x/a.jpg" } }, ctx);
    assert.equal(ok.ok, true);
    assert.equal(ok.result.phase, "during");
  });

  it("photo-list groups by phase and filters by jobId", async () => {
    const c = await depthCtx("masonry-photo-group");
    await lensRun("masonry", "photo-add", { params: { url: "u1", phase: "before", jobId: "J1", takenAt: "2026-01-01" } }, c);
    await lensRun("masonry", "photo-add", { params: { url: "u2", phase: "after", jobId: "J1", takenAt: "2026-02-01" } }, c);
    await lensRun("masonry", "photo-add", { params: { url: "u3", phase: "before", jobId: "J2" } }, c);
    const list = await lensRun("masonry", "photo-list", { params: { jobId: "J1" } }, c);
    assert.equal(list.ok, true);
    assert.equal(list.result.photos.length, 2);
    assert.equal(list.result.byPhase.before.length, 1);
    assert.equal(list.result.byPhase.after.length, 1);
    // timeline ascending by takenAt
    assert.equal(list.result.timeline[0].url, "u1");
  });

  it("photo-delete removes; missing id refused", async () => {
    const c = await depthCtx("masonry-photo-del");
    const added = await lensRun("masonry", "photo-add", { params: { url: "del-me" } }, c);
    const del = await lensRun("masonry", "photo-delete", { params: { id: added.result.id } }, c);
    assert.equal(del.ok, true);
    const miss = await lensRun("masonry", "photo-delete", { params: { id: "z" } }, c);
    assert.equal(miss.result.ok, false);
  });
});

describe("masonry — change orders (cost math + sign-off totals)", () => {
  let ctx;
  before(async () => { ctx = await depthCtx("masonry-co"); });

  it("change-order-create computes labor + material amount exactly", async () => {
    // labor 8h × 60 = 480; material 200 → amount 680
    const r = await lensRun("masonry", "change-order-create", {
      params: { description: "Add buttress", laborHours: 8, laborRate: 60, materialCost: 200 },
    }, ctx);
    assert.equal(r.ok, true);
    assert.equal(r.result.laborCost, 480);
    assert.equal(r.result.materialCost, 200);
    assert.equal(r.result.amount, 680);
    assert.equal(r.result.status, "pending");
    assert.ok(r.result.number.startsWith("CO-"));
  });

  it("change-order-create requires a description", async () => {
    const r = await lensRun("masonry", "change-order-create", { params: { laborHours: 1 } }, ctx);
    assert.equal(r.result.ok, false);
    assert.ok(r.result.error.includes("Description"));
  });

  it("sign-off → approved moves amount into approvedTotal", async () => {
    const c = await depthCtx("masonry-co-sign");
    const co = await lensRun("masonry", "change-order-create", { params: { description: "Extra", laborHours: 10, laborRate: 50, materialCost: 0 } }, c);
    assert.equal(co.result.amount, 500);
    const signed = await lensRun("masonry", "change-order-sign", { params: { id: co.result.id, status: "approved", signedBy: "Owner" } }, c);
    assert.equal(signed.ok, true);
    assert.equal(signed.result.status, "approved");
    assert.equal(signed.result.signedBy, "Owner");
    assert.ok(signed.result.signedOffAt);
    const list = await lensRun("masonry", "change-order-list", {}, c);
    assert.equal(list.result.approvedTotal, 500);
    assert.equal(list.result.pendingTotal, 0);
  });

  it("change-order-sign on missing id refused", async () => {
    const r = await lensRun("masonry", "change-order-sign", { params: { id: "none" } }, ctx);
    assert.equal(r.result.ok, false);
    assert.ok(r.result.error.includes("not found"));
  });
});

describe("masonry — invoicing (progress billing + payment tracking)", () => {
  let ctx;
  before(async () => { ctx = await depthCtx("masonry-inv"); });

  it("invoice-create computes amount from progress percentage", async () => {
    // contract 10000 @ 50% → amount 5000, balance 5000
    const r = await lensRun("masonry", "invoice-create", { params: { client: "Delta", contractTotal: 10000, progressPct: 50 } }, ctx);
    assert.equal(r.ok, true);
    assert.equal(r.result.amount, 5000);
    assert.equal(r.result.balance, 5000);
    assert.equal(r.result.status, "unpaid");
    assert.ok(r.result.number.startsWith("INV-"));
  });

  it("invoice-create requires client + positive total", async () => {
    const r = await lensRun("masonry", "invoice-create", { params: { client: "", contractTotal: 0 } }, ctx);
    assert.equal(r.result.ok, false);
    assert.ok(r.result.error.includes("required"));
  });

  it("partial then full payment transitions status and zeroes balance", async () => {
    const c = await depthCtx("masonry-inv-pay");
    const inv = await lensRun("masonry", "invoice-create", { params: { client: "Echo", contractTotal: 1000, progressPct: 100 } }, c);
    const id = inv.result.id;
    assert.equal(inv.result.amount, 1000);
    const p1 = await lensRun("masonry", "invoice-record-payment", { params: { id, amount: 400 } }, c);
    assert.equal(p1.result.amountPaid, 400);
    assert.equal(p1.result.balance, 600);
    assert.equal(p1.result.status, "partial");
    const p2 = await lensRun("masonry", "invoice-record-payment", { params: { id, amount: 600 } }, c);
    assert.equal(p2.result.balance, 0);
    assert.equal(p2.result.status, "paid");
    const list = await lensRun("masonry", "invoice-list", {}, c);
    assert.equal(list.result.totalCollected, 1000);
    assert.equal(list.result.outstanding, 0);
  });

  it("payment must be positive; invoice-delete removes", async () => {
    const c = await depthCtx("masonry-inv-del");
    const inv = await lensRun("masonry", "invoice-create", { params: { client: "Foxtrot", contractTotal: 500, progressPct: 100 } }, c);
    const bad = await lensRun("masonry", "invoice-record-payment", { params: { id: inv.result.id, amount: 0 } }, c);
    assert.equal(bad.result.ok, false);
    assert.ok(bad.result.error.includes("positive"));
    const del = await lensRun("masonry", "invoice-delete", { params: { id: inv.result.id } }, c);
    assert.equal(del.ok, true);
    assert.equal(del.result.deleted, inv.result.id);
  });
});

describe("masonry — code reference library", () => {
  it("code-search filters by standard and query", async () => {
    const byStd = await lensRun("masonry", "code-search", { params: { standard: "IBC" } });
    assert.equal(byStd.ok, true);
    assert.ok(byStd.result.count >= 1);
    assert.ok(byStd.result.results.every((c) => c.standard === "IBC"));
    assert.ok(byStd.result.standards.includes("TMS"));
    const byQuery = await lensRun("masonry", "code-search", { params: { query: "slenderness" } });
    assert.ok(byQuery.result.results.some((c) => c.section === "5.1.1.3"));
  });

  it("code-for-check returns refs tagged for the check type", async () => {
    const r = await lensRun("masonry", "code-for-check", { params: { checkType: "mortar" } });
    assert.equal(r.ok, true);
    assert.equal(r.result.checkType, "mortar");
    assert.ok(r.result.references.every((c) => (c.tags || []).includes("mortar")));
  });

  it("code-for-check defaults to wall-strength refs for unknown check", async () => {
    const r = await lensRun("masonry", "code-for-check", { params: { checkType: "totally-unknown" } });
    assert.equal(r.ok, true);
    assert.ok(r.result.references.length >= 1);
  });
});
