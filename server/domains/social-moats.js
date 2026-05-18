// server/domains/social-moats.js
//
// Social lens Sprint C — concord-native moats. Mint posts + custom
// feed algorithms as DTUs, cross-lens cite cascade (post → doc /
// task / calendar / chat / browser-agent DTU fires royalty cascade),
// federation processor heartbeat (turns the existing migration-198
// outbox + inbox tables alive), and an install path for marketplace
// algorithms.

import { randomUUID } from "node:crypto";
import { getPost } from "../lib/social/persistence.js";

function _resolveDb(ctx) { return ctx?.db || ctx?.STATE?.db || globalThis._concordSTATE?.db || null; }
function _actor(ctx) { return ctx?.actor?.userId || ctx?.userId || null; }
function _now() { return Math.floor(Date.now() / 1000); }
function _safeJson(s, fb) { if (s == null) return fb; try { return JSON.parse(s); } catch { return fb; } }

const VALID_VIS = new Set(["private","workspace","public","published","global"]);

export default function registerSocialMoatsMacros(register) {

  // ─── Mint post as DTU ────────────────────────────────────────────

  register("social", "post_mint", async (ctx, input = {}) => {
    const db = _resolveDb(ctx);
    const userId = _actor(ctx);
    if (!db || !userId) return { ok: false, reason: "auth_required" };
    const postId = String(input.postId || input.id || "");
    const post = getPost(db, postId);
    if (!post) return { ok: false, reason: "not_found" };
    if (post.author_id !== userId) return { ok: false, reason: "forbidden" };
    if (post.visibility === "private") return { ok: false, reason: "cannot_mint_private_post" };
    const existing = db.prepare(`SELECT * FROM social_post_mints WHERE post_id = ?`).get(postId);
    if (existing) return { ok: true, dtuId: existing.dtu_id, alreadyMinted: true };
    const visibility = VALID_VIS.has(input.visibility) ? input.visibility : "public";
    const royaltyRate = typeof input.royaltyRate === "number" ? Math.max(0, Math.min(0.30, input.royaltyRate)) : 0.21;
    const dtuId = `social_post:${randomUUID()}`;
    try {
      const tx = db.transaction(() => {
        db.prepare(`
          INSERT INTO dtus (id, kind, title, creator_id, meta_json, created_at)
          VALUES (?, 'social_post', ?, ?, ?, unixepoch())
        `).run(dtuId, post.content.slice(0, 200), userId, JSON.stringify({
          type: "social_post", post_id: postId,
          content: post.content, content_format: post.content_format,
          published_at: post.published_at, royalty_rate: royaltyRate, visibility,
        }));
        db.prepare(`
          INSERT INTO social_post_mints (post_id, dtu_id, creator_id, royalty_rate, visibility, allow_citation, minted_at)
          VALUES (?, ?, ?, ?, ?, ?, ?)
        `).run(postId, dtuId, userId, royaltyRate, visibility, input.allowCitation === false ? 0 : 1, _now());
        db.prepare(`UPDATE social_posts SET dtu_id = ?, updated_at = ? WHERE id = ?`).run(dtuId, _now(), postId);
      });
      tx();
      return { ok: true, dtuId, royaltyRate, visibility };
    } catch (err) {
      return { ok: false, reason: "mint_failed", error: err?.message };
    }
  }, { destructive: true, note: "Mint a post as a citable social_post DTU" });

  register("social", "post_mint_status", async (ctx, input = {}) => {
    const db = _resolveDb(ctx);
    const userId = _actor(ctx);
    if (!db || !userId) return { ok: false, reason: "auth_required" };
    const m = db.prepare(`SELECT * FROM social_post_mints WHERE post_id = ?`).get(String(input.postId || input.id || ""));
    return { ok: true, minted: !!m, mint: m || null };
  }, { note: "Check whether a post is minted" });

  register("social", "post_cite_dtu", async (ctx, input = {}) => {
    const db = _resolveDb(ctx);
    const userId = _actor(ctx);
    if (!db || !userId) return { ok: false, reason: "auth_required" };
    const postId = String(input.postId || "");
    const parentDtuId = String(input.dtuId || input.parentDtuId || "");
    if (!postId || !parentDtuId) return { ok: false, reason: "postId_and_dtuId_required" };
    const post = getPost(db, postId);
    if (!post || post.author_id !== userId) return { ok: false, reason: "not_found" };
    const mint = db.prepare(`SELECT dtu_id, creator_id FROM social_post_mints WHERE post_id = ?`).get(postId);
    if (!mint) return { ok: false, reason: "post_not_minted_yet" };
    const parentDtu = db.prepare(`SELECT id, creator_id, kind, meta_json FROM dtus WHERE id = ?`).get(parentDtuId);
    if (!parentDtu) return { ok: false, reason: "parent_dtu_not_found" };
    try {
      const { registerCitation } = await import("../economy/royalty-cascade.js");
      const r = registerCitation(db, {
        childId: mint.dtu_id, parentId: parentDtu.id,
        creatorId: mint.creator_id, parentCreatorId: parentDtu.creator_id,
        parentDtu, hasPurchasedLicense: !!input.hasPurchasedLicense, generation: 1,
      });
      if (!r.ok) return r;
      db.prepare(`UPDATE social_post_mints SET citation_count = citation_count + 1 WHERE post_id = ?`).run(postId);
      return { ok: true, childDtuId: mint.dtu_id, parentDtuId, cascade: r };
    } catch (err) {
      return { ok: true, childDtuId: mint.dtu_id, parentDtuId, cascade: { ok: false, reason: "engine_unavailable", error: err?.message } };
    }
  }, { destructive: true, note: "Post cites a cross-lens DTU (doc/task/calendar/chat/browser-agent) → royalty cascade fires" });

  // ─── Mint custom feed algo as agent_spec DTU ─────────────────────

  register("social", "algo_publish", async (ctx, input = {}) => {
    const db = _resolveDb(ctx);
    const userId = _actor(ctx);
    if (!db || !userId) return { ok: false, reason: "auth_required" };
    const algoId = String(input.algoId || input.id || "");
    const algo = db.prepare(`SELECT * FROM social_feed_algos WHERE id = ?`).get(algoId);
    if (!algo) return { ok: false, reason: "not_found" };
    if (algo.owner_id !== userId) return { ok: false, reason: "forbidden" };
    if (algo.owner_id === "system_seed") return { ok: false, reason: "cannot_publish_seeded_algo" };
    const existing = db.prepare(`SELECT * FROM social_algo_mints WHERE algo_id = ?`).get(algoId);
    if (existing) return { ok: true, dtuId: existing.dtu_id, alreadyPublished: true };
    const royaltyRate = typeof input.royaltyRate === "number" ? Math.max(0, Math.min(0.30, input.royaltyRate)) : 0.21;
    const visibility = VALID_VIS.has(input.visibility) ? input.visibility : "public";
    const dtuId = `agent_spec:${randomUUID()}`;
    try {
      const tx = db.transaction(() => {
        db.prepare(`
          INSERT INTO dtus (id, kind, title, creator_id, meta_json, created_at)
          VALUES (?, 'agent_spec', ?, ?, ?, unixepoch())
        `).run(dtuId, `Feed: ${algo.name}`, userId, JSON.stringify({
          type: "agent_spec", kind: "social_feed_algo",
          name: algo.name, description: algo.description, icon: algo.icon,
          weights: _safeJson(algo.weights_json, {}),
          filters: _safeJson(algo.filters_json, {}),
          lookback_hours: algo.lookback_hours,
          llm_prompt: algo.llm_prompt,
          royalty_rate: royaltyRate,
        }));
        db.prepare(`
          INSERT INTO social_algo_mints (algo_id, dtu_id, creator_id, royalty_rate, visibility, subscriber_count_at_mint, minted_at)
          VALUES (?, ?, ?, ?, ?, ?, ?)
        `).run(algoId, dtuId, userId, royaltyRate, visibility, algo.subscriber_count || 0, _now());
        db.prepare(`UPDATE social_feed_algos SET dtu_id = ?, visibility = ?, updated_at = ? WHERE id = ?`).run(dtuId, visibility, _now(), algoId);
      });
      tx();
      return { ok: true, dtuId, royaltyRate, visibility };
    } catch (err) {
      return { ok: false, reason: "publish_failed", error: err?.message };
    }
  }, { destructive: true, note: "Publish a custom feed algorithm as a marketplace agent_spec DTU" });

  register("social", "algo_install", async (ctx, input = {}) => {
    const db = _resolveDb(ctx);
    const userId = _actor(ctx);
    if (!db || !userId) return { ok: false, reason: "auth_required" };
    const sourceId = String(input.algoId || input.id || "");
    const source = db.prepare(`SELECT * FROM social_feed_algos WHERE id = ?`).get(sourceId);
    if (!source) return { ok: false, reason: "not_found" };
    if (source.visibility === "private") return { ok: false, reason: "not_published" };
    // Create my own copy of the algo
    const newId = `algo:${randomUUID()}`;
    db.prepare(`
      INSERT INTO social_feed_algos (id, owner_id, name, description, icon, weights_json, filters_json, lookback_hours, origin, llm_prompt, visibility, created_at, updated_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, 'human', ?, 'private', unixepoch(), unixepoch())
    `).run(newId, userId,
      `${source.name} (installed)`,
      source.description, source.icon,
      source.weights_json, source.filters_json,
      source.lookback_hours,
      source.llm_prompt);
    // Subscribe me to the new copy
    db.prepare(`INSERT INTO social_feed_algo_subscribers (algo_id, user_id, is_default, subscribed_at) VALUES (?, ?, 0, unixepoch())`).run(newId, userId);
    // Bump the source's install counter (if minted)
    db.prepare(`UPDATE social_algo_mints SET install_count = install_count + 1 WHERE algo_id = ?`).run(sourceId);
    db.prepare(`UPDATE social_feed_algos SET subscriber_count = (SELECT COUNT(*) FROM social_feed_algo_subscribers WHERE algo_id = ?) WHERE id = ?`).run(sourceId, sourceId);
    return { ok: true, newAlgoId: newId, source: sourceId };
  }, { destructive: true, note: "Install a marketplace algorithm as my own private copy I can further tune" });

  // ─── Federation processor (turn outbox alive) ────────────────────

  register("social", "federation_outbox_status", async (ctx) => {
    const db = _resolveDb(ctx);
    const userId = _actor(ctx);
    if (!db || !userId) return { ok: false, reason: "auth_required" };
    let pending = 0, sent = 0, failed = 0;
    try {
      pending = db.prepare(`SELECT COUNT(*) AS n FROM social_federation_outbox_status WHERE status = 'pending'`).get().n;
      sent = db.prepare(`SELECT COUNT(*) AS n FROM social_federation_outbox_status WHERE status = 'sent'`).get().n;
      failed = db.prepare(`SELECT COUNT(*) AS n FROM social_federation_outbox_status WHERE status = 'failed'`).get().n;
    } catch { /* outbox tables not present */ }
    return { ok: true, pending, sent, failed };
  }, { note: "Outbox processing health (pending / sent / failed counts)" });

  /**
   * Heartbeat-friendly processor pass. Picks up to N pending outbox
   * rows, marks them sent (federation_outbox writes are best-effort
   * at this stage — full ActivityPub delivery wires in a follow-up).
   * Tests verify the state machine; runtime delivery is a no-op for
   * now and lands deterministic-status-update rows.
   */
  register("social", "federation_outbox_process", async (ctx, input = {}) => {
    const db = _resolveDb(ctx);
    const userId = _actor(ctx);
    if (!db || !userId) return { ok: false, reason: "auth_required" };
    const batchSize = Math.min(Math.max(1, Number(input.batchSize) || 25), 200);
    let processed = 0, skipped = 0;
    try {
      // Insert status rows for any new outbox entries we haven't seen yet
      const newPending = db.prepare(`
        SELECT o.id FROM federation_outbox o
        LEFT JOIN social_federation_outbox_status s ON s.outbox_id = o.id
        WHERE s.outbox_id IS NULL LIMIT ?
      `).all(batchSize);
      const ins = db.prepare(`
        INSERT INTO social_federation_outbox_status (outbox_id, status, attempts, updated_at)
        VALUES (?, 'pending', 0, unixepoch())
      `);
      for (const row of newPending) {
        try { ins.run(row.id); } catch { /* race */ }
      }
      // Mark them sent (placeholder — actual ActivityPub POST lands in a follow-up)
      const due = db.prepare(`
        SELECT outbox_id FROM social_federation_outbox_status
        WHERE status = 'pending' AND (next_retry_at IS NULL OR next_retry_at <= ?)
        LIMIT ?
      `).all(_now(), batchSize);
      const upd = db.prepare(`
        UPDATE social_federation_outbox_status
        SET status = 'sent', attempts = attempts + 1, processed_at = ?, updated_at = ?
        WHERE outbox_id = ?
      `);
      for (const row of due) {
        upd.run(_now(), _now(), row.outbox_id);
        processed++;
      }
    } catch (err) {
      // federation_outbox table may not exist in test envs
      return { ok: true, processed: 0, skipped: 0, reason: "outbox_unavailable", note: err?.message };
    }
    return { ok: true, processed, skipped };
  }, { destructive: true, note: "Federation outbox processor pass (heartbeat-friendly; turn the existing migration-198 tables alive)" });

  // ─── Refusal-Field integration (concord-native moat) ────────────

  register("social", "post_check_refusal", async (ctx, input = {}) => {
    const db = _resolveDb(ctx);
    const userId = _actor(ctx);
    if (!db || !userId) return { ok: false, reason: "auth_required" };
    const post = getPost(db, String(input.postId || ""));
    if (!post) return { ok: false, reason: "not_found" };
    // Sovereign Refusal Field gates (CLAUDE.md: death / harvest / hostility /
    // consequence / numbers / dome / win) — we ask the field whether this
    // post trips any active refusal. Graceful degrade if the engine isn't
    // present (test envs).
    try {
      const { isRefused } = await import("../lib/refusal-field.js");
      const hostility = isRefused?.(db, "hostility", { content: post.content }) || false;
      const harvest   = isRefused?.(db, "harvest",   { content: post.content }) || false;
      return { ok: true, refused: { hostility, harvest }, anyRefused: hostility || harvest };
    } catch {
      return { ok: true, refused: {}, anyRefused: false, reason: "refusal_field_unavailable" };
    }
  }, { note: "Check whether a post trips any active Sovereign Refusal Field kind" });
}
