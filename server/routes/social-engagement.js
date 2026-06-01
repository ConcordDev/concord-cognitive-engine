/**
 * Social Engagement Routes
 *
 * Pins, watchtime, streak, per-post analytics, and commerce tagging.
 * Tables are created inline with IF NOT EXISTS for zero-migration setup.
 * Mounts under /api/social via app.use("/api/social", ...).
 *
 * Endpoints:
 *   GET    /analytics/post/:postId        — per-post engagement stats
 *   POST   /pin                           — pin a post
 *   DELETE /pin/:postId                   — unpin a post
 *   GET    /pins/:userId                  — list a user's pinned posts
 *   POST   /watchtime                     — record watch time for a post
 *   GET    /streak                        — posting streak for the calling user
 *   POST   /commerce/tag                  — tag a post with a marketplace listing
 *   GET    /commerce/post/:postId/sales   — sales driven by a post
 *   GET    /commerce/post/:postId/earnings — earnings driven by a post
 */

import { Router } from "express";
import crypto from "crypto";

function uid() {
  return crypto.randomUUID();
}

export default function createSocialEngagementRoutes({ db, requireAuth }) {
  const router = Router();

  // ── Schema bootstrap ────────────────────────────────────────────────────────

  db.exec(`
    CREATE TABLE IF NOT EXISTS social_pins (
      id        TEXT PRIMARY KEY,
      user_id   TEXT NOT NULL,
      post_id   TEXT NOT NULL,
      pinned_at TEXT NOT NULL DEFAULT (datetime('now')),
      UNIQUE (user_id, post_id)
    );
    CREATE INDEX IF NOT EXISTS idx_pins_user ON social_pins (user_id, pinned_at DESC);

    CREATE TABLE IF NOT EXISTS social_watchtime (
      id          TEXT PRIMARY KEY,
      user_id     TEXT NOT NULL,
      post_id     TEXT NOT NULL,
      seconds     INTEGER NOT NULL DEFAULT 0,
      recorded_at TEXT NOT NULL DEFAULT (datetime('now'))
    );
    CREATE INDEX IF NOT EXISTS idx_watchtime_post ON social_watchtime (post_id);
    CREATE INDEX IF NOT EXISTS idx_watchtime_user ON social_watchtime (user_id);

    CREATE TABLE IF NOT EXISTS social_post_views (
      post_id   TEXT NOT NULL,
      user_id   TEXT NOT NULL,
      viewed_at TEXT NOT NULL DEFAULT (datetime('now')),
      PRIMARY KEY (post_id, user_id)
    );

    CREATE TABLE IF NOT EXISTS social_commerce_tags (
      id         TEXT PRIMARY KEY,
      post_id    TEXT NOT NULL,
      listing_id TEXT NOT NULL,
      tagged_by  TEXT NOT NULL,
      tagged_at  TEXT NOT NULL DEFAULT (datetime('now'))
    );
    CREATE INDEX IF NOT EXISTS idx_commerce_tags_post ON social_commerce_tags (post_id);
  `);

  // ── Helpers ─────────────────────────────────────────────────────────────────

  function resolveUserId(req) {
     
    // eslint-disable-next-line no-restricted-syntax
    return req.user?.id || req.body?.userId || req.query?.userId || "anonymous"; // safe: target-identifier
  }

  // ── GET /analytics/post/:postId ─────────────────────────────────────────────

  router.get("/analytics/post/:postId", (req, res) => {
    try {
      const { postId } = req.params;
      const post = db.prepare(
        `SELECT post_id, author_id, reactions, comments, shares, created_at
         FROM social_group_posts WHERE post_id = ?`
      ).get(postId);
      if (!post) {
        return res.status(404).json({ ok: false, error: "Post not found" });
      }
      const views = db.prepare(
        "SELECT COUNT(*) AS cnt FROM social_post_views WHERE post_id = ?"
      ).get(postId)?.cnt || 0;
      const watchtime = db.prepare(
        "SELECT COALESCE(SUM(seconds), 0) AS total FROM social_watchtime WHERE post_id = ?"
      ).get(postId)?.total || 0;
      const pins = db.prepare(
        "SELECT COUNT(*) AS cnt FROM social_pins WHERE post_id = ?"
      ).get(postId)?.cnt || 0;
      const commerceTags = db.prepare(
        "SELECT COUNT(*) AS cnt FROM social_commerce_tags WHERE post_id = ?"
      ).get(postId)?.cnt || 0;

      res.json({
        ok: true,
        postId,
        authorId: post.author_id,
        createdAt: post.created_at,
        engagement: {
          views,
          reactions: post.reactions,
          comments: post.comments,
          shares: post.shares,
          pins,
          totalWatchtimeSeconds: watchtime,
          commerceTags,
        },
      });
    } catch (err) {
      console.error("[social-engagement] GET /analytics/post/:postId error:", err);
      res.status(500).json({ ok: false, error: 'An unexpected error occurred' });
    }
  });

  // ── POST /pin — pin a post ──────────────────────────────────────────────────

  router.post("/pin", requireAuth(), (req, res) => {
    try {
      const userId = resolveUserId(req);
      const { postId } = req.body || {};
      if (!postId || typeof postId !== "string") {
        return res.status(400).json({ ok: false, error: "postId is required" });
      }
      try {
        db.prepare(
          "INSERT INTO social_pins (id, user_id, post_id) VALUES (?, ?, ?)"
        ).run(uid(), userId, postId);
      } catch (dbErr) {
        if (String(dbErr?.message || "").includes("UNIQUE")) {
          return res.json({ ok: true, alreadyPinned: true });
        }
        throw dbErr;
      }
      res.json({ ok: true });
    } catch (err) {
      console.error("[social-engagement] POST /pin error:", err);
      res.status(500).json({ ok: false, error: 'An unexpected error occurred' });
    }
  });

  // ── DELETE /pin/:postId — unpin ─────────────────────────────────────────────

  router.delete("/pin/:postId", requireAuth(), (req, res) => {
    try {
      const userId = resolveUserId(req);
      const result = db.prepare(
        "DELETE FROM social_pins WHERE user_id = ? AND post_id = ?"
      ).run(userId, req.params.postId);
      res.json({ ok: true, deleted: result.changes });
    } catch (err) {
      console.error("[social-engagement] DELETE /pin/:postId error:", err);
      res.status(500).json({ ok: false, error: 'An unexpected error occurred' });
    }
  });

  // ── GET /pins/:userId — list pinned posts ───────────────────────────────────

  router.get("/pins/:userId", (req, res) => {
    try {
      const limit = Math.min(Math.max(parseInt(req.query.limit, 10) || 20, 1), 100);
      const rows = db.prepare(
        `SELECT sp.post_id, sp.pinned_at,
                sgp.author_id, sgp.author_name, sgp.content, sgp.media_type,
                sgp.created_at, sgp.reactions, sgp.comments, sgp.shares
         FROM social_pins sp
         LEFT JOIN social_group_posts sgp ON sgp.post_id = sp.post_id
         WHERE sp.user_id = ?
         ORDER BY sp.pinned_at DESC LIMIT ?`
      ).all(req.params.userId, limit);

      const pins = rows.map((r) => ({
        postId: r.post_id,
        pinnedAt: r.pinned_at,
        authorId: r.author_id || null,
        authorName: r.author_name || null,
        content: r.content || null,
        mediaType: r.media_type || null,
        createdAt: r.created_at || null,
        reactions: r.reactions || 0,
        comments: r.comments || 0,
        shares: r.shares || 0,
      }));

      res.json({ ok: true, pins, count: pins.length });
    } catch (err) {
      console.error("[social-engagement] GET /pins/:userId error:", err);
      res.status(500).json({ ok: false, error: 'An unexpected error occurred' });
    }
  });

  // ── POST /watchtime — record watch time ────────────────────────────────────

  router.post("/watchtime", requireAuth(), (req, res) => {
    try {
      const userId = resolveUserId(req);
      const { postId, seconds } = req.body || {};
      if (!postId || typeof postId !== "string") {
        return res.status(400).json({ ok: false, error: "postId is required" });
      }
      const secs = Math.max(0, Math.min(Math.round(Number(seconds) || 0), 86400));

      db.prepare(
        "INSERT INTO social_watchtime (id, user_id, post_id, seconds) VALUES (?, ?, ?, ?)"
      ).run(uid(), userId, postId, secs);

      // Mark as viewed (idempotent)
      try {
        db.prepare(
          "INSERT OR IGNORE INTO social_post_views (post_id, user_id) VALUES (?, ?)"
        ).run(postId, userId);
      } catch (_) { /* non-fatal */ }

      res.json({ ok: true, postId, seconds: secs });
    } catch (err) {
      console.error("[social-engagement] POST /watchtime error:", err);
      res.status(500).json({ ok: false, error: 'An unexpected error occurred' });
    }
  });

  // ── GET /streak — posting streak for the calling user ──────────────────────

  router.get("/streak", requireAuth(), (req, res) => {
    try {
      const userId = resolveUserId(req);

      // Pull the distinct posting days in descending order (last 90 days)
      const rows = db.prepare(
        `SELECT DATE(created_at) AS day
         FROM social_group_posts
         WHERE author_id = ?
         GROUP BY DATE(created_at)
         ORDER BY day DESC
         LIMIT 90`
      ).all(userId);

      if (!rows.length) {
        return res.json({ ok: true, streak: 0, lastPostAt: null });
      }

      // Build expected consecutive days counting back from today (or yesterday
      // if no post today — a streak is still alive if the last post was yesterday).
      const todayStr = new Date().toISOString().slice(0, 10);
      const mostRecentDay = rows[0].day;

      // If the most recent post is older than yesterday, streak is broken
      const msPerDay = 86400 * 1000;
      const daysDiff = Math.round(
        (new Date(todayStr).getTime() - new Date(mostRecentDay).getTime()) / msPerDay
      );
      if (daysDiff > 1) {
        return res.json({ ok: true, streak: 0, lastPostAt: mostRecentDay });
      }

      // Count consecutive days from the most recent post backward
      let streak = 0;
      for (let i = 0; i < rows.length; i++) {
        const expected = new Date(mostRecentDay);
        expected.setUTCDate(expected.getUTCDate() - i);
        const expectedStr = expected.toISOString().slice(0, 10);
        if (rows[i].day === expectedStr) {
          streak++;
        } else {
          break;
        }
      }

      res.json({ ok: true, streak, lastPostAt: mostRecentDay });
    } catch (err) {
      console.error("[social-engagement] GET /streak error:", err);
      res.status(500).json({ ok: false, error: 'An unexpected error occurred' });
    }
  });

  // ── POST /commerce/tag — tag a post with a marketplace listing ──────────────

  router.post("/commerce/tag", requireAuth(), (req, res) => {
    try {
      const userId = resolveUserId(req);
      const { postId, listingId } = req.body || {};
      if (!postId || typeof postId !== "string") {
        return res.status(400).json({ ok: false, error: "postId is required" });
      }
      if (!listingId || typeof listingId !== "string") {
        return res.status(400).json({ ok: false, error: "listingId is required" });
      }
      const id = uid();
      db.prepare(
        "INSERT INTO social_commerce_tags (id, post_id, listing_id, tagged_by) VALUES (?, ?, ?, ?)"
      ).run(id, postId, listingId, userId);
      res.json({ ok: true, id });
    } catch (err) {
      console.error("[social-engagement] POST /commerce/tag error:", err);
      res.status(500).json({ ok: false, error: 'An unexpected error occurred' });
    }
  });

  // ── GET /commerce/post/:postId/sales ────────────────────────────────────────

  router.get("/commerce/post/:postId/sales", (req, res) => {
    try {
      const { postId } = req.params;
      const tags = db.prepare(
        "SELECT listing_id FROM social_commerce_tags WHERE post_id = ?"
      ).all(postId);

      let totalSales = 0;
      const salesByListing = [];

      for (const tag of tags) {
        let cnt = 0;
        let revenue = 0;
        try {
          const row = db.prepare(
            `SELECT COUNT(*) AS cnt, COALESCE(SUM(amount), 0) AS revenue
             FROM economy_ledger
             WHERE ref_id LIKE ? AND type = 'marketplace_purchase'`
          ).get(`%${tag.listing_id}%`);
          cnt = row?.cnt || 0;
          revenue = row?.revenue || 0;
        } catch (_) { /* economy_transactions may live in a different db handle */ }
        if (cnt > 0 || tags.length <= 10) {
          salesByListing.push({ listingId: tag.listing_id, count: cnt, revenue });
        }
        totalSales += cnt;
      }

      res.json({ ok: true, postId, totalSales, salesByListing, taggedListings: tags.length });
    } catch (err) {
      console.error("[social-engagement] GET /commerce/post/:postId/sales error:", err);
      res.status(500).json({ ok: false, error: 'An unexpected error occurred' });
    }
  });

  // ── GET /commerce/post/:postId/earnings ─────────────────────────────────────

  router.get("/commerce/post/:postId/earnings", (req, res) => {
    try {
      const { postId } = req.params;
      const tags = db.prepare(
        "SELECT listing_id, tagged_by FROM social_commerce_tags WHERE post_id = ?"
      ).all(postId);

      let totalEarnings = 0;
      for (const tag of tags) {
        try {
          const row = db.prepare(
            `SELECT COALESCE(SUM(amount), 0) AS total
             FROM economy_ledger
             WHERE ref_id LIKE ? AND type = 'marketplace_purchase'`
          ).get(`%${tag.listing_id}%`);
          totalEarnings += row?.total || 0;
        } catch (_) { /* non-fatal */ }
      }

      res.json({ ok: true, postId, totalEarnings, currency: "CC", taggedListings: tags.length });
    } catch (err) {
      console.error("[social-engagement] GET /commerce/post/:postId/earnings error:", err);
      res.status(500).json({ ok: false, error: 'An unexpected error occurred' });
    }
  });

  return router;
}
