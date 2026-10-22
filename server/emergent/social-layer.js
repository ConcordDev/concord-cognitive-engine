/**
 * Concord — Social / Distribution Layer
 *
 * Public DTU profiles, follow system, public feeds,
 * cited-by counters, trending DTUs, discovery loops.
 */

import { lookupUserIdentity } from "../lib/user-identity.js";
import { ensureSocialHydrated, scheduleSocialFlush } from "../lib/social-persist.js";
import { assertSocialRate, duplicatePost, linkHeavyNewAccount } from "../lib/social-safety.js";


// ── Realtime emit hookup (Phase 11, Item 4) ─────────────────────────────
//
// createNotification is invoked from inside this module (from
// addReaction / addComment / sharePost / sendMessage etc.) — there's
// no server.js call frame to attach a socket emit to.  setSocialEmitter
// is called from server.js once at boot to thread the emitToUser
// helper in.  When the emitter is set, every notification that's
// generated also fires a `social:notification` event to the
// recipient's user-scoped socket room so toasts show up in real time
// instead of waiting on the 60s notification-bell poll.

let _socialEmitter = null;
export function setSocialEmitter(fn) { _socialEmitter = typeof fn === "function" ? fn : null; }
function _fireNotificationSocket(userId, notification) {
  if (!_socialEmitter || !userId) return;
  try { _socialEmitter(userId, "social:notification", { notification }); }
  catch (_e) { /* never crash the substrate over a socket fanout */ }
}

// ── Social State ─────────────────────────────────────────────────────────

function getSocialState(STATE) {
  if (!STATE._social) {
    STATE._social = {
      profiles: new Map(),       // userId → profile object
      follows: new Map(),        // userId → Set<followedUserId>
      followers: new Map(),      // userId → Set<followerUserId>
      publicDtus: new Set(),     // dtuIds that are marked public
      citedBy: new Map(),        // dtuId → Set<citingDtuId>
      feedCache: new Map(),      // userId → cached feed entries
      trending: [],              // trending DTU snapshots
      trendingComputedAt: 0,

      // New social structures
      posts: new Map(),          // postId → post object
      messages: new Map(),       // conversationId → array of messages
      notifications: new Map(),  // userId → array of notifications
      groups: new Map(),         // groupId → group object
      streaks: new Map(),        // userId → { current, longest, lastPostDate }
      scheduledPosts: new Map(), // postId → { postData, scheduledAt, userId }
      postListings: new Map(),   // postId → Set<listingId>
      postClicks: new Map(),     // postId → click count
      postEarnings: new Map(),   // postId → earnings amount

      metrics: {
        totalProfiles: 0,
        totalFollows: 0,
        publicDtuCount: 0,
        feedRequests: 0,
        trendingComputations: 0,
      },
    };
  }
  // Ensure new fields exist on older state objects
  const s = STATE._social;
  if (!s.posts) s.posts = new Map();
  if (!s.messages) s.messages = new Map();
  if (!s.notifications) s.notifications = new Map();
  if (!s.groups) s.groups = new Map();
  if (!s.streaks) s.streaks = new Map();
  if (!s.scheduledPosts) s.scheduledPosts = new Map();
  if (!s.postListings) s.postListings = new Map();
  if (!s.postClicks) s.postClicks = new Map();
  if (!s.postEarnings) s.postEarnings = new Map();
  if (!s.drafts) s.drafts = new Map();
  ensureSocialHydrated(STATE);
  return STATE._social;
}

export function canonicalSocial(STATE) {
  return getSocialState(STATE);
}

function blockedSet(bucket) {
  if (!bucket || typeof bucket !== "object") return null;
  const blocked = bucket.blocked;
  if (blocked instanceof Set) return blocked;
  if (Array.isArray(blocked)) return new Set(blocked);
  if (blocked && typeof blocked === "object" && Array.isArray(blocked.values)) return new Set(blocked.values);
  return null;
}

// Either direction. The only block list that exists today is the lens
// moderation bucket (domains/social.js social.block). REST and lens
// macros both consult this helper.
export function isBlocked(STATE, a, b) {
  if (!STATE || !a || !b || a === b) return false;
  const mod = STATE.socialLens?.moderation;
  if (!mod) return false;
  const bucket = (id) => (mod instanceof Map ? mod.get(id) : mod[id]);
  const left = blockedSet(bucket(a));
  const right = blockedSet(bucket(b));
  return !!((left && left.has(b)) || (right && right.has(a)));
}

function blockedResult() {
  return { ok: false, status: 403, error: "blocked" };
}

// A recipient is real when they have a public social profile or an active
// users row. With no database to check, callers that predate this guard
// (in-memory unit tests) are left alone.
export function recipientResolvable(STATE, userId, db) {
  if (!userId || userId === "anon") return false;
  const social = getSocialState(STATE || {});
  if (social.profiles.has(userId)) return true;
  const database = db || STATE?.db;
  if (!database || typeof database.prepare !== "function") return true;
  try {
    const row = database.prepare("SELECT id FROM users WHERE id = ? AND is_active = 1").get(userId);
    return !!row;
  } catch {
    return true;
  }
}

let _postIdCounter = 0;
function nextId(prefix) { return `${prefix}_${Date.now()}_${++_postIdCounter}`; }

// ── Profiles ─────────────────────────────────────────────────────────────

/**
 * Create or update a public profile for a user.
 */
export function upsertProfile(STATE, userId, profileData) {
  const social = getSocialState(STATE);

  const existing = social.profiles.get(userId);
  const profile = {
    ...(existing || {}),
    userId,
    displayName: profileData.displayName || existing?.displayName || userId,
    bio: profileData.bio || existing?.bio || "",
    avatar: profileData.avatar || existing?.avatar || "",
    isPublic: profileData.isPublic !== undefined ? profileData.isPublic : (existing?.isPublic ?? true),
    specialization: profileData.specialization || existing?.specialization || [],
    website: profileData.website || existing?.website || "",
    createdAt: existing?.createdAt || new Date().toISOString(),
    updatedAt: new Date().toISOString(),

    // Computed stats (updated on reads)
    stats: existing?.stats || {
      dtuCount: 0,
      publicDtuCount: 0,
      citationCount: 0,
      followerCount: 0,
      followingCount: 0,
    },
  };

  const isNew = !existing;
  social.profiles.set(userId, profile);
  if (isNew) social.metrics.totalProfiles++;
  scheduleSocialFlush(STATE);

  return { ok: true, profile, isNew };
}

// Fields a stranger may see. Everything else on the profile object is a
// per-user setting (searches, mutes, lists, DM policy, email, …) and is
// returned only to the owner. New settings stay private until they are
// added here on purpose.
const PUBLIC_PROFILE_KEYS = [
  "userId",
  "displayName",
  "username",
  "bio",
  "avatar",
  "isPublic",
  "specialization",
  "website",
  "createdAt",
  "updatedAt",
];

const PUBLIC_STAT_KEYS = [
  "dtuCount",
  "publicDtuCount",
  "citationCount",
  "followerCount",
  "followingCount",
];

function publicStats(stats) {
  const src = stats && typeof stats === "object" ? stats : {};
  const out = {};
  for (const key of PUBLIC_STAT_KEYS) out[key] = src[key] || 0;
  return out;
}

/**
 * Allowlist projection. `viewerId` equal to `profile.userId` receives the
 * stored profile except `email`, which is never part of a social profile
 * response. Every other viewer receives PUBLIC_PROFILE_KEYS plus public stats.
 */
export function profileForViewer(profile, viewerId = null) {
  if (!profile || typeof profile !== "object") return null;
  const owner = !!viewerId && viewerId === profile.userId;
  if (owner) {
    const copy = { ...profile };
    if (copy.stats && typeof copy.stats === "object") copy.stats = { ...copy.stats };
    delete copy.email;
    return copy;
  }
  const view = {};
  for (const key of PUBLIC_PROFILE_KEYS) {
    if (profile[key] !== undefined) view[key] = profile[key];
  }
  view.stats = publicStats(profile.stats);
  return view;
}

export function getProfile(STATE, userId, viewerId = null) {
  const social = getSocialState(STATE);
  const profile = social.profiles.get(userId);
  if (!profile) return { ok: false, error: "Profile not found" };

  // Recompute stats
  profile.stats.followerCount = (social.followers.get(userId) || new Set()).size;
  profile.stats.followingCount = (social.follows.get(userId) || new Set()).size;

  // Count public DTUs by this user
  let dtuCount = 0;
  let publicDtuCount = 0;
  let citationCount = 0;

  if (STATE.dtus) {
    for (const dtu of STATE.dtus.values()) {
      if (dtu.author === userId || dtu.meta?.authorId === userId) {
        dtuCount++;
        if (social.publicDtus.has(dtu.id)) publicDtuCount++;
      }
    }
  }

  // Count citations
  for (const [dtuId, citers] of social.citedBy) {
    const dtu = STATE.dtus?.get(dtuId);
    if (dtu && (dtu.author === userId || dtu.meta?.authorId === userId)) {
      citationCount += citers.size;
    }
  }

  profile.stats.dtuCount = dtuCount;
  profile.stats.publicDtuCount = publicDtuCount;
  profile.stats.citationCount = citationCount;

  const who = publicIdentity(userId, profile);
  const shaped = {
    ...profile,
    displayName: who.displayName || profile.displayName,
    username: who.username,
  };
  return { ok: true, profile: profileForViewer(shaped, viewerId) };
}

export function listProfiles(STATE, options = {}) {
  const social = getSocialState(STATE);
  let profiles = Array.from(social.profiles.values());

  // Only public profiles
  if (options.publicOnly !== false) {
    profiles = profiles.filter(p => p.isPublic);
  }

  // Sort options
  const sortBy = options.sortBy || "citationCount";
  profiles.sort((a, b) => {
    if (sortBy === "citationCount") return (b.stats?.citationCount || 0) - (a.stats?.citationCount || 0);
    if (sortBy === "followerCount") return (b.stats?.followerCount || 0) - (a.stats?.followerCount || 0);
    if (sortBy === "dtuCount") return (b.stats?.dtuCount || 0) - (a.stats?.dtuCount || 0);
    return 0;
  });

  const limit = options.limit || 50;
  const page = profiles.slice(0, limit).map((p) => profileForViewer(p, null));
  return { ok: true, profiles: page, total: profiles.length };
}

// ── Follow System ────────────────────────────────────────────────────────

/**
 * Follow a user. Simple bidirectional index.
 */
export function followUser(STATE, followerId, followedId) {
  const social = getSocialState(STATE);
  if (followerId === followedId) return { ok: false, error: "Cannot follow yourself" };
  if (isBlocked(STATE, followerId, followedId)) return blockedResult();
  const followLimit = assertSocialRate(social.profiles.get(followerId), followerId, "follow");
  if (!followLimit.ok) return followLimit;

  // Check followed user exists
  if (!social.profiles.has(followedId)) {
    return { ok: false, error: "User not found" };
  }

  if (!social.follows.has(followerId)) social.follows.set(followerId, new Set());
  if (!social.followers.has(followedId)) social.followers.set(followedId, new Set());

  const alreadyFollowing = social.follows.get(followerId).has(followedId);
  social.follows.get(followerId).add(followedId);
  social.followers.get(followedId).add(followerId);

  if (!alreadyFollowing) social.metrics.totalFollows++;

  // Invalidate feed cache for follower
  social.feedCache.delete(followerId);
  scheduleSocialFlush(STATE);

  return { ok: true, followerId, followedId, isNew: !alreadyFollowing };
}

