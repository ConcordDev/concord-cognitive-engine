/**
 * Knowledge Genome — Student's Intellectual DNA
 *
 * Tracks per-DTU mastery for a single user based on the types of
 * interactions they have with the DTU (read, cited, created, tested,
 * taught). Mastery is a number in [0, 1]. When a user masters a DTU the
 * mastery value spills over to DTUs in its citation graph neighborhood
 * so that learning cascades through the lattice.
 *
 * Gaps are detected when a student has high mastery for a DTU but low
 * mastery for the DTUs that DTU cites (i.e. they know the conclusion but
 * not the foundations). Strengths are domains where the student's
 * average mastery is high.
 *
 * The module is defensive: every method handles a missing `dtuStore`
 * gracefully, uses `semanticSearch` from `server/embeddings.js` when
 * available and falls back to tag overlap otherwise, and never throws.
 *
 * Persistence: if a `STATE.db` (better-sqlite3) is passed in, the
 * genome is serialized to a `knowledge_genomes` table. In-memory
 * singletons are cached per userId so repeated `getKnowledgeGenome`
 * calls return the same instance.
 *
 * @module knowledge-genome
 */

import logger from '../logger.js';

// ── Utilities ──────────────────────────────────────────────────────────────

/**
 * Extract citation parent ids from a DTU. Concord DTUs store citations
 * as `citations: [{ dtuId, relationship }]` but the legacy format also
 * used `refs` / `parents`, so we accept any of them.
 *
 * @param {object} dtu
 * @returns {string[]}
 */
function getCitationParents(dtu) {
  if (!dtu || typeof dtu !== 'object') return [];
  const out = [];
  const push = (v) => {
    if (!v) return;
    if (typeof v === 'string') out.push(v);
    else if (typeof v === 'object' && v.dtuId) out.push(String(v.dtuId));
    else if (typeof v === 'object' && v.id) out.push(String(v.id));
  };
  if (Array.isArray(dtu.citations)) dtu.citations.forEach(push);
  if (Array.isArray(dtu.refs)) dtu.refs.forEach(push);
  if (Array.isArray(dtu.parents)) dtu.parents.forEach(push);
  if (Array.isArray(dtu.prereqs)) dtu.prereqs.forEach(push);
  return Array.from(new Set(out.filter(Boolean)));
}

/**
 * Pull the domain / primary tag from a DTU. Falls back to `lens` and the
 * first tag.
 *
 * @param {object} dtu
 * @returns {string|null}
 */
function getDomain(dtu) {
  if (!dtu || typeof dtu !== 'object') return null;
  if (dtu.domain) return String(dtu.domain);
  if (dtu.lens) return String(dtu.lens);
  if (Array.isArray(dtu.tags) && dtu.tags.length > 0) return String(dtu.tags[0]);
  return null;
}

/**
 * Enumerate DTUs in a store. Handles Map-like stores (`values()`),
 * plain objects, and `list()`-shaped stores.
 *
 * @param {object|null} store
 * @returns {Iterable<object>}
 */
function* iterateStore(store) {
  if (!store) return;
  try {
    if (typeof store.values === 'function') {
      for (const v of store.values()) yield v;
      return;
    }
    if (typeof store.list === 'function') {
      const arr = store.list();
      if (Array.isArray(arr)) {
        for (const v of arr) yield v;
        return;
      }
    }
    if (typeof store[Symbol.iterator] === 'function') {
      for (const v of store) yield v;
      return;
    }
  } catch (_e) {
    // swallow — caller gets an empty iteration
  }
}

/**
 * Safe DTU lookup. Supports Map-like stores (`get()`) and falls back to
 * linear scan on plain objects.
 *
 * @param {object|null} store
 * @param {string} id
 * @returns {object|null}
 */
function getDTU(store, id) {
  if (!store || !id) return null;
  try {
    if (typeof store.get === 'function') {
      const v = store.get(id);
      if (v) return v;
    }
  } catch (_e) { /* swallow */ }
  try {
    for (const dtu of iterateStore(store)) {
      if (dtu && dtu.id === id) return dtu;
    }
  } catch (_e) { /* swallow */ }
  return null;
}

