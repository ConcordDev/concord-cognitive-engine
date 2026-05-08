/**
 * Feasibility Navigator — Learning Path Engine
 *
 * Runs an A* search through the DTU citation graph to produce learning
 * paths tailored to a student's Knowledge Genome. The cost function is
 * derived from the student's readiness (1 - readiness) so nodes the
 * student is already prepared for are cheap, and the heuristic uses
 * semantic distance (via embeddings) when available, falling back to
 * tag-overlap Jaccard distance.
 *
 * The navigator also offers:
 *   - `getReachableFrontier` — DTUs the student could realistically
 *     study next given current mastery.
 *   - `getDomainCoreDTUs`    — spine of a domain, ordered by depth.
 *   - `classifyStep`         — map a DTU to a pedagogical verb.
 *   - `findBranchingPoints`  — places where a learner can fork to a
 *     related sub-topic without leaving the path.
 *   - `adaptPath`            — compress or insert detours based on
 *     recent performance.
 *   - `findPrereqGaps`       — missing foundations for a target DTU.
 *
 * All methods are defensive — they catch every error and return sane
 * empty values rather than throwing.
 *
 * @module feasibility-navigator
 */

import logger from '../logger.js';

// ── Utility helpers ────────────────────────────────────────────────────────

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

function getDomain(dtu) {
  if (!dtu || typeof dtu !== 'object') return null;
  if (dtu.domain) return String(dtu.domain);
  if (dtu.lens) return String(dtu.lens);
  if (Array.isArray(dtu.tags) && dtu.tags.length > 0) return String(dtu.tags[0]);
  return null;
}

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
      
    }
  } catch (_e) { /* swallow */ }
}

function getDTU(store, id) {
  if (!store || !id) return null;
  try {
    if (typeof store.get === 'function') {
      const v = store.get(id);
      if (v) return v;
    }
  } catch (_e) { /* swallow */ }
  for (const dtu of iterateStore(store)) {
    if (dtu && dtu.id === id) return dtu;
  }
  return null;
}

function tagJaccardDistance(a, b) {
  const aSet = new Set((a?.tags || []).map(t => String(t).toLowerCase()));
  const bSet = new Set((b?.tags || []).map(t => String(t).toLowerCase()));
  if (aSet.size === 0 && bSet.size === 0) return 1;
  let inter = 0;
  for (const t of aSet) if (bSet.has(t)) inter++;
  const union = aSet.size + bSet.size - inter;
  if (union === 0) return 1;
  return 1 - inter / union;
}

/**
 * Map a DTU onto the navigator's pedagogical step vocabulary.
 *
 * Concord's DTU epistemicClass is known|probable|uncertain|unknown, so
 * we use the DTU tier, tags, and machine.kind to produce a better
 * classification in the navigator's own vocabulary: proof | experiment
 * | study | discuss | build | explore.
 */
function classifyDTU(dtu) {
  if (!dtu || typeof dtu !== 'object') return 'study';
  const kind = String(dtu.machine?.kind || '').toLowerCase();
  const tags = Array.isArray(dtu.tags) ? dtu.tags.map(t => String(t).toLowerCase()) : [];
  const tier = String(dtu.tier || '').toLowerCase();
  const ep = String(dtu.epistemicClass || '').toLowerCase();

  if (kind.includes('formal') || tags.some(t => /proof|theorem|lemma|axiom/.test(t))) return 'proof';
  if (kind.includes('experiment') || tags.some(t => /experiment|trial|measure|test/.test(t))) return 'experiment';
  if (tags.some(t => /discuss|debate|dialogue|ethic/.test(t))) return 'discuss';
  if (tags.some(t => /build|project|make|craft|construct|code/.test(t))) return 'build';
  if (ep === 'unknown' || tags.some(t => /explore|frontier|open/.test(t))) return 'explore';
  if (tier === 'core' || tier === 'mega' || tier === 'hyper') return 'study';
  return 'study';
}

// ── FeasibilityNavigator ───────────────────────────────────────────────────

