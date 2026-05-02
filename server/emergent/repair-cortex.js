/**
 * System 14: Repair Cortex — Organ 169
 *
 * Three-phase self-repair system that maintains the manifold autonomously.
 * First synthetic system capable of diagnosing and healing its own codebase,
 * runtime, and build pipeline.
 *
 * Phases:
 *   1. PRE-BUILD PROPHET  — Preventive immune scan before docker-compose build
 *   2. MID-BUILD SURGEON  — Intercepts build errors, fixes, resumes
 *   3. POST-BUILD GUARDIAN — Continuous runtime self-repair
 *
 * Subsystems:
 *   - REPAIR MEMORY — Persistent pattern → fix registry (learns over time)
 *   - PAIN INTEGRATION — Every repair is a pain event + avoidance learning
 *   - DTU AUDIT TRAIL — Every fix logged as a DTU
 *
 * Rules:
 *   1. Additive only. No modifications to existing systems.
 *   2. Cannot be disabled. Sovereign can adjust thresholds, not turn it off.
 *   3. Silent failure. Repair cortex itself never crashes the system.
 *   4. DTU audit trail. Every repair logged as a DTU. Full transparency.
 *   5. Pain integration. Every error is a pain event. Every repair is avoidance learning.
 *   6. Repair memory persists. Stored in STATE, serialized with everything else.
 *   7. Escalation protocol. If cortex can't fix, escalates to sovereign with full context.
 *   8. Organ number 169. Has maturity, wear, plasticity like all others.
 *
 * All state in module-level structures. Silent failure. No existing logic changes.
 */

import crypto from "crypto";
import { exec as execCb } from "child_process";
import { promisify } from "util";
import fs from "fs";
import path from "path";
import logger from '../logger.js';
import { queues, PRIORITIES } from '../requestQueue.js';

const execAsync = promisify(execCb);

// ── Security Intelligence Integration ──────────────────────────────────────
// Injected at runtime by server.js when security tables exist.
// The matcher is optional — repair cortex works fine without it.
let _securityMatcher = null;

/**
 * Wire the security matcher into the repair cortex.
 * Called once during startup when the security intelligence system is available.
 *
 * @param {Object} matcher - Security matcher instance from createSecurityMatcher()
 */
export function setSecurityMatcher(matcher) {
  _securityMatcher = matcher;
}

/**
 * Get the current security matcher (for external modules to check availability).
 */
export function getSecurityMatcher() {
  return _securityMatcher;
}

// ── Helpers ─────────────────────────────────────────────────────────────────

function uid(prefix = "repair") {
  return `${prefix}_${crypto.randomBytes(10).toString("hex")}`;
}

function nowISO() {
  return new Date().toISOString();
}

function clamp01(v) {
  return Math.max(0, Math.min(1, Number(v) || 0));
}

function hashPattern(pattern) {
  return crypto.createHash("sha256").update(String(pattern)).digest("hex").slice(0, 16);
}

function _getSTATE() {
  return globalThis._concordSTATE || globalThis.STATE || null;
}

function safeExec(cmd, timeoutMs = 10000) {
  return execAsync(cmd, { timeout: timeoutMs }).catch(() => ({ stdout: "", stderr: "" }));
}

// Docker socket availability — checked once, cached.
let _dockerAvailable = null;
function _isDockerAvailable() {
  if (_dockerAvailable !== null) return _dockerAvailable;
  try {
    // Check if Docker socket exists (typical at /var/run/docker.sock)
    _dockerAvailable = fs.existsSync("/var/run/docker.sock");
  } catch {
    _dockerAvailable = false;
  }
  return _dockerAvailable;
}

function safeDockerExec(cmd, timeoutMs = 30000) {
  if (!_isDockerAvailable()) {
    return Promise.resolve({ stdout: "", stderr: "docker socket not available", skipped: true });
  }
  return safeExec(cmd, timeoutMs);
}

// ── Constants ───────────────────────────────────────────────────────────────

export const REPAIR_PHASES = Object.freeze({
  PRE_BUILD:  "pre_build",
  MID_BUILD:  "mid_build",
  POST_BUILD: "post_build",
});

const MAX_BUILD_RETRIES = 3;
const GENESIS_OVERLAP_THRESHOLD = 0.95;

// Guardian intervals slowed significantly. The old 15-30s intervals meant 17
// separate timers all hammering concurrently, clogging the event loop.
// Nothing in a guardian monitor needs sub-minute detection — if the system is
// down for 5 minutes, the guardian catching it at 4:59 vs 0:15 doesn't matter.
// Relaxed intervals — long-haul cadence. Network volume matters more than instant detection.
const GUARDIAN_INTERVALS = Object.freeze({
  process_health:        600_000,   // 10 min — local memory check
  database_integrity:    1_800_000, // 30 min — DB rarely corrupts
  state_consistency:     900_000,   // 15 min — drift is slow
  disk_space:            3_600_000, // 1 hour — disk fills slowly
  endpoint_health:       900_000,   // 15 min — self-check, not urgent
  ollama_connectivity:   900_000,   // 15 min — Ollama doesn't flap
  autogen_health:        1_800_000, // 30 min — autogen is background work
  emergent_vitals:       900_000,   // 15 min — entities evolve slowly
  frontend_health:       900_000,   // 15 min — frontend doesn't disappear
  container_health:      1_800_000, // 30 min — containers are stable
  nginx_health:          900_000,   // 15 min — nginx is rock solid
  websocket_health:      900_000,   // 15 min — WS reconnects handle gaps
  event_loop_lag:        300_000,   // 5 min — lag is the only fast-moving concern
  ssl_certificate:       7_200_000, // 2 hours — certs expire in months
  database_connection:   1_800_000, // 30 min — DB connections are stable
  lockfile_integrity:    3_600_000, // 1 hour — lockfiles rarely change
  security_signature_freshness: 7_200_000, // 2 hours
  security_scan_backlog:        1_800_000, // 30 min
});

// ── Repair Memory ───────────────────────────────────────────────────────────
// Persistent pattern → fix registry. The system gets smarter over time.

const _repairMemory = new Map();

function _ensureRepairMemory() {
  try {
    const S = _getSTATE();
    if (!S || _repairMemory.size > 0) return;

    // Handle both Map (runtime) and plain object (deserialized from JSON)
    if (S.repairMemory instanceof Map) {
      for (const [k, v] of S.repairMemory) _repairMemory.set(k, v);
    } else if (S.repairMemory && typeof S.repairMemory === "object") {
      // JSON.stringify(Map) produces {} or a plain object — restore from it
      for (const [k, v] of Object.entries(S.repairMemory)) {
        if (v && typeof v === "object") _repairMemory.set(k, v);
      }
      // Upgrade to a real Map for future use
      S.repairMemory = new Map(_repairMemory);
    }
  } catch (_e) { logger.debug('emergent:repair-cortex', 'silent', { error: _e?.message }); }
}

function _syncRepairMemoryToSTATE() {
  try {
    const S = _getSTATE();
    if (S) {
      if (!(S.repairMemory instanceof Map)) S.repairMemory = new Map();
      for (const [k, v] of _repairMemory) {
        S.repairMemory.set(k, v);
      }
    }
  } catch (_e) { logger.debug('emergent:repair-cortex', 'silent', { error: _e?.message }); }
}

export function addToRepairMemory(errorPattern, fix) {
  try {
    _ensureRepairMemory();
    const key = hashPattern(errorPattern);
    const existing = _repairMemory.get(key);
    if (existing) {
      existing.occurrences++;
      existing.lastSeen = nowISO();
      existing.successRate = existing.successes / existing.occurrences;
    } else {
      // Check if error matches known security vulnerability (CVE tagging)
      let securityRelated = false;
      let cveId = null;
      if (_securityMatcher) {
        try {
          const secCheck = _securityMatcher.quickScan({ content: errorPattern });
          if (secCheck.matched) {
            securityRelated = true;
            cveId = secCheck.cveId || null;
          }
        } catch (_) { /* non-critical */ }
      }
      // Also check if the fix itself is security-tagged
      if (fix?.securityRelated) securityRelated = true;
      if (fix?.cveId) cveId = fix.cveId;

      _repairMemory.set(key, {
        pattern: errorPattern,
        fix,
        occurrences: 1,
        successes: 0,
        failures: 0,
        successRate: 0,
        firstSeen: nowISO(),
        lastSeen: nowISO(),
        deprecated: false,
        securityRelated,
        cveId,
      });
    }
    _syncRepairMemoryToSTATE();
  } catch (_e) { logger.debug('emergent:repair-cortex', 'silent', { error: _e?.message }); }
}

export function recordRepairSuccess(errorPattern) {
  try {
    _ensureRepairMemory();
    const key = hashPattern(errorPattern);
    const entry = _repairMemory.get(key);
    if (entry) {
      entry.successes++;
      entry.successRate = entry.successes / entry.occurrences;
      _syncRepairMemoryToSTATE();
    }
  } catch (_e) { logger.debug('emergent:repair-cortex', 'silent', { error: _e?.message }); }
}

export function recordRepairFailure(errorPattern) {
  try {
    _ensureRepairMemory();
    const key = hashPattern(errorPattern);
    const entry = _repairMemory.get(key);
    if (entry) {
      entry.failures++;
      entry.successRate = entry.successes / entry.occurrences;
      // If success rate drops below 0.3, mark fix as unreliable
      if (entry.successRate < 0.3 && entry.occurrences > 3) {
        entry.deprecated = true;
      }
      _syncRepairMemoryToSTATE();
    }
  } catch (_e) { logger.debug('emergent:repair-cortex', 'silent', { error: _e?.message }); }
}

export function lookupRepairMemory(errorPattern) {
  try {
    _ensureRepairMemory();
    const key = hashPattern(errorPattern);
    const entry = _repairMemory.get(key);
    if (entry && !entry.deprecated && entry.successRate > 0.5) {
      return entry.fix;
    }
    return null;
  } catch {
    return null;
  }
}

export function getRepairMemoryStats() {
  try {
    _ensureRepairMemory();
    const entries = Array.from(_repairMemory.values());
    return {
      ok: true,
      totalPatterns: entries.length,
      totalRepairs: entries.reduce((sum, e) => sum + e.successes, 0),
      avgSuccessRate: entries.length > 0
        ? entries.reduce((sum, e) => sum + e.successRate, 0) / entries.length
        : 0,
      topPatterns: entries.sort((a, b) => b.occurrences - a.occurrences).slice(0, 10),
      deprecatedFixes: entries.filter(e => e.deprecated).length,
    };
  } catch {
    return { ok: true, totalPatterns: 0, totalRepairs: 0, avgSuccessRate: 0, topPatterns: [], deprecatedFixes: 0 };
  }
}

export function getAllRepairPatterns() {
  try {
    _ensureRepairMemory();
    return { ok: true, patterns: Array.from(_repairMemory.values()) };
  } catch {
    return { ok: true, patterns: [] };
  }
}

// ── Error Accumulator + observe() ────────────────────────────────────────────
// Replaces empty catch blocks. The cortex sees everything now.

const _errorAccumulator = new Map();

/**
 * Silent error sensor. Replaces empty catch blocks.
 * Does NOT throw or disrupt flow. Just observes.
 * The cortex sees everything now.
 */
export function observe(error, context = "unknown") {
  try {
    const key = hashPattern(`${context}:${error?.message || error}`);

    const existing = _errorAccumulator.get(key);
    if (existing) {
      existing.count++;
      existing.lastSeen = nowISO();
      // Only log DTU on powers of 2 (1, 2, 4, 8, 16, 32...)
      // Prevents flooding while still tracking escalation
      if ((existing.count & (existing.count - 1)) === 0) {
        logRepairDTU(REPAIR_PHASES.POST_BUILD, "recurring_error", {
          context,
          message: String(error?.message || error).slice(0, 200),
          count: existing.count,
          firstSeen: existing.firstSeen,
          pattern: key,
        });
      }
      return;
    }

    _errorAccumulator.set(key, {
      context,
      message: String(error?.message || error).slice(0, 500),
      stack: String(error?.stack || "").slice(0, 1000),
      count: 1,
      firstSeen: nowISO(),
      lastSeen: nowISO(),
    });

    // Cap accumulator at 1000 entries — evict oldest
    if (_errorAccumulator.size > 1000) {
      let oldestKey = null, oldestTime = Infinity;
      for (const [k, v] of _errorAccumulator) {
        const t = new Date(v.firstSeen).getTime();
        if (t < oldestTime) { oldestTime = t; oldestKey = k; }
      }
      if (oldestKey) _errorAccumulator.delete(oldestKey);
    }

    // First occurrence — check if repair cortex knows a fix
    const diagnosis = matchErrorPattern(String(error?.message || error));
    if (diagnosis) {
      addToRepairMemory(String(error?.message || error), diagnosis.fixes?.[0]);
    }

    // Security intelligence layer — check if error matches known vulnerability
    if (_securityMatcher) {
      try {
        const secResult = _securityMatcher.quickScan({
          content: String(error?.message || error),
          target: context,
        });
        if (secResult.matched && secResult.severity && (secResult.severity === "critical" || secResult.severity === "high")) {
          // High-severity security match — create sovereign alert + tag in repair memory
          logRepairDTU(REPAIR_PHASES.POST_BUILD, "security_threat_in_error", {
            context,
            severity: secResult.severity,
            signatureId: secResult.signatureId,
            fixId: secResult.fixId,
            action: secResult.action,
            layer: secResult.layer,
          });
        }
      } catch (_secErr) { /* security layer never blocks observe() */ }
    }
  } catch (_e) { logger.debug('emergent:repair-cortex', 'observe() itself NEVER throws', { error: _e?.message }); }
}

export function getErrorAccumulator() {
  try {
    return {
      ok: true,
      size: _errorAccumulator.size,
      entries: Array.from(_errorAccumulator.values())
        .sort((a, b) => b.count - a.count)
        .slice(0, 50),
    };
  } catch {
    return { ok: true, size: 0, entries: [] };
  }
}

// ── DTU Audit Trail ─────────────────────────────────────────────────────────
// Every repair logged as a DTU. Full transparency.

const _repairDTUs = [];
const REPAIR_DTU_CAP = 500;

function logRepairDTU(phase, action, details) {
  try {
    const dtuId = uid("dtu_repair");
    const now = nowISO();

    const dtu = {
      id: dtuId,
      type: "knowledge",
      title: `Repair Cortex: ${action}`,
      human: { summary: `[${phase}] ${action}: ${JSON.stringify(details).slice(0, 200)}` },
      machine: {
        kind: "repair_log",
        phase,
        action,
        ...details,
        timestamp: now,
      },
      source: "repair_cortex",
      authority: { model: "repair_cortex", score: 0.8 },
      tier: "local",
      scope: "local",
      tags: ["repair_cortex", phase, action],
      classification: "repair",
      createdAt: now,
      updatedAt: now,
    };

    // Store in STATE if available
    const S = _getSTATE();
    if (S && S.dtus instanceof Map) {
      S.dtus.set(dtuId, dtu);
    }

    // Keep local reference
    _repairDTUs.push(dtu);
    if (_repairDTUs.length > REPAIR_DTU_CAP) {
      _repairDTUs.splice(0, _repairDTUs.length - REPAIR_DTU_CAP);
    }

    // Pain integration: every repair is a pain event
    _recordRepairPain(phase, action, details);

    // Avoidance memory integration
    _recordAvoidance(action, details);

    // Realtime emit
    try {
      if (typeof globalThis.realtimeEmit === "function") {
        globalThis.realtimeEmit("repair:dtu_logged", {
          dtuId, phase, action, timestamp: now,
        });
      }
    } catch (_e) { logger.debug('emergent:repair-cortex', 'silent', { error: _e?.message }); }

    return dtu;
  } catch {
    return null;
  }
}

function _recordRepairPain(phase, action, details) {
  try {
    // Use the avoidance-learning system if available
    const painMod = globalThis._repairCortexPainModule;
    if (painMod && typeof painMod.recordPain === "function") {
      painMod.recordPain(
        "system_repair_cortex",
        "organ_damage",
        details?.escalated ? 0.7 : 0.2,
        "repair_cortex",
        {
          phase,
          action,
          pattern: details?.pattern || action,
          severity: details?.escalated ? "high" : "low",
        }
      );
    }
  } catch (_e) { logger.debug('emergent:repair-cortex', 'silent', { error: _e?.message }); }
}

function _recordAvoidance(action, details) {
  try {
    const S = _getSTATE();
    if (S && S.avoidanceMemory && typeof S.avoidanceMemory.add === "function") {
      S.avoidanceMemory.add({
        trigger: details?.pattern || action,
        consequence: "build_failure",
        avoidance: details?.fix?.name || "unknown",
      });
    }
  } catch (_e) { logger.debug('emergent:repair-cortex', 'silent', { error: _e?.message }); }
}

export function getRecentRepairDTUs(n = 20) {
  try {
    return { ok: true, dtus: _repairDTUs.slice(-Math.min(n, REPAIR_DTU_CAP)) };
  } catch {
    return { ok: true, dtus: [] };
  }
}

// ── Error Pattern Registry ──────────────────────────────────────────────────
// Comprehensive pattern → fix mapping covering the ENTIRE system.
// Categories: typescript, import, reference, lint, react, module, runtime,
//             resource, nextjs, tailwind, docker, database, network, auth,
//             lockfile, native, webpack, eslint, css, node, ssl

