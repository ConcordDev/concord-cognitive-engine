// server/emergent/lens-learning.js
// AI learning loop per domain — runs on heartbeat ticks.
// Gathers recent DTUs, sends to subconscious brain for pattern analysis,
// stores learned patterns as MEGA DTU candidates, emits insights via WebSocket.

const LEARNING_STATE = new Map(); // domain -> { lastRunAt, patterns, insightCount }
// Bumped 50 → 500 patterns/domain for 32GB-heap deployments. Each lens
// learns more patterns before LRU eviction kicks in; richer cross-lens
// signal for the meta-derivation engine.
const MAX_PATTERNS_PER_DOMAIN = Number(process.env.CONCORD_LENS_PATTERNS_PER_DOMAIN) || 500;

function ensureLearningState(domain) {
  if (!LEARNING_STATE.has(domain)) {
    LEARNING_STATE.set(domain, {
      lastRunAt: null,
      patterns: [],
      insightCount: 0,
      errors: [],
    });
  }
  return LEARNING_STATE.get(domain);
}

/**
 * Run a learning cycle for a specific lens domain.
 * Gathers recent DTUs → sends to subconscious brain → stores patterns → emits insights.
 * @param {object} STATE - Global state
 * @param {string} domain - Lens domain (e.g., "finance", "news")
 * @param {function} realtimeEmit - WebSocket emit function
 * @param {function} callBrain - Brain call function (conscious/subconscious/utility)
 */
export async function runLensLearningCycle(STATE, domain, realtimeEmit, callBrain) {
  const ls = ensureLearningState(domain);

  // Gather recent DTUs from this domain
  const dtus = [];
  for (const dtu of STATE.dtus.values()) {
    if (dtus.length >= 20) break;
    const tags = dtu.tags || [];
    const machineDomain = dtu.machine?.domain || dtu.machine?.kind || "";
    if (tags.includes(domain) || machineDomain === domain || machineDomain.startsWith(`${domain}_`)) {
      dtus.push(dtu);
    }
  }

  if (dtus.length < 3) {
    // Not enough data for learning
    return { ok: true, domain, skipped: true, reason: "insufficient_data", dtuCount: dtus.length };
  }

  // Build a prompt for pattern analysis
  const dtuSummaries = dtus.slice(0, 10).map((d, i) => {
    const title = d.title || d.id;
    const summary = d.human?.summary || d.creti?.slice(0, 200) || "";
    const tags = (d.tags || []).join(", ");
    return `[${i + 1}] "${title}" — ${summary} (tags: ${tags})`;
  }).join("\n");

  const prompt = `Analyze these ${domain} knowledge artifacts and identify patterns, trends, and insights:

${dtuSummaries}

Respond with a JSON object:
{
  "patterns": ["pattern1", "pattern2"],
  "trend": "brief trend description",
  "insight": "one key actionable insight",
  "confidence": 0.0-1.0
}`;

  try {
    const result = await callBrain("subconscious", prompt, {
      system: `You are a pattern analysis engine for the ${domain} domain. Extract patterns from knowledge artifacts. Respond with valid JSON only.`,
      temperature: 0.3,
      maxTokens: 500,
      timeout: 30000,
    });

    if (!result.ok) {
      ls.errors.push({ ts: Date.now(), error: result.error });
      if (ls.errors.length > 10) ls.errors.shift();
      return { ok: false, domain, error: result.error };
    }

    // Parse brain response (forgiving JSON extraction)
    let parsed;
    try {
      parsed = JSON.parse(result.content);
    } catch {
      const jsonMatch = result.content.match(/\{[\s\S]*\}/);
      if (jsonMatch) {
        try { parsed = JSON.parse(jsonMatch[0]); } catch { parsed = null; }
      }
    }

    if (parsed) {
      // Store patterns
      const newPatterns = Array.isArray(parsed.patterns) ? parsed.patterns : [];
      for (const p of newPatterns) {
        ls.patterns.push({ pattern: p, discoveredAt: new Date().toISOString(), confidence: parsed.confidence || 0.5 });
      }
      // Cap stored patterns
      if (ls.patterns.length > MAX_PATTERNS_PER_DOMAIN) {
        ls.patterns = ls.patterns.slice(-MAX_PATTERNS_PER_DOMAIN);
      }

      ls.lastRunAt = new Date().toISOString();
      ls.insightCount++;

      // Emit insight via WebSocket
      const insight = {
        domain,
        patterns: newPatterns.slice(0, 3),
        trend: parsed.trend || null,
        insight: parsed.insight || null,
        confidence: parsed.confidence || 0.5,
        dtuCount: dtus.length,
        timestamp: new Date().toISOString(),
      };

      realtimeEmit(`${domain}:insight`, insight);
      realtimeEmit("agent:insights", { ...insight, source: "lens-learning" });

      return { ok: true, domain, patterns: newPatterns.length, insight: parsed.insight };
    }

    return { ok: true, domain, patterns: 0, note: "brain_response_unparseable" };
  } catch (e) {
    ls.errors.push({ ts: Date.now(), error: String(e?.message || e) });
    if (ls.errors.length > 10) ls.errors.shift();
    return { ok: false, domain, error: String(e?.message || e) };
  }
}

export function getLensLearningStatus() {
  const status = {};
  for (const [domain, ls] of LEARNING_STATE) {
    status[domain] = {
      lastRunAt: ls.lastRunAt,
      patternCount: ls.patterns.length,
      insightCount: ls.insightCount,
      recentErrors: ls.errors.slice(-3),
    };
  }
  return status;
}

export function getLensPatterns(domain) {
  const ls = LEARNING_STATE.get(domain);
  if (!ls) return [];
  return ls.patterns;
}
