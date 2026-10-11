/**
 * Conversation Memory — Rolling Window DTU Compression
 *
 * When a conversation exceeds WINDOW_THRESHOLD messages, the oldest
 * COMPRESSION_BATCH messages are extracted, analyzed by the Utility brain,
 * and compressed into structured "conversation_memory" DTUs — NOT summaries,
 * but real knowledge units with insights, decisions, claims, topics, and tone.
 *
 * These DTUs enter the user's lattice and get pulled back by the context
 * engine when semantically relevant — even across sessions.
 *
 * The active context window stays fixed at ACTIVE_WINDOW messages.
 * Knowledge grows forever. Context window never grows. Speed stays constant.
 *
 * Consolidation ladder:
 *   - Regular conversation DTUs accumulate per topic
 *   - After enough cluster on one topic → MEGA conversation DTU
 *   - After enough MEGAs → HYPER (everything user has discussed about X)
 *
 * Integrates with:
 *   - conversation-summarizer.js (running summary, still used for fast context)
 *   - conversation-enrichment.js (per-message shadow DTUs)
 *   - token-budget-assembler.js (conversation DTUs enter the budget)
 *   - chat.respond macro (triggers rolling window check)
 */

import crypto from "crypto";
import { BRAIN_CONFIG } from "./brain-config.js";
import { applyPrivateOwner, realDtuOwnerId } from "./dtu-read-access.js";

function memoryOwnerId(dtu) {
  return realDtuOwnerId(dtu?.ownerId)
    || realDtuOwnerId(dtu?.author)
    || realDtuOwnerId(dtu?.userId)
    || realDtuOwnerId(dtu?.createdBy)
    || realDtuOwnerId(dtu?.machine?.userId);
}

// ── Constants ────────────────────────────────────────────────────────────────

/** Active window: always keep this many recent messages in session */
export const ACTIVE_WINDOW = 30;

/** When message count reaches this, trigger compression */
export const WINDOW_THRESHOLD = 50;

/** Number of oldest messages to compress per cycle */
export const COMPRESSION_BATCH = 20;

/** Max conversation memory DTUs per session before consolidation.
 *  Bumped 50 → 500 for 32GB-heap deployments — long sessions can keep
 *  more raw memory before consolidating into MEGA tier. */
export const MAX_MEMORY_DTUS_PER_SESSION = Number(process.env.CONCORD_CONVERSATION_DTUS_PER_SESSION) || 500;

/** Minimum conversation memory DTUs on a topic before MEGA promotion */
export const MEGA_TOPIC_THRESHOLD = 5;

/** Minimum MEGAs on a topic before HYPER promotion */
export const HYPER_MEGA_THRESHOLD = 3;

// ── Rolling Window Check ────────────────────────────────────────────────────

/**
 * Check if a session needs rolling window compression.
 *
 * @param {Object} sess - Session object from STATE.sessions
 * @returns {boolean}
 */
export function needsWindowCompression(sess) {
  if (!sess || !sess.messages) return false;
  return sess.messages.length >= WINDOW_THRESHOLD;
}

// ── Compression Engine ──────────────────────────────────────────────────────

/**
 * Compress the oldest COMPRESSION_BATCH messages from a session into
 * structured conversation memory DTUs, then trim the session window.
 *
 * @param {Object} STATE - Global server state
 * @param {string} sessionId - Session ID
 * @param {Object} [opts]
 * @param {Function} [opts.structuredLog] - Logging function
 * @param {string} [opts.userId] - User ID for tagging
 * @returns {Promise<{ ok: boolean, dtusCreated?: number, messagesCompressed?: number, error?: string }>}
 */
