/**
 * Feasibility Manifold — The set of all configurations that satisfy
 * all STSVK invariants. Any DTU, answer, entity behavior, or governance
 * decision must fall inside the manifold to be valid.
 *
 * The manifold is defined by the intersection of all invariants from
 * the 2,001 seed DTUs. Each invariant is a constraint; the feasible
 * set is the intersection.
 *
 * This module is a pure ES module with no external dependencies beyond
 * node built-ins, so it can be unit-tested in isolation. It consumes a
 * `dtuStore` with a `values()` iterator (the same contract used by
 * the Oracle Engine) and extracts invariants from:
 *   - dtu.core.invariants[]
 *   - dtu.machine.math.constraints[]
 *
 * Results are structured and can feed back into the Oracle Engine's
 * STSVK constraint-check pipeline.
 *
 * @module feasibility-manifold
 */

/**
 * Tokenize a string into normalized lowercase words (alnum only).
 * Used for keyword/tag matching throughout the module.
 *
 * @param {string} s
 * @returns {string[]}
 */
function tokenize(s) {
  return String(s || '')
    .toLowerCase()
    .replace(/[^a-z0-9_\-\s]/g, ' ')
    .split(/\s+/)
    .filter(Boolean);
}

/**
 * Deep stringify a point (DTU, answer, behavior). Extracts text-like
 * content to produce a searchable haystack for keyword matching.
 *
 * @param {*} point
 * @returns {string}
 */
function flattenPoint(point) {
  if (point == null) return '';
  if (typeof point === 'string') return point;
  if (typeof point === 'number' || typeof point === 'boolean') return String(point);
  if (Array.isArray(point)) return point.map(flattenPoint).join(' ');
  if (typeof point === 'object') {
    const parts = [];
    for (const [k, v] of Object.entries(point)) {
      // Skip verbose / binary-ish fields
      if (k === 'signature' || k === 'embedding' || k === 'vector') continue;
      parts.push(k);
      parts.push(flattenPoint(v));
    }
    return parts.join(' ');
  }
  return '';
}

/**
 * Classify an invariant string into a family (bounded, monotone, conservation,
 * fixed-point, feasibility, identity, etc.) so that the violation heuristics
 * can target it precisely.
 *
 * @param {string} inv
 * @returns {string}
 */
function invariantFamily(inv) {
  const s = String(inv || '').toLowerCase();
  if (/\bbound(ed|s|ary)?\b/.test(s)) return 'bounded';
  if (/\bnon[-\s]?increasing\b|\bmonoton/.test(s)) return 'monotone';
  if (/\bconserv/.test(s)) return 'conservation';
  if (/\bfixed[-\s]?point\b|f\(x\)\s*=\s*x/.test(s)) return 'fixed_point';
  if (/\bfeasib/.test(s)) return 'feasibility';
  if (/\bidentity\b|\bself[-\s]?ref/.test(s)) return 'identity';
  if (/\bstability\b|\bstable\b/.test(s)) return 'stability';
  if (/\bphi\b|\bgolden\b|\bfractal\b/.test(s)) return 'scale_invariant';
  if (/\bbinary\b|\b\{0\s*,\s*1\}\b/.test(s)) return 'binary';
  return 'generic';
}

/**
 * Heuristic check: does the given text (an answer, serialized DTU, etc.)
 * violate the supplied invariant? Returns true if a violation is detected.
 *
 * Mirrors the logic used by oracle-engine's `_heuristicViolates` but
 * expanded for the full family set above.
 *
 * @param {string} text
 * @param {string} invariant
 * @returns {boolean}
 */
