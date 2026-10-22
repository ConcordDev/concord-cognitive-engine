/**
 * Phase 3 interaction helpers on the canonical social store.
 * Drafts live in STATE._social.drafts and in social_drafts (migration 483).
 * DM policy, read receipts and interests live on the profile object, which
 * the phase 2 snapshot already writes.
 */
import { canonicalSocial, createPost, addComment, sendMessage, getNotifications } from "../emergent/social-layer.js";
import { scheduleSocialFlush } from "./social-persist.js";
import { submitReport } from "./content-moderation.js";

const EDIT_WINDOW_MS = 15 * 60 * 1000;

export function editPost(STATE, { userId, postId, content }) {
  const social = canonicalSocial(STATE);
  const post = social.posts.get(postId);
  if (!post) return { ok: false, status: 404, error: "Post not found" };
  if (post.userId !== userId) return { ok: false, status: 403, error: "Only the author can edit" };
  const created = Date.parse(post.createdAt);
  if (!Number.isFinite(created) || Date.now() - created > EDIT_WINDOW_MS) {
    return { ok: false, status: 403, error: "edit window closed" };
  }
  const next = String(content || "").trim();
  if (!next) return { ok: false, status: 400, error: "content required" };
  if (!Array.isArray(post.editHistory)) post.editHistory = [];
  post.editHistory.push({ content: post.content || post.body || "", at: new Date().toISOString() });
  post.content = next;
  post.body = next;
  post.editedAt = new Date().toISOString();
  scheduleSocialFlush(STATE);
  return { ok: true, post: { id: post.id, content: post.content, editedAt: post.editedAt, editHistory: post.editHistory } };
}

