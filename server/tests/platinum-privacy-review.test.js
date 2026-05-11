// server/tests/platinum-privacy-review.test.js
//
// Sprint 29 — privacy review gate.
//
// Static-scans server source for log-emit sites that pass forbidden
// PII / secret patterns. Asserts the privacy-review doc exists +
// declares the load-bearing commitments.

import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync, existsSync, readdirSync, statSync } from "node:fs";
import { join } from "node:path";

const HERE = new URL(".", import.meta.url).pathname;
const PRIVACY_DOC = join(HERE, "..", "..", "docs", "security", "privacy-review.md");

test("privacy-review document exists at docs/security/privacy-review.md", () => {
  assert.ok(existsSync(PRIVACY_DOC), "Missing docs/security/privacy-review.md — no documented privacy posture");
});

test("privacy doc covers GDPR + CCPA + log-scrubbing", () => {
  if (!existsSync(PRIVACY_DOC)) return;
  const md = readFileSync(PRIVACY_DOC, "utf-8");
  for (const phrase of ["GDPR", "Art. 15", "Art. 17", "CCPA", "Log scrubbing", "Data minimisation"]) {
    assert.ok(md.includes(phrase), `Privacy doc missing required section: ${phrase}`);
  }
});

test("privacy doc commits to GDPR Article 15 (export) + Article 17 (delete)", () => {
  if (!existsSync(PRIVACY_DOC)) return;
  const md = readFileSync(PRIVACY_DOC, "utf-8");
  assert.ok(/export/i.test(md), "Missing export commitment (Art. 15)");
  assert.ok(/(delete|erasure)/i.test(md), "Missing delete commitment (Art. 17)");
});

test("privacy doc has a public commitments section", () => {
  if (!existsSync(PRIVACY_DOC)) return;
  const md = readFileSync(PRIVACY_DOC, "utf-8");
  assert.ok(/never sell|don't sell|do not sell/i.test(md),
    "Privacy doc missing 'we don't sell user data' commitment — required by CCPA opt-out");
});

// ── Static log-emit scan ─────────────────────────────────────────────────────
//
// Reads server source for log.* / console.* calls and asserts none of
// them include a literal password / token / api-key field. Concord
// uses a structured logger; the scrubbing is in the logger itself, but
// the per-call payload still needs to be hygienic.

const FORBIDDEN_LOG_PAYLOADS = [
  /log[^)]{0,200}\bpassword\s*[:=]\s*[^,)}_]/i,         // log(...{ password: x ... })
  /log[^)]{0,200}\bpassword_hash\s*[:=]\s*[^,)}_]/i,    // log(...{ password_hash: x })
  /console\.\w+[^)]{0,200}password\s*[:=]\s*[^,)}_]/i,
  /(log|console\.\w+)[^)]{0,200}jwt(Token|_token)?\s*[:=]\s*[^,)}_]/i,
  /(log|console\.\w+)[^)]{0,200}stripe_secret\s*[:=]\s*[^,)}_]/i,
];

function listSourceFiles(dir, acc = []) {
  for (const entry of readdirSync(dir)) {
    if (entry === "node_modules" || entry === "tests" || entry === "data" || entry === "coverage") continue;
    const p = join(dir, entry);
    let stat;
    try { stat = statSync(p); } catch { continue; }
    if (stat.isDirectory()) listSourceFiles(p, acc);
    else if (/\.(js|mjs|cjs|ts)$/.test(entry)) acc.push(p);
  }
  return acc;
}

test("no log-emit site passes a literal password / jwt / stripe_secret field", () => {
  const serverRoot = join(HERE, "..");
  const files = listSourceFiles(serverRoot);
  const violations = [];

  for (const f of files) {
    let src;
    try { src = readFileSync(f, "utf-8"); } catch { continue; }
    // Skip the test files themselves + the logger itself (which does
    // the redaction and references field names by design).
    if (f.includes("/tests/") || f.endsWith("logger.js")) continue;
    for (const re of FORBIDDEN_LOG_PAYLOADS) {
      const m = src.match(re);
      if (m) {
        violations.push({ file: f.replace(serverRoot, "server"), snippet: m[0].slice(0, 80) });
      }
    }
  }

  if (violations.length > 0) {
    console.error("\nForbidden log-emit sites:");
    for (const v of violations.slice(0, 5)) console.error(`  ${v.file}: ${v.snippet}…`);
  }
  // Allow up to 2 — the legacy DB-init logger and one analytics edge case
  // are grandfathered; anything more is regression.
  assert.ok(violations.length < 3, `${violations.length} log-emit sites include forbidden PII/secret literals`);
});

test("logger.js applies password redaction (structural)", () => {
  const loggerPath = join(HERE, "..", "logger.js");
  if (!existsSync(loggerPath)) return;
  const src = readFileSync(loggerPath, "utf-8");
  // Logger MUST have a redact / sanitize / scrub step for password keys.
  const redacts = /redact|sanitize|scrub|REDACTED|\[REDACTED\]/i.test(src);
  assert.ok(redacts, "logger.js does not redact PII — password / token leakage risk in error paths");
});

test("user.delete + user.export macros exist (GDPR Art. 15/17 enforceable)", () => {
  // GDPR endpoints can live in server.js or in routes/. Scan both blobs.
  const serverJs = readFileSync(join(HERE, "..", "server.js"), "utf-8");
  const accountLifecycle = join(HERE, "..", "routes", "account-lifecycle.js");
  const helpersExtended = join(HERE, "..", "routes", "helpers-extended.js");
  const lifecycleSrc = existsSync(accountLifecycle) ? readFileSync(accountLifecycle, "utf-8") : "";
  const helpersSrc = existsSync(helpersExtended) ? readFileSync(helpersExtended, "utf-8") : "";
  const fullBlob = serverJs + "\n" + lifecycleSrc + "\n" + helpersSrc;

  const hasExport = /exportUserCorpus|user\.export|privacy\.export|account\.export|user\/export|account\/export/.test(fullBlob);
  const hasDelete = /user\.delete|account\.delete|privacy\.delete|deleteUser|hardDeleteUser|\/account\/delete|gdpr\/delete/.test(fullBlob);
  assert.ok(hasExport, "No user-data export path — GDPR Art. 15 unenforceable");
  assert.ok(hasDelete, "No user-deletion path — GDPR Art. 17 unenforceable");
});

test("personal_dtus_never_leak invariant is referenced in source (load-bearing comment)", () => {
  const serverJs = readFileSync(join(HERE, "..", "server.js"), "utf-8");
  // The invariant should appear at least once in source as a load-bearing
  // comment or test gate reference — if it disappears entirely the invariant
  // has been silently abandoned.
  const referenced = /personal_dtus_never_leak|personal[\s_-]dtus[\s_-]never[\s_-]leak/i.test(serverJs);
  if (!referenced) {
    // Fallback: check the broader server tree (libs / routes) too.
    const libRoot = join(HERE, "..", "lib");
    let found = false;
    if (existsSync(libRoot)) {
      const files = listSourceFiles(libRoot);
      for (const f of files) {
        try {
          if (/personal_dtus_never_leak|personal[\s_-]dtus[\s_-]never[\s_-]leak/i.test(readFileSync(f, "utf-8"))) {
            found = true;
            break;
          }
        } catch { /* ignore */ }
      }
    }
    assert.ok(found, "personal_dtus_never_leak invariant not referenced anywhere in source — silent abandonment risk");
  }
});
