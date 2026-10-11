/**
 * GET /api/community/reddit-listing?sub=&t=&sort=&limit=
 *
 * Same-origin listing for the lens community panels. The handler never
 * fetches a URL the caller supplied. `url` / `uri` / `href` / `target`
 * are rejected. `sub`, `t`, and `sort` are allowlisted in
 * lib/reddit-listing.js and composed into one Reddit listing URL.
 *
 * Sits behind the global auth middleware (not added to the public-read
 * lists). A signed-in browser calls it; an anonymous caller is stopped
 * before this handler.
 */

import { Router } from "express";
import logger from "../logger.js";
import { loadRedditListing } from "../lib/reddit-listing.js";

const USER_URL_KEYS = ["url", "uri", "href", "target"];

function oneString(value, fallback = null) {
  if (value == null || value === "") return fallback;
  if (typeof value !== "string") return undefined;
  return value;
}

export function createRedditListingRouter({ load = loadRedditListing } = {}) {
  const router = Router();

  router.get("/reddit-listing", async (req, res) => {
    const query = req.query || {};
    if (USER_URL_KEYS.some((key) => query[key] != null && query[key] !== "")) {
      return res.status(400).json({ ok: false, reason: "url_not_accepted" });
    }

    const sub = oneString(query.sub, "");
    const windowKey = oneString(query.t, "week");
    const sort = oneString(query.sort, "top");
    if (sub === undefined || windowKey === undefined || sort === undefined) {
      return res.status(400).json({ ok: false, reason: "invalid_subreddit" });
    }

    try {
      const result = await load({ sub, window: windowKey, sort, limit: query.limit });
      if (!result?.ok) {
        const reason = result?.reason || "community_feed_unavailable";
        const status = reason === "community_feed_unavailable" ? 503 : 400;
        return res.status(status).json({ ok: false, reason });
      }
      return res.json({
        ok: true,
        source: "reddit",
        posts: Array.isArray(result.posts) ? result.posts : [],
        cached: result.cached === true,
        stale: result.stale === true,
        fetchedAt: typeof result.fetchedAt === "number" ? result.fetchedAt : null,
      });
    } catch (err) {
      logger.warn?.("[reddit-listing]", err?.message || err);
      return res.status(503).json({ ok: false, reason: "community_feed_unavailable" });
    }
  });

  return router;
}