export class FeasibilityNavigator {
  /**
   * @param {object} [deps]
   * @param {object} [deps.dtuStore]
   * @param {object} [deps.embeddings] - { semanticSearch, embed, cosineSimilarity }
   */
  constructor({ dtuStore, embeddings } = {}) {
    this.dtuStore = dtuStore || null;
    this.embeddings = embeddings || null;

    this._metrics = {
      pathsFound: 0,
      searchSteps: 0,
      adaptations: 0,
      lastSearchMs: 0,
    };
  }

  /**
   * Find a learning path from the student's current strongest position
   * into a target domain. Returns a sequence of DTUs ordered pedagogically.
   *
   * @param {import('./knowledge-genome.js').KnowledgeGenome} genome
   * @param {string} targetDomain
   * @param {number} [targetDepth=3]
   * @returns {Promise<{ path: object[], cost: number, classification: string[], branchingPoints: object[] }>}
   */
  async findPath(genome, targetDomain, targetDepth = 3) {
    try {
      if (!this.dtuStore) {
        return { path: [], cost: 0, classification: [], branchingPoints: [] };
      }

      // Targets: domain core DTUs.
      const goals = await this.getDomainCoreDTUs(targetDomain, targetDepth);
      if (goals.length === 0) {
        return { path: [], cost: 0, classification: [], branchingPoints: [] };
      }

      // Start point: user's strongest existing node (if any), else a
      // root DTU within the target domain, else the first goal itself.
      let start = null;
      if (genome) {
        const strongest = genome.getStrongestNodes(1);
        if (strongest.length > 0) {
          const dtu = getDTU(this.dtuStore, strongest[0].id);
          if (dtu) start = dtu;
        }
      }
      if (!start) {
        // Fall back to a "root" DTU in the domain (the DTU with the
        // fewest parents).
        start = goals.reduce((a, b) =>
          getCitationParents(a).length <= getCitationParents(b).length ? a : b,
        );
      }

      const costFn = (dtu) => {
        if (!dtu) return 1;
        const readiness = genome ? genome.calculateReadiness(dtu) : 0.5;
        return 1 - readiness + 0.05; // small baseline cost per step
      };

      const heuristicFn = async (dtu, goalSet) => {
        if (!dtu) return 1;
        // Distance to the nearest goal: lower is better.
        let best = 1;
        for (const g of goalSet) {
          const d = tagJaccardDistance(dtu, g);
          if (d < best) best = d;
        }
        return best;
      };

      const result = await this.aStarSearch({
        start,
        goals,
        costFn,
        heuristicFn,
        maxSteps: 50,
      });

      const path = result.path;
      const classification = path.map((d, i) => this.classifyStep(d, i, path));
      const branchingPoints = this.findBranchingPoints(path);
      this._metrics.pathsFound++;

      return {
        path,
        cost: result.cost,
        classification,
        branchingPoints,
      };
    } catch (e) {
      try { logger.debug('feasibility-navigator', 'find_path_failed', { error: e?.message }); } catch (_e) { /* swallow */ }
      return { path: [], cost: 0, classification: [], branchingPoints: [] };
    }
  }

