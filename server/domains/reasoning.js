// server/domains/reasoning.js
//
// Reasoning lens backend. Two families of macros:
//   1. Stateless analysis engines (logicValidate, argumentMap, fallacyDetect,
//      premiseExtract) — pure-compute over the generic artifact store.
//   2. Persistent argument-map substrate — per-user maps with pro/con
//      branching, evidence linking + strength weighting, multi-author
//      collaboration, conclusion scoring, outline/markdown export, and a
//      built-in library of reasoning schemes. State lives in
//      `globalThis._concordSTATE.reasoningLens`, keyed by userId.
//
// 2026 parity target: Rationale / Kialo (visual argument mapping).

export default function registerReasoningActions(registerLensAction) {
  /* ================================================================ */
  /*  Stateless analysis engines                                       */
  /* ================================================================ */

  registerLensAction("reasoning", "logicValidate", (ctx, artifact, _params) => {
    const premises = artifact.data?.premises || [];
    const conclusion = artifact.data?.conclusion || "";
    if (premises.length === 0) return { ok: true, result: { message: "Provide premises and a conclusion to validate." } };
    const contradictions = [];
    const normalized = premises.map(p => p.toLowerCase().trim());
    for (let i = 0; i < normalized.length; i++) {
      for (let j = i + 1; j < normalized.length; j++) {
        const a = normalized[i];
        const b = normalized[j];
        if ((a.includes("not") && b === a.replace(/\bnot\b\s*/g, "").trim()) ||
            (b.includes("not") && a === b.replace(/\bnot\b\s*/g, "").trim()) ||
            (a.includes("all") && b.includes("no") && a.replace("all", "").trim() === b.replace("no", "").trim()) ||
            (a.includes("always") && b.includes("never") && a.replace("always", "").trim() === b.replace("never", "").trim())) {
          contradictions.push({ premise1: premises[i], premise2: premises[j], type: "negation-contradiction" });
        }
      }
    }
    const conclusionTerms = conclusion.toLowerCase().split(/\s+/).filter(w => w.length > 3);
    const premiseTerms = normalized.join(" ").split(/\s+/).filter(w => w.length > 3);
    const supportedTerms = conclusionTerms.filter(t => premiseTerms.includes(t));
    const unsupportedTerms = conclusionTerms.filter(t => !premiseTerms.includes(t));
    const support = conclusionTerms.length > 0 ? Math.round((supportedTerms.length / conclusionTerms.length) * 100) : 0;
    return { ok: true, result: { premiseCount: premises.length, conclusion, contradictions, hasContradictions: contradictions.length > 0, termSupport: support, supportedTerms, unsupportedTerms, validity: contradictions.length > 0 ? "invalid-contradictions" : support > 70 ? "likely-valid" : support > 40 ? "partially-supported" : "weak-support", recommendation: contradictions.length > 0 ? "Resolve contradictions before proceeding" : support < 50 ? "Conclusion introduces terms not found in premises — may be an unsupported leap" : "Argument structure appears sound" } };
  });

  registerLensAction("reasoning", "argumentMap", (ctx, artifact, _params) => {
    const claims = artifact.data?.claims || [];
    if (claims.length === 0) return { ok: true, result: { message: "Provide claims with support/counter relationships." } };
    const nodes = claims.map((c, i) => ({
      id: c.id || `claim-${i}`, text: c.text || c.claim || "", type: c.type || "claim",
      supports: c.supports || [], counters: c.counters || [],
    }));
    const strengthMap = {};
    nodes.forEach(n => {
      const supportCount = nodes.filter(o => o.supports.includes(n.id)).length;
      const counterCount = nodes.filter(o => o.counters.includes(n.id)).length;
      strengthMap[n.id] = { support: supportCount, counter: counterCount, net: supportCount - counterCount, strength: Math.max(0, Math.min(100, 50 + (supportCount - counterCount) * 15)) };
    });
    const rootClaims = nodes.filter(n => !nodes.some(o => o.supports.includes(n.id) || o.counters.includes(n.id)) || n.type === "thesis");
    return { ok: true, result: { totalClaims: nodes.length, rootClaims: rootClaims.map(r => r.id), strengthMap, strongestClaim: Object.entries(strengthMap).sort((a, b) => b[1].strength - a[1].strength)[0]?.[0], weakestClaim: Object.entries(strengthMap).sort((a, b) => a[1].strength - b[1].strength)[0]?.[0], uncontested: nodes.filter(n => strengthMap[n.id].counter === 0).map(n => n.id), contested: nodes.filter(n => strengthMap[n.id].counter > 0).map(n => n.id) } };
  });

  registerLensAction("reasoning", "fallacyDetect", (ctx, artifact, _params) => {
    const text = artifact.data?.text || artifact.data?.argument || "";
    if (!text) return { ok: true, result: { message: "Provide argument text to check for fallacies." } };
    const lower = text.toLowerCase();
    const fallacyPatterns = [
      { name: "Ad Hominem", patterns: ["you're just", "you are just", "what do you know", "someone like you", "you always", "you never", "of course you would say"], description: "Attacking the person rather than their argument" },
      { name: "Straw Man", patterns: ["so you're saying", "what you really mean", "you think that", "basically you want"], description: "Misrepresenting someone's argument to attack it" },
      { name: "False Dichotomy", patterns: ["either you", "you're either", "it's either", "only two options", "there are only two", "you must choose between"], description: "Presenting only two options when more exist" },
      { name: "Appeal to Authority", patterns: ["experts say", "studies show", "everyone knows", "scientists agree", "it is well known"], description: "Citing authority without specific evidence" },
      { name: "Slippery Slope", patterns: ["next thing you know", "before you know it", "this will lead to", "eventually", "where does it end", "if we allow"], description: "Assuming one event inevitably leads to extreme consequences" },
      { name: "Appeal to Emotion", patterns: ["think of the children", "how would you feel", "imagine if", "doesn't it make you angry", "the right thing to do"], description: "Using emotion rather than logic" },
      { name: "Bandwagon", patterns: ["everyone is doing", "most people", "majority of people", "popular opinion", "everyone agrees", "nobody thinks"], description: "Arguing something is true because many believe it" },
      { name: "Circular Reasoning", patterns: ["because it is", "it's true because", "the reason is because", "obviously true"], description: "Using the conclusion as a premise" },
    ];
    const detected = [];
    fallacyPatterns.forEach(f => {
      const matches = f.patterns.filter(p => lower.includes(p));
      if (matches.length > 0) detected.push({ fallacy: f.name, description: f.description, matchedPatterns: matches, severity: matches.length > 1 ? "high" : "moderate" });
    });
    return { ok: true, result: { textLength: text.length, fallaciesDetected: detected.length, fallacies: detected, overallAssessment: detected.length === 0 ? "No obvious fallacies detected" : detected.length <= 2 ? "Minor logical issues found" : "Multiple fallacies detected — argument needs restructuring", logicalStrength: Math.max(0, 100 - detected.length * 20) } };
  });

  registerLensAction("reasoning", "premiseExtract", (ctx, artifact, _params) => {
    const text = artifact.data?.text || artifact.data?.argument || "";
    if (!text) return { ok: true, result: { message: "Provide argument text to extract premises." } };
    const sentences = text.split(/[.!?]+/).map(s => s.trim()).filter(s => s.length > 5);
    const premiseIndicators = ["because", "since", "given that", "as", "for", "whereas", "considering", "due to", "based on", "the fact that"];
    const conclusionIndicators = ["therefore", "thus", "hence", "so", "consequently", "it follows", "we can conclude", "this means", "this shows", "proves that"];
    const normativeIndicators = ["should", "must", "ought", "need to", "have to", "right to", "wrong to", "obligated"];
    const factualIndicators = ["is", "are", "was", "were", "has been", "data shows", "research", "study", "evidence", "found that", "measured"];
    const classified = sentences.map(s => {
      const lower = s.toLowerCase();
      const isPremise = premiseIndicators.some(p => lower.includes(p));
      const isConclusion = conclusionIndicators.some(p => lower.includes(p));
      const isNormative = normativeIndicators.some(p => lower.includes(p));
      const isFactual = factualIndicators.some(p => lower.includes(p));
      return {
        text: s,
        role: isConclusion ? "conclusion" : isPremise ? "premise" : "statement",
        type: isNormative ? "normative" : isFactual ? "factual" : "definitional",
      };
    });
    const premises = classified.filter(c => c.role === "premise");
    const conclusions = classified.filter(c => c.role === "conclusion");
    return { ok: true, result: { totalSentences: sentences.length, premises: premises.length, conclusions: conclusions.length, statements: classified.filter(c => c.role === "statement").length, classified, premiseTypes: { factual: premises.filter(p => p.type === "factual").length, normative: premises.filter(p => p.type === "normative").length, definitional: premises.filter(p => p.type === "definitional").length } } };
  });

  /* ================================================================ */
  /*  Persistent argument-map substrate                                */
  /* ================================================================ */

  function getState() {
    const STATE = globalThis._concordSTATE;
    if (!STATE) return null;
    if (!STATE.reasoningLens) {
      STATE.reasoningLens = {
        maps: new Map(), // userId -> Map<mapId, ArgumentMapDoc>
      };
    }
    return STATE.reasoningLens;
  }
  function saveState() {
    if (typeof globalThis._concordSaveStateDebounced === "function") {
      try { globalThis._concordSaveStateDebounced(); } catch (_e) { /* best effort */ }
    }
  }
  function actorId(ctx) { return ctx?.actor?.userId || ctx?.userId || "anon"; }
  function actorName(ctx) {
    return ctx?.actor?.displayName || ctx?.actor?.username || ctx?.displayName || actorId(ctx);
  }
  function nextId(prefix) { return `${prefix}_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`; }
  function nowIso() { return new Date().toISOString(); }

  function userMaps(s, userId) {
    if (!s.maps.has(userId)) s.maps.set(userId, new Map());
    return s.maps.get(userId);
  }

  // Locate a map a user can see: their own, or one they collaborate on.
  function findMap(s, userId, mapId) {
    const own = s.maps.get(userId);
    if (own && own.has(mapId)) return { map: own.get(mapId), ownerId: userId };
    for (const [ownerId, maps] of s.maps.entries()) {
      const m = maps.get(mapId);
      if (m && Array.isArray(m.collaborators) && m.collaborators.includes(userId)) {
        return { map: m, ownerId };
      }
    }
    return null;
  }

  function findNode(nodes, nodeId) {
    for (const n of nodes) {
      if (n.id === nodeId) return n;
      const f = findNode(n.children, nodeId);
      if (f) return f;
    }
    return null;
  }
  function removeNode(nodes, nodeId) {
    for (let i = 0; i < nodes.length; i++) {
      if (nodes[i].id === nodeId) { nodes.splice(i, 1); return true; }
      if (removeNode(nodes[i].children, nodeId)) return true;
    }
    return false;
  }
  function walk(nodes, fn) {
    for (const n of nodes) { fn(n); walk(n.children, fn); }
  }

  // Reasoning-scheme library — common argument schemes (analogy, causal, …).
  const SCHEMES = [
    { id: "syllogism", name: "Classical Syllogism", category: "deductive",
      description: "Major premise, minor premise, conclusion. The basis of formal logic.",
      slots: ["Major Premise", "Minor Premise", "Conclusion"],
      criticalQuestions: ["Is the major premise actually universal?", "Does the minor premise truly fall under the major?"] },
    { id: "analogy", name: "Argument from Analogy", category: "analogical",
      description: "If two cases are alike in relevant respects, what holds for one holds for the other.",
      slots: ["Source Case", "Target Case", "Shared Properties", "Inferred Conclusion"],
      criticalQuestions: ["Are the cases alike in relevant respects?", "Are there disanalogies that break the inference?"] },
    { id: "causal", name: "Causal Argument", category: "causal",
      description: "Establishes that one event brings about another.",
      slots: ["Proposed Cause", "Observed Effect", "Mechanism", "Conclusion"],
      criticalQuestions: ["Is there a plausible mechanism?", "Could the correlation be coincidental or reverse?"] },
    { id: "sign", name: "Argument from Sign", category: "abductive",
      description: "An observed indicator points to an underlying state of affairs.",
      slots: ["Observed Sign", "Inferred State", "Reliability of Sign"],
      criticalQuestions: ["How reliable is the sign?", "Could the sign have another cause?"] },
    { id: "authority", name: "Argument from Expert Opinion", category: "inductive",
      description: "An expert in a domain asserts a proposition within that domain.",
      slots: ["Expert", "Domain", "Asserted Claim", "Basis of Expertise"],
      criticalQuestions: ["Is the expert credible in this domain?", "Do other experts disagree?"] },
    { id: "consequences", name: "Argument from Consequences", category: "practical",
      description: "An action is judged by the desirability of its outcomes.",
      slots: ["Proposed Action", "Positive Consequences", "Negative Consequences", "Net Judgement"],
      criticalQuestions: ["Are the consequences likely?", "Have side effects been weighed fairly?"] },
    { id: "toulmin", name: "Toulmin Model", category: "structural",
      description: "Claim, grounds, warrant, backing, qualifier, rebuttal — for messy real-world arguments.",
      slots: ["Claim", "Grounds", "Warrant", "Backing", "Qualifier", "Rebuttal"],
      criticalQuestions: ["Does the warrant license the inference?", "Under what conditions does the rebuttal apply?"] },
    { id: "elimination", name: "Argument by Elimination", category: "deductive",
      description: "If all alternatives but one are ruled out, the remaining one holds.",
      slots: ["Set of Alternatives", "Eliminated Options", "Remaining Option"],
      criticalQuestions: ["Is the set of alternatives exhaustive?", "Were eliminations sound?"] },
  ];

  // Strength weights for a node (1-5 scale) and its evidence.
  function nodeBaseScore(node) {
    return Math.max(0, Math.min(1, (Number(node.strength) || 3) / 5));
  }
  // Evidence contributes credibility×relevance, normalised to 0..1.
  function evidenceScore(ev) {
    const cred = Math.max(0, Math.min(5, Number(ev.credibility) || 0));
    const rel = Math.max(0, Math.min(5, Number(ev.relevance) || 0));
    const w = Math.max(0, Math.min(5, Number(ev.weight) || 3));
    return (cred / 5) * (rel / 5) * (w / 5);
  }

  // Recursive conclusion-confidence scoring. A claim's confidence is its
  // own base strength + evidence, lifted by pro children and pulled down
  // by con children, each weighted by their own recursively scored
  // confidence. Returns { score, breakdown }.
  function scoreNode(node) {
    const base = nodeBaseScore(node);
    const evList = Array.isArray(node.evidence) ? node.evidence : [];
    const evContrib = evList.length
      ? evList.reduce((s, e) => s + evidenceScore(e), 0) / evList.length
      : 0;
    // Self score: 60% structural strength, 40% evidence backing.
    const self = evList.length ? base * 0.6 + evContrib * 0.4 : base;

    let proWeight = 0;
    let conWeight = 0;
    const childBreakdown = [];
    for (const child of node.children) {
      const cs = scoreNode(child);
      childBreakdown.push({ id: child.id, stance: child.stance, score: cs.score });
      if (child.stance === "pro") proWeight += cs.score;
      else if (child.stance === "con") conWeight += cs.score;
    }
    // Net branch pressure folded in with diminishing return.
    const net = proWeight - conWeight;
    const branchLift = net === 0 ? 0 : (net > 0 ? 1 : -1) * (1 - Math.exp(-Math.abs(net) / 2));
    let score = self + branchLift * 0.5;
    score = Math.max(0, Math.min(1, score));
    return {
      id: node.id,
      score: Math.round(score * 1000) / 1000,
      selfScore: Math.round(self * 1000) / 1000,
      evidenceCount: evList.length,
      proWeight: Math.round(proWeight * 1000) / 1000,
      conWeight: Math.round(conWeight * 1000) / 1000,
      children: childBreakdown,
    };
  }

  function countNodes(nodes) {
    let n = 0;
    walk(nodes, () => { n++; });
    return n;
  }

  function publicMap(map, ownerId) {
    return {
      id: map.id,
      title: map.title,
      rootClaim: map.rootClaim,
      scheme: map.scheme,
      status: map.status,
      ownerId,
      collaborators: map.collaborators || [],
      nodeCount: countNodes(map.nodes),
      createdAt: map.createdAt,
      updatedAt: map.updatedAt,
    };
  }

  function newNode({ text, type, stance, strength, author }) {
    return {
      id: nextId("node"),
      text: String(text || "").slice(0, 2000),
      type: type || "premise",
      stance: stance || "neutral",
      strength: Math.max(1, Math.min(5, Number(strength) || 3)),
      author: author || "anon",
      createdAt: nowIso(),
      evidence: [],
      children: [],
    };
  }

  // ── Map CRUD ──

  registerLensAction("reasoning", "map-list", (ctx, _artifact, _params = {}) => {
    try {
      const s = getState();
      if (!s) return { ok: false, error: "STATE unavailable" };
      const userId = actorId(ctx);
      const out = [];
      const own = s.maps.get(userId);
      if (own) for (const m of own.values()) out.push(publicMap(m, userId));
      // Maps shared with this user.
      for (const [ownerId, maps] of s.maps.entries()) {
        if (ownerId === userId) continue;
        for (const m of maps.values()) {
          if (Array.isArray(m.collaborators) && m.collaborators.includes(userId)) {
            out.push(publicMap(m, ownerId));
          }
        }
      }
      out.sort((a, b) => (b.updatedAt || "").localeCompare(a.updatedAt || ""));
      return { ok: true, result: { maps: out } };
    } catch (e) {
      return { ok: false, error: e instanceof Error ? e.message : String(e) };
    }
  });

  registerLensAction("reasoning", "map-create", (ctx, _artifact, params = {}) => {
    try {
      const s = getState();
      if (!s) return { ok: false, error: "STATE unavailable" };
      const userId = actorId(ctx);
      const title = String(params.title || "").trim();
      if (!title) return { ok: false, error: "title required" };
      if (title.length > 160) return { ok: false, error: "title too long (max 160)" };
      const rootClaim = String(params.rootClaim || "").trim();
      if (!rootClaim) return { ok: false, error: "rootClaim required" };
      const scheme = String(params.scheme || "free");
      const root = newNode({ text: rootClaim, type: "claim", stance: "neutral", strength: 3, author: actorName(ctx) });
      const map = {
        id: nextId("map"),
        title,
        rootClaim,
        scheme,
        status: "active",
        collaborators: [],
        nodes: [root],
        createdAt: nowIso(),
        updatedAt: nowIso(),
      };
      userMaps(s, userId).set(map.id, map);
      saveState();
      return { ok: true, result: { map: { ...publicMap(map, userId), nodes: map.nodes } } };
    } catch (e) {
      return { ok: false, error: e instanceof Error ? e.message : String(e) };
    }
  });

  registerLensAction("reasoning", "map-get", (ctx, _artifact, params = {}) => {
    try {
      const s = getState();
      if (!s) return { ok: false, error: "STATE unavailable" };
      const userId = actorId(ctx);
      const found = findMap(s, userId, String(params.mapId || ""));
      if (!found) return { ok: false, error: "map not found" };
      return { ok: true, result: { map: { ...publicMap(found.map, found.ownerId), nodes: found.map.nodes } } };
    } catch (e) {
      return { ok: false, error: e instanceof Error ? e.message : String(e) };
    }
  });

  registerLensAction("reasoning", "map-update", (ctx, _artifact, params = {}) => {
    try {
      const s = getState();
      if (!s) return { ok: false, error: "STATE unavailable" };
      const userId = actorId(ctx);
      const own = s.maps.get(userId);
      const map = own && own.get(String(params.mapId || ""));
      if (!map) return { ok: false, error: "map not found (owner only)" };
      if (typeof params.title === "string") {
        const t = params.title.trim();
        if (!t) return { ok: false, error: "title cannot be empty" };
        map.title = t.slice(0, 160);
      }
      if (typeof params.status === "string") {
        if (!["active", "draft", "concluded", "archived"].includes(params.status)) {
          return { ok: false, error: "invalid status" };
        }
        map.status = params.status;
      }
      map.updatedAt = nowIso();
      saveState();
      return { ok: true, result: { map: publicMap(map, userId) } };
    } catch (e) {
      return { ok: false, error: e instanceof Error ? e.message : String(e) };
    }
  });

  registerLensAction("reasoning", "map-delete", (ctx, _artifact, params = {}) => {
    try {
      const s = getState();
      if (!s) return { ok: false, error: "STATE unavailable" };
      const userId = actorId(ctx);
      const own = s.maps.get(userId);
      const id = String(params.mapId || "");
      if (!own || !own.has(id)) return { ok: false, error: "map not found (owner only)" };
      own.delete(id);
      saveState();
      return { ok: true, result: { deleted: id } };
    } catch (e) {
      return { ok: false, error: e instanceof Error ? e.message : String(e) };
    }
  });

  // ── Node CRUD — visual tree + pro/con branching ──

  registerLensAction("reasoning", "node-add", (ctx, _artifact, params = {}) => {
    try {
      const s = getState();
      if (!s) return { ok: false, error: "STATE unavailable" };
      const userId = actorId(ctx);
      const found = findMap(s, userId, String(params.mapId || ""));
      if (!found) return { ok: false, error: "map not found" };
      const text = String(params.text || "").trim();
      if (!text) return { ok: false, error: "text required" };
      const parentId = String(params.parentId || "");
      const parent = parentId ? findNode(found.map.nodes, parentId) : null;
      if (parentId && !parent) return { ok: false, error: "parent node not found" };
      const stance = ["pro", "con", "neutral"].includes(params.stance) ? params.stance : "neutral";
      const type = String(params.type || (stance === "con" ? "objection" : "premise"));
      const node = newNode({ text, type, stance, strength: params.strength, author: actorName(ctx) });
      if (parent) parent.children.push(node);
      else found.map.nodes.push(node);
      found.map.updatedAt = nowIso();
      saveState();
      return { ok: true, result: { node, mapId: found.map.id } };
    } catch (e) {
      return { ok: false, error: e instanceof Error ? e.message : String(e) };
    }
  });

  registerLensAction("reasoning", "node-update", (ctx, _artifact, params = {}) => {
    try {
      const s = getState();
      if (!s) return { ok: false, error: "STATE unavailable" };
      const userId = actorId(ctx);
      const found = findMap(s, userId, String(params.mapId || ""));
      if (!found) return { ok: false, error: "map not found" };
      const node = findNode(found.map.nodes, String(params.nodeId || ""));
      if (!node) return { ok: false, error: "node not found" };
      if (typeof params.text === "string") {
        const t = params.text.trim();
        if (!t) return { ok: false, error: "text cannot be empty" };
        node.text = t.slice(0, 2000);
      }
      if (typeof params.type === "string") node.type = params.type;
      if (["pro", "con", "neutral"].includes(params.stance)) node.stance = params.stance;
      if (params.strength != null) node.strength = Math.max(1, Math.min(5, Number(params.strength) || 3));
      found.map.updatedAt = nowIso();
      saveState();
      return { ok: true, result: { node } };
    } catch (e) {
      return { ok: false, error: e instanceof Error ? e.message : String(e) };
    }
  });

  registerLensAction("reasoning", "node-delete", (ctx, _artifact, params = {}) => {
    try {
      const s = getState();
      if (!s) return { ok: false, error: "STATE unavailable" };
      const userId = actorId(ctx);
      const found = findMap(s, userId, String(params.mapId || ""));
      if (!found) return { ok: false, error: "map not found" };
      const nodeId = String(params.nodeId || "");
      if (found.map.nodes.length && found.map.nodes[0].id === nodeId) {
        return { ok: false, error: "cannot delete the root claim" };
      }
      if (!removeNode(found.map.nodes, nodeId)) return { ok: false, error: "node not found" };
      found.map.updatedAt = nowIso();
      saveState();
      return { ok: true, result: { deleted: nodeId } };
    } catch (e) {
      return { ok: false, error: e instanceof Error ? e.message : String(e) };
    }
  });

  // ── Evidence linking with strength weighting ──

  registerLensAction("reasoning", "evidence-attach", (ctx, _artifact, params = {}) => {
    try {
      const s = getState();
      if (!s) return { ok: false, error: "STATE unavailable" };
      const userId = actorId(ctx);
      const found = findMap(s, userId, String(params.mapId || ""));
      if (!found) return { ok: false, error: "map not found" };
      const node = findNode(found.map.nodes, String(params.nodeId || ""));
      if (!node) return { ok: false, error: "node not found" };
      const title = String(params.title || "").trim();
      if (!title) return { ok: false, error: "title required" };
      const ev = {
        id: nextId("ev"),
        title: title.slice(0, 240),
        source: String(params.source || "").slice(0, 240),
        url: String(params.url || "").slice(0, 600),
        type: String(params.evidenceType || "empirical_study"),
        credibility: Math.max(1, Math.min(5, Number(params.credibility) || 3)),
        relevance: Math.max(1, Math.min(5, Number(params.relevance) || 3)),
        weight: Math.max(1, Math.min(5, Number(params.weight) || 3)),
        addedBy: actorName(ctx),
        addedAt: nowIso(),
      };
      if (!Array.isArray(node.evidence)) node.evidence = [];
      node.evidence.push(ev);
      found.map.updatedAt = nowIso();
      saveState();
      return { ok: true, result: { evidence: ev, nodeId: node.id, score: evidenceScore(ev) } };
    } catch (e) {
      return { ok: false, error: e instanceof Error ? e.message : String(e) };
    }
  });

  registerLensAction("reasoning", "evidence-detach", (ctx, _artifact, params = {}) => {
    try {
      const s = getState();
      if (!s) return { ok: false, error: "STATE unavailable" };
      const userId = actorId(ctx);
      const found = findMap(s, userId, String(params.mapId || ""));
      if (!found) return { ok: false, error: "map not found" };
      const node = findNode(found.map.nodes, String(params.nodeId || ""));
      if (!node) return { ok: false, error: "node not found" };
      const evId = String(params.evidenceId || "");
      const before = (node.evidence || []).length;
      node.evidence = (node.evidence || []).filter(e => e.id !== evId);
      if (node.evidence.length === before) return { ok: false, error: "evidence not found" };
      found.map.updatedAt = nowIso();
      saveState();
      return { ok: true, result: { detached: evId } };
    } catch (e) {
      return { ok: false, error: e instanceof Error ? e.message : String(e) };
    }
  });

  // ── Collaborative debate — multi-author maps ──

  registerLensAction("reasoning", "collaborator-add", (ctx, _artifact, params = {}) => {
    try {
      const s = getState();
      if (!s) return { ok: false, error: "STATE unavailable" };
      const userId = actorId(ctx);
      const own = s.maps.get(userId);
      const map = own && own.get(String(params.mapId || ""));
      if (!map) return { ok: false, error: "map not found (owner only)" };
      const collaboratorId = String(params.collaboratorId || "").trim();
      if (!collaboratorId) return { ok: false, error: "collaboratorId required" };
      if (collaboratorId === userId) return { ok: false, error: "owner is already a participant" };
      if (!Array.isArray(map.collaborators)) map.collaborators = [];
      if (map.collaborators.includes(collaboratorId)) {
        return { ok: false, error: "already a collaborator" };
      }
      map.collaborators.push(collaboratorId);
      map.updatedAt = nowIso();
      saveState();
      return { ok: true, result: { mapId: map.id, collaborators: map.collaborators } };
    } catch (e) {
      return { ok: false, error: e instanceof Error ? e.message : String(e) };
    }
  });

  registerLensAction("reasoning", "collaborator-remove", (ctx, _artifact, params = {}) => {
    try {
      const s = getState();
      if (!s) return { ok: false, error: "STATE unavailable" };
      const userId = actorId(ctx);
      const own = s.maps.get(userId);
      const map = own && own.get(String(params.mapId || ""));
      if (!map) return { ok: false, error: "map not found (owner only)" };
      const collaboratorId = String(params.collaboratorId || "");
      const before = (map.collaborators || []).length;
      map.collaborators = (map.collaborators || []).filter(c => c !== collaboratorId);
      if (map.collaborators.length === before) return { ok: false, error: "collaborator not found" };
      map.updatedAt = nowIso();
      saveState();
      return { ok: true, result: { mapId: map.id, collaborators: map.collaborators } };
    } catch (e) {
      return { ok: false, error: e instanceof Error ? e.message : String(e) };
    }
  });

  // ── Argument scoring — conclusion confidence from weights ──

  registerLensAction("reasoning", "map-score", (ctx, _artifact, params = {}) => {
    try {
      const s = getState();
      if (!s) return { ok: false, error: "STATE unavailable" };
      const userId = actorId(ctx);
      const found = findMap(s, userId, String(params.mapId || ""));
      if (!found) return { ok: false, error: "map not found" };
      const map = found.map;
      if (!map.nodes.length) return { ok: true, result: { message: "empty map" } };
      const root = map.nodes[0];
      const breakdown = scoreNode(root);
      const confidence = Math.round(breakdown.score * 100);
      let verdict;
      if (confidence >= 75) verdict = "well-supported";
      else if (confidence >= 55) verdict = "leaning-supported";
      else if (confidence >= 45) verdict = "contested";
      else if (confidence >= 25) verdict = "leaning-against";
      else verdict = "poorly-supported";
      // Per-node flat scores for the UI heat map.
      const perNode = [];
      walk(map.nodes, (n) => {
        const sc = scoreNode(n);
        perNode.push({ id: n.id, text: n.text.slice(0, 80), stance: n.stance, score: sc.score, evidenceCount: sc.evidenceCount });
      });
      let proCount = 0;
      let conCount = 0;
      let evidenceTotal = 0;
      walk(map.nodes, (n) => {
        if (n.stance === "pro") proCount++;
        else if (n.stance === "con") conCount++;
        evidenceTotal += (n.evidence || []).length;
      });
      return {
        ok: true,
        result: {
          mapId: map.id,
          rootClaim: map.rootClaim,
          confidence,
          verdict,
          breakdown,
          perNode,
          stats: { proCount, conCount, evidenceTotal, nodeCount: countNodes(map.nodes) },
        },
      };
    } catch (e) {
      return { ok: false, error: e instanceof Error ? e.message : String(e) };
    }
  });

  // ── Export argument map — outline / markdown ──

  registerLensAction("reasoning", "map-export", (ctx, _artifact, params = {}) => {
    try {
      const s = getState();
      if (!s) return { ok: false, error: "STATE unavailable" };
      const userId = actorId(ctx);
      const found = findMap(s, userId, String(params.mapId || ""));
      if (!found) return { ok: false, error: "map not found" };
      const map = found.map;
      const format = String(params.format || "markdown");
      if (!["markdown", "outline", "json"].includes(format)) {
        return { ok: false, error: "format must be markdown, outline, or json" };
      }
      if (format === "json") {
        return { ok: true, result: { format, content: JSON.stringify({ ...publicMap(map, found.ownerId), nodes: map.nodes }, null, 2) } };
      }
      const lines = [];
      if (format === "markdown") {
        lines.push(`# ${map.title}`, "", `**Root claim:** ${map.rootClaim}`, "", `*Scheme: ${map.scheme} — Status: ${map.status}*`, "");
      } else {
        lines.push(map.title, "=".repeat(map.title.length), "");
      }
      const stanceMark = { pro: "[+]", con: "[-]", neutral: "[=]" };
      const renderNode = (node, depth) => {
        const indent = format === "markdown" ? "  ".repeat(depth) : "    ".repeat(depth);
        const bullet = format === "markdown" ? "-" : `${depth + 1}.`;
        lines.push(`${indent}${bullet} ${stanceMark[node.stance] || "[=]"} (${node.type}, str ${node.strength}/5) ${node.text}`);
        for (const ev of node.evidence || []) {
          lines.push(`${indent}  · evidence: ${ev.title} — ${ev.source || "n/a"} (cred ${ev.credibility}/5, rel ${ev.relevance}/5)`);
        }
        for (const child of node.children) renderNode(child, depth + 1);
      };
      for (const root of map.nodes) renderNode(root, 0);
      return { ok: true, result: { format, content: lines.join("\n"), mapId: map.id } };
    } catch (e) {
      return { ok: false, error: e instanceof Error ? e.message : String(e) };
    }
  });

  // ── Reasoning-scheme library ──

  registerLensAction("reasoning", "scheme-list", (_ctx, _artifact, _params = {}) => {
    return { ok: true, result: { schemes: SCHEMES } };
  });

  // Instantiate a scheme into a new persistent map, slot-by-slot.
  registerLensAction("reasoning", "scheme-instantiate", (ctx, _artifact, params = {}) => {
    try {
      const s = getState();
      if (!s) return { ok: false, error: "STATE unavailable" };
      const userId = actorId(ctx);
      const scheme = SCHEMES.find(x => x.id === String(params.schemeId || ""));
      if (!scheme) return { ok: false, error: "scheme not found" };
      const values = params.values && typeof params.values === "object" ? params.values : {};
      const title = String(params.title || `${scheme.name}`).trim().slice(0, 160);
      const rootText = String(values[scheme.slots[0]] || params.rootClaim || scheme.slots[0]).trim();
      if (!rootText) return { ok: false, error: "root slot value required" };
      const root = newNode({ text: rootText, type: "claim", stance: "neutral", strength: 3, author: actorName(ctx) });
      for (const slot of scheme.slots.slice(1)) {
        const v = String(values[slot] || "").trim();
        if (!v) continue;
        const lower = slot.toLowerCase();
        const stance = /rebuttal|objection|negative|disadvantage/.test(lower) ? "con"
          : /qualifier|reliability/.test(lower) ? "neutral" : "pro";
        const type = /conclusion/.test(lower) ? "claim"
          : /warrant/.test(lower) ? "warrant"
          : /backing|grounds|basis/.test(lower) ? "backing"
          : /rebuttal/.test(lower) ? "rebuttal"
          : /qualifier/.test(lower) ? "qualifier"
          : stance === "con" ? "objection" : "premise";
        root.children.push(newNode({ text: `${slot}: ${v}`, type, stance, strength: 3, author: actorName(ctx) }));
      }
      const map = {
        id: nextId("map"),
        title,
        rootClaim: rootText,
        scheme: scheme.id,
        status: "active",
        collaborators: [],
        nodes: [root],
        createdAt: nowIso(),
        updatedAt: nowIso(),
      };
      userMaps(s, userId).set(map.id, map);
      saveState();
      return { ok: true, result: { map: { ...publicMap(map, userId), nodes: map.nodes }, criticalQuestions: scheme.criticalQuestions } };
    } catch (e) {
      return { ok: false, error: e instanceof Error ? e.message : String(e) };
    }
  });
}

