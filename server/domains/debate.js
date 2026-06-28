// server/domains/debate.js
export default function registerDebateActions(registerLensAction) {
  // ─── Shared helpers ─────────────────────────────────────────────────────
  // The AI-analysis actions are reached from TWO surfaces:
  //   1. page.tsx "AI Analysis Actions" → /api/lens/:domain/:id/run with
  //      {action} and NO params → handler(ctx, artifact, {}). artifact.data is
  //      the live debate created via useLensData (shape:
  //      {topic, proArguments[], conArguments[], proVotes, conVotes, ...}).
  //   2. DebateActionPanel → same route WITH {action, params} → the params land
  //      as the 3rd arg. params carry {text} / {side,arguments} for the chosen
  //      argument(s).
  // Both surfaces must produce a live result, so every handler honors explicit
  // params FIRST, then falls back to deriving its input from the real debate
  // artifact shape. Nothing is fabricated — derivations only read fields the
  // debate genuinely carries.
  const asArray = (v) => (Array.isArray(v) ? v : []);
  const argText = (a) => (a && typeof a === "object" ? String(a.text ?? a.claim ?? a.point ?? "") : typeof a === "string" ? a : "");
  // Collapse a debate artifact's pro/con argument lists into a single text blob
  // for fallacy/claim analysis, preferring an explicit side when given.
  function debateText(data, params) {
    if (params && typeof params.text === "string" && params.text.trim()) return params.text;
    if (params && typeof params.argument === "string" && params.argument.trim()) return params.argument;
    const d = data || {};
    if (typeof d.text === "string" && d.text.trim()) return d.text;
    if (typeof d.argument === "string" && d.argument.trim()) return d.argument;
    const pro = asArray(d.proArguments).map(argText);
    const con = asArray(d.conArguments).map(argText);
    return [...pro, ...con].filter(Boolean).join(". ");
  }

  registerLensAction("debate", "evaluateArgument", (ctx, artifact, params = {}) => {
   try {
    const data = artifact?.data || {};
    const p = params || {};
    const claimRaw = p.claim ?? p.text ?? data.claim ?? data.thesis ?? data.topic
      ?? argText(asArray(data.proArguments)[0]) ?? argText(asArray(data.conArguments)[0]) ?? "";
    const claim = typeof claimRaw === "string" ? claimRaw : (claimRaw == null ? "" : String(claimRaw));
    const evidence = asArray(p.evidence ?? data.evidence);
    const reasoningRaw = p.reasoning ?? data.reasoning ?? debateText(data, p) ?? "";
    const reasoning = typeof reasoningRaw === "string" ? reasoningRaw : String(reasoningRaw || "");
    if (!claim.trim()) return { ok: true, result: { message: "State a claim to evaluate the argument." } };
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
   } catch (e) { return { ok: false, error: "handler_error", message: String(e?.message || e) }; }
  });
  registerLensAction("debate", "steelmanPosition", (ctx, artifact, params = {}) => {
   try {
    const data = artifact?.data || {};
    const p = params || {};
    const side = p.side === "con" ? "con" : p.side === "pro" ? "pro" : null;
    // Explicit position string > explicit arguments[] > the chosen-side args from
    // the live debate > whichever side has arguments.
    let position = "";
    if (typeof p.position === "string" && p.position.trim()) position = p.position;
    else if (typeof p.argument === "string" && p.argument.trim()) position = p.argument;
    else if (Array.isArray(p.arguments) && p.arguments.length) position = p.arguments.map(argText).filter(Boolean).join(". ");
    else if (typeof data.position === "string" && data.position.trim()) position = data.position;
    else if (typeof data.argument === "string" && data.argument.trim()) position = data.argument;
    else {
      const proTxt = asArray(data.proArguments).map(argText).filter(Boolean);
      const conTxt = asArray(data.conArguments).map(argText).filter(Boolean);
      const chosen = side === "con" ? conTxt : side === "pro" ? proTxt : (proTxt.length ? proTxt : conTxt);
      position = chosen.join(". ");
    }
    if (!position) return { ok: true, result: { message: "State a position to steelman." } };
    const words = position.split(/\s+/).filter(Boolean);
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
    return { ok: true, result: { side: side || undefined, originalPosition: position.slice(0, 300), originalLength: words.length, steelmanSteps: strengthened.improvements, framework: strengthened.framework, note: "Steelmanning means presenting the strongest possible version of an opponent's argument" } };
   } catch (e) { return { ok: false, error: "handler_error", message: String(e?.message || e) }; }
  });
  registerLensAction("debate", "scoreDebate", (ctx, artifact, params = {}) => {
   try {
    const data = artifact?.data || {};
    const p = params || {};
    // Explicit {sides:[{name,arguments:[...]}]} > derive two sides from the live
    // debate's proArguments / conArguments + proVotes / conVotes.
    let sides = Array.isArray(p.sides) ? p.sides : Array.isArray(data.sides) ? data.sides : null;
    if (!sides) {
      const pro = asArray(data.proArguments);
      const con = asArray(data.conArguments);
      if (pro.length || con.length) {
        sides = [
          { name: "Pro", arguments: pro, votes: Number(data.proVotes) || 0 },
          { name: "Con", arguments: con, votes: Number(data.conVotes) || 0 },
        ];
      } else {
        sides = [];
      }
    }
    if (sides.length < 2) return { ok: true, result: { message: "Add at least 2 debate sides with arguments." } };
    const scored = sides.map(s => {
      const args = asArray(s.arguments);
      const evidenceCount = args.reduce((sum, a) => sum + asArray(a && a.evidence).length, 0);
      const rebuttals = args.filter(a => a && (a.rebuttal || a.counters)).length;
      const votes = Number(s.votes) || 0;
      const score = Math.round(args.length * 15 + evidenceCount * 10 + rebuttals * 20 + votes * 2);
      return { side: s.name || s.position || "—", arguments: args.length, evidencePoints: evidenceCount, rebuttals, score, votes, highlights: args.slice(0, 2).map(argText).filter(Boolean) };
    }).sort((a, b) => b.score - a.score);
    return { ok: true, result: { sides: scored, winner: scored[0]?.side, margin: scored.length >= 2 ? scored[0].score - scored[1].score : 0, close: scored.length >= 2 && Math.abs(scored[0].score - scored[1].score) < 20 } };
   } catch (e) { return { ok: false, error: "handler_error", message: String(e?.message || e) }; }
  });
  registerLensAction("debate", "fallacyCheck", (ctx, artifact, params = {}) => {
   try {
    const text = debateText(artifact?.data || {}, params || {});
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
   } catch (e) { return { ok: false, error: "handler_error", message: String(e?.message || e) }; }
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
  // modulated by the pro/con balance of its children. A child's pull on
  // its parent is scaled by the child's per-claim impact rating (1-5,
  // default 3) so high-impact sub-claims propagate further up the tree.
  function effectiveStrength(claims, claimId) {
    const self = claims.find((c) => c.id === claimId);
    if (!self) return 0;
    const kids = claims.filter((c) => c.parentId === claimId);
    let childBalance = 0;
    for (const k of kids) {
      const ks = effectiveStrength(claims, k.id);
      const impactWeight = (Math.max(1, Math.min(5, k.impact || 3))) / 3;
      childBalance += (k.stance === "pro" ? 1 : -1) * (ks / 5) * impactWeight;
    }
    const modulator = Math.max(0.2, Math.min(2, 1 + childBalance));
    return claimWeight({ votes: self.votes }) * modulator;
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
    const debate = { id: dbId("dbt"), thesis, claims: [], positions: [], shareToken: null, createdAt: dbNow(), updatedAt: dbNow() };
    dbList(s, dbActor(ctx)).push(debate);
    saveDebate();
    return { ok: true, result: { debate } };
  });

  registerLensAction("debate", "debate-list", (ctx, _a, _params = {}) => {
    const s = getDebateState(); if (!s) return { ok: false, error: "STATE unavailable" };
    const debates = dbList(s, dbActor(ctx))
      .map((d) => ({
        id: d.id, thesis: d.thesis, claimCount: d.claims.length,
        positionCount: Array.isArray(d.positions) ? d.positions.length : 0,
        shared: !!d.shareToken, shareToken: d.shareToken || null,
        score: scoreDebateTree(d), updatedAt: d.updatedAt,
      }))
      .sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));
    return { ok: true, result: { debates, count: debates.length } };
  });

  registerLensAction("debate", "debate-detail", (ctx, _a, params = {}) => {
  try {
    const s = getDebateState(); if (!s) return { ok: false, error: "STATE unavailable" };
    const debate = dbList(s, dbActor(ctx)).find((d) => d.id === params.id);
    if (!debate) return { ok: false, error: "debate not found" };
    const claims = debate.claims.map((c) => ({
      ...c,
      positionId: c.positionId || null,
      impact: c.impact || null,
      sources: Array.isArray(c.sources) ? c.sources : [],
      weight: Math.round(claimWeight(c) * 100) / 100,
      effective: Math.round(effectiveStrength(debate.claims, c.id) * 100) / 100,
      voteCount: c.votes.length,
    }));
    return {
      ok: true,
      result: {
        debate: { ...debate, positions: Array.isArray(debate.positions) ? debate.positions : [], claims },
        score: scoreDebateTree(debate),
      },
    };
    } catch (e) { return { ok: false, error: "handler_error", message: String(e?.message || e) }; }
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
    // Multi-thesis: a claim may attach to a specific position (root-level only).
    let positionId = params.positionId || null;
    if (positionId) {
      if (!Array.isArray(debate.positions) || !debate.positions.some((p) => p.id === positionId)) {
        return { ok: false, error: "position not found" };
      }
    }
    const claim = { id: dbId("clm"), parentId, positionId, stance, text, votes: [], sources: [], createdAt: dbNow() };
    debate.claims.push(claim);
    debate.updatedAt = dbNow();
    saveDebate();
    return { ok: true, result: { claim, score: scoreDebateTree(debate) } };
  });

  // ── Per-claim impact rating (1-5) — distinct from votes, propagates up. ──
  registerLensAction("debate", "claim-impact", (ctx, _a, params = {}) => {
    const s = getDebateState(); if (!s) return { ok: false, error: "STATE unavailable" };
    const debate = dbList(s, dbActor(ctx)).find((d) => d.id === params.debateId);
    if (!debate) return { ok: false, error: "debate not found" };
    const claim = debate.claims.find((c) => c.id === params.claimId);
    if (!claim) return { ok: false, error: "claim not found" };
    const impact = Math.max(1, Math.min(5, Math.round(Number(params.impact) || 3)));
    claim.impact = impact;
    debate.updatedAt = dbNow();
    saveDebate();
    // Walk ancestors so the caller can show what the rating propagated to.
    const chain = [];
    let cur = claim;
    while (cur && cur.parentId) {
      const parent = debate.claims.find((c) => c.id === cur.parentId);
      if (!parent) break;
      chain.push({ id: parent.id, text: parent.text.slice(0, 80), effective: Math.round(effectiveStrength(debate.claims, parent.id) * 100) / 100 });
      cur = parent;
    }
    return { ok: true, result: { claimId: claim.id, impact, propagatesTo: chain, score: scoreDebateTree(debate) } };
  });

  // ── Claim sourcing — attach evidence/citations to a claim. ──
  registerLensAction("debate", "source-add", (ctx, _a, params = {}) => {
    const s = getDebateState(); if (!s) return { ok: false, error: "STATE unavailable" };
    const debate = dbList(s, dbActor(ctx)).find((d) => d.id === params.debateId);
    if (!debate) return { ok: false, error: "debate not found" };
    const claim = debate.claims.find((c) => c.id === params.claimId);
    if (!claim) return { ok: false, error: "claim not found" };
    const title = dbClean(params.title, 200);
    if (title.length < 3) return { ok: false, error: "source title too short" };
    let url = dbClean(params.url, 500);
    if (url && !/^https?:\/\//i.test(url)) return { ok: false, error: "url must start with http(s)://" };
    const kind = ["study", "article", "data", "book", "primary", "other"].includes(params.kind) ? params.kind : "other";
    if (!Array.isArray(claim.sources)) claim.sources = [];
    const source = { id: dbId("src"), title, url, kind, note: dbClean(params.note, 300), addedAt: dbNow() };
    claim.sources.push(source);
    if (claim.sources.length > 20) claim.sources.shift();
    debate.updatedAt = dbNow();
    saveDebate();
    return { ok: true, result: { claimId: claim.id, source, sourceCount: claim.sources.length } };
  });

  registerLensAction("debate", "source-delete", (ctx, _a, params = {}) => {
    const s = getDebateState(); if (!s) return { ok: false, error: "STATE unavailable" };
    const debate = dbList(s, dbActor(ctx)).find((d) => d.id === params.debateId);
    if (!debate) return { ok: false, error: "debate not found" };
    const claim = debate.claims.find((c) => c.id === params.claimId);
    if (!claim) return { ok: false, error: "claim not found" };
    if (!Array.isArray(claim.sources)) claim.sources = [];
    const i = claim.sources.findIndex((src) => src.id === params.sourceId);
    if (i < 0) return { ok: false, error: "source not found" };
    claim.sources.splice(i, 1);
    debate.updatedAt = dbNow();
    saveDebate();
    return { ok: true, result: { claimId: claim.id, deleted: params.sourceId, sourceCount: claim.sources.length } };
  });

  // ── Multi-thesis positions — more than binary pro/con. ──
  registerLensAction("debate", "position-add", (ctx, _a, params = {}) => {
    const s = getDebateState(); if (!s) return { ok: false, error: "STATE unavailable" };
    const debate = dbList(s, dbActor(ctx)).find((d) => d.id === params.debateId);
    if (!debate) return { ok: false, error: "debate not found" };
    const label = dbClean(params.label, 200);
    if (label.length < 3) return { ok: false, error: "position label too short" };
    if (!Array.isArray(debate.positions)) debate.positions = [];
    if (debate.positions.length >= 8) return { ok: false, error: "max 8 positions per debate" };
    if (debate.positions.some((p) => p.label.toLowerCase() === label.toLowerCase())) return { ok: false, error: "position label already exists" };
    const position = { id: dbId("pos"), label, summary: dbClean(params.summary, 400), createdAt: dbNow() };
    debate.positions.push(position);
    debate.updatedAt = dbNow();
    saveDebate();
    return { ok: true, result: { position, positions: debate.positions } };
  });

  registerLensAction("debate", "position-delete", (ctx, _a, params = {}) => {
    const s = getDebateState(); if (!s) return { ok: false, error: "STATE unavailable" };
    const debate = dbList(s, dbActor(ctx)).find((d) => d.id === params.debateId);
    if (!debate) return { ok: false, error: "debate not found" };
    if (!Array.isArray(debate.positions)) debate.positions = [];
    const i = debate.positions.findIndex((p) => p.id === params.positionId);
    if (i < 0) return { ok: false, error: "position not found" };
    debate.positions.splice(i, 1);
    // Detach any claims that referenced this position.
    for (const c of debate.claims) { if (c.positionId === params.positionId) c.positionId = null; }
    debate.updatedAt = dbNow();
    saveDebate();
    return { ok: true, result: { deleted: params.positionId, positions: debate.positions } };
  });

  // Score each position by the effective strength of its attached root claims.
  registerLensAction("debate", "position-scores", (ctx, _a, params = {}) => {
    const s = getDebateState(); if (!s) return { ok: false, error: "STATE unavailable" };
    const debate = dbList(s, dbActor(ctx)).find((d) => d.id === params.debateId);
    if (!debate) return { ok: false, error: "debate not found" };
    const positions = Array.isArray(debate.positions) ? debate.positions : [];
    const scored = positions.map((p) => {
      const roots = debate.claims.filter((c) => c.parentId === null && c.positionId === p.id);
      let support = 0;
      for (const r of roots) {
        const st = effectiveStrength(debate.claims, r.id);
        support += (r.stance === "pro" ? 1 : -1) * st;
      }
      return { id: p.id, label: p.label, summary: p.summary, claimCount: roots.length, support: Math.round(support * 100) / 100 };
    });
    const totalAbs = scored.reduce((n, p) => n + Math.abs(p.support), 0) || 1;
    const ranked = scored
      .map((p) => ({ ...p, sharePct: Math.round((Math.abs(p.support) / totalAbs) * 100) }))
      .sort((a, b) => b.support - a.support);
    return { ok: true, result: { positions: ranked, leader: ranked[0]?.label || null, count: ranked.length } };
  });

  // ── Debate sharing — public read-only link via opaque share token. ──
  registerLensAction("debate", "debate-share", (ctx, _a, params = {}) => {
    const s = getDebateState(); if (!s) return { ok: false, error: "STATE unavailable" };
    const debate = dbList(s, dbActor(ctx)).find((d) => d.id === params.debateId);
    if (!debate) return { ok: false, error: "debate not found" };
    if (!(s.shared instanceof Map)) s.shared = new Map(); // token -> { ownerId, debateId }
    if (params.revoke) {
      if (debate.shareToken) { s.shared.delete(debate.shareToken); debate.shareToken = null; }
      debate.updatedAt = dbNow();
      saveDebate();
      return { ok: true, result: { shared: false, shareToken: null } };
    }
    if (!debate.shareToken) {
      debate.shareToken = `shr_${Math.random().toString(36).slice(2, 10)}${Math.random().toString(36).slice(2, 8)}`;
    }
    s.shared.set(debate.shareToken, { ownerId: dbActor(ctx), debateId: debate.id });
    debate.updatedAt = dbNow();
    saveDebate();
    return { ok: true, result: { shared: true, shareToken: debate.shareToken, url: `/lenses/debate?share=${debate.shareToken}` } };
  });

  // Public read-only fetch by share token — no owner scoping, read-only shape.
  registerLensAction("debate", "shared-view", (_ctx, _a, params = {}) => {
  try {
    const s = getDebateState(); if (!s) return { ok: false, error: "STATE unavailable" };
    if (!(s.shared instanceof Map)) s.shared = new Map();
    const token = dbClean(params.shareToken, 60);
    const ref = s.shared.get(token);
    if (!ref) return { ok: false, error: "share link invalid or revoked" };
    const ownerDebates = s.debates.get(ref.ownerId) || [];
    const debate = ownerDebates.find((d) => d.id === ref.debateId);
    if (!debate || debate.shareToken !== token) return { ok: false, error: "share link invalid or revoked" };
    const claims = debate.claims.map((c) => ({
      id: c.id, parentId: c.parentId, positionId: c.positionId || null, stance: c.stance,
      text: c.text, weight: Math.round(claimWeight(c) * 100) / 100, voteCount: c.votes.length,
      impact: c.impact || null, sources: Array.isArray(c.sources) ? c.sources : [],
    }));
    return {
      ok: true,
      result: {
        readOnly: true,
        debate: { id: debate.id, thesis: debate.thesis, positions: debate.positions || [], claims },
        score: scoreDebateTree(debate),
      },
    };
    } catch (e) { return { ok: false, error: "handler_error", message: String(e?.message || e) }; }
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
  try {
    const s = getDebateState(); if (!s) return { ok: false, error: "STATE unavailable" };
    const debates = dbList(s, dbActor(ctx));
    return {
      ok: true,
      result: {
        debates: debates.length,
        totalClaims: debates.reduce((n, d) => n + d.claims.length, 0),
        totalPositions: debates.reduce((n, d) => n + (Array.isArray(d.positions) ? d.positions.length : 0), 0),
        totalSources: debates.reduce((n, d) => n + d.claims.reduce((m, c) => m + (Array.isArray(c.sources) ? c.sources.length : 0), 0), 0),
        sharedDebates: debates.filter((d) => !!d.shareToken).length,
        wellSupported: debates.filter((d) => scoreDebateTree(d).verdict === "well-supported").length,
      },
    };
    } catch (e) { return { ok: false, error: "handler_error", message: String(e?.message || e) }; }
});
}