/**
 * Clamp a number into [lo, hi].
 */
function clamp(n, lo = 0, hi = 1) {
  if (!Number.isFinite(n)) return lo;
  return Math.max(lo, Math.min(hi, n));
}

// ── KnowledgeGenome ────────────────────────────────────────────────────────

export class KnowledgeGenome {
  /**
   * @param {string} userId
   * @param {object} [deps]
   * @param {object} [deps.dtuStore]
   * @param {object} [deps.embeddings] - { semanticSearch } exports from ../embeddings.js
   * @param {object} [deps.interactionStore] - optional object with `append` for audit
   * @param {object} [deps.db] - better-sqlite3 handle for persistence
   */
  constructor(userId, { dtuStore, embeddings, interactionStore, db } = {}) {
    this.userId = String(userId || 'anonymous');
    this.dtuStore = dtuStore || null;
    this.embeddings = embeddings || null;
    this.interactionStore = interactionStore || null;
    this.db = db || null;

    /** @type {Map<string, number>} dtuId → mastery in [0,1] */
    this.nodes = new Map();
    /** @type {Map<string, { source: string, target: string, strength: number }>} */
    this.edges = new Map();
    /** @type {Array<{ dtuId: string, type: string, at: string, mastery: number }>} */
    this.trajectory = [];
    /** @type {Set<string>} dtuIds where prereqs are missing */
    this.gaps = new Set();
    /** @type {Set<string>} domains with high mastery */
    this.strengths = new Set();

    this._lastUpdated = 0;
    this._dirty = false;
  }

  // Weights per interaction type — "taught" is highest because teaching
  // a concept proves you understand it more than merely reading it.
  static WEIGHTS = {
    read: 0.10,
    cited: 0.30,
    created: 0.50,
    tested: 0.40,
    taught: 0.60,
  };

  // How much a mastery gain propagates to citation neighbors.
  static SPILLOVER_RATIO = 0.25;

  // Threshold above which a node is considered "mastered".
  static MASTERY_THRESHOLD = 0.70;

  // Threshold below which a node (cited by a mastered one) is a gap.
  static GAP_THRESHOLD = 0.35;

  /**
   * Record an interaction of the given type against a DTU. Updates this
   * genome's mastery map, propagates a diminished gain to citation
   * parents, appends to the trajectory, and (if a db was provided)
   * persists. Never throws.
   *
   * @param {string} dtuId
   * @param {string} [type="read"]
   * @returns {Promise<{ dtuId: string, mastery: number, delta: number } | null>}
   */
  async recordInteraction(dtuId, type = 'read') {
    try {
      if (!dtuId) return null;
      const weight = KnowledgeGenome.WEIGHTS[type] ?? KnowledgeGenome.WEIGHTS.read;

      const before = this.nodes.get(dtuId) || 0;
      // Asymptotic mastery — diminishing returns as you approach 1.0.
      const after = clamp(before + weight * (1 - before));
      this.nodes.set(dtuId, after);

      const delta = after - before;

      // Spillover through citation graph — the DTUs this one cites get a
      // smaller share, because studying a conclusion implicitly exercises
      // its foundations.
      try {
        const dtu = getDTU(this.dtuStore, dtuId);
        const parents = getCitationParents(dtu);
        const share = delta * KnowledgeGenome.SPILLOVER_RATIO;
        for (const pid of parents) {
          const pBefore = this.nodes.get(pid) || 0;
          const pAfter = clamp(pBefore + share * (1 - pBefore));
          this.nodes.set(pid, pAfter);
          const edgeKey = `${dtuId}->${pid}`;
          const prior = this.edges.get(edgeKey);
          const strength = prior ? clamp(prior.strength + 0.1) : 0.3;
          this.edges.set(edgeKey, { source: dtuId, target: pid, strength });
        }
      } catch (_e) { /* propagation is best-effort */ }

      // Record trajectory
      const at = new Date().toISOString();
      this.trajectory.push({ dtuId, type, at, mastery: after });
      if (this.trajectory.length > 2000) {
        this.trajectory.splice(0, this.trajectory.length - 2000);
      }

      // Audit to the interactionStore if supplied
      try {
        if (this.interactionStore && typeof this.interactionStore.append === 'function') {
          this.interactionStore.append({
            userId: this.userId, dtuId, type, at, mastery: after,
          });
        }
      } catch (_e) { /* swallow */ }

      this._lastUpdated = Date.now();
      this._dirty = true;

      // Recompute gaps and strengths incrementally (cheap for small graphs).
      await this.recalculateGaps();

      // Persist lazily (fire and forget).
      this.persist().catch(err => logger?.debug?.('[knowledge-genome] background op failed', { err: err?.message }));

      return { dtuId, mastery: after, delta };
    } catch (e) {
      try { logger.debug('knowledge-genome', 'record_interaction_failed', { error: e?.message }); } catch (_e) { /* swallow */ }
      return null;
    }
  }

