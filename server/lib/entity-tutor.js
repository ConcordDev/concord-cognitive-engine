/**
 * Entity Tutor — Domain AI Mentor
 *
 * Wraps an emergent entity with a teaching protocol. Uses the
 * student's knowledge genome to teach at their level. Socratic
 * method available — asks questions instead of giving answers.
 *
 * Part of the Concord Educational Engine — System 4.
 *
 * Design principles:
 *   - Every claim must cite DTU IDs (anti-hallucination).
 *   - Address gaps BEFORE covering mastered material.
 *   - End every teaching turn with a check question.
 *   - Never throw — fall back to heuristic responses if brains unavailable.
 *   - Socratic mode guides discovery; never states "right" or "wrong".
 */

import logger from "../logger.js";
import { TASK_PROMPTS } from "./prompt-registry.js";

// ── Constants ──────────────────────────────────────────────────────────────

const DEFAULT_LEVEL = "beginner";
const LEVELS = Object.freeze(["beginner", "novice", "intermediate", "advanced", "expert"]);
const MAX_DTU_CONTEXT = 12;
const MAX_GAPS_PER_TURN = 3;
const SESSION_HISTORY_LIMIT = 50;

// System prompts now centralized in prompt-registry.js — single source
// of truth across the codebase. Edit there to change behaviour.
const TEACHING_SYSTEM_PROMPT = TASK_PROMPTS.teachingTutor();
const SOCRATIC_SYSTEM_PROMPT = TASK_PROMPTS.socraticTutor();

// ── Utilities ──────────────────────────────────────────────────────────────

/** Safe numeric clamp. @param {number} n @param {number} lo @param {number} hi */
function clamp(n, lo, hi) {
  if (typeof n !== "number" || !Number.isFinite(n)) return lo;
  return Math.max(lo, Math.min(hi, n));
}

/** Extract DTU IDs referenced in a brain response. @param {string} text */
function extractCitations(text) {
  if (!text || typeof text !== "string") return [];
  const out = new Set();
  const re = /\[(dtu[-_][a-z0-9_-]{4,})\]/gi;
  let m;
  while ((m = re.exec(text)) !== null) out.add(m[1]);
  return Array.from(out);
}

/** Simple word-stem overlap score. @param {string} a @param {string} b */
function textOverlap(a, b) {
  if (!a || !b) return 0;
  const tok = (s) => new Set(
    String(s).toLowerCase().replace(/[^a-z0-9\s]/g, " ").split(/\s+/).filter(Boolean)
  );
  const A = tok(a);
  const B = tok(b);
  if (A.size === 0 || B.size === 0) return 0;
  let hit = 0;
  for (const t of A) if (B.has(t)) hit++;
  return hit / Math.max(A.size, B.size);
}

// ── EntityTutor ────────────────────────────────────────────────────────────

export class EntityTutor {
  /**
   * @param {string} entityId - The emergent entity backing this tutor.
   * @param {string} domain - Subject domain (e.g. "mathematics").
   * @param {object} deps
   * @param {object} [deps.brainService]   - Brain router/service.
   * @param {object} [deps.embeddings]     - Embeddings store.
   * @param {object} [deps.knowledgeGenome]- Knowledge-genome module.
   * @param {object} [deps.dtuStore]       - DTU store.
   */
  constructor(entityId, domain, { brainService, embeddings, knowledgeGenome, dtuStore } = {}) {
    this.entityId = entityId;
    this.domain = String(domain || "general").toLowerCase();
    this.brainService = brainService || null;
    this.embeddings = embeddings || null;
    this.knowledgeGenome = knowledgeGenome || null;
    this.dtuStore = dtuStore || null;
    /** @type {Map<string, { level: string, sessions: object[], lastSeen: number }>} */
    this.studentProfiles = new Map();
    this.stats = {
      created: Date.now(),
      teachCalls: 0,
      socraticCalls: 0,
      brainFallbacks: 0,
      gapsAddressed: 0,
      errors: 0,
    };
  }

  // ── Public: teach ────────────────────────────────────────────────────────