export function unfollowUser(STATE, followerId, followedId) {
  const social = getSocialState(STATE);

  const followSet = social.follows.get(followerId);
  const followerSet = social.followers.get(followedId);
  if (!followSet?.has(followedId)) return { ok: false, error: "Not following this user" };

  followSet.delete(followedId);
  followerSet?.delete(followerId);
  social.metrics.totalFollows = Math.max(0, social.metrics.totalFollows - 1);
  scheduleSocialFlush(STATE);

  // Invalidate feed cache
  social.feedCache.delete(followerId);

  return { ok: true, followerId, followedId };
}

export function getFollowers(STATE, userId, limit = 50) {
  const social = getSocialState(STATE);
  const followerSet = social.followers.get(userId) || new Set();
  const followers = Array.from(followerSet).slice(0, limit).map(id => {
    const profile = social.profiles.get(id);
    const who = publicIdentity(id, profile);
    return { userId: id, displayName: who.displayName || "Member", username: who.username };
  });
  return { ok: true, userId, followers, total: followerSet.size };
}

export function getFollowing(STATE, userId, limit = 50) {
  const social = getSocialState(STATE);
  const followSet = social.follows.get(userId) || new Set();
  const following = Array.from(followSet).slice(0, limit).map(id => {
    const profile = social.profiles.get(id);
    const who = publicIdentity(id, profile);
    return { userId: id, displayName: who.displayName || "Member", username: who.username };
  });
  return { ok: true, userId, following, total: followSet.size };
}

// ── Public DTU Index ─────────────────────────────────────────────────────

/**
 * Mark a DTU as public (visible in feeds and search).
 *
 * Security audit 2026-07-30: `_userId` used to be accepted but never
 * checked (its underscore prefix was the JS "intentionally unused"
 * convention, not a stub-for-later) — any authenticated user, regardless
 * of ownership, could publish or unpublish any other user's DTU to/from
 * the public social feed. Now enforced against the same ownership fields
 * `dtu.delete`'s macro checks (server.js).
 */
export function publishDtu(STATE, dtuId, userId) {
  const social = getSocialState(STATE);

  const dtu = STATE.dtus?.get(dtuId);
  if (!dtu) return { ok: false, error: "DTU not found" };
  if (!isDtuOwner(dtu, userId)) return { ok: false, error: "unauthorized: you can only publish your own DTUs" };

  social.publicDtus.add(dtuId);
  social.metrics.publicDtuCount = social.publicDtus.size;

  return { ok: true, dtuId, isPublic: true };
}

export function unpublishDtu(STATE, dtuId, userId) {
  const social = getSocialState(STATE);

  const dtu = STATE.dtus?.get(dtuId);
  if (!dtu) return { ok: false, error: "DTU not found" };
  if (!isDtuOwner(dtu, userId)) return { ok: false, error: "unauthorized: you can only unpublish your own DTUs" };

  social.publicDtus.delete(dtuId);
  social.metrics.publicDtuCount = social.publicDtus.size;
  return { ok: true, dtuId, isPublic: false };
}

// A DTU with no identifiable owner field at all (system-seeded/imported
// content) stays permissive — any authenticated caller may publish/
// unpublish it — matching the same "no ownerId = permissive, legacy"
// precedent already established for chat sessions
// (lib/session-access.js#assertSessionAccessible). A DTU that DOES carry
// an owner field is restricted to that owner only. This is what actually
// closes the audit finding (cross-user publish/unpublish of a REAL,
// owned DTU) without regressing the legitimate unowned-DTU case.
function isDtuOwner(dtu, userId) {
  const ownerFields = [dtu.author, dtu.meta?.authorId, dtu.ownerId, dtu.createdBy, dtu.createdByUser, dtu.authorId, dtu.source];
  if (!ownerFields.some(Boolean)) return true; // unowned — permissive
  if (!userId) return false;
  return ownerFields.includes(userId);
}

// ── Cited-By Tracking ────────────────────────────────────────────────────

/**
 * Record that dtuB cites dtuA. Updates cited-by counters.
 */
export function citeAsOwner(STATE, { userId, citedDtuId, citingDtuId }) {
  if (!userId) return { ok: false, status: 401, error: "auth required" };
  if (!citingDtuId || !citedDtuId) return { ok: false, status: 400, error: "citedDtuId and citingDtuId required" };
  const citing = STATE.dtus?.get(citingDtuId);
  if (!citing) return { ok: false, status: 404, error: "citing DTU not found" };
  if (!isDtuOwner(citing, userId)) return { ok: false, status: 403, error: "you can only cite from a DTU you own" };
  return recordCitation(STATE, citedDtuId, citingDtuId);
}

export function recordCitation(STATE, citedDtuId, citingDtuId) {
  const social = getSocialState(STATE);
  if (citedDtuId === citingDtuId) return { ok: false, error: "Self-citation" };

  if (!social.citedBy.has(citedDtuId)) social.citedBy.set(citedDtuId, new Set());
  social.citedBy.get(citedDtuId).add(citingDtuId);

  return { ok: true, citedDtuId, citingDtuId, totalCitations: social.citedBy.get(citedDtuId).size };
}

export function getCitedBy(STATE, dtuId, limit = 50) {
  const social = getSocialState(STATE);
  const citers = social.citedBy.get(dtuId) || new Set();
  const citing = Array.from(citers).slice(0, limit).map(id => {
    const dtu = STATE.dtus?.get(id);
    return { dtuId: id, title: dtu?.title || dtu?.human?.title || id };
  });
  return { ok: true, dtuId, citedBy: citing, total: citers.size };
}

// ── Feed System ──────────────────────────────────────────────────────────

/**
 * Get personalized feed for a user (DTUs from people they follow).
 */
export function getFeed(STATE, userId, options = {}) {
  const social = getSocialState(STATE);
  social.metrics.feedRequests++;

  const followSet = social.follows.get(userId) || new Set();
  const feedItems = [];

  // Collect recent public DTUs from followed users
  if (STATE.dtus) {
    for (const dtu of STATE.dtus.values()) {
      const authorId = dtu.author || dtu.meta?.authorId;
      if (!followSet.has(authorId)) continue;
      if (!social.publicDtus.has(dtu.id)) continue;

      feedItems.push({
        dtuId: dtu.id,
        title: dtu.title || dtu.human?.title || "Untitled",
        authorId,
        authorName: social.profiles.get(authorId)?.displayName || authorId,
        tags: (dtu.tags || []).slice(0, 5),
        tier: dtu.tier || "regular",
        createdAt: dtu.createdAt || dtu.meta?.createdAt,
        citationCount: (social.citedBy.get(dtu.id) || new Set()).size,
      });
    }
  }

  // Sort by recency
  feedItems.sort((a, b) => {
    const timeA = new Date(a.createdAt || 0).getTime();
    const timeB = new Date(b.createdAt || 0).getTime();
    return timeB - timeA;
  });

  const limit = options.limit || 30;
  const offset = options.offset || 0;

  return {
    ok: true,
    feed: feedItems.slice(offset, offset + limit),
    total: feedItems.length,
    followingCount: followSet.size,
  };
}

// ── Trending DTUs ────────────────────────────────────────────────────────

/**
 * Compute trending DTUs based on citation count, recency, and engagement.
 */
export function computeTrending(STATE, limit = 20) {
  const social = getSocialState(STATE);
  const now = Date.now();

  // Only recompute every 5 minutes
  if (now - social.trendingComputedAt < 300000 && social.trending.length > 0) {
    return { ok: true, trending: social.trending, cached: true };
  }

  const candidates = [];

  for (const dtuId of social.publicDtus) {
    const dtu = STATE.dtus?.get(dtuId);
    if (!dtu) continue;

    const citations = (social.citedBy.get(dtuId) || new Set()).size;
    const age = (now - new Date(dtu.createdAt || 0).getTime()) / (86400000); // days
    const recencyBoost = Math.max(0, 1 - age * 0.05); // decays over 20 days
    const score = citations * 2 + recencyBoost * 10;

    candidates.push({
      dtuId,
      title: dtu.title || dtu.human?.title || "Untitled",
      authorId: dtu.author || dtu.meta?.authorId,
      authorName: social.profiles.get(dtu.author || dtu.meta?.authorId)?.displayName || "Unknown",
      tags: (dtu.tags || []).slice(0, 5),
      citationCount: citations,
      score: Math.round(score * 100) / 100,
      createdAt: dtu.createdAt,
    });
  }

  candidates.sort((a, b) => b.score - a.score);
  social.trending = candidates.slice(0, limit);
  social.trendingComputedAt = now;
  social.metrics.trendingComputations++;

  return { ok: true, trending: social.trending, cached: false };
}

// ── Discovery ────────────────────────────────────────────────────────────

/**
 * searchUsersByPrefix — type-ahead lookup for @mention autocomplete.
 *
 * Phase 11 (Item 3): supports the MentionAutocomplete dropdown in
 * QuickPostComposer and CommentThread.  Ranks by:
 *   1. people the viewer follows
 *   2. people who follow the viewer
 *   3. everyone else (public profiles only), ordered by citation count
 *
 * Returns canonical shape so the round-trip to the post's
 * `mentionedUsers` array doesn't lose any identity info.
 *
 * @param {Object} STATE
 * @param {string} prefix    typed prefix (without @)
 * @param {string} viewerId  the caller's userId (for follow-ranking)
 * @param {number} limit
 * @returns {{ ok: true, results: Array<{ userId, username, displayName, avatar, isFollowing, isFollower }> }}
 */
export function searchUsersByPrefix(STATE, prefix, viewerId, limit = 10) {
  const social = getSocialState(STATE);
  const q = String(prefix || "").trim().toLowerCase();
  if (!q) return { ok: true, results: [] };

  const following = social.follows.get(viewerId) || new Set();
  const followers = new Set();
  for (const [otherId, theirFollows] of social.follows) {
    if (otherId !== viewerId && theirFollows.has(viewerId)) followers.add(otherId);
  }

  const matches = [];
  for (const [id, profile] of social.profiles) {
    if (id === viewerId) continue;
    if (!profile.isPublic) continue;
    const dn = String(profile.displayName || "").toLowerCase();
    // Username is the userId tail for now (auth-system users carry it
    // separately; we fall back to displayName + id prefix-match).
    const idLower = String(id).toLowerCase();
    if (!dn.startsWith(q) && !idLower.startsWith(q) && !dn.includes(q)) continue;

    const isFollowing = following.has(id);
    const isFollower = followers.has(id);
    let rankScore = 0;
    if (isFollowing) rankScore += 100;
    if (isFollower) rankScore += 50;
    rankScore += Math.min(50, profile.stats?.citationCount || 0);
    // prefix matches outrank substring matches
    if (dn.startsWith(q) || idLower.startsWith(q)) rankScore += 25;

    matches.push({
      userId: id,
      username: profile.displayName || id,
      displayName: profile.displayName || id,
      avatar: profile.avatar || null,
      isFollowing,
      isFollower,
      _rank: rankScore,
    });
  }

  matches.sort((a, b) => b._rank - a._rank);
  const trimmed = matches.slice(0, limit).map(({ _rank, ...rest }) => rest);
  return { ok: true, results: trimmed };
}

/**
 * Discover users to follow based on shared interests (tags, domains).
 */
