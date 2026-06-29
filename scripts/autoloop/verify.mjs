// scripts/autoloop/verify.mjs
// The INDEPENDENT, default-FAIL gate. Run by a verifier subagent spawned with NO
// Write/Edit tools — it grades a unit from the post-work tree + a real evidence
// artifact, never from the worker's self-report. A unit is "done" ONLY when this
// returns PASS (exit 0).
//
//   node scripts/autoloop/verify.mjs <unitId> --capture   # snapshot the pre-work metric (run BEFORE the worker)
//   node scripts/autoloop/verify.mjs <unitId>             # grade (run AFTER the worker) → PASS / NEEDS_WORK
//
// Default-FAIL: missing preGate, missing evidence, or a metric that did not move
// the right way all yield NEEDS_WORK (exit 1).

import { existsSync } from "node:fs";
import { resolve } from "node:path";
import { REPO, run, readJson, loadBacklog, saveBacklog, ok, bad, warn } from "./lib.mjs";

const [unitId, mode] = process.argv.slice(2);
if (!unitId) { console.error("usage: verify.mjs <unitId> [--capture]"); process.exit(2); }

const backlog = loadBacklog();
const unit = backlog.units.find((u) => u.id === unitId);
if (!unit) { console.error(bad(`unknown unit ${unitId}`)); process.exit(2); }

// ── Per-stream metric. Returns { value:number|null, target?:'rise'|'hold', evidence:bool, note } ──
function metric(u) {
  switch (u.stream) {
    case "depth": {
      run("node scripts/grade-macro-depth.mjs --honest", { allowFail: true });
      const j = readJson(resolve(REPO, "audit/macro-depth-honest.json"), {});
      const testFile = resolve(REPO, `server/tests/depth/${u.target}-behavior.test.js`);
      const hasTest = existsSync(testFile);
      // Honesty guard must be clean for THIS file, and the test must actually pass.
      const guard = hasTest ? run("node scripts/check-depth-tests.mjs", { allowFail: true }) : { ok: false };
      const t = hasTest ? run(`node --test ${JSON.stringify(testFile)}`, { allowFail: true }) : { ok: false, out: "" };
      const testsPass = /# fail 0\b/.test(t.out) || (t.ok && !/# fail [1-9]/.test(t.out));
      return { value: j.weightedScore ?? null, target: "rise", evidence: hasTest && guard.ok && testsPass, note: `floor=${j.weightedScore} hasTest=${hasTest} guardClean=${guard.ok} testsPass=${testsPass}` };
    }
    case "lens": {
      run("npm run --silent score-lenses", { allowFail: true });
      const j = readJson(resolve(REPO, "audit/ux-polish.json"), { lenses: [] });
      const l = (j.lenses || []).find((x) => x.lens === u.target);
      const rank = { raw: 0, functional: 1, polished: 2 };
      return { value: l ? rank[l.tier] ?? 0 : null, target: "rise", evidence: !!l, note: `tier=${l?.tier}` };
    }
    case "gameloop": {
      run("node scripts/audit-emergent-wiring.mjs", { allowFail: true });
      const w = readJson(resolve(REPO, "reports/emergent-wiring-audit.json"), { orphan: [] });
      const orphan = (w.orphan || []).length;
      // Evidence: a behavioral/test diff that proves the consequence lands.
      const touchedTest = run("git diff --name-only HEAD").out.split("\n").some((f) => /\.(test|behavior)\./.test(f));
      return { value: -orphan, target: "hold", evidence: orphan === 0 && touchedTest, note: `orphan=${orphan} touchedTest=${touchedTest}` };
    }
    case "connector": {
      const t = run(`node --test server/tests/${u.target}-*.test.js 2>/dev/null`, { allowFail: true });
      const broken = run("node scripts/lens-broken-calls.mjs --ci 0", { allowFail: true });
      const pass = t.ok && broken.ok && existsSync(resolve(REPO, `server/domains/${u.target}.js`));
      return { value: pass ? 1 : 0, target: "rise", evidence: pass, note: `domainExists=${existsSync(resolve(REPO, `server/domains/${u.target}.js`))} brokenCallsClean=${broken.ok}` };
    }
    case "conkay": {
      const g = run("grep -rE 'setInterval|setTimeout' concord-frontend/components/conkay/ | grep -viE 'voice|stt|cleanup|fade|nav' | wc -l", { allowFail: true });
      const fakeCount = parseInt((g.out || "0").trim(), 10) || 0;
      const touchedTest = run("git diff --name-only HEAD").out.split("\n").some((f) => /conkay.*\.(test|spec)\./i.test(f));
      return { value: -fakeCount, target: "hold", evidence: fakeCount === 0 && touchedTest, note: `fakeProgress=${fakeCount} touchedTest=${touchedTest}` };
    }
    default:
      return { value: null, evidence: false, note: "unknown stream" };
  }
}

if (mode === "--capture") {
  const m = metric(unit);
  unit.preGate = m.value;
  saveBacklog(backlog);
  console.log(ok("captured") + ` preGate(${unitId}) = ${m.value}  [${m.note}]`);
  process.exit(0);
}

// ── Grade (default-FAIL) ──
if (unit.preGate === undefined || unit.preGate === null) {
  console.log(bad("NEEDS_WORK") + ` — no preGate captured for ${unitId} (run --capture before the worker). Default-FAIL.`);
  process.exit(1);
}
const m = metric(unit);
const moved = m.target === "rise" ? (m.value > unit.preGate) : (m.value >= unit.preGate);
const pass = m.evidence && m.value !== null && moved;

console.log(`unit ${unitId}`);
console.log(`  metric ${unit.preGate} → ${m.value}  (${m.target})   moved=${moved}`);
console.log(`  evidence ${m.evidence ? ok("present") : bad("MISSING")}   [${m.note}]`);
if (pass) { console.log(ok("PASS") + " — verified done."); process.exit(0); }
console.log(bad("NEEDS_WORK") + " — " + (!m.evidence ? "no real evidence artifact" : !moved ? "ratchet did not move the right way" : "metric null") + " (default-FAIL).");
process.exit(1);
