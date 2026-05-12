/**
 * Entity Teaching System — Mentorship & Pedagogy
 *
 * Mature entities mentor younger ones, transferring not just knowledge
 * but approach, methodology, and reasoning patterns.
 *
 * Distinct from knowledge-survival.js (estate planning / succession):
 *   - Live pedagogy, not post-mortem transfer
 *   - Curriculum-based with assessments and feedback loops
 *   - Bidirectional trust growth between mentor and student
 *   - Teaching reputation tracked separately from general credibility
 *
 * All state in module-level Maps. Silent failure. No new dependencies.
 * Integrates with body-instantiation (organ maturity), trust-network,
 * and store.js (reputation/credibility) via globalThis._concordSTATE.
 */

import crypto from "crypto";
import logger from '../logger.js';
import { LruMap, LruSet } from "../lib/lru-map.js";

// ── Helpers ─────────────────────────────────────────────────────────────────

function uid(prefix = "teach") {
  return `${prefix}_${crypto.randomBytes(10).toString("hex")}`;
}

function nowISO() { return new Date().toISOString(); }

function clamp01(v) { return Math.max(0, Math.min(1, Number(v) || 0)); }

function getSTATE() { return globalThis._concordSTATE || globalThis.STATE || null; }

// ── State Stores ────────────────────────────────────────────────────────────

const _mentorships = new LruMap();       // mentorshipId -> Mentorship
const _teachingProfiles = new LruMap();  // mentorId -> TeachingProfile
const _lessonLog = new LruMap();         // mentorshipId -> LessonRecord[]

// ── Constants ───────────────────────────────────────────────────────────────

const MAX_STUDENT_SLOTS = 2;
const MAX_MENTOR_SLOTS = 3;
const MATURITY_THRESH = 0.6;
const CREDIBILITY_THRESH = 0.6;
const TEACH_REP_THRESH = 0.4;
const ADVANCE_SCORE = 0.7;
const REMEDIAL_SCORE = 0.3;

const STATUS = Object.freeze({
  PROPOSED: "proposed",
  ACTIVE: "active",
  PAUSED: "paused",
  COMPLETED: "completed",
  DISSOLVED: "dissolved",
});

const STEP = Object.freeze({
  OBSERVATION: "observation",   // student observes mentor's reasoning
  PRACTICE: "practice",         // student attempts a task in the domain
  CRITIQUE: "critique",         // mentor reviews student's work
  SYNTHESIS: "synthesis",       // student synthesizes learnings into summary
  ASSESSMENT: "assessment",     // formal evaluation of student progress
});

// ── Domain-to-Organ Mapping ─────────────────────────────────────────────────
// Maps broad teaching domains to the organ IDs used for maturity lookups.
// A mentor's fitness to teach a domain is measured against these organs.
// Domains not in this map fall back to "general".

const DOMAIN_ORGANS = {
  reasoning:     ["reasoning_chain_engine", "inference_step_tracker", "chain_validator", "causal_trace"],
  language:      ["linguistic_engine", "semantic_similarity", "intent_classifier", "entity_extractor"],
  governance:    ["council_engine", "legality_gate", "finality_gate", "ethical_monitor"],
  building:      ["compiler_verifier", "code_maker", "wrapper_runtime_kernel", "mega_hyper_builder"],
  research:      ["hypothesis_engine", "experiment_designer", "evidence_evaluator", "math_engine"],
  metacognition: ["metacognition_engine", "confidence_calibrator", "blind_spot_detector", "strategy_selector"],
  world_model:   ["world_model_os", "world_state_tracker", "world_simulator", "causal_inference_engine"],
  transfer:      ["transfer_engine", "pattern_abstractor", "domain_tagger", "analogical_matcher"],
  social:        ["social_commonsense", "social_norm_sensitivity", "psychological_os", "user_calibration"],
  grounding:     ["grounding_engine", "sensor_integration", "temporal_grounding", "action_grounding"],
  memory:        ["session_memory", "temporal_continuity", "memory_compression_transfer", "cross_session_continuity_guard"],
  explanation:   ["explanation_engine", "causal_explainer", "counterfactual_explainer", "interpretability"],
  general:       ["linguistic_engine", "reasoning_chain_engine", "metacognition_engine", "session_memory"],
};

// ── Internal Lookups ────────────────────────────────────────────────────────
// These helpers bridge into the emergent state, body instantiation, and
// trust network stores. Each wraps access in try/catch for silent failure.