export async function compressRollingWindow(STATE, sessionId, opts = {}) {
  const log = opts.structuredLog || (() => {});
  const sess = STATE.sessions.get(sessionId);

  if (!sess || !sess.messages || sess.messages.length < WINDOW_THRESHOLD) {
    return { ok: false, error: "below_threshold" };
  }

  // Prompt text is about to be copied into a shared DTU. Without a real
  // owner that row is anonymous-readable, so refuse before the session is
  // trimmed and before the utility brain sees the window.
  const owner = realDtuOwnerId(opts.userId);
  if (!owner) return { ok: false, error: "owner_required" };

  // Extract the oldest messages to compress
  const toCompress = sess.messages.slice(0, COMPRESSION_BATCH);
  const messageRange = {
    from: sess._totalMessageIndex || 0,
    to: (sess._totalMessageIndex || 0) + COMPRESSION_BATCH - 1,
  };

  // Build conversation text for the brain
  const conversationText = toCompress.map((m, i) =>
    `${m.role === "user" ? "User" : "Assistant"}: ${String(m.content || "").slice(0, 600)}`
  ).join("\n");

  // Call Utility brain to extract structured knowledge
  const extractionPrompt = `Analyze this conversation segment and extract structured knowledge. Return valid JSON only.

Conversation (messages ${messageRange.from}-${messageRange.to}):
${conversationText}

Return this exact JSON structure:
{
  "topics": ["topic1", "topic2"],
  "insights": ["key insight 1", "key insight 2"],
  "decisions": ["decision made 1"],
  "claims": ["factual claim 1"],
  "preferences": ["user preference 1"],
  "tone": "technical/casual/creative/emotional",
  "dtuCount": 1
}

Rules:
- topics: 1-5 main subjects discussed
- insights: key takeaways, realizations, novel connections (max 5)
- decisions: explicit choices or conclusions reached (max 3)
- claims: factual assertions that could be useful later (max 5)
- preferences: user preferences, opinions, working style indicators (max 3)
- tone: dominant emotional/intellectual tone
- dtuCount: how many DTUs to create (1 if single topic, 2-3 if multiple distinct topics)

Be precise. Extract actual content, not generic descriptions.`;

  const brainUrl = BRAIN_CONFIG.utility.url;
  const brainModel = BRAIN_CONFIG.utility.model;

  let extracted;
  try {
    const ac = new AbortController();
    const timeout = setTimeout(() => ac.abort(), BRAIN_CONFIG.utility.timeout || 30000);

    const response = await fetch(`${brainUrl}/api/generate`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        model: brainModel,
        prompt: extractionPrompt,
        stream: false,
        options: {
          temperature: 0.2,
          num_predict: 800,
        },
      }),
      signal: ac.signal,
    });

    clearTimeout(timeout);

    if (!response.ok) {
      log("warn", "rolling_window_brain_error", { sessionId, status: response.status });
      return { ok: false, error: `brain_http_${response.status}` };
    }

    const result = await response.json();
    const raw = String(result.response || "").trim();

    // Parse the JSON from the brain response
    const jsonMatch = raw.match(/\{[\s\S]*\}/);
    extracted = jsonMatch ? JSON.parse(jsonMatch[0]) : null;

    if (!extracted || !extracted.topics) {
      // Fallback: create a single DTU with raw extraction
      extracted = {
        topics: ["conversation"],
        insights: [raw.slice(0, 200)],
        decisions: [],
        claims: [],
        preferences: [],
        tone: "mixed",
        dtuCount: 1,
      };
    }
  } catch (err) {
    if (err.name === "AbortError") {
      log("warn", "rolling_window_timeout", { sessionId });
      return { ok: false, error: "timeout" };
    }
    // Fallback: create DTU from raw messages without brain analysis
    extracted = extractFallback(toCompress);
  }

  // Create conversation memory DTUs
  if (!STATE.dtus) STATE.dtus = new Map();
  const createdIds = [];
  const dtuCount = Math.min(Math.max(extracted.dtuCount || 1, 1), 3);

  if (dtuCount === 1) {
    // Single DTU for the whole batch
    const dtu = buildConversationMemoryDTU({
      sessionId,
      userId: owner,
      messageRange,
      topics: extracted.topics,
      insights: extracted.insights || [],
      decisions: extracted.decisions || [],
      claims: extracted.claims || [],
      preferences: extracted.preferences || [],
      tone: extracted.tone || "mixed",
      messageCount: COMPRESSION_BATCH,
    });
    STATE.dtus.set(dtu.id, dtu);
    createdIds.push(dtu.id);
  } else {
    // Split topics across multiple DTUs
    const topicsPerDtu = Math.ceil(extracted.topics.length / dtuCount);
    for (let i = 0; i < dtuCount; i++) {
      const topicSlice = extracted.topics.slice(i * topicsPerDtu, (i + 1) * topicsPerDtu);
      if (topicSlice.length === 0) continue;

      const dtu = buildConversationMemoryDTU({
        sessionId,
        userId: owner,
        messageRange,
        topics: topicSlice,
        insights: extracted.insights?.slice(i * 2, (i + 1) * 2) || [],
        decisions: extracted.decisions?.slice(i, i + 1) || [],
        claims: extracted.claims?.slice(i * 2, (i + 1) * 2) || [],
        preferences: extracted.preferences?.slice(i, i + 1) || [],
        tone: extracted.tone || "mixed",
        messageCount: Math.ceil(COMPRESSION_BATCH / dtuCount),
      });
      STATE.dtus.set(dtu.id, dtu);
      createdIds.push(dtu.id);
    }
  }

  // Trim the session window — remove compressed messages
  sess.messages = sess.messages.slice(COMPRESSION_BATCH);

  // Track total message index for ranges
  if (!sess._totalMessageIndex) sess._totalMessageIndex = 0;
  sess._totalMessageIndex += COMPRESSION_BATCH;

  // Track compression history
  if (!sess._compressionHistory) sess._compressionHistory = [];
  sess._compressionHistory.push({
    at: new Date().toISOString(),
    messageRange,
    dtuIds: createdIds,
    topics: extracted.topics,
  });

  // Trim compression history (keep last 20)
  if (sess._compressionHistory.length > 20) {
    sess._compressionHistory = sess._compressionHistory.slice(-20);
  }

  log("info", "rolling_window_compressed", {
    sessionId,
    messagesCompressed: COMPRESSION_BATCH,
    dtusCreated: createdIds.length,
    topics: extracted.topics,
    windowSize: sess.messages.length,
  });

  // Consolidation is part of this promise so a caller that awaits the
  // compress sees the private mega. The chat route does not await it.
  try {
    await checkTopicConsolidation(STATE, sessionId, { ...opts, userId: owner });
  } catch (e) {
    log("warn", "topic_consolidation_error", { error: e?.message });
  }

  return {
    ok: true,
    dtusCreated: createdIds.length,
    dtuIds: createdIds,
    messagesCompressed: COMPRESSION_BATCH,
    topics: extracted.topics,
    windowSize: sess.messages.length,
  };
}

