/**
 * HLR (High-Level Reasoning) Engine
 *
 * Takes a topic, question, or knowledge gap and reasons using multi-step
 * chains across multiple reasoning modes. Produces structured conclusions,
 * proposed DTUs tagged "hlr_output", open questions, and full reasoning traces.
 *
 * Reasoning Modes:
 *   - Deductive:      axioms → conclusions
 *   - Inductive:      observations → generalizations
 *   - Abductive:      surprising facts → best explanations
 *   - Adversarial:    assume opposite, find weaknesses
 *   - Analogical:     structural parallels in other domains
 *   - Temporal:       how evolves over time
 *   - Counterfactual: what if X were different
 *
 * HLR Triggers:
 *   - Research job requests
 *   - Meta-Growth OS urgency > 0.7
 *   - Council disagreement
 *   - Ingest produces contradictory claims
 *   - Sovereign command
 *
 * All reasoning is simulated deterministically (no LLM calls).
 * Generates structured reasoning chains from DTU tags, claims, and domain
 * classification. Each chain produces claims with confidence scores.
 *
 * Additive only. Silent failure. No existing logic changes.
 */

import crypto from "crypto";

// ── Helpers ─────────────────────────────────────────────────────────────────

function uid(prefix = "id") {
  return `${prefix}_${crypto.randomBytes(10).toString("hex")}`;
}

function clamp01(v) {
  return Math.max(0, Math.min(1, Number(v) || 0));
}

function nowISO() {
  return new Date().toISOString();
}

// ── Reasoning Modes ─────────────────────────────────────────────────────────

export const REASONING_MODES = Object.freeze({
  DEDUCTIVE:      "deductive",
  INDUCTIVE:      "inductive",
  ABDUCTIVE:      "abductive",
  ADVERSARIAL:    "adversarial",
  ANALOGICAL:     "analogical",
  TEMPORAL:       "temporal",
  COUNTERFACTUAL: "counterfactual",
});

const ALL_MODES = Object.values(REASONING_MODES);

// ── In-Memory State ─────────────────────────────────────────────────────────

const _traces = new Map();    // traceId → ReasoningTrace
const _metrics = {
  totalRuns: 0,
  totalChains: 0,
  avgConfidence: 0,
  avgConvergence: 0,
  avgNovelty: 0,
  byMode: {},
  proposedDTUs: 0,
  openQuestions: 0,
};

// ── Domain Knowledge Seeds ──────────────────────────────────────────────────
// Used for analogical reasoning and domain-crossing when DTU context is thin.

const DOMAIN_ANALOGIES = {
  mathematics:  { patterns: ["fixed-point", "convergence", "boundary condition", "symmetry"], parallels: ["physics", "computation", "economics"] },
  physics:      { patterns: ["conservation", "equilibrium", "phase transition", "entropy"], parallels: ["biology", "economics", "engineering"] },
  biology:      { patterns: ["adaptation", "selection pressure", "homeostasis", "emergence"], parallels: ["economics", "sociology", "computation"] },
  economics:    { patterns: ["supply-demand", "equilibrium", "incentive structure", "externality"], parallels: ["biology", "governance", "psychology"] },
  philosophy:   { patterns: ["dualism", "reductionism", "emergence", "teleology"], parallels: ["physics", "psychology", "ethics"] },
  psychology:   { patterns: ["reinforcement", "cognitive bias", "heuristic", "framing effect"], parallels: ["economics", "sociology", "biology"] },
  computation:  { patterns: ["recursion", "halting problem", "abstraction layer", "state machine"], parallels: ["mathematics", "linguistics", "biology"] },
  governance:   { patterns: ["checks and balances", "feedback loop", "principal-agent", "collective action"], parallels: ["biology", "economics", "ethics"] },
  engineering:  { patterns: ["redundancy", "fault tolerance", "modularity", "scaling law"], parallels: ["biology", "computation", "physics"] },
  ethics:       { patterns: ["categorical imperative", "consequentialism", "fairness", "autonomy"], parallels: ["governance", "philosophy", "economics"] },
  sociology:    { patterns: ["network effect", "norm formation", "stratification", "collective behavior"], parallels: ["biology", "economics", "psychology"] },
  linguistics:  { patterns: ["compositionality", "recursion", "pragmatics", "semantic drift"], parallels: ["computation", "psychology", "philosophy"] },
};

const TEMPORAL_PHASES = ["emergence", "growth", "plateau", "disruption", "adaptation", "stabilization"];

// ═══════════════════════════════════════════════════════════════════════════════
// STEP 1: FRAME — Extract assumptions, gather evidence, identify unknowns
// ═══════════════════════════════════════════════════════════════════════════════

/**
 * Frame the reasoning problem by analyzing topic, question, and related DTUs.
 *
 * @param {object} input
 * @param {string} input.topic
 * @param {string} input.question
 * @param {object} [input.context]
 * @param {object[]} [input.relatedDTUs]
 * @returns {object} Framing with assumptions, evidence, unknowns, domain
 */
function frameReasoning(input) {
  const { topic, question, context, relatedDTUs } = input;
  const dtus = Array.isArray(relatedDTUs) ? relatedDTUs : [];

  // Extract assumptions from question phrasing
  const assumptions = extractAssumptions(question || topic || "");

  // Gather evidence from related DTUs
  const evidence = [];
  const claimPool = [];
  const tagPool = new Set();
  const domainHits = new Map();

  for (const dtu of dtus) {
    // Collect claims
    const claims = extractDTUClaims(dtu);
    for (const claim of claims) {
      claimPool.push(claim);
      evidence.push({
        source: dtu.id || dtu.title || "unknown",
        claim: claim.text,
        confidence: claim.confidence,
        domain: claim.domain,
      });
    }

    // Collect tags
    for (const tag of (dtu.tags || [])) {
      tagPool.add(typeof tag === "string" ? tag.toLowerCase() : String(tag));
    }

    // Count domain hits
    const domain = classifyDomain(dtu);
    if (domain) {
      domainHits.set(domain, (domainHits.get(domain) || 0) + 1);
    }
  }

  // Determine primary domain
  let primaryDomain = "general";
  let maxHits = 0;
  for (const [domain, count] of domainHits) {
    if (count > maxHits) {
      maxHits = count;
      primaryDomain = domain;
    }
  }

  // Also try topic/question keywords for domain
  if (primaryDomain === "general") {
    primaryDomain = inferDomainFromText(`${topic || ""} ${question || ""}`) || "general";
  }

  // Identify unknowns — gaps not covered by evidence
  const unknowns = identifyUnknowns(topic, question, evidence, assumptions);

  return {
    topic: topic || "",
    question: question || "",
    context: context || {},
    assumptions,
    evidence,
    claimPool,
    tagPool: Array.from(tagPool),
    primaryDomain,
    domainHits: Object.fromEntries(domainHits),
    unknowns,
    dtuCount: dtus.length,
    evidenceCount: evidence.length,
  };
}

/**
 * Extract implicit assumptions from question/topic text.
 */
