// server/routes/social-extended.js
//
// Extended social endpoints — wires social-layer.js exports that were
// never routed despite being implemented. Pre-this-file these features
// existed only as exports nothing imported:
//   - trending (topics / domains / content / creators)
//   - pinning (pin / unpin / list pinned)
//   - scheduling (schedule / cancel / list / process)
//   - streaks (get / update)
//   - analytics (creator / post / earnings / sales)
//   - watch time
//   - listing tagging
//
// All routes mount under /api/social-extended. Auth-gated where the
// action mutates user state; trending and per-post analytics are public
// reads.

import { Router } from "express";
import {
  getTrendingTopics,
  getTrendingDomains,
  getTrendingContent,
  getTrendingCreators,
  pinPost,
  unpinPost,
  getPinnedPosts,
  schedulePost,
  cancelScheduledPost,
  getScheduledPosts,
  getStreak,
  updateStreak,
  getCreatorAnalytics,
  getPostAnalytics,
  getPostEarnings,
  getPostSales,
  recordWatchTime,
  tagListing,
} from "../emergent/social-layer.js";

export default function createSocialExtendedRouter({ STATE, requireAuth }) {
  const router = Router();
  const auth = typeof requireAuth === "function" && requireAuth.length === 0 ? requireAuth() : requireAuth;

  // ─── Trending ──────────────────────────────────────────────────────────────
  router.get("/trending/topics", (req, res) => {
    const limit = Math.min(Math.max(parseInt(req.query.limit, 10) || 20, 1), 100);
    res.json({ ok: true, ...getTrendingTopics(STATE, { limit }) });
  });

  router.get("/trending/domains", (req, res) => {
    const limit = Math.min(Math.max(parseInt(req.query.limit, 10) || 10, 1), 100);
    res.json({ ok: true, ...getTrendingDomains(STATE, { limit }) });
  });

  router.get("/trending/content", (req, res) => {
    const limit = Math.min(Math.max(parseInt(req.query.limit, 10) || 20, 1), 100);
    const hours = Math.min(Math.max(parseInt(req.query.hours, 10) || 24, 1), 168);
    res.json({ ok: true, ...getTrendingContent(STATE, { limit, hours }) });
  });

  router.get("/trending/creators", (req, res) => {
    const limit = Math.min(Math.max(parseInt(req.query.limit, 10) || 20, 1), 100);
    const days = Math.min(Math.max(parseInt(req.query.days, 10) || 7, 1), 30);
    res.json({ ok: true, ...getTrendingCreators(STATE, { limit, days }) });
  });

  // ─── Pinning ───────────────────────────────────────────────────────────────
  router.post("/pin", auth, (req, res) => {
    const userId = req.user?.id;
    const { postId } = req.body || {};
    if (!userId || !postId) return res.status(400).json({ ok: false, error: "userId+postId required" });
    res.json({ ok: true, ...pinPost(STATE, { userId, postId }) });
  });

  router.post("/unpin", auth, (req, res) => {
    const userId = req.user?.id;
    const { postId } = req.body || {};
    if (!userId || !postId) return res.status(400).json({ ok: false, error: "userId+postId required" });
    res.json({ ok: true, ...unpinPost(STATE, { userId, postId }) });
  });

  router.get("/pinned/:userId", (req, res) => {
    res.json({ ok: true, ...getPinnedPosts(STATE, req.params.userId) });
  });

  // ─── Scheduling ────────────────────────────────────────────────────────────
  router.post("/schedule", auth, (req, res) => {
    const userId = req.user?.id;
    const { postData, scheduledAt } = req.body || {};
    if (!userId || !postData || !scheduledAt) {
      return res.status(400).json({ ok: false, error: "postData+scheduledAt required" });
    }
    res.json({ ok: true, ...schedulePost(STATE, { userId, postData, scheduledAt }) });
  });

  router.delete("/schedule/:postId", auth, (req, res) => {
    const userId = req.user?.id;
    if (!userId) return res.status(401).json({ ok: false, error: "auth required" });
    res.json({ ok: true, ...cancelScheduledPost(STATE, { userId, postId: req.params.postId }) });
  });

  router.get("/schedule/mine", auth, (req, res) => {
    const userId = req.user?.id;
    if (!userId) return res.status(401).json({ ok: false, error: "auth required" });
    res.json({ ok: true, ...getScheduledPosts(STATE, userId) });
  });

  // ─── Streaks ───────────────────────────────────────────────────────────────
  router.get("/streak/:userId", (req, res) => {
    res.json({ ok: true, ...getStreak(STATE, req.params.userId) });
  });

  router.post("/streak/touch", auth, (req, res) => {
    const userId = req.user?.id;
    if (!userId) return res.status(401).json({ ok: false, error: "auth required" });
    res.json({ ok: true, ...updateStreak(STATE, userId) });
  });

  // ─── Analytics ─────────────────────────────────────────────────────────────
  router.get("/analytics/creator/:userId", (req, res) => {
    res.json({ ok: true, ...getCreatorAnalytics(STATE, req.params.userId) });
  });

  router.get("/analytics/post/:postId", (req, res) => {
    res.json({ ok: true, ...getPostAnalytics(STATE, req.params.postId) });
  });

  router.get("/analytics/post/:postId/earnings", (req, res) => {
    res.json({ ok: true, ...getPostEarnings(STATE, req.params.postId) });
  });

  router.get("/analytics/post/:postId/sales", (req, res) => {
    res.json({ ok: true, ...getPostSales(STATE, req.params.postId) });
  });

  // ─── Watch time ────────────────────────────────────────────────────────────
  router.post("/watch-time", auth, (req, res) => {
    const userId = req.user?.id;
    const { postId, durationMs } = req.body || {};
    if (!userId || !postId || !Number.isFinite(durationMs)) {
      return res.status(400).json({ ok: false, error: "userId+postId+durationMs required" });
    }
    res.json({ ok: true, ...recordWatchTime(STATE, { userId, postId, durationMs }) });
  });

  // ─── Listing tagging ───────────────────────────────────────────────────────
  router.post("/tag-listing", auth, (req, res) => {
    const { postId, listingId } = req.body || {};
    if (!postId || !listingId) return res.status(400).json({ ok: false, error: "postId+listingId required" });
    res.json({ ok: true, ...tagListing(STATE, { postId, listingId }) });
  });

  return router;
}