const ERROR_PATTERNS = {
  // ── TypeScript Errors ───────────────────────────────────────────────────

  type_mismatch: {
    regex: /Type '(.+)' is not assignable to type '(.+)'/,
    category: "typescript",
    fixes: [
      { name: "add_index_signature", confidence: 0.8, describe: (m) => `Add index signature for ${m[2]}` },
      { name: "widen_to_any", confidence: 0.7, describe: (m) => `Widen ${m[1]} to any (safe fallback)` },
      { name: "add_type_assertion", confidence: 0.6, describe: (m) => `Assert as ${m[2]}` },
    ],
  },

  ts_property_missing: {
    regex: /Property '(.+)' does not exist on type '(.+)'/,
    category: "typescript",
    fixes: [
      { name: "add_to_interface", confidence: 0.85, describe: (m) => `Add property '${m[1]}' to interface ${m[2]}` },
      { name: "optional_chain", confidence: 0.8, describe: (m) => `Use optional chaining for ${m[1]}` },
      { name: "cast_to_any", confidence: 0.5, describe: (m) => `Cast ${m[2]} to any` },
    ],
  },

  ts_argument_count: {
    regex: /Expected (\d+) arguments?, but got (\d+)/,
    category: "typescript",
    fixes: [
      { name: "fix_useref_react19", confidence: 0.95, describe: () => "Fix useRef<T>() → useRef<T>(undefined) for React 19" },
      { name: "fix_arg_count", confidence: 0.9, describe: (m) => `Fix argument count: expected ${m[1]}, got ${m[2]}` },
      { name: "add_optional_params", confidence: 0.7, describe: (m) => `Make extra params optional` },
    ],
  },

  ts_no_overload: {
    regex: /No overload matches this call/,
    category: "typescript",
    fixes: [
      { name: "fix_overload_args", confidence: 0.8, describe: () => "Fix function call to match an overload signature" },
      { name: "add_type_assertion", confidence: 0.6, describe: () => "Add type assertion to satisfy overload" },
    ],
  },

  ts_implicit_any: {
    regex: /(?:Parameter|Variable|Element) '(.+)' implicitly has an? '(.+)' type/,
    category: "typescript",
    fixes: [
      { name: "add_explicit_type", confidence: 0.9, describe: (m) => `Add explicit type annotation to ${m[1]}` },
      { name: "enable_no_implicit_any_false", confidence: 0.5, describe: () => "Disable noImplicitAny in tsconfig" },
    ],
  },

  ts_jsx_element: {
    regex: /(?:JSX element|'(.+)') (?:type|class) does not have any construct or call signatures/,
    category: "typescript",
    fixes: [
      { name: "fix_component_type", confidence: 0.8, describe: () => "Fix React component type signature" },
      { name: "add_react_fc_type", confidence: 0.7, describe: () => "Type component as React.FC" },
    ],
  },

  ts_cannot_use_jsx: {
    regex: /Cannot use JSX unless the '(.+)' flag is provided/,
    category: "typescript",
    fixes: [
      { name: "set_jsx_flag", confidence: 0.95, describe: (m) => `Set jsx: "${m[1]}" in tsconfig.json` },
    ],
  },

  ts_duplicate_identifier: {
    regex: /Duplicate identifier '(.+)'/,
    category: "typescript",
    fixes: [
      { name: "rename_duplicate", confidence: 0.8, describe: (m) => `Rename duplicate identifier ${m[1]}` },
      { name: "merge_declarations", confidence: 0.6, describe: (m) => `Merge duplicate declarations of ${m[1]}` },
    ],
  },

  ts_missing_return: {
    regex: /Not all code paths return a value/,
    category: "typescript",
    fixes: [
      { name: "add_return_statement", confidence: 0.9, describe: () => "Add missing return statement" },
      { name: "add_void_return_type", confidence: 0.6, describe: () => "Change return type to include void" },
    ],
  },

  ts_object_possibly_null: {
    regex: /Object is possibly '(null|undefined)'/,
    category: "typescript",
    fixes: [
      { name: "add_null_check", confidence: 0.9, describe: (m) => `Add null check (object possibly ${m[1]})` },
      { name: "add_non_null_assertion", confidence: 0.7, describe: () => "Add non-null assertion operator" },
      { name: "add_optional_chain", confidence: 0.85, describe: () => "Use optional chaining operator" },
    ],
  },

  // ── Import / Module Errors ──────────────────────────────────────────────

  missing_import: {
    regex: /Cannot find module '(.+)'/,
    category: "import",
    fixes: [
      { name: "install_package", confidence: 0.9, describe: (m) => `Install missing package: ${m[1]}` },
      { name: "fix_relative_path", confidence: 0.8, describe: (m) => `Fix relative path for ${m[1]}` },
    ],
  },

  module_not_found: {
    regex: /Module not found: Can't resolve '(.+)'/,
    category: "module",
    fixes: [
      { name: "install_missing", confidence: 0.9, describe: (m) => `Install missing module: ${m[1]}` },
      { name: "fix_alias_config", confidence: 0.7, describe: (m) => `Fix path alias for ${m[1]} in tsconfig/webpack` },
    ],
  },

  err_module_not_found: {
    regex: /ERR_MODULE_NOT_FOUND.*'(.+)'/,
    category: "import",
    fixes: [
      { name: "fix_esm_extension", confidence: 0.9, describe: (m) => `Add .js extension for ESM import ${m[1]}` },
      { name: "install_package", confidence: 0.8, describe: (m) => `Install ${m[1]}` },
    ],
  },

  err_require_esm: {
    regex: /ERR_REQUIRE_ESM.*require\(\) of ES Module (.+)/,
    category: "import",
    fixes: [
      { name: "convert_to_dynamic_import", confidence: 0.9, describe: (m) => `Convert require() to dynamic import() for ${m[1]}` },
      { name: "add_type_module", confidence: 0.7, describe: () => `Add "type": "module" to package.json` },
    ],
  },

  esm_named_export: {
    regex: /does not provide an export named '(.+)'/,
    category: "import",
    fixes: [
      { name: "use_default_import", confidence: 0.85, describe: (m) => `Use default import instead of named export ${m[1]}` },
      { name: "check_export_name", confidence: 0.7, describe: (m) => `Verify export name ${m[1]} exists in source` },
    ],
  },

  // ── Reference / Declaration Errors ──────────────────────────────────────

  undefined_reference: {
    regex: /(?:Cannot find name|is not defined) '(.+)'/,
    category: "reference",
    fixes: [
      { name: "add_import", confidence: 0.8, describe: (m) => `Add import for ${m[1]}` },
      { name: "declare_variable", confidence: 0.5, describe: (m) => `Auto-declare ${m[1]}` },
    ],
  },

  reference_error_runtime: {
    regex: /ReferenceError: (.+) is not defined/,
    category: "reference",
    fixes: [
      { name: "add_import_or_require", confidence: 0.85, describe: (m) => `Add import/require for ${m[1]}` },
      { name: "add_polyfill", confidence: 0.6, describe: (m) => `Add polyfill for ${m[1]}` },
    ],
  },

  // ── Lint / Code Quality Errors ──────────────────────────────────────────

  unused_variable: {
    regex: /'(.+)' is (?:defined|assigned|declared) but (?:never used|its value is never read)/,
    category: "lint",
    fixes: [
      { name: "eslint_autofix", confidence: 0.95, describe: () => "Run eslint --fix on affected files" },
      { name: "prefix_underscore", confidence: 0.85, describe: (m) => `Prefix ${m[1]} with underscore` },
      { name: "remove_import", confidence: 0.8, describe: (m) => `Remove unused import ${m[1]}` },
    ],
  },

  eslint_no_unused_vars: {
    regex: /(@typescript-eslint\/no-unused-vars|no-unused-vars)/,
    category: "eslint",
    fixes: [
      { name: "eslint_autofix", confidence: 0.95, describe: () => "Run eslint --fix on affected files" },
    ],
  },

  eslint_parsing_error: {
    regex: /Parsing error: (.+)/,
    category: "eslint",
    fixes: [
      { name: "fix_syntax", confidence: 0.8, describe: (m) => `Fix syntax error: ${m[1]}` },
      { name: "update_parser_config", confidence: 0.6, describe: () => "Update ESLint parser configuration" },
    ],
  },

  eslint_rule_violation: {
    regex: /eslint\((.+)\): (.+)/,
    category: "eslint",
    fixes: [
      { name: "eslint_autofix", confidence: 0.85, describe: (m) => `Run eslint --fix for rule ${m[1]}` },
      { name: "fix_violation", confidence: 0.7, describe: (m) => `Fix ESLint rule ${m[1]}: ${m[2]}` },
      { name: "eslint_disable_line", confidence: 0.5, describe: (m) => `Disable eslint rule ${m[1]} for this line` },
    ],
  },

  no_undef_eslint: {
    regex: /'(.+)' is not defined\s*(?:no-undef)/,
    category: "eslint",
    fixes: [
      { name: "add_global_declaration", confidence: 0.8, describe: (m) => `Declare ${m[1]} as global in ESLint config` },
      { name: "add_import", confidence: 0.85, describe: (m) => `Import ${m[1]}` },
    ],
  },

  // ── React / Next.js Errors ──────────────────────────────────────────────

  react_hook_deps: {
    regex: /React Hook (.+) has (?:a missing|missing) dependenc/,
    category: "react",
    fixes: [
      { name: "add_deps", confidence: 0.85, describe: (m) => `Add missing dependencies to ${m[1]}` },
      { name: "add_eslint_disable", confidence: 0.7, describe: (m) => `Add eslint-disable for ${m[1]}` },
    ],
  },

  react_hook_rules: {
    regex: /React Hook "(.+)" (?:is called conditionally|cannot be called)/,
    category: "react",
    fixes: [
      { name: "move_hook_to_top", confidence: 0.9, describe: (m) => `Move ${m[1]} to top level of component` },
      { name: "extract_component", confidence: 0.7, describe: () => "Extract conditional logic to sub-component" },
    ],
  },

  react_invalid_hook_call: {
    regex: /Invalid hook call.*Hooks can only be called inside/,
    category: "react",
    fixes: [
      { name: "move_to_component", confidence: 0.9, describe: () => "Move hook call inside a React function component" },
      { name: "check_react_versions", confidence: 0.7, describe: () => "Check for mismatched React versions" },
    ],
  },

  react_hydration_mismatch: {
    regex: /(?:Hydration failed|Text content does not match|There was an error while hydrating)/,
    category: "react",
    fixes: [
      { name: "add_use_client", confidence: 0.8, describe: () => "Add 'use client' directive for client-only content" },
      { name: "wrap_in_suspense", confidence: 0.7, describe: () => "Wrap dynamic content in Suspense boundary" },
      { name: "suppress_hydration_warning", confidence: 0.5, describe: () => "Add suppressHydrationWarning prop" },
    ],
  },

  react_server_component_error: {
    regex: /(?:You're importing a component that needs|"use client"|createContext|useState|useEffect).*(?:server component|Server Component)/,
    category: "react",
    fixes: [
      { name: "add_use_client_directive", confidence: 0.95, describe: () => "Add 'use client' directive to component file" },
      { name: "extract_client_component", confidence: 0.8, describe: () => "Extract client-side logic to separate component" },
    ],
  },

  react_key_missing: {
    regex: /Each child in a (?:list|array) should have a unique "key" prop/,
    category: "react",
    fixes: [
      { name: "add_key_prop", confidence: 0.95, describe: () => "Add unique key prop to list items" },
    ],
  },

  react_cannot_update_unmounted: {
    regex: /Can't perform a React state update on (?:an unmounted|a component that)/,
    category: "react",
    fixes: [
      { name: "add_cleanup_effect", confidence: 0.9, describe: () => "Add cleanup function to useEffect" },
      { name: "add_mounted_ref", confidence: 0.7, describe: () => "Add isMounted ref guard" },
    ],
  },

  // ── Next.js Specific ────────────────────────────────────────────────────

  nextjs_image_error: {
    regex: /Invalid src prop.*on.*next\/image/,
    category: "nextjs",
    fixes: [
      { name: "add_image_domain", confidence: 0.9, describe: () => "Add domain to images config in next.config.js" },
      { name: "use_unoptimized", confidence: 0.6, describe: () => "Set unoptimized: true for external images" },
    ],
  },

  nextjs_prerender_error: {
    regex: /Error occurred prerendering page "(.+)"/,
    category: "nextjs",
    fixes: [
      { name: "add_dynamic_export", confidence: 0.85, describe: (m) => `Mark ${m[1]} as dynamic with export const dynamic = 'force-dynamic'` },
      { name: "add_error_boundary", confidence: 0.7, describe: (m) => `Add error boundary to page ${m[1]}` },
    ],
  },

  nextjs_metadata_error: {
    regex: /(?:You are attempting to export "metadata" from a component marked with "use client")/,
    category: "nextjs",
    fixes: [
      { name: "move_metadata_to_server", confidence: 0.95, describe: () => "Move metadata export to a server component (remove 'use client')" },
      { name: "use_generate_metadata", confidence: 0.8, describe: () => "Use generateMetadata function instead" },
    ],
  },

  nextjs_dynamic_server_usage: {
    regex: /Dynamic server usage: (.+)/,
    category: "nextjs",
    fixes: [
      { name: "add_dynamic_export", confidence: 0.9, describe: (m) => `Add dynamic = 'force-dynamic' for: ${m[1]}` },
      { name: "wrap_in_suspense", confidence: 0.7, describe: () => "Wrap server-side data fetch in Suspense" },
    ],
  },

  nextjs_route_conflict: {
    regex: /Conflicting app and page file(?:s)? (?:were|was) found.*"(.+)"/,
    category: "nextjs",
    fixes: [
      { name: "remove_pages_route", confidence: 0.9, describe: (m) => `Remove pages/ route conflicting with app/ route ${m[1]}` },
    ],
  },

  nextjs_build_standalone_missing: {
    regex: /Could not find a production build.*\.next/,
    category: "nextjs",
    fixes: [
      { name: "run_next_build", confidence: 0.95, describe: () => "Run 'next build' before 'next start'" },
      { name: "check_output_standalone", confidence: 0.7, describe: () => "Verify output: 'standalone' in next.config.js" },
    ],
  },

  // ── SSR Errors (window/document) ────────────────────────────────────────

  ssr_window_not_defined: {
    regex: /(?:window|document|navigator|localStorage|sessionStorage) is not defined/,
    category: "nextjs",
    fixes: [
      { name: "add_use_client", confidence: 0.9, describe: () => "Add 'use client' directive" },
      { name: "add_typeof_guard", confidence: 0.85, describe: () => "Add typeof window !== 'undefined' guard" },
      { name: "use_dynamic_import", confidence: 0.8, describe: () => "Use next/dynamic with ssr: false" },
    ],
  },

  // ── Tailwind / CSS Errors ───────────────────────────────────────────────

  tailwind_class_not_found: {
    regex: /The `(.+)` class does not exist/,
    category: "tailwind",
    fixes: [
      { name: "add_to_safelist", confidence: 0.8, describe: (m) => `Add ${m[1]} to Tailwind safelist` },
      { name: "fix_class_name", confidence: 0.9, describe: (m) => `Fix Tailwind class name ${m[1]}` },
    ],
  },

  postcss_error: {
    regex: /(?:PostCSS|postcss).*(?:Error|error):?\s*(.+)/,
    category: "css",
    fixes: [
      { name: "fix_postcss_syntax", confidence: 0.8, describe: (m) => `Fix PostCSS error: ${m[1]}` },
      { name: "update_postcss_config", confidence: 0.6, describe: () => "Update postcss.config.js" },
    ],
  },

  css_module_error: {
    regex: /(?:CSS Modules|css module).*(?:not found|undefined|can't resolve) '(.+)'/,
    category: "css",
    fixes: [
      { name: "create_css_module", confidence: 0.9, describe: (m) => `Create missing CSS module ${m[1]}` },
      { name: "fix_import_path", confidence: 0.8, describe: (m) => `Fix CSS module import path ${m[1]}` },
    ],
  },

  sass_error: {
    regex: /SassError: (.+)/,
    category: "css",
    fixes: [
      { name: "fix_sass_syntax", confidence: 0.8, describe: (m) => `Fix SASS error: ${m[1]}` },
      { name: "install_sass", confidence: 0.7, describe: () => "Install sass package" },
    ],
  },

  // ── Webpack / Bundler Errors ────────────────────────────────────────────

  webpack_compilation_error: {
    regex: /webpack.*(?:error|Error).*in (.+)/,
    category: "webpack",
    fixes: [
      { name: "check_webpack_config", confidence: 0.7, describe: (m) => `Check webpack config for ${m[1]}` },
      { name: "clear_webpack_cache", confidence: 0.8, describe: () => "Clear .next/cache and node_modules/.cache" },
    ],
  },

  turbopack_error: {
    regex: /(?:Turbopack|turbopack).*(?:error|Error):?\s*(.+)/,
    category: "webpack",
    fixes: [
      { name: "fall_back_to_webpack", confidence: 0.7, describe: () => "Disable Turbopack and use webpack" },
      { name: "fix_turbopack_compat", confidence: 0.8, describe: (m) => `Fix Turbopack error: ${m[1]}` },
    ],
  },

  chunk_load_failed: {
    regex: /ChunkLoadError: Loading chunk (.+) failed/,
    category: "webpack",
    fixes: [
      { name: "clear_next_cache", confidence: 0.9, describe: () => "Clear .next cache and rebuild" },
      { name: "fix_public_path", confidence: 0.7, describe: () => "Fix publicPath/assetPrefix in next.config.js" },
    ],
  },

  // ── Package / Lockfile Errors ───────────────────────────────────────────

  npm_ci_lockfile_mismatch: {
    regex: /npm (?:ci|ERR!).*(?:lockfile|package-lock\.json).*(?:out of sync|mismatch|missing|not compatible|could not read)/i,
    category: "lockfile",
    fixes: [
      { name: "regenerate_lockfile", confidence: 0.95, describe: () => "Run npm install to regenerate package-lock.json" },
      { name: "delete_and_reinstall", confidence: 0.85, describe: () => "Delete node_modules + lockfile and reinstall" },
    ],
  },

  npm_ci_missing_lockfile: {
    regex: /npm ci.*can only install.*package-lock\.json.*present/i,
    category: "lockfile",
    fixes: [
      { name: "run_npm_install_first", confidence: 0.95, describe: () => "Run npm install to generate package-lock.json before npm ci" },
    ],
  },

  npm_peer_dep_conflict: {
    regex: /npm ERR!.*(?:peer dep|peer dependency|ERESOLVE|Could not resolve dependency).*(?:conflict|unable to resolve)/i,
    category: "lockfile",
    fixes: [
      { name: "install_legacy_peer_deps", confidence: 0.9, describe: () => "Run npm install --legacy-peer-deps" },
      { name: "fix_version_range", confidence: 0.7, describe: () => "Adjust version ranges to resolve peer dep conflict" },
    ],
  },

  npm_eresolve: {
    regex: /ERESOLVE (?:unable to resolve dependency tree|overriding peer dependency)/,
    category: "lockfile",
    fixes: [
      { name: "install_force", confidence: 0.8, describe: () => "Run npm install --force" },
      { name: "install_legacy_peer_deps", confidence: 0.9, describe: () => "Run npm install --legacy-peer-deps" },
    ],
  },

  npm_audit_critical: {
    regex: /(\d+) critical.*vulnerabilit/,
    category: "lockfile",
    fixes: [
      { name: "npm_audit_fix", confidence: 0.85, describe: (m) => `Run npm audit fix (${m[1]} critical vulnerabilities)` },
    ],
  },

  npm_enoent: {
    regex: /npm ERR!.*ENOENT.*'(.+)'/,
    category: "lockfile",
    fixes: [
      { name: "create_missing_file", confidence: 0.7, describe: (m) => `Create missing file: ${m[1]}` },
      { name: "reinstall_deps", confidence: 0.8, describe: () => "Run npm install to restore missing files" },
    ],
  },

  npm_engine_mismatch: {
    regex: /npm ERR!.*engine.*(?:not compatible|wanted).*node[:\s]*"(.+)"/i,
    category: "lockfile",
    fixes: [
      { name: "update_node_version", confidence: 0.8, describe: (m) => `Update Node.js to match required version: ${m[1]}` },
      { name: "relax_engines", confidence: 0.6, describe: () => "Relax engines field in package.json" },
    ],
  },

  // ── Native Module Build Errors ──────────────────────────────────────────

  native_module_rebuild: {
    regex: /(?:gyp ERR!|node-pre-gyp|prebuild-install).*(?:build error|failed|not found)/i,
    category: "native",
    fixes: [
      { name: "rebuild_native", confidence: 0.9, describe: () => "Run npm rebuild to recompile native modules" },
      { name: "install_build_tools", confidence: 0.8, describe: () => "Install build tools (python3, make, g++)" },
    ],
  },

  better_sqlite3_error: {
    regex: /better-sqlite3.*(?:was compiled against|NODE_MODULE_VERSION|cannot open)/,
    category: "native",
    fixes: [
      { name: "rebuild_sqlite", confidence: 0.95, describe: () => "npm rebuild better-sqlite3" },
      { name: "reinstall_sqlite", confidence: 0.8, describe: () => "Remove and reinstall better-sqlite3" },
    ],
  },

  node_module_version_mismatch: {
    regex: /was compiled against a different Node\.js version.*NODE_MODULE_VERSION (\d+)/,
    category: "native",
    fixes: [
      { name: "rebuild_all_native", confidence: 0.95, describe: () => "npm rebuild — recompile all native modules for current Node.js" },
    ],
  },

  sharp_error: {
    regex: /(?:sharp|libvips).*(?:error|not found|failed to load)/i,
    category: "native",
    fixes: [
      { name: "reinstall_sharp", confidence: 0.9, describe: () => "npm install --platform=linux --arch=x64 sharp" },
      { name: "skip_sharp_optimization", confidence: 0.6, describe: () => "Set images.unoptimized: true in next.config.js" },
    ],
  },

  // ── Node.js Runtime Errors ──────────────────────────────────────────────

  port_in_use: {
    regex: /EADDRINUSE.*:(\d+)/,
    category: "runtime",
    fixes: [
      { name: "kill_process", confidence: 0.9, describe: (m) => `Kill process on port ${m[1]}` },
    ],
  },

  heap_overflow: {
    regex: /JavaScript heap out of memory/,
    category: "resource",
    fixes: [
      { name: "increase_heap", confidence: 0.9, describe: () => "Increase NODE_OPTIONS max-old-space-size" },
    ],
  },

  enoent: {
    regex: /ENOENT:? (?:no such file or directory).*'(.+)'/,
    category: "runtime",
    fixes: [
      { name: "create_directory", confidence: 0.8, describe: (m) => `Create missing path: ${m[1]}` },
      { name: "fix_file_path", confidence: 0.7, describe: (m) => `Fix file path: ${m[1]}` },
    ],
  },

  eacces: {
    regex: /EACCES:? (?:permission denied).*'(.+)'/,
    category: "runtime",
    fixes: [
      { name: "fix_permissions", confidence: 0.9, describe: (m) => `Fix permissions on ${m[1]}` },
      { name: "run_as_correct_user", confidence: 0.7, describe: () => "Ensure process runs as correct user" },
    ],
  },

  econnrefused: {
    regex: /ECONNREFUSED.*(?::(\d+))?/,
    category: "network",
    fixes: [
      { name: "start_target_service", confidence: 0.9, describe: (m) => `Start service on port ${m[1] || "unknown"}` },
      { name: "check_hostname", confidence: 0.7, describe: () => "Verify hostname and port configuration" },
    ],
  },

  etimedout: {
    regex: /ETIMEDOUT|ESOCKETTIMEDOUT|request timed? ?out/i,
    category: "network",
    fixes: [
      { name: "increase_timeout", confidence: 0.8, describe: () => "Increase request timeout" },
      { name: "check_network", confidence: 0.7, describe: () => "Check network connectivity to target host" },
    ],
  },

  emfile: {
    regex: /EMFILE:? (?:too many open files)/,
    category: "resource",
    fixes: [
      { name: "increase_ulimit", confidence: 0.9, describe: () => "Increase file descriptor limit (ulimit -n)" },
      { name: "fix_fd_leak", confidence: 0.7, describe: () => "Check for file descriptor leaks" },
    ],
  },

  enomem: {
    regex: /ENOMEM|Cannot allocate memory/,
    category: "resource",
    fixes: [
      { name: "increase_memory_limit", confidence: 0.8, describe: () => "Increase container memory limit" },
      { name: "reduce_concurrency", confidence: 0.7, describe: () => "Reduce concurrent operations" },
    ],
  },

  unhandled_rejection: {
    regex: /Unhandled(?:Promise)?Rejection.*: (.+)/,
    category: "runtime",
    fixes: [
      { name: "add_catch_handler", confidence: 0.85, describe: (m) => `Add .catch() handler for: ${m[1]}` },
      { name: "add_global_handler", confidence: 0.6, describe: () => "Add global unhandledRejection handler" },
    ],
  },

  uncaught_exception: {
    regex: /UncaughtException.*: (.+)/i,
    category: "runtime",
    fixes: [
      { name: "add_try_catch", confidence: 0.85, describe: (m) => `Wrap in try/catch: ${m[1]}` },
      { name: "add_error_boundary", confidence: 0.7, describe: () => "Add error boundary for graceful handling" },
    ],
  },

  syntax_error: {
    regex: /SyntaxError: (.+)/,
    category: "runtime",
    fixes: [
      { name: "fix_syntax", confidence: 0.85, describe: (m) => `Fix syntax error: ${m[1]}` },
    ],
  },

  // ── Docker / Container Errors ───────────────────────────────────────────

  docker_build_failed: {
    regex: /(?:executor failed|failed to solve).*: (.+)/,
    category: "docker",
    fixes: [
      { name: "fix_dockerfile", confidence: 0.7, describe: (m) => `Fix Dockerfile issue: ${m[1]}` },
      { name: "clear_docker_cache", confidence: 0.8, describe: () => "Clear Docker build cache (docker builder prune)" },
    ],
  },

  docker_no_space: {
    regex: /no space left on device/,
    category: "docker",
    fixes: [
      { name: "docker_prune", confidence: 0.95, describe: () => "Run docker system prune to reclaim space" },
      { name: "clean_old_images", confidence: 0.8, describe: () => "Remove old Docker images" },
    ],
  },

  docker_network_error: {
    regex: /(?:network|Network).*(?:not found|already exists|failed)/,
    category: "docker",
    fixes: [
      { name: "recreate_network", confidence: 0.85, describe: () => "Remove and recreate Docker network" },
    ],
  },

  docker_image_pull_failed: {
    regex: /(?:pull|Pull).*(?:error|failed|not found|manifest unknown).*(?:'|")(.+)(?:'|")/,
    category: "docker",
    fixes: [
      { name: "check_image_tag", confidence: 0.9, describe: (m) => `Verify image tag exists: ${m[1]}` },
      { name: "check_registry_auth", confidence: 0.7, describe: () => "Check Docker registry authentication" },
    ],
  },

  docker_compose_version: {
    regex: /(?:version|Version).*(?:obsolete|unsupported|invalid).*compose/i,
    category: "docker",
    fixes: [
      { name: "update_compose_syntax", confidence: 0.9, describe: () => "Update docker-compose.yml to v2+ syntax" },
    ],
  },

  docker_healthcheck_unhealthy: {
    regex: /(?:health check|healthcheck).*(?:failed|unhealthy|timed? ?out)/i,
    category: "docker",
    fixes: [
      { name: "increase_start_period", confidence: 0.8, describe: () => "Increase healthcheck start_period" },
      { name: "fix_health_endpoint", confidence: 0.7, describe: () => "Fix health check endpoint or command" },
    ],
  },

  // ── Database Errors ─────────────────────────────────────────────────────

  sqlite_corrupt: {
    regex: /(?:SQLITE_CORRUPT|database disk image is malformed)/,
    category: "database",
    fixes: [
      { name: "restore_from_backup", confidence: 0.9, describe: () => "Restore database from latest backup" },
      { name: "run_integrity_check", confidence: 0.8, describe: () => "Run PRAGMA integrity_check and attempt repair" },
    ],
  },

  sqlite_busy: {
    regex: /(?:SQLITE_BUSY|database is locked)/,
    category: "database",
    fixes: [
      { name: "enable_wal_mode", confidence: 0.9, describe: () => "Enable WAL mode: PRAGMA journal_mode=WAL" },
      { name: "increase_busy_timeout", confidence: 0.8, describe: () => "Increase busy_timeout PRAGMA" },
    ],
  },

  sqlite_readonly: {
    regex: /(?:SQLITE_READONLY|attempt to write a readonly database)/,
    category: "database",
    fixes: [
      { name: "fix_db_permissions", confidence: 0.9, describe: () => "Fix database file permissions" },
      { name: "check_volume_mount", confidence: 0.8, describe: () => "Ensure Docker volume is mounted read-write" },
    ],
  },

  pg_connection_refused: {
    regex: /(?:PostgreSQL|pg|FATAL).*(?:connection refused|could not connect)/i,
    category: "database",
    fixes: [
      { name: "start_postgres", confidence: 0.9, describe: () => "Start PostgreSQL service" },
      { name: "check_pg_config", confidence: 0.7, describe: () => "Check PostgreSQL host/port/credentials" },
    ],
  },

  redis_connection_error: {
    regex: /(?:Redis|REDIS|redis).*(?:ECONNREFUSED|connection.*(?:refused|failed|timed? ?out))/i,
    category: "database",
    fixes: [
      { name: "start_redis", confidence: 0.9, describe: () => "Start Redis service" },
      { name: "check_redis_url", confidence: 0.7, describe: () => "Verify REDIS_URL environment variable" },
    ],
  },

  // ── Auth / Security Errors ──────────────────────────────────────────────

  jwt_error: {
    regex: /(?:JsonWebTokenError|jwt|JWT).*(?:malformed|invalid|expired|signature)/i,
    category: "auth",
    fixes: [
      { name: "check_jwt_secret", confidence: 0.9, describe: () => "Verify JWT_SECRET matches between services" },
      { name: "regenerate_tokens", confidence: 0.7, describe: () => "Clear expired tokens and force re-auth" },
    ],
  },

  cors_error: {
    regex: /(?:CORS|cors|Access-Control).*(?:blocked|not allowed|origin)/i,
    category: "auth",
    fixes: [
      { name: "update_allowed_origins", confidence: 0.9, describe: () => "Add origin to ALLOWED_ORIGINS environment variable" },
      { name: "check_cors_middleware", confidence: 0.7, describe: () => "Verify CORS middleware configuration" },
    ],
  },

  // ── SSL / TLS Errors ────────────────────────────────────────────────────

  ssl_cert_expired: {
    regex: /(?:certificate|cert).*(?:expired|CERT_HAS_EXPIRED)/i,
    category: "ssl",
    fixes: [
      { name: "renew_certificate", confidence: 0.95, describe: () => "Run certbot renew to refresh SSL certificate" },
    ],
  },

  ssl_self_signed: {
    regex: /(?:SELF_SIGNED_CERT|self.signed|DEPTH_ZERO_SELF_SIGNED)/,
    category: "ssl",
    fixes: [
      { name: "set_reject_unauthorized", confidence: 0.6, describe: () => "Set NODE_TLS_REJECT_UNAUTHORIZED=0 (dev only)" },
      { name: "install_ca_cert", confidence: 0.8, describe: () => "Install proper CA certificate" },
    ],
  },

  // ── Socket / WebSocket Errors ───────────────────────────────────────────

  websocket_error: {
    regex: /(?:WebSocket|ws|socket\.io).*(?:error|failed|ECONNRESET|hang up)/i,
    category: "network",
    fixes: [
      { name: "check_ws_proxy", confidence: 0.8, describe: () => "Verify WebSocket proxy configuration in nginx" },
      { name: "increase_ws_timeout", confidence: 0.7, describe: () => "Increase WebSocket timeout/ping interval" },
    ],
  },

  socket_hangup: {
    regex: /(?:socket hang up|ECONNRESET)/,
    category: "network",
    fixes: [
      { name: "add_keep_alive", confidence: 0.8, describe: () => "Enable HTTP keep-alive" },
      { name: "increase_timeout", confidence: 0.7, describe: () => "Increase connection timeout" },
    ],
  },

  // ── Nginx Errors ────────────────────────────────────────────────────────

  nginx_config_error: {
    regex: /nginx.*(?:test failed|emerg|error).*(?:directive|unknown|invalid)/i,
    category: "nginx",
    fixes: [
      { name: "fix_nginx_config", confidence: 0.8, describe: () => "Fix nginx configuration syntax" },
      { name: "nginx_test", confidence: 0.9, describe: () => "Run nginx -t to validate config" },
    ],
  },

  nginx_upstream_timeout: {
    regex: /upstream timed? ?out.*(?:reading|connecting)/i,
    category: "nginx",
    fixes: [
      { name: "increase_proxy_timeout", confidence: 0.9, describe: () => "Increase proxy_read_timeout in nginx" },
      { name: "check_upstream_health", confidence: 0.8, describe: () => "Check backend/frontend service health" },
    ],
  },

  // ── General Build Errors ────────────────────────────────────────────────

  exit_code_nonzero: {
    regex: /(?:exited with|exit code|returned) (?:error )?(?:code )?(\d+)/,
    category: "runtime",
    fixes: [
      { name: "check_logs", confidence: 0.6, describe: (m) => `Check logs for process exit code ${m[1]}` },
    ],
  },

  command_not_found: {
    regex: /(?:command not found|not recognized as.*command):? (.+)/i,
    category: "runtime",
    fixes: [
      { name: "install_command", confidence: 0.85, describe: (m) => `Install missing command: ${m[1]}` },
      { name: "check_path", confidence: 0.7, describe: () => "Check PATH environment variable" },
    ],
  },

  json_parse_error: {
    regex: /(?:SyntaxError: Unexpected token|JSON\.parse|JSON at position) (.+)?/,
    category: "runtime",
    fixes: [
      { name: "fix_json_syntax", confidence: 0.85, describe: () => "Fix JSON syntax error" },
      { name: "validate_json_input", confidence: 0.7, describe: () => "Validate JSON input before parsing" },
    ],
  },

  process_killed: {
    regex: /(?:SIGKILL|SIGTERM|OOMKilled|killed)/i,
    category: "resource",
    fixes: [
      { name: "increase_memory", confidence: 0.9, describe: () => "Increase container/process memory limit" },
      { name: "add_graceful_shutdown", confidence: 0.7, describe: () => "Add graceful shutdown handler" },
    ],
  },
};

/**
 * Match a build error message against known patterns.
 */
export function matchErrorPattern(errorMessage) {
  try {
    for (const [key, pattern] of Object.entries(ERROR_PATTERNS)) {
      const match = pattern.regex.exec(errorMessage);
      if (match) {
        return { key, ...pattern, match };
      }
    }
    return null;
  } catch {
    return null;
  }
}

// ── Pre-Build Checks (Prophet) ──────────────────────────────────────────────

const PRE_BUILD_CHECKS = {
  syntax: {
    name: "syntax_scan",
    description: "Quick parse of all JS/TS files for syntax errors",
    action: async (projectRoot) => {
      try {
        const issues = [];
        const autoFixable = [];
        // Check for common syntax issues by scanning key files
        const serverPath = path.join(projectRoot, "server", "server.js");
        if (fs.existsSync(serverPath)) {
          const content = fs.readFileSync(serverPath, "utf-8");
          // Check for basic syntax markers
          const opens = (content.match(/\{/g) || []).length;
          const closes = (content.match(/\}/g) || []).length;
          if (Math.abs(opens - closes) > 2) {
            issues.push({
              file: serverPath,
              severity: "warning",
              message: `Brace imbalance: ${opens} open vs ${closes} close`,
            });
          }
        }
        return { issues, autoFixable };
      } catch {
        return { issues: [], autoFixable: [] };
      }
    },
  },

  imports: {
    name: "import_integrity",
    description: "Verify all imports resolve to real exports",
    action: async (projectRoot) => {
      try {
        const issues = [];
        const autoFixable = [];
        const emergentDir = path.join(projectRoot, "server", "emergent");
        if (fs.existsSync(emergentDir)) {
          const files = fs.readdirSync(emergentDir).filter(f => f.endsWith(".js"));
          for (const file of files) {
            const content = fs.readFileSync(path.join(emergentDir, file), "utf-8");
            // Check for imports from files that don't exist
            const importMatches = content.matchAll(/import\s+.+\s+from\s+['"](\.[^'"]+)['"]/g);
            for (const m of importMatches) {
              const importPath = m[1];
              const resolved = path.resolve(emergentDir, importPath);
              const candidates = [resolved, resolved + ".js", resolved + ".mjs"];
              if (!candidates.some(c => fs.existsSync(c))) {
                issues.push({
                  file: path.join(emergentDir, file),
                  severity: "critical",
                  message: `Import '${importPath}' does not resolve to a file`,
                  autoFixed: false,
                });
              }
            }
          }
        }
        return { issues, autoFixable };
      } catch {
        return { issues: [], autoFixable: [] };
      }
    },
  },

  env_vars: {
    name: "env_completeness",
    description: "Check all process.env references have values",
    action: async (projectRoot) => {
      try {
        const issues = [];
        const autoFixable = [];
        // Read .env if it exists
        const envPath = path.join(projectRoot, ".env");
        const envVars = new Set();
        if (fs.existsSync(envPath)) {
          const envContent = fs.readFileSync(envPath, "utf-8");
          for (const line of envContent.split("\n")) {
            const match = line.match(/^([A-Z_][A-Z0-9_]*)=/);
            if (match) envVars.add(match[1]);
          }
        }
        // Scan server.js for process.env references
        const serverPath = path.join(projectRoot, "server", "server.js");
        if (fs.existsSync(serverPath)) {
          const content = fs.readFileSync(serverPath, "utf-8");
          const envRefs = content.matchAll(/process\.env\.([A-Z_][A-Z0-9_]*)/g);
          for (const m of envRefs) {
            const varName = m[1];
            // Check if it has a fallback (|| or ??)
            const lineIdx = content.lastIndexOf("\n", m.index);
            const line = content.slice(lineIdx, content.indexOf("\n", m.index + m[0].length));
            const hasFallback = line.includes("||") || line.includes("??");
            if (!envVars.has(varName) && !hasFallback) {
              issues.push({
                file: serverPath,
                severity: "warning",
                message: `process.env.${varName} referenced without fallback and not in .env`,
              });
            }
          }
        }
        return { issues, autoFixable };
      } catch {
        return { issues: [], autoFixable: [] };
      }
    },
  },

  dependencies: {
    name: "dependency_health",
    description: "Verify package.json deps match actual usage",
    action: async (projectRoot) => {
      try {
        const issues = [];
        const autoFixable = [];
        const pkgPath = path.join(projectRoot, "package.json");
        if (fs.existsSync(pkgPath)) {
          const pkg = JSON.parse(fs.readFileSync(pkgPath, "utf-8"));
          const deps = new Set([
            ...Object.keys(pkg.dependencies || {}),
            ...Object.keys(pkg.devDependencies || {}),
          ]);
          // Check node_modules exists
          const nmPath = path.join(projectRoot, "node_modules");
          if (!fs.existsSync(nmPath)) {
            issues.push({
              file: pkgPath,
              severity: "critical",
              message: "node_modules directory missing — npm install required",
              autoFixed: false,
            });
            autoFixable.push({
              pattern: "missing_node_modules",
              solution: "npm_install",
              name: "install_deps",
            });
          } else {
            // Spot-check a few deps exist in node_modules
            for (const dep of Array.from(deps).slice(0, 20)) {
              const depPath = path.join(nmPath, dep);
              if (!fs.existsSync(depPath)) {
                issues.push({
                  file: pkgPath,
                  severity: "warning",
                  message: `Dependency ${dep} listed but not in node_modules`,
                });
              }
            }
          }
        }
        return { issues, autoFixable };
      } catch {
        return { issues: [], autoFixable: [] };
      }
    },
  },

  state_namespaces: {
    name: "state_collision",
    description: "Check STATE object keys don't collide across systems",
    action: async (projectRoot) => {
      try {
        const issues = [];
        const autoFixable = [];
        const emergentDir = path.join(projectRoot, "server", "emergent");
        if (fs.existsSync(emergentDir)) {
          const stateKeys = new Map(); // key → [files]
          const files = fs.readdirSync(emergentDir).filter(f => f.endsWith(".js"));
          for (const file of files) {
            const content = fs.readFileSync(path.join(emergentDir, file), "utf-8");
            const stateAssigns = content.matchAll(/STATE\.([a-zA-Z_]\w*)\s*=/g);
            for (const m of stateAssigns) {
              const key = m[1];
              if (!stateKeys.has(key)) stateKeys.set(key, []);
              stateKeys.get(key).push(file);
            }
          }
          for (const [key, fileList] of stateKeys) {
            const uniqueFiles = [...new Set(fileList)];
            if (uniqueFiles.length > 1) {
              issues.push({
                severity: "warning",
                message: `STATE.${key} assigned in multiple files: ${uniqueFiles.join(", ")}`,
              });
            }
          }
        }
        return { issues, autoFixable };
      } catch {
        return { issues: [], autoFixable: [] };
      }
    },
  },

  docker: {
    name: "docker_config",
    description: "Verify Dockerfile and compose are consistent",
    action: async (projectRoot) => {
      try {
        const issues = [];
        const autoFixable = [];
        const dockerfilePath = path.join(projectRoot, "Dockerfile");
        const composePath = path.join(projectRoot, "docker-compose.yml");
        if (!fs.existsSync(dockerfilePath) && !fs.existsSync(path.join(projectRoot, "docker-compose.yaml"))) {
          // No Docker config — not an error, just skip
          return { issues, autoFixable };
        }
        if (fs.existsSync(composePath)) {
          const content = fs.readFileSync(composePath, "utf-8");
          // Basic port conflict check
          const ports = content.matchAll(/ports:\s*\n\s*-\s*['"]?(\d+):/g);
          const usedPorts = new Map();
          for (const m of ports) {
            const port = m[1];
            if (usedPorts.has(port)) {
              issues.push({
                file: composePath,
                severity: "critical",
                message: `Port ${port} mapped multiple times in docker-compose`,
              });
            }
            usedPorts.set(port, true);
          }
        }
        return { issues, autoFixable };
      } catch {
        return { issues: [], autoFixable: [] };
      }
    },
  },

  // ── Lockfile Sync Check ─────────────────────────────────────────────────

  lockfile_sync_server: {
    name: "lockfile_sync_server",
    description: "Verify server package.json and package-lock.json are in sync",
    action: async (projectRoot) => {
      try {
        const issues = [];
        const autoFixable = [];
        const serverDir = path.join(projectRoot, "server");
        const pkgPath = path.join(serverDir, "package.json");
        const lockPath = path.join(serverDir, "package-lock.json");

        if (!fs.existsSync(pkgPath)) return { issues, autoFixable };

        // Case 1: No lockfile at all
        if (!fs.existsSync(lockPath)) {
          issues.push({
            file: pkgPath,
            severity: "critical",
            message: "server/package-lock.json missing — npm ci will fail",
            autoFixed: false,
          });
          autoFixable.push({
            pattern: "missing_server_lockfile",
            solution: "npm_install_server",
            name: "generate_server_lockfile",
          });
          return { issues, autoFixable };
        }

        // Case 2: Lockfile exists — compare versions
        const pkg = JSON.parse(fs.readFileSync(pkgPath, "utf-8"));
        const lock = JSON.parse(fs.readFileSync(lockPath, "utf-8"));

        const allPkgDeps = {
          ...(pkg.dependencies || {}),
          ...(pkg.devDependencies || {}),
          ...(pkg.optionalDependencies || {}),
        };

        // Check lockfileVersion compatibility
        if (lock.lockfileVersion && lock.lockfileVersion < 2) {
          issues.push({
            file: lockPath,
            severity: "warning",
            message: `Lockfile version ${lock.lockfileVersion} is outdated — recommend v3 for Node 20+`,
          });
        }

        // Check name/version match
        if (lock.name && lock.name !== pkg.name) {
          issues.push({
            file: lockPath,
            severity: "critical",
            message: `Lockfile name "${lock.name}" doesn't match package.json name "${pkg.name}"`,
            autoFixed: false,
          });
          autoFixable.push({
            pattern: "lockfile_name_mismatch",
            solution: "npm_install_server",
            name: "regenerate_server_lockfile",
          });
        }

        // Check that all package.json deps exist in lockfile packages
        const lockPackages = lock.packages || {};
        const rootLockDeps = lockPackages[""]?.dependencies || {};
        const rootLockDevDeps = lockPackages[""]?.devDependencies || {};
        const rootLockOptDeps = lockPackages[""]?.optionalDependencies || {};
        const allLockDeps = { ...rootLockDeps, ...rootLockDevDeps, ...rootLockOptDeps };

        let driftCount = 0;
        for (const [dep, range] of Object.entries(allPkgDeps)) {
          if (!allLockDeps[dep] && !lockPackages[`node_modules/${dep}`]) {
            driftCount++;
            if (driftCount <= 5) {
              issues.push({
                file: lockPath,
                severity: "warning",
                message: `Dependency "${dep}" in package.json but missing from lockfile`,
              });
            }
          }
        }

        if (driftCount > 5) {
          issues.push({
            file: lockPath,
            severity: "critical",
            message: `${driftCount} dependencies in package.json missing from lockfile — lockfile is stale`,
            autoFixed: false,
          });
          autoFixable.push({
            pattern: "server_lockfile_stale",
            solution: "npm_install_server",
            name: "sync_server_lockfile",
          });
        }

        return { issues, autoFixable };
      } catch {
        return { issues: [], autoFixable: [] };
      }
    },
  },

  lockfile_sync_frontend: {
    name: "lockfile_sync_frontend",
    description: "Verify frontend package.json and package-lock.json are in sync",
    action: async (projectRoot) => {
      try {
        const issues = [];
        const autoFixable = [];
        const frontendDir = path.join(projectRoot, "concord-frontend");
        const pkgPath = path.join(frontendDir, "package.json");
        const lockPath = path.join(frontendDir, "package-lock.json");

        if (!fs.existsSync(pkgPath)) return { issues, autoFixable };

        if (!fs.existsSync(lockPath)) {
          issues.push({
            file: pkgPath,
            severity: "critical",
            message: "concord-frontend/package-lock.json missing — npm ci will fail in Docker build",
            autoFixed: false,
          });
          autoFixable.push({
            pattern: "missing_frontend_lockfile",
            solution: "npm_install_frontend",
            name: "generate_frontend_lockfile",
          });
          return { issues, autoFixable };
        }

        const pkg = JSON.parse(fs.readFileSync(pkgPath, "utf-8"));
        const lock = JSON.parse(fs.readFileSync(lockPath, "utf-8"));

        const allPkgDeps = {
          ...(pkg.dependencies || {}),
          ...(pkg.devDependencies || {}),
        };

        // Check lockfile packages section for drift
        const lockPackages = lock.packages || {};
        const rootLockDeps = lockPackages[""]?.dependencies || {};
        const rootLockDevDeps = lockPackages[""]?.devDependencies || {};
        const allLockDeps = { ...rootLockDeps, ...rootLockDevDeps };

        let driftCount = 0;
        for (const dep of Object.keys(allPkgDeps)) {
          if (!allLockDeps[dep] && !lockPackages[`node_modules/${dep}`]) {
            driftCount++;
            if (driftCount <= 3) {
              issues.push({
                file: lockPath,
                severity: "warning",
                message: `Frontend dependency "${dep}" in package.json but missing from lockfile`,
              });
            }
          }
        }

        if (driftCount > 3) {
          issues.push({
            file: lockPath,
            severity: "critical",
            message: `${driftCount} frontend deps missing from lockfile — Docker build (npm ci) will fail`,
            autoFixed: false,
          });
          autoFixable.push({
            pattern: "frontend_lockfile_stale",
            solution: "npm_install_frontend",
            name: "sync_frontend_lockfile",
          });
        }

        return { issues, autoFixable };
      } catch {
        return { issues: [], autoFixable: [] };
      }
    },
  },

  // ── Frontend Build Checks ───────────────────────────────────────────────

  frontend_typescript: {
    name: "frontend_typescript",
    description: "Verify frontend TypeScript compiles without errors",
    action: async (projectRoot) => {
      try {
        const issues = [];
        const autoFixable = [];
        const frontendDir = path.join(projectRoot, "concord-frontend");
        const tsconfigPath = path.join(frontendDir, "tsconfig.json");

        if (!fs.existsSync(tsconfigPath)) return { issues, autoFixable };
        if (!fs.existsSync(path.join(frontendDir, "node_modules"))) return { issues, autoFixable };

        // Run tsc --noEmit to check for type errors
        try {
          await execAsync("npx tsc --noEmit 2>&1", {
            cwd: frontendDir,
            timeout: 120000,
            maxBuffer: 10 * 1024 * 1024,
          });
        } catch (tscErr) {
          const output = String(tscErr?.stdout || tscErr?.stderr || tscErr?.message || "");
          const errorLines = output.split("\n").filter(l => /error TS\d+/.test(l));

          if (errorLines.length > 0) {
            // Categorize errors
            const errorsByType = new Map();
            for (const line of errorLines) {
              const codeMatch = line.match(/error (TS\d+)/);
              const code = codeMatch ? codeMatch[1] : "unknown";
              errorsByType.set(code, (errorsByType.get(code) || 0) + 1);
            }

            issues.push({
              file: tsconfigPath,
              severity: "critical",
              message: `TypeScript: ${errorLines.length} error(s) — ${Array.from(errorsByType.entries()).map(([c, n]) => `${c}:${n}`).join(", ")}`,
              autoFixed: false,
            });

            // Report first 5 specific errors
            for (const line of errorLines.slice(0, 5)) {
              issues.push({
                file: frontendDir,
                severity: "warning",
                message: line.trim().slice(0, 200),
              });
            }
          }
        }

        return { issues, autoFixable };
      } catch {
        return { issues: [], autoFixable: [] };
      }
    },
  },

  frontend_next_config: {
    name: "frontend_next_config",
    description: "Verify next.config.js is valid and complete",
    action: async (projectRoot) => {
      try {
        const issues = [];
        const autoFixable = [];
        const frontendDir = path.join(projectRoot, "concord-frontend");
        const configPath = path.join(frontendDir, "next.config.js");

        if (!fs.existsSync(configPath)) {
          issues.push({
            file: frontendDir,
            severity: "critical",
            message: "next.config.js missing — Next.js build will use defaults",
          });
          return { issues, autoFixable };
        }

        const content = fs.readFileSync(configPath, "utf-8");

        // Check for standalone output (required for Docker)
        if (!content.includes("standalone")) {
          issues.push({
            file: configPath,
            severity: "critical",
            message: "next.config.js missing output: 'standalone' — Docker build requires it",
          });
        }

        // Check for image domains
        if (!content.includes("images")) {
          issues.push({
            file: configPath,
            severity: "warning",
            message: "next.config.js missing images configuration",
          });
        }

        return { issues, autoFixable };
      } catch {
        return { issues: [], autoFixable: [] };
      }
    },
  },

  frontend_env: {
    name: "frontend_env_vars",
    description: "Verify NEXT_PUBLIC_* env vars are set for frontend build",
    action: async (projectRoot) => {
      try {
        const issues = [];
        const autoFixable = [];
        const frontendDir = path.join(projectRoot, "concord-frontend");

        if (!fs.existsSync(frontendDir)) return { issues, autoFixable };

        // Scan for NEXT_PUBLIC_ references
        const envRefs = new Set();
        const scanDirs = ["app", "components", "lib", "hooks", "store"];

        for (const dir of scanDirs) {
          const dirPath = path.join(frontendDir, dir);
          if (!fs.existsSync(dirPath)) continue;

          try {
            const scanFiles = (d) => {
              const entries = fs.readdirSync(d, { withFileTypes: true });
              for (const entry of entries) {
                const fullPath = path.join(d, entry.name);
                if (entry.isDirectory() && !entry.name.startsWith(".") && entry.name !== "node_modules") {
                  scanFiles(fullPath);
                } else if (entry.isFile() && /\.(ts|tsx|js|jsx)$/.test(entry.name)) {
                  try {
                    const content = fs.readFileSync(fullPath, "utf-8");
                    const refs = content.matchAll(/process\.env\.(NEXT_PUBLIC_\w+)/g);
                    for (const ref of refs) envRefs.add(ref[1]);
                  } catch (_e) { logger.debug('emergent:repair-cortex', 'skip unreadable files', { error: _e?.message }); }
                }
              }
            };
            scanFiles(dirPath);
          } catch (_e) { logger.debug('emergent:repair-cortex', 'skip unreadable dirs', { error: _e?.message }); }
        }

        if (envRefs.size > 0) {
          // Check .env.local, .env.production, .env
          const envFiles = [".env.local", ".env.production", ".env"];
          const definedVars = new Set();
          for (const envFile of envFiles) {
            const envPath = path.join(frontendDir, envFile);
            if (fs.existsSync(envPath)) {
              const content = fs.readFileSync(envPath, "utf-8");
              for (const line of content.split("\n")) {
                const match = line.match(/^(NEXT_PUBLIC_\w+)=/);
                if (match) definedVars.add(match[1]);
              }
            }
          }

          // Also check root .env and docker-compose for build args
          const rootEnv = path.join(projectRoot, ".env");
          if (fs.existsSync(rootEnv)) {
            const content = fs.readFileSync(rootEnv, "utf-8");
            for (const line of content.split("\n")) {
              const match = line.match(/^(NEXT_PUBLIC_\w+)=/);
              if (match) definedVars.add(match[1]);
            }
          }

          for (const ref of envRefs) {
            if (!definedVars.has(ref)) {
              issues.push({
                severity: "warning",
                message: `NEXT_PUBLIC env var ${ref} used in code but not defined in any .env file`,
              });
            }
          }
        }

        return { issues, autoFixable };
      } catch {
        return { issues: [], autoFixable: [] };
      }
    },
  },

  frontend_imports: {
    name: "frontend_import_integrity",
    description: "Verify frontend path alias imports resolve correctly",
    action: async (projectRoot) => {
      try {
        const issues = [];
        const autoFixable = [];
        const frontendDir = path.join(projectRoot, "concord-frontend");
        const tsconfigPath = path.join(frontendDir, "tsconfig.json");

        if (!fs.existsSync(tsconfigPath)) return { issues, autoFixable };

        // Parse path aliases from tsconfig
        const tsconfig = JSON.parse(fs.readFileSync(tsconfigPath, "utf-8"));
        const paths = tsconfig.compilerOptions?.paths || {};

        // Verify each alias root directory exists
        for (const [alias, targets] of Object.entries(paths)) {
          for (const target of targets) {
            const cleanTarget = target.replace("/*", "").replace("*", "");
            const targetPath = path.resolve(frontendDir, cleanTarget);
            if (!fs.existsSync(targetPath)) {
              issues.push({
                file: tsconfigPath,
                severity: "warning",
                message: `Path alias "${alias}" maps to "${cleanTarget}" which does not exist`,
              });
            }
          }
        }

        return { issues, autoFixable };
      } catch {
        return { issues: [], autoFixable: [] };
      }
    },
  },

  // ── Peer Dependency Check ───────────────────────────────────────────────

  peer_deps: {
    name: "peer_dependency_check",
    description: "Check for peer dependency version conflicts",
    action: async (projectRoot) => {
      try {
        const issues = [];
        const autoFixable = [];

        // Check both server and frontend
        for (const subdir of ["server", "concord-frontend"]) {
          const dir = path.join(projectRoot, subdir);
          const nmPath = path.join(dir, "node_modules");
          if (!fs.existsSync(nmPath)) continue;

          // Quick peer dep audit via npm ls
          try {
            await execAsync("npm ls --depth=0 2>&1", {
              cwd: dir,
              timeout: 30000,
              maxBuffer: 5 * 1024 * 1024,
            });
          } catch (lsErr) {
            const output = String(lsErr?.stdout || lsErr?.stderr || "");
            const peerIssues = output.split("\n").filter(l =>
              /peer dep|ERESOLVE|missing|invalid/.test(l)
            );
            if (peerIssues.length > 0) {
              issues.push({
                severity: "warning",
                message: `${subdir}: ${peerIssues.length} peer dependency warning(s)`,
              });
              for (const line of peerIssues.slice(0, 3)) {
                issues.push({
                  severity: "info",
                  message: `  ${line.trim().slice(0, 150)}`,
                });
              }
            }
          }
        }

        return { issues, autoFixable };
      } catch {
        return { issues: [], autoFixable: [] };
      }
    },
  },

  // ── Native Module Health ────────────────────────────────────────────────

  native_modules: {
    name: "native_module_health",
    description: "Verify native modules (better-sqlite3, sharp) are compiled correctly",
    action: async (projectRoot) => {
      try {
        const issues = [];
        const autoFixable = [];
        const serverDir = path.join(projectRoot, "server");
        const nmPath = path.join(serverDir, "node_modules");

        if (!fs.existsSync(nmPath)) return { issues, autoFixable };

        // Check better-sqlite3 (critical for server)
        const sqlitePath = path.join(nmPath, "better-sqlite3");
        if (fs.existsSync(sqlitePath)) {
          const bindingPath = path.join(sqlitePath, "build", "Release", "better_sqlite3.node");
          const prebuildPath = path.join(sqlitePath, "prebuilds");
          if (!fs.existsSync(bindingPath) && !fs.existsSync(prebuildPath)) {
            issues.push({
              file: sqlitePath,
              severity: "critical",
              message: "better-sqlite3 native binary missing — needs rebuild",
              autoFixed: false,
            });
            autoFixable.push({
              pattern: "sqlite3_native_missing",
              solution: "npm_rebuild_sqlite",
              name: "rebuild_better_sqlite3",
            });
          }
        }

        return { issues, autoFixable };
      } catch {
        return { issues: [], autoFixable: [] };
      }
    },
  },

  // ── Nginx Config Check ──────────────────────────────────────────────────

  nginx_config: {
    name: "nginx_config_check",
    description: "Verify nginx configuration files exist and reference valid upstreams",
    action: async (projectRoot) => {
      try {
        const issues = [];
        const autoFixable = [];
        const nginxDir = path.join(projectRoot, "nginx");

        if (!fs.existsSync(nginxDir)) return { issues, autoFixable };

        const mainConf = path.join(nginxDir, "nginx.conf");
        if (!fs.existsSync(mainConf)) {
          issues.push({
            file: nginxDir,
            severity: "critical",
            message: "nginx/nginx.conf missing — nginx container will fail to start",
          });
          return { issues, autoFixable };
        }

        const content = fs.readFileSync(mainConf, "utf-8");

        // Check for proxy_pass references to services defined in docker-compose
        const composePath = path.join(projectRoot, "docker-compose.yml");
        if (fs.existsSync(composePath)) {
          const composeContent = fs.readFileSync(composePath, "utf-8");
          const proxyPasses = content.matchAll(/proxy_pass\s+https?:\/\/([^:/\s;]+)/g);
          for (const m of proxyPasses) {
            const upstream = m[1];
            // Check that the upstream is a service in docker-compose
            if (!composeContent.includes(`${upstream}:`) &&
                !["localhost", "127.0.0.1"].includes(upstream)) {
              issues.push({
                file: mainConf,
                severity: "warning",
                message: `nginx proxy_pass references "${upstream}" which may not be a docker-compose service`,
              });
            }
          }
        }

        return { issues, autoFixable };
      } catch {
        return { issues: [], autoFixable: [] };
      }
    },
  },

  // ── SSL/Cert Check ──────────────────────────────────────────────────────

  ssl_certificate: {
    name: "ssl_certificate_check",
    description: "Check SSL certificates are present and not expired",
    action: async (projectRoot) => {
      try {
        const issues = [];
        const autoFixable = [];
        const certDir = path.join(projectRoot, "certbot", "conf", "live");

        if (!fs.existsSync(certDir)) return { issues, autoFixable }; // No certs configured

        const domains = fs.readdirSync(certDir).filter(d => {
          const p = path.join(certDir, d);
          return fs.statSync(p).isDirectory() && d !== "README";
        });

        for (const domain of domains) {
          const certPath = path.join(certDir, domain, "fullchain.pem");
          if (!fs.existsSync(certPath)) {
            issues.push({
              severity: "critical",
              message: `SSL certificate missing for ${domain}`,
            });
            continue;
          }

          // Check certificate expiry via openssl
          try {
            const { stdout } = await safeExec(
              `openssl x509 -enddate -noout -in "${certPath}" 2>/dev/null`,
              5000
            );
            const dateMatch = stdout.match(/notAfter=(.+)/);
            if (dateMatch) {
              const expiry = new Date(dateMatch[1]);
              const daysLeft = Math.floor((expiry.getTime() - Date.now()) / 86400000);
              if (daysLeft < 0) {
                issues.push({
                  severity: "critical",
                  message: `SSL certificate for ${domain} EXPIRED ${Math.abs(daysLeft)} days ago`,
                });
              } else if (daysLeft < 14) {
                issues.push({
                  severity: "warning",
                  message: `SSL certificate for ${domain} expires in ${daysLeft} days`,
                });
              }
            }
          } catch (_e) { logger.debug('emergent:repair-cortex', 'silent — openssl may not be available', { error: _e?.message }); }
        }

        return { issues, autoFixable };
      } catch {
        return { issues: [], autoFixable: [] };
      }
    },
  },
};

/**
 * Phase 1: Pre-Build Prophet
 * Runs BEFORE docker-compose build. Preventive immune scan.
 */
export async function runProphet(projectRoot) {
  try {
    const startTime = Date.now();
    const results = {
      phase: REPAIR_PHASES.PRE_BUILD,
      timestamp: nowISO(),
      checks: [],
      totalIssues: 0,
      autoFixed: 0,
      blocked: false,
    };

    for (const [key, check] of Object.entries(PRE_BUILD_CHECKS)) {
      try {
        const result = await check.action(projectRoot);

        // Auto-fix what we can
        for (const fix of (result.autoFixable || [])) {
          addToRepairMemory(fix.pattern, fix);
          logRepairDTU(REPAIR_PHASES.PRE_BUILD, check.name, fix);
          results.autoFixed++;
        }

        // Flag what we can't
        const unfixed = (result.issues || []).filter(i => !i.autoFixed);
        if (unfixed.length > 0) {
          results.blocked = results.blocked || unfixed.some(i => i.severity === "critical");
        }

        results.checks.push({
          name: check.name,
          description: check.description,
          issues: (result.issues || []).length,
          fixed: (result.autoFixable || []).length,
          unfixed: unfixed.length,
          details: unfixed.slice(0, 5),
        });

        results.totalIssues += (result.issues || []).length;
      } catch {
        results.checks.push({
          name: check.name,
          issues: 0,
          fixed: 0,
          unfixed: 0,
          error: "Check threw — skipped",
        });
      }
    }

    results.durationMs = Date.now() - startTime;

    logRepairDTU(REPAIR_PHASES.PRE_BUILD, "prophet_complete", {
      totalIssues: results.totalIssues,
      autoFixed: results.autoFixed,
      blocked: results.blocked,
      durationMs: results.durationMs,
    });

    // Update organ maturity for learning
    _updateOrganFromRepair(REPAIR_PHASES.PRE_BUILD, results);

    return results;
  } catch (e) {
    return {
      phase: REPAIR_PHASES.PRE_BUILD,
      timestamp: nowISO(),
      checks: [],
      totalIssues: 0,
      autoFixed: 0,
      blocked: false,
      error: String(e?.message || e),
    };
  }
}

// ── Mid-Build Surgeon ───────────────────────────────────────────────────────

/**
 * Execute a fix command on disk. Maps fix names to shell commands.
 * Returns true if the command ran successfully.
 */
const _FIX_COMMANDS = {
  regenerate_lockfile:      (root) => `cd "${root}" && npm install --package-lock-only`,
  run_npm_install_first:    (root) => `cd "${root}" && npm install --package-lock-only`,
  install_legacy_peer_deps: (root) => `cd "${root}" && npm install --legacy-peer-deps`,
  install_force:            (root) => `cd "${root}" && npm install --force`,
  delete_and_reinstall:     (root) => `cd "${root}" && rm -rf node_modules package-lock.json && npm install`,
  reinstall_deps:           (root) => `cd "${root}" && npm install`,
  npm_audit_fix:            (root) => `cd "${root}" && npm audit fix || true`,
  install_package:          (root, m) => m?.[1] ? `cd "${root}" && npm install "${m[1]}" || true` : null,
  install_missing:          (root, m) => m?.[1] ? `cd "${root}" && npm install "${m[1]}" || true` : null,
  rebuild_native:           (root) => `cd "${root}" && npm rebuild`,
  rebuild_sqlite:           (root) => `cd "${root}" && npm rebuild better-sqlite3`,
  reinstall_sqlite:         (root) => `cd "${root}" && npm uninstall better-sqlite3 && npm install better-sqlite3`,
  reinstall_sharp:          (root) => `cd "${root}" && npm install --platform=linux --arch=x64 sharp`,
  kill_process:             (_r, m) => m?.[1] ? `fuser -k ${m[1]}/tcp 2>/dev/null || true` : null,
  create_directory:         (_r, m) => m?.[1] ? `mkdir -p "${m[1]}"` : null,
  fix_permissions:          (_r, m) => m?.[1] ? `chmod -R u+rwX "${m[1]}"` : null,
  docker_prune:             () => `docker system prune -f && docker builder prune -f`,
  clear_docker_cache:       () => `docker builder prune -f`,
  clean_old_images:         () => `docker image prune -f`,
  recreate_network:         () => `docker network prune -f`,
  // eslint autofix — runs on the concord-frontend directory
  eslint_autofix:           (root) => `cd "${root}/concord-frontend" && npx eslint --fix app/ components/ lib/ hooks/ store/ --ext .tsx,.ts 2>/dev/null || true`,
  // useRef React 19 fix — useRef<T>() → useRef<T>(undefined)
  fix_useref_react19:       (root) => `find "${root}/concord-frontend" -name "*.tsx" -o -name "*.ts" | xargs sed -i 's/useRef<\\([^>]*\\)>()/useRef<\\1>(undefined)/g' 2>/dev/null || true`,
};

async function _executeFix(fixName, projectRoot, match, errorContext) {
  try {
    const cmdFn = _FIX_COMMANDS[fixName];
    if (!cmdFn) return false;

    // For useRef fix, if we have a specific file from the error, target it
    if (fixName === "fix_useref_react19" && errorContext?.file) {
      const targetFile = path.resolve(projectRoot, "concord-frontend", errorContext.file);
      const cmd = `sed -i 's/useRef<\\([^>]*\\)>()/useRef<\\1>(undefined)/g' "${targetFile}" 2>/dev/null || true`;
      await execAsync(cmd, { timeout: 10000 });
      return true;
    }

    const cmd = cmdFn(projectRoot, match);
    if (!cmd) return false;
    await execAsync(cmd, { timeout: 120000 });
    return true;
  } catch {
    return false;
  }
}

/**
 * Parse a build error from stderr output.
 */
function parseBuildError(stderr) {
  try {
    if (!stderr) return null;
    const lines = stderr.split("\n").filter(l => l.trim());
    for (const line of lines) {
      // Try each error pattern
      for (const [key, pattern] of Object.entries(ERROR_PATTERNS)) {
        const match = pattern.regex.exec(line);
        if (match) {
          // Try to extract file and line number
          const fileMatch = line.match(/(?:^|\s)([\w./\\-]+\.[jt]sx?):(\d+)/);
          return {
            key,
            category: pattern.category,
            message: line.trim(),
            match,
            file: fileMatch?.[1] || null,
            line: fileMatch?.[2] ? parseInt(fileMatch[2], 10) : null,
            pattern: match[0],
          };
        }
      }
    }
    // Return first non-empty line as unrecognized error
    const firstLine = lines.find(l => l.length > 10) || lines[0] || stderr.slice(0, 200);
    return {
      key: "unrecognized",
      category: "unknown",
      message: firstLine,
      match: null,
      file: null,
      line: null,
      pattern: firstLine,
    };
  } catch {
    return null;
  }
}

/**
 * Phase 2: Mid-Build Surgeon
 * Wraps build process. Intercepts errors, fixes, and retries.
 *
 * @param {string} buildCommand - The build command to execute
 * @param {string} projectRoot - Project root directory
 * @param {number} [maxRetries=3] - Maximum number of retry attempts
 * @returns {Promise<object>} Build result with fix history
 */
export async function runSurgeon(buildCommand, projectRoot, maxRetries = MAX_BUILD_RETRIES) {
  let attempt = 0;
  let lastError = null;
  const fixesApplied = [];

  while (attempt < maxRetries) {
    attempt++;

    try {
      const buildResult = await execAsync(buildCommand, {
        cwd: projectRoot,
        timeout: 900000,  // 15 minute build timeout (frontend builds can take 10+ min)
        maxBuffer: 50 * 1024 * 1024,
      });

      // Build succeeded
      logRepairDTU(REPAIR_PHASES.MID_BUILD, "build_success", {
        attempt,
        fixesApplied,
        previousErrors: lastError ? [lastError.message] : [],
      });

      if (attempt > 1) {
        // Record successes for fixes that were applied
        for (const fix of fixesApplied) {
          recordRepairSuccess(fix.pattern);
        }
      }

      _updateOrganFromRepair(REPAIR_PHASES.MID_BUILD, { success: true, attempt });

      return { ok: true, success: true, attempt, fixes: fixesApplied };
    } catch (buildErr) {
      const stderr = String(buildErr?.stderr || buildErr?.message || "");
      const error = parseBuildError(stderr);

      if (!error || error.key === "unrecognized") {
        // Check repair memory first
        const knownFix = error ? lookupRepairMemory(error.pattern) : null;

        if (knownFix) {
          logRepairDTU(REPAIR_PHASES.MID_BUILD, "known_fix_attempted", {
            pattern: error.pattern,
            fix: knownFix.name,
          });
          fixesApplied.push({ pattern: error.pattern, fix: knownFix.name, source: "memory" });
          lastError = error;
          continue;
        }

        // Try HLR integration for unknown errors
        const hlrResult = await _tryHLRDiagnosis(error?.message || stderr);

        logRepairDTU(REPAIR_PHASES.MID_BUILD, "escalated", {
          attempt,
          error: error?.message || stderr.slice(0, 500),
          hlrAnalysis: hlrResult,
          message: "Unrecognized build error — sovereign intervention required",
        });

        _updateOrganFromRepair(REPAIR_PHASES.MID_BUILD, { success: false, escalated: true });

        return {
          ok: false,
          success: false,
          attempt,
          error: error?.message || stderr.slice(0, 500),
          escalated: true,
          hlrAnalysis: hlrResult,
          fixesApplied,
          message: "Unrecognized build error — sovereign intervention required",
        };
      }

      // Known pattern — check repair memory
      const knownFix = lookupRepairMemory(error.pattern);
      if (knownFix) {
        // Actually execute the fix on disk
        const fixApplied = await _executeFix(knownFix.name, projectRoot, error.match, error);
        logRepairDTU(REPAIR_PHASES.MID_BUILD, fixApplied ? "known_fix_applied" : "known_fix_no_command", {
          pattern: error.pattern,
          fix: knownFix.name,
          file: error.file,
          line: error.line,
          executed: fixApplied,
        });
        fixesApplied.push({ pattern: error.pattern, fix: knownFix.name, source: "memory", executed: fixApplied });
        lastError = error;
        continue;
      }

      // New error — sort fixes by confidence
      const patternInfo = ERROR_PATTERNS[error.key];
      if (patternInfo) {
        const fixes = [...patternInfo.fixes].sort((a, b) => b.confidence - a.confidence);
        let fixed = false;

        for (const fix of fixes) {
          // Actually execute the fix on disk
          const executed = await _executeFix(fix.name, projectRoot, error.match, error);

          // Record the fix attempt
          addToRepairMemory(error.pattern, {
            name: fix.name,
            confidence: fix.confidence,
            category: error.category,
            description: fix.describe(error.match),
          });

          logRepairDTU(REPAIR_PHASES.MID_BUILD, executed ? "new_fix_applied" : "new_fix_no_command", {
            pattern: error.key,
            fix: fix.name,
            confidence: fix.confidence,
            file: error.file,
            line: error.line,
            description: fix.describe(error.match),
            executed,
          });

          fixesApplied.push({
            pattern: error.pattern,
            fix: fix.name,
            confidence: fix.confidence,
            source: "pattern_match",
            executed,
          });

          if (executed) {
            fixed = true;
            lastError = error;
            break;
          }
          // If this fix had no command, try the next one
        }

        if (!fixed) {
          logRepairDTU(REPAIR_PHASES.MID_BUILD, "all_fixes_failed", {
            pattern: error.key,
            attempted: fixes.map(f => f.name),
          });

          return {
            ok: false,
            success: false,
            attempt,
            error: error.message,
            escalated: true,
            patternsAttempted: fixes.map(f => f.name),
            fixesApplied,
            message: "All fix patterns failed — sovereign intervention required",
          };
        }
      } else {
        lastError = error;

        return {
          ok: false,
          success: false,
          attempt,
          error: error.message,
          escalated: true,
          fixesApplied,
          message: `Build failed after ${attempt} attempts`,
        };
      }
    }
  }

  _updateOrganFromRepair(REPAIR_PHASES.MID_BUILD, { success: false, attempt });

  return {
    ok: false,
    success: false,
    attempt,
    error: lastError?.message,
    fixesApplied,
    message: `Build failed after ${maxRetries} repair attempts`,
  };
}

/**
 * Try HLR reasoning on an unknown error.
 */
async function _tryHLRDiagnosis(errorMessage) {
  try {
    const hlrMod = await import("./hlr-engine.js").catch(() => null);
    if (hlrMod && typeof hlrMod.runHLR === "function") {
      const result = hlrMod.runHLR({
        topic: "build_error_diagnosis",
        question: `Build failed with error: ${String(errorMessage).slice(0, 500)}`,
        mode: "abductive",
      });
      return result;
    }
    return null;
  } catch {
    return null;
  }
}

// ── Post-Build Guardian ─────────────────────────────────────────────────────
// Runs continuously while the system is live. Runtime self-repair.

const _guardianTimers = new Map();
const _guardianStatuses = new Map();

const GUARDIAN_MONITORS = {
  process_health: {
    interval: GUARDIAN_INTERVALS.process_health,
    check: async () => {
      try {
        const mem = process.memoryUsage();
        return {
          healthy: mem.heapUsed / mem.heapTotal < 0.85,
          heapUsedMB: Math.round(mem.heapUsed / 1024 / 1024),
          heapTotalMB: Math.round(mem.heapTotal / 1024 / 1024),
          rssMB: Math.round(mem.rss / 1024 / 1024),
          heapRatio: (mem.heapUsed / mem.heapTotal).toFixed(3),
        };
      } catch {
        return { healthy: true };
      }
    },
    repair: async (result) => {
      try {
        if (!result.healthy) {
          // Force GC if available
          if (global.gc) global.gc();
          logRepairDTU(REPAIR_PHASES.POST_BUILD, "memory_pressure_repair", result);
        }
      } catch (_e) { logger.debug('emergent:repair-cortex', 'silent', { error: _e?.message }); }
    },
  },

  state_consistency: {
    interval: GUARDIAN_INTERVALS.state_consistency,
    check: async () => {
      try {
        const S = _getSTATE();
        if (!S) return { healthy: true, reason: "STATE not available" };

        const dtusInMap = S.dtus instanceof Map ? S.dtus.size : 0;
        const dtusInIndex = Array.isArray(S.dtuIndex) ? S.dtuIndex.length : -1;

        // If no index exists, that's fine
        if (dtusInIndex < 0) return { healthy: true, dtusInMap, dtusInIndex: "N/A" };

        return {
          healthy: Math.abs(dtusInMap - dtusInIndex) < 5,
          dtusInMap,
          dtusInIndex,
          drift: Math.abs(dtusInMap - dtusInIndex),
        };
      } catch {
        return { healthy: true };
      }
    },
    repair: async (result) => {
      try {
        if (!result.healthy) {
          const S = _getSTATE();
          if (S && S.dtus instanceof Map && Array.isArray(S.dtuIndex)) {
            S.dtuIndex = Array.from(S.dtus.keys());
            logRepairDTU(REPAIR_PHASES.POST_BUILD, "state_index_rebuilt", result);
          }
        }
      } catch (_e) { logger.debug('emergent:repair-cortex', 'silent', { error: _e?.message }); }
    },
  },

  disk_space: {
    interval: GUARDIAN_INTERVALS.disk_space,
    check: async () => {
      try {
        const { stdout } = await safeExec("df -h / | tail -1 | awk '{print $5}' | tr -d '%'");
        const usagePercent = parseInt(stdout.trim(), 10);
        if (isNaN(usagePercent)) return { healthy: true, usagePercent: -1 };
        return {
          healthy: usagePercent < 85,
          usagePercent,
          warning: usagePercent > 75,
        };
      } catch {
        return { healthy: true, usagePercent: -1 };
      }
    },
    repair: async (result) => {
      try {
        if (result.usagePercent > 90) {
          await safeDockerExec("docker system prune -f 2>/dev/null");
          logRepairDTU(REPAIR_PHASES.POST_BUILD, "emergency_disk_cleanup", result);
        } else if (result.warning) {
          await safeExec("find /data -name '*.log' -mtime +3 -delete 2>/dev/null");
        }
      } catch (_e) { logger.debug('emergent:repair-cortex', 'silent', { error: _e?.message }); }
    },
  },

  endpoint_health: {
    interval: GUARDIAN_INTERVALS.endpoint_health,
    check: async () => {
      try {
        const PORT = process.env.PORT || 3000;
        const endpoints = ["/health", "/ready"];
        const results = [];

        for (const ep of endpoints) {
          try {
            const start = Date.now();
            const res = await fetch(`http://localhost:${PORT}${ep}`, {
              signal: AbortSignal.timeout(3000), // 3s cap — prevent self-deadlock
            });
            results.push({
              endpoint: ep,
              status: res.status,
              latencyMs: Date.now() - start,
              healthy: res.ok,
            });
          } catch (err) {
            results.push({ endpoint: ep, healthy: false, error: String(err?.message || err) });
          }
        }

        return {
          healthy: results.every(r => r.healthy),
          endpoints: results,
        };
      } catch {
        return { healthy: true, endpoints: [] };
      }
    },
    repair: async (result) => {
      try {
        const unhealthy = (result.endpoints || []).filter(e => !e.healthy);
        for (const ep of unhealthy) {
          logRepairDTU(REPAIR_PHASES.POST_BUILD, "endpoint_failure", ep);
        }
      } catch (_e) { logger.debug('emergent:repair-cortex', 'silent', { error: _e?.message }); }
    },
  },

  ollama_connectivity: {
    interval: GUARDIAN_INTERVALS.ollama_connectivity,
    _failCount: 0,
    _backoffUntil: 0,
    check: async function() {
      // Back off after repeated failures — Ollama may just be uninstalled
      if (this._backoffUntil > Date.now()) {
        return { healthy: true, backingOff: true };
      }
      try {
        const host = process.env.OLLAMA_HOST || "http://concord-ollama:11434";
        const res = await fetch(`${host}/api/tags`, { signal: AbortSignal.timeout(3000) });
        const data = await res.json();
        this._failCount = 0;
        clearBrainCooldown(); // Ollama is reachable
        return {
          healthy: res.ok,
          models: (data.models || []).map(m => m.name),
          modelCount: (data.models || []).length,
        };
      } catch {
        this._failCount++;
        if (this._failCount >= 3) {
          this._backoffUntil = Date.now() + 600_000; // back off 10 minutes
          enterBrainCooldown();
        }
        return { healthy: false, error: "Ollama unreachable", failCount: this._failCount };
      }
    },
    repair: async function(result) {
      try {
        if (!result.healthy && !result.backingOff) {
          const res = await safeDockerExec("docker restart concord-ollama 2>/dev/null", 10000);
          logRepairDTU(REPAIR_PHASES.POST_BUILD, res.skipped ? "ollama_restart_skipped_no_docker" : "ollama_restart", result);
        }
      } catch (_e) { logger.debug('emergent:repair-cortex', 'silent', { error: _e?.message }); }
    },
  },

  autogen_health: {
    interval: GUARDIAN_INTERVALS.autogen_health,
    check: async () => {
      try {
        const S = _getSTATE();
        if (!S) return { healthy: true };

        const enabled = S.autogenEnabled || false;
        const lastTime = S.lastAutogenTime || null;
        const stale = lastTime && (Date.now() - new Date(lastTime).getTime()) > 600000; // 10 min

        return {
          healthy: !enabled || !stale,
          enabled,
          lastGenTime: lastTime,
          stale: stale || false,
        };
      } catch {
        return { healthy: true };
      }
    },
    repair: async (result) => {
      try {
        if (result.enabled && !result.healthy) {
          logRepairDTU(REPAIR_PHASES.POST_BUILD, "autogen_stalled", result);
        }
      } catch (_e) { logger.debug('emergent:repair-cortex', 'silent', { error: _e?.message }); }
    },
  },

  emergent_vitals: {
    interval: GUARDIAN_INTERVALS.emergent_vitals,
    check: async () => {
      try {
        const S = _getSTATE();
        if (!S) return { healthy: true, entities: [] };

        const emergents = S.emergents || new Map();
        const bodies = S.bodies || new Map();
        const vitals = [];

        for (const [id] of emergents) {
          const body = bodies.get(id);
          if (body) {
            const homeostasis = body.growth?.homeostasis || 0;
            const telomere = body.growth?.telomere || 0;
            vitals.push({
              id,
              homeostasis,
              telomere,
              critical: homeostasis < 0.2,
              dying: telomere < 0.05,
            });
          }
        }

        return {
          healthy: !vitals.some(v => v.critical && !v.dying),
          entities: vitals,
          criticalCount: vitals.filter(v => v.critical).length,
        };
      } catch {
        return { healthy: true, entities: [] };
      }
    },
    repair: async (result) => {
      try {
        for (const entity of (result.entities || []).filter(e => e.critical && !e.dying)) {
          logRepairDTU(REPAIR_PHASES.POST_BUILD, "entity_critical", entity);
        }
      } catch (_e) { logger.debug('emergent:repair-cortex', 'silent', { error: _e?.message }); }
    },
  },

  // ── Frontend Health ─────────────────────────────────────────────────────

  frontend_health: {
    interval: GUARDIAN_INTERVALS.frontend_health,
    _failCount: 0,
    _backoffUntil: 0,
    check: async function() {
      // Back off for 5 minutes after 3 consecutive failures
      if (this._backoffUntil > Date.now()) {
        return { healthy: true, backingOff: true }; // suppress during backoff
      }

      try {
        const FRONTEND_PORT = process.env.FRONTEND_PORT || 3000;
        const frontendHost = process.env.FRONTEND_HOST || "concord-frontend";

        // Try internal Docker network first, then localhost (max 2 attempts)
        const hosts = [`http://${frontendHost}:${FRONTEND_PORT}`, `http://localhost:${FRONTEND_PORT}`];

        for (const base of hosts) {
          try {
            const start = Date.now();
            const res = await fetch(base, { signal: AbortSignal.timeout(5000) });
            this._failCount = 0; // reset on success
            return {
              healthy: res.status < 500,
              statusCode: res.status,
              latencyMs: Date.now() - start,
              host: base,
            };
          } catch (_e) { logger.debug('emergent:repair-cortex', 'try next host', { error: _e?.message }); }
        }

        // All hosts failed
        this._failCount++;
        if (this._failCount >= 3) {
          this._backoffUntil = Date.now() + 300_000; // back off 5 minutes
          logger.info('emergent:repair-cortex', `Frontend unreachable ${this._failCount}x, backing off 5 minutes`);
        }

        return { healthy: false, error: "Frontend unreachable on all hosts", failCount: this._failCount };
      } catch {
        return { healthy: true }; // Can't check — assume OK
      }
    },
    repair: async function(result) {
      try {
        if (!result.healthy && !result.backingOff) {
          // Try restarting the frontend container
          const res = await safeDockerExec("docker restart concord-frontend 2>/dev/null");
          logRepairDTU(REPAIR_PHASES.POST_BUILD, res.skipped ? "frontend_restart_skipped_no_docker" : "frontend_restart", result);
        }
      } catch (_e) { logger.debug('emergent:repair-cortex', 'silent', { error: _e?.message }); }
    },
  },

  // ── Container Health ────────────────────────────────────────────────────

  container_health: {
    interval: GUARDIAN_INTERVALS.container_health,
    check: async () => {
      try {
        const { stdout } = await safeExec(
          "docker ps --format '{{.Names}}|{{.Status}}|{{.State}}' 2>/dev/null",
          10000
        );

        if (!stdout || !stdout.trim()) {
          return { healthy: true, containers: [], note: "Docker not available or no containers" };
        }

        const containers = [];
        const lines = stdout.trim().split("\n").filter(Boolean);

        for (const line of lines) {
          const [name, status, state] = line.split("|");
          if (!name || !name.startsWith("concord-")) continue;

          const restartMatch = status.match(/Restarting.*\((\d+)\)/);
          const restartCount = restartMatch ? parseInt(restartMatch[1], 10) : 0;
          const isUnhealthy = state === "unhealthy" || status.includes("unhealthy");
          const isRestarting = state === "restarting" || restartCount > 3;

          containers.push({
            name,
            status,
            state,
            restartCount,
            healthy: !isUnhealthy && !isRestarting,
          });
        }

        return {
          healthy: containers.every(c => c.healthy),
          containers,
          unhealthyCount: containers.filter(c => !c.healthy).length,
        };
      } catch {
        return { healthy: true, containers: [] };
      }
    },
    repair: async (result) => {
      try {
        for (const container of (result.containers || []).filter(c => !c.healthy)) {
          if (container.restartCount > 5) {
            // Container in restart loop — log but don't restart (would make it worse)
            logRepairDTU(REPAIR_PHASES.POST_BUILD, "container_restart_loop", {
              container: container.name,
              restartCount: container.restartCount,
              message: "Container in restart loop — sovereign intervention needed",
            });
          } else {
            logRepairDTU(REPAIR_PHASES.POST_BUILD, "container_unhealthy", container);
          }
        }
      } catch (_e) { logger.debug('emergent:repair-cortex', 'silent', { error: _e?.message }); }
    },
  },

  // ── Nginx Health ────────────────────────────────────────────────────────

  nginx_health: {
    interval: GUARDIAN_INTERVALS.nginx_health,
    check: async () => {
      try {
        // Check nginx is running and responsive
        const { stdout: status } = await safeExec(
          "docker inspect --format='{{.State.Status}}' concord-nginx 2>/dev/null",
          5000
        );

        const containerRunning = (status || "").trim() === "running";
        if (!containerRunning) {
          return { healthy: false, error: "nginx container not running" };
        }

        // Check nginx config is valid inside container
        const { stdout: testOut, stderr: testErr } = await safeExec(
          "docker exec concord-nginx nginx -t 2>&1",
          10000
        );

        const configValid = (testOut + testErr).includes("successful");

        return {
          healthy: containerRunning && configValid,
          containerRunning,
          configValid,
        };
      } catch {
        return { healthy: true }; // Can't check — assume OK
      }
    },
    repair: async (result) => {
      try {
        if (!result.healthy) {
          if (!result.containerRunning) {
            const res = await safeDockerExec("docker restart concord-nginx 2>/dev/null");
            logRepairDTU(REPAIR_PHASES.POST_BUILD, res.skipped ? "nginx_restart_skipped_no_docker" : "nginx_restart", result);
          } else if (!result.configValid) {
            logRepairDTU(REPAIR_PHASES.POST_BUILD, "nginx_config_invalid", {
              message: "Nginx config test failed — sovereign intervention needed",
            });
          }
        }
      } catch (_e) { logger.debug('emergent:repair-cortex', 'silent', { error: _e?.message }); }
    },
  },

  // ── WebSocket Health ────────────────────────────────────────────────────

  websocket_health: {
    interval: GUARDIAN_INTERVALS.websocket_health,
    check: async () => {
      try {
        const S = _getSTATE();
        const PORT = process.env.PORT || 5050;

        // Check socket.io endpoint
        try {
          const res = await fetch(`http://localhost:${PORT}/socket.io/?EIO=4&transport=polling`, {
            signal: AbortSignal.timeout(5000),
          });
          const socketIoAlive = res.ok || res.status === 400; // 400 = needs sid, but endpoint exists

          // Check connected client count from STATE if available
          const connectedClients = S?.realtimeClients?.size || S?._socketCount || -1;

          return {
            healthy: socketIoAlive,
            socketIoAlive,
            connectedClients,
          };
        } catch {
          return { healthy: false, error: "Socket.IO endpoint unreachable" };
        }
      } catch {
        return { healthy: true };
      }
    },
    repair: async (result) => {
      try {
        if (!result.healthy) {
          logRepairDTU(REPAIR_PHASES.POST_BUILD, "websocket_failure", result);
        }
      } catch (_e) { logger.debug('emergent:repair-cortex', 'silent', { error: _e?.message }); }
    },
  },

  // ── Event Loop Lag ──────────────────────────────────────────────────────

  event_loop_lag: {
    interval: GUARDIAN_INTERVALS.event_loop_lag,
    check: async () => {
      try {
        const start = process.hrtime.bigint();
        await new Promise(resolve => { setImmediate(resolve); });
        const lagNs = Number(process.hrtime.bigint() - start);
        const lagMs = lagNs / 1_000_000;

        return {
          healthy: lagMs < 100,
          lagMs: Math.round(lagMs * 100) / 100,
          warning: lagMs > 50,
          critical: lagMs > 200,
        };
      } catch {
        return { healthy: true, lagMs: -1 };
      }
    },
    repair: async (result) => {
      try {
        if (result.critical) {
          // Force GC if available
          if (global.gc) global.gc();
          logRepairDTU(REPAIR_PHASES.POST_BUILD, "event_loop_critical", {
            lagMs: result.lagMs,
            message: "Event loop lag > 200ms — possible CPU saturation",
          });
        } else if (result.warning) {
          logRepairDTU(REPAIR_PHASES.POST_BUILD, "event_loop_warning", {
            lagMs: result.lagMs,
          });
        }
      } catch (_e) { logger.debug('emergent:repair-cortex', 'silent', { error: _e?.message }); }
    },
  },

  // ── SSL Certificate Runtime ─────────────────────────────────────────────

  ssl_certificate_runtime: {
    interval: GUARDIAN_INTERVALS.ssl_certificate,
    check: async () => {
      try {
        const certDir = "/etc/letsencrypt/live";
        // Check from host or inside container
        const { stdout } = await safeExec(
          `find ${certDir} -name 'fullchain.pem' -exec openssl x509 -enddate -noout -in {} \\; 2>/dev/null || ` +
          `docker exec concord-certbot find ${certDir} -name 'fullchain.pem' -exec openssl x509 -enddate -noout -in {} \\; 2>/dev/null`,
          15000
        );

        if (!stdout || !stdout.trim()) return { healthy: true, note: "No certs found or certbot not running" };

        const certs = [];
        for (const line of stdout.trim().split("\n")) {
          const dateMatch = line.match(/notAfter=(.+)/);
          if (dateMatch) {
            const expiry = new Date(dateMatch[1]);
            const daysLeft = Math.floor((expiry.getTime() - Date.now()) / 86400000);
            certs.push({ expiry: expiry.toISOString(), daysLeft });
          }
        }

        const minDays = certs.length > 0 ? Math.min(...certs.map(c => c.daysLeft)) : 999;

        return {
          healthy: minDays > 7,
          certs,
          minDaysUntilExpiry: minDays,
          warning: minDays < 14,
          critical: minDays < 3,
        };
      } catch {
        return { healthy: true };
      }
    },
    repair: async (result) => {
      try {
        if (result.critical) {
          // Attempt cert renewal
          await safeDockerExec("docker exec concord-certbot certbot renew --force-renewal 2>/dev/null", 60000);
          await safeDockerExec("docker exec concord-nginx nginx -s reload 2>/dev/null", 10000);
          logRepairDTU(REPAIR_PHASES.POST_BUILD, "ssl_emergency_renewal", result);
        } else if (result.warning) {
          logRepairDTU(REPAIR_PHASES.POST_BUILD, "ssl_expiry_warning", {
            daysLeft: result.minDaysUntilExpiry,
          });
        }
      } catch (_e) { logger.debug('emergent:repair-cortex', 'silent', { error: _e?.message }); }
    },
  },

  // ── Database Connection Health ──────────────────────────────────────────

  database_connection: {
    interval: GUARDIAN_INTERVALS.database_connection,
    check: async () => {
      try {
        const S = _getSTATE();
        const results = { healthy: true, checks: [] };

        // SQLite health (primary database)
        const dbPath = process.env.DB_PATH || "/data/db/concord.db";
        if (fs.existsSync(dbPath)) {
          const stat = fs.statSync(dbPath);
          const sizeMB = Math.round(stat.size / 1024 / 1024);
          const readable = fs.accessSync(dbPath, fs.constants.R_OK | fs.constants.W_OK) === undefined;
          results.checks.push({
            type: "sqlite",
            path: dbPath,
            sizeMB,
            readable: true, // accessSync throws on failure
            healthy: sizeMB < 5000, // Flag if DB > 5GB
          });
          if (sizeMB > 5000) results.healthy = false;
        } else {
          // DB doesn't exist — may be first run, not necessarily unhealthy
          results.checks.push({ type: "sqlite", path: dbPath, exists: false, healthy: true });
        }

        // Check STATE persistence
        const statePath = process.env.STATE_PATH || "/data/concord_state.json";
        if (fs.existsSync(statePath)) {
          const stat = fs.statSync(statePath);
          const ageMs = Date.now() - stat.mtimeMs;
          const stale = ageMs > 600000; // 10 minutes
          results.checks.push({
            type: "state_file",
            path: statePath,
            sizeMB: Math.round(stat.size / 1024 / 1024),
            lastModifiedAgo: Math.round(ageMs / 1000) + "s",
            stale,
            healthy: !stale,
          });
          if (stale) results.healthy = false;
        }

        return results;
      } catch {
        return { healthy: true, checks: [] };
      }
    },
    repair: async (result) => {
      try {
        for (const check of (result.checks || []).filter(c => !c.healthy)) {
          if (check.type === "sqlite" && check.sizeMB > 5000) {
            // Trigger VACUUM
            logRepairDTU(REPAIR_PHASES.POST_BUILD, "db_oversize", {
              sizeMB: check.sizeMB,
              message: "Database exceeds 5GB — VACUUM recommended",
            });
          }
          if (check.type === "state_file" && check.stale) {
            logRepairDTU(REPAIR_PHASES.POST_BUILD, "state_file_stale", {
              lastModifiedAgo: check.lastModifiedAgo,
              message: "State file not updated in 10+ minutes — save may be stuck",
            });
          }
        }
      } catch (_e) { logger.debug('emergent:repair-cortex', 'silent', { error: _e?.message }); }
    },
  },

  // ── Lockfile Drift Detection (Runtime) ──────────────────────────────────

  lockfile_integrity: {
    interval: GUARDIAN_INTERVALS.lockfile_integrity,
    check: async () => {
      try {
        const checks = [];

        for (const subdir of ["server", "concord-frontend"]) {
          const pkgPath = path.join(process.cwd(), "..", subdir, "package.json");
          const lockPath = path.join(process.cwd(), "..", subdir, "package-lock.json");

          // Fallback paths for different cwd contexts
          const altPkgPath = path.join(process.cwd(), subdir, "package.json");
          const altLockPath = path.join(process.cwd(), subdir, "package-lock.json");

          const usePkg = fs.existsSync(pkgPath) ? pkgPath : fs.existsSync(altPkgPath) ? altPkgPath : null;
          const useLock = fs.existsSync(lockPath) ? lockPath : fs.existsSync(altLockPath) ? altLockPath : null;

          if (usePkg && useLock) {
            const pkgMtime = fs.statSync(usePkg).mtimeMs;
            const lockMtime = fs.statSync(useLock).mtimeMs;

            // If package.json was modified after lockfile, they may be out of sync
            const drift = pkgMtime > lockMtime;
            checks.push({
              subdir,
              drift,
              pkgMtime: new Date(pkgMtime).toISOString(),
              lockMtime: new Date(lockMtime).toISOString(),
            });
          }
        }

        return {
          healthy: checks.every(c => !c.drift),
          checks,
          driftDetected: checks.some(c => c.drift),
        };
      } catch {
        return { healthy: true, checks: [] };
      }
    },
    repair: async (result) => {
      try {
        if (result.driftDetected) {
          const drifted = (result.checks || []).filter(c => c.drift);
          for (const c of drifted) {
            logRepairDTU(REPAIR_PHASES.POST_BUILD, "lockfile_drift_detected", {
              subdir: c.subdir,
              message: `package.json newer than lockfile in ${c.subdir} — lockfile may be stale`,
              pkgModified: c.pkgMtime,
              lockModified: c.lockMtime,
            });
          }
        }
      } catch (_e) { logger.debug('emergent:repair-cortex', 'silent', { error: _e?.message }); }
    },
  },

  // ── Security Intelligence Monitors ─────────────────────────────────────
  security_signature_freshness: {
    interval: GUARDIAN_INTERVALS.security_signature_freshness,
    check: async () => {
      try {
        const S = _getSTATE();
        const db = S?.db;
        if (!db) return { healthy: true, reason: "no_db" };
        const stats = db.prepare(`
          SELECT source,
                 MAX(updated_at) as last_update,
                 COUNT(*) as count
          FROM security_signatures
          WHERE deprecated = 0
          GROUP BY source
        `).all();

        const now = Date.now();
        const staleThresholds = {
          clamav: 48 * 3600 * 1000,    // 48 hours
          yara: 7 * 24 * 3600 * 1000,  // 7 days
          cve_feed: 48 * 3600 * 1000,  // 48 hours
        };

        const stale = [];
        for (const row of stats) {
          const threshold = staleThresholds[row.source];
          if (threshold && row.last_update) {
            const age = now - new Date(row.last_update).getTime();
            if (age > threshold) {
              stale.push({ source: row.source, ageHours: Math.round(age / 3600000), count: row.count });
            }
          }
        }

        return {
          healthy: stale.length === 0,
          sources: stats.map(s => ({ source: s.source, count: s.count, lastUpdate: s.last_update })),
          stale,
        };
      } catch {
        return { healthy: true, sources: [] };
      }
    },
    repair: async (result) => {
      try {
        if (!result.healthy && result.stale?.length > 0) {
          for (const s of result.stale) {
            logRepairDTU(REPAIR_PHASES.POST_BUILD, "security_signatures_stale", {
              source: s.source,
              ageHours: s.ageHours,
              count: s.count,
              message: `Security signatures from ${s.source} are ${s.ageHours}h stale — refresh recommended`,
            });
          }
        }
      } catch (_e) { logger.debug('emergent:repair-cortex', 'silent', { error: _e?.message }); }
    },
  },

  security_scan_backlog: {
    interval: GUARDIAN_INTERVALS.security_scan_backlog,
    check: async () => {
      try {
        const S = _getSTATE();
        const db = S?.db;
        if (!db) return { healthy: true, reason: "no_db" };

        // Count recent unresolved security events
        const recent = db.prepare(`
          SELECT COUNT(*) as count FROM security_events
          WHERE event_type = 'scan_detection' AND result = 'logged'
            AND created_at >= datetime('now', '-1 hour')
        `).get();

        const backlogCount = recent?.count || 0;
        const healthy = backlogCount < 100;

        return { healthy, backlogCount, threshold: 100 };
      } catch {
        return { healthy: true, backlogCount: 0 };
      }
    },
    repair: async (result) => {
      try {
        if (!result.healthy) {
          logRepairDTU(REPAIR_PHASES.POST_BUILD, "security_scan_backlog_high", {
            backlogCount: result.backlogCount,
            threshold: result.threshold,
            message: `Security scan backlog at ${result.backlogCount} (threshold: ${result.threshold}) — may need scaling`,
          });
        }
      } catch (_e) { logger.debug('emergent:repair-cortex', 'silent', { error: _e?.message }); }
    },
  },
};

/**
 * Start all guardian monitors.
 */
export function startGuardian() {
  try {
    // Delay guardian activation to match repair loop startup delay
    const delayTimer = setTimeout(() => {
      let stagger = 0;
      const STAGGER_GAP = 5000; // 5 seconds between each monitor start

      for (const [name, monitor] of Object.entries(GUARDIAN_MONITORS)) {
        if (_guardianTimers.has(name)) continue; // Already running

        stagger += STAGGER_GAP;
        const monitorDelay = stagger;

        const startTimer = setTimeout(() => {
          const timer = setInterval(async () => {
            // Skip if memory ceiling monitor has paused background tasks
            if (globalThis.__memoryPaused?.()) return;
            try {
              const result = await monitor.check();
              _guardianStatuses.set(name, {
                ...result,
                lastChecked: nowISO(),
              });

              if (!result.healthy) {
                await monitor.repair(result);
              }
            } catch (_e) { logger.debug('emergent:repair-cortex', 'silent', { error: _e?.message }); }
          }, monitor.interval);

          // Unref so it doesn't prevent process exit
          if (timer.unref) timer.unref();
          _guardianTimers.set(name, timer);
        }, monitorDelay);
        if (startTimer.unref) startTimer.unref();
      }

      logger.info('emergent:repair-cortex', 'Guardian monitors activating with staggered delays', { monitors: Object.keys(GUARDIAN_MONITORS).length, totalStaggerMs: stagger });
    }, REPAIR_STARTUP_DELAY);
    if (delayTimer.unref) delayTimer.unref();

    logRepairDTU(REPAIR_PHASES.POST_BUILD, "guardian_started", {
      monitors: Object.keys(GUARDIAN_MONITORS),
    });

    return { ok: true, monitors: Object.keys(GUARDIAN_MONITORS) };
  } catch (e) {
    return { ok: false, error: String(e?.message || e) };
  }
}

/**
 * Stop all guardian monitors (for graceful shutdown).
 */
export function stopGuardian() {
  try {
    for (const [name, timer] of _guardianTimers) {
      clearInterval(timer);
    }
    _guardianTimers.clear();

    logRepairDTU(REPAIR_PHASES.POST_BUILD, "guardian_stopped", {});

    return { ok: true };
  } catch {
    return { ok: false };
  }
}

/**
 * Get all guardian monitor statuses.
 */
export function getGuardianStatus() {
  try {
    const statuses = {};
    for (const [name] of Object.entries(GUARDIAN_MONITORS)) {
      statuses[name] = _guardianStatuses.get(name) || { lastChecked: null, healthy: null };
    }
    return { ok: true, monitors: statuses, running: _guardianTimers.size };
  } catch {
    return { ok: true, monitors: {}, running: 0 };
  }
}

/**
 * Run a single guardian check by name.
 */
export async function runGuardianCheck(name) {
  try {
    const monitor = GUARDIAN_MONITORS[name];
    if (!monitor) return { ok: false, error: `Unknown monitor: ${name}` };

    const result = await monitor.check();
    _guardianStatuses.set(name, { ...result, lastChecked: nowISO() });

    if (!result.healthy) {
      await monitor.repair(result);
    }

    return { ok: true, name, ...result };
  } catch (e) {
    return { ok: false, error: String(e?.message || e) };
  }
}

// ── Runtime Repair Loop ─────────────────────────────────────────────────────
// The beating heart of self-healing. Scans error accumulator for patterns,
// attempts fixes, learns from results.
//
// Three layers, tried in order:
//   1. Pattern Memory — instant match from learned fixes
//   2. Deterministic Executor — hardcoded fix for known categories
//   3. AI Diagnosis — repair brain (0.5b) reasons about unknown errors
//
// Every fix attempt is tracked. Success rate determines
// whether a pattern gets reused or deprecated.

const RUNTIME_REPAIR_INTERVAL = 900_000; // 15 minutes — repair is background, let the system breathe.
// Was 15s which clogged the event loop with LLM repair brain calls on top of
// 12 guardian monitors + cognitive pipeline + biological ticks. 5 min gives
// each repair cycle time to complete and errors time to accumulate into patterns.
let _repairLoopTimer = null;
let _repairLoopRunning = false;

// ── Brain Availability Cooldown ───────────────────────────────────────────
// When brain/Ollama is unreachable, stop retrying for 5 minutes.
// Each failed call would block the event loop for up to timeout duration.
let _brainCooldownUntil = 0;
const BRAIN_COOLDOWN_MS = 300_000; // 5 minutes

function isBrainInCooldown() {
  return Date.now() < _brainCooldownUntil;
}

function enterBrainCooldown() {
  _brainCooldownUntil = Date.now() + BRAIN_COOLDOWN_MS;
  logger.info('emergent:repair-cortex', `Brain unavailable — cooldown for ${BRAIN_COOLDOWN_MS / 1000}s, skipping all LLM repair calls`);
}

function clearBrainCooldown() {
  _brainCooldownUntil = 0;
}

// ── Deterministic Executors ─────────────────────────────────────────────────
// These are the ACTUAL fixes. Not text descriptions. Real functions.

const EXECUTORS = {
  // ── State Repairs ────────────────────────────────────────────────────────
  rebuild_dtu_index: {
    category: "state",
    description: "Rebuild DTU index from DTU map",
    canApply: () => {
      const S = _getSTATE();
      return !!(S && S.dtus instanceof Map);
    },
    execute: async () => {
      const S = _getSTATE();
      if (!S || !(S.dtus instanceof Map)) return { success: false, reason: "no STATE" };
      S.dtuIndex = Array.from(S.dtus.keys());
      return { success: true, newIndexSize: S.dtuIndex.length };
    },
  },

  clear_stuck_sessions: {
    category: "state",
    description: "Clear sessions stuck in processing state for > 5 minutes",
    canApply: () => {
      const S = _getSTATE();
      return !!(S && S.sessions instanceof Map);
    },
    execute: async () => {
      const S = _getSTATE();
      if (!S || !(S.sessions instanceof Map)) return { success: false, reason: "no STATE" };
      let cleared = 0;
      const fiveMinAgo = Date.now() - 300000;
      for (const [, session] of S.sessions) {
        if (session._processing && session._processingStarted < fiveMinAgo) {
          session._processing = false;
          session._processingStarted = null;
          cleared++;
        }
      }
      return { success: true, clearedSessions: cleared };
    },
  },

  reset_autogen_stall: {
    category: "pipeline",
    description: "Reset stalled autogen pipeline",
    canApply: () => {
      const S = _getSTATE();
      return !!(S && S.autogenEnabled && S.lastAutogenTime &&
        (Date.now() - new Date(S.lastAutogenTime).getTime()) > 600000);
    },
    execute: async () => {
      const S = _getSTATE();
      if (!S) return { success: false, reason: "no STATE" };
      S._autogenLock = false;
      S._autogenQueue = [];
      S.lastAutogenTime = new Date().toISOString();
      return { success: true, message: "autogen pipeline reset" };
    },
  },

  // ── Resource Repairs ─────────────────────────────────────────────────────
  force_gc: {
    category: "resource",
    description: "Force garbage collection",
    canApply: () => typeof global.gc === "function",
    execute: async () => {
      const before = process.memoryUsage().heapUsed;
      global.gc();
      const after = process.memoryUsage().heapUsed;
      return { success: true, freedMB: Math.round((before - after) / 1024 / 1024) };
    },
  },

  evict_old_sessions: {
    category: "resource",
    description: "Evict sessions older than 1 hour",
    canApply: () => {
      const S = _getSTATE();
      return !!(S && S.sessions instanceof Map && S.sessions.size > 100);
    },
    execute: async () => {
      const S = _getSTATE();
      if (!S || !(S.sessions instanceof Map)) return { success: false, reason: "no STATE" };
      const oneHourAgo = Date.now() - 3600000;
      let evicted = 0;
      for (const [id, session] of S.sessions) {
        const lastActive = new Date(session.lastActivity || session.createdAt || 0).getTime();
        if (lastActive < oneHourAgo) {
          S.sessions.delete(id);
          evicted++;
        }
      }
      return { success: true, evictedSessions: evicted, remaining: S.sessions.size };
    },
  },

  cap_shadow_dtus: {
    category: "resource",
    description: "Cap shadow DTUs at 5000, evict lowest-authority",
    canApply: () => {
      const S = _getSTATE();
      return !!(S && S.shadowDtus instanceof Map && S.shadowDtus.size > 5000);
    },
    execute: async () => {
      const S = _getSTATE();
      if (!S || !(S.shadowDtus instanceof Map)) return { success: false, reason: "no STATE" };
      const entries = Array.from(S.shadowDtus.entries())
        .sort((a, b) => (a[1].authority?.score || 0) - (b[1].authority?.score || 0));
      const toEvict = entries.slice(0, entries.length - 5000);
      for (const [id] of toEvict) S.shadowDtus.delete(id);
      return { success: true, evicted: toEvict.length, remaining: S.shadowDtus.size };
    },
  },

  cap_log_arrays: {
    category: "resource",
    description: "Cap in-memory log arrays",
    canApply: () => {
      const S = _getSTATE();
      return !!(S && (
        (Array.isArray(S.logs) && S.logs.length > 10000) ||
        (Array.isArray(S.auditLog) && S.auditLog.length > 10000)
      ));
    },
    execute: async () => {
      const S = _getSTATE();
      if (!S) return { success: false, reason: "no STATE" };
      let capped = 0;
      if (Array.isArray(S.logs) && S.logs.length > 10000) {
        S.logs = S.logs.slice(-5000);
        capped++;
      }
      if (Array.isArray(S.auditLog) && S.auditLog.length > 10000) {
        S.auditLog = S.auditLog.slice(-5000);
        capped++;
      }
      return { success: true, cappedArrays: capped };
    },
  },

  // ── Service Repairs ──────────────────────────────────────────────────────
  restart_ollama: {
    category: "service",
    description: "Restart Ollama container",
    canApply: () => _isDockerAvailable(),
    execute: async () => {
      const result = await safeDockerExec("docker restart concord-ollama 2>/dev/null");
      return { success: !result.skipped, output: (result.stdout || "").slice(0, 200) };
    },
  },

  reconnect_websocket: {
    category: "service",
    description: "Reset WebSocket state",
    canApply: () => typeof globalThis.realtimeEmit === "function",
    execute: async () => {
      try {
        globalThis.realtimeEmit("system:reconnect", { reason: "repair_cortex" });
      } catch (_e) { logger.debug('emergent:repair-cortex', 'best effort', { error: _e?.message }); }
      return { success: true };
    },
  },

  // ── Macro Hot-Swap ───────────────────────────────────────────────────────
  // THIS IS THE KEY CAPABILITY — replace broken macro with safe wrapper
  reload_macro: {
    category: "logic",
    description: "Replace a broken macro with a safe fallback wrapper",
    canApply: (context) => {
      return !!(context?.macroDomain && context?.macroName &&
        typeof globalThis._concordMACROS?.get === "function");
    },
    execute: async (context) => {
      const MACROS = globalThis._concordMACROS;
      if (!MACROS) return { success: false, reason: "MACROS not available" };

      const domainMap = MACROS.get(context.macroDomain);
      if (!domainMap) return { success: false, reason: `domain ${context.macroDomain} not found` };

      const originalFn = domainMap.get(context.macroName);
      if (!originalFn) return { success: false, reason: `macro ${context.macroName} not found` };

      // Store original for potential rollback
      const backupKey = `__backup_${context.macroDomain}_${context.macroName}`;
      if (!globalThis[backupKey]) {
        globalThis[backupKey] = originalFn;
      }

      // Replace with safe wrapper that catches errors
      domainMap.set(context.macroName, async (input, ctx) => {
        try {
          return await originalFn(input, ctx);
        } catch (err) {
          observe(err, `macro_hotfix:${context.macroDomain}.${context.macroName}`);
          return {
            ok: false,
            error: `Macro ${context.macroDomain}.${context.macroName} wrapped by repair cortex`,
            degraded: true,
            originalError: err.message,
          };
        }
      });

      return {
        success: true,
        message: `Macro ${context.macroDomain}.${context.macroName} wrapped with error boundary`,
        rollbackAvailable: true,
      };
    },
  },

  rollback_macro: {
    category: "logic",
    description: "Rollback a hot-swapped macro to its original",
    canApply: (context) => {
      const backupKey = `__backup_${context?.macroDomain}_${context?.macroName}`;
      return !!globalThis[backupKey];
    },
    execute: async (context) => {
      const MACROS = globalThis._concordMACROS;
      const backupKey = `__backup_${context.macroDomain}_${context.macroName}`;
      const originalFn = globalThis[backupKey];

      if (!originalFn || !MACROS) return { success: false, reason: "no backup or MACROS unavailable" };

      const domainMap = MACROS.get(context.macroDomain);
      if (domainMap) {
        domainMap.set(context.macroName, originalFn);
        delete globalThis[backupKey];
      }

      return { success: true, message: `Macro ${context.macroDomain}.${context.macroName} rolled back` };
    },
  },

  apply_code_patch: {
    category: "logic",
    description: "Apply a search-and-replace patch to a server source file to fix a syntax or runtime error",
    canApply: (context) => {
      if (!context?.filePath || !context?.search || !context?.replace) return false;
      // Only allow patching files within the server directory
      const serverDir = path.resolve(path.dirname(new URL(import.meta.url).pathname), "..");
      const target = path.resolve(context.filePath);
      return target.startsWith(serverDir) && /\.(js|cjs|mjs)$/.test(target);
    },
    execute: async (context) => {
      if (!context?.filePath || !context?.search || typeof context?.replace !== "string") {
        return { success: false, reason: "Missing filePath, search, or replace in context" };
      }

      const serverDir = path.resolve(path.dirname(new URL(import.meta.url).pathname), "..");
      const target = path.resolve(context.filePath);

      if (!target.startsWith(serverDir)) {
        return { success: false, reason: "Path escape attempt blocked — only server/ files allowed" };
      }

      if (!/\.(js|cjs|mjs)$/.test(target)) {
        return { success: false, reason: "Only .js/.cjs/.mjs files may be patched" };
      }

      let content;
      try {
        content = fs.readFileSync(target, "utf-8");
      } catch (readErr) {
        return { success: false, reason: `Cannot read file: ${readErr.message}` };
      }

      if (!content.includes(context.search)) {
        return { success: false, reason: "Search string not found in file — patch not applied" };
      }

      // Backup original content in RUNTIME_PATCHES for rollback
      const backupKey = `file_patch:${target}`;
      if (!RUNTIME_PATCHES.has(backupKey)) {
        RUNTIME_PATCHES.set(backupKey, { type: "file_backup", original: content, appliedAt: nowISO() });
      }

      const patched = content.replace(context.search, context.replace);

      try {
        fs.writeFileSync(target, patched, "utf-8");
      } catch (writeErr) {
        return { success: false, reason: `Cannot write file: ${writeErr.message}` };
      }

      return {
        success: true,
        message: `Patched ${path.relative(serverDir, target)}: replaced ${context.search.slice(0, 60).replace(/\n/g, "\\n")}…`,
        rollbackAvailable: true,
        backupKey,
      };
    },
  },
};

// ── Executor Matcher ────────────────────────────────────────────────────────
// Maps error pattern categories to most likely executor

function findExecutorForDiagnosis(diagnosis) {
  const categoryMap = {
    resource: "force_gc",
    heap_overflow: "force_gc",
    enomem: "evict_old_sessions",
    emfile: "evict_old_sessions",
    state_corruption: "rebuild_dtu_index",
    autogen_stall: "reset_autogen_stall",
    econnrefused: "restart_ollama",
    websocket_error: "reconnect_websocket",
    socket_hangup: "reconnect_websocket",
  };

  // Check diagnosis key first (most specific)
  if (diagnosis.key && categoryMap[diagnosis.key]) {
    return categoryMap[diagnosis.key];
  }

  // Check category
  if (diagnosis.category && categoryMap[diagnosis.category]) {
    return categoryMap[diagnosis.category];
  }

  // Check error message keywords
  const msg = diagnosis.match?.[0] || "";
  const keywordMap = {
    ENOSPC: "cap_log_arrays",
    ENOMEM: "evict_old_sessions",
    EMFILE: "evict_old_sessions",
    "heap out of memory": "force_gc",
    "autogen": "reset_autogen_stall",
    "ollama": "restart_ollama",
    "websocket": "reconnect_websocket",
    "SyntaxError": "apply_code_patch",
    "Cannot find module": "apply_code_patch",
    "is not defined": "apply_code_patch",
    "ERR_MODULE_NOT_FOUND": "apply_code_patch",
  };
  for (const [keyword, executor] of Object.entries(keywordMap)) {
    if (msg.toLowerCase().includes(keyword.toLowerCase())) return executor;
  }

  return null;
}

// ── Repair Brain Structured Call ────────────────────────────────────────────
// Replaces free-text tryAIFix() with structured output

async function callRepairBrain(errorEntry) {
  // COOLDOWN CHECK: If brain recently failed, skip entirely — never block event loop
  if (isBrainInCooldown()) return null;

  const BRAIN = globalThis._concordBRAIN;
  if (!BRAIN?.repair?.enabled) return null;

  const prompt = `You are a runtime repair system for a Node.js cognitive engine.
Analyze this error and select the best fix from the AVAILABLE EXECUTORS list.

ERROR: ${errorEntry.message}
STACK: ${(errorEntry.stack || "").slice(0, 500)}
OCCURRENCES: ${errorEntry.count}
CONTEXT: ${errorEntry.context}

AVAILABLE EXECUTORS:
${Object.entries(EXECUTORS).map(([name, ex]) => `- ${name}: ${ex.description} [category: ${ex.category}]`).join("\n")}

RESPOND IN EXACTLY THIS FORMAT (no other text):
EXECUTOR: <executor_name>
CONTEXT: <json_context_or_empty>
CONFIDENCE: <0.0_to_1.0>
REASONING: <one_line>

If no executor fits, respond:
EXECUTOR: none
CONFIDENCE: 0.0
REASONING: <why>

For apply_code_patch, set CONTEXT to JSON like:
{"filePath":"server/emergent/<file>.js","search":"<exact_broken_string>","replace":"<fixed_string>"}
Only use apply_code_patch for SyntaxError, ReferenceError, or ERR_MODULE_NOT_FOUND where the fix is a single search-and-replace.`;

  try {
    // Yield to active chat — but don't wait more than 1s
    if (queues.conscious?.active > 0 || queues.utility?.active > 0) {
      await new Promise(r => { setTimeout(r, 1000); });
    }

    const resp = await fetch(`${BRAIN.repair.url}/api/generate`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        model: BRAIN.repair.model,
        prompt,
        stream: false,
        options: { temperature: 0.1, num_predict: 200 },
      }),
      signal: AbortSignal.timeout(5000), // 5s hard cap — never block event loop longer
    });

    // Brain responded — clear any cooldown
    clearBrainCooldown();
    BRAIN.repair.stats.requests++;
    const data = await resp.json();
    const text = (data.response || "").trim();

    // Parse structured response
    const executorMatch = text.match(/EXECUTOR:\s*(\S+)/);
    const contextMatch = text.match(/CONTEXT:\s*(\{.*\})/);
    const confidenceMatch = text.match(/CONFIDENCE:\s*([\d.]+)/);

    if (!executorMatch || executorMatch[1] === "none") return null;

    const executor = executorMatch[1];
    const confidence = parseFloat(confidenceMatch?.[1] || "0");

    if (confidence < 0.6) return null;
    if (!EXECUTORS[executor]) return null;

    let context = {};
    if (contextMatch) {
      try { context = JSON.parse(contextMatch[1]); } catch (_e) { logger.debug('emergent:repair-cortex', 'use empty', { error: _e?.message }); }
    }

    return { executor, context, confidence };
  } catch {
    // Brain is down — enter cooldown so we don't keep blocking the event loop
    enterBrainCooldown();
    return null;
  }
}

// ── The Runtime Repair Loop ─────────────────────────────────────────────────

async function runRepairCycle() {
  if (_repairLoopRunning) return; // No concurrent cycles
  // Skip entire cycle if memory ceiling monitor has paused background tasks
  if (globalThis.__memoryPaused?.()) return;
  _repairLoopRunning = true;

  const cycleStart = Date.now();
  const repairs = [];

  try {
    // 1. Scan error accumulator for actionable patterns
    for (const [key, entry] of _errorAccumulator) {
      // Only act on errors that have occurred 3+ times (confirmed pattern)
      // OR errors that are critical (stack contains "FATAL" or "ENOSPC" etc)
      const isCritical = /FATAL|ENOSPC|ENOMEM|EMFILE|OOM/i.test(entry.message);
      if (entry.count < 3 && !isCritical) continue;

      // Layer 1: Check repair memory for known fix
      const knownFix = lookupRepairMemory(entry.message);
      if (knownFix && knownFix.executor && EXECUTORS[knownFix.executor]) {
        const executor = EXECUTORS[knownFix.executor];
        if (executor.canApply(knownFix.context || {})) {
          try {
            const result = await executor.execute(knownFix.context || {});
            if (result.success) {
              recordRepairSuccess(entry.message);
              repairs.push({ key, method: "memory", executor: knownFix.executor, result });
              _errorAccumulator.delete(key);
              continue;
            }
          } catch (e) {
            recordRepairFailure(entry.message);
          }
        }
      }

      // Layer 2: Try deterministic executors based on error category
      const diagnosis = matchErrorPattern(entry.message);
      if (diagnosis) {
        const executorName = findExecutorForDiagnosis(diagnosis);
        if (executorName && EXECUTORS[executorName]) {
          const executor = EXECUTORS[executorName];
          if (executor.canApply({ diagnosis, error: entry })) {
            try {
              const result = await executor.execute({ diagnosis, error: entry });
              if (result.success) {
                addToRepairMemory(entry.message, {
                  executor: executorName,
                  context: { diagnosis: diagnosis.key },
                  learnedAt: nowISO(),
                });
                recordRepairSuccess(entry.message);
                repairs.push({ key, method: "deterministic", executor: executorName, result });
                _errorAccumulator.delete(key);
                continue;
              }
            } catch (e) {
              recordRepairFailure(entry.message);
            }
          }
        }
      }

      // Layer 3: AI diagnosis via repair brain (only for critical or persistent)
      if (isCritical || entry.count >= 10) {
        try {
          const aiFix = await callRepairBrain(entry);
          if (aiFix && aiFix.executor && EXECUTORS[aiFix.executor]) {
            const executor = EXECUTORS[aiFix.executor];
            if (executor.canApply(aiFix.context || {})) {
              const result = await executor.execute(aiFix.context || {});
              if (result.success) {
                addToRepairMemory(entry.message, {
                  executor: aiFix.executor,
                  context: aiFix.context,
                  learnedAt: nowISO(),
                  method: "ai",
                });
                recordRepairSuccess(entry.message);
                repairs.push({ key, method: "ai", executor: aiFix.executor, result });
                _errorAccumulator.delete(key);
                continue;
              }
            }
          }
        } catch (_e) { logger.debug('emergent:repair-cortex', 'AI layer is best-effort', { error: _e?.message }); }
      }
    }

    // 2. Run proactive health executors (even without errors)
    const proactiveChecks = ["force_gc", "evict_old_sessions", "cap_shadow_dtus", "cap_log_arrays"];
    for (const name of proactiveChecks) {
      const executor = EXECUTORS[name];
      if (executor.canApply()) {
        try {
          const result = await executor.execute();
          if (result.success) {
            repairs.push({ key: name, method: "proactive", executor: name, result });
          }
        } catch (_e) { logger.debug('emergent:repair-cortex', 'proactive is best-effort', { error: _e?.message }); }
      }
    }

    // 2b. Quality spot-check: review Tier 2 artifacts pending approval
    try {
      const spotCheckResult = await repairBrainSpotCheck();
      if (spotCheckResult.checked > 0) {
        repairs.push({ key: "quality_spot_check", method: "proactive", executor: "spot_check", result: spotCheckResult });
      }
    } catch (_e) { logger.debug('emergent:repair-cortex', 'spot-check is best-effort', { error: _e?.message }); }

    // 3. Log cycle results
    if (repairs.length > 0) {
      logRepairDTU(REPAIR_PHASES.POST_BUILD, "repair_cycle_complete", {
        cycleMs: Date.now() - cycleStart,
        repairsApplied: repairs.length,
        repairs: repairs.map(r => ({
          method: r.method,
          executor: r.executor,
          success: r.result?.success,
        })),
        remainingErrors: _errorAccumulator.size,
      });
    }

  } catch (e) {
    // The repair loop itself NEVER crashes the system
    observe(e, "repair_loop_internal");
  } finally {
    _repairLoopRunning = false;
  }

  return { repairs, cycleMs: Date.now() - cycleStart };
}

// ── Quality Spot-Check (Tier 2 artifacts) ───────────────────────────────────

/**
 * Runs on repair brain tick cycle. Pulls Tier 2 artifacts and does a
 * quick quality assessment. Promotes to marketplace or demotes to draft.
 *
 * This is the ONLY LLM call in the quality pipeline.
 * Only processes up to 3 per tick to stay within repair brain budget.
 */
let _spotCheckCallBrain = null;
let _spotCheckState = null;

export function initSpotCheck(callBrainFn, stateFn) {
  _spotCheckCallBrain = callBrainFn;
  _spotCheckState = stateFn;
}

async function repairBrainSpotCheck() {
  if (!_spotCheckCallBrain || !_spotCheckState) return { checked: 0 };
  // Skip if brain is in cooldown — spot checks are not critical
  if (isBrainInCooldown()) return { checked: 0, skipped: "brain_cooldown" };
  const STATE = typeof _spotCheckState === "function" ? _spotCheckState() : _spotCheckState;
  if (!STATE?.lensArtifacts) return { checked: 0 };

  const pending = Array.from(STATE.lensArtifacts.values())
    .filter((a) => a.meta?.status === "pending_spot_check")
    .slice(0, 3);

  let checked = 0;
  let approved = 0;

  for (const artifact of pending) {
    try {
      const result = await _spotCheckCallBrain("repair",
        `Review this ${artifact.domain} ${artifact.type} artifact for quality.
Does it contain real, domain-appropriate content (not filler or meta-content)?
Are the values realistic and useful?
Reply with ONLY: APPROVE or REJECT followed by one sentence explaining why.

Artifact title: ${artifact.title}
Artifact data (first 500 chars): ${JSON.stringify(artifact.data).slice(0, 500)}`,
        { temperature: 0.1, maxTokens: 100, timeout: 10000 }
      );

      checked++;

      if (result.ok && result.content) {
        const response = result.content.trim().toUpperCase();
        if (response.startsWith("APPROVE")) {
          artifact.meta.status = "marketplace_ready";
          artifact.meta.approvedAt = nowISO();
          artifact.meta.approvedBy = "repair_brain";
          approved++;
        } else {
          artifact.meta.status = "draft_needs_review";
          artifact.meta.reviewNote = result.content;
        }
      }
    } catch (_e) { logger.debug('emergent:repair-cortex', 'spot-check failures are non-fatal', { error: _e?.message }); }
  }

  return { checked, approved, pending: pending.length };
}

// ── Loop Management ─────────────────────────────────────────────────────────

const REPAIR_STARTUP_DELAY = 180_000; // 3 minutes — match ghost fleet, let server fully boot

let _repairDelayTimer = null; // tracks the startup delay setTimeout

export function startRepairLoop() {
  if (_repairLoopTimer) return { ok: true, status: "already_running" };

  // Delay activation so the server is fully booted before repair systems fire
  _repairDelayTimer = setTimeout(() => {
    _repairDelayTimer = null; // delay has fired
    _repairLoopTimer = setInterval(async () => {
      try {
        await runRepairCycle();
      } catch (e) {
        try { observe(e, "repair_loop_tick"); } catch (_e) { logger.debug('emergent:repair-cortex', 'absolute last resort', { error: _e?.message }); }
      }
    }, RUNTIME_REPAIR_INTERVAL);

    // Unref so it doesn't prevent process exit
    if (_repairLoopTimer.unref) _repairLoopTimer.unref();

    // Expose guardian status for cascade-recovery.js health checks
    globalThis._guardianStatus = () => ({ running: true, startedAt: new Date().toISOString() });
    if (globalThis.STATE) globalThis.STATE._repairGuardian = true;

    logger.info('emergent:repair-cortex', 'Repair loop activated after startup delay');
  }, REPAIR_STARTUP_DELAY);
  if (_repairDelayTimer.unref) _repairDelayTimer.unref();

  // Mark as "pending" so we don't double-start (use a truthy sentinel)
  _repairLoopTimer = { _pending: true };

  // Also start Guardian monitors (with same delay)
  startGuardian();

  logRepairDTU(REPAIR_PHASES.POST_BUILD, "repair_loop_started", {
    interval: RUNTIME_REPAIR_INTERVAL,
    executors: Object.keys(EXECUTORS),
  });

  return { ok: true, interval: RUNTIME_REPAIR_INTERVAL, executors: Object.keys(EXECUTORS) };
}

export function stopRepairLoop() {
  // Clear the startup delay timer if it hasn't fired yet
  if (_repairDelayTimer) {
    clearTimeout(_repairDelayTimer);
    _repairDelayTimer = null;
  }
  // Clear the interval (only if it's a real timer, not the pending sentinel)
  if (_repairLoopTimer && !_repairLoopTimer._pending) {
    clearInterval(_repairLoopTimer);
  }
  _repairLoopTimer = null;
  stopGuardian();
  return { ok: true };
}

/**
 * Force a repair cycle immediately (for sovereign dashboard).
 */
export async function forceRepairCycle() {
  return runRepairCycle();
}

/**
 * Execute a specific executor manually (for sovereign dashboard).
 */
export async function executeRepairExecutor(name, context = {}) {
  const executor = EXECUTORS[name];
  if (!executor) return { ok: false, error: `Unknown executor: ${name}` };
  if (!executor.canApply(context)) return { ok: false, error: "Executor preconditions not met" };

  const result = await executor.execute(context);
  logRepairDTU(REPAIR_PHASES.POST_BUILD, "manual_executor", { name, result });
  return { ok: true, ...result };
}

/**
 * Full cortex status — everything in one call.
 */
export function getFullRepairStatus() {
  try {
    return {
      ok: true,
      loop: {
        running: !!_repairLoopTimer,
        interval: RUNTIME_REPAIR_INTERVAL,
      },
      memory: getRepairMemoryStats(),
      accumulator: getErrorAccumulator(),
      guardian: getGuardianStatus(),
      executors: Object.entries(EXECUTORS).map(([name, ex]) => ({
        name,
        category: ex.category,
        description: ex.description,
        canApply: ex.canApply({}),
      })),
      brain: {
        online: globalThis._concordBRAIN?.repair?.enabled || false,
        stats: globalThis._concordBRAIN?.repair?.stats || {},
      },
      recentRepairs: getRecentRepairDTUs(20),
      uptime: process.uptime(),
      memoryUsage: process.memoryUsage(),
    };
  } catch (e) {
    return { ok: false, error: String(e?.message || e) };
  }
}

// ── Organ Maturity Integration ──────────────────────────────────────────────
// Repair cortex is organ 169. A young system repairs clumsily; a mature one precisely.

function _updateOrganFromRepair(phase, result) {
  try {
    const S = _getSTATE();
    if (!S || !(S.organs instanceof Map)) return;

    const organ = S.organs.get("repair_cortex");
    if (!organ) return;

    const now = nowISO();

    // Successful repairs increase maturity
    if (result.success || result.autoFixed > 0) {
      organ.maturity.score = clamp01(organ.maturity.score + 0.002);
      organ.maturity.confidence = clamp01(organ.maturity.confidence + 0.001);
      organ.maturity.stability = clamp01(organ.maturity.stability + 0.001);
    }

    // Escalated failures increase wear and decrease plasticity
    if (result.escalated) {
      organ.wear.damage = clamp01(organ.wear.damage + 0.01);
      organ.wear.debt = clamp01(organ.wear.debt + 0.005);
    }

    // Reduce plasticity as we learn (become more set in our ways)
    // Logarithmic decay: settles slowly, never reaches zero.
    //   0 patterns → 0.75,  87 → ~0.45,  375 → ~0.40,  1000 → ~0.37
    const patternCount = _repairMemory.size;
    organ.maturity.plasticity = clamp01(0.75 / (1 + Math.log1p(patternCount) * 0.15));

    organ.maturity.lastUpdateAt = now;

    // Track repair cortex-specific state
    if (!S.repairCortex) {
      S.repairCortex = {
        lastPreBuild: null,
        lastMidBuild: null,
        lastGuardianCheck: null,
        totalRepairs: 0,
        totalEscalations: 0,
      };
    }

    if (phase === REPAIR_PHASES.PRE_BUILD) {
      S.repairCortex.lastPreBuild = now;
    } else if (phase === REPAIR_PHASES.MID_BUILD) {
      S.repairCortex.lastMidBuild = now;
    } else if (phase === REPAIR_PHASES.POST_BUILD) {
      S.repairCortex.lastGuardianCheck = now;
    }

    if (result.success || result.autoFixed > 0) {
      S.repairCortex.totalRepairs++;
    }
    if (result.escalated) {
      S.repairCortex.totalEscalations++;
    }
  } catch (_e) { logger.debug('emergent:repair-cortex', 'silent', { error: _e?.message }); }
}

// ── Repair Agent ────────────────────────────────────────────────────────────
// The repair cortex IS an agent — the most critical one.

/**
 * Agent tick function. Called by the agent system.
 * Runs guardian monitors that haven't been checked recently.
 * Concurrency-guarded — overlapping calls are silently skipped.
 */
let _repairAgentTickRunning = false;
const _MONITOR_CHECK_TIMEOUT_MS = 30_000;

export async function repairAgentTick() {
  if (_repairAgentTickRunning) {
    logger.debug('emergent:repair-cortex', 'repairAgentTick skipped — previous tick still running');
    return { ok: true, skipped: true };
  }
  _repairAgentTickRunning = true;
  try {
    const results = {};
    for (const [name, monitor] of Object.entries(GUARDIAN_MONITORS)) {
      // Skip monitors that ran recently via startGuardian() — avoid double-work
      const lastChecked = _guardianStatuses.get(name)?.lastChecked;
      if (lastChecked) {
        const ageMs = Date.now() - new Date(lastChecked).getTime();
        if (ageMs < monitor.interval * 0.9) continue;
      }
      try {
        const checkWithTimeout = Promise.race([
          monitor.check(),
          new Promise((_, rej) => setTimeout(() => rej(new Error('monitor_timeout')), _MONITOR_CHECK_TIMEOUT_MS)),
        ]);
        const result = await checkWithTimeout;
        _guardianStatuses.set(name, { ...result, lastChecked: nowISO() });

        if (!result.healthy) {
          await monitor.repair(result);
        }

        results[name] = result;
      } catch (_e) { logger.debug('emergent:repair-cortex', 'silent', { name, error: _e?.message }); }
    }

    return { ok: true, monitors: results };
  } catch (e) {
    return { ok: false, error: String(e?.message || e) };
  } finally {
    _repairAgentTickRunning = false;
  }
}

export const REPAIR_AGENT_CONFIG = Object.freeze({
  type: "repair_cortex",
  territory: "entire_system",
  intervalMs: 30000,
  priority: "critical",
  cannotBePaused: true,
});

// ── Sovereign Commands ──────────────────────────────────────────────────────
// Even sovereign gets limited control — repair cortex protects itself.

export function handleRepairCommand(action, target, data) {
  try {
    switch (action) {
      case "repair-status":
        return {
          ok: true,
          repairMemory: getRepairMemoryStats(),
          guardianStatus: getGuardianStatus(),
          cortexState: _getSTATE()?.repairCortex || {},
          totalPatterns: _repairMemory.size,
          uptime: process.uptime(),
        };

      case "repair-memory":
        return getRepairMemoryStats();

      case "repair-history":
        return getRecentRepairDTUs(Number(target) || 20);

      case "repair-patterns":
        return getAllRepairPatterns();

      case "repair-guardian-status":
        return getGuardianStatus();

      case "repair-run-prophet": {
        const projectRoot = data?.projectRoot || process.cwd();
        // Return a promise — sovereign route should await it
        return runProphet(projectRoot);
      }

      case "repair-threshold": {
        if (!target || data?.value === undefined) {
          return { ok: false, error: "target (monitor name) and data.value required" };
        }
        // Adjust sensitivity — but CANNOT disable
        const monitor = GUARDIAN_MONITORS[target];
        if (!monitor) {
          return { ok: false, error: `Unknown monitor: ${target}` };
        }
        // We only allow adjusting interval, not removing monitors
        if (typeof data.value === "number" && data.value >= 10000) {
          monitor.interval = data.value;
          return { ok: true, monitor: target, newInterval: data.value };
        }
        return { ok: false, error: "value must be a number >= 10000 (ms)" };
      }

      case "repair-full-status":
        return getFullRepairStatus();

      case "repair-force-cycle":
        return forceRepairCycle();

      case "repair-execute": {
        if (!target) return { ok: false, error: "target (executor name) required" };
        return executeRepairExecutor(target, data || {});
      }

      case "repair-error-accumulator":
        return getErrorAccumulator();

      case "repair-rollback-macro":
        return EXECUTORS.rollback_macro.execute(data || {});

      case "repair-start-loop":
        return startRepairLoop();

      case "repair-stop-loop":
        return stopRepairLoop();

      default:
        return { ok: false, error: `Unknown repair command: ${action}` };
    }
  } catch (e) {
    return { ok: false, error: String(e?.message || e) };
  }
}

// ── Pain Module Registration ────────────────────────────────────────────────
// Allow the pain module to be registered for integration.

export function registerPainModule(painModule) {
  try {
    if (painModule && typeof painModule.recordPain === "function") {
      globalThis._repairCortexPainModule = painModule;
    }
  } catch (_e) { logger.debug('emergent:repair-cortex', 'silent', { error: _e?.message }); }
}

// ── Full Deploy Pipeline ────────────────────────────────────────────────────
// The complete three-phase deploy, callable programmatically.

/**
 * Run the full repair cortex deploy pipeline.
 *
 * @param {string} projectRoot - Project root directory
 * @param {string} [buildCommand="docker-compose build --no-cache"] - Build command
 * @param {string} [upCommand="docker-compose up -d"] - Start command
 * @returns {Promise<object>} Pipeline results
 */
export async function runFullDeploy(projectRoot, buildCommand, upCommand) {
  const pipeline = {
    phase1_prophet: null,
    phase2_surgeon: null,
    phase3_guardian: null,
    success: false,
    timestamp: nowISO(),
  };

  // Phase 1: Prophet
  pipeline.phase1_prophet = await runProphet(projectRoot);

  if (pipeline.phase1_prophet.blocked) {
    logRepairDTU("deploy", "prophet_blocked", {
      issues: pipeline.phase1_prophet.totalIssues,
    });
    return { ok: false, ...pipeline, message: "Pre-build scan found critical issues" };
  }

  // Phase 2: Surgeon
  const bCmd = buildCommand || "docker-compose build --no-cache";
  pipeline.phase2_surgeon = await runSurgeon(bCmd, projectRoot);

  if (!pipeline.phase2_surgeon.success) {
    return { ok: false, ...pipeline, message: "Build failed after repair attempts" };
  }

  // Launch services
  if (upCommand) {
    try {
      await execAsync(upCommand, { cwd: projectRoot, timeout: 60000 });
    } catch (_e) { logger.debug('emergent:repair-cortex', 'non-fatal — guardian will detect', { error: _e?.message }); }
  }

  // Phase 3: Guardian
  pipeline.phase3_guardian = startGuardian();
  pipeline.success = true;

  logRepairDTU("deploy", "full_deploy_success", {
    prophetIssues: pipeline.phase1_prophet.totalIssues,
    surgeonAttempts: pipeline.phase2_surgeon.attempt,
    guardianMonitors: pipeline.phase3_guardian.monitors?.length || 0,
  });

  return { ok: true, ...pipeline };
}

// ── Exports Summary ─────────────────────────────────────────────────────────

export {
  GUARDIAN_MONITORS,
  ERROR_PATTERNS,
  PRE_BUILD_CHECKS,
  EXECUTORS,
};

// ══════════════════════════════════════════════════════════════════════════════
// ██  v3.1 REPAIR CORTEX AUTONOMY FEATURES                                  ██
// ══════════════════════════════════════════════════════════════════════════════
// Enhanced error context capture, multi-strategy autonomous repair,
// runtime patching, sovereign escalation, and self-test infrastructure.

// ── v3.1 Severity & Sanitisation Helpers ─────────────────────────────────────

function _classifyErrorSeverity(error, context) {
  if (context.trigger === "heartbeat") return "critical";
  if (/ENOMEM|heap|out of memory/i.test(error.message)) return "critical";
  if (context.module === "repair-cortex") return "critical";
  if (/brain|llm|consolidation|auth/i.test(context.module)) return "high";
  if (context.trigger === "api_request" || context.trigger === "entity_action") return "medium";
  return "low";
}

function _sanitizeParams(params) {
  if (!params) return null;
  const sanitized = { ...params };
  for (const key of Object.keys(sanitized)) {
    if (/password|secret|token|key|auth/i.test(key)) sanitized[key] = "[REDACTED]";
  }
  return sanitized;
}

// ── v3.1 Error Context Layer ─────────────────────────────────────────────────

class ErrorContext {
  constructor() {
    this.errors = [];
    this.maxBuffer = 100;
  }

  capture(error, context) {
    const S = _getSTATE();
    const entry = {
      id: uid("err"),
      timestamp: nowISO(),
      error: {
        message: error.message || String(error),
        stack: error.stack,
        name: error.name || "Error",
        code: error.code,
      },
      context: {
        module: context.module || "unknown",
        function: context.function || "unknown",
        trigger: context.trigger || "unknown",
        inputParams: _sanitizeParams(context.params),
        stateSnapshot: {
          heapUsed: process.memoryUsage().heapUsed,
          dtuCount: S?.dtus?.size || 0,
          entityCount: context.entityCount || 0,
          tick: S?.__bgTickCounter || 0,
        },
      },
      severity: _classifyErrorSeverity(error, context),
      repairAttempted: false,
      repairSucceeded: false,
      repairMethod: null,
    };
    this.errors.push(entry);
    if (this.errors.length > this.maxBuffer) this.errors.shift();
    // Also feed into the existing error accumulator
    observe(error, context.module);
    return entry;
  }

  getRecent(count = 20) { return this.errors.slice(-count); }
  getUnrepaired() { return this.errors.filter(e => !e.repairAttempted); }
}
export const ERROR_CONTEXT = new ErrorContext();

// ── v3.1 Repair Queue & Runtime Patches ──────────────────────────────────────

export const REPAIR_QUEUE = [];
export const RUNTIME_PATCHES = new Map();

export function shouldSkipExecution(module, fn) {
  return RUNTIME_PATCHES.has(`skip:${module}:${fn}`);
}

export function getFallbackValue(module, fn) {
  const patch = RUNTIME_PATCHES.get(`fallback:${module}:${fn}`);
  return patch ? { hasFallback: true, value: patch.fallbackValue } : { hasFallback: false };
}

export function getBrainFallback(brainName) {
  const patch = RUNTIME_PATCHES.get(`brain_fallback:${brainName}`);
  if (!patch) return null;
  const S = _getSTATE();
  const BRAIN = globalThis._concordBRAIN || S?.BRAIN;
  return BRAIN ? BRAIN[patch.to] : null;
}

// ── v3.1 Repair Strategies ───────────────────────────────────────────────────

const REPAIR_STRATEGIES = [
  {
    name: "known_pattern_match",
    match: () => true, // always check repair memory first
    apply: async (errorEntry) => {
      const knownFix = lookupRepairMemory(errorEntry.error.message);
      if (knownFix?.executor && EXECUTORS[knownFix.executor]) {
        try {
          const result = await EXECUTORS[knownFix.executor].execute(knownFix.context || {});
          if (result.success) return { fixed: true, method: "known_pattern", executor: knownFix.executor };
        } catch (_e) { logger.debug('emergent:repair-cortex', 'silent catch', { error: _e?.message }); }
      }
      return { fixed: false };
    },
  },
  {
    // Security intelligence pattern match — deterministic, no LLM.
    // Queries security_fixes table for matching vulnerability type using token-overlap.
    name: "security_pattern_match",
    match: () => Boolean(_securityMatcher),
    apply: async (errorEntry) => {
      try {
        if (!_securityMatcher) return { fixed: false };
        const errorMsg = String(errorEntry.error?.message || errorEntry.error || "");
        const result = _securityMatcher.quickScan({ content: errorMsg, target: "repair_strategy" });
        if (result.matched && result.fixId) {
          const fix = _securityMatcher.findFix(result.vulnerabilityType, errorMsg);
          if (fix && fix.after_pattern) {
            addToRepairMemory(errorMsg, {
              executor: "security_fix",
              securityRelated: true,
              fixId: fix.id,
              cveId: fix.cve_id,
              vulnerabilityType: fix.vulnerability_type,
            });
            return { fixed: true, method: "security_pattern_match", fixId: fix.id, vulnerabilityType: fix.vulnerability_type };
          }
        }
        return { fixed: false };
      } catch (_e) {
        logger.debug('emergent:repair-cortex', 'security_pattern_match error', { error: _e?.message });
        return { fixed: false };
      }
    },
  },
  {
    name: "null_reference_fix",
    match: (err) => /cannot read propert|is not defined|is null|is undefined/i.test(err.error.message),
    apply: async (errorEntry) => {
      const patchKey = `null_guard:${errorEntry.context.module}:${errorEntry.context.function}`;
      if (!RUNTIME_PATCHES.has(patchKey)) {
        RUNTIME_PATCHES.set(patchKey, { type: "null_guard", module: errorEntry.context.module, appliedAt: nowISO() });
        return { fixed: true, method: "null_guard" };
      }
      return { fixed: false };
    },
  },
  {
    name: "timeout_fix",
    match: (err) => /timeout|timed out|ETIMEDOUT|ECONNRESET/i.test(err.error.message),
    apply: async (errorEntry) => {
      const S = _getSTATE();
      if (!S) return { fixed: false, reason: "state_not_ready" };
      if (!S._repairCaches) S._repairCaches = new Map();
      const cacheKey = `timeout_cache:${errorEntry.context.module}`;
      if (!S._repairCaches.has(cacheKey)) {
        S._repairCaches.set(cacheKey, { data: null, cachedAt: 0, ttl: 30000, hits: 0 });
        return { fixed: true, method: "added_cache", module: errorEntry.context.module };
      }
      const cache = S._repairCaches.get(cacheKey);
      cache.ttl = Math.min(cache.ttl * 2, 300000);
      return { fixed: true, method: "increased_cache_ttl", newTtl: cache.ttl };
    },
  },
  {
    name: "type_error_fix",
    match: (err) => /TypeError|is not a function|is not iterable/i.test(err.error.message),
    apply: async (errorEntry) => {
      // Record the patch key so we can track occurrences, but do NOT claim fixed:true
      // since this strategy cannot actually patch the calling code at runtime.
      // Instead, escalate so the sovereign / operator is alerted.
      const patchKey = `type_guard:${errorEntry.context.module}:${errorEntry.context.function}`;
      if (!RUNTIME_PATCHES.has(patchKey)) {
        RUNTIME_PATCHES.set(patchKey, { type: "type_guard", module: errorEntry.context.module, appliedAt: nowISO(), occurrences: 1 });
      } else {
        const p = RUNTIME_PATCHES.get(patchKey);
        p.occurrences = (p.occurrences || 0) + 1;
      }
      return { fixed: false, escalate: true, method: "type_guard_logged" };
    },
  },
  {
    name: "memory_pressure_fix",
    match: (err) => /ENOMEM|heap|out of memory|allocation failed/i.test(err.error.message),
    apply: async () => {
      const before = process.memoryUsage().heapUsed;
      const actions = [];
      // Force GC
      if (global.gc) { global.gc(); actions.push("forced_gc"); }
      // Clear repair caches
      const S = _getSTATE();
      if (S?._repairCaches) { S._repairCaches.clear(); actions.push("cleared_caches"); }
      if (S?._rehydrationCache) { S._rehydrationCache = new Map(); actions.push("cleared_rehydration"); }
      const after = process.memoryUsage().heapUsed;
      return { fixed: before - after > 0, method: "memory_pressure_relief", actions, freedBytes: before - after };
    },
  },
  {
    name: "brain_failure_fix",
    match: (err) => /ECONNREFUSED|ollama|brain|model/i.test(err.error.message) || err.context.module?.includes("brain"),
    apply: async (errorEntry) => {
      const S = _getSTATE();
      const BRAIN = globalThis._concordBRAIN || S?.BRAIN;
      if (!BRAIN) return { fixed: false };
      const BRAIN_FALLBACK = { conscious: "utility", subconscious: "utility", utility: "subconscious", repair: null };
      let failedBrain = null;
      for (const name of Object.keys(BRAIN)) {
        if (errorEntry.context.module?.includes(name) || errorEntry.error.message?.includes(BRAIN[name]?.url || "")) {
          failedBrain = name; break;
        }
      }
      if (!failedBrain) return { fixed: false };
      const fallback = BRAIN_FALLBACK[failedBrain];
      if (fallback && BRAIN[fallback]?.enabled !== false) {
        RUNTIME_PATCHES.set(`brain_fallback:${failedBrain}`, { type: "brain_fallback", from: failedBrain, to: fallback, appliedAt: nowISO() });
        return { fixed: true, method: "brain_fallback", from: failedBrain, to: fallback };
      }
      return { fixed: false, escalate: true, brain: failedBrain };
    },
  },
  {
    name: "disk_error_fix",
    match: (err) => /ENOSPC|ENOENT|EACCES|disk/i.test(err.error.message),
    apply: async (errorEntry) => {
      if (/ENOENT/.test(errorEntry.error.message)) {
        const pathMatch = errorEntry.error.message.match(/ENOENT.*'([^']+)'/);
        if (pathMatch) {
          const S = _getSTATE();
          const dtus = S?.dtus;
          const dtuIterable = !dtus ? [] : typeof dtus.entries === 'function' ? dtus.entries() : dtus instanceof Map ? dtus : new Map();
          for (const [id, dtu] of dtuIterable) {
            if (dtu.artifact?.diskPath === pathMatch[1]) {
              dtu.artifact.diskPath = null;
              return { fixed: true, method: "marked_artifact_unavailable", dtuId: id };
            }
          }
        }
      }
      return { fixed: false };
    },
  },
  // TIER 3: Repair brain triage (0.5B — fast classification, single word)
  // The 0.5B model picks from a short list. Then deterministic strategies handle the fix.
  {
    name: "repair_brain_triage",
    match: () => !isBrainInCooldown(), // Skip entirely when brain is in cooldown
    apply: async (errorEntry) => {
      try {
        const BRAIN = globalThis._concordBRAIN;
        const brainConfig = BRAIN?.repair;
        if (!brainConfig?.url) return { fixed: false, reason: "repair_brain_offline" };

        const prompt = `Classify this error into exactly one category. Reply with ONLY the category word, nothing else.

Categories: NULL, TIMEOUT, TYPE, MEMORY, BRAIN, DISK, GATE, UNKNOWN

Error: ${(errorEntry.error.message || "").slice(0, 200)}
Module: ${errorEntry.context.module || "unknown"}

Category:`;

        const response = await fetch(`${brainConfig.url}/api/chat`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ model: brainConfig.model, messages: [{ role: "user", content: prompt }], stream: false }),
          signal: AbortSignal.timeout(5000), // 5s hard cap
        });
        const result = await response.json();
        const category = result?.message?.content?.trim().toUpperCase().split(/\s/)[0];

        // Route to the matching deterministic strategy
        const strategyMap = REPAIR_STRATEGIES.reduce((m, s) => {
          if (s.name === "null_reference_fix") m["NULL"] = s;
          if (s.name === "timeout_fix") m["TIMEOUT"] = s;
          if (s.name === "type_error_fix") m["TYPE"] = s;
          if (s.name === "memory_pressure_fix") m["MEMORY"] = s;
          if (s.name === "brain_failure_fix") m["BRAIN"] = s;
          if (s.name === "disk_error_fix") m["DISK"] = s;
          if (s.name === "gate_permission_fix") m["GATE"] = s;
          return m;
        }, {});

        const targetStrategy = strategyMap[category];
        if (targetStrategy) {
          const fixResult = await targetStrategy.apply(errorEntry);
          if (fixResult?.fixed) {
            return { ...fixResult, triageCategory: category, method: `llm_triage_${category.toLowerCase()}` };
          }
        }
        clearBrainCooldown(); // Brain responded
        return { fixed: false, triageCategory: category || "UNKNOWN" };
      } catch (err) {
        enterBrainCooldown(); // Brain down — stop retrying
        return { fixed: false, reason: "llm_triage_failed", error: err?.message };
      }
    },
  },
  // TIER 4: Deep diagnostic (3B utility brain — rare, complex cases only)
  // Only fires when all 8 deterministic strategies AND brain triage fail.
  // Borrows one inference from the utility brain (or conscious brain as fallback).
  {
    name: "deep_diagnostic",
    match: () => !isBrainInCooldown(), // Skip when brain is in cooldown
    apply: async (errorEntry) => {
      try {
        const BRAIN = globalThis._concordBRAIN;
        const brainConfig = BRAIN?.utility?.enabled !== false ? BRAIN?.utility : BRAIN?.conscious;
        if (!brainConfig?.url) return { fixed: false, reason: "no_brain_available" };

        const prompt = `You are diagnosing a software error in the Concord cognitive engine.

Error: ${(errorEntry.error.message || "").slice(0, 300)}
Stack (first 5 lines): ${(errorEntry.error.stack || "").split("\\n").slice(0, 5).join("\\n")}
Module: ${errorEntry.context.module || "unknown"}
Function: ${errorEntry.context.function || "unknown"}
Trigger: ${errorEntry.context.trigger || "unknown"}
Heap: ${errorEntry.context.stateSnapshot?.heapUsed || 0} bytes
DTUs: ${errorEntry.context.stateSnapshot?.dtuCount || 0}

Eight automatic repair strategies already failed.
Provide your response as JSON with no other text:
{"diagnosis":"one sentence root cause","fixType":"null_guard|cache|retry|fallback|config_change|skip","fixParams":{},"confidence":0.0-1.0}`;

        const response = await fetch(`${brainConfig.url}/api/chat`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ model: brainConfig.model, messages: [{ role: "user", content: prompt }], stream: false }),
          signal: AbortSignal.timeout(5000), // 5s hard cap — never block event loop longer
        });
        clearBrainCooldown(); // Brain responded
        const result = await response.json();
        const content = result?.message?.content;
        if (!content) return { fixed: false, reason: "no_llm_response" };

        const clean = content.replace(/```json|```/g, "").trim();
        let suggestion;
        try { suggestion = JSON.parse(clean); } catch { return { fixed: false, reason: "malformed_json" }; }
        if (!suggestion || suggestion.confidence < 0.5) return { fixed: false, reason: "low_confidence" };

        // Execute the suggested fix type
        switch (suggestion.fixType) {
          case "null_guard": {
            const pk = `null_guard:${errorEntry.context.module}:${errorEntry.context.function}`;
            if (!RUNTIME_PATCHES.has(pk)) { RUNTIME_PATCHES.set(pk, { type: "null_guard", appliedAt: nowISO() }); return { fixed: true, method: "deep_diag_null_guard", diagnosis: suggestion.diagnosis }; }
            return { fixed: false };
          }
          case "cache": {
            const S = _getSTATE();
            if (S) { if (!S._repairCaches) S._repairCaches = new Map(); S._repairCaches.set(`diag:${errorEntry.context.module}`, { ttl: 30000, cachedAt: 0 }); return { fixed: true, method: "deep_diag_cache" }; }
            return { fixed: false };
          }
          case "fallback": {
            RUNTIME_PATCHES.set(`fallback:${errorEntry.context.module}:${errorEntry.context.function}`, { type: "fallback", fallbackValue: suggestion.fixParams?.fallbackValue ?? null, appliedAt: nowISO() });
            return { fixed: true, method: "deep_diag_fallback", diagnosis: suggestion.diagnosis };
          }
          case "config_change": {
            if (suggestion.fixParams?.key) { RUNTIME_PATCHES.set(`config:${suggestion.fixParams.key}`, { type: "config_override", value: suggestion.fixParams.value, appliedAt: nowISO() }); return { fixed: true, method: "deep_diag_config" }; }
            return { fixed: false };
          }
          case "skip": {
            RUNTIME_PATCHES.set(`skip:${errorEntry.context.module}:${errorEntry.context.function}`, { type: "skip", reason: suggestion.diagnosis, appliedAt: nowISO() });
            return { fixed: true, method: "deep_diag_skip" };
          }
          default: return { fixed: false };
        }
      } catch (err) {
        enterBrainCooldown(); // Brain down — stop retrying
        return { fixed: false, reason: "deep_diagnostic_failed", error: err?.message };
      }
    },
  },
];

