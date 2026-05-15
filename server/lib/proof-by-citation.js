/**
 * Proof by Citation — Assignments as DTU Creation
 *
 * No essays. No multiple choice. Student submits a CLAIM and
 * must CITE DTU evidence. The submission is evaluated on:
 *   1. Citation integrity (do the cited DTUs exist and support the claim?)
 *   2. Logical coherence (does claim follow from evidence?)
 *   3. Novelty (is this just restating sources?)
 *   4. Depth (how deep does the citation lineage go?)
 *   5. Chicken2 reality gate pass (no hallucinations)
 *
 * Passing submissions become new DTUs. The student becomes a
 * teacher for everyone who learns from their work.
 *
 * Graceful degradation:
 *   - Brain service / chicken2 gate are dynamically imported and
 *     failures fall back to deterministic heuristic scoring.
 *   - No method throws — everything is wrapped in try/catch.
 *
 * @module proof-by-citation
 */

/**
 * Weights for the final grade calculation. Must sum to 1.0.
 */
import { TASK_PROMPTS } from "./prompt-registry.js";

const GRADE_WEIGHTS = Object.freeze({
  citationIntegrity: 0.25,
  logicalCoherence: 0.30,
  novelty: 0.15,
  depth: 0.10,
  c2Pass: 0.20,
});

const PASS_THRESHOLD = 0.7;
const MAX_DEPTH_SCAN = 6;

/**
 * ProofByCitation — Service class that evaluates student submissions
 * against cited DTU evidence and publishes passing submissions as new
 * DTUs credited to the student.
 */
export class ProofByCitation {
  /**
   * @param {object} deps
   * @param {object} [deps.dtuStore]      - Map-like DTU store with get/set/has/values
   * @param {object} [deps.embeddings]    - optional embeddings service (embed, cosine)
   * @param {object} [deps.brainService]  - optional brain router with query(name, req)
   * @param {object} [deps.chicken2Gate]  - optional gate with validate(subject, opts)
   * @param {object} [deps.economy]       - optional economy hook for royalty payout
   */
  constructor({ dtuStore, embeddings, brainService, chicken2Gate, economy } = {}) {
    this.dtuStore = dtuStore || null;
    this.embeddings = embeddings || null;
    this.brainService = brainService || null;
    this.chicken2Gate = chicken2Gate || null;
    this.economy = economy || null;

    this._brainTried = false;
    this._gateTried = false;
    this._embTried = false;

    this.stats = {
      submissions: 0,
      passed: 0,
      failed: 0,
      published: 0,
      lastGrade: null,
    };
  }

  // ── Lazy dependency resolution ───────────────────────────────────────────

  async _getBrain() {
    if (this.brainService && typeof this.brainService.query === 'function') {
      return this.brainService;
    }
    if (this._brainTried) return null;
    this._brainTried = true;
    try {
      const mod = await import('./brain-service.cjs');
      const BrainService = mod?.default || mod?.BrainService || mod;
      if (typeof BrainService === 'function') {
        this.brainService = new BrainService();
        return this.brainService;
      }
      if (mod && typeof mod.query === 'function') {
        this.brainService = mod;
        return this.brainService;
      }
    } catch (_e) {
      // silent — graceful degrade
    }
    return null;
  }

  async _getGate() {
    if (this.chicken2Gate && typeof this.chicken2Gate.validate === 'function') {
      return this.chicken2Gate;
    }
    if (this._gateTried) return null;
    this._gateTried = true;
    try {
      const mod = await import('./chicken2-gate.js');
      const factory = mod?.createChicken2Gate;
      if (typeof factory === 'function') {
        this.chicken2Gate = factory({ dtuStore: this.dtuStore });
        return this.chicken2Gate;
      }
      const Gate = mod?.default;
      if (typeof Gate === 'function') {
        this.chicken2Gate = new Gate({ dtuStore: this.dtuStore });
        return this.chicken2Gate;
      }
    } catch (_e) {
      // silent — graceful degrade
    }
    return null;
  }

  async _getEmbeddings() {
    if (this.embeddings) return this.embeddings;
    if (this._embTried) return null;
    this._embTried = true;
    try {
      const mod = await import('../embeddings.js');
      this.embeddings = mod?.default || mod;
      return this.embeddings;
    } catch (_e) {
      return null;
    }
  }

