// Tier-2 contract tests for the landscaping lens design-studio macros:
// visual yard designer, photo-overlay preview, plant identification,
// care reminders, climate matching, proposal builder, maintenance
// calendar, and the plant health diary. Pins per-user scoping, input
// validation, and the never-throw envelope contract.

import { describe, it, before, beforeEach } from "node:test";
import assert from "node:assert/strict";
import registerLandscapingActions from "../domains/landscaping.js";

const ACTIONS = new Map();
function register(domain, name, fn) {
  ACTIONS.set(`${domain}.${name}`, fn);
}
function call(name, ctx, params = {}) {
  const fn = ACTIONS.get(`landscaping.${name}`);
  if (!fn) throw new Error(`landscaping.${name} not registered`);
  return fn(ctx, { id: null, data: {}, meta: {} }, params);
}

before(() => {
  registerLandscapingActions(register);
});

beforeEach(() => {
  globalThis._concordSTATE = { dtus: new Map() };
  globalThis._concordSaveStateDebounced = () => {};
  globalThis.fetch = async () => { throw new Error("network disabled"); };
});

const ctxA = { actor: { userId: "user_a" }, userId: "user_a" };
const ctxB = { actor: { userId: "user_b" }, userId: "user_b" };

// ─── Feature 1 — visual yard designer ───────────────────────────────
describe("landscaping — visual yard designer", () => {
  it("creates a layout with clamped plot dimensions", () => {
    const r = call("layout-create", ctxA, { name: "Front yard", plotWidthFt: 50, plotHeightFt: 40 });
    assert.equal(r.ok, true);
    assert.equal(r.result.layout.name, "Front yard");
    assert.equal(r.result.layout.plotWidthFt, 50);
    assert.deepEqual(r.result.layout.elements, []);
  });

  it("rejects a layout with no name", () => {
    const r = call("layout-create", ctxA, {});
    assert.equal(r.ok, false);
  });

  it("lists only the caller's layouts (per-user scoping)", () => {
    call("layout-create", ctxA, { name: "A yard" });
    call("layout-create", ctxB, { name: "B yard" });
    const a = call("layout-list", ctxA, {});
    assert.equal(a.ok, true);
    assert.equal(a.result.count, 1);
    assert.equal(a.result.layouts[0].name, "A yard");
  });

  it("saves drag-drop elements and clamps coords to the plot", () => {
    const created = call("layout-create", ctxA, { name: "Plot", plotWidthFt: 20, plotHeightFt: 20 });
    const id = created.result.layout.id;
    const r = call("layout-save-elements", ctxA, {
      layoutId: id,
      elements: [
        { kind: "tree", label: "Oak", x: 999, y: -5, widthFt: 8, heightFt: 8 },
        { kind: "bogus", label: "Bed", x: 5, y: 5 },
      ],
    });
    assert.equal(r.ok, true);
    assert.equal(r.result.elementCount, 2);
    assert.equal(r.result.layout.elements[0].x, 20);
    assert.equal(r.result.layout.elements[0].y, 0);
    assert.equal(r.result.layout.elements[1].kind, "plant");
  });

  it("rejects element save against an unknown layout", () => {
    const r = call("layout-save-elements", ctxA, { layoutId: "nope", elements: [] });
    assert.equal(r.ok, false);
  });

  it("deletes a layout", () => {
    const created = call("layout-create", ctxA, { name: "Temp" });
    const r = call("layout-delete", ctxA, { id: created.result.layout.id });
    assert.equal(r.ok, true);
    assert.equal(call("layout-list", ctxA, {}).result.count, 0);
  });
});

// ─── Feature 2 — AR / photo-overlay preview ─────────────────────────
describe("landscaping — photo-overlay preview", () => {
  it("creates an overlay and does not echo the heavy photo back", () => {
    const r = call("overlay-create", ctxA, { name: "Backyard", photoUrl: "data:image/png;base64,AAA" });
    assert.equal(r.ok, true);
    assert.equal(r.result.overlay.hasPhoto, true);
    assert.equal(r.result.overlay.photoUrl, undefined);
  });

  it("rejects an overlay with no photo", () => {
    assert.equal(call("overlay-create", ctxA, { name: "x" }).ok, false);
  });

  it("places plants on an overlay with clamped percentages", () => {
    const created = call("overlay-create", ctxA, { photoUrl: "data:image/png;base64,AAA" });
    const r = call("overlay-place", ctxA, {
      overlayId: created.result.overlay.id,
      placements: [{ plant: "Maple", xPct: 150, yPct: -10, scalePct: 500 }],
    });
    assert.equal(r.ok, true);
    assert.equal(r.result.overlay.placements[0].xPct, 100);
    assert.equal(r.result.overlay.placements[0].yPct, 0);
    assert.equal(r.result.overlay.placements[0].scalePct, 300);
  });

  it("lists and deletes overlays", () => {
    const created = call("overlay-create", ctxA, { photoUrl: "data:image/png;base64,AAA" });
    assert.equal(call("overlay-list", ctxA, {}).result.count, 1);
    assert.equal(call("overlay-delete", ctxA, { id: created.result.overlay.id }).ok, true);
    assert.equal(call("overlay-list", ctxA, {}).result.count, 0);
  });
});

