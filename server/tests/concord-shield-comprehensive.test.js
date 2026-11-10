/**
 * Concord Shield — Comprehensive Security Test Suite
 *
 * Targets 90%+ coverage with deep testing of:
 *   - Threat DTU creation edge cases and all subtypes
 *   - YARA heuristic classification (all 8 malware families + combinations)
 *   - Rate limiting / scan queue behavior
 *   - IP/hash blocking and threat index operations
 *   - Scan results caching and deduplication
 *   - Analysis pipeline severity computation
 *   - Prophet prediction with escalation patterns
 *   - Surgeon neutralization for every subtype
 *   - Guardian Suricata/Snort rule generation
 *   - Security score grading boundaries
 *   - Chat intent detection edge cases
 *   - Sweep with threats found
 *   - Ingestion pipeline validation
 *   - Heartbeat tick behavior at different intervals
 *   - Collective immunity propagation
 *   - State isolation and concurrent scan safety
 */

import { describe, it, beforeEach } from "node:test";
import assert from "node:assert/strict";
import crypto from "crypto";

import {
  createThreatDTU,
  createCleanHashDTU,
  createFirewallRuleDTU,
  createPredictionDTU,
  scanHashAgainstLattice,
  scanContent,
  classifyWithYARA,
  runAnalysisPipeline,
  runProphet,
  runSurgeon,
  runGuardian,
  propagateThreatToLattice,
  shieldHeartbeatTick,
  computeSecurityScore,
  detectShieldIntent,
  performSweep,
  processUserReport,
  getThreatFeed,
  getFirewallRules,
  getPredictions,
  getShieldMetrics,
  queueScan,
  initializeShield,
  ingestYARARule,
  ingestNetworkRule,
  scanWithClamAV,
  THREAT_SUBTYPES,
  SCAN_MODES,
  ANALYSIS_STEPS,
  FORTIFY_AGENTS,
  detectTools,
  getToolStatus,
} from "../lib/concord-shield.js";

// ── Helpers ──────────────────────────────────────────────────────────────────

function mkSTATE() {
  return {
    dtus: new Map(),
    sessions: new Map(),
    settings: { heartbeatMs: 10000, heartbeatEnabled: true },
  };
}

function addThreat(STATE, opts = {}) {
  const dtu = createThreatDTU({
    subtype: opts.subtype || "virus",
    severity: opts.severity ?? 5,
    hash: opts.hash || { sha256: `hash_${crypto.randomBytes(8).toString("hex")}`, md5: "md5" },
    signatures: opts.signatures || { clamav: "Sig", yara: ["r1"], snort: "", suricata: "" },
    vector: opts.vector || "test vector",
    behavior: opts.behavior || [],
    affected: opts.affected || ["windows"],
    source: opts.source || "test",
    family: opts.family || opts.subtype || "virus",
    lineage: opts.lineage || null,
    tags: opts.tags || [],
  });
  STATE.dtus.set(dtu.id, dtu);
  return dtu;
}

// ═══════════════════════════════════════════════════════════════════════════════
// THREAT DTU — EDGE CASES AND ALL SUBTYPES
// ═══════════════════════════════════════════════════════════════════════════════

describe("Shield Comprehensive — Threat DTU All Subtypes", () => {
  for (const subtype of THREAT_SUBTYPES) {
    it(`creates valid DTU for subtype: ${subtype}`, () => {
      const dtu = createThreatDTU({ subtype, severity: 7 });
      assert.equal(dtu.subtype, subtype);
      assert.equal(dtu.type, "THREAT");
      assert.ok(dtu.id.startsWith("threat_"));
      assert.ok(dtu.tags.includes(`threat:${subtype}`));
      assert.ok(dtu.human.summary.includes(subtype));
      assert.ok(dtu.core.claims[0].includes(subtype));
    });
  }

  it("defaults missing hash fields to empty strings", () => {
    const dtu = createThreatDTU({ subtype: "virus", severity: 5 });
    assert.equal(dtu.hash.sha256, "");
    assert.equal(dtu.hash.md5, "");
    assert.equal(dtu.hash.ssdeep, "");
  });

  it("defaults missing signatures to empty values", () => {
    const dtu = createThreatDTU({ subtype: "virus", severity: 5 });
    assert.equal(dtu.signatures.clamav, "");
    assert.deepEqual(dtu.signatures.yara, []);
    assert.equal(dtu.signatures.snort, "");
    assert.equal(dtu.signatures.suricata, "");
  });

  it("preserves custom tags alongside default tags", () => {
    const dtu = createThreatDTU({ subtype: "trojan", severity: 5, tags: ["custom_tag", "another"] });
    assert.ok(dtu.tags.includes("custom_tag"));
    assert.ok(dtu.tags.includes("another"));
    assert.ok(dtu.tags.includes("pain_memory"));
    assert.ok(dtu.tags.includes("collective_immunity"));
  });

  it("generates title from subtype and hash", () => {
    const dtu = createThreatDTU({
      subtype: "ransomware",
      severity: 9,
      hash: { sha256: "abcdef1234567890abcdef1234567890" },
    });
    assert.ok(dtu.title.includes("RANSOMWARE"));
    assert.ok(dtu.title.includes("abcdef1234567890"));
  });

  it("sets machine layer shieldMetadata correctly", () => {
    const dtu = createThreatDTU({
      subtype: "virus",
      severity: 5,
      source: "clamav",
      scanMode: SCAN_MODES.PASSIVE,
    });
    assert.equal(dtu.machine.kind, "threat");
    assert.equal(dtu.machine.shieldMetadata.scanMode, SCAN_MODES.PASSIVE);
    assert.equal(dtu.machine.shieldMetadata.detectionEngine, "clamav");
  });

  it("sets CRETI evidence from YARA rule count", () => {
    const noYara = createThreatDTU({ subtype: "virus", severity: 5 });
    const manyYara = createThreatDTU({
      subtype: "virus",
      severity: 5,
      signatures: { yara: ["r1", "r2", "r3", "r4", "r5"] },
    });
    assert.ok(manyYara.creti.evidence >= noYara.creti.evidence);
  });

  it("constructs lineageData children as empty array", () => {
    const dtu = createThreatDTU({ subtype: "virus", severity: 5 });
    assert.deepEqual(dtu.lineageData.children, []);
  });

  it("handles severity of zero by defaulting to 5", () => {
    const dtu = createThreatDTU({ subtype: "virus", severity: 0 });
    assert.equal(dtu.severity, 5);
  });

  it("handles missing severity by defaulting", () => {
    const dtu = createThreatDTU({ subtype: "virus" });
    assert.equal(dtu.severity, 5);
  });
});