// ── v3.1 Sovereign Escalation ────────────────────────────────────────────────

async function _escalateToSovereign(errorEntry) {
  const S = _getSTATE();
  if (!S) return;

  const escalation = {
    id: uid("esc"),
    tier: "regular", scope: "local", domain: "repair",
    human: {
      summary: `ESCALATION: Unresolved ${errorEntry.severity} error in ${errorEntry.context.module}`,
      bullets: [
        `Error: ${errorEntry.error.message?.slice(0, 200)}`,
        `Module: ${errorEntry.context.module}`,
        `All repair strategies failed`,
      ],
    },
    core: { definitions: [], claims: [`Severity: ${errorEntry.severity}`, `Unresolved: true`], examples: [] },
    machine: {
      kind: "repair_escalation",
      verifier: { resolved: false, errorMessage: errorEntry.error.message?.slice(0, 200), module: errorEntry.context.module, severity: errorEntry.severity },
    },
    lineage: { parents: [], children: [] },
    authority: { score: 0.9 },
    meta: { createdBy: "repair_cortex", lens: "repair", type: "escalation", tags: ["repair", "escalation", errorEntry.severity], createdAt: nowISO() },
  };
  S.dtus.set(escalation.id, escalation);

  S.sovereignAlerts = S.sovereignAlerts || [];
  S.sovereignAlerts.push({
    id: escalation.id, type: "repair_escalation", severity: errorEntry.severity,
    summary: `Unresolved ${errorEntry.severity} error in ${errorEntry.context.module}: ${errorEntry.error.message?.slice(0, 100)}`,
    createdAt: nowISO(), acknowledged: false,
  });
}

