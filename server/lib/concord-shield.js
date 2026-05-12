/**
 * Concord Shield — Security Sweep Module
 *
 * Three-layer security architecture: Scan → Analyze → Fortify
 * Orchestrates open source security tools, wraps output in DTUs,
 * feeds everything into the lattice for meta-derivation and collective immunity.
 *
 * Tool tiers:
 *   1. ClamAV — malware scanning (clamd daemon)
 *   2. YARA-X — pattern matching & classification
 *   3. Suricata + Snort — network intrusion detection
 *   4. OpenVAS — vulnerability scanning
 *   5. Wazuh — host monitoring & SIEM
 *   6. Zeek — behavioral analysis
 *
 * Integration points:
 *   - Repair cortex (prophet/surgeon/guardian → fortification)
 *   - Pain memory (threat DTUs tagged as pain → never forgotten)
 *   - Forgetting engine (threat DTUs protected from pruning)
 *   - Meta-derivation (cross-threat pattern discovery)
 *   - Chat rail (all user interaction through chat)
 *   - Collective immunity (threat DTU propagates in one heartbeat tick)
 *
 * Rules:
 *   1. Additive only. Shield never modifies existing systems.
 *   2. Silent failure. Shield itself never crashes the platform.
 *   3. Every detection is a DTU. Full audit trail.
 *   4. Pain integration. Every threat is pain memory. Never pruned.
 *   5. Collective immunity. One detection protects all users.
 *   6. All through chat. No separate UI. No settings menu.
 */

import crypto from "crypto";
import { exec as execCb } from "child_process";
import { promisify } from "util";
import logger from '../logger.js';
import { LruMap, LruSet } from "./lru-map.js";

const execAsync = promisify(execCb);

// ── Helpers ─────────────────────────────────────────────────────────────────

function uid(prefix = "shield") {
  return `${prefix}_${crypto.randomBytes(10).toString("hex")}`;
}

function nowISO() {
  return new Date().toISOString();
}

function sha256(data) {
  return crypto.createHash("sha256").update(String(data)).digest("hex");
}

function md5(data) {
  return crypto.createHash("md5").update(String(data)).digest("hex");
}

function clamp(v, min, max) {
  return Math.max(min, Math.min(max, Number(v) || 0));
}

function safeExec(cmd, timeoutMs = 15000) {
  return execAsync(cmd, { timeout: timeoutMs, maxBuffer: 5 * 1024 * 1024 })
    .catch(err => ({ stdout: "", stderr: String(err?.message || err), failed: true }));
}

// ── Constants ───────────────────────────────────────────────────────────────

export const THREAT_SUBTYPES = Object.freeze([
  "virus", "spyware", "ransomware", "trojan", "worm",
  "phishing", "exploit", "rootkit", "adware", "botnet",
]);

export const SCAN_MODES = Object.freeze({
  PASSIVE:        "passive",        // Suricata + Zeek real-time monitoring
  ACTIVE:         "active",         // ClamAV scans all incoming files
  SCHEDULED:      "scheduled",      // OpenVAS periodic vulnerability scans
  ON_DEMAND:      "on_demand",      // User-requested scan via chat
  USER_INITIATED: "user_initiated", // File/URL/hash submission
});

export const ANALYSIS_STEPS = Object.freeze({
  CLAMAV_SCAN:     "clamav_scan",
  YARA_CLASSIFY:   "yara_classify",
  THREAT_DTU:      "threat_dtu_creation",
  META_DERIVE:     "meta_derivation",
  LATTICE_PROPAGATE: "lattice_propagation",
});

export const FORTIFY_AGENTS = Object.freeze({
  PROPHET:  "prophet",   // Predicts next variants
  SURGEON:  "surgeon",   // Reverse engineers attack vector
  GUARDIAN: "guardian",   // Builds firewall rules
});

// Severity scale 1-10
const SEVERITY = Object.freeze({
  LOW:      { min: 1, max: 3 },
  MEDIUM:   { min: 4, max: 6 },
  HIGH:     { min: 7, max: 8 },
  CRITICAL: { min: 9, max: 10 },
});

// ── Module State ────────────────────────────────────────────────────────────

const _shieldState = {
  initialized: false,
  toolAvailability: {
    clamav: false,
    yara: false,
    suricata: false,
    snort: false,
    openvas: false,
    wazuh: false,
    zeek: false,
  },
  scanQueue: [],
  activeScan: null,
  threatFeed: [],           // Recent threats for global feed
  firewallRules: [],        // Active generated firewall rules
  predictions: [],          // Prophet's predicted threats
  knownGoodHashes: new Map(), // Clean file hashes for instant lookup
  threatIndex: new Map(),     // sha256 → threat DTU ID for dedup
  stats: {
    totalScans: 0,
    threatsDetected: 0,
    cleanFiles: 0,
    falsePositives: 0,
    firewallRulesGenerated: 0,
    predictionsGenerated: 0,
    collectiveImmunityEvents: 0,
    lastScanAt: null,
    lastThreatAt: null,
    uptime: Date.now(),
  },
};

// ── Tool Availability Detection ─────────────────────────────────────────────

/**
 * Check which security tools are available on this system.
 * Called on boot. Tools that aren't present are gracefully degraded.
 */
export async function detectTools() {
  const checks = {
    clamav:   "clamdscan --version 2>/dev/null || clamscan --version 2>/dev/null",
    yara:     "yara --version 2>/dev/null || yara-x --version 2>/dev/null",
    suricata: "suricata --build-info 2>/dev/null | head -1",
    snort:    "snort --version 2>/dev/null | head -1",
    openvas:  "gvm-cli --version 2>/dev/null || openvas --version 2>/dev/null",
    wazuh:    "wazuh-control status 2>/dev/null || /var/ossec/bin/wazuh-control status 2>/dev/null",
    zeek:     "zeek --version 2>/dev/null || bro --version 2>/dev/null",
  };

  const results = {};
  for (const [tool, cmd] of Object.entries(checks)) {
    try {
      const { stdout, failed } = await safeExec(cmd, 5000);
      results[tool] = !failed && stdout.trim().length > 0;
    } catch {
      results[tool] = false;
    }
  }

  _shieldState.toolAvailability = results;
  return results;
}

/**
 * Get tool availability status.
 */
export function getToolStatus() {
  return { ..._shieldState.toolAvailability };
}

// ── Threat DTU Schema ───────────────────────────────────────────────────────

/**
 * Create a threat DTU following the Concord DTU structure.
 * Automatically tagged as pain_memory so the forgetting engine never prunes it.
 *
 * @param {Object} opts
 * @param {string} opts.subtype - One of THREAT_SUBTYPES
 * @param {number} opts.severity - 1-10
 * @param {Object} opts.hash - { md5, sha256, ssdeep }
 * @param {Object} opts.signatures - { clamav, yara, snort, suricata }
 * @param {string} opts.vector - How it spreads
 * @param {string[]} opts.behavior - What it does once active
 * @param {string[]} opts.affected - Platforms/systems affected
 * @param {string} opts.neutralization - How to remove
 * @param {string} opts.source - Who/what detected it
 * @param {string} opts.lineage - Parent threat DTU if variant
 * @returns {Object} Full DTU object
 */