  /**
   * Teach the student in response to a query.
   *
   * @param {string} studentId
   * @param {string} query
   * @returns {Promise<{ ok: boolean, response: string, citations: string[], gapsAddressed: string[], nextRecommendation: ?object, checkQuestion: ?string, fallback?: boolean, error?: string }>}
   */
  async teach(studentId, query) {
    this.stats.teachCalls++;
    try {
      if (!studentId || !query) {
        return this._fallback("missing student or query", [], [], null);
      }

      // 1. Genome
      const genome = await this._safeGetGenome(studentId);
      const profile = this.getStudentProfile(studentId, genome);

      // 2. Relevant DTUs (embedding search)
      const relevantDtus = await this.findStudentContext(genome, query);

      // 3. Gaps
      const gaps = this._identifyGaps(genome, relevantDtus).slice(0, MAX_GAPS_PER_TURN);

      // 4. Build brain request
      const userPrompt = this._buildTeachPrompt(query, profile, relevantDtus, gaps);

      // 5. Call conscious brain
      let brainText = null;
      try {
        brainText = await this._callBrain("conscious", TEACHING_SYSTEM_PROMPT, userPrompt);
      } catch (e) {
        logger?.warn?.("entity_tutor_brain_error", { entityId: this.entityId, err: String(e?.message || e) });
      }

      let fallback = false;
      if (!brainText) {
        fallback = true;
        this.stats.brainFallbacks++;
        brainText = this._heuristicTeachResponse(query, profile, relevantDtus, gaps);
      }

      // 6. Parse output
      const citations = extractCitations(brainText);
      const checkQuestion = this.extractCheckQuestion(brainText);
      const nextRecommendation = this._nextRecommendation(genome, relevantDtus, gaps);

      // 7. Record
      await this.recordSession(studentId, {
        kind: "teach",
        query,
        response: brainText,
        citations,
        gapsAddressed: gaps.map((g) => g.dtuId),
        timestamp: Date.now(),
        fallback,
      });

      this.stats.gapsAddressed += gaps.length;

      return {
        ok: true,
        response: brainText,
        citations,
        gapsAddressed: gaps.map((g) => g.dtuId),
        nextRecommendation,
        checkQuestion,
        fallback,
      };
    } catch (err) {
      this.stats.errors++;
      logger?.error?.("entity_tutor_teach_failed", { entityId: this.entityId, err: String(err?.message || err) });
      return this._fallback(String(err?.message || err), [], [], null);
    }
  }

  // ── Public: socraticChallenge ────────────────────────────────────────────

  /**
   * Generate Socratic questions about a student's claim.
   *
   * @param {string} studentId
   * @param {string} studentClaim
   * @returns {Promise<{ ok: boolean, questions: string[], supportingDTUs: string[], contradictingDTUs: string[], fallback?: boolean, error?: string }>}
   */
  async socraticChallenge(studentId, studentClaim) {
    this.stats.socraticCalls++;
    try {
      if (!studentId || !studentClaim) {
        return { ok: false, questions: [], supportingDTUs: [], contradictingDTUs: [], error: "missing input" };
      }

      // 1 + 2: Supporting and contradicting DTUs via embedding search
      const { supporting, contradicting } = await this._findEvidence(studentClaim);

      // 3. Call conscious brain
      const userPrompt = this._buildSocraticPrompt(studentClaim, supporting, contradicting);
      let brainText = null;
      try {
        brainText = await this._callBrain("conscious", SOCRATIC_SYSTEM_PROMPT, userPrompt);
      } catch (e) {
        logger?.warn?.("entity_tutor_socratic_brain_error", { entityId: this.entityId, err: String(e?.message || e) });
      }

      let fallback = false;
      let questions = [];
      if (brainText) {
        questions = this._parseNumberedList(brainText);
      }
      if (!questions || questions.length === 0) {
        fallback = true;
        this.stats.brainFallbacks++;
        questions = this._heuristicSocraticQuestions(studentClaim, supporting, contradicting);
      }

      const supportingDTUs = supporting.map((d) => d.id);
      const contradictingDTUs = contradicting.map((d) => d.id);

      await this.recordSession(studentId, {
        kind: "socratic",
        claim: studentClaim,
        questions,
        supportingDTUs,
        contradictingDTUs,
        timestamp: Date.now(),
        fallback,
      });

      return { ok: true, questions, supportingDTUs, contradictingDTUs, fallback };
    } catch (err) {
      this.stats.errors++;
      logger?.error?.("entity_tutor_socratic_failed", { entityId: this.entityId, err: String(err?.message || err) });
      return { ok: false, questions: [], supportingDTUs: [], contradictingDTUs: [], error: String(err?.message || err) };
    }
  }

