// server/domains/srs.js
//
// Anki 2026-parity spaced-repetition system. Pure-compute analytics
// (SM-2 schedule projection, retention curve, card difficulty, deck
// stats) PLUS a real per-user deck/card/study substrate: create decks,
// add cards, run study sessions with modern SM-2 scheduling, and track
// review history.

import { guardAnonWrites } from "../lib/lens-authz.js";
export default function registerSrsActions(registerLensAction) {
  registerLensAction = guardAnonWrites(registerLensAction); // anonymous callers can read, not write (lib/lens-authz.js)
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
  if (!(s.undoLog instanceof Map)) s.undoLog = new Map();     // userId -> Array<undo entry> (S9)
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
      desiredRetention: 0.9,    // FSRS target recall probability (S12)
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
    if (Number.isFinite(+raw.desiredRetention)) o.desiredRetention = Math.max(0.7, Math.min(0.97, +raw.desiredRetention));
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
    const decks = srsList(s.decks, userId).map((d) => ({ ...d, ...deckCounts(s, userId, d) }));
    return { ok: true, result: { decks, count: decks.length } };
  });

  registerLensAction("srs", "deck-delete", (ctx, _a, params = {}) => {
    const s = getSrsState(); if (!s) return { ok: false, error: "STATE unavailable" };
    const userId = srsActor(ctx);
    const arr = srsList(s.decks, userId);
    const i = arr.findIndex((d) => d.id === params.id);
    if (i < 0) return { ok: false, error: "deck not found" };
    // S2: subdecks move up to the deleted deck's parent — orphaning
    // them (a parentId pointing nowhere) would drop them from the
    // deck tree entirely, a silent loss worse than the delete itself.
    const [removed] = arr.splice(i, 1);
    for (const d of arr) {
      if (d.parentId === params.id) d.parentId = removed.parentId || null;
    }
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
  try {
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
        frontImage: srsMediaUrl(params.frontImage) || null,
        backImage: srsMediaUrl(params.backImage) || null,
        frontAudio: srsMediaUrl(params.frontAudio) || null,
        backAudio: srsMediaUrl(params.backAudio) || null,
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
      const image = srsMediaUrl(params.image || params.frontImage);
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

    // basic — optionally with its reversed twin (S10): one note,
    // two cards, the twin's front/back swapped.
    const front = srsClean(params.front, 2000);
    const back = srsClean(params.back, 4000);
    if (!front || !back) return { ok: false, error: "front and back required" };
    const card = { ...base(), front, back };
    cardsArr.push(card);
    if (params.alsoReversed === true) {
      const noteId = srsId("nt");
      card.noteId = noteId;
      const twin = { ...base(), front: back, back: front, noteId };
      cardsArr.push(twin);
      saveSrs();
      return { ok: true, result: { card, cards: [card, twin], noteId, generated: 2 } };
    }
    saveSrs();
    return { ok: true, result: { card } };
    } catch (e) { return { ok: false, error: "handler_error", message: String(e?.message || e) }; }
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

  // Media slots accept ordinary URLs (cleaned, short) and uploaded
  // data: URLs, whose bytes ride in the value itself (S11).
  function srsMediaUrl(v) {
    if (typeof v === "string" && (v.startsWith("data:image/") || v.startsWith("data:audio/"))) return v.slice(0, 2800000);
    return srsClean(v, 1000);
  }
  function studyableCard(c) {
    return !c.suspended && !c.buried;
  }
  // The deck's full card set, before studyability: filtered decks
  // match their saved query across the collection; regular decks
  // draw their own cards plus all descendant sub-deck cards. Study
  // and every count read from this one definition (S5/S8).
  function poolCardsAll(s, userId, deck) {
    const all = srsList(s.cards, userId);
    if (deck.filtered) {
      const q = (deck.filterQuery || "").toLowerCase().trim();
      return all.filter((c) => {
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
    return all.filter((c) => ids.has(c.deckId));
  }
  function studyPool(s, userId, deck) {
    return poolCardsAll(s, userId, deck).filter(studyableCard);
  }
  // The one counting rule (S8): cardCount is the pool size; new/due
  // count studyable cards only; studyCount is what a session can
  // still serve today under the deck's caps — the same arithmetic
  // study-next runs, so the surfaces cannot disagree.
  function deckCounts(s, userId, deck) {
    const all = poolCardsAll(s, userId, deck);
    const usable = all.filter(studyableCard);
    const opts = normaliseOptions(deck.options || {});
    const today = new Date().toISOString().slice(0, 10);
    const poolDeckIds = new Set(all.map((c) => c.deckId));
    const log = srsList(s.reviewLog, userId);
    const reviewsToday = log.filter((r) => poolDeckIds.has(r.deckId) && !r.wasNew && (r.at || "").slice(0, 10) === today).length;
    const introducedToday = usable.filter((c) => (c.introducedAt || "").slice(0, 10) === today).length;
    const stepDue = usable.filter((c) => c.inSteps && isDue(c)).length;
    const reviewDue = usable.filter((c) => !c.inSteps && isDue(c)).length;
    const newCount = usable.filter((c) => c.state === "new").length;
    const studyCount = stepDue
      + (reviewsToday < opts.reviewsPerDay ? reviewDue : 0)
      + Math.max(0, Math.min(opts.newPerDay - introducedToday, newCount));
    return { cardCount: all.length, newCount, dueCount: stepDue + reviewDue, studyCount };
  }

  // study-next — the next card to study from a deck. Order:
  // learning-step cards whose step has come due (never capped —
  // they are mid-lesson), then due reviews until the deck's
  // reviewsPerDay is spent, then new cards until newPerDay have
  // been introduced today (S4: the caps govern; the review log and
  // introducedAt are the counters, and the result reports them).
  registerLensAction("srs", "study-next", (ctx, _a, params = {}) => {
  try {
    const s = getSrsState(); if (!s) return { ok: false, error: "STATE unavailable" };
    const userId = srsActor(ctx);
    const deck = srsList(s.decks, userId).find((d) => d.id === params.deckId);
    if (!deck) return { ok: true, result: { card: null, remaining: 0 } };
    const cs = studyPool(s, userId, deck);
    const opts = normaliseOptions(deck.options || {});
    const today = new Date().toISOString().slice(0, 10);
    const poolDeckIds = new Set(cs.map((c) => c.deckId));
    const log = srsList(s.reviewLog, userId);
    const reviewsToday = log.filter((r) => poolDeckIds.has(r.deckId) && !r.wasNew && (r.at || "").slice(0, 10) === today).length;
    const introducedToday = cs.filter((c) => (c.introducedAt || "").slice(0, 10) === today).length;
    const caps = { newPerDay: opts.newPerDay, reviewsPerDay: opts.reviewsPerDay, introducedToday, reviewsToday };
    if (cs.length === 0) return { ok: true, result: { card: null, remaining: 0, caps } };
    const due = cs.filter(isDue).sort((a, b) => a.due.localeCompare(b.due));
    const stepDue = due.filter((c) => c.inSteps);
    const reviewDue = due.filter((c) => !c.inSteps);
    const fresh = cs.filter((c) => c.state === "new");
    const newAllowed = Math.max(0, opts.newPerDay - introducedToday);
    const reviewAllowed = reviewsToday < opts.reviewsPerDay ? reviewDue.length : 0;
    const remaining = stepDue.length + reviewAllowed + Math.min(newAllowed, fresh.length);
    if (stepDue.length > 0) return { ok: true, result: { card: stepDue[0], remaining, caps } };
    if (reviewAllowed > 0) return { ok: true, result: { card: reviewDue[0], remaining, caps } };
    if (fresh.length > 0 && newAllowed > 0) return { ok: true, result: { card: fresh[0], remaining, caps } };
    return { ok: true, result: { card: null, remaining: 0, caps } };
    } catch (e) { return { ok: false, error: "handler_error", message: String(e?.message || e) }; }
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
  function fsrsIntervalFromStability(stability, retention = FSRS_TARGET_R) {
    const ivl = (stability / FSRS_FACTOR) * (Math.pow(retention, 1 / FSRS_DECAY) - 1);
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
  function fsrsSchedule(card, rating, retention) {
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
    const interval = g === 1 ? 1 : fsrsIntervalFromStability(stability, retention);
    return {
      stability: Math.round(stability * 1000) / 1000,
      difficulty: Math.round(difficulty * 1000) / 1000,
      interval,
      lapsed: g === 1,
    };
  }

  // ─── S3: one pure grading core for answers AND previews ─────────
  // SM-2 outcome for a grade, without mutating the card (factored
  // out of study-answer so previews compute the identical numbers).
  function sm2Schedule(card, rating) {
    let ease = card.ease || 2.5;
    const reps = card.reps || 0;
    const interval0 = card.interval || 0;
    let interval;
    if (rating === "again") { ease = Math.max(1.3, ease - 0.2); interval = 1; }
    else if (rating === "hard") { ease = Math.max(1.3, ease - 0.15); interval = reps === 0 ? 1 : Math.max(1, Math.round(interval0 * 1.2)); }
    else if (rating === "easy") { ease = ease + 0.15; interval = reps === 0 ? 4 : Math.round(interval0 * ease * 1.3); }
    else { interval = reps === 0 ? 1 : reps === 1 ? 6 : Math.round(interval0 * ease); }
    return { interval, ease: Math.round(ease * 100) / 100 };
  }

  // The full outcome of grading `card` with `rating` under the deck
  // options: Again (re)enters the learning steps at step 0; a card
  // inside the steps walks them on Good, repeats on Hard, and
  // graduates on Easy or on the final Good. Everything else
  // graduates immediately at the scheduler's day interval. Pure:
  // study-answer applies it, study-preview only reads it — the
  // promise on the button and the schedule applied are one code path.
  function gradeOutcome(card, rating, opts) {
    const scheduler = opts.scheduler || "fsrs";
    const steps = Array.isArray(opts.learningSteps) && opts.learningSteps.length ? opts.learningSteps : [1, 10];
    let sched;
    if (scheduler === "fsrs") {
      const r = fsrsSchedule(card, rating, opts.desiredRetention);
      sched = { interval: r.interval, stability: r.stability, difficulty: r.difficulty };
    } else {
      const r = sm2Schedule(card, rating);
      sched = { interval: r.interval, ease: r.ease };
    }
    if (rating === "again") {
      return { kind: "step", minutes: steps[0], stepIndex: 0, sched };
    }
    if (card.inSteps) {
      const idx = Math.min(card.stepIndex || 0, steps.length - 1);
      if (rating === "hard") return { kind: "step", minutes: steps[idx], stepIndex: idx, sched };
      if (rating === "good" && idx + 1 < steps.length) {
        return { kind: "step", minutes: steps[idx + 1], stepIndex: idx + 1, sched };
      }
    }
    return { kind: "graduate", interval: Math.max(1, Math.min(36500, sched.interval)), sched };
  }

  function intervalLabel(outcome) {
    if (outcome.kind === "step") return outcome.minutes + "m";
    return Math.round(outcome.interval) + "d";
  }

  // study-answer — apply the deck-configured scheduler (FSRS or SM-2).
  registerLensAction("srs", "study-answer", (ctx, _a, params = {}) => {
  try {
    const s = getSrsState(); if (!s) return { ok: false, error: "STATE unavailable" };
    const userId = srsActor(ctx);
    const card = srsList(s.cards, userId).find((c) => c.id === params.cardId);
    if (!card) return { ok: false, error: "card not found" };
    const rating = ["again", "hard", "good", "easy"].includes(params.rating) ? params.rating : "good";
    const deck = srsList(s.decks, userId).find((d) => d.id === card.deckId);
    const opts = normaliseOptions(deck?.options || {});
    let scheduler = opts.scheduler;
    if (params.scheduler === "sm2" || params.scheduler === "fsrs") scheduler = params.scheduler;

    // S9: snapshot for study-undo, before anything mutates.
    const undoBefore = { state: card.state, due: card.due, interval: card.interval, reps: card.reps, lapses: card.lapses, ease: card.ease, stability: card.stability, difficulty: card.difficulty, inSteps: !!card.inSteps, stepIndex: card.stepIndex || 0, introducedAt: card.introducedAt || null, lastReviewedAt: card.lastReviewedAt || null };
    const wasNew = card.state === "new";
    const preGradeReps = card.reps || 0;
    const outcome = gradeOutcome(card, rating, { ...opts, scheduler });
    // Scheduler state always advances, steps included (FSRS
    // post-lapse stability is what the card graduates with later).
    if (scheduler === "fsrs") {
      card.stability = outcome.sched.stability;
      card.difficulty = outcome.sched.difficulty;
    } else {
      card.ease = outcome.sched.ease;
    }
    // S3: reps counts every grade (the old FSRS lapse path left a
    // graded card at Reps 0); a lapse is an Again on a card that
    // has been graded before.
    card.reps = preGradeReps + 1;
    if (rating === "again" && preGradeReps > 0) card.lapses = (card.lapses || 0) + 1;
    card.interval = outcome.kind === "graduate" ? outcome.interval : Math.max(1, Math.min(36500, outcome.sched.interval));
    if (outcome.kind === "step") {
      card.inSteps = true;
      card.stepIndex = outcome.stepIndex;
      card.due = new Date(Date.now() + outcome.minutes * 60000).toISOString();
      card.state = scheduler === "fsrs" ? "relearning" : "learning";
    } else {
      card.inSteps = false;
      card.stepIndex = 0;
      card.due = new Date(Date.now() + outcome.interval * 86400000).toISOString();
      card.state = outcome.interval >= 21 ? "review" : "learning";
    }
    if (!card.introducedAt) card.introducedAt = srsNow();
    card.lastReviewedAt = srsNow();
    const logEntry = { cardId: card.id, deckId: card.deckId, rating, scheduler, wasNew, at: srsNow() };
    srsList(s.reviewLog, userId).push(logEntry);
    const undoArr = srsList(s.undoLog, userId);
    undoArr.push({ cardId: card.id, before: undoBefore, logEntry, at: srsNow() });
    if (undoArr.length > 50) undoArr.splice(0, undoArr.length - 50);
    saveSrs();
    return { ok: true, result: {
      card, scheduler, intervalLabel: intervalLabel(outcome),
      nextReviewInDays: outcome.kind === "graduate" ? outcome.interval : null,
      nextReviewInMinutes: outcome.kind === "step" ? outcome.minutes : null,
    } };
    } catch (e) { return { ok: false, error: "handler_error", message: String(e?.message || e) }; }
});

  // study-preview — the promise on the grade buttons: what each
  // rating will schedule for this card, computed by the same pure
  // core study-answer applies. No state changes.
  registerLensAction("srs", "study-preview", (ctx, _a, params = {}) => {
    const s = getSrsState(); if (!s) return { ok: false, error: "STATE unavailable" };
    const userId = srsActor(ctx);
    const card = srsList(s.cards, userId).find((c) => c.id === params.cardId);
    if (!card) return { ok: false, error: "card not found" };
    const deck = srsList(s.decks, userId).find((d) => d.id === card.deckId);
    const opts = normaliseOptions(deck?.options || {});
    if (params.scheduler === "sm2" || params.scheduler === "fsrs") opts.scheduler = params.scheduler;
    const previews = {};
    for (const rating of ["again", "hard", "good", "easy"]) {
      const o = gradeOutcome(card, rating, opts);
      previews[rating] = {
        label: intervalLabel(o), kind: o.kind,
        minutes: o.kind === "step" ? o.minutes : null,
        days: o.kind === "graduate" ? Math.round(o.interval) : null,
      };
    }
    return { ok: true, result: { cardId: card.id, scheduler: opts.scheduler, previews } };
  });

  // study-undo — reverse the most recent grade (S9): restore the
  // card's pre-grade scheduling exactly and remove the review it
  // logged, so study stats stay honest.
  registerLensAction("srs", "study-undo", (ctx, _a, params = {}) => {
    const s = getSrsState(); if (!s) return { ok: false, error: "STATE unavailable" };
    const userId = srsActor(ctx);
    const undoArr = srsList(s.undoLog, userId);
    let idx = -1;
    for (let i = undoArr.length - 1; i >= 0; i--) {
      if (!params.cardId || undoArr[i].cardId === params.cardId) { idx = i; break; }
    }
    if (idx < 0) return { ok: false, error: "nothing to undo" };
    const [entry] = undoArr.splice(idx, 1);
    const card = srsList(s.cards, userId).find((c) => c.id === entry.cardId);
    if (!card) return { ok: false, error: "card not found" };
    Object.assign(card, entry.before);
    const log = srsList(s.reviewLog, userId);
    const li = entry.logEntry ? log.indexOf(entry.logEntry) : -1;
    if (li >= 0) log.splice(li, 1);
    else {
      for (let i = log.length - 1; i >= 0; i--) {
        if (log[i].cardId === entry.cardId) { log.splice(i, 1); break; }
      }
    }
    saveSrs();
    return { ok: true, result: { card, undoneCardId: entry.cardId } };
  });

  registerLensAction("srs", "study-stats", (ctx, _a, params = {}) => {
  try {
    const s = getSrsState(); if (!s) return { ok: false, error: "STATE unavailable" };
    const userId = srsActor(ctx);
    let log = srsList(s.reviewLog, userId);
    // S14: a deck's stats cover its study pool (subdecks and
    // filtered matches included) — the same scope study serves.
    let poolCards = [];
    if (params.deckId) {
      const deck = srsList(s.decks, userId).find((d) => d.id === params.deckId);
      if (deck) {
        poolCards = poolCardsAll(s, userId, deck);
        const poolDeckIds = new Set(poolCards.map((c) => c.deckId));
        log = log.filter((r) => poolDeckIds.has(r.deckId));
      } else {
        log = log.filter((r) => r.deckId === params.deckId);
      }
    }
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
    const today = new Date().toISOString().slice(0, 10);
    const todays = log.filter((r) => (r.at || "").slice(0, 10) === today);
    const futureDues = poolCards.filter((c) => studyableCard(c) && !isDue(c)).map((c) => c.due).sort();
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
        reviewsToday: todays.length,
        againToday: todays.filter((r) => r.rating === "again").length,
        nextDueAt: futureDues.length ? futureDues[0] : null,
      },
    };
    } catch (e) { return { ok: false, error: "handler_error", message: String(e?.message || e) }; }
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
        newCards: cards.filter((c) => c.state === "new" && studyableCard(c)).length,
        dueCards: cards.filter((c) => studyableCard(c) && isDue(c)).length,
        buriedCards: cards.filter((c) => c.buried).length,
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
    return { ok: true, result: { deckId: deck.id, options: normaliseOptions(deck.options || {}) } };
  });

  registerLensAction("srs", "deck-options-update", (ctx, _a, params = {}) => {
    const s = getSrsState(); if (!s) return { ok: false, error: "STATE unavailable" };
    const deck = srsList(s.decks, srsActor(ctx)).find((d) => d.id === params.deckId);
    if (!deck) return { ok: false, error: "deck not found" };
    // S2: rename rides deck options (the review's done-state: a name
    // field in deck options). Validated like deck-create; an absent
    // name leaves the deck's name untouched.
    if (params.name !== undefined) {
      const name = srsClean(params.name, 120);
      if (!name) return { ok: false, error: "deck name required" };
      deck.name = name;
    }
    // S5: a filtered deck's query is editable in the same panel.
    if (params.filterQuery !== undefined) {
      if (!deck.filtered) return { ok: false, error: "only filtered decks have a filter query" };
      const q = srsClean(params.filterQuery, 200);
      if (!q) return { ok: false, error: "filter query required (e.g. tag:hard, is:due)" };
      deck.filterQuery = q;
    }
    deck.options = normaliseOptions({ ...(deck.options || {}), ...(params.options || {}) });
    saveSrs();
    return { ok: true, result: { deckId: deck.id, name: deck.name, filterQuery: deck.filterQuery || null, options: deck.options } };
  });

  // ─── [M] Sub-decks / deck hierarchy + filtered decks ──────────────
  registerLensAction("srs", "deck-tree", (ctx, _a, _params = {}) => {
    const s = getSrsState(); if (!s) return { ok: false, error: "STATE unavailable" };
    const userId = srsActor(ctx);
    const decks = srsList(s.decks, userId);
    const decorate = (d) => {
      // Tree rows count the node's OWN cards (children render as
      // their own rows) — except filtered decks, whose own cards ARE
      // their query matches. Definitions match deckCounts (S8):
      // new/due count studyable cards only.
      const own = d.filtered ? poolCardsAll(s, userId, d) : cardsForDeck(s, userId, d.id);
      const usable = own.filter(studyableCard);
      return {
        ...d,
        ownCardCount: own.length,
        dueCount: usable.filter(isDue).length,
        newCount: usable.filter((c) => c.state === "new").length,
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
    // S6: count only cards whose flag actually changes — a banner
    // may only ever claim verified state changes.
    let n = 0, unchanged = 0;
    for (const card of cards.filter((c) => ids.includes(c.id))) {
      const target = params.suspended != null ? !!params.suspended : !card.suspended;
      if (card.suspended === target) { unchanged++; continue; }
      card.suspended = target;
      if (card.suspended) card.buried = false;
      n++;
    }
    if (n === 0 && unchanged === 0) return { ok: false, error: "no matching cards" };
    saveSrs();
    return { ok: true, result: { updated: n, unchanged } };
  });

  registerLensAction("srs", "card-bury", (ctx, _a, params = {}) => {
    const s = getSrsState(); if (!s) return { ok: false, error: "STATE unavailable" };
    const ids = Array.isArray(params.ids) ? params.ids : (params.id ? [params.id] : []);
    if (ids.length === 0) return { ok: false, error: "id or ids required" };
    const cards = srsList(s.cards, srsActor(ctx));
    // S6: same honesty rule as suspend — count real changes only.
    let n = 0, unchanged = 0;
    for (const card of cards.filter((c) => ids.includes(c.id))) {
      const target = params.buried != null ? !!params.buried : !card.buried;
      if (card.buried === target) { unchanged++; continue; }
      card.buried = target;
      n++;
    }
    if (n === 0 && unchanged === 0) return { ok: false, error: "no matching cards" };
    saveSrs();
    return { ok: true, result: { updated: n, unchanged } };
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
    // S11: an upload rides as a data: URL (image/audio only,
    // capped); anything else must be an ordinary URL.
    let url = "";
    if (typeof params.dataUrl === "string" && (params.dataUrl.startsWith("data:image/") || params.dataUrl.startsWith("data:audio/"))) {
      if (params.dataUrl.length > 2800000) return { ok: false, error: "file too large — uploads are capped at about 2 MB" };
      url = params.dataUrl;
    } else if (params.dataUrl) {
      return { ok: false, error: "only image or audio files can be uploaded" };
    } else {
      url = srsClean(params.url, 1000);
    }
    const kind = ["image", "audio"].includes(params.kind) ? params.kind
      : (url.startsWith("data:audio/") ? "audio" : "image");
    if (!url) return { ok: false, error: "media url required" };
    const media = { id: srsId("md"), kind, url, name: srsClean(params.name, 120) || (url.startsWith("data:") ? "Uploaded file" : url.slice(0, 60)), createdAt: srsNow() };
    srsList(s.media, srsActor(ctx)).push(media);
    saveSrs();
    return { ok: true, result: { media } };
  });

  registerLensAction("srs", "media-list", (ctx, _a, _params = {}) => {
    const s = getSrsState(); if (!s) return { ok: false, error: "STATE unavailable" };
    const media = srsList(s.media, srsActor(ctx)).slice().reverse();
    return { ok: true, result: { media, count: media.length } };
  });

  // media-remove — delete one of the caller's own library assets
  // (S11). Cards that already reference the URL keep their copy.
  registerLensAction("srs", "media-remove", (ctx, _a, params = {}) => {
    const s = getSrsState(); if (!s) return { ok: false, error: "STATE unavailable" };
    const arr = srsList(s.media, srsActor(ctx));
    const idx = arr.findIndex((m) => m.id === params.id);
    if (idx < 0) return { ok: false, error: "media not found" };
    const [removed] = arr.splice(idx, 1);
    saveSrs();
    return { ok: true, result: { removed: removed.id, name: removed.name } };
  });

  // Attach/clear media + TTS flags on an existing card.
  registerLensAction("srs", "card-set-media", (ctx, _a, params = {}) => {
    const s = getSrsState(); if (!s) return { ok: false, error: "STATE unavailable" };
    const card = srsList(s.cards, srsActor(ctx)).find((c) => c.id === params.id);
    if (!card) return { ok: false, error: "card not found" };
    if (!card.media) card.media = { frontImage: null, backImage: null, frontAudio: null, backAudio: null, tts: false };
    for (const slot of ["frontImage", "backImage", "frontAudio", "backAudio"]) {
      if (slot in params) card.media[slot] = params[slot] ? srsMediaUrl(params[slot]) : null;
    }
    if ("tts" in params) card.media.tts = !!params.tts;
    saveSrs();
    return { ok: true, result: { card } };
  });

  // ─── [M] Deck import / export (.apkg-shape JSON bundle) ───────────
  registerLensAction("srs", "deck-export", (ctx, _a, params = {}) => {
  try {
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
      // S7: the scheduling block — what import restores from.
      scheduling: {
        state: c.state, interval: c.interval, reps: c.reps, lapses: c.lapses,
        ease: c.ease, stability: c.stability, difficulty: c.difficulty,
        due: c.due, lastReviewedAt: c.lastReviewedAt || null,
        introducedAt: c.introducedAt || null,
        inSteps: !!c.inSteps, stepIndex: c.stepIndex || 0,
        suspended: !!c.suspended, buried: !!c.buried,
      },
    }));
    const bundle = {
      format: "concord-srs/v1",
      exportedAt: srsNow(),
      deck: { name: deck.name, description: deck.description || "", options: deck.options || defaultDeckOptions() },
      cards,
      cardCount: cards.length,
    };
    return { ok: true, result: { bundle, filename: `${deck.name.replace(/[^\w-]+/g, "_")}.srs.json` } };
    } catch (e) { return { ok: false, error: "handler_error", message: String(e?.message || e) }; }
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
      const card = {
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
      };
      // S7: scheduling survives import — from the bundle's
      // scheduling block, or flat fields on hand-written bundles.
      const sch = (raw.scheduling && typeof raw.scheduling === "object") ? raw.scheduling : raw;
      if (["new", "learning", "review", "relearning"].includes(sch.state)) card.state = sch.state;
      if (Number.isFinite(+sch.interval)) card.interval = Math.max(0, Math.min(36500, Math.round(+sch.interval)));
      if (Number.isFinite(+sch.reps)) card.reps = Math.max(0, Math.round(+sch.reps));
      if (Number.isFinite(+sch.lapses)) card.lapses = Math.max(0, Math.round(+sch.lapses));
      if (Number.isFinite(+sch.ease)) card.ease = Math.max(1.3, Math.min(3, +sch.ease));
      if (Number.isFinite(+sch.stability)) card.stability = Math.max(0, +sch.stability);
      if (Number.isFinite(+sch.difficulty)) card.difficulty = Math.max(0, +sch.difficulty);
      if (sch.due && !Number.isNaN(Date.parse(sch.due))) card.due = new Date(sch.due).toISOString();
      else if (card.interval > 0 && card.state !== "new") card.due = new Date(Date.now() + card.interval * 86400000).toISOString();
      if (sch.lastReviewedAt && !Number.isNaN(Date.parse(sch.lastReviewedAt))) card.lastReviewedAt = new Date(sch.lastReviewedAt).toISOString();
      if (sch.introducedAt && !Number.isNaN(Date.parse(sch.introducedAt))) card.introducedAt = new Date(sch.introducedAt).toISOString();
      if (typeof sch.inSteps === "boolean") card.inSteps = sch.inSteps;
      if (Number.isFinite(+sch.stepIndex)) card.stepIndex = Math.max(0, Math.round(+sch.stepIndex));
      if (typeof sch.suspended === "boolean") card.suspended = sch.suspended;
      if (typeof sch.buried === "boolean") card.buried = sch.buried;
      cardsArr.push(card);
      imported++;
    }
    saveSrs();
    return { ok: true, result: { deck, imported } };
  });

  // ─── [S] Review heatmap / streak calendar + forecast graph ────────
  registerLensAction("srs", "review-heatmap", (ctx, _a, params = {}) => {
  try {
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
    } catch (e) { return { ok: false, error: "handler_error", message: String(e?.message || e) }; }
});

  registerLensAction("srs", "review-forecast", (ctx, _a, params = {}) => {
  try {
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
    } catch (e) { return { ok: false, error: "handler_error", message: String(e?.message || e) }; }
});
}