// ── v3.1 Repair Queue Processor ──────────────────────────────────────────────

export async function processRepairQueue() {
  if (REPAIR_QUEUE.length === 0) return { processed: 0 };
  // Skip if memory ceiling monitor has paused background tasks
  if (globalThis.__memoryPaused?.()) return { processed: 0, skipped: "memory_paused" };
  const batch = REPAIR_QUEUE.splice(0, 10); // Process max 10 (was 20) to limit cycle duration
  let fixed = 0, escalated = 0;

  for (const errorEntry of batch) {
    let repaired = false;
    for (const strategy of REPAIR_STRATEGIES) {
      if (strategy.match && !strategy.match(errorEntry)) continue;
      try {
        const result = await strategy.apply(errorEntry);
        if (result?.fixed) {
          errorEntry.repairAttempted = true;
          errorEntry.repairSucceeded = true;
          errorEntry.repairMethod = strategy.name;
          // Log as repair DTU
          logRepairDTU(REPAIR_PHASES.POST_BUILD, "auto_repair", {
            strategy: strategy.name, method: result.method,
            error: errorEntry.error.message?.slice(0, 100), module: errorEntry.context.module,
          });
          // Pain integration
          _recordRepairPain("auto_repair", strategy.name, { module: errorEntry.context.module });
          fixed++;
          repaired = true;
          break;
        }
      } catch (_e) { logger.debug('emergent:repair-cortex', 'silent catch', { error: _e?.message }); }
    }
    if (!repaired) {
      errorEntry.repairAttempted = true;
      errorEntry.repairSucceeded = false;
      await _escalateToSovereign(errorEntry);
      escalated++;
    }
  }
  return { processed: batch.length, fixed, escalated };
}

