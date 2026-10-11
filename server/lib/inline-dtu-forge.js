/**
 * Inline DTU Forge — Chat Artifact Creation Pipeline
 *
 * Any chat request that produces a deliverable asset triggers the forge.
 * Detection → Substrate Pull → Asset Generation → DTU Wrapping → Presentation.
 *
 * Core principle: Creation is free. Always. Unconditionally.
 * No rate limits. No daily caps. No credit consumption. No premium tiers.
 * The user asks, the system creates. Period.
 *
 * Revenue flows from:
 *   1. Licensing (enterprise/institutional)
 *   2. Concord Coin transaction fee (1.46% on every CC transfer)
 *   3. Marketplace transaction fee (4% on every DTU sale, creator keeps 96%)
 *
 * Integrates with:
 *   - chat-router.js (action type classification → forge trigger)
 *   - lens-manifest.js (lens chain resolution)
 *   - session-context-accumulator.js (substrate context)
 *   - dtu-format-constants.js (binary DTU format)
 *   - dtu-rights.js (rights/licensing)
 *   - dtu-integrity.js (content hashing)
 *   - lens-integration.js (DTU enrichment)
 */

import crypto from "crypto";
import { ACTION_TYPES, WRITE_ACTION_TYPES } from "./lens-manifest.js";
import { applyPrivateOwner } from "./dtu-read-access.js";

// ── Forge Detection ──────────────────────────────────────────────────────

/** Verbs that imply the user wants an artifact, not just information */
const FORGE_TRIGGER_PATTERNS = [
  /\b(make\s+me|create|write|build|generate|draft|design|compose|produce|record|draw|code|calculate|plan)\b/i,
  /\b(help\s+me\s+(write|create|make|build|draft|design|compose))\b/i,
  /\b(put\s+together|come\s+up\s+with|whip\s+up|throw\s+together)\b/i,
  /\b(give\s+me\s+a|i\s+need\s+a|can\s+you\s+make)\b/i,
];

/** Patterns that explicitly do NOT trigger forge (information requests) */
const NON_FORGE_PATTERNS = [
  /\b(explain|what\s+is|what\s+are|tell\s+me\s+about|how\s+does|why\s+does|define|describe)\b/i,
  /\b(show\s+me\s+how|teach\s+me|help\s+me\s+understand)\b/i,
  /^(who|when|where)\s/i,
];

/**
 * Detect whether a message should trigger the forge pipeline.
 *
 * @param {string} message - User message
 * @param {string} actionType - From chat router classification
 * @returns {{ shouldForge: boolean, reason: string }}
 */
export function detectForge(message, actionType) {
  const msg = String(message || "");

  // CREATE action type from router is a strong signal
  if (actionType === ACTION_TYPES.CREATE) {
    // But check for non-forge patterns (e.g., "explain how to create X")
    for (const pattern of NON_FORGE_PATTERNS) {
      if (pattern.test(msg)) {
        return { shouldForge: false, reason: "information_request" };
      }
    }
    return { shouldForge: true, reason: "create_action_type" };
  }

  // SIMULATE also produces artifacts
  if (actionType === ACTION_TYPES.SIMULATE) {
    return { shouldForge: true, reason: "simulate_action_type" };
  }

  // Check for forge trigger patterns even without CREATE classification
  for (const pattern of FORGE_TRIGGER_PATTERNS) {
    if (pattern.test(msg)) {
      // Verify not an info request
      let isInfoRequest = false;
      for (const np of NON_FORGE_PATTERNS) {
        if (np.test(msg)) { isInfoRequest = true; break; }
      }
      if (!isInfoRequest) {
        return { shouldForge: true, reason: "forge_verb_detected" };
      }
    }
  }

  return { shouldForge: false, reason: "no_forge_signal" };
}

// ── Output Format Detection ──────────────────────────────────────────────

/**
 * DTU primary type codes (from dtu-format-constants.js)
 */