// ── DTU Builder ─────────────────────────────────────────────────────────────

/**
 * Build a structured conversation memory DTU.
 */
function buildConversationMemoryDTU(opts) {
  const {
    sessionId, userId, messageRange, topics, insights,
    decisions, claims, preferences, tone, messageCount,
  } = opts;

  const id = `convmem_${crypto.randomBytes(8).toString("hex")}`;
  const now = new Date().toISOString();
  const topicLabel = topics.slice(0, 3).join(", ");

  const dtu = {
    id,
    title: `Conversation: ${topicLabel}`,
    tier: "regular",
    tags: [
      "conversation_memory",
      `session:${sessionId}`,
      ...topics.slice(0, 5),
    ],
    human: {
      summary: insights.slice(0, 3).join(". ") || `Discussed: ${topicLabel}`,
      bullets: [
        ...insights.map(i => `Insight: ${i}`),
        ...decisions.map(d => `Decision: ${d}`),
      ].slice(0, 8),
      examples: [],
    },
    core: {
      definitions: [],
      invariants: [],
      claims: claims.slice(0, 5),
      examples: [],
      nextActions: [],
    },
    machine: {
      kind: "conversation_memory",
      sessionId,
      userId: userId || null,
      messageRange,
      messageCount,
      topics,
      insights,
      decisions,
      claims,
      preferences,
      tone,
      compressedAt: now,
    },
    lineage: { parents: [], children: [] },
    source: "conversation-memory",
    meta: {
      conversationMemory: true,
      topicCount: topics.length,
    },
    createdAt: now,
    updatedAt: now,
    authority: { model: "utility_brain", score: 0.4 },
    hash: crypto.createHash("sha256")
      .update(`${sessionId}:${messageRange.from}:${messageRange.to}`)
      .digest("hex").slice(0, 16),
  };
  applyPrivateOwner(dtu, userId);
  const owned = realDtuOwnerId(userId);
  if (owned) dtu.machine.userId = owned;
  return dtu;
}