  /**
   * Scan the mastery map and recompute the gap set. A gap is a DTU where
   * the student has mastered the node itself but the citation parents
   * (foundations) are below the gap threshold. Strengths are domains
   * whose average node mastery exceeds the mastery threshold.
   *
   * @returns {Promise<{ gaps: string[], strengths: string[] }>}
   */
  async recalculateGaps() {
    try {
      const gaps = new Set();
      const domainTotals = new Map(); // domain → { sum, count }

      for (const [dtuId, mastery] of this.nodes.entries()) {
        const dtu = getDTU(this.dtuStore, dtuId);
        if (dtu) {
          const domain = getDomain(dtu);
          if (domain) {
            const slot = domainTotals.get(domain) || { sum: 0, count: 0 };
            slot.sum += mastery;
            slot.count += 1;
            domainTotals.set(domain, slot);
          }
        }
        if (mastery < KnowledgeGenome.MASTERY_THRESHOLD) continue;

        const parents = getCitationParents(dtu);
        for (const pid of parents) {
          const pm = this.nodes.get(pid) || 0;
          if (pm < KnowledgeGenome.GAP_THRESHOLD) {
            gaps.add(pid);
          }
        }
      }

      this.gaps = gaps;

      const strengths = new Set();
      for (const [domain, { sum, count }] of domainTotals.entries()) {
        if (count > 0 && sum / count >= KnowledgeGenome.MASTERY_THRESHOLD) {
          strengths.add(domain);
        }
      }
      this.strengths = strengths;

      return { gaps: Array.from(gaps), strengths: Array.from(strengths) };
    } catch (e) {
      try { logger.debug('knowledge-genome', 'recalculate_gaps_failed', { error: e?.message }); } catch (_e) { /* swallow */ }
      return { gaps: [], strengths: [] };
    }
  }