export const PRIMARY_TYPES = Object.freeze({
  PLAY_AUDIO:        0x01,
  DISPLAY_IMAGE:     0x02,
  PLAY_VIDEO:        0x03,
  RENDER_DOCUMENT:   0x04,
  RENDER_CODE:       0x05,
  DISPLAY_RESEARCH:  0x06,
  DISPLAY_DATASET:   0x07,
  DISPLAY_3D_MODEL:  0x08,
  MIXED_CONTENT:     0x09,
  CONDENSED_KNOWLEDGE: 0x0A,
});

/**
 * Format detection patterns — maps request context to output format.
 */
const FORMAT_PATTERNS = [
  // Audio
  { patterns: [/\b(beat|song|remix|soundtrack|music|audio|track|melody|loop|sample)\b/i],
    primaryType: PRIMARY_TYPES.PLAY_AUDIO, format: "audio", extension: ".wav", label: "Audio" },

  // Image
  { patterns: [/\b(logo|poster|diagram|illustration|image|picture|graphic|icon|banner|thumbnail|sketch|drawing)\b/i],
    primaryType: PRIMARY_TYPES.DISPLAY_IMAGE, format: "image", extension: ".png", label: "Image" },

  // Video
  { patterns: [/\b(video|animation|clip|reel|motion)\b/i],
    primaryType: PRIMARY_TYPES.PLAY_VIDEO, format: "video", extension: ".mp4", label: "Video" },

  // Code
  { patterns: [/\b(app|script|function|tool|program|module|component|api|endpoint|bot|cli|plugin|extension)\b/i],
    primaryType: PRIMARY_TYPES.RENDER_CODE, format: "code", extension: ".js", label: "Code" },

  // Dataset / Spreadsheet
  { patterns: [/\b(spreadsheet|budget|forecast|model|dataset|table|csv|excel|numbers|financial\s+model)\b/i],
    primaryType: PRIMARY_TYPES.DISPLAY_DATASET, format: "dataset", extension: ".csv", label: "Dataset" },

  // Research / Paper
  { patterns: [/\b(paper|analysis|research\s+report|study|review|thesis|abstract|findings)\b/i],
    primaryType: PRIMARY_TYPES.DISPLAY_RESEARCH, format: "research", extension: ".md", label: "Research" },

  // Document (catch-all for text-based artifacts)
  { patterns: [/\b(contract|letter|report|plan|essay|policy|proposal|memo|brief|resume|cv|outline|template|guide|manual|playbook|checklist|agreement|lease|deed|will|permit|specification|whitepaper|presentation|pitch\s+deck|slides)\b/i],
    primaryType: PRIMARY_TYPES.RENDER_DOCUMENT, format: "document", extension: ".md", label: "Document" },
];

/**
 * Detect the output format from the user's request.
 *
 * @param {string} message - User message
 * @param {string[]} lensChain - Contributing lenses
 * @returns {{ primaryType, format, extension, label, ambiguous }}
 */
export function detectOutputFormat(message, lensChain = []) {
  const msg = String(message || "");
  const matches = [];

  for (const fp of FORMAT_PATTERNS) {
    for (const pattern of fp.patterns) {
      if (pattern.test(msg)) {
        matches.push(fp);
        break;
      }
    }
  }

  if (matches.length === 1) {
    return { ...matches[0], ambiguous: false };
  }

  if (matches.length > 1) {
    // Multiple matches — use lens chain to disambiguate
    if (lensChain.includes("studio") || lensChain.includes("music")) {
      const audio = matches.find(m => m.format === "audio");
      if (audio) return { ...audio, ambiguous: false };
    }
    if (lensChain.includes("code")) {
      const code = matches.find(m => m.format === "code");
      if (code) return { ...code, ambiguous: false };
    }
    // Still ambiguous — return primary match with flag
    return { ...matches[0], ambiguous: true, alternatives: matches.slice(1).map(m => m.label) };
  }

  // No match — default to document
  return {
    primaryType: PRIMARY_TYPES.RENDER_DOCUMENT,
    format: "document",
    extension: ".md",
    label: "Document",
    ambiguous: false,
  };
}