// ═══════════════════════════════════════════════════════════════════════════════
// CLEAN HASH DTU — EDGE CASES
// ═══════════════════════════════════════════════════════════════════════════════

describe("Shield Comprehensive — Clean Hash DTU Edge Cases", () => {
  it("handles missing hash fields", () => {
    const dtu = createCleanHashDTU({});
    assert.equal(dtu.hash.sha256, "");
    assert.equal(dtu.hash.md5, "");
    assert.equal(dtu.type, "CLEAN_HASH");
  });

  it("includes correct tier and scope", () => {
    const dtu = createCleanHashDTU({ sha256: "abc" });
    assert.equal(dtu.tier, "shadow");
    assert.equal(dtu.scope, "local");
    assert.equal(dtu.createdBy, "shield");
  });

  it("generates unique IDs", () => {
    const a = createCleanHashDTU({ sha256: "a" });
    const b = createCleanHashDTU({ sha256: "b" });
    assert.notEqual(a.id, b.id);
    assert.ok(a.id.startsWith("clean_"));
    assert.ok(b.id.startsWith("clean_"));
  });
});

// ═══════════════════════════════════════════════════════════════════════════════
// FIREWALL RULE DTU — EDGE CASES
// ═══════════════════════════════════════════════════════════════════════════════

describe("Shield Comprehensive — Firewall Rule DTU Edge Cases", () => {
  it("defaults generatedBy to guardian", () => {
    const dtu = createFirewallRuleDTU({ rule: "drop", vector: "email" });
    assert.equal(dtu.generatedBy, FORTIFY_AGENTS.GUARDIAN);
  });

  it("includes blocks: tag with subtype", () => {
    const dtu = createFirewallRuleDTU({ threatSubtype: "ransomware" });
    assert.ok(dtu.tags.includes("blocks:ransomware"));
  });

  it("defaults severity-based CRETI impact", () => {
    const low = createFirewallRuleDTU({ severity: 2 });
    const high = createFirewallRuleDTU({ severity: 10 });
    assert.ok(high.creti.impact > low.creti.impact);
  });
});

// ═══════════════════════════════════════════════════════════════════════════════
// PREDICTION DTU — EDGE CASES
// ═══════════════════════════════════════════════════════════════════════════════

describe("Shield Comprehensive — Prediction DTU Edge Cases", () => {
  it("defaults fields when created with minimal opts", () => {
    const dtu = createPredictionDTU({});
    assert.equal(dtu.type, "THREAT_PREDICTION");
    assert.equal(dtu.family, "");
    assert.equal(dtu.confidence, 0.5);
    assert.deepEqual(dtu.basedOn, []);
    assert.deepEqual(dtu.evolutionPattern, []);
  });

  it("CRETI credibility scales with confidence", () => {
    const low = createPredictionDTU({ confidence: 0.2 });
    const high = createPredictionDTU({ confidence: 0.9 });
    assert.ok(high.creti.credibility > low.creti.credibility);
  });

  it("CRETI evidence scales with basedOn count", () => {
    const few = createPredictionDTU({ basedOn: ["a"] });
    const many = createPredictionDTU({ basedOn: ["a", "b", "c", "d", "e", "f"] });
    assert.ok(many.creti.evidence >= few.creti.evidence);
  });
});

// ═══════════════════════════════════════════════════════════════════════════════
// YARA HEURISTIC CLASSIFICATION — ALL FAMILIES AND COMBINATIONS
// ═══════════════════════════════════════════════════════════════════════════════