// ── Fallback Extraction ─────────────────────────────────────────────────────

/**
 * Extract structured data from messages without brain assistance.
 * Used when the Utility brain is unavailable.
 */
function extractFallback(messages) {
  // Simple keyword extraction
  const allText = messages.map(m => String(m.content || "")).join(" ").toLowerCase();
  const words = allText.split(/\s+/).filter(w => w.length > 4);
  const freq = {};
  for (const w of words) {
    freq[w] = (freq[w] || 0) + 1;
  }
  const topics = Object.entries(freq)
    .sort((a, b) => b[1] - a[1])
    .slice(0, 5)
    .map(([w]) => w);

  // Extract user messages as insights
  const userMessages = messages
    .filter(m => m.role === "user")
    .map(m => String(m.content || "").slice(0, 100));

  return {
    topics: topics.length > 0 ? topics : ["conversation"],
    insights: userMessages.slice(0, 3),
    decisions: [],
    claims: [],
    preferences: [],
    tone: "mixed",
    dtuCount: 1,
  };
}

// ── Topic Consolidation (MEGA Promotion) ────────────────────────────────────

/**
 * Check if conversation memory DTUs on the same topic should consolidate
 * into a MEGA. Also checks if MEGAs should consolidate into HYPERs.
 *
 * @param {Object} STATE - Global server state
 * @param {string} sessionId - Session ID (checks across ALL sessions)
 * @param {Object} [opts]
 */
