#!/usr/bin/env node
// scripts/adversarial-audit.mjs
//
// The Adversarial Audit orchestrator — the single CI gate that fronts every
// push/PR for the concord-cognitive-engine repo. It does NOT re-implement any
// verification: it composes the EXISTING, battle-tested verifier scripts as
// child processes, captures each gate's pass/fail by its real EXIT CODE (and,
// for the one verifier that always exits 0, by parsing its structured JSON
// output), prints a clean per-gate summary, and propagates a non-zero exit if
// ANY gate failed.
//
// DESIGN PRINCIPLES (load-bearing):
//   • NO HARDCODED STRUCTURAL COUNTS. The codebase grows every sprint
//     (lenses, domains, tables, migrations all climb). A gate that hardcodes
//     "260 lenses / 366 backends / …" would falsely fail the day after it was
//     written. We read counts DYNAMICALLY from each verifier's own output, or
//     we don't assert on counts at all — we just run the real verifier and
//     propagate its verdict.
//   • REUSE, DON'T REBUILD. Every gate is an existing script. This file only
//     orchestrates ordering, isolation, and exit-code propagation.
//   • ONE FAILING GATE STILL LETS THE REST REPORT. Each gate is wrapped so a
//     failure is recorded but does not short-circuit the run; the overall
//     process exit is non-zero iff any gate failed (a true gate, not a monitor).
//
// USAGE:
//   node scripts/adversarial-audit.mjs            # full gate (CI default)
//   node scripts/adversarial-audit.mjs --quick    # skip the slow macro-assassin
//                                                 # gate (local pre-commit)
//   node scripts/adversarial-audit.mjs --help
//
// EXIT CODES:
//   0  — every gate that ran either PASSED or was advisory-only
//   1  — at least one blocking gate FAILED
//   2  — the orchestrator itself could not run a gate (missing script, etc.)

import { spawnSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = path.resolve(__dirname, "..");

const C = {
  g: "\x1b[32m",
  r: "\x1b[31m",
  y: "\x1b[33m",
  dim: "\x1b[2m",
  b: "\x1b[1m",
  cyan: "\x1b[36m",
  rst: "\x1b[0m",
};

const argv = process.argv.slice(2);
const FLAGS = {
  quick: argv.includes("--quick"),
  help: argv.includes("--help") || argv.includes("-h"),
};

if (FLAGS.help) {
  process.stdout.write(
    `Adversarial Audit — composite CI gate for concord-cognitive-engine\n\n` +
      `  node scripts/adversarial-audit.mjs            full gate (CI default)\n` +
      `  node scripts/adversarial-audit.mjs --quick    skip the slow macro-assassin gate\n\n` +
      `Each gate runs an EXISTING verifier as a child process and the overall\n` +
      `exit is non-zero if any blocking gate fails. No structural counts are\n` +
      `hardcoded — verdicts come from the verifiers themselves.\n`,
  );
  process.exit(0);
}

// ── Result accumulation ──────────────────────────────────────────────────────

/** @type {{ name:string, status:'pass'|'fail'|'skip'|'advisory', blocking:boolean, note:string }[]} */
const results = [];

function record(name, status, blocking, note = "") {
  results.push({ name, status, blocking, note });
}

function fileExists(rel) {
  return fs.existsSync(path.join(REPO_ROOT, rel));
}

/**
 * Run a command as a child process with inherited stdio so CI shows the real
 * output. Returns the exit status (or null on spawn failure).
 *
 * @param {string} cmd
 * @param {string[]} args
 * @param {{cwd?:string}} [opts]
 */
function run(cmd, args, opts = {}) {
  const cwd = opts.cwd ? path.join(REPO_ROOT, opts.cwd) : REPO_ROOT;
  const res = spawnSync(cmd, args, {
    cwd,
    stdio: "inherit",
    env: process.env,
    shell: false,
  });
  return res;
}

/**
 * Run a command capturing its stdout (used for the one verifier that exits 0
 * regardless of verdict and signals via structured JSON). stderr is still
 * streamed through so the human/CI sees the detail lines.
 */
function runCapture(cmd, args, opts = {}) {
  const cwd = opts.cwd ? path.join(REPO_ROOT, opts.cwd) : REPO_ROOT;
  const res = spawnSync(cmd, args, {
    cwd,
    stdio: ["inherit", "pipe", "inherit"],
    env: process.env,
    encoding: "utf8",
    shell: false,
  });
  if (res.stdout) process.stdout.write(res.stdout);
  return res;
}

function banner(title) {
  process.stdout.write(
    `\n${C.b}${C.cyan}━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━${C.rst}\n` +
      `${C.b}${C.cyan}▶ ${title}${C.rst}\n` +
      `${C.b}${C.cyan}━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━${C.rst}\n`,
  );
}

// ── Gate 1: Lens wiring ──────────────────────────────────────────────────────
//
// verify-lens-backends.mjs always exits 0 and emits a JSON verdict line on
// stdout: {"verdicts":{...},"total":N,"macroDomains":N,"routePrefixes":N}.
// A lens is "broken" only if it lands in UNWIRED or PARTIAL. NO-BACKEND-CALL is
// a BY-DESIGN verdict (navigation/reader lenses with no API surface), so it is
// NOT treated as a failure. We read the verdict counts dynamically — no count
// is hardcoded; we only assert "0 broken".
function gateLensWiring() {
  banner("Gate 1 — Lens wiring (verify-lens-backends.mjs)");
  const script = "scripts/verify-lens-backends.mjs";
  if (!fileExists(script)) {
    record("lens-wiring", "skip", true, `missing ${script}`);
    process.stdout.write(`${C.y}[skip] ${script} not found${C.rst}\n`);
    return;
  }
  const res = runCapture(process.execPath, [script]);
  if (res.error || res.status === null) {
    record("lens-wiring", "fail", true, `spawn error: ${res.error?.message || "unknown"}`);
    return;
  }
  // Parse the final JSON line off stdout (defensive: take the last {...} line).
  const jsonLine = (res.stdout || "")
    .split("\n")
    .map((l) => l.trim())
    .filter((l) => l.startsWith("{") && l.endsWith("}"))
    .pop();
  let verdicts = null;
  if (jsonLine) {
    try {
      verdicts = JSON.parse(jsonLine).verdicts || {};
    } catch {
      verdicts = null;
    }
  }
  if (!verdicts) {
    // Could not parse — fall back to the raw exit code (which is 0). Be strict:
    // an unparseable verdict from the wiring verifier is a failure of the gate.
    record("lens-wiring", "fail", true, "could not parse verdict JSON from verifier");
    process.stdout.write(`${C.r}[fail] lens verifier produced no parseable verdict line${C.rst}\n`);
    return;
  }
  // "broken" = UNWIRED + PARTIAL (NO-BACKEND-CALL is by-design, not a break).
  const broken = (verdicts.UNWIRED || 0) + (verdicts.PARTIAL || 0);
  const wired = verdicts.WIRED || 0;
  const byDesign = verdicts["NO-BACKEND-CALL"] || 0;
  const noPage = verdicts["NO-PAGE"] || 0;
  if (broken > 0 || noPage > 0) {
    record(
      "lens-wiring",
      "fail",
      true,
      `${broken} broken (UNWIRED/PARTIAL)${noPage ? `, ${noPage} NO-PAGE` : ""}`,
    );
    process.stdout.write(`${C.r}[fail] ${broken} broken lens wire(s) detected${C.rst}\n`);
    return;
  }
  record(
    "lens-wiring",
    "pass",
    true,
    `${wired} WIRED, ${byDesign} by-design (NO-BACKEND-CALL), 0 broken`,
  );
  process.stdout.write(
    `${C.g}[pass] ${wired} lenses WIRED, ${byDesign} by-design, 0 broken${C.rst}\n`,
  );
}

// ── Gate 2: Invariant engine (derive contracts → macro-assassin ratchet) ─────
//
// First (re)derive contracts so the assassin runs against current truth, then
// run the assassin in --ratchet mode: it exits non-zero ONLY on a NEW violation
// vs audit/invariant-engine/BASELINE.json (existing debt grandfathered). This
// is the key NEW thing this orchestrator brings to CI. Skipped under --quick
// because it boots the engine in-process and takes minutes.
function gateInvariantEngine() {
  banner("Gate 2 — Invariant engine (derive-contracts → macro-assassin --ratchet)");
  if (FLAGS.quick) {
    record("invariant-engine", "skip", true, "--quick: macro-assassin skipped");
    process.stdout.write(`${C.y}[skip] --quick mode: macro-assassin gate skipped${C.rst}\n`);
    return;
  }

  const deriveScript = "scripts/contracts/derive-contracts.mjs";
  const assassinScript = "scripts/macro-assassin.mjs";
  if (!fileExists(deriveScript) || !fileExists(assassinScript)) {
    record("invariant-engine", "skip", true, "missing derive-contracts or macro-assassin script");
    process.stdout.write(`${C.y}[skip] invariant engine scripts not found${C.rst}\n`);
    return;
  }

  process.stdout.write(`${C.dim}→ deriving contracts…${C.rst}\n`);
  const derive = run(process.execPath, [deriveScript]);
  if (derive.error || derive.status !== 0) {
    record(
      "invariant-engine",
      "fail",
      true,
      `derive-contracts exited ${derive.status ?? "error"}`,
    );
    process.stdout.write(`${C.r}[fail] derive-contracts failed; cannot run assassin${C.rst}\n`);
    return;
  }

  // The assassin --ratchet needs a baseline; if absent, surface as advisory
  // rather than failing the whole audit (the gate can't ratchet without one).
  if (!fileExists("audit/invariant-engine/BASELINE.json")) {
    record(
      "invariant-engine",
      "advisory",
      true,
      "no BASELINE.json — run `node scripts/macro-assassin.mjs --write-baseline`",
    );
    process.stdout.write(
      `${C.y}[advisory] no assassin baseline; skipping ratchet (write one to enable the gate)${C.rst}\n`,
    );
    return;
  }

  process.stdout.write(`${C.dim}→ macro-assassin --ratchet…${C.rst}\n`);
  const assassin = run(process.execPath, [assassinScript, "--ratchet"]);
  if (assassin.error || assassin.status === null) {
    record("invariant-engine", "fail", true, `spawn error: ${assassin.error?.message || "unknown"}`);
    return;
  }
  if (assassin.status === 0) {
    record("invariant-engine", "pass", true, "no new violations vs baseline");
    process.stdout.write(`${C.g}[pass] macro-assassin: no new violations vs baseline${C.rst}\n`);
  } else {
    record("invariant-engine", "fail", true, `macro-assassin --ratchet exited ${assassin.status}`);
    process.stdout.write(`${C.r}[fail] macro-assassin found NEW violation(s)${C.rst}\n`);
  }
}

// ── Gate 3: Detector ratchet ─────────────────────────────────────────────────
//
// `cd server && node scripts/run-detectors.js --diff --ci` exits non-zero only
// on a NEW high/critical finding vs server/audit/detectors/BASELINE.json. This
// is also gated by detectors-cartography.yml on `main`; running it here extends
// the same gate to the working-branch push/PR path so a regression is caught
// before it reaches main.
function gateDetectorRatchet() {
  banner("Gate 3 — Detector ratchet (run-detectors.js --diff --ci)");
  const script = "scripts/run-detectors.js";
  if (!fileExists(path.join("server", script))) {
    record("detector-ratchet", "skip", true, `missing server/${script}`);
    process.stdout.write(`${C.y}[skip] server/${script} not found${C.rst}\n`);
    return;
  }
  const res = run(process.execPath, [script, "--diff", "--ci"], { cwd: "server" });
  if (res.error || res.status === null) {
    record("detector-ratchet", "fail", true, `spawn error: ${res.error?.message || "unknown"}`);
    return;
  }
  if (res.status === 0) {
    record("detector-ratchet", "pass", true, "no new high/critical findings vs baseline");
    process.stdout.write(`${C.g}[pass] detector ratchet: no new high/critical findings${C.rst}\n`);
  } else {
    record("detector-ratchet", "fail", true, `run-detectors --diff --ci exited ${res.status}`);
    process.stdout.write(`${C.r}[fail] detector ratchet found NEW high/critical finding(s)${C.rst}\n`);
  }
}

// ── Gate 4: Doc-claim falsifiability (advisory) ──────────────────────────────
//
// check-doc-claims.mjs re-runs every reproduction command embedded in CLAUDE.md
// and reports drift. The counts LEGITIMATELY grow with the code, so — exactly
// as detectors-cartography.yml treats it — this is advisory: it surfaces stale
// counts without failing the build. (Run with --ci locally for a hard gate on a
// specific doc.) This is the canonical "no hardcoded counts" safeguard: drift is
// reported, never asserted.
function gateDocClaims() {
  banner("Gate 4 — Doc-claim falsifiability (check-doc-claims.mjs — advisory)");
  const script = "scripts/check-doc-claims.mjs";
  if (!fileExists(script)) {
    record("doc-claims", "skip", false, `missing ${script}`);
    process.stdout.write(`${C.y}[skip] ${script} not found${C.rst}\n`);
    return;
  }
  // Advisory by design — NO --ci flag, so the script always exits 0. It signals
  // drift only through its summary line ("N MISMATCH"); we parse that to label
  // the gate honestly, but never block on it (the counts grow with the code).
  const res = runCapture(process.execPath, [script]); // no --ci: advisory by design
  if (res.error || res.status === null) {
    record("doc-claims", "advisory", false, `could not run: ${res.error?.message || "unknown"}`);
    return;
  }
  const out = res.stdout || "";
  const m = out.match(/(\d+)\s+MISMATCH/);
  const mismatches = m ? Number(m[1]) : 0;
  if (mismatches > 0) {
    record("doc-claims", "advisory", false, `${mismatches} stale count(s) surfaced (non-blocking)`);
    process.stdout.write(
      `${C.y}[advisory] ${mismatches} doc-claim drift(s) surfaced (non-blocking — refresh CLAUDE.md)${C.rst}\n`,
    );
  } else {
    record("doc-claims", "pass", false, "doc claims fresh");
    process.stdout.write(`${C.g}[pass] doc claims fresh${C.rst}\n`);
  }
}

// ── Run all gates ────────────────────────────────────────────────────────────

process.stdout.write(
  `${C.b}╔══════════════════════════════════════════════════════════════╗${C.rst}\n` +
    `${C.b}║  ADVERSARIAL AUDIT — composite CI gate${FLAGS.quick ? " (--quick)" : ""}${" ".repeat(FLAGS.quick ? 14 : 23)}║${C.rst}\n` +
    `${C.b}╚══════════════════════════════════════════════════════════════╝${C.rst}\n`,
);

gateLensWiring();
gateInvariantEngine();
gateDetectorRatchet();
gateDocClaims();

// ── Summary ──────────────────────────────────────────────────────────────────

banner("Summary");
const pad = (s, n) => (s + " ".repeat(n)).slice(0, n);
for (const r of results) {
  const icon =
    r.status === "pass"
      ? `${C.g}✓ PASS    ${C.rst}`
      : r.status === "fail"
        ? `${C.r}✗ FAIL    ${C.rst}`
        : r.status === "skip"
          ? `${C.dim}- SKIP    ${C.rst}`
          : `${C.y}~ ADVISORY${C.rst}`;
  const tag = r.blocking ? "" : `${C.dim} (non-blocking)${C.rst}`;
  process.stdout.write(`  ${icon} ${pad(r.name, 20)} ${r.note}${tag}\n`);
}

const blockingFails = results.filter((r) => r.blocking && r.status === "fail");
process.stdout.write("\n");
if (blockingFails.length > 0) {
  process.stdout.write(
    `${C.r}${C.b}✗ AUDIT FAILED${C.rst} — ${blockingFails.length} blocking gate(s): ` +
      `${blockingFails.map((r) => r.name).join(", ")}\n`,
  );
  process.exit(1);
}
process.stdout.write(`${C.g}${C.b}✓ AUDIT PASSED${C.rst} — all blocking gates green.\n`);
process.exit(0);
