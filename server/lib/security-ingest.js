/**
 * Security Ingestion Engine
 *
 * Three ingestion adapters for the security intelligence system:
 *   1. Codebase commit-diff analysis — extract vulnerable/fixed patterns from security commits
 *   2. Antivirus pattern ingestion — ClamAV CVD/CLD + YARA rule parsing
 *   3. CVE feed ingestion — NVD JSON feed → signatures + threat DTUs
 *
 * All adapters run at LOW priority in the LLM queue (most work is deterministic).
 * The 0.5b repair brain is only used for ambiguous classification (single-word triage).
 *
 * License gating: Only permissive-licensed sources are ingested (MIT, Apache-2.0, BSD, ISC).
 */

import { createHash } from "crypto";
import { readFile, readdir, stat } from "fs/promises";
import { join, extname } from "path";

// ── Constants ──────────────────────────────────────────────────────────────

const PERMISSIVE_LICENSES = new Set([
  "mit", "apache-2.0", "bsd-2-clause", "bsd-3-clause", "isc",
  "unlicense", "0bsd", "cc0-1.0", "wtfpl", "zlib",
]);

const SECURITY_COMMIT_KEYWORDS = [
  "fix", "cve", "vulnerability", "xss", "injection", "overflow",
  "sanitize", "escape", "csrf", "ssrf", "rce", "lfi", "rfi",
  "privilege escalation", "auth bypass", "security", "patch",
  "dos", "denial of service", "buffer overflow", "use after free",
  "race condition", "insecure", "hardcoded", "credential",
];

const VULNERABILITY_TYPES = {
  xss: "cross_site_scripting",
  injection: "injection",
  sql: "sql_injection",
  csrf: "cross_site_request_forgery",
  ssrf: "server_side_request_forgery",
  rce: "remote_code_execution",
  lfi: "local_file_inclusion",
  rfi: "remote_file_inclusion",
  overflow: "buffer_overflow",
  auth: "authentication_bypass",
  escalation: "privilege_escalation",
  dos: "denial_of_service",
  credential: "credential_exposure",
  sanitize: "input_sanitization",
  escape: "output_encoding",
  deserialization: "insecure_deserialization",
  redirect: "open_redirect",
  path: "path_traversal",
};

const LANGUAGE_EXTENSIONS = {
  ".js": "javascript", ".mjs": "javascript", ".cjs": "javascript",
  ".ts": "typescript", ".tsx": "typescript",
  ".py": "python",
  ".rb": "ruby",
  ".go": "go",
  ".rs": "rust",
  ".java": "java",
  ".c": "c", ".h": "c",
  ".cpp": "cpp", ".hpp": "cpp",
  ".php": "php",
  ".sh": "shell", ".bash": "shell",
};

// Max items per ingestion cycle to avoid overwhelming the system
const MAX_COMMITS_PER_SCAN = 100;
const MAX_SIGNATURES_PER_BATCH = 500;
const MAX_CVES_PER_FETCH = 100;

// ── Prepared Statements (lazy init) ────────────────────────────────────────

let _stmts = null;

