/**
 * Social core routes mounted inside createSocialEngagementRoutes, which
 * itself is mounted at /api/social before the inline handlers in server.js.
 * Express matches in registration order, so these handlers win for the
 * same method and path.
 *
 * Paths outside /api/social cannot be overridden from here.
 */
import { Router } from "express";
import {
  getNotifications,
  getUnreadCount,
  markNotificationRead,
  markAllNotificationsRead,
  deleteNotification,
  addComment,
  followUser,
  sharePost,
  sendMessage,
  getMessages,
  citeAsOwner,
  getFollowingActivity,
  getCreatorAnalyticsView,
  getTrendingTopics,
  recipientResolvable,
} from "../emergent/social-layer.js";

function stateOf() {
  return globalThis._concordSTATE || null;
}

function asAuth(requireAuth) {
  if (typeof requireAuth !== "function") {
    return (_req, res) => res.status(401).json({ ok: false, error: "auth required" });
  }
  return requireAuth();
}

function presentNotification(note) {
  return {
    ...note,
    title: note.title || note.type || "Notification",
    message: note.message || note.content || "",
    actorId: note.actorId || note.fromUserId || null,
    targetId: note.targetId || note.postId || null,
  };
}

function sendLayer(res, result, okStatus = 200) {
  if (!result || result.ok === false) {
    const status = Number.isInteger(result?.status) ? result.status : 400;
    return res.status(status).json(result || { ok: false, error: "failed" });
  }
  return res.status(okStatus).json(result);
}

