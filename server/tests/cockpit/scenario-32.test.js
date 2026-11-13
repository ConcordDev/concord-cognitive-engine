import test, { before, after } from "node:test";
import assert from "node:assert/strict";
import crypto from "node:crypto";
import { memDb, scenarioDeps, simulateRestart } from "./_helpers.js";
import * as store from "../../lib/cockpit/run-store.js";
import { driveRun } from "../../lib/cockpit/engine.js";
import { pumpOnce } from "../../lib/cockpit/pump.js";
import { applyDecision } from "../../lib/cockpit/confirm.js";
import { getToolSpec } from "../../lib/cockpit/tool-spec.js";
import { publicStep } from "../../routes/cockpit.js";
import { verifyAttestation, resetSigningKeyCache } from "../../lib/receipts/attest.js";
import { SCENARIO_STEPS, SCENARIO_MODEL_SCRIPT, makeScenarioExec, INDUCED, DTU_ID } from "./scenario-32.fixture.js";
import { scenarioReport, reportMarkdown } from "./scenario-report.js";

const FLAGS = ["CONCORD_COCKPIT_RUNS", "CONCORD_COCKPIT_REPAIR", "CONCORD_COCKPIT_RETRY", "CONCORD_COCKPIT_MENU", "CONCORD_COCKPIT_CONSTRAINED"];
const saved = Object.fromEntries([...FLAGS, "CONCORD_RECEIPT_SIGNING_KEY"].map((k) => [k, process.env[k]]));
before(() => {
  for (const k of FLAGS) process.env[k] = "1";
  const { privateKey } = crypto.generateKeyPairSync("ed25519");
  process.env.CONCORD_RECEIPT_SIGNING_KEY = privateKey.export({ type: "pkcs8", format: "pem" }).toString();
  resetSigningKeyCache();
});
after(() => {
  for (const [k, v] of Object.entries(saved)) { if (v === undefined) delete process.env[k]; else process.env[k] = v; }
  resetSigningKeyCache();
});

const wait = (ms) => new Promise((r) => { const t = setTimeout(r, ms); if (t.unref) t.unref(); });
const TERMINAL = new Set(["done", "failed", "cancelled"]);

function setup() {
  const db = memDb();
  const { run } = store.createRun(db, { userId: "u1", surface: "chat", goal: "Design a beam and save it", modelProfile: "local-2b" });
  store.insertSteps(db, run.id, 1, SCENARIO_STEPS.map((s) => ({ ...s })));
  return { db, runId: run.id };
}

const drive = (db, runId, deps, owner = "A") => driveRun({ db, runId, owner, deps, maxTicks: 300 });
function approveWaiting(db, runId) {
  const run = store.getRun(db, runId);
  const step = store.listSteps(db, runId).find((s) => s.status === "awaiting_confirm");
  assert.ok(step, "a step should be waiting");
  const r = applyDecision(db, { run, step, userId: "u1", decision: "approve" });
  assert.equal(r.ok, true);
  return step;
}
const stepOf = (db, runId, k) => store.listSteps(db, runId).find((s) => s.id === `stp_${k}`);

test("setup: every tool in the plan resolves through getToolSpec", () => {
  const missing = SCENARIO_STEPS.filter((s) => s.tool && !getToolSpec(s.tool, { lensActions: new Map() })).map((s) => s.tool);
  assert.deepEqual(missing, []);
  assert.equal(SCENARIO_STEPS.length, 32);
});