  // ── Main pipeline ────────────────────────────────────────────────────────

  /**
   * Evaluate a student submission. Returns an evaluation object
   * with numeric sub-scores, grade, feedback, and — if the grade
   * crosses the pass threshold — the id of a freshly published DTU.
   *
   * @param {string} studentId
   * @param {object} submission - { claim, citations: [dtuId], domain, type, title? }
   * @returns {Promise<object>}
   */
  async evaluateSubmission(studentId, submission) {
    const evaluation = {
      studentId: studentId || null,
      submissionReceivedAt: Date.now(),
      citationIntegrity: 0,
      logicalCoherence: 0,
      novelty: 0,
      depth: 0,
      c2Pass: false,
      grade: null,
      feedback: [],
      published: false,
      dtuId: null,
      errors: [],
    };

    try {
      if (!submission || typeof submission !== 'object') {
        evaluation.feedback.push('Submission must be an object.');
        evaluation.grade = 0;
        this.stats.submissions++;
        this.stats.failed++;
        return evaluation;
      }

      const claim = String(submission.claim || '').trim();
      const citations = Array.isArray(submission.citations)
        ? submission.citations.map(String).filter(Boolean)
        : [];
      const domain = submission.domain || submission.lens || 'general';

      if (!claim) {
        evaluation.feedback.push('Claim is empty.');
        evaluation.grade = 0;
        this.stats.submissions++;
        this.stats.failed++;
        return evaluation;
      }
      if (citations.length === 0) {
        evaluation.feedback.push('At least one citation is required.');
        evaluation.grade = 0;
        this.stats.submissions++;
        this.stats.failed++;
        return evaluation;
      }

      // 1) Citation integrity — which cited DTUs actually exist?
      const integrityResult = await this._safe(() =>
        this.checkCitationIntegrity(citations),
      );
      evaluation.citationIntegrity = integrityResult.score || 0;
      const validCitations = integrityResult.validCitations || [];
      const citedDTUs = integrityResult.citedDTUs || [];
      if (integrityResult.missing && integrityResult.missing.length) {
        evaluation.feedback.push(
          `Missing DTUs: ${integrityResult.missing.slice(0, 5).join(', ')}`,
        );
      }

      // 2) Logical coherence
      const coherence = await this._safe(() =>
        this.checkLogicalCoherence(claim, citedDTUs),
      );
      evaluation.logicalCoherence = coherence.score || 0;
      if (coherence.note) evaluation.feedback.push(coherence.note);

      // 3) Novelty
      const novelty = await this._safe(() =>
        this.checkNovelty(claim, citedDTUs),
      );
      evaluation.novelty = novelty.score || 0;
      if (novelty.note) evaluation.feedback.push(novelty.note);

      // 4) Depth
      const depth = await this._safe(() => this.checkDepth(validCitations));
      evaluation.depth = depth.score || 0;

      // 5) Chicken2 reality gate
      const gate = await this._safe(() =>
        this.runChicken2Gate(claim, citedDTUs, domain),
      );
      evaluation.c2Pass = !!gate.passed;
      if (Array.isArray(gate.reasons) && gate.reasons.length) {
        evaluation.feedback.push(
          `Reality gate: ${gate.reasons.slice(0, 3).join('; ')}`,
        );
      }

      evaluation.grade = this.calculateGrade(evaluation);
      evaluation.feedback.push(...this.generateFeedback(evaluation));

      this.stats.submissions++;
      this.stats.lastGrade = evaluation.grade;
      if (evaluation.grade >= PASS_THRESHOLD) {
        this.stats.passed++;
        // 6) Publish as new DTU
        try {
          const published = await this.publishAsDTU(
            studentId,
            { ...submission, claim, citations: validCitations, domain },
            evaluation,
          );
          if (published && published.dtuId) {
            evaluation.published = true;
            evaluation.dtuId = published.dtuId;
            this.stats.published++;
          }
        } catch (pubErr) {
          evaluation.errors.push(`publish_failed: ${pubErr?.message || pubErr}`);
        }
      } else {
        this.stats.failed++;
      }
    } catch (err) {
      evaluation.errors.push(String(err?.message || err));
      evaluation.grade = evaluation.grade ?? 0;
    }

    return evaluation;
  }