  // ── Profiles ─────────────────────────────────────────────────────────────

  /**
   * Get or derive a student's teaching profile (level, history snapshot).
   * @param {string} studentId
   * @param {object} [genome]
   */
  getStudentProfile(studentId, genome) {
    let prof = this.studentProfiles.get(studentId);
    if (!prof) {
      prof = { level: DEFAULT_LEVEL, sessions: [], lastSeen: 0 };
      this.studentProfiles.set(studentId, prof);
    }
    prof.level = this._inferLevel(genome) || prof.level || DEFAULT_LEVEL;
    prof.lastSeen = Date.now();
    return prof;
  }

  /**
   * Infer coarse difficulty level from the student's genome for this domain.
   * @param {object} genome
   */
  _inferLevel(genome) {
    try {
      if (!genome) return DEFAULT_LEVEL;
      const nodes = genome.nodes || genome.knowledge || {};
      const values = Object.values(nodes).filter((n) => n && typeof n === "object");
      if (values.length === 0) return DEFAULT_LEVEL;
      const domainNodes = values.filter((n) => {
        const tags = n.tags || n.domains || [];
        return Array.isArray(tags) && tags.map((t) => String(t).toLowerCase()).includes(this.domain);
      });
      const pool = domainNodes.length > 0 ? domainNodes : values;
      const avg = pool.reduce((s, n) => s + (Number(n.mastery) || 0), 0) / pool.length;
      if (avg >= 0.85) return "expert";
      if (avg >= 0.65) return "advanced";
      if (avg >= 0.4) return "intermediate";
      if (avg >= 0.15) return "novice";
      return "beginner";
    } catch {
      return DEFAULT_LEVEL;
    }
  }

  // ── Context / DTU search ────────────────────────────────────────────────

  /**
   * Find DTUs relevant to the query in the student's domain.
   * Falls back to keyword overlap if embeddings are unavailable.
   *
   * @param {object} genome
   * @param {string} query
   * @returns {Promise<object[]>}
   */
  async findStudentContext(genome, query) {
    try {
      const all = this._listDomainDtus();
      if (all.length === 0) return [];

      // Try embedding search
      if (this.embeddings && typeof this.embeddings.search === "function") {
        try {
          const hits = await this.embeddings.search(query, { limit: MAX_DTU_CONTEXT, domain: this.domain });
          if (Array.isArray(hits) && hits.length > 0) {
            return hits
              .map((h) => h?.dtu || h)
              .filter(Boolean)
              .slice(0, MAX_DTU_CONTEXT);
          }
        } catch (e) {
          logger?.debug?.("entity_tutor_embedding_search_failed", { err: String(e?.message || e) });
        }
      }

      // Heuristic: rank by keyword overlap against title/summary
      const scored = all.map((d) => {
        const hay = `${d.title || ""} ${d.summary || ""} ${d.description || ""}`;
        return { dtu: d, score: textOverlap(query, hay) };
      });
      scored.sort((a, b) => b.score - a.score);
      return scored.filter((s) => s.score > 0).slice(0, MAX_DTU_CONTEXT).map((s) => s.dtu);
    } catch (err) {
      logger?.warn?.("entity_tutor_context_error", { err: String(err?.message || err) });
      return [];
    }
  }