function extractAssumptions(text) {
  const lower = text.toLowerCase();
  const assumptions = [];

  // Detect "if" clauses → conditional assumptions
  const ifMatches = lower.match(/\bif\s+([^,?.]+)/g);
  if (ifMatches) {
    for (const m of ifMatches) {
      assumptions.push({ type: "conditional", text: m.trim(), implicit: true });
    }
  }

  // Detect "because" / "since" → causal assumptions
  const causalMatches = lower.match(/\b(?:because|since)\s+([^,?.]+)/g);
  if (causalMatches) {
    for (const m of causalMatches) {
      assumptions.push({ type: "causal", text: m.trim(), implicit: true });
    }
  }

  // Detect "should" / "must" / "always" / "never" → normative assumptions
  if (/\b(should|must|always|never|necessarily)\b/.test(lower)) {
    assumptions.push({ type: "normative", text: "Normative framing detected in question", implicit: true });
  }

  // Detect "why" → presupposes existence of the thing
  if (/^why\b/.test(lower)) {
    assumptions.push({ type: "existential", text: "Presupposes the phenomenon exists and has a cause", implicit: true });
  }

  // Detect "how" → presupposes mechanism exists
  if (/^how\b/.test(lower)) {
    assumptions.push({ type: "mechanistic", text: "Presupposes a describable mechanism exists", implicit: true });
  }

  // Always add a baseline assumption
  if (assumptions.length === 0) {
    assumptions.push({ type: "baseline", text: "Topic is well-defined and reasonably scoped", implicit: true });
  }

  return assumptions;
}

/**
 * Extract claims from a DTU, normalizing across different DTU shapes.
 */
function extractDTUClaims(dtu) {
  const claims = [];

  // core.claims
  if (Array.isArray(dtu.core?.claims)) {
    for (const c of dtu.core.claims) {
      if (typeof c === "string") {
        claims.push({ text: c, confidence: dtu.confidence || 0.5, domain: classifyDomain(dtu) || "general" });
      } else if (c && c.text) {
        claims.push({ text: c.text, confidence: c.confidence || dtu.confidence || 0.5, domain: classifyDomain(dtu) || "general" });
      }
    }
  }

  // core.invariants
  if (Array.isArray(dtu.core?.invariants)) {
    for (const inv of dtu.core.invariants) {
      if (typeof inv === "string" && inv.length > 5) {
        claims.push({ text: inv, confidence: clamp01((dtu.confidence || 0.5) + 0.1), domain: classifyDomain(dtu) || "general", type: "invariant" });
      }
    }
  }

  // core.definitions
  if (Array.isArray(dtu.core?.definitions)) {
    for (const def of dtu.core.definitions) {
      if (typeof def === "string" && def.length > 5) {
        claims.push({ text: def, confidence: clamp01((dtu.confidence || 0.5) + 0.05), domain: classifyDomain(dtu) || "general", type: "definition" });
      }
    }
  }

  // Top-level claims array (Atlas DTU format)
  if (Array.isArray(dtu.claims)) {
    for (const c of dtu.claims) {
      if (typeof c === "string") {
        claims.push({ text: c, confidence: 0.5, domain: classifyDomain(dtu) || "general" });
      } else if (c && c.text) {
        claims.push({ text: c.text, confidence: c.confidence || 0.5, domain: classifyDomain(dtu) || "general" });
      }
    }
  }

  // Fallback: use content
  if (claims.length === 0 && dtu.content && typeof dtu.content === "string") {
    claims.push({ text: dtu.content.slice(0, 300), confidence: dtu.confidence || 0.4, domain: classifyDomain(dtu) || "general" });
  }

  return claims;
}

/**
 * Classify domain from a DTU's tags, domainType, or other markers.
 */
function classifyDomain(dtu) {
  // Explicit domain
  if (dtu.domainType) return dtu.domainType;

  // domain: prefix tag
  for (const tag of (dtu.tags || [])) {
    if (typeof tag === "string" && tag.startsWith("domain:")) {
      return tag.slice(7);
    }
  }

  // Known domain tags
  const knownDomains = Object.keys(DOMAIN_ANALOGIES);
  for (const tag of (dtu.tags || [])) {
    const lower = typeof tag === "string" ? tag.toLowerCase() : "";
    if (knownDomains.includes(lower)) return lower;
  }

  return null;
}

/**
 * Infer domain from raw text via keyword matching.
 */
function inferDomainFromText(text) {
  const lower = text.toLowerCase();
  const domainKeywords = {
    mathematics:  ["math", "theorem", "proof", "equation", "algebra", "calculus", "topology"],
    physics:      ["physics", "quantum", "energy", "force", "particle", "relativity", "entropy"],
    biology:      ["biology", "gene", "cell", "organism", "evolution", "ecology", "protein"],
    economics:    ["economics", "market", "price", "supply", "demand", "gdp", "trade", "fiscal"],
    philosophy:   ["philosophy", "ontology", "epistemology", "ethics", "metaphysics", "consciousness"],
    psychology:   ["psychology", "cognitive", "behavior", "mental", "perception", "bias"],
    computation:  ["algorithm", "computation", "software", "program", "data structure", "complexity"],
    governance:   ["governance", "policy", "regulation", "democratic", "institution", "law"],
    engineering:  ["engineering", "design", "system", "architecture", "infrastructure", "build"],
    ethics:       ["ethics", "moral", "justice", "fairness", "rights", "duty", "harm"],
    sociology:    ["sociology", "social", "culture", "community", "network", "institution"],
    linguistics:  ["linguistics", "language", "grammar", "syntax", "semantics", "phonology"],
  };

  let bestDomain = null;
  let bestScore = 0;

  for (const [domain, keywords] of Object.entries(domainKeywords)) {
    let score = 0;
    for (const kw of keywords) {
      if (lower.includes(kw)) score++;
    }
    if (score > bestScore) {
      bestScore = score;
      bestDomain = domain;
    }
  }

  return bestDomain;
}

/**
 * Identify unknowns — gaps in evidence relative to the question.
 */
function identifyUnknowns(topic, question, evidence, assumptions) {
  const unknowns = [];
  const text = `${topic || ""} ${question || ""}`.toLowerCase();

  // If no evidence, everything is unknown
  if (evidence.length === 0) {
    unknowns.push({ type: "no_evidence", description: "No related DTUs provide evidence for this topic" });
  }

  // If evidence exists but confidence is low
  const avgConf = evidence.length > 0
    ? evidence.reduce((s, e) => s + (e.confidence || 0), 0) / evidence.length
    : 0;
  if (avgConf < 0.4 && evidence.length > 0) {
    unknowns.push({ type: "low_confidence", description: `Average evidence confidence is ${avgConf.toFixed(2)} — claims are weakly supported` });
  }

  // Causal questions with no causal evidence
  if (/\b(why|cause|reason|because)\b/.test(text)) {
    const hasCausalEvidence = evidence.some(e => /\b(cause|because|therefore|leads to|results in)\b/i.test(e.claim || ""));
    if (!hasCausalEvidence) {
      unknowns.push({ type: "causal_gap", description: "Question implies causation but no causal evidence available" });
    }
  }

  // Temporal questions with no temporal evidence
  if (/\b(when|timeline|history|future|evolve|change over time)\b/.test(text)) {
    const hasTemporalEvidence = evidence.some(e => /\b(year|century|decade|before|after|evolve|history)\b/i.test(e.claim || ""));
    if (!hasTemporalEvidence) {
      unknowns.push({ type: "temporal_gap", description: "Question implies temporal dimension but no temporal evidence available" });
    }
  }

  // Conditional assumptions that lack grounding
  for (const a of assumptions) {
    if (a.type === "conditional") {
      unknowns.push({ type: "ungrounded_conditional", description: `Conditional assumption not verified: "${a.text}"` });
    }
  }

  if (unknowns.length === 0) {
    unknowns.push({ type: "none_detected", description: "No obvious gaps detected in evidence coverage" });
  }

  return unknowns;
}

// ═══════════════════════════════════════════════════════════════════════════════
// STEP 2: GENERATE REASONING CHAINS (minimum 3)
// ═══════════════════════════════════════════════════════════════════════════════