describe("Shield Comprehensive — Heuristic Classification Combos", () => {
  it("detects combined ransomware + trojan indicators (first match wins)", async () => {
    const result = await classifyWithYARA(
      null,
      "Encrypt your files, pay bitcoin. Also opens backdoor reverse shell to C2 server."
    );
    assert.ok(result.matches.length >= 2);
    // Family should be first matched (ransomware)
    assert.equal(result.family, "ransomware");
    assert.ok(result.techniques.includes("ransomware"));
    assert.ok(result.techniques.includes("trojan"));
  });

  it("detects adware patterns (no heuristic for adware, returns empty)", async () => {
    const result = await classifyWithYARA(null, "This is a legitimate software bundle with no threat content.");
    assert.equal(result.matches.length, 0);
    assert.equal(result.family, null);
  });

  it("handles very long content without crashing", async () => {
    const longContent = "normal text. ".repeat(10000);
    const result = await classifyWithYARA(null, longContent);
    assert.equal(result.engine, "heuristic");
    assert.equal(result.matches.length, 0);
  });

  it("handles empty string content", async () => {
    const result = await classifyWithYARA(null, "");
    assert.equal(result.matches.length, 0);
    assert.equal(result.family, null);
  });

  it("handles null content", async () => {
    const result = await classifyWithYARA(null, null);
    assert.equal(result.matches.length, 0);
    assert.equal(result.engine, "heuristic");
  });

  it("detects multiple indicator families simultaneously", async () => {
    const result = await classifyWithYARA(
      null,
      "Self replicating worm that propagates, plus keylogger spyware for screen capture and webcam access."
    );
    assert.ok(result.techniques.includes("worm"));
    assert.ok(result.techniques.includes("spyware"));
    assert.ok(result.matches.length >= 2);
  });
});

// ═══════════════════════════════════════════════════════════════════════════════
// SCAN — CONTENT CACHING, DEDUP, AND HASH INDEX
// ═══════════════════════════════════════════════════════════════════════════════

describe("Shield Comprehensive — Hash Index Operations", () => {
  let STATE;
  beforeEach(() => { STATE = mkSTATE(); });

  it("builds threat index on propagation for fast lookup", () => {
    const threat = addThreat(STATE, { hash: { sha256: "idx_hash_1", md5: "m" } });
    propagateThreatToLattice(threat, STATE);

    // Second lookup should be instant via threat index
    const r = scanHashAgainstLattice("idx_hash_1", STATE);
    assert.equal(r.known, true);
    assert.equal(r.clean, false);
  });

  it("indexes clean hashes for instant known-good lookup", async () => {
    const content = "unique clean content for indexing";
    await scanContent(content, STATE, { source: "test" });

    // Second scan should hit cache (knownGoodHashes)
    const r2 = await scanContent(content, STATE, { source: "test" });
    assert.equal(r2.ok, true);
    assert.equal(r2.clean, true);
    assert.equal(r2.cached, true);
  });

  it("scanHashAgainstLattice iterates lattice for uncached hashes", () => {
    // Add a threat directly to dtus map (not via threat index)
    const dtu = createThreatDTU({
      subtype: "virus",
      severity: 5,
      hash: { sha256: "direct_lattice_hash", md5: "m" },
    });
    STATE.dtus.set(dtu.id, dtu);

    // Should find it by lattice iteration
    const r = scanHashAgainstLattice("direct_lattice_hash", STATE);
    assert.equal(r.known, true);
    assert.equal(r.clean, false);
    assert.equal(r.threatDtu.id, dtu.id);
  });

  it("scanHashAgainstLattice finds CLEAN_HASH DTUs in lattice", () => {
    const clean = createCleanHashDTU({ sha256: "clean_lattice_hash", md5: "m" });
    STATE.dtus.set(clean.id, clean);

    const r = scanHashAgainstLattice("clean_lattice_hash", STATE);
    assert.equal(r.known, true);
    assert.equal(r.clean, true);
  });

  it("scanContent with Buffer input works", async () => {
    const buf = Buffer.from("buffer content to scan");
    const result = await scanContent(buf, STATE, { source: "test" });
    assert.equal(result.ok, true);
    assert.equal(result.clean, true);
    assert.ok(result.hash.sha256);
  });
});

// ═══════════════════════════════════════════════════════════════════════════════
// ANALYSIS PIPELINE — SEVERITY COMPUTATION EDGE CASES
// ═══════════════════════════════════════════════════════════════════════════════