  /**
   * Generic A* search through the citation graph.
   *
   * @param {object} opts
   * @param {object}   opts.start         - Start DTU
   * @param {object[]} opts.goals         - Goal DTUs (any one hits)
   * @param {Function} opts.costFn        - (dtu) => number
   * @param {Function} opts.heuristicFn   - async (dtu, goals) => number
   * @param {number}   [opts.maxSteps=50]
   * @returns {Promise<{ path: object[], cost: number, hit: object|null }>}
   */
  async aStarSearch({ start, goals, costFn, heuristicFn, maxSteps = 50 }) {
    const t0 = Date.now();
    try {
      if (!start || !Array.isArray(goals) || goals.length === 0) {
        return { path: [], cost: 0, hit: null };
      }
      const goalIds = new Set(goals.map(g => g.id));

      // Open set: priority queue implemented as sorted array of
      // { node, f, g, prev }.
      const open = [{ node: start, f: 0, g: 0, prev: null }];
      /** @type {Map<string, {g: number, prev: string|null, node: object}>} */
      const closed = new Map();

      let hit = null;
      let steps = 0;

      while (open.length > 0 && steps < maxSteps) {
        // Pop lowest f.
        open.sort((a, b) => a.f - b.f);
        const current = open.shift();
        const cur = current.node;
        if (!cur || !cur.id) continue;
        if (closed.has(cur.id)) continue;
        closed.set(cur.id, { g: current.g, prev: current.prev, node: cur });
        this._metrics.searchSteps++;
        steps++;

        if (goalIds.has(cur.id)) {
          hit = cur;
          break;
        }

        // Expand neighbors: forward via citation children (DTUs that
        // cite cur) and sideways via related tags.
        const neighbors = this._neighbors(cur);
        for (const n of neighbors) {
          if (!n || !n.id || closed.has(n.id)) continue;
          const stepCost = costFn(n);
          const g2 = current.g + stepCost;
          const h = await heuristicFn(n, goals);
          const f = g2 + h;
          open.push({ node: n, f, g: g2, prev: cur.id });
        }
      }

      this._metrics.lastSearchMs = Date.now() - t0;

      if (!hit) return { path: [], cost: 0, hit: null };

      // Reconstruct path.
      const path = [];
      let cursor = hit.id;
      while (cursor) {
        const entry = closed.get(cursor);
        if (!entry) break;
        path.unshift(entry.node);
        cursor = entry.prev;
      }
      const cost = closed.get(hit.id)?.g || 0;
      return { path, cost, hit };
    } catch (e) {
      try { logger.debug('feasibility-navigator', 'a_star_failed', { error: e?.message }); } catch (_e) { /* swallow */ }
      return { path: [], cost: 0, hit: null };
    }
  }

  /**
   * Return the citation-graph neighbors of a DTU. The "forward"
   * neighbors are DTUs that cite `cur` (children in the learning
   * direction); we also include the DTUs `cur` cites (foundations) so
   * the search can reach earlier material if it's missing.
   *
   * @param {object} cur
   * @returns {object[]}
   */
  _neighbors(cur) {
    const out = [];
    if (!this.dtuStore || !cur) return out;
    try {
      // Foundations (cited by cur).
      for (const pid of getCitationParents(cur)) {
        const d = getDTU(this.dtuStore, pid);
        if (d) out.push(d);
      }
      // Children (DTUs that cite cur).
      for (const dtu of iterateStore(this.dtuStore)) {
        if (!dtu || !dtu.id) continue;
        const parents = getCitationParents(dtu);
        if (parents.includes(cur.id)) out.push(dtu);
      }
    } catch (_e) { /* swallow */ }
    return out;
  }

  /**
   * The "reachable frontier" is the set of DTUs the student is ready to
   * tackle next — unmastered DTUs whose readiness is high enough and
   * whose semantic distance from the student's current strongest node
   * is under maxDistance.
   *
   * @param {import('./knowledge-genome.js').KnowledgeGenome} genome
   * @param {object} [opts]
   * @param {number} [opts.limit=20]
   * @param {number} [opts.maxDistance=0.4]
   * @returns {Promise<Array<{ id: string, readiness: number, distance: number, dtu: object }>>}
   */
  async getReachableFrontier(genome, { limit = 20, maxDistance = 0.4 } = {}) {
    try {
      if (!this.dtuStore) return [];

      const candidates = [];
      for (const dtu of iterateStore(this.dtuStore)) {
        if (!dtu || !dtu.id) continue;
        const mastered = genome && (genome.nodes.get(dtu.id) || 0) >= 0.7;
        if (mastered) continue;
        candidates.push(dtu);
      }
      if (candidates.length === 0) return [];

      // Reference node: strongest known, or null.
      let reference = null;
      if (genome) {
        const strongest = genome.getStrongestNodes(1);
        if (strongest.length > 0) reference = getDTU(this.dtuStore, strongest[0].id);
      }

      const scored = [];
      for (const d of candidates) {
        const readiness = genome ? genome.calculateReadiness(d) : 0.5;
        if (readiness < 0.3) continue; // too far from what's known
        const distance = reference ? tagJaccardDistance(reference, d) : 0;
        if (distance > maxDistance) continue;
        scored.push({ id: d.id, readiness, distance, dtu: d });
      }

      scored.sort((a, b) => (b.readiness - a.readiness) || (a.distance - b.distance));
      return scored.slice(0, limit);
    } catch (_e) {
      return [];
    }
  }