function heuristicViolates(text, invariant) {
  const a = String(text || '').toLowerCase();
  const family = invariantFamily(invariant);

  switch (family) {
    case 'bounded':
      return /\bunbounded\b|\binfinit(e|ely)\b|\bno (upper|lower) bound\b/.test(a);
    case 'monotone':
      return /\bincreas(ing|es)\b|\bgrows without\b|\boscillat/.test(a);
    case 'conservation':
      return /\b(is )?lost\b|\bdestroyed\b|\bvanish/.test(a);
    case 'fixed_point':
      return /\bno fixed point\b|\bunstable fixed\b|\bno equilibrium\b/.test(a);
    case 'feasibility':
      return /\binfeasible\b|\bimpossible\b|\bunsolvable\b/.test(a);
    case 'identity':
      return /\bidentity is lost\b|\bidentity fails\b|\bnot self[- ]consistent\b/.test(a);
    case 'stability':
      return /\bunstable\b|\bdivergent\b|\bblows up\b/.test(a);
    case 'scale_invariant':
      return /\bscale[- ]dependent\b|\bnot scale[- ]invariant\b/.test(a);
    case 'binary':
      return /\bternary\b|\bcontinuous\b/.test(a) && /\bbinary\b/.test(String(invariant).toLowerCase());
    case 'generic':
    default: {
      // Generic contradiction: invariant contains "must" / "requires" and
      // the answer contains "cannot" / "never" about the same keyword.
      const invToks = tokenize(invariant);
      if (invToks.length === 0) return false;
      const topic = invToks.find(t => t.length >= 4);
      if (!topic) return false;
      const negRe = new RegExp(`\\b(cannot|never|no|not)\\s+\\w*\\s*${topic}`, 'i');
      return negRe.test(a);
    }
  }
}

/**
 * Score how much "slack" a point has against an invariant: 0 = on the
 * boundary, 1 = deep inside, NaN = violates. Used by distanceToBoundary
 * and localTopology.
 *
 * @param {string} text
 * @param {string} invariant
 * @returns {number} 0..1 or NaN on violation
 */
function invariantSlack(text, invariant) {
  if (heuristicViolates(text, invariant)) return NaN;
  const invToks = tokenize(invariant);
  const textToks = new Set(tokenize(text));
  if (invToks.length === 0) return 1;
  let overlap = 0;
  for (const t of invToks) if (textToks.has(t)) overlap++;
  // More overlap => more evidence the point actively respects the invariant.
  // 0 overlap => slack is 1 (far inside, no engagement); full overlap => 0
  // (active, near the boundary).
  return Math.max(0, Math.min(1, 1 - overlap / invToks.length));
}

/**
 * Feasibility manifold class.
 */
export class FeasibilityManifold {
  /**
   * @param {object} opts
   * @param {object} opts.dtuStore - DTU store with `values()` iterator
   */
  constructor({ dtuStore } = {}) {
    this.dtuStore = dtuStore || null;
    this._invariantCache = null;
    this._loadedAt = 0;
    this._metrics = {
      invariantsLoaded: 0,
      loads: 0,
      checks: 0,
      insideCount: 0,
      outsideCount: 0,
      repairs: 0,
      topologyCalls: 0,
      distanceCalls: 0,
      lastLoadMs: 0,
    };
  }

  /**
   * Load all invariants from formal-kind DTUs in the lattice. Cached after
   * first call; call `invalidate()` to force a reload.
   *
   * An invariant record has the shape:
   *   {
   *     dtuId: string,
   *     text: string,
   *     family: string,
   *     tags: string[],
   *     domain: string | null,
   *     source: 'core.invariants' | 'machine.math.constraints',
   *   }
   *
   * @returns {Promise<Array<object>>}
   */
  async loadInvariants() {
    if (this._invariantCache) return this._invariantCache;
    const started = Date.now();
    const out = [];
    const store = this.dtuStore;
    if (!store || typeof store.values !== 'function') {
      this._invariantCache = out;
      this._loadedAt = started;
      this._metrics.lastLoadMs = 0;
      return out;
    }

    for (const dtu of store.values()) {
      if (!dtu || typeof dtu !== 'object') continue;
      const id = String(dtu.id || '');
      const tags = Array.isArray(dtu.tags) ? dtu.tags.map(String) : [];
      const domain = dtu.domain || dtu.lens || null;

      const isRoot = id.startsWith('dtu_root_fixed_point');
      const isNumbered = /^dtu_0\d+/.test(id);
      const hasStsvkTag = tags.some(t => /^stsvk_/i.test(t));
      const isFormalCore =
        dtu.tier === 'core' &&
        (dtu.machine?.kind === 'formal_model' || dtu.machine?.kind === 'formal_identity');

      if (!(isRoot || isNumbered || hasStsvkTag || isFormalCore)) continue;

      const coreInvs = (dtu.core && Array.isArray(dtu.core.invariants)) ? dtu.core.invariants : [];
      const mathInvs =
        (dtu.machine && dtu.machine.math && Array.isArray(dtu.machine.math.constraints))
          ? dtu.machine.math.constraints
          : [];

      for (const inv of coreInvs) {
        const text = String(inv || '').trim();
        if (!text) continue;
        out.push({
          dtuId: id,
          text,
          family: invariantFamily(text),
          tags,
          domain,
          source: 'core.invariants',
        });
      }
      for (const inv of mathInvs) {
        const text = String(inv || '').trim();
        if (!text) continue;
        out.push({
          dtuId: id,
          text,
          family: invariantFamily(text),
          tags,
          domain,
          source: 'machine.math.constraints',
        });
      }
    }

    this._invariantCache = out;
    this._loadedAt = started;
    this._metrics.invariantsLoaded = out.length;
    this._metrics.loads++;
    this._metrics.lastLoadMs = Date.now() - started;
    return out;
  }