/**
 * Generate reasoning chains based on the framing and requested mode.
 * Always produces at minimum 3 chains:
 *   - Direct deduction from DTUs
 *   - Analogical from other domains
 *   - Adversarial (what if opposite true?)
 *
 * @param {object} frame - From frameReasoning
 * @param {string} mode - Primary reasoning mode
 * @param {number} depth - Reasoning depth (1-5)
 * @returns {object[]} Array of reasoning chains
 */
function generateChains(frame, mode, depth) {
  const effectiveDepth = Math.max(1, Math.min(5, Number(depth) || 3));
  const chains = [];

  // Always generate the three mandatory chain types
  chains.push(generateDeductiveChain(frame, effectiveDepth));
  chains.push(generateAnalogicalChain(frame, effectiveDepth));
  chains.push(generateAdversarialChain(frame, effectiveDepth));

  // Add mode-specific chain if it differs from the mandatory three
  const modeStr = (mode || "").toLowerCase();
  if (modeStr === REASONING_MODES.INDUCTIVE && !chains.some(c => c.mode === REASONING_MODES.INDUCTIVE)) {
    chains.push(generateInductiveChain(frame, effectiveDepth));
  }
  if (modeStr === REASONING_MODES.ABDUCTIVE && !chains.some(c => c.mode === REASONING_MODES.ABDUCTIVE)) {
    chains.push(generateAbductiveChain(frame, effectiveDepth));
  }
  if (modeStr === REASONING_MODES.TEMPORAL && !chains.some(c => c.mode === REASONING_MODES.TEMPORAL)) {
    chains.push(generateTemporalChain(frame, effectiveDepth));
  }
  if (modeStr === REASONING_MODES.COUNTERFACTUAL && !chains.some(c => c.mode === REASONING_MODES.COUNTERFACTUAL)) {
    chains.push(generateCounterfactualChain(frame, effectiveDepth));
  }

  return chains;
}

/**
 * DEDUCTIVE chain: axioms/known claims → logical conclusions.
 */
function generateDeductiveChain(frame, depth) {
  const chainId = uid("chain");
  const steps = [];
  const claims = frame.claimPool.slice();

  // Step 1: Premises (from evidence)
  const premises = claims.slice(0, Math.min(claims.length, depth + 2));
  if (premises.length === 0) {
    premises.push({ text: `Assume: "${frame.topic}" is a well-defined subject of inquiry`, confidence: 0.3 });
  }

  steps.push({
    stepIndex: 0,
    type: "premise_collection",
    description: `Collected ${premises.length} premises from related DTUs`,
    claims: premises.map(p => p.text),
    confidence: avgConfidence(premises),
  });

  // Step 2..N: Derive conclusions by combining premises
  let currentConfidence = avgConfidence(premises);
  for (let i = 1; i <= depth; i++) {
    const derivedClaims = deriveFromPremises(premises, frame, i);
    currentConfidence = clamp01(currentConfidence * 0.9); // Each step slightly reduces confidence

    steps.push({
      stepIndex: i,
      type: "deduction",
      description: `Deductive step ${i}: combine premises to derive conclusions`,
      claims: derivedClaims,
      confidence: currentConfidence,
    });
  }

  // Final conclusion
  const conclusion = synthesizeClaims(steps.map(s => s.claims).flat(), frame.topic);
  const finalConfidence = clamp01(currentConfidence * 0.95);

  steps.push({
    stepIndex: steps.length,
    type: "conclusion",
    description: "Deductive conclusion synthesized from chain",
    claims: [conclusion],
    confidence: finalConfidence,
  });

  return {
    chainId,
    mode: REASONING_MODES.DEDUCTIVE,
    steps,
    conclusion,
    confidence: finalConfidence,
    stepCount: steps.length,
  };
}

/**
 * INDUCTIVE chain: observations → generalizations.
 */
function generateInductiveChain(frame, depth) {
  const chainId = uid("chain");
  const steps = [];

  // Step 1: Observations
  const observations = frame.evidence.slice(0, Math.min(frame.evidence.length, depth + 3));
  if (observations.length === 0) {
    observations.push({ claim: `No direct observations about "${frame.topic}" available`, confidence: 0.2 });
  }

  steps.push({
    stepIndex: 0,
    type: "observation_collection",
    description: `Gathered ${observations.length} observations from evidence`,
    claims: observations.map(o => o.claim),
    confidence: avgConfidence(observations.map(o => ({ confidence: o.confidence }))),
  });

  // Step 2: Identify patterns across observations
  const patterns = identifyPatterns(observations, frame.primaryDomain);
  steps.push({
    stepIndex: 1,
    type: "pattern_identification",
    description: `Identified ${patterns.length} recurring pattern(s) across observations`,
    claims: patterns,
    confidence: clamp01(observations.length > 2 ? 0.6 : 0.35),
  });

  // Step 3..N: Generalize
  let currentConfidence = clamp01(observations.length > 2 ? 0.55 : 0.3);
  for (let i = 2; i < depth; i++) {
    const generalization = generalizePattern(patterns, frame, i);
    currentConfidence = clamp01(currentConfidence * 0.85);
    steps.push({
      stepIndex: i,
      type: "generalization",
      description: `Generalization step ${i - 1}: broaden pattern scope`,
      claims: [generalization],
      confidence: currentConfidence,
    });
  }

  const conclusion = `Inductive generalization: based on ${observations.length} observations in ${frame.primaryDomain}, ${patterns[0] || frame.topic + " exhibits consistent patterns"}`;
  steps.push({
    stepIndex: steps.length,
    type: "conclusion",
    description: "Inductive conclusion",
    claims: [conclusion],
    confidence: clamp01(currentConfidence * 0.9),
  });

  return {
    chainId,
    mode: REASONING_MODES.INDUCTIVE,
    steps,
    conclusion,
    confidence: clamp01(currentConfidence * 0.9),
    stepCount: steps.length,
  };
}

/**
 * ABDUCTIVE chain: surprising facts → best explanations.
 */
function generateAbductiveChain(frame, depth) {
  const chainId = uid("chain");
  const steps = [];

  // Step 1: Identify surprising or anomalous claims
  const anomalies = findAnomalies(frame);
  steps.push({
    stepIndex: 0,
    type: "anomaly_detection",
    description: `Found ${anomalies.length} surprising or anomalous claim(s)`,
    claims: anomalies,
    confidence: anomalies.length > 0 ? 0.5 : 0.25,
  });

  // Step 2: Generate candidate explanations
  const explanations = generateExplanations(anomalies, frame);
  steps.push({
    stepIndex: 1,
    type: "hypothesis_generation",
    description: `Generated ${explanations.length} candidate explanation(s)`,
    claims: explanations,
    confidence: 0.45,
  });

  // Step 3..N: Evaluate explanations against evidence
  let bestExplanation = explanations[0] || `"${frame.topic}" may involve mechanisms not captured by current evidence`;
  let currentConfidence = 0.4;

  for (let i = 2; i < Math.min(depth + 2, 5); i++) {
    const evaluation = evaluateExplanation(bestExplanation, frame);
    currentConfidence = clamp01(currentConfidence + evaluation.delta);
    steps.push({
      stepIndex: i,
      type: "explanation_evaluation",
      description: `Evaluating explanation against ${frame.evidenceCount} evidence items`,
      claims: [evaluation.assessment],
      confidence: currentConfidence,
    });
    if (evaluation.revised) bestExplanation = evaluation.revised;
  }

  steps.push({
    stepIndex: steps.length,
    type: "conclusion",
    description: "Best explanation selected via abductive reasoning",
    claims: [bestExplanation],
    confidence: currentConfidence,
  });

  return {
    chainId,
    mode: REASONING_MODES.ABDUCTIVE,
    steps,
    conclusion: bestExplanation,
    confidence: currentConfidence,
    stepCount: steps.length,
  };
}