  /**
   * Find the "core" DTUs for a domain: the spine of a topic, ordered
   * from foundation to frontier. `depth` limits how deep to dive.
   *
   * @param {string} domain
   * @param {number} [depth=3]
   * @returns {Promise<object[]>}
   */
  async getDomainCoreDTUs(domain, depth = 3) {
    try {
      if (!this.dtuStore || !domain) return [];
      const d = String(domain).toLowerCase();
      const members = [];
      for (const dtu of iterateStore(this.dtuStore)) {
        if (!dtu || !dtu.id) continue;
        const dom = getDomain(dtu);
        if (!dom || String(dom).toLowerCase() !== d) continue;
        members.push(dtu);
      }

      // Score by tier (core > mega > hyper > regular), citation count,
      // and subjectivity to depth.
      const tierRank = { core: 4, hyper: 3, mega: 2, regular: 1 };
      members.sort((a, b) => {
        const ta = tierRank[String(a.tier || 'regular').toLowerCase()] || 1;
        const tb = tierRank[String(b.tier || 'regular').toLowerCase()] || 1;
        if (ta !== tb) return tb - ta;
        const pa = getCitationParents(a).length;
        const pb = getCitationParents(b).length;
        return pa - pb;
      });

      // `depth` controls breadth of the core: deeper = more DTUs.
      const limit = Math.max(1, depth) * 5;
      return members.slice(0, limit);
    } catch (_e) {
      return [];
    }
  }

  /**
   * Map a DTU + position into a pedagogical step classification.
   * Returns one of: 'proof' | 'experiment' | 'study' | 'discuss' | 'build' | 'explore'.
   *
   * @param {object} dtu
   * @param {number} index
   * @param {object[]} path
   * @returns {string}
   */
  classifyStep(dtu, index, path) {
    try {
      const base = classifyDTU(dtu);
      // Slight bias: the first step is more often 'study', the last is
      // more often 'build' or 'explore'.
      if (index === 0 && base === 'explore') return 'study';
      if (Array.isArray(path) && index === path.length - 1 && base === 'study') {
        return 'build';
      }
      return base;
    } catch (_e) {
      return 'study';
    }
  }

  /**
   * Find branching points along a path — places where the student could
   * fork into a related topic and come back. A branching point is any
   * step with > 1 high-tier neighbor outside the main path.
   *
   * @param {object[]} path
   * @returns {Array<{ index: number, dtuId: string, branches: string[] }>}
   */
  findBranchingPoints(path) {
    try {
      if (!Array.isArray(path) || path.length === 0) return [];
      const pathIds = new Set(path.map(p => p && p.id).filter(Boolean));
      const out = [];
      for (let i = 0; i < path.length; i++) {
        const node = path[i];
        if (!node) continue;
        const neighbors = this._neighbors(node).filter(n =>
          n && n.id && !pathIds.has(n.id),
        );
        const highTier = neighbors.filter(n =>
          ['core', 'hyper', 'mega'].includes(String(n.tier || '').toLowerCase()),
        );
        if (highTier.length >= 2) {
          out.push({
            index: i,
            dtuId: node.id,
            branches: highTier.slice(0, 5).map(n => n.id),
          });
        }
      }
      return out;
    } catch (_e) {
      return [];
    }
  }

