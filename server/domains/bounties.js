// server/domains/bounties.js
//
// Gitcoin / HackerOne 2026-parity bounty platform backend.
//
// The legacy `bounty` domain (autofix staking) lives in server.js and is
// untouched. This `bounties` domain adds the defining bounty-platform loop
// that autofix staking never covered: anyone posts a bounty, claimants
// submit work, reviewers accept, payout (with milestones), plus categories,
// search/filter, a leaderboard, and dispute / arbitration.
//
// Per-user STATE model (consistent with answers / music / message lens
// domains) — bounties, submissions, disputes and earnings are scoped to
// the acting user but a global index makes the open board cross-user.

export default function registerBountiesActions(registerLensAction) {
  function getState() {
    const STATE = globalThis._concordSTATE;
    if (!STATE) return null;
    if (!STATE.bountiesLens) STATE.bountiesLens = {};
    const s = STATE.bountiesLens;
    if (!(s.bounties instanceof Map)) s.bounties = new Map();       // bountyId -> bounty
    if (!(s.byOwner instanceof Map)) s.byOwner = new Map();         // userId -> Set(bountyId)
    if (!(s.earnings instanceof Map)) s.earnings = new Map();       // userId -> number (CC earned)
    if (!(s.resolved instanceof Map)) s.resolved = new Map();       // userId -> count of bounties resolved
    return s;
  }
  function save() {
    if (typeof globalThis._concordSaveStateDebounced === "function") {
      try { globalThis._concordSaveStateDebounced(); } catch (_e) { /* best effort */ }
    }
  }
  const id = (p) => `${p}_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`;
  const now = () => new Date().toISOString();
  const actor = (ctx) => ctx?.actor?.userId || ctx?.userId || "anon";
  const clean = (v, max = 280) => String(v == null ? "" : v).trim().slice(0, max);
  const num = (v, d = 0) => { const n = Number(v); return Number.isFinite(n) ? n : d; };

  // Fail-CLOSED numeric guard for money fields. A caller that PASSES a numeric
  // field at all must pass a finite, non-negative value within a sane bound; an
  // absent field is fine (the macro uses its default). Returns the offending key
  // or null. This stops a poisoned reward (NaN/Infinity/-1/1e308) from minting a
  // fabricated pool — `num()` clamps NaN/Infinity/negative but lets a finite but
  // absurd 1e308 through, which would inflate poolCc + leaderboard earnings.
  const REWARD_MAX = 1e6;
  function badNumericField(input, keys) {
    for (const k of keys) {
      if (input == null || input[k] === undefined || input[k] === null) continue;
      const n = Number(input[k]);
      if (!Number.isFinite(n) || n < 0 || n > REWARD_MAX) return k;
    }
    return null;
  }

  const CATEGORIES = ["security", "feature", "bug", "design", "docs", "research", "infra", "other"];
  const DIFFICULTIES = ["beginner", "intermediate", "advanced", "expert"];

  function parseTags(raw) {
    let arr = [];
    if (Array.isArray(raw)) arr = raw;
    else if (typeof raw === "string") arr = raw.split(/[,]+/);
    return [...new Set(arr.map((t) => clean(t, 30).toLowerCase().replace(/[^a-z0-9.+#-]/g, "")).filter(Boolean))].slice(0, 6);
  }

  function ownerSet(s, userId) {
    if (!s.byOwner.has(userId)) s.byOwner.set(userId, new Set());
    return s.byOwner.get(userId);
  }
  function earn(s, userId, delta) {
    s.earnings.set(userId, Math.max(0, (s.earnings.get(userId) || 0) + delta));
  }
  function bumpResolved(s, userId) {
    s.resolved.set(userId, (s.resolved.get(userId) || 0) + 1);
  }

  // Recompute a bounty's denormalized rollups (pool, status hints).
  function poolFor(b) {
    if (Array.isArray(b.milestones) && b.milestones.length) {
      return b.milestones.reduce((sum, m) => sum + num(m.rewardCc, 0), 0);
    }
    return num(b.rewardCc, 0);
  }
  function paidFor(b) {
    if (Array.isArray(b.milestones) && b.milestones.length) {
      return b.milestones.reduce((sum, m) => sum + (m.status === "paid" ? num(m.rewardCc, 0) : 0), 0);
    }
    return b.status === "paid" || b.status === "resolved" ? num(b.rewardCc, 0) : 0;
  }
  function publicView(b) {
    return {
      id: b.id,
      title: b.title,
      description: b.description,
      ownerId: b.ownerId,
      category: b.category,
      tags: b.tags,
      difficulty: b.difficulty,
      rewardCc: b.rewardCc,
      poolCc: poolFor(b),
      paidCc: paidFor(b),
      status: b.status,
      createdAt: b.createdAt,
      updatedAt: b.updatedAt,
      deadline: b.deadline,
      milestones: (b.milestones || []).map((m) => ({ ...m })),
      submissions: (b.submissions || []).map((sub) => ({ ...sub })),
      submissionCount: (b.submissions || []).length,
      acceptedSubmissionId: b.acceptedSubmissionId || null,
      dispute: b.dispute ? { ...b.dispute } : null,
    };
  }

  // ── Create a custom bounty ─────────────────────────────────────────
  registerLensAction("bounties", "create", (ctx, _a, params = {}) => {
    try {
      const s = getState(); if (!s) return { ok: false, error: "STATE unavailable" };
      const userId = actor(ctx);
      // Fail-CLOSED on poisoned money inputs before any state write.
      const badTop = badNumericField(params, ["rewardCc"]);
      if (badTop) return { ok: false, error: `invalid numeric field: ${badTop}` };
      const title = clean(params.title, 160);
      if (title.length < 6) return { ok: false, error: "title must be at least 6 characters" };
      const description = clean(params.description, 6000);
      if (description.length < 12) return { ok: false, error: "description must be at least 12 characters" };
      const category = CATEGORIES.includes(params.category) ? params.category : "other";
      const difficulty = DIFFICULTIES.includes(params.difficulty) ? params.difficulty : "intermediate";
      const tags = parseTags(params.tags);
      const rawMilestones = Array.isArray(params.milestones) ? params.milestones : [];
      const badMilestone = rawMilestones.findIndex((m) => badNumericField(m, ["rewardCc"]));
      if (badMilestone !== -1) return { ok: false, error: `invalid numeric field: milestones[${badMilestone}].rewardCc` };
      const milestones = rawMilestones
        .map((m, i) => ({
          id: id("ms"),
          index: i,
          title: clean(m && m.title, 120) || `Milestone ${i + 1}`,
          rewardCc: Math.max(1, Math.floor(num(m && m.rewardCc, 0))),
          status: "open", // open -> submitted -> paid
        }))
        .slice(0, 12);
      const rewardCc = milestones.length
        ? milestones.reduce((sum, m) => sum + m.rewardCc, 0)
        : Math.max(1, Math.floor(num(params.rewardCc, 0)));
      if (rewardCc < 1) return { ok: false, error: "rewardCc must be at least 1 (or supply milestones)" };
      const bounty = {
        id: id("bty"),
        title,
        description,
        ownerId: userId,
        category,
        tags,
        difficulty,
        rewardCc,
        milestones,
        status: "open", // open -> claimed -> in_review -> paid | disputed
        submissions: [],
        acceptedSubmissionId: null,
        dispute: null,
        deadline: params.deadline ? clean(params.deadline, 40) : null,
        createdAt: now(),
        updatedAt: now(),
      };
      s.bounties.set(bounty.id, bounty);
      ownerSet(s, userId).add(bounty.id);
      save();
      return { ok: true, result: { bounty: publicView(bounty) } };
    } catch (err) { return { ok: false, error: String(err && err.message || err) }; }
  });

  // ── Browse / search / filter the open board ────────────────────────
  registerLensAction("bounties", "list", (_ctx, _a, params = {}) => {
    try {
      const s = getState(); if (!s) return { ok: false, error: "STATE unavailable" };
      const q = clean(params.query, 80).toLowerCase();
      const category = CATEGORIES.includes(params.category) ? params.category : null;
      const difficulty = DIFFICULTIES.includes(params.difficulty) ? params.difficulty : null;
      const status = clean(params.status, 24) || null;
      const tag = clean(params.tag, 30).toLowerCase() || null;
      const sortBy = clean(params.sortBy, 16) || "recent"; // recent | reward | submissions
      let rows = [...s.bounties.values()];
      if (category) rows = rows.filter((b) => b.category === category);
      if (difficulty) rows = rows.filter((b) => b.difficulty === difficulty);
      if (status) rows = rows.filter((b) => b.status === status);
      if (tag) rows = rows.filter((b) => (b.tags || []).includes(tag));
      if (q) {
        rows = rows.filter((b) =>
          b.title.toLowerCase().includes(q) ||
          b.description.toLowerCase().includes(q) ||
          (b.tags || []).some((t) => t.includes(q)));
      }
      if (sortBy === "reward") rows.sort((a, b) => poolFor(b) - poolFor(a));
      else if (sortBy === "submissions") rows.sort((a, b) => (b.submissions || []).length - (a.submissions || []).length);
      else rows.sort((a, b) => String(b.createdAt).localeCompare(String(a.createdAt)));
      const badLimit = badNumericField(params, ["limit"]);
      if (badLimit) return { ok: false, error: `invalid numeric field: ${badLimit}` };
      const limit = Math.min(100, Math.max(1, num(params.limit, 50)));
      return {
        ok: true,
        result: {
          bounties: rows.slice(0, limit).map(publicView),
          total: rows.length,
          categories: CATEGORIES,
          difficulties: DIFFICULTIES,
        },
      };
    } catch (err) { return { ok: false, error: String(err && err.message || err) }; }
  });

  // ── Read a single bounty ───────────────────────────────────────────
  registerLensAction("bounties", "get", (_ctx, _a, params = {}) => {
    try {
      const s = getState(); if (!s) return { ok: false, error: "STATE unavailable" };
      const b = s.bounties.get(clean(params.bountyId, 64));
      if (!b) return { ok: false, error: "bounty not found" };
      return { ok: true, result: { bounty: publicView(b) } };
    } catch (err) { return { ok: false, error: String(err && err.message || err) }; }
  });

  // ── Submission flow — a claimant submits work ──────────────────────
  registerLensAction("bounties", "submit", (ctx, _a, params = {}) => {
    try {
      const s = getState(); if (!s) return { ok: false, error: "STATE unavailable" };
      const userId = actor(ctx);
      const b = s.bounties.get(clean(params.bountyId, 64));
      if (!b) return { ok: false, error: "bounty not found" };
      if (b.status === "paid") return { ok: false, error: "bounty already paid out" };
      if (b.ownerId === userId) return { ok: false, error: "owner cannot submit to own bounty" };
      const summary = clean(params.summary, 240);
      if (summary.length < 8) return { ok: false, error: "summary must be at least 8 characters" };
      const milestoneId = params.milestoneId ? clean(params.milestoneId, 64) : null;
      if (milestoneId && !(b.milestones || []).some((m) => m.id === milestoneId)) {
        return { ok: false, error: "milestone not found on this bounty" };
      }
      const submission = {
        id: id("sub"),
        bountyId: b.id,
        claimantId: userId,
        summary,
        link: clean(params.link, 400),
        notes: clean(params.notes, 2000),
        milestoneId,
        status: "pending", // pending -> accepted | rejected
        reviewNote: null,
        createdAt: now(),
      };
      b.submissions = b.submissions || [];
      b.submissions.push(submission);
      if (b.status === "open") b.status = "claimed";
      b.updatedAt = now();
      save();
      return { ok: true, result: { submission, bounty: publicView(b) } };
    } catch (err) { return { ok: false, error: String(err && err.message || err) }; }
  });

  // ── Review / acceptance workflow before payout ─────────────────────
  registerLensAction("bounties", "review", (ctx, _a, params = {}) => {
    try {
      const s = getState(); if (!s) return { ok: false, error: "STATE unavailable" };
      const userId = actor(ctx);
      const b = s.bounties.get(clean(params.bountyId, 64));
      if (!b) return { ok: false, error: "bounty not found" };
      if (b.ownerId !== userId) return { ok: false, error: "only the bounty owner can review submissions" };
      const sub = (b.submissions || []).find((x) => x.id === clean(params.submissionId, 64));
      if (!sub) return { ok: false, error: "submission not found" };
      if (sub.status !== "pending") return { ok: false, error: `submission already ${sub.status}` };
      const decision = params.decision === "accept" ? "accept" : params.decision === "reject" ? "reject" : null;
      if (!decision) return { ok: false, error: "decision must be 'accept' or 'reject'" };
      sub.reviewNote = clean(params.reviewNote, 1000) || null;

      if (decision === "reject") {
        sub.status = "rejected";
        b.updatedAt = now();
        save();
        return { ok: true, result: { submission: sub, bounty: publicView(b) } };
      }

      // Accept → payout (milestone-scoped or whole bounty).
      sub.status = "accepted";
      let paid = 0;
      if (sub.milestoneId) {
        const ms = (b.milestones || []).find((m) => m.id === sub.milestoneId);
        if (ms && ms.status !== "paid") {
          ms.status = "paid";
          ms.paidTo = sub.claimantId;
          ms.paidAt = now();
          paid = num(ms.rewardCc, 0);
        }
        const allPaid = (b.milestones || []).every((m) => m.status === "paid");
        b.status = allPaid ? "paid" : "in_review";
      } else {
        paid = poolFor(b);
        (b.milestones || []).forEach((m) => {
          if (m.status !== "paid") { m.status = "paid"; m.paidTo = sub.claimantId; m.paidAt = now(); }
        });
        b.status = "paid";
        b.acceptedSubmissionId = sub.id;
      }
      if (paid > 0) {
        earn(s, sub.claimantId, paid);
        bumpResolved(s, userId);
      }
      b.updatedAt = now();
      save();
      return { ok: true, result: { submission: sub, bounty: publicView(b), paidCc: paid, currency: "CC" } };
    } catch (err) { return { ok: false, error: String(err && err.message || err) }; }
  });

  // ── Milestone-based bounties — release a milestone partial payout ──
  registerLensAction("bounties", "release-milestone", (ctx, _a, params = {}) => {
    try {
      const s = getState(); if (!s) return { ok: false, error: "STATE unavailable" };
      const userId = actor(ctx);
      const b = s.bounties.get(clean(params.bountyId, 64));
      if (!b) return { ok: false, error: "bounty not found" };
      if (b.ownerId !== userId) return { ok: false, error: "only the bounty owner can release milestones" };
      const ms = (b.milestones || []).find((m) => m.id === clean(params.milestoneId, 64));
      if (!ms) return { ok: false, error: "milestone not found" };
      if (ms.status === "paid") return { ok: false, error: "milestone already paid" };
      const claimantId = clean(params.claimantId, 64);
      if (!claimantId) return { ok: false, error: "claimantId required" };
      ms.status = "paid";
      ms.paidTo = claimantId;
      ms.paidAt = now();
      earn(s, claimantId, num(ms.rewardCc, 0));
      const allPaid = (b.milestones || []).every((m) => m.status === "paid");
      b.status = allPaid ? "paid" : "in_review";
      if (allPaid) bumpResolved(s, userId);
      b.updatedAt = now();
      save();
      return { ok: true, result: { milestone: { ...ms }, bounty: publicView(b), paidCc: num(ms.rewardCc, 0), currency: "CC" } };
    } catch (err) { return { ok: false, error: String(err && err.message || err) }; }
  });

  // ── Dispute / arbitration on a contested resolution ────────────────
  registerLensAction("bounties", "dispute-open", (ctx, _a, params = {}) => {
    try {
      const s = getState(); if (!s) return { ok: false, error: "STATE unavailable" };
      const userId = actor(ctx);
      const b = s.bounties.get(clean(params.bountyId, 64));
      if (!b) return { ok: false, error: "bounty not found" };
      const involved = b.ownerId === userId || (b.submissions || []).some((x) => x.claimantId === userId);
      if (!involved) return { ok: false, error: "only the owner or a claimant can open a dispute" };
      if (b.dispute && b.dispute.status === "open") return { ok: false, error: "a dispute is already open" };
      const reason = clean(params.reason, 1500);
      if (reason.length < 10) return { ok: false, error: "reason must be at least 10 characters" };
      b.dispute = {
        id: id("dsp"),
        openedBy: userId,
        reason,
        status: "open", // open -> resolved
        ruling: null,
        rulingNote: null,
        resolvedAt: null,
        openedAt: now(),
      };
      b.status = "disputed";
      b.updatedAt = now();
      save();
      return { ok: true, result: { dispute: { ...b.dispute }, bounty: publicView(b) } };
    } catch (err) { return { ok: false, error: String(err && err.message || err) }; }
  });

  registerLensAction("bounties", "dispute-resolve", (ctx, _a, params = {}) => {
    try {
      const s = getState(); if (!s) return { ok: false, error: "STATE unavailable" };
      const b = s.bounties.get(clean(params.bountyId, 64));
      if (!b) return { ok: false, error: "bounty not found" };
      if (!b.dispute || b.dispute.status !== "open") return { ok: false, error: "no open dispute on this bounty" };
      // ruling: 'uphold' keeps the prior outcome; 'overturn' reopens the bounty;
      // 'split' marks a partial settlement.
      const ruling = ["uphold", "overturn", "split"].includes(params.ruling) ? params.ruling : null;
      if (!ruling) return { ok: false, error: "ruling must be 'uphold', 'overturn' or 'split'" };
      b.dispute.status = "resolved";
      b.dispute.ruling = ruling;
      b.dispute.rulingNote = clean(params.rulingNote, 1500) || null;
      b.dispute.arbiterId = actor(ctx);
      b.dispute.resolvedAt = now();
      if (ruling === "overturn") {
        b.status = (b.submissions || []).length ? "claimed" : "open";
        b.acceptedSubmissionId = null;
      } else {
        const allPaid = (b.milestones || []).length
          ? (b.milestones || []).every((m) => m.status === "paid")
          : !!b.acceptedSubmissionId;
        b.status = allPaid ? "paid" : "in_review";
      }
      b.updatedAt = now();
      save();
      return { ok: true, result: { dispute: { ...b.dispute }, bounty: publicView(b) } };
    } catch (err) { return { ok: false, error: String(err && err.message || err) }; }
  });

  // ── Leaderboard of top earners / resolvers ─────────────────────────
  registerLensAction("bounties", "leaderboard", (_ctx, _a, params = {}) => {
    try {
      const s = getState(); if (!s) return { ok: false, error: "STATE unavailable" };
      const badLimit = badNumericField(params, ["limit"]);
      if (badLimit) return { ok: false, error: `invalid numeric field: ${badLimit}` };
      const limit = Math.min(50, Math.max(1, num(params.limit, 10)));
      const earners = [...s.earnings.entries()]
        .map(([userId, earnedCc]) => ({ userId, earnedCc, resolved: s.resolved.get(userId) || 0 }))
        .filter((r) => r.earnedCc > 0)
        .sort((a, b) => b.earnedCc - a.earnedCc)
        .slice(0, limit)
        .map((r, i) => ({ rank: i + 1, ...r }));
      const resolvers = [...s.resolved.entries()]
        .map(([userId, resolved]) => ({ userId, resolved, earnedCc: s.earnings.get(userId) || 0 }))
        .filter((r) => r.resolved > 0)
        .sort((a, b) => b.resolved - a.resolved)
        .slice(0, limit)
        .map((r, i) => ({ rank: i + 1, ...r }));
      return { ok: true, result: { topEarners: earners, topResolvers: resolvers } };
    } catch (err) { return { ok: false, error: String(err && err.message || err) }; }
  });

  // ── Per-user dashboard — bounties I posted + submissions I made ────
  registerLensAction("bounties", "my-activity", (ctx, _a, _params = {}) => {
    try {
      const s = getState(); if (!s) return { ok: false, error: "STATE unavailable" };
      const userId = actor(ctx);
      const posted = [...ownerSet(s, userId)]
        .map((bid) => s.bounties.get(bid))
        .filter(Boolean)
        .map(publicView)
        .sort((a, b) => String(b.createdAt).localeCompare(String(a.createdAt)));
      const submitted = [];
      for (const b of s.bounties.values()) {
        for (const sub of b.submissions || []) {
          if (sub.claimantId === userId) {
            submitted.push({ ...sub, bountyTitle: b.title, bountyStatus: b.status });
          }
        }
      }
      submitted.sort((a, b) => String(b.createdAt).localeCompare(String(a.createdAt)));
      return {
        ok: true,
        result: {
          posted,
          submitted,
          earnedCc: s.earnings.get(userId) || 0,
          resolvedCount: s.resolved.get(userId) || 0,
        },
      };
    } catch (err) { return { ok: false, error: String(err && err.message || err) }; }
  });
}