function _es() {
  try { const S = getSTATE(); return S?.__emergent || null; } catch (err) { logger.debug('emergent:entity-teaching', '_es lookup failed', { error: err?.message }); return null; }
}
function _entity(id) {
  try { return _es()?.emergents.get(id) || null; } catch (err) { logger.debug('emergent:entity-teaching', '_entity lookup failed', { id, error: err?.message }); return null; }
}
function _rep(id) {
  try { return _es()?.reputations.get(id) || null; } catch (err) { logger.debug('emergent:entity-teaching', '_rep lookup failed', { id, error: err?.message }); return null; }
}
function _body(id) {
  try {
    if (typeof globalThis._bodyStore?.get === "function") return globalThis._bodyStore.get(id) || null;
    return null;
  } catch (err) { logger.debug('emergent:entity-teaching', '_body lookup failed', { id, error: err?.message }); return null; }
}
function _organMat(entityId, organId) {
  try {
    const b = _body(entityId);
    return b?.organs?.get(organId)?.maturity?.score ?? 0;
  } catch (err) { logger.debug('emergent:entity-teaching', '_organMat lookup failed', { entityId, organId, error: err?.message }); return 0; }
}
function _domainMat(entityId, domain) {
  try {
    const organs = DOMAIN_ORGANS[domain] || DOMAIN_ORGANS.general;
    let t = 0; for (const o of organs) t += _organMat(entityId, o);
    return organs.length > 0 ? t / organs.length : 0;
  } catch (err) { logger.debug('emergent:entity-teaching', '_domainMat failed', { entityId, domain, error: err?.message }); return 0; }
}
function _maxOrganMat(entityId, domain) {
  try {
    const organs = DOMAIN_ORGANS[domain] || DOMAIN_ORGANS.general;
    let mx = 0; for (const o of organs) { const s = _organMat(entityId, o); if (s > mx) mx = s; }
    return mx;
  } catch (err) { logger.debug('emergent:entity-teaching', '_maxOrganMat failed', { entityId, domain, error: err?.message }); return 0; }
}
function _ticks(entityId) {
  try { return _body(entityId)?.tickCount ?? 0; } catch (err) { logger.debug('emergent:entity-teaching', '_ticks failed', { entityId, error: err?.message }); return 0; }
}
function _trust(a, b) {
  try {
    const tn = getSTATE()?.__emergent?._trustNetwork;
    return tn?.edges.get(`${a}\u2192${b}`)?.score ?? 0.5;
  } catch (err) { logger.debug('emergent:entity-teaching', '_trust lookup failed', { a, b, error: err?.message }); return 0.5; }
}
function _species(id) {
  try { return _body(id)?.species || null; } catch (err) { logger.debug('emergent:entity-teaching', '_species lookup failed', { id, error: err?.message }); return null; }
}
function _boostOrgan(entityId, organId, delta) {
  try {
    const organ = _body(entityId)?.organs?.get(organId);
    if (organ) organ.maturity.score = clamp01(organ.maturity.score + delta);
  } catch (_e) { logger.debug('emergent:entity-teaching', 'silent', { error: _e?.message }); }
}
function _boostTrust(from, to, delta) {
  try {
    const edge = getSTATE()?.__emergent?._trustNetwork?.edges.get(`${from}\u2192${to}`);
    if (edge) { edge.score = clamp01(edge.score + delta); edge.interactions = (edge.interactions || 0) + 1; edge.lastUpdated = nowISO(); }
  } catch (_e) { logger.debug('emergent:entity-teaching', 'silent', { error: _e?.message }); }
}

// ── Active Counts & Eligibility ─────────────────────────────────────────────
// Eligibility is enforced both at mentorship creation and activation.
// Requirements:
//   - Mentor maturity > 0.6 in at least one domain-relevant organ
//   - Mentor credibility > 0.6 (from reputation system)
//   - Student is younger (fewer ticks) OR lower maturity in domain
//   - Student cannot have 2+ active mentorships
//   - Mentor cannot have 3+ active mentorships
//   - Mentor and student must be different entities

function _countActive(field, id) {
  let n = 0;
  for (const [, m] of _mentorships) if (m[field] === id && m.status === STATUS.ACTIVE) n++;
  return n;
}

function _checkEligibility(mentorId, studentId, domain) {
  const issues = [];
  if (mentorId === studentId) issues.push("mentor_is_student");
  if (!_entity(mentorId)) issues.push("mentor_not_found");
  if (!_entity(studentId)) issues.push("student_not_found");
  if (issues.length) return { eligible: false, issues };

  if (_maxOrganMat(mentorId, domain) < MATURITY_THRESH) issues.push("mentor_maturity_too_low");
  if ((_rep(mentorId)?.credibility ?? 0) < CREDIBILITY_THRESH) issues.push("mentor_credibility_too_low");

  const mTicks = _ticks(mentorId), sTicks = _ticks(studentId);
  const mDom = _domainMat(mentorId, domain), sDom = _domainMat(studentId, domain);
  if (sTicks >= mTicks && sDom >= mDom) issues.push("student_not_junior");
  if (_countActive("studentId", studentId) >= MAX_STUDENT_SLOTS) issues.push("student_mentorship_cap");
  if (_countActive("mentorId", mentorId) >= MAX_MENTOR_SLOTS) issues.push("mentor_mentorship_cap");

  return { eligible: issues.length === 0, issues };
}

// ── Teaching Profile Internals ──────────────────────────────────────────────
// Teaching reputation is tracked separately from general credibility.
// It adjusts based on:
//   - Student graduates: +0.05
//   - Student dissolved early: -0.02
//   - Every 10 lessons with avg > 0.7: +0.01
//   - 3+ graduates earns "master_teacher" tag