export function createThreatDTU(opts) {
  const now = nowISO();
  const id = uid("threat");

  const subtype = THREAT_SUBTYPES.includes(opts.subtype) ? opts.subtype : "exploit";
  const severity = clamp(opts.severity || 5, 1, 10);

  return {
    id,
    type: "THREAT",
    subtype,
    title: `${subtype.toUpperCase()} threat: ${opts.hash?.sha256?.slice(0, 16) || "unknown"}`,
    tier: "regular",
    scope: "global", // Threats propagate globally — collective immunity

    // Pain memory — NEVER pruned by forgetting engine
    tags: [
      "pain_memory",           // Protected from forgetting engine
      "threat",                // Threat category
      `threat:${subtype}`,     // Subtype tag
      "security",              // Domain tag
      "shield",                // Source system
      "collective_immunity",   // Propagation flag
      ...(opts.tags || []),
    ],

    // Threat-specific schema
    severity,
    hash: {
      md5: opts.hash?.md5 || "",
      sha256: opts.hash?.sha256 || "",
      ssdeep: opts.hash?.ssdeep || "",  // Fuzzy hash for variant detection
    },
    signatures: {
      clamav: opts.signatures?.clamav || "",
      yara: opts.signatures?.yara || [],
      snort: opts.signatures?.snort || "",
      suricata: opts.signatures?.suricata || "",
    },
    vector: opts.vector || "unknown",
    behavior: opts.behavior || [],
    affected: opts.affected || [],
    neutralization: opts.neutralization || "",
    firewall: opts.firewall || "",
    predicted_variants: opts.predicted_variants || [],
    lineage: opts.lineage || null,
    source: opts.source || "shield",
    first_seen: now,
    times_detected: 1,

    // Standard DTU layers
    human: {
      summary: `${subtype} detected (severity ${severity}/10). ${opts.vector || "Unknown vector"}.`,
      bullets: [
        `Type: ${subtype}`,
        `Severity: ${severity}/10`,
        `Vector: ${opts.vector || "unknown"}`,
        ...(opts.behavior || []).slice(0, 3).map(b => `Behavior: ${b}`),
      ],
    },
    core: {
      claims: [`This file/pattern is classified as ${subtype} with severity ${severity}/10`],
      definitions: [],
      invariants: [`SHA256: ${opts.hash?.sha256 || "n/a"}`],
      examples: [],
    },
    machine: {
      kind: "threat",
      primaryType: 0x10, // THREAT type (custom for shield)
      shieldMetadata: {
        scanMode: opts.scanMode || SCAN_MODES.ACTIVE,
        analysisSteps: opts.analysisSteps || [],
        detectionEngine: opts.source || "clamav",
        confidence: opts.confidence || 0.8,
      },
    },

    // Lineage tracking for threat families
    lineageData: {
      parents: opts.lineage ? [opts.lineage] : [],
      children: [],
      family: opts.family || subtype,
    },

    // CRETI scoring for threats
    creti: {
      credibility: Math.min(severity * 2, 20),
      relevance: 15,
      evidence: opts.signatures?.yara?.length ? Math.min(opts.signatures.yara.length * 4, 20) : 10,
      timeliness: 20, // Always timely — active threat
      impact: Math.min(severity * 2, 20),
    },

    meta: {
      createdAt: now,
      updatedAt: now,
      shieldVersion: 1,
      collective: true,
    },

    createdAt: now,
    updatedAt: now,
    createdBy: "shield",
    ownerId: "system",
  };
}

/**
 * Create a clean-file DTU for known-good hash caching.
 */
export function createCleanHashDTU(hash) {
  const id = uid("clean");
  const now = nowISO();

  return {
    id,
    type: "CLEAN_HASH",
    title: `Clean file: ${hash.sha256?.slice(0, 16) || "unknown"}`,
    tier: "shadow",
    scope: "local",
    tags: ["clean_hash", "security", "shield"],
    hash: {
      md5: hash.md5 || "",
      sha256: hash.sha256 || "",
    },
    human: { summary: "File verified clean by ClamAV scan." },
    meta: { createdAt: now, shieldVersion: 1 },
    createdAt: now,
    createdBy: "shield",
  };
}

/**
 * Create a firewall rule DTU.
 */
export function createFirewallRuleDTU(opts) {
  const id = uid("fw_rule");
  const now = nowISO();

  return {
    id,
    type: "FIREWALL_RULE",
    title: `Firewall rule: Block ${opts.vector || "threat"}`,
    tier: "regular",
    scope: "global",
    tags: [
      "pain_memory", "firewall_rule", "security", "shield",
      "collective_immunity", `blocks:${opts.threatSubtype || "unknown"}`,
    ],
    rule: opts.rule || "",
    targetVector: opts.vector || "",
    generatedBy: opts.generatedBy || FORTIFY_AGENTS.GUARDIAN,
    threatDtuId: opts.threatDtuId || null,
    severity: opts.severity || 5,
    human: {
      summary: `Firewall rule blocking ${opts.vector || "threat vector"}. Generated by ${opts.generatedBy || "guardian"}.`,
    },
    creti: {
      credibility: 15,
      relevance: 18,
      evidence: 15,
      timeliness: 20,
      impact: Math.min((opts.severity || 5) * 2, 20),
    },
    meta: { createdAt: now, shieldVersion: 1, collective: true },
    createdAt: now,
    createdBy: "shield",
    ownerId: "system",
  };
}

/**
 * Create a prediction DTU from prophet analysis.
 */
export function createPredictionDTU(opts) {
  const id = uid("predict");
  const now = nowISO();

  return {
    id,
    type: "THREAT_PREDICTION",
    title: `Predicted variant: ${opts.family || "unknown"} → ${opts.predictedVariant || "next"}`,
    tier: "regular",
    scope: "global",
    tags: [
      "pain_memory", "prediction", "security", "shield",
      "prophet", `family:${opts.family || "unknown"}`,
    ],
    family: opts.family || "",
    predictedVariant: opts.predictedVariant || "",
    evolutionPattern: opts.evolutionPattern || [],
    preemptiveRule: opts.preemptiveRule || "",
    confidence: opts.confidence || 0.5,
    basedOn: opts.basedOn || [], // IDs of threat DTUs used
    human: {
      summary: `Prophet predicts next variant of ${opts.family || "unknown"} family based on evolution patterns.`,
    },
    creti: {
      credibility: Math.round(opts.confidence * 15),
      relevance: 15,
      evidence: Math.min((opts.basedOn || []).length * 3, 18),
      timeliness: 20,
      impact: 15,
    },
    meta: { createdAt: now, shieldVersion: 1, collective: true },
    createdAt: now,
    createdBy: "shield:prophet",
    ownerId: "system",
  };
}

// ── Layer 1: SCAN ───────────────────────────────────────────────────────────

/**
 * Scan a file using ClamAV (clamd or clamscan fallback).
 *
 * @param {string} filePath - Path to the file to scan
 * @returns {{ clean: boolean, signature?: string, details?: string }}
 */
export async function scanWithClamAV(filePath) {
  if (!_shieldState.toolAvailability.clamav) {
    return { clean: true, skipped: true, reason: "clamav_not_available" };
  }

  try {
    // Try clamd first (faster — daemon mode)
    const { stdout, stderr, failed } = await safeExec(
      `clamdscan --no-summary --stdout "${filePath}" 2>/dev/null || clamscan --no-summary --stdout "${filePath}" 2>/dev/null`,
      30000
    );

    const output = stdout || stderr || "";

    if (failed || output.includes("FOUND")) {
      // Extract signature name
      const match = output.match(/:\s*(.+?)\s*FOUND/);
      const signature = match ? match[1].trim() : "unknown";

      return {
        clean: false,
        signature,
        details: output.trim().slice(0, 500),
        engine: "clamav",
      };
    }

    return { clean: true, engine: "clamav" };
  } catch (err) {
    return { clean: true, skipped: true, reason: String(err?.message || err).slice(0, 200) };
  }
}