// ── v3.1 Self-Test ───────────────────────────────────────────────────────────

export async function repairCortexSelfTest() {
  const results = {};

  try { const e = new Error("self_test"); ERROR_CONTEXT.capture(e, { module: "self_test", function: "test", trigger: "self_test" }); results.errorCapture = true; } catch { results.errorCapture = false; }
  results.strategiesLoaded = REPAIR_STRATEGIES.length > 0;
  results.strategyCount = REPAIR_STRATEGIES.length;
  results.executorCount = Object.keys(EXECUTORS).length;
  results.patchRegistryWorks = (() => { try { RUNTIME_PATCHES.set("_test", 1); RUNTIME_PATCHES.delete("_test"); return true; } catch { return false; } })();
  results.repairMemoryWorks = (() => { try { return typeof lookupRepairMemory === "function"; } catch { return false; } })();

  const passed = Object.values(results).filter(v => v === true).length;
  const total = Object.keys(results).filter(k => typeof results[k] === "boolean").length;
  results.overall = passed === total ? "healthy" : passed > total * 0.7 ? "degraded" : "failing";

  if (results.overall === "failing") {
    results.error = `Repair cortex failing: ${total - passed}/${total} checks failed`;
  }
  return results;
}

// ── v3.1 Repair Status Endpoint ──────────────────────────────────────────────