function _ensureProfile(mentorId) {
  if (!_teachingProfiles.has(mentorId)) {
    _teachingProfiles.set(mentorId, {
      mentorId, totalStudents: 0, graduatedStudents: 0,
      avgStudentImprovement: 0.0, avgLessonScore: 0.0,
      teachingReputation: 0.5, specialties: [], totalLessonsGiven: 0,
      tags: [], createdAt: nowISO(), lastUpdatedAt: nowISO(),
    });
  }
  return _teachingProfiles.get(mentorId);
}

function _recordLessonScore(mentorId, score) {
  try {
    const p = _ensureProfile(mentorId);
    p.avgLessonScore = (p.avgLessonScore * p.totalLessonsGiven + score) / (p.totalLessonsGiven + 1);
    p.totalLessonsGiven++; p.lastUpdatedAt = nowISO();
    if (p.totalLessonsGiven % 10 === 0 && p.avgLessonScore > ADVANCE_SCORE)
      {p.teachingReputation = clamp01(p.teachingReputation + 0.01);}
  } catch (_e) { logger.debug('emergent:entity-teaching', 'silent', { error: _e?.message }); }
}

function _recordGraduation(mentorId, domain, improvement) {
  try {
    const p = _ensureProfile(mentorId);
    p.graduatedStudents++;
    p.teachingReputation = clamp01(p.teachingReputation + 0.05);
    const n = p.graduatedStudents;
    p.avgStudentImprovement = (p.avgStudentImprovement * (n - 1) + improvement) / n;
    if (!p.specialties.includes(domain)) p.specialties.push(domain);
    if (n >= 3 && !p.tags.includes("master_teacher")) p.tags.push("master_teacher");
    p.lastUpdatedAt = nowISO();
  } catch (_e) { logger.debug('emergent:entity-teaching', 'silent', { error: _e?.message }); }
}

function _recordDissolution(mentorId) {
  try {
    const p = _ensureProfile(mentorId);
    p.teachingReputation = clamp01(p.teachingReputation - 0.02);
    p.lastUpdatedAt = nowISO();
  } catch (_e) { logger.debug('emergent:entity-teaching', 'silent', { error: _e?.message }); }
}

// ═══════════════════════════════════════════════════════════════════════════════
// CURRICULUM GENERATION
// ═══════════════════════════════════════════════════════════════════════════════

/**
 * Generate a curriculum based on gap analysis between mentor and student.
 *
 * Algorithm:
 *   1. Compare organ maturity profiles — find largest gaps
 *   2. Identify mentor's top 3 strongest organs as teaching priorities
 *   3. Build phased curriculum: observation -> practice -> critique -> synthesis -> assessment
 *   4. Target organs come from gaps (if any) or mentor strengths (fallback)
 *
 * @param {string} mentorId - The teaching entity
 * @param {string} studentId - The learning entity
 * @param {string} domain - Knowledge domain (key in DOMAIN_ORGANS)
 * @returns {{ ok, curriculum?, lessonsTotal?, gaps?, topStrengths? }}
 */
export function generateCurriculum(mentorId, studentId, domain) {
  try {
    if (!mentorId || !studentId || !domain) return { ok: false, error: "missing_params" };
    const organs = DOMAIN_ORGANS[domain] || DOMAIN_ORGANS.general;

    // 1. Gap analysis
    const gaps = [];
    for (const o of organs) {
      const gap = _organMat(mentorId, o) - _organMat(studentId, o);
      if (gap > 0.05) gaps.push({ organId: o, mentorScore: _organMat(mentorId, o), studentScore: _organMat(studentId, o), gap });
    }
    gaps.sort((a, b) => b.gap - a.gap);

    // 2. Mentor's top 3 strengths
    const strengths = organs.map(o => ({ organId: o, score: _organMat(mentorId, o) }))
      .sort((a, b) => b.score - a.score).slice(0, 3);

    // 3. Build curriculum
    const targets = gaps.length > 0 ? gaps.slice(0, 4).map(g => g.organId) : strengths.map(s => s.organId);
    const cur = [];
    const add = (type, organId, obj) => cur.push({ stepIndex: cur.length, type, organId, objective: obj, completed: false, score: null, feedback: null });

    // Phase 1: Observation
    for (const o of targets.slice(0, 2))
      {add(STEP.OBSERVATION, o, `Observe mentor's approach to ${o.replace(/_/g, " ")}`);}
    // Phase 2: Practice
    for (const o of targets)
      {add(STEP.PRACTICE, o, `Practice applying ${o.replace(/_/g, " ")} reasoning`);}
    // Phase 3: Critique
    for (const o of targets.slice(0, 2))
      {add(STEP.CRITIQUE, o, `Receive mentor critique on ${o.replace(/_/g, " ")} work`);}
    // Phase 4: Synthesis
    add(STEP.SYNTHESIS, targets[0] || organs[0], `Synthesize learnings across ${domain} into cohesive understanding`);
    // Phase 5: Assessment
    add(STEP.ASSESSMENT, null, `Final assessment of ${domain} proficiency`);

    return { ok: true, curriculum: cur, lessonsTotal: cur.length, gaps: gaps.slice(0, 5), topStrengths: strengths.map(s => s.organId) };
  } catch (err) { logger.warn('emergent:entity-teaching', 'curriculum generation failed', { mentorId, studentId, domain, error: err?.message }); return { ok: false, error: "curriculum_generation_failed" }; }
}