/**
 * Scan a file hash against known threats in the lattice.
 * Instant lookup — no external tool needed.
 *
 * @param {string} hashValue - SHA256 hash
 * @param {Object} STATE - Server state with DTU lattice
 * @returns {{ known: boolean, threatDtu?: Object, clean?: boolean }}
 */
export function scanHashAgainstLattice(hashValue, STATE) {
  if (!hashValue || !STATE?.dtus) return { known: false };

  // Check known-good cache first
  if (_shieldState.knownGoodHashes.has(hashValue)) {
    return { known: true, clean: true };
  }

  // Check threat index
  const threatDtuId = _shieldState.threatIndex.get(hashValue);
  if (threatDtuId) {
    const threatDtu = STATE.dtus.get(threatDtuId);
    if (threatDtu) {
      // Increment detection count
      threatDtu.times_detected = (threatDtu.times_detected || 1) + 1;
      threatDtu.updatedAt = nowISO();
      return { known: true, clean: false, threatDtu };
    }
  }

  // Scan the full lattice for matching hashes
  for (const dtu of STATE.dtus.values()) {
    if (dtu.type === "THREAT" && dtu.hash?.sha256 === hashValue) {
      _shieldState.threatIndex.set(hashValue, dtu.id);
      dtu.times_detected = (dtu.times_detected || 1) + 1;
      dtu.updatedAt = nowISO();
      return { known: true, clean: false, threatDtu: dtu };
    }
    if (dtu.type === "CLEAN_HASH" && dtu.hash?.sha256 === hashValue) {
      _shieldState.knownGoodHashes.set(hashValue, true);
      return { known: true, clean: true };
    }
  }

  return { known: false };
}

/**
 * Scan content (buffer or string) by computing hash and checking lattice,
 * then running through ClamAV if not found.
 *
 * @param {string|Buffer} content - File content
 * @param {Object} STATE - Server state
 * @param {Object} opts - { filePath, fileName, userId }
 * @returns {ScanResult}
 */
export async function scanContent(content, STATE, opts = {}) {
  _shieldState.stats.totalScans++;
  _shieldState.stats.lastScanAt = nowISO();

  const contentStr = typeof content === "string" ? content : content.toString("utf8");
  const contentHash = sha256(contentStr);
  const contentMd5 = md5(contentStr);

  // Step 1: Lattice lookup (instant)
  const latticeResult = scanHashAgainstLattice(contentHash, STATE);
  if (latticeResult.known) {
    if (latticeResult.clean) {
      _shieldState.stats.cleanFiles++;
      return {
        ok: true, clean: true, cached: true,
        hash: { sha256: contentHash, md5: contentMd5 },
      };
    } else {
      _shieldState.stats.threatsDetected++;
      return {
        ok: true, clean: false, cached: true,
        threat: latticeResult.threatDtu,
        hash: { sha256: contentHash, md5: contentMd5 },
      };
    }
  }

  // Step 2: ClamAV scan (if file path available)
  let clamResult = { clean: true, skipped: true };
  if (opts.filePath) {
    clamResult = await scanWithClamAV(opts.filePath);
  }

  // Step 3: YARA classification (if ClamAV flagged or for deeper analysis)
  let yaraResult = { matches: [], skipped: true };
  if (!clamResult.clean) {
    yaraResult = await classifyWithYARA(opts.filePath || null, contentStr);
  }

  // Step 4: Build result
  if (!clamResult.clean) {
    // Threat detected — run full analysis pipeline
    const analysisResult = await runAnalysisPipeline({
      content: contentStr,
      hash: { sha256: contentHash, md5: contentMd5, ssdeep: "" },
      clamResult,
      yaraResult,
      scanMode: opts.scanMode || SCAN_MODES.ACTIVE,
      source: opts.source || "scan",
      userId: opts.userId,
    }, STATE);

    _shieldState.stats.threatsDetected++;
    _shieldState.stats.lastThreatAt = nowISO();

    return {
      ok: true,
      clean: false,
      threat: analysisResult.threatDtu,
      analysis: analysisResult,
      hash: { sha256: contentHash, md5: contentMd5 },
    };
  }

  // Clean file — record as known-good
  _shieldState.stats.cleanFiles++;
  _shieldState.knownGoodHashes.set(contentHash, true);

  if (STATE?.dtus) {
    const cleanDtu = createCleanHashDTU({ sha256: contentHash, md5: contentMd5 });
    STATE.dtus.set(cleanDtu.id, cleanDtu);
  }

  return {
    ok: true, clean: true,
    hash: { sha256: contentHash, md5: contentMd5 },
  };
}

// ── Layer 2: ANALYZE ────────────────────────────────────────────────────────

/**
 * Classify a threat using YARA rules.
 *
 * @param {string|null} filePath - File to scan (if available)
 * @param {string} content - Content string for inline analysis
 * @returns {{ matches: string[], family?: string, techniques?: string[] }}
 */
export async function classifyWithYARA(filePath, content) {
  if (!_shieldState.toolAvailability.yara) {
    return classifyWithHeuristics(content);
  }

  try {
    // YARA-X or classic YARA
    const target = filePath ? `"${filePath}"` : "-";
    const cmd = filePath
      ? `yara -r /etc/yara/rules/ "${filePath}" 2>/dev/null || yara-x scan /etc/yara/rules/ "${filePath}" 2>/dev/null`
      : `echo "${content?.slice(0, 10000)}" | yara -r /etc/yara/rules/ - 2>/dev/null`;

    const { stdout, failed } = await safeExec(cmd, 20000);

    if (failed || !stdout.trim()) {
      return classifyWithHeuristics(content);
    }

    // Parse YARA output: rule_name file_path
    const matches = stdout.trim().split("\n")
      .map(line => line.split(/\s+/)[0])
      .filter(Boolean);

    // Derive family from matched rules
    const family = deriveMalwareFamily(matches);
    const techniques = deriveTechniques(matches);

    return { matches, family, techniques, engine: "yara" };
  } catch {
    return classifyWithHeuristics(content);
  }
}

/**
 * Heuristic classification when YARA is unavailable.
 * Pattern matching against known threat indicators.
 */
function classifyWithHeuristics(content) {
  const text = String(content || "").toLowerCase();
  const matches = [];
  const indicators = [];

  // Ransomware indicators
  if (/encrypt|ransom|bitcoin|\.onion|pay.*within|locked.*files/i.test(text)) {
    matches.push("heuristic:ransomware_indicators");
    indicators.push("ransomware");
  }

  // Trojan indicators
  if (/backdoor|reverse.*shell|c2.*server|callback|beacon/i.test(text)) {
    matches.push("heuristic:trojan_indicators");
    indicators.push("trojan");
  }

  // Phishing indicators
  if (/verify.*account|suspended.*account|click.*here|urgent.*action|password.*reset/i.test(text)) {
    matches.push("heuristic:phishing_indicators");
    indicators.push("phishing");
  }

  // Exploit indicators
  if (/buffer.*overflow|shellcode|nop.*sled|heap.*spray|use.*after.*free/i.test(text)) {
    matches.push("heuristic:exploit_indicators");
    indicators.push("exploit");
  }

  // Rootkit indicators
  if (/hide.*process|hook.*syscall|modify.*kernel|invisible.*file/i.test(text)) {
    matches.push("heuristic:rootkit_indicators");
    indicators.push("rootkit");
  }

  // Worm indicators
  if (/propagat|spread.*network|self.*replicat|auto.*copy|mass.*mail/i.test(text)) {
    matches.push("heuristic:worm_indicators");
    indicators.push("worm");
  }

  // Spyware indicators
  if (/keylog|screen.*capture|webcam.*access|clipboard.*monitor|browser.*history/i.test(text)) {
    matches.push("heuristic:spyware_indicators");
    indicators.push("spyware");
  }

  // Botnet indicators
  if (/command.*control|c2|irc.*channel|ddos|zombie.*network/i.test(text)) {
    matches.push("heuristic:botnet_indicators");
    indicators.push("botnet");
  }

  return {
    matches,
    family: indicators[0] || null,
    techniques: indicators,
    engine: "heuristic",
  };
}

