/**
 * Content Guard — Illegal Content Blocking Layer
 *
 * Non-negotiable pre-storage content moderation. Runs before ANY user-generated
 * content is persisted. Five block categories + four flag categories.
 *
 * Block Categories (instant 403, no storage):
 *   1. CSAM / child exploitation — zero tolerance, instant ban, NCMEC report
 *   2. Direct threats of violence — credible specific threats
 *   3. Terrorism content — recruitment, instructional, propaganda
 *   4. Non-consensual intimate imagery — revenge porn, deepfakes
 *   5. Illegal drug sales — direct solicitation
 *
 * Flag Categories (store but flag for review):
 *   - Hate speech (context-dependent)
 *   - Graphic violence (news vs glorification)
 *   - Misinformation (hard to automate)
 *   - Copyright claims (needs human review)
 *
 * Architecture:
 *   Layer 1: Deterministic keyword/pattern matching (fast, covers 90%)
 *   Layer 2: Utility brain classification (ambiguous content only)
 *   Layer 3: LLaVA vision scan on uploaded images
 *
 * Every blocked attempt → security DTU (timestamp, userId, content hash, category, action)
 * Banned accounts → is_active=0, all sessions revoked, email blocked from re-registration
 */

import { createHash } from "crypto";

// ── Block Categories ───────────────────────────────────────────────────────

export const BLOCK_CATEGORIES = Object.freeze({
  CSAM:           "csam",
  VIOLENCE_THREAT: "violence_threat",
  TERRORISM:      "terrorism",
  NCII:           "non_consensual_intimate_imagery",
  DRUG_SALES:     "illegal_drug_sales",
});

export const FLAG_CATEGORIES = Object.freeze({
  HATE_SPEECH:    "hate_speech",
  GRAPHIC_VIOLENCE: "graphic_violence",
  MISINFORMATION: "misinformation",
  COPYRIGHT:      "copyright",
});

// ── Keyword Patterns (Layer 1 — Deterministic) ────────────────────────────
// These are intentionally broad for safety. False positives go to flag-for-review.
// Context-sensitive terms use word boundaries to reduce noise.