export function discoverUsers(STATE, userId, limit = 10) {
  const social = getSocialState(STATE);
  const myFollows = social.follows.get(userId) || new Set();

  // Find users who share tags with the current user's DTUs
  const myTags = new Set();
  if (STATE.dtus) {
    for (const dtu of STATE.dtus.values()) {
      if (dtu.author === userId || dtu.meta?.authorId === userId) {
        for (const tag of (dtu.tags || [])) myTags.add(tag);
      }
    }
  }

  const candidates = [];
  for (const [id, profile] of social.profiles) {
    if (id === userId || myFollows.has(id)) continue;
    if (!profile.isPublic) continue;

    // Score by tag overlap
    const userTags = new Set(profile.specialization || []);
    let overlap = 0;
    for (const tag of myTags) if (userTags.has(tag)) overlap++;
    const score = overlap + (profile.stats?.citationCount || 0) * 0.01;

    if (score > 0) {
      candidates.push({ userId: id, profile, score });
    }
  }

  candidates.sort((a, b) => b.score - a.score);

  return {
    ok: true,
    suggestions: candidates.slice(0, limit).map(c => {
      const who = publicIdentity(c.userId, c.profile);
      return {
      userId: c.userId,
      displayName: who.displayName || c.profile.displayName,
      username: who.username,
      bio: c.profile.bio,
      followerCount: c.profile.stats?.followerCount || 0,
      citationCount: c.profile.stats?.citationCount || 0,
      matchScore: c.score,
    };
    }),
  };
}

// ── Metrics ──────────────────────────────────────────────────────────────

export function getSocialMetrics(STATE) {
  const social = getSocialState(STATE);
  return { ok: true, ...social.metrics };
}

// ── Posts ────────────────────────────────────────────────────────────────

// Audience is who on THIS instance may read the post. It is separate from
// federationVisibility, which only decides whether the post leaves the
// instance. `local` / unset stays public here (don't federate, don't hide).
// An explicit privacy or visibility field wins over the federation flag.
function resolveAudience({ privacy, visibility, federationVisibility } = {}) {
  const explicit = privacy != null ? privacy : visibility;
  if (explicit === "public" || explicit === "followers" || explicit === "private") return explicit;
  if (explicit === "only-me" || explicit === "only_me") return "private";
  if (federationVisibility === "followers") return "followers";
  if (federationVisibility === "private") return "private";
  return "public";
}

function postAudience(post) {
  return (post && post.privacy) || "public";
}

function followsAuthor(social, viewerId, authorId) {
  if (!viewerId || !authorId) return false;
  const set = social.follows.get(viewerId);
  return !!(set && set.has(authorId));
}

function postExpired(post) {
  if (!post?.expiresAt) return false;
  const when = Date.parse(post.expiresAt);
  return Number.isFinite(when) && when < Date.now();
}

// One read check for every feed, search, trending list, permalink, and
// comment thread. Expired stories (a past expiresAt) are invisible to
// everyone, including the author. A block in either direction hides the
// author's posts. Followers-only posts are limited to the author and
// people who follow them. Private posts are limited to the author.
// `viewer` is a user id, or null when nobody is signed in. `state` is the
// store that holds follows and blocks; it falls back to the process state.
export function canViewPost(viewer, post, state) {
  if (!post) return false;
  if (postExpired(post)) return false;
  const STATE = state || globalThis._concordSTATE || null;
  const viewerId = viewer && typeof viewer === "object"
    ? (viewer.id || viewer.userId || null)
    : (viewer || null);
  const authorId = post.userId || null;
  if (STATE && viewerId && authorId && isBlocked(STATE, viewerId, authorId)) return false;
  if (viewerId && authorId && viewerId === authorId) return true;
  const audience = postAudience(post);
  if (audience === "private") return false;
  if (audience === "followers") {
    if (!STATE || !viewerId) return false;
    return followsAuthor(getSocialState(STATE), viewerId, authorId);
  }
  return true;
}

function requireVisiblePost(STATE, postId, viewerId) {
  const social = getSocialState(STATE);
  const post = social.posts.get(postId);
  if (!post || !canViewPost(viewerId, post, STATE)) return null;
  return post;
}

export function createPost(STATE, { userId, content, title, mediaType, mediaUrl, tags, mentionedUsers, pollOptions, isStory, expiresAt, taggedProducts, linkedDTUs, federationVisibility, privacy, visibility, replyAudience, sensitive }) {
  const social = getSocialState(STATE);
  if (!userId) return { ok: false, error: "userId required" };
  if (!content && !mediaUrl) return { ok: false, error: "content or mediaUrl required" };
  const postLimit = assertSocialRate(social.profiles.get(userId), userId, "post");
  if (!postLimit.ok) return postLimit;
  if (duplicatePost(social.posts, userId, content)) {
    return { ok: false, status: 409, error: "duplicate post" };
  }
  if (linkHeavyNewAccount(social.profiles.get(userId), content)) {
    return { ok: false, status: 403, error: "new accounts cannot post that many links" };
  }
  if (typeof mediaUrl === "string" && /^data:/i.test(mediaUrl)) {
    return { ok: false, error: "data URIs are not accepted; upload the file first" };
  }

  const id = nextId("post");
  const now = new Date().toISOString();
  // Phase 11 (Item 12) — federation visibility lives on the post.
  // Defaults to 'local'. Server-side fanout to the federation outbox
  // only happens when visibility !== 'local' AND the federation
  // dispatcher is wired (CONCORD_ACTIVITYPUB=true).
  const fedVisibility = ['local', 'followers', 'public'].includes(federationVisibility) ? federationVisibility : 'local';
  const audience = resolveAudience({ privacy, visibility, federationVisibility: fedVisibility });
  const post = {
    id,
    userId,
    content: content || "",
    title: title || "",
    mediaType: mediaType || "text",
    mediaUrl: mediaUrl || null,
    tags: tags || [],
    mentionedUsers: mentionedUsers || [],
    taggedProducts: taggedProducts || [],
    linkedDTUs: linkedDTUs || [],
    reactions: new Map(),
    comments: [],
    shares: [],
    bookmarks: new Set(),
    viewCount: 0,
    watchTimeMs: 0,
    createdAt: now,
    expiresAt: isStory ? (expiresAt || new Date(Date.now() + 86400000).toISOString()) : (expiresAt || null),
    isPinned: false,
    pollOptions: pollOptions ? pollOptions.map(o => ({ text: typeof o === "string" ? o : o.text, votes: new Set() })) : null,
    threadParentId: null,
    threadPosition: 0,
    groupId: null,
    privacy: audience,
    isStory: isStory === true,
    sensitive: sensitive === true,
    replyAudience: ["everyone", "followers", "mentioned"].includes(replyAudience) ? replyAudience : "everyone",
    federationVisibility: fedVisibility,
    apActivityId: fedVisibility !== 'local' ? `concord:post:${id}` : null,
  };

  social.posts.set(id, post);
  persistSocialPostRow(post);
  scheduleSocialFlush(STATE);

  // Create mention notifications
  if (post.mentionedUsers.length) {
    for (const mentioned of post.mentionedUsers) {
      if (!mentioned || mentioned === userId) continue;
      if (isBlocked(STATE, userId, mentioned)) continue;
      createNotification(STATE, { userId: mentioned, type: "mention", fromUserId: userId, postId: id, content: `${userId} mentioned you in a post` });
    }
  }

  // Federation outbox fanout (best-effort). Caller in server.js sets
  // _federationDispatcher with (post) → enqueue rows. Wrapped in
  // try/catch so an outbox-write failure never breaks createPost.
  if (fedVisibility !== 'local' && typeof _federationDispatcher === 'function') {
    try { _federationDispatcher(post); }
    catch (_e) { /* substrate stays consistent */ }
  }

  // Update streak
  updateStreak(STATE, userId);

  return { ok: true, post: serializePost(post) };
}

// Phase 11 (Item 12) — federation dispatcher hook. server.js wires
// this once at boot to fan visibility-non-local posts into the
// federation_outbox table via federation-outbox.js#enqueueOutbound.
let _federationDispatcher = null;
export function setFederationDispatcher(fn) {
  _federationDispatcher = typeof fn === 'function' ? fn : null;
}

function persistSocialPostRow(post) {
  const db = globalThis._concordSTATE?.db;
  if (!db || typeof db.prepare !== "function" || !post?.id) return;
  try {
    const created = Number.isFinite(Date.parse(post.createdAt))
      ? Math.floor(Date.parse(post.createdAt) / 1000)
      : Math.floor(Date.now() / 1000);
    db.prepare(
      `INSERT OR REPLACE INTO social_posts (id, user_id, author_id, content, created_at) VALUES (?, ?, ?, ?, ?)`,
    ).run(post.id, post.userId, post.userId, post.content || "", created);
  } catch { /* social_posts may be absent */ }
}

function publicIdentity(userId, profile) {
  const idn = lookupUserIdentity(globalThis._concordSTATE?.db, userId);
  const profileName = profile?.displayName && profile.displayName !== userId ? profile.displayName : null;
  const username = idn.username && idn.username !== userId ? idn.username : null;
  const displayName = profileName
    || (idn.displayName && idn.displayName !== userId ? idn.displayName : null)
    || username
    || null;
  return { username, displayName };
}

function asList(value) {
  return Array.isArray(value) ? value : [];
}

function mediaKind(mediaType) {
  return mediaType === "video" || mediaType === "audio" || mediaType === "image" ? mediaType : "image";
}

function mediaList(post) {
  if (Array.isArray(post?.media)) return post.media;
  if (typeof post?.mediaUrl === "string" && post.mediaUrl) {
    return [{ kind: mediaKind(post.mediaType), url: post.mediaUrl, alt: "", caption: "" }];
  }
  return [];
}

function reactionTotalOf(post) {
  const reactions = post?.reactions;
  if (!reactions) return 0;
  if (reactions instanceof Map) {
    let total = 0;
    for (const users of reactions.values()) {
      if (users instanceof Set || Array.isArray(users)) total += users.size || users.length || 0;
    }
    return total;
  }
  if (typeof reactions === "object") {
    let total = 0;
    for (const value of Object.values(reactions)) {
      if (typeof value === "number") total += value;
      else if (value instanceof Set || Array.isArray(value)) total += value.size || value.length || 0;
    }
    return total;
  }
  return 0;
}

function bookmarkCountOf(post) {
  if (post?.bookmarks instanceof Set) return post.bookmarks.size;
  if (Array.isArray(post?.bookmarks)) return post.bookmarks.length;
  return Number(post?.bookmarkCount) || 0;
}

