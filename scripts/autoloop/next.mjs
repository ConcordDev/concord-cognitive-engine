// scripts/autoloop/next.mjs
// Refreshes the unified backlog from the existing rankers, then selects the ONE
// highest-leverage unit to work next. Idempotent: a unit already marked `passed`
// stays passed (skipped); `escalated` units are not selected. Prints the chosen
// unit + its DONE gate + a ready-to-paste worker prompt.
//
// Usage:
//   node scripts/autoloop/next.mjs            # refresh + print the next unit
//   node scripts/autoloop/next.mjs --refresh  # only refresh backlog.json, print summary
//   node scripts/autoloop/next.mjs --json      # print the chosen unit as JSON

import { existsSync } from "node:fs";
import { resolve } from "node:path";
import { REPO, run, readJson, loadBacklog, saveBacklog, C, ok, warn } from "./lib.mjs";

const args = new Set(process.argv.slice(2));

// ── Seed each stream from its ranker. Each returns [{ id, stream, target, leverage, prompt, gate }] ──

function seedDepth() {
  const r = run("node scripts/depth-backlog.mjs --json", { allowFail: true });
  let data; try { data = JSON.parse(r.out); } catch { return []; }
  return (data.domains || []).slice(0, 60).map((d) => ({
    id: `depth:${d.domain}`,
    stream: "depth",
    target: d.domain,
    leverage: d.gain || 0,
    meta: { untested: d.untested, projProd: d.projProd, projUtil: d.projUtil },
    gate: `honest floor (grade-macro-depth --honest weightedScore) rises, OR ${d.domain}'s untested set shrinks with substantive assertions; check-depth-tests clean`,
    prompt: `Add REAL behavioral tests for the ${d.domain} domain. Run \`node scripts/depth-scaffold.mjs ${d.domain}\` to generate the skeleton at server/tests/depth/${d.domain}-behavior.test.js, then replace every @depth-todo with a substantive assertion (exact computed value, round-trip, or validation-rejection) using lensRun/macroRuntime from server/tests/depth/_harness.js. Run \`node scripts/check-depth-tests.mjs\` until clean and \`node --test server/tests/depth/${d.domain}-behavior.test.js\` until 0 fail. Do NOT edit the grader or any existing test.`,
  }));
}

function seedLens() {
  const j = readJson(resolve(REPO, "audit/ux-polish.json"), null);
  if (!j || !Array.isArray(j.lenses)) return [];
  const rank = { raw: 2, functional: 1, polished: 0 };
  return j.lenses
    .filter((l) => l.tier !== "polished")
    .sort((a, b) => (rank[b.tier] || 0) - (rank[a.tier] || 0))
    .slice(0, 60)
    .map((l) => ({
      id: `lens:${l.lens}`,
      stream: "lens",
      target: l.lens,
      leverage: 0.0003 * (rank[l.tier] || 1),
      meta: { tier: l.tier, loc: l.totalLoc },
      gate: `ux-polish.json tier for ${l.lens} improves (${l.tier}→up) AND global weightedScore holds`,
      prompt: `Raise the ${l.lens} lens from "${l.tier}" toward "polished": add a real empty-state CTA, loading + error UI, accessible native buttons/keyboard handlers, and the rival-shape silhouette per its lens-features manifest entry. Re-run \`npm run score-lenses\` (writes audit/ux-polish.json) and confirm ${l.lens}'s tier rose. Presentation only — do not weaken any macro or test.`,
    }));
}

function seedGameloop() {
  const wiring = readJson(resolve(REPO, "reports/emergent-wiring-audit.json"), { orphan: [] });
  const orphans = (wiring.orphan || []).map((o) => ({
    id: `gameloop:orphan:${o.handler || o.module || o}`,
    stream: "gameloop",
    target: o.module || o.handler || String(o),
    leverage: 0.001,
    meta: { kind: "orphan-handler" },
    gate: `audit-emergent-wiring orphan count stays 0 AND a behavioral test proves the consequence lands`,
    prompt: `Wire the orphaned emergent handler ${o.handler || o} (it exports a cycle handler nothing schedules). Follow the wire-the-unwired pattern: registerHeartbeat or governorTick call + try/catch. Add a behavioral test that the consequence actually lands. Re-run \`node scripts/audit-emergent-wiring.mjs\` and confirm orphan==0.`,
  }));
  // A standing sweep unit when there are no concrete orphans (the audit re-scans).
  if (orphans.length === 0) {
    orphans.push({
      id: "gameloop:sweep",
      stream: "gameloop",
      target: "concordia-loops",
      leverage: 0.0008,
      meta: { kind: "sweep" },
      gate: `audit-emergent-wiring orphan==0 AND check-orphaned-events clean AND any newly-found reward-without-grant has a behavioral test proving the grant lands`,
      prompt: `Sweep one Concordia loop for a broken wire: run \`node scripts/audit-emergent-wiring.mjs\` and \`node scripts/check-orphaned-events.mjs\`, pick one orphan-emit / dead-listener / reward-without-grant, wire the real consequence, and add a behavioral test that it lands (e.g. the wallet is actually credited). If both audits are already clean and no reward-without-grant remains, mark this unit passed with that evidence.`,
    });
  }
  return orphans;
}