// ─── Feature 3 — plant identification from photo ────────────────────
describe("landscaping — plant identification", () => {
  it("rejects a request with neither image input", async () => {
    const r = await call("identify-plant", ctxA, {});
    assert.equal(r.ok, false);
  });

  it("surfaces vision-brain failures without throwing", async () => {
    const r = await call("identify-plant", ctxA, { imageB64: "AAA" });
    assert.equal(r.ok, false);
    assert.equal(typeof r.error, "string");
  });

  it("parses a real strict-JSON vision response into structured fields (regression: was reading nonexistent r.result.description, always empty)", async () => {
    globalThis.fetch = async () => ({
      ok: true,
      json: async () => ({
        message: {
          content: JSON.stringify({
            commonName: "Lavender",
            scientificName: "Lavandula angustifolia",
            plantType: "perennial",
            healthStatus: "healthy",
            healthNotes: "",
          }),
        },
      }),
    });
    const r = await call("identify-plant", ctxA, { imageB64: "AAA" });
    assert.equal(r.ok, true);
    assert.equal(r.result.source, "vision-brain");
    assert.ok(r.result.identification.includes("Lavandula angustifolia"), "raw text is still returned for back-compat");
    assert.deepEqual(r.result.structured, {
      commonName: "Lavender",
      scientificName: "Lavandula angustifolia",
      plantType: "perennial",
      healthStatus: "healthy",
      healthNotes: null,
    });
  });

  it("degrades honestly to structured:null (never fabricated fields) when the model replies with prose instead of JSON", async () => {
    globalThis.fetch = async () => ({
      ok: true,
      json: async () => ({ message: { content: "This looks like a rose bush, quite healthy." } }),
    });
    const r = await call("identify-plant", ctxA, { imageB64: "AAA" });
    assert.equal(r.ok, true);
    assert.equal(r.result.identification, "This looks like a rose bush, quite healthy.");
    assert.equal(r.result.structured, null);
  });

  it("rejects an unrecognized plantType/healthStatus enum value rather than passing it through unvalidated", async () => {
    globalThis.fetch = async () => ({
      ok: true,
      json: async () => ({
        message: {
          content: JSON.stringify({ commonName: "Mystery plant", plantType: "not-a-real-type", healthStatus: "also-fake" }),
        },
      }),
    });
    const r = await call("identify-plant", ctxA, { imageB64: "AAA" });
    assert.equal(r.ok, true);
    assert.equal(r.result.structured.plantType, null);
    assert.equal(r.result.structured.healthStatus, null);
    assert.equal(r.result.structured.commonName, "Mystery plant");
  });
});

// ─── Feature 4 — plant-care reminders ───────────────────────────────
describe("landscaping — care reminders", () => {
  it("derives an overdue reminder from a stale care-log entry", () => {
    const bed = call("bed-add", ctxA, { name: "Rose bed" }).result.bed;
    const oldDate = new Date(Date.now() - 30 * 86_400_000).toISOString().slice(0, 10);
    call("care-log", ctxA, { bedId: bed.id, kind: "water", date: oldDate });
    const r = call("care-reminders", ctxA, { horizonDays: 14 });
    assert.equal(r.ok, true);
    assert.equal(r.result.count >= 1, true);
    const waterRem = r.result.reminders.find((x) => x.kind === "water");
    assert.equal(waterRem.overdue, true);
  });

  it("returns an empty set when no care has been logged", () => {
    call("bed-add", ctxA, { name: "Empty bed" });
    const r = call("care-reminders", ctxA, {});
    assert.equal(r.ok, true);
    assert.equal(r.result.count, 0);
  });
});

// ─── Feature 5 — climate / hardiness-zone matching ──────────────────
describe("landscaping — climate match", () => {
  it("rejects invalid coordinates", async () => {
    assert.equal((await call("climate-match", ctxA, {})).ok, false);
    assert.equal((await call("climate-match", ctxA, { lat: 200, lon: 0 })).ok, false);
  });

  it("derives a hardiness zone + zone-suitable plants from forecast data", async () => {
    globalThis.fetch = async () => ({
      ok: true,
      json: async () => ({
        daily: {
          temperature_2m_min: [-5, -8, -3, -10, -6],
          temperature_2m_max: [12, 15, 11, 9, 14],
        },
      }),
    });
    const r = await call("climate-match", ctxA, { lat: 41.5, lon: -93.5 });
    assert.equal(r.ok, true);
    assert.equal(typeof r.result.hardinessZone, "number");
    assert.equal(Array.isArray(r.result.recommendations), true);
    assert.equal(r.result.source, "open-meteo");
  });

  it("surfaces network failures", async () => {
    const r = await call("climate-match", ctxA, { lat: 41.5, lon: -93.5 });
    assert.equal(r.ok, false);
  });
});

// ─── Feature 6 — cost estimate -> proposal ──────────────────────────
describe("landscaping — proposal builder", () => {
  it("rejects a proposal with no line items", () => {
    assert.equal(call("proposal-build", ctxA, { client: "X" }).ok, false);
  });

  it("computes subtotal / overhead / margin / tax / total + markdown", () => {
    const r = call("proposal-build", ctxA, {
      client: "Jane Doe",
      project: "Front yard refresh",
      overheadPct: 10,
      marginPct: 20,
      taxPct: 5,
      lineItems: [
        { description: "Labor", category: "labor", unit: "hr", quantity: 10, unitCost: 50 },
        { description: "Mulch", category: "materials", unit: "yd", quantity: 4, unitCost: 35 },
      ],
    });
    assert.equal(r.ok, true);
    assert.equal(r.result.subtotal, 640);
    assert.equal(r.result.overhead, 64);
    assert.equal(r.result.margin, 140.8);
    assert.equal(r.result.total > r.result.subtotal, true);
    assert.match(r.result.proposalMarkdown, /Landscaping Proposal/);
    assert.match(r.result.proposalMarkdown, /Jane Doe/);
  });
});

// ─── Feature 7 — maintenance calendar ───────────────────────────────
describe("landscaping — maintenance calendar", () => {
  it("returns a generic 12-month schedule for the whole yard", () => {
    const r = call("maintenance-calendar", ctxA, {});
    assert.equal(r.ok, true);
    assert.equal(r.result.generic.length, 12);
    assert.equal(Array.isArray(r.result.generic[0].tasks), true);
  });

  it("returns a bed-specific calendar biased by sun exposure", () => {
    const bed = call("bed-add", ctxA, { name: "Sunny bed", sunExposure: "full" }).result.bed;
    const r = call("maintenance-calendar", ctxA, { bedId: bed.id });
    assert.equal(r.ok, true);
    assert.equal(r.result.bedId, bed.id);
    assert.equal(r.result.months.length, 12);
    const july = r.result.months[6];
    assert.equal(july.tasks.some((t) => /full sun/i.test(t)), true);
  });

  it("rejects an unknown bed id", () => {
    assert.equal(call("maintenance-calendar", ctxA, { bedId: "nope" }).ok, false);
  });
});