// ── Multi-Artifact Detection ─────────────────────────────────────────────

const MULTI_ARTIFACT_PATTERNS = [
  /\b(plan\s+my\s+\w+|full\s+package|complete\s+set|everything\s+for|all\s+the\s+documents)\b/i,
  /\b(and\s+also|plus\s+a|along\s+with|as\s+well\s+as|including\s+a)\b/i,
];

/**
 * Detect if a request implies multiple artifacts.
 *
 * @param {string} message
 * @returns {{ isMultiArtifact: boolean, estimatedCount: number }}
 */
export function detectMultiArtifact(message) {
  const msg = String(message || "");

  for (const pattern of MULTI_ARTIFACT_PATTERNS) {
    if (pattern.test(msg)) {
      // Estimate count from conjunctions
      const conjunctions = (msg.match(/\b(and|plus|also|along with|as well as|including)\b/gi) || []).length;
      return {
        isMultiArtifact: true,
        estimatedCount: Math.min(conjunctions + 2, 8),
      };
    }
  }

  return { isMultiArtifact: false, estimatedCount: 1 };
}

// ── Substrate Pull ───────────────────────────────────────────────────────

/**
 * Pull relevant DTUs from the user's personal substrate.
 * Their past work, domain knowledge, preferences, citation history.
 * This is what makes every artifact unique to the user.
 *
 * @param {Object} STATE - Server state
 * @param {string} userId - User ID
 * @param {string[]} domainSignals - From chat router
 * @param {number} limit - Max DTUs to pull
 * @returns {{ dtus: Object[], citationCount: number }}
 */
export function pullSubstrate(STATE, userId, domainSignals, limit = 20) {
  if (!STATE?.dtus || !userId) return { dtus: [], citationCount: 0 };

  const candidates = [];

  for (const [id, dtu] of STATE.dtus) {
    // Only pull from user's own substrate
    if (dtu.createdBy !== userId && dtu.source !== userId && dtu.ownerId !== userId) continue;

    // Score by domain signal overlap
    const dtuTags = new Set((dtu.tags || []).map(t => t.toLowerCase()));
    let relevance = 0;
    for (const signal of domainSignals) {
      if (dtuTags.has(signal.toLowerCase())) relevance++;
    }

    // Also check title/summary
    const text = `${dtu.title || ""} ${dtu.human?.summary || ""}`.toLowerCase();
    for (const signal of domainSignals) {
      if (text.includes(signal.toLowerCase())) relevance += 0.5;
    }

    if (relevance > 0) {
      candidates.push({ dtu, relevance });
    }
  }

  candidates.sort((a, b) => b.relevance - a.relevance);
  const dtus = candidates.slice(0, limit).map(c => c.dtu);

  return {
    dtus,
    citationCount: dtus.length,
  };
}

// ── DTU Wrapping ─────────────────────────────────────────────────────────

/**
 * Wrap a generated asset into a DTU.
 *
 * @param {Object} opts
 * @param {string} opts.title - DTU title
 * @param {string} opts.content - Generated content
 * @param {number} opts.primaryType - DTU primary type code
 * @param {string} opts.format - Format identifier
 * @param {string} opts.userId - Creator ID
 * @param {string[]} opts.sourceLenses - Lenses that contributed
 * @param {string[]} opts.substrateCitations - IDs of substrate DTUs used
 * @param {string[]} opts.domainTags - Domain tags
 * @param {string} opts.actionType - Router action type
 * @returns {Object} DTU object
 */
