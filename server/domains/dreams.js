// server/domains/dreams.js
//
// Phase 7 — surfaces the dream-engine + forward-sim substrates so the
// world HUD can show the player what their subconscious has been doing
// while they were offline.
//
// Read macros (scoped to actor.userId):
//
//   dreams.recent        { limit? }       → { ok, dreams[] }  (each row carries dtu)
//   dreams.predictions   { worldId?, limit? } → { ok, predictions[] }
//
// Dream-record mechanic macros (the /lenses/dreams backlog):
//
//   dreams.detail        { dreamId }      → full composed prose + fragments + summary
//   dreams.publish       { dreamId, priceCc } → list a dream on the marketplace
//   dreams.unpublish     { dreamId }      → flip a dream back to personal scope
//   dreams.reprice       { dreamId, priceCc } → change a published dream's price
//   dreams.tag           { dreamId, tags[] } → set tags on a dream
//   dreams.search        { query?, tag?, scope?, limit? } → tag/full-text search
//   dreams.tags          { }              → distinct tag cloud across your dreams
//   dreams.timeline      { }              → dreams grouped by calendar day
//   dreams.interpret     { dreamId }      → deterministic reflection linking
//                                           dream fragments to recent activity
//
// Persistent per-user, non-schema data (tags, interpretation cache) lives in
// globalThis._concordSTATE Maps — migrations are append-only and the `dreams`
// table has no tags column, so per-user state is held here, keyed by userId.

import { getRecentDreams } from "../lib/embodied/dream-engine.js";
import { getActivePredictions } from "../lib/embodied/forward-sim.js";

// ── per-user state (tags + interpretation cache) ────────────────────────────

function dreamState() {
  const g = globalThis;
  if (!g._concordSTATE) g._concordSTATE = {};
  const s = g._concordSTATE;
  if (!s.dreamTags) s.dreamTags = new Map(); // userId → Map(dreamId → string[])
  if (!s.dreamInterpretations) s.dreamInterpretations = new Map(); // userId → Map(dreamId → object)
  return s;
}

function tagsForUser(userId) {
  const s = dreamState();
  let m = s.dreamTags.get(userId);
  if (!m) { m = new Map(); s.dreamTags.set(userId, m); }
  return m;
}

function interpCacheForUser(userId) {
  const s = dreamState();
  let m = s.dreamInterpretations.get(userId);
  if (!m) { m = new Map(); s.dreamInterpretations.set(userId, m); }
  return m;
}

// ── DTU column probing (the live `dtus` schema varies by deployment) ────────

function dtuColumns(db) {
  try {
    return new Set(db.prepare(`PRAGMA table_info(dtus)`).all().map((c) => c.name));
  } catch { return new Set(); }
}

function parseJson(v, fallback) {
  if (v == null) return fallback;
  if (typeof v === "object") return v;
  try { return JSON.parse(String(v)); } catch { return fallback; }
}

// Read one dream row + its hydrated DTU (prose/core/scope) for a user.
function loadDream(db, userId, dreamId) {
  const row = db.prepare(`
    SELECT id, user_id, world_id, dream_dtu_id, fragment_count,
           signature, composer, composed_at
      FROM dreams WHERE id = ? AND user_id = ?
  `).get(String(dreamId), userId);
  if (!row) return null;

  const cols = dtuColumns(db);
  let dtu = null;
  if (row.dream_dtu_id && cols.size) {
    const sel = ["id"];
    if (cols.has("title")) sel.push("title");
    if (cols.has("data")) sel.push("data");
    if (cols.has("body_json")) sel.push("body_json");
    if (cols.has("meta_json")) sel.push("meta_json");
    if (cols.has("scope")) sel.push("scope");
    if (cols.has("visibility")) sel.push("visibility");
    try {
      const r = db.prepare(`SELECT ${sel.join(", ")} FROM dtus WHERE id = ?`).get(row.dream_dtu_id);
      if (r) {
        const data = parseJson(r.data ?? r.body_json, {});
        // The `data` blob is the canonical meta store (the patch path writes
        // scope/priceCc there); meta_json is a legacy fallback for old rows.
        const meta = { ...parseJson(r.meta_json, {}), ...data };
        dtu = {
          id: r.id,
          title: r.title || "Dream",
          human: data.human || data.prose || "",
          core: data.core || {},
          machine: data.machine || {},
          meta,
          scope: meta.scope || r.scope || r.visibility || "personal",
        };
      }
    } catch { /* dtu absent or schema mismatch */ }
  }
  return { row, dtu };
}

