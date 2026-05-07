/**
 * Security Matching Engine — 4-Layer Real-Time Threat Detection
 *
 * Fast → Deep pipeline for matching content against known threats:
 *   Layer 1: Hash lookup (O(1)) — SHA256 against signature DB + shield state
 *   Layer 2: Signature scan (deterministic regex) — compiled regex cache, refreshed every 10m
 *   Layer 3: Token-overlap scoring — reuses repair-enhanced approach for vulnerability matching
 *   Layer 4: Embedding similarity (novel threats) — only for MEDIUM+ flagged content
 *
 * Response actions (all deterministic):
 *   BLOCK      — Reject + log security_event
 *   QUARANTINE — Accept but tag quarantined
 *   REPAIR     — Apply known fix from security_fixes
 *   ALERT      — Log + sovereign alert
 *   ALLOW      — Clean, no match
 *
 * Key principle: No LLM in the hot path. All matching is deterministic.
 * The 0.5b repair brain is only invoked for ambiguous classification (score 0.4-0.7).
 */

import { createHash } from "crypto";

// ── Constants ──────────────────────────────────────────────────────────────

export const MATCH_ACTIONS = Object.freeze({
  BLOCK:      "blocked",
  QUARANTINE: "quarantined",
  REPAIR:     "repaired",
  ALERT:      "escalated",
  ALLOW:      "allowed",
});

const SEVERITY_WEIGHTS = { critical: 1.0, high: 0.8, medium: 0.5, low: 0.2, info: 0.1 };

// Cache refresh interval (10 minutes)
const CACHE_REFRESH_MS = 10 * 60 * 1000;

// Token-overlap thresholds
const OVERLAP_HIGH_CONFIDENCE = 0.7;   // Strong match — apply fix
const OVERLAP_AMBIGUOUS_LOW   = 0.4;   // Ambiguous zone — needs triage
const OVERLAP_MIN_MATCH       = 0.3;   // Below this, no match

// Embedding similarity threshold
const EMBEDDING_SIMILARITY_THRESHOLD = 0.75;

// Max regex patterns to keep in memory
const MAX_CACHED_PATTERNS = 2000;

// ── Token Overlap (local implementation) ───────────────────────────────────

function tokenize(text) {
  if (!text || typeof text !== "string") return [];
  return text
    .toLowerCase()
    .replace(/[^a-z0-9\s_-]/g, " ")
    .split(/[\s_-]+/)
    .filter(t => t.length > 1);
}

function overlapScore(tokensA, tokensB) {
  if (!tokensA.length || !tokensB.length) return 0;
  const setA = new Set(tokensA);
  const setB = new Set(tokensB);
  let intersection = 0;
  for (const token of setA) {
    if (setB.has(token)) intersection++;
  }
  const union = new Set([...setA, ...setB]).size;
  return union > 0 ? intersection / union : 0;
}

// ── SHA256 Helper ──────────────────────────────────────────────────────────

function sha256(text) {
  return createHash("sha256").update(text).digest("hex");
}

// ── Regex Cache ────────────────────────────────────────────────────────────

class SignatureCache {
  constructor() {
    this.patterns = [];       // [{id, regex, severity, signatureType, name}]
    this.hashIndex = new Map(); // pattern_hash → signature row
    this.lastRefresh = 0;
    this.fixIndex = new Map();  // vulnerability_type → [{id, before_tokens, after_pattern, confidence, ...}]
  }

  needsRefresh() {
    return Date.now() - this.lastRefresh > CACHE_REFRESH_MS;
  }

