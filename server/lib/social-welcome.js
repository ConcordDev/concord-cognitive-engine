/**
 * Welcome-pass helpers for the social lens (job oc-social-3b).
 *
 * Every value here is computed from the canonical social store and the real
 * studio tables — no fabricated suggestions, no invented activity:
 *   - peopleToFollow: creators with recent PUBLIC posts and/or recent
 *     finished Studio projects. Excludes the viewer, accounts the viewer
 *     already follows, blocked users (either direction) and muted users.
 *     An empty result stays empty — callers hide the row rather than
 *     fake it.
 *   - welcomeState / dismissWelcome: the first-run checklist's real
 *     completion state (avatar, bio, first post) plus a dismissal flag
 *     persisted on the social profile (payload_json survives restarts).
 *   - discoverForViewer: the legacy discoverUsers shape, minus blocked and
 *     muted users, falling back to active creators when the viewer has no
 *     interest signal (a brand-new account with no DTUs).
 */
import {
  canonicalSocial,
  canViewPost,
  isBlocked,
  discoverUsers,
} from "../emergent/social-layer.js";
import { lookupUserIdentity } from "./user-identity.js";
import { scheduleSocialFlush } from "./social-persist.js";

const ACTIVITY_WINDOW_DAYS = 30;
const MAX_SUGGESTED = 12;

function viewerMutedIds(STATE, viewerId) {
  const mod = STATE?.socialLens?.moderation;
  if (!mod || !viewerId) return new Set();
  const bucket = mod instanceof Map ? mod.get(viewerId) : mod[viewerId];
  const muted = bucket?.muted;
  if (muted instanceof Set) return muted;
  if (Array.isArray(muted)) return new Set(muted);
  return new Set();
}

function isMutedBy(STATE, viewerId, authorId) {
  if (!viewerId || !authorId) return false;
  return viewerMutedIds(STATE, viewerId).has(authorId);
}

/** datetime('now') format ('YYYY-MM-DD HH:MM:SS') for SQL comparisons. */
function sqlNowMinusDays(days) {
  return new Date(Date.now() - days * 86400000).toISOString().slice(0, 19).replace("T", " ");
}

function audienceOf(post) {
  return (post && post.privacy) || "public";
}

/**
 * Recent finished Studio work per creator over the activity window. Reads
 * the tables the studio router owns (route_studio_projects) and degrades
 * to "none" when they are absent — a missing table is no reason to invent
 * releases. Only status 'complete' projects count as finished work;
 * drafts and works-in-progress are not releases.
 */
function studioActivityByCreator(db, cutoffSql) {
  const out = new Map();
  if (!db || typeof db.prepare !== "function") return out;
  try {
    const rows = db
      .prepare(
        `SELECT created_by AS creator, COUNT(*) AS releases, MAX(updated_at) AS lastAt
         FROM route_studio_projects
         WHERE updated_at >= ? AND status = 'complete'
         GROUP BY created_by`,
      )
      .all(cutoffSql);
    for (const row of rows || []) {
      if (!row?.creator) continue;
      out.set(String(row.creator), {
        studioReleaseCount: Number(row.releases) || 0,
        lastActiveAt: row.lastAt || null,
      });
    }
  } catch {
    /* studio tables not present on this deployment */
  }
  return out;
}

/**
 * Real active creators for the "People to follow" row.
 *
 * A candidate qualifies only with recent activity: at least one PUBLIC post
 * inside the window (followers-only/private posts never qualify a creator —
 * the same bar Explore is held to) and/or at least one finished studio
 * project updated inside the window. Excluded: the viewer, people the viewer
 * follows, blocked users (either direction), muted users, and accounts
 * with no resolvable name (a social profile or a users row).
 */