async function checkTopicConsolidation(STATE, sessionId, opts = {}) {
  const log = opts.structuredLog || (() => {});

  if (!STATE?.dtus) return;

  // Ownerless rows stay untouched. Grouping them by topic would merge
  // every user's prompts into one public mega.
  const memoryDTUs = [];
  for (const dtu of STATE.dtus.values()) {
    if (dtu?.machine?.kind !== "conversation_memory") continue;
    if (!memoryOwnerId(dtu)) continue;
    memoryDTUs.push(dtu);
  }

  const topicGroups = new Map();
  for (const dtu of memoryDTUs) {
    const rowOwner = memoryOwnerId(dtu);
    for (const topic of (dtu.machine?.topics || [])) {
      const key = `${rowOwner}\0${topic}`;
      if (!topicGroups.has(key)) topicGroups.set(key, []);
      topicGroups.get(key).push(dtu);
    }
  }

  for (const [key, dtus] of topicGroups) {
    if (dtus.length < MEGA_TOPIC_THRESHOLD) continue;
    const sep = key.indexOf("\0");
    const rowOwner = key.slice(0, sep);
    const topic = key.slice(sep + 1);

    // Owner is in the hash so this does not update the old public mega
    // whose id was a 12-hex hash of the topic alone.
    const megaId = `convmega_${crypto.createHash("sha256").update(`${rowOwner}:${topic}`).digest("hex").slice(0, 16)}`;
    if (STATE.dtus.has(megaId)) {
      const mega = STATE.dtus.get(megaId);
      if (memoryOwnerId(mega) !== rowOwner) continue;
      mega.machine.sourceCount = dtus.length;
      mega.machine.lastUpdated = new Date().toISOString();
      mega.updatedAt = new Date().toISOString();
      // Merge insights from new DTUs
      const existingInsights = new Set(mega.machine.insights || []);
      for (const dtu of dtus) {
        for (const insight of (dtu.machine?.insights || [])) {
          existingInsights.add(insight);
        }
      }
      mega.machine.insights = Array.from(existingInsights).slice(0, 15);
      mega.machine.userId = rowOwner;
      mega.human.summary = mega.machine.insights.slice(0, 5).join(". ");
      applyPrivateOwner(mega, rowOwner);
      continue;
    }

    // Create MEGA from consolidated conversation memories
    const allInsights = [];
    const allDecisions = [];
    const allClaims = [];
    const allPreferences = [];
    const sessionIds = new Set();

    for (const dtu of dtus) {
      allInsights.push(...(dtu.machine?.insights || []));
      allDecisions.push(...(dtu.machine?.decisions || []));
      allClaims.push(...(dtu.machine?.claims || []));
      allPreferences.push(...(dtu.machine?.preferences || []));
      if (dtu.machine?.sessionId) sessionIds.add(dtu.machine.sessionId);
    }

    const now = new Date().toISOString();
    const mega = {
      id: megaId,
      title: `All discussions: ${topic}`,
      tier: "mega",
      tags: ["conversation_memory", "mega", topic],
      human: {
        summary: [...new Set(allInsights)].slice(0, 5).join(". "),
        bullets: [
          ...allInsights.slice(0, 5).map(i => `Insight: ${i}`),
          ...allDecisions.slice(0, 3).map(d => `Decision: ${d}`),
        ],
        examples: [],
      },
      core: {
        definitions: [],
        invariants: [],
        claims: [...new Set(allClaims)].slice(0, 8),
        examples: [],
        nextActions: [],
      },
      machine: {
        kind: "conversation_memory_mega",
        topic,
        sourceCount: dtus.length,
        sourceDtuIds: dtus.map(d => d.id),
        sessionIds: Array.from(sessionIds),
        insights: [...new Set(allInsights)].slice(0, 15),
        decisions: [...new Set(allDecisions)].slice(0, 8),
        claims: [...new Set(allClaims)].slice(0, 8),
        preferences: [...new Set(allPreferences)].slice(0, 5),
        userId: rowOwner,
        consolidatedAt: now,
        lastUpdated: now,
      },
      lineage: {
        parents: [],
        children: dtus.map(d => d.id),
      },
      source: "conversation-memory",
      meta: { conversationMemory: true, consolidated: true },
      createdAt: now,
      updatedAt: now,
      authority: { model: "consolidation", score: 0.6 },
      hash: crypto.createHash("sha256").update(`mega:${rowOwner}:${topic}:${dtus.length}`).digest("hex").slice(0, 16),
    };
    applyPrivateOwner(mega, rowOwner);

    STATE.dtus.set(megaId, mega);

    log("info", "conversation_mega_created", {
      megaId,
      topic,
      sourceCount: dtus.length,
      sessionCount: sessionIds.size,
    });
  }

  // One hyper per owner. The old `convhyper_${userId||"global"}` id rolled
  // every user's megas into a single public row; leave those ids alone.
  const megasByOwner = new Map();
  for (const dtu of STATE.dtus.values()) {
    if (dtu?.machine?.kind !== "conversation_memory_mega") continue;
    const rowOwner = memoryOwnerId(dtu);
    if (!rowOwner) continue;
    if (!megasByOwner.has(rowOwner)) megasByOwner.set(rowOwner, []);
    megasByOwner.get(rowOwner).push(dtu);
  }

  for (const [rowOwner, megas] of megasByOwner) {
    if (megas.length < HYPER_MEGA_THRESHOLD) continue;
    const hyperId = `convhyper_owned_${crypto.createHash("sha256").update(rowOwner).digest("hex").slice(0, 16)}`;
    if (STATE.dtus.has(hyperId)) continue;
    const allTopics = megas.map(m => m.machine?.topic).filter(Boolean);
    const allInsights = megas.flatMap(m => m.machine?.insights || []);
    const now = new Date().toISOString();

    const hyper = {
      id: hyperId,
      title: `Complete conversation history: ${allTopics.slice(0, 4).join(", ")}`,
      tier: "hyper",
      tags: ["conversation_memory", "hyper", ...allTopics.slice(0, 8)],
      human: {
        summary: `Comprehensive knowledge from ${megas.length} topic areas spanning all conversations.`,
        bullets: allTopics.map(t => `Domain: ${t}`).slice(0, 10),
        examples: [],
      },
      core: {
        definitions: [],
        invariants: [],
        claims: megas.flatMap(m => m.core?.claims || []).slice(0, 10),
        examples: [],
        nextActions: [],
      },
      machine: {
        kind: "conversation_memory_hyper",
        userId: rowOwner,
        megaCount: megas.length,
        megaIds: megas.map(m => m.id),
        topics: allTopics,
        topInsights: [...new Set(allInsights)].slice(0, 20),
        consolidatedAt: now,
      },
      lineage: {
        parents: [],
        children: megas.map(m => m.id),
      },
      source: "conversation-memory",
      meta: { conversationMemory: true, hyperConsolidated: true },
      createdAt: now,
      updatedAt: now,
      authority: { model: "consolidation", score: 0.8 },
      hash: crypto.createHash("sha256").update(`hyper:${rowOwner}:${allTopics.join(":")}`).digest("hex").slice(0, 16),
    };
    applyPrivateOwner(hyper, rowOwner);

    STATE.dtus.set(hyperId, hyper);
    log("info", "conversation_hyper_created", {
      hyperId,
      megaCount: megas.length,
      topics: allTopics,
    });
  }
}