/**
 * ADVERSARIAL chain: assume opposite, find weaknesses.
 */
function generateAdversarialChain(frame, depth) {
  const chainId = uid("chain");
  const steps = [];

  // Step 1: State the default position (what evidence suggests)
  const defaultPosition = frame.claimPool.length > 0
    ? frame.claimPool[0].text
    : `"${frame.topic}" is as commonly understood`;

  steps.push({
    stepIndex: 0,
    type: "default_position",
    description: "State the default position to challenge",
    claims: [defaultPosition],
    confidence: 0.6,
  });

  // Step 2: Assume the opposite
  const opposite = negatePosition(defaultPosition);
  steps.push({
    stepIndex: 1,
    type: "negation",
    description: "Assume the opposite position",
    claims: [opposite],
    confidence: 0.3,
  });

  // Step 3: Find weaknesses in the default position
  const weaknesses = findWeaknesses(frame);
  steps.push({
    stepIndex: 2,
    type: "weakness_analysis",
    description: `Identified ${weaknesses.length} potential weakness(es) in default position`,
    claims: weaknesses,
    confidence: 0.5,
  });

  // Step 4..N: Stress-test
  let stressConfidence = 0.5;
  for (let i = 3; i < depth + 2; i++) {
    const test = stressTest(weaknesses, frame, i);
    stressConfidence = clamp01(stressConfidence + test.delta);
    steps.push({
      stepIndex: i,
      type: "stress_test",
      description: `Stress-test round ${i - 2}: probe weakness resilience`,
      claims: [test.result],
      confidence: stressConfidence,
    });
  }

  // Conclusion: how strong is the default position after adversarial challenge?
  const survived = stressConfidence > 0.45;
  const conclusion = survived
    ? `Default position on "${frame.topic}" survives adversarial challenge with confidence ${stressConfidence.toFixed(2)} — weaknesses exist but do not invalidate`
    : `Default position on "${frame.topic}" shows significant vulnerabilities under adversarial analysis (confidence ${stressConfidence.toFixed(2)}) — revision recommended`;

  steps.push({
    stepIndex: steps.length,
    type: "conclusion",
    description: "Adversarial verdict",
    claims: [conclusion],
    confidence: stressConfidence,
  });

  return {
    chainId,
    mode: REASONING_MODES.ADVERSARIAL,
    steps,
    conclusion,
    confidence: stressConfidence,
    stepCount: steps.length,
  };
}

/**
 * ANALOGICAL chain: structural parallels from other domains.
 */
function generateAnalogicalChain(frame, depth) {
  const chainId = uid("chain");
  const steps = [];
  const domain = frame.primaryDomain;
  const analogySource = DOMAIN_ANALOGIES[domain] || DOMAIN_ANALOGIES.philosophy;

  // Step 1: Identify source domain patterns
  steps.push({
    stepIndex: 0,
    type: "source_patterns",
    description: `Identified structural patterns in ${domain}: ${analogySource.patterns.join(", ")}`,
    claims: analogySource.patterns.map(p => `Pattern in ${domain}: ${p}`),
    confidence: 0.6,
  });

  // Step 2: Map to parallel domains
  const parallels = analogySource.parallels.slice(0, Math.min(depth, 3));
  const mappings = [];
  for (const targetDomain of parallels) {
    const targetPatterns = DOMAIN_ANALOGIES[targetDomain]?.patterns || [];
    const overlap = analogySource.patterns.filter(p => {
      return targetPatterns.some(tp => conceptualOverlap(p, tp));
    });

    if (overlap.length > 0 || targetPatterns.length > 0) {
      mappings.push(`Structural parallel: "${overlap[0] || analogySource.patterns[0]}" in ${domain} maps to "${targetPatterns[0] || "related structure"}" in ${targetDomain}`);
    }
  }

  steps.push({
    stepIndex: 1,
    type: "cross_domain_mapping",
    description: `Mapped structural parallels to ${parallels.length} domain(s)`,
    claims: mappings.length > 0 ? mappings : [`No strong structural parallel found; weak analogy to ${parallels[0] || "adjacent domain"}`],
    confidence: clamp01(mappings.length > 0 ? 0.5 : 0.25),
  });

  // Step 3: Transfer insights
  const transfers = [];
  for (const mapping of mappings) {
    transfers.push(`Insight transfer: ${mapping} suggests ${frame.topic} may exhibit analogous behavior`);
  }

  if (transfers.length === 0) {
    transfers.push(`Weak analogy suggests ${frame.topic} may share structural properties with ${parallels[0] || "related domains"}`);
  }

  steps.push({
    stepIndex: 2,
    type: "insight_transfer",
    description: "Transfer analogical insights to original domain",
    claims: transfers,
    confidence: clamp01(transfers.length > 0 ? 0.45 : 0.25),
  });

  const conclusion = transfers[0] || `Analogical reasoning about "${frame.topic}" yields limited cross-domain insight`;
  const finalConf = clamp01(mappings.length > 0 ? 0.5 : 0.3);

  steps.push({
    stepIndex: steps.length,
    type: "conclusion",
    description: "Analogical conclusion",
    claims: [conclusion],
    confidence: finalConf,
  });

  return {
    chainId,
    mode: REASONING_MODES.ANALOGICAL,
    steps,
    conclusion,
    confidence: finalConf,
    stepCount: steps.length,
  };
}

/**
 * TEMPORAL chain: how evolves over time.
 */
function generateTemporalChain(frame, depth) {
  const chainId = uid("chain");
  const steps = [];

  // Step 1: Establish current state
  const currentState = frame.claimPool.length > 0
    ? `Current understanding: ${frame.claimPool[0].text}`
    : `Current state of "${frame.topic}" is partially known`;

  steps.push({
    stepIndex: 0,
    type: "current_state",
    description: "Establish the current state of the topic",
    claims: [currentState],
    confidence: frame.claimPool.length > 0 ? 0.55 : 0.3,
  });

  // Step 2..N: Project through temporal phases
  let phaseConfidence = 0.5;
  const projectedPhases = TEMPORAL_PHASES.slice(0, Math.min(depth + 1, TEMPORAL_PHASES.length));

  for (let i = 0; i < projectedPhases.length; i++) {
    const phase = projectedPhases[i];
    phaseConfidence = clamp01(phaseConfidence - 0.04 * (i + 1)); // Confidence decreases with future projection

    const projection = projectPhase(frame, phase, i);
    steps.push({
      stepIndex: i + 1,
      type: `temporal_phase_${phase}`,
      description: `Temporal phase: ${phase}`,
      claims: [projection],
      confidence: phaseConfidence,
    });
  }

  const conclusion = `Temporal analysis: "${frame.topic}" is projected to pass through ${projectedPhases.join(" → ")} phases, with decreasing predictability over time`;

  steps.push({
    stepIndex: steps.length,
    type: "conclusion",
    description: "Temporal projection conclusion",
    claims: [conclusion],
    confidence: clamp01(phaseConfidence * 0.9),
  });

  return {
    chainId,
    mode: REASONING_MODES.TEMPORAL,
    steps,
    conclusion,
    confidence: clamp01(phaseConfidence * 0.9),
    stepCount: steps.length,
  };
}

/**
 * COUNTERFACTUAL chain: what if X were different?
 */
