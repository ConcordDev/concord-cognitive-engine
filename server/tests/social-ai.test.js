// server/tests/social-ai.test.js
//
// Tier-2 contract tests for Sprint B: 5-brain classifier + inverse-X
// ranker + custom feed algo CRUD + Bluesky-Attie-parity compose +
// algorithmic transparency (ranking_explain).

import { describe, it, before, after } from "node:test";
import assert from "node:assert/strict";
import Database from "better-sqlite3";
import registerSocialMacros from "../domains/social.js";
import registerSocialAiMacros from "../domains/social-ai.js";
import {
  classifyDeterministic, saveClassification, getClassification, ALL_AXES,
} from "../lib/social/classifier.js";
import {
  scorePost, rankFeed, recencyMultiplier, INVERSE_X_WEIGHTS, SEEDED_ALGOS,
} from "../lib/social/ranker.js";

const MACROS = new Map();
function register(_d, n, h) { MACROS.set(n, h); }
let db;

before(async () => {
  db = new Database(":memory:");
  for (const m of ["226_social_durable", "227_social_ai"]) {
    const x = await import(`../migrations/${m}.js`);
    x.up(db);
  }
  registerSocialMacros(register);
  registerSocialAiMacros(register);
});
after(() => { try { db.close(); } catch { /* ok */ } });

function ctx(userId, llm = null) { return { db, actor: { userId }, llm }; }

// ─── Classifier deterministic ───────────────────────────────────

describe("classifyDeterministic", () => {
  it("flags rage_bait on outrage tokens", () => {
    const c = classifyDeterministic("This is OUTRAGEOUS — I can't believe they would DESTROY everything!");
    assert.ok(c.rage_bait > 0.3);
  });

  it("flags engagement_bait on reply prompts", () => {
    const c = classifyDeterministic("Reply with your favorite, agree?");
    assert.ok(c.engagement_bait > 0.4);
  });

  it("flags informative on links + 'study shows'", () => {
    const c = classifyDeterministic("New study shows X. Source: https://example.com/paper");
    assert.ok(c.informative > 0.4);
  });

  it("flags helpful on 'how to' + 'pro tip'", () => {
    const c = classifyDeterministic("How to debug your CSS: pro tip — open devtools first.");
    assert.ok(c.helpful > 0.4);
  });

  it("flags question when ending with ?", () => {
    const c = classifyDeterministic("Does anyone know how to do this?");
    assert.ok(c.question > 0.3);
  });

  it("flags celebration on positive verbs + emoji", () => {
    const c = classifyDeterministic("Just shipped a thing! 🎉 So proud!");
    assert.ok(c.celebration > 0.4);
  });

  it("flags doomscroll on crisis tokens", () => {
    const c = classifyDeterministic("Everything is collapsing. We're all heading for catastrophe.");
    assert.ok(c.doomscroll > 0.3);
  });

  it("flags promotional on price + buy now", () => {
    const c = classifyDeterministic("Buy now $49 for limited time 30% off");
    assert.ok(c.promotional > 0.3);
  });

  it("returns all 13 axes with 0-1 values", () => {
    const c = classifyDeterministic("hello world");
    for (const axis of ALL_AXES) {
      assert.ok(axis in c, `missing axis ${axis}`);
      assert.ok(c[axis] >= 0 && c[axis] <= 1, `axis ${axis} out of range: ${c[axis]}`);
    }
  });
});

// ─── Classifier persistence ─────────────────────────────────────