function stmts(db) {
  if (_stmts) return _stmts;
  _stmts = {
    // Signatures
    insertSignature: db.prepare(`
      INSERT OR REPLACE INTO security_signatures
        (id, source, signature_type, name, description, pattern, compiled_pattern, pattern_hash,
         severity, cve_id, cwe_id, confidence, metadata, source_url, created_at, updated_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, datetime('now'), datetime('now'))
    `),
    getSignatureByHash: db.prepare(`
      SELECT id FROM security_signatures WHERE pattern_hash = ?
    `),
    getSignatureById: db.prepare(`
      SELECT * FROM security_signatures WHERE id = ?
    `),
    countSignatures: db.prepare(`
      SELECT COUNT(*) as count FROM security_signatures WHERE source = ? AND deprecated = 0
    `),

    // Codebases
    insertCodebase: db.prepare(`
      INSERT OR REPLACE INTO security_codebases
        (id, repo_id, repo_url, name, security_focus, license, license_ok,
         active, metadata, created_at, updated_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, 1, ?, datetime('now'), datetime('now'))
    `),
    getCodebaseByUrl: db.prepare(`
      SELECT * FROM security_codebases WHERE repo_url = ?
    `),
    updateCodebaseScanState: db.prepare(`
      UPDATE security_codebases
      SET last_scanned_at = datetime('now'), last_commit_hash = ?,
          patterns_extracted = patterns_extracted + ?, fixes_extracted = fixes_extracted + ?,
          updated_at = datetime('now')
      WHERE id = ?
    `),

    // Fixes
    insertFix: db.prepare(`
      INSERT OR REPLACE INTO security_fixes
        (id, codebase_id, commit_hash, vulnerability_type, before_pattern, after_pattern,
         language, description, cve_id, confidence, metadata, created_at, updated_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, datetime('now'), datetime('now'))
    `),
    getFixesByType: db.prepare(`
      SELECT * FROM security_fixes
      WHERE vulnerability_type = ? AND deprecated = 0 AND confidence >= ?
      ORDER BY success_rate DESC, confidence DESC
      LIMIT 20
    `),
    countFixes: db.prepare(`
      SELECT COUNT(*) as count FROM security_fixes WHERE deprecated = 0
    `),

    // Events
    insertEvent: db.prepare(`
      INSERT INTO security_events
        (event_type, signature_id, fix_id, target, target_type, severity, result, details, session_id)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
    `),
  };
  return _stmts;
}

// ── Utility Functions ──────────────────────────────────────────────────────

function sha256(text) {
  return createHash("sha256").update(text).digest("hex");
}

function generateId(prefix, content) {
  return `${prefix}_${sha256(content).slice(0, 16)}`;
}

function classifyVulnerabilityType(text) {
  const lower = (text || "").toLowerCase();
  for (const [keyword, type] of Object.entries(VULNERABILITY_TYPES)) {
    if (lower.includes(keyword)) return type;
  }
  return "unknown";
}

function isSecurityCommit(message) {
  const lower = (message || "").toLowerCase();
  return SECURITY_COMMIT_KEYWORDS.some(kw => lower.includes(kw));
}

function detectLanguage(filePath) {
  const ext = extname(filePath || "").toLowerCase();
  return LANGUAGE_EXTENSIONS[ext] || "unknown";
}

function severityFromCVSS(score) {
  if (score >= 9.0) return "critical";
  if (score >= 7.0) return "high";
  if (score >= 4.0) return "medium";
  if (score >= 0.1) return "low";
  return "info";
}

// ── Adapter 1: Codebase Security Pattern Extraction ────────────────────────

/**
 * Parse a unified diff into hunks of removed/added lines per file.
 * @param {string} diffText - Git unified diff output
 * @returns {Array<{file: string, language: string, removed: string[], added: string[]}>}
 */
function parseDiff(diffText) {
  const files = [];
  const fileSections = diffText.split(/^diff --git /m).filter(Boolean);

  for (const section of fileSections) {
    const fileMatch = section.match(/^a\/(.+?) b\/(.+)/m);
    if (!fileMatch) continue;

    const filePath = fileMatch[2];
    const language = detectLanguage(filePath);
    const removed = [];
    const added = [];

    const lines = section.split("\n");
    for (const line of lines) {
      if (line.startsWith("-") && !line.startsWith("---")) {
        removed.push(line.slice(1));
      } else if (line.startsWith("+") && !line.startsWith("+++")) {
        added.push(line.slice(1));
      }
    }

    if (removed.length > 0 || added.length > 0) {
      files.push({ file: filePath, language, removed, added });
    }
  }

  return files;
}

/**
 * Extract security fix patterns from a list of commit diffs.
 *
 * @param {Object} db - Database handle
 * @param {string} codebaseId - Security codebase ID
 * @param {Array<{hash: string, message: string, diff: string}>} commits
 * @returns {{ patternsExtracted: number, fixesExtracted: number }}
 */