  refresh(db) {
    // Load regex signatures (non-hash patterns that can be compiled)
    const regexRows = db.prepare(`
      SELECT id, name, pattern, compiled_pattern, severity, signature_type, pattern_hash
      FROM security_signatures
      WHERE deprecated = 0 AND source IN ('yara', 'codebase_scan', 'custom')
      ORDER BY severity DESC, effective_rate DESC
      LIMIT ?
    `).all(MAX_CACHED_PATTERNS);

    this.patterns = [];
    for (const row of regexRows) {
      try {
        // Try to compile pattern as regex; if it fails, use as literal
        const regexStr = row.compiled_pattern || row.pattern;
        const regex = new RegExp(escapeForRegex(regexStr), "i");
        this.patterns.push({
          id: row.id,
          regex,
          severity: row.severity,
          signatureType: row.signature_type,
          name: row.name,
          patternHash: row.pattern_hash,
        });
      } catch (_) {
        // Pattern isn't valid regex — skip for regex layer, still available for token-overlap
      }
    }

    // Load hash index (ClamAV HDB signatures + any hash-based sigs)
    const hashRows = db.prepare(`
      SELECT id, pattern, pattern_hash, severity, signature_type, name
      FROM security_signatures
      WHERE deprecated = 0 AND source = 'clamav'
      LIMIT 10000
    `).all();

    this.hashIndex.clear();
    for (const row of hashRows) {
      this.hashIndex.set(row.pattern_hash, row);
      // Also index the pattern itself (for ClamAV HDB which stores the MD5/SHA hash directly)
      if (row.pattern && row.pattern.length === 32 || row.pattern.length === 64) {
        this.hashIndex.set(row.pattern.toLowerCase(), row);
      }
    }

    // Load security fixes indexed by vulnerability type
    const fixRows = db.prepare(`
      SELECT id, vulnerability_type, before_pattern, after_pattern, language, confidence,
             success_rate, cve_id
      FROM security_fixes
      WHERE deprecated = 0 AND confidence >= 0.4
      ORDER BY success_rate DESC, confidence DESC
    `).all();

    this.fixIndex.clear();
    for (const row of fixRows) {
      const type = row.vulnerability_type;
      if (!this.fixIndex.has(type)) this.fixIndex.set(type, []);
      this.fixIndex.get(type).push({
        ...row,
        beforeTokens: tokenize(row.before_pattern),
      });
    }

    this.lastRefresh = Date.now();
  }
}