describe("classifier persistence", () => {
  it("saveClassification + getClassification round-trip", () => {
    db.prepare(`INSERT INTO social_posts (id, author_id, content, published_at) VALUES (?, ?, ?, unixepoch())`).run("post:cls1", "u_cls", "hi");
    saveClassification(db, "post:cls1", { informative: 0.7, rage_bait: 0.1 });
    const c = getClassification(db, "post:cls1");
    assert.equal(c.informative, 0.7);
    assert.equal(c.rage_bait, 0.1);
    assert.equal(c.source, "llm");
  });

  it("saveClassification upserts (re-classify replaces)", () => {
    db.prepare(`INSERT INTO social_posts (id, author_id, content, published_at) VALUES (?, ?, ?, unixepoch())`).run("post:cls2", "u_cls", "hi");
    saveClassification(db, "post:cls2", { informative: 0.5 });
    saveClassification(db, "post:cls2", { informative: 0.9 });
    const c = getClassification(db, "post:cls2");
    assert.equal(c.informative, 0.9);
  });
});

// ─── Inverse-X ranker ───────────────────────────────────────────

describe("ranker scorePost", () => {
  it("INVERSE_X boosts informative + tanks rage_bait", () => {
    const now = Math.floor(Date.now() / 1000);
    const informative = scorePost({ published_at: now }, { informative: 0.9 }, INVERSE_X_WEIGHTS, { nowSec: now });
    const rageBait = scorePost({ published_at: now }, { rage_bait: 0.9 }, INVERSE_X_WEIGHTS, { nowSec: now });
    assert.ok(informative.score > rageBait.score, `informative=${informative.score} should beat rage=${rageBait.score}`);
    assert.ok(rageBait.score < 0 || rageBait.score < 3, `rage_bait should tank: ${rageBait.score}`);
  });

  it("recencyMultiplier decays with age", () => {
    const now = 1_900_000_000;
    assert.equal(recencyMultiplier(now, now), 1);
    const halfDay = recencyMultiplier(now - 12 * 3600, now);
    assert.ok(Math.abs(halfDay - 0.5) < 0.01, `12h half-life: ${halfDay}`);
  });

  it("breakdown reports per-axis contribution", () => {
    const r = scorePost({ published_at: Math.floor(Date.now() / 1000) }, { informative: 0.8, rage_bait: 0.5 }, INVERSE_X_WEIGHTS);
    assert.ok(Math.abs(r.breakdown.informative - 0.8 * 1.5) < 0.01);
    assert.ok(Math.abs(r.breakdown.rage_bait - 0.5 * -2.5) < 0.01);
  });

  it("reasons include both boost + tank lines", () => {
    const r = scorePost({ published_at: Math.floor(Date.now() / 1000) }, { informative: 0.9, rage_bait: 0.7 }, INVERSE_X_WEIGHTS);
    assert.ok(r.reasons.some((rs) => rs.includes("informative")));
    assert.ok(r.reasons.some((rs) => rs.includes("rage_bait")));
  });
});

describe("ranker rankFeed", () => {
  it("sorts posts by score DESC", () => {
    const now = Math.floor(Date.now() / 1000);
    const posts = [
      { id: "p1", published_at: now, classification: { rage_bait: 0.9 } },
      { id: "p2", published_at: now, classification: { informative: 0.9, helpful: 0.7 } },
      { id: "p3", published_at: now, classification: { celebration: 0.8 } },
    ];
    const ranked = rankFeed(posts, INVERSE_X_WEIGHTS);
    assert.equal(ranked[0].id, "p2"); // informative wins
    assert.equal(ranked[2].id, "p1"); // rage_bait loses
  });

  it("filter max_rage_bait removes posts above threshold", () => {
    const now = Math.floor(Date.now() / 1000);
    const posts = [
      { id: "ok", published_at: now, classification: { informative: 0.5, rage_bait: 0.1 } },
      { id: "filtered", published_at: now, classification: { rage_bait: 0.8 } },
    ];
    const ranked = rankFeed(posts, INVERSE_X_WEIGHTS, { filters: { max_rage_bait: 0.5 } });
    assert.equal(ranked.length, 1);
    assert.equal(ranked[0].id, "ok");
  });
});

