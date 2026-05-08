// server/lib/detectors/invariant-guardian.js
//
// Actively checks core system invariants at runtime + by static parse.
// Each invariant is documented in CLAUDE.md "Key Invariants" section.
// A failure here is meaningful — these are constitutional rules.

import path from "node:path";
import { walk, readSafe, makeReport, makeError, lineOf, relPath } from "./_framework.js";

// Marketplace fee constants — must match CLAUDE.md.
const REQUIRED_CONSTANTS = [
  // file glob -> [ { name, expected, regex } ]
  {
    file: "server/lib/creative-marketplace-constants.js",
    // Constants are object-literal entries (`KEY: value,`) — not assignments.
    rules: [
      { name: "PLATFORM_FEE_RATE", expected: "0.0146", regex: /PLATFORM_FEE_RATE\s*[:=]\s*([0-9.]+)/ },
      { name: "MARKETPLACE_FEE_RATE", expected: "0.04", regex: /MARKETPLACE_FEE_RATE\s*[:=]\s*([0-9.]+)/ },
      { name: "INITIAL_ROYALTY_RATE", expected: "0.21", regex: /INITIAL_ROYALTY_RATE\s*[:=]\s*([0-9.]+)/ },
      { name: "ROYALTY_HALVING", expected: "2", regex: /ROYALTY_HALVING\s*[:=]\s*([0-9.]+)/ },
      { name: "ROYALTY_FLOOR", expected: "0.0005", regex: /ROYALTY_FLOOR\s*[:=]\s*([0-9.]+)/ },
      { name: "MAX_CASCADE_DEPTH", expected: "50", regex: /MAX_CASCADE_DEPTH\s*[:=]\s*([0-9.]+)/ },
    ],
  },
  {
    file: "server/economy/royalty-cascade.js",
    rules: [
      { name: "MAX_ROYALTY_RATE", expected: "0.30", regex: /MAX_ROYALTY_RATE\s*[:=]\s*([0-9.]+)/ },
    ],
  },
  {
    file: "server/economy/withdrawals.js",
    rules: [
      { name: "WITHDRAWAL_HOLD_HOURS", expected: "48", regex: /WITHDRAWAL_HOLD_HOURS\s*[:=]\s*([0-9.]+)/ },
    ],
  },
];