export function wrapAsDTU(opts) {
  const now = new Date().toISOString();
  const id = `forge_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`;

  const dtu = {
    id,
    title: opts.title || "Forged Artifact",
    tier: "regular",
    scope: "local",
    source: "forge",
    createdBy: opts.userId || "anonymous",
    ownerId: opts.userId || "anonymous",
    createdAt: now,
    updatedAt: now,

    tags: [
      "forged", "chat-created",
      ...(opts.sourceLenses || []).map(l => `lens:${l}`),
      ...(opts.domainTags || []).slice(0, 10),
    ],

    // Human-readable layer
    human: {
      summary: (opts.content || "").slice(0, 300),
      bullets: [],
    },

    // Core knowledge layer
    core: {
      claims: [],
      definitions: [],
      invariants: [],
      examples: [],
    },

    // Machine layer
    machine: {
      kind: opts.format || "document",
      primaryType: opts.primaryType || PRIMARY_TYPES.RENDER_DOCUMENT,
      forgeMetadata: {
        actionType: opts.actionType || "CREATE",
        sourceLenses: opts.sourceLenses || [],
        substrateCitationCount: (opts.substrateCitations || []).length,
        generatedAt: now,
      },
    },

    // Artifact layer — the actual content
    artifact: {
      type: opts.format || "document",
      content: opts.content || "",
      extension: opts.extension || ".md",
      size: (opts.content || "").length,
      generated: true,
    },

    // Lineage
    lineage: {
      parents: opts.substrateCitations || [],
      children: [],
      forgeChain: opts.sourceLenses || [],
    },

    // Initial CRETI (populated properly later)
    creti: {
      credibility: 10,
      relevance: 10,
      evidence: Math.min((opts.substrateCitations || []).length * 3, 18),
      timeliness: 18,
      impact: 0,
    },

    // Forge-specific metadata
    meta: {
      forged: true,
      forgeVersion: 1,
      iterationCount: 0,
      parentVersion: null,
    },
  };

  // Content hash for integrity
  try {
    dtu.hash = crypto.createHash("sha256").update(opts.content || "").digest("hex").slice(0, 32);
  } catch {
    dtu.hash = `hash_${Date.now().toString(36)}`;
  }

  // Keep scope "local". Visibility private so a forged artifact that
  // contains the user's request is not an anonymous-readable DTU.
  applyPrivateOwner(dtu, opts.userId);

  return dtu;
}

// ── Forge Pipeline ───────────────────────────────────────────────────────

/**
 * Full forge pipeline. Called when a forge-worthy request is detected.
 *
 * Steps:
 *   1. Intent resolution (already done by chat router)
 *   2. Substrate pull
 *   3. Asset generation (delegated to caller — needs LLM)
 *   4. DTU wrapping
 *   5. Presentation metadata
 *
 * This function handles steps 2, 4, 5.
 * Step 3 is async and requires LLM access, so the caller provides the content.
 *
 * @param {Object} opts
 * @param {string} opts.message - User message
 * @param {Object} opts.route - From chatRouter.routeMessage()
 * @param {string} opts.generatedContent - The LLM-generated artifact content
 * @param {string} opts.title - Artifact title (auto-generated or from request)
 * @param {string} opts.userId - Creator ID
 * @param {Object} opts.STATE - Server state
 * @returns {ForgePipelineResult}
 */
export function runForgePipeline(opts) {
  const {
    message, route, generatedContent, title, userId, STATE,
  } = opts;

  // Step 2: Substrate pull
  const substrate = pullSubstrate(
    STATE,
    userId,
    route?.domainSignals || [],
    20
  );

  // Step 4: Detect output format
  const lensChain = (route?.lenses || []).map(l => l.lensId || l);
  const format = detectOutputFormat(message, lensChain);

  // Step 4: DTU wrapping
  const dtu = wrapAsDTU({
    title: title || deriveTitle(message),
    content: generatedContent,
    primaryType: format.primaryType,
    format: format.format,
    extension: format.extension,
    userId,
    sourceLenses: lensChain,
    substrateCitations: substrate.dtus.map(d => d.id),
    domainTags: route?.domainSignals || [],
    actionType: route?.actionType || ACTION_TYPES.CREATE,
  });

  // Step 5: Presentation metadata
  const presentation = {
    type: "forge_card",
    title: dtu.title,
    format: format.label,
    primaryType: format.primaryType,
    preview: generatePreview(generatedContent, format.format),
    sourceLenses: lensChain.map(l => capitalize(l)),
    cretiScore: Math.round(
      (dtu.creti.credibility + dtu.creti.relevance + dtu.creti.evidence +
       dtu.creti.timeliness + dtu.creti.impact) / 5
    ),
    substrateCitationCount: substrate.citationCount,
    formatAmbiguous: format.ambiguous || false,
    alternatives: format.alternatives || [],
  };

  // Multi-artifact detection
  const multi = detectMultiArtifact(message);

  return {
    ok: true,
    dtu,
    presentation,
    substrate: {
      citationCount: substrate.citationCount,
      dtuIds: substrate.dtus.map(d => d.id).slice(0, 10),
    },
    isMultiArtifact: multi.isMultiArtifact,
    estimatedArtifactCount: multi.estimatedCount,
    actions: {
      save: { available: true, description: "Save to your substrate" },
      delete: { available: true, description: "Discard completely" },
      saveAndList: { available: true, description: "Save and list on marketplace" },
      iterate: { available: true, description: "Request changes" },
    },
  };
}