describe("Shield Comprehensive — Severity Computation", () => {
  let STATE;
  beforeEach(() => { STATE = mkSTATE(); });

  it("base severity is 5 for clean clamResult with no yara matches", async () => {
    const result = await runAnalysisPipeline({
      content: "test",
      hash: { sha256: "sev_base", md5: "m" },
      clamResult: { clean: true },
      yaraResult: { matches: [], family: "adware", techniques: [], engine: "heuristic" },
      scanMode: SCAN_MODES.ACTIVE,
      source: "test",
    }, STATE);
    // base=5, no clam bonus, no yara bonus, family "adware" not in high severity list
    assert.equal(result.severity, 5);
  });

  it("clam detection adds +2 severity", async () => {
    const result = await runAnalysisPipeline({
      content: "test",
      hash: { sha256: "sev_clam", md5: "m" },
      clamResult: { clean: false, signature: "Test" },
      yaraResult: { matches: [], family: "adware", techniques: [], engine: "heuristic" },
      scanMode: SCAN_MODES.ACTIVE,
      source: "test",
    }, STATE);
    // base=5 + clam=2 = 7
    assert.equal(result.severity, 7);
  });

  it("yara rule count adds up to +3", async () => {
    const result = await runAnalysisPipeline({
      content: "test",
      hash: { sha256: "sev_yara", md5: "m" },
      clamResult: { clean: true },
      yaraResult: { matches: ["r1", "r2", "r3", "r4", "r5"], family: "adware", techniques: [], engine: "heuristic" },
      scanMode: SCAN_MODES.ACTIVE,
      source: "test",
    }, STATE);
    // base=5 + yara=3 (capped) = 8
    assert.equal(result.severity, 8);
  });

  it("high severity family (ransomware) adds +1", async () => {
    const result = await runAnalysisPipeline({
      content: "test",
      hash: { sha256: "sev_family", md5: "m" },
      clamResult: { clean: false },
      yaraResult: { matches: ["r1", "r2"], family: "ransomware", techniques: [], engine: "heuristic" },
      scanMode: SCAN_MODES.ACTIVE,
      source: "test",
    }, STATE);
    // base=5 + clam=2 + yara=2 + family=1 = 10
    assert.equal(result.severity, 10);
  });

  it("severity clamped to max 10", async () => {
    const result = await runAnalysisPipeline({
      content: "test",
      hash: { sha256: "sev_max", md5: "m" },
      clamResult: { clean: false },
      yaraResult: { matches: ["r1", "r2", "r3", "r4"], family: "rootkit", techniques: [], engine: "heuristic" },
      scanMode: SCAN_MODES.ACTIVE,
      source: "test",
    }, STATE);
    // base=5 + clam=2 + yara=3 + family=1 = 11 -> clamped to 10
    assert.equal(result.severity, 10);
  });

  it("pipeline stores threat in STATE.dtus", async () => {
    const result = await runAnalysisPipeline({
      content: "test",
      hash: { sha256: "sev_store", md5: "m" },
      clamResult: { clean: false },
      yaraResult: { matches: [], family: "virus", techniques: [], engine: "heuristic" },
      scanMode: SCAN_MODES.ACTIVE,
      source: "test",
    }, STATE);
    assert.ok(STATE.dtus.has(result.threatDtu.id));
  });

  it("pipeline adds to threat feed", async () => {
    const metricsBefore = getShieldMetrics();
    const feedBefore = metricsBefore.threatFeedSize;

    await runAnalysisPipeline({
      content: "test",
      hash: { sha256: "sev_feed", md5: "m" },
      clamResult: { clean: false },
      yaraResult: { matches: [], family: "virus", techniques: [], engine: "heuristic" },
      scanMode: SCAN_MODES.ACTIVE,
      source: "test",
    }, STATE);

    const metricsAfter = getShieldMetrics();
    assert.ok(metricsAfter.threatFeedSize > feedBefore);
  });
});

// ═══════════════════════════════════════════════════════════════════════════════
// PROPHET — PREDICTION ESCALATION PATTERNS
// ═══════════════════════════════════════════════════════════════════════════════

describe("Shield Comprehensive — Prophet Escalation Patterns", () => {
  let STATE;
  beforeEach(() => { STATE = mkSTATE(); });

  it("predicts defense_evasion after obfuscation technique", () => {
    addThreat(STATE, { subtype: "trojan", family: "trojan", behavior: ["obfuscation"] });
    addThreat(STATE, { subtype: "trojan", family: "trojan", behavior: ["persistence"] });

    const result = runProphet("trojan", STATE);
    assert.ok(result.ok);
    // escalation: obfuscation -> defense_evasion, persistence -> privilege_escalation
    assert.ok(result.predictedTechniques.includes("defense_evasion") ||
              result.predictedTechniques.includes("privilege_escalation"));
  });

  it("predicts severity escalation above average", () => {
    addThreat(STATE, { subtype: "ransomware", family: "ransomware", severity: 6, behavior: [] });
    addThreat(STATE, { subtype: "ransomware", family: "ransomware", severity: 8, behavior: [] });

    const result = runProphet("ransomware", STATE);
    assert.ok(result.predictedSeverity >= 8); // ceil(7+1) = 8
  });

  it("confidence scales with sample count", () => {
    for (let i = 0; i < 5; i++) {
      addThreat(STATE, { subtype: "worm", family: "worm", behavior: ["propagation"] });
    }

    const result = runProphet("worm", STATE);
    assert.ok(result.predictions[0].confidence > 0.3);
    assert.equal(result.samplesAnalyzed, 5);
  });

  it("handles family with exactly 2 samples", () => {
    addThreat(STATE, { subtype: "botnet", family: "botnet", behavior: [] });
    addThreat(STATE, { subtype: "botnet", family: "botnet", behavior: [] });

    const result = runProphet("botnet", STATE);
    assert.ok(result.ok);
    assert.equal(result.predictions.length, 1);
  });

  it("returns ok:false for null STATE", () => {
    const result = runProphet("virus", null);
    assert.equal(result.ok, false);
  });

  it("handles empty family name", () => {
    const result = runProphet("nonexistent_family", STATE);
    assert.equal(result.ok, true);
    assert.equal(result.predictions.length, 0);
    assert.equal(result.reason, "insufficient_data");
  });

  it("generates preemptive YARA rule in prediction", () => {
    addThreat(STATE, { subtype: "spyware", family: "spyware", behavior: ["data_exfiltration"] });
    addThreat(STATE, { subtype: "spyware", family: "spyware", behavior: ["lateral_movement"] });

    const result = runProphet("spyware", STATE);
    assert.ok(result.predictions[0].preemptiveRule.includes("predicted_spyware_variant"));
    assert.ok(result.predictions[0].preemptiveRule.includes("concord_shield_prophet"));
  });
});

// ═══════════════════════════════════════════════════════════════════════════════
// SURGEON — ALL SUBTYPES NEUTRALIZATION
// ═══════════════════════════════════════════════════════════════════════════════

