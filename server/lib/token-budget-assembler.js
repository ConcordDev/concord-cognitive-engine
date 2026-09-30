/**
 * Token Budget Assembler — Budget-Aware Working Set Assembly
 *
 * Phase 2 of the Chat Response Pipeline. Takes the harvested context from
 * Phase 1 and assembles it into a structured working set with a strict
 * token budget.
 *
 * Budget allocation:
 *   15% — System prompt + entity identity (qualia, personality, constitutional rules)
 *   10% — Conversation summary from Utility brain
 *   50% — DTU context block (formatted for LLM consumption)
 *   25% — User message + response generation space
 *
 * Priority truncation when over budget:
 *   1. Entity state DTUs (define who's talking)
 *   2. Conversation-referenced DTUs (things already discussed)
 *   3. Semantic matches (new relevant knowledge)
 *   4. MEGA summaries (background depth)
 */

import { BRAIN_CONFIG } from "./brain-config.js";

// ── Token Estimation ─────────────────────────────────────────────────────────

/** Approximate tokens per character for qwen2.5 tokenizer */
const CHARS_PER_TOKEN = 3.8;

/**
 * Estimate token count for a string.
 * Calibrated for qwen2.5 tokenizer (~3.8 chars/token).
 *
 * @param {string} text
 * @returns {number}
 */
export function estimateTokens(text) {
  if (!text) return 0;
  return Math.ceil(String(text).length / CHARS_PER_TOKEN);
}

// ── Budget Constants ─────────────────────────────────────────────────────────

export const BUDGET_RATIOS = Object.freeze({
  systemPrompt: 0.15,    // System prompt + entity identity
  conversationSummary: 0.10,  // Compressed running summary
  dtuContext: 0.50,       // Harvested DTU working set
  responseSpace: 0.25,    // User message + generation space
});

/**
 * Absolute ceiling on the DTU context block, on top of the 50% ratio.
 * The ratio alone scales with the context window: at the conscious brain's
 * 32K window it handed retrieval ~16K tokens and retrieval always filled it
 * (MEGA "background depth" summaries last), so "hey what's up" shipped a
 * 16.6K-token system prompt. Prefill of that took 23-49 s per turn on a
 * 24 GB GPU slice (measured 2026-09-27) and dominated every chat latency.
 * The window stays large for long conversations; only the knowledge block
 * is capped. Priority order is unchanged, so the most relevant DTUs still
 * win the space. Override with CONCORD_DTU_CONTEXT_MAX_TOKENS.
 */
export function dtuContextCapTokens(env = process.env) {
  const n = Number(env.CONCORD_DTU_CONTEXT_MAX_TOKENS);
  return Number.isFinite(n) && n > 0 ? Math.floor(n) : 3000;
}

// ── DTU Formatting ───────────────────────────────────────────────────────────

/**
 * Format a single DTU as a structured block for LLM consumption.
 * NOT a raw dump — formatted for readability and token efficiency.
 *
 * @param {Object} dtu - DTU object
 * @param {Object} [activationMeta] - Activation metadata (score, sources)
 * @returns {string}
 */
export function formatDTUBlock(dtu, activationMeta) {
  const lines = [];

  const tier = dtu.tier || dtu.meta?.tier || "regular";
  const tags = (dtu.tags || []).filter(t => !t.startsWith("shadow") && !t.startsWith("session:")).slice(0, 5);

  lines.push(`[${tier.toUpperCase()}] ${dtu.title || dtu.id}`);

  if (tags.length > 0) {
    lines.push(`  Tags: ${tags.join(", ")}`);
  }

  // Core content summary — pull the most informative field
  const summary = dtu.human?.summary || dtu.core?.claims?.[0] || dtu.content || "";
  if (summary) {
    lines.push(`  ${String(summary).slice(0, 300)}`);
  }

  // Key invariants (if any)
  if (dtu.core?.invariants && dtu.core.invariants.length > 0) {
    lines.push(`  Invariants: ${dtu.core.invariants.slice(0, 2).join("; ")}`);
  }

  // Activation confidence
  if (activationMeta?.score != null) {
    lines.push(`  Confidence: ${(activationMeta.score * 100).toFixed(0)}%`);
  }

  // Consolidation info
  if (dtu._consolidates) {
    lines.push(`  Consolidates: ${dtu._consolidates} DTUs`);
  }

  // Lineage depth
  const depth = dtu.lineage?.parents?.length || dtu.meta?.derivationDepth || 0;
  if (depth > 0) {
    lines.push(`  Lineage depth: ${depth}`);
  }

  return lines.join("\n");
}

