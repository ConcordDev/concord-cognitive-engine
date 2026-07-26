/**
 * System: Global Repair Network (Future SaaS Layer)
 *
 * Syncs anonymized repair memory with a global registry so every Concord
 * deployment teaches every other deployment. Currently a stub — local-only
 * mode with the sync protocol specced and ready for activation via env vars.
 *
 * Enabled via: REPAIR_NETWORK_ENABLED=true and REPAIR_NETWORK_TOKEN=xxx
 *
 * Tiers:
 *   free      — local memory only
 *   connected — pull + push to global registry ($19/mo)
 *   enterprise — pull only, private registry ($99/seat/mo)
 *
 * All state in module-level structures. Silent failure. Additive only.
 */

import crypto from "crypto";

// ── Helpers ─────────────────────────────────────────────────────────────────

function uid(prefix = "repnet") {
  return `${prefix}_${crypto.randomBytes(10).toString("hex")}`;
}
function nowISO() { return new Date().toISOString(); }

// ── Constants ───────────────────────────────────────────────────────────────

const GLOBAL_REGISTRY_URL = process.env.REPAIR_NETWORK_URL || "https://repair.concord.dev";
const INSTANCE_TOKEN = process.env.REPAIR_NETWORK_TOKEN || null;
const ENABLED = process.env.REPAIR_NETWORK_ENABLED === "true";
const PUSH_INTERVAL = 3600000;      // 1 hour
const PULL_INTERVAL = 3600000 + 1800000; // 1.5 hours (offset)

const TIERS = {
  free: { localMemoryOnly: true, pullFromGlobal: false, pushToGlobal: false },
  connected: { localMemoryOnly: false, pullFromGlobal: true, pushToGlobal: true },
  enterprise: { localMemoryOnly: false, pullFromGlobal: true, pushToGlobal: false, privateRegistry: true },
};

// ── Module State ────────────────────────────────────────────────────────────

const _tier = ENABLED ? "connected" : "free";
let _lastPush = null;
let _lastPull = null;
let _globalFixCount = 0;
let _pushTimer = null;
let _pullTimer = null;
let _lastPullTimestamp = "2020-01-01T00:00:00Z";

// ── Anonymization ───────────────────────────────────────────────────────────

function hashPattern(pattern) {
  return crypto.createHash("sha256").update(pattern).digest("hex").slice(0, 16);
}

function anonymizeFix(fix) {
  return {
    errorPattern: hashPattern(fix.pattern || fix.errorPattern || "unknown"),
    category: fix.category || "unknown",
    executor: fix.executor || "unknown",
    successRate: fix.successRate || 0,
    occurrences: fix.occurrences || 0,
    firstSeen: fix.firstSeen || nowISO(),
    // NO stack traces, NO file paths, NO code content, NO instance ID
  };
}

// ── Push Fixes ──────────────────────────────────────────────────────────────

function getRepairMemoryExport() {
  const repairMem = globalThis._concordRepairMemory;
  if (!repairMem || !(repairMem instanceof Map)) return [];

  const fixes = [];
  for (const [pattern, data] of repairMem.entries()) {
    fixes.push({
      pattern,
      category: data.category || "unknown",
      executor: data.executor || "unknown",
      successRate: data.successRate || 0,
      occurrences: data.occurrences || 0,
      firstSeen: data.firstSeen || nowISO(),
    });
  }
  return fixes;
}

export async function pushFixes() {
  if (!ENABLED || !INSTANCE_TOKEN) return { ok: false, error: "Network not enabled" };
  if (TIERS[_tier]?.pushToGlobal === false) return { ok: false, error: "Tier does not allow push" };

  try {
    const fixes = getRepairMemoryExport();
    const filtered = fixes
      .filter(f => f.successRate > 0.7 && f.occurrences >= 3)
      .map(anonymizeFix);

    if (!filtered.length) return { ok: true, pushed: 0 };

    const resp = await fetch(`${GLOBAL_REGISTRY_URL}/api/repair/contribute`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "X-Instance-Token": INSTANCE_TOKEN,
      },
      body: JSON.stringify({ fixes: filtered }),
    });

    _lastPush = nowISO();
    return { ok: resp.ok, pushed: filtered.length, timestamp: _lastPush };
  } catch (err) {
    return { ok: false, error: err.message };
  }
}

// ── Pull Fixes ──────────────────────────────────────────────────────────────

export async function pullFixes() {
  if (!ENABLED || !INSTANCE_TOKEN) return { ok: false, error: "Network not enabled" };
  if (TIERS[_tier]?.pullFromGlobal === false) return { ok: false, error: "Tier does not allow pull" };

  try {
    const resp = await fetch(`${GLOBAL_REGISTRY_URL}/api/repair/latest?since=${_lastPullTimestamp}`, {
      headers: { "X-Instance-Token": INSTANCE_TOKEN },
    });

    if (!resp.ok) return { ok: false, error: `HTTP ${resp.status}` };

    const data = await resp.json();
    const globalFixes = data.fixes || [];
    let imported = 0;

    const repairMem = globalThis._concordRepairMemory;
    if (repairMem instanceof Map) {
      for (const fix of globalFixes) {
        const existing = repairMem.get(fix.errorPattern);
        if (!existing) {
          repairMem.set(fix.errorPattern, {
            executor: fix.executor,
            source: "global_network",
            confidence: (fix.successRate || 0) * 0.8,
            importedAt: nowISO(),
          });
          imported++;
        }
      }
    }

    _lastPull = nowISO();
    _lastPullTimestamp = _lastPull;
    _globalFixCount += imported;

    return { ok: true, imported, total: globalFixes.length, timestamp: _lastPull };
  } catch (err) {
    return { ok: false, error: err.message };
  }
}

