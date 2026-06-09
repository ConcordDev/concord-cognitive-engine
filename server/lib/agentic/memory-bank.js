// server/lib/agentic/memory-bank.js
// Three-layer memory API: episodic, semantic, procedural.
// Async writes by default so memory never blocks reasoning.
// Returns prompt-ready blocks for injection into inference context.

const MEMORY_LAYERS = Object.freeze({
  episodic: {
    description: "What happened — events indexed by time and session",
    storageType: "shadow_dtus",
    retrieval: "temporal+semantic",
  },
  semantic: {
    description: "What is true — DTU substrate indexed by lineage and topic",
    storageType: "dtus",
    retrieval: "lineage+semantic",
  },
  procedural: {
    description: "How to do things — skill registry",
    storageType: "skills",
    retrieval: "skill_registry",
  },
  action: {
    description: "What I did — durable log of past actions / tool outputs (Phase 6 long-term memory)",
    storageType: "agent_action_log",
    retrieval: "relevance+recency",
  },
});

// Async write queue: entries are { layer, content, options, resolve, reject }
const _writeQueue = [];
let _draining = false;

async function drainWriteQueue() {
  if (_draining) return;
  _draining = true;
  while (_writeQueue.length > 0) {
    const item = _writeQueue.shift();
    try {
      const result = await syncMemoryWrite(item.layer, item.content, item.options);
      item.resolve(result);
    } catch (err) {
      item.reject(err);
    }
  }
  _draining = false;
}

/**
 * Synchronous memory write — used internally and when sync is explicitly requested.
 */
async function syncMemoryWrite(layer, content, options = {}) {
  switch (layer) {
    case "episodic": {
      // Write shadow DTU via personal locker if sessionKey available
      const { maybeCrystallize } = await import("./../../lib/chat/shadow-crystallization.js").catch(() => ({}));
      if (maybeCrystallize && options.userId && options.sessionKey && options.db) {
        return maybeCrystallize({
          sessionId: options.sessionId || "memory-bank",
          userId: options.userId,
          userMessage: content.intent || "",
          assistantResponse: content.outcome || "",
          dtuRefsUsed: content.lineage || [],
          sessionKey: options.sessionKey,
          db: options.db,
        });
      }
      return { written: false, reason: "episodic requires userId, sessionKey, db" };
    }

    case "semantic": {
      // Semantic memory is the public DTU substrate — managed by existing DTU pipeline
      // Callers should use createDTU() from economy/dtu-pipeline.js directly
      return { written: false, reason: "semantic layer: use createDTU() from dtu-pipeline directly" };
    }

    case "procedural": {
      // Procedural memory is the skills registry — managed by skills.js
      return { written: false, reason: "procedural layer: add skills via skill files" };
    }

    case "action": {
      // Durable agent action log (Phase 6 long-term memory).
      const { recordAction } = await import("../agent-action-log.js");
      const ok = await recordAction(options.db, {
        userId: options.userId,
        sessionId: options.sessionId || null,
        action: content.action,
        input: content.input,
        output: content.output ?? content.outcome,
        tool: content.tool,
        outcome: content.outcome,
      });
      return { written: !!ok };
    }

    default:
      throw new Error(`Unknown memory layer: "${layer}"`);
  }
}

/**
 * Write to a memory layer.
 * Async by default (queued, non-blocking). Pass sync: true only when ordering matters.
 *
 * @param {'episodic'|'semantic'|'procedural'} layer
 * @param {object} content
 * @param {{ async?: boolean, userId?: string, sessionKey?: Buffer, db?: object, sessionId?: string }} [options]
 * @returns {Promise<{queued: boolean} | object>}
 */
export async function writeMemory(layer, content, options = {}) {
  if (!MEMORY_LAYERS[layer]) throw new Error(`Unknown memory layer: "${layer}"`);

  if (options.async === false) {
    // Synchronous path — blocks until written
    return syncMemoryWrite(layer, content, options);
  }

  // Async path — queue and return immediately
  return new Promise((resolve, reject) => {
    _writeQueue.push({ layer, content, options, resolve, reject });
    setImmediate(drainWriteQueue);
  }).catch(() => ({ queued: true, failed: true }));
}

/**
 * Read from one or more memory layers, returning prompt-ready blocks.
 *
 * @param {object} opts
 * @param {string[]} [opts.layers] - which layers to query
 * @param {string} opts.query - search query
 * @param {number} [opts.limit=5]
 * @param {string} [opts.userId]
 * @param {Buffer} [opts.sessionKey]
 * @param {object} [opts.db]
 * @returns {Promise<Array<{layer: string, block: string, items: object[]}>>}
 */
export async function readMemory({ layers = ["episodic", "semantic", "procedural"], query, limit = 5, userId, sessionKey, db }) {
  const results = [];

  for (const layer of layers) {
    try {
      switch (layer) {
        case "episodic": {
          const { fetchRelevantShadowDTUs, formatShadowContext } = await import("../chat/substrate-retrieval.js");
          const shadows = await fetchRelevantShadowDTUs({ userId, sessionKey, query, db, limit });
          results.push({
            layer,
            block: formatShadowContext(shadows),
            items: shadows,
          });
          break;
        }

        case "semantic": {
          // Query public DTU substrate — basic keyword match
          if (!db) break;
          const rows = db.prepare(
            "SELECT id, title, content FROM dtus WHERE content LIKE ? LIMIT ?"
          ).all(`%${query.slice(0, 50)}%`, limit);
          const block = rows.length
            ? `[SEMANTIC MEMORY]\n${rows.map(r => `• ${r.title}: ${(r.content || "").slice(0, 200)}`).join("\n")}`
            : "";
          results.push({ layer, block, items: rows });
          break;
        }

        case "procedural": {
          // Return skill descriptions — loaded by skills registry if available
          results.push({ layer, block: "", items: [] });
          break;
        }

        case "action": {
          // Durable agent action log — relevance × recency recall (Phase 6).
          const { getRecentActions } = await import("../agent-action-log.js");
          const { actions, block } = await getRecentActions(db, { userId, query, limit });
          results.push({ layer, block, items: actions });
          break;
        }
      }
    } catch {
      results.push({ layer, block: "", items: [] });
    }
  }

  return results;
}

export { MEMORY_LAYERS };