  /**
   * Invalidate the invariant cache (e.g. after bulk DTU import).
   */
  invalidate() {
    this._invariantCache = null;
    this._loadedAt = 0;
  }

  /**
   * Filter the invariant set by the supplied relevant domains. If no
   * domains are supplied, returns the full set.
   *
   * @param {Array<object>} invariants
   * @param {string[]} relevantDomains
   * @returns {Array<object>}
   */
  _filterByDomain(invariants, relevantDomains) {
    if (!Array.isArray(relevantDomains) || relevantDomains.length === 0) return invariants;
    const set = new Set(relevantDomains.map(d => String(d).toLowerCase()));
    return invariants.filter(inv => {
      if (!inv.domain) return true; // domain-less invariants apply everywhere
      return set.has(String(inv.domain).toLowerCase());
    });
  }

  /**
   * Check whether a proposed point (answer, DTU, action) is inside the
   * manifold. A point is inside if it violates zero invariants.
   *
   * @param {*} point
   * @param {object} [opts]
   * @param {string[]} [opts.relevantDomains]
   * @returns {Promise<{
   *   inside: boolean,
   *   violations: Array<{dtuId: string, invariant: string, family: string}>,
   *   satisfied: Array<{dtuId: string, invariant: string, family: string}>,
   *   score: number,
   *   checked: number
   * }>}
   */
  async isInside(point, { relevantDomains = [] } = {}) {
    this._metrics.checks++;
    const invariants = await this.loadInvariants();
    const relevant = this._filterByDomain(invariants, relevantDomains);
    const text = flattenPoint(point);
    const violations = [];
    const satisfied = [];

    for (const inv of relevant) {
      if (heuristicViolates(text, inv.text)) {
        violations.push({ dtuId: inv.dtuId, invariant: inv.text, family: inv.family });
      } else {
        satisfied.push({ dtuId: inv.dtuId, invariant: inv.text, family: inv.family });
      }
    }

    const total = violations.length + satisfied.length;
    const score = total === 0 ? 1 : satisfied.length / total;
    const inside = violations.length === 0;
    if (inside) this._metrics.insideCount++;
    else this._metrics.outsideCount++;

    return {
      inside,
      violations,
      satisfied,
      score,
      checked: total,
    };
  }

  /**
   * Compute the distance from a point to the nearest manifold boundary.
   * Lower = closer to violating a constraint; 0 = on the boundary; NaN =
   * already outside.
   *
   * @param {*} point
   * @returns {Promise<{
   *   distance: number,
   *   nearest: { dtuId: string, invariant: string, family: string } | null,
   *   inside: boolean
   * }>}
   */
  async distanceToBoundary(point) {
    this._metrics.distanceCalls++;
    const invariants = await this.loadInvariants();
    const text = flattenPoint(point);

    let minSlack = Infinity;
    let nearest = null;
    let insideAll = true;

    for (const inv of invariants) {
      const slack = invariantSlack(text, inv.text);
      if (Number.isNaN(slack)) {
        insideAll = false;
        minSlack = 0;
        nearest = { dtuId: inv.dtuId, invariant: inv.text, family: inv.family };
        break;
      }
      if (slack < minSlack) {
        minSlack = slack;
        nearest = { dtuId: inv.dtuId, invariant: inv.text, family: inv.family };
      }
    }

    if (!Number.isFinite(minSlack)) minSlack = 1;
    return {
      distance: insideAll ? minSlack : NaN,
      nearest,
      inside: insideAll,
    };
  }