export function saveDraft(STATE, { userId, draftId, content }) {
  if (!userId) return { ok: false, status: 401, error: "auth required" };
  const text = String(content || "").trim();
  if (!text) return { ok: false, status: 400, error: "content required" };
  const social = canonicalSocial(STATE);
  const id = draftId || `draft_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
  const existing = social.drafts.get(id);
  if (existing && existing.userId !== userId) return { ok: false, status: 403, error: "not your draft" };
  const draft = {
    id,
    userId,
    content: text,
    createdAt: existing?.createdAt || new Date().toISOString(),
    updatedAt: new Date().toISOString(),
  };
  social.drafts.set(id, draft);
  scheduleSocialFlush(STATE);
  return { ok: true, draft };
}

export function listDrafts(STATE, userId) {
  const social = canonicalSocial(STATE);
  const drafts = [...social.drafts.values()].filter((d) => d.userId === userId);
  drafts.sort((a, b) => String(b.updatedAt).localeCompare(String(a.updatedAt)));
  return { ok: true, drafts };
}

export function deleteDraft(STATE, { userId, draftId }) {
  const social = canonicalSocial(STATE);
  const draft = social.drafts.get(draftId);
  if (!draft || draft.userId !== userId) return { ok: false, status: 404, error: "draft not found" };
  social.drafts.delete(draftId);
  scheduleSocialFlush(STATE);
  return { ok: true, id: draftId };
}

export function setSocialPreferences(STATE, userId, prefs = {}) {
  const { dmPolicy, readReceipts, interests } = prefs;
  const social = canonicalSocial(STATE);
  const profile = social.profiles.get(userId);
  if (!profile) return { ok: false, status: 404, error: "Create a profile first" };
  if (dmPolicy != null) {
    if (!["everyone", "followers", "nobody"].includes(dmPolicy)) {
      return { ok: false, status: 400, error: "dmPolicy must be everyone, followers, or nobody" };
    }
    profile.dmPolicy = dmPolicy;
  }
  if (typeof readReceipts === "boolean") profile.readReceipts = readReceipts;
  if (prefs && typeof prefs.notificationTypes === "object" && prefs.notificationTypes) {
    const allowed = ["comment", "mention", "share", "repost", "dm", "message_request", "like", "follow"];
    const next = { ...(profile.notificationTypes || {}) };
    for (const key of allowed) {
      if (typeof prefs.notificationTypes[key] === "boolean") next[key] = prefs.notificationTypes[key];
    }
    profile.notificationTypes = next;
  }
  if (Array.isArray(interests)) {
    profile.interests = [...new Set(interests.map((t) => String(t).replace(/^#/, "").trim().toLowerCase()).filter(Boolean))].slice(0, 20);
  }
  scheduleSocialFlush(STATE);
  return {
    ok: true,
    dmPolicy: profile.dmPolicy || "everyone",
    readReceipts: profile.readReceipts !== false,
    interests: profile.interests || [],
    notificationTypes: profile.notificationTypes || {},
  };
}

export function findUserByUsername(STATE, username, db) {
  const name = String(username || "").trim().toLowerCase();
  if (name.length < 2) return { ok: false, status: 400, error: "username required" };
  const database = db || STATE?.db;
  if (database && typeof database.prepare === "function") {
    try {
      const row = database.prepare("SELECT id, username FROM users WHERE lower(username) = ? AND is_active = 1").get(name);
      if (row) return { ok: true, user: { id: row.id, username: row.username } };
    } catch { /* users table missing */ }
  }
  const social = canonicalSocial(STATE);
  for (const profile of social.profiles.values()) {
    const handle = String(profile.username || profile.displayName || "").toLowerCase();
    if (handle === name) return { ok: true, user: { id: profile.userId, username: profile.displayName || profile.userId } };
  }
  return { ok: false, status: 404, error: "user not found" };
}

export function acceptMessageRequest(STATE, { userId, fromUserId }) {
  const social = canonicalSocial(STATE);
  let changed = 0;
  for (const msgs of social.messages.values()) {
    for (const m of msgs) {
      if (m.toUserId === userId && m.fromUserId === fromUserId && m.requestStatus === "pending") {
        m.requestStatus = "accepted";
        changed++;
      }
    }
  }
  if (!changed) return { ok: false, status: 404, error: "no request" };
  scheduleSocialFlush(STATE);
  return { ok: true, accepted: changed };
}

export function declineMessageRequest(STATE, { userId, fromUserId }) {
  const social = canonicalSocial(STATE);
  let changed = 0;
  for (const msgs of social.messages.values()) {
    for (const m of msgs) {
      if (m.toUserId === userId && m.fromUserId === fromUserId && m.requestStatus === "pending") {
        m.requestStatus = "declined";
        changed++;
      }
    }
  }
  if (!changed) return { ok: false, status: 404, error: "no request" };
  scheduleSocialFlush(STATE);
  return { ok: true, declined: changed };
}

export function hideMessageForUser(STATE, { userId, messageId }) {
  if (!userId || !messageId) return { ok: false, status: 400, error: "messageId required" };
  const social = canonicalSocial(STATE);
  for (const [convId, msgs] of social.messages) {
    const msg = msgs.find((m) => m.id === messageId);
    if (!msg) continue;
    const parts = String(convId).split(":");
    if (!parts.includes(userId)) return { ok: false, status: 404, error: "not a participant" };
    if (!(msg.hiddenFor instanceof Set)) msg.hiddenFor = new Set();
    msg.hiddenFor.add(userId);
    scheduleSocialFlush(STATE);
    return { ok: true, messageId };
  }
  return { ok: false, status: 404, error: "not found" };
}

export function listMessageRequests(STATE, userId) {
  const social = canonicalSocial(STATE);
  const requests = [];
  for (const [conversationId, msgs] of social.messages) {
    for (const m of msgs) {
      if (m.toUserId === userId && m.requestStatus === "pending") {
        requests.push({ id: m.id, conversationId, fromUserId: m.fromUserId, createdAt: m.createdAt });
      }
    }
  }
  return { ok: true, requests };
}

export function groupNotifications(notes) {
  const groups = new Map();
  for (const note of notes || []) {
    const key = `${note.type || "general"}:${note.postId || note.targetId || ""}`;
    if (!groups.has(key)) groups.set(key, { type: note.type, postId: note.postId || null, actors: [], count: 0 });
    const group = groups.get(key);
    group.count += 1;
    const actor = note.fromUserId || note.actorId;
    if (actor && !group.actors.includes(actor)) group.actors.push(actor);
  }
  return [...groups.values()].map((group) => {
    const verbs = {
      comment: "commented",
      mention: "mentioned you",
      share: "shared",
      repost: "reposted",
      dm: "messaged",
      message_request: "requested a message",
      like: "liked",
      follow: "followed",
    };
    const first = group.actors[0] || "Someone";
    const others = group.count - 1;
    const verb = verbs[group.type] || group.type || "notified";
    const summary = others > 0 ? `${first} and ${others} ${others === 1 ? "other" : "others"} ${verb}` : `${first} ${verb}`;
    return { ...group, summary };
  });
}

function moderationBucket(STATE, userId) {
  if (!STATE.socialLens) STATE.socialLens = {};
  if (!(STATE.socialLens.moderation instanceof Map)) STATE.socialLens.moderation = new Map();
  if (!STATE.socialLens.moderation.has(userId)) {
    STATE.socialLens.moderation.set(userId, { muted: new Set(), blocked: new Set() });
  }
  const bucket = STATE.socialLens.moderation.get(userId);
  if (!(bucket.muted instanceof Set)) bucket.muted = new Set(bucket.muted || []);
  if (!(bucket.blocked instanceof Set)) bucket.blocked = new Set(bucket.blocked || []);
  return bucket;
}

export function setUserMute(STATE, { userId, targetId, muted }) {
  if (!userId || !targetId || userId === targetId) return { ok: false, status: 400, error: "invalid target" };
  const bucket = moderationBucket(STATE, userId);
  const on = muted != null ? !!muted : !bucket.muted.has(targetId);
  if (on) bucket.muted.add(targetId); else bucket.muted.delete(targetId);
  scheduleSocialFlush(STATE);
  return { ok: true, userId: targetId, muted: on };
}

export function setUserBlock(STATE, { userId, targetId, blocked }) {
  if (!userId || !targetId || userId === targetId) return { ok: false, status: 400, error: "invalid target" };
  const bucket = moderationBucket(STATE, userId);
  const on = blocked != null ? !!blocked : !bucket.blocked.has(targetId);
  if (on) bucket.blocked.add(targetId); else bucket.blocked.delete(targetId);
  scheduleSocialFlush(STATE);
  return { ok: true, userId: targetId, blocked: on };
}

export function reportSocialTarget(STATE, { userId, targetId, targetType, reason }) {
  if (!userId || !targetId) return { ok: false, status: 400, error: "target required" };
  const reasons = ["spam", "harassment", "misinformation", "hate", "violence", "other"];
  const picked = reasons.includes(reason) ? reason : "other";
  const category = picked === "hate" ? "hate_speech" : picked;
  const filed = submitReport(STATE, {
    reporterId: userId,
    contentId: targetId,
    contentType: targetType === "post" ? "post" : "profile",
    category,
    reason: `social report: ${picked}`,
  });
  if (!filed.ok) return { ok: false, status: 400, error: filed.error || "report failed" };
  return { ok: true, reportId: filed.report?.id || null };
}

export function runInteractionLoop(STATE, { ana, bea, text }) {
  const post = createPost(STATE, { userId: ana, content: text, mentionedUsers: [bea] });
  const reply = addComment(STATE, { userId: bea, postId: post.post?.id, content: "reply", audience: "everyone" });
  const dm = sendMessage(STATE, { fromUserId: bea, toUserId: ana, content: "dm" });
  const notes = getNotifications(STATE, ana);
  return { post, reply, dm, notes };
}