  /**
   * Adapt an existing path based on the student's performance on the
   * current step.
   *
   *   performance > 0.9 → compress (skip redundant next steps)
   *   performance < 0.4 → insert a prerequisite detour before continuing
   *   else              → unchanged
   *
   * @param {import('./knowledge-genome.js').KnowledgeGenome} genome
   * @param {object[]} currentPath
   * @param {number} currentStep
   * @param {number} performance
   * @returns {Promise<{ path: object[], action: string }>}
   */
  async adaptPath(genome, currentPath, currentStep, performance) {
    try {
      this._metrics.adaptations++;
      if (!Array.isArray(currentPath) || currentPath.length === 0) {
        return { path: currentPath || [], action: 'noop' };
      }
      if (performance > 0.9) {
        const compressed = this.compressPath(currentPath, currentStep);
        return { path: compressed, action: 'compressed' };
      }
      if (performance < 0.4) {
        const target = currentPath[Math.min(currentStep, currentPath.length - 1)];
        const gaps = await this.findPrereqGaps(genome, target);
        const detoured = this.insertDetour(currentPath, currentStep, gaps);
        return { path: detoured, action: 'detour' };
      }
      return { path: currentPath, action: 'unchanged' };
    } catch (_e) {
      return { path: currentPath || [], action: 'noop' };
    }
  }

  /**
   * Find prerequisite DTUs the student has not mastered for a given
   * target DTU. Traverses citations transitively up to two hops.
   *
   * @param {import('./knowledge-genome.js').KnowledgeGenome} genome
   * @param {object|string} targetDTU
   * @returns {Promise<object[]>}
   */
  async findPrereqGaps(genome, targetDTU) {
    try {
      if (!this.dtuStore) return [];
      const target = typeof targetDTU === 'string' ? getDTU(this.dtuStore, targetDTU) : targetDTU;
      if (!target) return [];
      const seen = new Set([target.id]);
      const gaps = [];
      const queue = getCitationParents(target).map(id => ({ id, depth: 1 }));
      while (queue.length > 0) {
        const { id, depth } = queue.shift();
        if (seen.has(id)) continue;
        seen.add(id);
        const d = getDTU(this.dtuStore, id);
        if (!d) continue;
        const mastery = genome ? (genome.nodes.get(id) || 0) : 0;
        if (mastery < 0.7) gaps.push(d);
        if (depth < 2) {
          for (const pid of getCitationParents(d)) {
            if (!seen.has(pid)) queue.push({ id: pid, depth: depth + 1 });
          }
        }
      }
      return gaps;
    } catch (_e) {
      return [];
    }
  }

  /**
   * Compress a path by removing DTUs the student clearly already has a
   * grip on (past the current step).
   *
   * @param {object[]} path
   * @param {number} currentStep
   * @returns {object[]}
   */
  compressPath(path, currentStep) {
    try {
      if (!Array.isArray(path) || path.length === 0) return path || [];
      const head = path.slice(0, currentStep + 1);
      const tail = path.slice(currentStep + 1);
      // Drop every other regular-tier DTU in the tail to halve the remaining work.
      const compressedTail = tail.filter((dtu, i) => {
        const tier = String(dtu?.tier || 'regular').toLowerCase();
        if (tier !== 'regular') return true;
        return i % 2 === 0;
      });
      return [...head, ...compressedTail];
    } catch (_e) {
      return path || [];
    }
  }

  /**
   * Splice prerequisite DTUs into the path just before the current step.
   *
   * @param {object[]} path
   * @param {number} currentStep
   * @param {object[]} gaps
   * @returns {object[]}
   */
  insertDetour(path, currentStep, gaps) {
    try {
      if (!Array.isArray(path)) return path || [];
      if (!Array.isArray(gaps) || gaps.length === 0) return path;
      const existing = new Set(path.map(p => p && p.id).filter(Boolean));
      const detour = gaps.filter(g => g && g.id && !existing.has(g.id));
      const out = [...path];
      out.splice(currentStep, 0, ...detour);
      return out;
    } catch (_e) {
      return path || [];
    }
  }

  /**
   * Navigator statistics.
   */
  getMetrics() {
    return { ...this._metrics };
  }
}

/**
 * Factory.
 *
 * @param {object} [deps]
 * @returns {FeasibilityNavigator}
 */
export function createFeasibilityNavigator(deps = {}) {
  return new FeasibilityNavigator(deps);
}

export default {
  FeasibilityNavigator,
  createFeasibilityNavigator,
};