// ─── Feature 8 — plant health diary ─────────────────────────────────
describe("landscaping — plant health diary", () => {
  it("adds a diary entry and hides the heavy photo in the response", () => {
    const r = call("diary-add", ctxA, {
      plant: "Tomato",
      health: "thriving",
      heightCm: 45,
      photoUrl: "data:image/png;base64,AAA",
      notes: "First fruit",
    });
    assert.equal(r.ok, true);
    assert.equal(r.result.entry.plant, "Tomato");
    assert.equal(r.result.entry.hasPhoto, true);
    assert.equal(r.result.entry.photoUrl, undefined);
  });

  it("rejects a diary entry with no plant name", () => {
    assert.equal(call("diary-add", ctxA, {}).ok, false);
  });

  it("returns a date-sorted timeline filterable by plant", () => {
    call("diary-add", ctxA, { plant: "Tomato", date: "2026-05-10", health: "healthy" });
    call("diary-add", ctxA, { plant: "Tomato", date: "2026-04-01", health: "stressed" });
    call("diary-add", ctxA, { plant: "Basil", date: "2026-05-01", health: "thriving" });
    const all = call("diary-timeline", ctxA, {});
    assert.equal(all.ok, true);
    assert.equal(all.result.count, 3);
    assert.equal(all.result.entries[0].date, "2026-04-01");
    const filtered = call("diary-timeline", ctxA, { plant: "Tomato" });
    assert.equal(filtered.result.count, 2);
    assert.equal(filtered.result.entries.every((e) => e.plant === "Tomato"), true);
  });

  it("deletes a diary entry", () => {
    const added = call("diary-add", ctxA, { plant: "Mint" });
    const r = call("diary-delete", ctxA, { id: added.result.entry.id });
    assert.equal(r.ok, true);
    assert.equal(call("diary-timeline", ctxA, {}).result.count, 0);
  });

  it("scopes the diary per-user", () => {
    call("diary-add", ctxA, { plant: "A-plant" });
    const b = call("diary-timeline", ctxB, {});
    assert.equal(b.result.count, 0);
  });
});

// ─── Feature 9 — job scheduling / dispatch board ────────────────────
describe("landscaping — job scheduling / dispatch board", () => {
  it("job-schedule requires a title and defaults status to scheduled", () => {
    assert.equal(call("job-schedule", ctxA, {}).ok, false);
    const r = call("job-schedule", ctxA, {
      title: "Spring cleanup", client: "Acme HOA", address: "12 Elm St",
      crew: "Crew A", date: "2026-06-01", startHour: 9, durationHours: 3,
    });
    assert.equal(r.ok, true);
    assert.ok(r.result.job.id);
    assert.equal(r.result.job.status, "scheduled");
    assert.equal(r.result.job.crew, "Crew A");
    assert.equal(r.result.job.durationHours, 3);
  });

  it("job-schedule rejects an unknown bedId but accepts a real one", () => {
    assert.equal(call("job-schedule", ctxA, { title: "Bed job", bedId: "bed_bogus" }).ok, false);
    const bed = call("bed-add", ctxA, { name: "Rose bed" }).result.bed;
    const r = call("job-schedule", ctxA, { title: "Bed job", bedId: bed.id });
    assert.equal(r.ok, true);
    assert.equal(r.result.job.bedId, bed.id);
  });

  it("job-schedule clamps startHour/durationHours and accepts an optional proposalId", () => {
    const r = call("job-schedule", ctxA, {
      title: "Overnight job", startHour: 99, durationHours: -5, proposalId: "prop_123",
    });
    assert.equal(r.ok, true);
    assert.equal(r.result.job.startHour, 23);
    assert.equal(r.result.job.durationHours, 0.5);
    assert.equal(r.result.job.proposalId, "prop_123");
  });

  it("job-list groups jobs into crew lanes + an unassigned lane with load hours", () => {
    call("job-schedule", ctxA, { title: "A", crew: "Crew A", date: "2026-06-02", durationHours: 2 });
    call("job-schedule", ctxA, { title: "B", crew: "Crew A", date: "2026-06-02", durationHours: 1.5 });
    call("job-schedule", ctxA, { title: "C", date: "2026-06-02" });
    const board = call("job-list", ctxA, { date: "2026-06-02" });
    assert.equal(board.ok, true);
    assert.equal(board.result.count, 3);
    assert.equal(board.result.lanes.length, 1);
    assert.equal(board.result.lanes[0].crew, "Crew A");
    assert.equal(board.result.lanes[0].loadHours, 3.5);
    assert.equal(board.result.unassigned.length, 1);
    assert.equal(board.result.scheduledCount, 3);
  });

  it("job-list filters by status and by date range", () => {
    call("job-schedule", ctxA, { title: "Early", date: "2026-05-01" });
    const mid = call("job-schedule", ctxA, { title: "Mid", date: "2026-05-15" }).result.job;
    call("job-schedule", ctxA, { title: "Late", date: "2026-06-01" });
    call("job-complete", ctxA, { id: mid.id });

    const done = call("job-list", ctxA, { status: "completed" });
    assert.equal(done.ok, true);
    assert.equal(done.result.count, 1);
    assert.equal(done.result.jobs[0].id, mid.id);

    const ranged = call("job-list", ctxA, { dateFrom: "2026-05-10", dateTo: "2026-05-31" });
    assert.equal(ranged.ok, true);
    assert.equal(ranged.result.count, 1);
    assert.equal(ranged.result.jobs[0].title, "Mid");

    assert.equal(call("job-list", ctxA, { status: "bogus" }).ok, false);
  });

  it("job-list scopes jobs per-user", () => {
    call("job-schedule", ctxA, { title: "A-job" });
    const b = call("job-list", ctxB, {});
    assert.equal(b.ok, true);
    assert.equal(b.result.count, 0);
  });

  it("job-complete stamps completion and rejects a second completion", () => {
    const job = call("job-schedule", ctxA, { title: "Hedge trim" }).result.job;
    const done = call("job-complete", ctxA, { id: job.id, notes: "Done, hauled clippings" });
    assert.equal(done.ok, true);
    assert.equal(done.result.job.status, "completed");
    assert.ok(done.result.job.completedAt);
    assert.equal(done.result.job.completionNotes, "Done, hauled clippings");

    const again = call("job-complete", ctxA, { id: job.id });
    assert.equal(again.ok, false);
    assert.match(again.error, /already completed/);
  });

  it("job-complete rejects an unknown job id", () => {
    assert.equal(call("job-complete", ctxA, { id: "nope" }).ok, false);
  });

  it("job-complete rejects a cancelled job", () => {
    // No job-cancel macro exists yet (out of scope for this triple) — poke
    // the in-memory record directly to exercise the cancelled-job guard.
    const job = call("job-schedule", ctxA, { title: "Cancel me" }).result.job;
    globalThis._concordSTATE.landscapingLens.jobs.get("user_a").find((j) => j.id === job.id).status = "cancelled";
    const r = call("job-complete", ctxA, { id: job.id });
    assert.equal(r.ok, false);
    assert.match(r.error, /cancelled/);
  });
});

