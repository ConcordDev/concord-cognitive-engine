// GB-1539 BOUNDS POLICY — the one input-limits module (server/lib/bounds.js).
// The over-limit 400 IS the test surface: every checker is pinned at the
// boundary (at-limit passes, one past refuses with invalid_input and the
// limit named in the message, negatives refuse, nothing is ever coerced).
// The client mirror (concord-frontend/lib/bounds.ts) is pinned to the same
// constants so the mirror cannot drift silently.
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import {
  BOUNDS,
  checkText,
  checkTitle,
  checkPercent,
  checkQuantity,
  checkMoney,
  checkNumber,
  checkDuration,
  checkList,
  firstBoundsFailure,
} from "../lib/bounds.js";

function assertRefusal(r, field) {
  assert.equal(r.ok, false);
  assert.equal(r.error, "invalid_input"); // -> HTTP 400 in lens-run-http
  assert.equal(r.field, field);
  assert.match(r.reason, /^bounds_/);
  assert.ok(r.message.length > 0, "message must name the limit in words");
}

test("text classes: at-limit passes, one past refuses, absent passes", () => {
  assert.equal(checkTitle("name", "x".repeat(200)), null);
  const r = checkTitle("name", "x".repeat(201));
  assertRefusal(r, "name");
  assert.match(r.message, /200 characters/);
  assert.equal(checkText("notes", "x".repeat(5000), "note"), null);
  assertRefusal(checkText("notes", "x".repeat(5001), "note"), "notes");
  assert.equal(checkText("body", "x".repeat(5000), "post"), null);
  assertRefusal(checkText("body", "x".repeat(5001), "post"), "body");
  assert.equal(checkText("content", "x".repeat(50000), "doc"), null);
  assertRefusal(checkText("content", "x".repeat(50001), "doc"), "content");
  assert.equal(checkTitle("name", undefined), null);
  assert.equal(checkTitle("name", null), null);
  assertRefusal(checkTitle("name", 42), "name"); // non-text refuses, never coerces
});

test("percent: 0 and 100 pass, -1 and 101 refuse", () => {
  assert.equal(checkPercent("coupon", 0), null);
  assert.equal(checkPercent("coupon", 100), null);
  assertRefusal(checkPercent("coupon", -1), "coupon");
  assertRefusal(checkPercent("coupon", 500), "coupon");
});

test("quantity / money / number: negatives and over-cap refuse, caps pass", () => {
  assert.equal(checkQuantity("affectedCount", 10000), null);
  assertRefusal(checkQuantity("affectedCount", 10001), "affectedCount");
  assertRefusal(checkQuantity("affectedCount", -1), "affectedCount"); // cri-008: -1 must NOT become 1
  assert.equal(checkMoney("cost", 1000000), null);
  assertRefusal(checkMoney("cost", 1000001), "cost");
  assertRefusal(checkMoney("cost", -5), "cost"); // fashion-006
  assertRefusal(checkMoney("cost", 99999999999), "cost");
  assert.equal(checkNumber("cell", 1000000), null);
  assertRefusal(checkNumber("cell", -1), "cell"); // docs-007
  assertRefusal(checkNumber("cell", 99999999999), "cell");
  assertRefusal(checkNumber("cell", NaN), "cell"); // non-finite refuses, never rewrites to 0
  assertRefusal(checkNumber("cell", Infinity), "cell");
});

test("duration: 10 years in the caller's unit is the cap", () => {
  assert.equal(checkDuration("daysToImplement", 3650, "days"), null);
  assertRefusal(checkDuration("daysToImplement", 3651, "days"), "daysToImplement"); // suffering-010
  assert.equal(checkDuration("minutes", 5256000, "minutes"), null);
  assertRefusal(checkDuration("minutes", -1, "minutes"), "minutes"); // attention-002
  assertRefusal(checkDuration("minutes", 999999999, "minutes"), "minutes");
  assert.equal(checkDuration("trialDays", 3650, "days"), null);
  assertRefusal(checkDuration("trialDays", -3, "days"), "trialDays"); // billing-006
});

test("list: 500 items pass, 501 refuse", () => {
  assert.equal(checkList("items", new Array(500).fill(0)), null);
  assertRefusal(checkList("items", new Array(501).fill(0)), "items");
  assertRefusal(checkList("items", "not-a-list"), "items");
});

test("firstBoundsFailure returns the first refusal only", () => {
  assert.equal(firstBoundsFailure(null, null), null);
  const a = checkTitle("name", "x".repeat(300));
  const b = checkQuantity("count", -1);
  assert.equal(firstBoundsFailure(null, a, b), a);
  assert.equal(firstBoundsFailure(b, a), b);
});

test("the ruled constant values are the founder's numbers", () => {
  assert.equal(BOUNDS.TITLE, 200);
  assert.equal(BOUNDS.NOTE, 5000);
  assert.equal(BOUNDS.POST, 5000);
  assert.equal(BOUNDS.DOC, 50000);
  assert.equal(BOUNDS.PERCENT_MAX, 100);
  assert.equal(BOUNDS.QUANTITY_MAX, 10000);
  assert.equal(BOUNDS.MONEY_MAX, 1000000);
  assert.equal(BOUNDS.DURATION_YEARS, 10);
  assert.equal(BOUNDS.LIST_MAX, 500);
});

test("client mirror constants agree with the server policy", () => {
  const fePath = fileURLToPath(new URL("../../concord-frontend/lib/bounds.ts", import.meta.url));
  const src = readFileSync(fePath, "utf8");
  for (const [key, value] of Object.entries(BOUNDS)) {
    const m = src.match(new RegExp(`${key}:\\s*(\\d+)`));
    assert.ok(m, `client mirror is missing BOUNDS.${key}`);
    assert.equal(Number(m[1]), value, `client mirror BOUNDS.${key} drifted from the server policy`);
  }
});