function generateCounterfactualChain(frame, depth) {
  const chainId = uid("chain");
  const steps = [];

  // Step 1: Identify the key variable to alter
  const keyVariable = frame.assumptions.length > 0
    ? frame.assumptions[0].text
    : `the current understanding of "${frame.topic}"`;

  steps.push({
    stepIndex: 0,
    type: "variable_selection",
    description: "Select the key variable to alter counterfactually",
    claims: [`Key variable: ${keyVariable}`],
    confidence: 0.6,
  });

  // Step 2: State the counterfactual
  const counterfactual = `What if ${keyVariable} were false or different?`;
  steps.push({
    stepIndex: 1,
    type: "counterfactual_statement",
    description: "State the counterfactual scenario",
    claims: [counterfactual],
    confidence: 0.5,
  });

  // Step 3..N: Trace cascading effects
  let cascadeConf = 0.45;
  for (let i = 2; i < depth + 2; i++) {
    const effect = traceCascade(frame, keyVariable, i - 1);
    cascadeConf = clamp01(cascadeConf - 0.05);
    steps.push({
      stepIndex: i,
      type: "cascade_effect",
      description: `Cascading effect ${i - 1}: downstream implications`,
      claims: [effect],
      confidence: cascadeConf,
    });
  }

  const conclusion = `Counterfactual analysis: if "${keyVariable}" were different, ${frame.claimPool.length} related claims would require revision. The topic's robustness to this change is ${cascadeConf > 0.35 ? "moderate" : "low"}.`;

  steps.push({
    stepIndex: steps.length,
    type: "conclusion",
    description: "Counterfactual conclusion",
    claims: [conclusion],
    confidence: cascadeConf,
  });

  return {
    chainId,
    mode: REASONING_MODES.COUNTERFACTUAL,
    steps,
    conclusion,
    confidence: cascadeConf,
    stepCount: steps.length,
  };
}

// ═══════════════════════════════════════════════════════════════════════════════
// STEP 3: EVALUATE — Convergence, Confidence, Novelty, Contradictions
// ═══════════════════════════════════════════════════════════════════════════════

/**
 * Evaluate reasoning chains for convergence, confidence, novelty, and contradictions.
 *
 * @param {object[]} chains - From generateChains
 * @param {object} frame - From frameReasoning
 * @returns {object} Evaluation results
 */
function evaluateChains(chains, frame) {
  if (!chains || chains.length === 0) {
    return { convergence: 0, confidence: 0, novelty: 0, contradictions: [], summary: "no_chains" };
  }

  // ── Convergence: do chains reach the same conclusion? ──
  const conclusions = chains.map(c => c.conclusion || "");
  const convergenceScores = [];

  for (let i = 0; i < conclusions.length; i++) {
    for (let j = i + 1; j < conclusions.length; j++) {
      const sim = textSimilarity(conclusions[i], conclusions[j]);
      convergenceScores.push(sim);
    }
  }

  const convergence = convergenceScores.length > 0
    ? clamp01(convergenceScores.reduce((s, v) => s + v, 0) / convergenceScores.length)
    : 0;

  // ── Confidence: average across chains ──
  const confidence = clamp01(
    chains.reduce((s, c) => s + (c.confidence || 0), 0) / chains.length
  );

  // ── Novelty: how much new content compared to input evidence? ──
  const evidenceText = frame.evidence.map(e => e.claim || "").join(" ");
  const conclusionText = conclusions.join(" ");
  const inputTokens = tokenize(evidenceText);
  const outputTokens = tokenize(conclusionText);

  let newTokens = 0;
  for (const t of outputTokens) {
    if (!inputTokens.has(t)) newTokens++;
  }
  const novelty = outputTokens.size > 0 ? clamp01(newTokens / outputTokens.size) : 0;

  // ── Contradictions: where do chains disagree? ──
  const contradictions = [];
  for (let i = 0; i < chains.length; i++) {
    for (let j = i + 1; j < chains.length; j++) {
      const disagreement = detectDisagreement(chains[i], chains[j]);
      if (disagreement) {
        contradictions.push({
          chainA: chains[i].chainId,
          chainB: chains[j].chainId,
          modeA: chains[i].mode,
          modeB: chains[j].mode,
          description: disagreement,
        });
      }
    }
  }

  return {
    convergence: Math.round(convergence * 1000) / 1000,
    confidence: Math.round(confidence * 1000) / 1000,
    novelty: Math.round(novelty * 1000) / 1000,
    contradictions,
    contradictionCount: contradictions.length,
    chainCount: chains.length,
    summary: convergence > 0.6
      ? "high_convergence"
      : convergence > 0.3
        ? "partial_convergence"
        : "divergent",
  };
}

// ═══════════════════════════════════════════════════════════════════════════════
// STEP 4: OUTPUT — Synthesize conclusion, propose DTUs, list open questions
// ═══════════════════════════════════════════════════════════════════════════════

/**
 * Synthesize the final HLR output from chains and evaluation.
 *
 * @param {object} frame - From frameReasoning
 * @param {object[]} chains - From generateChains
 * @param {object} evaluation - From evaluateChains
 * @returns {object} HLR output
 */
function synthesizeOutput(frame, chains, evaluation) {
  // ── Synthesized conclusion ──
  const conclusions = chains.map(c => c.conclusion).filter(Boolean);
  let synthesizedConclusion;

  if (evaluation.convergence > 0.6) {
    synthesizedConclusion = `[High convergence] Multiple reasoning modes agree: ${conclusions[0] || "no conclusion available"}`;
  } else if (evaluation.contradictionCount > 0) {
    synthesizedConclusion = `[Contested] Reasoning chains disagree. Strongest chain (${chains[0]?.mode}): ${conclusions[0] || "inconclusive"}. Contradictions in: ${evaluation.contradictions.map(c => c.description).join("; ")}`;
  } else {
    synthesizedConclusion = `[Partial convergence] ${conclusions[0] || "Further evidence needed on " + frame.topic}`;
  }

  // ── Proposed DTUs (tagged "hlr_output") ──
  const proposedDTUs = [];

  // Main conclusion DTU
  proposedDTUs.push({
    id: uid("hlr"),
    title: `HLR Conclusion: ${(frame.topic || "").slice(0, 100)}`,
    content: synthesizedConclusion,
    tier: evaluation.confidence > 0.6 ? "regular" : "shadow",
    tags: ["hlr_output", "reasoning", frame.primaryDomain, `mode:${chains[0]?.mode || "mixed"}`],
    source: "hlr-engine",
    core: {
      claims: conclusions.slice(0, 5),
      definitions: [],
      invariants: [],
      examples: [],
      nextActions: [],
    },
    confidence: evaluation.confidence,
    machine: {
      kind: "hlr_conclusion",
      convergence: evaluation.convergence,
      novelty: evaluation.novelty,
      chainCount: chains.length,
      contradictionCount: evaluation.contradictionCount,
    },
    createdAt: nowISO(),
    updatedAt: nowISO(),
  });

  // Per-chain insight DTUs for chains with confidence > 0.4
  for (const chain of chains) {
    if (chain.confidence > 0.4 && chain.conclusion) {
      proposedDTUs.push({
        id: uid("hlr"),
        title: `HLR ${chain.mode}: ${(chain.conclusion || "").slice(0, 80)}`,
        content: chain.conclusion,
        tier: "shadow",
        tags: ["hlr_output", "reasoning", `mode:${chain.mode}`, frame.primaryDomain],
        source: "hlr-engine",
        core: {
          claims: [chain.conclusion],
          definitions: [],
          invariants: [],
          examples: [],
          nextActions: [],
        },
        confidence: chain.confidence,
        machine: {
          kind: "hlr_chain_output",
          mode: chain.mode,
          stepCount: chain.stepCount,
          chainId: chain.chainId,
        },
        createdAt: nowISO(),
        updatedAt: nowISO(),
      });
    }
  }

  // ── Open questions ──
  const openQuestions = [];

  // From unknowns
  for (const unknown of frame.unknowns) {
    if (unknown.type !== "none_detected") {
      openQuestions.push({
        type: unknown.type,
        question: `Investigate: ${unknown.description}`,
        priority: unknown.type === "no_evidence" ? 0.9 : 0.6,
      });
    }
  }

  // From contradictions
  for (const contradiction of evaluation.contradictions) {
    openQuestions.push({
      type: "contradiction",
      question: `Resolve disagreement between ${contradiction.modeA} and ${contradiction.modeB}: ${contradiction.description}`,
      priority: 0.8,
    });
  }

  // From low-confidence chains
  for (const chain of chains) {
    if (chain.confidence < 0.35) {
      openQuestions.push({
        type: "low_confidence",
        question: `Strengthen ${chain.mode} reasoning about "${frame.topic}" — current confidence is only ${chain.confidence.toFixed(2)}`,
        priority: 0.5,
      });
    }
  }

  // From temporal and counterfactual insights
  if (chains.some(c => c.mode === REASONING_MODES.TEMPORAL)) {
    openQuestions.push({
      type: "temporal_verification",
      question: `Verify temporal projections for "${frame.topic}" against empirical data`,
      priority: 0.4,
    });
  }

  return {
    synthesizedConclusion,
    proposedDTUs,
    openQuestions,
    evaluation,
  };
}

