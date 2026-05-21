// Contract tests for server/domains/legacy.js — legacy-system modernization
// macros: technical-debt math, codebase scanning, dependency graphing,
// hotspot ranking, migration roadmap, modernization ROI, cloud readiness,
// and historical debt-trend tracking.

import { describe, it, before, beforeEach } from "node:test";
import assert from "node:assert/strict";
import registerLegacyActions from "../domains/legacy.js";

const ACTIONS = new Map();
function register(domain, name, fn) { ACTIONS.set(`${domain}.${name}`, fn); }
function call(name, ctx, artifactOrParams = {}, maybeParams) {
  const fn = ACTIONS.get(`legacy.${name}`);
  if (!fn) throw new Error(`legacy.${name} not registered`);
  const artifact = arguments.length === 4 ? artifactOrParams : { id: null, data: {}, meta: {} };
  const params = arguments.length === 4 ? (maybeParams || {}) : artifactOrParams;
  return fn(ctx, artifact, params);
}

before(() => { registerLegacyActions(register); });

beforeEach(() => {
  // fresh per-user STATE so codebase/snapshot Maps don't leak across tests
  globalThis._concordSTATE = {};
});

const ctxA = { actor: { userId: "legacy_user_a" }, userId: "legacy_user_a" };

const SAMPLE_FILES = [
  {
    path: "src/auth.js",
    content: `import { db } from "./db";\nfunction login(u){ if(u){ return db.find(u); } else { return null; } }\n// TODO: rate limit`,
    churn: 40,
  },
  {
    path: "src/db.js",
    content: `import { auth } from "./auth";\nexport const db = { find(x){ return x && x.id ? x : null; } };`,
    churn: 12,
  },
  {
    path: "src/util.cob",
    content: `       IDENTIFICATION DIVISION.\n       PERFORM UNTIL DONE\n       EVALUATE TRUE`,
    churn: 3,
  },
  {
    path: "src/auth.test.js",
    content: `import { login } from "./auth";\ntest("login", () => {});`,
    churn: 5,
  },
];

describe("legacy.technicalDebt (pure-compute)", () => {
  it("returns a message when no modules supplied", () => {
    const r = call("technicalDebt", ctxA, { data: { modules: [] } }, {});
    assert.equal(r.ok, true);
    assert.ok(r.result.message);
  });

  it("computes maintainability index + debt score per module", () => {
    const r = call("technicalDebt", ctxA, {
      data: { modules: [
        { name: "billing", linesOfCode: 4000, cyclomaticComplexity: 45, testCoverage: 10, dependencyAgeYears: 5 },
        { name: "ui", linesOfCode: 200, cyclomaticComplexity: 4, testCoverage: 90 },
      ] },
    }, {});
    assert.equal(r.ok, true);
    assert.equal(r.result.modules.length, 2);
    assert.equal(r.result.modules[0].name, "billing"); // sorted by debt desc
    assert.ok(r.result.summary.totalRemediationHours >= 0);
    assert.ok(r.result.topDebtSources.length > 0);
  });
});

describe("legacy.migrationReadiness (pure-compute)", () => {
  it("scores per-module readiness + suggests migration order", () => {
    const r = call("migrationReadiness", ctxA, {
      data: { system: { modules: [
        { name: "core", dependencies: [], apis: [{ endpoint: "/x", consumers: 2 }], dataStores: [{ type: "postgres", sizeGb: 1 }] },
        { name: "edge", dependencies: ["core"], apis: [], dataStores: [] },
      ] } },
    }, {});
    assert.equal(r.ok, true);
    assert.equal(r.result.moduleReadiness.length, 2);
    assert.equal(r.result.migrationOrder[0].module, "core"); // fewest deps first
  });
});

