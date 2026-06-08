/**
 * Oracle Engine — Multi-Phase Reasoning Pipeline
 *
 * The Oracle sits above the standard brain and orchestrates lens handlers,
 * DTU retrieval, formal computation, and citation. It runs queries through a
 * multi-phase pipeline that includes constraint checking against the STSVK
 * formal-theorem lattice.
 *
 * Phases
 *   1. analyze()  — classify query, pick domain + task type
 *   2. retrieve() — pull relevant DTUs + context from the lattice
 *   3. compute()  — synthesize an answer; run STSVK constraint check if formal
 *   4. cite()     — attach source DTUs and theorem citations
 *   5. validate() — confidence scoring including STSVK constraint score
 *   6. record()   — persist the result as an `oracle_answer` DTU
 *
 * STSVK Integration
 * -----------------
 * The STSVK framework (480 theorems + 1 root fixed-point identity) is NOT a
 * separate module. It IS the seed DTU lattice loaded from
 * server/data/seed/dtus-part1.json..dtus-part8.json (plus dtus-root.json),
 * giving 481 formal-theorem DTUs at startup.
 *
 * Each STSVK DTU carries invariants, constraints, and verifier steps. During
 * Phase 3 the Oracle queries these theorems and checks whether the synthesized
 * answer violates any invariant. The result feeds confidence in Phase 5.
 *
 * Recorded DTUs are tagged `oracle_answer` AND cite the STSVK theorems they
 * were validated against.
 */

import logger from '../logger.js';
import { TASK_PROMPTS } from './prompt-registry.js';

const DEFAULT_STATS = {
  queriesResolved: 0,
  avgConfidence: 0,
  totalDTUsCreated: 0,
  stsvkChecksRun: 0,
  stsvkViolations: 0,
  // New stats added with the real-subsystem upgrade:
  brainCallsMade: 0,
  embeddingSearches: 0,
  royaltiesCascaded: 0,
  // Compute Registry + Sub-Lens Bridge integration:
  computeRegistryCalls: 0,
  subLensExpansions: 0,
};

// Prompts live in `server/lib/prompt-registry.js` (TASK_PROMPTS.oracle*).

/**
 * Create an Oracle Engine instance.
 *
 * @param {object} opts
 * @param {object} opts.dtuStore      — DTU write-through store (Map-compatible)
 * @param {object} [opts.domainHandlers] — Map of domain -> handler
 * @param {object} [opts.entities]    — STATE.entities
 * @param {object} [opts.db]          — better-sqlite3 database
 * @param {object} [opts.brain]       — optional brain-service-like interface with query(name, req)
 * @returns {object} Oracle Engine API
 */
