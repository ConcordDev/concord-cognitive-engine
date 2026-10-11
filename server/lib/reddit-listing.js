// server/lib/reddit-listing.js
//
// Server-side read of public Reddit listing JSON for the lens community
// panels. The browser must not call reddit.com itself: that request is
// cross-origin (CORS / unauthenticated-API blocks), fails in real browsers,
// and sends the user's IP to Reddit.
//
// The URL is never taken from the caller. `sub`, `sort`, and `window` are
// checked against fixed allowlists and then interpolated into one template:
//   https://www.reddit.com/r/<sub>/<sort>.json?t=<window>&limit=<1-25>
// A `url` query parameter is rejected by the route before this runs.

import { fetchJsonWithTimeout } from "./external-fetch.js";

export const REDDIT_LISTING_ORIGIN = "https://www.reddit.com";
export const REDDIT_USER_AGENT = "ConcordOS/1.0 (community-listing; +https://concord-os.org)";

const WINDOWS = new Set(["hour", "day", "week", "month", "year", "all"]);
const SORTS = new Set(["top", "hot", "new", "rising"]);
const MAX_ATTEMPTS = 3;
const DEFAULT_TTL_MS = 5 * 60 * 1000;
const DEFAULT_TIMEOUT_MS = 4000;
const MAX_CACHE_ENTRIES = 100;

/** Subreddits the lens panels already offer. Not a user-supplied URL. */
export const ALLOWED_SUBREDDITS = new Set([
  "3Dprinting",
  "activitypub",
  "AnimalHealth",
  "arduino",
  "art",
  "AskAcademia",
  "AskaContractor",
  "AskaLawyer",
  "AskHistorians",
  "AskLE",
  "AskMechanics",
  "AskPhilosophy",
  "AskReddit",
  "AskScience",
  "AskVet",
  "AutoInsurance",
  "beyondthebump",
  "BlueskySocial",
  "bodyweightfitness",
  "Bricklayer",
  "Buddhism",
  "BulletJournal",
  "careerguidance",
  "centuryhomes",
  "changemyview",
  "CNC",
  "Competitiveoverwatch",
  "Concrete",
  "Construction",
  "consulting",
  "Cops",
  "copywriting",
  "creativity",
  "daddit",
  "decidingtobebetter",
  "DecidingToBeBetter",
  "degoogle",
  "Design",
  "DIY",
  "DotA2",
  "Electricians",
  "EndFPTP",
  "Entrepreneur",
  "esports",
  "EstatePlanning",
  "estatesales",
  "fashion",
  "fediverse",
  "femalefashionadvice",
  "Fitness",
  "flexibility",
  "folklore",
  "freelance",
  "Games",
  "gaming",
  "getdisciplined",
  "getmotivated",
  "GetMotivated",
  "getting_over_it",
  "Ghosts",
  "Ghoststories",
  "governmentnonsense",
  "graphic_design",
  "HealthInsurance",
  "HomeImprovement",
  "HVAC",
  "hvacadvice",
  "imaginarymaps",
  "IndieGaming",
  "industrialdesign",
  "IndustrialDesign",
  "inheritance",
  "Insurance",
  "Journaling",
  "leagueoflegends",
  "logistics",
  "machinists",
  "maker",
  "malefashionadvice",
  "manufacturing",
  "mapmaking",
  "marketing",
  "Masonry",
  "Mastodon",
  "Meditation",
  "mentalhealth",
  "mentorship",
  "metalworking",
  "Mindfulness",
  "Mommit",
  "NeutralPolitics",
  "nosleep",
  "NoStupidQuestions",
  "opsec",
  "Paranormal",
  "Parenting",
  "patientgamers",
  "personalfinance",
  "philosophy",
  "Plumbing",
  "policeuk",
  "PoliticalDiscussion",
  "powerlifting",
  "privacy",
  "PrivacyGuides",
  "procurement",
  "productivity",
  "ProtectAndServe",
  "raspberry_pi",
  "Refrigeration",
  "remodeling",
  "rpg",
  "running",
  "ScienceBasedParenting",
  "self",
  "selfhosted",
  "selfimprovement",
  "SEO",
  "sewing",
  "shipping",
  "Skookum",
  "smallbusiness",
  "somatics",
  "somethingimade",
  "startups",
  "StickWelding",
  "Stoicism",
  "stonemasonry",
  "streetwear",
  "supplychain",
  "TIG",
  "Truckers",
  "TrueAskReddit",
  "truegaming",
  "Veterinary",
  "vettech",
  "Welding",
  "Wellness",
  "WeWantPlates",
  "woodworking",
  "worldbuilding",
  "yoga",
]);