// ── Priority Classification ──────────────────────────────────────────────────

/**
 * Priority levels for DTU truncation.
 * Lower number = higher priority (kept first).
 */
const PRIORITY = {
  ENTITY_STATE: 0,
  CONVERSATION_REFERENCED: 1,
  SEMANTIC_MATCH: 2,
  MEGA_SUMMARY: 3,
};

/**
 * Classify a DTU's priority for truncation purposes.
 *
 * @param {Object} dtu - DTU object
 * @param {Set} [conversationDtuIds] - IDs of DTUs referenced in conversation
 * @returns {number}
 */
function classifyPriority(dtu, conversationDtuIds) {
  // Entity state DTUs — highest priority
  if (dtu.tags?.includes("entity-state") || dtu.machine?.kind === "entity_state") {
    return PRIORITY.ENTITY_STATE;
  }

  // Conversation-referenced — things already discussed
  if (conversationDtuIds && conversationDtuIds.has(dtu.id)) {
    return PRIORITY.CONVERSATION_REFERENCED;
  }

  // MEGA/HYPER summaries — background depth (lowest)
  const tier = dtu.tier || dtu.meta?.tier || "regular";
  if (tier === "mega" || tier === "hyper") {
    return PRIORITY.MEGA_SUMMARY;
  }

  // Everything else — semantic matches
  return PRIORITY.SEMANTIC_MATCH;
}

// ── Main Assembler ───────────────────────────────────────────────────────────

/**
 * Assemble the complete context with strict token budget enforcement.
 *
 * @param {Object} opts
 * @param {string} opts.systemPromptBase - Base system prompt (identity, rules)
 * @param {string} opts.entityStateBlock - Formatted entity state (from chat-context-pipeline.js)
 * @param {string} opts.conversationSummary - From conversation-summarizer.js
 * @param {string} opts.userMessage - The user's prompt
 * @param {Array} opts.workingSetDtus - DTU objects from harvest
 * @param {Array} [opts.activationMeta] - Per-DTU activation metadata
 * @param {Set} [opts.conversationDtuIds] - DTU IDs referenced in prior conversation
 * @param {number} [opts.contextWindow] - Total context window size (default: from BRAIN_CONFIG)
 * @returns {{ systemPromptFinal, dtuContextBlock, messagesForLLM, tokenEstimate, truncatedCount, budgetUtilization }}
 */
