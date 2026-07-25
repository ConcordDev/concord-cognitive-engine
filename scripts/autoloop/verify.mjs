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

import { execFileSync } from "node:child_process";
import { existsSync, readdirSync } from "node:fs";
import { resolve } from "node:path";

// Shell-free `node --test <file>` (command-injection fix, authorized
// 2026-07-25). `run()` passes a STRING to execSync — a shell — so any path
// interpolated into it is an injection sink. These paths come from the
// generated backlog rather than directly from user input, but the class is
// the same one that was live in guard.mjs, and an argv array costs nothing.
// Returns the same `{ ok, out }` shape `run()` does so call sites are
// unchanged; a non-zero exit is a normal outcome here (a failing test), not
// an error, hence the catch returning the captured output.
function nodeTest(file) {
  try {
    return { ok: true, out: execFileSync("node", ["--test", file], { cwd: REPO, encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] }) };
  } catch (e) {
    return { ok: false, out: String(e?.stdout || "") + String(e?.stderr || "") };
  }
}
import { REPO, run, runArgv, readJson, loadBacklog, saveBacklog, ok, bad, warn } from "./lib.mjs";

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
      const t = hasTest ? nodeTest(testFile) : { ok: false, out: "" };
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
      // Migrated off `run()` 2026-07-25 (authorized). This was the loop's last
      // site interpolating a computed value into a shell string. `u.target` is
      // only ever a connector-domain slug from the generated backlog, so it was
      // not exploitable in practice — but "not exploitable by today's callers"
      // is a property of the callers, not of the code, and it silently becomes
      // false the moment someone widens the backlog source.
      //
      // The two things the shell was needed for are done in Node instead:
      // the `*` glob becomes a readdir+filter, and the `2>/dev/null` redirect
      // is unnecessary because runArgv already pipes stderr rather than
      // inheriting it. No shell is spawned, so no interpolation can be parsed.
      const testDir = resolve(REPO, "server/tests");
      const matches = (existsSync(testDir) ? readdirSync(testDir) : [])
        .filter(f => f.startsWith(`${u.target}-`) && f.endsWith(".test.js"))
        .map(f => `server/tests/${f}`);
      const t = matches.length
        ? runArgv("node", ["--test", ...matches], { allowFail: true })
        // Honest no-op result when the glob matches nothing — previously the
        // shell would have run `node --test` against an unexpanded literal and
        // failed; neither outcome is a real signal, so say so explicitly.
        : { ok: false, code: 0, out: `no test files matched ${u.target}-*.test.js` };
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
    case "repair": {
      if (u.meta?.test) {
        const t = nodeTest(u.meta.test);
        const fails = (t.out.match(/# fail (\d+)/) || [])[1];
        const passing = fails !== undefined ? parseInt(fails, 10) === 0 : t.ok;
        return { value: passing ? 1 : 0, target: "rise", evidence: passing, note: `test=${u.meta.test} fails=${fails ?? "?"}` };
      }
      // frontend coverage: pass when the coverage gate exits 0.
      const c = run("cd concord-frontend && npm run --silent test:coverage", { allowFail: true, timeoutMs: 900000 });
      return { value: c.ok ? 1 : 0, target: "rise", evidence: c.ok, note: `coverage gate ${c.ok ? "green" : "red"}` };
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