export function extractSecurityFixes(db, codebaseId, commits) {
  const s = stmts(db);
  let patternsExtracted = 0;
  let fixesExtracted = 0;

  const securityCommits = commits
    .filter(c => isSecurityCommit(c.message))
    .slice(0, MAX_COMMITS_PER_SCAN);

  for (const commit of securityCommits) {
    const vulnType = classifyVulnerabilityType(commit.message);
    const cveMatch = commit.message.match(/CVE-\d{4}-\d{4,}/i);
    const cveId = cveMatch ? cveMatch[0].toUpperCase() : null;

    const fileDiffs = parseDiff(commit.diff || "");

    for (const fd of fileDiffs) {
      if (fd.removed.length === 0 && fd.added.length === 0) continue;

      const beforePattern = fd.removed.map(l => l.trim()).filter(Boolean).join("\n");
      const afterPattern = fd.added.map(l => l.trim()).filter(Boolean).join("\n");

      if (!beforePattern && !afterPattern) continue;

      // Compute confidence from commit message specificity
      let confidence = 0.5;
      if (cveId) confidence += 0.2;
      if (vulnType !== "unknown") confidence += 0.15;
      if (commit.message.toLowerCase().includes("security")) confidence += 0.1;
      confidence = Math.min(confidence, 0.95);

      const fixId = generateId("fix", `${commit.hash}_${fd.file}`);

      s.insertFix.run(
        fixId, codebaseId, commit.hash, vulnType,
        beforePattern.slice(0, 10000), afterPattern.slice(0, 10000),
        fd.language, commit.message.slice(0, 500), cveId,
        confidence, "{}"
      );
      fixesExtracted++;

      // Also create a signature from the vulnerable pattern
      if (beforePattern.length >= 10) {
        const patternHash = sha256(beforePattern);
        const existing = s.getSignatureByHash.get(patternHash);
        if (!existing) {
          const sigId = generateId("sig", patternHash);
          s.insertSignature.run(
            sigId, "codebase_scan", "vulnerability", `vuln_${vulnType}_${commit.hash.slice(0, 8)}`,
            `Extracted from ${commit.hash.slice(0, 8)}: ${commit.message.slice(0, 200)}`,
            beforePattern.slice(0, 5000), null, patternHash,
            "medium", cveId, null, confidence, "{}", null
          );
          patternsExtracted++;
        }
      }
    }
  }

  // Update codebase scan stats
  if (securityCommits.length > 0) {
    const lastHash = securityCommits[0].hash || "";
    s.updateCodebaseScanState.run(lastHash, patternsExtracted, fixesExtracted, codebaseId);
  }

  return { patternsExtracted, fixesExtracted };
}

/**
 * Register a security-focused codebase for tracking.
 *
 * @param {Object} db - Database handle
 * @param {Object} opts
 * @param {string} opts.repoUrl - Repository URL
 * @param {string} opts.name - Display name
 * @param {string} opts.securityFocus - Focus type
 * @param {string} [opts.license] - License identifier
 * @param {string} [opts.repoId] - Link to code_repositories table
 * @returns {{ ok: boolean, codebaseId?: string, error?: string }}
 */
export function registerSecurityCodebase(db, opts = {}) {
  const s = stmts(db);

  if (!opts.repoUrl || !opts.name) {
    return { ok: false, error: "repoUrl and name required" };
  }

  // License gate
  const license = (opts.license || "").toLowerCase().trim();
  const licenseOk = PERMISSIVE_LICENSES.has(license);
  if (!licenseOk && !opts.forceAllow) {
    return { ok: false, error: `non_permissive_license: ${license || "unknown"}` };
  }

  const existing = s.getCodebaseByUrl.get(opts.repoUrl);
  if (existing) {
    return { ok: true, codebaseId: existing.id, existing: true };
  }

  const codebaseId = generateId("scb", opts.repoUrl);
  s.insertCodebase.run(
    codebaseId, opts.repoId || null, opts.repoUrl, opts.name,
    opts.securityFocus || "vulnerability_fix", license, licenseOk ? 1 : 0,
    JSON.stringify(opts.metadata || {})
  );

  return { ok: true, codebaseId };
}

// ── Adapter 2: Antivirus Pattern Ingestion ─────────────────────────────────

