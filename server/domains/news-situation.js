/**
 * news.situation — the Situation Room's whole picture in one read.
 *
 * Gathers the live feed (GDELT + vetted RSS, through news.headlines, across
 * the requested categories) and the shared library (articles members added)
 * over a time window, then:
 *
 *  - places each story where its own words put it (lib/news-places.js):
 *    basis "mentioned"; else the outlet's country when the feed names it:
 *    basis "outlet"; else unplaced. Nothing is placed on a guess.
 *  - rolls places up per country: stories, sources, last-3h count, latest.
 *  - links countries named in the same story (arcs), by how many stories.
 *  - buckets stories by hour for the timeline scrubber. Undated stories are
 *    counted, never given an invented time.
 *  - groups the same event told by different outlets (token Jaccard), so a
 *    story can say how many sources covered it.
 *
 * The feed's own status (fresh / stale / unavailable, with its reason) is
 * passed through untouched, so an empty map can say why it is empty.
 */

import { placesIn, countryKey } from "../lib/news-places.js";

const MAX_HOURS = 72;
const DEFAULT_CATEGORIES = ["top", "world", "business", "politics", "science", "health", "tech"];
const STOP = new Set(["the", "a", "an", "and", "or", "of", "to", "in", "on", "for", "at", "by", "with", "from", "as", "is", "are", "was", "be", "after", "over", "new", "says", "say", "its", "it", "that", "this", "into", "amid", "vs", "us"]);

function tokens(t) {
  return new Set(String(t || "").toLowerCase().replace(/[^a-z0-9\s]/g, " ").split(/\s+/).filter((w) => w.length > 2 && !STOP.has(w)));
}
function jaccard(a, b) {
  if (!a.size || !b.size) return 0;
  let inter = 0;
  for (const x of a) if (b.has(x)) inter++;
  return inter / (a.size + b.size - inter);
}
const hourFloor = (ms) => Math.floor(ms / 3_600_000) * 3_600_000;

