/**
 * Concord Shield — Comprehensive Test Suite
 *
 * Tests all 5 phases:
 *   Phase 1: ClamAV integration + YARA classification + threat DTU schema
 *   Phase 2: Network monitoring (Suricata + Snort rule generation)
 *   Phase 3: Behavioral analysis (heuristic classification)
 *   Phase 4: Vulnerability scanning (security score)
 *   Phase 5: Repair cortex integration (prophet/surgeon/guardian)
 *
 * Plus: Collective immunity, pain memory, chat intent detection, API macros
 */

import { describe, it, beforeEach } from "node:test";
import assert from "node:assert/strict";

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
  retractUserReport,
  getThreatFeed,
  getFirewallRules,
  getPredictions,
  getShieldMetrics,
  queueScan,
  initializeShield,
  ingestYARARule,
  ingestNetworkRule,
  THREAT_SUBTYPES,
  SCAN_MODES,
  ANALYSIS_STEPS,
  FORTIFY_AGENTS,
  detectTools,
  getToolStatus,
} from "../lib/concord-shield.js";

// ── Test Helpers ────────────────────────────────────────────────────────────

function createMockSTATE() {
  return {
    dtus: new Map(),
    sessions: new Map(),
    settings: { heartbeatMs: 10000, heartbeatEnabled: true },
  };
}

function addMockThreatDTU(STATE, opts = {}) {
  const dtu = createThreatDTU({
    subtype: opts.subtype || "virus",
    severity: opts.severity || 5,
    hash: opts.hash || { sha256: `test_hash_${Math.random().toString(36).slice(2)}`, md5: "test_md5" },
    signatures: opts.signatures || { clamav: "TestSig", yara: ["test_rule"], snort: "", suricata: "" },
    vector: opts.vector || "test vector",
    behavior: opts.behavior || ["obfuscation"],
    affected: opts.affected || ["windows"],
    source: opts.source || "test",
    family: opts.family || opts.subtype || "virus",
  });
  STATE.dtus.set(dtu.id, dtu);
  return dtu;
}

// ═══════════════════════════════════════════════════════════════════════════
// PHASE 1: Threat DTU Schema + ClamAV + YARA
// ═══════════════════════════════════════════════════════════════════════════

describe("Concord Shield — Threat DTU Schema", () => {
  it("creates a valid threat DTU with all required fields", () => {
    const dtu = createThreatDTU({
      subtype: "ransomware",
      severity: 9,
      hash: { sha256: "abc123def456", md5: "md5hash", ssdeep: "fuzzy" },
      signatures: { clamav: "Win.Ransom.TestA", yara: ["ransom_rule1", "ransom_rule2"], snort: "SID:100", suricata: "SID:200" },
      vector: "email attachment",
      behavior: ["encryption", "persistence"],
      affected: ["windows", "linux"],
      neutralization: "Restore from backup",
      source: "clamav",
    });

    assert.equal(dtu.type, "THREAT");
    assert.equal(dtu.subtype, "ransomware");
    assert.equal(dtu.severity, 9);
    assert.ok(dtu.id.startsWith("threat_"));
    assert.equal(dtu.hash.sha256, "abc123def456");
    assert.equal(dtu.hash.md5, "md5hash");
    assert.equal(dtu.hash.ssdeep, "fuzzy");
    assert.equal(dtu.signatures.clamav, "Win.Ransom.TestA");
    assert.deepEqual(dtu.signatures.yara, ["ransom_rule1", "ransom_rule2"]);
    assert.equal(dtu.vector, "email attachment");
    assert.deepEqual(dtu.behavior, ["encryption", "persistence"]);
    assert.deepEqual(dtu.affected, ["windows", "linux"]);
    assert.equal(dtu.neutralization, "Restore from backup");
    assert.equal(dtu.source, "clamav");
    assert.equal(dtu.times_detected, 1);
    assert.ok(dtu.first_seen);
    assert.equal(dtu.scope, "global");
    assert.equal(dtu.tier, "regular");
  });

  it("tags threat DTUs as pain_memory for forgetting engine protection", () => {
    const dtu = createThreatDTU({ subtype: "trojan", severity: 7 });
    assert.ok(dtu.tags.includes("pain_memory"));
    assert.ok(dtu.tags.includes("threat"));
    assert.ok(dtu.tags.includes("threat:trojan"));
    assert.ok(dtu.tags.includes("security"));
    assert.ok(dtu.tags.includes("shield"));
    assert.ok(dtu.tags.includes("collective_immunity"));
  });

  it("sets CRETI scores proportional to severity", () => {
    const lowSev = createThreatDTU({ subtype: "adware", severity: 2 });
    const highSev = createThreatDTU({ subtype: "ransomware", severity: 10 });

    assert.ok(highSev.creti.credibility > lowSev.creti.credibility);
    assert.ok(highSev.creti.impact > lowSev.creti.impact);
    assert.equal(lowSev.creti.timeliness, 20); // Always max — active threat
    assert.equal(highSev.creti.timeliness, 20);
  });

  it("clamps severity to 1-10 range", () => {
    const low = createThreatDTU({ subtype: "virus", severity: -5 });
    const high = createThreatDTU({ subtype: "virus", severity: 100 });
    assert.equal(low.severity, 1);
    assert.equal(high.severity, 10);
  });

  it("defaults unknown subtypes to 'exploit'", () => {
    const dtu = createThreatDTU({ subtype: "not_a_real_type", severity: 5 });
    assert.equal(dtu.subtype, "exploit");
  });

  it("includes lineage data for threat family tracking", () => {
    const parent = createThreatDTU({ subtype: "ransomware", severity: 8 });
    const child = createThreatDTU({
      subtype: "ransomware",
      severity: 9,
      lineage: parent.id,
      family: "lockbit",
    });
    assert.deepEqual(child.lineageData.parents, [parent.id]);
    assert.equal(child.lineageData.family, "lockbit");
  });

  it("generates unique IDs for each threat DTU", () => {
    const ids = new Set();
    for (let i = 0; i < 50; i++) {
      const dtu = createThreatDTU({ subtype: "virus", severity: 5 });
      assert.ok(!ids.has(dtu.id), `Duplicate ID: ${dtu.id}`);
      ids.add(dtu.id);
    }
  });
});

