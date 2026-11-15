import { describe, it, before, beforeEach } from "node:test";
import assert from "node:assert/strict";
import registerLand from "../domains/landscaping.js";
import registerGov from "../domains/government.js";

const actions = new Map();
function register(domain, name, fn) { actions.set(`${domain}.${name}`, fn); }
function call(domain, name, params = {}) {
  const fn = actions.get(`${domain}.${name}`);
  assert.ok(fn, `${domain}.${name}`);
  return fn({ actor: { userId: "owner" }, userId: "owner" }, { id: null, data: {}, meta: {} }, params);
}

before(() => {
  registerLand(register);
  registerGov(register);
});
beforeEach(() => {
  globalThis._concordSTATE = {};
  globalThis._concordSaveStateDebounced = () => {};
});

describe("delete and edit controls", () => {
  it("edits a scheduled landscaping job", () => {
    const job = call("landscaping", "job-schedule", { title: "Mow", crew: "A" }).result.job;
    const edited = call("landscaping", "job-update", { id: job.id, title: "Edge", crew: "B" });
    assert.equal(edited.ok, true);
    assert.equal(edited.result.job.title, "Edge");
    assert.equal(edited.result.job.crew, "B");
  });

  it("removes an inspection, a fine, a service request, and a denied permit", () => {
    const permit = call("government", "permits-apply", {
      applicantName: "Ada", applicantEmail: "ada@example.com", kind: "fence", description: "side yard", feeUsd: 0,
    }).result.permit;
    call("government", "permits-deny", { id: permit.id, reason: "setback" });
    const cancelled = call("government", "permits-cancel", { id: permit.id });
    assert.equal(cancelled.result.permit.status, "cancelled");

    const inspection = call("government", "inspections-schedule", {
      permitId: permit.id, kind: "framing", date: "2026-11-10",
    }).result.inspection;
    assert.equal(call("government", "inspections-delete", { id: inspection.id }).result.deleted, inspection.id);

    const fine = call("government", "fines-create", { payerName: "Ada", reason: "late", amountUsd: 10 }).result.fine;
    assert.equal(call("government", "fines-delete", { id: fine.id }).result.deleted, fine.id);

    const request = call("government", "service-requests-create", { category: "pothole", description: "pothole", lat: 1, lng: 2 }).result.request;
    assert.equal(call("government", "service-requests-delete", { id: request.id }).result.deleted, request.id);
  });
});