  /**
   * Find DTUs semantically related to a given DTU. Prefers the semantic
   * search path (embeddings.semanticSearch) and falls back to tag
   * overlap when embeddings are unavailable.
   *
   * @param {string} dtuId
   * @param {number} [limit=10]
   * @returns {Promise<Array<{ id: string, score: number }>>}
   */
  async getRelatedDTUs(dtuId, limit = 10) {
    try {
      const source = getDTU(this.dtuStore, dtuId);
      if (!source) return [];

      const candidates = [];
      for (const dtu of iterateStore(this.dtuStore)) {
        if (dtu && dtu.id && dtu.id !== dtuId) candidates.push(dtu);
      }
      if (candidates.length === 0) return [];

      // Semantic path
      if (this.embeddings && typeof this.embeddings.semanticSearch === 'function') {
        const queryText = [
          source.title || '',
          Array.isArray(source.tags) ? source.tags.join(' ') : '',
          source.human?.summary || source.cretiHuman || source.creti || '',
        ].filter(Boolean).join(' ');
        try {
          const hits = await this.embeddings.semanticSearch(queryText, candidates, { topK: limit });
          if (Array.isArray(hits) && hits.length > 0) {
            return hits.map(h => ({ id: h.id, score: h.score || h.rawSimilarity || 0 }));
          }
        } catch (_e) { /* fallback below */ }
      }

      // Tag-overlap fallback
      const sourceTags = new Set((source.tags || []).map(t => String(t).toLowerCase()));
      const scored = candidates.map(d => {
        const dTags = new Set((d.tags || []).map(t => String(t).toLowerCase()));
        let overlap = 0;
        for (const t of sourceTags) if (dTags.has(t)) overlap++;
        const denom = Math.max(sourceTags.size, dTags.size, 1);
        return { id: d.id, score: overlap / denom };
      });
      scored.sort((a, b) => b.score - a.score);
      return scored.filter(s => s.score > 0).slice(0, limit);
    } catch (_e) {
      return [];
    }
  }

  /**
   * Get the strongest N nodes by mastery.
   * @param {number} [limit=10]
   * @returns {Array<{ id: string, mastery: number }>}
   */
  getStrongestNodes(limit = 10) {
    try {
      return Array.from(this.nodes.entries())
        .map(([id, mastery]) => ({ id, mastery }))
        .sort((a, b) => b.mastery - a.mastery)
        .slice(0, limit);
    } catch (_e) {
      return [];
    }
  }

  /**
   * Return the domain with the highest average mastery across all
   * touched nodes, or null if no domains can be resolved.
   *
   * @returns {{ domain: string, average: number, count: number } | null}
   */
  getStrongestDomain() {
    try {
      const totals = new Map();
      for (const [dtuId, mastery] of this.nodes.entries()) {
        const dtu = getDTU(this.dtuStore, dtuId);
        const domain = getDomain(dtu);
        if (!domain) continue;
        const slot = totals.get(domain) || { sum: 0, count: 0 };
        slot.sum += mastery;
        slot.count += 1;
        totals.set(domain, slot);
      }
      let best = null;
      for (const [domain, { sum, count }] of totals.entries()) {
        const avg = sum / count;
        if (!best || avg > best.average) best = { domain, average: avg, count };
      }
      return best;
    } catch (_e) {
      return null;
    }
  }

  /**
   * Compute learning velocity as the mastery gain over the last hour (or
   * as much trajectory as we have). Returns gain per minute.
   *
   * @returns {{ perMinute: number, windowMinutes: number, interactions: number }}
   */
  calculateVelocity() {
    try {
      const now = Date.now();
      const WINDOW_MS = 60 * 60 * 1000; // 1h
      const windowStart = now - WINDOW_MS;
      const window = this.trajectory.filter(t => new Date(t.at).getTime() >= windowStart);
      if (window.length === 0) {
        return { perMinute: 0, windowMinutes: 0, interactions: 0 };
      }
      // Sum gains in window (each trajectory entry records post-state; we
      // approximate gain as the delta from the entry's previous recorded
      // mastery on the same dtuId).
      const prevByDTU = new Map();
      let gain = 0;
      for (const t of window) {
        const prev = prevByDTU.get(t.dtuId) ?? 0;
        gain += Math.max(0, t.mastery - prev);
        prevByDTU.set(t.dtuId, t.mastery);
      }
      const firstAt = new Date(window[0].at).getTime();
      const elapsedMinutes = Math.max((now - firstAt) / 60000, 1);
      return {
        perMinute: gain / elapsedMinutes,
        windowMinutes: Math.round(elapsedMinutes),
        interactions: window.length,
      };
    } catch (_e) {
      return { perMinute: 0, windowMinutes: 0, interactions: 0 };
    }
  }