  /** Wrap a check so it never throws. */
  async _safe(fn) {
    try {
      const r = await Promise.resolve(fn());
      return r || {};
    } catch (e) {
      return { error: String(e?.message || e) };
    }
  }

  // ── Individual checks ────────────────────────────────────────────────────

  /**
   * Check that every cited id exists in the DTU store. Computes a
   * fraction-correct score and returns the resolved DTUs.
   *
   * @param {string[]} citations
   * @returns {Promise<{score:number, validCitations:string[], missing:string[], citedDTUs:object[]}>}
   */
  async checkCitationIntegrity(citations) {
    const result = {
      score: 0,
      validCitations: [],
      missing: [],
      citedDTUs: [],
    };
    if (!Array.isArray(citations) || citations.length === 0) return result;

    const store = this.dtuStore;
    for (const id of citations) {
      let dtu = null;
      try {
        if (store && typeof store.get === 'function') {
          dtu = store.get(id);
        } else if (store && typeof store.has === 'function' && store.has(id)) {
          dtu = { id };
        }
      } catch (_e) {
        dtu = null;
      }
      if (dtu) {
        result.validCitations.push(id);
        result.citedDTUs.push(dtu);
      } else {
        result.missing.push(id);
      }
    }

    result.score = citations.length
      ? result.validCitations.length / citations.length
      : 0;
    return result;
  }

  /**
   * Score how well the claim logically follows from the cited DTUs.
   * Uses the conscious brain if available; otherwise falls back to
   * an embedding / lexical overlap heuristic.
   *
   * @param {string} claim
   * @param {object[]} validCitations - resolved DTU objects
   * @returns {Promise<{score:number, note?:string}>}
   */
  async checkLogicalCoherence(claim, validCitations) {
    if (!claim || !Array.isArray(validCitations) || validCitations.length === 0) {
      return { score: 0, note: 'No resolved citations to check coherence against.' };
    }

    // Strategy 1: conscious brain
    const brain = await this._getBrain();
    if (brain && typeof brain.query === 'function') {
      try {
        const summaries = validCitations
          .map((d) => {
            const title = d?.title || d?.human?.summary || d?.id || '';
            const core = d?.core
              ? JSON.stringify(d.core).slice(0, 400)
              : '';
            return `- [${d?.id || '?'}] ${title}\n  ${core}`;
          })
          .join('\n');
        const prompt = TASK_PROMPTS.proofByCitationGrader({ claim, summaries });
        const resp = await brain.query('conscious', {
          prompt,
          taskType: 'evaluation',
        });
        const text = this._brainText(resp);
        const parsed = this._parseJSON(text);
        if (parsed && typeof parsed.score === 'number') {
          return {
            score: Math.max(0, Math.min(1, parsed.score)),
            note: parsed.note || '',
          };
        }
      } catch (_e) {
        // fall through to heuristic
      }
    }

    // Strategy 2: embeddings cosine
    try {
      const emb = await this._getEmbeddings();
      if (emb && typeof emb.embed === 'function' && typeof emb.cosine === 'function') {
        const vec = await emb.embed(claim);
        let best = 0;
        for (const dtu of validCitations) {
          const text = this._dtuText(dtu);
          if (!text) continue;
          const v2 = await emb.embed(text);
          const sim = emb.cosine(vec, v2);
          if (sim > best) best = sim;
        }
        return {
          score: Math.max(0, Math.min(1, best)),
          note: 'Heuristic: embedding similarity with closest citation.',
        };
      }
    } catch (_e) {
      // fall through
    }

    // Strategy 3: lexical overlap
    const claimTokens = this._tokens(claim);
    if (claimTokens.size === 0) {
      return { score: 0, note: 'Claim has no tokens.' };
    }
    let bestOverlap = 0;
    for (const dtu of validCitations) {
      const dtuText = this._dtuText(dtu);
      const dtuTokens = this._tokens(dtuText);
      let shared = 0;
      for (const t of claimTokens) if (dtuTokens.has(t)) shared++;
      const overlap = shared / claimTokens.size;
      if (overlap > bestOverlap) bestOverlap = overlap;
    }
    return {
      score: Math.max(0, Math.min(1, bestOverlap)),
      note: 'Heuristic: lexical overlap with closest citation.',
    };
  }

