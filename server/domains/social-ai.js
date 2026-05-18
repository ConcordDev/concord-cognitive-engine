// server/domains/social-ai.js
//
// Social lens Sprint B — AI surface. 5-brain content classifier +
// inverse-X ranker + custom feed DTU substrate + algorithmic
// transparency. Concord's structural advantage: no ad business, so
// the OOTB ranker can actually be inverse-X without a conflict of
// interest.

import { randomUUID } from "node:crypto";
import {
  classifyDeterministic, saveClassification, getClassification, listUnclassifiedPosts, ALL_AXES,
} from "../lib/social/classifier.js";
import {
  scorePost, rankFeed, INVERSE_X_WEIGHTS, SEEDED_ALGOS,
} from "../lib/social/ranker.js";
import { followingFeed, publicFeed, getPost } from "../lib/social/persistence.js";

function _resolveDb(ctx) { return ctx?.db || ctx?.STATE?.db || globalThis._concordSTATE?.db || null; }
function _actor(ctx) { return ctx?.actor?.userId || ctx?.userId || null; }
function _now() { return Math.floor(Date.now() / 1000); }
function _safeJson(s, fb) { if (s == null) return fb; try { return JSON.parse(s); } catch { return fb; } }

const TIMEOUT_MS = 12_000;
function _withTimeout(p, ms = TIMEOUT_MS) {
  return Promise.race([p, new Promise((_, rej) => setTimeout(() => rej(new Error(`timeout_${ms}ms`)), ms))]);
}
function _stripFences(s) {
  const m = String(s || "").match(/```(?:\w+)?\n([\s\S]*?)```/);
  return m ? m[1] : s;
}
function _extractJsonObject(raw) {
  const stripped = _stripFences(raw).trim();
  try { const v = JSON.parse(stripped); if (v && typeof v === "object") return v; } catch { /* try */ }
  const m = stripped.match(/\{[\s\S]*\}/);
  if (m) { try { return JSON.parse(m[0]); } catch { return null; } }
  return null;
}