// ─── Feature 10 — proposal -> invoice status machine ────────────────
describe("landscaping — invoice-from-proposal", () => {
  const lineItems = [
    { description: "Labor", category: "labor", unit: "hr", quantity: 10, unitCost: 50 },
    { description: "Mulch", category: "materials", unit: "yd", quantity: 4, unitCost: 35 },
  ];

  it("rejects conversion with no lineItems", () => {
    const r = call("invoice-from-proposal", ctxA, { client: "X" });
    assert.equal(r.ok, false);
    assert.match(r.error, /lineItems/);
  });

  it("converts a proposal's raw inputs into a draft invoice with server-derived totals", () => {
    const r = call("invoice-from-proposal", ctxA, {
      client: "Jane Doe",
      project: "Front yard refresh",
      overheadPct: 10,
      marginPct: 20,
      taxPct: 5,
      lineItems,
      proposalRef: "prop_abc",
    });
    assert.equal(r.ok, true);
    const inv = r.result.invoice;
    assert.ok(inv.id);
    assert.match(inv.number, /^INV-\d{4}$/);
    assert.equal(inv.status, "draft");
    assert.equal(inv.client, "Jane Doe");
    assert.equal(inv.proposalRef, "prop_abc");
    // same math proposal-build computes for the identical inputs
    assert.equal(inv.subtotal, 640);
    assert.equal(inv.overhead, 64);
    assert.equal(inv.margin, 140.8);
    assert.equal(inv.total > inv.subtotal, true);
    assert.equal(inv.amountPaid, 0);
    assert.deepEqual(inv.payments, []);
    assert.equal(inv.sentAt, null);
    assert.equal(inv.acceptedAt, null);
    assert.equal(inv.paidAt, null);
  });

  it("assigns sequential invoice numbers per user", () => {
    const a = call("invoice-from-proposal", ctxA, { lineItems }).result.invoice;
    const b = call("invoice-from-proposal", ctxA, { lineItems }).result.invoice;
    assert.notEqual(a.number, b.number);
  });
});

describe("landscaping — invoice-list", () => {
  it("lists only the caller's invoices with status counts + outstanding/collected totals", () => {
    const lineItems = [{ description: "Labor", quantity: 2, unitCost: 100 }];
    call("invoice-from-proposal", ctxA, { lineItems });
    call("invoice-from-proposal", ctxB, { lineItems });
    const a = call("invoice-list", ctxA, {});
    assert.equal(a.ok, true);
    assert.equal(a.result.count, 1);
    assert.equal(a.result.draftCount, 1);
    assert.equal(a.result.sentCount, 0);
    assert.equal(a.result.outstanding, 0);
    assert.equal(a.result.collected, 0);
  });

  it("filters by status and rejects an invalid status filter", () => {
    const lineItems = [{ description: "Labor", quantity: 1, unitCost: 100 }];
    const inv = call("invoice-from-proposal", ctxA, { lineItems }).result.invoice;
    call("invoice-send", ctxA, { id: inv.id });
    call("invoice-from-proposal", ctxA, { lineItems }); // stays draft

    const sent = call("invoice-list", ctxA, { status: "sent" });
    assert.equal(sent.ok, true);
    assert.equal(sent.result.count, 1);
    assert.equal(sent.result.invoices[0].id, inv.id);

    assert.equal(call("invoice-list", ctxA, { status: "bogus" }).ok, false);
  });
});

describe("landscaping — invoice status transitions (draft -> sent -> accepted -> paid)", () => {
  function freshInvoice(ctx = ctxA) {
    return call("invoice-from-proposal", ctx, {
      lineItems: [{ description: "Labor", quantity: 10, unitCost: 50 }], // subtotal 500
    }).result.invoice;
  }

  it("walks the full happy path", () => {
    const inv = freshInvoice();
    const sent = call("invoice-send", ctxA, { id: inv.id });
    assert.equal(sent.ok, true);
    assert.equal(sent.result.invoice.status, "sent");
    assert.ok(sent.result.invoice.sentAt);

    const accepted = call("invoice-accept", ctxA, { id: inv.id });
    assert.equal(accepted.ok, true);
    assert.equal(accepted.result.invoice.status, "accepted");
    assert.ok(accepted.result.invoice.acceptedAt);

    const paid = call("invoice-record-payment", ctxA, { id: inv.id, amount: accepted.result.invoice.total, method: "check" });
    assert.equal(paid.ok, true);
    assert.equal(paid.result.invoice.status, "paid");
    assert.ok(paid.result.invoice.paidAt);
    assert.equal(paid.result.balanceDue, 0);
    assert.equal(paid.result.invoice.payments.length, 1);
    assert.equal(paid.result.invoice.payments[0].method, "check");
  });

  it("supports partial payments before flipping to paid", () => {
    const inv = freshInvoice();
    call("invoice-send", ctxA, { id: inv.id });
    call("invoice-accept", ctxA, { id: inv.id });
    const half = Math.round((inv.total / 2) * 100) / 100;
    const partial = call("invoice-record-payment", ctxA, { id: inv.id, amount: half });
    assert.equal(partial.ok, true);
    assert.equal(partial.result.invoice.status, "accepted");
    assert.equal(partial.result.balanceDue > 0, true);
    const rest = call("invoice-record-payment", ctxA, { id: inv.id, amount: partial.result.balanceDue });
    assert.equal(rest.ok, true);
    assert.equal(rest.result.invoice.status, "paid");
    assert.equal(rest.result.balanceDue, 0);
  });

  it("rejects sending a non-draft invoice", () => {
    const inv = freshInvoice();
    call("invoice-send", ctxA, { id: inv.id });
    const again = call("invoice-send", ctxA, { id: inv.id });
    assert.equal(again.ok, false);
    assert.match(again.error, /only a draft invoice/);
  });

  it("rejects accepting an invoice that hasn't been sent (cannot skip draft -> accepted)", () => {
    const inv = freshInvoice();
    const r = call("invoice-accept", ctxA, { id: inv.id });
    assert.equal(r.ok, false);
    assert.match(r.error, /only a sent invoice/);
  });

  it("rejects recording payment before acceptance (draft and sent both blocked)", () => {
    const draftInv = freshInvoice();
    const draftPay = call("invoice-record-payment", ctxA, { id: draftInv.id, amount: 100 });
    assert.equal(draftPay.ok, false);
    assert.match(draftPay.error, /before the invoice is accepted/);

    const sentInv = freshInvoice();
    call("invoice-send", ctxA, { id: sentInv.id });
    const sentPay = call("invoice-record-payment", ctxA, { id: sentInv.id, amount: 100 });
    assert.equal(sentPay.ok, false);
    assert.match(sentPay.error, /before the invoice is accepted/);
  });

  it("rejects a zero/negative/missing payment amount", () => {
    const inv = freshInvoice();
    call("invoice-send", ctxA, { id: inv.id });
    call("invoice-accept", ctxA, { id: inv.id });
    assert.equal(call("invoice-record-payment", ctxA, { id: inv.id }).ok, false);
    assert.equal(call("invoice-record-payment", ctxA, { id: inv.id, amount: 0 }).ok, false);
    assert.equal(call("invoice-record-payment", ctxA, { id: inv.id, amount: -50 }).ok, false);
  });

  it("rejects unknown invoice ids on every transition macro", () => {
    assert.equal(call("invoice-send", ctxA, { id: "nope" }).ok, false);
    assert.equal(call("invoice-accept", ctxA, { id: "nope" }).ok, false);
    assert.equal(call("invoice-record-payment", ctxA, { id: "nope", amount: 10 }).ok, false);
  });

  it("scopes invoices per-user — a transition macro can't reach another user's invoice", () => {
    const inv = freshInvoice(ctxA);
    const r = call("invoice-send", ctxB, { id: inv.id });
    assert.equal(r.ok, false, "user B must not be able to transition user A's invoice");
  });
});