export default function createSocialCoreRoutes({ db, requireAuth }) {
  const router = Router();
  const auth = asAuth(requireAuth);

  router.get("/notifications", auth, (req, res) => {
    const userId = req.user?.id;
    if (!userId) return res.status(401).json({ ok: false, error: "auth required" });
    const STATE = stateOf();
    if (!STATE) return res.status(503).json({ ok: false, error: "state unavailable" });
    const limit = Math.min(Number(req.query.limit) || 50, 200);
    const unreadOnly = req.query.unreadOnly === "true";
    const result = getNotifications(STATE, userId, { limit, unreadOnly });
    res.json({
      ok: true,
      notifications: (result.notifications || []).map(presentNotification),
      total: result.total,
    });
  });

  router.get("/notifications/count", auth, (req, res) => {
    const userId = req.user?.id;
    if (!userId) return res.status(401).json({ ok: false, error: "auth required" });
    const STATE = stateOf();
    if (!STATE) return res.status(503).json({ ok: false, error: "state unavailable" });
    const result = getUnreadCount(STATE, userId);
    res.json({ ok: true, count: result.unreadCount, unreadCount: result.unreadCount });
  });

  router.post("/notifications/read-all", auth, (req, res) => {
    const userId = req.user?.id;
    if (!userId) return res.status(401).json({ ok: false, error: "auth required" });
    const STATE = stateOf();
    if (!STATE) return res.status(503).json({ ok: false, error: "state unavailable" });
    res.json(markAllNotificationsRead(STATE, userId));
  });

  router.post("/notifications/:id/read", auth, (req, res) => {
    const userId = req.user?.id;
    if (!userId) return res.status(401).json({ ok: false, error: "auth required" });
    const STATE = stateOf();
    if (!STATE) return res.status(503).json({ ok: false, error: "state unavailable" });
    const result = markNotificationRead(STATE, { userId, notificationId: req.params.id });
    if (!result.ok) return res.status(404).json(result);
    res.json(result);
  });

  router.delete("/notifications/:id", auth, (req, res) => {
    const userId = req.user?.id;
    if (!userId) return res.status(401).json({ ok: false, error: "auth required" });
    const STATE = stateOf();
    if (!STATE) return res.status(503).json({ ok: false, error: "state unavailable" });
    const result = deleteNotification(STATE, { userId, notificationId: req.params.id });
    if (!result.ok) return res.status(404).json(result);
    res.json(result);
  });

  router.get("/following-activity", auth, (req, res) => {
    const userId = req.user?.id;
    if (!userId) return res.status(401).json({ ok: false, error: "auth required" });
    const STATE = stateOf();
    if (!STATE) return res.status(503).json({ ok: false, error: "state unavailable" });
    const limit = Math.min(Number(req.query.limit) || 40, 100);
    const cursor = typeof req.query.cursor === "string" ? req.query.cursor : null;
    sendLayer(res, getFollowingActivity(STATE, userId, { limit, cursor }));
  });

  router.get("/analytics/creator", auth, (req, res) => {
    const userId = req.user?.id;
    if (!userId) return res.status(401).json({ ok: false, error: "auth required" });
    const STATE = stateOf();
    if (!STATE) return res.status(503).json({ ok: false, error: "state unavailable" });
    res.json(getCreatorAnalyticsView(STATE, userId));
  });

  router.get("/topics/trending", (req, res) => {
    const STATE = stateOf();
    if (!STATE) return res.json({ ok: true, topics: [] });
    const limit = Math.min(Number(req.query.limit) || 10, 50);
    const result = getTrendingTopics(STATE, { limit });
    const topics = (result.topics || []).map((row) => ({
      tag: row.topic,
      topic: row.topic,
      count: row.count,
    }));
    res.json({ ok: true, topics });
  });

  router.post("/follow", auth, (req, res) => {
    const userId = req.user?.id;
    if (!userId) return res.status(401).json({ ok: false, error: "auth required" });
    const STATE = stateOf();
    if (!STATE) return res.status(503).json({ ok: false, error: "state unavailable" });
    sendLayer(res, followUser(STATE, userId, req.body?.followedId));
  });

  router.post("/comment", auth, (req, res) => {
    const userId = req.user?.id;
    if (!userId) return res.status(401).json({ ok: false, error: "auth required" });
    const STATE = stateOf();
    if (!STATE) return res.status(503).json({ ok: false, error: "state unavailable" });
    sendLayer(res, addComment(STATE, {
      userId,
      postId: req.body?.postId,
      content: req.body?.content,
      parentCommentId: req.body?.parentCommentId,
      mentionedUsers: req.body?.mentionedUsers,
    }));
  });

  router.post("/share", auth, (req, res) => {
    const userId = req.user?.id;
    if (!userId) return res.status(401).json({ ok: false, error: "auth required" });
    const STATE = stateOf();
    if (!STATE) return res.status(503).json({ ok: false, error: "state unavailable" });
    sendLayer(res, sharePost(STATE, {
      userId,
      postId: req.body?.postId,
      commentary: req.body?.commentary,
    }));
  });

  router.post("/dm", auth, (req, res) => {
    const fromUserId = req.user?.id;
    if (!fromUserId) return res.status(401).json({ ok: false, error: "auth required" });
    const STATE = stateOf();
    if (!STATE) return res.status(503).json({ ok: false, error: "state unavailable" });
    // eslint-disable-next-line no-restricted-syntax -- safe: target-identifier
    const toUserId = req.body?.toUserId;
    if (!recipientResolvable(STATE, toUserId, db || STATE.db)) {
      return res.status(404).json({ ok: false, error: "recipient not found" });
    }
    sendLayer(res, sendMessage(STATE, {
      fromUserId,
      toUserId,
      content: req.body?.content,
      mediaUrl: req.body?.mediaUrl,
    }));
  });

  router.get("/dm/:conversationId", auth, (req, res, next) => {
    if (req.params.conversationId === "conversations") return next();
    const userId = req.user?.id;
    if (!userId) return res.status(401).json({ ok: false, error: "auth required" });
    const STATE = stateOf();
    if (!STATE) return res.status(503).json({ ok: false, error: "state unavailable" });
    sendLayer(res, getMessages(STATE, req.params.conversationId, {
      limit: Number(req.query.limit || 50),
      offset: Number(req.query.offset || 0),
      userId,
    }));
  });

  router.post("/cite", auth, (req, res) => {
    const userId = req.user?.id;
    if (!userId) return res.status(401).json({ ok: false, error: "auth required" });
    const STATE = stateOf();
    if (!STATE) return res.status(503).json({ ok: false, error: "state unavailable" });
    sendLayer(res, citeAsOwner(STATE, {
      userId,
      citedDtuId: req.body?.citedDtuId,
      citingDtuId: req.body?.citingDtuId,
    }));
  });

  return router;
}
