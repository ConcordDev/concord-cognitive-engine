// Contract tests for server/domains/lab.js — the ELN/LIMS substrate
// macros (notebook, inventory, protocols, plates, instrument runs,
// construct registry, QC trend) plus the pure-compute analysis macros.

import { describe, it, before, beforeEach } from "node:test";
import assert from "node:assert/strict";
import registerLabActions from "../domains/lab.js";

const ACTIONS = new Map();
function register(domain, name, fn) { ACTIONS.set(`${domain}.${name}`, fn); }
function call(name, ctx, artifactOrParams = {}, maybeParams) {
  const fn = ACTIONS.get(`lab.${name}`);
  if (!fn) throw new Error(`lab.${name} not registered`);
  const artifact = arguments.length === 4 ? artifactOrParams : { id: null, data: {}, meta: {} };
  const params = arguments.length === 4 ? (maybeParams || {}) : artifactOrParams;
  return fn(ctx, artifact, params);
}

before(() => { registerLabActions(register); });

beforeEach(() => {
  // fresh STATE per test so per-user Maps don't leak between cases
  globalThis._concordSTATE = {};
});

const ctxA = { actor: { userId: "user_a" }, userId: "user_a" };
const ctxB = { actor: { userId: "user_b" }, userId: "user_b" };

describe("lab — pure-compute analysis macros", () => {
  it("calibrationCurve fits a linear model", () => {
    const r = call("calibrationCurve", ctxA, {
      data: { standards: [{ concentration: 0, response: 1 }, { concentration: 10, response: 21 }, { concentration: 20, response: 41 }] },
    }, { model: "linear" });
    assert.equal(r.ok, true);
    assert.ok(r.result.rSquared > 0.99);
  });

  it("qcAnalysis flags an in-control run", () => {
    const r = call("qcAnalysis", ctxA, {
      data: { controls: [{ value: 100 }, { value: 101 }, { value: 99 }, { value: 100 }] },
    }, {});
    assert.equal(r.ok, true);
    assert.equal(r.result.inControl, true);
  });

  it("experimentDesign produces a full-factorial run table", () => {
    const r = call("experimentDesign", ctxA, {
      data: { factors: [{ name: "temp", levels: ["lo", "hi"] }, { name: "ph", levels: ["5", "7"] }] },
    }, { type: "full-factorial" });
    assert.equal(r.ok, true);
    assert.equal(r.result.totalRuns, 4);
  });
});

describe("lab — electronic lab notebook", () => {
  it("create / list / update / sign round-trip", () => {
    const c = call("notebook-create", ctxA, {}, { title: "PCR optimisation", body: "ran gradient" });
    assert.equal(c.ok, true);
    const id = c.result.entry.id;

    const list = call("notebook-list", ctxA, {}, {});
    assert.equal(list.ok, true);
    assert.equal(list.result.total, 1);
    assert.equal(list.result.draft, 1);

    const upd = call("notebook-update", ctxA, {}, { id, body: "revised notes" });
    assert.equal(upd.ok, true);
    assert.equal(upd.result.entry.body, "revised notes");
    assert.equal(upd.result.entry.revisions.length, 1);

    const wit = call("notebook-sign", ctxA, {}, { id, role: "witness", name: "Dr Lee" });
    assert.equal(wit.ok, true);
    assert.equal(wit.result.entry.status, "witnessed");

    const sig = call("notebook-sign", ctxA, {}, { id, role: "author", name: "Dr Park" });
    assert.equal(sig.ok, true);
    assert.equal(sig.result.entry.status, "signed");

    // signed pages are immutable
    const blocked = call("notebook-update", ctxA, {}, { id, body: "should fail" });
    assert.equal(blocked.ok, false);
  });

  it("rejects an untitled entry", () => {
    const r = call("notebook-create", ctxA, {}, { title: "" });
    assert.equal(r.ok, false);
  });
});