const _cache = new Map();

function fail(code) {
  const err = new Error(code);
  err.code = code;
  return err;
}

export function clearRedditListingCache() {
  _cache.clear();
}

/**
 * Build the single allowlisted listing URL. Throws `invalid_subreddit`,
 * `invalid_window`, or `invalid_sort` — it does not accept a URL string.
 */
export function buildRedditListingUrl({ sub, window: windowKey = "week", sort = "top", limit = 25 } = {}) {
  if (typeof sub !== "string" || !ALLOWED_SUBREDDITS.has(sub)) throw fail("invalid_subreddit");
  if (typeof windowKey !== "string" || !WINDOWS.has(windowKey)) throw fail("invalid_window");
  if (typeof sort !== "string" || !SORTS.has(sort)) throw fail("invalid_sort");
  const n = Number(limit);
  const lim = Number.isFinite(n) ? Math.max(1, Math.min(25, Math.trunc(n))) : 25;
  return `${REDDIT_LISTING_ORIGIN}/r/${sub}/${sort}.json?t=${windowKey}&limit=${lim}`;
}

function safePermalink(value) {
  const p = typeof value === "string" ? value : "";
  if (!p.startsWith("/r/")) return "";
  if (p.length > 300) return "";
  if (p.includes("..") || p.includes("\\") || p.includes("://") || p.includes("//")) return "";
  return p;
}

function httpsUrl(value, max) {
  if (typeof value !== "string" || !value.startsWith("https://")) return "";
  if (value.length > max) return "";
  return value;
}

function normalizePost(data) {
  if (!data || typeof data !== "object") return null;
  const id = typeof data.id === "string" ? data.id.slice(0, 16) : "";
  const title = typeof data.title === "string" ? data.title.slice(0, 500).trim() : "";
  const permalink = safePermalink(data.permalink);
  if (!id || !title || !permalink) return null;
  const post = {
    id,
    title,
    permalink,
    author: typeof data.author === "string" ? data.author.slice(0, 64) : "",
    score: Number.isFinite(Number(data.score)) ? Number(data.score) : 0,
    num_comments: Number.isFinite(Number(data.num_comments)) ? Number(data.num_comments) : 0,
    created_utc: Number.isFinite(Number(data.created_utc)) ? Number(data.created_utc) : 0,
    link_flair_text: typeof data.link_flair_text === "string" && data.link_flair_text
      ? data.link_flair_text.slice(0, 80)
      : null,
    subreddit: typeof data.subreddit === "string" ? data.subreddit.slice(0, 21) : "",
    thumbnail: httpsUrl(data.thumbnail, 500),
    url: httpsUrl(data.url, 500),
    domain: typeof data.domain === "string" ? data.domain.slice(0, 80) : "",
    total_awards_received: Number.isFinite(Number(data.total_awards_received)) ? Number(data.total_awards_received) : 0,
    selftext: typeof data.selftext === "string" ? data.selftext.slice(0, 280) : "",
  };
  const src = data.preview?.images?.[0]?.source;
  const previewUrl = httpsUrl(typeof src?.url === "string" ? src.url.replace(/&amp;/g, "&") : "", 800);
  if (previewUrl) {
    post.preview = {
      images: [{
        source: {
          url: previewUrl,
          width: Number.isFinite(Number(src.width)) ? Number(src.width) : 0,
          height: Number.isFinite(Number(src.height)) ? Number(src.height) : 0,
        },
      }],
    };
  }
  return post;
}

