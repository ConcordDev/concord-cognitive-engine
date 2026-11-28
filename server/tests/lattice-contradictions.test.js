// The lattice audit's contradiction check: same answers as the all-pairs loop it
// replaced, in one pass (lib/lattice-contradictions.js).
import { test } from "node:test";
import assert from "node:assert/strict";
import { findNegationContradictions } from "../lib/lattice-contradictions.js";

// The loop that was in emergent/index.js (repair.agent.tick), verbatim in its logic.
function allPairs(claimMap, limit = 5) {
  const out = [];
  for (let i = 0; i < claimMap.length && out.length < limit; i++) {
    for (let j = i + 1; j < claimMap.length && out.length < limit; j++) {
      const a = claimMap[i].claim, b = claimMap[j].claim;
      if (claimMap[i].id !== claimMap[j].id) {
        if ((a.includes("not ") && b === a.replace("not ", "")) || (b.includes("not ") && a === b.replace("not ", ""))) out.push([i, j]);
      }
    }
  }
  return out;
}

// a small deterministic PRNG so failures reproduce
function rng(seed) { let s = seed >>> 0; return () => ((s = (s * 1664525 + 1013904223) >>> 0) / 2 ** 32); }

test("same pairs, same order, as the all-pairs loop — on random lattices with planted contradictions", () => {
  const words = ["water", "boils", "at", "sea", "level", "the", "beam", "holds", "load", "is", "stable", "true"];
  for (let seed = 1; seed <= 300; seed++) {
    const r = rng(seed);
    const n = 5 + Math.floor(r() * 60);
    const claims = [];
    for (let i = 0; i < n; i++) {
      const id = `d${Math.floor(r() * (n / 2))}`; // shared ids: same-DTU pairs must not count
      const base = Array.from({ length: 2 + Math.floor(r() * 3) }, () => words[Math.floor(r() * words.length)]).join(" ");
      const roll = r();
      const claim = roll < 0.25 ? `${base.split(" ")[0]} not ${base.split(" ").slice(1).join(" ")}` // a negation
        : roll < 0.35 && claims.length ? claims[Math.floor(r() * claims.length)].claim.replace("not ", "") // the plain twin of an earlier one
        : roll < 0.4 ? `not not ${base}` : base;
      claims.push({ id, claim });
    }
    for (const limit of [1, 3, 5, 1000]) assert.deepEqual(findNegationContradictions(claims, limit), allPairs(claims, limit), `seed ${seed}, limit ${limit}`);
  }
});

test("finds the textbook case and ignores a claim against itself", () => {
  const claims = [
    { id: "a", claim: "water boils at 100 c at sea level" },
    { id: "b", claim: "water does not boil at 100 c at sea level" },
    { id: "c", claim: "water does boil at 100 c at sea level" },
    { id: "c", claim: "water does not boil at 100 c at sea level" },
  ];
  assert.deepEqual(findNegationContradictions(claims), [[1, 2]]);
  assert.deepEqual(allPairs(claims), [[1, 2]]);
});

test("a production-size lattice (240,000 claims) in well under a second", () => {
  const claims = [];
  for (let i = 0; i < 240_000; i++) claims.push({ id: `d${i >> 2}`, claim: `claim ${i} about beam ${i % 977} under load ${i % 131}` });
  claims[150_001] = { id: "x", claim: "the planted beam is not rated for this load" };
  claims[150_002] = { id: "y", claim: "the planted beam is rated for this load" };
  const t = process.hrtime.bigint();
  const pairs = findNegationContradictions(claims, 5);
  const ms = Number(process.hrtime.bigint() - t) / 1e6;
  assert.deepEqual(pairs, [[150_001, 150_002]]);
  assert.ok(ms < 1000, `took ${ms.toFixed(0)} ms`); // the all-pairs loop is ~2.9e10 comparisons here
});