const BLOCK_PATTERNS = {
  [BLOCK_CATEGORIES.CSAM]: [
    // Unambiguous CSAM indicators — zero false-positive tolerance
    /\b(?:child|minor|underage|preteen|pre-teen)\b.*\b(?:porn|nude|naked|sexual|exploit|abuse)\b/i,
    /\b(?:porn|nude|naked|sexual|exploit|abuse)\b.*\b(?:child|minor|underage|preteen|pre-teen)\b/i,
    /\b(?:cp|jailbait|pedo|paedo|pedoph)\b/i,
    /\b(?:loli|lolita|shota)\b.*\b(?:hentai|nsfw|porn|nude|lewd)\b/i,
    /\b(?:hentai|nsfw|porn|nude|lewd)\b.*\b(?:loli|lolita|shota)\b/i,
  ],
  [BLOCK_CATEGORIES.VIOLENCE_THREAT]: [
    // Credible specific threats against identified targets
    /\bi(?:'m going to|will|gonna|wanna|want to)\s+(?:kill|shoot|stab|murder|bomb|assassinate)\s+/i,
    /\b(?:bomb|shoot(?:ing)?|attack)\s+(?:the|a|that)\s+(?:school|church|mosque|synagogue|temple|hospital|airport|mall|stadium|concert)\b/i,
    /\b(?:pipe bomb|pressure cooker bomb|car bomb|suicide bomb|vest bomb)\b/i,
    /\bhit\s*list\b.*\b(?:name|target|kill)\b/i,
  ],
  [BLOCK_CATEGORIES.TERRORISM]: [
    // Recruitment and instructional terrorism content
    /\b(?:join|recruit|pledge|swear allegiance)\b.*\b(?:isis|isil|al.?qaeda|boko.?haram|hezbollah|hamas)\b/i,
    /\b(?:isis|isil|al.?qaeda|boko.?haram)\b.*\b(?:join|recruit|pledge|fight for|die for)\b/i,
    /\bhow to (?:make|build|assemble)\b.*\b(?:bomb|explosive|ied|nerve agent|chemical weapon|biological weapon)\b/i,
    /\b(?:bomb|explosive|ied)\b.*\b(?:instruction|tutorial|guide|how.?to|manual|recipe)\b/i,
    /\b(?:manifesto|call to arms|jihad|holy war)\b.*\b(?:attack|strike|destroy|infidel|crusade)\b/i,
  ],
  [BLOCK_CATEGORIES.NCII]: [
    // Non-consensual intimate imagery
    /\b(?:revenge porn|leaked nudes|stolen nudes|ex.?(?:gf|bf|girlfriend|boyfriend|wife|husband))\b.*\b(?:nude|naked|sex tape|intimate)\b/i,
    /\b(?:deepfake)\b.*\b(?:porn|nude|naked|sex|nsfw)\b/i,
    /\b(?:porn|nude|naked|sex|nsfw)\b.*\b(?:deepfake)\b/i,
    /\b(?:hidden camera|spy cam|voyeur)\b.*\b(?:nude|naked|shower|bathroom|bedroom|changing)\b/i,
  ],
  [BLOCK_CATEGORIES.DRUG_SALES]: [
    // Direct drug sales solicitation
    /\b(?:buy|sell|order|ship|deliver)\b.*\b(?:cocaine|heroin|fentanyl|meth(?:amphetamine)?|crack|ecstasy|mdma|lsd|ketamine|ghb)\b/i,
    /\b(?:cocaine|heroin|fentanyl|meth(?:amphetamine)?|crack)\b.*\b(?:for sale|selling|buy|order|ship|deliver|price|gram|kilo|ounce)\b/i,
    /\b(?:darknet|dark web|silk road)\b.*\b(?:order|buy|vendor|listing|shop)\b/i,
  ],
};

const FLAG_PATTERNS = {
  [FLAG_CATEGORIES.HATE_SPEECH]: [
    /\b(?:kill all|death to|exterminate|genocide)\s+\b(?:\w+)\b/i,
    /\b(?:subhuman|untermensch|inferior race|race war|white power|master race|ethnic cleansing)\b/i,
  ],
  [FLAG_CATEGORIES.GRAPHIC_VIOLENCE]: [
    /\b(?:gore|snuff|execution video|beheading video|torture video)\b/i,
    /\b(?:watch.*die|watch.*killed|watch.*executed)\b/i,
  ],
  [FLAG_CATEGORIES.MISINFORMATION]: [
    // Very selective — only the most dangerous health misinformation
    /\b(?:bleach|ivermectin|turpentine)\b.*\b(?:cure|treat|heal)\b.*\b(?:cancer|covid|hiv|aids)\b/i,
  ],
  [FLAG_CATEGORIES.COPYRIGHT]: [
    /\b(?:full (?:movie|album|book|game) (?:download|free|torrent|crack))\b/i,
    /\b(?:pirated|warez|cracked|keygen)\b.*\b(?:download|link|torrent)\b/i,
  ],
};

// ── Username Patterns ──────────────────────────────────────────────────────

const BLOCKED_USERNAME_PATTERNS = [
  /(?:pedo|paedo|pedoph|csam|jailbait)/i,
  /(?:isis|alqaeda|taliban).*(?:fighter|warrior|soldier)/i,
];

// ── Core Scanning Functions ────────────────────────────────────────────────

/**
 * Scan text content for illegal/prohibited material.
 * Returns block result if any Category 1-5 pattern matches.
 * Returns flag result if any flag pattern matches.
 *
 * @param {string} text - Content to scan
 * @returns {{ blocked: boolean, flagged: boolean, category?: string, action: string, matches: Object[] }}
 */
export function scanText(text) {
  if (!text || typeof text !== "string") {
    return { blocked: false, flagged: false, action: "allow", matches: [] };
  }

  const matches = [];

  // Layer 1: Check block patterns (Categories 1-5)
  for (const [category, patterns] of Object.entries(BLOCK_PATTERNS)) {
    for (const pattern of patterns) {
      if (pattern.test(text)) {
        matches.push({ category, type: "block", pattern: pattern.source });
        // Reset regex lastIndex
        pattern.lastIndex = 0;
      }
    }
  }

  if (matches.length > 0) {
    // Return the most severe category
    const severity = [
      BLOCK_CATEGORIES.CSAM,
      BLOCK_CATEGORIES.VIOLENCE_THREAT,
      BLOCK_CATEGORIES.TERRORISM,
      BLOCK_CATEGORIES.NCII,
      BLOCK_CATEGORIES.DRUG_SALES,
    ];
    const primaryCategory = severity.find(c => matches.some(m => m.category === c)) || matches[0].category;

    return {
      blocked: true,
      flagged: false,
      category: primaryCategory,
      action: "block",
      severity: primaryCategory === BLOCK_CATEGORIES.CSAM ? "critical" : "high",
      matches,
    };
  }

  // Layer 1b: Check flag patterns
  const flagMatches = [];
  for (const [category, patterns] of Object.entries(FLAG_PATTERNS)) {
    for (const pattern of patterns) {
      if (pattern.test(text)) {
        flagMatches.push({ category, type: "flag", pattern: pattern.source });
        pattern.lastIndex = 0;
      }
    }
  }

  if (flagMatches.length > 0) {
    return {
      blocked: false,
      flagged: true,
      category: flagMatches[0].category,
      action: "flag",
      severity: "medium",
      matches: flagMatches,
    };
  }

  return { blocked: false, flagged: false, action: "allow", matches: [] };
}

/**
 * Scan a username for prohibited patterns.
 *
 * @param {string} username
 * @returns {{ blocked: boolean, reason?: string }}
 */
export function scanUsername(username) {
  if (!username || typeof username !== "string") return { blocked: false };
  for (const pattern of BLOCKED_USERNAME_PATTERNS) {
    if (pattern.test(username)) {
      return { blocked: true, reason: "prohibited_username" };
    }
  }
  return { blocked: false };
}

// ── Image Moderation (LLaVA) ───────────────────────────────────────────────

/**
 * Build the LLaVA vision prompt for image safety classification.
 */
export function buildImageModerationPrompt() {
  return `Analyze this image for content safety. Classify it as one of:
SAFE - No concerning content
UNSAFE:CSAM - Contains or suggests child exploitation or minors in sexual/inappropriate context
UNSAFE:VIOLENCE - Contains graphic violence or credible threats
UNSAFE:TERRORISM - Contains terrorism recruitment or propaganda
UNSAFE:NCII - Contains non-consensual intimate imagery
UNSAFE:NUDITY - Contains adult nudity (may be acceptable in art context)
UNSAFE:DRUGS - Depicts illegal drug sales or manufacturing

Respond with ONLY the classification label (e.g., "SAFE" or "UNSAFE:CSAM") followed by a one-sentence explanation.`;
}

/**
 * Parse LLaVA vision response into a moderation result.
 *
 * @param {string} response - LLaVA model response
 * @returns {{ safe: boolean, category?: string, explanation: string, shouldBlock: boolean }}
 */
export function parseImageModerationResponse(response) {
  if (!response || typeof response !== "string") {
    return { safe: false, category: "parse_error", explanation: "No response from vision model", shouldBlock: false };
  }

  const upper = response.toUpperCase().trim();

  if (upper.startsWith("SAFE")) {
    return { safe: true, explanation: response.slice(4).trim(), shouldBlock: false };
  }

  const unsafeMatch = upper.match(/^UNSAFE[:\s]+(\w+)/);
  if (unsafeMatch) {
    const category = unsafeMatch[1].toLowerCase();
    const explanation = response.slice(unsafeMatch[0].length).trim();

    // CSAM is always instant block
    if (category === "csam") {
      return { safe: false, category: "csam", explanation, shouldBlock: true, instantBan: true };
    }
    // Violence, terrorism, NCII are block
    if (["violence", "terrorism", "ncii"].includes(category)) {
      return { safe: false, category, explanation, shouldBlock: true };
    }
    // Nudity and drugs are flag-for-review
    return { safe: false, category, explanation, shouldBlock: false };
  }

  // Ambiguous response — flag for review
  return { safe: false, category: "ambiguous", explanation: response.slice(0, 200), shouldBlock: false };
}

// ── Account Banning ────────────────────────────────────────────────────────

/**
 * Ban a user account. Sets is_active=0, revokes all sessions, records the ban.
 *
 * @param {Object} db - Database handle
 * @param {Object} tokenBlacklist - Token blacklist with revokeAllForUser()
 * @param {string} userId - User to ban
 * @param {string} reason - Reason for ban
 * @param {string} category - Block category that triggered the ban
 * @returns {{ ok: boolean, banned?: boolean }}
 */
export function banAccount(db, tokenBlacklist, userId, reason, category) {
  if (!db || !userId) return { ok: false, error: "db and userId required" };

  try {
    // Deactivate account
    db.prepare("UPDATE users SET is_active = 0 WHERE id = ?").run(userId);
    globalThis.__concordBustUserCache?.(userId); // ban takes effect immediately, not after the 5s TTL

    // Record ban reason and category
    try {
      db.prepare(`
        INSERT INTO security_events (event_type, target, target_type, severity, result, details)
        VALUES ('scan_detection', ?, 'user', 'critical', 'blocked', ?)
      `).run(userId, JSON.stringify({ action: "account_banned", reason, category, bannedAt: new Date().toISOString() }));
    } catch (_) { /* security_events table may not exist yet */ }

    // Revoke all sessions
    if (tokenBlacklist?.revokeAllForUser) {
      tokenBlacklist.revokeAllForUser(userId);
    }

    // Revoke all API keys
    try {
      db.prepare("UPDATE api_keys SET is_active = 0 WHERE user_id = ?").run(userId);
    } catch (_) { /* api_keys table may not exist */ }

    return { ok: true, banned: true };
  } catch (e) {
    return { ok: false, error: e.message };
  }
}

/**
 * Check if an email is banned (belongs to a deactivated account).
 *
 * @param {Object} db - Database handle
 * @param {string} email - Email to check
 * @returns {boolean}
 */
export function isEmailBanned(db, email) {
  if (!db || !email) return false;
  try {
    const row = db.prepare("SELECT id FROM users WHERE email = ? AND is_active = 0").get(email);
    return Boolean(row);
  } catch (_) {
    return false;
  }
}

// ── Security DTU Creation ──────────────────────────────────────────────────

/**
 * Create a security DTU for a blocked content attempt.
 * Stores metadata ONLY — never the actual content.
 *
 * @param {Object} STATE - Server state
 * @param {Object} opts
 * @returns {Object} The security DTU
 */
export function createModerationDTU(STATE, opts = {}) {
  const now = new Date().toISOString();
  const id = `mod_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`;
  const contentHash = opts.content ? createHash("sha256").update(opts.content).digest("hex").slice(0, 16) : "n/a";

  const dtu = {
    id,
    type: "MODERATION_ACTION",
    tier: "regular",
    scope: "local",
    tags: ["moderation", "security", "pain_memory", opts.category || "unknown"],

    // Metadata only — NEVER store the actual content
    moderationData: {
      action: opts.action || "blocked",
      category: opts.category || "unknown",
      contentHash,
      contentType: opts.contentType || "text",
      userId: opts.userId || "anonymous",
      ip: opts.ip || "unknown",
      path: opts.path || "unknown",
      severity: opts.severity || "high",
      matches: (opts.matches || []).length,
    },

    human: {
      summary: `Content ${opts.action || "blocked"}: ${opts.category || "unknown"} violation by ${opts.userId || "anonymous"}`,
    },
    meta: { createdAt: now },
    createdAt: now,
    createdBy: "content_guard",
    ownerId: "system",
  };

  // Store in lattice
  if (STATE?.dtus) {
    STATE.dtus.set(id, dtu);
  }

  return dtu;
}

// ── NCMEC Reporting Stub ───────────────────────────────────────────────────

/**
 * Queue a NCMEC (National Center for Missing & Exploited Children) report.
 * In production, this would submit to the NCMEC CyberTipline API.
 * For now, logs to security events and creates a critical DTU.
 *
 * @param {Object} db - Database handle
 * @param {Object} STATE - Server state
 * @param {Object} opts - Report details
 * @returns {{ ok: boolean, reportId: string }}
 */
export function queueNcmecReport(db, STATE, opts = {}) {
  const reportId = `ncmec_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`;
  const now = new Date().toISOString();

  const report = {
    reportId,
    userId: opts.userId || "unknown",
    contentHash: opts.contentHash || "n/a",
    contentType: opts.contentType || "text",
    detectionMethod: opts.detectionMethod || "keyword_pattern",
    timestamp: now,
    status: "queued",
    // NCMEC CyberTipline fields (to be filled when API integration is added)
    incidentType: "online_enticement", // or "child_pornography", "child_sex_trafficking"
    reporterInfo: {
      reportingEntity: "Concord Cognitive Engine",
      reportType: "automated_detection",
    },
  };

  // Log to security events
  if (db) {
    try {
      db.prepare(`
        INSERT INTO security_events (event_type, target, target_type, severity, result, details)
        VALUES ('scan_detection', ?, 'ncmec_report', 'critical', 'escalated', ?)
      `).run(opts.userId || "unknown", JSON.stringify(report));
    } catch (_) { /* table may not exist */ }
  }

  // Create critical moderation DTU
  createModerationDTU(STATE, {
    action: "ncmec_report_queued",
    category: "csam",
    userId: opts.userId,
    contentHash: opts.contentHash,
    contentType: opts.contentType,
    severity: "critical",
  });

  // In production: submit to NCMEC CyberTipline API
  // https://report.cybertip.org/ispws/documentation
  // For now, this is logged for manual submission

  return { ok: true, reportId, status: "queued" };
}

// ── Auto-Hide on Multiple Reports ──────────────────────────────────────────

/**
 * Check if content should be auto-hidden based on report count.
 * Auto-hides when 3+ distinct reporters flag the same content.
 *
 * @param {Object} STATE - Server state
 * @param {string} contentId - Content to check
 * @returns {{ hidden: boolean, reportCount: number }}
 */
export function checkAutoHide(STATE, contentId) {
  const mod = STATE?._moderation;
  if (!mod) return { hidden: false, reportCount: 0 };

  // Count distinct reporters for this content
  const reporters = new Set();
  for (const report of mod.reports.values()) {
    if (report.contentId === contentId && report.reporterId !== "system") {
      reporters.add(report.reporterId);
    }
  }

  const reportCount = reporters.size;
  if (reportCount >= 3) {
    // Auto-hide: mark content as restricted
    if (STATE.dtus?.has(contentId)) {
      const dtu = STATE.dtus.get(contentId);
      if (dtu.moderationStatus !== "removed") {
        dtu.moderationStatus = "auto_hidden";
        dtu.updatedAt = new Date().toISOString();
      }
    }
    if (STATE._media?.mediaDTUs?.has(contentId)) {
      const media = STATE._media.mediaDTUs.get(contentId);
      if (media.moderationStatus !== "removed") {
        media.moderationStatus = "auto_hidden";
        media.privacy = "private";
        media.updatedAt = new Date().toISOString();
      }
    }
    return { hidden: true, reportCount };
  }

  return { hidden: false, reportCount };
}

// ── Drug Sales Offense Tracking ────────────────────────────────────────────

/**
 * Track drug sales offenses per user. Warning on first, ban on second.
 *
 * @param {Object} STATE - Server state
 * @param {string} userId - User ID
 * @returns {{ action: "warn"|"ban", offenseCount: number }}
 */
export function trackDrugSalesOffense(STATE, userId) {
  const mod = STATE?._moderation;
  if (!mod) return { action: "warn", offenseCount: 1 };

  if (!mod.userStrikes.has(userId)) {
    mod.userStrikes.set(userId, { count: 0, strikes: [], drugOffenses: 0 });
  }

  const record = mod.userStrikes.get(userId);
  record.drugOffenses = (record.drugOffenses || 0) + 1;

  if (record.drugOffenses >= 2) {
    return { action: "ban", offenseCount: record.drugOffenses };
  }
  return { action: "warn", offenseCount: record.drugOffenses };
}
