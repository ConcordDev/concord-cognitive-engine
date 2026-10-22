/**
 * Phase 4 feeds on the canonical store.
 * Lists, packs, mutes of a post or author, and recent searches live on the
 * profile object, which the phase 2 snapshot already writes.
 */
import { canonicalSocial, getFollowingFeed, getForYouFeed, followUser, createNotification, isBlocked, canViewPost } from "../emergent/social-layer.js";
import { scheduleSocialFlush } from "./social-persist.js";
import { textHitsKeywordMute } from "./social-safety.js";

function profileOf(STATE, userId) {
  const social = canonicalSocial(STATE);
  const profile = social.profiles.get(userId);
  if (!profile) return null;
  return profile;
}

function isMuted(STATE, viewerId, authorId) {
  const mod = STATE?.socialLens?.moderation;
  if (!mod || !viewerId || !authorId) return false;
  const bucket = mod instanceof Map ? mod.get(viewerId) : mod[viewerId];
  const muted = bucket?.muted;
  if (muted instanceof Set) return muted.has(authorId);
  return Array.isArray(muted) && muted.includes(authorId);
}

function shapeForViewer(STATE, viewerId, row) {
  if (!row) return null;
  const social = canonicalSocial(STATE);
  const stored = social.posts.get(row.id) || row;
  const profile = social.profiles.get(viewerId);
  const text = `${stored.content || ""} ${stored.body || ""} ${(stored.hashtags || []).join(" ")} ${(stored.tags || []).join(" ")}`;
  if (stored.userId !== viewerId && textHitsKeywordMute(profile, text)) return null;
  const out = { ...row };
  if (stored.listing) out.listing = stored.listing;
  const hide = stored.sensitive === true && stored.userId !== viewerId && profile?.showSensitive !== true;
  if (hide) {
    out.mediaUrl = null;
    out.media = [];
    out.sensitiveHidden = true;
  }
  return out;
}

function visiblePost(STATE, post, viewerId) {
  if (!canViewPost(viewerId, post, STATE)) return false;
  if (isMuted(STATE, viewerId, post.userId)) return false;
  return true;
}