function serializePost(post) {
  const reactions = {};
  if (post.reactions instanceof Map) {
    for (const [type, users] of post.reactions) {
      reactions[type] = users instanceof Set ? users.size : (Array.isArray(users) ? users.length : 0);
    }
  } else if (post.reactions && typeof post.reactions === "object") {
    for (const [type, value] of Object.entries(post.reactions)) {
      if (typeof value === "number") reactions[type] = value;
      else if (value instanceof Set || Array.isArray(value)) reactions[type] = value.size || value.length || 0;
    }
  }
  const who = publicIdentity(post.userId, null);
  const storedHandle = post.username && post.username !== post.userId ? post.username : null;
  const storedName = post.displayName && post.displayName !== post.userId ? post.displayName : null;
  const tags = asList(post.tags);
  const hashtags = Array.isArray(post.hashtags) ? post.hashtags : tags;
  const comments = asList(post.comments);
  const shares = asList(post.shares);
  const mentionedUsers = asList(post.mentionedUsers);
  const media = mediaList(post);
  const commentCount = comments.length;
  const shareCount = shares.length;
  const body = post.body || post.content || "";
  const content = post.content || post.body || "";
  const poll = post.poll && Array.isArray(post.poll.options) ? post.poll : null;
  return {
    id: post.id,
    userId: post.userId,
    username: storedHandle || who.username,
    displayName: storedName || who.displayName || storedHandle || who.username,
    content,
    body,
    title: post.title || "",
    mediaType: post.mediaType || (media[0]?.kind || "text"),
    mediaUrl: post.mediaUrl || media[0]?.url || null,
    media,
    tags,
    hashtags,
    mentions: mentionedUsers,
    mentionedUsers,
    comments,
    taggedProducts: post.taggedProducts || [],
    linkedDTUs: post.linkedDTUs || [],
    reactions,
    reactionCounts: reactions,
    reactionTotal: reactionTotalOf(post),
    commentCount,
    replyCount: commentCount,
    shareCount,
    repostCount: post.lensReposts instanceof Set ? post.lensReposts.size : shareCount,
    bookmarkCount: bookmarkCountOf(post),
    viewerReaction: null,
    viewerReposted: false,
    viewCount: post.viewCount || 0,
    watchTimeMs: post.watchTimeMs || 0,
    createdAt: post.createdAt,
    expiresAt: post.expiresAt,
    isPinned: post.isPinned,
    poll,
    pollOptions: Array.isArray(post.pollOptions) ? post.pollOptions.map(o => ({ text: o.text, voteCount: o.votes instanceof Set ? o.votes.size : (Array.isArray(o.votes) ? o.votes.length : 0) })) : null,
    threadParentId: post.threadParentId,
    threadPosition: post.threadPosition,
    groupId: post.groupId,
    privacy: post.privacy || "public",
    sensitive: post.sensitive === true,
    listing: post.listing || null,
    federationVisibility: post.federationVisibility || 'local',
    apActivityId: post.apActivityId || null,
    quoteOf: post.quoteOf || null,
  };
}

export function getPost(STATE, postId, viewerId = null) {
  const social = getSocialState(STATE);
  const post = requireVisiblePost(STATE, postId, viewerId);
  if (!post) return { ok: false, error: "Post not found" };
  return { ok: true, post: serializePost(post) };
}

export function deletePost(STATE, { userId, postId }) {
  if (!userId || userId === "anon") return { ok: false, status: 401, error: "auth required" };
  const social = getSocialState(STATE);
  const id = String(postId || "");
  const post = social.posts.get(id);
  if (!post) return { ok: false, status: 404, error: "Post not found" };
  if (post.userId !== userId) return { ok: false, status: 403, error: "Only owner can delete" };
  social.posts.delete(id);
  const lens = STATE?.socialLens;
  if (lens && typeof lens === "object") {
    if (lens.posts instanceof Map && lens.posts !== social.posts) lens.posts.delete(id);
    if (lens.replies instanceof Map) lens.replies.delete(id);
    if (lens.reactions instanceof Map) lens.reactions.delete(id);
    if (lens.reposts instanceof Map) lens.reposts.delete(id);
  }
  if (social.feedCache instanceof Map) social.feedCache.clear();
  if (Array.isArray(social.trending)) social.trending = [];
  social.trendingComputedAt = 0;
  social.postListings?.delete?.(id);
  social.postClicks?.delete?.(id);
  social.postEarnings?.delete?.(id);
  if (social.groups instanceof Map) {
    for (const group of social.groups.values()) {
      if (Array.isArray(group?.postIds)) group.postIds = group.postIds.filter((pid) => pid !== id);
    }
  }
  const db = STATE?.db;
  if (db && typeof db.prepare === "function") {
    for (const sql of [
      "DELETE FROM social_posts WHERE id = ?",
      "DELETE FROM social_post_records WHERE id = ?",
      "DELETE FROM social_replies WHERE post_id = ?",
      "DELETE FROM social_reactions WHERE post_id = ?",
      "DELETE FROM social_bookmarks WHERE post_id = ?",
      "DELETE FROM social_post_fts WHERE post_id = ?",
    ]) {
      try { db.prepare(sql).run(id); } catch { /* table may be absent */ }
    }
  }
  scheduleSocialFlush(STATE);
  return { ok: true, postId: id };
}

export function getUserPosts(STATE, userId, { limit = 30, offset = 0, viewerId = null } = {}) {
  const social = getSocialState(STATE);
  const posts = [];
  for (const post of social.posts.values()) {
    if (post.userId === userId && canViewPost(viewerId, post, STATE)) posts.push(post);
  }
  posts.sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime());
  return { ok: true, posts: posts.slice(offset, offset + limit).map(serializePost), total: posts.length };
}

// ── Reactions ────────────────────────────────────────────────────────────

const VALID_REACTIONS = new Set(["like", "fire", "heart", "mind-blown", "useful", "disagree"]);

export function addReaction(STATE, { userId, postId, type }) {
  const social = getSocialState(STATE);
  if (!VALID_REACTIONS.has(type)) return { ok: false, error: "Invalid reaction type" };
  const post = requireVisiblePost(STATE, postId, userId);
  if (!post) return { ok: false, error: "Post not found" };

  if (!post.reactions.has(type)) post.reactions.set(type, new Set());
  const set = post.reactions.get(type);
  const toggled = set.has(userId);
  if (toggled) {
    set.delete(userId);
  } else {
    set.add(userId);
    if (post.userId !== userId) {
      createNotification(STATE, { userId: post.userId, type: "like", fromUserId: userId, postId, content: `${userId} reacted ${type} to your post` });
    }
  }
  scheduleSocialFlush(STATE);
  return { ok: true, postId, type, added: !toggled };
}

export function getReactions(STATE, postId, currentUserId) {
  const social = getSocialState(STATE);
  const post = requireVisiblePost(STATE, postId, currentUserId);
  if (!post) return { ok: false, error: "Post not found" };

  const reactions = {};
  for (const [type, users] of post.reactions) {
    reactions[type] = { count: users.size, userReacted: currentUserId ? users.has(currentUserId) : false };
  }
  return { ok: true, postId, reactions };
}

// ── Comments ─────────────────────────────────────────────────────────────

export function addComment(STATE, { userId, postId, content, parentCommentId, mentionedUsers, audience }) {
  const social = getSocialState(STATE);
  if (!content) return { ok: false, error: "content required" };
  const post = requireVisiblePost(STATE, postId, userId);
  if (!post) return { ok: false, error: "Post not found" };
  if (isBlocked(STATE, userId, post.userId)) return blockedResult();
  const commentLimit = assertSocialRate(social.profiles.get(userId), userId, "comment");
  if (!commentLimit.ok) return commentLimit;

  const comment = {
    id: nextId("cmt"),
    userId,
    content,
    parentCommentId: parentCommentId || null,
    mentionedUsers: Array.isArray(mentionedUsers) ? mentionedUsers.filter(Boolean) : [],
    audience: ["everyone", "followers", "mentioned"].includes(audience)
      ? audience
      : (["everyone", "followers", "mentioned"].includes(post.replyAudience) ? post.replyAudience : "everyone"),
    createdAt: new Date().toISOString(),
    replies: [],
  };

  if (!Array.isArray(post.comments)) post.comments = [];
  if (parentCommentId) {
    const parent = post.comments.find(c => c.id === parentCommentId);
    if (parent) parent.replies.push(comment);
    else post.comments.push(comment);
  } else {
    post.comments.push(comment);
  }

  if (post.userId !== userId) {
    createNotification(STATE, { userId: post.userId, type: "comment", fromUserId: userId, postId, content: `${userId} commented on your post` });
  }

  // Phase 11 (Item 3) — mention notifications on comment.
  for (const mentioned of comment.mentionedUsers) {
    if (mentioned === userId || mentioned === post.userId) continue;
    if (isBlocked(STATE, userId, mentioned)) continue;
    createNotification(STATE, { userId: mentioned, type: "mention", fromUserId: userId, postId, content: `${userId} mentioned you in a comment` });
  }

  scheduleSocialFlush(STATE);
  return { ok: true, comment: { id: comment.id, userId: comment.userId, content: comment.content, parentCommentId: comment.parentCommentId, mentionedUsers: comment.mentionedUsers, audience: comment.audience, createdAt: comment.createdAt } };
}

export function deleteComment(STATE, { userId, postId, commentId }) {
  const social = getSocialState(STATE);
  const post = requireVisiblePost(STATE, postId, userId);
  if (!post) return { ok: false, error: "Post not found" };

  function removeFrom(arr) {
    for (let i = 0; i < arr.length; i++) {
      if (arr[i].id === commentId) {
        if (arr[i].userId !== userId && post.userId !== userId) return false;
        arr.splice(i, 1);
        return true;
      }
      if (arr[i].replies && removeFrom(arr[i].replies)) return true;
    }
    return false;
  }

  if (!removeFrom(post.comments)) return { ok: false, error: "Comment not found or not authorized" };
  return { ok: true, commentId };
}

export function getComments(STATE, postId, { limit = 50, viewerId = null } = {}) {
  const social = getSocialState(STATE);
  const post = requireVisiblePost(STATE, postId, viewerId);
  if (!post) return { ok: false, error: "Post not found" };

  function visible(c) {
    if (viewerId && viewerId !== c.userId && isBlocked(STATE, viewerId, c.userId)) return false;
    const audience = c.audience || "everyone";
    if (viewerId && (viewerId === c.userId || viewerId === post.userId)) return true;
    if (audience === "followers") return followsAuthor(social, viewerId, c.userId);
    if (audience === "mentioned") return !!viewerId && (c.mentionedUsers || []).includes(viewerId);
    return audience === "everyone";
  }
  function serializeComment(c) {
    return { id: c.id, userId: c.userId, content: c.content, parentCommentId: c.parentCommentId, audience: c.audience || "everyone", createdAt: c.createdAt, replies: (c.replies || []).filter(visible).map(serializeComment) };
  }
  const comments = asList(post.comments).filter(visible);
  return { ok: true, comments: comments.slice(0, limit).map(serializeComment), total: comments.length };
}

// ── Shares ───────────────────────────────────────────────────────────────

export function sharePost(STATE, { userId, postId, commentary }) {
  const social = getSocialState(STATE);
  const post = requireVisiblePost(STATE, postId, userId);
  if (!post) return { ok: false, error: "Post not found" };
  if (isBlocked(STATE, userId, post.userId)) return blockedResult();

  const share = { userId, commentary: commentary || "", timestamp: new Date().toISOString() };
  if (!Array.isArray(post.shares)) post.shares = [];
  post.shares.push(share);

  if (post.userId !== userId) {
    createNotification(STATE, { userId: post.userId, type: "share", fromUserId: userId, postId, content: `${userId} shared your post` });
  }
  return { ok: true, share };
}

export function getShares(STATE, postId, viewerId = null) {
  const social = getSocialState(STATE);
  const post = requireVisiblePost(STATE, postId, viewerId);
  if (!post) return { ok: false, error: "Post not found" };
  const shares = asList(post.shares);
  return { ok: true, shares, total: shares.length };
}

// ── Bookmarks ────────────────────────────────────────────────────────────

export function bookmarkPost(STATE, { userId, postId }) {
  const social = getSocialState(STATE);
  const post = requireVisiblePost(STATE, postId, userId);
  if (!post) return { ok: false, error: "Post not found" };

  const toggled = post.bookmarks.has(userId);
  if (toggled) post.bookmarks.delete(userId);
  else post.bookmarks.add(userId);
  return { ok: true, postId, bookmarked: !toggled };
}

