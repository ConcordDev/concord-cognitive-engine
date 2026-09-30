// server/lib/runtime/tool-universe-compiler.js
//
// MCP tool universe compiler — scores the full tool graph (hand + reflected macros)
// and returns only task-relevant schemas to bound context size.

import { REFLECTED_TOOLS } from "../macro-reflection.js";

const HAND_TOOL_BONUS = 2;
const MAX_REFLECTED_SCAN = Number(process.env.CONCORD_TOOL_COMPILER_MAX_SCAN) || 5000;

function tokenize(text) {
  return String(text || "")
    .toLowerCase()
    .replace(/[^a-z0-9_.-]+/g, " ")
    .split(/\s+/)
    .filter(Boolean);
}

function scoreTool(tool, queryTokens, { preferHand = true } = {}) {
  const name = tool.name || "";
  const desc = tool.description || "";
  const hay = `${name} ${desc}`.toLowerCase();
  let score = 0;

  for (const tok of queryTokens) {
    if (!tok || tok.length < 2) continue;
    if (name.toLowerCase().includes(tok)) score += 3;
    if (hay.includes(tok)) score += 1;
  }

  if (preferHand && !name.startsWith("macro.")) score += HAND_TOOL_BONUS;
  if (name.startsWith("dtu_") && queryTokens.some((t) => ["dtu", "memory", "recall", "search"].includes(t))) score += 2;
  if (name.startsWith("dhtp_") && queryTokens.some((t) => ["compress", "token", "context", "dhtp"].includes(t))) score += 2;
  if (name.startsWith("repo_") && queryTokens.some((t) => ["repo", "code", "file", "symbol", "route"].includes(t))) score += 2;
  if (name.includes("reflect") && queryTokens.some((t) => ["macro", "domain", "invoke"].includes(t))) score += 1;

  return score;
}

/**
 * Build searchable tool catalog (hand tools + reflected macros sample).
 */
export function buildToolCatalog({ handTools = [], includeReflected = true, maxReflected = MAX_REFLECTED_SCAN } = {}) {
  const hand = (handTools || []).map((t) => ({ ...t, source: "hand" }));
  if (!includeReflected || !REFLECTED_TOOLS?.length) return hand;

  const reflected = REFLECTED_TOOLS.slice(0, maxReflected).map((t) => ({
    name: t.name,
    description: t.description || "",
    inputSchema: t.inputSchema || { type: "object", properties: {} },
    source: "reflected",
  }));

  return [...hand, ...reflected];
}

/**
 * Compile minimum sufficient tool universe for a task.
 */
export function compileToolUniverse(task, opts = {}) {
  const {
    budget = 12,
    minScore = 1,
    includeReflected = true,
    alwaysInclude = [],
    handTools = [],
  } = opts;

  const query = typeof task === "string" ? task : [
    task?.intent,
    task?.goal,
    task?.description,
    task?.domain,
    ...(task?.keywords || []),
  ].filter(Boolean).join(" ");

  const queryTokens = tokenize(query);
  const catalog = buildToolCatalog({ includeReflected, handTools });
  const forced = new Set(alwaysInclude);

  const scored = catalog
    .map((tool) => ({
      tool,
      score: forced.has(tool.name) ? 1000 : scoreTool(tool, queryTokens),
    }))
    .filter((s) => s.score >= minScore || forced.has(s.tool.name))
    .sort((a, b) => b.score - a.score);

  const selected = scored.slice(0, Math.max(1, budget));
  const omitted = catalog.length - selected.length;

  return {
    ok: true,
    query,
    queryTokens,
    catalogSize: catalog.length,
    selectedCount: selected.length,
    omittedCount: omitted,
    compressionRatio: catalog.length > 0 ? omitted / catalog.length : 0,
    tools: selected.map((s) => ({
      name: s.tool.name,
      description: s.tool.description,
      inputSchema: s.tool.inputSchema,
      source: s.tool.source,
      score: s.score,
    })),
  };
}

/**
 * Serialize compiled tools for prompt injection (names + one-line descriptions only).
 */
export function formatCompiledToolsForPrompt(compiled, { maxChars = 4000 } = {}) {
  if (!compiled?.tools?.length) return "";
  const lines = ["# Available tools (compiled subset)"];
  let chars = lines[0].length;

  for (const t of compiled.tools) {
    const line = `- ${t.name}: ${(t.description || "").slice(0, 120)}`;
    if (chars + line.length > maxChars) break;
    lines.push(line);
    chars += line.length;
  }

  return lines.join("\n");
}