// ── Session Memory Stats ────────────────────────────────────────────────────

/**
 * Get memory statistics for a session.
 *
 * @param {Object} STATE - Global server state
 * @param {string} sessionId - Session ID
 * @returns {Object}
 */
export function getSessionMemoryStats(STATE, sessionId) {
  const sess = STATE.sessions?.get(sessionId);
  if (!sess) return { ok: false, error: "session_not_found" };

  // Count conversation memory DTUs for this session
  let memoryDtuCount = 0;
  let megaCount = 0;
  const topics = new Set();

  for (const [_id, dtu] of (STATE.dtus || new Map())) {
    if (dtu.machine?.kind === "conversation_memory" && dtu.machine?.sessionId === sessionId) {
      memoryDtuCount++;
      for (const t of (dtu.machine?.topics || [])) topics.add(t);
    }
    if (dtu.machine?.kind === "conversation_memory_mega") {
      if (dtu.machine?.sessionIds?.includes(sessionId)) megaCount++;
    }
  }

  return {
    ok: true,
    activeMessages: sess.messages?.length || 0,
    totalMessagesProcessed: (sess._totalMessageIndex || 0) + (sess.messages?.length || 0),
    compressionCycles: sess._compressionHistory?.length || 0,
    memoryDtuCount,
    megaCount,
    topics: Array.from(topics),
    windowUtilization: `${sess.messages?.length || 0}/${ACTIVE_WINDOW}`,
  };
}

// ── Exports ─────────────────────────────────────────────────────────────────

export const MEMORY_CONSTANTS = Object.freeze({
  ACTIVE_WINDOW,
  WINDOW_THRESHOLD,
  COMPRESSION_BATCH,
  MAX_MEMORY_DTUS_PER_SESSION,
  MEGA_TOPIC_THRESHOLD,
  HYPER_MEGA_THRESHOLD,
});