  /**
   * Score how novel the claim is relative to the cited DTUs. High
   * lexical / semantic overlap → low novelty (restating sources).
   * Moderate overlap → high novelty (synthesis).
   *
   * @param {string} claim
   * @param {object[]} validCitations
   * @returns {Promise<{score:number, note?:string}>}
   */
  async checkNovelty(claim, validCitations) {
    if (!claim || !Array.isArray(validCitations) || validCitations.length === 0) {
      return { score: 0 };
    }

    // Try embeddings-based novelty
    try {
      const emb = await this._getEmbeddings();
      if (emb && typeof emb.embed === 'function' && typeof emb.cosine === 'function') {
        const vec = await emb.embed(claim);
        let maxSim = 0;
        for (const dtu of validCitations) {
          const text = this._dtuText(dtu);
          if (!text) continue;
          const v2 = await emb.embed(text);
          const sim = emb.cosine(vec, v2);
          if (sim > maxSim) maxSim = sim;
        }
        // Penalize pure restatement (sim>0.95) and total unrelatedness (sim<0.1)
        const centered = 1 - Math.abs(maxSim - 0.55) / 0.55;
        return {
          score: Math.max(0, Math.min(1, centered)),
          note: 'Novelty derived from mid-range semantic similarity.',
        };
      }
    } catch (_e) {
      // fall through
    }

    // Lexical heuristic: novel = claim has tokens not present in citations
    const claimTokens = this._tokens(claim);
    if (claimTokens.size === 0) return { score: 0 };
    const citedTokens = new Set();
    for (const dtu of validCitations) {
      for (const t of this._tokens(this._dtuText(dtu))) citedTokens.add(t);
    }
    let novel = 0;
    for (const t of claimTokens) if (!citedTokens.has(t)) novel++;
    const ratio = novel / claimTokens.size;
    // Sweet spot: 0.25..0.75 novel tokens.
    const bell = 1 - Math.abs(ratio - 0.5) * 2;
    return {
      score: Math.max(0, Math.min(1, bell)),
      note: 'Heuristic: fraction of claim tokens not in cited text.',
    };
  }

  /**
   * Walk each citation's provenance chain (via core.sources or
   * machine.lineage) and score the maximum lineage depth reached.
   *
   * @param {string[]} validCitations
   * @returns {Promise<{score:number, maxDepth:number}>}
   */
  async checkDepth(validCitations) {
    if (!Array.isArray(validCitations) || validCitations.length === 0) {
      return { score: 0, maxDepth: 0 };
    }
    const store = this.dtuStore;
    if (!store || typeof store.get !== 'function') {
      return { score: 0.5, maxDepth: 1 };
    }

    const visited = new Set();
    let maxDepth = 0;

    const walk = (id, depth) => {
      if (!id || visited.has(id) || depth > MAX_DEPTH_SCAN) return;
      visited.add(id);
      if (depth > maxDepth) maxDepth = depth;
      let dtu = null;
      try {
        dtu = store.get(id);
      } catch (_e) {
        dtu = null;
      }
      if (!dtu) return;
      const sources =
        (dtu.core && Array.isArray(dtu.core.sources) && dtu.core.sources) ||
        (dtu.machine && Array.isArray(dtu.machine.lineage) && dtu.machine.lineage) ||
        [];
      for (const s of sources) {
        const srcId = typeof s === 'string' ? s : s?.id;
        if (srcId) walk(String(srcId), depth + 1);
      }
    };

    for (const id of validCitations) walk(id, 1);

    // Depth 1 = just the citation itself, 4+ = deep lineage
    const score = Math.min(1, maxDepth / 4);
    return { score, maxDepth };
  }