export function createOracleEngine(opts = {}) {
  const { dtuStore, domainHandlers = {}, entities, db, brain } = opts;

  const stats = { ...DEFAULT_STATS };

  // STSVK theorem cache. Populated lazily on first compute() that needs it.
  /** @type {null | Array<object>} */
  let _stsvkCache = null;
  let _stsvkLoadedAt = 0;

  const log = (level, event, fields = {}) => {
    try { logger.log(level, 'oracle-engine', event, fields); }
    catch { /* logger may be unavailable in tests */ }
  };

  // ── Brain Service Bridge ───────────────────────────────────────────────
  //
  // The Oracle tries three increasingly-best-effort strategies to talk to a
  // brain:
  //   1. Use `opts.brain.query(name, req)` if the injector gave us one.
  //   2. Dynamic-import './brain-service.cjs'. The CJS module exports the
  //      `BrainService` class, which we lazily instantiate and reuse.
  //   3. Fail gracefully — every call site is wrapped in try/catch and has
  //      a heuristic fallback.

  /** @type {object|null} Lazily-instantiated fallback BrainService instance */
  let _brainFallback = null;
  /** @type {boolean} set to true once we've tried (and possibly failed) the
   *  dynamic import, so we don't re-try on every single call. */
  let _brainFallbackTried = false;

  async function _getFallbackBrain() {
    if (_brainFallback) return _brainFallback;
    if (_brainFallbackTried) return null;
    _brainFallbackTried = true;
    try {
      // brain-service.cjs is CommonJS and exports the class on module.exports.
      // Under ESM dynamic import the class lands on the `default` property.
      const mod = await import('./brain-service.cjs');
      const BrainService = mod?.default || mod?.BrainService || mod;
      if (typeof BrainService === 'function') {
        _brainFallback = new BrainService();
        return _brainFallback;
      }
      // Some environments export a plain { query } map — accept it.
      if (mod && typeof mod.query === 'function') {
        _brainFallback = mod;
        return _brainFallback;
      }
    } catch (e) {
      log('debug', 'brain_fallback_import_failed', { error: e?.message });
    }
    return null;
  }

  /**
   * Call a brain by name. Prefer the injected `opts.brain`, fall back to
   * a lazily-imported brain-service.cjs instance. Increments the
   * `brainCallsMade` stat on success.
   *
   * Graceful: returns `null` on any failure (caller must handle that).
   *
   * @param {string} brainName   — conscious|subconscious|utility|repair
   * @param {object} request     — { prompt, taskType?, context?, systemPrompt?, ... }
   * @returns {Promise<object|null>}
   */
  async function _callBrain(brainName, request) {
    const req = { ...(request || {}) };
    // If a system prompt was passed, stitch it into the prompt so that
    // brain-service implementations which do not have a dedicated
    // `systemPrompt` field still see the instructions.
    if (req.systemPrompt && req.prompt && !req._systemPromptMerged) {
      req.prompt = `[SYSTEM]\n${req.systemPrompt}\n[/SYSTEM]\n\n${req.prompt}`;
      req._systemPromptMerged = true;
    }

    // Strategy 1: injected brain
    if (brain && typeof brain.query === 'function') {
      try {
        const resp = await brain.query(brainName, req);
        stats.brainCallsMade++;
        return resp;
      } catch (e) {
        log('debug', 'brain_injected_call_failed', {
          brain: brainName, error: e?.message,
        });
      }
    }

    // Strategy 2: fallback brain-service
    const fb = await _getFallbackBrain();
    if (fb && typeof fb.query === 'function') {
      try {
        const resp = await fb.query(brainName, req);
        stats.brainCallsMade++;
        return resp;
      } catch (e) {
        log('debug', 'brain_fallback_call_failed', {
          brain: brainName, error: e?.message,
        });
      }
    }

    return null;
  }

  /**
   * Extract a textual content field from a brain response in a
   * resilient way (different brain implementations use slightly
   * different shapes).
   */
  function _brainText(resp) {
    if (!resp) return '';
    if (typeof resp === 'string') return resp;
    return String(
      resp.content ??
      resp.text ??
      resp.message ??
      resp.output ??
      ''
    );
  }

  /**
   * Try to parse a strict-JSON object out of a brain response. Handles
   * common LLM quirks: leading prose, markdown code fences, trailing
   * commentary. Returns `null` on any parse failure.
   */
  function _parseJSONFromBrain(text) {
    if (!text) return null;
    const s = String(text).trim();
    // Direct parse
    try { return JSON.parse(s); } catch { /* fall through */ }
    // Strip ```json fences
    const fenced = s.match(/```(?:json)?\s*([\s\S]*?)```/i);
    if (fenced && fenced[1]) {
      try { return JSON.parse(fenced[1]); } catch { /* fall through */ }
    }
    // First balanced object heuristic
    const first = s.indexOf('{');
    const last = s.lastIndexOf('}');
    if (first >= 0 && last > first) {
      try { return JSON.parse(s.slice(first, last + 1)); } catch { /* fall through */ }
    }
    return null;
  }

  // ── Embeddings Bridge ──────────────────────────────────────────────────

  /** @type {object|null} Cached dynamic-import of embeddings.js */
  let _embeddingsModule = null;
  let _embeddingsImportTried = false;

  async function _getEmbeddings() {
    if (_embeddingsModule) return _embeddingsModule;
    if (_embeddingsImportTried) return null;
    _embeddingsImportTried = true;
    try {
      _embeddingsModule = await import('../embeddings.js');
      return _embeddingsModule;
    } catch (e) {
      log('debug', 'embeddings_import_failed', { error: e?.message });
      return null;
    }
  }

  // ── Royalty Cascade Bridge ─────────────────────────────────────────────

  /** @type {object|null} Cached dynamic-import of royalty-cascade.js */
  let _royaltyModule = null;
  let _royaltyImportTried = false;

  async function _getRoyalty() {
    if (_royaltyModule) return _royaltyModule;
    if (_royaltyImportTried) return null;
    _royaltyImportTried = true;
    try {
      _royaltyModule = await import('../economy/royalty-cascade.js');
      return _royaltyModule;
    } catch (e) {
      log('debug', 'royalty_import_failed', { error: e?.message });
      return null;
    }
  }

  // ── Quality Gate Bridge ────────────────────────────────────────────────

  /** @type {object|null} Cached dynamic-import of quality-gate.js */
  let _qualityGateModule = null;
  let _qualityGateImportTried = false;

  async function _getQualityGate() {
    if (_qualityGateModule) return _qualityGateModule;
    if (_qualityGateImportTried) return null;
    _qualityGateImportTried = true;
    try {
      _qualityGateModule = await import('./quality-gate.js');
      return _qualityGateModule;
    } catch (e) {
      log('debug', 'quality_gate_import_failed', { error: e?.message });
      return null;
    }
  }

  // ── Deep-question detection & Answer-DTU preference ────────────────────

  /**
   * Keyword buckets that flag a query as a "deep question" — philosophical,
   * physical, mathematical, alignment-, consciousness-, trust-, or systems-
   * related. When matched, the retrieve phase prefers pre-seeded oracle
   * answer DTUs over generic lattice hits.
   */
  const DEEP_QUESTION_KEYWORDS = [
    // physics / metaphysics
    'consciousness', 'exist', 'reality', 'nothing', 'universe', 'time',
    'entropy', 'causation',
    // mathematics / logic
    'gödel', 'godel', 'incompleteness', 'proof', 'axiom', 'emergence',
    'complexity',
    // alignment
    'alignment', 'reward', 'preservation', 'deception', 'capture',
    'misalignment',
    // epistemics
    'knowledge', 'unknown', 'nuance', 'monoculture', 'dissent',
    // trust / systems
    'trust', 'watchmen', 'credit', 'attribution',
    // long-horizon / irreversibility
    'century', 'generations', 'drift', 'irreversible', 'immutable',
    // self / mind
    'self', 'boundary', 'mind', 'transcendence',
  ];

  /**
   * Detect whether a query is a "deep question" that should prefer
   * pre-seeded canonical answer DTUs.
   *
   * @param {string} query
   * @param {object} [analysis]
   * @returns {boolean}
   */
  function detectDeepQuestion(query, analysis = {}) {
    const q = String(query || '').toLowerCase();
    if (!q) return false;
    for (const kw of DEEP_QUESTION_KEYWORDS) {
      if (q.includes(kw)) return true;
    }
    // Also treat theoretical/formal analyses with philosophical shape as deep.
    if (analysis && (analysis.taskType === 'theoretical')) return true;
    return false;
  }

  /**
   * Identify a DTU as an answer-seed DTU. Answer seeds either:
   *   - carry the `oracle_answer_seed` tag
   *   - have tier === 'answer'
   *   - have type === 'oracle_answer_seed'
   *
   * @param {object} dtu
   * @returns {boolean}
   */
  function _isAnswerSeedDTU(dtu) {
    if (!dtu || typeof dtu !== 'object') return false;
    if (dtu.tier === 'answer') return true;
    if (dtu.type === 'oracle_answer_seed') return true;
    const tags = dtu.tags || [];
    return tags.some(t => String(t).toLowerCase() === 'oracle_answer_seed');
  }

  /**
   * Compute a crude match score between a query and an answer-seed DTU.
   * Counts term overlap across tags, title, summary, bullets. Returns a
   * value in [0, 1] — 1 means every query term is present somewhere.
   *
   * @param {string} query
   * @param {object} dtu
   * @returns {number}
   */
  function _scoreAnswerDTU(query, dtu) {
    const q = String(query || '').toLowerCase();
    const terms = q.split(/\W+/).filter(t => t.length > 3);
    if (terms.length === 0) return 0;
    const hay = [
      dtu.id,
      dtu.title,
      ...(dtu.tags || []),
      dtu.human?.summary,
      ...(dtu.human?.bullets || []),
      dtu.core?.answer,
      dtu.core?.question,
    ].filter(Boolean).join(' ').toLowerCase();
    let hits = 0;
    for (const t of terms) if (hay.includes(t)) hits++;
    return hits / terms.length;
  }

  // ── Chicken2 Gate (lazy) ───────────────────────────────────────────────

  /**
   * Lazily invoke the new Chicken2 Gate validator. Falls back to a passing
   * result if the module isn't available so the pipeline continues to work
   * during incremental rollout.
   */
  async function _runChicken2Gate(subject, metadata) {
    try {
      const { createChicken2Gate } = await import('./chicken2-gate.js');
      const gate = createChicken2Gate({ dtuStore, domainHandlers });
      return await gate.validate(subject, { kind: 'answer', metadata });
    } catch (e) {
      return { passed: true, confidence: 0.5, reason: `gate unavailable: ${e?.message || e}` };
    }
  }

  // ── Feasibility Manifold (lazy) ────────────────────────────────────────

  /**
   * Lazily invoke the Feasibility Manifold check. Returns `{ inside, score,
   * reason? }`. Graceful degrade: inside=true, score=0.5 if unavailable.
   */
  async function _checkManifold(subject) {
    try {
      const { createFeasibilityManifold } = await import('./feasibility-manifold.js');
      const manifold = createFeasibilityManifold({ dtuStore });
      return await manifold.isInside(subject);
    } catch (e) {
      return { inside: true, score: 0.5, reason: `manifold unavailable: ${e?.message || e}` };
    }
  }

  // ── STSVK Regime classifier (lazy) ─────────────────────────────────────

  /**
   * Classify an answer into one of the three STSVK regimes. Falls back to
   * 'binary' if the module isn't available.
   *
   * @param {string} answer
   * @returns {Promise<string>}
   */
  async function _classifyRegime(answer) {
    try {
      const { classifyRegime } = await import('./stsvk-regimes.js');
      return classifyRegime({ content: answer });
    } catch (e) {
      return 'binary';
    }
  }

  // ── Phase 1: Analyze ────────────────────────────────────────────────────

  /**
   * Classify the query. Picks a task type (formal/computational/theoretical/
   * narrative/conversational) and best-effort domain hint.
   *
   * @param {string} query
   * @returns {Promise<{ taskType: string, domain: string|null, isFormal: boolean }>}
   */
  /**
   * Heuristic fallback classifier — used when the utility brain is
   * unavailable or returns unparseable JSON. Mirrors the original keyword
   * logic but returns the richer shape expected by Phase 2 and Phase 3.
   */
  function _heuristicAnalyze(query) {
    const q = String(query || '').toLowerCase();

    const formalHints = [
      'prove', 'theorem', 'invariant', 'constraint', 'equation',
      'derive', 'fixed point', 'stability', 'bounded', 'solve for',
      'compute', 'formal', 'proof', 'lemma', 'optimize', 'minimize',
    ];
    const narrativeHints = ['story', 'narrative', 'character', 'worldbuild'];
    const conversationalHints = ['hi ', 'hello', 'thanks', 'how are you'];
    const simHints = ['simulate', 'simulation', 'run a sim', 'model the'];
    const domainKeywords = {
      physics: ['physics', 'force', 'momentum', 'energy', 'wave', 'quantum'],
      math: ['math', 'proof', 'theorem', 'equation', 'algebra', 'calculus'],
      chem: ['chem', 'reaction', 'molecule', 'bond', 'catalyst'],
      bio: ['bio', 'cell', 'organism', 'dna', 'protein', 'ecosystem'],
      cs: ['algorithm', 'complexity', 'program', 'runtime', 'code'],
    };

    const hasAny = (arr) => arr.some(w => q.includes(w));

    let queryType = 'general';
    if (hasAny(formalHints)) queryType = 'formal';
    else if (hasAny(simHints)) queryType = 'computational';
    else if (hasAny(narrativeHints)) queryType = 'narrative';
    else if (hasAny(conversationalHints)) queryType = 'conversational';

    const primaryDomains = [];
    for (const [d, kws] of Object.entries(domainKeywords)) {
      if (kws.some(k => q.includes(k))) primaryDomains.push(d);
    }
    // also accept registered domain handler names directly
    for (const name of Object.keys(domainHandlers)) {
      if (q.includes(name.toLowerCase()) && !primaryDomains.includes(name)) {
        primaryDomains.push(name);
      }
    }

    const requiredSystems = [];
    if (queryType === 'formal' || queryType === 'computational') {
      requiredSystems.push('physics_modules', 'validation', 'stsvk');
    }
    if (hasAny(simHints)) requiredSystems.push('simulation');
    if (requiredSystems.length === 0) requiredSystems.push('retrieval');

    // Complexity heuristic: longer multi-term queries → more complex.
    const terms = q.split(/\W+/).filter(t => t.length > 3);
    let complexity = 'simple';
    if (terms.length > 30) complexity = 'research';
    else if (terms.length > 15) complexity = 'complex';
    else if (terms.length > 6) complexity = 'moderate';
    else if (terms.length < 2) complexity = 'trivial';

    // Epistemic class heuristic.
    let epistemicClass = 'probable';
    if (queryType === 'formal') epistemicClass = 'known';
    else if (q.includes('unknown') || q.includes("don't know")) epistemicClass = 'unknown';
    else if (q.includes('maybe') || q.includes('might')) epistemicClass = 'uncertain';

    return {
      primaryDomains,
      secondaryDomains: [],
      queryType,
      complexity,
      requiredSystems,
      epistemicClass,
      // legacy fields retained for downstream consumers:
      taskType: queryType,
      domain: primaryDomains[0] || null,
      isFormal: queryType === 'formal',
      crossDomainAssociations: [],
      _heuristic: true,
    };
  }

  /**
   * Phase 1 — Analyze.
   *
   * Upgraded: uses the utility brain for classification, asks for strict
   * JSON, and supplements with a subconscious-brain pass for cross-domain
   * associations. Falls back to `_heuristicAnalyze` on any failure.
   *
   * @param {string} query
   * @returns {Promise<object>} analysis
   */
  async function analyze(query) {
    const q = String(query || '');
    const baseHeuristic = _heuristicAnalyze(q);

    // Ask the utility brain to classify.
    let classified = null;
    try {
      const resp = await _callBrain('utility', {
        prompt: TASK_PROMPTS.oracleQueryClassifier({ query: q }),
        taskType: 'classification',
        temperature: 0.1,
        maxTokens: 400,
      });
      const text = _brainText(resp);
      const parsed = _parseJSONFromBrain(text);
      if (parsed && typeof parsed === 'object') {
        classified = parsed;
      }
    } catch (e) {
      log('debug', 'analyze_utility_brain_failed', { error: e?.message });
    }

    // Merge: prefer brain output, fall back field-by-field to heuristic.
    const primaryDomains = Array.isArray(classified?.primaryDomains) && classified.primaryDomains.length
      ? classified.primaryDomains.map(String)
      : baseHeuristic.primaryDomains;
    const secondaryDomains = Array.isArray(classified?.secondaryDomains)
      ? classified.secondaryDomains.map(String)
      : baseHeuristic.secondaryDomains;
    const queryType = classified?.queryType || baseHeuristic.queryType;
    const complexity = classified?.complexity || baseHeuristic.complexity;
    const requiredSystems = Array.isArray(classified?.requiredSystems) && classified.requiredSystems.length
      ? classified.requiredSystems.map(String)
      : baseHeuristic.requiredSystems;
    const epistemicClass = classified?.epistemicClass || baseHeuristic.epistemicClass;

    // Ask the subconscious brain for cross-domain associations (best-effort).
    let crossDomainAssociations = [];
    try {
      const resp = await _callBrain('subconscious', {
        prompt:
          `List up to 5 short cross-domain associations (comma-separated, ` +
          `one per line) for the query below. Think laterally — which other ` +
          `fields or theories connect to this?\n\nQuery: ${q}`,
        taskType: 'pattern_recognition',
        temperature: 0.7,
        maxTokens: 200,
      });
      const text = _brainText(resp);
      if (text) {
        crossDomainAssociations = text
          .split(/[\n,]/)
          .map(s => s.replace(/^[\s\-*•\d.]+/, '').trim())
          .filter(Boolean)
          .slice(0, 5);
      }
    } catch (e) {
      log('debug', 'analyze_subconscious_brain_failed', { error: e?.message });
    }

    return {
      primaryDomains,
      secondaryDomains,
      queryType,
      complexity,
      requiredSystems,
      epistemicClass,
      crossDomainAssociations,
      // legacy fields kept for backward compatibility with downstream code:
      taskType: queryType,
      domain: primaryDomains[0] || null,
      isFormal: queryType === 'formal',
      _classifiedBy: classified ? 'utility_brain' : 'heuristic',
    };
  }

  // ── Phase 2: Retrieve ───────────────────────────────────────────────────

  /**
   * Retrieve relevant DTUs for the query. Uses tag + term matching over the
   * in-memory lattice. This is the same lattice that holds the STSVK seeds,
   * so relevant formal theorems are returned naturally.
   *
   * @param {string} query
   * @param {object} analysis
   * @returns {Promise<{ dtus: object[] }>}
   */
  /**
   * Tag/term fallback search — used when embeddings are unavailable. Kept
   * as a standalone helper so it can be reused by the retrieval pipeline
   * and the deep-question short-circuit.
   */
  function _tagTermSearch(query, candidates, limit = 24) {
    const q = String(query || '').toLowerCase();
    const terms = q.split(/\W+/).filter(t => t.length > 3);
    const out = [];
    for (const dtu of candidates) {
      if (!dtu || typeof dtu !== 'object') continue;
      const hay = [
        dtu.id,
        dtu.title,
        ...(dtu.tags || []),
        dtu.human?.summary,
        ...(dtu.human?.bullets || []),
      ].filter(Boolean).join(' ').toLowerCase();

      const tagMatch = (dtu.tags || []).some(t => terms.includes(String(t).toLowerCase()));
      const termMatch = terms.some(t => hay.includes(t));
      if (tagMatch || termMatch) {
        out.push(dtu);
        if (out.length >= limit) break;
      }
    }
    return out;
  }

  /**
   * Build the candidate list for semantic search. If the analysis has
   * primary domains, prefer DTUs tagged with those; otherwise take the
   * first N DTUs from the store.
   */
  function _buildCandidates(analysis, limit = 500) {
    if (!dtuStore || typeof dtuStore.values !== 'function') return [];

    const primaryDomains = (analysis?.primaryDomains || []).map(d => String(d).toLowerCase());
    const candidates = [];
    const seen = new Set();

    if (primaryDomains.length > 0) {
      for (const dtu of dtuStore.values()) {
        if (!dtu || typeof dtu !== 'object') continue;
        const tags = (dtu.tags || []).map(t => String(t).toLowerCase());
        const inDomain = primaryDomains.some(d => tags.includes(d))
          || primaryDomains.some(d => String(dtu.id || '').toLowerCase().includes(d));
        if (inDomain) {
          candidates.push(dtu);
          seen.add(dtu.id);
          if (candidates.length >= limit) break;
        }
      }
    }

    if (candidates.length < limit) {
      for (const dtu of dtuStore.values()) {
        if (!dtu || typeof dtu !== 'object') continue;
        if (seen.has(dtu.id)) continue;
        candidates.push(dtu);
        if (candidates.length >= limit) break;
      }
    }

    return candidates;
  }

  /**
   * Phase 2 — Retrieve.
   *
   * Upgraded: uses real semantic search via embeddings.js when available.
   * Combines semantic, tag/term, domain-specific, prior-answer, and
   * entity-insight sources into a rich retrieval bundle.
   *
   * @param {string} query
   * @param {object} analysis
   * @returns {Promise<object>}
   */
  async function retrieve(query, analysis) {
    if (!dtuStore || typeof dtuStore.values !== 'function') {
      return {
        dtus: [],
        semantic: [],
        domainSpecific: [],
        priorAnswers: [],
        entityInsights: [],
        crossDomainConnections: [],
        deepQuestion: false,
        primaryAnswerDTU: null,
        totalSources: 0,
      };
    }

    const q = String(query || '');
    const isDeep = detectDeepQuestion(query, analysis);

    // ── Sub-Lens Bridge: expand primary domains via the sub-lens registry ──
    // Lazy dynamic import with graceful fallback. If the bridge is
    // unavailable, we keep the original primaryDomains unchanged.
    let expandedDomains = analysis?.primaryDomains || [];
    try {
      const { expandLensContext } = await import('./oracle-sub-lens-bridge.js');
      const original = analysis?.primaryDomains || [];
      expandedDomains = expandLensContext(query, original);
      if (Array.isArray(expandedDomains) && expandedDomains.length > original.length) {
        analysis._subLensExpanded = true;
        analysis._originalDomains = original;
        analysis.primaryDomains = expandedDomains;
        stats.subLensExpansions = (stats.subLensExpansions || 0) + 1;
      } else if (!Array.isArray(expandedDomains)) {
        expandedDomains = original;
      }
    } catch (e) {
      log('debug', 'retrieve_sub_lens_expand_failed', { error: e?.message });
      expandedDomains = analysis?.primaryDomains || [];
    }

    // ── Deep-question answer-seed preference ────────────────────────────
    const deepOut = [];
    let primaryAnswerDTU = null;
    if (isDeep) {
      const scored = [];
      for (const dtu of dtuStore.values()) {
        if (!_isAnswerSeedDTU(dtu)) continue;
        const base = _scoreAnswerDTU(query, dtu);
        const boosted = Math.min(1, base * 2);
        if (boosted > 0) scored.push({ dtu, score: boosted });
      }
      scored.sort((a, b) => b.score - a.score);
      if (scored.length > 0 && scored[0].score > 0.8) {
        primaryAnswerDTU = scored[0].dtu;
      }
      for (const { dtu } of scored.slice(0, 6)) deepOut.push(dtu);
    }

    // ── Semantic search ─────────────────────────────────────────────────
    let semantic = [];
    const candidates = _buildCandidates(analysis, 500);
    try {
      const emb = await _getEmbeddings();
      if (emb && typeof emb.semanticSearch === 'function' && typeof emb.isEmbeddingAvailable === 'function' && emb.isEmbeddingAvailable()) {
        semantic = await emb.semanticSearch(q, candidates, { topK: 50 });
        stats.embeddingSearches++;
      } else if (emb && typeof emb.semanticSearch === 'function') {
        // Try anyway — semanticSearch returns [] if embed() fails.
        semantic = await emb.semanticSearch(q, candidates, { topK: 50 });
        stats.embeddingSearches++;
      }
    } catch (e) {
      log('debug', 'retrieve_semantic_failed', { error: e?.message });
      semantic = [];
    }

    // Qdrant ANN (Item 1): when in-process embeddings came up empty, query the
    // ANN index over the FULL corpus (its advantage over the 500-candidate pool)
    // and hydrate from the DTU store. No-op unless VECTOR_DB=qdrant + reachable.
    if ((!Array.isArray(semantic) || semantic.length === 0)) {
      try {
        const qd = await import('./qdrant-client.js').then((m) => m.default).catch(() => null);
        const emb = await _getEmbeddings();
        if (qd?.configured?.() && typeof emb?.embed === 'function' && dtuStore?.get) {
          const qVec = await emb.embed(q);
          if (qVec) {
            const res = await qd.search(qVec, 50);
            if (res?.ok && Array.isArray(res.hits) && res.hits.length) {
              semantic = res.hits.map((h) => dtuStore.get(h.dtuId)).filter(Boolean);
              stats.embeddingSearches++;
            }
          }
        }
      } catch (e) {
        log('debug', 'retrieve_qdrant_failed', { error: e?.message });
      }
    }

    // Fallback: tag/term search if semantic came up empty.
    if (!Array.isArray(semantic) || semantic.length === 0) {
      semantic = _tagTermSearch(q, candidates, 24);
    }

    // ── Domain-specific retrieval ───────────────────────────────────────
    const domainSpecific = [];
    const primaryDomains = analysis?.primaryDomains || [];
    for (const domain of primaryDomains) {
      try {
        const handler = domainHandlers?.[domain];
        if (!handler) continue;
        // Accept any of a few plausible listing APIs.
        let listFn = null;
        if (typeof handler.list === 'function') listFn = handler.list;
        else if (typeof handler.listAction === 'function') listFn = handler.listAction;
        else if (typeof handler === 'function') listFn = handler;
        if (!listFn) continue;
        const result = await listFn({ query: q, domain, analysis });
        if (Array.isArray(result)) domainSpecific.push(...result);
        else if (result && Array.isArray(result.items)) domainSpecific.push(...result.items);
      } catch (e) {
        log('debug', 'retrieve_domain_list_failed', { domain, error: e?.message });
      }
    }

    // ── Prior oracle_answer DTUs (memory) ───────────────────────────────
    const priorAnswers = [];
    try {
      const qLower = q.toLowerCase();
      const qTerms = qLower.split(/\W+/).filter(t => t.length > 3);
      for (const dtu of dtuStore.values()) {
        if (!dtu || typeof dtu !== 'object') continue;
        if (dtu.type !== 'oracle_answer') continue;
        const prevQ = String(dtu.core?.query || '').toLowerCase();
        if (!prevQ) continue;
        if (prevQ === qLower) {
          priorAnswers.push(dtu);
        } else if (qTerms.length > 0) {
          const overlap = qTerms.filter(t => prevQ.includes(t)).length;
          if (overlap / qTerms.length >= 0.6) priorAnswers.push(dtu);
        }
        if (priorAnswers.length >= 6) break;
      }
    } catch (e) {
      log('debug', 'retrieve_prior_answers_failed', { error: e?.message });
    }

    // ── Entity insights ─────────────────────────────────────────────────
    const entityInsights = [];
    try {
      if (entities && primaryDomains.length > 0) {
        // `entities` may be a Map, plain object, or array — probe shape.
        const iter = typeof entities.values === 'function'
          ? entities.values()
          : (Array.isArray(entities) ? entities : Object.values(entities));
        let count = 0;
        for (const ent of iter) {
          if (!ent || typeof ent !== 'object') continue;
          const entDomains = ent.domains || ent.expertise || [];
          const match = Array.isArray(entDomains)
            && entDomains.some(d => primaryDomains.includes(String(d).toLowerCase()));
          if (match) {
            entityInsights.push({
              id: ent.id || ent.name,
              name: ent.name || ent.id,
              domains: entDomains,
              perspective: ent.perspective || ent.bio || null,
            });
            count++;
            if (count >= 5) break;
          }
        }
      }
    } catch (e) {
      log('debug', 'retrieve_entity_insights_failed', { error: e?.message });
    }

    // ── Cross-domain connections (via embeddings) ───────────────────────
    const crossDomainConnections = [];
    try {
      const emb = await _getEmbeddings();
      if (emb && typeof emb.findCrossDomainConnections === 'function') {
        const allDTUs = Array.from(dtuStore.values());
        const seeds = [
          primaryAnswerDTU,
          ...(Array.isArray(semantic) ? semantic.slice(0, 3) : []),
        ].filter(Boolean);
        const seenIds = new Set();
        for (const seed of seeds) {
          if (!seed?.id) continue;
          const conns = await emb.findCrossDomainConnections(seed.id, allDTUs, 3);
          for (const c of (conns || [])) {
            if (c?.id && !seenIds.has(c.id)) {
              crossDomainConnections.push(c);
              seenIds.add(c.id);
            }
          }
          if (crossDomainConnections.length >= 8) break;
        }
      }
    } catch (e) {
      log('debug', 'retrieve_cross_domain_failed', { error: e?.message });
    }

    // ── Merge into a unified dtus[] list (order: deep, semantic, domain, prior) ──
    const merged = [];
    const mergedIds = new Set();
    const push = (d) => {
      if (!d || typeof d !== 'object') return;
      if (!d.id || mergedIds.has(d.id)) return;
      merged.push(d);
      mergedIds.add(d.id);
    };
    for (const d of deepOut) push(d);
    for (const d of semantic) push(d);
    for (const d of domainSpecific) push(d);
    for (const d of priorAnswers) push(d);

    const totalSources =
      (Array.isArray(semantic) ? semantic.length : 0) +
      domainSpecific.length +
      priorAnswers.length +
      entityInsights.length;

    return {
      dtus: merged.slice(0, 50),
      semantic: Array.isArray(semantic) ? semantic : [],
      domainSpecific,
      priorAnswers,
      entityInsights,
      crossDomainConnections,
      deepQuestion: isDeep,
      primaryAnswerDTU,
      totalSources,
    };
  }

  // ── STSVK: Load theorems from the DTU lattice ──────────────────────────

  /**
   * Load the 480 STSVK theorems + the root fixed-point identity from the DTU
   * store. These are the seed DTUs (dtus-part1..8 + dtus-root) and are
   * identified by:
   *   - id starting with `dtu_root_fixed_point`
   *   - id starting with `dtu_0` (covers dtu_001..dtu_480)
   *   - any tag matching /^stsvk_/
   *
   * Cached after first call. Graceful: returns [] if no DTUs loaded.
   *
   * @returns {Promise<object[]>}
   */
  async function loadSTSVKTheorems() {
    if (_stsvkCache) return _stsvkCache;

    if (!dtuStore || typeof dtuStore.values !== 'function') {
      _stsvkCache = [];
      _stsvkLoadedAt = Date.now();
      log('warn', 'stsvk_load_no_store');
      return _stsvkCache;
    }

    const theorems = [];
    for (const dtu of dtuStore.values()) {
      if (!dtu || typeof dtu !== 'object') continue;
      const id = String(dtu.id || '');
      const tags = dtu.tags || [];

      const isRoot = id.startsWith('dtu_root_fixed_point');
      const isNumbered = /^dtu_0\d+/.test(id); // dtu_001..dtu_0999
      const hasStsvkTag = tags.some(t => /^stsvk_/i.test(String(t)));

      // Also accept core-tier formal_model / formal_identity as STSVK-adjacent
      const isFormalCore =
        dtu.tier === 'core' &&
        (dtu.machine?.kind === 'formal_model' || dtu.machine?.kind === 'formal_identity');

      if (isRoot || isNumbered || hasStsvkTag || isFormalCore) {
        theorems.push(dtu);
      }
    }

    _stsvkCache = theorems;
    _stsvkLoadedAt = Date.now();
    log('info', 'stsvk_loaded', { count: theorems.length });
    return _stsvkCache;
  }

  /**
   * Invalidate the STSVK cache (call after bulk DTU import).
   */
  function invalidateSTSVKCache() {
    _stsvkCache = null;
    _stsvkLoadedAt = 0;
  }

  // ── STSVK: Constraint check ────────────────────────────────────────────

  /**
   * Heuristic fallback check — used when no conscious brain is available.
   * Looks for obvious violation keywords against each invariant.
   *
   * @param {string} answer
   * @param {string} invariant
   * @returns {boolean} true if violation detected
   */
  function _heuristicViolates(answer, invariant) {
    const a = String(answer || '').toLowerCase();
    const inv = String(invariant || '').toLowerCase();

    // Flag obvious contradictions against common STSVK invariant families.
    if (inv.includes('bounded') && /\bunbounded\b|\binfinite\b/.test(a)) return true;
    if (inv.includes('non-increasing') && /\bincreasing\b|\bgrows without\b/.test(a)) return true;
    if (inv.includes('conserv') && /\blost\b|\bdestroyed\b|\bvanish/.test(a)) return true;
    if (inv.includes('fixed point') && /\bno fixed point\b|\bunstable fixed\b/.test(a)) return true;
    if (inv.includes('feasible') && /\binfeasible\b|\bimpossible\b/.test(a)) return true;

    return false;
  }

  /**
   * Ask the conscious brain whether the answer violates a single invariant.
   * Returns true/false. On any error returns false (graceful skip).
   *
   * @param {string} answer
   * @param {string} invariant
   * @returns {Promise<boolean>}
   */
  async function _brainViolates(answer, invariant) {
    if (!brain || typeof brain.query !== 'function') {
      return _heuristicViolates(answer, invariant);
    }
    try {
      const prompt = TASK_PROMPTS.oracleInvariantCheck({ answer, invariant });
      const resp = await brain.query('conscious', { prompt, taskType: 'classification' });
      const text = String(resp?.content || resp?.text || '').toUpperCase();
      return text.includes('VIOLATES');
    } catch (e) {
      log('debug', 'stsvk_brain_check_failed', { error: e?.message });
      return _heuristicViolates(answer, invariant);
    }
  }

  /**
   * Run the STSVK constraint check against a synthesized answer.
   *
   * For each relevant theorem, extracts its invariants (from
   * core.invariants and machine.math.constraints) and asks the conscious
   * brain (or falls back to a heuristic) whether the answer violates them.
   *
   * @param {string} answer
   * @param {object[]} relevantTheorems
   * @returns {Promise<{
   *   violatedTheorems: Array<{ id: string, invariant: string }>,
   *   satisfiedTheorems: string[],
   *   constraintScore: number,
   *   checked: number,
   *   skipped: boolean,
   * }>}
   */
  async function runSTSVKConstraintCheck(answer, relevantTheorems) {
    const theorems = Array.isArray(relevantTheorems) ? relevantTheorems : [];
    if (theorems.length === 0) {
      return {
        violatedTheorems: [],
        satisfiedTheorems: [],
        constraintScore: 1,
        checked: 0,
        skipped: true,
      };
    }

    const violated = [];
    const satisfied = [];
    let checked = 0;

    // Cap to keep latency bounded; the most-relevant theorems were filtered first.
    const CAP = 12;
    for (const t of theorems.slice(0, CAP)) {
      const invariants = [
        ...((t.core && t.core.invariants) || []),
        ...((t.machine && t.machine.math && t.machine.math.constraints) || []),
      ].map(String).filter(Boolean);

      if (invariants.length === 0) continue;

      let theoremViolated = false;
      let violatedBy = null;
      for (const inv of invariants) {
        checked++;
         
        const bad = await _brainViolates(answer, inv);
        if (bad) {
          theoremViolated = true;
          violatedBy = inv;
          break;
        }
      }

      if (theoremViolated) {
        violated.push({ id: t.id, invariant: violatedBy });
      } else {
        satisfied.push(t.id);
      }
    }

    const total = violated.length + satisfied.length;
    const constraintScore = total === 0 ? 1 : satisfied.length / total;

    stats.stsvkChecksRun++;
    if (violated.length > 0) stats.stsvkViolations += violated.length;

    return {
      violatedTheorems: violated,
      satisfiedTheorems: satisfied,
      constraintScore,
      checked,
      skipped: false,
    };
  }

  // ── Phase 3: Compute ────────────────────────────────────────────────────

  /**
   * Synthesize an answer from retrieved DTUs. If the query is formal /
   * computational / theoretical, also run the STSVK constraint check.
   *
   * @param {string} query
   * @param {object} analysis
   * @param {object} retrieval
   * @returns {Promise<{ answer: string, stsvk: object|null }>}
   */
  /**
   * Try to invoke an action on a domain handler via a variety of common
   * API shapes. Returns `null` on any failure.
   */
  async function _invokeDomainAction(handler, action, payload) {
    if (!handler) return null;
    try {
      if (typeof handler[action] === 'function') {
        return await handler[action](payload);
      }
      if (typeof handler.invoke === 'function') {
        return await handler.invoke(action, payload);
      }
      if (typeof handler.run === 'function') {
        return await handler.run(action, payload);
      }
    } catch (e) {
      log('debug', 'domain_action_failed', {
        action, error: e?.message,
      });
    }
    return null;
  }

  /**
   * Phase 3 — Compute.
   *
   * Upgraded: runs real domain modules (physics, math, chem, quantum, sim)
   * and the quality gate when the analysis asks for them. Always runs the
   * STSVK constraint check (same logic as before — that's the one part of
   * compute() that was already real and we keep it exactly).
   *
   * Note: this phase NO LONGER produces the user-facing answer string.
   * That now lives in `synthesize()`. compute() returns raw computation
   * results which synthesize() will feed to the conscious brain.
   *
   * @param {string} query
   * @param {object} analysis
   * @param {object} retrieval
   * @returns {Promise<object>}
   */
  async function compute(query, analysis, retrieval, context = {}) {
    const requiredSystems = Array.isArray(analysis?.requiredSystems)
      ? analysis.requiredSystems
      : [];
    const primaryDomains = analysis?.primaryDomains || [];

    const results = {};
    let computationCount = 0;
    let hasProofs = false;
    let hasSimulation = false;

    // ── Physics / math / chem / quantum modules ─────────────────────────
    const wantsPhysicsModules =
      requiredSystems.includes('physics_modules') ||
      requiredSystems.includes('physics') ||
      primaryDomains.some(d => ['physics', 'math', 'chem', 'quantum'].includes(String(d).toLowerCase()));

    if (wantsPhysicsModules) {
      const candidates = ['physics', 'math', 'chem', 'quantum'];
      for (const name of candidates) {
        const handler = domainHandlers?.[name];
        if (!handler) continue;
        const analysisResult = await _invokeDomainAction(handler, 'analyze', {
          query, analysis, retrieval,
        });
        if (analysisResult) {
          results[`${name}_analyze`] = analysisResult;
          computationCount++;
        }
        const computeResult = await _invokeDomainAction(handler, 'compute', {
          query, analysis, retrieval,
        });
        if (computeResult) {
          results[`${name}_compute`] = computeResult;
          computationCount++;
          // Heuristic proof detection on the result payload.
          const serialized = typeof computeResult === 'string'
            ? computeResult
            : JSON.stringify(computeResult);
          if (/proof|theorem|QED|∎/.test(serialized)) hasProofs = true;
        }
      }
    }

    // ── Simulation ──────────────────────────────────────────────────────
    if (requiredSystems.includes('simulation')) {
      const sim = domainHandlers?.sim || domainHandlers?.simulation;
      if (sim) {
        const simResult = await _invokeDomainAction(sim, 'run', {
          query, analysis, retrieval,
        }) || await _invokeDomainAction(sim, 'simulate', {
          query, analysis, retrieval,
        });
        if (simResult) {
          results.simulation = simResult;
          computationCount++;
          hasSimulation = true;
        }
      }
    }

    // ── Validation (quality gate on any produced artifact) ──────────────
    if (requiredSystems.includes('validation')) {
      try {
        const qg = await _getQualityGate();
        const validateFn =
          qg?.validateArtifact ||
          qg?.validateForRender ||
          null;
        if (validateFn && Object.keys(results).length > 0) {
          // Pick the first domain-produced artifact-ish result.
          const [firstKey, firstResult] = Object.entries(results)[0];
          const domain = firstKey.split('_')[0];
          const action = firstKey.split('_').slice(1).join('_') || 'compute';
          const gateResult = validateFn(domain, action, firstResult);
          results.qualityGate = gateResult;
          computationCount++;
        }
      } catch (e) {
        log('debug', 'compute_quality_gate_failed', { error: e?.message });
      }
    }

    // ── STSVK constraint check ──────────────────────────────────────────
    //
    // Kept exactly as it was — this is the bit that already worked. We use
    // a lightweight "surface" built from the query + result keys so the
    // STSVK invariant matcher has something to scan before the final
    // synthesized answer exists.
    let stsvk = null;
    const needsFormalCheck =
      analysis.isFormal ||
      analysis.queryType === 'formal' ||
      analysis.taskType === 'formal' ||
      analysis.queryType === 'computational' ||
      analysis.taskType === 'computational' ||
      analysis.queryType === 'theoretical' ||
      analysis.taskType === 'theoretical';

    if (needsFormalCheck) {
      try {
        const allTheorems = await loadSTSVKTheorems();
        if (allTheorems.length > 0) {
          const q = String(query).toLowerCase();
          const terms = q.split(/\W+/).filter(t => t.length > 3);
          const relevant = allTheorems.filter(t => {
            const hay = [
              t.id,
              ...(t.tags || []),
              t.human?.summary,
              ...(t.human?.bullets || []),
            ].filter(Boolean).join(' ').toLowerCase();
            return terms.some(term => hay.includes(term));
          });
          const toCheck = relevant.length > 0
            ? relevant
            : allTheorems.filter(t => String(t.id).startsWith('dtu_root_fixed_point'));

          // Surface string: query + serialized result keys (cheap pre-check).
          const surface = `${query}\n${JSON.stringify(results).slice(0, 4000)}`;
          stsvk = await runSTSVKConstraintCheck(surface, toCheck);
        } else {
          stsvk = {
            violatedTheorems: [],
            satisfiedTheorems: [],
            constraintScore: 1,
            checked: 0,
            skipped: true,
            reason: 'no_stsvk_loaded',
          };
        }
      } catch (e) {
        log('warn', 'stsvk_check_error', { error: e?.message });
        stsvk = {
          violatedTheorems: [],
          satisfiedTheorems: [],
          constraintScore: 1,
          checked: 0,
          skipped: true,
          reason: 'error',
        };
      }
    }

    // ── Compute Registry execution ──────────────────────────────────────
    //
    // Lazy dynamic import of ./compute-registry.js. We ask it which
    // capabilities match the query, then execute them all in a batch.
    // Results are surfaced as `registryCompute` in the return shape; the
    // synthesize() phase uses them as computational ground truth.
    let registryCompute = null;
    try {
      const { matchCapabilities, executeBatch } = await import('./compute-registry.js');
      const matches = matchCapabilities(query, { limit: 5, threshold: 0.15 });
      if (Array.isArray(matches) && matches.length > 0) {
        const keys = matches.map(m => m.key);
        const batch = await executeBatch(keys, { query, ...analysis }, {
          domainHandlers: opts.lensActions || opts.domainHandlers || domainHandlers,
          ctx: { userId: context?.userId, STATE: opts.STATE },
        });
        registryCompute = {
          matchedCapabilities: matches.map(m => ({
            key: m.key,
            score: m.score,
            description: m.capability?.description,
          })),
          executionResults: batch?.results || [],
          successCount: batch?.successCount || 0,
          failureCount: batch?.failureCount || 0,
        };
        stats.computeRegistryCalls = (stats.computeRegistryCalls || 0) + 1;
      }
    } catch (e) {
      log('debug', 'compute_registry_failed', { error: e?.message });
    }

    return {
      results,
      computationCount,
      hasProofs,
      hasSimulation,
      stsvk,
      registryCompute,
    };
  }

  // ── Phase 4: Synthesize ─────────────────────────────────────────────────

  /**
   * Phase 4 — Synthesize.
   *
   * Build a rich context object and ask the conscious brain to produce
   * the final Oracle answer. Returns the answer plus structured side data:
   * sources, computations, connections, epistemic breakdown.
   *
   * Graceful degrade: if no brain is reachable, fall back to a templated
   * synthesis that still cites sources and lists computations so the
   * downstream phases have something valid to validate and record.
   *
   * @param {string} query
   * @param {object} analysis
   * @param {object} retrieval
   * @param {object} computation
   * @returns {Promise<object>}
   */
  async function synthesize(query, analysis, retrieval, computation) {
    const sources = Array.isArray(retrieval?.dtus) ? retrieval.dtus : [];
    const topSources = sources.slice(0, 10);
    const computationResults = computation?.results || {};
    const crossDomainConnections = retrieval?.crossDomainConnections || [];
    const entityInsights = retrieval?.entityInsights || [];
    const priorAnswers = retrieval?.priorAnswers || [];

    // Build a compact source block the LLM can cite against.
    const sourceBlock = topSources.map((d, i) => {
      const summary = d.human?.summary || d.title || '';
      const bullets = Array.isArray(d.human?.bullets) ? d.human.bullets.slice(0, 3) : [];
      return `[${d.id}] (source ${i + 1}) ${summary}` +
        (bullets.length ? `\n  - ${bullets.join('\n  - ')}` : '');
    }).join('\n');

    const computationBlock = Object.entries(computationResults).map(([k, v]) => {
      const val = typeof v === 'string' ? v : JSON.stringify(v);
      return `- ${k}: ${val.slice(0, 400)}`;
    }).join('\n');

    // Ground truth from compute registry (these are MATHEMATICAL results,
    // not guesses). Feed into synthesis as an authoritative block the
    // conscious brain must respect.
    const computationalGroundTruth = (computation?.registryCompute?.executionResults || [])
      .filter(r => r && r.ok)
      .map(r => ({
        capability: r.capability?.description,
        result: r.result,
        durationMs: r.durationMs,
      }));

    const groundTruthBlock = computationalGroundTruth.map((g, i) => {
      const val = typeof g.result === 'string'
        ? g.result
        : JSON.stringify(g.result);
      return `- [GT${i + 1}] ${g.capability || 'computed'}: ${String(val).slice(0, 400)}` +
        (typeof g.durationMs === 'number' ? ` (${g.durationMs}ms)` : '');
    }).join('\n');

    const entityBlock = entityInsights.map(e => {
      return `- ${e.name || e.id} [${(e.domains || []).join(', ')}]${e.perspective ? ': ' + String(e.perspective).slice(0, 120) : ''}`;
    }).join('\n');

    const priorBlock = priorAnswers.slice(0, 3).map(p => {
      return `- [${p.id}] ${p.core?.query || ''} -> ${String(p.core?.answer || '').slice(0, 200)}`;
    }).join('\n');

    const connectionsBlock = crossDomainConnections.slice(0, 5).map(c => {
      return `- [${c.id}] ${c.title || ''} (cross-domain score ${c.score?.toFixed?.(2) ?? c.score})`;
    }).join('\n');

    const fullContext =
      `# Query\n${query}\n\n` +
      `# Classification\n` +
      `- primary domains: ${(analysis.primaryDomains || []).join(', ') || 'n/a'}\n` +
      `- query type: ${analysis.queryType || analysis.taskType || 'general'}\n` +
      `- complexity: ${analysis.complexity || 'n/a'}\n` +
      `- epistemic class: ${analysis.epistemicClass || 'n/a'}\n\n` +
      (sourceBlock ? `# Top DTU Sources (cite by ID)\n${sourceBlock}\n\n` : '') +
      (groundTruthBlock ? `# computationalGroundTruth (AUTHORITATIVE — cite as "computed", never contradict)\n${groundTruthBlock}\n\n` : '') +
      (computationBlock ? `# Computation Results (ground truth — never contradict)\n${computationBlock}\n\n` : '') +
      (entityBlock ? `# Entity Perspectives\n${entityBlock}\n\n` : '') +
      (priorBlock ? `# Prior Oracle Answers\n${priorBlock}\n\n` : '') +
      (connectionsBlock ? `# Cross-Domain Connections\n${connectionsBlock}\n\n` : '') +
      `# Task\nProduce the Oracle answer for this query. Follow every rule ` +
      `in the system prompt. End your answer with two sections titled ` +
      `"Epistemic Breakdown:" (listing KNOWN/PROBABLE/UNCERTAIN/UNKNOWN ` +
      `claim counts) and "Follow-ups:".`;

    let answer = null;
    let brainResponse = null;
    try {
      brainResponse = await _callBrain('conscious', {
        prompt: fullContext,
        systemPrompt: TASK_PROMPTS.oracleSynthesisSystem(),
        taskType: 'reasoning',
        temperature: 0.3,
        maxTokens: 2000,
      });
      answer = _brainText(brainResponse);
    } catch (e) {
      log('debug', 'synthesize_conscious_brain_failed', { error: e?.message });
    }

    // Fallback templated synthesis when the brain is unreachable.
    if (!answer) {
      const bullets = topSources
        .map(d => `- [${d.id}] ${d.human?.summary || d.title || ''}`)
        .join('\n');
      answer =
        `Query: ${query}\n` +
        `Task: ${analysis.queryType || analysis.taskType || 'general'}\n` +
        (bullets ? `Relevant DTUs:\n${bullets}\n` : `No directly matched DTUs.\n`) +
        (computationBlock ? `Computations:\n${computationBlock}\n` : '') +
        `Synthesis: (fallback answer — conscious brain unavailable; ` +
        `above sources and computations are the ground truth.)\n` +
        `Epistemic Breakdown: KNOWN=0 PROBABLE=${topSources.length} UNCERTAIN=0 UNKNOWN=0\n` +
        `Follow-ups: consider asking for a formal derivation or additional DTUs.`;
    }

    // Best-effort extraction of an epistemic breakdown from the answer text.
    const epistemicBreakdown = {
      known: 0, probable: 0, uncertain: 0, unknown: 0,
    };
    try {
      const upper = String(answer).toUpperCase();
      epistemicBreakdown.known     = (upper.match(/\bKNOWN\b/g)     || []).length;
      epistemicBreakdown.probable  = (upper.match(/\bPROBABLE\b/g)  || []).length;
      epistemicBreakdown.uncertain = (upper.match(/\bUNCERTAIN\b/g) || []).length;
      epistemicBreakdown.unknown   = (upper.match(/\bUNKNOWN\b/g)   || []).length;
    } catch { /* noop */ }

    return {
      answer,
      sources: topSources.map(d => ({
        id: d.id,
        title: d.title || d.human?.summary || '',
      })),
      computations: Object.keys(computationResults),
      computationalGroundTruth,
      connections: crossDomainConnections.slice(0, 5).map(c => ({
        id: c.id,
        title: c.title,
        score: c.score,
      })),
      epistemicBreakdown,
      _brainResponse: brainResponse ? { id: brainResponse.id, brain: brainResponse.brain } : null,
    };
  }

  // ── Phase 4: Cite ───────────────────────────────────────────────────────

  /**
   * Attach citations for both retrieved DTUs and STSVK theorems used in
   * validation.
   *
   * @param {object} retrieval
   * @param {object|null} stsvk
   * @returns {{ sources: string[], stsvkCitations: string[] }}
   */
  function cite(retrieval, stsvk) {
    const sources = (retrieval?.dtus || []).map(d => d.id).filter(Boolean);
    const stsvkCitations = stsvk
      ? [
        ...stsvk.satisfiedTheorems,
        ...stsvk.violatedTheorems.map(v => v.id),
      ]
      : [];
    return { sources, stsvkCitations };
  }

  // ── Phase 5: Validate ──────────────────────────────────────────────────

  /**
   * Soft consistency check between the synthesized answer and the values
   * returned by the compute registry. These registry values are ground
   * truth (formal logic, symbolic math, numerical methods, physics) so any
   * disagreement is treated as a warning, not a hard failure.
   *
   * Strategy: extract numeric literals from each successful registry result
   * and look for direct contradictions in the answer text (same label,
   * different number). Soft check — warn only.
   *
   * @param {string} answer
   * @param {object|null} registryCompute
   * @returns {Promise<{ consistent: boolean, violations: Array<object>, checked: number }>}
   */
  async function _checkComputeConsistency(answer, registryCompute) {
    const empty = { consistent: true, violations: [], checked: 0 };
    if (!registryCompute || !Array.isArray(registryCompute.executionResults)) return empty;
    const results = registryCompute.executionResults.filter(r => r && r.ok);
    if (results.length === 0) return empty;

    const violations = [];
    const answerText = String(answer || '');
    const answerLower = answerText.toLowerCase();

    // Collect all numeric literals in the answer for fast contradiction
    // scanning. We match integers and floats, optionally with a sign and
    // exponent. This is deliberately coarse.
    const answerNumbers = (answerText.match(/-?\d+(?:\.\d+)?(?:[eE][+-]?\d+)?/g) || [])
      .map(Number)
      .filter(n => Number.isFinite(n));

    const approxEqual = (a, b) => {
      if (!Number.isFinite(a) || !Number.isFinite(b)) return false;
      const mag = Math.max(Math.abs(a), Math.abs(b), 1e-9);
      return Math.abs(a - b) / mag < 0.02; // within 2%
    };

    const extractNumbers = (val) => {
      const out = [];
      const visit = (x) => {
        if (x == null) return;
        if (typeof x === 'number' && Number.isFinite(x)) out.push(x);
        else if (typeof x === 'string') {
          const ms = x.match(/-?\d+(?:\.\d+)?(?:[eE][+-]?\d+)?/g);
          if (ms) for (const m of ms) { const n = Number(m); if (Number.isFinite(n)) out.push(n); }
        } else if (Array.isArray(x)) x.forEach(visit);
        else if (typeof x === 'object') for (const k of Object.keys(x)) visit(x[k]);
      };
      visit(val);
      return out;
    };

    let checked = 0;
    for (const r of results) {
      const capDesc = r.capability?.description || r.key || 'computed';
      const computedNumbers = extractNumbers(r.result);
      if (computedNumbers.length === 0) continue;
      checked++;

      // If the answer mentions the capability's description and has
      // numbers that wildly disagree with the computed numbers, flag it.
      const descLower = String(capDesc).toLowerCase();
      const mentioned =
        descLower.length > 0 &&
        (answerLower.includes(descLower) ||
          descLower.split(/\W+/).filter(t => t.length > 4)
            .some(tok => answerLower.includes(tok)));
      if (!mentioned) continue;

      for (const truth of computedNumbers.slice(0, 6)) {
        // If the answer contains ANY number close to the truth, consider
        // it cited — no contradiction. Otherwise, if the answer contains
        // similarly-magnitude numbers that all differ, that's a soft flag.
        const anyClose = answerNumbers.some(n => approxEqual(n, truth));
        if (anyClose) continue;
        const similarMag = answerNumbers.filter(n => {
          const mag = Math.max(Math.abs(n), Math.abs(truth), 1e-9);
          const ratio = Math.abs(n) / mag;
          return ratio > 0.1 && ratio < 10;
        });
        if (similarMag.length > 0) {
          violations.push({
            capability: capDesc,
            computed: truth,
            answerValues: similarMag.slice(0, 3),
          });
          break;
        }
      }
    }

    return { consistent: violations.length === 0, violations, checked };
  }

  /**
   * Compute final confidence. Combines retrieval coverage with the STSVK
   * constraint score when available.
   *
   * Confidence = 0.5 * coverage + 0.5 * stsvkScore
   *   coverage  — fraction based on how many DTUs were retrieved (capped)
   *   stsvkScore — from runSTSVKConstraintCheck; 1 when not applicable
   *
   * @param {object} retrieval
   * @param {object|null} stsvk
   * @returns {{ confidence: number, components: object }}
   */
  async function validate(retrieval, stsvk, answer = '', extras = {}) {
    const nDtus = (retrieval?.dtus || []).length;
    const coverage = Math.min(1, nDtus / 8);
    const stsvkScore = stsvk && !stsvk.skipped ? stsvk.constraintScore : 1;
    const sources = extras.sources || retrieval?.dtus || [];

    // ── Multi-layer validation (Phase 5 upgrade) ─────────────────────────
    //
    // Three independent checks run in Promise.all:
    //   1. Repair brain fact-check — tries to catch hallucinations
    //   2. Quality gate — structural validation of the artifact
    //   3. STSVK constraint check — already run in compute() and passed in
    //
    // Each produces a [0,1] score. The final confidence is a weighted mean.

    const factCheckPromise = (async () => {
      try {
        const sourceSummary = (Array.isArray(sources) ? sources : [])
          .slice(0, 8)
          .map(s => `[${s.id || s}] ${s.title || s.human?.summary || ''}`)
          .join('\n');
        const resp = await _callBrain('repair', {
          task: 'factCheck',
          taskType: 'diagnosis',
          temperature: 0.1,
          maxTokens: 300,
          prompt:
            `Fact-check the following Oracle answer against the provided ` +
            `sources. Reply with a strict JSON object:\n` +
            `{ "score": number (0..1), "issues": [string], "verdict": ` +
            `"pass"|"warn"|"fail" }\n\n` +
            `# Sources\n${sourceSummary || '(none)'}\n\n` +
            `# Answer\n${String(answer || '').slice(0, 4000)}`,
        });
        const text = _brainText(resp);
        const parsed = _parseJSONFromBrain(text);
        if (parsed && typeof parsed === 'object') {
          return {
            score: typeof parsed.score === 'number'
              ? Math.max(0, Math.min(1, parsed.score))
              : 0.7,
            issues: Array.isArray(parsed.issues) ? parsed.issues : [],
            verdict: parsed.verdict || 'warn',
            available: true,
          };
        }
        // Brain replied but not JSON — heuristic: look for keywords.
        if (text) {
          const lower = text.toLowerCase();
          let verdict = 'warn';
          if (/\bpass\b|\bok\b|\baccurate\b/.test(lower)) verdict = 'pass';
          if (/\bfail\b|\bwrong\b|\bhallucinat/.test(lower)) verdict = 'fail';
          const score = verdict === 'pass' ? 0.85 : verdict === 'fail' ? 0.2 : 0.6;
          return { score, issues: [], verdict, available: true };
        }
        return { score: 0.7, issues: [], verdict: 'skipped', available: false };
      } catch (e) {
        log('debug', 'validate_fact_check_failed', { error: e?.message });
        return { score: 0.7, issues: [], verdict: 'error', available: false };
      }
    })();

    const qualityGatePromise = (async () => {
      try {
        const qg = await _getQualityGate();
        const validateFn = qg?.validateArtifact || qg?.validateForRender;
        if (!validateFn) {
          return { score: 0.7, pass: true, issues: [], available: false };
        }
        // Build a minimal artifact-shaped payload from the answer.
        const artifact = {
          content: String(answer || ''),
          sources: (Array.isArray(sources) ? sources : []).map(s => s.id || s),
          query: extras.query,
        };
        const domain = extras.analysis?.primaryDomains?.[0] || 'oracle';
        const action = 'synthesize';
        const result = validateFn(domain, action, artifact);
        if (result && typeof result === 'object') {
          return {
            score: typeof result.score === 'number' ? result.score : (result.pass ? 1 : 0.5),
            pass: !!result.pass,
            issues: Array.isArray(result.issues) ? result.issues : [],
            available: true,
          };
        }
        return { score: 0.7, pass: true, issues: [], available: false };
      } catch (e) {
        log('debug', 'validate_quality_gate_failed', { error: e?.message });
        return { score: 0.7, pass: true, issues: [], available: false };
      }
    })();

    const [factCheck, qualityGate] = await Promise.all([
      factCheckPromise,
      qualityGatePromise,
    ]);

    // Chicken2 Gate — lazy, graceful degrade. Runs on the synthesized answer.
    let chicken2 = null;
    try {
      chicken2 = await _runChicken2Gate(answer || '', {
        query: extras.query,
        analysis: extras.analysis,
        retrievalSize: nDtus,
      });
    } catch (e) {
      chicken2 = { passed: true, confidence: 0.5, reason: `gate error: ${e?.message || e}` };
    }

    // Feasibility Manifold — lazy, graceful degrade.
    let manifold = null;
    try {
      manifold = await _checkManifold(answer || '');
    } catch (e) {
      manifold = { inside: true, score: 0.5, reason: `manifold error: ${e?.message || e}` };
    }

    // Compute-registry consistency — soft check, warnings only.
    let computeConsistency = { consistent: true, violations: [], checked: 0 };
    try {
      computeConsistency = await _checkComputeConsistency(
        answer || '',
        extras.registryCompute || null,
      );
    } catch (e) {
      log('debug', 'validate_compute_consistency_failed', { error: e?.message });
      computeConsistency = { consistent: true, violations: [], checked: 0 };
    }

    // Base weighting: if STSVK was actually applied, weight it heavily.
    // The new multi-layer validators (factCheck + qualityGate) contribute
    // 20% each when they return a non-default score.
    const stsvkWeighted = stsvk && !stsvk.skipped
      ? 0.3 * coverage + 0.5 * stsvkScore
      : 0.6 * coverage + 0.2 * stsvkScore;
    const multiLayerBonus =
      0.1 * (factCheck.available ? factCheck.score : 0.7) +
      0.1 * (qualityGate.available ? qualityGate.score : 0.7);
    const baseConfidence = stsvkWeighted + multiLayerBonus;

    // Blend Chicken2 Gate @ 30% when it produced a real (non-unavailable)
    // result. We detect "real" by the presence of a numeric confidence AND
    // the absence of an "unavailable"/"error" reason string.
    const gateReason = String(chicken2?.reason || '');
    const gateAvailable =
      typeof chicken2?.confidence === 'number' &&
      !/unavailable|error/i.test(gateReason);

    const manifoldAvailable =
      manifold &&
      typeof manifold.score === 'number' &&
      !/unavailable|error/i.test(String(manifold.reason || ''));

    let confidence = baseConfidence;
    if (gateAvailable) {
      confidence = 0.7 * baseConfidence + 0.3 * Number(chicken2.confidence);
    }
    if (manifoldAvailable) {
      // Manifold contributes as a 20% multiplicative prior on top.
      const mScore = Number(manifold.score);
      confidence = 0.8 * confidence + 0.2 * mScore;
    }

    // Hard cap: any violation above 25% forces low confidence.
    const violationRatio = stsvk && !stsvk.skipped && (stsvk.violatedTheorems.length + stsvk.satisfiedTheorems.length) > 0
      ? stsvk.violatedTheorems.length / (stsvk.violatedTheorems.length + stsvk.satisfiedTheorems.length)
      : 0;
    let capped = violationRatio > 0.25 ? Math.min(confidence, 0.4) : confidence;

    // Chicken2 hard gate: if it explicitly failed, cap confidence.
    if (gateAvailable && chicken2.passed === false) {
      capped = Math.min(capped, 0.35);
    }
    // Manifold hard gate: outside the feasibility manifold caps too.
    if (manifoldAvailable && manifold.inside === false) {
      capped = Math.min(capped, 0.4);
    }

    // Collect warnings surfaced by any validator.
    const warnings = [];
    if (factCheck.verdict === 'fail') warnings.push('fact_check_failed');
    if (factCheck.verdict === 'warn') warnings.push('fact_check_warning');
    if (Array.isArray(factCheck.issues) && factCheck.issues.length > 0) {
      warnings.push(...factCheck.issues.map(s => `fact_check:${String(s).slice(0, 80)}`));
    }
    if (qualityGate.available && qualityGate.pass === false) warnings.push('quality_gate_failed');
    if (Array.isArray(qualityGate.issues) && qualityGate.issues.length > 0) {
      warnings.push(...qualityGate.issues.map(s => {
        const msg = typeof s === 'string' ? s : (s.issue || JSON.stringify(s));
        return `quality_gate:${String(msg).slice(0, 80)}`;
      }));
    }
    if (stsvk && !stsvk.skipped && violationRatio > 0) {
      warnings.push(`stsvk_violation_ratio:${violationRatio.toFixed(2)}`);
    }
    if (gateAvailable && chicken2.passed === false) warnings.push('chicken2_gate_failed');
    if (manifoldAvailable && manifold.inside === false) warnings.push('outside_feasibility_manifold');
    if (!computeConsistency.consistent) {
      warnings.push(`compute_consistency_violations:${computeConsistency.violations.length}`);
      for (const v of computeConsistency.violations.slice(0, 3)) {
        warnings.push(
          `compute_contradicts:${String(v.capability).slice(0, 60)}:` +
          `computed=${v.computed}`,
        );
      }
    }

    // Hard caps based on multi-layer verdicts.
    if (factCheck.verdict === 'fail') capped = Math.min(capped, 0.35);
    if (qualityGate.available && qualityGate.pass === false) capped = Math.min(capped, 0.45);

    return {
      confidence: Math.round(capped * 1000) / 1000,
      factCheck,
      qualityGate,
      stsvk,
      warnings,
      components: {
        coverage,
        stsvkScore,
        violationRatio,
        factCheckScore: factCheck.score,
        qualityGateScore: qualityGate.score,
        chicken2Confidence: gateAvailable ? chicken2.confidence : null,
        manifoldScore: manifoldAvailable ? manifold.score : null,
      },
      chicken2Gate: chicken2,
      manifoldCheck: manifold,
      computeConsistency,
    };
  }

  // ── Phase 6: Record ────────────────────────────────────────────────────

  /**
   * Persist the result as an oracle_answer DTU. Tags include `oracle_answer`
   * plus citations of every STSVK theorem the answer was validated against.
   *
   * @param {string} query
   * @param {string} answer
   * @param {object} citations
   * @param {object} validation
   * @param {object|null} stsvk
   * @returns {{ id: string } | null}
   */
  async function record(query, answer, citations, validation, stsvk, extras = {}) {
    if (!dtuStore || typeof dtuStore.set !== 'function') return null;

    const id = `dtu_oracle_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
    const nowISO = new Date().toISOString();

    const stsvkTheoremTags = (citations.stsvkCitations || [])
      .map(tid => `validated_against:${tid}`);

    // New enrichment fields — regime, manifold, chicken2 — are sourced
    // from extras (populated by solve()).
    const regime = extras.regime || 'binary';
    const manifoldCheck = extras.manifoldCheck || validation?.manifoldCheck || null;
    const chicken2GateResult = extras.chicken2Gate || validation?.chicken2Gate || null;

    const regimeTag = `regime:${regime}`;
    const manifoldTag = manifoldCheck
      ? `manifold:${manifoldCheck.inside ? 'inside' : 'outside'}`
      : 'manifold:unknown';

    const dtu = {
      id,
      tier: 'regular',
      type: 'oracle_answer',
      tags: ['oracle_answer', ...stsvkTheoremTags, regimeTag, manifoldTag],
      human: {
        summary: `Oracle answer to: ${String(query).slice(0, 120)}`,
        bullets: [
          `confidence=${validation.confidence}`,
          `sources=${citations.sources.length}`,
          `stsvk_checked=${stsvk?.checked || 0}`,
          `stsvk_violations=${stsvk?.violatedTheorems?.length || 0}`,
          `regime=${regime}`,
          `manifold_inside=${manifoldCheck ? manifoldCheck.inside : 'unknown'}`,
        ],
      },
      core: {
        query,
        answer,
        sources: citations.sources,
        stsvkCitations: citations.stsvkCitations,
        validatedAgainstSTSVK: citations.stsvkCitations,
        regime,
        manifoldCheck: manifoldCheck
          ? { inside: !!manifoldCheck.inside, score: Number(manifoldCheck.score ?? 0) }
          : null,
        chicken2Gate: chicken2GateResult
          ? {
            passed: !!chicken2GateResult.passed,
            confidence: Number(chicken2GateResult.confidence ?? 0),
            reasons: chicken2GateResult.reasons || chicken2GateResult.reason || null,
          }
          : null,
      },
      machine: {
        kind: 'oracle_answer',
        validation,
        stsvk: stsvk || null,
        regime,
        manifoldCheck,
        chicken2Gate: chicken2GateResult,
      },
      createdAt: nowISO,
      updatedAt: nowISO,
    };

    let recordedId = null;
    try {
      dtuStore.set(id, dtu);
      stats.totalDTUsCreated++;
      recordedId = id;
    } catch (e) {
      log('warn', 'oracle_record_failed', { error: e?.message });
      return null;
    }

    // ── Royalty cascade ─────────────────────────────────────────────────
    //
    // For each cited source DTU, register a citation link from the new
    // oracle_answer DTU to the source. Then, if we have a userId, fire a
    // notional-amount royalty distribution (default 10 CC per oracle
    // answer). Every step is best-effort — royalty failures never block
    // the oracle's ability to return an answer.
    const userId = extras.userId || null;
    const royaltySummary = {
      citationsRegistered: 0,
      payouts: [],
      totalRoyalties: 0,
      errors: [],
    };

    try {
      if (db && Array.isArray(citations.sources) && citations.sources.length > 0) {
        const royalty = await _getRoyalty();
        if (royalty && typeof royalty.registerCitation === 'function') {
          for (const sourceId of citations.sources) {
            try {
              // Look up the source DTU for its creatorId.
              let sourceDTU = null;
              if (typeof dtuStore.get === 'function') {
                sourceDTU = dtuStore.get(sourceId);
              }
              const parentCreatorId =
                sourceDTU?.creatorId ||
                sourceDTU?.core?.creatorId ||
                sourceDTU?.machine?.creatorId ||
                'oracle_system';
              const reg = royalty.registerCitation(db, {
                childId: recordedId,
                parentId: sourceId,
                creatorId: userId || 'oracle_system',
                parentCreatorId,
              });
              if (reg?.ok) {
                royaltySummary.citationsRegistered++;
                stats.royaltiesCascaded++;
              } else if (reg?.error) {
                royaltySummary.errors.push(`citation:${sourceId}:${reg.error}`);
              }
            } catch (e) {
              royaltySummary.errors.push(`citation:${sourceId}:${e?.message}`);
            }
          }
        }

        if (
          royalty &&
          typeof royalty.distributeRoyalties === 'function' &&
          userId &&
          royaltySummary.citationsRegistered > 0
        ) {
          try {
            const txAmount = Number(extras.transactionAmount) || 10;
            const dist = royalty.distributeRoyalties(db, {
              contentId: recordedId,
              transactionAmount: txAmount,
              sourceTxId: `oracle_${recordedId}`,
              buyerId: userId,
              sellerId: 'oracle_system',
            });
            if (dist?.ok) {
              royaltySummary.payouts = dist.payouts || [];
              royaltySummary.totalRoyalties = dist.totalRoyalties || 0;
            } else if (dist?.error) {
              royaltySummary.errors.push(`distribute:${dist.error}`);
            }
          } catch (e) {
            royaltySummary.errors.push(`distribute:${e?.message}`);
          }
        }
      }
    } catch (e) {
      log('debug', 'oracle_royalty_cascade_failed', { error: e?.message });
      royaltySummary.errors.push(`cascade:${e?.message}`);
    }

    return { id: recordedId, royalty: royaltySummary };
  }

  // ── Top-level: solve() ─────────────────────────────────────────────────

  /**
   * Run the full Oracle pipeline.
   *
   * @param {string} query
   * @param {object} [context]
   * @returns {Promise<object>}
   */
  async function solve(query, context = {}) {
    const started = Date.now();

    const analysis = await analyze(query);
    // Annotate analysis with deep-question flag for downstream consumers.
    try { analysis.deepQuestion = detectDeepQuestion(query, analysis); } catch { /* noop */ }

    const retrieval = await retrieve(query, analysis);
    const computation = await compute(query, analysis, retrieval);
    const stsvk = computation?.stsvk || null;

    // Phase 4 — synthesize the user-facing answer via the conscious brain.
    const synthesis = await synthesize(query, analysis, retrieval, computation);
    const answer = synthesis.answer;

    const citations = cite(retrieval, stsvk);

    // Classify the answer into an STSVK regime (binary / continuous / mixed).
    let regime = 'binary';
    try { regime = await _classifyRegime(answer); } catch { /* keep default */ }
    analysis.regime = regime;

    const validation = await validate(retrieval, stsvk, answer, {
      query,
      analysis,
      sources: retrieval?.dtus,
      registryCompute: computation?.registryCompute || null,
    });

    const recorded = await record(query, answer, citations, validation, stsvk, {
      regime,
      manifoldCheck: validation.manifoldCheck,
      chicken2Gate: validation.chicken2Gate,
      userId: context?.userId || null,
      transactionAmount: context?.transactionAmount,
      synthesis,
      computation,
    });

    // Update running stats.
    stats.queriesResolved++;
    const prevAvg = stats.avgConfidence;
    stats.avgConfidence = prevAvg + (validation.confidence - prevAvg) / stats.queriesResolved;

    return {
      query,
      analysis,
      answer,
      sources: citations.sources,
      stsvkCitations: citations.stsvkCitations,
      stsvk,
      confidence: validation.confidence,
      validation,
      regime,
      manifoldCheck: validation.manifoldCheck || null,
      chicken2Gate: validation.chicken2Gate || null,
      deepQuestion: !!retrieval.deepQuestion,
      primaryAnswerDTU: retrieval.primaryAnswerDTU?.id || null,
      recordedDTU: recorded?.id || null,
      royalty: recorded?.royalty || null,
      synthesis: {
        connections: synthesis?.connections || [],
        computations: synthesis?.computations || [],
        epistemicBreakdown: synthesis?.epistemicBreakdown || null,
      },
      retrieval: {
        totalSources: retrieval?.totalSources || 0,
        semanticHits: (retrieval?.semantic || []).length,
        domainHits: (retrieval?.domainSpecific || []).length,
        priorAnswerHits: (retrieval?.priorAnswers || []).length,
        crossDomainHits: (retrieval?.crossDomainConnections || []).length,
      },
      computation: {
        computationCount: computation?.computationCount || 0,
        hasProofs: !!computation?.hasProofs,
        hasSimulation: !!computation?.hasSimulation,
      },
      // Compute Registry + Sub-Lens Bridge surfaces:
      compute: computation?.registryCompute || null,
      subLens: analysis._subLensExpanded
        ? {
          original: analysis._originalDomains || [],
          expanded: analysis.primaryDomains || [],
        }
        : null,
      elapsedMs: Date.now() - started,
      context,
    };
  }

  // ── Short-circuit: getAnswerForQuery ───────────────────────────────────

  /**
   * For deep questions, skip the full pipeline and return the best-matching
   * pre-seeded answer DTU directly. Returns `null` when the query is not a
   * deep question, when no answer seeds are loaded, or when nothing matches
   * strongly enough.
   *
   * Shape:
   *   { dtu, score, answer, id }
   *
   * @param {string} query
   * @returns {Promise<object|null>}
   */
  async function getAnswerForQuery(query) {
    if (!detectDeepQuestion(query)) return null;
    if (!dtuStore || typeof dtuStore.values !== 'function') return null;

    let best = null;
    try {
      for (const dtu of dtuStore.values()) {
        if (!_isAnswerSeedDTU(dtu)) continue;
        const base = _scoreAnswerDTU(query, dtu);
        const score = Math.min(1, base * 2); // same 2x boost as retrieve()
        if (score > 0 && (!best || score > best.score)) {
          best = { dtu, score };
        }
      }
    } catch (e) {
      log('warn', 'get_answer_for_query_failed', { error: e?.message });
      return null;
    }

    // Require a confident match — same >0.8 threshold used by retrieve().
    if (!best || best.score <= 0.8) return null;

    return {
      id: best.dtu.id,
      dtu: best.dtu,
      score: best.score,
      answer:
        best.dtu.core?.answer ||
        best.dtu.human?.summary ||
        best.dtu.title ||
        null,
    };
  }

  function getStats() {
    return { ...stats, stsvkCached: _stsvkCache ? _stsvkCache.length : 0, stsvkLoadedAt: _stsvkLoadedAt };
  }

  return {
    // Phases (exposed for tests and routes):
    analyze,
    retrieve,
    compute,
    synthesize,
    cite,
    validate,
    record,
    // STSVK:
    loadSTSVKTheorems,
    runSTSVKConstraintCheck,
    invalidateSTSVKCache,
    // Deep-question / answer-DTU helpers:
    detectDeepQuestion,
    getAnswerForQuery,
    // Top-level:
    solve,
    getStats,
  };
}

export default createOracleEngine;