// ═══════════════════════════════════════════════════════════════════════════════
// MAIN ENTRY POINT
// ═══════════════════════════════════════════════════════════════════════════════

/**
 * Run the full HLR pipeline.
 *
 * @param {object} input
 * @param {string} input.topic - The subject of reasoning
 * @param {string} [input.question] - Specific question to answer
 * @param {object} [input.context] - Additional context
 * @param {object[]} [input.relatedDTUs] - DTUs to reason over
 * @param {number} [input.depth] - Reasoning depth 1-5 (default 3)
 * @param {string} [input.mode] - Primary reasoning mode (default "deductive")
 * @returns {object} Full HLR result with trace, proposed DTUs, open questions
 */
export function runHLR(input = {}) {
  const startTime = Date.now();
  const traceId = uid("hlr_trace");

  try {
    if (!input.topic && !input.question) {
      return { ok: false, error: "topic_or_question_required" };
    }

    const mode = (input.mode || REASONING_MODES.DEDUCTIVE).toLowerCase();
    if (!ALL_MODES.includes(mode) && mode !== "") {
      return { ok: false, error: "invalid_mode", allowed: ALL_MODES };
    }

    const depth = Math.max(1, Math.min(5, Number(input.depth) || 3));

    // Step 1: Frame
    const frame = frameReasoning(input);

    // Step 2: Generate chains (minimum 3)
    const chains = generateChains(frame, mode, depth);

    // Step 3: Evaluate
    const evaluation = evaluateChains(chains, frame);

    // Step 4: Synthesize output
    const output = synthesizeOutput(frame, chains, evaluation);

    const elapsedMs = Date.now() - startTime;

    // Build full trace
    const trace = {
      traceId,
      input: {
        topic: input.topic || null,
        question: input.question || null,
        mode,
        depth,
        relatedDTUCount: (input.relatedDTUs || []).length,
      },
      frame: {
        primaryDomain: frame.primaryDomain,
        assumptions: frame.assumptions,
        evidenceCount: frame.evidenceCount,
        unknowns: frame.unknowns,
        tagPool: frame.tagPool,
      },
      chains: chains.map(c => ({
        chainId: c.chainId,
        mode: c.mode,
        stepCount: c.stepCount,
        confidence: c.confidence,
        conclusion: c.conclusion,
        steps: c.steps,
      })),
      evaluation,
      output: {
        synthesizedConclusion: output.synthesizedConclusion,
        proposedDTUCount: output.proposedDTUs.length,
        openQuestionCount: output.openQuestions.length,
      },
      timing: { elapsedMs },
      createdAt: nowISO(),
    };

    // Store trace
    _traces.set(traceId, trace);

    // Cap stored traces
    if (_traces.size > 500) {
      const keys = Array.from(_traces.keys());
      for (let i = 0; i < keys.length - 250; i++) {
        _traces.delete(keys[i]);
      }
    }

    // Update metrics
    _metrics.totalRuns++;
    _metrics.totalChains += chains.length;
    _metrics.proposedDTUs += output.proposedDTUs.length;
    _metrics.openQuestions += output.openQuestions.length;

    // Running averages
    _metrics.avgConfidence = runningAvg(_metrics.avgConfidence, evaluation.confidence, _metrics.totalRuns);
    _metrics.avgConvergence = runningAvg(_metrics.avgConvergence, evaluation.convergence, _metrics.totalRuns);
    _metrics.avgNovelty = runningAvg(_metrics.avgNovelty, evaluation.novelty, _metrics.totalRuns);

    // Mode counts
    for (const chain of chains) {
      _metrics.byMode[chain.mode] = (_metrics.byMode[chain.mode] || 0) + 1;
    }

    return {
      ok: true,
      traceId,
      synthesizedConclusion: output.synthesizedConclusion,
      proposedDTUs: output.proposedDTUs,
      openQuestions: output.openQuestions,
      evaluation: {
        convergence: evaluation.convergence,
        confidence: evaluation.confidence,
        novelty: evaluation.novelty,
        contradictionCount: evaluation.contradictionCount,
        summary: evaluation.summary,
      },
      chains: chains.map(c => ({
        chainId: c.chainId,
        mode: c.mode,
        confidence: c.confidence,
        conclusion: c.conclusion,
        stepCount: c.stepCount,
      })),
      frame: {
        primaryDomain: frame.primaryDomain,
        assumptionCount: frame.assumptions.length,
        evidenceCount: frame.evidenceCount,
        unknownCount: frame.unknowns.length,
      },
      timing: { elapsedMs },
    };
  } catch (_) {
    // Silent failure
    return { ok: false, error: "hlr_internal_error", traceId };
  }
}

// ═══════════════════════════════════════════════════════════════════════════════
// QUERY FUNCTIONS
// ═══════════════════════════════════════════════════════════════════════════════

/**
 * Get a full reasoning trace by ID.
 *
 * @param {string} traceId
 * @returns {object|null} The full trace or null
 */
export function getReasoningTrace(traceId) {
  if (!traceId) return null;
  return _traces.get(traceId) || null;
}

/**
 * List recent reasoning traces.
 *
 * @param {number} [limit=20] - Maximum traces to return
 * @returns {object[]} Array of trace summaries
 */
export function listTraces(limit = 20) {
  const cap = Math.max(1, Math.min(100, Number(limit) || 20));
  const all = Array.from(_traces.values());

  // Most recent first
  all.sort((a, b) => {
    const ta = new Date(a.createdAt).getTime();
    const tb = new Date(b.createdAt).getTime();
    return tb - ta;
  });

  return all.slice(0, cap).map(t => ({
    traceId: t.traceId,
    userId: t.input?.userId || null,
    topic: t.input?.topic || null,
    question: t.input?.question || null,
    mode: t.input?.mode || null,
    primaryDomain: t.frame?.primaryDomain || null,
    chainCount: t.chains?.length || 0,
    convergence: t.evaluation?.convergence || 0,
    confidence: t.evaluation?.confidence || 0,
    novelty: t.evaluation?.novelty || 0,
    synthesizedConclusion: t.output?.synthesizedConclusion || null,
    proposedDTUCount: t.output?.proposedDTUCount || 0,
    openQuestionCount: t.output?.openQuestionCount || 0,
    createdAt: t.createdAt,
    elapsedMs: t.timing?.elapsedMs || 0,
  }));
}