// ─── Feature 11 — persisted Client (CRM) entity ─────────────────────
describe("landscaping — persisted Client (CRM) entity", () => {
  it("client-add → client-list: an added client is listed with its contact fields", () => {
    const added = call("client-add", ctxA, {
      name: "Union Station HOA", phone: "555-0100", email: "hoa@example.com", address: "1 Union Sq",
    });
    assert.equal(added.ok, true);
    assert.equal(added.result.client.name, "Union Station HOA");
    assert.equal(added.result.client.phone, "555-0100");
    assert.equal(added.result.client.email, "hoa@example.com");
    assert.equal(added.result.client.address, "1 Union Sq");
    const id = added.result.client.id;
    const list = call("client-list", ctxA, {});
    assert.equal(list.ok, true);
    assert.ok(list.result.clients.some((c) => c.id === id), "client appears in the list");
  });

  it("client-add: rejects a blank name", () => {
    const r = call("client-add", ctxA, { phone: "555-0000" });
    assert.equal(r.ok, false);
    assert.match(r.error, /name required/);
  });

  it("client-list: query filters by substring, case-insensitive", () => {
    call("client-add", ctxA, { name: "Acme Bakery" });
    call("client-add", ctxA, { name: "Beta Diner" });
    const found = call("client-list", ctxA, { query: "acme" });
    assert.equal(found.result.count, 1);
    assert.equal(found.result.clients[0].name, "Acme Bakery");
  });

  it("client-add is user-scoped: a fresh user doesn't see another's clients", () => {
    call("client-add", ctxA, { name: "Private Client" });
    const list = call("client-list", ctxB, {});
    assert.ok(!list.result.clients.some((c) => c.name === "Private Client"), "other user's roster is isolated");
  });

  it("proposal-build + clientId: resolves the client's name onto the proposal", () => {
    const client = call("client-add", ctxA, { name: "Jane Doe" });
    const cid = client.result.client.id;
    const r = call("proposal-build", ctxA, {
      clientId: cid,
      lineItems: [{ description: "Labor", quantity: 1, unitCost: 100 }],
    });
    assert.equal(r.ok, true);
    assert.equal(r.result.client, "Jane Doe");
    assert.equal(r.result.clientId, cid);
    assert.match(r.result.proposalMarkdown, /Jane Doe/);
  });

  it("proposal-build: bad clientId is rejected (fails honest, doesn't silently fall through)", () => {
    const r = call("proposal-build", ctxA, { clientId: "client_ghost", lineItems: [{ description: "x", quantity: 1, unitCost: 10 }] });
    assert.equal(r.ok, false);
    assert.match(r.error, /client_not_found/);
  });

  it("proposal-build: REGRESSION — omitting clientId preserves the exact original free-text behavior", () => {
    const r = call("proposal-build", ctxA, {
      client: "Walk-in Customer",
      lineItems: [{ description: "Labor", quantity: 1, unitCost: 100 }],
    });
    assert.equal(r.ok, true);
    assert.equal(r.result.client, "Walk-in Customer");
    assert.equal(r.result.clientId, null);
  });

  it("proposal-build: works with STATE entirely gone when clientId is omitted (still pure-compute)", () => {
    const savedState = globalThis._concordSTATE;
    globalThis._concordSTATE = undefined;
    try {
      const r = call("proposal-build", ctxA, {
        client: "No State Needed",
        lineItems: [{ description: "Labor", quantity: 1, unitCost: 100 }],
      });
      assert.equal(r.ok, true);
      assert.equal(r.result.client, "No State Needed");
      assert.equal(r.result.clientId, null);
    } finally {
      globalThis._concordSTATE = savedState;
    }
  });

  it("proposal-build: fails soft (not throws) when STATE is gone AND clientId is supplied", () => {
    const savedState = globalThis._concordSTATE;
    globalThis._concordSTATE = undefined;
    try {
      let r;
      assert.doesNotThrow(() => {
        r = call("proposal-build", ctxA, { clientId: "client_x", lineItems: [{ description: "x", quantity: 1, unitCost: 10 }] });
      });
      assert.equal(r.ok, false);
      assert.equal(typeof r.error, "string");
    } finally {
      globalThis._concordSTATE = savedState;
    }
  });

  it("invoice-from-proposal + clientId: resolves the client's name onto the invoice", () => {
    const client = call("client-add", ctxA, { name: "Downtown Cafe" });
    const cid = client.result.client.id;
    const inv = call("invoice-from-proposal", ctxA, {
      clientId: cid, lineItems: [{ description: "Repipe", quantity: 1, unitCost: 500 }],
    });
    assert.equal(inv.ok, true);
    assert.equal(inv.result.invoice.client, "Downtown Cafe");
    assert.equal(inv.result.invoice.clientId, cid);
  });

  it("invoice-from-proposal: bad clientId is rejected", () => {
    const r = call("invoice-from-proposal", ctxA, { clientId: "client_ghost", lineItems: [{ description: "x", quantity: 1, unitCost: 10 }] });
    assert.equal(r.ok, false);
    assert.match(r.error, /client_not_found/);
  });

  it("invoice-from-proposal: REGRESSION — omitting clientId preserves the exact original free-text behavior", () => {
    const inv = call("invoice-from-proposal", ctxA, {
      client: "Cash Sale", lineItems: [{ description: "Service call", quantity: 1, unitCost: 90 }],
    });
    assert.equal(inv.ok, true);
    assert.equal(inv.result.invoice.client, "Cash Sale");
    assert.equal(inv.result.invoice.clientId, null);
  });

  it("job-schedule + clientId: resolves the client's name/address onto the job", () => {
    const client = call("client-add", ctxA, {
      name: "Riverside Apartments", phone: "555-0200", address: "200 River Rd",
    });
    const cid = client.result.client.id;
    const r = call("job-schedule", ctxA, { title: "Water feature repair", clientId: cid });
    assert.equal(r.ok, true);
    assert.equal(r.result.job.client, "Riverside Apartments");
    assert.equal(r.result.job.clientId, cid);
    assert.equal(r.result.job.address, "200 River Rd"); // derived from the client record
  });

  it("job-schedule: bad clientId is rejected (fails honest, doesn't silently fall through)", () => {
    const r = call("job-schedule", ctxA, { title: "Leak", clientId: "client_ghost" });
    assert.equal(r.ok, false);
    assert.match(r.error, /client_not_found/);
  });

  it("job-schedule: REGRESSION — omitting clientId preserves the exact original free-text behavior", () => {
    const r = call("job-schedule", ctxA, {
      title: "Faucet swap", client: "Walk-in Customer", address: "42 Elm St",
    });
    assert.equal(r.ok, true);
    assert.equal(r.result.job.client, "Walk-in Customer");
    assert.equal(r.result.job.address, "42 Elm St");
    assert.equal(r.result.job.clientId, null);
  });

  it("client-list: aggregates real jobsCount/invoiceCount/totalBilled across documents for the same client", () => {
    const client = call("client-add", ctxA, { name: "Aggregate Test Client" });
    const cid = client.result.client.id;
    call("job-schedule", ctxA, { title: "Job A", clientId: cid });
    call("job-schedule", ctxA, { title: "Job B", clientId: cid });
    // subtotal 100 + default overhead 15% (15) + default margin 20% of 115 (23) = 138 total
    const inv = call("invoice-from-proposal", ctxA, { clientId: cid, lineItems: [{ description: "x", quantity: 1, unitCost: 100 }] });
    assert.equal(inv.result.invoice.total, 138);
    const list = call("client-list", ctxA, {});
    const found = list.result.clients.find((c) => c.id === cid);
    assert.equal(found.jobsCount, 2);
    assert.equal(found.invoiceCount, 1);
    assert.equal(found.totalBilled, 138);
  });
});