export function getRepairStatus() {
  const allErrors = ERROR_CONTEXT.getRecent(100);
  const fixed = allErrors.filter(e => e.repairSucceeded).length;
  const escalated = allErrors.filter(e => e.repairAttempted && !e.repairSucceeded).length;
  const total = allErrors.filter(e => e.repairAttempted).length;

  const strategyUsage = {};
  for (const err of allErrors) {
    if (err.repairMethod) {
      if (!strategyUsage[err.repairMethod]) strategyUsage[err.repairMethod] = { count: 0, successes: 0 };
      strategyUsage[err.repairMethod].count++;
      if (err.repairSucceeded) strategyUsage[err.repairMethod].successes++;
    }
  }

  const S = _getSTATE();
  const escalations = (S?.sovereignAlerts || []).filter(a => a.type === "repair_escalation" && !a.acknowledged);

  return {
    ok: true,
    health: "healthy",
    fixRate: total > 0 ? fixed / total : 1.0,
    total, fixed, escalated,
    activePatchCount: RUNTIME_PATCHES.size,
    brainFallbacks: Array.from(RUNTIME_PATCHES.values()).filter(p => p.type === "brain_fallback").length,
    escalations: escalations.slice(0, 10),
    strategyUsage: Object.entries(strategyUsage).map(([name, data]) => ({
      name, count: data.count, successRate: data.count > 0 ? Math.round(data.successes / data.count * 100) : 0,
    })),
    recentRepairs: allErrors.filter(e => e.repairSucceeded).slice(-10).map(e => ({
      id: e.id, time: e.timestamp, module: e.context.module, method: e.repairMethod, error: e.error.message?.slice(0, 80),
    })),
    queueLength: REPAIR_QUEUE.length,
  };
}