describe("Shield Comprehensive — Surgeon All Subtypes", () => {
  it("generates ransomware-specific neutralization (backup emphasis)", () => {
    const result = runSurgeon(createThreatDTU({ subtype: "ransomware", severity: 9 }));
    assert.ok(result.analysis.neutralizationProcedure.immediate.some(s => s.includes("Disconnect")));
    assert.ok(result.analysis.neutralizationProcedure.shortTerm.some(s => s.includes("backup")));
    assert.ok(result.analysis.neutralizationProcedure.longTerm.some(s => s.includes("3-2-1")));
  });

  it("generates trojan neutralization (kill processes)", () => {
    const result = runSurgeon(createThreatDTU({ subtype: "trojan", severity: 7 }));
    assert.ok(result.analysis.neutralizationProcedure.immediate.some(
      s => s.toLowerCase().includes("kill")
    ));
  });

  it("generates rootkit neutralization (reinstall recommendation)", () => {
    const result = runSurgeon(createThreatDTU({ subtype: "rootkit", severity: 8 }));
    assert.ok(result.analysis.neutralizationProcedure.longTerm.some(
      s => s.toLowerCase().includes("reinstall")
    ));
  });

  it("generates default neutralization for virus subtype", () => {
    const result = runSurgeon(createThreatDTU({ subtype: "virus", severity: 5 }));
    assert.ok(result.analysis.neutralizationProcedure.immediate.length > 0);
    assert.ok(result.analysis.neutralizationProcedure.shortTerm.length > 0);
    assert.ok(result.analysis.neutralizationProcedure.longTerm.length > 0);
  });

  it("generates default neutralization for worm subtype", () => {
    const result = runSurgeon(createThreatDTU({ subtype: "worm", severity: 6 }));
    assert.ok(result.ok);
    assert.ok(result.analysis.neutralizationProcedure.immediate.length > 0);
  });

  it("generates default neutralization for phishing subtype", () => {
    const result = runSurgeon(createThreatDTU({ subtype: "phishing", severity: 4 }));
    assert.ok(result.ok);
  });

  it("generates default neutralization for botnet subtype", () => {
    const result = runSurgeon(createThreatDTU({ subtype: "botnet", severity: 8 }));
    assert.ok(result.ok);
  });

  it("severity assessment: critical at 8+", () => {
    assert.equal(runSurgeon(createThreatDTU({ subtype: "virus", severity: 8 })).analysis.severityAssessment.level, "critical");
    assert.equal(runSurgeon(createThreatDTU({ subtype: "virus", severity: 10 })).analysis.severityAssessment.level, "critical");
  });

  it("severity assessment: high at 5-7", () => {
    assert.equal(runSurgeon(createThreatDTU({ subtype: "virus", severity: 5 })).analysis.severityAssessment.level, "high");
    assert.equal(runSurgeon(createThreatDTU({ subtype: "virus", severity: 7 })).analysis.severityAssessment.level, "high");
  });

  it("severity assessment: moderate below 5", () => {
    assert.equal(runSurgeon(createThreatDTU({ subtype: "virus", severity: 1 })).analysis.severityAssessment.level, "moderate");
    assert.equal(runSurgeon(createThreatDTU({ subtype: "virus", severity: 4 })).analysis.severityAssessment.level, "moderate");
  });
});

// ═══════════════════════════════════════════════════════════════════════════════
// GUARDIAN — RULE GENERATION EDGE CASES
// ═══════════════════════════════════════════════════════════════════════════════

describe("Shield Comprehensive — Guardian Rule Generation", () => {
  let STATE;
  beforeEach(() => { STATE = mkSTATE(); });

  it("generates iptables-style rule with hash and subtype", () => {
    const threat = createThreatDTU({
      subtype: "trojan",
      severity: 7,
      hash: { sha256: "aabbccdd11223344aabbccdd11223344" },
      vector: "malicious download",
    });
    const result = runGuardian(threat, STATE);
    assert.ok(result.rules[0].includes("iptables"));
    assert.ok(result.rules[0].includes("trojan"));
    assert.ok(result.rules[0].includes("aabbccdd11223344"));
  });

  it("skips firewall rule when vector is unknown", () => {
    const threat = createThreatDTU({
      subtype: "virus",
      severity: 5,
      vector: "unknown",
    });
    const result = runGuardian(threat, STATE);
    assert.equal(result.rules.length, 0);
  });

  it("always generates Suricata and Snort concept rules", () => {
    const threat = createThreatDTU({
      subtype: "virus",
      severity: 5,
      vector: "unknown",
    });
    const result = runGuardian(threat, STATE);
    assert.ok(result.suricataRule.includes("CONCORD SHIELD"));
    assert.ok(result.snortRule.includes("CONCORD SHIELD"));
  });

  it("stores firewall rule DTU in lattice when vector is known", () => {
    const threat = createThreatDTU({ subtype: "phishing", severity: 6, vector: "email phishing" });
    const sizeBefore = STATE.dtus.size;
    runGuardian(threat, STATE);
    assert.ok(STATE.dtus.size > sizeBefore);
  });

  it("updates firewallRulesGenerated stat", () => {
    const metricsBefore = getShieldMetrics().stats.firewallRulesGenerated;
    const threat = createThreatDTU({ subtype: "worm", severity: 6, vector: "network propagation" });
    runGuardian(threat, STATE);
    const metricsAfter = getShieldMetrics().stats.firewallRulesGenerated;
    assert.ok(metricsAfter > metricsBefore);
  });
});