describe("lab — reagent inventory", () => {
  it("add / list / consume / remove with expiry + low-stock alerts", () => {
    const yesterday = new Date(Date.now() - 86400000).toISOString().slice(0, 10);
    const a = call("inventory-add", ctxA, {}, { name: "Taq polymerase", quantity: 5, lowThreshold: 10, expiry: yesterday });
    assert.equal(a.ok, true);
    const id = a.result.item.id;

    const list = call("inventory-list", ctxA, {}, {});
    assert.equal(list.ok, true);
    assert.equal(list.result.total, 1);
    assert.equal(list.result.expiredCount, 1);
    assert.equal(list.result.lowStockCount, 1);

    const con = call("inventory-consume", ctxA, {}, { id, delta: 20 });
    assert.equal(con.ok, true);
    assert.equal(con.result.item.quantity, 25);

    const rm = call("inventory-remove", ctxA, {}, { id });
    assert.equal(rm.ok, true);
    assert.equal(rm.result.remaining, 0);
  });

  it("rejects an unnamed reagent", () => {
    assert.equal(call("inventory-add", ctxA, {}, {}).ok, false);
  });
});

describe("lab — protocol / SOP library", () => {
  it("create / list / revise / run round-trip", () => {
    const c = call("protocol-create", ctxA, {}, {
      name: "Western blot",
      steps: ["Prepare gel", { text: "Run gel", durationMinutes: 60, critical: true }],
    });
    assert.equal(c.ok, true);
    const id = c.result.protocol.id;
    assert.equal(c.result.protocol.version, 1);

    const list = call("protocol-list", ctxA, {}, {});
    assert.equal(list.ok, true);
    assert.equal(list.result.protocols[0].stepCount, 2);
    assert.equal(list.result.protocols[0].totalMinutes, 60);

    const rev = call("protocol-revise", ctxA, {}, { id, steps: ["Only one step"] });
    assert.equal(rev.ok, true);
    assert.equal(rev.result.protocol.version, 2);
    assert.equal(rev.result.protocol.history.length, 1);

    const run = call("protocol-run", ctxA, {}, { id });
    assert.equal(run.ok, true);
    assert.equal(run.result.run.currentStep, 1);
    assert.equal(run.result.run.steps.length, 1);
  });
});

describe("lab — plate / well layout designer", () => {
  it("designs a 96-well plate and counts roles", () => {
    const r = call("plate-design", ctxA, {}, {
      name: "Assay 1", format: 96,
      wells: [
        { well: "A1", sample: "std", role: "standard" },
        { well: "A2", sample: "blk", role: "blank" },
        { well: "ZZ", sample: "bad" }, // invalid — ignored
      ],
    });
    assert.equal(r.ok, true);
    assert.equal(r.result.plate.format, 96);
    assert.equal(r.result.plate.assignedWells, 2);
    assert.equal(r.result.plate.roleCounts.standard, 1);

    const list = call("plate-list", ctxA, {}, {});
    assert.equal(list.ok, true);
    assert.equal(list.result.total, 1);
  });
});

describe("lab — instrument run import", () => {
  it("parses a CSV into records with a numeric summary", () => {
    const csv = "sample,od600,ph\nA,0.4,7.1\nB,0.8,6.9";
    const r = call("run-import", ctxA, {}, { csv, instrument: "Plate reader" });
    assert.equal(r.ok, true);
    assert.equal(r.result.run.recordCount, 2);
    assert.ok(r.result.run.numericColumns.includes("od600"));
    assert.equal(r.result.run.summary.od600.mean, 0.6);

    const list = call("run-list", ctxA, {}, {});
    assert.equal(list.ok, true);
    assert.equal(list.result.total, 1);
  });

  it("rejects an empty CSV", () => {
    assert.equal(call("run-import", ctxA, {}, { csv: "" }).ok, false);
  });
});

describe("lab — construct registry", () => {
  it("registers, lists and analyzes a DNA construct", () => {
    const seq = "ATG" + "AAACCCGGG".repeat(12) + "TAA";
    const c = call("construct-register", ctxA, {}, { name: "pTest", sequence: seq, type: "plasmid" });
    assert.equal(c.ok, true);
    assert.ok(c.result.construct.length > 0);
    assert.ok(c.result.construct.gcContent >= 0);
    const id = c.result.construct.id;

    const list = call("construct-list", ctxA, {}, {});
    assert.equal(list.ok, true);
    assert.equal(list.result.total, 1);

    const an = call("construct-analyze", ctxA, {}, { id, motif: "ATG" });
    assert.equal(an.ok, true);
    assert.ok(an.result.orfCount >= 1);
    assert.ok(an.result.motifHitCount >= 1);
  });

  it("rejects analyze with no sequence or id", () => {
    assert.equal(call("construct-analyze", ctxA, {}, {}).ok, false);
  });
});