// ─── Feature 12 — Job inspections ────────────────────────────────────
describe("landscaping — job inspections", () => {
  it("inspection-add requires a real jobId, a valid inspectionType, an inspector, and a scheduledDate", () => {
    const job = call("job-schedule", ctxA, { title: "Backyard reno" }).result.job;
    assert.match(call("inspection-add", ctxA, {}).error, /jobId required/);
    assert.match(
      call("inspection-add", ctxA, { jobId: job.id, inspectionType: "bogus", inspector: "Sam", scheduledDate: "2026-06-10" }).error,
      /invalid inspectionType/,
    );
    assert.match(
      call("inspection-add", ctxA, { jobId: job.id, inspectionType: "final_walkthrough", scheduledDate: "2026-06-10" }).error,
      /inspector required/,
    );
    assert.match(
      call("inspection-add", ctxA, { jobId: job.id, inspectionType: "final_walkthrough", inspector: "Sam" }).error,
      /scheduledDate required/,
    );
    const r = call("inspection-add", ctxA, {
      jobId: job.id, inspectionType: "final_walkthrough", inspector: "Sam", scheduledDate: "2026-06-10", notes: "Client onsite",
    });
    assert.equal(r.ok, true);
    assert.equal(r.result.inspection.number, "INSP-001");
    assert.equal(r.result.inspection.jobId, job.id);
    assert.equal(r.result.inspection.jobTitle, "Backyard reno");
    assert.equal(r.result.inspection.jobFound, true);
    assert.equal(r.result.inspection.result, "pending");
    assert.equal(r.result.inspection.notes, "Client onsite");
  });

  it("inspection-add: jobId referencing an unknown job still creates the record, but jobFound is honestly false", () => {
    const r = call("inspection-add", ctxA, {
      jobId: "job_ghost", inspectionType: "irrigation_system_check", inspector: "Pat", scheduledDate: "2026-06-11",
    });
    assert.equal(r.ok, true);
    assert.equal(r.result.inspection.jobFound, false);
    assert.equal(r.result.inspection.jobTitle, null);
  });

  it("inspection-list re-derives jobTitle/jobFound live — a since-renamed or since-deleted job is reflected honestly", () => {
    const job = call("job-schedule", ctxA, { title: "Original title" }).result.job;
    call("inspection-add", ctxA, {
      jobId: job.id, inspectionType: "final_walkthrough", inspector: "Sam", scheduledDate: "2026-06-10",
    });
    // Simulate the job being renamed after the inspection was scheduled —
    // job-schedule has no rename macro, so poke the in-memory record.
    globalThis._concordSTATE.landscapingLens.jobs.get("user_a").find((j) => j.id === job.id).title = "Renamed job";
    let list = call("inspection-list", ctxA, {});
    assert.equal(list.result.inspections[0].jobTitle, "Renamed job");
    assert.equal(list.result.inspections[0].jobFound, true);

    // Now delete the job entirely.
    globalThis._concordSTATE.landscapingLens.jobs.set("user_a", []);
    list = call("inspection-list", ctxA, {});
    assert.equal(list.result.inspections[0].jobFound, false);
    assert.equal(list.result.inspections[0].jobTitle, null);
  });

  it("inspection-list filters by jobId and reports pass/fail/pending counts", () => {
    const jobA = call("job-schedule", ctxA, { title: "Job A" }).result.job;
    const jobB = call("job-schedule", ctxA, { title: "Job B" }).result.job;
    call("inspection-add", ctxA, { jobId: jobA.id, inspectionType: "final_walkthrough", inspector: "Sam", scheduledDate: "2026-06-10" });
    call("inspection-add", ctxA, { jobId: jobB.id, inspectionType: "hardscape_drainage", inspector: "Sam", scheduledDate: "2026-06-11" });
    const onlyA = call("inspection-list", ctxA, { jobId: jobA.id });
    assert.equal(onlyA.result.count, 1);
    assert.equal(onlyA.result.inspections[0].jobId, jobA.id);
    const all = call("inspection-list", ctxA, {});
    assert.equal(all.result.pendingCount, 2);
    assert.equal(all.result.passCount, 0);
    assert.equal(all.result.failCount, 0);
  });

  it("inspection-update: pass clears any prior deficiency notes and stamps completedAt", () => {
    const job = call("job-schedule", ctxA, { title: "Job" }).result.job;
    const insp = call("inspection-add", ctxA, {
      jobId: job.id, inspectionType: "plant_health_establishment", inspector: "Sam", scheduledDate: "2026-06-10",
    }).result.inspection;
    const r = call("inspection-update", ctxA, { id: insp.id, result: "pass" });
    assert.equal(r.ok, true);
    assert.equal(r.result.inspection.result, "pass");
    assert.equal(r.result.inspection.deficiencyNotes, null);
    assert.equal(r.result.inspection.reInspectionDate, null);
    assert.ok(r.result.inspection.completedAt);
  });

  it("inspection-update: fail requires deficiencyNotes and accepts an optional reInspectionDate", () => {
    const job = call("job-schedule", ctxA, { title: "Job" }).result.job;
    const insp = call("inspection-add", ctxA, {
      jobId: job.id, inspectionType: "erosion_sediment_control", inspector: "Sam", scheduledDate: "2026-06-10",
    }).result.inspection;
    const rejected = call("inspection-update", ctxA, { id: insp.id, result: "fail" });
    assert.equal(rejected.ok, false);
    assert.match(rejected.error, /deficiencyNotes required/);
    const r = call("inspection-update", ctxA, {
      id: insp.id, result: "fail", deficiencyNotes: "Silt fence undersized", reInspectionDate: "2026-06-20",
    });
    assert.equal(r.ok, true);
    assert.equal(r.result.inspection.result, "fail");
    assert.equal(r.result.inspection.deficiencyNotes, "Silt fence undersized");
    assert.equal(r.result.inspection.reInspectionDate, "2026-06-20");
    assert.ok(r.result.inspection.completedAt);
  });

  it("inspection-update: rejects an invalid result and an unknown inspection id", () => {
    const job = call("job-schedule", ctxA, { title: "Job" }).result.job;
    const insp = call("inspection-add", ctxA, {
      jobId: job.id, inspectionType: "final_walkthrough", inspector: "Sam", scheduledDate: "2026-06-10",
    }).result.inspection;
    assert.equal(call("inspection-update", ctxA, { id: insp.id, result: "bogus" }).ok, false);
    assert.equal(call("inspection-update", ctxA, { id: "nope", result: "pass" }).ok, false);
  });

  it("inspection-update: pending re-transition preserves prior notes unless explicitly overwritten", () => {
    const job = call("job-schedule", ctxA, { title: "Job" }).result.job;
    const insp = call("inspection-add", ctxA, {
      jobId: job.id, inspectionType: "final_walkthrough", inspector: "Sam", scheduledDate: "2026-06-10",
    }).result.inspection;
    call("inspection-update", ctxA, { id: insp.id, result: "fail", deficiencyNotes: "Grading issue", reInspectionDate: "2026-06-20" });
    const back = call("inspection-update", ctxA, { id: insp.id, result: "pending" });
    assert.equal(back.ok, true);
    assert.equal(back.result.inspection.result, "pending");
    assert.equal(back.result.inspection.deficiencyNotes, "Grading issue");
    assert.equal(back.result.inspection.completedAt, null);
  });

  it("inspections are scoped per-user", () => {
    const job = call("job-schedule", ctxA, { title: "Job" }).result.job;
    call("inspection-add", ctxA, { jobId: job.id, inspectionType: "final_walkthrough", inspector: "Sam", scheduledDate: "2026-06-10" });
    const listB = call("inspection-list", ctxB, {});
    assert.equal(listB.ok, true);
    assert.equal(listB.result.count, 0);
  });

  it("inspection-add / inspection-list / inspection-update degrade-graceful when STATE is gone", () => {
    const savedState = globalThis._concordSTATE;
    globalThis._concordSTATE = undefined;
    try {
      for (const [name, input] of [
        ["inspection-add", { jobId: "j", inspectionType: "final_walkthrough", inspector: "Sam", scheduledDate: "2026-06-10" }],
        ["inspection-list", {}],
        ["inspection-update", { id: "i", result: "pass" }],
      ]) {
        let r;
        assert.doesNotThrow(() => { r = call(name, ctxA, input); }, `${name} must not throw`);
        assert.equal(r.ok, false, `${name} should fail-soft`);
        assert.equal(typeof r.error, "string");
      }
    } finally {
      globalThis._concordSTATE = savedState;
    }
  });
});