test("32 steps, four induced failures, two confirms and a restart in the middle of a write", async () => {
  const t0 = Date.now();
  const { db, runId } = setup();
  const ex = makeScenarioExec();
  const events = [];
  let crashArmed = false;
  let crashHit = false;
  const first = scenarioDeps({
    execTable: ex.table, modelScript: SCENARIO_MODEL_SCRIPT, events,
    extra: {
      verify: async (a) => {
        if (crashArmed && a.call?.tool === "create_document") { crashArmed = false; crashHit = true; return new Promise(() => {}); }
        return { pass: true, checks: [] };
      },
    },
  });

  // 1. up to the first confirm card (s14)
  await drive(db, runId, first.deps);
  assert.equal(store.getRun(db, runId).status, "awaiting_confirm");
  assert.equal(store.listSteps(db, runId).find((s) => s.status === "awaiting_confirm").id, "stp_s14");
  for (let i = 1; i <= 13; i++) assert.equal(stepOf(db, runId, `s${String(i).padStart(2, "0")}`).status, "done", `s${i}`);
  assert.ok(stepOf(db, runId, INDUCED.badArg).attempts >= 2);
  assert.ok(stepOf(db, runId, INDUCED.unknownTool).attempts >= 2);

  // 2. approve s14, on to s30
  approveWaiting(db, runId);
  await drive(db, runId, first.deps);
  assert.equal(store.getRun(db, runId).status, "awaiting_confirm");
  assert.equal(store.listSteps(db, runId).find((s) => s.status === "awaiting_confirm").id, "stp_s30");
  assert.equal(stepOf(db, runId, INDUCED.timeout).attempts, 2);
  assert.ok(stepOf(db, runId, INDUCED.staleId).attempts >= 2);
  assert.equal(ex.counters.create_dtu, 1);

  // 3. approve s30; the process dies after the write landed but before the engine recorded it
  approveWaiting(db, runId);
  crashArmed = true;
  await Promise.race([drive(db, runId, first.deps), wait(200)]);
  assert.equal(crashHit, true, "the crash point was reached");
  assert.equal(ex.counters.create_document, 1);
  assert.ok(!TERMINAL.has(store.getRun(db, runId).status));

  // 4. restart with fresh deps and let the pump finish the run
  const second = simulateRestart(db, runId, () => scenarioDeps({ execTable: ex.table, modelScript: SCENARIO_MODEL_SCRIPT, events }));
  for (let i = 0; i < 20 && !TERMINAL.has(store.getRun(db, runId).status); i++) {
    await pumpOnce({ db, owner: "B", makeDeps: () => second.deps });
  }

  // 5. report
  const run = store.getRun(db, runId);
  const steps = store.listSteps(db, runId);
  const packets = [...first.packets, ...second.packets];
  const report = scenarioReport({ run, steps, events, packets, execCalls: ex.outcomes });
  const okCalls = (f) => ex.outcomes.filter((o) => f(o));
  report.recovered = {
    s05: stepOf(db, runId, "s05").status === "done" && stepOf(db, runId, "s05").attempts >= 2
      && okCalls((o) => o.tool === "run_compute" && o.params.key === "physics.length.convert" && !o.ok).length >= 1
      && okCalls((o) => o.tool === "run_compute" && o.params.key === "units.convert" && o.ok).length >= 1,
    s11: stepOf(db, runId, "s11").status === "done" && stepOf(db, runId, "s11").attempts >= 2
      && okCalls((o) => o.tool === "load_combo_calc").length === 0
      && okCalls((o) => o.tool === "run_compute" && o.params.input?.a === 1.2 && o.ok).length === 1,
    s17: stepOf(db, runId, "s17").status === "done" && stepOf(db, runId, "s17").attempts === 2 && ex.counters.timeouts === 1,
    s23: stepOf(db, runId, "s23").status === "done" && stepOf(db, runId, "s23").attempts >= 2
      && okCalls((o) => o.tool === "export_dtu" && o.params.dtuId === DTU_ID && o.ok).length === 1,
  };
  console.log(`\n${reportMarkdown(report, "ci")}\n`);

  assert.equal(report.stepsDone, 32);
  assert.equal(run.status, "done");
  assert.deepEqual(Object.values(report.recovered), [true, true, true, true]);
  assert.equal(run.usage.humanInterventions, 2);
  assert.equal(report.duplicateWrites, 0);
  assert.equal(ex.counters.create_dtu, 1);
  assert.equal(ex.counters.create_document, 1);
  assert.equal(report.receiptsValid, report.receiptsTotal);
  assert.equal(report.receiptsTotal, steps.filter((s) => s.status === "done").length);
  assert.ok(report.maxPacketTokens <= 2500, `packet ${report.maxPacketTokens}`);
  assert.ok(report.maxMenu <= 8, `menu ${report.maxMenu}`);
  assert.equal(report.runsEndedBySingleFailure, 0);
  assert.ok(events.some((e) => e.type === "test:packet"), "the engine reports each packet it builds");

  // honesty: what a person would read never names a tool id, and no step was claimed without running
  const toolIds = new Set(SCENARIO_STEPS.map((s) => s.tool).filter(Boolean));
  const shown = [
    ...events.filter((e) => e.label).map((e) => String(e.label)),
    ...steps.flatMap((s) => { const p = publicStep(s); return [p.label, p.goal, p.summary, p.error].filter(Boolean).map(String); }),
  ];
  for (const text of shown) for (const id of toolIds) assert.ok(!text.includes(id), `"${text}" shows ${id}`);
  const successfulCalls = ex.outcomes.filter((o) => o.ok).length;
  assert.ok(successfulCalls >= report.stepsDone - 1, "every done step except the summary ran a tool");
  assert.ok(Date.now() - t0 < 60000);
});