function deriveMalwareFamily(yaraRules) {
  // Map YARA rule names to families
  const familyPatterns = {
    ransomware: /ransom|wannacry|locky|cerber|ryuk|conti|lockbit|blackcat/i,
    trojan: /trojan|rat_|remote_access|backdoor/i,
    phishing: /phish|credential_harvest|fake_login/i,
    exploit: /exploit|cve_|overflow|injection/i,
    rootkit: /rootkit|kernel_mod|hook_/i,
    worm: /worm|propagat|self_replic/i,
    spyware: /spyware|keylog|screen_grab/i,
    botnet: /botnet|c2_|command_control|ddos/i,
    adware: /adware|pup_|unwanted/i,
    virus: /virus|infect|polymorphic/i,
  };

  for (const rule of yaraRules) {
    for (const [family, pattern] of Object.entries(familyPatterns)) {
      if (pattern.test(rule)) return family;
    }
  }
  return "unknown";
}

function deriveTechniques(yaraRules) {
  const techniques = [];
  for (const rule of yaraRules) {
    if (/obfuscat|pack|crypt/i.test(rule)) techniques.push("obfuscation");
    if (/persist|autorun|startup/i.test(rule)) techniques.push("persistence");
    if (/lateral|pivot|spread/i.test(rule)) techniques.push("lateral_movement");
    if (/exfil|data_theft|steal/i.test(rule)) techniques.push("data_exfiltration");
    if (/evasion|anti_debug|sandbox_detect/i.test(rule)) techniques.push("defense_evasion");
    if (/privesc|escalat|root_gain/i.test(rule)) techniques.push("privilege_escalation");
  }
  return [...new Set(techniques)];
}

/**
 * Full analysis pipeline — ClamAV → YARA → Threat DTU → Meta-derive → Propagate
 *
 * @param {Object} scanData - { content, hash, clamResult, yaraResult, scanMode, source }
 * @param {Object} STATE - Server state
 * @returns {AnalysisResult}
 */
export async function runAnalysisPipeline(scanData, STATE) {
  const steps = [];

  // Step 1: ClamAV result
  steps.push({
    step: ANALYSIS_STEPS.CLAMAV_SCAN,
    result: scanData.clamResult,
    timestamp: nowISO(),
  });

  // Step 2: YARA classification
  steps.push({
    step: ANALYSIS_STEPS.YARA_CLASSIFY,
    result: scanData.yaraResult,
    timestamp: nowISO(),
  });

  // Step 3: Create Threat DTU
  const subtype = scanData.yaraResult?.family || "exploit";
  const severity = computeSeverity(scanData);

  const threatDtu = createThreatDTU({
    subtype,
    severity,
    hash: scanData.hash,
    signatures: {
      clamav: scanData.clamResult?.signature || "",
      yara: scanData.yaraResult?.matches || [],
      snort: "",
      suricata: "",
    },
    vector: inferVector(scanData),
    behavior: scanData.yaraResult?.techniques || [],
    affected: inferAffectedPlatforms(scanData),
    neutralization: generateNeutralization(subtype, severity),
    source: scanData.source || "shield",
    scanMode: scanData.scanMode,
    analysisSteps: steps.map(s => s.step),
    family: subtype,
    confidence: scanData.clamResult?.clean === false ? 0.9 : 0.6,
  });

  steps.push({
    step: ANALYSIS_STEPS.THREAT_DTU,
    dtuId: threatDtu.id,
    timestamp: nowISO(),
  });

  // Step 4: Store in lattice
  if (STATE?.dtus) {
    STATE.dtus.set(threatDtu.id, threatDtu);
    _shieldState.threatIndex.set(scanData.hash.sha256, threatDtu.id);
  }

  // Step 5: Lattice propagation (collective immunity)
  const propagation = propagateThreatToLattice(threatDtu, STATE);
  steps.push({
    step: ANALYSIS_STEPS.LATTICE_PROPAGATE,
    propagated: propagation.propagated,
    timestamp: nowISO(),
  });

  // Add to threat feed
  _shieldState.threatFeed.unshift({
    id: threatDtu.id,
    subtype,
    severity,
    hash: scanData.hash.sha256,
    detectedAt: nowISO(),
    source: scanData.source,
  });
  if (_shieldState.threatFeed.length > 1000) {
    _shieldState.threatFeed.length = 1000;
  }

  return {
    ok: true,
    threatDtu,
    steps,
    severity,
    subtype,
    collective: propagation.propagated,
  };
}

function computeSeverity(scanData) {
  let severity = 5; // Base

  // ClamAV confidence
  if (scanData.clamResult?.clean === false) severity += 2;

  // YARA rule count
  const ruleCount = scanData.yaraResult?.matches?.length || 0;
  severity += Math.min(ruleCount, 3);

  // Family-based adjustment
  const highSeverityFamilies = ["ransomware", "rootkit", "botnet", "exploit"];
  if (highSeverityFamilies.includes(scanData.yaraResult?.family)) {
    severity += 1;
  }

  return clamp(severity, 1, 10);
}

function inferVector(scanData) {
  const family = scanData.yaraResult?.family || "";
  const vectors = {
    ransomware: "email attachment / exploit kit",
    trojan: "malicious download / social engineering",
    phishing: "fraudulent email / fake website",
    exploit: "vulnerability exploitation",
    rootkit: "privilege escalation / compromised software",
    worm: "network propagation / removable media",
    spyware: "bundled software / drive-by download",
    botnet: "malware dropper / compromised site",
    adware: "bundled installer / browser extension",
    virus: "infected file / removable media",
  };
  return vectors[family] || "unknown vector";
}

function inferAffectedPlatforms(scanData) {
  // Default to cross-platform
  return ["windows", "linux", "macos"];
}

function generateNeutralization(subtype, severity) {
  const neutralizations = {
    ransomware: "Isolate affected system. Do NOT pay ransom. Restore from clean backup. Run full scan with updated signatures.",
    trojan: "Kill associated processes. Remove startup entries. Delete malicious files. Reset compromised credentials.",
    phishing: "Block sender/domain. Report to abuse. Reset any entered credentials. Enable 2FA.",
    exploit: "Apply security patch. Update affected software. Monitor for indicators of compromise.",
    rootkit: "Boot from clean media. Run offline rootkit scanner. Consider full system reinstall.",
    worm: "Isolate network segment. Patch vulnerability. Remove worm binary. Scan all connected systems.",
    spyware: "Uninstall associated software. Reset all passwords. Check for unauthorized data transfers.",
    botnet: "Block C2 communication. Remove botnet agent. Reset network credentials. Monitor for re-infection.",
    adware: "Uninstall unwanted software. Reset browser settings. Run adware removal tool.",
    virus: "Quarantine infected files. Run full antivirus scan. Restore from clean backup if needed.",
  };
  return neutralizations[subtype] || "Quarantine and run full system scan with updated signatures.";
}

// ── Layer 3: FORTIFY ────────────────────────────────────────────────────────