  /**
   * Compute the readiness (%) of a student for a DTU: the fraction of the
   * DTU's cited parents that the student has mastered above the mastery
   * threshold. A DTU with no citations is always 100% ready.
   *
   * @param {object|string} dtu - DTU object or DTU id
   * @returns {number} 0..1
   */
  calculateReadiness(dtu) {
    try {
      const d = typeof dtu === 'string' ? getDTU(this.dtuStore, dtu) : dtu;
      if (!d) return 0;
      const parents = getCitationParents(d);
      if (parents.length === 0) return 1;
      let mastered = 0;
      for (const pid of parents) {
        const m = this.nodes.get(pid) || 0;
        if (m >= KnowledgeGenome.MASTERY_THRESHOLD) mastered++;
      }
      return mastered / parents.length;
    } catch (_e) {
      return 0;
    }
  }

  /**
   * Estimate study time (in minutes) for a DTU based on content length,
   * tag count, and the student's current mastery of the DTU.
   *
   * @param {object|string} dtu
   * @returns {number} minutes
   */
  estimateTime(dtu) {
    try {
      const d = typeof dtu === 'string' ? getDTU(this.dtuStore, dtu) : dtu;
      if (!d) return 5;
      const text = [
        d.title || '',
        d.human?.summary || d.cretiHuman || d.creti || '',
        Array.isArray(d.human?.bullets) ? d.human.bullets.join(' ') : '',
        Array.isArray(d.core?.definitions) ? d.core.definitions.join(' ') : '',
        Array.isArray(d.core?.claims) ? d.core.claims.join(' ') : '',
      ].filter(Boolean).join(' ');
      const words = text.split(/\s+/).filter(Boolean).length;
      // 200 words per minute, plus a complexity bump per tag, minus
      // mastery (if you already know the material it takes less time).
      const base = Math.max(words / 200, 1);
      const complexity = 1 + (Array.isArray(d.tags) ? d.tags.length : 0) * 0.05;
      const mastery = this.nodes.get(d.id) || 0;
      const minutes = base * complexity * (1 - 0.6 * mastery);
      return Math.max(1, Math.round(minutes));
    } catch (_e) {
      return 5;
    }
  }

  /**
   * Serialize to the knowledge_genomes table if a db is available. Uses
   * INSERT OR REPLACE so each call rewrites the user's row.
   *
   * @returns {Promise<boolean>} true if persisted
   */
  async persist() {
    try {
      if (!this.db) return false;
      this._ensureTable();
      const payload = JSON.stringify({
        nodes: Array.from(this.nodes.entries()),
        edges: Array.from(this.edges.values()),
        trajectory: this.trajectory.slice(-500),
        gaps: Array.from(this.gaps),
        strengths: Array.from(this.strengths),
        lastUpdated: this._lastUpdated,
      });
      this.db.prepare(
        'INSERT OR REPLACE INTO knowledge_genomes (user_id, data, updated_at) VALUES (?, ?, ?)'
      ).run(this.userId, payload, new Date().toISOString());
      this._dirty = false;
      return true;
    } catch (e) {
      try { logger.debug('knowledge-genome', 'persist_failed', { error: e?.message }); } catch (_e) { /* swallow */ }
      return false;
    }
  }

  /**
   * Load this genome from the database into memory.
   * @returns {Promise<boolean>} true if loaded
   */
  async load() {
    try {
      if (!this.db) return false;
      this._ensureTable();
      const row = this.db.prepare(
        'SELECT data FROM knowledge_genomes WHERE user_id = ?'
      ).get(this.userId);
      if (!row || !row.data) return false;
      const parsed = JSON.parse(row.data);
      this.nodes = new Map(parsed.nodes || []);
      this.edges = new Map((parsed.edges || []).map(e => [`${e.source}->${e.target}`, e]));
      this.trajectory = Array.isArray(parsed.trajectory) ? parsed.trajectory : [];
      this.gaps = new Set(parsed.gaps || []);
      this.strengths = new Set(parsed.strengths || []);
      this._lastUpdated = Number(parsed.lastUpdated || 0);
      return true;
    } catch (e) {
      try { logger.debug('knowledge-genome', 'load_failed', { error: e?.message }); } catch (_e) { /* swallow */ }
      return false;
    }
  }