export function assembleWithTokenBudget(opts) {
  const contextWindow = opts.contextWindow || BRAIN_CONFIG.conscious.contextWindow || 32768;

  // Calculate absolute token budgets
  const budgets = {
    systemPrompt: Math.floor(contextWindow * BUDGET_RATIOS.systemPrompt),
    conversationSummary: Math.floor(contextWindow * BUDGET_RATIOS.conversationSummary),
    dtuContext: Math.min(Math.floor(contextWindow * BUDGET_RATIOS.dtuContext), dtuContextCapTokens()),
    responseSpace: Math.floor(contextWindow * BUDGET_RATIOS.responseSpace),
  };

  // ── Build system prompt (15%) ──
  let systemPromptFinal = String(opts.systemPromptBase || "").slice(0, budgets.systemPrompt * CHARS_PER_TOKEN);
  if (opts.entityStateBlock) {
    const entityTokens = estimateTokens(opts.entityStateBlock);
    const remainingSystemTokens = budgets.systemPrompt - estimateTokens(systemPromptFinal);
    if (entityTokens <= remainingSystemTokens) {
      systemPromptFinal += `\n\n${opts.entityStateBlock}`;
    } else {
      // Truncate entity state to fit
      const maxChars = Math.floor(remainingSystemTokens * CHARS_PER_TOKEN);
      systemPromptFinal += `\n\n${opts.entityStateBlock.slice(0, maxChars)}`;
    }
  }

  // ── Conversation summary (10%) ──
  let conversationBlock = "";
  if (opts.conversationSummary) {
    const maxSummaryChars = Math.floor(budgets.conversationSummary * CHARS_PER_TOKEN);
    conversationBlock = String(opts.conversationSummary).slice(0, maxSummaryChars);
  }

  // ── DTU context block (50%) ──
  const dtuBudgetTokens = budgets.dtuContext;
  const activationMap = new Map();
  if (opts.activationMeta && Array.isArray(opts.activationMeta)) {
    for (const meta of opts.activationMeta) {
      activationMap.set(meta.dtuId || meta.id, meta);
    }
  }

  // Sort DTUs by priority, then by activation score
  const conversationDtuIds = opts.conversationDtuIds || new Set();
  const prioritized = (opts.workingSetDtus || [])
    .map(dtu => ({
      dtu,
      priority: classifyPriority(dtu, conversationDtuIds),
      score: activationMap.get(dtu.id)?.score || 0,
    }))
    .sort((a, b) => {
      if (a.priority !== b.priority) return a.priority - b.priority;
      return b.score - a.score;
    });

  // Fill DTU context within budget
  const dtuBlocks = [];
  let dtuTokensUsed = 0;
  let truncatedCount = 0;

  for (const { dtu } of prioritized) {
    const block = formatDTUBlock(dtu, activationMap.get(dtu.id));
    const blockTokens = estimateTokens(block);

    if (dtuTokensUsed + blockTokens <= dtuBudgetTokens) {
      dtuBlocks.push(block);
      dtuTokensUsed += blockTokens;
    } else {
      truncatedCount++;
    }
  }

  const dtuContextBlock = dtuBlocks.join("\n---\n");

  // ── User message (part of 25%) ──
  const userMessage = String(opts.userMessage || "");
  const userTokens = estimateTokens(userMessage);

  // ── Assemble final messages for LLM ──
  const contextParts = [];
  if (conversationBlock) {
    contextParts.push(`[Conversation Summary]\n${conversationBlock}`);
  }
  if (dtuContextBlock) {
    contextParts.push(`[Relevant DTUs]\n${dtuContextBlock}`);
  }

  const userContent = contextParts.length > 0
    ? `User prompt:\n${userMessage}\n\n${contextParts.join("\n\n")}\n\nRespond naturally and propose next actions.`
    : `User prompt:\n${userMessage}\n\nRespond naturally and propose next actions.`;

  const messagesForLLM = [
    { role: "user", content: userContent },
  ];

  // ── Budget utilization ──
  const totalUsed = estimateTokens(systemPromptFinal) + estimateTokens(conversationBlock) + dtuTokensUsed + userTokens;
  const budgetUtilization = {
    systemPrompt: { used: estimateTokens(systemPromptFinal), budget: budgets.systemPrompt, pct: Math.round(estimateTokens(systemPromptFinal) / budgets.systemPrompt * 100) },
    conversationSummary: { used: estimateTokens(conversationBlock), budget: budgets.conversationSummary, pct: Math.round(estimateTokens(conversationBlock) / Math.max(1, budgets.conversationSummary) * 100) },
    dtuContext: { used: dtuTokensUsed, budget: budgets.dtuContext, pct: Math.round(dtuTokensUsed / budgets.dtuContext * 100) },
    responseSpace: { used: userTokens, budget: budgets.responseSpace, pct: Math.round(userTokens / budgets.responseSpace * 100) },
    total: { used: totalUsed, budget: contextWindow, pct: Math.round(totalUsed / contextWindow * 100) },
  };

  return {
    systemPromptFinal,
    dtuContextBlock,
    conversationBlock,
    messagesForLLM,
    tokenEstimate: totalUsed,
    truncatedCount,
    dtuCount: dtuBlocks.length,
    budgetUtilization,
  };
}

/**
 * Compute a quick budget breakdown without full assembly.
 * Useful for the /api/chat/context debugging endpoint.
 *
 * @param {number} [contextWindow] - Total context window
 * @returns {Object}
 */
export function computeBudgetBreakdown(contextWindow) {
  const cw = contextWindow || BRAIN_CONFIG.conscious.contextWindow || 32768;
  return {
    contextWindow: cw,
    budgets: {
      systemPrompt: Math.floor(cw * BUDGET_RATIOS.systemPrompt),
      conversationSummary: Math.floor(cw * BUDGET_RATIOS.conversationSummary),
      dtuContext: Math.min(Math.floor(cw * BUDGET_RATIOS.dtuContext), dtuContextCapTokens()),
      responseSpace: Math.floor(cw * BUDGET_RATIOS.responseSpace),
    },
    ratios: { ...BUDGET_RATIOS },
  };
}