// ── Iteration ────────────────────────────────────────────────────────────

/**
 * Apply an iteration to an existing forged DTU.
 * Doesn't regenerate from scratch — loads existing, applies edit.
 *
 * @param {Object} existingDtu - The DTU to iterate on
 * @param {string} editInstruction - What to change
 * @param {string} newContent - The regenerated/edited content
 * @param {boolean} alreadySaved - If true, creates a new version with parent pointer
 * @returns {Object} Updated or new DTU
 */
export function iterateForge(existingDtu, editInstruction, newContent, alreadySaved = false) {
  const now = new Date().toISOString();

  if (alreadySaved) {
    // Create version 2 as a new DTU with parent pointer
    const newId = `forge_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`;
    return {
      ...existingDtu,
      id: newId,
      artifact: {
        ...existingDtu.artifact,
        content: newContent,
        size: newContent.length,
      },
      updatedAt: now,
      lineage: {
        ...existingDtu.lineage,
        parents: [...(existingDtu.lineage?.parents || []), existingDtu.id],
      },
      meta: {
        ...existingDtu.meta,
        iterationCount: (existingDtu.meta?.iterationCount || 0) + 1,
        parentVersion: existingDtu.id,
        editInstruction: editInstruction.slice(0, 200),
      },
      human: {
        ...existingDtu.human,
        summary: newContent.slice(0, 300),
      },
    };
  }

  // Not saved yet — update in place
  existingDtu.artifact.content = newContent;
  existingDtu.artifact.size = newContent.length;
  existingDtu.updatedAt = now;
  existingDtu.meta.iterationCount = (existingDtu.meta?.iterationCount || 0) + 1;
  existingDtu.meta.lastEditInstruction = editInstruction.slice(0, 200);
  existingDtu.human.summary = newContent.slice(0, 300);

  return existingDtu;
}

// ── Save / Delete / List ─────────────────────────────────────────────────

/**
 * Save a forged DTU to the user's substrate.
 *
 * @param {Object} STATE - Server state
 * @param {Object} dtu - The forged DTU
 * @returns {{ ok, dtuId }}
 */
export function saveForgedDTU(STATE, dtu) {
  if (!STATE?.dtus || !dtu?.id) return { ok: false, error: "invalid_state_or_dtu" };

  // Commit to canonical DTU store
  dtu.meta.savedAt = new Date().toISOString();
  dtu.meta.forged = true;
  STATE.dtus.set(dtu.id, dtu);

  return { ok: true, dtuId: dtu.id };
}

/**
 * Delete a forged DTU completely.
 * No tombstone. No trace. Clean deletion.
 *
 * @param {Object} STATE - Server state
 * @param {string} dtuId - The DTU to delete
 * @returns {{ ok }}
 */