  _ensureTable() {
    if (!this.db) return;
    try {
      this.db.exec(`
        CREATE TABLE IF NOT EXISTS knowledge_genomes (
          user_id TEXT PRIMARY KEY,
          data TEXT NOT NULL,
          updated_at TEXT NOT NULL
        )
      `);
    } catch (_e) { /* swallow */ }
  }

  /**
   * Build a graph-shaped representation for visualization.
   * @returns {{ nodes: object[], edges: object[], stats: object }}
   */
  toGraph() {
    try {
      const nodes = [];
      for (const [id, mastery] of this.nodes.entries()) {
        const dtu = getDTU(this.dtuStore, id);
        nodes.push({
          id,
          mastery,
          title: dtu?.title || id,
          domain: getDomain(dtu),
          tier: dtu?.tier || 'regular',
          gap: this.gaps.has(id),
        });
      }
      const edges = Array.from(this.edges.values());
      return {
        nodes,
        edges,
        stats: this.toSummary(),
      };
    } catch (_e) {
      return { nodes: [], edges: [], stats: this.toSummary() };
    }
  }

  /**
   * Quick summary object for dashboards / status endpoints.
   * @returns {object}
   */
  toSummary() {
    try {
      const nodeCount = this.nodes.size;
      let sum = 0;
      let mastered = 0;
      for (const m of this.nodes.values()) {
        sum += m;
        if (m >= KnowledgeGenome.MASTERY_THRESHOLD) mastered++;
      }
      return {
        userId: this.userId,
        nodeCount,
        edgeCount: this.edges.size,
        gapCount: this.gaps.size,
        strengthCount: this.strengths.size,
        masteredCount: mastered,
        averageMastery: nodeCount > 0 ? sum / nodeCount : 0,
        interactions: this.trajectory.length,
        lastUpdated: this._lastUpdated,
        strongestDomain: this.getStrongestDomain(),
        velocity: this.calculateVelocity(),
      };
    } catch (_e) {
      return {
        userId: this.userId,
        nodeCount: 0,
        edgeCount: 0,
        gapCount: 0,
        strengthCount: 0,
        masteredCount: 0,
        averageMastery: 0,
        interactions: 0,
        lastUpdated: 0,
        strongestDomain: null,
        velocity: { perMinute: 0, windowMinutes: 0, interactions: 0 },
      };
    }
  }
}

// ── Factory + cached singletons ────────────────────────────────────────────

/** @type {Map<string, KnowledgeGenome>} */
const _genomeCache = new Map();

/**
 * Create a fresh KnowledgeGenome instance (non-cached).
 *
 * @param {string} userId
 * @param {object} [deps]
 * @returns {KnowledgeGenome}
 */
export function createKnowledgeGenome(userId, deps = {}) {
  return new KnowledgeGenome(userId, deps);
}

/**
 * Return the cached KnowledgeGenome for a user, loading from the db if
 * one exists and no instance is cached yet.
 *
 * @param {string} userId
 * @param {object} [deps]
 * @returns {Promise<KnowledgeGenome>}
 */
export async function getKnowledgeGenome(userId, deps = {}) {
  try {
    const key = String(userId || 'anonymous');
    let genome = _genomeCache.get(key);
    if (genome) return genome;
    genome = new KnowledgeGenome(key, deps);
    try {
      await genome.load();
    } catch (_e) { /* swallow */ }
    _genomeCache.set(key, genome);
    return genome;
  } catch (_e) {
    return new KnowledgeGenome(userId, deps);
  }
}

/**
 * Clear the in-memory genome cache. Primarily useful for tests.
 */
export function clearKnowledgeGenomeCache() {
  _genomeCache.clear();
}

export default {
  KnowledgeGenome,
  createKnowledgeGenome,
  getKnowledgeGenome,
  clearKnowledgeGenomeCache,
};
