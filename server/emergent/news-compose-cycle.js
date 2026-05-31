// server/emergent/news-compose-cycle.js
//
// News auto-composer heartbeat (~every 15 min, frequency 60, scope 'global').
//
// Harvests recent emergent events (scheme reveals, faction wars, realm decrees,
// dynasty successions, lattice alerts) from their live producer tables and
// composes citable news DTUs the /lenses/news surface reads. The composer +
// its macros existed but nothing ran them on a clock — this is the producer
// wire behind the already-built consumer.
//
// Heartbeat-compatible: always returns { ok, ... }, never throws.
// Kill-switch: CONCORD_NEWS_COMPOSE=0.

import { runNewsComposePass } from "../lib/news-story-composer.js";

const WINDOW_S = 6 * 60 * 60; // harvest events from the last 6h

export async function runNewsComposeCycle({ db } = {}) {
  if (process.env.CONCORD_NEWS_COMPOSE === "0") return { ok: false, reason: "disabled" };
  if (!db) return { ok: false, reason: "no_db" };
  try {
    const sinceUnix = Math.floor(Date.now() / 1000) - WINDOW_S;
    const r = runNewsComposePass(db, { sinceUnix });
    return { ok: true, harvested: r?.harvested ?? 0, composed: r?.composed ?? 0 };
  } catch (err) {
    return { ok: false, error: String(err?.message || err) };
  }
}
