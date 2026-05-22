// server/domains/sponsorship.js
//
// Creator-membership platform macros for the sponsorship lens — closes the
// Patreon parity gap: tiered membership, creator discovery, dispatch/post
// archive, pause + change-tier, sponsor-only content gating, sponsor
// leaderboards/badges, a billing dashboard, and direct thank-you messaging.
//
// All persistent per-user data lives in globalThis._concordSTATE Maps keyed by
// userId. Handlers return { ok, result?, error? } and never throw.

export default function registerSponsorshipActions(registerLensAction) {
  function getState() {
    const STATE = globalThis._concordSTATE || (globalThis._concordSTATE = {});
    if (!STATE.sponsorshipLens) {
      STATE.sponsorshipLens = {
        tiers:        new Map(), // creatorId -> Array<tier>
        sponsorships: new Map(), // userId -> Array<sponsorship>
        posts:        new Map(), // creatorId -> Array<post>
        payouts:      new Map(), // userId -> Array<payout/charge>
        messages:     new Map(), // userId -> Array<thank-you message>
        seq:          1,
      };
    }
    return STATE.sponsorshipLens;
  }

  function actor(ctx) { return ctx?.actor?.userId || ctx?.userId || "anon"; }
  function nextId(s, prefix) { return `${prefix}_${s.seq++}`; }
  function nowS() { return Math.floor(Date.now() / 1000); }
  function arr(map, key) { if (!map.has(key)) map.set(key, []); return map.get(key); }
  function round2(n) { return Math.round((Number(n) || 0) * 100) / 100; }

  // Seeded discovery catalog of sponsorable NPC-creators. Real lookup of
  // emergent NPCs would happen server-side; this is the browseable surface.
  const CATALOG = [
    { creatorId: "npc_arden", name: "Arden the Cartographer", world: "concordia-hub", craft: "maps & lore", blurb: "Charts the drift-born regions before anyone else.", baseMonthly: 5 },
    { creatorId: "npc_vael", name: "Vael Stormcaller", world: "fantasy", craft: "glyph spells", blurb: "Composes new base-6 spell glyphs each season.", baseMonthly: 8 },
    { creatorId: "npc_torian", name: "Torian Coalfist", world: "tunya", craft: "smithing blueprints", blurb: "Ships forged-gear blueprints to his patrons.", baseMonthly: 6 },
    { creatorId: "npc_seris", name: "Seris of the Hollow", world: "sovereign-ruins", craft: "faction intelligence", blurb: "Leaks schemes and grudges from the courts.", baseMonthly: 10 },
    { creatorId: "npc_juno", name: "Juno Brightwire", world: "cyber", craft: "code substrate notes", blurb: "Annotates the lattice for subscribers.", baseMonthly: 7 },
    { creatorId: "npc_mira", name: "Mira the Healer", world: "concordia-hub", craft: "medical research", blurb: "Publishes remedy DTUs as she discovers them.", baseMonthly: 5 },
  ];

  function defaultTiers(creatorId, base) {
    return [
      { tierId: `${creatorId}_bronze`, name: "Bronze", monthlyCc: base, benefits: ["Periodic dispatches", "Sponsor badge"], dispatchFreqHours: 168 },
      { tierId: `${creatorId}_silver`, name: "Silver", monthlyCc: base * 2, benefits: ["Everything in Bronze", "Sponsor-only posts", "Faster dispatches"], dispatchFreqHours: 72 },
      { tierId: `${creatorId}_gold`, name: "Gold", monthlyCc: base * 4, benefits: ["Everything in Silver", "Direct thank-you messages", "Leaderboard top-billing"], dispatchFreqHours: 24 },
    ];
  }

  function tiersFor(s, creatorId) {
    if (!s.tiers.has(creatorId)) {
      const cat = CATALOG.find((c) => c.creatorId === creatorId);
      s.tiers.set(creatorId, defaultTiers(creatorId, cat ? cat.baseMonthly : 5));
    }
    return s.tiers.get(creatorId);
  }

  function activeSponsorshipFor(s, userId, creatorId) {
    return (s.sponsorships.get(userId) || []).find(
      (sp) => sp.creatorId === creatorId && sp.status !== "cancelled",
    );
  }

  // ── Discovery ──────────────────────────────────────────────────────────
  registerLensAction("sponsorship", "discover", (ctx, artifact, params = {}) => {
    try {
      const s = getState();
      const q = String(params.query || "").toLowerCase().trim();
      const world = params.world ? String(params.world) : null;
      let list = CATALOG.slice();
      if (q) list = list.filter((c) => `${c.name} ${c.craft} ${c.blurb}`.toLowerCase().includes(q));
      if (world) list = list.filter((c) => c.world === world);
      const creators = list.map((c) => {
        const tiers = tiersFor(s, c.creatorId);
        let sponsorCount = 0;
        for (const sps of s.sponsorships.values()) {
          if (sps.some((sp) => sp.creatorId === c.creatorId && sp.status !== "cancelled")) sponsorCount++;
        }
        return { ...c, tiers, sponsorCount, lowestTierCc: tiers[0].monthlyCc };
      });
      return { ok: true, result: { creators, count: creators.length, worlds: [...new Set(CATALOG.map((c) => c.world))] } };
    } catch (e) { return { ok: false, error: String(e.message || e) }; }
  });

  // ── Tiers ──────────────────────────────────────────────────────────────
  registerLensAction("sponsorship", "list_tiers", (ctx, artifact, params = {}) => {
    try {
      const creatorId = String(params.creatorId || "");
      if (!creatorId) return { ok: false, error: "creatorId required" };
      const s = getState();
      const cat = CATALOG.find((c) => c.creatorId === creatorId);
      return { ok: true, result: { creatorId, creator: cat || null, tiers: tiersFor(s, creatorId) } };
    } catch (e) { return { ok: false, error: String(e.message || e) }; }
  });

  // ── Subscribe to a tier ────────────────────────────────────────────────
  registerLensAction("sponsorship", "subscribe", (ctx, artifact, params = {}) => {
    try {
      const userId = actor(ctx);
      const s = getState();
      const creatorId = String(params.creatorId || "");
      const tierId = String(params.tierId || "");
      if (!creatorId || !tierId) return { ok: false, error: "creatorId and tierId required" };
      const tiers = tiersFor(s, creatorId);
      const tier = tiers.find((t) => t.tierId === tierId);
      if (!tier) return { ok: false, error: "tier not found" };
      if (activeSponsorshipFor(s, userId, creatorId)) {
        return { ok: false, error: "already sponsoring this creator — use change_tier" };
      }
      const cat = CATALOG.find((c) => c.creatorId === creatorId);
      const sp = {
        id: nextId(s, "sub"),
        creatorId,
        creatorName: cat ? cat.name : creatorId,
        tierId, tierName: tier.name,
        monthlyCc: tier.monthlyCc,
        dispatchFreqHours: tier.dispatchFreqHours,
        status: "active",
        startedAt: nowS(),
        lastDispatchAt: null,
        nextChargeAt: nowS() + 30 * 86400,
        totalContributed: 0,
      };
      arr(s.sponsorships, userId).push(sp);
      // First charge.
      arr(s.payouts, userId).push({
        id: nextId(s, "chg"), creatorId, creatorName: sp.creatorName,
        amountCc: tier.monthlyCc, kind: "charge", at: nowS(), note: `Subscribed to ${tier.name}`,
      });
      sp.totalContributed = tier.monthlyCc;
      return { ok: true, result: { sponsorship: sp } };
    } catch (e) { return { ok: false, error: String(e.message || e) }; }
  });

  // ── List a user's sponsorships ─────────────────────────────────────────
  registerLensAction("sponsorship", "list_for_user", (ctx, artifact, _params = {}) => {
    try {
      const userId = actor(ctx);
      const s = getState();
      const sponsorships = (s.sponsorships.get(userId) || []).filter((sp) => sp.status !== "cancelled");
      return { ok: true, result: { sponsorships, count: sponsorships.length } };
    } catch (e) { return { ok: false, error: String(e.message || e) }; }
  });

  // ── Pause / resume (keeps the relationship) ────────────────────────────
  registerLensAction("sponsorship", "pause", (ctx, artifact, params = {}) => {
    try {
      const userId = actor(ctx);
      const s = getState();
      const sp = (s.sponsorships.get(userId) || []).find((x) => x.id === params.sponsorshipId);
      if (!sp) return { ok: false, error: "sponsorship not found" };
      if (sp.status === "cancelled") return { ok: false, error: "cancelled — cannot pause" };
      sp.status = "paused";
      return { ok: true, result: { sponsorship: sp } };
    } catch (e) { return { ok: false, error: String(e.message || e) }; }
  });

  registerLensAction("sponsorship", "resume", (ctx, artifact, params = {}) => {
    try {
      const userId = actor(ctx);
      const s = getState();
      const sp = (s.sponsorships.get(userId) || []).find((x) => x.id === params.sponsorshipId);
      if (!sp) return { ok: false, error: "sponsorship not found" };
      if (sp.status !== "paused") return { ok: false, error: "not paused" };
      sp.status = "active";
      sp.nextChargeAt = nowS() + 30 * 86400;
      return { ok: true, result: { sponsorship: sp } };
    } catch (e) { return { ok: false, error: String(e.message || e) }; }
  });

  // ── Change tier without losing the relationship ────────────────────────
  registerLensAction("sponsorship", "change_tier", (ctx, artifact, params = {}) => {
    try {
      const userId = actor(ctx);
      const s = getState();
      const sp = (s.sponsorships.get(userId) || []).find((x) => x.id === params.sponsorshipId);
      if (!sp) return { ok: false, error: "sponsorship not found" };
      if (sp.status === "cancelled") return { ok: false, error: "cancelled — resubscribe instead" };
      const tiers = tiersFor(s, sp.creatorId);
      const tier = tiers.find((t) => t.tierId === params.tierId);
      if (!tier) return { ok: false, error: "tier not found" };
      const prevTier = sp.tierName;
      sp.tierId = tier.tierId;
      sp.tierName = tier.name;
      sp.monthlyCc = tier.monthlyCc;
      sp.dispatchFreqHours = tier.dispatchFreqHours;
      arr(s.payouts, userId).push({
        id: nextId(s, "chg"), creatorId: sp.creatorId, creatorName: sp.creatorName,
        amountCc: 0, kind: "tier_change", at: nowS(), note: `${prevTier} → ${tier.name}`,
      });
      return { ok: true, result: { sponsorship: sp, changedFrom: prevTier } };
    } catch (e) { return { ok: false, error: String(e.message || e) }; }
  });

  // ── Cancel ─────────────────────────────────────────────────────────────
  registerLensAction("sponsorship", "cancel", (ctx, artifact, params = {}) => {
    try {
      const userId = actor(ctx);
      const s = getState();
      const sp = (s.sponsorships.get(userId) || []).find((x) => x.id === params.sponsorshipId);
      if (!sp) return { ok: false, error: "sponsorship not found" };
      sp.status = "cancelled";
      sp.cancelledAt = nowS();
      return { ok: true, result: { sponsorshipId: sp.id, status: "cancelled" } };
    } catch (e) { return { ok: false, error: String(e.message || e) }; }
  });

  // ── Sponsor-only content: creator publishes a post ─────────────────────
  registerLensAction("sponsorship", "publish_post", (ctx, artifact, params = {}) => {
    try {
      const s = getState();
      const creatorId = String(params.creatorId || "");
      const title = String(params.title || "").trim();
      if (!creatorId || !title) return { ok: false, error: "creatorId and title required" };
      const post = {
        id: nextId(s, "post"),
        creatorId,
        title,
        body: String(params.body || ""),
        minTier: ["bronze", "silver", "gold"].includes(String(params.minTier))
          ? String(params.minTier) : "public",
        publishedAt: nowS(),
        kind: params.kind === "dispatch" ? "dispatch" : "post",
      };
      arr(s.posts, creatorId).push(post);
      return { ok: true, result: { post } };
    } catch (e) { return { ok: false, error: String(e.message || e) }; }
  });

  // ── Sponsor-only content gating: feed for the calling user ─────────────
  registerLensAction("sponsorship", "feed", (ctx, artifact, params = {}) => {
    try {
      const userId = actor(ctx);
      const s = getState();
      const tierRank = { public: 0, bronze: 1, silver: 2, gold: 3 };
      const creatorId = params.creatorId ? String(params.creatorId) : null;
      const creators = creatorId ? [creatorId] : [...s.posts.keys()];
      const out = [];
      for (const cid of creators) {
        const sp = activeSponsorshipFor(s, userId, cid);
        // tier name → rank
        let myRank = 0;
        if (sp && sp.status === "active") {
          const tn = (sp.tierName || "").toLowerCase();
          myRank = tierRank[tn] !== undefined ? tierRank[tn] : 1;
        }
        for (const p of (s.posts.get(cid) || [])) {
          const needRank = tierRank[p.minTier] || 0;
          const locked = needRank > myRank;
          out.push({
            id: p.id, creatorId: cid, title: p.title,
            body: locked ? null : p.body,
            minTier: p.minTier, kind: p.kind, publishedAt: p.publishedAt, locked,
          });
        }
      }
      out.sort((a, b) => b.publishedAt - a.publishedAt);
      return { ok: true, result: { posts: out, count: out.length } };
    } catch (e) { return { ok: false, error: String(e.message || e) }; }
  });

  // ── Dispatch archive / history for a sponsorship ───────────────────────
  registerLensAction("sponsorship", "dispatch_history", (ctx, artifact, params = {}) => {
    try {
      const userId = actor(ctx);
      const s = getState();
      const sp = (s.sponsorships.get(userId) || []).find((x) => x.id === params.sponsorshipId);
      if (!sp) return { ok: false, error: "sponsorship not found" };
      const dispatches = (s.posts.get(sp.creatorId) || [])
        .filter((p) => p.kind === "dispatch" && p.publishedAt >= sp.startedAt)
        .sort((a, b) => b.publishedAt - a.publishedAt)
        .map((p) => ({ id: p.id, title: p.title, body: p.body, publishedAt: p.publishedAt }));
      return { ok: true, result: { sponsorshipId: sp.id, creatorName: sp.creatorName, dispatches, count: dispatches.length } };
    } catch (e) { return { ok: false, error: String(e.message || e) }; }
  });

  // ── Sponsor leaderboard / badges per creator ───────────────────────────
  registerLensAction("sponsorship", "leaderboard", (ctx, artifact, params = {}) => {
    try {
      const s = getState();
      const creatorId = String(params.creatorId || "");
      if (!creatorId) return { ok: false, error: "creatorId required" };
      const tierBadge = { Bronze: "bronze", Silver: "silver", Gold: "gold" };
      const rows = [];
      for (const [uid, sps] of s.sponsorships.entries()) {
        for (const sp of sps) {
          if (sp.creatorId !== creatorId || sp.status === "cancelled") continue;
          const months = Math.max(1, Math.floor((nowS() - sp.startedAt) / (30 * 86400)) + 1);
          rows.push({
            userId: uid,
            tier: sp.tierName,
            badge: tierBadge[sp.tierName] || "bronze",
            totalContributed: round2(sp.totalContributed),
            monthsSponsoring: months,
            sinceTs: sp.startedAt,
          });
        }
      }
      rows.sort((a, b) => b.totalContributed - a.totalContributed || b.monthsSponsoring - a.monthsSponsoring);
      rows.forEach((r, i) => { r.rank = i + 1; });
      return { ok: true, result: { creatorId, sponsors: rows, count: rows.length } };
    } catch (e) { return { ok: false, error: String(e.message || e) }; }
  });

  // ── Billing dashboard ──────────────────────────────────────────────────
  registerLensAction("sponsorship", "billing", (ctx, artifact, _params = {}) => {
    try {
      const userId = actor(ctx);
      const s = getState();
      const sponsorships = (s.sponsorships.get(userId) || []);
      const active = sponsorships.filter((sp) => sp.status === "active");
      const history = (s.payouts.get(userId) || []).slice().sort((a, b) => b.at - a.at);
      const monthlyCommitted = round2(active.reduce((sum, sp) => sum + sp.monthlyCc, 0));
      const totalContributed = round2(history.filter((h) => h.kind === "charge").reduce((sum, h) => sum + h.amountCc, 0));
      const upcoming = active
        .map((sp) => ({ creatorName: sp.creatorName, amountCc: sp.monthlyCc, dueAt: sp.nextChargeAt, tier: sp.tierName }))
        .sort((a, b) => a.dueAt - b.dueAt);
      // 6-month contribution trend.
      const monthMs = 30 * 86400;
      const trend = [];
      for (let i = 5; i >= 0; i--) {
        const lo = nowS() - (i + 1) * monthMs;
        const hi = nowS() - i * monthMs;
        const total = history
          .filter((h) => h.kind === "charge" && h.at >= lo && h.at < hi)
          .reduce((sum, h) => sum + h.amountCc, 0);
        trend.push({ monthsAgo: i, totalCc: round2(total) });
      }
      return {
        ok: true,
        result: {
          monthlyCommitted, totalContributed,
          activeCount: active.length,
          pausedCount: sponsorships.filter((sp) => sp.status === "paused").length,
          upcomingCharges: upcoming,
          paymentHistory: history,
          trend,
        },
      };
    } catch (e) { return { ok: false, error: String(e.message || e) }; }
  });

  // ── Direct thank-you message from creator to sponsor ───────────────────
  registerLensAction("sponsorship", "send_thanks", (ctx, artifact, params = {}) => {
    try {
      const s = getState();
      const toUserId = String(params.toUserId || "");
      const creatorId = String(params.creatorId || "");
      const body = String(params.body || "").trim();
      if (!toUserId || !creatorId || !body) return { ok: false, error: "toUserId, creatorId and body required" };
      const sp = activeSponsorshipFor(s, toUserId, creatorId);
      if (!sp) return { ok: false, error: "recipient is not an active sponsor" };
      const cat = CATALOG.find((c) => c.creatorId === creatorId);
      const msg = {
        id: nextId(s, "msg"), creatorId,
        creatorName: cat ? cat.name : creatorId,
        body, sentAt: nowS(), read: false,
      };
      arr(s.messages, toUserId).unshift(msg);
      return { ok: true, result: { message: msg } };
    } catch (e) { return { ok: false, error: String(e.message || e) }; }
  });

  registerLensAction("sponsorship", "list_messages", (ctx, artifact, _params = {}) => {
    try {
      const userId = actor(ctx);
      const s = getState();
      const messages = (s.messages.get(userId) || []).slice();
      const unread = messages.filter((m) => !m.read).length;
      return { ok: true, result: { messages, count: messages.length, unread } };
    } catch (e) { return { ok: false, error: String(e.message || e) }; }
  });

  registerLensAction("sponsorship", "mark_message_read", (ctx, artifact, params = {}) => {
    try {
      const userId = actor(ctx);
      const s = getState();
      const msg = (s.messages.get(userId) || []).find((m) => m.id === params.messageId);
      if (!msg) return { ok: false, error: "message not found" };
      msg.read = true;
      return { ok: true, result: { messageId: msg.id, read: true } };
    } catch (e) { return { ok: false, error: String(e.message || e) }; }
  });
}