function _recordAiRun(db, { userId, postId, kind, inputText, outputText, source = "llm", tokens = 0, latencyMs = null }) {
  if (!db || !kind) return null;
  try {
    db.prepare(`
      INSERT INTO social_ai_runs (user_id, post_id, kind, input_text, output_text, source, tokens, latency_ms, created_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(userId || null, postId || null, kind,
      inputText ? String(inputText).slice(0, 6000) : null,
      String(outputText || "").slice(0, 16000),
      source, tokens || 0, latencyMs, _now());
  } catch { /* best */ }
}

function _seedAlgos(db, userId) {
  try {
    // 1) Seed the 4 default algos if they don't exist yet
    const have = db.prepare(`SELECT COUNT(*) AS n FROM social_feed_algos WHERE id LIKE 'algo:seed:%'`).get().n;
    if (have === 0) {
      const ins = db.prepare(`
        INSERT INTO social_feed_algos (id, owner_id, name, description, icon, weights_json, filters_json, origin, visibility, created_at, updated_at)
        VALUES (?, 'system_seed', ?, ?, ?, ?, ?, 'seeded', 'public', unixepoch(), unixepoch())
        ON CONFLICT(id) DO NOTHING
      `);
      const tx = db.transaction(() => {
        for (const a of SEEDED_ALGOS) {
          ins.run(a.id, a.name, a.description, a.icon, JSON.stringify(a.weights), JSON.stringify(a.filters || {}));
        }
      });
      tx();
    }
    // 2) Always ensure the requesting user has inverse_x as their default
    // (no-op if they already subscribed to something) — must run even when
    // the algos were already seeded by a prior user.
    if (userId) {
      const has = db.prepare(`SELECT 1 FROM social_feed_algo_subscribers WHERE user_id = ? AND is_default = 1`).get(userId);
      if (!has) {
        db.prepare(`
          INSERT OR IGNORE INTO social_feed_algo_subscribers (algo_id, user_id, is_default, subscribed_at)
          VALUES ('algo:seed:inverse_x', ?, 1, unixepoch())
        `).run(userId);
      }
    }
  } catch { /* best */ }
}

export default function registerSocialAiMacros(register) {

  // ─── Classifier ──────────────────────────────────────────────────

  register("social", "classify_post", async (ctx, input = {}) => {
    const db = _resolveDb(ctx);
    if (!db) return { ok: false, reason: "no_db" };
    const postId = String(input.postId || "");
    const content = String(input.content || "");
    if (!postId && !content) return { ok: false, reason: "postId_or_content_required" };
    const realContent = content || (postId ? getPost(db, postId)?.content : null);
    if (!realContent) return { ok: false, reason: "post_not_found" };

    const llm = ctx?.llm;
    const t0 = Date.now();

    // Always run deterministic as a baseline
    const baseline = classifyDeterministic(realContent);

    if (!llm?.chat) {
      if (postId) saveClassification(db, postId, baseline, { source: "fallback", latencyMs: Date.now() - t0 });
      _recordAiRun(db, { userId: _actor(ctx), postId, kind: "classify", inputText: realContent, outputText: JSON.stringify(baseline), source: "fallback", latencyMs: Date.now() - t0 });
      return { ok: true, classification: baseline, source: "fallback" };
    }

    const sys = `You classify a social media post on 13 axes. Output a single JSON object with these keys, each value 0.0-1.0:
{
  "informative": 0-1 (facts, links, citations, explanations),
  "helpful": 0-1 (actionable advice, how-tos),
  "learning": 0-1 (teaches the reader something),
  "calm": 0-1 (low arousal, reflective),
  "celebration": 0-1 (positive personal news),
  "question": 0-1 (genuine curiosity / asking for help),
  "personal": 0-1 (from-author-to-reader vs broadcast),
  "creative": 0-1 (art, music, fiction, design),
  "rage_bait": 0-1 (designed to make readers angry),
  "engagement_bait": 0-1 ("reply with X", "agree?"),
  "controversy": 0-1 (combative, polarising),
  "promotional": 0-1 (ads, self-promo),
  "doomscroll": 0-1 (chronic crisis content),
  "reasoning": "one short sentence explaining the highest-scoring axes"
}
Output ONLY JSON.`;
    try {
      const r = await _withTimeout(llm.chat({
        messages: [{ role: "system", content: sys }, { role: "user", content: realContent.slice(0, 4000) }],
        temperature: 0.2, maxTokens: 600, slot: "utility",
      }), 8000);
      const raw = String(r?.text || r?.content || r?.message?.content || "").trim();
      const parsed = _extractJsonObject(raw);
      if (!parsed) {
        if (postId) saveClassification(db, postId, baseline, { source: "fallback", latencyMs: Date.now() - t0 });
        return { ok: true, classification: baseline, source: "fallback", reason: "parse_failed" };
      }
      // Merge LLM with baseline (max of the two for each axis — conservative on negative axes)
      const merged = {};
      for (const axis of ALL_AXES) {
        const llmV = Math.max(0, Math.min(1, Number(parsed[axis]) || 0));
        const baseV = baseline[axis] || 0;
        // For negative axes, take the max (more conservative). For positive, take LLM (more nuanced).
        const isNegative = ["rage_bait","engagement_bait","controversy","promotional","doomscroll"].includes(axis);
        merged[axis] = isNegative ? Math.max(llmV, baseV) : llmV;
      }
      const reasoning = parsed.reasoning ? String(parsed.reasoning).slice(0, 400) : null;
      if (postId) saveClassification(db, postId, merged, { source: "llm", tokens: Number(parsed.tokens) || 200, latencyMs: Date.now() - t0, reasoning });
      _recordAiRun(db, { userId: _actor(ctx), postId, kind: "classify", inputText: realContent, outputText: JSON.stringify(merged), source: "llm", tokens: 200, latencyMs: Date.now() - t0 });
      return { ok: true, classification: merged, reasoning, source: "llm" };
    } catch (e) {
      if (postId) saveClassification(db, postId, baseline, { source: "fallback" });
      return { ok: true, classification: baseline, source: "fallback", reason: "llm_error", error: e?.message };
    }
  }, { requiresLLM: false, note: "Classify a post on the 13 axes (5-brain classifier with deterministic fallback)" });

  register("social", "classification_get", async (ctx, input = {}) => {
    const db = _resolveDb(ctx);
    if (!db) return { ok: false, reason: "no_db" };
    const c = getClassification(db, String(input.postId || ""));
    return { ok: true, classification: c };
  }, { note: "Get a post's stored classification" });

  register("social", "classify_unclassified_batch", async (ctx, input = {}) => {
    const db = _resolveDb(ctx);
    if (!db) return { ok: false, reason: "no_db" };
    const userId = _actor(ctx);
    if (!userId) return { ok: false, reason: "auth_required" };
    const batchSize = Math.min(Math.max(1, Number(input.batchSize) || 20), 100);
    const posts = listUnclassifiedPosts(db, { limit: batchSize });
    let classified = 0;
    for (const p of posts) {
      const baseline = classifyDeterministic(p.content);
      saveClassification(db, p.id, baseline, { source: "fallback" });
      classified++;
    }
    return { ok: true, classified, batchSize, source: "deterministic" };
  }, { destructive: true, note: "Batch-classify unclassified posts (deterministic; intended for heartbeat)" });

  // ─── Custom feed algorithms ──────────────────────────────────────

  register("social", "algo_list", async (ctx) => {
    const db = _resolveDb(ctx);
    const userId = _actor(ctx);
    if (!db || !userId) return { ok: false, reason: "auth_required" };
    _seedAlgos(db, userId);
    const rows = db.prepare(`
      SELECT a.*, s.is_default
      FROM social_feed_algos a
      LEFT JOIN social_feed_algo_subscribers s ON s.algo_id = a.id AND s.user_id = ?
      WHERE a.owner_id = ? OR a.visibility IN ('workspace','public','published','global')
      ORDER BY s.is_default DESC NULLS LAST, a.subscriber_count DESC, a.updated_at DESC
      LIMIT 100
    `).all(userId, userId);
    return {
      ok: true,
      algos: rows.map((r) => ({
        ...r,
        weights: _safeJson(r.weights_json, {}),
        filters: _safeJson(r.filters_json, {}),
        subscribed: r.is_default != null,
      })),
    };
  }, { note: "List feed algorithms (mine + workspace + public + 4 seeded defaults)" });

  register("social", "algo_create", async (ctx, input = {}) => {
    const db = _resolveDb(ctx);
    const userId = _actor(ctx);
    if (!db || !userId) return { ok: false, reason: "auth_required" };
    const name = String(input.name || "").trim();
    if (!name) return { ok: false, reason: "name_required" };
    const id = `algo:${randomUUID()}`;
    db.prepare(`
      INSERT INTO social_feed_algos (id, owner_id, name, description, icon, weights_json, filters_json, lookback_hours, origin, llm_prompt, visibility, created_at, updated_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, unixepoch(), unixepoch())
    `).run(id, userId,
      name.slice(0, 120),
      input.description ? String(input.description).slice(0, 600) : null,
      input.icon || "🎯",
      JSON.stringify(input.weights || INVERSE_X_WEIGHTS),
      input.filters ? JSON.stringify(input.filters) : null,
      Math.max(1, Math.min(168, Number(input.lookbackHours) || 24)),
      ["human","llm","seeded"].includes(input.origin) ? input.origin : "human",
      input.llmPrompt ? String(input.llmPrompt).slice(0, 2000) : null,
      ["private","workspace","public","published","global"].includes(input.visibility) ? input.visibility : "private");
    return { ok: true, id };
  }, { destructive: true, note: "Create a custom feed algorithm" });

  register("social", "algo_compose", async (ctx, input = {}) => {
    const db = _resolveDb(ctx);
    const userId = _actor(ctx);
    if (!db || !userId) return { ok: false, reason: "auth_required" };
    const prompt = String(input.prompt || "").trim();
    if (!prompt) return { ok: false, reason: "prompt_required" };
    const llm = ctx?.llm;
    const t0 = Date.now();

    // Deterministic fallback: pattern-match common prompts to seed weights
    const lower = prompt.toLowerCase();
    let baseline = { ...INVERSE_X_WEIGHTS };
    if (/no rage|no outrage|no anger|calm/i.test(lower)) {
      baseline.rage_bait = -5; baseline.engagement_bait = -3; baseline.controversy = -3; baseline.calm = 2;
    }
    if (/learning|education|teach/i.test(lower)) {
      baseline.learning = 3; baseline.informative = 2.5; baseline.helpful = 2;
    }
    if (/celebrate|good news|positive/i.test(lower)) {
      baseline.celebration = 2.5; baseline.creative = 1.8;
    }

    if (!llm?.chat) {
      _recordAiRun(db, { userId, kind: "compose_algo", inputText: prompt, outputText: JSON.stringify({ weights: baseline }), source: "fallback", latencyMs: Date.now() - t0 });
      return { ok: true, weights: baseline, filters: {}, source: "fallback" };
    }

    const sys = `You produce a JSON spec for a social feed ranking algorithm. The spec has two keys:
{
  "weights": {  // each axis: -5 to +5; positive = boost, negative = tank
    "informative":  number,
    "helpful":      number,
    "learning":     number,
    "calm":         number,
    "celebration":  number,
    "question":     number,
    "personal":     number,
    "creative":     number,
    "rage_bait":    number,
    "engagement_bait": number,
    "controversy":  number,
    "promotional":  number,
    "doomscroll":   number
  },
  "filters": {   // optional hard cutoffs
    "min_informative":  number 0-1,
    "max_rage_bait":    number 0-1,
    "max_engagement_bait": number 0-1,
    "max_promotional":  number 0-1
  },
  "name": "short name for this algo",
  "description": "1-sentence description"
}
The user describes what they want in plain English; you produce the spec. Output ONLY the JSON object.`;

    try {
      const r = await _withTimeout(llm.chat({
        messages: [{ role: "system", content: sys }, { role: "user", content: prompt }],
        temperature: 0.4, maxTokens: 800, slot: "subconscious",
      }));
      const raw = String(r?.text || r?.content || r?.message?.content || "").trim();
      const parsed = _extractJsonObject(raw);
      if (!parsed?.weights) {
        return { ok: true, weights: baseline, filters: {}, source: "fallback", reason: "parse_failed" };
      }
      _recordAiRun(db, { userId, kind: "compose_algo", inputText: prompt, outputText: JSON.stringify(parsed), source: "llm", latencyMs: Date.now() - t0 });
      return { ok: true, weights: parsed.weights, filters: parsed.filters || {}, name: parsed.name, description: parsed.description, source: "llm" };
    } catch (e) {
      return { ok: true, weights: baseline, filters: {}, source: "fallback", reason: "llm_error", error: e?.message };
    }
  }, { note: "Bluesky-Attie parity: describe a feed in plain language, get a weight spec back" });

  register("social", "algo_subscribe", async (ctx, input = {}) => {
    const db = _resolveDb(ctx);
    const userId = _actor(ctx);
    if (!db || !userId) return { ok: false, reason: "auth_required" };
    const algoId = String(input.algoId || "");
    if (!algoId) return { ok: false, reason: "algoId_required" };
    const isDefault = input.isDefault ? 1 : 0;
    const tx = db.transaction(() => {
      if (isDefault) {
        db.prepare(`UPDATE social_feed_algo_subscribers SET is_default = 0 WHERE user_id = ?`).run(userId);
      }
      db.prepare(`
        INSERT INTO social_feed_algo_subscribers (algo_id, user_id, is_default, subscribed_at)
        VALUES (?, ?, ?, unixepoch())
        ON CONFLICT(algo_id, user_id) DO UPDATE SET is_default = excluded.is_default
      `).run(algoId, userId, isDefault);
      db.prepare(`UPDATE social_feed_algos SET subscriber_count = (SELECT COUNT(*) FROM social_feed_algo_subscribers WHERE algo_id = ?) WHERE id = ?`).run(algoId, algoId);
    });
    tx();
    return { ok: true };
  }, { destructive: true, note: "Subscribe to a feed algo (optionally as default)" });

  register("social", "algo_unsubscribe", async (ctx, input = {}) => {
    const db = _resolveDb(ctx);
    const userId = _actor(ctx);
    if (!db || !userId) return { ok: false, reason: "auth_required" };
    const algoId = String(input.algoId || "");
    db.prepare(`DELETE FROM social_feed_algo_subscribers WHERE algo_id = ? AND user_id = ?`).run(algoId, userId);
    db.prepare(`UPDATE social_feed_algos SET subscriber_count = (SELECT COUNT(*) FROM social_feed_algo_subscribers WHERE algo_id = ?) WHERE id = ?`).run(algoId, algoId);
    return { ok: true };
  }, { destructive: true, note: "Unsubscribe from a feed algo" });

  // ─── Ranked feed reads ───────────────────────────────────────────

  register("social", "feed_ranked", async (ctx, input = {}) => {
    const db = _resolveDb(ctx);
    const userId = _actor(ctx);
    if (!db || !userId) return { ok: false, reason: "auth_required" };
    _seedAlgos(db, userId);
    const algoId = input.algoId || db.prepare(`SELECT algo_id FROM social_feed_algo_subscribers WHERE user_id = ? AND is_default = 1`).get(userId)?.algo_id || "algo:seed:inverse_x";
    const algoRow = db.prepare(`SELECT * FROM social_feed_algos WHERE id = ?`).get(algoId);
    const weights = algoRow ? _safeJson(algoRow.weights_json, INVERSE_X_WEIGHTS) : INVERSE_X_WEIGHTS;
    const filters = algoRow ? _safeJson(algoRow.filters_json, {}) : {};
    const source = input.source === "public" ? "public" : "following";
    const rawPosts = source === "public" ? publicFeed(db, { limit: 200 }) : followingFeed(db, userId, { limit: 200 });
    // Hydrate classifications
    const ids = rawPosts.map((p) => p.id);
    let classMap = new Map();
    if (ids.length > 0) {
      const placeholders = ids.map(() => "?").join(", ");
      const rows = db.prepare(`SELECT * FROM social_post_classifications WHERE post_id IN (${placeholders})`).all(...ids);
      classMap = new Map(rows.map((r) => [r.post_id, r]));
    }
    const hydrated = rawPosts.map((p) => ({ ...p, classification: classMap.get(p.id) || classifyDeterministic(p.content) }));
    const ranked = rankFeed(hydrated, weights, { filters });
    return {
      ok: true,
      algoId, algoName: algoRow?.name || "Inverse-X (default)",
      source, count: ranked.length,
      posts: ranked.slice(0, Math.min(Number(input.limit) || 50, 200)),
    };
  }, { note: "Ranked feed using the user's default algo (or a specified algoId). Each post returns with score + breakdown + reasons." });

  register("social", "ranking_explain", async (ctx, input = {}) => {
    const db = _resolveDb(ctx);
    const userId = _actor(ctx);
    if (!db || !userId) return { ok: false, reason: "auth_required" };
    const postId = String(input.postId || "");
    const algoId = input.algoId || db.prepare(`SELECT algo_id FROM social_feed_algo_subscribers WHERE user_id = ? AND is_default = 1`).get(userId)?.algo_id || "algo:seed:inverse_x";
    const post = getPost(db, postId);
    if (!post) return { ok: false, reason: "post_not_found" };
    const classification = getClassification(db, postId) || classifyDeterministic(post.content);
    const algoRow = db.prepare(`SELECT * FROM social_feed_algos WHERE id = ?`).get(algoId);
    const weights = algoRow ? _safeJson(algoRow.weights_json, INVERSE_X_WEIGHTS) : INVERSE_X_WEIGHTS;
    const detail = scorePost(post, classification, weights);
    db.prepare(`
      INSERT INTO social_ranking_audit (user_id, post_id, algo_id, score, breakdown_json, reasons_json, created_at)
      VALUES (?, ?, ?, ?, ?, ?, ?)
    `).run(userId, postId, algoId, detail.score, JSON.stringify(detail.breakdown), JSON.stringify(detail.reasons), _now());
    return {
      ok: true,
      postId,
      algoId,
      algoName: algoRow?.name || "Inverse-X",
      classification,
      score: detail.score,
      raw: detail.raw,
      breakdown: detail.breakdown,
      reasons: detail.reasons,
      recencyMultiplier: detail.recencyMultiplier,
    };
  }, { note: "Why am I seeing this? Returns the full ranking breakdown for a single post under my current algo." });

  register("social", "ai_runs_recent", async (ctx, input = {}) => {
    const db = _resolveDb(ctx);
    const userId = _actor(ctx);
    if (!db || !userId) return { ok: false, reason: "auth_required" };
    const limit = Math.min(Math.max(1, Number(input.limit) || 50), 500);
    return { ok: true, runs: db.prepare(`SELECT * FROM social_ai_runs WHERE user_id = ? ORDER BY created_at DESC LIMIT ?`).all(userId, limit) };
  }, { note: "Recent AI invocations (classifier + algo composer + ranker)" });
}