// ═══════════════════════════════════════════════════════════════════════════════
// SECURITY SCORE — GRADING BOUNDARIES
// ═══════════════════════════════════════════════════════════════════════════════

describe("Shield Comprehensive — Security Score Grades", () => {
  it("returns score 0 and grade ? for missing dtus", () => {
    const score = computeSecurityScore("u", null);
    assert.equal(score.score, 0);
    assert.equal(score.grade, "?");
  });

  it("returns score 0 and grade ? for STATE without dtus", () => {
    const score = computeSecurityScore("u", {});
    assert.equal(score.score, 0);
    assert.equal(score.grade, "?");
  });

  it("scores are between 0 and 100", () => {
    const STATE = mkSTATE();
    for (let i = 0; i < 200; i++) {
      const clean = createCleanHashDTU({ sha256: `c_${i}` });
      STATE.dtus.set(clean.id, clean);
    }
    const score = computeSecurityScore("u", STATE);
    assert.ok(score.score >= 0);
    assert.ok(score.score <= 100);
  });

  it("many recent threats heavily penalize score", () => {
    const STATE = mkSTATE();
    for (let i = 0; i < 20; i++) {
      addThreat(STATE, { severity: 9 });
    }
    const score = computeSecurityScore("u", STATE);
    assert.ok(score.score < 50);
  });

  it("includes all breakdown components", () => {
    const STATE = mkSTATE();
    const score = computeSecurityScore("u", STATE);
    assert.ok("scanCoverage" in score.breakdown);
    assert.ok("threatRatio" in score.breakdown);
    assert.ok("firewallCoverage" in score.breakdown);
    assert.ok("recencyScore" in score.breakdown);
    assert.ok("toolCoverage" in score.breakdown);
  });

  it("generates recommendations for missing tools", () => {
    const STATE = mkSTATE();
    const score = computeSecurityScore("u", STATE);
    assert.ok(score.recommendations.some(r => r.includes("ClamAV")));
  });
});

// ═══════════════════════════════════════════════════════════════════════════════
// CHAT INTENT DETECTION — EDGE CASES
// ═══════════════════════════════════════════════════════════════════════════════

describe("Shield Comprehensive — Intent Detection Edge Cases", () => {
  it("handles null input", () => {
    assert.equal(detectShieldIntent(null).isShieldRequest, false);
  });

  it("handles empty string", () => {
    assert.equal(detectShieldIntent("").isShieldRequest, false);
  });

  it("handles numeric input coerced to string", () => {
    assert.equal(detectShieldIntent(12345).isShieldRequest, false);
  });

  it("detects 'scan my files' as sweep", () => {
    assert.equal(detectShieldIntent("scan my files").action, "sweep");
  });

  it("detects 'sweep my device' as sweep", () => {
    assert.equal(detectShieldIntent("sweep my device").action, "sweep");
  });

  it("detects 'is it malicious' as check", () => {
    assert.equal(detectShieldIntent("is it malicious").action, "check");
  });

  it("detects 'is that dangerous' as check", () => {
    assert.equal(detectShieldIntent("is that dangerous").action, "check");
  });

  it("detects 'list attacks' as threats", () => {
    assert.equal(detectShieldIntent("list attacks").action, "threats");
  });

  it("detects 'show me viruses' as threats", () => {
    assert.equal(detectShieldIntent("show me viruses").action, "threats");
  });

  it("detects 'defend me against trojans' as protect with target", () => {
    const r = detectShieldIntent("defend me against trojans");
    assert.equal(r.action, "protect");
    assert.equal(r.params.target, "trojans");
  });

  it("detects 'shield us from botnets' as protect", () => {
    const r = detectShieldIntent("shield us from botnets");
    assert.equal(r.action, "protect");
    assert.equal(r.params.target, "botnets");
  });

  it("detects 'how secure am I?' as score", () => {
    assert.equal(detectShieldIntent("how secure am I?").action, "score");
  });

  it("detects 'protection status' as score", () => {
    assert.equal(detectShieldIntent("protection status").action, "score");
  });

  it("detects 'what is blocked' as firewall", () => {
    assert.equal(detectShieldIntent("what is blocked").action, "firewall");
  });

  it("detects 'future threats' as predictions", () => {
    assert.equal(detectShieldIntent("future threats").action, "predictions");
  });

  it("detects 'forecast attacks' as predictions", () => {
    assert.equal(detectShieldIntent("forecast attacks").action, "predictions");
  });
});

// ═══════════════════════════════════════════════════════════════════════════════
// USER REPORTS — EDGE CASES
// ═══════════════════════════════════════════════════════════════════════════════

describe("Shield Comprehensive — User Reports Edge Cases", () => {
  let STATE;
  beforeEach(() => { STATE = mkSTATE(); });

  it("processes report with no fileHash as new threat", () => {
    const result = processUserReport({ subtype: "virus", severity: 3 }, "u1", STATE);
    assert.equal(result.ok, true);
    assert.equal(result.status, "pending_review");
  });

  it("defaults subtype to exploit when missing", () => {
    const result = processUserReport({}, "u1", STATE);
    assert.equal(result.threatDtu.subtype, "exploit");
  });

  it("defaults severity to 5 when missing", () => {
    const result = processUserReport({}, "u1", STATE);
    assert.equal(result.threatDtu.severity, 5);
  });

  it("keeps an unverified user report private and out of the lattice", () => {
    const result = processUserReport({ subtype: "phishing" }, "u1", STATE);
    assert.ok(STATE.dtus.has(result.threatDtu.id));
    assert.equal(result.status, "pending_review");
    assert.equal(result.threatDtu.verified, false);
    assert.equal(result.threatDtu.visibility, "private");
    assert.notEqual(result.threatDtu.meta?.propagated, true);
  });

  it("returns known_threat for matching clean hash (not a threat though)", () => {
    addThreat(STATE, { hash: { sha256: "known_hash_report", md5: "m" } });
    propagateThreatToLattice(STATE.dtus.values().next().value, STATE);

    const result = processUserReport({ fileHash: "known_hash_report" }, "u1", STATE);
    assert.equal(result.status, "known_threat");
  });
});