test("negative control 1: with the timeout never clearing, the run does not reach 32 of 32", async () => {
  const { db, runId } = setup();
  const ex = makeScenarioExec({ failTimeoutOnce: false });
  const base = ex.table.web_search;
  ex.table.web_search = (c) => (c.params.query === "allowable stress table"
    ? (ex.outcomes.push({ tool: c.tool, params: c.params, ok: false }), { tool: c.tool, ok: false, reason: "timeout", error: "timed out" })
    : base(c));
  const d = scenarioDeps({ execTable: ex.table, modelScript: SCENARIO_MODEL_SCRIPT });
  await drive(db, runId, d.deps);
  approveWaiting(db, runId);
  await drive(db, runId, d.deps);
  const run = store.getRun(db, runId);
  assert.notEqual(run.status, "done");
  assert.ok(store.listSteps(db, runId).filter((s) => s.status === "done").length < 32);
});

test("negative control 2: a crash before a non-repeatable write finishes waits for a person, never writes twice", async () => {
  const db = memDb();
  const { run } = store.createRun(db, { userId: "u1", surface: "chat", goal: "Save a note", modelProfile: "local-2b" });
  store.insertSteps(db, run.id, 1, [{ id: "stp_w", goal: "Save the note", tool: "create_document", args: { title: "T", content: "C" }, expects: [] }]);
  store.addApproval(db, run.id, { stepId: "stp_w", tool: "create_document", argsHash: null, scope: "run_tool", userId: "u1", at: Date.now() });
  let writes = 0;
  const hang = scenarioDeps({ execTable: { create_document: () => { writes += 1; return new Promise(() => {}); } }, modelScript: {} });
  await Promise.race([drive(db, run.id, hang.deps), wait(200)]);
  const later = Date.now() + 200 * 1000;
  const fresh = scenarioDeps({ execTable: { create_document: () => { writes += 1; return { tool: "create_document", ok: true, result: { docId: "d2" } }; } }, modelScript: {}, extra: { now: () => later } });
  await drive(db, run.id, fresh.deps, "B");
  const after2 = store.getRun(db, run.id);
  assert.equal(after2.status, "awaiting_confirm");
  assert.equal(after2.statusReason, "maybe_done");
  assert.equal(writes, 1);
});

test("negative control 3: a tampered receipt is counted as invalid", async () => {
  const { db, runId } = setup();
  const ex = makeScenarioExec();
  const d = scenarioDeps({ execTable: ex.table, modelScript: SCENARIO_MODEL_SCRIPT });
  await drive(db, runId, d.deps);
  const steps = store.listSteps(db, runId).filter((s) => s.status === "done" && s.receipt);
  assert.ok(steps.length >= 1);
  assert.equal(verifyAttestation(steps[0].receipt).valid, true);
  assert.equal(verifyAttestation({ ...steps[0].receipt, argsHash: "0".repeat(64) }).valid, false);
  const tampered = steps.map((s, i) => (i === 0 ? { ...s, receipt: { ...s.receipt, argsHash: "0".repeat(64) } } : s));
  const valid = tampered.filter((s) => verifyAttestation(s.receipt).valid === true).length;
  assert.equal(valid, tampered.length - 1);
});