export function getUserBookmarks(STATE, userId, { limit = 30, offset = 0 } = {}) {
  const social = getSocialState(STATE);
  const bookmarked = [];
  for (const post of social.posts.values()) {
    if (post.bookmarks.has(userId) && canViewPost(userId, post, STATE)) bookmarked.push(post);
  }
  bookmarked.sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime());
  return { ok: true, posts: bookmarked.slice(offset, offset + limit).map(serializePost), total: bookmarked.length };
}

// ── Feed Algorithm ───────────────────────────────────────────────────────

function getEngagementScore(post) {
  const reactionCount = reactionTotalOf(post);
  const comments = asList(post?.comments).length;
  const shares = asList(post?.shares).length;
  return reactionCount * 3 + comments * 5 + shares * 8 + bookmarkCountOf(post) * 4 + (post?.viewCount || 0) * 0.1;
}

function getRecencyBoost(createdAt) {
  const ageHours = (Date.now() - new Date(createdAt).getTime()) / 3600000;
  return Math.max(0.1, 1 - ageHours / 168); // decays over 7 days
}

export function getForYouFeed(STATE, userId, { limit = 30, offset = 0 } = {}) {
  const social = getSocialState(STATE);
  social.metrics.feedRequests++;

  // Collect interest tags from followed users' profiles
  const followSet = social.follows.get(userId) || new Set();
  const interestTags = new Set();
  for (const fid of followSet) {
    const profile = social.profiles.get(fid);
    if (profile?.specialization) for (const t of profile.specialization) interestTags.add(t);
  }

  const now = Date.now();
  const scored = [];
  for (const post of social.posts.values()) {
    if (post.expiresAt && new Date(post.expiresAt).getTime() < now) continue;
    if (!canViewPost(userId, post, STATE)) continue;
    const engagement = getEngagementScore(post);
    const recency = getRecencyBoost(post.createdAt);
    let interestOverlap = 1;
    const tags = asList(post.tags);
    if (interestTags.size > 0 && tags.length > 0) {
      let overlap = 0;
      for (const t of tags) if (interestTags.has(t)) overlap++;
      interestOverlap = 1 + overlap;
    }
    scored.push({ post, score: (engagement + 1) * recency * interestOverlap });
  }

  scored.sort((a, b) => b.score - a.score || new Date(b.post.createdAt).getTime() - new Date(a.post.createdAt).getTime());
  return { ok: true, posts: scored.slice(offset, offset + limit).map(s => ({ ...serializePost(s.post), score: Math.round(s.score * 100) / 100 })), total: scored.length };
}

export function getFollowingFeed(STATE, userId, { limit = 30, offset = 0 } = {}) {
  const social = getSocialState(STATE);
  social.metrics.feedRequests++;
  const followSet = social.follows.get(userId) || new Set();
  const now = Date.now();
  const posts = [];
  for (const post of social.posts.values()) {
    const own = post.userId === userId;
    if (!own && !followSet.has(post.userId)) continue;
    if (post.expiresAt && new Date(post.expiresAt).getTime() < now) continue;
    if (!canViewPost(userId, post, STATE)) continue;
    posts.push(post);
  }
  posts.sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime());
  return { ok: true, posts: posts.slice(offset, offset + limit).map(serializePost), total: posts.length };
}

export function getExploreFeed(STATE, { limit = 30, offset = 0, topic, viewerId = null } = {}) {
  const social = getSocialState(STATE);
  social.metrics.feedRequests++;
  const scored = [];
  for (const post of social.posts.values()) {
    if (topic && !asList(post.tags).includes(topic)) continue;
    // Explore stays a public surface, including for the author.
    if (postAudience(post) !== "public") continue;
    if (!canViewPost(viewerId, post, STATE)) continue;
    const recency = getRecencyBoost(post.createdAt);
    scored.push({ post, score: (getEngagementScore(post) + 1) * recency });
  }
  scored.sort((a, b) => b.score - a.score || new Date(b.post.createdAt).getTime() - new Date(a.post.createdAt).getTime());
  return { ok: true, posts: scored.slice(offset, offset + limit).map(s => ({ ...serializePost(s.post), score: Math.round(s.score * 100) / 100 })), total: scored.length };
}

// ── DMs ──────────────────────────────────────────────────────────────────

function getConversationId(a, b) {
  return [a, b].sort().join(":");
}

// Conversation ids are `sorted(userIdA):sorted(userIdB)`. Knowing both public
// ids must not be enough to read or mutate the thread.
function conversationParts(conversationId) {
  if (typeof conversationId !== "string" || !conversationId) return null;
  const parts = conversationId.split(":");
  if (parts.length !== 2 || !parts[0] || !parts[1]) return null;
  return parts;
}

function isDmParticipant(conversationId, userId) {
  if (!userId || userId === "anon") return false;
  const parts = conversationParts(conversationId);
  if (!parts) return false;
  return parts[0] === userId || parts[1] === userId;
}

function dmDenied(error = "not found") {
  return { ok: false, status: 404, error };
}

export function sendMessage(STATE, { fromUserId, toUserId, content, mediaUrl }) {
  const social = getSocialState(STATE);
  if (!fromUserId || !toUserId) return { ok: false, error: "fromUserId and toUserId required" };
  if (!content && !mediaUrl) return { ok: false, error: "content or mediaUrl required" };
  if (isBlocked(STATE, fromUserId, toUserId)) return blockedResult();
  const dmLimit = assertSocialRate(social.profiles.get(fromUserId), fromUserId, "dm");
  if (!dmLimit.ok) return dmLimit;

  const recipient = social.profiles.get(toUserId);
  const policy = recipient?.dmPolicy || "everyone";
  if (policy === "nobody") return { ok: false, status: 403, error: "recipient does not accept messages" };
  const followedByRecipient = social.follows.get(toUserId);
  const requestStatus = policy === "followers" && !(followedByRecipient && followedByRecipient.has(fromUserId))
    ? "pending"
    : null;

  const convId = getConversationId(fromUserId, toUserId);
  if (!social.messages.has(convId)) social.messages.set(convId, []);

  const msg = {
    id: nextId("msg"),
    conversationId: convId,
    fromUserId,
    toUserId,
    content: content || "",
    mediaUrl: mediaUrl || null,
    createdAt: new Date().toISOString(),
    readBy: new Set([fromUserId]),
    seenBy: new Set([fromUserId]),
    hiddenFor: new Set(),
    requestStatus,
  };

  social.messages.get(convId).push(msg);
  createNotification(STATE, {
    userId: toUserId,
    type: requestStatus === "pending" ? "message_request" : "dm",
    fromUserId,
    content: requestStatus === "pending" ? `Message request from ${fromUserId}` : `New message from ${fromUserId}`,
  });
  scheduleSocialFlush(STATE);

  return { ok: true, message: { id: msg.id, conversationId: msg.conversationId, fromUserId: msg.fromUserId, toUserId: msg.toUserId, content: msg.content, mediaUrl: msg.mediaUrl, createdAt: msg.createdAt } };
}

export function getConversations(STATE, userId) {
  const social = getSocialState(STATE);
  const convos = [];
  if (!userId || userId === "anon") return { ok: true, conversations: [] };
  for (const [convId, msgs] of social.messages) {
    if (!isDmParticipant(convId, userId)) continue;
    const visible = msgs.filter((m) => m.requestStatus !== "pending" || m.toUserId !== userId);
    if (visible.length === 0) continue;
    const lastMsg = visible[visible.length - 1];
    let unreadCount = 0;
    for (const m of visible) {
      const seen = m.seenBy instanceof Set ? m.seenBy : m.readBy;
      if (!seen.has(userId)) unreadCount++;
    }
    const otherUser = convId.split(":").find(id => id !== userId) || userId;
    convos.push({
      conversationId: convId,
      otherUserId: otherUser,
      lastMessage: { content: lastMsg.content, fromUserId: lastMsg.fromUserId, createdAt: lastMsg.createdAt },
      unreadCount,
      messageCount: visible.length,
    });
  }
  convos.sort((a, b) => new Date(b.lastMessage.createdAt).getTime() - new Date(a.lastMessage.createdAt).getTime());
  return { ok: true, conversations: convos };
}

export function getMessages(STATE, conversationId, { limit = 50, offset = 0, userId } = {}) {
  if (!isDmParticipant(conversationId, userId)) return dmDenied("not a participant");
  const social = getSocialState(STATE);
  const msgs = social.messages.get(conversationId);
  if (!msgs) return { ok: true, messages: [], total: 0 };

  const visible = msgs.filter((m) => {
    if (m.hiddenFor instanceof Set && userId && m.hiddenFor.has(userId)) return false;
    if ((m.requestStatus === "pending" || m.requestStatus === "declined") && m.toUserId === userId) return false;
    return true;
  });
  const sorted = [...visible].reverse(); // newest first
  return {
    ok: true,
    messages: sorted.slice(offset, offset + limit).map(m => ({
      id: m.id, conversationId: m.conversationId, fromUserId: m.fromUserId, toUserId: m.toUserId,
      content: m.content, mediaUrl: m.mediaUrl, createdAt: m.createdAt, recalled: !!m.recalled,
      readBy: m.readBy instanceof Set ? [...m.readBy] : [],
    })),
    total: visible.length,
  };
}

export function markMessagesRead(STATE, { userId, conversationId }) {
  if (!isDmParticipant(conversationId, userId)) return dmDenied();
  const social = getSocialState(STATE);
  const msgs = social.messages.get(conversationId);
  if (!msgs) return dmDenied();
  const profile = social.profiles.get(userId);
  const receipts = profile ? profile.readReceipts !== false : true;
  let marked = 0;
  for (const m of msgs) {
    if (!(m.seenBy instanceof Set)) m.seenBy = new Set(m.readBy instanceof Set ? m.readBy : []);
    if (!m.seenBy.has(userId)) { m.seenBy.add(userId); marked++; }
    if (receipts && m.readBy instanceof Set && !m.readBy.has(userId)) m.readBy.add(userId);
  }
  scheduleSocialFlush(STATE);
  return { ok: true, conversationId, markedRead: marked, receipts };
}

// Recall (delete) a DM the caller sent, within a short window. Used by
// frontend panels to surface a "you can take this back" affordance after
// a send. Recipient-side notification stays — only the message body is
// wiped (replaced with a tombstone marker) so the read receipt is honest.
export function recallMessage(STATE, { messageId, userId, windowSeconds = 120 }) {
  if (!messageId || !userId) return { ok: false, error: "messageId and userId required" };
  const social = getSocialState(STATE);
  for (const [convId, msgs] of social.messages) {
    const idx = msgs.findIndex((m) => m.id === messageId);
    if (idx === -1) continue;
    const msg = msgs[idx];
    if (!isDmParticipant(convId, userId)) return dmDenied();
    if (msg.fromUserId !== userId) return { ok: false, error: "only the sender can recall a message" };
    const ageSec = (Date.now() - new Date(msg.createdAt).getTime()) / 1000;
    if (ageSec >= windowSeconds) return { ok: false, error: `recall window (${windowSeconds}s) elapsed` };
    msg.content = "";
    msg.mediaUrl = null;
    msg.recalled = true;
    msg.recalledAt = new Date().toISOString();
    return { ok: true, messageId, conversationId: convId, recalledAt: msg.recalledAt };
  }
  return dmDenied();
}