/**
 * Parse YARA rules from a .yar/.yara file content.
 * Extracts rule name, metadata, and string patterns.
 *
 * @param {string} content - YARA rule file content
 * @param {string} [sourceUrl] - Source URL for provenance
 * @returns {Array<{name: string, description: string, pattern: string, severity: string, metadata: Object}>}
 */
export function parseYaraRules(content) {
  const rules = [];
  // Match YARA rule blocks: rule NAME { ... }
  const ruleRegex = /rule\s+(\w+)(?:\s*:\s*[\w\s]+)?\s*\{([^}]*(?:\{[^}]*\}[^}]*)*)\}/gs;
  let match;

  while ((match = ruleRegex.exec(content)) !== null) {
    const name = match[1];
    const body = match[2];

    // Extract meta section
    const metaMatch = body.match(/meta\s*:\s*([\s\S]*?)(?=strings\s*:|condition\s*:|$)/);
    const metadata = {};
    let description = "";
    let severity = "medium";

    if (metaMatch) {
      const metaLines = metaMatch[1].split("\n");
      for (const line of metaLines) {
        const kvMatch = line.match(/^\s*(\w+)\s*=\s*"?(.+?)"?\s*$/);
        if (kvMatch) {
          metadata[kvMatch[1]] = kvMatch[2];
          if (kvMatch[1] === "description") description = kvMatch[2];
          if (kvMatch[1] === "severity") severity = kvMatch[2].toLowerCase();
        }
      }
    }

    // Extract strings section as the pattern
    const stringsMatch = body.match(/strings\s*:\s*([\s\S]*?)(?=condition\s*:|$)/);
    const pattern = stringsMatch ? stringsMatch[1].trim() : "";

    // Extract condition
    const condMatch = body.match(/condition\s*:\s*([\s\S]*?)$/);
    const condition = condMatch ? condMatch[1].trim() : "";

    if (pattern || condition) {
      rules.push({
        name,
        description: description || `YARA rule: ${name}`,
        pattern: pattern.slice(0, 5000),
        condition: condition.slice(0, 2000),
        severity: ["critical", "high", "medium", "low", "info"].includes(severity) ? severity : "medium",
        metadata,
      });
    }
  }

  return rules;
}

/**
 * Ingest YARA rules from a directory of .yar/.yara files.
 *
 * @param {Object} db - Database handle
 * @param {string} dirPath - Directory containing YARA rule files
 * @param {string} [sourceUrl] - Source URL for provenance
 * @returns {Promise<{ingested: number, skipped: number, errors: string[]}>}
 */
export async function ingestYaraDirectory(db, dirPath, sourceUrl) {
  const s = stmts(db);
  let ingested = 0;
  let skipped = 0;
  const errors = [];

  let files;
  try {
    files = await readdir(dirPath);
  } catch (e) {
    return { ingested: 0, skipped: 0, errors: [`Cannot read directory: ${e.message}`] };
  }

  const yaraFiles = files
    .filter(f => /\.yar[a]?$/i.test(f))
    .slice(0, MAX_SIGNATURES_PER_BATCH);

  for (const file of yaraFiles) {
    try {
      const content = await readFile(join(dirPath, file), "utf-8");
      const rules = parseYaraRules(content);

      for (const rule of rules) {
        const patternHash = sha256(rule.pattern);
        const existing = s.getSignatureByHash.get(patternHash);
        if (existing) {
          skipped++;
          continue;
        }

        const sigId = generateId("yara", `${rule.name}_${patternHash}`);
        s.insertSignature.run(
          sigId, "yara", "malware", rule.name,
          rule.description, rule.pattern, rule.condition, patternHash,
          rule.severity, null, null, 0.8,
          JSON.stringify(rule.metadata), sourceUrl || null
        );
        ingested++;
      }
    } catch (e) {
      errors.push(`${file}: ${e.message}`);
    }
  }

  return { ingested, skipped, errors };
}

/**
 * Parse ClamAV signature database lines (.ndb/.hdb format).
 * NDB format: MalwareName:TargetType:Offset:HexSignature
 * HDB format: MD5Hash:FileSize:MalwareName
 *
 * @param {string} content - ClamAV signature file content
 * @param {string} format - 'ndb' or 'hdb'
 * @returns {Array<{name: string, pattern: string, signatureType: string}>}
 */