/**
 * Get HLR engine metrics.
 *
 * @returns {object} Metrics snapshot
 */
export function getHLRMetrics() {
  return {
    ok: true,
    totalRuns: _metrics.totalRuns,
    totalChains: _metrics.totalChains,
    avgConfidence: Math.round(_metrics.avgConfidence * 1000) / 1000,
    avgConvergence: Math.round(_metrics.avgConvergence * 1000) / 1000,
    avgNovelty: Math.round(_metrics.avgNovelty * 1000) / 1000,
    proposedDTUs: _metrics.proposedDTUs,
    openQuestions: _metrics.openQuestions,
    byMode: { ..._metrics.byMode },
    storedTraces: _traces.size,
    reasoningModes: ALL_MODES,
  };
}

/**
 * Get recent HLR findings for cross-system integration.
 * Returns traces that have proposed DTUs or patterns, sorted by recency.
 *
 * @param {number} [limit=20] - Max findings to return
 * @returns {Array} Recent findings with conclusions and patterns
 */
export function getRecentFindings(limit = 20) {
  try {
    const all = Array.from(_traces.values());
    all.sort((a, b) => new Date(b.startedAt || 0).getTime() - new Date(a.startedAt || 0).getTime());
    return all.slice(0, limit).map(t => ({
      traceId: t.traceId,
      topic: t.topic,
      domain: t.domain,
      conclusion: t.conclusion || null,
      summary: t.summary || null,
      patterns: t.patterns || [],
      proposedDTUs: t.proposedDTUs || [],
      confidence: t.confidence || 0,
      startedAt: t.startedAt,
      _hypothesized: t._hypothesized || false,
    }));
  } catch {
    return [];
  }
}

// ═══════════════════════════════════════════════════════════════════════════════
// CHAIN GENERATION HELPERS
// ═══════════════════════════════════════════════════════════════════════════════

/**
 * Derive conclusions by combining premises.
 */
function deriveFromPremises(premises, frame, stepIndex) {
  const derived = [];

  if (premises.length >= 2) {
    derived.push(
      `From "${truncate(premises[0].text, 60)}" and "${truncate(premises[Math.min(1, premises.length - 1)].text, 60)}", ` +
      `it follows that ${frame.topic} exhibits the properties described`
    );
  }

  if (premises.length >= 3 && stepIndex > 1) {
    derived.push(
      `Combining ${premises.length} premises strengthens the claim that ${frame.topic} is consistent with the evidence base`
    );
  }

  if (derived.length === 0) {
    derived.push(`Deductive step ${stepIndex}: insufficient premises for strong derivation about ${frame.topic}`);
  }

  return derived;
}

/**
 * Identify patterns across observations.
 */
function identifyPatterns(observations, domain) {
  const patterns = [];
  const claimTexts = observations.map(o => (o.claim || "").toLowerCase());

  // Check for recurring terms
  const termFreq = new Map();
  for (const text of claimTexts) {
    const words = text.split(/\s+/).filter(w => w.length > 4);
    for (const w of words) {
      termFreq.set(w, (termFreq.get(w) || 0) + 1);
    }
  }

  const recurring = Array.from(termFreq.entries())
    .filter(([, count]) => count > 1)
    .sort((a, b) => b[1] - a[1])
    .slice(0, 3);

  for (const [term, count] of recurring) {
    patterns.push(`Recurring concept "${term}" appears in ${count}/${observations.length} observations`);
  }

  // Domain-specific pattern matching
  const domainPatterns = DOMAIN_ANALOGIES[domain]?.patterns || [];
  for (const dp of domainPatterns) {
    if (claimTexts.some(t => t.includes(dp.toLowerCase()))) {
      patterns.push(`Domain pattern "${dp}" detected in observations`);
    }
  }

  if (patterns.length === 0) {
    patterns.push(`No strong recurring pattern detected across ${observations.length} observations`);
  }

  return patterns;
}

/**
 * Generalize a pattern to broader scope.
 */
function generalizePattern(patterns, frame, level) {
  const patternText = patterns[0] || "";
  if (level <= 2) {
    return `Generalization: the pattern "${truncate(patternText, 80)}" may extend beyond the observed cases in ${frame.primaryDomain}`;
  }
  return `Broad generalization: if the pattern holds universally, ${frame.topic} represents a general principle rather than a domain-specific observation`;
}

/**
 * Find anomalies in the evidence pool.
 */
function findAnomalies(frame) {
  const anomalies = [];

  // Low-confidence claims alongside high-confidence ones
  const highConf = frame.claimPool.filter(c => c.confidence > 0.7);
  const lowConf = frame.claimPool.filter(c => c.confidence < 0.3);

  if (highConf.length > 0 && lowConf.length > 0) {
    anomalies.push(`Confidence disparity: ${highConf.length} high-confidence claims coexist with ${lowConf.length} low-confidence claims`);
  }

  // Claims from different domains about the same topic
  const domains = new Set(frame.claimPool.map(c => c.domain).filter(Boolean));
  if (domains.size > 2) {
    anomalies.push(`Multi-domain convergence: claims about "${frame.topic}" span ${domains.size} distinct domains`);
  }

  // Unknowns as anomalies
  for (const unknown of frame.unknowns) {
    if (unknown.type === "causal_gap" || unknown.type === "temporal_gap") {
      anomalies.push(`Surprising gap: ${unknown.description}`);
    }
  }

  if (anomalies.length === 0) {
    anomalies.push(`No strong anomalies detected in evidence about "${frame.topic}"`);
  }

  return anomalies;
}

/**
 * Generate candidate explanations for anomalies.
 */
function generateExplanations(anomalies, frame) {
  const explanations = [];

  for (const anomaly of anomalies.slice(0, 3)) {
    if (anomaly.includes("confidence disparity")) {
      explanations.push(`The confidence disparity in "${frame.topic}" may indicate evolving understanding where older claims haven't been updated`);
    } else if (anomaly.includes("multi-domain")) {
      explanations.push(`Cross-domain convergence on "${frame.topic}" suggests an underlying structural principle that transcends individual domains`);
    } else if (anomaly.includes("gap")) {
      explanations.push(`The evidence gap regarding "${frame.topic}" may indicate the phenomenon operates through mechanisms not yet formalized in the knowledge base`);
    } else {
      explanations.push(`Best explanation for the anomaly: "${frame.topic}" involves latent variables not captured by current evidence`);
    }
  }

  if (explanations.length === 0) {
    explanations.push(`No compelling abductive explanation required — "${frame.topic}" is consistent with available evidence`);
  }

  return explanations;
}

/**
 * Evaluate a candidate explanation against evidence.
 */
function evaluateExplanation(explanation, frame) {
  const supportingCount = frame.evidence.filter(e => {
    const sim = textSimilarity(explanation, e.claim || "");
    return sim > 0.15;
  }).length;

  const supportRatio = frame.evidenceCount > 0 ? supportingCount / frame.evidenceCount : 0;
  const delta = clamp01(supportRatio * 0.15) - 0.02;

  return {
    assessment: `Explanation supported by ${supportingCount}/${frame.evidenceCount} evidence items (${(supportRatio * 100).toFixed(0)}%)`,
    delta,
    revised: supportRatio < 0.2
      ? `Revised: ${explanation} (weak support — requires additional evidence)`
      : null,
  };
}