// Persist a scope/price change onto the dream's DTU meta_json (and scope/visibility).
function patchDtuMeta(db, dtuId, patch) {
  const cols = dtuColumns(db);
  if (!dtuId || !cols.size) return false;
  let existing = {};
  if (cols.has("data")) {
    try {
      const r = db.prepare(`SELECT data AS meta_json FROM dtus WHERE id = ?`).get(dtuId);
      existing = parseJson(r?.meta_json, {});
    } catch { /* ignore */ }
  }
  const merged = { ...existing, ...patch };
  try {
    if (cols.has("data")) {
      db.prepare(`UPDATE dtus SET data = ? WHERE id = ?`).run(JSON.stringify(merged), dtuId);
    }
    // (scope is folded into the data blob above; dtus has no scope column —
    // the public/private projection below uses the real visibility column.)
    if (patch.scope && cols.has("visibility")) {
      db.prepare(`UPDATE dtus SET visibility = ? WHERE id = ?`)
        .run(patch.scope === "public" ? "marketplace" : "private", dtuId);
    }
    return true;
  } catch { return false; }
}

// ── deterministic interpretation ────────────────────────────────────────────
//
// Links dream fragments to the player's recent ledger activity. Never invents
// events: every sentence is derived from the dream's own summary counts +
// fragment kinds. The LLM dream-engine path stays opt-in; interpretation here
// is pure-compute so it works on every deployment.

function interpretDream(dtu, row) {
  const summary = (dtu?.core && dtu.core.summary) || {};
  const fragments = (dtu?.core && Array.isArray(dtu.core.fragments)) ? dtu.core.fragments : [];
  const kindCounts = {};
  for (const f of fragments) {
    const k = f && f.kind ? String(f.kind) : "unknown";
    kindCounts[k] = (kindCounts[k] || 0) + 1;
  }
  const dominant = Object.entries(kindCounts).sort((a, b) => b[1] - a[1])[0];

  const themes = [];
  const reflections = [];

  if ((summary.combatHits || 0) + (summary.combatTaken || 0) > 0) {
    themes.push("conflict");
    if (summary.kills > 0) {
      reflections.push(`The dream replays a day of lethal force — ${summary.kills} fell to you. Your subconscious is metabolising the weight of that.`);
    } else {
      reflections.push(`You traded ${summary.combatHits || 0} blows and absorbed ${summary.combatTaken || 0}. The dream is rehearsing the fight so the body learns it.`);
    }
  }
  if ((summary.painCount || 0) > 0) {
    themes.push("recovery");
    const intensity = (summary.painTotal || 0) / Math.max(1, summary.painCount || 1);
    reflections.push(intensity > 0.5
      ? "Pain threads run deep through this dream — the somatic ledger is still settling."
      : "A low hum of effort surfaces here; the body is filing minor strain.");
  }
  if ((summary.gathered || 0) > 0) {
    themes.push("provision");
    reflections.push(`The dream returns to your hands working the world — ${summary.gathered} gathers. Provisioning instincts are consolidating into habit.`);
  }
  if ((summary.visited || 0) > 1) {
    themes.push("exploration");
    reflections.push(`${summary.visited} thresholds crossed. The dream is widening your internal map of the world.`);
  }
  if ((summary.dtusCreated || 0) > 0) {
    themes.push("synthesis");
    reflections.push(`${summary.dtusCreated} thoughts solidified into knowledge — the dream is wiring them into long-term structure.`);
  }
  if (reflections.length === 0) {
    themes.push("stillness");
    reflections.push("A quiet substrate. With little to replay, the dream simply settles — rest itself is the work being done.");
  }

  const tone = themes.includes("conflict")
    ? "charged"
    : themes.includes("recovery")
      ? "tender"
      : themes.includes("synthesis")
        ? "lucid"
        : "calm";

  return {
    composer: "deterministic",
    tone,
    themes,
    dominantFragment: dominant ? { kind: dominant[0], count: dominant[1] } : null,
    fragmentKinds: kindCounts,
    fragmentCount: row?.fragment_count ?? fragments.length,
    reflection: reflections.join(" "),
    reflections,
    composedAt: Math.floor(Date.now() / 1000),
  };
}