export function parseClamavSignatures(content, format = "ndb") {
  const signatures = [];
  const lines = content.split("\n").filter(l => l.trim() && !l.startsWith("#"));

  for (const line of lines.slice(0, MAX_SIGNATURES_PER_BATCH)) {
    const parts = line.split(":");

    if (format === "hdb" && parts.length >= 3) {
      signatures.push({
        name: parts[2].trim(),
        pattern: parts[0].trim(), // MD5 hash
        patternType: "hash",
        signatureType: "malware",
      });
    } else if (format === "ndb" && parts.length >= 4) {
      signatures.push({
        name: parts[0].trim(),
        pattern: parts[3].trim(), // Hex signature
        patternType: "hex",
        signatureType: "malware",
      });
    }
  }

  return signatures;
}

/**
 * Ingest ClamAV signatures from a file.
 *
 * @param {Object} db - Database handle
 * @param {string} filePath - Path to ClamAV .ndb or .hdb file
 * @param {string} [format='ndb'] - Signature format
 * @returns {Promise<{ingested: number, skipped: number}>}
 */
export async function ingestClamavFile(db, filePath, format = "ndb") {
  const s = stmts(db);
  let ingested = 0;
  let skipped = 0;

  let content;
  try {
    content = await readFile(filePath, "utf-8");
  } catch (e) {
    return { ingested: 0, skipped: 0, error: e.message };
  }

  const signatures = parseClamavSignatures(content, format);

  for (const sig of signatures) {
    const patternHash = sha256(sig.pattern);
    const existing = s.getSignatureByHash.get(patternHash);
    if (existing) {
      skipped++;
      continue;
    }

    const sigId = generateId("clam", `${sig.name}_${patternHash}`);
    s.insertSignature.run(
      sigId, "clamav", sig.signatureType, sig.name,
      `ClamAV ${format.toUpperCase()} signature`, sig.pattern, null, patternHash,
      "high", null, null, 0.85,
      JSON.stringify({ format, patternType: sig.patternType }),
      null
    );
    ingested++;
  }

  logSecurityEvent(db, "signature_update", null, null, "clamav", "signature_db", "info", "logged", {
    source: "clamav", format, ingested, skipped,
  });

  return { ingested, skipped };
}

// ── Adapter 3: CVE Feed Ingestion ──────────────────────────────────────────

/**
 * Parse CVE entries from NVD JSON feed format (API 2.0 response).
 *
 * @param {Object} feedData - NVD API response object
 * @returns {Array<{cveId, description, severity, cvss, cweId, affectedProducts, published}>}
 */
export function parseCveFeed(feedData) {
  const entries = [];
  const vulnerabilities = feedData?.vulnerabilities || feedData?.CVE_Items || [];

  for (const item of vulnerabilities.slice(0, MAX_CVES_PER_FETCH)) {
    const cve = item.cve || item;
    const cveId = cve.id || cve.CVE_data_meta?.ID;
    if (!cveId) continue;

    // Extract description
    const descriptions = cve.descriptions || cve.description?.description_data || [];
    const engDesc = descriptions.find(d => d.lang === "en") || descriptions[0] || {};
    const description = engDesc.value || "";

    // Extract CVSS score
    let cvss = 0;
    let severity = "medium";
    const metrics = cve.metrics || item.impact || {};
    const cvssV31 = metrics.cvssMetricV31?.[0] || metrics.cvssMetricV30?.[0];
    if (cvssV31) {
      cvss = cvssV31.cvssData?.baseScore || cvssV31.impactScore || 0;
      severity = severityFromCVSS(cvss);
    } else if (metrics.baseMetricV2) {
      cvss = metrics.baseMetricV2.cvssV2?.baseScore || 0;
      severity = severityFromCVSS(cvss);
    }

    // Extract CWE
    const weaknesses = cve.weaknesses || [];
    let cweId = null;
    for (const w of weaknesses) {
      const desc = w.description || [];
      const cweEntry = desc.find(d => d.value && d.value.startsWith("CWE-"));
      if (cweEntry) { cweId = cweEntry.value; break; }
    }

    // Extract affected products
    const configs = cve.configurations || item.configurations?.nodes || [];
    const affectedProducts = [];
    for (const config of configs.slice(0, 5)) {
      const cpeMatches = config.cpeMatch || config.cpe_match || [];
      for (const cpe of cpeMatches.slice(0, 10)) {
        affectedProducts.push(cpe.criteria || cpe.cpe23Uri || "");
      }
    }

    entries.push({
      cveId,
      description: description.slice(0, 5000),
      severity,
      cvss,
      cweId,
      affectedProducts: affectedProducts.slice(0, 20),
      published: cve.published || cve.publishedDate || null,
    });
  }

  return entries;
}

