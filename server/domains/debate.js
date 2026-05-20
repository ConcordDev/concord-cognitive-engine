// server/domains/debate.js
export default function registerDebateActions(registerLensAction) {
  registerLensAction("debate", "evaluateArgument", (ctx, artifact, _params) => {
    const data = artifact.data || {};
    const claim = data.claim || data.thesis || "";
    const evidence = data.evidence || [];
    const reasoning = data.reasoning || "";
    if (!claim) return { ok: true, result: { message: "State a claim to evaluate the argument." } };
    const evidenceScore = Math.min(100, evidence.length * 20);
    const reasoningScore = reasoning.length > 200 ? 80 : reasoning.length > 50 ? 50 : reasoning.length > 0 ? 25 : 0;
    const hasCounterpoint = !!(data.counterpoint || data.rebuttal);
    const overallScore = Math.round(evidenceScore * 0.4 + reasoningScore * 0.4 + (hasCounterpoint ? 20 : 0));
    const fallacies = [];
    const lowerClaim = (claim + " " + reasoning).toLowerCase();
    if (lowerClaim.includes("everyone knows") || lowerClaim.includes("obviously")) fallacies.push("Appeal to common knowledge");
    if (lowerClaim.includes("always") || lowerClaim.includes("never")) fallacies.push("Overgeneralization");
    if (lowerClaim.match(/if .* then .* therefore/)) fallacies.push("Possible slippery slope");
    return { ok: true, result: { claim: claim.slice(0, 200), evidenceCount: evidence.length, evidenceScore, reasoningScore, addressesCounterpoints: hasCounterpoint, overallScore, fallaciesDetected: fallacies, strength: overallScore >= 70 ? "strong" : overallScore >= 40 ? "moderate" : "weak" } };
  });
  registerLensAction("debate", "steelmanPosition", (ctx, artifact, _params) => {
    const position = artifact.data?.position || artifact.data?.argument || "";
    if (!position) return { ok: true, result: { message: "State a position to steelman." } };
    const words = position.split(/\s+/);
    const strengthened = {
      originalLength: words.length,
      improvements: [
        "Identify the strongest version of this argument",
        "Add the most compelling evidence that supports it",
        "Address the strongest objection and show why it fails",
        "Connect to universally-held values (fairness, liberty, safety)",
        "Provide concrete examples and data",
      ],
      framework: { premise: "If we grant the strongest interpretation...", evidence: "The best evidence shows...", conclusion: "Therefore, the most defensible version is..." },
    };
    return { ok: true, result: { originalPosition: position.slice(0, 300), steelmanSteps: strengthened.improvements, framework: strengthened.framework, note: "Steelmanning means presenting the strongest possible version of an opponent's argument" } };
  });
  registerLensAction("debate", "scoreDebate", (ctx, artifact, _params) => {
    const sides = artifact.data?.sides || [];
    if (sides.length < 2) return { ok: true, result: { message: "Add at least 2 debate sides with arguments." } };
    const scored = sides.map(s => {
      const args = s.arguments || [];
      const evidenceCount = args.reduce((sum, a) => sum + ((a.evidence || []).length), 0);
      const rebuttals = args.filter(a => a.rebuttal || a.counters).length;
      const score = Math.round(args.length * 15 + evidenceCount * 10 + rebuttals * 20);
      return { side: s.name || s.position, arguments: args.length, evidencePoints: evidenceCount, rebuttals, score, highlights: args.slice(0, 2).map(a => a.claim || a.point || "").filter(Boolean) };
    }).sort((a, b) => b.score - a.score);
    return { ok: true, result: { sides: scored, winner: scored[0]?.side, margin: scored.length >= 2 ? scored[0].score - scored[1].score : 0, close: scored.length >= 2 && Math.abs(scored[0].score - scored[1].score) < 20 } };
  });
  registerLensAction("debate", "fallacyCheck", (ctx, artifact, _params) => {
    const text = artifact.data?.text || artifact.data?.argument || "";
    if (!text) return { ok: true, result: { message: "Provide text to check for logical fallacies." } };
    const lower = text.toLowerCase();
    const checks = [
      { name: "Ad Hominem", pattern: /attack.*person|character|insult/i, desc: "Attacking the person instead of the argument" },
      { name: "Straw Man", pattern: /misrepresent|distort|not what.*said/i, desc: "Misrepresenting an argument to make it easier to attack" },
      { name: "Appeal to Authority", pattern: /expert.*says|according to.*famous/i, desc: "Using authority as proof without evidence" },
      { name: "False Dilemma", pattern: /either.*or|only two|no other/i, desc: "Presenting only two options when more exist" },
      { name: "Slippery Slope", pattern: /will lead to|inevitably|domino/i, desc: "Assuming one event will cause a chain of negative events" },
      { name: "Red Herring", pattern: /but what about|changing.*subject/i, desc: "Introducing irrelevant information to divert attention" },
      { name: "Circular Reasoning", pattern: /because.*because|true because.*true/i, desc: "Using the conclusion as a premise" },
      { name: "Bandwagon", pattern: /everyone|most people|popular/i, desc: "Arguing something is true because many believe it" },
    ];
    const detected = checks.filter(c => c.pattern.test(text)).map(c => ({ fallacy: c.name, description: c.desc }));
    return { ok: true, result: { textLength: text.length, fallaciesDetected: detected, count: detected.length, logicalSoundness: detected.length === 0 ? "appears-sound" : detected.length <= 2 ? "minor-issues" : "significant-issues" } };
  });

  // ─── Kialo-shape argument-tree substrate (per-user, STATE-backed) ────

  function getDebateState() {
    const STATE = globalThis._concordSTATE;
    if (!STATE) return null;
    if (!STATE.debateLens) STATE.debateLens = {};
    if (!(STATE.debateLens.debates instanceof Map)) STATE.debateLens.debates = new Map(); // userId -> Array
    return STATE.debateLens;
  }
  function saveDebate() {
    if (typeof globalThis._concordSaveStateDebounced === "function") {
      try { globalThis._concordSaveStateDebounced(); } catch (_e) { /* best effort */ }
    }
  }
  const dbId = (p) => `${p}_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`;
  const dbNow = () => new Date().toISOString();
  const dbActor = (ctx) => ctx?.actor?.userId || ctx?.userId || "anon";
  const dbClean = (v, max = 600) => String(v == null ? "" : v).trim().slice(0, max);
  const dbList = (s, userId) => { if (!s.debates.has(userId)) s.debates.set(userId, []); return s.debates.get(userId); };
  const claimWeight = (c) => (c.votes.length ? c.votes.reduce((a, b) => a + b, 0) / c.votes.length : 3);

  // Recursively score a claim's effective strength: its own weight,
  // modulated by the pro/con balance of its children.
  function effectiveStrength(claims, claimId) {
    const kids = claims.filter((c) => c.parentId === claimId);
    let childBalance = 0;
    for (const k of kids) {
      const ks = effectiveStrength(claims, k.id);
      childBalance += (k.stance === "pro" ? 1 : -1) * ks / 5;
    }
    const modulator = Math.max(0.2, Math.min(2, 1 + childBalance));
    return claimWeight({ votes: claims.find((c) => c.id === claimId).votes }) * modulator;
  }

  function scoreDebateTree(debate) {
    const claims = debate.claims;
    const roots = claims.filter((c) => c.parentId === null);
    let proTotal = 0, conTotal = 0;
    for (const r of roots) {
      const strength = effectiveStrength(claims, r.id);
      if (r.stance === "pro") proTotal += strength;
      else conTotal += strength;
    }
    const net = proTotal - conTotal;
    const total = proTotal + conTotal;
    const supportPct = total > 0 ? Math.round((proTotal / total) * 100) : 50;
    return {
      proTotal: Math.round(proTotal * 100) / 100,
      conTotal: Math.round(conTotal * 100) / 100,
      net: Math.round(net * 100) / 100,
      supportPct,
      verdict: supportPct >= 65 ? "well-supported" : supportPct >= 50 ? "leaning-for" : supportPct >= 35 ? "leaning-against" : "poorly-supported",
    };
  }

  registerLensAction("debate", "debate-create", (ctx, _a, params = {}) => {
    const s = getDebateState(); if (!s) return { ok: false, error: "STATE unavailable" };
    const thesis = dbClean(params.thesis, 400);
    if (thesis.length < 8) return { ok: false, error: "thesis must be at least 8 characters" };
    const debate = { id: dbId("dbt"), thesis, claims: [], createdAt: dbNow(), updatedAt: dbNow() };
    dbList(s, dbActor(ctx)).push(debate);
    saveDebate();
    return { ok: true, result: { debate } };
  });

  registerLensAction("debate", "debate-list", (ctx, _a, _params = {}) => {
    const s = getDebateState(); if (!s) return { ok: false, error: "STATE unavailable" };
    const debates = dbList(s, dbActor(ctx))
      .map((d) => ({ id: d.id, thesis: d.thesis, claimCount: d.claims.length, score: scoreDebateTree(d), updatedAt: d.updatedAt }))
      .sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));
    return { ok: true, result: { debates, count: debates.length } };
  });

  registerLensAction("debate", "debate-detail", (ctx, _a, params = {}) => {
    const s = getDebateState(); if (!s) return { ok: false, error: "STATE unavailable" };
    const debate = dbList(s, dbActor(ctx)).find((d) => d.id === params.id);
    if (!debate) return { ok: false, error: "debate not found" };
    const claims = debate.claims.map((c) => ({ ...c, weight: Math.round(claimWeight(c) * 100) / 100, voteCount: c.votes.length }));
    return { ok: true, result: { debate: { ...debate, claims }, score: scoreDebateTree(debate) } };
  });

  registerLensAction("debate", "debate-delete", (ctx, _a, params = {}) => {
    const s = getDebateState(); if (!s) return { ok: false, error: "STATE unavailable" };
    const arr = dbList(s, dbActor(ctx));
    const i = arr.findIndex((d) => d.id === params.id);
    if (i < 0) return { ok: false, error: "debate not found" };
    arr.splice(i, 1);
    saveDebate();
    return { ok: true, result: { deleted: params.id } };
  });

  registerLensAction("debate", "claim-add", (ctx, _a, params = {}) => {
    const s = getDebateState(); if (!s) return { ok: false, error: "STATE unavailable" };
    const debate = dbList(s, dbActor(ctx)).find((d) => d.id === params.debateId);
    if (!debate) return { ok: false, error: "debate not found" };
    const text = dbClean(params.text, 600);
    if (text.length < 4) return { ok: false, error: "claim text too short" };
    const parentId = params.parentId || null;
    if (parentId && !debate.claims.some((c) => c.id === parentId)) return { ok: false, error: "parent claim not found" };
    const stance = params.stance === "con" ? "con" : "pro";
    const claim = { id: dbId("clm"), parentId, stance, text, votes: [], createdAt: dbNow() };
    debate.claims.push(claim);
    debate.updatedAt = dbNow();
    saveDebate();
    return { ok: true, result: { claim, score: scoreDebateTree(debate) } };
  });

  registerLensAction("debate", "claim-edit", (ctx, _a, params = {}) => {
    const s = getDebateState(); if (!s) return { ok: false, error: "STATE unavailable" };
    const debate = dbList(s, dbActor(ctx)).find((d) => d.id === params.debateId);
    if (!debate) return { ok: false, error: "debate not found" };
    const claim = debate.claims.find((c) => c.id === params.claimId);
    if (!claim) return { ok: false, error: "claim not found" };
    const text = dbClean(params.text, 600);
    if (text.length < 4) return { ok: false, error: "claim text too short" };
    claim.text = text;
    if (params.stance === "pro" || params.stance === "con") claim.stance = params.stance;
    debate.updatedAt = dbNow();
    saveDebate();
    return { ok: true, result: { claim } };
  });

  registerLensAction("debate", "claim-delete", (ctx, _a, params = {}) => {
    const s = getDebateState(); if (!s) return { ok: false, error: "STATE unavailable" };
    const debate = dbList(s, dbActor(ctx)).find((d) => d.id === params.debateId);
    if (!debate) return { ok: false, error: "debate not found" };
    if (!debate.claims.some((c) => c.id === params.claimId)) return { ok: false, error: "claim not found" };
    const toDelete = new Set([params.claimId]);
    let grew = true;
    while (grew) {
      grew = false;
      for (const c of debate.claims) {
        if (c.parentId && toDelete.has(c.parentId) && !toDelete.has(c.id)) { toDelete.add(c.id); grew = true; }
      }
    }
    debate.claims = debate.claims.filter((c) => !toDelete.has(c.id));
    debate.updatedAt = dbNow();
    saveDebate();
    return { ok: true, result: { deleted: [...toDelete], score: scoreDebateTree(debate) } };
  });

  registerLensAction("debate", "claim-vote", (ctx, _a, params = {}) => {
    const s = getDebateState(); if (!s) return { ok: false, error: "STATE unavailable" };
    const debate = dbList(s, dbActor(ctx)).find((d) => d.id === params.debateId);
    if (!debate) return { ok: false, error: "debate not found" };
    const claim = debate.claims.find((c) => c.id === params.claimId);
    if (!claim) return { ok: false, error: "claim not found" };
    const weight = Math.max(1, Math.min(5, Math.round(Number(params.weight) || 3)));
    claim.votes.push(weight);
    if (claim.votes.length > 50) claim.votes.shift();
    debate.updatedAt = dbNow();
    saveDebate();
    return { ok: true, result: { claimId: claim.id, weight: Math.round(claimWeight(claim) * 100) / 100, score: scoreDebateTree(debate) } };
  });

  registerLensAction("debate", "debate-dashboard", (ctx, _a, _params = {}) => {
    const s = getDebateState(); if (!s) return { ok: false, error: "STATE unavailable" };
    const debates = dbList(s, dbActor(ctx));
    return {
      ok: true,
      result: {
        debates: debates.length,
        totalClaims: debates.reduce((n, d) => n + d.claims.length, 0),
        wellSupported: debates.filter((d) => scoreDebateTree(d).verdict === "well-supported").length,
      },
    };
  });
}