function whyFor(STATE, userId, post) {
  const social = canonicalSocial(STATE);
  const reasons = ["Recent"];
  if (social.follows.get(userId)?.has(post.userId)) reasons.push("You follow the author");
  const interests = new Set(social.profiles.get(userId)?.interests || []);
  const tags = [...(post.tags || []), ...(post.hashtags || [])].map((t) => String(t).replace(/^#/, "").toLowerCase());
  if (tags.some((tag) => interests.has(tag))) reasons.push("Matches a topic you follow");
  const reactions = post.reactions instanceof Map ? [...post.reactions.values()].reduce((n, set) => n + (set?.size || 0), 0) : 0;
  const comments = Array.isArray(post.comments) ? post.comments.length : (post.commentCount || 0);
  if (reactions + comments > 0) reasons.push("People reacted or replied");
  return reasons;
}

export function followingFeed(STATE, userId, { limit = 30, offset = 0 } = {}) {
  const result = getFollowingFeed(STATE, userId, { limit, offset });
  const posts = (result.posts || [])
    .filter((post) => !isMuted(STATE, userId, post.userId) && !isBlocked(STATE, userId, post.userId))
    .map((post) => shapeForViewer(STATE, userId, post))
    .filter(Boolean);
  return { ok: true, posts, total: posts.length };
}

export function forYouFeed(STATE, userId, { limit = 30, offset = 0 } = {}) {
  const profile = profileOf(STATE, userId);
  const hidden = new Set(profile?.hiddenPostIds || []);
  const less = new Set(profile?.showLessAuthors || []);
  const result = getForYouFeed(STATE, userId, { limit: limit + hidden.size + less.size + offset, offset: 0 });
  const social = canonicalSocial(STATE);
  const posts = [];
  for (const row of result.posts || []) {
    if (hidden.has(row.id) || less.has(row.userId)) continue;
    if (isMuted(STATE, userId, row.userId) || isBlocked(STATE, userId, row.userId)) continue;
    const shaped = shapeForViewer(STATE, userId, row);
    if (!shaped) continue;
    const stored = social.posts.get(row.id);
    posts.push({ ...shaped, why: whyFor(STATE, userId, stored || row) });
  }
  return { ok: true, posts: posts.slice(offset, offset + limit), total: posts.length };
}

export function feedbackPost(STATE, userId, { postId, action }) {
  const profile = profileOf(STATE, userId);
  if (!profile) return { ok: false, status: 404, error: "Create a profile first" };
  const social = canonicalSocial(STATE);
  const post = social.posts.get(postId);
  if (!post) return { ok: false, status: 404, error: "Post not found" };
  if (action === "not-interested") {
    profile.hiddenPostIds = [...new Set([...(profile.hiddenPostIds || []), postId])].slice(-500);
  } else if (action === "less") {
    profile.showLessAuthors = [...new Set([...(profile.showLessAuthors || []), post.userId])].slice(-200);
  } else {
    return { ok: false, status: 400, error: "action must be less or not-interested" };
  }
  scheduleSocialFlush(STATE);
  return { ok: true, action, postId };
}

export function setFeedPreference(STATE, userId, feedDefault) {
  const profile = profileOf(STATE, userId);
  if (!profile) return { ok: false, status: 404, error: "Create a profile first" };
  if (!["following", "forYou"].includes(feedDefault)) {
    return { ok: false, status: 400, error: "feedDefault must be following or forYou" };
  }
  profile.feedDefault = feedDefault;
  scheduleSocialFlush(STATE);
  return { ok: true, feedDefault };
}

function lists(profile) {
  if (!Array.isArray(profile.lists)) profile.lists = [];
  return profile.lists;
}

export function createList(STATE, userId, name) {
  const profile = profileOf(STATE, userId);
  if (!profile) return { ok: false, status: 404, error: "Create a profile first" };
  const title = String(name || "").trim();
  if (!title) return { ok: false, status: 400, error: "name required" };
  const list = { id: `list_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`, name: title, memberIds: [] };
  lists(profile).push(list);
  scheduleSocialFlush(STATE);
  return { ok: true, list };
}

export function addListMember(STATE, userId, listId, memberId) {
  const profile = profileOf(STATE, userId);
  if (!profile) return { ok: false, status: 404, error: "Create a profile first" };
  const list = lists(profile).find((row) => row.id === listId);
  if (!list) return { ok: false, status: 404, error: "list not found" };
  if (!memberId || memberId === userId) return { ok: false, status: 400, error: "member required" };
  if (!list.memberIds.includes(memberId)) list.memberIds.push(memberId);
  scheduleSocialFlush(STATE);
  return { ok: true, list };
}

export function listFeed(STATE, userId, listId) {
  const profile = profileOf(STATE, userId);
  if (!profile) return { ok: false, status: 404, error: "Create a profile first" };
  const list = lists(profile).find((row) => row.id === listId);
  if (!list) return { ok: false, status: 404, error: "list not found" };
  const social = canonicalSocial(STATE);
  const members = new Set(list.memberIds);
  const posts = [...social.posts.values()]
    .filter((post) => members.has(post.userId) && visiblePost(STATE, post, userId))
    .sort((a, b) => String(b.createdAt).localeCompare(String(a.createdAt)));
  return { ok: true, list, posts: posts.map((post) => ({ id: post.id, userId: post.userId, content: post.content || post.body || "", createdAt: post.createdAt })) };
}

export function getLists(STATE, userId) {
  const profile = profileOf(STATE, userId);
  if (!profile) return { ok: false, status: 404, error: "Create a profile first" };
  return { ok: true, lists: lists(profile), feedDefault: profile.feedDefault || "following" };
}

function packs(profile) {
  if (!Array.isArray(profile.packs)) profile.packs = [];
  return profile.packs;
}

export function createPack(STATE, userId, { name, people, feeds }) {
  const profile = profileOf(STATE, userId);
  if (!profile) return { ok: false, status: 404, error: "Create a profile first" };
  const members = [...new Set((people || []).map(String).filter(Boolean))];
  const topics = [...new Set((feeds || []).map((t) => String(t).replace(/^#/, "").trim().toLowerCase()).filter(Boolean))];
  if (members.length > 150) return { ok: false, status: 400, error: "a pack can include 150 people" };
  if (topics.length > 3) return { ok: false, status: 400, error: "a pack can include 3 feeds" };
  const pack = {
    id: `pack_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`,
    name: String(name || "Starter pack").trim() || "Starter pack",
    people: members,
    feeds: topics,
  };
  packs(profile).push(pack);
  scheduleSocialFlush(STATE);
  return { ok: true, pack };
}

export function joinPack(STATE, userId, packId, ownerId) {
  const owner = profileOf(STATE, ownerId);
  if (!owner) return { ok: false, status: 404, error: "pack not found" };
  const pack = packs(owner).find((row) => row.id === packId);
  if (!pack) return { ok: false, status: 404, error: "pack not found" };
  let followed = 0;
  for (const memberId of pack.people) {
    if (memberId === userId) continue;
    if (isBlocked(STATE, userId, memberId)) continue;
    const result = followUser(STATE, userId, memberId);
    if (result.ok) followed += 1;
  }
  createNotification(STATE, {
    userId: ownerId,
    type: "pack_join",
    fromUserId: userId,
    content: `${userId} joined via your pack`,
  });
  return { ok: true, followed, feeds: pack.feeds };
}

export function followHashtag(STATE, userId, tag, follow = true) {
  const profile = profileOf(STATE, userId);
  if (!profile) return { ok: false, status: 404, error: "Create a profile first" };
  const clean = String(tag || "").replace(/^#/, "").trim().toLowerCase();
  if (!clean) return { ok: false, status: 400, error: "tag required" };
  const current = new Set(profile.followedHashtags || []);
  if (follow) current.add(clean); else current.delete(clean);
  profile.followedHashtags = [...current];
  scheduleSocialFlush(STATE);
  return { ok: true, tag: clean, following: follow };
}

export function hashtagPosts(STATE, userId, tag) {
  const clean = String(tag || "").replace(/^#/, "").trim().toLowerCase();
  const social = canonicalSocial(STATE);
  const posts = [...social.posts.values()].filter((post) => {
    const tags = [...(post.hashtags || []), ...(post.tags || [])].map((t) => String(t).replace(/^#/, "").toLowerCase());
    return tags.includes(clean) && visiblePost(STATE, post, userId);
  });
  posts.sort((a, b) => String(b.createdAt).localeCompare(String(a.createdAt)));
  const following = !!(profileOf(STATE, userId)?.followedHashtags || []).includes(clean);
  return {
    ok: true,
    tag: clean,
    following,
    posts: posts
      .map((post) => shapeForViewer(STATE, userId, post))
      .filter(Boolean)
      .map((post) => ({ id: post.id, userId: post.userId, content: post.content || post.body || "", createdAt: post.createdAt, mediaUrl: post.mediaUrl || null, sensitiveHidden: !!post.sensitiveHidden, listing: post.listing || null })),
  };
}

function rememberSearch(profile, query) {
  const recent = [query, ...(profile.recentSearches || []).filter((q) => q !== query)];
  profile.recentSearches = recent.slice(0, 10);
}

function ftsSearch(db, posts, query) {
  db.exec("CREATE VIRTUAL TABLE IF NOT EXISTS social_post_fts USING fts5(post_id UNINDEXED, body)");
  db.prepare("DELETE FROM social_post_fts").run();
  const insert = db.prepare("INSERT INTO social_post_fts (post_id, body) VALUES (?, ?)");
  for (const post of posts) {
    insert.run(post.id, `${post.content || post.body || ""} ${(post.hashtags || []).join(" ")}`);
  }
  const safe = query.replace(/["*]/g, " ").trim();
  if (!safe) return [];
  return db.prepare("SELECT post_id FROM social_post_fts WHERE social_post_fts MATCH ? LIMIT 30").all(`"${safe}"`).map((row) => row.post_id);
}

export function searchSocial(STATE, userId, query) {
  const q = String(query || "").trim();
  if (q.length < 2) return { ok: true, people: [], posts: [], hashtags: [], recent: profileOf(STATE, userId)?.recentSearches || [], engine: "scan" };
  const profile = profileOf(STATE, userId);
  if (profile) {
    rememberSearch(profile, q.toLowerCase());
    scheduleSocialFlush(STATE);
  }
  const needle = q.toLowerCase();
  const social = canonicalSocial(STATE);
  const people = [];
  for (const row of social.profiles.values()) {
    if (row.isPublic === false && row.userId !== userId) continue;
    if (isBlocked(STATE, userId, row.userId)) continue;
    const handle = `${row.username || ""} ${row.displayName || ""}`.toLowerCase();
    if (handle.includes(needle)) people.push({ id: row.userId, username: row.username || row.displayName || row.userId, displayName: row.displayName || row.userId });
  }
  const posts = [...social.posts.values()].filter((post) => visiblePost(STATE, post, userId));
  let engine = "scan";
  let matched = posts.filter((post) => `${post.content || ""} ${post.body || ""} ${(post.hashtags || []).join(" ")}`.toLowerCase().includes(needle));
  if (STATE?.db && typeof STATE.db.exec === "function") {
    try {
      const ids = new Set(ftsSearch(STATE.db, posts, q));
      matched = posts.filter((post) => ids.has(post.id));
      engine = "fts5";
    } catch { engine = "scan"; }
  }
  const counts = new Map();
  for (const post of posts) {
    for (const tag of [...(post.hashtags || []), ...(post.tags || [])]) {
      const clean = String(tag).replace(/^#/, "").toLowerCase();
      if (!clean.includes(needle)) continue;
      counts.set(clean, (counts.get(clean) || 0) + 1);
    }
  }
  return {
    ok: true,
    people: people.slice(0, 20),
    posts: matched
      .map((post) => shapeForViewer(STATE, userId, post))
      .filter(Boolean)
      .slice(0, 30)
      .map((post) => ({ id: post.id, userId: post.userId, content: post.content || post.body || "", createdAt: post.createdAt, mediaUrl: post.mediaUrl || null, sensitiveHidden: !!post.sensitiveHidden })),
    hashtags: [...counts.entries()].map(([tag, count]) => ({ tag, count })),
    recent: profile?.recentSearches || [],
    engine,
  };
}