  /** List DTUs in this tutor's domain via the DTU store. */
  _listDomainDtus() {
    try {
      if (!this.dtuStore) return [];
      if (typeof this.dtuStore.listByDomain === "function") {
        const out = this.dtuStore.listByDomain(this.domain);
        if (Array.isArray(out)) return out;
      }
      if (typeof this.dtuStore.list === "function") {
        const out = this.dtuStore.list({ domain: this.domain });
        if (Array.isArray(out)) return out;
      }
      if (typeof this.dtuStore.values === "function") {
        return Array.from(this.dtuStore.values()).filter((d) => {
          const tags = (d.tags || d.domains || []).map((t) => String(t).toLowerCase());
          return tags.includes(this.domain);
        });
      }
      return [];
    } catch {
      return [];
    }
  }

  /**
   * Identify DTUs in the relevant context that the student hasn't mastered.
   * @param {object} genome
   * @param {object[]} relevantDtus
   */
  _identifyGaps(genome, relevantDtus) {
    const nodes = (genome && (genome.nodes || genome.knowledge)) || {};
    const gaps = [];
    for (const d of relevantDtus) {
      const node = nodes[d.id];
      const mastery = Number(node?.mastery) || 0;
      if (mastery < 0.5) {
        gaps.push({ dtuId: d.id, title: d.title || d.id, mastery });
      }
    }
    gaps.sort((a, b) => a.mastery - b.mastery);
    return gaps;
  }

  // ── Evidence (socratic) ─────────────────────────────────────────────────

  async _findEvidence(claim) {
    const all = this._listDomainDtus();
    const supporting = [];
    const contradicting = [];
    const negRe = /\b(not|no|never|contrary|opposite|disagree|refute)\b/i;
    for (const d of all) {
      const hay = `${d.title || ""} ${d.summary || ""} ${d.description || ""}`;
      const overlap = textOverlap(claim, hay);
      if (overlap <= 0) continue;
      if (negRe.test(d.stance || d.summary || "")) {
        contradicting.push(d);
      } else {
        supporting.push(d);
      }
    }
    return {
      supporting: supporting.slice(0, 6),
      contradicting: contradicting.slice(0, 6),
    };
  }

  // ── Prompt building ─────────────────────────────────────────────────────

  _buildTeachPrompt(query, profile, dtus, gaps) {
    const dtuBlock = dtus.length === 0
      ? "(no DTUs found in context — ask the student to clarify)"
      : dtus.map((d) => `  [${d.id}] ${d.title || "(untitled)"} — ${d.summary || ""}`).join("\n");
    const gapBlock = gaps.length === 0
      ? "(none detected)"
      : gaps.map((g) => `  [${g.dtuId}] ${g.title} (mastery=${g.mastery.toFixed(2)})`).join("\n");
    return `Domain: ${this.domain}
Student level: ${profile.level}

Available evidence DTUs:
${dtuBlock}

Student knowledge gaps to address FIRST:
${gapBlock}

Student query:
${query}

Teach the student. Cite DTU IDs. Address gaps first. End with "CHECK: ..."`;
  }

  _buildSocraticPrompt(claim, supporting, contradicting) {
    const supBlock = supporting.length === 0
      ? "(no supporting evidence found)"
      : supporting.map((d) => `  [${d.id}] ${d.title || ""}`).join("\n");
    const conBlock = contradicting.length === 0
      ? "(no contradicting evidence found)"
      : contradicting.map((d) => `  [${d.id}] ${d.title || ""}`).join("\n");
    return `Domain: ${this.domain}

Student claim:
"${claim}"

Supporting DTUs:
${supBlock}

Contradicting DTUs:
${conBlock}

Generate 3 Socratic questions (numbered 1., 2., 3.) — surface, structure, implication.`;
  }

  // ── Brain calling ───────────────────────────────────────────────────────

  async _callBrain(brain, systemPrompt, userPrompt) {
    if (!this.brainService) return null;
    const fn =
      this.brainService.callBrain ||
      this.brainService.call ||
      this.brainService.infer ||
      this.brainService.generate;
    if (typeof fn !== "function") return null;
    const req = {
      brain,
      system: systemPrompt,
      prompt: userPrompt,
      task: brain === "conscious" ? "reasoning" : "quick_task",
      temperature: 0.6,
    };
    const out = await fn.call(this.brainService, req);
    if (!out) return null;
    if (typeof out === "string") return out;
    return out.text || out.response || out.output || out.content || null;
  }