describe("legacy.riskMap (pure-compute)", () => {
  it("computes bus factor + risk score + key-person risks", () => {
    const r = call("riskMap", ctxA, {
      data: { components: [
        { name: "ledger", criticality: 5, knowledgeHolders: ["alice"], failures: [{ date: "2026-01-01", severity: 4 }] },
        { name: "cache", criticality: 2, knowledgeHolders: ["alice", "bob"], failures: [] },
      ] },
    }, {});
    assert.equal(r.ok, true);
    assert.equal(r.result.components[0].name, "ledger"); // highest risk first
    assert.equal(r.result.components[0].busFactor.holders, 1);
    assert.ok(r.result.keyPersonRisks.some((k) => k.person === "alice"));
  });
});

describe("legacy.scanCodebase (real source parsing)", () => {
  it("rejects an empty file set", () => {
    const r = call("scanCodebase", ctxA, {}, { name: "x", files: [] });
    assert.equal(r.ok, false);
  });

  it("derives per-file metrics + language composition from real source", () => {
    const r = call("scanCodebase", ctxA, {}, { name: "demo", files: SAMPLE_FILES });
    assert.equal(r.ok, true);
    assert.equal(r.result.codebase.summary.fileCount, 4);
    assert.equal(r.result.codebase.summary.testFiles, 1);
    assert.equal(r.result.codebase.summary.legacyLanguageFiles, 1); // the .cob file
    assert.ok(r.result.codebase.summary.totalTodos >= 1); // TODO in auth.js
    assert.ok(r.result.codebase.languages.some((l) => l.language === "COBOL" && l.legacy));
  });
});

describe("legacy.listCodebases / getCodebase / deleteCodebase", () => {
  it("round-trips a scanned codebase", () => {
    const scan = call("scanCodebase", ctxA, {}, { name: "rt", files: SAMPLE_FILES });
    const id = scan.result.codebase.id;

    const list = call("listCodebases", ctxA, {}, {});
    assert.equal(list.ok, true);
    assert.equal(list.result.count, 1);

    const got = call("getCodebase", ctxA, {}, { id });
    assert.equal(got.ok, true);
    assert.equal(got.result.codebase.id, id);

    const del = call("deleteCodebase", ctxA, {}, { id });
    assert.equal(del.ok, true);
    assert.equal(call("listCodebases", ctxA, {}, {}).result.count, 0);
  });

  it("getCodebase fails cleanly for an unknown id", () => {
    const r = call("getCodebase", ctxA, {}, { id: "nope" });
    assert.equal(r.ok, false);
  });
});

describe("legacy.dependencyGraph (cycle + hotspot detection)", () => {
  it("builds a graph and detects the auth<->db cycle", () => {
    const scan = call("scanCodebase", ctxA, {}, { name: "g", files: SAMPLE_FILES });
    const r = call("dependencyGraph", ctxA, {}, { codebaseId: scan.result.codebase.id });
    assert.equal(r.ok, true);
    assert.ok(r.result.summary.nodeCount >= 4);
    assert.ok(r.result.summary.cycleCount >= 1); // auth.js imports db.js imports auth.js
  });

  it("accepts inline files without a stored codebase", () => {
    const r = call("dependencyGraph", ctxA, {}, { files: SAMPLE_FILES });
    assert.equal(r.ok, true);
    assert.ok(Array.isArray(r.result.nodes));
  });

  it("fails when no codebase or files supplied", () => {
    const r = call("dependencyGraph", ctxA, {}, {});
    assert.equal(r.ok, false);
  });
});

describe("legacy.hotspotRanking (churn x complexity)", () => {
  it("ranks production files by hotspot index", () => {
    const scan = call("scanCodebase", ctxA, {}, { name: "h", files: SAMPLE_FILES });
    const r = call("hotspotRanking", ctxA, {}, { codebaseId: scan.result.codebase.id });
    assert.equal(r.ok, true);
    assert.ok(r.result.hotspots.length >= 1);
    assert.ok(r.result.hotspots.every((h) => h.hotspotIndex >= 0 && h.hotspotIndex <= 100));
    // sorted descending
    if (r.result.hotspots.length >= 2) {
      assert.ok(r.result.hotspots[0].hotspotIndex >= r.result.hotspots[1].hotspotIndex);
    }
  });
});