export function peopleToFollow(STATE, { viewerId, limit = 8 } = {}) {
  if (!viewerId) return { ok: false, status: 401, error: "auth required" };
  const social = canonicalSocial(STATE);
  const followed = social.follows.get(viewerId) || new Set();
  const cutoffMs = Date.now() - ACTIVITY_WINDOW_DAYS * 86400000;

  const postsByAuthor = new Map();
  const now = Date.now();
  for (const post of social.posts.values()) {
    if (!post?.userId || post.userId === viewerId) continue;
    if (post.expiresAt && Date.parse(post.expiresAt) < now) continue;
    if (audienceOf(post) !== "public") continue;
    if (!canViewPost(viewerId, post, STATE)) continue;
    const created = Date.parse(post.createdAt || "");
    if (!Number.isFinite(created) || created < cutoffMs) continue;
    const bucket = postsByAuthor.get(post.userId) || { recentPostCount: 0, lastActiveAt: null };
    bucket.recentPostCount += 1;
    if (!bucket.lastActiveAt || String(post.createdAt) > bucket.lastActiveAt) {
      bucket.lastActiveAt = String(post.createdAt);
    }
    postsByAuthor.set(post.userId, bucket);
  }

  const studioByCreator = studioActivityByCreator(STATE?.db, sqlNowMinusDays(ACTIVITY_WINDOW_DAYS));

  const candidates = new Map();
  for (const [authorId, activity] of postsByAuthor) {
    candidates.set(authorId, { ...activity, studioReleaseCount: 0 });
  }
  for (const [creatorId, studio] of studioByCreator) {
    if (creatorId === viewerId) continue;
    const merged = candidates.get(creatorId) || { recentPostCount: 0, lastActiveAt: null };
    merged.studioReleaseCount = studio.studioReleaseCount;
    if (!merged.lastActiveAt || String(studio.lastActiveAt) > merged.lastActiveAt) {
      merged.lastActiveAt = studio.lastActiveAt;
    }
    candidates.set(creatorId, merged);
  }

  const ranked = [];
  for (const [authorId, activity] of candidates) {
    if (authorId === viewerId || followed.has(authorId)) continue;
    if (isBlocked(STATE, viewerId, authorId)) continue;
    if (isMutedBy(STATE, viewerId, authorId)) continue;
    const profile = social.profiles.get(authorId) || null;
    const identity = lookupUserIdentity(STATE?.db, authorId) || {};
    const displayName = profile?.displayName
      || identity.displayName
      || identity.username
      || null;
    if (!displayName) continue; // no honest name to render — skip
    ranked.push({
      userId: authorId,
      displayName,
      username: identity.username || null,
      avatar: profile?.avatar || null,
      bio: profile?.bio || null,
      followerCount: profile?.stats?.followerCount || 0,
      recentPostCount: activity.recentPostCount,
      studioReleaseCount: activity.studioReleaseCount,
      lastActiveAt: activity.lastActiveAt,
    });
  }

  ranked.sort((a, b) => {
    const activityA = a.recentPostCount * 2 + a.studioReleaseCount;
    const activityB = b.recentPostCount * 2 + b.studioReleaseCount;
    if (activityB !== activityA) return activityB - activityA;
    if (b.followerCount !== a.followerCount) return b.followerCount - a.followerCount;
    return String(b.lastActiveAt || "").localeCompare(String(a.lastActiveAt || ""));
  });

  return { ok: true, people: ranked.slice(0, Math.max(1, Math.min(Number(limit) || 8, MAX_SUGGESTED))) };
}

/**
 * Real completion state for the first-run checklist. Derived from the
 * caller's own profile and posts — there is no way to read another user's
 * state through this function (the route has no user param).
 */
export function welcomeState(STATE, userId) {
  if (!userId) return { ok: false, status: 401, error: "auth required" };
  const social = canonicalSocial(STATE);
  const profile = social.profiles.get(userId) || null;
  let hasFirstPost = false;
  for (const post of social.posts.values()) {
    if (post?.userId === userId) { hasFirstPost = true; break; }
  }
  return {
    ok: true,
    hasAvatar: typeof profile?.avatar === "string" && profile.avatar.trim().length > 0,
    hasBio: typeof profile?.bio === "string" && profile.bio.trim().length > 0,
    hasFirstPost,
    dismissed: profile?.welcomeDismissed === true,
  };
}

/** Persist the dismissal on the social profile (survives restarts via payload_json). */
export function dismissWelcome(STATE, userId) {
  if (!userId) return { ok: false, status: 401, error: "auth required" };
  const social = canonicalSocial(STATE);
  const profile = social.profiles.get(userId);
  if (!profile) return { ok: false, status: 404, error: "Create a profile first" };
  profile.welcomeDismissed = true;
  profile.updatedAt = new Date().toISOString();
  scheduleSocialFlush(STATE);
  return { ok: true, dismissed: true };
}

/**
 * discoverUsers minus blocked and muted users (either direction), falling
 * back to active creators when the viewer has no interest signal (new
 * accounts, no DTUs). Response shape matches the legacy /discover
 * endpoint so both existing consumers keep working.
 */
export function discoverForViewer(STATE, viewerId, { limit = 10 } = {}) {
  if (!viewerId) return { ok: false, status: 401, error: "auth required" };
  const base = discoverUsers(STATE, viewerId, limit);
  const social = canonicalSocial(STATE);
  const suggestions = (base.suggestions || [])
    .filter((s) => !isBlocked(STATE, viewerId, s.userId))
    .filter((s) => !isMutedBy(STATE, viewerId, s.userId))
    .map((s) => {
      const profile = social.profiles.get(s.userId) || null;
      const identity = lookupUserIdentity(STATE?.db, s.userId) || {};
      return {
        ...s,
        username: s.username || identity.username || null,
        avatarUrl: profile?.avatar || undefined,
      };
    });
  if (suggestions.length > 0) return { ok: true, suggestions };

  // No interest signal — surface real active creators instead of nothing.
  const active = peopleToFollow(STATE, { viewerId, limit });
  return {
    ok: true,
    suggestions: (active.people || []).map((p) => ({
      userId: p.userId,
      displayName: p.displayName,
      username: p.username,
      bio: p.bio || "",
      followerCount: p.followerCount,
      citationCount: 0,
      matchScore: 0,
      sharedInterests: [],
      recentPostCount: p.recentPostCount,
      studioReleaseCount: p.studioReleaseCount,
    })),
  };
}