function seedConnectors() {
  const conns = ["slack", "sheets", "github", "notion"];
  return conns
    .filter((c) => !existsSync(resolve(REPO, `server/domains/${c}.js`)))
    .map((c) => ({
      id: `connector:${c}`,
      stream: "connector",
      target: c,
      leverage: 0.0006,
      meta: { goLive: "escalate" },
      gate: `${c} contract tests pass (injected fetch) AND lens-broken-calls --ci 0 holds; live-creds/go-live ESCALATED`,
      prompt: `Build the ${c} connector mirroring the Gmail/Calendar template: add egress helpers on the SSRF-guarded connectorFetch chokepoint (server/lib/connector-client.js), token handling via server/lib/connector-tokens.js, a server/domains/${c}.js with read+write macros, and contract tests using an INJECTED fetch (no live network). Do NOT wire live OAuth secrets — that go-live step is escalated to a human.`,
    }));
}

function seedConkay() {
  // ConKay Phase 2 is sequential (one shared scene). Seed the ordered beats from the plan.
  const beats = [
    ["run-started", "core powers on + rings spin up on macro:started"],
    ["tool-call", "a part pulses (selective bloom) on a real tool-call event"],
    ["tool-result", "a telemetry panel renders the REAL returned value"],
    ["verify-verdict", "the trust badge resolves Grounded vs Reasoned—verify from reason.verify"],
    ["run-finished", "the part re-assembles into the core on macro:completed"],
  ];
  return beats.map(([k, desc], i) => ({
    id: `conkay:${k}`,
    stream: "conkay",
    target: k,
    leverage: 0.0004 - i * 0.00001, // ordered: earlier beats first
    meta: { order: i },
    gate: `no setInterval/fake-progress under components/conkay/ (grep gate holds) AND a test asserts the element reacts to the real socket event`,
    prompt: `ConKay Phase 2 beat "${k}": ${desc}. Bind ONE scene element in concord-frontend/components/conkay/ to the real socket event via conkayHudStore — honest by construction, NO setInterval/fake-progress. Add a test asserting the element reacts to the real event. This stream is sequential; do this beat only if all lower-order conkay beats are passed.`,
  }));
}

// ── Refresh: merge seeded units into the backlog, preserving status/evidence ──
function refresh() {
  const prev = loadBacklog();
  const prevById = new Map((prev.units || []).map((u) => [u.id, u]));
  const seeded = [...seedDepth(), ...seedLens(), ...seedGameloop(), ...seedConnectors(), ...seedConkay()];
  const units = seeded.map((u) => {
    const old = prevById.get(u.id);
    return old ? { ...u, status: old.status, evidence: old.evidence, preGate: old.preGate, attempts: old.attempts || 0 } : { ...u, status: "pending", attempts: 0 };
  });
  // Carry forward passed/escalated units that the rankers no longer surface (so we never lose history).
  for (const old of prev.units || []) {
    if (!units.find((u) => u.id === old.id) && (old.status === "passed" || old.status === "escalated")) units.push(old);
  }
  const backlog = { generatedAt: new Date().toISOString().slice(0, 19) + "Z", units };
  saveBacklog(backlog);
  return backlog;
}

// ── Selection: highest-leverage pending unit not blocked on escalation/sequencing ──
function selectNext(backlog) {
  const passed = new Set(backlog.units.filter((u) => u.status === "passed").map((u) => u.id));
  const candidates = backlog.units.filter((u) => u.status === "pending");
  // ConKay sequencing: a conkay beat is eligible only if all lower-order beats passed.
  const eligible = candidates.filter((u) => {
    if (u.stream !== "conkay") return true;
    const lower = backlog.units.filter((x) => x.stream === "conkay" && (x.meta?.order ?? 0) < (u.meta?.order ?? 0));
    return lower.every((x) => passed.has(x.id));
  });
  eligible.sort((a, b) => (b.leverage || 0) - (a.leverage || 0));
  return eligible[0] || null;
}

const backlog = refresh();
const counts = backlog.units.reduce((m, u) => ((m[u.status] = (m[u.status] || 0) + 1), m), {});
const byStream = backlog.units.reduce((m, u) => {
  m[u.stream] = m[u.stream] || { total: 0, passed: 0 };
  m[u.stream].total++; if (u.status === "passed") m[u.stream].passed++;
  return m;
}, {});

if (args.has("--refresh")) {
  console.log(ok(`backlog refreshed`) + ` — ${backlog.units.length} units  ${JSON.stringify(counts)}`);
  for (const [s, v] of Object.entries(byStream)) console.log(`  ${s.padEnd(10)} ${v.passed}/${v.total}`);
  process.exit(0);
}

const next = selectNext(backlog);
if (!next) {
  console.log(ok("LOOP COMPLETE") + " — no pending units. " + JSON.stringify(counts));
  process.exit(0);
}

if (args.has("--json")) { console.log(JSON.stringify(next, null, 2)); process.exit(0); }

console.log(`${C.b}── next unit ──${C.rst}`);
console.log(`  id        ${ok(next.id)}`);
console.log(`  stream    ${next.stream}   leverage ${next.leverage.toFixed(6)}   attempts ${next.attempts || 0}`);
console.log(`  meta      ${JSON.stringify(next.meta || {})}`);
console.log(`  ${warn("DONE gate")} ${next.gate}`);
console.log(`\n  ${C.b}worker prompt:${C.rst}\n  ${next.prompt}`);
console.log(`\n  ${C.dim}backlog ${JSON.stringify(counts)}${C.rst}`);
