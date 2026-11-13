#!/usr/bin/env node
// The 32-step beam-design scenario against a real server (CKPT-22). Dutch (or a seat Dutch names) runs this
// at the desk; see docs/cockpit/DESK_RUNBOOK.md first. Node built-ins and fetch only.
//
// node server/scripts/cockpit-desk-scenario.mjs --base <url> [--out <file>] [--dry-run] [--induce all|none] [--plan-fixture] [--allow-remote]
import fs from "node:fs";
import path from "node:path";
import readline from "node:readline";
import { fileURLToPath } from "node:url";
import { SCENARIO_STEPS, INDUCED } from "../tests/cockpit/scenario-32.fixture.js";
import { reportMarkdown } from "../tests/cockpit/scenario-report.js";
import { verifyAttestation } from "../lib/receipts/attest.js";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const DEFAULT_OUT = path.resolve(HERE, "../../docs/cockpit/DESK_RESULTS.md");
const TERMINAL = new Set(["done", "failed", "cancelled"]);
const WRITE_TOOLS = new Set(["create_dtu", "create_document"]);
const RECOVERY_SEQ = { s05: 5, s11: 11, s17: 17, s23: 23 };

export const INDUCE_HINTS = Object.freeze({
  badArg: "Use physics.length.convert for the unit conversion.",
  unknownTool: "Combine the loads with the load_combo_calc tool.",
  timeout: "(Server started with CONCORD_COCKPIT_DESK_SLOW_TOOL=web_search makes the first web lookup run out of time.)",
  staleId: "Export the interim note with the id dtu_stale_999.",
});

export function scenarioGoal(induce = "all") {
  const base = "Design a simply supported timber beam: recall my notes, convert the span, total the loads, run the deflection and moment recipes, save an interim note, check the values, save the final design, read it back and write a summary.";
  return induce === "none" ? base : `${base} ${INDUCE_HINTS.badArg} ${INDUCE_HINTS.unknownTool} ${INDUCE_HINTS.staleId}`;
}

export function dryRunLines(induce = "all") {
  const lines = SCENARIO_STEPS.map((s, i) => `${String(i + 1).padStart(2, "0")}. ${s.goal}`);
  const induced = induce === "none" ? [] : Object.entries(INDUCED).map(([k, step]) => `induced ${k} at ${step}: ${INDUCE_HINTS[k]}`);
  return { lines, induced };
}

export function parseArgs(argv) {
  const o = { base: null, out: DEFAULT_OUT, dryRun: false, induce: "all", planFixture: false, allowRemote: false };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === "--base") o.base = argv[++i];
    else if (a === "--out") o.out = path.resolve(argv[++i]);
    else if (a === "--dry-run") o.dryRun = true;
    else if (a === "--induce") o.induce = argv[++i] === "none" ? "none" : "all";
    else if (a === "--plan-fixture") o.planFixture = true;
    else if (a === "--allow-remote") o.allowRemote = true;
  }
  return o;
}

export function hostIsLocal(base) {
  try { const h = new URL(base).hostname; return h === "localhost" || h === "127.0.0.1"; } catch { return false; }
}

const sleep = (ms) => new Promise((r) => { setTimeout(r, ms); });

/**
 * @param {{ base: string, cookie: string, answer: (prompt:string)=>Promise<string>, onRestart: ()=>Promise<void>,
 *           out?: string, induce?: string, planFixture?: boolean, pollMs?: number, maxWaitMs?: number,
 *           fetchImpl?: Function, log?: (s:string)=>void, model?: string }} o
 */
