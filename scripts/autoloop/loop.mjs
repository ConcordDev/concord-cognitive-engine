// scripts/autoloop/loop.mjs
// The orchestrator's state machine. One `tick` emits the next action in the loop
// contract; the mutation subcommands record a unit's outcome. In Stage 1/2 the
// in-session orchestrator (Claude) executes the worker + verifier subagents
// between ticks; in Stage 3 a cron driver calls the Claude API to do the same.
//
//   node scripts/autoloop/loop.mjs                         # tick → print the next action
//   node scripts/autoloop/loop.mjs --pass <id> --note "…"  # mark a verified unit passed
//   node scripts/autoloop/loop.mjs --fail <id>             # record a failed attempt (escalates at 3)
//   node scripts/autoloop/loop.mjs --escalate <id> --note "…"
//
// Stop conditions: AGENT_STOP file, STEER.md (surfaced once), and no-progress
// (NO_PROGRESS_LIMIT consecutive ticks with no newly-passed unit).

import { existsSync, unlinkSync, readFileSync } from "node:fs";
import { REPO, run, loadBacklog, saveBacklog, journal, stopRequested, STEER_PATH, ok, bad, warn, C } from "./lib.mjs";

const argv = process.argv.slice(2);
const flag = (n) => { const i = argv.indexOf(n); return i >= 0 ? (argv[i + 1] ?? true) : null; };
const NO_PROGRESS_LIMIT = parseInt(process.env.AUTOLOOP_NO_PROGRESS || "4", 10);
const MAX_ATTEMPTS = 3;

function mark(id, status, note) {
  const b = loadBacklog();
  const u = b.units.find((x) => x.id === id);
  if (!u) { console.error(bad(`unknown unit ${id}`)); process.exit(2); }
  u.status = status;
  if (note) u.evidence = note;
  if (status === "passed") { b.lastPassedAt = new Date().toISOString(); }
  saveBacklog(b);
  journal(`${status.toUpperCase()} ${id}${note ? " — " + note : ""}`);
  console.log(ok(`marked ${id} = ${status}`));
}

if (flag("--pass")) { mark(flag("--pass"), "passed", flag("--note")); process.exit(0); }
if (flag("--escalate")) { mark(flag("--escalate"), "escalated", flag("--note")); process.exit(0); }
if (flag("--fail")) {
  const id = flag("--fail");
  const b = loadBacklog();
  const u = b.units.find((x) => x.id === id);
  if (!u) { console.error(bad(`unknown unit ${id}`)); process.exit(2); }
  u.attempts = (u.attempts || 0) + 1;
  if (u.attempts >= MAX_ATTEMPTS) { u.status = "escalated"; journal(`ESCALATE ${id} — failed verify ${u.attempts}× (stuck)`); }
  saveBacklog(b);
  console.log(warn(`attempt ${u.attempts}/${MAX_ATTEMPTS} on ${id}`) + (u.attempts >= MAX_ATTEMPTS ? bad(" → escalated (stuck)") : ""));
  process.exit(0);
}

// ── tick ──
if (stopRequested()) { console.log(warn("AGENT_STOP present — loop halted. `rm AGENT_STOP` to resume.")); process.exit(3); }
if (existsSync(STEER_PATH)) {
  console.log(`${C.b}── STEER (human redirection) ──${C.rst}\n` + readFileSync(STEER_PATH, "utf8"));
  try { unlinkSync(STEER_PATH); } catch {}
  journal("STEER surfaced + cleared");
}

const next = JSON.parse(run("node scripts/autoloop/next.mjs --json", { allowFail: true }).out || "null");
if (!next || !next.id) {
  // no-progress / completion accounting
  const b = loadBacklog();
  const pending = (b.units || []).filter((u) => u.status === "pending").length;
  console.log(ok("LOOP COMPLETE") + ` — 0 pending units (escalated units await a human).`);
  process.exit(0);
}

// No-progress detection: how many ticks since the last newly-passed unit?
const b = loadBacklog();
b.ticksSincePass = next.id === b.lastSelected ? (b.ticksSincePass || 0) + 1 : 0;
b.lastSelected = next.id;
saveBacklog(b);
if (b.ticksSincePass >= NO_PROGRESS_LIMIT) {
  console.log(bad(`NO-PROGRESS`) + ` — ${b.ticksSincePass} ticks stuck on ${next.id}. Halting; needs human triage.`);
  process.exit(4);
}

console.log(`${C.b}── tick → next action ──${C.rst}`);
console.log(`  unit ${ok(next.id)}  (${next.stream}, leverage ${Number(next.leverage).toFixed(6)})`);
console.log(`\n  ${C.b}orchestrator runs, in order:${C.rst}`);
console.log(`   1. node scripts/autoloop/verify.mjs ${next.id} --capture      # snapshot pre-work metric`);
console.log(`   2. dispatch a fresh-context WORKER subagent with the prompt below`);
console.log(`   3. node scripts/autoloop/verify.mjs ${next.id}                # INDEPENDENT verifier subagent (no write tools)`);
console.log(`   4. node scripts/autoloop/guard.mjs                            # anti-gaming gate on the diff`);
console.log(`   5. on PASS+clean: commit+push, then loop.mjs --pass ${next.id} --note "<evidence>"`);
console.log(`      on NEEDS_WORK: loop.mjs --fail ${next.id} (escalates at ${MAX_ATTEMPTS})`);
console.log(`\n  ${C.b}worker prompt:${C.rst}\n  ${next.prompt}`);
console.log(`\n  ${warn("DONE gate")} ${next.gate}`);
