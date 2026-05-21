// server/domains/disputes.js
//
// Dispute Resolution Center backend — an online dispute resolution (ODR)
// platform modeled on eBay/PayPal Resolution Center.
//
// Pure-math AI helpers (assessDispute / timelineTrack / settlementCalc /
// evidenceStrength) plus a real per-user case substrate backed by
// globalThis._concordSTATE Maps. Every handler is wrapped in try/catch and
// returns { ok, result?, error? } — never throws.

export default function registerDisputesActions(registerLensAction) {
  /* ---------------------------------------------------------------- */
  /*  State substrate                                                  */
  /* ---------------------------------------------------------------- */

  function getDisputesState() {
    const STATE = globalThis._concordSTATE;
    if (!STATE) return null;
    if (!STATE.disputesLens) {
      STATE.disputesLens = {
        cases: new Map(),     // userId -> Array<case>
        seq: new Map(),       // userId -> next case number
      };
    }
    const s = STATE.disputesLens;
    if (!s.cases) s.cases = new Map();
    if (!s.seq) s.seq = new Map();
    return s;
  }

  function saveState() {
    if (typeof globalThis._concordSaveStateDebounced === "function") {
      try { globalThis._concordSaveStateDebounced(); } catch (_e) { /* best effort */ }
    }
  }

  function actId(ctx) {
    return ctx?.actor?.userId || ctx?.userId || "anon";
  }

  function ensureList(map, userId) {
    if (!map.has(userId)) map.set(userId, []);
    return map.get(userId);
  }

  function nextSeq(s, userId) {
    const n = s.seq.get(userId) || 1;
    s.seq.set(userId, n + 1);
    return n;
  }

  function findCase(s, userId, caseId) {
    const list = s.cases.get(userId) || [];
    return list.find((c) => c.id === caseId) || null;
  }

  const nowIso = () => new Date().toISOString();

  /* ---------------------------------------------------------------- */
  /*  Lifecycle config                                                 */
  /* ---------------------------------------------------------------- */

  const STATUS_FLOW = ["open", "under_review", "mediation", "escalated", "resolved", "dismissed"];
  // SLA deadline (in hours) per stage — auto-escalate when breached.
  const SLA_HOURS = {
    open: 48,
    under_review: 96,
    mediation: 168,
    escalated: 240,
  };
  const VALID_TYPES = [
    "not_as_described", "unauthorized_purchase", "non_delivery",
    "quality", "fraudulent_listing", "copyright", "derivative_claim", "other",
  ];

  function publicCase(c) {
    return {
      id: c.id,
      caseNumber: c.caseNumber,
      title: c.title,
      dispute_type: c.disputeType,
      status: c.status,
      disputeAmount: c.disputeAmount,
      claimantId: c.claimantId,
      respondentId: c.respondentId,
      mediatorId: c.mediatorId,
      escrowFrozen: c.escrowFrozen,
      escrowAmount: c.escrowAmount,
      evidenceCount: c.evidence.length,
      messageCount: c.messages.length,
      offerCount: c.offers.length,
      slaDeadline: c.slaDeadline,
      slaBreached: c.slaDeadline ? new Date(c.slaDeadline).getTime() < Date.now() : false,
      outcome: c.outcome,
      openedAt: c.openedAt,
      updatedAt: c.updatedAt,
      resolvedAt: c.resolvedAt,
    };
  }

  function setStageSla(c) {
    const hrs = SLA_HOURS[c.status];
    c.slaDeadline = hrs ? new Date(Date.now() + hrs * 3600000).toISOString() : null;
  }

  /* ================================================================ */
  /*  AI helpers (pure compute) — preserved from original              */
  /* ================================================================ */

  registerLensAction("disputes", "assessDispute", (ctx, artifact, _params) => {
    try {
      const data = artifact?.data || {};
      const parties = data.parties || [];
      const amount = parseFloat(data.disputeAmount) || 0;
      const category = (data.category || "general").toLowerCase();
      const complexity = parties.length > 2 ? "multi-party" : "bilateral";
      const tier = amount > 100000 ? "high-value" : amount > 10000 ? "medium-value" : "low-value";
      const methods = [
        { method: "Negotiation", cost: "Low", timeWeeks: 2, binding: false, suitable: true },
        { method: "Mediation", cost: "Medium", timeWeeks: 6, binding: false, suitable: amount < 100000 },
        { method: "Arbitration", cost: "High", timeWeeks: 12, binding: true, suitable: true },
        { method: "Litigation", cost: "Very High", timeWeeks: 52, binding: true, suitable: amount > 50000 },
      ];
      return { ok: true, result: { parties: parties.length, complexity, valueTier: tier, disputeAmount: amount, category, recommendedMethods: methods.filter((m) => m.suitable), preferredMethod: amount < 10000 ? "Negotiation" : amount < 50000 ? "Mediation" : "Arbitration" } };
    } catch (e) { return { ok: false, error: e.message }; }
  });

  registerLensAction("disputes", "timelineTrack", (ctx, artifact, _params) => {
    try {
      const events = artifact?.data?.events || [];
      const sorted = events.map((e) => ({ ...e, date: new Date(e.date) })).sort((a, b) => a.date.getTime() - b.date.getTime());
      const daysElapsed = sorted.length >= 2 ? Math.ceil((sorted[sorted.length - 1].date.getTime() - sorted[0].date.getTime()) / 86400000) : 0;
      return { ok: true, result: { events: sorted.map((e) => ({ date: e.date.toISOString().split("T")[0], event: e.description || e.event, party: e.party || "both" })), totalEvents: events.length, daysElapsed, status: daysElapsed > 180 ? "protracted" : daysElapsed > 90 ? "extended" : "active", deadlines: events.filter((e) => e.deadline).map((e) => ({ event: e.description, deadline: e.deadline })) } };
    } catch (e) { return { ok: false, error: e.message }; }
  });

  registerLensAction("disputes", "settlementCalc", (ctx, artifact, _params) => {
    try {
      const data = artifact?.data || {};
      const claimed = parseFloat(data.claimedAmount) || 0;
      const offered = parseFloat(data.offerAmount) || 0;
      const legalCosts = parseFloat(data.legalCosts) || 0;
      const winProbability = parseFloat(data.winProbability) || 0.5;
      const expectedValue = claimed * winProbability;
      const netAfterCosts = expectedValue - legalCosts;
      const settlementZone = { min: Math.round(expectedValue * 0.6), max: Math.round(expectedValue * 1.1), midpoint: Math.round(expectedValue * 0.85) };
      return { ok: true, result: { claimed, offered, legalCosts, winProbability: Math.round(winProbability * 100), expectedValue: Math.round(expectedValue), netAfterCosts: Math.round(netAfterCosts), settlementZone, recommendation: offered >= settlementZone.min ? "Offer is within settlement zone — consider accepting" : "Offer is below expected value — negotiate higher" } };
    } catch (e) { return { ok: false, error: e.message }; }
  });

  registerLensAction("disputes", "evidenceStrength", (ctx, artifact, _params) => {
    try {
      const evidence = artifact?.data?.evidence || [];
      if (evidence.length === 0) return { ok: true, result: { message: "Add evidence items to assess strength." } };
      const weights = { document: 3, witness: 2, photo: 2.5, video: 3, expert: 3.5, digital: 2, physical: 2.5, correspondence: 2, receipt: 3, screenshot: 2.5, file: 2 };
      const scored = evidence.map((e) => {
        const type = (e.type || "document").toLowerCase();
        const weight = weights[type] || 2;
        const reliability = parseFloat(e.reliability) || 0.7;
        return { item: e.name || e.description || e.label, type, weight, reliability: Math.round(reliability * 100), score: Math.round(weight * reliability * 100) / 100 };
      }).sort((a, b) => b.score - a.score);
      const avgScore = scored.reduce((sum, e) => sum + e.score, 0) / scored.length;
      return { ok: true, result: { evidence: scored, totalPieces: scored.length, avgStrength: Math.round(avgScore * 100) / 100, strongestEvidence: scored[0]?.item, caseStrength: avgScore > 2 ? "strong" : avgScore > 1.5 ? "moderate" : "weak" } };
    } catch (e) { return { ok: false, error: e.message }; }
  });

  /* ================================================================ */
  /*  Case lifecycle                                                   */
  /* ================================================================ */

  // Open a new dispute case. Optionally freeze escrow on creation.
  registerLensAction("disputes", "case-open", (ctx, _artifact, params = {}) => {
    try {
      const s = getDisputesState();
      if (!s) return { ok: false, error: "STATE unavailable" };
      const userId = actId(ctx);
      const title = String(params.title || "").trim();
      if (!title) return { ok: false, error: "title required" };
      if (title.length > 120) return { ok: false, error: "title too long (max 120)" };
      const disputeType = String(params.disputeType || "other");
      if (!VALID_TYPES.includes(disputeType)) return { ok: false, error: "invalid disputeType" };
      const disputeAmount = Math.max(0, parseFloat(params.disputeAmount) || 0);
      const description = String(params.description || "").trim();
      const respondentId = params.respondentId ? String(params.respondentId) : null;
      const list = ensureList(s.cases, userId);
      const caseNumber = nextSeq(s, userId);
      const c = {
        id: `dispute_${userId}_${caseNumber}`,
        caseNumber,
        title,
        disputeType,
        disputeAmount,
        description,
        status: "open",
        claimantId: userId,
        respondentId,
        mediatorId: null,
        evidence: [],
        messages: [],
        offers: [],
        history: [{ at: nowIso(), event: "case_opened", actor: userId }],
        escrowFrozen: false,
        escrowAmount: 0,
        outcome: null,
        slaDeadline: null,
        openedAt: nowIso(),
        updatedAt: nowIso(),
        resolvedAt: null,
      };
      setStageSla(c);
      if (params.freezeEscrow && disputeAmount > 0) {
        c.escrowFrozen = true;
        c.escrowAmount = disputeAmount;
        c.history.push({ at: nowIso(), event: "escrow_frozen", actor: userId, amount: disputeAmount });
      }
      list.push(c);
      saveState();
      return { ok: true, result: { case: publicCase(c) } };
    } catch (e) { return { ok: false, error: e.message }; }
  });

  // List all cases for the user, with optional status filter + summary stats.
  registerLensAction("disputes", "case-list", (ctx, _artifact, params = {}) => {
    try {
      const s = getDisputesState();
      if (!s) return { ok: false, error: "STATE unavailable" };
      const userId = actId(ctx);
      let list = (s.cases.get(userId) || []).slice();
      const statusFilter = params.status ? String(params.status) : null;
      if (statusFilter && statusFilter !== "all") {
        list = list.filter((c) => c.status === statusFilter);
      }
      list.sort((a, b) => new Date(b.updatedAt).getTime() - new Date(a.updatedAt).getTime());
      const all = s.cases.get(userId) || [];
      const stats = {
        total: all.length,
        open: all.filter((c) => c.status === "open").length,
        active: all.filter((c) => !["resolved", "dismissed"].includes(c.status)).length,
        escalated: all.filter((c) => c.status === "escalated").length,
        resolved: all.filter((c) => c.status === "resolved").length,
        slaBreached: all.filter((c) => c.slaDeadline && new Date(c.slaDeadline).getTime() < Date.now() && !["resolved", "dismissed"].includes(c.status)).length,
        escrowHeld: all.filter((c) => c.escrowFrozen).reduce((sum, c) => sum + c.escrowAmount, 0),
      };
      return { ok: true, result: { cases: list.map(publicCase), stats } };
    } catch (e) { return { ok: false, error: e.message }; }
  });

  // Full detail for a single case — evidence, messages, offers, history.
  registerLensAction("disputes", "case-detail", (ctx, _artifact, params = {}) => {
    try {
      const s = getDisputesState();
      if (!s) return { ok: false, error: "STATE unavailable" };
      const userId = actId(ctx);
      const c = findCase(s, userId, String(params.caseId || ""));
      if (!c) return { ok: false, error: "case not found" };
      return {
        ok: true,
        result: {
          case: publicCase(c),
          description: c.description,
          evidence: c.evidence,
          messages: c.messages,
          offers: c.offers,
          history: c.history,
        },
      };
    } catch (e) { return { ok: false, error: e.message }; }
  });

  // Advance the case to the next lifecycle stage (or any explicit stage).
  registerLensAction("disputes", "case-advance", (ctx, _artifact, params = {}) => {
    try {
      const s = getDisputesState();
      if (!s) return { ok: false, error: "STATE unavailable" };
      const userId = actId(ctx);
      const c = findCase(s, userId, String(params.caseId || ""));
      if (!c) return { ok: false, error: "case not found" };
      if (["resolved", "dismissed"].includes(c.status)) {
        return { ok: false, error: "case already closed" };
      }
      let target = params.toStatus ? String(params.toStatus) : null;
      if (!target) {
        const idx = STATUS_FLOW.indexOf(c.status);
        target = STATUS_FLOW[Math.min(idx + 1, STATUS_FLOW.length - 2)];
      }
      if (!STATUS_FLOW.includes(target)) return { ok: false, error: "invalid target status" };
      const prev = c.status;
      c.status = target;
      setStageSla(c);
      if (["resolved", "dismissed"].includes(target)) {
        c.resolvedAt = nowIso();
        c.slaDeadline = null;
      }
      c.updatedAt = nowIso();
      c.history.push({ at: nowIso(), event: "status_changed", actor: userId, from: prev, to: target });
      saveState();
      return { ok: true, result: { case: publicCase(c) } };
    } catch (e) { return { ok: false, error: e.message }; }
  });

  /* ================================================================ */
  /*  Feature: Evidence upload + attachment per dispute                */
  /* ================================================================ */

  registerLensAction("disputes", "evidence-add", (ctx, _artifact, params = {}) => {
    try {
      const s = getDisputesState();
      if (!s) return { ok: false, error: "STATE unavailable" };
      const userId = actId(ctx);
      const c = findCase(s, userId, String(params.caseId || ""));
      if (!c) return { ok: false, error: "case not found" };
      const label = String(params.label || "").trim();
      if (!label) return { ok: false, error: "label required" };
      const kind = String(params.kind || "document");
      const ALLOWED = ["document", "screenshot", "photo", "video", "receipt", "correspondence", "file", "witness", "expert"];
      if (!ALLOWED.includes(kind)) return { ok: false, error: "invalid evidence kind" };
      const item = {
        id: `ev_${c.id}_${c.evidence.length + 1}`,
        label,
        kind,
        url: params.url ? String(params.url) : null,
        note: params.note ? String(params.note).slice(0, 500) : "",
        reliability: Math.min(1, Math.max(0, parseFloat(params.reliability) || 0.7)),
        uploadedBy: userId,
        uploadedAt: nowIso(),
      };
      c.evidence.push(item);
      c.updatedAt = nowIso();
      c.history.push({ at: nowIso(), event: "evidence_added", actor: userId, label });
      saveState();
      return { ok: true, result: { evidence: c.evidence, added: item } };
    } catch (e) { return { ok: false, error: e.message }; }
  });

  registerLensAction("disputes", "evidence-remove", (ctx, _artifact, params = {}) => {
    try {
      const s = getDisputesState();
      if (!s) return { ok: false, error: "STATE unavailable" };
      const userId = actId(ctx);
      const c = findCase(s, userId, String(params.caseId || ""));
      if (!c) return { ok: false, error: "case not found" };
      const evId = String(params.evidenceId || "");
      const before = c.evidence.length;
      c.evidence = c.evidence.filter((e) => e.id !== evId);
      if (c.evidence.length === before) return { ok: false, error: "evidence not found" };
      c.updatedAt = nowIso();
      c.history.push({ at: nowIso(), event: "evidence_removed", actor: userId });
      saveState();
      return { ok: true, result: { evidence: c.evidence } };
    } catch (e) { return { ok: false, error: e.message }; }
  });

  /* ================================================================ */
  /*  Feature: Two-party messaging thread                              */
  /* ================================================================ */

  registerLensAction("disputes", "message-post", (ctx, _artifact, params = {}) => {
    try {
      const s = getDisputesState();
      if (!s) return { ok: false, error: "STATE unavailable" };
      const userId = actId(ctx);
      const c = findCase(s, userId, String(params.caseId || ""));
      if (!c) return { ok: false, error: "case not found" };
      const body = String(params.body || "").trim();
      if (!body) return { ok: false, error: "message body required" };
      if (body.length > 2000) return { ok: false, error: "message too long (max 2000)" };
      const VALID_ROLES = ["claimant", "respondent", "mediator"];
      const role = VALID_ROLES.includes(params.role) ? params.role : "claimant";
      const msg = {
        id: `msg_${c.id}_${c.messages.length + 1}`,
        role,
        authorId: userId,
        body,
        postedAt: nowIso(),
      };
      c.messages.push(msg);
      c.updatedAt = nowIso();
      c.history.push({ at: nowIso(), event: "message_posted", actor: userId, role });
      saveState();
      return { ok: true, result: { messages: c.messages, posted: msg } };
    } catch (e) { return { ok: false, error: e.message }; }
  });

  registerLensAction("disputes", "message-list", (ctx, _artifact, params = {}) => {
    try {
      const s = getDisputesState();
      if (!s) return { ok: false, error: "STATE unavailable" };
      const userId = actId(ctx);
      const c = findCase(s, userId, String(params.caseId || ""));
      if (!c) return { ok: false, error: "case not found" };
      const byRole = c.messages.reduce((acc, m) => { acc[m.role] = (acc[m.role] || 0) + 1; return acc; }, {});
      return { ok: true, result: { messages: c.messages, total: c.messages.length, byRole } };
    } catch (e) { return { ok: false, error: e.message }; }
  });

  /* ================================================================ */
  /*  Feature: Mediator assignment + neutral-party workflow            */
  /* ================================================================ */

  registerLensAction("disputes", "mediator-assign", (ctx, _artifact, params = {}) => {
    try {
      const s = getDisputesState();
      if (!s) return { ok: false, error: "STATE unavailable" };
      const userId = actId(ctx);
      const c = findCase(s, userId, String(params.caseId || ""));
      if (!c) return { ok: false, error: "case not found" };
      const mediatorId = String(params.mediatorId || "").trim();
      if (!mediatorId) return { ok: false, error: "mediatorId required" };
      if (mediatorId === c.claimantId || mediatorId === c.respondentId) {
        return { ok: false, error: "mediator must be a neutral third party" };
      }
      c.mediatorId = mediatorId;
      c.mediatorName = params.mediatorName ? String(params.mediatorName) : mediatorId;
      // Assignment moves a stalled case into the mediation stage.
      if (c.status === "open" || c.status === "under_review") {
        c.status = "mediation";
        setStageSla(c);
      }
      c.updatedAt = nowIso();
      c.history.push({ at: nowIso(), event: "mediator_assigned", actor: userId, mediatorId });
      saveState();
      return { ok: true, result: { case: publicCase(c), mediatorId, mediatorName: c.mediatorName } };
    } catch (e) { return { ok: false, error: e.message }; }
  });

  registerLensAction("disputes", "mediator-unassign", (ctx, _artifact, params = {}) => {
    try {
      const s = getDisputesState();
      if (!s) return { ok: false, error: "STATE unavailable" };
      const userId = actId(ctx);
      const c = findCase(s, userId, String(params.caseId || ""));
      if (!c) return { ok: false, error: "case not found" };
      if (!c.mediatorId) return { ok: false, error: "no mediator assigned" };
      const prev = c.mediatorId;
      c.mediatorId = null;
      c.mediatorName = null;
      c.updatedAt = nowIso();
      c.history.push({ at: nowIso(), event: "mediator_unassigned", actor: userId, previous: prev });
      saveState();
      return { ok: true, result: { case: publicCase(c) } };
    } catch (e) { return { ok: false, error: e.message }; }
  });

  /* ================================================================ */
  /*  Feature: Settlement offer / counter-offer exchange               */
  /* ================================================================ */

  registerLensAction("disputes", "offer-make", (ctx, _artifact, params = {}) => {
    try {
      const s = getDisputesState();
      if (!s) return { ok: false, error: "STATE unavailable" };
      const userId = actId(ctx);
      const c = findCase(s, userId, String(params.caseId || ""));
      if (!c) return { ok: false, error: "case not found" };
      if (["resolved", "dismissed"].includes(c.status)) {
        return { ok: false, error: "case is closed" };
      }
      const amount = parseFloat(params.amount);
      if (!Number.isFinite(amount) || amount < 0) return { ok: false, error: "valid amount required" };
      const VALID_ROLES = ["claimant", "respondent", "mediator"];
      const fromRole = VALID_ROLES.includes(params.fromRole) ? params.fromRole : "claimant";
      // Supersede any prior pending offers — only one is live at a time.
      c.offers.forEach((o) => { if (o.status === "pending") o.status = "superseded"; });
      const offer = {
        id: `offer_${c.id}_${c.offers.length + 1}`,
        fromRole,
        fromId: userId,
        amount,
        terms: params.terms ? String(params.terms).slice(0, 1000) : "",
        isCounter: c.offers.length > 0,
        status: "pending",
        madeAt: nowIso(),
        respondedAt: null,
      };
      c.offers.push(offer);
      c.updatedAt = nowIso();
      c.history.push({ at: nowIso(), event: offer.isCounter ? "counter_offer_made" : "offer_made", actor: userId, amount });
      saveState();
      return { ok: true, result: { offers: c.offers, made: offer } };
    } catch (e) { return { ok: false, error: e.message }; }
  });

  registerLensAction("disputes", "offer-respond", (ctx, _artifact, params = {}) => {
    try {
      const s = getDisputesState();
      if (!s) return { ok: false, error: "STATE unavailable" };
      const userId = actId(ctx);
      const c = findCase(s, userId, String(params.caseId || ""));
      if (!c) return { ok: false, error: "case not found" };
      const offer = c.offers.find((o) => o.id === String(params.offerId || ""));
      if (!offer) return { ok: false, error: "offer not found" };
      if (offer.status !== "pending") return { ok: false, error: "offer is no longer pending" };
      const decision = String(params.decision || "");
      if (!["accept", "reject"].includes(decision)) return { ok: false, error: "decision must be accept or reject" };
      offer.status = decision === "accept" ? "accepted" : "rejected";
      offer.respondedAt = nowIso();
      offer.respondedBy = userId;
      c.updatedAt = nowIso();
      c.history.push({ at: nowIso(), event: `offer_${offer.status}`, actor: userId, amount: offer.amount });
      // Accepting an offer resolves the case as a negotiated settlement.
      if (decision === "accept") {
        c.status = "resolved";
        c.resolvedAt = nowIso();
        c.slaDeadline = null;
        c.outcome = {
          type: "negotiated_settlement",
          settlementAmount: offer.amount,
          terms: offer.terms,
          resolvedBy: userId,
          resolvedAt: nowIso(),
        };
        // Release escrow alongside the agreed settlement.
        if (c.escrowFrozen) {
          c.escrowFrozen = false;
          c.history.push({ at: nowIso(), event: "escrow_released", actor: userId, amount: offer.amount });
        }
        c.history.push({ at: nowIso(), event: "case_resolved", actor: userId, via: "offer_accepted" });
      }
      saveState();
      return { ok: true, result: { offers: c.offers, case: publicCase(c) } };
    } catch (e) { return { ok: false, error: e.message }; }
  });

  /* ================================================================ */
  /*  Feature: SLA timers — auto-escalate stalled stages               */
  /* ================================================================ */

  registerLensAction("disputes", "sla-check", (ctx, _artifact, _params = {}) => {
    try {
      const s = getDisputesState();
      if (!s) return { ok: false, error: "STATE unavailable" };
      const userId = actId(ctx);
      const list = s.cases.get(userId) || [];
      const now = Date.now();
      const escalated = [];
      const watch = [];
      for (const c of list) {
        if (["resolved", "dismissed", "escalated"].includes(c.status)) continue;
        if (!c.slaDeadline) continue;
        const deadlineMs = new Date(c.slaDeadline).getTime();
        const hoursLeft = Math.round((deadlineMs - now) / 3600000);
        if (deadlineMs < now) {
          // SLA breached — auto-escalate.
          const prev = c.status;
          c.status = "escalated";
          setStageSla(c);
          c.updatedAt = nowIso();
          c.history.push({ at: nowIso(), event: "sla_breach_escalation", actor: "system", from: prev });
          escalated.push({ caseId: c.id, title: c.title, from: prev });
        } else if (hoursLeft <= 24) {
          watch.push({ caseId: c.id, title: c.title, status: c.status, hoursLeft });
        }
      }
      if (escalated.length) saveState();
      return { ok: true, result: { escalated, escalatedCount: escalated.length, nearingDeadline: watch, checkedAt: nowIso() } };
    } catch (e) { return { ok: false, error: e.message }; }
  });

  /* ================================================================ */
  /*  Feature: Resolution outcome record + searchable case archive     */
  /* ================================================================ */

  registerLensAction("disputes", "case-resolve", (ctx, _artifact, params = {}) => {
    try {
      const s = getDisputesState();
      if (!s) return { ok: false, error: "STATE unavailable" };
      const userId = actId(ctx);
      const c = findCase(s, userId, String(params.caseId || ""));
      if (!c) return { ok: false, error: "case not found" };
      if (["resolved", "dismissed"].includes(c.status)) return { ok: false, error: "case already closed" };
      const outcomeType = String(params.outcomeType || "");
      const VALID = ["full_refund", "partial_refund", "no_refund", "replacement", "negotiated_settlement", "dismissed"];
      if (!VALID.includes(outcomeType)) return { ok: false, error: "invalid outcomeType" };
      let refundAmount = 0;
      if (outcomeType === "full_refund") refundAmount = c.disputeAmount;
      else if (outcomeType === "partial_refund") {
        const pct = Math.min(100, Math.max(1, parseFloat(params.refundPercent) || 50));
        refundAmount = Math.round(c.disputeAmount * pct / 100);
      } else if (outcomeType === "negotiated_settlement") {
        refundAmount = Math.max(0, parseFloat(params.settlementAmount) || 0);
      }
      c.outcome = {
        type: outcomeType,
        refundAmount,
        rationale: params.rationale ? String(params.rationale).slice(0, 1000) : "",
        resolvedBy: userId,
        resolvedRole: params.role ? String(params.role) : "admin",
        resolvedAt: nowIso(),
      };
      c.status = outcomeType === "dismissed" || outcomeType === "no_refund" ? "dismissed" : "resolved";
      c.resolvedAt = nowIso();
      c.slaDeadline = null;
      c.updatedAt = nowIso();
      c.history.push({ at: nowIso(), event: "case_resolved", actor: userId, outcomeType, refundAmount });
      // Settle escrow on resolution.
      if (c.escrowFrozen) {
        c.escrowFrozen = false;
        c.history.push({ at: nowIso(), event: "escrow_settled", actor: userId, refundAmount });
      }
      saveState();
      return { ok: true, result: { case: publicCase(c), outcome: c.outcome } };
    } catch (e) { return { ok: false, error: e.message }; }
  });

  // Searchable archive of closed cases with aggregate outcome analytics.
  registerLensAction("disputes", "archive-search", (ctx, _artifact, params = {}) => {
    try {
      const s = getDisputesState();
      if (!s) return { ok: false, error: "STATE unavailable" };
      const userId = actId(ctx);
      const all = s.cases.get(userId) || [];
      let closed = all.filter((c) => ["resolved", "dismissed"].includes(c.status));
      const q = String(params.query || "").trim().toLowerCase();
      if (q) {
        closed = closed.filter((c) =>
          c.title.toLowerCase().includes(q)
          || c.description.toLowerCase().includes(q)
          || c.disputeType.includes(q)
          || (c.outcome?.type || "").includes(q));
      }
      if (params.disputeType && params.disputeType !== "all") {
        closed = closed.filter((c) => c.disputeType === String(params.disputeType));
      }
      if (params.outcomeType && params.outcomeType !== "all") {
        closed = closed.filter((c) => c.outcome?.type === String(params.outcomeType));
      }
      closed.sort((a, b) => new Date(b.resolvedAt || 0).getTime() - new Date(a.resolvedAt || 0).getTime());
      const totalRefunded = closed.reduce((sum, c) => sum + (c.outcome?.refundAmount || 0), 0);
      const outcomeBreakdown = closed.reduce((acc, c) => {
        const t = c.outcome?.type || "unknown";
        acc[t] = (acc[t] || 0) + 1;
        return acc;
      }, {});
      const durations = closed
        .filter((c) => c.openedAt && c.resolvedAt)
        .map((c) => (new Date(c.resolvedAt).getTime() - new Date(c.openedAt).getTime()) / 86400000);
      const avgResolutionDays = durations.length
        ? Math.round((durations.reduce((a, b) => a + b, 0) / durations.length) * 10) / 10
        : 0;
      return {
        ok: true,
        result: {
          cases: closed.map((c) => ({ ...publicCase(c), outcome: c.outcome })),
          total: closed.length,
          totalRefunded,
          outcomeBreakdown,
          avgResolutionDays,
        },
      };
    } catch (e) { return { ok: false, error: e.message }; }
  });

  /* ================================================================ */
  /*  Feature: Escrow / hold integration                               */
  /* ================================================================ */

  registerLensAction("disputes", "escrow-freeze", (ctx, _artifact, params = {}) => {
    try {
      const s = getDisputesState();
      if (!s) return { ok: false, error: "STATE unavailable" };
      const userId = actId(ctx);
      const c = findCase(s, userId, String(params.caseId || ""));
      if (!c) return { ok: false, error: "case not found" };
      if (c.escrowFrozen) return { ok: false, error: "escrow already frozen" };
      if (["resolved", "dismissed"].includes(c.status)) return { ok: false, error: "case is closed" };
      const amount = parseFloat(params.amount);
      const freezeAmount = Number.isFinite(amount) && amount > 0 ? amount : c.disputeAmount;
      if (freezeAmount <= 0) return { ok: false, error: "no funds to freeze" };
      c.escrowFrozen = true;
      c.escrowAmount = freezeAmount;
      c.updatedAt = nowIso();
      c.history.push({ at: nowIso(), event: "escrow_frozen", actor: userId, amount: freezeAmount });
      saveState();
      return { ok: true, result: { case: publicCase(c), escrowAmount: freezeAmount } };
    } catch (e) { return { ok: false, error: e.message }; }
  });

  registerLensAction("disputes", "escrow-release", (ctx, _artifact, params = {}) => {
    try {
      const s = getDisputesState();
      if (!s) return { ok: false, error: "STATE unavailable" };
      const userId = actId(ctx);
      const c = findCase(s, userId, String(params.caseId || ""));
      if (!c) return { ok: false, error: "case not found" };
      if (!c.escrowFrozen) return { ok: false, error: "no escrow frozen on this case" };
      const releaseTo = String(params.releaseTo || "claimant");
      if (!["claimant", "respondent", "split"].includes(releaseTo)) {
        return { ok: false, error: "releaseTo must be claimant, respondent, or split" };
      }
      const released = c.escrowAmount;
      c.escrowFrozen = false;
      c.updatedAt = nowIso();
      c.history.push({ at: nowIso(), event: "escrow_released", actor: userId, amount: released, releaseTo });
      saveState();
      return { ok: true, result: { case: publicCase(c), released, releaseTo } };
    } catch (e) { return { ok: false, error: e.message }; }
  });

  // Aggregate escrow ledger across all open cases.
  registerLensAction("disputes", "escrow-status", (ctx, _artifact, _params = {}) => {
    try {
      const s = getDisputesState();
      if (!s) return { ok: false, error: "STATE unavailable" };
      const userId = actId(ctx);
      const all = s.cases.get(userId) || [];
      const frozen = all.filter((c) => c.escrowFrozen);
      const holds = frozen.map((c) => ({
        caseId: c.id,
        title: c.title,
        amount: c.escrowAmount,
        status: c.status,
        frozenSince: (c.history.find((h) => h.event === "escrow_frozen") || {}).at || c.openedAt,
      }));
      return {
        ok: true,
        result: {
          holds,
          totalHeld: holds.reduce((sum, h) => sum + h.amount, 0),
          activeHolds: holds.length,
        },
      };
    } catch (e) { return { ok: false, error: e.message }; }
  });
}