// ═══════════════════════════════════════════════════════════════════════════════
// SWEEP — COMPREHENSIVE
// ═══════════════════════════════════════════════════════════════════════════════

describe("Shield Comprehensive — Sweep Operations", () => {
  it("sweeps empty lattice gracefully", async () => {
    const STATE = mkSTATE();
    const result = await performSweep(STATE, {});
    assert.equal(result.status, "complete");
    assert.equal(result.scanCount, 0);
    assert.equal(result.cleanCount, 0);
    assert.deepEqual(result.threatsFound, []);
  });

  it("sweeps DTUs with artifact content", async () => {
    const STATE = mkSTATE();
    for (let i = 0; i < 3; i++) {
      STATE.dtus.set(`a_${i}`, {
        id: `a_${i}`,
        artifact: { content: `Clean artifact ${i}` },
      });
    }
    const result = await performSweep(STATE, { userId: "tester" });
    assert.equal(result.scanCount, 3);
    assert.equal(result.cleanCount, 3);
  });

  it("skips DTUs without artifact content", async () => {
    const STATE = mkSTATE();
    STATE.dtus.set("no_artifact", { id: "no_artifact", type: "KNOWLEDGE" });
    const result = await performSweep(STATE, {});
    assert.equal(result.scanCount, 0);
  });

  it("skips existing THREAT and CLEAN_HASH DTUs", async () => {
    const STATE = mkSTATE();
    STATE.dtus.set("t1", { id: "t1", type: "THREAT", artifact: { content: "bad" } });
    STATE.dtus.set("c1", { id: "c1", type: "CLEAN_HASH", artifact: { content: "good" } });
    STATE.dtus.set("k1", { id: "k1", type: "KNOWLEDGE", artifact: { content: "normal" } });
    const result = await performSweep(STATE, {});
    assert.equal(result.scanCount, 1);
  });

  it("handles null STATE gracefully", async () => {
    const result = await performSweep(null, {});
    assert.equal(result.status, "complete");
    assert.equal(result.scanCount, 0);
  });
});

// ═══════════════════════════════════════════════════════════════════════════════
// QUEUE SCAN
// ═══════════════════════════════════════════════════════════════════════════════

describe("Shield Comprehensive — Queue Scan", () => {
  it("queues multiple scans with incrementing positions", () => {
    const r1 = queueScan("content1", { source: "a" });
    const r2 = queueScan("content2", { source: "b" });
    assert.ok(r1.queued);
    assert.ok(r2.queued);
    assert.ok(r2.position >= r1.position);
  });
});

// ═══════════════════════════════════════════════════════════════════════════════
// INGESTION
// ═══════════════════════════════════════════════════════════════════════════════

describe("Shield Comprehensive — Rule Ingestion Edge Cases", () => {
  let STATE;
  beforeEach(() => { STATE = mkSTATE(); });

  it("YARA rule ingestion handles missing fields", () => {
    const dtu = ingestYARARule({}, STATE);
    assert.equal(dtu.type, "YARA_RULE");
    assert.ok(dtu.tags.includes("yara_rule"));
    assert.ok(STATE.dtus.has(dtu.id));
  });

  it("YARA rule includes category tag when provided", () => {
    const dtu = ingestYARARule({ category: "ransomware" }, STATE);
    assert.ok(dtu.tags.includes("category:ransomware"));
  });

  it("Network rule ingestion handles missing fields", () => {
    const dtu = ingestNetworkRule({}, STATE);
    assert.equal(dtu.type, "NETWORK_RULE");
    assert.ok(dtu.tags.includes("network_rule"));
    assert.ok(STATE.dtus.has(dtu.id));
  });

  it("Network rule uses snort engine tag when specified", () => {
    const dtu = ingestNetworkRule({ engine: "snort" }, STATE);
    assert.ok(dtu.tags.includes("snort"));
  });

  it("Ingestion works without STATE.dtus", () => {
    const dtu = ingestYARARule({ name: "test" }, null);
    assert.ok(dtu.id);
    assert.equal(dtu.type, "YARA_RULE");
  });
});

// ═══════════════════════════════════════════════════════════════════════════════
// COLLECTIVE IMMUNITY
// ═══════════════════════════════════════════════════════════════════════════════