// ───────────────────────────────────────────────────────────────────────────
// HLR reasoning-trace macro surface (the /lenses/reasoning/traces watcher).
//
// The trace browser at app/lenses/reasoning/traces/page.tsx is a READER /
// DASHBOARD over the High-Level-Reasoning engine (server/emergent/hlr-engine.js):
// it lists recent reasoning traces, opens one for detail, and can kick a new
// constraint-check pass. These macros are thin delegations to the real engine —
// NO duplicated reasoning logic. They give the manifest real macros to point at
// (list / get / run) instead of the prior phantom `lens.reasoning.*` ids, and
// give the runMacro path parity with the existing REST routes
// (`/api/reasoning/traces`, `/api/reasoning/trace/:id`, `/api/reasoning/run`).
//
// By design this surface has NO create/update/delete/export: a trace is an
// immutable record of a reasoning pass produced by `run` (or by the autonomous
// HLR cycle / drift-scan), not an authorable artifact. There is nothing to edit
// or hand-curate, so those bits are honestly absent rather than faked.
//
// `register` is the runMacro registrar: register(domain, name, async (ctx, input) => {...}, opts).
export function registerReasoningTraceMacros(register) {
  /**
   * reasoning.traces — list recent HLR reasoning traces (summaries).
   * input: { limit? }  (clamped 1..100 by listTraces)
   * Read-only; safe for publicReadDomains.
   */
  register("reasoning", "traces", async (_ctx, input = {}) => {
    const { listTraces, REASONING_MODES } = await import("../emergent/hlr-engine.js");
    const limit = Math.min(Math.max(Number(input.limit) || 50, 1), 100);
    return { ok: true, traces: listTraces(limit), modes: Object.values(REASONING_MODES) };
  }, { public: true, note: "list recent HLR reasoning traces" });

  /**
   * reasoning.trace — fetch one full HLR reasoning trace by id.
   * input: { traceId }
   * Read-only; safe for publicReadDomains.
   */
  register("reasoning", "trace", async (_ctx, input = {}) => {
    const traceId = String(input.traceId || input.id || "");
    if (!traceId) return { ok: false, error: "traceId_required" };
    const { getReasoningTrace } = await import("../emergent/hlr-engine.js");
    const trace = getReasoningTrace(traceId);
    if (!trace) return { ok: false, error: "no_trace" };
    return { ok: true, trace };
  }, { public: true, note: "fetch one HLR reasoning trace by id" });

  /**
   * reasoning.run — execute one High-Level-Reasoning pass, recording a trace.
   * input: { topic?, question?, mode?, depth? }  (topic OR question required)
   * Returns the engine result (includes traceId so a caller can immediately
   * open it via reasoning.trace). Writes a real trace into the engine store.
   */
  register("reasoning", "run", async (_ctx, input = {}) => {
    const { runHLR, REASONING_MODES } = await import("../emergent/hlr-engine.js");
    const result = runHLR(input || {});
    return { ...result, modes: Object.values(REASONING_MODES) };
  }, { note: "run one HLR reasoning pass and record a trace" });
}
