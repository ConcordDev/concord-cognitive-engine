// Behaviour suites for the welding full-lens build (GB-1088 wave 1).
// S1 — every object type has a delete; a deleted document's portal link dies.
// S2 — the inspection counts the inspector's own findings.
// S3 — job-list returns full job records (the job's own surface).
// S5 — the WPS approval stamp names the account that clicked.
// S6 — PQR records: create/list/delete on the same substrate.
// Hermetic: a local register harness + a fresh in-memory STATE per test.
import { describe, it, beforeEach } from "node:test";
import assert from "node:assert/strict";
import registerWeldingActions from "../domains/welding.js";

const ACTIONS = new Map();
registerWeldingActions((domain, name, fn) => {
  assert.equal(domain, "welding");
  ACTIONS.set(name, fn);
});
function call(name, ctx, params = {}) {
  const fn = ACTIONS.get(name);
  if (!fn) throw new Error(`welding.${name} not registered`);
  return fn(ctx, { data: params }, params);
}
const CTX = { actor: { userId: "u-weld-1", name: "Sam Welder" } };

beforeEach(() => { globalThis._concordSTATE = {}; });

describe("welding build slices", () => {
  it("S2 — user findings are appended and counted; base matches don't duplicate", () => {
    const r = call("inspectionChecklist", CTX, {
      weldType: "fillet", code: "AWS D1.1",
      inspections: [
        { item: "Root pass fusion check", passed: true },
        { item: "Bead profile on cap", passed: false },
      ],
    });
    assert.equal(r.ok, true);
    // 11 built-in items for fillet + AWS D1.1 (the walked count) + 2 user rows.
    assert.equal(r.result.totalItems, 13);
    assert.equal(r.result.passed, 1);
    assert.equal(r.result.failed, 1);
    assert.equal(r.result.pending, 11);
    assert.equal(r.result.verdict, "FAIL — rework required");
    const userRows = r.result.checklist.filter((c) => c.category === "user");
    assert.equal(userRows.length, 2);
    assert.equal(userRows.find((c) => c.item === "Root pass fusion check").status, "pass");

    const r2 = call("inspectionChecklist", CTX, {
      weldType: "fillet", code: "AWS D1.1",
      inspections: [{ item: "Visual inspection — porosity", passed: true }],
    });
    assert.equal(r2.result.totalItems, 11);
    assert.equal(r2.result.passed, 1);
    assert.equal(r2.result.checklist.filter((c) => c.category === "user").length, 0);
  });

  it("S3 — job-list returns the full record; job-delete removes it (S1)", () => {
    const made = call("job-schedule", CTX, { title: "Gate repair", client: "Acme", scheduledDate: "2026-11-10", crew: ["Sam"], notes: "bring rods" });
    assert.equal(made.ok, true);
    const list = call("job-list", CTX);
    assert.equal(list.result.jobs.length, 1);
    const job = list.result.jobs[0];
    assert.equal(job.notes, "bring rods");
    assert.deepEqual(job.crew, ["Sam"]);
    assert.equal(job.status, "scheduled");
    const del = call("job-delete", CTX, { jobId: job.id });
    assert.equal(del.ok, true);
    assert.equal(call("job-list", CTX).result.jobs.length, 0);
    assert.equal(call("job-delete", CTX, { jobId: job.id }).error, "job_not_found");
  });

  it("S1 — estimate delete kills its portal link; invoice/wps/cert deletes clear their lists", () => {
    const est = call("estimate-create", CTX, { title: "Rack", client: "Acme", lineItems: [{ description: "Labor", quantity: 1, unitPrice: 100 }], taxRate: 0 }).result.estimate;
    const sent = call("estimate-send", CTX, { estimateId: est.id });
    const token = sent.result.portalToken;
    assert.equal(call("portal-view", CTX, { token }).ok, true);
    assert.equal(call("estimate-delete", CTX, { estimateId: est.id }).ok, true);
    assert.equal(call("portal-view", CTX, { token }).error, "invalid_token");
    assert.equal(call("estimate-list", CTX).result.estimates.length, 0);

    const job = call("job-schedule", CTX, { title: "J2" }).result.job;
    const inv = call("invoice-from-job", CTX, { jobId: job.id, amount: 50 }).result.invoice;
    assert.equal(call("invoice-delete", CTX, { invoiceId: inv.id }).ok, true);
    assert.equal(call("invoice-list", CTX).result.invoices.length, 0);
    assert.equal(call("portal-view", CTX, { token: inv.portalToken }).error, "invalid_token");

    const wps = call("wps-create", CTX, { fillerMetal: "E7018", amperageRange: "90-140", thicknessRange: "3-12" }).result.wps;
    assert.equal(call("wps-delete", CTX, { wpsId: wps.id }).ok, true);
    assert.equal(call("wps-list", CTX).result.wps.length, 0);

    const cert = call("cert-add", CTX, { welder: "Sam", certType: "AWS D1.1 Structural" }).result.cert;
    assert.equal(call("cert-delete", CTX, { certId: cert.id }).ok, true);
    assert.equal(call("cert-status", CTX).result.certs.length, 0);
  });

  it("S5 — approval stamps the clicking account, never the inspector title; an explicit name stands", () => {
    const wps = call("wps-create", CTX, { fillerMetal: "E7018", amperageRange: "90-140", thicknessRange: "3-12" }).result.wps;
    const approved = call("wps-approve", CTX, { wpsId: wps.id });
    assert.equal(approved.ok, true);
    assert.equal(approved.result.wps.approvedBy, "Sam Welder");

    const wps2 = call("wps-create", CTX, { fillerMetal: "E7018", amperageRange: "90-140", thicknessRange: "3-12" }).result.wps;
    const approved2 = call("wps-approve", CTX, { wpsId: wps2.id, approvedBy: "Pat Inspector, CWI" });
    assert.equal(approved2.result.wps.approvedBy, "Pat Inspector, CWI");
  });

  it("S6 — PQR create/list/delete with honest outcome coercion", () => {
    const pqr = call("pqr-create", CTX, { wpsNumber: "WPS-001", welder: "Sam", tensileResult: "pass", bendResult: "bogus" }).result.pqr;
    assert.equal(pqr.pqrNumber, "PQR-001");
    assert.equal(pqr.tensileResult, "pass");
    assert.equal(pqr.bendResult, "not_recorded");
    assert.equal(call("pqr-list", CTX).result.pqr.length, 1);
    assert.equal(call("pqr-delete", CTX, { pqrId: pqr.id }).ok, true);
    assert.equal(call("pqr-list", CTX).result.pqr.length, 0);
    assert.equal(call("pqr-delete", CTX, { pqrId: pqr.id }).error, "pqr_not_found");
  });
});
