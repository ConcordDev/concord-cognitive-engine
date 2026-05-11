// server/tests/platinum-threat-model.test.js
//
// Sprint 27 — STRIDE threat model gate.
//
// Asserts the threat model doc exists, covers the 13 subsystems, and
// addresses all 6 STRIDE classes. Catches the "we audited once and the
// doc rotted" failure mode — every CI run reads the current doc.

import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync, existsSync } from "node:fs";
import { join } from "node:path";

const HERE = new URL(".", import.meta.url).pathname;
const THREAT_MODEL_PATH = join(HERE, "..", "..", "docs", "security", "threat-model.md");

test("STRIDE threat model document exists", () => {
  assert.ok(existsSync(THREAT_MODEL_PATH), "docs/security/threat-model.md missing — no documented threat model");
});

test("threat model covers all 6 STRIDE classes", () => {
  if (!existsSync(THREAT_MODEL_PATH)) return;
  const md = readFileSync(THREAT_MODEL_PATH, "utf-8");
  for (const word of ["Spoofing", "Tampering", "Repudiation", "Information disclosure", "Denial of service", "Elevation of privilege"]) {
    assert.ok(md.includes(word), `STRIDE class missing from threat model: ${word}`);
  }
});

test("threat model covers each critical subsystem", () => {
  if (!existsSync(THREAT_MODEL_PATH)) return;
  const md = readFileSync(THREAT_MODEL_PATH, "utf-8").toLowerCase();

  // Required subsystems — these MUST appear by name in the doc.
  const required = [
    "auth",
    "marketplace",
    "royalty",
    "dtu substrate",
    "federation",
    "brain",          // brain / LLM router
    "ssrf",
    "path injection",
    "prototype",      // prototype pollution
    "heartbeat",
    "mobile",
    "webhook",
    "sovereign",
  ];
  const missing = required.filter(k => !md.includes(k));
  assert.equal(missing.length, 0, `Threat model missing subsystem(s): ${missing.join(", ")}`);
});

test("threat model has a trust boundaries section", () => {
  if (!existsSync(THREAT_MODEL_PATH)) return;
  const md = readFileSync(THREAT_MODEL_PATH, "utf-8");
  assert.ok(/trust boundaries/i.test(md), "Missing 'trust boundaries' — STRIDE without boundaries is incomplete");
});

test("threat model has a risk acceptance log", () => {
  if (!existsSync(THREAT_MODEL_PATH)) return;
  const md = readFileSync(THREAT_MODEL_PATH, "utf-8");
  // Accepted risks must be documented so they don't surprise the next reviewer.
  assert.ok(/risk acceptance/i.test(md), "Missing 'Risk acceptance log' — undocumented accepted risks rot in commit history");
});

test("threat model declares a re-review trigger policy", () => {
  if (!existsSync(THREAT_MODEL_PATH)) return;
  const md = readFileSync(THREAT_MODEL_PATH, "utf-8");
  assert.ok(/re-review trigger/i.test(md), "Missing 're-review triggers' — without this the doc rots silently");
});

test("threat model has a Last updated date within the last 365 days (advisory)", () => {
  if (!existsSync(THREAT_MODEL_PATH)) return;
  const md = readFileSync(THREAT_MODEL_PATH, "utf-8");
  // Tolerate markdown bold (`**Last updated:**`) plus optional whitespace.
  const m = md.match(/Last updated[:*\s]+(\d{4}-\d{2}-\d{2})/);
  if (!m) {
    assert.fail("Missing 'Last updated: YYYY-MM-DD' line — review-freshness invisible");
    return;
  }
  const updated = new Date(m[1]);
  const ageDays = (Date.now() - updated.getTime()) / 86400000;
  // Advisory only — warn if stale, hard-fail only if truly ancient.
  if (ageDays > 365) {
    console.warn(`  ⚠ threat model last updated ${Math.round(ageDays)} days ago — consider a re-review`);
  }
  assert.ok(ageDays < 730, `Threat model last updated ${Math.round(ageDays)} days ago — stale beyond 2 years`);
});