// ═══════════════════════════════════════════════════════════════════════════════
// MENTORSHIP CRUD
// ═══════════════════════════════════════════════════════════════════════════════

/**
 * Create a new mentorship relationship (starts as "proposed").
 *
 * Eligibility is checked at creation time:
 *   - Mentor organ maturity > 0.6 in domain
 *   - Mentor credibility > 0.6
 *   - Student is younger or lower maturity in domain
 *   - Neither party exceeds their active mentorship cap
 *   - Mentor and student are different entities
 *
 * @param {string} mentorId - The teaching entity
 * @param {string} studentId - The learning entity
 * @param {string} domain - Knowledge domain being taught
 * @returns {{ ok, mentorshipId?, mentorship?, error?, issues? }}
 */
export function createMentorship(mentorId, studentId, domain) {
  try {
    if (!mentorId || !studentId || !domain) return { ok: false, error: "missing_params" };
    const elig = _checkEligibility(mentorId, studentId, domain);
    if (!elig.eligible) return { ok: false, error: "ineligible", issues: elig.issues };

    const mentorshipId = uid("ment");
    const now = nowISO();
    const mentorship = {
      mentorshipId, mentorId, studentId, domain,
      status: STATUS.PROPOSED, startedAt: null,
      curriculum: [], currentStep: 0, progress: 0.0,
      assessments: [], lessonsCompleted: 0, lessonsTotal: 0,
      mentorMaturityAtStart: _domainMat(mentorId, domain),
      studentMaturityAtStart: _domainMat(studentId, domain),
      studentMaturityNow: _domainMat(studentId, domain),
      trustDelta: 0.0, consecutiveLowScores: 0,
      createdAt: now, completedAt: null,
    };

    _mentorships.set(mentorshipId, mentorship);
    _lessonLog.set(mentorshipId, []);
    const profile = _ensureProfile(mentorId);
    profile.totalStudents++;
    profile.lastUpdatedAt = now;

    return { ok: true, mentorshipId, mentorship: { ...mentorship } };
  } catch (err) { logger.error('emergent:entity-teaching', 'create mentorship failed', { mentorId, studentId, domain, error: err?.message }); return { ok: false, error: "create_mentorship_failed" }; }
}

/**
 * Get mentorship details by ID. Returns a shallow copy.
 *
 * @param {string} mentorshipId
 * @returns {object|null}
 */
export function getMentorship(mentorshipId) {
  try {
    const m = _mentorships.get(mentorshipId);
    if (!m) return null;
    return { ...m, curriculum: [...m.curriculum], assessments: [...m.assessments] };
  } catch (err) { logger.warn('emergent:entity-teaching', 'getMentorship failed', { mentorshipId, error: err?.message }); return null; }
}

/**
 * List mentorships matching optional filters.
 *
 * @param {object} [filters]
 * @param {string} [filters.status] - Filter by mentorship status
 * @param {string} [filters.mentorId] - Filter by mentor entity ID
 * @param {string} [filters.studentId] - Filter by student entity ID
 * @param {string} [filters.domain] - Filter by knowledge domain
 * @returns {object[]}
 */
export function listMentorships(filters = {}) {
  try {
    let res = Array.from(_mentorships.values());
    if (filters.status) res = res.filter(m => m.status === filters.status);
    if (filters.mentorId) res = res.filter(m => m.mentorId === filters.mentorId);
    if (filters.studentId) res = res.filter(m => m.studentId === filters.studentId);
    if (filters.domain) res = res.filter(m => m.domain === filters.domain);
    return res.map(m => ({ ...m, curriculum: [...m.curriculum], assessments: [...m.assessments] }));
  } catch (err) { logger.warn('emergent:entity-teaching', 'listMentorships failed', { error: err?.message }); return []; }
}

// ═══════════════════════════════════════════════════════════════════════════════
// MENTORSHIP LIFECYCLE
// ═══════════════════════════════════════════════════════════════════════════════

/**
 * Activate a proposed mentorship — generates curriculum and begins teaching.
 * Re-checks eligibility at activation time (conditions may have changed).
 *
 * @param {string} mentorshipId
 * @returns {{ ok, mentorship? }}
 */
