// server/tests/conkay-honest-motion-gate.test.js
//
// Bidirectional pinning test for the standalone ConKay honest-hologram motion
// gate (scripts/check-conkay-honest-motion.mjs — the "Honest-hologram motion"
// row of docs/CONTENT_INTEGRITY_SWEEP.md).
//
// The gate mechanizes ConKay's flagship rule
// (docs/CONKAY_HONEST_HOLOGRAM_PLAN.md §"Honesty invariant (code rule)"): every
// animated element is a pure function of a real backend event; NO
// setInterval/setTimeout may drive "work"/progress animation.
//
// Pins that the gate:
//   (a) PASSES on the current allowlisted tree — 0 un-allowlisted timers,
//   (b) CATCHES a real setInterval work-animation driver (tmp fixture file),
//   (c) does NOT flag prose comments that merely NAME the tokens,
//   (d) does NOT go blind on a regex literal carrying a stray quote/backtick
//       (the false-negative class the scanner was hardened against),
//   (e) keeps the allowlist HONEST — every allowlist entry matches a real
//       current timer (no phantom / stale blanket exemptions).
//
// A regression in EITHER direction (gate goes blind, or gate goes noisy) turns
// this red — the anti-goalpost-move contract from CLAUDE.md §4.

import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import {
  findTimers,
  isAllowlisted,
  blankCommentsAndStrings,
  scan,
  ALLOWLIST,
} from "../../scripts/check-conkay-honest-motion.mjs";

// --- (a) the gate PASSES on the current allowlisted tree ---------------------

test("(a) gate is GREEN on the current tree — 0 un-allowlisted ConKay timers", () => {
  const { filesScanned, timersFound, rows } = scan();
  assert.ok(filesScanned > 0, "should scan at least one ConKay source file");
  const violations = rows.filter((r) => !r.allowlisted);
  assert.equal(violations.length, 0, `expected 0 violations, got:\n${violations.map((v) => `  ${v.file}:${v.line} ${v.lineText}`).join("\n")}`);
  // Every current timer is real and covered — the known UX-teardown set.
  assert.equal(timersFound, rows.filter((r) => r.allowlisted).length);
});

// --- (b) the gate CATCHES a real setInterval work-animation driver -----------

test("(b) flags a real setInterval work-animation driver (tmp fixture file)", () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "conkay-motion-"));
  const fixture = path.join(dir, "FakeProgressPanel.tsx");
  try {
    // A textbook honesty violation: a timer eased-incrementing a fake progress
    // percentage — exactly what the ConKay rule forbids.
    fs.writeFileSync(
      fixture,
      [
        "export function FakeProgressPanel() {",
        "  const [pct, setPct] = useState(0);",
        "  useEffect(() => {",
        "    const id = setInterval(() => setPct((p) => Math.min(100, p + 3)), 120);",
        "    return () => clearInterval(id);",
        "  }, []);",
        "  return <div>{pct}%</div>;",
        "}",
        "",
      ].join("\n"),
      "utf8"
    );
    const src = fs.readFileSync(fixture, "utf8");
    const hits = findTimers(src);
    const drivers = hits.filter((h) => h.kind === "setInterval");
    assert.equal(drivers.length, 1, "the setInterval work-driver must be detected");
    // And it is NOT covered by the allowlist (fixture file is not an entry).
    assert.equal(
      isAllowlisted("tmp/FakeProgressPanel.tsx", drivers[0].lineText),
      false,
      "a fresh work-driver must not be allowlisted — this is what makes --ci fail"
    );
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test("(b2) a NEW un-snippeted timer in an ALREADY-allowlisted file still fails", () => {
  // The allowlist keys on (file, snippet) — so a different timer added to a
  // file that already has an allowlisted timer is NOT auto-exempt.
  const allowlistedFile = ALLOWLIST[0].file;
  const rogueLine = "const id = setInterval(() => tick(), 16); // fake spinner";
  assert.equal(
    isAllowlisted(allowlistedFile, rogueLine),
    false,
    "a new timer line in an allowlisted file must not inherit the exemption"
  );
});

// --- (c) prose comments naming the tokens are NOT flagged --------------------

test("(c) a comment that merely names setInterval/setTimeout is not a timer", () => {
  const src = [
    "// No setInterval, no fake progress — the spinner spins IFF work>0.",
    "/* never a setTimeout here */",
    "const spin = workCount > 0;",
  ].join("\n");
  assert.deepEqual(findTimers(src), []);
});

test("(c2) even a comment containing the token WITH a paren is not flagged", () => {
  const src = "// avoid setTimeout( ) here — use rAF bound to store state\nconst x = 1;";
  assert.deepEqual(findTimers(src), []);
});

test("(c3) the token inside a string literal is not flagged", () => {
  const src = 'const msg = "do not call setInterval(...) in a render path";';
  assert.deepEqual(findTimers(src), []);
});

// --- (d) the scanner does NOT go blind on regex literals ---------------------

test("(d) a regex literal with a stray backtick/quote does not mask a later timer", () => {
  // This is the exact shape from useConKayVoice.ts (`.replace(/[#*_`+"`"+`>]/g,'')`)
  // that broke a naive string tracker and hid the real setTimeout calls below it.
  const src = [
    "const clean = text",
    "  .replace(/```viz[\\s\\S]*?```/gi, '')",
    "  .replace(/[#*_`>]/g, '')",
    "  .replace(/\\[(.*?)\\]\\(.*?\\)/g, '$1');",
    "onEnd(() => { setTimeout(() => rearm(), 250); });",
  ].join("\n");
  const hits = findTimers(src);
  assert.equal(hits.length, 1, "the real setTimeout after the regexes must be found");
  assert.equal(hits[0].kind, "setTimeout");
  assert.match(hits[0].lineText, /rearm\(\), 250/);
});

test("(d2) division operators are not mistaken for regex (no over-blanking)", () => {
  const src = "const r = a / b;\nsetTimeout(() => go(), 100);";
  const hits = findTimers(src);
  assert.equal(hits.length, 1);
  assert.equal(hits[0].kind, "setTimeout");
});

test("(d3) blankCommentsAndStrings preserves line count + column-safe blanking", () => {
  const src = "line1 // c\nsetInterval(f, 9)\n`tmpl`";
  const blanked = blankCommentsAndStrings(src);
  assert.equal(blanked.split("\n").length, src.split("\n").length, "line count preserved");
  assert.ok(blanked.includes("setInterval(f, 9)"), "real code on its own line is untouched");
});

// --- (e) the allowlist stays HONEST (narrow, no dead entries) ----------------

test("(e) every allowlist entry corresponds to a real current timer", () => {
  const { rows } = scan();
  for (const entry of ALLOWLIST) {
    const matched = rows.some(
      (r) => r.file === entry.file && r.lineText.includes(entry.snippet) && r.allowlisted
    );
    assert.ok(
      matched,
      `allowlist entry is stale (matches no current timer): ${entry.file} :: "${entry.snippet}"`
    );
  }
});

test("(e2) every allowlist entry carries a non-empty reason", () => {
  for (const entry of ALLOWLIST) {
    assert.equal(typeof entry.reason, "string");
    assert.ok(entry.reason.trim().length > 10, `entry needs a real reason: ${entry.snippet}`);
  }
});
