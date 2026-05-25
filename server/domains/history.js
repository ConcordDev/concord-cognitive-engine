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
  try {
    const s = getHistoryState(); if (!s) return { ok: false, error: "STATE unavailable" };
    const timelines = hsList(s, hsActor(ctx)).map((t) => ({
      id: t.id, title: t.title, description: t.description,
      eventCount: t.events.length, eraCount: t.eras.length, createdAt: t.createdAt,
    }));
    return { ok: true, result: { timelines, count: timelines.length } };
    } catch (e) { return { ok: false, error: "handler_error", message: String(e?.message || e) }; }
});

  registerLensAction("history", "timeline-detail", (ctx, _a, params = {}) => {
  try {
    const s = getHistoryState(); if (!s) return { ok: false, error: "STATE unavailable" };
    const t = hsList(s, hsActor(ctx)).find((x) => x.id === params.id);
    if (!t) return { ok: false, error: "timeline not found" };
    const events = [...t.events].sort((a, b) => (a.year ?? 0) - (b.year ?? 0));
    const eras = [...t.eras].sort((a, b) => (a.startYear ?? 0) - (b.startYear ?? 0));
    const span = events.length > 0
      ? { from: events[0].year, to: events[events.length - 1].year }
      : null;
    return { ok: true, result: { timeline: { ...t, events, eras }, span } };
    } catch (e) { return { ok: false, error: "handler_error", message: String(e?.message || e) }; }
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

  const hsLat = (v) => { const n = Number(v); return Number.isFinite(n) && n >= -90 && n <= 90 ? n : null; };
  const hsLng = (v) => { const n = Number(v); return Number.isFinite(n) && n >= -180 && n <= 180 ? n : null; };
  const hsTrack = (v) => hsClean(v, 60) || "main";

  registerLensAction("history", "event-add", (ctx, _a, params = {}) => {
  try {
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
      track: hsTrack(params.track),
      lat: hsLat(params.lat),
      lng: hsLng(params.lng),
      place: hsClean(params.place, 200),
      media: [],
      createdAt: hsNow(),
    };
    t.events.push(event);
    saveHistory();
    return { ok: true, result: { event } };
    } catch (e) { return { ok: false, error: "handler_error", message: String(e?.message || e) }; }
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
    if (params.track != null) event.track = hsTrack(params.track);
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

  // ─── Map-linked events — plot events geographically ──────────────────
  registerLensAction("history", "event-set-location", (ctx, _a, params = {}) => {
    const s = getHistoryState(); if (!s) return { ok: false, error: "STATE unavailable" };
    const t = findTimeline(s, ctx, params.timelineId);
    if (!t) return { ok: false, error: "timeline not found" };
    const event = t.events.find((e) => e.id === params.eventId);
    if (!event) return { ok: false, error: "event not found" };
    if (params.clear) {
      event.lat = null; event.lng = null; event.place = "";
      saveHistory();
      return { ok: true, result: { event } };
    }
    const lat = hsLat(params.lat);
    const lng = hsLng(params.lng);
    if (lat == null) return { ok: false, error: "lat must be a number in [-90, 90]" };
    if (lng == null) return { ok: false, error: "lng must be a number in [-180, 180]" };
    event.lat = lat;
    event.lng = lng;
    event.place = hsClean(params.place, 200);
    saveHistory();
    return { ok: true, result: { event } };
  });

  // map-points — every located event across all of a user's timelines.
  registerLensAction("history", "map-points", (ctx, _a, params = {}) => {
  try {
    const s = getHistoryState(); if (!s) return { ok: false, error: "STATE unavailable" };
    const list = hsList(s, hsActor(ctx));
    const scope = params.timelineId ? list.filter((t) => t.id === params.timelineId) : list;
    const points = [];
    for (const t of scope) {
      for (const e of t.events) {
        if (typeof e.lat === "number" && typeof e.lng === "number") {
          points.push({
            id: e.id, timelineId: t.id, timelineTitle: t.title,
            title: e.title, year: e.year, dateLabel: e.dateLabel,
            lat: e.lat, lng: e.lng, place: e.place || "", category: e.category,
          });
        }
      }
    }
    return { ok: true, result: { points, count: points.length } };
    } catch (e) { return { ok: false, error: "handler_error", message: String(e?.message || e) }; }
});

  // ─── Image / media attachments per event ─────────────────────────────
  registerLensAction("history", "event-add-media", (ctx, _a, params = {}) => {
    const s = getHistoryState(); if (!s) return { ok: false, error: "STATE unavailable" };
    const t = findTimeline(s, ctx, params.timelineId);
    if (!t) return { ok: false, error: "timeline not found" };
    const event = t.events.find((e) => e.id === params.eventId);
    if (!event) return { ok: false, error: "event not found" };
    const url = hsClean(params.url, 1000);
    if (!url) return { ok: false, error: "media url required" };
    if (!/^https?:\/\//i.test(url)) return { ok: false, error: "media url must be http(s)" };
    const kind = ["image", "video", "audio", "link"].includes(params.kind) ? params.kind : "image";
    if (!Array.isArray(event.media)) event.media = [];
    const media = {
      id: hsId("md"), url, kind,
      caption: hsClean(params.caption, 300),
      credit: hsClean(params.credit, 200),
      addedAt: hsNow(),
    };
    event.media.push(media);
    saveHistory();
    return { ok: true, result: { media, event } };
  });

  registerLensAction("history", "event-remove-media", (ctx, _a, params = {}) => {
    const s = getHistoryState(); if (!s) return { ok: false, error: "STATE unavailable" };
    const t = findTimeline(s, ctx, params.timelineId);
    if (!t) return { ok: false, error: "timeline not found" };
    const event = t.events.find((e) => e.id === params.eventId);
    if (!event) return { ok: false, error: "event not found" };
    if (!Array.isArray(event.media)) event.media = [];
    const i = event.media.findIndex((m) => m.id === params.mediaId);
    if (i < 0) return { ok: false, error: "media not found" };
    event.media.splice(i, 1);
    saveHistory();
    return { ok: true, result: { deleted: params.mediaId, event } };
  });

  // ─── Visual render — zoomable timeline data with range + era overlays ─
  registerLensAction("history", "timeline-render", (ctx, _a, params = {}) => {
  try {
    const s = getHistoryState(); if (!s) return { ok: false, error: "STATE unavailable" };
    const t = findTimeline(s, ctx, params.timelineId);
    if (!t) return { ok: false, error: "timeline not found" };
    const fromYear = params.fromYear != null ? hsYear(params.fromYear) : null;
    const toYear = params.toYear != null ? hsYear(params.toYear) : null;
    const trackFilter = params.track ? hsTrack(params.track) : null;
    let events = t.events.filter((e) => typeof e.year === "number");
    if (fromYear != null) events = events.filter((e) => e.year >= fromYear);
    if (toYear != null) events = events.filter((e) => e.year <= toYear);
    if (trackFilter) events = events.filter((e) => (e.track || "main") === trackFilter);
    events = events.slice().sort((a, b) => a.year - b.year);
    const eras = t.eras
      .slice()
      .filter((era) => {
        if (fromYear != null && era.endYear != null && era.endYear < fromYear) return false;
        if (toYear != null && era.startYear != null && era.startYear > toYear) return false;
        return true;
      })
      .sort((a, b) => (a.startYear ?? 0) - (b.startYear ?? 0));
    const years = events.map((e) => e.year);
    const minYear = years.length ? Math.min(...years) : null;
    const maxYear = years.length ? Math.max(...years) : null;
    const tracks = [...new Set(t.events.map((e) => e.track || "main"))].sort();
    const categories = [...new Set(events.map((e) => e.category || "general"))].sort();
    return {
      ok: true,
      result: {
        timelineId: t.id, title: t.title, description: t.description,
        events: events.map((e) => ({
          id: e.id, title: e.title, year: e.year, dateLabel: e.dateLabel,
          category: e.category || "general", description: e.description || "",
          track: e.track || "main",
          lat: typeof e.lat === "number" ? e.lat : null,
          lng: typeof e.lng === "number" ? e.lng : null,
          place: e.place || "",
          media: Array.isArray(e.media) ? e.media : [],
        })),
        eras, tracks, categories,
        span: minYear != null ? { minYear, maxYear } : null,
        range: { fromYear, toYear },
        totalEvents: events.length,
      },
    };
    } catch (e) { return { ok: false, error: "handler_error", message: String(e?.message || e) }; }
});

  // ─── Multi-track / parallel timeline comparison ──────────────────────
  registerLensAction("history", "timeline-compare", (ctx, _a, params = {}) => {
  try {
    const s = getHistoryState(); if (!s) return { ok: false, error: "STATE unavailable" };
    const ids = Array.isArray(params.timelineIds) ? params.timelineIds.slice(0, 6) : [];
    if (ids.length < 2) return { ok: false, error: "provide at least 2 timelineIds to compare" };
    const list = hsList(s, hsActor(ctx));
    const tracks = [];
    for (const id of ids) {
      const t = list.find((x) => x.id === id);
      if (!t) return { ok: false, error: `timeline not found: ${id}` };
      const events = t.events
        .filter((e) => typeof e.year === "number")
        .slice()
        .sort((a, b) => a.year - b.year)
        .map((e) => ({
          id: e.id, title: e.title, year: e.year, dateLabel: e.dateLabel,
          category: e.category || "general",
        }));
      const years = events.map((e) => e.year);
      tracks.push({
        timelineId: t.id, title: t.title, events,
        eras: t.eras.slice().sort((a, b) => (a.startYear ?? 0) - (b.startYear ?? 0)),
        span: years.length ? { minYear: Math.min(...years), maxYear: Math.max(...years) } : null,
        eventCount: events.length,
      });
    }
    const allYears = tracks.flatMap((tr) => tr.events.map((e) => e.year));
    return {
      ok: true,
      result: {
        tracks,
        combinedSpan: allYears.length
          ? { minYear: Math.min(...allYears), maxYear: Math.max(...allYears) }
          : null,
        trackCount: tracks.length,
      },
    };
    } catch (e) { return { ok: false, error: "handler_error", message: String(e?.message || e) }; }
});

  // ─── Publish / share a timeline; public read-only fetch ──────────────
  function getPublicMap(s) {
    if (!(s.publishedTimelines instanceof Map)) s.publishedTimelines = new Map(); // shareId -> snapshot
    return s.publishedTimelines;
  }

  registerLensAction("history", "timeline-publish", (ctx, _a, params = {}) => {
  try {
    const s = getHistoryState(); if (!s) return { ok: false, error: "STATE unavailable" };
    const t = findTimeline(s, ctx, params.timelineId);
    if (!t) return { ok: false, error: "timeline not found" };
    const pub = getPublicMap(s);
    // reuse an existing share id if this timeline was already published
    let shareId = null;
    for (const [sid, snap] of pub) {
      if (snap.timelineId === t.id && snap.owner === hsActor(ctx)) { shareId = sid; break; }
    }
    if (!shareId) shareId = hsId("share");
    const snapshot = {
      shareId, timelineId: t.id, owner: hsActor(ctx),
      title: t.title, description: t.description,
      events: t.events
        .filter((e) => typeof e.year === "number")
        .slice()
        .sort((a, b) => a.year - b.year)
        .map((e) => ({
          title: e.title, year: e.year, dateLabel: e.dateLabel,
          category: e.category || "general", description: e.description || "",
          track: e.track || "main",
          lat: typeof e.lat === "number" ? e.lat : null,
          lng: typeof e.lng === "number" ? e.lng : null,
          place: e.place || "",
          media: Array.isArray(e.media) ? e.media : [],
        })),
      eras: t.eras.slice().sort((a, b) => (a.startYear ?? 0) - (b.startYear ?? 0)),
      publishedAt: hsNow(),
    };
    pub.set(shareId, snapshot);
    saveHistory();
    const base = process.env.PUBLIC_BASE_URL || "https://concord-os.org";
    return {
      ok: true,
      result: {
        shareId,
        shareUrl: `${base}/lenses/history?share=${shareId}`,
        embedCode: `<iframe src="${base}/embed/history/${shareId}" width="100%" height="480" frameborder="0" title="${t.title}"></iframe>`,
        eventCount: snapshot.events.length,
        publishedAt: snapshot.publishedAt,
      },
    };
    } catch (e) { return { ok: false, error: "handler_error", message: String(e?.message || e) }; }
});

  registerLensAction("history", "timeline-unpublish", (ctx, _a, params = {}) => {
    const s = getHistoryState(); if (!s) return { ok: false, error: "STATE unavailable" };
    const pub = getPublicMap(s);
    const snap = pub.get(params.shareId);
    if (!snap) return { ok: false, error: "published timeline not found" };
    if (snap.owner !== hsActor(ctx)) return { ok: false, error: "not the owner of this share" };
    pub.delete(params.shareId);
    saveHistory();
    return { ok: true, result: { unpublished: params.shareId } };
  });

  // public read — no owner scoping (this is the shareable surface).
  registerLensAction("history", "timeline-public-get", (_ctx, _a, params = {}) => {
    const s = getHistoryState(); if (!s) return { ok: false, error: "STATE unavailable" };
    const pub = getPublicMap(s);
    const snap = pub.get(hsClean(params.shareId, 80));
    if (!snap) return { ok: false, error: "published timeline not found" };
    return {
      ok: true,
      result: {
        shareId: snap.shareId, title: snap.title, description: snap.description,
        events: snap.events, eras: snap.eras, publishedAt: snap.publishedAt,
        eventCount: snap.events.length,
      },
    };
  });

  // ─── Auto-build a timeline from a Wikipedia article ──────────────────
  // Pulls the article's full plaintext via the MediaWiki API and extracts
  // every year-bearing sentence as a timeline event. No LLM, no fake data.
  registerLensAction("history", "timeline-from-wikipedia", async (ctx, _a, params = {}) => {
    const s = getHistoryState(); if (!s) return { ok: false, error: "STATE unavailable" };
    const title = hsClean(params.title, 200);
    if (!title) return { ok: false, error: "wikipedia article title required" };
    let data;
    try {
      const url = `${WIKI_API}?action=query&format=json&prop=extracts&explaintext=1&redirects=1&titles=${encodeURIComponent(title)}`;
      data = await wikiFetch(url);
    } catch (e) {
      return { ok: false, error: `wikipedia unreachable: ${e instanceof Error ? e.message : String(e)}` };
    }
    const pages = data?.query?.pages || {};
    const page = Object.values(pages)[0];
    if (!page || page.missing !== undefined || !page.extract) {
      return { ok: false, error: `Wikipedia article not found or empty: ${title}` };
    }
    const text = String(page.extract);
    // Split into sentences and keep ones that name a 1-4 digit year, optionally BC/BCE.
    const sentences = text
      .replace(/\n+/g, " ")
      .split(/(?<=[.!?])\s+/)
      .map((x) => x.trim())
      .filter((x) => x.length >= 12 && x.length <= 400);
    const yearRe = /\b(\d{1,4})\s?(BCE?|BC)?\b/;
    const seenYears = new Set();
    const extracted = [];
    for (const sent of sentences) {
      const m = sent.match(yearRe);
      if (!m) continue;
      let year = parseInt(m[1], 10);
      if (!Number.isFinite(year) || year === 0) continue;
      if (m[2]) year = -Math.abs(year); // BC / BCE
      // Filter implausible page/section numbers: positive years above current+1.
      if (year > new Date().getFullYear() + 1) continue;
      const key = `${year}|${sent.slice(0, 40)}`;
      if (seenYears.has(key)) continue;
      seenYears.add(key);
      extracted.push({
        year,
        dateLabel: year < 0 ? `${Math.abs(year)} BCE` : String(year),
        title: sent.length > 120 ? `${sent.slice(0, 117)}…` : sent,
        description: sent,
      });
    }
    extracted.sort((a, b) => a.year - b.year);
    const maxEvents = Math.max(1, Math.min(120, Number(params.maxEvents) || 60));
    const picked = extracted.slice(0, maxEvents);
    if (picked.length === 0) {
      return { ok: false, error: `No dated events could be extracted from "${page.title}".` };
    }
    const timeline = {
      id: hsId("tl"),
      title: hsClean(params.timelineTitle, 200) || `${page.title} — Timeline`,
      description: `Auto-built from the Wikipedia article "${page.title}".`,
      events: picked.map((e) => ({
        id: hsId("ev"), title: e.title, year: e.year, dateLabel: e.dateLabel,
        category: "wikipedia", description: e.description,
        track: "main", lat: null, lng: null, place: "", media: [],
        createdAt: hsNow(),
      })),
      eras: [],
      source: "wikipedia",
      sourceArticle: page.title,
      createdAt: hsNow(),
    };
    hsList(s, hsActor(ctx)).push(timeline);
    saveHistory();
    return {
      ok: true,
      result: {
        timeline: {
          id: timeline.id, title: timeline.title, description: timeline.description,
          eventCount: timeline.events.length, sourceArticle: page.title,
        },
        extractedCount: extracted.length,
        usedCount: picked.length,
      },
    };
  });

  registerLensAction("history", "history-dashboard", (ctx, _a, _params = {}) => {
  try {
    const s = getHistoryState(); if (!s) return { ok: false, error: "STATE unavailable" };
    const timelines = hsList(s, hsActor(ctx));
    const owner = hsActor(ctx);
    let published = 0, mappedEvents = 0;
    if (s.publishedTimelines instanceof Map) {
      for (const snap of s.publishedTimelines.values()) if (snap.owner === owner) published++;
    }
    for (const t of timelines) {
      for (const e of t.events) {
        if (typeof e.lat === "number" && typeof e.lng === "number") mappedEvents++;
      }
    }
    return {
      ok: true,
      result: {
        timelines: timelines.length,
        totalEvents: timelines.reduce((n, t) => n + t.events.length, 0),
        totalEras: timelines.reduce((n, t) => n + t.eras.length, 0),
        publishedTimelines: published,
        mappedEvents,
      },
    };
    } catch (e) { return { ok: false, error: "handler_error", message: String(e?.message || e) }; }
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