describe("legacy.migrationRoadmap (sequenced refactor plan)", () => {
  it("produces phased plan with effort estimates", () => {
    const scan = call("scanCodebase", ctxA, {}, { name: "rm", files: SAMPLE_FILES });
    const r = call("migrationRoadmap", ctxA, {}, { codebaseId: scan.result.codebase.id });
    assert.equal(r.ok, true);
    assert.ok(r.result.phases.length >= 1);
    assert.ok(r.result.summary.totalEffortHours >= 0);
    assert.ok(r.result.summary.totalEffortWeeks >= 0);
  });
});

describe("legacy.modernizationROI (rewrite/refactor/retire)", () => {
  it("recommends an action per module with payback math", () => {
    const r = call("modernizationROI", ctxA, {}, {
      modules: [
        { name: "legacy-core", linesOfCode: 8000, debtScore: 75, businessValue: 5, usageFrequency: 5 },
        { name: "dead-tool", linesOfCode: 500, debtScore: 20, businessValue: 1, usageFrequency: 1 },
      ],
    });
    assert.equal(r.ok, true);
    assert.equal(r.result.modules.length, 2);
    const retire = r.result.modules.find((m) => m.name === "dead-tool");
    assert.equal(retire.recommendation, "retire");
    assert.ok(["rewrite", "refactor", "retain", "retire"].includes(r.result.modules[0].recommendation));
    assert.ok(r.result.summary.recommendations);
  });

  it("derives modules from a stored codebase", () => {
    const scan = call("scanCodebase", ctxA, {}, { name: "roi", files: SAMPLE_FILES });
    const r = call("modernizationROI", ctxA, {}, { codebaseId: scan.result.codebase.id });
    assert.equal(r.ok, true);
    assert.ok(r.result.modules.length >= 1);
  });
});

describe("legacy.cloudReadiness (12-factor scoring)", () => {
  it("scores supplied components across cloud dimensions", () => {
    const r = call("cloudReadiness", ctxA, {}, {
      components: [
        { name: "api", statefulFilesystem: false, hardcodedConfig: false, secretsInCode: false, scalesHorizontally: true, healthCheckEndpoint: true, logsToStdout: true, sessionAffinity: false },
        { name: "monolith", statefulFilesystem: true, hardcodedConfig: true, secretsInCode: true, scalesHorizontally: false },
      ],
    });
    assert.equal(r.ok, true);
    assert.equal(r.result.components.length, 2);
    assert.ok(r.result.components[0].readinessScore >= r.result.components[1].readinessScore);
  });

  it("flags unknown traits when derived from a raw scan", () => {
    const scan = call("scanCodebase", ctxA, {}, { name: "cr", files: SAMPLE_FILES });
    const r = call("cloudReadiness", ctxA, {}, { codebaseId: scan.result.codebase.id });
    assert.equal(r.ok, true);
    assert.equal(r.result.derivedFromScan, true);
  });
});

describe("legacy.recordDebtSnapshot + debtTrend (history)", () => {
  it("requires totalDebt", () => {
    const r = call("recordDebtSnapshot", ctxA, {}, { label: "x" });
    assert.equal(r.ok, false);
  });

  it("records snapshots and computes a linear debt trend", () => {
    call("recordDebtSnapshot", ctxA, {}, { label: "wk1", totalDebt: 100, moduleCount: 10 });
    call("recordDebtSnapshot", ctxA, {}, { label: "wk2", totalDebt: 130, moduleCount: 11 });
    call("recordDebtSnapshot", ctxA, {}, { label: "wk3", totalDebt: 160, moduleCount: 12 });
    const r = call("debtTrend", ctxA, {}, {});
    assert.equal(r.ok, true);
    assert.equal(r.result.snapshots.length, 3);
    assert.equal(r.result.trend.direction, "increasing");
    assert.ok(r.result.trend.slopePerSnapshot > 0);
    assert.ok(r.result.trend.projectedNextDebt > 160);
  });

  it("returns an empty trend before any snapshot exists", () => {
    const r = call("debtTrend", ctxA, {}, {});
    assert.equal(r.ok, true);
    assert.equal(r.result.snapshots.length, 0);
  });
});
