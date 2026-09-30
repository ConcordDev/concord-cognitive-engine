// server/lib/inference/tool-picker.js
// Selects the most relevant tools from the full lens toolset for a given intent.
// Uses embedding cosine similarity when embeddings are available; falls back to
// returning the full set (or a random sample) when embeddings are disabled.

const EMBEDDINGS_ENABLED = process.env.EMBEDDINGS_ENABLED !== "false" && process.env.ENABLE_EMBEDDINGS !== "false";

/**
 * Cosine similarity between two float arrays.
 * @param {number[]} a
 * @param {number[]} b
 * @returns {number}
 */
function cosineSimilarity(a, b) {
  if (a.length !== b.length) return 0;
  let dot = 0, magA = 0, magB = 0;
  for (let i = 0; i < a.length; i++) {
    dot += a[i] * b[i];
    magA += a[i] * a[i];
    magB += b[i] * b[i];
  }
  const denom = Math.sqrt(magA) * Math.sqrt(magB);
  return denom === 0 ? 0 : dot / denom;
}

/**
 * Attempt to compute an embedding for a string.
 * Uses the existing embeddings infrastructure if available; returns null on failure.
 * @param {string} text
 * @returns {Promise<number[]|null>}
 */
async function tryEmbed(text) {
  if (!EMBEDDINGS_ENABLED) return null;
  try {
    const { embed } = await import("../embeddings.js");
    return await embed(text);
  } catch {
    return null;
  }
}

/**
 * Get all tools registered in a given scope (array of lens/domain names).
 * Tools are expected to have: { name, description, inputSchema, embedding? }
 * Falls back to empty array if lens registry not available.
 * @param {string[]} scope
 * @returns {Promise<object[]>}
 */
async function getToolsInScope(scope) {
  try {
    const { getLensTools } = await import("../lens-economy-wiring.js");
    const tools = [];
    for (const domain of (scope || [])) {
      const domainTools = getLensTools?.(domain) || [];
      tools.push(...domainTools);
    }
    return tools;
  } catch {
    return [];
  }
}

/**
 * Select the most relevant tools for an intent within a scope.
 *
 * @param {string} intent - The user's intent text
 * @param {string[]} [scope] - Lens/domain names to pull tools from
 * @param {number} [budget=10] - Maximum number of tools to return
 * @returns {Promise<object[]>}
 */
export async function pickTools(intent, scope, budget = 10) {
  const allTools = await getToolsInScope(scope);

  if (allTools.length > budget * 3) {
    try {
      const { compileToolUniverse } = await import("../runtime/tool-universe-compiler.js");
      const compiled = compileToolUniverse(intent, {
        budget,
        handTools: allTools,
        includeReflected: false,
      });
      if (compiled.tools?.length) {
        const byName = new Map(allTools.map((t) => [t.name, t]));
        return compiled.tools
          .map((t) => byName.get(t.name) || t)
          .slice(0, budget);
      }
    } catch { /* fall through to legacy picker */ }
  }

  if (allTools.length === 0 || allTools.length <= budget) {
    return allTools;
  }

  // Try embedding-based rerank
  const intentEmbedding = await tryEmbed(intent);

  if (intentEmbedding) {
    const scored = await Promise.all(
      allTools.map(async (tool) => {
        const toolEmbedding = tool.embedding || (await tryEmbed(tool.description || tool.name));
        const score = toolEmbedding ? cosineSimilarity(intentEmbedding, toolEmbedding) : 0;
        return { tool, score };
      })
    );
    return scored
      .sort((a, b) => b.score - a.score)
      .slice(0, budget)
      .map(s => s.tool);
  }

  // Fallback: keyword overlap scoring
  const intentWords = new Set(intent.toLowerCase().split(/\W+/).filter(w => w.length > 3));
  const scored = allTools.map(tool => {
    const desc = (tool.description || tool.name || "").toLowerCase();
    let hits = 0;
    for (const word of intentWords) {
      if (desc.includes(word)) hits++;
    }
    return { tool, score: hits };
  });

  return scored
    .sort((a, b) => b.score - a.score)
    .slice(0, budget)
    .map(s => s.tool);
}