export async function runScenario(o) {
  const f = o.fetchImpl || globalThis.fetch;
  const log = o.log || ((s) => console.log(s));
  const pollMs = o.pollMs ?? 5000;
  const maxWaitMs = o.maxWaitMs ?? 45 * 60 * 1000;
  const headers = { "content-type": "application/json", cookie: o.cookie };
  const call = async (method, p, body) => {
    const res = await f(`${o.base}${p}`, { method, headers, body: body ? JSON.stringify(body) : undefined });
    let json = null; try { json = await res.json(); } catch { /* not json */ }
    return { status: res.status, json };
  };
  const t0 = Date.now();

  const pre = await call("GET", "/api/cockpit/failures?hours=1");
  if (pre.status !== 200) throw new Error(`cockpit failures check returned ${pre.status}${pre.json?.error ? ` (${pre.json.error})` : ""}. Start the server with the CONCORD_COCKPIT_* flags set.`);

  const body = { goal: scenarioGoal(o.induce), ...(o.planFixture ? { steps: SCENARIO_STEPS } : {}) };
  const created = await call("POST", "/api/cockpit/runs", body);
  if (created.status !== 201 || !created.json?.run?.id) throw new Error(`could not start the run: ${created.status} ${created.json?.error || ""}`);
  const runId = created.json.run.id;
  log(`run ${runId} started (${created.json.source})`);

  const seen = new Map();
  let confirms = 0;
  let last = null;
  while (Date.now() - t0 < maxWaitMs) {
    const r = await call("GET", `/api/cockpit/runs/${runId}`);
    if (r.status !== 200) { await sleep(pollMs); continue; }
    last = r.json;
    for (const s of last.steps) {
      if (seen.get(s.id) !== s.status) { seen.set(s.id, s.status); log(`step ${s.seq}: ${s.status}  ${s.label}`); }
    }
    if (TERMINAL.has(last.run.status)) break;
    if (last.run.status === "awaiting_confirm") {
      const waiting = last.steps.find((s) => s.status === "awaiting_confirm");
      if (waiting) {
        const text = await o.answer(`Step ${waiting.seq}: ${waiting.label}${waiting.error ? ` (${waiting.error})` : ""} — approve? [y/n] `);
        const yes = String(text).trim().toLowerCase().startsWith("y");
        const d = await call("POST", `/api/cockpit/runs/${runId}/decision`, { stepId: waiting.id, decision: yes ? "approve" : "reject" });
        if (d.status !== 200) log(`decision was refused: ${d.status} ${d.json?.error || ""}`);
        else if (yes) {
          confirms += 1;
          if (confirms === 2) await o.onRestart();
        }
      }
    }
    await sleep(pollMs);
  }

  const fin = await call("GET", `/api/cockpit/runs/${runId}`);
  const run = fin.json?.run || last?.run || {};
  const steps = fin.json?.steps || last?.steps || [];
  const done = steps.filter((s) => s.status === "done");
  const receipts = [];
  for (const s of done) {
    const rc = await call("GET", `/api/cockpit/runs/${runId}/steps/${s.id}/receipt`);
    if (rc.status === 200 && rc.json?.receipt) receipts.push(rc.json.receipt);
  }
  const receiptsValid = receipts.filter((rc) => { try { return verifyAttestation(rc).valid === true; } catch { return false; } }).length;
  const writes = new Map();
  for (const rc of receipts) {
    if (!WRITE_TOOLS.has(rc.tool) || rc.ok !== true) continue;
    const k = `${rc.tool}|${rc.argsHash}`;
    writes.set(k, (writes.get(k) || 0) + 1);
  }
  const duplicateWrites = [...writes.values()].reduce((n, g) => n + (g - 1), 0);
  const bySeq = new Map(steps.map((s) => [s.seq, s]));
  const recovered = Object.fromEntries(Object.entries(RECOVERY_SEQ).map(([k, seq]) => {
    const st = bySeq.get(seq);
    return [k, !!st && st.status === "done" && (st.attempts || 0) >= 2];
  }));
  const failures = await call("GET", "/api/cockpit/failures?hours=1");
  const report = {
    stepsDone: done.length, total: steps.length, recovered,
    humanInterventions: run.usage?.humanInterventions ?? confirms,
    duplicateWrites, receiptsValid, receiptsTotal: done.length,
    maxPacketTokens: 0, maxMenu: 0,
    runsEndedBySingleFailure: run.status === "failed" && steps.filter((s) => s.status === "failed").length === 1 ? 1 : 0,
  };
  const wallS = Math.round((Date.now() - t0) / 1000);
  const md = [
    "# Cockpit desk results", "",
    reportMarkdown(report, "desk"), "",
    "Packet and menu sizes are not exposed by the routes, so those two rows read 0 here; the CI scenario measures them.", "",
    `- Model: ${o.model || "(record the tag from /api/admin/brain-endpoints)"}`,
    `- Date: ${new Date().toISOString()}`,
    `- Wall time: ${wallS} s`,
    `- Final status: ${run.status || "unknown"}${run.statusReason ? ` (${run.statusReason})` : ""}`,
    `- Failure counts by class: ${failures.json?.counts ? JSON.stringify(failures.json.counts) : JSON.stringify(failures.json ?? {})}`,
    `- What the person had to do: ${report.humanInterventions} decision(s)`,
    `- Steps that failed: ${steps.filter((s) => s.status === "failed").map((s) => `${s.seq} (${s.error || "no reason"})`).join("; ") || "none"}`,
    `- Verdict: ${deskVerdict(report)}`, "",
  ].join("\n");
  fs.mkdirSync(path.dirname(o.out || DEFAULT_OUT), { recursive: true });
  fs.writeFileSync(o.out || DEFAULT_OUT, md);
  log(`results written to ${o.out || DEFAULT_OUT}`);
  return { report, markdown: md };
}

/** The "Desk, real 2B" pass line from PLAN.md section 5. A fail is written as a fail. */
export function deskVerdict(r) {
  const recovered = Object.values(r.recovered).filter(Boolean).length;
  const checks = [
    [r.stepsDone >= 30, `${r.stepsDone} of 32 steps (need 30)`],
    [recovered >= 3, `${recovered} of 4 failures recovered (need 3)`],
    [r.humanInterventions <= 3, `${r.humanInterventions} interventions (max 3)`],
    [r.duplicateWrites === 0, `${r.duplicateWrites} duplicate writes (need 0)`],
    [r.receiptsValid === r.receiptsTotal, `${r.receiptsValid} of ${r.receiptsTotal} receipts valid`],
    [r.runsEndedBySingleFailure === 0, "a run ended on a single failure"],
  ];
  const bad = checks.filter(([ok]) => !ok).map(([, why]) => why);
  return bad.length ? `FAIL: ${bad.join("; ")}` : "PASS";
}

const isMain = process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url);
if (isMain) {
  const o = parseArgs(process.argv.slice(2));
  if (o.dryRun) {
    const { lines, induced } = dryRunLines(o.induce);
    console.log([...lines, ...induced].join("\n"));
    process.exit(0);
  }
  if (!process.env.COCKPIT_DESK_COOKIE) { console.error("COCKPIT_DESK_COOKIE is not set"); process.exit(2); }
  if (!o.base) { console.error("--base <url> is required"); process.exit(2); }
  if (!hostIsLocal(o.base) && !o.allowRemote) { console.error("refusing a host that is not localhost or 127.0.0.1 (add --allow-remote to override)"); process.exit(2); }
  const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
  const ask = (q) => new Promise((r) => { rl.question(q, r); });
  runScenario({
    base: o.base, cookie: process.env.COCKPIT_DESK_COOKIE, out: o.out, induce: o.induce, planFixture: o.planFixture,
    answer: ask,
    onRestart: async () => { await ask("RESTART NOW: stop and start the scenario server, then press Enter "); },
  }).then(() => { rl.close(); }).catch((e) => { console.error(String(e?.message || e)); rl.close(); process.exit(1); });
}
