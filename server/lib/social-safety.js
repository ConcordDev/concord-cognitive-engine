/**
 * Per-action social limits and viewer-side filters.
 * The generic write.social bucket is 120/min. These are tighter.
 * A profile created less than a day ago uses the smaller number.
 */

const hits = new Map();
const WINDOW_MS = 60_000;
const DAY_MS = 24 * 60 * 60 * 1000;

const LIMITS = {
  post: { normal: 20, fresh: 5 },
  comment: { normal: 30, fresh: 10 },
  dm: { normal: 20, fresh: 5 },
  follow: { normal: 30, fresh: 10 },
};

export function isFreshAccount(profile, now = Date.now()) {
  const created = Date.parse(profile?.createdAt || "");
  return Number.isFinite(created) && now - created < DAY_MS;
}

export function assertSocialRate(profile, userId, action, now = Date.now()) {
  const spec = LIMITS[action];
  if (!spec || !userId) return { ok: true };
  const limit = isFreshAccount(profile, now) ? spec.fresh : spec.normal;
  // Key by the profile object so a new profile (each test, each account)
  // does not inherit another profile's window. A missing profile falls
  // back to the user id and the higher limit.
  const owner = profile || userId;
  let buckets = hits.get(owner);
  if (!buckets) {
    buckets = new Map();
    hits.set(owner, buckets);
  }
  const recent = (buckets.get(action) || []).filter((stamp) => now - stamp < WINDOW_MS);
  if (recent.length >= limit) {
    return { ok: false, status: 429, error: `slow down: ${action} limit is ${limit} per minute` };
  }
  recent.push(now);
  buckets.set(action, recent);
  return { ok: true, limit };
}

export function duplicatePost(posts, userId, content, now = Date.now()) {
  const text = String(content || "").trim();
  if (!text || !posts) return false;
  for (const post of posts.values()) {
    if (post.userId !== userId) continue;
    if (String(post.content || post.body || "").trim() !== text) continue;
    const created = Date.parse(post.createdAt || "");
    if (Number.isFinite(created) && now - created < 10 * 60 * 1000) return true;
  }
  return false;
}

export function linkHeavyNewAccount(profile, content) {
  if (!isFreshAccount(profile)) return false;
  const links = String(content || "").match(/https?:\/\//gi);
  return !!(links && links.length >= 3);
}

export function textHitsKeywordMute(profile, text) {
  const words = profile?.keywordMutes;
  if (!Array.isArray(words) || words.length === 0) return false;
  const hay = String(text || "").toLowerCase();
  return words.some((word) => word && hay.includes(String(word).toLowerCase()));
}

/** Test helper. Limits are process-local. */
export function resetSocialRates() {
  hits.clear();
}
