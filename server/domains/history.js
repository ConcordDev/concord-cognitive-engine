// server/domains/history.js
//
// Pure-compute history helpers (timeline, source evaluation, period
// comparison, cause-effect chains) plus real Wikipedia REST API +
// "On This Day" lookups (free, no API key required — but Wikimedia
// requires a contact User-Agent per their UA policy).

const WIKI_REST = "https://en.wikipedia.org/api/rest_v1";
const WIKI_API = "https://en.wikipedia.org/w/api.php";

function wikiUserAgent() {
  const contact = process.env.WIKIPEDIA_CONTACT || "https://concord-os.org";
  return `Concord-OS/1.0 (${contact})`;
}

async function wikiFetch(url) {
  const r = await fetch(url, {
    headers: {
      "User-Agent": wikiUserAgent(),
      Accept: "application/json",
      "Api-User-Agent": wikiUserAgent(),
    },
  });
  if (!r.ok) throw new Error(`wikipedia ${r.status}`);
  return r.json();
}

export default function registerHistoryActions(registerLensAction) {
  registerLensAction("history", "timelineBuild", (ctx, artifact, _params) => {
    const events = artifact.data?.events || [];
    if (events.length === 0) return { ok: true, result: { message: "Add historical events with dates to build timeline." } };
    const sorted = events.map(e => ({ event: e.name || e.title, date: e.date || e.year, era: e.era || "", significance: e.significance || "medium", category: e.category || "political" })).sort((a, b) => { const ya = parseInt(String(a.date).replace(/[^\d-]/g, "")) || 0; const yb = parseInt(String(b.date).replace(/[^\d-]/g, "")) || 0; return ya - yb; });
    const span = sorted.length >= 2 ? `${sorted[0].date} to ${sorted[sorted.length - 1].date}` : "single event";
    return { ok: true, result: { timeline: sorted, totalEvents: sorted.length, timeSpan: span, categories: [...new Set(sorted.map(e => e.category))], eras: [...new Set(sorted.map(e => e.era).filter(Boolean))], pivotalEvents: sorted.filter(e => e.significance === "high" || e.significance === "critical") } };
  });
  registerLensAction("history", "sourceEvaluate", (ctx, artifact, _params) => {
    const source = artifact.data || {};
    const type = (source.type || "secondary").toLowerCase();
    const date = source.date || "";
    const author = source.author || "";
    const bias = (source.bias || "unknown").toLowerCase();
    const typeScore = type === "primary" ? 90 : type === "secondary" ? 60 : 30;
    const biasScore = bias === "none" || bias === "low" ? 90 : bias === "moderate" ? 50 : 20;
    const reliability = Math.round((typeScore * 0.4 + biasScore * 0.3 + (author ? 20 : 0) + (date ? 10 : 0)));
    return { ok: true, result: { title: source.title || artifact.title, type, author, date, bias, reliabilityScore: reliability, classification: reliability >= 70 ? "highly-reliable" : reliability >= 40 ? "use-with-caution" : "questionable", corroborationNeeded: reliability < 60, evaluation: { sourceType: typeScore, biasAssessment: biasScore, authorAttribution: author ? "yes" : "missing", dateProvenance: date ? "yes" : "missing" } } };
  });
  registerLensAction("history", "comparePeriods", (ctx, artifact, _params) => {
    const periods = artifact.data?.periods || [];
    if (periods.length < 2) return { ok: true, result: { message: "Add at least 2 historical periods to compare." } };
    const compared = periods.map(p => ({ name: p.name, startYear: p.startYear, endYear: p.endYear, duration: (parseInt(p.endYear) || 0) - (parseInt(p.startYear) || 0), keyFeatures: p.features || [], population: p.population || "unknown", technology: p.technology || "unknown", governance: p.governance || "unknown" }));
    return { ok: true, result: { periods: compared, longestPeriod: compared.sort((a, b) => b.duration - a.duration)[0]?.name, shortestPeriod: compared.sort((a, b) => a.duration - b.duration)[0]?.name, sharedFeatures: compared.reduce((shared, p) => { if (shared === null) return new Set(p.keyFeatures); return new Set([...shared].filter(f => p.keyFeatures.includes(f))); }, null) || [] } };
  });
  registerLensAction("history", "causeEffect", (ctx, artifact, _params) => {
    const chains = artifact.data?.chains || [];
    if (chains.length === 0) return { ok: true, result: { message: "Map cause-effect chains to analyze historical causation." } };
    const analyzed = chains.map(c => ({ cause: c.cause, effect: c.effect, type: c.type || "direct", strength: c.strength || "moderate", timelag: c.timelag || "unknown", evidence: c.evidence || [] }));
    return { ok: true, result: { chains: analyzed, totalLinks: analyzed.length, directCauses: analyzed.filter(c => c.type === "direct").length, indirectCauses: analyzed.filter(c => c.type === "indirect").length, strongLinks: analyzed.filter(c => c.strength === "strong").length, rootCauses: analyzed.filter(c => !chains.some(other => other.effect === c.cause)).map(c => c.cause) } };
  });

  /**
   * wiki-lookup — Real article summary from Wikipedia REST API.
   * Returns title, extract (intro), description, page URL, thumbnail.
   * Free, no API key. Wikimedia UA policy requires contact header.
   * params: { title: string }
   */
  registerLensAction("history", "wiki-lookup", async (_ctx, _artifact, params = {}) => {
    const title = String(params.title || "").trim();
    if (!title) return { ok: false, error: "title required" };
    try {
      const data = await wikiFetch(`${WIKI_REST}/page/summary/${encodeURIComponent(title.replace(/ /g, "_"))}`);
      if (data.type === "disambiguation") {
        return {
          ok: true,
          result: {
            title: data.title,
            type: "disambiguation",
            description: data.description,
            extract: data.extract,
            note: "Title resolves to a disambiguation page. Pass a more specific title.",
            source: "wikipedia-rest",
          },
        };
      }
      return {
        ok: true,
        result: {
          title: data.title,
          displayTitle: data.displaytitle,
          description: data.description,
          extract: data.extract,
          extractHtml: data.extract_html,
          thumbnail: data.thumbnail?.source,
          pageUrl: data.content_urls?.desktop?.page,
          mobilePageUrl: data.content_urls?.mobile?.page,
          lang: data.lang,
          revisionTimestamp: data.timestamp,
          type: data.type,
          source: "wikipedia-rest",
        },
      };
    } catch (e) {
      if (e instanceof Error && e.message.includes("404")) {
        return { ok: false, error: `Wikipedia page not found: ${title}` };
      }
      return { ok: false, error: `wikipedia unreachable: ${e instanceof Error ? e.message : String(e)}` };
    }
  });

  /**
   * wiki-search — Title search via the Wikipedia opensearch endpoint.
   * Returns up to N matching page titles + extracts + URLs.
   * params: { query: string, limit?: 1-50 }
   */
  registerLensAction("history", "wiki-search", async (_ctx, _artifact, params = {}) => {
    const query = String(params.query || "").trim();
    if (!query) return { ok: false, error: "query required" };
    if (query.length < 2) return { ok: false, error: "query must be ≥ 2 characters" };
    const limit = Math.max(1, Math.min(50, Number(params.limit) || 10));
    try {
      const url = `${WIKI_API}?action=opensearch&format=json&search=${encodeURIComponent(query)}&limit=${limit}&namespace=0`;
      const data = await wikiFetch(url);
      // opensearch returns [query, titles[], descriptions[], urls[]]
      const titles = data[1] || [];
      const descriptions = data[2] || [];
      const urls = data[3] || [];
      const results = titles.map((title, i) => ({
        title,
        description: descriptions[i] || null,
        url: urls[i] || null,
      }));
      return {
        ok: true,
        result: { query, results, count: results.length, source: "wikipedia-opensearch" },
      };
    } catch (e) {
      return { ok: false, error: `wikipedia unreachable: ${e instanceof Error ? e.message : String(e)}` };
    }
  });

  /**
   * on-this-day — Wikipedia "On This Day" feed: events, births, deaths,
   * holidays, and selected entries that happened on a given month/day.
   * Free, no API key (UA policy applies).
   * params: { month: 1-12, day: 1-31, kind?: "events"|"births"|"deaths"|"holidays"|"selected"|"all" }
   */
  registerLensAction("history", "on-this-day", async (_ctx, _artifact, params = {}) => {
    const month = parseInt(params.month, 10);
    const day = parseInt(params.day, 10);
    const kind = ["events", "births", "deaths", "holidays", "selected", "all"].includes(params.kind) ? params.kind : "events";
    if (!Number.isFinite(month) || month < 1 || month > 12) return { ok: false, error: "month must be 1-12" };
    if (!Number.isFinite(day) || day < 1 || day > 31) return { ok: false, error: "day must be 1-31" };
    const mm = String(month).padStart(2, "0");
    const dd = String(day).padStart(2, "0");
    try {
      const data = await wikiFetch(`${WIKI_REST}/feed/onthisday/${kind}/${mm}/${dd}`);
      const shape = (arr) => (arr || []).map((entry) => ({
        text: entry.text,
        year: entry.year,
        pages: (entry.pages || []).slice(0, 3).map((p) => ({
          title: p.title,
          extract: p.extract,
          url: p.content_urls?.desktop?.page,
          thumbnail: p.thumbnail?.source,
        })),
      }));
      return {
        ok: true,
        result: {
          month, day, kind,
          events: shape(data.events),
          births: shape(data.births),
          deaths: shape(data.deaths),
          holidays: shape(data.holidays),
          selected: shape(data.selected),
          source: "wikipedia-onthisday",
        },
      };
    } catch (e) {
      return { ok: false, error: `wikipedia unreachable: ${e instanceof Error ? e.message : String(e)}` };
    }
  });

  // ─── Timeline builder (Tiki-Toki / Sutori-shape, per-user) ───────────

  function getHistoryState() {
    const STATE = globalThis._concordSTATE;
    if (!STATE) return null;
    if (!STATE.historyLens) STATE.historyLens = {};
    if (!(STATE.historyLens.timelines instanceof Map)) STATE.historyLens.timelines = new Map(); // userId -> Array
    return STATE.historyLens;
  }
  function saveHistory() {
    if (typeof globalThis._concordSaveStateDebounced === "function") {
      try { globalThis._concordSaveStateDebounced(); } catch (_e) { /* best effort */ }
    }
  }
  const hsId = (p) => `${p}_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`;
  const hsNow = () => new Date().toISOString();
  const hsActor = (ctx) => ctx?.actor?.userId || ctx?.userId || "anon";
  const hsClean = (v, max = 2000) => String(v == null ? "" : v).trim().slice(0, max);
  const hsYear = (v) => { const n = Number(v); return Number.isFinite(n) ? Math.round(n) : null; };
  const hsList = (s, userId) => { if (!s.timelines.has(userId)) s.timelines.set(userId, []); return s.timelines.get(userId); };

  registerLensAction("history", "timeline-create", (ctx, _a, params = {}) => {
    const s = getHistoryState(); if (!s) return { ok: false, error: "STATE unavailable" };
    const title = hsClean(params.title, 200);
    if (!title) return { ok: false, error: "timeline title required" };
    const timeline = {
      id: hsId("tl"), title,
      description: hsClean(params.description, 1000),
      events: [], eras: [],
      createdAt: hsNow(),
    };
    hsList(s, hsActor(ctx)).push(timeline);
    saveHistory();
    return { ok: true, result: { timeline } };
  });

  registerLensAction("history", "timeline-list", (ctx, _a, _params = {}) => {
    const s = getHistoryState(); if (!s) return { ok: false, error: "STATE unavailable" };
    const timelines = hsList(s, hsActor(ctx)).map((t) => ({
      id: t.id, title: t.title, description: t.description,
      eventCount: t.events.length, eraCount: t.eras.length, createdAt: t.createdAt,
    }));
    return { ok: true, result: { timelines, count: timelines.length } };
  });

  registerLensAction("history", "timeline-detail", (ctx, _a, params = {}) => {
    const s = getHistoryState(); if (!s) return { ok: false, error: "STATE unavailable" };
    const t = hsList(s, hsActor(ctx)).find((x) => x.id === params.id);
    if (!t) return { ok: false, error: "timeline not found" };
    const events = [...t.events].sort((a, b) => (a.year ?? 0) - (b.year ?? 0));
    const eras = [...t.eras].sort((a, b) => (a.startYear ?? 0) - (b.startYear ?? 0));
    const span = events.length > 0
      ? { from: events[0].year, to: events[events.length - 1].year }
      : null;
    return { ok: true, result: { timeline: { ...t, events, eras }, span } };
  });

  registerLensAction("history", "timeline-delete", (ctx, _a, params = {}) => {
    const s = getHistoryState(); if (!s) return { ok: false, error: "STATE unavailable" };
    const arr = hsList(s, hsActor(ctx));
    const i = arr.findIndex((x) => x.id === params.id);
    if (i < 0) return { ok: false, error: "timeline not found" };
    arr.splice(i, 1);
    saveHistory();
    return { ok: true, result: { deleted: params.id } };
  });

  function findTimeline(s, ctx, id) {
    return hsList(s, hsActor(ctx)).find((t) => t.id === id);
  }

  registerLensAction("history", "event-add", (ctx, _a, params = {}) => {
    const s = getHistoryState(); if (!s) return { ok: false, error: "STATE unavailable" };
    const t = findTimeline(s, ctx, params.timelineId);
    if (!t) return { ok: false, error: "timeline not found" };
    const title = hsClean(params.title, 200);
    if (!title) return { ok: false, error: "event title required" };
    const year = hsYear(params.year);
    if (year == null) return { ok: false, error: "event year required (negative for BCE)" };
    const event = {
      id: hsId("ev"),
      title,
      year,
      dateLabel: hsClean(params.dateLabel, 60) || (year < 0 ? `${Math.abs(year)} BCE` : String(year)),
      category: hsClean(params.category, 60) || "general",
      description: hsClean(params.description, 2000),
      createdAt: hsNow(),
    };
    t.events.push(event);
    saveHistory();
    return { ok: true, result: { event } };
  });

  registerLensAction("history", "event-update", (ctx, _a, params = {}) => {
    const s = getHistoryState(); if (!s) return { ok: false, error: "STATE unavailable" };
    const t = findTimeline(s, ctx, params.timelineId);
    if (!t) return { ok: false, error: "timeline not found" };
    const event = t.events.find((e) => e.id === params.eventId);
    if (!event) return { ok: false, error: "event not found" };
    if (params.title != null) event.title = hsClean(params.title, 200) || event.title;
    if (params.year != null) { const y = hsYear(params.year); if (y != null) event.year = y; }
    if (params.dateLabel != null) event.dateLabel = hsClean(params.dateLabel, 60) || event.dateLabel;
    if (params.category != null) event.category = hsClean(params.category, 60) || event.category;
    if (params.description != null) event.description = hsClean(params.description, 2000);
    saveHistory();
    return { ok: true, result: { event } };
  });

  registerLensAction("history", "event-delete", (ctx, _a, params = {}) => {
    const s = getHistoryState(); if (!s) return { ok: false, error: "STATE unavailable" };
    const t = findTimeline(s, ctx, params.timelineId);
    if (!t) return { ok: false, error: "timeline not found" };
    const i = t.events.findIndex((e) => e.id === params.eventId);
    if (i < 0) return { ok: false, error: "event not found" };
    t.events.splice(i, 1);
    saveHistory();
    return { ok: true, result: { deleted: params.eventId } };
  });

  registerLensAction("history", "era-add", (ctx, _a, params = {}) => {
    const s = getHistoryState(); if (!s) return { ok: false, error: "STATE unavailable" };
    const t = findTimeline(s, ctx, params.timelineId);
    if (!t) return { ok: false, error: "timeline not found" };
    const name = hsClean(params.name, 120);
    if (!name) return { ok: false, error: "era name required" };
    const era = {
      id: hsId("era"), name,
      startYear: hsYear(params.startYear),
      endYear: hsYear(params.endYear),
      color: hsClean(params.color, 9) || "#8b5cf6",
    };
    t.eras.push(era);
    saveHistory();
    return { ok: true, result: { era } };
  });

  registerLensAction("history", "era-delete", (ctx, _a, params = {}) => {
    const s = getHistoryState(); if (!s) return { ok: false, error: "STATE unavailable" };
    const t = findTimeline(s, ctx, params.timelineId);
    if (!t) return { ok: false, error: "timeline not found" };
    const i = t.eras.findIndex((e) => e.id === params.eraId);
    if (i < 0) return { ok: false, error: "era not found" };
    t.eras.splice(i, 1);
    saveHistory();
    return { ok: true, result: { deleted: params.eraId } };
  });

  registerLensAction("history", "history-dashboard", (ctx, _a, _params = {}) => {
    const s = getHistoryState(); if (!s) return { ok: false, error: "STATE unavailable" };
    const timelines = hsList(s, hsActor(ctx));
    return {
      ok: true,
      result: {
        timelines: timelines.length,
        totalEvents: timelines.reduce((n, t) => n + t.events.length, 0),
        totalEras: timelines.reduce((n, t) => n + t.eras.length, 0),
      },
    };
  });

  // feed — ingest "on this day" historical events (Wikimedia) as DTUs.
  registerLensAction("history", "feed", async (ctx, _a, params = {}) => {
    const s = getHistoryState(); if (!s) return { ok: false, error: "STATE unavailable" };
    if (!(s.feedSeen instanceof Set)) s.feedSeen = new Set();
    const limit = Math.max(1, Math.min(20, Math.round(Number(params.limit) || 10)));
    const now = new Date();
    const mm = String(now.getMonth() + 1).padStart(2, "0");
    const dd = String(now.getDate()).padStart(2, "0");
    try {
      const r = await fetch(`https://api.wikimedia.org/feed/v1/wikipedia/en/onthisday/events/${mm}/${dd}`, {
        headers: { "User-Agent": "Concord-OS/1.0 (https://concord-os.org)", Accept: "application/json" },
      });
      if (!r.ok) return { ok: false, error: `wikimedia ${r.status}` };
      const data = await r.json();
      const events = (data.events || []).slice(0, limit);
      let ingested = 0, skipped = 0;
      const dtuIds = [];
      for (const ev of events) {
        const key = `otd-${mm}-${dd}-${ev.year}-${(ev.text || "").slice(0, 24)}`;
        if (s.feedSeen.has(key)) { skipped++; continue; }
        const title = `${ev.year}: ${(ev.text || "").slice(0, 120)}`;
        const link = ev.pages?.[0]?.content_urls?.desktop?.page || null;
        const res = await ctx.macro.run("dtu", "create", {
          title,
          creti: `On this day (${mm}/${dd}), ${ev.year}:\n\n${ev.text || ""}${link ? `\n\n${link}` : ""}`,
          tags: ["history", "feed", "on-this-day"],
          source: "wikimedia.onthisday",
          meta: { year: ev.year, monthDay: `${mm}-${dd}`, link },
        });
        if (res?.ok && res.dtu) { ingested++; dtuIds.push(res.dtu.id); s.feedSeen.add(key); }
      }
      saveHistory();
      return { ok: true, result: { ingested, skipped, source: "wikimedia-on-this-day", dtuIds } };
    } catch (e) {
      return { ok: false, error: `wikimedia feed unreachable: ${e instanceof Error ? e.message : String(e)}` };
    }
  });
}
