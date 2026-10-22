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
  getExploreFeed,
  listSocialTrending,
  recipientResolvable,
  pinPost,
  unpinPost,
  getPinnedPosts,
  getProfile,
  recallMessage,
  createPost,
  getUserPosts,
} from "../emergent/social-layer.js";
import {
  editPost,
  saveDraft,
  listDrafts,
  deleteDraft,
  setSocialPreferences,
  findUserByUsername,
  acceptMessageRequest,
  declineMessageRequest,
  hideMessageForUser,
  listMessageRequests,
  groupNotifications,
  setUserMute,
  setUserBlock,
  reportSocialTarget,
} from "../lib/social-loop.js";
import {
  followingFeed,
  forYouFeed,
  feedbackPost,
  setFeedPreference,
  createList,
  addListMember,
  listFeed,
  getLists,
  createPack,
  joinPack,
  followHashtag,
  hashtagPosts,
  searchSocial,
} from "../lib/social-feeds.js";
import { shareListing, shareStudioAsset } from "../lib/social-share.js";

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

  // Override POST /api/social/post (server.js always 200s {ok:false} and
  // may stamp userId "anon"). Posting never consults brains or an LLM.
  router.post("/post", auth, (req, res) => {
    const userId = req.user?.id || req.actor?.userId || null;
    if (!userId || userId === "anon") {
      return res.status(401).json({ ok: false, error: "auth required" });
    }
    const STATE = stateOf();
    if (!STATE) return res.status(503).json({ ok: false, error: "state unavailable" });
    const body = req.body && typeof req.body === "object" ? req.body : {};
    const result = createPost(STATE, {
      userId,
      content: body.content ?? body.body,
      title: body.title,
      mediaType: body.mediaType,
      mediaUrl: body.mediaUrl,
      tags: body.tags,
      mentionedUsers: body.mentionedUsers,
      pollOptions: body.pollOptions,
      isStory: body.isStory,
      expiresAt: body.expiresAt,
      taggedProducts: body.taggedProducts,
      linkedDTUs: body.linkedDTUs,
      federationVisibility: body.federationVisibility,
      privacy: body.privacy,
      visibility: body.visibility,
      replyAudience: body.replyAudience,
      sensitive: body.sensitive,
    });
    return sendLayer(res, result);
  });

  router.get("/posts/user/:userId", (req, res) => {
    const STATE = stateOf();
    if (!STATE) return res.status(503).json({ ok: false, error: "state unavailable" });
    const viewerId = req.user?.id || req.actor?.userId || null;
    res.json(getUserPosts(STATE, req.params.userId, {
      limit: Number(req.query.limit || 30),
      offset: Number(req.query.offset || 0),
      viewerId,
    }));
  });

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
      grouped: groupNotifications(result.notifications),
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

  // Mounted ahead of the inline handlers in server.js. Explore must pass
  // the signed-in viewer into canViewPost (the inline handler omits it).
  router.get("/feed/explore", (req, res) => {
    const STATE = stateOf();
    const viewerId = req.user?.id || null;
    if (!STATE) return res.json({ ok: true, source: "social-explore", posts: [], total: 0 });
    const limit = Math.min(Math.max(Number(req.query.limit) || 30, 1), 100);
    const offset = Math.max(Number(req.query.offset) || 0, 0);
    const topic = typeof req.query.topic === "string" && req.query.topic ? req.query.topic : undefined;
    const result = getExploreFeed(STATE, { limit, offset, topic, viewerId });
    res.json({ ...result, source: "social-explore" });
  });

  // Social posts and hashtags ranked from engagement in the social store.
  // The inline handler calls computeTrending, which ranks published DTUs.
  router.get("/trending", (req, res) => {
    const STATE = stateOf();
    const viewerId = req.user?.id || null;
    if (!STATE) return res.json({ ok: true, source: "social-trending", posts: [], hashtags: [], trending: [] });
    const limit = Math.min(Math.max(Number(req.query.limit) || 20, 1), 100);
    res.json(listSocialTrending(STATE, { limit, viewerId }));
  });

  router.get("/topics/trending", (req, res) => {
    const STATE = stateOf();
    if (!STATE) return res.json({ ok: true, topics: [] });
    const limit = Math.min(Number(req.query.limit) || 10, 50);
    const result = getTrendingTopics(STATE, { limit, viewerId: req.user?.id || null });
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
    if (req.params.conversationId === "conversations" || req.params.conversationId === "requests") return next();
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

  router.post("/posts/:id/edit", auth, (req, res) => {
    const userId = req.user?.id;
    if (!userId) return res.status(401).json({ ok: false, error: "auth required" });
    const STATE = stateOf();
    if (!STATE) return res.status(503).json({ ok: false, error: "state unavailable" });
    sendLayer(res, editPost(STATE, { userId, postId: req.params.id, content: req.body?.content }));
  });

  router.get("/drafts", auth, (req, res) => {
    const userId = req.user?.id;
    if (!userId) return res.status(401).json({ ok: false, error: "auth required" });
    const STATE = stateOf();
    if (!STATE) return res.status(503).json({ ok: false, error: "state unavailable" });
    res.json(listDrafts(STATE, userId));
  });

  router.post("/drafts", auth, (req, res) => {
    const userId = req.user?.id;
    if (!userId) return res.status(401).json({ ok: false, error: "auth required" });
    const STATE = stateOf();
    if (!STATE) return res.status(503).json({ ok: false, error: "state unavailable" });
    sendLayer(res, saveDraft(STATE, { userId, draftId: req.body?.id, content: req.body?.content }));
  });

  router.delete("/drafts/:id", auth, (req, res) => {
    const userId = req.user?.id;
    if (!userId) return res.status(401).json({ ok: false, error: "auth required" });
    const STATE = stateOf();
    if (!STATE) return res.status(503).json({ ok: false, error: "state unavailable" });
    sendLayer(res, deleteDraft(STATE, { userId, draftId: req.params.id }));
  });

  router.post("/preferences", auth, (req, res) => {
    const userId = req.user?.id;
    if (!userId) return res.status(401).json({ ok: false, error: "auth required" });
    const STATE = stateOf();
    if (!STATE) return res.status(503).json({ ok: false, error: "state unavailable" });
    sendLayer(res, setSocialPreferences(STATE, userId, {
      dmPolicy: req.body?.dmPolicy,
      readReceipts: req.body?.readReceipts,
      interests: req.body?.interests,
      notificationTypes: req.body?.notificationTypes,
      keywordMutes: req.body?.keywordMutes,
      showSensitive: req.body?.showSensitive,
    }));
  });

  router.get("/users/by-username/:username", auth, (req, res) => {
    const STATE = stateOf();
    if (!STATE) return res.status(503).json({ ok: false, error: "state unavailable" });
    sendLayer(res, findUserByUsername(STATE, req.params.username, db || STATE.db));
  });

  router.get("/dm/requests", auth, (req, res) => {
    const userId = req.user?.id;
    if (!userId) return res.status(401).json({ ok: false, error: "auth required" });
    const STATE = stateOf();
    if (!STATE) return res.status(503).json({ ok: false, error: "state unavailable" });
    res.json(listMessageRequests(STATE, userId));
  });

  router.post("/dm/requests/accept", auth, (req, res) => {
    const userId = req.user?.id;
    if (!userId) return res.status(401).json({ ok: false, error: "auth required" });
    const STATE = stateOf();
    if (!STATE) return res.status(503).json({ ok: false, error: "state unavailable" });
    // eslint-disable-next-line no-restricted-syntax -- safe: target-identifier
    const fromUserId = req.body?.fromUserId;
    sendLayer(res, acceptMessageRequest(STATE, { userId, fromUserId }));
  });

  router.post("/dm/requests/decline", auth, (req, res) => {
    const userId = req.user?.id;
    if (!userId) return res.status(401).json({ ok: false, error: "auth required" });
    const STATE = stateOf();
    if (!STATE) return res.status(503).json({ ok: false, error: "state unavailable" });
    // eslint-disable-next-line no-restricted-syntax -- safe: target-identifier
    const fromUserId = req.body?.fromUserId;
    sendLayer(res, declineMessageRequest(STATE, { userId, fromUserId }));
  });

  router.post("/dm/hide", auth, (req, res) => {
    const userId = req.user?.id;
    if (!userId) return res.status(401).json({ ok: false, error: "auth required" });
    const STATE = stateOf();
    if (!STATE) return res.status(503).json({ ok: false, error: "state unavailable" });
    sendLayer(res, hideMessageForUser(STATE, { userId, messageId: req.body?.messageId }));
  });

  router.post("/dm/recall", auth, (req, res) => {
    const userId = req.user?.id;
    if (!userId) return res.status(401).json({ ok: false, error: "auth required" });
    const STATE = stateOf();
    if (!STATE) return res.status(503).json({ ok: false, error: "state unavailable" });
    sendLayer(res, recallMessage(STATE, { userId, messageId: req.body?.messageId }));
  });

  router.post("/posts/:id/pin", auth, (req, res) => {
    const userId = req.user?.id;
    if (!userId) return res.status(401).json({ ok: false, error: "auth required" });
    const STATE = stateOf();
    if (!STATE) return res.status(503).json({ ok: false, error: "state unavailable" });
    const result = req.body?.pinned === false
      ? unpinPost(STATE, { userId, postId: req.params.id })
      : pinPost(STATE, { userId, postId: req.params.id });
    sendLayer(res, result);
  });

  router.post("/people/:id/mute", auth, (req, res) => {
    const userId = req.user?.id;
    if (!userId) return res.status(401).json({ ok: false, error: "auth required" });
    const STATE = stateOf();
    if (!STATE) return res.status(503).json({ ok: false, error: "state unavailable" });
    sendLayer(res, setUserMute(STATE, { userId, targetId: req.params.id, muted: req.body?.muted }));
  });

  router.post("/people/:id/block", auth, (req, res) => {
    const userId = req.user?.id;
    if (!userId) return res.status(401).json({ ok: false, error: "auth required" });
    const STATE = stateOf();
    if (!STATE) return res.status(503).json({ ok: false, error: "state unavailable" });
    sendLayer(res, setUserBlock(STATE, { userId, targetId: req.params.id, blocked: req.body?.blocked }));
  });

  router.post("/people/:id/report", auth, (req, res) => {
    const userId = req.user?.id;
    if (!userId) return res.status(401).json({ ok: false, error: "auth required" });
    const STATE = stateOf();
    if (!STATE) return res.status(503).json({ ok: false, error: "state unavailable" });
    sendLayer(res, reportSocialTarget(STATE, {
      userId,
      targetId: req.params.id,
      targetType: "profile",
      reason: req.body?.reason,
    }));
  });

  router.get("/profile/:userId", auth, (req, res) => {
    const STATE = stateOf();
    if (!STATE) return res.status(503).json({ ok: false, error: "state unavailable" });
    sendLayer(res, getProfile(STATE, req.params.userId, req.user?.id || null));
  });

  router.get("/feed/following", auth, (req, res) => {
    const userId = req.user?.id;
    if (!userId) return res.status(401).json({ ok: false, error: "auth required" });
    const STATE = stateOf();
    if (!STATE) return res.status(503).json({ ok: false, error: "state unavailable" });
    res.json(followingFeed(STATE, userId, { limit: Number(req.query.limit || 30) }));
  });

  router.get("/feed/for-you", auth, (req, res) => {
    const userId = req.user?.id;
    if (!userId) return res.status(401).json({ ok: false, error: "auth required" });
    const STATE = stateOf();
    if (!STATE) return res.status(503).json({ ok: false, error: "state unavailable" });
    res.json(forYouFeed(STATE, userId, { limit: Number(req.query.limit || 30) }));
  });

  router.post("/feed/feedback", auth, (req, res) => {
    const userId = req.user?.id;
    if (!userId) return res.status(401).json({ ok: false, error: "auth required" });
    const STATE = stateOf();
    if (!STATE) return res.status(503).json({ ok: false, error: "state unavailable" });
    sendLayer(res, feedbackPost(STATE, userId, { postId: req.body?.postId, action: req.body?.action }));
  });

  router.post("/feed/preference", auth, (req, res) => {
    const userId = req.user?.id;
    if (!userId) return res.status(401).json({ ok: false, error: "auth required" });
    const STATE = stateOf();
    if (!STATE) return res.status(503).json({ ok: false, error: "state unavailable" });
    sendLayer(res, setFeedPreference(STATE, userId, req.body?.feedDefault));
  });

  router.get("/lists", auth, (req, res) => {
    const userId = req.user?.id;
    if (!userId) return res.status(401).json({ ok: false, error: "auth required" });
    const STATE = stateOf();
    if (!STATE) return res.status(503).json({ ok: false, error: "state unavailable" });
    sendLayer(res, getLists(STATE, userId));
  });

  router.post("/lists", auth, (req, res) => {
    const userId = req.user?.id;
    if (!userId) return res.status(401).json({ ok: false, error: "auth required" });
    const STATE = stateOf();
    if (!STATE) return res.status(503).json({ ok: false, error: "state unavailable" });
    sendLayer(res, createList(STATE, userId, req.body?.name));
  });

  router.post("/lists/:id/members", auth, (req, res) => {
    const userId = req.user?.id;
    if (!userId) return res.status(401).json({ ok: false, error: "auth required" });
    const STATE = stateOf();
    if (!STATE) return res.status(503).json({ ok: false, error: "state unavailable" });
    sendLayer(res, addListMember(STATE, userId, req.params.id, req.body?.memberId));
  });

  router.get("/lists/:id/feed", auth, (req, res) => {
    const userId = req.user?.id;
    if (!userId) return res.status(401).json({ ok: false, error: "auth required" });
    const STATE = stateOf();
    if (!STATE) return res.status(503).json({ ok: false, error: "state unavailable" });
    sendLayer(res, listFeed(STATE, userId, req.params.id));
  });

  router.post("/packs", auth, (req, res) => {
    const userId = req.user?.id;
    if (!userId) return res.status(401).json({ ok: false, error: "auth required" });
    const STATE = stateOf();
    if (!STATE) return res.status(503).json({ ok: false, error: "state unavailable" });
    sendLayer(res, createPack(STATE, userId, { name: req.body?.name, people: req.body?.people, feeds: req.body?.feeds }));
  });

  router.post("/packs/:id/join", auth, (req, res) => {
    const userId = req.user?.id;
    if (!userId) return res.status(401).json({ ok: false, error: "auth required" });
    const STATE = stateOf();
    if (!STATE) return res.status(503).json({ ok: false, error: "state unavailable" });
    // eslint-disable-next-line no-restricted-syntax -- safe: target-identifier
    const ownerId = req.body?.ownerId;
    sendLayer(res, joinPack(STATE, userId, req.params.id, ownerId));
  });

  router.post("/hashtags/:tag/follow", auth, (req, res) => {
    const userId = req.user?.id;
    if (!userId) return res.status(401).json({ ok: false, error: "auth required" });
    const STATE = stateOf();
    if (!STATE) return res.status(503).json({ ok: false, error: "state unavailable" });
    sendLayer(res, followHashtag(STATE, userId, req.params.tag, req.body?.follow !== false));
  });

  router.get("/hashtags/:tag", auth, (req, res) => {
    const userId = req.user?.id;
    if (!userId) return res.status(401).json({ ok: false, error: "auth required" });
    const STATE = stateOf();
    if (!STATE) return res.status(503).json({ ok: false, error: "state unavailable" });
    res.json(hashtagPosts(STATE, userId, req.params.tag));
  });

  router.get("/search", auth, (req, res) => {
    const userId = req.user?.id;
    if (!userId) return res.status(401).json({ ok: false, error: "auth required" });
    const STATE = stateOf();
    if (!STATE) return res.status(503).json({ ok: false, error: "state unavailable" });
    res.json(searchSocial(STATE, userId, req.query.q));
  });

  router.post("/listings/:listingId/share", auth, (req, res) => {
    const userId = req.user?.id;
    if (!userId) return res.status(401).json({ ok: false, error: "auth required" });
    const STATE = stateOf();
    if (!STATE) return res.status(503).json({ ok: false, error: "state unavailable" });
    sendLayer(res, shareListing(STATE, { userId, listingId: req.params.listingId, content: req.body?.content }));
  });

  router.post("/studio/share", auth, (req, res) => {
    const userId = req.user?.id;
    if (!userId) return res.status(401).json({ ok: false, error: "auth required" });
    const STATE = stateOf();
    if (!STATE) return res.status(503).json({ ok: false, error: "state unavailable" });
    sendLayer(res, shareStudioAsset(STATE, {
      userId,
      projectId: req.body?.projectId,
      assetId: req.body?.assetId,
      content: req.body?.content,
    }));
  });

  router.get("/pinned/:userId", auth, (req, res) => {
    const STATE = stateOf();
    if (!STATE) return res.status(503).json({ ok: false, error: "state unavailable" });
    const result = getPinnedPosts(STATE, req.params.userId, req.user?.id || null);
    sendLayer(res, result);
  });

  return router;
}
