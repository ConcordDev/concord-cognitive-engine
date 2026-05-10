/**
 * Analogy Engine — Finds structural similarities across domains.
 *
 * Takes a source DTU and finds semantically similar DTUs in OTHER domains.
 * Uses embedding space proximity filtered to exclude the source domain.
 *
 * Feeds ghost threads and the Transfer lens.
 */

import logger from "../logger.js";

/**
 * Find cross-domain analogies for a source DTU.
 *
 * @param {string} sourceDtuId
 * @param {object} deps - { STATE, EMBEDDINGS, cosineSimilarity, callBrain }
 * @param {object} opts
 * @param {string[]} [opts.targetDomains] - Limit to these domains (null = all)
 * @param {number} [opts.minScore] - Minimum similarity threshold (default 0.6)
 * @param {number} [opts.limit] - Max results (default 10)
 * @param {boolean} [opts.explain] - Generate explanations via utility brain
 * @returns {Promise<{ ok: boolean, analogies: object[], source: object }>}
 */
async function findAnalogies(sourceDtuId, deps, opts = {}) {
  const { STATE, EMBEDDINGS, cosineSimilarity, callBrain } = deps;
  const { targetDomains = null, minScore = 0.5, limit = 10, explain = true } = opts;

  // Get source DTU
  const sourceDtu = STATE.dtus.get(sourceDtuId);
  if (!sourceDtu) return { ok: false, error: "Source DTU not found" };

  // Get source embedding
  const sourceVec = EMBEDDINGS?.store?.get(sourceDtuId);
  if (!sourceVec) return { ok: false, error: "Source DTU has no embedding — index may need rebuilding" };

  // Get source domain(s)
  const sourceDomains = new Set((sourceDtu.tags || []).map(t => t.toLowerCase()));

  // Search for similar DTUs in different domains
  const candidates = [];
  for (const [dtuId, vec] of EMBEDDINGS.store) {
    if (dtuId === sourceDtuId) continue;

    const dtu = STATE.dtus.get(dtuId);
    if (!dtu) continue;

    // Must be in a DIFFERENT domain
    const dtuDomains = (dtu.tags || []).map(t => t.toLowerCase());
    const isDifferentDomain = !dtuDomains.some(d => sourceDomains.has(d));
    if (!isDifferentDomain) continue;

    // Target domain filter
    if (targetDomains && targetDomains.length > 0) {
      const targetSet = new Set(targetDomains.map(d => d.toLowerCase()));
      const matchesTarget = dtuDomains.some(d => targetSet.has(d));
      if (!matchesTarget) continue;
    }

    const score = cosineSimilarity(sourceVec, vec);
    if (score >= minScore) {
      candidates.push({ dtu, dtuId, score, domains: dtuDomains });
    }
  }

  // Sort by similarity and take top results
  candidates.sort((a, b) => b.score - a.score);
  const topResults = candidates.slice(0, limit);

  // Generate explanations via utility brain
  const analogies = [];
  for (const c of topResults) {
    const analogy = {
      dtuId: c.dtuId,
      title: c.dtu.title,
      domains: c.domains.filter(d => !d.includes("quick-capture") && !d.includes("webhook")),
      similarity: Math.round(c.score * 1000) / 1000,
      tier: c.dtu.tier || "regular",
      contentPreview: (c.dtu.content || c.dtu.human?.summary || "").slice(0, 200),
      explanation: null,
    };

    // Generate explanation if requested and brain available
    if (explain && typeof callBrain === "function") {
      try {
        const prompt = `In one sentence, explain the structural similarity between these two concepts from different domains:\n\nA: "${sourceDtu.title}" (${Array.from(sourceDomains).join(", ")}): ${(sourceDtu.content || "").slice(0, 150)}\n\nB: "${c.dtu.title}" (${c.domains.join(", ")}): ${(c.dtu.content || "").slice(0, 150)}\n\nExplain the connection:`;
        const result = await callBrain("utility", prompt, { temperature: 0.6, maxTokens: 100 });
        if (result?.ok && result.content) {
          analogy.explanation = result.content.trim();
        }
      } catch (_e) { /* explanation is optional */ }
    }

    analogies.push(analogy);
  }

  return {
    ok: true,
    source: {
      dtuId: sourceDtuId,
      title: sourceDtu.title,
      domains: Array.from(sourceDomains),
      tier: sourceDtu.tier || "regular",
    },
    analogies,
    count: analogies.length,
    threshold: minScore,
  };
}

export default { findAnalogies };