export function deleteForgedDTU(STATE, dtuId) {
  if (!STATE?.dtus) return { ok: false, error: "invalid_state" };

  const dtu = STATE.dtus.get(dtuId);
  if (!dtu) return { ok: false, error: "not_found" };

  // Only allow deletion of unsaved forged DTUs
  if (!dtu.meta?.forged) return { ok: false, error: "not_a_forged_dtu" };

  STATE.dtus.delete(dtuId);
  return { ok: true };
}

/**
 * Save and immediately list on marketplace.
 *
 * @param {Object} STATE - Server state
 * @param {Object} dtu - The forged DTU
 * @param {Object} listingOpts - Marketplace listing options
 * @returns {{ ok, dtuId, listingId }}
 */
export function saveAndList(STATE, dtu, listingOpts = {}) {
  const saveResult = saveForgedDTU(STATE, dtu);
  if (!saveResult.ok) return saveResult;

  // The marketplace listing is handled by the existing marketplace macros
  // We just return the data needed to trigger it
  return {
    ok: true,
    dtuId: dtu.id,
    readyForListing: true,
    suggestedPrice: listingOpts.price || null,
    category: dtu.machine?.kind || "document",
    title: dtu.title,
  };
}

// ── Emergent Contribution Tracking ───────────────────────────────────────

/**
 * Record that an emergent entity contributed to a forged artifact.
 * The emergent earns insight credits and is included in lineage.
 *
 * @param {Object} dtu - The forged DTU
 * @param {string} emergentId - The contributing emergent
 * @param {string} contribution - What they contributed
 * @returns {Object} Updated DTU
 */
export function recordEmergentContribution(dtu, emergentId, contribution) {
  if (!dtu.lineage) dtu.lineage = {};
  if (!dtu.lineage.emergentContributors) dtu.lineage.emergentContributors = [];

  dtu.lineage.emergentContributors.push({
    emergentId,
    contribution: String(contribution).slice(0, 200),
    contributedAt: new Date().toISOString(),
  });

  // Tag for royalty cascade inclusion
  if (!dtu.tags) dtu.tags = [];
  dtu.tags.push(`emergent:${emergentId}`);

  return dtu;
}

// ── Helpers ──────────────────────────────────────────────────────────────

function deriveTitle(message) {
  const msg = String(message || "").trim();

  // Remove trigger verbs to get the actual subject
  const cleaned = msg
    .replace(/^(make\s+me\s+a?|create\s+a?|write\s+a?|build\s+a?|generate\s+a?|draft\s+a?|design\s+a?|compose\s+a?|help\s+me\s+(write|create|make|build)\s+a?)\s*/i, "")
    .trim();

  if (cleaned.length > 0) {
    return capitalize(cleaned.slice(0, 80));
  }

  return "Generated Artifact";
}

function generatePreview(content, format) {
  const text = String(content || "");

  switch (format) {
    case "code":
      // Show first meaningful lines of code
      return text.split("\n").filter(l => l.trim()).slice(0, 8).join("\n");
    case "audio":
      return "[Audio waveform preview]";
    case "image":
      return "[Image thumbnail preview]";
    case "video":
      return "[Video frame preview]";
    case "dataset":
      return text.split("\n").slice(0, 5).join("\n");
    case "research":
    case "document":
    default:
      return text.slice(0, 500);
  }
}

function capitalize(s) {
  return s ? s.charAt(0).toUpperCase() + s.slice(1) : "";
}

// ── Metrics ──────────────────────────────────────────────────────────────

const _forgeMetrics = {
  forgeCount: 0,
  saveCount: 0,
  deleteCount: 0,
  listCount: 0,
  iterationCount: 0,
  multiArtifactCount: 0,
  emergentContributions: 0,
  formatDistribution: {},
};

export function recordForgeMetric(type, format) {
  if (type in _forgeMetrics) _forgeMetrics[type]++;
  if (format && type === "forgeCount") {
    _forgeMetrics.formatDistribution[format] =
      (_forgeMetrics.formatDistribution[format] || 0) + 1;
  }
}

export function getForgeMetrics() {
  return { ok: true, version: "1.0.0", metrics: { ..._forgeMetrics } };
}