/**
 * Ingest parsed CVE entries into the security database.
 *
 * @param {Object} db - Database handle
 * @param {Array} cveEntries - Parsed CVE entries from parseCveFeed()
 * @returns {{ ingested: number, skipped: number }}
 */
export function ingestCveEntries(db, cveEntries) {
  const s = stmts(db);
  let ingested = 0;
  let skipped = 0;

  for (const entry of cveEntries) {
    const patternHash = sha256(entry.cveId + (entry.description || ""));
    const existing = s.getSignatureByHash.get(patternHash);
    if (existing) {
      skipped++;
      continue;
    }

    // Classify signature type from description
    const vulnType = classifyVulnerabilityType(entry.description);
    let signatureType = "vulnerability";
    if (vulnType.includes("injection") || vulnType.includes("xss")) signatureType = "injection";
    if (vulnType.includes("overflow")) signatureType = "exploit";

    const sigId = generateId("cve", entry.cveId);
    s.insertSignature.run(
      sigId, "cve_feed", signatureType, entry.cveId,
      entry.description, entry.description.slice(0, 5000), null, patternHash,
      entry.severity, entry.cveId, entry.cweId,
      Math.min(0.5 + (entry.cvss / 20), 0.95), // CVSS-weighted confidence
      JSON.stringify({
        cvss: entry.cvss,
        affectedProducts: entry.affectedProducts,
        published: entry.published,
      }),
      null
    );
    ingested++;

    logSecurityEvent(db, "cve_ingested", sigId, null, entry.cveId, "cve_feed", entry.severity, "logged", {
      cveId: entry.cveId, cvss: entry.cvss, cweId: entry.cweId,
    });
  }

  return { ingested, skipped };
}

// ── Event Logging ──────────────────────────────────────────────────────────

/**
 * Log a security event.
 *
 * @param {Object} db - Database handle
 * @param {string} eventType - Event type
 * @param {string|null} signatureId - Related signature
 * @param {string|null} fixId - Related fix
 * @param {string|null} target - Target identifier
 * @param {string} targetType - Target type
 * @param {string} severity - Severity level
 * @param {string} result - Action result
 * @param {Object} [details={}] - Additional details
 * @param {string} [sessionId] - Session ID
 */
export function logSecurityEvent(db, eventType, signatureId, fixId, target, targetType, severity, result, details = {}, sessionId = null) {
  const s = stmts(db);
  try {
    s.insertEvent.run(
      eventType, signatureId || null, fixId || null,
      target || null, targetType || "unknown",
      severity || "info", result || "logged",
      JSON.stringify(details), sessionId || null
    );
  } catch (_) {
    // Non-critical — don't let event logging break the pipeline
  }
}

// ── Signature Management ───────────────────────────────────────────────────

/**
 * Record a match outcome for a signature (updates effective_rate).
 * Auto-deprecates signatures with >30% false positive rate.
 *
 * @param {Object} db - Database handle
 * @param {string} signatureId - Signature ID
 * @param {boolean} falsePositive - Whether this was a false positive
 */