// ── Notifications ────────────────────────────────────────────────────────

export function createNotification(STATE, { userId, type, fromUserId, postId, content }) {
  const social = getSocialState(STATE);
  if (!social.notifications.has(userId)) social.notifications.set(userId, []);

  const notif = {
    id: nextId("notif"),
    userId,
    type: type || "general",
    fromUserId: fromUserId || null,
    postId: postId || null,
    content: content || "",
    read: false,
    createdAt: new Date().toISOString(),
  };

  social.notifications.get(userId).unshift(notif); // newest first
  // Keep max 500 per user
  const arr = social.notifications.get(userId);
  if (arr.length > 500) arr.length = 500;

  _fireNotificationSocket(userId, notif);
  scheduleSocialFlush(STATE);

  return { ok: true, notification: notif };
}

export function getNotifications(STATE, userId, { limit = 30, offset = 0, unreadOnly = false } = {}) {
  const social = getSocialState(STATE);
  let notifs = social.notifications.get(userId) || [];
  const typePrefs = social.profiles.get(userId)?.notificationTypes;
  if (typePrefs && typeof typePrefs === "object") {
    notifs = notifs.filter((n) => typePrefs[n.type] !== false);
  }
  if (unreadOnly) notifs = notifs.filter(n => !n.read);
  return { ok: true, notifications: notifs.slice(offset, offset + limit), total: notifs.length };
}

export function markNotificationRead(STATE, { userId, notificationId }) {
  const social = getSocialState(STATE);
  const notifs = social.notifications.get(userId);
  if (!notifs) return { ok: false, error: "No notifications" };
  const notif = notifs.find(n => n.id === notificationId);
  if (!notif) return { ok: false, error: "Notification not found" };
  notif.read = true;
  return { ok: true, notificationId };
}

export function markAllNotificationsRead(STATE, userId) {
  const social = getSocialState(STATE);
  const notifs = social.notifications.get(userId) || [];
  let count = 0;
  for (const n of notifs) { if (!n.read) { n.read = true; count++; } }
  return { ok: true, markedRead: count };
}

export function getUnreadCount(STATE, userId) {
  const social = getSocialState(STATE);
  const notifs = social.notifications.get(userId) || [];
  const count = notifs.filter(n => !n.read).length;
  return { ok: true, userId, unreadCount: count };
}

export function deleteNotification(STATE, { userId, notificationId }) {
  const social = getSocialState(STATE);
  const notifs = social.notifications.get(userId);
  if (!notifs) return { ok: false, error: "No notifications" };
  const idx = notifs.findIndex(n => n.id === notificationId);
  if (idx === -1) return { ok: false, error: "Notification not found" };
  notifs.splice(idx, 1);
  return { ok: true, notificationId };
}

// ── Stories ──────────────────────────────────────────────────────────────

export function getActiveStories(STATE, userId) {
  const social = getSocialState(STATE);
  const followSet = social.follows.get(userId) || new Set();
  const now = Date.now();
  const stories = [];

  for (const post of social.posts.values()) {
    if (!post.expiresAt) continue;
    if (new Date(post.expiresAt).getTime() < now) continue;
    if (!followSet.has(post.userId) && post.userId !== userId) continue;
    if (!canViewPost(userId, post, STATE)) continue;
    stories.push(serializePost(post));
  }

  stories.sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime());
  return { ok: true, stories };
}

/**
 * Track a distinct viewer on a post, lazily creating the set.
 *
 * `viewStory` and `recordWatchTime` both accepted `userId` and referenced it
 * nowhere (found 2026-07-25 by the unused-destructured-param detector), so
 * `viewCount` was a raw increment that one user could inflate without limit —
 * and there was no way to ask how many distinct people had actually seen a
 * post. `votePoll` in this same file already uses `userId` to dedupe, so the
 * file's own convention says identity matters here.
 *
 * Deliberately additive: `viewCount` keeps its existing "total views"
 * meaning, and `uniqueViewCount` is reported alongside it. Callers relying on
 * the old field are unaffected. Anonymous views (no userId) still count
 * toward the total and simply don't add a unique viewer, which is honest
 * rather than guessing an identity.
 */
function noteViewer(post, userId) {
  if (!post.viewers) post.viewers = new Set();
  if (userId) post.viewers.add(userId);
  return post.viewers.size;
}

export function viewStory(STATE, { userId, storyId }) {
  const social = getSocialState(STATE);
  const post = requireVisiblePost(STATE, storyId, userId);
  if (!post) return { ok: false, error: "Story not found" };
  post.viewCount++;
  const uniqueViewCount = noteViewer(post, userId);
  return { ok: true, storyId, viewCount: post.viewCount, uniqueViewCount };
}

// ── Polls ────────────────────────────────────────────────────────────────

export function votePoll(STATE, { userId, postId, optionIndex }) {
  const social = getSocialState(STATE);
  const post = requireVisiblePost(STATE, postId, userId);
  if (!post) return { ok: false, error: "Post not found" };
  if (!post.pollOptions) return { ok: false, error: "Post has no poll" };
  if (optionIndex < 0 || optionIndex >= post.pollOptions.length) return { ok: false, error: "Invalid option index" };

  // Remove previous vote
  for (const opt of post.pollOptions) opt.votes.delete(userId);
  post.pollOptions[optionIndex].votes.add(userId);

  return { ok: true, postId, optionIndex };
}

export function getPollResults(STATE, postId, viewerId = null) {
  const social = getSocialState(STATE);
  const post = requireVisiblePost(STATE, postId, viewerId);
  if (!post) return { ok: false, error: "Post not found" };
  if (!post.pollOptions) return { ok: false, error: "Post has no poll" };

  let totalVotes = 0;
  const options = post.pollOptions.map(o => { totalVotes += o.votes.size; return { text: o.text, votes: o.votes.size }; });
  return { ok: true, postId, options, totalVotes };
}

// ── Hashtags / Topics ────────────────────────────────────────────────────

export function getTrendingTopics(STATE, { limit = 20, viewerId = null } = {}) {
  const social = getSocialState(STATE);
  const tagCounts = new Map();
  const cutoff = Date.now() - 7 * 86400000; // last 7 days

  for (const post of social.posts.values()) {
    if (new Date(post.createdAt).getTime() < cutoff) continue;
    if (!canViewPost(viewerId, post, STATE)) continue;
    for (const tag of asList(post.tags)) {
      tagCounts.set(tag, (tagCounts.get(tag) || 0) + 1);
    }
  }

  const sorted = Array.from(tagCounts.entries()).sort((a, b) => b[1] - a[1]).slice(0, limit);
  return { ok: true, topics: sorted.map(([topic, count]) => ({ topic, count })) };
}

// Ranked Social posts and hashtags for GET /api/social/trending.
// Scores come from reactions, comments, saves, and shares on posts the
// viewer is allowed to see. The wider DTU catalog is not consulted.
export function listSocialTrending(STATE, { limit = 20, viewerId = null, hours = 168 } = {}) {
  const cap = Math.min(Math.max(Number(limit) || 20, 1), 100);
  const content = getTrendingContent(STATE, { limit: cap, hours, viewerId });
  const posts = content.content || [];
  const tagScore = new Map();
  const tagCount = new Map();
  for (const post of posts) {
    const weight = (Number(post.trendScore) || 0) + 1;
    for (const tag of post.tags || []) {
      if (typeof tag !== "string" || !tag) continue;
      tagScore.set(tag, (tagScore.get(tag) || 0) + weight);
      tagCount.set(tag, (tagCount.get(tag) || 0) + 1);
    }
  }
  const hashtags = [...tagScore.entries()]
    .map(([tag, score]) => ({
      tag,
      topic: tag,
      count: tagCount.get(tag) || 0,
      score: Math.round(score * 100) / 100,
    }))
    .sort((a, b) => b.score - a.score || b.count - a.count)
    .slice(0, cap);
  return { ok: true, source: "social-trending", posts, hashtags, trending: posts };
}

export function getPostsByTopic(STATE, topic, { limit = 30, offset = 0, viewerId = null } = {}) {
  const social = getSocialState(STATE);
  const now = Date.now();
  const posts = [];
  for (const post of social.posts.values()) {
    if (post.expiresAt && new Date(post.expiresAt).getTime() < now) continue;
    if (!asList(post.tags).includes(topic)) continue;
    if (!canViewPost(viewerId, post, STATE)) continue;
    posts.push(post);
  }
  posts.sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime());
  return { ok: true, posts: posts.slice(offset, offset + limit).map(serializePost), total: posts.length };
}

// ── Groups / Communities ─────────────────────────────────────────────────

export function createGroup(STATE, { userId, name, description, rules, tags }) {
  const social = getSocialState(STATE);
  if (!userId || !name) return { ok: false, error: "userId and name required" };

  const id = nextId("grp");
  const group = {
    id,
    name,
    description: description || "",
    rules: rules || "",
    tags: tags || [],
    ownerId: userId,
    members: new Set([userId]),
    postIds: [],
    createdAt: new Date().toISOString(),
  };

  social.groups.set(id, group);
  return { ok: true, group: serializeGroup(group) };
}

function serializeGroup(g) {
  return { id: g.id, name: g.name, description: g.description, rules: g.rules, tags: g.tags, ownerId: g.ownerId, memberCount: g.members.size, postCount: g.postIds.length, createdAt: g.createdAt };
}

export function joinGroup(STATE, { userId, groupId }) {
  const social = getSocialState(STATE);
  const group = social.groups.get(groupId);
  if (!group) return { ok: false, error: "Group not found" };
  group.members.add(userId);
  return { ok: true, groupId, userId };
}

export function leaveGroup(STATE, { userId, groupId }) {
  const social = getSocialState(STATE);
  const group = social.groups.get(groupId);
  if (!group) return { ok: false, error: "Group not found" };
  if (group.ownerId === userId) return { ok: false, error: "Owner cannot leave group" };
  group.members.delete(userId);
  return { ok: true, groupId, userId };
}

export function getGroupFeed(STATE, groupId, { limit = 30, offset = 0, viewerId = null } = {}) {
  const social = getSocialState(STATE);
  const group = social.groups.get(groupId);
  if (!group) return { ok: false, error: "Group not found" };

  const posts = [];
  for (const pid of group.postIds) {
    const post = social.posts.get(pid);
    if (post && canViewPost(viewerId, post, STATE)) posts.push(post);
  }
  posts.sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime());
  return { ok: true, posts: posts.slice(offset, offset + limit).map(serializePost), total: posts.length };
}

export function postToGroup(STATE, { userId, groupId, postId }) {
  const social = getSocialState(STATE);
  const group = social.groups.get(groupId);
  if (!group) return { ok: false, error: "Group not found" };
  if (!group.members.has(userId)) return { ok: false, error: "Must be a member to post" };
  const post = social.posts.get(postId);
  if (!post) return { ok: false, error: "Post not found" };

  if (!group.postIds.includes(postId)) group.postIds.push(postId);
  post.groupId = groupId;
  return { ok: true, groupId, postId };
}

export function listGroups(STATE, { limit = 50, search } = {}) {
  const social = getSocialState(STATE);
  let groups = Array.from(social.groups.values());
  if (search) {
    const q = search.toLowerCase();
    groups = groups.filter(g => g.name.toLowerCase().includes(q) || g.description.toLowerCase().includes(q) || g.tags.some(t => t.toLowerCase().includes(q)));
  }
  groups.sort((a, b) => b.members.size - a.members.size);
  return { ok: true, groups: groups.slice(0, limit).map(serializeGroup), total: groups.length };
}

