// server/lib/pce/bench-registry.js
//
// Unified benchmark registry — core, engineering, adversarial suites.

import { CONCORD_BENCH_CASES, CONCORD_BENCH_CATEGORIES } from "./concord-bench-cases.js";
import { ENGINEERING_BENCH_CASES, ENGINEERING_CATEGORIES } from "./concord-engineering-cases.js";
import { ADVERSARIAL_BENCH_CASES, ADVERSARIAL_CATEGORIES } from "./concord-adversarial-cases.js";

export const BENCH_SUITES = Object.freeze({
  concord_core: {
    id: "concord_core",
    label: "ConcordBench Core",
    cases: CONCORD_BENCH_CASES,
    categories: CONCORD_BENCH_CATEGORIES,
    regressionEligible: true,
  },
  concord_engineering: {
    id: "concord_engineering",
    label: "Concord Engineering Surface",
    cases: ENGINEERING_BENCH_CASES,
    categories: ENGINEERING_CATEGORIES,
    regressionEligible: true,
  },
  concord_adversarial: {
    id: "concord_adversarial",
    label: "Concord Adversarial",
    cases: ADVERSARIAL_BENCH_CASES,
    categories: ADVERSARIAL_CATEGORIES,
    regressionEligible: false,
  },
});

export function getBenchSuite(suiteId) {
  return BENCH_SUITES[suiteId] || null;
}

export function listBenchSuites() {
  return Object.values(BENCH_SUITES).map((s) => ({
    id: s.id,
    label: s.label,
    caseCount: s.cases.length,
    categories: s.categories,
  }));
}

export function allRegressionCases({ suiteIds } = {}) {
  const ids = suiteIds || ["concord_core", "concord_engineering"];
  const cases = [];
  for (const sid of ids) {
    const suite = BENCH_SUITES[sid];
    if (!suite?.regressionEligible) continue;
    for (const c of suite.cases) {
      cases.push({ ...c, suite: sid });
    }
  }
  return cases;
}

export function findBenchCase(caseId) {
  for (const suite of Object.values(BENCH_SUITES)) {
    const found = suite.cases.find((c) => c.id === caseId);
    if (found) return { ...found, suite: suite.id };
  }
  return null;
}

export const ALL_BENCH_CASE_COUNT = Object.values(BENCH_SUITES)
  .reduce((n, s) => n + s.cases.length, 0);