export function recordSignatureOutcome(db, signatureId, falsePositive = false) {
  const s = stmts(db);
  const sig = s.getSignatureById.get(signatureId);
  if (!sig) return;

  const matchCount = sig.match_count + 1;
  const fpCount = sig.false_positive_count + (falsePositive ? 1 : 0);
  const effectiveRate = matchCount > 0 ? 1 - (fpCount / matchCount) : 1.0;
  const deprecated = matchCount >= 5 && (fpCount / matchCount) > 0.3 ? 1 : 0;

  db.prepare(`
    UPDATE security_signatures
    SET match_count = ?, false_positive_count = ?, effective_rate = ?,
        deprecated = ?, updated_at = datetime('now')
    WHERE id = ?
  `).run(matchCount, fpCount, effectiveRate, deprecated, signatureId);

  if (deprecated) {
    logSecurityEvent(db, "false_positive", signatureId, null, signatureId, "signature", "info", "logged", {
      matchCount, fpCount, effectiveRate, autoDeprecated: true,
    });
  }
}

/**
 * Record an outcome for a security fix (updates success_rate).
 * Auto-deprecates fixes with >30% failure rate after 5+ applications.
 *
 * @param {Object} db - Database handle
 * @param {string} fixId - Fix ID
 * @param {boolean} success - Whether the fix was successful
 */
export function recordFixOutcome(db, fixId, success = true) {
  const s = stmts(db);

  const updateCol = success ? "success_count" : "failure_count";
  db.prepare(`
    UPDATE security_fixes
    SET applied_count = applied_count + 1,
        ${updateCol} = ${updateCol} + 1,
        success_rate = CAST(success_count + ${success ? 1 : 0} AS REAL) / (applied_count + 1),
        deprecated = CASE
          WHEN applied_count + 1 >= 5 AND
               CAST(failure_count + ${success ? 0 : 1} AS REAL) / (applied_count + 1) > 0.3
          THEN 1 ELSE deprecated END,
        updated_at = datetime('now')
    WHERE id = ?
  `).run(fixId);
}

// ── Statistics ─────────────────────────────────────────────────────────────

/**
 * Get security intelligence statistics.
 *
 * @param {Object} db - Database handle
 * @returns {Object} Statistics summary
 */
export function getSecurityStats(db) {
  const s = stmts(db);
  return {
    signatures: {
      clamav: s.countSignatures.get("clamav")?.count || 0,
      yara: s.countSignatures.get("yara")?.count || 0,
      cve_feed: s.countSignatures.get("cve_feed")?.count || 0,
      codebase_scan: s.countSignatures.get("codebase_scan")?.count || 0,
      custom: s.countSignatures.get("custom")?.count || 0,
    },
    fixes: s.countFixes.get()?.count || 0,
    lastUpdated: new Date().toISOString(),
  };
}

// ── Factory ────────────────────────────────────────────────────────────────

/**
 * Create the security ingestion engine bound to a database.
 *
 * @param {Object} db - better-sqlite3 database handle
 * @returns {Object} Ingestion engine API
 */
export function createSecurityIngest(db) {
  // Eagerly initialize prepared statements
  stmts(db);

  return {
    // Codebase adapter
    registerSecurityCodebase: (opts) => registerSecurityCodebase(db, opts),
    extractSecurityFixes: (codebaseId, commits) => extractSecurityFixes(db, codebaseId, commits),

    // AV adapter
    ingestYaraDirectory: (dirPath, sourceUrl) => ingestYaraDirectory(db, dirPath, sourceUrl),
    ingestClamavFile: (filePath, format) => ingestClamavFile(db, filePath, format),

    // CVE adapter
    parseCveFeed,
    ingestCveEntries: (entries) => ingestCveEntries(db, entries),

    // Outcome tracking
    recordSignatureOutcome: (sigId, fp) => recordSignatureOutcome(db, sigId, fp),
    recordFixOutcome: (fixId, success) => recordFixOutcome(db, fixId, success),

    // Logging
    logSecurityEvent: (...args) => logSecurityEvent(db, ...args),

    // Stats
    getSecurityStats: () => getSecurityStats(db),

    // Utilities (exposed for matcher)
    _stmts: () => stmts(db),
    _classifyVulnerabilityType: classifyVulnerabilityType,
    _isSecurityCommit: isSecurityCommit,
  };
}