describe("SEEDED_ALGOS structure", () => {
  it("includes inverse_x + hopeful_mornings + deep_learning + no_outrage", () => {
    const ids = SEEDED_ALGOS.map((a) => a.id);
    assert.ok(ids.includes("algo:seed:inverse_x"));
    assert.ok(ids.includes("algo:seed:hopeful_mornings"));
    assert.ok(ids.includes("algo:seed:deep_learning"));
    assert.ok(ids.includes("algo:seed:no_outrage"));
  });

  it("each algo has weights + filters", () => {
    for (const a of SEEDED_ALGOS) {
      assert.ok(a.weights);
      assert.ok(typeof a.weights.rage_bait === "number", `${a.id} missing rage_bait weight`);
    }
  });
});

// ─── Macros ──────────────────────────────────────────────────────

describe("classify_post macro", () => {
  it("fallback path classifies + persists when LLM offline", async () => {
    const post = await MACROS.get("post_create")(ctx("u_clsm"), { content: "How to debug CSS: open devtools." });
    const r = await MACROS.get("classify_post")(ctx("u_clsm"), { postId: post.id });
    assert.equal(r.ok, true);
    assert.equal(r.source, "fallback");
    assert.ok(r.classification.helpful > 0);
    const stored = await MACROS.get("classification_get")(ctx("u_clsm"), { postId: post.id });
    assert.ok(stored.classification != null);
  });

  it("LLM path merges with deterministic baseline (negative axes take MAX)", async () => {
    const post = await MACROS.get("post_create")(ctx("u_llm_cls"), { content: "OUTRAGEOUS news! Reply if you agree!" });
    const llm = { chat: async () => ({ content: '{"informative":0.2,"rage_bait":0.4,"engagement_bait":0.3,"reasoning":"meh"}' }) };
    const r = await MACROS.get("classify_post")({ db, actor: { userId: "u_llm_cls" }, llm }, { postId: post.id });
    assert.equal(r.source, "llm");
    // Baseline detects high rage_bait + engagement_bait; LLM said low. Should take MAX.
    assert.ok(r.classification.rage_bait > 0.4, `rage_bait should be max(baseline, llm): ${r.classification.rage_bait}`);
  });

  it("requires postId or content", async () => {
    const r = await MACROS.get("classify_post")(ctx("u_x"), {});
    assert.equal(r.ok, false); assert.equal(r.reason, "postId_or_content_required");
  });
});

describe("algo_list seeds + filters", () => {
  it("seeds 4 defaults on first call", async () => {
    const r = await MACROS.get("algo_list")(ctx("u_seed_a"));
    assert.equal(r.ok, true);
    const names = r.algos.map((a) => a.name);
    assert.ok(names.includes("Concord default (Inverse-X)"));
    assert.ok(names.includes("Hopeful mornings"));
    assert.ok(names.includes("Deep learning"));
    assert.ok(names.includes("No outrage"));
  });

  it("inverse_x is auto-set as default for the requesting user", async () => {
    const r = await MACROS.get("algo_list")(ctx("u_def_user"));
    const inverseX = r.algos.find((a) => a.id === "algo:seed:inverse_x");
    assert.ok(inverseX);
    assert.equal(inverseX.subscribed, true);
  });
});

describe("algo_create + algo_subscribe", () => {
  it("create custom algo + subscribe as default", async () => {
    const c = await MACROS.get("algo_create")(ctx("u_alg"), {
      name: "My positive feed",
      weights: { celebration: 3.0, rage_bait: -5.0 },
      visibility: "private",
    });
    assert.equal(c.ok, true);
    await MACROS.get("algo_subscribe")(ctx("u_alg"), { algoId: c.id, isDefault: true });
    const list = await MACROS.get("algo_list")(ctx("u_alg"));
    const mine = list.algos.find((a) => a.id === c.id);
    assert.equal(mine.is_default, 1);
  });
});