export function getGroupMembers(STATE, groupId) {
  const social = getSocialState(STATE);
  const group = social.groups.get(groupId);
  if (!group) return { ok: false, error: "Group not found" };

  const members = Array.from(group.members).map(id => {
    const profile = social.profiles.get(id);
    return { userId: id, displayName: profile?.displayName || id, isOwner: id === group.ownerId };
  });
  return { ok: true, members, total: members.length };
}

// ── Creator Analytics ────────────────────────────────────────────────────

export function getCreatorAnalytics(STATE, userId, viewerId = null) {
  const social = getSocialState(STATE);
  let totalReach = 0;
  let totalEngagement = 0;
  let totalPosts = 0;
  const contentBreakdown = {};
  const reactionBreakdown = {};
  const postScores = [];
  const postingHours = new Array(24).fill(0);

  for (const post of social.posts.values()) {
    if (post.userId !== userId) continue;
    if (!canViewPost(viewerId, post, STATE)) continue;
    totalPosts++;
    totalReach += post.viewCount;

    const engagement = getEngagementScore(post);
    totalEngagement += engagement;

    contentBreakdown[post.mediaType] = (contentBreakdown[post.mediaType] || 0) + 1;
    for (const [type, users] of post.reactions) {
      reactionBreakdown[type] = (reactionBreakdown[type] || 0) + users.size;
    }

    postScores.push({ postId: post.id, title: post.title, engagement });
    const hour = new Date(post.createdAt).getHours();
    postingHours[hour]++;
  }

  postScores.sort((a, b) => b.engagement - a.engagement);
  const bestHours = postingHours.map((count, hour) => ({ hour, count })).sort((a, b) => b.count - a.count).slice(0, 3);

  // Follower growth (approximate: count followers whose profile was created in last 30d)
  const thirtyDaysAgo = new Date(Date.now() - 30 * 86400000).toISOString();
  const followerSet = social.followers.get(userId) || new Set();
  let recentFollowers = 0;
  for (const fid of followerSet) {
    const p = social.profiles.get(fid);
    if (p && p.createdAt >= thirtyDaysAgo) recentFollowers++;
  }

  return {
    ok: true,
    totalReach,
    engagementRate: totalPosts > 0 ? Math.round((totalEngagement / Math.max(totalReach, 1)) * 10000) / 100 : 0,
    followerGrowth: recentFollowers,
    totalFollowers: followerSet.size,
    topPosts: postScores.slice(0, 10),
    bestPostingHours: bestHours,
    contentBreakdown,
    reactionBreakdown,
    totalPosts,
  };
}

export function getPostAnalytics(STATE, postId, viewerId = null) {
  const social = getSocialState(STATE);
  const post = requireVisiblePost(STATE, postId, viewerId);
  if (!post) return { ok: false, error: "Post not found" };

  let reactionCount = 0;
  const reactionBreakdown = {};
  if (post.reactions instanceof Map) {
    for (const [type, users] of post.reactions) {
      const n = users instanceof Set ? users.size : (Array.isArray(users) ? users.length : 0);
      reactionBreakdown[type] = n;
      reactionCount += n;
    }
  } else if (post.reactions && typeof post.reactions === "object") {
    for (const [type, value] of Object.entries(post.reactions)) {
      const n = typeof value === "number"
        ? value
        : (value instanceof Set || Array.isArray(value) ? (value.size || value.length || 0) : 0);
      reactionBreakdown[type] = n;
      reactionCount += n;
    }
  }

  return {
    ok: true,
    postId,
    views: post.viewCount,
    reactions: reactionCount,
    reactionBreakdown,
    comments: asList(post.comments).length,
    shares: asList(post.shares).length,
    bookmarks: bookmarkCountOf(post),
    watchTimeMs: post.watchTimeMs,
    reachEstimate: (post.viewCount || 0) + asList(post.shares).length * 10,
  };
}

// ── Streaks ──────────────────────────────────────────────────────────────

export function updateStreak(STATE, userId) {
  const social = getSocialState(STATE);
  const today = new Date().toISOString().slice(0, 10);
  let streak = social.streaks.get(userId);

  if (!streak) {
    streak = { current: 1, longest: 1, lastPostDate: today };
    social.streaks.set(userId, streak);
    return { ok: true, ...streak };
  }

  if (streak.lastPostDate === today) return { ok: true, ...streak };

  const yesterday = new Date(Date.now() - 86400000).toISOString().slice(0, 10);
  if (streak.lastPostDate === yesterday) {
    streak.current++;
  } else {
    streak.current = 1;
  }

  if (streak.current > streak.longest) streak.longest = streak.current;
  streak.lastPostDate = today;

  return { ok: true, ...streak };
}

export function getStreak(STATE, userId) {
  const social = getSocialState(STATE);
  const streak = social.streaks.get(userId) || { current: 0, longest: 0, lastPostDate: null };
  return { ok: true, userId, ...streak };
}

// ── Social Commerce ──────────────────────────────────────────────────────

export function postAuthorId(STATE, postId, db) {
  if (!postId) return null;
  const social = getSocialState(STATE || {});
  const post = social.posts.get(postId);
  if (post?.userId) return post.userId;
  const database = db || STATE?.db;
  if (!database || typeof database.prepare !== "function") return null;
  const queries = [
    "SELECT COALESCE(user_id, author_id) AS uid FROM social_posts WHERE id = ?",
    "SELECT author_id AS uid FROM social_group_posts WHERE post_id = ?",
  ];
  for (const sql of queries) {
    try {
      const row = database.prepare(sql).get(postId);
      if (row?.uid) return row.uid;
    } catch { /* table may not exist in this process */ }
  }
  return null;
}

export function userOwnsListing(db, userId, listingId) {
  if (!db || typeof db.prepare !== "function" || !userId || !listingId) return false;
  const queries = [
    "SELECT owner_user_id AS owner FROM marketplace_listings WHERE id = ?",
    "SELECT seller_id AS owner FROM marketplace_economy_listings WHERE id = ?",
  ];
  for (const sql of queries) {
    try {
      const row = db.prepare(sql).get(listingId);
      if (row && row.owner === userId) return true;
    } catch { /* table may not exist */ }
  }
  return false;
}

export function tagListing(STATE, { postId, listingId, userId, db } = {}) {
  const social = getSocialState(STATE);
  const post = social.posts.get(postId);
  const authorId = post?.userId || postAuthorId(STATE, postId, db);
  if (!authorId) return { ok: false, status: 404, error: "Post not found" };
  if (!userId || authorId !== userId) return { ok: false, status: 403, error: "Only the post author can tag a listing" };
  const database = db || STATE?.db;
  if (!userOwnsListing(database, userId, listingId)) {
    return { ok: false, status: 403, error: "You do not own this listing" };
  }
  if (!social.postListings.has(postId)) social.postListings.set(postId, new Set());
  social.postListings.get(postId).add(listingId);
  return { ok: true, postId, listingId };
}

export function getPostSales(STATE, postId, viewerId = null) {
  const social = getSocialState(STATE);
  if (!requireVisiblePost(STATE, postId, viewerId)) return { ok: false, error: "Post not found" };
  const clicks = social.postClicks.get(postId) || 0;
  const listings = social.postListings.get(postId);
  return { ok: true, postId, clicks, linkedListings: listings ? Array.from(listings) : [] };
}

export function getPostEarnings(STATE, postId, viewerId = null) {
  const social = getSocialState(STATE);
  if (!requireVisiblePost(STATE, postId, viewerId)) return { ok: false, error: "Post not found" };
  const earnings = social.postEarnings.get(postId) || 0;
  return { ok: true, postId, earnings };
}

// ── Pin Posts ────────────────────────────────────────────────────────────

export function pinPost(STATE, { userId, postId }) {
  const social = getSocialState(STATE);
  const post = requireVisiblePost(STATE, postId, userId);
  if (!post) return { ok: false, error: "Post not found" };
  if (post.userId !== userId) return { ok: false, error: "Only owner can pin" };

  // Count currently pinned
  let pinnedCount = 0;
  for (const p of social.posts.values()) {
    if (p.userId === userId && p.isPinned) pinnedCount++;
  }
  if (pinnedCount >= 3 && !post.isPinned) return { ok: false, error: "Maximum 3 pinned posts" };

  post.isPinned = true;
  scheduleSocialFlush(STATE);
  return { ok: true, postId };
}

export function unpinPost(STATE, { userId, postId }) {
  const social = getSocialState(STATE);
  const post = requireVisiblePost(STATE, postId, userId);
  if (!post) return { ok: false, error: "Post not found" };
  if (post.userId !== userId) return { ok: false, error: "Only owner can unpin" };
  post.isPinned = false;
  scheduleSocialFlush(STATE);
  return { ok: true, postId };
}

export function getPinnedPosts(STATE, userId, viewerId = null) {
  const social = getSocialState(STATE);
  const pinned = [];
  for (const post of social.posts.values()) {
    if (post.userId === userId && post.isPinned && canViewPost(viewerId, post, STATE)) pinned.push(serializePost(post));
  }
  return { ok: true, posts: pinned };
}

// ── Watch Time ───────────────────────────────────────────────────────────

export function recordWatchTime(STATE, { userId, postId, durationMs }) {
  const social = getSocialState(STATE);
  const post = requireVisiblePost(STATE, postId, userId);
  if (!post) return { ok: false, error: "Post not found" };
  post.watchTimeMs += (durationMs || 0);
  post.viewCount++;
  const uniqueViewCount = noteViewer(post, userId);
  return { ok: true, postId, watchTimeMs: post.watchTimeMs, viewCount: post.viewCount, uniqueViewCount };
}

// ── Scheduled Posts ──────────────────────────────────────────────────────

export function schedulePost(STATE, { userId, postData, scheduledAt }) {
  const social = getSocialState(STATE);
  if (!scheduledAt) return { ok: false, error: "scheduledAt required" };
  const id = nextId("sched");
  social.scheduledPosts.set(id, { id, userId, postData: postData || {}, scheduledAt, createdAt: new Date().toISOString() });
  return { ok: true, scheduledPostId: id, scheduledAt };
}

export function getScheduledPosts(STATE, userId) {
  const social = getSocialState(STATE);
  const posts = [];
  for (const sp of social.scheduledPosts.values()) {
    if (sp.userId === userId) posts.push({ id: sp.id, postData: sp.postData, scheduledAt: sp.scheduledAt, createdAt: sp.createdAt });
  }
  posts.sort((a, b) => new Date(a.scheduledAt).getTime() - new Date(b.scheduledAt).getTime());
  return { ok: true, scheduledPosts: posts };
}

export function cancelScheduledPost(STATE, { userId, postId }) {
  const social = getSocialState(STATE);
  const sp = social.scheduledPosts.get(postId);
  if (!sp) return { ok: false, error: "Scheduled post not found" };
  if (sp.userId !== userId) return { ok: false, error: "Only owner can cancel" };
  social.scheduledPosts.delete(postId);
  return { ok: true, postId };
}

export function processScheduledPosts(STATE) {
  const social = getSocialState(STATE);
  const now = Date.now();
  const published = [];

  for (const [id, sp] of social.scheduledPosts) {
    if (new Date(sp.scheduledAt).getTime() <= now) {
      const result = createPost(STATE, { userId: sp.userId, ...sp.postData });
      if (result.ok) published.push(result.post.id);
      social.scheduledPosts.delete(id);
    }
  }

  return { ok: true, published, count: published.length };
}