  // ── Heuristic fallbacks ─────────────────────────────────────────────────

  _heuristicTeachResponse(query, profile, dtus, gaps) {
    const lines = [];
    lines.push(`At the ${profile.level} level, here is what the evidence in ${this.domain} shows about: "${query}".`);
    if (gaps.length > 0) {
      lines.push("");
      lines.push("Let's address your gaps first:");
      for (const g of gaps) {
        lines.push(`  - [${g.dtuId}] ${g.title} — review this concept to build forward.`);
      }
    }
    if (dtus.length > 0) {
      lines.push("");
      lines.push("Relevant evidence:");
      for (const d of dtus.slice(0, 5)) {
        lines.push(`  - [${d.id}] ${d.title || "(untitled)"}`);
      }
    } else {
      lines.push("");
      lines.push("I need more data in this domain to teach fully. Tell me more about what you've tried.");
    }
    lines.push("");
    const checkTarget = (gaps[0] && gaps[0].title) || (dtus[0] && dtus[0].title) || query;
    lines.push(`CHECK: In your own words, how would you describe the key idea behind "${checkTarget}"?`);
    return lines.join("\n");
  }

  _heuristicSocraticQuestions(claim, supporting, contradicting) {
    const sId = supporting[0]?.id || "";
    const cId = contradicting[0]?.id || supporting[1]?.id || "";
    const iId = supporting[2]?.id || contradicting[1]?.id || "";
    const q1 = sId
      ? `1. What observation in [${sId}] would you expect to see if your claim were true?`
      : `1. What observation would you expect to see if your claim were true?`;
    const q2 = cId
      ? `2. How does the evidence in [${cId}] change the structure of your claim, if at all?`
      : `2. What evidence would make you reconsider the structure of your claim?`;
    const q3 = iId
      ? `3. If the claim holds, what does [${iId}] imply for its limits?`
      : `3. If the claim holds, what are its limits — and how would you test them?`;
    return [q1, q2, q3];
  }

  _parseNumberedList(text) {
    if (!text) return [];
    const lines = String(text).split(/\r?\n/).map((l) => l.trim()).filter(Boolean);
    const out = [];
    for (const line of lines) {
      if (/^\d+[.)]\s*/.test(line)) out.push(line);
    }
    return out;
  }

  // ── Utilities ───────────────────────────────────────────────────────────

  extractCheckQuestion(text) {
    if (!text) return null;
    const m = String(text).match(/CHECK:\s*(.+?)(?:\n|$)/i);
    return m ? m[1].trim() : null;
  }

  _nextRecommendation(genome, relevantDtus, gaps) {
    if (gaps.length > 0) {
      return { kind: "address-gap", dtuId: gaps[0].dtuId, title: gaps[0].title };
    }
    const nodes = (genome && (genome.nodes || genome.knowledge)) || {};
    const next = relevantDtus.find((d) => {
      const m = Number(nodes[d.id]?.mastery) || 0;
      return m >= 0.5 && m < 0.85;
    });
    if (next) {
      return { kind: "deepen", dtuId: next.id, title: next.title || next.id };
    }
    const frontier = relevantDtus.find((d) => !nodes[d.id]);
    if (frontier) {
      return { kind: "explore", dtuId: frontier.id, title: frontier.title || frontier.id };
    }
    return null;
  }

  async recordSession(studentId, session) {
    try {
      const prof = this.studentProfiles.get(studentId) || { level: DEFAULT_LEVEL, sessions: [], lastSeen: 0 };
      prof.sessions.push(session);
      if (prof.sessions.length > SESSION_HISTORY_LIMIT) {
        prof.sessions.splice(0, prof.sessions.length - SESSION_HISTORY_LIMIT);
      }
      prof.lastSeen = Date.now();
      this.studentProfiles.set(studentId, prof);

      // Optional: push 'tutored' interaction into genome
      if (this.knowledgeGenome && typeof this.knowledgeGenome.recordInteraction === "function") {
        try {
          const dtuIds = Array.isArray(session.citations) ? session.citations : [];
          for (const dtuId of dtuIds) {
            await this.knowledgeGenome.recordInteraction(studentId, dtuId, {
              kind: "tutored",
              delta: 0.05,
              source: `tutor:${this.entityId}`,
              at: session.timestamp || Date.now(),
            });
          }
        } catch (e) {
          logger?.debug?.("entity_tutor_genome_record_failed", { err: String(e?.message || e) });
        }
      }
    } catch (err) {
      logger?.warn?.("entity_tutor_record_failed", { err: String(err?.message || err) });
    }
  }

  async _safeGetGenome(studentId) {
    try {
      if (!this.knowledgeGenome) return {};
      const fn =
        this.knowledgeGenome.getGenome ||
        this.knowledgeGenome.get ||
        this.knowledgeGenome.load;
      if (typeof fn !== "function") return {};
      const g = await fn.call(this.knowledgeGenome, studentId);
      return g || {};
    } catch {
      return {};
    }
  }

  getTeachingStats() {
    return {
      entityId: this.entityId,
      domain: this.domain,
      ...this.stats,
      studentCount: this.studentProfiles.size,
      uptimeMs: Date.now() - this.stats.created,
    };
  }

  _fallback(errMsg, citations, gapsAddressed, nextRec) {
    return {
      ok: true,
      response:
        "I am unable to access my brain service right now. Please try again shortly, and in the meantime consider reviewing recent DTUs in this domain.",
      citations,
      gapsAddressed,
      nextRecommendation: nextRec,
      checkQuestion: "What question would you most like answered when I return?",
      fallback: true,
      error: errMsg,
    };
  }
}