describe("lab — QC trend (Levey-Jennings)", () => {
  it("builds a control series with limits and audit trail", () => {
    const r = call("qc-trend", ctxA, {}, {
      targetMean: 100, targetSD: 2,
      points: [
        { value: 100, date: "2026-01-01" },
        { value: 101, date: "2026-01-02" },
        { value: 110, date: "2026-01-03" }, // > 3SD → out of control
      ],
    });
    assert.equal(r.ok, true);
    assert.equal(r.result.n, 3);
    assert.equal(r.result.controlLimits.plus3sd, 106);
    assert.equal(r.result.outOfControlCount, 1);
    assert.equal(r.result.auditTrail.length, 1);
    assert.equal(r.result.inControl, false);
  });

  it("rejects a series shorter than two points", () => {
    assert.equal(call("qc-trend", ctxA, {}, { points: [{ value: 1, date: "2026-01-01" }] }).ok, false);
  });
});

describe("lab — per-user isolation", () => {
  it("does not leak notebook entries across users", () => {
    call("notebook-create", ctxA, {}, { title: "A entry" });
    const bList = call("notebook-list", ctxB, {}, {});
    assert.equal(bList.ok, true);
    assert.equal(bList.result.total, 0);
  });

  it("does not leak reagents or protocols across users", () => {
    call("inventory-add", ctxA, {}, { name: "EtOH" });
    call("protocol-create", ctxA, {}, { name: "Mini-prep", steps: ["lyse"] });
    assert.equal(call("inventory-list", ctxB, {}, {}).result.total, 0);
    assert.equal(call("protocol-list", ctxB, {}, {}).result.total, 0);
  });
});

describe("lab — macro edge cases", () => {
  it("inventory-consume clamps quantity to zero, never negative", () => {
    const a = call("inventory-add", ctxA, {}, { name: "DMSO", quantity: 3 });
    const r = call("inventory-consume", ctxA, {}, { id: a.result.item.id, delta: -10 });
    assert.equal(r.ok, true);
    assert.equal(r.result.item.quantity, 0);
  });

  it("protocol-revise without new steps still bumps the version", () => {
    const c = call("protocol-create", ctxA, {}, { name: "ELISA", steps: ["coat"] });
    const r = call("protocol-revise", ctxA, {}, { id: c.result.protocol.id, description: "updated" });
    assert.equal(r.ok, true);
    assert.equal(r.result.protocol.version, 2);
  });

  it("construct-list reports totalBases across the registry", () => {
    call("construct-register", ctxA, {}, { name: "c1", sequence: "ATGAAATAA" });
    call("construct-register", ctxA, {}, { name: "c2", sequence: "GGGCCC" });
    const list = call("construct-list", ctxA, {}, {});
    assert.equal(list.ok, true);
    assert.equal(list.result.totalBases, 15);
  });

  it("plate-design accepts the 384-well format", () => {
    const r = call("plate-design", ctxA, {}, {
      format: 384, wells: [{ well: "P24", role: "control" }],
    });
    assert.equal(r.ok, true);
    assert.equal(r.result.plate.format, 384);
    assert.equal(r.result.plate.totalWells, 384);
    assert.equal(r.result.plate.assignedWells, 1);
  });

  it("run-import flags an instrument and rejects a header-only CSV", () => {
    const ok = call("run-import", ctxA, {}, { csv: "x,y\n1,2", instrument: "qPCR" });
    assert.equal(ok.ok, true);
    assert.equal(ok.result.run.instrument, "qPCR");
    assert.equal(call("run-import", ctxA, {}, { csv: "only,header" }).ok, false);
  });

  it("notebook-sign rejects an unknown entry id", () => {
    assert.equal(call("notebook-sign", ctxA, {}, { id: "nope", role: "author" }).ok, false);
  });
});