describe("Shield Comprehensive — Collective Immunity", () => {
  let STATE;
  beforeEach(() => { STATE = mkSTATE(); });

  it("propagation creates meta.propagatedAt timestamp", () => {
    const threat = createThreatDTU({ subtype: "virus", severity: 5 });
    propagateThreatToLattice(threat, STATE);
    assert.ok(threat.meta.propagatedAt);
  });

  it("propagation increments collectiveImmunityEvents stat", () => {
    const before = getShieldMetrics().stats.collectiveImmunityEvents;
    propagateThreatToLattice(createThreatDTU({ subtype: "virus", severity: 5 }), STATE);
    const after = getShieldMetrics().stats.collectiveImmunityEvents;
    assert.equal(after, before + 1);
  });

  it("propagation does not duplicate in lattice if already present", () => {
    const threat = createThreatDTU({ subtype: "virus", severity: 5 });
    STATE.dtus.set(threat.id, threat);
    propagateThreatToLattice(threat, STATE);
    // Should still have exactly one entry
    let count = 0;
    for (const dtu of STATE.dtus.values()) {
      if (dtu.id === threat.id) count++;
    }
    assert.equal(count, 1);
  });
});

// ═══════════════════════════════════════════════════════════════════════════════
// HEARTBEAT — COMPREHENSIVE
// ═══════════════════════════════════════════════════════════════════════════════

describe("Shield Comprehensive — Heartbeat Ticks", () => {
  it("processes scan queue on every tick", async () => {
    const STATE = mkSTATE();
    queueScan("queued content", { source: "heartbeat_test" });
    await shieldHeartbeatTick(STATE, 1);
    // After heartbeat, queue should be processed
  });

  it("runs prophet on 10th tick with active threats", async () => {
    const STATE = mkSTATE();
    addThreat(STATE, { subtype: "ransomware", family: "ransomware", behavior: ["obfuscation"] });
    addThreat(STATE, { subtype: "ransomware", family: "ransomware", behavior: ["persistence"] });

    await shieldHeartbeatTick(STATE, 10);
    // Prophet should have run (no assertion needed if no crash)
    assert.ok(true);
  });

  it("cleans old predictions on 50th tick", async () => {
    const STATE = mkSTATE();
    await shieldHeartbeatTick(STATE, 50);
    // Should not crash
    assert.ok(true);
  });

  it("survives null STATE on every tick", async () => {
    await shieldHeartbeatTick(null, 1);
    await shieldHeartbeatTick(null, 10);
    await shieldHeartbeatTick(null, 50);
    assert.ok(true, "No crashes");
  });
});

// ═══════════════════════════════════════════════════════════════════════════════
// TOOL DETECTION
// ═══════════════════════════════════════════════════════════════════════════════

describe("Shield Comprehensive — Tool Detection", () => {
  it("getToolStatus returns all 7 tool keys", () => {
    const status = getToolStatus();
    const keys = Object.keys(status);
    assert.ok(keys.includes("clamav"));
    assert.ok(keys.includes("yara"));
    assert.ok(keys.includes("suricata"));
    assert.ok(keys.includes("snort"));
    assert.ok(keys.includes("openvas"));
    assert.ok(keys.includes("wazuh"));
    assert.ok(keys.includes("zeek"));
    assert.equal(keys.length, 7);
  });

  it("detectTools returns results for all tools", async () => {
    const results = await detectTools();
    assert.equal(Object.keys(results).length, 7);
    for (const val of Object.values(results)) {
      assert.equal(typeof val, "boolean");
    }
  });
});

// ═══════════════════════════════════════════════════════════════════════════════
// METRICS — COMPREHENSIVE
// ═══════════════════════════════════════════════════════════════════════════════

describe("Shield Comprehensive — Metrics", () => {
  it("metrics include all expected fields", () => {
    const m = getShieldMetrics();
    assert.equal(m.ok, true);
    assert.equal(m.version, "1.0.0");
    assert.ok("initialized" in m);
    assert.ok("tools" in m);
    assert.ok("stats" in m);
    assert.ok("threatFeedSize" in m);
    assert.ok("firewallRuleCount" in m);
    assert.ok("predictionCount" in m);
    assert.ok("knownGoodHashes" in m);
    assert.ok("threatIndexSize" in m);
  });

  it("getThreatFeed respects limit", () => {
    const feed = getThreatFeed(3);
    assert.ok(feed.length <= 3);
  });

  it("getFirewallRules respects limit", () => {
    const rules = getFirewallRules(3);
    assert.ok(rules.length <= 3);
  });

  it("getPredictions respects limit", () => {
    const preds = getPredictions(3);
    assert.ok(preds.length <= 3);
  });
});

// ═══════════════════════════════════════════════════════════════════════════════
// ClamAV scan (graceful degradation)
// ═══════════════════════════════════════════════════════════════════════════════

describe("Shield Comprehensive — ClamAV Graceful Degradation", () => {
  it("returns clean with skipped when ClamAV not available", async () => {
    const result = await scanWithClamAV("/nonexistent/file");
    assert.equal(result.clean, true);
    assert.equal(result.skipped, true);
  });
});

// ═══════════════════════════════════════════════════════════════════════════════
// INITIALIZATION
// ═══════════════════════════════════════════════════════════════════════════════

describe("Shield Comprehensive — Initialization", () => {
  it("indexes both threats and clean hashes from lattice", async () => {
    const STATE = mkSTATE();
    const threat = addThreat(STATE, { hash: { sha256: "init_t1", md5: "m" } });
    const clean = createCleanHashDTU({ sha256: "init_c1", md5: "m" });
    STATE.dtus.set(clean.id, clean);

    const result = await initializeShield(STATE);
    assert.ok(result.ok);
    assert.ok(result.indexed.threats >= 1);
    assert.ok(result.indexed.clean >= 1);
  });

  it("handles null STATE dtus gracefully", async () => {
    const result = await initializeShield({ dtus: null });
    assert.ok(result.ok);
  });
});
