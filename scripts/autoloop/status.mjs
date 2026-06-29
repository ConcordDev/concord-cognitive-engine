// scripts/autoloop/status.mjs
// One-screen dashboard for the autonomous loop: per-stream progress + the live
// ratchet numbers + recent commits. Read-only; safe to run anytime.
//   node scripts/autoloop/status.mjs

import { resolve } from "node:path";
import { REPO, run, readJson, loadBacklog, C, ok, warn } from "./lib.mjs";

const b = loadBacklog();
const byStream = {};
for (const u of b.units || []) {
  byStream[u.stream] = byStream[u.stream] || { total: 0, passed: 0, escalated: 0 };
  byStream[u.stream].total++;
  if (u.status === "passed") byStream[u.stream].passed++;
  if (u.status === "escalated") byStream[u.stream].escalated++;
}

console.log(`${C.b}═══ Concord autonomous loop — status ═══${C.rst}`);
console.log(`backlog generated ${b.generatedAt || "(none — run next.mjs)"}\n`);

const bar = (p, t) => {
  const frac = t ? p / t : 0;
  const n = Math.round(frac * 20);
  return `${"█".repeat(n)}${"░".repeat(20 - n)} ${p}/${t}`;
};
for (const [s, v] of Object.entries(byStream)) {
  const esc = v.escalated ? warn(` (${v.escalated} escalated)`) : "";
  console.log(`  ${s.padEnd(10)} ${bar(v.passed, v.total)}${esc}`);
}

// Live ratchet numbers (read existing artifacts; no re-run for speed).
const honest = readJson(resolve(REPO, "audit/macro-depth-honest.json"), {});
const ux = readJson(resolve(REPO, "audit/ux-polish.json"), {});
const wiring = readJson(resolve(REPO, "reports/emergent-wiring-audit.json"), {});
console.log(`\n  ${C.dim}ratchets:${C.rst}`);
console.log(`    depth honest floor   ${ok(honest.weightedScore ?? "?")}  (ceiling ~0.72)`);
console.log(`    ux-polish floor      ${ok(ux.weightedScore ?? "?")}  (target 1.0)`);
console.log(`    emergent orphans     ${ok((wiring.orphan || []).length)}  (target 0)`);

const stop = run("test -f AGENT_STOP && echo STOPPED || echo running").out.trim();
console.log(`\n  control: ${stop === "STOPPED" ? warn("AGENT_STOP present — loop halts") : ok("running (no AGENT_STOP)")}`);

const log = run("git log --oneline -5").out.trim();
console.log(`\n  ${C.dim}recent commits:${C.rst}\n${log.split("\n").map((l) => "    " + l).join("\n")}`);