// ─── Feature 13 — Crew certifications ────────────────────────────────
describe("landscaping — crew certifications", () => {
  it("cert-add requires crewMemberName, certType, and issuingBody", () => {
    assert.match(call("cert-add", ctxA, {}).error, /crewMemberName required/);
    assert.match(call("cert-add", ctxA, { crewMemberName: "Alex Rivera" }).error, /certType required/);
    assert.match(call("cert-add", ctxA, { crewMemberName: "Alex Rivera", certType: "ISA Certified Arborist" }).error, /issuingBody required/);
    const r = call("cert-add", ctxA, {
      crewMemberName: "Alex Rivera", certType: "ISA Certified Arborist", issuingBody: "International Society of Arboriculture",
      licenseNumber: "ISA-12345", issueDate: "2024-01-01", expiryDate: "2027-01-01",
    });
    assert.equal(r.ok, true);
    assert.equal(r.result.certification.crewMemberName, "Alex Rivera");
    assert.equal(r.result.certification.certType, "ISA Certified Arborist");
    assert.equal(r.result.certification.expiryStatus, "valid");
    assert.equal(r.result.certification.isExpired, false);
  });

  it("cert-list derives a de-duplicated crew roster and expiry counts, and filters by crewMemberName", () => {
    call("cert-add", ctxA, { crewMemberName: "Alex Rivera", certType: "OSHA 10-Hour Construction Safety", issuingBody: "OSHA" });
    call("cert-add", ctxA, { crewMemberName: "Alex Rivera", certType: "ISA Certified Arborist", issuingBody: "ISA" });
    call("cert-add", ctxA, { crewMemberName: "Jordan Lee", certType: "State Pesticide Applicator License", issuingBody: "State Dept. of Agriculture" });
    const all = call("cert-list", ctxA, {});
    assert.equal(all.ok, true);
    assert.equal(all.result.count, 3);
    assert.deepEqual(all.result.roster, ["Alex Rivera", "Jordan Lee"]);
    const filtered = call("cert-list", ctxA, { crewMemberName: "alex rivera" }); // case-insensitive
    assert.equal(filtered.result.count, 2);
    assert.ok(filtered.result.certifications.every((c) => c.crewMemberName === "Alex Rivera"));
  });

  it("cert expiry status is boundary-correct: expired < today <= 30 days = expiring_soon, > 30 days = valid, no date = no_expiry", () => {
    const today = new Date();
    const iso = (d) => d.toISOString().slice(0, 10);
    const yesterday = iso(new Date(today.getTime() - 86400000));
    const in10Days = iso(new Date(today.getTime() + 10 * 86400000));
    const in29Days = iso(new Date(today.getTime() + 29 * 86400000));
    const in31Days = iso(new Date(today.getTime() + 31 * 86400000));

    const expired = call("cert-add", ctxA, { crewMemberName: "Boundary", certType: "First Aid / CPR", issuingBody: "Red Cross", expiryDate: yesterday }).result.certification;
    assert.equal(expired.expiryStatus, "expired");
    assert.equal(expired.isExpired, true);

    const soon10 = call("cert-add", ctxA, { crewMemberName: "Boundary", certType: "First Aid / CPR", issuingBody: "Red Cross", expiryDate: in10Days }).result.certification;
    assert.equal(soon10.expiryStatus, "expiring_soon");

    const soon29 = call("cert-add", ctxA, { crewMemberName: "Boundary", certType: "First Aid / CPR", issuingBody: "Red Cross", expiryDate: in29Days }).result.certification;
    assert.equal(soon29.expiryStatus, "expiring_soon");

    const valid31 = call("cert-add", ctxA, { crewMemberName: "Boundary", certType: "First Aid / CPR", issuingBody: "Red Cross", expiryDate: in31Days }).result.certification;
    assert.equal(valid31.expiryStatus, "valid");
    assert.equal(valid31.isExpired, false);

    const noExpiry = call("cert-add", ctxA, { crewMemberName: "Boundary", certType: "First Aid / CPR", issuingBody: "Red Cross" }).result.certification;
    assert.equal(noExpiry.expiryStatus, "no_expiry");
    assert.equal(noExpiry.isExpired, false);

    const list = call("cert-list", ctxA, { crewMemberName: "Boundary" });
    assert.equal(list.result.expiredCount, 1);
    assert.equal(list.result.expiringSoonCount, 2);
  });

  it("cert-list expiry status is derived at read time, not persisted (a cert added as valid reports expired once its date passes)", () => {
    const cert = call("cert-add", ctxA, { crewMemberName: "Drift", certType: "Backflow Prevention Assembly Tester Certification", issuingBody: "State", expiryDate: "2020-01-01" }).result.certification;
    // stored record itself carries no expiryStatus field pre-read-derivation
    const raw = globalThis._concordSTATE.landscapingLens.certifications.get("user_a").find((c) => c.id === cert.id);
    assert.equal(raw.expiryStatus, undefined);
    const listed = call("cert-list", ctxA, {}).result.certifications.find((c) => c.id === cert.id);
    assert.equal(listed.expiryStatus, "expired");
  });

  it("cert-remove deletes a certification and rejects an unknown id", () => {
    const cert = call("cert-add", ctxA, { crewMemberName: "Sam", certType: "OSHA 10-Hour Construction Safety", issuingBody: "OSHA" }).result.certification;
    const bad = call("cert-remove", ctxA, { id: "nope" });
    assert.equal(bad.ok, false);
    const r = call("cert-remove", ctxA, { id: cert.id });
    assert.equal(r.ok, true);
    assert.equal(call("cert-list", ctxA, {}).result.count, 0);
  });

  it("certifications are scoped per-user", () => {
    call("cert-add", ctxA, { crewMemberName: "Alex Rivera", certType: "OSHA 10-Hour Construction Safety", issuingBody: "OSHA" });
    const listB = call("cert-list", ctxB, {});
    assert.equal(listB.ok, true);
    assert.equal(listB.result.count, 0);
  });

  it("cert-add / cert-list / cert-remove degrade-graceful when STATE is gone", () => {
    const savedState = globalThis._concordSTATE;
    globalThis._concordSTATE = undefined;
    try {
      for (const [name, input] of [
        ["cert-add", { crewMemberName: "x", certType: "x", issuingBody: "x" }],
        ["cert-list", {}],
        ["cert-remove", { id: "x" }],
      ]) {
        let r;
        assert.doesNotThrow(() => { r = call(name, ctxA, input); }, `${name} must not throw`);
        assert.equal(r.ok, false, `${name} should fail-soft`);
        assert.equal(typeof r.error, "string");
      }
    } finally {
      globalThis._concordSTATE = savedState;
    }
  });
});
