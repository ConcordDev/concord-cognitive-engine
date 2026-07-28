// server/tests/constant-time-compare.test.js
//
// Pins server/lib/constant-time-compare.js and the call sites it replaced
// (2026-07-27 Aikido triage, "timing-unsafe comparison" class).
//
// Two distinct defects were fixed, and the SECOND is the one worth protecting
// hardest because the vulnerable code looks like the secure version:
//
//   1. Raw `===` against a secret (webhook-auth bearer/query paths,
//      telegram verifyIncoming, whatsapp verification challenge).
//   2. Bare `crypto.timingSafeEqual(Buffer.from(a), Buffer.from(b))`, which
//      THROWS a RangeError on a length mismatch. A caller sending a
//      wrong-length signature turned an auth failure into an unhandled
//      exception — a 500 rather than a clean rejection. Present in
//      webhook-auth's HMAC path and in the whatsapp adapter (slack had the
//      same shape but a surrounding try/catch absorbed it, so it was correct
//      by accident rather than by construction).
//
// Run: node --test server/tests/constant-time-compare.test.js

import { describe, it } from "node:test";
import assert from "node:assert/strict";
import crypto from "node:crypto";
import { timingSafeCompare } from "../lib/constant-time-compare.js";

describe("timingSafeCompare — correctness", () => {
  it("returns true for identical non-empty strings", () => {
    assert.equal(timingSafeCompare("s3cr3t-value", "s3cr3t-value"), true);
    assert.equal(timingSafeCompare("a", "a"), true);
  });

  it("returns false for different strings of equal length", () => {
    assert.equal(timingSafeCompare("secretA", "secretB"), false);
  });

  it("returns false for a one-character difference", () => {
    assert.equal(timingSafeCompare("sha256=abcdef", "sha256=abcdee"), false);
  });

  it("is not prefix-tolerant (a correct prefix is still a rejection)", () => {
    assert.equal(timingSafeCompare("secret", "secret-longer"), false);
    assert.equal(timingSafeCompare("secret-longer", "secret"), false);
  });

  it("handles multi-byte UTF-8 without throwing or false-matching", () => {
    assert.equal(timingSafeCompare("secret-ünïcödé", "secret-ünïcödé"), true);
    assert.equal(timingSafeCompare("secret-ünïcödé", "secret-unicode"), false);
  });
});

describe("timingSafeCompare — never throws (the defect that caused 500s)", () => {
  const MISMATCHED = [
    ["much longer vs short", "a".repeat(500), "b"],
    ["short vs much longer", "b", "a".repeat(500)],
    ["empty vs non-empty", "", "secret"],
    ["non-empty vs empty", "secret", ""],
    ["both empty", "", ""],
  ];

  for (const [label, a, b] of MISMATCHED) {
    it(`returns false instead of throwing: ${label}`, () => {
      let out;
      assert.doesNotThrow(() => { out = timingSafeCompare(a, b); });
      assert.equal(out, false);
    });
  }

  it("the raw idiom it replaced DOES throw on a length mismatch", () => {
    // Documents why the helper exists. If a future refactor reverts a call
    // site to the bare form, this is the behaviour it reintroduces.
    assert.throws(
      () => crypto.timingSafeEqual(Buffer.from("short"), Buffer.from("much-longer")),
      /length/i
    );
  });

  it("rejects non-string input rather than coercing it", () => {
    for (const v of [null, undefined, 0, 42, {}, [], true, Buffer.from("x")]) {
      assert.equal(timingSafeCompare(v, "secret"), false, `${String(v)} as a`);
      assert.equal(timingSafeCompare("secret", v), false, `${String(v)} as b`);
    }
  });

  it("an object with a matching toString cannot impersonate the secret", () => {
    const evil = { toString: () => "the-real-secret" };
    assert.equal(timingSafeCompare(evil, "the-real-secret"), false);
  });
});

describe("call sites no longer use a raw comparison on secret material", () => {
  const files = [
    "../lib/webhook-auth.js",
    "../lib/messaging/adapters/telegram.js",
    "../lib/messaging/adapters/whatsapp.js",
    "../lib/messaging/adapters/slack.js",
  ];

  it("no `=== <SECRET>` comparison survives in the webhook/auth surface", async () => {
    const { readFileSync } = await import("node:fs");
    const { fileURLToPath } = await import("node:url");
    const path = await import("node:path");
    const here = path.dirname(fileURLToPath(import.meta.url));

    const offenders = [];
    for (const rel of files) {
      const src = readFileSync(path.join(here, rel), "utf8");
      for (const [i, line] of src.split("\n").entries()) {
        if (line.trim().startsWith("//")) continue; // comments may name the old idiom
        if (/===\s*(WEBHOOK_SECRET|GLOBAL_SECRET|domainSecret|SIGNING_SECRET|BOT_TOKEN)\b/.test(line)) {
          offenders.push(`${rel}:${i + 1}`);
        }
        // The bare two-buffer form is the throw hazard.
        if (/timingSafeEqual\(\s*Buffer\.from/.test(line)) {
          offenders.push(`${rel}:${i + 1} (bare timingSafeEqual)`);
        }
      }
    }
    assert.deepEqual(offenders, [], "raw secret comparisons remain");
  });
});
