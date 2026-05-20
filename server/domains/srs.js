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

  registerLensAction("srs", "deck-create", (ctx, _a, params = {}) => {
    const s = getSrsState(); if (!s) return { ok: false, error: "STATE unavailable" };
    const name = srsClean(params.name, 120);
    if (!name) return { ok: false, error: "deck name required" };
    const deck = {
      id: srsId("dk"), name,
      description: srsClean(params.description, 400),
      createdAt: srsNow(),
    };
    srsList(s.decks, srsActor(ctx)).push(deck);
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

  registerLensAction("srs", "card-add", (ctx, _a, params = {}) => {
    const s = getSrsState(); if (!s) return { ok: false, error: "STATE unavailable" };
    const userId = srsActor(ctx);
    const deck = srsList(s.decks, userId).find((d) => d.id === params.deckId);
    if (!deck) return { ok: false, error: "deck not found" };
    const front = srsClean(params.front, 2000);
    const back = srsClean(params.back, 4000);
    if (!front || !back) return { ok: false, error: "front and back required" };
    const card = {
      id: srsId("cd"), deckId: deck.id, front, back,
      tags: Array.isArray(params.tags) ? params.tags.map((t) => srsClean(t, 30)).filter(Boolean).slice(0, 8) : [],
      ease: 2.5, interval: 0, reps: 0, lapses: 0,
      state: "new", due: srsNow(), createdAt: srsNow(), lastReviewedAt: null,
    };
    srsList(s.cards, userId).push(card);
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

  // study-next — the next card to study from a deck: due review cards
  // first, then up to NEW_PER_DAY new cards.
  registerLensAction("srs", "study-next", (ctx, _a, params = {}) => {
    const s = getSrsState(); if (!s) return { ok: false, error: "STATE unavailable" };
    const userId = srsActor(ctx);
    const cs = cardsForDeck(s, userId, params.deckId);
    if (cs.length === 0) return { ok: true, result: { card: null, remaining: 0 } };
    const due = cs.filter(isDue).sort((a, b) => a.due.localeCompare(b.due));
    if (due.length > 0) {
      return { ok: true, result: { card: due[0], remaining: due.length + Math.min(NEW_PER_DAY, cs.filter((c) => c.state === "new").length) } };
    }
    const fresh = cs.filter((c) => c.state === "new");
    if (fresh.length > 0) {
      return { ok: true, result: { card: fresh[0], remaining: Math.min(NEW_PER_DAY, fresh.length) } };
    }
    return { ok: true, result: { card: null, remaining: 0 } };
  });

  // study-answer — apply a modern-SM-2 rating to a card.
  registerLensAction("srs", "study-answer", (ctx, _a, params = {}) => {
    const s = getSrsState(); if (!s) return { ok: false, error: "STATE unavailable" };
    const userId = srsActor(ctx);
    const card = srsList(s.cards, userId).find((c) => c.id === params.cardId);
    if (!card) return { ok: false, error: "card not found" };
    const rating = ["again", "hard", "good", "easy"].includes(params.rating) ? params.rating : "good";
    let { ease, interval, reps, lapses } = card;
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
      } else { // good
        interval = reps === 0 ? 1 : reps === 1 ? 6 : Math.round(interval * ease);
      }
      reps += 1;
      card.state = interval >= 21 ? "review" : "learning";
    }
    interval = Math.max(1, Math.min(365, interval));
    card.ease = Math.round(ease * 100) / 100;
    card.interval = interval;
    card.reps = reps;
    card.lapses = lapses;
    card.due = new Date(Date.now() + interval * 86400000).toISOString();
    card.lastReviewedAt = srsNow();
    srsList(s.reviewLog, userId).push({ cardId: card.id, deckId: card.deckId, rating, at: srsNow() });
    saveSrs();
    return { ok: true, result: { card, nextReviewInDays: interval } };
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
        reviewsLogged: srsList(s.reviewLog, userId).length,
      },
    };
  });
}
