// server/domains/deities.js
//
// Deities domain — in-game pantheon system (player-composed patron deities).
// Implements the deities-lens feature backlog: deity detail view, live
// commune dialogue driven by tone vector + alignment thresholds, deity
// editing, per-player pilgrimage history + devotion tracking, alignment-
// gated blessings/boons, and pantheon search/filter by tone or popularity.
//
// Persistent per-deployment data lives in globalThis._concordSTATE Maps so
// the substrate survives across requests (and is checkpointed by the
// debounced state saver). Every handler is try/catch wrapped and returns
// { ok: boolean, result?, error? } — never throws.

export default function registerDeitiesActions(registerLensAction) {
  // ─── Shared state helpers ─────────────────────────────────────────────
  function getDeitiesState() {
    const STATE = globalThis._concordSTATE || (globalThis._concordSTATE = {});
    if (!STATE.deitiesLens) STATE.deitiesLens = {};
    const s = STATE.deitiesLens;
    // deities: id -> deity record
    // pilgrimages: id -> pilgrimage record
    // devotion: `${userId}::${deityId}` -> devotion record
    // commune: deityId -> [ recent commune utterances ]
    // blessings: userId -> [ granted blessing records ]
    for (const k of ["deities", "pilgrimages", "devotion", "commune", "blessings"]) {
      if (!(s[k] instanceof Map)) s[k] = new Map();
    }
    if (typeof s.seq !== "number") s.seq = 1;
    return s;
  }
  function saveState() {
    if (typeof globalThis._concordSaveStateDebounced === "function") {
      try { globalThis._concordSaveStateDebounced(); } catch (_e) { /* best effort */ }
    }
  }
  const dNow = () => Date.now();
  const dAid = (ctx) => ctx?.actor?.userId || ctx?.userId || "anon";
  const dClean = (v, max = 200) => String(v == null ? "" : v).trim().slice(0, max);
  const dNum = (v, d = 0) => { const n = Number(v); return Number.isFinite(n) ? n : d; };
  const dClamp01 = (v, d = 0.5) => Math.max(0, Math.min(1, dNum(v, d)));
  const dArr = (v) => (Array.isArray(v) ? v : v == null ? [] : [v]);
  const nextId = (s, p) => `${p}_${(s.seq++).toString(36)}_${Math.random().toString(36).slice(2, 6)}`;

  // Normalise a tone vector to the three canonical axes [0,1].
  function normTone(raw = {}) {
    return {
      warmth: dClamp01(raw.warmth, 0.5),
      refusal: dClamp01(raw.refusal, 0.3),
      mystery: dClamp01(raw.mystery, 0.5),
    };
  }
  // Normalise alignment thresholds — `commune` is the minimum alignment to
  // be received warmly, `refuse` the alignment below which the deity turns
  // away. Defaults mirror the original inline macro.
  function normThresholds(raw = {}) {
    return {
      commune: Math.max(-1, Math.min(1, dNum(raw.commune, 0.5))),
      refuse: Math.max(-1, Math.min(1, dNum(raw.refuse, -0.3))),
    };
  }
  // Sanitise a dialogue-templates list — each entry { trigger, text }.
  function normTemplates(raw, name) {
    const list = dArr(raw)
      .map((t) => ({
        trigger: dClean(t?.trigger, 60),
        text: dClean(t?.text, 600),
      }))
      .filter((t) => t.trigger && t.text)
      .slice(0, 24);
    if (list.length) return list;
    // Default three-template scaffold so a deity always has a voice.
    const n = name || "The deity";
    return [
      { trigger: "greet", text: `${n} regards you in silence.` },
      { trigger: "commune_low_alignment", text: `${n} turns away.` },
      { trigger: "commune_high_alignment", text: `${n} extends a hand.` },
    ];
  }

  // Public-facing summary of a deity (no internal index churn).
  function summarise(d) {
    return {
      id: d.id,
      name: d.name,
      author_user_id: d.authorUserId,
      authorUserId: d.authorUserId,
      domainTitle: d.domainTitle,
      created_at: Math.floor(d.createdAt / 1000),
      createdAt: d.createdAt,
      updatedAt: d.updatedAt,
      revision: d.revision,
      pilgrim_count: d.pilgrimCount,
      pilgrimCount: d.pilgrimCount,
      originPeer: d.originPeer || null,
    };
  }

  // Devotion record key + lazy creation.
  function devotionKey(userId, deityId) { return `${userId}::${deityId}`; }
  function getDevotion(s, userId, deityId) {
    const key = devotionKey(userId, deityId);
    let rec = s.devotion.get(key);
    if (!rec) {
      rec = {
        userId, deityId,
        pilgrimages: 0,
        devotionScore: 0,        // accrues per pilgrimage / commune
        alignment: 0,            // -1..1, the player's standing with the deity
        firstAt: dNow(),
        lastAt: dNow(),
        blessingsClaimed: [],    // boon ids already claimed at each tier
        communeCount: 0,
      };
      s.devotion.set(key, rec);
    }
    return rec;
  }

  // ── Blessing tiers — alignment-gated boons. Each deity grants the same
  // structural ladder; the boon's flavour is coloured by its tone vector.
  const BLESSING_TIERS = [
    { id: "acolyte", label: "Acolyte's Favor", minDevotion: 1, minAlignment: 0.0, magnitude: 0.05 },
    { id: "supplicant", label: "Supplicant's Grace", minDevotion: 3, minAlignment: 0.2, magnitude: 0.10 },
    { id: "chosen", label: "Chosen's Boon", minDevotion: 7, minAlignment: 0.45, magnitude: 0.18 },
    { id: "avatar", label: "Avatar's Mantle", minDevotion: 15, minAlignment: 0.7, magnitude: 0.30 },
  ];
  // The stat a blessing buffs is derived from the deity's dominant tone axis.
  function boonEffect(tone, magnitude) {
    const axes = [
      ["warmth", tone.warmth, "vitality"],
      ["refusal", tone.refusal, "resilience"],
      ["mystery", tone.mystery, "insight"],
    ].sort((a, b) => b[1] - a[1]);
    const [axis, , stat] = axes[0];
    return { stat, axis, magnitude: Math.round(magnitude * 100) / 100 };
  }

  // ───────────────────────────────────────────────────────────────────────
  // 1. Compose a deity — name + tone vector + dialogue templates + thresholds
  // ───────────────────────────────────────────────────────────────────────
  registerLensAction("deity", "compose", (ctx, _a, params = {}) => {
    try {
      const s = getDeitiesState();
      const userId = dAid(ctx);
      const name = dClean(params.name, 80);
      if (!name) return { ok: false, error: "deity name required" };
      const tone = normTone(params.toneVector || params.tone || {});
      const id = nextId(s, "deity");
      const deity = {
        id,
        authorUserId: userId,
        name,
        domainTitle: dClean(params.domainTitle, 80) || "Patron of the unspoken",
        toneVector: tone,
        dialogueTemplates: normTemplates(params.dialogueTemplates, name),
        alignmentThresholds: normThresholds(params.alignmentThresholds || {}),
        creed: dClean(params.creed, 600),
        revision: 1,
        pilgrimCount: 0,
        originPeer: dClean(params.originPeer, 120) || null,
        createdAt: dNow(),
        updatedAt: dNow(),
      };
      s.deities.set(id, deity);
      saveState();
      return { ok: true, result: { deity: summarise(deity), deityId: id } };
    } catch (e) { return { ok: false, error: e.message }; }
  });

  // ───────────────────────────────────────────────────────────────────────
  // 2. Pantheon list — ranked by pilgrim count
  // ───────────────────────────────────────────────────────────────────────
  registerLensAction("deity", "list", (_ctx, _a, params = {}) => {
    try {
      const s = getDeitiesState();
      const limit = Math.min(100, Math.max(1, Math.round(dNum(params.limit, 50))));
      const deities = [...s.deities.values()]
        .sort((a, b) => b.pilgrimCount - a.pilgrimCount || b.createdAt - a.createdAt)
        .slice(0, limit)
        .map(summarise);
      return { ok: true, result: { deities, count: deities.length } };
    } catch (e) { return { ok: false, error: e.message }; }
  });

  // ───────────────────────────────────────────────────────────────────────
  // 3. Pantheon search / filter — by name, tone axis, popularity   [S]
  // ───────────────────────────────────────────────────────────────────────
  registerLensAction("deity", "search", (_ctx, _a, params = {}) => {
    try {
      const s = getDeitiesState();
      const q = dClean(params.query, 60).toLowerCase();
      const toneAxis = ["warmth", "refusal", "mystery"].includes(params.toneAxis)
        ? params.toneAxis : null;
      const minTone = dClamp01(params.minTone, 0);
      const minPilgrims = Math.max(0, Math.round(dNum(params.minPilgrims, 0)));
      const sort = ["popularity", "newest", "tone"].includes(params.sort)
        ? params.sort : "popularity";
      let list = [...s.deities.values()];
      if (q) {list = list.filter((d) =>
        d.name.toLowerCase().includes(q) ||
        (d.domainTitle || "").toLowerCase().includes(q) ||
        (d.creed || "").toLowerCase().includes(q));}
      if (toneAxis) list = list.filter((d) => d.toneVector[toneAxis] >= minTone);
      if (minPilgrims > 0) list = list.filter((d) => d.pilgrimCount >= minPilgrims);
      list.sort((a, b) => {
        if (sort === "newest") return b.createdAt - a.createdAt;
        if (sort === "tone" && toneAxis) return b.toneVector[toneAxis] - a.toneVector[toneAxis];
        return b.pilgrimCount - a.pilgrimCount || b.createdAt - a.createdAt;
      });
      return {
        ok: true,
        result: {
          deities: list.slice(0, 100).map(summarise),
          count: list.length,
          query: q, toneAxis, minTone, minPilgrims, sort,
        },
      };
    } catch (e) { return { ok: false, error: e.message }; }
  });

  // ───────────────────────────────────────────────────────────────────────
  // 4. Deity detail view — tone vector, templates, pilgrim roster   [M]
  // ───────────────────────────────────────────────────────────────────────
  registerLensAction("deity", "detail", (ctx, _a, params = {}) => {
    try {
      const s = getDeitiesState();
      const deityId = dClean(params.deityId, 64);
      if (!deityId) return { ok: false, error: "deityId required" };
      const d = s.deities.get(deityId);
      if (!d) return { ok: false, error: "deity not found" };
      const userId = dAid(ctx);
      const roster = [...s.pilgrimages.values()]
        .filter((p) => p.deityId === deityId)
        .sort((a, b) => b.arrivedAt - a.arrivedAt)
        .slice(0, 50)
        .map((p) => ({
          id: p.id,
          pilgrim_user_id: p.userId,
          pilgrimUserId: p.userId,
          origin_peer: p.originPeer || null,
          originPeer: p.originPeer || null,
          arrived_at: Math.floor(p.arrivedAt / 1000),
          arrivedAt: p.arrivedAt,
        }));
      const myDevotion = s.devotion.get(devotionKey(userId, deityId)) || null;
      return {
        ok: true,
        result: {
          deity: {
            ...summarise(d),
            toneVector: d.toneVector,
            dialogueTemplates: d.dialogueTemplates,
            alignmentThresholds: d.alignmentThresholds,
            creed: d.creed,
          },
          pilgrimRoster: roster,
          rosterCount: roster.length,
          isAuthor: d.authorUserId === userId,
          myDevotion,
        },
      };
    } catch (e) { return { ok: false, error: e.message }; }
  });

  // ───────────────────────────────────────────────────────────────────────
  // 5. Deity editing — revise tone / templates / thresholds after compose [S]
  //    Only the author may edit. Bumps revision.
  // ───────────────────────────────────────────────────────────────────────
  registerLensAction("deity", "revise", (ctx, _a, params = {}) => {
    try {
      const s = getDeitiesState();
      const userId = dAid(ctx);
      const deityId = dClean(params.deityId, 64);
      if (!deityId) return { ok: false, error: "deityId required" };
      const d = s.deities.get(deityId);
      if (!d) return { ok: false, error: "deity not found" };
      if (d.authorUserId !== userId) return { ok: false, error: "only the author may revise this deity" };
      if (params.name != null) {
        const nm = dClean(params.name, 80);
        if (!nm) return { ok: false, error: "name cannot be empty" };
        d.name = nm;
      }
      if (params.domainTitle != null) d.domainTitle = dClean(params.domainTitle, 80) || d.domainTitle;
      if (params.creed != null) d.creed = dClean(params.creed, 600);
      if (params.toneVector || params.tone) d.toneVector = normTone(params.toneVector || params.tone);
      if (params.dialogueTemplates != null) d.dialogueTemplates = normTemplates(params.dialogueTemplates, d.name);
      if (params.alignmentThresholds != null) d.alignmentThresholds = normThresholds(params.alignmentThresholds);
      d.revision += 1;
      d.updatedAt = dNow();
      saveState();
      return { ok: true, result: { deity: summarise(d), revision: d.revision } };
    } catch (e) { return { ok: false, error: e.message }; }
  });

  // ───────────────────────────────────────────────────────────────────────
  // 6. Pilgrimage — records a pilgrim, bumps pilgrim_count, accrues devotion
  //    Federation-aware via originPeer.
  // ───────────────────────────────────────────────────────────────────────
  registerLensAction("deity", "pilgrimage", (ctx, _a, params = {}) => {
    try {
      const s = getDeitiesState();
      const userId = dAid(ctx);
      const deityId = dClean(params.deityId, 64);
      if (!deityId) return { ok: false, error: "deityId required" };
      const d = s.deities.get(deityId);
      if (!d) return { ok: false, error: "deity not found" };
      const originPeer = dClean(params.originPeer, 120) || null;
      const id = nextId(s, "pilg");
      const pilg = { id, deityId, userId, originPeer, arrivedAt: dNow() };
      s.pilgrimages.set(id, pilg);
      d.pilgrimCount += 1;
      // Devotion accrues — pilgrimage raises devotion and nudges alignment up.
      const dev = getDevotion(s, userId, deityId);
      dev.pilgrimages += 1;
      dev.devotionScore += 1;
      dev.alignment = Math.min(1, dev.alignment + 0.08);
      dev.lastAt = dNow();
      saveState();
      return {
        ok: true,
        result: {
          deityId,
          pilgrimageId: id,
          newPilgrimCount: d.pilgrimCount,
          devotion: { score: dev.devotionScore, alignment: Math.round(dev.alignment * 100) / 100 },
        },
      };
    } catch (e) { return { ok: false, error: e.message }; }
  });

  // ───────────────────────────────────────────────────────────────────────
  // 7. Pilgrim log — full pilgrimage roster for a deity
  // ───────────────────────────────────────────────────────────────────────
  registerLensAction("deity", "pilgrim_log", (_ctx, _a, params = {}) => {
    try {
      const s = getDeitiesState();
      const deityId = dClean(params.deityId, 64);
      if (!deityId) return { ok: false, error: "deityId required" };
      const limit = Math.min(200, Math.max(1, Math.round(dNum(params.limit, 50))));
      const pilgrims = [...s.pilgrimages.values()]
        .filter((p) => p.deityId === deityId)
        .sort((a, b) => b.arrivedAt - a.arrivedAt)
        .slice(0, limit)
        .map((p) => ({
          id: p.id,
          pilgrim_user_id: p.userId,
          origin_peer: p.originPeer || null,
          arrived_at: Math.floor(p.arrivedAt / 1000),
        }));
      return { ok: true, result: { pilgrims, count: pilgrims.length } };
    } catch (e) { return { ok: false, error: e.message }; }
  });

  // ───────────────────────────────────────────────────────────────────────
  // 8. Pilgrimage history / personal devotion tracking per player  [S]
  // ───────────────────────────────────────────────────────────────────────
  registerLensAction("deity", "my_devotion", (ctx, _a, _params = {}) => {
    try {
      const s = getDeitiesState();
      const userId = dAid(ctx);
      const entries = [];
      for (const rec of s.devotion.values()) {
        if (rec.userId !== userId) continue;
        const d = s.deities.get(rec.deityId);
        if (!d) continue;
        entries.push({
          deityId: rec.deityId,
          deityName: d.name,
          pilgrimages: rec.pilgrimages,
          devotionScore: rec.devotionScore,
          communeCount: rec.communeCount,
          alignment: Math.round(rec.alignment * 100) / 100,
          firstAt: rec.firstAt,
          lastAt: rec.lastAt,
          blessingsClaimed: rec.blessingsClaimed.length,
        });
      }
      entries.sort((a, b) => b.lastAt - a.lastAt);
      const totalPilgrimages = entries.reduce((acc, e) => acc + e.pilgrimages, 0);
      return {
        ok: true,
        result: {
          devotions: entries,
          patronCount: entries.length,
          totalPilgrimages,
          topPatron: entries.slice().sort((a, b) => b.devotionScore - a.devotionScore)[0] || null,
        },
      };
    } catch (e) { return { ok: false, error: e.message }; }
  });

  // ───────────────────────────────────────────────────────────────────────
  // 9. Live commune dialogue — talk to a deity using its tone vector +
  //    alignment thresholds. Picks a trigger template and colours the reply
  //    by tone. Communing also accrues a little devotion + alignment.   [M]
  // ───────────────────────────────────────────────────────────────────────
  function pickTemplate(templates, trigger) {
    return templates.find((t) => t.trigger === trigger)
      || templates.find((t) => t.trigger === "greet")
      || templates[0]
      || null;
  }
  // Colour an utterance by tone — prefix/suffix flourishes derived from the
  // three axes. Pure-compute, deterministic, no LLM.
  function toneFlourish(tone) {
    const parts = [];
    if (tone.mystery >= 0.66) parts.push("A cold star turns overhead.");
    else if (tone.mystery <= 0.33) parts.push("The air is plain and clear.");
    if (tone.warmth >= 0.66) parts.push("Warmth gathers where you stand.");
    else if (tone.warmth <= 0.33) parts.push("No comfort is offered.");
    if (tone.refusal >= 0.66) parts.push("A boundary is felt, unspoken.");
    return parts;
  }
  registerLensAction("deity", "commune", (ctx, _a, params = {}) => {
    try {
      const s = getDeitiesState();
      const userId = dAid(ctx);
      const deityId = dClean(params.deityId, 64);
      if (!deityId) return { ok: false, error: "deityId required" };
      const d = s.deities.get(deityId);
      if (!d) return { ok: false, error: "deity not found" };
      const dev = getDevotion(s, userId, deityId);
      const offering = dClean(params.offering, 240);
      const intent = ["greet", "petition", "offering", "question"].includes(params.intent)
        ? params.intent : "greet";
      // Resolve alignment-based reception against the deity's thresholds.
      const align = dev.alignment;
      const th = d.alignmentThresholds;
      let reception, trigger;
      if (align < th.refuse) { reception = "refused"; trigger = "commune_low_alignment"; }
      else if (align >= th.commune) { reception = "received"; trigger = "commune_high_alignment"; }
      else { reception = "neutral"; trigger = "greet"; }
      // Intent shifts the trigger lookup for a petition/offering when received.
      if (reception === "received" && intent === "offering") trigger = "commune_high_alignment";
      const tmpl = pickTemplate(d.dialogueTemplates, trigger);
      const flourish = toneFlourish(d.toneVector);
      const lines = [];
      if (flourish.length) lines.push(flourish[0]);
      lines.push(tmpl ? tmpl.text : `${d.name} is silent.`);
      if (reception === "received" && offering) {
        lines.push(`Your offering — "${offering}" — is acknowledged.`);
      }
      if (reception === "refused") {
        lines.push("Return when your standing has mended.");
      }
      // Communing accrues a small devotion bump; offerings nudge alignment up.
      dev.communeCount += 1;
      dev.devotionScore += reception === "refused" ? 0 : 0.5;
      if (reception !== "refused" && (intent === "offering" || offering)) {
        dev.alignment = Math.min(1, dev.alignment + 0.04);
      }
      if (reception === "refused") {
        dev.alignment = Math.min(1, dev.alignment + 0.01); // penance still counts a little
      }
      dev.lastAt = dNow();
      // Keep a short rolling commune log per deity for the detail view.
      let log = s.commune.get(deityId);
      if (!Array.isArray(log)) { log = []; s.commune.set(deityId, log); }
      const utterance = {
        id: nextId(s, "comm"),
        userId, intent, reception,
        text: lines.join(" "),
        at: dNow(),
      };
      log.push(utterance);
      if (log.length > 60) log.splice(0, log.length - 60);
      saveState();
      return {
        ok: true,
        result: {
          deityId,
          deityName: d.name,
          reception,
          intent,
          trigger,
          utterance: utterance.text,
          toneVector: d.toneVector,
          devotion: {
            score: Math.round(dev.devotionScore * 10) / 10,
            alignment: Math.round(dev.alignment * 100) / 100,
            communeCount: dev.communeCount,
          },
        },
      };
    } catch (e) { return { ok: false, error: e.message }; }
  });

  // Recent commune log for a deity (detail-view feed).
  registerLensAction("deity", "commune_log", (_ctx, _a, params = {}) => {
    try {
      const s = getDeitiesState();
      const deityId = dClean(params.deityId, 64);
      if (!deityId) return { ok: false, error: "deityId required" };
      const log = s.commune.get(deityId);
      const utterances = Array.isArray(log)
        ? log.slice().reverse().slice(0, Math.min(60, Math.max(1, Math.round(dNum(params.limit, 30)))))
        : [];
      return { ok: true, result: { utterances, count: utterances.length } };
    } catch (e) { return { ok: false, error: e.message }; }
  });

  // ───────────────────────────────────────────────────────────────────────
  // 10. Blessings / boons tied to alignment — gameplay payoff for pilgrimage
  //     `blessings` lists what's available + claimable for the caller; the
  //     `bless` macro claims an unlocked tier.   [M]
  // ───────────────────────────────────────────────────────────────────────
  function evalTiers(d, dev) {
    return BLESSING_TIERS.map((t) => {
      const claimed = dev.blessingsClaimed.includes(t.id);
      const unlocked = dev.devotionScore >= t.minDevotion && dev.alignment >= t.minAlignment;
      return {
        id: t.id,
        label: t.label,
        minDevotion: t.minDevotion,
        minAlignment: t.minAlignment,
        effect: boonEffect(d.toneVector, t.magnitude),
        unlocked,
        claimed,
        claimable: unlocked && !claimed,
      };
    });
  }

  registerLensAction("deity", "blessings", (ctx, _a, params = {}) => {
    try {
      const s = getDeitiesState();
      const userId = dAid(ctx);
      const deityId = dClean(params.deityId, 64);
      if (!deityId) return { ok: false, error: "deityId required" };
      const d = s.deities.get(deityId);
      if (!d) return { ok: false, error: "deity not found" };
      const dev = getDevotion(s, userId, deityId);
      const tiers = evalTiers(d, dev);
      return {
        ok: true,
        result: {
          deityId,
          deityName: d.name,
          devotion: {
            score: Math.round(dev.devotionScore * 10) / 10,
            alignment: Math.round(dev.alignment * 100) / 100,
          },
          tiers,
          nextTier: tiers.find((t) => !t.unlocked) || null,
        },
      };
    } catch (e) { return { ok: false, error: e.message }; }
  });

  registerLensAction("deity", "bless", (ctx, _a, params = {}) => {
    try {
      const s = getDeitiesState();
      const userId = dAid(ctx);
      const deityId = dClean(params.deityId, 64);
      const tierId = dClean(params.tierId, 32);
      if (!deityId) return { ok: false, error: "deityId required" };
      if (!tierId) return { ok: false, error: "tierId required" };
      const d = s.deities.get(deityId);
      if (!d) return { ok: false, error: "deity not found" };
      const tier = BLESSING_TIERS.find((t) => t.id === tierId);
      if (!tier) return { ok: false, error: "unknown blessing tier" };
      const dev = getDevotion(s, userId, deityId);
      if (dev.blessingsClaimed.includes(tierId)) {
        return { ok: false, error: "blessing already claimed" };
      }
      if (dev.devotionScore < tier.minDevotion || dev.alignment < tier.minAlignment) {
        return { ok: false, error: "alignment or devotion too low for this blessing" };
      }
      const effect = boonEffect(d.toneVector, tier.magnitude);
      const blessing = {
        id: nextId(s, "bless"),
        deityId, deityName: d.name,
        tierId, tierLabel: tier.label,
        effect,
        grantedAt: dNow(),
      };
      dev.blessingsClaimed.push(tierId);
      dev.lastAt = dNow();
      let owned = s.blessings.get(userId);
      if (!Array.isArray(owned)) { owned = []; s.blessings.set(userId, owned); }
      owned.push(blessing);
      saveState();
      return { ok: true, result: { blessing } };
    } catch (e) { return { ok: false, error: e.message }; }
  });

  // List all blessings the caller has been granted across the pantheon.
  registerLensAction("deity", "my_blessings", (ctx, _a, _params = {}) => {
    try {
      const s = getDeitiesState();
      const userId = dAid(ctx);
      const owned = s.blessings.get(userId);
      const blessings = Array.isArray(owned)
        ? owned.slice().sort((a, b) => b.grantedAt - a.grantedAt) : [];
      return { ok: true, result: { blessings, count: blessings.length } };
    } catch (e) { return { ok: false, error: e.message }; }
  });

  // ── Legacy alias kept for the original inline-macro contract ───────────
  registerLensAction("deity", "tone_vector", (_ctx, _a, params = {}) => {
    try {
      const s = getDeitiesState();
      const deityId = dClean(params.deityId, 64);
      if (!deityId) return { ok: false, error: "deityId required" };
      const d = s.deities.get(deityId);
      if (!d) return { ok: false, error: "deity not found" };
      return {
        ok: true,
        result: {
          deityId,
          name: d.name,
          toneVector: d.toneVector,
          templates: d.dialogueTemplates,
          thresholds: d.alignmentThresholds,
          pilgrim_count: d.pilgrimCount,
        },
      };
    } catch (e) { return { ok: false, error: e.message }; }
  });
}