// ── Factories ──────────────────────────────────────────────────────────────

/**
 * Create a new EntityTutor instance.
 * @param {string} entityId
 * @param {string} domain
 * @param {object} deps
 */
export function createEntityTutor(entityId, domain, deps) {
  return new EntityTutor(entityId, domain, deps || {});
}

// Per-process cache of spawned tutors, keyed by domain.
const _domainTutorCache = new Map();

/**
 * Spawn or retrieve the tutor for a domain. Lazy-imports brainService and
 * knowledge-genome to avoid circular dependencies.
 *
 * @param {string} domain
 * @param {object} [deps]
 * @returns {Promise<EntityTutor>}
 */
export async function getTutorForDomain(domain, deps = {}) {
  const key = String(domain || "general").toLowerCase();
  const existing = _domainTutorCache.get(key);
  if (existing) return existing;

  const resolved = { ...deps };

  if (!resolved.brainService) {
    try {
      const mod = await import("./brain-service.cjs");
      resolved.brainService = mod.default || mod.brainService || mod;
    } catch (e) {
      logger?.debug?.("entity_tutor_brain_import_failed", { err: String(e?.message || e) });
      resolved.brainService = null;
    }
  }

  if (!resolved.knowledgeGenome) {
    try {
      const mod = await import("./knowledge-genome.js");
      resolved.knowledgeGenome = mod.default || mod.knowledgeGenome || mod;
    } catch (e) {
      logger?.debug?.("entity_tutor_genome_import_failed", { err: String(e?.message || e) });
      resolved.knowledgeGenome = null;
    }
  }

  if (!resolved.dtuStore) {
    try {
      const mod = await import("./dtu-store.js");
      resolved.dtuStore = mod.default || mod.dtuStore || mod;
    } catch (e) {
      logger?.debug?.("entity_tutor_dtustore_import_failed", { err: String(e?.message || e) });
      resolved.dtuStore = null;
    }
  }

  const entityId = `tutor-${key}-${Math.random().toString(36).slice(2, 10)}`;
  const tutor = new EntityTutor(entityId, key, resolved);
  _domainTutorCache.set(key, tutor);
  return tutor;
}

/** Exported for tests only. */
export const _internal = {
  LEVELS,
  DEFAULT_LEVEL,
  TEACHING_SYSTEM_PROMPT,
  SOCRATIC_SYSTEM_PROMPT,
  extractCitations,
  textOverlap,
  clamp,
  cacheSize: () => _domainTutorCache.size,
  clearCache: () => _domainTutorCache.clear(),
};

export default EntityTutor;