export function registerNewsSituation(registerLensAction, { getNewsState, categories, callOwn }) {
  registerLensAction("news", "situation", async (ctx, _a, params = {}) => {
    try {
      const rawHours = Number(params.hours);
      const hours = Number.isFinite(rawHours) ? Math.min(MAX_HOURS, Math.max(1, Math.round(rawHours))) : 24;
      const wanted = Array.isArray(params.categories) ? params.categories.map(String).filter((c) => categories.includes(c)) : [];
      const cats = wanted.length ? [...new Set(wanted)].slice(0, 9) : DEFAULT_CATEGORIES.filter((c) => categories.includes(c));
      const now = Date.now();
      const from = now - hours * 3_600_000;

      const feeds = await Promise.all(cats.map((category) => Promise.resolve()
        .then(() => callOwn("headlines", ctx, { category, limit: 50 }))
        .catch((e) => ({ ok: false, error: String(e?.message || e) }))));

      // ── gather (dedupe by URL, then by exact title) ────────────────
      const seenUrl = new Set();
      const seenTitle = new Set();
      const raw = [];
      const feedStatus = { categories: {}, fetchedAt: null, sources: new Map() };
      feeds.forEach((r, i) => {
        const res = r?.ok ? r.result : null;
        feedStatus.categories[cats[i]] = res ? { status: res.status, reason: res.reason || null } : { status: "unavailable", reason: r?.error || "failed" };
        if (!res) return;
        if (res.fetchedAt && (!feedStatus.fetchedAt || res.fetchedAt > feedStatus.fetchedAt)) feedStatus.fetchedAt = res.fetchedAt;
        for (const s of res.sources || []) if (!feedStatus.sources.has(s.id)) feedStatus.sources.set(s.id, s);
        for (const h of res.headlines || []) {
          const tk = String(h.title || "").trim().toLowerCase();
          if (!h.title || seenUrl.has(h.url) || seenTitle.has(tk)) continue;
          seenUrl.add(h.url); seenTitle.add(tk);
          raw.push({ id: h.id, kind: "live", title: h.title, url: h.url, source: h.source || h.attribution || "", category: h.category, publishedAt: h.publishedAt || null, text: `${h.title} ${h.snippet || ""} ${h.summary || ""}`, outletCountry: h.sourceCountry || null });
        }
      });
      const s = getNewsState();
      if (s?.articles) {
        for (const a of s.articles.values()) {
          if (a.url && seenUrl.has(a.url)) continue;
          raw.push({ id: a.id, kind: "library", title: a.title, url: a.url || null, source: a.source, category: a.topic || "general", publishedAt: a.publishedAt || null, text: `${a.title} ${a.summary || ""}`, outletCountry: null });
        }
      }

      // ── window, place, cluster ─────────────────────────────────────
      let undated = 0;
      const stories = [];
      for (const r of raw) {
        const t = r.publishedAt ? Date.parse(r.publishedAt) : NaN;
        if (Number.isNaN(t)) { undated++; continue; }
        if (t < from || t > now + 5 * 60_000) continue;
        const mentioned = placesIn(r.text);
        let places = mentioned;
        let basis = mentioned.length ? "mentioned" : null;
        if (!places.length) {
          const k = countryKey(r.outletCountry);
          if (k) { places = [{ key: k, terms: [r.outletCountry] }]; basis = "outlet"; }
        }
        stories.push({ id: r.id, kind: r.kind, title: r.title, url: r.url, source: r.source, category: r.category, at: new Date(t).toISOString(), t, places, basis, outletCountry: r.outletCountry, tk: tokens(r.title) });
      }
      stories.sort((a, b) => b.t - a.t);

      // Same event, different outlets: greedy clustering by title overlap.
      const clusters = [];
      for (const st of stories) {
        let home = null;
        for (const c of clusters) if (jaccard(c.tk, st.tk) >= 0.34) { home = c; break; }
        if (!home) { home = { id: `c${clusters.length + 1}`, tk: st.tk, members: [] }; clusters.push(home); }
        home.members.push(st);
        st.clusterId = home.id;
      }
      const clusterSize = new Map(clusters.map((c) => [c.id, new Set(c.members.map((m) => m.source)).size]));

      // ── regions, arcs, timeline ────────────────────────────────────
      const regions = new Map();
      const arcs = new Map();
      for (const st of stories) {
        for (const p of st.places) {
          const r = regions.get(p.key) || { key: p.key, count: 0, mentioned: 0, outlet: 0, sources: new Set(), last3h: 0, latest: null, categories: {} };
          r.count++;
          if (st.basis === "mentioned") r.mentioned++; else r.outlet++;
          if (st.source) r.sources.add(st.source);
          if (st.t >= now - 3 * 3_600_000) r.last3h++;
          if (!r.latest || st.at > r.latest) r.latest = st.at;
          r.categories[st.category] = (r.categories[st.category] || 0) + 1;
          regions.set(p.key, r);
        }
        if (st.basis === "mentioned" && st.places.length > 1) {
          const keys = [...new Set(st.places.map((p) => p.key))].sort();
          for (let i = 0; i < keys.length; i++) {for (let j = i + 1; j < keys.length; j++) {
            const id = `${keys[i]}|${keys[j]}`;
            arcs.set(id, { a: keys[i], b: keys[j], count: (arcs.get(id)?.count || 0) + 1 });
          }}
        }
      }
      const buckets = new Map();
      for (let h = hourFloor(from); h <= hourFloor(now); h += 3_600_000) buckets.set(h, { at: new Date(h).toISOString(), count: 0, placed: 0 });
      for (const st of stories) {
        const b = buckets.get(hourFloor(st.t));
        if (b) { b.count++; if (st.places.length) b.placed++; }
      }

      const anyFresh = Object.values(feedStatus.categories).some((c) => c.status === "fresh");
      const anyStale = Object.values(feedStatus.categories).some((c) => c.status === "stale");
      const reasons = [...new Set(Object.values(feedStatus.categories).map((c) => c.reason).filter(Boolean))];

      return {
        ok: true,
        result: {
          window: { hours, from: new Date(from).toISOString(), to: new Date(now).toISOString() },
          feed: {
            status: anyFresh ? "fresh" : anyStale ? "stale" : "unavailable",
            reasons,
            fetchedAt: feedStatus.fetchedAt,
            categories: feedStatus.categories,
            sources: [...feedStatus.sources.values()],
          },
          stories: stories.map(({ tk, t, ...st }) => ({ ...st, coverage: clusterSize.get(st.clusterId) || 1 })),
          regions: [...regions.values()].map((r) => ({ ...r, sources: r.sources.size })).sort((a, b) => b.count - a.count),
          arcs: [...arcs.values()].sort((a, b) => b.count - a.count).slice(0, 40),
          timeline: [...buckets.values()],
          counts: {
            stories: stories.length,
            placed: stories.filter((x) => x.places.length).length,
            mentioned: stories.filter((x) => x.basis === "mentioned").length,
            outlet: stories.filter((x) => x.basis === "outlet").length,
            unplaced: stories.filter((x) => !x.places.length).length,
            undated,
            live: stories.filter((x) => x.kind === "live").length,
            library: stories.filter((x) => x.kind === "library").length,
          },
        },
      };
    } catch (e) {
      return { ok: false, error: "situation_failed", message: String(e?.message || e) };
    }
  });
}

export default registerNewsSituation;