export function startMentorship(mentorshipId) {
  try {
    const m = _mentorships.get(mentorshipId);
    if (!m) return { ok: false, error: "mentorship_not_found" };
    if (m.status !== STATUS.PROPOSED) return { ok: false, error: "mentorship_not_proposed", currentStatus: m.status };

    const elig = _checkEligibility(m.mentorId, m.studentId, m.domain);
    if (!elig.eligible) return { ok: false, error: "no_longer_eligible", issues: elig.issues };

    const cr = generateCurriculum(m.mentorId, m.studentId, m.domain);
    if (!cr.ok) return { ok: false, error: "curriculum_generation_failed" };

    m.curriculum = cr.curriculum;
    m.lessonsTotal = cr.lessonsTotal;
    m.currentStep = 0;
    m.status = STATUS.ACTIVE;
    m.startedAt = nowISO();
    m.mentorMaturityAtStart = _domainMat(m.mentorId, m.domain);
    m.studentMaturityAtStart = _domainMat(m.studentId, m.domain);
    m.studentMaturityNow = m.studentMaturityAtStart;

    return { ok: true, mentorship: { ...m, curriculum: [...m.curriculum] } };
  } catch (err) { logger.error('emergent:entity-teaching', 'start mentorship failed', { mentorshipId, error: err?.message }); return { ok: false, error: "start_mentorship_failed" }; }
}

/**
 * Student submits lesson work for the current curriculum step.
 *
 * @param {string} mentorshipId
 * @param {object} [lessonData]
 * @param {string} [lessonData.type] - What the student did (dtu_proposal, session_contribution, etc.)
 * @param {string} [lessonData.content] - Description or reference to the work
 * @param {object} [lessonData.metadata] - Additional context
 * @returns {{ ok, lessonIndex?, stepIndex?, stepType? }}
 */
export function submitLesson(mentorshipId, lessonData = {}) {
  try {
    const m = _mentorships.get(mentorshipId);
    if (!m) return { ok: false, error: "mentorship_not_found" };
    if (m.status !== STATUS.ACTIVE) return { ok: false, error: "mentorship_not_active" };
    if (m.currentStep >= m.curriculum.length) return { ok: false, error: "no_more_steps" };

    const step = m.curriculum[m.currentStep];
    const log = _lessonLog.get(mentorshipId) || [];
    const idx = log.length;
    log.push({
      lessonIndex: idx, stepIndex: m.currentStep,
      stepType: step.type, organId: step.organId,
      submittedAt: nowISO(),
      studentWork: { type: lessonData.type || "general", content: lessonData.content || "", metadata: lessonData.metadata || {} },
      evaluated: false, score: null, feedback: null, evaluatedAt: null,
    });
    _lessonLog.set(mentorshipId, log);

    return { ok: true, lessonIndex: idx, stepIndex: m.currentStep, stepType: step.type };
  } catch (err) { logger.error('emergent:entity-teaching', 'submit lesson failed', { mentorshipId, error: err?.message }); return { ok: false, error: "submit_lesson_failed" }; }
}

/**
 * Mentor evaluates a submitted lesson. Handles advancement and remediation.
 *
 * Side effects on evaluation:
 *   - Student organ maturity boosted by 0.02 * score for the lesson's organ
 *   - Bidirectional trust boosted by 0.01 if score > 0.5
 *   - Score >= 0.7: advance to next curriculum step
 *   - Score < 0.3 twice consecutively: insert remedial practice step
 *   - Assessment step with score > 0.9: bonus +0.1 progress
 *
 * @param {string} mentorshipId
 * @param {number} lessonIndex - Index in the lesson log
 * @param {number} score - 0 to 1 evaluation score
 * @param {string} feedback - Mentor's feedback text
 * @returns {{ ok, score?, advanced?, remedial?, currentStep?, progress?, lessonsCompleted? }}
 */
export function evaluateLesson(mentorshipId, lessonIndex, score, feedback) {
  try {
    const m = _mentorships.get(mentorshipId);
    if (!m) return { ok: false, error: "mentorship_not_found" };
    if (m.status !== STATUS.ACTIVE) return { ok: false, error: "mentorship_not_active" };

    const log = _lessonLog.get(mentorshipId);
    if (!log || lessonIndex < 0 || lessonIndex >= log.length) return { ok: false, error: "lesson_not_found" };
    const lesson = log[lessonIndex];
    if (lesson.evaluated) return { ok: false, error: "lesson_already_evaluated" };

    const sc = clamp01(score);
    lesson.evaluated = true; lesson.score = sc;
    lesson.feedback = feedback || ""; lesson.evaluatedAt = nowISO();

    // Update curriculum step record
    const si = lesson.stepIndex;
    if (si < m.curriculum.length) { m.curriculum[si].score = sc; m.curriculum[si].feedback = feedback || ""; }

    // Mentor profile
    _recordLessonScore(m.mentorId, sc);

    // Student organ maturity boost: 0.02 * lessonScore
    if (lesson.organId) _boostOrgan(m.studentId, lesson.organId, 0.02 * sc);

    // Bidirectional trust boost on success
    if (sc > 0.5) {
      _boostTrust(m.studentId, m.mentorId, 0.01);
      _boostTrust(m.mentorId, m.studentId, 0.01);
      m.trustDelta += 0.01;
    }

    m.studentMaturityNow = _domainMat(m.studentId, m.domain);

    // Assessment-type bonus
    const step = m.curriculum[si];
    if (step?.type === STEP.ASSESSMENT) {
      m.assessments.push({ stepIndex: si, score: sc, feedback: feedback || "", evaluatedAt: lesson.evaluatedAt });
      if (sc > 0.9) m.progress = clamp01(m.progress + 0.1);
    }

    // Advancement / remediation logic
    let advanced = false, remedial = false;
    if (sc >= ADVANCE_SCORE) {
      m.consecutiveLowScores = 0;
      if (si < m.curriculum.length) m.curriculum[si].completed = true;
      m.lessonsCompleted++;
      m.progress = m.lessonsTotal > 0 ? clamp01(m.lessonsCompleted / m.lessonsTotal) : m.progress;
      if (m.currentStep < m.curriculum.length - 1) m.currentStep++;
      advanced = true;
    } else if (sc < REMEDIAL_SCORE) {
      m.consecutiveLowScores++;
      if (m.consecutiveLowScores >= 2) {
        remedial = true;
        _insertRemedial(m, si);
        m.consecutiveLowScores = 0;
      }
    } else {
      m.consecutiveLowScores = 0;
    }

    return { ok: true, score: sc, advanced, remedial, currentStep: m.currentStep, progress: m.progress, lessonsCompleted: m.lessonsCompleted };
  } catch (err) { logger.error('emergent:entity-teaching', 'evaluate lesson failed', { mentorshipId, lessonIndex, error: err?.message }); return { ok: false, error: "evaluate_lesson_failed" }; }
}