describe("algo_compose (Bluesky Attie parity)", () => {
  it("deterministic fallback handles 'no rage' prompts", async () => {
    const r = await MACROS.get("algo_compose")(ctx("u_compose"), { prompt: "I want a calm no-rage feed" });
    assert.equal(r.ok, true);
    assert.equal(r.source, "fallback");
    assert.ok(r.weights.rage_bait < 0);
    assert.ok(r.weights.calm > 0);
  });

  it("LLM path parses JSON + returns weights", async () => {
    const llm = { chat: async () => ({ content: '{"weights":{"informative":3,"rage_bait":-4},"filters":{"max_rage_bait":0.3},"name":"LLM feed","description":"d"}' }) };
    const r = await MACROS.get("algo_compose")({ db, actor: { userId: "u_lc" }, llm }, { prompt: "informative only" });
    assert.equal(r.source, "llm");
    assert.equal(r.weights.informative, 3);
    assert.equal(r.name, "LLM feed");
  });
});

describe("feed_ranked uses user's default algo", () => {
  it("ranked feed surfaces classifications + scores; OOTB Inverse-X filters out high rage_bait", async () => {
    const informative = await MACROS.get("post_create")(ctx("u_rf"), { content: "Source: https://example.com/study showed X" });
    const rage = await MACROS.get("post_create")(ctx("u_rf"), { content: "OUTRAGEOUS! How dare they DESTROY everything?" });
    await MACROS.get("classify_post")(ctx("u_rf"), { postId: informative.id });
    await MACROS.get("classify_post")(ctx("u_rf"), { postId: rage.id });
    const r = await MACROS.get("feed_ranked")(ctx("u_rf"), { source: "public" });
    assert.equal(r.ok, true);
    assert.equal(r.algoName, "Concord default (Inverse-X)");
    const infIdx = r.posts.findIndex((p) => p.id === informative.id);
    const rageIdx = r.posts.findIndex((p) => p.id === rage.id);
    assert.ok(infIdx >= 0, "informative post should be in the feed");
    // Inverse-X has max_rage_bait: 0.6 filter — high-rage posts get filtered out entirely
    assert.equal(rageIdx, -1, "high rage_bait post should be FILTERED OUT (not just ranked low) by Inverse-X");
  });

  it("ranked feed sorts by score within passing posts", async () => {
    const informative = await MACROS.get("post_create")(ctx("u_rfs"), { content: "Source: https://example.com/study showed X" });
    const meh = await MACROS.get("post_create")(ctx("u_rfs"), { content: "hello everyone" });
    await MACROS.get("classify_post")(ctx("u_rfs"), { postId: informative.id });
    await MACROS.get("classify_post")(ctx("u_rfs"), { postId: meh.id });
    const r = await MACROS.get("feed_ranked")(ctx("u_rfs"), { source: "public" });
    const infIdx = r.posts.findIndex((p) => p.id === informative.id);
    const mehIdx = r.posts.findIndex((p) => p.id === meh.id);
    assert.ok(infIdx >= 0 && mehIdx >= 0);
    assert.ok(infIdx < mehIdx, `informative (boosted) should rank above plain: infIdx=${infIdx} mehIdx=${mehIdx}`);
  });
});

describe("ranking_explain (algorithmic transparency)", () => {
  it("returns score + breakdown + reasons for a single post", async () => {
    const post = await MACROS.get("post_create")(ctx("u_explain"), { content: "How to debug CSS: pro tip — open devtools first." });
    await MACROS.get("classify_post")(ctx("u_explain"), { postId: post.id });
    const r = await MACROS.get("ranking_explain")(ctx("u_explain"), { postId: post.id });
    assert.equal(r.ok, true);
    assert.ok(typeof r.score === "number");
    assert.ok(r.classification != null);
    assert.ok(typeof r.breakdown === "object");
    assert.ok(Array.isArray(r.reasons));
  });

  it("writes to ranking_audit table", async () => {
    const post = await MACROS.get("post_create")(ctx("u_audit"), { content: "test" });
    await MACROS.get("ranking_explain")(ctx("u_audit"), { postId: post.id });
    const rows = db.prepare(`SELECT * FROM social_ranking_audit WHERE user_id = ? AND post_id = ?`).all("u_audit", post.id);
    assert.ok(rows.length >= 1);
  });
});