// ── Trending Engine (velocity-based) ────────────────────────────────────

function getTrendingScore(post) {
  const likes = reactionTotalOf(post);
  const comments = asList(post?.comments).length;
  const saves = bookmarkCountOf(post);
  const shares = asList(post?.shares).length;
  const raw = likes * 3 + comments * 5 + saves * 4 + shares * 8;
  const hoursOld = (Date.now() - new Date(post.createdAt).getTime()) / 3600000;
  const recencyBoost = 1 / (hoursOld + 1);
  return raw * recencyBoost;
}

export function getTrendingContent(STATE, { limit = 20, hours = 24, viewerId = null } = {}) {
  const social = getSocialState(STATE);
  const cutoff = Date.now() - hours * 3600000;
  const scored = [];

  for (const post of social.posts.values()) {
    if (new Date(post.createdAt).getTime() < cutoff) continue;
    if (!canViewPost(viewerId, post, STATE)) continue;
    scored.push({ post: serializePost(post), score: getTrendingScore(post) });
  }

  scored.sort((a, b) => b.score - a.score);
  return { ok: true, content: scored.slice(0, limit).map(s => ({ ...s.post, trendScore: Math.round(s.score * 100) / 100 })) };
}

export function getTrendingCreators(STATE, { limit = 20, days = 7, viewerId = null } = {}) {
  const social = getSocialState(STATE);
  const cutoff = Date.now() - days * 86400000;
  const creatorStats = new Map();

  for (const post of social.posts.values()) {
    if (new Date(post.createdAt).getTime() < cutoff) continue;
    if (!canViewPost(viewerId, post, STATE)) continue;
    const uid = post.userId;
    if (!creatorStats.has(uid)) {
      creatorStats.set(uid, { userId: uid, engagementTotal: 0, postCount: 0, followerGrowth: 0 });
    }
    const cs = creatorStats.get(uid);
    cs.engagementTotal += getTrendingScore(post);
    cs.postCount++;
  }

  // Estimate follower growth: followers whose profile was created recently
  for (const [uid, cs] of creatorStats) {
    const followerSet = social.followers.get(uid) || new Set();
    cs.followerCount = followerSet.size;
    let recentFollowers = 0;
    for (const fid of followerSet) {
      const p = social.profiles.get(fid);
      if (p && new Date(p.createdAt).getTime() > cutoff) recentFollowers++;
    }
    cs.followerGrowth = recentFollowers;
  }

  const scored = Array.from(creatorStats.values()).map(cs => ({
    ...cs,
    displayName: social.profiles.get(cs.userId)?.displayName || cs.userId,
    score: cs.engagementTotal + cs.followerGrowth * 10,
  }));

  scored.sort((a, b) => b.score - a.score);
  return { ok: true, creators: scored.slice(0, limit) };
}

export function getTrendingDomains(STATE, { limit = 10, viewerId = null } = {}) {
  const social = getSocialState(STATE);
  const cutoff = Date.now() - 24 * 3600000;
  const domainScores = new Map();

  for (const post of social.posts.values()) {
    if (new Date(post.createdAt).getTime() < cutoff) continue;
    if (!canViewPost(viewerId, post, STATE)) continue;
    const score = getTrendingScore(post);
    for (const tag of (post.tags || [])) {
      domainScores.set(tag, (domainScores.get(tag) || 0) + score);
    }
  }

  const sorted = Array.from(domainScores.entries())
    .map(([domain, score]) => ({ domain, score: Math.round(score * 100) / 100 }))
    .sort((a, b) => b.score - a.score)
    .slice(0, limit);

  // For each domain, grab top 3 posts
  const result = sorted.map(d => {
    const domainPosts = [];
    for (const post of social.posts.values()) {
      if (new Date(post.createdAt).getTime() < cutoff) continue;
      if (!canViewPost(viewerId, post, STATE)) continue;
      if ((post.tags || []).includes(d.domain)) {
        domainPosts.push({ post: serializePost(post), score: getTrendingScore(post) });
      }
    }
    domainPosts.sort((a, b) => b.score - a.score);
    return { ...d, topPosts: domainPosts.slice(0, 3).map(p => p.post) };
  });

  return { ok: true, domains: result };
}

// Posts, replies, and shares by people the caller follows. Cursor is the
// id of the last item already seen. Private and followers-only posts stay
// hidden unless the caller may see them.
export function getFollowingActivity(STATE, userId, { limit = 40, cursor = null } = {}) {
  if (!userId) return { ok: false, status: 401, error: "auth required" };
  const social = getSocialState(STATE);
  const followSet = social.follows.get(userId) || new Set();
  const items = [];
  const nameOf = (id) => {
    const profile = social.profiles.get(id);
    const who = publicIdentity(id, profile);
    return who.username || who.displayName || id;
  };
  for (const post of social.posts.values()) {
    if (post.expiresAt && new Date(post.expiresAt).getTime() < Date.now()) continue;
    if (followSet.has(post.userId) && canViewPost(userId, post, STATE)) {
      items.push({
        id: post.id,
        userId: post.userId,
        username: nameOf(post.userId),
        kind: "post",
        content: post.content || "",
        createdAt: post.createdAt,
      });
    }
    for (const comment of post.comments || []) {
      if (!followSet.has(comment.userId)) continue;
      if (!canViewPost(userId, post, STATE)) continue;
      items.push({
        id: comment.id,
        userId: comment.userId,
        username: nameOf(comment.userId),
        kind: "comment",
        content: comment.content || "",
        createdAt: comment.createdAt,
      });
    }
    for (const share of post.shares || []) {
      if (!followSet.has(share.userId)) continue;
      if (!canViewPost(userId, post, STATE)) continue;
      items.push({
        id: `share_${post.id}_${share.userId}_${share.timestamp}`,
        userId: share.userId,
        username: nameOf(share.userId),
        kind: "share",
        content: share.commentary || "",
        createdAt: share.timestamp,
      });
    }
  }
  items.sort((a, b) => String(b.createdAt).localeCompare(String(a.createdAt)) || String(b.id).localeCompare(String(a.id)));
  let start = 0;
  if (cursor) {
    const idx = items.findIndex((item) => item.id === cursor);
    start = idx >= 0 ? idx + 1 : items.length;
  }
  const pageLimit = Math.min(Math.max(Number(limit) || 40, 1), 100);
  const page = items.slice(start, start + pageLimit);
  const nextCursor = start + pageLimit < items.length && page.length ? page[page.length - 1].id : null;
  return { ok: true, items: page, nextCursor };
}

// Shape CreatorAnalytics.tsx can render. Sections with no stored source
// (per-day series, earnings, followers lost) are omitted, not zero-filled.
export function getCreatorAnalyticsView(STATE, userId) {
  const raw = getCreatorAnalytics(STATE, userId, userId);
  const social = getSocialState(STATE);
  const topPosts = (raw.topPosts || []).map((entry) => {
    const post = social.posts.get(entry.postId);
    let reactions = 0;
    if (post?.reactions) {
      for (const users of post.reactions.values()) reactions += users.size;
    }
    return {
      postId: entry.postId,
      title: entry.title || (post?.content || "").slice(0, 80) || "Post",
      engagementScore: entry.engagement,
      reactions,
      comments: post?.comments?.length || 0,
      shares: post?.shares?.length || 0,
      createdAt: post?.createdAt || null,
    };
  });
  const bestPostingHours = (raw.bestPostingHours || [])
    .filter((hour) => hour.count > 0)
    .map((hour) => ({ hour: hour.hour, score: hour.count }));
  const contentBreakdown = Object.entries(raw.contentBreakdown || {})
    .filter(([, count]) => count > 0)
    .map(([mediaType, count]) => ({ mediaType, count }));
  const gained = raw.followerGrowth || 0;
  return {
    ok: true,
    overview: {
      engagementRate: raw.engagementRate,
      totalReach: raw.totalReach,
      followerCount: raw.totalFollowers,
      followerTrend: gained > 0 ? "up" : "stable",
    },
    topPosts,
    bestPostingHours,
    contentBreakdown,
    followerGrowth: { gained, net: gained, period: "30d" },
    totalPosts: raw.totalPosts,
  };
}

// Account erasure. Posts and the profile are removed. DM rows are
// tombstoned the same way direct_messages is anonymized, so the other
// person keeps the thread without a live user id attached.
export function purgeUserSocialRecords(STATE, userId, { tombstone } = {}) {
  if (!STATE || !userId) return { ok: false, error: "userId required" };
  const tomb = tombstone || `deleted_${userId}`;
  const social = getSocialState(STATE);
  let deleted = 0;
  let anonymized = 0;

  if (social.profiles.delete(userId)) deleted++;
  const following = social.follows.get(userId);
  if (following) {
    for (const other of following) social.followers.get(other)?.delete(userId);
    social.follows.delete(userId);
    deleted++;
  }
  for (const set of social.follows.values()) set.delete(userId);
  social.followers.delete(userId);

  for (const [id, post] of [...social.posts]) {
    if (post.userId === userId) {
      social.posts.delete(id);
      social.postListings.delete(id);
      deleted++;
      continue;
    }
    if (Array.isArray(post.comments)) {
      const before = post.comments.length;
      post.comments = post.comments.filter((comment) => comment.userId !== userId);
      deleted += before - post.comments.length;
    }
    if (post.reactions) {
      for (const users of post.reactions.values()) users.delete(userId);
    }
    post.bookmarks?.delete?.(userId);
  }
  if (social.notifications.delete(userId)) deleted++;
  for (const list of social.notifications.values()) {
    for (const note of list) {
      if (note.fromUserId === userId) note.fromUserId = tomb;
    }
  }
  for (const msgs of social.messages.values()) {
    for (const msg of msgs) {
      if (msg.fromUserId === userId) { msg.fromUserId = tomb; anonymized++; }
      if (msg.toUserId === userId) { msg.toUserId = tomb; anonymized++; }
    }
  }

  const lens = STATE.socialLens;
  if (lens && typeof lens === "object") {
    if (lens.posts instanceof Map) {
      for (const [id, post] of [...lens.posts]) {
        if (post?.userId === userId) { lens.posts.delete(id); deleted++; }
      }
    }
    if (lens.replies instanceof Map) {
      for (const [postId, list] of lens.replies) {
        if (!Array.isArray(list)) continue;
        const next = list.filter((reply) => reply?.userId !== userId);
        deleted += list.length - next.length;
        lens.replies.set(postId, next);
      }
    }
    if (lens.reactions instanceof Map) {
      for (const map of lens.reactions.values()) {
        if (map instanceof Map && map.delete(userId)) deleted++;
      }
    }
    if (lens.reposts instanceof Map) {
      for (const set of lens.reposts.values()) {
        if (set instanceof Set) set.delete(userId);
      }
    }
    if (lens.dms instanceof Map) {
      for (const thread of lens.dms.values()) {
        if (!thread?.participants?.includes(userId)) continue;
        thread.participants = thread.participants.map((id) => (id === userId ? tomb : id));
        for (const msg of thread.messages || []) {
          if (msg.from === userId) { msg.from = tomb; anonymized++; }
        }
      }
    }
    if (lens.moderation instanceof Map) lens.moderation.delete(userId);
    if (lens.reports instanceof Map) {
      for (const [id, report] of [...lens.reports]) {
        if (report?.reporterId === userId) lens.reports.delete(id);
      }
    }
  }
  return { ok: true, deleted, anonymized, tombstone: tomb };
}