/**
 * Negate a position for adversarial analysis.
 */
function negatePosition(position) {
  const lower = position.toLowerCase();
  if (lower.includes(" is ")) {
    return position.replace(/ is /i, " is not ");
  }
  if (lower.includes(" are ")) {
    return position.replace(/ are /i, " are not ");
  }
  if (lower.includes(" can ")) {
    return position.replace(/ can /i, " cannot ");
  }
  return `The opposite of: "${truncate(position, 120)}"`;
}

/**
 * Find weaknesses in the current evidence framing.
 */
function findWeaknesses(frame) {
  const weaknesses = [];

  // Low evidence count
  if (frame.evidenceCount < 3) {
    weaknesses.push(`Thin evidence base: only ${frame.evidenceCount} supporting claim(s)`);
  }

  // Reliance on single domain
  if (Object.keys(frame.domainHits).length <= 1) {
    weaknesses.push("Single-domain evidence — no cross-domain corroboration");
  }

  // Low average confidence
  const avgConf = frame.claimPool.length > 0
    ? frame.claimPool.reduce((s, c) => s + c.confidence, 0) / frame.claimPool.length
    : 0;
  if (avgConf < 0.5) {
    weaknesses.push(`Low average claim confidence: ${avgConf.toFixed(2)}`);
  }

  // Ungrounded assumptions
  const ungFoundedAssumptions = frame.assumptions.filter(a => a.type === "conditional" || a.type === "normative");
  if (ungFoundedAssumptions.length > 0) {
    weaknesses.push(`${ungFoundedAssumptions.length} unverified assumption(s): ${ungFoundedAssumptions.map(a => a.text).join("; ")}`);
  }

  if (weaknesses.length === 0) {
    weaknesses.push("No critical weaknesses detected — evidence base appears sound");
  }

  return weaknesses;
}

/**
 * Stress-test a weakness.
 */
function stressTest(weaknesses, frame, round) {
  const weakness = weaknesses[round % weaknesses.length] || weaknesses[0] || "unspecified";

  // Simulate stress resilience based on evidence quantity
  const resilience = clamp01(frame.evidenceCount * 0.1 + (frame.claimPool.length > 3 ? 0.1 : 0));
  const delta = resilience > 0.3 ? 0.03 : -0.05;

  return {
    result: `Stress-test round ${round}: "${truncate(weakness, 80)}" — evidence resilience ${resilience > 0.3 ? "adequate" : "inadequate"}`,
    delta,
  };
}

/**
 * Project a temporal phase.
 */
function projectPhase(frame, phase, index) {
  const topic = frame.topic;
  switch (phase) {
    case "emergence":
      return `"${topic}" first appears as a novel observation or hypothesis within ${frame.primaryDomain}`;
    case "growth":
      return `"${topic}" gains traction: evidence accumulates, related claims multiply, cross-domain interest begins`;
    case "plateau":
      return `"${topic}" reaches consensus: core claims stabilize, confidence peaks, integration into accepted knowledge`;
    case "disruption":
      return `"${topic}" faces challenge: new evidence or competing framework undermines established claims`;
    case "adaptation":
      return `"${topic}" evolves: core ideas are revised to incorporate disruptive findings, new synthesis emerges`;
    case "stabilization":
      return `"${topic}" re-stabilizes at a new equilibrium incorporating lessons from disruption cycle`;
    default:
      return `"${topic}" enters phase ${index + 1}: trajectory uncertain`;
  }
}

/**
 * Trace cascading effects of a counterfactual change.
 */
function traceCascade(frame, keyVariable, level) {
  if (level === 1) {
    return `If "${truncate(keyVariable, 60)}" were different, the ${frame.claimPool.length} directly related claims would need re-evaluation`;
  }
  if (level === 2) {
    return `Second-order effect: domains ${Object.keys(frame.domainHits).join(", ") || frame.primaryDomain} would require updated models`;
  }
  if (level === 3) {
    return `Third-order effect: cross-domain knowledge built on "${frame.topic}" becomes uncertain, potentially affecting ${frame.tagPool.length} related concepts`;
  }
  return `Higher-order cascade (level ${level}): effects become increasingly speculative and difficult to predict`;
}

/**
 * Check for conceptual overlap between two pattern strings.
 */
function conceptualOverlap(a, b) {
  const tokA = tokenize(a);
  const tokB = tokenize(b);
  let shared = 0;
  for (const t of tokA) {
    if (tokB.has(t)) shared++;
  }
  return shared > 0;
}

/**
 * Synthesize a conclusion from multiple claim strings.
 */
function synthesizeClaims(claims, topic) {
  if (claims.length === 0) return `No sufficient basis to conclude about "${topic}"`;

  const unique = [...new Set(claims)];
  if (unique.length === 1) return unique[0];

  return `Synthesis of ${unique.length} claims regarding "${topic}": the evidence converges on the properties described in the premise set`;
}

/**
 * Detect disagreement between two chains.
 */
function detectDisagreement(chainA, chainB) {
  if (!chainA.conclusion || !chainB.conclusion) return null;

  const similarity = textSimilarity(chainA.conclusion, chainB.conclusion);

  // Low similarity + one says "not" or "weakness" or "vulnerability"
  if (similarity < 0.2) {
    const aHasNeg = /\b(not|no|cannot|never|fail|weakness|vulnerab|inadequate|low)\b/i.test(chainA.conclusion);
    const bHasNeg = /\b(not|no|cannot|never|fail|weakness|vulnerab|inadequate|low)\b/i.test(chainB.conclusion);

    if (aHasNeg !== bHasNeg) {
      return `${chainA.mode} and ${chainB.mode} chains reach opposing conclusions (similarity ${similarity.toFixed(2)})`;
    }
  }

  // Confidence divergence
  if (Math.abs((chainA.confidence || 0) - (chainB.confidence || 0)) > 0.3) {
    return `${chainA.mode} (conf ${(chainA.confidence || 0).toFixed(2)}) and ${chainB.mode} (conf ${(chainB.confidence || 0).toFixed(2)}) show significant confidence divergence`;
  }

  return null;
}

// ═══════════════════════════════════════════════════════════════════════════════
// GENERIC HELPERS
// ═══════════════════════════════════════════════════════════════════════════════

/**
 * Tokenize text for similarity computations.
 */
function tokenize(text) {
  return new Set(
    String(text || "")
      .toLowerCase()
      .replace(/[^\w\s]/g, " ")
      .split(/\s+/)
      .filter(w => w.length > 2)
  );
}

/**
 * Jaccard-based text similarity.
 */
function textSimilarity(a, b) {
  const tokA = tokenize(a);
  const tokB = tokenize(b);
  if (tokA.size === 0 && tokB.size === 0) return 1;
  if (tokA.size === 0 || tokB.size === 0) return 0;

  let intersection = 0;
  for (const t of tokA) {
    if (tokB.has(t)) intersection++;
  }
  const union = tokA.size + tokB.size - intersection;
  return union > 0 ? intersection / union : 0;
}

/**
 * Average confidence across an array of objects with { confidence }.
 */
function avgConfidence(items) {
  if (!items || items.length === 0) return 0;
  return clamp01(items.reduce((s, i) => s + (i.confidence || 0), 0) / items.length);
}

/**
 * Incremental running average.
 */
function runningAvg(prev, newVal, count) {
  if (count <= 1) return newVal;
  return prev + (newVal - prev) / count;
}

/**
 * Truncate text to a max length.
 */
function truncate(text, maxLen) {
  const s = String(text || "");
  return s.length > maxLen ? s.slice(0, maxLen) + "..." : s;
}