// Invariants enforced by codepaths — checked via grep.
const CODEPATH_INVARIANTS = [
  {
    id: "no_force_npc_pain",
    severity: "critical",
    description: "Pain ledger is asymmetric. Only players generate pain_signals.",
    requireAllOf: [
      // pain.js#recordPain caller must validate user_id against users table
      { file: "server/lib/embodied/pain.js", regex: /recordPain/ },
    ],
    forbiddenPatterns: [
      // Direct npc_id INSERT into pain_signals from any non-test file
      { regex: /INSERT\s+INTO\s+pain_signals[^;]+npc_id/i, exclude: [/\/tests\//] },
    ],
  },
  {
    id: "no_client_damage_trust",
    severity: "critical",
    description: "Combat /attack must call _validateDamageCap before applying damage.",
    requireAllOf: [
      { file: "server/routes/worlds.js", regex: /_validateDamageCap\s*\(/ },
      { file: "server/routes/worlds.js", regex: /_validateCombatReach\s*\(/ },
    ],
  },
  {
    id: "env_boost_after_cap",
    severity: "critical",
    description: "elementalEnvBoost must run after _validateDamageCap, never before.",
    customCheck: async (root) => {
      const f = path.join(root, "server/routes/worlds.js");
      const c = await readSafe(f);
      if (!c) return [{ ok: false, reason: "file_missing" }];
      const capIdx = c.search(/_validateDamageCap\s*\(/);
      const boostIdx = c.search(/elementalEnvBoost\s*\(/);
      if (capIdx === -1 || boostIdx === -1) {
        return [{ ok: false, reason: "missing_callsite", capIdx, boostIdx }];
      }
      if (boostIdx < capIdx) {
        return [{
          ok: false, reason: "env_boost_runs_before_cap",
          capLine: lineOf(c, capIdx), boostLine: lineOf(c, boostIdx),
        }];
      }
      return [{ ok: true }];
    },
  },
  {
    id: "world_event_mints_real_cc",
    severity: "high",
    description: "world-events.endEvent must call mintCoins (not just emit toasts).",
    requireAllOf: [
      { file: "server/lib/world-events.js", regex: /mintCoins\s*\(/ },
      { file: "server/lib/world-events.js", regex: /event_reward:/ },
    ],
  },
  {
    id: "player_inventory_per_world",
    severity: "high",
    description: "player_inventory queries must scope by world_id (migration 101).",
    customCheck: async (root) => {
      const f = path.join(root, "server/routes/player-inventory.js");
      const c = await readSafe(f);
      if (!c) return [{ ok: false, reason: "file_missing" }];
      const scopedRe = /FROM\s+player_inventory[\s\S]{0,400}?world_id\s*=\s*\?/i;
      if (!scopedRe.test(c)) {
        return [{ ok: false, reason: "missing_world_id_scope" }];
      }
      return [{ ok: true }];
    },
  },
  {
    id: "heartbeat_try_catch",
    severity: "high",
    description: "Heartbeat handlers must wrap their body in try/catch (registry already wraps each handler invocation, but inner work that re-throws would still bubble up via the registry's own wrap — this guard pins the shape).",
    customCheck: async (root) => {
      const dir = path.join(root, "server/emergent");
      const files = await walk(dir, [".js"]);
      const out = [];
      for (const f of files) {
        const c = await readSafe(f);
        // Only flag exported handlers that look like heartbeat targets
        // and lack any try/catch.
        if (!/export\s+async\s+function\s+run\w+\s*\(/.test(c)) continue;
        if (/\btry\s*\{|\bcatch\s*\(/.test(c)) continue;
        out.push({
          ok: false,
          reason: "no_try_catch",
          file: relPath(root, f),
        });
      }
      return out.length ? out : [{ ok: true }];
    },
  },
  {
    id: "npc_secret_not_in_prompt",
    severity: "critical",
    description: "narrative_context.secret must never be passed to LLM prompts.",
    requireAllOf: [
      { file: "server/lib/narrative-bridge.js", regex: /secret/ },
    ],
    forbiddenPatterns: [
      { regex: /prompt\s*[+]=?\s*[^;]*\.secret\b/, exclude: [/\/tests\//] },
    ],
  },
  {
    id: "migrations_append_only",
    severity: "info",
    description: "Migration files are append-only — last id should match CLAUDE.md.",
    customCheck: async (root) => {
      const dir = path.join(root, "server/migrations");
      const files = (await walk(dir, [".js"])).map(f => path.basename(f)).sort();
      const max = files
        .map(n => parseInt(n.split("_")[0], 10))
        .filter(Number.isFinite)
        .reduce((a, b) => Math.max(a, b), 0);
      // Max migration as of CLAUDE.md is 119; warn only if regressed (lower).
      if (max < 119) return [{ ok: false, reason: "migrations_regressed", max }];
      return [{ ok: true, latestMigration: max }];
    },
  },
];

export async function runInvariantGuardian({ root, opts = {} } = {}) {
  const t0 = Date.now();
  if (!root) return makeError("invariant-guardian", "no_root", null, t0);

  try {
    const findings = [];

    // ── 1. Constant audit ──────────────────────────────────────────────
    for (const block of REQUIRED_CONSTANTS) {
      const filePath = path.join(root, block.file);
      const content = await readSafe(filePath);
      if (!content) {
        findings.push({
          id: "invariant_file_missing",
          severity: "high",
          kind: "invariant",
          message: `Required invariant source file missing: ${block.file}`,
          location: block.file,
        });
        continue;
      }
      for (const rule of block.rules) {
        const m = content.match(rule.regex);
        if (!m) {
          findings.push({
            id: "invariant_constant_unset",
            severity: "high",
            kind: "invariant",
            message: `${rule.name} is not declared in ${block.file}`,
            location: block.file,
            evidence: { name: rule.name, expected: rule.expected },
          });
          continue;
        }
        if (m[1] !== rule.expected) {
          findings.push({
            id: "invariant_constant_drift",
            severity: "critical",
            kind: "invariant",
            message: `${rule.name} = ${m[1]} but invariant expects ${rule.expected}`,
            location: `${block.file}:${lineOf(content, m.index)}`,
            evidence: { name: rule.name, actual: m[1], expected: rule.expected },
          });
        }
      }
    }

    // ── 2. Codepath audit ──────────────────────────────────────────────
    for (const inv of CODEPATH_INVARIANTS) {
      // requireAllOf
      for (const r of inv.requireAllOf || []) {
        const fp = path.join(root, r.file);
        const c = await readSafe(fp);
        if (!c || !r.regex.test(c)) {
          findings.push({
            id: "invariant_violated",
            severity: inv.severity,
            kind: "invariant",
            message: `${inv.id}: required pattern not found in ${r.file}`,
            location: r.file,
            evidence: { invariant: inv.id, description: inv.description },
          });
        }
      }
      // forbiddenPatterns — search across server tree
      if (inv.forbiddenPatterns?.length) {
        const files = await walk(path.join(root, "server"), [".js"]);
        for (const f of files) {
          const rel = relPath(root, f);
          if ((inv.forbiddenPatterns[0].exclude || []).some(re => re.test(rel))) continue;
          const c = await readSafe(f);
          if (!c) continue;
          for (const p of inv.forbiddenPatterns) {
            const m = c.match(p.regex);
            if (m) {
              findings.push({
                id: "invariant_violated",
                severity: inv.severity,
                kind: "invariant",
                message: `${inv.id}: forbidden pattern present`,
                location: `${rel}:${lineOf(c, m.index)}`,
                evidence: { invariant: inv.id, snippet: m[0].slice(0, 120) },
              });
            }
          }
        }
      }
      // customCheck
      if (typeof inv.customCheck === "function") {
        const results = await inv.customCheck(root);
        for (const r of results || []) {
          if (!r || r.ok === true) continue;
          findings.push({
            id: "invariant_violated",
            severity: inv.severity,
            kind: "invariant",
            message: `${inv.id}: ${r.reason || "violated"}`,
            location: r.file || null,
            evidence: { invariant: inv.id, ...r },
          });
        }
      }
    }

    return makeReport("invariant-guardian", findings, t0);
  } catch (err) {
    return makeError("invariant-guardian", "exception", err, t0);
  }
}