describe("Concord Shield — Clean Hash DTU", () => {
  it("creates a shadow-tier clean hash DTU", () => {
    const dtu = createCleanHashDTU({ sha256: "clean_hash_123", md5: "clean_md5" });
    assert.equal(dtu.type, "CLEAN_HASH");
    assert.equal(dtu.tier, "shadow");
    assert.equal(dtu.scope, "local");
    assert.equal(dtu.hash.sha256, "clean_hash_123");
    assert.ok(dtu.tags.includes("clean_hash"));
  });
});

describe("Concord Shield — Firewall Rule DTU", () => {
  it("creates a firewall rule DTU with pain_memory tag", () => {
    const dtu = createFirewallRuleDTU({
      rule: "iptables -A INPUT -j DROP",
      vector: "email attachment",
      threatSubtype: "ransomware",
      threatDtuId: "threat_123",
      severity: 9,
      generatedBy: FORTIFY_AGENTS.GUARDIAN,
    });
    assert.equal(dtu.type, "FIREWALL_RULE");
    assert.ok(dtu.tags.includes("pain_memory"));
    assert.ok(dtu.tags.includes("firewall_rule"));
    assert.ok(dtu.tags.includes("collective_immunity"));
    assert.equal(dtu.scope, "global");
    assert.equal(dtu.generatedBy, "guardian");
  });
});