  /**
   * Invoke the Chicken2 reality gate on the claim, treating the
   * cited DTUs as provenance. Graceful: returns `passed=true` with
   * low confidence when the gate is unavailable.
   *
   * @param {string} claim
   * @param {object[]} citedDTUs
   * @param {string} domain
   * @returns {Promise<{passed:boolean, confidence:number, reasons?:string[]}>}
   */
  async runChicken2Gate(claim, citedDTUs, domain) {
    const gate = await this._getGate();
    if (!gate || typeof gate.validate !== 'function') {
      return { passed: true, confidence: 0.5, reasons: ['gate unavailable'] };
    }
    try {
      const subject = {
        content: claim,
        text: claim,
        domain: domain || 'general',
        citations: (citedDTUs || []).map((d) => d?.id).filter(Boolean),
      };
      const res = await gate.validate(subject, {
        kind: 'student_submission',
        metadata: {
          sources: subject.citations,
          domain: subject.domain,
        },
      });
      return {
        passed: !!res?.passed,
        confidence: Number(res?.confidence ?? 0),
        reasons: Array.isArray(res?.reasons) ? res.reasons : [],
      };
    } catch (e) {
      return { passed: false, confidence: 0, reasons: [String(e?.message || e)] };
    }
  }

  /**
   * Weighted composite grade in [0..1].
   *
   * @param {object} evaluation
   * @returns {number}
   */
  calculateGrade(evaluation) {
    const ci = Number(evaluation.citationIntegrity) || 0;
    const co = Number(evaluation.logicalCoherence) || 0;
    const nv = Number(evaluation.novelty) || 0;
    const dp = Number(evaluation.depth) || 0;
    const c2 = evaluation.c2Pass ? 1 : 0;
    const g =
      GRADE_WEIGHTS.citationIntegrity * ci +
      GRADE_WEIGHTS.logicalCoherence * co +
      GRADE_WEIGHTS.novelty * nv +
      GRADE_WEIGHTS.depth * dp +
      GRADE_WEIGHTS.c2Pass * c2;
    return Math.max(0, Math.min(1, Number(g.toFixed(4))));
  }

  /**
   * Human-friendly feedback derived from the per-check scores.
   *
   * @param {object} evaluation
   * @returns {string[]}
   */
  generateFeedback(evaluation) {
    const out = [];
    if (evaluation.citationIntegrity < 0.8) {
      out.push('Some citations could not be resolved in the DTU substrate.');
    }
    if (evaluation.logicalCoherence < 0.5) {
      out.push('Claim does not appear to follow from the cited evidence.');
    } else if (evaluation.logicalCoherence > 0.85) {
      out.push('Strong logical link between claim and evidence.');
    }
    if (evaluation.novelty < 0.3) {
      out.push('Submission restates sources — add your own synthesis.');
    } else if (evaluation.novelty > 0.85) {
      out.push('Novel synthesis detected.');
    }
    if (evaluation.depth < 0.25) {
      out.push('Citation lineage is shallow — trace back to deeper sources.');
    }
    if (!evaluation.c2Pass) {
      out.push('Failed reality gate — claim may contradict substrate invariants.');
    }
    if (typeof evaluation.grade === 'number') {
      out.push(
        evaluation.grade >= PASS_THRESHOLD
          ? `PASS (${(evaluation.grade * 100).toFixed(1)}%) — published as new DTU.`
          : `REVISE (${(evaluation.grade * 100).toFixed(1)}%) — threshold is ${(PASS_THRESHOLD * 100).toFixed(0)}%.`,
      );
    }
    return out;
  }