function escapeForRegex(str) {
  // If it looks like an intentional regex pattern, don't escape
  if (/[.+*?[\]{}()|\\^$]/.test(str) && str.length < 2000) {
    return str;
  }
  // Otherwise escape for literal matching
  return str.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

// ── Main Matcher ───────────────────────────────────────────────────────────

/**
 * Create the security matching engine.
 *
 * @param {Object} db - better-sqlite3 database handle
 * @param {Object} [opts] - Options
 * @param {Object} [opts.shieldState] - Reference to concord-shield's _shieldState
 * @param {Function} [opts.embed] - Embedding function from embeddings.js
 * @param {Function} [opts.cosineSimilarity] - Cosine similarity from embeddings.js
 * @param {Function} [opts.logEvent] - Security event logger from security-ingest.js
 * @returns {Object} Matcher API
 */
export function createSecurityMatcher(db, opts = {}) {
  const cache = new SignatureCache();
  const { shieldState, embed, cosineSimilarity, logEvent } = opts;

  // Lazy-init the event insert statement
  const insertEvent = db.prepare(`
    INSERT INTO security_events
      (event_type, signature_id, fix_id, target, target_type, severity, result, details, session_id)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
  `);

  function log(eventType, signatureId, fixId, target, targetType, severity, result, details, sessionId) {
    if (logEvent) {
      logEvent(eventType, signatureId, fixId, target, targetType, severity, result, details, sessionId);
    } else {
      try {
        insertEvent.run(eventType, signatureId, fixId, target, targetType, severity, result, JSON.stringify(details || {}), sessionId);
      } catch (_) { /* non-critical */ }
    }
  }

  function ensureCache() {
    if (cache.needsRefresh()) {
      try { cache.refresh(db); } catch (_) { /* use stale cache */ }
    }
  }

  // ── Layer 1: Hash Lookup ─────────────────────────────────────────────────

  function matchHash(contentHash) {
    // Check concord-shield's in-memory indexes first (O(1))
    if (shieldState) {
      if (shieldState.knownGoodHashes?.has(contentHash)) {
        return { matched: false, reason: "known_good_hash" };
      }
      const threatDtuId = shieldState.threatIndex?.get(contentHash);
      if (threatDtuId) {
        return {
          matched: true,
          layer: 1,
          signatureId: threatDtuId,
          severity: "high",
          action: MATCH_ACTIONS.BLOCK,
          reason: "shield_threat_index",
        };
      }
    }

    // Check DB hash index
    ensureCache();
    const sig = cache.hashIndex.get(contentHash);
    if (sig) {
      return {
        matched: true,
        layer: 1,
        signatureId: sig.id,
        severity: sig.severity,
        name: sig.name,
        action: severityToAction(sig.severity),
        reason: "hash_match",
      };
    }

    return { matched: false };
  }

  // ── Layer 2: Signature Regex Scan ────────────────────────────────────────

  function matchSignatures(content) {
    ensureCache();
    const matches = [];

    for (const sig of cache.patterns) {
      try {
        if (sig.regex.test(content)) {
          matches.push({
            matched: true,
            layer: 2,
            signatureId: sig.id,
            severity: sig.severity,
            name: sig.name,
            signatureType: sig.signatureType,
            action: severityToAction(sig.severity),
            reason: "signature_regex_match",
          });
        }
      } catch (_) {
        // Regex error — skip
      }
    }

    // Return highest severity match
    if (matches.length === 0) return { matched: false };
    matches.sort((a, b) => (SEVERITY_WEIGHTS[b.severity] || 0) - (SEVERITY_WEIGHTS[a.severity] || 0));
    return { ...matches[0], totalMatches: matches.length };
  }

  // ── Layer 3: Token-Overlap Scoring ───────────────────────────────────────

  function matchTokenOverlap(content, vulnerabilityType) {
    ensureCache();
    const contentTokens = tokenize(content);
    if (contentTokens.length === 0) return { matched: false };

    let bestMatch = null;
    let bestScore = 0;

    // If vulnerability type is known, search that category first
    const typesToCheck = vulnerabilityType
      ? [vulnerabilityType, "unknown"]
      : [...cache.fixIndex.keys()];

    for (const type of typesToCheck) {
      const fixes = cache.fixIndex.get(type);
      if (!fixes) continue;

      for (const fix of fixes) {
        if (fix.beforeTokens.length === 0) continue;
        const score = overlapScore(contentTokens, fix.beforeTokens);

        if (score > bestScore && score >= OVERLAP_MIN_MATCH) {
          bestScore = score;
          bestMatch = {
            fixId: fix.id,
            vulnerabilityType: fix.vulnerability_type,
            afterPattern: fix.after_pattern,
            confidence: fix.confidence,
            successRate: fix.success_rate,
            cveId: fix.cve_id,
            overlapScore: score,
          };
        }
      }
    }

    if (!bestMatch) return { matched: false };

    let action;
    let confidence;
    if (bestScore >= OVERLAP_HIGH_CONFIDENCE && bestMatch.successRate > 0) {
      action = MATCH_ACTIONS.REPAIR;
      confidence = "high";
    } else if (bestScore >= OVERLAP_AMBIGUOUS_LOW) {
      action = MATCH_ACTIONS.ALERT;
      confidence = "ambiguous";
    } else {
      action = MATCH_ACTIONS.ALLOW;
      confidence = "low";
    }

    return {
      matched: bestScore >= OVERLAP_AMBIGUOUS_LOW,
      layer: 3,
      action,
      confidence,
      severity: bestScore >= OVERLAP_HIGH_CONFIDENCE ? "high" : "medium",
      reason: "token_overlap_match",
      ...bestMatch,
    };
  }

  // ── Layer 4: Embedding Similarity (async) ────────────────────────────────

  async function matchEmbedding(content) {
    if (!embed || !cosineSimilarity) return { matched: false, reason: "embeddings_unavailable" };

    try {
      const contentVec = await embed(content);
      if (!contentVec) return { matched: false, reason: "embedding_failed" };

      // Load security signature descriptions that have been flagged as noteworthy
      const sigRows = db.prepare(`
        SELECT id, name, description, severity, signature_type, cve_id
        FROM security_signatures
        WHERE deprecated = 0 AND severity IN ('critical', 'high')
        ORDER BY created_at DESC
        LIMIT 200
      `).all();

      let bestSimilarity = 0;
      let bestMatch = null;

      for (const sig of sigRows) {
        const sigVec = await embed(sig.description);
        if (!sigVec) continue;

        const similarity = cosineSimilarity(contentVec, sigVec);
        if (similarity > bestSimilarity && similarity >= EMBEDDING_SIMILARITY_THRESHOLD) {
          bestSimilarity = similarity;
          bestMatch = sig;
        }
      }

      if (!bestMatch) return { matched: false };

      return {
        matched: true,
        layer: 4,
        signatureId: bestMatch.id,
        severity: bestMatch.severity,
        name: bestMatch.name,
        cveId: bestMatch.cve_id,
        similarity: bestSimilarity,
        action: severityToAction(bestMatch.severity),
        reason: "embedding_similarity_match",
      };
    } catch (e) {
      return { matched: false, reason: `embedding_error: ${e.message}` };
    }
  }

  // ── Full Pipeline ────────────────────────────────────────────────────────

  /**
   * Run the full 4-layer matching pipeline.
   * Stops at the first positive match (fast layers first).
   *
   * @param {Object} input
   * @param {string} [input.content] - Text/code content to scan
   * @param {string} [input.hash] - Pre-computed SHA256 hash
   * @param {string} [input.vulnerabilityType] - Hint for token-overlap
   * @param {boolean} [input.deepScan=false] - Whether to run Layer 4 (embedding)
   * @param {string} [input.sessionId] - Session for event logging
   * @param {string} [input.target] - Target identifier for logging
   * @returns {Promise<Object>} Match result with action recommendation
   */
  async function scan(input = {}) {
    const { content, hash, vulnerabilityType, deepScan = false, sessionId, target } = input;
    const contentHash = hash || (content ? sha256(content) : null);

    // Layer 1: Hash lookup
    if (contentHash) {
      const hashResult = matchHash(contentHash);
      if (hashResult.matched) {
        log("pattern_match", hashResult.signatureId, null, target, "hash", hashResult.severity, hashResult.action, { layer: 1 }, sessionId);
        return { ...hashResult, scannedLayers: [1] };
      }
    }

    if (!content) {
      return { matched: false, action: MATCH_ACTIONS.ALLOW, scannedLayers: [1] };
    }

    // Layer 2: Signature regex scan
    const sigResult = matchSignatures(content);
    if (sigResult.matched) {
      log("pattern_match", sigResult.signatureId, null, target, "content", sigResult.severity, sigResult.action, { layer: 2, totalMatches: sigResult.totalMatches }, sessionId);
      return { ...sigResult, scannedLayers: [1, 2] };
    }

    // Layer 3: Token-overlap scoring
    const overlapResult = matchTokenOverlap(content, vulnerabilityType);
    if (overlapResult.matched) {
      log("pattern_match", null, overlapResult.fixId, target, "content", overlapResult.severity, overlapResult.action, { layer: 3, overlapScore: overlapResult.overlapScore }, sessionId);
      return { ...overlapResult, scannedLayers: [1, 2, 3] };
    }

    // Layer 4: Embedding similarity (only if deepScan requested)
    if (deepScan) {
      const embedResult = await matchEmbedding(content);
      if (embedResult.matched) {
        log("pattern_match", embedResult.signatureId, null, target, "content", embedResult.severity, embedResult.action, { layer: 4, similarity: embedResult.similarity }, sessionId);
        return { ...embedResult, scannedLayers: [1, 2, 3, 4] };
      }
      return { matched: false, action: MATCH_ACTIONS.ALLOW, scannedLayers: [1, 2, 3, 4] };
    }

    return { matched: false, action: MATCH_ACTIONS.ALLOW, scannedLayers: [1, 2, 3] };
  }

  /**
   * Quick scan — Layers 1-3 only (synchronous-safe, no embedding).
   */
  function quickScan(input = {}) {
    const { content, hash, vulnerabilityType, sessionId, target } = input;
    const contentHash = hash || (content ? sha256(content) : null);

    if (contentHash) {
      const hashResult = matchHash(contentHash);
      if (hashResult.matched) {
        log("pattern_match", hashResult.signatureId, null, target, "hash", hashResult.severity, hashResult.action, { layer: 1 }, sessionId);
        return { ...hashResult, scannedLayers: [1] };
      }
    }

    if (!content) return { matched: false, action: MATCH_ACTIONS.ALLOW, scannedLayers: [1] };

    const sigResult = matchSignatures(content);
    if (sigResult.matched) {
      log("pattern_match", sigResult.signatureId, null, target, "content", sigResult.severity, sigResult.action, { layer: 2 }, sessionId);
      return { ...sigResult, scannedLayers: [1, 2] };
    }

    const overlapResult = matchTokenOverlap(content, vulnerabilityType);
    if (overlapResult.matched) {
      log("pattern_match", null, overlapResult.fixId, target, "content", overlapResult.severity, overlapResult.action, { layer: 3, overlapScore: overlapResult.overlapScore }, sessionId);
      return { ...overlapResult, scannedLayers: [1, 2, 3] };
    }

    return { matched: false, action: MATCH_ACTIONS.ALLOW, scannedLayers: [1, 2, 3] };
  }

  // ── Fix Lookup ───────────────────────────────────────────────────────────

  /**
   * Look up the best available fix for a vulnerability type.
   *
   * @param {string} vulnerabilityType - Type of vulnerability
   * @param {string} [content] - Content to match against (for token-overlap ranking)
   * @param {number} [minConfidence=0.5] - Minimum confidence threshold
   * @returns {Object|null} Best matching fix or null
   */
  function findFix(vulnerabilityType, content, minConfidence = 0.5) {
    const fixes = db.prepare(`
      SELECT * FROM security_fixes
      WHERE vulnerability_type = ? AND deprecated = 0 AND confidence >= ?
      ORDER BY success_rate DESC, confidence DESC
      LIMIT 10
    `).all(vulnerabilityType, minConfidence);

    if (fixes.length === 0) return null;
    if (!content) return fixes[0];

    // Rank by token-overlap with content
    const contentTokens = tokenize(content);
    let best = null;
    let bestScore = 0;

    for (const fix of fixes) {
      const beforeTokens = tokenize(fix.before_pattern);
      const score = overlapScore(contentTokens, beforeTokens);
      if (score > bestScore) {
        bestScore = score;
        best = fix;
      }
    }

    return best || fixes[0];
  }

  // ── Statistics ───────────────────────────────────────────────────────────

  function getMatcherStats() {
    return {
      cacheAge: Date.now() - cache.lastRefresh,
      cachedPatterns: cache.patterns.length,
      cachedHashes: cache.hashIndex.size,
      cachedFixTypes: cache.fixIndex.size,
      totalCachedFixes: [...cache.fixIndex.values()].reduce((sum, arr) => sum + arr.length, 0),
    };
  }

  // ── Helpers ──────────────────────────────────────────────────────────────

  function severityToAction(severity) {
    switch (severity) {
      case "critical": return MATCH_ACTIONS.BLOCK;
      case "high":     return MATCH_ACTIONS.BLOCK;
      case "medium":   return MATCH_ACTIONS.QUARANTINE;
      case "low":      return MATCH_ACTIONS.ALERT;
      default:         return MATCH_ACTIONS.ALLOW;
    }
  }

  // ── Public API ───────────────────────────────────────────────────────────

  return {
    scan,
    quickScan,
    findFix,
    refreshCache: () => cache.refresh(db),
    getMatcherStats,
    // Expose for testing
    _matchHash: matchHash,
    _matchSignatures: matchSignatures,
    _matchTokenOverlap: matchTokenOverlap,
    _matchEmbedding: matchEmbedding,
    _tokenize: tokenize,
    _overlapScore: overlapScore,
    _severityToAction: severityToAction,
    MATCH_ACTIONS,
  };
}