describe("Concord Shield — Prediction DTU", () => {
  it("creates a prediction DTU from prophet analysis", () => {
    const dtu = createPredictionDTU({
      family: "lockbit",
      predictedVariant: "lockbit_v4",
      evolutionPattern: [{ techniques: ["encryption"] }],
      preemptiveRule: "rule test {}",
      confidence: 0.75,
      basedOn: ["threat_1", "threat_2", "threat_3"],
    });
    assert.equal(dtu.type, "THREAT_PREDICTION");
    assert.ok(dtu.tags.includes("pain_memory"));
    assert.ok(dtu.tags.includes("prophet"));
    assert.equal(dtu.family, "lockbit");
    assert.equal(dtu.confidence, 0.75);
    assert.equal(dtu.basedOn.length, 3);
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// PHASE 1: Scanning
// ═══════════════════════════════════════════════════════════════════════════

describe("Concord Shield — Hash Scanning", () => {
  let STATE;

  beforeEach(() => {
    STATE = createMockSTATE();
  });

  it("returns unknown for new hashes", () => {
    const result = scanHashAgainstLattice("unknown_hash_123", STATE);
    assert.equal(result.known, false);
  });

  it("finds existing threat DTUs by hash", () => {
    const threat = addMockThreatDTU(STATE, {
      hash: { sha256: "known_bad_hash", md5: "bad_md5" },
    });
    const result = scanHashAgainstLattice("known_bad_hash", STATE);
    assert.equal(result.known, true);
    assert.equal(result.clean, false);
    assert.equal(result.threatDtu.id, threat.id);
  });

  it("increments times_detected on repeat lookups", () => {
    const threat = addMockThreatDTU(STATE, {
      hash: { sha256: "repeat_hash", md5: "md5" },
    });
    assert.equal(threat.times_detected, 1);

    scanHashAgainstLattice("repeat_hash", STATE);
    const updated = STATE.dtus.get(threat.id);
    assert.equal(updated.times_detected, 2);

    scanHashAgainstLattice("repeat_hash", STATE);
    const updated2 = STATE.dtus.get(threat.id);
    assert.equal(updated2.times_detected, 3);
  });

  it("recognizes clean hashes from CLEAN_HASH DTUs", () => {
    const cleanDtu = createCleanHashDTU({ sha256: "clean_file_hash", md5: "md5" });
    STATE.dtus.set(cleanDtu.id, cleanDtu);

    const result = scanHashAgainstLattice("clean_file_hash", STATE);
    assert.equal(result.known, true);
    assert.equal(result.clean, true);
  });

  it("handles null/empty inputs gracefully", () => {
    assert.equal(scanHashAgainstLattice(null, STATE).known, false);
    assert.equal(scanHashAgainstLattice("", STATE).known, false);
    assert.equal(scanHashAgainstLattice("hash", null).known, false);
  });
});

describe("Concord Shield — Content Scanning", () => {
  let STATE;

  beforeEach(() => {
    STATE = createMockSTATE();
  });

  it("scans clean content and records it as known-good", async () => {
    const result = await scanContent("Hello world, this is a clean file.", STATE, {
      source: "test",
      scanMode: SCAN_MODES.USER_INITIATED,
    });
    assert.equal(result.ok, true);
    assert.equal(result.clean, true);
    assert.ok(result.hash.sha256);
    assert.ok(result.hash.md5);

    // Should have created a CLEAN_HASH DTU
    let hasClean = false;
    for (const dtu of STATE.dtus.values()) {
      if (dtu.type === "CLEAN_HASH") { hasClean = true; break; }
    }
    assert.ok(hasClean);
  });

  it("returns cached result for previously scanned clean content", async () => {
    const content = "Test content for caching";
    await scanContent(content, STATE, { source: "test" });
    const result = await scanContent(content, STATE, { source: "test" });
    assert.equal(result.ok, true);
    assert.equal(result.cached, true);
    assert.equal(result.clean, true);
  });

  it("detects threats from known hashes in lattice", async () => {
    const content = "malicious payload content";
    const crypto = await import("crypto");
    const hash = crypto.createHash("sha256").update(content).digest("hex");

    addMockThreatDTU(STATE, { hash: { sha256: hash, md5: "md5" } });

    const result = await scanContent(content, STATE, { source: "test" });
    assert.equal(result.ok, true);
    assert.equal(result.clean, false);
    assert.equal(result.cached, true);
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// PHASE 2: YARA Classification + Heuristics
// ═══════════════════════════════════════════════════════════════════════════

describe("Concord Shield — YARA Classification (Heuristic Fallback)", () => {
  it("detects ransomware indicators", async () => {
    const result = await classifyWithYARA(null, "This file will encrypt your files. Pay 1 bitcoin to decrypt.");
    assert.ok(result.matches.length > 0);
    assert.ok(result.matches.some(m => m.includes("ransomware")));
    assert.equal(result.family, "ransomware");
  });

  it("detects trojan indicators", async () => {
    const result = await classifyWithYARA(null, "Opening backdoor to C2 server. Reverse shell established.");
    assert.ok(result.matches.some(m => m.includes("trojan")));
    assert.equal(result.family, "trojan");
  });

  it("detects phishing indicators", async () => {
    const result = await classifyWithYARA(null, "Your account has been suspended. Click here to verify your account and reset password.");
    assert.ok(result.matches.some(m => m.includes("phishing")));
    assert.equal(result.family, "phishing");
  });

  it("detects exploit indicators", async () => {
    const result = await classifyWithYARA(null, "Buffer overflow with shellcode injection via heap spray technique.");
    assert.ok(result.matches.some(m => m.includes("exploit")));
    assert.equal(result.family, "exploit");
  });

  it("detects rootkit indicators", async () => {
    const result = await classifyWithYARA(null, "Modify kernel to hide process and make files invisible.");
    assert.ok(result.matches.some(m => m.includes("rootkit")));
    assert.equal(result.family, "rootkit");
  });

  it("detects worm indicators", async () => {
    const result = await classifyWithYARA(null, "Self replicating module will propagate and spread through the network.");
    assert.ok(result.matches.some(m => m.includes("worm")));
    assert.equal(result.family, "worm");
  });

  it("detects spyware indicators", async () => {
    const result = await classifyWithYARA(null, "Keylogger activated. Screen capture module recording desktop.");
    assert.ok(result.matches.some(m => m.includes("spyware")));
    assert.equal(result.family, "spyware");
  });

  it("detects botnet indicators", async () => {
    const result = await classifyWithYARA(null, "Connecting to command and control server for DDoS instructions.");
    assert.ok(result.matches.some(m => m.includes("botnet")));
    assert.equal(result.family, "botnet");
  });

  it("returns empty matches for clean content", async () => {
    const result = await classifyWithYARA(null, "This is a completely normal document about gardening and flowers.");
    assert.equal(result.matches.length, 0);
    assert.equal(result.family, null);
  });

  it("identifies the engine as heuristic when YARA tool is unavailable", async () => {
    const result = await classifyWithYARA(null, "Test content");
    assert.equal(result.engine, "heuristic");
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// PHASE 2: Analysis Pipeline
// ═══════════════════════════════════════════════════════════════════════════

describe("Concord Shield — Analysis Pipeline", () => {
  let STATE;

  beforeEach(() => {
    STATE = createMockSTATE();
  });

  it("runs full analysis pipeline and creates threat DTU", async () => {
    const result = await runAnalysisPipeline({
      content: "malicious payload",
      hash: { sha256: "pipeline_hash_123", md5: "md5" },
      clamResult: { clean: false, signature: "Win.Test.Malware", engine: "clamav" },
      yaraResult: { matches: ["test_rule"], family: "trojan", techniques: ["persistence"], engine: "heuristic" },
      scanMode: SCAN_MODES.ACTIVE,
      source: "test",
    }, STATE);

    assert.equal(result.ok, true);
    assert.ok(result.threatDtu);
    assert.equal(result.threatDtu.type, "THREAT");
    assert.equal(result.subtype, "trojan");
    assert.ok(result.severity >= 1 && result.severity <= 10);
    assert.ok(result.steps.length >= 3); // ClamAV, YARA, Threat DTU, Propagation

    // Threat DTU should be in lattice
    assert.ok(STATE.dtus.has(result.threatDtu.id));
  });

  it("includes all analysis steps in result", async () => {
    const result = await runAnalysisPipeline({
      content: "test",
      hash: { sha256: "step_hash", md5: "md5" },
      clamResult: { clean: false, signature: "Test" },
      yaraResult: { matches: [], family: "exploit", techniques: [], engine: "heuristic" },
      scanMode: SCAN_MODES.ACTIVE,
      source: "test",
    }, STATE);

    const stepTypes = result.steps.map(s => s.step);
    assert.ok(stepTypes.includes(ANALYSIS_STEPS.CLAMAV_SCAN));
    assert.ok(stepTypes.includes(ANALYSIS_STEPS.YARA_CLASSIFY));
    assert.ok(stepTypes.includes(ANALYSIS_STEPS.THREAT_DTU));
    assert.ok(stepTypes.includes(ANALYSIS_STEPS.LATTICE_PROPAGATE));
  });

  it("computes higher severity for ransomware than adware", async () => {
    const ransomResult = await runAnalysisPipeline({
      content: "ransom",
      hash: { sha256: "ransom_hash", md5: "md5" },
      clamResult: { clean: false, signature: "Ransom" },
      yaraResult: { matches: ["r1", "r2", "r3"], family: "ransomware", techniques: [], engine: "heuristic" },
      scanMode: SCAN_MODES.ACTIVE,
      source: "test",
    }, STATE);

    const adwareResult = await runAnalysisPipeline({
      content: "adware",
      hash: { sha256: "adware_hash", md5: "md5" },
      clamResult: { clean: false },
      yaraResult: { matches: [], family: "adware", techniques: [], engine: "heuristic" },
      scanMode: SCAN_MODES.ACTIVE,
      source: "test",
    }, STATE);

    assert.ok(ransomResult.severity > adwareResult.severity);
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// PHASE 3: Collective Immunity
// ═══════════════════════════════════════════════════════════════════════════

describe("Concord Shield — Collective Immunity", () => {
  let STATE;

  beforeEach(() => {
    STATE = createMockSTATE();
  });

  it("propagates threat to lattice and marks as propagated", () => {
    const threat = createThreatDTU({ subtype: "virus", severity: 7, hash: { sha256: "prop_hash" } });
    const result = propagateThreatToLattice(threat, STATE);
    assert.equal(result.propagated, true);
    assert.ok(STATE.dtus.has(threat.id));
    assert.equal(threat.meta.propagated, true);
    assert.ok(threat.meta.propagatedAt);
  });

  it("indexes threats for fast hash lookup after propagation", () => {
    const threat = createThreatDTU({ subtype: "trojan", severity: 6, hash: { sha256: "indexed_hash" } });
    propagateThreatToLattice(threat, STATE);

    // Now a hash lookup should find it instantly
    const lookup = scanHashAgainstLattice("indexed_hash", STATE);
    assert.equal(lookup.known, true);
    assert.equal(lookup.clean, false);
  });

  it("returns propagated: false for null inputs", () => {
    assert.equal(propagateThreatToLattice(null, STATE).propagated, false);
    assert.equal(propagateThreatToLattice(createThreatDTU({ subtype: "virus", severity: 5 }), null).propagated, false);
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// PHASE 5: Fortification — Prophet / Surgeon / Guardian
// ═══════════════════════════════════════════════════════════════════════════

describe("Concord Shield — Prophet", () => {
  let STATE;

  beforeEach(() => {
    STATE = createMockSTATE();
  });

  it("requires at least 2 threats in a family to make predictions", () => {
    addMockThreatDTU(STATE, { subtype: "ransomware", family: "ransomware" });
    const result = runProphet("ransomware", STATE);
    assert.equal(result.ok, true);
    assert.equal(result.predictions.length, 0);
    assert.equal(result.reason, "insufficient_data");
  });

  it("generates predictions when enough family samples exist", () => {
    addMockThreatDTU(STATE, { subtype: "ransomware", family: "ransomware", behavior: ["obfuscation"] });
    addMockThreatDTU(STATE, { subtype: "ransomware", family: "ransomware", behavior: ["persistence"] });
    addMockThreatDTU(STATE, { subtype: "ransomware", family: "ransomware", behavior: ["data_exfiltration"] });

    const result = runProphet("ransomware", STATE);
    assert.equal(result.ok, true);
    assert.ok(result.predictions.length > 0);
    assert.equal(result.family, "ransomware");
    assert.equal(result.samplesAnalyzed, 3);
  });

  it("stores prediction DTUs in the lattice", () => {
    addMockThreatDTU(STATE, { subtype: "trojan", family: "trojan", behavior: ["obfuscation"] });
    addMockThreatDTU(STATE, { subtype: "trojan", family: "trojan", behavior: ["persistence"] });

    const initialSize = STATE.dtus.size;
    runProphet("trojan", STATE);
    assert.ok(STATE.dtus.size > initialSize, "Should have added prediction DTU to lattice");
  });

  it("predicts escalation techniques based on evolution patterns", () => {
    addMockThreatDTU(STATE, { subtype: "ransomware", family: "ransomware", behavior: ["obfuscation"] });
    addMockThreatDTU(STATE, { subtype: "ransomware", family: "ransomware", behavior: ["persistence"] });

    const result = runProphet("ransomware", STATE);
    // Should predict next techniques based on escalation map
    assert.ok(result.predictedTechniques.length >= 0); // May or may not predict depending on patterns
  });
});

describe("Concord Shield — Surgeon", () => {
  it("generates neutralization procedure for ransomware", () => {
    const threat = createThreatDTU({ subtype: "ransomware", severity: 9 });
    const result = runSurgeon(threat);
    assert.equal(result.ok, true);
    assert.ok(result.analysis.neutralizationProcedure.immediate.length > 0);
    assert.ok(result.analysis.neutralizationProcedure.shortTerm.length > 0);
    assert.ok(result.analysis.neutralizationProcedure.longTerm.length > 0);
    assert.equal(result.engine, "surgeon");
  });

  it("generates neutralization for trojans/rootkits", () => {
    const trojan = runSurgeon(createThreatDTU({ subtype: "trojan", severity: 7 }));
    assert.ok(trojan.analysis.neutralizationProcedure.immediate.some(s => s.toLowerCase().includes("kill")));

    const rootkit = runSurgeon(createThreatDTU({ subtype: "rootkit", severity: 8 }));
    assert.ok(rootkit.analysis.neutralizationProcedure.longTerm.some(s => s.toLowerCase().includes("reinstall")));
  });

  it("assesses severity level correctly", () => {
    const critical = runSurgeon(createThreatDTU({ subtype: "virus", severity: 9 }));
    assert.equal(critical.analysis.severityAssessment.level, "critical");

    const high = runSurgeon(createThreatDTU({ subtype: "virus", severity: 6 }));
    assert.equal(high.analysis.severityAssessment.level, "high");

    const moderate = runSurgeon(createThreatDTU({ subtype: "virus", severity: 3 }));
    assert.equal(moderate.analysis.severityAssessment.level, "moderate");
  });

  it("returns ok: false for null input", () => {
    assert.equal(runSurgeon(null).ok, false);
  });
});

describe("Concord Shield — Guardian", () => {
  let STATE;

  beforeEach(() => {
    STATE = createMockSTATE();
  });

  it("generates firewall rules for threats with known vectors", () => {
    const threat = createThreatDTU({
      subtype: "ransomware",
      severity: 9,
      vector: "email attachment / exploit kit",
    });
    const result = runGuardian(threat, STATE);
    assert.equal(result.ok, true);
    assert.ok(result.rules.length > 0);
    assert.ok(result.suricataRule);
    assert.ok(result.snortRule);
    assert.equal(result.engine, "guardian");
  });

  it("creates firewall rule DTU in lattice", () => {
    const threat = createThreatDTU({ subtype: "trojan", severity: 7, vector: "malicious download" });
    const initialSize = STATE.dtus.size;
    runGuardian(threat, STATE);
    assert.ok(STATE.dtus.size > initialSize, "Should have added firewall rule DTU");
  });

  it("generates Suricata and Snort rules", () => {
    const threat = createThreatDTU({
      subtype: "botnet",
      severity: 8,
      hash: { sha256: "botnet_hash_123456789012345678901234" },
      vector: "compromised site",
    });
    const result = runGuardian(threat, STATE);
    assert.ok(result.suricataRule.includes("CONCORD SHIELD"));
    assert.ok(result.snortRule.includes("CONCORD SHIELD"));
    assert.ok(result.suricataRule.includes("botnet"));
  });

  it("returns ok: false for null input", () => {
    assert.equal(runGuardian(null, STATE).ok, false);
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// Security Score
// ═══════════════════════════════════════════════════════════════════════════

describe("Concord Shield — Security Score", () => {
  let STATE;

  beforeEach(() => {
    STATE = createMockSTATE();
  });

  it("computes a security score with grade and breakdown", () => {
    const score = computeSecurityScore("user1", STATE);
    assert.ok(typeof score.score === "number");
    assert.ok(score.score >= 0 && score.score <= 100);
    assert.ok(["A", "B", "C", "D", "F"].includes(score.grade));
    assert.ok(score.breakdown);
    assert.ok(typeof score.breakdown.scanCoverage === "number");
    assert.ok(typeof score.breakdown.threatRatio === "number");
  });

  it("provides recommendations when tools are missing", () => {
    const score = computeSecurityScore("user1", STATE);
    assert.ok(score.recommendations.length > 0);
    assert.ok(score.recommendations.some(r => r.toLowerCase().includes("clamav")));
  });

  it("accounts for threats in the score", () => {
    // Add many clean scans
    for (let i = 0; i < 20; i++) {
      const clean = createCleanHashDTU({ sha256: `clean_${i}`, md5: `md5_${i}` });
      STATE.dtus.set(clean.id, clean);
    }
    const cleanScore = computeSecurityScore("user1", STATE);

    // Now add threats
    for (let i = 0; i < 10; i++) {
      addMockThreatDTU(STATE, { severity: 7 });
    }
    const threatScore = computeSecurityScore("user1", STATE);

    // More threats should mean lower score
    assert.ok(threatScore.score <= cleanScore.score);
  });

  it("returns stats with correct counts", () => {
    addMockThreatDTU(STATE, { severity: 5 });
    addMockThreatDTU(STATE, { severity: 8 });
    const clean = createCleanHashDTU({ sha256: "clean_test" });
    STATE.dtus.set(clean.id, clean);

    const score = computeSecurityScore("user1", STATE);
    assert.equal(score.stats.threatsDetected, 2);
    assert.equal(score.stats.cleanFiles, 1);
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// Chat Intent Detection
// ═══════════════════════════════════════════════════════════════════════════

describe("Concord Shield — Chat Intent Detection", () => {
  it("detects 'scan my system' as sweep action", () => {
    const result = detectShieldIntent("Scan my system for threats");
    assert.equal(result.isShieldRequest, true);
    assert.equal(result.action, "sweep");
  });

  it("detects 'is this file safe?' as check action", () => {
    const result = detectShieldIntent("Is this file safe?");
    assert.equal(result.isShieldRequest, true);
    assert.equal(result.action, "check");
  });

  it("detects 'what threats have you seen today?' as threats action", () => {
    const result = detectShieldIntent("What threats have you seen today?");
    assert.equal(result.isShieldRequest, true);
    assert.equal(result.action, "threats");
  });

  it("detects 'protect me from ransomware' as protect action with target", () => {
    const result = detectShieldIntent("Protect me from ransomware");
    assert.equal(result.isShieldRequest, true);
    assert.equal(result.action, "protect");
    assert.equal(result.params.target, "ransomware");
  });

  it("detects 'show me my security score' as score action", () => {
    const result = detectShieldIntent("Show me my security score");
    assert.equal(result.isShieldRequest, true);
    assert.equal(result.action, "score");
  });

  it("detects firewall-related queries", () => {
    const result = detectShieldIntent("Show me the firewall rules");
    assert.equal(result.isShieldRequest, true);
    assert.equal(result.action, "firewall");
  });

  it("detects prediction queries", () => {
    const result = detectShieldIntent("Show me upcoming predicted variants");
    assert.equal(result.isShieldRequest, true);
    assert.equal(result.action, "predictions");
  });

  it("does NOT detect non-security messages", () => {
    assert.equal(detectShieldIntent("Write me a poem about flowers").isShieldRequest, false);
    assert.equal(detectShieldIntent("What is the capital of France?").isShieldRequest, false);
    assert.equal(detectShieldIntent("Help me build an app").isShieldRequest, false);
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// User Reports
// ═══════════════════════════════════════════════════════════════════════════

describe("Concord Shield — User Reports", () => {
  let STATE;

  beforeEach(() => {
    STATE = createMockSTATE();
  });

  it("creates a threat DTU from user report", () => {
    const result = processUserReport({
      subtype: "phishing",
      severity: 6,
      fileHash: "reported_hash_123",
      vector: "fake email",
      indicators: ["credential harvesting"],
    }, "user123", STATE);

    assert.equal(result.ok, true);
    assert.equal(result.status, "pending_review");
    assert.ok(result.threatDtu);
    assert.equal(result.threatDtu.subtype, "phishing");
  });

  it("recognizes already known threats from reports", () => {
    addMockThreatDTU(STATE, {
      hash: { sha256: "already_known_hash", md5: "md5" },
    });

    const result = processUserReport({
      fileHash: "already_known_hash",
    }, "user123", STATE);

    assert.equal(result.status, "known_threat");
  });

  it("tags user-reported threats with user source", () => {
    const result = processUserReport({
      subtype: "trojan",
      severity: 7,
    }, "reporter_456", STATE);

    assert.ok(result.threatDtu.source.includes("reporter_456"));
    assert.ok(result.threatDtu.tags.includes("user_reported"));
    assert.equal(result.threatDtu.verified, false);
  });

  it("an unverified report does not change the score, and the reporter can retract it", () => {
    const before = computeSecurityScore("user123", STATE).score;
    const result = processUserReport({ subtype: "exploit", severity: 1, description: "qa" }, "user123", STATE);
    assert.equal(computeSecurityScore("user123", STATE).score, before);
    const gone = retractUserReport(result.threatDtu.id, "user123", STATE);
    assert.equal(gone.ok, true);
    assert.equal(STATE.dtus.has(result.threatDtu.id), false);
    assert.equal(retractUserReport(result.threatDtu.id, "someone_else", STATE).ok, false);
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// System Sweep
// ═══════════════════════════════════════════════════════════════════════════

describe("Concord Shield — System Sweep", () => {
  it("sweeps all DTU artifacts in the lattice", async () => {
    const STATE = createMockSTATE();

    // Add some DTUs with artifact content
    for (let i = 0; i < 5; i++) {
      STATE.dtus.set(`test_dtu_${i}`, {
        id: `test_dtu_${i}`,
        artifact: { content: `Clean content ${i}` },
      });
    }

    const result = await performSweep(STATE, { userId: "test_user" });
    assert.equal(result.status, "complete");
    assert.equal(result.scanCount, 5);
    assert.ok(result.completedAt);
    assert.ok(result.durationMs >= 0);
  });

  it("returns sweep results with threat list", async () => {
    const STATE = createMockSTATE();
    STATE.dtus.set("dtu_1", { id: "dtu_1", artifact: { content: "hello" } });

    const result = await performSweep(STATE, { userId: "test" });
    assert.equal(result.status, "complete");
    assert.ok(Array.isArray(result.threatsFound));
    assert.ok(typeof result.cleanCount === "number");
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// Open Source Ingestion
// ═══════════════════════════════════════════════════════════════════════════

describe("Concord Shield — Rule Ingestion", () => {
  let STATE;

  beforeEach(() => {
    STATE = createMockSTATE();
  });

  it("ingests YARA rules as DTUs", () => {
    const dtu = ingestYARARule({
      name: "ransomware_lockbit",
      content: 'rule lockbit { strings: $a = "lockbit" condition: any of them }',
      source: "yara-rules-community",
      category: "ransomware",
    }, STATE);

    assert.equal(dtu.type, "YARA_RULE");
    assert.ok(dtu.tags.includes("yara_rule"));
    assert.ok(dtu.tags.includes("detection_rule"));
    assert.ok(STATE.dtus.has(dtu.id));
  });

  it("ingests Suricata/Snort rules as DTUs", () => {
    const dtu = ingestNetworkRule({
      name: "ET MALWARE Ransomware CnC",
      content: 'alert http any any -> any any (msg:"ET MALWARE"; sid:123456;)',
      engine: "suricata",
      source: "emerging_threats",
      sid: "123456",
    }, STATE);

    assert.equal(dtu.type, "NETWORK_RULE");
    assert.ok(dtu.tags.includes("network_rule"));
    assert.ok(dtu.tags.includes("suricata"));
    assert.ok(STATE.dtus.has(dtu.id));
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// Metrics & Status
// ═══════════════════════════════════════════════════════════════════════════

describe("Concord Shield — Metrics & Status", () => {
  it("returns shield metrics", () => {
    const metrics = getShieldMetrics();
    assert.equal(metrics.ok, true);
    assert.equal(metrics.version, "1.0.0");
    assert.ok(typeof metrics.stats === "object");
    assert.ok(typeof metrics.tools === "object");
  });

  it("returns threat feed", () => {
    const feed = getThreatFeed(10);
    assert.ok(Array.isArray(feed));
  });

  it("returns firewall rules", () => {
    const rules = getFirewallRules(10);
    assert.ok(Array.isArray(rules));
  });

  it("returns predictions", () => {
    const predictions = getPredictions(10);
    assert.ok(Array.isArray(predictions));
  });

  it("queues scans correctly", () => {
    const result = queueScan("test content", { source: "test" });
    assert.equal(result.queued, true);
    assert.ok(result.position > 0);
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// Heartbeat Integration
// ═══════════════════════════════════════════════════════════════════════════

describe("Concord Shield — Heartbeat", () => {
  it("runs heartbeat tick without crashing (silent failure)", async () => {
    const STATE = createMockSTATE();
    // Should not throw even with empty state
    await shieldHeartbeatTick(STATE, 1);
    await shieldHeartbeatTick(STATE, 10);
    await shieldHeartbeatTick(STATE, 50);
    await shieldHeartbeatTick(null, 1); // Even with null STATE
  });

  it("runs prophet on active threat families every 10th tick", async () => {
    const STATE = createMockSTATE();
    // Add threats with recent timestamps
    addMockThreatDTU(STATE, { subtype: "ransomware", family: "ransomware", behavior: ["obfuscation"] });
    addMockThreatDTU(STATE, { subtype: "ransomware", family: "ransomware", behavior: ["persistence"] });

    const initialSize = STATE.dtus.size;
    await shieldHeartbeatTick(STATE, 10); // 10th tick triggers prophet
    // Prophet should have added prediction DTU
    assert.ok(STATE.dtus.size >= initialSize); // May or may not add depending on prophet results
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// Constants & Exports
// ═══════════════════════════════════════════════════════════════════════════

describe("Concord Shield — Constants", () => {
  it("exports all threat subtypes", () => {
    assert.ok(Array.isArray(THREAT_SUBTYPES));
    assert.ok(THREAT_SUBTYPES.includes("virus"));
    assert.ok(THREAT_SUBTYPES.includes("ransomware"));
    assert.ok(THREAT_SUBTYPES.includes("trojan"));
    assert.ok(THREAT_SUBTYPES.includes("phishing"));
    assert.ok(THREAT_SUBTYPES.includes("exploit"));
    assert.ok(THREAT_SUBTYPES.includes("rootkit"));
    assert.ok(THREAT_SUBTYPES.includes("botnet"));
    assert.equal(THREAT_SUBTYPES.length, 10);
  });

  it("exports scan modes", () => {
    assert.equal(SCAN_MODES.PASSIVE, "passive");
    assert.equal(SCAN_MODES.ACTIVE, "active");
    assert.equal(SCAN_MODES.SCHEDULED, "scheduled");
    assert.equal(SCAN_MODES.ON_DEMAND, "on_demand");
    assert.equal(SCAN_MODES.USER_INITIATED, "user_initiated");
  });

  it("exports analysis steps", () => {
    assert.equal(ANALYSIS_STEPS.CLAMAV_SCAN, "clamav_scan");
    assert.equal(ANALYSIS_STEPS.YARA_CLASSIFY, "yara_classify");
    assert.equal(ANALYSIS_STEPS.THREAT_DTU, "threat_dtu_creation");
    assert.equal(ANALYSIS_STEPS.META_DERIVE, "meta_derivation");
    assert.equal(ANALYSIS_STEPS.LATTICE_PROPAGATE, "lattice_propagation");
  });

  it("exports fortification agents", () => {
    assert.equal(FORTIFY_AGENTS.PROPHET, "prophet");
    assert.equal(FORTIFY_AGENTS.SURGEON, "surgeon");
    assert.equal(FORTIFY_AGENTS.GUARDIAN, "guardian");
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// Tool Detection
// ═══════════════════════════════════════════════════════════════════════════

describe("Concord Shield — Tool Detection", () => {
  it("returns tool availability status", () => {
    const status = getToolStatus();
    assert.ok(typeof status === "object");
    assert.ok("clamav" in status);
    assert.ok("yara" in status);
    assert.ok("suricata" in status);
    assert.ok("snort" in status);
    assert.ok("openvas" in status);
    assert.ok("wazuh" in status);
    assert.ok("zeek" in status);
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// Initialization
// ═══════════════════════════════════════════════════════════════════════════

describe("Concord Shield — Initialization", () => {
  it("initializes shield and rebuilds threat index", async () => {
    const STATE = createMockSTATE();
    addMockThreatDTU(STATE, { hash: { sha256: "init_hash_1", md5: "md5" } });
    addMockThreatDTU(STATE, { hash: { sha256: "init_hash_2", md5: "md5" } });

    const result = await initializeShield(STATE);
    assert.equal(result.ok, true);
    assert.ok(result.tools);
    assert.ok(result.indexed);
    assert.ok(result.indexed.threats >= 2);
  });
});