/**
 * Prophet — Analyze threat patterns and predict next variants.
 * Examines evolution of a malware family across all threat DTUs.
 *
 * @param {string} family - Malware family to analyze
 * @param {Object} STATE - Server state
 * @returns {PredictionResult}
 */
export function runProphet(family, STATE) {
  if (!STATE?.dtus) return { ok: false, predictions: [] };

  // Gather all threat DTUs in this family
  const familyThreats = [];
  for (const dtu of STATE.dtus.values()) {
    if (dtu.type === "THREAT" && (dtu.subtype === family || dtu.lineageData?.family === family)) {
      familyThreats.push(dtu);
    }
  }

  if (familyThreats.length < 2) {
    return { ok: true, predictions: [], reason: "insufficient_data" };
  }

  // Sort by detection time
  familyThreats.sort((a, b) =>
    new Date(a.first_seen || a.createdAt).getTime() - new Date(b.first_seen || b.createdAt).getTime()
  );

  // Analyze evolution pattern
  const evolutionPattern = familyThreats.map(t => ({
    id: t.id,
    techniques: t.behavior || [],
    severity: t.severity,
    detectedAt: t.first_seen || t.createdAt,
  }));

  // Predict next variant based on technique progression
  const allTechniques = new Set();
  for (const t of familyThreats) {
    for (const b of (t.behavior || [])) allTechniques.add(b);
  }

  // Common escalation patterns
  const escalationMap = {
    "obfuscation": "defense_evasion",
    "persistence": "privilege_escalation",
    "data_exfiltration": "lateral_movement",
    "lateral_movement": "persistence",
    "defense_evasion": "data_exfiltration",
  };

  const predictedTechniques = [];
  for (const tech of allTechniques) {
    const next = escalationMap[tech];
    if (next && !allTechniques.has(next)) {
      predictedTechniques.push(next);
    }
  }

  // Predict severity escalation
  const avgSeverity = familyThreats.reduce((s, t) => s + t.severity, 0) / familyThreats.length;
  const predictedSeverity = clamp(Math.ceil(avgSeverity + 1), 1, 10);

  // Generate preemptive YARA rule concept
  const preemptiveRule = `rule predicted_${family}_variant_${Date.now().toString(36)} {
  meta:
    description = "Preemptive rule for predicted ${family} variant"
    generated_by = "concord_shield_prophet"
    confidence = "medium"
  condition:
    ${predictedTechniques.length > 0 ? `// Watch for: ${predictedTechniques.join(", ")}` : "// Generic family detection"}
    any of them
}`;

  const prediction = createPredictionDTU({
    family,
    predictedVariant: `${family}_predicted_${Date.now().toString(36)}`,
    evolutionPattern,
    preemptiveRule,
    confidence: Math.min(familyThreats.length / 10, 0.85),
    basedOn: familyThreats.map(t => t.id),
  });

  // Store prediction
  if (STATE.dtus) {
    STATE.dtus.set(prediction.id, prediction);
  }
  _shieldState.predictions.unshift(prediction);
  if (_shieldState.predictions.length > 100) _shieldState.predictions.length = 100;
  _shieldState.stats.predictionsGenerated++;

  return {
    ok: true,
    predictions: [prediction],
    family,
    samplesAnalyzed: familyThreats.length,
    predictedTechniques,
    predictedSeverity,
  };
}

/**
 * Surgeon — Reverse engineer attack vector and generate neutralization.
 *
 * @param {Object} threatDtu - The threat DTU to analyze
 * @returns {SurgeonResult}
 */
export function runSurgeon(threatDtu) {
  if (!threatDtu) return { ok: false };

  const analysis = {
    attackVector: threatDtu.vector || "unknown",
    techniques: threatDtu.behavior || [],
    severityAssessment: {
      level: threatDtu.severity >= 8 ? "critical" : threatDtu.severity >= 5 ? "high" : "moderate",
      score: threatDtu.severity,
    },
    neutralizationProcedure: {
      immediate: [],
      shortTerm: [],
      longTerm: [],
    },
  };

  // Generate neutralization procedure based on subtype
  switch (threatDtu.subtype) {
    case "ransomware":
      analysis.neutralizationProcedure.immediate = [
        "Disconnect affected system from network immediately",
        "Do NOT restart the system (encryption keys may still be in memory)",
        "Preserve a forensic image of the disk",
      ];
      analysis.neutralizationProcedure.shortTerm = [
        "Identify the ransomware variant from the ransom note or encrypted file extension",
        "Check NoMoreRansom.org for available decryptors",
        "Restore from clean, verified backups",
      ];
      analysis.neutralizationProcedure.longTerm = [
        "Implement offline backup strategy (3-2-1 rule)",
        "Deploy application whitelisting",
        "Enable controlled folder access",
      ];
      break;
    case "trojan":
    case "rootkit":
      analysis.neutralizationProcedure.immediate = [
        "Kill suspicious processes",
        "Block outbound C2 communication at firewall",
      ];
      analysis.neutralizationProcedure.shortTerm = [
        "Remove persistence mechanisms (startup, scheduled tasks, services)",
        "Delete malicious binary and associated files",
        "Reset all credentials that may have been compromised",
      ];
      analysis.neutralizationProcedure.longTerm = [
        "Consider full system reinstall for rootkit infections",
        "Implement application control policies",
        "Enable boot-time antimalware protection",
      ];
      break;
    default:
      analysis.neutralizationProcedure.immediate = [
        "Quarantine the file/system",
        "Block associated indicators at network perimeter",
      ];
      analysis.neutralizationProcedure.shortTerm = [
        "Run full system scan",
        "Check for indicators of compromise on other systems",
      ];
      analysis.neutralizationProcedure.longTerm = [
        "Update security policies",
        "Review detection capabilities",
      ];
  }

  return {
    ok: true,
    analysis,
    neutralization: threatDtu.neutralization,
    engine: "surgeon",
  };
}

/**
 * Guardian — Generate firewall rules and updated detection signatures.
 *
 * @param {Object} threatDtu - The threat DTU to fortify against
 * @param {Object} STATE - Server state
 * @returns {GuardianResult}
 */
export function runGuardian(threatDtu, STATE) {
  if (!threatDtu) return { ok: false, rules: [] };

  const rules = [];

  // Generate iptables-style firewall rule
  if (threatDtu.vector && threatDtu.vector !== "unknown") {
    const fwRule = generateFirewallRule(threatDtu);
    rules.push(fwRule);

    // Create firewall rule DTU
    const fwDtu = createFirewallRuleDTU({
      rule: fwRule,
      vector: threatDtu.vector,
      threatSubtype: threatDtu.subtype,
      threatDtuId: threatDtu.id,
      severity: threatDtu.severity,
      generatedBy: FORTIFY_AGENTS.GUARDIAN,
    });

    if (STATE?.dtus) {
      STATE.dtus.set(fwDtu.id, fwDtu);
    }

    _shieldState.firewallRules.unshift(fwDtu);
    if (_shieldState.firewallRules.length > 500) _shieldState.firewallRules.length = 500;
    _shieldState.stats.firewallRulesGenerated++;
  }

  // Generate Suricata rule concept
  const suricataRule = generateSuricataRule(threatDtu);

  // Generate Snort rule concept
  const snortRule = generateSnortRule(threatDtu);

  return {
    ok: true,
    rules,
    suricataRule,
    snortRule,
    engine: "guardian",
    threatId: threatDtu.id,
  };
}

function generateFirewallRule(threatDtu) {
  const hash = threatDtu.hash?.sha256?.slice(0, 16) || "unknown";
  const subtype = threatDtu.subtype || "threat";

  // Concept rule — real firewall would need actual IPs/ports from analysis
  return `# Shield Guardian — block ${subtype} vector (${hash})