  /**
   * Publish a passing submission as a new DTU credited to the
   * student. Best-effort: returns null on any failure.
   *
   * @param {string} studentId
   * @param {object} submission
   * @param {object} evaluation
   * @returns {Promise<{dtuId:string}|null>}
   */
  async publishAsDTU(studentId, submission, evaluation) {
    if (!this.dtuStore || typeof this.dtuStore.set !== 'function') {
      return null;
    }
    const nowISO = new Date().toISOString();
    const id = `dtu_pbc_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
    const dtu = {
      id,
      title: submission.title || `Student claim: ${String(submission.claim).slice(0, 80)}`,
      tier: 'student',
      scope: 'global',
      tags: ['proof_by_citation', `domain:${submission.domain || 'general'}`, `student:${studentId || 'anonymous'}`],
      source: 'proof_by_citation',
      creatorId: studentId || null,
      type: submission.type || 'student_claim',
      human: {
        summary: `Student claim (grade ${(evaluation.grade * 100).toFixed(1)}%)`,
        bullets: [
          `citationIntegrity=${evaluation.citationIntegrity.toFixed(2)}`,
          `coherence=${evaluation.logicalCoherence.toFixed(2)}`,
          `novelty=${evaluation.novelty.toFixed(2)}`,
          `depth=${evaluation.depth.toFixed(2)}`,
          `c2=${evaluation.c2Pass ? 'pass' : 'fail'}`,
        ],
      },
      core: {
        claim: submission.claim,
        sources: Array.isArray(submission.citations) ? submission.citations : [],
        domain: submission.domain || 'general',
        studentId: studentId || null,
      },
      machine: {
        kind: 'student_claim',
        grade: evaluation.grade,
        evaluation: {
          citationIntegrity: evaluation.citationIntegrity,
          logicalCoherence: evaluation.logicalCoherence,
          novelty: evaluation.novelty,
          depth: evaluation.depth,
          c2Pass: evaluation.c2Pass,
        },
      },
      createdAt: nowISO,
      updatedAt: nowISO,
    };
    try {
      this.dtuStore.set(id, dtu);
    } catch (_e) {
      return null;
    }

    // Best-effort royalty / economy hook
    try {
      if (this.economy && typeof this.economy.creditStudent === 'function') {
        await this.economy.creditStudent(studentId, {
          reason: 'proof_by_citation_published',
          dtuId: id,
          grade: evaluation.grade,
        });
      }
    } catch (_e) {
      // swallow
    }

    return { dtuId: id };
  }

  // ── Helpers ──────────────────────────────────────────────────────────────

  _dtuText(dtu) {
    if (!dtu || typeof dtu !== 'object') return '';
    const parts = [];
    if (dtu.title) parts.push(String(dtu.title));
    if (dtu.human?.summary) parts.push(String(dtu.human.summary));
    if (Array.isArray(dtu.human?.bullets)) parts.push(dtu.human.bullets.join(' '));
    if (dtu.core && typeof dtu.core === 'object') {
      try {
        parts.push(JSON.stringify(dtu.core));
      } catch (_e) {
        // noop
      }
    }
    return parts.join(' ').slice(0, 2000);
  }

  _tokens(text) {
    const s = String(text || '').toLowerCase();
    const out = new Set();
    const STOP = new Set([
      'the', 'a', 'an', 'and', 'or', 'but', 'of', 'to', 'in', 'on', 'at',
      'for', 'with', 'is', 'are', 'was', 'were', 'be', 'been', 'being',
      'as', 'by', 'that', 'this', 'it', 'its', 'from', 'if', 'then',
    ]);
    for (const m of s.matchAll(/[a-z0-9]+/g)) {
      const t = m[0];
      if (t.length < 3 || STOP.has(t)) continue;
      out.add(t);
    }
    return out;
  }

  _brainText(resp) {
    if (!resp) return '';
    if (typeof resp === 'string') return resp;
    return String(resp.content ?? resp.text ?? resp.message ?? resp.output ?? '');
  }

  _parseJSON(text) {
    if (!text) return null;
    const s = String(text).trim();
    try { return JSON.parse(s); } catch (_e) { /* fall through */ }
    const fenced = s.match(/```(?:json)?\s*([\s\S]*?)```/i);
    if (fenced && fenced[1]) {
      try { return JSON.parse(fenced[1]); } catch (_e) { /* fall through */ }
    }
    const first = s.indexOf('{');
    const last = s.lastIndexOf('}');
    if (first >= 0 && last > first) {
      try { return JSON.parse(s.slice(first, last + 1)); } catch (_e) { /* fall through */ }
    }
    return null;
  }

  /**
   * @returns {object} Service statistics.
   */
  getStats() {
    return { ...this.stats };
  }
}

/**
 * Factory helper for DI containers.
 *
 * @param {object} deps
 * @returns {ProofByCitation}
 */
export function createProofByCitation(deps) {
  return new ProofByCitation(deps);
}

export const PROOF_BY_CITATION_WEIGHTS = GRADE_WEIGHTS;
export const PROOF_BY_CITATION_PASS_THRESHOLD = PASS_THRESHOLD;

export default ProofByCitation;