  /**
   * Given a point OUTSIDE the manifold, compute the repair trajectory
   * (the minimal set of textual changes that would put it back inside).
   * Each step describes one invariant to respect and a suggested action.
   *
   * @param {*} point
   * @returns {Promise<{
   *   needed: boolean,
   *   steps: Array<{dtuId: string, invariant: string, family: string, action: string}>,
   *   score: number
   * }>}
   */
  async repairTrajectory(point) {
    this._metrics.repairs++;
    const check = await this.isInside(point);
    if (check.inside) {
      return { needed: false, steps: [], score: check.score };
    }

    const steps = check.violations.map(v => ({
      dtuId: v.dtuId,
      invariant: v.invariant,
      family: v.family,
      action: suggestedAction(v.family, v.invariant),
    }));

    return { needed: true, steps, score: check.score };
  }

  /**
   * Compute the local topology of the manifold around a point: which
   * invariants are "active" (near the boundary) and which are "slack"
   * (far inside). An invariant is active when slack < 0.5.
   *
   * @param {*} point
   * @returns {Promise<{
   *   active: Array<{dtuId: string, invariant: string, family: string, slack: number}>,
   *   slack: Array<{dtuId: string, invariant: string, family: string, slack: number}>,
   *   violated: Array<{dtuId: string, invariant: string, family: string}>,
   *   dimension: number
   * }>}
   */
  async localTopology(point) {
    this._metrics.topologyCalls++;
    const invariants = await this.loadInvariants();
    const text = flattenPoint(point);

    const active = [];
    const slackList = [];
    const violated = [];

    for (const inv of invariants) {
      const s = invariantSlack(text, inv.text);
      if (Number.isNaN(s)) {
        violated.push({ dtuId: inv.dtuId, invariant: inv.text, family: inv.family });
        continue;
      }
      const rec = { dtuId: inv.dtuId, invariant: inv.text, family: inv.family, slack: s };
      if (s < 0.5) active.push(rec);
      else slackList.push(rec);
    }

    // Local dimension ≈ (non-violated invariants that are slack) — a
    // rough proxy for the number of free directions at this point.
    const dimension = slackList.length;
    return { active, slack: slackList, violated, dimension };
  }

  /**
   * Usage statistics.
   * @returns {object}
   */
  getMetrics() {
    return {
      ...this._metrics,
      cached: this._invariantCache != null,
      loadedAt: this._loadedAt,
    };
  }
}

/**
 * Suggest a repair action for a given invariant family.
 *
 * @param {string} family
 * @param {string} invariant
 * @returns {string}
 */
function suggestedAction(family, invariant) {
  switch (family) {
    case 'bounded':
      return 'Constrain the result to the invariant\'s stated bounds.';
    case 'monotone':
      return 'Ensure the sequence is non-increasing / non-decreasing as required.';
    case 'conservation':
      return 'Account for every quantity; nothing is lost or created.';
    case 'fixed_point':
      return 'Ensure the mapping admits the stated fixed point f(x) = x.';
    case 'feasibility':
      return 'Re-state the answer so it falls inside the feasibility set.';
    case 'identity':
      return 'Preserve self-referential identity through the transformation.';
    case 'stability':
      return 'Use a stable (non-divergent) formulation of the dynamics.';
    case 'scale_invariant':
      return 'Use a scale-invariant formulation (no distinguished scale).';
    case 'binary':
      return 'Restrict solutions to the binary set {0, 1}.';
    default:
      return `Respect invariant: ${invariant}`;
  }
}

/**
 * Factory for creating a FeasibilityManifold instance.
 *
 * @param {object} opts
 * @returns {FeasibilityManifold}
 */
export function createFeasibilityManifold(opts) {
  return new FeasibilityManifold(opts);
}

// Exported for unit tests / external reuse.
export { tokenize, flattenPoint, invariantFamily, heuristicViolates, invariantSlack };

// Module-level metrics — a thin wrapper so callers that don't hold a
// reference to a FeasibilityManifold instance can still report basics.
const _moduleMetrics = { instancesCreated: 0 };
const _origCreate = createFeasibilityManifold;
export function getMetrics() {
  return { ..._moduleMetrics };
}
// Count instance creations at module level.
const _wrappedCreate = (opts) => {
  _moduleMetrics.instancesCreated++;
  return _origCreate(opts);
};
// Rebind: since `createFeasibilityManifold` is already exported above, we
// expose the wrapped one as `createFeasibilityManifoldTracked` without
// breaking the primary export.
export { _wrappedCreate as createFeasibilityManifoldTracked };