function postsFromListing(json) {
  if (!json || typeof json !== "object") throw fail("bad_listing");
  if (json.error || json.message === "Forbidden") {
    const status = Number(json.error) || 403;
    throw new Error(`HTTP ${status}`);
  }
  const children = json.data?.children;
  if (!Array.isArray(children)) throw fail("bad_listing");
  const posts = [];
  for (const child of children) {
    const post = normalizePost(child?.data);
    if (post) posts.push(post);
    if (posts.length >= 25) break;
  }
  return posts;
}

function isRetryable(err) {
  if (err?.code === "invalid_subreddit" || err?.code === "invalid_window" || err?.code === "invalid_sort") return false;
  const msg = String(err?.message || err);
  const m = msg.match(/HTTP (\d+)/);
  if (m) {
    const status = Number(m[1]);
    return status === 429 || status >= 500;
  }
  if (err?.code === "bad_listing") return true;
  return true;
}

const FAILURE_COOLDOWN_MS = 15 * 1000;

function remember(cache, key, entry) {
  if (!cache.has(key) && cache.size >= MAX_CACHE_ENTRIES) {
    const oldest = cache.keys().next().value;
    if (oldest !== undefined) cache.delete(oldest);
  }
  cache.set(key, entry);
}

/**
 * Load one allowlisted listing.
 * `input` is `{ sub, window, sort, limit }` — never a URL.
 * `deps` may inject `fetchImpl`, `cache`, `now`, `sleep`, `ttlMs`, `timeoutMs`, `maxAttempts`.
 */
export async function loadRedditListing(input = {}, deps = {}) {
  let url;
  try {
    url = buildRedditListingUrl(input);
  } catch (err) {
    return { ok: false, reason: err.code || "invalid_subreddit" };
  }

  const cache = deps.cache || _cache;
  const now = typeof deps.now === "function" ? deps.now : () => Date.now();
  const sleep = typeof deps.sleep === "function"
    ? deps.sleep
    : (ms) => new Promise((resolve) => setTimeout(resolve, ms));
  const ttlMs = deps.ttlMs ?? DEFAULT_TTL_MS;
  const maxAttempts = deps.maxAttempts ?? MAX_ATTEMPTS;
  const t = now();
  const hit = cache.get(url);
  if (hit && hit.expiresAt > t) {
    if (hit.unavailable) return { ok: false, reason: "community_feed_unavailable" };
    return {
      ok: true,
      posts: structuredClone(hit.posts),
      cached: true,
      stale: hit.stale === true,
      fetchedAt: hit.fetchedAt,
      source: "reddit",
    };
  }

  let lastErr = null;
  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    try {
      const json = await fetchJsonWithTimeout(url, {
        headers: {
          Accept: "application/json",
          "User-Agent": REDDIT_USER_AGENT,
        },
        redirect: "manual",
        fetchImpl: deps.fetchImpl,
      }, deps.timeoutMs ?? DEFAULT_TIMEOUT_MS);
      const posts = postsFromListing(json);
      const fetchedAt = now();
      remember(cache, url, { posts, fetchedAt, expiresAt: fetchedAt + ttlMs, stale: false });
      return { ok: true, posts: structuredClone(posts), cached: false, stale: false, fetchedAt, source: "reddit" };
    } catch (err) {
      lastErr = err;
      if (!isRetryable(err) || attempt === maxAttempts) break;
      await sleep(200 * attempt);
    }
  }

  if (hit && Array.isArray(hit.posts)) {
    const cooldown = Math.min(ttlMs, FAILURE_COOLDOWN_MS);
    hit.stale = true;
    hit.expiresAt = t + cooldown;
    return {
      ok: true,
      posts: structuredClone(hit.posts),
      cached: true,
      stale: true,
      fetchedAt: hit.fetchedAt,
      source: "reddit",
    };
  }
  remember(cache, url, { unavailable: true, fetchedAt: t, expiresAt: t + Math.min(ttlMs, FAILURE_COOLDOWN_MS) });
  return { ok: false, reason: "community_feed_unavailable" };
}