// ── Security Pattern Sharing ────────────────────────────────────────────────
// Security signatures are inherently safe to share (public threat intelligence).
// They don't contain user code, file paths, or instance-specific data.

/**
 * Push security-related repair fixes to the global network.
 * Security fixes are filtered separately — they're always shareable
 * because they contain no proprietary code (just vulnerability type + fix pattern).
 *
 * @returns {Promise<{ok: boolean, pushed?: number, error?: string}>}
 */
export async function pushSecurityFixes() {
  if (!ENABLED || !INSTANCE_TOKEN) return { ok: false, error: "Network not enabled" };
  if (TIERS[_tier]?.pushToGlobal === false) return { ok: false, error: "Tier does not allow push" };

  try {
    const repairMem = globalThis._concordRepairMemory;
    if (!(repairMem instanceof Map)) return { ok: true, pushed: 0 };

    const securityFixes = [];
    for (const [pattern, data] of repairMem.entries()) {
      if (data.securityRelated && data.successRate > 0.5 && data.occurrences >= 2) {
        securityFixes.push({
          errorPattern: hashPattern(pattern),
          category: "security",
          vulnerabilityType: data.vulnerabilityType || data.fix?.vulnerabilityType || "unknown",
          cveId: data.cveId || data.fix?.cveId || null,
          executor: data.executor || data.fix?.executor || "unknown",
          successRate: data.successRate || 0,
          occurrences: data.occurrences || 0,
          // NO file paths, NO stack traces, NO code content
        });
      }
    }

    if (!securityFixes.length) return { ok: true, pushed: 0 };

    const resp = await fetch(`${GLOBAL_REGISTRY_URL}/api/repair/contribute`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "X-Instance-Token": INSTANCE_TOKEN,
      },
      body: JSON.stringify({ fixes: securityFixes, type: "security" }),
    });

    return { ok: resp.ok, pushed: securityFixes.length, type: "security" };
  } catch (err) {
    return { ok: false, error: err.message };
  }
}

/**
 * Get count of security-tagged fixes in repair memory.
 * @returns {{ count: number, withCve: number }}
 */
export function getSecurityFixCount() {
  const repairMem = globalThis._concordRepairMemory;
  if (!(repairMem instanceof Map)) return { count: 0, withCve: 0 };

  let count = 0, withCve = 0;
  for (const data of repairMem.values()) {
    if (data.securityRelated) {
      count++;
      if (data.cveId || data.fix?.cveId) withCve++;
    }
  }
  return { count, withCve };
}

// ── Query Helpers ───────────────────────────────────────────────────────────

export function getStatus() {
  return {
    ok: true,
    enabled: ENABLED,
    tier: _tier,
    lastPush: _lastPush,
    lastPull: _lastPull,
    globalFixCount: _globalFixCount,
    registryUrl: ENABLED ? GLOBAL_REGISTRY_URL : null,
  };
}

export function disconnect() {
  if (_pushTimer) { clearInterval(_pushTimer); _pushTimer = null; }
  if (_pullTimer) { clearInterval(_pullTimer); _pullTimer = null; }
  return { ok: true, disconnected: true };
}

// ── Sovereign Command Handler ───────────────────────────────────────────────

export function handleRepairNetworkCommand(parts) {
  const sub = parts[0]?.toLowerCase();

  switch (sub) {
    case "repair-network-status":
      return getStatus();
    case "repair-network-contribute":
      return pushFixes();
    case "repair-network-pull":
      return pullFixes();
    case "repair-network-disconnect":
      return disconnect();
    case "repair-network-security-push":
      return pushSecurityFixes();
    case "repair-network-security-count":
      return getSecurityFixCount();
    default:
      return { ok: false, error: `Unknown repair-network command: ${sub}` };
  }
}

// ── Init ────────────────────────────────────────────────────────────────────

// This hook referenced neither STATE nor helpers — it only does its own
// local setup. Dropping the unused destructure so the signature stops
// implying dependencies that aren't there. Callers are unaffected:
// extra arguments are simply ignored.
export function init() {
  if (!ENABLED) return { ok: true, enabled: false, message: "Repair network disabled" };

  _pushTimer = setInterval(() => { pushFixes().catch(e => console.warn('[repair-network] async op failed:', e?.message)); }, PUSH_INTERVAL);
  _pullTimer = setInterval(() => { pullFixes().catch(e => console.warn('[repair-network] async op failed:', e?.message)); }, PULL_INTERVAL);
  if (_pushTimer.unref) _pushTimer.unref();
  if (_pullTimer.unref) _pullTimer.unref();

  return { ok: true, enabled: true, tier: _tier };
}

export function stop() {
  disconnect();
}
