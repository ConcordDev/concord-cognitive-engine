// server/domains/srs.js
//
// Anki 2026-parity spaced-repetition system. Pure-compute analytics
// (SM-2 schedule projection, retention curve, card difficulty, deck
// stats) PLUS a real per-user deck/card/study substrate: create decks,
// add cards, run study sessions with modern SM-2 scheduling, and track
// review history.

export default function registerSrsActions(registerLensAction) {
  registerLensAction("srs", "spacedRepetitionSchedule", (ctx, artifact, _params) => {
    const cards = artifact.data?.cards || [];
    if (cards.length === 0) return { ok: true, result: { message: "Add flashcards with review history to schedule." } };
    const now = new Date();
    const scheduled = cards.map((card, i) => {
      let ease = parseFloat(card.ease || card.easeFactor) || 2.5;
      let interval = parseInt(card.interval) || 1;
      const quality = parseInt(card.lastQuality || card.quality) || 3;
      const lastReview = card.lastReview ? new Date(card.lastReview) : null;
      // SM-2 algorithm
      if (quality >= 3) {
        if (interval === 1) interval = 1;
        else if (interval === 2) interval = 6;
        else interval = Math.round(interval * ease);
        ease = Math.max(1.3, ease + (0.1 - (5 - quality) * (0.08 + (5 - quality) * 0.02)));
      } else {
        interval = 1;
        ease = Math.max(1.3, ease - 0.2);
      }
      const nextReview = lastReview
        ? new Date(lastReview.getTime() + interval * 86400000)
        : now;
      const daysUntil = Math.ceil((nextReview.getTime() - now.getTime()) / 86400000);
      return {
        id: card.id || `card-${i}`,
        front: (card.front || card.question || "").slice(0, 50),
        ease: Math.round(ease * 100) / 100,
        interval,
        nextReview: nextReview.toISOString().split("T")[0],
        daysUntil,
        status: daysUntil <= 0 ? "due" : daysUntil <= 1 ? "soon" : "scheduled",
      };
    });
    const due = scheduled.filter(c => c.status === "due");
    const soon = scheduled.filter(c => c.status === "soon");
    return { ok: true, result: { totalCards: cards.length, dueNow: due.length, dueSoon: soon.length, dueCards: due.map(c => c.id), schedule: scheduled.sort((a, b) => a.daysUntil - b.daysUntil), avgEase: Math.round((scheduled.reduce((s, c) => s + c.ease, 0) / scheduled.length) * 100) / 100, avgInterval: Math.round(scheduled.reduce((s, c) => s + c.interval, 0) / scheduled.length) } };
  });

  registerLensAction("srs", "retentionCurve", (ctx, artifact, _params) => {
    const reviews = artifact.data?.reviews || [];
    const halfLife = parseFloat(artifact.data?.halfLife) || 7;
    if (reviews.length === 0) return { ok: true, result: { message: "Provide review data to model retention curve." } };
    const now = new Date();
    const lastReview = reviews.length > 0 ? new Date(reviews[reviews.length - 1].date || reviews[reviews.length - 1].timestamp || now) : now;
    const correctRate = reviews.filter(r => r.correct || r.quality >= 3).length / reviews.length;
    const adjustedHalfLife = halfLife * (1 + (correctRate - 0.5) * 2);
    const curve = [];
    for (let day = 0; day <= 30; day++) {
      const retention = Math.round(Math.exp(-0.693 * day / adjustedHalfLife) * 1000) / 10;
      curve.push({ day, retention });
    }
    const daysSinceReview = Math.ceil((now.getTime() - lastReview.getTime()) / 86400000);
    const currentRetention = Math.round(Math.exp(-0.693 * daysSinceReview / adjustedHalfLife) * 1000) / 10;
    const optimalReviewDay = Math.ceil(adjustedHalfLife * Math.log(100 / 85) / 0.693);
    return { ok: true, result: { reviewCount: reviews.length, correctRate: Math.round(correctRate * 100), halfLifeDays: Math.round(adjustedHalfLife * 10) / 10, daysSinceLastReview: daysSinceReview, currentRetention, optimalReviewDay, retentionCurve: curve, recommendation: currentRetention < 80 ? "Review immediately — retention below 80%" : currentRetention < 90 ? "Review soon to maintain retention" : "Retention is good — review scheduled optimally" } };
  });

  registerLensAction("srs", "cardDifficulty", (ctx, artifact, _params) => {
    const cards = artifact.data?.cards || [];
    if (cards.length === 0) return { ok: true, result: { message: "Provide cards with review history to classify difficulty." } };
    const analyzed = cards.map((card, i) => {
      const history = card.history || card.reviews || [];
      const attempts = history.length || parseInt(card.attempts) || 1;
      const correct = history.filter(h => h.correct || h.quality >= 3).length || parseInt(card.correct) || 0;
      const accuracy = attempts > 0 ? Math.round((correct / attempts) * 100) : 50;
      const avgTime = history.length > 0 ? Math.round(history.reduce((s, h) => s + (parseFloat(h.time || h.responseTime) || 5), 0) / history.length) : null;
      let difficulty;
      if (accuracy >= 90 && attempts >= 3) difficulty = "easy";
      else if (accuracy >= 70) difficulty = "medium";
      else if (accuracy >= 40) difficulty = "hard";
      else difficulty = "very-hard";
      return { id: card.id || `card-${i}`, front: (card.front || card.question || "").slice(0, 50), attempts, correct, accuracy, avgResponseTime: avgTime, difficulty, suggestion: difficulty === "very-hard" ? "Consider rephrasing or adding context" : difficulty === "hard" ? "Break into smaller concepts" : difficulty === "easy" && attempts > 5 ? "Move to long-term review interval" : "On track" };
    });
    const distribution = { easy: analyzed.filter(c => c.difficulty === "easy").length, medium: analyzed.filter(c => c.difficulty === "medium").length, hard: analyzed.filter(c => c.difficulty === "hard").length, "very-hard": analyzed.filter(c => c.difficulty === "very-hard").length };
    return { ok: true, result: { totalCards: cards.length, distribution, avgAccuracy: Math.round(analyzed.reduce((s, c) => s + c.accuracy, 0) / analyzed.length), hardestCards: analyzed.filter(c => c.difficulty === "very-hard" || c.difficulty === "hard").sort((a, b) => a.accuracy - b.accuracy).slice(0, 10), cards: analyzed } };
  });

  registerLensAction("srs", "deckStats", (ctx, artifact, _params) => {
    const cards = artifact.data?.cards || [];
    const deckName = artifact.data?.name || "Untitled Deck";
    if (cards.length === 0) return { ok: true, result: { message: "Provide deck cards to compute statistics." } };
    const now = new Date();
    let mastered = 0, learning = 0, newCards = 0, lapsed = 0;
    let totalEase = 0, totalInterval = 0;
    cards.forEach(card => {
      const interval = parseInt(card.interval) || 0;
      const reviews = parseInt(card.reviewCount || card.attempts) || 0;
      const ease = parseFloat(card.ease) || 2.5;
      totalEase += ease;
      totalInterval += interval;
      if (reviews === 0) newCards++;
      else if (interval >= 21) mastered++;
      else if (ease < 1.5) lapsed++;
      else learning++;
    });
    const avgEase = Math.round((totalEase / cards.length) * 100) / 100;
    const avgInterval = Math.round(totalInterval / cards.length);
    const masteryRate = Math.round((mastered / cards.length) * 100);
    const dueToday = cards.filter(c => {
      if (!c.nextReview) return true;
      return new Date(c.nextReview) <= now;
    }).length;
    const estimatedDays = learning > 0 ? Math.ceil(learning * avgInterval * 0.5) : mastered > 0 ? 0 : cards.length * 7;
    return { ok: true, result: { deckName, totalCards: cards.length, new: newCards, learning, mastered, lapsed, masteryRate, avgEase, avgInterval, dueToday, projectedMasteryDays: estimatedDays, healthScore: masteryRate >= 80 ? "Excellent" : masteryRate >= 50 ? "Good" : masteryRate >= 20 ? "In Progress" : "Just Started" } };
  });

  // ─── Anki-shape deck/card/study substrate (per-user, STATE-backed) ───

  function getSrsState() {
    const STATE = globalThis._concordSTATE;
    if (!STATE) return null;
    if (!STATE.srsLens) STATE.srsLens = {};
    const s = STATE.srsLens;
    if (!(s.decks instanceof Map)) s.decks = new Map();       // userId -> Array<deck>
    if (!(s.cards instanceof Map)) s.cards = new Map();       // userId -> Array<card>
    if (!(s.reviewLog instanceof Map)) s.reviewLog = new Map(); // userId -> Array<review>
    if (!(s.media instanceof Map)) s.media = new Map();       // userId -> Array<media>
    return s;
  }
  function saveSrs() {
    if (typeof globalThis._concordSaveStateDebounced === "function") {
      try { globalThis._concordSaveStateDebounced(); } catch (_e) { /* best effort */ }
    }
  }
  const srsId = (p) => `${p}_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`;
  const srsNow = () => new Date().toISOString();
  const srsActor = (ctx) => ctx?.actor?.userId || ctx?.userId || "anon";
  const srsClean = (v, max = 2000) => String(v == null ? "" : v).trim().slice(0, max);
  const srsList = (m, k) => { if (!m.has(k)) m.set(k, []); return m.get(k); };
  const NEW_PER_DAY = 20;

  function cardsForDeck(s, userId, deckId) {
    return srsList(s.cards, userId).filter((c) => c.deckId === deckId);
  }
  function isDue(card) {
    return card.state !== "new" && new Date(card.due).getTime() <= Date.now();
  }

  // Per-deck study options (Anki-shape) with defensive defaults.
  function defaultDeckOptions() {
    return {
      newPerDay: NEW_PER_DAY,
      reviewsPerDay: 200,
      learningSteps: [1, 10],   // minutes
      scheduler: "fsrs",        // "fsrs" | "sm2"
    };
  }
  function normaliseOptions(raw = {}) {
    const d = defaultDeckOptions();
    const o = { ...d };
    if (Number.isFinite(+raw.newPerDay)) o.newPerDay = Math.max(0, Math.min(9999, Math.round(+raw.newPerDay)));
    if (Number.isFinite(+raw.reviewsPerDay)) o.reviewsPerDay = Math.max(0, Math.min(99999, Math.round(+raw.reviewsPerDay)));
    if (Array.isArray(raw.learningSteps)) {
      const steps = raw.learningSteps.map((n) => +n).filter((n) => Number.isFinite(n) && n > 0).slice(0, 8);
      if (steps.length) o.learningSteps = steps;
    }
    if (raw.scheduler === "sm2" || raw.scheduler === "fsrs") o.scheduler = raw.scheduler;
    return o;
  }

  registerLensAction("srs", "deck-create", (ctx, _a, params = {}) => {
    const s = getSrsState(); if (!s) return { ok: false, error: "STATE unavailable" };
    const name = srsClean(params.name, 120);
    if (!name) return { ok: false, error: "deck name required" };
    const userId = srsActor(ctx);
    const decks = srsList(s.decks, userId);
    let parentId = null;
    if (params.parentId) {
      const parent = decks.find((d) => d.id === params.parentId);
      if (!parent) return { ok: false, error: "parent deck not found" };
      parentId = parent.id;
    }
    const deck = {
      id: srsId("dk"), name,
      description: srsClean(params.description, 400),
      parentId,
      filtered: false,
      filterQuery: null,
      options: normaliseOptions(params.options),
      createdAt: srsNow(),
    };
    decks.push(deck);
    saveSrs();
    return { ok: true, result: { deck } };
  });

  registerLensAction("srs", "deck-list", (ctx, _a, _params = {}) => {
    const s = getSrsState(); if (!s) return { ok: false, error: "STATE unavailable" };
    const userId = srsActor(ctx);
    const decks = srsList(s.decks, userId).map((d) => {
      const cs = cardsForDeck(s, userId, d.id);
      const newCount = cs.filter((c) => c.state === "new").length;
      const dueCount = cs.filter(isDue).length;
      return {
        ...d,
        cardCount: cs.length,
        newCount,
        dueCount,
        studyCount: Math.min(NEW_PER_DAY, newCount) + dueCount,
      };
    });
    return { ok: true, result: { decks, count: decks.length } };
  });

  registerLensAction("srs", "deck-delete", (ctx, _a, params = {}) => {
    const s = getSrsState(); if (!s) return { ok: false, error: "STATE unavailable" };
    const userId = srsActor(ctx);
    const arr = srsList(s.decks, userId);
    const i = arr.findIndex((d) => d.id === params.id);
    if (i < 0) return { ok: false, error: "deck not found" };
    arr.splice(i, 1);
    s.cards.set(userId, srsList(s.cards, userId).filter((c) => c.deckId !== params.id));
    saveSrs();
    return { ok: true, result: { deleted: params.id } };
  });

  // Parse {{c1::answer}} cloze markup → list of generated sub-cards.
  function clozeIndices(text) {
    const idx = new Set();
    const re = /\{\{c(\d+)::/g;
    let m;
    while ((m = re.exec(text)) !== null) idx.add(parseInt(m[1], 10));
    return [...idx].sort((a, b) => a - b);
  }
  // Render a cloze card for a given index: the target index is hidden,
  // all other clozes show their answer text.
  function renderCloze(text, target) {
    const front = text.replace(/\{\{c(\d+)::(.*?)(?:::(.*?))?\}\}/g, (full, n, ans, hint) => {
      if (parseInt(n, 10) === target) return hint ? `[${hint}]` : "[...]";
      return ans;
    });
    const back = text.replace(/\{\{c(\d+)::(.*?)(?:::(.*?))?\}\}/g, (full, n, ans) => ans);
    return { front, back };
  }

  registerLensAction("srs", "card-add", (ctx, _a, params = {}) => {
    const s = getSrsState(); if (!s) return { ok: false, error: "STATE unavailable" };
    const userId = srsActor(ctx);
    const deck = srsList(s.decks, userId).find((d) => d.id === params.deckId);
    if (!deck) return { ok: false, error: "deck not found" };
    const cardType = ["basic", "cloze", "image-occlusion", "templated"].includes(params.cardType)
      ? params.cardType : "basic";
    const tags = Array.isArray(params.tags) ? params.tags.map((t) => srsClean(t, 30)).filter(Boolean).slice(0, 8) : [];
    const base = () => ({
      id: srsId("cd"), deckId: deck.id,
      tags: [...tags],
      ease: 2.5, interval: 0, reps: 0, lapses: 0,
      stability: 0, difficulty: 0,
      state: "new", due: srsNow(), createdAt: srsNow(), lastReviewedAt: null,
      suspended: false, buried: false,
      cardType,
      hint: srsClean(params.hint, 500),
      markup: params.markup === "markdown" || params.markup === "html" ? params.markup : "plain",
      media: {
        frontImage: srsClean(params.frontImage, 400) || null,
        backImage: srsClean(params.backImage, 400) || null,
        frontAudio: srsClean(params.frontAudio, 400) || null,
        backAudio: srsClean(params.backAudio, 400) || null,
        tts: !!params.tts,
      },
    });
    const cardsArr = srsList(s.cards, userId);

    if (cardType === "cloze") {
      const text = srsClean(params.text || params.front, 4000);
      const indices = clozeIndices(text);
      if (!text || indices.length === 0) return { ok: false, error: "cloze text with {{c1::...}} required" };
      const noteId = srsId("nt");
      const created = [];
      for (const ci of indices) {
        const { front, back } = renderCloze(text, ci);
        const c = { ...base(), front, back, noteId, clozeIndex: ci, clozeText: text };
        cardsArr.push(c);
        created.push(c);
      }
      saveSrs();
      return { ok: true, result: { card: created[0], cards: created, noteId, generated: created.length } };
    }

    if (cardType === "image-occlusion") {
      const image = srsClean(params.image || params.frontImage, 400);
      if (!image) return { ok: false, error: "image required for image-occlusion" };
      const occlusions = Array.isArray(params.occlusions)
        ? params.occlusions.map((o) => ({
            x: Math.max(0, Math.min(1, +o.x || 0)),
            y: Math.max(0, Math.min(1, +o.y || 0)),
            w: Math.max(0, Math.min(1, +o.w || 0.1)),
            h: Math.max(0, Math.min(1, +o.h || 0.1)),
            label: srsClean(o.label, 120),
          })).slice(0, 40)
        : [];
      if (occlusions.length === 0) return { ok: false, error: "at least one occlusion region required" };
      const noteId = srsId("nt");
      const created = [];
      occlusions.forEach((occ, oi) => {
        const c = {
          ...base(), noteId, occlusionIndex: oi,
          front: `Identify the masked region${occ.label ? "" : ` ${oi + 1}`}`,
          back: occ.label || `Region ${oi + 1}`,
          image, occlusions, hiddenRegion: oi,
        };
        c.media.frontImage = image;
        cardsArr.push(c);
        created.push(c);
      });
      saveSrs();
      return { ok: true, result: { card: created[0], cards: created, noteId, generated: created.length } };
    }

    if (cardType === "templated") {
      const fields = (params.fields && typeof params.fields === "object") ? params.fields : {};
      const cleanFields = {};
      for (const [k, v] of Object.entries(fields)) {
        cleanFields[srsClean(k, 40)] = srsClean(v, 2000);
      }
      const frontTpl = srsClean(params.frontTemplate, 2000) || "{{Front}}";
      const backTpl = srsClean(params.backTemplate, 4000) || "{{Back}}";
      const fill = (tpl) => tpl.replace(/\{\{(\w+)\}\}/g, (full, name) => cleanFields[name] != null ? cleanFields[name] : "");
      const front = fill(frontTpl);
      const back = fill(backTpl);
      if (!front || !back) return { ok: false, error: "templated card produced empty front/back" };
      const c = { ...base(), front, back, fields: cleanFields, frontTemplate: frontTpl, backTemplate: backTpl };
      cardsArr.push(c);
      saveSrs();
      return { ok: true, result: { card: c } };
    }

    // basic
    const front = srsClean(params.front, 2000);
    const back = srsClean(params.back, 4000);
    if (!front || !back) return { ok: false, error: "front and back required" };
    const card = { ...base(), front, back };
    cardsArr.push(card);
    saveSrs();
    return { ok: true, result: { card } };
  });

  registerLensAction("srs", "card-list", (ctx, _a, params = {}) => {
    const s = getSrsState(); if (!s) return { ok: false, error: "STATE unavailable" };
    if (!params.deckId) return { ok: false, error: "deckId required" };
    const cards = cardsForDeck(s, srsActor(ctx), params.deckId)
      .sort((a, b) => b.createdAt.localeCompare(a.createdAt));
    return { ok: true, result: { cards, count: cards.length } };
  });

  registerLensAction("srs", "card-update", (ctx, _a, params = {}) => {
    const s = getSrsState(); if (!s) return { ok: false, error: "STATE unavailable" };
    const card = srsList(s.cards, srsActor(ctx)).find((c) => c.id === params.id);
    if (!card) return { ok: false, error: "card not found" };
    if (params.front != null) card.front = srsClean(params.front, 2000) || card.front;
    if (params.back != null) card.back = srsClean(params.back, 4000) || card.back;
    if (Array.isArray(params.tags)) card.tags = params.tags.map((t) => srsClean(t, 30)).filter(Boolean).slice(0, 8);
    saveSrs();
    return { ok: true, result: { card } };
  });

  registerLensAction("srs", "card-delete", (ctx, _a, params = {}) => {
    const s = getSrsState(); if (!s) return { ok: false, error: "STATE unavailable" };
    const userId = srsActor(ctx);
    const arr = srsList(s.cards, userId);
    const i = arr.findIndex((c) => c.id === params.id);
    if (i < 0) return { ok: false, error: "card not found" };
    arr.splice(i, 1);
    saveSrs();
    return { ok: true, result: { deleted: params.id } };
  });

  function studyableCard(c) {
    return !c.suspended && !c.buried;
  }
  // Resolve the cards a deck draws from. Filtered decks pull from the
  // whole collection matched by their saved query; regular decks draw
  // their own cards plus all descendant sub-deck cards.
  function studyPool(s, userId, deck) {
    const all = srsList(s.cards, userId);
    if (deck.filtered) {
      const q = (deck.filterQuery || "").toLowerCase().trim();
      return all.filter((c) => {
        if (!studyableCard(c)) return false;
        if (!q) return true;
        if (q.startsWith("tag:")) return (c.tags || []).includes(q.slice(4));
        if (q.startsWith("is:due")) return isDue(c);
        if (q.startsWith("is:new")) return c.state === "new";
        return (c.front || "").toLowerCase().includes(q) || (c.back || "").toLowerCase().includes(q);
      });
    }
    const decks = srsList(s.decks, userId);
    const ids = new Set([deck.id]);
    let grew = true;
    while (grew) {
      grew = false;
      for (const d of decks) {
        if (d.parentId && ids.has(d.parentId) && !ids.has(d.id)) { ids.add(d.id); grew = true; }
      }
    }
    return all.filter((c) => ids.has(c.deckId) && studyableCard(c));
  }

  // study-next — the next card to study from a deck: due review cards
  // first, then up to the deck's newPerDay limit of new cards.
  registerLensAction("srs", "study-next", (ctx, _a, params = {}) => {
    const s = getSrsState(); if (!s) return { ok: false, error: "STATE unavailable" };
    const userId = srsActor(ctx);
    const deck = srsList(s.decks, userId).find((d) => d.id === params.deckId);
    if (!deck) return { ok: true, result: { card: null, remaining: 0 } };
    const cs = studyPool(s, userId, deck);
    if (cs.length === 0) return { ok: true, result: { card: null, remaining: 0 } };
    const opts = deck.options || defaultDeckOptions();
    const newCap = deck.filtered ? 9999 : opts.newPerDay;
    const due = cs.filter(isDue).sort((a, b) => a.due.localeCompare(b.due));
    if (due.length > 0) {
      return { ok: true, result: { card: due[0], remaining: due.length + Math.min(newCap, cs.filter((c) => c.state === "new").length) } };
    }
    const fresh = cs.filter((c) => c.state === "new");
    if (fresh.length > 0) {
      return { ok: true, result: { card: fresh[0], remaining: Math.min(newCap, fresh.length) } };
    }
    return { ok: true, result: { card: null, remaining: 0 } };
  });

  // ─── FSRS (Free Spaced Repetition Scheduler) — Anki's modern default ──
  // Compact FSRS-4.5-shape model: tracks per-card stability + difficulty
  // and derives the next interval from a target 90% retention.
  const FSRS_W = [
    0.4, 0.6, 2.4, 5.8, 4.93, 0.94, 0.86, 0.01, 1.49,
    0.14, 0.94, 2.18, 0.05, 0.34, 1.26, 0.29, 2.61,
  ];
  const FSRS_TARGET_R = 0.9;
  const FSRS_DECAY = -0.5;
  const FSRS_FACTOR = Math.pow(0.9, 1 / FSRS_DECAY) - 1;
  const RATING_GRADE = { again: 1, hard: 2, good: 3, easy: 4 };

  function fsrsInitDifficulty(g) {
    return Math.min(10, Math.max(1, FSRS_W[4] - Math.exp(FSRS_W[5] * (g - 1)) + 1));
  }
  function fsrsInitStability(g) {
    return Math.max(0.1, FSRS_W[g - 1]);
  }
  function fsrsRetrievability(elapsedDays, stability) {
    if (stability <= 0) return 0;
    return Math.pow(1 + FSRS_FACTOR * elapsedDays / stability, FSRS_DECAY);
  }
  function fsrsIntervalFromStability(stability) {
    const ivl = (stability / FSRS_FACTOR) * (Math.pow(FSRS_TARGET_R, 1 / FSRS_DECAY) - 1);
    return Math.max(1, Math.min(36500, Math.round(ivl)));
  }
  function fsrsNextDifficulty(d, g) {
    const next = d - FSRS_W[6] * (g - 3);
    const meanReversion = FSRS_W[7] * fsrsInitDifficulty(4) + (1 - FSRS_W[7]) * next;
    return Math.min(10, Math.max(1, meanReversion));
  }
  function fsrsNextStability(d, s, r, g) {
    if (g === 1) {
      // forgetting → post-lapse stability
      return Math.max(0.1, Math.min(s,
        FSRS_W[11] * Math.pow(d, -FSRS_W[12]) *
        (Math.pow(s + 1, FSRS_W[13]) - 1) * Math.exp((1 - r) * FSRS_W[14])));
    }
    const hardPenalty = g === 2 ? FSRS_W[15] : 1;
    const easyBonus = g === 4 ? FSRS_W[16] : 1;
    return s * (1 + Math.exp(FSRS_W[8]) *
      (11 - d) * Math.pow(s, -FSRS_W[9]) *
      (Math.exp((1 - r) * FSRS_W[10]) - 1) * hardPenalty * easyBonus);
  }
  // Returns the next state for a card under FSRS for a given rating.
  function fsrsSchedule(card, rating) {
    const g = RATING_GRADE[rating] || 3;
    const firstTime = !card.lastReviewedAt || card.reps === 0 || !card.stability;
    let stability, difficulty;
    if (firstTime) {
      difficulty = fsrsInitDifficulty(g);
      stability = fsrsInitStability(g);
    } else {
      const elapsedDays = Math.max(0,
        (Date.now() - new Date(card.lastReviewedAt).getTime()) / 86400000);
      const r = fsrsRetrievability(elapsedDays, card.stability || 0.1);
      difficulty = fsrsNextDifficulty(card.difficulty || fsrsInitDifficulty(3), g);
      stability = fsrsNextStability(difficulty, card.stability || 0.1, r, g);
    }
    const interval = g === 1 ? 1 : fsrsIntervalFromStability(stability);
    return {
      stability: Math.round(stability * 1000) / 1000,
      difficulty: Math.round(difficulty * 1000) / 1000,
      interval,
      lapsed: g === 1,
    };
  }

  // study-answer — apply the deck-configured scheduler (FSRS or SM-2).
  registerLensAction("srs", "study-answer", (ctx, _a, params = {}) => {
    const s = getSrsState(); if (!s) return { ok: false, error: "STATE unavailable" };
    const userId = srsActor(ctx);
    const card = srsList(s.cards, userId).find((c) => c.id === params.cardId);
    if (!card) return { ok: false, error: "card not found" };
    const rating = ["again", "hard", "good", "easy"].includes(params.rating) ? params.rating : "good";
    const deck = srsList(s.decks, userId).find((d) => d.id === card.deckId);
    let scheduler = (deck?.options?.scheduler) || "fsrs";
    if (params.scheduler === "sm2" || params.scheduler === "fsrs") scheduler = params.scheduler;

    let interval, reps = card.reps, lapses = card.lapses;
    if (scheduler === "fsrs") {
      const r = fsrsSchedule(card, rating);
      card.stability = r.stability;
      card.difficulty = r.difficulty;
      interval = r.interval;
      if (r.lapsed) { lapses += 1; card.state = "relearning"; }
      else { reps += 1; card.state = interval >= 21 ? "review" : "learning"; }
    } else {
      // modern SM-2
      let ease = card.ease || 2.5;
      interval = card.interval;
      if (rating === "again") {
        ease = Math.max(1.3, ease - 0.2);
        interval = 1;
        lapses += 1;
        card.state = "learning";
      } else {
        if (rating === "hard") {
          ease = Math.max(1.3, ease - 0.15);
          interval = reps === 0 ? 1 : Math.max(1, Math.round(interval * 1.2));
        } else if (rating === "easy") {
          ease = ease + 0.15;
          interval = reps === 0 ? 4 : Math.round(interval * ease * 1.3);
        } else {
          interval = reps === 0 ? 1 : reps === 1 ? 6 : Math.round(interval * ease);
        }
        reps += 1;
        card.state = interval >= 21 ? "review" : "learning";
      }
      card.ease = Math.round(ease * 100) / 100;
    }
    interval = Math.max(1, Math.min(36500, interval));
    card.interval = interval;
    card.reps = reps;
    card.lapses = lapses;
    card.due = new Date(Date.now() + interval * 86400000).toISOString();
    card.lastReviewedAt = srsNow();
    srsList(s.reviewLog, userId).push({ cardId: card.id, deckId: card.deckId, rating, scheduler, at: srsNow() });
    saveSrs();
    return { ok: true, result: { card, nextReviewInDays: interval, scheduler } };
  });

  registerLensAction("srs", "study-stats", (ctx, _a, params = {}) => {
    const s = getSrsState(); if (!s) return { ok: false, error: "STATE unavailable" };
    const userId = srsActor(ctx);
    let log = srsList(s.reviewLog, userId);
    if (params.deckId) log = log.filter((r) => r.deckId === params.deckId);
    // 14-day review heatmap
    const heatmap = {};
    for (let d = 0; d < 14; d++) {
      const day = new Date(Date.now() - d * 86400000).toISOString().slice(0, 10);
      heatmap[day] = 0;
    }
    for (const r of log) {
      const day = r.at.slice(0, 10);
      if (day in heatmap) heatmap[day] += 1;
    }
    const total = log.length;
    const correct = log.filter((r) => r.rating !== "again").length;
    return {
      ok: true,
      result: {
        totalReviews: total,
        accuracy: total > 0 ? Math.round((correct / total) * 100) : 0,
        last14Days: Object.entries(heatmap).map(([date, count]) => ({ date, count })).reverse(),
        ratingBreakdown: {
          again: log.filter((r) => r.rating === "again").length,
          hard: log.filter((r) => r.rating === "hard").length,
          good: log.filter((r) => r.rating === "good").length,
          easy: log.filter((r) => r.rating === "easy").length,
        },
      },
    };
  });

  registerLensAction("srs", "srs-dashboard", (ctx, _a, _params = {}) => {
    const s = getSrsState(); if (!s) return { ok: false, error: "STATE unavailable" };
    const userId = srsActor(ctx);
    const decks = srsList(s.decks, userId);
    const cards = srsList(s.cards, userId);
    return {
      ok: true,
      result: {
        decks: decks.length,
        totalCards: cards.length,
        newCards: cards.filter((c) => c.state === "new").length,
        dueCards: cards.filter(isDue).length,
        matureCards: cards.filter((c) => c.interval >= 21).length,
        suspendedCards: cards.filter((c) => c.suspended).length,
        reviewsLogged: srsList(s.reviewLog, userId).length,
      },
    };
  });

  // ─── [S] Per-deck options ─────────────────────────────────────────
  registerLensAction("srs", "deck-options-get", (ctx, _a, params = {}) => {
    const s = getSrsState(); if (!s) return { ok: false, error: "STATE unavailable" };
    const deck = srsList(s.decks, srsActor(ctx)).find((d) => d.id === params.deckId);
    if (!deck) return { ok: false, error: "deck not found" };
    if (!deck.options) deck.options = defaultDeckOptions();
    return { ok: true, result: { deckId: deck.id, options: deck.options } };
  });

  registerLensAction("srs", "deck-options-update", (ctx, _a, params = {}) => {
    const s = getSrsState(); if (!s) return { ok: false, error: "STATE unavailable" };
    const deck = srsList(s.decks, srsActor(ctx)).find((d) => d.id === params.deckId);
    if (!deck) return { ok: false, error: "deck not found" };
    deck.options = normaliseOptions({ ...(deck.options || {}), ...(params.options || {}) });
    saveSrs();
    return { ok: true, result: { deckId: deck.id, options: deck.options } };
  });

  // ─── [M] Sub-decks / deck hierarchy + filtered decks ──────────────
  registerLensAction("srs", "deck-tree", (ctx, _a, _params = {}) => {
    const s = getSrsState(); if (!s) return { ok: false, error: "STATE unavailable" };
    const userId = srsActor(ctx);
    const decks = srsList(s.decks, userId);
    const decorate = (d) => {
      const own = cardsForDeck(s, userId, d.id);
      return {
        ...d,
        ownCardCount: own.length,
        dueCount: own.filter(isDue).length,
        newCount: own.filter((c) => c.state === "new").length,
        children: decks.filter((c) => c.parentId === d.id).map(decorate),
      };
    };
    const roots = decks.filter((d) => !d.parentId).map(decorate);
    return { ok: true, result: { tree: roots, totalDecks: decks.length } };
  });

  registerLensAction("srs", "deck-move", (ctx, _a, params = {}) => {
    const s = getSrsState(); if (!s) return { ok: false, error: "STATE unavailable" };
    const userId = srsActor(ctx);
    const decks = srsList(s.decks, userId);
    const deck = decks.find((d) => d.id === params.id);
    if (!deck) return { ok: false, error: "deck not found" };
    if (params.parentId == null || params.parentId === "") { deck.parentId = null; saveSrs(); return { ok: true, result: { deck } }; }
    if (params.parentId === deck.id) return { ok: false, error: "deck cannot be its own parent" };
    const parent = decks.find((d) => d.id === params.parentId);
    if (!parent) return { ok: false, error: "parent deck not found" };
    // cycle guard
    let cur = parent;
    while (cur) {
      if (cur.id === deck.id) return { ok: false, error: "move would create a cycle" };
      cur = decks.find((d) => d.id === cur.parentId);
    }
    deck.parentId = parent.id;
    saveSrs();
    return { ok: true, result: { deck } };
  });

  registerLensAction("srs", "filtered-deck-create", (ctx, _a, params = {}) => {
    const s = getSrsState(); if (!s) return { ok: false, error: "STATE unavailable" };
    const name = srsClean(params.name, 120);
    if (!name) return { ok: false, error: "filtered deck name required" };
    const query = srsClean(params.query, 200);
    if (!query) return { ok: false, error: "filter query required (e.g. tag:hard, is:due)" };
    const deck = {
      id: srsId("fd"), name,
      description: srsClean(params.description, 400),
      parentId: null,
      filtered: true,
      filterQuery: query,
      options: defaultDeckOptions(),
      createdAt: srsNow(),
    };
    srsList(s.decks, srsActor(ctx)).push(deck);
    saveSrs();
    return { ok: true, result: { deck } };
  });

  // ─── [M] Card browser — search / filter / bulk edit / suspend / bury ─
  registerLensAction("srs", "card-browse", (ctx, _a, params = {}) => {
    const s = getSrsState(); if (!s) return { ok: false, error: "STATE unavailable" };
    const userId = srsActor(ctx);
    let cards = srsList(s.cards, userId).slice();
    const q = srsClean(params.query, 200).toLowerCase();
    if (params.deckId) cards = cards.filter((c) => c.deckId === params.deckId);
    if (params.tag) cards = cards.filter((c) => (c.tags || []).includes(params.tag));
    if (params.cardType) cards = cards.filter((c) => (c.cardType || "basic") === params.cardType);
    if (params.state === "suspended") cards = cards.filter((c) => c.suspended);
    else if (params.state === "buried") cards = cards.filter((c) => c.buried);
    else if (params.state === "due") cards = cards.filter(isDue);
    else if (params.state === "new") cards = cards.filter((c) => c.state === "new");
    else if (params.state && params.state !== "all") cards = cards.filter((c) => c.state === params.state);
    if (q) {cards = cards.filter((c) =>
      (c.front || "").toLowerCase().includes(q) ||
      (c.back || "").toLowerCase().includes(q) ||
      (c.tags || []).some((t) => t.toLowerCase().includes(q)));}
    const sort = params.sort || "created";
    cards.sort((a, b) => {
      if (sort === "due") return (a.due || "").localeCompare(b.due || "");
      if (sort === "interval") return (b.interval || 0) - (a.interval || 0);
      if (sort === "lapses") return (b.lapses || 0) - (a.lapses || 0);
      return (b.createdAt || "").localeCompare(a.createdAt || "");
    });
    const allTags = new Set();
    for (const c of srsList(s.cards, userId)) for (const t of (c.tags || [])) allTags.add(t);
    return { ok: true, result: { cards, count: cards.length, tags: [...allTags].sort() } };
  });

  registerLensAction("srs", "card-suspend", (ctx, _a, params = {}) => {
    const s = getSrsState(); if (!s) return { ok: false, error: "STATE unavailable" };
    const ids = Array.isArray(params.ids) ? params.ids : (params.id ? [params.id] : []);
    if (ids.length === 0) return { ok: false, error: "id or ids required" };
    const cards = srsList(s.cards, srsActor(ctx));
    let n = 0;
    for (const card of cards.filter((c) => ids.includes(c.id))) {
      card.suspended = params.suspended != null ? !!params.suspended : !card.suspended;
      if (card.suspended) card.buried = false;
      n++;
    }
    if (n === 0) return { ok: false, error: "no matching cards" };
    saveSrs();
    return { ok: true, result: { updated: n } };
  });

  registerLensAction("srs", "card-bury", (ctx, _a, params = {}) => {
    const s = getSrsState(); if (!s) return { ok: false, error: "STATE unavailable" };
    const ids = Array.isArray(params.ids) ? params.ids : (params.id ? [params.id] : []);
    if (ids.length === 0) return { ok: false, error: "id or ids required" };
    const cards = srsList(s.cards, srsActor(ctx));
    let n = 0;
    for (const card of cards.filter((c) => ids.includes(c.id))) {
      card.buried = params.buried != null ? !!params.buried : !card.buried;
      n++;
    }
    if (n === 0) return { ok: false, error: "no matching cards" };
    saveSrs();
    return { ok: true, result: { updated: n } };
  });

  // bulk-edit — apply tag add/remove or deck move to many cards at once.
  registerLensAction("srs", "card-bulk-edit", (ctx, _a, params = {}) => {
    const s = getSrsState(); if (!s) return { ok: false, error: "STATE unavailable" };
    const userId = srsActor(ctx);
    const ids = Array.isArray(params.ids) ? params.ids : [];
    if (ids.length === 0) return { ok: false, error: "ids required" };
    const cards = srsList(s.cards, userId).filter((c) => ids.includes(c.id));
    if (cards.length === 0) return { ok: false, error: "no matching cards" };
    let moveDeck = null;
    if (params.moveToDeckId) {
      moveDeck = srsList(s.decks, userId).find((d) => d.id === params.moveToDeckId);
      if (!moveDeck) return { ok: false, error: "target deck not found" };
    }
    const addTags = Array.isArray(params.addTags) ? params.addTags.map((t) => srsClean(t, 30)).filter(Boolean) : [];
    const removeTags = Array.isArray(params.removeTags) ? params.removeTags.map((t) => srsClean(t, 30)) : [];
    for (const c of cards) {
      if (moveDeck) c.deckId = moveDeck.id;
      if (addTags.length || removeTags.length) {
        const set = new Set(c.tags || []);
        for (const t of addTags) set.add(t);
        for (const t of removeTags) set.delete(t);
        c.tags = [...set].slice(0, 8);
      }
      if (params.markup === "plain" || params.markup === "markdown" || params.markup === "html") c.markup = params.markup;
    }
    saveSrs();
    return { ok: true, result: { updated: cards.length } };
  });

  // ─── [M] Media in cards ───────────────────────────────────────────
  // Register a media asset (URL/data-uri reference) for reuse on cards.
  registerLensAction("srs", "media-add", (ctx, _a, params = {}) => {
    const s = getSrsState(); if (!s) return { ok: false, error: "STATE unavailable" };
    const url = srsClean(params.url, 1000);
    const kind = ["image", "audio"].includes(params.kind) ? params.kind : "image";
    if (!url) return { ok: false, error: "media url required" };
    const media = { id: srsId("md"), kind, url, name: srsClean(params.name, 120) || url.slice(0, 60), createdAt: srsNow() };
    srsList(s.media, srsActor(ctx)).push(media);
    saveSrs();
    return { ok: true, result: { media } };
  });

  registerLensAction("srs", "media-list", (ctx, _a, _params = {}) => {
    const s = getSrsState(); if (!s) return { ok: false, error: "STATE unavailable" };
    const media = srsList(s.media, srsActor(ctx)).slice().reverse();
    return { ok: true, result: { media, count: media.length } };
  });

  // Attach/clear media + TTS flags on an existing card.
  registerLensAction("srs", "card-set-media", (ctx, _a, params = {}) => {
    const s = getSrsState(); if (!s) return { ok: false, error: "STATE unavailable" };
    const card = srsList(s.cards, srsActor(ctx)).find((c) => c.id === params.id);
    if (!card) return { ok: false, error: "card not found" };
    if (!card.media) card.media = { frontImage: null, backImage: null, frontAudio: null, backAudio: null, tts: false };
    for (const slot of ["frontImage", "backImage", "frontAudio", "backAudio"]) {
      if (slot in params) card.media[slot] = params[slot] ? srsClean(params[slot], 1000) : null;
    }
    if ("tts" in params) card.media.tts = !!params.tts;
    saveSrs();
    return { ok: true, result: { card } };
  });

  // ─── [M] Deck import / export (.apkg-shape JSON bundle) ───────────
  registerLensAction("srs", "deck-export", (ctx, _a, params = {}) => {
    const s = getSrsState(); if (!s) return { ok: false, error: "STATE unavailable" };
    const userId = srsActor(ctx);
    const deck = srsList(s.decks, userId).find((d) => d.id === params.deckId);
    if (!deck) return { ok: false, error: "deck not found" };
    const cards = cardsForDeck(s, userId, deck.id).map((c) => ({
      front: c.front, back: c.back, tags: c.tags, cardType: c.cardType || "basic",
      hint: c.hint || "", markup: c.markup || "plain", media: c.media || null,
      clozeText: c.clozeText || null, fields: c.fields || null,
      frontTemplate: c.frontTemplate || null, backTemplate: c.backTemplate || null,
      occlusions: c.occlusions || null, image: c.image || null,
    }));
    const bundle = {
      format: "concord-srs/v1",
      exportedAt: srsNow(),
      deck: { name: deck.name, description: deck.description || "", options: deck.options || defaultDeckOptions() },
      cards,
      cardCount: cards.length,
    };
    return { ok: true, result: { bundle, filename: `${deck.name.replace(/[^\w-]+/g, "_")}.apkg.json` } };
  });

  registerLensAction("srs", "deck-import", (ctx, _a, params = {}) => {
    const s = getSrsState(); if (!s) return { ok: false, error: "STATE unavailable" };
    const userId = srsActor(ctx);
    let bundle = params.bundle;
    if (typeof bundle === "string") {
      try { bundle = JSON.parse(bundle); } catch (_e) { return { ok: false, error: "bundle is not valid JSON" }; }
    }
    if (!bundle || typeof bundle !== "object" || !bundle.deck || !Array.isArray(bundle.cards)) {
      return { ok: false, error: "invalid bundle — expected { deck, cards[] }" };
    }
    const deck = {
      id: srsId("dk"),
      name: srsClean(bundle.deck.name, 120) || "Imported Deck",
      description: srsClean(bundle.deck.description, 400),
      parentId: null, filtered: false, filterQuery: null,
      options: normaliseOptions(bundle.deck.options),
      createdAt: srsNow(),
    };
    srsList(s.decks, userId).push(deck);
    const cardsArr = srsList(s.cards, userId);
    let imported = 0;
    for (const raw of bundle.cards) {
      const front = srsClean(raw.front, 2000);
      const back = srsClean(raw.back, 4000);
      if (!front || !back) continue;
      cardsArr.push({
        id: srsId("cd"), deckId: deck.id, front, back,
        tags: Array.isArray(raw.tags) ? raw.tags.map((t) => srsClean(t, 30)).filter(Boolean).slice(0, 8) : [],
        ease: 2.5, interval: 0, reps: 0, lapses: 0, stability: 0, difficulty: 0,
        state: "new", due: srsNow(), createdAt: srsNow(), lastReviewedAt: null,
        suspended: false, buried: false,
        cardType: ["basic", "cloze", "image-occlusion", "templated"].includes(raw.cardType) ? raw.cardType : "basic",
        hint: srsClean(raw.hint, 500),
        markup: raw.markup === "markdown" || raw.markup === "html" ? raw.markup : "plain",
        media: raw.media && typeof raw.media === "object" ? raw.media : { frontImage: null, backImage: null, frontAudio: null, backAudio: null, tts: false },
        clozeText: raw.clozeText || null, fields: raw.fields || null,
        frontTemplate: raw.frontTemplate || null, backTemplate: raw.backTemplate || null,
        occlusions: raw.occlusions || null, image: raw.image || null,
      });
      imported++;
    }
    saveSrs();
    return { ok: true, result: { deck, imported } };
  });

  // ─── [S] Review heatmap / streak calendar + forecast graph ────────
  registerLensAction("srs", "review-heatmap", (ctx, _a, params = {}) => {
    const s = getSrsState(); if (!s) return { ok: false, error: "STATE unavailable" };
    const userId = srsActor(ctx);
    let log = srsList(s.reviewLog, userId);
    if (params.deckId) log = log.filter((r) => r.deckId === params.deckId);
    const days = Math.max(7, Math.min(365, parseInt(params.days, 10) || 365));
    const counts = {};
    for (let d = 0; d < days; d++) {
      counts[new Date(Date.now() - d * 86400000).toISOString().slice(0, 10)] = 0;
    }
    for (const r of log) {
      const day = (r.at || "").slice(0, 10);
      if (day in counts) counts[day] += 1;
    }
    const calendar = Object.entries(counts).map(([date, count]) => ({ date, count })).reverse();
    // streaks
    let currentStreak = 0, longestStreak = 0, run = 0;
    const ordered = [...calendar];
    for (let i = ordered.length - 1; i >= 0; i--) {
      if (ordered[i].count > 0) { run++; if (i === ordered.length - 1 || currentStreak > 0 || run === 1) { /* track below */ } }
      else run = 0;
      longestStreak = Math.max(longestStreak, run);
    }
    // current streak: count back from today while count>0
    for (let i = ordered.length - 1; i >= 0; i--) {
      if (ordered[i].count > 0) currentStreak++;
      else break;
    }
    const totalReviews = log.length;
    const activeDays = calendar.filter((d) => d.count > 0).length;
    return {
      ok: true,
      result: {
        calendar, currentStreak, longestStreak, totalReviews, activeDays,
        busiestDay: calendar.reduce((m, d) => (d.count > (m?.count || 0) ? d : m), null),
      },
    };
  });

  registerLensAction("srs", "review-forecast", (ctx, _a, params = {}) => {
    const s = getSrsState(); if (!s) return { ok: false, error: "STATE unavailable" };
    const userId = srsActor(ctx);
    let cards = srsList(s.cards, userId);
    if (params.deckId) cards = cards.filter((c) => c.deckId === params.deckId);
    const horizon = Math.max(7, Math.min(90, parseInt(params.days, 10) || 30));
    const forecast = [];
    const now = Date.now();
    for (let day = 0; day < horizon; day++) {
      const dayStart = now + day * 86400000;
      const dayEnd = dayStart + 86400000;
      const date = new Date(dayStart).toISOString().slice(0, 10);
      const count = cards.filter((c) => {
        if (c.suspended || c.state === "new") return false;
        const due = new Date(c.due).getTime();
        if (day === 0) return due <= dayEnd;
        return due >= dayStart && due < dayEnd;
      }).length;
      forecast.push({ day, date, count });
    }
    const dueNow = cards.filter((c) => !c.suspended && c.state !== "new" && isDue(c)).length;
    return {
      ok: true,
      result: {
        forecast, dueNow, horizonDays: horizon,
        totalUpcoming: forecast.reduce((sum, f) => sum + f.count, 0),
        peakDay: forecast.reduce((m, f) => (f.count > (m?.count || 0) ? f : m), null),
      },
    };
  });
}