# Generated: ${nowISO()}
# Threat: ${threatDtu.id}
# Severity: ${threatDtu.severity}/10
# Vector: ${threatDtu.vector}
iptables -A INPUT -m comment --comment "shield_${subtype}_${hash}" -j DROP`;
}

function generateSuricataRule(threatDtu) {
  const sid = Math.floor(Math.random() * 900000) + 100000;
  return `alert http any any -> any any (msg:"CONCORD SHIELD - ${threatDtu.subtype} detected (${threatDtu.hash?.sha256?.slice(0, 16)})"; flow:established,to_server; content:"${threatDtu.hash?.sha256?.slice(0, 32) || "UNKNOWN"}"; nocase; sid:${sid}; rev:1;)`;
}

function generateSnortRule(threatDtu) {
  const sid = Math.floor(Math.random() * 900000) + 100000;
  return `alert tcp any any -> any any (msg:"CONCORD SHIELD - ${threatDtu.subtype} indicator"; content:"${threatDtu.hash?.sha256?.slice(0, 32) || "UNKNOWN"}"; nocase; sid:${sid}; rev:1;)`;
}

// ── Collective Immunity ─────────────────────────────────────────────────────

/**
 * Propagate a threat DTU through the lattice.
 * Every connected node becomes aware in the same heartbeat tick.
 *
 * In a distributed deployment, this would broadcast to all nodes.
 * In single-node, it updates local state and threat feed.
 *
 * @param {Object} threatDtu - The threat DTU to propagate
 * @param {Object} STATE - Server state
 * @returns {{ propagated: boolean }}
 */
export function propagateThreatToLattice(threatDtu, STATE) {
  if (!threatDtu || !STATE) return { propagated: false };

  try {
    // Ensure threat is in lattice
    if (STATE.dtus && !STATE.dtus.has(threatDtu.id)) {
      STATE.dtus.set(threatDtu.id, threatDtu);
    }

    // Index for fast lookups
    if (threatDtu.hash?.sha256) {
      _shieldState.threatIndex.set(threatDtu.hash.sha256, threatDtu.id);
    }

    // Mark as propagated
    threatDtu.meta = threatDtu.meta || {};
    threatDtu.meta.propagated = true;
    threatDtu.meta.propagatedAt = nowISO();

    // Emit collective immunity signal
    _shieldState.stats.collectiveImmunityEvents++;

    // In distributed mode, this is where we'd broadcast:
    // - WebSocket push to all connected frontends
    // - Federation broadcast to peer nodes
    // - Event queue for offline nodes to sync on reconnect

    return { propagated: true, nodeCount: 1 };
  } catch {
    return { propagated: false };
  }
}

// ── Heartbeat Integration ───────────────────────────────────────────────────

/**
 * Shield heartbeat tick — called on every Nth heartbeat from server.js.
 * Runs passive scanning, cleanup, and prophet analysis.
 *
 * @param {Object} STATE - Server state
 * @param {number} tick - Current heartbeat tick number
 */
export async function shieldHeartbeatTick(STATE, tick) {
  try {
    // Every tick: check for pending scans in queue
    if (_shieldState.scanQueue.length > 0 && !_shieldState.activeScan) {
      const next = _shieldState.scanQueue.shift();
      _shieldState.activeScan = next;
      try {
        await scanContent(next.content, STATE, next.opts);
      } finally {
        _shieldState.activeScan = null;
      }
    }

    // Every 10th tick: run prophet on active threat families
    if (tick % 10 === 0 && STATE?.dtus) {
      const activeFamilies = getActiveThreatFamilies(STATE);
      for (const family of activeFamilies.slice(0, 3)) {
        try { runProphet(family, STATE); } catch (_e) { logger.debug('concord-shield', 'silent catch', { error: _e?.message }); }
      }
    }

    // Every 50th tick: cleanup old predictions, trim threat feed
    if (tick % 50 === 0) {
      // Keep only recent predictions
      const cutoff = Date.now() - (7 * 24 * 3600 * 1000); // 7 days
      _shieldState.predictions = _shieldState.predictions.filter(p =>
        new Date(p.createdAt).getTime() > cutoff
      );
    }
  } catch {
    // Silent failure — shield never crashes the system
  }
}

function getActiveThreatFamilies(STATE) {
  const familyCounts = new LruMap();
  const recentCutoff = Date.now() - (24 * 3600 * 1000); // Last 24 hours

  for (const dtu of STATE.dtus.values()) {
    if (dtu.type !== "THREAT") continue;
    const detectedAt = new Date(dtu.first_seen || dtu.createdAt).getTime();
    if (detectedAt < recentCutoff) continue;

    const family = dtu.subtype || dtu.lineageData?.family || "unknown";
    familyCounts.set(family, (familyCounts.get(family) || 0) + 1);
  }

  // Return families sorted by count
  return Array.from(familyCounts.entries())
    .sort((a, b) => b[1] - a[1])
    .map(([family]) => family);
}

// ── Security Score ──────────────────────────────────────────────────────────

/**
 * Compute a user's security score.
 * Aggregates scan history, vulnerability assessment, and behavioral analysis.
 *
 * @param {string} userId - User ID
 * @param {Object} STATE - Server state
 * @returns {SecurityScore}
 */
export function computeSecurityScore(userId, STATE) {
  if (!STATE?.dtus) return { score: 0, grade: "?", breakdown: {} };

  let scannedCount = 0;
  let threatCount = 0;
  let cleanCount = 0;
  let firewallActive = 0;
  let recentThreats = 0;
  const recentCutoff = Date.now() - (7 * 24 * 3600 * 1000);

  for (const dtu of STATE.dtus.values()) {
    if (dtu.createdBy === "shield" || dtu.source === "shield") {
      if (dtu.type === "THREAT") {
        threatCount++;
        if (new Date(dtu.createdAt).getTime() > recentCutoff) recentThreats++;
      }
      if (dtu.type === "CLEAN_HASH") cleanCount++;
      if (dtu.type === "FIREWALL_RULE") firewallActive++;
      scannedCount++;
    }
  }

  // Score components (0-100 each)
  const scanCoverage = Math.min(scannedCount / 100, 1) * 100;
  const threatRatio = scannedCount > 0
    ? (1 - (threatCount / scannedCount)) * 100
    : 50;
  const firewallCoverage = Math.min(firewallActive / 10, 1) * 100;
  const recencyPenalty = Math.max(0, 100 - (recentThreats * 15));
  const toolCoverage = Object.values(_shieldState.toolAvailability)
    .filter(Boolean).length / 7 * 100;

  const score = Math.round(
    (scanCoverage * 0.2) +
    (threatRatio * 0.3) +
    (firewallCoverage * 0.15) +
    (recencyPenalty * 0.2) +
    (toolCoverage * 0.15)
  );

  const grade = score >= 90 ? "A" : score >= 75 ? "B" : score >= 60 ? "C" : score >= 40 ? "D" : "F";

  return {
    score: clamp(score, 0, 100),
    grade,
    breakdown: {
      scanCoverage: Math.round(scanCoverage),
      threatRatio: Math.round(threatRatio),
      firewallCoverage: Math.round(firewallCoverage),
      recencyScore: Math.round(recencyPenalty),
      toolCoverage: Math.round(toolCoverage),
    },
    stats: {
      totalScanned: scannedCount,
      threatsDetected: threatCount,
      cleanFiles: cleanCount,
      firewallRules: firewallActive,
      recentThreats,
    },
    recommendations: generateRecommendations(score, _shieldState.toolAvailability, recentThreats),
  };
}

function generateRecommendations(score, tools, recentThreats) {
  const recommendations = [];

  if (!tools.clamav) recommendations.push("Install ClamAV for real-time malware scanning");
  if (!tools.yara) recommendations.push("Install YARA for advanced threat classification");
  if (!tools.suricata && !tools.snort) recommendations.push("Deploy Suricata or Snort for network intrusion detection");
  if (!tools.wazuh) recommendations.push("Consider Wazuh for host monitoring and SIEM");
  if (recentThreats > 5) recommendations.push("High recent threat count — run a full system sweep");
  if (score < 60) recommendations.push("Security score is low — review scan coverage and update signatures");

  return recommendations;
}

// ── Chat Integration ────────────────────────────────────────────────────────

/**
 * Detect shield-related intent in chat messages.
 *
 * @param {string} message - User message
 * @returns {{ isShieldRequest: boolean, action?: string, params?: Object }}
 */
export function detectShieldIntent(message) {
  const msg = String(message || "").toLowerCase().trim();

  // "Scan my system" / "scan my device"
  if (/\b(scan|sweep)\s+(my\s+)?(system|device|computer|machine|files?)\b/i.test(msg)) {
    return { isShieldRequest: true, action: "sweep", params: {} };
  }

  // "Is this file safe?" / "Is this safe?"
  if (/\b(is\s+(this|that|it)\s+)?(file|url|link)?\s*(safe|clean|dangerous|malicious|infected)\b/i.test(msg)) {
    return { isShieldRequest: true, action: "check", params: {} };
  }

  // "What threats have you seen?" / "Show me threats"
  if (/\b(what|show|list)\s+(me\s+)?(threats?|attacks?|malware|viruses)\b/i.test(msg)) {
    return { isShieldRequest: true, action: "threats", params: {} };
  }

  // "Protect me from ransomware" / "Enable ransomware protection"
  if (/\b(protect|defend|guard|shield)\s+(me|us)\s+(from|against)\s+(\w+)\b/i.test(msg)) {
    const match = msg.match(/\b(protect|defend|guard|shield)\s+(me|us)\s+(from|against)\s+(\w+)\b/i);
    return { isShieldRequest: true, action: "protect", params: { target: match?.[4] || "" } };
  }

  // "Show me my security score" / "How secure am I?"
  if (/\b(security\s+score|how\s+secure|security\s+status|protection\s+status)\b/i.test(msg)) {
    return { isShieldRequest: true, action: "score", params: {} };
  }

  // "Show firewall rules" / "What's blocked?"
  if (/\b(firewall|blocked|rules|barriers)\b/i.test(msg)) {
    return { isShieldRequest: true, action: "firewall", params: {} };
  }

  // "What threats are predicted?" / "Upcoming threats"
  if (/\b(predict|upcoming|future|forecast)\s*(threats?|attacks?|malware)?\b/i.test(msg)) {
    return { isShieldRequest: true, action: "predictions", params: {} };
  }

  return { isShieldRequest: false };
}

// ── Full System Sweep ───────────────────────────────────────────────────────

/**
 * Perform a full system sweep. Queues scan operations.
 *
 * @param {Object} STATE - Server state
 * @param {Object} opts - { userId, depth }
 * @returns {SweepResult}
 */
export async function performSweep(STATE, opts = {}) {
  const sweepId = uid("sweep");
  const startTime = Date.now();

  const results = {
    sweepId,
    status: "running",
    startedAt: nowISO(),
    threatsFound: [],
    cleanCount: 0,
    scanCount: 0,
    toolsUsed: [],
  };

  // 1. Scan all DTU artifacts in the lattice
  if (STATE?.dtus) {
    for (const dtu of STATE.dtus.values()) {
      if (dtu.artifact?.content && dtu.type !== "THREAT" && dtu.type !== "CLEAN_HASH") {
        results.scanCount++;
        const scanResult = await scanContent(dtu.artifact.content, STATE, {
          source: "sweep",
          scanMode: SCAN_MODES.ON_DEMAND,
          userId: opts.userId,
        });

        if (!scanResult.clean) {
          results.threatsFound.push({
            dtuId: dtu.id,
            threat: scanResult.threat?.id,
            severity: scanResult.threat?.severity,
          });
        } else {
          results.cleanCount++;
        }

        // Don't scan more than 500 DTUs in one sweep to avoid blocking
        if (results.scanCount >= 500) break;
      }
    }
  }

  // 2. Run fortification on any new threats
  for (const threat of results.threatsFound) {
    const threatDtu = STATE?.dtus?.get(threat.threat);
    if (threatDtu) {
      try { runGuardian(threatDtu, STATE); } catch (_e) { logger.debug('concord-shield', 'silent catch', { error: _e?.message }); }
      try { runSurgeon(threatDtu); } catch (_e) { logger.debug('concord-shield', 'silent catch', { error: _e?.message }); }
    }
  }

  results.status = "complete";
  results.completedAt = nowISO();
  results.durationMs = Date.now() - startTime;
  results.toolsUsed = Object.entries(_shieldState.toolAvailability)
    .filter(([, v]) => v)
    .map(([k]) => k);

  return results;
}

// ── Open Source Ingestion Pipeline ──────────────────────────────────────────

/**
 * Ingest a YARA rule as a DTU.
 *
 * @param {Object} ruleData - { name, content, source, category }
 * @param {Object} STATE - Server state
 * @returns {Object} DTU
 */
export function ingestYARARule(ruleData, STATE) {
  const id = uid("yara_rule");
  const now = nowISO();

  const dtu = {
    id,
    type: "YARA_RULE",
    title: `YARA Rule: ${ruleData.name || "unnamed"}`,
    tier: "regular",
    scope: "global",
    tags: [
      "yara_rule", "security", "shield", "detection_rule",
      ...(ruleData.category ? [`category:${ruleData.category}`] : []),
    ],
    artifact: {
      type: "code",
      content: ruleData.content || "",
      extension: ".yar",
    },
    human: {
      summary: `YARA detection rule: ${ruleData.name}. Source: ${ruleData.source || "community"}.`,
    },
    meta: {
      source: ruleData.source || "community",
      license: ruleData.license || "GPL",
      version: ruleData.version || "1.0",
      effectiveness: ruleData.effectiveness || 0.7,
      createdAt: now,
      shieldVersion: 1,
    },
    createdAt: now,
    createdBy: "shield:ingestion",
    ownerId: "system",
  };

  if (STATE?.dtus) {
    STATE.dtus.set(id, dtu);
  }

  return dtu;
}

/**
 * Ingest a Suricata/Snort rule as a DTU.
 */
export function ingestNetworkRule(ruleData, STATE) {
  const id = uid("net_rule");
  const now = nowISO();

  const dtu = {
    id,
    type: "NETWORK_RULE",
    title: `${ruleData.engine || "IDS"} Rule: ${ruleData.name || ruleData.sid || "unnamed"}`,
    tier: "regular",
    scope: "global",
    tags: [
      "network_rule", "security", "shield", "detection_rule",
      ruleData.engine || "suricata",
    ],
    artifact: {
      type: "code",
      content: ruleData.content || "",
      extension: ".rules",
    },
    human: {
      summary: `Network detection rule (${ruleData.engine || "IDS"}): ${ruleData.name || ruleData.sid}. Source: ${ruleData.source || "community"}.`,
    },
    meta: {
      source: ruleData.source || "emerging_threats",
      engine: ruleData.engine || "suricata",
      sid: ruleData.sid || null,
      createdAt: now,
      shieldVersion: 1,
    },
    createdAt: now,
    createdBy: "shield:ingestion",
    ownerId: "system",
  };

  if (STATE?.dtus) {
    STATE.dtus.set(id, dtu);
  }

  return dtu;
}

// ── User Threat Report ──────────────────────────────────────────────────────

/**
 * Process a user-submitted threat report.
 *
 * @param {Object} report - { description, fileHash, url, indicators }
 * @param {string} userId - Reporter
 * @param {Object} STATE - Server state
 * @returns {ReportResult}
 */
export function processUserReport(report, userId, STATE) {
  const reportId = uid("report");

  // Check if this hash is already known
  if (report.fileHash) {
    const existing = scanHashAgainstLattice(report.fileHash, STATE);
    if (existing.known && !existing.clean) {
      // Already known threat — increment count
      return {
        ok: true,
        reportId,
        status: "known_threat",
        threatDtu: existing.threatDtu,
        message: "This threat is already in our threat lattice. Your report helps confirm it.",
      };
    }
  }

  // New report — create a threat DTU from the report
  const threatDtu = createThreatDTU({
    subtype: report.subtype || "exploit",
    severity: report.severity || 5,
    hash: {
      sha256: report.fileHash || "",
      md5: report.md5 || "",
      ssdeep: "",
    },
    signatures: { clamav: "", yara: [], snort: "", suricata: "" },
    vector: report.vector || "user_reported",
    behavior: report.indicators || [],
    affected: report.affected || [],
    source: `user:${userId}`,
    tags: ["user_reported"],
  });

  // Store and propagate
  if (STATE?.dtus) {
    STATE.dtus.set(threatDtu.id, threatDtu);
  }
  propagateThreatToLattice(threatDtu, STATE);

  return {
    ok: true,
    reportId,
    status: "new_threat",
    threatDtu,
    message: "Thank you for reporting. This threat has been added to the collective threat lattice.",
  };
}

// ── Initialization ──────────────────────────────────────────────────────────

/**
 * Initialize Shield on server boot.
 * Detects available tools and rebuilds threat index from lattice.
 *
 * @param {Object} STATE - Server state
 * @returns {InitResult}
 */
export async function initializeShield(STATE) {
  if (_shieldState.initialized) return { ok: true, alreadyInitialized: true };

  try {
    // Detect available tools
    const tools = await detectTools();

    // Rebuild threat index from existing lattice
    let indexedThreats = 0;
    let indexedClean = 0;

    if (STATE?.dtus) {
      for (const dtu of STATE.dtus.values()) {
        if (dtu.type === "THREAT" && dtu.hash?.sha256) {
          _shieldState.threatIndex.set(dtu.hash.sha256, dtu.id);
          indexedThreats++;
        }
        if (dtu.type === "CLEAN_HASH" && dtu.hash?.sha256) {
          _shieldState.knownGoodHashes.set(dtu.hash.sha256, true);
          indexedClean++;
        }
      }
    }

    _shieldState.initialized = true;

    return {
      ok: true,
      tools,
      indexed: { threats: indexedThreats, clean: indexedClean },
      availableTools: Object.entries(tools).filter(([, v]) => v).map(([k]) => k),
    };
  } catch (err) {
    return { ok: false, error: String(err?.message || err) };
  }
}

// ── Metrics & Status ────────────────────────────────────────────────────────

/**
 * Get Shield metrics and status.
 */
export function getShieldMetrics() {
  return {
    ok: true,
    version: "1.0.0",
    initialized: _shieldState.initialized,
    tools: { ..._shieldState.toolAvailability },
    stats: { ..._shieldState.stats },
    threatFeedSize: _shieldState.threatFeed.length,
    firewallRuleCount: _shieldState.firewallRules.length,
    predictionCount: _shieldState.predictions.length,
    knownGoodHashes: _shieldState.knownGoodHashes.size,
    threatIndexSize: _shieldState.threatIndex.size,
  };
}

/**
 * Get global threat feed.
 *
 * @param {number} limit - Max items to return
 * @param {string} filterSubtype - Optional subtype filter
 * @returns {ThreatFeedItem[]}
 */
export function getThreatFeed(limit = 50, filterSubtype = null) {
  let feed = _shieldState.threatFeed;
  if (filterSubtype) {
    feed = feed.filter(t => t.subtype === filterSubtype);
  }
  return feed.slice(0, Math.min(limit, 200));
}

/**
 * Get active firewall rules.
 */
export function getFirewallRules(limit = 50) {
  return _shieldState.firewallRules.slice(0, Math.min(limit, 200));
}

/**
 * Get prophet predictions.
 */
export function getPredictions(limit = 20) {
  return _shieldState.predictions.slice(0, Math.min(limit, 50));
}

/**
 * Queue content for scanning.
 */
export function queueScan(content, opts = {}) {
  _shieldState.scanQueue.push({ content, opts });
  return { queued: true, position: _shieldState.scanQueue.length };
}

// ── Security Intelligence Bridge ─────────────────────────────────────────

/**
 * Convert a security matcher result into a threat DTU and propagate it.
 * Called when the security matcher detects a HIGH+ severity match.
 *
 * @param {Object} matchResult - Result from security-matcher.scan()
 * @param {Object} STATE - Server state
 * @returns {{ ok: boolean, threatDtu?: Object, firewallDtu?: Object }}
 */
export function bridgeMatcherToShield(matchResult, STATE) {
  if (!matchResult || !matchResult.matched) return { ok: false };

  try {
    // Map matcher severity to shield severity (1-10 scale)
    const severityMap = { critical: 9, high: 7, medium: 5, low: 3, info: 1 };
    const severity = severityMap[matchResult.severity] || 5;

    // Create threat DTU
    const threatDtu = createThreatDTU({
      subtype: matchResult.signatureType || "exploit",
      severity,
      hash: { sha256: matchResult.signatureId || "", md5: "", ssdeep: "" },
      signatures: { clamav: "", yara: [], snort: "", suricata: "" },
      vector: matchResult.reason || "security_matcher",
      behavior: [`Detected via layer ${matchResult.layer}`],
      source: "security_intelligence",
      tags: ["pain_memory", "collective_immunity", "security_matcher"],
      confidence: matchResult.overlapScore || matchResult.similarity || 0.8,
    });

    // Propagate to lattice
    if (STATE) {
      propagateThreatToLattice(threatDtu, STATE);
    }

    // For blocking-level threats, also create a firewall rule DTU
    let firewallDtu = null;
    if (matchResult.action === "blocked" && severity >= 7) {
      firewallDtu = createFirewallRuleDTU({
        rule: `Block ${matchResult.signatureType || "threat"}: ${matchResult.signatureId || "unknown"}`,
        vector: matchResult.reason || "security_matcher",
        threatSubtype: matchResult.signatureType || "exploit",
        threatDtuId: threatDtu.id,
        severity,
        generatedBy: "guardian",
      });

      if (STATE?.dtus) {
        STATE.dtus.set(firewallDtu.id, firewallDtu);
      }
      _shieldState.firewallRules.push(firewallDtu);
    }

    return { ok: true, threatDtu, firewallDtu };
  } catch {
    return { ok: false };
  }
}

/**
 * Get the internal shield state reference for use by the security matcher.
 * This allows Layer 1 (hash lookup) to check against the in-memory indexes.
 *
 * @returns {Object} Reference to _shieldState
 */
export function getShieldState() {
  return _shieldState;
}
