// server/tests/age-gate.test.js
//
// Contract test for the shared 18+ age-gate math used by both sign-up paths
// (password register + OAuth confirm-age). Pins the boundary behavior so the
// two paths can't silently diverge.

import { test } from "node:test";
import assert from "node:assert/strict";
import { ageFromDob, isAdult, MIN_AGE } from "../lib/age-gate.js";

function isoYearsAgo(years, offsetDays = 0) {
  const d = new Date();
  d.setUTCFullYear(d.getUTCFullYear() - years);
  d.setUTCDate(d.getUTCDate() + offsetDays);
  return d.toISOString().slice(0, 10);
}

test("MIN_AGE is 18", () => {
  assert.equal(MIN_AGE, 18);
});

test("ageFromDob rejects invalid / empty / non-string input", () => {
  assert.equal(ageFromDob(""), null);
  assert.equal(ageFromDob("not-a-date"), null);
  assert.equal(ageFromDob(null), null);
  assert.equal(ageFromDob(undefined), null);
  assert.equal(ageFromDob(19900101), null);
});

test("ageFromDob rejects future and absurd dates", () => {
  assert.equal(ageFromDob(isoYearsAgo(-1)), null, "future date");
  assert.equal(ageFromDob("1850-01-01"), null, "older than 120y");
});

test("ageFromDob computes whole years, birthday-aware", () => {
  // Exactly 30 years ago today → 30.
  assert.equal(ageFromDob(isoYearsAgo(30)), 30);
  // 30 years ago but birthday is tomorrow → still 29.
  assert.equal(ageFromDob(isoYearsAgo(30, 1)), 29);
  // 30 years ago and birthday was yesterday → 30.
  assert.equal(ageFromDob(isoYearsAgo(30, -1)), 30);
});

test("isAdult gates exactly at 18", () => {
  assert.equal(isAdult(isoYearsAgo(18)), true, "exactly 18 today passes");
  assert.equal(isAdult(isoYearsAgo(18, 1)), false, "turns 18 tomorrow fails");
  assert.equal(isAdult(isoYearsAgo(17)), false, "17 fails");
  assert.equal(isAdult(isoYearsAgo(40)), true, "40 passes");
  assert.equal(isAdult(""), false, "invalid fails closed");
  assert.equal(isAdult(isoYearsAgo(-5)), false, "future fails closed");
});