// ── registration ────────────────────────────────────────────────────────────

export default function registerDreamsMacros(register) {
  register("dreams", "recent", async (ctx, input = {}) => {
    const db = ctx?.db;
    const userId = ctx?.actor?.userId;
    if (!db) return { ok: false, reason: "no_db" };
    if (!userId) return { ok: false, reason: "no_actor" };
    const limit = Math.min(50, Math.max(1, Number(input?.limit) || 10));
    try {
      const rows = getRecentDreams(db, userId, limit);
      const tagMap = tagsForUser(userId);
      const dreams = rows.map((d) => {
        let dtu = null;
        try {
          const r = db.prepare(`SELECT id, title, data FROM dtus WHERE id = ?`).get(d.dream_dtu_id);
          if (r) dtu = { id: r.id, title: r.title, data: parseJson(r.data, r.data) };
        } catch { /* dtu absent */ }
        return { ...d, dtu, tags: tagMap.get(String(d.id)) || [] };
      });
      return { ok: true, count: dreams.length, dreams };
    } catch (err) { return { ok: false, error: String(err?.message || err) }; }
  }, { note: "Recent dream compositions (one per offline pass, ~6h cooldown). Each row carries the dream DTU + tags." });

  register("dreams", "predictions", async (ctx, input = {}) => {
    const db = ctx?.db;
    const userId = ctx?.actor?.userId;
    if (!db) return { ok: false, reason: "no_db" };
    if (!userId) return { ok: false, reason: "no_actor" };
    const limit = Math.min(50, Math.max(1, Number(input?.limit) || 10));
    try {
      let predictions = getActivePredictions(db, userId, limit);
      if (input?.worldId) {
        predictions = predictions.filter((p) => !p.world_id || p.world_id === input.worldId);
      }
      return { ok: true, count: predictions.length, predictions };
    } catch (err) { return { ok: false, error: String(err?.message || err) }; }
  }, { note: "Active (non-realised, non-expired) forward-sim predictions for the auth'd player." });

  // ── dreams.detail — full-text reader ──────────────────────────────────────
  register("dreams", "detail", async (ctx, input = {}) => {
    const db = ctx?.db;
    const userId = ctx?.actor?.userId;
    if (!db) return { ok: false, reason: "no_db" };
    if (!userId) return { ok: false, reason: "no_actor" };
    const dreamId = input?.dreamId;
    if (!dreamId) return { ok: false, reason: "missing_dreamId" };
    try {
      const loaded = loadDream(db, userId, dreamId);
      if (!loaded) return { ok: false, reason: "dream_not_found" };
      const { row, dtu } = loaded;
      const tagMap = tagsForUser(userId);
      return {
        ok: true,
        dream: {
          id: row.id,
          worldId: row.world_id,
          dreamDtuId: row.dream_dtu_id,
          fragmentCount: row.fragment_count,
          signature: row.signature,
          composer: row.composer,
          composedAt: row.composed_at,
          title: dtu?.title || "Dream",
          prose: dtu?.human || "",
          fragments: (dtu?.core && Array.isArray(dtu.core.fragments)) ? dtu.core.fragments : [],
          summary: (dtu?.core && dtu.core.summary) || {},
          scope: dtu?.scope || "personal",
          priceCc: dtu?.meta?.priceCc ?? null,
          tags: tagMap.get(String(row.id)) || [],
        },
      };
    } catch (err) { return { ok: false, error: String(err?.message || err) }; }
  }, { note: "Full composed prose + fragments + summary for one dream (the dream-record reader)." });

  // ── dreams.publish — list on the marketplace at a custom CC price ─────────
  register("dreams", "publish", async (ctx, input = {}) => {
    const db = ctx?.db;
    const userId = ctx?.actor?.userId;
    if (!db) return { ok: false, reason: "no_db" };
    if (!userId) return { ok: false, reason: "no_actor" };
    const dreamId = input?.dreamId;
    if (!dreamId) return { ok: false, reason: "missing_dreamId" };
    const priceCc = Math.max(1, Math.min(10000, Math.round(Number(input?.priceCc) || 5)));
    try {
      const loaded = loadDream(db, userId, dreamId);
      if (!loaded) return { ok: false, reason: "dream_not_found" };
      const { row, dtu } = loaded;
      if (!row.dream_dtu_id) return { ok: false, reason: "no_dtu" };
      const patched = patchDtuMeta(db, row.dream_dtu_id, {
        scope: "public",
        priceCc,
        publishedAt: Math.floor(Date.now() / 1000),
      });
      if (!patched) return { ok: false, reason: "publish_failed" };
      return {
        ok: true,
        dreamId: row.id,
        dtuId: row.dream_dtu_id,
        scope: "public",
        priceCc,
        currency: "CC",
      };
    } catch (err) { return { ok: false, error: String(err?.message || err) }; }
  }, { note: "Publish a dream to the marketplace at a custom CC price. Royalty cascade pays the dreamer." });

  // ── dreams.unpublish — flip back to personal scope ───────────────────────
  register("dreams", "unpublish", async (ctx, input = {}) => {
    const db = ctx?.db;
    const userId = ctx?.actor?.userId;
    if (!db) return { ok: false, reason: "no_db" };
    if (!userId) return { ok: false, reason: "no_actor" };
    const dreamId = input?.dreamId;
    if (!dreamId) return { ok: false, reason: "missing_dreamId" };
    try {
      const loaded = loadDream(db, userId, dreamId);
      if (!loaded) return { ok: false, reason: "dream_not_found" };
      const { row } = loaded;
      if (!row.dream_dtu_id) return { ok: false, reason: "no_dtu" };
      const patched = patchDtuMeta(db, row.dream_dtu_id, {
        scope: "personal",
        priceCc: null,
        unpublishedAt: Math.floor(Date.now() / 1000),
      });
      if (!patched) return { ok: false, reason: "unpublish_failed" };
      return { ok: true, dreamId: row.id, dtuId: row.dream_dtu_id, scope: "personal" };
    } catch (err) { return { ok: false, error: String(err?.message || err) }; }
  }, { note: "Withdraw a published dream from the marketplace; reverts scope to personal." });

  // ── dreams.reprice — change a published dream's price ─────────────────────
  register("dreams", "reprice", async (ctx, input = {}) => {
    const db = ctx?.db;
    const userId = ctx?.actor?.userId;
    if (!db) return { ok: false, reason: "no_db" };
    if (!userId) return { ok: false, reason: "no_actor" };
    const dreamId = input?.dreamId;
    if (!dreamId) return { ok: false, reason: "missing_dreamId" };
    const priceCc = Math.max(1, Math.min(10000, Math.round(Number(input?.priceCc) || 0)));
    if (!priceCc) return { ok: false, reason: "invalid_price" };
    try {
      const loaded = loadDream(db, userId, dreamId);
      if (!loaded) return { ok: false, reason: "dream_not_found" };
      const { row, dtu } = loaded;
      if (!row.dream_dtu_id) return { ok: false, reason: "no_dtu" };
      if ((dtu?.scope || "personal") !== "public") return { ok: false, reason: "not_published" };
      const patched = patchDtuMeta(db, row.dream_dtu_id, {
        scope: "public",
        priceCc,
        repricedAt: Math.floor(Date.now() / 1000),
      });
      if (!patched) return { ok: false, reason: "reprice_failed" };
      return { ok: true, dreamId: row.id, dtuId: row.dream_dtu_id, priceCc, currency: "CC" };
    } catch (err) { return { ok: false, error: String(err?.message || err) }; }
  }, { note: "Change the CC price of an already-published dream." });

  // ── dreams.tag — set tags on a dream ─────────────────────────────────────
  register("dreams", "tag", async (ctx, input = {}) => {
    const db = ctx?.db;
    const userId = ctx?.actor?.userId;
    if (!db) return { ok: false, reason: "no_db" };
    if (!userId) return { ok: false, reason: "no_actor" };
    const dreamId = input?.dreamId;
    if (!dreamId) return { ok: false, reason: "missing_dreamId" };
    try {
      const loaded = loadDream(db, userId, dreamId);
      if (!loaded) return { ok: false, reason: "dream_not_found" };
      const raw = Array.isArray(input?.tags) ? input.tags : [];
      const tags = [...new Set(
        raw.map((t) => String(t || "").trim().toLowerCase())
          .filter((t) => t.length > 0 && t.length <= 32),
      )].slice(0, 12);
      const tagMap = tagsForUser(userId);
      tagMap.set(String(dreamId), tags);
      return { ok: true, dreamId: String(dreamId), tags };
    } catch (err) { return { ok: false, error: String(err?.message || err) }; }
  }, { note: "Set (replace) the tag list on one of your dreams. Up to 12 tags, ≤32 chars each." });

  // ── dreams.tags — distinct tag cloud across your dreams ───────────────────
  register("dreams", "tags", async (ctx, _input = {}) => {
    const db = ctx?.db;
    const userId = ctx?.actor?.userId;
    if (!db) return { ok: false, reason: "no_db" };
    if (!userId) return { ok: false, reason: "no_actor" };
    try {
      const ownIds = new Set(
        db.prepare(`SELECT id FROM dreams WHERE user_id = ?`).all(userId).map((r) => String(r.id)),
      );
      const tagMap = tagsForUser(userId);
      const counts = {};
      for (const [dreamId, tags] of tagMap.entries()) {
        if (!ownIds.has(String(dreamId))) continue;
        for (const t of tags || []) counts[t] = (counts[t] || 0) + 1;
      }
      const cloud = Object.entries(counts)
        .map(([tag, count]) => ({ tag, count }))
        .sort((a, b) => b.count - a.count || a.tag.localeCompare(b.tag));
      return { ok: true, count: cloud.length, tags: cloud };
    } catch (err) { return { ok: false, error: String(err?.message || err) }; }
  }, { note: "Distinct tag cloud (tag + usage count) across all your dreams." });

  // ── dreams.search — tag + full-text search across dream history ──────────
  register("dreams", "search", async (ctx, input = {}) => {
    const db = ctx?.db;
    const userId = ctx?.actor?.userId;
    if (!db) return { ok: false, reason: "no_db" };
    if (!userId) return { ok: false, reason: "no_actor" };
    const query = String(input?.query || "").trim().toLowerCase();
    const tagFilter = String(input?.tag || "").trim().toLowerCase();
    const scopeFilter = ["public", "personal"].includes(input?.scope) ? input.scope : null;
    const limit = Math.min(100, Math.max(1, Number(input?.limit) || 50));
    try {
      const rows = db.prepare(`
        SELECT id, world_id, dream_dtu_id, fragment_count, composer, composed_at
          FROM dreams WHERE user_id = ? ORDER BY composed_at DESC LIMIT 400
      `).all(userId);
      const tagMap = tagsForUser(userId);
      const matches = [];
      for (const row of rows) {
        const loaded = loadDream(db, userId, row.id);
        const dtu = loaded?.dtu;
        const tags = tagMap.get(String(row.id)) || [];
        const scope = dtu?.scope || "personal";
        if (scopeFilter && scope !== scopeFilter) continue;
        if (tagFilter && !tags.includes(tagFilter)) continue;
        if (query) {
          const hay = [
            dtu?.title || "",
            dtu?.human || "",
            tags.join(" "),
            ((dtu?.core && Array.isArray(dtu.core.fragments)) ? dtu.core.fragments : [])
              .map((f) => f?.kind || "").join(" "),
          ].join(" ").toLowerCase();
          if (!hay.includes(query)) continue;
        }
        matches.push({
          id: row.id,
          worldId: row.world_id,
          title: dtu?.title || "Dream",
          prose: dtu?.human || "",
          fragmentCount: row.fragment_count,
          composer: row.composer,
          composedAt: row.composed_at,
          scope,
          priceCc: dtu?.meta?.priceCc ?? null,
          tags,
        });
        if (matches.length >= limit) break;
      }
      return { ok: true, count: matches.length, query, tag: tagFilter || null, scope: scopeFilter, dreams: matches };
    } catch (err) { return { ok: false, error: String(err?.message || err) }; }
  }, { note: "Search your dream history by free text (title/prose/fragment kinds), tag, or scope." });

  // ── dreams.timeline — dreams grouped by calendar day ─────────────────────
  register("dreams", "timeline", async (ctx, _input = {}) => {
    const db = ctx?.db;
    const userId = ctx?.actor?.userId;
    if (!db) return { ok: false, reason: "no_db" };
    if (!userId) return { ok: false, reason: "no_actor" };
    try {
      const rows = db.prepare(`
        SELECT id, world_id, dream_dtu_id, fragment_count, composer, composed_at
          FROM dreams WHERE user_id = ? ORDER BY composed_at DESC LIMIT 365
      `).all(userId);
      const tagMap = tagsForUser(userId);
      // Batch-resolve dream DTU titles in one query (was an N+1 per dream row).
      const dtuTitleById = new Map();
      const dtuIds = [...new Set(rows.map((r) => r.dream_dtu_id).filter(Boolean))];
      if (dtuIds.length) {
        try {
          const placeholders = dtuIds.map(() => "?").join(",");
          const titleRows = db.prepare(
            `SELECT id, title FROM dtus WHERE id IN (${placeholders})`
          ).all(...dtuIds);
          for (const tr of titleRows) dtuTitleById.set(tr.id, tr);
        } catch { /* dtus absent */ }
      }
      const byDay = new Map();
      for (const row of rows) {
        const day = new Date(Number(row.composed_at) * 1000).toISOString().slice(0, 10);
        const dtu = dtuTitleById.get(row.dream_dtu_id) || null;
        if (!byDay.has(day)) byDay.set(day, []);
        byDay.get(day).push({
          id: row.id,
          title: dtu?.title || "Dream",
          fragmentCount: row.fragment_count,
          composer: row.composer,
          composedAt: row.composed_at,
          worldId: row.world_id,
          tags: tagMap.get(String(row.id)) || [],
        });
      }
      const days = [...byDay.entries()]
        .map(([day, dreams]) => ({ day, count: dreams.length, dreams }))
        .sort((a, b) => b.day.localeCompare(a.day));
      return { ok: true, totalDreams: rows.length, days };
    } catch (err) { return { ok: false, error: String(err?.message || err) }; }
  }, { note: "Your dreams grouped into a per-day calendar timeline." });

  // ── dreams.interpret — deterministic AI reflection ───────────────────────
  register("dreams", "interpret", async (ctx, input = {}) => {
    const db = ctx?.db;
    const userId = ctx?.actor?.userId;
    if (!db) return { ok: false, reason: "no_db" };
    if (!userId) return { ok: false, reason: "no_actor" };
    const dreamId = input?.dreamId;
    if (!dreamId) return { ok: false, reason: "missing_dreamId" };
    try {
      const cache = interpCacheForUser(userId);
      if (!input?.refresh && cache.has(String(dreamId))) {
        return { ok: true, dreamId: String(dreamId), cached: true, interpretation: cache.get(String(dreamId)) };
      }
      const loaded = loadDream(db, userId, dreamId);
      if (!loaded) return { ok: false, reason: "dream_not_found" };
      const interpretation = interpretDream(loaded.dtu, loaded.row);
      cache.set(String(dreamId), interpretation);
      return { ok: true, dreamId: String(dreamId), cached: false, interpretation };
    } catch (err) { return { ok: false, error: String(err?.message || err) }; }
  }, { note: "Deterministic reflection linking a dream's fragments to recent activity. Cached per dream; pass refresh:true to recompute." });
}
