import { test } from "node:test";
import assert from "node:assert/strict";
import {
  classifyGrounding, collectWebSources, assessGrounding, stampGrounding, verifyReproducible,
} from "../lib/dtu-grounding.js";

test("empirical claim WITH a web source is grounded", () => {
  const dtu = { kind: "research", meta: { sources: [{ url: "https://arxiv.org/abs/1234.5678" }] } };
  const a = assessGrounding(dtu);
  assert.equal(a.kind, "empirical");
  assert.equal(a.grounded, true);
  assert.equal(a.webSources.length, 1);
});

test("empirical claim with ONLY internal citations is NOT grounded (confidence laundering)", () => {
  const dtu = { kind: "claim", meta: { citations: [{ sourceDtuId: "dtu_abc" }] }, claimAnnotations: [{ text: "x", type: "fact", support: ["dtu_abc"] }] };
  const a = assessGrounding(dtu);
  assert.equal(a.grounded, false);
  assert.deepEqual(a.gaps, ["needs_web_sources"]);
  assert.equal(a.confidenceCap, 0.4);
});

test("creative gen with a REPRODUCIBLE executable is grounded", () => {
  const dtu = { kind: "formula", machine: { executable: { expr: "2+2", expected: 4 } } };
  const runners = { formula: (e) => (e === "2+2" ? 4 : NaN) };
  const a = assessGrounding(dtu, runners);
  assert.equal(a.kind, "creative");
  assert.equal(a.grounded, true);
  assert.equal(a.reproduced.stable, true);
  assert.equal(a.reproduced.matchesExpected, true);
});

test("creative gen that is NON-deterministic is NOT reproducible", () => {
  const dtu = { kind: "spell_recipe", machine: { executable: { code: "rand" } } };
  const runners = { code: () => Math.random() };
  const a = assessGrounding(dtu, runners);
  assert.equal(a.grounded, false);
  assert.equal(a.reproduced.stable, false);
});

test("creative gen WITHOUT an executable representation is flagged", () => {
  const dtu = { kind: "blueprint", title: "vibes only" };
  const a = assessGrounding(dtu);
  assert.equal(a.grounded, false);
  assert.deepEqual(a.gaps, ["no_executable_representation"]);
});

test("definitional DTUs owe no external grounding", () => {
  const dtu = { kind: "definition", title: "A enum of states" };
  const a = assessGrounding(dtu);
  assert.equal(a.kind, "definitional");
  assert.equal(a.grounded, true);
});

test("stampGrounding writes the show-your-work trail + probations the ungrounded", () => {
  const dtu = { kind: "claim", meta: {} };
  const a = assessGrounding(dtu);
  stampGrounding(dtu, a);
  assert.equal(dtu.machine.grounding.grounded, false);
  assert.ok(/UNVERIFIED/.test(dtu.machine.grounding.showWork));
  assert.equal(dtu.meta.probation, true);
  assert.equal(dtu.meta.confidence, 0.4);
});

test("collectWebSources pulls urls from sources, citations, and claim annotations", () => {
  const dtu = { meta: { sources: ["see https://a.com/x"], citations: [{ href: "https://b.org" }] }, claimAnnotations: [{ sourceUrl: "https://c.net" }] };
  assert.equal(collectWebSources(dtu).length, 3);
});

test("verifyReproducible needs a runner", () => {
  const dtu = { machine: { executable: { expr: "1+1" } } };
  assert.equal(verifyReproducible(dtu, {}).reproducible, false);
});
