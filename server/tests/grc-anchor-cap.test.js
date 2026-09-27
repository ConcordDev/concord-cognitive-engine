// server/tests/grc-anchor-cap.test.js — the GRC prompt names a handful of
// anchors, never the whole focus set (a chat turn once shipped ~700 titles,
// ~11K tokens, in this one line).
import { test } from "node:test";
import assert from "node:assert/strict";
import { formatAnchors, getGRCSystemPrompt } from "../grc/formatter.js";

test("empty → general-context", () => {
  assert.equal(formatAnchors([]), "DTUs: [general-context]");
  assert.equal(formatAnchors(undefined), "DTUs: [general-context]");
});

test("small lists pass through in order", () => {
  assert.equal(formatAnchors(["Beam theory", "Euler buckling"]), "DTUs: [Beam theory, Euler buckling]");
});

test("large lists are capped with an honest remainder count", () => {
  const titles = Array.from({ length: 700 }, (_, i) => `A fairly long knowledge unit title number ${i} about constraints and frameworks`);
  const s = formatAnchors(titles);
  assert.ok(s.startsWith("DTUs: [A fairly long knowledge unit title number 0"));
  assert.ok(s.includes("+688 more in the lattice"));
  assert.ok(s.length < 1400, `anchor line is ${s.length} chars`);
  assert.ok(getGRCSystemPrompt({ dtus: titles }).length < 6000);
});

test("very long titles are shortened", () => {
  const s = formatAnchors(["x".repeat(500)]);
  assert.ok(s.length < 110);
});
