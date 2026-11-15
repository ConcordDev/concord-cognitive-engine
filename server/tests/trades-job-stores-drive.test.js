// FIX-trades-002 — INVESTIGATED drive (not a fix). The ticket: a job
// created in the Trades Workbench never appears in the Project Desk's
// Jobs tab or its search, and a status set in the Workbench is not
// reflected there. This drive reproduces the split at the handler
// layer:
//   - the Workbench/Field/Dispatch surfaces use the domain actions
//     (job-create / job-list / job-update-status) over the domain
//     state store — internally coherent, proven below;
//   - the Project Desk's Jobs tab reads the GENERIC lens artifact
//     store (useLensData('trades','Job') -> GET /api/lens/trades?type=Job,
//     served from the DTU store). The trades domain writes NOTHING to
//     that store: after the full job flow, the DTU map is still empty.
// Two job models, no bridge in code. Convergence (one canonical store,
// the other a view) is a build slice for the desk, not a sweep fix —
// a one-way mirror would leave Desk-side creates/edits/deletes
// forking the other way.
import { describe, it, before, beforeEach } from "node:test";
import assert from "node:assert/strict";
import registerActions from "../domains/trades.js";

const ACTIONS = new Map();
function register(domain, name, fn) { ACTIONS.set(`${domain}.${name}`, fn); }
function call(name, ctx, params = {}) {
  const fn = ACTIONS.get(`trades.${name}`);
  if (!fn) throw new Error(`trades.${name} not registered`);
  return fn(ctx, { id: null, data: {}, meta: {} }, params);
}

before(() => { registerActions(register); });
beforeEach(() => {
  globalThis._concordSTATE = { dtus: new Map() };
  globalThis._concordSaveStateDebounced = () => {};
  globalThis.fetch = async () => { throw new Error("network disabled"); };
});

const ctxA = { actor: { userId: "u" }, userId: "u" };

describe("FIX-trades-002 drive — one job, two stores", () => {
  it("the domain job flow is coherent in its own store", () => {
    const cust = call("customer-upsert", ctxA, { name: "QA Customer" }).result.customer;
    const job = call("job-create", ctxA, { customerId: cust.id, description: "Fix AC" }).result.job;
    assert.equal(job.number, "JOB-00001");
    const upd = call("job-update-status", ctxA, { id: job.id, status: "on-site" });
    assert.equal(upd.ok, true);
    const list = call("job-list", ctxA, {});
    assert.equal(list.result.jobs.length, 1);
    assert.equal(list.result.jobs[0].status, "on-site");
  });

  it("the same flow writes nothing to the DTU/artifact store the Project Desk reads", () => {
    const cust = call("customer-upsert", ctxA, { name: "QA Customer" }).result.customer;
    call("job-create", ctxA, { customerId: cust.id, description: "Fix AC" });
    // The generic lens list (Project Desk Jobs) serves artifact DTUs.
    assert.equal(globalThis._concordSTATE.dtus.size, 0);
  });
});