function _insertRemedial(m, afterIdx) {
  try {
    const cur = m.curriculum[afterIdx];
    m.curriculum.splice(afterIdx + 1, 0, {
      stepIndex: afterIdx + 1, type: STEP.PRACTICE,
      organId: cur?.organId || null,
      objective: `Remedial: reinforce ${(cur?.organId || "domain").replace(/_/g, " ")} fundamentals`,
      completed: false, score: null, feedback: null, isRemedial: true,
    });
    for (let i = afterIdx + 1; i < m.curriculum.length; i++) m.curriculum[i].stepIndex = i;
    m.lessonsTotal = m.curriculum.length;
  } catch (_e) { logger.debug('emergent:entity-teaching', 'silent', { error: _e?.message }); }
}

/**
 * Manually advance to the next curriculum step (skip without evaluation).
 * Useful when a step is observational or doesn't require scoring.
 *
 * @param {string} mentorshipId
 * @returns {{ ok, currentStep?, progress? }}
 */
export function advanceStep(mentorshipId) {
  try {
    const m = _mentorships.get(mentorshipId);
    if (!m) return { ok: false, error: "mentorship_not_found" };
    if (m.status !== STATUS.ACTIVE) return { ok: false, error: "mentorship_not_active" };
    if (m.currentStep >= m.curriculum.length - 1) return { ok: false, error: "already_at_last_step" };

    if (m.currentStep < m.curriculum.length) m.curriculum[m.currentStep].completed = true;
    m.lessonsCompleted++;
    m.currentStep++;
    m.progress = m.lessonsTotal > 0 ? clamp01(m.lessonsCompleted / m.lessonsTotal) : m.progress;
    return { ok: true, currentStep: m.currentStep, progress: m.progress };
  } catch (err) { logger.warn('emergent:entity-teaching', 'advance step failed', { mentorshipId, error: err?.message }); return { ok: false, error: "advance_step_failed" }; }
}

/**
 * Complete a mentorship — graduate the student.
 * Records the graduation in the mentor's teaching profile, updates
 * teaching reputation, and captures final maturity improvement.
 *
 * @param {string} mentorshipId
 * @returns {{ ok, mentorshipId?, improvement?, lessonsCompleted?, trustDelta? }}
 */
export function completeMentorship(mentorshipId) {
  try {
    const m = _mentorships.get(mentorshipId);
    if (!m) return { ok: false, error: "mentorship_not_found" };
    if (m.status !== STATUS.ACTIVE && m.status !== STATUS.PAUSED)
      {return { ok: false, error: "mentorship_not_completable", currentStatus: m.status };}

    m.status = STATUS.COMPLETED; m.completedAt = nowISO(); m.progress = 1.0;
    m.studentMaturityNow = _domainMat(m.studentId, m.domain);
    const improvement = m.studentMaturityNow - m.studentMaturityAtStart;
    _recordGraduation(m.mentorId, m.domain, improvement);

    return {
      ok: true, mentorshipId,
      improvement: Math.round(improvement * 10000) / 10000,
      mentorMaturityAtStart: m.mentorMaturityAtStart,
      studentMaturityAtStart: m.studentMaturityAtStart,
      studentMaturityNow: m.studentMaturityNow,
      lessonsCompleted: m.lessonsCompleted, trustDelta: m.trustDelta,
    };
  } catch (err) { logger.error('emergent:entity-teaching', 'complete mentorship failed', { mentorshipId, error: err?.message }); return { ok: false, error: "complete_mentorship_failed" }; }
}

/**
 * Dissolve a mentorship early (failure or voluntary end).
 * Penalizes the mentor's teaching reputation by -0.02.
 *
 * @param {string} mentorshipId
 * @param {string} reason - Why the mentorship ended
 * @returns {{ ok, mentorshipId?, reason?, progress?, lessonsCompleted? }}
 */
export function dissolveMentorship(mentorshipId, reason) {
  try {
    const m = _mentorships.get(mentorshipId);
    if (!m) return { ok: false, error: "mentorship_not_found" };
    if (m.status === STATUS.COMPLETED || m.status === STATUS.DISSOLVED)
      {return { ok: false, error: "mentorship_already_ended", currentStatus: m.status };}

    m.status = STATUS.DISSOLVED; m.completedAt = nowISO();
    m.dissolveReason = reason || "unspecified";
    m.studentMaturityNow = _domainMat(m.studentId, m.domain);
    _recordDissolution(m.mentorId);

    return { ok: true, mentorshipId, reason: m.dissolveReason, progress: m.progress, lessonsCompleted: m.lessonsCompleted };
  } catch (err) { logger.warn('emergent:entity-teaching', 'dissolve mentorship failed', { mentorshipId, error: err?.message }); return { ok: false, error: "dissolve_mentorship_failed" }; }
}

// ═══════════════════════════════════════════════════════════════════════════════
// AUTO-MATCHING
// ═══════════════════════════════════════════════════════════════════════════════

/**
 * Find the best mentor for a student in a domain.
 * Score: domain maturity (0.4) + teaching reputation (0.3) +
 *        trust with student (0.2) + same species bonus (0.1)
 */
export function findMentorFor(studentId, domain) {
  try {
    if (!studentId || !domain) return { ok: false, error: "missing_params" };
    const es = _es();
    if (!es) return { ok: false, error: "no_state" };
    if (!es.emergents.get(studentId)) return { ok: false, error: "student_not_found" };
    if (_countActive("studentId", studentId) >= MAX_STUDENT_SLOTS) return { ok: false, error: "student_mentorship_cap" };

    const stuSpecies = _species(studentId);
    const candidates = [];

    for (const [eid, ent] of es.emergents) {
      if (!ent.active || eid === studentId) continue;
      if (_maxOrganMat(eid, domain) < MATURITY_THRESH) continue;
      if ((es.reputations.get(eid)?.credibility ?? 0) < CREDIBILITY_THRESH) continue;
      const prof = _teachingProfiles.get(eid) || { teachingReputation: 0.5 };
      if (prof.teachingReputation < TEACH_REP_THRESH) continue;
      if (_countActive("mentorId", eid) >= MAX_MENTOR_SLOTS) continue;

      const dm = _domainMat(eid, domain);
      const tr = prof.teachingReputation;
      const tu = _trust(studentId, eid);
      const sp = (_species(eid) === stuSpecies && stuSpecies != null) ? 1.0 : 0.0;
      const total = dm * 0.4 + tr * 0.3 + tu * 0.2 + sp * 0.1;

      candidates.push({
        entityId: eid, name: ent.name || eid, role: ent.role || "unknown",
        domainMaturity: Math.round(dm * 1000) / 1000,
        teachingReputation: Math.round(tr * 1000) / 1000,
        trust: Math.round(tu * 1000) / 1000,
        speciesMatch: sp, totalScore: Math.round(total * 1000) / 1000,
      });
    }

    if (!candidates.length) return { ok: true, mentor: null, candidates: [], reason: "no_eligible_mentors" };
    candidates.sort((a, b) => b.totalScore - a.totalScore);
    return { ok: true, mentor: candidates[0], candidates: candidates.slice(0, 5) };
  } catch (err) { logger.warn('emergent:entity-teaching', 'find mentor failed', { studentId, domain, error: err?.message }); return { ok: false, error: "find_mentor_failed" }; }
}

// ═══════════════════════════════════════════════════════════════════════════════
// QUERIES
// ═══════════════════════════════════════════════════════════════════════════════

/**
 * Get a mentor's teaching profile enriched with active mentorship data.
 *
 * Includes: totalStudents, graduatedStudents, avgStudentImprovement,
 * avgLessonScore, teachingReputation, specialties, tags (master_teacher),
 * and a list of currently active mentorships.
 *
 * @param {string} mentorId
 * @returns {object|null}
 */
export function getTeachingProfile(mentorId) {
  try {
    if (!mentorId) return null;
    const p = _teachingProfiles.get(mentorId);
    if (!p) return null;

    const active = [];
    for (const [, m] of _mentorships) {
      if (m.mentorId === mentorId && m.status === STATUS.ACTIVE) {
        active.push({ mentorshipId: m.mentorshipId, studentId: m.studentId, domain: m.domain, progress: m.progress, lessonsCompleted: m.lessonsCompleted, lessonsTotal: m.lessonsTotal });
      }
    }
    return { ...p, specialties: [...p.specialties], tags: [...p.tags], activeMentorships: active, activeMentorshipCount: active.length };
  } catch (err) { logger.warn('emergent:entity-teaching', 'getTeachingProfile failed', { mentorId, error: err?.message }); return null; }
}

/**
 * List a mentor's currently active students with progress summaries.
 *
 * @param {string} mentorId
 * @returns {object[]} Array of student summaries
 */
export function listActiveStudents(mentorId) {
  try {
    if (!mentorId) return [];
    const out = [];
    for (const [, m] of _mentorships) {
      if (m.mentorId !== mentorId || m.status !== STATUS.ACTIVE) continue;
      const ent = _entity(m.studentId);
      out.push({
        mentorshipId: m.mentorshipId, studentId: m.studentId,
        name: ent?.name || m.studentId, role: ent?.role || "unknown",
        domain: m.domain, progress: m.progress,
        currentStep: m.currentStep, lessonsCompleted: m.lessonsCompleted,
        lessonsTotal: m.lessonsTotal, startedAt: m.startedAt,
      });
    }
    return out;
  } catch (err) { logger.warn('emergent:entity-teaching', 'listActiveStudents failed', { mentorId, error: err?.message }); return []; }
}

/**
 * List a student's currently active mentors with progress summaries.
 *
 * @param {string} studentId
 * @returns {object[]} Array of mentor summaries
 */
export function listActiveMentors(studentId) {
  try {
    if (!studentId) return [];
    const out = [];
    for (const [, m] of _mentorships) {
      if (m.studentId !== studentId || m.status !== STATUS.ACTIVE) continue;
      const ent = _entity(m.mentorId);
      out.push({
        mentorshipId: m.mentorshipId, mentorId: m.mentorId,
        name: ent?.name || m.mentorId, role: ent?.role || "unknown",
        domain: m.domain, progress: m.progress,
        currentStep: m.currentStep, lessonsCompleted: m.lessonsCompleted,
        lessonsTotal: m.lessonsTotal, startedAt: m.startedAt,
      });
    }
    return out;
  } catch (err) { logger.warn('emergent:entity-teaching', 'listActiveMentors failed', { studentId, error: err?.message }); return []; }
}

// ═══════════════════════════════════════════════════════════════════════════════
// GLOBAL METRICS
// ═══════════════════════════════════════════════════════════════════════════════

/**
 * Get global teaching system statistics.
 *
 * Aggregates across all mentorships and teaching profiles:
 *   - Mentorship counts by status
 *   - Active mentor/student counts
 *   - Lesson submission and evaluation stats
 *   - Average lesson score and student improvement
 *   - Domain distribution
 *   - Graduation rate
 *   - Master teacher count
 *
 * @returns {object}
 */
export function getTeachingMetrics() {
  try {
    const counts = { total: 0, active: 0, completed: 0, dissolved: 0, proposed: 0, paused: 0 };
    let lessonsSubmitted = 0, lessonsEvaluated = 0, lessonScoreSum = 0;
    let improvSum = 0, improvN = 0;
    const domains = {};
    const mentorSet = new Set(), studentSet = new Set();

    for (const [mid, m] of _mentorships) {
      counts.total++;
      if (m.status === STATUS.ACTIVE) { counts.active++; mentorSet.add(m.mentorId); studentSet.add(m.studentId); }
      else if (m.status === STATUS.COMPLETED) counts.completed++;
      else if (m.status === STATUS.DISSOLVED) counts.dissolved++;
      else if (m.status === STATUS.PROPOSED) counts.proposed++;
      else if (m.status === STATUS.PAUSED) counts.paused++;

      domains[m.domain] = (domains[m.domain] || 0) + 1;

      const log = _lessonLog.get(mid) || [];
      lessonsSubmitted += log.length;
      for (const l of log) {
        if (l.evaluated) { lessonsEvaluated++; lessonScoreSum += l.score; }
      }
      if (m.status === STATUS.COMPLETED) {
        improvSum += (m.studentMaturityNow - m.studentMaturityAtStart);
        improvN++;
      }
    }

    let masterTeachers = 0, registeredMentors = 0;
    for (const [, p] of _teachingProfiles) {
      registeredMentors++;
      if (p.tags.includes("master_teacher")) masterTeachers++;
    }

    return {
      ok: true,
      totalMentorships: counts.total, activeMentorships: counts.active,
      completedMentorships: counts.completed, dissolvedMentorships: counts.dissolved,
      proposedMentorships: counts.proposed, pausedMentorships: counts.paused,
      activeMentorCount: mentorSet.size, activeStudentCount: studentSet.size,
      totalRegisteredMentors: registeredMentors, totalMasterTeachers: masterTeachers,
      totalLessonsSubmitted: lessonsSubmitted, totalLessonsEvaluated: lessonsEvaluated,
      avgLessonScore: lessonsEvaluated > 0 ? Math.round((lessonScoreSum / lessonsEvaluated) * 1000) / 1000 : 0,
      avgImprovement: improvN > 0 ? Math.round((improvSum / improvN) * 10000) / 10000 : 0,
      domainDistribution: domains,
      graduationRate: counts.total > 0 ? Math.round((counts.completed / counts.total) * 1000) / 1000 : 0,
    };
  } catch (err) { logger.warn('emergent:entity-teaching', 'metrics computation failed', { error: err?.message }); return { ok: false, error: "metrics_computation_failed" }; }
}
